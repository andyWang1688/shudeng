import XCTest
import SQLite3
import ReadiumShared
@testable import Shudeng

@MainActor
final class LibraryTests: XCTestCase {
    func testShelfSearchAndStableOrder() {
        let books = [Book(id: "b", title: "同名书", author: "作者乙"),
                     Book(id: "c", title: "Alpha 2", author: "Shudeng original fixture"),
                     Book(id: "a", title: "同名书", author: "作者甲")]
        XCTAssertEqual(ShelfOrder.imported.books(books, matching: "  ").map(\.id), ["b", "c", "a"])
        XCTAssertEqual(ShelfOrder.imported.books(books, matching: " ALPHA ").map(\.id), ["c"])
        XCTAssertEqual(ShelfOrder.imported.books(books, matching: "ORIGINAL FIXTURE").map(\.id), ["c"])
        XCTAssertEqual(ShelfOrder.imported.books(books, matching: "作者甲").map(\.id), ["a"])
        XCTAssertTrue(ShelfOrder.title.books(books, matching: "missing").isEmpty)
        XCTAssertEqual(ShelfOrder.title.books(books, matching: "同名").map(\.id), ["a", "b"])
        XCTAssertEqual(ShelfOrder.title.books(books.reversed(), matching: "同名").map(\.id), ["a", "b"])
        let english = [Book(id: "2", title: "Book 10", author: ""), Book(id: "1", title: "Book 2", author: "")]
        XCTAssertEqual(ShelfOrder.title.books(english, matching: "").map(\.id), ["1", "2"])
        XCTAssertEqual(books.map(\.id), ["b", "c", "a"])
    }
    var root: URL!
    override func setUp() async throws {
        root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    }
    override func tearDown() async throws { try? FileManager.default.removeItem(at: root) }
    func fixture(_ name: String = "original-fixture", extension ext: String = "epub") -> URL {
        Bundle(for: Self.self).url(forResource: name, withExtension: ext, subdirectory: "Fixtures")!
    }
    func testImportDuplicateAndRestartKeepOneBookAndOriginalLocation() async throws {
        let library = try LibraryStore(root: root)
        let first = try await library.importBook(from: fixture())
        let location = try XCTUnwrap(Locator(json: JSONValue(jsonString: """
        {"href":"OEBPS/ch2.xhtml","type":"application/xhtml+xml","locations":{"cssSelector":"#c2-p10","progression":0.3},"text":{"highlight":"C2-P10"}}
        """, warnings: nil), warnings: nil))
        try library.saveLocation(location, for: first.book.id)
        let duplicate = try await library.importBook(from: fixture())
        XCTAssertTrue(duplicate.isDuplicate)
        XCTAssertEqual(duplicate.book.id, first.book.id)
        let reopened = try LibraryStore(root: root)
        XCTAssertEqual(reopened.books.count, 1)
        XCTAssertEqual(try reopened.location(for: first.book.id)?.href.string, "OEBPS/ch2.xhtml")
        XCTAssertEqual(try reopened.location(for: first.book.id)?.locations["cssSelector"]?.string, "#c2-p10")
        _ = try await reopened.open(first.book)
    }
}

extension LibraryTests {
    private func indexRows(_ url: URL, _ sql: String) throws -> [[String]] {
        var db: OpaquePointer?, statement: OpaquePointer?
        XCTAssertEqual(sqlite3_open_v2(url.path, &db, SQLITE_OPEN_READONLY, nil), SQLITE_OK)
        defer { sqlite3_finalize(statement); sqlite3_close(db) }
        XCTAssertEqual(sqlite3_prepare_v2(db, sql, -1, &statement, nil), SQLITE_OK)
        var rows: [[String]] = []
        var step = sqlite3_step(statement)
        while step == SQLITE_ROW {
            rows.append((0..<sqlite3_column_count(statement)).map { String(cString: sqlite3_column_text(statement, $0)) })
            step = sqlite3_step(statement)
        }
        guard step == SQLITE_DONE else { throw IndexError.storage }
        return rows
    }
    private func indexExecute(_ url: URL, _ sql: String) throws {
        var db: OpaquePointer?
        guard sqlite3_open(url.path, &db) == SQLITE_OK else { throw IndexError.storage }
        defer { sqlite3_close(db) }
        guard sqlite3_exec(db, sql, nil, nil, nil) == SQLITE_OK else { throw IndexError.storage }
    }

