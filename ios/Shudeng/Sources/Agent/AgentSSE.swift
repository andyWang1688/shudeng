import Foundation

// MARK: - SSE 通用解析

/// 一个 SSE 事件（`event:` 名 + `data:` 内容）。OpenAI 只用 data，Anthropic 两者都用。
struct AgentSSEEvent: Sendable, Equatable {
    let event: String?
    let data: String
}

/// 逐行喂入的 SSE 状态机；空白行派发事件，注释行（`: keep-alive`）忽略。
struct AgentSSEParser {
    private var event: String?
    private var dataLines: [String] = []

    mutating func consume(line rawLine: String) -> AgentSSEEvent? {
        let line = rawLine.hasSuffix("\r") ? String(rawLine.dropLast()) : rawLine
        if line.isEmpty { return dispatch() }
        if line.hasPrefix(":") { return nil }
        if line.hasPrefix("event:") {
            event = String(line.dropFirst("event:".count)).trimmingCharacters(in: .whitespaces)
            return nil
        }
        if line.hasPrefix("data:") {
            var data = String(line.dropFirst("data:".count))
            if data.hasPrefix(" ") { data.removeFirst() }
            dataLines.append(data)
        }
        return nil
    }

    /// 流结束但缺少尾随空行时，把最后一个事件交出去。
    mutating func finish() -> AgentSSEEvent? { dispatch() }

    private mutating func dispatch() -> AgentSSEEvent? {
        defer {
            event = nil
            dataLines = []
        }
        guard !dataLines.isEmpty else { return nil }
        let value = dataLines.joined(separator: "\n")
        // SSE 规范：data 缓冲为空时不派发事件。部分 OpenAI 兼容网关用 `data:` 空行做心跳，
        // 若当成事件交给 decoder 会因 JSON 解析失败而中断整次运行。
        guard !value.isEmpty else { return nil }
        return AgentSSEEvent(event: event, data: value)
    }
}

/// provider 流式解码器；由流式传输层在独立 Task 里创建并持有。
protocol AgentSSEDecoder: AnyObject {
    func consume(_ event: AgentSSEEvent) throws -> [AgentModelEvent]
    func finish() throws -> [AgentModelEvent]
}

// MARK: - HTTP / provider 错误映射

enum AgentStreamErrorMapper {
    /// 复用现有 AIError 语义（鉴权 / 限流 / 容量 / 网络 / 不兼容），并额外识别「不支持工具」。
    static func httpError(status: Int, body: Data) -> Error {
        let detail = errorDetail(body)
        let text = (detail.message ?? "").lowercased()
        let code = (detail.code ?? "").lowercased()
        if (status == 400 || status == 404 || status == 422 || status == 501),
           toolsUnsupported(message: text) {
            return AgentModelError.toolsUnsupported
        }
        switch status {
        case 400:
            if code == "context_length_exceeded"
                || text.contains("context length")
                || text.contains("prompt is too long")
                || text.contains("too many tokens") {
                return AIError.capacity
            }
            return AIError.incompatible
        case 401, 403: return AIError.authentication
        case 413: return AIError.capacity
        case 429: return AIError.limited
        case 500...599: return AIError.network
        default: return AIError.incompatible
        }
    }

    /// 「模型不支持 tools 参数」的文本识别。OpenAI 兼容网关的实现差异很大，这里只匹配
    /// 同时提到工具/函数字段与不支持类措辞的消息，避免把普通参数错误误判成回退信号。
    static func toolsUnsupported(message: String) -> Bool {
        let text = message.lowercased()
        let mentionsTool = text.contains("tool") || text.contains("function")
        guard mentionsTool else { return false }
        let markers = [
            "not support", "unsupported", "does not support", "doesn't support",
            "not allowed", "not permitted", "unknown field", "extra inputs are not permitted",
            "unrecognized", "invalid_request_error", "not available",
        ]
        return markers.contains { text.contains($0) }
    }

