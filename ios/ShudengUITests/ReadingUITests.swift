import XCTest

final class ReadingUITests: XCTestCase {
    private let bookID = "book-a08282a3fd59d6398d4173469b0159c51c5b980afaa1aa3024cfd05a43b14a27"
    private func choose(_ name: String, in app: XCUIApplication) {
        app.buttons["导入"].tap()
        let file = app.cells.matching(NSPredicate(format: "identifier BEGINSWITH %@", name + ",")).firstMatch
        if !file.waitForExistence(timeout: 3) {
            let folder = app.cells["Acceptance, Folder"]
            XCTAssertTrue(folder.waitForExistence(timeout: 10))
            folder.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.25)).tap()
        }
        XCTAssertTrue(file.waitForExistence(timeout: 5))
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