    func testBookIndexOriginalOccurrencesIsolationAndRebuildKeepRecords() async throws {
        let library = try LibraryStore(root: root)
        let book = try await library.importBook(from: fixture()).book
        let url = root.appendingPathComponent("verification-index.sqlite")
        let index = BookIndex(url: url)
        try await index.prepare(bookID: book.id, file: library.fileURL(for: book)) { _ in }
        let repeats = try await index.search(bookID: book.id, query: "The same sentence can belong to a different argument.")
        XCTAssertEqual(repeats.count, 12)
        XCTAssertEqual(Set(repeats.map { $0.locator.href.string }).count, 3)
        let pair = Array(repeats.prefix(2))
        XCTAssertEqual(pair[0].locator.locations.cssSelector, pair[1].locator.locations.cssSelector)
        XCTAssertNotEqual(pair[0].locator.text.before, pair[1].locator.text.before)
        XCTAssertTrue(pair[1].locator.text.before!.contains(pair[0].locator.text.highlight!))
        XCTAssertNotEqual(pair[0].id, pair[1].id)
        let chinese = try await index.search(bookID: book.id, query: "同一句话也可能")
        XCTAssertEqual(chinese.count, 12)
        let english = try await index.search(bookID: book.id, query: "READING RELIES ON CONTEXT")
        XCTAssertEqual(english.count, 168)
        let noMatch = try await index.search(bookID: book.id, query: "not present ' OR 1=1 --")
        XCTAssertTrue(noMatch.isEmpty)
        let other = "different-book"
        try await index.prepare(bookID: other, file: fixture()) { _ in }
        let isolated = try await index.search(bookID: book.id, query: "C3-P30")
        XCTAssertEqual(isolated.count, 1)
        let missing = try await index.search(bookID: "missing-book", query: "C3-P30")
        XCTAssertTrue(missing.isEmpty)
        try library.saveBookmark(Bookmark(locator: pair[1].locator), for: book.id)
        try library.saveLocation(pair[1].locator, for: book.id)
        let snapshot = try Data(contentsOf: root.appendingPathComponent("library.json"))
        let rows = try indexRows(url, "SELECT chapter,ordinal,original,locator FROM fragments WHERE book_id='\(book.id)' ORDER BY chapter,ordinal")
        let otherRows = try indexRows(url, "SELECT id,original,locator FROM fragments WHERE book_id='\(other)' ORDER BY chapter,ordinal")
        try await index.prepare(bookID: book.id, file: fixture(), rebuild: true) { _ in }
        XCTAssertEqual(try Data(contentsOf: root.appendingPathComponent("library.json")), snapshot)
        XCTAssertTrue(try indexRows(url, "SELECT chapter,ordinal,original,locator FROM fragments WHERE book_id='\(book.id)' ORDER BY chapter,ordinal") == rows)
        XCTAssertTrue(try indexRows(url, "SELECT id,original,locator FROM fragments WHERE book_id='\(other)' ORDER BY chapter,ordinal") == otherRows)
        XCTAssertEqual(try indexRows(url, "SELECT count(*) FROM fragments f LEFT JOIN fragment_terms t ON t.rowid=f.id WHERE t.rowid IS NULL"), [["0"]])
        print("I8_SQLITE occurrences=12 chinese=12 english=168 chapters=3 rebuild-identical=true other-book-unchanged=true")
    }

    func testBookIndexCommittedCheckpointInterruptionAndRealJournalFailureResume() async throws {
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let url = root.appendingPathComponent("checkpoint.sqlite")
        let index = BookIndex(url: url)
        let interrupted = Task {
            try await index.prepare(bookID: "checkpoint", file: fixture()) { state in
                if state.completed == 1 { withUnsafeCurrentTask { $0?.cancel() } }
            }
        }
        do { try await interrupted.value; XCTFail("Expected interruption") }
        catch is CancellationError { }
        let first = try indexRows(url, "SELECT id,original,locator FROM fragments ORDER BY id")
        XCTAssertFalse(first.isEmpty)
        XCTAssertEqual(try indexRows(url, "SELECT completed,total FROM preparations"), [["1", "3"]])
        // A directory at the real SQLite rollback-journal path prevents an actual write.
        let journal = URL(fileURLWithPath: url.path + "-journal")
        try FileManager.default.createDirectory(at: journal, withIntermediateDirectories: false)
        let reopened = BookIndex(url: url)
        do { try await reopened.prepare(bookID: "checkpoint", file: fixture()) { _ in }; XCTFail("Expected actual SQLite write failure") }
        catch { XCTAssertTrue(error is IndexError) }
        try FileManager.default.removeItem(at: journal)
        XCTAssertEqual(try indexRows(url, "SELECT completed,total FROM preparations"), [["1", "3"]])
        XCTAssertTrue(try indexRows(url, "SELECT id,original,locator FROM fragments ORDER BY id") == first)
        // Database-only fault: abort after three rows of the next chapter have
        // really been inserted in the same transaction. No product fault hook.
        try indexExecute(url, """
        CREATE TRIGGER issue8_abort_chapter BEFORE INSERT ON fragments
        WHEN NEW.chapter=1 AND (SELECT count(*) FROM fragments WHERE book_id=NEW.book_id AND chapter=1)=3
        BEGIN SELECT RAISE(ABORT,'issue8 transaction boundary'); END
        """)
        do { try await reopened.prepare(bookID: "checkpoint", file: fixture()) { _ in }; XCTFail("Expected in-transaction abort") }
        catch { XCTAssertTrue(error is IndexError) }
        XCTAssertEqual(try indexRows(url, "SELECT completed,total FROM preparations"), [["1", "3"]])
        XCTAssertEqual(try indexRows(url, "SELECT count(*) FROM chapters WHERE ordinal=1"), [["0"]])
        XCTAssertEqual(try indexRows(url, "SELECT count(*) FROM fragments WHERE chapter=1"), [["0"]])
        XCTAssertEqual(try indexRows(url, "SELECT count(*) FROM fragment_terms"), [[String(first.count)]])
        XCTAssertTrue(try indexRows(url, "SELECT id,original,locator FROM fragments ORDER BY id") == first)
        try indexExecute(url, "DROP TRIGGER issue8_abort_chapter")
        var progress: [Int] = []
        try await reopened.prepare(bookID: "checkpoint", file: fixture()) { progress.append($0.completed) }
        XCTAssertEqual(progress, [1, 2, 3])
        XCTAssertTrue(Array(try indexRows(url, "SELECT id,original,locator FROM fragments ORDER BY id").prefix(first.count)) == first)
        XCTAssertEqual(try indexRows(url, "SELECT count(*) FROM chapters"), [["3"]])
        XCTAssertEqual(try indexRows(url, "SELECT count(*) FROM (SELECT book_id,chapter,ordinal,count(*) n FROM fragments GROUP BY book_id,chapter,ordinal HAVING n>1)"), [["0"]])
        print("I8_CHECKPOINT committed=1/3 journal-initialization-write-failed=true transaction-aborted-after-3-inserts=true chapter-and-FTS-rollback=true old-original-unchanged=true resumed=[1,2,3] duplicates=0")
    }

