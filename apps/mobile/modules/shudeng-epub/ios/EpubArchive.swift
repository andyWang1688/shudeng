import Foundation
import ReadiumZIPFoundation

public enum EpubArchiveError: Error, Equatable, LocalizedError {
    case outsideAllowedRoots, invalidPath, duplicatePath, symlink, tooManyEntries
    case closed, missingResource, sizeBudget, timeBudget, corruptResource
    public var errorDescription: String? {
        switch self {
        case .outsideAllowedRoots: return "无法访问这本书的文件，请重新导入"
        case .invalidPath, .duplicatePath, .symlink: return "这本 EPUB 的文件目录无效，无法读取"
        case .tooManyEntries: return "这本 EPUB 包含的文件过多，当前设备无法读取"
        case .closed: return "EPUB 读取已关闭"
        case .missingResource: return "这本 EPUB 缺少所需文件，请重新导入"
        case .sizeBudget: return "这本 EPUB 中的文件过大，当前设备无法读取"
        case .timeBudget: return "读取 EPUB 内容耗时过长，请重试"
        case .corruptResource: return "这本 EPUB 的内容已损坏，请重新导入"
        }
    }
}

/// Operational budgets apply to live resources, never the compressed publication size
/// or all previously processed chapters. Values must be chosen from device evidence.
public struct EpubArchiveBudget: Sendable {
    public var maxEntries: Int
    public var maxResourceBytes: UInt64
    public var maxLiveBytes: UInt64
    public var maxInflateSeconds: TimeInterval
    public var maxMetadataBytes: UInt64
    public init(maxEntries: Int, maxResourceBytes: UInt64, maxLiveBytes: UInt64, maxInflateSeconds: TimeInterval, maxMetadataBytes: UInt64 = 8 * 1024 * 1024) {
        self.maxEntries = maxEntries; self.maxResourceBytes = maxResourceBytes
        self.maxLiveBytes = maxLiveBytes; self.maxInflateSeconds = maxInflateSeconds
        self.maxMetadataBytes = maxMetadataBytes
    }
}

public struct EpubArchiveEntry: Sendable {
    public let path: String
    public let resourceID: String
    public let size: UInt64
}

public struct EpubArchiveDescriptor: Sendable {
    public let sessionID: String
    public let entries: [EpubArchiveEntry]
}

public struct EpubResourceLease: Sendable {
    public let sessionID: String
    public let leaseID: String
    public let fileURL: URL
    public let bytes: UInt64
}

private actor LiveBytes {
    private var total: UInt64 = 0
    let limit: UInt64
    init(_ limit: UInt64) { self.limit = limit }
    func reserve(_ bytes: UInt64) throws {
        guard bytes <= limit, total <= limit - bytes else { throw EpubArchiveError.sizeBudget }
        total += bytes
    }
    func release(_ bytes: UInt64) { total -= min(total, bytes) }
    func count() -> UInt64 { total }
}

private struct ArchiveSession {
    let archive: Archive
    let source: BoundedFileSource
    let directory: URL
    let budget: EpubArchiveBudget
    let quota: LiveBytes
    let descriptors: [EpubArchiveEntry]
    let resources: [String: Entry]
    var jobs: [String: Task<EpubResourceLease, Error>] = [:]
    var leases: [String: EpubResourceLease] = [:]
}

