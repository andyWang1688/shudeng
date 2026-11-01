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
        let deepSeekThinking = configuration.agentUsesDeepSeekThinking
        var options = options
        if deepSeekThinking {
            // 思考+回答共用 max_tokens；1400 会被思考吃满导致正文为空。
            options.maxTokens = max(options.maxTokens, AgentThinkingBudget.maxTokens)
            options.timeout = max(options.timeout, AgentThinkingBudget.timeout)
        }
        return AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    let (baseRequest, _) = try AgentProviderRequest.make(
                        configuration: configuration, key: key, timeout: options.timeout)
                    var request = baseRequest
                    var body = try AgentOpenAIRequestEncoder.body(
                        messages: messages, tools: tools, options: options, model: configuration.model)
                    // Agent 路径不再复制 AIConnection 的 thinking:disabled：DeepSeek 显式开启原生思考，
                    // 其它 provider 不发任何 thinking 参数（普通 RAG 路径不受影响）。
                    if deepSeekThinking {
                        body["thinking"] = ["type": "enabled"]
                        body["reasoning_effort"] = "high"
                    }
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

/// DeepSeek 原生思考的 Agent 端预算（不影响普通 RAG 路径）。
enum AgentThinkingBudget {
    /// 思考+回答共用输出预算。
    static let maxTokens = 16_384
    /// 单次流式请求超时。
    static let timeout: TimeInterval = 180
}

extension AIConfiguration {
    /// Agent 路径是否使用 DeepSeek 原生思考：预置 provider、模型名或官方域名。
    /// Anthropic 兼容格式暂不开启（需要回传 thinking blocks，本任务不覆盖）。
    var agentUsesDeepSeekThinking: Bool {
        guard format == .openAI else { return false }
        if provider == .deepSeek { return true }
        if model.lowercased().hasPrefix("deepseek") { return true }
        let host = URLComponents(string: address.trimmingCharacters(in: .whitespacesAndNewlines))?.host?.lowercased()
        return host == "api.deepseek.com"
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
            // DeepSeek 带 tools 的后续请求必须原样回传每轮 assistant 的 reasoning_content。
            if let reasoning = message.reasoningContent, !reasoning.isEmpty {
                value["reasoning_content"] = reasoning
            }
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