    func testBookIndexInlineWhitespaceUnicodeAndNestedBlockIdentity() throws {
        let html = "<html><body><div>开头<p> 😀 A&amp;B  <em>同一句</em>\n同一句 café</p>尾部<p>同一句</p></div><script>秘密</script></body></html>"
        let fragments = try BookText.fragments(html: html, href: AnyURL(string: "chapter.xhtml")!, title: "章节")
        XCTAssertEqual(fragments.map(\.text), ["开头", " 😀 A&B  同一句\n同一句 café", "尾部", "同一句"])
        XCTAssertEqual(fragments[2].locator.text.before, "开头 😀 A&B  同一句\n同一句 café")
        XCTAssertEqual(fragments[2].locator.text.after, "同一句")
        XCTAssertEqual(fragments[1].locator.locations.cssSelector, "html:nth-of-type(1) > body:nth-of-type(1) > div:nth-of-type(1) > p:nth-of-type(1)")
        XCTAssertFalse(fragments.contains { $0.text.contains("秘密") })
        XCTAssertEqual(BookText.tokens("café"), BookText.tokens("CAFE"))
        let hidden = try BookText.fragments(html: "<p>可见<span><span hidden>隐秘标记</span>后续可见</span>正文</p>", href: AnyURL(string: "hidden.xhtml")!, title: "隐藏边界")
        XCTAssertEqual(hidden.map(\.text), ["可见", "后续可见", "正文"])
        XCTAssertEqual(hidden[1].locator.text.before, "隐秘标记")
        XCTAssertEqual(hidden[2].locator.text.before, "可见隐秘标记后续可见")
        XCTAssertEqual(hidden[1].locator.locations.cssSelector, "html:nth-of-type(1) > body:nth-of-type(1) > p:nth-of-type(1) > span:nth-of-type(1)")
    }
}

extension LibraryTests {
    func testBookmarksSurviveRestartAndFailedMutationsRetryWithoutDuplicates() async throws {
        let library = try LibraryStore(root: root)
        let book = try await library.importBook(from: fixture()).book
        let location = try XCTUnwrap(Locator(json: JSONValue(jsonString: """
        {"href":"OEBPS/ch2.xhtml","type":"application/xhtml+xml","locations":{"cssSelector":"#c2-p30","progression":0.99},"text":{"before":"first occurrence; ","highlight":"repeated sentence","after":" chapter end"}}
        """, warnings: nil), warnings: nil))
        let bookmark = Bookmark(locator: location)
        try library.saveBookmark(bookmark, for: book.id)
        try library.saveBookmark(bookmark, for: book.id)
        try library.saveBookmark(Bookmark(locator: location), for: book.id)
        var reflowed = location
        reflowed.locations.progression = 0.7
        try library.saveBookmark(Bookmark(locator: reflowed), for: book.id)
        let restarted = try LibraryStore(root: root)
        XCTAssertEqual(restarted.books.first?.bookmarks?.count, 1)
        XCTAssertEqual(restarted.books.first?.bookmarks?.first?.locatorJSON, location.description)
        let catalog = root.appendingPathComponent("library.json")
        let backup = root.appendingPathComponent("committed.json")
        try FileManager.default.moveItem(at: catalog, to: backup)
        try FileManager.default.createDirectory(at: catalog, withIntermediateDirectories: false)
        XCTAssertThrowsError(try library.removeBookmark(bookmark.id, for: book.id))
        XCTAssertEqual(library.books.first?.bookmarks?.count, 1)
        var otherLocation = location
        otherLocation.href = AnyURL(string: "OEBPS/ch3.xhtml")!
        let other = Bookmark(locator: otherLocation)
        XCTAssertThrowsError(try library.saveBookmark(other, for: book.id))
        XCTAssertEqual(library.books.first?.bookmarks?.count, 1)
        try FileManager.default.removeItem(at: catalog)
        try FileManager.default.moveItem(at: backup, to: catalog)
        XCTAssertEqual(try LibraryStore(root: root).books.first?.bookmarks?.count, 1)
        try library.saveBookmark(other, for: book.id)
        try library.saveBookmark(other, for: book.id)
        XCTAssertEqual(try LibraryStore(root: root).books.first?.bookmarks?.count, 2)
        try library.removeBookmark(bookmark.id, for: book.id)
        try library.removeBookmark(bookmark.id, for: book.id)
        XCTAssertEqual(try LibraryStore(root: root).books.first?.bookmarks?.map(\.id), [other.id])
    }

