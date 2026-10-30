import Foundation
import CryptoKit
import PDFKit
import ReadiumShared
import ReadiumStreamer

struct ReadingSettings: Codable, Equatable {
    var scroll = false
    var fontSize = 100
    var dark = false
    // Optional for catalogs written before curl mode existed.
    var pageCurl: Bool? = nil
}

/// 书籍格式。旧目录没有 format 字段时按 .epub 读取（Codable 兼容）。
enum BookFormat: String, Codable {
    case epub, pdf

    var fileExtension: String { rawValue }

    init?(fileExtension: String) {
        switch fileExtension.lowercased() {
        case "epub": self = .epub
        case "pdf": self = .pdf
        default: return nil
        }
    }
}

/// PDF 导入时的一次性检查结果（ADR-0017：导入时完整检查每页文字）。
/// 可选字段：旧数据与 EPUB 都没有它，缺省即未知。
struct PDFInfo: Codable, Equatable {
    var pageCount: Int
    var textPageCount: Int
    /// 无文字且无画面的纯空白页（如纯白尾页）；旧数据/EPUB 为 nil。
    var blankPageCount: Int? = nil

    var hasTextPages: Bool { textPageCount > 0 }
    var hasScannedPages: Bool { scannedPageCount > 0 }
}

/// PDF 后台检查进度：已完成页数 / 总页数（导入 UI 显示「正在检查这份 PDF…（X/Y）」）。
struct PDFCheckProgress: Equatable, Sendable {
    var completed: Int
    var total: Int
}

extension PDFInfo {
    /// 扫描页 = 无文字但有画面的页；纯空白页不计入扫描页，避免空白尾页误弹提示/常驻「?」。
    var scannedPageCount: Int { max(0, pageCount - textPageCount - (blankPageCount ?? 0)) }
    var isEntirelyScanned: Bool { textPageCount == 0 && scannedPageCount > 0 && (blankPageCount ?? 0) == 0 }

    /// 导入提示卡标题；没有扫描页时返回 nil（静默导入，不打扰用户）。
    var scannedPagesTitle: String? {
        guard hasScannedPages else { return nil }
        return isEntirelyScanned ? "这份 PDF 是扫描版" : "这份 PDF 有 \(scannedPageCount) 页是扫描图片"
    }

    /// 扫描页说明：导入提示卡与阅读器「?」共用同一段文案（ADR-0017：不出现技术词）。
    var scannedPagesMessage: String {
        isEntirelyScanned
            ? "页面上的字是图片，目前还不能选字提问或高亮。阅读、缩放和加书签都可以正常使用。"
            : "这些页目前还不能选字提问或高亮；其余页面正常。"
    }
}

/// PDFKit 文本抽取统一走这条独立串行队列：PDFKit 不是线程安全的，
/// 不能让它分散在 Swift 并发的随机线程上（导入检查与建索引可能同时发生）。
enum PDFKitWorkQueue {
    static let queue = DispatchQueue(label: "dev.shudeng.pdfkit.text", qos: .userInitiated)
}

/// 后台 PDF 抽取的取消标记：串行队列 block 里没有 Task 上下文，用锁标记跨线程取消。
final class PDFWorkCancellation: @unchecked Sendable {
    private let lock = NSLock()
    private var cancelled = false

    var isCancelled: Bool {
        lock.lock()
        defer { lock.unlock() }
        return cancelled
    }

    func cancel() {
        lock.lock()
        cancelled = true
        lock.unlock()
    }
}

/// 判断无文字页是否真的有画面内容（扫描页）：低分辨率渲染后找非白像素。
/// 纯白页（含纯白尾页）返回 false，避免被判成扫描页而弹提示/常驻「?」。
private enum PDFPageInk {
    static func hasInk(_ page: PDFPage) -> Bool {
        let thumbnail = page.thumbnail(of: CGSize(width: 32, height: 44), for: .cropBox)
        guard let image = thumbnail.cgImage, image.width > 0, image.height > 0 else { return true }
        let width = image.width
        let height = image.height
        var pixels = [UInt8](repeating: 0, count: width * height * 4)
        guard let context = CGContext(
            data: &pixels,
            width: width,
            height: height,
            bitsPerComponent: 8,
            bytesPerRow: width * 4,
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ) else { return true }
        context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
        for index in stride(from: 0, to: pixels.count, by: 4) {
            let alpha = pixels[index + 3]
            guard alpha > 16 else { continue }
            if pixels[index] < 245 || pixels[index + 1] < 245 || pixels[index + 2] < 245 { return true }
        }
        return false
    }

