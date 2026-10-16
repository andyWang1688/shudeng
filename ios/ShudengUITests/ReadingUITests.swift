import XCTest

final class ReadingUITests: XCTestCase {
    func testIssue15SmallDarkLargeControls() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--isolated-reading-test"]
        app.launch()
        let shelf = app.collectionViews["library"]
        XCTAssertTrue(shelf.waitForExistence(timeout: 10))
        evidence("issue15-small-dark-large-grid", app)
        func query(_ value: String) {
            let field = app.searchFields["library-search"]
            if !field.isHittable { shelf.swipeDown() }
            field.tap()
            if field.buttons.firstMatch.exists { field.buttons.firstMatch.tap() }
            if !value.isEmpty { field.typeText(value) }
            let key = app.keyboards.buttons["搜索"].exists ? app.keyboards.buttons["搜索"] : app.keyboards.buttons["search"]
            if key.exists { key.tap() }
        }
        func closeSearch() {
            let close = app.buttons.matching(NSPredicate(format: "label IN %@", ["取消", "Cancel", "Close", "关闭"])).firstMatch
            if close.exists { close.tap() }
        }
        query("original fixture")
        XCTAssertTrue(shelf.cells[searchBookID].exists)
        XCTAssertEqual(shelf.cells.count, 1)
        evidence("issue15-small-author", app)
        query("zz_no_book_15")
        XCTAssertTrue(app.staticTexts["没有找到匹配的书籍"].exists)
        evidence("issue15-small-no-results", app)
        query(""); closeSearch()
        app.navigationBars.buttons["排序"].tap()
        evidence("issue15-small-sort-menu", app)
        app.buttons["书名"].tap()
        query("内核验证")
        let target = shelf.cells["book-5fd14a548f5915f58215966cdeed5c6f548b9c9ed0fd97d261597ae6c8f49026"]
        XCTAssertTrue(target.exists)
        XCTAssertLessThanOrEqual(target.frame.maxX, app.frame.width)
        evidence("issue15-small-title", app)
        // Scroll through the tall card so author, action and preparation are visible.
        shelf.swipeUp()
        evidence("issue15-small-card-details", app)
        if !target.isHittable { shelf.swipeDown() }
        target.tap(); waitForBody(app)
        XCTAssertTrue(visibleMarkers(app).contains("C2-P10"))
        evidence("issue15-small-resume", app)
        app.buttons["书架"].tap()
        query(""); closeSearch()
        app.navigationBars.buttons["排序"].tap()
        app.buttons["导入顺序"].tap()
        app.navigationBars.buttons["导入"].tap()
        evidence("issue15-small-import", app)
        let close = app.buttons.matching(NSPredicate(format: "label IN %@", ["取消", "Cancel", "Close", "关闭"])).firstMatch
        XCTAssertTrue(close.waitForExistence(timeout: 5), app.debugDescription)
        close.tap()
        XCTAssertTrue(shelf.waitForExistence(timeout: 5))
        evidence("issue15-small-returned", app)
        print("ISSUE15 small dark AX5 search clear empty sort resume import return passed")
        app.terminate()
    }
    // Seeded only in DEBUG's ShudengReadingTests directory by the issue-15 verifier.
    func testIssue15ShelfSearchSortAndResume() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--isolated-reading-test"]
        app.launch()
        let a = "book-5fd14a548f5915f58215966cdeed5c6f548b9c9ed0fd97d261597ae6c8f49026"
        let b = "book-a4d0c9451607e189d1ea7b25d9c0d5f8bb9369ecdb55696be1be527043ef5582"
        let c = searchBookID
        let shelf = app.collectionViews["library"]
        XCTAssertTrue(shelf.waitForExistence(timeout: 10))
        func ids() -> [String] { shelf.cells.allElementsBoundByIndex.map(\.identifier) }
        func query(_ text: String) {
            let field = app.searchFields["library-search"]
            field.tap()
            if field.buttons.firstMatch.exists { field.buttons.firstMatch.tap() }
            if !text.isEmpty { field.typeText(text) }
            if app.keyboards.buttons["search"].exists { app.keyboards.buttons["search"].tap() }
            else if app.keyboards.buttons["搜索"].exists { app.keyboards.buttons["搜索"].tap() }
        }
        func cancelSearch() {
            let cancel = app.buttons["取消"].exists ? app.buttons["取消"] : (app.buttons["Cancel"].exists ? app.buttons["Cancel"] : app.buttons["Close"])
            if cancel.exists { cancel.tap() }
        }
        func sort(_ name: String) {
            cancelSearch()
            app.navigationBars.buttons["排序"].tap()
            app.buttons[name].tap()
        }
        XCTAssertEqual(ids(), [b, c, a])
        evidence("issue15-grid-import-order", app)
        print("ISSUE15 initial frames=\(shelf.cells.allElementsBoundByIndex.map { $0.frame })")
        for card in shelf.cells.allElementsBoundByIndex {
            XCTAssertGreaterThanOrEqual(card.frame.minX, 0)
            XCTAssertLessThanOrEqual(card.frame.maxX, app.frame.width)
        }
        if ProcessInfo.processInfo.environment["SHUDENG_SHELF_LARGE"] != "1" {
            XCTAssertEqual(shelf.cells[b].frame.minY, shelf.cells[c].frame.minY, accuracy: 1)
            XCTAssertGreaterThan(shelf.cells[c].frame.minX, shelf.cells[b].frame.maxX)
        }
        for (term, expected) in [("内核验证", [b, a]), ("validation", [b, a]), ("original fixture", [c]), ("SEARCH-FIXTURE", [c])] {
            query(term)
            XCTAssertEqual(ids(), expected)
            evidence("issue15-query-\(term)", app)
        }
        query("zz_no_book_15")
        XCTAssertEqual(ids(), [])
        XCTAssertTrue(app.staticTexts["没有找到匹配的书籍"].exists)
        evidence("issue15-no-results", app)
        query(""); cancelSearch()
        XCTAssertEqual(ids(), [b, c, a])
        sort("书名")
        let titleOrder = ids()
        XCTAssertEqual(Set(titleOrder), Set([a, b, c]))
        XCTAssertLessThan(try XCTUnwrap(titleOrder.firstIndex(of: a)), try XCTUnwrap(titleOrder.firstIndex(of: b)))
        query("validation")
        XCTAssertEqual(ids(), [a, b])
        query(""); cancelSearch()
        XCTAssertEqual(ids(), titleOrder)
        evidence("issue15-title-order", app)
        sort("导入顺序")
        XCTAssertEqual(ids(), [b, c, a])
        // Filtering changes A from original index 2 to display index 1.
        for (id, marker) in [(a, "C2-P10"), (b, "C1-P25")] {
            query("validation")
            let card = shelf.cells[id]
            if !card.isHittable { shelf.swipeUp() }
            card.tap()
            waitForBody(app)
            XCTAssertTrue(visibleMarkers(app).contains(marker), "Expected \(id) at \(marker), saw \(visibleMarkers(app))")
            evidence("issue15-resume-\(marker)", app)
            app.buttons["书架"].tap()
            app.terminate(); app.launch()
            XCTAssertTrue(shelf.waitForExistence(timeout: 10))
            query("validation")
            if !shelf.cells[id].isHittable { shelf.swipeUp() }
            shelf.cells[id].tap(); waitForBody(app)
            XCTAssertTrue(visibleMarkers(app).contains(marker))
            evidence("issue15-restart-\(marker)", app)
            app.buttons["书架"].tap()
        }
        cancelSearch()
        app.navigationBars.buttons["导入"].tap()
        evidence("issue15-import-accessible", app)
        let cancel = app.buttons.matching(NSPredicate(format: "label IN %@", ["取消", "Cancel", "Close", "关闭"])).firstMatch
        XCTAssertTrue(cancel.waitForExistence(timeout: 5), app.debugDescription)
        cancel.tap()
        print("ISSUE15 search=4 no-results=true clear=true titleOrder=\(titleOrder) importOrder=\([b,c,a]) resume=A:C2-P10,B:C1-P25 restart=true")
        app.terminate()
    }
    private let searchBookID = "book-3c78bfd8640c246c6a6efa49667f89b3f7819721b22c9b9682281d79c97183c3"
    private let searchOtherID = "book-ad52254cb4e46c6077c7bbe4f1c1822100a98ae6916fd87cb071930b8bd45a98"
    private let searchLongID = "book-4aa9213d7e01875d35c2bd6f4409c5e902c9b57a5ce7c4ea8c03e8e888396ce8"
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
        let grid = app.collectionViews.matching(identifier: "File View").allElementsBoundByIndex.last(where: { $0.isHittable }) ?? app.collectionViews["File View"].firstMatch
        if name.hasPrefix("search-") {
            for _ in 0..<8 where !file.exists { grid.swipeUp() }
        }
        XCTAssertTrue(file.waitForExistence(timeout: 5))
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
        app.collectionViews["library"].cells[bookID].tap()
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
        app.collectionViews["library"].cells[bookID].tap()
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
        app.collectionViews["library"].cells[failedBook].tap()
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
        app.collectionViews["library"].cells[failedBook].tap()
        waitForBody(app)
        XCTAssertEqual(visibleMarkers(app), markers)
        app.buttons["阅读设置"].tap()
        XCTAssertTrue(app.segmentedControls.buttons["分页"].isSelected)
        evidence("curl-failure-recovered-restart", app)
        app.buttons["取消"].tap()
    }

    func testCurlRotationDuringInitialPrefetchPreservesUserPage() {
        continueAfterFailure = false
        let app = XCUIApplication()
        XCUIDevice.shared.orientation = .portrait
        app.launch()
        app.collectionViews["library"].cells[bookID].tap()
        waitForBody(app)
        settings(app, mode: "分页", dark: false, font: 100)
        contents("第1章", in: app)
        waitForBody(app)
        evidence("curl-busy-rotation-original", app)
        settings(app, mode: "仿真", dark: false, font: 100, wait: false)
        // Reuse the acceptance timing; the trace must independently confirm
        // that rotation interrupted an actual temporary-neighbor visit.
        Thread.sleep(forTimeInterval: 1.55)
        print("CURL_INITIAL_PREFETCH_ROTATE \(Date().timeIntervalSince1970)")
        XCUIDevice.shared.orientation = .landscapeLeft
        waitForBody(app)
        assertVisibleChapterStart(app)
        evidence("curl-busy-rotation-landscape", app)
        print("CAPTURE_CURL_INITIAL_LANDSCAPE_NOW")
        Thread.sleep(forTimeInterval: 3)
        app.terminate(); app.launch()
        app.collectionViews["library"].cells[bookID].tap()
        waitForBody(app)
        assertVisibleChapterStart(app)
        evidence("curl-busy-rotation-landscape-restart", app)
        XCUIDevice.shared.orientation = .portrait
        waitForBody(app)
        XCTAssertTrue(visibleMarkers(app).contains("C1-P01"))
    }

    private func assertVisibleChapterStart(_ app: XCUIApplication) {
        let title = app.webViews.staticTexts["第1章：原创验证文本"]
        XCTAssertTrue(title.exists)
        XCTAssertGreaterThan(title.frame.minX, 5)
        XCTAssertTrue(app.webViews.firstMatch.frame.contains(title.frame), "Must show the user's chapter start in landscape, not the temporary neighbor")
    }

    func testCurlRotationDuringCompletedTurnPrefetchKeepsTarget() {
        continueAfterFailure = false
        let app = XCUIApplication()
        XCUIDevice.shared.orientation = .portrait
        app.launch()
        app.collectionViews["library"].cells[bookID].tap()
        waitForBody(app)
        settings(app, mode: "仿真", dark: false, font: 100)
        contents("第1章", in: app)
        waitForBody(app)
        XCTAssertTrue(visibleMarkers(app).contains("C1-P01"))
        let content = app.otherElements["reading-content"]
        content.coordinate(withNormalizedOffset: CGVector(dx: 0.92, dy: 0.6)).press(forDuration: 0.1,
            thenDragTo: content.coordinate(withNormalizedOffset: CGVector(dx: 0.1, dy: 0.6)),
            withVelocity: .fast, thenHoldForDuration: 0)
        Thread.sleep(forTimeInterval: 0.9)
        print("CURL_COMPLETED_TURN_PREFETCH_ROTATE \(Date().timeIntervalSince1970)")
        XCUIDevice.shared.orientation = .landscapeLeft
        waitForBody(app)
        XCTAssertTrue(visibleMarkers(app).contains("C1-P03"), "Keep the completed target, not the previously committed first page")
        evidence("curl-completed-turn-busy-landscape", app)
        print("CAPTURE_CURL_TARGET_LANDSCAPE_NOW")
        Thread.sleep(forTimeInterval: 3)
        app.terminate(); app.launch()
        app.collectionViews["library"].cells[bookID].tap()
        waitForBody(app)
        XCTAssertTrue(visibleMarkers(app).contains("C1-P03"))
        evidence("curl-completed-turn-landscape-restart", app)
        XCUIDevice.shared.orientation = .portrait
        waitForBody(app)
        evidence("curl-completed-turn-return-portrait", app)
        // Landscape starts inside paragraph 2's first English occurrence. That
        // exact text fits at the bottom of the preceding portrait page; P03
        // need not fit too. Pair the paragraph check with the saved screenshot
        // and the reflow Locator's before/highlight/after to verify occurrence.
        XCTAssertTrue(visibleMarkers(app).contains("C1-P02"))
    }

    func testCurlRotationRebuildsUsableViewport() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        app.collectionViews["library"].cells[bookID].tap()
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
        app.collectionViews["library"].cells[bookID].tap()
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
        app.collectionViews["library"].cells[bookID].tap()
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
        XCTAssertTrue(app.collectionViews["library"].waitForExistence(timeout: 5))
        // Opening another tab keeps the old reader offscreen while pending
        // Readium callbacks drain; no hidden reader may restart or save.
        app.tabBars.buttons["我的"].tap()
        evidence("curl-left-reader", app)
        app.terminate(); app.launch()
        app.collectionViews["library"].cells[bookID].tap()
        waitForBody(app)
        XCTAssertTrue(visibleMarkers(app).contains("C1-P01"))
        evidence("curl-exit-restart-kept-committed-page", app)
    }

    func testCurlRebuildForNavigationThemeFontAndLayout() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        app.collectionViews["library"].cells[navigationBookID].tap()
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
        app.collectionViews["library"].cells[bookID].tap()
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
        app.collectionViews["library"].cells[bookID].tap()
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
        app.collectionViews["library"].cells[bookID].tap()
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
        if !app.collectionViews["library"].cells[navigationBookID].exists {
            choose("navigation-fixture.epub", in: app)
            app.alerts.buttons["知道了"].tap()
        }
        app.collectionViews["library"].cells[navigationBookID].tap()
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
        app.collectionViews["library"].cells[navigationBookID].tap()
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
        app.collectionViews["library"].cells[navigationBookID].tap()
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
        app.collectionViews["library"].cells[bookID].tap()
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
        app.collectionViews["library"].cells[bookID].tap()
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
        app.collectionViews["library"].cells[bookID].tap()
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
        app.collectionViews["library"].cells[bookID].tap()
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
        app.collectionViews["library"].cells[bookID].tap()
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
        if !app.collectionViews["library"].cells[bookID].exists {
            choose("original-fixture.epub", in: app)
            app.alerts.buttons["知道了"].tap()
        }
        app.collectionViews["library"].cells[bookID].tap()
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
        app.collectionViews["library"].cells[bookID].tap()
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
        app.collectionViews["library"].cells[bookID].tap()
        waitForText(app)
        settings(app, mode: "分页", dark: false, font: 100)
        let marker = try XCTUnwrap(visibleMarkers(app).first)
        evidence("theme-only-before-" + marker, app)
        settings(app, mode: "分页", dark: true)
        XCTAssertTrue(visibleMarkers(app).contains(marker))
        app.terminate()
        app.launch()
        app.collectionViews["library"].cells[bookID].tap()
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
        app.collectionViews["library"].cells[plainID].tap()
        XCTAssertTrue(app.staticTexts["阅读位置已保存"].waitForExistence(timeout: 20))
        for _ in 0..<3 { app.swipeLeft() }
        evidence("plain-paragraph-before", app)
        settings(app, mode: "滚动", dark: true, font: 200, wait: false)
        XCTAssertTrue(app.staticTexts["阅读位置已保存"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.webViews.staticTexts.firstMatch.waitForExistence(timeout: 15))
        evidence("plain-paragraph-200-scroll", app)
        app.terminate()
        app.launch()
        app.collectionViews["library"].cells[plainID].tap()
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
        app.collectionViews["library"].cells[bookID].tap()
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
        app.collectionViews["library"].cells[bookID].tap()
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
        app.collectionViews["library"].cells[bookID].tap()
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
        app.collectionViews["library"].cells[bookID].tap()
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
        app.collectionViews["library"].cells[bookID].tap()
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
        XCTAssertTrue(app.collectionViews["library"].waitForExistence(timeout: 5))
    }

    func testSmallScreenLargeTextControls() throws {
        guard ProcessInfo.processInfo.environment["SHUDENG_SMALL_SCREEN"] == "1" else { throw XCTSkip("Requires small simulator with accessibility text size") }
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        app.collectionViews["library"].cells[bookID].tap()
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
        XCTAssertTrue(app.collectionViews["library"].waitForExistence(timeout: 5))
    }
    func testRealPickerTurnsAndRestart() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        choose("original-fixture.epub", in: app)
        app.alerts.buttons["知道了"].tap()
        let count = app.collectionViews["library"].cells.count
        choose("original-fixture.epub", in: app)
        XCTAssertTrue(app.alerts["书籍已在书架"].exists)
        app.alerts.buttons["知道了"].tap()
        XCTAssertEqual(app.collectionViews["library"].cells.count, count)
        app.collectionViews["library"].cells[bookID].tap()
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
        app.collectionViews["library"].cells[bookID].tap()
        XCTAssertTrue(app.staticTexts["阅读位置已保存"].waitForExistence(timeout: 15))
        XCTAssertEqual(visibleMarker(app), marker)
        evidence("restored-" + marker, app)
        print("RESTORED_VISIBLE_MARKER=" + marker)
    }
    func testRealPickerRejectsBadFiles() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        let count = app.collectionViews["library"].cells.count
        for name in ["corrupted.epub", "fixed-layout.epub", "missing-chapter.epub", "unsupported"] {
            choose(name, in: app)
            XCTAssertTrue(app.alerts["导入失败"].exists)
            evidence("rejected-" + name, app)
            app.alerts.buttons["知道了"].tap()
            XCTAssertEqual(app.collectionViews["library"].cells.count, count)
        }
    }
    func testStorageFailureAndRetry() throws {
        guard ProcessInfo.processInfo.environment["SHUDENG_STORAGE_FAULT"] == "1" else {
            throw XCTSkip("Run with a real simulator filesystem fault; see delivery report.")
        }
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        app.collectionViews["library"].cells[bookID].tap()
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

extension ReadingUITests {
    private func noteMenu(_ title: String, in app: XCUIApplication) {
        let button = app.buttons[title]
        let item = app.menuItems[title]
        XCTAssertTrue(button.waitForExistence(timeout: 3) || item.waitForExistence(timeout: 2))
        evidence("note-native-selection-" + title, app)
        if button.exists { button.tap() } else { item.tap() }
    }
    private func selectForNote(_ app: XCUIApplication, action: String) {
        app.webViews.firstMatch.coordinate(withNormalizedOffset: CGVector(dx: 0.35, dy: 0.3)).press(forDuration: 1.3)
        noteMenu(action, in: app)
    }
    private func noteRow(_ text: String, in app: XCUIApplication) -> XCUIElement {
        app.tables["notes"].cells.containing(NSPredicate(format: "label CONTAINS %@", text)).firstMatch
    }
    private func replaceNoteBody(_ text: String, in app: XCUIApplication) {
        let body = app.textViews["note-body"]
        body.tap()
        // Select only the personal text view; never the quoted original.
        if !(body.value as? String ?? "").isEmpty {
            body.press(forDuration: 1.1)
            let all = app.buttons.matching(NSPredicate(format: "label IN %@", ["全选", "Select All"])).firstMatch
            let menu = app.menuItems.matching(NSPredicate(format: "label IN %@", ["全选", "Select All"])).firstMatch
            if all.waitForExistence(timeout: 2) { all.tap() }
            else if menu.exists { menu.tap() }
            else {
                body.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: (body.value as? String ?? "").count))
            }
        }
        body.typeText(text)
    }
    func testNotesNativeSelectionDraftEditReturnAndThreeModes() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        app.collectionViews["library"].cells[navigationBookID].tap()
        waitForBody(app)
        settings(app, mode: "分页", dark: false, font: 100)
        contents("第1章末", in: app)
        waitForBody(app)
        app.webViews.staticTexts["C1-P30"].firstMatch.press(forDuration: 1.3)
        noteMenu("写笔记", in: app)
        XCTAssertTrue(app.textViews["note-quote"].waitForExistence(timeout: 5))
        XCTAssertFalse((app.textViews["note-quote"].value as? String ?? "").isEmpty)
        replaceNoteBody("N6-end-v1", in: app)
        app.buttons["保存笔记"].tap()
        waitForBody(app)
        evidence("note-highlight-chapter-end", app)
        app.buttons["书架"].tap()
        app.tabBars.buttons["笔记"].tap()
        let row = noteRow("N6-end-v1", in: app)
        XCTAssertTrue(row.waitForExistence(timeout: 5))
        let id = row.identifier
        row.tap()
        replaceNoteBody("D6-end-recover", in: app)
        app.buttons["保存草稿"].tap()
        XCTAssertTrue(app.staticTexts["草稿已保存，可继续编辑"].waitForExistence(timeout: 5))
        evidence("note-existing-draft-committed-before-interruption", app)
        XCUIDevice.shared.press(.home)
        app.terminate(); app.launch()
        app.tabBars.buttons["笔记"].tap()
        let draft = app.tables["notes"].cells[id]
        XCTAssertTrue(draft.waitForExistence(timeout: 5))
        draft.tap()
        XCTAssertEqual(app.textViews["note-body"].value as? String, "D6-end-recover")
        evidence("note-draft-recovered-after-restart", app)
        replaceNoteBody("N6-end-v2", in: app)
        app.buttons["保存笔记"].tap()
        XCTAssertTrue(app.tables["notes"].cells[id].waitForExistence(timeout: 5))
        app.tables["notes"].cells[id].tap()
        app.buttons["返回原文"].tap()
        waitForBody(app)
        evidence("note-return-chapter-end", app)
        for mode in ["滚动", "仿真", "分页"] {
            settings(app, mode: mode, dark: true, font: 200)
            contents(mode == "仿真" ? "第3章" : "第2章", in: app)
            waitForBody(app)
            selectForNote(app, action: "高亮")
            waitForBody(app)
            evidence("note-highlight-" + mode, app)
            if mode == "仿真" {
                for cycle in 1...2 {
                    curlTurn(app, forward: true)
                    curlTurn(app, forward: false)
                    evidence("note-cache-rebuilt-cycle-\(cycle)", app)
                }
            }
        }
        app.buttons["书架"].tap()
        app.tabBars.buttons["笔记"].tap()
        app.tables["notes"].cells[id].tap()
        app.buttons["返回原文"].tap()
        waitForBody(app)
        evidence("note-return-after-reflow", app)
        app.terminate(); app.launch()
        app.tabBars.buttons["笔记"].tap()
        XCTAssertTrue(app.tables["notes"].cells[id].waitForExistence(timeout: 5))
        app.tables["notes"].cells[id].tap()
        XCTAssertEqual(app.textViews["note-body"].value as? String, "N6-end-v2")
        evidence("note-final-restart-same-id-and-body", app)
        app.buttons["关闭"].tap()
    }
}

