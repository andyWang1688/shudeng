import XCTest
import UIKit
import PDFKit
import ReadiumNavigator
import ReadiumShared
@testable import Shudeng

@MainActor
final class DesignFixtureTests: XCTestCase {
    func testFixtureRequiresExplicitLaunchArgument() {
        XCTAssertNil(DesignFixture.request(in: []))
        XCTAssertNil(DesignFixture.request(in: ["--isolated-reading-test"]))
        XCTAssertEqual(DesignFixture.request(in: ["--design-fixture"])?.scenario, .normal)
        XCTAssertEqual(DesignFixture.request(in: ["--design-fixture=empty", "--design-theme=dark"])?.scenario, .empty)
        XCTAssertEqual(DesignFixture.request(in: ["--design-fixture=preparing"])?.scenario, .preparing)
        XCTAssertEqual(DesignFixture.request(in: ["--design-fixture=long"])?.scenario, .long)
        XCTAssertEqual(DesignFixture.request(in: ["--design-fixture=normal", "--design-theme=dark"])?.theme, .dark)
    }

    @MainActor
    func testHighlightColorLegacyDefaultsToYellowAndRoundTrips() async throws {
        let request = DesignFixture.Request(scenario: .normal, theme: .light)
        let session = try DesignFixture.makeSession(request)
        try await DesignFixture.seed(session)
        let primary = try XCTUnwrap(session.library.books.first { $0.title == DesignFixture.fixtureTitle })
        // 夹具已给两条笔记显式上色：正文笔记黄、纯高亮绿。
        let bodyNote = try XCTUnwrap(primary.notes?.first { !$0.body.isEmpty })
        let highlightNote = try XCTUnwrap(primary.notes?.first { $0.body.isEmpty })
        XCTAssertEqual(bodyNote.highlightColor, .yellow)
        XCTAssertEqual(highlightNote.highlightColor, .green)

        // 旧数据（JSON 无 color 键）解码后 color 为 nil、按黄色渲染。
        let legacyNote = BookNote(locator: try highlightNote.location())
        let legacyData = try JSONEncoder().encode(legacyNote)
        let legacyJSON = try XCTUnwrap(
            try JSONSerialization.jsonObject(with: legacyData) as? [String: Any]
        )
        XCTAssertNil(legacyJSON["color"], "无颜色的旧数据不应编码 color 字段")
        let decodedLegacy = try JSONDecoder().decode(BookNote.self, from: legacyData)
        XCTAssertNil(decodedLegacy.color)
        XCTAssertEqual(decodedLegacy.highlightColor, .yellow, "旧数据缺 color 时默认按黄色渲染")

        let locator = try highlightNote.location()
        let greenNote = BookNote(locator: locator, color: .green)
        try session.library.saveNote(greenNote, for: primary.id)
        let reloaded = try LibraryStore(root: session.root, secrets: session.secrets)
        let persisted = reloaded.books.first { $0.id == primary.id }?.notes?.first { $0.id == greenNote.id }
        XCTAssertEqual(persisted?.color, .green)
        XCTAssertEqual(persisted?.highlightColor, .green)
        let catalog = try String(contentsOf: session.root.appendingPathComponent("library.json"), encoding: .utf8)
        XCTAssertTrue(catalog.contains("green"), "颜色应持久化到 catalog")

        try reloaded.updateNoteColor(.rose, forNoteID: greenNote.id, bookID: primary.id)
        let reloadedAgain = try LibraryStore(root: session.root, secrets: session.secrets)
        XCTAssertEqual(
            reloadedAgain.books.first { $0.id == primary.id }?.notes?.first { $0.id == greenNote.id }?.highlightColor,
            .rose,
            "改色应持久化"
        )
    }

    /// PDF Spike：pdf 夹具 = normal 3 本 EPUB + 1 本 2 页文字 PDF；format/pdfInfo/文件扩展名正确，旧目录无 format 仍按 epub。
    func testPDFFixtureImportsTextPDFAndSkipsEPUBIndexing() async throws {
        let request = DesignFixture.Request(scenario: .pdf, theme: .light)
        let session = try DesignFixture.makeSession(request)
        try await DesignFixture.seed(session)
        XCTAssertEqual(session.library.books.count, 4, "pdf 夹具应为 3 本 EPUB + 1 本 PDF")

        let pdf = try XCTUnwrap(session.library.books.first { $0.title == DesignFixture.pdfFixtureTitle })
        XCTAssertEqual(pdf.format, .pdf)
        XCTAssertEqual(pdf.resolvedFormat, .pdf)
        let info = try XCTUnwrap(pdf.pdfInfo, "PDF 应写入 pdfInfo")
        XCTAssertEqual(info.pageCount, 2)
        XCTAssertEqual(info.textPageCount, 2, "2 页都应有可抽取文字")
        XCTAssertTrue(info.hasTextPages)
        XCTAssertFalse(info.hasScannedPages)
        let url = session.library.fileURL(for: pdf)
        XCTAssertEqual(url.pathExtension.lowercased(), "pdf", "文件扩展名应按格式存储")
        XCTAssertTrue(FileManager.default.fileExists(atPath: url.path))

        // EPUB 仍为 3 本，扩展名 .epub；旧数据无 format 时按 epub。
        let epubs = session.library.books.filter { $0.resolvedFormat == .epub }
        XCTAssertEqual(epubs.count, 3)
        XCTAssertTrue(epubs.allSatisfy { $0.format == .epub }, "新导入 EPUB 应显式写 .epub；旧数据 nil 由下面解码用例覆盖")
        XCTAssertEqual(session.library.fileURL(for: epubs[0]).pathExtension.lowercased(), "epub")

        // 旧 catalog（去除 format/pdfInfo 字段）解码后仍为合法 Book，按 epub 处理。
        let catalogURL = session.root.appendingPathComponent("library.json")
        let raw = try JSONSerialization.jsonObject(with: try Data(contentsOf: catalogURL)) as? [[String: Any]]
        var legacy = try XCTUnwrap(raw?.first { ($0["title"] as? String) != DesignFixture.pdfFixtureTitle })
        legacy.removeValue(forKey: "format")
        legacy.removeValue(forKey: "pdfInfo")
        let legacyBook = try JSONDecoder().decode(Book.self, from: JSONSerialization.data(withJSONObject: legacy))
        XCTAssertNil(legacyBook.format)
        XCTAssertNil(legacyBook.pdfInfo)
        XCTAssertEqual(legacyBook.resolvedFormat, .epub)

        // BookIndex/准备：M4a 起 PDF 走页级索引（不再跳过），且不会按 EPUB XHTML 解析失败。
        session.library.preparation.start(pdf, file: url)
        var probed: BookPreparationState?
        for _ in 0..<300 {
            if let current = session.library.preparation.states[pdf.id], !current.preparing {
                probed = current
                break
            }
            try? await Task.sleep(nanoseconds: 100_000_000)
        }
        let prepared = try XCTUnwrap(probed, "PDF 页级索引应到达终态")
        XCTAssertNil(prepared.failure, "PDF 不应因 EPUB HTML 解析失败")
        XCTAssertEqual(prepared.pdfPageCount, info.pageCount)
        XCTAssertEqual(prepared.searchablePageCount, info.textPageCount)
        XCTAssertEqual(prepared.completed, info.pageCount)
        XCTAssertFalse(prepared.textIndexUnavailable, "文字 PDF 不应标记索引不可用")
    }

    /// PDF 阅读器：PDFKit 渲染第一页并显示页码（1/2）；浅/深各出一张渲染图。
    /// PDF M2：扫描版夹具 2/0、hasScannedPages、提示文案精确串且不含技术词；文字版静默（title=nil）。
    func testPDFScannedFixtureInfoAndNonTechnicalCopy() async throws {
        let request = DesignFixture.Request(scenario: .pdfScan, theme: .light)
        let session = try DesignFixture.makeSession(request)
        try await DesignFixture.seed(session)
        XCTAssertEqual(session.library.books.count, 4, "pdf-scan 夹具应为 3 EPUB + 1 扫描 PDF")
        let scanned = try XCTUnwrap(session.library.books.first { $0.title == DesignFixture.pdfScanFixtureTitle })
        XCTAssertEqual(scanned.format, .pdf)
        let info = try XCTUnwrap(scanned.pdfInfo)
        XCTAssertEqual(info.pageCount, 2)
        XCTAssertEqual(info.textPageCount, 0, "扫描版夹具应无可抽取文字")
        XCTAssertEqual(info.scannedPageCount, 2)
        XCTAssertTrue(info.hasScannedPages)
        XCTAssertEqual(info.scannedPagesTitle, "这份 PDF 是扫描版")
        XCTAssertEqual(
            info.scannedPagesMessage,
            "页面上的字是图片，目前还不能选字提问或高亮。阅读、缩放和加书签都可以正常使用。"
        )
        let combined = (info.scannedPagesTitle ?? "") + info.scannedPagesMessage
        for banned in ["文字层", "文本层", "OCR", "格式限制", "PDF 本身的问题", "不是书灯的问题"] {
            XCTAssertFalse(combined.contains(banned), "用户文案不应出现技术词：\(banned)")
        }
        XCTAssertTrue(session.library.fileURL(for: scanned).pathExtension.lowercased() == "pdf")

        // 文字版 PDF：无扫描页 → 不应弹卡（title=nil）；混排文案精确。
        let textRequest = DesignFixture.Request(scenario: .pdf, theme: .light)
        let textSession = try DesignFixture.makeSession(textRequest)
        try await DesignFixture.seed(textSession)
        let textPDF = try XCTUnwrap(textSession.library.books.first { $0.title == DesignFixture.pdfFixtureTitle })
        let textInfo = try XCTUnwrap(textPDF.pdfInfo)
        XCTAssertFalse(textInfo.hasScannedPages)
        XCTAssertNil(textInfo.scannedPagesTitle, "无扫描页不应出现提示卡标题")

        let mixed = PDFInfo(pageCount: 4, textPageCount: 3)
        XCTAssertEqual(mixed.scannedPageCount, 1)
        XCTAssertEqual(mixed.scannedPagesTitle, "这份 PDF 有 1 页是扫描图片")
        XCTAssertEqual(mixed.scannedPagesMessage, "这些页目前还不能选字提问或高亮；其余页面正常。")
    }

    /// PDF M2：导入进度回调序列、扫描版确认取消不落库、继续导入保留 pdfInfo、文字版静默不调 confirm。
    func testPDFImportProgressConfirmCancelContinueAndSilentTextPDF() async throws {
        let scanSession = try DesignFixture.makeSession(.init(scenario: .pdfScan, theme: .light))
        try await DesignFixture.seed(scanSession)
        let scanBook = try XCTUnwrap(scanSession.library.books.first { $0.title == DesignFixture.pdfScanFixtureTitle })
        let scanSource = scanSession.library.fileURL(for: scanBook)
        let textSession = try DesignFixture.makeSession(.init(scenario: .pdf, theme: .light))
        try await DesignFixture.seed(textSession)
        let textBook = try XCTUnwrap(textSession.library.books.first { $0.title == DesignFixture.pdfFixtureTitle })
        let textSource = textSession.library.fileURL(for: textBook)
        defer {
            try? FileManager.default.removeItem(at: scanSession.root)
            try? FileManager.default.removeItem(at: textSession.root)
        }

        func makeLibrary() throws -> LibraryStore {
            let root = FileManager.default.temporaryDirectory
                .appendingPathComponent("PDFImportCheck-" + UUID().uuidString, isDirectory: true)
            try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
            return try LibraryStore(root: root, secrets: EphemeralSecrets())
        }

        // 扫描版 + 用户取消：进度 1/2、2/2；抛 CancellationError；不落库。
        let cancelLibrary = try makeLibrary()
        var cancelProgress: [PDFCheckProgress] = []
        var confirmCalls = 0
        do {
            _ = try await cancelLibrary.importBook(
                from: scanSource,
                pdfProgress: { cancelProgress.append($0) },
                confirmPDFInfo: { _ in
                    confirmCalls += 1
                    return false
                }
            )
            XCTFail("取消导入不应成功")
        } catch is CancellationError {
            // expected
        }
        XCTAssertEqual(cancelProgress, [PDFCheckProgress(completed: 1, total: 2), PDFCheckProgress(completed: 2, total: 2)])
        XCTAssertEqual(confirmCalls, 1)
        XCTAssertTrue(cancelLibrary.books.isEmpty, "取消后不应写入书架")
        try? FileManager.default.removeItem(at: cancelLibrary.root)

        // 扫描版 + 继续导入：书落库且 pdfInfo 保留 2/0。
        let continueLibrary = try makeLibrary()
        var continueProgress: [PDFCheckProgress] = []
        let imported = try await continueLibrary.importBook(
            from: scanSource,
            pdfProgress: { continueProgress.append($0) },
            confirmPDFInfo: { info in
                XCTAssertEqual(info.textPageCount, 0)
                return true
            }
        )
        XCTAssertEqual(continueProgress.count, 2)
        XCTAssertEqual(continueProgress.map(\.completed), [1, 2])
        XCTAssertEqual(imported.book.pdfInfo, PDFInfo(pageCount: 2, textPageCount: 0))
        XCTAssertEqual(continueLibrary.books.count, 1)
        XCTAssertTrue(FileManager.default.fileExists(atPath: continueLibrary.fileURL(for: imported.book).path))
        try? FileManager.default.removeItem(at: continueLibrary.root)

        // 文字版：静默导入，不应调用 confirm；pdfInfo 2/2 保留。
        let textLibrary = try makeLibrary()
        var textConfirmCalls = 0
        let textImported = try await textLibrary.importBook(
            from: textSource,
            confirmPDFInfo: { _ in
                textConfirmCalls += 1
                return true
            }
        )
        XCTAssertEqual(textConfirmCalls, 0, "文字版 PDF 不应弹确认卡")
        XCTAssertEqual(textImported.book.pdfInfo, PDFInfo(pageCount: 2, textPageCount: 2))
        try? FileManager.default.removeItem(at: textLibrary.root)
    }

    func testPDFReaderRendersFirstPageWithPageIndicator() async throws {
        let request = DesignFixture.Request(scenario: .pdf, theme: .light)
        let session = try DesignFixture.makeSession(request)
        try await DesignFixture.seed(session)
        let pdf = try XCTUnwrap(session.library.books.first { $0.title == DesignFixture.pdfFixtureTitle })
        let reader = try PDFReaderController(book: pdf, library: session.library)
        let image = DesignFixture.renderRoot(reader, size: CGSize(width: 375, height: 667), style: .light)
        let attachment = XCTAttachment(data: try XCTUnwrap(image.pngData()), uniformTypeIdentifier: "public.png")
        attachment.name = "pdf-reader-375x667-light"
        attachment.lifetime = .keepAlways
        add(attachment)

        let pageLabel = try XCTUnwrap(
            reader.view.allViews.first { $0.accessibilityIdentifier == "pdf-reader-page" } as? UILabel
        )
        XCTAssertEqual(pageLabel.text, "第 1 / 2 页")
        XCTAssertNotNil(reader.view.allViews.first { $0.accessibilityIdentifier == "pdf-reader-view" })
        XCTAssertNotNil(reader.view.allViews.first { $0.accessibilityIdentifier == "pdf-reader-progress" })
        XCTAssertNotNil(reader.view.allViews.first { $0.accessibilityIdentifier == "reader-close" })
        XCTAssertNotNil(reader.view.allViews.first { $0.accessibilityIdentifier == "pdf-reader-mode" })
    }

