import Foundation
import ReadiumShared

// MARK: - 运行请求与配置

struct AgentRunRequest: Sendable {
    let conversationID: UUID
    let bookID: String
    let bookTitle: String
    /// UI 提供的读者上下文（问题、书内提示等），会拼在内核固定规则之后。
    let systemPrompt: String
    /// 本轮新增消息（通常是读者问题）；恢复时历史来自 checkpoint。
    let messages: [AgentMessage]
    /// 传入则从该检查点继续（messages 追加在检查点历史之后）。
    let checkpoint: AgentCheckpoint?

    init(conversationID: UUID, bookID: String, bookTitle: String,
         systemPrompt: String = "", messages: [AgentMessage], checkpoint: AgentCheckpoint? = nil) {
        self.conversationID = conversationID
        self.bookID = bookID
        self.bookTitle = bookTitle
        self.systemPrompt = systemPrompt
        self.messages = messages
        self.checkpoint = checkpoint
    }
}

struct AgentRuntimeConfiguration: Sendable, Equatable {
    /// 最多模型步数（工具结果回填也占一步），符合契约的 8 步上限。
    var maxSteps: Int = 8
    var maxAnswerCharacters: Int = 6000
    /// 单步最多执行多少个工具调用，多出的直接回填错误结果，避免模型一步开十个工具。
    var maxToolCallsPerStep: Int = 6
    /// 整次运行的总超时（另有单次模型请求超时 AgentModelOptions.timeout）。
    var runTimeout: TimeInterval = 240
    var modelOptions: AgentModelOptions = AgentModelOptions()

    init() {}
}

/// 引用核对（对应「最终回答必须经过书内原文核对」）。
protocol AgentCitationVerifier: Sendable {
    /// 返回通过书内索引核对的下标；nil 表示索引暂时不可用（执行器保留文本比对结果并警告）。
    func verifiedIndices(in evidence: [QuestionEvidence]) async -> Set<Int>?
}

/// 生产实现：BookIndex.permits（会重新读取书内 fragment；PDF 走页级校验）。
struct BookIndexCitationVerifier: AgentCitationVerifier {
    let index: BookIndex
    let scope: BookEvidenceScope

    init(index: BookIndex, bookID: String) {
        self.index = index
        scope = BookEvidenceScope(bookID: bookID)
    }

    func verifiedIndices(in evidence: [QuestionEvidence]) async -> Set<Int>? {
        guard !evidence.isEmpty else { return [] }
        do {
            if try await index.permits(evidence, scope: scope) { return Set(evidence.indices) }
            // 整批失败再逐条定位，只剔除真正无效的引用。
            var accepted: Set<Int> = []
            for (offset, value) in evidence.enumerated() {
                if (try? await index.permits([value], scope: scope)) == true { accepted.insert(offset) }
            }
            return accepted
        } catch {
            return nil
        }
    }
}

// MARK: - 会话

/// UI 侧句柄：消费 events，离开页面时 cancel()。
final class AgentSession: @unchecked Sendable {
    let events: AsyncStream<AgentEvent>
    private let task: Task<Void, Never>

    init(events: AsyncStream<AgentEvent>, task: Task<Void, Never>) {
        self.events = events
        self.task = task
    }

    /// 取消本次运行；执行器会保存 cancelled 检查点并发出 .cancelled。
    func cancel() { task.cancel() }

    /// 测试/退出前等待运行彻底结束。
    func wait() async { await task.value }
}

// MARK: - 执行器

/// 原生 Agent 执行器（对应 LangChain AgentExecutor）：
/// 多步模型 ↔ 工具循环、事件流、引用核对、上下文预算、检查点与收尾。
/// 只依赖协议，不依赖 UI，也不直接读网络配置。
final class AgentExecutor: Sendable {
    private let model: any AgentChatModel
    private let tools: AgentToolRegistry
    private let context: AgentContextManager
    private let checkpoints: AgentCheckpointStore?
    private let verifier: (any AgentCitationVerifier)?
    private let configuration: AgentRuntimeConfiguration