extension ReadingUITests {
    func testNotesRepeatedOccurrenceSelectionAndDraftRecovery() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        app.collectionViews["library"].cells[navigationBookID].tap()
        waitForBody(app)
        settings(app, mode: "滚动", dark: false, font: 100)
        contents("第2章", in: app)
        waitForBody(app)
        let marker = app.webViews.staticTexts["C2-P20"].firstMatch
        for _ in 0..<24 where !visibleMarkers(app).contains("C2-P20") { app.webViews.firstMatch.swipeUp() }
        XCTAssertTrue(visibleMarkers(app).contains("C2-P20"))
        print("N6_REPEAT marker=\(marker.frame) body=\(app.webViews.firstMatch.frame)")
        print(app.webViews.firstMatch.debugDescription)
        evidence("repeat-p20-before-native-selection", app)
        // The second English occurrence is in the same paragraph after its
        // first Chinese/English pair. Only native touches create the selection.
        marker.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0)).withOffset(CGVector(dx: 150, dy: 105)).press(forDuration: 1.3)
        let origin = app.coordinate(withNormalizedOffset: .zero)
        origin.withOffset(CGVector(dx: 20, dy: marker.frame.minY + 94)).press(forDuration: 0.1,
            thenDragTo: origin.withOffset(CGVector(dx: 349, dy: marker.frame.minY + 55)), withVelocity: .slow, thenHoldForDuration: 0.3)
        noteMenu("写笔记", in: app)
        XCTAssertEqual(app.textViews["note-quote"].value as? String, "The same sentence can belong to a different argument.")
        replaceNoteBody("D6-R1-new-draft", in: app)
        app.buttons["保存草稿"].tap()
        XCTAssertTrue(app.staticTexts["草稿已保存，可继续编辑"].waitForExistence(timeout: 5))
        evidence("repeat-new-draft-before-interruption", app)
        app.terminate(); app.launch()
        app.tabBars.buttons["笔记"].tap()
        let row = noteRow("D6-R1-new-draft", in: app)
        XCTAssertTrue(row.waitForExistence(timeout: 5))
        let id = row.identifier
        row.tap()
        XCTAssertEqual(app.textViews["note-body"].value as? String, "D6-R1-new-draft")
        evidence("repeat-new-draft-restored", app)
        replaceNoteBody("N6-R1-v1", in: app)
        app.buttons["保存笔记"].tap()
        app.tables["notes"].cells[id].tap()
        replaceNoteBody("D6-R1-v2-survives-rehighlight", in: app)
        app.buttons["保存草稿"].tap()
        app.buttons["返回原文"].tap()
        waitForBody(app)
        evidence("repeat-return-exact-occurrence", app)
        print("N6_REPEAT_RETURN \(app.webViews.firstMatch.debugDescription)")
        app.buttons["书架"].tap()
        app.tabBars.buttons["笔记"].tap()
        XCTAssertTrue(app.tables["notes"].cells[id].exists)
        app.tables["notes"].cells[id].tap()
        XCTAssertEqual(app.textViews["note-body"].value as? String, "D6-R1-v2-survives-rehighlight")
        evidence("repeat-draft-retained-after-return", app)
        app.buttons["关闭"].tap()
    }
}

