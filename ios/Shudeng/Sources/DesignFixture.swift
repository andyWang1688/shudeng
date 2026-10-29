import Foundation
import PDFKit
import ReadiumShared
import UIKit

#if DEBUG
/// Deterministic, disposable data for interface acceptance tests.
///
/// The fixture is only created when an explicit launch argument is present.
/// It never reads the production library or Keychain and never sends an AI
/// request. All generated files live below one named temporary directory.
@MainActor
enum DesignFixture {
    enum Scenario: String, Equatable {
        case normal
        case empty
        case preparing
        case long
        /// PDF Spike：在 normal 夹具之上再 seed 一本运行时生成的 2 页文字 PDF；
        /// normal 场景保持原样，既有截图基线与 EPUB 夹具不受影响。
        case pdf
        /// PDF 里程碑 2：2 页整页图片 PDF（模拟扫描版），用于提示卡与阅读器「?」验收。
        case pdfScan = "pdf-scan"
    }

    struct Request {
        let scenario: Scenario
        let theme: UIUserInterfaceStyle
    }

    struct Session {
        let request: Request
        let root: URL
        let library: LibraryStore
        let secrets: EphemeralSecrets
    }

    static let fixtureTitle = "红楼梦"
    static let pdfFixtureTitle = "书灯 PDF 示例"
    static let pdfScanFixtureTitle = "书灯 PDF 扫描版"
    static let noteText = "灯把书页照亮，也把问题留在纸上。"
    static let conversationTitle = "这句话里的“灯”指什么？"

    static func request(in arguments: [String]) -> Request? {
        var scenario: Scenario?
        for (index, argument) in arguments.enumerated() {
            if argument == "--design-fixture" {
                scenario = arguments.indices.contains(index + 1)
                    ? Scenario(rawValue: arguments[index + 1]) ?? .normal
                    : .normal
            } else if argument.hasPrefix("--design-fixture=") {
                let value = String(argument.dropFirst("--design-fixture=".count))
                scenario = Scenario(rawValue: value) ?? .normal
            }
        }
        guard let scenario else { return nil }

        var theme = UIUserInterfaceStyle.light
        for (index, argument) in arguments.enumerated() {
            if argument == "--design-theme-dark" {
                theme = .dark
            } else if argument == "--design-theme" && arguments.indices.contains(index + 1) {
                theme = arguments[index + 1] == "dark" ? .dark : .light
            } else if argument == "--design-theme=dark" {
                theme = .dark
            } else if argument == "--design-theme=light" {
                theme = .light
            }
        }
        return Request(scenario: scenario, theme: theme)
    }

    static func makeSession(_ request: Request) throws -> Session {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("ShudengDesignFixture-\(request.scenario.rawValue)", isDirectory: true)
        if FileManager.default.fileExists(atPath: root.path) {
            try FileManager.default.removeItem(at: root)
        }
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let secrets = EphemeralSecrets()
        let library = try LibraryStore(root: root, secrets: secrets)
        print("DESIGN_FIXTURE_ROOT \(root.path)")
        return Session(request: request, root: root, library: library, secrets: secrets)
    }

