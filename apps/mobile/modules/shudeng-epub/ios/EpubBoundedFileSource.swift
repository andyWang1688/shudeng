import Foundation
import ReadiumZIPFoundation

/// Platform I/O adapter for the mature ZIP parser. No ZIP structures are decoded here.
/// One owned descriptor fixes the bytes to the opened file even if its path is renamed.
/// Random accesses are serialized, so concurrent ZIP transactions cannot race a seek.
actor BoundedFileSource: DataSource {
    nonisolated let isWritable = false
    private var file: FileHandle?
    private let size: UInt64
    private var metadataBytes: UInt64 = 0
    private var metadataLimit: UInt64?
    init(_ url: URL, metadataLimit: UInt64) throws {
        let handle = try FileHandle(forReadingFrom: url)
        size = try handle.seekToEnd(); file = handle; self.metadataLimit = metadataLimit
    }
    deinit { try? file?.close() }
    func length() throws -> UInt64 { guard file != nil else { throw EpubArchiveError.closed }; return size }
    func openRead() throws -> any DataSourceTransaction {
        guard file != nil else { throw EpubArchiveError.closed }
        return BoundedTransaction(source: self)
    }
    func finishMetadata() { metadataLimit = nil }
    func read(offset: UInt64, length: Int) throws -> Data {
        try Task.checkCancellation()
        guard let file else { throw EpubArchiveError.closed }
        guard length >= 0, offset <= size, UInt64(length) <= size - offset else { throw EpubArchiveError.corruptResource }
        if let limit = metadataLimit {
            guard UInt64(length) <= limit, metadataBytes <= limit - UInt64(length) else { throw EpubArchiveError.sizeBudget }
            metadataBytes += UInt64(length)
        }
        try file.seek(toOffset: offset)
        let bytes = try file.read(upToCount: length) ?? Data()
        guard bytes.count == length else { throw EpubArchiveError.corruptResource }
        return bytes
    }
    func close() { try? file?.close(); file = nil }
}

private actor BoundedTransaction: DataSourceTransaction {
    let source: BoundedFileSource
    var offset: UInt64 = 0
    init(source: BoundedFileSource) { self.source = source }
    func position() -> UInt64 { offset }
    func seek(to position: UInt64) { offset = position }
    func read(length: Int) async throws -> Data {
        let data = try await source.read(offset: offset, length: length)
        offset += UInt64(data.count)
        return data
    }
}
