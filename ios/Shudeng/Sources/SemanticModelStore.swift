import Foundation
import CryptoKit

/// 按需下载的离线语义模型（Sentence-Transformers MiniLM INT8）安装器。
///
/// 安装位置：`Application Support/Shudeng/SemanticModel/`（不是 Caches，下载后长期保留）；
/// 下载顺序：model.onnx.gz → tokenizer.json → tokenizer_config.json，全部在临时目录完成后
/// 逐文件 SHA256 校验，再整体移入安装目录（先落 staging，失败不破坏已有安装）。
/// 模型未安装时 AI 语义资料不可用，但阅读/原文搜索不受影响（见 BookPreparation 降级）。
final class SemanticModelStore: @unchecked Sendable {
    static let shared = SemanticModelStore()
    /// 模型安装/移除后发送（UI 与书籍准备逻辑据此刷新状态）。
    static let changed = Notification.Name("SemanticModelStoreChanged")

    /// GitHub release 资源根路径（直连源）。
    static let baseURL = "https://github.com/andyWang1688/shudeng/releases/download/semantic-model-v2/"

    struct DownloadSource: Sendable {
        let name: String
        /// 国内加速线路前缀；空字符串表示直连 GitHub。
        let prefix: String
        /// 单文件单次尝试超时；nil = 不额外超时（直连 GitHub 最后兜底，尽量让慢速网络也能成功）。
        let timeout: TimeInterval?
    }

    /// 下载源优先级（本机实测：gh-proxy ~5.7MB/s、ghfast ~3MB/s、ghproxy.net ~171KB/s、直连 ~85KB/s）。
    static let sources: [DownloadSource] = [
        DownloadSource(name: "gh-proxy.com", prefix: "https://gh-proxy.com/", timeout: 60),
        DownloadSource(name: "ghfast.top", prefix: "https://ghfast.top/", timeout: 60),
        DownloadSource(name: "ghproxy.net", prefix: "https://ghproxy.net/", timeout: 60),
        DownloadSource(name: "github", prefix: "", timeout: nil)
    ]

    struct FileSpec: Sendable {
        let name: String
        let bytes: Int64
        let sha256: String
    }

    static let files: [FileSpec] = [
        FileSpec(
            name: "model.onnx.gz",
            bytes: 75_546_406,
            sha256: "e4ec66a19479ab9996124d52874e47c560b8bb6af2e07556b52e07d6419b0184"
        ),
        FileSpec(
            name: "tokenizer.json",
            bytes: 9_081_518,
            sha256: "2c3387be76557bd40970cec13153b3bbf80407865484b209e655e5e4729076b8"
        ),
        FileSpec(
            name: "tokenizer_config.json",
            bytes: 581,
            sha256: "fdc4d08ae5071db078dee8eeb26a861f926cc27692637fa45ec7fd29753193e2"
        )
    ]

    /// 安装后磁盘占用（三文件总量）。
    static let installedBytes: Int64 = files.reduce(0) { $0 + $1.bytes }
    /// 需要从网络下载的总字节数（三个 release 资产之和，与 installedBytes 相同）。
    static let downloadBytes: Int64 = files.reduce(0) { $0 + $1.bytes }

    private struct Marker: Codable {
        let version: Int
        let bytes: [String: Int64]
        let hashes: [String: String]
    }

    private static let markerVersion = 1
    private static let markerName = ".installed.json"
    private let fileManager = FileManager.default
    private let folderPath: URL

    /// 默认安装到 Application Support/Shudeng/SemanticModel；测试可注入临时目录。
    init(folder: URL? = nil) {
        if let folder {
            folderPath = folder
        } else {
            let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            folderPath = support
                .appendingPathComponent("Shudeng", isDirectory: true)
                .appendingPathComponent("SemanticModel", isDirectory: true)
        }
    }

    /// 安装目录（下载目标）；是否就绪用 `isInstalled` 判断。
    var folder: URL { folderPath }

    /// 已安装且文件大小/SHA 与清单一致的目录；否则 nil。
    var installedFolder: URL? { isInstalled ? folderPath : nil }

    /// 快速校验安装状态：标记文件与三文件大小匹配，且标记记录的 SHA 与内置清单一致。
    /// （完整 SHA 逐字节校验在安装/下载时执行；避免启动时重复哈希 84MB。）
    var isInstalled: Bool {
        guard let data = try? Data(contentsOf: folderPath.appendingPathComponent(Self.markerName)),
              let marker = try? JSONDecoder().decode(Marker.self, from: data),
              marker.version == Self.markerVersion else { return false }
        for spec in Self.files {
            guard marker.bytes[spec.name] == spec.bytes,
                  marker.hashes[spec.name] == spec.sha256,
                  let attributes = try? fileManager.attributesOfItem(
                    atPath: folderPath.appendingPathComponent(spec.name).path
                  ),
                  let size = attributes[.size] as? NSNumber,
                  size.int64Value == spec.bytes else { return false }
        }
        return true
    }

