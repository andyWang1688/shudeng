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
