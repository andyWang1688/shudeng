import XCTest
import EpubFilePort
import ReadiumZIPFoundation

final class EpubArchiveTests: XCTestCase {
    let fixtureRoot = URL(fileURLWithPath: ProcessInfo.processInfo.environment["SHUDENG_FIXTURE_ROOT"]!)
    var temporary: URL!
    override func setUpWithError() throws {
        temporary = URL(fileURLWithPath: ProcessInfo.processInfo.environment["SHUDENG_TEST_TEMP"]!).appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: temporary, withIntermediateDirectories: true)
    }
    override func tearDownWithError() throws { try FileManager.default.removeItem(at: temporary) }
    func budget(resource: UInt64 = 32 * 1024 * 1024, live: UInt64 = 64 * 1024 * 1024) -> EpubArchiveBudget {
        .init(maxEntries: 10000, maxResourceBytes: resource, maxLiveBytes: live, maxInflateSeconds: 10)
    }
    func testReadsOneResourceAndReleasesTemporaryLease() async throws {
        let files = EpubArchives(allowedRoots: [fixtureRoot], temporaryRoot: temporary)
        let book = try await files.open(fixtureRoot.appendingPathComponent("search-fixture.epub"), budget: budget())
        let container = book.entries.first { $0.path == "META-INF/container.xml" }!
        let text = try await files.readText(sessionID: book.sessionID, resourceID: container.resourceID)
        XCTAssertTrue(text.contains("rootfile"))
        let bytes = await files.liveBytes(book.sessionID); XCTAssertEqual(bytes, 0)
        let lease = try await files.materialize(sessionID: book.sessionID, resourceID: container.resourceID)
        XCTAssertTrue(FileManager.default.fileExists(atPath: lease.fileURL.path))
        await files.release(lease)
        XCTAssertFalse(FileManager.default.fileExists(atPath: lease.fileURL.path))
        await files.close(book.sessionID)
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: temporary.path), [])
    }
    func testLiveBudgetIsReleasedBetweenReadsRatherThanCumulativeBookLimit() async throws {
        let files = EpubArchives(allowedRoots: [fixtureRoot], temporaryRoot: temporary)
        let book = try await files.open(fixtureRoot.appendingPathComponent("search-fixture.epub"), budget: budget(resource: 1000, live: 300))
        let container = book.entries.first { $0.path == "META-INF/container.xml" }!
        let first = try await files.materialize(sessionID: book.sessionID, resourceID: container.resourceID)
        do { _ = try await files.materialize(sessionID: book.sessionID, resourceID: container.resourceID); XCTFail() }
        catch { XCTAssertEqual(error as? EpubArchiveError, .sizeBudget) }
        await files.release(first)
        _ = try await files.readText(sessionID: book.sessionID, resourceID: container.resourceID)
        await files.close(book.sessionID)
    }
    func testPathsNeverEscapeAndClosedSessionsCannotRead() async throws {
        for path in ["../chapter", "a/../../chapter", "/absolute", "a\\b", "a//b", "file:x", "a/./b", "a\0b"] {
            XCTAssertThrowsError(try EpubArchives.validatePath(path), path)
        }
        try EpubArchives.validatePath("OPS/正文/章 1.xhtml")
        let files = EpubArchives(allowedRoots: [fixtureRoot], temporaryRoot: temporary)
        do { _ = try await files.open(URL(fileURLWithPath: "/etc/passwd"), budget: budget()); XCTFail() }
        catch { XCTAssertEqual(error as? EpubArchiveError, .outsideAllowedRoots) }
        let book = try await files.open(fixtureRoot.appendingPathComponent("search-fixture.epub"), budget: budget())
        await files.close(book.sessionID)
        do { _ = try await files.materialize(sessionID: book.sessionID, resourceID: book.entries[0].resourceID); XCTFail() }
        catch { XCTAssertEqual(error as? EpubArchiveError, .closed) }
    }

    func generatedArchive(path: String = "OPS/chapter.xhtml", bytes: Int64 = 18 * 1024 * 1024) async throws -> URL {
        let url = temporary.appendingPathComponent(UUID().uuidString + ".epub")
        let archive = try await Archive(url: url, accessMode: .create)
        try await archive.addEntry(with: path, type: .file, uncompressedSize: bytes, compressionMethod: .deflate, bufferSize: 64 * 1024) { _, length in Data(repeating: 97, count: length) }
        return url
    }

    func testChapterBeyondOld16MiBAndTotalBeyond128MiBDoNotAccumulate() async throws {
        let source = try await generatedArchive()
        let files = EpubArchives(allowedRoots: [temporary], temporaryRoot: temporary.appendingPathComponent("leases"))
        let book = try await files.open(source, budget: budget(resource: 24 * 1024 * 1024, live: 24 * 1024 * 1024))
        for _ in 0..<8 {
            let lease = try await files.materialize(sessionID: book.sessionID, resourceID: book.entries[0].resourceID)
            XCTAssertEqual(lease.bytes, 18 * 1024 * 1024)
            await files.release(lease)
            let bytes = await files.liveBytes(book.sessionID); XCTAssertEqual(bytes, 0)
        }
        await files.close(book.sessionID)
    }

    func testActualInflationBudgetRejectsForgedCentralSizeAndCleansOutput() async throws {
        let source = try await generatedArchive(bytes: 2 * 1024 * 1024)
        // Mutate metadata in a test only. ZIP decoding remains exclusively in the library.
        var bytes = try Data(contentsOf: source)
        let marker = Data([0x50, 0x4b, 0x01, 0x02])
        let central = bytes.range(of: marker)!.lowerBound
        bytes.replaceSubrange((central + 24)..<(central + 28), with: [1, 0, 0, 0])
        try bytes.write(to: source)
        let root = temporary.appendingPathComponent("leases")
        let files = EpubArchives(allowedRoots: [temporary], temporaryRoot: root)
        let book = try await files.open(source, budget: budget(resource: 128 * 1024, live: 128 * 1024))
        XCTAssertEqual(book.entries[0].size, 1)
        do { _ = try await files.materialize(sessionID: book.sessionID, resourceID: book.entries[0].resourceID); XCTFail() }
        catch { XCTAssertEqual(error as? EpubArchiveError, .sizeBudget) }
        let live = await files.liveBytes(book.sessionID); XCTAssertEqual(live, 0)
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: root.appendingPathComponent(book.sessionID).path), [])
        await files.close(book.sessionID)
    }

    func testCancellationAndCloseJoinInflationAndRemoveTemporaryFiles() async throws {
        let source = try await generatedArchive(bytes: 48 * 1024 * 1024)
        let root = temporary.appendingPathComponent("leases")
        let files = EpubArchives(allowedRoots: [temporary], temporaryRoot: root)
        let book = try await files.open(source, budget: budget(resource: 64 * 1024 * 1024, live: 64 * 1024 * 1024))
        let job = Task { try await files.materialize(sessionID: book.sessionID, resourceID: book.entries[0].resourceID) }
        try await Task.sleep(nanoseconds: 1_000_000)
        job.cancel()
        do { _ = try await job.value; XCTFail() } catch is CancellationError {}
        let live = await files.liveBytes(book.sessionID); XCTAssertEqual(live, 0)
        let next = Task { try await files.materialize(sessionID: book.sessionID, resourceID: book.entries[0].resourceID) }
        try await Task.sleep(nanoseconds: 1_000_000)
        await files.close(book.sessionID)
        do { _ = try await next.value; XCTFail() } catch {}
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: root.path), [])
    }

    func testDuplicatePathsTraversalAndMetadataBudgetAreRejected() async throws {
        let files = EpubArchives(allowedRoots: [temporary], temporaryRoot: temporary.appendingPathComponent("leases"))
        let traversal = try await generatedArchive(path: "../outside", bytes: 1)
        do { _ = try await files.open(traversal, budget: budget()); XCTFail() }
        catch { XCTAssertEqual(error as? EpubArchiveError, .invalidPath) }
        let source = try await generatedArchive(bytes: 1)
        var limited = budget(); limited.maxMetadataBytes = 16
        do { _ = try await files.open(source, budget: limited); XCTFail() }
        catch { XCTAssertEqual(error as? EpubArchiveError, .sizeBudget) }
        let archive = try await Archive(url: source, accessMode: .update)
        try await archive.addEntry(with: "OPS/chapter.xhtml", type: .file, uncompressedSize: 1) { _, _ in Data([97]) }
        do { _ = try await files.open(source, budget: budget()); XCTFail() }
        catch { XCTAssertEqual(error as? EpubArchiveError, .duplicatePath) }
    }

    func testCRCMismatchCannotPublishALease() async throws {
        let source = try await generatedArchive(bytes: 2 * 1024 * 1024)
        var bytes = try Data(contentsOf: source)
        let central = bytes.range(of: Data([0x50, 0x4b, 0x01, 0x02]))!.lowerBound
        bytes.replaceSubrange((central + 16)..<(central + 20), with: [0, 0, 0, 0])
        try bytes.write(to: source)
        let files = EpubArchives(allowedRoots: [temporary], temporaryRoot: temporary.appendingPathComponent("leases"))
        let book = try await files.open(source, budget: budget())
        do { _ = try await files.materialize(sessionID: book.sessionID, resourceID: book.entries[0].resourceID); XCTFail() }
        catch { XCTAssertEqual(error as? EpubArchiveError, .corruptResource) }
        let live = await files.liveBytes(book.sessionID); XCTAssertEqual(live, 0)
        await files.close(book.sessionID)
    }

    func testArchiveAbove100MiBOnlyInflatesTheRequestedResource() async throws {
        let source = temporary.appendingPathComponent("large.epub")
        let archive = try await Archive(url: source, accessMode: .create)
        try await archive.addEntry(with: "unread-large-image.dat", type: .file, uncompressedSize: 101 * 1024 * 1024, compressionMethod: .none, bufferSize: 64 * 1024) { _, length in Data(repeating: 97, count: length) }
        try await archive.addEntry(with: "META-INF/container.xml", type: .file, uncompressedSize: 11) { _, _ in Data("<rootfile/>".utf8) }
        let fileBytes = try FileManager.default.attributesOfItem(atPath: source.path)[.size] as! NSNumber
        XCTAssertGreaterThan(fileBytes.uint64Value, 100 * 1024 * 1024)
        let files = EpubArchives(allowedRoots: [temporary], temporaryRoot: temporary.appendingPathComponent("leases"))
        let book = try await files.open(source, budget: budget(resource: 1024, live: 1024))
        let resource = book.entries.first { $0.path == "META-INF/container.xml" }!
        let text = try await files.readText(sessionID: book.sessionID, resourceID: resource.resourceID)
        XCTAssertEqual(text, "<rootfile/>")
        await files.close(book.sessionID)
    }

    func testFreshProcessCleansOnlyOwnedStaleSessionsAndKeepsSource() async throws {
        let source = try await generatedArchive(bytes: 1)
        let cache = temporary.appendingPathComponent("leases")
        let stale = cache.appendingPathComponent(UUID().uuidString)
        let unknown = cache.appendingPathComponent("unknown-user-file")
        try FileManager.default.createDirectory(at: stale, withIntermediateDirectories: true)
        try Data([97]).write(to: stale.appendingPathComponent("partial"))
        try Data([98]).write(to: unknown)
        let files = EpubArchives(allowedRoots: [temporary], temporaryRoot: cache, cleanupOnFirstOpen: true)
        let book = try await files.open(source, budget: budget())
        XCTAssertFalse(FileManager.default.fileExists(atPath: stale.path))
        XCTAssertEqual(try Data(contentsOf: unknown), Data([98]))
        await files.close(book.sessionID)
        XCTAssertTrue(FileManager.default.fileExists(atPath: source.path))
    }

    func testArchiveSymlinkCannotEscapeAllowedRoots() async throws {
        let link = temporary.appendingPathComponent("external.epub")
        try FileManager.default.createSymbolicLink(at: link, withDestinationURL: fixtureRoot.appendingPathComponent("search-fixture.epub"))
        let files = EpubArchives(allowedRoots: [temporary], temporaryRoot: temporary.appendingPathComponent("leases"))
        do { _ = try await files.open(link, budget: budget()); XCTFail() }
        catch { XCTAssertEqual(error as? EpubArchiveError, .outsideAllowedRoots) }
    }
}