extension ReadingUITests {
    func testNoteHighlightRealWriteFailureAndRetry() throws {
        guard ProcessInfo.processInfo.environment["SHUDENG_NOTE_FAULT"] == "1" else { throw XCTSkip("Run with scripts/verify-note-failure.sh") }
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        app.collectionViews["library"].cells[bookID].tap()
        waitForBody(app)
        settings(app, mode: "分页", dark: false, font: 100)
        contents("第2章", in: app)
        waitForBody(app)
        print("N6_INJECT_HIGHLIGHT_FAULT")
        Thread.sleep(forTimeInterval: 3)
        selectForNote(app, action: "高亮")
        XCTAssertTrue(app.alerts["高亮保存失败"].waitForExistence(timeout: 5))
        evidence("note-real-highlight-write-failure", app)
        print("N6_RESTORE_HIGHLIGHT_FAULT")
        Thread.sleep(forTimeInterval: 3)
        app.alerts.buttons["重试保存高亮"].tap()
        XCTAssertFalse(app.alerts["高亮保存失败"].exists)
        evidence("note-highlight-retry-succeeded", app)
    }

    func testNoteEditRealWriteFailureAndRetry() throws {
        guard ProcessInfo.processInfo.environment["SHUDENG_NOTE_FAULT"] == "1" else { throw XCTSkip("Run with scripts/verify-note-failure.sh") }
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        app.tabBars.buttons["笔记"].tap()
        let row = noteRow("N6-end-v2", in: app)
        XCTAssertTrue(row.waitForExistence(timeout: 5))
        let id = row.identifier
        row.tap()
        replaceNoteBody("D6-fault-durable", in: app)
        app.buttons["保存草稿"].tap()
        XCTAssertTrue(app.staticTexts["草稿已保存，可继续编辑"].waitForExistence(timeout: 5))
        print("N6_INJECT_EDIT_FAULT")
        Thread.sleep(forTimeInterval: 3)
        replaceNoteBody("N6-fault-v2", in: app)
        app.buttons["保存笔记"].tap()
        XCTAssertTrue(app.staticTexts["笔记保存失败，内容仍在此页；请重试保存笔记"].waitForExistence(timeout: 5))
        evidence("note-real-edit-write-failure", app)
        app.buttons["关闭"].tap()
        XCTAssertTrue(app.textViews["note-body"].exists)
        XCTAssertTrue(app.staticTexts["草稿保存失败，内容仍在此页；请重试保存草稿"].exists)
        evidence("note-failed-draft-prevents-close", app)
        print("N6_RESTORE_EDIT_FAULT")
        Thread.sleep(forTimeInterval: 3)
        app.buttons["保存笔记"].tap()
        XCTAssertTrue(app.tables["notes"].cells[id].waitForExistence(timeout: 5))
        app.terminate(); app.launch()
        app.tabBars.buttons["笔记"].tap()
        app.tables["notes"].cells[id].tap()
        XCTAssertEqual(app.textViews["note-body"].value as? String, "N6-fault-v2")
        evidence("note-real-write-retry-restart-same-id", app)
        app.buttons["关闭"].tap()
    }
}

