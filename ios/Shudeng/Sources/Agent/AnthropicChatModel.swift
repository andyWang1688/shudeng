import Foundation

/// Anthropic Messages API 的流式 tool calling 适配器。
/// system 消息合并进顶层 system 参数；assistant tool_use 与 user tool_result 块按协议回填。
final class AgentAnthropicChatModel: AgentChatModel {
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
                    var body = try AgentAnthropicRequestEncoder.body(
                        messages: messages, tools: tools, options: options, model: configuration.model)
                    // 复用 AIConnection 对 deepseek-flash 的 thinking 关闭设置（Anthropic 格式的自定义地址）。
                    if let thinking = baseBody["thinking"] { body["thinking"] = thinking }
                    try AgentProviderRequest.attach(body, to: &request)
                    for try await event in client.stream(request: request, makeDecoder: { AgentAnthropicStreamDecoder() }) {
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

/// 消息历史 → Anthropic Messages JSON。
enum AgentAnthropicRequestEncoder {
    static func body(messages: [AgentMessage], tools: [AgentToolSpec], options: AgentModelOptions, model: String) throws -> [String: Any] {
        var systemParts: [String] = []
        var payload: [[String: Any]] = []

        func append(role: String, blocks: [[String: Any]]) {
            guard !blocks.isEmpty else { return }
            if let last = payload.last, last["role"] as? String == role,
               var content = last["content"] as? [[String: Any]] {
                content.append(contentsOf: blocks)
                payload[payload.count - 1]["content"] = content
            } else {
                payload.append(["role": role, "content": blocks])
            }
        }

        for message in messages {
            switch message.role {
            case .system:
                if !message.content.isEmpty { systemParts.append(message.content) }
            case .user:
                append(role: "user", blocks: [["type": "text", "text": message.content]])
            case .assistant:
                var blocks: [[String: Any]] = []
                if !message.content.isEmpty {
                    blocks.append(["type": "text", "text": message.content])
                }
                for call in message.toolCalls {
                    blocks.append([
                        "type": "tool_use",
                        "id": call.id,
                        "name": call.name,
                        "input": inputObject(call.argumentsJSON),
                    ])
                }
                append(role: "assistant", blocks: blocks)
            case .tool:
                var block: [String: Any] = [
                    "type": "tool_result",
                    "tool_use_id": message.toolCallID ?? "",
                    "content": message.content,
                ]
                if message.isError { block["is_error"] = true }
                append(role: "user", blocks: [block])
            }
        }

        // Anthropic 要求第一条消息是 user；从 checkpoint 续跑时可能以 assistant 开头。
        if payload.first?["role"] as? String == "assistant" {
            payload.insert(["role": "user", "content": [["type": "text", "text": "继续。"]]], at: 0)
        }

        var body: [String: Any] = [
            "model": model,
            "messages": payload,
            "max_tokens": options.maxTokens,
            "stream": true,
        ]
        if !systemParts.isEmpty { body["system"] = systemParts.joined(separator: "\n\n") }
        if !tools.isEmpty {
            body["tools"] = try tools.map { spec in
                [
                    "name": spec.name,
                    "description": spec.description,
                    "input_schema": try AgentProviderRequest.schemaObject(spec),
                ]
            }
        }
        if let temperature = options.temperature { body["temperature"] = temperature }
        return body
    }

    /// tool_use.input 必须是对象；模型参数 JSON 损坏时保留原文，避免整段历史无法发送。
    private static func inputObject(_ json: String) -> Any {
        guard let data = json.data(using: .utf8),
              let value = try? JSONSerialization.jsonObject(with: data),
              value is [String: Any] else {
            return ["_raw_arguments": json]
        }
        return value
    }
}