    func testLegacySettingsWithoutCurlDecodeUnchanged() throws {
        let legacy = Data(#"{"scroll":true,"fontSize":125,"dark":true}"#.utf8)
        let settings = try JSONDecoder().decode(ReadingSettings.self, from: legacy)
        XCTAssertEqual(settings, ReadingSettings(scroll: true, fontSize: 125, dark: true))
        XCTAssertNotEqual(settings.pageCurl, true)
    }

    func testSettingsAndLocationCommitTogetherAndRecoverAfterWriteFailure() async throws {
        let library = try LibraryStore(root: root)
        let book = try await library.importBook(from: fixture()).book
        XCTAssertEqual(book.readingSettings ?? ReadingSettings(), ReadingSettings())
        let first = Locator(href: AnyURL(string: "OEBPS/ch1.xhtml")!, mediaType: .xhtml, locations: .init(progression: 0.2))
        let next = Locator(href: AnyURL(string: "OEBPS/ch2.xhtml")!, mediaType: .xhtml, locations: .init(progression: 0.4))
        try library.saveReadingState(first, settings: ReadingSettings(), for: book.id)
        let changed = ReadingSettings(scroll: false, fontSize: 150, dark: true, pageCurl: true)
        let catalog = root.appendingPathComponent("library.json")
        let committed = root.appendingPathComponent("committed.json")
        try FileManager.default.moveItem(at: catalog, to: committed)
        try FileManager.default.createDirectory(at: catalog, withIntermediateDirectories: false)
        XCTAssertThrowsError(try library.saveReadingState(next, settings: changed, for: book.id))
        XCTAssertEqual(library.books.first?.readingSettings, ReadingSettings())
        XCTAssertEqual(try library.location(for: book.id)?.href.string, "OEBPS/ch1.xhtml")
        try FileManager.default.removeItem(at: catalog)
        try FileManager.default.moveItem(at: committed, to: catalog)
        let reopened = try LibraryStore(root: root)
        XCTAssertEqual(reopened.books.first?.readingSettings, ReadingSettings())
        XCTAssertEqual(try reopened.location(for: book.id)?.href.string, "OEBPS/ch1.xhtml")
        try library.saveReadingState(next, settings: changed, for: book.id)
        try library.saveReadingState(next, settings: changed, for: book.id)
        let restored = try LibraryStore(root: root)
        XCTAssertEqual(restored.books.count, 1)
        XCTAssertEqual(restored.books.first?.readingSettings, changed)
        XCTAssertEqual(try restored.location(for: book.id)?.href.string, "OEBPS/ch2.xhtml")
    }

    func testRejectedFilesNeverAppearAfterRestart() async throws {
        let library = try LibraryStore(root: root)
        for url in [fixture("corrupted"), fixture("fixed-layout"), fixture("missing-chapter"), fixture("unsupported", extension: "txt")] {
            do { _ = try await library.importBook(from: url); XCTFail("Accepted \(url.lastPathComponent)") }
            catch { XCTAssertTrue(library.books.isEmpty) }
        }
        XCTAssertTrue(try LibraryStore(root: root).books.isEmpty)
    }

    func testImportWriteFailureRollsBackAndRetryCreatesOneRecord() async throws {
        let library = try LibraryStore(root: root)
        let catalog = root.appendingPathComponent("library.json")
        try FileManager.default.createDirectory(at: catalog, withIntermediateDirectories: false)
        do { _ = try await library.importBook(from: fixture()); XCTFail("Unexpected success") } catch {}
        XCTAssertTrue(library.books.isEmpty)
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: root.appendingPathComponent("Books").path).count, 0)
        try FileManager.default.removeItem(at: catalog)
        _ = try await library.importBook(from: fixture())
        _ = try await library.importBook(from: fixture())
        XCTAssertEqual(try LibraryStore(root: root).books.count, 1)
    }

    func testFailedLocationWriteKeepsCommittedLocationAndRetrySucceeds() async throws {
        let library = try LibraryStore(root: root)
        let book = try await library.importBook(from: fixture()).book
        let first = Locator(href: AnyURL(string: "OEBPS/ch1.xhtml")!, mediaType: .xhtml, locations: .init(progression: 0.2))
        let next = Locator(href: AnyURL(string: "OEBPS/ch2.xhtml")!, mediaType: .xhtml, locations: .init(progression: 0.4))
        try library.saveLocation(first, for: book.id)
        let catalog = root.appendingPathComponent("library.json")
        let committed = root.appendingPathComponent("committed.json")
        try FileManager.default.moveItem(at: catalog, to: committed)
        try FileManager.default.createDirectory(at: catalog, withIntermediateDirectories: false)
        XCTAssertThrowsError(try library.saveLocation(next, for: book.id))
        XCTAssertEqual(try library.location(for: book.id)?.href.string, "OEBPS/ch1.xhtml")
        try FileManager.default.removeItem(at: catalog)
        try FileManager.default.moveItem(at: committed, to: catalog)
        XCTAssertEqual(try LibraryStore(root: root).location(for: book.id)?.href.string, "OEBPS/ch1.xhtml")
        try library.saveLocation(next, for: book.id)
        XCTAssertEqual(try LibraryStore(root: root).location(for: book.id)?.href.string, "OEBPS/ch2.xhtml")
        XCTAssertEqual(library.books.count, 1)
    }
}

