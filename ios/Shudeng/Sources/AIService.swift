import Foundation
import Security

enum AIFormat: String, Codable, CaseIterable {
    case openAI = "OpenAI", anthropic = "Anthropic"
    var path: String { self == .openAI ? "/chat/completions" : "/messages" }
}

struct AIConfiguration: Codable, Identifiable, Equatable {
    var id = UUID()
    var name: String
    var format: AIFormat
    var address: String
    var model: String
    var secretID: String?
}

enum AIError: Error, LocalizedError, Equatable {
    case missing, address, authentication, incompatible, network, limited, storage, secret
    var errorDescription: String? {
        switch self {
        case .missing: return "请填写名称、地址、模型和密钥。"
        case .address: return "地址无效：请使用 HTTPS API 根地址或完整文字端点；本机测试可使用 HTTP。"
        case .authentication: return "鉴权失败，请检查密钥和服务权限。"
        case .incompatible: return "地址、模型或响应格式不兼容；仅支持非流式文字接口。"
        case .network: return "网络或服务暂时不可用，请稍后重试。"
        case .limited: return "服务限流或额度不足，请检查服务后重试。"
        case .storage: return "配置尚未保存，原配置未变；请重试。"
        case .secret: return "安全存储不可用或密钥缺失，请解锁设备后重试，或重新填写密钥。"
        }
    }
}

protocol AISecrets {
    func read(_ id: String) throws -> String
    func write(_ value: String, id: String) throws
    func remove(_ id: String) throws
    func accounts() throws -> [String]
}

struct KeychainSecrets: AISecrets {
    var service = "dev.shudeng.ai-services"
    private func query(_ id: String? = nil) -> [String: Any] {
        var q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service]
        if let id { q[kSecAttrAccount as String] = id }
        return q
    }
    func read(_ id: String) throws -> String {
        var q = query(id)
        q[kSecReturnData as String] = true
        var result: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data, let value = String(data: data, encoding: .utf8), !value.isEmpty else { throw AIError.secret }
        return value
    }
    func write(_ value: String, id: String) throws {
        var q = query(id)
        q[kSecValueData as String] = Data(value.utf8)
        q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        guard SecItemAdd(q as CFDictionary, nil) == errSecSuccess else { throw AIError.secret }
    }
    func remove(_ id: String) throws {
        let status = SecItemDelete(query(id) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw AIError.secret }
    }
    func accounts() throws -> [String] {
        var q = query()
        q[kSecReturnAttributes as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitAll
        var result: CFTypeRef?
        let status = SecItemCopyMatching(q as CFDictionary, &result)
        if status == errSecItemNotFound { return [] }
        guard status == errSecSuccess, let rows = result as? [[String: Any]] else { throw AIError.secret }
        return rows.compactMap { $0[kSecAttrAccount as String] as? String }
    }
}

@MainActor
final class AIConfigurationStore {
    private struct Catalog: Codable {
        var configurations: [AIConfiguration] = []
        var selectedID: UUID?
    }
    private var catalog = Catalog()
    private let file: URL
    private let secrets: AISecrets
    var configurations: [AIConfiguration] { catalog.configurations }
    var selectedID: UUID? { catalog.selectedID }

