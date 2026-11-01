import Foundation

/// 与具体模型实现解耦的 ChatModel（对应 LangChain BaseChatModel）。
/// provider 适配器只负责请求与解析；执行器、上下文、检查点都只依赖这个协议。
protocol AgentChatModel: Sendable {
    /// 展示与 checkpoint 记录用，例如 "deepseek-flash"。
    var modelIdentifier: String { get }
    func stream(messages: [AgentMessage], tools: [AgentToolSpec], options: AgentModelOptions)
        -> AsyncThrowingStream<AgentModelEvent, Error>
}

extension AgentChatModel {
    var modelIdentifier: String { "unknown" }
}

/// 模型层的可识别错误：toolsUnsupported 供 UI 回退到现有单次 RAG 问答。
enum AgentModelError: Error, LocalizedError, Equatable {
    case toolsUnsupported
    case timeout
    case invalidResponse(String)

    var errorDescription: String? {
        switch self {
        case .toolsUnsupported: return "当前服务或模型不支持工具调用；可回退到普通阅读问答。"
        case .timeout: return "AI 服务响应超时，请稍后重试。"
        case .invalidResponse(let detail): return detail
        }
    }
}

/// 历史摘要（对应 LangChain BaseMemory 的摘要部分）。失败时执行器/上下文管理器降级为裁剪。
protocol AgentHistorySummarizer: Sendable {
    func summarize(_ messages: [AgentMessage]) async throws -> String
}

/// 复用同一个 ChatModel 生成摘要；不传工具，避免摘要请求触发工具调用。
struct AgentModelHistorySummarizer: AgentHistorySummarizer {
    let model: any AgentChatModel
    var maxCharacters: Int = 600
    var options: AgentModelOptions = AgentModelOptions(maxTokens: 420, timeout: 45)

    func summarize(_ messages: [AgentMessage]) async throws -> String {
        let transcript = AgentMessageTranscript.render(messages, limitCharacters: 6000)
        guard !transcript.isEmpty else { return "" }
        let prompt = AgentPrompts.summarize(limitCharacters: maxCharacters) + "\n\n" + transcript
        var text = ""
        for try await event in model.stream(messages: [.system("你是简洁的对话摘要器。"), .user(prompt)],
                                            tools: [], options: options) {
            if case .textDelta(let delta) = event { text += delta }
        }
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { throw AgentModelError.invalidResponse("摘要为空") }
        return String(trimmed.prefix(maxCharacters))
    }
}

/// 把消息历史压成纯文本，供摘要与 checkpoint 调试使用。
enum AgentMessageTranscript {
    static func render(_ messages: [AgentMessage], limitCharacters: Int) -> String {
        var lines: [String] = []
        for message in messages {
            switch message.role {
            case .system:
                continue
            case .user:
                lines.append("读者：" + message.content)
            case .assistant:
                if !message.content.isEmpty { lines.append("助手：" + message.content) }
                if !message.toolCalls.isEmpty {
                    lines.append("（调用工具：" + message.toolCalls.map(\.name).joined(separator: "、") + "）")
                }
            case .tool:
                lines.append("（工具结果：" + String(message.content.prefix(300)) + "）")
            }
        }
        let joined = lines.joined(separator: "\n")
        guard joined.count > limitCharacters else { return joined }
        return "…" + String(joined.suffix(limitCharacters))
    }
}