    static func seed(_ session: Session) async throws {
        if session.request.scenario == .empty {
            try seedService(root: session.root, secrets: session.secrets)
            return
        }

        var specifications = [
            BookSpecification(
                identifier: "hongloumeng",
                title: "红楼梦",
                author: "曹雪芹",
                chapter: "第三回 · 林黛玉进贾府",
                paragraphs: [
                    "黛玉方进入房时，只见两个人搀着一位鬓发如银的老母迎上来。",
                    "灯把书页照亮，也把问题留在纸上。读者没有读懂的那一句，往往正需要停一停。",
                    "当下地下侍立之人，无不掩面涕泣，黛玉也哭个不住。"
                ]
            ),
            BookSpecification(
                identifier: "walden",
                title: "瓦尔登湖",
                author: "亨利·戴维·梭罗",
                chapter: "阅读",
                paragraphs: [
                    "Books are the treasured wealth of the world and the fit inheritance of generations and nations.",
                    "阅读不是为了逃离生活，而是为了更清楚地回到生活。",
                    "A written word is the choicest of relics."
                ]
            ),
            BookSpecification(
                identifier: "analects",
                title: "论语",
                author: "孔子",
                chapter: "学而第一",
                paragraphs: [
                    "学而时习之，不亦说乎？",
                    "知之为知之，不知为不知，是知也。",
                    "灯下读书，遇不解处，正可以一问。"
                ]
            )
        ]
        if session.request.scenario == .long {
            specifications[0] = BookSpecification(
                identifier: "hongloumeng",
                title: "红楼梦",
                author: "曹雪芹",
                chapter: "第三回 · 林黛玉进贾府",
                paragraphs: [
                    "黛玉方进入房时，只见两个人搀着一位鬓发如银的老母迎上来。",
                    "灯把书页照亮，也把问题留在纸上。读者没有读懂的那一句，往往正需要停一停。"
                ] + (1...36).map {
                    "第 \($0) 段。黛玉在心中细细分辨众人的言语与神色，窗外花影摇动，屋内的问答仍在一层层展开。"
                }
            )
        }

        var books: [Book] = []
        for specification in specifications {
            let source = session.root.appendingPathComponent(specification.identifier + ".epub")
            try FixtureEPUB(book: specification).data().write(to: source, options: .atomic)
            let imported = try await session.library.importBook(from: source)
            try? FileManager.default.removeItem(at: source)
            books.append(imported.book)
        }

        // PDF 夹具：走真实导入路径（后台 PDF 检查 + 书架）；文字页 PDF 静默导入，
        // 扫描版 PDF 由导入 UI 提示卡处理，夹具这里直接继续（无确认回调 = 继续）。
        switch session.request.scenario {
        case .pdf:
            try await seedPDFBook(title: pdfFixtureTitle, data: FixturePDF().data(), session: session)
        case .pdfScan:
            try await seedPDFBook(title: pdfScanFixtureTitle, data: FixtureScannedPDF().data(), session: session)
        default:
            break
        }

        guard let primary = books.first else { return }
        let first = locator(
            chapter: specifications[0].chapter,
            quote: specifications[0].paragraphs[1],
            progression: 0.18,
            totalProgression: 0.12,
            paragraphIndex: 1
        )
        let second = locator(
            chapter: specifications[0].chapter,
            quote: specifications[0].paragraphs[0],
            progression: 0.08,
            totalProgression: 0.04,
            paragraphIndex: 0
        )
        try session.library.saveReadingState(
            first,
            settings: ReadingSettings(
                scroll: false,
                fontSize: 100,
                dark: session.request.theme == .dark
            ),
            for: primary.id
        )
        try session.library.saveNote(BookNote(locator: first, body: noteText, color: .yellow), for: primary.id)
        try session.library.saveNote(BookNote(locator: second, color: .green), for: primary.id, highlightOnly: true)
        try session.library.saveBookmark(Bookmark(locator: second), for: primary.id)
        seedConversations(primary: primary, selection: first, library: session.library)
        try seedService(root: session.root, secrets: session.secrets)

        // The acceptance surface needs deterministic rendering, not a background
        // indexing benchmark. Stopping preparation keeps both the source book and
        // the generated data intact.
        for book in session.library.books {
            await session.library.preparation.stop(bookID: book.id)
        }
        if session.request.scenario == .preparing {
            var state = BookPreparationState()
            state.preparing = true
            state.completed = 2
            state.total = 9
            state.vectorsCompleted = 6
            state.vectorsTotal = 40
            session.library.preparation.setDesignState(state, for: primary.id)
        }
        if session.request.scenario == .pdf {
            try await seedPDFSearchIndex(session)
            try seedPDFAnnotations(session)
        }
    }

    /// PDF M5a 验收：预置 1 条高亮（第 1 页）+ 1 条笔记（第 2 页），几何由 PDFKit 选区换算成
    /// 归一化页面矩形，便于截图与 UI 点击命中。note id 为运行时 UUID，可从 library.books 读取。
    private static func seedPDFAnnotations(_ session: Session) throws {
        guard let pdf = session.library.books.first(where: { $0.resolvedFormat == .pdf }),
              let document = PDFKit.PDFDocument(url: session.library.fileURL(for: pdf)) else { return }
        func save(_ quote: String, body: String, color: HighlightColor) throws {
            guard let selection = document.findString(quote, withOptions: [.caseInsensitive]).first,
                  let made = PDFNoteGeometry.make(from: selection, document: document) else { return }
            let note = BookNote(locator: made.locator, body: body, color: color, pdf: made.geometry)
            try session.library.saveNote(note, for: pdf.id, highlightOnly: body.isEmpty)
        }
        try save("灯把书页照亮", body: "", color: .yellow)
        try save("PDFKit", body: "夹具笔记：PDFKit 渲染与翻页说明。", color: .green)
    }