    /// 对无文字页抽样做墨迹判定：优先最后 `tail` 页（识别纯白尾页），其余在剩余页里均匀抽样到 `limit` 页。
    /// 大扫描文件不能逐页渲染（4000 页会 19× 慢）；未抽样的无文字页由调用方保守按扫描页计。
    static func sampleNoTextPages(_ indices: [Int], limit: Int, tail: Int) -> [Int] {
        guard !indices.isEmpty else { return [] }
        guard indices.count > limit else { return indices }
        let tailIndices = Array(indices.suffix(max(0, min(tail, indices.count))))
        var selected = Set(tailIndices)
        let remaining = indices.count - tailIndices.count
        let extra = max(0, limit - tailIndices.count)
        guard extra > 0, remaining > 0 else { return selected.sorted() }
        let step = max(1, remaining / extra)
        var cursor = 0
        var picked = 0
        while picked < extra, cursor < remaining {
            selected.insert(indices[cursor])
            cursor += step
            picked += 1
        }
        return selected.sorted()
    }
}

struct Book: Codable, Identifiable {
    let id: String
    let title: String
    let author: String
    /// 可选以兼容旧目录；nil 语义等同 .epub。
    var format: BookFormat?
    /// 仅 PDF 书籍写入；EPUB 为 nil。
    var pdfInfo: PDFInfo?
    var locatorJSON: String?
    var readingSettings: ReadingSettings?
    var bookmarks: [Bookmark]?
    var notes: [BookNote]?
    var noteDrafts: [BookNote]?
    var recordIdentity: UUID?
    var removal: BookRemoval?

    /// 旧目录没有 format；文件与阅读路径都按 EPUB 处理。
    var resolvedFormat: BookFormat { format ?? .epub }
}

enum BookRemoval: String, Codable {
    case removing, removed, deleting
    var pending: Bool { self != .removed }
}

/// 高亮四色。旧数据缺少 color 时按 .yellow 渲染。
enum HighlightColor: String, Codable, CaseIterable, Identifiable {
    case yellow, green, blue, rose

    var id: String { rawValue }

    var title: String {
        switch self {
        case .yellow: return "黄色"
        case .green: return "青瓷"
        case .blue: return "雾蓝"
        case .rose: return "胭脂"
        }
    }
}

/// PDF 页内归一化矩形：相对页面 cropBox，0...1，原点在左下（PDF 坐标）。
struct PDFNormRect: Codable, Equatable {
    var x: Double
    var y: Double
    var w: Double
    var h: Double
}

/// PDF 标注几何：`page` 是 1-based 页号，`rects` 是该页内的多行归一化矩形。
/// EPUB 与原旧笔记没有该字段（nil），Codable 兼容。
struct PDFNoteGeometry: Codable, Equatable {
    var page: Int
    var rects: [PDFNormRect]
}

struct BookNote: Codable, Identifiable {
    let id: UUID
    let locatorJSON: String
    var body: String
    /// 可选以兼容旧 JSON/导出；nil 语义等同 .yellow。
    var color: HighlightColor?
    /// PDF 标注几何；EPUB 与旧数据为 nil（不渲染 PDF 标注）。
    var pdf: PDFNoteGeometry?

    init(locator: Locator, body: String = "", color: HighlightColor? = nil, pdf: PDFNoteGeometry? = nil) {
        id = UUID()
        locatorJSON = locator.description
        self.body = body
        self.color = color
        self.pdf = pdf
    }

    var highlightColor: HighlightColor { color ?? .yellow }

    func location() throws -> Locator {
        guard let locator = try Locator(json: JSONValue(jsonString: locatorJSON, warnings: nil), warnings: nil) else {
            throw LibraryError.invalidLocation
        }
        return locator
    }
    var quote: String { (try? location().text.highlight) ?? "" }
}

struct Bookmark: Codable, Identifiable {
    let id: UUID
    let locatorJSON: String
    let title: String
    let excerpt: String

    init(locator: Locator) {
        id = UUID()
        locatorJSON = locator.description
        title = locator.title ?? "书签"
        excerpt = locator.text.highlight ?? ""
    }

    func location() throws -> Locator {
        guard let locator = try Locator(json: JSONValue(jsonString: locatorJSON, warnings: nil), warnings: nil) else {
            throw LibraryError.invalidLocation
        }
        return locator
    }
}

