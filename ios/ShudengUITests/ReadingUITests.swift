import XCTest
import UIKit

extension ReadingUITests {
    // The host backs up the original data, explicitly launches the isolated app,
    // and restarts it between this method and the offline verification method.
    func testIssue17IntegratedMode() throws {
        let app = issue12App()
        let mode = ProcessInfo.processInfo.environment["I17_MODE"] ?? "分页"
        let fault = ProcessInfo.processInfo.environment["I17_FAULT"] == "1"
        questionService(app, format: mode == "滚动" ? "Anthropic" : "OpenAI", model: "integration17", address: "http://127.0.0.1:18777/v1")
        issue17Import("semantic-fixture.epub", in: app)
        evidence("issue17-" + mode + "-import", app)
        app.alerts.buttons["知道了"].tap()
        try issue17Mode(app, mode: mode, fault: fault)
    }

    private func issue17Import(_ name: String, in app: XCUIApplication) {
        app.buttons["导入"].tap()
        let folder = app.cells["Issue17Acceptance, Folder"]
        if !folder.waitForExistence(timeout: 3) {
            let browse = app.buttons.matching(identifier: "浏览").firstMatch
            XCTAssertTrue(browse.waitForExistence(timeout: 5)); browse.tap()
            if !folder.waitForExistence(timeout: 2) {
                let back = app.navigationBars.buttons["BackButton"]
                if back.exists { back.tap() }
                let local = app.cells["DOC.sidebar.item.我的iPhone"]
                if local.waitForExistence(timeout: 3) { local.tap() }
            }
        }
        XCTAssertTrue(folder.waitForExistence(timeout: 5))
        folder.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.25)).tap()
        let file = app.cells.matching(NSPredicate(format: "identifier BEGINSWITH %@", name + ",")).firstMatch
        XCTAssertTrue(file.waitForExistence(timeout: 5))
        file.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.25)).tap()
        XCTAssertTrue(app.alerts.firstMatch.waitForExistence(timeout: 10))
    }

    private func issue17Mode(_ app: XCUIApplication, mode: String, fault: Bool) throws {
        let book = app.collectionViews["library"].cells["book-df8c4a78180b9f65911e9fbba7cf4fb9c6f932c0e98456ef15e165157d9b1a67"]
        expectation(for: NSPredicate { _, _ in (book.value as? String ?? "").contains("书内资料可用") }, evaluatedWith: app)
        waitForExpectations(timeout: 60)
        book.tap(); waitForBody(app)
        settings(app, mode: mode, dark: mode == "仿真", font: mode == "仿真" ? 150 : 100)
        searchBook(app, query: "建设预算", count: 1)
        app.tables["book-search-results"].cells.firstMatch.tap(); waitForBody(app)
        let source = "作者没有在书里给出盐桥计划的建设预算，也没有给出任何商业报价。读者不能从设备数量推出项目费用。"
        let paragraph = app.webViews.staticTexts[source].firstMatch
        XCTAssertTrue(paragraph.waitForExistence(timeout: 5))
        paragraph.press(forDuration: 1.3); noteMenu("写笔记", in: app)
        replaceNoteBody("I17-" + mode + "-note", in: app)
        evidence("issue17-" + mode + "-note-keyboard", app)
        if fault { print("I17_INJECT_NOTE"); Thread.sleep(forTimeInterval: 3) }
        app.buttons["保存笔记"].tap()
        if fault {
            XCTAssertTrue(app.staticTexts["笔记保存失败，内容仍在此页；请重试保存笔记"].waitForExistence(timeout: 5))
            evidence("issue17-note-real-save-failure", app)
            print("I17_RESTORE_NOTE"); Thread.sleep(forTimeInterval: 3)
            app.buttons["保存笔记"].tap()
        }
        waitForBody(app); evidence("issue17-" + mode + "-note-highlight", app)
        paragraph.press(forDuration: 1.3); noteMenu("提问", in: app)
        issue12Send("I17-" + mode + " 切掉主电源后哪两件装置继续工作？", app: app)
        evidence("issue17-" + mode + "-first-saved", app)
        let follow = app.buttons["question-follow-up"]; issue12Reach(follow, in: app); follow.tap()
        let followText = "I17-" + mode + "-follow 为什么记录器仍然运行？"
        if fault {
            let input = app.textViews["question-input"]; issue12Reach(input, in: app)
            input.tap(); input.typeText(followText)
            let send = app.buttons["question-send"]; issue12Reach(send, in: app); send.tap()
            app.alerts.buttons["发送并查找书内依据"].tap()
            let failed = app.staticTexts["question-status"]
            expectation(for: NSPredicate { _, _ in failed.label.hasPrefix("保存失败") }, evaluatedWith: app)
            waitForExpectations(timeout: 20); evidence("issue17-answer-real-save-failure", app)
            print("I17_RESTORE_ANSWER"); Thread.sleep(forTimeInterval: 3)
            let retry = app.buttons["重试保存"]; issue12Reach(retry, in: app); retry.tap(); questionSaved(app)
        } else { issue12Send(followText, app: app) }
        evidence("issue17-" + mode + "-follow-saved", app)
        let reference = app.buttons["question-reference-0"]; issue12Reach(reference, in: app); reference.tap()
        XCTAssertTrue(app.navigationBars["原文材料"].waitForExistence(timeout: 5))
        evidence("issue17-" + mode + "-reference-snapshot", app)
        app.buttons["跳转原文"].tap(); waitForBody(app)
        let target = "每座站的温度仪由主电池供电，计时器和记录器则接在独立的备用电池上。主供电切断后，后两者继续工作，温度仪停止。"
        searchMarkerVisible(app, target); evidence("issue17-" + mode + "-cross-chapter-target", app)
        app.buttons["回提问处"].tap(); waitForBody(app)
        searchMarkerVisible(app, source); evidence("issue17-" + mode + "-returned-origin", app)
        if mode == "仿真" {
            settings(app, mode: mode, dark: false, font: 175)
            for cycle in 1...2 {
                curlTurn(app, forward: true); curlTurn(app, forward: false)
                evidence("issue17-curl-cache-round-\(cycle)", app)
            }
            print("I17_CURL_BEFORE_CANCEL"); Thread.sleep(forTimeInterval: 2)
            curlTurn(app, forward: true, cancel: true)
            print("I17_CURL_AFTER_CANCEL"); Thread.sleep(forTimeInterval: 2)
            evidence("issue17-curl-after-cancel", app)
        }
        app.buttons["书架"].tap(); app.tabBars.buttons["笔记"].tap()
        let row = noteRow("I17-" + mode + "-note", in: app)
        XCTAssertTrue(row.waitForExistence(timeout: 5)); row.tap(); app.buttons["返回原文"].tap(); waitForBody(app)
        // Large text can split this paragraph over pages. The exact note quote
        // is checked in the editor; the screenshot verifies its visible highlight.
        XCTAssertTrue(paragraph.exists); evidence("issue17-" + mode + "-note-return", app)
        app.buttons["书架"].tap(); app.tabBars.buttons["对话"].tap()
        XCTAssertEqual(app.tables["question-history"].cells.count, 1)
        evidence("issue17-" + mode + "-history-summary", app)
        print("I17_MODE_FINISHED \(mode)")
    }

    func testIssue17OfflineRestart() {
        let app = issue12App()
        let mode = ProcessInfo.processInfo.environment["I17_MODE"] ?? "分页"
        app.tabBars.buttons["笔记"].tap()
        let row = noteRow("I17-" + mode + "-note", in: app)
        XCTAssertTrue(row.waitForExistence(timeout: 5)); row.tap()
        XCTAssertEqual(app.textViews["note-body"].value as? String, "I17-" + mode + "-note")
        evidence("issue17-" + mode + "-offline-note", app); app.buttons["关闭"].tap()
        app.tabBars.buttons["对话"].tap(); issue12Row("I17-" + mode, app: app).tap()
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "受控组合回答：记录器和计时器使用备用电池。")).firstMatch.waitForExistence(timeout: 5))
        let reference = app.buttons["question-reference-0"]; issue12Reach(reference, in: app); reference.tap()
        XCTAssertTrue(app.navigationBars["原文材料"].waitForExistence(timeout: 5))
        evidence("issue17-" + mode + "-offline-reference", app)
        app.navigationBars.buttons.element(boundBy: 0).tap(); app.buttons["关闭"].tap()
    }

    func testIssue17RebuildWithRecordsAndReading() {
        let app = issue12App()
        issue17Import("search-other.epub", in: app); app.alerts.buttons["知道了"].tap()
        app.collectionViews["library"].cells[searchOtherID].tap(); waitForBody(app)
        app.buttons["目录与书签"].tap(); app.buttons["添加书签"].tap()
        XCTAssertTrue(app.staticTexts["书签已保存"].waitForExistence(timeout: 5)); app.buttons["完成"].tap()
        app.buttons["书架"].tap()
        app.collectionViews["library"].cells["book-df8c4a78180b9f65911e9fbba7cf4fb9c6f932c0e98456ef15e165157d9b1a67"].tap(); waitForBody(app)
        app.buttons["目录与书签"].tap(); app.buttons["添加书签"].tap()
        XCTAssertTrue(app.staticTexts["书签已保存"].waitForExistence(timeout: 5))
        app.buttons["已读范围"].tap()
        for chapter in [0, 2] {
            app.tables["read-chapters"].cells["read-chapter-" + String(chapter)].tap()
            app.alerts.buttons["确认已读"].tap()
        }
        app.navigationBars.buttons.element(boundBy: 0).tap(); app.buttons["书内搜索"].tap()
        print("I17_BEFORE_REBUILD"); Thread.sleep(forTimeInterval: 3)
        app.buttons["重新准备"].tap(); evidence("issue17-rebuild-started-with-business-records", app)
        app.navigationBars.buttons.element(boundBy: 0).tap(); app.buttons["完成"].tap(); waitForBody(app)
        evidence("issue17-reading-after-rebuild-start", app)
        app.buttons["书架"].tap()
        let book = app.collectionViews["library"].cells["book-df8c4a78180b9f65911e9fbba7cf4fb9c6f932c0e98456ef15e165157d9b1a67"]
        expectation(for: NSPredicate { _, _ in (book.value as? String ?? "").contains("书内资料可用") }, evaluatedWith: app)
        waitForExpectations(timeout: 60); print("I17_AFTER_REBUILD"); Thread.sleep(forTimeInterval: 3)
        app.tabBars.buttons["笔记"].tap(); XCTAssertTrue(noteRow("I17-仿真-note", in: app).exists)
        app.tabBars.buttons["对话"].tap(); XCTAssertTrue(issue12Row("I17-仿真", app: app).exists)
        evidence("issue17-records-after-rebuild", app)
    }

    func testIssue17SmallDarkLargeInteraction() {
        let app = issue12App()
        app.tabBars.buttons["我的"].tap(); evidence("issue17-small-my", app)
        app.tabBars.buttons["书架"].tap(); evidence("issue17-small-shelf", app)
        app.collectionViews["library"].cells["book-df8c4a78180b9f65911e9fbba7cf4fb9c6f932c0e98456ef15e165157d9b1a67"].tap(); waitForBody(app)
        app.buttons["隐藏工具栏"].tap(); evidence("issue17-small-toolbar-hidden", app)
        app.buttons["显示工具栏"].tap(); app.buttons["reader-ask-book"].tap()
        let input = app.textViews["question-input"]; issue12Reach(input, in: app); input.tap(); input.typeText("I17-layout-draft")
        evidence("issue17-small-question-keyboard", app); app.buttons["关闭"].tap()
        app.buttons["书架"].tap(); app.tabBars.buttons["笔记"].tap()
        let row = noteRow("I17-仿真-note", in: app)
        if !row.isHittable { app.tables["notes"].swipeUp() }
        XCTAssertTrue(row.isHittable); evidence("issue17-small-notes", app)
        app.tabBars.buttons["对话"].tap(); issue12Row("I17-仿真", app: app).tap()
        let follow = app.buttons["question-follow-up"]; issue12Reach(follow, in: app); follow.tap()
        issue12Send("I17-layout-follow 为什么使用备用电池？", app: app)
        let reference = app.buttons["question-reference-0"]; issue12Reach(reference, in: app); reference.tap()
        evidence("issue17-small-reference", app); app.buttons["跳转原文"].tap(); waitForBody(app)
        evidence("issue17-small-reading-target", app); app.buttons["回提问处"].tap(); waitForBody(app)
        app.buttons.matching(identifier: "书架").allElementsBoundByIndex.first { $0.isHittable }!.tap()
        app.tabBars.buttons["对话"].tap(); evidence("issue17-small-history", app)
    }

    func testIssue17OpenNoteForWriteBoundary() {
        let app = issue12App(); app.tabBars.buttons["笔记"].tap()
        let row = noteRow("I17-仿真-note", in: app)
        XCTAssertTrue(row.waitForExistence(timeout: 5)); row.tap()
        evidence("issue17-before-write-boundary", app)
    }

    func testIssue17CurlNoteReturnCompletion() {
        let app = issue12App(); app.buttons["书架"].tap()
        app.tabBars.buttons["笔记"].tap(); noteRow("I17-仿真-note", in: app).tap()
        XCTAssertEqual(app.textViews["note-quote"].value as? String, "报价")
        app.buttons["返回原文"].tap(); waitForBody(app)
        evidence("issue17-curl-note-precise-quote-return", app)
        app.buttons["书架"].tap(); app.tabBars.buttons["对话"].tap()
        XCTAssertEqual(app.tables["question-history"].cells.count, 1)
        evidence("issue17-curl-history-summary", app)
    }

    func testIssue17WriteBoundaryRecovery() {
        let app = issue12App(); app.tabBars.buttons["笔记"].tap()
        noteRow("I17-write-boundary-draft", in: app).tap()
        XCTAssertEqual(app.textViews["note-body"].value as? String, "I17-write-boundary-draft")
        evidence("issue17-write-boundary-recovered-draft", app)
        replaceNoteBody("I17-仿真-note", in: app); app.buttons["保存笔记"].tap()
        XCTAssertEqual(app.tables["notes"].cells.count, 1)
        app.tabBars.buttons["对话"].tap(); XCTAssertEqual(app.tables["question-history"].cells.count, 1)
        evidence("issue17-write-boundary-same-record-retry", app)
    }

    func testIssue17LayoutHistoryCompletion() {
        let app = issue12App()
        let history = app.tables["question-history"]
        history.swipeDown(); history.swipeDown(); history.swipeDown()
        let row = issue12Row("I17-仿真", app: app)
        XCTAssertTrue(row.isHittable)
        XCTAssertFalse(row.label.contains("citations")); XCTAssertFalse(row.label.contains("{\""))
        evidence("issue17-small-history-completed", app)
    }

    func testIssue17SmallDarkKeyboardVisibility() {
        let app = issue12App()
        app.collectionViews["library"].cells["book-df8c4a78180b9f65911e9fbba7cf4fb9c6f932c0e98456ef15e165157d9b1a67"].tap()
        waitForBody(app); app.buttons["reader-ask-book"].tap()
        let input = app.textViews["question-input"]; issue12Reach(input, in: app)
        input.tap(); input.typeText("x")
        let keyboard = app.keyboards.firstMatch
        XCTAssertTrue(keyboard.waitForExistence(timeout: 5))
        XCTAssertLessThan(keyboard.frame.minY, 667)
        let scroll = app.scrollViews["question-scroll"]
        for _ in 0..<4 where input.frame.maxY > keyboard.frame.minY {
            let start = scroll.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.8))
            let end = scroll.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.4))
            start.press(forDuration: 0.05, thenDragTo: end)
        }
        XCTAssertTrue(keyboard.exists)
        XCTAssertTrue(input.isHittable)
        XCTAssertLessThanOrEqual(input.frame.maxY, keyboard.frame.minY)
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = "issue17-small-question-keyboard-visible"; shot.lifetime = .keepAlways; add(shot)
    }
}