    /// 逐文件大小 + SHA256 全量校验（启动不走这里，避免每次哈希 84MB；测试/设置页可用）。
    func verifyInstalledFiles() -> Bool {
        guard let markerData = try? Data(contentsOf: folderPath.appendingPathComponent(Self.markerName)),
              let marker = try? JSONDecoder().decode(Marker.self, from: markerData),
              marker.version == Self.markerVersion else { return false }
        for spec in Self.files {
            guard let actual = try? Self.verify(file: folderPath.appendingPathComponent(spec.name)),
                  actual.bytes == spec.bytes,
                  actual.sha256 == spec.sha256,
                  marker.bytes[spec.name] == spec.bytes,
                  marker.hashes[spec.name] == spec.sha256 else { return false }
        }
        return true
    }

    /// 安装目录是否有可用模型（app 自带 Debug 模型或已下载）。
    static var hasLocalModel: Bool {
        shared.installedFolder != nil || Bundle.main.url(forResource: "SemanticModel", withExtension: nil) != nil
    }

    /// 下载并安装模型。progress 以 0...1 在主线程回调；支持 Task 取消（取消不破坏已有安装）。
    func download(progress: @escaping @MainActor (Double) -> Void) async throws {
        try Task.checkCancellation()
        let parent = folderPath.deletingLastPathComponent()
        try fileManager.createDirectory(at: parent, withIntermediateDirectories: true)
        let staging = parent.appendingPathComponent(".SemanticModel-" + UUID().uuidString, isDirectory: true)
        try fileManager.createDirectory(at: staging, withIntermediateDirectories: true)
        defer { try? fileManager.removeItem(at: staging) }

        var completedBytes: Int64 = 0
        // 本次安装内复用上一个文件成功的源；失败则按优先级换下一个源。
        var preferredSource = 0
        for spec in Self.files {
            try Task.checkCancellation()
            let destination = staging.appendingPathComponent(spec.name)
            var lastError: Error?
            var succeeded = false
            let order = [preferredSource] + Self.sources.indices.filter { $0 != preferredSource }
            for sourceIndex in order {
                try Task.checkCancellation()
                try? fileManager.removeItem(at: destination)
                let source = Self.sources[sourceIndex]
                let completedBeforeFile = completedBytes
                let start = CFAbsoluteTimeGetCurrent()
                do {
                    try await Self.download(spec, to: destination, source: source) { writtenFraction in
                        let total = Double(Self.downloadBytes)
                        let fraction = min(1, (Double(completedBeforeFile) + writtenFraction * Double(spec.bytes)) / total)
                        Task { @MainActor in progress(fraction) }
                    }
                    let actual = try Self.verify(file: destination)
                    guard actual.bytes == spec.bytes, actual.sha256 == spec.sha256 else {
                        throw SemanticModelDownloadError.integrity(spec.name)
                    }
                    NSLog(
                        "SEMANTIC_MODEL download file=%@ source=%@ %.1fs",
                        spec.name, source.name, CFAbsoluteTimeGetCurrent() - start
                    )
                    preferredSource = sourceIndex
                    succeeded = true
                    break
                } catch {
                    if Task.isCancelled { throw CancellationError() }
                    lastError = error
                    try? fileManager.removeItem(at: destination)
                    NSLog(
                        "SEMANTIC_MODEL fallback file=%@ source=%@ error=%@",
                        spec.name, source.name, String(describing: error)
                    )
                    // 进度回到本文件起点；跨源重试从 0 开始，符合预期。
                    Task { @MainActor in progress(Double(completedBytes) / Double(Self.downloadBytes)) }
                }
            }
            guard succeeded else {
                throw lastError ?? SemanticModelDownloadError.integrity(spec.name)
            }
            completedBytes += spec.bytes
            Task { @MainActor in progress(Double(completedBytes) / Double(Self.downloadBytes)) }
        }

        try Task.checkCancellation()
        try writeMarker(in: staging)
        try commitInstall(staging: staging)
        Task { @MainActor in progress(1) }
    }

    /// 从本地目录安装（离线/测试/恢复场景）：校验三文件 SHA 后复制到安装目录。
    /// 可用于测试夹具：`install(from: Bundle.main.url(forResource: "SemanticModel", ...))`。
    func install(from sourceFolder: URL) throws {
        let parent = folderPath.deletingLastPathComponent()
        try fileManager.createDirectory(at: parent, withIntermediateDirectories: true)
        let staging = parent.appendingPathComponent(".SemanticModel-" + UUID().uuidString, isDirectory: true)
        try fileManager.createDirectory(at: staging, withIntermediateDirectories: true)
        defer { try? fileManager.removeItem(at: staging) }

        for spec in Self.files {
            let source = sourceFolder.appendingPathComponent(spec.name)
            let actual = try Self.verify(file: source)
            guard actual.bytes == spec.bytes, actual.sha256 == spec.sha256 else {
                throw SemanticModelDownloadError.integrity(spec.name)
            }
            try fileManager.copyItem(at: source, to: staging.appendingPathComponent(spec.name))
        }
        try writeMarker(in: staging)
        try commitInstall(staging: staging)
    }