extension PDFNoteGeometry {
    /// 从 PDFKit 选区生成归一化几何 + 页级 locator（`pdf://page/N`）。
    /// 只用选区第一页（模型只有单个 page 字段），多行选择转成多个 rect。
    static func make(from selection: PDFKit.PDFSelection, document: PDFKit.PDFDocument) -> (geometry: PDFNoteGeometry, locator: Locator)? {
        guard let page = selection.pages.first else { return nil }
        let pageCount = document.pageCount
        let pageIndex = document.index(for: page)
        guard pageCount > 0, pageIndex >= 0, pageIndex < pageCount else { return nil }
        let pageNumber = pageIndex + 1
        let pageBounds = page.bounds(for: .cropBox)
        guard pageBounds.width > 0, pageBounds.height > 0 else { return nil }
        var rects: [PDFNormRect] = []
        for line in selection.selectionsByLine() {
            guard line.pages.contains(where: { $0 === page }) else { continue }
            let bounds = line.bounds(for: page)
            guard bounds.width > 0.1, bounds.height > 0.1 else { continue }
            rects.append(PDFNormRect(
                x: clamp01((bounds.minX - pageBounds.minX) / pageBounds.width),
                y: clamp01((bounds.minY - pageBounds.minY) / pageBounds.height),
                w: clamp01(bounds.width / pageBounds.width),
                h: clamp01(bounds.height / pageBounds.height)
            ))
        }
        guard !rects.isEmpty else { return nil }
        let quote = (selection.string ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !quote.isEmpty else { return nil }
        let context = pageContext(page: page, quote: quote)
        // 与阅读器进度口径统一：首页 0，末页 1（单页 PDF 为 1）。
        let progression = pageCount > 1 ? Double(pageNumber - 1) / Double(pageCount - 1) : 1
        guard let href = AnyURL(string: "pdf://page/\(pageNumber)") else { return nil }
        let locator = Locator(
            href: href,
            mediaType: .pdf,
            title: "第 \(pageNumber) 页",
            locations: .init(
                fragments: ["page=\(pageNumber)"],
                progression: progression,
                totalProgression: progression,
                position: pageNumber,
                otherLocations: ["page": .integer(pageNumber)]
            ),
            text: .init(after: context.after, before: context.before, highlight: quote)
        )
        return (PDFNoteGeometry(page: pageNumber, rects: rects), locator)
    }

    private static func clamp01(_ value: Double) -> Double { max(0, min(1, value)) }

    /// 页面文字里 quote 的前后各 80 字，作为页级 locator 的上下文（找不到时为空）。
    private static func pageContext(page: PDFKit.PDFPage, quote: String) -> (before: String, after: String) {
        guard let text = page.string, !text.isEmpty else { return ("", "") }
        let source = text as NSString
        let range = source.range(of: quote)
        guard range.location != NSNotFound else { return ("", "") }
        let beforeStart = max(0, range.location - 80)
        let before = source.substring(with: NSRange(location: beforeStart, length: range.location - beforeStart))
        let afterStart = NSMaxRange(range)
        let afterLength = min(80, source.length - afterStart)
        let after = afterLength > 0 ? source.substring(with: NSRange(location: afterStart, length: afterLength)) : ""
        return (before, after)
    }
}

struct ImportedBook {
    let book: Book
    let isDuplicate: Bool
}

enum SavedRecordKind: String {
    case note, bookmark
}

/// Additive display metadata kept outside the existing catalogue schema.
/// Existing note, draft, bookmark and book JSON remains byte-compatible with
/// the previous model; no synthetic timestamps are invented when this file is
/// absent or unreadable.
@MainActor
private final class RecordTimestampStore {
    private let file: URL
    private var values: [String: Date]
    private var canWrite: Bool

    init(root: URL) {
        file = root.appendingPathComponent("record-timestamps.json")
        do {
            let data = try Data(contentsOf: file)
            let decoder = JSONDecoder()
            decoder.dateDecodingStrategy = .iso8601
            values = try decoder.decode([String: Date].self, from: data)
            canWrite = true
        } catch let error as CocoaError where error.code == .fileReadNoSuchFile {
            values = [:]
            canWrite = true
        } catch {
            values = [:]
            canWrite = false
        }
    }

    func timestamp(kind: SavedRecordKind, bookID: String, recordID: UUID) -> Date? {
        values[key(kind: kind, bookID: bookID, recordID: recordID)]
    }