extension ReadingUITests {
    func testIssue24IsolatedDesignFixtureSurface() throws {
        let app = XCUIApplication()
        app.launchArguments = ["--design-fixture=normal", "--design-theme=light"]
        app.launch()
        XCTAssertTrue(tab("tab-library", label: "书架", in: app).waitForExistence(timeout: 15))
        XCTAssertTrue(app.staticTexts["红楼梦"].waitForExistence(timeout: 15))
        attachDesignSurface("issue24-shelf-375-light", app)

        tab("tab-notes", label: "笔记", in: app).tap()
        XCTAssertTrue(
            app.tables["notes"].cells.containing(NSPredicate(format: "label CONTAINS %@", "灯把书页照亮，也把问题留在纸上。"))
                .firstMatch.waitForExistence(timeout: 5)
        )
        attachDesignSurface("issue24-notes-375-light", app)

        tab("tab-conversations", label: "对话", in: app).tap()
        XCTAssertTrue(
            app.tables["question-history"].cells.containing(
                NSPredicate(format: "label CONTAINS %@", "这句话里的“灯”指什么？")
            ).firstMatch.waitForExistence(timeout: 5)
        )
        attachDesignSurface("issue24-conversations-375-light", app)

        tab("tab-profile", label: "我的", in: app).tap()
        XCTAssertTrue(app.otherElements["profile-surface"].waitForExistence(timeout: 5))
        attachDesignSurface("issue24-profile-375-light", app)

        tab("tab-library", label: "书架", in: app).tap()
        let book = app.collectionViews["library"].cells
            .containing(NSPredicate(format: "label CONTAINS %@", "红楼梦"))
            .firstMatch
        XCTAssertTrue(book.waitForExistence(timeout: 10))
        book.tap()
        waitForBody(app)
        XCTAssertTrue(app.buttons["reader-ask-book"].waitForExistence(timeout: 5))
        attachDesignSurface("issue24-reader-375-light", app)
        app.buttons["reader-ask-book"].tap()
        XCTAssertTrue(app.textViews["question-input"].waitForExistence(timeout: 5))
        attachDesignSurface("issue24-question-375-light", app)

        app.terminate()
        app.launchArguments = ["--design-fixture=normal", "--design-theme=dark"]
        app.launch()
        XCTAssertTrue(tab("tab-library", label: "书架", in: app).waitForExistence(timeout: 15))
        XCTAssertTrue(app.staticTexts["红楼梦"].waitForExistence(timeout: 15))
        attachDesignSurface("issue24-shelf-375-dark-baseline", app)
    }

