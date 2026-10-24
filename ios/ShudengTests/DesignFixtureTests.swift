import XCTest
import UIKit
@testable import Shudeng

@MainActor
final class DesignFixtureTests: XCTestCase {
    func testFixtureRequiresExplicitLaunchArgument() {
        XCTAssertNil(DesignFixture.request(in: []))
        XCTAssertNil(DesignFixture.request(in: ["--isolated-reading-test"]))
        XCTAssertEqual(DesignFixture.request(in: ["--design-fixture"])?.scenario, .normal)
        XCTAssertEqual(DesignFixture.request(in: ["--design-fixture=empty", "--design-theme=dark"])?.scenario, .empty)
        XCTAssertEqual(DesignFixture.request(in: ["--design-fixture=preparing"])?.scenario, .preparing)
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
