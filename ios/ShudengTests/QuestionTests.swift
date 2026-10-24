import XCTest
import ReadiumShared
import ReadiumNavigator
import UIKit
@testable import Shudeng

/// Exercise the visible UIKit surface; the library is a disposable test library.
@MainActor
final class QuestionPresentationTests: XCTestCase {
    private var root: URL!
    override func setUp() async throws {
        root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    }
    override func tearDown() async throws { try? FileManager.default.removeItem(at: root) }

    func testSavedTurnSeparatesQuestionFromAIAndKeepsFollowUpDraft() async throws {
        let library = try LibraryStore(root: root)
        let fixture = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "original-fixture", withExtension: "epub", subdirectory: "Fixtures"))
        let book = try await library.importBook(from: fixture).book
        await library.preparation.stop(bookID: book.id)
        let location = Locator(href: AnyURL(string: "chapter.xhtml")!, mediaType: .xhtml,
                               title: "第一章", text: .init(highlight: "可核查的原文"))
        var record = ReadingQuestion(book: book, selection: QuestionEvidence(locator: location), neighbors: [])
        record.question = "这句话是什么意思？"; record.answer = "这里是书灯的解释。"; record.state = .complete
        XCTAssertTrue(library.questions.save(record), "测试必须先经真实保存边界创建记录")
        let page = QuestionController(library: library, id: record.id)
        page.loadViewIfNeeded()
        let visible = descendants(page.view)
        let question = try XCTUnwrap(visible.first { $0.accessibilityIdentifier == "question-user-\(record.id)" } as? UILabel)
        XCTAssertEqual(question.text, "这句话是什么意思？")
        XCTAssertTrue(visible.contains { ($0 as? UILabel)?.text == "书灯 · AI" })
        XCTAssertFalse(visible.contains { ($0 as? UILabel)?.text == "你" })
        XCTAssertEqual((visible.first { $0.accessibilityIdentifier == "question-answer" } as? UITextView)?.text,
                       "这里是书灯的解释。")
        XCTAssertTrue((visible.first { $0.accessibilityIdentifier == "question-input" } as? UITextView)?.text.isEmpty == true,
                      "已发送的问题不能再次占用追问输入框")
    }
    private func descendants(_ view: UIView) -> [UIView] {
        [view] + view.subviews.flatMap(descendants)
    }

    func testCitationRoundtripPreservesFollowUpDraftAttachmentAndScroll() async throws {
        let library = try LibraryStore(root: root)
        let fixture = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "original-fixture", withExtension: "epub", subdirectory: "Fixtures"))
        let book = try await library.importBook(from: fixture).book
        await library.preparation.stop(bookID: book.id)
        var locator = Locator(href: AnyURL(string: "OEBPS/ch1.xhtml")!, mediaType: .xhtml, title: "第一章",
                              text: .init(highlight: "C1-P01"))
        locator.locations.cssSelector = "#c1-p1"
        let evidence = QuestionEvidence(id: "E1", locator: locator)
        var turn = ReadingQuestion(book: book, selection: evidence, neighbors: [])
        turn.question = "原文为何要保留上下文？"; turn.answer = String(repeating: "阅读需要核查原文，而不是只看解释。", count: 18)
        turn.state = .complete; turn.citations = [evidence]
        XCTAssertTrue(library.questions.save(turn))
        let draft = try XCTUnwrap(library.questions.followUp(turn.conversation))
        library.questions.edit(draft, text: "还没发送的追问")
        let page = QuestionController(library: library, id: draft)
        let navigation = UINavigationController(rootViewController: page)
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 375, height: 667))
        window.rootViewController = navigation; window.makeKeyAndVisible()
        defer { window.isHidden = true; window.rootViewController = nil }
        page.loadViewIfNeeded(); window.layoutIfNeeded()
        let attachment = try XCTUnwrap(descendants(page.view).first { $0.accessibilityIdentifier == "question-attachment-\(turn.id)" } as? UIButton)
        attachment.sendActions(for: .touchUpInside)
        let scroll = try XCTUnwrap(descendants(page.view).first { $0.accessibilityIdentifier == "question-scroll" } as? UIScrollView)
        window.layoutIfNeeded(); scroll.setContentOffset(CGPoint(x: 0, y: 100), animated: false)
        let offset = scroll.contentOffset
        let source = try XCTUnwrap(descendants(page.view).first { $0.accessibilityIdentifier == "question-reference-\(turn.id)-0" } as? UIButton)
        source.sendActions(for: .touchUpInside)
        for _ in 0..<100 where page.presentedViewController == nil { try await Task.sleep(nanoseconds: 100_000_000) }
        let reader = try XCTUnwrap(page.presentedViewController as? ReaderController)
        reader.loadViewIfNeeded()
        try await Task.sleep(nanoseconds: 700_000_000)
        let back = try XCTUnwrap(descendants(reader.view).first { $0.accessibilityIdentifier == "reader-return-question" } as? UIButton)
        XCTAssertEqual(back.accessibilityLabel, "返回问答")
        let position = try XCTUnwrap(descendants(reader.view).first { $0.accessibilityIdentifier == "reading-save-status" } as? UILabel)
        for _ in 0..<200 where position.text != "阅读位置已保存" { try await Task.sleep(nanoseconds: 100_000_000) }
        XCTAssertEqual(position.text, "阅读位置已保存", "原生阅读器必须确认真实定位后才返回")
        XCTAssertTrue(back.isEnabled, "引用原文必须完成真实定位")
        // A failed catalogue write must not silently destroy the citation reader.
        let catalog = root.appendingPathComponent("library.json")
        let backup = root.appendingPathComponent("library-before-fault.json")
        try FileManager.default.moveItem(at: catalog, to: backup)
        try FileManager.default.createDirectory(at: catalog, withIntermediateDirectories: false)
        back.sendActions(for: .touchUpInside)
        for _ in 0..<20 where reader.presentedViewController == nil { try await Task.sleep(nanoseconds: 50_000_000) }
        XCTAssertEqual((reader.presentedViewController as? UIAlertController)?.title, "位置与设置尚未保存")
        XCTAssertTrue(page.presentedViewController === reader)
        try FileManager.default.removeItem(at: catalog)
        try FileManager.default.moveItem(at: backup, to: catalog)
        await withCheckedContinuation { continuation in
            reader.dismiss(animated: false) { continuation.resume() }
        }
        let readerImage = XCTAttachment(image: UIGraphicsImageRenderer(bounds: window.bounds).image { _ in window.drawHierarchy(in: window.bounds, afterScreenUpdates: true) })
        readerImage.name = "native-citation-return-small"; readerImage.lifetime = .keepAlways; add(readerImage)
        back.sendActions(for: .touchUpInside)
        for _ in 0..<30 where page.presentedViewController != nil { try await Task.sleep(nanoseconds: 100_000_000) }
        XCTAssertNil(page.presentedViewController)
        let input = try XCTUnwrap(descendants(page.view).first { $0.accessibilityIdentifier == "question-input" } as? UITextView)
        XCTAssertEqual(input.text, "还没发送的追问")
        XCTAssertEqual(scroll.contentOffset.y, offset.y, accuracy: 1)
        XCTAssertTrue(descendants(page.view).contains { $0.accessibilityIdentifier == "question-selection-\(turn.id)" })
        XCTAssertEqual(library.questions.conversation(turn.conversation)?.turns.count, 2)
        let image = XCTAttachment(image: UIGraphicsImageRenderer(bounds: window.bounds).image { _ in window.drawHierarchy(in: window.bounds, afterScreenUpdates: true) })
        image.name = "native-chat-small-returned"; image.lifetime = .keepAlways; add(image)
    }

    func testReaderReopensSameConversationAndAcceptsImmediateSecondCitation() async throws {
        let library = try LibraryStore(root: root)
        let fixture = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "original-fixture", withExtension: "epub", subdirectory: "Fixtures"))
        let book = try await library.importBook(from: fixture).book
        await library.preparation.stop(bookID: book.id)
        let publication = try await library.open(book)
        let reader = try ReaderController(book: book, publication: publication, library: library)
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 375, height: 667))
        window.rootViewController = reader; window.makeKeyAndVisible()
        defer { window.isHidden = true; window.rootViewController = nil }
        reader.loadViewIfNeeded()
        let status = try XCTUnwrap(descendants(reader.view).first { $0.accessibilityIdentifier == "reading-save-status" } as? UILabel)
        for _ in 0..<200 where status.text != "阅读位置已保存" { try await Task.sleep(nanoseconds: 100_000_000) }
        XCTAssertEqual(status.text, "阅读位置已保存")
        let ask = try XCTUnwrap(descendants(reader.view).first { $0.accessibilityIdentifier == "reader-ask-book" } as? UIButton)
        ask.sendActions(for: .touchUpInside)
        try await Task.sleep(nanoseconds: 600_000_000)
        let navigation = try XCTUnwrap(reader.presentedViewController as? UINavigationController)
        let page = try XCTUnwrap(navigation.viewControllers.first as? QuestionController)
        var record = try XCTUnwrap(library.questions.records.first)
        var locator = Locator(href: AnyURL(string: "OEBPS/ch1.xhtml")!, mediaType: .xhtml, title: "第一章", text: .init(highlight: "C1-P01"))
        locator.locations.cssSelector = "#c1-p1"
        record.question = "读到的原文在哪里？"; record.answer = "可以回到原文核查。"; record.state = .complete
        record.citations = [QuestionEvidence(id: "E1", locator: locator)]
        XCTAssertTrue(library.questions.save(record))
        try await Task.sleep(nanoseconds: 100_000_000)
        for _ in 0..<2 {
            let source = try XCTUnwrap(descendants(page.view).first { $0.accessibilityIdentifier == "question-reference-0" } as? UIButton)
            source.sendActions(for: .touchUpInside)
            for _ in 0..<100 where reader.questionOrigin == nil { try await Task.sleep(nanoseconds: 50_000_000) }
            XCTAssertNotNil(reader.questionOrigin, "引用必须在问答收起完成后开始定位")
            for _ in 0..<200 where status.text != "阅读位置已保存" { try await Task.sleep(nanoseconds: 100_000_000) }
            let back = try XCTUnwrap(descendants(reader.view).first { $0.accessibilityIdentifier == "reader-return-question" } as? UIButton)
            XCTAssertTrue(back.isEnabled); back.sendActions(for: .touchUpInside)
            for _ in 0..<200 where reader.presentedViewController == nil || navigation.isBeingPresented { try await Task.sleep(nanoseconds: 50_000_000) }
            XCTAssertTrue(reader.presentedViewController === navigation)
            XCTAssertTrue(navigation.viewControllers.first === page)
        }
        let close = try XCTUnwrap(page.navigationItem.rightBarButtonItem)
        UIApplication.shared.sendAction(try XCTUnwrap(close.action), to: close.target, from: close, for: nil)
        try await Task.sleep(nanoseconds: 500_000_000)
        ask.sendActions(for: .touchUpInside)
        try await Task.sleep(nanoseconds: 500_000_000)
        XCTAssertTrue((reader.presentedViewController as? UINavigationController)?.viewControllers.first === page)
        XCTAssertEqual(library.questions.conversation(record.conversation)?.turns.count, 1)
    }

    func testFailedCitationLoadStillOffersReturnToConversation() async throws {
        let library = try LibraryStore(root: root)
        let fixture = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "original-fixture", withExtension: "epub", subdirectory: "Fixtures"))
        let book = try await library.importBook(from: fixture).book
        await library.preparation.stop(bookID: book.id)
        let publication = try await library.open(book)
        let reader = try ReaderController(book: book, publication: publication, library: library)
        reader.questionOrigin = Locator(href: AnyURL(string: "OEBPS/ch1.xhtml")!, mediaType: .xhtml)
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 375, height: 667))
        window.rootViewController = reader; window.makeKeyAndVisible()
        defer { window.isHidden = true; window.rootViewController = nil }
        reader.loadViewIfNeeded()
        let status = try XCTUnwrap(descendants(reader.view).first { $0.accessibilityIdentifier == "reading-save-status" } as? UILabel)
        for _ in 0..<200 where status.text != "阅读位置已保存" { try await Task.sleep(nanoseconds: 100_000_000) }
        XCTAssertEqual(status.text, "阅读位置已保存")
        let navigator = try XCTUnwrap(reader.children.first as? EPUBNavigatorViewController)
        reader.navigator(navigator, didFailToLoadResourceAt: RelativeURL(string: "OEBPS/ch1.xhtml")!, withError: .decoding("Fixture resource failure"))
        XCTAssertEqual((reader.presentedViewController as? UIAlertController)?.title, "原文加载失败")
        await withCheckedContinuation { continuation in
            reader.dismiss(animated: false) { continuation.resume() }
        }
        let back = try XCTUnwrap(descendants(reader.view).first { $0.accessibilityIdentifier == "reader-return-question" } as? UIButton)
        back.sendActions(for: .touchUpInside)
        let confirmation = try XCTUnwrap(reader.presentedViewController as? UIAlertController)
        XCTAssertEqual(confirmation.title, "位置与设置尚未保存")
        XCTAssertTrue(confirmation.actions.contains { $0.title == "仍然返回问答" })
    }
}