    func testIssue25ShelfNormalSearchEmptyAndPreparing() throws {
        let app = XCUIApplication()
        app.launchArguments = ["--design-fixture=normal", "--design-theme=light"]
        app.launch()
        XCTAssertTrue(app.staticTexts["书灯"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.staticTexts["书架"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["一盏照书的灯"].exists)
        XCTAssertTrue(app.staticTexts["继续阅读"].exists)
        XCTAssertTrue(app.buttons["library-import"].exists)
        XCTAssertTrue(app.buttons["tab-library"].exists)
        attachDesignSurface("issue25-shelf-375-light", app)

        app.buttons["continue-reading"].tap()
        XCTAssertTrue(app.buttons["reader-ask-book"].waitForExistence(timeout: 15))
        app.buttons["书架"].tap()
        XCTAssertTrue(app.staticTexts["继续阅读"].waitForExistence(timeout: 10))

        let search = app.textFields["library-search"]
        XCTAssertTrue(search.exists)
        search.tap()
        search.typeText("不存在的书")
        XCTAssertTrue(app.staticTexts["没有找到这本书"].waitForExistence(timeout: 5))
        XCTAssertEqual(search.value as? String, "不存在的书")
        attachDesignSurface("issue25-search-empty-375-light", app)

        app.terminate()
        app.launchArguments = ["--design-fixture=empty", "--design-theme=light"]
        app.launch()
        XCTAssertTrue(app.staticTexts["从一本书开始"].waitForExistence(timeout: 15))
        attachDesignSurface("issue25-shelf-empty-375-light", app)

        app.terminate()
        app.launchArguments = ["--design-fixture=preparing", "--design-theme=light"]
        app.launch()
        XCTAssertTrue(app.staticTexts["正在准备《红楼梦》的问答资料"].waitForExistence(timeout: 15))
        attachDesignSurface("issue25-shelf-preparing-375-light", app)
        app.buttons["continue-reading"].tap()
        XCTAssertTrue(app.buttons["reader-ask-book"].waitForExistence(timeout: 15))
    }

    func testIssue26NotesFiltersVisualAndReturnToOriginal() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--design-fixture=normal", "--design-theme=light"]
        app.launch()
        XCTAssertTrue(tab("tab-notes", label: "笔记", in: app).waitForExistence(timeout: 15))
        tab("tab-notes", label: "笔记", in: app).tap()

        XCTAssertTrue(app.staticTexts["notes-title"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["notes-description"].exists)
        XCTAssertTrue(app.buttons["notes-export"].exists)
        for identifier in [
            "note-filter-all",
            "note-filter-highlights",
            "note-filter-notes",
            "note-filter-bookmarks"
        ] {
            XCTAssertTrue(app.buttons[identifier].exists, identifier)
        }
        let table = app.tables["notes"]
        XCTAssertEqual(table.cells.count, 3)
        XCTAssertTrue(
            table.cells.containing(NSPredicate(format: "label CONTAINS %@", "灯把书页照亮")).firstMatch.exists
        )
        XCTAssertTrue(
            app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "今天")).firstMatch.exists
        )
        attachDesignSurface("issue26-notes-normal-375-light", app)

        app.buttons["note-filter-bookmarks"].tap()
        XCTAssertEqual(table.cells.count, 1)
        XCTAssertTrue(
            table.cells.containing(NSPredicate(format: "label CONTAINS %@", "书签")).firstMatch.exists
        )
        attachDesignSurface("issue26-notes-bookmarks-375-light", app)

        app.buttons["note-filter-notes"].tap()
        XCTAssertEqual(table.cells.count, 1)
        app.buttons["note-filter-all"].tap()
        XCTAssertEqual(table.cells.count, 3)

        let returnButton = app.buttons.matching(
            NSPredicate(format: "identifier BEGINSWITH %@", "return-")
        ).firstMatch
        XCTAssertTrue(returnButton.waitForExistence(timeout: 5))
        returnButton.tap()
        waitForBody(app)
        attachDesignSurface("issue26-notes-original-375-light", app)
        app.buttons["书架"].tap()
        XCTAssertTrue(app.staticTexts["notes-title"].waitForExistence(timeout: 10))

        let noteCell = app.tables["notes"].cells.matching(
            NSPredicate(format: "identifier BEGINSWITH %@", "note-")
        ).firstMatch
        XCTAssertTrue(noteCell.exists)
        noteCell.tap()
        XCTAssertTrue(app.textViews["note-body"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["保存草稿"].exists)
        app.buttons["关闭"].tap()
        XCTAssertTrue(app.staticTexts["notes-title"].waitForExistence(timeout: 5))

        app.terminate()
        app.launchArguments = ["--design-fixture=normal", "--design-theme=dark"]
        app.launch()
        XCTAssertTrue(tab("tab-notes", label: "笔记", in: app).waitForExistence(timeout: 15))
        tab("tab-notes", label: "笔记", in: app).tap()
        XCTAssertTrue(app.staticTexts["notes-title"].waitForExistence(timeout: 5))
        attachDesignSurface("issue26-notes-normal-375-dark", app)

        app.terminate()
        app.launchArguments = ["--design-fixture=empty", "--design-theme=light"]
        app.launch()
        XCTAssertTrue(tab("tab-notes", label: "笔记", in: app).waitForExistence(timeout: 15))
        tab("tab-notes", label: "笔记", in: app).tap()
        XCTAssertTrue(app.staticTexts["还没有阅读痕迹"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["notes-empty-action"].exists)
        attachDesignSurface("issue26-notes-empty-375-light", app)
    }

    func testIssue27ConversationsSearchOpenAndStates() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--design-fixture=normal", "--design-theme=light"]
        app.launch()
        XCTAssertTrue(tab("tab-conversations", label: "对话", in: app).waitForExistence(timeout: 15))
        tab("tab-conversations", label: "对话", in: app).tap()

        XCTAssertTrue(app.staticTexts["conversations-title"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["conversations-description"].exists)
        let table = app.tables["question-history"]
        XCTAssertEqual(table.cells.count, 2)
        XCTAssertTrue(
            table.cells.containing(
                NSPredicate(format: "label CONTAINS %@", "这句话里的“灯”指什么？")
            ).firstMatch.exists
        )
        XCTAssertTrue(
            table.cells.containing(NSPredicate(format: "label CONTAINS %@", "次提问")).firstMatch.exists
        )
        attachDesignSurface("issue27-conversations-normal-375-light", app)

        let search = app.textFields["conversation-search"]
        XCTAssertTrue(search.exists)
        search.tap()
        search.typeText("第一次进贾府\n")
        XCTAssertEqual(table.cells.count, 1)
        XCTAssertTrue(
            table.cells.containing(
                NSPredicate(format: "label CONTAINS %@", "林黛玉第一次进贾府时看到了什么？")
            ).firstMatch.exists
        )

        search.tap()
        search.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 12))
        XCTAssertEqual(table.cells.count, 2)
        search.typeText("不存在的对话")
        XCTAssertTrue(app.staticTexts["没有找到相关对话"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["conversations-search-empty-action"].exists)
        attachDesignSurface("issue27-conversations-search-empty-375-light", app)

        app.terminate()
        app.launchArguments = ["--design-fixture=normal", "--design-theme=light"]
        app.launch()
        XCTAssertTrue(tab("tab-conversations", label: "对话", in: app).waitForExistence(timeout: 15))
        tab("tab-conversations", label: "对话", in: app).tap()
        let first = app.tables["question-history"].cells.containing(
            NSPredicate(format: "label CONTAINS %@", "这句话里的“灯”指什么？")
        ).firstMatch
        XCTAssertTrue(first.waitForExistence(timeout: 5))
        first.tap()
        XCTAssertTrue(app.textViews["question-input"].waitForExistence(timeout: 5))
        XCTAssertTrue(
            app.staticTexts.matching(
                NSPredicate(format: "label CONTAINS %@", "这句话里的“灯”指什么？")
            ).firstMatch.exists
        )
        XCTAssertTrue(app.buttons["question-follow-up"].exists)
        XCTAssertTrue(app.buttons["关闭"].exists)
        app.buttons["关闭"].tap()
        XCTAssertTrue(app.staticTexts["conversations-title"].waitForExistence(timeout: 5))

        app.terminate()
        app.launchArguments = ["--design-fixture=normal", "--design-theme=dark"]
        app.launch()
        XCTAssertTrue(tab("tab-conversations", label: "对话", in: app).waitForExistence(timeout: 15))
        tab("tab-conversations", label: "对话", in: app).tap()
        XCTAssertTrue(app.staticTexts["conversations-title"].waitForExistence(timeout: 5))
        attachDesignSurface("issue27-conversations-normal-375-dark", app)

        app.terminate()
        app.launchArguments = ["--design-fixture=empty", "--design-theme=light"]
        app.launch()
        XCTAssertTrue(tab("tab-conversations", label: "对话", in: app).waitForExistence(timeout: 15))
        tab("tab-conversations", label: "对话", in: app).tap()
        XCTAssertTrue(app.staticTexts["还没有对话"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["conversations-empty-action"].exists)
        attachDesignSurface("issue27-conversations-empty-375-light", app)
    }

    func testIssue28ProfileBrandSettingsAndAbout() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--design-fixture=normal", "--design-theme=light"]
        app.launch()
        XCTAssertTrue(tab("tab-profile", label: "我的", in: app).waitForExistence(timeout: 15))
        tab("tab-profile", label: "我的", in: app).tap()

        let title = app.staticTexts["profile-title"]
        XCTAssertTrue(title.waitForExistence(timeout: 5))
        XCTAssertEqual(title.label, "我的")
        XCTAssertLessThanOrEqual(title.frame.minX, 25)
        let icon = app.images["profile-brand-icon"]
        XCTAssertTrue(icon.exists)
        XCTAssertEqual(icon.frame.width, 70, accuracy: 0.5)
        XCTAssertEqual(icon.frame.midX, app.frame.midX, accuracy: 0.5)
        XCTAssertTrue(app.staticTexts["profile-wordmark"].exists)
        XCTAssertEqual(
            app.staticTexts["profile-motto"].label,
            "一盏照书的灯，AI 照亮你读不懂的地方"
        )

        let service = app.buttons["profile-ai-service"]
        XCTAssertTrue(service.exists)
        XCTAssertEqual(service.value as? String, "DeepSeek · deepseek-flash")
        XCTAssertGreaterThanOrEqual(service.frame.height, 66)
        let appearance = app.buttons["profile-appearance"]
        XCTAssertTrue(appearance.exists)
        XCTAssertGreaterThanOrEqual(appearance.frame.height, 66)
        let about = app.buttons["profile-about"]
        XCTAssertTrue(about.exists)
        XCTAssertGreaterThanOrEqual(about.frame.height, 66)
        XCTAssertTrue(app.staticTexts["profile-storage-disclosure"].exists)
        attachDesignSurface("issue28-profile-normal-375-light", app)

        appearance.tap()
        let systemAppearance = app.sheets.buttons.matching(
            NSPredicate(format: "label ENDSWITH %@", "跟随系统")
        ).firstMatch
        XCTAssertTrue(systemAppearance.waitForExistence(timeout: 3))
        XCTAssertTrue(
            app.sheets.buttons.matching(NSPredicate(format: "label == %@", "浅色")).firstMatch.exists
        )
        XCTAssertTrue(
            app.sheets.buttons.matching(NSPredicate(format: "label == %@", "深色")).firstMatch.exists
        )
        app.sheets.buttons.matching(NSPredicate(format: "label == %@", "深色")).firstMatch.tap()
        XCTAssertEqual(appearance.value as? String, "深色")
        appearance.tap()
        let restoreSystem = app.sheets.buttons.matching(
            NSPredicate(format: "label ENDSWITH %@", "跟随系统")
        ).firstMatch
        XCTAssertTrue(restoreSystem.waitForExistence(timeout: 3))
        restoreSystem.tap()
        XCTAssertEqual(appearance.value as? String, "跟随系统")

        service.tap()
        XCTAssertTrue(app.tables["ai-services"].waitForExistence(timeout: 5))
        app.navigationBars.buttons.firstMatch.tap()
        XCTAssertTrue(title.waitForExistence(timeout: 5))

        about.tap()
        XCTAssertTrue(app.navigationBars["关于书灯"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["about-third-party"].exists)
        attachDesignSurface("issue28-about-375-light", app)
        app.buttons["about-third-party"].tap()
        XCTAssertTrue(app.navigationBars["第三方许可"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.textViews.firstMatch.exists)

        app.terminate()
        app.launchArguments = ["--design-fixture=normal", "--design-theme=dark"]
        app.launch()
        XCTAssertTrue(tab("tab-profile", label: "我的", in: app).waitForExistence(timeout: 15))
        tab("tab-profile", label: "我的", in: app).tap()
        XCTAssertTrue(app.staticTexts["profile-title"].waitForExistence(timeout: 5))
        attachDesignSurface("issue28-profile-normal-375-dark", app)
    }

    func testIssue29ReaderToolbarSelectionAndAskEntry() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--design-fixture=normal", "--design-theme=light"]
        app.launch()

        let continueReading = app.buttons["continue-reading"]
        XCTAssertTrue(continueReading.waitForExistence(timeout: 15))
        continueReading.tap()
        let ask = app.buttons["reader-ask-book"]
        XCTAssertTrue(ask.waitForExistence(timeout: 15))
        XCTAssertTrue(app.webViews.firstMatch.waitForExistence(timeout: 15))

        let toolbar = app.otherElements["reader-toolbar"]
        XCTAssertTrue(toolbar.exists)
        XCTAssertEqual(toolbar.frame.height, 51, accuracy: 0.5)
        XCTAssertEqual(app.staticTexts["reader-title"].label, "红楼梦")
        XCTAssertTrue(app.staticTexts["reader-chapter"].label.contains("第三回"))

        let back = app.buttons["reader-close"]
        let contents = app.buttons["reader-contents"]
        let settings = app.buttons["reader-settings"]
        XCTAssertTrue(back.exists)
        XCTAssertTrue(contents.exists)
        XCTAssertTrue(settings.exists)
        XCTAssertEqual(back.frame.width, 44, accuracy: 0.5)
        XCTAssertEqual(back.frame.minX, 13, accuracy: 0.5)
        XCTAssertEqual(contents.frame.width, 44, accuracy: 0.5)
        XCTAssertEqual(settings.frame.width, 44, accuracy: 0.5)
        XCTAssertEqual(settings.frame.maxX, app.frame.maxX - 13, accuracy: 0.5)
        XCTAssertEqual(ask.frame.height, 44, accuracy: 0.5)
        XCTAssertEqual(ask.frame.midX, app.frame.midX, accuracy: 0.5)
        attachDesignSurface("issue29-reader-375-light", app)

        contents.tap()
        XCTAssertTrue(app.tables["book-navigation"].waitForExistence(timeout: 5))
        app.buttons["添加书签"].tap()
        XCTAssertTrue(app.staticTexts["书签已保存"].waitForExistence(timeout: 5))
        app.buttons["完成"].tap()
        XCTAssertTrue(ask.waitForExistence(timeout: 5))

        let paragraph = app.webViews.staticTexts.matching(
            NSPredicate(format: "label CONTAINS %@", "当下地下侍立之人")
        ).firstMatch
        for (index, mode) in ["滚动", "仿真", "分页"].enumerated() {
            if index > 0 {
                app.terminate()
                app.launchArguments = ["--design-fixture=normal", "--design-theme=light"]
                app.launch()
                XCTAssertTrue(app.buttons["continue-reading"].waitForExistence(timeout: 15))
                app.buttons["continue-reading"].tap()
                XCTAssertTrue(ask.waitForExistence(timeout: 15))
                XCTAssertTrue(app.webViews.firstMatch.waitForExistence(timeout: 15))
            }
            let readerSettings = app.buttons["reader-settings"]
            XCTAssertTrue(readerSettings.waitForExistence(timeout: 15), mode)
            readerSettings.tap()
            XCTAssertTrue(app.navigationBars["阅读设置"].waitForExistence(timeout: 10), mode)
            app.segmentedControls.buttons[mode].tap()
            app.buttons["完成"].tap()
            XCTAssertTrue(app.webViews.firstMatch.waitForExistence(timeout: 15), mode)
            XCTAssertTrue(paragraph.waitForExistence(timeout: 10), mode)
            Thread.sleep(forTimeInterval: 0.45)
            XCTAssertTrue(ask.waitForExistence(timeout: 5), mode)
            XCTAssertTrue(ask.isHittable, mode)
        }

        XCTAssertTrue(paragraph.waitForExistence(timeout: 10))
        paragraph.press(forDuration: 1.3)
        attachDesignSurface("issue29-selection-375-light", app)
        for identifier in ["selection-highlight", "selection-note", "selection-ask"] {
            XCTAssertTrue(app.buttons[identifier].waitForExistence(timeout: 5), identifier)
        }
        app.buttons["selection-note"].tap()
        XCTAssertTrue(app.textViews["note-body"].waitForExistence(timeout: 10))
        app.buttons["关闭"].tap()
        XCTAssertTrue(app.buttons["reader-ask-book"].waitForExistence(timeout: 5))

        app.terminate()
        app.launchArguments = ["--design-fixture=normal", "--design-theme=dark"]
        app.launch()
        XCTAssertTrue(app.buttons["continue-reading"].waitForExistence(timeout: 15))
        app.buttons["continue-reading"].tap()
        XCTAssertTrue(app.buttons["reader-ask-book"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.webViews.firstMatch.waitForExistence(timeout: 15))
        let darkParagraph = app.webViews.staticTexts.matching(
            NSPredicate(format: "label CONTAINS %@", "当下地下侍立之人")
        ).firstMatch
        XCTAssertTrue(darkParagraph.waitForExistence(timeout: 10))
        darkParagraph.press(forDuration: 1.3)
        XCTAssertTrue(app.buttons["selection-ask"].waitForExistence(timeout: 5))
        attachDesignSurface("issue29-selection-375-dark", app)
    }

    private func tab(_ identifier: String, label: String, in app: XCUIApplication) -> XCUIElement {
        let identified = app.buttons[identifier].firstMatch
        return identified.exists ? identified : app.tabBars.buttons[label].firstMatch
    }

    /// The status bar is not part of the designed application surface.
    private func attachDesignSurface(_ name: String, _ app: XCUIApplication) {
        // The design's longest state transition is 240 ms. Capture only after
        // it has completed so navigation and sheet screenshots are stable.
        Thread.sleep(forTimeInterval: 0.35)
        let source = XCUIScreen.main.screenshot().image
        // UIImage sizes and drawing coordinates are points. Cropping 20 pt
        // removes the 40-pixel status bar on the 2x Shudeng Small display.
        let statusHeight: CGFloat = 20
        let size = CGSize(width: source.size.width, height: max(0, source.size.height - statusHeight))
        let image = UIGraphicsImageRenderer(size: size).image { _ in
            source.draw(at: CGPoint(x: 0, y: -statusHeight))
        }
        let attachment = XCTAttachment(image: image)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}

final class ReadingUITests: XCTestCase {
    func testIssue13RangeNavigationAndRealHTTP() {
        let app = issue12App()
        questionService(app, format: "OpenAI", model: "ui13", address: "http://127.0.0.1:18773/v1")
        let book = app.collectionViews["library"].cells["book-df8c4a78180b9f65911e9fbba7cf4fb9c6f932c0e98456ef15e165157d9b1a67"]
        expectation(for: NSPredicate { _, _ in (book.value as? String ?? "").contains("书内资料可用") }, evaluatedWith: app)
        waitForExpectations(timeout: 60)
        book.tap(); waitForBody(app)
        app.buttons["目录与书签"].tap(); app.buttons["已读范围"].tap()
        XCTAssertTrue(app.tables["read-chapters"].cells["read-chapter-0"].label.contains("未确认已读"))
        for chapter in [2, 0] {
            app.tables["read-chapters"].cells["read-chapter-" + String(chapter)].tap()
            app.alerts.buttons["确认已读"].tap()
            XCTAssertTrue(app.tables["read-chapters"].cells["read-chapter-" + String(chapter)].label.contains("已确认已读"))
        }
        XCTAssertTrue(app.tables["read-chapters"].cells["read-chapter-1"].label.contains("未确认已读"))
        evidence("issue13-disjoint-confirmed-range", app)
        app.navigationBars.buttons.element(boundBy: 0).tap()
        app.tables["book-navigation"].cells.element(boundBy: 1).tap(); waitForBody(app)
        app.buttons["目录与书签"].tap(); app.buttons["已读范围"].tap()
        XCTAssertTrue(app.tables["read-chapters"].cells["read-chapter-1"].label.contains("未确认已读"), "Jumping to chapter 2 must not mark it read")
        app.navigationBars.buttons.element(boundBy: 0).tap()
        app.tables["book-navigation"].cells.element(boundBy: 0).tap(); waitForBody(app)
        settings(app, mode: "仿真", dark: false)
        curlTurn(app, forward: true, cancel: true)
        app.buttons["目录与书签"].tap(); app.buttons["已读范围"].tap()
        XCTAssertTrue(app.tables["read-chapters"].cells["read-chapter-1"].label.contains("未确认已读"), "Curl prefetch and cancellation never grant access")
        evidence("issue13-navigation-and-prefetch-no-read-growth", app)
        app.navigationBars.buttons.element(boundBy: 0).tap(); app.buttons["完成"].tap()
        settings(app, mode: "滚动", dark: false)
        app.buttons["reader-ask-book"].tap()
        XCTAssertTrue(app.segmentedControls["question-reading-range"].buttons["整书"].isSelected)
        app.segmentedControls["question-reading-range"].buttons["仅已读"].tap()
        issue12Send("UI13-RESTRICTED 全书余辉与停机有哪些联系？", app: app)
        XCTAssertTrue(app.staticTexts["question-scope"].label.contains("可能缺少后文解释"))
        evidence("issue13-restricted-answer-and-notice", app)
        let follow = app.buttons["question-follow-up"]; issue12Reach(follow, in: app); follow.tap()
        XCTAssertTrue(app.segmentedControls["question-reading-range"].buttons["仅已读"].isSelected)
        app.buttons["关闭"].tap(); app.buttons["书架"].tap()
        app.collectionViews["library"].cells[bookID].tap(); waitForBody(app)
        app.buttons["目录与书签"].tap(); app.buttons["已读范围"].tap()
        XCTAssertTrue(app.tables["read-chapters"].cells["read-chapter-0"].label.contains("未确认已读"))
        evidence("issue13-other-book-no-read-record", app)
        app.navigationBars.buttons.element(boundBy: 0).tap(); app.buttons["完成"].tap(); app.buttons["书架"].tap()
    }
    func testIssue13NativeSelectionAndReferenceRange() {
        let app = issue12App()
        app.tabBars.buttons["书架"].tap()
        app.collectionViews["library"].cells["book-df8c4a78180b9f65911e9fbba7cf4fb9c6f932c0e98456ef15e165157d9b1a67"].tap(); waitForBody(app)
        searchBook(app, query: "第七日发生电池漏液", count: 1)
        app.tables["book-search-results"].cells.firstMatch.tap(); waitForBody(app)
        app.buttons["目录与书签"].tap(); app.buttons["已读范围"].tap()
        XCTAssertTrue(app.tables["read-chapters"].cells["read-chapter-1"].label.contains("未确认已读"))
        evidence("issue13-search-jump-no-read-growth", app)
        app.navigationBars.buttons.element(boundBy: 0).tap(); app.buttons["完成"].tap()
        searchBook(app, query: "初版规则规定所有停机指令", count: 1)
        app.tables["book-search-results"].cells.firstMatch.tap(); waitForBody(app)
        let paragraph = app.webViews.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "初版规则规定所有停机指令")).firstMatch
        XCTAssertTrue(paragraph.waitForExistence(timeout: 5)); paragraph.press(forDuration: 1.3); noteMenu("提问", in: app)
        app.segmentedControls["question-reading-range"].buttons["仅已读"].tap()
        issue12Send("UI13-NATIVE 这条停机规则是什么意思？", app: app)
        evidence("issue13-native-selected-restricted-answer", app)
        let reference = app.buttons["question-reference-0"]; issue12Reach(reference, in: app); reference.tap()
        app.buttons["跳转原文"].tap(); waitForBody(app)
        app.buttons["回提问处"].tap(); waitForBody(app)
        app.buttons["目录与书签"].tap(); app.buttons["已读范围"].tap()
        for chapter in [0, 2] { XCTAssertTrue(app.tables["read-chapters"].cells["read-chapter-" + String(chapter)].label.contains("已确认已读")) }
        XCTAssertTrue(app.tables["read-chapters"].cells["read-chapter-1"].label.contains("未确认已读"))
        evidence("issue13-reference-return-no-read-growth", app)
        app.navigationBars.buttons.element(boundBy: 0).tap(); app.buttons["完成"].tap(); app.buttons["书架"].tap()
    }
    func testIssue13RestartRangeAndOfflineHistory() {
        let app = issue12App()
        app.tabBars.buttons["书架"].tap()
        app.collectionViews["library"].cells["book-df8c4a78180b9f65911e9fbba7cf4fb9c6f932c0e98456ef15e165157d9b1a67"].tap(); waitForBody(app)
        app.buttons["目录与书签"].tap(); app.buttons["已读范围"].tap()
        for chapter in [0, 2] { XCTAssertTrue(app.tables["read-chapters"].cells["read-chapter-" + String(chapter)].label.contains("已确认已读")) }
        XCTAssertTrue(app.tables["read-chapters"].cells["read-chapter-1"].label.contains("未确认已读"))
        evidence("issue13-restart-range", app)
        app.navigationBars.buttons.element(boundBy: 0).tap(); app.buttons["完成"].tap(); app.buttons["书架"].tap()
        app.tabBars.buttons["对话"].tap(); issue12Row("UI13-RESTRICTED", app: app).tap()
        XCTAssertTrue(app.segmentedControls["question-reading-range"].buttons["仅已读"].isSelected)
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "仅依据本次实际材料解释。")).firstMatch.exists)
        evidence("issue13-offline-range-draft-and-history", app)
        app.buttons["关闭"].tap()
    }
    private func issue12App() -> XCUIApplication {
        continueAfterFailure = false
        let app = XCUIApplication(); app.launchArguments = ["--isolated-reading-test"]
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 10),
                      "Harness must simctl terminate, then launch dev.shudeng.app --isolated-reading-test before attach; never launch from XCTest")
        return app
    }
    private func issue12Reach(_ element: XCUIElement, in app: XCUIApplication) {
        let scroll = app.scrollViews["question-scroll"]
        for _ in 0..<18 where !element.isHittable {
            if element.frame.minY < 90 { scroll.swipeDown() } else { scroll.swipeUp() }
        }
        XCTAssertTrue(element.isHittable, app.debugDescription)
    }
    private func issue12Send(_ text: String, app: XCUIApplication) {
        let input = app.textViews["question-input"]; issue12Reach(input, in: app)
        input.tap(); input.typeText(text)
        let send = app.buttons["question-send"]; issue12Reach(send, in: app); send.tap()
        XCTAssertTrue(app.alerts["发送书内原文"].waitForExistence(timeout: 5))
        evidence("issue12-disclosure-" + text, app)
        app.alerts.buttons["发送并查找书内依据"].tap(); questionSaved(app)
    }
    private func issue12Row(_ name: String, app: XCUIApplication) -> XCUIElement {
        app.tables["question-history"].cells.containing(NSPredicate(format: "label CONTAINS %@", name)).firstMatch
    }
    func testIssue12LocalFirstWithRealPreparationFault() {
        let app = issue12App()
        questionService(app, format: "OpenAI", model: "ui12", address: "http://127.0.0.1:18772/v1")
        let book = app.collectionViews["library"].cells["book-df8c4a78180b9f65911e9fbba7cf4fb9c6f932c0e98456ef15e165157d9b1a67"]
        XCTAssertTrue((book.value as? String ?? "").contains("失败")); evidence("issue12-real-preparation-failure", app)
        book.tap(); waitForBody(app)
        let paragraph = app.webViews.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "初版规则规定所有停机指令")).firstMatch
        XCTAssertTrue(paragraph.waitForExistence(timeout: 5)); paragraph.press(forDuration: 1.3); noteMenu("提问", in: app)
        app.textViews["question-input"].tap(); app.textViews["question-input"].typeText("初版规则要求多久后执行停机，等待是为了什么？")
        app.buttons["question-send"].tap()
        XCTAssertTrue(app.alerts["资料尚未准备完整"].waitForExistence(timeout: 5))
        evidence("issue12-explicit-local-choice", app)
        app.alerts.buttons["仅用选文解释"].tap(); questionSaved(app)
        XCTAssertTrue(app.staticTexts["question-scope"].label.contains("主动选择局部"))
        evidence("issue12-local-first-saved", app)
        app.buttons["关闭"].tap(); app.buttons["书架"].tap()
    }
    func testIssue12RecoveredFollowupAndTwoBookHistory() {
        // Reuse local-first's isolated directory. After removing the preparation fault,
        // the host must explicitly terminate/launch with --isolated-reading-test.
        let app = issue12App()
        let semantic = app.collectionViews["library"].cells["book-df8c4a78180b9f65911e9fbba7cf4fb9c6f932c0e98456ef15e165157d9b1a67"]
        expectation(for: NSPredicate { _, _ in (semantic.value as? String ?? "").contains("书内资料可用") }, evaluatedWith: app); waitForExpectations(timeout: 60)
        evidence("issue12-recovered-preparation-before-history", app)
        questionService(app, format: "Anthropic", model: "ui12", address: "http://127.0.0.1:18772/v1")
        app.tabBars.buttons["对话"].tap(); issue12Row("初版规则要求多久", app: app).tap()
        let follow = app.buttons["question-follow-up"]; issue12Reach(follow, in: app); follow.tap()
        issue12Send("那他为什么改口？", app: app)
        evidence("issue12-recovered-new-causes-saved", app)
        app.buttons["关闭"].tap(); app.tabBars.buttons["书架"].tap()
        semantic.tap(); waitForBody(app); app.buttons["reader-ask-book"].tap()
        issue12Send("书中的余辉是什么意思？", app: app)
        let follow2 = app.buttons["question-follow-up"]; issue12Reach(follow2, in: app); follow2.tap()
        issue12Send("这种延迟在危险停机时应该怎么办？", app: app)
        app.buttons["关闭"].tap(); app.buttons["书架"].tap()
        app.collectionViews["library"].cells[bookID].tap(); waitForBody(app); app.buttons["reader-ask-book"].tap()
        issue12Send("UI12第二书：阅读需要保留什么？", app: app)
        app.buttons["关闭"].tap(); app.buttons["书架"].tap(); app.tabBars.buttons["对话"].tap()
        XCTAssertEqual(app.tables["question-history"].cells.count, 3)
        XCTAssertTrue(app.staticTexts["semantic-fixture"].exists); XCTAssertTrue(app.staticTexts["original-fixture"].exists)
        evidence("issue12-two-book-grouped-history", app)
        let row = issue12Row("UI12第二书", app: app); row.swipeLeft(); app.buttons["改名"].tap()
        let field = app.textFields["conversation-name"]; field.tap()
        field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: (field.value as? String ?? "").count)); field.typeText("UI12改名已保存")
        app.alerts.buttons["保存"].tap(); XCTAssertTrue(issue12Row("UI12改名已保存", app: app).exists)
        let remove = issue12Row("书中的余辉", app: app); remove.swipeLeft(); app.buttons["删除"].tap(); app.alerts.buttons["取消"].tap()
        XCTAssertTrue(issue12Row("书中的余辉", app: app).exists)
        issue12Row("书中的余辉", app: app).swipeLeft(); app.buttons["删除"].tap(); app.alerts.buttons["删除"].tap()
        XCTAssertEqual(app.tables["question-history"].cells.count, 2)
        // Persist a follow-up draft, then let the external harness restart explicitly.
        issue12Row("初版规则要求多久", app: app).tap()
        let draft = app.buttons["question-follow-up"]; issue12Reach(draft, in: app); draft.tap()
        let input = app.textViews["question-input"]; issue12Reach(input, in: app); input.tap(); input.typeText("UI12可恢复追问草稿")
        app.buttons["关闭"].tap(); evidence("issue12-renamed-deleted-draft-saved", app)
    }
    func testIssue12OfflineRestartSnapshotsAndDraft() {
        let app = issue12App(); app.tabBars.buttons["对话"].tap()
        XCTAssertEqual(app.tables["question-history"].cells.count, 2)
        XCTAssertTrue(issue12Row("UI12改名已保存", app: app).exists); XCTAssertFalse(issue12Row("书中的余辉", app: app).exists)
        issue12Row("初版规则要求多久", app: app).tap()
        let input = app.textViews["question-input"]; issue12Reach(input, in: app)
        XCTAssertEqual(input.value as? String, "UI12可恢复追问草稿")
        evidence("issue12-offline-recovered-draft-and-history", app)
        let reference = app.buttons.matching(NSPredicate(format: "label BEGINSWITH '引用 '")).firstMatch
        issue12Reach(reference, in: app); reference.tap()
        XCTAssertTrue(app.navigationBars["原文材料"].waitForExistence(timeout: 5)); evidence("issue12-offline-original-snapshot", app)
    }
    // The harness installs and launches with simctl --isolated-reading-test.
    // Attach only: never fall back to launching the business application.
    func testIssue14OpenAI20() throws { try backgroundQuestion(format: "OpenAI", delay: 20) }
    func testIssue14OpenAI60() throws { try backgroundQuestion(format: "OpenAI", delay: 60) }
    func testIssue14Anthropic20() throws { try backgroundQuestion(format: "Anthropic", delay: 20) }
    func testIssue14Anthropic60() throws { try backgroundQuestion(format: "Anthropic", delay: 60) }
    private func backgroundQuestion(format: String, delay: Int) throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--isolated-reading-test"]
        XCTAssertNotEqual(app.state, .notRunning, "Explicit isolated simctl launch required")
        if app.state != .runningForeground { app.activate() }
        questionService(app, format: format, model: "bg-\(delay)", address: "http://127.0.0.1:18774/v1")
        questionSelection(app)
        sendSelectedQuestion(app, text: "BG14-\(format)-\(delay) 解释这段话")
        app.buttons["关闭"].tap()
        let before = app.webViews.firstMatch.screenshot()
        let shot = XCTAttachment(screenshot: before); shot.name = "issue14-before-reading"; shot.lifetime = .keepAlways; add(shot)
        app.swipeUp()
        evidence("issue14-after-reading-\(format)-\(delay)", app)
        print("BG14 home \(format) \(delay) \(Date().timeIntervalSince1970)")
        XCUIDevice.shared.press(.home)
        // Do not query/activate the app while awaiting the background response.
        Thread.sleep(forTimeInterval: TimeInterval(delay + 3))
        print("BG14 return \(format) \(delay) \(Date().timeIntervalSince1970)")
        print("BG14 observed app state \(app.state.rawValue)")
        XCTAssertNotEqual(app.state, .notRunning, "Use explicit simctl isolated restart and offline verification if the OS terminated the app")
        app.activate()
        app.buttons["书架"].tap()
        if !app.tabBars.firstMatch.waitForExistence(timeout: 3) { app.buttons["书架"].tap() }
        app.tabBars.buttons["对话"].tap()
        app.tables["question-history"].cells.containing(NSPredicate(format: "label CONTAINS %@", "BG14-\(format)-\(delay)")).firstMatch.tap()
        XCTAssertEqual(app.staticTexts["question-status"].label, "回答已保存")
        XCTAssertEqual(app.staticTexts["question-answer"].label, "BG14-\(format)-\(delay)")
        evidence("issue14-background-saved-\(format)-\(delay)", app)
        app.buttons["关闭"].tap(); app.tabBars.buttons["书架"].tap()
    }
    func testIssue14OfflineRestart() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--isolated-reading-test"]
        XCTAssertEqual(app.state, .runningForeground)
        app.tabBars.buttons["对话"].tap()
        for format in ["OpenAI", "Anthropic"] {
            for delay in [20, 60] {
                let name = "BG14-\(format)-\(delay)"
                let row = app.tables["question-history"].cells.containing(NSPredicate(format: "label CONTAINS %@", name))
                XCTAssertEqual(row.count, 1); row.firstMatch.tap()
                if delay == 20 {
                    XCTAssertEqual(app.staticTexts["question-status"].label, "回答已保存")
                    XCTAssertEqual(app.staticTexts["question-answer"].label, name)
                } else {
                    XCTAssertTrue(app.staticTexts["question-status"].label.contains("系统后台时间已结束"))
                    XCTAssertFalse(app.staticTexts["question-answer"].exists)
                }
                evidence("issue14-offline-" + name, app); app.buttons["关闭"].tap()
            }
        }
    }
    func testIssue15SmallDarkLargeControls() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--isolated-reading-test"]
        app.launch()
        let shelf = app.collectionViews["library"]
        XCTAssertTrue(shelf.waitForExistence(timeout: 10))
        evidence("issue15-small-dark-large-grid", app)
        func query(_ value: String) {
            let field = app.textFields["library-search"]
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
            let field = app.textFields["library-search"]
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
    func testIssue18CurrentPreparationFailureWaitThenExplicitLocalChoice() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--isolated-reading-test"]
        app.launch()
        issue17Import("semantic-fixture.epub", in: app)
        app.alerts.buttons["知道了"].tap()
        let book = app.collectionViews["library"].cells["book-df8c4a78180b9f65911e9fbba7cf4fb9c6f932c0e98456ef15e165157d9b1a67"]
        XCTAssertTrue(book.waitForExistence(timeout: 10))
        expectation(for: NSPredicate { _, _ in
            (book.value as? String ?? "").contains("书内资料可用")
        }, evaluatedWith: app)
        waitForExpectations(timeout: 90)
        print("I18_INJECT_PREPARATION_FAULT")
        app.terminate()
        Thread.sleep(forTimeInterval: 5)
        app.launch()
        XCTAssertTrue(book.waitForExistence(timeout: 10))
        expectation(for: NSPredicate { _, _ in
            (book.value as? String ?? "").contains("失败")
        }, evaluatedWith: app)
        waitForExpectations(timeout: 15)
        questionService(app, format: "OpenAI", model: "prep-wait", address: "http://127.0.0.1:18769/v1")
        book.tap()
        if app.alerts["翻页准备失败"].waitForExistence(timeout: 3) {
            app.alerts.buttons["使用分页"].tap()
        }
        waitForBody(app)
        searchBook(app, query: "初版规则规定", count: 1)
        app.tables["book-search-results"].cells.firstMatch.tap()
        waitForBody(app)
        let paragraph = app.webViews.staticTexts.matching(
            NSPredicate(format: "label CONTAINS %@", "初版规则规定所有停机指令")
        ).firstMatch
        XCTAssertTrue(paragraph.waitForExistence(timeout: 5))
        paragraph.press(forDuration: 1.3)
        noteMenu("提问", in: app)
        let input = app.textViews["question-input"]
        XCTAssertTrue(input.waitForExistence(timeout: 5))
        input.tap(); input.typeText("资料尚未准备完整时，应该等待还是只用选文解释？")
        app.buttons["question-send"].tap()
        XCTAssertTrue(app.alerts["资料尚未准备完整"].waitForExistence(timeout: 5))
        evidence("issue18-current-preparation-wait-or-local-choice", app)
        app.alerts.buttons["等待资料准备"].tap()
        XCTAssertEqual(app.staticTexts["question-status"].label, "问题草稿")
        app.buttons["question-send"].tap()
        let local = app.buttons["仅用选文解释"].firstMatch
        XCTAssertTrue(local.waitForExistence(timeout: 5))
        local.tap()
        questionSaved(app)
        XCTAssertTrue(app.staticTexts["question-scope"].label.contains("主动选择局部"))
        evidence("issue18-current-explicit-local-answer-saved", app)
    }

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
        app.buttons["question-send"].tap(); app.alerts.buttons["仅用选文解释"].tap()
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