    init(model: any AgentChatModel,
         tools: AgentToolRegistry,
         context: AgentContextManager = AgentContextManager(),
         checkpoints: AgentCheckpointStore? = nil,
         verifier: (any AgentCitationVerifier)? = nil,
         configuration: AgentRuntimeConfiguration = AgentRuntimeConfiguration()) {
        self.model = model
        self.tools = tools
        self.context = context
        self.checkpoints = checkpoints
        self.verifier = verifier
        self.configuration = configuration
    }

    func start(_ request: AgentRunRequest) -> AgentSession {
        let (stream, continuation) = AsyncStream<AgentEvent>.makeStream(of: AgentEvent.self, bufferingPolicy: .unbounded)
        let task = Task { [self] in
            await run(request, emit: { continuation.yield($0) })
            continuation.finish()
        }
        continuation.onTermination = { _ in task.cancel() }
        return AgentSession(events: stream, task: task)
    }

    // MARK: 主循环

    private func run(_ request: AgentRunRequest, emit: @escaping (AgentEvent) -> Void) async {
        let startedAt = Date()
        var history = request.checkpoint.map { Self.repairedHistory($0.messages) } ?? []
        history.append(contentsOf: request.messages)
        var steps = request.checkpoint?.steps ?? 0
        var warnings: [String] = []
        let budget = context.budget
        var lastUsage = AgentContextUsage(
            limitTokens: budget.thresholdTokens, contextWindow: budget.contextWindow,
            thresholdTokens: budget.thresholdTokens,
            thresholdPercent: budget.contextWindow > 0
                ? min(1, Double(budget.thresholdTokens) / Double(budget.contextWindow)) : 0)
        let allocator = AgentEvidenceAllocator()
        let systemPrompt = AgentPrompts.system(base: request.systemPrompt)

        let now = Date()
        var checkpoint = AgentCheckpoint(
            conversationID: request.conversationID,
            bookID: request.bookID,
            bookTitle: request.bookTitle,
            createdAt: request.checkpoint?.createdAt ?? now,
            updatedAt: now,
            status: .running,
            model: model.modelIdentifier,
            messages: history,
            steps: steps,
            result: nil,
            failure: nil,
            warnings: [],
            context: nil
        )

        func saveCheckpoint(_ status: AgentRunStatus, result: AgentRunResult? = nil, failure: AgentFailure? = nil) {
            guard let store = checkpoints else { return }
            checkpoint.messages = history
            checkpoint.steps = steps
            checkpoint.updatedAt = Date()
            checkpoint.status = status
            checkpoint.result = result
            checkpoint.failure = failure
            checkpoint.warnings = warnings
            checkpoint.context = lastUsage
            do {
                try store.save(checkpoint)
            } catch {
                let warning = AgentWarning(code: .checkpointStorage, message: "对话进度保存失败，关闭后可能无法回看本次步骤。")
                warnings.append(warning.message)
                emit(.warning(warning))
            }
        }

        emit(.started(AgentRunStarted(conversationID: request.conversationID, bookID: request.bookID,
                                      model: model.modelIdentifier, toolNames: tools.names,
                                      maxSteps: configuration.maxSteps, resumed: request.checkpoint != nil)))

        // 已完成的检查点直接回看，不重新调用 AI。
        if let saved = request.checkpoint, saved.status == .completed,
           let result = saved.result, request.messages.isEmpty {
            for citation in result.citations { emit(.citation(citation)) }
            emit(.completed(result))
            return
        }

        saveCheckpoint(.running)

        do {
            while true {
                try Task.checkCancellation()
                if Date().timeIntervalSince(startedAt) > configuration.runTimeout {
                    throw AgentFailure(code: .timeout, message: "本次问答超时，请稍后重试。")
                }
                if steps >= configuration.maxSteps {
                    throw AgentFailure(code: .stepLimit,
                                       message: "已达到最多 \(configuration.maxSteps) 步工具调用，未能完成回答；可缩小问题范围后重试。")
                }
                let finalStep = steps == configuration.maxSteps - 1
                emit(.step(AgentStepStarted(index: steps + 1, finalStep: finalStep)))

                // 1. 上下文：低于阈值原样发送；达到阈值才裁工具结果 → 摘要旧历史 → 再评估。
                let plan = await context.prepare(conversationID: request.conversationID,
                                                 systemPrompt: systemPrompt, messages: history)
                try Task.checkCancellation()
                lastUsage = plan.usage
                checkpoint.summary = plan.summaryReference
                emit(.context(AgentContextSnapshot(usage: plan.usage, actions: plan.actions)))
                if plan.overBudget {
                    throw AgentFailure(code: .contextBudget,
                                       message: "本次对话已超出模型上下文窗口（约 \(plan.usage.estimatedTokens) tokens，窗口 \(plan.usage.contextWindow)，压缩阈值 \(plan.usage.thresholdTokens)）；请新建对话或缩短问题后重试。")
                }
                var requestMessages = plan.messages
                if finalStep {
                    let warning = AgentWarning(code: .stepLimit,
                                               message: "已达到最多 \(configuration.maxSteps) 步，正在收尾。")
                    warnings.append(warning.message)
                    emit(.warning(warning))
                    requestMessages.append(.user(AgentPrompts.wrapUp(maxSteps: configuration.maxSteps)))
                }

                // 2. 模型流式输出：文本直接转发，工具调用收集到本轮结束。
                var assistantText = ""
                var calls: [AgentToolCall] = []
                var finishReason: AgentFinishReason = .stop
                do {
                    let stream = model.stream(messages: requestMessages,
                                              tools: finalStep ? [] : tools.specs,
                                              options: configuration.modelOptions)
                    for try await event in stream {
                        try Task.checkCancellation()
                        switch event {
                        case .textDelta(let delta):
                            assistantText += delta
                            emit(.textDelta(delta))
                        case .toolCall(let call):
                            calls.append(call)
                        case .finished(let reason):
                            finishReason = reason
                        }
                    }
                } catch is CancellationError {
                    throw CancellationError()
                } catch {
                    throw AgentFailure.from(error)
                }
                try Task.checkCancellation()
                steps += 1

                // 3. 没有工具调用、最后一步、或步数用尽：产出最终 JSON 回答。
                if calls.isEmpty || finalStep || steps >= configuration.maxSteps {
                    if assistantText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                       (finalStep || steps >= configuration.maxSteps) {
                        throw AgentFailure(code: .stepLimit,
                                           message: "已达到最多 \(configuration.maxSteps) 步，模型没有给出最终回答；可缩小问题范围后重试。")
                    }
                    guard let finished = await finalize(rawText: assistantText, allocator: allocator,
                                                        request: request, steps: steps, usage: lastUsage,
                                                        finishReason: finishReason) else {
                        if finishReason == .length {
                            throw AgentFailure(code: .capacity, message: "回答被模型长度上限截断，未完成；请缩短问题后重试。")
                        }
                        throw AgentFailure(code: .invalidResponse, message: "模型没有返回可用的回答，请重试。")
                    }
                    for warning in finished.warnings {
                        warnings.append(warning.message)
                        emit(.warning(warning))
                    }
                    history.append(.assistant(finished.result.answer))
                    saveCheckpoint(.completed, result: finished.result)
                    for citation in finished.result.citations { emit(.citation(citation)) }
                    emit(.completed(finished.result))
                    return
                }

                // 4. 回填 assistant(tool_calls) + 每个工具结果，进入下一轮。
                history.append(.assistant(assistantText, toolCalls: calls))
                let executed = Array(calls.prefix(configuration.maxToolCallsPerStep))
                let skipped = Array(calls.dropFirst(configuration.maxToolCallsPerStep))
                for call in executed {
                    try Task.checkCancellation()
                    emit(.toolStarted(call))
                    let callStarted = Date()
                    let result: AgentToolResult
                    if let tool = tools.tool(named: call.name) {
                        do {
                            result = try await tool.call(
                                AgentToolArguments(json: call.argumentsJSON),
                                context: AgentToolCallContext(callID: call.id, step: steps,
                                                              bookID: request.bookID, evidence: allocator))
                        } catch is CancellationError {
                            throw CancellationError()
                        } catch {
                            let message = (error as? LocalizedError)?.errorDescription ?? "工具执行失败"
                            result = .failure(AgentPrompts.toolResultError(message))
                        }
                    } else {
                        result = .failure(AgentPrompts.toolResultError("未知工具「\(call.name)」"))
                    }
                    emit(.toolFinished(AgentToolFinished(call: call, isError: result.isError,
                                                         content: result.content,
                                                         duration: Date().timeIntervalSince(callStarted))))
                    history.append(.tool(call, content: result.content, isError: result.isError))
                }
                for call in skipped {
                    let result = AgentToolResult.failure(
                        AgentPrompts.toolResultError("单步工具调用过多，本次只执行了前 \(configuration.maxToolCallsPerStep) 个"))
                    emit(.toolStarted(call))
                    emit(.toolFinished(AgentToolFinished(call: call, isError: true,
                                                         content: result.content, duration: 0)))
                    history.append(.tool(call, content: result.content, isError: true))
                }
                saveCheckpoint(.running)
            }
        } catch is CancellationError {
            saveCheckpoint(.cancelled)
            emit(.cancelled)
        } catch let failure as AgentFailure {
            saveCheckpoint(.failed, failure: failure)
            emit(.failed(failure))
        } catch {
            let failure = AgentFailure.from(error)
            saveCheckpoint(.failed, failure: failure)
            emit(.failed(failure))
        }
    }