    func recordIfAbsent(kind: SavedRecordKind, bookID: String, recordID: UUID, at date: Date = Date()) {
        guard canWrite else { return }
        let key = key(kind: kind, bookID: bookID, recordID: recordID)
        guard values[key] == nil else { return }
        var updated = values
        updated[key] = date
        do {
            let encoder = JSONEncoder()
            encoder.dateEncodingStrategy = .iso8601
            encoder.outputFormatting = [.sortedKeys]
            try encoder.encode(updated).write(to: file, options: .atomic)
            values = updated
        } catch {
            canWrite = false
        }
    }

    private func key(kind: SavedRecordKind, bookID: String, recordID: UUID) -> String {
        kind.rawValue + ":" + bookID + ":" + recordID.uuidString
    }
}

enum LibraryError: LocalizedError {
    case unsupported, invalid, save, missing, invalidLocation, busy
    var errorDescription: String? {
        switch self {
        case .unsupported: return "仅支持未加密的可重排 EPUB 与 PDF，暂不支持固定版式 EPUB。"
        case .invalid: return "文件损坏或内容无法读取，未加入书架。"
        case .save: return "保存失败，请检查设备储存空间后重试。"
        case .missing: return "原文文件不可用，请重新导入相同文件。"
        case .invalidLocation: return "已保存的阅读位置无法读取，未覆盖原记录。"
        case .busy: return "此书的操作尚未完成，请重试原操作后再导入。"
        }
    }
}

@MainActor
final class LibraryStore {
    static let changed = Notification.Name("LibraryChanged")
    private(set) var books: [Book] = []
    let root: URL
    let secrets: AISecrets
    lazy var preparation = BookPreparation(root: root)
    let questions: QuestionStore
    private var operations: Set<String> = []
    private var revisions: [String: UUID] = [:]
    private let fileManager = FileManager.default
    private lazy var recordTimestamps = RecordTimestampStore(root: root)
    private let http = DefaultHTTPClient()
    private lazy var retriever = AssetRetriever(httpClient: http)
    private lazy var opener = PublicationOpener(
        parser: DefaultPublicationParser(httpClient: http, assetRetriever: retriever, pdfFactory: DefaultPDFDocumentFactory()),
        contentProtections: []
    )
    private var catalog: URL { root.appendingPathComponent("library.json") }
    private var files: URL { root.appendingPathComponent("Books", isDirectory: true) }
    private var semanticModelObserver: NSObjectProtocol?

    init(root: URL, secrets: AISecrets = KeychainSecrets()) throws {
        self.root = root
        self.secrets = secrets
        let filesURL = root.appendingPathComponent("Books", isDirectory: true)
        try fileManager.createDirectory(at: filesURL, withIntermediateDirectories: true)
        questions = QuestionStore(root: root, secrets: secrets)
        if fileManager.fileExists(atPath: catalog.path) {
            books = try JSONDecoder().decode([Book].self, from: Data(contentsOf: catalog))
        }
        questions.canSave = { [weak self] record in
            guard let book = self?.books.first(where: { $0.id == record.bookID }), book.removal != .deleting else { return false }
            return book.recordIdentity == record.bookIdentity
        }
        questions.canGenerate = { [weak self] id in self?.sourceAvailable(for: id) == true }
        // 语义模型按需下载完成/移除后，允许已降级的书籍重新准备语义资料。
        semanticModelObserver = NotificationCenter.default.addObserver(
            forName: SemanticModelStore.changed,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in self?.retrySemanticPreparation() }
        }
    }

    deinit {
        if let semanticModelObserver { NotificationCenter.default.removeObserver(semanticModelObserver) }
    }

    @MainActor
    private func retrySemanticPreparation() {
        guard SemanticModelStore.hasLocalModel else { return }
        for book in books where book.removal == nil {
            let file = fileURL(for: book)
            guard fileManager.fileExists(atPath: file.path) else { continue }
            preparation.retrySemanticPreparationIfNeeded(book, file: file)
        }
    }