    /// PDF M4b/M6 验收：文字版 PDF 在 seed 时建好页级 FTS 索引与向量，
    /// 让搜索 tab 与「选文/书内问 AI」在夹具上都能真跑（模型不可用时仍保留 FTS 索引）。
    private static func seedPDFSearchIndex(_ session: Session) async throws {
        guard let pdf = session.library.books.first(where: { $0.resolvedFormat == .pdf }),
              let info = pdf.pdfInfo else { return }
        try await session.library.preparation.index.prepare(
            bookID: pdf.id,
            file: session.library.fileURL(for: pdf),
            progress: { _ in }
        )
        do {
            try await session.library.preparation.index.prepareVectors(bookID: pdf.id) { _ in }
        } catch {
            // 本地模型不可用时保留 FTS 索引，避免整个设计夹具启动失败；AI 真跑用例会暴露该缺失。
        }
        var state = (try? await session.library.preparation.index.state(bookID: pdf.id)) ?? BookPreparationState()
        state.preparing = false
        state.pdfPageCount = info.pageCount
        state.searchablePageCount = info.textPageCount
        state.textIndexUnavailable = info.textPageCount == 0
        // 向量已建（或失败时保持仅搜索）：标 semanticReady 避免书架出现「正在准备」提示。
        state.semanticReady = true
        session.library.preparation.setDesignState(state, for: pdf.id)
    }

    private static func seedPDFBook(title: String, data: Data, session: Session) async throws {
        let source = session.root.appendingPathComponent(title + ".pdf")
        try data.write(to: source, options: .atomic)
        _ = try await session.library.importBook(from: source)
        try? FileManager.default.removeItem(at: source)
    }

    static func renderRoot(
        _ root: UIViewController,
        size: CGSize,
        style: UIUserInterfaceStyle,
        preferredContentSizeCategory: UIContentSizeCategory? = nil
    ) -> UIImage {
        let window = UIWindow(frame: CGRect(origin: .zero, size: size))
        window.overrideUserInterfaceStyle = style
        if #available(iOS 17.0, *), let preferredContentSizeCategory {
            window.traitOverrides.preferredContentSizeCategory = preferredContentSizeCategory
        }
        window.rootViewController = root
        window.isHidden = false
        root.beginAppearanceTransition(true, animated: false)
        root.view.frame = window.bounds
        root.view.setNeedsLayout()
        root.view.layoutIfNeeded()
        root.endAppearanceTransition()
        CATransaction.flush()
        RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.05))
        root.view.layoutIfNeeded()
        CATransaction.flush()

        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        let image = UIGraphicsImageRenderer(size: size, format: format).image { _ in
            root.view.drawHierarchy(in: root.view.bounds, afterScreenUpdates: true)
        }
        window.isHidden = true
        return image
    }

    private static func seedConversations(primary: Book, selection: Locator, library: LibraryStore) {
        let citation = locator(
            chapter: "第三回 · 林黛玉进贾府",
            quote: "灯把书页照亮，也把问题留在纸上。",
            progression: 0.18,
            paragraphIndex: 1
        )
        let evidence = QuestionEvidence(locator: citation)

        var first = ReadingQuestion(book: primary, selection: evidence, neighbors: [])
        first.conversationID = first.id
        first.turnIndex = 0
        first.conversationTitle = conversationTitle
        first.question = conversationTitle
        first.answer = "这里的“灯”既是阅读时的照明，也是理解书中难句的提示。它不替代原文，只帮助读者回到文字本身。"
        first.state = .complete
        first.evidence = [evidence]
        first.citations = [evidence]
        first.serviceName = "DeepSeek"
        first.model = "deepseek-flash"
        first.updated = Date(timeIntervalSince1970: 1_792_742_400)
        _ = library.questions.save(first)

        let selection2 = locator(
            chapter: "第三回 · 林黛玉进贾府",
            quote: "黛玉方进入房时",
            progression: 0.08,
            paragraphIndex: 0
        )
        var second = ReadingQuestion(book: primary, selection: QuestionEvidence(locator: selection2), neighbors: [])
        second.conversationID = second.id
        second.turnIndex = 0
        second.conversationTitle = "林黛玉第一次进贾府时看到了什么？"
        second.question = second.conversationTitle ?? ""
        second.answer = "固定夹具记录：她先看到迎上来的外祖母，随后房中众人相迎；这是设计验收文本，不是真实 AI 回答。"
        second.state = .complete
        second.updated = Date(timeIntervalSince1970: 1_792_655_400)
        _ = library.questions.save(second)
    }

    private static func seedService(root: URL, secrets: EphemeralSecrets) throws {
        let store = try AIConfigurationStore(root: root, secrets: secrets)
        let configuration = AIConfiguration(
            name: "DeepSeek",
            format: .openAI,
            address: "https://api.deepseek.com/v1",
            model: "deepseek-flash"
        )
        try store.save(
            configuration,
            newKey: "fixture-placeholder-not-a-real-key",
            confirmingSendConsent: true
        )
    }

    private static func locator(
        chapter: String,
        quote: String,
        progression: Double,
        totalProgression: Double? = nil,
        paragraphIndex: Int
    ) -> Locator {
        let selector = "#fixture-paragraph-" + String(paragraphIndex)
        var locations = Locator.Locations(
            progression: progression,
            totalProgression: totalProgression ?? progression / 3,
            position: max(1, Int(progression * 100))
        )
        locations.cssSelector = selector
        locations.otherLocations["domRange"] = DOMRange(
            start: .init(cssSelector: selector, textNodeIndex: 0, charOffset: 0),
            end: .init(cssSelector: selector, textNodeIndex: 0, charOffset: quote.utf16.count)
        ).jsonValue
        return Locator(
            href: AnyURL(string: "OEBPS/chapter1.xhtml")!,
            mediaType: .xhtml,
            title: chapter,
            locations: locations,
            text: .init(highlight: quote)
        )
    }
}

