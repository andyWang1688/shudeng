import Foundation
import PDFKit
import SQLite3
import SwiftSoup
import ReadiumShared
import ReadiumStreamer

/// 在 PDFKitWorkQueue 上串行访问 PDFDocument 的页文本抽取器。
/// PDFKit 不是线程安全的，actor/Swift 并发线程不直接碰文档；每页 autoreleasepool。
final class PDFPageTextExtractor: @unchecked Sendable {
    struct Metadata: Sendable {
        let pageCount: Int
        let isLocked: Bool
    }

    private let file: URL
    private var document: PDFKit.PDFDocument?

    init(file: URL) { self.file = file }

    func open() async throws -> Metadata {
        try await withCheckedThrowingContinuation { continuation in
            PDFKitWorkQueue.queue.async {
                autoreleasepool {
                    guard let document = PDFKit.PDFDocument(url: self.file) else {
                        continuation.resume(throwing: IndexError.source)
                        return
                    }
                    self.document = document
                    continuation.resume(returning: Metadata(pageCount: document.pageCount, isLocked: document.isLocked))
                }
            }
        }
    }

    func text(at index: Int) async throws -> String {
        try await withCheckedThrowingContinuation { continuation in
            PDFKitWorkQueue.queue.async {
                guard let document = self.document else {
                    continuation.resume(throwing: IndexError.source)
                    return
                }
                autoreleasepool {
                    continuation.resume(returning: document.page(at: index)?.string ?? "")
                }
            }
        }
    }
}

struct BookPreparationState {
    var completed = 0
    var total = 0
    var failure: String?
    var preparing = true
    var vectorsCompleted = 0
    var vectorsTotal = 0
    var semanticReady = false
    /// 扫描版/没有可检索文字：不建文字索引，但仍可阅读；EPUB 恒为 false。
    var textIndexUnavailable = false
    /// PDF 页数（nil = EPUB）；用它把进度与失败文案切换成「页」。
    var pdfPageCount: Int? = nil
    /// 导入时统计的有文字页数（nil = 未知/EPUB）；0 表示扫描版。
    var searchablePageCount: Int? = nil
    var ready: Bool {
        !preparing && total > 0 && completed == total && failure == nil && (semanticReady || textIndexUnavailable)
    }
    var message: String {
        if textIndexUnavailable {
            return "PDF 已可阅读（共\(total)页）；没有可搜索的文字"
        }
        let unit = pdfPageCount == nil ? "章" : "页"
        if let failure { return "资料准备失败（已完成\(completed)/\(total)\(unit)）：\(failure)；仍可阅读" }
        if pdfPageCount != nil {
            if completed == total, total > 0, !semanticReady {
                return "正在准备 PDF 语义资料（已提交\(vectorsCompleted)/\(vectorsTotal)段），不影响阅读和原文搜索"
            }
            return ready
                ? "PDF 文字资料可用（\(total)页，语义资料已完成）"
                : "正在准备 PDF 文字索引（已完成\(completed)/\(total)页），不影响阅读"
        }
        if completed == total && total > 0 && !semanticReady {
            return "正在准备本地语义资料（已提交\(vectorsCompleted)/\(vectorsTotal)段），不影响阅读和原文搜索"
        }
        return ready ? "书内资料可用（\(total)章，语义资料已完成）" : "正在准备书内资料（已完成\(completed)/\(total)章），不影响阅读"
    }
}

struct BookSearchHit {
    let id: String
    let chapter: String
    let context: String
    let locator: Locator
    /// PDF 页级命中的 1-based 页号；EPUB 命中为 nil。
    var page: Int? { locator.pdfPageNumber }
}

extension Locator {
    /// PDF 1-based 页号：优先取 Readium 的 fragment `page=N`，退回显式 `page` 扩展或 `position`；非 PDF 为 nil。
    var pdfPageNumber: Int? {
        guard mediaType.matches(.pdf) else { return nil }
        return locations.page ?? locations["page"]?.integer ?? locations.position
    }
}

/// UI state only; parsing, SQLite and search run on BookIndex's actor.
@MainActor
final class BookPreparation {
    static let changed = Notification.Name("BookPreparationChanged")
    let index: BookIndex
    private(set) var states: [String: BookPreparationState] = [:]
    private var jobs: [String: Task<Void, Never>] = [:]
    private var tokens: [String: UUID] = [:]