    func importBook(
        from source: URL,
        pdfProgress: (@MainActor (PDFCheckProgress) -> Void)? = nil,
        confirmPDFInfo: (@MainActor (PDFInfo) async -> Bool)? = nil
    ) async throws -> ImportedBook {
        guard let format = BookFormat(fileExtension: source.pathExtension) else { throw LibraryError.unsupported }
        let scoped = source.startAccessingSecurityScopedResource()
        defer { if scoped { source.stopAccessingSecurityScopedResource() } }
        let staged = root.appendingPathComponent(UUID().uuidString + "." + format.fileExtension)
        defer { try? fileManager.removeItem(at: staged) }
        // The picker hands us a coordinated local copy; staging keeps validation and
        // identity tied to exactly the bytes we will retain, even for file providers.
        do { try fileManager.copyItem(at: source, to: staged) }
        catch { throw LibraryError.save }
        let id = try await Self.digest(staged)
        guard !operations.contains(id), books.first(where: { $0.id == id })?.removal?.pending != true else { throw LibraryError.busy }
        operations.insert(id)
        defer { operations.remove(id) }
        let existing = books.first { $0.id == id }
        // Each format validates exactly the staged bytes with its own parser.
        let imported: (title: String, author: String, pdfInfo: PDFInfo?)
        switch format {
        case .epub:
            let publication = try await validatedPublication(at: staged)
            imported = (publication.metadata.title ?? source.deletingPathExtension().lastPathComponent,
                        publication.metadata.authors.map { $0.name }.joined(separator: "、"),
                        nil)
        case .pdf:
            // 逐页文字检查在后台执行（ADR-0017）；有扫描页时先由 App 弹提示卡确认，
            // 用户取消则不落库、不写目录。
            let info = try await Self.checkPDF(at: staged) { progress in
                pdfProgress?(progress)
            }
            try Task.checkCancellation()
            if info.hasScannedPages, let confirmPDFInfo, await confirmPDFInfo(info) == false {
                throw CancellationError()
            }
            imported = (source.deletingPathExtension().lastPathComponent, "", info)
        }
        var book = existing ?? Book(id: id, title: imported.title, author: imported.author)
        book.format = format
        book.pdfInfo = imported.pdfInfo
        if existing == nil { book.recordIdentity = UUID() }
        book.removal = nil
        let destination = fileURL(for: book)
        let existed = fileManager.fileExists(atPath: destination.path)
        do {
            if existed {
                _ = try fileManager.replaceItemAt(destination, withItemAt: staged)
            } else {
                try fileManager.moveItem(at: staged, to: destination)
            }
            if existing == nil || existing?.removal != nil {
                try commit(books.filter { $0.id != id } + [book])
            }
        } catch {
            if !existed { try? fileManager.removeItem(at: destination) }
            throw LibraryError.save
        }
        preparation.start(book, file: destination)
        return ImportedBook(book: book, isDuplicate: existing != nil)
    }

    func prepareBooks() {
        Task {
            await recoverRemovals()
            for book in books where sourceAvailable(for: book.id) { preparation.start(book, file: fileURL(for: book)) }
        }
    }

    func recoverRemovals() async {
        for book in books where book.removal?.pending == true {
            do { try await removeBook(book.id, deleteRecords: book.removal == .deleting) }
            catch { NotificationCenter.default.post(name: Self.changed, object: self) }
        }
    }

    func sourceAvailable(for id: String) -> Bool {
        guard let book = books.first(where: { $0.id == id }), book.removal == nil else { return false }
        return fileManager.fileExists(atPath: fileURL(for: book).path)
    }

    func revision(for id: String) -> UUID {
        if let revision = revisions[id] { return revision }
        let revision = UUID(); revisions[id] = revision; return revision
    }
    func checkRevision(_ revision: UUID, for id: String) throws {
        guard revision == self.revision(for: id),
              let book = books.first(where: { $0.id == id }), book.removal?.pending != true else { throw LibraryError.missing }
    }

    func removeBook(_ id: String, deleteRecords: Bool = false) async throws {
        guard !operations.contains(id), let position = books.firstIndex(where: { $0.id == id }) else { throw LibraryError.busy }
        operations.insert(id)
        defer { operations.remove(id) }
        let intent: BookRemoval = deleteRecords ? .deleting : .removing
        guard books[position].removal != .deleting || deleteRecords else { throw LibraryError.busy }
        if books[position].removal != intent {
            var updated = books; updated[position].removal = intent
            try commit(updated) // Persist intent before any destructive work.
        }
        revisions[id] = UUID()
        questions.stop(bookID: id, preservingRecords: !deleteRecords)
        await preparation.stop(bookID: id)
        if !deleteRecords {
            for record in questions.records where record.bookID == id && questions.unsaved(record.id) {
                guard questions.save(record) else { throw LibraryError.save }
            }
        }
        try await preparation.index.remove(bookID: id)
        let file = fileURL(for: books.first { $0.id == id }!)
        if fileManager.fileExists(atPath: file.path) { try fileManager.removeItem(at: file) }
        if deleteRecords { try questions.remove(bookID: id) }
        var updated = books
        if deleteRecords { updated.removeAll { $0.id == id } }
        else if let index = updated.firstIndex(where: { $0.id == id }) { updated[index].removal = .removed }
        try commit(updated)
    }

