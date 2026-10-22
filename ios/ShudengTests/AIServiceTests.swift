import XCTest
@testable import Shudeng

@MainActor
final class AIServiceTests: XCTestCase {
    private var root: URL!
    private var secrets: KeychainSecrets!
    private let token = "not-a-real-credential"
    override func setUp() async throws {
        root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        secrets = KeychainSecrets(service: "dev.shudeng.tests.ai." + UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    }
    override func tearDown() async throws {
        for id in try secrets.accounts() { try secrets.remove(id) }
        try? FileManager.default.removeItem(at: root)
    }
    private func configuration(_ format: AIFormat = .openAI, model: String = "test-model") -> AIConfiguration {
        AIConfiguration(name: format.rawValue, format: format, address: "http://127.0.0.1:18767/v1", model: model)
    }
    func testRealHTTPBothFormatsAndClassifiedFailures() async throws {
        let connection = AIConnection()
        for format in AIFormat.allCases {
            let result = try await connection.check(configuration(format), key: token)
            XCTAssertEqual(result, .completed)
            for (model, expected) in [("auth", AIError.authentication), ("forbidden", .authentication), ("missing-model", .incompatible), ("bad-model", .incompatible), ("limited", .limited), ("unavailable", .network), ("malformed", .incompatible), ("empty", .incompatible), ("redirect", .incompatible), ("context-long", .capacity), ("payload-too-large", .capacity)] {
                do { try await connection.check(configuration(format, model: model), key: token); XCTFail("Expected classified failure") }
                catch {
                    XCTAssertEqual(error as? AIError, expected)
                    XCTAssertFalse(error.localizedDescription.contains(token))
                    XCTAssertFalse(error.localizedDescription.contains("Bearer"))
                }
            }
        }
        var custom = configuration()
        custom.address = "http://127.0.0.1:18767/gateway/v1/"
        try await connection.check(custom, key: token)
        custom.address = "http://127.0.0.1:18768/v1"
        do { try await connection.check(custom, key: token); XCTFail("Expected network failure") }
        catch { XCTAssertEqual(error as? AIError, .network) }
        do { try await connection.check(configuration(), key: ""); XCTFail("Expected missing configuration") }
        catch { XCTAssertEqual(error as? AIError, .missing) }
    }
    func testConnectionProbeDistinguishesLimitedOutputFromIncompleteReadingAnswers() async throws {
        let connection = AIConnection()
        for format in AIFormat.allCases {
            let result = try await connection.check(configuration(format, model: "output-limited"), key: token)
            XCTAssertEqual(result, .outputLimited)
            XCTAssertEqual(result.statusDescription, "连接可达，但测试输出达到上限，未完成完整回答；尚未保存。")
            for model in ["empty-limited", "malformed-limited"] {
                do { try await connection.check(configuration(format, model: model), key: token); XCTFail("Expected incompatible probe response") }
                catch { XCTAssertEqual(error as? AIError, .incompatible) }
            }
            for model in ["output-limited", "context-long", "payload-too-large"] {
                do {
                    _ = try await connection.text(configuration(format, model: model), key: token, prompt: "Fixture reading question.", maxTokens: 128, timeout: 5)
                    XCTFail("Incomplete reading answer must not succeed")
                } catch { XCTAssertEqual(error as? AIError, .capacity) }
            }
        }
    }
    func testReasoningOnlyProbeRequiresEffectiveOutputAndLengthLimit() async throws {
        let connection = AIConnection()
        let c = configuration(model: "reasoning-limited")
        let result = try await connection.check(c, key: token)
        XCTAssertEqual(result, .outputLimited)
        do {
            _ = try await connection.text(c, key: token, prompt: "Fixture reading question.", maxTokens: 128, timeout: 5)
            XCTFail("Reasoning must not become a complete reading answer")
        } catch { XCTAssertEqual(error as? AIError, .capacity) }
        for model in ["reasoning-empty-limited", "reasoning-complete"] {
            do { try await connection.check(configuration(model: model), key: token); XCTFail("Expected incompatible probe response") }
            catch { XCTAssertEqual(error as? AIError, .incompatible) }
        }
    }
    func testEndpointContract() throws {
        var c = configuration()
        for (address, expected) in [("https://example.com", "https://example.com/v1/chat/completions"), ("https://example.com/v1/", "https://example.com/v1/chat/completions"), ("https://example.com/proxy/chat/completions/", "https://example.com/proxy/chat/completions")] {
            c.address = address
            XCTAssertEqual(try AIConnection.endpoint(for: c).absoluteString, expected)
        }
        c.format = .anthropic; c.address = "https://example.com/v1/messages"
        XCTAssertEqual(try AIConnection.endpoint(for: c).path, "/v1/messages")
        for address in ["", "http://example.com", "https://user:pass@example.com", "https://example.com?key=secret", "https://example.com/#key", "file:///tmp"] {
            c.address = address; XCTAssertThrowsError(try AIConnection.endpoint(for: c))
        }
    }
    func testOfficialDeepSeekTextRequestDisablesThinkingWithinExistingBudgets() throws {
        var c = configuration(model: "deepseek-flash")
        for address in ["https://api.deepseek.com", "https://api.deepseek.com/v1/", "https://api.deepseek.com/chat/completions", "https://api.deepseek.com/v1/chat/completions/", "https://api.deepseek.com:443/chat/completions"] {
            c.address = address
            for (maxTokens, timeout) in [(16, 20.0), (600, 30.0), (1600, 90.0)] {
                let request = try AIConnection.request(c, key: token, prompt: "Fixture text.", maxTokens: maxTokens, timeout: timeout)
                let body = try XCTUnwrap(JSONSerialization.jsonObject(with: XCTUnwrap(request.httpBody)) as? [String: Any])
                XCTAssertEqual(Set(body.keys), Set(["model", "messages", "max_tokens", "stream", "thinking"]))
                XCTAssertEqual(body["thinking"] as? [String: String], ["type": "disabled"])
                XCTAssertEqual(body["model"] as? String, "deepseek-flash")
                XCTAssertEqual(body["messages"] as? [[String: String]], [["role": "user", "content": "Fixture text."]])
                XCTAssertEqual(body["max_tokens"] as? Int, maxTokens)
                XCTAssertEqual(body["stream"] as? Bool, false)
                XCTAssertEqual(request.url, try AIConnection.endpoint(for: c))
                XCTAssertEqual(request.httpMethod, "POST")
                XCTAssertEqual(request.timeoutInterval, timeout)
                XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer " + token)
                XCTAssertNil(request.value(forHTTPHeaderField: "x-api-key"))
            }
        }
    }
    func testOfficialDeepSeekAnthropicRequestDisablesThinkingWithinExistingBudgets() throws {
        var c = configuration(.anthropic, model: "deepseek-flash")
        for address in ["https://api.deepseek.com/anthropic/v1/messages", "https://api.deepseek.com:443/anthropic/v1/messages/"] {
            c.address = address
            for (maxTokens, timeout) in [(16, 20.0), (600, 30.0), (1600, 90.0)] {
                let request = try AIConnection.request(c, key: token, prompt: "Fixture text.", maxTokens: maxTokens, timeout: timeout)
                let body = try XCTUnwrap(JSONSerialization.jsonObject(with: XCTUnwrap(request.httpBody)) as? [String: Any])
                XCTAssertEqual(Set(body.keys), Set(["model", "messages", "max_tokens", "stream", "thinking"]))
                XCTAssertEqual(body["thinking"] as? [String: String], ["type": "disabled"])
                XCTAssertEqual(body["model"] as? String, "deepseek-flash")
                XCTAssertEqual(body["messages"] as? [[String: String]], [["role": "user", "content": "Fixture text."]])
                XCTAssertEqual(body["max_tokens"] as? Int, maxTokens)
                XCTAssertEqual(body["stream"] as? Bool, false)
                XCTAssertEqual(request.url?.path, "/anthropic/v1/messages")
                XCTAssertEqual(request.httpMethod, "POST")
                XCTAssertEqual(request.timeoutInterval, timeout)
                XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")
                XCTAssertNil(request.value(forHTTPHeaderField: "Authorization"))
                XCTAssertEqual(request.value(forHTTPHeaderField: "x-api-key"), token)
                XCTAssertEqual(request.value(forHTTPHeaderField: "anthropic-version"), "2023-06-01")
            }
        }
    }
    func testOtherTextRequestsKeepFourFieldContract() throws {
        let cases: [(String, String, AIFormat)] = [
            ("https://gateway.example/v1", "deepseek-flash", .openAI),
            ("https://api.deepseek.com.example/v1", "deepseek-flash", .openAI),
            ("https://api.deepseek.com:8443/v1", "deepseek-flash", .openAI),
            ("https://api.deepseek.com/gateway/v1", "deepseek-flash", .openAI),
            ("https://api.deepseek.com/beta/chat/completions", "deepseek-flash", .openAI),
            ("http://127.0.0.1:18767/v1", "deepseek-flash", .openAI),
            ("https://api.deepseek.com/v1", "deepseek-v4-pro", .openAI),
            ("https://api.deepseek.com/v1", "deepseek-v4-flash", .openAI),
            ("https://api.deepseek.com/v1", "deepseek-flash-future", .openAI),
            ("https://api.deepseek.com/v1", "DeepSeek-Flash", .openAI),
            ("https://api.deepseek.com/anthropic", "deepseek-flash", .anthropic),
            ("https://gateway.example/anthropic/v1/messages", "deepseek-flash", .anthropic),
            ("https://api.deepseek.com.example/anthropic/v1/messages", "deepseek-flash", .anthropic),
            ("https://api.deepseek.com:8443/anthropic/v1/messages", "deepseek-flash", .anthropic),
            ("https://api.deepseek.com/v1/messages", "deepseek-flash", .anthropic),
            ("https://api.deepseek.com/proxy/anthropic/v1/messages", "deepseek-flash", .anthropic),
            ("https://api.deepseek.com/anthropic/v1/messages", "deepseek-v4-pro", .anthropic),
            ("https://api.deepseek.com/anthropic/v1/messages", "deepseek-flash-future", .anthropic)
        ]
        for (address, model, format) in cases {
            var c = configuration(format, model: model)
            c.address = address
            for (maxTokens, timeout) in [(16, 20.0), (600, 30.0), (1600, 90.0)] {
                let request = try AIConnection.request(c, key: token, prompt: "Fixture text.", maxTokens: maxTokens, timeout: timeout)
                let body = try XCTUnwrap(JSONSerialization.jsonObject(with: XCTUnwrap(request.httpBody)) as? [String: Any])
                XCTAssertEqual(Set(body.keys), Set(["model", "messages", "max_tokens", "stream"]), address + " / " + model)
                XCTAssertEqual(body["model"] as? String, model)
                XCTAssertEqual(body["messages"] as? [[String: String]], [["role": "user", "content": "Fixture text."]])
                XCTAssertEqual(body["max_tokens"] as? Int, maxTokens)
                XCTAssertEqual(body["stream"] as? Bool, false)
                XCTAssertEqual(request.timeoutInterval, timeout)
                XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")
                if format == .openAI {
                    XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer " + token)
                    XCTAssertNil(request.value(forHTTPHeaderField: "x-api-key"))
                } else {
                    XCTAssertNil(request.value(forHTTPHeaderField: "Authorization"))
                    XCTAssertEqual(request.value(forHTTPHeaderField: "x-api-key"), token)
                    XCTAssertEqual(request.value(forHTTPHeaderField: "anthropic-version"), "2023-06-01")
                }
            }
        }
    }
    func testKeychainRestartSwitchAndAtomicFailureRecovery() async throws {
        let store = try AIConfigurationStore(root: root, secrets: secrets)
        let a = configuration(), b = configuration(.anthropic)
        try store.save(a, newKey: token)
        try store.save(b, newKey: "second-fictional-credential")
        try store.select(b.id)
        let restarted = try AIConfigurationStore(root: root, secrets: secrets)
        XCTAssertEqual(restarted.configurations.count, 2)
        XCTAssertEqual(restarted.selectedID, b.id)
        XCTAssertTrue(try restarted.key(for: restarted.configurations[0]) == token)
        let file = root.appendingPathComponent("ai-services.json")
        let before = try Data(contentsOf: file)
        XCTAssertFalse(String(decoding: before, as: UTF8.self).contains(token))
        XCTAssertFalse(String(decoding: before, as: UTF8.self).contains("second-fictional-credential"))
        let backup = root.appendingPathComponent("committed.json")
        try FileManager.default.moveItem(at: file, to: backup)
        try FileManager.default.createDirectory(at: file, withIntermediateDirectories: false)
        var changed = restarted.configurations[0]; changed.model = "edited"
        XCTAssertThrowsError(try restarted.save(changed, newKey: "replacement-fictional-credential"))
        XCTAssertThrowsError(try restarted.select(a.id))
        XCTAssertThrowsError(try restarted.remove(b.id))
        XCTAssertEqual(restarted.selectedID, b.id)
        XCTAssertEqual(restarted.configurations[0].model, "test-model")
        XCTAssertEqual(try secrets.accounts().count, 2)
        XCTAssertTrue(try restarted.key(for: restarted.configurations[0]) == token)
        try FileManager.default.removeItem(at: file)
        try FileManager.default.moveItem(at: backup, to: file)
        XCTAssertEqual(try Data(contentsOf: file), before)
        try restarted.save(changed, newKey: "replacement-fictional-credential")
        try restarted.save(changed, newKey: "")
        try restarted.select(a.id)
        let final = try AIConfigurationStore(root: root, secrets: secrets)
        XCTAssertEqual(final.selectedID, a.id)
        XCTAssertEqual(final.configurations.count, 2)
        XCTAssertTrue(try final.key(for: final.configurations[0]) == "replacement-fictional-credential")
        XCTAssertThrowsError(try secrets.read(store.configurations[0].secretID!))
        XCTAssertEqual(try secrets.accounts().count, 2)
        // A process death before catalog replacement leaves an orphan only.
        try secrets.write("orphan-fictional-credential", id: "orphan")
        _ = try AIConfigurationStore(root: root, secrets: secrets)
        XCTAssertEqual(try secrets.accounts().count, 2)
        try final.remove(a.id)
        XCTAssertNil(try AIConfigurationStore(root: root, secrets: secrets).selectedID)
        XCTAssertEqual(try secrets.accounts().count, 1)
    }
    func testKeychainFailureAndMissingKeyNeverPublishSuccess() throws {
        let actual = secrets!
        let store = try AIConfigurationStore(root: root, secrets: actual)
        let c = configuration()
        try store.save(c, newKey: token)
        let file = root.appendingPathComponent("ai-services.json")
        let committed = try Data(contentsOf: file)
        let failing = try AIConfigurationStore(root: root, secrets: FailingSecrets(actual: actual))
        XCTAssertThrowsError(try failing.save(failing.configurations[0], newKey: token))
        XCTAssertEqual(try Data(contentsOf: file), committed)
        try actual.remove(store.configurations[0].secretID!)
        XCTAssertThrowsError(try store.select(c.id))
        XCTAssertThrowsError(try store.save(store.configurations[0], newKey: ""))
        XCTAssertEqual(try Data(contentsOf: file), committed)
        try store.save(store.configurations[0], newKey: token)
        XCTAssertTrue(try store.key(for: store.configurations[0]) == token)
    }
}

private struct FailingSecrets: AISecrets {
    let actual: KeychainSecrets
    func read(_ id: String) throws -> String { try actual.read(id) }
    func write(_ value: String, id: String) throws { throw AIError.secret }
    func remove(_ id: String) throws { try actual.remove(id) }
    func accounts() throws -> [String] { try actual.accounts() }
}