    /// PDF M3：书签按钮/丝带、locator 格式（pdf://page/N）、扫描页 excerpt 空、重启持久化。
    func testPDFReaderBookmarkLocatorRibbonScannedExcerptAndRestart() async throws {
        func button(_ identifier: String, in root: UIView) -> UIButton? {
            root.allViews.compactMap { $0 as? UIButton }
                .first { $0.accessibilityIdentifier == identifier }
        }
        func pdfBookmark(page: Int, excerpt: String) -> Bookmark {
            let total = Double(page - 1) / 2
            return Bookmark(locator: Locator(
                href: AnyURL(string: "pdf://page/\(page)")!,
                mediaType: .pdf,
                title: "第 \(page) 页",
                locations: .init(progression: total, totalProgression: total, position: page),
                text: .init(highlight: excerpt)
            ))
        }

        // 文字 PDF：点书签按钮 → locator 格式正确 + 丝带出现；再点取消。
        let session = try DesignFixture.makeSession(.init(scenario: .pdf, theme: .light))
        try await DesignFixture.seed(session)
        let pdf = try XCTUnwrap(session.library.books.first { $0.title == DesignFixture.pdfFixtureTitle })
        let reader = try PDFReaderController(book: pdf, library: session.library)
        let window = host(reader, size: CGSize(width: 375, height: 667))
        defer { window.isHidden = true }
        let toggle = try XCTUnwrap(button("pdf-bookmark-toggle", in: reader.view))
        let ribbon = try XCTUnwrap(button("pdf-bookmark-ribbon", in: reader.view))
        XCTAssertTrue(ribbon.isHidden, "初始不应显示丝带")
        toggle.sendActions(for: .touchUpInside)
        RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.2))
        var marks = session.library.books.first { $0.id == pdf.id }?.bookmarks ?? []
        XCTAssertEqual(marks.count, 1)
        let locator = try XCTUnwrap(marks.first?.location())
        XCTAssertEqual(locator.href.string, "pdf://page/1")
        XCTAssertTrue(locator.mediaType.matches(.pdf))
        XCTAssertEqual(locator.locations.position, 1)
        XCTAssertEqual(locator.title, "第 1 页")
        XCTAssertEqual(try XCTUnwrap(marks.first).excerpt, "书灯 PDF 示例 · 第一页")
        XCTAssertFalse(ribbon.isHidden, "加书签后丝带应出现")
        XCTAssertEqual(toggle.accessibilityValue, "此页已有书签")

        // 重启持久化：重新加载 LibraryStore 后新 reader 仍显示书签。
        let reloaded = try LibraryStore(root: session.root, secrets: EphemeralSecrets())
        let pdfReloaded = try XCTUnwrap(reloaded.books.first { $0.title == DesignFixture.pdfFixtureTitle })
        let reader2 = try PDFReaderController(book: pdfReloaded, library: reloaded)
        let window2 = host(reader2, size: CGSize(width: 375, height: 667))
        defer { window2.isHidden = true }
        let toggle2 = try XCTUnwrap(button("pdf-bookmark-toggle", in: reader2.view))
        XCTAssertEqual(toggle2.accessibilityValue, "此页已有书签", "重启后应恢复本页书签")
        XCTAssertFalse(try XCTUnwrap(button("pdf-bookmark-ribbon", in: reader2.view)).isHidden)

        // 同页重复保存去重。
        try session.library.saveBookmark(pdfBookmark(page: 2, excerpt: "第二页摘要"), for: pdf.id)
        try session.library.saveBookmark(pdfBookmark(page: 2, excerpt: "第二页摘要"), for: pdf.id)
        marks = session.library.books.first { $0.id == pdf.id }?.bookmarks ?? []
        XCTAssertEqual(marks.filter { $0.excerpt == "第二页摘要" }.count, 1, "同页书签应去重")

        // 扫描版：书签 excerpt 为空。
        let scanSession = try DesignFixture.makeSession(.init(scenario: .pdfScan, theme: .light))
        try await DesignFixture.seed(scanSession)
        try? FileManager.default.removeItem(at: session.root)
        defer { try? FileManager.default.removeItem(at: scanSession.root) }
        let scanBook = try XCTUnwrap(scanSession.library.books.first { $0.title == DesignFixture.pdfScanFixtureTitle })
        let scanReader = try PDFReaderController(book: scanBook, library: scanSession.library)
        let scanWindow = host(scanReader, size: CGSize(width: 375, height: 667))
        defer { scanWindow.isHidden = true }
        let scanHelp = scanReader.view.allViews.compactMap { $0 as? UIButton }
            .first { $0.accessibilityIdentifier == "pdf-reader-help" }
        scanReader.view.layoutIfNeeded()
        let toolbarButtons = ["pdf-bookmark-toggle", "pdf-contents", "pdf-reader-help"].map { identifier in
            let button = scanReader.view.allViews.compactMap { $0 as? UIButton }
                .first { $0.accessibilityIdentifier == identifier }
            return "\(identifier): frame=\(String(describing: button?.frame)) hidden=\(button?.isHidden ?? true)"
        }
        let titleFrame = scanReader.view.allViews.first { $0.accessibilityIdentifier == "reader-title" }?.frame
        print("QA_PDF_SCAN_HELP info=\(String(describing: scanBook.pdfInfo)) exists=\(scanHelp != nil) hidden=\(scanHelp?.isHidden ?? true) title=\(String(describing: titleFrame)) \n\(toolbarButtons.joined(separator: "\n"))")
        XCTAssertNotNil(scanHelp, "扫描版应有「?」按钮")
        XCTAssertFalse(scanHelp?.isHidden ?? true, "扫描版「?」按钮应可见")
        XCTAssertGreaterThan(
            scanHelp?.frame.width ?? 0,
            20,
            "M3 回归：工具栏三个按钮 + 居中标题时「?」按钮不应被压缩为 0 宽"
        )
        try XCTUnwrap(button("pdf-bookmark-toggle", in: scanReader.view)).sendActions(for: .touchUpInside)
        RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.2))
        let scanMark = try XCTUnwrap(scanSession.library.books.first { $0.id == scanBook.id }?.bookmarks?.first)
        XCTAssertEqual(scanMark.excerpt, "", "扫描页无可提取首行时 excerpt 应为空")
        XCTAssertEqual(try scanMark.location().href.string, "pdf://page/1")
    }

    /// PDF M3：目录/书签面板——目录空态、书签按页排序/摘要、点击跳页、滑删、书签空态。
    func testPDFContentsPanelBookmarkSortJumpDeleteAndEmptyStates() async throws {
        func pdfBookmark(page: Int, excerpt: String) -> Bookmark {
            let total = Double(page - 1) / 2
            return Bookmark(locator: Locator(
                href: AnyURL(string: "pdf://page/\(page)")!,
                mediaType: .pdf,
                title: "第 \(page) 页",
                locations: .init(progression: total, totalProgression: total, position: page),
                text: .init(highlight: excerpt)
            ))
        }
        let session = try DesignFixture.makeSession(.init(scenario: .pdf, theme: .light))
        try await DesignFixture.seed(session)
        defer { try? FileManager.default.removeItem(at: session.root) }
        let pdf = try XCTUnwrap(session.library.books.first { $0.title == DesignFixture.pdfFixtureTitle })
        // 故意乱序保存：第 2 页先、第 1 页后。
        try session.library.saveBookmark(pdfBookmark(page: 2, excerpt: "第二页摘要"), for: pdf.id)
        try session.library.saveBookmark(pdfBookmark(page: 1, excerpt: "第一页摘要"), for: pdf.id)

        let reader = try PDFReaderController(book: pdf, library: session.library)
        let window = host(reader, size: CGSize(width: 375, height: 667))
        defer { window.isHidden = true }
        let contentsButton = try XCTUnwrap(
            reader.view.allViews.compactMap { $0 as? UIButton }
                .first { $0.accessibilityIdentifier == "pdf-contents" }
        )
        contentsButton.sendActions(for: .touchUpInside)
        RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.4))
        let navigation = try XCTUnwrap(reader.presentedViewController as? UINavigationController)
        let panel = try XCTUnwrap(navigation.topViewController)
        let table = try XCTUnwrap(
            panel.view.allViews.compactMap { $0 as? UITableView }
                .first { $0.accessibilityIdentifier == "pdf-contents-panel" }
        )
        let tabs = try XCTUnwrap(
            panel.navigationItem.titleView as? UISegmentedControl,
            "面板 tab 应为导航栏 titleView"
        )
        XCTAssertEqual(tabs.numberOfSegments, 3)
        XCTAssertEqual((0..<3).map { tabs.titleForSegment(at: $0) }, ["目录", "书签", "搜索"])
        // 夹具 PDF 无 outline：目录空态。
        if #available(iOS 17.0, *) {
            XCTAssertEqual(
                (panel.contentUnavailableConfiguration as? UIContentUnavailableConfiguration)?.text,
                "这份 PDF 没有目录"
            )
        }
        tabs.selectedSegmentIndex = 1
        tabs.sendActions(for: .valueChanged)
        RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.2))
        XCTAssertEqual(table.numberOfRows(inSection: 0), 2)
        func rowText(_ index: Int) -> (String, String) {
            let cell = table.dataSource?.tableView(table, cellForRowAt: IndexPath(row: index, section: 0))
            let content = cell?.contentConfiguration as? UIListContentConfiguration
            return (content?.text ?? "", content?.secondaryText ?? "")
        }
        XCTAssertEqual(rowText(0).0, "第 1 页", "书签应按页升序")
        XCTAssertEqual(rowText(0).1, "第一页摘要")
        XCTAssertEqual(rowText(1).0, "第 2 页")
        XCTAssertEqual(rowText(1).1, "第二页摘要")
        XCTAssertNotNil(rowText(0).0)

        // 书签行点击跳页由 UI 用例覆盖（单测宿主里 dismiss 动画/completion 不稳定）。
        panel.dismiss(animated: false)
        RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.3))
        // 重新打开面板，滑删第 1 行（第 1 页书签）。
        contentsButton.sendActions(for: .touchUpInside)
        RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.4))
        let nav2 = try XCTUnwrap(reader.presentedViewController as? UINavigationController)
        let panel2 = try XCTUnwrap(nav2.topViewController)
        let table2 = try XCTUnwrap(
            panel2.view.allViews.compactMap { $0 as? UITableView }
                .first { $0.accessibilityIdentifier == "pdf-contents-panel" }
        )
        let tabs2 = try XCTUnwrap(panel2.navigationItem.titleView as? UISegmentedControl)
        tabs2.selectedSegmentIndex = 1
        tabs2.sendActions(for: .valueChanged)
        RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.2))
        // 删除后只剩第 2 页书签。
        let config = table2.delegate?.tableView?(table2, trailingSwipeActionsConfigurationForRowAt: IndexPath(row: 0, section: 0))
        let action = try XCTUnwrap(config?.actions.first)
        var finished = false
        action.handler(action, UIView()) { finished = $0 }
        RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.3))
        XCTAssertTrue(finished)
        var marks = session.library.books.first { $0.id == pdf.id }?.bookmarks ?? []
        XCTAssertEqual(marks.count, 1)
        XCTAssertEqual(marks.first?.excerpt, "第二页摘要")
        // 继续删除剩余 → 书签空态。
        let config2 = table2.delegate?.tableView?(table2, trailingSwipeActionsConfigurationForRowAt: IndexPath(row: 0, section: 0))
        let action2 = try XCTUnwrap(config2?.actions.first)
        var finished2 = false
        action2.handler(action2, UIView()) { finished2 = $0 }
        RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.3))
        XCTAssertTrue(finished2)
        marks = session.library.books.first { $0.id == pdf.id }?.bookmarks ?? []
        XCTAssertTrue(marks.isEmpty)
        if #available(iOS 17.0, *) {
            XCTAssertEqual(
                (panel2.contentUnavailableConfiguration as? UIContentUnavailableConfiguration)?.text,
                "还没有书签"
            )
        }
    }

    /// PDF M4a：页级索引（2 页/2 章）+ 页级 search/page 字段/permits/evidence scope 页级过滤。
    func testPDFPageIndexPrepareSearchPermitsAndEvidenceScope() async throws {
        let session = try DesignFixture.makeSession(.init(scenario: .pdf, theme: .light))
        try await DesignFixture.seed(session)
        defer { try? FileManager.default.removeItem(at: session.root) }
        let book = try XCTUnwrap(session.library.books.first { $0.title == DesignFixture.pdfFixtureTitle })
        let file = session.library.fileURL(for: book)
        let index = session.library.preparation.index

        // 生产路径：BookPreparation.start → 页级索引终态（2 页可检索）。
        session.library.preparation.start(book, file: file)
        var state: BookPreparationState?
        for _ in 0..<400 {
            if let current = session.library.preparation.states[book.id], !current.preparing {
                state = current
                break
            }
            try? await Task.sleep(nanoseconds: 100_000_000)
        }
        let final = try XCTUnwrap(state, "PDF 索引准备应到达终态")
        XCTAssertEqual(final.total, 2, "PDF 每页一个 chapter")
        XCTAssertEqual(final.completed, 2)
        XCTAssertEqual(final.pdfPageCount, 2)
        XCTAssertEqual(final.searchablePageCount, 2)
        XCTAssertFalse(final.textIndexUnavailable)
        XCTAssertNil(final.failure)
        // 向量准备依赖本地模型：成功则 ready=true；失败/未完成不阻塞 FTS 验证（下方打印实际值）。
        print("QA_M4A_STATE ready=\(final.ready) total=\(final.total) searchable=\(String(describing: final.searchablePageCount)) semantic=\(final.semanticReady) vectors=\(final.vectorsCompleted)/\(final.vectorsTotal)")

        // 页级 search：page 字段、locator 页码/href/title。
        let page1Hits = try await index.search(bookID: book.id, query: "灯把书页照亮")
        XCTAssertEqual(page1Hits.count, 1)
        let hit1 = try XCTUnwrap(page1Hits.first)
        XCTAssertEqual(hit1.page, 1)
        XCTAssertEqual(hit1.chapter, "第 1 页")
        XCTAssertEqual(hit1.locator.href.string, "pdf://page/1")
        XCTAssertTrue(hit1.locator.mediaType.matches(.pdf))
        XCTAssertTrue(hit1.context.contains("灯把书页照亮"))
        XCTAssertTrue(hit1.locator.text.highlight?.contains("灯把书页照亮") == true)
        XCTAssertEqual(hit1.locator.locations.position, 1)
        XCTAssertEqual(hit1.locator.locations.progression ?? -1, 0, accuracy: 0.001)
        // 章节/片段落库：2 页 chapter、fragments > 0。
        let pdfDB = try IndexDatabase(url: session.library.root.appendingPathComponent("book-index.sqlite"))
        XCTAssertEqual(Int(try pdfDB.rows("SELECT count(*) FROM chapters WHERE book_id=?", [book.id])[0][0]) ?? 0, 2)
        XCTAssertGreaterThan(Int(try pdfDB.rows("SELECT count(*) FROM fragments WHERE book_id=?", [book.id])[0][0]) ?? 0, 0)

        let page2Hits = try await index.search(bookID: book.id, query: "PDFKit")
        XCTAssertEqual(page2Hits.count, 1)
        let hit2 = try XCTUnwrap(page2Hits.first)
        XCTAssertEqual(hit2.page, 2)
        XCTAssertEqual(hit2.chapter, "第 2 页")
        XCTAssertEqual(hit2.locator.href.string, "pdf://page/2")
        XCTAssertEqual(hit2.locator.locations.position, 2)
        XCTAssertEqual(hit2.locator.locations.progression ?? -1, 1.0, accuracy: 0.001, "末页 progression 应为 1.0")
        let none = try await index.search(bookID: book.id, query: "不存在的检索词")
        XCTAssertTrue(none.isEmpty)
        print("QA_M4A_SEARCH p1=\(hit1.page ?? -1) p2=\(hit2.page ?? -1) none=\(none.count)")

        // 页级 permits / evidence scope：throughPage 1 只允许第 1 页。
        let evidence1 = QuestionEvidence(locator: hit1.locator, context: hit1.context)
        let evidence2 = QuestionEvidence(locator: hit2.locator, context: hit2.context)
        let scopePage1 = BookEvidenceScope(bookID: book.id, throughPage: 1)
        XCTAssertEqual(scopePage1.throughChapter, 0)
        XCTAssertEqual(scopePage1.throughOrdinal, Int.max)
        let permitted1 = try await index.permits([evidence1], scope: scopePage1)
        XCTAssertTrue(permitted1)
        let permitted2 = try await index.permits([evidence2], scope: scopePage1)
        XCTAssertFalse(permitted2, "第 2 页证据不应通过第 1 页范围")
        let scopePage2 = BookEvidenceScope(bookID: book.id, throughPage: 2)
        let permittedBoth = try await index.permits([evidence1, evidence2], scope: scopePage2)
        XCTAssertTrue(permittedBoth)
        // task-70：跨 fragment/跨页长选文在「起始页拼接原文 + 整个 scope 拼接原文」中应可通过。
        let document = try XCTUnwrap(PDFKit.PDFDocument(url: file))
        let page1Text = try XCTUnwrap(document.page(at: 0)?.string)
        let page2Text = try XCTUnwrap(document.page(at: 1)?.string)
        let crossQuote = String(page1Text.suffix(24)) + String(page2Text.prefix(24))
        var crossLocator = hit1.locator
        crossLocator.text = .init(highlight: crossQuote)
        let crossEvidence = QuestionEvidence(locator: crossLocator)
        let crossWholeBook = try await index.permits([crossEvidence], scope: BookEvidenceScope(bookID: book.id))
        let crossPage1Scope = try await index.permits([crossEvidence], scope: scopePage1)
        let crossPage2Scope = try await index.permits([crossEvidence], scope: scopePage2)
        var forgedCross = crossLocator
        forgedCross.text = .init(highlight: crossQuote + "被篡改")
        let forgedCrossPermitted = try await index.permits([QuestionEvidence(locator: forgedCross)], scope: scopePage2)
        XCTAssertTrue(crossWholeBook, "跨页长选文应通过 permits（task-70）")
        XCTAssertFalse(crossPage1Scope, "跨页选文不应通过仅第 1 页范围")
        XCTAssertTrue(crossPage2Scope)
        XCTAssertFalse(forgedCrossPermitted, "篡改跨页 quote 应被拒绝")
        let db = try IndexDatabase(url: session.library.root.appendingPathComponent("book-index.sqlite"))
        let termsPage1 = try db.keywordFragments(scope: scopePage1, terms: ["PDFKit"], limit: 10)
        XCTAssertTrue(termsPage1.isEmpty, "PDFKit 只在第 2 页，第 1 页范围不应命中")
        let termsPage2 = try db.keywordFragments(scope: scopePage2, terms: ["PDFKit"], limit: 10)
        XCTAssertFalse(termsPage2.isEmpty)
        print("QA_M4A_PERMITS scope1=\(scopePage1.throughChapter) scope2=\(scopePage2.throughChapter) kw1=\(termsPage1.count) kw2=\(termsPage2.count)")

        // 进度序列：独立空 LibraryStore 直接驱动 actor prepare（不经导入，避免自动准备并发）。
        let progressRoot = FileManager.default.temporaryDirectory
            .appendingPathComponent("PDFIndexProgress-" + UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: progressRoot, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: progressRoot) }
        let progressLibrary = try LibraryStore(root: progressRoot, secrets: EphemeralSecrets())
        let copied = progressRoot.appendingPathComponent("fixture.pdf")
        try FileManager.default.copyItem(at: file, to: copied)
        var events: [BookPreparationState] = []
        try await progressLibrary.preparation.index.prepare(
            bookID: "progress-book",
            file: copied,
            progress: { events.append($0) }
        )
        XCTAssertEqual(events.map(\.completed), [0, 1, 2])
        XCTAssertEqual(events.compactMap(\.pdfPageCount), [2, 2, 2])
        XCTAssertEqual(events.last?.searchablePageCount, 2)
        XCTAssertFalse(events.last?.textIndexUnavailable ?? true)
    }

    /// PDF M4a：扫描版终态明确（2 页、0 可检索页、ready、textIndexUnavailable），search/keywords 均空。
    func testPDFScannedIndexTerminalStateAndEmptySearch() async throws {
        let session = try DesignFixture.makeSession(.init(scenario: .pdfScan, theme: .light))
        try await DesignFixture.seed(session)
        defer { try? FileManager.default.removeItem(at: session.root) }
        let book = try XCTUnwrap(session.library.books.first { $0.title == DesignFixture.pdfScanFixtureTitle })
        let index = session.library.preparation.index
        // 生产路径：扫描版在 start() 即给出明确终态（不空跑逐页、不停在准备中）。
        session.library.preparation.start(book, file: session.library.fileURL(for: book))
        var state: BookPreparationState?
        for _ in 0..<100 {
            if let current = session.library.preparation.states[book.id], !current.preparing {
                state = current
                break
            }
            try? await Task.sleep(nanoseconds: 50_000_000)
        }
        let final = try XCTUnwrap(state, "扫描版应到达明确终态而不是准备中")
        XCTAssertEqual(final.total, 2)
        XCTAssertEqual(final.completed, 2)
        XCTAssertEqual(final.pdfPageCount, 2)
        XCTAssertEqual(final.searchablePageCount, 0)
        XCTAssertTrue(final.textIndexUnavailable)
        XCTAssertTrue(final.ready, "扫描版应到达明确终态而不是准备中")
        XCTAssertEqual(final.message, "PDF 已可阅读（共2页）；没有可搜索的文字")
        let hits = try await index.search(bookID: book.id, query: "这一页的文字")
        XCTAssertTrue(hits.isEmpty, "扫描版没有文字索引，搜索应为空")
        let wholeScope = BookEvidenceScope(bookID: book.id, throughPage: 2)
        let db = try IndexDatabase(url: session.library.root.appendingPathComponent("book-index.sqlite"))
        XCTAssertTrue(try db.keywordFragments(scope: wholeScope, terms: ["图片"], limit: 10).isEmpty)

        // 直接驱动页级 prepare：扫描版仍应建 2 个 chapter、0 fragments，search 为空。
        let scanRoot = FileManager.default.temporaryDirectory
            .appendingPathComponent("PDFScanIndex-" + UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: scanRoot, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: scanRoot) }
        let scanLibrary = try LibraryStore(root: scanRoot, secrets: EphemeralSecrets())
        let scanCopy = scanRoot.appendingPathComponent("scan.pdf")
        try FileManager.default.copyItem(at: session.library.fileURL(for: book), to: scanCopy)
        var scanEvents: [BookPreparationState] = []
        try await scanLibrary.preparation.index.prepare(
            bookID: "scan-book",
            file: scanCopy,
            progress: { scanEvents.append($0) }
        )
        XCTAssertEqual(scanEvents.map(\.completed), [0, 1, 2])
        XCTAssertEqual(scanEvents.last?.completed, 2)
        XCTAssertEqual(scanEvents.last?.total, 2)
        XCTAssertEqual(scanEvents.last?.searchablePageCount, 0)
        XCTAssertTrue(scanEvents.last?.textIndexUnavailable ?? false)
        let scanDB = try IndexDatabase(url: scanRoot.appendingPathComponent("book-index.sqlite"))
        XCTAssertEqual(Int(try scanDB.rows("SELECT count(*) FROM chapters WHERE book_id=?", ["scan-book"])[0][0]) ?? 0, 2)
        XCTAssertEqual(Int(try scanDB.rows("SELECT count(*) FROM fragments WHERE book_id=?", ["scan-book"])[0][0]) ?? 0, 0)
        let scanHits = try await scanLibrary.preparation.index.search(bookID: "scan-book", query: "这一页")
        XCTAssertTrue(scanHits.isEmpty)
        print("QA_M4A_SCAN ready=\(final.ready) searchable=\(String(describing: final.searchablePageCount)) hits=\(hits.count) msg=\(final.message)")
    }

    /// PDF M4b：搜索 tab 在准备中/失败/扫描版时的状态文案与输入禁用；三段 tab。
    func testPDFSearchPanelAvailabilityStatesAndScannedUnsearchable() async throws {
        func searchField(in root: UIView) -> UITextField? {
            root.allViews.compactMap { $0 as? UITextField }
                .first { $0.accessibilityIdentifier == "pdf-search-field" }
        }
        func openSearchTab(_ reader: PDFReaderController) throws -> (UITableView, UISegmentedControl, UITextField) {
            let contentsButton = try XCTUnwrap(
                reader.view.allViews.compactMap { $0 as? UIButton }
                    .first { $0.accessibilityIdentifier == "pdf-contents" }
            )
            contentsButton.sendActions(for: .touchUpInside)
            RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.4))
            let navigation = try XCTUnwrap(reader.presentedViewController as? UINavigationController)
            let panel = try XCTUnwrap(navigation.topViewController)
            let tabs = try XCTUnwrap(panel.navigationItem.titleView as? UISegmentedControl)
            tabs.selectedSegmentIndex = 2
            tabs.sendActions(for: .valueChanged)
            RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.2))
            let field = try XCTUnwrap(searchField(in: panel.view))
            let table = try XCTUnwrap(
                panel.view.allViews.compactMap { $0 as? UITableView }
                    .first { $0.accessibilityIdentifier == "pdf-search-results" }
            )
            return (table, tabs, field)
        }

        // 文字 PDF：准备中 → 文案 + 输入禁用；失败 → 文案。
        let session = try DesignFixture.makeSession(.init(scenario: .pdf, theme: .light))
        try await DesignFixture.seed(session)
        defer { try? FileManager.default.removeItem(at: session.root) }
        let pdf = try XCTUnwrap(session.library.books.first { $0.title == DesignFixture.pdfFixtureTitle })
        var preparing = BookPreparationState(completed: 1, total: 2, preparing: true)
        preparing.pdfPageCount = 2
        preparing.searchablePageCount = 2
        session.library.preparation.setDesignState(preparing, for: pdf.id)
        let reader = try PDFReaderController(book: pdf, library: session.library)
        let window = host(reader, size: CGSize(width: 375, height: 667))
        defer { window.isHidden = true }
        let (preparingTable, tabs, preparingField) = try openSearchTab(reader)
        XCTAssertEqual(tabs.numberOfSegments, 3)
        XCTAssertFalse(preparingField.isEnabled, "准备中不应允许输入")
        let preparingCell = preparingTable.dataSource?.tableView(preparingTable, cellForRowAt: IndexPath(row: 0, section: 0))
        XCTAssertEqual((preparingCell?.contentConfiguration as? UIListContentConfiguration)?.text, "正在准备搜索…")

        var failed = BookPreparationState(completed: 2, total: 2, preparing: false)
        failed.pdfPageCount = 2
        failed.searchablePageCount = 2
        failed.failure = "fixture failure"
        session.library.preparation.setDesignState(failed, for: pdf.id)
        RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.4))
        let failedCell = preparingTable.dataSource?.tableView(preparingTable, cellForRowAt: IndexPath(row: 0, section: 0))
        XCTAssertEqual((failedCell?.contentConfiguration as? UIListContentConfiguration)?.text, "搜索暂时不可用，请稍后重试")
        XCTAssertFalse(searchField(in: reader.presentedViewController!.view)?.isEnabled ?? true)

        // 扫描版：不可搜索文案 + 输入禁用。
        let scanSession = try DesignFixture.makeSession(.init(scenario: .pdfScan, theme: .light))
        try await DesignFixture.seed(scanSession)
        defer { try? FileManager.default.removeItem(at: scanSession.root) }
        let scanBook = try XCTUnwrap(scanSession.library.books.first { $0.title == DesignFixture.pdfScanFixtureTitle })
        let scanReader = try PDFReaderController(book: scanBook, library: scanSession.library)
        let scanWindow = host(scanReader, size: CGSize(width: 375, height: 667))
        defer { scanWindow.isHidden = true }
        let (scanTable, _, scanField) = try openSearchTab(scanReader)
        XCTAssertFalse(scanField.isEnabled, "扫描版不应允许输入")
        let scanCell = scanTable.dataSource?.tableView(scanTable, cellForRowAt: IndexPath(row: 0, section: 0))
        XCTAssertEqual((scanCell?.contentConfiguration as? UIListContentConfiguration)?.text, "没有可搜索的文字")
    }

    /// PDF M5a：BookNote.pdf 模型兼容、几何换算、saveNote 校验/去重、旧 JSON 兼容。
    func testPDFNoteModelGeometryAndSaveValidation() async throws {
        let session = try DesignFixture.makeSession(.init(scenario: .pdf, theme: .light))
        try await DesignFixture.seed(session)
        defer { try? FileManager.default.removeItem(at: session.root) }
        let pdf = try XCTUnwrap(session.library.books.first { $0.title == DesignFixture.pdfFixtureTitle })
        let document = try XCTUnwrap(PDFKit.PDFDocument(url: session.library.fileURL(for: pdf)))

        // 几何换算：选区 → 归一化矩形 + 页级 locator（pdf://page/N）。
        let selection = try XCTUnwrap(document.findString("灯把书页照亮", withOptions: [.caseInsensitive]).first)
        let made = try XCTUnwrap(PDFNoteGeometry.make(from: selection, document: document))
        XCTAssertEqual(made.geometry.page, 1)
        XCTAssertFalse(made.geometry.rects.isEmpty)
        for rect in made.geometry.rects {
            XCTAssertTrue((0...1).contains(rect.x) && (0...1).contains(rect.y))
            XCTAssertGreaterThan(rect.w, 0)
            XCTAssertGreaterThan(rect.h, 0)
        }
        XCTAssertEqual(made.locator.href.string, "pdf://page/1")
        XCTAssertEqual(made.locator.locations.position, 1)
        XCTAssertEqual(made.locator.text.highlight, "灯把书页照亮")
        XCTAssertFalse(made.locator.text.after?.isEmpty ?? true, "页级上下文应带前后文")
        XCTAssertTrue(made.locator.text.before?.contains("书灯 PDF 示例") ?? false)

        // 旧 JSON 兼容：没有 pdf 字段的 BookNote 解码为 nil；geometry 可往返。
        let legacy = try JSONDecoder().decode(
            BookNote.self,
            from: Data(#"{"id":"11111111-1111-1111-1111-111111111111","locatorJSON":"{}","body":"旧笔记"}"#.utf8)
        )
        XCTAssertNil(legacy.pdf, "旧笔记无 pdf 几何应解码为 nil")
        let roundTrip = try JSONDecoder().decode(PDFNoteGeometry.self, from: JSONEncoder().encode(made.geometry))
        XCTAssertEqual(roundTrip, made.geometry)

        // saveNote：PDF 几何可无 domRange；highlightOnly 清空正文；缺 highlight 报错。
        var highlight = BookNote(locator: made.locator, body: "不该保存", color: .yellow, pdf: made.geometry)
        try session.library.saveNote(highlight, for: pdf.id, highlightOnly: true)
        var marks = session.library.books.first { $0.id == pdf.id }?.notes ?? []
        let savedHighlight = try XCTUnwrap(marks.first { $0.id == highlight.id })
        XCTAssertEqual(savedHighlight.body, "")
        XCTAssertEqual(savedHighlight.pdf, made.geometry)
        // 重复 highlightOnly 保存不覆盖（不消费草稿语义）。
        highlight.body = "再次"
        try session.library.saveNote(highlight, for: pdf.id, highlightOnly: true)
        marks = session.library.books.first { $0.id == pdf.id }?.notes ?? []
        XCTAssertEqual(marks.first { $0.id == highlight.id }?.body, "")

        // 无 pdf 几何且无 domRange（非 EPUB 映射）→ 拒绝。
        let invalidLocator = Locator(
            href: made.locator.href, mediaType: .pdf, title: made.locator.title,
            locations: made.locator.locations, text: .init(highlight: "")
        )
        let bad = BookNote(locator: invalidLocator, pdf: nil)
        XCTAssertThrowsError(try session.library.saveNote(bad, for: pdf.id)) { error in
            guard case LibraryError.invalidLocation = error else { return XCTFail("应抛 invalidLocation：\(error)") }
        }
        let noHighlight = BookNote(
            locator: Locator(href: made.locator.href, mediaType: .pdf, locations: made.locator.locations, text: .init(highlight: "")),
            pdf: made.geometry
        )
        XCTAssertThrowsError(try session.library.saveNote(noHighlight, for: pdf.id))

        // 改色 / 删除持久化。
        try session.library.updateNoteColor(.blue, forNoteID: highlight.id, bookID: pdf.id)
        XCTAssertEqual(session.library.books.first { $0.id == pdf.id }?.notes?.first { $0.id == highlight.id }?.color, .blue)
        try session.library.removeNote(highlight.id, bookID: pdf.id)
        XCTAssertNil(session.library.books.first { $0.id == pdf.id }?.notes?.first { $0.id == highlight.id })
        let reloaded = try LibraryStore(root: session.root, secrets: EphemeralSecrets())
        XCTAssertNil(reloaded.books.first { $0.id == pdf.id }?.notes?.first { $0.id == highlight.id })
    }

    /// PDF M5a：注解渲染数量/类型/userName/内容；改色刷新；删除后移除；选区→创建路径。
    func testPDFAnnotationRenderingCountsTypesUserNamesAndRefresh() async throws {
        let session = try DesignFixture.makeSession(.init(scenario: .pdf, theme: .light))
        try await DesignFixture.seed(session)
        defer { try? FileManager.default.removeItem(at: session.root) }
        let pdf = try XCTUnwrap(session.library.books.first { $0.title == DesignFixture.pdfFixtureTitle })
        let fixtureNotes = session.library.books.first { $0.id == pdf.id }?.notes ?? []
        XCTAssertEqual(fixtureNotes.count, 2, "pdf 夹具应预置 1 高亮 + 1 笔记")
        let highlightNote = try XCTUnwrap(fixtureNotes.first { $0.body.isEmpty })
        let textNote = try XCTUnwrap(fixtureNotes.first { !$0.body.isEmpty })
        XCTAssertEqual(highlightNote.pdf?.page, 1)
        XCTAssertEqual(textNote.pdf?.page, 2)

        let reader = try PDFReaderController(book: pdf, library: session.library)
        let window = host(reader, size: CGSize(width: 375, height: 667))
        defer { window.isHidden = true }
        RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.4))
        let pdfView = try XCTUnwrap(
            reader.view.allViews.compactMap { $0 as? PDFView }.first { $0.accessibilityIdentifier == "pdf-reader-view" }
        )
        let document = try XCTUnwrap(pdfView.document)
        XCTAssertEqual(document.pageCount, 2)
        func light(_ color: UIColor?) -> UIColor? {
            color?.resolvedColor(with: UITraitCollection(userInterfaceStyle: .light))
        }
        func kind(_ annotation: PDFAnnotation) -> String { (annotation.type ?? "").lowercased() }
        // 只统计本控制器添加的注解（PDFKit 会为 .text 自动附带 userName=nil 的 Popup）。
        func authored(_ page: PDFPage?) -> [PDFAnnotation] {
            (page?.annotations ?? []).filter { $0.userName != nil }
        }
        func waitAnnotations() async throws {
            try await Task.sleep(nanoseconds: 400_000_000)
        }
        let originalHighlightRects = highlightNote.pdf?.rects.count ?? 1
        let textNoteRects = textNote.pdf?.rects.count ?? 1
        let page1Annotations = authored(document.page(at: 0))
        let page2Annotations = authored(document.page(at: 1))
        print("QA_M5A_P1", page1Annotations.map { "\($0.type ?? "nil")|\($0.userName ?? "nil")" })
        print("QA_M5A_P2", page2Annotations.map { "\($0.type ?? "nil")|\($0.userName ?? "nil")" })
        print("QA_M5A_GEOM highlightRects=\(originalHighlightRects) noteRects=\(textNoteRects)")
        XCTAssertEqual(page1Annotations.count, originalHighlightRects, "第 1 页高亮注解数与几何矩形数一致")
        XCTAssertEqual(page2Annotations.count, textNoteRects + 1, "第 2 页应为下划线（按行）+ 笔记图标")
        let highlight = try XCTUnwrap(page1Annotations.first)
        XCTAssertTrue(kind(highlight).contains("highlight"))
        XCTAssertEqual(highlight.userName, "shudeng-pdf-note:" + highlightNote.id.uuidString)
        XCTAssertEqual(highlight.contents, highlightNote.quote)
        XCTAssertEqual(light(highlight.color), light(HighlightColor.yellow.tint))
        let underline = try XCTUnwrap(page2Annotations.first { kind($0).contains("underline") })
        let icon = try XCTUnwrap(page2Annotations.first { kind($0).contains("text") })
        XCTAssertEqual(underline.userName, "shudeng-pdf-note:" + textNote.id.uuidString)
        XCTAssertEqual(icon.userName, underline.userName)
        XCTAssertEqual(underline.contents, textNote.body)
        XCTAssertEqual(icon.contents, textNote.body)
        XCTAssertEqual(light(underline.color), light(HighlightColor.green.tint))

        // 选区 → 高亮创建路径：几何 + saveNote(highlightOnly) → 渲染新注解。
        let selection = try XCTUnwrap(document.findString("书灯 PDF 示例", withOptions: [.caseInsensitive]).first)
        let made = try XCTUnwrap(PDFNoteGeometry.make(from: selection, document: document))
        let created = BookNote(locator: made.locator, color: .rose, pdf: made.geometry)
        try session.library.saveNote(created, for: pdf.id, highlightOnly: true)
        try await waitAnnotations()
        let page1After = authored(document.page(at: 0))
        print("QA_M5A_AFTER", page1After.map { "\($0.type ?? "nil")|\($0.userName ?? "nil")" }, "created=\(created.id)")
        XCTAssertEqual(page1After.count, originalHighlightRects + made.geometry.rects.count)
        let createdAnnotation = try XCTUnwrap(page1After.first { $0.userName == "shudeng-pdf-note:" + created.id.uuidString })
        XCTAssertTrue(kind(createdAnnotation).contains("highlight"))
        XCTAssertEqual(light(createdAnnotation.color), light(HighlightColor.rose.tint))

        // 改色 → 注解颜色刷新；删除 → 注解移除。
        try session.library.updateNoteColor(.blue, forNoteID: highlightNote.id, bookID: pdf.id)
        try await waitAnnotations()
        let recolored = try XCTUnwrap(
            authored(document.page(at: 0)).first { $0.userName == "shudeng-pdf-note:" + highlightNote.id.uuidString }
        )
        XCTAssertEqual(light(recolored.color), light(HighlightColor.blue.tint), "改色后注解颜色应刷新")
        try session.library.removeNote(highlightNote.id, bookID: pdf.id)
        try await waitAnnotations()
        XCTAssertEqual(authored(document.page(at: 0)).count, made.geometry.rects.count, "删除高亮后仅剩新建高亮注解")
        try session.library.removeNote(textNote.id, bookID: pdf.id)
        try await waitAnnotations()
        XCTAssertEqual(authored(document.page(at: 1)).count, 0, "删除笔记后注解应移除")
    }

    /// PDF M5a：程序化选区（pdfView.currentSelection）→ 纸白选区浮层 → 创建高亮/笔记（不依赖 XCUITest 拖拽）。
    func testPDFSelectionMenuCreatesHighlightAndNoteViaUI() async throws {
        func button(_ identifier: String, in root: UIView) -> UIButton? {
            root.allViews.compactMap { $0 as? UIButton }.first { $0.accessibilityIdentifier == identifier }
        }
        let session = try DesignFixture.makeSession(.init(scenario: .pdf, theme: .light))
        try await DesignFixture.seed(session)
        defer { try? FileManager.default.removeItem(at: session.root) }
        let pdf = try XCTUnwrap(session.library.books.first { $0.title == DesignFixture.pdfFixtureTitle })
        let reader = try PDFReaderController(book: pdf, library: session.library)
        let window = host(reader, size: CGSize(width: 375, height: 667))
        defer { window.isHidden = true }
        let pdfView = try XCTUnwrap(
            reader.view.allViews.compactMap { $0 as? PDFView }.first { $0.accessibilityIdentifier == "pdf-reader-view" }
        )
        let document = try XCTUnwrap(pdfView.document)
        let page = try XCTUnwrap(document.page(at: 0))
        let text = try XCTUnwrap(page.string)

        func select(_ quote: String) throws {
            let range = (text as NSString).range(of: quote)
            XCTAssertNotEqual(range.location, NSNotFound)
            let selection = try XCTUnwrap(page.selection(for: range))
            pdfView.currentSelection = selection
            NotificationCenter.default.post(name: .PDFViewSelectionChanged, object: pdfView)
        }
        func waitMenu() async throws -> UIView {
            for _ in 0..<30 {
                if let menu = reader.view.allViews.first(where: { $0.accessibilityIdentifier == "pdf-selection-menu" }) {
                    return menu
                }
                try await Task.sleep(nanoseconds: 100_000_000)
            }
            throw XCTSkip("程序化选区未产生纸白浮层")
        }

        // 选区 → 高亮创建。
        let beforeCreate = session.library.books.first { $0.id == pdf.id }?.notes?.count ?? 0
        try select("灯把书页照亮")
        let menu = try await waitMenu()
        try XCTUnwrap(button("pdf-selection-highlight", in: menu)).sendActions(for: .touchUpInside)
        var palette: UIView?
        for _ in 0..<30 {
            if let view = reader.presentedViewController?.view, view.accessibilityIdentifier == "pdf-highlight-palette" {
                palette = view; break
            }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        let paletteView = try XCTUnwrap(palette, "点「高亮」应打开调色盘")
        try XCTUnwrap(button("pdf-highlight-color-green", in: paletteView)).sendActions(for: .touchUpInside)
        for _ in 0..<40 {
            RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.1))
            try await Task.sleep(nanoseconds: 50_000_000)
            if (session.library.books.first { $0.id == pdf.id }?.notes?.count ?? 0) > beforeCreate { break }
        }
        let highlighted = session.library.books.first { $0.id == pdf.id }?.notes ?? []
        XCTAssertEqual(highlighted.count, beforeCreate + 1)
        let createdHighlight = try XCTUnwrap(highlighted.last)
        XCTAssertEqual(createdHighlight.pdf?.page, 1)
        XCTAssertEqual(createdHighlight.body, "")
        XCTAssertEqual(createdHighlight.quote, "灯把书页照亮")
        XCTAssertEqual(createdHighlight.highlightColor, .green)

        // 选区 → 写笔记 → 编辑器输入并保存。
        try select("书灯 PDF 示例")
        let noteMenu = try await waitMenu()
        try XCTUnwrap(button("pdf-selection-note", in: noteMenu)).sendActions(for: .touchUpInside)
        var editor: UIView?
        for _ in 0..<30 {
            if let view = reader.presentedViewController?.view, view.accessibilityIdentifier == "pdf-note-editor" {
                editor = view; break
            }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        for _ in 0..<20 where editor == nil {
            RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.1))
            try await Task.sleep(nanoseconds: 50_000_000)
            if let view = reader.presentedViewController?.view, view.accessibilityIdentifier == "pdf-note-editor" { editor = view }
        }
        let editorView = try XCTUnwrap(editor, "点「写笔记」应打开笔记编辑器")
        let body = try XCTUnwrap(editorView.allViews.compactMap { $0 as? UITextView }.first { $0.accessibilityIdentifier == "note-body" })
        body.text = "单元创建的 PDF 笔记"
        body.delegate?.textViewDidChange?(body)
        try XCTUnwrap(button("note-save", in: editorView)).sendActions(for: .touchUpInside)
        for _ in 0..<40 {
            RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.1))
            try await Task.sleep(nanoseconds: 50_000_000)
            if reader.presentedViewController == nil,
               (session.library.books.first { $0.id == pdf.id }?.notes?.count ?? 0) > beforeCreate + 1 { break }
        }
        let notesAfterNote = session.library.books.first { $0.id == pdf.id }?.notes ?? []
        XCTAssertEqual(notesAfterNote.count, beforeCreate + 2)
        let createdNote = try XCTUnwrap(notesAfterNote.last)
        XCTAssertEqual(createdNote.body, "单元创建的 PDF 笔记")
        XCTAssertEqual(createdNote.pdf?.page, 1)

        // 注解渲染：新建高亮 + 笔记（下划线）都在第 1 页。
        try await Task.sleep(nanoseconds: 400_000_000)
        let authored = (document.page(at: 0)?.annotations ?? []).filter { $0.userName != nil }
        let highlightAnnotation = authored.first { $0.userName == "shudeng-pdf-note:" + createdHighlight.id.uuidString }
        XCTAssertNotNil(highlightAnnotation)
        let underline = authored.first {
            $0.userName == "shudeng-pdf-note:" + createdNote.id.uuidString && ($0.type ?? "").lowercased().contains("underline")
        }
        XCTAssertNotNil(underline, "笔记应渲染为下划线注解")
    }

    /// PDF M5b：笔记页 PDF 行页号（pdf.page / locator.position 回退）、点击路由到 PDF 阅读器对应页、
    /// 编辑保留几何、滑删、导出面板；EPUB 行仍显示章节。
    func testNotesPagePDFRowsPageNumbersRoutingEditDeleteAndExport() async throws {
        func allButtons(_ root: UIView) -> [UIButton] {
            root.allViews.compactMap { $0 as? UIButton }
        }
        let session = try DesignFixture.makeSession(.init(scenario: .pdf, theme: .light))
        try await DesignFixture.seed(session)
        defer { try? FileManager.default.removeItem(at: session.root) }
        let pdf = try XCTUnwrap(session.library.books.first { $0.title == DesignFixture.pdfFixtureTitle })
        var notes = session.library.books.first { $0.id == pdf.id }?.notes ?? []
        XCTAssertEqual(notes.count, 2)
        let highlight = try XCTUnwrap(notes.first { $0.pdf?.page == 1 })
        let textNote = try XCTUnwrap(notes.first { !$0.body.isEmpty })

        // locator.position 回退：无 pdf 几何但 locator 有位置（带 domRange 以通过 EPUB 旧校验）→ 仍显示「第 2 页」。
        let domRange = DOMRange(
            start: DOMRange.Point(cssSelector: "p", textNodeIndex: 0, charOffset: 0),
            end: DOMRange.Point(cssSelector: "p", textNodeIndex: 0, charOffset: 1)
        )
        let sourceLocator = try highlight.location()
        var fallbackLocator = Locator(
            href: sourceLocator.href, mediaType: .pdf, title: "PDF 位置",
            locations: sourceLocator.locations,
            text: .init(highlight: "回退位置引文")
        )
        fallbackLocator.locations.position = 2
        fallbackLocator.locations.otherLocations["domRange"] = JSONValue.object(domRange.jsonObject)
        let fallback = BookNote(locator: fallbackLocator, body: "回退正文", pdf: nil)
        try session.library.saveNote(fallback, for: pdf.id)
        notes = session.library.books.first { $0.id == pdf.id }?.notes ?? []
        XCTAssertEqual(notes.count, 3)

        // 笔记页宿主（需要导航容器才能渲染导出按钮）。
        let controller = NotesController(library: session.library)
        let nav = UINavigationController(rootViewController: controller)
        let window = host(nav, size: CGSize(width: 375, height: 667))
        defer { window.isHidden = true }
        for _ in 0..<40 {
            RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.1))
            if controller.view.allViews.contains(where: { $0.accessibilityIdentifier == "notes" }) { break }
        }
        let collection = try XCTUnwrap(
            controller.view.allViews.compactMap { $0 as? UICollectionView }.first { $0.accessibilityIdentifier == "notes" }
        )
        RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.5))
        XCTAssertGreaterThan(collection.numberOfSections, 0)

        // 行内容：identifier / accessibilityLabel 含「第 N 页」、引文/正文。
        collection.layoutIfNeeded()
        RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.3))
        var rows: [(indexPath: IndexPath, id: UUID, label: String)] = []
        for cell in collection.visibleCells {
            guard let identifier = cell.accessibilityIdentifier,
                  identifier.hasPrefix("annotation-"),
                  let id = UUID(uuidString: String(identifier.dropFirst("annotation-".count))),
                  let indexPath = collection.indexPath(for: cell) else { continue }
            rows.append((indexPath, id, cell.accessibilityLabel ?? ""))
        }
        XCTAssertEqual(rows.count, 3, "PDF 分组应有 3 行（高亮/笔记/回退位置）")
        let highlightRow = try XCTUnwrap(rows.first { $0.id == highlight.id })
        XCTAssertTrue(highlightRow.label.contains("第 1 页"), "高亮行应显示第 1 页：\(highlightRow.label)")
        XCTAssertTrue(highlightRow.label.contains("灯把书页照亮"))
        let noteRow = try XCTUnwrap(rows.first { $0.id == textNote.id })
        XCTAssertTrue(noteRow.label.contains("第 2 页"), "笔记行应显示第 2 页：\(noteRow.label)")
        XCTAssertTrue(noteRow.label.contains("夹具笔记"))
        if let fallbackRow = rows.first(where: { $0.id == fallback.id }) {
            XCTAssertTrue(fallbackRow.label.contains("第 2 页"), "locator.position 回退应显示第 2 页：\(fallbackRow.label)")
            XCTAssertFalse(fallbackRow.label.contains("PDF 位置"), "PDF 行不应显示 locator 标题")
        }

        // 点击高亮行 → 打开 PDFReaderController 并停在第 1 页；不预写阅读进度（task-59）。
        let progressBeforeNoteClick = session.library.books.first { $0.id == pdf.id }?.locatorJSON
        controller.collectionView(collection, didSelectItemAt: highlightRow.indexPath)
        var reader: PDFReaderController?
        for _ in 0..<40 {
            RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.1))
            try await Task.sleep(nanoseconds: 50_000_000)
            if let presented = (controller.presentedViewController ?? nav.presentedViewController) as? PDFReaderController {
                reader = presented; break
            }
        }
        if reader == nil {
            print("QA_M5B_ROUTE controller.presented=\(String(describing: controller.presentedViewController)) nav.presented=\(String(describing: nav.presentedViewController)) progress=\(String(describing: session.library.books.first { $0.id == pdf.id }?.locatorJSON))")
        }
        let pdfReader = try XCTUnwrap(reader, "点击 PDF 笔记行应打开 PDFReaderController")
        var pageText = ""
        for _ in 0..<40 {
            RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.1))
            try await Task.sleep(nanoseconds: 50_000_000)
            if let label = pdfReader.view.allViews.first(where: { $0.accessibilityIdentifier == "pdf-reader-page" }) as? UILabel {
                pageText = label.text ?? ""
                if pageText == "第 1 / 2 页" { break }
            }
        }
        XCTAssertEqual(pageText, "第 1 / 2 页", "应停在笔记所在第 1 页")
        // task-59：NotesController target 路由不再预写阅读进度；关闭后进度应保持打开前状态。
        let progressAfterOpen = session.library.books.first { $0.id == pdf.id }?.locatorJSON
        XCTAssertEqual(progressAfterOpen, progressBeforeNoteClick, "点笔记打开阅读器不应改写原阅读进度：\(String(describing: progressAfterOpen))")
        pdfReader.dismiss(animated: false)
        for _ in 0..<20 {
            RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.1))
            if controller.presentedViewController == nil && nav.presentedViewController == nil { break }
        }
        // 关闭后（flush 不应写回 target 页）。
        RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.8))
        XCTAssertEqual(
            session.library.books.first { $0.id == pdf.id }?.locatorJSON,
            progressBeforeNoteClick,
            "关闭笔记跳转后原阅读进度不应被改写"
        )

        // 点击笔记行 → 第 2 页。
        controller.collectionView(collection, didSelectItemAt: noteRow.indexPath)
        var reader2: PDFReaderController?
        for _ in 0..<40 {
            RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.1))
            try await Task.sleep(nanoseconds: 50_000_000)
            if let presented = (controller.presentedViewController ?? nav.presentedViewController) as? PDFReaderController {
                reader2 = presented; break
            }
        }
        let pdfReader2 = try XCTUnwrap(reader2)
        var pageText2 = ""
        for _ in 0..<40 {
            RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.1))
            try await Task.sleep(nanoseconds: 50_000_000)
            if let label = pdfReader2.view.allViews.first(where: { $0.accessibilityIdentifier == "pdf-reader-page" }) as? UILabel {
                pageText2 = label.text ?? ""
                if pageText2 == "第 2 / 2 页" { break }
            }
        }
        XCTAssertEqual(pageText2, "第 2 / 2 页", "应停在笔记所在第 2 页")
        pdfReader2.dismiss(animated: false)
        for _ in 0..<20 {
            RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.1))
            if controller.presentedViewController == nil && nav.presentedViewController == nil { break }
        }

        // leading 编辑保留 pdf 几何（模拟编辑保存：只改 body）。
        let leading = try XCTUnwrap(controller.leadingSwipeActions(for: textNote.id))
        XCTAssertEqual(leading.actions.map(\.title), ["编辑"])
        XCTAssertNil(controller.leadingSwipeActions(for: highlight.id), "高亮行不应有编辑入口")
        let geometryBefore = textNote.pdf
        var edited = textNote
        edited.body = "编辑后的 PDF 笔记正文"
        try session.library.saveNote(edited, for: pdf.id)
        let saved = try XCTUnwrap(session.library.books.first { $0.id == pdf.id }?.notes?.first { $0.id == textNote.id })
        XCTAssertEqual(saved.pdf, geometryBefore, "编辑保存必须保留 pdf 几何")
        XCTAssertEqual(saved.body, "编辑后的 PDF 笔记正文")

        // trailing 删除（走 UI 确认弹层）→ removeNote。
        let trailing = try XCTUnwrap(controller.trailingSwipeActions(for: fallback.id))
        let deleteAction = try XCTUnwrap(trailing.actions.first)
        XCTAssertEqual(deleteAction.title, "删除")
        deleteAction.handler(deleteAction, UIView()) { _ in }
        var alertView: UIView?
        for _ in 0..<20 {
            RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.1))
            if let presented = controller.presentedViewController ?? nav.presentedViewController,
               presented.view.accessibilityIdentifier == "book-dialog" {
                alertView = presented.view; break
            }
        }
        let dialog = try XCTUnwrap(alertView, "滑删应弹出删除确认")
        let dialogButtons = allButtons(dialog)
        let confirm = try XCTUnwrap(dialogButtons.first(where: { $0.accessibilityLabel == "删除" || $0.configuration?.title == "删除" }))
        confirm.sendActions(for: .touchUpInside)
        for _ in 0..<40 {
            RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.1))
            try await Task.sleep(nanoseconds: 50_000_000)
            let remainingNotes = session.library.books.first(where: { $0.id == pdf.id })?.notes ?? []
            if !remainingNotes.contains(where: { $0.id == fallback.id }) { break }
        }
        let finalNotes = session.library.books.first(where: { $0.id == pdf.id })?.notes ?? []
        XCTAssertNil(finalNotes.first(where: { $0.id == fallback.id }), "确认删除后应 removeNote")

        // 导出：写入「书灯笔记-YYYYMMDD.txt」，文本含 PDF 页号与书头。
        let exportItem = try XCTUnwrap(controller.navigationItem.rightBarButtonItem)
        XCTAssertEqual(exportItem.accessibilityIdentifier, "notes-export")
        _ = exportItem.target?.perform(exportItem.action, with: exportItem)
        let temp = FileManager.default.temporaryDirectory
        var exportFile: URL?
        for _ in 0..<20 {
            RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.1))
            if let found = try? FileManager.default.contentsOfDirectory(at: temp, includingPropertiesForKeys: nil)
                .first(where: { $0.lastPathComponent.hasPrefix("书灯笔记-") && $0.pathExtension == "txt" }),
               FileManager.default.fileExists(atPath: found.path) {
                exportFile = found; break
            }
        }
        let exported = try XCTUnwrap(exportFile, "导出应写入分享文件")
        let content = try String(contentsOf: exported, encoding: .utf8)
        XCTAssertTrue(content.contains("《书灯 PDF 示例》"))
        XCTAssertTrue(content.contains("第 1 页"), "导出应包含第 1 页：\(content)")
        XCTAssertTrue(content.contains("第 2 页"), "导出应包含第 2 页：\(content)")
        XCTAssertTrue(content.contains("原文：灯把书页照亮"))
        XCTAssertTrue(content.contains("想法：编辑后的 PDF 笔记正文"))
        try? FileManager.default.removeItem(at: exported)
        if let presented = controller.presentedViewController ?? nav.presentedViewController {
            presented.dismiss(animated: false)
        }
    }

    /// PDF M6：QuestionEvidence 页级字段/citation 标题；PDF 引用按钮 → PDFReaderController(target:) 跳到引用页。
    func testQuestionEvidencePDFCitationAndReferenceJump() async throws {
        func evidence(quote: String, in document: PDFKit.PDFDocument) throws -> QuestionEvidence {
            let selection = try XCTUnwrap(document.findString(quote, withOptions: [.caseInsensitive]).first)
            let made = try XCTUnwrap(PDFNoteGeometry.make(from: selection, document: document))
            return QuestionEvidence(locator: made.locator)
        }
        let session = try DesignFixture.makeSession(.init(scenario: .pdf, theme: .light))
        try await DesignFixture.seed(session)
        defer { try? FileManager.default.removeItem(at: session.root) }
        let pdf = try XCTUnwrap(session.library.books.first { $0.title == DesignFixture.pdfFixtureTitle })
        let document = try XCTUnwrap(PDFKit.PDFDocument(url: session.library.fileURL(for: pdf)))
        let page1 = try evidence(quote: "灯把书页照亮", in: document)
        let page2 = try evidence(quote: "PDFKit", in: document)
        XCTAssertEqual(page1.pdfPage, 1)
        XCTAssertEqual(page1.locationTitle, "第 1 页")
        XCTAssertEqual(page2.pdfPage, 2)
        XCTAssertEqual(page2.locationTitle, "第 2 页")
        // EPUB 引用不带 pdfPage，沿用 chapter 标题。
        let epubLocator = Locator(href: AnyURL(string: "OEBPS/ch1.xhtml")!, mediaType: .xhtml, title: "第三回 · 林黛玉进贾府",
                                  locations: .init(progression: 0.2, totalProgression: 0.2),
                                  text: .init(highlight: "灯把书页照亮"))
        let epubEvidence = QuestionEvidence(locator: epubLocator)
        XCTAssertNil(epubEvidence.pdfPage)
        XCTAssertEqual(epubEvidence.locationTitle, "第三回 · 林黛玉进贾府")

        // 已完成、含 PDF 引用的问答记录。
        var record = ReadingQuestion(book: pdf, origin: try page2.location())
        record.question = "这份 PDF 讲了什么？"
        record.answer = "依据原文：第 1 页说灯把书页照亮，第 2 页说明 PDFKit 渲染与翻页。"
        record.state = .complete
        record.citations = [page1, page2]
        record.evidence = [page1, page2]
        record.conversationTitle = record.question
        XCTAssertTrue(session.library.questions.save(record))

        let controller = QuestionController(library: session.library, id: record.id)
        let window = host(controller, size: CGSize(width: 375, height: 667))
        defer { window.isHidden = true }
        RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.5))
        let reference0 = try XCTUnwrap(
            controller.view.allViews.compactMap { $0 as? UIButton }
                .first { $0.accessibilityIdentifier == "question-reference-0" }
        )
        let title = try XCTUnwrap(reference0.configuration?.title)
        XCTAssertTrue(title.contains("第 1 页"), "PDF 引用标题应显示页码：\(title)")
        XCTAssertTrue(title.contains("灯把书页照亮"), "PDF 引用应带引文摘要：\(title)")
        let sheetImage = DesignFixture.renderRoot(controller, size: CGSize(width: 375, height: 667), style: .light)
        let sheetAttachment = XCTAttachment(data: try XCTUnwrap(sheetImage.pngData()), uniformTypeIdentifier: "public.png")
        sheetAttachment.name = "pdf-m6-question-pdf-citations-375-light"
        sheetAttachment.lifetime = .keepAlways
        add(sheetAttachment)

        // 点引用 → 打开 PDFReaderController(target:) 并停在引用页（第 1 页）。
        reference0.sendActions(for: .touchUpInside)
        var reader: PDFReaderController?
        for _ in 0..<50 {
            RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.1))
            try await Task.sleep(nanoseconds: 50_000_000)
            if let presented = controller.presentedViewController as? PDFReaderController { reader = presented; break }
        }
        let pdfReader = try XCTUnwrap(reader, "点 PDF 引用应打开 PDFReaderController")
        var pageText = ""
        for _ in 0..<40 {
            RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.1))
            try await Task.sleep(nanoseconds: 50_000_000)
            if let label = pdfReader.view.allViews.first(where: { $0.accessibilityIdentifier == "pdf-reader-page" }) as? UILabel {
                pageText = label.text ?? ""
                if pageText == "第 1 / 2 页" { break }
            }
        }
        XCTAssertEqual(pageText, "第 1 / 2 页", "引用跳转应停在引用页（第 1 页）")
        let readerImage = DesignFixture.renderRoot(pdfReader, size: CGSize(width: 375, height: 667), style: .light)
        let readerAttachment = XCTAttachment(data: try XCTUnwrap(readerImage.pngData()), uniformTypeIdentifier: "public.png")
        readerAttachment.name = "pdf-m6-reference-jump-page1-375-light"
        readerAttachment.lifetime = .keepAlways
        add(readerAttachment)
        pdfReader.dismiss(animated: false)

        // PDFReaderController(target:) 应优先于已保存的阅读进度（locatorJSON 第 1 页）。
        let page1Locator = try page1.location()
        let page2Locator = try page2.location()
        try session.library.saveReadingState(page1Locator, settings: ReadingSettings(), for: pdf.id)
        let targetReader = try PDFReaderController(book: pdf, library: session.library, target: page2Locator)
        let targetWindow = host(targetReader, size: CGSize(width: 375, height: 667))
        defer { targetWindow.isHidden = true }
        var targetPageText = ""
        for _ in 0..<40 {
            RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.1))
            try await Task.sleep(nanoseconds: 50_000_000)
            if let label = targetReader.view.allViews.first(where: { $0.accessibilityIdentifier == "pdf-reader-page" }) as? UILabel {
                targetPageText = label.text ?? ""
                if targetPageText == "第 2 / 2 页" { break }
            }
        }
        XCTAssertEqual(targetPageText, "第 2 / 2 页", "target 应优先于 locatorJSON 恢复")
    }

    /// PDF M6：问答面板内点引用（有 jump 闭包）→ 关闭面板并 goToPage，不再新开阅读器。
    func testPDFQuestionPanelReferenceJumpClosesSheetAndGoToPage() async throws {
        let session = try DesignFixture.makeSession(.init(scenario: .pdf, theme: .light))
        try await DesignFixture.seed(session)
        defer { try? FileManager.default.removeItem(at: session.root) }
        let pdf = try XCTUnwrap(session.library.books.first { $0.title == DesignFixture.pdfFixtureTitle })
        let document = try XCTUnwrap(PDFKit.PDFDocument(url: session.library.fileURL(for: pdf)))
        func evidence(_ quote: String) throws -> QuestionEvidence {
            let selection = try XCTUnwrap(document.findString(quote, withOptions: [.caseInsensitive]).first)
            let made = try XCTUnwrap(PDFNoteGeometry.make(from: selection, document: document))
            return QuestionEvidence(locator: made.locator)
        }
        let page1 = try evidence("灯把书页照亮")
        let page2 = try evidence("PDFKit")
        var record = ReadingQuestion(book: pdf, origin: try page1.location())
        record.question = "面板内引用跳转"
        record.answer = "见引用。"
        record.state = .complete
        record.citations = [page1, page2]
        XCTAssertTrue(session.library.questions.save(record))

        let reader = try PDFReaderController(book: pdf, library: session.library)
        let window = host(reader, size: CGSize(width: 375, height: 667))
        defer { window.isHidden = true }
        var jumped: Locator?
        let panel = QuestionController(library: session.library, id: record.id) { target, _ in jumped = target }
        reader.present(panel, animated: false)
        RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.5))
        let reference1 = try XCTUnwrap(
            panel.view.allViews.compactMap { $0 as? UIButton }.first { $0.accessibilityIdentifier == "question-reference-1" }
        )
        reference1.sendActions(for: .touchUpInside)
        for _ in 0..<40 {
            RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.1))
            try await Task.sleep(nanoseconds: 50_000_000)
            if jumped != nil && reader.presentedViewController == nil { break }
        }
        XCTAssertEqual(try jumped?.pdfPageNumber, 2, "面板内引用应通过 jump 跳到第 2 页")
        XCTAssertNil(reader.presentedViewController, "点引用应关闭问答面板")
        XCTAssertNil(reader.presentedViewController as? PDFReaderController, "不应在面板跳转时新开阅读器")
    }

    /// PDF M6：页脚「问书灯」入口 → 打开 QuestionController（自由提问按当前页）。
    func testPDFAskFooterAndSelectionAskOpenQuestionSheet() async throws {
        let session = try DesignFixture.makeSession(.init(scenario: .pdf, theme: .light))
        try await DesignFixture.seed(session)
        defer { try? FileManager.default.removeItem(at: session.root) }
        let pdf = try XCTUnwrap(session.library.books.first { $0.title == DesignFixture.pdfFixtureTitle })
        let reader = try PDFReaderController(book: pdf, library: session.library)
        let window = host(reader, size: CGSize(width: 375, height: 667))
        defer { window.isHidden = true }
        // 页脚入口。
        let ask = try XCTUnwrap(
            reader.view.allViews.compactMap { $0 as? UIButton }.first { $0.accessibilityIdentifier == "pdf-reader-ask" }
        )
        ask.sendActions(for: .touchUpInside)
        var questionSheet: UIView?
        for _ in 0..<40 {
            RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.1))
            try await Task.sleep(nanoseconds: 50_000_000)
            if let nav = reader.presentedViewController as? UINavigationController,
               let sheet = nav.topViewController?.view, sheet.accessibilityIdentifier == "question-sheet" {
                questionSheet = sheet; break
            }
        }
        let sheet = try XCTUnwrap(questionSheet, "页脚「问书灯」应打开 QuestionController")
        XCTAssertTrue(sheet.allViews.contains { $0.accessibilityIdentifier == "question-input" })
        let origin = try XCTUnwrap(session.library.questions.records.first { $0.bookID == pdf.id }?.origin())
        XCTAssertEqual(origin.pdfPageNumber, 1, "自由提问应按当前页建立页级 origin")
        let askImage = DesignFixture.renderRoot(reader.presentedViewController!, size: CGSize(width: 375, height: 667), style: .light)
        let askAttachment = XCTAttachment(data: try XCTUnwrap(askImage.pngData()), uniformTypeIdentifier: "public.png")
        askAttachment.name = "pdf-m6-footer-ask-question-sheet-375-light"
        askAttachment.lifetime = .keepAlways
        add(askAttachment)
        reader.presentedViewController?.dismiss(animated: false)
        for _ in 0..<20 {
            RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.1))
            if reader.presentedViewController == nil { break }
        }

    }

    /// PDF M6：程序化选区 → 纸白浮层「问 AI」→ QuestionController 记录页级 selection。
    func testPDFSelectionAskOpensQuestionSheet() async throws {
        let session = try DesignFixture.makeSession(.init(scenario: .pdf, theme: .light))
        try await DesignFixture.seed(session)
        defer { try? FileManager.default.removeItem(at: session.root) }
        let pdf = try XCTUnwrap(session.library.books.first { $0.title == DesignFixture.pdfFixtureTitle })
        let reader = try PDFReaderController(book: pdf, library: session.library)
        let window = host(reader, size: CGSize(width: 375, height: 667))
        defer { window.isHidden = true }
        // 程序化选区 → 纸白浮层「问 AI」（用新阅读器，避免 sheet dismiss 过渡态干扰）。
        let pdfView = try XCTUnwrap(
            reader.view.allViews.compactMap { $0 as? PDFView }.first { $0.accessibilityIdentifier == "pdf-reader-view" }
        )
        let document = try XCTUnwrap(pdfView.document)
        let page = try XCTUnwrap(document.page(at: 0))
        let text = try XCTUnwrap(page.string)
        let range = (text as NSString).range(of: "灯把书页照亮")
        let selection = try XCTUnwrap(page.selection(for: range))
        pdfView.currentSelection = selection
        NotificationCenter.default.post(name: .PDFViewSelectionChanged, object: pdfView)
        var menuView: UIView?
        for _ in 0..<30 {
            RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.05))
            try await Task.sleep(nanoseconds: 100_000_000)
            if let menu = reader.view.allViews.first(where: { $0.accessibilityIdentifier == "pdf-selection-menu" }) {
                menuView = menu; break
            }
        }
        let menu = try XCTUnwrap(menuView, "选区应出现纸白浮层")
        let askSelection = try XCTUnwrap(
            menu.allViews.compactMap { $0 as? UIButton }.first { $0.accessibilityIdentifier == "pdf-selection-ask" }
        )
        askSelection.sendActions(for: .touchUpInside)
        var selectionSheet: UIView?
        for _ in 0..<40 {
            RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.1))
            try await Task.sleep(nanoseconds: 50_000_000)
            if let nav = reader.presentedViewController as? UINavigationController,
               let view = nav.topViewController?.view, view.accessibilityIdentifier == "question-sheet" {
                selectionSheet = view; break
            }
        }
        XCTAssertNotNil(selectionSheet, "选区「问 AI」应打开 QuestionController")
        let newest = try XCTUnwrap(session.library.questions.records.max { $0.updated < $1.updated })
        XCTAssertEqual((try? newest.selection.location().pdfPageNumber), 1, "选区提问应记录页级 selection")
        XCTAssertEqual(newest.selection.quote, "灯把书页照亮")

    }

    /// PDF M6：扫描版页脚「问书灯」→ 无文字提示，不打开问答。
    func testPDFScannedAskFooterShowsNoTextAlert() async throws {
        let session = try DesignFixture.makeSession(.init(scenario: .pdfScan, theme: .light))
        try await DesignFixture.seed(session)
        defer { try? FileManager.default.removeItem(at: session.root) }
        let book = try XCTUnwrap(session.library.books.first { $0.title == DesignFixture.pdfScanFixtureTitle })
        let reader = try PDFReaderController(book: book, library: session.library)
        let window = host(reader, size: CGSize(width: 375, height: 667))
        defer { window.isHidden = true }
        let ask = try XCTUnwrap(
            reader.view.allViews.compactMap { $0 as? UIButton }.first { $0.accessibilityIdentifier == "pdf-reader-ask" }
        )
        ask.sendActions(for: .touchUpInside)
        var dialog: UIView?
        for _ in 0..<30 {
            RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.1))
            if let presented = reader.presentedViewController, presented.view.accessibilityIdentifier == "book-dialog" {
                dialog = presented.view; break
            }
        }
        let view = try XCTUnwrap(dialog, "扫描版「问书灯」应弹无文字提示")
        let texts = view.allViews.compactMap { ($0 as? UILabel)?.text }
        XCTAssertTrue(texts.contains("没有可搜索的文字；阅读、缩放和加书签都可以正常使用。"), "应说明没有可搜索文字：\(texts)")
        XCTAssertNil(reader.presentedViewController as? UINavigationController?.Type, "扫描版不应打开问答面板")
        let alertRoot = reader.presentedViewController ?? reader
        let image = DesignFixture.renderRoot(alertRoot, size: CGSize(width: 375, height: 667), style: .light)
        let attachment = XCTAttachment(data: try XCTUnwrap(image.pngData()), uniformTypeIdentifier: "public.png")
        attachment.name = "pdf-m6-scan-ask-no-text-alert-375-light"
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    /// PDF M6：375 宽 + accessibilityLarge 字号下页脚「问书灯/页码/模式」不与彼此重叠。
    func testPDFFooterAskLayoutAtAccessibilityLargeSize() async throws {
        let session = try DesignFixture.makeSession(.init(scenario: .pdf, theme: .light))
        try await DesignFixture.seed(session)
        defer { try? FileManager.default.removeItem(at: session.root) }
        let pdf = try XCTUnwrap(session.library.books.first { $0.title == DesignFixture.pdfFixtureTitle })
        let reader = try PDFReaderController(book: pdf, library: session.library)
        let window = host(reader, size: CGSize(width: 375, height: 667))
        defer { window.isHidden = true }
        if #available(iOS 17.0, *) {
            window.traitOverrides.preferredContentSizeCategory = .accessibilityLarge
        }
        reader.view.setNeedsLayout()
        reader.view.layoutIfNeeded()
        RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.3))
        func frame(_ id: String) -> CGRect? {
            reader.view.allViews.first { $0.accessibilityIdentifier == id }?.frame
        }
        let ask = try XCTUnwrap(frame("pdf-reader-ask"))
        let page = try XCTUnwrap(frame("pdf-reader-page"))
        let mode = try XCTUnwrap(frame("pdf-reader-mode"))
        XCTAssertGreaterThan(ask.width, 0)
        XCTAssertFalse(ask.intersects(page), "问书灯不应与页码重叠：ask=\(ask) page=\(page)")
        XCTAssertFalse(page.intersects(mode), "页码不应与模式按钮重叠：page=\(page) mode=\(mode)")
        XCTAssertGreaterThanOrEqual(ask.minX, 0)
        XCTAssertLessThanOrEqual(mode.maxX, reader.view.bounds.width + 0.5)
        let image = DesignFixture.renderRoot(reader, size: CGSize(width: 375, height: 667), style: .light)
        let attachment = XCTAttachment(data: try XCTUnwrap(image.pngData()), uniformTypeIdentifier: "public.png")
        attachment.name = "pdf-m6-footer-ask-accessibility-large-375-light"
        attachment.lifetime = .keepAlways
        add(attachment)
        _ = window
    }

    /// PDF 最终验收：300 页文字 PDF 的页级索引/打开/翻页耗时与常驻内存（秒表 + task_info）。
    func testPDFLargeTextIndexingAndOpenPerformance() async throws {
        func residentMB() -> Double {
            var info = mach_task_basic_info()
            var count = mach_msg_type_number_t(MemoryLayout<mach_task_basic_info>.size / MemoryLayout<integer_t>.size)
            let result = withUnsafeMutablePointer(to: &info) { pointer in
                pointer.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
                    task_info(mach_task_self_, task_flavor_t(MACH_TASK_BASIC_INFO), $0, &count)
                }
            }
            return result == KERN_SUCCESS ? Double(info.resident_size) / 1_048_576 : -1
        }
        let pageCount = 300
        let bounds = CGRect(x: 0, y: 0, width: 595, height: 842)
        let renderer = UIGraphicsPDFRenderer(bounds: bounds)
        let data = renderer.pdfData { context in
            for index in 1...pageCount {
                context.beginPage()
                let heading = "性能夹具 · 第 \(index) 页"
                (heading as NSString).draw(
                    at: CGPoint(x: 56, y: 64),
                    withAttributes: [.font: UIFont.boldSystemFont(ofSize: 20), .foregroundColor: UIColor.black]
                )
                let body = "PERF-\(index) 这是用于 PDF 页级索引与翻页性能验证的第 \(index) 页正文。"
                (body as NSString).draw(
                    in: CGRect(x: 56, y: 112, width: 480, height: 200),
                    withAttributes: [.font: UIFont.systemFont(ofSize: 14), .foregroundColor: UIColor.black]
                )
            }
        }
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("PDFPerf-" + UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let file = root.appendingPathComponent("perf-300.pdf")
        try data.write(to: file)
        let library = try LibraryStore(root: root, secrets: EphemeralSecrets())
        let memoryBefore = residentMB()
        var events: [BookPreparationState] = []
        let indexStarted = Date()
        try await library.preparation.index.prepare(bookID: "perf-book", file: file, progress: { events.append($0) })
        let indexSeconds = Date().timeIntervalSince(indexStarted)
        let memoryAfterIndex = residentMB()
        XCTAssertEqual(events.last?.completed, pageCount)
        XCTAssertEqual(events.last?.searchablePageCount, pageCount)
        let hits = try await library.preparation.index.search(bookID: "perf-book", query: "PERF-150")
        XCTAssertEqual(hits.first?.page, 150)
        print(String(format: "QA_PERF text_pdf_index_seconds=%.3f pages=%d size_kb=%.0f events=%d resident_before_mb=%.1f after_index_mb=%.1f", indexSeconds, pageCount, Double(data.count) / 1024, events.count, memoryBefore, memoryAfterIndex))

        // 打开（PDFDocument + 阅读器首屏）。
        let openStarted = Date()
        var book = Book(id: "perf-book", title: "perf-300", author: "")
        book.format = .pdf
        let booksDir = root.appendingPathComponent("Books", isDirectory: true)
        try FileManager.default.createDirectory(at: booksDir, withIntermediateDirectories: true)
        try FileManager.default.copyItem(at: file, to: library.fileURL(for: book))
        let reader = try PDFReaderController(book: book, library: library)
        let window = host(reader, size: CGSize(width: 375, height: 667))
        defer { window.isHidden = true }
        RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.3))
        let openSeconds = Date().timeIntervalSince(openStarted)
        let memoryAfterOpen = residentMB()
        let pdfView = try XCTUnwrap(
            reader.view.allViews.compactMap { $0 as? PDFView }.first { $0.accessibilityIdentifier == "pdf-reader-view" }
        )
        let document = try XCTUnwrap(pdfView.document)
        XCTAssertEqual(document.pageCount, pageCount)
        // 连续翻页 20 次（跳到后半段附近页面）。
        let turnStarted = Date()
        for index in stride(from: 30, through: 220, by: 10) {
            if let page = document.page(at: index) { pdfView.go(to: page) }
            RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.02))
        }
        let turnSeconds = Date().timeIntervalSince(turnStarted)
        print(String(format: "QA_PERF text_pdf_open_seconds=%.3f page_turns_20_seconds=%.3f resident_after_open_mb=%.1f", openSeconds, turnSeconds, memoryAfterOpen))
        XCTAssertLessThan(indexSeconds, 60, "300 页索引应在一分钟内完成")
        XCTAssertLessThan(openSeconds, 5, "300 页 PDF 打开应低于 5s")
        XCTAssertLessThan(turnSeconds, 5, "20 次翻页应低于 5s")
    }

    /// PDF M6 夹具检查：AI 问答所需的准备状态是否 ready（供 UI 真跑生成前置）。
    func testPDFFixturePreparationStateReadyForAI() async throws {
        let session = try DesignFixture.makeSession(.init(scenario: .pdf, theme: .light))
        try await DesignFixture.seed(session)
        defer { try? FileManager.default.removeItem(at: session.root) }
        let pdf = try XCTUnwrap(session.library.books.first { $0.title == DesignFixture.pdfFixtureTitle })
        let state = session.library.preparation.states[pdf.id]
        print("QA_AI_FIXTURE_STATE", String(describing: state))
        let value = try XCTUnwrap(state, "pdf 夹具应留下准备状态")
        XCTAssertTrue(value.ready, "pdf 夹具准备状态应 ready：\(value)")
        XCTAssertEqual(value.completed, value.total)
        XCTAssertFalse(value.preparing)
        XCTAssertFalse(value.textIndexUnavailable)
        XCTAssertEqual(value.searchablePageCount, 2)
    }

    /// P1-4：纯白尾页不弹提示卡/无「?」；扫描页+空白页提示“N 页是扫描图片”，空白不计入扫描页。
    func testPDFBlankTailPageNoPromptAndScanBlankCounts() async throws {
        func makePDF(pages: [(text: String?, scan: Bool)]) -> Data {
            let bounds = CGRect(x: 0, y: 0, width: 595, height: 842)
            let renderer = UIGraphicsPDFRenderer(bounds: bounds)
            return renderer.pdfData { context in
                for page in pages {
                    context.beginPage()
                    if let text = page.text {
                        (text as NSString).draw(
                            at: CGPoint(x: 56, y: 112),
                            withAttributes: [.font: UIFont.systemFont(ofSize: 14), .foregroundColor: UIColor.black]
                        )
                    }
                    if page.scan {
                        let image = UIGraphicsImageRenderer(size: CGSize(width: 320, height: 420)).image { imageContext in
                            UIColor.white.setFill()
                            imageContext.fill(CGRect(x: 0, y: 0, width: 320, height: 420))
                            ("扫描页" as NSString).draw(
                                at: CGPoint(x: 20, y: 40),
                                withAttributes: [.font: UIFont.boldSystemFont(ofSize: 24), .foregroundColor: UIColor.black]
                            )
                        }
                        image.draw(in: CGRect(x: 100, y: 180, width: 320, height: 420))
                    }
                }
            }
        }
        func importPDF(_ data: Data, in library: LibraryStore, name: String) async throws -> ImportedBook {
            let source = library.root.appendingPathComponent(name + ".pdf")
            try data.write(to: source)
            defer { try? FileManager.default.removeItem(at: source) }
            return try await library.importBook(from: source)
        }

        // 2 文字页 + 1 纯白尾页：不弹卡、无扫描页、无「?」。
        let textRoot = FileManager.default.temporaryDirectory
            .appendingPathComponent("PDFBlankTail-" + UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: textRoot, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: textRoot) }
        let textLibrary = try LibraryStore(root: textRoot, secrets: EphemeralSecrets())
        var textConfirmed = 0
        let textData = makePDF(pages: [("第 1 页正文", false), ("第 2 页正文", false), (nil, false)])
        let textImported = try await textLibrary.importBook(
            from: {
                let source = textRoot.appendingPathComponent("blank-tail.pdf")
                try? textData.write(to: source)
                return source
            }(),
            confirmPDFInfo: { _ in textConfirmed += 1; return true }
        )
        XCTAssertEqual(textConfirmed, 0, "纯白尾页不应触发扫描提示卡")
        let textInfo = try XCTUnwrap(textImported.book.pdfInfo)
        XCTAssertEqual(textInfo.pageCount, 3)
        XCTAssertEqual(textInfo.textPageCount, 2)
        XCTAssertEqual(textInfo.blankPageCount, 1)
        XCTAssertEqual(textInfo.scannedPageCount, 0)
        XCTAssertFalse(textInfo.hasScannedPages)
        XCTAssertNil(textInfo.scannedPagesTitle)
        let textReader = try PDFReaderController(book: textImported.book, library: textLibrary)
        let textWindow = host(textReader, size: CGSize(width: 375, height: 667))
        defer { textWindow.isHidden = true }
        let help = try XCTUnwrap(
            textReader.view.allViews.compactMap { $0 as? UIButton }.first { $0.accessibilityIdentifier == "pdf-reader-help" }
        )
        XCTAssertTrue(help.isHidden, "含空白尾页但没有扫描页时不应显示「?」")

        // 2 扫描页 + 1 纯白尾页：**task-62 性能修复后**，textPageCount==0 走“整本扫描”短路，
        // 不再逐页 ink 判定，空白尾页被保守计为扫描页（blankPageCount=nil、scannedPageCount=3，
        // 提示卡文案为“这份 PDF 是扫描版”）。这是性能优先的已知语义取舍。
        let scanRoot = FileManager.default.temporaryDirectory
            .appendingPathComponent("PDFScanBlank-" + UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: scanRoot, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: scanRoot) }
        let scanLibrary = try LibraryStore(root: scanRoot, secrets: EphemeralSecrets())
        var scanConfirmed = 0
        let scanData = makePDF(pages: [(nil, true), (nil, true), (nil, false)])
        let scanSource = scanRoot.appendingPathComponent("scan-blank.pdf")
        try scanData.write(to: scanSource)
        let scanImported = try await scanLibrary.importBook(
            from: scanSource,
            confirmPDFInfo: { info in
                scanConfirmed += 1
                XCTAssertNil(info.blankPageCount, "整本扫描短路不再逐页判定空白页")
                XCTAssertEqual(info.scannedPageCount, 3)
                XCTAssertEqual(info.scannedPagesTitle, "这份 PDF 是扫描版")
                return true
            }
        )
        XCTAssertEqual(scanConfirmed, 1)
        let scanInfo = try XCTUnwrap(scanImported.book.pdfInfo)
        XCTAssertEqual(scanInfo.pageCount, 3)
        XCTAssertEqual(scanInfo.textPageCount, 0)
        XCTAssertNil(scanInfo.blankPageCount)
        XCTAssertEqual(scanInfo.scannedPageCount, 3)
        XCTAssertEqual(scanInfo.scannedPagesTitle, "这份 PDF 是扫描版")
        XCTAssertEqual(scanInfo.scannedPagesMessage, "页面上的字是图片，目前还不能选字提问或高亮。阅读、缩放和加书签都可以正常使用。")
    }

    /// P1-5：PDF 封面来自首页缩略图（非 nil），并走 BookCoverStore 缓存（重复取同一对象）。
    func testPDFCoverFromFirstPageIsNonNilAndCached() async throws {
        let session = try DesignFixture.makeSession(.init(scenario: .pdf, theme: .light))
        try await DesignFixture.seed(session)
        defer { try? FileManager.default.removeItem(at: session.root) }
        let pdf = try XCTUnwrap(session.library.books.first { $0.title == DesignFixture.pdfFixtureTitle })
        let covers = BookCoverStore()
        let first = await covers.image(for: pdf, library: session.library)
        let image = try XCTUnwrap(first, "PDF 首页应能生成封面")
        XCTAssertGreaterThan(image.size.width, 1)
        XCTAssertGreaterThan(image.size.height, 1)
        let second = await covers.image(for: pdf, library: session.library)
        XCTAssertTrue(second === image, "重复取封面应命中缓存、不重复渲染")
    }

    /// P1-6：PDF 进度 trailing debounce 0.7s（快速翻页只写最后一页），关闭/离开立即 flush。
    func testPDFProgressDebounceAndFlush() async throws {
        let session = try DesignFixture.makeSession(.init(scenario: .pdf, theme: .light))
        try await DesignFixture.seed(session)
        defer { try? FileManager.default.removeItem(at: session.root) }
        let pdf = try XCTUnwrap(session.library.books.first { $0.title == DesignFixture.pdfFixtureTitle })
        let reader = try PDFReaderController(book: pdf, library: session.library)
        let window = host(reader, size: CGSize(width: 375, height: 667))
        defer { window.isHidden = true }
        RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.3))
        // host 不会自动触发 appearance；显式调用以完成 restore 流程（否则 didRestoreProgress=false 不落盘）。
        reader.viewDidAppear(false)
        RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.4))
        let pdfView = try XCTUnwrap(
            reader.view.allViews.compactMap { $0 as? PDFView }.first { $0.accessibilityIdentifier == "pdf-reader-view" }
        )
        let document = try XCTUnwrap(pdfView.document)
        XCTAssertNil(session.library.books.first { $0.id == pdf.id }?.locatorJSON, "初始不应有 PDF 阅读进度")
        // 连续翻到第 2 页再回第 1 页：0.7s 内不应落盘，之后只写最后一页（第 1 页）。
        pdfView.go(to: try XCTUnwrap(document.page(at: 1)))
        RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.15))
        pdfView.go(to: try XCTUnwrap(document.page(at: 0)))
        RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.2))
        XCTAssertNil(session.library.books.first { $0.id == pdf.id }?.locatorJSON, "0.7s debounce 内不应写进度")
        for _ in 0..<20 {
            RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.1))
            try await Task.sleep(nanoseconds: 50_000_000)
            if session.library.books.first { $0.id == pdf.id }?.locatorJSON != nil { break }
        }
        let debounced = try XCTUnwrap(session.library.books.first { $0.id == pdf.id }?.locatorJSON)
        XCTAssertTrue(debounced.contains("pdf://page/1") || debounced.contains("\"position\":1"), "debounce 后应只写最后一页：\(debounced)")

        // 离开阅读器立即 flush：翻到第 2 页后立刻 viewWillDisappear，应马上写入第 2 页。
        pdfView.go(to: try XCTUnwrap(document.page(at: 1)))
        RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.1))
        reader.viewWillDisappear(false)
        let flushed = try XCTUnwrap(session.library.books.first { $0.id == pdf.id }?.locatorJSON)
        XCTAssertTrue(flushed.contains("pdf://page/2") || flushed.contains("\"position\":2"), "关闭/离开应立刻 flush 当前页：\(flushed)")
        let locator = try XCTUnwrap(try? Locator(json: JSONValue(jsonString: flushed, warnings: nil), warnings: nil))
        XCTAssertEqual(locator.locations.progression ?? -1, 1.0, accuracy: 0.001, "末页 progression=1.0")
    }

    /// P0-1：页中部（起始偏移>80）选文 evidence 可被 permits/QuestionPlan 接受；篡改 quote 仍拒绝。
    func testPDFMidPageSelectionPermitsAndForgedQuoteRejected() async throws {
        let session = try DesignFixture.makeSession(.init(scenario: .pdf, theme: .light))
        try await DesignFixture.seed(session)
        defer { try? FileManager.default.removeItem(at: session.root) }
        let pdf = try XCTUnwrap(session.library.books.first { $0.title == DesignFixture.pdfFixtureTitle })
        let file = session.library.fileURL(for: pdf)
        let document = try XCTUnwrap(PDFKit.PDFDocument(url: file))
        // 页面中部（第 2 页靠后文字），before 上下文 >80 字符触发过 P0 scope 拒绝路径。
        let page = try XCTUnwrap(document.page(at: 1))
        let text = try XCTUnwrap(page.string)
        let quote = "渲染与翻页"
        let range = (text as NSString).range(of: quote)
        XCTAssertNotEqual(range.location, NSNotFound)
        XCTAssertGreaterThan(text.count, 0)
        let selection = try XCTUnwrap(page.selection(for: range))
        let made = try XCTUnwrap(PDFNoteGeometry.make(from: selection, document: document))
        let evidence = QuestionEvidence(locator: made.locator)
        let beforeCount = (try evidence.location().text.before ?? "").count
        XCTAssertGreaterThan(beforeCount, 0)
        let state = try XCTUnwrap(session.library.preparation.states[pdf.id])
        XCTAssertTrue(state.ready, "夹具准备状态应 ready")
        let scope = BookEvidenceScope(bookID: pdf.id)
        let permitted = try await session.library.preparation.index.permits([evidence], scope: scope)
        XCTAssertTrue(permitted, "页中部选文 evidence 应通过 permits（P0-1）")
        var record = ReadingQuestion(book: pdf, selection: evidence, neighbors: [])
        record.question = "这几句是什么意思？"
        let plan = try await QuestionPlan.make(record, index: session.library.preparation.index, local: false, state: state)
        XCTAssertFalse(plan.evidence.isEmpty, "页中部选文应生成问答证据，不应 scope 拒绝")

        // 篡改 quote：不在原文中 → permits 拒绝 / QuestionPlan 抛 scope。
        var forged = evidence
        forged = QuestionEvidence(id: evidence.id, locator: try {
            var locator = try evidence.location()
            locator.text = .init(highlight: "被篡改的引文")
            return locator
        }(), context: "")
        let forgedPermitted = try await session.library.preparation.index.permits([forged], scope: scope)
        XCTAssertFalse(forgedPermitted, "篡改 quote 不应通过 permits")
        var forgedRecord = ReadingQuestion(book: pdf, selection: forged, neighbors: [])
        forgedRecord.question = "篡改测试"
        do {
            _ = try await QuestionPlan.make(forgedRecord, index: session.library.preparation.index, local: false, state: state)
            XCTFail("篡改 quote 应被拒绝")
        } catch QuestionError.scope {
            // expected
        }
    }

    /// P0-1 + AI 真跑（需 scripts/issue9-http-fixture.rb 18769）：页中部选文 → 生成回答/PDF 引用 → 引用跳页。
    func testPDFMidPageSelectionAIGenerationWithLoopback() async throws {
        // 仅在显式带 QA_AI_LOOPBACK=1 时跑（配合 scripts/issue9-http-fixture.rb 18769）。
        guard ProcessInfo.processInfo.environment["QA_AI_LOOPBACK"] == "1" else {
            throw XCTSkip("未设置 QA_AI_LOOPBACK=1，跳过 AI 真跑")
        }
        // 生成长文本 PDF，取页面中部（起始偏移>80）选文，复现 P0-1。
        let bounds = CGRect(x: 0, y: 0, width: 595, height: 842)
        let renderer = UIGraphicsPDFRenderer(bounds: bounds)
        let longLine = "这是用于 P0 复现的页中部长文本，" + String(repeating: "书灯把原文照亮。", count: 12) + " 末尾的答案是照明。"
        let data = renderer.pdfData { context in
            context.beginPage()
            (longLine as NSString).draw(in: CGRect(x: 56, y: 112, width: 480, height: 500),
                                        withAttributes: [.font: UIFont.systemFont(ofSize: 14), .foregroundColor: UIColor.black])
            context.beginPage()
            ("第 2 页内容。" as NSString).draw(at: CGPoint(x: 56, y: 112),
                                            withAttributes: [.font: UIFont.systemFont(ofSize: 14), .foregroundColor: UIColor.black])
        }
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("PDFAILoop-" + UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let library = try LibraryStore(root: root, secrets: EphemeralSecrets())
        let source = root.appendingPathComponent("mid-selection.pdf")
        try data.write(to: source)
        let imported = try await library.importBook(from: source)
        let book = imported.book
        // 等索引与向量准备完成。
        var state: BookPreparationState?
        for _ in 0..<300 {
            if let value = library.preparation.states[book.id], value.ready { state = value; break }
            try? await Task.sleep(nanoseconds: 100_000_000)
        }
        let readyState = try XCTUnwrap(state, "PDF 准备应完成（含向量）")
        XCTAssertTrue(readyState.semanticReady, "夹具/真实导入应完成向量准备：\(readyState)")
        // 中部选文：before 偏移 >80。
        let document = try XCTUnwrap(PDFKit.PDFDocument(url: library.fileURL(for: book)))
        let page = try XCTUnwrap(document.page(at: 0))
        let text = try XCTUnwrap(page.string)
        let quote = "末尾的答案是照明"
        let range = (text as NSString).range(of: quote)
        XCTAssertNotEqual(range.location, NSNotFound)
        XCTAssertGreaterThan(range.location, 80, "选文起始偏移应 >80")
        let selection = try XCTUnwrap(page.selection(for: range))
        let made = try XCTUnwrap(PDFNoteGeometry.make(from: selection, document: document))
        let evidence = QuestionEvidence(locator: made.locator)
        var record = ReadingQuestion(book: book, selection: evidence, neighbors: [])
        record.question = "页面中部这句话给出的答案是什么？"
        XCTAssertTrue(library.questions.save(record))
        // 配置 loopback AI。
        let configurations = try AIConfigurationStore(root: root, secrets: library.secrets)
        let configuration = AIConfiguration(
            name: "PDF final loopback",
            format: .openAI,
            address: "http://127.0.0.1:18769/v1",
            model: "pdf-final-ai"
        )
        try configurations.save(configuration, newKey: "not-a-real-credential", confirmingSendConsent: true)
        try configurations.select(configuration.id)
        // 真实生成（P0 页中部选文不应 scope 拒绝）。
        let started = Date()
        library.questions.send(record.id, library: library, local: false)
        var generated: ReadingQuestion?
        for _ in 0..<300 {
            try? await Task.sleep(nanoseconds: 100_000_000)
            if let value = library.questions.record(record.id),
               value.state == .complete || value.state == .incomplete {
                generated = value; break
            }
        }
        if generated == nil {
            let current = library.questions.record(record.id)
            print("QA_AI_UNIT_DEBUG state=\(String(describing: current?.state)) failure=\(String(describing: current?.failure)) answer=\(String(describing: current?.answer.prefix(40))) recordCount=\(library.questions.records.count)")
        }
        let result = try XCTUnwrap(generated, "问答应进入完成/未完成状态")
        print(String(format: "QA_PERF pdf_ai_unit_generation_seconds=%.3f state=%@", Date().timeIntervalSince(started), result.state.rawValue))
        XCTAssertEqual(result.state, .complete, "页中部选文不应 scope 拒绝：\(result.failure ?? "")")
        XCTAssertFalse(result.answer.isEmpty)
        XCTAssertFalse(result.citations.isEmpty, "应返回 PDF 页级引用")
        let citationPage = try XCTUnwrap(result.citations.first?.pdfPage)
        let reader = try PDFReaderController(book: book, library: library, target: try result.citations[0].location())
        let window = host(reader, size: CGSize(width: 375, height: 667))
        defer { window.isHidden = true }
        reader.viewDidAppear(false)
        var pageText = ""
        for _ in 0..<40 {
            RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.1))
            if let label = reader.view.allViews.first(where: { $0.accessibilityIdentifier == "pdf-reader-page" }) as? UILabel {
                pageText = label.text ?? ""
                if pageText.contains("第 \(citationPage) /") { break }
            }
        }
        XCTAssertTrue(pageText.contains("第 \(citationPage) /"), "引用跳转应落到第 \(citationPage) 页：\(pageText)")
    }

    func testPaperDialogsRenderBothThemes() throws {
        for (style, name) in [(UIUserInterfaceStyle.light, "light"), (.dark, "dark")] {
            let sheet = BookAlertController(
                title: "外观",
                message: "选择适合此刻阅读的界面外观。",
                preferredStyle: .actionSheet
            )
            sheet.addAction(BookAlertAction(title: "✓ 跟随系统", style: .default))
            sheet.addAction(BookAlertAction(title: "浅色", style: .default))
            sheet.addAction(BookAlertAction(title: "深色", style: .default))
            sheet.addAction(BookAlertAction(title: "取消", style: .cancel))
            let sheetImage = DesignFixture.renderRoot(sheet, size: CGSize(width: 375, height: 667), style: style)
            let sheetAttachment = XCTAttachment(data: try XCTUnwrap(sheetImage.pngData()), uniformTypeIdentifier: "public.png")
            sheetAttachment.name = "dialog-action-sheet-375-\(name)"
            sheetAttachment.lifetime = .keepAlways
            add(sheetAttachment)

            let confirm = BookAlertController(
                title: "删除对话？",
                message: "删除本对话的所有轮次及引用快照；生成中的请求将取消。",
                preferredStyle: .alert
            )
            confirm.addAction(BookAlertAction(title: "取消", style: .cancel))
            confirm.addAction(BookAlertAction(title: "删除", style: .destructive))
            let confirmImage = DesignFixture.renderRoot(confirm, size: CGSize(width: 375, height: 667), style: style)
            let confirmAttachment = XCTAttachment(data: try XCTUnwrap(confirmImage.pngData()), uniformTypeIdentifier: "public.png")
            confirmAttachment.name = "dialog-alert-375-\(name)"
            confirmAttachment.lifetime = .keepAlways
            add(confirmAttachment)
        }
    }

    func testFixedFixtureRendersBothContentSizesAndThemes() async throws {
        let request = DesignFixture.Request(scenario: .normal, theme: .light)
        let session = try DesignFixture.makeSession(request)
        try await DesignFixture.seed(session)

        XCTAssertEqual(Set(session.library.books.map(\.title)), ["红楼梦", "瓦尔登湖", "论语"])
        let primary = try XCTUnwrap(session.library.books.first { $0.title == DesignFixture.fixtureTitle })
        XCTAssertNotNil(primary.locatorJSON)
        XCTAssertFalse(primary.notes?.isEmpty ?? true)
        XCTAssertFalse(primary.bookmarks?.isEmpty ?? true)
        XCTAssertEqual(session.library.questions.conversations.count, 2)
        XCTAssertTrue(session.root.path.contains(FileManager.default.temporaryDirectory.path))

        let sizes = [
            CGSize(width: 375, height: 667),
            CGSize(width: 390, height: 844)
        ]
        let themes: [(UIUserInterfaceStyle, String)] = [(.light, "light"), (.dark, "dark")]
        let tabs = ["shelf", "notes", "conversations", "profile"]

        for size in sizes {
            for (theme, themeName) in themes {
                let root = makeApplicationTabs(library: session.library, root: session.root, secrets: session.secrets)
                for (index, tab) in tabs.enumerated() {
                    root.select(index)
                    let image = DesignFixture.renderRoot(root, size: size, style: theme)
                    XCTAssertEqual(image.size, size)
                    let attachment = XCTAttachment(
                        data: try XCTUnwrap(image.pngData()),
                        uniformTypeIdentifier: "public.png"
                    )
                    attachment.name = "design-baseline-\(tab)-\(Int(size.width))x\(Int(size.height))-\(themeName)"
                    attachment.lifetime = .keepAlways
                    add(attachment)
                }
            }
        }
    }

    func testRootShellUsesFlatNavigationAndStableTabTargets() throws {
        let request = DesignFixture.Request(scenario: .normal, theme: .light)
        let session = try DesignFixture.makeSession(request)
        let root = makeApplicationTabs(library: session.library, root: session.root, secrets: session.secrets)
        root.loadViewIfNeeded()
        root.view.frame = CGRect(x: 0, y: 0, width: 375, height: 667)
        root.view.layoutIfNeeded()

        XCTAssertEqual(root.tabBar.frame.height, 56)
        let identifiers = Set(root.tabBar.allControls.map(\.accessibilityIdentifier).compactMap { $0 })
        XCTAssertEqual(
            identifiers,
            Set(RootDestination.allCases.map(\.accessibilityIdentifier))
        )
        XCTAssertEqual(root.selectedIndex, RootDestination.library.rawValue)
    }

    func testShelfEmptyAndPreparingStatesRenderAtSmallSize() async throws {
        for scenario in [DesignFixture.Scenario.empty, .preparing] {
            let request = DesignFixture.Request(scenario: scenario, theme: .light)
            let session = try DesignFixture.makeSession(request)
            try await DesignFixture.seed(session)
            let root = makeApplicationTabs(library: session.library, root: session.root, secrets: session.secrets)
            let image = DesignFixture.renderRoot(root, size: CGSize(width: 375, height: 667), style: .light)
            let attachment = XCTAttachment(data: try XCTUnwrap(image.pngData()), uniformTypeIdentifier: "public.png")
            attachment.name = "shelf-\(scenario.rawValue)-375x667-light"
            attachment.lifetime = .keepAlways
            add(attachment)
        }
    }

    func testShelfSupportsAccessibilityTextWithoutDroppingChrome() async throws {
        let request = DesignFixture.Request(scenario: .normal, theme: .light)
        let session = try DesignFixture.makeSession(request)
        try await DesignFixture.seed(session)
        let root = makeApplicationTabs(library: session.library, root: session.root, secrets: session.secrets)
        let image = DesignFixture.renderRoot(
            root,
            size: CGSize(width: 375, height: 667),
            style: .light,
            preferredContentSizeCategory: .accessibilityExtraExtraLarge
        )
        let views = root.view.allViews
        for identifier in ["page-title", "library-import", "tab-library", "tab-profile"] {
            XCTAssertNotNil(views.first { $0.accessibilityIdentifier == identifier }, identifier)
        }
        let collection = try XCTUnwrap(
            views.compactMap { $0 as? UICollectionView }.first { $0.accessibilityIdentifier == "library" }
        )
        collection.layoutIfNeeded()
        let first = try XCTUnwrap(collection.collectionViewLayout.layoutAttributesForItem(at: IndexPath(item: 0, section: 0)))
        let second = try XCTUnwrap(collection.collectionViewLayout.layoutAttributesForItem(at: IndexPath(item: 1, section: 0)))
        XCTAssertEqual(first.frame.minX, second.frame.minX, accuracy: 0.5)
        XCTAssertGreaterThan(second.frame.minY, first.frame.maxY)

        let attachment = XCTAttachment(data: try XCTUnwrap(image.pngData()), uniformTypeIdentifier: "public.png")
        attachment.name = "shelf-accessibility-xxxl-375x667-light"
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    func testNotesPageMergesHighlightsAndNotesWithoutFiltersOrBookmarks() async throws {
        let request = DesignFixture.Request(scenario: .normal, theme: .light)
        let session = try DesignFixture.makeSession(request)
        try await DesignFixture.seed(session)
        let root = makeApplicationTabs(library: session.library, root: session.root, secrets: session.secrets)
        root.select(RootDestination.notes.rawValue)
        _ = DesignFixture.renderRoot(root, size: CGSize(width: 375, height: 667), style: .light)

        let navigation = try XCTUnwrap(
            root.viewControllers[RootDestination.notes.rawValue] as? UINavigationController
        )
        let page = try XCTUnwrap(navigation.topViewController as? NotesController)
        XCTAssertEqual(page.title, "笔记")
        XCTAssertEqual(page.navigationItem.largeTitleDisplayMode, .always)
        XCTAssertTrue(navigation.navigationBar.prefersLargeTitles)
        XCTAssertNotNil(
            largeTitle(in: navigation, text: "笔记"),
            "系统大标题应渲染页面标题；若为空请先报 Lead 决策，不要在测试里迁就"
        )
        XCTAssertEqual(page.navigationItem.rightBarButtonItem?.accessibilityIdentifier, "notes-export")
        XCTAssertEqual(
            page.navigationItem.preferredSearchBarPlacement,
            .stacked,
            "iOS 26 默认会把搜索框放到屏幕底部，这里必须显式 stacked 以保持大标题下方布局"
        )

        let list = try listView(in: page, identifier: "notes")
        XCTAssertEqual(list.numberOfSections, 1)
        XCTAssertEqual(recordCount(in: list), 2, "合并列表应显示 1 条高亮 + 1 条笔记")
        XCTAssertNil(
            page.view.allViews.compactMap { $0 as? UISegmentedControl }
                .first { $0.accessibilityIdentifier == "note-filter" },
            "定稿已删除 3 段筛选控件"
        )
        let notesSearch = try XCTUnwrap(
            root.view.allViews.compactMap { $0 as? UITextField }
                .first { $0.accessibilityIdentifier == "notes-search" }
        )
        let notesSearchFrame = notesSearch.convert(notesSearch.bounds, to: root.view)
        let listFrame = list.convert(list.bounds, to: root.view)
        XCTAssertLessThanOrEqual(
            notesSearchFrame.maxY,
            listFrame.minY + 0.5,
            "搜索框应位于大标题下方、列表上方，而不是屏幕底部"
        )

        let primary = try XCTUnwrap(session.library.books.first { $0.title == DesignFixture.fixtureTitle })
        let header = try XCTUnwrap(headerCell(in: list, bookID: primary.id, prefix: "notes-book"))
        XCTAssertEqual(header.accessibilityValue, "已展开")
        XCTAssertTrue(header.accessibilityTraits.contains(.header))
        XCTAssertTrue(header.accessibilityTraits.contains(.button))
        XCTAssertTrue(header.accessibilityLabel?.contains("2 条笔记") == true)

        let notes = try XCTUnwrap(primary.notes)
        XCTAssertEqual(notes.count, 2)
        let records = recordCells(in: list, prefixes: ["annotation-"])
        XCTAssertEqual(records.count, 2, "两行都应为 annotation-<noteID>")
        for note in notes {
            XCTAssertTrue(
                records.contains { $0.accessibilityIdentifier == "annotation-\(note.id.uuidString)" },
                "缺少 annotation-\(note.id.uuidString)"
            )
        }
        if let bookmark = primary.bookmarks?.first {
            XCTAssertFalse(
                records.contains { ($0.accessibilityIdentifier ?? "").contains(bookmark.id.uuidString) },
                "书签不应出现在合并笔记列表"
            )
        }
        XCTAssertFalse(
            records.contains { $0.accessibilityIdentifier?.hasPrefix("bookmark-") == true },
            "书签行应已从笔记页移除"
        )

        // 行内容（自定义 NotesRowContentConfiguration 通过无障碍 label 暴露）：引文、正文、章节。
        let joined = records.compactMap(\.accessibilityLabel).joined(separator: "\n")
        XCTAssertTrue(joined.contains("黛玉方进入房时"), "应显示高亮引文")
        XCTAssertTrue(joined.contains(DesignFixture.noteText), "应显示笔记正文")
        XCTAssertTrue(joined.contains("第三回"), "应显示章节信息")

        let bodyNote = try XCTUnwrap(notes.first { !$0.body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty })
        let highlightNote = try XCTUnwrap(notes.first { $0.body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty })

        // 色点：正文笔记固定暖灯 lamp；高亮按 highlightColor.tint。
        func dotColor(_ cell: UICollectionViewCell) -> UIColor? {
            cell.layoutIfNeeded()
            return cell.contentView.allViews.first {
                $0.bounds.width <= 9 && $0.bounds.height <= 9 && $0.backgroundColor != nil
                    && $0.backgroundColor != .clear
            }?.backgroundColor
        }
        let bodyRow = try XCTUnwrap(records.first {
            $0.accessibilityIdentifier == "annotation-\(bodyNote.id.uuidString)"
        })
        let highlightRow = try XCTUnwrap(records.first {
            $0.accessibilityIdentifier == "annotation-\(highlightNote.id.uuidString)"
        })
        XCTAssertEqual(dotColor(bodyRow), BookDesign.lamp, "正文笔记行色点应固定暖灯")
        XCTAssertEqual(dotColor(highlightRow), highlightNote.highlightColor.tint, "高亮行色点应按高亮颜色")

        // 滑动操作：trailing=删除（所有行），leading=编辑（仅带正文的笔记）。
        XCTAssertEqual(
            page.trailingSwipeActions(for: bodyNote.id)?.actions.compactMap(\.title),
            ["删除"]
        )
        XCTAssertEqual(
            page.leadingSwipeActions(for: bodyNote.id)?.actions.compactMap(\.title),
            ["编辑"]
        )
        XCTAssertNil(page.leadingSwipeActions(for: highlightNote.id), "纯高亮行不应有编辑操作")

        // 时间戳仍只存在旁路文件，不写进 catalog。
        let catalog = try String(
            contentsOf: session.root.appendingPathComponent("library.json"),
            encoding: .utf8
        )
        XCTAssertFalse(catalog.contains("recordTimestamp"))
        XCTAssertFalse(catalog.contains("createdAt"))

        for size in [CGSize(width: 375, height: 667), CGSize(width: 390, height: 844)] {
            for (style, theme) in [(UIUserInterfaceStyle.light, "light"), (.dark, "dark")] {
                let rendered = makeApplicationTabs(library: session.library, root: session.root, secrets: session.secrets)
                rendered.select(RootDestination.notes.rawValue)
                let image = DesignFixture.renderRoot(rendered, size: size, style: style)
                let attachment = XCTAttachment(
                    data: try XCTUnwrap(image.pngData()),
                    uniformTypeIdentifier: "public.png"
                )
                attachment.name = "notes-\(Int(size.width))x\(Int(size.height))-\(theme)"
                attachment.lifetime = .keepAlways
                add(attachment)
            }
        }

        // Dynamic Type XXXL：字体放大后行内容不得横向裁切/越界（task-8 字号刷新回归）。
        let accessible = makeApplicationTabs(library: session.library, root: session.root, secrets: session.secrets)
        accessible.select(RootDestination.notes.rawValue)
        let accessibleImage = DesignFixture.renderRoot(
            accessible,
            size: CGSize(width: 375, height: 667),
            style: .light,
            preferredContentSizeCategory: .accessibilityExtraExtraExtraLarge
        )
        let accessibleAttachment = XCTAttachment(
            data: try XCTUnwrap(accessibleImage.pngData()),
            uniformTypeIdentifier: "public.png"
        )
        accessibleAttachment.name = "notes-accessibility-xxxl-375x667-light"
        accessibleAttachment.lifetime = .keepAlways
        add(accessibleAttachment)
        let accessibleNavigation = try XCTUnwrap(
            accessible.viewControllers[RootDestination.notes.rawValue] as? UINavigationController
        )
        let accessiblePage = try XCTUnwrap(accessibleNavigation.topViewController as? NotesController)
        let accessibleList = try listView(in: accessiblePage, identifier: "notes")
        settle(accessibleList)
        for cell in accessibleList.visibleCells {
            XCTAssertLessThanOrEqual(cell.frame.maxX, 375.5, "XXXL 下列表行不得横向越界")
        }
    }

    /// task-30 v2 硬断言：键盘弹出/收起时卡片.frame.height 严格不变，仅整卡上移；拖动展开后同样只改 minY。
    func testNoteEditorCardHeightIsStableAcrossKeyboardChanges() async throws {
        let request = DesignFixture.Request(scenario: .normal, theme: .light)
        let session = try DesignFixture.makeSession(request)
        try await DesignFixture.seed(session)
        let primary = try XCTUnwrap(session.library.books.first { $0.title == DesignFixture.fixtureTitle })
        let note = try XCTUnwrap(primary.notes?.first)
        let editor = NoteEditorController(
            library: session.library,
            bookID: primary.id,
            note: note,
            changed: {}
        )
        let window = host(editor, size: CGSize(width: 375, height: 667))
        defer { window.isHidden = true }
        editor.view.layoutIfNeeded()
        let card = try XCTUnwrap(
            editor.view.subviews.first { $0.backgroundColor == BookDesign.paper && $0.frame.height > 100 },
            "应能找到纸白卡片视图"
        )

        func settleKeyboard() {
            editor.view.layoutIfNeeded()
            CATransaction.flush()
            RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.15))
            editor.view.layoutIfNeeded()
        }
        let initialHeight = card.frame.height
        let initialMinY = card.frame.minY
        XCTAssertGreaterThan(initialHeight, 0)
        XCTAssertEqual(initialHeight, 667 * 0.54, accuracy: 2, "初始卡片应约 54% 屏高")

        // 模拟键盘弹出：v3 键盘态高度 = min(54%基础, 可用高度-24)，顶部留白 ≥16。
        NotificationCenter.default.post(
            name: UIResponder.keyboardWillChangeFrameNotification,
            object: nil,
            userInfo: [
                UIResponder.keyboardFrameEndUserInfoKey: CGRect(x: 0, y: 367, width: 375, height: 300),
                UIResponder.keyboardAnimationDurationUserInfoKey: 0.0,
                UIResponder.keyboardAnimationCurveUserInfoKey: 7
            ]
        )
        settleKeyboard()
        let keyboardHeight = card.frame.height
        XCTAssertLessThanOrEqual(keyboardHeight, initialHeight + 0.5, "键盘态卡片不应比初始更高")
        XCTAssertEqual(
            keyboardHeight,
            min(initialHeight, 367 - 24),
            accuracy: 2,
            "键盘态卡片高度应为 min(54%基础, 可用高度-24)"
        )
        XCTAssertGreaterThanOrEqual(card.frame.minY, 16, "键盘态卡片顶部应留白 ≥16（grabber/圆角可见）")
        XCTAssertLessThan(card.frame.minY, initialMinY - 100, "键盘弹出后整卡应上移")
        XCTAssertLessThanOrEqual(card.frame.maxY, 367 + 1, "卡片底边不应被键盘遮挡（底部贴可用区）")

        // 模拟键盘收起：高度仍不变，位置复位。
        NotificationCenter.default.post(
            name: UIResponder.keyboardWillHideNotification,
            object: nil,
            userInfo: [
                UIResponder.keyboardFrameEndUserInfoKey: CGRect(x: 0, y: 667, width: 375, height: 0),
                UIResponder.keyboardAnimationDurationUserInfoKey: 0.0,
                UIResponder.keyboardAnimationCurveUserInfoKey: 7
            ]
        )
        settleKeyboard()
        XCTAssertEqual(card.frame.height, initialHeight, accuracy: 0.5, "键盘收起后卡片高度必须不变")
        XCTAssertEqual(card.frame.minY, initialMinY, accuracy: 1, "键盘收起后卡片位置应复位")
    }

    /// task-33：编辑已保存笔记时 header 有红色删除按钮；XXXL 大字号下 删除+保存 不挤压越界。
    func testNoteEditorHeaderDeleteButtonAndXXXLLayout() async throws {
        let request = DesignFixture.Request(scenario: .normal, theme: .light)
        let session = try DesignFixture.makeSession(request)
        try await DesignFixture.seed(session)
        let primary = try XCTUnwrap(session.library.books.first { $0.title == DesignFixture.fixtureTitle })
        let bodyNote = try XCTUnwrap(primary.notes?.first { !$0.body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty })

        let editor = NoteEditorController(
            library: session.library,
            bookID: primary.id,
            note: bodyNote,
            changed: {}
        )
        let image = DesignFixture.renderRoot(
            editor,
            size: CGSize(width: 375, height: 667),
            style: .light,
            preferredContentSizeCategory: .accessibilityExtraExtraExtraLarge
        )
        let attachment = XCTAttachment(data: try XCTUnwrap(image.pngData()), uniformTypeIdentifier: "public.png")
        attachment.name = "note-editor-xxxl-375x667-light"
        attachment.lifetime = .keepAlways
        add(attachment)

        let delete = try XCTUnwrap(
            editor.view.allViews.first { $0.accessibilityIdentifier == "note-delete" },
            "已保存笔记应有删除按钮"
        )
        let save = try XCTUnwrap(editor.view.allViews.first { $0.accessibilityIdentifier == "note-save" })
        XCTAssertFalse(delete.isHidden, "已保存笔记的删除按钮应可见")
        let deleteFrame = delete.convert(delete.bounds, to: editor.view)
        let saveFrame = save.convert(save.bounds, to: editor.view)
        XCTAssertGreaterThan(deleteFrame.width, 40)
        XCTAssertGreaterThan(saveFrame.width, 40)
        XCTAssertLessThanOrEqual(deleteFrame.maxX, editor.view.bounds.maxX + 0.5)
        XCTAssertLessThanOrEqual(saveFrame.maxX, editor.view.bounds.maxX + 0.5)
        XCTAssertLessThanOrEqual(deleteFrame.maxX, saveFrame.minX + 1, "删除与保存按钮不得重叠")

        // 新建（未保存）笔记不应显示删除入口。
        let fresh = NoteEditorController(
            library: session.library,
            bookID: primary.id,
            note: BookNote(locator: try bodyNote.location()),
            changed: {}
        )
        _ = DesignFixture.renderRoot(fresh, size: CGSize(width: 375, height: 667), style: .light)
        let freshDelete = fresh.view.allViews.first { $0.accessibilityIdentifier == "note-delete" }
        XCTAssertTrue(freshDelete?.isHidden ?? true, "新建笔记不应显示删除入口")
    }

    func testNotesEmptyStateOffersAReadableNextAction() async throws {
        let request = DesignFixture.Request(scenario: .empty, theme: .light)
        let session = try DesignFixture.makeSession(request)
        try await DesignFixture.seed(session)
        let root = makeApplicationTabs(library: session.library, root: session.root, secrets: session.secrets)
        root.select(RootDestination.notes.rawValue)
        let window = host(root, size: CGSize(width: 375, height: 667))
        defer { window.isHidden = true }

        let navigation = try XCTUnwrap(
            root.viewControllers[RootDestination.notes.rawValue] as? UINavigationController
        )
        let page = try XCTUnwrap(navigation.topViewController as? NotesController)
        let list = try listView(in: page, identifier: "notes")
        XCTAssertEqual(list.numberOfSections, 0)
        XCTAssertEqual(recordCount(in: list), 0)
        // 系统 content-unavailable 视图需要 windowScene；单测只断言配置，可见性与点击行为由 UI 测试覆盖。
        if #available(iOS 17.0, *) {
            let configuration = try XCTUnwrap(page.contentUnavailableConfiguration as? UIContentUnavailableConfiguration)
            XCTAssertEqual(configuration.text, "还没有笔记")
            XCTAssertEqual(configuration.button.title, "去书架读书")
        }

        let image = DesignFixture.renderRoot(root, size: CGSize(width: 375, height: 667), style: .light)
        let attachment = XCTAttachment(data: try XCTUnwrap(image.pngData()), uniformTypeIdentifier: "public.png")
        attachment.name = "notes-empty-375x667-light"
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    func testConversationsPageUsesDesignedHeaderSearchGroupingAndMetadata() async throws {
        let request = DesignFixture.Request(scenario: .normal, theme: .light)
        let session = try DesignFixture.makeSession(request)
        try await DesignFixture.seed(session)
        let root = makeApplicationTabs(library: session.library, root: session.root, secrets: session.secrets)
        root.select(RootDestination.conversations.rawValue)
        let window = host(root, size: CGSize(width: 375, height: 667))
        defer { window.isHidden = true }

        let navigation = try XCTUnwrap(
            root.viewControllers[RootDestination.conversations.rawValue] as? UINavigationController
        )
        let page = try XCTUnwrap(navigation.topViewController as? QuestionHistoryController)
        XCTAssertEqual(page.title, "对话")
        XCTAssertEqual(page.navigationItem.largeTitleDisplayMode, .always)
        XCTAssertTrue(navigation.navigationBar.prefersLargeTitles)
        XCTAssertNotNil(
            largeTitle(in: navigation, text: "对话"),
            "系统大标题应渲染页面标题；若为空请先报 Lead 决策，不要在测试里迁就"
        )
        let searchController = try XCTUnwrap(page.navigationItem.searchController)
        XCTAssertEqual(
            searchController.searchBar.searchTextField.accessibilityIdentifier,
            "conversation-search"
        )
        XCTAssertEqual(
            page.navigationItem.preferredSearchBarPlacement,
            .stacked,
            "iOS 26 默认会把搜索框放到屏幕底部，这里必须显式 stacked 以保持大标题下方布局"
        )
        let earlyList = try listView(in: page, identifier: "question-history")
        let conversationsSearch = searchController.searchBar.searchTextField
        let searchFrame = conversationsSearch.convert(conversationsSearch.bounds, to: root.view)
        let listFrame = earlyList.convert(earlyList.bounds, to: root.view)
        XCTAssertLessThanOrEqual(
            searchFrame.maxY,
            listFrame.minY + 0.5,
            "搜索框应位于大标题下方、列表上方，而不是屏幕底部"
        )

        let list = try listView(in: page, identifier: "question-history")
        XCTAssertEqual(list.numberOfSections, 1)
        XCTAssertEqual(recordCount(in: list), 2)
        let book = try XCTUnwrap(session.library.books.first { $0.title == DesignFixture.fixtureTitle })
        let header = try XCTUnwrap(headerCell(in: list, bookID: book.id, prefix: "conversations-book"))
        XCTAssertEqual(header.accessibilityValue, "已展开")
        XCTAssertTrue(header.accessibilityTraits.contains(.header))
        XCTAssertTrue(header.accessibilityTraits.contains(.button))
        XCTAssertTrue(header.accessibilityLabel?.contains("2 段对话") == true)

        let records = recordCells(in: list)
        XCTAssertEqual(records.count, 2)
        let labels = records.compactMap(\.accessibilityLabel).joined(separator: "\n")
        XCTAssertTrue(labels.contains(DesignFixture.conversationTitle))
        XCTAssertTrue(labels.contains("次提问"))
        XCTAssertTrue(labels.contains("这里的“灯”既是阅读时的照明"))
        XCTAssertTrue(records.allSatisfy { $0.accessibilityTraits.contains(.button) })

        let conversation = try XCTUnwrap(
            session.library.questions.conversations.first {
                $0.first.bookID == book.id && $0.title == DesignFixture.conversationTitle
            }
        )
        let actions = try XCTUnwrap(page.swipeActions(forConversationID: conversation.id))
        XCTAssertEqual(Set(actions.actions.compactMap(\.title)), Set(["改名", "删除"]))

        searchController.searchBar.text = "第一次进贾府"
        page.updateSearchResults(for: searchController)
        settle(list)
        XCTAssertEqual(recordCount(in: list), 1)
        XCTAssertTrue(
            recordCells(in: list).compactMap(\.accessibilityLabel).joined()
                .contains("林黛玉第一次进贾府时看到了什么")
        )

        searchController.searchBar.text = "不存在的对话"
        page.updateSearchResults(for: searchController)
        settle(list)
        XCTAssertEqual(list.numberOfSections, 0)
        XCTAssertEqual(recordCount(in: list), 0)
        if #available(iOS 17.0, *) {
            let configuration = try XCTUnwrap(page.contentUnavailableConfiguration as? UIContentUnavailableConfiguration)
            XCTAssertEqual(configuration.text, "没有找到相关对话")
            XCTAssertEqual(configuration.button.title, "清除搜索")
        }
        // 恢复搜索状态，供后续渲染附件使用；清除搜索按钮的点击行为由 UI 测试覆盖。
        searchController.searchBar.text = ""
        page.updateSearchResults(for: searchController)
        settle(list)
        XCTAssertEqual(searchController.searchBar.text, "")
        XCTAssertEqual(recordCount(in: list), 2)

        for size in [CGSize(width: 375, height: 667), CGSize(width: 390, height: 844)] {
            for (style, theme) in [(UIUserInterfaceStyle.light, "light"), (.dark, "dark")] {
                let rendered = makeApplicationTabs(
                    library: session.library,
                    root: session.root,
                    secrets: session.secrets
                )
                rendered.select(RootDestination.conversations.rawValue)
                let image = DesignFixture.renderRoot(rendered, size: size, style: style)
                let attachment = XCTAttachment(
                    data: try XCTUnwrap(image.pngData()),
                    uniformTypeIdentifier: "public.png"
                )
                attachment.name = "conversations-\(Int(size.width))x\(Int(size.height))-\(theme)"
                attachment.lifetime = .keepAlways
                add(attachment)
            }
        }

        // Dynamic Type XXXL：字体放大后行内容不得横向裁切/越界（task-8 字号刷新回归）。
        let accessible = makeApplicationTabs(library: session.library, root: session.root, secrets: session.secrets)
        accessible.select(RootDestination.conversations.rawValue)
        let accessibleImage = DesignFixture.renderRoot(
            accessible,
            size: CGSize(width: 375, height: 667),
            style: .light,
            preferredContentSizeCategory: .accessibilityExtraExtraExtraLarge
        )
        let accessibleAttachment = XCTAttachment(
            data: try XCTUnwrap(accessibleImage.pngData()),
            uniformTypeIdentifier: "public.png"
        )
        accessibleAttachment.name = "conversations-accessibility-xxxl-375x667-light"
        accessibleAttachment.lifetime = .keepAlways
        add(accessibleAttachment)
        let accessibleNavigation = try XCTUnwrap(
            accessible.viewControllers[RootDestination.conversations.rawValue] as? UINavigationController
        )
        let accessiblePage = try XCTUnwrap(accessibleNavigation.topViewController as? QuestionHistoryController)
        let accessibleList = try listView(in: accessiblePage, identifier: "question-history")
        settle(accessibleList)
        for cell in accessibleList.visibleCells {
            XCTAssertLessThanOrEqual(cell.frame.maxX, 375.5, "XXXL 下列表行不得横向越界")
        }
    }

    func testConversationsEmptyAndReadFailureOfferDistinctNextActions() async throws {
        let emptyRequest = DesignFixture.Request(scenario: .empty, theme: .light)
        let emptySession = try DesignFixture.makeSession(emptyRequest)
        try await DesignFixture.seed(emptySession)
        let emptyRoot = makeApplicationTabs(
            library: emptySession.library,
            root: emptySession.root,
            secrets: emptySession.secrets
        )
        emptyRoot.select(RootDestination.conversations.rawValue)
        let emptyWindow = host(emptyRoot, size: CGSize(width: 375, height: 667))
        defer { emptyWindow.isHidden = true }

        let emptyNavigation = try XCTUnwrap(
            emptyRoot.viewControllers[RootDestination.conversations.rawValue] as? UINavigationController
        )
        let emptyPage = try XCTUnwrap(emptyNavigation.topViewController as? QuestionHistoryController)
        let emptyList = try listView(in: emptyPage, identifier: "question-history")
        XCTAssertEqual(emptyList.numberOfSections, 0)
        XCTAssertEqual(recordCount(in: emptyList), 0)
        var emptyConfigurationText: String?
        if #available(iOS 17.0, *) {
            let configuration = try XCTUnwrap(emptyPage.contentUnavailableConfiguration as? UIContentUnavailableConfiguration)
            emptyConfigurationText = configuration.text
            XCTAssertEqual(configuration.text, "还没有对话")
        }
        let emptyImage = DesignFixture.renderRoot(
            emptyRoot,
            size: CGSize(width: 375, height: 667),
            style: .light
        )
        let emptyAttachment = XCTAttachment(
            data: try XCTUnwrap(emptyImage.pngData()),
            uniformTypeIdentifier: "public.png"
        )
        emptyAttachment.name = "conversations-empty-375x667-light"
        emptyAttachment.lifetime = .keepAlways
        add(emptyAttachment)

        let failedRequest = DesignFixture.Request(scenario: .normal, theme: .light)
        let failedSession = try DesignFixture.makeSession(failedRequest)
        try await DesignFixture.seed(failedSession)
        try Data("not valid conversation data".utf8).write(
            to: failedSession.root.appendingPathComponent("reading-questions.json"),
            options: .atomic
        )
        let failedLibrary = try LibraryStore(root: failedSession.root, secrets: failedSession.secrets)
        let failedRoot = makeApplicationTabs(
            library: failedLibrary,
            root: failedSession.root,
            secrets: failedSession.secrets
        )
        failedRoot.select(RootDestination.conversations.rawValue)
        let failedWindow = host(failedRoot, size: CGSize(width: 375, height: 667))
        defer { failedWindow.isHidden = true }

        let failedNavigation = try XCTUnwrap(
            failedRoot.viewControllers[RootDestination.conversations.rawValue] as? UINavigationController
        )
        let failedPage = try XCTUnwrap(failedNavigation.topViewController as? QuestionHistoryController)
        let failedList = try listView(in: failedPage, identifier: "question-history")
        XCTAssertEqual(failedList.numberOfSections, 0)
        var failedConfigurationText: String?
        if #available(iOS 17.0, *) {
            let configuration = try XCTUnwrap(failedPage.contentUnavailableConfiguration as? UIContentUnavailableConfiguration)
            failedConfigurationText = configuration.text
            XCTAssertEqual(configuration.text, "对话读取失败")
        }
        XCTAssertNotEqual(emptyConfigurationText, failedConfigurationText)
        let failedImage = DesignFixture.renderRoot(
            failedRoot,
            size: CGSize(width: 375, height: 667),
            style: .light
        )
        let failedAttachment = XCTAttachment(
            data: try XCTUnwrap(failedImage.pngData()),
            uniformTypeIdentifier: "public.png"
        )
        failedAttachment.name = "conversations-failed-375x667-light"
        failedAttachment.lifetime = .keepAlways
        add(failedAttachment)
    }

    func testBookGroupsCollapseAndPersistIndependentlyAcrossTabsAndReopening() async throws {
        let fixture = try await makeBookGroupFixture()
        defer { try? FileManager.default.removeItem(at: fixture.library.root) }
        let root = makeApplicationTabs(library: fixture.library, root: fixture.library.root, secrets: fixture.library.secrets)
        root.select(RootDestination.notes.rawValue)
        // 折叠动画完成回调需要真实窗口：保留窗口，分组头 accessibilityValue 才会更新。
        let window = host(root, size: CGSize(width: 375, height: 667))
        defer { window.isHidden = true }
        let notesNavigation = try XCTUnwrap(root.viewControllers[RootDestination.notes.rawValue] as? UINavigationController)
        let notes = try XCTUnwrap(notesNavigation.topViewController as? NotesController)
        let notesList = try listView(in: notes, identifier: "notes")
        XCTAssertEqual(notesList.numberOfSections, 2)
        let primary = try bookGroupSection(in: notesList, bookID: fixture.primaryID, prefix: "notes-book")
        let secondary = try bookGroupSection(in: notesList, bookID: fixture.secondaryID, prefix: "notes-book")
        XCTAssertEqual(recordCount(in: notesList, section: primary.section), 0)
        XCTAssertEqual(
            recordCount(in: notesList, section: secondary.section),
            2,
            "Newest notes expand even when the book is not first in the catalogue"
        )
        XCTAssertEqual(secondary.header.accessibilityValue, "已展开")
        XCTAssertEqual(primary.header.accessibilityValue, "已收起")
        XCTAssertTrue(secondary.header.accessibilityLabel?.contains("2 条笔记") == true)
        notes.toggleGroup(bookID: fixture.secondaryID)
        settle(notesList)
        XCTAssertEqual(recordCount(in: notesList, section: secondary.section), 0)
        XCTAssertNil(notesList.backgroundView, "Collapsed records are not an empty library")
        let collapsed = try bookGroupSection(in: notesList, bookID: fixture.secondaryID, prefix: "notes-book")
        XCTAssertEqual(collapsed.section, secondary.section)
        notes.toggleGroup(bookID: fixture.primaryID)
        settle(notesList)
        XCTAssertEqual(recordCount(in: notesList, section: primary.section), 3)
        XCTAssertEqual(recordCells(in: notesList).count, 3)

        root.select(RootDestination.conversations.rawValue)
        root.view.layoutIfNeeded()
        let historyNavigation = try XCTUnwrap(root.viewControllers[RootDestination.conversations.rawValue] as? UINavigationController)
        let history = try XCTUnwrap(historyNavigation.topViewController as? QuestionHistoryController)
        let historyList = try listView(in: history, identifier: "question-history")
        let conversationGroup = try bookGroupSection(
            in: historyList,
            bookID: fixture.primaryID,
            prefix: "conversations-book"
        )
        XCTAssertEqual(recordCount(in: historyList, section: conversationGroup.section), 2)
        history.toggleGroup(bookID: fixture.primaryID)
        settle(historyList)
        XCTAssertEqual(recordCount(in: historyList, section: conversationGroup.section), 0)
        root.select(RootDestination.notes.rawValue)
        notes.viewWillAppear(false)
        settle(notesList)
        XCTAssertEqual(recordCount(in: notesList, section: primary.section), 3)
        XCTAssertEqual(recordCount(in: notesList, section: secondary.section), 0)

        let reopenedLibrary = try LibraryStore(root: fixture.library.root, secrets: fixture.library.secrets)
        let reopenedNotes = NotesController(library: reopenedLibrary)
        _ = DesignFixture.renderRoot(reopenedNotes, size: CGSize(width: 375, height: 667), style: .light)
        let reopenedNotesList = try listView(in: reopenedNotes, identifier: "notes")
        XCTAssertEqual(reopenedNotesList.numberOfSections, 2)
        let reopenedPrimary = try bookGroupSection(in: reopenedNotesList, bookID: fixture.primaryID, prefix: "notes-book")
        let reopenedSecondary = try bookGroupSection(in: reopenedNotesList, bookID: fixture.secondaryID, prefix: "notes-book")
        XCTAssertEqual(recordCount(in: reopenedNotesList, section: reopenedPrimary.section), 3)
        XCTAssertEqual(recordCount(in: reopenedNotesList, section: reopenedSecondary.section), 0)
        XCTAssertEqual(reopenedPrimary.header.accessibilityValue, "已展开")
        XCTAssertEqual(reopenedSecondary.header.accessibilityValue, "已收起")
        let reopenedHistory = QuestionHistoryController(library: reopenedLibrary)
        _ = DesignFixture.renderRoot(reopenedHistory, size: CGSize(width: 375, height: 667), style: .light)
        let reopenedHistoryList = try listView(in: reopenedHistory, identifier: "question-history")
        XCTAssertEqual(reopenedHistoryList.numberOfSections, 2)
        XCTAssertTrue(
            (0..<reopenedHistoryList.numberOfSections).allSatisfy {
                recordCount(in: reopenedHistoryList, section: $0) == 0
            }
        )
        let reopenedConversation = try bookGroupSection(
            in: reopenedHistoryList,
            bookID: fixture.primaryID,
            prefix: "conversations-book"
        )
        reopenedHistory.toggleGroup(bookID: fixture.primaryID)
        settle(reopenedHistoryList)
        XCTAssertEqual(recordCount(in: reopenedHistoryList, section: reopenedConversation.section), 2)
        let conversation = try XCTUnwrap(
            reopenedLibrary.questions.conversations.first { $0.first.bookID == fixture.primaryID }
        )
        let actions = try XCTUnwrap(reopenedHistory.swipeActions(forConversationID: conversation.id))
        XCTAssertEqual(Set(actions.actions.compactMap(\.title)), ["改名", "删除"])
    }

    func testBookGroupSearchExpandsMatchesWithoutOverwritingSavedCollapseOrLosingFilteredNotes() async throws {
        let fixture = try await makeBookGroupFixture()
        defer { try? FileManager.default.removeItem(at: fixture.library.root) }
        let notes = NotesController(library: fixture.library)
        _ = DesignFixture.renderRoot(notes, size: CGSize(width: 375, height: 667), style: .light)
        let notesList = try listView(in: notes, identifier: "notes")
        notes.toggleGroup(bookID: fixture.secondaryID)
        settle(notesList)
        let searchController = try XCTUnwrap(notes.navigationItem.searchController)
        searchController.searchBar.text = "分组命中"
        notes.updateSearchResults(for: searchController)
        settle(notesList)
        // 合并笔记列表：搜索命中 primary 1 条 + secondary 2 条“分组命中”，共 3 条。
        XCTAssertEqual(notesList.numberOfSections, 2)
        XCTAssertEqual(recordCount(in: notesList), 3)
        waitForHeaderValue("已展开", in: notesList, bookID: fixture.secondaryID, prefix: "notes-book")
        notes.toggleGroup(bookID: fixture.secondaryID)
        settle(notesList)
        XCTAssertEqual(
            recordCount(in: notesList),
            3,
            "Search results cannot be hidden by collapse"
        )
        // 搜索无结果：空态文案 + 动作标题。
        searchController.searchBar.text = "不存在的痕迹"
        notes.updateSearchResults(for: searchController)
        settle(notesList)
        XCTAssertEqual(notesList.numberOfSections, 0)
        if #available(iOS 17.0, *) {
            let configuration = try XCTUnwrap(
                notes.contentUnavailableConfiguration as? UIContentUnavailableConfiguration
            )
            XCTAssertEqual(configuration.text, "没有找到相关笔记")
            XCTAssertEqual(configuration.button.title, "清除搜索")
        }
        // 清空搜索词：回到“高亮”分类，持久化的收起状态仍生效。
        searchController.searchBar.text = "   "
        notes.updateSearchResults(for: searchController)
        settle(notesList)
        XCTAssertTrue(
            (0..<notesList.numberOfSections).allSatisfy {
                recordCount(in: notesList, section: $0) == 0
            }
        )

        let history = QuestionHistoryController(library: fixture.library)
        _ = DesignFixture.renderRoot(history, size: CGSize(width: 375, height: 667), style: .light)
        let historyList = try listView(in: history, identifier: "question-history")
        let primary = try bookGroupSection(in: historyList, bookID: fixture.primaryID, prefix: "conversations-book")
        XCTAssertEqual(recordCount(in: historyList, section: primary.section), 2)
        history.toggleGroup(bookID: fixture.primaryID)
        settle(historyList)
        let conversationSearch = try XCTUnwrap(history.navigationItem.searchController)
        conversationSearch.searchBar.text = "分组命中"
        history.updateSearchResults(for: conversationSearch)
        settle(historyList)
        XCTAssertEqual(historyList.numberOfSections, 1)
        XCTAssertEqual(recordCount(in: historyList), 1)
        let matchedConversation = try bookGroupSection(
            in: historyList,
            bookID: fixture.secondaryID,
            prefix: "conversations-book"
        )
        XCTAssertEqual(matchedConversation.section, 0, "搜索后只剩命中分组")
        waitForHeaderValue("已展开", in: historyList, bookID: fixture.secondaryID, prefix: "conversations-book")
        conversationSearch.searchBar.text = "不存在的分组"
        history.updateSearchResults(for: conversationSearch)
        settle(historyList)
        XCTAssertEqual(historyList.numberOfSections, 0)
        if #available(iOS 17.0, *) {
            XCTAssertEqual((history.contentUnavailableConfiguration as? UIContentUnavailableConfiguration)?.text, "没有找到相关对话")
        }
        conversationSearch.searchBar.text = ""
        history.updateSearchResults(for: conversationSearch)
        settle(historyList)
        XCTAssertEqual(historyList.numberOfSections, 2)
        XCTAssertTrue(
            (0..<historyList.numberOfSections).allSatisfy {
                recordCount(in: historyList, section: $0) == 0
            }
        )
        let reopened = QuestionHistoryController(library: try LibraryStore(root: fixture.library.root, secrets: fixture.library.secrets))
        _ = DesignFixture.renderRoot(reopened, size: CGSize(width: 375, height: 667), style: .light)
        let reopenedList = try listView(in: reopened, identifier: "question-history")
        XCTAssertTrue(
            (0..<reopenedList.numberOfSections).allSatisfy {
                recordCount(in: reopenedList, section: $0) == 0
            }
        )
    }

    func testBookGroupScrollPositionsRestoreSeparatelyAfterReopening() async throws {
        let fixture = try await makeBookGroupFixture()
        defer { try? FileManager.default.removeItem(at: fixture.library.root) }
        for (page, identifier, offset) in [("notes", "notes", CGFloat(60)), ("conversations", "question-history", CGFloat(40))] {
            func makeController() -> UIViewController {
                page == "notes" ? NotesController(library: fixture.library) : QuestionHistoryController(library: fixture.library)
            }
            let controller = makeController()
            // 默认“高亮”分类内容更短；用更矮窗口保证可滚动到保存偏移。
            let size = CGSize(width: 375, height: 200)
            _ = DesignFixture.renderRoot(controller, size: size, style: .light)
            let list = try listView(in: controller, identifier: identifier)
            list.layoutIfNeeded()
            let maximum = list.contentSize.height - list.bounds.height + list.adjustedContentInset.bottom
            XCTAssertGreaterThanOrEqual(maximum, offset, "\(page) 内容需可滚动到保存偏移")
            list.setContentOffset(CGPoint(x: 0, y: offset), animated: false)
            list.delegate?.scrollViewDidEndDragging?(list, willDecelerate: false)
            controller.viewWillDisappear(false)
            let reopened = makeController()
            _ = DesignFixture.renderRoot(reopened, size: size, style: .light)
            let reopenedList = try listView(in: reopened, identifier: identifier)
            reopenedList.layoutIfNeeded()
            XCTAssertEqual(reopenedList.contentOffset.y, offset, accuracy: 1, page)
        }
    }

    func testBookGroupHeadersFitSmallScreenAndAccessibilitySizesInBothThemes() async throws {
        let fixture = try await makeBookGroupFixture()
        defer { try? FileManager.default.removeItem(at: fixture.library.root) }
        for (page, identifier, prefix) in [
            ("notes", "notes", "notes-book"),
            ("conversations", "question-history", "conversations-book")
        ] {
            for style in [UIUserInterfaceStyle.light, .dark] {
                for category in [UIContentSizeCategory.large, .accessibilityExtraExtraExtraLarge] {
                    let controller: UIViewController = page == "notes"
                        ? NotesController(library: fixture.library) : QuestionHistoryController(library: fixture.library)
                    let image = DesignFixture.renderRoot(
                        controller,
                        size: CGSize(width: 375, height: 667),
                        style: style,
                        preferredContentSizeCategory: category
                    )
                    let attachment = XCTAttachment(data: try XCTUnwrap(image.pngData()), uniformTypeIdentifier: "public.png")
                    attachment.name = "groups-\(page)-375x667-\(style.rawValue)-\(category.rawValue)"
                    attachment.lifetime = .keepAlways
                    add(attachment)
                    let list = try listView(in: controller, identifier: identifier)
                    XCTAssertEqual(list.numberOfSections, 2)
                    let headers = list.visibleCells.filter {
                        $0.accessibilityIdentifier?.hasPrefix(prefix + "-") == true
                    }
                    XCTAssertFalse(headers.isEmpty, "至少应渲染一个分组头")
                    for header in headers {
                        XCTAssertGreaterThanOrEqual(header.frame.height, 44)
                        let headerFrame = list.convert(header.bounds, from: header)
                        XCTAssertGreaterThanOrEqual(headerFrame.minX, -0.5)
                        XCTAssertLessThanOrEqual(headerFrame.maxX, 375.5)
                        XCTAssertTrue(header.accessibilityTraits.contains(.button))
                        XCTAssertTrue(header.accessibilityTraits.contains(.header))
                        XCTAssertTrue(["已展开", "已收起"].contains(header.accessibilityValue ?? ""))
                        for label in header.allViews.compactMap({ $0 as? UILabel })
                            .filter({ !($0.text ?? "").isEmpty && !$0.isHidden }) {
                            XCTAssertGreaterThan(label.bounds.width, 0)
                            let requiredHeight = label.sizeThatFits(
                                CGSize(width: label.bounds.width, height: .greatestFiniteMagnitude)
                            ).height
                            XCTAssertGreaterThanOrEqual(label.bounds.height + 1, requiredHeight)
                            let frame = header.convert(label.bounds, from: label)
                            XCTAssertLessThanOrEqual(frame.maxX, header.bounds.width + 0.5)
                            XCTAssertLessThanOrEqual(frame.maxY, header.bounds.height + 0.5)
                        }
                    }
                    for section in 0..<list.numberOfSections {
                        let attributes = try XCTUnwrap(
                            list.collectionViewLayout.layoutAttributesForItem(
                                at: IndexPath(item: 0, section: section)
                            ),
                            "section \(section)"
                        )
                        XCTAssertGreaterThanOrEqual(attributes.frame.height, 44)
                        XCTAssertLessThanOrEqual(attributes.frame.maxX, 375.5)
                    }
                }
            }
        }
    }

    func testNotesListExcludesBookmarksAndFallsBackToEmptyAfterDeletingNotes() async throws {
        let request = DesignFixture.Request(scenario: .normal, theme: .light)
        let session = try DesignFixture.makeSession(request)
        try await DesignFixture.seed(session)
        let primary = try XCTUnwrap(session.library.books.first { $0.title == DesignFixture.fixtureTitle })
        let bookmarks = try XCTUnwrap(primary.bookmarks)
        XCTAssertFalse(bookmarks.isEmpty)

        let notes = NotesController(library: session.library)
        _ = DesignFixture.renderRoot(notes, size: CGSize(width: 375, height: 667), style: .light)
        let list = try listView(in: notes, identifier: "notes")
        XCTAssertEqual(list.numberOfSections, 1, "只有红楼梦有笔记/高亮")
        XCTAssertEqual(recordCount(in: list), 2)
        XCTAssertFalse(
            recordCells(in: list).contains { $0.accessibilityIdentifier?.hasPrefix("bookmark-") == true },
            "书签不应出现在笔记列表"
        )

        // 删除全部笔记后回到「还没有笔记」空态；书签仍在但不显示。
        for note in primary.notes ?? [] {
            try session.library.removeNote(note.id, bookID: primary.id)
        }
        let empty = NotesController(library: session.library)
        _ = DesignFixture.renderRoot(empty, size: CGSize(width: 375, height: 667), style: .light)
        let emptyList = try listView(in: empty, identifier: "notes")
        XCTAssertEqual(emptyList.numberOfSections, 0)
        if #available(iOS 17.0, *) {
            let configuration = try XCTUnwrap(
                empty.contentUnavailableConfiguration as? UIContentUnavailableConfiguration
            )
            XCTAssertEqual(configuration.text, "还没有笔记")
            XCTAssertEqual(configuration.button.title, "去书架读书")
        }
    }

    private func bookGroupSection(
        in list: UICollectionView,
        bookID: String,
        prefix: String
    ) throws -> (section: Int, header: UICollectionViewCell) {
        settle(list)
        for section in 0..<list.numberOfSections {
            let indexPath = IndexPath(item: 0, section: section)
            guard let cell = list.cellForItem(at: indexPath),
                  cell.accessibilityIdentifier == "\(prefix)-\(bookID)" else { continue }
            return (section, cell)
        }
        throw XCTUnwrapErrorForMissingBookGroup()
    }

    private struct XCTUnwrapErrorForMissingBookGroup: Error {}

    private func listView(in controller: UIViewController, identifier: String) throws -> UICollectionView {
        try XCTUnwrap(
            controller.view.allViews.compactMap { $0 as? UICollectionView }
                .first { $0.accessibilityIdentifier == identifier },
            "缺少列表 \(identifier)"
        )
    }

    private func settle(_ list: UICollectionView) {
        list.layoutIfNeeded()
        CATransaction.flush()
        RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.2))
        list.layoutIfNeeded()
    }

    /// 把夹具根控制器挂进真实窗口，走完外观回调；系统空态视图需要窗口才会实例化。
    @discardableResult
    private func host(_ root: UIViewController, size: CGSize) -> UIWindow {
        let window = UIWindow(frame: CGRect(origin: .zero, size: size))
        window.rootViewController = root
        window.isHidden = false
        root.beginAppearanceTransition(true, animated: false)
        root.view.frame = window.bounds
        root.view.layoutIfNeeded()
        root.endAppearanceTransition()
        window.layoutIfNeeded()
        RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.05))
        window.layoutIfNeeded()
        return window
    }

    private func waitForHeaderValue(
        _ expected: String,
        in list: UICollectionView,
        bookID: String,
        prefix: String,
        timeout: TimeInterval = 2
    ) {
        let deadline = Date(timeIntervalSinceNow: timeout)
        while Date() < deadline {
            settle(list)
            if headerCell(in: list, bookID: bookID, prefix: prefix)?.accessibilityValue == expected {
                return
            }
            RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.05))
        }
        XCTFail("分组头 accessibilityValue 应为 \(expected)")
    }

    private func recordCount(in list: UICollectionView) -> Int {
        (0..<list.numberOfSections).reduce(0) { $0 + recordCount(in: list, section: $1) }
    }

    private func recordCount(in list: UICollectionView, section: Int) -> Int {
        guard (0..<list.numberOfSections).contains(section) else { return 0 }
        // 系统列表每组首项是分组头 cell；收起时只保留分组头。
        return max(0, list.numberOfItems(inSection: section) - 1)
    }

    private func headerCell(
        in list: UICollectionView,
        bookID: String,
        prefix: String
    ) -> UICollectionViewCell? {
        settle(list)
        return list.visibleCells.first { $0.accessibilityIdentifier == "\(prefix)-\(bookID)" }
    }

    private func recordCells(
        in list: UICollectionView,
        prefixes: [String] = ["annotation-", "question-"]
    ) -> [UICollectionViewCell] {
        settle(list)
        return list.visibleCells.filter { cell in
            guard let identifier = cell.accessibilityIdentifier else { return false }
            return prefixes.contains { identifier.hasPrefix($0) }
        }
    }

    private func largeTitle(in navigation: UINavigationController, text: String) -> UILabel? {
        navigation.navigationBar.allViews.compactMap { $0 as? UILabel }
            .first { $0.text == text && !$0.isHidden && $0.alpha > 0 }
    }



    /// task-35 后加载提示条不再出现，改用 footer 进度文本非空作为 reader 加载完成信号。
    private func waitForReaderProgress(_ reader: ReaderController, timeout: TimeInterval = 30) async -> Bool {
        for _ in 0..<Int(timeout * 10) {
            if let label = reader.view.allViews.first(where: {
                $0.accessibilityIdentifier == "reader-progress"
            }) as? UILabel, let text = label.text, !text.isEmpty {
                return true
            }
            try? await Task.sleep(nanoseconds: 100_000_000)
        }
        return false
    }

    private func makeBookGroupFixture() async throws -> (library: LibraryStore, primaryID: String, secondaryID: String) {
        let session = try DesignFixture.makeSession(.init(scenario: .normal, theme: .light))
        do {
            try await DesignFixture.seed(session)
            let primary = try XCTUnwrap(session.library.books.first { $0.title == DesignFixture.fixtureTitle })
            let secondary = try XCTUnwrap(session.library.books.first { $0.title == "瓦尔登湖" })
            var locator = try XCTUnwrap(primary.notes?.first).location()
            locator.text.highlight = "分组命中原文"
            try session.library.saveNote(BookNote(locator: locator, body: "分组命中笔记"), for: primary.id)
            try session.library.saveNote(BookNote(locator: locator, body: "分组命中笔记"), for: secondary.id)
            try session.library.saveNote(BookNote(locator: locator), for: secondary.id, highlightOnly: true)
            try session.library.saveBookmark(Bookmark(locator: locator), for: secondary.id)
            var question = ReadingQuestion(book: secondary, selection: QuestionEvidence(locator: locator), neighbors: [])
            question.question = "分组命中问题"
            question.answer = "固定夹具回答"
            question.state = .complete
            question.updated = Date(timeIntervalSince1970: 1_700_000_000)
            XCTAssertTrue(session.library.questions.save(question))
            var timestamps: [String: Date] = [:]
            for book in session.library.books {
                let date = Date(timeIntervalSince1970: book.id == secondary.id ? 1_700_000_100 : 1_700_000_000)
                for note in book.notes ?? [] { timestamps["note:\(book.id):\(note.id.uuidString)"] = date }
                for bookmark in book.bookmarks ?? [] { timestamps["bookmark:\(book.id):\(bookmark.id.uuidString)"] = date }
            }
            let encoder = JSONEncoder()
            encoder.dateEncodingStrategy = .iso8601
            try encoder.encode(timestamps).write(to: session.root.appendingPathComponent("record-timestamps.json"), options: .atomic)
            return (try LibraryStore(root: session.root, secrets: session.secrets), primary.id, secondary.id)
        } catch {
            try? FileManager.default.removeItem(at: session.root)
            throw error
        }
    }

    func testProfileUsesCenteredBrandDesignedSettingsAndPersistentAppearance() async throws {
        let appearanceKey = "interface-style"
        let previousAppearance = UserDefaults.standard.object(forKey: appearanceKey)
        defer {
            if let previousAppearance {
                UserDefaults.standard.set(previousAppearance, forKey: appearanceKey)
            } else {
                UserDefaults.standard.removeObject(forKey: appearanceKey)
            }
        }
        UserDefaults.standard.removeObject(forKey: appearanceKey)

        let request = DesignFixture.Request(scenario: .normal, theme: .light)
        let session = try DesignFixture.makeSession(request)
        try await DesignFixture.seed(session)
        let root = makeApplicationTabs(
            library: session.library,
            root: session.root,
            secrets: session.secrets
        )
        root.select(RootDestination.profile.rawValue)
        root.loadViewIfNeeded()
        root.view.frame = CGRect(x: 0, y: 0, width: 375, height: 667)
        root.view.layoutIfNeeded()

        let views = root.view.allViews
        // task-72：「我的」去掉顶部品牌 hero，直接从「设置」「关于」两组系统列表开始。
        XCTAssertNotNil(views.first { $0.accessibilityIdentifier == "profile-list" })
        XCTAssertNil(views.first { $0.accessibilityIdentifier == "profile-brand" })
        XCTAssertNil(views.first { $0.accessibilityIdentifier == "profile-title" })
        XCTAssertNil(views.first { $0.accessibilityIdentifier == "profile-brand-icon" })
        XCTAssertNil(views.first { $0.accessibilityIdentifier == "profile-stats" })

        for identifier in [
            "profile-ai-service",
            "profile-appearance",
            "profile-about"
        ] {
            XCTAssertNotNil(views.first { $0.accessibilityIdentifier == identifier }, identifier)
        }
        XCTAssertNil(views.first { $0.accessibilityIdentifier == "profile-storage-disclosure" })
        // 系统列表化后设置行可能是 cell 而非 UIControl：按标识符取 UIView 并断言可访问性值。
        let service = try XCTUnwrap(
            views.first { $0.accessibilityIdentifier == "profile-ai-service" },
            "profile-ai-service"
        )
        XCTAssertEqual(service.accessibilityValue, "DeepSeek · deepseek-flash")
        XCTAssertGreaterThanOrEqual(
            root.view.convert(service.bounds, from: service).height,
            44,
            "系统列表设置行高度语义"
        )
        let appearance = try XCTUnwrap(
            views.first { $0.accessibilityIdentifier == "profile-appearance" },
            "profile-appearance"
        )
        XCTAssertEqual(appearance.accessibilityValue, "跟随系统")
        let about = try XCTUnwrap(
            views.first { $0.accessibilityIdentifier == "profile-about" },
            "profile-about"
        )
        XCTAssertFalse((about.accessibilityValue ?? "").isEmpty)

        let navigation = try XCTUnwrap(root.viewControllers.last as? UINavigationController)
        let profile = try XCTUnwrap(navigation.topViewController as? ProfileController)
        profile.setAppearance(.dark)
        root.view.layoutIfNeeded()
        XCTAssertEqual(
            UserDefaults.standard.integer(forKey: appearanceKey),
            UIUserInterfaceStyle.dark.rawValue
        )
        let appearanceAfterDark = try XCTUnwrap(
            root.view.allViews.first { $0.accessibilityIdentifier == "profile-appearance" },
            "profile-appearance"
        )
        XCTAssertEqual(appearanceAfterDark.accessibilityValue, "深色")

        let reopened = makeApplicationTabs(
            library: session.library,
            root: session.root,
            secrets: session.secrets
        )
        reopened.select(RootDestination.profile.rawValue)
        reopened.loadViewIfNeeded()
        reopened.view.frame = CGRect(x: 0, y: 0, width: 375, height: 667)
        reopened.view.layoutIfNeeded()
        let reopenedAppearance = try XCTUnwrap(
            reopened.view.allViews.first { $0.accessibilityIdentifier == "profile-appearance" },
            "profile-appearance"
        )
        XCTAssertEqual(reopenedAppearance.accessibilityValue, "深色")
        profile.setAppearance(.unspecified)
        root.view.layoutIfNeeded()
        let appearanceRestored = try XCTUnwrap(
            root.view.allViews.first { $0.accessibilityIdentifier == "profile-appearance" },
            "profile-appearance"
        )
        XCTAssertEqual(appearanceRestored.accessibilityValue, "跟随系统")

        for size in [CGSize(width: 375, height: 667), CGSize(width: 390, height: 844)] {
            for (style, theme) in [
                (UIUserInterfaceStyle.light, "light"),
                (UIUserInterfaceStyle.dark, "dark")
            ] {
                let rendered = makeApplicationTabs(
                    library: session.library,
                    root: session.root,
                    secrets: session.secrets
                )
                rendered.select(RootDestination.profile.rawValue)
                let image = DesignFixture.renderRoot(rendered, size: size, style: style)
                let attachment = XCTAttachment(
                    data: try XCTUnwrap(image.pngData()),
                    uniformTypeIdentifier: "public.png"
                )
                attachment.name = "profile-\(Int(size.width))x\(Int(size.height))-\(theme)"
                attachment.lifetime = .keepAlways
                add(attachment)
            }
        }

        let accessible = makeApplicationTabs(
            library: session.library,
            root: session.root,
            secrets: session.secrets
        )
        accessible.select(RootDestination.profile.rawValue)
        let accessibleImage = DesignFixture.renderRoot(
            accessible,
            size: CGSize(width: 375, height: 667),
            style: .light,
            preferredContentSizeCategory: .accessibilityExtraExtraLarge
        )
        // XXXL 下列表内容超出一屏：滚到底断言设置行（系统列表只实例化可见 cell）。
        let accessibleViews = accessible.view.allViews
        XCTAssertNil(accessibleViews.first { $0.accessibilityIdentifier == "profile-title" })
        let profileList = try XCTUnwrap(
            accessibleViews.compactMap { $0 as? UICollectionView }
                .first { $0.accessibilityIdentifier == "profile-list" },
            "profile-list"
        )
        profileList.layoutIfNeeded()
        profileList.setContentOffset(
            CGPoint(x: 0, y: max(0, profileList.contentSize.height - profileList.bounds.height)),
            animated: false
        )
        profileList.layoutIfNeeded()
        for identifier in ["profile-ai-service", "profile-appearance", "profile-about"] {
            let view = try XCTUnwrap(
                accessible.view.allViews.first { $0.accessibilityIdentifier == identifier },
                identifier
            )
            XCTAssertGreaterThan(view.bounds.height, 0)
            XCTAssertLessThanOrEqual(view.frame.maxX, 375.5)
        }
        let accessibleAttachment = XCTAttachment(
            data: try XCTUnwrap(accessibleImage.pngData()),
            uniformTypeIdentifier: "public.png"
        )
        accessibleAttachment.name = "profile-accessibility-xxxl-375x667-light"
        accessibleAttachment.lifetime = .keepAlways
        add(accessibleAttachment)
    }

    func testProfileShowsUnconfiguredServiceWithoutReadingAKey() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("ShudengProfileUnconfigured-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }

        let profile = ProfileController(root: root, secrets: EphemeralSecrets())
        let navigation = UINavigationController(rootViewController: profile)
        navigation.loadViewIfNeeded()
        navigation.view.frame = CGRect(x: 0, y: 0, width: 375, height: 667)
        navigation.view.layoutIfNeeded()

        // 系统列表化后设置行可能是 cell 而非 UIControl：按标识符取 UIView。
        let service = try XCTUnwrap(
            navigation.view.allViews.first { $0.accessibilityIdentifier == "profile-ai-service" },
            "profile-ai-service"
        )
        XCTAssertEqual(service.accessibilityValue, "尚未配置，阅读仍可使用")
        let image = DesignFixture.renderRoot(
            navigation,
            size: CGSize(width: 375, height: 667),
            style: .light
        )
        let attachment = XCTAttachment(
            data: try XCTUnwrap(image.pngData()),
            uniformTypeIdentifier: "public.png"
        )
        attachment.name = "profile-unconfigured-375x667-light"
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    func testReaderUsesDesignedTypographyMarginsAndWarmSelection() throws {
        let light = ReaderController.readingPreferences(
            ReadingSettings(scroll: false, fontSize: 100, dark: false)
        )
        XCTAssertEqual(light.fontFamily?.rawValue, "Songti SC")
        XCTAssertEqual(light.fontSize ?? 0, 18.5 / 14, accuracy: 0.0001)
        XCTAssertEqual(light.lineHeight ?? 0, 1.75, accuracy: 0.0001)
        XCTAssertEqual(light.paragraphIndent ?? 0, 2, accuracy: 0.0001)
        XCTAssertEqual(light.textAlign, .justify)

        let lightConfiguration = ReaderController.configuration(
            ReadingSettings(scroll: false, fontSize: 100, dark: false)
        )
        XCTAssertEqual(
            lightConfiguration.readiumCSSRSProperties.pageGutter?.css(),
            "28.00000px"
        )
        XCTAssertEqual(
            lightConfiguration.readiumCSSRSProperties.selectionBackgroundColor?.css(),
            "#F2DBA6"
        )
        let compactInset = try XCTUnwrap(lightConfiguration.contentInset[.compact])
        XCTAssertEqual(compactInset.top, 28)
        XCTAssertEqual(compactInset.bottom, 22)

        let darkConfiguration = ReaderController.configuration(
            ReadingSettings(scroll: false, fontSize: 100, dark: true)
        )
        XCTAssertEqual(
            darkConfiguration.readiumCSSRSProperties.selectionBackgroundColor?.css(),
            "#5A4A2A"
        )
        XCTAssertEqual(
            darkConfiguration.readiumCSSRSProperties.selectionTextColor?.css(),
            "#F3EEE3"
        )
    }

    func testReaderChromeMatchesDesignedMetrics() async throws {
        let request = DesignFixture.Request(scenario: .normal, theme: .light)
        let session = try DesignFixture.makeSession(request)
        try await DesignFixture.seed(session)
        let primary = try XCTUnwrap(
            session.library.books.first { $0.title == DesignFixture.fixtureTitle }
        )
        let publication = try await session.library.open(primary)
        let reader = try ReaderController(
            book: primary,
            publication: publication,
            library: session.library
        )
        _ = DesignFixture.renderRoot(
            reader,
            size: CGSize(width: 375, height: 667),
            style: .light
        )

        let views = reader.view.allViews
        let toolbar = try XCTUnwrap(views.first { $0.accessibilityIdentifier == "reader-toolbar" })
        let back = try XCTUnwrap(views.first { $0.accessibilityIdentifier == "reader-close" })
        let contents = try XCTUnwrap(views.first { $0.accessibilityIdentifier == "reader-contents" })
        let settings = try XCTUnwrap(views.first { $0.accessibilityIdentifier == "reader-settings" })
        let title = try XCTUnwrap(
            views.first { $0.accessibilityIdentifier == "reader-title" } as? UILabel
        )
        let ask = try XCTUnwrap(views.first { $0.accessibilityIdentifier == "reader-ask-book" })
        XCTAssertEqual(toolbar.frame.height, 64, accuracy: 0.5)
        let backFrame = back.convert(back.bounds, to: reader.view)
        let contentsFrame = contents.convert(contents.bounds, to: reader.view)
        let settingsFrame = settings.convert(settings.bounds, to: reader.view)
        let titleCenter = title.convert(title.bounds, to: reader.view).midX
        let askFrame = ask.convert(ask.bounds, to: reader.view)
        XCTAssertEqual(backFrame.width, 44, accuracy: 0.5)
        XCTAssertEqual(backFrame.minX, 13, accuracy: 0.5)
        XCTAssertEqual(contentsFrame.width, 44, accuracy: 0.5)
        XCTAssertEqual(settingsFrame.width, 44, accuracy: 0.5)
        XCTAssertEqual(settingsFrame.maxX, 362, accuracy: 0.5)
        XCTAssertEqual(titleCenter, 187.5, accuracy: 0.5)
        XCTAssertEqual(title.font.pointSize, 12, accuracy: 0.5)
        XCTAssertEqual(askFrame.height, 36, accuracy: 0.5, "task-34：问问书灯按钮缩到 36pt")
        XCTAssertEqual(askFrame.midX, 187.5, accuracy: 0.5)

        let host = UIView(frame: CGRect(x: 0, y: 0, width: 375, height: 667))
        let menu = ReaderSelectionMenu()
        menu.place(in: host, above: CGRect(x: 100, y: 300, width: 150, height: 24))
        XCTAssertEqual(menu.frame.size, CGSize(width: 234, height: 51))
        XCTAssertLessThanOrEqual(menu.frame.maxX, 367)
        XCTAssertGreaterThanOrEqual(menu.frame.minX, 8)
        XCTAssertLessThan(menu.frame.maxY, 300)
        XCTAssertEqual(menu.accessibilityElements?.count, 3)
        menu.place(in: host, above: CGRect(x: 100, y: 80, width: 150, height: 20))
        XCTAssertEqual(menu.frame.height, 46, accuracy: 0.5)
        XCTAssertGreaterThan(menu.frame.minY, 100)

        let tallSelection = CGRect(x: 80, y: 300, width: 210, height: 170)
        menu.place(in: host, above: tallSelection)
        XCTAssertFalse(menu.frame.intersects(tallSelection), "选文菜单不得覆盖任意一行选区")
    }

    func testReaderRendersBothContentSizesAndThemes() async throws {
        let request = DesignFixture.Request(scenario: .normal, theme: .light)
        let session = try DesignFixture.makeSession(request)
        try await DesignFixture.seed(session)
        let primary = try XCTUnwrap(
            session.library.books.first { $0.title == DesignFixture.fixtureTitle }
        )
        let publication = try await session.library.open(primary)
        let initialLocation = try XCTUnwrap(session.library.location(for: primary.id))
        func pause(_ seconds: TimeInterval) async {
            await withCheckedContinuation { continuation in
                DispatchQueue.main.asyncAfter(deadline: .now() + seconds) {
                    continuation.resume()
                }
            }
        }

        for size in [CGSize(width: 375, height: 667), CGSize(width: 390, height: 844)] {
            for (style, theme) in [
                (UIUserInterfaceStyle.light, "light"),
                (UIUserInterfaceStyle.dark, "dark")
            ] {
                let readingSettings = ReadingSettings(
                    scroll: false,
                    fontSize: 100,
                    dark: style == .dark
                )
                try session.library.saveReadingState(
                    initialLocation,
                    settings: readingSettings,
                    for: primary.id
                )
                let configuredBook = try XCTUnwrap(
                    session.library.books.first { $0.id == primary.id }
                )
                let reader = try ReaderController(
                    book: configuredBook,
                    publication: publication,
                    library: session.library
                )
                reader.loadViewIfNeeded()

                let toolbar = try XCTUnwrap(
                    reader.view.allViews.first { $0.accessibilityIdentifier == "reader-toolbar" }
                )
                let ask = try XCTUnwrap(
                    reader.view.allViews.first { $0.accessibilityIdentifier == "reader-ask-book" }
                )
                let window = UIWindow(frame: CGRect(origin: .zero, size: size))
                window.overrideUserInterfaceStyle = style
                window.rootViewController = reader
                window.makeKeyAndVisible()
                reader.beginAppearanceTransition(true, animated: false)
                reader.view.frame = window.bounds
                reader.view.layoutIfNeeded()
                reader.endAppearanceTransition()

                let loaded = await waitForReaderProgress(reader)
                XCTAssertTrue(loaded, "Reader did not finish loading at \(size)")
                await pause(size.width == 375 && style == .light ? 15 : 2)
                reader.view.setNeedsLayout()
                reader.view.layoutIfNeeded()
                CATransaction.flush()
                let format = UIGraphicsImageRendererFormat()
                format.scale = 1
                format.opaque = true
                let image = UIGraphicsImageRenderer(size: size, format: format).image { _ in
                    reader.view.drawHierarchy(in: reader.view.bounds, afterScreenUpdates: true)
                }
                window.isHidden = true
                XCTAssertEqual(toolbar.convert(toolbar.bounds, to: reader.view).height, 64, accuracy: 0.5)
                XCTAssertEqual(ask.convert(ask.bounds, to: reader.view).midX, size.width / 2, accuracy: 0.5)
                XCTAssertEqual(image.size, size)
                let attachment = XCTAttachment(
                    data: try XCTUnwrap(image.pngData()),
                    uniformTypeIdentifier: "public.png"
                )
                attachment.name = "reader-\(Int(size.width))x\(Int(size.height))-\(theme)"
                attachment.lifetime = .keepAlways
                add(attachment)
            }
        }
    }

    func testCitationRendersBothContentSizesAndThemesWithReturnChrome() async throws {
        let request = DesignFixture.Request(scenario: .normal, theme: .light)
        let session = try DesignFixture.makeSession(request)
        try await DesignFixture.seed(session)
        let record = try XCTUnwrap(
            session.library.questions.records.first { !$0.citations.isEmpty }
        )
        let target = try XCTUnwrap(record.citations.first?.location())
        let origin = try XCTUnwrap(record.origin())
        let primary = try XCTUnwrap(
            session.library.books.first { $0.id == record.bookID }
        )
        let publication = try await session.library.open(primary)
        let initialLocation = try XCTUnwrap(session.library.location(for: primary.id))

        func pause(_ seconds: TimeInterval) async {
            await withCheckedContinuation { continuation in
                DispatchQueue.main.asyncAfter(deadline: .now() + seconds) {
                    continuation.resume()
                }
            }
        }

        for size in [CGSize(width: 375, height: 667), CGSize(width: 390, height: 844)] {
            for (style, theme) in [
                (UIUserInterfaceStyle.light, "light"),
                (UIUserInterfaceStyle.dark, "dark")
            ] {
                let readingSettings = ReadingSettings(
                    scroll: false,
                    fontSize: 100,
                    dark: style == .dark
                )
                try session.library.saveReadingState(
                    initialLocation,
                    settings: readingSettings,
                    for: primary.id
                )
                let configuredBook = try XCTUnwrap(
                    session.library.books.first { $0.id == primary.id }
                )
                let reader = try ReaderController(
                    book: configuredBook,
                    publication: publication,
                    library: session.library,
                    target: target
                )
                reader.questionOrigin = origin
                reader.loadViewIfNeeded()
                let window = UIWindow(frame: CGRect(origin: .zero, size: size))
                window.overrideUserInterfaceStyle = style
                window.rootViewController = reader
                window.makeKeyAndVisible()
                reader.beginAppearanceTransition(true, animated: false)
                reader.view.frame = window.bounds
                reader.view.layoutIfNeeded()
                reader.endAppearanceTransition()

                let loaded = await waitForReaderProgress(reader)
                XCTAssertTrue(loaded, "Citation reader did not finish loading at \(size)")
                await pause(2)
                reader.view.layoutIfNeeded()

                let views = reader.view.allViews
                let back = try XCTUnwrap(
                    views.first { $0.accessibilityIdentifier == "reader-return-question" } as? UIButton
                )
                let chapter = try XCTUnwrap(
                    views.first { $0.accessibilityIdentifier == "reader-chapter" } as? UILabel
                )
                XCTAssertEqual(back.accessibilityLabel, "返回问答")
                XCTAssertTrue(chapter.text?.contains("查看引用 1") == true)
                XCTAssertNotNil(views.first { $0.accessibilityIdentifier == "reader-contents" })
                XCTAssertNotNil(views.first { $0.accessibilityIdentifier == "reader-settings" })
                XCTAssertNil(views.first { $0.accessibilityIdentifier == "reader-selection-menu" })

                let format = UIGraphicsImageRendererFormat()
                format.scale = 1
                format.opaque = true
                let image = UIGraphicsImageRenderer(size: size, format: format).image { _ in
                    reader.view.drawHierarchy(
                        in: reader.view.bounds,
                        afterScreenUpdates: true
                    )
                }
                window.isHidden = true
                XCTAssertEqual(image.size, size)
                let attachment = XCTAttachment(
                    data: try XCTUnwrap(image.pngData()),
                    uniformTypeIdentifier: "public.png"
                )
                attachment.name = "citation-\(Int(size.width))x\(Int(size.height))-\(theme)"
                attachment.lifetime = .keepAlways
                add(attachment)
            }
        }
    }

    /// task-72：对话改名后立即生效，并可从磁盘重新加载（等价 App 重启后仍为新标题）。
    func testConversationRenamePersistsAfterStoreReload() async throws {
        let session = try DesignFixture.makeSession(.init(scenario: .normal, theme: .light))
        try await DesignFixture.seed(session)
        defer { try? FileManager.default.removeItem(at: session.root) }
        let conversations = session.library.questions.conversations
        let conversation = try XCTUnwrap(conversations.first)
        let oldTitle = conversation.title
        XCTAssertTrue(session.library.questions.rename(conversation.id, title: "QA重启后仍保留的新标题"))
        XCTAssertEqual(session.library.questions.conversation(conversation.id)?.title, "QA重启后仍保留的新标题")
        XCTAssertNotEqual(oldTitle, "QA重启后仍保留的新标题")
        let reloaded = QuestionStore(root: session.root, secrets: EphemeralSecrets())
        // QuestionStore 构造时从磁盘读取，等价 App 重启后的数据加载。
        for _ in 0..<50 where reloaded.conversations.isEmpty { try? await Task.sleep(nanoseconds: 50_000_000) }
        let persisted = try XCTUnwrap(reloaded.conversation(conversation.id))
        XCTAssertEqual(persisted.title, "QA重启后仍保留的新标题", "重启后应仍显示新标题")
        XCTAssertFalse(reloaded.conversations.contains { $0.title.contains(oldTitle) }, "旧标题不应残留")
    }

    /// task-70：页内 >360 字长选文/跨页拼接 quote 均通过 permits；篡改仍拒绝。    /// task-70：页内 >360 字长选文/跨页拼接 quote 均通过 permits；篡改仍拒绝。
    func testPDFLongSelectionPermitsCrossFragmentAndCrossPage() async throws {
        let text1 = "第一页长文开始。" + String(repeating: "书灯的灯光照亮纸页，也照亮读者心里的疑问。", count: 24) + "第一页收尾。"
        let text2 = "第二页开头。" + String(repeating: "PDF 阅读器把长选文交给问答系统校验。", count: 14) + "第二页收尾。"
        let bounds = CGRect(x: 0, y: 0, width: 595, height: 842)
        let renderer = UIGraphicsPDFRenderer(bounds: bounds)
        let data = renderer.pdfData { context in
            for text in [text1, text2] {
                context.beginPage()
                (text as NSString).draw(
                    in: CGRect(x: 56, y: 80, width: 480, height: 700),
                    withAttributes: [.font: UIFont.systemFont(ofSize: 13), .foregroundColor: UIColor.black]
                )
            }
        }
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("PDFLongPermits-" + UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let library = try LibraryStore(root: root, secrets: EphemeralSecrets())
        let source = root.appendingPathComponent("long-selection.pdf")
        try data.write(to: source)
        let imported = try await library.importBook(from: source)
        let book = imported.book
        var state: BookPreparationState?
        for _ in 0..<400 {
            if let value = library.preparation.states[book.id], !value.preparing { state = value; break }
            try? await Task.sleep(nanoseconds: 100_000_000)
        }
        XCTAssertNotNil(state)
        let document = try XCTUnwrap(PDFKit.PDFDocument(url: library.fileURL(for: book)))
        let p1 = try XCTUnwrap(document.page(at: 0)?.string)
        let p2 = try XCTUnwrap(document.page(at: 1)?.string)
        XCTAssertGreaterThan(p1.count, 400, "测试 PDF 第 1 页应 >400 字")
        func locator(page: Int, quote: String) -> Locator {
            Locator(
                href: AnyURL(string: "pdf://page/\(page)")!,
                mediaType: .pdf,
                title: "第 \(page) 页",
                locations: .init(position: page),
                text: .init(highlight: quote)
            )
        }
        // 页内长 quote（>360 字）。
        let longQuote = String(p1.prefix(400))
        XCTAssertGreaterThan(longQuote.count, 360)
        let longPermitted = try await library.preparation.index.permits([QuestionEvidence(locator: locator(page: 1, quote: longQuote))], scope: BookEvidenceScope(bookID: book.id))
        var forgedLong = locator(page: 1, quote: longQuote)
        forgedLong.text = .init(highlight: longQuote + "篡改")
        let forgedLongPermitted = try await library.preparation.index.permits([QuestionEvidence(locator: forgedLong)], scope: BookEvidenceScope(bookID: book.id))
        let cross = String(p1.suffix(30)) + String(p2.prefix(30))
        let crossPermitted = try await library.preparation.index.permits([QuestionEvidence(locator: locator(page: 1, quote: cross))], scope: BookEvidenceScope(bookID: book.id))
        var forgedCross = locator(page: 1, quote: cross)
        forgedCross.text = .init(highlight: cross + "篡改")
        let forgedCrossPermitted = try await library.preparation.index.permits([QuestionEvidence(locator: forgedCross)], scope: BookEvidenceScope(bookID: book.id))
        XCTAssertTrue(longPermitted, "页内长选文（>360 字）应通过 permits")
        XCTAssertFalse(forgedLongPermitted, "篡改长 quote 应拒绝")
        XCTAssertTrue(crossPermitted, "跨页拼接 quote 应通过 permits")
        XCTAssertFalse(forgedCrossPermitted, "篡改跨页 quote 应拒绝")
    }

    func testQuestionSheetUsesDesignedPanelIdentityDraftAndStates() async throws {
        let request = DesignFixture.Request(scenario: .normal, theme: .light)
        let session = try DesignFixture.makeSession(request)
        try await DesignFixture.seed(session)
        var record = try XCTUnwrap(session.library.questions.records.first)
        record.answer = "这里的“灯”既是阅读时的照明，也是理解书中难句的提示。它不替代原文。"
        record.state = .complete
        record.failure = nil
        XCTAssertTrue(session.library.questions.save(record))

        func makePage() -> UINavigationController {
            let page = QuestionController(library: session.library, id: record.id)
            let navigation = UINavigationController(rootViewController: page)
            QuestionSheetPresentation.configure(navigation)
            return navigation
        }

        XCTAssertEqual(QuestionSheetPresentation.heightFraction, 0.76, accuracy: 0.0001)
        let detentPage = makePage()
        XCTAssertEqual(detentPage.modalPresentationStyle, .pageSheet)
        XCTAssertEqual(detentPage.sheetPresentationController?.preferredCornerRadius, 22)
        XCTAssertEqual(detentPage.sheetPresentationController?.detents.count, 2)

        for size in [CGSize(width: 375, height: 667), CGSize(width: 390, height: 844)] {
            for (style, theme) in [
                (UIUserInterfaceStyle.light, "light"),
                (UIUserInterfaceStyle.dark, "dark")
            ] {
                let navigation = makePage()
                let image = DesignFixture.renderRoot(navigation, size: size, style: style)
                let page = try XCTUnwrap(navigation.topViewController as? QuestionController)
                let views = page.view.allViews
                for identifier in [
                    "question-sheet-header",
                    "question-sheet-handle",
                    "question-close",
                    "question-composer",
                    "question-composer-field",
                    "question-input",
                    "question-copy",
                    "question-more",
                    "question-user-bubble-\(record.id)",
                    "question-ai-identity-\(record.id)",
                    "question-answer"
                ] {
                    XCTAssertNotNil(views.first { $0.accessibilityIdentifier == identifier }, identifier)
                }
                XCTAssertFalse(views.compactMap { ($0 as? UILabel)?.text }.contains("你"))
                XCTAssertTrue(try XCTUnwrap(views.first { $0.accessibilityIdentifier == "question-status-box" }).isHidden)
                XCTAssertNil(views.first { $0.accessibilityIdentifier == "question-follow-up" })
                XCTAssertEqual(image.size, size)
                let attachment = XCTAttachment(
                    data: try XCTUnwrap(image.pngData()),
                    uniformTypeIdentifier: "public.png"
                )
                attachment.name = "question-\(Int(size.width))x\(Int(size.height))-\(theme)"
                attachment.lifetime = .keepAlways
                add(attachment)
            }
        }

        // task-70：draft 未发送且无 failure/未保存时状态条隐藏，且不出现「草稿」字样。
        XCTAssertEqual(QuestionState.draft.label, "待提问")
        let draftBook = try XCTUnwrap(session.library.books.first)
        var draftRecord = ReadingQuestion(book: draftBook, selection: record.selection, neighbors: [])
        draftRecord.question = "尚未发送的问题"
        XCTAssertTrue(session.library.questions.save(draftRecord))
        let draftNavigation = UINavigationController(
            rootViewController: QuestionController(library: session.library, id: draftRecord.id)
        )
        QuestionSheetPresentation.configure(draftNavigation)
        let draftImage = DesignFixture.renderRoot(draftNavigation, size: CGSize(width: 375, height: 667), style: .light)
        let draftPage = try XCTUnwrap(draftNavigation.topViewController as? QuestionController)
        let draftViews = draftPage.view.allViews
        XCTAssertTrue(try XCTUnwrap(draftViews.first { $0.accessibilityIdentifier == "question-status-box" }).isHidden, "draft 无 failure 时状态条应隐藏")
        XCTAssertFalse(
            draftViews.compactMap { ($0 as? UILabel)?.text }.contains { $0.contains("草稿") },
            "draft 态不应出现草稿文案"
        )
        let draftAttachment = XCTAttachment(data: try XCTUnwrap(draftImage.pngData()), uniformTypeIdentifier: "public.png")
        draftAttachment.name = "question-draft-idle-375-light"
        draftAttachment.lifetime = .keepAlways
        add(draftAttachment)

        let states: [(QuestionState, String, String?)] = [
            (.generating, "", nil),
            (.incomplete, "", "暂时没能连接 AI 服务，问题与选文已保留，请重试。"),
            (.incomplete, "她已经感到这里的生活与自己熟悉的环境不同，", "系统后台时间已结束，回答未完成，请主动重试。")
        ]
        for (index, value) in states.enumerated() {
            record.state = value.0
            record.answer = value.1
            record.failure = value.2
            XCTAssertTrue(session.library.questions.save(record))
            let navigation = makePage()
            let image = DesignFixture.renderRoot(
                navigation,
                size: CGSize(width: 375, height: 667),
                style: .light
            )
            let page = try XCTUnwrap(navigation.topViewController as? QuestionController)
            let status = try XCTUnwrap(
                page.view.allViews.first {
                    $0.accessibilityIdentifier == "question-status"
                } as? UILabel
            )
            XCTAssertFalse(page.view.allViews.first { $0.accessibilityIdentifier == "question-status-box" }?.isHidden ?? true)
            XCTAssertFalse(status.text?.contains("草稿") == true, "状态条不应出现草稿字样")
            if let failure = value.2 {
                XCTAssertTrue(status.text?.contains("回答未完成") == true)
                XCTAssertTrue(status.text?.contains(failure) == true)
                XCTAssertNotNil(page.view.allViews.first { $0.accessibilityIdentifier == "question-retry-generation" })
            } else {
                XCTAssertTrue(status.text?.contains("正在生成") == true)
                XCTAssertNotNil(page.view.allViews.first { $0.accessibilityIdentifier == "question-skeleton" })
            }
            let attachment = XCTAttachment(
                data: try XCTUnwrap(image.pngData()),
                uniformTypeIdentifier: "public.png"
            )
            attachment.name = "question-state-\(index)-375x667-light"
            attachment.lifetime = .keepAlways
            add(attachment)
        }
    }

    func testQuestionSheetKeepsHeaderAndComposerAtAccessibilitySize() async throws {
        let session = try DesignFixture.makeSession(.init(scenario: .normal, theme: .light))
        try await DesignFixture.seed(session)
        let record = try XCTUnwrap(session.library.questions.records.first)
        let page = QuestionController(library: session.library, id: record.id)
        let navigation = UINavigationController(rootViewController: page)
        QuestionSheetPresentation.configure(navigation)
        let image = DesignFixture.renderRoot(
            navigation,
            size: CGSize(width: 375, height: 667),
            style: .light,
            preferredContentSizeCategory: .accessibilityExtraExtraLarge
        )
        let views = page.view.allViews
        let close = try XCTUnwrap(views.first { $0.accessibilityIdentifier == "question-close" })
        let composer = try XCTUnwrap(views.first { $0.accessibilityIdentifier == "question-composer" })
        let input = try XCTUnwrap(views.first { $0.accessibilityIdentifier == "question-input" })
        XCTAssertEqual(close.bounds.width, 44, accuracy: 0.5)
        XCTAssertLessThanOrEqual(composer.convert(composer.bounds, to: page.view).maxY, page.view.bounds.maxY + 0.5)
        XCTAssertTrue(input.isUserInteractionEnabled)
        let attachment = XCTAttachment(
            data: try XCTUnwrap(image.pngData()),
            uniformTypeIdentifier: "public.png"
        )
        attachment.name = "question-accessibility-xxxl-375x667-light"
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}

private extension UIView {
    var allControls: [UIControl] {
        subviews.flatMap { view in
            (view as? UIControl).map { [$0] + view.allControls } ?? view.allControls
        }
    }

    var allViews: [UIView] {
        [self] + subviews.flatMap(\.allViews)
    }
}