    func fileURL(for book: Book) -> URL {
        files.appendingPathComponent(book.id + "." + book.resolvedFormat.fileExtension)
    }

    func open(_ book: Book) async throws -> Publication {
        // PDF 不经过 Readium 的 Publication 管线；阅读由 PDFReaderController 用 PDFKit 完成。
        guard book.resolvedFormat == .epub else { throw LibraryError.unsupported }
        let revision = revision(for: book.id)
        guard sourceAvailable(for: book.id), books.first(where: { $0.id == book.id })?.recordIdentity == book.recordIdentity else { throw LibraryError.missing }
        let publication = try await validatedPublication(at: fileURL(for: book))
        guard revision == self.revision(for: book.id), sourceAvailable(for: book.id) else { throw LibraryError.missing }
        return publication
    }

    func location(for id: String) throws -> Locator? {
        guard let json = books.first(where: { $0.id == id })?.locatorJSON else { return nil }
        do {
            guard let location = try Locator(json: JSONValue(jsonString: json, warnings: nil), warnings: nil) else { throw LibraryError.invalidLocation }
            return location
        }
        catch { throw LibraryError.invalidLocation }
    }

    func saveLocation(_ locator: Locator, for id: String) throws {
        try saveReadingState(locator, settings: books.first(where: { $0.id == id })?.readingSettings ?? ReadingSettings(), for: id)
    }

    func saveReadingState(_ locator: Locator, settings: ReadingSettings, for id: String) throws {
        guard let index = books.firstIndex(where: { $0.id == id }) else { throw LibraryError.missing }
        var updated = books
        updated[index].locatorJSON = locator.description
        updated[index].readingSettings = settings
        do { try commit(updated) } catch { throw LibraryError.save }
    }

    func saveBookmark(_ bookmark: Bookmark, for id: String) throws {
        guard let index = books.firstIndex(where: { $0.id == id }) else { throw LibraryError.missing }
        let location = try bookmark.location()
        let existing = books[index].bookmarks ?? []
        // Reflow changes progression, but not the element-scoped quotation.
        if existing.contains(where: {
            guard $0.id != bookmark.id else { return true }
            guard let saved = try? $0.location() else { return false }
            return saved.href == location.href && saved.locations.cssSelector == location.locations.cssSelector && saved.text == location.text
        }) { return }
        var updated = books
        updated[index].bookmarks = existing + [bookmark]
        do { try commit(updated) } catch { throw LibraryError.save }
        recordTimestamps.recordIfAbsent(kind: .bookmark, bookID: id, recordID: bookmark.id)
    }

    func removeBookmark(_ bookmarkID: UUID, for id: String) throws {
        guard let index = books.firstIndex(where: { $0.id == id }) else { throw LibraryError.missing }
        var updated = books
        updated[index].bookmarks = (updated[index].bookmarks ?? []).filter { $0.id != bookmarkID }
        do { try commit(updated) } catch { throw LibraryError.save }
    }

    private func commit(_ updated: [Book]) throws {
        let data = try JSONEncoder().encode(updated)
        try data.write(to: catalog, options: .atomic)
        books = updated // Publish success only after the atomic rename succeeds.
        NotificationCenter.default.post(name: Self.changed, object: self)
    }

    func saveNote(_ note: BookNote, for id: String, draft: Bool = false, highlightOnly: Bool = false) throws {
        guard let index = books.firstIndex(where: { $0.id == id }) else { throw LibraryError.missing }
        // Re-highlighting an existing record is not a submission of its body.
        // In particular it must never consume a newer saved editing draft.
        if highlightOnly, books[index].notes?.contains(where: { $0.id == note.id }) == true { return }
        let locator = try note.location()
        guard !(locator.text.highlight ?? "").isEmpty else { throw LibraryError.invalidLocation }
        // PDF 标注用页内归一化几何定位（无 DOM）；EPUB 仍要求 domRange 与原文映射。
        if note.pdf == nil {
            guard locator.locations.domRange != nil else { throw LibraryError.invalidLocation }
        }
        var updated = books
        if draft {
            var drafts = updated[index].noteDrafts ?? []
            if let existing = drafts.firstIndex(where: { $0.id == note.id }) { drafts[existing] = note }
            else { drafts.append(note) }
            updated[index].noteDrafts = drafts
        } else {
            var notes = updated[index].notes ?? []
            if let existing = notes.firstIndex(where: { $0.id == note.id }) { notes[existing] = note }
            else {
                var added = note
                if highlightOnly { added.body = "" }
                notes.append(added)
            }
            updated[index].notes = notes
            if !highlightOnly { updated[index].noteDrafts = (updated[index].noteDrafts ?? []).filter { $0.id != note.id } }
        }
        do { try commit(updated) } catch { throw LibraryError.save }
        recordTimestamps.recordIfAbsent(kind: .note, bookID: id, recordID: note.id)
    }