final class QuestionKeywordTests: XCTestCase {
    func testKeywordsKeepExactChineseTermsAtEndOfQuestion() {
        let terms = QuestionPlan.keywords("林黛玉初进贾府时为什么步步留心、时时在意？")
        for term in ["步步", "留心", "时时", "在意"] {
            XCTAssertTrue(terms.contains(term), "Missing \(term): \(terms)")
        }
    }
    func testKeywordsPreserveCaseInsensitiveDeduplicationAndStopWords() {
        let text = "WHY the ENGINEER engineer and this that what does RECORDER recorder BATTERY battery 为什么 是什么意思 留心 留心"
        XCTAssertEqual(QuestionPlan.keywords(text), ["engineer", "recorder", "battery", "留心"])
    }
    func testKeywordsBoundLongInputWhileKeepingExactTailTerms() {
        let observations = (1...40).map { "sensor\($0)" }.joined(separator: " ")
        let terms = QuestionPlan.keywords(observations + " 请解释为何停止供电？")
        XCTAssertLessThanOrEqual(terms.count, 20)
        for term in ["停止", "供电"] { XCTAssertTrue(terms.contains(term), "Missing \(term)") }
    }
}

final class QuestionCitationTests: XCTestCase {
    private func evidence() throws -> QuestionEvidence {
        let row = ["id": "E1", "locatorJSON": "{\"href\":\"chapter.xhtml\",\"locations\":{\"cssSelector\":\"#source\"}}",
            "quote": "前句。备用电池继续供电。后句。", "context": "只有上下文提到机房。前句。备用电池继续供电。后句。", "chapter": "Test chapter"]
        return try JSONDecoder().decode(QuestionEvidence.self, from: JSONSerialization.data(withJSONObject: row))
    }
    private func reply(_ references: [[String: String]]) throws -> String {
        String(data: try JSONSerialization.data(withJSONObject: ["answer": "Explanation", "citations": references]), encoding: .utf8)!
    }
    func testCitationAcceptsWholeQuoteAndContinuousExcerptWithOriginalEvidence() throws {
        let source = try evidence()
        for quote in [source.quote, "备用电池继续供电。"] {
            let result = QuestionPlan.validate(try reply([["id": source.id, "quote": quote]]), evidence: [source])
            XCTAssertEqual(result.citations, [source]); XCTAssertEqual(result.warning, "")
        }
    }
    func testCitationRejectsEmptyAlteredUnknownContextAndNoncontinuousQuotes() throws {
        let source = try evidence()
        let invalid = ["", " \n\t", "备用电池停止供电。", "只有上下文提到机房。", "前句。后句。"]
            .map { ["id": source.id, "quote": $0] } + [["id": "E99", "quote": source.quote]]
        for reference in invalid {
            let result = QuestionPlan.validate(try reply([reference]), evidence: [source])
            XCTAssertTrue(result.citations.isEmpty); XCTAssertFalse(result.warning.isEmpty)
        }
    }
    func testCitationDeduplicatesAcceptedExcerptsByEvidenceID() throws {
        let source = try evidence()
        let result = QuestionPlan.validate(try reply([["id": source.id, "quote": "备用电池继续供电。"],
            ["id": source.id, "quote": source.quote]]), evidence: [source])
        XCTAssertEqual(result.citations, [source]); XCTAssertFalse(result.warning.isEmpty)
    }
}

