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

        XCTAssertEqual(root.tabBar.frame.height, 81)
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
        for identifier in ["brand-wordmark", "page-title", "library-import", "tab-library", "tab-profile"] {
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

    func testNotesPageUsesDesignedHeaderGroupingAndFourFilters() async throws {
        let request = DesignFixture.Request(scenario: .normal, theme: .light)
        let session = try DesignFixture.makeSession(request)
        try await DesignFixture.seed(session)
        let root = makeApplicationTabs(library: session.library, root: session.root, secrets: session.secrets)
        root.select(RootDestination.notes.rawValue)
        root.loadViewIfNeeded()
        root.view.frame = CGRect(x: 0, y: 0, width: 375, height: 667)
        root.view.layoutIfNeeded()

        let views = root.view.allViews
        for identifier in [
            "notes-title",
            "notes-description",
            "notes-export",
            "note-filter-all",
            "note-filter-highlights",
            "note-filter-notes",
            "note-filter-bookmarks"
        ] {
            XCTAssertNotNil(views.first { $0.accessibilityIdentifier == identifier }, identifier)
        }
        let table = try XCTUnwrap(
            views.compactMap { $0 as? UITableView }.first { $0.accessibilityIdentifier == "notes" }
        )
        XCTAssertEqual(table.numberOfSections, 1)
        XCTAssertEqual(table.numberOfRows(inSection: 0), 3)
        XCTAssertTrue(
            views.contains { view in
                view.accessibilityIdentifier?.hasPrefix("notes-book-") == true
            }
        )
        let primary = try XCTUnwrap(session.library.books.first { $0.title == DesignFixture.fixtureTitle })
        let note = try XCTUnwrap(primary.notes?.first)
        let bookmark = try XCTUnwrap(primary.bookmarks?.first)
        XCTAssertNotNil(
            session.library.recordTimestamp(kind: .note, bookID: primary.id, recordID: note.id)
        )
        XCTAssertNotNil(
            session.library.recordTimestamp(kind: .bookmark, bookID: primary.id, recordID: bookmark.id)
        )
        let catalog = try String(
            contentsOf: session.root.appendingPathComponent("library.json"),
            encoding: .utf8
        )
        XCTAssertFalse(catalog.contains("recordTimestamp"))
        XCTAssertFalse(catalog.contains("createdAt"))

        let expectedRows = [
            "note-filter-all": 3,
            "note-filter-highlights": 1,
            "note-filter-notes": 1,
            "note-filter-bookmarks": 1
        ]
        for (identifier, count) in expectedRows {
            let button = try XCTUnwrap(
                views.compactMap { $0 as? UIControl }.first { $0.accessibilityIdentifier == identifier },
                identifier
            )
            button.sendActions(for: .touchUpInside)
            XCTAssertEqual(table.numberOfRows(inSection: 0), count, identifier)
        }

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
    }

    func testNotesEmptyStateOffersAReadableNextAction() async throws {
        let request = DesignFixture.Request(scenario: .empty, theme: .light)
        let session = try DesignFixture.makeSession(request)
        try await DesignFixture.seed(session)
        let root = makeApplicationTabs(library: session.library, root: session.root, secrets: session.secrets)
        root.select(RootDestination.notes.rawValue)
        root.loadViewIfNeeded()
        root.view.frame = CGRect(x: 0, y: 0, width: 375, height: 667)
        root.view.layoutIfNeeded()

        let views = root.view.allViews
        let table = try XCTUnwrap(
            views.compactMap { $0 as? UITableView }.first { $0.accessibilityIdentifier == "notes" }
        )
        let empty = try XCTUnwrap(table.backgroundView)
        XCTAssertEqual(empty.accessibilityIdentifier, "notes-empty")
        XCTAssertNotNil(empty.allViews.first { $0.accessibilityIdentifier == "notes-empty-title" })
        XCTAssertNotNil(empty.allViews.first { $0.accessibilityIdentifier == "notes-empty-detail" })
        XCTAssertNotNil(empty.allViews.first { $0.accessibilityIdentifier == "notes-empty-action" })

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
        root.loadViewIfNeeded()
        root.view.frame = CGRect(x: 0, y: 0, width: 375, height: 667)
        root.view.layoutIfNeeded()

        let views = root.view.allViews
        for identifier in [
            "conversations-title",
            "conversations-description",
            "conversation-search",
            "tab-conversations"
        ] {
            XCTAssertNotNil(views.first { $0.accessibilityIdentifier == identifier }, identifier)
        }
        let table = try XCTUnwrap(
            views.compactMap { $0 as? UITableView }.first { $0.accessibilityIdentifier == "question-history" }
        )
        XCTAssertEqual(table.numberOfSections, 1)
        XCTAssertEqual(table.numberOfRows(inSection: 0), 2)
        XCTAssertTrue(
            views.contains { $0.accessibilityIdentifier?.hasPrefix("conversations-book-") == true }
        )

        table.layoutIfNeeded()
        let labels = table.visibleCells.compactMap(\.accessibilityLabel).joined(separator: "\n")
        XCTAssertTrue(labels.contains(DesignFixture.conversationTitle))
        XCTAssertTrue(labels.contains("次提问"))
        XCTAssertTrue(labels.contains("这里的“灯”既是阅读时的照明"))
        let actions = table.delegate?.tableView?(
            table,
            trailingSwipeActionsConfigurationForRowAt: IndexPath(row: 0, section: 0)
        )
        XCTAssertEqual(Set(actions?.actions.compactMap(\.title) ?? []), Set(["改名", "删除"]))

        let search = try XCTUnwrap(
            views.compactMap { $0 as? UITextField }.first { $0.accessibilityIdentifier == "conversation-search" }
        )
        search.text = "第一次进贾府"
        search.sendActions(for: .editingChanged)
        XCTAssertEqual(table.numberOfRows(inSection: 0), 1)
        XCTAssertTrue(
            table.visibleCells.compactMap(\.accessibilityLabel).joined().contains("林黛玉第一次进贾府时看到了什么")
        )

        search.text = "不存在的对话"
        search.sendActions(for: .editingChanged)
        XCTAssertEqual(table.numberOfSections, 0)
        let searchEmpty = try XCTUnwrap(table.backgroundView)
        XCTAssertEqual(searchEmpty.accessibilityIdentifier, "conversations-search-empty")
        let clearSearch = try XCTUnwrap(
            searchEmpty.allViews.compactMap { $0 as? UIControl }
                .first { $0.accessibilityIdentifier == "conversations-search-empty-action" }
        )
        clearSearch.sendActions(for: .touchUpInside)
        XCTAssertEqual(search.text, "")
        XCTAssertEqual(table.numberOfRows(inSection: 0), 2)

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
        emptyRoot.loadViewIfNeeded()
        emptyRoot.view.frame = CGRect(x: 0, y: 0, width: 375, height: 667)
        emptyRoot.view.layoutIfNeeded()

        let emptyTable = try XCTUnwrap(
            emptyRoot.view.allViews.compactMap { $0 as? UITableView }
                .first { $0.accessibilityIdentifier == "question-history" }
        )
        let empty = try XCTUnwrap(emptyTable.backgroundView)
        XCTAssertEqual(empty.accessibilityIdentifier, "conversations-empty")
        let emptyAction = try XCTUnwrap(
            empty.allViews.compactMap { $0 as? UIControl }
                .first { $0.accessibilityIdentifier == "conversations-empty-action" }
        )
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
        emptyAction.sendActions(for: .touchUpInside)
        XCTAssertEqual(emptyRoot.selectedIndex, RootDestination.library.rawValue)

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
        failedRoot.loadViewIfNeeded()
        failedRoot.view.frame = CGRect(x: 0, y: 0, width: 375, height: 667)
        failedRoot.view.layoutIfNeeded()

        let failedTable = try XCTUnwrap(
            failedRoot.view.allViews.compactMap { $0 as? UITableView }
                .first { $0.accessibilityIdentifier == "question-history" }
        )
        let failed = try XCTUnwrap(failedTable.backgroundView)
        XCTAssertEqual(failed.accessibilityIdentifier, "conversations-failed")
        let retry = try XCTUnwrap(
            failed.allViews.compactMap { $0 as? UIControl }
                .first { $0.accessibilityIdentifier == "conversations-failed-action" }
        )
        XCTAssertNotEqual(empty.accessibilityIdentifier, failed.accessibilityIdentifier)
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
        retry.sendActions(for: .touchUpInside)
        XCTAssertEqual(
            try XCTUnwrap(failedTable.backgroundView).accessibilityIdentifier,
            "conversations-failed"
        )
    }

    func testBookGroupsCollapseAndPersistIndependentlyAcrossTabsAndReopening() async throws {
        let fixture = try await makeBookGroupFixture()
        defer { try? FileManager.default.removeItem(at: fixture.library.root) }
        let root = makeApplicationTabs(library: fixture.library, root: fixture.library.root, secrets: fixture.library.secrets)
        root.select(RootDestination.notes.rawValue)
        _ = DesignFixture.renderRoot(root, size: CGSize(width: 375, height: 667), style: .light)
        let notesNavigation = try XCTUnwrap(root.viewControllers[RootDestination.notes.rawValue] as? UINavigationController)
        let notes = try XCTUnwrap(notesNavigation.topViewController as? NotesController)
        let primary = try bookGroup(in: notes, bookID: fixture.primaryID, prefix: "notes-book")
        let secondary = try bookGroup(in: notes, bookID: fixture.secondaryID, prefix: "notes-book")
        XCTAssertEqual(notes.tableView.numberOfRows(inSection: primary.section), 0)
        XCTAssertEqual(notes.tableView.numberOfRows(inSection: secondary.section), 3, "Newest notes expand even when the book is not first in the catalogue")
        XCTAssertEqual(secondary.header.accessibilityValue, "已展开")
        XCTAssertTrue(secondary.header.accessibilityLabel?.contains("3 条记录") == true)
        secondary.header.sendActions(for: .touchUpInside)
        XCTAssertEqual(notes.tableView.numberOfRows(inSection: secondary.section), 0)
        XCTAssertNil(notes.tableView.backgroundView, "Collapsed records are not an empty library")
        let collapsed = try bookGroup(in: notes, bookID: fixture.secondaryID, prefix: "notes-book")
        XCTAssertEqual(collapsed.header.accessibilityValue, "已收起")
        XCTAssertTrue(primary.header.accessibilityActivate())
        XCTAssertEqual(notes.tableView.numberOfRows(inSection: primary.section), 4)
        let cell = notes.tableView(notes.tableView, cellForRowAt: IndexPath(row: 0, section: primary.section))
        XCTAssertNotNil(cell.allControls.first { $0.accessibilityIdentifier?.hasPrefix("return-") == true })

        root.select(RootDestination.conversations.rawValue)
        root.view.layoutIfNeeded()
        let historyNavigation = try XCTUnwrap(root.viewControllers[RootDestination.conversations.rawValue] as? UINavigationController)
        let history = try XCTUnwrap(historyNavigation.topViewController as? QuestionHistoryController)
        let conversationGroup = try bookGroup(in: history, bookID: fixture.primaryID, prefix: "conversations-book")
        XCTAssertEqual(history.tableView.numberOfRows(inSection: conversationGroup.section), 2)
        conversationGroup.header.sendActions(for: .touchUpInside)
        XCTAssertEqual(history.tableView.numberOfRows(inSection: conversationGroup.section), 0)
        root.select(RootDestination.notes.rawValue)
        notes.viewWillAppear(false)
        XCTAssertEqual(notes.tableView.numberOfRows(inSection: primary.section), 4)
        XCTAssertEqual(notes.tableView.numberOfRows(inSection: secondary.section), 0)

        let reopenedLibrary = try LibraryStore(root: fixture.library.root, secrets: fixture.library.secrets)
        let reopenedNotes = NotesController(library: reopenedLibrary)
        reopenedNotes.loadViewIfNeeded()
        let reopenedPrimary = try bookGroup(in: reopenedNotes, bookID: fixture.primaryID, prefix: "notes-book")
        let reopenedSecondary = try bookGroup(in: reopenedNotes, bookID: fixture.secondaryID, prefix: "notes-book")
        XCTAssertEqual(reopenedNotes.tableView.numberOfRows(inSection: reopenedPrimary.section), 4)
        XCTAssertEqual(reopenedNotes.tableView.numberOfRows(inSection: reopenedSecondary.section), 0)
        let reopenedHistory = QuestionHistoryController(library: reopenedLibrary)
        reopenedHistory.loadViewIfNeeded()
        XCTAssertEqual(reopenedHistory.tableView.numberOfSections, 2)
        XCTAssertTrue((0..<2).allSatisfy { reopenedHistory.tableView.numberOfRows(inSection: $0) == 0 })
        let reopenedConversation = try bookGroup(in: reopenedHistory, bookID: fixture.primaryID, prefix: "conversations-book")
        reopenedConversation.header.sendActions(for: .touchUpInside)
        XCTAssertEqual(reopenedHistory.tableView.numberOfRows(inSection: reopenedConversation.section), 2)
        let actions = reopenedHistory.tableView(reopenedHistory.tableView, trailingSwipeActionsConfigurationForRowAt: IndexPath(row: 0, section: reopenedConversation.section))
        XCTAssertEqual(Set(actions?.actions.compactMap(\.title) ?? []), ["改名", "删除"])
    }

    func testBookGroupSearchExpandsMatchesWithoutOverwritingSavedCollapseOrLosingFilteredNotes() async throws {
        let fixture = try await makeBookGroupFixture()
        defer { try? FileManager.default.removeItem(at: fixture.library.root) }
        let notes = NotesController(library: fixture.library)
        _ = DesignFixture.renderRoot(notes, size: CGSize(width: 375, height: 667), style: .light)
        let secondary = try bookGroup(in: notes, bookID: fixture.secondaryID, prefix: "notes-book")
        secondary.header.sendActions(for: .touchUpInside)
        let search = try XCTUnwrap(notes.view.allViews.first { $0.accessibilityIdentifier == "notes-search" } as? UITextField)
        search.text = "分组命中"
        search.sendActions(for: .editingChanged)
        XCTAssertEqual(notes.tableView.numberOfSections, 2)
        XCTAssertEqual((0..<2).reduce(0) { $0 + notes.tableView.numberOfRows(inSection: $1) }, 4)
        let matched = try bookGroup(in: notes, bookID: fixture.secondaryID, prefix: "notes-book")
        matched.header.sendActions(for: .touchUpInside)
        XCTAssertEqual(notes.tableView.numberOfRows(inSection: matched.section), 3, "Search results cannot be hidden by collapse")
        for (identifier, expected) in [("note-filter-notes", 2), ("note-filter-highlights", 1), ("note-filter-bookmarks", 1), ("note-filter-all", 4)] {
            let control = try XCTUnwrap(notes.view.allControls.first { $0.accessibilityIdentifier == identifier })
            control.sendActions(for: .touchUpInside)
            XCTAssertEqual((0..<notes.tableView.numberOfSections).reduce(0) { $0 + notes.tableView.numberOfRows(inSection: $1) }, expected, identifier)
        }
        search.text = "   "
        search.sendActions(for: .editingChanged)
        XCTAssertTrue((0..<2).allSatisfy { notes.tableView.numberOfRows(inSection: $0) == 0 })

        let history = QuestionHistoryController(library: fixture.library)
        history.loadViewIfNeeded()
        let primary = try bookGroup(in: history, bookID: fixture.primaryID, prefix: "conversations-book")
        primary.header.sendActions(for: .touchUpInside)
        let conversationSearch = try XCTUnwrap(history.view.allViews.first { $0.accessibilityIdentifier == "conversation-search" } as? UITextField)
        conversationSearch.text = "分组命中"
        conversationSearch.sendActions(for: .editingChanged)
        XCTAssertEqual(history.tableView.numberOfSections, 1)
        XCTAssertEqual(history.tableView.numberOfRows(inSection: 0), 1)
        XCTAssertEqual(try bookGroup(in: history, bookID: fixture.secondaryID, prefix: "conversations-book").header.accessibilityValue, "已展开")
        conversationSearch.text = "不存在的分组"
        conversationSearch.sendActions(for: .editingChanged)
        XCTAssertEqual(history.tableView.numberOfSections, 0)
        XCTAssertNotNil(history.tableView.backgroundView)
        conversationSearch.text = ""
        conversationSearch.sendActions(for: .editingChanged)
        XCTAssertEqual(history.tableView.numberOfSections, 2)
        XCTAssertTrue((0..<2).allSatisfy { history.tableView.numberOfRows(inSection: $0) == 0 })
        let reopened = QuestionHistoryController(library: try LibraryStore(root: fixture.library.root, secrets: fixture.library.secrets))
        reopened.loadViewIfNeeded()
        XCTAssertTrue((0..<2).allSatisfy { reopened.tableView.numberOfRows(inSection: $0) == 0 })
    }

    func testBookGroupScrollPositionsRestoreSeparatelyAfterReopening() async throws {
        let fixture = try await makeBookGroupFixture()
        defer { try? FileManager.default.removeItem(at: fixture.library.root) }
        for (page, offset) in [("notes", CGFloat(60)), ("conversations", CGFloat(40))] {
            func makeController() -> UITableViewController {
                page == "notes" ? NotesController(library: fixture.library) : QuestionHistoryController(library: fixture.library)
            }
            let controller = makeController()
            _ = DesignFixture.renderRoot(controller, size: CGSize(width: 375, height: 300), style: .light)
            controller.tableView.setContentOffset(CGPoint(x: 0, y: offset), animated: false)
            controller.tableView.delegate?.scrollViewDidEndDragging?(controller.tableView, willDecelerate: false)
            controller.viewWillDisappear(false)
            let reopened = makeController()
            _ = DesignFixture.renderRoot(reopened, size: CGSize(width: 375, height: 300), style: .light)
            XCTAssertEqual(reopened.tableView.contentOffset.y, offset, accuracy: 1, page)
        }
    }

    func testBookGroupHeadersFitSmallScreenAndAccessibilitySizesInBothThemes() async throws {
        let fixture = try await makeBookGroupFixture()
        defer { try? FileManager.default.removeItem(at: fixture.library.root) }
        for (page, prefix) in [("notes", "notes-book"), ("conversations", "conversations-book")] {
            for style in [UIUserInterfaceStyle.light, .dark] {
                for category in [UIContentSizeCategory.large, .accessibilityExtraExtraExtraLarge] {
                    let controller: UITableViewController = page == "notes"
                        ? NotesController(library: fixture.library) : QuestionHistoryController(library: fixture.library)
                    let image = DesignFixture.renderRoot(controller, size: CGSize(width: 375, height: 667), style: style, preferredContentSizeCategory: category)
                    let attachment = XCTAttachment(data: try XCTUnwrap(image.pngData()), uniformTypeIdentifier: "public.png")
                    attachment.name = "groups-\(page)-375x667-\(style.rawValue)-\(category.rawValue)"
                    attachment.lifetime = .keepAlways
                    add(attachment)
                    XCTAssertEqual(controller.tableView.numberOfSections, 2)
                    let group = try bookGroup(in: controller, bookID: fixture.secondaryID, prefix: prefix)
                    let header = group.header
                    header.configure(bookID: fixture.secondaryID, bookTitle: "一本书名很长但应当完整显示的书籍：灯下阅读与思考的故事", book: nil, covers: BookCoverStore(), library: fixture.library, identifierPrefix: prefix, countText: "12345 条记录", expanded: false)
                    let host = UIViewController()
                    header.translatesAutoresizingMaskIntoConstraints = false
                    host.view.addSubview(header)
                    NSLayoutConstraint.activate([
                        header.leadingAnchor.constraint(equalTo: host.view.leadingAnchor),
                        header.trailingAnchor.constraint(equalTo: host.view.trailingAnchor),
                        header.topAnchor.constraint(equalTo: host.view.topAnchor)
                    ])
                    _ = DesignFixture.renderRoot(host, size: CGSize(width: 375, height: 667), style: style, preferredContentSizeCategory: category)
                    XCTAssertGreaterThanOrEqual(header.bounds.height, 44)
                    XCTAssertTrue(header.accessibilityTraits.contains(.button))
                    XCTAssertTrue(header.accessibilityTraits.contains(.header))
                    XCTAssertEqual(header.accessibilityValue, "已收起")
                    for label in header.allViews.compactMap({ $0 as? UILabel }).filter({ !($0.text ?? "").isEmpty && !$0.isHidden }) {
                        XCTAssertGreaterThan(label.bounds.width, 0)
                        let requiredHeight = label.sizeThatFits(CGSize(width: label.bounds.width, height: .greatestFiniteMagnitude)).height
                        XCTAssertGreaterThanOrEqual(label.bounds.height + 1, requiredHeight)
                        let frame = header.convert(label.bounds, from: label)
                        XCTAssertLessThanOrEqual(frame.maxX, 375)
                        XCTAssertLessThanOrEqual(frame.maxY, header.bounds.height + 0.5)
                    }
                    let arrow = try XCTUnwrap(header.allViews.compactMap { $0 as? UIImageView }.last)
                    XCTAssertGreaterThan(arrow.bounds.width, 0)
                    XCTAssertLessThanOrEqual(header.convert(arrow.bounds, from: arrow).maxX, 375)
                }
            }
        }
    }

    private func bookGroup(in controller: UITableViewController, bookID: String, prefix: String) throws -> (section: Int, header: BookGroupHeader) {
        for section in 0..<controller.tableView.numberOfSections {
            if let header = controller.tableView.delegate?.tableView?(controller.tableView, viewForHeaderInSection: section) as? BookGroupHeader,
               header.accessibilityIdentifier == "\(prefix)-\(bookID)" {
                return (section, header)
            }
        }
        throw XCTUnwrapErrorForMissingBookGroup()
    }

    private struct XCTUnwrapErrorForMissingBookGroup: Error {}

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
        XCTAssertLessThanOrEqual(titleFrame.minX, 25)
        XCTAssertGreaterThanOrEqual(titleFrame.minX, 23)
        let icon = try XCTUnwrap(
            views.first { $0.accessibilityIdentifier == "profile-brand-icon" }
        )
        XCTAssertEqual(icon.bounds.width, 70, accuracy: 0.5)
        XCTAssertEqual(icon.bounds.height, 70, accuracy: 0.5)
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
        let service = try XCTUnwrap(
            views.compactMap { $0 as? UIControl }
                .first { $0.accessibilityIdentifier == "profile-ai-service" }
        )
        XCTAssertEqual(service.accessibilityValue, "DeepSeek · deepseek-flash")
        XCTAssertGreaterThanOrEqual(service.frame.height, 66)
        let appearance = try XCTUnwrap(
            views.compactMap { $0 as? UIControl }
                .first { $0.accessibilityIdentifier == "profile-appearance" }
        )
        XCTAssertEqual(appearance.accessibilityValue, "跟随系统")
        let about = try XCTUnwrap(
            views.compactMap { $0 as? UIControl }
                .first { $0.accessibilityIdentifier == "profile-about" }
        )
        XCTAssertFalse((about.accessibilityValue ?? "").isEmpty)

        let navigation = try XCTUnwrap(root.viewControllers.last as? UINavigationController)
        let profile = try XCTUnwrap(navigation.topViewController as? ProfileController)
        profile.setAppearance(.dark)
        XCTAssertEqual(
            UserDefaults.standard.integer(forKey: appearanceKey),
            UIUserInterfaceStyle.dark.rawValue
        )
        XCTAssertEqual(appearance.accessibilityValue, "深色")

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
            reopened.view.allViews.compactMap { $0 as? UIControl }
                .first { $0.accessibilityIdentifier == "profile-appearance" }
        )
        XCTAssertEqual(reopenedAppearance.accessibilityValue, "深色")
        profile.setAppearance(.unspecified)
        XCTAssertEqual(appearance.accessibilityValue, "跟随系统")

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
        let accessibleViews = accessible.view.allViews
        for identifier in [
            "profile-title",
            "profile-brand-icon",
            "profile-ai-service",
            "profile-appearance",
            "profile-about"
        ] {
            let view = try XCTUnwrap(
                accessibleViews.first { $0.accessibilityIdentifier == identifier },
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

        let service = try XCTUnwrap(
            navigation.view.allViews.compactMap { $0 as? UIControl }
                .first { $0.accessibilityIdentifier == "profile-ai-service" }
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
        XCTAssertEqual(light.fontSize ?? 0, 20 / 14, accuracy: 0.0001)
        XCTAssertEqual(light.lineHeight ?? 0, 1.95, accuracy: 0.0001)
        XCTAssertEqual(light.paragraphIndent ?? 0, 2, accuracy: 0.0001)
        XCTAssertEqual(light.textAlign, .justify)

        let lightConfiguration = ReaderController.configuration(
            ReadingSettings(scroll: false, fontSize: 100, dark: false)
        )
        XCTAssertEqual(
            lightConfiguration.readiumCSSRSProperties.pageGutter?.css(),
            "29.00000px"
        )
        XCTAssertEqual(
            lightConfiguration.readiumCSSRSProperties.selectionBackgroundColor?.css(),
            "#F4E3AC"
        )
        let compactInset = try XCTUnwrap(lightConfiguration.contentInset[.compact])
        XCTAssertEqual(compactInset.top, 29)
        XCTAssertEqual(compactInset.bottom, 22)

        let darkConfiguration = ReaderController.configuration(
            ReadingSettings(scroll: false, fontSize: 100, dark: true)
        )
        XCTAssertEqual(
            darkConfiguration.readiumCSSRSProperties.selectionBackgroundColor?.css(),
            "#5B4D2D"
        )
        XCTAssertEqual(
            darkConfiguration.readiumCSSRSProperties.selectionTextColor?.css(),
            "#F0F1E9"
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
        XCTAssertEqual(toolbar.frame.height, 51, accuracy: 0.5)
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
        XCTAssertEqual(title.font.pointSize, 13, accuracy: 0.5)
        XCTAssertEqual(askFrame.height, 44, accuracy: 0.5)
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

                let status = try XCTUnwrap(
                    reader.view.allViews.first {
                        $0.accessibilityIdentifier == "reading-save-status"
                    } as? UILabel
                )
                var loaded = false
                for _ in 0..<300 {
                    if status.text == "阅读位置已保存" {
                        loaded = true
                        break
                    }
                    await pause(0.1)
                }
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
                XCTAssertEqual(toolbar.convert(toolbar.bounds, to: reader.view).height, 51, accuracy: 0.5)
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

                let status = try XCTUnwrap(
                    reader.view.allViews.first {
                        $0.accessibilityIdentifier == "reading-save-status"
                    } as? UILabel
                )
                var loaded = false
                for _ in 0..<300 {
                    if status.text == "阅读位置已保存" {
                        loaded = true
                        break
                    }
                    await pause(0.1)
                }
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
        XCTAssertEqual(detentPage.sheetPresentationController?.preferredCornerRadius, 23)
        XCTAssertEqual(detentPage.sheetPresentationController?.detents.count, 1)

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
