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
    func testFreeQuestionDistinctIdentityOriginAndAtomicRetry() throws {
        let book = Book(id: "book-only", title: "Book", author: "Author")
        let origin = try question().selection.location()
        var first = ReadingQuestion(book: book, origin: origin)
        let second = ReadingQuestion(book: book, origin: origin)
        XCTAssertNotEqual(first.id, second.id)
        XCTAssertEqual(first.bookID, book.id); XCTAssertTrue(first.selection.quote.isEmpty)
        XCTAssertEqual(first.selectionParts, []); XCTAssertEqual(try first.origin(), origin)
        let store = QuestionStore(root: root, secrets: secrets)
        XCTAssertTrue(store.save(first))
        let file = root.appendingPathComponent("reading-questions.json"), backup = root.appendingPathComponent("before.json")
        try FileManager.default.moveItem(at: file, to: backup)
        try FileManager.default.createDirectory(at: file, withIntermediateDirectories: false)
        first.answer = "Saved reply"; first.state = .complete; first.citations = [question().selection]
        XCTAssertFalse(store.save(first)); XCTAssertTrue(store.unsaved(first.id))
        try FileManager.default.removeItem(at: file); try FileManager.default.moveItem(at: backup, to: file)
        store.retrySave(first.id); store.retrySave(first.id)
        let restored = QuestionStore(root: root, secrets: secrets)
        XCTAssertEqual(restored.records.count, 1)
        XCTAssertEqual(restored.record(first.id)?.state, .complete)
        XCTAssertEqual(try restored.record(first.id)?.origin(), origin)
        XCTAssertEqual(restored.record(first.id)?.citations, first.citations)
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
    private func issue12Attachment(_ name: String, store: QuestionStore) throws {
        let attachment = XCTAttachment(data: try JSONEncoder().encode(store.records), uniformTypeIdentifier: "public.json")
        attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
    }
    private func issue13Requests() async throws -> [[String: Any]] {
        let (data, _) = try await URLSession.shared.data(from: URL(string: "http://127.0.0.1:18773/requests")!)
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [[String: Any]])
    }
    func testIssue13ReadPersistenceFailureRetryAndDisjointBooks() async throws {
        let (library, book) = try await issue12Book()
        let otherFile = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "original-fixture", withExtension: "epub", subdirectory: "Fixtures"))
        let other = try await library.importBook(from: otherFile).book
        await library.preparation.waitForCurrentWork()
        XCTAssertEqual(library.readScope(for: book.id).chapters, [])
        let location = Locator(href: AnyURL(string: "OEBPS/ch2.xhtml")!, mediaType: .xhtml)
        try library.saveLocation(location, for: book.id)
        XCTAssertEqual(library.readScope(for: book.id).chapters, [], "A far position does not mark earlier chapters read")
        try library.setChapterRead(2, read: true, for: book.id)
        try library.setChapterRead(0, read: true, for: book.id)
        try library.setChapterRead(2, read: true, for: book.id)
        XCTAssertEqual(library.readScope(for: book.id).chapters, [0, 2])
        XCTAssertEqual(library.readScope(for: other.id).chapters, [])
        let path = root.appendingPathComponent("library.json"), backup = root.appendingPathComponent("catalog-before-fault.json")
        try FileManager.default.moveItem(at: path, to: backup)
        try FileManager.default.createDirectory(at: path, withIntermediateDirectories: false)
        XCTAssertThrowsError(try library.setChapterRead(1, read: true, for: book.id))
        XCTAssertEqual(library.readScope(for: book.id).chapters, [0, 2])
        let committed = try JSONDecoder().decode([Book].self, from: Data(contentsOf: backup))
        XCTAssertEqual(committed.first { $0.id == book.id }?.readChapters, [0, 2])
        try FileManager.default.removeItem(at: path); try FileManager.default.moveItem(at: backup, to: path)
        try library.setChapterRead(1, read: true, for: book.id)
        try library.setChapterRead(0, read: false, for: book.id)
        let restored = try LibraryStore(root: root)
        XCTAssertEqual(restored.readScope(for: book.id).chapters, [1, 2])
        XCTAssertEqual(restored.readScope(for: other.id).chapters, [])
        let store = QuestionStore(root: root, secrets: secrets)
        let draft = ReadingQuestion(book: book, origin: location); store.save(draft)
        store.setOnlyRead(draft.id, value: true)
        XCTAssertTrue(QuestionStore(root: root, secrets: secrets).record(draft.id)?.onlyRead == true)
        let attachment = XCTAttachment(data: try Data(contentsOf: path), uniformTypeIdentifier: "public.json")
        attachment.name = "issue13-persisted-read-chapters"; attachment.lifetime = .keepAlways; add(attachment)
    }
    func testIssue13RealHTTPAllPathsAndHistoryRefusal() async throws {
        let (library, book) = try await issue12Book()
        let otherFile = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "semantic-other", withExtension: "epub", subdirectory: "Fixtures"))
        let other = try await library.importBook(from: otherFile).book
        await library.preparation.waitForCurrentWork()
        try library.setChapterRead(0, read: true, for: other.id)
        let db = try IndexDatabase(url: root.appendingPathComponent("book-index.sqlite"))
        func source(_ phrase: String) throws -> QuestionEvidence {
            let row = try XCTUnwrap(db.rows("SELECT locator FROM fragments WHERE book_id=? AND original LIKE ?", [book.id, "%" + phrase + "%"]).first)
            return QuestionEvidence(locator: try XCTUnwrap(Locator(json: JSONValue(jsonString: row[0], warnings: nil), warnings: nil)))
        }
        let selectedSource = try source("初版规则规定所有停机指令")
        let unread = try source("第七日发生电池漏液")
        let settings = try AIConfigurationStore(root: root, secrets: secrets)
        defer { for value in settings.configurations { try? settings.remove(value.id) } }
        let store = QuestionStore(root: root, secrets: secrets)
        var full = ReadingQuestion(book: book, selection: selectedSource, neighbors: [])
        full.question = "I13-FULL 初版规则为什么改变？"
        var configuration = AIConfiguration(name: "I13", format: .openAI, address: "http://127.0.0.1:18773/v1", model: "issue13")
        try settings.save(configuration, newKey: "not-a-real-credential"); store.save(full)
        store.send(full.id, library: library, local: false); try await issue12Wait(store, id: full.id)
        XCTAssertEqual(store.record(full.id)?.state, .complete)
        XCTAssertTrue(store.record(full.id)?.evidence.contains { $0.quote.contains("第七日发生电池漏液") } == true)
        XCTAssertTrue(store.record(full.id)?.answer.contains("第七日发生电池漏液") == true)
        try library.setChapterRead(0, read: true, for: book.id)
        try library.setChapterRead(2, read: true, for: book.id)
        let restricted = library.readScope(for: book.id)
        let before = try await issue13Requests().count
        let follow = try XCTUnwrap(store.followUp(full.id)); store.edit(follow, text: "I13-ZERO-HISTORY 为什么改口？")
        store.setOnlyRead(follow, value: true)
        var count = before
        for format in AIFormat.allCases {
            configuration.format = format; try settings.save(configuration, newKey: "")
            store.send(follow, library: library, local: false); try await issue12Wait(store, id: follow)
            XCTAssertEqual(store.record(follow)?.state, .incomplete); XCTAssertNotNil(store.record(follow)?.failure)
            count = try await issue13Requests().count; XCTAssertEqual(count, before)
        }
        // Legacy answers with unknown provenance must also stay offline, even if their citations look safe.
        var legacy = try XCTUnwrap(store.record(full.id)); legacy.evidenceScope = nil; legacy.citations = [selectedSource]
        store.save(legacy); store.edit(follow, text: "I13-ZERO-LEGACY 为什么改口？")
        store.send(follow, library: library, local: false); try await issue12Wait(store, id: follow)
        XCTAssertEqual(store.record(follow)?.state, .incomplete)
        count = try await issue13Requests().count; XCTAssertEqual(count, before)
        for (name, selection, chapters) in [("I13-ZERO-SELECTION", unread, [0, 2]), ("I13-ZERO-EMPTY", selectedSource, [])] {
            var bad = ReadingQuestion(book: book, selection: selection, neighbors: [])
            bad.question = name; bad.onlyRead = true; store.save(bad)
            store.send(bad.id, library: library, local: false, scope: BookEvidenceScope(bookID: book.id, chapters: chapters))
            try await issue12Wait(store, id: bad.id)
            XCTAssertEqual(store.record(bad.id)?.state, .incomplete)
            count = try await issue13Requests().count; XCTAssertEqual(count, before)
        }
        for format in AIFormat.allCases {
            configuration.format = format; try settings.save(configuration, newKey: "")
            var selected = ReadingQuestion(book: book, selection: selectedSource, neighbors: [unread])
            selected.question = "I13-SELECTED-" + format.rawValue + " 余辉延迟是什么？"; selected.onlyRead = true
            store.save(selected); store.send(selected.id, library: library, local: false); try await issue12Wait(store, id: selected.id)
            let saved = try XCTUnwrap(store.record(selected.id))
            XCTAssertEqual(saved.state, .complete, saved.failure ?? "")
            XCTAssertTrue(saved.notice.contains("可能缺少后文解释"))
            let permitted = try await library.preparation.index.permits(saved.evidence, scope: restricted)
            XCTAssertTrue(permitted); XCTAssertFalse(saved.evidence.contains { $0.quote == unread.quote })
            let next = try XCTUnwrap(store.followUp(selected.id)); store.edit(next, text: "I13-FOLLOW-" + format.rawValue + " 那为什么这样？")
            XCTAssertTrue(store.record(next)?.onlyRead == true)
            store.send(next, library: library, local: false); try await issue12Wait(store, id: next)
            XCTAssertEqual(store.record(next)?.state, .complete, store.record(next)?.failure ?? "")
            var whole = ReadingQuestion(book: book, origin: try selectedSource.location())
            whole.question = "I13-WHOLE-" + format.rawValue + " 全书停机规则有哪些联系？"; whole.onlyRead = true
            store.save(whole); store.send(whole.id, library: library, local: false); try await issue12Wait(store, id: whole.id)
            XCTAssertEqual(store.record(whole.id)?.state, .complete, store.record(whole.id)?.failure ?? "")
            let wholePermitted = try await library.preparation.index.permits(try XCTUnwrap(store.record(whole.id)).evidence, scope: restricted)
            XCTAssertTrue(wholePermitted)
        }
        var local = ReadingQuestion(book: book, selection: selectedSource, neighbors: [unread])
        local.question = "I13-LOCAL selected"; local.onlyRead = true; store.save(local)
        store.send(local.id, library: library, local: true); try await issue12Wait(store, id: local.id)
        XCTAssertEqual(store.record(local.id)?.state, .complete)
        var freeLocal = ReadingQuestion(book: book, origin: try selectedSource.location())
        freeLocal.question = "I13-LOCAL-FREE 余辉"; freeLocal.onlyRead = true; store.save(freeLocal)
        store.send(freeLocal.id, library: library, local: true); try await issue12Wait(store, id: freeLocal.id)
        XCTAssertEqual(store.record(freeLocal.id)?.state, .complete)
        let rows = try await issue13Requests()
        XCTAssertGreaterThan(rows.filter { ($0["prompt"] as? String ?? "").contains("I13-") }.count, 8)
        for row in rows where (row["prompt"] as? String ?? "").contains("I13-") && !(row["prompt"] as? String ?? "").contains("I13-FULL") {
            let prompt = row["prompt"] as? String ?? ""
            for phrase in ["第七日发生电池漏液", "事故后作者修订", "作者坚持保留原始记录", "杂记第1项", "余辉延迟仅有三分钟", "I13-ZERO"] { XCTAssertFalse(prompt.contains(phrase), phrase) }
            if let material = row["material"] as? [String: Any] { XCTAssertEqual(material["bookID"] as? String, book.id) }
        }
        XCTAssertEqual(QuestionStore(root: root, secrets: secrets).record(full.id)?.answer, store.record(full.id)?.answer, "Full-book history remains offline")
        try issue12Attachment("issue13-persisted-requests", store: store)
        let attachment = XCTAttachment(data: try JSONSerialization.data(withJSONObject: rows, options: [.prettyPrinted, .sortedKeys]), uniformTypeIdentifier: "public.json")
        attachment.name = "issue13-real-http"; attachment.lifetime = .keepAlways; add(attachment)
    }
    private func issue12Book() async throws -> (LibraryStore, Book) {
        let library = try LibraryStore(root: root)
        let file = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "semantic-fixture", withExtension: "epub", subdirectory: "Fixtures"))
        let book = try await library.importBook(from: file).book
        for _ in 0..<2400 {
            if library.preparation.states[book.id]?.ready == true { await library.preparation.waitForCurrentWork(); return (library, book) }
            if let failure = library.preparation.states[book.id]?.failure { throw NSError(domain: failure, code: 1) }
            try await Task.sleep(nanoseconds: 50_000_000)
        }
        throw QuestionError.preparation
    }
    private func issue12Wait(_ store: QuestionStore, id: UUID) async throws {
        for _ in 0..<600 {
            if let state = store.record(id)?.state, state == .complete || state == .incomplete { return }
            try await Task.sleep(nanoseconds: 50_000_000)
        }
        XCTFail("Request did not finish")
    }
    func testIssue12ConversationRenameDeleteDraftAndRealWriteFailures() throws {
        let store = QuestionStore(root: root, secrets: secrets)
        var first = question(); first.state = .complete; first.answer = "Original answer"; first.citations = [first.selection]
        XCTAssertTrue(store.save(first))
        let second = question(); XCTAssertTrue(store.save(second))
        let follow = try XCTUnwrap(store.followUp(first.id)); store.edit(follow, text: "Saved follow-up draft")
        XCTAssertNil(store.followUp(first.id)); XCTAssertEqual(store.conversations.count, 2)
        XCTAssertEqual(QuestionStore(root: root, secrets: secrets).record(follow)?.question, "Saved follow-up draft")
        let path = root.appendingPathComponent("reading-questions.json"), backup = root.appendingPathComponent("issue12-before.json")
        try FileManager.default.moveItem(at: path, to: backup)
        try FileManager.default.createDirectory(at: path, withIntermediateDirectories: false)
        XCTAssertFalse(store.rename(first.id, title: "Renamed")); XCTAssertFalse(store.delete(first.id))
        XCTAssertEqual(store.conversation(first.id)?.title, first.question); XCTAssertEqual(store.records.count, 3)
        try issue12Attachment("issue12-failed-management", store: store)
        try FileManager.default.removeItem(at: path); try FileManager.default.moveItem(at: backup, to: path)
        XCTAssertTrue(store.rename(first.id, title: "Renamed"))
        let restored = QuestionStore(root: root, secrets: secrets)
        XCTAssertEqual(restored.conversation(first.id)?.title, "Renamed"); XCTAssertEqual(restored.record(first.id)?.question, first.question)
        XCTAssertTrue(restored.delete(first.id))
        let deleted = QuestionStore(root: root, secrets: secrets)
        XCTAssertEqual(deleted.records.map(\.id), [second.id]); try issue12Attachment("issue12-deleted-restarted", store: deleted)
    }
    func testIssue12DeleteDuringGenerationDoesNotResurrect() async throws {
        let (library, book) = try await issue12Book()
        let configurations = try AIConfigurationStore(root: root, secrets: secrets)
        let configuration = AIConfiguration(name: "Issue12 slow", format: .openAI, address: "http://127.0.0.1:18772/v1", model: "slow")
        try configurations.save(configuration, newKey: "not-a-real-credential"); try configurations.select(configuration.id)
        let store = QuestionStore(root: root, secrets: secrets)
        var record = ReadingQuestion(book: book, origin: try question().origin()); record.question = "生成中删除"
        record.state = .complete; record.answer = "先前已保存回答"
        XCTAssertTrue(store.save(record))
        let follow = try XCTUnwrap(store.followUp(record.id)); store.edit(follow, text: "生成中删除追问")
        store.send(follow, library: library, local: false)
        for _ in 0..<200 where store.record(follow)?.state != .generating { try await Task.sleep(nanoseconds: 50_000_000) }
        XCTAssertEqual(store.record(follow)?.state, .generating)
        try await Task.sleep(nanoseconds: 200_000_000)
        XCTAssertTrue(store.delete(record.id)); XCTAssertNil(store.record(record.id))
        try await Task.sleep(nanoseconds: 3_000_000_000)
        XCTAssertNil(store.record(follow)); try issue12Attachment("issue12-deleted-generation-no-resurrection", store: store)
        XCTAssertNil(QuestionStore(root: root, secrets: secrets).record(record.id))
        XCTAssertEqual(try JSONDecoder().decode([ReadingQuestion].self, from: Data(contentsOf: root.appendingPathComponent("reading-questions.json"))).count, 0)
    }
    func testIssue12FollowupHTTPCompletionWriteFailureRetry() async throws {
        let (library, book) = try await issue12Book()
        let configurations = try AIConfigurationStore(root: root, secrets: secrets)
        let configuration = AIConfiguration(name: "Issue12 slow save", format: .anthropic, address: "http://127.0.0.1:18772/v1", model: "slow")
        try configurations.save(configuration, newKey: "not-a-real-credential"); try configurations.select(configuration.id)
        let store = QuestionStore(root: root, secrets: secrets)
        var first = ReadingQuestion(book: book, origin: try question().origin())
        first.question = "已保存首问"; first.state = .complete; first.answer = "已有回答"
        XCTAssertTrue(store.save(first))
        let follow = try XCTUnwrap(store.followUp(first.id)); store.edit(follow, text: "HTTP返回时保存失败")
        store.send(follow, library: library, local: false)
        for _ in 0..<200 where store.record(follow)?.state != .generating { try await Task.sleep(nanoseconds: 50_000_000) }
        XCTAssertEqual(store.record(follow)?.state, .generating)
        try await Task.sleep(nanoseconds: 200_000_000)
        let path = root.appendingPathComponent("reading-questions.json"), backup = root.appendingPathComponent("issue12-generating.json")
        try FileManager.default.moveItem(at: path, to: backup)
        try FileManager.default.createDirectory(at: path, withIntermediateDirectories: false)
        try await issue12Wait(store, id: follow)
        XCTAssertEqual(store.record(follow)?.state, .complete); XCTAssertTrue(store.unsaved(follow))
        XCTAssertFalse(store.record(follow)?.answer.isEmpty ?? true)
        let before = try JSONDecoder().decode([ReadingQuestion].self, from: Data(contentsOf: backup))
        XCTAssertEqual(before.first { $0.id == follow }?.state, .generating)
        try issue12Attachment("issue12-http-answer-unsaved", store: store)
        try FileManager.default.removeItem(at: path); try FileManager.default.moveItem(at: backup, to: path)
        store.retrySave(follow); store.retrySave(follow)
        let restarted = QuestionStore(root: root, secrets: secrets)
        XCTAssertFalse(store.unsaved(follow)); XCTAssertEqual(restarted.records.count, 2)
        XCTAssertEqual(restarted.record(follow)?.state, .complete)
        XCTAssertEqual(restarted.record(follow)?.conversation, first.id)
        XCTAssertEqual(restarted.record(follow)?.answer, store.record(follow)?.answer)
        XCTAssertEqual(restarted.record(follow)?.citations, store.record(follow)?.citations)
        try issue12Attachment("issue12-http-answer-retried-restarted", store: restarted)
    }
    func testIssue12FreshEvidenceSwitchServiceAndScopeZeroHTTP() async throws {
        let (library, book) = try await issue12Book()
        let db = try IndexDatabase(url: root.appendingPathComponent("book-index.sqlite"))
        let row = try XCTUnwrap(db.rows("SELECT locator FROM fragments WHERE book_id=? AND original LIKE ?", [book.id, "%初版规则规定所有停机指令%"]).first)
        let location = try XCTUnwrap(Locator(json: JSONValue(jsonString: row[0], warnings: nil), warnings: nil))
        let configurations = try AIConfigurationStore(root: root, secrets: secrets)
        var configuration = AIConfiguration(name: "Issue12 OpenAI", format: .openAI, address: "http://127.0.0.1:18772/v1", model: "issue12")
        try configurations.save(configuration, newKey: "not-a-real-credential")
        let store = QuestionStore(root: root, secrets: secrets)
        var first = ReadingQuestion(book: book, selection: QuestionEvidence(locator: location), neighbors: [])
        first.question = "初版规则要求多久后执行停机，等待是为了什么？"
        XCTAssertTrue(store.save(first)); store.send(first.id, library: library, local: false)
        try await issue12Wait(store, id: first.id); XCTAssertEqual(store.record(first.id)?.state, .complete)
        let firstEvidence = try XCTUnwrap(store.record(first.id)).evidence
        let follow = try XCTUnwrap(store.followUp(first.id)); store.edit(follow, text: "那他为什么改口？")
        configuration = AIConfiguration(name: "Issue12 Anthropic", format: .anthropic, address: "http://127.0.0.1:18772/v1", model: "issue12")
        try configurations.save(configuration, newKey: "not-a-real-credential"); try configurations.select(configuration.id)
        store.send(follow, library: library, local: false); try await issue12Wait(store, id: follow)
        let changed = try XCTUnwrap(store.record(follow))
        XCTAssertEqual(changed.state, .complete); XCTAssertEqual(changed.format, .anthropic)
        XCTAssertEqual(store.record(first.id)?.format, .openAI)
        let quotes = changed.evidence.map(\.quote).joined()
        for required in ["初版规则规定", "第七日发生电池漏液", "事故后作者修订"] { XCTAssertTrue(quotes.contains(required), required) }
        let next = try XCTUnwrap(store.followUp(first.id)); store.edit(next, text: "那切断主供电后，记录器和计时器为什么还在运行？")
        store.send(next, library: library, local: false, scope: BookEvidenceScope(bookID: book.id)); try await issue12Wait(store, id: next)
        let third = try XCTUnwrap(store.record(next))
        XCTAssertEqual(third.state, .complete)
        XCTAssertTrue(third.evidence.contains { $0.quote.contains("独立的备用电池") })
        XCTAssertTrue(third.evidence.contains { $0.quote.contains("危险时应切断主供电") })
        XCTAssertFalse(Set(third.evidence.map(\.locatorJSON)).subtracting(firstEvidence.map(\.locatorJSON)).isEmpty, "New evidence must enter a follow-up")
        try issue12Attachment("issue12-real-retrieval-three-turns", store: store)
        // Both the selected text and prior full-book answers are disallowed before any resolver HTTP.
        let restricted = try XCTUnwrap(store.followUp(first.id)); store.edit(restricted, text: "SCOPE12-NO-HTTP-SELECTED")
        store.send(restricted, library: library, local: false, scope: BookEvidenceScope(bookID: book.id, throughChapter: -1, throughOrdinal: -1))
        try await issue12Wait(store, id: restricted)
        XCTAssertEqual(store.record(restricted)?.state, .incomplete)
        XCTAssertTrue(store.record(restricted)?.failure?.contains("允许的参考范围") == true)
        store.edit(restricted, text: "SCOPE12-NO-HTTP-HISTORY")
        // Selection is allowed here, but previous answers used a wider scope.
        store.send(restricted, library: library, local: false, scope: BookEvidenceScope(bookID: book.id, throughChapter: 0, throughOrdinal: Int.max))
        try await issue12Wait(store, id: restricted)
        XCTAssertEqual(store.record(restricted)?.state, .incomplete)
        XCTAssertNil(store.record(restricted)?.retrievalQueries)
        try issue12Attachment("issue12-scope-refused-before-http", store: store)
        // Isolate the selection check from the historical-answer provenance check.
        var selectedOnly = ReadingQuestion(book: book, selection: QuestionEvidence(locator: location), neighbors: [])
        selectedOnly.question = "First draft"; selectedOnly.state = .complete
        store.save(selectedOnly)
        let outside = try XCTUnwrap(store.followUp(selectedOnly.id)); store.edit(outside, text: "SCOPE12-NO-HTTP-SELECTION-ONLY")
        store.send(outside, library: library, local: false, scope: BookEvidenceScope(bookID: book.id, throughChapter: -1, throughOrdinal: -1))
        try await issue12Wait(store, id: outside)
        XCTAssertEqual(store.record(outside)?.state, .incomplete)
        XCTAssertTrue(store.record(outside)?.failure?.contains("允许的参考范围") == true)
        XCTAssertNil(store.record(outside)?.retrievalQueries)
        var free = ReadingQuestion(book: book, origin: location); free.question = "SCOPE12-NO-HTTP-全书样本"
        store.save(free)
        store.send(free.id, library: library, local: false, scope: BookEvidenceScope(bookID: book.id, throughChapter: -1, throughOrdinal: -1))
        try await issue12Wait(store, id: free.id)
        XCTAssertEqual(store.record(free.id)?.state, .incomplete)
        XCTAssertTrue(store.record(free.id)?.failure?.contains("允许的参考范围") == true)
        try issue12Attachment("issue12-scope-selection-and-sample-zero-http", store: store)
    }
    func testIssue12HistoryBudgetAndProviderCapacity() async throws {
        var record = question()
        record.history = [QuestionHistoryTurn(id: UUID(), question: "long", answer: String(repeating: "大", count: 9000), state: .complete)]
        XCTAssertThrowsError(try QuestionPlan.followUpPrompt(record)) { XCTAssertEqual($0 as? QuestionError, .budget) }
        do { _ = try await QuestionPlan.make(record, index: BookIndex(url: root.appendingPathComponent("unused.sqlite")), local: true, state: BookPreparationState()); XCTFail("History cannot be silently clipped") }
        catch { XCTAssertEqual(error as? QuestionError, .budget) }
        let library = try LibraryStore(root: root), configurations = try AIConfigurationStore(root: root, secrets: secrets)
        let configuration = AIConfiguration(name: "Capacity", format: .anthropic, address: "http://127.0.0.1:18772/v1", model: "capacity")
        try configurations.save(configuration, newKey: "not-a-real-credential")
        let store = QuestionStore(root: root, secrets: secrets), submitted = question()
        store.save(submitted); store.send(submitted.id, library: library, local: true); try await issue12Wait(store, id: submitted.id)
        XCTAssertEqual(store.record(submitted.id)?.state, .incomplete)
        XCTAssertTrue(store.record(submitted.id)?.failure?.contains("容量") == true)
        try issue12Attachment("issue12-provider-capacity", store: store)
    }
}

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