extension ReadingUITests {
    func testIssue14HTTPInFlightStart() {
        continueAfterFailure = false
        let app = XCUIApplication(); app.launchArguments = ["--isolated-reading-test"]
        XCTAssertEqual(app.state, .runningForeground)
        questionService(app, format: "OpenAI", model: "bg-120", address: "http://127.0.0.1:18774/v1")
        questionSelection(app); sendSelectedQuestion(app, text: "BG14-http-inflight")
        let generating = NSPredicate { _, _ in app.staticTexts["question-status"].label.contains("正在生成") }
        expectation(for: generating, evaluatedWith: app); waitForExpectations(timeout: 30)
        evidence("issue14-http-inflight-before-termination", app)
        // The external harness also requires a server request receipt before terminating.
        print("BG14 HTTP INFLIGHT READY")
    }
    func testIssue14HTTPInFlightRestartAndRetry() {
        continueAfterFailure = false
        let app = XCUIApplication(); app.launchArguments = ["--isolated-reading-test"]
        XCTAssertEqual(app.state, .runningForeground)
        questionService(app, format: "OpenAI", model: "bg-20", address: "http://127.0.0.1:18774/v1")
        app.tabBars.buttons["对话"].tap()
        // Fixed UUID links this evidence run to the externally terminated HTTP request.
        let targetID = "A0D247F7-0C99-4EB7-A9F7-AFBA0C4BE2A8"
        let row = app.tables["question-history"].cells["question-\(targetID)"]
        XCTAssertTrue(row.waitForExistence(timeout: 5)); row.tap()
        XCTAssertTrue(app.staticTexts["question-status"].label.contains("上次生成已中断"))
        XCTAssertFalse(app.staticTexts["question-answer"].exists)
        evidence("issue14-http-inflight-restart-incomplete", app)
        app.buttons["question-send"].tap(); app.alerts.buttons["发送并查找书内依据"].tap()
        let saved = NSPredicate { _, _ in app.staticTexts["question-status"].label == "回答已保存" }
        expectation(for: saved, evaluatedWith: app); waitForExpectations(timeout: 65)
        XCTAssertEqual(app.staticTexts["question-answer"].label, "BG14-OpenAI-20")
        evidence("issue14-http-inflight-active-retry-saved", app)
        app.buttons["关闭"].tap(); XCTAssertTrue(app.tables["question-history"].cells["question-\(targetID)"].exists)
    }
    func testIssue14SavedFaultRecordOfflineRestart() {
        continueAfterFailure = false
        let app = XCUIApplication(); app.launchArguments = ["--isolated-reading-test"]
        XCTAssertEqual(app.state, .runningForeground)
        app.tabBars.buttons["对话"].tap()
        let rows = app.tables["question-history"].cells.containing(NSPredicate(format: "label CONTAINS 'BG14-write-failure-final'"))
        XCTAssertEqual(rows.count, 1); rows.firstMatch.tap()
        XCTAssertEqual(app.staticTexts["question-status"].label, "回答已保存")
        XCTAssertEqual(app.staticTexts["question-answer"].label, "BG14-OpenAI-20")
        XCTAssertTrue(app.buttons["question-reference-0"].exists)
        evidence("issue14-save-fault-offline-restart-answer-and-reference", app)
    }
    func testIssue14ClosePanelContinueReading() {
        continueAfterFailure = false
        let app = XCUIApplication(); app.launchArguments = ["--isolated-reading-test"]
        XCTAssertEqual(app.state, .runningForeground)
        questionService(app, format: "OpenAI", model: "bg-20", address: "http://127.0.0.1:18774/v1")
        questionSelection(app); sendSelectedQuestion(app, text: "BG14-reading-continues-final")
        app.buttons["关闭"].tap()
        let web = app.webViews.firstMatch
        let marker = web.staticTexts["S1-SECOND"].firstMatch
        XCTAssertTrue(marker.exists)
        let before = marker.frame
        XCTAssertGreaterThan(before.minY, 100); XCTAssertLessThan(before.maxY, app.frame.height - 80)
        print("BG14 READING BEFORE \(before)")
        evidence("issue14-reading-before-scroll", app)
        Thread.sleep(forTimeInterval: 2) // External harness snapshots the persisted Locator.
        web.swipeDown()
        let moved = NSPredicate { _, _ in !marker.exists || abs(marker.frame.minY - before.minY) > 100 }
        expectation(for: moved, evaluatedWith: app); waitForExpectations(timeout: 10)
        print("BG14 READING AFTER \(marker.exists ? marker.frame : .zero)")
        evidence("issue14-reading-after-scroll", app)
        Thread.sleep(forTimeInterval: 2)
        XCUIDevice.shared.press(.home)
        Thread.sleep(forTimeInterval: 24)
        XCTAssertNotEqual(app.state, .notRunning); app.activate()
        app.buttons["书架"].tap(); app.tabBars.buttons["对话"].tap()
        let rows = app.tables["question-history"].cells.containing(NSPredicate(format: "label CONTAINS 'BG14-reading-continues-final'"))
        XCTAssertEqual(rows.count, 1); rows.firstMatch.tap()
        let saved = NSPredicate { _, _ in app.staticTexts["question-status"].label == "回答已保存" }
        expectation(for: saved, evaluatedWith: app); waitForExpectations(timeout: 30)
        XCTAssertEqual(app.staticTexts["question-answer"].label, "BG14-OpenAI-20")
        evidence("issue14-close-panel-request-continued-and-saved", app)
    }
    func testIssue14BackgroundWriteFailure() throws {
        continueAfterFailure = false
        let app = XCUIApplication(); app.launchArguments = ["--isolated-reading-test"]
        XCTAssertEqual(app.state, .runningForeground)
        questionService(app, format: "OpenAI", model: "bg-20", address: "http://127.0.0.1:18774/v1")
        questionSelection(app); sendSelectedQuestion(app, text: "BG14-write-failure-final")
        app.buttons["关闭"].tap(); XCUIDevice.shared.press(.home)
        Thread.sleep(forTimeInterval: 24)
        XCTAssertNotEqual(app.state, .notRunning); app.activate()
        XCTAssertTrue(app.buttons["书架"].waitForExistence(timeout: 5))
        app.buttons["书架"].tap()
        XCTAssertTrue(app.tabBars.firstMatch.waitForExistence(timeout: 5))
        app.tabBars.buttons["对话"].tap()
        app.tables["question-history"].cells.containing(NSPredicate(format: "label CONTAINS 'BG14-write-failure-final'")).firstMatch.tap()
        XCTAssertTrue(app.staticTexts["question-status"].label.contains("保存失败"))
        XCTAssertEqual(app.staticTexts["question-answer"].label, "BG14-OpenAI-20")
        evidence("issue14-real-background-save-failure", app)
        app.buttons["重试保存"].tap(); questionSaved(app)
        evidence("issue14-background-save-retried", app)
        app.buttons["关闭"].tap(); app.tabBars.buttons["书架"].tap()
    }
    func testIssue14StartInterruptedRequest() throws {
        continueAfterFailure = false
        let app = XCUIApplication(); app.launchArguments = ["--isolated-reading-test"]
        XCTAssertEqual(app.state, .runningForeground)
        questionService(app, format: "OpenAI", model: "bg-20", address: "http://127.0.0.1:18774/v1")
        questionSelection(app); sendSelectedQuestion(app, text: "BG14-terminate-retry")
        XCTAssertTrue(app.staticTexts["question-status"].label.contains("正在"))
        app.buttons["关闭"].tap(); XCUIDevice.shared.press(.home)
        print("BG14 TERMINATE NOW \(Date().timeIntervalSince1970)")
    }
    func testIssue14InterruptedRestartAndActiveRetry() {
        continueAfterFailure = false
        let app = XCUIApplication(); app.launchArguments = ["--isolated-reading-test"]
        XCTAssertEqual(app.state, .runningForeground)
        app.tabBars.buttons["对话"].tap()
        let rows = app.tables["question-history"].cells.containing(NSPredicate(format: "label CONTAINS 'BG14-terminate-retry'"))
        XCTAssertEqual(rows.count, 1); rows.firstMatch.tap()
        XCTAssertTrue(app.staticTexts["question-status"].label.contains("上次生成已中断"))
        XCTAssertFalse(app.staticTexts["question-answer"].exists)
        evidence("issue14-terminated-restart-incomplete", app)
        app.buttons["question-send"].tap(); app.alerts.buttons["发送并查找书内依据"].tap()
        let saved = NSPredicate { _, _ in app.staticTexts["question-status"].label == "回答已保存" }
        expectation(for: saved, evaluatedWith: app); waitForExpectations(timeout: 30)
        evidence("issue14-active-new-request-same-record", app)
        app.buttons["关闭"].tap(); XCTAssertEqual(rows.count, 1)
    }
}