extension ReadingUITests {
    func testNoteExactChapterEndAndNewCurlHighlightCache() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        app.collectionViews["library"].cells[navigationBookID].tap()
        waitForBody(app)
        settings(app, mode: "分页", dark: false, font: 100)
        contents("第1章末", in: app)
        waitForBody(app)
        let marker = app.webViews.staticTexts["C1-P30"].firstMatch
        XCTAssertTrue(app.webViews.firstMatch.frame.intersects(marker.frame))
        marker.press(forDuration: 1.3)
        noteMenu("写笔记", in: app)
        replaceNoteBody("N6-exact-P30", in: app)
        evidence("note-exact-P30-editor", app)
        app.buttons["保存笔记"].tap()
        app.buttons["书架"].tap()
        app.tabBars.buttons["笔记"].tap()
        let row = noteRow("N6-exact-P30", in: app)
        XCTAssertTrue(row.waitForExistence(timeout: 5))
        let id = row.identifier
        row.tap(); app.buttons["返回原文"].tap()
        waitForBody(app)
        evidence("note-exact-P30-return", app)
        settings(app, mode: "仿真", dark: true, font: 200)
        evidence("note-exact-P30-curl-200-dark", app)
        contents("第3章", in: app)
        waitForBody(app)
        selectForNote(app, action: "高亮")
        waitForBody(app)
        evidence("note-new-chapter3-curl-highlight", app)
        for cycle in 1...2 {
            curlTurn(app, forward: true)
            curlTurn(app, forward: false)
            evidence("note-new-chapter3-cache-round-\(cycle)", app)
        }
        app.buttons["书架"].tap()
        app.tabBars.buttons["笔记"].tap()
        app.tables["notes"].cells[id].tap(); app.buttons["返回原文"].tap()
        waitForBody(app)
        evidence("note-exact-P30-after-cross-chapter-curl", app)
        settings(app, mode: "滚动", dark: true, font: 200)
        evidence("note-exact-P30-scroll-200-dark", app)
        app.terminate(); app.launch()
        app.tabBars.buttons["笔记"].tap()
        app.tables["notes"].cells[id].tap(); app.buttons["返回原文"].tap()
        waitForBody(app)
        evidence("note-exact-P30-restart", app)
    }

    func testNoteRepeatedParagraphAndChapterIdentity() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        for (chapter, paragraph, name) in [(2, 10, "N6-R2"), (3, 20, "N6-R3")] {
            app.collectionViews["library"].cells[navigationBookID].tap()
            waitForBody(app)
            settings(app, mode: "滚动", dark: false, font: 100)
            contents("第\(chapter)章", in: app)
            waitForBody(app)
            let text = String(format: "C%d-P%02d", chapter, paragraph)
            for _ in 0..<24 where !visibleMarkers(app).contains(text) { app.webViews.firstMatch.swipeUp() }
            let marker = app.webViews.staticTexts[text].firstMatch
            XCTAssertTrue(visibleMarkers(app).contains(text))
            app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: 170, dy: marker.frame.minY + 105)).press(forDuration: 1.3)
            noteMenu("写笔记", in: app)
            XCTAssertEqual(app.textViews["note-quote"].value as? String, "argument.")
            replaceNoteBody(name, in: app)
            app.buttons["保存笔记"].tap()
            contents("第1章", in: app)
            waitForBody(app)
            app.buttons["书架"].tap(); app.tabBars.buttons["笔记"].tap()
            noteRow(name, in: app).tap(); app.buttons["返回原文"].tap()
            waitForBody(app)
            evidence(name + "-return-after-leaving-chapter", app)
            app.buttons["书架"].tap(); app.tabBars.buttons["书架"].tap()
        }
    }

    func testNoteSmallScreenLargeTextKeyboardAndReturn() throws {
        guard ProcessInfo.processInfo.environment["SHUDENG_SMALL_SCREEN"] == "1" else { throw XCTSkip("Small screen only") }
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        // Arrange the real P30 record from the main simulator, preserving a
        // backup of this simulator's original catalog; no application hooks.
        app.tabBars.buttons["笔记"].tap()
        noteRow("N6-exact-P30", in: app).tap()
        replaceNoteBody("N6-small-keyboard", in: app)
        XCTAssertTrue(app.keyboards.firstMatch.exists)
        evidence("note-small-keyboard-large-text", app)
        app.buttons["保存草稿"].tap()
        XCTAssertTrue(app.staticTexts["草稿已保存，可继续编辑"].waitForExistence(timeout: 5))
        app.buttons["保存笔记"].tap()
        app.buttons["书架"].tap(); app.tabBars.buttons["笔记"].tap()
        noteRow("N6-small-keyboard", in: app).tap()
        app.buttons["返回原文"].tap()
        waitForBody(app)
        evidence("note-small-return", app)
    }
}