extension QuestionTests {
    private struct BackgroundTestSecrets: AISecrets {
        func read(_ id: String) throws -> String { "not-a-real-credential" }
        func write(_ value: String, id: String) throws {}
        func remove(_ id: String) throws {}
        func accounts() throws -> [String] { [] }
    }
    // Explicit fault injection tests the expiry branch, not actual OS expiration.
    func testBackgroundInterruptionImmediateRetryAndLateResult() async throws {
        let secrets = BackgroundTestSecrets(), library = try LibraryStore(root: root)
        let configurations = try AIConfigurationStore(root: root, secrets: secrets)
        var configuration = AIConfiguration(name: "BG14", format: .openAI, address: "http://127.0.0.1:18774/v1", model: "bg-4")
        try configurations.save(configuration, newKey: "not-a-real-credential")
        let store = QuestionStore(root: root, secrets: secrets), record = question()
        XCTAssertTrue(store.save(record)); store.send(record.id, library: library, local: true)
        try await Task.sleep(nanoseconds: 300_000_000)
        store.interruptAll(reason: "Injected expiry branch")
        XCTAssertEqual(store.record(record.id)?.state, .incomplete)
        XCTAssertEqual(store.record(record.id)?.answer, "")
        XCTAssertEqual(QuestionStore(root: root, secrets: secrets).record(record.id)?.question, record.question)
        configuration.model = "bg-1"; try configurations.save(configuration, newKey: "")
        store.send(record.id, library: library, local: true)
        store.send(record.id, library: library, local: true)
        try await Task.sleep(nanoseconds: 5_000_000_000)
        let restored = QuestionStore(root: root, secrets: secrets)
        XCTAssertEqual(restored.records.count, 1)
        XCTAssertEqual(restored.record(record.id)?.state, .complete)
        XCTAssertEqual(restored.record(record.id)?.answer, "BG14-OpenAI-1")
        XCTAssertEqual(restored.record(record.id)?.citations.first?.locatorJSON, record.selection.locatorJSON)
    }
    func testBackgroundResponseRealSaveFailureRetryWithoutRequest() async throws {
        let secrets = BackgroundTestSecrets(), library = try LibraryStore(root: root)
        let configuration = AIConfiguration(name: "BG14", format: .anthropic, address: "http://127.0.0.1:18774/v1", model: "bg-2")
        try AIConfigurationStore(root: root, secrets: secrets).save(configuration, newKey: "not-a-real-credential")
        let store = QuestionStore(root: root, secrets: secrets), record = question()
        XCTAssertTrue(store.save(record)); store.send(record.id, library: library, local: true)
        try await Task.sleep(nanoseconds: 300_000_000)
        let file = root.appendingPathComponent("reading-questions.json"), backup = root.appendingPathComponent("before-fault.json")
        try FileManager.default.moveItem(at: file, to: backup)
        try FileManager.default.createDirectory(at: file, withIntermediateDirectories: false)
        try await Task.sleep(nanoseconds: 3_000_000_000)
        XCTAssertTrue(store.unsaved(record.id))
        XCTAssertEqual(store.record(record.id)?.answer, "BG14-Anthropic-2")
        XCTAssertEqual(try JSONDecoder().decode([ReadingQuestion].self, from: Data(contentsOf: backup)).first?.state, .generating)
        try FileManager.default.removeItem(at: file); try FileManager.default.moveItem(at: backup, to: file)
        store.retrySave(record.id); store.retrySave(record.id)
        let restored = QuestionStore(root: root, secrets: secrets)
        XCTAssertEqual(restored.records.count, 1); XCTAssertEqual(restored.record(record.id)?.state, .complete)
        XCTAssertEqual(restored.record(record.id)?.citations.first?.locatorJSON, record.selection.locatorJSON)
        XCTAssertFalse(store.unsaved(record.id))
    }
    func testBackgroundNetworkInterruptionRetainsSubmittedQuestion() async throws {
        let secrets = BackgroundTestSecrets(), library = try LibraryStore(root: root)
        let configuration = AIConfiguration(name: "BG14", format: .openAI, address: "http://127.0.0.1:18774/v1", model: "disconnect")
        try AIConfigurationStore(root: root, secrets: secrets).save(configuration, newKey: "not-a-real-credential")
        let store = QuestionStore(root: root, secrets: secrets), record = question()
        XCTAssertTrue(store.save(record)); store.send(record.id, library: library, local: true)
        try await Task.sleep(nanoseconds: 4_000_000_000)
        let restored = QuestionStore(root: root, secrets: secrets).record(record.id)
        XCTAssertEqual(restored?.state, .incomplete); XCTAssertEqual(restored?.question, record.question)
        XCTAssertEqual(restored?.answer, ""); XCTAssertTrue(restored?.citations.isEmpty == true)
    }
}