extension LibraryTests {
    func testNotesDraftsAtomicFailureRetryAndBookIsolation() async throws {
        let library = try LibraryStore(root: root)
        let a = try await library.importBook(from: fixture("navigation-fixture")).book
        let b = try await library.importBook(from: fixture()).book
        func selected(_ offset: Int) throws -> Locator {
            try XCTUnwrap(Locator(json: JSONValue(jsonString: """
            {"href":"OEBPS/ch2.xhtml","type":"application/xhtml+xml","locations":{"cssSelector":"#c2-p20","domRange":{"start":{"cssSelector":"#c2-p20","textNodeIndex":1,"charOffset":\(offset)},"end":{"cssSelector":"#c2-p20","textNodeIndex":1,"charOffset":\(offset + 4)}}},"text":{"before":"\(offset)","highlight":"same","after":"end"}}
            """, warnings: nil), warnings: nil))
        }
        var note = BookNote(locator: try selected(100), body: "v1")
        let secondOccurrence = BookNote(locator: try selected(200), body: "second occurrence")
        try library.saveNote(note, for: a.id)
        try library.saveNote(secondOccurrence, for: a.id)
        let otherBook = BookNote(locator: try selected(100), body: "other book")
        try library.saveNote(otherBook, for: b.id)
        note.body = "draft"
        try library.saveNote(note, for: a.id, draft: true)
        let before = try LibraryStore(root: root)
        XCTAssertEqual(before.books.first { $0.id == a.id }?.notes?.first?.body, "v1")
        XCTAssertEqual(before.books.first { $0.id == a.id }?.noteDrafts?.first?.body, "draft")
        let staleCommitted = try XCTUnwrap(before.books.first { $0.id == a.id }?.notes?.first)
        try library.saveNote(staleCommitted, for: a.id, highlightOnly: true)
        let repeated = try LibraryStore(root: root)
        XCTAssertEqual(repeated.books.first { $0.id == a.id }?.notes?.first?.body, "v1")
        XCTAssertEqual(repeated.books.first { $0.id == a.id }?.noteDrafts?.first?.body, "draft")
        let catalog = root.appendingPathComponent("library.json"), backup = root.appendingPathComponent("baseline.json")
        try FileManager.default.moveItem(at: catalog, to: backup)
        try FileManager.default.createDirectory(at: catalog, withIntermediateDirectories: false)
        defer {
            try? FileManager.default.removeItem(at: catalog)
            try? FileManager.default.moveItem(at: backup, to: catalog)
        }
        note.body = "v2"
        XCTAssertThrowsError(try library.saveNote(note, for: a.id))
        XCTAssertThrowsError(try library.saveNote(BookNote(locator: selected(300)), for: a.id))
        XCTAssertThrowsError(try library.saveNote(note, for: a.id, draft: true))
        XCTAssertEqual(library.books.first { $0.id == a.id }?.notes?.first?.body, "v1")
        XCTAssertEqual(library.books.first { $0.id == a.id }?.noteDrafts?.first?.body, "draft")
        try FileManager.default.removeItem(at: catalog)
        try FileManager.default.moveItem(at: backup, to: catalog)
        try library.saveNote(note, for: a.id)
        try library.saveNote(note, for: a.id)
        let after = try LibraryStore(root: root)
        let saved = try XCTUnwrap(after.books.first { $0.id == a.id })
        XCTAssertEqual(saved.notes?.map(\.id), [note.id, secondOccurrence.id])
        XCTAssertEqual(saved.notes?.first?.body, "v2")
        XCTAssertTrue(saved.noteDrafts?.isEmpty == true)
        XCTAssertEqual(saved.notes?.first?.locatorJSON, note.locatorJSON)
        XCTAssertNotEqual(try saved.notes?[0].location().locations.domRange, try saved.notes?[1].location().locations.domRange)
        XCTAssertEqual(after.books.first { $0.id == b.id }?.notes?.map(\.body), ["other book"])
        XCTAssertNil(saved.locatorJSON) // Notes never replace daily reading progress.
    }
}