    private func writeMarker(in staging: URL) throws {
        let marker = Marker(
            version: Self.markerVersion,
            bytes: Dictionary(uniqueKeysWithValues: Self.files.map { ($0.name, $0.bytes) }),
            hashes: Dictionary(uniqueKeysWithValues: Self.files.map { ($0.name, $0.sha256) })
        )
        try JSONEncoder().encode(marker).write(
            to: staging.appendingPathComponent(Self.markerName),
            options: .atomic
        )
    }

    /// 以 staging 整体替换旧安装目录，然后广播 changed；移动失败会抛错由调用方清理 staging。
    private func commitInstall(staging: URL) throws {
        if fileManager.fileExists(atPath: folderPath.path) {
            try fileManager.removeItem(at: folderPath)
        }
        try fileManager.moveItem(at: staging, to: folderPath)
        NotificationCenter.default.post(name: Self.changed, object: nil)
    }

    /// 删除已安装模型（不影响书库/索引；已有向量仍可保留，但之后无法再嵌入新问题）。
    func remove() throws {
        guard fileManager.fileExists(atPath: folderPath.path) else { return }
        try fileManager.removeItem(at: folderPath)
        NotificationCenter.default.post(name: Self.changed, object: nil)
    }

    // MARK: - 下载实现

    private static func download(
        _ spec: FileSpec,
        to destination: URL,
        source: DownloadSource,
        progress: @escaping (Double) -> Void
    ) async throws {
        let string = source.prefix.isEmpty ? baseURL + spec.name : source.prefix + baseURL + spec.name
        guard let url = URL(string: string) else {
            throw SemanticModelDownloadError.invalidURL(spec.name)
        }
        let delegate = DownloadDelegate(destination: destination, onProgress: progress)
        let session = URLSession(configuration: .default, delegate: delegate, delegateQueue: nil)
        delegate.session = session
        let task = session.downloadTask(with: url)
        var timeoutItem: DispatchWorkItem?
        if let timeout = source.timeout {
            let item = DispatchWorkItem { task.cancel() }
            timeoutItem = item
            DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + timeout, execute: item)
        }
        defer { timeoutItem?.cancel() }
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
                delegate.continuation = continuation
                task.resume()
            }
        } onCancel: {
            task.cancel()
            session.invalidateAndCancel()
        }
    }

    private static func verify(file: URL) throws -> (bytes: Int64, sha256: String) {
        let handle = try FileHandle(forReadingFrom: file)
        defer { try? handle.close() }
        var hash = SHA256()
        var bytes: Int64 = 0
        while let data = try handle.read(upToCount: 1_048_576), !data.isEmpty {
            bytes += Int64(data.count)
            hash.update(data: data)
        }
        let digest = hash.finalize().map { String(format: "%02x", $0) }.joined()
        return (bytes, digest)
    }
}

enum SemanticModelDownloadError: LocalizedError {
    case invalidURL(String)
    case integrity(String)
    case interrupted

    var errorDescription: String? {
        switch self {
        case .invalidURL(let name): return "模型文件地址无效：\(name)"
        case .integrity(let name): return "下载的模型文件校验失败：\(name)"
        case .interrupted: return "模型下载已中断"
        }
    }
}

private final class DownloadDelegate: NSObject, URLSessionDownloadDelegate {
    let destination: URL
    let onProgress: (Double) -> Void
    var session: URLSession?
    var continuation: CheckedContinuation<Void, Error>?
    private var moveError: Error?

    init(destination: URL, onProgress: @escaping (Double) -> Void) {
        self.destination = destination
        self.onProgress = onProgress
    }

    func urlSession(
        _ session: URLSession,
        downloadTask: URLSessionDownloadTask,
        didWriteData bytesWritten: Int64,
        totalBytesWritten: Int64,
        totalBytesExpectedToWrite: Int64
    ) {
        guard totalBytesExpectedToWrite > 0 else { return }
        onProgress(Double(totalBytesWritten) / Double(totalBytesExpectedToWrite))
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        // 临时文件只在这个回调内有效，必须先移走再让 didComplete 继续。
        do {
            if FileManager.default.fileExists(atPath: destination.path) {
                try FileManager.default.removeItem(at: destination)
            }
            try FileManager.default.moveItem(at: location, to: destination)
        } catch {
            moveError = error
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        let continuation = self.continuation
        self.continuation = nil
        session.invalidateAndCancel()
        if let error {
            continuation?.resume(throwing: error)
            return
        }
        if let moveError {
            continuation?.resume(throwing: moveError)
            return
        }
        if let response = task.response as? HTTPURLResponse, !(200..<300).contains(response.statusCode) {
            continuation?.resume(throwing: URLError(.badServerResponse))
            return
        }
        continuation?.resume(returning: ())
    }
}