extension ReadingUITests {
    private func searchBook(_ app: XCUIApplication, query: String, count: Int) {
        app.buttons["目录与书签"].tap()
        XCTAssertTrue(app.buttons["书内搜索"].waitForExistence(timeout: 5))
        app.buttons["书内搜索"].tap()
        searchQuery(app, query: query, count: count)
    }

    func testBookSearchHiddenVisibleInlineIsolationRebuildAndRestart() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        app.collectionViews["library"].cells[searchBookID].tap()
        if app.alerts["翻页准备失败"].waitForExistence(timeout: 1) { app.alerts.buttons["使用分页"].tap() }
        waitForBody(app)
        settings(app, mode: "仿真", dark: true, font: 150)
        searchBook(app, query: "CAFE", count: 1)
        app.tables["book-search-results"].cells.firstMatch.tap()
        waitForBody(app)
        evidence("search-inline-accent-native-position-curl-focused", app)
        searchBook(app, query: "OTHER-ONLY", count: 0)
        app.buttons["重新准备"].tap()
        XCTAssertTrue(app.staticTexts["书内资料可用（2章）"].waitForExistence(timeout: 15))
        evidence("search-explicit-rebuild-focused", app)
        app.navigationBars.buttons.element(boundBy: 0).tap()
        app.buttons["完成"].tap()
        app.buttons["书架"].tap()
        app.collectionViews["library"].cells[searchOtherID].tap()
        waitForBody(app)
        searchBook(app, query: "S1-SECOND", count: 0)
        searchQuery(app, query: "OTHER-ONLY", count: 2)
        evidence("search-other-book-only-focused", app)
        app.tables["book-search-results"].cells.element(boundBy: 1).tap()
        waitForBody(app)
        app.terminate(); app.launch()
        app.collectionViews["library"].cells[searchBookID].tap()
        waitForBody(app)
        searchBook(app, query: "重复句出现位置", count: 3)
        searchHit(app, containing: "S1-SECOND")
        searchMarkerVisible(app, "S1-SECOND")
        evidence("search-focused-restart-second-original", app)
    }

    func testBookPreparationRealWriteFailureRetryAndReading() throws {
        guard ProcessInfo.processInfo.environment["SHUDENG_INDEX_FAULT"] == "1" else { throw XCTSkip("Run with scripts/verify-index-failure.sh") }
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        app.collectionViews["library"].cells[searchBookID].tap()
        waitForBody(app)
        searchBook(app, query: "S1-SECOND", count: 1)
        print("I8_INJECT_INDEX_FAULT")
        Thread.sleep(forTimeInterval: 3)
        app.buttons["重新准备"].tap()
        let failure = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "资料准备失败")).firstMatch
        XCTAssertTrue(failure.waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["重试准备"].exists)
        evidence("search-real-sqlite-write-failure-visible", app)
        app.navigationBars.buttons.element(boundBy: 0).tap()
        app.buttons["完成"].tap()
        waitForBody(app)
        evidence("search-index-failure-still-reading", app)
        searchBook(app, query: "S1-SECOND", count: 1)
        print("I8_RESTORE_INDEX_FAULT")
        Thread.sleep(forTimeInterval: 3)
        app.buttons["重试准备"].tap()
        XCTAssertTrue(app.staticTexts["书内资料可用（2章）"].waitForExistence(timeout: 15))
        searchHit(app, containing: "S1-SECOND")
        searchMarkerVisible(app, "S1-SECOND")
        evidence("search-real-write-retry-still-exact-occurrence", app)
    }

    func testBookSearchSharedNavigationContentsAndBookmarkRegression() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        app.collectionViews["library"].cells[searchBookID].tap()
        waitForBody(app)
        contents("搜索第2章", in: app)
        waitForBody(app)
        searchMarkerVisible(app, "S2-CROSS")
        app.buttons["目录与书签"].tap()
        app.buttons["添加书签"].tap()
        XCTAssertTrue(app.staticTexts["书签已保存"].waitForExistence(timeout: 5))
        let saved = app.tables["book-navigation"].cells.matching(NSPredicate(format: "identifier BEGINSWITH %@", "bookmark-")).allElementsBoundByIndex.last!
        let id = saved.identifier
        app.buttons["完成"].tap()
        contents("搜索第1章", in: app)
        waitForBody(app)
        app.buttons["目录与书签"].tap()
        app.segmentedControls.buttons["书签"].tap()
        app.tables["book-navigation"].cells[id].tap()
        waitForBody(app)
        searchMarkerVisible(app, "S2-CROSS")
        evidence("search-shared-native-refresh-contents-bookmark-return", app)
    }

    func testBookSearchVisibleAfterNestedHiddenSamePageJump() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        app.collectionViews["library"].cells[searchBookID].tap()
        waitForBody(app)
        searchBook(app, query: "CAFE", count: 1)
        app.tables["book-search-results"].cells.firstMatch.tap()
        waitForBody(app)
        searchBook(app, query: "后续可见", count: 1)
        app.tables["book-search-results"].cells.firstMatch.tap()
        waitForBody(app)
        XCTAssertFalse(app.alerts["无法定位原文"].exists)
        XCTAssertFalse(app.alerts["翻页准备失败"].exists)
        evidence("search-visible-after-nested-hidden-same-page-native-refresh", app)
    }
    private func searchQuery(_ app: XCUIApplication, query: String, count: Int) {
        let field = app.searchFields["book-search-query"]
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.tap()
        let clear = field.buttons.firstMatch
        if clear.exists { clear.tap() }
        field.typeText(query + "\n")
        let expected = count == 0 ? "已准备原文中没有匹配结果" : "找到\(count)处原文"
        XCTAssertTrue(app.staticTexts[expected].waitForExistence(timeout: 15))
        XCTAssertEqual(app.tables["book-search-results"].cells.count, count)
    }
    private func searchHit(_ app: XCUIApplication, containing marker: String) {
        let hit = app.tables["book-search-results"].cells.containing(NSPredicate(format: "label CONTAINS %@", marker)).firstMatch
        XCTAssertTrue(hit.waitForExistence(timeout: 5))
        hit.tap()
        waitForBody(app)
        evidence("search-arrived-" + marker, app)
    }
    private func searchMarkerVisible(_ app: XCUIApplication, _ text: String) {
        let marker = app.webViews.staticTexts[text].firstMatch
        XCTAssertTrue(marker.waitForExistence(timeout: 5))
        let body = app.webViews.firstMatch.frame
        XCTAssertTrue(marker.frame.width > 0 && marker.frame.minX > 5 && body.contains(marker.frame), "Original marker is outside rendered viewport: \(text)")
    }
    func testBookSearchChineseEnglishRepeatedOccurrenceHiddenAndThreeModes() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        for name in ["search-fixture.epub", "search-other.epub"] {
            choose(name, in: app)
            app.alerts.buttons["知道了"].tap()
        }
        app.collectionViews["library"].cells[searchBookID].tap()
        waitForBody(app)
        settings(app, mode: "分页", dark: false, font: 100)
        searchBook(app, query: "the same sentence", count: 3)
        evidence("search-english-three-original-occurrences", app)
        searchHit(app, containing: "S1-SECOND")
        searchMarkerVisible(app, "S1-SECOND")
        settings(app, mode: "滚动", dark: true, font: 200)
        searchBook(app, query: "重复句出现位置", count: 3)
        evidence("search-chinese-same-paragraph-second-occurrence", app)
        searchHit(app, containing: "S1-SECOND")
        searchMarkerVisible(app, "S1-SECOND")
        settings(app, mode: "仿真", dark: true, font: 150)
        searchBook(app, query: "the same sentence", count: 3)
        searchHit(app, containing: "S2-CROSS")
        searchMarkerVisible(app, "S2-CROSS")
        searchBook(app, query: "the same sentence", count: 3)
        searchHit(app, containing: "S1-FIRST")
        curlTurn(app, forward: true)
        curlTurn(app, forward: false)
        searchMarkerVisible(app, "S1-FIRST")
        evidence("search-curl-cache-return-first-occurrence", app)
        searchBook(app, query: "隐秘标记", count: 0)
        evidence("search-hidden-descendant-not-indexed", app)
        searchQuery(app, query: "后续可见", count: 1)
        app.tables["book-search-results"].cells.firstMatch.tap()
        waitForBody(app)
        evidence("search-visible-after-hidden-exact-offset", app)
        searchBook(app, query: "CAFE", count: 1)
        app.tables["book-search-results"].cells.firstMatch.tap()
        waitForBody(app)
        evidence("search-inline-entity-emoji-accent-original", app)
        searchBook(app, query: "OTHER-ONLY", count: 0)
        evidence("search-current-book-isolation", app)
        app.buttons["重新准备"].tap()
        XCTAssertTrue(app.staticTexts["书内资料可用（2章）"].waitForExistence(timeout: 15))
        evidence("search-explicit-rebuild-ready", app)
        app.navigationBars.buttons.element(boundBy: 0).tap()
        app.buttons["完成"].tap()
        app.buttons["书架"].tap()
        app.collectionViews["library"].cells[searchOtherID].tap()
        waitForBody(app)
        searchBook(app, query: "S1-SECOND", count: 0)
        searchQuery(app, query: "OTHER-ONLY", count: 2)
        evidence("search-other-book-only-own-original", app)
        app.tables["book-search-results"].cells.element(boundBy: 1).tap()
        waitForBody(app)
        app.terminate()
        app.launch()
        app.collectionViews["library"].cells[searchBookID].tap()
        waitForBody(app)
        searchBook(app, query: "重复句出现位置", count: 3)
        searchHit(app, containing: "S1-SECOND")
        searchMarkerVisible(app, "S1-SECOND")
        evidence("search-restart-original-identity-retained", app)
        print("I8_UI original-second-occurrence=true Chinese=3 English=3 hidden=0 visible-after-hidden=1 other-book=isolated modes=3 restart=true")
    }

    func testBookPreparationLongImportReadInterruptAndResume() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        choose("search-long.epub", in: app)
        app.alerts.buttons["知道了"].tap()
        let row = app.collectionViews["library"].cells[searchLongID]
        XCTAssertTrue(row.waitForExistence(timeout: 5))
        XCTAssertTrue((row.value as? String ?? "").contains("正在准备"))
        evidence("search-long-preparing-does-not-block-shelf", app)
        row.tap()
        waitForBody(app)
        evidence("search-long-reading-during-preparation", app)
        print("I8_LONG_BEFORE_INTERRUPT")
        app.terminate()
        print("I8_LONG_TERMINATED")
        // The sidecar snapshots committed SQLite after termination, before startup resumes.
        Thread.sleep(forTimeInterval: 3)
        app.launch()
        let ready = NSPredicate { _, _ in (app.collectionViews["library"].cells[self.searchLongID].value as? String ?? "").contains("书内资料可用") }
        expectation(for: ready, evaluatedWith: app)
        waitForExpectations(timeout: 180)
        evidence("search-long-resumed-all-chapters-committed", app)
        app.collectionViews["library"].cells[searchLongID].tap()
        waitForBody(app)
        searchBook(app, query: "L40-P500", count: 1)
        app.tables["book-search-results"].cells.firstMatch.tap()
        waitForBody(app)
        evidence("search-long-last-committed-chapter-real-jump", app)
        print("I8_LONG_RESUMED")
    }
}