    init(root: URL) { index = BookIndex(url: root.appendingPathComponent("book-index.sqlite")) }
    func start(_ book: Book, file: URL, rebuild: Bool = false) {
        guard book.removal == nil, FileManager.default.fileExists(atPath: file.path) else { return }
        guard jobs[book.id] == nil else { return }
        if book.resolvedFormat == .pdf, let info = book.pdfInfo, info.textPageCount == 0 {
            // 扫描版没有可建索引的文字：直接给出明确终态，避免空跑逐页检查或停在“准备中”。
            var state = BookPreparationState(completed: info.pageCount, total: info.pageCount, preparing: false)
            state.pdfPageCount = info.pageCount
            state.searchablePageCount = 0
            state.textIndexUnavailable = true
            states[book.id] = state
            notify()
            return
        }
        if !rebuild, states[book.id]?.ready == true { return }
        var state = pdfState(states[book.id] ?? BookPreparationState(), for: book)
        state.preparing = true; state.failure = nil
        states[book.id] = state
        notify()
        let token = UUID(); tokens[book.id] = token
        jobs[book.id] = Task {
            do {
                if var committed = try? await index.state(bookID: book.id) {
                    committed.preparing = true
                    if tokens[book.id] == token { update(pdfState(committed, for: book), for: book.id) }
                }
                try await index.prepare(bookID: book.id, file: file, rebuild: rebuild) { state in
                    if self.tokens[book.id] == token { self.update(self.pdfState(state, for: book), for: book.id) }
                }
                try Task.checkCancellation()
                try await index.prepareVectors(bookID: book.id) { state in
                    if self.tokens[book.id] == token { self.update(self.pdfState(state, for: book), for: book.id) }
                }
            } catch is CancellationError {
                // Startup resumes the committed chapter checkpoint.
            } catch {
                guard tokens[book.id] == token else { return }
                var state = pdfState(states[book.id] ?? BookPreparationState(), for: book)
                state.failure = (error as? IndexError)?.errorDescription ?? (error as? EmbeddingError)?.errorDescription ?? "无法读取或保存资料，请检查文件与储存空间后重试"
                state.preparing = false
                states[book.id] = state
            }
            guard tokens[book.id] == token else { return }
            jobs[book.id] = nil; tokens[book.id] = nil
            notify()
        }
    }
    func stop(bookID: String) async {
        let job = jobs[bookID]
        tokens[bookID] = nil
        job?.cancel()
        await job?.value
        jobs[bookID] = nil; states[bookID] = nil
        notify()
    }
    /// Await owned tasks before an owner removes its storage (also used by integration teardown).
    func waitForCurrentWork() async {
        for job in Array(jobs.values) { await job.value }
    }
#if DEBUG
    func setDesignState(_ state: BookPreparationState, for bookID: String) {
        states[bookID] = state
        notify()
    }
#endif
    private func update(_ state: BookPreparationState, for id: String) { states[id] = state; notify() }
    private func notify() { NotificationCenter.default.post(name: Self.changed, object: self) }

    /// PDF 的进度/终态统一补上页数与可检索页数（导入时已由 pdfInfo 统计）。
    /// 扫描版把 `textIndexUnavailable` 置为 true：可阅读但不可搜索。
    private func pdfState(_ state: BookPreparationState, for book: Book) -> BookPreparationState {
        guard book.resolvedFormat == .pdf else { return state }
        var state = state
        if let info = book.pdfInfo {
            state.pdfPageCount = info.pageCount
            state.searchablePageCount = info.textPageCount
            if info.textPageCount == 0 {
                state.textIndexUnavailable = true
                state.preparing = false
            }
        } else if state.total > 0 {
            state.pdfPageCount = state.total
        }
        return state
    }
}

enum IndexError: LocalizedError {
    case storage, source
    var errorDescription: String? {
        switch self {
        case .storage: return "资料无法保存，请检查储存空间后重试"
        case .source: return "原文无法读取，请确认原书文件可用后重试"
        }
    }
}

