import XCTest
import ReadiumShared
@testable import Shudeng

@MainActor
final class LibraryTests: XCTestCase {
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
