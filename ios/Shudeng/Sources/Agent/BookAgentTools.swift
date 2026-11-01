import Foundation
import ReadiumShared

// MARK: - 书内数据源

/// 书内只读数据源。生产实现走 BookIndex；测试与未来替换实现只需满足这个协议。
protocol AgentBookSource: Sendable {
    func search(_ query: String, limit: Int) async throws -> [AgentBookExcerpt]
    /// PDF 的 page / EPUB 的章节序号（1-based）。
    func page(_ page: Int, maxCharacters: Int) async throws -> AgentBookPassage?
    /// 按标题、href 或序号匹配章节。
    func chapter(_ reference: String, maxCharacters: Int) async throws -> AgentBookPassage?
    func tableOfContents() async throws -> [AgentBookTOCEntry]
    func chapterList() async throws -> [AgentBookTOCEntry]
}

/// 一次检索/原文摘录：excerpt 展示给模型，quote 是完整原文（可被引用），
/// permits 校验用 quote 精确认回书内。
struct AgentBookExcerpt: Sendable, Equatable {
    let excerpt: String
    let quote: String
    let title: String
    let page: Int?
    let locatorJSON: String
}

struct AgentBookPassage: Sendable, Equatable {
    let title: String
    let page: Int?
    let excerpts: [AgentBookExcerpt]
    let truncated: Bool
}

struct AgentBookTOCEntry: Sendable, Equatable {
    let title: String
    let href: String
    let depth: Int
    let page: Int?
}

/// BookIndex 的只读适配器：工具层不直接碰 SQLite。
struct BookIndexAgentSource: AgentBookSource {
    let index: BookIndex
    let bookID: String

    func search(_ query: String, limit: Int) async throws -> [AgentBookExcerpt] {
        let hits = try await index.search(bookID: bookID, query: query)
        var seen: Set<String> = []
        var values: [AgentBookExcerpt] = []
        for hit in hits {
            let parts = hit.id.split(separator: "-")
            guard parts.count >= 2, let chapter = Int(parts[0]), let ordinal = Int(parts[1]) else { continue }
            let key = "\(chapter)-\(ordinal)"
            guard seen.insert(key).inserted else { continue }
            guard let fragment = try await index.agentFragment(bookID: bookID, chapter: chapter, ordinal: ordinal) else { continue }
            values.append(AgentBookExcerpt(excerpt: hit.context, quote: fragment.text, title: fragment.title,
                                           page: fragment.page, locatorJSON: fragment.locatorJSON))
            if values.count >= limit { break }
        }
        return values
    }

    func page(_ page: Int, maxCharacters: Int) async throws -> AgentBookPassage? {
        guard page >= 1 else { return nil }
        guard let text = try await index.agentChapterText(bookID: bookID, chapter: page - 1, maxCharacters: maxCharacters) else {
            return nil
        }
        return Self.passage(text)
    }

    func chapter(_ reference: String, maxCharacters: Int) async throws -> AgentBookPassage? {
        guard let info = try await index.agentChapterMatch(bookID: bookID, reference: reference),
              let text = try await index.agentChapterText(bookID: bookID, chapter: info.ordinal, maxCharacters: maxCharacters) else {
            return nil
        }
        return Self.passage(text)
    }

    func tableOfContents() async throws -> [AgentBookTOCEntry] {
        try await index.agentTableOfContents(bookID: bookID).map {
            AgentBookTOCEntry(title: $0.title, href: $0.href, depth: $0.depth, page: nil)
        }
    }

    func chapterList() async throws -> [AgentBookTOCEntry] {
        try await index.agentChapters(bookID: bookID).map {
            AgentBookTOCEntry(title: $0.title, href: $0.href, depth: 0, page: $0.page)
        }
    }

    private static func passage(_ value: BookChapterText) -> AgentBookPassage {
        AgentBookPassage(
            title: value.title,
            page: value.page,
            excerpts: value.fragments.map {
                AgentBookExcerpt(excerpt: $0.text, quote: $0.text, title: $0.title,
                                 page: $0.page, locatorJSON: $0.locatorJSON)
            },
            truncated: value.truncated
        )
    }
}

// MARK: - 环境快照