final class QuestionCitationWhitespaceTests: XCTestCase {
    private func evidence() throws -> QuestionEvidence {
        let row = ["id": "E1", "locatorJSON": "{\"href\":\"chapter.xhtml\",\"locations\":{\"cssSelector\":\"#source\"}}",
            "quote": "Before.\r\n\tI ask   only a comfortable\u{00a0}home.\nAfter.\nre sign", "context": "Only in context.", "chapter": "Test chapter"]
        return try JSONDecoder().decode(QuestionEvidence.self, from: JSONSerialization.data(withJSONObject: row))
    }
    private func reply(_ references: [[String: String]]) throws -> String {
        String(data: try JSONSerialization.data(withJSONObject: ["answer": "Explanation", "citations": references]), encoding: .utf8)!
    }
    func testCitationAcceptsWhitespaceChangesWithOriginalEvidence() throws {
        let source = try evidence()
        for quote in [source.quote, "I ask only a comfortable home.", " \tI\nask\r\nonly a comfortable home.\n"] {
            let result = QuestionPlan.validate(try reply([["id": source.id, "quote": quote]]), evidence: [source])
            XCTAssertEqual(result.citations, [source]); XCTAssertEqual(result.warning, "")
        }
    }
    func testCitationRejectsChangesBeyondWhitespaceAndNoncontinuousQuotes() throws {
        let source = try evidence()
        let invalid = ["", " \r\n\t", "I ask only a comfortable house.", "i ask only a comfortable home.",
            "I ask only a comfortable home!", "Before. After.", "resign", "I ask only...home.", "Only in context."]
            .map { ["id": source.id, "quote": $0] } + [["id": "E99", "quote": "I ask only a comfortable home."]]
        for reference in invalid {
            let result = QuestionPlan.validate(try reply([reference]), evidence: [source])
            XCTAssertTrue(result.citations.isEmpty); XCTAssertFalse(result.warning.isEmpty)
        }
    }
    func testCitationWhitespaceKeepsDeduplicationAndMixedWarnings() throws {
        let source = try evidence(), valid = ["id": "E1", "quote": "I ask only a comfortable home."]
        for references in [[valid, valid], [valid, ["id": "E99", "quote": valid["quote"]!]]] {
            let result = QuestionPlan.validate(try reply(references), evidence: [source])
            XCTAssertEqual(result.citations, [source]); XCTAssertFalse(result.warning.isEmpty)
        }
    }
}

