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

enum LibraryError: LocalizedError {
    case unsupported, invalid, save, missing, invalidLocation
    var errorDescription: String? {
        switch self {
        case .unsupported: return "仅支持未加密的可重排 EPUB，暂不支持 PDF 或固定版式。"
        case .invalid: return "文件损坏或内容无法读取，未加入书架。"
        case .save: return "保存失败，请检查设备储存空间后重试。"
        case .missing: return "原文文件不可用，请重新导入相同文件。"
        case .invalidLocation: return "已保存的阅读位置无法读取，未覆盖原记录。"
        }
    }
}

@MainActor
final class LibraryStore {
    private(set) var books: [Book] = []
    let root: URL
    private let fileManager = FileManager.default
    private let http = DefaultHTTPClient()
    private lazy var retriever = AssetRetriever(httpClient: http)
    private lazy var opener = PublicationOpener(
        parser: DefaultPublicationParser(httpClient: http, assetRetriever: retriever, pdfFactory: DefaultPDFDocumentFactory()),
        contentProtections: []
    )
    private var catalog: URL { root.appendingPathComponent("library.json") }
    private var files: URL { root.appendingPathComponent("Books", isDirectory: true) }

    init(root: URL) throws {
        self.root = root
        try fileManager.createDirectory(at: files, withIntermediateDirectories: true)
        if fileManager.fileExists(atPath: catalog.path) {
            books = try JSONDecoder().decode([Book].self, from: Data(contentsOf: catalog))
        }
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
        let publication = try await validatedPublication(at: staged)
        let existing = books.first { $0.id == id }
        let book = existing ?? Book(id: id, title: publication.metadata.title ?? source.deletingPathExtension().lastPathComponent,
                                   author: publication.metadata.authors.map { $0.name }.joined(separator: "、"))
        let destination = fileURL(for: book)
        let existed = fileManager.fileExists(atPath: destination.path)
        do {
            if existed {
                _ = try fileManager.replaceItemAt(destination, withItemAt: staged)
            } else {
                try fileManager.moveItem(at: staged, to: destination)
            }
            if existing == nil {
                let updated = books + [book]
                try commit(updated)
            }
        } catch {
            if !existed { try? fileManager.removeItem(at: destination) }
            throw LibraryError.save
        }
        return ImportedBook(book: book, isDuplicate: existing != nil)
    }

    func fileURL(for book: Book) -> URL { files.appendingPathComponent(book.id + ".epub") }

    func open(_ book: Book) async throws -> Publication {
        guard fileManager.fileExists(atPath: fileURL(for: book).path) else { throw LibraryError.missing }
        return try await validatedPublication(at: fileURL(for: book))
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
