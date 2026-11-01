import Foundation

/// 原生 URLSession MCP 客户端（iOS 17+，无第三方依赖）。
///
/// 支持 remote MCP 的 Streamable HTTP / SSE 响应：
/// - initialize 握手（协议版本协商 + Mcp-Session-Id）
/// - tools/list（分页）
/// - tools/call
/// - 超时、取消、错误、断线后下次重连
/// 不支持 stdio / 本地进程（iOS 沙盒不允许）；不访问书库或 AI Key。
@available(iOS 17.0, *)
actor MCPClientManager {
    static let shared = MCPClientManager()

    private struct Session {
        let endpoint: String
        let transport: MCPTransportKind
        var sessionID: String?
        var protocolVersion: String
    }

    private var sessions: [UUID: Session] = [:]
    private var nextRequestID = 1

    private let connectTimeout: TimeInterval = 20
    private let discoverTimeout: TimeInterval = 30
    private let callTimeout: TimeInterval = 60
    private let maxResponseBytes = 2_000_000

    private lazy var urlSession: URLSession = {
        let configuration = URLSessionConfiguration.default
        configuration.timeoutIntervalForRequest = 25
        configuration.timeoutIntervalForResource = 90
        configuration.waitsForConnectivity = false
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        return URLSession(configuration: configuration)
    }()

    // MARK: - 工具发现

    func discoverTools(for server: MCPServerConfiguration) async throws -> [MCPToolDescriptor] {
        guard server.isEnabled else { throw MCPError.disabled }
        var discovered: [MCPToolDescriptor] = []
        var cursor: String?
        repeat {
            try Task.checkCancellation()
            var params: [String: Any] = [:]
            if let cursor { params["cursor"] = cursor }
            let result: [String: Any]
            do {
                result = try await send(server, method: "tools/list", params: params, timeout: discoverTimeout)
            } catch {
                if error is CancellationError { await reset(serverID: server.id); throw error }
                await reset(serverID: server.id)
                throw MCPError.connection(Self.message(for: error))
            }
            let tools = result["tools"] as? [[String: Any]] ?? []
            for tool in tools {
                guard let name = tool["name"] as? String, !name.isEmpty, name.count <= 128 else { continue }
                let annotations = tool["annotations"] as? [String: Any]
                discovered.append(MCPToolDescriptor(
                    name: name,
                    title: (tool["title"] as? String).flatMap { $0.isEmpty ? nil : $0 },
                    description: Self.trimmedDescription(tool["description"] as? String),
                    inputSchemaJSON: Self.jsonString(tool["inputSchema"] as? [String: Any]
                        ?? ["type": "object", "properties": [:] as [String: Any]]),
                    readOnly: annotations?["readOnlyHint"] as? Bool == true
                ))
                if discovered.count >= 200 { break }
            }
            cursor = result["nextCursor"] as? String
        } while cursor != nil
        return discovered
    }

    // MARK: - 工具调用

    func callTool(server: MCPServerConfiguration, tool: String, argumentsJSON: String) async throws -> String {
        guard server.isEnabled else { throw MCPError.disabled }
        let arguments = try Self.arguments(from: argumentsJSON)
        let result: [String: Any]
        do {
            result = try await send(server, method: "tools/call",
                                    params: ["name": tool, "arguments": arguments],
                                    timeout: callTimeout)
        } catch {
            if error is CancellationError { await reset(serverID: server.id); throw error }
            await reset(serverID: server.id)
            throw MCPError.connection(Self.message(for: error))
        }
        let isError = result["isError"] as? Bool == true
        let text = Self.text(from: result["content"])
        if isError { return "[外部工具返回错误] " + text }
        return text
    }

    func disconnect(serverID: UUID) async {
        sessions.removeValue(forKey: serverID)
    }

    func disconnectAll() async {
        sessions.removeAll()
    }

    // MARK: - 协议

    private func send(
        _ server: MCPServerConfiguration,
        method: String,
        params: [String: Any],
        timeout: TimeInterval
    ) async throws -> [String: Any] {
        guard let url = server.endpointURL else { throw MCPError.invalidURL }
        var session = try await session(for: server, url: url)
        let id = nextRequestID
        nextRequestID += 1
        let body: [String: Any] = ["jsonrpc": "2.0", "id": id, "method": method, "params": params]
        let (data, headers) = try await post(server, url: url, session: session, body: body, timeout: timeout)
        if let sessionID = Self.header("Mcp-Session-Id", in: headers) { session.sessionID = sessionID }
        sessions[server.id] = session
        let messages = try Self.messages(from: data, headers: headers)
        if let error = messages.compactMap({ $0["error"] as? [String: Any] }).first {
            let message = error["message"] as? String ?? "未知错误"
            throw MCPError.protocolFailure(message)
        }
        for message in messages {
            let value = message["id"]
            let messageID = (value as? Int) ?? (value as? NSNumber)?.intValue
            if messageID == id {
                return message["result"] as? [String: Any] ?? [:]
            }
        }
        throw MCPError.protocolFailure("没有收到匹配的响应")
    }

    private func session(for server: MCPServerConfiguration, url: URL) async throws -> Session {
        if let existing = sessions[server.id],
           existing.endpoint == url.absoluteString, existing.transport == server.transport {
            return existing
        }
        var session = Session(endpoint: url.absoluteString, transport: server.transport,
                              sessionID: nil, protocolVersion: Self.protocolVersion)
        let params: [String: Any] = [
            "protocolVersion": Self.protocolVersion,
            "capabilities": [:] as [String: Any],
            "clientInfo": ["name": "书灯", "version": Self.appVersion]
        ]
        let body: [String: Any] = ["jsonrpc": "2.0", "id": 0, "method": "initialize", "params": params]
        let (data, headers) = try await post(server, url: url, session: session, body: body, timeout: connectTimeout)
        if let sessionID = Self.header("Mcp-Session-Id", in: headers) { session.sessionID = sessionID }
        let messages = try Self.messages(from: data, headers: headers)
        if let error = messages.compactMap({ $0["error"] as? [String: Any] }).first {
            throw MCPError.protocolFailure(error["message"] as? String ?? "initialize 失败")
        }
        let initResult = messages.compactMap { $0["result"] as? [String: Any] }.first ?? [:]
        if let negotiated = initResult["protocolVersion"] as? String, !negotiated.isEmpty {
            session.protocolVersion = negotiated
        }
        sessions[server.id] = session
        // 规范要求的 initialized notification；服务端没有响应，失败也不阻断连接。
        let notification: [String: Any] = ["jsonrpc": "2.0", "method": "notifications/initialized", "params": [:]]
        _ = try? await post(server, url: url, session: session, body: notification,
                            timeout: connectTimeout, expectResponse: false)
        return session
    }

    private func post(
        _ server: MCPServerConfiguration,
        url: URL,
        session: Session,
        body: [String: Any],
        timeout: TimeInterval,
        expectResponse: Bool = true
    ) async throws -> (Data, HTTPURLResponse) {
        let data = try JSONSerialization.data(withJSONObject: body)
        guard data.count <= 65_536 else { throw MCPError.protocolFailure("请求过大") }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = min(timeout, 25)
        request.httpBody = data
        var headers: [String: String] = [
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
            "MCP-Protocol-Version": session.protocolVersion
        ]
        if let sessionID = session.sessionID { headers["Mcp-Session-Id"] = sessionID }
        for (name, value) in Self.sanitizedHeaders(server.headers) { headers[name] = value }
        for (name, value) in headers { request.setValue(value, forHTTPHeaderField: name) }
        let finalRequest = request

        let result: (Data, URLResponse)
        do {
            result = try await withTimeout(timeout) {
                try await self.urlSession.data(for: finalRequest)
            }
        } catch {
            if error is CancellationError { throw error }
            if let mcp = error as? MCPError { throw mcp }
            throw MCPError.timedOut
        }
        let (responseData, response) = result
        guard let http = response as? HTTPURLResponse else {
            throw MCPError.protocolFailure("非 HTTP 响应")
        }
        guard (200..<300).contains(http.statusCode) else {
            if http.statusCode == 401 || http.statusCode == 403 { throw MCPError.connection("鉴权失败") }
            if http.statusCode == 404 { throw MCPError.connection("服务地址不存在或会话已过期") }
            if http.statusCode == 405 { throw MCPError.connection("服务不支持 POST") }
            throw MCPError.connection("HTTP \(http.statusCode)")
        }
        guard responseData.count <= maxResponseBytes else { throw MCPError.outputTooLarge }
        if !expectResponse { return (responseData, http) }
        return (responseData, http)
    }

    private func reset(serverID: UUID) async {
        sessions.removeValue(forKey: serverID)
    }

    // MARK: - 转换

    private static func messages(from data: Data, headers: HTTPURLResponse) throws -> [[String: Any]] {
        let contentType = headers.value(forHTTPHeaderField: "Content-Type")?.lowercased() ?? ""
        if contentType.contains("text/event-stream") {
            return sseMessages(from: data)
        }
        guard !data.isEmpty else { return [] }
        let object = try? JSONSerialization.jsonObject(with: data)
        if let dictionary = object as? [String: Any] { return [dictionary] }
        if let array = object as? [[String: Any]] { return array }
        throw MCPError.protocolFailure("响应不是 JSON")
    }

    private static func sseMessages(from data: Data) -> [[String: Any]] {
        let text = String(decoding: data, as: UTF8.self)
        var messages: [[String: Any]] = []
        var payload = ""
        func flush() {
            guard !payload.isEmpty else { return }
            if let data = payload.data(using: .utf8),
               let object = try? JSONSerialization.jsonObject(with: data),
               let dictionary = object as? [String: Any] {
                messages.append(dictionary)
            }
            payload = ""
        }
        for line in text.split(separator: "\n", omittingEmptySubsequences: false) {
            let value = String(line)
            if value.isEmpty { flush(); continue }
            if value.hasPrefix("data:") {
                let chunk = String(value.dropFirst(5)).trimmingCharacters(in: .whitespaces)
                payload += payload.isEmpty ? chunk : "\n" + chunk
            }
        }
        flush()
        return messages
    }

    private static func header(_ name: String, in response: HTTPURLResponse) -> String? {
        for (key, value) in response.allHeaderFields {
            if String(describing: key).caseInsensitiveCompare(name) == .orderedSame {
                return String(describing: value)
            }
        }
        return nil
    }

    private static func arguments(from json: String) throws -> [String: Any] {
        guard json.utf8.count <= 32_768 else { throw AgentToolError.invalidArguments("外部工具参数过长") }
        guard let data = json.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw AgentToolError.invalidArguments("外部工具参数必须是 JSON 对象")
        }
        return object
    }

    private static func jsonString(_ value: Any) -> String {
        guard JSONSerialization.isValidJSONObject(value),
              let data = try? JSONSerialization.data(withJSONObject: value),
              let text = String(data: data, encoding: .utf8) else {
            return #"{"type":"object","properties":{}}"#
        }
        return text
    }

    private static func text(from content: Any?) -> String {
        guard let content = content as? [[String: Any]] else { return "外部工具没有返回文本内容" }
        var parts: [String] = []
        for item in content {
            switch item["type"] as? String {
            case "text":
                if let text = item["text"] as? String { parts.append(text) }
            case "image":
                parts.append("[图片内容 \(item["mimeType"] as? String ?? "image")，已省略]")
            case "audio":
                parts.append("[音频内容 \(item["mimeType"] as? String ?? "audio")，已省略]")
            case "resource":
                parts.append("[资源内容已省略]")
            case "resource_link":
                let name = item["name"] as? String ?? "资源"
                parts.append("[资源链接 \(name) \(item["uri"] as? String ?? "")]")
            default:
                continue
            }
        }
        let joined = parts.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !joined.isEmpty else { return "外部工具没有返回文本内容" }
        guard joined.count <= 8_000 else { return String(joined.prefix(8_000)) + "…" }
        return joined
    }

    private static func trimmedDescription(_ text: String?) -> String? {
        guard let text else { return nil }
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        return String(trimmed.prefix(1200))
    }

    private static func sanitizedHeaders(_ raw: [String: String]?) -> [String: String] {
        guard let raw else { return [:] }
        var values: [String: String] = [:]
        for (name, value) in raw {
            let key = name.trimmingCharacters(in: .whitespaces)
            let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !key.isEmpty, key.count <= 64, !key.contains(where: { $0 == ":" || $0.isNewline }),
                  !trimmed.isEmpty, trimmed.count <= 2048, !trimmed.contains(where: \.isNewline) else { continue }
            if key.caseInsensitiveCompare("Host") == .orderedSame
                || key.caseInsensitiveCompare("Content-Type") == .orderedSame
                || key.caseInsensitiveCompare("Content-Length") == .orderedSame
                || key.caseInsensitiveCompare("Accept") == .orderedSame
                || key.caseInsensitiveCompare("Mcp-Session-Id") == .orderedSame
                || key.caseInsensitiveCompare("MCP-Protocol-Version") == .orderedSame { continue }
            values[key] = trimmed
        }
        return values
    }

    private static func message(for error: Error) -> String {
        if let localized = (error as? LocalizedError)?.errorDescription, !localized.isEmpty { return localized }
        return "连接失败，请稍后重试"
    }

    private static let protocolVersion = "2025-11-25"
    private static var appVersion: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0"
    }
}

/// 同时等待操作与超时；先完成的胜出，另一个取消。
@available(iOS 17.0, *)
private func withTimeout<T: Sendable>(
    _ seconds: TimeInterval,
    _ operation: @escaping @Sendable () async throws -> T
) async throws -> T {
    try await withThrowingTaskGroup(of: T.self) { group in
        group.addTask(operation: operation)
        group.addTask {
            try await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
            throw MCPError.timedOut
        }
        guard let result = try await group.next() else { throw MCPError.timedOut }
        group.cancelAll()
        return result
    }
}