@MainActor
final class QuestionTests: XCTestCase {
    private var root: URL!
    private var secrets: EphemeralSecrets!
    override func setUp() async throws {
        root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        secrets = EphemeralSecrets()
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    }
    override func tearDown() async throws {
        try? FileManager.default.removeItem(at: root)
    }
    private func question(_ quote: String = "Safety requires review.") -> ReadingQuestion {
        let book = Book(id: "current-book", title: "Original test book", author: "Test")
        let location = Locator(href: AnyURL(string: "chapter2.xhtml")!, mediaType: .xhtml, title: "Second chapter",
            locations: .init(otherLocations: ["cssSelector": .string("#second-occurrence")]), text: .init(highlight: quote))
        var record = ReadingQuestion(book: book, selection: QuestionEvidence(locator: location), neighbors: [])
        record.question = "Why review?"; return record
    }
    private func availableQuestion(_ library: LibraryStore) async throws -> ReadingQuestion {
        let file = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "original-fixture", withExtension: "epub", subdirectory: "Fixtures"))
        let book = try await library.importBook(from: file).book
        await library.preparation.stop(bookID: book.id)
        let location = Locator(href: AnyURL(string: "OEBPS/ch1.xhtml")!, mediaType: .xhtml, title: "第1章：原创验证文本",
            locations: .init(otherLocations: ["cssSelector": .string("#c1-p1")]), text: .init(highlight: "阅读需要保留上下文。"))
        var record = ReadingQuestion(book: book, selection: QuestionEvidence(locator: location), neighbors: [])
        record.question = "为什么阅读需要保留上下文？"; return record
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
    func testIssue21LocalSelectionKeepsAllPartsWithoutNeighborsOrEmbedding() async throws {
        let first = question("FIRST-SELECTED-PART").selection, second = question("SECOND-SELECTED-PART").selection
        var record = ReadingQuestion(book: Book(id: "current-book", title: "Local", author: ""), selection: first, neighbors: [question("UNUSED-NEIGHBOR").selection])
        record.selectionParts = [first, second]; record.question = "本句为何如此？"
        record.history = [QuestionHistoryTurn(id: UUID(), question: "Earlier question", answer: "UNVERIFIED-HISTORY-ANSWER", state: .complete)]
        let unused = root.appendingPathComponent("no-index.sqlite")
        let plan = try await QuestionPlan.make(record, index: BookIndex(url: unused), local: true, state: BookPreparationState())
        XCTAssertEqual(plan.evidence.map(\.quote), [first.quote, second.quote])
        XCTAssertTrue(plan.notice.contains("仅发送提问选文")); XCTAssertNil(plan.trace)
        XCTAssertFalse(FileManager.default.fileExists(atPath: unused.path))
        XCTAssertFalse(plan.prompt.contains("UNUSED-NEIGHBOR"))
        XCTAssertFalse(plan.evidence.contains { $0.quote == "UNVERIFIED-HISTORY-ANSWER" })
        let query = QuestionPlan.retrievalInput(record, evidence: plan.evidence)
        for text in [record.question, first.quote, second.quote, "Earlier question", "UNVERIFIED-HISTORY-ANSWER", "非书内依据"] { XCTAssertTrue(query.contains(text)) }
    }
    func testBothRealHTTPFormatsCancelImmediateRetryAndLateResponse() async throws {
        let library = try LibraryStore(root: root), store = QuestionStore(root: root, secrets: secrets)
        let configurations = try AIConfigurationStore(root: root, secrets: secrets)
        defer { for value in configurations.configurations { try? configurations.remove(value.id) } }
        for format in AIFormat.allCases {
            var configuration = AIConfiguration(name: "Fixture", format: format, address: "http://127.0.0.1:18769/v1", model: "late")
            try configurations.save(configuration, newKey: "not-a-real-credential"); try configurations.select(configuration.id)
            let record = try await availableQuestion(library); store.save(record)
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
        let otherID = Int(try XCTUnwrap(db.rows("SELECT id FROM fragments WHERE book_id=?", [other.id]).first)[0])!
        let alien = try XCTUnwrap(db.evidence(id: otherID, scope: BookEvidenceScope(bookID: other.id)))
        let settings = try AIConfigurationStore(root: root, secrets: secrets)
        defer { for value in settings.configurations { try? settings.remove(value.id) } }
        let store = QuestionStore(root: root, secrets: secrets)
        var full = ReadingQuestion(book: book, selection: selectedSource, neighbors: [])
        full.question = "I13-FULL 初版规则为什么改变？"
        var configuration = AIConfiguration(name: "I13", format: .openAI, address: "http://127.0.0.1:18773/v1", model: "issue13")
        try settings.save(configuration, newKey: "not-a-real-credential"); store.save(full)
        store.send(full.id, library: library, local: false); try await issue12Wait(store, id: full.id)
        XCTAssertEqual(store.record(full.id)?.state, .complete)
        XCTAssertLessThanOrEqual(store.record(full.id)?.retrievalTrace?.semantic.count ?? 0, 8)
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
        for (name, selection, chapters) in [("I13-ZERO-SELECTION", unread, [0, 2]), ("I13-ZERO-EMPTY", selectedSource, []), ("I13-ZERO-CROSS-BOOK", alien, [0, 2])] {
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
    func testIssue21FinalMaterialCountsSelectionAndRejectsNineRequired() async throws {
        let (library, book) = try await issue12Book()
        let index = library.preparation.index, scope = BookEvidenceScope(bookID: book.id)
        let db = try IndexDatabase(url: root.appendingPathComponent("book-index.sqlite"))
        let rows = try db.rows("SELECT id FROM fragments WHERE book_id=? ORDER BY id LIMIT 9", [book.id])
        let required = try rows.map { try XCTUnwrap(db.evidence(id: Int($0[0])!, scope: scope)) }
        let selection = try XCTUnwrap(db.evidence(id: Int(rows[0][0])!, scope: scope, range: NSRange(location: 0, length: 2)))
        var record = ReadingQuestion(book: book, selection: selection, neighbors: [])
        record.question = "FINAL-BUDGET 盐桥的停机规则为什么改变？"
        let plan = try await QuestionPlan.make(record, index: index, local: false, state: library.preparation.states[book.id]!)
        XCTAssertEqual(plan.trace?.anchors.count, 8)
        XCTAssertEqual(plan.evidence.count, 8)
        XCTAssertEqual(plan.evidence.first?.locatorJSON, selection.locatorJSON)
        XCTAssertEqual(plan.evidence.first?.quote, selection.quote)
        XCTAssertTrue(plan.notice.contains("部分检索材料超出本次容量未发送"))
        XCTAssertLessThanOrEqual(plan.prompt.utf8.count, 24000)
        let payload = try XCTUnwrap(plan.prompt.split(separator: "\n", maxSplits: 1).last)
        let material = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(payload.utf8)) as? [String: Any])
        XCTAssertEqual((material["evidence"] as? [[String: String]])?.count, 8)
        record.selectionParts = Array(required.prefix(8))
        let boundary = try await QuestionPlan.make(record, index: index, local: true, state: BookPreparationState())
        XCTAssertEqual(boundary.evidence.map(\.quote), record.selectionParts!.map(\.quote))
        record.selectionParts = required
        do { _ = try await QuestionPlan.make(record, index: index, local: true, state: BookPreparationState()); XCTFail("Nine required selections must not be clipped") }
        catch { XCTAssertEqual(error as? QuestionError, .budget) }
    }
    func testIssue21SelectedFreeAndFollowupUseOneFinalHTTPInBothFormats() async throws {
        let (library, book) = try await issue12Book()
        let index = library.preparation.index, allowed = BookEvidenceScope(bookID: book.id)
        let db = try IndexDatabase(url: root.appendingPathComponent("book-index.sqlite"))
        func source(_ phrase: String) throws -> QuestionEvidence {
            let row = try XCTUnwrap(db.rows("SELECT id FROM fragments WHERE book_id=? AND original LIKE ?", [book.id, "%" + phrase + "%"]).first)
            return try XCTUnwrap(db.evidence(id: Int(row[0])!, scope: allowed))
        }
        let selected = try source("初版规则规定所有停机指令"), second = try source("观测员判断大雾")
        let unusedNeighbor = question("ISSUE21-UNUSED-NEIGHBOR").selection
        let settings = try AIConfigurationStore(root: root, secrets: secrets)
        defer { for value in settings.configurations { try? settings.remove(value.id) } }
        let store = QuestionStore(root: root, secrets: secrets)
        for format in AIFormat.allCases {
            let configuration = AIConfiguration(name: "Issue21", format: format, address: "http://127.0.0.1:18773/v1", model: "issue21")
            try settings.save(configuration, newKey: "not-a-real-credential"); try settings.select(configuration.id)
            var first = ReadingQuestion(book: book, selection: selected, neighbors: [unusedNeighbor])
            first.selectionParts = [selected, second]; first.question = "ISSUE21 余辉延迟为什么影响停机规则？"
            // Legacy parser metadata must not become this turn's retrieval result.
            first.retrievalQueries = ["OLD-RESOLVED-QUERY"]; first.retrievalNotice = "OLD-RESOLVER-NOTICE"
            var free = ReadingQuestion(book: book, origin: try selected.location())
            free.question = "ISSUE21 全书停机规则有哪些联系？"
            for record in [first, free] {
                XCTAssertTrue(store.save(record))
                try await verifyOneFinalRequest(record.id)
            }
            let follow = try XCTUnwrap(store.followUp(first.id))
            store.edit(follow, text: "ISSUE21 那作者后来为什么改口？")
            try await verifyOneFinalRequest(follow)
            let saved = try XCTUnwrap(store.record(follow))
            let required = try await QuestionPlan.requiredEvidence(saved, index: index, local: false, scope: allowed)
            let query = QuestionPlan.retrievalInput(saved, evidence: required)
            for text in [saved.question, selected.quote, second.quote, first.question, try XCTUnwrap(store.record(first.id)).answer, "历史回答（非书内依据）"] { XCTAssertTrue(query.contains(text)) }
            XCTAssertFalse(query.contains(unusedNeighbor.quote))
        }
        func verifyOneFinalRequest(_ id: UUID) async throws {
            let before = try await issue13Requests().count
            store.send(id, library: library, local: false); try await issue12Wait(store, id: id)
            let saved = try XCTUnwrap(store.record(id))
            XCTAssertEqual(saved.state, .complete, saved.failure ?? "")
            XCTAssertNil(saved.retrievalQueries); XCTAssertNil(saved.retrievalNotice)
            XCTAssertTrue(saved.searchedChapters?.isEmpty == true); XCTAssertTrue(saved.omittedChapters?.isEmpty == true)
            let trace = try XCTUnwrap(saved.retrievalTrace)
            XCTAssertTrue(trace.expanded.isEmpty)
            XCTAssertLessThanOrEqual(trace.anchors.count, 8)
            XCTAssertLessThanOrEqual(trace.keyword.count, 8); XCTAssertLessThanOrEqual(trace.semantic.count, 8)
            let rows = Array(try await issue13Requests().dropFirst(before))
            XCTAssertEqual(rows.count, 1)
            let row = try XCTUnwrap(rows.first), prompt = try XCTUnwrap(row["prompt"] as? String)
            XCTAssertEqual(row["max_tokens"] as? Int, 1600)
            XCTAssertEqual(row["path"] as? String, saved.format == .openAI ? "/v1/chat/completions" : "/v1/messages")
            XCTAssertFalse(prompt.contains(unusedNeighbor.quote)); XCTAssertFalse(prompt.contains("OLD-RESOLVED")); XCTAssertFalse(prompt.contains("OLD-RESOLVER"))
            XCTAssertTrue(prompt.contains("历史回答仅帮助理解指代，不是原文依据")); XCTAssertTrue(prompt.contains("不承诺完整概括全书"))
            XCTAssertLessThanOrEqual(prompt.utf8.count, 24000)
            let material = try XCTUnwrap(row["material"] as? [String: Any])
            XCTAssertEqual(material["bookID"] as? String, book.id)
            XCTAssertEqual(material["selection"] as? [String], (saved.selectionParts ?? [saved.selection]).map(\.quote))
            let history = try XCTUnwrap(material["history"] as? [[String: Any]])
            XCTAssertEqual(history.compactMap { $0["question"] as? String }, (saved.history ?? []).map(\.question))
            XCTAssertEqual(history.compactMap { $0["answer"] as? String }, (saved.history ?? []).map(\.answer))
            let evidence = try XCTUnwrap(material["evidence"] as? [[String: String]])
            XCTAssertEqual(evidence.compactMap { $0["quote"] }, saved.evidence.map(\.quote))
            let permitted = try await index.permits(saved.evidence, scope: allowed); XCTAssertTrue(permitted)
            let restored = try XCTUnwrap(QuestionStore(root: root, secrets: secrets).record(id))
            XCTAssertEqual(restored.answer, saved.answer); XCTAssertEqual(restored.citations, saved.citations)
        }
        try issue12Attachment("issue21-single-request-materials", store: store)
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
        let follow = try XCTUnwrap(store.followUp(first.id)); store.edit(follow, text: "那他为什么改口？")
        configuration = AIConfiguration(name: "Issue12 Anthropic", format: .anthropic, address: "http://127.0.0.1:18772/v1", model: "issue12")
        try configurations.save(configuration, newKey: "not-a-real-credential"); try configurations.select(configuration.id)
        store.send(follow, library: library, local: false); try await issue12Wait(store, id: follow)
        let changed = try XCTUnwrap(store.record(follow))
        XCTAssertEqual(changed.state, .complete); XCTAssertEqual(changed.format, .anthropic)
        XCTAssertEqual(store.record(first.id)?.format, .openAI)
        XCTAssertNil(changed.retrievalQueries); XCTAssertNil(changed.retrievalNotice)
        XCTAssertEqual(changed.history?.first?.question, first.question)
        XCTAssertLessThanOrEqual(changed.retrievalTrace?.semantic.count ?? 0, 8)
        let next = try XCTUnwrap(store.followUp(first.id)); store.edit(next, text: "那切断主供电后，记录器和计时器为什么还在运行？")
        store.send(next, library: library, local: false, scope: BookEvidenceScope(bookID: book.id)); try await issue12Wait(store, id: next)
        let third = try XCTUnwrap(store.record(next))
        XCTAssertEqual(third.state, .complete)
        XCTAssertLessThanOrEqual(third.retrievalTrace?.semantic.count ?? 0, 8)
        XCTAssertTrue(third.evidence.contains { $0.quote == first.selection.quote })
        XCTAssertEqual(third.history?.count, 2)
        XCTAssertFalse(third.retrievalTrace?.semantic.isEmpty ?? true)
        try issue12Attachment("issue12-real-retrieval-three-turns", store: store)
        // Both the selected text and prior full-book answers are disallowed before any answer HTTP.
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
        do { _ = try await QuestionPlan.make(record, index: BookIndex(url: root.appendingPathComponent("unused.sqlite")), local: true, state: BookPreparationState()); XCTFail("History cannot be silently clipped") }
        catch { XCTAssertEqual(error as? QuestionError, .budget) }
        let library = try LibraryStore(root: root), configurations = try AIConfigurationStore(root: root, secrets: secrets)
        let configuration = AIConfiguration(name: "Capacity", format: .anthropic, address: "http://127.0.0.1:18772/v1", model: "capacity")
        try configurations.save(configuration, newKey: "not-a-real-credential")
        let store = QuestionStore(root: root, secrets: secrets), submitted = try await availableQuestion(library)
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
            let record = try await availableQuestion(library); store.save(record); store.send(record.id, library: library, local: true)
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
        let store = QuestionStore(root: root, secrets: secrets), record = try await availableQuestion(library)
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
        let store = QuestionStore(root: root, secrets: secrets), record = try await availableQuestion(library)
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
        let store = QuestionStore(root: root, secrets: secrets), record = try await availableQuestion(library)
        XCTAssertTrue(store.save(record)); store.send(record.id, library: library, local: true)
        try await Task.sleep(nanoseconds: 4_000_000_000)
        let restored = QuestionStore(root: root, secrets: secrets).record(record.id)
        XCTAssertEqual(restored?.state, .incomplete); XCTAssertEqual(restored?.question, record.question)
        XCTAssertEqual(restored?.answer, ""); XCTAssertTrue(restored?.citations.isEmpty == true)
    }
}

