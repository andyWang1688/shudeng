import Foundation

// MARK: - 预算

/// 上下文预算（对应 DSH/Codex 的窗口触发式压缩）：
/// 只有估算用量达到阈值才压缩；低于阈值不做任何摘要/裁剪/摘要请求。
struct AgentContextBudget: Sendable, Equatable {
    /// 模型上下文窗口（tokens）。
    var contextWindow: Int
    /// 回复预留（模型 max_tokens），不参与压缩。
    var outputReserveTokens: Int
    /// 手机端安全余量（tokens）：8k–16k，避免贴着窗口上限跑。
    var headroomTokens: Int
    /// 压缩后保留近期的比例（约 16% 可用窗口）。
    var retainFraction: Double
    /// 单条工具结果裁剪上限（字符）。
    var maxToolResultCharacters: Int
    /// 摘要目标字数（放宽到约 2000，减少反复压缩）。
    var summaryTargetCharacters: Int
    /// 保留消息条数上限（防止短消息保留过多轮）。
    var recentMessagesToKeep: Int
    /// 显式阈值覆盖（旧配置/测试用）；nil 时按窗口动态计算。
    var thresholdOverride: Int?

    static let defaultSummaryCharacters = 2_000

    init(contextWindow: Int = AIConfiguration.defaultContextWindow,
         outputReserveTokens: Int = 4_096,
         headroomTokens: Int? = nil,
         retainFraction: Double = 0.16,
         maxToolResultCharacters: Int = 4_000,
         summaryTargetCharacters: Int = AgentContextBudget.defaultSummaryCharacters,
         recentMessagesToKeep: Int = 12,
         thresholdOverride: Int? = nil) {
        let window = max(2_000, contextWindow)
        self.contextWindow = window
        self.outputReserveTokens = max(0, outputReserveTokens)
        self.headroomTokens = headroomTokens ?? Self.defaultHeadroom(for: window)
        self.retainFraction = min(max(retainFraction, 0.02), 0.5)
        self.maxToolResultCharacters = max(200, maxToolResultCharacters)
        self.summaryTargetCharacters = max(100, summaryTargetCharacters)
        self.recentMessagesToKeep = max(1, recentMessagesToKeep)
        self.thresholdOverride = thresholdOverride
    }

    /// 兼容旧用法：显式阈值（窗口按阈值的 2 倍估算，保证保留区小于阈值）。
    init(maxContextTokens: Int, reserveForResponseTokens: Int = 0, maxToolResultCharacters: Int = 4_000,
         recentMessagesToKeep: Int = 8, summaryTargetCharacters: Int = 600) {
        self.init(contextWindow: max(4_000, maxContextTokens * 2),
                  outputReserveTokens: reserveForResponseTokens,
                  headroomTokens: 0,
                  maxToolResultCharacters: maxToolResultCharacters,
                  summaryTargetCharacters: summaryTargetCharacters,
                  recentMessagesToKeep: recentMessagesToKeep,
                  thresholdOverride: max(512, maxContextTokens - reserveForResponseTokens))
    }

    static let `default` = AgentContextBudget()

    /// 阈值 ≈ min(窗口*0.8, 窗口 - 输出预留 - headroom)。
    var thresholdTokens: Int {
        if let thresholdOverride { return max(1, thresholdOverride) }
        let byRatio = Int(Double(contextWindow) * 0.8)
        let byWindow = contextWindow - outputReserveTokens - headroomTokens
        return max(1_000, min(byRatio, byWindow))
    }

    /// 压缩后保留近期的 token 预算（约 16% 可用窗口）。
    var retainTokens: Int {
        max(256, Int(Double(max(1_000, contextWindow - outputReserveTokens)) * retainFraction))
    }

    static func defaultHeadroom(for window: Int) -> Int {
        min(16_000, max(8_000, window / 10))
    }
}

// MARK: - 用量快照

/// 本次整理的结论（UI 圆环/提示用）。
enum AgentContextActionKind: String, Codable, Sendable, Equatable {
    case none, compacted, pruned, trimmed
}