    /// OpenAI 流内/事件级错误对象：`{"error":{"message":...,"type":...,"code":...}}`。
    static func openAIError(_ object: [String: Any]) -> Error {
        let message = (object["message"] as? String) ?? ""
        let code = (object["code"] as? String) ?? ""
        let type = (object["type"] as? String) ?? ""
        let text = (message + " " + code + " " + type).lowercased()
        if toolsUnsupported(message: text) { return AgentModelError.toolsUnsupported }
        if text.contains("context length") || text.contains("too many tokens") { return AIError.capacity }
        if text.contains("authentic") || text.contains("api key") || text.contains("unauthorized") { return AIError.authentication }
        if text.contains("rate limit") || text.contains("quota") { return AIError.limited }
        return AgentModelError.invalidResponse("AI 服务返回错误：\(message.isEmpty ? "未知错误" : message)")
    }

    /// Anthropic 错误对象：`{"type":"error","error":{"type":"overloaded_error","message":...}}`。
    static func anthropicError(_ object: [String: Any]) -> Error {
        let type = ((object["type"] as? String) ?? "").lowercased()
        let message = (object["message"] as? String) ?? ""
        if toolsUnsupported(message: (message + " " + type).lowercased()) { return AgentModelError.toolsUnsupported }
        switch type {
        case "authentication_error", "permission_error": return AIError.authentication
        case "rate_limit_error": return AIError.limited
        case "request_too_large", "context_length_exceeded": return AIError.capacity
        case "overloaded_error", "api_error": return AIError.network
        case "invalid_request_error":
            if (message + " " + type).lowercased().contains("tool") { return AgentModelError.toolsUnsupported }
            return AIError.incompatible
        default: return AIError.incompatible
        }
    }

    static func urlError(_ error: URLError) -> Error {
        switch error.code {
        case .cancelled: return CancellationError()
        case .timedOut: return AgentModelError.timeout
        default: return AIError.network
        }
    }

    private static func errorDetail(_ body: Data) -> (message: String?, code: String?) {
        guard !body.isEmpty,
              let json = try? JSONSerialization.jsonObject(with: body),
              let object = json as? [String: Any] else { return (nil, nil) }
        if let error = object["error"] as? [String: Any] {
            return (error["message"] as? String, error["code"] as? String ?? error["type"] as? String)
        }
        return (object["message"] as? String, object["code"] as? String)
    }
}

// MARK: - 流式传输

/// 用 URLSession 读 SSE，交给 decoder 转成 AgentModelEvent。
/// 传输层只负责鉴权后的请求、状态码分类与取消；provider 差异全部在 decoder 里。
struct AgentSSEStreamClient: Sendable {
    private let session: URLSession

    init(session: URLSession? = nil) {
        if let session {
            self.session = session
        } else {
            let configuration = URLSessionConfiguration.ephemeral
            configuration.urlCache = nil
            configuration.httpCookieStorage = nil
            self.session = URLSession(configuration: configuration)
        }
    }

    func stream(request: URLRequest,
                makeDecoder: @escaping @Sendable () -> any AgentSSEDecoder) -> AsyncThrowingStream<AgentModelEvent, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    let (bytes, response) = try await session.bytes(for: request)
                    guard let http = response as? HTTPURLResponse else { throw AIError.network }
                    guard http.statusCode == 200 else {
                        var body = Data()
                        for try await byte in bytes {
                            body.append(byte)
                            if body.count >= 8192 { break }
                        }
                        throw AgentStreamErrorMapper.httpError(status: http.statusCode, body: body)
                    }
                    let decoder = makeDecoder()
                    var parser = AgentSSEParser()
                    // URLSession.AsyncBytes.lines 会吞掉空行，而空行是 SSE 事件的结束标记；
                    // 这里按 0x0A 自己切行，空行也交给 parser，保证每个 data 块独立派发。
                    func consume(line: String) throws {
                        if let event = parser.consume(line: line) {
                            for value in try decoder.consume(event) { continuation.yield(value) }
                        }
                    }
                    var lineBytes = Data()
                    for try await byte in bytes {
                        try Task.checkCancellation()
                        guard byte == 0x0A else {
                            lineBytes.append(byte)
                            continue
                        }
                        if lineBytes.last == 0x0D { lineBytes.removeLast() }
                        try consume(line: String(decoding: lineBytes, as: UTF8.self))
                        lineBytes.removeAll(keepingCapacity: true)
                    }
                    if !lineBytes.isEmpty {
                        if lineBytes.last == 0x0D { lineBytes.removeLast() }
                        try consume(line: String(decoding: lineBytes, as: UTF8.self))
                    }
                    if let event = parser.finish() {
                        for value in try decoder.consume(event) { continuation.yield(value) }
                    }
                    for value in try decoder.finish() { continuation.yield(value) }
                    continuation.finish()
                } catch is CancellationError {
                    continuation.finish(throwing: CancellationError())
                } catch let error as URLError {
                    continuation.finish(throwing: AgentStreamErrorMapper.urlError(error))
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }
}