    /// 删除一条高亮/笔记记录（同时清理同名草稿）；不改动 JSON 结构与其他记录。
    func removeNote(_ noteID: UUID, bookID: String) throws {
        guard let index = books.firstIndex(where: { $0.id == bookID }) else { throw LibraryError.missing }
        var updated = books
        var changed = false
        if let notes = updated[index].notes, notes.contains(where: { $0.id == noteID }) {
            updated[index].notes = notes.filter { $0.id != noteID }
            changed = true
        }
        if let drafts = updated[index].noteDrafts, drafts.contains(where: { $0.id == noteID }) {
            updated[index].noteDrafts = drafts.filter { $0.id != noteID }
            changed = true
        }
        guard changed else { throw LibraryError.missing }
        do { try commit(updated) } catch { throw LibraryError.save }
    }

    /// 仅修改已有高亮的颜色（含同名草稿），保留正文与位置。
    func updateNoteColor(_ color: HighlightColor, forNoteID noteID: UUID, bookID: String) throws {
        guard let index = books.firstIndex(where: { $0.id == bookID }) else { throw LibraryError.missing }
        var updated = books
        var changed = false
        if var notes = updated[index].notes, let noteIndex = notes.firstIndex(where: { $0.id == noteID }) {
            notes[noteIndex].color = color
            updated[index].notes = notes
            changed = true
        }
        if var drafts = updated[index].noteDrafts, let draftIndex = drafts.firstIndex(where: { $0.id == noteID }) {
            drafts[draftIndex].color = color
            updated[index].noteDrafts = drafts
            changed = true
        }
        guard changed else { throw LibraryError.missing }
        do { try commit(updated) } catch { throw LibraryError.save }
    }

    func recordTimestamp(kind: SavedRecordKind, bookID: String, recordID: UUID) -> Date? {
        recordTimestamps.timestamp(kind: kind, bookID: bookID, recordID: recordID)
    }

    private func validatedPublication(at url: URL) async throws -> Publication {
        do {
            guard let file = FileURL(url: url) else { throw LibraryError.invalid }
            let asset = try await retriever.retrieve(url: file).get()
            guard case let .container(epub) = asset,
                  let containerXML = epub.container[AnyURL(string: "META-INF/container.xml")!] else { throw LibraryError.invalid }
            let container = try EPUBDocument(data: try await containerXML.read().get())
            guard let path = container.packagePath, let packageURL = AnyURL(string: path),
                  let package = epub.container[packageURL] else { throw LibraryError.invalid }
            let packageDocument = try EPUBDocument(data: try await package.read().get())
            // Readium 3.11 does not retain per-item rendition:layout overrides.
            guard !packageDocument.hasFixedSpineItem else { throw LibraryError.unsupported }
            let publication = try await opener.open(asset: asset, allowUserInteraction: false).get()
            guard !publication.isRestricted, publication.conforms(to: .epub),
                  publication.metadata.layout != .fixed else { throw LibraryError.unsupported }
            guard !publication.readingOrder.isEmpty else { throw LibraryError.invalid }
            // Parsing the OPF alone accepts missing/truncated chapters. Read every
            // spine resource before publishing a successful import.
            for link in publication.readingOrder {
                guard link.mediaType == .xhtml || link.mediaType == .html,
                      let resource = publication.get(link) else { throw LibraryError.invalid }
                let data = try await resource.read().get()
                guard !data.isEmpty else { throw LibraryError.invalid }
                if link.mediaType == .xhtml {
                    guard try EPUBDocument(data: data).rootElement == "html" else { throw LibraryError.invalid }
                }
            }
            return publication
        } catch let error as LibraryError { throw error }
        catch { throw LibraryError.invalid }
    }