/// 上下文用量快照：真实窗口、阈值、分项明细与整理动作。
/// 旧 JSON（只有 estimatedTokens/characterCount/limitTokens/...）可解码，新字段回退默认值。
struct AgentContextUsage: Sendable, Equatable, Codable {
    /// 已用输入 tokens 估算（system + 摘要 + 历史 + 工具结果）。
    var estimatedTokens: Int
    var characterCount: Int
    /// 压缩阈值；保留旧字段名，与 thresholdTokens 同值。
    var limitTokens: Int
    /// 模型上下文窗口（tokens）。
    var contextWindow: Int
    var thresholdTokens: Int
    /// 已用占窗口比例（0...1）。
    var percent: Double
    /// 阈值占窗口比例（0...1）。
    var thresholdPercent: Double
    var systemTokens: Int
    var historyTokens: Int
    var toolTokens: Int
    var summaryTokens: Int
    var summarizedMessages: Int
    var trimmedMessages: Int
    var truncatedToolResults: Int
    var action: AgentContextActionKind

    init(estimatedTokens: Int = 0, characterCount: Int = 0, limitTokens: Int = 0,
         contextWindow: Int = 0, thresholdTokens: Int = 0, percent: Double = 0, thresholdPercent: Double = 0,
         systemTokens: Int = 0, historyTokens: Int = 0, toolTokens: Int = 0, summaryTokens: Int = 0,
         summarizedMessages: Int = 0, trimmedMessages: Int = 0, truncatedToolResults: Int = 0,
         action: AgentContextActionKind = .none) {
        self.estimatedTokens = estimatedTokens
        self.characterCount = characterCount
        self.limitTokens = limitTokens
        self.contextWindow = contextWindow
        self.thresholdTokens = thresholdTokens
        self.percent = percent
        self.thresholdPercent = thresholdPercent
        self.systemTokens = systemTokens
        self.historyTokens = historyTokens
        self.toolTokens = toolTokens
        self.summaryTokens = summaryTokens
        self.summarizedMessages = summarizedMessages
        self.trimmedMessages = trimmedMessages
        self.truncatedToolResults = truncatedToolResults
        self.action = action
    }

    /// 旧字段语义：阈值占用率（0...1）。
    var utilization: Double {
        limitTokens > 0 ? min(1, Double(estimatedTokens) / Double(limitTokens)) : 0
    }

    private enum CodingKeys: String, CodingKey {
        case estimatedTokens, characterCount, limitTokens, contextWindow, thresholdTokens, percent, thresholdPercent
        case systemTokens, historyTokens, toolTokens, summaryTokens
        case summarizedMessages, trimmedMessages, truncatedToolResults, action
    }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        estimatedTokens = try values.decodeIfPresent(Int.self, forKey: .estimatedTokens) ?? 0
        characterCount = try values.decodeIfPresent(Int.self, forKey: .characterCount) ?? 0
        let limit = try values.decodeIfPresent(Int.self, forKey: .limitTokens) ?? 0
        limitTokens = limit
        contextWindow = try values.decodeIfPresent(Int.self, forKey: .contextWindow) ?? 0
        thresholdTokens = try values.decodeIfPresent(Int.self, forKey: .thresholdTokens) ?? limit
        let window = contextWindow
        percent = try values.decodeIfPresent(Double.self, forKey: .percent)
            ?? (window > 0 ? min(1, Double(estimatedTokens) / Double(window)) : 0)
        thresholdPercent = try values.decodeIfPresent(Double.self, forKey: .thresholdPercent)
            ?? (window > 0 ? min(1, Double(thresholdTokens) / Double(window)) : 0)
        systemTokens = try values.decodeIfPresent(Int.self, forKey: .systemTokens) ?? 0
        historyTokens = try values.decodeIfPresent(Int.self, forKey: .historyTokens) ?? 0
        toolTokens = try values.decodeIfPresent(Int.self, forKey: .toolTokens) ?? 0
        summaryTokens = try values.decodeIfPresent(Int.self, forKey: .summaryTokens) ?? 0
        summarizedMessages = try values.decodeIfPresent(Int.self, forKey: .summarizedMessages) ?? 0
        trimmedMessages = try values.decodeIfPresent(Int.self, forKey: .trimmedMessages) ?? 0
        truncatedToolResults = try values.decodeIfPresent(Int.self, forKey: .truncatedToolResults) ?? 0
        action = try values.decodeIfPresent(AgentContextActionKind.self, forKey: .action) ?? .none
    }

    func encode(to encoder: Encoder) throws {
        var values = encoder.container(keyedBy: CodingKeys.self)
        try values.encode(estimatedTokens, forKey: .estimatedTokens)
        try values.encode(characterCount, forKey: .characterCount)
        try values.encode(limitTokens, forKey: .limitTokens)
        try values.encode(contextWindow, forKey: .contextWindow)
        try values.encode(thresholdTokens, forKey: .thresholdTokens)
        try values.encode(percent, forKey: .percent)
        try values.encode(thresholdPercent, forKey: .thresholdPercent)
        try values.encode(systemTokens, forKey: .systemTokens)
        try values.encode(historyTokens, forKey: .historyTokens)
        try values.encode(toolTokens, forKey: .toolTokens)
        try values.encode(summaryTokens, forKey: .summaryTokens)
        try values.encode(summarizedMessages, forKey: .summarizedMessages)
        try values.encode(trimmedMessages, forKey: .trimmedMessages)
        try values.encode(truncatedToolResults, forKey: .truncatedToolResults)
        try values.encode(action, forKey: .action)
    }
}