extension ReadingUITests {
    private var removalA: String { "book-91596d461eec70d5167646cb4ac2c8cd3802fe74ae9eecd0825856593e4526f3" }
    private var removalB: String { "book-ad52254cb4e46c6077c7bbe4f1c1822100a98ae6916fd87cb071930b8bd45a98" }
    private func removalMenu(_ app: XCUIApplication, delete: Bool) {
        let book = app.collectionViews["library"].cells[removalA]
        XCTAssertTrue(book.waitForExistence(timeout: 10)); book.press(forDuration: 1.3)
        let action = delete ? "连同记录彻底删除" : "移除原书，保留记录"
        XCTAssertTrue(app.buttons[action].waitForExistence(timeout: 5)); app.buttons[action].tap()
        XCTAssertTrue(app.alerts.firstMatch.waitForExistence(timeout: 5))
    }
    func testIssue16RemoveOriginalKeepRecords() {
        let app = issue12App()
        removalMenu(app, delete: false)
        evidence("issue16-default-removal-disclosure", app)
        app.alerts.buttons["移除原书，保留记录"].tap()
        expectation(for: NSPredicate { _, _ in !app.collectionViews["library"].cells[self.removalA].exists }, evaluatedWith: app)
        waitForExpectations(timeout: 15)
        XCTAssertTrue(app.collectionViews["library"].cells[removalB].exists)
        app.buttons["已移除"].tap()
        XCTAssertTrue(app.collectionViews["library"].cells[removalA].exists)
        evidence("issue16-removed-record-management", app)
        app.buttons["返回书架"].tap()
    }
    func testIssue16OfflineRestartNotesAndCitations() {
        let app = issue12App()
        XCTAssertFalse(app.collectionViews["library"].cells[removalA].exists)
        app.tabBars.buttons["笔记"].tap()
        let note = app.tables["notes"].cells.containing(NSPredicate(format: "label CONTAINS %@", "A retained draft")).firstMatch
        XCTAssertTrue(note.waitForExistence(timeout: 5)); note.tap()
        XCTAssertEqual(app.textViews["note-body"].value as? String, "A retained draft")
        XCTAssertTrue((app.textViews["note-quote"].value as? String ?? "").contains("盐桥"))
        evidence("issue16-offline-retained-note-draft-quote", app)
        app.buttons["返回原文"].tap()
        XCTAssertTrue(app.alerts["无法返回原文"].waitForExistence(timeout: 5))
        evidence("issue16-note-original-unavailable", app); app.alerts.buttons["知道了"].tap()
        app.tabBars.buttons["对话"].tap()
        let row = app.tables["question-history"].cells.containing(NSPredicate(format: "label CONTAINS %@", "Removal 91596")).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 5)); row.tap()
        XCTAssertTrue(app.staticTexts["question-answer"].label.contains("Saved answer"))
        XCTAssertFalse(app.buttons["question-follow-up"].isEnabled)
        let reference = app.buttons["question-reference-0"]; issue12Reach(reference, in: app); reference.tap()
        app.buttons["跳转原文"].tap()
        XCTAssertTrue(app.alerts["原文不可用"].waitForExistence(timeout: 5))
        evidence("issue16-offline-answer-citation-unavailable", app)
        app.alerts.buttons["知道了"].tap(); app.navigationBars.buttons.element(boundBy: 0).tap(); app.buttons["关闭"].tap()
        app.tabBars.buttons["书架"].tap()
    }
    func testIssue16PickerRestoreAndCancelDeletion() {
        let app = issue12App()
        app.buttons["导入"].tap()
        let folder = app.cells["Issue16Acceptance, Folder"]
        if !folder.waitForExistence(timeout: 3) {
            let browse = app.buttons.matching(identifier: "浏览").firstMatch
            XCTAssertTrue(browse.waitForExistence(timeout: 5)); browse.tap()
            if !folder.waitForExistence(timeout: 2) {
                let back = app.navigationBars.buttons["BackButton"]
                if back.exists { back.tap() }
                let local = app.cells["DOC.sidebar.item.我的iPhone"]
                if local.waitForExistence(timeout: 3) { local.tap() }
            }
        }
        XCTAssertTrue(folder.waitForExistence(timeout: 5)); folder.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.25)).tap()
        let file = app.cells.matching(NSPredicate(format: "identifier BEGINSWITH %@", "semantic-other.epub,")).firstMatch
        XCTAssertTrue(file.waitForExistence(timeout: 5)); file.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.25)).tap()
        XCTAssertTrue(app.alerts.firstMatch.waitForExistence(timeout: 10)); evidence("issue16-identical-file-restored", app)
        app.alerts.buttons["知道了"].tap()
        XCTAssertTrue(app.collectionViews["library"].cells[removalA].exists)
        removalMenu(app, delete: true)
        evidence("issue16-destructive-explicit-confirmation", app); app.alerts.buttons["取消"].tap()
        XCTAssertTrue(app.collectionViews["library"].cells[removalA].exists)
    }
    func testIssue16ConfirmDeletion() {
        let app = issue12App()
        removalMenu(app, delete: true); app.alerts.buttons["确认彻底删除"].tap()
        expectation(for: NSPredicate { _, _ in !app.collectionViews["library"].cells[self.removalA].exists }, evaluatedWith: app)
        waitForExpectations(timeout: 15)
        XCTAssertTrue(app.collectionViews["library"].cells[removalB].exists)
        app.tabBars.buttons["笔记"].tap()
        XCTAssertFalse(app.tables["notes"].cells.containing(NSPredicate(format: "label CONTAINS %@", "A retained draft")).firstMatch.exists)
        app.tabBars.buttons["对话"].tap()
        XCTAssertFalse(app.tables["question-history"].cells.containing(NSPredicate(format: "label CONTAINS %@", "Removal 91596")).firstMatch.exists)
        XCTAssertTrue(app.tables["question-history"].cells.containing(NSPredicate(format: "label CONTAINS %@", "Removal ad522")).firstMatch.exists)
        evidence("issue16-target-deleted-other-book-retained", app)
    }
}