    // MARK: 最终回答与引用核对

    private func finalize(rawText: String, allocator: AgentEvidenceAllocator, request: AgentRunRequest,
                          steps: Int, usage: AgentContextUsage,
                          finishReason: AgentFinishReason) async -> (result: AgentRunResult, warnings: [AgentWarning])? {
        let raw = rawText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !raw.isEmpty else { return nil }
        var answer = raw
        var citations: [QuestionEvidence] = []
        var warnings: [AgentWarning] = []
        var notes: [String] = []
        var dropped = 0

        if let payload = AgentAnswerFormat.payload(from: raw) {
            answer = payload.answer.trimmingCharacters(in: .whitespacesAndNewlines)
            let evidence = await allocator.all()
            let byID = Dictionary(uniqueKeysWithValues: evidence.map { ($0.id, $0) })
            var seen = Set<String>()
            var candidates: [QuestionEvidence] = []
            for reference in payload.citations {
                guard let value = byID[reference.id], seen.insert(reference.id).inserted else {
                    dropped += 1
                    continue
                }
                let quote = Self.normalizeWhitespace(reference.quote)
                guard Self.citationQuoteMatches(quote, evidence: value) else {
                    dropped += 1
                    continue
                }
                candidates.append(value)
            }
            var verified: Set<Int>?
            if let verifier {
                verified = await verifier.verifiedIndices(in: candidates)
            }
            for (offset, value) in candidates.enumerated() {
                if let verified, !verified.contains(offset) {
                    dropped += 1
                    continue
                }
                citations.append(value)
            }
            if dropped > 0 {
                notes.append("部分出处未通过本次原文核验，未显示为有效引用。")
                warnings.append(AgentWarning(code: .invalidCitations, message: "部分出处未通过本次原文核验，未显示为有效引用。"))
            }
            if citations.isEmpty, payload.citations.isEmpty {
                notes.append("未提供可核查的书内依据；一般解释与推断不等于本书结论。")
            }
            if !citations.isEmpty, verifier == nil {
                notes.append("未配置书内索引核对，引用只与工具返回的原文做了文本比对。")
            } else if !citations.isEmpty, verified == nil {
                notes.append("书内索引暂时不可用，引用只做了文本比对。")
            }
        } else {
            notes.append("回答未提供可核查格式；未显示有效书内引用。")
        }

        guard !answer.isEmpty else { return nil }
        if answer.count > configuration.maxAnswerCharacters {
            answer = String(answer.prefix(configuration.maxAnswerCharacters)) + "…"
            let warning = AgentWarning(code: .answerTruncated, message: "回答过长，已截断显示。")
            warnings.append(warning)
            notes.append(warning.message)
        }
        let result = AgentRunResult(answer: answer, citations: citations,
                                    warning: notes.joined(separator: " "), steps: steps,
                                    citationsDropped: dropped, context: usage, finishedAt: Date())
        return (result, warnings)
    }