extension ReadingUITests {
    private func questionService(_ app: XCUIApplication, format: String, model: String = "test-model", address: String = "http://127.0.0.1:18769/v1") {
        app.tabBars.buttons["我的"].tap()
        if !app.tables["ai-services"].exists { app.buttons["AI 服务"].tap() }
        app.buttons["添加"].tap()
        let name = "I9-" + format + "-" + model + "-" + UUID().uuidString.prefix(6)
        app.textFields["ai-name"].tap(); app.textFields["ai-name"].typeText(name)
        if format == "Anthropic" { app.cells["ai-format"].tap(); app.buttons["Anthropic"].tap() }
        app.textFields["ai-address"].tap(); app.textFields["ai-address"].typeText(address)
        app.textFields["ai-model"].tap(); app.textFields["ai-model"].typeText(model)
        app.secureTextFields["ai-key"].tap(); app.secureTextFields["ai-key"].typeText("not-a-real-credential")
        app.navigationBars.buttons["保存"].tap()
        app.tables["ai-services"].cells.containing(NSPredicate(format: "label CONTAINS %@", name)).firstMatch.tap()
        app.tables.firstMatch.swipeUp()
        app.cells["ai-select"].tap(); app.alerts.buttons["使用已保存配置"].tap()
        app.tabBars.buttons["书架"].tap()
    }
    private func questionSelection(_ app: XCUIApplication) {
        app.collectionViews["library"].cells[searchBookID].tap()
        if app.alerts["翻页准备失败"].waitForExistence(timeout: 3) { app.alerts.buttons["使用分页"].tap() }
        waitForBody(app)
        settings(app, mode: "滚动", dark: false, font: 100)
        searchBook(app, query: "S1-SECOND", count: 1)
        app.tables["book-search-results"].cells.firstMatch.tap(); waitForBody(app)
        let marker = app.webViews.staticTexts["S1-SECOND"].firstMatch
        XCTAssertTrue(marker.waitForExistence(timeout: 5))
        marker.press(forDuration: 1.3)
        noteMenu("提问", in: app)
        XCTAssertTrue(app.textViews["question-input"].waitForExistence(timeout: 5))
        evidence("issue9-real-selection-panel", app)
    }
    private func sendSelectedQuestion(_ app: XCUIApplication, text: String) {
        let input = app.textViews["question-input"]
        input.tap(); input.typeText(text)
        app.buttons["question-send"].tap()
        XCTAssertTrue(app.alerts["发送书内原文"].waitForExistence(timeout: 5))
        evidence("issue9-disclosure-before-send", app)
        app.alerts.buttons["发送并查找书内依据"].tap()
    }
    private func questionSaved(_ app: XCUIApplication) {
        let label = app.staticTexts["question-status"]
        let ready = NSPredicate { _, _ in label.label == "回答已保存" }
        expectation(for: ready, evaluatedWith: app); waitForExpectations(timeout: 15)
    }
    func testSemanticBackgroundCitationActualHTTPJumpAndReturn() throws {
        continueAfterFailure = false
        let app = XCUIApplication(); app.launch()
        let book = app.collectionViews["library"].cells["book-df8c4a78180b9f65911e9fbba7cf4fb9c6f932c0e98456ef15e165157d9b1a67"]
        if !book.exists {
            choose("A-semantic.epub", in: app)
            app.alerts.buttons["知道了"].tap()
        }
        let ready = NSPredicate { _, _ in (book.value as? String ?? "").contains("书内资料可用") }
        expectation(for: ready, evaluatedWith: app); waitForExpectations(timeout: 60)
        questionService(app, format: "OpenAI", model: "semantic-background", address: "http://127.0.0.1:18770/v1")
        book.tap(); waitForBody(app)
        settings(app, mode: "滚动", dark: false, font: 100)
        searchBook(app, query: "建设预算", count: 1)
        app.tables["book-search-results"].cells.firstMatch.tap(); waitForBody(app)
        let selected = "作者没有在书里给出盐桥计划的建设预算，也没有给出任何商业报价。读者不能从设备数量推出项目费用。"
        let marker = app.webViews.staticTexts[selected].firstMatch
        XCTAssertTrue(marker.waitForExistence(timeout: 5))
        marker.press(forDuration: 1.3); noteMenu("提问", in: app)
        evidence("issue10-actual-selection-and-forced-neighbors", app)
        sendSelectedQuestion(app, text: "切掉首要电源后，哪两件装置依旧运转？")
        questionSaved(app)
        app.scrollViews["question-scroll"].swipeUp()
        app.buttons["question-reference-0"].tap()
        evidence("issue10-semantic-background-verified-reference", app)
        app.buttons["跳转原文"].tap(); waitForBody(app)
        let target = "每座站的温度仪由主电池供电，计时器和记录器则接在独立的备用电池上。主供电切断后，后两者继续工作，温度仪停止。"
        searchMarkerVisible(app, target)
        evidence("issue10-semantic-db-evidence-exact-original-jump", app)
        app.buttons["回提问处"].tap(); waitForBody(app)
        searchMarkerVisible(app, selected)
        evidence("issue10-semantic-reference-return-to-real-selection", app)
        app.buttons["书架"].tap(); app.terminate()
    }
    func testQuestionAnthropicSelectionReferencesRestartAndDraft() throws {
        continueAfterFailure = false
        let app = XCUIApplication(); app.launch()
        for format in ["Anthropic"] {
            questionService(app, format: format)
            questionSelection(app)
            sendSelectedQuestion(app, text: "Why sentence? I9 " + format)
            questionSaved(app)
            XCTAssertTrue(app.staticTexts["question-answer"].label.contains("依据原文"))
            XCTAssertTrue(app.staticTexts["question-scope"].label.contains("未通过本次原文核验"))
            app.scrollViews["question-scroll"].swipeUp()
            let reference = app.buttons["question-reference-0"]
            XCTAssertTrue(reference.waitForExistence(timeout: 5)); reference.tap()
            XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS 'S1-SECOND'")).firstMatch.exists)
            evidence("issue9-" + format + "-verified-reference-snapshot", app)
            app.buttons["跳转原文"].tap(); waitForBody(app)
            searchMarkerVisible(app, "S1-SECOND")
            evidence("issue9-" + format + "-exact-second-occurrence", app)
            app.buttons["回提问处"].tap(); waitForBody(app)
            searchMarkerVisible(app, "S1-SECOND")
            app.buttons["书架"].tap()
        }
        questionSelection(app)
        let input = app.textViews["question-input"]
        input.tap(); input.typeText("I9 recoverable draft")
        app.buttons["关闭"].tap(); app.buttons["书架"].tap()
        app.terminate(); app.launch(); app.tabBars.buttons["对话"].tap()
        let history = app.tables["question-history"]
        XCTAssertTrue(history.cells.containing(NSPredicate(format: "label CONTAINS 'I9 Anthropic'")).firstMatch.exists)
        history.cells.containing(NSPredicate(format: "label CONTAINS 'I9 recoverable draft'")).firstMatch.tap()
        XCTAssertEqual(app.textViews["question-input"].value as? String, "I9 recoverable draft")
        evidence("issue9-restarted-draft", app)
        app.buttons["关闭"].tap()
        history.cells.containing(NSPredicate(format: "label CONTAINS 'I9 Anthropic'")).firstMatch.tap()
        XCTAssertTrue(app.staticTexts["question-answer"].label.contains("依据原文"))
        questionSaved(app); evidence("issue9-offline-history-saved-answer", app)
    }
    func testQuestionClosePanelCancelNetworkAndNoEvidence() throws {
        continueAfterFailure = false
        let app = XCUIApplication(); app.launch()
        questionService(app, format: "OpenAI", model: "slow")
        questionSelection(app); sendSelectedQuestion(app, text: "Why sentence? I9 close-panel")
        app.buttons["关闭"].tap(); XCTAssertTrue(app.webViews.firstMatch.exists)
        Thread.sleep(forTimeInterval: 9)
        app.buttons["书架"].tap(); app.tabBars.buttons["对话"].tap()
        app.tables["question-history"].cells.containing(NSPredicate(format: "label CONTAINS 'I9 close-panel'")).firstMatch.tap()
        questionSaved(app); evidence("issue9-closed-panel-kept-generating", app); app.buttons["关闭"].tap()
        app.tabBars.buttons["书架"].tap(); questionSelection(app)
        sendSelectedQuestion(app, text: "Why sentence? I9 cancel")
        XCTAssertTrue(app.buttons["取消生成"].waitForExistence(timeout: 5)); app.buttons["取消生成"].tap()
        XCTAssertTrue(app.staticTexts["question-status"].label.contains("主动取消"))
        evidence("issue9-cancel-incomplete", app); app.buttons["关闭"].tap(); app.buttons["书架"].tap()
        questionService(app, format: "OpenAI", model: "network-failure")
        questionSelection(app); sendSelectedQuestion(app, text: "Why sentence? I9 network")
        let status = app.staticTexts["question-status"]
        expectation(for: NSPredicate { _, _ in status.label.contains("网络或服务") }, evaluatedWith: app); waitForExpectations(timeout: 10)
        XCTAssertTrue(app.textViews["question-input"].value as? String == "Why sentence? I9 network")
        evidence("issue9-network-retained-question", app); app.buttons["关闭"].tap(); app.buttons["书架"].tap()
        questionService(app, format: "Anthropic", model: "no-evidence")
        questionSelection(app); sendSelectedQuestion(app, text: "I9 no evidence unknown answer")
        questionSaved(app)
        XCTAssertTrue(app.staticTexts["question-scope"].label.contains("未提供可核查"))
        XCTAssertFalse(app.buttons["question-reference-0"].exists)
        evidence("issue9-no-evidence-no-valid-links", app)
    }
}