struct AgentBookNote: Sendable, Equatable {
    var quote: String
    var body: String
    var chapter: String
    var page: Int?
}

struct AgentCurrentLocation: Sendable, Equatable {
    var title: String
    var page: Int?
    var quote: String
    var progress: String?
}

/// 一次 Agent 会话的只读书内环境：由 UI 在打开问答时组装，运行期间不变。
struct BookAgentEnvironment: Sendable {
    let bookID: String
    let bookTitle: String
    let source: any AgentBookSource
    let notes: [AgentBookNote]
    let currentLocation: AgentCurrentLocation?

    /// 从现有 Book / BookIndex 组装工具环境；只复制快照，不持有 LibraryStore。
    static func make(book: Book, index: BookIndex, currentLocation: Locator? = nil, progress: String? = nil) -> BookAgentEnvironment {
        let notes = (book.notes ?? []).map { note -> AgentBookNote in
            let location = try? note.location()
            return AgentBookNote(quote: note.quote, body: note.body,
                                 chapter: location?.title ?? "阅读位置",
                                 page: note.pdf?.page ?? location?.pdfPageNumber)
        }
        var location: AgentCurrentLocation?
        if let currentLocation {
            location = AgentCurrentLocation(title: currentLocation.title ?? "阅读位置",
                                            page: currentLocation.pdfPageNumber,
                                            quote: currentLocation.text.highlight ?? "",
                                            progress: progress)
        }
        return BookAgentEnvironment(bookID: book.id, bookTitle: book.title,
                                    source: BookIndexAgentSource(index: index, bookID: book.id),
                                    notes: notes, currentLocation: location)
    }
}

// MARK: - 书内只读工具

enum BookAgentTools {
    static func make(environment: BookAgentEnvironment) -> [any AgentTool] {
        [
            BookSearchTool(environment: environment),
            BookReadPageTool(environment: environment),
            BookReadChapterTool(environment: environment),
            BookTOCTool(environment: environment),
            BookSearchNotesTool(environment: environment),
            BookCurrentLocationTool(environment: environment),
        ]
    }
}

/// 所有书内工具共享的原文/证据处理。
private enum BookToolSupport {
    static func locator(_ json: String) throws -> Locator {
        guard let locator = try Locator(json: JSONValue(jsonString: json, warnings: nil), warnings: nil) else {
            throw AgentToolError.unavailable("书内位置无法读取")
        }
        return locator
    }

    static func preview(_ text: String, limit: Int) -> String {
        let text = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard text.count > limit else { return text }
        return String(text.prefix(limit)) + "…（片段较长，仅显示前 \(limit) 字）"
    }

    static func locationLabel(title: String, page: Int?) -> String {
        if let page { return pageLabel(page: page, title: title) }
        return title.isEmpty ? "原文" : title
    }

    static func pageLabel(page: Int, title: String) -> String {
        title.hasPrefix("第") && title.contains("页") ? title : "第 \(page) 页"
    }

    static func folded(_ text: String) -> String {
        text.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: Locale(identifier: "en_US_POSIX"))
    }
}

struct BookSearchTool: AgentTool {
    let environment: BookAgentEnvironment

    var spec: AgentToolSpec {
        AgentToolSpec(
            name: "search_book",
            description: "在当前书中搜索关键词，返回可引用的原文片段。需要书内依据时先用它；没找到可以换更具体的词再试。",
            inputSchemaJSON: #"{"type":"object","properties":{"query":{"type":"string","description":"搜索关键词或短语，建议 2 个字以上"},"limit":{"type":"integer","description":"返回条数，1-8，默认 5","minimum":1,"maximum":8}},"required":["query"],"additionalProperties":false}"#
        )
    }