@MainActor
final class QuestionMaterialTests: XCTestCase {
    private func question(_ quote: String = "Safety requires review.") -> ReadingQuestion {
        let book = Book(id: "material-test", title: "Original fixture", author: "")
        let location = Locator(href: AnyURL(string: "chapter.xhtml")!, mediaType: .xhtml, title: "Chapter", text: .init(highlight: quote))
        var record = ReadingQuestion(book: book, selection: QuestionEvidence(locator: location), neighbors: [])
        record.question = "Why review?"; return record
    }





    func testIssue11PromptOmitsOnlyIdenticalContextAndKeepsHistoryAndReferences() throws {
        var first = question().selection; first.id = "E1"
        let second = QuestionEvidence(id: "E2", locator: try question("The spare cell was intact.").selection.location(), context: "Before: the cabinet was opened. The spare cell was intact. After: recording resumed.")
        var record = question()
        record.history = [QuestionHistoryTurn(id: UUID(), question: "Earlier question", answer: "Earlier explanation", state: .complete)]
        let prompt = try QuestionPlan.prompt(record, evidence: [first, second], notice: "bounded")
        let json = try XCTUnwrap(prompt.firstIndex(of: "\n")).utf16Offset(in: prompt)
        let payload = try JSONSerialization.jsonObject(with: Data((prompt as NSString).substring(from: json + 1).utf8)) as! [String: Any]
        let material = try XCTUnwrap(payload["evidence"] as? [[String: String]])
        XCTAssertNil(material[0]["context"]); XCTAssertEqual(material[0]["quote"], first.quote)
        XCTAssertEqual(material[1]["context"], second.context)
        XCTAssertEqual(material.map { $0["id"]! }, ["E1", "E2"])
        XCTAssertTrue(prompt.contains("Earlier question")); XCTAssertTrue(prompt.contains("Earlier explanation"))
        XCTAssertEqual(try JSONDecoder().decode(QuestionEvidence.self, from: JSONEncoder().encode(second)), second)
        let reply = String(data: try JSONSerialization.data(withJSONObject: ["answer": "Explanation", "citations": [["id": first.id, "quote": first.quote], ["id": second.id, "quote": second.quote]]]), encoding: .utf8)!
        XCTAssertEqual(QuestionPlan.validate(reply, evidence: [first, second]).citations, [first, second])
    }

}
