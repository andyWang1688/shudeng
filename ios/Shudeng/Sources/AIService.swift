import Foundation
import Security

enum AIFormat: String, Codable, CaseIterable {
    case openAI = "OpenAI", anthropic = "Anthropic"
    var path: String { self == .openAI ? "/chat/completions" : "/messages" }
}

enum AIProvider: String, Codable {
    case deepSeek, custom
}

struct AIConfiguration: Codable, Identifiable, Equatable {
    var id = UUID()
    var name: String
    var format: AIFormat
    var address: String
    var model: String
    var secretID: String?
    // Optional so catalogs saved before service presets remain readable.
    var provider: AIProvider?

    static var deepSeek: AIConfiguration {
        AIConfiguration(name: "DeepSeek", format: .openAI, address: "https://api.deepseek.com", model: "deepseek-flash", provider: .deepSeek)
    }
}

enum AIError: Error, LocalizedError, Equatable {
    case missing, address, authentication, incompatible, capacity, network, limited, storage, secret
    case missingSecretReference, secretMissing, secretLocked, consentRequired
    var errorDescription: String? {
        switch self {
        case .missing: return "请填写服务、API Key 和模型；自定义服务还需在高级设置填写地址。"
        case .address: return "地址无效：请使用 HTTPS API 根地址或完整文字端点；本机测试可使用 HTTP。"
        case .authentication: return "鉴权失败，请检查密钥和服务权限。"
        case .incompatible: return "地址、模型或响应格式不兼容；仅支持非流式文字接口。"
        case .capacity: return "服务上下文容量不足或回答被截断，尚未完成；请缩短问题或选文后重试。"
        case .network: return "网络或服务暂时不可用，请稍后重试。"
        case .limited: return "服务限流或额度不足，请检查服务后重试。"
        case .storage: return "配置尚未保存，原配置未变；请重试。"
        case .missingSecretReference: return "此服务尚未保存 API Key，请重新填写并保存；检查连接不会保存 Key。"
        case .secretMissing: return "已保存的 API Key 已无法找到，请重新填写并保存。"
        case .secretLocked: return "设备 Keychain 当前已锁定或不允许交互，请解锁设备后重试。"
        case .secret: return "无法访问设备 Keychain，请重试或重新填写 API Key；若仍失败，请检查设备或应用权限。"
        case .consentRequired: return "请先到“我的 → AI 服务”确认此服务的发送说明；阅读仍可使用。"
        }
    }
    var offersKeyReplacement: Bool {
        [.missingSecretReference, .secretMissing, .secretLocked, .secret, .authentication].contains(self)
    }
}