final class EphemeralSecrets: AISecrets {
    private var values: [String: String] = [:]
    func read(_ id: String) throws -> String {
        guard let value = values[id] else { throw AIError.secret }
        return value
    }
    func write(_ value: String, id: String) throws { values[id] = value }
    func remove(_ id: String) throws { values.removeValue(forKey: id) }
    func accounts() throws -> [String] { Array(values.keys) }
}

private struct BookSpecification {
    let identifier: String
    let title: String
    let author: String
    let chapter: String
    let paragraphs: [String]
}

/// 两页文字型 PDF：运行时用系统 PDF 渲染器生成，再用 PDFKit 抽取校验。
/// 与真实导入同一路径（LibraryStore 会逐页检查 `page.string`）。
private struct FixturePDF {
    static let pageSize = CGSize(width: 595, height: 842)
    private static let pages: [(heading: String, body: String)] = [
        ("书灯 PDF 示例 · 第一页", "灯把书页照亮，也把问题留在纸上。The lamp lights the page."),
        ("书灯 PDF 示例 · 第二页", "PDF 阅读器使用系统 PDFKit 完成渲染与翻页。Page 2 of 2.")
    ]

    func data() -> Data {
        let bounds = CGRect(origin: .zero, size: Self.pageSize)
        let renderer = UIGraphicsPDFRenderer(bounds: bounds)
        let data = renderer.pdfData { context in
            for (index, page) in Self.pages.enumerated() {
                context.beginPage()
                let headingAttributes: [NSAttributedString.Key: Any] = [
                    .font: UIFont(name: "SongtiSC-Bold", size: 22) ?? UIFont.systemFont(ofSize: 22, weight: .semibold),
                    .foregroundColor: UIColor.black
                ]
                let bodyAttributes: [NSAttributedString.Key: Any] = [
                    .font: UIFont.systemFont(ofSize: 14),
                    .foregroundColor: UIColor.black
                ]
                (page.heading as NSString).draw(at: CGPoint(x: 56, y: 64), withAttributes: headingAttributes)
                (page.body as NSString).draw(in: CGRect(x: 56, y: 112, width: 480, height: 300), withAttributes: bodyAttributes)
                ("第 \(index + 1) / \(Self.pages.count) 页" as NSString).draw(at: CGPoint(x: 56, y: 780), withAttributes: bodyAttributes)
            }
        }
        if let check = PDFKit.PDFDocument(data: data) {
            let textPages = (0..<check.pageCount).filter { index in
                !(check.page(at: index)?.string ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            }.count
            print("DESIGN_FIXTURE_PDF pages=\(check.pageCount) textPages=\(textPages)")
        } else {
            print("DESIGN_FIXTURE_PDF_ERROR generated document is unreadable")
        }
        return data
    }
}

/// 两页“扫描版”PDF：整页文字先画进位图再贴进 PDF，页面没有可选中的文字。
/// 用于验收扫描版导入提示卡与阅读器「?」。
private struct FixtureScannedPDF {
    static let pageSize = CGSize(width: 595, height: 842)
    private static let headings = ["书灯 PDF 扫描版 · 第一页", "书灯 PDF 扫描版 · 第二页"]

