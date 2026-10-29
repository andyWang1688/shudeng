import XCTest
import UIKit
import ReadiumNavigator
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
        let title = try XCTUnwrap(
            views.first { $0.accessibilityIdentifier == "profile-title" }
        )
        XCTAssertEqual((title as? UILabel)?.text, "我的")
        let titleFrame = root.view.convert(title.bounds, from: title)
        // v2 品牌区作为系统列表首项，标题左边距为页面 24pt 屏边距。
        XCTAssertLessThanOrEqual(titleFrame.minX, 32)
        XCTAssertGreaterThanOrEqual(titleFrame.minX, 8)
        let icon = try XCTUnwrap(
            views.first { $0.accessibilityIdentifier == "profile-brand-icon" }
        )
        XCTAssertEqual(icon.bounds.width, 56, accuracy: 0.5)
        XCTAssertEqual(icon.bounds.height, 56, accuracy: 0.5)
        let iconFrame = root.view.convert(icon.bounds, from: icon)
        XCTAssertEqual(iconFrame.midX, root.view.bounds.midX, accuracy: 0.5)
        let wordmark = try XCTUnwrap(
            views.first { $0.accessibilityIdentifier == "profile-wordmark" }
        )
        let wordmarkFrame = root.view.convert(wordmark.bounds, from: wordmark)
        XCTAssertEqual(wordmarkFrame.midX, root.view.bounds.midX, accuracy: 0.5)
        let motto = try XCTUnwrap(
            views.first { $0.accessibilityIdentifier == "profile-motto" }
        )
        let mottoFrame = root.view.convert(motto.bounds, from: motto)
        XCTAssertEqual(mottoFrame.midX, root.view.bounds.midX, accuracy: 0.5)

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
        // XXXL 下列表内容超出一屏：先断言首屏品牌区，再滚到底断言设置行（系统列表只实例化可见 cell）。
        let accessibleViews = accessible.view.allViews
        for identifier in ["profile-title", "profile-brand-icon"] {
            let view = try XCTUnwrap(
                accessibleViews.first { $0.accessibilityIdentifier == identifier },
                identifier
            )
            XCTAssertGreaterThan(view.bounds.height, 0)
            XCTAssertLessThanOrEqual(view.frame.maxX, 375.5)
        }
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