/// Derived data only. #10 can consume the same committed fragments/locators and checkpoints.
actor BookIndex {
    let url: URL
    init(url: URL) { self.url = url }

    func prepare(bookID: String, file: URL, rebuild: Bool = false,
                 progress: @escaping @MainActor (BookPreparationState) async -> Void) async throws {
        try Task.checkCancellation()
        if file.pathExtension.lowercased() == "pdf" {
            try await preparePDF(bookID: bookID, file: file, rebuild: rebuild, progress: progress)
            return
        }
        let db = try IndexDatabase(url: url)
        let http = DefaultHTTPClient()
        let retriever = AssetRetriever(httpClient: http)
        let opener = PublicationOpener(parser: DefaultPublicationParser(httpClient: http, assetRetriever: retriever, pdfFactory: DefaultPDFDocumentFactory()), contentProtections: [])
        guard let fileURL = FileURL(url: file) else { throw IndexError.source }
        let asset = try await retriever.retrieve(url: fileURL).get()
        let publication = try await opener.open(asset: asset, allowUserInteraction: false).get()
        let order = publication.readingOrder
        guard !order.isEmpty else { throw IndexError.source }
        let toc = try await publication.tableOfContents().get()
        try Task.checkCancellation()
        try db.initialize(bookID, total: order.count, contents: try toc.jsonString(), rebuild: rebuild)
        var completed = try db.completed(bookID)
        var logical: (key: String, title: String)?
        if let previous = try db.rows("SELECT locator FROM fragments WHERE book_id=? ORDER BY chapter DESC,ordinal DESC LIMIT 1", [bookID]).first,
           let locator = try Locator(json: JSONValue(jsonString: previous[0], warnings: nil), warnings: nil),
           let key = locator.locations.otherLocations["shudengChapter"]?.string {
            logical = (key, locator.title ?? "章节")
        }
        func anchors(_ links: [Link], href: AnyURL) -> [String: String] {
            var values: [String: String] = [:]
            for link in links {
                if link.url().removingFragment() == href.removingFragment() {
                    values[link.url().fragment ?? ""] = link.title ?? "章节"
                }
                values.merge(anchors(link.children, href: href)) { first, _ in first }
            }
            return values
        }
        await progress(BookPreparationState(completed: completed, total: order.count, preparing: completed != order.count))
        func title(_ links: [Link], href: AnyURL) -> String? {
            for link in links {
                if link.url().removingFragment() == href { return link.title }
                if let value = title(link.children, href: href) { return value }
            }
            return nil
        }
        while completed < order.count {
            try Task.checkCancellation()
            let link = order[completed]
            guard let resource = publication.get(link) else { throw IndexError.source }
            let data = try await resource.read().get()
            guard let html = String(data: data, encoding: .utf8) else { throw IndexError.source }
            let chapterTitle = title(toc, href: link.url()) ?? link.title ?? "第\(completed + 1)章"
            let fragments = try BookText.fragments(html: html, href: link.url(), title: chapterTitle,
                                                  anchors: anchors(toc, href: link.url()), logical: &logical)
            try Task.checkCancellation()
            // No suspension: chapter, original text, FTS and checkpoint commit together.
            try db.commit(bookID, chapter: completed, href: link.href, title: chapterTitle, fragments: fragments)
            completed += 1
            await progress(BookPreparationState(completed: completed, total: order.count, preparing: completed != order.count))
        }
    }

    /// PDF 页级索引：每页一个 chapter（ordinal = page-1），页文本切成 fragments；
    /// 空页/扫描页不产生 fragment，但保留 chapter 与进度映射。
    /// 进度按页回调；取消/失败由调用方转为明确状态，不会停在准备中。
    private func preparePDF(
        bookID: String,
        file: URL,
        rebuild: Bool,
        progress: @escaping @MainActor (BookPreparationState) async -> Void
    ) async throws {
        // PDFDocument 的创建与逐页取文本都放在 PDFKitWorkQueue 上（PDFKit 非线程安全）。
        let extractor = PDFPageTextExtractor(file: file)
        let metadata = try await extractor.open()
        guard metadata.pageCount > 0, !metadata.isLocked else { throw IndexError.source }
        let pageCount = metadata.pageCount
        let db = try IndexDatabase(url: url)
        // PDF 没有 Readium 的目录 JSON：contents 先留空，页级 chapter 即目录的最小形态。
        try db.initialize(bookID, total: pageCount, contents: "[]", rebuild: rebuild)
        var completed = try db.completed(bookID)
        var initial = BookPreparationState(completed: completed, total: pageCount, preparing: completed != pageCount)
        initial.pdfPageCount = pageCount
        await progress(initial)
        var sentFinal = false
        let progressStep = max(1, pageCount / 100)
        while completed < pageCount {
            try Task.checkCancellation()
            let text = try await extractor.text(at: completed)
            let pageNumber = completed + 1
            let fragments = BookText.pdfFragments(pageNumber: pageNumber, pageCount: pageCount, text: text)
            try db.commit(bookID, chapter: completed, href: "pdf://page/\(pageNumber)",
                          title: "第 \(pageNumber) 页", fragments: fragments)
            completed += 1
            var state = BookPreparationState(completed: completed, total: pageCount, preparing: completed < pageCount)
            state.pdfPageCount = pageCount
            if completed == pageCount {
                let textPages = try pdfTextPageCount(bookID: bookID, db: db)
                state.searchablePageCount = textPages
                state.textIndexUnavailable = textPages == 0
                sentFinal = true
            }
            if completed == 1 || completed % progressStep == 0 || completed == pageCount {
                await progress(state)
            }
        }
        if !sentFinal {
            let textPages = try pdfTextPageCount(bookID: bookID, db: db)
            var final = BookPreparationState(completed: pageCount, total: pageCount, preparing: false)
            final.pdfPageCount = pageCount
            final.searchablePageCount = textPages
            final.textIndexUnavailable = textPages == 0
            await progress(final)
        }
    }

    private func pdfTextPageCount(bookID: String, db: IndexDatabase) throws -> Int {
        Int(try db.rows("SELECT count(DISTINCT chapter) FROM fragments WHERE book_id=?", [bookID])[0][0]) ?? 0
    }

    func search(bookID: String, query: String) throws -> [BookSearchHit] {
        let query = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return [] }
        return try IndexDatabase(url: url).search(bookID, query: query)
    }
    func state(bookID: String) throws -> BookPreparationState { try IndexDatabase(url: url).state(bookID) }
    func remove(bookID: String) throws {
        guard FileManager.default.fileExists(atPath: url.path) else { return }
        let db = try IndexDatabase(url: url)
        try db.transaction {
            for table in ["embeddings", "embedding_progress", "fragment_terms", "fragments", "chapters", "preparations", "contents"] {
                try db.execute("DELETE FROM \(table) WHERE book_id=?", [bookID])
            }
        }
    }
}

