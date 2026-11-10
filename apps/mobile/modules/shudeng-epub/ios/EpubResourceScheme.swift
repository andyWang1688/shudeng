#if canImport(WebKit)
import Foundation
import WebKit

/// Reader HTML and resource requests share one custom origin. The HTML is application
/// code only; publication HTML is still loaded by foliate's sanitized Blob loader.
/// Only the active session is reachable from this WKWebView.
@MainActor
public final class EpubResourceScheme: NSObject, WKURLSchemeHandler {
    public static let scheme = "shudeng-epub"
    private let archives: EpubArchives
    private var html = Data()
    private var activeSessionID: String?
    private var closingSessions: [Task<Void, Never>] = []
    private var generation = 0
    private var jobs: [ObjectIdentifier: Task<Void, Never>] = [:]
    private var stopped = Set<ObjectIdentifier>()
    private var closed = false
    private var closeTask: Task<Void, Never>?
    public private(set) var stoppedRequestCount = 0
    public let pageURL = URL(string: "shudeng-epub://reader/index.html")!
    public init(archives: EpubArchives) { self.archives = archives }
    public func setReaderHTML(_ readerHTML: String) { html = Data(readerHTML.utf8) }
    public func activate(_ sessionID: String) {
        guard !closed, UUID(uuidString: sessionID) != nil else { return }
        if activeSessionID == sessionID { return }
        if let previous = activeSessionID {
            closingSessions.append(Task { await archives.close(previous) })
        }
        generation += 1
        jobs.values.forEach { $0.cancel() }
        activeSessionID = sessionID
    }

    public func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        let key = ObjectIdentifier(urlSchemeTask)
        guard !closed, let url = urlSchemeTask.request.url, url.scheme == Self.scheme,
              url.host == "reader", url.query == nil, url.fragment == nil,
              urlSchemeTask.request.httpMethod == "GET" else {
            urlSchemeTask.didFailWithError(EpubArchiveError.missingResource); return
        }
        stopped.remove(key)
        if url == pageURL {
            respond(urlSchemeTask, data: html, mime: "text/html")
            return
        }
        let parts = url.path.split(separator: "/")
        guard parts.count == 2, let sessionID = activeSessionID, parts[0] == sessionID, UUID(uuidString: String(parts[1])) != nil else {
            urlSchemeTask.didFailWithError(EpubArchiveError.missingResource); return
        }
        let resourceID = String(parts[1])
        let requestGeneration = generation
        jobs[key] = Task { [weak self] in
            guard let self else { return }
            var lease: EpubResourceLease?
            var reader: LeaseFileReader?
            do {
                let resource = try await archives.materialize(sessionID: sessionID, resourceID: resourceID)
                lease = resource
                try Task.checkCancellation()
                guard isLive(key, generation: requestGeneration) else { throw CancellationError() }
                let file = try LeaseFileReader(resource.fileURL); reader = file
                let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: [
                    "Content-Type": "application/octet-stream", "Content-Length": String(resource.bytes),
                    "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
                    "Access-Control-Allow-Origin": "shudeng-epub://reader",
                ])!
                urlSchemeTask.didReceive(response)
                while let chunk = try await file.read() {
                    try Task.checkCancellation()
                    guard isLive(key, generation: requestGeneration) else { throw CancellationError() }
                    urlSchemeTask.didReceive(chunk)
                }
                if isLive(key, generation: requestGeneration) { urlSchemeTask.didFinish() }
            } catch {
                if isLive(key, generation: requestGeneration) { urlSchemeTask.didFailWithError(error) }
            }
            await reader?.close()
            if let lease { await archives.release(lease) }
            jobs.removeValue(forKey: key)
            stopped.remove(key)
        }
    }

    public func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
        let key = ObjectIdentifier(urlSchemeTask)
        stopped.insert(key)
        stoppedRequestCount += 1
        jobs[key]?.cancel()
    }

    public func close() async {
        if let closeTask { await closeTask.value; return }
        closed = true
        generation += 1
        let previous = activeSessionID; activeSessionID = nil
        let pending = Array(jobs.values)
        let earlierClosures = closingSessions
        closingSessions.removeAll()
        pending.forEach { $0.cancel() }
        let cleanup = Task {
            for job in pending { await job.value }
            jobs.removeAll(); stopped.removeAll()
            if let previous { await archives.close(previous) }
            for task in earlierClosures { await task.value }
        }
        closeTask = cleanup
        await cleanup.value
    }

    private func isLive(_ key: ObjectIdentifier, generation requestGeneration: Int) -> Bool { !closed && generation == requestGeneration && !stopped.contains(key) }
    private func respond(_ task: WKURLSchemeTask, data: Data, mime: String) {
        let response = HTTPURLResponse(url: task.request.url!, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: [
            "Content-Type": mime + "; charset=utf-8", "Cache-Control": "no-store",
            // This is the reader shell policy; a product integration must preserve reader's own CSP.
            "Content-Security-Policy": "default-src 'self' blob: data:; script-src 'self' 'unsafe-inline' blob:; style-src 'self' 'unsafe-inline' blob:; connect-src 'self'; frame-src 'self' blob:;",
        ])!
        task.didReceive(response); task.didReceive(data); task.didFinish()
    }
}

private actor LeaseFileReader {
    private var file: FileHandle?
    init(_ url: URL) throws { file = try FileHandle(forReadingFrom: url) }
    func read() throws -> Data? {
        try Task.checkCancellation()
        guard let file else { throw EpubArchiveError.closed }
        let data = try file.read(upToCount: 64 * 1024)
        return data?.isEmpty == true ? nil : data
    }
    func close() { try? file?.close(); file = nil }
    deinit { try? file?.close() }
}
#endif
