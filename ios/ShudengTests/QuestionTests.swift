import XCTest
import ReadiumShared
@testable import Shudeng

@MainActor
final class QuestionTests: XCTestCase {
    private var root: URL!
    private var secrets: KeychainSecrets!
    override func setUp() async throws {
        root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        secrets = KeychainSecrets(service: "dev.shudeng.tests.question." + UUID().uuidString)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    }
    override func tearDown() async throws {
        for id in try secrets.accounts() { try secrets.remove(id) }
        try? FileManager.default.removeItem(at: root)
    }
    private func question(_ quote: String = "Safety requires review.") -> ReadingQuestion {
        let book = Book(id: "current-book", title: "Original test book", author: "Test")
        let location = Locator(href: AnyURL(string: "chapter2.xhtml")!, mediaType: .xhtml, title: "Second chapter",
            locations: .init(otherLocations: ["cssSelector": .string("#second-occurrence")]), text: .init(highlight: quote))
        var record = ReadingQuestion(book: book, selection: QuestionEvidence(locator: location), neighbors: [])
        record.question = "Why review?"; return record
    }
    func testAtomicCompletionRealWriteFailureRetryAndRestart() throws {
        let store = QuestionStore(root: root, secrets: secrets)
        var record = question(); XCTAssertTrue(store.save(record))
        let path = root.appendingPathComponent("reading-questions.json"), backup = root.appendingPathComponent("saved.json")
        try FileManager.default.moveItem(at: path, to: backup)
        try FileManager.default.createDirectory(at: path, withIntermediateDirectories: false)
        record.state = .complete; record.answer = "Complete answer"; record.evidence = [record.selection]; record.citations = [record.selection]
        XCTAssertFalse(store.save(record)); XCTAssertTrue(store.unsaved(record.id))
        XCTAssertEqual(try JSONDecoder().decode([ReadingQuestion].self, from: Data(contentsOf: backup)).first?.state, .draft)
        try FileManager.default.removeItem(at: path); try FileManager.default.moveItem(at: backup, to: path)
        store.retrySave(record.id); store.retrySave(record.id)
        let restored = QuestionStore(root: root, secrets: secrets)
        XCTAssertEqual(restored.records.count, 1); XCTAssertEqual(restored.record(record.id)?.answer, "Complete answer")
        XCTAssertEqual(restored.record(record.id)?.citations, [record.selection]); XCTAssertEqual(restored.record(record.id)?.state, .complete)
        XCTAssertFalse(store.unsaved(record.id))
    }
    func testDraftRecoveryInterruptedStateAndCorruptReadProtection() throws {
        let store = QuestionStore(root: root, secrets: secrets); var record = question()
        XCTAssertTrue(store.save(record)); store.edit(record.id, text: "Saved draft")
        XCTAssertEqual(QuestionStore(root: root, secrets: secrets).record(record.id)?.question, "Saved draft")
        record.state = .generating; record.answer = "Already saved portion"; XCTAssertTrue(store.save(record))
        let restored = QuestionStore(root: root, secrets: secrets).record(record.id)
        XCTAssertEqual(restored?.state, .incomplete); XCTAssertEqual(restored?.answer, record.answer)
        let path = root.appendingPathComponent("reading-questions.json")
        try Data("corrupt".utf8).write(to: path)
        let failed = QuestionStore(root: root, secrets: secrets); XCTAssertTrue(failed.loadFailed); XCTAssertFalse(failed.save(question()))
        XCTAssertEqual(try String(contentsOf: path, encoding: .utf8), "corrupt")
    }
    func testCitationIdentityExactQuoteAndMalformedAnswer() throws {
        var evidence = question().selection; evidence.id = "E1"
        let reply: [String: Any] = ["answer":"Explanation", "citations":[["id":"E1","quote":evidence.quote], ["id":"E99","quote":evidence.quote], ["id":"E1","quote":"forged"]]]
        let text = String(data: try JSONSerialization.data(withJSONObject: reply), encoding: .utf8)!
        let result = QuestionPlan.validate(text, evidence: [evidence])
        XCTAssertEqual(result.citations, [evidence]); XCTAssertFalse(result.warning.isEmpty)
        XCTAssertTrue(QuestionPlan.validate("plain answer https://invented", evidence: [evidence]).citations.isEmpty)
    }
    func testBudgetRefusesOversizedSelectionAndLocalScope() async throws {
        let index = BookIndex(url: root.appendingPathComponent("unused.sqlite"))
        let plan = try await QuestionPlan.make(question(), index: index, local: true, state: BookPreparationState())
        XCTAssertEqual(plan.evidence.count, 1); XCTAssertTrue(plan.notice.contains("主动选择局部"))
        do { _ = try await QuestionPlan.make(question(String(repeating: "大", count: 9000)), index: index, local: true, state: BookPreparationState()); XCTFail("Expected capacity refusal") }
        catch { XCTAssertEqual(error as? QuestionError, .budget) }
    }
    func testBothRealHTTPFormatsCancelImmediateRetryAndLateResponse() async throws {
        let library = try LibraryStore(root: root), store = QuestionStore(root: root, secrets: secrets)
        let configurations = try AIConfigurationStore(root: root, secrets: secrets)
        defer { for value in configurations.configurations { try? configurations.remove(value.id) } }
        for format in AIFormat.allCases {
            var configuration = AIConfiguration(name: "Fixture", format: format, address: "http://127.0.0.1:18769/v1", model: "late")
            try configurations.save(configuration, newKey: "not-a-real-credential"); try configurations.select(configuration.id)
            let record = question(); store.save(record)
            store.send(record.id, library: library, local: true)
            try await Task.sleep(nanoseconds: 300_000_000)
            store.cancel(record.id)
            XCTAssertEqual(store.record(record.id)?.state, .incomplete)
            configuration.model = "slow"; try configurations.save(configuration, newKey: "")
            store.send(record.id, library: library, local: true)
            // Give the cancelled generation time to exit and attempt its cleanup.
            try await Task.sleep(nanoseconds: 500_000_000)
            store.send(record.id, library: library, local: true) // Must not issue a third HTTP request.
            XCTAssertEqual(store.record(record.id)?.state, .generating)
            store.cancel(record.id)
            XCTAssertEqual(store.record(record.id)?.state, .incomplete)
            configuration.model = "test-model"; try configurations.save(configuration, newKey: "")
            store.send(record.id, library: library, local: true)
            for _ in 0..<100 where store.record(record.id)?.state != .complete { try await Task.sleep(nanoseconds: 100_000_000) }
            XCTAssertEqual(store.record(record.id)?.state, .complete)
            XCTAssertEqual(store.record(record.id)?.citations.first?.locatorJSON, record.selection.locatorJSON)
            try await Task.sleep(nanoseconds: 3_500_000_000)
            XCTAssertEqual(store.record(record.id)?.state, .complete)
            XCTAssertEqual(store.record(record.id)?.model, "test-model")
            XCTAssertEqual(QuestionStore(root: root, secrets: secrets).record(record.id)?.state, .complete)
        }
    }
}