struct BookFragment {
    let text: String
    let locator: Locator
}

/// textContent without whitespace normalization. Each continuous inline run between
/// nested block elements is one fragment; long paragraphs stay intact.
/// Prefix/suffix are relative to the original element, not normalized book text.
enum BookText {
    private static let blocks: Set<String> = ["address", "article", "aside", "blockquote", "body", "dd", "div", "dl", "dt", "figcaption", "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "li", "main", "nav", "ol", "p", "pre", "section", "table", "tbody", "td", "th", "tr", "ul"]
    private static let excluded: Set<String> = ["script", "style", "noscript", "template"]
    static func raw(_ node: Node) -> String {
        if let text = node as? TextNode { return text.getWholeText() }
        if let data = node as? DataNode { return data.getWholeData() }
        return node.getChildNodes().map(raw).joined()
    }
    static func fragments(html: String, href: AnyURL, title: String) throws -> [BookFragment] {
        var logical: (key: String, title: String)?
        return try fragments(html: html, href: href, title: title, anchors: [:], logical: &logical)
    }
    static func fragments(html: String, href: AnyURL, title: String, anchors: [String: String],
                          logical: inout (key: String, title: String)?) throws -> [BookFragment] {
        if let label = anchors[""] { logical = (href.removingFragment().string, label) }
        let document = try SwiftSoup.parse(html)
        guard let body = document.body() else { throw IndexError.source }
        var result: [BookFragment] = []
        func hidden(_ element: Element) -> Bool {
            let style = ((try? element.attr("style")) ?? "").lowercased().filter { !$0.isWhitespace }
            return excluded.contains(element.tagName()) || element.hasAttr("hidden") || (try? element.attr("aria-hidden")) == "true" ||
                style.contains("display:none") || style.contains("visibility:hidden") || style.contains("visibility:collapse")
        }
        func hasBoundary(_ node: Node) -> Bool {
            guard let element = node as? Element else { return false }
            return blocks.contains(element.tagName()) || hidden(element) ||
                (try? element.attr("id")).flatMap { $0.isEmpty ? nil : anchors[$0] } != nil ||
                element.getChildNodes().contains(where: hasBoundary)
        }
        func selector(_ element: Element) -> String {
            var path: [String] = []
            var current: Element? = element
            while let item = current, item.tagName() != "#root" {
                let tag = item.tagName()
                let siblings = item.parent()?.getChildNodes().compactMap { $0 as? Element } ?? []
                let index = siblings.prefix { $0 !== item }.filter { $0.tagName() == tag }.count + 1
                path.insert("\(tag):nth-of-type(\(index))", at: 0)
                current = item.parent()
            }
            return path.joined(separator: " > ")
        }
        func visit(_ element: Element) {
            guard !hidden(element) else { return }
            // Update only on entering a visible target, after the preceding run was flushed.
            if let name = try? element.attr("id"), !name.isEmpty, let label = anchors[name] {
                logical = (href.removingFragment().string + "#" + name, label)
            }
            let whole = raw(element) as NSString
            var textNodes: [JSONValue] = []
            var nodeOffset = 0
            func mapNodes(_ node: Node) {
                if node is TextNode || node is DataNode {
                    let length = (raw(node) as NSString).length
                    if let parent = node.parent() as? Element,
                       let childIndex = parent.getChildNodes().firstIndex(where: { $0 === node }) {
                        let point: [String: JSONValue] = ["start": .integer(nodeOffset), "length": .integer(length),
                            "selector": .string(selector(parent)), "child": .integer(childIndex)]
                        textNodes.append(.object(point))
                    }
                    nodeOffset += length
                } else { node.getChildNodes().forEach(mapNodes) }
            }
            mapNodes(element)
            var offset = 0, runStart = 0
            var run = ""
            func flush() {
                guard !run.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { run = ""; return }
                var locations: [String: JSONValue] = ["cssSelector": .string(selector(element)), "shudengTextNodes": .array(textNodes)]
                if let logical { locations["shudengChapter"] = .string(logical.key) }
                let locator = Locator(href: href, mediaType: .xhtml, title: logical?.title ?? title,
                    locations: .init(otherLocations: locations),
                    text: .init(after: whole.substring(from: runStart + (run as NSString).length), before: whole.substring(to: runStart), highlight: run))
                result.append(BookFragment(text: run, locator: locator))
                run = ""
            }
            for child in element.getChildNodes() {
                let text = raw(child)
                if hasBoundary(child) {
                    flush()
                    if let nested = child as? Element { visit(nested) }
                } else {
                    if run.isEmpty { runStart = offset }
                    run += text
                }
                offset += (text as NSString).length
            }
            flush()
        }
        visit(body)
        return result
    }

    /// Chinese character uni/bigrams (no dictionary), also used for English substrings.
    /// Exact case/diacritic-insensitive matching removes candidate false positives.
    static func tokens(_ text: String, query: Bool = false) -> String {
        let chars = text.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: Locale(identifier: "en_US_POSIX")).unicodeScalars.map { String($0.value, radix: 16) }
        let unigrams = chars.map { "u" + $0 }
        let bigrams = zip(chars, chars.dropFirst()).map { "b" + $0 + "x" + $1 }
        let values = query && chars.count > 1 ? bigrams : unigrams + bigrams
        return Set(values).sorted().joined(separator: query ? " AND " : " ")
    }

