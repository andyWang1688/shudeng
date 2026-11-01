import XCTest
import Foundation
import UIKit
import PDFKit
import ReadiumShared
@testable import Shudeng

// MARK: - 共享测试替身

private enum AgentTestError: Error {
    case summary
}

private func agentTemporaryRoot(_ label: String) -> URL {
    FileManager.default.temporaryDirectory.appendingPathComponent("shudeng-agent-\(label)-" + UUID().uuidString)
}

private func agentLocatorJSON(quote: String, title: String = "第一章", href: String = "chapter.xhtml") -> String {
    Locator(href: AnyURL(string: href)!, mediaType: .xhtml, title: title,
            text: .init(highlight: quote)).description
}

private func agentExcerpt(_ quote: String, title: String = "第一章", page: Int? = nil) -> AgentBookExcerpt {
    AgentBookExcerpt(excerpt: quote, quote: quote, title: title, page: page,
                     locatorJSON: agentLocatorJSON(quote: quote, title: title))
}

private struct StubBookSource: AgentBookSource {
    var searchResults: [AgentBookExcerpt] = []
    var pages: [Int: AgentBookPassage] = [:]
    var chapters: [String: AgentBookPassage] = [:]
    var toc: [AgentBookTOCEntry] = []
    var chapterEntries: [AgentBookTOCEntry] = []

    func search(_ query: String, limit: Int) async throws -> [AgentBookExcerpt] {
        Array(searchResults.prefix(limit))
    }
    func page(_ page: Int, maxCharacters: Int) async throws -> AgentBookPassage? { pages[page] }
    func chapter(_ reference: String, maxCharacters: Int) async throws -> AgentBookPassage? { chapters[reference] }
    func tableOfContents() async throws -> [AgentBookTOCEntry] { toc }
    func chapterList() async throws -> [AgentBookTOCEntry] { chapterEntries }
}

private enum AgentTestEnvironment {
    static func make(_ source: StubBookSource) -> BookAgentEnvironment {
        BookAgentEnvironment(
            bookID: "book-1",
            bookTitle: "测试书",
            source: source,
            notes: [AgentBookNote(quote: "笔记引文", body: "我的想法", chapter: "第一章", page: nil)],
            currentLocation: AgentCurrentLocation(title: "第一章", page: nil, quote: "当前位置选文", progress: "12%")
        )
    }
}

/// 按脚本逐次返回模型事件；记录每次请求的 messages/tools 供断言。
private final class ScriptedChatModel: AgentChatModel, @unchecked Sendable {
    private let lock = NSLock()
    private var script: [[AgentModelEvent]]
    private var error: Error?
    private(set) var requests: [[AgentMessage]] = []
    private(set) var toolSpecs: [[AgentToolSpec]] = []

    init(_ script: [[AgentModelEvent]]) { self.script = script }
    var modelIdentifier: String { "stub-model" }

    func failNextCall(with error: Error) {
        lock.lock(); self.error = error; lock.unlock()
    }

    func stream(messages: [AgentMessage], tools: [AgentToolSpec], options: AgentModelOptions)
        -> AsyncThrowingStream<AgentModelEvent, Error> {
        lock.lock()
        requests.append(messages)
        toolSpecs.append(tools)
        let pendingError = error
        error = nil
        let events = script.isEmpty ? [AgentModelEvent.finished(.stop)] : script.removeFirst()
        lock.unlock()
        if let pendingError {
            return AsyncThrowingStream { continuation in continuation.finish(throwing: pendingError) }
        }
        return AsyncThrowingStream { continuation in
            for event in events { continuation.yield(event) }
            continuation.finish()
        }
    }
}

/// 输出一段文字后一直等待，用于验证取消能中断流式请求。
private final class BlockingChatModel: AgentChatModel, @unchecked Sendable {
    var modelIdentifier: String { "blocking-model" }
    func stream(messages: [AgentMessage], tools: [AgentToolSpec], options: AgentModelOptions)
        -> AsyncThrowingStream<AgentModelEvent, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                continuation.yield(.textDelta("思考中"))
                do {
                    try await Task.sleep(nanoseconds: 30_000_000_000)
                } catch {
                    continuation.finish(throwing: CancellationError())
                    return
                }
                continuation.yield(.finished(.stop))
                continuation.finish()
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }
}

private struct AcceptAllVerifier: AgentCitationVerifier {
    func verifiedIndices(in evidence: [QuestionEvidence]) async -> Set<Int>? { Set(evidence.indices) }
}

private struct QuoteFilterVerifier: AgentCitationVerifier {
    let required: String
    func verifiedIndices(in evidence: [QuestionEvidence]) async -> Set<Int>? {
        Set(evidence.indices.filter { evidence[$0].quote.contains(required) })
    }
}

private struct FixedSummarizer: AgentHistorySummarizer {
    let text: String
    func summarize(_ messages: [AgentMessage]) async throws -> String { text }
}

private struct FailingSummarizer: AgentHistorySummarizer {
    func summarize(_ messages: [AgentMessage]) async throws -> String { throw AgentTestError.summary }
}

private func agentCompleted(_ events: [AgentEvent]) -> AgentRunResult? {
    for event in events { if case .completed(let result) = event { return result } }
    return nil
}

private func agentFailed(_ events: [AgentEvent]) -> AgentFailure? {
    for event in events { if case .failed(let failure) = event { return failure } }
    return nil
}

private func agentWarnings(_ events: [AgentEvent]) -> [AgentWarning] {
    events.compactMap { event in
        if case .warning(let warning) = event { return warning }
        return nil
    }
}

private func collectEvents(_ session: AgentSession) async -> [AgentEvent] {
    var events: [AgentEvent] = []
    for await event in session.events { events.append(event) }
    await session.wait()
    return events
}

private func makeExecutor(model: any AgentChatModel, source: StubBookSource, root: URL,
                          verifier: (any AgentCitationVerifier)? = AcceptAllVerifier(),
                          configuration: AgentRuntimeConfiguration = AgentRuntimeConfiguration(),
                          budget: AgentContextBudget = .default,
                          summarizer: (any AgentHistorySummarizer)? = nil,
                          summaries: AgentContextSummaryStore? = nil) -> AgentExecutor {
    let tools = AgentToolRegistry(BookAgentTools.make(environment: AgentTestEnvironment.make(source)))
    let context = AgentContextManager(budget: budget, summarizer: summarizer, summaries: summaries)
    let store = AgentCheckpointStore(root: root)
    return AgentExecutor(model: model, tools: tools, context: context, checkpoints: store,
                         verifier: verifier, configuration: configuration)
}

// MARK: - Provider 流式解析