import WebKit

extension QuestionTests {
    func testWebKitVisibleRunsAcrossParagraphsActualHTTPMaterialsAndLocators() async throws {
        let web = WKWebView(frame: CGRect(x: 0, y: 0, width: 390, height: 700))
        web.loadHTMLString("<html><head><title>HEAD-SECRET</title><style>/* STYLE-SECRET */</style></head><body><p>visible<span><b hidden>HIDDEN-SECRET</b>after</span>end</p><p>second paragraph<script>/* SCRIPT-SECRET */</script><template>TEMPLATE-SECRET</template></p><p style='display:none'>CSS-SECRET</p></body></html>", baseURL: nil)
        for _ in 0..<50 {
            if (try? await web.evaluateJavaScript("document.title")) as? String == "HEAD-SECRET" { break }
            try await Task.sleep(nanoseconds: 50_000_000)
        }
        _ = try await web.evaluateJavaScript("const r = document.createRange();r.selectNodeContents(document.body);getSelection().removeAllRanges();getSelection().addRange(r);")
        let raw = try await web.evaluateJavaScript(ReaderController.questionNeighbors)
        let material = try XCTUnwrap(raw as? [String: Any])
        let parts = try XCTUnwrap(material["selected"] as? [[String: Any]])
        XCTAssertEqual(parts.compactMap { $0["quote"] as? String }, ["visible", "afterend", "second paragraph"])
        var record = question(); var evidence: [QuestionEvidence] = []
        for row in parts {
            let range = try JSONSerialization.data(withJSONObject: row["domRange"]!)
            var location = try record.selection.location()
            location.locations.otherLocations["domRange"] = try JSONValue(jsonString: String(data: range, encoding: .utf8)!, warnings: nil)
            location.locations.cssSelector = row["selector"] as? String
            location.text = .init(after: row["after"] as? String, before: row["before"] as? String, highlight: row["quote"] as? String)
            evidence.append(QuestionEvidence(locator: location, context: row["quote"] as? String))
            // Resolve saved node offsets back into WebKit's real DOM, including after a hidden descendant.
            let verify = """
            (() => { const p = \(String(data: range, encoding: .utf8)!); function node(p) { return document.querySelector(p.cssSelector).childNodes[p.textNodeIndex]; } const r = document.createRange(); r.setStart(node(p.start), p.start.charOffset); r.setEnd(node(p.end), p.end.charOffset); return r.toString(); })()
            """
            let actual = try await web.evaluateJavaScript(verify) as? String
            XCTAssertEqual(actual, row["quote"] as? String)
        }
        record.selectionParts = evidence
        let plan = try await QuestionPlan.make(record, index: BookIndex(url: root.appendingPathComponent("unused.sqlite")), local: true, state: BookPreparationState())
        XCTAssertFalse(plan.prompt.contains("SECRET"))
        let configuration = AIConfiguration(name: "Visible fixture", format: .openAI, address: "http://127.0.0.1:18769/v1", model: "visible-runs")
        let reply = try await AIConnection().text(configuration, key: "not-a-real-credential", prompt: plan.prompt, maxTokens: 1600, timeout: 20)
        XCTAssertEqual(QuestionPlan.validate(reply, evidence: plan.evidence).citations.count, 2)
    }
}

extension QuestionTests {
    func testProviderTruncationNeverCommitsCompleteAnswer() async throws {
        let library = try LibraryStore(root: root), configurations = try AIConfigurationStore(root: root, secrets: secrets)
        let store = QuestionStore(root: root, secrets: secrets)
        defer { for value in configurations.configurations { try? configurations.remove(value.id) } }
        for format in AIFormat.allCases {
            let configuration = AIConfiguration(name: "Truncation fixture", format: format, address: "http://127.0.0.1:18769/v1", model: "truncated")
            try configurations.save(configuration, newKey: "not-a-real-credential"); try configurations.select(configuration.id)
            let record = question(); store.save(record); store.send(record.id, library: library, local: true)
            for _ in 0..<100 where store.record(record.id)?.state != .incomplete { try await Task.sleep(nanoseconds: 50_000_000) }
            let saved = QuestionStore(root: root, secrets: secrets).record(record.id)
            XCTAssertEqual(saved?.state, .incomplete); XCTAssertTrue(saved?.answer.isEmpty == true)
            XCTAssertTrue(saved?.failure?.contains("截断") == true)
        }
    }
}