    static func normalizeWhitespace(_ text: String) -> String {
        text.split(whereSeparator: \.isWhitespace).joined(separator: " ")
    }

    /// 引用 quote 是否能在已登记的工具原文里逐字定位。
    /// PDF 页级原文来自 PDFKit 抽取，标点/换行处会插入或丢失空白（如「， 也」），
    /// 因此 PDF 证据额外允许「去掉空白后仍逐字连续」；EPUB 仍只接受原有逐字比对。
    static func citationQuoteMatches(_ normalizedQuote: String, evidence: QuestionEvidence) -> Bool {
        guard !normalizedQuote.isEmpty else { return false }
        if normalizeWhitespace(evidence.quote).contains(normalizedQuote) { return true }
        guard evidence.pdfPage != nil else { return false }
        let stripped = strippingWhitespace(normalizedQuote)
        guard !stripped.isEmpty else { return false }
        return strippingWhitespace(evidence.quote).contains(stripped)
    }

    private static func strippingWhitespace(_ text: String) -> String {
        String(text.filter { character in
            if character.isWhitespace { return false }
            return character != "\u{00AD}" && character != "\u{200B}" && character != "\u{FEFF}"
        })
    }

    /// 上次运行在工具执行中途取消时，历史里可能有 assistant tool_calls 缺少结果；
    /// 补齐错误结果，避免 provider 直接 400。
    static func repairedHistory(_ messages: [AgentMessage]) -> [AgentMessage] {
        var result: [AgentMessage] = []
        var index = 0
        while index < messages.count {
            let message = messages[index]
            result.append(message)
            guard message.role == .assistant, !message.toolCalls.isEmpty else {
                index += 1
                continue
            }
            var cursor = index + 1
            var following: [AgentMessage] = []
            while cursor < messages.count, messages[cursor].role == .tool {
                following.append(messages[cursor])
                cursor += 1
            }
            result.append(contentsOf: following)
            let answered = Set(following.compactMap(\.toolCallID))
            for call in message.toolCalls where !answered.contains(call.id) {
                result.append(.tool(call, content: AgentPrompts.toolResultError("上次运行中断，工具未执行"), isError: true))
            }
            index = cursor
        }
        return result
    }
}