extension LibraryTests {
    private var removalTables: [String] { ["embeddings", "embedding_progress", "fragment_terms", "fragments", "chapters", "preparations", "contents"] }
    private func removalSnapshot(_ name: String, library: LibraryStore) throws {
        var files: [String: String] = [:]
        for name in ["library.json", "reading-questions.json"] {
            files[name] = try String(contentsOf: root.appendingPathComponent(name), encoding: .utf8)
        }
        let attachment = XCTAttachment(data: try JSONSerialization.data(withJSONObject: files, options: [.sortedKeys]), uniformTypeIdentifier: "public.json")
        attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
    }
    private func removalBooks() async throws -> (LibraryStore, Book, Book, BookNote) {
        let library = try LibraryStore(root: root)
        let a = try await library.importBook(from: fixture("semantic-other")).book
        let b = try await library.importBook(from: fixture("search-other")).book
        await library.preparation.waitForCurrentWork()
        let hits = try await library.preparation.index.search(bookID: a.id, query: "盐桥")
        let locator = try XCTUnwrap(hits.first?.locator)
        let note = BookNote(locator: locator, body: "A retained note")
        try library.saveNote(note, for: a.id)
        var draft = note; draft.body = "A retained draft"; try library.saveNote(draft, for: a.id, draft: true)
        try library.saveBookmark(Bookmark(locator: locator), for: a.id)
        try library.saveLocation(locator, for: a.id)
        for book in [a, b] {
            let ownHits = try await library.preparation.index.search(bookID: book.id, query: book.id == a.id ? "盐桥" : "搜索")
            var record = ReadingQuestion(book: book, selection: QuestionEvidence(locator: try XCTUnwrap(ownHits.first?.locator)), neighbors: [])
            record.question = "Removal \(book.id)"; record.answer = "Saved answer"; record.citations = [record.selection]; record.state = .complete
            XCTAssertTrue(library.questions.save(record))
        }
        return (library, a, b, note)
    }
    func testIssue16RemovalRestartRestoreAndDeleteIsolation() async throws {
        let (library, a, b, note) = try await removalBooks()
        let index = root.appendingPathComponent("book-index.sqlite")
        let encoder = JSONEncoder(); encoder.outputFormatting = .sortedKeys
        let bRows = try removalTables.map { try indexRows(index, "SELECT * FROM \($0) WHERE book_id='\(b.id)'") }
        let bBook = try encoder.encode(library.books.first { $0.id == b.id }!)
        let bRecords = try encoder.encode(library.questions.records.filter { $0.bookID == b.id })
        let oldRecord = try XCTUnwrap(library.questions.records.first { $0.bookID == a.id })
        let oldRevision = library.revision(for: a.id)
        try removalSnapshot("issue16-before", library: library)
        try await library.removeBook(a.id)
        XCTAssertFalse(library.sourceAvailable(for: a.id))
        XCTAssertFalse(FileManager.default.fileExists(atPath: library.fileURL(for: a).path))
        for table in removalTables { XCTAssertEqual(try indexRows(index, "SELECT count(*) FROM \(table) WHERE book_id='\(a.id)'")[0][0], "0") }
        let reopened = try LibraryStore(root: root)
        XCTAssertEqual(reopened.books.first { $0.id == a.id }?.notes?.first?.id, note.id)
        XCTAssertEqual(reopened.books.first { $0.id == a.id }?.noteDrafts?.first?.body, "A retained draft")
        XCTAssertEqual(reopened.questions.record(oldRecord.id)?.answer, oldRecord.answer)
        XCTAssertEqual(reopened.questions.record(oldRecord.id)?.citations, oldRecord.citations)
        XCTAssertNil(reopened.questions.followUp(oldRecord.conversation))
        do { _ = try await reopened.open(a); XCTFail("Removed original cannot open") } catch { }
        try removalSnapshot("issue16-removed-restarted", library: reopened)
        let restored = try await library.importBook(from: fixture("semantic-other"))
        XCTAssertEqual(restored.book.id, a.id); XCTAssertTrue(restored.isDuplicate)
        XCTAssertEqual(library.books.first { $0.id == a.id }?.notes?.first?.id, note.id)
        XCTAssertThrowsError(try library.checkRevision(oldRevision, for: a.id))
        await library.preparation.waitForCurrentWork()
        _ = try await library.open(restored.book)
        try await library.removeBook(a.id, deleteRecords: true)
        XCTAssertFalse(library.questions.save(oldRecord))
        let fresh = try await library.importBook(from: fixture("semantic-other")).book
        XCTAssertNotEqual(fresh.recordIdentity, a.recordIdentity)
        XCTAssertFalse(library.questions.save(oldRecord), "Old result cannot resurrect even after identical-file import")
        XCTAssertNil(library.books.first { $0.id == a.id }?.notes)
        await library.preparation.waitForCurrentWork()
        try await library.removeBook(a.id, deleteRecords: true)
        let deleted = try LibraryStore(root: root)
        XCTAssertNil(deleted.books.first { $0.id == a.id }); XCTAssertNil(deleted.questions.record(oldRecord.id))
        XCTAssertEqual(try encoder.encode(deleted.books.first { $0.id == b.id }!), bBook)
        XCTAssertEqual(try encoder.encode(deleted.questions.records.filter { $0.bookID == b.id }), bRecords)
        XCTAssertEqual(try removalTables.map { try indexRows(index, "SELECT * FROM \($0) WHERE book_id='\(b.id)'") }, bRows)
        try removalSnapshot("issue16-deleted-restarted-other-book-intact", library: deleted)
    }
    func testIssue16RealFailuresRetryAndStartupRecovery() async throws {
        let (library, a, b, _) = try await removalBooks()
        let fm = FileManager.default, catalog = root.appendingPathComponent("library.json"), backup = root.appendingPathComponent("catalog-before.json")
        try fm.moveItem(at: catalog, to: backup); try fm.createDirectory(at: catalog, withIntermediateDirectories: false)
        do { try await library.removeBook(a.id); XCTFail("Actual catalog write must fail") } catch { }
        XCTAssertTrue(library.sourceAvailable(for: a.id))
        try fm.removeItem(at: catalog); try fm.moveItem(at: backup, to: catalog)
        let index = root.appendingPathComponent("book-index.sqlite")
        try indexExecute(index, "CREATE TRIGGER removal_fault BEFORE DELETE ON chapters WHEN old.book_id='\(a.id)' BEGIN SELECT RAISE(ABORT,'actual-delete-failure'); END")
        let aRows = try removalTables.map { try indexRows(index, "SELECT * FROM \($0) WHERE book_id='\(a.id)'") }
        do { try await library.removeBook(a.id); XCTFail("Actual SQLite delete must fail") } catch { }
        XCTAssertEqual(library.books.first { $0.id == a.id }?.removal, .removing)
        XCTAssertEqual(try removalTables.map { try indexRows(index, "SELECT * FROM \($0) WHERE book_id='\(a.id)'") }, aRows)
        do { _ = try await library.importBook(from: fixture("semantic-other")); XCTFail("Pending removal cannot reimport") } catch { }
        try removalSnapshot("issue16-sqlite-rollback-pending", library: library)
        try indexExecute(index, "DROP TRIGGER removal_fault")
        let restarted = try LibraryStore(root: root); await restarted.recoverRemovals()
        XCTAssertEqual(restarted.books.first { $0.id == a.id }?.removal, .removed)
        let path = root.appendingPathComponent("reading-questions.json"), before = root.appendingPathComponent("questions-before.json")
        try fm.moveItem(at: path, to: before); try fm.createDirectory(at: path, withIntermediateDirectories: false)
        do { try await restarted.removeBook(a.id, deleteRecords: true); XCTFail("Actual questions write must fail") } catch { }
        XCTAssertEqual(restarted.books.first { $0.id == a.id }?.removal, .deleting)
        XCTAssertTrue(restarted.questions.records.contains { $0.bookID == a.id })
        try fm.removeItem(at: path); try fm.moveItem(at: before, to: path)
        let recovered = try LibraryStore(root: root); await recovered.recoverRemovals()
        XCTAssertNil(recovered.books.first { $0.id == a.id }); XCTAssertFalse(recovered.questions.records.contains { $0.bookID == a.id })
        XCTAssertTrue(recovered.sourceAvailable(for: b.id))
        try removalSnapshot("issue16-real-failures-recovered", library: recovered)
    }
    func testIssue16PreparationCancellationAndSameTitleDistinctBytes() async throws {
        let library = try LibraryStore(root: root)
        let book = try await library.importBook(from: fixture("search-long")).book
        let revision = library.revision(for: book.id)
        for _ in 0..<500 where (library.preparation.states[book.id]?.completed ?? 0) == 0 { try await Task.sleep(nanoseconds: 10_000_000) }
        XCTAssertGreaterThan(library.preparation.states[book.id]?.completed ?? 0, 0)
        try await library.removeBook(book.id, deleteRecords: true)
        await library.preparation.waitForCurrentWork()
        XCTAssertNil(library.preparation.states[book.id])
        let index = root.appendingPathComponent("book-index.sqlite")
        if FileManager.default.fileExists(atPath: index.path) {
            for table in removalTables { XCTAssertEqual(try indexRows(index, "SELECT count(*) FROM \(table) WHERE book_id='\(book.id)'")[0][0], "0") }
        }
        let a = try await library.importBook(from: fixture("semantic-other")).book
        let otherBytes = root.appendingPathComponent("same-title.epub")
        var data = try Data(contentsOf: fixture("semantic-other")); data.append(contentsOf: [32, 32])
        try data.write(to: otherBytes)
        let c = try await library.importBook(from: otherBytes).book
        XCTAssertEqual(a.title, c.title); XCTAssertNotEqual(a.id, c.id)
        XCTAssertThrowsError(try library.checkRevision(revision, for: book.id))
        await library.preparation.waitForCurrentWork()
        var question = ReadingQuestion(book: a, origin: Locator(href: AnyURL(string: "chapter.xhtml")!, mediaType: .xhtml))
        question.question = "Missing source zero HTTP"
        XCTAssertTrue(library.questions.save(question))
        try FileManager.default.removeItem(at: library.fileURL(for: a))
        library.questions.send(question.id, library: library, local: true)
        XCTAssertEqual(library.questions.record(question.id)?.state, .draft)
        XCTAssertEqual(library.questions.record(question.id)?.failure, LibraryError.missing.errorDescription)
        try removalSnapshot("issue16-preparation-and-distinct-same-title", library: library)
    }
}

