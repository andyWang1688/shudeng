import Foundation
import CryptoKit
import ReadiumShared
import ReadiumStreamer

struct ReadingSettings: Codable, Equatable {
    var scroll = false
    var fontSize = 100
    var dark = false
    // Optional for catalogs written before curl mode existed.
    var pageCurl: Bool? = nil
}

struct Book: Codable, Identifiable {
    let id: String
    let title: String
    let author: String
    var locatorJSON: String?
    var readingSettings: ReadingSettings?
    var bookmarks: [Bookmark]?
    var notes: [BookNote]?
    var noteDrafts: [BookNote]?
    var recordIdentity: UUID?
    var removal: BookRemoval?
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

struct BookNote: Codable, Identifiable {
    let id: UUID
    let locatorJSON: String
    var body: String
    /// 可选以兼容旧 JSON/导出；nil 语义等同 .yellow。
    var color: HighlightColor?

    init(locator: Locator, body: String = "", color: HighlightColor? = nil) {
        id = UUID()
        locatorJSON = locator.description
        self.body = body
        self.color = color
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
        case .unsupported: return "仅支持未加密的可重排 EPUB，暂不支持 PDF 或固定版式。"
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
    }

    func importBook(from source: URL) async throws -> ImportedBook {
        guard source.pathExtension.lowercased() == "epub" else { throw LibraryError.unsupported }
        let scoped = source.startAccessingSecurityScopedResource()
        defer { if scoped { source.stopAccessingSecurityScopedResource() } }
        let staged = root.appendingPathComponent(UUID().uuidString + ".epub")
        defer { try? fileManager.removeItem(at: staged) }
        // The picker hands us a coordinated local copy; staging keeps validation and
        // identity tied to exactly the bytes we will retain, even for file providers.
        do { try fileManager.copyItem(at: source, to: staged) }
        catch { throw LibraryError.save }
        let id = try Self.digest(staged)
        guard !operations.contains(id), books.first(where: { $0.id == id })?.removal?.pending != true else { throw LibraryError.busy }
        operations.insert(id)
        defer { operations.remove(id) }
        let publication = try await validatedPublication(at: staged)
        let existing = books.first { $0.id == id }
        var book = existing ?? Book(id: id, title: publication.metadata.title ?? source.deletingPathExtension().lastPathComponent,
                                   author: publication.metadata.authors.map { $0.name }.joined(separator: "、"))
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

    func fileURL(for book: Book) -> URL { files.appendingPathComponent(book.id + ".epub") }

    func open(_ book: Book) async throws -> Publication {
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
        guard locator.locations.domRange != nil, !(locator.text.highlight ?? "").isEmpty else { throw LibraryError.invalidLocation }
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

    private static func digest(_ url: URL) throws -> String {
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        var hash = SHA256()
        while let data = try handle.read(upToCount: 1024 * 1024), !data.isEmpty { hash.update(data: data) }
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