    func call(_ arguments: AgentToolArguments, context: AgentToolCallContext) async throws -> AgentToolResult {
        let query = try arguments.requiredString("query")
        let limit = try arguments.integer("limit", default: 5, range: 1...8)
        let hits = try await environment.source.search(query, limit: limit)
        guard !hits.isEmpty else {
            return .success("没有找到「\(query)」的原文。可以换关键词、查看目录，或明确告诉读者没有找到。")
        }
        var lines = ["search_book「\(query)」结果。引用时必须使用方括号里的 id，quote 必须是该条原文中的连续文字："]
        for hit in hits {
            let evidence = QuestionEvidence(id: "", locator: try BookToolSupport.locator(hit.locatorJSON), context: hit.quote)
            let registered = await context.evidence.register(evidence)
            let location = BookToolSupport.locationLabel(title: hit.title, page: hit.page)
            lines.append("[\(registered.id)] \(location)\n\(BookToolSupport.preview(hit.quote, limit: 900))")
        }
        return .success(lines.joined(separator: "\n\n"))
    }
}

struct BookReadPageTool: AgentTool {
    let environment: BookAgentEnvironment

    var spec: AgentToolSpec {
        AgentToolSpec(
            name: "read_page",
            description: "读取指定页（PDF）或指定章节序号（EPUB，第一章为 1）的原文。适合在目录或搜索定位后精读局部内容。",
            inputSchemaJSON: #"{"type":"object","properties":{"page":{"type":"integer","description":"页号（PDF）或章节序号（EPUB），从 1 开始","minimum":1,"maximum":20000}},"required":["page"],"additionalProperties":false}"#
        )
    }

    func call(_ arguments: AgentToolArguments, context: AgentToolCallContext) async throws -> AgentToolResult {
        let page = try arguments.integer("page", default: 0, range: 1...20000)
        guard let passage = try await environment.source.page(page, maxCharacters: 3000) else {
            return .failure("没有找到第 \(page) 页/章。可以先调用 book_toc 查看目录。")
        }
        return try await BookToolSupport.render(passage, target: "第 \(page) 页/章", evidence: context.evidence)
    }
}

struct BookReadChapterTool: AgentTool {
    let environment: BookAgentEnvironment

    var spec: AgentToolSpec {
        AgentToolSpec(
            name: "read_chapter",
            description: "按章节标题、href 或序号读取一章原文（PDF 也可按页序号读取）。用于精读某一章。",
            inputSchemaJSON: #"{"type":"object","properties":{"reference":{"type":"string","description":"章节标题、目录里的 href，或从 1 开始的章节序号"},"maxCharacters":{"type":"integer","description":"最多返回多少字，200-5000，默认 3000","minimum":200,"maximum":5000}},"required":["reference"],"additionalProperties":false}"#
        )
    }

    func call(_ arguments: AgentToolArguments, context: AgentToolCallContext) async throws -> AgentToolResult {
        let reference = try arguments.requiredString("reference")
        let maxCharacters = try arguments.integer("maxCharacters", default: 3000, range: 200...5000)
        guard let passage = try await environment.source.chapter(reference, maxCharacters: maxCharacters) else {
            return .failure("没有找到章节「\(reference)」。可以先调用 book_toc 查看目录。")
        }
        return try await BookToolSupport.render(passage, target: passage.title, evidence: context.evidence)
    }
}

struct BookTOCTool: AgentTool {
    let environment: BookAgentEnvironment

    var spec: AgentToolSpec {
        AgentToolSpec(
            name: "book_toc",
            description: "读取当前书的目录（PDF 按页组织时返回页码范围）。用于确定章节标题、href 或页码。",
            inputSchemaJSON: #"{"type":"object","properties":{},"required":[],"additionalProperties":false}"#
        )
    }

    func call(_ arguments: AgentToolArguments, context: AgentToolCallContext) async throws -> AgentToolResult {
        _ = try arguments.object()
        var entries = try await environment.source.tableOfContents()
        if entries.isEmpty { entries = try await environment.source.chapterList() }
        guard !entries.isEmpty else { return .success("这本书没有可用目录；可以用 read_page 从第 1 页/章开始读。") }
        let pages = entries.compactMap(\.page)
        if pages.count == entries.count, entries.count > 20 {
            return .success("book_toc：这本书按页组织，共 \(entries.count) 页（第 \(pages.min()!)–\(pages.max()!) 页）。可用 read_page(page:) 精读，或 search_book 定位。")
        }
        let limit = 120
        var lines = ["book_toc（共 \(entries.count) 条\(entries.count > limit ? "，仅显示前 \(limit) 条" : "")）："]
        for entry in entries.prefix(limit) {
            let indent = String(repeating: "  ", count: min(max(entry.depth, 0), 3))
            let title = entry.title.isEmpty ? entry.href : entry.title
            let page = entry.page.map { " · 第 \($0) 页" } ?? ""
            lines.append("\(indent)- \(title)\(page)")
        }
        return .success(lines.joined(separator: "\n"))
    }
}

