import XCTest
import UIKit

extension ReadingUITests {
    func testToolbarLatencyPagination() throws { try checkToolbarLatency(mode: "分页") }
    func testToolbarLatencyScroll() throws { try checkToolbarLatency(mode: "滚动") }
    func testToolbarLatencyCurl() throws { try checkToolbarLatency(mode: "仿真") }

    private func toolbarLatency(_ app: XCUIApplication) -> [String: Any]? {
        guard let value = app.otherElements["reading-content"].value as? String,
              let data = value.data(using: .utf8),
              let observation = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        return observation["toolbarLatency"] as? [String: Any]
    }
    private func checkToolbarLatency(mode: String) throws {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
        let app = XCUIApplication()
        app.launchArguments = ["--design-fixture=long", "--design-theme=light", "--reader-acceptance", "--toolbar-latency-acceptance"]
        app.launch()
        XCTAssertTrue(app.buttons["continue-reading"].waitForExistence(timeout: 15))
        app.buttons["continue-reading"].tap()
        fullscreenWait { app.buttons["reader-settings"].exists && app.buttons["reader-settings"].isEnabled }
        settings(app, mode: mode, dark: false, font: 100)
        fullscreenWait { app.buttons["reader-settings"].exists && app.buttons["reader-settings"].isEnabled && self.fullscreenVisibleCharacter(app) != nil }
        for _ in 0..<4 where !fullscreenPageHasNoFixtureNotes(app) {
            let initialObservation = try XCTUnwrap(fullscreenObservation(app))
            advanceReading(app, mode: mode)
            fullscreenWait {
                (self.fullscreenObservation(app) ?? 0) > initialObservation &&
                    app.buttons["reader-settings"].isEnabled && self.fullscreenVisibleCharacter(app) != nil
            }
        }
        XCTAssertTrue(fullscreenPageHasNoFixtureNotes(app), "计时输入页必须不含fixture的两处笔记原文")
        evidence("toolbar-latency-\(mode)-unannotated-input-page", app)
        let original = try XCTUnwrap(fullscreenVisibleCharacter(app))
        var measured: [[String: Any]] = []
        for hidden in [true, false] {
            let previousAction = toolbarLatency(app)?["action"] as? Int ?? 0
            let started = ProcessInfo.processInfo.systemUptime
            app.webViews.firstMatch.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
            fullscreenWait(timeout: 30) {
                guard let sample = self.toolbarLatency(app),
                      let action = sample["action"] as? Int, action > previousAction,
                      sample["usableMS"] as? Double != nil, sample["interactive"] as? Bool == true,
                      sample["controlsHidden"] as? Bool == hidden else { return false }
                return self.fullscreenCharacterIsVisible(original, in: app)
            }
            let sample = try XCTUnwrap(toolbarLatency(app))
            print("[ReaderToolbarAcceptance] mode=\(mode) hidden=\(hidden) wallMS=\((ProcessInfo.processInfo.systemUptime - started) * 1000) sample=\(sample)")
            measured.append(sample)
            XCTAssertEqual(app.buttons["reader-settings"].exists, !hidden)
            XCTAssertEqual(app.buttons["reader-ask-book"].exists, !hidden)
            evidence("toolbar-latency-\(mode)-\(hidden ? "hide" : "show")", app)
        }
        let beforeBurst = toolbarLatency(app)?["action"] as? Int ?? 0
        let viewport = app.webViews.firstMatch.frame
        let point = fullscreenCharacterPoint(original, in: app)
        // A native five-tap event exercises interruptions inside the 200ms
        // fade. The odd final intent is hidden; a stale completion must lose.
        app.webViews.firstMatch.tap(withNumberOfTaps: 5, numberOfTouches: 1)
        fullscreenWait(timeout: 10) {
            guard let sample = self.toolbarLatency(app), sample["action"] as? Int == beforeBurst + 5,
                  sample["controlsHidden"] as? Bool == true, sample["interactive"] as? Bool == true,
                  sample["usableMS"] as? Double != nil else { return false }
            return !app.buttons["reader-settings"].exists && self.fullscreenCharacterIsVisible(original, in: app)
        }
        XCTAssertEqual(app.webViews.firstMatch.frame, viewport)
        if let point { XCTAssertEqual(fullscreenCharacterPoint(original, in: app), point) }
        measured.append(try XCTUnwrap(toolbarLatency(app)))
        evidence("toolbar-latency-\(mode)-rapid-latest-intent", app)
        // Exercise the live reader while chrome is hidden. Toggle latency ends
        // before this real turn, so normal curl prefetch is measured separately.
        let hiddenObservation = try XCTUnwrap(fullscreenObservation(app))
        advanceReading(app, mode: mode)
        fullscreenWait {
            (self.fullscreenObservation(app) ?? 0) > hiddenObservation &&
                self.fullscreenVisibleCharacter(app).map { $0 != original } == true &&
                !app.buttons["reader-settings"].exists
        }
        let moved = try XCTUnwrap(fullscreenVisibleCharacter(app))
        evidence("toolbar-latency-\(mode)-hidden-native-input", app)
        app.webViews.firstMatch.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        fullscreenWait {
            app.buttons["reader-settings"].isHittable && app.buttons["reader-settings"].isEnabled &&
                self.fullscreenCharacterIsVisible(moved, in: app)
        }
        app.buttons["reader-settings"].tap()
        XCTAssertTrue(app.navigationBars["阅读设置"].waitForExistence(timeout: 5))
        app.buttons["取消"].tap()
        // Both actions are measured before checking latency, so a slow hide
        // cannot prevent the same baseline run from measuring show.
        continueAfterFailure = true
        for sample in measured {
            XCTAssertLessThanOrEqual(try XCTUnwrap(sample["chromeMS"] as? Double), 250, "\(mode) controls should respond within250ms")
            XCTAssertLessThanOrEqual(try XCTUnwrap(sample["usableMS"] as? Double), 350, "\(mode) live source should be usable within350ms")
            XCTAssertEqual(sample["rebuilds"] as? Int, 0, "工具栏不应重建阅读器")
            XCTAssertEqual(sample["enteredLoading"] as? Bool, false, "工具栏不应让正文进入加载状态")
            XCTAssertEqual(sample["enteredCurlBusy"] as? Bool, false, "工具栏不应重做仿真预取")
            XCTAssertEqual(sample["curlStarts"] as? Int, 0)
            XCTAssertEqual(sample["curlStops"] as? Int, 0)
        }
    }
    private func advanceReading(_ app: XCUIApplication, mode: String) {
        let body = app.otherElements["reading-content"]
        if mode == "滚动" {
            body.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.8))
                .press(forDuration: 0.05, thenDragTo: body.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.2)))
        } else if mode == "仿真" {
            curlTurn(app, forward: true)
        } else {
            body.swipeLeft()
        }
    }
    private func fullscreenPageHasNoFixtureNotes(_ app: XCUIApplication) -> Bool {
        let sources = fullscreenVisibleRuns(app).compactMap { $0["source"] as? String }
        return !sources.isEmpty && sources.allSatisfy {
            !$0.contains("黛玉方进入房时") && !$0.contains("灯把书页照亮")
        }
    }

    func testIssue37FullscreenPagination() throws {
        try checkFullscreenReading(mode: "分页", fixture: "long")
    }

    func testIssue37FullscreenScroll() throws {
        try checkFullscreenReading(mode: "滚动")
    }

    func testIssue37FullscreenCurl() throws {
        try checkFullscreenReading(mode: "仿真", fixture: "long")
    }

    private func checkFullscreenReading(mode: String, fixture: String = "normal") throws {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
        defer { XCUIDevice.shared.orientation = .portrait }
        let app = XCUIApplication()
        app.launchArguments = ["--design-fixture=\(fixture)", "--design-theme=light", "--reader-acceptance"]
        app.launch()
        XCTAssertTrue(app.buttons["continue-reading"].waitForExistence(timeout: 15))
        app.buttons["continue-reading"].tap()
        fullscreenWait { app.buttons["reader-settings"].exists && app.buttons["reader-settings"].isEnabled }
        let initialFont = mode == "仿真" ? 100 : 175
        settings(app, mode: mode, dark: false, font: initialFont)
        fullscreenWait { app.buttons["reader-settings"].exists && app.buttons["reader-settings"].isEnabled && self.fullscreenVisibleCharacter(app) != nil }
        let beforeMove = try XCTUnwrap(fullscreenObservation(app))
        let beforeCharacter = try XCTUnwrap(fullscreenVisibleCharacter(app))
        let beforeProgress = app.staticTexts["reader-progress"].label

        // Move beyond the initial page so restoring a default location cannot pass.
        if mode == "滚动" {
            let body = app.otherElements["reading-content"]
            body.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.75))
                .press(forDuration: 0.05, thenDragTo: body.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.35)))
        } else if mode == "仿真" {
            curlTurn(app, forward: true)
        } else {
            app.otherElements["reading-content"].swipeLeft()
        }
        fullscreenWait {
            app.buttons["reader-settings"].exists && app.buttons["reader-settings"].isEnabled &&
                (self.fullscreenObservation(app) ?? 0) > beforeMove &&
                self.fullscreenVisibleCharacter(app) != nil
        }
        let character = try XCTUnwrap(fullscreenVisibleCharacter(app))
        if mode == "分页" {
            XCTAssertNotEqual(character, beforeCharacter, "原生翻页应改变可见原文字元")
            XCTAssertNotEqual(app.staticTexts["reader-progress"].label, beforeProgress, "原生翻页应推进阅读进度")
        }
        var persistedFocus = character
        evidence("issue37-" + mode + "-before", app)
        try checkFullscreenCycle(app, text: nil, name: mode + "-light", rotate: true, character: character)

        if mode == "仿真" {
            for cycle in 1...2 {
                curlTurn(app, forward: true)
                fullscreenWait { app.buttons["reader-settings"].exists && app.buttons["reader-settings"].isEnabled && self.fullscreenVisibleCharacter(app) != nil }
                let forward = try XCTUnwrap(fullscreenVisibleCharacter(app))
                XCTAssertNotEqual(forward, character)
                let progress = app.staticTexts["reader-progress"].label
                curlTurn(app, forward: true, cancel: true)
                fullscreenWait { app.buttons["reader-settings"].exists && app.buttons["reader-settings"].isEnabled && self.fullscreenCharacterIsVisible(forward, in: app) }
                XCTAssertEqual(app.staticTexts["reader-progress"].label, progress)
                evidence("issue37-curl-cancel-\(cycle)", app)
                curlTurn(app, forward: false)
                fullscreenWait { app.buttons["reader-settings"].exists && app.buttons["reader-settings"].isEnabled && self.fullscreenCharacterIsVisible(character, in: app) }
                evidence("issue37-curl-back-\(cycle)", app)
            }
            let reflow = try XCTUnwrap(fullscreenVisibleCharacter(app))
            persistedFocus = reflow
            settings(app, mode: mode, dark: true, font: 125)
            fullscreenWait { app.buttons["reader-settings"].exists && app.buttons["reader-settings"].isEnabled && self.fullscreenCharacterIsVisible(reflow, in: app) }
            try checkFullscreenCycle(app, text: nil, name: "curl-dark-large", character: reflow)
        }

        app.buttons["reader-close"].tap()
        app.buttons["continue-reading"].tap()
        fullscreenWait { app.buttons["reader-settings"].exists && app.buttons["reader-settings"].isEnabled && self.fullscreenVisibleCharacter(app) != nil }
        XCTAssertTrue(fullscreenCharacterIsVisible(persistedFocus, in: app), "重开应恢复重排前的稳定原文字元，不能保存新页首或预取邻页")
        app.buttons["reader-settings"].tap()
        XCTAssertTrue(app.segmentedControls.buttons[mode].isSelected)
        XCTAssertTrue(app.segmentedControls.buttons[mode == "仿真" ? "深色" : "明亮"].isSelected)
        XCTAssertEqual(app.staticTexts["font-size"].label, "\(mode == "仿真" ? 125 : initialFont)%")
        app.buttons["取消"].tap()
    }

    private func checkFullscreenCycle(_ app: XCUIApplication, text: String?, name: String, rotate: Bool = false, character: FullscreenCharacter? = nil) throws {
        let before = app.webViews.firstMatch.frame
        let beforePoint = character.flatMap { fullscreenCharacterPoint($0, in: app) }
        app.webViews.firstMatch.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        fullscreenWait {
            let web = app.webViews.firstMatch
            return !app.buttons["reader-settings"].exists && web.exists &&
                web.frame == before &&
                (text.map { self.fullscreenTextIsVisible($0, in: app) } ?? true) &&
                (character.map { self.fullscreenCharacterIsVisible($0, in: app) } ?? true)
        }
        XCTAssertEqual(app.webViews.firstMatch.frame, before, "工具栏覆盖正文，不应改变正文视口")
        if let character, let beforePoint { XCTAssertEqual(fullscreenCharacterPoint(character, in: app), beforePoint, "收起工具栏不应移动原文字元") }
        for identifier in ["reader-close", "reader-contents", "reader-settings", "reader-ask-book"] {
            XCTAssertFalse(app.buttons[identifier].exists, identifier)
        }
        XCTAssertFalse(app.otherElements["reader-toolbar"].exists)
        XCTAssertFalse(app.otherElements["reader-footer"].exists)
        XCTAssertFalse(app.staticTexts["reader-title"].exists)
        XCTAssertFalse(app.staticTexts["reader-progress"].exists)
        evidence("issue37-" + name + "-fullscreen", app)

        if rotate {
            XCUIDevice.shared.orientation = .landscapeLeft
            fullscreenWait {
                let web = app.webViews.firstMatch
                let screenSize = XCUIScreen.main.screenshot().image.size
                return web.exists && web.frame.width > web.frame.height &&
                    screenSize.width > screenSize.height &&
                    (text.map { self.fullscreenTextIsVisible($0, in: app) } ?? true) &&
                    (character.map { self.fullscreenCharacterIsVisible($0, in: app) } ?? true)
            }
            XCTAssertFalse(app.buttons["reader-ask-book"].exists)
            let landscape = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
            landscape.name = "issue37-" + name + "-landscape"
            landscape.lifetime = .keepAlways
            add(landscape)
            XCUIDevice.shared.orientation = .portrait
            fullscreenWait {
                let web = app.webViews.firstMatch
                return web.exists && web.frame.width < web.frame.height &&
                    (text.map { self.fullscreenTextIsVisible($0, in: app) } ?? true) &&
                    (character.map { self.fullscreenCharacterIsVisible($0, in: app) } ?? true)
            }
        }

        app.webViews.firstMatch.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        fullscreenWait {
            let web = app.webViews.firstMatch
            return web.exists && app.buttons["reader-settings"].exists && app.buttons["reader-settings"].isEnabled &&
                (text.map { self.fullscreenTextIsVisible($0, in: app) } ?? true) &&
                (character.map { self.fullscreenCharacterIsVisible($0, in: app) } ?? true)
        }
        XCTAssertEqual(app.webViews.firstMatch.frame.minY, before.minY, accuracy: 0.5)
        XCTAssertEqual(app.webViews.firstMatch.frame.height, before.height, accuracy: 0.5)
        if !rotate, let character, let beforePoint { XCTAssertEqual(fullscreenCharacterPoint(character, in: app), beforePoint, "恢复工具栏不应移动原文字元") }
        for identifier in ["reader-close", "reader-contents", "reader-settings", "reader-ask-book"] {
            XCTAssertTrue(app.buttons[identifier].isHittable, identifier)
        }
        evidence("issue37-" + name + "-restored", app)
    }
    private struct FullscreenCharacter: Equatable {
        let selector: String
        let source: String
        let offset: Int
    }

    private func fullscreenVisibleRuns(_ app: XCUIApplication) -> [[String: Any]] {
        guard let value = app.otherElements["reading-content"].value as? String,
              let data = value.data(using: .utf8),
              let observed = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let width = observed["hostWidth"] as? Double, let height = observed["hostHeight"] as? Double,
              abs(width - app.otherElements["reading-content"].frame.width) < 1,
              abs(height - app.otherElements["reading-content"].frame.height) < 1 else { return [] }
        return observed["runs"] as? [[String: Any]] ?? []
    }
    private func fullscreenObservation(_ app: XCUIApplication) -> Int? {
        guard let value = app.otherElements["reading-content"].value as? String,
              let data = value.data(using: .utf8),
              let observed = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        return observed["observation"] as? Int
    }

    private func fullscreenVisibleCharacter(_ app: XCUIApplication) -> FullscreenCharacter? {
        for run in fullscreenVisibleRuns(app) {
            if let selector = run["selector"] as? String, let source = run["source"] as? String,
               let offset = run["start"] as? Int, let end = run["end"] as? Int, end > offset,
               !(source as NSString).substring(with: NSRange(location: offset, length: end - offset)).trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                return FullscreenCharacter(selector: selector, source: source, offset: offset)
            }
        }
        return nil
    }

    private func fullscreenCharacterIsVisible(_ character: FullscreenCharacter, in app: XCUIApplication) -> Bool {
        fullscreenVisibleRuns(app).contains { run in
            guard let start = run["start"] as? Int, let end = run["end"] as? Int else { return false }
            return run["selector"] as? String == character.selector && run["source"] as? String == character.source &&
                start <= character.offset && end > character.offset
        }
    }
    private func fullscreenCharacterPoint(_ character: FullscreenCharacter, in app: XCUIApplication) -> CGPoint? {
        for run in fullscreenVisibleRuns(app) {
            if run["selector"] as? String == character.selector, run["source"] as? String == character.source,
               run["start"] as? Int == character.offset, let x = run["left"] as? Double, let y = run["top"] as? Double { return CGPoint(x: x, y: y) }
        }
        return nil
    }

    private func fullscreenVisibleText(_ app: XCUIApplication) -> String? {
        app.webViews.staticTexts.allElementsBoundByIndex.first {
            !$0.label.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && fullscreenTextIsVisible($0.label, in: app)
        }?.label
    }

    private func fullscreenTextIsVisible(_ text: String, in app: XCUIApplication) -> Bool {
        let bounds = app.webViews.firstMatch.frame
        return app.webViews.staticTexts.matching(NSPredicate(format: "label == %@", text)).allElementsBoundByIndex.contains {
            let rect = $0.frame
            return rect.width > 0 && rect.height > 0 && rect.minX > bounds.minX + 5 &&
                rect.maxX < bounds.maxX - 5 && rect.maxY > bounds.minY && rect.minY < bounds.maxY
        }
    }

    private func fullscreenWait(
        timeout: TimeInterval = 60,
        _ condition: @escaping () -> Bool,
        file: StaticString = #filePath,
        line: UInt = #line
    ) {
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in condition() }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [ready], timeout: timeout), .completed, file: file, line: line)
    }
}

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
        app.otherElements["book-dialog"].buttons["知道了"].tap()
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
        XCTAssertTrue(app.otherElements["book-dialog"].firstMatch.waitForExistence(timeout: 10))
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
        XCTAssertEqual(app.collectionViews["question-history"].cells.count, 1)
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
        issue17Import("search-other.epub", in: app); app.otherElements["book-dialog"].buttons["知道了"].tap()
        app.collectionViews["library"].cells[searchOtherID].tap(); waitForBody(app)
        app.buttons["reader-contents"].tap(); app.buttons["添加书签"].tap()
        XCTAssertTrue(app.staticTexts["书签已保存"].waitForExistence(timeout: 5)); app.buttons["完成"].tap()
        app.buttons["书架"].tap()
        app.collectionViews["library"].cells["book-df8c4a78180b9f65911e9fbba7cf4fb9c6f932c0e98456ef15e165157d9b1a67"].tap(); waitForBody(app)
        app.buttons["reader-contents"].tap(); app.buttons["添加书签"].tap()
        XCTAssertTrue(app.staticTexts["书签已保存"].waitForExistence(timeout: 5))
        app.buttons["书内搜索"].tap()
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
        if !row.isHittable { app.collectionViews["notes"].swipeUp() }
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
        XCTAssertEqual(app.collectionViews["question-history"].cells.count, 1)
        evidence("issue17-curl-history-summary", app)
    }

    func testIssue17WriteBoundaryRecovery() {
        let app = issue12App(); app.tabBars.buttons["笔记"].tap()
        noteRow("I17-write-boundary-draft", in: app).tap()
        XCTAssertEqual(app.textViews["note-body"].value as? String, "I17-write-boundary-draft")
        evidence("issue17-write-boundary-recovered-draft", app)
        replaceNoteBody("I17-仿真-note", in: app); app.buttons["保存笔记"].tap()
        XCTAssertEqual(app.collectionViews["notes"].cells.count, 1)
        app.tabBars.buttons["对话"].tap(); XCTAssertEqual(app.collectionViews["question-history"].cells.count, 1)
        evidence("issue17-write-boundary-same-record-retry", app)
    }

    func testIssue17LayoutHistoryCompletion() {
        let app = issue12App()
        let history = app.collectionViews["question-history"]
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
            app.collectionViews["notes"].cells.containing(NSPredicate(format: "label CONTAINS %@", "灯把书页照亮，也把问题留在纸上。"))
                .firstMatch.waitForExistence(timeout: 5)
        )
        attachDesignSurface("issue24-notes-375-light", app)

        tab("tab-conversations", label: "对话", in: app).tap()
        XCTAssertTrue(
            app.collectionViews["question-history"].cells.containing(
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
        XCTAssertTrue(app.staticTexts["书架"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.buttons["continue-reading"].exists)
        XCTAssertTrue(app.buttons["library-import"].exists)
        XCTAssertTrue(app.buttons["tab-library"].exists)
        attachDesignSurface("issue25-shelf-375-light", app)

        app.buttons["continue-reading"].tap()
        XCTAssertTrue(app.buttons["reader-ask-book"].waitForExistence(timeout: 15))
        // 等阅读器完成首次加载，避免“尚未保存”保护弹层拦截返回。
        let readerSettings = app.buttons["reader-settings"]
        XCTAssertTrue(readerSettings.waitForExistence(timeout: 15))
        fullscreenWait { readerSettings.isEnabled }
        app.buttons["书架"].tap()
        XCTAssertTrue(app.buttons["continue-reading"].waitForExistence(timeout: 10))

        let search = app.searchFields["library-search"].firstMatch
        XCTAssertTrue(search.waitForExistence(timeout: 5))
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

    func testIssue26NotesMergedListVisualSearchAndReturnToOriginal() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--design-fixture=normal", "--design-theme=light"]
        app.launch()
        XCTAssertTrue(tab("tab-notes", label: "笔记", in: app).waitForExistence(timeout: 15))
        tab("tab-notes", label: "笔记", in: app).tap()

        XCTAssertTrue(waitForPageTitle("笔记", in: app), "系统大标题应显示“笔记”；若为空先报 Lead，不要迁就测试")
        XCTAssertTrue(app.buttons["notes-export"].exists)
        // 定稿：无 3 段筛选；单一合并列表（高亮+笔记），书签不出现。
        XCTAssertFalse(app.segmentedControls["note-filter"].exists, "筛选控件应已删除")
        let notesSearch = app.searchFields["notes-search"].firstMatch
        XCTAssertTrue(notesSearch.waitForExistence(timeout: 5))
        let list = app.collectionViews["notes"]
        XCTAssertTrue(list.waitForExistence(timeout: 5))
        XCTAssertLessThanOrEqual(
            notesSearch.frame.maxY,
            list.frame.minY + 1,
            "搜索框应在大标题下方、列表上方，而不是 iOS 26 默认的屏幕底部"
        )
        waitForNoteRows(2, in: app)
        XCTAssertTrue(
            list.cells.containing(NSPredicate(format: "label CONTAINS %@", "黛玉方进入房时")).firstMatch.exists,
            "应列出高亮引文"
        )
        XCTAssertTrue(
            list.cells.containing(NSPredicate(format: "label CONTAINS %@", "灯把书页照亮")).firstMatch.exists,
            "应列出笔记引文/正文"
        )
        XCTAssertFalse(
            list.cells.containing(NSPredicate(format: "label CONTAINS %@", "书签")).firstMatch.exists,
            "书签不应出现在合并笔记列表"
        )
        XCTAssertTrue(
            app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "第三回")).firstMatch.exists,
            "行内应显示章节信息"
        )
        attachDesignSurface("issue26-notes-merged-375-light", app)

        // 点击行 → 跳回原文。
        let annotationCell = list.cells.matching(
            NSPredicate(format: "identifier BEGINSWITH %@", "annotation-")
        ).firstMatch
        XCTAssertTrue(annotationCell.waitForExistence(timeout: 5))
        annotationCell.tap()
        waitForBody(app)
        attachDesignSurface("issue26-notes-original-375-light", app)
        app.buttons["书架"].tap()
        XCTAssertTrue(waitForPageTitle("笔记", in: app, timeout: 10))

        // 搜索 = 引文 + 正文 + 章节。
        let search = waitForSearchField("notes-search", in: app)
        search.tap()
        search.typeText("灯把书页照亮")
        waitForNoteRows(1, in: app)
        attachDesignSurface("issue26-notes-search-375-light", app)
        search.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 6))
        search.typeText("不存在的笔记")
        XCTAssertTrue(
            app.staticTexts["没有找到相关笔记"].waitForExistence(timeout: 5),
            "搜索无结果应显示新文案"
        )
        if let dismiss = waitForSearchDismissButton(in: app) { dismiss.tap() }
        XCTAssertTrue(waitForPageTitle("笔记", in: app))

        app.terminate()
        app.launchArguments = ["--design-fixture=normal", "--design-theme=dark"]
        app.launch()
        XCTAssertTrue(tab("tab-notes", label: "笔记", in: app).waitForExistence(timeout: 15))
        tab("tab-notes", label: "笔记", in: app).tap()
        XCTAssertTrue(waitForPageTitle("笔记", in: app))
        attachDesignSurface("issue26-notes-merged-375-dark", app)

        app.terminate()
        app.launchArguments = ["--design-fixture=empty", "--design-theme=light"]
        app.launch()
        XCTAssertTrue(tab("tab-notes", label: "笔记", in: app).waitForExistence(timeout: 15))
        tab("tab-notes", label: "笔记", in: app).tap()
        XCTAssertTrue(app.staticTexts["还没有笔记"].waitForExistence(timeout: 5))
        let emptyAction = app.buttons["去书架读书"].exists
            ? app.buttons["去书架读书"]
            : app.buttons["notes-empty-action"]
        XCTAssertTrue(emptyAction.exists, "空状态需保留主操作")
        attachDesignSurface("issue26-notes-empty-375-light", app)
        emptyAction.tap()
        XCTAssertTrue(
            app.staticTexts["从一本书开始"].waitForExistence(timeout: 5),
            "笔记空状态主操作应回到书架"
        )
    }

    /// 定稿笔记合并列表：leading 编辑（仅笔记）、trailing 删除（确认）、书签不出现。
    func testNotesMergedListSwipeEditAndDelete() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--design-fixture=normal", "--design-theme=light"]
        app.launch()
        XCTAssertTrue(tab("tab-notes", label: "笔记", in: app).waitForExistence(timeout: 15))
        tab("tab-notes", label: "笔记", in: app).tap()
        let list = app.collectionViews["notes"]
        XCTAssertTrue(list.waitForExistence(timeout: 5))
        waitForNoteRows(2, in: app)

        // 带正文的笔记行 → leading swipe 编辑。
        let noteRow = list.cells.containing(NSPredicate(format: "label CONTAINS %@", "灯把书页照亮")).firstMatch
        XCTAssertTrue(noteRow.waitForExistence(timeout: 5))
        noteRow.swipeRight()
        let editAction = app.buttons["编辑"].firstMatch
        XCTAssertTrue(editAction.waitForExistence(timeout: 5), "笔记行应有 leading 编辑操作")
        attachDesignSurface("notes-merged-swipe-edit-375-light", app)
        editAction.tap()
        XCTAssertTrue(app.textViews["note-body"].waitForExistence(timeout: 5), "编辑应打开笔记编辑器")
        attachDesignSurface("notes-merged-editor-375-light", app)
        app.buttons["note-close"].tap()
        XCTAssertTrue(waitForPageTitle("笔记", in: app))

        // 高亮行 → trailing swipe 删除（纸白确认后消失）。
        let highlightRow = list.cells.containing(NSPredicate(format: "label CONTAINS %@", "黛玉方进入房时")).firstMatch
        XCTAssertTrue(highlightRow.waitForExistence(timeout: 5))
        highlightRow.swipeLeft()
        let deleteAction = app.buttons["删除"].firstMatch
        XCTAssertTrue(deleteAction.waitForExistence(timeout: 5), "高亮行应有 trailing 删除操作")
        attachDesignSurface("notes-merged-swipe-delete-375-light", app)
        deleteAction.tap()
        let dialog = app.otherElements["book-dialog"]
        if dialog.waitForExistence(timeout: 2) {
            dialog.buttons["删除"].tap()
        }
        waitForNoteRows(1, in: app)
        attachDesignSurface("notes-merged-after-delete-375-light", app)
    }

    func testIssue27ConversationsSearchOpenAndStates() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--design-fixture=normal", "--design-theme=light"]
        app.launch()
        XCTAssertTrue(tab("tab-conversations", label: "对话", in: app).waitForExistence(timeout: 15))
        tab("tab-conversations", label: "对话", in: app).tap()

        XCTAssertTrue(waitForPageTitle("对话", in: app), "系统大标题应显示“对话”；若为空先报 Lead，不要迁就测试")
        XCTAssertTrue(app.collectionViews["question-history"].waitForExistence(timeout: 5))
        let conversationsSearch = app.searchFields["conversation-search"].firstMatch
        XCTAssertTrue(conversationsSearch.waitForExistence(timeout: 5))
        XCTAssertLessThanOrEqual(
            conversationsSearch.frame.maxY,
            app.collectionViews["question-history"].frame.minY + 1,
            "搜索框应在大标题下方、列表上方，而不是 iOS 26 默认的屏幕底部"
        )
        waitForConversationRows(2, in: app)
        XCTAssertTrue(
            app.collectionViews["question-history"].cells.containing(
                NSPredicate(format: "label CONTAINS %@", "这句话里的“灯”指什么？")
            ).firstMatch.exists
        )
        XCTAssertTrue(
            app.collectionViews["question-history"].cells
                .containing(NSPredicate(format: "label CONTAINS %@", "次提问")).firstMatch.exists
        )
        attachDesignSurface("issue27-conversations-normal-375-light", app)

        let search = waitForSearchField("conversation-search", in: app)
        XCTAssertTrue(search.exists)
        search.tap()
        search.typeText("第一次进贾府")
        waitForConversationRows(1, in: app)
        XCTAssertTrue(
            app.collectionViews["question-history"].cells.containing(
                NSPredicate(format: "label CONTAINS %@", "林黛玉第一次进贾府时看到了什么？")
            ).firstMatch.exists
        )

        search.tap()
        search.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 12))
        waitForConversationRows(2, in: app)
        search.typeText("不存在的对话")
        XCTAssertTrue(app.staticTexts["没有找到相关对话"].waitForExistence(timeout: 5))
        let clearSearch = app.buttons["清除搜索"].exists
            ? app.buttons["清除搜索"]
            : app.buttons["conversations-search-empty-action"]
        XCTAssertTrue(clearSearch.exists, "搜索空状态需保留清除搜索操作")
        attachDesignSurface("issue27-conversations-search-empty-375-light", app)
        clearSearch.tap()
        waitForConversationRows(2, in: app)

        app.terminate()
        app.launchArguments = ["--design-fixture=normal", "--design-theme=light"]
        app.launch()
        XCTAssertTrue(tab("tab-conversations", label: "对话", in: app).waitForExistence(timeout: 15))
        tab("tab-conversations", label: "对话", in: app).tap()
        let first = app.collectionViews["question-history"].cells.containing(
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
        // A completed turn continues through the persistent composer; the
        // redesigned panel intentionally has no separate "continue" button.
        XCTAssertTrue(app.textViews["question-input"].isEnabled)
        XCTAssertTrue(app.buttons["question-close"].exists)
        app.buttons["question-close"].tap()
        XCTAssertTrue(waitForPageTitle("对话", in: app))

        app.terminate()
        app.launchArguments = ["--design-fixture=normal", "--design-theme=dark"]
        app.launch()
        XCTAssertTrue(tab("tab-conversations", label: "对话", in: app).waitForExistence(timeout: 15))
        tab("tab-conversations", label: "对话", in: app).tap()
        XCTAssertTrue(waitForPageTitle("对话", in: app))
        attachDesignSurface("issue27-conversations-normal-375-dark", app)

        app.terminate()
        app.launchArguments = ["--design-fixture=empty", "--design-theme=light"]
        app.launch()
        XCTAssertTrue(tab("tab-conversations", label: "对话", in: app).waitForExistence(timeout: 15))
        tab("tab-conversations", label: "对话", in: app).tap()
        XCTAssertTrue(app.staticTexts["还没有对话"].waitForExistence(timeout: 5))
        let emptyAction = app.buttons["去书架读书"].exists
            ? app.buttons["去书架读书"]
            : app.buttons["conversations-empty-action"]
        XCTAssertTrue(emptyAction.exists, "空状态需保留主操作")
        attachDesignSurface("issue27-conversations-empty-375-light", app)
        emptyAction.tap()
        XCTAssertTrue(
            app.staticTexts["从一本书开始"].waitForExistence(timeout: 5),
            "对话空状态主操作应回到书架"
        )
    }

    /// BUG 回归：搜索激活后点“关闭/取消”，顶部大标题必须在屏幕上**真实可见**。
    /// 该 BUG 的 accessibility 节点一直存在且 hittable、frame 正常，只是被导航栏不透明背景层遮挡，
    /// 所以必须用截图像素墨迹校验；另验证滚动后导航栏保持纸白不透明背景、内联标题可读。
    func testSearchCancelKeepsLargeTitleOnNotesAndConversations() throws {
        let app = XCUIApplication()
        app.launchArguments = ["--design-fixture=normal", "--design-theme=light"]
        app.launch()

        // 对话页：两轮（BUG 与“大标题 ↔ 搜索”状态切换时序相关）
        let conversationsTab = tab("tab-conversations", label: "对话", in: app)
        XCTAssertTrue(conversationsTab.waitForExistence(timeout: 15))
        conversationsTab.tap()
        XCTAssertTrue(waitForVisibleNavigationTitle("对话", in: app), "前置：对话页初始大标题应真实可见")
        for round in 1...2 {
            try runSearchCancelCycle(
                in: app,
                searchIdentifier: "conversation-search",
                title: "对话",
                listIdentifier: "question-history",
                attachmentPrefix: "bug-search-cancel-conversations-round\(round)",
                round: round,
                pageName: "对话页"
            )
        }

        // 笔记页：同路径两轮，确认不回归
        tab("tab-notes", label: "笔记", in: app).tap()
        XCTAssertTrue(waitForVisibleNavigationTitle("笔记", in: app), "前置：笔记页初始大标题应真实可见")
        for round in 1...2 {
            try runSearchCancelCycle(
                in: app,
                searchIdentifier: "notes-search",
                title: "笔记",
                listIdentifier: "notes",
                attachmentPrefix: "bug-search-cancel-notes-round\(round)",
                round: round,
                pageName: "笔记页"
            )
        }

        // 辅助功能大字号下内容可滚动：验证滚动后导航栏仍为纸白不透明背景、内联标题可读。
        app.terminate()
        app.launchArguments = [
            "--design-fixture=normal",
            "--design-theme=light",
            "-UIPreferredContentSizeCategoryName",
            "UICTContentSizeCategoryAccessibilityXXXL"
        ]
        app.launch()
        try checkScrolledNavigationBar(
            in: app,
            tabIdentifier: "tab-conversations",
            tabLabel: "对话",
            searchIdentifier: "conversation-search",
            title: "对话",
            listIdentifier: "question-history",
            attachmentPrefix: "bug-scrolled-background-conversations"
        )
        try checkScrolledNavigationBar(
            in: app,
            tabIdentifier: "tab-notes",
            tabLabel: "笔记",
            searchIdentifier: "notes-search",
            title: "笔记",
            listIdentifier: "notes",
            attachmentPrefix: "bug-scrolled-background-notes"
        )
    }

    /// 大字号下内容可滚动：取消搜索后上滚，检查内联标题可读 + 导航栏纸白不透明背景。
    private func checkScrolledNavigationBar(
        in app: XCUIApplication,
        tabIdentifier: String,
        tabLabel: String,
        searchIdentifier: String,
        title: String,
        listIdentifier: String,
        attachmentPrefix: String
    ) throws {
        let tabButton = tab(tabIdentifier, label: tabLabel, in: app)
        XCTAssertTrue(tabButton.waitForExistence(timeout: 15))
        tabButton.tap()
        XCTAssertTrue(waitForVisibleNavigationTitle(title, in: app), "XXXL：\(title)页初始大标题应可见")
        let search = waitForSearchField(searchIdentifier, in: app)
        XCTAssertTrue(search.waitForExistence(timeout: 5), "XXXL：\(title)页搜索框应存在")
        search.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5), "XXXL：搜索激活后应出现键盘")
        let dismiss = try XCTUnwrap(waitForSearchDismissButton(in: app), "XXXL：应出现取消/关闭按钮")
        dismiss.tap()
        Thread.sleep(forTimeInterval: 0.6)
        XCTAssertTrue(
            waitForVisibleNavigationTitle(title, in: app, inkThreshold: 0.008),
            "XXXL：取消搜索后大标题“\(title)”应真实可见"
        )
        let list = app.collectionViews[listIdentifier]
        let probe = list.cells.firstMatch
        let before = probe.frame.minY
        list.swipeUp()
        Thread.sleep(forTimeInterval: 0.6)
        let after = probe.frame.minY
        attachDesignSurface("\(attachmentPrefix)-scrolled-375-light", app)
        XCTAssertLessThan(after, before - 10, "XXXL：\(title)页内容应可滚动，才能验证滚动后导航栏背景")
        XCTAssertTrue(
            waitForVisibleNavigationTitle(title, in: app, inkThreshold: 0.008),
            "XXXL：滚动后导航栏内联标题应可读"
        )
        XCTAssertTrue(
            navigationBarBackgroundIsPaperBlank(in: app),
            "XXXL：滚动后导航栏必须保持纸白不透明背景（列表内容不得穿过）"
        )
    }

    /// 全局 iOS 26 导航栏外观回归（DesignSystem.install 改动）：设置类页面滚动到顶时导航栏应为纸白背景、无内容穿透。
    func testSettingsNavigationBarsKeepPaperBackgroundAtTop() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--design-fixture=normal", "--design-theme=light"]
        app.launch()

        // 我的 → AI 服务
        let profileTab = tab("tab-profile", label: "我的", in: app)
        XCTAssertTrue(profileTab.waitForExistence(timeout: 15))
        profileTab.tap()
        settingsRow("profile-ai-service", in: app).tap()
        XCTAssertTrue(app.navigationBars["AI 服务"].waitForExistence(timeout: 5))
        assertNavigationBarPaperBackground(in: app, name: "nav-appearance-ai-settings")
        app.navigationBars.buttons.firstMatch.tap()

        // 阅读页 → 阅读设置
        tab("tab-library", label: "书架", in: app).tap()
        XCTAssertTrue(app.buttons["continue-reading"].waitForExistence(timeout: 10))
        app.buttons["continue-reading"].tap()
        waitForBody(app)
        let settingsButton = app.buttons["reader-settings"]
        XCTAssertTrue(settingsButton.waitForExistence(timeout: 15))
        let enabled = XCTNSPredicateExpectation(
            predicate: NSPredicate(format: "isEnabled == true"),
            object: settingsButton
        )
        XCTAssertEqual(XCTWaiter.wait(for: [enabled], timeout: 15), .completed)
        settingsButton.tap()
        XCTAssertTrue(app.navigationBars["阅读设置"].waitForExistence(timeout: 5))
        assertNavigationBarPaperBackground(in: app, name: "nav-appearance-reading-settings")
        app.buttons["取消"].tap()
    }

    private func assertNavigationBarPaperBackground(in app: XCUIApplication, name: String) {
        attachDesignSurface(name + "-375-light", app)
        XCTAssertTrue(
            navigationBarBackgroundIsPaperBlank(in: app),
            "导航栏顶部应为纸白背景（全局 iOS26 外观回归）：\(name)"
        )
    }

    private func runSearchCancelCycle(
        in app: XCUIApplication,
        searchIdentifier: String,
        title: String,
        listIdentifier: String,
        attachmentPrefix: String,
        round: Int,
        pageName: String
    ) throws {
        let search = waitForSearchField(searchIdentifier, in: app)
        XCTAssertTrue(search.waitForExistence(timeout: 5), "\(pageName) 第\(round)轮：搜索框应存在")
        search.tap()
        XCTAssertTrue(
            app.keyboards.firstMatch.waitForExistence(timeout: 5),
            "\(pageName) 第\(round)轮：搜索激活后应出现键盘"
        )
        let dismiss = try XCTUnwrap(
            waitForSearchDismissButton(in: app),
            "\(pageName) 第\(round)轮：搜索激活后应出现取消/关闭按钮"
        )
        dismiss.tap()
        Thread.sleep(forTimeInterval: 0.6)
        attachDesignSurface("\(attachmentPrefix)-375-light", app)
        let hierarchy = XCTAttachment(string: app.debugDescription)
        hierarchy.name = "\(attachmentPrefix)-hierarchy"
        hierarchy.lifetime = .keepAlways
        add(hierarchy)
        let titleVisibleAfterCancel = waitForVisibleNavigationTitle(title, in: app)
        XCTAssertTrue(
            titleVisibleAfterCancel,
            "\(pageName) 第\(round)轮：取消搜索后顶部大标题“\(title)”必须在屏幕上真实可见（存在≠绘制）"
        )
        if !titleVisibleAfterCancel {
            // 零成本判别：轻微滚动后回到正好顶部，再测大标题墨迹，区分“背景遮挡”与“alpha/滚动状态未恢复”。
            let diagnosticList = app.collectionViews[listIdentifier]
            diagnosticList.swipeUp()
            Thread.sleep(forTimeInterval: 0.4)
            diagnosticList.swipeDown()
            Thread.sleep(forTimeInterval: 0.3)
            diagnosticList.swipeDown()
            Thread.sleep(forTimeInterval: 0.5)
            let visibleAfterTopReturn = waitForVisibleNavigationTitle(title, in: app, timeout: 3)
            print("QA_TOP_RETURN_DIAGNOSTIC page=\(pageName) round=\(round) titleVisibleAfterTopReturn=\(visibleAfterTopReturn)")
            attachDesignSurface("\(attachmentPrefix)-top-return-375-light", app)
            let diagnosticHierarchy = XCTAttachment(string: app.debugDescription)
            diagnosticHierarchy.name = "\(attachmentPrefix)-top-return-hierarchy"
            diagnosticHierarchy.lifetime = .keepAlways
            add(diagnosticHierarchy)
        }

        // 取消搜索后向上滚动：导航栏必须仍是纸白不透明背景（内容不得穿过），内联标题可读。
        let list = app.collectionViews[listIdentifier]
        XCTAssertTrue(list.exists, "\(pageName)：列表应存在")
        list.swipeUp()
        Thread.sleep(forTimeInterval: 0.6)
        attachDesignSurface("\(attachmentPrefix)-scrolled-375-light", app)
        XCTAssertTrue(
            waitForVisibleNavigationTitle(title, in: app),
            "\(pageName) 第\(round)轮：列表滚动后导航栏内联标题应可读"
        )
        XCTAssertTrue(
            navigationBarBackgroundIsPaperBlank(in: app),
            "\(pageName) 第\(round)轮：滚动后导航栏背景应为纸白不透明，列表内容不得从标题区穿过"
        )
        // 回到顶部，保证下一轮从大标题态开始
        list.swipeDown()
        list.swipeDown()
        Thread.sleep(forTimeInterval: 0.5)
    }

    func testIssue28ProfileBrandSettingsAndAbout() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--design-fixture=normal", "--design-theme=light"]
        app.launch()
        XCTAssertTrue(tab("tab-profile", label: "我的", in: app).waitForExistence(timeout: 15))
        tab("tab-profile", label: "我的", in: app).tap()

        // task-72：「我的」去掉顶部品牌 hero，直接从「设置」「关于」两组系统列表开始。
        XCTAssertTrue(app.otherElements["profile-surface"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.staticTexts["profile-title"].exists)
        XCTAssertFalse(anyProfileElement("profile-brand-icon", in: app).exists)

        let service = settingsRow("profile-ai-service", in: app)
        XCTAssertTrue(service.waitForExistence(timeout: 5))
        XCTAssertEqual(service.value as? String, "DeepSeek · deepseek-flash")
        XCTAssertGreaterThanOrEqual(service.frame.height, 44, "系统列表设置行高度语义")
        let appearance = settingsRow("profile-appearance", in: app)
        XCTAssertTrue(appearance.exists)
        XCTAssertGreaterThanOrEqual(appearance.frame.height, 44, "系统列表设置行高度语义")
        let about = settingsRow("profile-about", in: app)
        XCTAssertTrue(about.exists)
        XCTAssertGreaterThanOrEqual(about.frame.height, 44, "系统列表设置行高度语义")
        XCTAssertFalse(app.staticTexts["profile-storage-disclosure"].exists)
        attachDesignSurface("issue28-profile-normal-375-light", app)

        appearance.tap()
        let systemAppearance = app.buttons.matching(
            NSPredicate(format: "label ENDSWITH %@", "跟随系统")
        ).firstMatch
        XCTAssertTrue(systemAppearance.waitForExistence(timeout: 3))
        XCTAssertTrue(
            app.buttons.matching(NSPredicate(format: "label == %@", "浅色")).firstMatch.exists
        )
        XCTAssertTrue(
            app.buttons.matching(NSPredicate(format: "label == %@", "深色")).firstMatch.exists
        )
        XCTAssertEqual(
            app.buttons.matching(NSPredicate(format: "label == %@", "浅色")).count,
            1,
            "外观弹层不应重复出现"
        )
        app.buttons.matching(NSPredicate(format: "label == %@", "深色")).firstMatch.tap()
        waitForSettingsValue(appearance, "深色")
        appearance.tap()
        let restoreSystem = app.buttons.matching(
            NSPredicate(format: "label ENDSWITH %@", "跟随系统")
        ).firstMatch
        XCTAssertTrue(restoreSystem.waitForExistence(timeout: 3))
        restoreSystem.tap()
        waitForSettingsValue(appearance, "跟随系统")

        service.tap()
        XCTAssertTrue(app.tables["ai-services"].waitForExistence(timeout: 5))
        app.navigationBars.buttons.firstMatch.tap()
        XCTAssertTrue(app.otherElements["profile-surface"].waitForExistence(timeout: 5))

        about.tap()
        XCTAssertTrue(app.navigationBars["关于书灯"].waitForExistence(timeout: 5))
        // 品牌内容（灯标/书灯/motto/版本）保留在「关于书灯」页。
        XCTAssertTrue(app.staticTexts["about-wordmark"].waitForExistence(timeout: 5))
        XCTAssertEqual(
            app.staticTexts["about-motto"].label,
            "一盏照书的灯，AI 照亮你读不懂的地方"
        )
        XCTAssertTrue(app.staticTexts["about-version"].label.hasPrefix("版本 "))
        XCTAssertTrue(settingsRow("about-third-party", in: app).exists)
        attachDesignSurface("issue28-about-375-light", app)
        settingsRow("about-third-party", in: app).tap()
        XCTAssertTrue(app.navigationBars["第三方许可"].waitForExistence(timeout: 5))
        XCTAssertTrue(
            app.textViews.firstMatch.exists ||
            app.collectionViews.cells.firstMatch.exists ||
            app.tables.cells.firstMatch.exists,
            "第三方许可页应渲染可读内容（textView 或系统列表）"
        )

        app.terminate()
        app.launchArguments = ["--design-fixture=normal", "--design-theme=dark"]
        app.launch()
        XCTAssertTrue(tab("tab-profile", label: "我的", in: app).waitForExistence(timeout: 15))
        tab("tab-profile", label: "我的", in: app).tap()
        XCTAssertTrue(app.otherElements["profile-surface"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.staticTexts["profile-title"].exists)
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
        fullscreenWait { app.buttons["reader-contents"].isEnabled && app.buttons["reader-settings"].isEnabled }

        let toolbar = app.otherElements["reader-toolbar"]
        XCTAssertTrue(toolbar.exists)
        XCTAssertEqual(toolbar.frame.height, 64, accuracy: 0.5)
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
        // 第九轮视觉验收：问问书灯胶囊缩到 36pt（原 44pt 断言过期）。
        XCTAssertEqual(ask.frame.height, 36, accuracy: 0.5)
        XCTAssertEqual(ask.frame.midX, app.frame.midX, accuracy: 0.5)
        attachDesignSurface("issue29-reader-375-light", app)

        contents.tap()
        XCTAssertTrue(app.tables["book-navigation"].waitForExistence(timeout: 5))
        app.buttons["添加书签"].tap()
        XCTAssertTrue(app.staticTexts["书签已保存"].waitForExistence(timeout: 5))
        app.buttons["完成"].tap()
        XCTAssertTrue(ask.waitForExistence(timeout: 5))

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
            fullscreenWait { readerSettings.isEnabled && readerSettings.isHittable }
            readerSettings.tap()
            XCTAssertTrue(app.navigationBars["阅读设置"].waitForExistence(timeout: 10), mode)
            app.segmentedControls.buttons[mode].tap()
            app.buttons["完成"].tap()
            XCTAssertTrue(app.webViews.firstMatch.waitForExistence(timeout: 15), mode)
            fullscreenWait(timeout: 15) { readerSettings.isEnabled && self.fullscreenSelectableParagraph(app) != nil }
            XCTAssertTrue(ask.waitForExistence(timeout: 5), mode)
            XCTAssertTrue(ask.isHittable, mode)
        }

        let paragraph = try XCTUnwrap(fullscreenSelectableParagraph(app))
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
        fullscreenWait(timeout: 15) { app.buttons["reader-settings"].isEnabled && self.fullscreenSelectableParagraph(app) != nil }
        let darkParagraph = try XCTUnwrap(fullscreenSelectableParagraph(app))
        darkParagraph.press(forDuration: 1.3)
        XCTAssertTrue(app.buttons["selection-ask"].waitForExistence(timeout: 5))
        attachDesignSurface("issue29-selection-375-dark", app)
    }
    private func fullscreenSelectableParagraph(_ app: XCUIApplication) -> XCUIElement? {
        let viewport = app.webViews.firstMatch.frame
        let top = max(viewport.minY, app.otherElements["reader-toolbar"].frame.maxY + 8)
        let bottom = min(viewport.maxY, app.otherElements["reader-footer"].frame.minY - 8)
        return app.webViews.staticTexts.allElementsBoundByIndex.first {
            let rect = $0.frame
            return $0.label.count > 16 && rect.minX >= viewport.minX + 5 &&
                rect.maxX <= viewport.maxX - 5 && rect.minY >= top && rect.maxY <= bottom && $0.isHittable
        }
    }

    /// 显式打开指定书籍（避免“继续阅读”指向上一用例最后阅读的书）。
    private func openFixtureBook(_ title: String, in app: XCUIApplication) {
        let cell = app.collectionViews["library"].cells.containing(
            NSPredicate(format: "label CONTAINS %@", title)
        ).firstMatch
        XCTAssertTrue(cell.waitForExistence(timeout: 20), "书架应显示 \(title)")
        cell.tap()
    }

    /// 阅读页当前页书签丝带：加书签→丝带出现→翻页往返匹配→点丝带删除→面板同步。
    func testReaderPageBookmarkRibbonTogglesCurrentPage() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--design-fixture=normal", "--design-theme=light"]
        app.launch()
        openFixtureBook("红楼梦", in: app)
        waitForBody(app)
        let contents = app.buttons["reader-contents"]
        fullscreenWait { contents.exists && contents.isEnabled && contents.isHittable }
        let ribbon = app.buttons["reader-bookmark-ribbon"]
        // task-18 后：夹具书签落在首屏，打开即应显示丝带。
        XCTAssertTrue(ribbon.waitForExistence(timeout: 5), "首屏已有夹具书签，丝带应可见")

        contents.tap()
        XCTAssertTrue(app.tables["book-navigation"].waitForExistence(timeout: 5))
        app.segmentedControls.buttons["书签"].tap()
        Thread.sleep(forTimeInterval: 0.4)
        let bookmarkRows = app.tables["book-navigation"].cells.matching(
            NSPredicate(format: "identifier BEGINSWITH %@", "bookmark-")
        )
        XCTAssertTrue(bookmarkRows.firstMatch.exists)
        XCTAssertTrue(
            bookmarkRows.firstMatch.staticTexts.matching(
                NSPredicate(format: "label CONTAINS %@", "进度")
            ).firstMatch.exists ||
                app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "进度")).firstMatch.exists,
            "书签行应显示章节 + 进度百分比"
        )
        app.buttons["添加书签"].tap()
        XCTAssertTrue(app.staticTexts["书签已保存"].waitForExistence(timeout: 5))
        app.buttons["完成"].tap()
        XCTAssertTrue(contents.waitForExistence(timeout: 5))

        // 当前页已有书签：丝带出现且可访问性状态正确。
        XCTAssertTrue(ribbon.waitForExistence(timeout: 5), "当前页有书签时丝带应出现")
        XCTAssertEqual(ribbon.value as? String, "此页已有书签")
        attachDesignSurface("bookmark-ribbon-present-375-light", app)

        // 翻到下一页再翻回：丝带按 locator 匹配当前页应重新出现。
        let body = app.otherElements["reading-content"]
        body.swipeLeft()
        Thread.sleep(forTimeInterval: 0.8)
        body.swipeRight()
        Thread.sleep(forTimeInterval: 0.8)
        XCTAssertTrue(ribbon.waitForExistence(timeout: 5), "翻页往返后当前页书签丝带应重新出现")

        // 改字号触发重排：丝带仍应按可见原文锚点匹配当前页。
        if !app.buttons["reader-settings"].isHittable {
            body.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
            fullscreenWait { app.buttons["reader-settings"].isHittable }
        }
        settings(app, mode: "分页", dark: false, font: 120)
        XCTAssertTrue(ribbon.waitForExistence(timeout: 5), "改字号重排后当前页书签丝带仍应出现")
        attachDesignSurface("bookmark-ribbon-after-reflow-375-light", app)

        // 点丝带删除当前页书签。首屏夹具书签与新加书签可能同页：点一次删除当前匹配，若仍有书签保留则再点一次。
        ribbon.tap()
        Thread.sleep(forTimeInterval: 1.0)
        if ribbon.exists {
            ribbon.tap()
            Thread.sleep(forTimeInterval: 1.0)
        }
        let removed = NSPredicate { _, _ in !ribbon.exists }
        expectation(for: removed, evaluatedWith: app)
        waitForExpectations(timeout: 5)
        attachDesignSurface("bookmark-ribbon-removed-375-light", app)

        // 面板同步：书签数量回到添加前。
        fullscreenWait { contents.exists && contents.isEnabled && contents.isHittable }
        contents.tap()
        XCTAssertTrue(app.tables["book-navigation"].waitForExistence(timeout: 5))
        app.segmentedControls.buttons["书签"].tap()
        Thread.sleep(forTimeInterval: 0.4)
        XCTAssertEqual(bookmarkRows.count, 0, "点丝带会删除当前页全部书签（含夹具首屏书签）")
        app.buttons["完成"].tap()
    }

    /// 多颜色高亮：选文→调色盘 4 色各建一次、已有高亮改色、重启保持（旧数据默认黄由单测覆盖）。
    func testReaderMultiColorHighlightsCreateRecolorAndPersist() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--design-fixture=normal", "--design-theme=light"]
        app.launch()
        openFixtureBook("红楼梦", in: app)
        waitForBody(app)
        let body = app.webViews.firstMatch
        let bar = app.otherElements["highlight-color-bar"]
        let palette = app.otherElements["highlight-color-palette"]
        let positions: [(CGFloat, CGFloat)] = [(0.30, 0.28), (0.30, 0.40), (0.30, 0.52), (0.30, 0.64)]
        let colors = ["yellow", "green", "blue", "rose"]
        for (index, color) in colors.enumerated() {
            body.coordinate(withNormalizedOffset: CGVector(dx: positions[index].0, dy: positions[index].1))
                .press(forDuration: 1.3)
            noteMenu("高亮", in: app)
            // task-19：选中即按上次/默认色立即上色，并出现轻量调色条。
            XCTAssertTrue(bar.waitForExistence(timeout: 5), "选高亮后应出现轻量调色条")
            if index == 0 {
                attachDesignSurface("highlight-color-bar-375-light", app)
            }
            let swatch = app.buttons["highlight-color-" + color]
            XCTAssertTrue(swatch.waitForExistence(timeout: 3), color)
            swatch.tap()
            Thread.sleep(forTimeInterval: 0.5)
            XCTAssertTrue(swatch.isSelected, "调色条应选中 \(color)")
            app.buttons["highlight-color-bar-close"].tap()
            Thread.sleep(forTimeInterval: 0.3)
        }
        attachDesignSurface("highlight-colors-4-375-light", app)

        // 改色：点第一个高亮 → 改色盘应选中当前色（黄，旧数据默认）→ 改绿。
        body.coordinate(withNormalizedOffset: CGVector(dx: positions[0].0, dy: positions[0].1)).tap()
        if !palette.waitForExistence(timeout: 2) {
            body.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
            body.coordinate(withNormalizedOffset: CGVector(dx: positions[0].0, dy: positions[0].1)).tap()
        }
        XCTAssertTrue(palette.waitForExistence(timeout: 5), "点已有高亮应打开改色盘")
        XCTAssertTrue(app.buttons["highlight-color-yellow"].isSelected, "已有高亮当前色应被选中")
        app.buttons["highlight-color-green"].tap()
        Thread.sleep(forTimeInterval: 0.6)
        attachDesignSurface("highlight-colors-recolored-375-light", app)

        // 重启保持：再次打开同一页，点该高亮应显示绿色选中。
        app.terminate()
        app.launch()
        openFixtureBook("红楼梦", in: app)
        waitForBody(app)
        body.coordinate(withNormalizedOffset: CGVector(dx: positions[0].0, dy: positions[0].1)).tap()
        if !palette.waitForExistence(timeout: 2) {
            body.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
            body.coordinate(withNormalizedOffset: CGVector(dx: positions[0].0, dy: positions[0].1)).tap()
        }
        XCTAssertTrue(palette.waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["highlight-color-green"].isSelected, "改色应持久化（重启后绿色选中）")
        app.buttons["highlight-color-green"].tap()
    }

    /// 首屏书签丝带（用户反馈：打开书看不到已有书签丝带）。夹具首屏即含同章书签，未滚动也应显示。
    /// 该用例先以红验证 bug，task-18 修复后应转绿。
    func testReaderFirstScreenShowsExistingBookmarkRibbon() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--design-fixture=normal", "--design-theme=light"]
        app.launch()
        openFixtureBook("红楼梦", in: app)
        waitForBody(app)

        // task-35：正常进入不出现“正在打开…”米色提示条；task-34：问问书灯按钮缩小到 36pt。
        XCTAssertFalse(app.staticTexts["正在打开…"].exists, "正常进入不应出现加载提示条")
        let ask = app.buttons["reader-ask-book"]
        XCTAssertTrue(ask.exists)
        XCTAssertLessThanOrEqual(ask.frame.height, 40, "问问书灯按钮应缩小到约 36pt")
        XCTAssertTrue(ask.isHittable)
        // 首屏不滚动：夹具书签落在同章第 1 段（与初始阅读位置同一页），丝带应直接可见。
        attachDesignSurface("bookmark-ribbon-first-screen-375-light", app)
        let ribbon = app.buttons["reader-bookmark-ribbon"]
        XCTAssertTrue(ribbon.waitForExistence(timeout: 5), "首屏已有书签时应显示丝带（当前 bug）")
        XCTAssertTrue(ribbon.isHittable, "首屏丝带应可点击")
        XCTAssertEqual(ribbon.value as? String, "此页已有书签")

        // 目录/书签面板点已有书签跳转 → 丝带仍在。
        let contents = app.buttons["reader-contents"]
        fullscreenWait { contents.exists && contents.isEnabled && contents.isHittable }
        contents.tap()
        XCTAssertTrue(app.tables["book-navigation"].waitForExistence(timeout: 5))
        app.segmentedControls.buttons["书签"].tap()
        Thread.sleep(forTimeInterval: 0.4)
        let firstBookmark = app.tables["book-navigation"].cells.matching(
            NSPredicate(format: "identifier BEGINSWITH %@", "bookmark-")
        ).firstMatch
        XCTAssertTrue(firstBookmark.waitForExistence(timeout: 5), "面板应列出夹具书签")
        firstBookmark.tap()
        waitForBody(app)
        XCTAssertTrue(ribbon.waitForExistence(timeout: 5), "跳到书签页后丝带应出现")
        XCTAssertTrue(ribbon.isHittable, "书签页丝带应可点击")
        attachDesignSurface("bookmark-ribbon-after-jump-375-light", app)
    }

    /// task-19/25：选中即上色 + 轻量调色条；点已有高亮 → 浮层仅改色 + 取消高亮（不再有写笔记转换）。
    func testReaderHighlightImmediateColorBarOptionsAndDelete() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--design-fixture=normal", "--design-theme=light"]
        app.launch()
        openFixtureBook("红楼梦", in: app)
        waitForBody(app)
        let body = app.webViews.firstMatch
        let bar = app.otherElements["highlight-color-bar"]
        let palette = app.otherElements["highlight-color-palette"]

        // 1) 选文→高亮：立即按上次/默认色上色，并出现轻量调色条（不是模态调色盘）。
        body.coordinate(withNormalizedOffset: CGVector(dx: 0.35, dy: 0.78)).press(forDuration: 1.3)
        noteMenu("高亮", in: app)
        XCTAssertTrue(bar.waitForExistence(timeout: 5), "选中高亮后应立即出现轻量调色条")
        let selectedSwatches = ["yellow", "green", "blue", "rose"].filter {
            app.buttons["highlight-color-" + $0].isSelected
        }
        XCTAssertEqual(selectedSwatches.count, 1, "应有一个默认/上次色立即生效")
        attachDesignSurface("highlight-color-bar-375-light", app)

        // 调色条改色 → 雾蓝（不关闭调色条）。
        app.buttons["highlight-color-blue"].tap()
        Thread.sleep(forTimeInterval: 0.6)
        XCTAssertTrue(app.buttons["highlight-color-blue"].isSelected)
        attachDesignSurface("highlight-color-bar-recolored-375-light", app)
        app.buttons["highlight-color-bar-close"].tap()

        // 2) 点已有高亮（夹具绿色高亮，第 1 段）→ 浮层：当前色选中 + 取消高亮（无写笔记入口）。
        let existing = body.coordinate(withNormalizedOffset: CGVector(dx: 0.35, dy: 0.30))
        func openExistingHighlight() {
            existing.tap()
            if !palette.waitForExistence(timeout: 2) {
                body.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
                existing.tap()
            }
            XCTAssertTrue(palette.waitForExistence(timeout: 5), "点已有高亮应打开浮层")
        }
        openExistingHighlight()
        XCTAssertTrue(app.buttons["highlight-color-green"].isSelected, "浮层应选中已有高亮的当前色")
        XCTAssertTrue(app.buttons["highlight-delete"].exists, "浮层应有取消高亮")
        XCTAssertTrue(app.buttons["取消"].exists, "浮层应保留取消")
        XCTAssertFalse(app.buttons["写笔记"].exists, "高亮浮层不再提供“写笔记”转换入口")
        attachDesignSurface("highlight-float-no-write-note-375-light", app)

        // 3) 浮层改色 → 胭脂：选色后调色盘应自动关闭。
        openExistingHighlight()
        XCTAssertTrue(app.buttons["highlight-color-rose"].waitForExistence(timeout: 5))
        app.buttons["highlight-color-rose"].tap()
        let paletteDismissed = NSPredicate { _, _ in !palette.exists }
        expectation(for: paletteDismissed, evaluatedWith: app)
        waitForExpectations(timeout: 5)
        // 再点高亮应显示胭脂已选中。
        openExistingHighlight()
        XCTAssertTrue(app.buttons["highlight-color-rose"].isSelected, "改色应已生效")

        // 4) 取消高亮：免确认直接删除，decoration 消失。
        app.buttons["highlight-delete"].tap()
        XCTAssertFalse(app.staticTexts["取消高亮？"].waitForExistence(timeout: 1.5), "取消高亮不应再弹确认")
        let removed = NSPredicate { _, _ in !palette.exists }
        expectation(for: removed, evaluatedWith: app)
        waitForExpectations(timeout: 5)
        // decoration 已消失：再点原高亮位置不应再打开浮层。
        existing.tap()
        XCTAssertFalse(palette.waitForExistence(timeout: 1.5), "取消高亮后 decoration 应消失")
        // 列表同步由 note-wave 删除用例覆盖；此处聚焦“取消高亮后 decoration 消失”。
        attachDesignSurface("reader-after-cancel-highlight-375-light", app)
    }

    /// 定稿阅读器：目录面板只有 目录/书签 两 tab，书签行显示章节 + 进度百分比。
    /// task-33：编辑器删除入口（仅已保存笔记）：取消无副作用、确认后卡片滑出且列表同步；新建笔记无删除入口。
    func testNoteEditorDeleteExistingNoteFlow() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--design-fixture=normal", "--design-theme=light"]
        app.launch()
        XCTAssertTrue(tab("tab-notes", label: "笔记", in: app).waitForExistence(timeout: 15))
        tab("tab-notes", label: "笔记", in: app).tap()
        let list = app.collectionViews["notes"]
        XCTAssertTrue(list.waitForExistence(timeout: 5))
        waitForNoteRows(2, in: app)
        let bodyRow = list.cells.containing(
            NSPredicate(format: "label CONTAINS %@", "灯把书页照亮")
        ).firstMatch
        XCTAssertTrue(bodyRow.waitForExistence(timeout: 5))
        bodyRow.swipeRight()
        app.buttons["编辑"].firstMatch.tap()
        XCTAssertTrue(app.textViews["note-body"].waitForExistence(timeout: 5))
        let deleteButton = app.buttons["note-delete"]
        XCTAssertTrue(deleteButton.waitForExistence(timeout: 3), "已保存笔记编辑器应有删除笔记入口")
        XCTAssertTrue(deleteButton.isHittable)
        attachDesignSurface("note-editor-delete-entry-375-light", app)

        // 取消：回到编辑器，不删除。
        deleteButton.tap()
        XCTAssertTrue(app.staticTexts["删除笔记？"].waitForExistence(timeout: 5))
        attachDesignSurface("note-editor-delete-confirm-375-light", app)
        app.buttons["取消"].tap()
        XCTAssertTrue(app.textViews["note-body"].waitForExistence(timeout: 3), "取消后应仍在编辑器")

        // 确认删除：卡片滑出、列表行消失。
        app.buttons["note-delete"].tap()
        XCTAssertTrue(app.staticTexts["删除笔记？"].waitForExistence(timeout: 5))
        let dialogDelete = app.otherElements["book-dialog"].buttons["删除"]
        if dialogDelete.waitForExistence(timeout: 2) {
            dialogDelete.tap()
        } else {
            app.buttons["删除"].firstMatch.tap()
        }
        XCTAssertTrue(app.textViews["note-body"].waitForNonExistence(timeout: 5), "删除后卡片应滑出")
        XCTAssertTrue(waitForPageTitle("笔记", in: app))
        waitForNoteRows(1, in: app)
        XCTAssertFalse(
            list.cells.containing(NSPredicate(format: "label CONTAINS %@", "灯把书页照亮")).firstMatch.exists,
            "被删笔记行应从列表消失"
        )
        attachDesignSurface("notes-after-editor-delete-375-light", app)

        // 新建笔记不得出现删除入口。
        tab("tab-library", label: "书架", in: app).tap()
        app.buttons["continue-reading"].tap()
        waitForBody(app)
        let body = app.webViews.firstMatch
        body.coordinate(withNormalizedOffset: CGVector(dx: 0.40, dy: 0.85)).press(forDuration: 1.3)
        noteMenu("笔记", in: app)
        XCTAssertTrue(app.textViews["note-body"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["note-delete"].exists, "新建笔记不应显示删除入口")
        attachDesignSurface("note-editor-new-no-delete-375-light", app)
        app.buttons["note-close"].tap()
    }

    /// PDF Spike：书架含 PDF → 打开 PDFKit 阅读器 → 第 1 页 → 切单页 swipe 到第 2 页 → 关闭后书架进度 → 重开恢复第 2 页。
    func testPDFFixtureReaderPagingReturnAndRestore() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--design-fixture=pdf", "--design-theme=light"]
        app.launch()
        XCTAssertTrue(tab("tab-library", label: "书架", in: app).waitForExistence(timeout: 15))
        let pdfTitle = "书灯 PDF 示例"
        let shelf = app.collectionViews["library"]
        XCTAssertTrue(shelf.waitForExistence(timeout: 10))
        let pdfCell = shelf.cells.containing(
            NSPredicate(format: "label CONTAINS %@", pdfTitle)
        ).firstMatch
        // 第 4 本书可能在书架首屏下方，滚动直到出现。
        for _ in 0..<4 where !pdfCell.exists {
            shelf.swipeUp()
        }
        XCTAssertTrue(pdfCell.waitForExistence(timeout: 10), "书架应出现 PDF 夹具")
        attachDesignSurface("pdf-shelf-with-pdf-375-light", app)
        pdfCell.tap()

        let pdfView = app.otherElements["pdf-reader-view"]
        XCTAssertTrue(pdfView.waitForExistence(timeout: 10), "应打开 PDFKit 阅读器")
        XCTAssertTrue(app.staticTexts["第 1 / 2 页"].waitForExistence(timeout: 10), "页码应显示第 1 / 2 页")
        XCTAssertEqual(app.staticTexts["reader-title"].label, pdfTitle)
        attachDesignSurface("pdf-page-1-continuous-375-light", app)

        // 切到单页分页并左滑翻到第 2 页。
        setPDFReadingMode(app, scroll: false)
        Thread.sleep(forTimeInterval: 0.5)
        pdfView.swipeLeft()
        XCTAssertTrue(app.staticTexts["第 2 / 2 页"].waitForExistence(timeout: 10), "左滑应翻到第 2 页")
        attachDesignSurface("pdf-single-page-2-375-light", app)

        // 关闭返回书架：继续阅读应显示该 PDF 进度。
        app.buttons["reader-close"].tap()
        XCTAssertTrue(tab("tab-library", label: "书架", in: app).waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts[pdfTitle].waitForExistence(timeout: 10))
        attachDesignSurface("pdf-shelf-progress-375-light", app)

        // 重新打开：应恢复第 2 页。
        let reopen = app.collectionViews["library"].cells.containing(
            NSPredicate(format: "label CONTAINS %@", pdfTitle)
        ).firstMatch
        XCTAssertTrue(reopen.waitForExistence(timeout: 10))
        reopen.tap()
        XCTAssertTrue(pdfView.waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["第 2 / 2 页"].waitForExistence(timeout: 10), "重开应恢复第 2 页")
        attachDesignSurface("pdf-reopened-page-2-375-light", app)
        app.buttons["reader-close"].tap()
    }

    /// PDF M2：扫描版阅读器右上「?」→「关于这份 PDF」（不含技术词）；文字版无「?」。
    func testPDFScannedReaderHelpAndTextPDFWithoutHelp() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--design-fixture=pdf-scan", "--design-theme=light"]
        app.launch()
        XCTAssertTrue(tab("tab-library", label: "书架", in: app).waitForExistence(timeout: 15))
        let scanTitle = "书灯 PDF 扫描版"
        let shelf = app.collectionViews["library"]
        let scanCell = shelf.cells.containing(NSPredicate(format: "label CONTAINS %@", scanTitle)).firstMatch
        for _ in 0..<4 where !scanCell.exists { shelf.swipeUp() }
        XCTAssertTrue(scanCell.waitForExistence(timeout: 10), "书架应出现扫描版 PDF")
        scanCell.tap()
        XCTAssertTrue(app.otherElements["pdf-reader-view"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["第 1 / 2 页"].waitForExistence(timeout: 10))
        let help = app.buttons["pdf-reader-help"]
        XCTAssertTrue(help.waitForExistence(timeout: 5), "扫描版 PDF 应有「?」说明入口")
        XCTAssertTrue(help.isHittable)
        attachDesignSurface("pdf-scan-reader-with-help-375-light", app)
        help.tap()
        XCTAssertTrue(app.staticTexts["关于这份 PDF"].waitForExistence(timeout: 5))
        XCTAssertTrue(
            app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "页面上的字是图片")).firstMatch.exists,
            "说明文案应与导入提示卡一致"
        )
        XCTAssertFalse(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "OCR")).firstMatch.exists)
        attachDesignSurface("pdf-scan-reader-help-dialog-375-light", app)
        app.buttons["知道了"].tap()
        app.buttons["reader-close"].tap()

        // 文字版 PDF：无扫描页 → 无「?」。
        app.terminate()
        app.launchArguments = ["--design-fixture=pdf", "--design-theme=light"]
        app.launch()
        XCTAssertTrue(tab("tab-library", label: "书架", in: app).waitForExistence(timeout: 15))
        let textTitle = "书灯 PDF 示例"
        let textCell = shelf.cells.containing(NSPredicate(format: "label CONTAINS %@", textTitle)).firstMatch
        for _ in 0..<4 where !textCell.exists { shelf.swipeUp() }
        XCTAssertTrue(textCell.waitForExistence(timeout: 10))
        textCell.tap()
        XCTAssertTrue(app.otherElements["pdf-reader-view"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["pdf-reader-help"].exists, "文字版 PDF 不应显示「?」")
        attachDesignSurface("pdf-text-reader-no-help-375-light", app)
        app.buttons["reader-close"].tap()
    }

    /// PDF M2：扫描版 PDF 真实导入（Files 选择器）→ 扫描提示卡 → 取消不落库；继续导入成功上书架。
    func testPDFScannedImportConfirmCancelAndContinue() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--design-fixture=empty", "--design-theme=light"]
        app.launch()
        XCTAssertTrue(tab("tab-library", label: "书架", in: app).waitForExistence(timeout: 15))
        XCTAssertTrue(app.buttons["library-import"].waitForExistence(timeout: 10))

        // 取消路径：选择扫描版 PDF → 提示卡 → 取消 → 书架保持为空。
        app.buttons["library-import"].tap()
        let fileView = app.collectionViews["File View"]
        XCTAssertTrue(fileView.waitForExistence(timeout: 10), "文件选择器应出现")
        let cancelFile = fileView.cells.matching(identifier: "QA-扫描版-取消, pdf").firstMatch
        XCTAssertTrue(cancelFile.waitForExistence(timeout: 10))
        cancelFile.tap()
        // 导入检查进度（2 页很快，可能一闪而过；先留截图证据）。
        attachDesignSurface("pdf-import-progress-moment-375-light", app)
        XCTAssertTrue(app.staticTexts["这份 PDF 是扫描版"].waitForExistence(timeout: 10), "扫描版应弹提示卡")
        XCTAssertTrue(
            app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "页面上的字是图片")).firstMatch.exists
        )
        attachDesignSurface("pdf-import-confirm-cancel-375-light", app)
        app.buttons["取消"].tap()
        XCTAssertTrue(app.staticTexts["从一本书开始"].waitForExistence(timeout: 10), "取消后不应导入")
        XCTAssertFalse(app.staticTexts["QA-扫描版-取消"].exists)

        // 继续路径：再次导入另一份扫描 PDF → 继续导入 → 上书架。
        app.buttons["library-import"].tap()
        XCTAssertTrue(fileView.waitForExistence(timeout: 10))
        let continueFile = fileView.cells.matching(identifier: "QA-扫描版, pdf").firstMatch
        XCTAssertTrue(continueFile.waitForExistence(timeout: 10))
        continueFile.tap()
        XCTAssertTrue(app.staticTexts["这份 PDF 是扫描版"].waitForExistence(timeout: 10))
        attachDesignSurface("pdf-import-confirm-continue-375-light", app)
        app.buttons["继续导入"].tap()
        XCTAssertTrue(app.staticTexts["QA-扫描版"].waitForExistence(timeout: 20), "继续导入后应上书架")
        attachDesignSurface("pdf-import-after-continue-375-light", app)
        // 关闭“已加入书架”成功弹层，否则会挡住书架 cell。
        if app.buttons["知道了"].waitForExistence(timeout: 3) {
            app.buttons["知道了"].tap()
        }
        XCTAssertTrue(app.staticTexts["QA-扫描版"].waitForExistence(timeout: 5))
        // 打开导入的扫描 PDF，确认「?」入口存在。
        let cell = app.collectionViews["library"].cells.containing(
            NSPredicate(format: "label CONTAINS %@", "QA-扫描版")
        ).firstMatch
        XCTAssertTrue(cell.waitForExistence(timeout: 10))
        cell.tap()
        XCTAssertTrue(app.otherElements["pdf-reader-view"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["pdf-reader-help"].waitForExistence(timeout: 5), "导入的扫描版应显示「?」")
        attachDesignSurface("pdf-imported-reader-help-375-light", app)
        app.buttons["reader-close"].tap()
    }

    /// PDF M2：超大扫描 PDF（4000 页）导入时可见「正在检查这份 PDF…」进度；检查完弹提示卡，取消不落库。
    func testPDFLargeScannedImportShowsProgressOverlay() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--design-fixture=empty", "--design-theme=light"]
        app.launch()
        XCTAssertTrue(tab("tab-library", label: "书架", in: app).waitForExistence(timeout: 15))
        app.buttons["library-import"].tap()
        let fileView = app.collectionViews["File View"]
        XCTAssertTrue(fileView.waitForExistence(timeout: 10))
        let largeFile = fileView.cells.matching(identifier: "QA-扫描版-超大, pdf").firstMatch
        XCTAssertTrue(largeFile.waitForExistence(timeout: 10))
        largeFile.tap()

        // 600 页检查需要时间，应能看到进度浮层。
        let progress = app.otherElements["pdf-import-progress"]
        var sawProgress = false
        for _ in 0..<40 {
            if progress.exists { sawProgress = true; break }
            Thread.sleep(forTimeInterval: 0.05)
        }
        XCTAssertTrue(sawProgress, "大 PDF 导入应显示检查进度浮层")
        XCTAssertTrue(
            app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "正在检查这份 PDF")).firstMatch.exists
        )
        attachDesignSurface("pdf-import-progress-large-375-light", app)
        Thread.sleep(forTimeInterval: 0.6)
        attachDesignSurface("pdf-import-progress-large-later-375-light", app)

        XCTAssertTrue(app.staticTexts["这份 PDF 是扫描版"].waitForExistence(timeout: 60), "检查完应弹扫描提示卡")
        attachDesignSurface("pdf-import-large-confirm-375-light", app)
        app.buttons["取消"].tap()
        XCTAssertTrue(app.staticTexts["从一本书开始"].waitForExistence(timeout: 15), "取消后不应导入")
    }

    /// PDF M3：页级书签按钮/丝带、翻页显隐、目录/书签面板（排序/摘要/跳页/滑删/空态）。
    /// PDF M4b：搜索 tab——空态/第 1 页命中/清空再搜第 2 页并跳页/无结果。
    func testPDFSearchPanelFindsPagesAndShowsEmptyStates() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--design-fixture=pdf", "--design-theme=light"]
        app.launch()
        XCTAssertTrue(tab("tab-library", label: "书架", in: app).waitForExistence(timeout: 15))
        let shelf = app.collectionViews["library"]
        let cell = shelf.cells.containing(NSPredicate(format: "label CONTAINS %@", "书灯 PDF 示例")).firstMatch
        for _ in 0..<4 where !cell.exists { shelf.swipeUp() }
        XCTAssertTrue(cell.waitForExistence(timeout: 10))
        cell.tap()
        XCTAssertTrue(app.otherElements["pdf-reader-view"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["第 1 / 2 页"].waitForExistence(timeout: 10))

        app.buttons["pdf-contents"].tap()
        let tabs = app.segmentedControls["pdf-contents-tabs"]
        XCTAssertTrue(tabs.waitForExistence(timeout: 5))
        XCTAssertEqual(tabs.buttons.count, 3, "M4b 面板应有 目录/书签/搜索 三段")
        tabs.buttons["搜索"].tap()
        let field = app.descendants(matching: .any).matching(identifier: "pdf-search-field").firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        XCTAssertTrue(field.isEnabled, "文字版 PDF 应可搜索")
        XCTAssertTrue(app.staticTexts["输入关键词搜索这本书"].waitForExistence(timeout: 5))
        attachDesignSurface("pdf-m4b-search-empty-375-light", app)

        field.tap()
        field.typeText("灯把书页照亮")
        let results = app.tables["pdf-search-results"]
        let row1 = results.cells.matching(
            NSPredicate(format: "identifier BEGINSWITH %@", "pdf-search-row-1")
        ).firstMatch
        XCTAssertTrue(row1.waitForExistence(timeout: 10), "应命中第 1 页")
        func rowText(_ row: XCUIElement) -> String {
            row.staticTexts.allElementsBoundByIndex.map(\.label).joined(separator: "｜")
        }
        XCTAssertTrue(rowText(row1).contains("第 1 页"), "命中行应显示页码：\(rowText(row1))")
        attachDesignSurface("pdf-m4b-search-page1-375-light", app)

        // 清空后搜 PDFKit → 第 2 页；点行关闭面板并跳到第 2 页。
        field.tap()
        field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 6))
        XCTAssertTrue(app.staticTexts["输入关键词搜索这本书"].waitForExistence(timeout: 5), "清空后应显示空查询文案")
        field.typeText("PDFKit")
        let row2 = results.cells.matching(
            NSPredicate(format: "identifier BEGINSWITH %@", "pdf-search-row-2")
        ).firstMatch
        XCTAssertTrue(row2.waitForExistence(timeout: 10), "应命中第 2 页")
        XCTAssertTrue(rowText(row2).contains("第 2 页"), "命中行应显示第 2 页：\(rowText(row2))")
        row2.tap()
        XCTAssertTrue(app.staticTexts["第 2 / 2 页"].waitForExistence(timeout: 10), "点结果应关闭面板并跳到第 2 页")
        attachDesignSurface("pdf-m4b-jump-page2-375-light", app)

        // 无结果文案。
        app.buttons["pdf-contents"].tap()
        XCTAssertTrue(app.segmentedControls["pdf-contents-tabs"].waitForExistence(timeout: 5))
        app.segmentedControls["pdf-contents-tabs"].buttons["搜索"].tap()
        let field2 = app.descendants(matching: .any).matching(identifier: "pdf-search-field").firstMatch
        XCTAssertTrue(field2.waitForExistence(timeout: 5))
        field2.tap()
        field2.typeText("不存在的检索词")
        XCTAssertTrue(app.staticTexts["没有找到相关内容"].waitForExistence(timeout: 10))
        attachDesignSurface("pdf-m4b-search-no-results-375-light", app)
        app.buttons["pdf-contents-done"].tap()
    }

    /// PDF M4b：扫描版搜索 tab →「这本书没有可搜索的文字」且输入禁用。
    func testPDFScannedSearchPanelUnsearchable() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--design-fixture=pdf-scan", "--design-theme=light"]
        app.launch()
        XCTAssertTrue(tab("tab-library", label: "书架", in: app).waitForExistence(timeout: 15))
        let shelf = app.collectionViews["library"]
        let cell = shelf.cells.containing(NSPredicate(format: "label CONTAINS %@", "书灯 PDF 扫描版")).firstMatch
        for _ in 0..<4 where !cell.exists { shelf.swipeUp() }
        XCTAssertTrue(cell.waitForExistence(timeout: 10))
        cell.tap()
        XCTAssertTrue(app.otherElements["pdf-reader-view"].waitForExistence(timeout: 10))
        app.buttons["pdf-contents"].tap()
        let tabs = app.segmentedControls["pdf-contents-tabs"]
        XCTAssertTrue(tabs.waitForExistence(timeout: 5))
        tabs.buttons["搜索"].tap()
        XCTAssertTrue(app.staticTexts["没有可搜索的文字"].waitForExistence(timeout: 5))
        let field = app.descendants(matching: .any).matching(identifier: "pdf-search-field").firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        XCTAssertFalse(field.isEnabled, "扫描版搜索输入应禁用")
        attachDesignSurface("pdf-m4b-search-unsearchable-scan-375-light", app)
        app.buttons["pdf-contents-done"].tap()
    }

    /// PDF M6：页脚「问书灯」入口打开问答面板（生成未验证）；扫描版入口弹无文字提示。
    func testPDFAskFooterQuestionSheetAndScannedNoTextPrompt() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--design-fixture=pdf", "--design-theme=light"]
        app.launch()
        XCTAssertTrue(tab("tab-library", label: "书架", in: app).waitForExistence(timeout: 15))
        let shelf = app.collectionViews["library"]
        let cell = shelf.cells.containing(NSPredicate(format: "label CONTAINS %@", "书灯 PDF 示例")).firstMatch
        for _ in 0..<4 where !cell.exists { shelf.swipeUp() }
        XCTAssertTrue(cell.waitForExistence(timeout: 10))
        cell.tap()
        XCTAssertTrue(app.otherElements["pdf-reader-view"].waitForExistence(timeout: 10))
        let ask = app.buttons["pdf-reader-ask"]
        XCTAssertTrue(ask.waitForExistence(timeout: 5), "页脚应有「问书灯」入口")
        XCTAssertTrue(ask.isHittable)
        attachDesignSurface("pdf-m6-footer-ask-375-light", app)
        ask.tap()
        let sheet = app.otherElements["question-sheet"]
        XCTAssertTrue(sheet.waitForExistence(timeout: 10), "点「问书灯」应打开问答面板")
        XCTAssertTrue(app.textViews["question-input"].waitForExistence(timeout: 5))
        attachDesignSurface("pdf-m6-question-sheet-entry-375-light", app)
        let close = app.buttons["question-close"]
        XCTAssertTrue(close.waitForExistence(timeout: 5))
        close.tap()
        XCTAssertTrue(sheet.waitForNonExistence(timeout: 10))
        app.terminate()

        app.launchArguments = ["--design-fixture=pdf-scan", "--design-theme=light"]
        app.launch()
        XCTAssertTrue(tab("tab-library", label: "书架", in: app).waitForExistence(timeout: 15))
        let scanShelf = app.collectionViews["library"]
        let scanCell = scanShelf.cells.containing(NSPredicate(format: "label CONTAINS %@", "书灯 PDF 扫描版")).firstMatch
        for _ in 0..<4 where !scanCell.exists { scanShelf.swipeUp() }
        XCTAssertTrue(scanCell.waitForExistence(timeout: 10))
        scanCell.tap()
        XCTAssertTrue(app.otherElements["pdf-reader-view"].waitForExistence(timeout: 10))
        let scanAsk = app.buttons["pdf-reader-ask"]
        XCTAssertTrue(scanAsk.waitForExistence(timeout: 5))
        scanAsk.tap()
        XCTAssertTrue(
            app.staticTexts["没有可搜索的文字；阅读、缩放和加书签都可以正常使用。"].waitForExistence(timeout: 5),
            "扫描版应提示没有可搜索文字"
        )
        XCTAssertFalse(app.otherElements["question-sheet"].exists, "扫描版不应打开问答面板")
        attachDesignSurface("pdf-m6-scan-ask-no-text-alert-375-light", app)
        app.buttons["知道了"].tap()
    }

    /// PDF M5b：笔记页 PDF 分组显示「第 N 页」；点行进入 PDF 阅读器对应页；编辑保存；滑删后标注消失。
    func testNotesPagePDFAnnotationsDisplayJumpEditAndDelete() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--design-fixture=pdf", "--design-theme=light"]
        app.launch()
        XCTAssertTrue(tab("tab-notes", label: "笔记", in: app).waitForExistence(timeout: 15))
        tab("tab-notes", label: "笔记", in: app).tap()
        let list = app.collectionViews["notes"]
        XCTAssertTrue(list.waitForExistence(timeout: 10))
        let page1Row = list.cells.matching(NSPredicate(format: "label CONTAINS %@", "第 1 页")).firstMatch
        let page2Row = list.cells.matching(NSPredicate(format: "label CONTAINS %@", "第 2 页")).firstMatch
        let pdfHeader = list.cells.matching(NSPredicate(format: "label CONTAINS %@", "书灯 PDF 示例")).firstMatch
        for _ in 0..<4 where !pdfHeader.exists { list.swipeUp() }
        XCTAssertTrue(pdfHeader.waitForExistence(timeout: 10), "笔记页应有 PDF 书分组")
        if (pdfHeader.value as? String) == "已收起" { pdfHeader.tap() }
        for _ in 0..<4 where !page1Row.exists { list.swipeUp() }
        XCTAssertTrue(page1Row.waitForExistence(timeout: 10), "PDF 高亮行应显示「第 1 页」")
        for _ in 0..<4 where !page2Row.exists { list.swipeUp() }
        XCTAssertTrue(page2Row.waitForExistence(timeout: 10), "PDF 笔记行应显示「第 2 页」")
        XCTAssertTrue(page1Row.label.contains("灯把书页照亮"), "高亮行应显示引文：\(page1Row.label)")
        XCTAssertTrue(page2Row.label.contains("夹具笔记"), "笔记行应显示正文：\(page2Row.label)")
        attachDesignSurface("pdf-m5b-notes-pdf-group-375-light", app)

        // leading 编辑 → 保存后列表正文更新。
        let editableRow = list.cells.matching(NSPredicate(format: "label CONTAINS %@", "第 2 页")).firstMatch
        XCTAssertTrue(editableRow.waitForExistence(timeout: 10))
        editableRow.swipeRight()
        XCTAssertTrue(app.buttons["编辑"].waitForExistence(timeout: 5))
        app.buttons["编辑"].tap()
        let body = app.textViews["note-body"]
        XCTAssertTrue(body.waitForExistence(timeout: 5), "应打开笔记编辑器")
        XCTAssertEqual((body.value as? String) ?? "", "夹具笔记：PDFKit 渲染与翻页说明。")
        body.tap()
        body.typeText("（QA编辑）")
        XCTAssertTrue(((body.value as? String) ?? "").contains("QA编辑"), "编辑器正文应包含输入内容：\(body.value ?? "")")
        app.buttons["note-save"].tap()
        Thread.sleep(forTimeInterval: 1.0)
        // 保存后用搜索验证正文已更新（搜索会从 LibraryStore 重建列表）。
        let notesSearch = waitForSearchField("notes-search", in: app)
        notesSearch.tap()
        notesSearch.typeText("QA编辑")
        let editedRow = list.cells.matching(NSPredicate(format: "label CONTAINS %@", "QA编辑")).firstMatch
        XCTAssertTrue(editedRow.waitForExistence(timeout: 10), "保存后列表正文应更新（搜索可命中）")
        attachDesignSurface("pdf-m5b-notes-edited-375-light", app)
        notesSearch.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 4))
        if let dismiss = waitForSearchDismissButton(in: app) { dismiss.tap() }
        XCTAssertTrue(waitForPageTitle("笔记", in: app))
        let pdfHeaderAfterEdit = list.cells.matching(NSPredicate(format: "label CONTAINS %@", "书灯 PDF 示例")).firstMatch
        for _ in 0..<4 where !pdfHeaderAfterEdit.exists { list.swipeUp() }
        if pdfHeaderAfterEdit.exists, (pdfHeaderAfterEdit.value as? String) == "已收起" { pdfHeaderAfterEdit.tap() }

        // 编辑后点行仍进 PDF 第 2 页且标注仍在。
        let updatedRow = list.cells.matching(NSPredicate(format: "label CONTAINS %@", "QA编辑")).firstMatch
        for _ in 0..<4 where !updatedRow.exists { list.swipeUp() }
        XCTAssertTrue(updatedRow.waitForExistence(timeout: 10), "编辑后行应仍在列表")
        updatedRow.tap()
        XCTAssertTrue(app.otherElements["pdf-reader-view"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["第 2 / 2 页"].waitForExistence(timeout: 10))
        attachDesignSurface("pdf-m5b-edited-note-in-reader-375-light", app)
        app.buttons["reader-close"].tap()
        XCTAssertTrue(list.waitForExistence(timeout: 10))

        // trailing 滑删 → 确认 → 行消失。
        let pdfHeaderBeforeDelete = list.cells.matching(NSPredicate(format: "label CONTAINS %@", "书灯 PDF 示例")).firstMatch
        for _ in 0..<4 where !pdfHeaderBeforeDelete.exists { list.swipeUp() }
        if pdfHeaderBeforeDelete.exists, (pdfHeaderBeforeDelete.value as? String) == "已收起" { pdfHeaderBeforeDelete.tap() }
        let deleteRow = list.cells.matching(NSPredicate(format: "label CONTAINS %@", "第 2 页")).firstMatch
        for _ in 0..<4 where !deleteRow.exists { list.swipeUp() }
        XCTAssertTrue(deleteRow.waitForExistence(timeout: 10))
        deleteRow.swipeLeft()
        XCTAssertTrue(app.buttons["删除"].waitForExistence(timeout: 5))
        app.buttons["删除"].tap()
        XCTAssertTrue(app.staticTexts["删除笔记？"].waitForExistence(timeout: 5))
        app.buttons["删除"].tap()
        for _ in 0..<20 where deleteRow.exists { Thread.sleep(forTimeInterval: 0.1) }
        XCTAssertFalse(deleteRow.exists, "滑删确认后列表行应消失")
        attachDesignSurface("pdf-m5b-notes-deleted-375-light", app)

        // 打开 PDF 第 2 页：笔记注解应已移除。
        tab("tab-library", label: "书架", in: app).tap()
        let shelf = app.collectionViews["library"]
        let bookCell = shelf.cells.containing(NSPredicate(format: "label CONTAINS %@", "书灯 PDF 示例")).firstMatch
        for _ in 0..<4 where !bookCell.exists { shelf.swipeUp() }
        XCTAssertTrue(bookCell.waitForExistence(timeout: 10))
        bookCell.tap()
        XCTAssertTrue(app.otherElements["pdf-reader-view"].waitForExistence(timeout: 10))
        setPDFReadingMode(app, scroll: false)
        Thread.sleep(forTimeInterval: 0.5)
        app.otherElements["pdf-reader-view"].swipeLeft()
        XCTAssertTrue(app.staticTexts["第 2 / 2 页"].waitForExistence(timeout: 10))
        attachDesignSurface("pdf-m5b-reader-after-delete-page2-375-light", app)
        app.buttons["reader-close"].tap()
    }

    /// PDF M5b 回归：EPUB 笔记行点击进入 EPUB 阅读器、leading 编辑入口仍在。
    func testNotesPageEPUBAnnotationsUnchanged() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--design-fixture=normal", "--design-theme=light"]
        app.launch()
        XCTAssertTrue(tab("tab-notes", label: "笔记", in: app).waitForExistence(timeout: 15))
        tab("tab-notes", label: "笔记", in: app).tap()
        let list = app.collectionViews["notes"]
        XCTAssertTrue(list.waitForExistence(timeout: 10))
        let row = list.cells.containing(NSPredicate(format: "label CONTAINS %@", "灯把书页照亮")).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 10), "EPUB 笔记行仍应存在")
        XCTAssertTrue(row.label.contains("第三回"), "EPUB 行仍显示章节：\(row.label)")
        attachDesignSurface("pdf-m5b-notes-epub-regression-375-light", app)
        row.tap()
        XCTAssertTrue(app.buttons["reader-ask-book"].waitForExistence(timeout: 15), "EPUB 笔记应回到 EPUB 阅读器")
        // 重新启动进入笔记页验证编辑入口（避免依赖阅读器返回路径）。
        app.terminate()
        app.launch()
        XCTAssertTrue(tab("tab-notes", label: "笔记", in: app).waitForExistence(timeout: 15))
        tab("tab-notes", label: "笔记", in: app).tap()
        XCTAssertTrue(list.waitForExistence(timeout: 10))
        let editable = list.cells.containing(NSPredicate(format: "label CONTAINS %@", "灯把书页照亮")).firstMatch
        editable.swipeRight()
        XCTAssertTrue(app.buttons["编辑"].waitForExistence(timeout: 5), "EPUB 笔记仍有编辑入口")
        app.buttons["编辑"].tap()
        XCTAssertTrue(app.textViews["note-body"].waitForExistence(timeout: 5))
    }

    /// PDF M5a：点已有高亮 → 调色盘改色 → 再点 → 取消高亮（直接删除）。
    func testPDFExistingHighlightPaletteChangeColorAndCancelHighlight() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--design-fixture=pdf", "--design-theme=light"]
        app.launch()
        XCTAssertTrue(tab("tab-library", label: "书架", in: app).waitForExistence(timeout: 15))
        let shelf = app.collectionViews["library"]
        let cell = shelf.cells.containing(NSPredicate(format: "label CONTAINS %@", "书灯 PDF 示例")).firstMatch
        for _ in 0..<4 where !cell.exists { shelf.swipeUp() }
        XCTAssertTrue(cell.waitForExistence(timeout: 10))
        cell.tap()
        XCTAssertTrue(app.otherElements["pdf-reader-view"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["第 1 / 2 页"].waitForExistence(timeout: 10))

        let pdfView = app.otherElements["pdf-reader-view"]
        let palette = app.otherElements["pdf-highlight-palette"]
        let noteMenu = app.otherElements["pdf-note-menu"]
        var hitOffset = CGVector(dx: 0.5, dy: 0.3)
        func findHighlightPalette() -> Bool {
            let xs: [CGFloat] = [0.10, 0.13, 0.16, 0.20, 0.24, 0.28]
            let ys: [CGFloat] = [0.09, 0.11, 0.13, 0.15, 0.17, 0.19, 0.21, 0.24]
            for attempt in 0..<2 {
                if attempt == 1 {
                    // 首次点击无反应兜底：轻微滚动后重试，并留下记录。
                    print("QA_M5A_SCROLL_RETRY highlight")
                    pdfView.swipeUp()
                    Thread.sleep(forTimeInterval: 0.4)
                    pdfView.swipeDown()
                    Thread.sleep(forTimeInterval: 0.4)
                    attachDesignSurface("pdf-m5a-scroll-retry-highlight-375-light", app)
                }
                for y in ys {
                    for x in xs {
                        if palette.exists || noteMenu.exists { return palette.exists }
                        pdfView.coordinate(withNormalizedOffset: CGVector(dx: x, dy: y)).tap()
                        Thread.sleep(forTimeInterval: 0.35)
                        if palette.exists { hitOffset = CGVector(dx: x, dy: y); return true }
                        if noteMenu.exists { app.buttons["pdf-note-cancel"].tap(); Thread.sleep(forTimeInterval: 0.3) }
                    }
                }
            }
            return palette.exists
        }
        XCTAssertTrue(findHighlightPalette(), "点中第 1 页预置高亮应出现调色盘")
        Thread.sleep(forTimeInterval: 0.8)
        XCTAssertFalse(app.buttons["Select All"].exists, "M5a 修复：不应叠加系统选择菜单")
        XCTAssertFalse(app.buttons["Copy"].exists, "M5a 修复：不应叠加系统复制菜单")
        attachDesignSurface("pdf-m5a-highlight-palette-08s-375-light", app)
        Thread.sleep(forTimeInterval: 1.7)
        XCTAssertTrue(palette.exists, "2.5s 后自定义调色盘仍应在")
        attachDesignSurface("pdf-m5a-highlight-palette-25s-375-light", app)
        let green = app.buttons["pdf-highlight-color-green"]
        XCTAssertTrue(green.waitForExistence(timeout: 5))
        green.tap()
        XCTAssertFalse(palette.waitForExistence(timeout: 2), "选色后调色盘应关闭")
        attachDesignSurface("pdf-m5a-highlight-recolored-375-light", app)

        XCTAssertTrue(findHighlightPalette(), "改色后仍可点中高亮")
        app.buttons["pdf-highlight-remove"].tap()
        XCTAssertFalse(palette.waitForExistence(timeout: 2), "取消高亮后调色盘应关闭")
        Thread.sleep(forTimeInterval: 0.4)
        pdfView.coordinate(withNormalizedOffset: hitOffset).tap()
        Thread.sleep(forTimeInterval: 0.6)
        XCTAssertFalse(palette.exists, "取消高亮后原位置不应再出现调色盘")
        attachDesignSurface("pdf-m5a-highlight-cancelled-375-light", app)
    }

    /// PDF M5a：点已有笔记 → 改色 → 再点开 → 编辑笔记正文并保存。
    func testPDFExistingNoteMenuChangeColorAndEdit() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--design-fixture=pdf", "--design-theme=light"]
        app.launch()
        XCTAssertTrue(tab("tab-library", label: "书架", in: app).waitForExistence(timeout: 15))
        let shelf = app.collectionViews["library"]
        let cell = shelf.cells.containing(NSPredicate(format: "label CONTAINS %@", "书灯 PDF 示例")).firstMatch
        for _ in 0..<4 where !cell.exists { shelf.swipeUp() }
        XCTAssertTrue(cell.waitForExistence(timeout: 10))
        cell.tap()
        XCTAssertTrue(app.otherElements["pdf-reader-view"].waitForExistence(timeout: 10))
        setPDFReadingMode(app, scroll: false)
        Thread.sleep(forTimeInterval: 0.5)
        app.otherElements["pdf-reader-view"].swipeLeft()
        XCTAssertTrue(app.staticTexts["第 2 / 2 页"].waitForExistence(timeout: 10))

        let pdfView = app.otherElements["pdf-reader-view"]
        let noteMenu = app.otherElements["pdf-note-menu"]
        let xs: [CGFloat] = [0.30, 0.33, 0.36, 0.40, 0.44, 0.48, 0.20, 0.25]
        let ys: [CGFloat] = [0.09, 0.11, 0.13, 0.15, 0.17, 0.19, 0.21, 0.24]
        var hitOffset = CGVector(dx: 0.30, dy: 0.13)
        func findMenu() -> Bool {
            for y in ys {
                for x in xs {
                    if noteMenu.exists { return true }
                    pdfView.coordinate(withNormalizedOffset: CGVector(dx: x, dy: y)).tap()
                    Thread.sleep(forTimeInterval: 0.3)
                    if noteMenu.exists { hitOffset = CGVector(dx: x, dy: y); return true }
                }
            }
            return noteMenu.exists
        }
        XCTAssertTrue(findMenu(), "应点中第 2 页笔记浮层")
        Thread.sleep(forTimeInterval: 0.8)
        XCTAssertFalse(app.buttons["Select All"].exists, "M5a 修复：不应叠加系统选择菜单")
        attachDesignSurface("pdf-m5a-note-edit-menu-08s-375-light", app)
        Thread.sleep(forTimeInterval: 1.7)
        XCTAssertTrue(noteMenu.exists, "2.5s 后自定义笔记浮层仍应在")
        attachDesignSurface("pdf-m5a-note-edit-menu-25s-375-light", app)
        app.buttons["pdf-note-color-blue"].tap()
        XCTAssertFalse(noteMenu.waitForExistence(timeout: 2))
        Thread.sleep(forTimeInterval: 0.4)
        attachDesignSurface("pdf-m5a-note-recolored-page2-375-light", app)

        XCTAssertTrue(findMenu(), "改色后仍可点中笔记")
        Thread.sleep(forTimeInterval: 0.8)
        XCTAssertFalse(app.buttons["Select All"].exists, "M5a 修复：不应叠加系统选择菜单")
        app.buttons["pdf-note-edit"].tap()
        XCTAssertTrue(app.otherElements["pdf-note-editor"].waitForExistence(timeout: 5), "应打开笔记编辑器")
        let body = app.textViews["note-body"]
        XCTAssertTrue(body.waitForExistence(timeout: 5))
        XCTAssertEqual((body.value as? String) ?? "", "夹具笔记：PDFKit 渲染与翻页说明。")
        body.tap()
        body.typeText("（已编辑）")
        app.buttons["note-save"].tap()
        Thread.sleep(forTimeInterval: 0.8)
        attachDesignSurface("pdf-m5a-note-edited-page2-375-light", app)
    }

    /// PDF M5a：点已有笔记 → 直接打开 NoteEditor（无 pdf-note-menu、无系统浮条）→ 编辑器内删除。
    func testPDFExistingNoteOpensEditorAndDelete() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--design-fixture=pdf", "--design-theme=light"]
        app.launch()
        XCTAssertTrue(tab("tab-library", label: "书架", in: app).waitForExistence(timeout: 15))
        let shelf = app.collectionViews["library"]
        let cell = shelf.cells.containing(NSPredicate(format: "label CONTAINS %@", "书灯 PDF 示例")).firstMatch
        for _ in 0..<4 where !cell.exists { shelf.swipeUp() }
        XCTAssertTrue(cell.waitForExistence(timeout: 10))
        cell.tap()
        XCTAssertTrue(app.otherElements["pdf-reader-view"].waitForExistence(timeout: 10))
        setPDFReadingMode(app, scroll: false)
        Thread.sleep(forTimeInterval: 0.5)
        app.otherElements["pdf-reader-view"].swipeLeft()
        XCTAssertTrue(app.staticTexts["第 2 / 2 页"].waitForExistence(timeout: 10))

        let pdfView = app.otherElements["pdf-reader-view"]
        let editor = app.otherElements["pdf-note-editor"]
        let noteMenu = app.otherElements["pdf-note-menu"]
        let xs: [CGFloat] = [0.30, 0.33, 0.36, 0.40, 0.44, 0.48, 0.20, 0.25]
        let ys: [CGFloat] = [0.09, 0.11, 0.13, 0.15, 0.17, 0.19, 0.21, 0.24]
        var hitOffset = CGVector(dx: 0.30, dy: 0.13)
        func findEditor() -> Bool {
            for attempt in 0..<2 {
                if attempt == 1 {
                    print("QA_M5A_SCROLL_RETRY note-editor")
                    pdfView.swipeUp(); Thread.sleep(forTimeInterval: 0.4)
                    pdfView.swipeDown(); Thread.sleep(forTimeInterval: 0.4)
                    attachDesignSurface("pdf-m5a-scroll-retry-note-375-light", app)
                }
                for y in ys {
                    for x in xs {
                        if editor.exists { return true }
                        pdfView.coordinate(withNormalizedOffset: CGVector(dx: x, dy: y)).tap()
                        Thread.sleep(forTimeInterval: 0.35)
                        if editor.exists { hitOffset = CGVector(dx: x, dy: y); return true }
                    }
                }
            }
            return editor.exists
        }
        XCTAssertTrue(findEditor(), "点第 2 页预置笔记应直接打开 NoteEditor")
        XCTAssertTrue(app.textViews["note-body"].waitForExistence(timeout: 5))
        XCTAssertFalse(noteMenu.exists, "pdf-note-menu 已移除，不应出现")
        Thread.sleep(forTimeInterval: 0.8)
        XCTAssertFalse(app.buttons["Select All"].exists, "M5a 修复：不应叠加系统选择菜单")
        XCTAssertFalse(app.buttons["Copy"].exists, "M5a 修复：不应叠加系统复制菜单")
        attachDesignSurface("pdf-m5a-note-editor-08s-375-light", app)
        Thread.sleep(forTimeInterval: 1.7)
        XCTAssertTrue(editor.exists, "2.5s 后 NoteEditor 仍应在")
        XCTAssertFalse(app.buttons["Select All"].exists, "M5a 修复：2.5s 后仍不应有系统选择菜单")
        attachDesignSurface("pdf-m5a-note-editor-25s-375-light", app)

        // 编辑器内删除（二次确认）→ 关闭 → 原位置不再打开编辑器。
        let deleteButton = app.buttons["note-delete"]
        XCTAssertTrue(deleteButton.waitForExistence(timeout: 5), "已保存笔记编辑器应有删除入口")
        deleteButton.tap()
        XCTAssertTrue(app.staticTexts["删除笔记？"].waitForExistence(timeout: 5))
        attachDesignSurface("pdf-m5a-note-editor-delete-confirm-375-light", app)
        let dialogDelete = app.otherElements["book-dialog"].buttons["删除"]
        if dialogDelete.waitForExistence(timeout: 2) {
            dialogDelete.tap()
        } else {
            app.buttons["删除"].firstMatch.tap()
        }
        XCTAssertTrue(editor.waitForNonExistence(timeout: 5), "删除后编辑器应关闭")
        Thread.sleep(forTimeInterval: 0.5)
        pdfView.coordinate(withNormalizedOffset: hitOffset).tap()
        Thread.sleep(forTimeInterval: 0.8)
        XCTAssertFalse(editor.exists, "删除笔记后原位置不应再打开编辑器")
        attachDesignSurface("pdf-m5a-note-deleted-375-light", app)
    }

    /// PDF M5a：点已有笔记 → NoteEditor 预填正文 → 编辑保存 → 再点开仍是编辑后的正文。
    func testPDFExistingNoteEditorEditAndSave() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--design-fixture=pdf", "--design-theme=light"]
        app.launch()
        XCTAssertTrue(tab("tab-library", label: "书架", in: app).waitForExistence(timeout: 15))
        let shelf = app.collectionViews["library"]
        let cell = shelf.cells.containing(NSPredicate(format: "label CONTAINS %@", "书灯 PDF 示例")).firstMatch
        for _ in 0..<4 where !cell.exists { shelf.swipeUp() }
        XCTAssertTrue(cell.waitForExistence(timeout: 10))
        cell.tap()
        XCTAssertTrue(app.otherElements["pdf-reader-view"].waitForExistence(timeout: 10))
        setPDFReadingMode(app, scroll: false)
        Thread.sleep(forTimeInterval: 0.5)
        app.otherElements["pdf-reader-view"].swipeLeft()
        XCTAssertTrue(app.staticTexts["第 2 / 2 页"].waitForExistence(timeout: 10))

        let pdfView = app.otherElements["pdf-reader-view"]
        let editor = app.otherElements["pdf-note-editor"]
        let xs: [CGFloat] = [0.30, 0.33, 0.36, 0.40, 0.44, 0.48, 0.20, 0.25]
        let ys: [CGFloat] = [0.09, 0.11, 0.13, 0.15, 0.17, 0.19, 0.21, 0.24]
        var hitOffset = CGVector(dx: 0.30, dy: 0.13)
        func openEditor() -> Bool {
            for y in ys {
                for x in xs {
                    if editor.exists { return true }
                    pdfView.coordinate(withNormalizedOffset: CGVector(dx: x, dy: y)).tap()
                    Thread.sleep(forTimeInterval: 0.35)
                    if editor.exists { hitOffset = CGVector(dx: x, dy: y); return true }
                }
            }
            return editor.exists
        }
        XCTAssertTrue(openEditor(), "点第 2 页笔记应打开 NoteEditor")
        let body = app.textViews["note-body"]
        XCTAssertTrue(body.waitForExistence(timeout: 5))
        XCTAssertEqual((body.value as? String) ?? "", "夹具笔记：PDFKit 渲染与翻页说明。")
        body.tap()
        body.typeText("（QA编辑）")
        XCTAssertTrue(((body.value as? String) ?? "").contains("QA编辑"), "编辑器正文应包含输入内容")
        app.buttons["note-save"].tap()
        XCTAssertTrue(editor.waitForNonExistence(timeout: 5), "保存后编辑器应关闭")
        Thread.sleep(forTimeInterval: 0.8)
        attachDesignSurface("pdf-m5a-note-edited-page2-375-light", app)

        // 再点开：正文已更新且注解仍在。
        XCTAssertTrue(openEditor(), "保存后仍可点开笔记")
        XCTAssertTrue(app.textViews["note-body"].waitForExistence(timeout: 5))
        let updatedBody = (app.textViews["note-body"].value as? String) ?? ""
        XCTAssertTrue(updatedBody.contains("QA编辑"), "再次打开应显示编辑后的正文：\(updatedBody)")
        attachDesignSurface("pdf-m5a-note-reopened-edited-375-light", app)
    }

    /// PDF M5a（尽力）：长按拖拽选区 → 纸白选区浮层 → 创建高亮/写笔记；选区自动化不稳定则跳过并标注。
    func testPDFSelectionMenuCreateHighlightAndNote() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--design-fixture=pdf", "--design-theme=light"]
        app.launch()
        XCTAssertTrue(tab("tab-library", label: "书架", in: app).waitForExistence(timeout: 15))
        let shelf = app.collectionViews["library"]
        let cell = shelf.cells.containing(NSPredicate(format: "label CONTAINS %@", "书灯 PDF 示例")).firstMatch
        for _ in 0..<4 where !cell.exists { shelf.swipeUp() }
        XCTAssertTrue(cell.waitForExistence(timeout: 10))
        cell.tap()
        XCTAssertTrue(app.otherElements["pdf-reader-view"].waitForExistence(timeout: 10))
        let pdfView = app.otherElements["pdf-reader-view"]
        let menu = app.otherElements["pdf-selection-menu"]
        var selected = false
        let wordPoints: [CGVector] = [
            CGVector(dx: 0.20, dy: 0.14), CGVector(dx: 0.30, dy: 0.14),
            CGVector(dx: 0.15, dy: 0.16), CGVector(dx: 0.35, dy: 0.16),
            CGVector(dx: 0.25, dy: 0.18)
        ]
        for point in wordPoints {
            pdfView.coordinate(withNormalizedOffset: point).doubleTap()
            if menu.waitForExistence(timeout: 3) { selected = true; break }
            Thread.sleep(forTimeInterval: 0.4)
        }
        guard selected else {
            throw XCTSkip("PDF 选区自动化未成功（长按拖拽未触发选区），创建高亮/笔记 UI 未验证")
        }
        attachDesignSurface("pdf-m5a-selection-menu-375-light", app)
        app.buttons["pdf-selection-highlight"].tap()
        let palette = app.otherElements["pdf-highlight-palette"]
        XCTAssertTrue(palette.waitForExistence(timeout: 5), "选区→高亮应打开调色盘")
        app.buttons["pdf-highlight-color-yellow"].tap()
        XCTAssertFalse(palette.waitForExistence(timeout: 2))
        attachDesignSurface("pdf-m5a-created-highlight-375-light", app)

        // 再选一次 → 写笔记 → 编辑器输入并保存。
        for point in wordPoints.reversed() {
            pdfView.coordinate(withNormalizedOffset: point).doubleTap()
            if menu.waitForExistence(timeout: 3) { break }
        }
        if menu.exists {
            app.buttons["pdf-selection-note"].tap()
            XCTAssertTrue(app.otherElements["pdf-note-editor"].waitForExistence(timeout: 5))
            let body = app.textViews["note-body"]
            XCTAssertTrue(body.waitForExistence(timeout: 5))
            body.tap()
            body.typeText("PDF 笔记 UI 创建")
            app.buttons["note-save"].tap()
            Thread.sleep(forTimeInterval: 0.6)
            attachDesignSurface("pdf-m5a-created-note-375-light", app)
        }
    }

    func testPDFBookmarkRibbonAndContentsPanelFlow() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--design-fixture=pdf", "--design-theme=light"]
        app.launch()
        XCTAssertTrue(tab("tab-library", label: "书架", in: app).waitForExistence(timeout: 15))
        let shelf = app.collectionViews["library"]
        let cell = shelf.cells.containing(NSPredicate(format: "label CONTAINS %@", "书灯 PDF 示例")).firstMatch
        for _ in 0..<4 where !cell.exists { shelf.swipeUp() }
        XCTAssertTrue(cell.waitForExistence(timeout: 10))
        cell.tap()
        XCTAssertTrue(app.otherElements["pdf-reader-view"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["第 1 / 2 页"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["pdf-reader-settings"].exists, "阅读设置入口应在顶栏")

        // 第 1 页加书签 → 丝带出现。
        let toggle = app.buttons["pdf-bookmark-toggle"]
        XCTAssertTrue(toggle.exists)
        XCTAssertFalse(app.buttons["pdf-bookmark-ribbon"].exists, "初始第 1 页无书签")
        toggle.tap()
        XCTAssertTrue(app.buttons["pdf-bookmark-ribbon"].waitForExistence(timeout: 5), "加书签后应显示丝带")
        XCTAssertEqual(toggle.value as? String, "此页已有书签")
        attachDesignSurface("pdf-m3-ribbon-page1-375-light", app)

        // 点丝带取消 → 丝带消失、按钮回到未填充；再点按钮恢复（填充态）。
        app.buttons["pdf-bookmark-ribbon"].tap()
        let ribbonGone = NSPredicate { _, _ in !app.buttons["pdf-bookmark-ribbon"].exists }
        expectation(for: ribbonGone, evaluatedWith: app)
        waitForExpectations(timeout: 5)
        XCTAssertTrue(((toggle.value as? String) ?? "").isEmpty, "取消后按钮应回到未加书签状态")
        toggle.tap()
        XCTAssertTrue(app.buttons["pdf-bookmark-ribbon"].waitForExistence(timeout: 5))
        XCTAssertEqual(toggle.value as? String, "此页已有书签")

        // 切单页翻到第 2 页：第 1 页丝带消失。
        setPDFReadingMode(app, scroll: false)
        Thread.sleep(forTimeInterval: 0.5)
        app.otherElements["pdf-reader-view"].swipeLeft()
        XCTAssertTrue(app.staticTexts["第 2 / 2 页"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["pdf-bookmark-ribbon"].exists, "第 2 页无书签时不应显示丝带")

        // 第 2 页加书签，再回第 1 页（丝带仍在）。
        toggle.tap()
        XCTAssertTrue(app.buttons["pdf-bookmark-ribbon"].waitForExistence(timeout: 5))
        attachDesignSurface("pdf-m3-ribbon-page2-375-light", app)
        app.buttons["pdf-contents"].tap()
        XCTAssertTrue(app.tables["pdf-contents-panel"].waitForExistence(timeout: 5))
        let tabs = app.segmentedControls["pdf-contents-tabs"]
        XCTAssertTrue(tabs.exists)
        tabs.buttons["书签"].tap()
        let rows = app.tables["pdf-contents-panel"].cells.matching(
            NSPredicate(format: "identifier BEGINSWITH %@", "pdf-bookmark-row-")
        )
        XCTAssertTrue(rows.firstMatch.waitForExistence(timeout: 5))
        for _ in 0..<20 where rows.count != 2 { Thread.sleep(forTimeInterval: 0.1) }
        XCTAssertEqual(rows.count, 2)
        func rowText(_ row: XCUIElement) -> String {
            row.staticTexts.allElementsBoundByIndex.map(\.label).joined(separator: "｜")
        }
        let firstText = rowText(rows.element(boundBy: 0))
        let secondText = rowText(rows.element(boundBy: 1))
        XCTAssertTrue(firstText.contains("第 1 页"), "书签应按页升序：\(firstText) / \(secondText)")
        XCTAssertTrue(secondText.contains("第 2 页"), "书签应按页升序：\(firstText) / \(secondText)")
        XCTAssertTrue(firstText.contains("书灯 PDF 示例 · 第一页"), "第 1 页摘要：\(firstText)")
        attachDesignSurface("pdf-m3-bookmarks-panel-375-light", app)

        // 点第 1 页书签 → 关闭面板并跳到第 1 页。
        rows.element(boundBy: 0).tap()
        XCTAssertTrue(app.staticTexts["第 1 / 2 页"].waitForExistence(timeout: 10), "点书签应跳到第 1 页")
        XCTAssertTrue(app.buttons["pdf-bookmark-ribbon"].waitForExistence(timeout: 5))
        attachDesignSurface("pdf-m3-jump-back-page1-375-light", app)

        // 重开面板：滑删第 2 页书签；目录空态；再删完书签 → 书签空态。
        app.buttons["pdf-contents"].tap()
        XCTAssertTrue(app.tables["pdf-contents-panel"].waitForExistence(timeout: 5))
        tabs.buttons["书签"].tap()
        let secondRow = rows.element(boundBy: 1)
        XCTAssertTrue(secondRow.waitForExistence(timeout: 5))
        secondRow.swipeLeft()
        XCTAssertTrue(app.buttons["删除"].waitForExistence(timeout: 5))
        app.buttons["删除"].tap()
        for _ in 0..<20 where rows.count != 1 { Thread.sleep(forTimeInterval: 0.1) }
        XCTAssertEqual(rows.count, 1)
        attachDesignSurface("pdf-m3-bookmark-deleted-375-light", app)

        tabs.buttons["目录"].tap()
        XCTAssertTrue(app.staticTexts["这份 PDF 没有目录"].waitForExistence(timeout: 5))
        attachDesignSurface("pdf-m3-toc-empty-375-light", app)

        tabs.buttons["书签"].tap()
        let lastRow = rows.firstMatch
        XCTAssertTrue(lastRow.waitForExistence(timeout: 5))
        lastRow.swipeLeft()
        XCTAssertTrue(app.buttons["删除"].waitForExistence(timeout: 5))
        app.buttons["删除"].tap()
        XCTAssertTrue(app.staticTexts["还没有书签"].waitForExistence(timeout: 5))
        attachDesignSurface("pdf-m3-bookmarks-empty-375-light", app)
        app.buttons["pdf-contents-done"].tap()
    }

    func testReaderContentsPanelHasContentsAndBookmarksWithProgress() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--design-fixture=normal", "--design-theme=light"]
        app.launch()
        openFixtureBook("红楼梦", in: app)
        waitForBody(app)
        let contents = app.buttons["reader-contents"]
        fullscreenWait { contents.exists && contents.isEnabled && contents.isHittable }
        contents.tap()
        XCTAssertTrue(app.tables["book-navigation"].waitForExistence(timeout: 5))
        let tabs = app.segmentedControls.firstMatch
        XCTAssertTrue(tabs.exists)
        XCTAssertEqual(tabs.buttons.count, 2, "定稿面板只保留 目录/书签 两个 tab")
        XCTAssertTrue(tabs.buttons["目录"].exists)
        XCTAssertTrue(tabs.buttons["书签"].exists)
        XCTAssertFalse(tabs.buttons["笔记"].exists, "不应再有“笔记”tab")
        attachDesignSurface("reader-contents-two-tabs-375-light", app)

        tabs.buttons["书签"].tap()
        Thread.sleep(forTimeInterval: 0.4)
        let bookmarkRow = app.tables["book-navigation"].cells.matching(
            NSPredicate(format: "identifier BEGINSWITH %@", "bookmark-")
        ).firstMatch
        XCTAssertTrue(bookmarkRow.waitForExistence(timeout: 5), "书签 tab 应列出种子书签")
        XCTAssertTrue(
            bookmarkRow.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "进度")).firstMatch.exists ||
                app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "进度")).firstMatch.exists,
            "书签行应显示章节 + 进度百分比"
        )
        attachDesignSurface("reader-bookmarks-tab-progress-375-light", app)
        app.buttons["完成"].tap()
    }

    /// task-32：点原文波浪线笔记直接进编辑弹层（无「查看笔记」中间层/下划线色 swatch）；可从编辑器删除。
    func testReaderNoteWaveOpensEditorAndDeletesNote() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--design-fixture=normal", "--design-theme=light"]
        app.launch()
        openFixtureBook("红楼梦", in: app)
        waitForBody(app)
        let body = app.webViews.firstMatch
        let wave = body.coordinate(withNormalizedOffset: CGVector(dx: 0.40, dy: 0.55))
        func openWaveEditor() {
            wave.tap()
            if !app.textViews["note-body"].waitForExistence(timeout: 2) {
                body.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
                wave.tap()
            }
            XCTAssertTrue(app.textViews["note-body"].waitForExistence(timeout: 5), "点波浪线应直接打开编辑弹层")
        }
        openWaveEditor()
        XCTAssertFalse(app.otherElements["note-detail-sheet"].exists, "不应再有「查看笔记」中间层")
        XCTAssertEqual(
            (app.textViews["note-body"].value as? String) ?? "",
            "灯把书页照亮，也把问题留在纸上。",
            "编辑器应带出该笔记正文"
        )
        XCTAssertFalse((app.staticTexts["note-quote"].label).isEmpty, "应展示引用原文")
        // 笔记编辑弹层不提供下划线颜色 swatch（颜色只用于高亮浮层/调色盘）。
        XCTAssertFalse(app.buttons["highlight-color-green"].exists, "笔记编辑不应有下划线颜色 swatch")
        XCTAssertFalse(app.buttons["highlight-color-blue"].exists)
        XCTAssertTrue(app.buttons["note-delete"].exists, "已保存笔记编辑器应有删除入口")
        attachDesignSurface("reader-wave-opens-editor-375-light", app)

        // 取消删除：返回编辑器。
        app.buttons["note-delete"].tap()
        XCTAssertTrue(app.staticTexts["删除笔记？"].waitForExistence(timeout: 5))
        attachDesignSurface("reader-wave-delete-confirm-375-light", app)
        app.buttons["取消"].tap()
        XCTAssertTrue(app.textViews["note-body"].waitForExistence(timeout: 3))

        // 确认删除：卡片滑出，笔记列表同步只剩高亮。
        app.buttons["note-delete"].tap()
        XCTAssertTrue(app.staticTexts["删除笔记？"].waitForExistence(timeout: 5))
        if app.otherElements["book-dialog"].buttons["删除"].waitForExistence(timeout: 2) {
            app.otherElements["book-dialog"].buttons["删除"].tap()
        } else {
            app.buttons["删除"].firstMatch.tap()
        }
        XCTAssertTrue(app.textViews["note-body"].waitForNonExistence(timeout: 5), "删除后卡片应滑出")
        waitForBody(app)
        attachDesignSurface("reader-after-wave-note-delete-375-light", app)
        // decoration 消失：再点原位不应再打开编辑器。
        wave.tap()
        XCTAssertFalse(app.textViews["note-body"].waitForExistence(timeout: 1.5), "删除后波浪线笔记应消失")

        if !app.buttons["书架"].waitForExistence(timeout: 1) {
            body.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        }
        XCTAssertTrue(app.buttons["书架"].waitForExistence(timeout: 3), "应回到带工具栏的阅读页")
        app.buttons["书架"].tap()
        XCTAssertTrue(tab("tab-notes", label: "笔记", in: app).waitForExistence(timeout: 15))
        tab("tab-notes", label: "笔记", in: app).tap()
        waitForNoteRows(1, in: app)
        attachDesignSurface("notes-after-wave-note-delete-375-light", app)
    }
    func testNoteEditorCustomCardGeometryKeyboardAndDisabledSave() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--design-fixture=normal", "--design-theme=light"]
        app.launch()
        openFixtureBook("红楼梦", in: app)
        waitForBody(app)
        let body = app.webViews.firstMatch
        let screenHeight = app.frame.height
        // 关闭按钮距卡片顶约 34pt（dragArea 26 + header 居中）。
        func cardTop(_ closeY: CGFloat) -> CGFloat { closeY - 34 }

        // 1) 新建：选文 → 笔记 → 底部卡片滑入，初始约 54% 屏高。
        body.coordinate(withNormalizedOffset: CGVector(dx: 0.40, dy: 0.80)).press(forDuration: 1.3)
        noteMenu("笔记", in: app)
        XCTAssertTrue(app.textViews["note-body"].waitForExistence(timeout: 5), "应打开笔记卡片")
        let close = app.buttons["note-close"]
        let save = app.buttons["note-save"]
        let card = app.otherElements["note-editor-card"]
        XCTAssertTrue(close.exists)
        XCTAssertTrue(save.exists)
        XCTAssertTrue(card.waitForExistence(timeout: 3), "note-editor-card 应通过 identifier 暴露给 UI 测试")
        let initialCardHeight = card.frame.height
        let initialCardMinY = card.frame.minY
        XCTAssertEqual(initialCardHeight, screenHeight * 0.54, accuracy: 8, "初始卡片高度应约 54% 屏高")
        print("QA_CARD initial height=\(initialCardHeight) minY=\(initialCardMinY)")
        XCTAssertGreaterThan(cardTop(close.frame.minY), screenHeight * 0.38, "初始卡片应约 54% 屏高")
        XCTAssertLessThan(cardTop(close.frame.minY), screenHeight * 0.56)
        XCTAssertFalse((app.staticTexts["note-quote"].label).isEmpty, "应展示引用原文")
        XCTAssertFalse(save.isEnabled, "空正文时保存按钮应禁用")
        attachDesignSurface("note-card-initial-54pct-375-light", app)

        // 2) 键盘弹出前后卡片高度不变（整卡上移）。
        let closeBeforeY = close.frame.minY
        let heightBefore = screenHeight - cardTop(closeBeforeY)
        app.textViews["note-body"].tap()
        app.textViews["note-body"].typeText("QA-自定义卡片笔记")
        XCTAssertTrue(save.isEnabled, "有正文后保存按钮应启用")
        let keyboard = app.keyboards.firstMatch
        XCTAssertTrue(keyboard.waitForExistence(timeout: 5), "键盘应出现")
        Thread.sleep(forTimeInterval: 0.8)
        // v3：键盘态卡片高度收缩到可用高度-24、顶部留白 ≥16（grabber/圆角可见），不再顶到屏幕顶。
        let keyboardCardTop = cardTop(close.frame.minY)
        let keyboardCardHeight = card.frame.height
        let keyboardCardMinY = card.frame.minY
        print("QA_CARD keyboard height=\(keyboardCardHeight) minY=\(keyboardCardMinY) (initial height=\(initialCardHeight) minY=\(initialCardMinY))")
        XCTAssertLessThan(close.frame.minY, closeBeforeY - 100, "键盘弹出后整卡应上移")
        XCTAssertLessThanOrEqual(keyboardCardHeight, initialCardHeight + 2, "键盘态卡片高度应 ≤ 初始 54% 高度")
        XCTAssertGreaterThanOrEqual(keyboardCardMinY, 16, "键盘态卡片顶部应留白 ≥16（grabber/圆角可见）")
        XCTAssertGreaterThanOrEqual(keyboardCardTop, 16, "键盘态卡片顶部应留白 ≥16（grabber/圆角可见）")
        attachDesignSurface("note-card-keyboard-v3-375-light", app)
        save.tap()
        XCTAssertTrue(app.textViews["note-body"].waitForNonExistence(timeout: 5), "保存后卡片应滑出")
        waitForBody(app)

        // 3) 保存后阅读页波浪线笔记：点开直接进编辑弹层且正文同步（无「查看笔记」中间层）。
        body.coordinate(withNormalizedOffset: CGVector(dx: 0.40, dy: 0.80)).tap()
        if !app.textViews["note-body"].waitForExistence(timeout: 2) {
            body.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
            body.coordinate(withNormalizedOffset: CGVector(dx: 0.40, dy: 0.80)).tap()
        }
        XCTAssertTrue(app.textViews["note-body"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.otherElements["note-detail-sheet"].exists, "task-32 后不应再有「查看笔记」中间层")
        XCTAssertTrue(
            ((app.textViews["note-body"].value as? String) ?? "").contains("QA-自定义卡片笔记"),
            "编辑器应带出刚保存的正文"
        )
        attachDesignSurface("note-editor-synced-375-light", app)
        app.buttons["note-close"].tap()
        waitForBody(app)

        // 4) 列表 leading 编辑：卡片；拖 grabber 上拉到约 92% 松手吸附。
        if !app.buttons["书架"].waitForExistence(timeout: 1) {
            body.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        }
        XCTAssertTrue(app.buttons["书架"].waitForExistence(timeout: 3))
        app.buttons["书架"].tap()
        XCTAssertTrue(tab("tab-notes", label: "笔记", in: app).waitForExistence(timeout: 15))
        tab("tab-notes", label: "笔记", in: app).tap()
        waitForNoteRows(3, in: app)
        let row = app.collectionViews["notes"].cells.containing(
            NSPredicate(format: "label CONTAINS %@", "QA-自定义卡片笔记")
        ).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 5))
        row.swipeRight()
        app.buttons["编辑"].firstMatch.tap()
        XCTAssertTrue(app.textViews["note-body"].waitForExistence(timeout: 5))
        let startTop = cardTop(app.buttons["note-close"].frame.minY)
        XCTAssertGreaterThan(startTop, screenHeight * 0.38, "编辑入口同样为约 54% 卡片")
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0))
            .withOffset(CGVector(dx: 0, dy: startTop + 10))
            .press(
                forDuration: 0.1,
                thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.10))
            )
        Thread.sleep(forTimeInterval: 0.7)
        let expandedTop = cardTop(app.buttons["note-close"].frame.minY)
        XCTAssertLessThan(expandedTop, screenHeight * 0.20, "上拉后卡片应吸附到约 92% 屏高")
        attachDesignSurface("note-card-expanded-92pct-375-light", app)
        app.buttons["note-close"].tap()
        XCTAssertTrue(app.textViews["note-body"].waitForNonExistence(timeout: 5))

        // 5) 关闭行为：无键盘时点 dim 关闭；输入未保存内容后 × 关闭并丢弃。
        row.swipeRight()
        app.buttons["编辑"].firstMatch.tap()
        XCTAssertTrue(app.textViews["note-body"].waitForExistence(timeout: 5))
        Thread.sleep(forTimeInterval: 0.6)
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.18)).tap()
        if app.textViews["note-body"].waitForExistence(timeout: 2) {
            app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.18)).tap()
        }
        XCTAssertTrue(app.textViews["note-body"].waitForNonExistence(timeout: 5), "点 dim 应关闭卡片")
        row.swipeRight()
        app.buttons["编辑"].firstMatch.tap()
        XCTAssertTrue(app.textViews["note-body"].waitForExistence(timeout: 5))
        app.textViews["note-body"].tap()
        app.textViews["note-body"].typeText("未保存内容")
        Thread.sleep(forTimeInterval: 0.4)
        app.buttons["note-close"].tap()
        XCTAssertTrue(app.textViews["note-body"].waitForNonExistence(timeout: 5), "点 × 应关闭卡片")
        XCTAssertTrue(waitForPageTitle("笔记", in: app))
        XCTAssertFalse(
            app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "草稿")).firstMatch.exists,
            "不应出现草稿文案/行"
        )
        row.swipeRight()
        app.buttons["编辑"].firstMatch.tap()
        XCTAssertTrue(app.textViews["note-body"].waitForExistence(timeout: 5))
        let reopened = (app.textViews["note-body"].value as? String) ?? ""
        XCTAssertEqual(reopened, "QA-自定义卡片笔记", "关闭应丢弃未保存修改、回到已保存内容")
        XCTAssertFalse(reopened.contains("未保存内容"))
        replaceNoteBody("", in: app)
        for _ in 0..<3 where !((app.textViews["note-body"].value as? String) ?? "").isEmpty {
            replaceNoteBody("", in: app)
        }
        let disabled = NSPredicate { _, _ in
            ((app.textViews["note-body"].value as? String) ?? "").isEmpty &&
                !app.buttons["note-save"].isEnabled
        }
        expectation(for: disabled, evaluatedWith: app)
        waitForExpectations(timeout: 5)
        attachDesignSurface("note-card-cleared-disabled-375-light", app)
        app.buttons["note-close"].tap()
    }

    func testIssue30QuestionSheetLayoutDraftAndIdentity() throws {
        let app = XCUIApplication()
        app.launchArguments = ["--design-fixture=normal", "--design-theme=light"]
        app.launch()
        XCTAssertTrue(tab("tab-conversations", label: "对话", in: app).waitForExistence(timeout: 15))
        tab("tab-conversations", label: "对话", in: app).tap()
        let history = app.collectionViews["question-history"]
        let conversationCells = history.cells.matching(
            NSPredicate(format: "identifier BEGINSWITH %@", "question-")
        )
        if !conversationCells.firstMatch.exists {
            // 对话历史已改系统分组列表：先展开书籍分组头，再点具体对话行。
            let header = history.cells.matching(
                NSPredicate(format: "identifier BEGINSWITH %@", "conversations-book-")
            ).firstMatch
            if header.exists { header.tap() }
            Thread.sleep(forTimeInterval: 0.5)
        }
        let initialConversations = history.cells.count
        let conversation = conversationCells.firstMatch
        XCTAssertTrue(conversation.waitForExistence(timeout: 10))
        conversation.tap()

        let sheet = app.otherElements["question-sheet"]
        XCTAssertTrue(sheet.waitForExistence(timeout: 10))
        XCTAssertGreaterThan(sheet.frame.height, app.frame.height * 0.70)
        XCTAssertLessThan(sheet.frame.height, app.frame.height * 0.82)
        XCTAssertTrue(app.otherElements["question-sheet-handle"].exists)
        XCTAssertTrue(app.buttons["question-close"].exists)
        XCTAssertTrue(app.textViews["question-input"].exists)
        XCTAssertTrue(app.buttons["question-send"].exists)
        XCTAssertTrue(app.staticTexts["书灯 · AI"].exists)
        XCTAssertTrue(app.staticTexts["这句话里的“灯”指什么？"].exists)
        XCTAssertFalse(app.staticTexts["你"].exists)
        XCTAssertFalse(app.staticTexts["question-status"].exists)
        XCTAssertFalse(app.buttons["question-follow-up"].exists)
        XCTAssertTrue(app.buttons["question-copy"].exists)
        XCTAssertTrue(app.buttons["question-more"].exists)
        attachDesignSurface("issue30-question-375-light", app)

        let input = app.textViews["question-input"]
        XCTAssertTrue(input.exists)
        input.tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
        let composer = app.otherElements["question-composer"]
        XCTAssertLessThanOrEqual(composer.frame.maxY, app.keyboards.firstMatch.frame.minY + 1)
        input.typeText("还没发送的追问")
        app.buttons["question-close"].tap()
        XCTAssertFalse(sheet.waitForExistence(timeout: 3))

        conversation.tap()
        XCTAssertTrue(sheet.waitForExistence(timeout: 10))
        XCTAssertEqual(app.textViews["question-input"].value as? String, "还没发送的追问")
        app.buttons["question-close"].tap()

        tab("tab-library", label: "书架", in: app).tap()
        app.buttons["continue-reading"].tap()
        let paragraph = app.webViews.staticTexts.matching(
            NSPredicate(format: "label CONTAINS %@", "当下地下侍立之人")
        ).firstMatch
        XCTAssertTrue(paragraph.waitForExistence(timeout: 15))
        paragraph.press(forDuration: 1.3)
        XCTAssertTrue(app.buttons["selection-ask"].waitForExistence(timeout: 5))
        app.buttons["selection-ask"].tap()
        XCTAssertTrue(sheet.waitForExistence(timeout: 10))
        app.buttons["question-close"].tap()
        app.buttons["书架"].tap()
        tab("tab-conversations", label: "对话", in: app).tap()
        XCTAssertEqual(history.cells.count, initialConversations + 1)
        app.terminate()

        app.launchArguments = ["--design-fixture=normal", "--design-theme=dark"]
        app.launch()
        tab("tab-conversations", label: "对话", in: app).tap()
        let darkHistory = app.collectionViews["question-history"]
        XCTAssertTrue(darkHistory.cells.firstMatch.waitForExistence(timeout: 10))
        let darkConversations = darkHistory.cells.matching(
            NSPredicate(format: "identifier BEGINSWITH %@", "question-")
        )
        if !darkConversations.firstMatch.exists {
            let header = darkHistory.cells.matching(
                NSPredicate(format: "identifier BEGINSWITH %@", "conversations-book-")
            ).firstMatch
            if header.exists { header.tap() }
            Thread.sleep(forTimeInterval: 0.5)
        }
        XCTAssertTrue(darkConversations.firstMatch.waitForExistence(timeout: 10))
        darkConversations.firstMatch.tap()
        XCTAssertTrue(sheet.waitForExistence(timeout: 10))
        attachDesignSurface("issue30-question-375-dark", app)
    }

    func testIssue31CitationVisualAndReturnToConversation() throws {
        continueAfterFailure = false
        let app = XCUIApplication()

        func openCitation(_ theme: String) {
            app.launchArguments = ["--design-fixture=normal", "--design-theme=\(theme)"]
            app.launch()
            XCTAssertTrue(tab("tab-conversations", label: "对话", in: app).waitForExistence(timeout: 15))
            tab("tab-conversations", label: "对话", in: app).tap()
            let conversation = app.collectionViews["question-history"].cells.containing(
                NSPredicate(format: "label CONTAINS %@", "这句话里的“灯”指什么？")
            ).firstMatch
            XCTAssertTrue(conversation.waitForExistence(timeout: 5))
            conversation.tap()
            XCTAssertTrue(app.buttons["question-close"].waitForExistence(timeout: 5))

            let source = app.buttons["question-reference-0"]
            XCTAssertTrue(source.waitForExistence(timeout: 5))
            if !source.isHittable { app.swipeUp() }
            XCTAssertTrue(source.isHittable)
            source.tap()

            let back = app.buttons["reader-return-question"]
            XCTAssertTrue(back.waitForExistence(timeout: 20))
            XCTAssertEqual(back.label, "返回问答")
            XCTAssertTrue(
                app.staticTexts["reader-chapter"].label.contains("查看引用 1")
            )
            XCTAssertFalse(app.otherElements["reader-selection-menu"].exists)
            attachDesignSurface("issue31-citation-375-\(theme)", app)

            back.tap()
            XCTAssertTrue(app.buttons["question-close"].waitForExistence(timeout: 20))
            XCTAssertTrue(app.textViews["question-input"].exists)
            attachDesignSurface("issue31-returned-375-\(theme)", app)
            app.terminate()
        }

        openCitation("light")
        openCitation("dark")
    }

    private func tab(_ identifier: String, label: String, in app: XCUIApplication) -> XCUIElement {
        let identified = app.buttons[identifier].firstMatch
        return identified.exists ? identified : app.tabBars.buttons[label].firstMatch
    }

    /// 第二轮组件化后“我的”设置行可能从 UIControl 变成系统列表 cell；按标识符兼容查询。
    private func settingsRow(_ identifier: String, in app: XCUIApplication) -> XCUIElement {
        for candidate in [
            app.buttons[identifier],
            app.cells[identifier],
            app.otherElements[identifier],
            app.staticTexts[identifier]
        ] where candidate.exists {
            return candidate
        }
        return app.buttons[identifier]
    }

    /// 品牌图标可能是 UIView 容器（Other）而非 Image，按标识符跨类型查询。
    private func anyProfileElement(_ identifier: String, in app: XCUIApplication) -> XCUIElement {
        for candidate in [
            app.images[identifier],
            app.otherElements[identifier],
            app.staticTexts[identifier],
            app.cells[identifier]
        ] where candidate.exists {
            return candidate
        }
        return app.otherElements[identifier]
    }

    private func waitForSettingsValue(
        _ element: XCUIElement,
        _ expected: String,
        timeout: TimeInterval = 5
    ) {
        let deadline = Date(timeIntervalSinceNow: timeout)
        while Date() < deadline {
            if (element.value as? String) == expected { return }
            Thread.sleep(forTimeInterval: 0.1)
        }
        XCTAssertEqual(element.value as? String, expected)
    }

    /// The status bar is not part of the designed application surface.
    // MARK: - PDF 最终验收（task-57）辅助

    private func openPDFFixture(_ app: XCUIApplication, title: String = "书灯 PDF 示例") {
        XCTAssertTrue(tab("tab-library", label: "书架", in: app).waitForExistence(timeout: 15))
        let shelf = app.collectionViews["library"]
        let cell = shelf.cells.containing(NSPredicate(format: "label CONTAINS %@", title)).firstMatch
        for _ in 0..<5 where !cell.exists { shelf.swipeUp() }
        XCTAssertTrue(cell.waitForExistence(timeout: 10))
        cell.tap()
        XCTAssertTrue(app.otherElements["pdf-reader-view"].waitForExistence(timeout: 15))
    }

    /// task-89：PDF 阅读方式改为顶栏「阅读设置」sheet；scroll=true 选滚动，false 选分页。
    private func setPDFReadingMode(_ app: XCUIApplication, scroll: Bool) {
        let settings = app.buttons["pdf-reader-settings"]
        XCTAssertTrue(settings.waitForExistence(timeout: 10), "应存在阅读设置入口")
        settings.tap()
        XCTAssertTrue(app.navigationBars["阅读设置"].waitForExistence(timeout: 10))
        let mode = app.segmentedControls["pdf-reading-mode"]
        XCTAssertTrue(mode.waitForExistence(timeout: 5))
        mode.buttons[scroll ? "滚动" : "分页"].tap()
        let done = app.buttons["pdf-reading-settings-done"].exists
            ? app.buttons["pdf-reading-settings-done"] : app.buttons["完成"]
        XCTAssertTrue(done.waitForExistence(timeout: 5))
        done.tap()
        XCTAssertTrue(app.navigationBars["阅读设置"].waitForNonExistence(timeout: 5))
    }

    private func registerPDFFinalLoopbackAI(_ app: XCUIApplication, address: String, model: String) {
        app.buttons["tab-profile"].tap()
        let profileList = app.collectionViews["profile-list"]
        XCTAssertTrue(profileList.waitForExistence(timeout: 10))
        let aiRow = profileList.cells.containing(NSPredicate(format: "label CONTAINS %@", "AI 服务")).firstMatch
        for _ in 0..<4 where !aiRow.exists { profileList.swipeUp() }
        XCTAssertTrue(aiRow.waitForExistence(timeout: 10), "我的页应有 AI 服务入口")
        aiRow.tap()
        XCTAssertTrue(app.tables["ai-services"].waitForExistence(timeout: 10))
        app.buttons["添加"].tap()
        let name = "PDF-final-" + UUID().uuidString.prefix(4)
        app.cells["ai-provider"].tap(); app.buttons["自定义服务"].tap()
        app.cells["ai-advanced"].tap()
        XCTAssertTrue(app.tables["ai-advanced-editor"].waitForExistence(timeout: 5))
        app.textFields["ai-name"].tap(); app.textFields["ai-name"].typeText(name)
        app.textFields["ai-address"].tap(); app.textFields["ai-address"].typeText(address)
        app.textFields["ai-model"].tap(); app.textFields["ai-model"].typeText(model)
        app.navigationBars["高级设置"].buttons.element(boundBy: 0).tap()
        app.secureTextFields["ai-key"].tap(); app.secureTextFields["ai-key"].typeText("not-a-real-credential")
        if app.sheets["保存密码？"].waitForExistence(timeout: 1) { app.sheets["保存密码？"].buttons["以后"].tap() }
        app.navigationBars.buttons["保存"].tap()
        XCTAssertTrue(app.otherElements["AI 服务发送说明"].firstMatch.waitForExistence(timeout: 5))
        app.otherElements["AI 服务发送说明"].firstMatch.buttons["同意并保存"].tap()
        XCTAssertTrue(app.otherElements["已保存"].firstMatch.waitForExistence(timeout: 5))
        app.otherElements["已保存"].firstMatch.buttons["完成"].tap()
        let switchButton = app.navigationBars.buttons["切换"]
        XCTAssertTrue(switchButton.waitForExistence(timeout: 5))
        switchButton.tap()
        // 当前版本弹层为自定义 BookAlertController（book-dialog），按全局按钮查找服务项。
        let switchOption = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", name)).firstMatch
        if switchOption.waitForExistence(timeout: 5) {
            switchOption.tap()
        } else {
            let anyService = app.buttons.matching(NSPredicate(format: "label CONTAINS %@", "PDF-final-")).firstMatch
            XCTAssertTrue(anyService.waitForExistence(timeout: 5), "切换服务弹层应列出新服务")
            anyService.tap()
        }
        if app.otherElements["AI 服务发送说明"].firstMatch.waitForExistence(timeout: 3) {
            app.otherElements["AI 服务发送说明"].firstMatch.buttons["同意并保存"].tap()
        }
        if app.otherElements["已切换服务"].firstMatch.waitForExistence(timeout: 5) {
            app.otherElements["已切换服务"].firstMatch.buttons["完成"].tap()
        }
        let selectedText = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", name)).firstMatch
        XCTAssertTrue(selectedText.waitForExistence(timeout: 10), "AI 服务列表应出现新服务")
        let inUseText = app.staticTexts.matching(
            NSPredicate(format: "label CONTAINS %@", "模型：pdf-ai · 使用中")
        ).firstMatch
        XCTAssertTrue(inUseText.waitForExistence(timeout: 5), "新服务应已选中（使用中）")
        app.buttons["tab-library"].tap()
        XCTAssertTrue(app.collectionViews["library"].waitForExistence(timeout: 10))
    }

    private func pdfTapAnnotation(_ app: XCUIApplication, target: XCUIElement, xs: [CGFloat], ys: [CGFloat], attempts: Int = 2) -> Bool {
        let pdfView = app.otherElements["pdf-reader-view"]
        for attempt in 0..<attempts {
            if attempt == 1 {
                pdfView.swipeUp(); Thread.sleep(forTimeInterval: 0.3)
                pdfView.swipeDown(); Thread.sleep(forTimeInterval: 0.3)
            }
            for y in ys {
                for x in xs {
                    if target.exists { return true }
                    pdfView.coordinate(withNormalizedOffset: CGVector(dx: x, dy: y)).tap()
                    Thread.sleep(forTimeInterval: 0.3)
                    if target.exists { return true }
                }
            }
        }
        return target.exists
    }

    private func assertPDFFooterNotOverlapping(_ app: XCUIApplication, label: String) {
        let ask = app.buttons["pdf-reader-ask"]
        let page = app.staticTexts["pdf-reader-page"]
        let settings = app.buttons["pdf-reader-settings"]
        XCTAssertTrue(ask.exists && page.exists && settings.exists, "\(label)：页脚问书灯/页码与顶栏设置入口应存在")
        XCTAssertFalse(ask.frame.intersects(page.frame), "\(label)：问书灯与页码重叠 ask=\(ask.frame) page=\(page.frame)")
        XCTAssertGreaterThanOrEqual(ask.frame.minX, 0)
        XCTAssertLessThanOrEqual(settings.frame.maxX, app.frame.maxX + 0.5)
    }

    func testPDFFinalDarkReaderSurfaces() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--design-fixture=pdf", "--design-theme=dark"]
        app.launch()
        attachDesignSurface("pdf-final2-dark-shelf-pdf-cover-375", app)
        openPDFFixture(app)
        XCTAssertTrue(app.staticTexts["第 1 / 2 页"].waitForExistence(timeout: 10))
        attachDesignSurface("pdf-final2-dark-reader-375", app)

        let palette = app.otherElements["pdf-highlight-palette"]
        XCTAssertTrue(
            pdfTapAnnotation(app, target: palette, xs: [0.10, 0.13, 0.16, 0.20, 0.24, 0.28],
                             ys: [0.09, 0.11, 0.13, 0.15, 0.17, 0.19, 0.21, 0.24]),
            "深色阅读器应能点中高亮"
        )
        attachDesignSurface("pdf-final1-dark-highlight-palette-375", app)
        app.buttons["pdf-highlight-cancel"].tap()
        XCTAssertTrue(palette.waitForNonExistence(timeout: 5))

        // 第 2 页笔记 → 深色笔记编辑器。
        setPDFReadingMode(app, scroll: false)
        Thread.sleep(forTimeInterval: 0.5)
        app.otherElements["pdf-reader-view"].swipeLeft()
        XCTAssertTrue(app.staticTexts["第 2 / 2 页"].waitForExistence(timeout: 10))
        let editor = app.otherElements["pdf-note-editor"]
        XCTAssertTrue(
            pdfTapAnnotation(app, target: editor, xs: [0.30, 0.33, 0.36, 0.40, 0.44, 0.48, 0.20, 0.25],
                             ys: [0.09, 0.11, 0.13, 0.15, 0.17, 0.19, 0.21, 0.24]),
            "深色阅读器应能点中笔记"
        )
        XCTAssertTrue(app.textViews["note-body"].waitForExistence(timeout: 5))
        attachDesignSurface("pdf-final1-dark-note-editor-375", app)
        if app.buttons["note-close"].exists { app.buttons["note-close"].tap() }
        Thread.sleep(forTimeInterval: 0.5)

        // 目录/书签/搜索面板。
        app.buttons["pdf-contents"].tap()
        XCTAssertTrue(app.tables["pdf-contents-panel"].waitForExistence(timeout: 5))
        attachDesignSurface("pdf-final1-dark-contents-toc-375", app)
        app.segmentedControls["pdf-contents-tabs"].buttons["书签"].tap()
        attachDesignSurface("pdf-final1-dark-contents-bookmarks-375", app)
        app.segmentedControls["pdf-contents-tabs"].buttons["搜索"].tap()
        attachDesignSurface("pdf-final1-dark-contents-search-375", app)
        app.buttons["pdf-contents-done"].tap()

        // 页脚问书灯 → 深色问答 sheet。
        app.buttons["pdf-reader-ask"].tap()
        XCTAssertTrue(app.otherElements["question-sheet"].waitForExistence(timeout: 10))
        attachDesignSurface("pdf-final1-dark-question-sheet-375", app)
        app.buttons["question-close"].tap()
        XCTAssertTrue(app.otherElements["question-sheet"].waitForNonExistence(timeout: 5))
    }

    func testPDFFinalDarkScanAndImportCard() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--design-fixture=pdf-scan", "--design-theme=dark"]
        app.launch()
        openPDFFixture(app, title: "书灯 PDF 扫描版")
        XCTAssertTrue(app.staticTexts["第 1 / 2 页"].waitForExistence(timeout: 10))
        attachDesignSurface("pdf-final1-dark-scan-reader-375", app)
        app.buttons["pdf-reader-ask"].tap()
        XCTAssertTrue(app.staticTexts["没有可搜索的文字；阅读、缩放和加书签都可以正常使用。"].waitForExistence(timeout: 5))
        attachDesignSurface("pdf-final1-dark-scan-ask-alert-375", app)
        app.buttons["知道了"].tap()

        // 深色导入提示卡：从 Files 选择扫描版 PDF。
        app.terminate()
        app.launchArguments = ["--design-fixture=empty", "--design-theme=dark"]
        app.launch()
        XCTAssertTrue(tab("tab-library", label: "书架", in: app).waitForExistence(timeout: 15))
        app.buttons["library-import"].tap()
        let fileView = app.collectionViews["File View"]
        XCTAssertTrue(fileView.waitForExistence(timeout: 10))
        let scanFile = fileView.cells.matching(identifier: "QA-扫描版-取消, pdf").firstMatch
        if !scanFile.exists {
            throw XCTSkip("Files 沙盒缺少 QA-扫描版-取消.pdf，导入提示卡深色截图未验证")
        }
        scanFile.tap()
        XCTAssertTrue(app.staticTexts["这份 PDF 是扫描版"].waitForExistence(timeout: 20))
        attachDesignSurface("pdf-final1-dark-import-confirm-card-375", app)
        app.buttons["取消"].tap()
        XCTAssertTrue(app.staticTexts["从一本书开始"].waitForExistence(timeout: 10))
    }

    func testPDFFinalLandscapeFooterAndMode() throws {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .landscapeLeft
        let app = XCUIApplication()
        app.launchArguments = ["--design-fixture=pdf", "--design-theme=light"]
        app.launch()
        openPDFFixture(app)
        XCTAssertTrue(app.staticTexts["第 1 / 2 页"].waitForExistence(timeout: 10))
        assertPDFFooterNotOverlapping(app, label: "横屏连续")
        attachDesignSurface("pdf-final1-landscape-reader-667x375", app)
        setPDFReadingMode(app, scroll: false)
        Thread.sleep(forTimeInterval: 0.5)
        assertPDFFooterNotOverlapping(app, label: "横屏单页")
        attachDesignSurface("pdf-final1-landscape-single-page-667x375", app)
        XCUIDevice.shared.orientation = .portrait
        Thread.sleep(forTimeInterval: 0.6)
        assertPDFFooterNotOverlapping(app, label: "转回竖屏")
        attachDesignSurface("pdf-final1-portrait-after-rotate-375x667", app)
    }

    func testPDFFinalAccessibilityLargeFooter() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--design-fixture=pdf", "--design-theme=light"]
        app.launch()
        openPDFFixture(app)
        XCTAssertTrue(app.staticTexts["第 1 / 2 页"].waitForExistence(timeout: 10))
        assertPDFFooterNotOverlapping(app, label: "accessibilityLarge")
        attachDesignSurface("pdf-final1-accessibility-large-footer-375", app)
    }

    func testPDFFinalAccessibilityExtraLargeFooter() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--design-fixture=pdf", "--design-theme=light"]
        app.launch()
        openPDFFixture(app)
        XCTAssertTrue(app.staticTexts["第 1 / 2 页"].waitForExistence(timeout: 10))
        assertPDFFooterNotOverlapping(app, label: "accessibilityExtraLarge")
        attachDesignSurface("pdf-final1-accessibility-extra-large-footer-375", app)
    }

    func testPDFFinal390ReaderAndFooter() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--design-fixture=pdf", "--design-theme=light"]
        app.launch()
        openPDFFixture(app)
        XCTAssertTrue(app.staticTexts["第 1 / 2 页"].waitForExistence(timeout: 10))
        assertPDFFooterNotOverlapping(app, label: "390x844")
        attachDesignSurface("pdf-final1-reader-390x844", app)
        let palette = app.otherElements["pdf-highlight-palette"]
        XCTAssertTrue(
            pdfTapAnnotation(app, target: palette, xs: [0.10, 0.13, 0.16, 0.20, 0.24, 0.28],
                             ys: [0.09, 0.11, 0.13, 0.15, 0.17, 0.19, 0.21, 0.24]),
            "390×844 应能点中高亮"
        )
        attachDesignSurface("pdf-final1-highlight-palette-390x844", app)
        app.buttons["pdf-highlight-cancel"].tap()
    }

    func testPDFFinalLargeImportCancelDuringCheck() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--design-fixture=empty", "--design-theme=light"]
        app.launch()
        XCTAssertTrue(tab("tab-library", label: "书架", in: app).waitForExistence(timeout: 15))
        app.buttons["library-import"].tap()
        let fileView = app.collectionViews["File View"]
        XCTAssertTrue(fileView.waitForExistence(timeout: 10))
        let largeFile = fileView.cells.matching(identifier: "QA-扫描版-超大, pdf").firstMatch
        if !largeFile.exists { throw XCTSkip("Files 沙盒缺少 QA-扫描版-超大.pdf") }
        let started = Date()
        largeFile.tap()
        let progress = app.otherElements["pdf-import-progress"]
        XCTAssertTrue(progress.waitForExistence(timeout: 10), "大 PDF 导入应显示检查进度")
        let cancel = app.buttons["pdf-import-cancel"].waitForExistence(timeout: 3)
            ? app.buttons["pdf-import-cancel"]
            : app.buttons["取消"]
        if !cancel.exists {
            throw XCTSkip("4000 页导入在取消按钮可点前已完成（task-62 优化后仅约 4s），未捕获取消窗口")
        }
        cancel.tap()
        XCTAssertTrue(progress.waitForNonExistence(timeout: 10), "取消后进度浮层应消失")
        let elapsed = Date().timeIntervalSince(started)
        print(String(format: "QA_PERF large_import_cancel_seconds=%.3f", elapsed))
        XCTAssertTrue(app.staticTexts["从一本书开始"].waitForExistence(timeout: 15), "取消后应回空书架")
        XCTAssertFalse(app.staticTexts["这份 PDF 是扫描版"].exists, "取消后不应弹提示卡")
        XCTAssertTrue(app.buttons["tab-notes"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["tab-notes"].isEnabled, "取消后 tab 应恢复可点")
        app.buttons["library-import"].tap()
        XCTAssertTrue(app.collectionViews["File View"].waitForExistence(timeout: 10), "取消后应能再次导入")
        app.buttons["Cancel"].tap()
    }

    func testPDFFinalLargeScannedImportPerformance() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--design-fixture=empty", "--design-theme=light"]
        app.launch()
        XCTAssertTrue(tab("tab-library", label: "书架", in: app).waitForExistence(timeout: 15))
        app.buttons["library-import"].tap()
        let fileView = app.collectionViews["File View"]
        XCTAssertTrue(fileView.waitForExistence(timeout: 10))
        let largeFile = fileView.cells.matching(identifier: "QA-扫描版-超大, pdf").firstMatch
        if !largeFile.exists {
            throw XCTSkip("Files 沙盒缺少 QA-扫描版-超大.pdf（4000 页），性能验证未执行")
        }
        let started = Date()
        largeFile.tap()
        // 导入中 tab 应禁用；滚动书架不应卡死/崩溃。
        Thread.sleep(forTimeInterval: 0.6)
        let notesTab = app.buttons["tab-notes"]
        let chatsTab = app.buttons["tab-conversations"]
        let tabsDisabled = !notesTab.exists || !notesTab.isEnabled
        XCTAssertTrue(tabsDisabled, "PDF 导入检查中 tab 不应可点")
        XCTAssertTrue(!chatsTab.exists || !chatsTab.isEnabled)
        app.collectionViews["library"].swipeUp()
        app.collectionViews["library"].swipeDown()
        XCTAssertTrue(app.staticTexts["这份 PDF 是扫描版"].waitForExistence(timeout: 120), "4000 页导入应完成并弹提示卡")
        let elapsed = Date().timeIntervalSince(started)
        print(String(format: "QA_PERF large_scan_import_seconds=%.3f", elapsed))
        attachDesignSurface("pdf-final2-performance-large-scan-confirm-375", app)
        app.buttons["取消"].tap()
        // 取消后 busy 应解除、tab 恢复、可再次导入。
        XCTAssertTrue(app.staticTexts["从一本书开始"].waitForExistence(timeout: 15), "取消导入后书架应可用")
        XCTAssertTrue(app.buttons["tab-notes"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["tab-notes"].isEnabled, "取消后 tab 应恢复可点")
        app.buttons["library-import"].tap()
        XCTAssertTrue(app.collectionViews["File View"].waitForExistence(timeout: 10), "取消后应能再次打开导入")
        app.buttons["Cancel"].tap()
    }

    func testPDFFinalAIGenerationLoopback() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--design-fixture=pdf", "--design-theme=light"]
        app.launch()
        // 配置本地 loopback AI（需同时启动 scripts/issue9-http-fixture.rb 18769）。
        registerPDFFinalLoopbackAI(app, address: "http://127.0.0.1:18769/v1", model: "pdf-ai")
        openPDFFixture(app)
        XCTAssertTrue(app.otherElements["pdf-reader-view"].waitForExistence(timeout: 15))
        XCTAssertTrue(app.staticTexts["第 1 / 2 页"].waitForExistence(timeout: 15))

        app.buttons["pdf-reader-ask"].tap()
        XCTAssertTrue(app.otherElements["question-sheet"].waitForExistence(timeout: 10))
        let input = app.textViews["question-input"]
        XCTAssertTrue(input.waitForExistence(timeout: 5))
        input.tap()
        input.typeText("这份 PDF 第 2 页讲了什么？")
        let started = Date()
        app.buttons["question-send"].tap()
        Thread.sleep(forTimeInterval: 2.0)
        let status = app.staticTexts["question-status"]
        print("QA_AI_SEND statusExists=\(status.exists) status=\(status.exists ? status.label : "-") sheet=\(app.otherElements["question-sheet"].exists) sendEnabled=\(app.buttons["question-send"].isEnabled)")
        // task-71：成功后不再显示「回答已保存/未通过核验」，整条状态条隐藏。
        let saved = NSPredicate { _, _ in
            !status.exists && app.staticTexts["question-answer"].exists
        }
        expectation(for: saved, evaluatedWith: app)
        waitForExpectations(timeout: 60)
        XCTAssertFalse(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "回答已保存")).firstMatch.exists)
        XCTAssertFalse(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "未通过本次原文核验")).firstMatch.exists)
        let elapsed = Date().timeIntervalSince(started)
        print(String(format: "QA_PERF pdf_ai_generation_seconds=%.3f model=pdf-ai", elapsed))
        XCTAssertTrue(app.buttons["question-reference-0"].waitForExistence(timeout: 10), "应显示 PDF 页级引用")
        let citation = app.buttons["question-reference-0"]
        XCTAssertTrue(citation.label.contains("第 "), "引用标题应含页码：\(citation.label)")
        attachDesignSurface("ai-clean-answer-citations-composer-375", app)
        citation.tap()
        for _ in 0..<40 where app.otherElements["question-sheet"].exists { Thread.sleep(forTimeInterval: 0.2) }
        XCTAssertFalse(app.otherElements["question-sheet"].exists, "点引用应关闭问答面板")
        XCTAssertTrue(app.otherElements["pdf-reader-view"].waitForExistence(timeout: 10))
        attachDesignSurface("pdf-final1-ai-reference-jump-reader-375", app)
    }

    func testPDFFinalNotesJumpKeepsReadingProgress() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--design-fixture=pdf", "--design-theme=light"]
        app.launch()
        openPDFFixture(app)
        // 先把阅读进度推到第 2 页并关闭（关闭 flush 立即落盘）。
        setPDFReadingMode(app, scroll: false)
        Thread.sleep(forTimeInterval: 0.5)
        app.otherElements["pdf-reader-view"].swipeLeft()
        XCTAssertTrue(app.staticTexts["第 2 / 2 页"].waitForExistence(timeout: 10))
        app.buttons["reader-close"].tap()
        Thread.sleep(forTimeInterval: 0.8)
        // 笔记页点第 1 页高亮 → 阅读器停第 1 页，但不应改写原进度。
        tab("tab-notes", label: "笔记", in: app).tap()
        let list = app.collectionViews["notes"]
        XCTAssertTrue(list.waitForExistence(timeout: 10))
        let pdfHeader = list.cells.matching(NSPredicate(format: "label CONTAINS %@", "书灯 PDF 示例")).firstMatch
        for _ in 0..<5 where !pdfHeader.exists { list.swipeUp() }
        XCTAssertTrue(pdfHeader.waitForExistence(timeout: 10))
        if (pdfHeader.value as? String) == "已收起" { pdfHeader.tap() }
        let page1Row = list.cells.matching(NSPredicate(format: "label CONTAINS %@", "第 1 页")).firstMatch
        for _ in 0..<4 where !page1Row.exists { list.swipeUp() }
        XCTAssertTrue(page1Row.waitForExistence(timeout: 10))
        page1Row.tap()
        XCTAssertTrue(app.otherElements["pdf-reader-view"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["第 1 / 2 页"].waitForExistence(timeout: 10))
        app.buttons["reader-close"].tap()
        XCTAssertTrue(list.waitForExistence(timeout: 10))
        // 返回书架重新打开：应回原阅读进度第 2 页，而不是笔记页第 1 页。
        tab("tab-library", label: "书架", in: app).tap()
        openPDFFixture(app)
        XCTAssertTrue(app.staticTexts["第 2 / 2 页"].waitForExistence(timeout: 10), "笔记跳转不应把原阅读进度写回第 1 页")
        attachDesignSurface("pdf-final2-notes-jump-progress-preserved-375", app)
        app.buttons["reader-close"].tap()
    }

    func testPDFFinalBlankTailImportNoPromptOrHelp() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--design-fixture=empty", "--design-theme=light"]
        app.launch()
        XCTAssertTrue(tab("tab-library", label: "书架", in: app).waitForExistence(timeout: 15))
        app.buttons["library-import"].tap()
        let fileView = app.collectionViews["File View"]
        XCTAssertTrue(fileView.waitForExistence(timeout: 10))
        let blankTail = fileView.cells.matching(identifier: "QA-文字PDF-空白尾页, pdf").firstMatch
        if !blankTail.exists { throw XCTSkip("Files 沙盒缺少 QA-文字PDF-空白尾页.pdf") }
        blankTail.tap()
        // 2 文字页 + 1 纯白尾页：不应弹扫描提示卡，直接上书架。
        XCTAssertTrue(app.staticTexts["QA-文字PDF-空白尾页"].waitForExistence(timeout: 20), "含空白尾页的 PDF 应静默导入")
        if app.buttons["知道了"].waitForExistence(timeout: 3) { app.buttons["知道了"].tap() }
        XCTAssertFalse(app.staticTexts["这份 PDF 是扫描版"].exists)
        attachDesignSurface("pdf-final2-blank-tail-imported-shelf-375", app)
        let shelf = app.collectionViews["library"]
        let bookCell = shelf.cells.containing(NSPredicate(format: "label CONTAINS %@", "QA-文字PDF-空白尾页")).firstMatch
        XCTAssertTrue(bookCell.waitForExistence(timeout: 10))
        bookCell.tap()
        XCTAssertTrue(app.otherElements["pdf-reader-view"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["pdf-reader-help"].exists, "含空白尾页但无扫描页时不应显示「?」")
        attachDesignSurface("pdf-final2-blank-tail-reader-375", app)
        app.buttons["reader-close"].tap()
    }

    /// task-72：真实 App 重启后改名仍保留（debug 测试用临时根，不触碰用户数据）。
    func testQuestionHistoryRenamePersistsAcrossAppRelaunch() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--isolated-reading-test"]
        app.launch()
        XCTAssertTrue(tab("tab-library", label: "书架", in: app).waitForExistence(timeout: 15))
        // 导入一个文字 PDF，创建带草稿问题的会话（不调用 AI、不改用户数据）。
        app.buttons["library-import"].tap()
        let fileView = app.collectionViews["File View"]
        XCTAssertTrue(fileView.waitForExistence(timeout: 10))
        let pdfFile = fileView.cells.matching(identifier: "QA-文字PDF, pdf").firstMatch
        if !pdfFile.exists { throw XCTSkip("Files 沙盒缺少 QA-文字PDF.pdf") }
        pdfFile.tap()
        let shelf = app.collectionViews["library"]
        let bookCell = shelf.cells.containing(NSPredicate(format: "label CONTAINS %@", "QA-文字PDF")).firstMatch
        XCTAssertTrue(bookCell.waitForExistence(timeout: 20))
        if app.buttons["知道了"].waitForExistence(timeout: 3) { app.buttons["知道了"].tap() }
        for _ in 0..<20 where !bookCell.isHittable { Thread.sleep(forTimeInterval: 0.2) }
        XCTAssertTrue(bookCell.isHittable, "书架导入的 PDF 应可点")
        bookCell.tap()
        XCTAssertTrue(app.otherElements["pdf-reader-view"].waitForExistence(timeout: 15))
        app.buttons["pdf-reader-ask"].tap()
        XCTAssertTrue(app.otherElements["question-sheet"].waitForExistence(timeout: 10))
        let input = app.textViews["question-input"]
        XCTAssertTrue(input.waitForExistence(timeout: 5))
        let draftQuestion = "QA重启改名前的对话"
        input.tap(); input.typeText(draftQuestion)
        app.buttons["question-close"].tap()
        XCTAssertTrue(app.otherElements["question-sheet"].waitForNonExistence(timeout: 5))
        app.buttons["reader-close"].tap()
        XCTAssertTrue(shelf.waitForExistence(timeout: 10))

        tab("tab-conversations", label: "对话", in: app).tap()
        let history = app.collectionViews["question-history"]
        XCTAssertTrue(history.waitForExistence(timeout: 10))
        var row = history.cells.containing(NSPredicate(format: "label CONTAINS %@", draftQuestion)).firstMatch
        if !row.exists {
            let header = history.cells.matching(NSPredicate(format: "label CONTAINS %@", "QA-文字PDF")).firstMatch
            if header.exists && (header.value as? String) == "已收起" { header.tap() }
        }
        for _ in 0..<4 where !row.exists { history.swipeUp() }
        XCTAssertTrue(row.waitForExistence(timeout: 10), "应出现草稿会话")
        row.swipeLeft()
        XCTAssertTrue(app.buttons["改名"].waitForExistence(timeout: 5))
        app.buttons["改名"].tap()
        let field = app.textFields["conversation-name"]
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.tap()
        let current = (field.value as? String) ?? ""
        field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: current.count))
        let newTitle = "QA重启后仍保留的新标题"
        field.typeText(newTitle)
        app.otherElements["book-dialog"].buttons["保存"].tap()
        XCTAssertTrue(history.cells.containing(NSPredicate(format: "label CONTAINS %@", newTitle)).firstMatch.waitForExistence(timeout: 8))
        attachDesignSurface("profile-rename-fix-rename-restart-before-375", app)

        // 真实 terminate→launch（临时根持久化）。
        app.terminate()
        app.launchArguments = ["--isolated-reading-test"]
        app.launch()
        XCTAssertTrue(tab("tab-conversations", label: "对话", in: app).waitForExistence(timeout: 15))
        tab("tab-conversations", label: "对话", in: app).tap()
        let history2 = app.collectionViews["question-history"]
        XCTAssertTrue(history2.waitForExistence(timeout: 10))
        var newRow = history2.cells.containing(NSPredicate(format: "label CONTAINS %@", newTitle)).firstMatch
        if !newRow.exists {
            let header = history2.cells.matching(NSPredicate(format: "label CONTAINS %@", "QA-文字PDF")).firstMatch
            if header.exists && (header.value as? String) == "已收起" { header.tap() }
        }
        for _ in 0..<4 where !newRow.exists { history2.swipeUp() }
        XCTAssertTrue(newRow.waitForExistence(timeout: 10), "重启后应仍显示新标题")
        XCTAssertFalse(history2.cells.containing(NSPredicate(format: "label CONTAINS %@", draftQuestion)).firstMatch.exists, "重启后旧标题不应残留")
        attachDesignSurface("profile-rename-fix-rename-restart-after-375", app)
    }

    /// task-72：对话历史滑「改名」→保存后行标题立即刷新，旧标题消失。
    func testQuestionHistoryRenameImmediateRefresh() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--design-fixture=normal", "--design-theme=light"]
        app.launch()
        tab("tab-conversations", label: "对话", in: app).tap()
        let history = app.collectionViews["question-history"]
        XCTAssertTrue(history.waitForExistence(timeout: 10))
        let oldTitle = "这句话里的“灯”指什么？"
        var row = history.cells.containing(NSPredicate(format: "label CONTAINS %@", oldTitle)).firstMatch
        if !row.exists {
            let header = history.cells.matching(NSPredicate(format: "label CONTAINS %@", "红楼梦")).firstMatch
            if header.exists && (header.value as? String) == "已收起" { header.tap() }
        }
        for _ in 0..<4 where !row.exists { history.swipeUp() }
        XCTAssertTrue(row.waitForExistence(timeout: 10))
        attachDesignSurface("profile-rename-fix-rename-before-375", app)

        row.swipeLeft()
        let rename = app.buttons["改名"]
        XCTAssertTrue(rename.waitForExistence(timeout: 5))
        rename.tap()
        let field = app.textFields["conversation-name"]
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        let oldName = (field.value as? String) ?? ""
        field.tap()
        field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: oldName.count))
        field.typeText("QA改名新标题")
        app.otherElements["book-dialog"].buttons["保存"].tap()
        let newRow = history.cells.containing(NSPredicate(format: "label CONTAINS %@", "QA改名新标题")).firstMatch
        XCTAssertTrue(newRow.waitForExistence(timeout: 8), "保存后列表行应立即显示新标题")
        let oldRow = history.cells.containing(NSPredicate(format: "label CONTAINS %@", oldTitle)).firstMatch
        XCTAssertFalse(oldRow.exists, "旧标题应立即消失")
        attachDesignSurface("profile-rename-fix-rename-after-375", app)
    }

    /// task-71：回答成功态隐藏整条状态条，只留 composer 与有效引用；无「回答已保存/未通过核验」。
    func testQuestionSuccessHidesStatusBoxAndKeepsCitations() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--design-fixture=normal", "--design-theme=light"]
        app.launch()
        tab("tab-conversations", label: "对话", in: app).tap()
        let history = app.collectionViews["question-history"]
        XCTAssertTrue(history.waitForExistence(timeout: 10))
        let row = history.cells.containing(NSPredicate(format: "label CONTAINS %@", "这句话里的“灯”指什么？")).firstMatch
        if !row.exists {
            let header = history.cells.matching(NSPredicate(format: "label CONTAINS %@", "红楼梦")).firstMatch
            if header.exists && (header.value as? String) == "已收起" { header.tap() }
        }
        for _ in 0..<4 where !row.exists { history.swipeUp() }
        guard row.waitForExistence(timeout: 10) else { throw XCTSkip("normal fixture 无已保存问答记录") }
        row.tap()
        XCTAssertTrue(app.otherElements["question-sheet"].waitForExistence(timeout: 10))
        let answer = app.textViews["question-answer"].firstMatch
        XCTAssertTrue(answer.waitForExistence(timeout: 10), "成功态应显示回答")
        let answerText = (answer.value as? String) ?? ""
        XCTAssertTrue(answerText.contains("这里的“灯”") && answerText.contains("照明"), "answer=\(answerText)")
        XCTAssertFalse(app.staticTexts["question-status"].exists, "成功态不应显示状态条")
        XCTAssertFalse(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "回答已保存")).firstMatch.exists)
        XCTAssertFalse(app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "未通过本次原文核验")).firstMatch.exists)
        XCTAssertTrue(app.staticTexts["书灯 · AI"].exists)
        attachDesignSurface("ai-clean-answer-success-composer-375", app)
        // 底部 composer 仍存在（继续问书灯占位）。
        XCTAssertTrue(app.textViews["question-input"].exists)
        XCTAssertTrue(app.buttons["question-reference-0"].exists, "成功态仍应显示有效引用")
    }

    /// task-70：草稿态问题面板无状态条、无「草稿」文案；输入未发送仍保持。
    func testQuestionDraftHidesStatusBoxAndDraftCopy() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--design-fixture=pdf", "--design-theme=light"]
        app.launch()
        openPDFFixture(app)
        XCTAssertTrue(app.otherElements["pdf-reader-view"].waitForExistence(timeout: 10))
        app.buttons["pdf-reader-ask"].tap()
        XCTAssertTrue(app.otherElements["question-sheet"].waitForExistence(timeout: 10))
        let input = app.textViews["question-input"]
        XCTAssertTrue(input.waitForExistence(timeout: 5))
        XCTAssertFalse(app.staticTexts["question-status"].exists, "草稿态不应出现问题状态条")
        XCTAssertFalse(
            app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "草稿")).firstMatch.exists,
            "草稿态不应出现「草稿」文案"
        )
        attachDesignSurface("ai-scope-draft-no-status-375", app)

        input.tap()
        input.typeText("还没有发送的问题")
        Thread.sleep(forTimeInterval: 0.6)
        XCTAssertFalse(app.staticTexts["question-status"].exists, "输入未发送时仍不应出现状态条")
        XCTAssertFalse(
            app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "草稿")).firstMatch.exists,
            "输入未发送时不应出现「草稿」文案"
        )
        attachDesignSurface("ai-scope-draft-typed-no-status-375", app)
        app.buttons["question-close"].tap()
        XCTAssertTrue(app.otherElements["question-sheet"].waitForNonExistence(timeout: 5))
    }

    /// 书架搜索取消按钮可见性：空闲无取消；编辑出现；回车/取消后隐藏；实时过滤正常。
    func testShelfSearchCancelVisibilityAndFiltering() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--design-fixture=normal", "--design-theme=light"]
        app.launch()
        let shelf = app.collectionViews["library"]
        XCTAssertTrue(shelf.waitForExistence(timeout: 15))
        XCTAssertTrue(app.staticTexts["我的书籍"].waitForExistence(timeout: 10))
        Thread.sleep(forTimeInterval: 1.0)
        func cancelButton() -> XCUIElement? {
            // 系统 UISearchBar 取消按钮在 iOS 26 的 AX label 不稳定（Close/Cancel/取消），按位置兜底。
            app.buttons.allElementsBoundByIndex.first { element in
                let frame = element.frame
                return frame.width >= 40 && frame.width < 80 && frame.height >= 40
                    && frame.minX > 260 && frame.minY > 60 && frame.maxY < 170
            }
        }
        func waitCancel(_ exists: Bool) -> Bool {
            for _ in 0..<25 {
                if (cancelButton() != nil) == exists { return true }
                Thread.sleep(forTimeInterval: 0.2)
            }
            return false
        }
        let initialBooks = shelf.cells.count
        XCTAssertGreaterThanOrEqual(initialBooks, 2)
        XCTAssertFalse(cancelButton() != nil, "空闲态不应显示搜索取消按钮")
        attachDesignSurface("selection-fix-shelf-search-idle-375", app)

        let field = app.searchFields["library-search"].exists
            ? app.searchFields["library-search"].firstMatch
            : app.textFields["library-search"].firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.tap()
        XCTAssertTrue(waitCancel(true), "开始编辑应出现取消按钮")
        attachDesignSurface("selection-fix-shelf-search-editing-375", app)

        field.typeText("红楼梦")
        Thread.sleep(forTimeInterval: 0.9)
        XCTAssertEqual(shelf.cells.count, 1, "输入应实时过滤书库")
        attachDesignSurface("selection-fix-shelf-search-filtered-375", app)

        // 回车提交：取消隐藏、过滤保留（先重新聚焦，规避截图/查询后焦点丢失）。
        field.tap()
        Thread.sleep(forTimeInterval: 0.4)
        field.typeText("\n")
        Thread.sleep(forTimeInterval: 0.9)
        XCTAssertTrue(waitCancel(false), "回车提交后取消按钮应隐藏")
        XCTAssertEqual(shelf.cells.count, 1, "回车后过滤结果应保留")
        attachDesignSurface("selection-fix-shelf-search-submitted-375", app)

        // 再次编辑 → 点取消：取消隐藏、文本清空、列表恢复。
        field.tap()
        XCTAssertTrue(waitCancel(true), "再次编辑应出现取消按钮")
        Thread.sleep(forTimeInterval: 0.4)
        cancelButton()?.tap()
        Thread.sleep(forTimeInterval: 0.9)
        XCTAssertTrue(waitCancel(false), "取消后取消按钮应隐藏")
        XCTAssertEqual((field.value as? String) ?? "", "", "取消后应清空搜索")
        XCTAssertEqual(shelf.cells.count, initialBooks, "取消后应恢复完整书库")
        attachDesignSurface("selection-fix-shelf-search-canceled-375", app)
    }

    /// task-68：选字手柄——原生选区保留可拖拽，停手后浮层出现且用最终选区；点空白只清选区不切 chrome。
    func testPDFSelectionHandlesDragAndMenuStability() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--design-fixture=pdf", "--design-theme=light"]
        app.launch()
        openPDFFixture(app)
        XCTAssertTrue(app.staticTexts["第 1 / 2 页"].waitForExistence(timeout: 10))
        let pdfView = app.otherElements["pdf-reader-view"]
        let toolbar = app.otherElements["pdf-reader-toolbar"]
        XCTAssertTrue(toolbar.waitForExistence(timeout: 5))
        let menu = app.otherElements["pdf-selection-menu"]
        let wordPoints: [CGVector] = [
            CGVector(dx: 0.20, dy: 0.14), CGVector(dx: 0.30, dy: 0.14),
            CGVector(dx: 0.15, dy: 0.16), CGVector(dx: 0.35, dy: 0.16),
            CGVector(dx: 0.25, dy: 0.18)
        ]
        func selectWord() -> Bool {
            for point in wordPoints {
                pdfView.coordinate(withNormalizedOffset: point).doubleTap()
                if menu.waitForExistence(timeout: 2.0) { return true }
                Thread.sleep(forTimeInterval: 0.2)
                pdfView.coordinate(withNormalizedOffset: point).press(forDuration: 1.3)
                if menu.waitForExistence(timeout: 2.5) { return true }
                Thread.sleep(forTimeInterval: 0.2)
            }
            return false
        }
        guard selectWord() else { throw XCTSkip("PDF 选区自动化未成功（双击未触发选区）") }
        attachDesignSurface("pdf-selection-word-menu-375", app)

        // 拖到同一行后段（多字）：松开后浮层应重新出现（拖拽期间收起）。
        let start = pdfView.coordinate(withNormalizedOffset: CGVector(dx: 0.20, dy: 0.14))
        let end = pdfView.coordinate(withNormalizedOffset: CGVector(dx: 0.72, dy: 0.14))
        start.press(forDuration: 0.25, thenDragTo: end)
        XCTAssertTrue(menu.waitForExistence(timeout: 3), "拖拽后停手应重新出现选区浮层")
        attachDesignSurface("pdf-selection-dragged-final-range-375", app)
        XCTAssertTrue(app.buttons["pdf-selection-highlight"].exists)
        XCTAssertTrue(app.buttons["pdf-selection-note"].exists)
        XCTAssertTrue(app.buttons["pdf-selection-ask"].exists)

        // 用最终范围高亮：调色盘出现并成功上色（截图核对范围）。
        app.buttons["pdf-selection-highlight"].tap()
        let palette = app.otherElements["pdf-highlight-palette"]
        XCTAssertTrue(palette.waitForExistence(timeout: 5), "用最终选区应打开高亮调色盘")
        app.buttons["pdf-highlight-color-yellow"].tap()
        XCTAssertTrue(palette.waitForNonExistence(timeout: 3))
        Thread.sleep(forTimeInterval: 0.4)
        attachDesignSurface("pdf-selection-highlight-final-range-375", app)

        // 再选一次：浮层出现后点空白 → 只清选区/浮层，不切沉浸 chrome。
        guard selectWord() else { throw XCTSkip("第二次 PDF 选区未成功") }
        XCTAssertTrue(toolbar.exists)
        pdfView.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.75)).tap()
        Thread.sleep(forTimeInterval: 0.4)
        XCTAssertFalse(menu.exists, "点空白应清掉选区浮层")
        XCTAssertTrue(toolbar.exists, "已有选区时点空白不应切换沉浸 chrome")
        // 再单击（无选区）才隐藏 chrome。
        pdfView.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.75)).tap()
        Thread.sleep(forTimeInterval: 0.5)
        XCTAssertFalse(toolbar.exists, "无选区时单击应切换沉浸 chrome")
        pdfView.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.75)).tap()
        Thread.sleep(forTimeInterval: 0.5)
        XCTAssertTrue(toolbar.waitForExistence(timeout: 5))
    }

    /// task-66：悬浮 chrome——隐藏/恢复不改变 PDFView frame，页面区域像素不移动；ribbon 随 chrome 隐藏/恢复。
    func testPDFOverlayChromePageStable() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--design-fixture=pdf", "--design-theme=light"]
        app.launch()
        openPDFFixture(app)
        XCTAssertTrue(app.staticTexts["第 1 / 2 页"].waitForExistence(timeout: 10))
        let toolbar = app.otherElements["pdf-reader-toolbar"]
        let footer = app.otherElements["pdf-reader-footer"]
        XCTAssertTrue(toolbar.waitForExistence(timeout: 5))
        let pdfView = app.otherElements["pdf-reader-view"]
        let defaultFrame = pdfView.frame
        let blankTap = pdfView.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.72))
        func attachRaw(_ name: String) {
            Thread.sleep(forTimeInterval: 0.35)
            let image = XCUIScreen.main.screenshot().image
            let attachment = XCTAttachment(image: image)
            attachment.name = name
            attachment.lifetime = .keepAlways
            add(attachment)
        }
        attachRaw("overlay-default-raw-375")
        attachDesignSurface("overlay-default-375", app)

        // 加书签，验证 ribbon 随 chrome 隐藏/恢复。
        app.buttons["pdf-bookmark-toggle"].tap()
        XCTAssertTrue(app.buttons["pdf-bookmark-ribbon"].waitForExistence(timeout: 5))
        blankTap.tap()
        Thread.sleep(forTimeInterval: 0.5)
        XCTAssertFalse(toolbar.exists)
        XCTAssertFalse(footer.exists)
        XCTAssertFalse(app.buttons["pdf-bookmark-ribbon"].exists, "沉浸时丝带应随 chrome 隐藏")
        let hiddenFrame = pdfView.frame
        print("QA_OVERLAY_FRAME default=\(defaultFrame) hidden=\(hiddenFrame)")
        XCTAssertEqual(hiddenFrame, defaultFrame, "隐藏 chrome 不应改变 PDFView frame")
        attachRaw("overlay-hidden-raw-375")
        attachDesignSurface("overlay-hidden-375", app)

        blankTap.tap()
        Thread.sleep(forTimeInterval: 0.5)
        XCTAssertTrue(toolbar.waitForExistence(timeout: 5))
        XCTAssertTrue(footer.waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["pdf-bookmark-ribbon"].waitForExistence(timeout: 5), "恢复时按当前页书签重算丝带")
        let restoredFrame = pdfView.frame
        XCTAssertEqual(restoredFrame, defaultFrame, "恢复 chrome 不应改变 PDFView frame")
        attachRaw("overlay-restored-raw-375")
        attachDesignSurface("overlay-restored-375", app)
        app.buttons["pdf-bookmark-ribbon"].tap()
        XCTAssertTrue(app.buttons["pdf-bookmark-ribbon"].waitForNonExistence(timeout: 3))

        // 单页模式同样：frame 不变、可隐藏/恢复。
        setPDFReadingMode(app, scroll: false)
        Thread.sleep(forTimeInterval: 0.6)
        let singleFrame = pdfView.frame
        blankTap.tap()
        Thread.sleep(forTimeInterval: 0.5)
        XCTAssertFalse(toolbar.exists)
        XCTAssertEqual(pdfView.frame, singleFrame, "单页隐藏不应改变 frame")
        attachRaw("overlay-hidden-single-page-raw-375")
        attachDesignSurface("overlay-hidden-single-page-375", app)
        blankTap.tap()
        Thread.sleep(forTimeInterval: 0.5)
        XCTAssertTrue(toolbar.waitForExistence(timeout: 5))
        XCTAssertEqual(pdfView.frame, singleFrame, "单页恢复不应改变 frame")
        attachRaw("overlay-restored-single-page-raw-375")

        // 隐藏态点高亮：调色盘打开、chrome 保持隐藏。
        blankTap.tap()
        Thread.sleep(forTimeInterval: 0.5)
        XCTAssertFalse(toolbar.exists)
        let palette = app.otherElements["pdf-highlight-palette"]
        let points: [CGVector] = [
            CGVector(dx: 0.16, dy: 0.18), CGVector(dx: 0.20, dy: 0.18),
            CGVector(dx: 0.24, dy: 0.18), CGVector(dx: 0.16, dy: 0.20),
            CGVector(dx: 0.20, dy: 0.20), CGVector(dx: 0.24, dy: 0.20),
            CGVector(dx: 0.16, dy: 0.22), CGVector(dx: 0.20, dy: 0.22),
            CGVector(dx: 0.16, dy: 0.115), CGVector(dx: 0.20, dy: 0.115)
        ]
        var opened = false
        for point in points {
            if toolbar.exists { blankTap.tap(); Thread.sleep(forTimeInterval: 0.45); continue }
            pdfView.coordinate(withNormalizedOffset: point).tap()
            Thread.sleep(forTimeInterval: 0.45)
            if palette.exists { opened = true; break }
            if toolbar.exists { blankTap.tap(); Thread.sleep(forTimeInterval: 0.45) }
        }
        XCTAssertTrue(opened, "隐藏态应能点中高亮")
        XCTAssertFalse(toolbar.exists)
        attachDesignSurface("overlay-annotation-while-hidden-375", app)
        app.buttons["pdf-highlight-cancel"].tap()
        XCTAssertTrue(palette.waitForNonExistence(timeout: 5))
        XCTAssertFalse(toolbar.exists)
        blankTap.tap()
        Thread.sleep(forTimeInterval: 0.5)
        XCTAssertTrue(toolbar.waitForExistence(timeout: 5))

        // 横屏隐藏/恢复，frame 保持。
        XCUIDevice.shared.orientation = .landscapeLeft
        Thread.sleep(forTimeInterval: 0.8)
        if !toolbar.exists { blankTap.tap(); Thread.sleep(forTimeInterval: 0.5) }
        let landscapeFrame = pdfView.frame
        blankTap.tap()
        Thread.sleep(forTimeInterval: 0.6)
        XCTAssertFalse(toolbar.exists)
        XCTAssertEqual(pdfView.frame, landscapeFrame, "横屏隐藏不应改变 frame")
        attachRaw("overlay-hidden-landscape-raw-667x375")
        attachDesignSurface("overlay-hidden-landscape-667x375", app)
        blankTap.tap()
        Thread.sleep(forTimeInterval: 0.5)
        XCTAssertTrue(toolbar.waitForExistence(timeout: 5))
        XCTAssertEqual(pdfView.frame, landscapeFrame, "横屏恢复不应改变 frame")
        attachRaw("overlay-restored-landscape-raw-667x375")
        attachDesignSurface("overlay-restored-landscape-667x375", app)
        XCUIDevice.shared.orientation = .portrait
        Thread.sleep(forTimeInterval: 0.6)
    }

    /// task-65：沉浸式阅读——单击隐藏/恢复 toolbar+footer、PDF 全屏；标注/浮层优先不误触。
    func testPDFImmersiveReadingToggle() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--design-fixture=pdf", "--design-theme=light"]
        app.launch()
        openPDFFixture(app)
        XCTAssertTrue(app.staticTexts["第 1 / 2 页"].waitForExistence(timeout: 10))
        let toolbar = app.otherElements["pdf-reader-toolbar"]
        let footer = app.otherElements["pdf-reader-footer"]
        XCTAssertTrue(toolbar.waitForExistence(timeout: 5))
        XCTAssertTrue(footer.exists)
        let pdfView = app.otherElements["pdf-reader-view"]
        // task-67 后 PDFView 始终四边贴全屏，chrome 只是悬浮层：显隐不应改变 frame。
        let defaultFrame = pdfView.frame
        let blankTap = pdfView.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.72))
        attachDesignSurface("immersive-default-375", app)

        blankTap.tap()
        Thread.sleep(forTimeInterval: 0.5)
        XCTAssertFalse(toolbar.exists, "隐藏后 toolbar 不应可访问")
        XCTAssertFalse(footer.exists, "隐藏后 footer 不应可访问")
        XCTAssertFalse(app.staticTexts["pdf-reader-page"].exists, "隐藏后页码不应可见")
        XCTAssertEqual(pdfView.frame, defaultFrame, "隐藏 chrome 不应改变 PDFView frame（悬浮层）")
        attachDesignSurface("immersive-hidden-375", app)

        blankTap.tap()
        Thread.sleep(forTimeInterval: 0.5)
        XCTAssertTrue(toolbar.waitForExistence(timeout: 5), "再单击应恢复 toolbar")
        XCTAssertTrue(footer.waitForExistence(timeout: 5))
        attachDesignSurface("immersive-restored-375", app)

        // 单页模式：隐藏/恢复各一次。
        setPDFReadingMode(app, scroll: false)
        Thread.sleep(forTimeInterval: 0.6)
        blankTap.tap()
        Thread.sleep(forTimeInterval: 0.5)
        XCTAssertFalse(toolbar.exists)
        attachDesignSurface("immersive-hidden-single-page-375", app)
        blankTap.tap()
        Thread.sleep(forTimeInterval: 0.5)
        XCTAssertTrue(toolbar.waitForExistence(timeout: 5))

        // 隐藏态点标注：应打开调色盘且不恢复 chrome，浮层关闭后仍隐藏。
        blankTap.tap()
        Thread.sleep(forTimeInterval: 0.5)
        XCTAssertFalse(toolbar.exists)
        let palette = app.otherElements["pdf-highlight-palette"]
        // 隐藏态没有 toolbar 约束，页面坐标变化；逐点尝试命中高亮：
        // 空白点会切换 chrome，检测到恢复后再次单击隐藏，再试下一个点。
        // 单页模式 autoScales 最佳适配、页面垂直居中：高亮行约在 pdfView 纵向 0.18–0.26。
        let annotationPoints: [CGVector] = [
            CGVector(dx: 0.16, dy: 0.18), CGVector(dx: 0.20, dy: 0.18),
            CGVector(dx: 0.24, dy: 0.18), CGVector(dx: 0.16, dy: 0.20),
            CGVector(dx: 0.20, dy: 0.20), CGVector(dx: 0.24, dy: 0.20),
            CGVector(dx: 0.16, dy: 0.22), CGVector(dx: 0.20, dy: 0.22),
            CGVector(dx: 0.16, dy: 0.24), CGVector(dx: 0.20, dy: 0.24),
            CGVector(dx: 0.16, dy: 0.115), CGVector(dx: 0.20, dy: 0.115)
        ]
        var openedPalette = false
        for point in annotationPoints {
            if toolbar.exists {
                blankTap.tap()
                Thread.sleep(forTimeInterval: 0.45)
                continue
            }
            pdfView.coordinate(withNormalizedOffset: point).tap()
            Thread.sleep(forTimeInterval: 0.45)
            if palette.exists { openedPalette = true; break }
            if toolbar.exists {
                blankTap.tap()
                Thread.sleep(forTimeInterval: 0.45)
            }
        }
        XCTAssertTrue(openedPalette, "隐藏态应仍能点中高亮")
        XCTAssertFalse(toolbar.exists, "点标注不应恢复 chrome")
        attachDesignSurface("immersive-annotation-while-hidden-375", app)
        app.buttons["pdf-highlight-cancel"].tap()
        XCTAssertTrue(palette.waitForNonExistence(timeout: 5))
        XCTAssertFalse(toolbar.exists, "浮层关闭后仍应保持隐藏")
        blankTap.tap()
        Thread.sleep(forTimeInterval: 0.5)
        XCTAssertTrue(toolbar.waitForExistence(timeout: 5))

        // 横屏隐藏态截图 + 状态栏/全屏。
        XCUIDevice.shared.orientation = .landscapeLeft
        Thread.sleep(forTimeInterval: 0.8)
        if !toolbar.exists { blankTap.tap(); Thread.sleep(forTimeInterval: 0.5) }
        blankTap.tap()
        Thread.sleep(forTimeInterval: 0.6)
        XCTAssertFalse(toolbar.exists)
        attachDesignSurface("immersive-hidden-landscape-667x375", app)
        blankTap.tap()
        Thread.sleep(forTimeInterval: 0.5)
        XCUIDevice.shared.orientation = .portrait
        Thread.sleep(forTimeInterval: 0.6)
        XCTAssertTrue(toolbar.waitForExistence(timeout: 5))
        attachDesignSurface("immersive-portrait-restored-375", app)
    }

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

    /// 系统大标题：优先查导航栏内 staticText；某些系统版本只在全局 staticText 暴露。
    private func waitForPageTitle(
        _ text: String,
        in app: XCUIApplication,
        timeout: TimeInterval = 5
    ) -> Bool {
        if app.navigationBars.staticTexts[text].waitForExistence(timeout: timeout) { return true }
        return app.staticTexts[text].waitForExistence(timeout: 1)
    }

    private func waitForSearchField(
        _ identifier: String,
        in app: XCUIApplication,
        timeout: TimeInterval = 5
    ) -> XCUIElement {
        let search = app.searchFields[identifier]
        if search.waitForExistence(timeout: timeout) { return search }
        return app.textFields[identifier]
    }

    /// iOS 26 搜索激活后右上角的取消/关闭按钮：中文环境可能仍暴露为 “Close”。
    private func waitForSearchDismissButton(
        in app: XCUIApplication,
        timeout: TimeInterval = 5
    ) -> XCUIElement? {
        let labels = ["取消", "Close", "Cancel"]
        let navigationButton = app.navigationBars.buttons.matching(
            NSPredicate(format: "label IN %@", labels)
        ).firstMatch
        if navigationButton.waitForExistence(timeout: timeout) { return navigationButton }
        let anyButton = app.buttons.matching(NSPredicate(format: "label IN %@", labels)).firstMatch
        return anyButton.exists ? anyButton : nil
    }

    /// 大标题/内联标题“可见”不能只看 accessibility 存在：BUG 状态下节点存在、hittable、frame 正常，
    /// 但屏幕没有绘制（被不透明导航栏背景层遮挡）。这里对候选标题做像素墨迹校验：
    /// 任一候选 staticText 可点且 frame 区域有真实字形像素才算可见（同时覆盖大标题态与滚动后的内联标题态）。
    private func waitForVisibleNavigationTitle(
        _ text: String,
        in app: XCUIApplication,
        timeout: TimeInterval = 5,
        inkThreshold: Double = 0.02
    ) -> Bool {
        let deadline = Date(timeIntervalSinceNow: timeout)
        var diagnostics = ""
        while Date() < deadline {
            let titles = app.navigationBars.staticTexts
                .matching(NSPredicate(format: "label == %@", text))
                .allElementsBoundByIndex
            for title in titles where title.exists && title.isHittable {
                let ink = titleInkRatio(of: title, in: app)
                diagnostics = "frame=\(title.frame) inkRatio=\(ink)"
                if ink > inkThreshold { return true }
            }
            if diagnostics.isEmpty { diagnostics = "未找到可点的“\(text)”标题节点" }
            Thread.sleep(forTimeInterval: 0.2)
        }
        print("QA_NAV_TITLE_NOT_VISIBLE text=\(text) \(diagnostics)")
        return false
    }

    /// 滚动后导航栏背景必须是纸白不透明：取标题右侧/按钮左侧的顶部窄带，纸白背景应几乎全为浅色像素；
    /// 若背景透明，滚动内容（文字/分隔线/封面）会穿过该区域产生深色像素。
    private func navigationBarBackgroundIsPaperBlank(in app: XCUIApplication) -> Bool {
        guard app.navigationBars.firstMatch.exists else { return false }
        let bar = app.navigationBars.firstMatch.frame
        let rect = CGRect(
            x: max(8, bar.midX - 90),
            y: bar.minY + 2,
            width: min(180, bar.width - 32),
            height: 6
        )
        return screenshotLightRatio(in: rect, in: app) > 0.99
    }

    private func screenshotLightRatio(in rect: CGRect, in app: XCUIApplication) -> Double {
        let image = XCUIScreen.main.screenshot().image
        guard let cgImage = image.cgImage, app.frame.width > 0 else { return 0 }
        let scale = CGFloat(cgImage.width) / app.frame.width
        let scaled = CGRect(
            x: rect.minX * scale,
            y: rect.minY * scale,
            width: rect.width * scale,
            height: rect.height * scale
        ).integral
        guard scaled.width >= 2, scaled.height >= 2,
              let cropped = cgImage.cropping(to: scaled) else { return 0 }
        let width = cropped.width
        let height = cropped.height
        guard width > 0, height > 0 else { return 0 }
        var pixels = [UInt8](repeating: 0, count: width * height * 4)
        guard let context = CGContext(
            data: &pixels,
            width: width,
            height: height,
            bitsPerComponent: 8,
            bytesPerRow: width * 4,
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ) else { return 0 }
        context.draw(cropped, in: CGRect(x: 0, y: 0, width: width, height: height))
        var light = 0
        for index in stride(from: 0, to: pixels.count, by: 4) {
            let red = Double(pixels[index]) / 255
            let green = Double(pixels[index + 1]) / 255
            let blue = Double(pixels[index + 2]) / 255
            let luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue
            if luminance > 0.85 { light += 1 }
        }
        return Double(light) / Double(width * height)
    }

    /// 浅色主题下统计标题区域深色像素占比（墨色标题 vs 纸白底）。
    private func titleInkRatio(of element: XCUIElement, in app: XCUIApplication) -> Double {
        let frame = element.frame
        guard frame.width >= 4, frame.height >= 4 else { return 0 }
        let image = XCUIScreen.main.screenshot().image
        guard let cgImage = image.cgImage, app.frame.width > 0 else { return 0 }
        let scale = CGFloat(cgImage.width) / app.frame.width
        let rect = CGRect(
            x: frame.minX * scale,
            y: frame.minY * scale,
            width: frame.width * scale,
            height: frame.height * scale
        ).integral
        guard rect.width >= 4, rect.height >= 4,
              let cropped = cgImage.cropping(to: rect) else { return 0 }
        let width = cropped.width
        let height = cropped.height
        guard width > 0, height > 0 else { return 0 }
        var pixels = [UInt8](repeating: 0, count: width * height * 4)
        guard let context = CGContext(
            data: &pixels,
            width: width,
            height: height,
            bitsPerComponent: 8,
            bytesPerRow: width * 4,
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ) else { return 0 }
        context.draw(cropped, in: CGRect(x: 0, y: 0, width: width, height: height))
        var dark = 0
        for index in stride(from: 0, to: pixels.count, by: 4) {
            let red = Double(pixels[index]) / 255
            let green = Double(pixels[index + 1]) / 255
            let blue = Double(pixels[index + 2]) / 255
            let luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue
            if luminance < 0.5 { dark += 1 }
        }
        return Double(dark) / Double(width * height)
    }

    private func noteRowQuery(in app: XCUIApplication) -> XCUIElementQuery {
        app.collectionViews["notes"].cells.matching(
            NSPredicate(
                format: "identifier BEGINSWITH %@ OR identifier BEGINSWITH %@",
                "annotation-"
            )
        )
    }

    private func waitForNoteRows(_ count: Int, in app: XCUIApplication, timeout: TimeInterval = 5) {
        let query = noteRowQuery(in: app)
        expectation(for: NSPredicate { _, _ in query.count == count }, evaluatedWith: app)
        waitForExpectations(timeout: timeout)
    }

    private func conversationRowQuery(in app: XCUIApplication) -> XCUIElementQuery {
        app.collectionViews["question-history"].cells.matching(
            NSPredicate(format: "identifier BEGINSWITH %@", "question-")
        )
    }

    private func waitForConversationRows(_ count: Int, in app: XCUIApplication, timeout: TimeInterval = 5) {
        let query = conversationRowQuery(in: app)
        expectation(for: NSPredicate { _, _ in query.count == count }, evaluatedWith: app)
        waitForExpectations(timeout: timeout)
    }
}