extension LibraryTests {
    func testIssue16DelayedHTTPRemovalDeleteAndOtherBookCompletion() async throws {
        let secrets = KeychainSecrets(service: "dev.shudeng.tests.removal." + UUID().uuidString)
        defer { for id in (try? secrets.accounts()) ?? [] { try? secrets.remove(id) } }
        let library = try LibraryStore(root: root, secrets: secrets)
        let a = try await library.importBook(from: fixture("semantic-other")).book
        let b = try await library.importBook(from: fixture("search-other")).book
        await library.preparation.waitForCurrentWork()
        let configurations = try AIConfigurationStore(root: root, secrets: secrets)
        let configuration = AIConfiguration(name: "Issue16 controlled", format: .openAI, address: "http://127.0.0.1:18776/v1", model: "slow")
        try configurations.save(configuration, newKey: "not-a-real-credential"); try configurations.select(configuration.id)
        func record(_ book: Book, marker: String) throws -> ReadingQuestion {
            let json = try indexRows(root.appendingPathComponent("book-index.sqlite"), "SELECT locator FROM fragments WHERE book_id='\(book.id)' LIMIT 1")[0][0]
            let locator = try XCTUnwrap(Locator(json: JSONValue(jsonString: json, warnings: nil), warnings: nil))
            var result = ReadingQuestion(book: book, selection: QuestionEvidence(locator: locator), neighbors: [])
            result.question = marker; return result
        }
        let first = try record(a, marker: "REMOVE16-A-retain"), other = try record(b, marker: "REMOVE16-B-survives")
        XCTAssertTrue(library.questions.save(first)); XCTAssertTrue(library.questions.save(other))
        library.questions.send(first.id, library: library, local: true)
        library.questions.send(other.id, library: library, local: true)
        for _ in 0..<100 where library.questions.record(first.id)?.state != .generating { try await Task.sleep(nanoseconds: 20_000_000) }
        XCTAssertEqual(library.questions.record(first.id)?.state, .generating)
        try await Task.sleep(nanoseconds: 250_000_000)
        try await library.removeBook(a.id)
        try await Task.sleep(nanoseconds: 3_000_000_000)
        XCTAssertEqual(library.questions.record(first.id)?.state, .incomplete)
        XCTAssertTrue(library.questions.record(first.id)?.answer.isEmpty == true)
        XCTAssertEqual(library.questions.record(other.id)?.state, .complete)
        XCTAssertTrue(library.questions.record(other.id)?.answer.contains("REMOVE16-B-survives") == true)
        XCTAssertEqual(QuestionStore(root: root, secrets: secrets).record(first.id)?.state, .incomplete)
        try removalSnapshot("issue16-delayed-retain-and-other-complete", library: library)
        let restored = try await library.importBook(from: fixture("semantic-other")).book
        await library.preparation.waitForCurrentWork()
        let deleting = try record(restored, marker: "REMOVE16-A-delete")
        XCTAssertTrue(library.questions.save(deleting)); library.questions.send(deleting.id, library: library, local: true)
        for _ in 0..<100 where library.questions.record(deleting.id)?.state != .generating { try await Task.sleep(nanoseconds: 20_000_000) }
        XCTAssertEqual(library.questions.record(deleting.id)?.state, .generating)
        try await Task.sleep(nanoseconds: 250_000_000)
        try await library.removeBook(a.id, deleteRecords: true)
        _ = try await library.importBook(from: fixture("semantic-other"))
        await library.preparation.waitForCurrentWork()
        try await Task.sleep(nanoseconds: 3_000_000_000)
        XCTAssertNil(library.questions.record(deleting.id)); XCTAssertFalse(library.questions.save(deleting))
        XCTAssertNil(QuestionStore(root: root, secrets: secrets).record(first.id))
        XCTAssertEqual(library.questions.record(other.id)?.state, .complete)
        try removalSnapshot("issue16-delayed-delete-reimport-no-resurrection", library: library)
    }
}