enum AICheckResult: Equatable {
    case completed, outputLimited
    var statusDescription: String {
        switch self {
        case .completed: return "连接成功；尚未保存。"
        case .outputLimited: return "连接可达，但测试输出达到上限，未完成完整回答；尚未保存。"
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
    var service: String = {
#if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--isolated-reading-test") { return "dev.shudeng.ai-services.isolated-reading-test" }
#endif
        return "dev.shudeng.ai-services"
    }()
    private func query(_ id: String? = nil) -> [String: Any] {
        var q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service]
        if let id { q[kSecAttrAccount as String] = id }
        return q
    }
    static func error(for status: OSStatus) -> AIError {
        switch status {
        case errSecItemNotFound: return .secretMissing
        case errSecInteractionNotAllowed, errSecAuthFailed, errSecUserCanceled: return .secretLocked
        default: return .secret
        }
    }
    func read(_ id: String) throws -> String {
        var q = query(id)
        q[kSecReturnData as String] = true
        var result: CFTypeRef?
        let status = SecItemCopyMatching(q as CFDictionary, &result)
        guard status == errSecSuccess else { throw Self.error(for: status) }
        guard let data = result as? Data, let value = String(data: data, encoding: .utf8), !value.isEmpty else { throw AIError.secretMissing }
        return value
    }
    func write(_ value: String, id: String) throws {
        var q = query(id)
        q[kSecValueData as String] = Data(value.utf8)
        q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(q as CFDictionary, nil)
        guard status == errSecSuccess else { throw Self.error(for: status) }
    }
    func remove(_ id: String) throws {
        let status = SecItemDelete(query(id) as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw Self.error(for: status) }
    }
    func accounts() throws -> [String] {
        var q = query()
        q[kSecReturnAttributes as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitAll
        var result: CFTypeRef?
        let status = SecItemCopyMatching(q as CFDictionary, &result)
        if status == errSecItemNotFound { return [] }
        guard status == errSecSuccess else { throw Self.error(for: status) }
        guard let rows = result as? [[String: Any]] else { throw AIError.secret }
        return rows.compactMap { $0[kSecAttrAccount as String] as? String }
    }
}

@MainActor
final class AIConfigurationStore {
    private struct SendConsent: Codable {
        let configurationID: UUID
        let scope: SendScope
    }
    private struct SendScope: Codable, Equatable {
        let version: Int
        let provider: AIProvider
        let name: String
        let format: AIFormat
        let endpoint: String

        init(_ configuration: AIConfiguration) throws {
            version = 1
            provider = configuration.provider ?? .custom
            name = configuration.name.trimmingCharacters(in: .whitespacesAndNewlines)
            format = configuration.format
            endpoint = try AIConnection.endpoint(for: configuration).absoluteString
        }
    }
    private struct Catalog: Codable {
        var configurations: [AIConfiguration] = []
        var selectedID: UUID?
        var sendConsents: [SendConsent]?
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
    }
    func key(for configuration: AIConfiguration) throws -> String {
        guard let id = configuration.secretID, !id.isEmpty else { throw AIError.missingSecretReference }
        return try secrets.read(id)
    }
    /// Read-only preflight. A successful connection check never calls save or grants consent.
    func validateForSave(_ configuration: AIConfiguration, newKey: String) throws {
        guard !configuration.address.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              !configuration.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              !configuration.model.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw AIError.missing }
        _ = try AIConnection.endpoint(for: configuration)
        if newKey.isEmpty {
            guard let old = configurations.first(where: { $0.id == configuration.id }) else { throw AIError.missing }
            _ = try key(for: old)
        } else {
            guard !newKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw AIError.missing }
            guard newKey.rangeOfCharacter(from: .newlines) == nil else { throw AIError.authentication }
        }
    }
    /// Consent is tied to the normalized destination, provider, service name and protocol.
    /// Key replacement and model changes alone do not change the sending scope.
    func hasSendConsent(for configuration: AIConfiguration) -> Bool {
        guard let scope = try? SendScope(configuration) else { return false }
        return catalog.sendConsents?.contains { $0.configurationID == configuration.id && $0.scope == scope } == true
    }
    /// Integration point for QuestionController: call before sending, then use key(for:).
    /// Legacy catalogs remain usable for reading and settings, but do not imply consent.
    func selectedConfigurationForSending() throws -> AIConfiguration {
        guard let configuration = configurations.first(where: { $0.id == selectedID }) else { throw AIError.missing }
        guard hasSendConsent(for: configuration) else { throw AIError.consentRequired }
        return configuration
    }
    func save(_ configuration: AIConfiguration, newKey: String, confirmingSendConsent: Bool = false) throws {
        try validateForSave(configuration, newKey: newKey)
        let previousSecretID = configurations.first(where: { $0.id == configuration.id })?.secretID
        var updated = configuration
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
            try updateConsent(in: &next, for: updated, confirmed: confirmingSendConsent)
            try commit(next)
        } catch {
            if !newKey.isEmpty, let id = updated.secretID { try? secrets.remove(id) }
            throw error
        }
        if previousSecretID != updated.secretID { removeUnusedSecret(previousSecretID) }
    }
    func select(_ id: UUID, confirmingSendConsent: Bool = false) throws {
        guard let configuration = configurations.first(where: { $0.id == id }) else { throw AIError.missing }
        _ = try key(for: configuration)
        var next = catalog
        next.selectedID = id
        try updateConsent(in: &next, for: configuration, confirmed: confirmingSendConsent)
        try commit(next)
    }
    func remove(_ id: UUID) throws {
        let secretID = configurations.first(where: { $0.id == id })?.secretID
        var next = catalog
        next.configurations.removeAll { $0.id == id }
        next.sendConsents?.removeAll { $0.configurationID == id }
        if next.selectedID == id { next.selectedID = nil }
        try commit(next)
        removeUnusedSecret(secretID)
    }
    private func updateConsent(in next: inout Catalog, for configuration: AIConfiguration, confirmed: Bool) throws {
        let scope = try SendScope(configuration)
        var consents = next.sendConsents ?? []
        consents.removeAll { $0.configurationID == configuration.id && (confirmed || $0.scope != scope) }
        if confirmed { consents.append(SendConsent(configurationID: configuration.id, scope: scope)) }
        next.sendConsents = consents
    }
    private func commit(_ next: Catalog) throws {
        do { try JSONEncoder().encode(next).write(to: file, options: .atomic) }
        catch { throw AIError.storage }
        catalog = next
    }
    private func removeUnusedSecret(_ id: String?) {
        // The Keychain service can contain other catalogs' live keys. Only remove
        // a revision this catalog explicitly replaced or deleted, never sweep it.
        guard let id, !configurations.contains(where: { $0.secretID == id }) else { return }
        try? secrets.remove(id)
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
    @discardableResult
    func check(_ configuration: AIConfiguration, key: String) async throws -> AICheckResult {
        let response = try await response(configuration, key: key, prompt: "Reply OK.", maxTokens: 16, timeout: 20, checkingConnection: true)
        return response.outputLimited ? .outputLimited : .completed
    }
    func text(_ configuration: AIConfiguration, key: String, prompt: String, maxTokens: Int, timeout: TimeInterval) async throws -> String {
        try await response(configuration, key: key, prompt: prompt, maxTokens: maxTokens, timeout: timeout, checkingConnection: false).text
    }
    static func request(_ configuration: AIConfiguration, key: String, prompt: String, maxTokens: Int, timeout: TimeInterval) throws -> URLRequest {
        guard !configuration.model.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, !key.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw AIError.missing }
        guard key.rangeOfCharacter(from: .newlines) == nil else { throw AIError.authentication }
        let url = try Self.endpoint(for: configuration)
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = timeout
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if configuration.format == .openAI { request.setValue("Bearer " + key, forHTTPHeaderField: "Authorization") }
        else {
            request.setValue(key, forHTTPHeaderField: "x-api-key")
            request.setValue("2023-06-01", forHTTPHeaderField: "anthropic-version")
        }
        var body: [String: Any] = [
            "model": configuration.model, "messages": [["role": "user", "content": prompt]], "max_tokens": maxTokens, "stream": false
        ]
        if configuration.model == "deepseek-flash",
           url.scheme == "https", url.host == "api.deepseek.com", url.port == nil || url.port == 443,
           (configuration.format == .openAI && ["/chat/completions", "/v1/chat/completions"].contains(url.path)) ||
           (configuration.format == .anthropic && url.path == "/anthropic/v1/messages") {
            body["thinking"] = ["type": "disabled"]
        }
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        return request
    }
    private func response(_ configuration: AIConfiguration, key: String, prompt: String, maxTokens: Int, timeout: TimeInterval, checkingConnection: Bool) async throws -> (text: String, outputLimited: Bool) {
        let request = try Self.request(configuration, key: key, prompt: prompt, maxTokens: maxTokens, timeout: timeout)
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
            case 400:
                let body = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
                let detail = body?["error"] as? [String: Any]
                if detail?["code"] as? String == "context_length_exceeded" ||
                    (detail?["message"] as? String)?.lowercased().contains("prompt is too long") == true { throw AIError.capacity }
                throw AIError.incompatible
            case 401, 403: throw AIError.authentication
            case 429: throw AIError.limited
            case 413: throw AIError.capacity
            case 500...599: throw AIError.network
            default: throw AIError.incompatible
            }
            guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw AIError.incompatible }
            let text: String?
            let outputLimited: Bool
            var hasReasoning = false
            if configuration.format == .openAI {
                guard let first = (json["choices"] as? [[String: Any]])?.first,
                      let message = first["message"] as? [String: Any] else { throw AIError.incompatible }
                outputLimited = first["finish_reason"] as? String == "length"
                text = message["content"] as? String
                hasReasoning = !(message["reasoning_content"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            } else {
                outputLimited = json["stop_reason"] as? String == "max_tokens"
                text = (json["content"] as? [[String: Any]])?.filter { $0["type"] as? String == "text" }.compactMap { $0["text"] as? String }.joined()
            }
            if outputLimited && !checkingConnection { throw AIError.capacity }
            let hasText = !(text ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            guard hasText || (checkingConnection && outputLimited && hasReasoning) else { throw AIError.incompatible }
            return (text ?? "", outputLimited)
        } catch is CancellationError { throw CancellationError() }
        catch let error as AIError { throw error }
        catch { throw AIError.network } // Never display response bodies, URLs or headers.
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil) // Never forward credentials to a redirect target.
    }
}