// MARK: - 书内运行时组装

/// 把书内工具、模型适配器、上下文、检查点、引用核对组装成可直接给 UI 使用的运行时。
/// UI 只需持有 BookAgentEnvironment（只读快照）与 AIConfiguration/key，不需要自己拼协议。
struct AgentBookRuntime: Sendable {
    let environment: BookAgentEnvironment
    let executor: AgentExecutor
    let checkpoints: AgentCheckpointStore
    let summaries: AgentContextSummaryStore

    static func make(book: Book, index: BookIndex,
                     configuration: AIConfiguration, key: String,
                     checkpointRoot: URL,
                     currentLocation: Locator? = nil, progress: String? = nil,
                     runtimeConfiguration: AgentRuntimeConfiguration = AgentRuntimeConfiguration(),
                     contextBudget: AgentContextBudget? = nil,
                     externalTools: [any AgentTool] = []) -> AgentBookRuntime {
        make(environment: BookAgentEnvironment.make(book: book, index: index,
                                                    currentLocation: currentLocation, progress: progress),
             index: index, configuration: configuration, key: key,
             checkpointRoot: checkpointRoot, runtimeConfiguration: runtimeConfiguration,
             contextBudget: contextBudget, externalTools: externalTools)
    }

    static func make(environment: BookAgentEnvironment, index: BookIndex,
                     configuration: AIConfiguration, key: String,
                     checkpointRoot: URL,
                     runtimeConfiguration: AgentRuntimeConfiguration = AgentRuntimeConfiguration(),
                     contextBudget: AgentContextBudget? = nil,
                     externalTools: [any AgentTool] = []) -> AgentBookRuntime {
        let model: any AgentChatModel
        switch configuration.format {
        case .openAI: model = AgentOpenAIChatModel(configuration: configuration, key: key)
        case .anthropic: model = AgentAnthropicChatModel(configuration: configuration, key: key)
        }
        // 书内只读工具始终启用；外部工具由宿主显式传入（已过用户白名单/确认），默认空。
        let tools = AgentToolRegistry(BookAgentTools.make(environment: environment) + externalTools)
        // 预算按真实模型窗口动态计算（旧调用方也可显式传入覆盖）。
        let budget = contextBudget ?? AgentContextBudget(
            contextWindow: configuration.effectiveContextWindow,
            outputReserveTokens: runtimeConfiguration.modelOptions.maxTokens)
        let summarizer = AgentModelHistorySummarizer(
            model: model,
            maxCharacters: budget.summaryTargetCharacters,
            options: AgentModelOptions(maxTokens: min(budget.summaryTargetCharacters, AgentContextBudget.defaultSummaryCharacters),
                                       timeout: 45))
        let summaries = AgentContextSummaryStore(root: checkpointRoot)
        let context = AgentContextManager(budget: budget, summarizer: summarizer, summaries: summaries)
        let store = AgentCheckpointStore(root: checkpointRoot)
        let verifier = BookIndexCitationVerifier(index: index, bookID: environment.bookID)
        let executor = AgentExecutor(model: model, tools: tools, context: context,
                                     checkpoints: store, verifier: verifier,
                                     configuration: runtimeConfiguration)
        return AgentBookRuntime(environment: environment, executor: executor, checkpoints: store,
                                summaries: summaries)
    }

