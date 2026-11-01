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
                          summarizer: (any AgentHistorySummarizer)? = nil) -> AgentExecutor {
    let tools = AgentToolRegistry(BookAgentTools.make(environment: AgentTestEnvironment.make(source)))
    let context = AgentContextManager(budget: budget, summarizer: summarizer)
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
        XCTAssertTrue(plan.messages.first?.content.contains("历史摘要") == true)
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
        let budget = AgentContextBudget(maxToolResultCharacters: 200)
        let manager = AgentContextManager(budget: budget)
        let plan = await manager.prepare(systemPrompt: "规则", messages: messages)
        XCTAssertEqual(plan.usage.truncatedToolResults, 1)
        XCTAssertTrue(plan.messages[2].content.contains("裁剪"))
        XCTAssertLessThan(plan.messages[2].content.count, 500)
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