extension ReadingUITests {
    func testQuestionRealAnswerWriteFailureAndSameOperationRetry() throws {
        continueAfterFailure = false
        let app = XCUIApplication(); app.launch()
        questionService(app, format: "OpenAI", model: "slow")
        let questionText = "Why sentence? I9 write-failure " + UUID().uuidString
        questionSelection(app); sendSelectedQuestion(app, text: questionText)
        print("I9_INJECT_ANSWER_WRITE_FAULT")
        let status = app.staticTexts["question-status"]
        expectation(for: NSPredicate { _, _ in status.label.contains("保存失败") }, evaluatedWith: app)
        waitForExpectations(timeout: 15)
        XCTAssertFalse(status.label.contains("回答已保存"))
        XCTAssertTrue(app.staticTexts["question-answer"].label.contains("依据原文"))
        evidence("issue9-real-answer-write-failure-not-complete", app)
        print("I9_RESTORE_ANSWER_WRITE_FAULT")
        Thread.sleep(forTimeInterval: 4)
        app.buttons["重试保存"].tap(); questionSaved(app)
        evidence("issue9-same-operation-save-retry", app)
        app.terminate(); app.launch(); app.tabBars.buttons["对话"].tap()
        let rows = app.tables["question-history"].cells.containing(NSPredicate(format: "label CONTAINS %@", questionText))
        XCTAssertEqual(rows.count, 1); rows.firstMatch.tap(); questionSaved(app)
        XCTAssertTrue(app.staticTexts["question-answer"].label.contains("依据原文"))
        evidence("issue9-write-retry-restart-one-record", app)
    }
    func testQuestionVisibleInlineNeighborsActualHTTPAndSecondReference() throws {
        continueAfterFailure = false
        let app = XCUIApplication(); app.launch()
        questionService(app, format: "OpenAI")
        app.collectionViews["library"].cells[searchBookID].tap(); waitForBody(app)
        settings(app, mode: "滚动", dark: false, font: 100)
        searchBook(app, query: "后续可见", count: 1)
        app.tables["book-search-results"].cells.firstMatch.tap(); waitForBody(app)
        let text = app.webViews.staticTexts["后续可见"].firstMatch
        XCTAssertTrue(text.waitForExistence(timeout: 5)); text.press(forDuration: 1.3)
        noteMenu("提问", in: app)
        sendSelectedQuestion(app, text: "Why sentence? I9 visible-inline")
        questionSaved(app)
        app.scrollViews["question-scroll"].swipeUp(); app.buttons["question-reference-1"].tap()
        evidence("issue9-visible-run-reference-after-nested-hidden", app)
        app.buttons["跳转原文"].tap(); waitForBody(app)
        XCTAssertTrue(app.webViews.staticTexts["后续可见"].firstMatch.exists)
        evidence("issue9-visible-run-precise-navigation", app)
    }
}