enum AgentContextAction: Sendable, Equatable, Codable {
    case summarized(removedMessages: Int)
    case trimmedHistory(removedMessages: Int)
    case truncatedToolResults(count: Int)
    case withinBudget
    case overBudget(requiredTokens: Int)
}

struct AgentContextSnapshot: Sendable, Equatable {
    let usage: AgentContextUsage
    let actions: [AgentContextAction]
}

struct AgentContextPlan: Sendable {
    let messages: [AgentMessage]
    let usage: AgentContextUsage
    let actions: [AgentContextAction]
    /// 本轮压缩产出的持久摘要引用；nil 表示没有摘要。
    let summaryReference: AgentContextSummaryReference?

    var overBudget: Bool {
        actions.contains {
            if case .overBudget = $0 { return true }
            return false
        }
    }
}

// MARK: - 估算

/// 字符 → token 的启发式估算：中日韩文字约 1 token/字，其余非空白约 4 字符/token，
/// 每条消息与每次工具调用另加固定开销。只用于预算决策，不用于计费。
struct AgentTokenEstimator: Sendable {
    func estimate(_ text: String) -> Int {
        var cjk = 0
        var other = 0
        for scalar in text.unicodeScalars {
            if CharacterSet.whitespacesAndNewlines.contains(scalar) { continue }
            let value = scalar.value
            if (0x4E00...0x9FFF).contains(value) || (0x3400...0x4DBF).contains(value)
                || (0x3000...0x303F).contains(value) || (0xFF00...0xFFEF).contains(value) {
                cjk += 1
            } else {
                other += 1
            }
        }
        return cjk + (other + 3) / 4
    }

    func estimate(_ messages: [AgentMessage]) -> Int {
        messages.reduce(0) { $0 + estimate($1) }
    }

    func estimate(_ message: AgentMessage) -> Int {
        4 + estimate(message.content) + estimate(message.reasoningContent ?? "")
            + message.toolCalls.reduce(0) { $0 + 4 + estimate($1.name) + estimate($1.argumentsJSON) }
    }
}

// MARK: - 上下文管理

/// 上下文管理（对应 LangChain BaseMemory + DSH/Codex 的窗口触发压缩）：
/// 低于阈值：原样发送，不摘要不裁剪；达到阈值：裁工具结果 → 摘要旧历史（保留近期）
/// → 再评估；摘要失败降级裁剪；仍超预算重试一次（裁剪最旧轮次）后明确失败。
/// 摘要按 conversationID 持久化，下一轮作为 system 前缀继续使用。
final class AgentContextManager: Sendable {
    let budget: AgentContextBudget
    let estimator: AgentTokenEstimator
    private let summarizer: (any AgentHistorySummarizer)?
    private let summaries: AgentContextSummaryStore?

    init(budget: AgentContextBudget = .default,
         summarizer: (any AgentHistorySummarizer)? = nil,
         summaries: AgentContextSummaryStore? = nil,
         estimator: AgentTokenEstimator = AgentTokenEstimator()) {
        self.budget = budget
        self.summarizer = summarizer
        self.summaries = summaries
        self.estimator = estimator
    }

