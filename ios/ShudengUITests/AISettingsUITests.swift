import XCTest

final class AISettingsUITests: XCTestCase {
    private let token = "not-a-real-credential"
    private func launch() -> XCUIApplication {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--isolated-reading-test"]
        app.launch()
        XCTAssertTrue(app.buttons["tab-profile"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.otherElements["AI 服务发送说明"].firstMatch.exists)
        return app
    }
    private func openSettings(_ app: XCUIApplication) {
        app.buttons["tab-profile"].tap()
        let row = app.cells["profile-ai-service"].firstMatch
        if row.waitForExistence(timeout: 5) {
            row.tap()
        } else {
            app.buttons["AI 服务"].tap()
        }
        XCTAssertTrue(app.tables["ai-services"].waitForExistence(timeout: 5))
    }
    private func dismissPasswordPrompt(_ app: XCUIApplication) {
        let sheet = app.sheets["保存密码？"]
        if sheet.waitForExistence(timeout: 1) { sheet.buttons["以后"].tap() }
    }
    private func replace(_ field: XCUIElement, with text: String) {
        field.tap()
        field.press(forDuration: 1.2)
        let selectAll = XCUIApplication().menuItems.matching(NSPredicate(format: "label IN %@", ["全选", "Select All"])).firstMatch
        if selectAll.waitForExistence(timeout: 1) {
            selectAll.tap(); field.typeText(text)
        } else {
            let value = field.value as? String ?? ""
            field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: value.count) + text)
        }
    }
    private func advanced(_ app: XCUIApplication, name: String, format: String = "OpenAI", model: String = "test-model", address: String = "http://127.0.0.1:18767/v1") {
        app.cells["ai-advanced"].tap()
        XCTAssertTrue(app.tables["ai-advanced-editor"].waitForExistence(timeout: 5))
        for label in ["服务名称", "地址", "自定义模型", "接口格式"] { XCTAssertTrue(app.staticTexts[label].exists) }
        replace(app.textFields["ai-name"], with: name)
        replace(app.textFields["ai-address"], with: address)
        // Fail before any probe unless its destination is the local fixture.
        XCTAssertEqual(app.textFields["ai-address"].value as? String, address)
        XCTAssertEqual(URL(string: address)?.host, "127.0.0.1")
        replace(app.textFields["ai-model"], with: model + "\n")
        app.cells["ai-format"].tap(); app.buttons[format].tap()
        app.navigationBars["高级设置"].buttons.element(boundBy: 0).tap()
        XCTAssertTrue(app.tables["ai-service-editor"].waitForExistence(timeout: 5))
    }
    private func enterKey(_ app: XCUIApplication) {
        app.secureTextFields["ai-key"].tap()
        app.secureTextFields["ai-key"].typeText(token + "\n")
        dismissPasswordPrompt(app)
    }
    private func save(_ app: XCUIApplication, host: String) {
        app.navigationBars.buttons["保存"].tap()
        dismissPasswordPrompt(app)
        let consent = app.otherElements["AI 服务发送说明"].firstMatch
        XCTAssertTrue(consent.waitForExistence(timeout: 5))
        let message = consent.staticTexts.allElementsBoundByIndex.map(\.label).joined()
        for text in ["问题", "相关原文", "必要对话", "费用", host] { XCTAssertTrue(message.contains(text)) }
        consent.buttons["同意并保存"].tap()
        XCTAssertTrue(app.otherElements["已保存"].firstMatch.waitForExistence(timeout: 5))
        app.otherElements["book-dialog"].buttons["完成"].tap()
    }
    private func configuration(_ name: String, _ app: XCUIApplication) -> XCUIElement {
        app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", name)).firstMatch
    }
    private func removeCurrentEditor(_ app: XCUIApplication) {
        app.tables["ai-service-editor"].swipeUp()
        app.cells["ai-delete"].tap()
        app.otherElements["book-dialog"].buttons["删除"].tap()
        XCTAssertTrue(app.otherElements["已删除服务"].firstMatch.waitForExistence(timeout: 5))
        app.otherElements["book-dialog"].buttons["完成"].tap()
    }
    private func shot(_ name: String, _ app: XCUIApplication) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
    }

    func testVisibleLabelsPresetAndConsentCancellation() {
        let app = launch(); openSettings(app)
        XCTAssertTrue(app.cells["ai-send-details"].exists)
        XCTAssertFalse(app.staticTexts["数据去向与支持范围"].exists)
        app.navigationBars.buttons["添加"].tap()
        let editor = app.tables["ai-service-editor"]
        XCTAssertTrue(editor.waitForExistence(timeout: 5))
        shot("ai-preset-default", app)
        let tree = XCTAttachment(string: editor.debugDescription)
        tree.name = "ai-preset-empty-editor-tree"; tree.lifetime = .keepAlways; add(tree)
        XCTAssertTrue(editor.staticTexts["服务"].isHittable)
        XCTAssertTrue(editor.staticTexts["API Key"].isHittable)
        XCTAssertTrue(editor.staticTexts["模型"].isHittable)
        XCTAssertTrue(editor.staticTexts["DeepSeek"].exists)
        XCTAssertTrue(editor.staticTexts["deepseek-flash"].exists)
        XCTAssertFalse(app.textFields["ai-address"].exists)
        XCTAssertFalse(app.textFields["ai-model"].exists)
        XCTAssertTrue(app.cells["ai-advanced"].isHittable)
        enterKey(app)
        XCTAssertTrue(app.staticTexts["ai-key-label"].exists)
        shot("ai-preset-visible-labels-key-masked", app)
        app.navigationBars.buttons["保存"].tap(); dismissPasswordPrompt(app)
        let consent = app.otherElements["AI 服务发送说明"].firstMatch
        XCTAssertTrue(consent.waitForExistence(timeout: 5))
        XCTAssertTrue(consent.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "api.deepseek.com")).firstMatch.exists)
        consent.buttons["取消"].tap()
        XCTAssertTrue(app.tables["ai-service-editor"].exists)
        XCTAssertFalse(app.otherElements["已保存"].firstMatch.exists)
        // Saving the preset requires only the key, and does not check the remote service.
        save(app, host: "api.deepseek.com")
        let saved = configuration("DeepSeek", app)
        XCTAssertTrue(saved.waitForExistence(timeout: 5))
        XCTAssertTrue(app.navigationBars.buttons["添加"].isHittable)
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "模型：deepseek-flash")).firstMatch.isHittable)
        shot("ai-service-list-small-screen", app)
        saved.tap()
        XCTAssertTrue(app.staticTexts["已保存 API Key；留空保留，填写新 Key 可替换。"].exists)
        XCTAssertEqual(app.secureTextFields["ai-key"].value as? String, "留空保留已保存的密钥")
        // The sending scope is unchanged, so the existing consent is reused.
        app.navigationBars.buttons["保存"].tap()
        XCTAssertTrue(app.otherElements["已保存"].firstMatch.waitForExistence(timeout: 5))
        XCTAssertFalse(app.otherElements["AI 服务发送说明"].firstMatch.exists)
        app.otherElements["book-dialog"].buttons["完成"].tap()
        configuration("DeepSeek", app).tap()
        removeCurrentEditor(app)
    }

    func testLimitedProbeCanSaveAndRestartBothFormats() {
        let app = launch(); openSettings(app)
        for format in ["OpenAI", "Anthropic"] {
            let name = "Offline " + format + " " + UUID().uuidString.prefix(6)
            app.navigationBars.buttons["添加"].tap()
            app.cells["ai-provider"].tap(); app.buttons["自定义服务"].tap()
            XCTAssertTrue(app.staticTexts["请在高级设置中填写"].exists)
            advanced(app, name: name, format: format, model: "output-limited")
            enterKey(app)
            app.tables["ai-service-editor"].swipeUp(); app.cells["ai-check"].tap()
            let limited = "连接可达，但测试输出达到上限，未完成完整回答；尚未保存。"
            XCTAssertTrue(app.staticTexts[limited].waitForExistence(timeout: 10))
            XCTAssertFalse(app.otherElements["已保存"].firstMatch.exists)
            shot("ai-limited-probe-unsaved-" + format, app)
            save(app, host: "127.0.0.1")
            app.terminate(); app.launch(); openSettings(app)
            let saved = configuration(name, app)
            XCTAssertTrue(saved.waitForExistence(timeout: 5)); saved.tap()
            XCTAssertEqual(app.secureTextFields["ai-key"].value as? String, "留空保留已保存的密钥")
            app.tables["ai-service-editor"].swipeUp(); app.cells["ai-check"].tap()
            XCTAssertTrue(app.staticTexts[limited].waitForExistence(timeout: 10))
            // The service list provides a direct switch, using the saved revision.
            app.navigationBars.buttons["取消"].tap()
            app.navigationBars.buttons["切换"].tap()
            app.sheets["切换服务"].buttons.matching(NSPredicate(format: "label BEGINSWITH %@", name)).firstMatch.tap()
            let consent = app.otherElements["AI 服务发送说明"].firstMatch
            if consent.waitForExistence(timeout: 1) {
                consent.buttons["同意并使用已保存服务"].tap()
            }
            XCTAssertTrue(app.otherElements["已切换服务"].firstMatch.waitForExistence(timeout: 5))
            app.otherElements["book-dialog"].buttons["完成"].tap()
            XCTAssertTrue(configuration(name + " · 使用中", app).exists)
            configuration(name, app).tap()
            removeCurrentEditor(app)
        }
    }

    func testAddressChangeRenewsConsentAndAuthenticationOffersKeyReplacement() {
        let app = launch(); openSettings(app)
        let name = "Consent " + UUID().uuidString.prefix(6)
        app.navigationBars.buttons["添加"].tap()
        advanced(app, name: name, model: "auth")
        enterKey(app)
        app.tables["ai-service-editor"].swipeUp(); app.cells["ai-check"].tap()
        XCTAssertTrue(app.staticTexts["鉴权失败，请检查密钥和服务权限。"].waitForExistence(timeout: 10))
        app.cells["ai-replace-key"].tap()
        XCTAssertTrue(app.secureTextFields["ai-key"].isHittable)
        app.secureTextFields["ai-key"].typeText("\n"); dismissPasswordPrompt(app)
        save(app, host: "127.0.0.1")
        configuration(name, app).tap()
        advanced(app, name: name, address: "http://127.0.0.1:18767/gateway/v1")
        app.navigationBars.buttons["保存"].tap()
        XCTAssertTrue(app.otherElements["AI 服务发送说明"].firstMatch.waitForExistence(timeout: 5))
        app.otherElements["book-dialog"].buttons["取消"].tap()
        app.navigationBars.buttons["取消"].tap()
        app.terminate(); app.launch(); openSettings(app)
        configuration(name, app).tap()
        advanced(app, name: name, address: "http://127.0.0.1:18767/gateway/v1")
        save(app, host: "127.0.0.1")
        configuration(name, app).tap(); removeCurrentEditor(app)
    }

    func testPrivacyPolicyAndSendingDetailsAreReadable() {
        let app = launch()
        app.buttons["tab-profile"].tap()
        let aboutRow = app.cells["profile-about"].firstMatch
        if aboutRow.waitForExistence(timeout: 5) {
            aboutRow.tap()
        } else {
            app.buttons["profile-about"].tap()
        }
        app.buttons["about-privacy-policy"].tap()
        let policy = app.tables["privacy-policy"]
        XCTAssertTrue(policy.waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["本机存储"].exists)
        policy.swipeUp()
        XCTAssertTrue(app.staticTexts["保留与删除"].exists)
        policy.swipeUp()
        XCTAssertTrue(app.staticTexts["使用边界"].exists)
        shot("ai-privacy-policy", app)
        app.navigationBars.buttons.element(boundBy: 0).tap()
        app.navigationBars.buttons.element(boundBy: 0).tap()
        let serviceRow = app.cells["profile-ai-service"].firstMatch
        if serviceRow.waitForExistence(timeout: 5) {
            serviceRow.tap()
        } else {
            app.buttons["AI 服务"].tap()
        }
        app.cells["ai-send-details"].tap()
        XCTAssertTrue(app.tables["ai-sending-details"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["发送哪些内容"].exists)
    }

    // This regression is driven by scripts/verify-ai-save-failure.sh, whose watcher
    // injects/restores the on-disk fault at these markers. Run it via that harness.
    func testSettingsWriteFailureAndRetry() throws {
        try XCTSkipUnless(
            ProcessInfo.processInfo.environment["SHUDENG_AI_SAVE_FAULT"] == "1",
            "Run with scripts/verify-ai-save-failure.sh"
        )
        continueAfterFailure = false
        let app = XCUIApplication(); app.launch(); openSettings(app)
        if !configuration("I7 OpenAI", app).exists {
            app.navigationBars.buttons["添加"].tap()
            advanced(app, name: "I7 OpenAI")
            enterKey(app); save(app, host: "127.0.0.1")
        }
        configuration("I7 OpenAI", app).tap()
        advanced(app, name: "I7 OpenAI", model: "test-model-retry")
        enterKey(app)
        print("I7_INJECT_SAVE_FAULT")
        Thread.sleep(forTimeInterval: 5)
        app.navigationBars.buttons["保存"].tap()
        app.otherElements["AI 服务发送说明"].firstMatch.buttons["同意并保存"].tap()
        XCTAssertTrue(app.otherElements["操作未完成"].firstMatch.waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["配置尚未保存，原配置未变；请重试。"].exists)
        shot("ai-real-write-failure", app)
        app.otherElements["book-dialog"].buttons["知道了"].tap()
        print("I7_RESTORE_SAVE_FAULT")
        Thread.sleep(forTimeInterval: 5)
        save(app, host: "127.0.0.1")
        app.terminate(); app.launch(); openSettings(app)
        configuration("I7 OpenAI", app).tap()
        XCTAssertTrue(app.staticTexts["test-model-retry"].exists)
        app.tables["ai-service-editor"].swipeUp(); app.cells["ai-check"].tap()
        XCTAssertTrue(app.staticTexts["连接成功；尚未保存。"].waitForExistence(timeout: 10))
        shot("ai-retry-restart-keychain-usable", app)
        app.navigationBars.buttons["取消"].tap()
    }
}