    func data() -> Data {
        let bounds = CGRect(origin: .zero, size: Self.pageSize)
        // 先把每页画成位图，再整页贴进 PDF：页面只有图片，没有可抽取的文字。
        let pageImages = Self.headings.enumerated().map { index, heading -> UIImage in
            UIGraphicsImageRenderer(size: Self.pageSize).image { imageContext in
                UIColor.white.setFill()
                imageContext.fill(bounds)
                let headingAttributes: [NSAttributedString.Key: Any] = [
                    .font: UIFont(name: "SongtiSC-Bold", size: 22) ?? UIFont.systemFont(ofSize: 22, weight: .semibold),
                    .foregroundColor: UIColor.black
                ]
                let bodyAttributes: [NSAttributedString.Key: Any] = [
                    .font: UIFont.systemFont(ofSize: 14),
                    .foregroundColor: UIColor.black
                ]
                (heading as NSString).draw(at: CGPoint(x: 56, y: 64), withAttributes: headingAttributes)
                ("这一页的文字是图片，用来验收扫描版提示。Page \(index + 1) of \(Self.headings.count)." as NSString)
                    .draw(in: CGRect(x: 56, y: 112, width: 480, height: 300), withAttributes: bodyAttributes)
                ("第 \(index + 1) / \(Self.headings.count) 页" as NSString)
                    .draw(at: CGPoint(x: 56, y: 780), withAttributes: bodyAttributes)
            }
        }
        let renderer = UIGraphicsPDFRenderer(bounds: bounds)
        let data = renderer.pdfData { context in
            for image in pageImages {
                context.beginPage()
                image.draw(in: bounds)
            }
        }
        if let check = PDFKit.PDFDocument(data: data) {
            let textPages = (0..<check.pageCount).filter { index in
                !(check.page(at: index)?.string ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            }.count
            print("DESIGN_FIXTURE_SCAN_PDF pages=\(check.pageCount) textPages=\(textPages)")
        } else {
            print("DESIGN_FIXTURE_SCAN_PDF_ERROR generated document is unreadable")
        }
        return data
    }
}

/// A deterministic, uncompressed EPUB. EPUB requires the mimetype entry to be
/// first and stored without compression; the remaining files are also stored so
/// the fixture does not depend on an archiver.
private struct FixtureEPUB {
    let book: BookSpecification

    func data() -> Data {
        var zip = StoreOnlyZIP()
        let escapedTitle = escape(book.title)
        let escapedAuthor = escape(book.author)
        let escapedChapter = escape(book.chapter)
        let body = book.paragraphs.enumerated().map {
            "<p id=\"fixture-paragraph-\($0.offset)\">\(escape($0.element))</p>"
        }.joined(separator: "\n")

        zip.add("mimetype", Data("application/epub+zip".utf8))
        zip.add("META-INF/container.xml", Data("""
        <?xml version="1.0" encoding="UTF-8"?>
        <container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
          <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
        </container>
        """.utf8))
        zip.add("OEBPS/content.opf", Data("""
        <?xml version="1.0" encoding="UTF-8"?>
        <package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
          <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
            <dc:identifier id="book-id">urn:shudeng:design:\(book.identifier)</dc:identifier>
            <dc:title>\(escapedTitle)</dc:title>
            <dc:creator>\(escapedAuthor)</dc:creator>
            <dc:language>zh-CN</dc:language>
            <meta property="dcterms:modified">2026-10-23T00:00:00Z</meta>
          </metadata>
          <manifest>
            <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
            <item id="chapter1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
          </manifest>
          <spine><itemref idref="chapter1"/></spine>
        </package>
        """.utf8))
        zip.add("OEBPS/nav.xhtml", Data("""
        <?xml version="1.0" encoding="UTF-8"?>
        <html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="zh-CN">
          <head><title>\(escapedTitle)</title></head>
          <body><nav epub:type="toc"><h1>\(escapedTitle)</h1><ol><li><a href="chapter1.xhtml">\(escapedChapter)</a></li></ol></nav></body>
        </html>
        """.utf8))
        zip.add("OEBPS/chapter1.xhtml", Data("""
        <?xml version="1.0" encoding="UTF-8"?>
        <html xmlns="http://www.w3.org/1999/xhtml" lang="zh-CN">
          <head><title>\(escapedChapter)</title></head>
          <body><h1>\(escapedChapter)</h1>
          \(body)
          </body>
        </html>
        """.utf8))
        return zip.finish()
    }