/// File/ZIP I/O only: no publication, locator, indexing or application business logic.
/// Each extraction has its own ZIP read transaction; ZIPFoundation closes its FILE
/// handles when transactions die. close() cancels and joins jobs before deleting files.
public actor EpubArchives {
    private let roots: [URL]
    private let temporaryRoot: URL
    private var sessions: [String: ArchiveSession] = [:]
    private var closing: [String: Task<Void, Never>] = [:]
    private let cleanupOnFirstOpen: Bool
    private var prepared = false

    public init(allowedRoots: [URL], temporaryRoot: URL, cleanupOnFirstOpen: Bool = false) {
        roots = allowedRoots.map { $0.standardizedFileURL.resolvingSymlinksInPath() }
        self.temporaryRoot = temporaryRoot.standardizedFileURL
        self.cleanupOnFirstOpen = cleanupOnFirstOpen
    }

    public static func validatePath(_ path: String) throws {
        guard !path.isEmpty, !path.hasPrefix("/"), !path.contains("\\"),
              !path.contains("\0"), !path.contains(":"),
              !path.split(separator: "/", omittingEmptySubsequences: false).contains(where: { $0.isEmpty || $0 == "." || $0 == ".." })
        else { throw EpubArchiveError.invalidPath }
    }

    public func open(_ fileURL: URL, budget: EpubArchiveBudget) async throws -> EpubArchiveDescriptor {
        try Task.checkCancellation()
        try prepareTemporaryRoot()
        let source = fileURL.standardizedFileURL.resolvingSymlinksInPath()
        guard source.isFileURL, roots.contains(where: { source.path.hasPrefix($0.path + "/") }),
              budget.maxEntries > 0, budget.maxResourceBytes > 0, budget.maxLiveBytes > 0,
              budget.maxInflateSeconds > 0 else { throw EpubArchiveError.outsideAllowedRoots }
        let input = try BoundedFileSource(source, metadataLimit: budget.maxMetadataBytes)
        let archive: Archive
        let entries: [Entry]
        do {
            archive = try await Archive(url: nil, dataSource: input, defaultReadChunkSize: 64 * 1024)
            entries = try await archive.entries()
            await input.finishMetadata()
        } catch { await input.close(); throw error }
        do {
        try Task.checkCancellation()
        guard entries.count <= budget.maxEntries else { throw EpubArchiveError.tooManyEntries }
        var resources: [String: Entry] = [:]
        var descriptors: [EpubArchiveEntry] = []
        var paths = Set<String>()
        for entry in entries {
            try Task.checkCancellation()
            // Directories cannot materialize. Validate their path too; symlinks are never followed.
            let path = entry.type == .directory && entry.path.hasSuffix("/") ? String(entry.path.dropLast()) : entry.path
            try Self.validatePath(path)
            guard paths.insert(path).inserted else { throw EpubArchiveError.duplicatePath }
            if entry.type == .directory { continue }
            guard entry.type == .file else { throw EpubArchiveError.symlink }
            guard entry.uncompressedSize <= 9_007_199_254_740_991 else { throw EpubArchiveError.sizeBudget }
            let resourceID = UUID().uuidString.lowercased()
            resources[resourceID] = entry
            descriptors.append(.init(path: path, resourceID: resourceID, size: entry.uncompressedSize))
        }
        let id = UUID().uuidString.lowercased()
        let directory = temporaryRoot.appendingPathComponent(id, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        sessions[id] = ArchiveSession(archive: archive, source: input, directory: directory, budget: budget,
                                     quota: LiveBytes(budget.maxLiveBytes), descriptors: descriptors, resources: resources)
        return .init(sessionID: id, entries: descriptors)
        } catch { await input.close(); throw error }
    }

    /// IDs are opaque; no archive path ever becomes a filesystem destination or URL path.
    public func materialize(sessionID: String, resourceID: String) async throws -> EpubResourceLease {
        guard let session = sessions[sessionID] else { throw EpubArchiveError.closed }
        guard let entry = session.resources[resourceID] else { throw EpubArchiveError.missingResource }
        let leaseID = UUID().uuidString.lowercased()
        let destination = session.directory.appendingPathComponent(leaseID)
        let job = Task {
            try Task.checkCancellation()
            // The declared size is only a cheap preflight; the sink counts actual inflated bytes.
            guard entry.uncompressedSize <= session.budget.maxResourceBytes else { throw EpubArchiveError.sizeBudget }
            guard FileManager.default.createFile(atPath: destination.path, contents: nil) else { throw CocoaError(.fileWriteUnknown) }
            let writer: FileHandle
            do { writer = try FileHandle(forWritingTo: destination) }
            catch { try? FileManager.default.removeItem(at: destination); throw error }
            let sink = ResourceSink(writer: writer, quota: session.quota, budget: session.budget)
            do {
                let checksum = try await session.archive.extract(entry, bufferSize: 64 * 1024, skipCRC32: false) { chunk in
                    try await sink.write(chunk)
                }
                let bytes = await sink.count()
                try Task.checkCancellation()
                guard bytes == entry.uncompressedSize, checksum == entry.checksum else { throw EpubArchiveError.corruptResource }
                try writer.close()
                return EpubResourceLease(sessionID: sessionID, leaseID: leaseID, fileURL: destination, bytes: bytes)
            } catch {
                try? writer.close()
                await session.quota.release(await sink.count())
                try? FileManager.default.removeItem(at: destination)
                throw error
            }
        }
        sessions[sessionID]?.jobs[leaseID] = job
        do {
            let lease = try await withTaskCancellationHandler(operation: { try await job.value }, onCancel: { job.cancel() })
            sessions[sessionID]?.jobs.removeValue(forKey: leaseID)
            if Task.isCancelled {
                try? FileManager.default.removeItem(at: destination)
                await session.quota.release(lease.bytes)
                throw CancellationError()
            }
            guard sessions[sessionID] != nil else {
                try? FileManager.default.removeItem(at: destination)
                throw EpubArchiveError.closed
            }
            sessions[sessionID]?.leases[leaseID] = lease
            return lease
        } catch {
            sessions[sessionID]?.jobs.removeValue(forKey: leaseID)
            throw error
        }
    }

    public func readText(sessionID: String, resourceID: String) async throws -> String {
        let lease = try await materialize(sessionID: sessionID, resourceID: resourceID)
        do {
            try Task.checkCancellation()
            let bytes = try Data(contentsOf: lease.fileURL, options: .mappedIfSafe)
            // Foundation honors BOM; ASCII-leading UTF16 XML without BOM is also supported.
            let encoding: String.Encoding = bytes.starts(with: [0xff, 0xfe]) || bytes.starts(with: [0x3c, 0]) ? .utf16LittleEndian
                : bytes.starts(with: [0xfe, 0xff]) || bytes.starts(with: [0, 0x3c]) ? .utf16BigEndian : .utf8
            guard let text = String(data: bytes, encoding: encoding) else { throw EpubArchiveError.corruptResource }
            await release(lease)
            return text
        } catch { await release(lease); throw error }
    }

    public func descriptor(_ sessionID: String) throws -> EpubArchiveDescriptor {
        guard let session = sessions[sessionID] else { throw EpubArchiveError.closed }
        return .init(sessionID: sessionID, entries: session.descriptors)
    }

    public func release(sessionID: String, leaseID: String) async {
        guard let lease = sessions[sessionID]?.leases[leaseID] else { return }
        await release(lease)
    }

    public func release(_ lease: EpubResourceLease) async {
        guard let stored = sessions[lease.sessionID]?.leases.removeValue(forKey: lease.leaseID) else { return }
        try? FileManager.default.removeItem(at: stored.fileURL)
        await sessions[lease.sessionID]?.quota.release(stored.bytes)
    }

    public func close(_ sessionID: String) async {
        if let cleanup = closing[sessionID] { await cleanup.value; return }
        guard let session = sessions.removeValue(forKey: sessionID) else { return }
        let cleanup = Task {
            session.jobs.values.forEach { $0.cancel() }
            for job in session.jobs.values { _ = try? await job.value }
            await session.source.close()
            try? FileManager.default.removeItem(at: session.directory)
        }
        closing[sessionID] = cleanup
        await cleanup.value
        closing.removeValue(forKey: sessionID)
    }

    public func liveBytes(_ sessionID: String) async -> UInt64 {
        await sessions[sessionID]?.quota.count() ?? 0
    }

    private func prepareTemporaryRoot() throws {
        guard !prepared else { return }
        let manager = FileManager.default
        if manager.fileExists(atPath: temporaryRoot.path) {
            let values = try temporaryRoot.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
            guard values.isDirectory == true, values.isSymbolicLink != true else { throw EpubArchiveError.outsideAllowedRoots }
        } else { try manager.createDirectory(at: temporaryRoot, withIntermediateDirectories: true) }
        if cleanupOnFirstOpen {
            // This dedicated cache contains only reproducible leases. Preserve unknown names.
            for url in try manager.contentsOfDirectory(at: temporaryRoot, includingPropertiesForKeys: nil) {
                if UUID(uuidString: url.lastPathComponent) != nil { try manager.removeItem(at: url) }
            }
        }
        prepared = true
    }
}

private actor ResourceSink {
    let writer: FileHandle
    let quota: LiveBytes
    let budget: EpubArchiveBudget
    let started = ProcessInfo.processInfo.systemUptime
    var bytes: UInt64 = 0
    init(writer: FileHandle, quota: LiveBytes, budget: EpubArchiveBudget) {
        self.writer = writer; self.quota = quota; self.budget = budget
    }
    func write(_ chunk: Data) async throws {
        try Task.checkCancellation()
        guard ProcessInfo.processInfo.systemUptime - started < budget.maxInflateSeconds else { throw EpubArchiveError.timeBudget }
        let count = UInt64(chunk.count)
        guard count <= budget.maxResourceBytes, bytes <= budget.maxResourceBytes - count else { throw EpubArchiveError.sizeBudget }
        try await quota.reserve(count)
        bytes += count
        try writer.write(contentsOf: chunk)
    }
    func count() -> UInt64 { bytes }
}
