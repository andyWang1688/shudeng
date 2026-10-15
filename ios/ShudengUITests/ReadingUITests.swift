import XCTest

final class ReadingUITests: XCTestCase {
    private let bookID = "book-a08282a3fd59d6398d4173469b0159c51c5b980afaa1aa3024cfd05a43b14a27"
    private let navigationBookID = "book-51747c29e712f6e92e2a5c385cdddd773258b84ca9e671ef6df9aedd59f83cc2"
    private func choose(_ name: String, in app: XCUIApplication) {
        app.buttons["导入"].tap()
        let browse = app.buttons["浏览"]
        XCTAssertTrue(browse.waitForExistence(timeout: 5))
        browse.tap()
        let local = app.cells["DOC.sidebar.item.我的iPhone"]
        if !local.waitForExistence(timeout: 2) { browse.tap() }
        XCTAssertTrue(local.waitForExistence(timeout: 5))
        local.tap()
        let folder = app.cells["Acceptance, Folder"]
        XCTAssertTrue(folder.waitForExistence(timeout: 5))
        folder.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.25)).tap()
        let file = app.cells.matching(NSPredicate(format: "identifier BEGINSWITH %@", name + ",")).firstMatch
        XCTAssertTrue(file.waitForExistence(timeout: 5))
        let grid = app.collectionViews["File View"]
        for _ in 0..<4 where file.frame.maxY > app.frame.height - 100 { grid.swipeUp() }
        if name == "curl-failure.epub" {
            // Keep the first row below Files' sticky search field.
            grid.swipeDown()
            evidence("curl-failure-file-picker", app)
            print("CURL_PICKER file=\(file.frame) search=\(app.searchFields.firstMatch.frame)")
        }
        file.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.25)).tap()
        XCTAssertTrue(app.alerts.firstMatch.waitForExistence(timeout: 10))
    }
    private func evidence(_ name: String, _ app: XCUIApplication) {
        let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = name; shot.lifetime = .keepAlways; add(shot)
    }
    private func visibleMarker(_ app: XCUIApplication) -> String? {
        // WebKit reports clipped earlier-column text at x=0. The rendered
        // column's actual paragraph markers have the book's 20pt inset.
        app.webViews.staticTexts.matching(NSPredicate(format: "label MATCHES %@", "C[1-3]-P[0-9]{2}"))
            .allElementsBoundByIndex.first { $0.frame.minX > 5 && $0.frame.maxX < 402 && $0.frame.minY > 168 && $0.frame.maxY < 740 }?.label
    }
    private func visibleMarkers(_ app: XCUIApplication) -> [String] {
        let bounds = app.webViews.firstMatch.frame
        return app.webViews.staticTexts.matching(NSPredicate(format: "label MATCHES %@", "C[1-3]-P[0-9]{2}"))
            .allElementsBoundByIndex.filter { bounds.contains($0.frame) && $0.frame.minX > 5 && $0.frame.width > 0 }.map(\.label)
    }
    private func waitForText(_ app: XCUIApplication) {
        XCTAssertTrue(app.staticTexts["阅读位置已保存"].waitForExistence(timeout: 20))
        let ready = NSPredicate { _, _ in !self.visibleMarkers(app).isEmpty }
        expectation(for: ready, evaluatedWith: app)
        waitForExpectations(timeout: 15)
    }
    private func waitForBody(_ app: XCUIApplication) {
        XCTAssertTrue(app.staticTexts["阅读位置已保存"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.webViews.staticTexts.firstMatch.waitForExistence(timeout: 15))
    }
    private func settings(_ app: XCUIApplication, mode: String, dark: Bool, font: Int? = nil, wait: Bool = true) {
        app.buttons["阅读设置"].tap()
        app.segmentedControls.buttons[mode].tap()
        app.segmentedControls.buttons[dark ? "深色" : "明亮"].tap()
        if let font {
            while Int(app.staticTexts["font-size"].label.dropLast())! < font { app.buttons["增大字号"].tap() }
            while Int(app.staticTexts["font-size"].label.dropLast())! > font { app.buttons["缩小字号"].tap() }
        }
        app.buttons["完成"].tap()
        if wait { waitForBody(app) }
    }
    private func curlTurn(_ app: XCUIApplication, forward: Bool, cancel: Bool = false) {
        let content = app.otherElements["reading-content"]
        let start = content.coordinate(withNormalizedOffset: CGVector(dx: forward ? 0.92 : 0.1, dy: 0.6))
        let end = content.coordinate(withNormalizedOffset: CGVector(dx: cancel ? 0.78 : forward ? 0.1 : 0.92, dy: 0.6))
        start.press(forDuration: 0.1, thenDragTo: end, withVelocity: .slow, thenHoldForDuration: cancel ? 1 : 0.2)
        waitForBody(app)
    }
    func testCurlRepeatedTurnsCancelSelectionAndRestart() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        app.tables["library"].cells[bookID].tap()
        waitForBody(app)
        settings(app, mode: "分页", dark: false, font: 100)
        contents("第1章", in: app)
        waitForBody(app)
        settings(app, mode: "仿真", dark: false, font: 100)
        let original = visibleMarkers(app)
        XCTAssertTrue(original.contains("C1-P01"))
        evidence("curl-original", app)
        var forward: [String] = []
        for cycle in 1...2 {
            curlTurn(app, forward: true)
            let markers = visibleMarkers(app)
            XCTAssertNotEqual(markers, original)
            if cycle == 1 { forward = markers } else { XCTAssertEqual(markers, forward) }
            evidence("curl-forward-\(cycle)", app)
            curlTurn(app, forward: true, cancel: true)
            XCTAssertEqual(visibleMarkers(app), forward)
            evidence("curl-cancel-\(cycle)", app)
            curlTurn(app, forward: false)
            XCTAssertEqual(visibleMarkers(app), original)
            evidence("curl-back-\(cycle)", app)
        }
        app.webViews.firstMatch.coordinate(withNormalizedOffset: CGVector(dx: 0.35, dy: 0.3)).press(forDuration: 1.3)
        let copy = app.menuItems.matching(NSPredicate(format: "label IN %@", ["复制", "Copy"])).firstMatch
        let copyButton = app.buttons.matching(NSPredicate(format: "label IN %@", ["复制", "Copy"])).firstMatch
        XCTAssertTrue(copy.waitForExistence(timeout: 3) || copyButton.waitForExistence(timeout: 3))
        evidence("curl-real-selection", app)
        if copy.exists { copy.tap() } else { copyButton.tap() }
        curlTurn(app, forward: true)
        XCTAssertEqual(visibleMarkers(app), forward)
        evidence("curl-before-restart", app)
        app.terminate(); app.launch()
        app.tables["library"].cells[bookID].tap()
        waitForBody(app)
        XCTAssertEqual(visibleMarkers(app), forward)
        evidence("curl-restored", app)
        app.buttons["阅读设置"].tap()
        XCTAssertTrue(app.segmentedControls.buttons["仿真"].isSelected)
        app.buttons["取消"].tap()
    }

    func testCurlPreparationFailureRecoversToNativePagination() {
        continueAfterFailure = false
        let app = XCUIApplication()
        let failedBook = "book-3cd5359e8b5487cda28207d47bc644042de37da1a5606087df0c2369a33674c4"
        app.launch()
        choose("curl-failure.epub", in: app)
        app.alerts.buttons["知道了"].tap()
        app.tables["library"].cells[failedBook].tap()
        waitForBody(app)
        settings(app, mode: "仿真", dark: false, font: 100, wait: false)
        // The original scripted fixture refuses scrollBy: go accepts the request
        // but no changed location arrives. A timeout must not become readiness.
        XCTAssertTrue(app.alerts["翻页准备失败"].waitForExistence(timeout: 15))
        XCTAssertFalse(app.staticTexts["阅读位置已保存"].exists)
        evidence("curl-preparation-failed", app)
        app.alerts.buttons["使用分页"].tap()
        waitForBody(app)
        app.swipeLeft() // Real native scroll gesture still works in this fixture.
        waitForBody(app)
        XCTAssertFalse(visibleMarkers(app).contains("C1-P01"))
        let markers = visibleMarkers(app)
        XCTAssertFalse(markers.isEmpty)
        evidence("curl-failure-native-recovered", app)
        app.terminate(); app.launch()
        app.tables["library"].cells[failedBook].tap()
        waitForBody(app)
        XCTAssertEqual(visibleMarkers(app), markers)
        app.buttons["阅读设置"].tap()
        XCTAssertTrue(app.segmentedControls.buttons["分页"].isSelected)
        evidence("curl-failure-recovered-restart", app)
        app.buttons["取消"].tap()
    }

    func testCurlRotationRebuildsUsableViewport() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        app.tables["library"].cells[bookID].tap()
        waitForBody(app)
        settings(app, mode: "仿真", dark: true, font: 150)
        contents("第2章", in: app)
        waitForBody(app)
        for orientation in [UIDeviceOrientation.landscapeLeft, .portrait] {
            XCUIDevice.shared.orientation = orientation
            waitForBody(app)
            let content = app.otherElements["reading-content"].frame
            let web = app.webViews.firstMatch.frame
            print("CURL_VIEWPORT orientation=\(orientation.rawValue) app=\(app.frame) content=\(content) web=\(web)")
            XCTAssertGreaterThan(web.width, content.width * 0.9)
            XCTAssertGreaterThan(web.height, content.height * 0.6)
            XCTAssertTrue(app.buttons["阅读设置"].isHittable)
            XCTAssertTrue(app.buttons["目录与书签"].isHittable)
            evidence("curl-rotation-\(orientation.rawValue)", app)
            if orientation == .landscapeLeft {
                print("CAPTURE_CURL_LANDSCAPE_NOW")
                Thread.sleep(forTimeInterval: 4)
            }
            curlTurn(app, forward: true)
            evidence("curl-rotation-turn-\(orientation.rawValue)", app)
        }
    }

    func testCurlPrefetchAndCancelProgressTimeline() {
        continueAfterFailure = false
        let app = XCUIApplication()
        func phase(_ name: String) {
            let date = ISO8601DateFormatter()
            date.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            print("CURL_PHASE \(name) \(date.string(from: Date()))")
            evidence("curl-timeline-" + name, app)
        }
        app.launch()
        app.tables["library"].cells[bookID].tap()
        waitForBody(app)
        settings(app, mode: "仿真", dark: false, font: 100)
        contents("第1章", in: app)
        waitForBody(app)
        phase("initial-ready")
        curlTurn(app, forward: true)
        phase("forward-ready")
        curlTurn(app, forward: true, cancel: true)
        phase("cancelled-same-page")
        curlTurn(app, forward: false)
        phase("back-ready")
    }

    func testCurlExitDuringNeighborPreparation() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        app.tables["library"].cells[bookID].tap()
        waitForBody(app)
        settings(app, mode: "仿真", dark: false, font: 100)
        contents("第1章", in: app)
        waitForBody(app)
        evidence("curl-exit-before-turn", app)
        let content = app.otherElements["reading-content"]
        content.coordinate(withNormalizedOffset: CGVector(dx: 0.92, dy: 0.6)).press(forDuration: 0.1,
            thenDragTo: content.coordinate(withNormalizedOffset: CGVector(dx: 0.1, dy: 0.6)),
            withVelocity: .fast, thenHoldForDuration: 0)
        XCTAssertTrue(app.staticTexts["正在准备翻页…"].exists)
        evidence("curl-exit-while-preparing", app)
        app.buttons["书架"].tap()
        XCTAssertTrue(app.tables["library"].waitForExistence(timeout: 5))
        // Opening another tab keeps the old reader offscreen while pending
        // Readium callbacks drain; no hidden reader may restart or save.
        app.tabBars.buttons["我的"].tap()
        evidence("curl-left-reader", app)
        app.terminate(); app.launch()
        app.tables["library"].cells[bookID].tap()
        waitForBody(app)
        XCTAssertTrue(visibleMarkers(app).contains("C1-P01"))
        evidence("curl-exit-restart-kept-committed-page", app)
    }

    func testCurlRebuildForNavigationThemeFontAndLayout() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        app.tables["library"].cells[navigationBookID].tap()
        waitForBody(app)
        settings(app, mode: "仿真", dark: false, font: 100)
        clearBookmarks(app)
        contents("第2章", in: app)
        waitForBody(app)
        XCTAssertTrue(visibleMarkers(app).contains("C2-P01"))
        app.buttons["目录与书签"].tap()
        app.buttons["添加书签"].tap()
        XCTAssertTrue(app.staticTexts["书签已保存"].waitForExistence(timeout: 5))
        app.buttons["完成"].tap()
        contents("第1章末", in: app)
        waitForBody(app)
        evidence("curl-chapter1-end", app)
        for _ in 0..<3 where !visibleMarkers(app).contains("C2-P01") { curlTurn(app, forward: true) }
        XCTAssertTrue(visibleMarkers(app).contains("C2-P01"))
        evidence("curl-cross-chapter2", app)
        curlTurn(app, forward: false)
        let chapterEnd = app.webViews.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "NOTE-C1：这是原创脚注")).firstMatch
        XCTAssertTrue(chapterEnd.exists)
        XCTAssertTrue(app.webViews.firstMatch.frame.contains(chapterEnd.frame))
        evidence("curl-back-chapter1-note", app)

        settings(app, mode: "仿真", dark: true, font: 150)
        evidence("curl-reflow-dark", app)
        app.buttons["目录与书签"].tap()
        app.segmentedControls.buttons["书签"].tap()
        app.tables.cells.firstMatch.tap()
        waitForBody(app)
        XCTAssertTrue(visibleMarkers(app).contains("C2-P01"))
        evidence("curl-bookmark-rebuilt", app)
        curlTurn(app, forward: true)
        XCTAssertTrue(visibleMarkers(app).allSatisfy { $0.hasPrefix("C2-") })
        XCUIDevice.shared.orientation = .landscapeLeft
        waitForBody(app)
        evidence("curl-landscape", app)
        curlTurn(app, forward: true)
        XCUIDevice.shared.orientation = .portrait
        waitForBody(app)
        evidence("curl-portrait-rebuilt", app)
        contents("失效锚点", in: app)
        XCTAssertTrue(app.alerts["无法定位原文"].waitForExistence(timeout: 12))
        app.alerts.buttons["知道了"].tap()
        contents("第3章", in: app)
        waitForBody(app)
        XCTAssertTrue(visibleMarkers(app).contains("C3-P01"))
        curlTurn(app, forward: true)
        evidence("curl-recovered-external-navigation", app)
        settings(app, mode: "滚动", dark: false, font: 100)
        evidence("curl-exit-scroll", app)
    }

    func testContentsAndBookmarkReturnAfterRestart() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        app.tables["library"].cells[bookID].tap()
        waitForBody(app)
        settings(app, mode: "分页", dark: false, font: 100)
        clearBookmarks(app)
        app.buttons["目录与书签"].tap()
        app.tables.cells.staticTexts["第2章"].tap()
        waitForText(app)
        XCTAssertTrue(visibleMarkers(app).contains("C2-P01"))
        app.swipeLeft()
        waitForText(app)
        let marker = try XCTUnwrap(visibleMarkers(app).first)
        evidence("bookmark-before-" + marker, app)
        app.buttons["目录与书签"].tap()
        app.buttons["添加书签"].tap()
        XCTAssertTrue(app.staticTexts["书签已保存"].waitForExistence(timeout: 5))
        app.buttons["添加书签"].tap()
        XCTAssertEqual(app.tables.cells.count, 1)
        evidence("bookmark-saved-list", app)
        app.buttons["完成"].tap()
        app.buttons["目录与书签"].tap()
        app.segmentedControls.buttons["目录"].tap()
        app.tables.cells.staticTexts["第3章"].tap()
        waitForText(app)
        XCTAssertTrue(visibleMarkers(app).contains("C3-P01"))
        app.terminate()
        app.launch()
        app.tables["library"].cells[bookID].tap()
        waitForBody(app)
        app.buttons["目录与书签"].tap()
        app.segmentedControls.buttons["书签"].tap()
        app.tables.cells.firstMatch.tap()
        waitForText(app)
        XCTAssertTrue(visibleMarkers(app).contains(marker))
        evidence("bookmark-return-" + marker, app)
        app.buttons["目录与书签"].tap()
        app.segmentedControls.buttons["书签"].tap()
        app.tables.cells.firstMatch.swipeLeft()
        app.buttons["移除"].tap()
        XCTAssertTrue(app.staticTexts["暂无书签"].waitForExistence(timeout: 5))
        app.buttons["完成"].tap()
        app.terminate()
        app.launch()
        app.tables["library"].cells[bookID].tap()
        waitForBody(app)
        app.buttons["目录与书签"].tap()
        app.segmentedControls.buttons["书签"].tap()
        XCTAssertTrue(app.staticTexts["暂无书签"].exists)
    }
    private func contents(_ name: String, in app: XCUIApplication) {
        app.buttons["目录与书签"].tap()
        app.segmentedControls.buttons["目录"].tap()
        let row = app.tables.cells.staticTexts[name]
        for _ in 0..<4 where !row.isHittable { app.tables.firstMatch.swipeUp() }
        row.tap()
    }
    private func clearBookmarks(_ app: XCUIApplication) {
        app.buttons["目录与书签"].tap()
        app.segmentedControls.buttons["书签"].tap()
        while app.tables.cells.matching(NSPredicate(format: "identifier BEGINSWITH 'bookmark-'")).count > 0 {
            app.tables.cells.firstMatch.swipeLeft()
            app.buttons["移除"].tap()
        }
        app.buttons["完成"].tap()
    }
    func testChapterEndsRepeatedTextReflowAndInvalidTargets() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        if !app.tables["library"].cells[navigationBookID].exists {
            choose("navigation-fixture.epub", in: app)
            app.alerts.buttons["知道了"].tap()
        }
        app.tables["library"].cells[navigationBookID].tap()
        waitForBody(app)
        settings(app, mode: "滚动", dark: false, font: 100)
        clearBookmarks(app)
        contents("第2章末", in: app)
        waitForBody(app)
        XCTAssertTrue(visibleMarkers(app).contains("C2-P30"))
        app.swipeUp() // Capture the top visible anchor on the chapter's final screen.
        waitForBody(app)
        evidence("chapter2-end-before-bookmark", app)
        app.buttons["目录与书签"].tap()
        app.buttons["添加书签"].tap()
        XCTAssertTrue(app.staticTexts["书签已保存"].waitForExistence(timeout: 5))
        app.buttons["完成"].tap()
        contents("第3章末", in: app)
        waitForBody(app)
        XCTAssertTrue(visibleMarkers(app).contains("C3-P30"))
        evidence("chapter3-end", app)
        settings(app, mode: "分页", dark: true, font: 200)
        app.buttons["目录与书签"].tap()
        app.segmentedControls.buttons["书签"].tap()
        app.tables.cells.firstMatch.tap()
        waitForBody(app)
        evidence("chapter2-bookmark-200-dark-pagination", app)
        app.terminate()
        app.launch()
        app.tables["library"].cells[navigationBookID].tap()
        waitForBody(app)
        evidence("chapter2-bookmark-200-restart", app)
        contents("第3章", in: app)
        waitForBody(app)
        evidence("before-invalid-jump-chapter3", app)
        contents("失效锚点", in: app)
        XCTAssertTrue(app.alerts["无法定位原文"].waitForExistence(timeout: 12))
        evidence("invalid-anchor-rejected", app)
        app.alerts.buttons["知道了"].tap()
        XCTAssertFalse(app.staticTexts["阅读位置已保存"].exists)
        app.terminate()
        app.launch()
        app.tables["library"].cells[navigationBookID].tap()
        waitForBody(app)
        let chapter = app.webViews.staticTexts["第3章：原创验证文本"].firstMatch
        XCTAssertTrue(chapter.exists)
        XCTAssertGreaterThan(chapter.frame.minX, 5)
        XCTAssertTrue(app.webViews.firstMatch.frame.intersects(chapter.frame))
        evidence("invalid-jump-restart-kept-chapter3", app)
        contents("第1章末", in: app)
        waitForBody(app)
        evidence("valid-target-after-failure", app)
        contents("失效章节", in: app)
        XCTAssertTrue(app.alerts["无法定位原文"].waitForExistence(timeout: 5))
        evidence("invalid-resource-rejected", app)
        app.alerts.buttons["知道了"].tap()
        app.buttons["完成"].tap()
        settings(app, mode: "分页", dark: false, font: 100)
    }
    func testBookmarkSaveFailureAndRetry() throws {
        guard ProcessInfo.processInfo.environment["SHUDENG_STORAGE_FAULT"] == "1" else { throw XCTSkip("Requires real filesystem fault") }
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        app.tables["library"].cells[bookID].tap()
        XCTAssertTrue(app.buttons["重试保存"].waitForExistence(timeout: 15))
        app.buttons["目录与书签"].tap()
        app.buttons["添加书签"].tap()
        XCTAssertTrue(app.alerts["书签保存失败"].waitForExistence(timeout: 5))
        evidence("bookmark-save-failed", app)
        XCTAssertFalse(app.staticTexts["书签已保存"].exists)
        for _ in 0..<30 {
            app.alerts.buttons["重试保存"].tap()
            if app.staticTexts["书签已保存"].waitForExistence(timeout: 1) { break }
        }
        XCTAssertTrue(app.staticTexts["书签已保存"].exists)
        let count = app.tables.cells.count
        XCTAssertGreaterThan(count, 0)
        evidence("bookmark-retry-committed", app)
        app.buttons["添加书签"].tap()
        XCTAssertEqual(app.tables.cells.count, count)
        app.buttons["完成"].tap()
        app.terminate()
        app.launch()
        app.tables["library"].cells[bookID].tap()
        waitForBody(app)
        app.buttons["目录与书签"].tap()
        app.segmentedControls.buttons["书签"].tap()
        XCTAssertEqual(app.tables.cells.count, count)
        evidence("bookmark-retry-after-restart", app)
    }
    func testBookmarkRemovalFailureAndRetry() throws {
        guard ProcessInfo.processInfo.environment["SHUDENG_STORAGE_FAULT"] == "1" else { throw XCTSkip("Requires saved bookmark and real filesystem fault") }
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        app.tables["library"].cells[bookID].tap()
        XCTAssertTrue(app.buttons["重试保存"].waitForExistence(timeout: 15))
        app.buttons["目录与书签"].tap()
        app.segmentedControls.buttons["书签"].tap()
        let row = app.tables.cells.matching(NSPredicate(format: "identifier BEGINSWITH 'bookmark-'")).firstMatch
        XCTAssertTrue(row.exists)
        let removedID = row.identifier
        row.swipeLeft()
        app.buttons["移除"].tap()
        XCTAssertTrue(app.alerts["书签移除失败"].waitForExistence(timeout: 5))
        evidence("bookmark-removal-failed", app)
        for _ in 0..<30 {
            app.alerts.buttons["重试保存"].tap()
            if app.staticTexts["书签已移除"].waitForExistence(timeout: 1) { break }
        }
        XCTAssertFalse(app.tables.cells[removedID].exists)
        XCTAssertTrue(app.staticTexts["书签已移除"].exists)
        evidence("bookmark-removal-retried", app)
        app.buttons["完成"].tap()
        app.terminate()
        app.launch()
        app.tables["library"].cells[bookID].tap()
        waitForBody(app)
        app.buttons["目录与书签"].tap()
        app.segmentedControls.buttons["书签"].tap()
        XCTAssertFalse(app.tables.cells[removedID].exists)
    }
    func testNavigationSmallScreenLargeText() throws {
        guard ProcessInfo.processInfo.environment["SHUDENG_SMALL_SCREEN"] == "1" else { throw XCTSkip("Requires small simulator with accessibility text size") }
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        app.tables["library"].cells[bookID].tap()
        waitForBody(app)
        settings(app, mode: "滚动", dark: true, font: 200)
        contents("第2章", in: app)
        waitForBody(app)
        evidence("navigation-small-large-reader", app)
        app.buttons["目录与书签"].tap()
        evidence("navigation-small-large-contents", app)
        app.buttons["添加书签"].tap()
        XCTAssertTrue(app.staticTexts["书签已保存"].waitForExistence(timeout: 5))
        evidence("navigation-small-large-bookmark", app)
        app.tables.cells.firstMatch.tap()
        waitForBody(app)
        app.buttons["隐藏工具栏"].tap()
        XCTAssertFalse(app.buttons["目录与书签"].exists)
        app.buttons["显示工具栏"].tap()
        settings(app, mode: "分页", dark: false, font: 100)
    }
    func testReadingSettingsKeepContentAndRestart() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        if !app.tables["library"].cells[bookID].exists {
            choose("original-fixture.epub", in: app)
            app.alerts.buttons["知道了"].tap()
        }
        app.tables["library"].cells[bookID].tap()
        waitForBody(app)
        settings(app, mode: "分页", dark: false, font: 100)
        app.swipeLeft()
        waitForText(app)
        let marker = try XCTUnwrap(visibleMarkers(app).first)
        evidence("settings-before-" + marker, app)
        settings(app, mode: "滚动", dark: true, font: 200)
        // At 200%, the next paragraph marker may move below the viewport.
        // Compare the top visible sentence in these screenshots instead.
        evidence("settings-scrolling-dark-" + marker, app)
        app.buttons["隐藏工具栏"].tap()
        XCTAssertFalse(app.buttons["阅读设置"].exists)
        evidence("toolbar-hidden-" + marker, app)
        app.buttons["显示工具栏"].tap()
        app.swipeUp()
        waitForBody(app)
        let scrolled = visibleMarkers(app).first ?? "within-long-paragraph"
        evidence("scrolled-before-restart-" + scrolled, app)
        app.terminate()
        app.launch()
        app.tables["library"].cells[bookID].tap()
        waitForBody(app)
        if scrolled != "within-long-paragraph" { XCTAssertTrue(visibleMarkers(app).contains(scrolled)) }
        evidence("scrolled-after-restart-" + scrolled, app)
        app.buttons["阅读设置"].tap()
        XCTAssertTrue(app.segmentedControls.buttons["滚动"].isSelected)
        XCTAssertTrue(app.segmentedControls.buttons["深色"].isSelected)
        XCTAssertEqual(app.staticTexts["font-size"].label, "200%")
        evidence("restored-settings", app)
        app.buttons["取消"].tap()
        settings(app, mode: "分页", dark: false)
        evidence("back-to-pagination-" + scrolled, app)
        settings(app, mode: "分页", dark: false, font: 100)
    }
    func testThemeOnlyChangeRestoresWithoutTurningPage() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        app.tables["library"].cells[bookID].tap()
        waitForText(app)
        settings(app, mode: "分页", dark: false, font: 100)
        let marker = try XCTUnwrap(visibleMarkers(app).first)
        evidence("theme-only-before-" + marker, app)
        settings(app, mode: "分页", dark: true)
        XCTAssertTrue(visibleMarkers(app).contains(marker))
        app.terminate()
        app.launch()
        app.tables["library"].cells[bookID].tap()
        waitForText(app)
        XCTAssertTrue(visibleMarkers(app).contains(marker))
        evidence("theme-only-restored-" + marker, app)
        app.buttons["阅读设置"].tap()
        XCTAssertTrue(app.segmentedControls.buttons["深色"].isSelected)
        XCTAssertEqual(app.staticTexts["font-size"].label, "100%")
        app.buttons["取消"].tap()
        settings(app, mode: "分页", dark: false)
    }
    func testPlainLongParagraphReflow() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        choose("plain-long.epub", in: app)
        app.alerts.buttons["知道了"].tap()
        let plainID = "book-0b0d797950600fe3afc64cfb074b97bf923a88277a1957628aee785ee4d20b18"
        app.tables["library"].cells[plainID].tap()
        XCTAssertTrue(app.staticTexts["阅读位置已保存"].waitForExistence(timeout: 20))
        for _ in 0..<3 { app.swipeLeft() }
        evidence("plain-paragraph-before", app)
        settings(app, mode: "滚动", dark: true, font: 200, wait: false)
        XCTAssertTrue(app.staticTexts["阅读位置已保存"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.webViews.staticTexts.firstMatch.waitForExistence(timeout: 15))
        evidence("plain-paragraph-200-scroll", app)
        app.terminate()
        app.launch()
        app.tables["library"].cells[plainID].tap()
        XCTAssertTrue(app.staticTexts["阅读位置已保存"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.webViews.staticTexts.firstMatch.waitForExistence(timeout: 15))
        evidence("plain-paragraph-restored", app)
        settings(app, mode: "分页", dark: false, font: 100, wait: false)
        XCTAssertTrue(app.staticTexts["阅读位置已保存"].waitForExistence(timeout: 20))
        evidence("plain-paragraph-pagination", app)
    }
    func testSettingsFailureAndRetry() throws {
        guard ProcessInfo.processInfo.environment["SHUDENG_STORAGE_FAULT"] == "1" else { throw XCTSkip("Requires real filesystem fault") }
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        app.tables["library"].cells[bookID].tap()
        XCTAssertTrue(app.buttons["重试保存"].waitForExistence(timeout: 15))
        settings(app, mode: "滚动", dark: true, font: 175, wait: false)
        XCTAssertTrue(app.buttons["重试保存"].waitForExistence(timeout: 15))
        XCTAssertFalse(app.staticTexts["阅读位置已保存"].exists)
        evidence("settings-write-failed", app)
        for _ in 0..<30 {
            app.buttons["重试保存"].tap()
            if app.staticTexts["阅读位置已保存"].waitForExistence(timeout: 1) { break }
        }
        waitForText(app)
        XCTAssertFalse(app.buttons["重试保存"].exists)
        let marker = try XCTUnwrap(visibleMarkers(app).first)
        evidence("settings-retry-saved-" + marker, app)
        app.terminate()
        app.launch()
        app.tables["library"].cells[bookID].tap()
        waitForText(app)
        XCTAssertTrue(visibleMarkers(app).contains(marker))
        app.buttons["阅读设置"].tap()
        XCTAssertTrue(app.segmentedControls.buttons["滚动"].isSelected)
        XCTAssertTrue(app.segmentedControls.buttons["深色"].isSelected)
        XCTAssertEqual(app.staticTexts["font-size"].label, "175%")
        evidence("settings-retry-restored", app)
        app.buttons["取消"].tap()
        settings(app, mode: "分页", dark: false, font: 100)
    }
    func testCurlSettingsFailureAndRetry() throws {
        guard ProcessInfo.processInfo.environment["SHUDENG_STORAGE_FAULT"] == "1" else { throw XCTSkip("Requires real filesystem fault") }
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        app.tables["library"].cells[bookID].tap()
        XCTAssertTrue(app.buttons["重试保存"].waitForExistence(timeout: 15))
        settings(app, mode: "仿真", dark: true, font: 150, wait: false)
        XCTAssertTrue(app.buttons["重试保存"].waitForExistence(timeout: 15))
        XCTAssertFalse(app.staticTexts["阅读位置已保存"].exists)
        evidence("curl-settings-write-failed", app)
        for _ in 0..<30 {
            app.buttons["重试保存"].tap()
            if app.staticTexts["阅读位置已保存"].waitForExistence(timeout: 1) { break }
        }
        waitForText(app)
        XCTAssertFalse(app.buttons["重试保存"].exists)
        let marker = try XCTUnwrap(visibleMarkers(app).first)
        evidence("curl-settings-retry-saved-" + marker, app)
        app.terminate()
        app.launch()
        app.tables["library"].cells[bookID].tap()
        waitForText(app)
        XCTAssertTrue(visibleMarkers(app).contains(marker))
        app.buttons["阅读设置"].tap()
        XCTAssertTrue(app.segmentedControls.buttons["仿真"].isSelected)
        XCTAssertTrue(app.segmentedControls.buttons["深色"].isSelected)
        XCTAssertEqual(app.staticTexts["font-size"].label, "150%")
        evidence("curl-settings-retry-restored", app)
        app.buttons["取消"].tap()
        settings(app, mode: "分页", dark: false, font: 100)
    }
    func testCurlSmallScreenLargeText() throws {
        guard ProcessInfo.processInfo.environment["SHUDENG_SMALL_SCREEN"] == "1" else { throw XCTSkip("Requires small simulator with accessibility text size") }
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        app.tables["library"].cells[bookID].tap()
        waitForBody(app)
        settings(app, mode: "仿真", dark: true, font: 200)
        contents("第2章", in: app)
        waitForBody(app)
        evidence("curl-small-dark-200", app)
        curlTurn(app, forward: true)
        evidence("curl-small-forward", app)
        curlTurn(app, forward: false)
        app.buttons["阅读设置"].tap()
        XCTAssertTrue(app.segmentedControls.buttons["仿真"].isSelected)
        XCTAssertEqual(app.staticTexts["font-size"].label, "200%")
        evidence("curl-small-settings", app)
        app.buttons["取消"].tap()
        settings(app, mode: "分页", dark: false, font: 100)
        app.buttons["书架"].tap()
        XCTAssertTrue(app.tables["library"].waitForExistence(timeout: 5))
    }

    func testSmallScreenLargeTextControls() throws {
        guard ProcessInfo.processInfo.environment["SHUDENG_SMALL_SCREEN"] == "1" else { throw XCTSkip("Requires small simulator with accessibility text size") }
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        app.tables["library"].cells[bookID].tap()
        waitForBody(app)
        settings(app, mode: "滚动", dark: true, font: 200, wait: false)
        XCTAssertTrue(app.staticTexts["阅读位置已保存"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.webViews.staticTexts.firstMatch.waitForExistence(timeout: 15))
        evidence("small-large-dark-reading", app)
        app.buttons["隐藏工具栏"].tap()
        app.swipeUp()
        app.buttons["显示工具栏"].tap()
        app.buttons["阅读设置"].tap()
        XCTAssertEqual(app.staticTexts["font-size"].label, "200%")
        evidence("small-large-settings", app)
        app.buttons["取消"].tap()
        settings(app, mode: "分页", dark: false, font: 100)
        app.buttons["书架"].tap()
        XCTAssertTrue(app.tables["library"].waitForExistence(timeout: 5))
    }
    func testRealPickerTurnsAndRestart() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        choose("original-fixture.epub", in: app)
        app.alerts.buttons["知道了"].tap()
        let count = app.tables["library"].cells.count
        choose("original-fixture.epub", in: app)
        XCTAssertTrue(app.alerts["书籍已在书架"].exists)
        app.alerts.buttons["知道了"].tap()
        XCTAssertEqual(app.tables["library"].cells.count, count)
        app.tables["library"].cells[bookID].tap()
        XCTAssertTrue(app.staticTexts["阅读位置已保存"].waitForExistence(timeout: 15))
        let before = visibleMarker(app)
        for _ in 0..<3 { app.swipeLeft() }
        let marker = try XCTUnwrap(visibleMarker(app))
        XCTAssertNotEqual(marker, before)
        evidence("after-three-pages-" + marker, app)
        app.swipeRight()
        XCTAssertNotEqual(visibleMarker(app), marker)
        app.swipeLeft()
        XCTAssertEqual(visibleMarker(app), marker)
        XCTAssertTrue(app.staticTexts["阅读位置已保存"].exists)
        app.terminate()
        app.launch()
        app.tables["library"].cells[bookID].tap()
        XCTAssertTrue(app.staticTexts["阅读位置已保存"].waitForExistence(timeout: 15))
        XCTAssertEqual(visibleMarker(app), marker)
        evidence("restored-" + marker, app)
        print("RESTORED_VISIBLE_MARKER=" + marker)
    }
    func testRealPickerRejectsBadFiles() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        let count = app.tables["library"].cells.count
        for name in ["corrupted.epub", "fixed-layout.epub", "missing-chapter.epub", "unsupported"] {
            choose(name, in: app)
            XCTAssertTrue(app.alerts["导入失败"].exists)
            evidence("rejected-" + name, app)
            app.alerts.buttons["知道了"].tap()
            XCTAssertEqual(app.tables["library"].cells.count, count)
        }
    }
    func testStorageFailureAndRetry() throws {
        guard ProcessInfo.processInfo.environment["SHUDENG_STORAGE_FAULT"] == "1" else {
            throw XCTSkip("Run with a real simulator filesystem fault; see delivery report.")
        }
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        app.tables["library"].cells[bookID].tap()
        XCTAssertTrue(app.buttons["重试保存"].waitForExistence(timeout: 15))
        XCTAssertFalse(app.staticTexts["阅读位置已保存"].exists)
        evidence("storage-failure-visible", app)
        print("RESTORE_STORAGE_NOW")
        for _ in 0..<30 {
            app.buttons["重试保存"].tap()
            if app.staticTexts["阅读位置已保存"].waitForExistence(timeout: 1) {
                XCTAssertFalse(app.buttons["重试保存"].exists)
                evidence("storage-retry-saved", app)
                return
            }
        }
        XCTFail("Storage was not restored during the fault exercise")
    }
}