    /// 后台检查 PDF：统计文字页 / 扫描页（无文字但有画面）/ 纯空白页。
    ///
    /// 所有 PDFDocument 访问都在独立串行队列上（PDFKit 非线程安全），每页 autoreleasepool；
    /// 进度每 1%（至少 1 页）节流回主线程；取消标记由 Task 取消处理器置位。
    private nonisolated static func checkPDF(
        at url: URL,
        progress: @escaping @MainActor (PDFCheckProgress) -> Void
    ) async throws -> PDFInfo {
        let cancellation = PDFWorkCancellation()
        return try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { continuation in
                PDFKitWorkQueue.queue.async {
                    do {
                        let info: PDFInfo = try autoreleasepool {
                            guard let document = PDFKit.PDFDocument(url: url) else { throw LibraryError.invalid }
                            guard !document.isLocked else { throw LibraryError.unsupported }
                            let total = document.pageCount
                            guard total > 0 else { throw LibraryError.invalid }
                            var textPages = 0
                            var noTextIndices: [Int] = []
                            let step = max(1, total / 100)
                            // 第一遍只读文字层（基线 ~3.5s）：不在这里渲染任何缩略图。
                            for index in 0..<total {
                                if cancellation.isCancelled { throw CancellationError() }
                                let hasText = autoreleasepool { () -> Bool in
                                    document.page(at: index)?.string?
                                        .trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
                                }
                                if hasText { textPages += 1 } else { noTextIndices.append(index) }
                                let completed = index + 1
                                if completed == 1 || completed % step == 0 || completed == total {
                                    let value = PDFCheckProgress(completed: completed, total: total)
                                    Task { @MainActor in progress(value) }
                                }
                            }
                            var scannedPages = 0
                            var blankPages = 0
                            if textPages == 0 {
                                // 整本扫描：直接按扫描页处理，跳过逐页墨迹渲染（4000 页性能关键）。
                                scannedPages = total
                            } else if !noTextIndices.isEmpty {
                                // 有文字页的混合文档：只抽样最多 40 个无文字页做墨迹判定（优先尾部 10 页），
                                // 其余未抽样的无文字页保守按扫描页计（不漏提示），避免全量渲染。
                                let sampled = PDFPageInk.sampleNoTextPages(noTextIndices, limit: 40, tail: 10)
                                for index in sampled {
                                    if cancellation.isCancelled { throw CancellationError() }
                                    let hasInk = autoreleasepool { () -> Bool in
                                        guard let page = document.page(at: index) else { return false }
                                        return PDFPageInk.hasInk(page)
                                    }
                                    if hasInk { scannedPages += 1 } else { blankPages += 1 }
                                }
                                scannedPages += noTextIndices.count - sampled.count
                            }
                            return PDFInfo(
                                pageCount: total,
                                textPageCount: textPages,
                                blankPageCount: blankPages > 0 ? blankPages : nil
                            )
                        }
                        continuation.resume(returning: info)
                    } catch {
                        continuation.resume(throwing: error)
                    }
                }
            }
        } onCancel: {
            cancellation.cancel()
        }
    }

    /// 内容指纹用于去重。nonisolated async：大文件哈希离开主线程执行，可被取消。
    private nonisolated static func digest(_ url: URL) async throws -> String {
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        var hash = SHA256()
        while let data = try handle.read(upToCount: 1024 * 1024), !data.isEmpty {
            try Task.checkCancellation()
            hash.update(data: data)
        }
        return hash.finalize().map { String(format: "%02x", $0) }.joined()
    }
}

/// Minimal structural checks alongside Readium's publication parser; external
/// entities are never resolved. This is not a replacement for EPUBCheck.
private final class EPUBDocument: NSObject, XMLParserDelegate {
    private(set) var packagePath: String?
    private(set) var hasFixedSpineItem = false
    private(set) var rootElement: String?

    init(data: Data) throws {
        super.init()
        let parser = XMLParser(data: data)
        parser.shouldProcessNamespaces = true
        parser.shouldResolveExternalEntities = false
        parser.delegate = self
        guard parser.parse(), parser.parserError == nil else { throw LibraryError.invalid }
    }

    func parser(_ parser: XMLParser, didStartElement elementName: String, namespaceURI: String?, qualifiedName qName: String?, attributes: [String: String]) {
        if rootElement == nil { rootElement = elementName }
        if elementName == "rootfile", packagePath == nil { packagePath = attributes["full-path"] }
        if elementName == "itemref", attributes["properties"]?.split(whereSeparator: { $0.isWhitespace }).contains("rendition:layout-pre-paginated") == true {
            hasFixedSpineItem = true
        }
    }
}