struct BookSearchNotesTool: AgentTool {
    let environment: BookAgentEnvironment

    var spec: AgentToolSpec {
        AgentToolSpec(
            name: "search_notes",
            description: "搜索读者当前书的笔记与高亮。笔记是读者自己的记录，不是书内原文依据；引用原文仍需 search_book/read_page。",
            inputSchemaJSON: #"{"type":"object","properties":{"query":{"type":"string","description":"要搜索的关键词，建议 2 个字以上"}},"required":["query"],"additionalProperties":false}"#
        )
    }

    func call(_ arguments: AgentToolArguments, context: AgentToolCallContext) async throws -> AgentToolResult {
        let query = try arguments.requiredString("query")
        let folded = BookToolSupport.folded(query)
        let matches = environment.notes.filter {
            BookToolSupport.folded($0.quote).contains(folded)
                || BookToolSupport.folded($0.body).contains(folded)
                || BookToolSupport.folded($0.chapter).contains(folded)
        }
        guard !matches.isEmpty else { return .success("当前书的笔记里没有找到「\(query)」。") }
        var lines = ["search_notes「\(query)」结果（读者笔记，不是书内原文依据）："]
        for note in matches.prefix(10) {
            var row = "- 「\(BookToolSupport.preview(note.quote, limit: 120))」（\(note.chapter)\(note.page.map { " · 第 \($0) 页" } ?? "")）"
            let body = note.body.trimmingCharacters(in: .whitespacesAndNewlines)
            if !body.isEmpty { row += "：\(BookToolSupport.preview(body, limit: 200))" }
            lines.append(row)
        }
        return .success(lines.joined(separator: "\n"))
    }
}

struct BookCurrentLocationTool: AgentTool {
    let environment: BookAgentEnvironment

    var spec: AgentToolSpec {
        AgentToolSpec(
            name: "current_location",
            description: "读取读者当前阅读位置（章节/页、进度、当前位置选文）。只用于定位，选文本身不是可核查引用依据。",
            inputSchemaJSON: #"{"type":"object","properties":{},"required":[],"additionalProperties":false}"#
        )
    }

    func call(_ arguments: AgentToolArguments, context: AgentToolCallContext) async throws -> AgentToolResult {
        _ = try arguments.object()
        guard let location = environment.currentLocation else {
            return .success("当前没有可用的阅读位置。")
        }
        var lines = ["current_location：\(location.title)\(location.page.map { " · 第 \($0) 页" } ?? "")"]
        if let progress = location.progress, !progress.isEmpty { lines.append("阅读进度：\(progress)") }
        let quote = location.quote.trimmingCharacters(in: .whitespacesAndNewlines)
        if !quote.isEmpty {
            lines.append("当前位置选文（仅供参考定位，不是可核查依据）：「\(BookToolSupport.preview(quote, limit: 300))」")
        }
        return .success(lines.joined(separator: "\n"))
    }
}

private extension BookToolSupport {
    static func render(_ passage: AgentBookPassage, target: String, evidence: AgentEvidenceAllocator) async throws -> AgentToolResult {
        guard !passage.excerpts.isEmpty else {
            return .failure("\(target)没有可读取的文字（可能是扫描页或空白页）；可以换一页或用 search_book 查找。")
        }
        var lines = ["\(target) 原文\(passage.truncated ? "（后文较长，仅返回前 \(passage.excerpts.count) 段）" : "")。引用时使用方括号里的 id："]
        for excerpt in passage.excerpts {
            let value = QuestionEvidence(id: "", locator: try locator(excerpt.locatorJSON), context: excerpt.quote)
            let registered = await evidence.register(value)
            lines.append("[\(registered.id)] \(preview(excerpt.quote, limit: 1200))")
        }
        return .success(lines.joined(separator: "\n\n"))
    }
}