extension ReadingUITests {
    func testQuestionIncompletePreparationWaitThenExplicitLocalChoice() throws {
        continueAfterFailure = false
        let app = XCUIApplication(); app.launch()
        questionService(app, format: "OpenAI")
        app.collectionViews["library"].cells[searchBookID].tap(); waitForBody(app)
        settings(app, mode: "滚动", dark: false, font: 100)
        searchBook(app, query: "S1-SECOND", count: 1)
        app.tables["book-search-results"].cells.firstMatch.tap(); waitForBody(app)
        searchBook(app, query: "S1-SECOND", count: 1)
        print("I9_INJECT_PREPARATION_FAULT")
        Thread.sleep(forTimeInterval: 3)
        app.buttons["重新准备"].tap()
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS '资料准备失败'")).firstMatch.waitForExistence(timeout: 10))
        app.navigationBars.buttons.element(boundBy: 0).tap(); app.buttons["完成"].tap()
        app.webViews.staticTexts["S1-SECOND"].firstMatch.press(forDuration: 1.3); noteMenu("提问", in: app)
        app.textViews["question-input"].tap(); app.textViews["question-input"].typeText("I9 explicit-local sentence")
        app.buttons["question-send"].tap()
        XCTAssertTrue(app.alerts["资料尚未准备完整"].waitForExistence(timeout: 5))
        evidence("issue9-preparation-wait-or-local-choice", app)
        app.alerts.buttons["等待资料准备"].tap()
        XCTAssertEqual(app.staticTexts["question-status"].label, "问题草稿")
        app.buttons["question-send"].tap(); app.alerts.buttons["仅用选文和邻文解释"].tap()
        questionSaved(app)
        XCTAssertTrue(app.staticTexts["question-scope"].label.contains("主动选择局部"))
        evidence("issue9-explicit-local-saved-scope", app)
        print("I9_RESTORE_PREPARATION_FAULT")
        Thread.sleep(forTimeInterval: 3)
        app.terminate(); app.launch()
        XCTAssertTrue(app.collectionViews["library"].cells[searchBookID].waitForExistence(timeout: 5))
        let cell = app.collectionViews["library"].cells[searchBookID]
        expectation(for: NSPredicate { _, _ in (cell.value as? String ?? "").contains("书内资料可用") }, evaluatedWith: app)
        waitForExpectations(timeout: 15)
    }
}

extension ReadingUITests {
    func testQuestionDifferentOriginSecondRepeatedSentenceAndReturn() throws {
        continueAfterFailure = false
        let app = XCUIApplication(); app.launch()
        questionService(app, format: "OpenAI", model: "jump-second")
        app.collectionViews["library"].cells[searchBookID].tap(); waitForBody(app)
        settings(app, mode: "滚动", dark: false, font: 100)
        searchBook(app, query: "后续可见", count: 1)
        app.tables["book-search-results"].cells.firstMatch.tap(); waitForBody(app)
        app.webViews.staticTexts["后续可见"].firstMatch.press(forDuration: 1.3); noteMenu("提问", in: app)
        sendSelectedQuestion(app, text: "Why sentence? I9 distinct-origin-second-repeat")
        questionSaved(app)
        app.scrollViews["question-scroll"].swipeUp(); app.buttons["question-reference-0"].tap()
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS 'S1-SECOND'")).firstMatch.exists)
        evidence("issue9-second-sentence-snapshot-from-different-origin", app)
        app.buttons["跳转原文"].tap(); waitForBody(app)
        searchMarkerVisible(app, "S1-SECOND")
        evidence("issue9-repeated-sentence-second-destination", app)
        app.buttons["回提问处"].tap(); waitForBody(app)
        searchMarkerVisible(app, "后续可见")
        evidence("issue9-return-to-distinct-origin-after-hidden", app)
    }
    func testQuestionSmallScreenLargeTextDraftAndSavedHistory() throws {
        continueAfterFailure = false
        let app = XCUIApplication(); app.launch()
        questionService(app, format: "Anthropic")
        questionSelection(app)
        app.textViews["question-input"].tap(); app.textViews["question-input"].typeText("I9 small draft")
        evidence("issue9-small-large-text-keyboard-draft", app)
        app.buttons["关闭"].tap(); app.buttons["书架"].tap(); app.terminate(); app.launch()
        app.tabBars.buttons["对话"].tap()
        app.tables["question-history"].cells.containing(NSPredicate(format: "label CONTAINS 'I9 small draft'")).firstMatch.tap()
        XCTAssertEqual(app.textViews["question-input"].value as? String, "I9 small draft")
        app.buttons["question-send"].tap(); app.alerts.buttons["发送并查找书内依据"].tap(); questionSaved(app)
        app.scrollViews["question-scroll"].swipeUp(); XCTAssertTrue(app.buttons["question-reference-0"].isHittable)
        evidence("issue9-small-large-text-saved-answer", app)
    }
}