final class AgentProviderParsingTests: XCTestCase {
    func testOpenAISSEParsesTextAndStreamedToolArguments() throws {
        var parser = AgentSSEParser()
        let decoder = AgentOpenAIStreamDecoder()
        let lines = [
            #"data: {"choices":[{"delta":{"role":"assistant","content":"书里"}}]}"#,
            "",
            #"data: {"choices":[{"delta":{"content":"说"}}]}"#,
            "",
            #"data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"search_book","arguments":"{\"query\":"}}]}}]}"#,
            "",
            #"data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\"灯\"}"}}]}}]}"#,
            "",
            #"data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}"#,
            "",
            "data: [DONE]",
            "",
        ]
        var events: [AgentModelEvent] = []
        for line in lines {
            if let event = parser.consume(line: line) {
                events.append(contentsOf: try decoder.consume(event))
            }
        }
        events.append(contentsOf: try decoder.finish())
        XCTAssertEqual(events, [
            .textDelta("书里"),
            .textDelta("说"),
            .toolCall(AgentToolCall(id: "call_1", name: "search_book", argumentsJSON: #"{"query":"灯"}"#)),
            .finished(.toolCalls),
        ])
    }

    func testAnthropicSSEParsesContentBlocksAndToolUse() throws {
        let decoder = AgentAnthropicStreamDecoder()
        var parser = AgentSSEParser()
        let events: [(String, String)] = [
            ("content_block_start", #"{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}"#),
            ("content_block_delta", #"{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"书里"}}"#),
            ("content_block_stop", #"{"type":"content_block_stop","index":0}"#),
            ("content_block_start", #"{"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_1","name":"read_page","input":{}}}"#),
            ("content_block_delta", #"{"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\"page\":"}}"#),
            ("content_block_delta", #"{"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"2}"}}"#),
            ("content_block_stop", #"{"type":"content_block_stop","index":1}"#),
            ("message_delta", #"{"type":"message_delta","delta":{"stop_reason":"tool_use"}}"#),
            ("message_stop", #"{"type":"message_stop"}"#),
        ]
        var parsed: [AgentModelEvent] = []
        for (name, data) in events {
            _ = parser.consume(line: "event: \(name)")
            let dataLine = parser.consume(line: "data: \(data)")
            if let dataLine { parsed.append(contentsOf: try decoder.consume(dataLine)) }
            if let dispatch = parser.consume(line: "") {
                parsed.append(contentsOf: try decoder.consume(dispatch))
            }
        }
        parsed.append(contentsOf: try decoder.finish())
        XCTAssertEqual(parsed, [
            .textDelta("书里"),
            .toolCall(AgentToolCall(id: "toolu_1", name: "read_page", argumentsJSON: #"{"page":2}"#)),
            .finished(.toolCalls),
        ])
    }

    func testSSEParserIgnoresCommentsAndJoinsMultilineData() {
        var parser = AgentSSEParser()
        let comment = parser.consume(line: ": keep-alive")
        XCTAssertNil(comment)
        let eventLine = parser.consume(line: "event: message")
        XCTAssertNil(eventLine)
        let firstData = parser.consume(line: "data: line1")
        XCTAssertNil(firstData)
        let secondData = parser.consume(line: "data: line2")
        XCTAssertNil(secondData)
        let dispatched = parser.consume(line: "")
        XCTAssertEqual(dispatched, AgentSSEEvent(event: "message", data: "line1\nline2"))
        let trailing = parser.consume(line: "")
        XCTAssertNil(trailing)
    }

    func testHTTPErrorsReuseAIErrorAndDetectMissingToolSupport() {
        func body(_ message: String, code: String? = nil) -> Data {
            var error: [String: Any] = ["message": message, "type": "invalid_request_error"]
            if let code { error["code"] = code }
            return (try? JSONSerialization.data(withJSONObject: ["error": error])) ?? Data()
        }
        XCTAssertEqual(
            AgentStreamErrorMapper.httpError(status: 400, body: body("tools is not supported for this model")) as? AgentModelError,
            .toolsUnsupported)
        XCTAssertEqual(
            AgentStreamErrorMapper.anthropicError(["type": "invalid_request_error", "message": "tools: Extra inputs are not permitted"]) as? AgentModelError,
            .toolsUnsupported)
        XCTAssertEqual(AgentStreamErrorMapper.httpError(status: 401, body: Data()) as? AIError, .authentication)
        XCTAssertEqual(AgentStreamErrorMapper.httpError(status: 403, body: Data()) as? AIError, .authentication)
        XCTAssertEqual(AgentStreamErrorMapper.httpError(status: 429, body: Data()) as? AIError, .limited)
        XCTAssertEqual(AgentStreamErrorMapper.httpError(status: 413, body: Data()) as? AIError, .capacity)
        XCTAssertEqual(AgentStreamErrorMapper.httpError(status: 500, body: Data()) as? AIError, .network)
        XCTAssertEqual(AgentStreamErrorMapper.httpError(status: 400, body: body("bad request")) as? AIError, .incompatible)
        XCTAssertEqual(
            AgentStreamErrorMapper.httpError(status: 400, body: body("prompt is too long", code: "context_length_exceeded")) as? AIError,
            .capacity)
        XCTAssertEqual(AgentStreamErrorMapper.urlError(URLError(.timedOut)) as? AgentModelError, .timeout)
        XCTAssertTrue(AgentStreamErrorMapper.urlError(URLError(.cancelled)) is CancellationError)
    }

    func testOpenAIEncoderKeepsAssistantToolCallsAndToolResults() throws {
        let spec = AgentToolSpec(name: "search_book", description: "搜索", inputSchemaJSON: #"{"type":"object"}"#)
        let call = AgentToolCall(id: "call_1", name: "search_book", argumentsJSON: #"{"query":"灯"}"#)
        let messages: [AgentMessage] = [
            .system("规则"),
            .user("问题"),
            .assistant("我查一下", toolCalls: [call]),
            .tool(call, content: "[E1] 原文"),
        ]
        let body = try AgentOpenAIRequestEncoder.body(messages: messages, tools: [spec],
                                                     options: AgentModelOptions(maxTokens: 100), model: "m")
        XCTAssertEqual(body["stream"] as? Bool, true)
        let rows = try XCTUnwrap(body["messages"] as? [[String: Any]])
        XCTAssertEqual(rows.count, 4)
        XCTAssertEqual(rows[0]["role"] as? String, "system")
        let calls = try XCTUnwrap(rows[2]["tool_calls"] as? [[String: Any]])
        XCTAssertEqual(calls.first?["id"] as? String, "call_1")
        XCTAssertEqual((calls.first?["function"] as? [String: Any])?["name"] as? String, "search_book")
        XCTAssertEqual(rows[3]["role"] as? String, "tool")
        XCTAssertEqual(rows[3]["tool_call_id"] as? String, "call_1")
        let tools = try XCTUnwrap(body["tools"] as? [[String: Any]])
        XCTAssertEqual((tools.first?["function"] as? [String: Any])?["name"] as? String, "search_book")
    }

    func testAnthropicEncoderMergesSystemAndToolResults() throws {
        let spec = AgentToolSpec(name: "read_page", description: "读页", inputSchemaJSON: #"{"type":"object"}"#)
        let first = AgentToolCall(id: "call_1", name: "read_page", argumentsJSON: #"{"page":1}"#)
        let second = AgentToolCall(id: "call_2", name: "read_page", argumentsJSON: #"{"page":2}"#)
        let messages: [AgentMessage] = [
            .system("规则A"),
            .system("规则B"),
            .assistant("", toolCalls: [first, second]),
            .tool(first, content: "第一页"),
            .tool(second, content: "第二页", isError: true),
        ]
        let body = try AgentAnthropicRequestEncoder.body(messages: messages, tools: [spec],
                                                        options: AgentModelOptions(maxTokens: 100), model: "m")
        XCTAssertEqual(body["system"] as? String, "规则A\n\n规则B")
        let rows = try XCTUnwrap(body["messages"] as? [[String: Any]])
        // 历史以 assistant 开头时补一条 user「继续。」，满足 Anthropic 的角色交替要求。
        XCTAssertEqual(rows.count, 3)
        XCTAssertEqual(rows[0]["role"] as? String, "user")
        XCTAssertEqual(rows[1]["role"] as? String, "assistant")
        let blocks = try XCTUnwrap(rows[1]["content"] as? [[String: Any]])
        XCTAssertEqual(blocks.count, 2)
        XCTAssertEqual(blocks[0]["type"] as? String, "tool_use")
        XCTAssertEqual((blocks[0]["input"] as? [String: Any])?["page"] as? Int, 1)
        XCTAssertEqual(rows[2]["role"] as? String, "user")
        let results = try XCTUnwrap(rows[2]["content"] as? [[String: Any]])
        XCTAssertEqual(results.count, 2)
        XCTAssertEqual(results[0]["tool_use_id"] as? String, "call_1")
        XCTAssertEqual(results[1]["is_error"] as? Bool, true)
        let tools = try XCTUnwrap(body["tools"] as? [[String: Any]])
        XCTAssertEqual(tools.first?["name"] as? String, "read_page")
        XCTAssertNotNil(tools.first?["input_schema"])
    }
}

// MARK: - 上下文管理

final class AgentContextManagerTests: XCTestCase {
    func testTokenEstimateDistinguishesCJKAndLatin() {
        let estimator = AgentTokenEstimator()
        XCTAssertEqual(estimator.estimate("你好世界"), 4)
        XCTAssertEqual(estimator.estimate("abcd"), 1)
        XCTAssertEqual(estimator.estimate(""), 0)
        XCTAssertEqual(estimator.estimate([AgentMessage.user("你好")]), 6)
    }

    func testOlderTurnsAreSummarizedWithModelSummary() async {
        var messages: [AgentMessage] = []
        for _ in 0..<6 {
            messages.append(.user(String(repeating: "问题", count: 100)))
            messages.append(.assistant(String(repeating: "回答", count: 100)))
        }
        let budget = AgentContextBudget(maxContextTokens: 1400, reserveForResponseTokens: 100,
                                        recentMessagesToKeep: 4, summaryTargetCharacters: 100)
        let manager = AgentContextManager(budget: budget, summarizer: FixedSummarizer(text: "历史摘要"))
        let plan = await manager.prepare(systemPrompt: "规则", messages: messages)
        XCTAssertGreaterThan(plan.usage.summarizedMessages, 0)
        XCTAssertEqual(plan.messages.first?.role, .system)
        XCTAssertTrue(plan.messages.first?.content.contains("规则") == true, "固定 system 提示必须在最前且不被摘要遮蔽")
        XCTAssertTrue(plan.messages.contains { $0.role == .system && $0.content.contains("历史摘要") })
        XCTAssertTrue(plan.actions.contains { if case .summarized = $0 { return true }; return false })
        XCTAssertFalse(plan.overBudget)
    }

    func testSummaryFailureFallsBackToTrimming() async {
        var messages: [AgentMessage] = []
        for _ in 0..<6 {
            messages.append(.user(String(repeating: "问题", count: 100)))
            messages.append(.assistant(String(repeating: "回答", count: 100)))
        }
        let budget = AgentContextBudget(maxContextTokens: 1400, reserveForResponseTokens: 100,
                                        recentMessagesToKeep: 4, summaryTargetCharacters: 100)
        let manager = AgentContextManager(budget: budget, summarizer: FailingSummarizer())
        let plan = await manager.prepare(systemPrompt: "规则", messages: messages)
        XCTAssertEqual(plan.usage.summarizedMessages, 0)
        XCTAssertGreaterThan(plan.usage.trimmedMessages, 0)
        XCTAssertTrue(plan.actions.contains { if case .trimmedHistory = $0 { return true }; return false })
        XCTAssertFalse(plan.overBudget)
    }

    func testOversizedToolResultsAreTruncatedWithMarker() async {
        var messages: [AgentMessage] = [.user("问题")]
        let call = AgentToolCall(id: "call_1", name: "read_page", argumentsJSON: "{}")
        messages.append(.assistant("", toolCalls: [call]))
        messages.append(.tool(call, content: String(repeating: "原", count: 5000)))
        // 达到阈值才会压缩：用显式小阈值（旧配置语义）触发。
        let budget = AgentContextBudget(maxContextTokens: 2_000, reserveForResponseTokens: 0,
                                        maxToolResultCharacters: 200)
        let manager = AgentContextManager(budget: budget)
        let plan = await manager.prepare(systemPrompt: "规则", messages: messages)
        XCTAssertEqual(plan.usage.truncatedToolResults, 1)
        XCTAssertEqual(plan.usage.action, .pruned)
        let toolMessage = try? XCTUnwrap(plan.messages.first { $0.role == .tool })
        XCTAssertTrue(toolMessage?.content.contains("裁剪") == true)
        XCTAssertLessThan(toolMessage?.content.count ?? .max, 500)
    }

    func testSingleOversizedMessageIsReportedAsOverBudget() async {
        let budget = AgentContextBudget(maxContextTokens: 800, reserveForResponseTokens: 300)
        let manager = AgentContextManager(budget: budget)
        let plan = await manager.prepare(systemPrompt: "规则",
                                         messages: [.user(String(repeating: "长问题", count: 2000))])
        XCTAssertTrue(plan.overBudget)
    }
}

// MARK: - AgentExecutor 主循环

final class AgentExecutorTests: XCTestCase {
    private var root: URL!

    override func setUpWithError() throws {
        root = agentTemporaryRoot("executor")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: root)
    }

    private func request(_ conversationID: UUID = UUID(), prompt: String = "读者上下文",
                         messages: [AgentMessage] = [.user("这本书讲了什么？")],
                         checkpoint: AgentCheckpoint? = nil) -> AgentRunRequest {
        AgentRunRequest(conversationID: conversationID, bookID: "book-1", bookTitle: "测试书",
                        systemPrompt: prompt, messages: messages, checkpoint: checkpoint)
    }

    func testToolLoopValidatesCitationAndSavesCheckpoint() async throws {
        let source = StubBookSource(searchResults: [agentExcerpt("书里的原文句子")])
        let model = ScriptedChatModel([
            [.toolCall(AgentToolCall(id: "call_1", name: "search_book", argumentsJSON: #"{"query":"原文"}"#)),
             .finished(.toolCalls)],
            [.textDelta(#"{"answer":"书里说的是原文。","citations":[{"id":"E1","quote":"书里的原文"}]}"#),
             .finished(.stop)],
        ])
        let executor = makeExecutor(model: model, source: source, root: root)
        let conversationID = UUID()
        let events = await collectEvents(executor.start(request(conversationID)))

        let result = try XCTUnwrap(agentCompleted(events))
        XCTAssertEqual(result.answer, "书里说的是原文。")
        XCTAssertEqual(result.citations.map(\.id), ["E1"])
        XCTAssertTrue(result.citations[0].quote.contains("书里的原文句子"))
        XCTAssertEqual(result.steps, 2)
        XCTAssertEqual(result.citationsDropped, 0)
        XCTAssertEqual(result.warning, "")
        XCTAssertTrue(events.contains { if case .started(let started) = $0 { return started.toolNames.count == 6 && started.maxSteps == 8 }; return false })
        XCTAssertEqual(events.filter { if case .step = $0 { return true }; return false }.count, 2)
        XCTAssertTrue(events.contains { if case .toolFinished(let finished) = $0 { return !finished.isError && finished.call.name == "search_book" }; return false })
        XCTAssertEqual(model.requests.count, 2)
        let toolMessage = try XCTUnwrap(model.requests[1].last)
        XCTAssertEqual(toolMessage.role, .tool)
        XCTAssertTrue(toolMessage.content.contains("[E1]"))

        let store = AgentCheckpointStore(root: root)
        let saved = try XCTUnwrap(try store.load(conversationID: conversationID))
        XCTAssertEqual(saved.status, .completed)
        XCTAssertEqual(saved.result?.answer, "书里说的是原文。")
        XCTAssertEqual(saved.steps, 2)
        XCTAssertTrue(FileManager.default.fileExists(atPath: store.fileURL(conversationID: conversationID).path))
    }

    func testInvalidAndUnverifiedCitationsAreDroppedWithWarning() async throws {
        let source = StubBookSource(searchResults: [
            agentExcerpt("书里的原文句子"),
            agentExcerpt("另一段原文", title: "第二章"),
        ])
        let answer = #"{"answer":"有引用。","citations":[{"id":"E1","quote":"书里的原文"},{"id":"E2","quote":"另一段原文"},{"id":"E9","quote":"未知"},{"id":"E1","quote":"不存在"}]}"#
        let model = ScriptedChatModel([
            [.toolCall(AgentToolCall(id: "call_1", name: "search_book", argumentsJSON: #"{"query":"原文"}"#)),
             .finished(.toolCalls)],
            [.textDelta(answer), .finished(.stop)],
        ])
        let executor = makeExecutor(model: model, source: source, root: root,
                                    verifier: QuoteFilterVerifier(required: "书里"))
        let events = await collectEvents(executor.start(request()))

        let result = try XCTUnwrap(agentCompleted(events))
        XCTAssertEqual(result.citations.map(\.id), ["E1"])
        XCTAssertEqual(result.citationsDropped, 3)
        XCTAssertTrue(result.warning.contains("部分出处未通过"))
        XCTAssertTrue(agentWarnings(events).contains { $0.code == .invalidCitations })
    }

    func testCancellationStopsStreamAndCheckpointIsCancelled() async throws {
        let model = BlockingChatModel()
        let executor = makeExecutor(model: model, source: StubBookSource(), root: root)
        let conversationID = UUID()
        let session = executor.start(request(conversationID))
        var sawText = false
        var sawCancelled = false
        for await event in session.events {
            if case .textDelta = event {
                sawText = true
                session.cancel()
            }
            if case .cancelled = event { sawCancelled = true }
        }
        await session.wait()
        XCTAssertTrue(sawText)
        XCTAssertTrue(sawCancelled)
        let saved = try XCTUnwrap(try AgentCheckpointStore(root: root).load(conversationID: conversationID))
        XCTAssertEqual(saved.status, .cancelled)
    }

    func testFinalStepWrapsUpWithoutToolsAndAcceptsAnswer() async throws {
        let source = StubBookSource(searchResults: [agentExcerpt("书里的原文句子")])
        let model = ScriptedChatModel([
            [.toolCall(AgentToolCall(id: "call_1", name: "search_book", argumentsJSON: #"{"query":"原文"}"#)),
             .finished(.toolCalls)],
            [.textDelta(#"{"answer":"收尾回答。","citations":[{"id":"E1","quote":"书里的原文"}]}"#), .finished(.stop)],
        ])
        var configuration = AgentRuntimeConfiguration()
        configuration.maxSteps = 2
        let executor = makeExecutor(model: model, source: source, root: root, configuration: configuration)
        let events = await collectEvents(executor.start(request()))

        let result = try XCTUnwrap(agentCompleted(events))
        XCTAssertEqual(result.answer, "收尾回答。")
        XCTAssertEqual(result.citations.count, 1)
        XCTAssertEqual(model.toolSpecs.count, 2)
        XCTAssertTrue(model.toolSpecs[1].isEmpty, "最后一步不能再提供工具")
        XCTAssertTrue(model.requests[1].last?.content.contains("已达到本次 2 步") == true)
        XCTAssertTrue(agentWarnings(events).contains { $0.code == .stepLimit })
    }

    func testStepLimitWithoutAnswerFailsWithStepLimit() async throws {
        let source = StubBookSource(searchResults: [agentExcerpt("书里的原文句子")])
        let model = ScriptedChatModel([
            [.toolCall(AgentToolCall(id: "call_1", name: "search_book", argumentsJSON: #"{"query":"原文"}"#)),
             .finished(.toolCalls)],
            [.finished(.stop)],
        ])
        var configuration = AgentRuntimeConfiguration()
        configuration.maxSteps = 2
        let executor = makeExecutor(model: model, source: source, root: root, configuration: configuration)
        let events = await collectEvents(executor.start(request()))

        let failure = try XCTUnwrap(agentFailed(events))
        XCTAssertEqual(failure.code, .stepLimit)
        XCTAssertNil(agentCompleted(events))
    }

    func testContextBudgetFailureIsExplicit() async throws {
        let model = ScriptedChatModel([])
        let budget = AgentContextBudget(maxContextTokens: 900, reserveForResponseTokens: 300)
        let executor = makeExecutor(model: model, source: StubBookSource(), root: root, budget: budget)
        let events = await collectEvents(executor.start(request(messages: [.user(String(repeating: "长问题", count: 2000))])))

        let failure = try XCTUnwrap(agentFailed(events))
        XCTAssertEqual(failure.code, .contextBudget)
        XCTAssertTrue(model.requests.isEmpty, "超预算时不应发送模型请求")
    }

    func testToolsUnsupportedIsRecognizableFailure() async throws {
        let model = ScriptedChatModel([])
        model.failNextCall(with: AgentModelError.toolsUnsupported)
        let executor = makeExecutor(model: model, source: StubBookSource(), root: root)
        let events = await collectEvents(executor.start(request()))

        let failure = try XCTUnwrap(agentFailed(events))
        XCTAssertEqual(failure.code, .toolsUnsupported)
    }

    func testRunTimeoutFails() async throws {
        var configuration = AgentRuntimeConfiguration()
        configuration.runTimeout = -1
        let executor = makeExecutor(model: ScriptedChatModel([]), source: StubBookSource(),
                                    root: root, configuration: configuration)
        let events = await collectEvents(executor.start(request()))
        XCTAssertEqual(agentFailed(events)?.code, .timeout)
    }

    func testUnknownToolErrorIsReturnedToModelAndRunRecovers() async throws {
        let model = ScriptedChatModel([
            [.toolCall(AgentToolCall(id: "call_1", name: "not_a_tool", argumentsJSON: "{}")), .finished(.toolCalls)],
            [.textDelta(#"{"answer":"仍然可以回答。","citations":[]}"#), .finished(.stop)],
        ])
        let executor = makeExecutor(model: model, source: StubBookSource(), root: root)
        let events = await collectEvents(executor.start(request()))

        XCTAssertTrue(events.contains {
            if case .toolFinished(let finished) = $0 { return finished.isError && finished.call.name == "not_a_tool" }
            return false
        })
        let result = try XCTUnwrap(agentCompleted(events))
        XCTAssertEqual(result.answer, "仍然可以回答。")
        let toolMessage = try XCTUnwrap(model.requests[1].last)
        XCTAssertEqual(toolMessage.role, .tool)
        XCTAssertTrue(toolMessage.isError)
        XCTAssertTrue(toolMessage.content.contains("工具执行失败"))
    }

    func testCheckpointResumeContinuesFromSavedHistory() async throws {
        let conversationID = UUID()
        let store = AgentCheckpointStore(root: root)
        let now = Date()
        let checkpoint = AgentCheckpoint(
            conversationID: conversationID, bookID: "book-1", bookTitle: "测试书",
            createdAt: now, updatedAt: now, status: .running, model: "stub-model",
            messages: [.user("旧问题"), .assistant("旧回答")], steps: 1,
            result: nil, failure: nil, warnings: [], context: nil)
        try store.save(checkpoint)

        let model = ScriptedChatModel([
            [.textDelta(#"{"answer":"继续回答。","citations":[]}"#), .finished(.stop)],
        ])
        let executor = makeExecutor(model: model, source: StubBookSource(), root: root)
        let events = await collectEvents(executor.start(
            request(conversationID, messages: [.user("追问")], checkpoint: checkpoint)))

        let result = try XCTUnwrap(agentCompleted(events))
        XCTAssertEqual(result.answer, "继续回答。")
        XCTAssertEqual(result.steps, 2)
        let received = model.requests[0].map(\.content)
        XCTAssertTrue(received.contains("旧问题"))
        XCTAssertTrue(received.contains("旧回答"))
        XCTAssertTrue(received.contains("追问"))
        let saved = try XCTUnwrap(try store.load(conversationID: conversationID))
        XCTAssertEqual(saved.status, .completed)
    }

    func testCompletedCheckpointReplaysWithoutCallingModel() async throws {
        let conversationID = UUID()
        let store = AgentCheckpointStore(root: root)
        let usage = AgentContextUsage(estimatedTokens: 10, characterCount: 10, limitTokens: 100,
                                      summarizedMessages: 0, trimmedMessages: 0, truncatedToolResults: 0)
        let result = AgentRunResult(answer: "已保存的回答。", citations: [], warning: "", steps: 3,
                                    citationsDropped: 0, context: usage, finishedAt: Date())
        let now = Date()
        try store.save(AgentCheckpoint(
            conversationID: conversationID, bookID: "book-1", bookTitle: "测试书",
            createdAt: now, updatedAt: now, status: .completed, model: "stub-model",
            messages: [.user("旧问题"), .assistant("已保存的回答。")], steps: 3,
            result: result, failure: nil, warnings: [], context: usage))

        let model = ScriptedChatModel([])
        let executor = makeExecutor(model: model, source: StubBookSource(), root: root)
        let events = await collectEvents(executor.start(
            request(conversationID, messages: [], checkpoint: try store.load(conversationID: conversationID))))

        XCTAssertEqual(agentCompleted(events)?.answer, "已保存的回答。")
        XCTAssertTrue(model.requests.isEmpty, "已完成的对话回看不应重新调用 AI")
    }

    func testHistoryToolCallWithoutResultIsRepairedOnResume() {
        let call = AgentToolCall(id: "call_1", name: "search_book", argumentsJSON: "{}")
        let repaired = AgentExecutor.repairedHistory([
            .user("问题"),
            .assistant("", toolCalls: [call]),
        ])
        XCTAssertEqual(repaired.count, 3)
        XCTAssertEqual(repaired[2].role, .tool)
        XCTAssertEqual(repaired[2].toolCallID, "call_1")
        XCTAssertTrue(repaired[2].isError)
    }
}

// MARK: - 书内工具

final class BookAgentToolsTests: XCTestCase {
    private func registry(_ source: StubBookSource) -> AgentToolRegistry {
        AgentToolRegistry(BookAgentTools.make(environment: AgentTestEnvironment.make(source)))
    }

    func testToolSpecsAreWellFormedAndCoverContract() throws {
        let tools = registry(StubBookSource())
        XCTAssertEqual(tools.names.sorted(),
                       ["book_toc", "current_location", "read_chapter", "read_page", "search_book", "search_notes"])
        for spec in tools.specs {
            XCTAssertFalse(spec.description.isEmpty)
            let object = try JSONSerialization.jsonObject(with: Data(spec.inputSchemaJSON.utf8))
            XCTAssertNotNil(object as? [String: Any], "\(spec.name) schema 必须是 JSON 对象")
        }
    }

    func testSearchBookRegistersEvidenceAndValidatesArguments() async throws {
        let source = StubBookSource(searchResults: [agentExcerpt("书里的原文句子")])
        let tool = try XCTUnwrap(registry(source).tool(named: "search_book"))
        let allocator = AgentEvidenceAllocator()
        let context = AgentToolCallContext(callID: "call_1", step: 1, bookID: "book-1", evidence: allocator)

        let result = try await tool.call(AgentToolArguments(json: #"{"query":"原文","limit":1}"#), context: context)
        XCTAssertFalse(result.isError)
        XCTAssertTrue(result.content.contains("[E1]"))
        let evidence = await allocator.all()
        XCTAssertEqual(evidence.count, 1)
        XCTAssertEqual(evidence[0].id, "E1")
        XCTAssertEqual(evidence[0].quote, "书里的原文句子")

        do {
            _ = try await tool.call(AgentToolArguments(json: #"{"limit":1}"#), context: context)
            XCTFail("缺少 query 时应抛参数错误")
        } catch {
            XCTAssertEqual(error as? AgentToolError, .invalidArguments("缺少参数 query"))
        }
        do {
            _ = try await tool.call(AgentToolArguments(json: #"{"query":"原文","limit":99}"#), context: context)
            XCTFail("limit 越界时应抛参数错误")
        } catch {
            guard case .invalidArguments = error as? AgentToolError else { return XCTFail("expected invalidArguments") }
        }
    }

    func testReadPageAndChapterExposeEvidenceOrClearFailure() async throws {
        let page = AgentBookPassage(title: "第 1 页", page: 1,
                                    excerpts: [agentExcerpt("第一页原文", title: "第 1 页", page: 1)],
                                    truncated: false)
        let chapter = AgentBookPassage(title: "第一章", page: nil,
                                       excerpts: [agentExcerpt("第一章原文")], truncated: false)
        let source = StubBookSource(pages: [1: page], chapters: ["第一章": chapter])
        let tools = registry(source)
        let allocator = AgentEvidenceAllocator()
        let context = AgentToolCallContext(callID: "call_1", step: 1, bookID: "book-1", evidence: allocator)

        let readPage = try XCTUnwrap(tools.tool(named: "read_page"))
        let pageResult = try await readPage.call(AgentToolArguments(json: #"{"page":1}"#), context: context)
        XCTAssertFalse(pageResult.isError)
        XCTAssertTrue(pageResult.content.contains("第 1 页"))
        let afterPage = await allocator.all()
        XCTAssertEqual(afterPage.count, 1)

        let missing = try await readPage.call(AgentToolArguments(json: #"{"page":9}"#), context: context)
        XCTAssertTrue(missing.isError)
        XCTAssertTrue(missing.content.contains("没有找到"))

        let readChapter = try XCTUnwrap(tools.tool(named: "read_chapter"))
        let chapterResult = try await readChapter.call(AgentToolArguments(json: #"{"reference":"第一章"}"#), context: context)
        XCTAssertFalse(chapterResult.isError)
        let afterChapter = await allocator.all()
        XCTAssertEqual(afterChapter.count, 2)
    }

    func testTableOfContentsFallsBackToPageRangeAndNotesAndLocation() async throws {
        let pages = (1...30).map {
            AgentBookTOCEntry(title: "第 \($0) 页", href: "pdf://page/\($0)", depth: 0, page: $0)
        }
        let source = StubBookSource(toc: [], chapterEntries: pages)
        let tools = registry(source)
        let allocator = AgentEvidenceAllocator()
        let context = AgentToolCallContext(callID: "call_1", step: 1, bookID: "book-1", evidence: allocator)

        let tocTool = try XCTUnwrap(tools.tool(named: "book_toc"))
        let toc = try await tocTool.call(AgentToolArguments(json: "{}"), context: context)
        XCTAssertFalse(toc.isError)
        XCTAssertTrue(toc.content.contains("按页组织"))
        XCTAssertTrue(toc.content.contains("30"))

        let notesTool = try XCTUnwrap(tools.tool(named: "search_notes"))
        let notes = try await notesTool.call(AgentToolArguments(json: #"{"query":"想法"}"#), context: context)
        XCTAssertFalse(notes.isError)
        XCTAssertTrue(notes.content.contains("我的想法"))
        let notesEvidence = await allocator.all()
        XCTAssertEqual(notesEvidence.count, 0, "笔记不是书内原文依据，不应登记引用")

        let locationTool = try XCTUnwrap(tools.tool(named: "current_location"))
        let location = try await locationTool.call(AgentToolArguments(json: "{}"), context: context)
        XCTAssertFalse(location.isError)
        XCTAssertTrue(location.content.contains("第一章"))
        XCTAssertTrue(location.content.contains("12%"))
    }

    func testInvalidToolArgumentsJSONIsRejected() async throws {
        let tool = try XCTUnwrap(registry(StubBookSource()).tool(named: "search_book"))
        let context = AgentToolCallContext(callID: "call_1", step: 1, bookID: "book-1", evidence: AgentEvidenceAllocator())
        do {
            _ = try await tool.call(AgentToolArguments(json: "not-json"), context: context)
            XCTFail("非法 JSON 应抛参数错误")
        } catch {
            guard case .invalidArguments = error as? AgentToolError else { return XCTFail("expected invalidArguments") }
        }
    }
}

// MARK: - BookIndex 只读查询（真实 fixture，不联网）

final class BookIndexAgentReadOnlyTests: XCTestCase {
    func testPreparedFixtureExposesChaptersTOCAndFragmentText() async throws {
        let root = agentTemporaryRoot("index")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let fixture = try XCTUnwrap(
            Bundle(for: Self.self).url(forResource: "original-fixture", withExtension: "epub", subdirectory: "Fixtures"))
        let index = BookIndex(url: root.appendingPathComponent("book-index.sqlite"))
        try await index.prepare(bookID: "book-1", file: fixture) { _ in }

        let chapters = try await index.agentChapters(bookID: "book-1")
        XCTAssertEqual(chapters.count, 3)
        XCTAssertEqual(chapters.first?.ordinal, 0)
        XCTAssertNil(chapters.first?.page)

        let toc = try await index.agentTableOfContents(bookID: "book-1")
        XCTAssertFalse(toc.isEmpty)
        XCTAssertTrue(toc.contains { $0.title.contains("第1章") })

        let match = try await index.agentChapterMatch(bookID: "book-1", reference: "第1章")
        XCTAssertEqual(match?.ordinal, 0)
        let ordinalMatch = try await index.agentChapterMatch(bookID: "book-1", reference: "2")
        XCTAssertEqual(ordinalMatch?.ordinal, 1)

        let chapterTextValue = try await index.agentChapterText(bookID: "book-1", chapter: 0, maxCharacters: 5000)
        let chapterText = try XCTUnwrap(chapterTextValue)
        let first = try XCTUnwrap(chapterText.fragments.first { $0.text.contains("C1-P01") })
        XCTAssertNil(first.page)

        let fragmentValue = try await index.agentFragment(bookID: "book-1", chapter: 0, ordinal: first.ordinal)
        let fragment = try XCTUnwrap(fragmentValue)
        XCTAssertEqual(fragment.locatorJSON, first.locatorJSON)

        let query = String(first.text.prefix(2))
        let hits = try await index.search(bookID: "book-1", query: query)
        XCTAssertFalse(hits.isEmpty, "fixture 原文应能被 search 命中")

        // 引用核对：真实片段的 locator + 原文可以通过，篡改原文会被剔除。
        let verifier = BookIndexCitationVerifier(index: index, bookID: "book-1")
        let locator = try XCTUnwrap(Locator(json: JSONValue(jsonString: first.locatorJSON, warnings: nil), warnings: nil))
        let real = QuestionEvidence(locator: locator, context: first.text)
        let realVerdict = await verifier.verifiedIndices(in: [real])
        XCTAssertEqual(realVerdict, [0])

        var fakeLocator = locator
        fakeLocator.text = .init(before: locator.text.before, highlight: "书里没有的伪造句子")
        let fake = QuestionEvidence(locator: fakeLocator, context: "书里没有的伪造句子")
        let fakeVerdict = await verifier.verifiedIndices(in: [fake])
        XCTAssertEqual(fakeVerdict, [])
    }
}

// MARK: - 真实 URLSession/SSE 传输集成

private final class AgentSSEURLProtocol: Foundation.URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var responses: [String] = []
    nonisolated(unsafe) static var bodies: [Data] = []
    nonisolated(unsafe) static var requestedCount = 0

    override class func canInit(with request: Foundation.URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: Foundation.URLRequest) -> Foundation.URLRequest { request }

    override func startLoading() {
        let index = Self.requestedCount
        Self.requestedCount += 1
        if let body = request.httpBody {
            Self.bodies.append(body)
        } else if let stream = request.httpBodyStream {
            // URLProtocol 拿到的请求体通常在 stream 里，httpBody 为 nil。
            stream.open()
            defer { stream.close() }
            var data = Data()
            var buffer = [UInt8](repeating: 0, count: 4096)
            while true {
                let count = stream.read(&buffer, maxLength: buffer.count)
                if count <= 0 { break }
                data.append(buffer, count: count)
            }
            Self.bodies.append(data)
        }
        let payload = Self.responses.indices.contains(index) ? Self.responses[index] : Self.responses.last ?? ""
        let response = Foundation.HTTPURLResponse(url: request.url!, statusCode: 200,
                                       httpVersion: "HTTP/1.1",
                                       headerFields: ["Content-Type": "text/event-stream",
                                                      "Connection": "close"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(payload.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

final class AgentTransportIntegrationTests: XCTestCase {
    func testOpenAIURLSessionStreamEmitsTextToolCallAndFinished() async throws {
        let payload = """
        data: {"choices":[{"delta":{"content":"查书"}}]}

        data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"search_book","arguments":"{\\"query\\":\\"灯\\"}"}}]}}]}

        data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}

        data: [DONE]

        """
        AgentSSEURLProtocol.responses = [payload]
        AgentSSEURLProtocol.bodies = []
        AgentSSEURLProtocol.requestedCount = 0
        let sessionConfiguration = URLSessionConfiguration.ephemeral
        sessionConfiguration.protocolClasses = [AgentSSEURLProtocol.self]
        let session = URLSession(configuration: sessionConfiguration)
        let config = AIConfiguration(name: "stub", format: .openAI,
                                     address: "http://127.0.0.1:18781", model: "stub")
        let model = AgentOpenAIChatModel(configuration: config, key: "test", session: session)
        let spec = AgentToolSpec(name: "search_book", description: "搜索", inputSchemaJSON: #"{"type":"object"}"#)
        var events: [AgentModelEvent] = []
        for try await event in model.stream(messages: [.user("灯是什么意思")], tools: [spec],
                                            options: AgentModelOptions()) {
            events.append(event)
        }
        XCTAssertEqual(events, [
            .textDelta("查书"),
            .toolCall(AgentToolCall(id: "call_1", name: "search_book", argumentsJSON: #"{"query":"灯"}"#)),
            .finished(.toolCalls),
        ])
    }

    func testOpenAIURLSessionStreamDrivesToolLoopAndSecondRequest() async throws {
        let first = """
        data: {"choices":[{"delta":{"content":"查书"}}]}

        data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"search_book","arguments":"{\\"query\\":\\"灯\\"}"}}]}}]}

        data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}

        data: [DONE]

        """
        let second = """
        data: {"choices":[{"delta":{"content":"{\\"answer\\":\\"灯把书页照亮。\\",\\"citations\\":[{\\"id\\":\\"E1\\",\\"quote\\":\\"灯把书页照亮。\\"}]}"}}]}

        data: {"choices":[{"delta":{},"finish_reason":"stop"}]}

        data: [DONE]

        """
        AgentSSEURLProtocol.responses = [first, second]
        AgentSSEURLProtocol.bodies = []
        AgentSSEURLProtocol.requestedCount = 0
        let sessionConfiguration = URLSessionConfiguration.ephemeral
        sessionConfiguration.protocolClasses = [AgentSSEURLProtocol.self]
        let session = URLSession(configuration: sessionConfiguration)
        let config = AIConfiguration(name: "stub", format: .openAI,
                                     address: "http://127.0.0.1:18781", model: "stub")
        let model = AgentOpenAIChatModel(configuration: config, key: "test", session: session)
        let root = agentTemporaryRoot("transport")
        defer { try? FileManager.default.removeItem(at: root) }
        let source = StubBookSource(searchResults: [agentExcerpt("灯把书页照亮。")])
        let executor = makeExecutor(model: model, source: source, root: root)
        let request = AgentRunRequest(conversationID: UUID(), bookID: "book-1", bookTitle: "测试书",
                                      systemPrompt: "只依据书内材料", messages: [.user("灯是什么意思")])
        let events = await collectEvents(executor.start(request))
        XCTAssertEqual(AgentSSEURLProtocol.requestedCount, 2, "工具结果应触发第二次模型请求")
        XCTAssertNotNil(agentCompleted(events), "应完成最终回答，事件：\(events)")
        XCTAssertTrue(events.contains { if case .toolStarted = $0 { return true }; return false })
        XCTAssertTrue(events.contains { if case .toolFinished = $0 { return true }; return false })
        let secondBody = AgentSSEURLProtocol.bodies.indices.contains(1) ? AgentSSEURLProtocol.bodies[1] : Data()
        let json = try JSONSerialization.jsonObject(with: secondBody) as? [String: Any]
        let messages = json?["messages"] as? [[String: Any]]
        XCTAssertTrue(messages?.contains { ($0["role"] as? String) == "tool" } == true)
        XCTAssertTrue(messages?.contains { ($0["role"] as? String) == "assistant" && $0["tool_calls"] != nil } == true)
    }
}

// MARK: - PDF 页级引用核验（真实 PDF fixture + 真实 BookIndex）

/// 复现并回归「PDF 页级 evidence 能通过 permits，但最终引用被 finalize 丢弃」。
/// 工具注册的 evidence 是 PDFKit 抽取的整页原文，抽取会在中文标点后插入空白；
/// 模型引用的是同一段连续文字但不带抽取空白，核验不能因此丢失真实引用。
final class AgentPDFCitationVerificationTests: XCTestCase {
    private let bookID = "pdf-book"
    private var root: URL!
    private var index: BookIndex!
    private var source: BookIndexAgentSource!
    private var pageText: String!
    private var pageEvidence: QuestionEvidence!

    override func setUp() async throws {
        try await super.setUp()
        root = agentTemporaryRoot("pdf-citation")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let file = root.appendingPathComponent("fixture.pdf")
        try await Self.writeFixturePDF(to: file)
        index = BookIndex(url: root.appendingPathComponent("book-index.sqlite"))
        try await index.prepare(bookID: bookID, file: file, progress: { _ in })
        source = BookIndexAgentSource(index: index, bookID: bookID)
        let excerpts = try await source.search("灯", limit: 5)
        let excerpt = try XCTUnwrap(excerpts.first, "PDF 页级索引应能检索到「灯」")
        pageText = excerpt.quote
        let locator = try XCTUnwrap(Locator(json: JSONValue(jsonString: excerpt.locatorJSON, warnings: nil), warnings: nil))
        pageEvidence = QuestionEvidence(id: "E1", locator: locator)
    }

    override func tearDown() async throws {
        if let root { try? FileManager.default.removeItem(at: root) }
        try await super.tearDown()
    }

    func testPDFPageEvidencePassesPermitsAndCitationsSurviveFinalize() async throws {
        let scope = BookEvidenceScope(bookID: bookID)
        let permitted = try await index.permits([pageEvidence], scope: scope)
        XCTAssertTrue(permitted, "PDF 页级 evidence 应通过 permits")

        // 伪造 quote 仍要被 permits 拒绝。
        var forgedLocator = try XCTUnwrap(Locator(json: JSONValue(jsonString: pageEvidence.locatorJSON, warnings: nil), warnings: nil))
        forgedLocator.text = .init(after: forgedLocator.text.after, before: forgedLocator.text.before,
                                   highlight: "灯把书页烧掉，也把问题留在纸上。")
        let forgedPermitted = try await index.permits([QuestionEvidence(locator: forgedLocator)], scope: scope)
        XCTAssertFalse(forgedPermitted, "书里没有的 quote 不应通过 permits")

        // PDFKit 抽取的原文：先断言确实带标点后空白，才能复现 finalize 的子串核验失败。
        let sentence = try pageSentence()
        let stripped = strippedWhitespace(sentence)
        XCTAssertLessThan(stripped.count, sentence.count, "PDF 抽取应在标点后插入空白：\(sentence.debugDescription)")

        // 与 UI smoke 一致的引用形态：去掉抽取空白的连续原文。
        let strippedRun = try await runExecutor(citation: stripped)
        let strippedResult = try XCTUnwrap(strippedRun.result, "应完成最终回答，事件：\(strippedRun.events)")
        XCTAssertEqual(strippedResult.citations.map(\.id), ["E1"], "真实 PDF 引用不应被丢弃，事件：\(strippedRun.events)")
        XCTAssertEqual(strippedResult.citationsDropped, 0)
        XCTAssertFalse(agentWarnings(strippedRun.events).contains { $0.code == .invalidCitations })

        // 原样带抽取空白的 quote 仍应通过（不回归）。
        let exactRun = try await runExecutor(citation: sentence)
        let exactResult = try XCTUnwrap(exactRun.result, "应完成最终回答，事件：\(exactRun.events)")
        XCTAssertEqual(exactResult.citations.map(\.id), ["E1"])
        XCTAssertEqual(exactResult.citationsDropped, 0)
    }

    func testPDFForgedCitationIsRejected() async throws {
        let run = try await runExecutor(citation: "灯把书页烧掉，也把问题留在纸上。")
        let result = try XCTUnwrap(run.result, "应完成最终回答，事件：\(run.events)")
        XCTAssertTrue(result.citations.isEmpty, "伪造引用不应显示为有效引用")
        XCTAssertEqual(result.citationsDropped, 1)
        XCTAssertTrue(agentWarnings(run.events).contains { $0.code == .invalidCitations })
    }

    /// 空白宽松匹配只针对 PDF 抽取原文；EPUB 不许借此放宽，伪造 quote 始终拒绝。
    func testCitationQuoteMatchIsWhitespaceInsensitiveOnlyForPDF() throws {
        let epubLocator = Locator(href: AnyURL(string: "OEBPS/chapter1.xhtml")!, mediaType: .xhtml, title: "第一章",
                                  text: .init(highlight: "灯把书页照亮， 也把问题留在纸上。"))
        let epubEvidence = QuestionEvidence(locator: epubLocator)
        XCTAssertNil(epubEvidence.pdfPage)
        XCTAssertTrue(AgentExecutor.citationQuoteMatches(
            AgentExecutor.normalizeWhitespace("灯把书页照亮， 也把问题留在纸上。"), evidence: epubEvidence))
        XCTAssertFalse(AgentExecutor.citationQuoteMatches(
            AgentExecutor.normalizeWhitespace("灯把书页照亮，也把问题留在纸上。"), evidence: epubEvidence),
            "EPUB 不应放宽空白差异")

        XCTAssertTrue(AgentExecutor.citationQuoteMatches(
            AgentExecutor.normalizeWhitespace("灯把书页照亮，也把问题留在纸上。"), evidence: pageEvidence),
            "PDF 抽取空白差异不应导致真实引用被丢弃")
        XCTAssertFalse(AgentExecutor.citationQuoteMatches(
            AgentExecutor.normalizeWhitespace("灯把书页烧掉，也把问题留在纸上。"), evidence: pageEvidence))
    }

    // MARK: 辅助

    private func pageSentence() throws -> String {
        let start = try XCTUnwrap(pageText.range(of: "灯把书页照亮"), "PDF 原文应包含测试句子：\(pageText.debugDescription)")
        let tail = pageText[start.lowerBound...]
        guard let end = tail.range(of: "。") else { return String(tail) }
        return String(tail[..<end.upperBound])
    }

    private func strippedWhitespace(_ text: String) -> String {
        String(text.filter { !$0.isWhitespace && $0 != "\u{00AD}" && $0 != "\u{200B}" && $0 != "\u{FEFF}" })
    }

    private func runExecutor(citation: String) async throws -> (events: [AgentEvent], result: AgentRunResult?) {
        let call = AgentToolCall(id: "call_search", name: "search_book", argumentsJSON: #"{"query":"灯"}"#)
        let payload: [String: Any] = ["answer": "灯把书页照亮。", "citations": [["id": "E1", "quote": citation]]]
        let raw = String(decoding: try JSONSerialization.data(withJSONObject: payload), as: UTF8.self)
        let model = ScriptedChatModel([
            [.textDelta("我先查一下书内资料。"), .toolCall(call), .finished(.toolCalls)],
            [.textDelta(raw), .finished(.stop)],
        ])
        let environment = BookAgentEnvironment(bookID: bookID, bookTitle: "书灯 PDF 示例",
                                               source: source, notes: [], currentLocation: nil)
        let executor = AgentExecutor(model: model,
                                     tools: AgentToolRegistry(BookAgentTools.make(environment: environment)),
                                     context: AgentContextManager(),
                                     checkpoints: AgentCheckpointStore(root: root),
                                     verifier: BookIndexCitationVerifier(index: index, bookID: bookID))
        let request = AgentRunRequest(conversationID: UUID(), bookID: bookID, bookTitle: "书灯 PDF 示例",
                                      messages: [.user("灯在书里是什么意思？")])
        let events = await collectEvents(executor.start(request))
        return (events, agentCompleted(events))
    }

    /// 与 DesignFixture.FixturePDF 相同的两页文字 PDF 绘制方式。
    private static func writeFixturePDF(to url: URL) async throws {
        let bounds = CGRect(x: 0, y: 0, width: 595, height: 842)
        let pages: [(heading: String, body: String)] = [
            ("书灯 PDF 示例 · 第一页", "灯把书页照亮，也把问题留在纸上。The lamp lights the page."),
            ("书灯 PDF 示例 · 第二页", "PDF 阅读器使用系统 PDFKit 完成渲染与翻页。Page 2 of 2."),
        ]
        let data: Data = await MainActor.run {
            UIGraphicsPDFRenderer(bounds: bounds).pdfData { context in
                for (offset, page) in pages.enumerated() {
                    context.beginPage()
                    let headingAttributes: [NSAttributedString.Key: Any] = [
                        .font: UIFont(name: "SongtiSC-Bold", size: 22) ?? UIFont.systemFont(ofSize: 22, weight: .semibold),
                        .foregroundColor: UIColor.black,
                    ]
                    let bodyAttributes: [NSAttributedString.Key: Any] = [
                        .font: UIFont.systemFont(ofSize: 14),
                        .foregroundColor: UIColor.black,
                    ]
                    (page.heading as NSString).draw(at: CGPoint(x: 56, y: 64), withAttributes: headingAttributes)
                    (page.body as NSString).draw(in: CGRect(x: 56, y: 112, width: 480, height: 300),
                                                 withAttributes: bodyAttributes)
                    ("第 \(offset + 1) / \(pages.count) 页" as NSString).draw(at: CGPoint(x: 56, y: 780),
                                                                            withAttributes: bodyAttributes)
                }
            }
        }
        try data.write(to: url)
    }
}

// MARK: - 对抗性审计：SSE 传输

/// 可配置状态码、分块到达的 URLProtocol；用于 SSE 对抗性测试（分块/错误/非 SSE）。
private final class AgentAuditURLProtocol: Foundation.URLProtocol, @unchecked Sendable {
    struct Stub: Sendable {
        let status: Int
        let chunks: [Data]
        let failure: URLError?
        init(status: Int = 200, chunks: [Data], failure: URLError? = nil) {
            self.status = status
            self.chunks = chunks
            self.failure = failure
        }
        init(status: Int = 200, body: String, failure: URLError? = nil) {
            self.init(status: status, chunks: [Data(body.utf8)], failure: failure)
        }
    }

    nonisolated(unsafe) static var stubs: [Stub] = []
    nonisolated(unsafe) static var requestCount = 0
    nonisolated(unsafe) static var requestBodies: [Data] = []
    nonisolated(unsafe) static var requestTimeouts: [TimeInterval] = []

    override class func canInit(with request: Foundation.URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: Foundation.URLRequest) -> Foundation.URLRequest { request }
    override func stopLoading() {}

    override func startLoading() {
        let index = Self.requestCount
        Self.requestCount += 1
        Self.requestTimeouts.append(request.timeoutInterval)
        if let body = request.httpBody {
            Self.requestBodies.append(body)
        } else if let stream = request.httpBodyStream {
            stream.open()
            defer { stream.close() }
            var data = Data()
            var buffer = [UInt8](repeating: 0, count: 4_096)
            while true {
                let count = stream.read(&buffer, maxLength: buffer.count)
                if count <= 0 { break }
                data.append(buffer, count: count)
            }
            Self.requestBodies.append(data)
        }
        let stub = Self.stubs.indices.contains(index) ? Self.stubs[index] : Stub(chunks: [])
        let response = Foundation.HTTPURLResponse(url: request.url!, statusCode: stub.status,
                                                  httpVersion: "HTTP/1.1",
                                                  headerFields: ["Content-Type": "text/event-stream",
                                                                 "Connection": "close"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        for chunk in stub.chunks { client?.urlProtocol(self, didLoad: chunk) }
        if let failure = stub.failure {
            client?.urlProtocol(self, didFailWithError: failure)
            return
        }
        client?.urlProtocolDidFinishLoading(self)
    }
}

private enum AgentAuditTransport {
    static func session(_ stubs: [AgentAuditURLProtocol.Stub]) -> URLSession {
        AgentAuditURLProtocol.stubs = stubs
        AgentAuditURLProtocol.requestCount = 0
        AgentAuditURLProtocol.requestBodies = []
        AgentAuditURLProtocol.requestTimeouts = []
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [AgentAuditURLProtocol.self]
        return URLSession(configuration: configuration)
    }

    static func openAI(_ session: URLSession) -> AgentOpenAIChatModel {
        let configuration = AIConfiguration(name: "stub", format: .openAI,
                                            address: "http://127.0.0.1:18781", model: "stub")
        return AgentOpenAIChatModel(configuration: configuration, key: "test", session: session)
    }

    static func anthropic(_ session: URLSession) -> AgentAnthropicChatModel {
        let configuration = AIConfiguration(name: "stub", format: .anthropic,
                                            address: "http://127.0.0.1:18781", model: "stub")
        return AgentAnthropicChatModel(configuration: configuration, key: "test", session: session)
    }

    static func collect(_ model: any AgentChatModel, tools: [AgentToolSpec] = []) async throws -> [AgentModelEvent] {
        var events: [AgentModelEvent] = []
        for try await event in model.stream(messages: [.user("灯是什么意思")], tools: tools,
                                            options: AgentModelOptions()) { events.append(event) }
        return events
    }

    static func json(_ object: [String: Any]) -> String {
        String(decoding: (try? JSONSerialization.data(withJSONObject: object)) ?? Data(), as: UTF8.self)
    }

    /// OpenAI SSE：一个 data 事件（自动补空行）。
    static func data(_ object: [String: Any]) -> String { "data: " + json(object) + "\n\n" }

    static func textChunk(_ text: String) -> String {
        data(["choices": [["delta": ["content": text]]]])
    }

    static func reasoningChunk(_ text: String) -> String {
        data(["choices": [["delta": ["reasoning_content": text]]]])
    }

    static func deepSeekConfiguration() -> AIConfiguration {
        AIConfiguration(name: "DeepSeek", format: .openAI, address: "https://api.deepseek.com",
                        model: "deepseek-flash", provider: .deepSeek)
    }

    static func deepSeekModel(_ session: URLSession) -> AgentOpenAIChatModel {
        AgentOpenAIChatModel(configuration: deepSeekConfiguration(), key: "test", session: session)
    }

    static func toolChunk(index: Int, id: String? = nil, name: String? = nil,
                          arguments: String? = nil, type: String? = nil) -> String {
        var function: [String: Any] = [:]
        if let name { function["name"] = name }
        if let arguments { function["arguments"] = arguments }
        var call: [String: Any] = ["index": index]
        if let id { call["id"] = id }
        if let type { call["type"] = type }
        if !function.isEmpty { call["function"] = function }
        return data(["choices": [["delta": ["tool_calls": [call]]]]])
    }

    static func finishReason(_ reason: String) -> String {
        data(["choices": [["delta": [:], "finish_reason": reason]]])
    }

    static let done = "data: [DONE]\n\n"
}

final class AgentAdversarialSSETests: XCTestCase {
    private var root: URL!

    override func setUpWithError() throws {
        root = agentTemporaryRoot("audit-sse")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: root)
        AgentAuditURLProtocol.stubs = []
        AgentAuditURLProtocol.requestCount = 0
    }

    func testCRLFCommentsAndKeepAliveDoNotBreakEventDispatch() async throws {
        let lfPayload = ": keep-alive\n"
            + AgentAuditTransport.textChunk("书里")
            + ": ping\n"
            + AgentAuditTransport.finishReason("stop")
            + AgentAuditTransport.done
        let payload = lfPayload.replacingOccurrences(of: "\n", with: "\r\n")
        let session = AgentAuditTransport.session([.init(body: payload)])
        let model = AgentAuditTransport.openAI(session)
        let events = try await AgentAuditTransport.collect(model)
        XCTAssertEqual(events, [.textDelta("书里"), .finished(.stop)], "CRLF/注释/keep-alive 不应破坏事件派发")
    }

    func testMultilineDataEventIsJoinedAndDecoded() async throws {
        // 一个 SSE 事件由多个 data 行组成：行间以 \n 拼接后仍是合法 JSON。
        let payload = """
        data: {"choices":[{"delta":
        data: {"content":"书里"}}]}

        """ + "\n" + AgentAuditTransport.finishReason("stop") + AgentAuditTransport.done
        let session = AgentAuditTransport.session([.init(body: payload)])
        let model = AgentAuditTransport.openAI(session)
        let events = try await AgentAuditTransport.collect(model)
        XCTAssertEqual(events, [.textDelta("书里"), .finished(.stop)])
    }

    func testChunkedDeliverySplitsUTF8AndToolArgumentsAcrossChunks() async throws {
        let payload = AgentAuditTransport.textChunk("灯把书页")
            + AgentAuditTransport.toolChunk(index: 0, id: "call_1", name: "search_book",
                                            arguments: #"{"query":"#)
            + AgentAuditTransport.toolChunk(index: 0, arguments: #""灯"}"#)
            + AgentAuditTransport.finishReason("tool_calls")
            + AgentAuditTransport.done
        // 按 3 字节分块：会切断中文 UTF-8 序列与 JSON/arguments。
        let data = Data(payload.utf8)
        var chunks: [Data] = []
        var offset = 0
        while offset < data.count {
            let end = min(offset + 3, data.count)
            chunks.append(data.subdata(in: offset..<end))
            offset = end
        }
        let session = AgentAuditTransport.session([.init(chunks: chunks)])
        let model = AgentAuditTransport.openAI(session)
        let events = try await AgentAuditTransport.collect(model)
        XCTAssertEqual(events, [
            .textDelta("灯把书页"),
            .toolCall(AgentToolCall(id: "call_1", name: "search_book", argumentsJSON: #"{"query":"灯"}"#)),
            .finished(.toolCalls),
        ], "任意分块边界（含 UTF-8 多字节、tool 参数）都不应丢事件")
    }

    func testParallelToolCallIndexesAccumulateInOrder() async throws {
        let payload = AgentAuditTransport.toolChunk(index: 0, id: "call_a", name: "search_book",
                                                    arguments: #"{"query":"#)
            + AgentAuditTransport.toolChunk(index: 1, id: "call_b", name: "read_page",
                                            arguments: #"{"page":"#)
            + AgentAuditTransport.toolChunk(index: 1, arguments: "1}")
            + AgentAuditTransport.toolChunk(index: 0, arguments: #""灯"}"#)
            + AgentAuditTransport.finishReason("tool_calls")
            + AgentAuditTransport.done
        let session = AgentAuditTransport.session([.init(body: payload)])
        let model = AgentAuditTransport.openAI(session)
        let events = try await AgentAuditTransport.collect(model)
        XCTAssertEqual(events, [
            .toolCall(AgentToolCall(id: "call_a", name: "search_book", argumentsJSON: #"{"query":"灯"}"#)),
            .toolCall(AgentToolCall(id: "call_b", name: "read_page", argumentsJSON: #"{"page":1}"#)),
            .finished(.toolCalls),
        ], "并行 index 0/1 应分别累积且按 index 顺序产出")
    }

    func testStreamWithoutDoneOrFinishReasonStillFlushesToolCalls() async throws {
        let payload = AgentAuditTransport.textChunk("查书")
            + AgentAuditTransport.toolChunk(index: 0, id: "call_1", name: "search_book",
                                            arguments: #"{"query":"灯"}"#)
        // 无 finish_reason、无 [DONE]、末尾无空行（连接中断形态）。
        let session = AgentAuditTransport.session([.init(chunks: [Data(payload.utf8)])])
        let model = AgentAuditTransport.openAI(session)
        let events = try await AgentAuditTransport.collect(model)
        XCTAssertEqual(events, [
            .textDelta("查书"),
            .toolCall(AgentToolCall(id: "call_1", name: "search_book", argumentsJSON: #"{"query":"灯"}"#)),
            .finished(.stop),
        ], "流意外结束也应 flush 已累积的 tool_calls，不能丢调用")
    }

    func testMalformedJSONEventFailsRunAsInvalidResponse() async throws {
        let payload = "data: {\"choices\":[{\"delta\":\n\ndata: not-json\n\n"
        let session = AgentAuditTransport.session([.init(body: payload)])
        let model = AgentAuditTransport.openAI(session)
        let executor = makeExecutor(model: model, source: StubBookSource(), root: root)
        let events = await collectEvents(executor.start(AgentRunRequest(
            conversationID: UUID(), bookID: "book-1", bookTitle: "测试书", messages: [.user("问")])))
        XCTAssertEqual(agentFailed(events)?.code, .invalidResponse)
        XCTAssertEqual(AgentAuditURLProtocol.requestCount, 1, "解析失败不应重试")
    }

    func testInStreamErrorObjectMapsToFailure() async throws {
        let payload = "data: " + AgentAuditTransport.json(["error": ["message": "rate limit exceeded",
                                                                    "type": "rate_limit_error"]]) + "\n\n"
        let session = AgentAuditTransport.session([.init(body: payload)])
        let model = AgentAuditTransport.openAI(session)
        let executor = makeExecutor(model: model, source: StubBookSource(), root: root)
        let events = await collectEvents(executor.start(AgentRunRequest(
            conversationID: UUID(), bookID: "book-1", bookTitle: "测试书", messages: [.user("问")])))
        XCTAssertEqual(agentFailed(events)?.code, .limited)
        XCTAssertEqual(AgentAuditURLProtocol.requestCount, 1)
    }

    func testHTTP429MapsToLimitedWithoutRetry() async throws {
        let body = AgentAuditTransport.json(["error": ["message": "rate limit", "type": "rate_limit_error"]])
        let session = AgentAuditTransport.session([.init(status: 429, body: body)])
        let model = AgentAuditTransport.openAI(session)
        let executor = makeExecutor(model: model, source: StubBookSource(), root: root)
        let events = await collectEvents(executor.start(AgentRunRequest(
            conversationID: UUID(), bookID: "book-1", bookTitle: "测试书", messages: [.user("问")])))
        XCTAssertEqual(agentFailed(events)?.code, .limited)
        XCTAssertEqual(AgentAuditURLProtocol.requestCount, 1)
    }

    func testHTTP400ToolsUnsupportedMapsToFallbackSignal() async throws {
        let body = AgentAuditTransport.json(["error": ["message": "tools is not supported for this model",
                                                       "type": "invalid_request_error"]])
        let session = AgentAuditTransport.session([.init(status: 400, body: body)])
        let model = AgentAuditTransport.openAI(session)
        let executor = makeExecutor(model: model, source: StubBookSource(), root: root)
        let events = await collectEvents(executor.start(AgentRunRequest(
            conversationID: UUID(), bookID: "book-1", bookTitle: "测试书", messages: [.user("问")])))
        XCTAssertEqual(agentFailed(events)?.code, .toolsUnsupported)
    }

    func testHTTP200NonSSEBodyFailsWithClearError() async throws {
        let payload = AgentAuditTransport.json(["error": ["message": "not an event stream"]])
        let session = AgentAuditTransport.session([.init(body: payload)])
        let model = AgentAuditTransport.openAI(session)
        let executor = makeExecutor(model: model, source: StubBookSource(), root: root)
        let events = await collectEvents(executor.start(AgentRunRequest(
            conversationID: UUID(), bookID: "book-1", bookTitle: "测试书", messages: [.user("问")])))
        XCTAssertEqual(agentFailed(events)?.code, .invalidResponse,
                       "200 但不是 SSE 时不能静默当成空回答")
    }

    func testAnthropicTransportDispatchesCRLFEventsAndToolUse() async throws {
        func event(_ name: String, _ object: [String: Any]) -> String {
            "event: " + name + "\r\ndata: " + AgentAuditTransport.json(object) + "\r\n\r\n"
        }
        let payload = event("content_block_start", ["type": "content_block_start", "index": 0,
                                                    "content_block": ["type": "text", "text": ""]])
            + event("content_block_delta", ["type": "content_block_delta", "index": 0,
                                            "delta": ["type": "text_delta", "text": "书里"]])
            + event("content_block_start", ["type": "content_block_start", "index": 1,
                                            "content_block": ["type": "tool_use", "id": "toolu_1",
                                                              "name": "search_book", "input": [:] as [String: Any]]])
            + event("content_block_delta", ["type": "content_block_delta", "index": 1,
                                            "delta": ["type": "input_json_delta", "partial_json": #"{"query":"灯"}"#]])
            + event("content_block_stop", ["type": "content_block_stop", "index": 1])
            + event("message_delta", ["type": "message_delta", "delta": ["stop_reason": "tool_use"]])
            + event("message_stop", ["type": "message_stop"])
        let session = AgentAuditTransport.session([.init(body: payload)])
        let model = AgentAuditTransport.anthropic(session)
        let events = try await AgentAuditTransport.collect(model)
        XCTAssertEqual(events, [
            .textDelta("书里"),
            .toolCall(AgentToolCall(id: "toolu_1", name: "search_book", argumentsJSON: #"{"query":"灯"}"#)),
            .finished(.toolCalls),
        ], "Anthropic 事件/CRLF 经真实传输后仍应正确解析")
    }

    func testEmptyDataHeartbeatEventsAreIgnored() async throws {
        // 部分 OpenAI 兼容网关用 `data:` 空事件当 keep-alive；SSE 规范规定空 data 不派发事件。
        let payload = AgentAuditTransport.textChunk("书里")
            + "data:\n\n"
            + "data: \n\n"
            + AgentAuditTransport.finishReason("stop")
            + AgentAuditTransport.done
        let session = AgentAuditTransport.session([.init(body: payload)])
        let model = AgentAuditTransport.openAI(session)
        let events = try await AgentAuditTransport.collect(model)
        XCTAssertEqual(events, [.textDelta("书里"), .finished(.stop)],
                       "空 data 心跳事件应被忽略，不能把整次运行判成无法解析")
    }

    func testSSEParserDoesNotDispatchEmptyDataEvents() {
        var parser = AgentSSEParser()
        XCTAssertNil(parser.consume(line: "data:"))
        XCTAssertNil(parser.consume(line: ""), "空的 data 事件按 SSE 规范不派发")
        XCTAssertNil(parser.consume(line: "data: "))
        XCTAssertNil(parser.consume(line: ""))
        XCTAssertNil(parser.finish())
    }

    func testMidStreamNetworkFailureMapsToNetworkError() async throws {
        let session = AgentAuditTransport.session([
            .init(body: AgentAuditTransport.textChunk("书里"), failure: URLError(.networkConnectionLost)),
        ])
        let model = AgentAuditTransport.openAI(session)
        let executor = makeExecutor(model: model, source: StubBookSource(), root: root)
        let events = await collectEvents(executor.start(AgentRunRequest(
            conversationID: UUID(), bookID: "book-1", bookTitle: "测试书", messages: [.user("问")])))
        XCTAssertEqual(agentFailed(events)?.code, .network)
    }

    func testStreamTimeoutMapsToTimeoutFailure() async throws {
        let session = AgentAuditTransport.session([
            .init(body: AgentAuditTransport.textChunk("书里"), failure: URLError(.timedOut)),
        ])
        let model = AgentAuditTransport.openAI(session)
        let executor = makeExecutor(model: model, source: StubBookSource(), root: root)
        let events = await collectEvents(executor.start(AgentRunRequest(
            conversationID: UUID(), bookID: "book-1", bookTitle: "测试书", messages: [.user("问")])))
        XCTAssertEqual(agentFailed(events)?.code, .timeout)
    }
}

// MARK: - 对抗性审计：工具循环

private struct AgentAuditThrowingTool: AgentTool {
    var spec: AgentToolSpec {
        AgentToolSpec(name: "explode", description: "总是抛错的测试工具", inputSchemaJSON: #"{"type":"object"}"#)
    }
    func call(_ arguments: AgentToolArguments, context: AgentToolCallContext) async throws -> AgentToolResult {
        throw AgentToolError.failed("模拟工具故障")
    }
}

/// 检索很慢（100ms）的数据源，用于验证 runTimeout 在步间的兜底。
private struct AgentAuditSlowBookSource: AgentBookSource {
    func search(_ query: String, limit: Int) async throws -> [AgentBookExcerpt] {
        try await Task.sleep(nanoseconds: 100_000_000)
        return [agentExcerpt("书里的原文句子")]
    }
    func page(_ page: Int, maxCharacters: Int) async throws -> AgentBookPassage? { nil }
    func chapter(_ reference: String, maxCharacters: Int) async throws -> AgentBookPassage? { nil }
    func tableOfContents() async throws -> [AgentBookTOCEntry] { [] }
    func chapterList() async throws -> [AgentBookTOCEntry] { [] }
}

/// 第一次给出工具调用，第二次流式输出后一直挂起，用于「第二步取消」。
private final class AgentAuditBlockingSecondModel: AgentChatModel, @unchecked Sendable {
    private let lock = NSLock()
    private var calls = 0
    var modelIdentifier: String { "blocking-second-model" }

    func stream(messages: [AgentMessage], tools: [AgentToolSpec], options: AgentModelOptions)
        -> AsyncThrowingStream<AgentModelEvent, Error> {
        lock.lock()
        let call = calls
        calls += 1
        lock.unlock()
        if call == 0 {
            return AsyncThrowingStream { continuation in
                continuation.yield(.toolCall(AgentToolCall(id: "call_1", name: "search_book",
                                                           argumentsJSON: #"{"query":"原文"}"#)))
                continuation.yield(.finished(.toolCalls))
                continuation.finish()
            }
        }
        return AsyncThrowingStream { continuation in
            let task = Task {
                continuation.yield(.textDelta("思考中"))
                do { try await Task.sleep(nanoseconds: 30_000_000_000) } catch {
                    continuation.finish(throwing: CancellationError())
                    return
                }
                continuation.finish()
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }
}

final class AgentAdversarialToolLoopTests: XCTestCase {
    private var root: URL!

    override func setUpWithError() throws {
        root = agentTemporaryRoot("audit-loop")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: root)
    }

    private func request() -> AgentRunRequest {
        AgentRunRequest(conversationID: UUID(), bookID: "book-1", bookTitle: "测试书",
                        messages: [.user("这本书讲了什么？")])
    }

    private func makeSourceExecutor(model: any AgentChatModel, source: any AgentBookSource,
                                    configuration: AgentRuntimeConfiguration = AgentRuntimeConfiguration()) -> AgentExecutor {
        let environment = BookAgentEnvironment(bookID: "book-1", bookTitle: "测试书", source: source,
                                               notes: [], currentLocation: nil)
        return AgentExecutor(model: model,
                             tools: AgentToolRegistry(BookAgentTools.make(environment: environment)),
                             context: AgentContextManager(),
                             checkpoints: AgentCheckpointStore(root: root),
                             verifier: AcceptAllVerifier(),
                             configuration: configuration)
    }

    private func makeToolExecutor(model: any AgentChatModel, tools: [any AgentTool],
                                  configuration: AgentRuntimeConfiguration = AgentRuntimeConfiguration(),
                                  checkpoints: AgentCheckpointStore? = nil) -> AgentExecutor {
        AgentExecutor(model: model,
                      tools: AgentToolRegistry(tools),
                      context: AgentContextManager(),
                      checkpoints: checkpoints ?? AgentCheckpointStore(root: root),
                      verifier: AcceptAllVerifier(),
                      configuration: configuration)
    }

    func testMalformedToolArgumentsBecomeErrorResultAndLoopContinues() async throws {
        let source = StubBookSource(searchResults: [agentExcerpt("书里的原文句子")])
        let model = ScriptedChatModel([
            [.toolCall(AgentToolCall(id: "call_1", name: "search_book", argumentsJSON: "not-json")),
             .finished(.toolCalls)],
            [.textDelta(#"{"answer":"仍然回答。","citations":[]}"#), .finished(.stop)],
        ])
        let executor = makeExecutor(model: model, source: source, root: root)
        let events = await collectEvents(executor.start(request()))

        XCTAssertTrue(events.contains {
            if case .toolFinished(let finished) = $0 {
                return finished.isError && finished.call.name == "search_book"
                    && finished.content.contains("工具执行失败")
            }
            return false
        })
        let result = try XCTUnwrap(agentCompleted(events), "参数错误不应终止整次运行")
        XCTAssertEqual(result.answer, "仍然回答。")
        XCTAssertEqual(model.requests.count, 2)
        XCTAssertEqual(model.requests[1].last?.role, .tool)
        XCTAssertTrue(model.requests[1].last?.isError == true)
    }

    func testTooManyToolCallsExecutesLimitAndReturnsErrorsForRest() async throws {
        let source = StubBookSource(searchResults: [agentExcerpt("书里的原文句子")])
        let calls = (0..<8).map { AgentToolCall(id: "call_\($0)", name: "search_book",
                                                argumentsJSON: #"{"query":"原文"}"#) }
        let model = ScriptedChatModel([
            calls.map { AgentModelEvent.toolCall($0) } + [.finished(.toolCalls)],
            [.textDelta(#"{"answer":"结果过多。","citations":[]}"#), .finished(.stop)],
        ])
        let executor = makeExecutor(model: model, source: source, root: root)
        let events = await collectEvents(executor.start(request()))

        let started = events.filter { if case .toolStarted = $0 { return true }; return false }
        XCTAssertEqual(started.count, 8, "每个调用都应给出 toolStarted（含被拒绝的）")
        let finished = events.compactMap { event -> AgentToolFinished? in
            if case .toolFinished(let value) = event { return value }; return nil
        }
        XCTAssertEqual(finished.filter { !$0.isError }.count, 6, "单步最多执行 6 个工具")
        XCTAssertEqual(finished.filter { $0.isError }.count, 2, "超出的调用应回填错误结果")
        let delivered = try XCTUnwrap(model.requests[1].last(where: { $0.role == .tool }))
        XCTAssertTrue(delivered.content.contains("单步工具调用过多"))
        XCTAssertTrue(events.contains { if case .completed = $0 { return true }; return false })
        // 第二个请求必须为全部 8 个 tool_calls 提供结果，否则 provider 会 400。
        let toolMessages = model.requests[1].filter { $0.role == .tool }
        XCTAssertEqual(toolMessages.count, 8)
        XCTAssertEqual(toolMessages.compactMap(\.toolCallID).count, 8)
    }

    func testDuplicateToolCallsRegisterOneEvidenceAndBothRun() async throws {
        let source = StubBookSource(searchResults: [agentExcerpt("书里的原文句子")])
        let first = AgentToolCall(id: "call_1", name: "search_book", argumentsJSON: #"{"query":"原文"}"#)
        let second = AgentToolCall(id: "call_2", name: "search_book", argumentsJSON: #"{"query":"原文"}"#)
        let model = ScriptedChatModel([
            [.toolCall(first), .toolCall(second), .finished(.toolCalls)],
            [.textDelta(#"{"answer":"书里说的是原文。","citations":[{"id":"E1","quote":"书里的原文"}]}"#),
             .finished(.stop)],
        ])
        let executor = makeExecutor(model: model, source: source, root: root)
        let events = await collectEvents(executor.start(request()))

        let finished = events.compactMap { event -> AgentToolFinished? in
            if case .toolFinished(let value) = event { return value }; return nil
        }
        XCTAssertEqual(finished.count, 2)
        XCTAssertTrue(finished.allSatisfy { !$0.isError })
        XCTAssertTrue(finished.allSatisfy { $0.content.contains("[E1]") }, "相同原文应复用同一个证据 id")
        let result = try XCTUnwrap(agentCompleted(events))
        XCTAssertEqual(result.citations.map(\.id), ["E1"])
        XCTAssertEqual(model.requests[1].filter { $0.role == .tool }.count, 2)
    }

    func testThrowingToolIsReturnedAsErrorAndRunRecovers() async throws {
        let model = ScriptedChatModel([
            [.toolCall(AgentToolCall(id: "call_1", name: "explode", argumentsJSON: "{}")), .finished(.toolCalls)],
            [.textDelta(#"{"answer":"工具坏了但还能回答。","citations":[]}"#), .finished(.stop)],
        ])
        let executor = makeToolExecutor(model: model, tools: [AgentAuditThrowingTool()])
        let events = await collectEvents(executor.start(request()))

        let failedTool = events.compactMap { event -> AgentToolFinished? in
            if case .toolFinished(let value) = event { return value }; return nil
        }.first
        XCTAssertEqual(failedTool?.isError, true)
        XCTAssertTrue(failedTool?.content.contains("模拟工具故障") == true)
        XCTAssertEqual(agentCompleted(events)?.answer, "工具坏了但还能回答。")
    }

    func testInvalidFinalJSONFallsBackToPlainTextWithWarning() async throws {
        let model = ScriptedChatModel([
            [.textDelta("这是纯文本回答，不包含 JSON。"), .finished(.stop)],
        ])
        let executor = makeExecutor(model: model, source: StubBookSource(), root: root)
        let events = await collectEvents(executor.start(request()))

        let result = try XCTUnwrap(agentCompleted(events))
        XCTAssertEqual(result.answer, "这是纯文本回答，不包含 JSON。")
        XCTAssertTrue(result.citations.isEmpty)
        XCTAssertTrue(result.warning.contains("未提供可核查格式"), "应提示回答不是可核查 JSON：\(result.warning)")
    }

    func testEmptyJSONAnswerFailsInsteadOfSilentSuccess() async throws {
        let model = ScriptedChatModel([
            [.textDelta(#"{"answer":"   ","citations":[]}"#), .finished(.stop)],
        ])
        let executor = makeExecutor(model: model, source: StubBookSource(), root: root)
        let events = await collectEvents(executor.start(request()))

        XCTAssertEqual(agentFailed(events)?.code, .invalidResponse)
        XCTAssertNil(agentCompleted(events))
    }

    func testParallelToolCallsInOneStepAreBothExecuted() async throws {
        let page = AgentBookPassage(title: "第 1 页", page: 1,
                                    excerpts: [agentExcerpt("第一页原文", title: "第 1 页", page: 1)],
                                    truncated: false)
        let source = StubBookSource(searchResults: [agentExcerpt("书里的原文句子")], pages: [1: page])
        let model = ScriptedChatModel([
            [.toolCall(AgentToolCall(id: "call_a", name: "search_book", argumentsJSON: #"{"query":"原文"}"#)),
             .toolCall(AgentToolCall(id: "call_b", name: "read_page", argumentsJSON: #"{"page":1}"#)),
             .finished(.toolCalls)],
            [.textDelta(#"{"answer":"两处都读了。","citations":[]}"#), .finished(.stop)],
        ])
        let executor = makeExecutor(model: model, source: source, root: root)
        let events = await collectEvents(executor.start(request()))

        let finished = events.compactMap { event -> AgentToolFinished? in
            if case .toolFinished(let value) = event { return value }; return nil
        }
        XCTAssertEqual(Set(finished.map(\.call.name)), ["search_book", "read_page"])
        XCTAssertTrue(finished.allSatisfy { !$0.isError })
        let toolMessages = model.requests[1].filter { $0.role == .tool }
        XCTAssertEqual(toolMessages.compactMap(\.toolCallID), ["call_a", "call_b"])
    }

    func testResumeCheckpointWithDanglingToolCallBackfillsResult() async throws {
        let conversationID = UUID()
        let call = AgentToolCall(id: "call_lost", name: "search_book", argumentsJSON: #"{"query":"原文"}"#)
        let now = Date()
        let checkpoint = AgentCheckpoint(
            conversationID: conversationID, bookID: "book-1", bookTitle: "测试书",
            createdAt: now, updatedAt: now, status: .running, model: "stub-model",
            messages: [.user("旧问题"), .assistant("", toolCalls: [call])], steps: 1,
            result: nil, failure: nil, warnings: [], context: nil)
        try AgentCheckpointStore(root: root).save(checkpoint)

        let model = ScriptedChatModel([
            [.textDelta(#"{"answer":"续跑完成。","citations":[]}"#), .finished(.stop)],
        ])
        let executor = makeExecutor(model: model, source: StubBookSource(), root: root)
        let events = await collectEvents(executor.start(AgentRunRequest(
            conversationID: conversationID, bookID: "book-1", bookTitle: "测试书",
            messages: [.user("追问")], checkpoint: checkpoint)))

        let sent = model.requests[0]
        let repairedIndex = try XCTUnwrap(sent.firstIndex { $0.role == .tool && $0.toolCallID == "call_lost" })
        let assistantIndex = try XCTUnwrap(sent.firstIndex { $0.role == .assistant && !$0.toolCalls.isEmpty })
        XCTAssertLessThan(assistantIndex, repairedIndex, "补回的工具结果必须在 assistant tool_calls 之后")
        XCTAssertTrue(sent[repairedIndex].isError, "上次中断的工具应补错误结果")
        XCTAssertEqual(agentCompleted(events)?.answer, "续跑完成。")
    }

    func testAnswerTruncationAddsWarningAndEllipsis() async throws {
        var configuration = AgentRuntimeConfiguration()
        configuration.maxAnswerCharacters = 10
        let long = String(repeating: "长", count: 30)
        let model = ScriptedChatModel([
            [.textDelta("{\"answer\":\"\(long)\",\"citations\":[]}"), .finished(.stop)],
        ])
        let executor = makeExecutor(model: model, source: StubBookSource(), root: root, configuration: configuration)
        let events = await collectEvents(executor.start(request()))

        let result = try XCTUnwrap(agentCompleted(events))
        XCTAssertEqual(result.answer, String(long.prefix(10)) + "…")
        XCTAssertTrue(agentWarnings(events).contains { $0.code == .answerTruncated })
    }

    func testRunTimeoutIsEnforcedAfterSlowToolReturns() async throws {
        let model = ScriptedChatModel([
            [.toolCall(AgentToolCall(id: "call_1", name: "search_book", argumentsJSON: #"{"query":"原文"}"#)),
             .finished(.toolCalls)],
            [.textDelta(#"{"answer":"不该走到这里。","citations":[]}"#), .finished(.stop)],
        ])
        var configuration = AgentRuntimeConfiguration()
        configuration.runTimeout = 0.03
        let executor = makeSourceExecutor(model: model, source: AgentAuditSlowBookSource(),
                                          configuration: configuration)
        let started = Date()
        let events = await collectEvents(executor.start(request()))
        XCTAssertEqual(agentFailed(events)?.code, .timeout)
        XCTAssertLessThan(Date().timeIntervalSince(started), 5, "慢工具返回后应立即在步间超时，而不是继续下一轮")
        XCTAssertEqual(model.requests.count, 1)
    }
}

// MARK: - 对抗性审计：上下文与检查点

final class AgentAdversarialContextTests: XCTestCase {
    private var root: URL!

    override func setUpWithError() throws {
        root = agentTemporaryRoot("audit-context")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: root)
    }

    private func request(messages: [AgentMessage] = [.user("这本书讲了什么？")],
                         checkpoint: AgentCheckpoint? = nil) -> AgentRunRequest {
        AgentRunRequest(conversationID: UUID(), bookID: "book-1", bookTitle: "测试书",
                        messages: messages, checkpoint: checkpoint)
    }

    func testLongHistoryWithoutSummarizerTrimsAndKeepsLastTurn() async {
        var messages: [AgentMessage] = []
        for index in 0..<10 {
            messages.append(.user(String(repeating: "问题\(index)", count: 50)))
            messages.append(.assistant(String(repeating: "回答\(index)", count: 50)))
        }
        let budget = AgentContextBudget(maxContextTokens: 1200, reserveForResponseTokens: 200,
                                        recentMessagesToKeep: 4)
        let manager = AgentContextManager(budget: budget)
        let plan = await manager.prepare(systemPrompt: "规则", messages: messages)
        XCTAssertFalse(plan.overBudget)
        XCTAssertGreaterThan(plan.usage.trimmedMessages, 0)
        XCTAssertTrue(plan.messages.contains { $0.content.contains("问题9") }, "必须保留最后一轮")
        XCTAssertTrue(plan.actions.contains { if case .trimmedHistory = $0 { return true }; return false })
    }

    func testContextOverBudgetMidRunFailsExplicitlyAfterOneRequest() async throws {
        let longText = String(repeating: "原", count: 1200)
        let source = StubBookSource(searchResults: [agentExcerpt(longText)])
        let model = ScriptedChatModel([
            [.toolCall(AgentToolCall(id: "call_1", name: "search_book", argumentsJSON: #"{"query":"原"}"#)),
             .finished(.toolCalls)],
            [.textDelta(#"{"answer":"不该走到这里。","citations":[]}"#), .finished(.stop)],
        ])
        let budget = AgentContextBudget(maxContextTokens: 800, reserveForResponseTokens: 300)
        let executor = makeExecutor(model: model, source: source, root: root, budget: budget)
        let events = await collectEvents(executor.start(request()))

        XCTAssertEqual(agentFailed(events)?.code, .contextBudget)
        XCTAssertNil(agentCompleted(events))
        XCTAssertEqual(model.requests.count, 1, "超预算应在第二次模型请求前中止")
        let snapshots = events.compactMap { event -> AgentContextSnapshot? in
            if case .context(let value) = event { return value }; return nil
        }
        XCTAssertTrue(snapshots.contains { snapshot in
            snapshot.actions.contains { if case .overBudget = $0 { return true }; return false }
        })
    }

    func testSummarizerFailureDuringRunFallsBackToTrimming() async throws {
        var history: [AgentMessage] = []
        for index in 0..<6 {
            history.append(.user(String(repeating: "历史问题\(index)", count: 40)))
            history.append(.assistant(String(repeating: "历史回答\(index)", count: 40)))
        }
        let conversationID = UUID()
        let now = Date()
        let checkpoint = AgentCheckpoint(
            conversationID: conversationID, bookID: "book-1", bookTitle: "测试书",
            createdAt: now, updatedAt: now, status: .running, model: "stub-model",
            messages: history, steps: 1, result: nil, failure: nil, warnings: [], context: nil)
        try AgentCheckpointStore(root: root).save(checkpoint)

        let model = ScriptedChatModel([
            [.textDelta(#"{"answer":"摘要失败也能答。","citations":[]}"#), .finished(.stop)],
        ])
        let budget = AgentContextBudget(maxContextTokens: 1400, reserveForResponseTokens: 200,
                                        recentMessagesToKeep: 4, summaryTargetCharacters: 100)
        let executor = makeExecutor(model: model, source: StubBookSource(), root: root,
                                    budget: budget, summarizer: FailingSummarizer())
        let events = await collectEvents(executor.start(request(messages: [.user("追问")], checkpoint: checkpoint)))

        let result = try XCTUnwrap(agentCompleted(events))
        XCTAssertEqual(result.answer, "摘要失败也能答。")
        XCTAssertEqual(model.requests.count, 1)
        let actions = events.compactMap { event -> [AgentContextAction]? in
            if case .context(let value) = event { return value.actions }; return nil
        }.flatMap { $0 }
        XCTAssertTrue(actions.contains { if case .trimmedHistory = $0 { return true }; return false },
                      "摘要失败应降级为裁剪：\(actions)")
    }

    func testCheckpointSaveFailureEmitsWarningAndRunStillCompletes() async throws {
        let blockedRoot = agentTemporaryRoot("audit-blocked")
        try Data("not-a-directory".utf8).write(to: blockedRoot)
        defer { try? FileManager.default.removeItem(at: blockedRoot) }

        let model = ScriptedChatModel([
            [.textDelta(#"{"answer":"存储失败也能答。","citations":[]}"#), .finished(.stop)],
        ])
        let executor = makeExecutor(model: model, source: StubBookSource(), root: blockedRoot)
        let events = await collectEvents(executor.start(request()))

        XCTAssertEqual(agentCompleted(events)?.answer, "存储失败也能答。")
        XCTAssertTrue(agentWarnings(events).contains { $0.code == .checkpointStorage },
                      "检查点写入失败应给出可见 warning 而不是静默失败")
    }

    func testCancellationDuringSecondStepSavesCancelledCheckpoint() async throws {
        let source = StubBookSource(searchResults: [agentExcerpt("书里的原文句子")])
        let conversationID = UUID()
        let executor = makeExecutor(model: AgentAuditBlockingSecondModel(), source: source, root: root)
        let session = executor.start(AgentRunRequest(conversationID: conversationID, bookID: "book-1",
                                                     bookTitle: "测试书", messages: [.user("问题")]))
        var sawCancelled = false
        for await event in session.events {
            if case .step(let step) = event, step.index == 2 { session.cancel() }
            if case .cancelled = event { sawCancelled = true }
        }
        await session.wait()
        XCTAssertTrue(sawCancelled)
        let saved = try XCTUnwrap(try AgentCheckpointStore(root: root).load(conversationID: conversationID))
        XCTAssertEqual(saved.status, .cancelled)
    }
}

// MARK: - 上下文窗口 / 阈值压缩 / 摘要持久化

/// 记录摘要调用次数：用于断言「低于阈值零摘要」。
private final class AgentCountingSummarizer: AgentHistorySummarizer, @unchecked Sendable {
    private let lock = NSLock()
    private var count = 0
    private let text: String

    init(text: String = "旧对话摘要内容") { self.text = text }

    var calls: Int {
        lock.lock()
        defer { lock.unlock() }
        return count
    }

    func summarize(_ messages: [AgentMessage]) async throws -> String {
        lock.lock()
        count += 1
        lock.unlock()
        return text
    }
}

private func agentAuditHistory(turns: Int, characters: Int) -> [AgentMessage] {
    var messages: [AgentMessage] = []
    for index in 0..<turns {
        messages.append(.user("第\(index)问" + String(repeating: "问", count: characters)))
        messages.append(.assistant("第\(index)答" + String(repeating: "答", count: characters)))
    }
    return messages
}

final class AgentContextManagementTests: XCTestCase {
    private var root: URL!

    override func setUpWithError() throws {
        root = agentTemporaryRoot("context-management")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: root)
    }

    func testBelowThresholdDoesNotSummarizeOrCompress() async throws {
        let summarizer = AgentCountingSummarizer()
        let store = AgentContextSummaryStore(root: root)
        let budget = AgentContextBudget(contextWindow: 128_000, outputReserveTokens: 1_400)
        let manager = AgentContextManager(budget: budget, summarizer: summarizer, summaries: store)
        let conversationID = UUID()

        let plan = await manager.prepare(conversationID: conversationID, systemPrompt: "只依据书内材料",
                                         messages: agentAuditHistory(turns: 3, characters: 50))
        XCTAssertEqual(plan.usage.action, .none, "低于阈值不应压缩/摘要")
        XCTAssertEqual(summarizer.calls, 0, "低于阈值不应调用摘要模型")
        XCTAssertEqual(plan.usage.contextWindow, 128_000)
        XCTAssertEqual(plan.usage.thresholdTokens, 102_400)
        XCTAssertEqual(plan.usage.limitTokens, plan.usage.thresholdTokens)
        XCTAssertEqual(plan.usage.systemTokens, AgentTokenEstimator().estimate("只依据书内材料"))
        XCTAssertEqual(plan.usage.toolTokens, 0)
        XCTAssertEqual(plan.usage.estimatedTokens,
                       plan.usage.systemTokens + plan.usage.historyTokens + plan.usage.toolTokens + plan.usage.summaryTokens)
        XCTAssertLessThan(plan.usage.percent, plan.usage.thresholdPercent)
        XCTAssertEqual(plan.usage.thresholdPercent, 0.8, accuracy: 0.001)
        XCTAssertEqual(plan.messages.first, .system("只依据书内材料"), "system 提示必须始终发送且在最先")
        XCTAssertNil(store.load(conversationID))
        XCTAssertTrue(plan.actions.contains(.withinBudget))
    }

    func testThresholdCompactionSummarizesOldAndKeepsRecent() async throws {
        let summarizer = AgentCountingSummarizer(text: "旧对话摘要内容")
        let store = AgentContextSummaryStore(root: root)
        let budget = AgentContextBudget(contextWindow: 4_000, outputReserveTokens: 500, headroomTokens: 500)
        XCTAssertEqual(budget.thresholdTokens, 3_000)
        let manager = AgentContextManager(budget: budget, summarizer: summarizer, summaries: store)
        let conversationID = UUID()
        let history = agentAuditHistory(turns: 8, characters: 200)

        let plan = await manager.prepare(conversationID: conversationID, systemPrompt: "规则", messages: history)
        XCTAssertEqual(summarizer.calls, 1, "达到阈值才压缩一次")
        XCTAssertEqual(plan.usage.action, .compacted)
        XCTAssertGreaterThan(plan.usage.summarizedMessages, 0)
        XCTAssertLessThanOrEqual(plan.usage.estimatedTokens, budget.thresholdTokens)
        XCTAssertGreaterThan(plan.usage.summaryTokens, 0)
        XCTAssertGreaterThan(plan.usage.historyTokens, 0)
        XCTAssertTrue(plan.messages.contains { $0.role == .system && $0.content.contains("旧对话摘要内容") })
        XCTAssertTrue(plan.messages.contains { $0.content.contains("第7问") }, "必须保留最近一轮")
        XCTAssertFalse(plan.messages.contains { $0.content.contains("第0问") }, "最旧历史应被摘要替代")
        XCTAssertEqual(plan.messages.first, .system("规则"))
        // 保留区不得拆开 assistant tool_calls 与工具结果。
        for (index, message) in plan.messages.enumerated() where message.role == .tool {
            let previous = index > 0 ? plan.messages[index - 1].role : nil
            XCTAssertTrue(previous == .assistant || previous == .tool, "工具结果必须跟在其调用之后")
        }
        let stored = try XCTUnwrap(store.load(conversationID))
        XCTAssertEqual(stored.text, "旧对话摘要内容")
        XCTAssertGreaterThan(stored.summarizedMessages, 0)
        XCTAssertEqual(plan.summaryReference?.summarizedMessages, stored.summarizedMessages)
    }

    func testPersistedSummaryIsUsedNextTurnWithoutResummarizing() async throws {
        let summarizer = AgentCountingSummarizer(text: "旧对话摘要内容")
        let store = AgentContextSummaryStore(root: root)
        let budget = AgentContextBudget(contextWindow: 4_000, outputReserveTokens: 500, headroomTokens: 500)
        let manager = AgentContextManager(budget: budget, summarizer: summarizer, summaries: store)
        let conversationID = UUID()
        let history = agentAuditHistory(turns: 8, characters: 200)
        let first = await manager.prepare(conversationID: conversationID, systemPrompt: "规则", messages: history)
        XCTAssertEqual(first.usage.action, .compacted)
        let stored = try XCTUnwrap(store.load(conversationID))

        // 下一轮：历史仍带完整消息（checkpoint 语义），但已摘要前缀应跳过、摘要作为 system 前缀复用。
        let nextMessages = history + [.user("追问：继续"), .assistant("继续回答")]
        let next = await manager.prepare(conversationID: conversationID, systemPrompt: "规则", messages: nextMessages)
        XCTAssertEqual(summarizer.calls, 1, "已持久化的摘要不应再次摘要")
        XCTAssertEqual(next.usage.action, .none)
        XCTAssertTrue(next.messages.contains { $0.role == .system && $0.content.contains("旧对话摘要内容") })
        XCTAssertTrue(next.messages.contains { $0.content.contains("追问：继续") })
        XCTAssertFalse(next.messages.contains { $0.content.contains("第0问") }, "已摘要的历史前缀不应重复发送")
        XCTAssertEqual(next.messages.filter { $0.role == .system && $0.content.contains("旧对话摘要内容") }.count, 1)
        XCTAssertEqual(store.load(conversationID)?.summarizedMessages, stored.summarizedMessages)
    }

    func testSummaryFailureFallsBackToTrimming() async throws {
        let store = AgentContextSummaryStore(root: root)
        let budget = AgentContextBudget(contextWindow: 4_000, outputReserveTokens: 500, headroomTokens: 500)
        let manager = AgentContextManager(budget: budget, summarizer: FailingSummarizer(), summaries: store)
        let conversationID = UUID()

        let plan = await manager.prepare(conversationID: conversationID, systemPrompt: "规则",
                                         messages: agentAuditHistory(turns: 8, characters: 200))
        XCTAssertEqual(plan.usage.action, .trimmed)
        XCTAssertGreaterThan(plan.usage.trimmedMessages, 0)
        XCTAssertEqual(plan.usage.summarizedMessages, 0)
        XCTAssertLessThanOrEqual(plan.usage.estimatedTokens, budget.thresholdTokens)
        XCTAssertFalse(plan.overBudget)
        XCTAssertNil(store.load(conversationID), "摘要失败不应写入空摘要")
        XCTAssertTrue(plan.messages.contains { $0.content.contains("第7问") })
    }

    func testUnsatisfiableWindowReportsOverBudgetAfterRetry() async throws {
        let budget = AgentContextBudget(contextWindow: 4_000, outputReserveTokens: 500, headroomTokens: 500)
        let manager = AgentContextManager(budget: budget)
        let plan = await manager.prepare(systemPrompt: "规则",
                                         messages: [.user(String(repeating: "超长问题", count: 1_000))])
        XCTAssertTrue(plan.overBudget)
        XCTAssertEqual(plan.usage.action, .none)
        XCTAssertGreaterThan(plan.usage.estimatedTokens, budget.thresholdTokens)
        XCTAssertTrue(plan.actions.contains { if case .overBudget = $0 { return true }; return false })
    }

    func testOversizedToolResultsArePrunedBeforeSummarizing() async throws {
        let summarizer = AgentCountingSummarizer()
        let budget = AgentContextBudget(contextWindow: 4_000, outputReserveTokens: 500, headroomTokens: 500,
                                        maxToolResultCharacters: 200)
        let manager = AgentContextManager(budget: budget, summarizer: summarizer)
        let call = AgentToolCall(id: "call_1", name: "read_page", argumentsJSON: "{}")
        let messages: [AgentMessage] = [
            .user("问题"),
            .assistant("", toolCalls: [call]),
            .tool(call, content: String(repeating: "原", count: 5_000)),
        ]
        let plan = await manager.prepare(systemPrompt: "规则", messages: messages)
        XCTAssertEqual(plan.usage.action, .pruned)
        XCTAssertEqual(plan.usage.truncatedToolResults, 1)
        XCTAssertEqual(summarizer.calls, 0, "仅裁剪工具结果即可回到阈值内时不应摘要")
        let toolMessage = try XCTUnwrap(plan.messages.first { $0.role == .tool })
        XCTAssertTrue(toolMessage.content.contains("裁剪"))
        XCTAssertLessThan(toolMessage.content.count, 500)
    }

    func testSummaryStorePersistsAndDeletes() throws {
        let store = AgentContextSummaryStore(root: root)
        let conversationID = UUID()
        let summary = AgentContextSummary(conversationID: conversationID, text: "摘要正文",
                                          summarizedMessages: 6, updatedAt: Date())
        try store.save(summary)
        let loaded = try XCTUnwrap(store.load(conversationID))
        XCTAssertEqual(loaded.conversationID, conversationID)
        XCTAssertEqual(loaded.text, "摘要正文")
        XCTAssertEqual(loaded.summarizedMessages, 6)
        // iso8601 落盘会丢失亚秒精度，按秒比较。
        XCTAssertEqual(loaded.updatedAt.timeIntervalSince1970,
                       summary.updatedAt.timeIntervalSince1970, accuracy: 1)
        XCTAssertTrue(FileManager.default.fileExists(atPath: store.fileURL(conversationID: conversationID).path))
        store.delete(conversationID)
        XCTAssertNil(store.load(conversationID))
        XCTAssertFalse(FileManager.default.fileExists(atPath: store.fileURL(conversationID: conversationID).path))
    }

    func testUsageDecodesLegacyJSONWithoutNewFields() throws {
        let legacy = Data(#"{"estimatedTokens":123,"characterCount":456,"limitTokens":8400,"summarizedMessages":1,"trimmedMessages":2,"truncatedToolResults":3}"#.utf8)
        let usage = try JSONDecoder().decode(AgentContextUsage.self, from: legacy)
        XCTAssertEqual(usage.estimatedTokens, 123)
        XCTAssertEqual(usage.characterCount, 456)
        XCTAssertEqual(usage.limitTokens, 8_400)
        XCTAssertEqual(usage.thresholdTokens, 8_400, "旧数据没有阈值字段时回退 limitTokens")
        XCTAssertEqual(usage.contextWindow, 0)
        XCTAssertEqual(usage.summarizedMessages, 1)
        XCTAssertEqual(usage.trimmedMessages, 2)
        XCTAssertEqual(usage.truncatedToolResults, 3)
        XCTAssertEqual(usage.action, .none)
        XCTAssertGreaterThan(usage.utilization, 0)
    }

    func testEffectiveContextWindowDefaultsAndOverrides() throws {
        let openAI = AIConfiguration(name: "o", format: .openAI, address: "https://example.com", model: "m")
        XCTAssertNil(openAI.contextWindow)
        XCTAssertEqual(openAI.effectiveContextWindow, 128_000)
        let anthropic = AIConfiguration(name: "a", format: .anthropic, address: "https://example.com", model: "m")
        XCTAssertEqual(anthropic.effectiveContextWindow, 200_000)
        var custom = AIConfiguration(name: "c", format: .openAI, address: "https://example.com", model: "m")
        custom.provider = .custom
        XCTAssertEqual(custom.effectiveContextWindow, 128_000)
        custom.contextWindow = 64_000
        XCTAssertEqual(custom.effectiveContextWindow, 64_000, "显式窗口优先")
        XCTAssertEqual(AIConfiguration.deepSeek.effectiveContextWindow, 128_000)
        // 旧目录 JSON 没有 contextWindow 字段也能读。
        let json = Data(#"{"id":"00000000-0000-0000-0000-000000000001","name":"旧服务","format":"OpenAI","address":"https://example.com","model":"m"}"#.utf8)
        let decoded = try JSONDecoder().decode(AIConfiguration.self, from: json)
        XCTAssertNil(decoded.contextWindow)
        XCTAssertEqual(decoded.effectiveContextWindow, 128_000)
    }

    func testExecutorEmitsRealWindowAndPersistsSummaryReference() async throws {
        let summarizer = AgentCountingSummarizer(text: "旧对话摘要内容")
        let summaries = AgentContextSummaryStore(root: root)
        let budget = AgentContextBudget(contextWindow: 4_000, outputReserveTokens: 500, headroomTokens: 500)
        let model = ScriptedChatModel([
            [.textDelta(#"{"answer":"继续回答。","citations":[]}"#), .finished(.stop)],
        ])
        let executor = makeExecutor(model: model, source: StubBookSource(), root: root, budget: budget,
                                    summarizer: summarizer, summaries: summaries)
        let conversationID = UUID()
        let now = Date()
        let checkpoint = AgentCheckpoint(
            conversationID: conversationID, bookID: "book-1", bookTitle: "测试书",
            createdAt: now, updatedAt: now, status: .running, model: "stub-model",
            messages: agentAuditHistory(turns: 8, characters: 200), steps: 0,
            result: nil, failure: nil, warnings: [], context: nil)
        try AgentCheckpointStore(root: root).save(checkpoint)

        let events = await collectEvents(executor.start(AgentRunRequest(
            conversationID: conversationID, bookID: "book-1", bookTitle: "测试书",
            messages: [], checkpoint: checkpoint)))
        let result = try XCTUnwrap(agentCompleted(events), "应完成回答，事件：\(events)")
        XCTAssertEqual(result.answer, "继续回答。")
        let snapshots = events.compactMap { event -> AgentContextSnapshot? in
            if case .context(let value) = event { return value }; return nil
        }
        let snapshot = try XCTUnwrap(snapshots.last)
        XCTAssertEqual(snapshot.usage.contextWindow, 4_000, "事件必须带真实窗口，而不是固定 10k")
        XCTAssertEqual(snapshot.usage.thresholdTokens, budget.thresholdTokens)
        XCTAssertEqual(snapshot.usage.action, .compacted)
        XCTAssertEqual(summarizer.calls, 1)
        let firstMessage = try XCTUnwrap(model.requests.first?.first)
        XCTAssertEqual(firstMessage.role, .system)
        XCTAssertTrue(firstMessage.content.contains("书灯"), "固定 system 规则必须真实发送给模型")
        let saved = try XCTUnwrap(try AgentCheckpointStore(root: root).load(conversationID: conversationID))
        XCTAssertNotNil(saved.summary, "checkpoint 应记录摘要引用")
        XCTAssertEqual(saved.summary?.summarizedMessages, saved.context?.summarizedMessages ?? 0)
        XCTAssertNotNil(summaries.load(conversationID))
    }
}

// MARK: - DeepSeek 原生思考（task-82）

final class AgentThinkingTests: XCTestCase {
    private var root: URL!

    override func setUpWithError() throws {
        root = agentTemporaryRoot("thinking")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        try? FileManager.default.removeItem(at: root)
    }

    func testReasoningContentChunksBecomeReasoningDeltas() async throws {
        let payload = AgentAuditTransport.reasoningChunk("先查")
            + AgentAuditTransport.reasoningChunk("书内原文")
            + AgentAuditTransport.textChunk("答案")
            + AgentAuditTransport.finishReason("stop")
            + AgentAuditTransport.done
        // 任意分块边界（含切在 reasoning_content 中间）不应丢思考增量。
        let data = Data(payload.utf8)
        var chunks: [Data] = []
        var offset = 0
        while offset < data.count {
            let end = min(offset + 5, data.count)
            chunks.append(data.subdata(in: offset..<end))
            offset = end
        }
        let session = AgentAuditTransport.session([.init(chunks: chunks)])
        let model = AgentAuditTransport.openAI(session)
        let events = try await AgentAuditTransport.collect(model)
        XCTAssertEqual(events, [
            .reasoningDelta("先查"),
            .reasoningDelta("书内原文"),
            .textDelta("答案"),
            .finished(.stop),
        ])
    }

    func testToolLoopSecondRequestCarriesReasoningContent() async throws {
        let searchCall = AgentToolCall(id: "call_1", name: "search_book", argumentsJSON: #"{"query":"原文"}"#)
        let first = AgentAuditTransport.reasoningChunk("先查书内原文")
            + AgentAuditTransport.toolChunk(index: 0, id: searchCall.id, name: searchCall.name,
                                            arguments: searchCall.argumentsJSON)
            + AgentAuditTransport.finishReason("tool_calls")
            + AgentAuditTransport.done
        let second = AgentAuditTransport.textChunk(#"{"answer":"书里说的是原文。","citations":[]}"#)
            + AgentAuditTransport.finishReason("stop")
            + AgentAuditTransport.done
        let session = AgentAuditTransport.session([.init(body: first), .init(body: second)])
        let model = AgentAuditTransport.deepSeekModel(session)
        let source = StubBookSource(searchResults: [agentExcerpt("书里的原文句子")])
        let executor = makeExecutor(model: model, source: source, root: root)
        let events = await collectEvents(executor.start(AgentRunRequest(
            conversationID: UUID(), bookID: "book-1", bookTitle: "测试书", messages: [.user("书里说了什么")])))

        XCTAssertEqual(agentCompleted(events)?.answer, "书里说的是原文。", "事件：\(events)")
        XCTAssertEqual(AgentAuditURLProtocol.requestCount, 2, "工具结果应触发第二轮请求")
        // 第一轮请求：DeepSeek 原生思考参数。
        let firstRequestData = try XCTUnwrap(AgentAuditURLProtocol.requestBodies.first)
        let firstBody = try XCTUnwrap(JSONSerialization.jsonObject(with: firstRequestData) as? [String: Any])
        XCTAssertEqual(firstBody["thinking"] as? [String: String], ["type": "enabled"])
        XCTAssertEqual(firstBody["reasoning_effort"] as? String, "high")
        XCTAssertEqual(firstBody["max_tokens"] as? Int, 16_384)
        XCTAssertGreaterThanOrEqual(AgentAuditURLProtocol.requestTimeouts.first ?? 0, 180)
        // 第二轮请求：assistant 历史必须原样回传 reasoning_content（否则 DeepSeek 带 tools 会 400）。
        let secondRequestData = try XCTUnwrap(AgentAuditURLProtocol.requestBodies.dropFirst().first)
        let secondBody = try XCTUnwrap(JSONSerialization.jsonObject(with: secondRequestData) as? [String: Any])
        let messages = try XCTUnwrap(secondBody["messages"] as? [[String: Any]])
        let assistant = try XCTUnwrap(messages.last { ($0["role"] as? String) == "assistant" && $0["tool_calls"] != nil })
        XCTAssertEqual(assistant["reasoning_content"] as? String, "先查书内原文")
        XCTAssertTrue(events.contains { if case .reasoningDelta(let delta) = $0 { return delta == "先查书内原文" }; return false })
    }

    func testDeepSeekRequestEnablesNativeThinkingAndRaisesBudget() async throws {
        let session = AgentAuditTransport.session([
            .init(body: AgentAuditTransport.textChunk("好") + AgentAuditTransport.finishReason("stop") + AgentAuditTransport.done),
        ])
        let model = AgentAuditTransport.deepSeekModel(session)
        _ = try await AgentAuditTransport.collect(model)
        let requestData = try XCTUnwrap(AgentAuditURLProtocol.requestBodies.first)
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: requestData) as? [String: Any])
        XCTAssertEqual(body["thinking"] as? [String: String], ["type": "enabled"], "DeepSeek 不应再发 thinking:disabled")
        XCTAssertEqual(body["reasoning_effort"] as? String, "high")
        XCTAssertEqual(body["max_tokens"] as? Int, 16_384)
        XCTAssertEqual(body["stream"] as? Bool, true)
        XCTAssertGreaterThanOrEqual(AgentAuditURLProtocol.requestTimeouts.first ?? 0, 180)
    }

    func testNonDeepSeekRequestSendsNoThinkingParameters() async throws {
        let session = AgentAuditTransport.session([
            .init(body: AgentAuditTransport.textChunk("好") + AgentAuditTransport.finishReason("stop") + AgentAuditTransport.done),
        ])
        let model = AgentAuditTransport.openAI(session)
        _ = try await AgentAuditTransport.collect(model)
        let requestData = try XCTUnwrap(AgentAuditURLProtocol.requestBodies.first)
        let body = try XCTUnwrap(JSONSerialization.jsonObject(with: requestData) as? [String: Any])
        XCTAssertNil(body["thinking"], "非 DeepSeek 不应发送 thinking 参数")
        XCTAssertNil(body["reasoning_effort"], "非 DeepSeek 不应发送 reasoning_effort")
        XCTAssertEqual(body["max_tokens"] as? Int, 1_400, "非 DeepSeek 保持原有输出预算")
        XCTAssertLessThan(AgentAuditURLProtocol.requestTimeouts.first ?? .infinity, 100, "非 DeepSeek 保持原有单次超时")
    }

    func testNoReasoningProducesNoFakeThinking() async throws {
        let session = AgentAuditTransport.session([
            .init(body: AgentAuditTransport.textChunk(#"{"answer":"直接回答。","citations":[]}"#)
                + AgentAuditTransport.finishReason("stop") + AgentAuditTransport.done),
        ])
        let model = AgentAuditTransport.openAI(session)
        let conversationID = UUID()
        let executor = makeExecutor(model: model, source: StubBookSource(), root: root)
        let events = await collectEvents(executor.start(AgentRunRequest(
            conversationID: conversationID, bookID: "book-1", bookTitle: "测试书", messages: [.user("问")])))

        XCTAssertFalse(events.contains { if case .reasoningDelta = $0 { return true }; return false },
                       "没有原生 reasoning 时不应产生任何思考事件")
        XCTAssertEqual(agentCompleted(events)?.answer, "直接回答。")
        let checkpoint = try XCTUnwrap(try AgentCheckpointStore(root: root).load(conversationID: conversationID))
        XCTAssertTrue(checkpoint.messages.allSatisfy { $0.reasoningContent == nil }, "无 reasoning 不应伪造历史推理")
        // prompt 不再要求 preamble，也不再提供 JSON reasoning 兜底（思考只来自原生 reasoning）。
        XCTAssertFalse(AgentPrompts.runtimeSystem.contains("2-4 句"))
        XCTAssertFalse(AgentPrompts.runtimeSystem.contains("如何查证"))
        XCTAssertFalse(AgentPrompts.runtimeSystem.contains("\"reasoning\""))
        // 旧模型即使仍返回 reasoning 字段也兼容解析，但内核不再使用它。
        XCTAssertNotNil(AgentAnswerFormat.payload(from: #"{"answer":"a","citations":[],"reasoning":"旧兜底"}"#))
    }

    func testExecutorAttachesReasoningToAssistantHistory() async throws {
        let conversationID = UUID()
        let source = StubBookSource(searchResults: [agentExcerpt("书里的原文句子")])
        let model = ScriptedChatModel([
            [.reasoningDelta("思考A：先查书"), .toolCall(AgentToolCall(id: "call_1", name: "search_book",
                                                                      argumentsJSON: #"{"query":"原文"}"#)),
             .finished(.toolCalls)],
            [.reasoningDelta("思考B：整理引用"),
             .textDelta(#"{"answer":"书里说的是原文。","citations":[{"id":"E1","quote":"书里的原文"}]}"#),
             .finished(.stop)],
        ])
        let executor = makeExecutor(model: model, source: source, root: root)
        let events = await collectEvents(executor.start(AgentRunRequest(
            conversationID: conversationID, bookID: "book-1", bookTitle: "测试书", messages: [.user("问")])))

        XCTAssertEqual(agentCompleted(events)?.answer, "书里说的是原文。")
        let checkpoint = try XCTUnwrap(try AgentCheckpointStore(root: root).load(conversationID: conversationID))
        let toolRound = try XCTUnwrap(checkpoint.messages.first { $0.role == .assistant && !$0.toolCalls.isEmpty })
        XCTAssertEqual(toolRound.reasoningContent, "思考A：先查书", "工具轮的 reasoning 必须随 assistant 消息入历史")
        let finalMessage = try XCTUnwrap(checkpoint.messages.last { $0.role == .assistant })
        XCTAssertEqual(finalMessage.reasoningContent, "思考B：整理引用")
        // 第二请求里 assistant 消息要带回上一轮 reasoning（ScriptedChatModel 也记录请求）。
        let secondRequest = try XCTUnwrap(model.requests.last)
        let assistant = try XCTUnwrap(secondRequest.first { $0.role == .assistant && !$0.toolCalls.isEmpty })
        XCTAssertEqual(assistant.reasoningContent, "思考A：先查书")
        XCTAssertTrue(events.contains { if case .reasoningDelta = $0 { return true }; return false })
    }

    func testAgentMessageReasoningCodableBackwardCompatible() throws {
        let legacy = Data(#"{"role":"assistant","content":"旧消息","toolCalls":[]}"#.utf8)
        let old = try JSONDecoder().decode(AgentMessage.self, from: legacy)
        XCTAssertEqual(old.content, "旧消息")
        XCTAssertNil(old.reasoningContent, "旧检查点没有 reasoningContent 应可解码")

        let message = AgentMessage.assistant("回答", reasoningContent: "原生思考")
        let roundtrip = try JSONDecoder().decode(AgentMessage.self, from: JSONEncoder().encode(message))
        XCTAssertEqual(roundtrip.reasoningContent, "原生思考")
    }

    func testDeepSeekRuntimeBudgetTuningDoesNotAffectOtherProviders() {
        let defaults = AgentRuntimeConfiguration()
        XCTAssertEqual(defaults.runTimeout, 240)
        XCTAssertEqual(defaults.modelOptions.maxTokens, 1_400)
        XCTAssertEqual(defaults.modelOptions.timeout, 90)

        let deepSeek = defaults.applyingThinkingBudget(for: AgentAuditTransport.deepSeekConfiguration())
        XCTAssertEqual(deepSeek.runTimeout, 300)
        XCTAssertEqual(deepSeek.modelOptions.maxTokens, 16_384)
        XCTAssertEqual(deepSeek.modelOptions.timeout, 180)

        let openAI = AIConfiguration(name: "o", format: .openAI, address: "https://api.openai.com", model: "gpt-4o")
        let untouched = defaults.applyingThinkingBudget(for: openAI)
        XCTAssertEqual(untouched.runTimeout, defaults.runTimeout)
        XCTAssertEqual(untouched.modelOptions.maxTokens, defaults.modelOptions.maxTokens)
        XCTAssertEqual(untouched.modelOptions.timeout, defaults.modelOptions.timeout)
    }

    func testDeepSeekThinkingDetectionByPresetModelAndHost() {
        XCTAssertTrue(AgentAuditTransport.deepSeekConfiguration().agentUsesDeepSeekThinking)
        var modelOnly = AIConfiguration(name: "c", format: .openAI, address: "https://gateway.example.com",
                                        model: "deepseek-v4-pro")
        XCTAssertTrue(modelOnly.agentUsesDeepSeekThinking, "模型名 deepseek* 也应开启原生思考")
        modelOnly.model = "gpt-4o"
        modelOnly.address = "https://api.deepseek.com"
        XCTAssertTrue(modelOnly.agentUsesDeepSeekThinking, "官方域名也应开启")
        let plain = AIConfiguration(name: "o", format: .openAI, address: "https://api.openai.com", model: "gpt-4o")
        XCTAssertFalse(plain.agentUsesDeepSeekThinking)
        let anthropic = AIConfiguration(name: "a", format: .anthropic, address: "https://api.deepseek.com",
                                        model: "deepseek-flash", provider: .deepSeek)
        XCTAssertFalse(anthropic.agentUsesDeepSeekThinking, "Anthropic 兼容路径本轮不开启思考参数")
    }
}