    func prepare(conversationID: UUID = UUID(), systemPrompt: String,
                 messages: [AgentMessage]) async -> AgentContextPlan {
        let stored = summaries?.load(conversationID)
        var summaryText = stored?.text
        var summarizedTotal = stored?.summarizedMessages ?? 0
        var summaryReference = stored.map { AgentContextSummaryReference($0) }
        // 已摘要的历史前缀不再重复发送；system 提示与摘要前缀永远保留。
        var working = summarizedTotal > 0 ? Self.droppingPrefix(messages, messageCount: summarizedTotal) : messages
        var summarized = 0
        var trimmed = 0
        var truncatedTools = 0

        func snapshot(_ action: AgentContextActionKind) -> AgentContextUsage {
            Self.usage(systemPrompt: systemPrompt, summaryText: summaryText, messages: working,
                       budget: budget, estimator: estimator,
                       summarized: summarized, trimmed: trimmed, truncatedTools: truncatedTools,
                       action: action)
        }

        func assemble(_ action: AgentContextActionKind, actions: [AgentContextAction]) -> AgentContextPlan {
            var result: [AgentMessage] = [.system(systemPrompt)]
            if let summaryText, !summaryText.isEmpty {
                result.append(.system(AgentPrompts.contextSummaryPrefix + summaryText))
            }
            result.append(contentsOf: working)
            return AgentContextPlan(messages: result, usage: snapshot(action),
                                    actions: actions, summaryReference: summaryReference)
        }

        var actions: [AgentContextAction] = []
        var actionKind: AgentContextActionKind = .none
        var current = snapshot(.none)
        let threshold = budget.thresholdTokens

        // 低于阈值：不压缩、不摘要（每步都摘要既贵又会削弱近期上下文）。
        guard current.estimatedTokens > threshold else {
            actions.append(.withinBudget)
            return assemble(.none, actions: actions)
        }

        // 1) 先裁剪超大工具结果。
        var prunedCount = 0
        working = working.map { message in
            guard message.role == .tool, message.content.count > budget.maxToolResultCharacters else { return message }
            var copy = message
            copy.content = String(message.content.prefix(budget.maxToolResultCharacters)) + AgentPrompts.toolResultTrimmedSuffix
            prunedCount += 1
            return copy
        }
        if prunedCount > 0 {
            truncatedTools += prunedCount
            actions.append(.truncatedToolResults(count: prunedCount))
            actionKind = .pruned
            current = snapshot(.pruned)
            if current.estimatedTokens <= threshold {
                actions.append(.withinBudget)
                return assemble(.pruned, actions: actions)
            }
        }

        // 2) 摘要最旧的安全边界历史，保留近期（约 16% 可用窗口）。
        let groups = Self.turns(working)
        let (oldGroups, recentGroups) = split(groups: groups)
        if !oldGroups.isEmpty {
            let oldMessages = oldGroups.flatMap { $0 }
            var summary: String?
            if let summarizer {
                summary = try? await summarizer.summarize(oldMessages)
            }
            let text = (summary ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            if !text.isEmpty {
                summaryText = String(text.prefix(budget.summaryTargetCharacters))
                summarized += oldMessages.count
                summarizedTotal += oldMessages.count
                working = recentGroups.flatMap { $0 }
                actions.append(.summarized(removedMessages: oldMessages.count))
                actionKind = .compacted
                let record = AgentContextSummary(conversationID: conversationID,
                                                 text: summaryText ?? "",
                                                 summarizedMessages: summarizedTotal,
                                                 updatedAt: Date())
                try? summaries?.save(record)
                summaryReference = AgentContextSummaryReference(record)
                current = snapshot(.compacted)
                if current.estimatedTokens <= threshold {
                    actions.append(.withinBudget)
                    return assemble(.compacted, actions: actions)
                }
            } else {
                // 3) 摘要失败：降级为裁剪旧历史。
                trimmed += oldMessages.count
                working = recentGroups.flatMap { $0 }
                actions.append(.trimmedHistory(removedMessages: oldMessages.count))
                actionKind = .trimmed
                current = snapshot(.trimmed)
                if current.estimatedTokens <= threshold {
                    actions.append(.withinBudget)
                    return assemble(.trimmed, actions: actions)
                }
            }
        }

        // 4) 仍超预算：重试一次（继续裁剪最旧轮次，至少保留最后一轮）。
        var remainingGroups = Self.turns(working)
        var retryTrimmed = 0
        while current.estimatedTokens > threshold, remainingGroups.count > 1 {
            let removed = remainingGroups.removeFirst()
            retryTrimmed += removed.count
            working = remainingGroups.flatMap { $0 }
            current = snapshot(.trimmed)
        }
        if retryTrimmed > 0 {
            trimmed += retryTrimmed
            actions.append(.trimmedHistory(removedMessages: retryTrimmed))
            actionKind = .trimmed
            current = snapshot(.trimmed)
        }

        if current.estimatedTokens > threshold {
            actions.append(.overBudget(requiredTokens: current.estimatedTokens))
        } else {
            actions.append(.withinBudget)
        }
        return assemble(actionKind, actions: actions)
    }

    // MARK: 分组与保留

    /// 把消息按「一轮」分组：assistant 的工具调用与其后的工具结果不可拆开。
    static func turns(_ messages: [AgentMessage]) -> [[AgentMessage]] {
        var groups: [[AgentMessage]] = []
        for message in messages {
            if message.role == .tool, let last = groups.last?.last,
               last.role == .assistant || last.role == .tool {
                groups[groups.count - 1].append(message)
                continue
            }
            groups.append([message])
        }
        return groups
    }

    /// 从历史前缀跳过已摘要的旧消息（按整轮跳，避免拆开 tool_calls 与结果）。
    static func droppingPrefix(_ messages: [AgentMessage], messageCount: Int) -> [AgentMessage] {
        guard messageCount > 0 else { return messages }
        var dropped = 0
        var remaining: [[AgentMessage]] = []
        for group in turns(messages) {
            if dropped < messageCount {
                dropped += group.count
            } else {
                remaining.append(group)
            }
        }
        let kept = remaining.flatMap { $0 }
        // 极端情况（摘要记录比历史还多）：至少保留最后一轮，避免整段历史消失。
        if kept.isEmpty, let last = turns(messages).last { return last }
        return kept
    }

    private func split(groups: [[AgentMessage]]) -> (old: [[AgentMessage]], recent: [[AgentMessage]]) {
        guard groups.count > 1 else { return ([], groups) }
        var recent: [[AgentMessage]] = []
        var tokens = 0
        var count = 0
        for group in groups.reversed() {
            let groupTokens = group.reduce(0) { $0 + estimator.estimate($1) }
            let canKeep = recent.isEmpty
                || (tokens + groupTokens <= budget.retainTokens && count + group.count <= budget.recentMessagesToKeep)
            guard canKeep else { break }
            recent.append(group)
            tokens += groupTokens
            count += group.count
        }
        let keptGroups = recent.reversed().map { $0 }
        return (Array(groups.prefix(groups.count - keptGroups.count)), keptGroups)
    }

    // MARK: 用量

    static func usage(systemPrompt: String, summaryText: String?, messages: [AgentMessage],
                      budget: AgentContextBudget, estimator: AgentTokenEstimator,
                      summarized: Int, trimmed: Int, truncatedTools: Int,
                      action: AgentContextActionKind) -> AgentContextUsage {
        let systemTokens = estimator.estimate(systemPrompt)
        let summaryTokens = summaryText.map { estimator.estimate(AgentPrompts.contextSummaryPrefix + $0) } ?? 0
        var historyTokens = 0
        var toolTokens = 0
        var characters = systemPrompt.count + (summaryText?.count ?? 0)
        for message in messages {
            characters += message.content.count + (message.reasoningContent?.count ?? 0)
                + message.toolCalls.reduce(0) { $0 + $1.argumentsJSON.count }
            switch message.role {
            case .tool: toolTokens += estimator.estimate(message)
            case .system, .user, .assistant: historyTokens += estimator.estimate(message)
            }
        }
        let estimated = systemTokens + summaryTokens + historyTokens + toolTokens
        let window = budget.contextWindow
        let threshold = budget.thresholdTokens
        return AgentContextUsage(
            estimatedTokens: estimated,
            characterCount: characters,
            limitTokens: threshold,
            contextWindow: window,
            thresholdTokens: threshold,
            percent: window > 0 ? min(1, Double(estimated) / Double(window)) : 0,
            thresholdPercent: window > 0 ? min(1, Double(threshold) / Double(window)) : 0,
            systemTokens: systemTokens,
            historyTokens: historyTokens,
            toolTokens: toolTokens,
            summaryTokens: summaryTokens,
            summarizedMessages: summarized,
            trimmedMessages: trimmed,
            truncatedToolResults: truncatedTools,
            action: action)
    }
}
