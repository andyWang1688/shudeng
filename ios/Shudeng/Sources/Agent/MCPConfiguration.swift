import Foundation
import UIKit

// MARK: - 配置模型（不包含任何密钥）

enum MCPTransportKind: String, Codable, Sendable, CaseIterable {
    /// 普通 HTTP 请求/响应。
    case http
    /// HTTP + SSE 流式响应（官方 SDK 的 streaming 模式）。
    case sse

    var displayName: String {
        switch self {
        case .http: return "HTTP"
        case .sse: return "SSE 流式"
        }
    }
}

/// 一个用户添加的 MCP server。只保存名称、地址、传输方式、启用状态和工具白名单，
/// 不保存 API Key、书库路径或任何书籍内容。
struct MCPServerConfiguration: Codable, Identifiable, Sendable, Equatable {
    var id: UUID = UUID()
    var name: String
    var endpoint: String
    var transport: MCPTransportKind = .http
    var isEnabled: Bool = false
    /// 用户显式允许外部调用的工具名；默认空 = 不暴露任何外部工具。
    var allowedTools: Set<String> = []
    /// 上次成功发现并缓存的工具，供设置页离线展示白名单。
    var knownTools: [MCPToolDescriptor] = []
    var lastError: String?
    /// 可选的自定义 HTTP 请求头（例如 Authorization）。只保存在本机偏好设置，不发送给其他服务。
    var headers: [String: String]? = nil

    static func makeNew() -> MCPServerConfiguration {
        MCPServerConfiguration(name: "", endpoint: "")
    }

    /// 只接受 https；本机 stub/开发服务允许 http://127.0.0.1 或 http://localhost。
    static func normalizedURL(_ raw: String) -> URL? {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, text.count <= 2048,
              let url = URL(string: text),
              let scheme = url.scheme?.lowercased(),
              let host = url.host?.lowercased(), !host.isEmpty,
              url.user == nil, url.password == nil, url.fragment == nil else { return nil }
        if scheme == "https" { return url }
        guard scheme == "http" else { return nil }
        guard host == "127.0.0.1" || host == "localhost" || host == "::1" else { return nil }
        return url
    }

    var endpointURL: URL? { Self.normalizedURL(endpoint) }

    var displayHost: String {
        endpointURL?.host ?? endpoint
    }

    /// 设置页使用：只显示白名单里的工具。
    var allowedDescriptors: [MCPToolDescriptor] {
        let allowed = allowedTools
        return knownTools.filter { allowed.contains($0.name) }
    }
}

/// 从 MCP server 发现的一个工具（参数 schema 原样保留给模型）。
struct MCPToolDescriptor: Codable, Sendable, Equatable, Identifiable {
    var name: String
    var title: String?
    var description: String?
    var inputSchemaJSON: String
    var readOnly: Bool

    var id: String { name }

    var displayName: String { title?.isEmpty == false ? title! : name }
}

// MARK: - 错误

enum MCPError: Error, LocalizedError, Equatable, Sendable {
    case unavailable
    case invalidURL
    case insecureURL
    case disabled
    case notAllowed(String)
    case needsConfirmation(String)
    case timedOut
    case connection(String)
    case protocolFailure(String)
    case outputTooLarge

    var errorDescription: String? {
        switch self {
        case .unavailable: return "外部工具需要 iOS 17 或更高版本"
        case .invalidURL: return "外部工具地址无效"
        case .insecureURL: return "外部工具只支持 https 地址"
        case .disabled: return "外部工具已关闭"
        case .notAllowed(let name): return "工具「\(name)」未获授权"
        case .needsConfirmation(let name): return "工具「\(name)」首次使用需要确认"
        case .timedOut: return "外部工具连接超时"
        case .connection(let message): return "外部工具连接失败：\(message)"
        case .protocolFailure(let message): return "外部工具返回异常：\(message)"
        case .outputTooLarge: return "外部工具返回内容过长"
        }
    }
}