    /// PDF 页文本 → fragments：按行聚合为 ≤360 UTF-16 字符的段，空白页返回空。
    /// locator 只带页级位置（fragments/page、position、totalProgression）与 80 字上下文，
    /// 不生成 `domRange`/`cssSelector`；空页仍会由调用方保留 chapter 与进度映射。
    static func pdfFragments(pageNumber: Int, pageCount: Int, text pageText: String) -> [BookFragment] {
        let text = pageText as NSString
        guard text.length > 0, let href = AnyURL(string: "pdf://page/\(pageNumber)") else { return [] }
        // 与阅读器进度口径统一：首页 0，末页 1（单页 PDF 为 1）。
        let progression = pageCount > 1 ? Double(pageNumber - 1) / Double(pageCount - 1) : 1
        // 同时遵循 Readium 的 `page=N` fragment 约定，并把页号显式写进扩展位置，便于检索/UI 直接读取。
        let locations = Locator.Locations(
            fragments: ["page=\(pageNumber)"],
            progression: progression,
            totalProgression: progression,
            position: pageNumber,
            otherLocations: ["page": .integer(pageNumber)]
        )
        let title = "第 \(pageNumber) 页"
        var runs: [NSRange] = []
        var runStart = -1
        var runEnd = 0
        func flush() {
            if runStart >= 0, runEnd > runStart { runs.append(NSRange(location: runStart, length: runEnd - runStart)) }
            runStart = -1
            runEnd = 0
        }
        text.enumerateSubstrings(in: NSRange(location: 0, length: text.length),
                                 options: [.byLines, .substringNotRequired]) { _, range, _, _ in
            let content = pdfContentRange(of: range, in: text)
            guard content.length > 0 else { return }
            for slice in pdfSlices(of: content, in: text) {
                if runStart < 0 {
                    runStart = slice.location
                    runEnd = NSMaxRange(slice)
                } else if NSMaxRange(slice) - runStart <= pdfFragmentLimit {
                    runEnd = NSMaxRange(slice)
                } else {
                    flush()
                    runStart = slice.location
                    runEnd = NSMaxRange(slice)
                }
            }
        }
        flush()
        return runs.map { range in
            let fragmentText = text.substring(with: range)
            let context = 80
            let beforeStart = max(0, range.location - context)
            let before = text.substring(with: NSRange(location: beforeStart, length: range.location - beforeStart))
            let afterStart = NSMaxRange(range)
            let afterLength = min(context, text.length - afterStart)
            let after = afterLength > 0 ? text.substring(with: NSRange(location: afterStart, length: afterLength)) : ""
            let locator = Locator(
                href: href,
                mediaType: .pdf,
                title: title,
                locations: locations,
                text: .init(after: after, before: before, highlight: fragmentText)
            )
            return BookFragment(text: fragmentText, locator: locator)
        }
    }