// MARK: - OpenAI 流式解码

/// 解析 OpenAI `choices[].delta.content/tool_calls` 与 `finish_reason`。
final class AgentOpenAIStreamDecoder: AgentSSEDecoder {
    private struct PartialCall {
        var id = ""
        var name = ""
        var arguments = ""
    }

    private var calls: [Int: PartialCall] = [:]
    private var order: [Int] = []
    private var finished = false

    func consume(_ event: AgentSSEEvent) throws -> [AgentModelEvent] {
        let data = event.data.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !data.isEmpty else { return [] }
        if data == "[DONE]" { return try finish() }
        guard let object = try? JSONSerialization.jsonObject(with: Data(data.utf8)) as? [String: Any] else {
            throw AgentModelError.invalidResponse("AI 服务返回了无法解析的流式数据。")
        }
        if let error = object["error"] as? [String: Any] {
            throw AgentStreamErrorMapper.openAIError(error)
        }
        guard let choice = (object["choices"] as? [[String: Any]])?.first else { return [] }
        var events: [AgentModelEvent] = []
        if let delta = choice["delta"] as? [String: Any] {
            if let content = delta["content"] as? String, !content.isEmpty {
                events.append(.textDelta(content))
            }
            for raw in delta["tool_calls"] as? [[String: Any]] ?? [] {
                let index = (raw["index"] as? NSNumber)?.intValue ?? 0
                var partial = calls[index] ?? PartialCall()
                if let id = raw["id"] as? String, !id.isEmpty { partial.id = id }
                if let function = raw["function"] as? [String: Any] {
                    if let name = function["name"] as? String, !name.isEmpty { partial.name = name }
                    if let arguments = function["arguments"] as? String { partial.arguments += arguments }
                }
                if calls[index] == nil { order.append(index) }
                calls[index] = partial
            }
        }
        if let reason = choice["finish_reason"] as? String, !reason.isEmpty {
            events += flushCalls()
            events.append(.finished(Self.finishReason(reason)))
            finished = true
        }
        return events
    }

    func finish() throws -> [AgentModelEvent] {
        guard !finished else { return [] }
        finished = true
        var events = flushCalls()
        events.append(.finished(.stop))
        return events
    }

    private func flushCalls() -> [AgentModelEvent] {
        defer { calls = [:]; order = [] }
        return order.compactMap { index in
            guard let call = calls[index], !call.name.isEmpty else { return nil }
            return .toolCall(AgentToolCall(id: call.id.isEmpty ? "call_\(index)" : call.id,
                                           name: call.name,
                                           argumentsJSON: call.arguments.isEmpty ? "{}" : call.arguments))
        }
    }

    static func finishReason(_ raw: String) -> AgentFinishReason {
        switch raw {
        case "stop": return .stop
        case "length": return .length
        case "tool_calls", "function_call": return .toolCalls
        case "content_filter": return .contentFilter
        default: return .other
        }
    }
}

// MARK: - Anthropic 流式解码

/// 解析 Anthropic `content_block_start/delta/input_json_delta/message_delta/message_stop`。
final class AgentAnthropicStreamDecoder: AgentSSEDecoder {
    private struct Block {
        var kind: String
        var id = ""
        var name = ""
        var arguments = ""
    }

    private var blocks: [Int: Block] = [:]
    private var stopReason: String?
    private var finished = false