    init(root: URL, secrets: AISecrets = KeychainSecrets()) throws {
        file = root.appendingPathComponent("ai-services.json")
        self.secrets = secrets
        do {
            try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
            if FileManager.default.fileExists(atPath: file.path) {
                catalog = try JSONDecoder().decode(Catalog.self, from: Data(contentsOf: file))
            }
        } catch { throw AIError.storage }
        cleanup()
    }
    func key(for configuration: AIConfiguration) throws -> String {
        guard let id = configuration.secretID else { throw AIError.secret }
        return try secrets.read(id)
    }
    func save(_ configuration: AIConfiguration, newKey: String) throws {
        var updated = configuration
        guard !updated.address.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw AIError.missing }
        _ = try AIConnection.endpoint(for: updated)
        guard !updated.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              !updated.model.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw AIError.missing }
        // Write a new revision so a failed catalog replacement preserves the old key.
        if !newKey.isEmpty {
            updated.secretID = UUID().uuidString
            try secrets.write(newKey, id: updated.secretID!)
        } else {
            guard let old = configurations.first(where: { $0.id == updated.id }) else { throw AIError.missing }
            updated.secretID = old.secretID
        }
        do {
            _ = try key(for: updated)
            var next = catalog
            if let index = next.configurations.firstIndex(where: { $0.id == updated.id }) { next.configurations[index] = updated }
            else { next.configurations.append(updated) }
            if next.selectedID == nil { next.selectedID = updated.id }
            try commit(next)
        } catch {
            if !newKey.isEmpty, let id = updated.secretID { try? secrets.remove(id) }
            throw error
        }
        cleanup()
    }
    func select(_ id: UUID) throws {
        guard let configuration = configurations.first(where: { $0.id == id }) else { throw AIError.missing }
        _ = try key(for: configuration)
        var next = catalog
        next.selectedID = id
        try commit(next)
    }
    func remove(_ id: UUID) throws {
        var next = catalog
        next.configurations.removeAll { $0.id == id }
        if next.selectedID == id { next.selectedID = nil }
        try commit(next)
        cleanup()
    }
    private func commit(_ next: Catalog) throws {
        do { try JSONEncoder().encode(next).write(to: file, options: .atomic) }
        catch { throw AIError.storage }
        catalog = next
    }
    private func cleanup() {
        // Retry removal of orphan revisions after interruption or failed cleanup.
        let used = Set(configurations.compactMap(\.secretID))
        for id in (try? secrets.accounts()) ?? [] where !used.contains(id) { try? secrets.remove(id) }
    }
}

final class AIConnection: NSObject, URLSessionTaskDelegate {
    static func endpoint(for configuration: AIConfiguration) throws -> URL {
        guard let components = URLComponents(string: configuration.address.trimmingCharacters(in: .whitespacesAndNewlines)),
              let host = components.host, !host.isEmpty,
              components.user == nil, components.password == nil, components.query == nil, components.fragment == nil,
              components.scheme == "https" || (components.scheme == "http" && ["localhost", "127.0.0.1", "[::1]"].contains(host)) else { throw AIError.address }
        var c = components
        var path = c.path
        while path.hasSuffix("/") { path.removeLast() }
        if !path.hasSuffix(configuration.format.path) {
            if path.isEmpty { path = "/v1" }
            path += configuration.format.path
        }
        c.path = path
        guard let url = c.url else { throw AIError.address }
        return url
    }
    func check(_ configuration: AIConfiguration, key: String) async throws {
        guard !configuration.model.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, !key.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw AIError.missing }
        guard key.rangeOfCharacter(from: .newlines) == nil else { throw AIError.authentication }
        let url = try Self.endpoint(for: configuration)
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 20
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if configuration.format == .openAI { request.setValue("Bearer " + key, forHTTPHeaderField: "Authorization") }
        else {
            request.setValue(key, forHTTPHeaderField: "x-api-key")
            request.setValue("2023-06-01", forHTTPHeaderField: "anthropic-version")
        }
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "model": configuration.model, "messages": [["role": "user", "content": "Reply OK."]], "max_tokens": 16, "stream": false
        ])
        let settings = URLSessionConfiguration.ephemeral
        settings.urlCache = nil
        settings.httpCookieStorage = nil
        let session = URLSession(configuration: settings, delegate: self, delegateQueue: nil)
        defer { session.invalidateAndCancel() }
        do {
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else { throw AIError.network }
            switch http.statusCode {
            case 200: break
            case 401, 403: throw AIError.authentication
            case 429: throw AIError.limited
            case 500...599: throw AIError.network
            default: throw AIError.incompatible
            }
            guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw AIError.incompatible }
            let text: String?
            if configuration.format == .openAI {
                let first = (json["choices"] as? [[String: Any]])?.first
                text = (first?["message"] as? [String: Any])?["content"] as? String
            } else {
                text = (json["content"] as? [[String: Any]])?.filter { $0["type"] as? String == "text" }.compactMap { $0["text"] as? String }.joined()
            }
            guard let text, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw AIError.incompatible }
        } catch let error as AIError { throw error }
        catch { throw AIError.network } // Never display response bodies, URLs or headers.
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil) // Never forward credentials to a redirect target.
    }
}
