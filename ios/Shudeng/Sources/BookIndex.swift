import Foundation
import SQLite3
import SwiftSoup
import ReadiumShared
import ReadiumStreamer

struct BookPreparationState {
    var completed = 0
    var total = 0
    var failure: String?
    var preparing = true
    var ready: Bool { !preparing && total > 0 && completed == total && failure == nil }
    var message: String {
        if let failure { return "资料准备失败（已完成\(completed)/\(total)章）：\(failure)；仍可阅读" }
        return ready ? "书内资料可用（\(total)章）" : "正在准备书内资料（已完成\(completed)/\(total)章），不影响阅读"
    }
}

struct BookSearchHit {
    let id: String
    let chapter: String
    let context: String
    let locator: Locator
}

/// UI state only; parsing, SQLite and search run on BookIndex's actor.
@MainActor
final class BookPreparation {
    static let changed = Notification.Name("BookPreparationChanged")
    let index: BookIndex
    private(set) var states: [String: BookPreparationState] = [:]
    private var jobs: [String: Task<Void, Never>] = [:]

    init(root: URL) { index = BookIndex(url: root.appendingPathComponent("book-index.sqlite")) }
    func start(_ book: Book, file: URL, rebuild: Bool = false) {
        guard jobs[book.id] == nil else { return }
        if !rebuild, states[book.id]?.ready == true { return }
        var state = states[book.id] ?? BookPreparationState()
        state.preparing = true; state.failure = nil
        states[book.id] = state
        notify()
        jobs[book.id] = Task {
            do {
                if var committed = try? await index.state(bookID: book.id) {
                    committed.preparing = true
                    update(committed, for: book.id)
                }
                try await index.prepare(bookID: book.id, file: file, rebuild: rebuild) { state in
                    self.update(state, for: book.id)
                }
            } catch is CancellationError {
                // Startup resumes the committed chapter checkpoint.
            } catch {
                var state = states[book.id] ?? BookPreparationState()
                state.failure = (error as? IndexError)?.errorDescription ?? "无法读取或保存资料，请检查文件与储存空间后重试"
                state.preparing = false
                states[book.id] = state
            }
            jobs[book.id] = nil
            notify()
        }
    }
    private func update(_ state: BookPreparationState, for id: String) { states[id] = state; notify() }
    private func notify() { NotificationCenter.default.post(name: Self.changed, object: self) }
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
        try db.initialize(bookID, total: order.count, contents: try toc.jsonString(), rebuild: rebuild)
        var completed = try db.completed(bookID)
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
            let fragments = try BookText.fragments(html: html, href: link.url(), title: chapterTitle)
            try Task.checkCancellation()
            // No suspension: chapter, original text, FTS and checkpoint commit together.
            try db.commit(bookID, chapter: completed, href: link.href, title: chapterTitle, fragments: fragments)
            completed += 1
            await progress(BookPreparationState(completed: completed, total: order.count, preparing: completed != order.count))
        }
    }

    func search(bookID: String, query: String) throws -> [BookSearchHit] {
        let query = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else { return [] }
        return try IndexDatabase(url: url).search(bookID, query: query)
    }
    func state(bookID: String) throws -> BookPreparationState { try IndexDatabase(url: url).state(bookID) }
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
        let document = try SwiftSoup.parse(html)
        guard let body = document.body() else { throw IndexError.source }
        var result: [BookFragment] = []
        func hidden(_ element: Element) -> Bool {
            excluded.contains(element.tagName()) || element.hasAttr("hidden") || (try? element.attr("aria-hidden")) == "true"
        }
        func hasBoundary(_ node: Node) -> Bool {
            guard let element = node as? Element else { return false }
            return blocks.contains(element.tagName()) || hidden(element) || element.getChildNodes().contains(where: hasBoundary)
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
                let locator = Locator(href: href, mediaType: .xhtml, title: title,
                    locations: .init(otherLocations: ["cssSelector": .string(selector(element)), "shudengTextNodes": .array(textNodes)]),
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
}

/// Short-lived connections, only used by BookIndex's actor.
private final class IndexDatabase {
    private var db: OpaquePointer?
    private let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
    init(url: URL) throws {
        guard sqlite3_open_v2(url.path, &db, SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE, nil) == SQLITE_OK else {
            sqlite3_close(db); throw IndexError.storage
        }
        do {
            try execute("CREATE TABLE IF NOT EXISTS preparations(book_id TEXT PRIMARY KEY, version INTEGER NOT NULL, total INTEGER NOT NULL, completed INTEGER NOT NULL DEFAULT 0)")
            try execute("CREATE TABLE IF NOT EXISTS chapters(book_id TEXT NOT NULL, ordinal INTEGER NOT NULL, href TEXT NOT NULL, title TEXT NOT NULL, PRIMARY KEY(book_id,ordinal))")
            try execute("CREATE TABLE IF NOT EXISTS contents(book_id TEXT PRIMARY KEY, links TEXT NOT NULL)")
            try execute("CREATE TABLE IF NOT EXISTS fragments(id INTEGER PRIMARY KEY, book_id TEXT NOT NULL, chapter INTEGER NOT NULL, ordinal INTEGER NOT NULL, original TEXT NOT NULL, locator TEXT NOT NULL, UNIQUE(book_id,chapter,ordinal))")
            try execute("CREATE INDEX IF NOT EXISTS fragments_book ON fragments(book_id,chapter,ordinal)")
            try execute("CREATE VIRTUAL TABLE IF NOT EXISTS fragment_terms USING fts5(book_id UNINDEXED, terms)")
        } catch { sqlite3_close(db); db = nil; throw error }
    }
    deinit { sqlite3_close(db) }
    private func execute(_ sql: String, _ args: [String] = []) throws {
        let statement = try statement(sql, args)
        defer { sqlite3_finalize(statement) }
        guard sqlite3_step(statement) == SQLITE_DONE else { throw IndexError.storage }
    }
    private func statement(_ sql: String, _ args: [String]) throws -> OpaquePointer {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK, let statement else { throw IndexError.storage }
        for (index, value) in args.enumerated() {
            guard sqlite3_bind_text(statement, Int32(index + 1), value, -1, transient) == SQLITE_OK else { sqlite3_finalize(statement); throw IndexError.storage }
        }
        return statement
    }
    private func rows(_ sql: String, _ args: [String]) throws -> [[String]] {
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
    private func transaction(_ body: () throws -> Void) throws {
        try execute("BEGIN IMMEDIATE")
        do { try body(); try execute("COMMIT") }
        catch { try? execute("ROLLBACK"); throw error }
    }
    func initialize(_ book: String, total: Int, contents: String, rebuild: Bool) throws {
        let old = try rows("SELECT version,total FROM preparations WHERE book_id=?", [book]).first
        try transaction {
            if rebuild || (old != nil && old != ["2", String(total)]) {
                try execute("DELETE FROM fragment_terms WHERE book_id=?", [book])
                try execute("DELETE FROM fragments WHERE book_id=?", [book])
                try execute("DELETE FROM chapters WHERE book_id=?", [book])
                try execute("DELETE FROM preparations WHERE book_id=?", [book])
                try execute("DELETE FROM contents WHERE book_id=?", [book])
            }
            try execute("INSERT OR IGNORE INTO preparations(book_id,version,total) VALUES(?,2,?)", [book, String(total)])
            try execute("INSERT OR REPLACE INTO contents VALUES(?,?)", [book, contents])
        }
    }
    func completed(_ book: String) throws -> Int { try state(book).completed }
    func state(_ book: String) throws -> BookPreparationState {
        guard let row = try rows("SELECT completed,total FROM preparations WHERE book_id=?", [book]).first else { return BookPreparationState() }
        return BookPreparationState(completed: Int(row[0])!, total: Int(row[1])!, preparing: row[0] != row[1])
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
    func search(_ book: String, query: String) throws -> [BookSearchHit] {
        let terms = BookText.tokens(query, query: true)
        guard !terms.isEmpty else { return [] }
        let candidates = try rows("SELECT f.chapter,f.ordinal,f.original,f.locator FROM fragment_terms t JOIN fragments f ON f.id=t.rowid WHERE fragment_terms MATCH ? AND f.book_id=? ORDER BY f.chapter,f.ordinal", [terms, book])
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
                if let nodes = base.locations.otherLocations["shudengTextNodes"]?.array {
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
}
