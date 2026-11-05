import Foundation

/// One process-local platform I/O owner, shared by Expo functions and WK views.
/// Callers cannot select roots, cache paths or decompression budgets.
public final class EpubResourceStore: @unchecked Sendable {
    public static let shared = EpubResourceStore()
    public let archives: EpubArchives
    public let budget = EpubArchiveBudget(
        maxEntries: 20_000, maxResourceBytes: 64 * 1024 * 1024,
        maxLiveBytes: 128 * 1024 * 1024, maxInflateSeconds: 30, maxMetadataBytes: 8 * 1024 * 1024
    )

    private init() {
        let manager = FileManager.default
        archives = EpubArchives(
            allowedRoots: [manager.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("Books", isDirectory: true)],
            temporaryRoot: manager.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("EpubResources", isDirectory: true),
            cleanupOnFirstOpen: true
        )
    }

    public func open(_ uri: String) async throws -> EpubArchiveDescriptor {
        guard let url = URL(string: uri), url.isFileURL else { throw EpubArchiveError.outsideAllowedRoots }
        return try await archives.open(url, budget: budget)
    }
}

extension EpubArchiveDescriptor {
    var bridgeValue: [String: Any] {
        ["sessionID": sessionID, "resourceBaseURL": "shudeng-epub://reader/" + sessionID + "/",
         "entries": entries.map { ["path": $0.path, "resourceID": $0.resourceID, "size": $0.size] }]
    }
}

extension EpubResourceLease {
    var bridgeValue: [String: Any] {
        ["sessionID": sessionID, "leaseID": leaseID, "uri": fileURL.absoluteString, "bytes": bytes]
    }
}