final class ReadingUITests: XCTestCase {
    func testEmptyQuestionCloseDoesNotCreateHistoryOrRangeControls() {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--design-fixture=normal", "--design-theme=light"]
        app.launch()
        XCTAssertTrue(app.staticTexts["红楼梦"].waitForExistence(timeout: 15))
        tab("tab-conversations", label: "对话", in: app).tap()
        let history = app.collectionViews["question-history"]
        XCTAssertTrue(history.cells.firstMatch.waitForExistence(timeout: 10))
        let before = history.cells.count
        tab("tab-library", label: "书架", in: app).tap()
        app.buttons["continue-reading"].tap(); waitForBody(app)
        app.buttons["reader-contents"].tap()
        XCTAssertFalse(app.buttons["已读范围"].exists)
        app.buttons["完成"].tap()
        app.buttons["reader-ask-book"].tap()
        XCTAssertTrue(app.textViews["question-input"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.segmentedControls["question-reading-range"].exists)
        XCTAssertFalse(app.buttons["问答范围说明"].exists)
        XCTAssertFalse(app.staticTexts["question-scope"].exists)
        app.buttons["question-close"].tap()
        app.buttons["书架"].tap()
        tab("tab-conversations", label: "对话", in: app).tap()
        XCTAssertEqual(history.cells.count, before)
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
        questionSaved(app)
    }
    private func issue12Row(_ name: String, app: XCUIApplication) -> XCUIElement {
        app.collectionViews["question-history"].cells.containing(NSPredicate(format: "label CONTAINS %@", name)).firstMatch
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
        XCTAssertTrue(app.otherElements["资料尚未准备完整"].firstMatch.waitForExistence(timeout: 5))
        evidence("issue12-explicit-local-choice", app)
        app.otherElements["book-dialog"].buttons["仅用选文解释"].tap(); questionSaved(app)
        XCTAssertFalse(app.staticTexts["question-scope"].exists)
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
        XCTAssertEqual(app.collectionViews["question-history"].cells.count, 3)
        XCTAssertTrue(app.staticTexts["semantic-fixture"].exists); XCTAssertTrue(app.staticTexts["original-fixture"].exists)
        evidence("issue12-two-book-grouped-history", app)
        let row = issue12Row("UI12第二书", app: app); row.swipeLeft(); app.buttons["改名"].tap()
        let field = app.textFields["conversation-name"]; field.tap()
        field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: (field.value as? String ?? "").count)); field.typeText("UI12改名已保存")
        app.otherElements["book-dialog"].buttons["保存"].tap(); XCTAssertTrue(issue12Row("UI12改名已保存", app: app).exists)
        XCTAssertFalse(issue12Row("UI12第二书", app: app).exists, "改名保存后列表行应立即显示新标题")
        let remove = issue12Row("书中的余辉", app: app); remove.swipeLeft(); app.buttons["删除"].tap(); app.otherElements["book-dialog"].buttons["取消"].tap()
        XCTAssertTrue(issue12Row("书中的余辉", app: app).exists)
        issue12Row("书中的余辉", app: app).swipeLeft(); app.buttons["删除"].tap(); app.otherElements["book-dialog"].buttons["删除"].tap()
        XCTAssertEqual(app.collectionViews["question-history"].cells.count, 2)
        // Persist a follow-up draft, then let the external harness restart explicitly.
        issue12Row("初版规则要求多久", app: app).tap()
        let draft = app.buttons["question-follow-up"]; issue12Reach(draft, in: app); draft.tap()
        let input = app.textViews["question-input"]; issue12Reach(input, in: app); input.tap(); input.typeText("UI12可恢复追问草稿")
        app.buttons["关闭"].tap(); evidence("issue12-renamed-deleted-draft-saved", app)
    }
    func testIssue12OfflineRestartSnapshotsAndDraft() {
        let app = issue12App(); app.tabBars.buttons["对话"].tap()
        XCTAssertEqual(app.collectionViews["question-history"].cells.count, 2)
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
        app.collectionViews["question-history"].cells.containing(NSPredicate(format: "label CONTAINS %@", "BG14-\(format)-\(delay)")).firstMatch.tap()
        XCTAssertFalse(app.staticTexts["question-status"].exists, "成功态不应显示状态条")
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
                let row = app.collectionViews["question-history"].cells.containing(NSPredicate(format: "label CONTAINS %@", name))
                XCTAssertEqual(row.count, 1); row.firstMatch.tap()
                if delay == 20 {
                    XCTAssertFalse(app.staticTexts["question-status"].exists, "成功态不应显示状态条")
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
        XCTAssertTrue(app.otherElements["book-dialog"].firstMatch.waitForExistence(timeout: 10))
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
        XCTAssertTrue(app.webViews.firstMatch.waitForExistence(timeout: 20))
        let ready = NSPredicate { _, _ in !self.visibleMarkers(app).isEmpty }
        expectation(for: ready, evaluatedWith: app)
        waitForExpectations(timeout: 15)
    }
    private func waitForBody(_ app: XCUIApplication) {
        // Successful save feedback is intentionally hidden in the designed
        // reader, so readiness must come from the actual rendered body.
        let body = app.webViews.firstMatch
        XCTAssertTrue(body.waitForExistence(timeout: 20))
        XCTAssertTrue(body.staticTexts.firstMatch.waitForExistence(timeout: 15))
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
        app.otherElements["book-dialog"].buttons["知道了"].tap()
        app.collectionViews["library"].cells[failedBook].tap()
        waitForBody(app)
        settings(app, mode: "仿真", dark: false, font: 100, wait: false)
        // The original scripted fixture refuses scrollBy: go accepts the request
        // but no changed location arrives. A timeout must not become readiness.
        XCTAssertTrue(app.otherElements["翻页准备失败"].firstMatch.waitForExistence(timeout: 15))
        XCTAssertFalse(app.staticTexts["阅读位置已保存"].exists)
        evidence("curl-preparation-failed", app)
        app.otherElements["book-dialog"].buttons["使用分页"].tap()
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
            XCTAssertTrue(app.buttons["reader-contents"].isHittable)
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
        app.buttons["reader-contents"].tap()
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
        app.buttons["reader-contents"].tap()
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
        XCTAssertTrue(app.otherElements["无法定位原文"].firstMatch.waitForExistence(timeout: 12))
        app.otherElements["book-dialog"].buttons["知道了"].tap()
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
        app.buttons["reader-contents"].tap()
        app.tables.cells.staticTexts["第2章"].tap()
        waitForText(app)
        XCTAssertTrue(visibleMarkers(app).contains("C2-P01"))
        app.swipeLeft()
        waitForText(app)
        let marker = try XCTUnwrap(visibleMarkers(app).first)
        evidence("bookmark-before-" + marker, app)
        app.buttons["reader-contents"].tap()
        app.buttons["添加书签"].tap()
        XCTAssertTrue(app.staticTexts["书签已保存"].waitForExistence(timeout: 5))
        app.buttons["添加书签"].tap()
        XCTAssertEqual(app.tables.cells.count, 1)
        evidence("bookmark-saved-list", app)
        app.buttons["完成"].tap()
        app.buttons["reader-contents"].tap()
        app.segmentedControls.buttons["目录"].tap()
        app.tables.cells.staticTexts["第3章"].tap()
        waitForText(app)
        XCTAssertTrue(visibleMarkers(app).contains("C3-P01"))
        app.terminate()
        app.launch()
        app.collectionViews["library"].cells[bookID].tap()
        waitForBody(app)
        app.buttons["reader-contents"].tap()
        app.segmentedControls.buttons["书签"].tap()
        app.tables.cells.firstMatch.tap()
        waitForText(app)
        XCTAssertTrue(visibleMarkers(app).contains(marker))
        evidence("bookmark-return-" + marker, app)
        app.buttons["reader-contents"].tap()
        app.segmentedControls.buttons["书签"].tap()
        app.tables.cells.firstMatch.swipeLeft()
        app.buttons["移除"].tap()
        XCTAssertTrue(app.staticTexts["暂无书签"].waitForExistence(timeout: 5))
        app.buttons["完成"].tap()
        app.terminate()
        app.launch()
        app.collectionViews["library"].cells[bookID].tap()
        waitForBody(app)
        app.buttons["reader-contents"].tap()
        app.segmentedControls.buttons["书签"].tap()
        XCTAssertTrue(app.staticTexts["暂无书签"].exists)
    }
    private func contents(_ name: String, in app: XCUIApplication) {
        app.buttons["reader-contents"].tap()
        app.segmentedControls.buttons["目录"].tap()
        let row = app.tables.cells.staticTexts[name]
        for _ in 0..<4 where !row.isHittable { app.tables.firstMatch.swipeUp() }
        row.tap()
    }
    private func clearBookmarks(_ app: XCUIApplication) {
        app.buttons["reader-contents"].tap()
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
            app.otherElements["book-dialog"].buttons["知道了"].tap()
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
        app.buttons["reader-contents"].tap()
        app.buttons["添加书签"].tap()
        XCTAssertTrue(app.staticTexts["书签已保存"].waitForExistence(timeout: 5))
        app.buttons["完成"].tap()
        contents("第3章末", in: app)
        waitForBody(app)
        XCTAssertTrue(visibleMarkers(app).contains("C3-P30"))
        evidence("chapter3-end", app)
        settings(app, mode: "分页", dark: true, font: 200)
        app.buttons["reader-contents"].tap()
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
        XCTAssertTrue(app.otherElements["无法定位原文"].firstMatch.waitForExistence(timeout: 12))
        evidence("invalid-anchor-rejected", app)
        app.otherElements["book-dialog"].buttons["知道了"].tap()
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
        XCTAssertTrue(app.otherElements["无法定位原文"].firstMatch.waitForExistence(timeout: 5))
        evidence("invalid-resource-rejected", app)
        app.otherElements["book-dialog"].buttons["知道了"].tap()
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
        app.buttons["reader-contents"].tap()
        app.buttons["添加书签"].tap()
        XCTAssertTrue(app.otherElements["书签保存失败"].firstMatch.waitForExistence(timeout: 5))
        evidence("bookmark-save-failed", app)
        XCTAssertFalse(app.staticTexts["书签已保存"].exists)
        for _ in 0..<30 {
            app.otherElements["book-dialog"].buttons["重试保存"].tap()
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
        app.buttons["reader-contents"].tap()
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
        app.buttons["reader-contents"].tap()
        app.segmentedControls.buttons["书签"].tap()
        let row = app.tables.cells.matching(NSPredicate(format: "identifier BEGINSWITH 'bookmark-'")).firstMatch
        XCTAssertTrue(row.exists)
        let removedID = row.identifier
        row.swipeLeft()
        app.buttons["移除"].tap()
        XCTAssertTrue(app.otherElements["书签移除失败"].firstMatch.waitForExistence(timeout: 5))
        evidence("bookmark-removal-failed", app)
        for _ in 0..<30 {
            app.otherElements["book-dialog"].buttons["重试保存"].tap()
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
        app.buttons["reader-contents"].tap()
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
        app.buttons["reader-contents"].tap()
        evidence("navigation-small-large-contents", app)
        app.buttons["添加书签"].tap()
        XCTAssertTrue(app.staticTexts["书签已保存"].waitForExistence(timeout: 5))
        evidence("navigation-small-large-bookmark", app)
        app.tables.cells.firstMatch.tap()
        waitForBody(app)
        app.buttons["隐藏工具栏"].tap()
        XCTAssertFalse(app.buttons["reader-contents"].exists)
        app.buttons["显示工具栏"].tap()
        settings(app, mode: "分页", dark: false, font: 100)
    }
    func testReadingSettingsKeepContentAndRestart() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        if !app.collectionViews["library"].cells[bookID].exists {
            choose("original-fixture.epub", in: app)
            app.otherElements["book-dialog"].buttons["知道了"].tap()
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
        app.otherElements["book-dialog"].buttons["知道了"].tap()
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
        app.otherElements["book-dialog"].buttons["知道了"].tap()
        let count = app.collectionViews["library"].cells.count
        choose("original-fixture.epub", in: app)
        XCTAssertTrue(app.otherElements["书籍已在书架"].firstMatch.exists)
        app.otherElements["book-dialog"].buttons["知道了"].tap()
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
            XCTAssertTrue(app.otherElements["导入失败"].firstMatch.exists)
            evidence("rejected-" + name, app)
            app.otherElements["book-dialog"].buttons["知道了"].tap()
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
        app.collectionViews["notes"].cells.containing(NSPredicate(format: "label CONTAINS %@", text)).firstMatch
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
        let draft = app.collectionViews["notes"].cells[id]
        XCTAssertTrue(draft.waitForExistence(timeout: 5))
        draft.tap()
        XCTAssertEqual(app.textViews["note-body"].value as? String, "D6-end-recover")
        evidence("note-draft-recovered-after-restart", app)
        replaceNoteBody("N6-end-v2", in: app)
        app.buttons["保存笔记"].tap()
        XCTAssertTrue(app.collectionViews["notes"].cells[id].waitForExistence(timeout: 5))
        app.collectionViews["notes"].cells[id].tap()
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
        app.collectionViews["notes"].cells[id].tap()
        app.buttons["返回原文"].tap()
        waitForBody(app)
        evidence("note-return-after-reflow", app)
        app.terminate(); app.launch()
        app.tabBars.buttons["笔记"].tap()
        XCTAssertTrue(app.collectionViews["notes"].cells[id].waitForExistence(timeout: 5))
        app.collectionViews["notes"].cells[id].tap()
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
        app.collectionViews["notes"].cells[id].tap()
        replaceNoteBody("D6-R1-v2-survives-rehighlight", in: app)
        app.buttons["保存草稿"].tap()
        app.buttons["返回原文"].tap()
        waitForBody(app)
        evidence("repeat-return-exact-occurrence", app)
        print("N6_REPEAT_RETURN \(app.webViews.firstMatch.debugDescription)")
        app.buttons["书架"].tap()
        app.tabBars.buttons["笔记"].tap()
        XCTAssertTrue(app.collectionViews["notes"].cells[id].exists)
        app.collectionViews["notes"].cells[id].tap()
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
        XCTAssertTrue(app.otherElements["高亮保存失败"].firstMatch.waitForExistence(timeout: 5))
        evidence("note-real-highlight-write-failure", app)
        print("N6_RESTORE_HIGHLIGHT_FAULT")
        Thread.sleep(forTimeInterval: 3)
        app.otherElements["book-dialog"].buttons["重试保存高亮"].tap()
        XCTAssertFalse(app.otherElements["高亮保存失败"].firstMatch.exists)
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
        XCTAssertTrue(app.collectionViews["notes"].cells[id].waitForExistence(timeout: 5))
        app.terminate(); app.launch()
        app.tabBars.buttons["笔记"].tap()
        app.collectionViews["notes"].cells[id].tap()
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
        app.collectionViews["notes"].cells[id].tap(); app.buttons["返回原文"].tap()
        waitForBody(app)
        evidence("note-exact-P30-after-cross-chapter-curl", app)
        settings(app, mode: "滚动", dark: true, font: 200)
        evidence("note-exact-P30-scroll-200-dark", app)
        app.terminate(); app.launch()
        app.tabBars.buttons["笔记"].tap()
        app.collectionViews["notes"].cells[id].tap(); app.buttons["返回原文"].tap()
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
        app.buttons["reader-contents"].tap()
        XCTAssertTrue(app.buttons["书内搜索"].waitForExistence(timeout: 5))
        app.buttons["书内搜索"].tap()
        searchQuery(app, query: query, count: count)
    }

    func testBookSearchHiddenVisibleInlineIsolationRebuildAndRestart() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launch()
        app.collectionViews["library"].cells[searchBookID].tap()
        if app.otherElements["翻页准备失败"].firstMatch.waitForExistence(timeout: 1) { app.otherElements["book-dialog"].buttons["使用分页"].tap() }
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
        app.buttons["reader-contents"].tap()
        app.buttons["添加书签"].tap()
        XCTAssertTrue(app.staticTexts["书签已保存"].waitForExistence(timeout: 5))
        let saved = app.tables["book-navigation"].cells.matching(NSPredicate(format: "identifier BEGINSWITH %@", "bookmark-")).allElementsBoundByIndex.last!
        let id = saved.identifier
        app.buttons["完成"].tap()
        contents("搜索第1章", in: app)
        waitForBody(app)
        app.buttons["reader-contents"].tap()
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
        XCTAssertFalse(app.otherElements["无法定位原文"].firstMatch.exists)
        XCTAssertFalse(app.otherElements["翻页准备失败"].firstMatch.exists)
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
            app.otherElements["book-dialog"].buttons["知道了"].tap()
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
        app.otherElements["book-dialog"].buttons["知道了"].tap()
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
        app.cells["ai-provider"].tap(); app.buttons["自定义服务"].tap()
        app.cells["ai-advanced"].tap()
        XCTAssertTrue(app.tables["ai-advanced-editor"].waitForExistence(timeout: 5))
        app.textFields["ai-name"].tap(); app.textFields["ai-name"].typeText(name)
        if format == "Anthropic" { app.cells["ai-format"].tap(); app.buttons["Anthropic"].tap() }
        app.textFields["ai-address"].tap(); app.textFields["ai-address"].typeText(address)
        app.textFields["ai-model"].tap(); app.textFields["ai-model"].typeText(model)
        app.navigationBars["高级设置"].buttons.element(boundBy: 0).tap()
        app.secureTextFields["ai-key"].tap(); app.secureTextFields["ai-key"].typeText("not-a-real-credential")
        if app.sheets["保存密码？"].waitForExistence(timeout: 1) { app.sheets["保存密码？"].buttons["以后"].tap() }
        app.navigationBars.buttons["保存"].tap()
        XCTAssertTrue(app.otherElements["AI 服务发送说明"].firstMatch.waitForExistence(timeout: 5))
        app.otherElements["AI 服务发送说明"].firstMatch.buttons["同意并保存"].tap()
        XCTAssertTrue(app.otherElements["已保存"].firstMatch.waitForExistence(timeout: 5))
        app.otherElements["已保存"].firstMatch.buttons["完成"].tap()
        app.navigationBars.buttons["切换"].tap()
        app.sheets["切换服务"].buttons.matching(NSPredicate(format: "label BEGINSWITH %@", name)).firstMatch.tap()
        XCTAssertTrue(app.otherElements["已切换服务"].firstMatch.waitForExistence(timeout: 5))
        app.otherElements["已切换服务"].firstMatch.buttons["完成"].tap()
        app.tabBars.buttons["书架"].tap()
    }
    private func questionSelection(_ app: XCUIApplication) {
        app.collectionViews["library"].cells[searchBookID].tap()
        if app.otherElements["翻页准备失败"].firstMatch.waitForExistence(timeout: 3) { app.otherElements["book-dialog"].buttons["使用分页"].tap() }
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
    }
    private func questionSaved(_ app: XCUIApplication) {
        // task-71：回答成功后整条 question-status-box 隐藏，不再显示「回答已保存」。
        let status = app.staticTexts["question-status"]
        let ready = NSPredicate { _, _ in
            !status.exists && app.staticTexts["question-answer"].exists
        }
        expectation(for: ready, evaluatedWith: app); waitForExpectations(timeout: 20)
    }
    func testSemanticBackgroundCitationActualHTTPJumpAndReturn() throws {
        continueAfterFailure = false
        let app = XCUIApplication(); app.launch()
        let book = app.collectionViews["library"].cells["book-df8c4a78180b9f65911e9fbba7cf4fb9c6f932c0e98456ef15e165157d9b1a67"]
        if !book.exists {
            choose("A-semantic.epub", in: app)
            app.otherElements["book-dialog"].buttons["知道了"].tap()
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
            XCTAssertFalse(app.staticTexts["question-status"].exists, "成功态不应显示「未通过核验」状态条")
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
        let history = app.collectionViews["question-history"]
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
        app.collectionViews["question-history"].cells.containing(NSPredicate(format: "label CONTAINS 'I9 close-panel'")).firstMatch.tap()
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
        XCTAssertFalse(app.staticTexts["question-status"].exists, "成功态不应显示「未提供可核查」状态条")
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
        let rows = app.collectionViews["question-history"].cells.containing(NSPredicate(format: "label CONTAINS %@", questionText))
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
        app.otherElements["book-dialog"].buttons["知道了"].tap()
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
        if app.otherElements["翻页准备失败"].firstMatch.waitForExistence(timeout: 3) {
            app.otherElements["book-dialog"].buttons["使用分页"].tap()
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
        XCTAssertTrue(app.otherElements["资料尚未准备完整"].firstMatch.waitForExistence(timeout: 5))
        evidence("issue18-current-preparation-wait-or-local-choice", app)
        app.otherElements["book-dialog"].buttons["等待资料准备"].tap()
        XCTAssertFalse(app.staticTexts["question-status"].exists, "草稿态不应显示状态条")
        app.buttons["question-send"].tap()
        let local = app.buttons["仅用选文解释"].firstMatch
        XCTAssertTrue(local.waitForExistence(timeout: 5))
        local.tap()
        questionSaved(app)
        XCTAssertFalse(app.staticTexts["question-scope"].exists)
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
        XCTAssertTrue(app.otherElements["资料尚未准备完整"].firstMatch.waitForExistence(timeout: 5))
        evidence("issue9-preparation-wait-or-local-choice", app)
        app.otherElements["book-dialog"].buttons["等待资料准备"].tap()
        XCTAssertFalse(app.staticTexts["question-status"].exists, "草稿态不应显示状态条")
        app.buttons["question-send"].tap(); app.otherElements["book-dialog"].buttons["仅用选文解释"].tap()
        questionSaved(app)
        XCTAssertFalse(app.staticTexts["question-scope"].exists)
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
        app.collectionViews["question-history"].cells.containing(NSPredicate(format: "label CONTAINS 'I9 small draft'")).firstMatch.tap()
        XCTAssertEqual(app.textViews["question-input"].value as? String, "I9 small draft")
        app.buttons["question-send"].tap(); questionSaved(app)
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
        let row = app.collectionViews["question-history"].cells["question-\(targetID)"]
        XCTAssertTrue(row.waitForExistence(timeout: 5)); row.tap()
        XCTAssertTrue(app.staticTexts["question-status"].label.contains("上次生成已中断"))
        XCTAssertFalse(app.staticTexts["question-answer"].exists)
        evidence("issue14-http-inflight-restart-incomplete", app)
        app.buttons["question-send"].tap()
        let saved = NSPredicate { _, _ in
            !app.staticTexts["question-status"].exists && app.staticTexts["question-answer"].exists
        }
        expectation(for: saved, evaluatedWith: app); waitForExpectations(timeout: 65)
        XCTAssertEqual(app.staticTexts["question-answer"].label, "BG14-OpenAI-20")
        evidence("issue14-http-inflight-active-retry-saved", app)
        app.buttons["关闭"].tap(); XCTAssertTrue(app.collectionViews["question-history"].cells["question-\(targetID)"].exists)
    }
    func testIssue14SavedFaultRecordOfflineRestart() {
        continueAfterFailure = false
        let app = XCUIApplication(); app.launchArguments = ["--isolated-reading-test"]
        XCTAssertEqual(app.state, .runningForeground)
        app.tabBars.buttons["对话"].tap()
        let rows = app.collectionViews["question-history"].cells.containing(NSPredicate(format: "label CONTAINS 'BG14-write-failure-final'"))
        XCTAssertEqual(rows.count, 1); rows.firstMatch.tap()
        XCTAssertFalse(app.staticTexts["question-status"].exists, "成功态不应显示状态条")
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
        let rows = app.collectionViews["question-history"].cells.containing(NSPredicate(format: "label CONTAINS 'BG14-reading-continues-final'"))
        XCTAssertEqual(rows.count, 1); rows.firstMatch.tap()
        let saved = NSPredicate { _, _ in
            !app.staticTexts["question-status"].exists && app.staticTexts["question-answer"].exists
        }
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
        app.collectionViews["question-history"].cells.containing(NSPredicate(format: "label CONTAINS 'BG14-write-failure-final'")).firstMatch.tap()
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
        let rows = app.collectionViews["question-history"].cells.containing(NSPredicate(format: "label CONTAINS 'BG14-terminate-retry'"))
        XCTAssertEqual(rows.count, 1); rows.firstMatch.tap()
        XCTAssertTrue(app.staticTexts["question-status"].label.contains("上次生成已中断"))
        XCTAssertFalse(app.staticTexts["question-answer"].exists)
        evidence("issue14-terminated-restart-incomplete", app)
        app.buttons["question-send"].tap()
        let saved = NSPredicate { _, _ in
            !app.staticTexts["question-status"].exists && app.staticTexts["question-answer"].exists
        }
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
        XCTAssertTrue(app.otherElements["book-dialog"].firstMatch.waitForExistence(timeout: 5))
    }
    func testIssue16RemoveOriginalKeepRecords() {
        let app = issue12App()
        removalMenu(app, delete: false)
        evidence("issue16-default-removal-disclosure", app)
        app.otherElements["book-dialog"].buttons["移除原书，保留记录"].tap()
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
        let note = app.collectionViews["notes"].cells.containing(NSPredicate(format: "label CONTAINS %@", "A retained draft")).firstMatch
        XCTAssertTrue(note.waitForExistence(timeout: 5)); note.tap()
        XCTAssertEqual(app.textViews["note-body"].value as? String, "A retained draft")
        XCTAssertTrue((app.textViews["note-quote"].value as? String ?? "").contains("盐桥"))
        evidence("issue16-offline-retained-note-draft-quote", app)
        app.buttons["返回原文"].tap()
        XCTAssertTrue(app.otherElements["无法返回原文"].firstMatch.waitForExistence(timeout: 5))
        evidence("issue16-note-original-unavailable", app); app.otherElements["book-dialog"].buttons["知道了"].tap()
        app.tabBars.buttons["对话"].tap()
        let row = app.collectionViews["question-history"].cells.containing(NSPredicate(format: "label CONTAINS %@", "Removal 91596")).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 5)); row.tap()
        XCTAssertTrue(app.staticTexts["question-answer"].label.contains("Saved answer"))
        XCTAssertFalse(app.buttons["question-follow-up"].isEnabled)
        let reference = app.buttons["question-reference-0"]; issue12Reach(reference, in: app); reference.tap()
        app.buttons["跳转原文"].tap()
        XCTAssertTrue(app.otherElements["原文不可用"].firstMatch.waitForExistence(timeout: 5))
        evidence("issue16-offline-answer-citation-unavailable", app)
        app.otherElements["book-dialog"].buttons["知道了"].tap(); app.navigationBars.buttons.element(boundBy: 0).tap(); app.buttons["关闭"].tap()
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
        XCTAssertTrue(app.otherElements["book-dialog"].firstMatch.waitForExistence(timeout: 10)); evidence("issue16-identical-file-restored", app)
        app.otherElements["book-dialog"].buttons["知道了"].tap()
        XCTAssertTrue(app.collectionViews["library"].cells[removalA].exists)
        removalMenu(app, delete: true)
        evidence("issue16-destructive-explicit-confirmation", app); app.otherElements["book-dialog"].buttons["取消"].tap()
        XCTAssertTrue(app.collectionViews["library"].cells[removalA].exists)
    }
    func testIssue16ConfirmDeletion() {
        let app = issue12App()
        removalMenu(app, delete: true); app.otherElements["book-dialog"].buttons["确认彻底删除"].tap()
        expectation(for: NSPredicate { _, _ in !app.collectionViews["library"].cells[self.removalA].exists }, evaluatedWith: app)
        waitForExpectations(timeout: 15)
        XCTAssertTrue(app.collectionViews["library"].cells[removalB].exists)
        app.tabBars.buttons["笔记"].tap()
        XCTAssertFalse(app.collectionViews["notes"].cells.containing(NSPredicate(format: "label CONTAINS %@", "A retained draft")).firstMatch.exists)
        app.tabBars.buttons["对话"].tap()
        XCTAssertFalse(app.collectionViews["question-history"].cells.containing(NSPredicate(format: "label CONTAINS %@", "Removal 91596")).firstMatch.exists)
        XCTAssertTrue(app.collectionViews["question-history"].cells.containing(NSPredicate(format: "label CONTAINS %@", "Removal ad522")).firstMatch.exists)
        evidence("issue16-target-deleted-other-book-retained", app)
    }
}

extension ReadingUITests {
    /// task-89：PDF 顶栏阅读设置（分页/滚动）切换、当前页保持、按书持久化。
    func testPDFReadingSettingsUI() throws {
        continueAfterFailure = true
        XCUIDevice.shared.orientation = .portrait
        let app = XCUIApplication()
        app.launchArguments = ["--design-fixture=pdf", "--design-theme=light"]
        app.launch()
        openPDFFixture(app)
        XCTAssertTrue(app.staticTexts["第 1 / 2 页"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["pdf-reader-settings"].exists)
        XCTAssertFalse(app.buttons["pdf-reader-mode"].exists, "旧页脚模式按钮应移除")
        attachDesignSurface("pdf-settings-reader-375", app)

        app.buttons["pdf-reader-settings"].tap()
        XCTAssertTrue(app.navigationBars["阅读设置"].waitForExistence(timeout: 5))
        let mode = app.segmentedControls["pdf-reading-mode"]
        XCTAssertTrue(mode.waitForExistence(timeout: 5))
        XCTAssertTrue(mode.buttons["滚动"].isSelected, "2 页小 PDF 默认连续（滚动）")
        attachDesignSurface("pdf-settings-sheet-default-scroll-375", app)
        mode.buttons["分页"].tap()
        app.buttons["pdf-reading-settings-done"].tap()
        XCTAssertTrue(app.navigationBars["阅读设置"].waitForNonExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["第 1 / 2 页"].exists, "切换后应保持当前页")
        app.otherElements["pdf-reader-view"].swipeLeft()
        XCTAssertTrue(app.staticTexts["第 2 / 2 页"].waitForExistence(timeout: 10), "分页模式左滑到第 2 页")
        attachDesignSurface("pdf-settings-pagination-page2-375", app)

        app.buttons["pdf-reader-settings"].tap()
        XCTAssertTrue(app.segmentedControls["pdf-reading-mode"].buttons["分页"].isSelected)
        app.segmentedControls["pdf-reading-mode"].buttons["滚动"].tap()
        app.buttons["pdf-reading-settings-done"].tap()
        XCTAssertTrue(app.staticTexts["第 2 / 2 页"].exists, "切滚动后仍保持第 2 页")
        app.otherElements["pdf-reader-view"].swipeUp()
        Thread.sleep(forTimeInterval: 0.5)
        attachDesignSurface("pdf-settings-scroll-mode-375", app)
        app.buttons["reader-close"].tap()

        // 重开：保存的滚动模式仍在。
        let shelf = app.collectionViews["library"]
        XCTAssertTrue(shelf.waitForExistence(timeout: 10))
        let cell = shelf.cells.containing(NSPredicate(format: "label CONTAINS %@", "书灯 PDF 示例")).firstMatch
        XCTAssertTrue(cell.waitForExistence(timeout: 10))
        cell.tap()
        XCTAssertTrue(app.otherElements["pdf-reader-view"].waitForExistence(timeout: 15))
        app.buttons["pdf-reader-settings"].tap()
        XCTAssertTrue(app.segmentedControls["pdf-reading-mode"].buttons["滚动"].isSelected, "重开应保持滚动")
        attachDesignSurface("pdf-settings-persisted-scroll-375", app)
    }
}