// MARK: - 持久化

/// MCP server 配置存储（UserDefaults，按设备本地保存，不含密钥）。
@MainActor
final class MCPServerStore {
    static let shared = MCPServerStore()

    private let defaults: UserDefaults
    private let key = "shudeng.mcp.servers.v1"

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    func load() -> [MCPServerConfiguration] {
        guard let data = defaults.data(forKey: key),
              let values = try? JSONDecoder().decode([MCPServerConfiguration].self, from: data) else {
            return []
        }
        return values
    }

    func save(_ servers: [MCPServerConfiguration]) {
        guard let data = try? JSONEncoder().encode(servers) else { return }
        defaults.set(data, forKey: key)
    }

    func add(_ server: MCPServerConfiguration) { var all = load(); all.append(server); save(all) }

    func update(_ server: MCPServerConfiguration) {
        var all = load()
        if let index = all.firstIndex(where: { $0.id == server.id }) { all[index] = server } else { all.append(server) }
        save(all)
    }

    func remove(id: UUID) {
        save(load().filter { $0.id != id })
    }

    func setEnabled(_ enabled: Bool, for id: UUID) {
        var all = load()
        guard let index = all.firstIndex(where: { $0.id == id }) else { return }
        all[index].isEnabled = enabled
        save(all)
    }

    @available(iOS 17.0, *)
    func enabledServers() -> [MCPServerConfiguration] {
        load().filter { $0.isEnabled && $0.endpointURL != nil }
    }
}

// MARK: - 用户确认

/// 首次调用某个外部工具时向用户确认。由 UI/Agent 宿主注入 presenter；没有 presenter 时默认拒绝，
/// 保证任何后台路径都不会静默调用外部服务。
@MainActor
final class MCPToolConfirmationCenter {
    static let shared = MCPToolConfirmationCenter()

    private var approved: Set<String> = []
    var presenter: (() -> UIViewController?)?

    func isApproved(serverID: UUID, tool: String) -> Bool {
        approved.contains("\(serverID.uuidString).\(tool)")
    }

    func confirm(server: MCPServerConfiguration, tool: MCPToolDescriptor) async -> Bool {
        let key = "\(server.id.uuidString).\(tool.name)"
        if approved.contains(key) { return true }
        guard let host = presenter?() ?? Self.topViewController() else { return false }

        let title = "调用外部工具？"
        let message = "「\(tool.displayName)」由外部服务「\(server.name)」提供。将只发送本次工具参数，不会发送书库或 AI 密钥。"
        let approvedByUser = await withCheckedContinuation { (continuation: CheckedContinuation<Bool, Never>) in
            let alert = BookAlertController(title: title, message: message, preferredStyle: .alert)
            let target = host.presentedViewController ?? host
            alert.addAction(BookAlertAction(title: "允许一次", style: .default) { _ in
                continuation.resume(returning: true)
            })
            alert.addAction(BookAlertAction(title: "取消", style: .cancel) { _ in
                continuation.resume(returning: false)
            })
            target.present(alert, animated: true)
        }
        if approvedByUser { approved.insert(key) }
        return approvedByUser
    }

    /// 设置变化或测试时清空本次会话内的确认。
    func reset() { approved.removeAll() }

    /// Agent 宿主没有注入 presenter 时的兜底：当前前台窗口最上层控制器。
    private static func topViewController() -> UIViewController? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let scene = scenes.first { $0.activationState == .foregroundActive } ?? scenes.first
        guard let root = (scene?.windows.first { $0.isKeyWindow } ?? scene?.windows.first)?.rootViewController else {
            return nil
        }
        var top = root
        while let presented = top.presentedViewController { top = presented }
        if let navigation = top as? UINavigationController { return navigation.visibleViewController ?? navigation }
        if let tabs = top as? UITabBarController { return tabs.selectedViewController ?? tabs }
        return top
    }
}
