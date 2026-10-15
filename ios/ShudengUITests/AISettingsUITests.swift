import XCTest

final class AISettingsUITests: XCTestCase {
    private func shot(_ name: String, _ app: XCUIApplication) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
    }
    private func openSettings(_ app: XCUIApplication) {
        app.tabBars.buttons["我的"].tap()
        app.buttons["AI 服务"].tap()
        XCTAssertTrue(app.tables["ai-services"].waitForExistence(timeout: 5))
    }
    private func add(_ name: String, format: String, model: String, _ app: XCUIApplication) {
        app.navigationBars.buttons["添加"].tap()
        app.textFields["ai-name"].tap(); app.textFields["ai-name"].typeText(name)
        if format == "Anthropic" { app.cells["ai-format"].tap(); app.buttons["Anthropic"].tap() }
        app.textFields["ai-address"].tap(); app.textFields["ai-address"].typeText("http://127.0.0.1:18767/v1")
        app.textFields["ai-model"].tap(); app.textFields["ai-model"].typeText(model)
        app.secureTextFields["ai-key"].tap(); app.secureTextFields["ai-key"].typeText("not-a-real-credential")
        app.tables.firstMatch.swipeUp()
        app.cells["ai-check"].tap()
        XCTAssertTrue(app.staticTexts["连接成功；尚未保存。"].waitForExistence(timeout: 10))
        shot("issue7-" + format + "-check-masked", app)
        app.navigationBars.buttons["保存"].tap()
        XCTAssertTrue(app.tables["ai-services"].waitForExistence(timeout: 5))
    }
func testSettingsWriteFailureAndRetry() {
    continueAfterFailure = false
    let app = XCUIApplication(); app.launch(); openSettings(app)
    app.staticTexts["I7 OpenAI"].tap()
    let model = app.textFields["ai-model"]
    model.tap(); model.typeText("-retry")
    app.secureTextFields["ai-key"].tap(); app.secureTextFields["ai-key"].typeText("not-a-real-credential")
    print("I7_INJECT_SAVE_FAULT")
    Thread.sleep(forTimeInterval: 5)
    app.navigationBars.buttons["保存"].tap()
    XCTAssertTrue(app.alerts["操作未完成"].waitForExistence(timeout: 5))
    XCTAssertTrue(app.alerts.staticTexts["配置尚未保存，原配置未变；请重试。"].exists)
    shot("issue7-real-write-failure", app)
    app.alerts.buttons["知道了"].tap()
    XCTAssertTrue(app.textFields["ai-model"].value as? String == "test-model-retry")
    print("I7_RESTORE_SAVE_FAULT")
    Thread.sleep(forTimeInterval: 5)
    app.navigationBars.buttons["保存"].tap()
    XCTAssertTrue(app.tables["ai-services"].waitForExistence(timeout: 5))
    app.terminate(); app.launch(); openSettings(app)
    app.staticTexts["I7 OpenAI"].tap()
    XCTAssertTrue(app.textFields["ai-model"].value as? String == "test-model-retry")
    app.tables.firstMatch.swipeUp(); app.cells["ai-check"].tap()
    XCTAssertTrue(app.staticTexts["连接成功；尚未保存。"].waitForExistence(timeout: 10))
    shot("issue7-retry-restart-keychain-usable", app)
    app.navigationBars.buttons["取消"].tap()
}
func testSettingsRealHTTPRestartSwitchAndReading() {

        continueAfterFailure = false
        let app = XCUIApplication(); app.launch()
        openSettings(app)
        add("I7 OpenAI", format: "OpenAI", model: "test-model", app)
        add("I7 Anthropic", format: "Anthropic", model: "test-model", app)
        app.staticTexts["I7 Anthropic"].tap()
        app.tables.firstMatch.swipeUp()
        app.cells["ai-select"].tap(); app.alerts.buttons["使用已保存配置"].tap()
        XCTAssertTrue(app.staticTexts["I7 Anthropic · 使用中"].waitForExistence(timeout: 5))
        app.terminate(); app.launch(); openSettings(app)
        XCTAssertTrue(app.staticTexts["I7 Anthropic · 使用中"].exists)
        app.staticTexts["I7 OpenAI"].tap()
        XCTAssertTrue(app.secureTextFields["ai-key"].exists)
        XCTAssertEqual(app.secureTextFields["ai-key"].value as? String, "留空保留已保存的密钥")
        // Blank edit field must load the persisted Keychain reference for the check.
        app.tables.firstMatch.swipeUp(); app.cells["ai-check"].tap()
        XCTAssertTrue(app.staticTexts["连接成功；尚未保存。"].waitForExistence(timeout: 10))
        app.tables.firstMatch.swipeDown()
        let model = app.textFields["ai-model"]
        model.tap()
        model.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: "test-model".count))
        model.typeText("auth")
        app.tables.firstMatch.swipeUp(); app.cells["ai-check"].tap()
        XCTAssertTrue(app.staticTexts["鉴权失败，请检查密钥和服务权限。"].waitForExistence(timeout: 10))
        shot("issue7-auth-error-no-headers", app)
        app.navigationBars.buttons["取消"].tap()
        app.tabBars.buttons["书架"].tap()
        let book = app.tables["library"].cells.matching(NSPredicate(format: "identifier BEGINSWITH 'book-' ")).firstMatch
        XCTAssertTrue(book.waitForExistence(timeout: 5)); book.tap()
        XCTAssertTrue(app.staticTexts["阅读位置已保存"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.webViews.firstMatch.exists)
        shot("issue7-reading-after-service-failure", app)
    }
}