    private static let pdfFragmentLimit = 360

    /// 去掉行首尾空白后的内容范围（用于跳过纯空白行）。
    private static func pdfContentRange(of range: NSRange, in text: NSString) -> NSRange {
        let line = text.substring(with: range)
        let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return NSRange(location: range.location, length: 0) }
        let local = (line as NSString).range(of: trimmed)
        guard local.location != NSNotFound else { return NSRange(location: range.location, length: 0) }
        return NSRange(location: range.location + local.location, length: (trimmed as NSString).length)
    }

    /// 超长行按 UTF-16 上限切片，且不切断组合字符序列。
    private static func pdfSlices(of range: NSRange, in text: NSString) -> [NSRange] {
        guard range.length > pdfFragmentLimit else { return [range] }
        var result: [NSRange] = []
        var start = range.location
        let end = NSMaxRange(range)
        while start < end {
            var sliceEnd = min(start + pdfFragmentLimit, end)
            if sliceEnd < end {
                let composed = text.rangeOfComposedCharacterSequence(at: sliceEnd - 1)
                sliceEnd = max(start + 1, min(NSMaxRange(composed), end))
            }
            result.append(NSRange(location: start, length: sliceEnd - start))
            start = sliceEnd
        }
        return result
    }
}

/// Short-lived connections, only used by BookIndex's actor.
final class IndexDatabase {
    private var db: OpaquePointer?
    private let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
    init(url: URL) throws {
        guard sqlite3_open_v2(url.path, &db, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE, nil) == SQLITE_OK else {
            sqlite3_close(db); throw IndexError.storage
        }
        sqlite3_busy_timeout(db, 1000)
        do {
            try execute("CREATE TABLE IF NOT EXISTS embeddings(book_id TEXT NOT NULL, model TEXT NOT NULL, fragment_id INTEGER NOT NULL, piece INTEGER NOT NULL, offset INTEGER NOT NULL, original TEXT NOT NULL, vector BLOB NOT NULL CHECK(length(vector)=1536), PRIMARY KEY(book_id,fragment_id,piece))")
            try execute("CREATE TABLE IF NOT EXISTS embedding_progress(book_id TEXT PRIMARY KEY, model TEXT NOT NULL, cursor INTEGER NOT NULL DEFAULT 0, completed INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL)")
            try execute("CREATE TABLE IF NOT EXISTS preparations(book_id TEXT PRIMARY KEY, version INTEGER NOT NULL, total INTEGER NOT NULL, completed INTEGER NOT NULL DEFAULT 0)")
            try execute("CREATE TABLE IF NOT EXISTS chapters(book_id TEXT NOT NULL, ordinal INTEGER NOT NULL, href TEXT NOT NULL, title TEXT NOT NULL, PRIMARY KEY(book_id,ordinal))")
            try execute("CREATE TABLE IF NOT EXISTS contents(book_id TEXT PRIMARY KEY, links TEXT NOT NULL)")
            try execute("CREATE TABLE IF NOT EXISTS fragments(id INTEGER PRIMARY KEY, book_id TEXT NOT NULL, chapter INTEGER NOT NULL, ordinal INTEGER NOT NULL, original TEXT NOT NULL, locator TEXT NOT NULL, UNIQUE(book_id,chapter,ordinal))")
            try execute("CREATE INDEX IF NOT EXISTS fragments_book ON fragments(book_id,chapter,ordinal)")
            try execute("CREATE VIRTUAL TABLE IF NOT EXISTS fragment_terms USING fts5(book_id UNINDEXED, terms)")
        } catch { sqlite3_close(db); db = nil; throw error }
    }
    deinit { sqlite3_close(db) }
    func execute(_ sql: String, _ args: [String] = []) throws {
        let statement = try statement(sql, args)
        defer { sqlite3_finalize(statement) }
        guard sqlite3_step(statement) == SQLITE_DONE else { throw IndexError.storage }
    }
    func statement(_ sql: String, _ args: [String]) throws -> OpaquePointer {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK, let statement else { throw IndexError.storage }
        for (index, value) in args.enumerated() {
            guard sqlite3_bind_text(statement, Int32(index + 1), value, -1, transient) == SQLITE_OK else { sqlite3_finalize(statement); throw IndexError.storage }
        }
        return statement
    }
    func rows(_ sql: String, _ args: [String]) throws -> [[String]] {
        let statement = try statement(sql, args)
        defer { sqlite3_finalize(statement) }
        var result: [[String]] = []
        while true {
            switch sqlite3_step(statement) {
            case SQLITE_ROW:
                result.append((0..<sqlite3_column_count(statement)).map { String(cString: sqlite3_column_text(statement, $0)) })
            case SQLITE_DONE: return result
            default: throw IndexError.storage
            }
        }
    }
    func transaction(_ body: () throws -> Void) throws {
        try execute("BEGIN IMMEDIATE")
        do { try body(); try execute("COMMIT") }
        catch { try? execute("ROLLBACK"); throw error }
    }
    func initialize(_ book: String, total: Int, contents: String, rebuild: Bool) throws {
        let old = try rows("SELECT version,total FROM preparations WHERE book_id=?", [book]).first
        try transaction {
            if rebuild || (old != nil && old != ["3", String(total)]) {
                try execute("DELETE FROM embeddings WHERE book_id=?", [book])
                try execute("DELETE FROM embedding_progress WHERE book_id=?", [book])
                try execute("DELETE FROM fragment_terms WHERE book_id=?", [book])
                try execute("DELETE FROM fragments WHERE book_id=?", [book])
                try execute("DELETE FROM chapters WHERE book_id=?", [book])
                try execute("DELETE FROM preparations WHERE book_id=?", [book])
                try execute("DELETE FROM contents WHERE book_id=?", [book])
            }
            try execute("INSERT OR IGNORE INTO preparations(book_id,version,total) VALUES(?,3,?)", [book, String(total)])
            try execute("INSERT OR REPLACE INTO contents VALUES(?,?)", [book, contents])
        }
    }
    func completed(_ book: String) throws -> Int { try state(book).completed }
    func state(_ book: String) throws -> BookPreparationState {
        guard let row = try rows("SELECT completed,total FROM preparations WHERE book_id=?", [book]).first else { return BookPreparationState() }
        var state = BookPreparationState(completed: Int(row[0])!, total: Int(row[1])!, preparing: row[0] != row[1])
        if let vector = try rows("SELECT model,completed,total FROM embedding_progress WHERE book_id=?", [book]).first,
           vector[0] == SemanticEmbedding.version {
            state.vectorsCompleted = Int(vector[1])!; state.vectorsTotal = Int(vector[2])!
            state.semanticReady = vector[1] == vector[2]
        }
        return state
    }
    func commit(_ book: String, chapter: Int, href: String, title: String, fragments: [BookFragment]) throws {
        try transaction {
            try execute("INSERT INTO chapters VALUES(?,?,?,?)", [book, String(chapter), href, title])
            for (ordinal, fragment) in fragments.enumerated() {
                try execute("INSERT INTO fragments(book_id,chapter,ordinal,original,locator) VALUES(?,?,?,?,?)", [book, String(chapter), String(ordinal), fragment.text, fragment.locator.description])
                let rowID = sqlite3_last_insert_rowid(db)
                try execute("INSERT INTO fragment_terms(rowid,book_id,terms) VALUES(?,?,?)", [String(rowID), book, BookText.tokens(fragment.text)])
            }
            try execute("UPDATE preparations SET completed=? WHERE book_id=?", [String(chapter + 1), book])
        }
    }
    func search(_ book: String, query: String, scope: BookEvidenceScope? = nil) throws -> [BookSearchHit] {
        let terms = BookText.tokens(query, query: true)
        guard !terms.isEmpty else { return [] }
        let scope = scope ?? BookEvidenceScope(bookID: book)
        guard scope.bookID == book else { throw QuestionError.scope }
        let candidates = try rows("SELECT f.chapter,f.ordinal,f.original,f.locator FROM fragment_terms t JOIN fragments f ON f.id=t.rowid WHERE fragment_terms MATCH ? AND " + scope.sql.filter + " ORDER BY f.chapter,f.ordinal", [terms] + scope.sql.bounds)
        var hits: [BookSearchHit] = []
        for row in candidates {
            guard let base = try Locator(json: JSONValue(jsonString: row[3], warnings: nil), warnings: nil) else { throw IndexError.storage }
            let original = row[2] as NSString
            var start = 0
            while start < original.length {
                let range = original.range(of: query, options: [.caseInsensitive, .diacriticInsensitive], range: NSRange(location: start, length: original.length - start))
                if range.location == NSNotFound { break }
                var locator = base
                locator.text = .init(after: original.substring(from: NSMaxRange(range)) + (base.text.after ?? ""),
                    before: (base.text.before ?? "") + original.substring(to: range.location), highlight: original.substring(with: range))
                // PDF 页级命中没有 DOM 映射，直接跳过 domRange 重建；命中 locator 只保留页位置。
                if !base.mediaType.matches(.pdf), let nodes = base.locations.otherLocations["shudengTextNodes"]?.array {
                    func point(_ offset: Int, end: Bool) -> DOMRange.Point? {
                        for node in nodes {
                            guard let object = node.object, let start = object["start"]?.integer, let length = object["length"]?.integer, length > 0,
                                  offset >= start, end ? offset <= start + length : offset < start + length,
                                  let selector = object["selector"]?.string, let child = object["child"]?.integer else { continue }
                            return DOMRange.Point(cssSelector: selector, textNodeIndex: child, charOffset: offset - start)
                        }
                        return nil
                    }
                    let prefix = (locator.text.before! as NSString).length
                    guard let startPoint = point(prefix, end: false), let endPoint = point(prefix + range.length, end: true) else { throw IndexError.source }
                    locator.locations.otherLocations["domRange"] = .object(DOMRange(start: startPoint, end: endPoint).jsonObject)
                    locator.locations.otherLocations.removeValue(forKey: "shudengTextNodes")
                }
                let contextRange = NSRange(location: max(0, range.location - 35), length: min(original.length, NSMaxRange(range) + 55) - max(0, range.location - 35))
                hits.append(BookSearchHit(id: "\(row[0])-\(row[1])-\(range.location)", chapter: base.title ?? "章节", context: original.substring(with: original.rangeOfComposedCharacterSequences(for: contextRange)), locator: locator))
                start = NSMaxRange(range)
            }
        }
        return hits
    }

    /// FTS character grams only shortlist fragments; retrieval verifies each stored block.
    func keywordFragments(scope: BookEvidenceScope, terms: [String], limit: Int) throws -> Set<Int> {
        let expressions = terms.map { BookText.tokens($0, query: true) }.filter { !$0.isEmpty }
        guard !expressions.isEmpty, limit > 0 else { return [] }
        let query = expressions.map { "(" + $0 + ")" }.joined(separator: " OR ")
        let rows = try rows("SELECT f.id FROM fragment_terms t JOIN fragments f ON f.id=t.rowid WHERE fragment_terms MATCH ? AND t.book_id=f.book_id AND " + scope.sql.filter + " ORDER BY bm25(fragment_terms),f.id LIMIT ?", [query] + scope.sql.bounds + [String(limit)])
        return Set(rows.compactMap { Int($0[0]) })
    }
}
