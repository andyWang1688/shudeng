import XCTest
import EpubFilePort

#if canImport(WebKit)
final class EpubResourceSchemeTests: XCTestCase {
    @MainActor
    func testConcurrentCloseJoinsCleanupAndHandlerCannotReopen() async throws {
        let fixture = URL(fileURLWithPath: ProcessInfo.processInfo.environment["SHUDENG_FIXTURE_ROOT"]!)
        let temporary = URL(fileURLWithPath: ProcessInfo.processInfo.environment["SHUDENG_TEST_TEMP"]!).appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: temporary) }
        let files = EpubArchives(allowedRoots: [fixture], temporaryRoot: temporary)
        let budget = EpubArchiveBudget(maxEntries: 1000, maxResourceBytes: 1024 * 1024, maxLiveBytes: 2 * 1024 * 1024, maxInflateSeconds: 10)
        let book = try await files.open(fixture.appendingPathComponent("search-fixture.epub"), budget: budget)
        let lease = try await files.materialize(sessionID: book.sessionID, resourceID: book.entries[0].resourceID)
        let handler = EpubResourceScheme(archives: files)
        handler.activate(book.sessionID)
        let first = Task {
            await handler.close()
            XCTAssertFalse(FileManager.default.fileExists(atPath: lease.fileURL.path))
        }
        let second = Task {
            await handler.close()
            XCTAssertFalse(FileManager.default.fileExists(atPath: lease.fileURL.path))
        }
        await first.value
        await second.value
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: temporary.path), [])

        // A disposed handler cannot adopt a newly opened consumer's session.
        let next = try await files.open(fixture.appendingPathComponent("search-fixture.epub"), budget: budget)
        handler.activate(next.sessionID)
        await handler.close()
        let nextLease = try await files.materialize(sessionID: next.sessionID, resourceID: next.entries[0].resourceID)
        XCTAssertTrue(FileManager.default.fileExists(atPath: nextLease.fileURL.path))
        await files.close(next.sessionID)
    }
}
#endif