    func consume(_ event: AgentSSEEvent) throws -> [AgentModelEvent] {
        let data = event.data.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !data.isEmpty else { return [] }
        guard let object = try? JSONSerialization.jsonObject(with: Data(data.utf8)) as? [String: Any] else {
            throw AgentModelError.invalidResponse("AI 服务返回了无法解析的流式数据。")
        }
        let type = event.event ?? (object["type"] as? String) ?? ""
        switch type {
        case "content_block_start":
            guard let index = (object["index"] as? NSNumber)?.intValue,
                  let block = object["content_block"] as? [String: Any] else { return [] }
            var state = Block(kind: block["type"] as? String ?? "")
            state.id = block["id"] as? String ?? ""
            state.name = block["name"] as? String ?? ""
            blocks[index] = state
            return []
        case "content_block_delta":
            guard let index = (object["index"] as? NSNumber)?.intValue,
                  var state = blocks[index],
                  let delta = object["delta"] as? [String: Any] else { return [] }
            switch delta["type"] as? String {
            case "text_delta":
                let text = delta["text"] as? String ?? ""
                guard !text.isEmpty else { return [] }
                blocks[index] = state
                return [.textDelta(text)]
            case "input_json_delta":
                state.arguments += delta["partial_json"] as? String ?? ""
                blocks[index] = state
                return []
            default:
                return []
            }
        case "content_block_stop":
            guard let index = (object["index"] as? NSNumber)?.intValue,
                  let state = blocks.removeValue(forKey: index), state.kind == "tool_use" else { return [] }
            guard !state.name.isEmpty else { return [] }
            return [.toolCall(AgentToolCall(id: state.id.isEmpty ? "toolu_\(index)" : state.id,
                                           name: state.name,
                                           argumentsJSON: state.arguments.isEmpty ? "{}" : state.arguments))]
        case "message_delta":
            if let delta = object["delta"] as? [String: Any], let reason = delta["stop_reason"] as? String {
                stopReason = reason
            }
            return []
        case "message_stop":
            return try finish()
        case "error":
            let error = object["error"] as? [String: Any] ?? [:]
            throw AgentStreamErrorMapper.anthropicError(error)
        default:
            return []
        }
    }

    func finish() throws -> [AgentModelEvent] {
        guard !finished else { return [] }
        finished = true
        var events: [AgentModelEvent] = []
        for index in blocks.keys.sorted() {
            guard let state = blocks[index], state.kind == "tool_use", !state.name.isEmpty else { continue }
            events.append(.toolCall(AgentToolCall(id: state.id.isEmpty ? "toolu_\(index)" : state.id,
                                                  name: state.name,
                                                  argumentsJSON: state.arguments.isEmpty ? "{}" : state.arguments)))
        }
        blocks = [:]
        events.append(.finished(Self.finishReason(stopReason)))
        return events
    }

    static func finishReason(_ raw: String?) -> AgentFinishReason {
        switch raw {
        case "tool_use": return .toolCalls
        case "max_tokens": return .length
        case "stop_sequence", "end_turn": return .stop
        default: return .stop
        }
    }
}

// MARK: - 请求构造

/// 复用 AIConnection 的模型 / API Key / 地址校验与鉴权头，再改写成流式请求。
/// 不复制鉴权逻辑，也不改动现有单次问答路径。
enum AgentProviderRequest {
    static func make(configuration: AIConfiguration, key: String, timeout: TimeInterval) throws -> (request: URLRequest, baseBody: [String: Any]) {
        let validated = try AIConnection.request(configuration, key: key, prompt: "stream", maxTokens: 1, timeout: timeout)
        guard let url = validated.url else { throw AIError.address }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = timeout
        for (name, value) in validated.allHTTPHeaderFields ?? [:] {
            request.setValue(value, forHTTPHeaderField: name)
        }
        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        let base = (validated.httpBody.flatMap { try? JSONSerialization.jsonObject(with: $0) }) as? [String: Any] ?? [:]
        return (request, base)
    }

    static func attach(_ body: [String: Any], to request: inout URLRequest) throws {
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
    }

    static func schemaObject(_ spec: AgentToolSpec) throws -> Any {
        guard let data = spec.inputSchemaJSON.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) else {
            throw AgentModelError.invalidResponse("工具 \(spec.name) 的 JSON Schema 无效。")
        }
        return object
    }
}