extension LibraryTests {
    func testIssue16OldBookmarkCaptureRejectedAfterSameFileReimport() async throws {
        let (library, a, _, note) = try await removalBooks()
        let revision = library.revision(for: a.id)
        var continuation: CheckedContinuation<Bookmark, Never>?
        let capture = Task { @MainActor in
            let bookmark = await withCheckedContinuation { continuation = $0 }
            try library.checkRevision(revision, for: a.id)
            try library.saveBookmark(bookmark, for: a.id)
        }
        while continuation == nil { await Task.yield() }
        try await library.removeBook(a.id, deleteRecords: true)
        _ = try await library.importBook(from: fixture("semantic-other"))
        continuation?.resume(returning: Bookmark(locator: try note.location()))
        do { try await capture.value; XCTFail("Old asynchronous capture must be rejected") } catch { }
        XCTAssertNil(library.books.first { $0.id == a.id }?.bookmarks)
        await library.preparation.waitForCurrentWork()
        XCTAssertNil(try LibraryStore(root: root).books.first { $0.id == a.id }?.bookmarks)
        try removalSnapshot("issue16-old-bookmark-callback-rejected", library: library)
    }
}

extension LibraryTests {
    func testIssue16RealFileRemovalFailureAndVectorWorkCancellation() async throws {
        let (library, a, b, _) = try await removalBooks()
        let fm = FileManager.default, files = root.appendingPathComponent("Books")
        try fm.setAttributes([.posixPermissions: 0o555], ofItemAtPath: files.path)
        defer { try? fm.setAttributes([.posixPermissions: 0o755], ofItemAtPath: files.path) }
        do { try await library.removeBook(a.id); XCTFail("Read-only Books directory must reject file deletion") } catch { }
        XCTAssertTrue(fm.fileExists(atPath: library.fileURL(for: a).path))
        XCTAssertEqual(library.books.first { $0.id == a.id }?.removal, .removing)
        try fm.setAttributes([.posixPermissions: 0o755], ofItemAtPath: files.path)
        try await library.removeBook(a.id)
        XCTAssertFalse(fm.fileExists(atPath: library.fileURL(for: a).path))
        XCTAssertTrue(library.sourceAvailable(for: b.id))
        let long = try await library.importBook(from: fixture("original-fixture")).book
        for _ in 0..<2000 {
            let state = library.preparation.states[long.id] ?? BookPreparationState()
            if state.vectorsCompleted > 0 && !state.semanticReady { break }
            try await Task.sleep(nanoseconds: 10_000_000)
        }
        let before = try XCTUnwrap(library.preparation.states[long.id])
        XCTAssertGreaterThan(before.vectorsCompleted, 0); XCTAssertFalse(before.semanticReady)
        let state = XCTAttachment(string: "Actual vector progress before removal: \(before.vectorsCompleted)/\(before.vectorsTotal), chapters \(before.completed)/\(before.total)")
        state.name = "issue16-in-flight-vector-work"; state.lifetime = .keepAlways; add(state)
        try await library.removeBook(long.id, deleteRecords: true)
        await library.preparation.waitForCurrentWork()
        try await Task.sleep(nanoseconds: 100_000_000)
        XCTAssertNil(library.preparation.states[long.id])
        for table in removalTables { XCTAssertEqual(try indexRows(root.appendingPathComponent("book-index.sqlite"), "SELECT count(*) FROM \(table) WHERE book_id='\(long.id)'")[0][0], "0") }
        try removalSnapshot("issue16-file-retry-and-vector-cancellation", library: library)
    }
}
