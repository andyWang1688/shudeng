import Foundation

/// 上下文预算（对应 LangChain BaseMemory 的窗口配置）。token 数是启发式估算，不是精确值。
struct AgentContextBudget: Sendable, Equatable {
    /// 每次模型调用允许的上下文 token 估算上限（含 system prompt 与工具结果）。
    var maxContextTokens: Int = 10000
    /// 预留给模型回答的 token 估算。
    var reserveForResponseTokens: Int = 1600
    /// 单条工具结果超过这个字符数先裁剪，避免一次 read 挤掉历史。
    var maxToolResultCharacters: Int = 4000
    /// 摘要时至少保留的最近消息条数（按整轮分组保留）。
    var recentMessagesToKeep: Int = 8
    /// 历史摘要的目标字数。
    var summaryTargetCharacters: Int = 600

    static let `default` = AgentContextBudget()
}

struct AgentContextUsage: Sendable, Equatable, Codable {
    var estimatedTokens: Int
    var characterCount: Int
    var limitTokens: Int
    var summarizedMessages: Int
    var trimmedMessages: Int
    var truncatedToolResults: Int

    var utilization: Double {
        limitTokens > 0 ? min(1, Double(estimatedTokens) / Double(limitTokens)) : 0
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

    var overBudget: Bool {
        actions.contains {
            if case .overBudget = $0 { return true }
            return false
        }
    }
}

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
        messages.reduce(0) { partial, message in
            partial + 4 + estimate(message.content)
                + message.toolCalls.reduce(0) { $0 + 4 + estimate($1.name) + estimate($1.argumentsJSON) }
        }
    }
}

/// 上下文管理（对应 LangChain BaseMemory）：工具结果裁剪 → 历史摘要 → 超预算裁剪，
/// 每一步都产生 action 事件，不静默截断。摘要失败自动降级为裁剪。
final class AgentContextManager: Sendable {
    let budget: AgentContextBudget
    let estimator: AgentTokenEstimator
    private let summarizer: (any AgentHistorySummarizer)?

    init(budget: AgentContextBudget = .default,
         summarizer: (any AgentHistorySummarizer)? = nil,
         estimator: AgentTokenEstimator = AgentTokenEstimator()) {
        self.budget = budget
        self.summarizer = summarizer
        self.estimator = estimator
    }

    func prepare(systemPrompt: String, messages: [AgentMessage]) async -> AgentContextPlan {
        var actions: [AgentContextAction] = []
        var summarized = 0
        var trimmed = 0

        // 1. 工具结果先裁剪：单条过长时保留开头，提示模型按需重新读取更小范围。
        var trimmedTools = 0
        var working = messages.map { message -> AgentMessage in
            guard message.role == .tool, message.content.count > budget.maxToolResultCharacters else { return message }
            var copy = message
            copy.content = String(message.content.prefix(budget.maxToolResultCharacters))
                + "\n…（工具结果过长已裁剪；如需要请重新调用工具读取更小范围）"
            trimmedTools += 1
            return copy
        }
        if trimmedTools > 0 { actions.append(.truncatedToolResults(count: trimmedTools)) }

        let limit = max(500, budget.maxContextTokens - budget.reserveForResponseTokens)
        func usage() -> AgentContextUsage {
            let characters = systemPrompt.count + working.reduce(0) { $0 + $1.content.count + $1.toolCalls.reduce(0) { $0 + $1.argumentsJSON.count } }
            return AgentContextUsage(estimatedTokens: estimator.estimate(systemPrompt) + estimator.estimate(working),
                                     characterCount: characters,
                                     limitTokens: limit,
                                     summarizedMessages: summarized,
                                     trimmedMessages: trimmed,
                                     truncatedToolResults: trimmedTools)
        }
        var current = usage()

        // 2. 超预算：把较旧的整轮对话交给摘要器；失败则直接裁剪。
        if current.estimatedTokens > limit {
            let groups = Self.turns(working)
            if groups.count > 1 {
                var recentCount = 0
                var recentStart = groups.count
                while recentStart > 0, recentCount < budget.recentMessagesToKeep {
                    recentStart -= 1
                    recentCount += groups[recentStart].count
                }
                // 至少保留最近一轮。
                recentStart = min(recentStart, groups.count - 1)
                let oldMessages = groups[..<recentStart].flatMap { $0 }
                let recentMessages = groups[recentStart...].flatMap { $0 }
                if !oldMessages.isEmpty {
                    var summary: String?
                    if let summarizer {
                        summary = try? await summarizer.summarize(oldMessages)
                    }
                    if let summary, !summary.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        summarized += oldMessages.count
                        actions.append(.summarized(removedMessages: oldMessages.count))
                        working = [.system("[此前对话摘要]\n" + String(summary.prefix(budget.summaryTargetCharacters)))] + recentMessages
                    } else {
                        trimmed += oldMessages.count
                        actions.append(.trimmedHistory(removedMessages: oldMessages.count))
                        working = recentMessages
                    }
                    current = usage()
                }
            }
        }

        // 3. 摘要后仍超预算（或没有可摘要的旧历史）：按整轮继续裁剪，保留最后一轮。
        if current.estimatedTokens > limit {
            var groups = Self.turns(working)
            while current.estimatedTokens > limit, groups.count > 1 {
                let removed = groups.removeFirst()
                trimmed += removed.count
                working = groups.flatMap { $0 }
                current = usage()
            }
            if trimmed > 0, !actions.contains(where: { if case .trimmedHistory = $0 { return true }; return false }) {
                actions.append(.trimmedHistory(removedMessages: trimmed))
            }
            current = usage()
        }

        if current.estimatedTokens > limit {
            actions.append(.overBudget(requiredTokens: current.estimatedTokens))
        } else {
            actions.append(.withinBudget)
        }
        return AgentContextPlan(messages: working, usage: current, actions: actions)
    }

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
}
