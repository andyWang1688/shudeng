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
