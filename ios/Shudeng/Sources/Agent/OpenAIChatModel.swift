import Foundation

/// OpenAI / OpenAI 兼容服务的流式 tool calling 适配器。
/// 请求体消息会带上 assistant tool_calls 与 tool 结果，流式解析见 AgentOpenAIStreamDecoder。
final class AgentOpenAIChatModel: AgentChatModel {
    let configuration: AIConfiguration
    private let key: String
    private let client: AgentSSEStreamClient

    var modelIdentifier: String { configuration.model }

    init(configuration: AIConfiguration, key: String, session: URLSession? = nil) {
        self.configuration = configuration
        self.key = key
        client = AgentSSEStreamClient(session: session)
    }

    func stream(messages: [AgentMessage], tools: [AgentToolSpec], options: AgentModelOptions)
        -> AsyncThrowingStream<AgentModelEvent, Error> {
        let configuration = configuration
        let key = key
        let client = client
        return AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    let (baseRequest, baseBody) = try AgentProviderRequest.make(
                        configuration: configuration, key: key, timeout: options.timeout)
                    var request = baseRequest
                    var body = try AgentOpenAIRequestEncoder.body(
                        messages: messages, tools: tools, options: options, model: configuration.model)
                    // 复用 AIConnection 对 deepseek-flash 的 thinking 关闭设置。
                    if let thinking = baseBody["thinking"] { body["thinking"] = thinking }
                    try AgentProviderRequest.attach(body, to: &request)
                    for try await event in client.stream(request: request, makeDecoder: { AgentOpenAIStreamDecoder() }) {
                        continuation.yield(event)
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }
}

/// 消息历史 → OpenAI Chat Completions JSON。工具调用与结果按 OpenAI 协议回填。
enum AgentOpenAIRequestEncoder {
    static func body(messages: [AgentMessage], tools: [AgentToolSpec], options: AgentModelOptions, model: String) throws -> [String: Any] {
        var body: [String: Any] = [
            "model": model,
            "messages": try messages.map(message),
            "stream": true,
            "max_tokens": options.maxTokens,
        ]
        if !tools.isEmpty {
            body["tools"] = try tools.map { spec in
                [
                    "type": "function",
                    "function": [
                        "name": spec.name,
                        "description": spec.description,
                        "parameters": try AgentProviderRequest.schemaObject(spec),
                    ],
                ]
            }
            body["tool_choice"] = "auto"
        }
        if let temperature = options.temperature { body["temperature"] = temperature }
        return body
    }

    static func message(_ message: AgentMessage) throws -> [String: Any] {
        switch message.role {
        case .system:
            return ["role": "system", "content": message.content]
        case .user:
            return ["role": "user", "content": message.content]
        case .assistant:
            var value: [String: Any] = ["role": "assistant"]
            value["content"] = message.content.isEmpty ? NSNull() : message.content
            if !message.toolCalls.isEmpty {
                value["tool_calls"] = message.toolCalls.map { call in
                    [
                        "id": call.id,
                        "type": "function",
                        "function": ["name": call.name, "arguments": call.argumentsJSON],
                    ]
                }
            }
            return value
        case .tool:
            return [
                "role": "tool",
                "tool_call_id": message.toolCallID ?? "",
                "content": message.content,
            ]
        }
    }
}
