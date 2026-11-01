import Foundation

/// 把 MCP server 的工具适配成内核 `AgentTool`。
///
/// 安全边界：
/// - 只传模型生成的工具参数，不传书库/阅读位置/AI Key；
/// - 工具必须先出现在用户白名单里（默认空）；
/// - 每次会话首次调用需要用户确认（由 MCPToolConfirmationCenter 弹纸白确认框）；
/// - 输出截断到 8000 字，错误转成工具错误结果，绝不抛出到 Agent 主循环造成书内问答失败。
@available(iOS 17.0, *)
struct MCPAgentTool: AgentTool {
    let spec: AgentToolSpec
    let serverID: UUID
    let serverName: String
    let toolName: String
    let readOnly: Bool
    private let server: MCPServerConfiguration
    private let descriptor: MCPToolDescriptor
    private let manager: MCPClientManager

    init(server: MCPServerConfiguration, descriptor: MCPToolDescriptor,
         specName: String, manager: MCPClientManager) {
        self.server = server
        self.descriptor = descriptor
        self.serverID = server.id
        self.serverName = server.name
        self.toolName = descriptor.name
        self.readOnly = descriptor.readOnly
        self.manager = manager
        let prefix = descriptor.readOnly ? "外部只读工具" : "外部可写工具"
        let hint = descriptor.description.map { "：\($0)" } ?? "。"
        self.spec = AgentToolSpec(
            name: specName,
            description: "\(prefix)（由外部 MCP 服务「\(server.name)」提供，仅发送本次参数）\(hint)",
            inputSchemaJSON: descriptor.inputSchemaJSON
        )
    }

    func call(_ arguments: AgentToolArguments, context: AgentToolCallContext) async throws -> AgentToolResult {
        guard server.allowedTools.contains(descriptor.name) else {
            return .failure(MCPError.notAllowed(descriptor.name).localizedDescription)
        }
        let approved = await MCPToolConfirmationCenter.shared.confirm(server: server, tool: descriptor)
        guard approved else {
            return .failure(MCPError.needsConfirmation(descriptor.name).localizedDescription)
        }
        do {
            let text = try await manager.callTool(
                server: server,
                tool: descriptor.name,
                argumentsJSON: arguments.json
            )
            return .success(text)
        } catch is CancellationError {
            return .failure("外部工具调用已取消")
        } catch {
            return .failure((error as? LocalizedError)?.errorDescription ?? "外部工具暂时不可用")
        }
    }
}

/// 运行时组装：只对“已启用 + 工具白名单非空”的 server 暴露工具。
/// 任一 server 发现失败只跳过该 server，不影响书内工具和其他 server。
@available(iOS 17.0, *)
enum MCPAgentToolProvider {
    static func makeTools(
        servers: [MCPServerConfiguration],
        manager: MCPClientManager = .shared
    ) async -> [any AgentTool] {
        var tools: [any AgentTool] = []
        var usedNames: Set<String> = []
        for server in servers {
            guard server.isEnabled, !server.allowedTools.isEmpty, server.endpointURL != nil else { continue }
            let discovered: [MCPToolDescriptor]
            if server.knownTools.isEmpty {
                discovered = (try? await manager.discoverTools(for: server)) ?? []
            } else {
                discovered = server.knownTools
            }
            for descriptor in discovered where server.allowedTools.contains(descriptor.name) {
                let base = sanitized(server.name) + "_" + sanitized(descriptor.name)
                var name = String(base.prefix(64))
                if usedNames.contains(name) {
                    name = String((base + "_" + server.id.uuidString.prefix(4)).prefix(64))
                }
                guard !name.isEmpty else { continue }
                usedNames.insert(name)
                tools.append(MCPAgentTool(
                    server: server,
                    descriptor: descriptor,
                    specName: name,
                    manager: manager
                ))
            }
        }
        return tools
    }

    /// provider 工具名只允许 ASCII 字母数字/下划线/连字符，最长 64。
    static func sanitized(_ text: String) -> String {
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "_-"))
        let scalars = text.unicodeScalars.map { allowed.contains($0) ? Character(String($0)) : "_" }
        let value = String(scalars).trimmingCharacters(in: CharacterSet(charactersIn: "_"))
        return value.isEmpty ? "tool" : String(value.prefix(40))
    }
}