    private func escape(_ value: String) -> String {
        value
            .replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
            .replacingOccurrences(of: "\"", with: "&quot;")
    }
}

private struct StoreOnlyZIP {
    private struct Entry {
        let name: Data
        let bytes: Data
        let checksum: UInt32
        let offset: UInt32
    }

    private var body = Data()
    private var entries: [Entry] = []

    mutating func add(_ name: String, _ bytes: Data) {
        let nameData = Data(name.utf8)
        let checksum = Self.crc32(bytes)
        let offset = UInt32(body.count)
        body.appendLE(UInt32(0x04034B50))
        body.appendLE(UInt16(20))
        body.appendLE(UInt16(0x0800))
        body.appendLE(UInt16(0))
        body.appendLE(UInt16(0))
        body.appendLE(UInt16(0x21))
        body.appendLE(checksum)
        body.appendLE(UInt32(bytes.count))
        body.appendLE(UInt32(bytes.count))
        body.appendLE(UInt16(nameData.count))
        body.appendLE(UInt16(0))
        body.append(nameData)
        body.append(bytes)
        entries.append(Entry(name: nameData, bytes: bytes, checksum: checksum, offset: offset))
    }

    func finish() -> Data {
        let centralStart = UInt32(body.count)
        var result = body
        for entry in entries {
            result.appendLE(UInt32(0x02014B50))
            result.appendLE(UInt16(20))
            result.appendLE(UInt16(20))
            result.appendLE(UInt16(0x0800))
            result.appendLE(UInt16(0))
            result.appendLE(UInt16(0))
            result.appendLE(UInt16(0x21))
            result.appendLE(entry.checksum)
            result.appendLE(UInt32(entry.bytes.count))
            result.appendLE(UInt32(entry.bytes.count))
            result.appendLE(UInt16(entry.name.count))
            result.appendLE(UInt16(0))
            result.appendLE(UInt16(0))
            result.appendLE(UInt16(0))
            result.appendLE(UInt16(0))
            result.appendLE(UInt32(0))
            result.appendLE(entry.offset)
            result.append(entry.name)
        }
        let centralSize = UInt32(result.count) - centralStart
        result.appendLE(UInt32(0x06054B50))
        result.appendLE(UInt16(0))
        result.appendLE(UInt16(0))
        result.appendLE(UInt16(entries.count))
        result.appendLE(UInt16(entries.count))
        result.appendLE(centralSize)
        result.appendLE(centralStart)
        result.appendLE(UInt16(0))
        return result
    }

    private static func crc32(_ data: Data) -> UInt32 {
        var value = UInt32.max
        for byte in data {
            var part = (value ^ UInt32(byte)) & 0xFF
            for _ in 0..<8 {
                part = (part & 1) == 1 ? 0xEDB88320 ^ (part >> 1) : part >> 1
            }
            value = (value >> 8) ^ part
        }
        return value ^ UInt32.max
    }
}

private extension Data {
    mutating func appendLE(_ value: UInt16) {
        var value = value.littleEndian
        Swift.withUnsafeBytes(of: &value) { append(contentsOf: $0) }
    }

    mutating func appendLE(_ value: UInt32) {
        var value = value.littleEndian
        Swift.withUnsafeBytes(of: &value) { append(contentsOf: $0) }
    }
}
#endif