    /// iOS 17+ 宿主可用：先发现已启用的外部 MCP 工具，再组装运行时。
    /// 外部工具失败只会少几项工具，不影响书内问答。
    @available(iOS 17.0, *)
    static func make(book: Book, index: BookIndex,
                     configuration: AIConfiguration, key: String,
                     checkpointRoot: URL,
                     currentLocation: Locator? = nil, progress: String? = nil,
                     runtimeConfiguration: AgentRuntimeConfiguration = AgentRuntimeConfiguration(),
                     contextBudget: AgentContextBudget? = nil,
                     mcpServers: [MCPServerConfiguration],
                     mcpManager: MCPClientManager = .shared) async -> AgentBookRuntime {
        let externalTools = await MCPAgentToolProvider.makeTools(servers: mcpServers, manager: mcpManager)
        return make(book: book, index: index, configuration: configuration, key: key,
                    checkpointRoot: checkpointRoot, currentLocation: currentLocation, progress: progress,
                    runtimeConfiguration: runtimeConfiguration, contextBudget: contextBudget,
                    externalTools: externalTools)
    }

    /// 新对话/追问：history 是已保存的对话消息，question 是本轮读者问题。
    func start(conversationID: UUID, question: String, history: [AgentMessage] = [],
               systemPrompt: String = "") -> AgentSession {
        executor.start(AgentRunRequest(conversationID: conversationID,
                                       bookID: environment.bookID,
                                       bookTitle: environment.bookTitle,
                                       systemPrompt: systemPrompt,
                                       messages: history + [.user(question)]))
    }

    /// 从检查点续跑（例如上次被系统中断）；question 为空时直接继续未完成的步骤。
    func resume(conversationID: UUID, question: String? = nil, systemPrompt: String = "") -> AgentSession? {
        guard let checkpoint = try? checkpoints.load(conversationID: conversationID) else { return nil }
        let messages = question.map { [AgentMessage.user($0)] } ?? []
        return executor.start(AgentRunRequest(conversationID: conversationID,
                                              bookID: environment.bookID,
                                              bookTitle: environment.bookTitle,
                                              systemPrompt: systemPrompt,
                                              messages: messages,
                                              checkpoint: checkpoint))
    }

    func loadCheckpoint(conversationID: UUID) -> AgentCheckpoint? {
        try? checkpoints.load(conversationID: conversationID)
    }

    /// 删除对话时清理持久摘要，避免旧摘要污染新对话。
    func deleteConversationSummary(conversationID: UUID) {
        summaries.delete(conversationID)
    }
}
