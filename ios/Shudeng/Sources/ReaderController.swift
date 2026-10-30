import UIKit
import ReadiumShared
import ReadiumNavigator

/// 波浪线装饰用的非隔离颜色工具：decoration 模板闭包在 Readium 侧调用，不能依赖主线程隔离。
private func noteWaveCSSColor(_ color: UIColor) -> String {
    var red: CGFloat = 0, green: CGFloat = 0, blue: CGFloat = 0, alpha: CGFloat = 1
    guard color.getRed(&red, green: &green, blue: &blue, alpha: &alpha) else { return "rgb(180,113,42)" }
    return "rgb(\(Int((red * 255).rounded())),\(Int((green * 255).rounded())),\(Int((blue * 255).rounded())))"
}

@MainActor
final class ReaderController: UIViewController, EPUBNavigatorDelegate {
    private let book: Book
    private let library: LibraryStore
    private let bookRevision: UUID
    private let publication: Publication
    private var navigator: EPUBNavigatorViewController
    private var settings: ReadingSettings
    private let content = UIView()
    private let toolbar = ReaderToolbarView()
    private let footer = ReaderFooterView()
    private var controlsAnimationGeneration = 0
    private let statusPanel = UIView()
    private let status = UILabel()
    private let retry = UIButton(type: .system)
    private var statusRequestedVisible = false
    private var statusIsError = false
    private var pendingLocation: Locator?
    private var saveFailed = false
    private var loading = true
    private var toolbarHidden = false
    private var loadFailed = false
    private var navigating = false
    private var navigationFailed = false
    private var curl: ReaderCurlController?
    private var curlActivationObserver: InputObservableToken?
    private var curlBusy = false
    private var curlSize = CGSize.zero
    private var leaving = false
    private var changingBounds = false
    private var openingTarget: Locator?
    // The reader's exact source occurrence survives a chain of reflows. Native
    // page locations are still used for pagination, snapshots and progress.
    private var readingFocus: Locator?
    private var restoringFocus: Locator?
    private var settlingFocus = false
    private var focusObservation = 0
    #if DEBUG
    private var acceptanceObservation = 0
    private struct ToolbarLatency: Encodable {
        let action: Int
        let started: CFTimeInterval
        let targetHidden: Bool
        var chromeMS: Double?
        var usableMS: Double?
        var rebuilds = 0
        var curlStarts = 0
        var curlStops = 0
        var enteredLoading = false
        var enteredCurlBusy = false
        var navigatorGeneration: Int
        var controlsHidden = false
        var interactive = false
    }
    private var toolbarLatency: ToolbarLatency?
    private var toolbarLatencyAction = 0
    private var acceptanceNavigatorGeneration = 1
    #endif
    private var questionCitation: Locator?
    private var appliedHighlightSignatures: [String] = []
    private struct HighlightExpectation: Encodable {
        let id: String
        let selector: String?
        let before: String?
        let highlight: String?
    }
    var questionOrigin: Locator? {
        didSet {
            updateReferenceNavigation()
            if questionOrigin == nil {
                questionCitation = nil
                navigator.apply(decorations: [], in: "question-citation")
            }
        }
    }
    var referenceReturn: (() -> Void)?
    private var activeQuestion: UINavigationController?
    private var finishedInitialLoad = false
    private var currentChapter = ""
    private var selectionMenu: ReaderSelectionMenu?
    private var highlightColorBar: HighlightColorBar?
    private var highlightColorCatcher: UIView?
    private var menuPresentedAt: CFTimeInterval = 0
    private let bookmarkRibbon = BookmarkRibbonButton()
    private var pageBookmarks: [Bookmark] = []
    private var bookmarkRibbonVisible = false
    private var bookmarkRefreshGeneration = 0
    private var bookmarkInitialRefreshScheduled = false

    init(book: Book, publication: Publication, library: LibraryStore, target: Locator? = nil) throws {
        self.book = book
        self.library = library
        bookRevision = library.revision(for: book.id)
        self.publication = publication
        openingTarget = target
        questionCitation = target
        settings = book.readingSettings ?? ReadingSettings()
        let saved = try library.location(for: book.id)
        readingFocus = saved?.text.highlight == nil ? nil : saved
        restoringFocus = readingFocus
        navigator = try EPUBNavigatorViewController(publication: publication, initialLocation: saved,
                                                   config: Self.configuration(settings))
        super.init(nibName: nil, bundle: nil)
        navigator.delegate = self
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }
    static let designedFontSize: CGFloat = 18.5
    static let designedLineHeight: Double = 1.75
    static let designedGutter: CGFloat = 28
    private static let readiumCJKBaseFontSize: CGFloat = 14

    static func readingPreferences(_ settings: ReadingSettings) -> EPUBPreferences {
        let traits = UITraitCollection(userInterfaceStyle: settings.dark ? .dark : .light)
        return EPUBPreferences(backgroundColor: Color(uiColor: BookDesign.paper.resolvedColor(with: traits)),
                        fontFamily: FontFamily(rawValue: "Songti SC"),
                        fontSize: Double(designedFontSize / readiumCJKBaseFontSize)
                            * Double(settings.fontSize) / 100,
                        lineHeight: designedLineHeight,
                        pageMargins: 1,
                        paragraphIndent: 2,
                        paragraphSpacing: 1.5,
                        publisherStyles: false,
                        scroll: settings.scroll && settings.pageCurl != true,
                        textAlign: .justify,
                        textColor: Color(uiColor: BookDesign.ink.resolvedColor(with: traits)),
                        theme: settings.dark ? .dark : .light,
                        typeScale: 1)
    }

    static func configuration(_ settings: ReadingSettings) -> EPUBNavigatorViewController.Configuration {
        var rs = CSSRSProperties()
        rs.pageGutter = CSSPxLength(designedGutter)
        rs.selectionBackgroundColor = CSSIntColor(settings.dark ? 0x5A4A2A : 0xF2DBA6)
        rs.selectionTextColor = CSSIntColor(settings.dark ? 0xF3EEE3 : 0x211E18)
        let inset = EPUBContentInsets(top: designedGutter, bottom: 22)
        var templates = HTMLDecorationTemplate.defaultTemplates()
        templates[noteWaveStyleID] = noteWaveTemplate()
        return .init(preferences: readingPreferences(settings), editingActions: [
            EditingAction(title: "高亮", action: #selector(highlightSelection)),
            EditingAction(title: "写笔记", action: #selector(noteSelection)),
            EditingAction(title: "提问", action: #selector(askSelection))
        ], contentInset: [.compact: inset, .regular: inset],
           decorationTemplates: templates,
           readiumCSSRSProperties: rs)
    }
    /// 笔记用自定义波浪线 decoration；Readium 无原生 wavy，用平铺 SVG 背景模拟。
    static let noteWaveStyleID: Decoration.Style.Id = "note-wave"

    static func noteWaveTemplate() -> HTMLDecorationTemplate {
        HTMLDecorationTemplate(
            layout: .boxes,
            element: { decoration in
                let tint = (decoration.style.config as? Decoration.Style.HighlightConfig)?.tint ?? BookDesign.lampInk
                let svg = "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"8\" height=\"4\" viewBox=\"0 0 8 4\">"
                    + "<path d=\"M0 3 Q2 0.5 4 3 T8 3\" fill=\"none\" stroke=\"\(noteWaveCSSColor(tint))\" "
                    + "stroke-width=\"1.6\" stroke-linecap=\"round\"/></svg>"
                let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-_.!~*()/:"))
                let encoded = svg.addingPercentEncoding(withAllowedCharacters: allowed) ?? svg
                return "<div class=\"shudeng-note-wave\""
                    + " style=\"background-image: url('data:image/svg+xml,\(encoded)')\"></div>"
            },
            stylesheet: """
            .shudeng-note-wave {
                background-repeat: repeat-x;
                background-position: left bottom;
                background-size: 8px 4px;
            }
            """
        )
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        applyTheme()
        currentChapter = navigator.currentLocation?.title ?? book.title

        toolbar.backButton.addTarget(self, action: #selector(closeReader), for: .touchUpInside)
        toolbar.contentsButton.addTarget(self, action: #selector(openNavigation), for: .touchUpInside)
        toolbar.settingsButton.addTarget(self, action: #selector(openSettings), for: .touchUpInside)
        toolbar.contentsButton.isEnabled = false
        toolbar.settingsButton.isEnabled = false
        toolbar.configure(title: book.title, chapter: currentChapter, reference: false)

        footer.update(progress: footerProgress, chapter: currentChapter)
        footer.askButton.addTarget(self, action: #selector(askCurrentBook), for: .touchUpInside)

        statusPanel.backgroundColor = BookDesign.wash
        statusPanel.layer.cornerRadius = BookRadius.field
        statusPanel.layer.borderWidth = 1
        statusPanel.layer.borderColor = BookDesign.line.cgColor
        status.font = BookType.caption
        status.textColor = BookDesign.ink3
        status.numberOfLines = 0
        status.maximumContentSizeCategory = .extraLarge
        status.accessibilityIdentifier = "reading-save-status"
        // 加载进度由中间的点状 spinner 表达，不再显示底部提示条。
        status.text = ""
        BookDesign.button(retry, title: "重试保存")
        retry.addTarget(self, action: #selector(retrySave), for: .touchUpInside)
        retry.isHidden = true
        let statusStack = UIStackView(arrangedSubviews: [status, retry])
        statusStack.axis = .vertical
        statusStack.alignment = .fill
        statusStack.spacing = 8
        statusStack.isLayoutMarginsRelativeArrangement = true
        statusStack.layoutMargins = UIEdgeInsets(top: 10, left: 12, bottom: 10, right: 12)
        statusStack.translatesAutoresizingMaskIntoConstraints = false
        statusPanel.addSubview(statusStack)
        NSLayoutConstraint.activate([
            statusStack.topAnchor.constraint(equalTo: statusPanel.topAnchor),
            statusStack.leadingAnchor.constraint(equalTo: statusPanel.leadingAnchor),
            statusStack.trailingAnchor.constraint(equalTo: statusPanel.trailingAnchor),
            statusStack.bottomAnchor.constraint(equalTo: statusPanel.bottomAnchor)
        ])
        updateReferenceNavigation()
        content.accessibilityIdentifier = "reading-content"
        // Chrome overlays a fixed reading viewport. Tapping the middle changes
        // only its visibility, never pagination or the live navigator's bounds.
        for child in [content, toolbar, footer, statusPanel] {
            child.translatesAutoresizingMaskIntoConstraints = false
            view.addSubview(child)
        }
        NSLayoutConstraint.activate([
            content.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            content.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor)
        ])
        NSLayoutConstraint.activate([
            toolbar.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            toolbar.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            toolbar.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            toolbar.heightAnchor.constraint(equalToConstant: 64),
            // 正文内容避开横屏左右安全区（刘海/灵动岛/侧边 home indicator）；竖屏左右为 0，不变。
            content.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor),
            content.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor),
            footer.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            footer.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            footer.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor),
            footer.heightAnchor.constraint(equalToConstant: 76),
            statusPanel.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 20),
            statusPanel.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -20),
            statusPanel.bottomAnchor.constraint(equalTo: footer.topAnchor, constant: -8)
        ])
        bookmarkRibbon.translatesAutoresizingMaskIntoConstraints = false
        bookmarkRibbon.addTarget(self, action: #selector(togglePageBookmark), for: .touchUpInside)
        bookmarkRibbon.isHidden = true
        bookmarkRibbon.alpha = 0
        view.addSubview(bookmarkRibbon)
        NSLayoutConstraint.activate([
            bookmarkRibbon.trailingAnchor.constraint(equalTo: content.trailingAnchor, constant: -2),
            bookmarkRibbon.topAnchor.constraint(equalTo: content.topAnchor, constant: 74),
            bookmarkRibbon.widthAnchor.constraint(equalToConstant: 24),
            bookmarkRibbon.heightAnchor.constraint(equalToConstant: 34)
        ])
        attachNavigator()
        updateStatusVisibility()
        updateControlsAccessibilityAction()
        NotificationCenter.default.addObserver(self, selector: #selector(background), name: UIApplication.willResignActiveNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(libraryChanged), name: LibraryStore.changed, object: library)
    }
    deinit { NotificationCenter.default.removeObserver(self) }
    private func attachNavigator() {
        applyHighlights()
        if questionOrigin != nil, let target = questionCitation {
            navigator.apply(decorations: [Decoration(id: "citation", locator: target, style: .highlight(tint: BookDesign.selection))], in: "question-citation")
        }
        navigator.observeDecorationInteractions(inGroup: "notes") { [weak self] event in
            guard let self, !self.loading, !self.curlBusy, !self.navigating else { return }
            if self.toolbarHidden {
                self.toggleToolbar()
                return
            }
            guard let note = self.library.books.first(where: { $0.id == self.book.id })?.notes?.first(where: { $0.id.uuidString == event.decoration.id }) else { return }
            self.presentHighlightOptions(for: note)
        }
        addChild(navigator)
        navigator.view.translatesAutoresizingMaskIntoConstraints = false
        content.addSubview(navigator.view)
        NSLayoutConstraint.activate([
            navigator.view.topAnchor.constraint(equalTo: content.topAnchor),
            navigator.view.bottomAnchor.constraint(equalTo: content.bottomAnchor),
            navigator.view.leadingAnchor.constraint(equalTo: content.leadingAnchor),
            navigator.view.trailingAnchor.constraint(equalTo: content.trailingAnchor)
        ])
        navigator.didMove(toParent: self)
    }
    private func applyTheme() {
        overrideUserInterfaceStyle = settings.dark ? .dark : .light
        view.backgroundColor = BookDesign.paper
        view.tintColor = BookDesign.lamp
    }
    private func updateReferenceNavigation() {
        toolbar.configure(
            title: book.title,
            chapter: currentChapter,
            reference: questionOrigin != nil
        )
        toolbar.backButton.accessibilityIdentifier = questionOrigin == nil
            ? "reader-close"
            : "reader-return-question"
        toolbar.backButton.accessibilityLabel = questionOrigin == nil ? "书架" : "返回问答"
    }
    private var footerProgress: String {
        guard let location = pendingLocation ?? navigator.currentLocation else { return "" }
        let value = location.locations.totalProgression ?? location.locations.progression
        guard let value else { return "" }
        return "\(Int((max(0, min(1, value)) * 100).rounded()))%"
    }
    private func updateLocationChrome(_ locator: Locator) {
        if let title = locator.title, !title.isEmpty { currentChapter = title }
        updateReferenceNavigation()
        footer.update(progress: footerProgress, chapter: currentChapter)
    }
    private func setStatus(
        _ text: String,
        error: Bool = false,
        retryVisible: Bool = false,
        visible: Bool = true
    ) {
        // 仅错误状态显示底部提示条；加载中的“正在打开/正在应用设置/正在定位…”等不再弹出。
        status.text = error ? text : ""
        status.textColor = error ? BookDesign.error : BookDesign.secondary
        retry.isHidden = !retryVisible
        retry.isUserInteractionEnabled = retryVisible
        statusRequestedVisible = visible && error
        statusIsError = error
        updateStatusVisibility()
    }
    private func updateStatusVisibility() {
        let showStatus = statusRequestedVisible && (!toolbarHidden || statusIsError)
        statusPanel.alpha = showStatus ? 1 : 0
        statusPanel.isUserInteractionEnabled = showStatus
        statusPanel.accessibilityElementsHidden = !showStatus
        if showStatus { view.bringSubviewToFront(statusPanel) }
    }
    @objc private func openSettings() {
        let controller = ReadingSettingsController(settings: settings) { [weak self] changed in
            self?.changeSettings(changed)
        }
        let sheet = UINavigationController(rootViewController: controller)
        sheet.overrideUserInterfaceStyle = overrideUserInterfaceStyle
        sheet.sheetPresentationController?.detents = [.large()]
        present(sheet, animated: true)
    }
    private func changeSettings(_ changed: ReadingSettings, force: Bool = false, restoring userLocation: Locator? = nil) {
        guard (changed != settings || force), !leaving, !loading, !curlBusy, !navigating else { return }
        // Capture the displayed user page before stop() reparents the native
        // reader. A prefetched neighbor is never a source for reading focus.
        let displayedFocus = readingFocus ?? userLocation ?? curl?.userLocation
        stopCurl()
        loading = true
        recordToolbarLatency()
        invalidateVisibleTextForAcceptance()
        toolbar.settingsButton.isEnabled = false
        toolbar.contentsButton.isEnabled = false
        content.isUserInteractionEnabled = false
        setStatus("正在应用阅读设置…", visible: true)
        navigator.delegate = nil
        Task {
            do {
                var location = displayedFocus
                if location == nil { location = await captureReadingFocus() }
                location = location ?? navigator.currentLocation ?? pendingLocation
                readingFocus = location?.text.highlight == nil ? nil : location
                restoringFocus = readingFocus
                settlingFocus = false
                focusObservation += 1
                // A fresh navigator emits its initial location even for theme-only
                // changes. Save only its settled location with the new preferences.
                let next = try EPUBNavigatorViewController(publication: publication,
                    initialLocation: location,
                    config: Self.configuration(changed))
                loading = true
                toolbar.settingsButton.isEnabled = false
                setRetryVisible(false)
                setStatus("正在应用阅读设置…", visible: true)
                navigator.delegate = nil
                navigator.willMove(toParent: nil)
                navigator.view.removeFromSuperview()
                navigator.removeFromParent()
                navigator = next
                recordToolbarLatency(rebuilt: true)
                settings = changed
                setRetryVisible(saveFailed)
                navigator.delegate = self
                applyTheme()
                attachNavigator()
                refreshBookmarkRibbon()
            } catch { showError() }
        }
    }
    private func captureReadingFocus() async -> Locator? {
        let reader = navigator
        guard var location = await reader.refreshLocationFromViewport(),
              case let .success(anchor as [String: String]) = await reader.evaluateJavaScript(Self.visibleTextAnchor),
              reader === navigator, let selector = anchor["selector"],
              let quote = anchor["highlight"], !quote.isEmpty else { return nil }
        location.locations.cssSelector = selector
        location.locations.otherLocations.removeValue(forKey: "domRange")
        location.text = Locator.Text(after: anchor["after"], before: anchor["before"], highlight: quote)
        return location
    }
    private func sameNativePage(_ lhs: Locator?, _ rhs: Locator) -> Bool {
        guard let lhs else { return false }
        return lhs.href == rhs.href &&
            abs((lhs.locations.progression ?? 0) - (rhs.locations.progression ?? 0)) < 0.0001
    }
    private func locationKeepingFocus(_ native: Locator) -> Locator {
        guard let readingFocus, readingFocus.href.removingFragment() == native.href.removingFragment() else { return native }
        var result = native
        result.locations.cssSelector = readingFocus.locations.cssSelector
        result.locations.otherLocations["domRange"] = readingFocus.locations.otherLocations["domRange"]
        result.text = readingFocus.text
        return result
    }
    // Initial-location callbacks only say that Readium loaded a page. Verify
    // the requested occurrence before publishing it or preparing curl neighbors.
    private func settleRestoredFocus(_ target: Locator) {
        guard !settlingFocus else { return }
        settlingFocus = true
        let reader = navigator
        Task {
            try? await Task.sleep(nanoseconds: 350_000_000)
            var retried = false
            for _ in 0..<60 {
                guard !leaving, !changingBounds, reader === navigator else { return }
                if let actual = await reader.refreshLocationFromViewport(),
                   actual.href.removingFragment() == target.href.removingFragment(),
                   case let .success(visible as Bool) = await reader.evaluateJavaScript(Self.targetIsVisible(target, fullyVisible: true)), visible {
                    restoringFocus = nil
                    settlingFocus = false
                    if settings.pageCurl == true {
                        pendingLocation = actual
                        startCurl()
                    } else { publishNativeLocation(actual, userMoved: false) }
                    return
                }
                if !retried {
                    retried = true
                    _ = await reader.go(to: target, options: .none)
                }
                try? await Task.sleep(nanoseconds: 100_000_000)
            }
            guard reader === navigator, !leaving else { return }
            settlingFocus = false
            showError()
        }
    }
    private func publishNativeLocation(_ locator: Locator, userMoved: Bool) {
        focusObservation += 1
        let observation = focusObservation
        let reader = navigator
        if userMoved { readingFocus = nil }
        pendingLocation = locator
        Task {
            let captured = readingFocus == nil ? await captureReadingFocus() : nil
            guard observation == focusObservation, reader === navigator, !leaving, !changingBounds, !navigating else { return }
            if readingFocus == nil { readingFocus = captured }
            loading = false
            finishedInitialLoad = true
            content.isUserInteractionEnabled = true
            toolbar.settingsButton.isEnabled = true
            toolbar.contentsButton.isEnabled = true
            updateLocationChrome(locator)
            refreshBookmarkRibbon()
            scheduleBookmarkInitialRefresh()
            hideSelectionMenu()
            recordVisibleTextForAcceptance()
            persistPending()
        }
    }
    // Preserve the first visible character, including inside a long paragraph,
    // with element-scoped quotation context rather than a paragraph start.
    fileprivate static let visibleTextAnchor = """
    (() => {
      const visible = r => r.width > 0 && r.height > 0 && r.left >= 0 &&
        r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight;
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node;
      function anchor(node, offset) {
        const parent = node.parentElement, path = [];
        for (let el = parent; el; el = el.parentElement) {
          if (el.id) { path.unshift('#' + CSS.escape(el.id)); break; }
          let index = 1;
          for (let sib = el.previousElementSibling; sib; sib = sib.previousElementSibling)
            if (sib.localName === el.localName) index++;
          path.unshift(el.localName + ':nth-of-type(' + index + ')');
        }
        const prefix = document.createRange();
        prefix.selectNodeContents(parent);
        prefix.setEnd(node, offset);
        const start = prefix.toString().length, text = parent.textContent;
        const highlight = node.textContent.slice(offset, offset + 32);
        return { selector: path.join(' > '), highlight,
          before: text.slice(0, start), after: text.slice(start + highlight.length) };
      }
      while ((node = walker.nextNode())) {
        if (!node.textContent.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        const rects = Array.from(range.getClientRects());
        if (!rects.some(r => r.right > 0 && r.left < innerWidth &&
            r.bottom > 0 && r.top < innerHeight)) continue;
        for (let i = 0; i < node.length; i++) {
          if (!node.textContent[i].trim()) continue;
          range.setStart(node, i); range.setEnd(node, i + 1);
          if (visible(range.getBoundingClientRect())) return anchor(node, i);
        }
      }
      return null;
    })()
    """
    // Fixture acceptance reads fresh DOM character geometry, independently of
    // the curl cache and the restoration target. No release accessibility data.
    private func invalidateVisibleTextForAcceptance() {
        #if DEBUG
        acceptanceObservation += 1
        content.accessibilityValue = nil
        recordToolbarLatency()
        #endif
    }
    private func recordVisibleTextForAcceptance() {
        #if DEBUG
        let arguments = ProcessInfo.processInfo.arguments
        guard arguments.contains("--reader-acceptance"),
              arguments.contains(where: { $0.hasPrefix("--design-fixture=") }) else { return }
        acceptanceObservation += 1
        let observation = acceptanceObservation
        let observed = navigator
        let hostSize = content.bounds.size
        Task {
            let result = await observed.evaluateJavaScript("""
            (() => {
              const runs = [], walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
              const visible = r => r.width > 0 && r.height > 0 && r.left >= 0 &&
                r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight;
              let node;
              while ((node = walker.nextNode())) {
                if (!node.textContent.trim()) continue;
                const root = node.parentElement.closest('[id]') || node.parentElement, path = [];
                for (let el = root; el; el = el.parentElement) {
                  if (el.id) { path.unshift('#' + CSS.escape(el.id)); break; }
                  let index = 1;
                  for (let sib = el.previousElementSibling; sib; sib = sib.previousElementSibling)
                    if (sib.localName === el.localName) index++;
                  path.unshift(el.localName + ':nth-of-type(' + index + ')');
                }
                const prefix = document.createRange();
                prefix.selectNodeContents(root); prefix.setEnd(node, 0);
                const base = prefix.toString().length, range = document.createRange();
                let run = null;
                for (let offset = 0; offset < node.length; offset++) {
                  range.setStart(node, offset); range.setEnd(node, offset + 1);
                  const rect = Array.from(range.getClientRects()).find(visible);
                  if (!rect) { run = null; continue; }
                  if (run && run.end === base + offset) run.end++;
                  else {
                    run = {selector: path.join(' > '), source: root.textContent, start: base + offset, end: base + offset + 1, left: rect.left, top: rect.top};
                    runs.push(run);
                  }
                }
              }
              return JSON.stringify({width: innerWidth, height: innerHeight, runs});
            })()
            """)
            guard observation == acceptanceObservation, observed === navigator, !loading, !curlBusy, !navigating,
                  hostSize == content.bounds.size, case let .success(value as String) = result,
                  let data = value.data(using: .utf8),
                  var observationValue = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
            // A scrolling WKWebView's DOM viewport can be shorter than its
            // native frame (for example by 9pt). Keep the DOM geometry exact;
            // validate observation freshness against its same-sample host size.
            observationValue["hostWidth"] = hostSize.width
            observationValue["hostHeight"] = hostSize.height
            observationValue["observation"] = observation
            recordToolbarLatency(usable: true)
            if let toolbarLatency { observationValue["toolbarLatency"] = try? JSONSerialization.jsonObject(with: JSONEncoder().encode(toolbarLatency)) }
            guard let encoded = try? JSONSerialization.data(withJSONObject: observationValue),
                  let json = String(data: encoded, encoding: .utf8) else { return }
            content.accessibilityValue = json
        }
        #endif
    }
    @objc private func toggleToolbar() {
        guard !leaving, !changingBounds, !navigationFailed, navigator.currentSelection == nil else { return }
        beginToolbarLatency()
        setControlsHidden(!toolbarHidden)
    }
    private func setControlsHidden(_ hidden: Bool) {
        controlsAnimationGeneration += 1
        let generation = controlsAnimationGeneration
        toolbarHidden = hidden
        hideSelectionMenu()
        for control in [toolbar, footer] {
            // Reveal before fading in; stop hit testing and accessibility
            // immediately when fading out so the live page receives taps.
            control.isHidden = false
            control.accessibilityElementsHidden = hidden
            control.isUserInteractionEnabled = !hidden
        }
        updateStatusVisibility()
        UIView.animate(withDuration: UIAccessibility.isReduceMotionEnabled ? 0 : 0.2, delay: 0,
            options: [.beginFromCurrentState, .allowUserInteraction, .curveEaseInOut]) {
            self.toolbar.alpha = hidden ? 0 : 1
            self.footer.alpha = hidden ? 0 : 1
        } completion: { [weak self] _ in
            guard let self, self.controlsAnimationGeneration == generation else { return }
            for control in [self.toolbar, self.footer] { control.isHidden = hidden }
            self.recordToolbarLatency(chrome: true)
            self.recordVisibleTextForAcceptance()
        }
        updateControlsAccessibilityAction()
    }
    private func updateControlsAccessibilityAction() {
        view.accessibilityCustomActions = [
            UIAccessibilityCustomAction(
                name: toolbarHidden ? "显示工具栏" : "隐藏工具栏",
                target: self,
                selector: #selector(toggleToolbar)
            )
        ]
    }
    private func beginToolbarLatency() {
        #if DEBUG
        let arguments = ProcessInfo.processInfo.arguments
        guard arguments.contains("--toolbar-latency-acceptance"), arguments.contains("--reader-acceptance"),
              arguments.contains(where: { $0.hasPrefix("--design-fixture=") }) else { return }
        toolbarLatencyAction += 1
        toolbarLatency = ToolbarLatency(action: toolbarLatencyAction, started: CACurrentMediaTime(),
            targetHidden: !toolbarHidden, navigatorGeneration: acceptanceNavigatorGeneration)
        recordToolbarLatency()
        #endif
    }
    private func recordToolbarLatency(chrome: Bool = false, rebuilt: Bool = false, usable: Bool = false, curlStarted: Bool = false, curlStopped: Bool = false) {
        #if DEBUG
        guard var measurement = toolbarLatency else { return }
        if rebuilt { acceptanceNavigatorGeneration += 1; measurement.rebuilds += 1 }
        if curlStarted { measurement.curlStarts += 1 }
        if curlStopped { measurement.curlStops += 1 }
        measurement.navigatorGeneration = acceptanceNavigatorGeneration
        measurement.enteredLoading = measurement.enteredLoading || loading
        measurement.enteredCurlBusy = measurement.enteredCurlBusy || curlBusy
        measurement.controlsHidden = toolbarHidden
        measurement.interactive = content.isUserInteractionEnabled && !loading && !curlBusy && !navigating
        let elapsed = (CACurrentMediaTime() - measurement.started) * 1000
        if chrome, measurement.chromeMS == nil { measurement.chromeMS = elapsed }
        let finished = usable && measurement.interactive && measurement.usableMS == nil
        if finished { measurement.usableMS = elapsed }
        toolbarLatency = measurement
        guard let encoded = try? JSONEncoder().encode(measurement),
              let fields = try? JSONSerialization.jsonObject(with: encoded) else { return }
        var observation: [String: Any] = [:]
        if let value = content.accessibilityValue, let data = value.data(using: .utf8),
           let current = try? JSONSerialization.jsonObject(with: data) as? [String: Any] { observation = current }
        observation["toolbarLatency"] = fields
        if let data = try? JSONSerialization.data(withJSONObject: observation),
           let value = String(data: data, encoding: .utf8) { content.accessibilityValue = value }
        if finished, let value = String(data: encoded, encoding: .utf8) { print("[ReaderToolbarAcceptance] \(value)") }
        #endif
    }
    /// Readium 默认会把 window 的左右安全区再加到正文上；阅读器容器本身已避开安全区，
    /// 所以这里显式返回水平 0，只保留原有上下留白，避免横屏双重内缩。
    func navigatorContentInset(_ navigator: VisualNavigator) -> UIEdgeInsets? {
        UIEdgeInsets(top: Self.designedGutter, left: 0, bottom: 22, right: 0)
    }

    func navigator(_ navigator: VisualNavigator, didTapAt point: CGPoint) {
        guard curl == nil else { return }
        handleReadingTap(at: point)
    }
    private func handleReadingTap(at point: CGPoint) {
        // A long-press release is also delivered as a tap before Readium has
        // finished propagating the selection. Keep the just-presented menu.
        if selectionMenu != nil {
            guard CACurrentMediaTime() - menuPresentedAt >= 0.45 else { return }
            hideSelectionMenu()
            self.navigator.clearSelection()
            return
        }
        let hasSelection = self.navigator.currentSelection != nil
        if !hasSelection {
            hideSelectionMenu()
        }
        guard !hasSelection else { return }
        guard point.x > content.bounds.width * 0.3, point.x < content.bounds.width * 0.7 else { return }
        toggleToolbar()
    }
    private func setCurlActivationObserver(enabled: Bool) {
        if let token = curlActivationObserver { navigator.removeObserver(token) }
        curlActivationObserver = nil
        guard enabled, let activeCurl = curl else { return }
        let reader = navigator
        // A curl drag can reparent the live WebView before its pointer ends.
        // Start a fresh activation recognizer on every settled page, including
        // a cancelled turn, so an old drag cannot swallow the next tap.
        curlActivationObserver = reader.addObserver(.activate { [weak self, weak reader, weak activeCurl] event in
            guard let self, let reader, let activeCurl, self.navigator === reader,
                  self.curl === activeCurl, !self.curlBusy else { return false }
            self.handleReadingTap(at: event.location)
            return false
        })
    }
    func navigator(_ navigator: Navigator, locationDidChange locator: Locator) {
        guard !leaving, !changingBounds, navigator === self.navigator, !loadFailed, !navigating, !navigationFailed else { return }
        if let target = openingTarget {
            openingTarget = nil
            restoringFocus = nil
            loading = false
            navigate(to: target)
            return
        }
        if let restoringFocus {
            settleRestoredFocus(restoringFocus)
            return
        }
        if let curl {
            if curl.locationChanged(locator) { return }
            stopCurl()
        }
        if settings.pageCurl == true {
            if !loading { readingFocus = nil }
            pendingLocation = locator
            refreshBookmarkRibbon()
            startCurl()
            return
        }
        publishNativeLocation(locator, userMoved: !loading && !sameNativePage(pendingLocation, locator))
    }
    private func setRetryVisible(_ visible: Bool) {
        retry.isHidden = !visible
        retry.accessibilityElementsHidden = !visible
        retry.isUserInteractionEnabled = visible
    }
    private func persistPending() {
        guard !leaving, !changingBounds, !loading, !curlBusy, !navigating, !navigationFailed, let pendingLocation else { return }
        do {
            try library.checkRevision(bookRevision, for: book.id)
            try library.saveReadingState(locationKeepingFocus(pendingLocation), settings: settings, for: book.id)
            saveFailed = false
            setStatus("阅读位置已保存", visible: false)
        } catch {
            saveFailed = true
            setStatus(
                "位置与设置保存失败，重启将恢复上次已保存状态",
                error: true,
                retryVisible: true
            )
        }
    }
    @objc private func libraryChanged() { refreshBookmarkRibbon() }

    /// 页角书签丝带：当前页（href + progression/可见原文锚点）有书签时显示。
    private func refreshBookmarkRibbon() {
        guard isViewLoaded else { return }
        bookmarkRefreshGeneration += 1
        let generation = bookmarkRefreshGeneration
        guard !leaving, finishedInitialLoad, !loading, !navigating,
              let location = pendingLocation ?? navigator.currentLocation else {
            applyBookmarkMatches([])
            return
        }
        let bookmarks = library.books.first(where: { $0.id == book.id })?.bookmarks ?? []
        let resource = location.href.removingFragment()
        let candidates = bookmarks.filter { bookmark in
            guard let saved = try? bookmark.location() else { return false }
            return saved.href.removingFragment() == resource
        }
        let fastMatches = candidates.filter { isBookmarkOnCurrentPage($0, location: location, focus: readingFocus) }
        #if DEBUG
        NSLog("SHUDENG_BOOKMARK candidates=%ld fast=%ld resource=%@ progression=%@",
              candidates.count, fastMatches.count, String(describing: resource),
              String(describing: location.locations.progression))
        #endif
        if !fastMatches.isEmpty || candidates.isEmpty {
            applyBookmarkMatches(fastMatches)
            return
        }
        // 首次恢复时页起点段落与书签段落可能不同（例：书签在首屏第一段之前），
        // 用 DOM 确认书签原文范围是否真的落在当前视口内。
        var expectationIDs: [String] = []
        var expectations: [[String: Any]] = []
        for bookmark in candidates {
            guard let saved = try? bookmark.location(),
                  let selector = saved.locations.cssSelector, !selector.isEmpty,
                  let quote = saved.text.highlight, !quote.isEmpty else { continue }
            var expectation: [String: Any] = [
                "id": bookmark.id.uuidString,
                "selector": selector,
                "quote": quote
            ]
            if let before = saved.text.before { expectation["beforeLength"] = before.utf16.count }
            expectationIDs.append(bookmark.id.uuidString)
            expectations.append(expectation)
        }
        guard !expectations.isEmpty,
              let data = try? JSONSerialization.data(withJSONObject: expectations),
              let json = String(data: data, encoding: .utf8) else {
            applyBookmarkMatches([])
            return
        }
        let reader = navigator
        Task {
            guard case let .success(result as String) = await reader.evaluateJavaScript(Self.bookmarkVisibilityScript(json)),
                  generation == bookmarkRefreshGeneration,
                  reader === navigator, !leaving, !loading, !navigating,
                  let resultData = result.data(using: .utf8),
                  let flags = try? JSONDecoder().decode([Bool].self, from: resultData),
                  flags.count == expectationIDs.count,
                  let current = pendingLocation ?? navigator.currentLocation,
                  sameNativePage(current, location) || current.href == location.href else { return }
            let visibleIDs = Set(zip(expectationIDs, flags).filter { $0.1 }.map { $0.0 })
            #if DEBUG
            NSLog("SHUDENG_BOOKMARK domVisible=%@", visibleIDs.description)
            #endif
            applyBookmarkMatches(candidates.filter { visibleIDs.contains($0.id.uuidString) })
        }
    }

    private func applyBookmarkMatches(_ matches: [Bookmark]) {
        pageBookmarks = matches
        let visible = !matches.isEmpty
        bookmarkRibbon.accessibilityLabel = visible ? "取消本页书签" : "添加本页书签"
        bookmarkRibbon.accessibilityValue = visible ? "此页已有书签" : nil
        bookmarkRibbon.accessibilityHint = visible ? "轻点删除此页书签" : "轻点在此页添加书签"
        setBookmarkRibbonVisible(visible)
    }

    /// 首屏布局/恢复完成后再补一次刷新，避免首次视口尚未稳定时 DOM 可见性判定为 false。
    private func scheduleBookmarkInitialRefresh() {
        guard !bookmarkInitialRefreshScheduled else { return }
        bookmarkInitialRefreshScheduled = true
        Task { [weak self] in
            try? await Task.sleep(nanoseconds: 400_000_000)
            self?.refreshBookmarkRibbon()
        }
    }

    private static func bookmarkVisibilityScript(_ expectationsJSON: String) -> String {
        """
        (() => {
          const expectations = \(expectationsJSON);
          const visible = r => r.width > 0 && r.height > 0 &&
            r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
          function point(root, offset) {
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
            let seen = 0, node;
            while ((node = walker.nextNode())) {
              const next = seen + node.textContent.length;
              if (offset <= next) return { node: node, offset: offset - seen };
              seen = next;
            }
            return null;
          }
          return JSON.stringify(expectations.map(e => {
            const root = document.querySelector(e.selector);
            if (!root || !e.quote) return false;
            const text = root.textContent;
            let start = typeof e.beforeLength === 'number' ? e.beforeLength : text.indexOf(e.quote);
            if (start < 0 || start + e.quote.length > text.length) start = text.indexOf(e.quote);
            if (start < 0) return false;
            const a = point(root, start), b = point(root, start + e.quote.length);
            if (!a || !b) return false;
            const range = document.createRange();
            try { range.setStart(a.node, a.offset); range.setEnd(b.node, b.offset); } catch (_) { return false; }
            return Array.from(range.getClientRects()).some(visible);
          }));
        })()
        """
    }

    private func isBookmarkOnCurrentPage(_ bookmark: Bookmark, location: Locator, focus: Locator?) -> Bool {
        guard let saved = try? bookmark.location(),
              saved.href.removingFragment() == location.href.removingFragment() else { return false }
        // 同一原生页：progression 一致时直接命中。
        if sameNativePage(saved, location) { return true }
        // 同一页/同一段落：恢复位置与已保存书签的 progression 可能不同步（例如页首 0.08 与恢复 0.18），
        // 但 cssSelector 或可见原文锚点一致，视为同一页书签。
        if let selector = saved.locations.cssSelector, !selector.isEmpty,
           selector == location.locations.cssSelector || selector == focus?.locations.cssSelector {
            return true
        }
        if let highlight = saved.text.highlight, !highlight.isEmpty,
           highlight == location.text.highlight || highlight == focus?.text.highlight {
            return true
        }
        guard let savedProgression = saved.locations.totalProgression ?? saved.locations.progression,
              let currentProgression = location.locations.totalProgression ?? location.locations.progression else { return false }
        return abs(savedProgression - currentProgression) < 0.001
    }

    private func setBookmarkRibbonVisible(_ visible: Bool) {
        guard visible != bookmarkRibbonVisible else { return }
        bookmarkRibbonVisible = visible
        if visible {
            bookmarkRibbon.isHidden = false
            bookmarkRibbon.alpha = 0
            bookmarkRibbon.transform = CGAffineTransform(scaleX: 0.7, y: 0.7)
            UIView.animate(withDuration: UIAccessibility.isReduceMotionEnabled ? 0 : 0.22,
                           delay: 0,
                           usingSpringWithDamping: 0.72,
                           initialSpringVelocity: 0.4) {
                self.bookmarkRibbon.alpha = 1
                self.bookmarkRibbon.transform = .identity
            }
        } else {
            UIView.animate(withDuration: UIAccessibility.isReduceMotionEnabled ? 0 : 0.15) {
                self.bookmarkRibbon.alpha = 0
            } completion: { _ in
                if !self.bookmarkRibbonVisible { self.bookmarkRibbon.isHidden = true }
            }
        }
    }

    @objc private func togglePageBookmark() {
        guard !leaving, finishedInitialLoad, !loading, !curlBusy, !navigating else { return }
        if !pageBookmarks.isEmpty {
            do {
                try library.checkRevision(bookRevision, for: book.id)
                for bookmark in pageBookmarks { try library.removeBookmark(bookmark.id, for: book.id) }
                UISelectionFeedbackGenerator().selectionChanged()
                refreshBookmarkRibbon()
            } catch {
                showBookmarkFailure(title: "无法移除书签", message: "书签未被删除，可返回后重试。")
            }
            return
        }
        guard let base = pendingLocation ?? navigator.currentLocation else {
            showBookmarkFailure(title: "无法添加书签", message: "当前没有可确认的原文位置，请返回正文后重试。")
            return
        }
        let reader = navigator
        Task {
            do {
                try library.checkRevision(bookRevision, for: book.id)
                var location = base
                if case let .success(anchor as [String: String]) = await reader.evaluateJavaScript(Self.visibleTextAnchor),
                   reader === navigator,
                   let selector = anchor["selector"], let highlight = anchor["highlight"], !highlight.isEmpty {
                    location.locations.cssSelector = selector
                    location.locations.otherLocations.removeValue(forKey: "domRange")
                    location.text = Locator.Text(after: anchor["after"], before: anchor["before"], highlight: highlight)
                }
                try library.saveBookmark(Bookmark(locator: location), for: book.id)
                UIImpactFeedbackGenerator(style: .light).impactOccurred()
                refreshBookmarkRibbon()
            } catch {
                showBookmarkFailure(title: "无法添加书签", message: "当前没有可确认的原文位置，请返回正文后重试。")
            }
        }
    }

    private func showBookmarkFailure(title: String, message: String) {
        guard !leaving, presentedViewController == nil else { return }
        let alert = BookAlertController(title: title, message: message, preferredStyle: .alert)
        alert.addAction(BookAlertAction(title: "知道了", style: .cancel))
        present(alert, animated: true)
    }

    @objc private func retrySave() {
        if loadFailed {
            stopCurl()
            loadFailed = false
            loading = true
            setRetryVisible(false)
            setStatus("正在重新打开…", visible: true)
            navigator.delegate = nil
            navigator.willMove(toParent: nil)
            navigator.view.removeFromSuperview()
            navigator.removeFromParent()
            do {
                navigator = try EPUBNavigatorViewController(publication: publication, initialLocation: pendingLocation,
                    config: Self.configuration(settings))
                navigator.delegate = self
                attachNavigator()
            } catch { showError() }
        } else { persistPending() }
    }
    @objc private func background() { persistPending() }
    @objc private func closeReader() {
        if questionOrigin != nil { backToQuestion(); return }
        // 首次加载完成前返回：不做“未保存”拦截，避免刚打开书就弹警告。
        if !finishedInitialLoad { finishReading(); return }
        persistPending()
        guard !saveFailed, !loading else {
            let alert = BookAlertController(title: "位置与设置尚未保存", message: "返回书架后，未保存的变更可能丢失。", preferredStyle: .alert)
            alert.addAction(BookAlertAction(title: "留在阅读页", style: .cancel))
            alert.addAction(BookAlertAction(title: "仍然返回", style: .destructive) { [weak self] _ in self?.finishReading() })
            present(alert, animated: true)
            return
        }
        finishReading()
    }
    private func finishReading() {
        leaving = true
        navigator.delegate = nil
        stopCurl()
        dismiss(animated: true)
    }
    func navigator(_ navigator: Navigator, presentError error: NavigatorError) { showError() }
    func navigator(_ navigator: Navigator, didFailToLoadResourceAt href: RelativeURL, withError error: ReadError) { showError() }
    private func showError() {
        guard !leaving else { return }
        stopCurl()
        setStatus("原文加载失败，未保存此次变更", error: true, retryVisible: true)
        loadFailed = true
        loading = true
        content.isUserInteractionEnabled = false
        toolbar.settingsButton.isEnabled = false
        toolbar.contentsButton.isEnabled = false
        saveFailed = true
        guard presentedViewController == nil else { return }
        let alert = BookAlertController(title: "原文加载失败", message: "无法读取此处内容，请返回书架后重新打开。", preferredStyle: .alert)
        alert.addAction(BookAlertAction(title: "知道了", style: .default))
        present(alert, animated: true)
    }

    @objc private func openNavigation() {
        let controller = BookNavigationController(publication: publication, library: library, bookID: book.id,
            capture: { [weak self] in
                guard let self, !self.navigationFailed, !self.loading,
                      var location = self.navigator.currentLocation,
                      case let .success(anchor as [String: String]) = await self.navigator.evaluateJavaScript(Self.visibleTextAnchor),
                      let selector = anchor["selector"], let highlight = anchor["highlight"], !highlight.isEmpty else {
                    throw LibraryError.invalidLocation
                }
                location.locations.cssSelector = selector
                location.text = Locator.Text(after: anchor["after"], before: anchor["before"], highlight: highlight)
                return Bookmark(locator: location)
            }, navigate: { [weak self] location in self?.navigate(to: location) })
        let sheet = UINavigationController(rootViewController: controller)
        sheet.overrideUserInterfaceStyle = overrideUserInterfaceStyle
        sheet.sheetPresentationController?.detents = [.large()]
        present(sheet, animated: true)
    }

    private func navigate(to target: Locator, completion: ((Bool) -> Void)? = nil) {
        guard (try? library.checkRevision(bookRevision, for: book.id)) != nil, library.sourceAvailable(for: book.id) else { completion?(false); return }
        guard !loading, !navigating else { completion?(false); return }
        stopCurl()
        navigating = true
        navigationFailed = false
        content.isUserInteractionEnabled = false
        for button in [
            toolbar.contentsButton,
            toolbar.settingsButton,
            toolbar.backButton
        ] { button.isEnabled = false }
        setStatus("正在定位原文…", visible: true)
        Task {
            // Do not allow Readium's fallback to a different resource/progression
            // to masquerade as a valid bookmark or table-of-contents destination.
            let resource = target.href.removingFragment()
            let validResource = publication.readingOrder.contains { $0.url().removingFragment() == resource }
            let accepted = validResource ? await navigator.go(to: target, options: .init(animated: false)) : false
            var arrived = false
            if accepted {
                // Wait beyond Readium's scroll-end debounce, then refresh from
                // the native viewport even when the jump stayed on the same page.
                try? await Task.sleep(nanoseconds: 350_000_000)
                var retried = false
                for _ in 0..<60 {
                    if loadFailed { break }
                    // Readium can expose the pending search Locator before its
                    // native position is recomputed. Never seed curl caches with
                    // that temporary selector/quote and a fallback progression.
                    if let current = await navigator.refreshLocationFromViewport(),
                       current.href.removingFragment() == resource,
                       current.locations.progression != nil,
                       current.locations.cssSelector == nil, current.locations.domRange == nil,
                       current.text.highlight == nil,
                       case let .success(visible as Bool) = await navigator.evaluateJavaScript(Self.targetIsVisible(target)) {
                        if visible {
                            arrived = true
                            break
                        }
                        if !retried {
                            retried = true
                            _ = await navigator.go(to: target, options: .init(animated: false))
                        }
                    }
                    try? await Task.sleep(nanoseconds: 100_000_000)
                }
            }
            if arrived { try? await Task.sleep(nanoseconds: 350_000_000) }
            navigating = false
            toolbar.backButton.isEnabled = true
            guard !loadFailed else { completion?(false); return }
            toolbar.contentsButton.isEnabled = true
            toolbar.settingsButton.isEnabled = arrived
            content.isUserInteractionEnabled = arrived
            navigationFailed = !arrived
            if arrived, let actual = navigator.currentLocation {
                focusObservation += 1
                readingFocus = target.text.highlight == nil ? await captureReadingFocus() : target
                restoringFocus = nil
                pendingLocation = actual
                updateLocationChrome(actual)
                refreshBookmarkRibbon()
                if settings.pageCurl == true { startCurl() }
                else { persistPending() }
            } else {
                setStatus("未能到达原文，未保存此次跳转；请重新选择目录或书签", error: true)
                let alert = BookAlertController(title: "无法定位原文", message: "目标位置无效或原文未显示，未覆盖上次阅读位置。", preferredStyle: .alert)
                alert.addAction(BookAlertAction(title: "知道了", style: .default))
                present(alert, animated: true)
            }
            completion?(arrived)
        }
    }

    private func startCurl() {
        guard !leaving, curl == nil else { return }
        recordToolbarLatency(curlStarted: true)
        navigator.nativePaginationEnabled = false
        curlSize = content.bounds.size
        let controller = ReaderCurlController(reader: navigator, publication: publication, host: content, parent: self,
            requiredFocus: readingFocus,
            highlightsReady: { [weak self] in await self?.highlightsReady() ?? false },
            busy: { [weak self] in
                guard let self else { return }
                self.curlBusy = true
                self.setCurlActivationObserver(enabled: false)
                self.invalidateVisibleTextForAcceptance()
                self.toolbar.settingsButton.isEnabled = false
                self.toolbar.contentsButton.isEnabled = false
                self.setStatus("正在准备翻页…", visible: true)
            }, userTurned: { [weak self] focus in
                self?.focusObservation += 1
                self?.readingFocus = focus
            }, settled: { [weak self] actual, pageFocus, commit in
                guard let self else { return }
                if self.readingFocus == nil { self.readingFocus = pageFocus }
                self.curlBusy = false; self.loading = false
                self.content.isUserInteractionEnabled = true
                self.toolbar.settingsButton.isEnabled = true
                self.toolbar.contentsButton.isEnabled = true
                if commit {
                    self.pendingLocation = actual
                    self.updateLocationChrome(actual)
                    self.persistPending()
                }
                else if self.saveFailed {
                    self.setStatus("位置与设置保存失败", error: true, retryVisible: true)
                } else {
                    self.setStatus("阅读位置已保存", visible: false)
                }
                self.refreshBookmarkRibbon()
                self.view.setNeedsLayout()
                self.setCurlActivationObserver(enabled: true)
                self.recordVisibleTextForAcceptance()
            }, failed: { [weak self] in self?.curlPreparationFailed() })
        curl = controller
        addChild(controller)
        controller.view.frame = content.bounds
        controller.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        content.addSubview(controller.view)
        controller.didMove(toParent: self)
        controller.start()
    }
    private func stopCurl() {
        setCurlActivationObserver(enabled: false)
        if curl != nil { recordToolbarLatency(curlStopped: true) }
        invalidateVisibleTextForAcceptance()
        curl?.stop()
        curl = nil; curlBusy = false
    }
    private func curlPreparationFailed() {
        guard !leaving else { return }
        stopCurl()
        loadFailed = true; loading = true
        content.isUserInteractionEnabled = false
        toolbar.settingsButton.isEnabled = false
        toolbar.contentsButton.isEnabled = false
        setStatus("仿真翻页准备失败，请重试或使用分页", error: true, retryVisible: true)
        let alert = BookAlertController(title: "翻页准备失败", message: "未保存内部准备位置，可重试或恢复普通分页阅读。", preferredStyle: .alert)
        alert.addAction(BookAlertAction(title: "使用分页", style: .default) { [weak self] _ in
            self?.settings.pageCurl = false
            self?.retrySave()
        })
        alert.addAction(BookAlertAction(title: "稍后重试", style: .cancel))
        if presentedViewController == nil { present(alert, animated: true) }
    }
    override func viewWillTransition(to size: CGSize, with coordinator: UIViewControllerTransitionCoordinator) {
        super.viewWillTransition(to: size, with: coordinator)
        let userLocation = readingFocus ?? curl?.userLocation ?? pendingLocation
        focusObservation += 1
        changingBounds = true
        stopCurl()
        coordinator.animate(alongsideTransition: nil) { [weak self] _ in
            guard let self, !self.leaving else { return }
            self.changingBounds = false
            self.loading = false
            self.changeSettings(self.settings, force: true, restoring: userLocation)
        }
    }
    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        refreshBookmarkRibbon()
        scheduleBookmarkInitialRefresh()
    }
    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        // New bounds require new pagination and snapshots, including rotation and
        // Dynamic Type changes to the surrounding chrome. Never reuse old images.
        if curl != nil, !changingBounds, !loading, !navigating, !curlBusy, content.bounds.size != curlSize {
            changeSettings(settings, force: true)
        }
    }

    private var notes: [BookNote] { library.books.first { $0.id == book.id }?.notes ?? [] }

    private var highlightSignatures: [String] {
        notes.map { note in
            note.body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                ? note.id.uuidString + ":highlight:" + note.highlightColor.rawValue
                : note.id.uuidString + ":note"
        }
    }
    private func applyHighlights() {
        appliedHighlightSignatures = highlightSignatures
        let traits = traitCollection
        // 笔记使用固定暖灯色波浪线（不再跟随 4 色）；高亮仍按用户选择的颜色。
        let noteTint = BookDesign.lampInk.resolvedColor(with: traits)
        navigator.apply(decorations: notes.compactMap { note in
            guard let locator = try? note.location() else { return nil }
            if note.body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                return Decoration(
                    id: note.id.uuidString,
                    locator: locator,
                    style: .highlight(tint: note.highlightColor.tint.resolvedColor(with: traits))
                )
            }
            return Decoration(
                id: note.id.uuidString,
                locator: locator,
                style: Decoration.Style(id: Self.noteWaveStyleID, config: Decoration.Style.HighlightConfig(tint: noteTint))
            )
        }, in: "notes")
    }
    // Readium applies decorations asynchronously. Verify actual ranges before
    // capturing a curl snapshot, including newly loaded neighboring resources.
    private func highlightsReady() async -> Bool {
        let reader = navigator
        guard let href = reader.currentLocation?.href.removingFragment() else { return false }
        let expected = notes.compactMap { note -> HighlightExpectation? in
            guard let locator = try? note.location(),
                  locator.href.removingFragment() == href else { return nil }
            return HighlightExpectation(
                id: note.id.uuidString,
                selector: locator.locations.cssSelector,
                before: locator.text.before,
                highlight: locator.text.highlight
            )
        }
        guard !expected.isEmpty else { return true }
        let expectations = String(data: try! JSONEncoder().encode(expected), encoding: .utf8)!
        let script = """
        (() => {
          const expectations = \(expectations), items = readium.getDecorations('notes').items;
          function point(root, target) {
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
            let seen = 0, node;
            while ((node = walker.nextNode())) {
              const next = seen + node.textContent.length;
              if (target <= next) return { node, offset: target - seen };
              seen = next;
            }
            return null;
          }
          function visible(note) {
            if (!note.selector || !note.highlight) return true;
            const root = document.querySelector(note.selector);
            if (!root) return false;
            const text = root.textContent;
            let start = note.before != null && text.slice(0, note.before.length) === note.before
              ? note.before.length : text.indexOf(note.highlight);
            if (start < 0) return false;
            const first = point(root, start), last = point(root, start + note.highlight.length);
            if (!first || !last) return false;
            const range = document.createRange();
            range.setStart(first.node, first.offset); range.setEnd(last.node, last.offset);
            return Array.from(range.getClientRects()).some(rect =>
              rect.right > 0 && rect.left < innerWidth && rect.bottom > 0 && rect.top < innerHeight);
          }
          return expectations.every(note => {
            if (!visible(note)) return true;
            const item = items.find(i => i.decoration.id === note.id);
            if (!item || !item.container || !item.container.childElementCount) return false;
            const loc = item.decoration.locator;
            if (note.highlight != null && item.range.toString() !== note.highlight) return false;
            if (note.before == null || !loc.locations.cssSelector) return true;
            const root = document.querySelector(loc.locations.cssSelector);
            if (!root) return false;
            const prefix = document.createRange(); prefix.selectNodeContents(root);
            prefix.setEnd(item.range.startContainer, item.range.startOffset);
            return prefix.toString() === loc.text.before;
          });
        })()
        """
        for _ in 0..<60 {
            guard !leaving, navigator === reader, !Task.isCancelled else { return false }
            if case let .success(ready as Bool) = await reader.evaluateJavaScript(script), ready { return true }
            try? await Task.sleep(nanoseconds: 100_000_000)
        }
        return false
    }
    private func refreshHighlights() {
        guard appliedHighlightSignatures != highlightSignatures else { return }
        let wasCurl = curl != nil
        stopCurl() // Discard every neighbor snapshot on annotation changes.
        applyHighlights()
        Task {
            guard await highlightsReady() else {
                setStatus("高亮未能显示，请返回书架后重试；已保存记录仍在笔记中", error: true)
                return
            }
            if wasCurl { startCurl() }
        }
    }
    private func edit(_ note: BookNote) {
        navigator.clearSelection()
        let editor = NoteEditorController(library: library, bookID: book.id, note: note,
            changed: { [weak self] in self?.refreshHighlights() })
        // NoteEditor 自带 overFullScreen 底部卡片与滑入动画，这里不再包系统 sheet。
        editor.overrideUserInterfaceStyle = overrideUserInterfaceStyle
        present(editor, animated: false)
    }
    private static let preferredHighlightColorKey = "reader-highlight-color"
    private var preferredHighlightColor: HighlightColor {
        HighlightColor(rawValue: UserDefaults.standard.string(forKey: Self.preferredHighlightColorKey) ?? "") ?? .yellow
    }
    private func rememberHighlightColor(_ color: HighlightColor) {
        UserDefaults.standard.set(color.rawValue, forKey: Self.preferredHighlightColorKey)
    }
    /// Apple Books / 微信读书式：先按上次颜色立即上色，再弹轻量调色条微调。
    private func chooseHighlightColor(for selection: Selection) {
        guard !loading, !curlBusy, !navigating else { return }
        hideSelectionMenu()
        hideHighlightColorBar()
        Task {
            do {
                let (_, base) = try await capturedHighlightAnchor(selection)
                guard saveHighlight(base, color: preferredHighlightColor) else { return }
                showHighlightColorBar(for: base, selected: preferredHighlightColor)
            } catch {
                let alert = BookAlertController(title: "无法保存选文", message: "未能确认原文选区，请重新选择。", preferredStyle: .alert)
                alert.addAction(BookAlertAction(title: "知道了", style: .cancel))
                present(alert, animated: true)
            }
        }
    }
    private func showHighlightColorBar(for note: BookNote, selected: HighlightColor) {
        hideHighlightColorBar()
        let catcher = UIView()
        catcher.backgroundColor = .clear
        catcher.translatesAutoresizingMaskIntoConstraints = false
        catcher.accessibilityIdentifier = "highlight-color-bar-dismiss"
        view.addSubview(catcher)
        NSLayoutConstraint.activate([
            catcher.topAnchor.constraint(equalTo: view.topAnchor),
            catcher.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            catcher.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            catcher.trailingAnchor.constraint(equalTo: view.trailingAnchor)
        ])
        catcher.addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(dismissHighlightColorBar)))
        highlightColorCatcher = catcher

        let bar = HighlightColorBar(selected: selected)
        var current = selected
        bar.onPick = { [weak self] color in
            guard let self, color != current else { return }
            current = color
            self.rememberHighlightColor(color)
            self.updateHighlightColor(color, noteID: note.id)
            self.highlightColorBar?.update(selected: color)
        }
        bar.onClose = { [weak self] in self?.hideHighlightColorBar() }
        bar.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(bar)
        bar.place(in: view)
        highlightColorBar = bar
        bar.appear()
    }
    @objc private func dismissHighlightColorBar() { hideHighlightColorBar() }
    private func hideHighlightColorBar() {
        highlightColorCatcher?.removeFromSuperview()
        highlightColorCatcher = nil
        guard let bar = highlightColorBar else { return }
        highlightColorBar = nil
        bar.disappear { bar.removeFromSuperview() }
    }
    /// 在弹调色盘前先固定选区的 DOM 锚点，避免模态呈现后选区失效。
    private func capturedHighlightAnchor(_ selection: Selection) async throws -> (locator: Locator, note: BookNote) {
        guard case let .success(anchor as [String: Any]) = await navigator.evaluateJavaScript(Self.selectionAnchor),
              let selector = anchor["selector"] as? String,
              let highlight = anchor["highlight"] as? String, !highlight.isEmpty,
              let range = anchor["domRange"] as? [String: Any] else { throw LibraryError.invalidLocation }
        var locator = selection.locator
        locator.locations.cssSelector = selector
        locator.locations.otherLocations["domRange"] = try JSONValue(
            jsonString: String(data: JSONSerialization.data(withJSONObject: range), encoding: .utf8)!,
            warnings: nil
        )
        locator.text = Locator.Text(after: anchor["after"] as? String, before: anchor["before"] as? String, highlight: highlight)
        let candidates = notes + (library.books.first { $0.id == book.id }?.noteDrafts ?? [])
        let existing = candidates.first { note in
            guard let saved = try? note.location() else { return false }
            return saved.href == locator.href && saved.locations.domRange == locator.locations.domRange && saved.text == locator.text
        }
        return (locator, existing ?? BookNote(locator: locator))
    }
    private func presentHighlightOptions(for note: BookNote) {
        navigator.clearSelection()
        let hasBody = !note.body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        if hasBody {
            // 点波浪线笔记直接进编辑弹层（不再有「查看笔记」中间层）。
            edit(note)
        } else {
            presentHighlightColorPalette(
                selected: note.highlightColor,
                onPick: { [weak self] color in self?.applyHighlightColor(color, to: note) },
                onDelete: { [weak self] in self?.deleteHighlight(note) },
                deleteTitle: "取消高亮"
            )
        }
    }
    private func updateHighlightColor(_ color: HighlightColor, noteID: UUID) {
        do {
            try library.checkRevision(bookRevision, for: book.id)
            try library.updateNoteColor(color, forNoteID: noteID, bookID: book.id)
            UISelectionFeedbackGenerator().selectionChanged()
            refreshHighlights()
        } catch {
            let alert = BookAlertController(title: "颜色保存失败", message: "高亮颜色未保存，可重试。", preferredStyle: .alert)
            alert.addAction(BookAlertAction(title: "知道了", style: .cancel))
            present(alert, animated: true)
        }
    }
    private func applyHighlightColor(_ color: HighlightColor, to note: BookNote) {
        guard note.highlightColor != color else { return }
        rememberHighlightColor(color)
        do {
            try library.checkRevision(bookRevision, for: book.id)
            try library.updateNoteColor(color, forNoteID: note.id, bookID: book.id)
            UISelectionFeedbackGenerator().selectionChanged()
            refreshHighlights()
        } catch {
            let alert = BookAlertController(title: "颜色保存失败", message: "高亮颜色未保存，可重试。", preferredStyle: .alert)
            alert.addAction(BookAlertAction(title: "知道了", style: .cancel))
            present(alert, animated: true)
        }
    }
    private func presentHighlightColorPalette(
        selected: HighlightColor?,
        onPick: @escaping (HighlightColor) -> Void,
        onDelete: (() -> Void)? = nil,
        deleteTitle: String = "删除高亮"
    ) {
        guard presentedViewController == nil else { return }
        hideSelectionMenu()
        let palette = HighlightColorPaletteController(
            selected: selected, onPick: onPick, onDelete: onDelete, deleteTitle: deleteTitle
        )
        palette.overrideUserInterfaceStyle = overrideUserInterfaceStyle
        present(palette, animated: true)
    }
    private func deleteHighlight(_ note: BookNote) {
        do {
            try library.checkRevision(bookRevision, for: book.id)
            try library.removeNote(note.id, bookID: book.id)
            UISelectionFeedbackGenerator().selectionChanged()
            refreshHighlights()
        } catch {
            let alert = BookAlertController(title: "删除失败", message: "内容未被删除，可重试。", preferredStyle: .alert)
            alert.addAction(BookAlertAction(title: "知道了", style: .cancel))
            present(alert, animated: true)
        }
    }
    func navigator(
        _ navigator: SelectableNavigator,
        shouldShowMenuForSelection selection: Selection
    ) -> Bool {
        guard navigator === self.navigator, questionOrigin == nil,
              !loading, !curlBusy, !navigating else {
            hideSelectionMenu()
            return false
        }
        presentSelectionMenu(for: selection)
        return false
    }
    private func presentSelectionMenu(for selection: Selection) {
        hideSelectionMenu()
        let fallback = selection.frame.map { navigator.view.convert($0, to: view) }
        Task { [weak self] in
            guard let self else { return }
            var selectionFrame = fallback
            if case let .success(bounds as [String: Any]) =
                await self.navigator.evaluateJavaScript(Self.selectionBounds),
               let x = bounds["x"] as? CGFloat,
               let y = bounds["y"] as? CGFloat,
               let width = bounds["width"] as? CGFloat,
               let height = bounds["height"] as? CGFloat,
               width > 0, height > 0 {
                selectionFrame = self.navigator.view.convert(
                    CGRect(x: x, y: y, width: width, height: height),
                    to: self.view
                )
            }
            guard let selectionFrame,
                  self.navigator.currentSelection != nil,
                  self.selectionMenu == nil else { return }

            let menu = ReaderSelectionMenu()
            menu.onHighlight = { [weak self] in
                self?.chooseHighlightColor(for: selection)
            }
            menu.onNote = { [weak self] in
                self?.captureSelection(writeNote: true, selection: selection)
            }
            menu.onAsk = { [weak self] in
                self?.captureSelection(writeNote: false, question: true, selection: selection)
            }
            self.view.addSubview(menu)
            menu.place(in: self.view, above: selectionFrame)
            self.selectionMenu = menu
            self.menuPresentedAt = CACurrentMediaTime()
        }
    }
    private func hideSelectionMenu() {
        selectionMenu?.removeFromSuperview()
        selectionMenu = nil
        menuPresentedAt = 0
    }
    @objc private func highlightSelection() {
        guard let selection = navigator.currentSelection else { return }
        chooseHighlightColor(for: selection)
    }
    @objc private func noteSelection() { captureSelection(writeNote: true) }
    @objc private func askSelection() { captureSelection(writeNote: false, question: true) }
    @objc private func askCurrentBook() {
        if let activeQuestion {
            (activeQuestion.viewControllers.first as? QuestionController)?.restoreReferenceFocus()
            present(activeQuestion, animated: true)
            return
        }
        guard (try? library.checkRevision(bookRevision, for: book.id)) != nil, library.sourceAvailable(for: book.id) else { return }
        guard !loading, !curlBusy, !navigating, !library.questions.loadFailed, let origin = navigator.currentLocation else { return }
        let record = ReadingQuestion(book: book, origin: origin)
        library.questions.save(record)
        navigator.clearSelection()
        let controller = QuestionController(library: library, id: record.id) { [weak self] target, origin in
            self?.showQuestionReference(target, origin: origin)
        }
        let navigation = UINavigationController(rootViewController: controller)
        activeQuestion = navigation
        navigation.overrideUserInterfaceStyle = overrideUserInterfaceStyle
        QuestionSheetPresentation.configure(navigation)
        present(navigation, animated: true)
    }
    private func showQuestionReference(_ target: Locator, origin: Locator) {
        guard !loading, !navigating, !curlBusy else { return }
        questionOrigin = origin
        questionCitation = target
        hideSelectionMenu()
        navigator.clearSelection()
        navigator.apply(decorations: [Decoration(id: "citation", locator: target, style: .highlight(tint: BookDesign.selection))], in: "question-citation")
        navigate(to: target)
    }
    @objc private func backToQuestion() {
        guard loadFailed || (!loading && !navigating && !curlBusy) else { return }
        persistPending()
        if saveFailed {
            let alert = BookAlertController(title: "位置与设置尚未保存", message: "返回问答后，未保存的阅读位置或设置可能丢失。", preferredStyle: .alert)
            alert.addAction(BookAlertAction(title: "留在阅读页", style: .cancel))
            alert.addAction(BookAlertAction(title: "仍然返回问答", style: .destructive) { [weak self] _ in self?.finishQuestionReturn() })
            present(alert, animated: true)
            return
        }
        finishQuestionReturn()
    }
    private func finishQuestionReturn() {
        if let referenceReturn {
            leaving = true
            navigator.delegate = nil
            stopCurl()
            referenceReturn()
            return
        }
        guard let origin = questionOrigin, let activeQuestion else { return }
        // A broken resource must not trap the conversation behind a successful
        // navigation requirement. Its saved messages and draft remain usable.
        if loadFailed { reopenQuestion(activeQuestion); return }
        navigate(to: origin) { [weak self] arrived in
            guard let self, arrived else { return }
            Task { @MainActor in
                // Curl mode prepares neighbours after Readium has arrived. Do not
                // reopen the sheet until a second citation can actually navigate.
                for _ in 0..<200 where self.curlBusy { try? await Task.sleep(nanoseconds: 50_000_000) }
                guard !self.loading, !self.curlBusy else { return }
                self.reopenQuestion(activeQuestion)
            }
        }
    }
    private func reopenQuestion(_ question: UINavigationController) {
        questionOrigin = nil
        (question.viewControllers.first as? QuestionController)?.restoreReferenceFocus()
        present(question, animated: true)
    }
    override var keyCommands: [UIKeyCommand]? {
        questionOrigin == nil ? super.keyCommands : [UIKeyCommand(input: UIKeyCommand.inputEscape, modifierFlags: [], action: #selector(backToQuestion))]
    }
    private func captureSelection(
        writeNote: Bool,
        question: Bool = false,
        selection capturedSelection: Selection? = nil
    ) {
        guard !loading, !curlBusy, !navigating,
              let selection = capturedSelection ?? navigator.currentSelection else { return }
        hideSelectionMenu()
        Task {
            do {
                guard case let .success(anchor as [String: Any]) = await navigator.evaluateJavaScript(Self.selectionAnchor),
                      let selector = anchor["selector"] as? String,
                      let highlight = anchor["highlight"] as? String, !highlight.isEmpty,
                      let range = anchor["domRange"] as? [String: Any] else { throw LibraryError.invalidLocation }
                var locator = selection.locator
                try library.checkRevision(bookRevision, for: book.id)
                locator.locations.cssSelector = selector
                locator.locations.otherLocations["domRange"] = try JSONValue(jsonString: String(data: JSONSerialization.data(withJSONObject: range), encoding: .utf8)!, warnings: nil)
                locator.text = Locator.Text(after: anchor["after"] as? String, before: anchor["before"] as? String, highlight: highlight)
                if question {
                    guard !library.questions.loadFailed else { throw LibraryError.save }
                    guard case let .success(material as [String: Any]) = await navigator.evaluateJavaScript(Self.questionNeighbors),
                          let selected = material["selected"] as? [[String: Any]], !selected.isEmpty,
                          let rows = material["neighbors"] as? [[String: Any]] else { throw LibraryError.invalidLocation }
                    func evidence(_ row: [String: Any]) throws -> QuestionEvidence {
                        var nearby = locator
                        nearby.locations.cssSelector = row["selector"] as? String
                        nearby.locations.otherLocations["domRange"] = try JSONValue(jsonString: String(data: JSONSerialization.data(withJSONObject: row["domRange"]!), encoding: .utf8)!, warnings: nil)
                        nearby.text = .init(after: row["after"] as? String, before: row["before"] as? String, highlight: row["quote"] as? String)
                        return QuestionEvidence(locator: nearby, context: row["quote"] as? String)
                    }
                    let parts = try selected.map(evidence)
                    try library.checkRevision(bookRevision, for: book.id)
                    var record = ReadingQuestion(book: book, selection: parts[0], neighbors: try rows.map(evidence))
                    record.selectionParts = parts
                    library.questions.save(record)
                    navigator.clearSelection()
                    let controller = QuestionController(library: library, id: record.id) { [weak self] target, origin in
                        self?.showQuestionReference(target, origin: origin)
                    }
                    let sheet = UINavigationController(rootViewController: controller)
                    activeQuestion = sheet
                    sheet.overrideUserInterfaceStyle = overrideUserInterfaceStyle
                    QuestionSheetPresentation.configure(sheet)
                    present(sheet, animated: true)
                    return
                }
                let candidates = notes + (library.books.first { $0.id == book.id }?.noteDrafts ?? [])
                let existing = candidates.first { note in
                    guard let saved = try? note.location() else { return false }
                    return saved.href == locator.href && saved.locations.domRange == locator.locations.domRange && saved.text == locator.text
                }
                let note = existing ?? BookNote(locator: locator)
                #if DEBUG
                NSLog("SHUDENG_NOTE selection id=%@ locator=%@", note.id.uuidString, locator.description)
                #endif
                if writeNote { edit(note) }
                else { saveHighlight(note) }
            } catch {
                let alert = BookAlertController(title: "无法保存选文", message: "未能确认原文选区，请重新选择。", preferredStyle: .alert)
                alert.addAction(BookAlertAction(title: "知道了", style: .default))
                present(alert, animated: true)
            }
        }
    }
    @discardableResult
    private func saveHighlight(_ note: BookNote, color: HighlightColor? = nil) -> Bool {
        var note = note
        if let color { note.color = color }
        let isSaved = notes.contains { $0.id == note.id }
        do {
            try library.checkRevision(bookRevision, for: book.id)
            if isSaved, let color = note.color {
                try library.updateNoteColor(color, forNoteID: note.id, bookID: book.id)
            } else {
                try library.saveNote(note, for: book.id, highlightOnly: true)
            }
            navigator.clearSelection()
            refreshHighlights()
            return true
        } catch {
            let alert = BookAlertController(title: "高亮保存失败", message: "尚未保存；重试仍使用同一条记录。", preferredStyle: .alert)
            alert.addAction(BookAlertAction(title: "重试保存高亮", style: .default) { [weak self] _ in self?.saveHighlight(note) })
            alert.addAction(BookAlertAction(title: "取消", style: .cancel))
            present(alert, animated: true)
            return false
        }
    }
    private static let selectionAnchor = """
    (() => {
      const selection = getSelection();
      if (!selection.rangeCount || selection.isCollapsed) return null;
      const range = selection.getRangeAt(0);
      const root = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
      function selector(el) {
        const path = [];
        for (; el; el = el.parentElement) {
          if (el.id) { path.unshift('#' + CSS.escape(el.id)); break; }
          let index = 1;
          for (let sib = el.previousElementSibling; sib; sib = sib.previousElementSibling)
            if (sib.localName === el.localName) index++;
          path.unshift(el.localName + ':nth-of-type(' + index + ')');
        }
        return path.join(' > ');
      }
      function point(node, offset) {
        if (node.nodeType === Node.TEXT_NODE) return { cssSelector: selector(node.parentElement), textNodeIndex: Array.from(node.parentElement.childNodes).indexOf(node), charOffset: offset };
        return { cssSelector: selector(node), textNodeIndex: offset };
      }
      const before = document.createRange(); before.selectNodeContents(root); before.setEnd(range.startContainer, range.startOffset);
      const after = document.createRange(); after.selectNodeContents(root); after.setStart(range.endContainer, range.endOffset);
      return { selector: selector(root), highlight: range.toString(), before: before.toString(), after: after.toString(),
        domRange: { start: point(range.startContainer, range.startOffset), end: point(range.endContainer, range.endOffset) } };
    })()
    """

    fileprivate static let selectionBounds = """
    (() => {
      const selection = getSelection();
      if (!selection.rangeCount || selection.isCollapsed) return null;
      const range = selection.getRangeAt(0);
      const rects = Array.from(range.getClientRects())
        .filter(r => r.width > 0 && r.height > 0);
      if (!rects.length) return null;
      const left = Math.min(...rects.map(r => r.left));
      const top = Math.min(...rects.map(r => r.top));
      const right = Math.max(...rects.map(r => r.right));
      const bottom = Math.max(...rects.map(r => r.bottom));
      const rect = {left, top, width: right - left, height: bottom - top};
      return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
    })()
    """

    static let questionNeighbors = """
    (() => {
      const selection = getSelection(); if (!selection.rangeCount || selection.isCollapsed) return null;
      const selected = selection.getRangeAt(0);
      if (!document.body.contains(selected.commonAncestorContainer)) return null;
      function selector(el) {
        const path = [];
        for (; el; el = el.parentElement) {
          let i = 1; for (let p = el.previousElementSibling; p; p = p.previousElementSibling) if (p.localName === el.localName) i++;
          path.unshift(el.localName + ':nth-of-type(' + i + ')');
        }
        return path.join(' > ');
      }
      function point(node, offset) {
        if (node.nodeType === Node.TEXT_NODE) return {cssSelector: selector(node.parentElement), textNodeIndex: Array.from(node.parentElement.childNodes).indexOf(node), charOffset: offset};
        return {cssSelector: selector(node), textNodeIndex: offset};
      }
      function capture(range) {
        const root = range.commonAncestorContainer.nodeType === 1 ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement;
        const before = document.createRange(); before.selectNodeContents(root); before.setEnd(range.startContainer, range.startOffset);
        const after = document.createRange(); after.selectNodeContents(root); after.setStart(range.endContainer, range.endOffset);
        return {selector: selector(root), before: before.toString(), after: after.toString(), quote: range.toString(),
          domRange: {start: point(range.startContainer, range.startOffset), end: point(range.endContainer, range.endOffset)}};
      }
      const runs = []; let nodes = [];
      function flush() {
        if (nodes.length) {
          const r = document.createRange(); r.setStart(nodes[0], 0); r.setEnd(nodes[nodes.length - 1], nodes[nodes.length - 1].length);
          if (r.toString().trim()) runs.push(r);
          nodes = [];
        }
      }
      function visit(node) {
        if (node.nodeType === Node.TEXT_NODE) { if (node.length) nodes.push(node); return; }
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        const style = getComputedStyle(node);
        if (node.hidden || node.getAttribute('aria-hidden') === 'true' || ['SCRIPT','STYLE','NOSCRIPT','TEMPLATE'].includes(node.tagName) || style.display === 'none' || ['hidden','collapse'].includes(style.visibility)) { flush(); return; }
        const block = !['inline','contents'].includes(style.display);
        if (block) flush();
        Array.from(node.childNodes).forEach(visit);
        if (block) flush();
      }
      visit(document.body); flush();
      const parts = [], indices = [];
      runs.forEach((run, index) => {
        const r = run.cloneRange();
        if (r.compareBoundaryPoints(Range.START_TO_START, selected) < 0) r.setStart(selected.startContainer, selected.startOffset);
        if (r.compareBoundaryPoints(Range.END_TO_END, selected) > 0) r.setEnd(selected.endContainer, selected.endOffset);
        // Setting an endpoint beyond the other collapses a disjoint range.
        if (!r.collapsed && r.toString().trim()) {
          parts.push(capture(r)); indices.push(index);
        }
      });
      if (!parts.length) return null;
      const nearby = new Set();
      indices.forEach(i => { if (i > 0) nearby.add(i - 1); nearby.add(i); if (i + 1 < runs.length) nearby.add(i + 1); });
      return {selected: parts, neighbors: Array.from(nearby).sort((a,b) => a-b).map(i => capture(runs[i]))};
    })()
    """

    fileprivate static func targetIsVisible(_ locator: Locator, fullyVisible: Bool = false) -> String {
        // Verify the exact occurrence inside its original element. A matching
        // sentence elsewhere or a successful go() alone is insufficient.
        """
        (() => {
          const locator = \(locator.description), loc = locator.locations || {}, quote = locator.text || {};
          let root;
          try {
            if (loc.cssSelector) root = document.querySelector(loc.cssSelector);
            else if (loc.fragments && loc.fragments.length) root = document.getElementById(decodeURIComponent(loc.fragments[0]));
            else root = document.body;
          } catch (_) { return false; }
          if (!root) return false;
          const visible = r => r.width > 0 && r.height > 0 && (\(fullyVisible)
            ? r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight
            : r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight);
          let offset = 0;
          if (quote.highlight) {
            const text = root.textContent, before = quote.before || '';
            offset = before.length;
            if (text.slice(0, offset) !== before || text.slice(offset, offset + quote.highlight.length) !== quote.highlight ||
                (quote.after != null && text.slice(offset + quote.highlight.length) !== quote.after)) return false;
          }
          const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
          let node;
          while ((node = walker.nextNode())) {
            if (offset >= node.length) { offset -= node.length; continue; }
            if (!quote.highlight) {
              while (offset < node.length && !node.textContent[offset].trim()) offset++;
              if (offset === node.length) { offset = 0; continue; }
            }
            const range = document.createRange();
            range.setStart(node, offset); range.setEnd(node, offset + 1);
            return Array.from(range.getClientRects()).some(visible);
          }
          const image = root.matches('img,svg') ? root : root.querySelector('img,svg');
          return !quote.highlight && !!image && visible(image.getBoundingClientRect());
        })()
        """
    }
}

@MainActor
final class ReaderToolbarView: UIView {
    let backButton = UIButton(type: .system)
    let contentsButton = UIButton(type: .system)
    let settingsButton = UIButton(type: .system)
    private let titleLabel = BookDesign.label(nil, font: BookType.sans(12, weight: .medium, style: .subheadline), colour: BookDesign.ink2)
    private let chapterLabel = BookDesign.label(nil, font: BookType.caption, colour: BookDesign.ink3)
    private let hairline = UIView()
    private let leadingRegion = UIView()
    private let trailingRegion = UIView()
    private var leadingWidth: NSLayoutConstraint!
    private var backWidth: NSLayoutConstraint!

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = BookDesign.paper.withAlphaComponent(0.94)
        accessibilityIdentifier = "reader-toolbar"
        hairline.backgroundColor = BookDesign.line
        hairline.translatesAutoresizingMaskIntoConstraints = false
        addSubview(hairline)
        NSLayoutConstraint.activate([
            hairline.leadingAnchor.constraint(equalTo: leadingAnchor),
            hairline.trailingAnchor.constraint(equalTo: trailingAnchor),
            hairline.bottomAnchor.constraint(equalTo: bottomAnchor),
            hairline.heightAnchor.constraint(equalToConstant: 1)
        ])

        configure(backButton, image: "arrow.left")
        configure(contentsButton, image: "list.bullet")
        configure(settingsButton, image: "ellipsis")
        backButton.accessibilityLabel = "书架"
        backButton.accessibilityIdentifier = "reader-close"
        contentsButton.accessibilityLabel = "目录与书签"
        contentsButton.accessibilityIdentifier = "reader-contents"
        settingsButton.accessibilityLabel = "阅读设置"
        settingsButton.accessibilityIdentifier = "reader-settings"

        titleLabel.textAlignment = .center
        titleLabel.lineBreakMode = .byTruncatingTail
        titleLabel.adjustsFontForContentSizeCategory = true
        // XXXL 等大字号下保持单行 + 限制最大字号，避免撑出 64pt 工具栏、跨过分隔线。
        titleLabel.numberOfLines = 1
        titleLabel.maximumContentSizeCategory = .extraLarge
        titleLabel.accessibilityIdentifier = "reader-title"
        chapterLabel.textAlignment = .center
        chapterLabel.lineBreakMode = .byTruncatingTail
        chapterLabel.adjustsFontForContentSizeCategory = true
        chapterLabel.numberOfLines = 1
        chapterLabel.maximumContentSizeCategory = .extraLarge
        chapterLabel.accessibilityIdentifier = "reader-chapter"

        let titleStack = UIStackView(arrangedSubviews: [titleLabel, chapterLabel])
        titleStack.axis = .vertical
        titleStack.alignment = .fill
        titleStack.spacing = 1

        let trailingStack = UIStackView(arrangedSubviews: [contentsButton, settingsButton])
        trailingStack.axis = .horizontal
        trailingStack.spacing = 0

        for child in [leadingRegion, trailingRegion, titleStack] {
            child.translatesAutoresizingMaskIntoConstraints = false
            addSubview(child)
        }
        backButton.translatesAutoresizingMaskIntoConstraints = false
        leadingRegion.addSubview(backButton)
        trailingStack.translatesAutoresizingMaskIntoConstraints = false
        trailingRegion.addSubview(trailingStack)
        leadingWidth = leadingRegion.widthAnchor.constraint(equalToConstant: 88)
        backWidth = backButton.widthAnchor.constraint(equalToConstant: 44)

        NSLayoutConstraint.activate([
            leadingWidth,
            backWidth,
            leadingRegion.leadingAnchor.constraint(equalTo: safeAreaLayoutGuide.leadingAnchor, constant: 13),
            leadingRegion.centerYAnchor.constraint(equalTo: centerYAnchor),
            leadingRegion.heightAnchor.constraint(equalToConstant: 44),
            trailingRegion.trailingAnchor.constraint(equalTo: safeAreaLayoutGuide.trailingAnchor, constant: -13),
            trailingRegion.centerYAnchor.constraint(equalTo: centerYAnchor),
            trailingRegion.widthAnchor.constraint(equalToConstant: 88),
            trailingRegion.heightAnchor.constraint(equalToConstant: 44),
            backButton.leadingAnchor.constraint(equalTo: leadingRegion.leadingAnchor),
            backButton.centerYAnchor.constraint(equalTo: leadingRegion.centerYAnchor),
            backButton.heightAnchor.constraint(equalToConstant: 44),
            backButton.trailingAnchor.constraint(lessThanOrEqualTo: leadingRegion.trailingAnchor),
            trailingStack.topAnchor.constraint(equalTo: trailingRegion.topAnchor),
            trailingStack.leadingAnchor.constraint(equalTo: trailingRegion.leadingAnchor),
            trailingStack.trailingAnchor.constraint(equalTo: trailingRegion.trailingAnchor),
            trailingStack.bottomAnchor.constraint(equalTo: trailingRegion.bottomAnchor),
            contentsButton.widthAnchor.constraint(equalToConstant: 44),
            settingsButton.widthAnchor.constraint(equalToConstant: 44),
            titleStack.centerXAnchor.constraint(equalTo: centerXAnchor),
            titleStack.centerYAnchor.constraint(equalTo: centerYAnchor),
            titleStack.leadingAnchor.constraint(greaterThanOrEqualTo: leadingRegion.trailingAnchor, constant: 4),
            titleStack.trailingAnchor.constraint(lessThanOrEqualTo: trailingRegion.leadingAnchor, constant: -4)
        ])
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    func configure(title: String, chapter: String, reference: Bool) {
        titleLabel.text = title
        chapterLabel.text = (reference ? "查看引用 1 · " : "") + chapter
        leadingWidth.constant = reference ? 112 : 88
        backWidth.constant = reference ? 112 : 44
        backButton.configuration?.title = reference ? "返回问答" : nil
        backButton.accessibilityLabel = reference ? "返回问答" : "书架"
        backButton.accessibilityHint = reference ? nil : "返回书架"
    }

    private func configure(_ button: UIButton, image: String) {
        var config = UIButton.Configuration.plain()
        config.image = BookDesign.symbol(image, size: 18, weight: .medium)
        config.baseForegroundColor = BookDesign.ink2
        config.contentInsets = .zero
        config.imagePlacement = .leading
        config.imagePadding = 5
        config.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer {
            var attributes = $0
            // 返回/问答标题按钮限制最大字号，避免大字号下按钮标题被裁切。
            attributes.font = UIFontMetrics(forTextStyle: .body).scaledFont(
                for: .systemFont(ofSize: 14, weight: .medium),
                maximumPointSize: 17
            )
            return attributes
        }
        button.configuration = config
        button.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
    }
}

@MainActor
final class ReaderFooterView: UIView {
    let askButton = ReaderAskButton(type: .system)
    private let progressLabel = BookDesign.label(nil, font: BookType.caption, colour: BookDesign.ink3)
    private let chapterLabel = BookDesign.label(nil, font: BookType.caption, colour: BookDesign.ink3)

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = BookDesign.paper
        accessibilityIdentifier = "reader-footer"

        var config = UIButton.Configuration.plain()
        config.title = "问问书灯"
        config.image = BookDesign.symbol("lightbulb", size: 16)
        config.imagePadding = 6
        config.baseForegroundColor = BookDesign.ink
        config.contentInsets = NSDirectionalEdgeInsets(top: 0, leading: 12, bottom: 0, trailing: 14)
        config.background.backgroundColor = BookDesign.surface
        config.background.cornerRadius = BookRadius.pill
        config.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer {
            var attributes = $0
            // 限制最大字号，避免 XXXL 下「问问书灯」胶囊与底部进度/章节文字重叠。
            attributes.font = UIFontMetrics(forTextStyle: .footnote).scaledFont(
                for: .systemFont(ofSize: 12, weight: .medium),
                maximumPointSize: 16
            )
            return attributes
        }
        askButton.configuration = config
        askButton.accessibilityLabel = "问问书灯"
        askButton.accessibilityIdentifier = "reader-ask-book"
        askButton.layer.shadowColor = UIColor.black.cgColor
        askButton.layer.shadowOpacity = 0.16
        askButton.layer.shadowRadius = 22
        askButton.layer.shadowOffset = CGSize(width: 0, height: 8)

        progressLabel.accessibilityIdentifier = "reader-progress"
        progressLabel.numberOfLines = 1
        progressLabel.maximumContentSizeCategory = .extraLarge
        chapterLabel.accessibilityIdentifier = "reader-footer-chapter"
        chapterLabel.textAlignment = .right
        chapterLabel.lineBreakMode = .byTruncatingHead
        chapterLabel.numberOfLines = 1
        chapterLabel.maximumContentSizeCategory = .extraLarge

        for child in [askButton, progressLabel, chapterLabel] {
            child.translatesAutoresizingMaskIntoConstraints = false
            addSubview(child)
        }
        NSLayoutConstraint.activate([
            askButton.centerXAnchor.constraint(equalTo: safeAreaLayoutGuide.centerXAnchor),
            askButton.heightAnchor.constraint(equalToConstant: 36),
            askButton.topAnchor.constraint(equalTo: topAnchor, constant: 4),
            progressLabel.leadingAnchor.constraint(equalTo: safeAreaLayoutGuide.leadingAnchor, constant: 26),
            progressLabel.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -10),
            chapterLabel.trailingAnchor.constraint(equalTo: safeAreaLayoutGuide.trailingAnchor, constant: -26),
            chapterLabel.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -10),
            chapterLabel.leadingAnchor.constraint(greaterThanOrEqualTo: progressLabel.trailingAnchor, constant: 12)
        ])
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    func update(progress: String, chapter: String) {
        progressLabel.text = progress
        chapterLabel.text = chapter
    }
}

/// 视觉更小的「问问书灯」按钮；命中区仍保证 44pt 高，保持可点性。
final class ReaderAskButton: UIButton {
    override func point(inside point: CGPoint, with event: UIEvent?) -> Bool {
        let vertical = max(0, (44 - bounds.height) / 2)
        return bounds.insetBy(dx: 0, dy: -vertical).contains(point)
    }
}

@MainActor
final class ReaderSelectionMenu: UIView {
    var onHighlight: (() -> Void)?
    var onNote: (() -> Void)?
    var onAsk: (() -> Void)?
    private let bubble = UIView()
    private let caret = UIView()
    private var caretCenter: NSLayoutConstraint!

    override init(frame: CGRect = .zero) {
        super.init(frame: frame)
        accessibilityIdentifier = "reader-selection-menu"
        backgroundColor = .clear

        bubble.backgroundColor = BookDesign.ink
        bubble.layer.cornerRadius = 12
        bubble.layer.shadowColor = UIColor.black.cgColor
        bubble.layer.shadowOpacity = 0.16
        bubble.layer.shadowRadius = 10
        bubble.layer.shadowOffset = CGSize(width: 0, height: 5)
        caret.backgroundColor = BookDesign.ink
        caret.transform = CGAffineTransform(rotationAngle: .pi / 4)

        let highlight = actionButton("高亮", identifier: "selection-highlight")
        let note = actionButton("笔记", identifier: "selection-note")
        let ask = actionButton("提问", identifier: "selection-ask", image: "lightbulb")
        highlight.addTarget(self, action: #selector(highlightTapped), for: .touchUpInside)
        note.addTarget(self, action: #selector(noteTapped), for: .touchUpInside)
        ask.addTarget(self, action: #selector(askTapped), for: .touchUpInside)
        let actions = UIStackView(arrangedSubviews: [highlight, note, ask])
        actions.axis = .horizontal
        actions.distribution = .fillEqually

        let firstLine = UIView()
        let secondLine = UIView()
        for line in [firstLine, secondLine] {
            line.backgroundColor = UIColor.white.withAlphaComponent(0.22)
        }

        for child in [bubble, caret] {
            child.translatesAutoresizingMaskIntoConstraints = false
            addSubview(child)
        }
        actions.translatesAutoresizingMaskIntoConstraints = false
        bubble.addSubview(actions)
        for line in [firstLine, secondLine] {
            line.translatesAutoresizingMaskIntoConstraints = false
            bubble.addSubview(line)
        }
        caretCenter = caret.centerXAnchor.constraint(equalTo: leadingAnchor, constant: 117)
        NSLayoutConstraint.activate([
            bubble.topAnchor.constraint(equalTo: topAnchor),
            bubble.leadingAnchor.constraint(equalTo: leadingAnchor),
            bubble.trailingAnchor.constraint(equalTo: trailingAnchor),
            bubble.heightAnchor.constraint(equalToConstant: 46),
            caret.widthAnchor.constraint(equalToConstant: 11),
            caret.heightAnchor.constraint(equalToConstant: 11),
            caretCenter,
            caret.bottomAnchor.constraint(equalTo: bottomAnchor),
            actions.topAnchor.constraint(equalTo: bubble.topAnchor, constant: 2),
            actions.leadingAnchor.constraint(equalTo: bubble.leadingAnchor, constant: 6),
            actions.trailingAnchor.constraint(equalTo: bubble.trailingAnchor, constant: -6),
            actions.bottomAnchor.constraint(equalTo: bubble.bottomAnchor, constant: -2),
            firstLine.leadingAnchor.constraint(equalTo: bubble.leadingAnchor, constant: 78),
            firstLine.centerYAnchor.constraint(equalTo: bubble.centerYAnchor),
            firstLine.widthAnchor.constraint(equalToConstant: 1),
            firstLine.heightAnchor.constraint(equalToConstant: 28),
            secondLine.leadingAnchor.constraint(equalTo: bubble.leadingAnchor, constant: 156),
            secondLine.centerYAnchor.constraint(equalTo: bubble.centerYAnchor),
            secondLine.widthAnchor.constraint(equalToConstant: 1),
            secondLine.heightAnchor.constraint(equalToConstant: 28)
        ])
        isAccessibilityElement = false
        accessibilityElements = [highlight, note, ask]
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    func place(in host: UIView, above selection: CGRect) {
        var size = CGSize(width: 234, height: 51)
        let minY = host.safeAreaInsets.top + 55
        let preferredAbove = selection.minY - size.height - 4
        let preferredBelow = selection.maxY + 8
        let maxY = host.bounds.height - 82
        let fitsAbove = preferredAbove >= minY
        let fitsBelow = preferredBelow + 46 <= maxY
        let useBelow = !fitsAbove && fitsBelow
        if useBelow {
            size.height = 46
        }
        var y = useBelow ? preferredBelow : preferredAbove
        if !fitsAbove && !fitsBelow {
            // Preserve access for an unusually tall selection by choosing the
            // side with more room. Normal multi-line selections fit wholly
            // above or below the complete selection bounds.
            y = selection.minY - minY > maxY - selection.maxY
                ? minY
                : maxY - size.height
        } else if !useBelow {
            y = max(minY, y)
        }
        y = min(y, maxY - size.height)
        let x = max(8, min(selection.midX - size.width / 2, host.bounds.width - size.width - 8))
        frame = CGRect(origin: CGPoint(x: x, y: y), size: size)
        caret.isHidden = useBelow
        caretCenter.constant = max(12, min(size.width - 12, selection.midX - x))
        setNeedsLayout()
        layoutIfNeeded()
    }

    private func actionButton(_ title: String, identifier: String, image: String? = nil) -> UIButton {
        let button = UIButton(type: .system)
        var config = UIButton.Configuration.plain()
        config.title = title
        config.image = image.flatMap { BookDesign.symbol($0, size: 17) }
        config.imagePadding = 5
        config.baseForegroundColor = BookDesign.paper
        config.contentInsets = .zero
        config.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer {
            var attributes = $0
            attributes.font = BookDesign.font(13, weight: .medium)
            return attributes
        }
        button.configuration = config
        button.accessibilityIdentifier = identifier
        return button
    }

    @objc private func highlightTapped() { onHighlight?() }
    @objc private func noteTapped() { onNote?() }
    @objc private func askTapped() { onAsk?() }
}

@MainActor
private final class BookNavigationController: UITableViewController {
    private let publication: Publication
    private let library: LibraryStore
    private let bookID: String
    private let bookRevision: UUID
    private let capture: () async throws -> Bookmark
    private let navigate: (Locator) -> Void
    private let tabs = UISegmentedControl(items: ["目录", "书签"])
    private var contents: [(Link, Int)] = []
    private var contentsMessage = "正在读取目录…"
    private var feedback: String?
    private var bookmarks: [Bookmark] { library.books.first { $0.id == bookID }?.bookmarks ?? [] }

    init(publication: Publication, library: LibraryStore, bookID: String,
         capture: @escaping () async throws -> Bookmark, navigate: @escaping (Locator) -> Void) {
        self.publication = publication
        self.library = library
        self.bookID = bookID
        bookRevision = library.revision(for: bookID)
        self.capture = capture
        self.navigate = navigate
        super.init(style: .insetGrouped)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }
    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        navigationController?.setToolbarHidden(false, animated: false)
    }
    override func viewDidLoad() {
        super.viewDidLoad()
        BookDesign.formTable(tableView)
        tableView.register(UITableViewCell.self, forCellReuseIdentifier: "navigation-row")
        tabs.selectedSegmentIndex = 0
        tabs.addTarget(self, action: #selector(refresh), for: .valueChanged)
        navigationItem.titleView = tabs
        navigationItem.leftBarButtonItem = UIBarButtonItem(title: "完成", style: .done, target: self, action: #selector(done))
        toolbarItems = [UIBarButtonItem(title: "书内搜索", style: .plain, target: self, action: #selector(openSearch))]
        navigationController?.setToolbarHidden(false, animated: false)
        navigationItem.rightBarButtonItem = UIBarButtonItem(barButtonSystemItem: .add, target: self, action: #selector(addBookmark))
        navigationItem.rightBarButtonItem?.accessibilityLabel = "添加书签"
        tableView.accessibilityIdentifier = "book-navigation"
        Task {
            do {
                func flatten(_ links: [Link], depth: Int) -> [(Link, Int)] {
                    links.flatMap { [($0, depth)] + flatten($0.children, depth: depth + 1) }
                }
                contents = flatten(try await publication.tableOfContents().get(), depth: 0)
                contentsMessage = "本书没有目录"
            } catch { contentsMessage = "目录读取失败，请关闭后重试" }
            refresh()
        }
    }
    @objc private func refresh() {
        tableView.reloadData()
        updateEmptyState()
    }
    @objc private func openSearch() {
        guard let book = library.books.first(where: { $0.id == bookID }) else { return }
        navigationController?.pushViewController(BookSearchController(library: library, book: book, navigate: navigate), animated: true)
    }
    @objc private func done() { dismiss(animated: true) }

    private var isContentsTab: Bool { tabs.selectedSegmentIndex == 0 }

    /// 书签行第二行：优先显示阅读进度百分比，缺失时退回 Readium position。
    private func bookmarkProgress(_ bookmark: Bookmark) -> String {
        guard let locator = try? bookmark.location() else { return bookmark.excerpt }
        if let value = locator.locations.totalProgression ?? locator.locations.progression {
            return "进度 " + String(Int((max(0, min(1, value)) * 100).rounded())) + "%"
        }
        if let position = locator.locations.position {
            return "位置 " + String(position)
        }
        return bookmark.excerpt
    }

    override func tableView(_ tableView: UITableView, titleForFooterInSection section: Int) -> String? { feedback }
    override func tableView(_ tableView: UITableView, willDisplayFooterView view: UIView, forSection section: Int) {
        BookDesign.formHeaderFooter(view)
    }
    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
        max(1, isContentsTab ? contents.count : bookmarks.count)
    }
    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = tableView.dequeueReusableCell(withIdentifier: "navigation-row", for: indexPath)
        cell.accessoryType = .none
        cell.selectionStyle = .default
        cell.accessibilityIdentifier = nil
        if isContentsTab {
            guard !contents.isEmpty else { return messageCell(cell, text: contentsMessage) }
            let (link, depth) = contents[indexPath.row]
            var content = UIListContentConfiguration.cell()
            content.text = link.title ?? "未命名章节"
            content.textProperties.font = BookType.body
            content.textProperties.color = BookDesign.ink
            content.textProperties.numberOfLines = 0
            content.directionalLayoutMargins = NSDirectionalEdgeInsets(
                top: 10,
                leading: 20 + CGFloat(min(depth, 4)) * 16,
                bottom: 10,
                trailing: 20
            )
            cell.contentConfiguration = content
            cell.accessoryType = .disclosureIndicator
        } else {
            guard !bookmarks.isEmpty else { return messageCell(cell, text: "暂无书签") }
            let bookmark = bookmarks[indexPath.row]
            var content = UIListContentConfiguration.subtitleCell()
            content.image = BookDesign.symbol("bookmark.fill", size: 13, weight: .medium)
            content.imageProperties.tintColor = BookDesign.lamp
            content.text = bookmark.title
            content.textProperties.font = BookType.body
            content.textProperties.color = BookDesign.ink
            content.textProperties.numberOfLines = 1
            content.secondaryText = bookmarkProgress(bookmark)
            content.secondaryTextProperties.font = BookType.footnote
            content.secondaryTextProperties.color = BookDesign.ink3
            content.secondaryTextProperties.numberOfLines = 1
            cell.contentConfiguration = content
            cell.accessoryType = .disclosureIndicator
            cell.accessibilityIdentifier = "bookmark-\(bookmark.id)"
            cell.accessibilityValue = bookmark.excerpt
        }
        return cell
    }
    private func messageCell(_ cell: UITableViewCell, text: String) -> UITableViewCell {
        var content = UIListContentConfiguration.cell()
        content.text = text
        content.textProperties.font = BookType.footnote
        content.textProperties.color = BookDesign.ink3
        content.textProperties.numberOfLines = 0
        cell.contentConfiguration = content
        cell.selectionStyle = .none
        cell.accessoryType = .none
        return cell
    }
    private func updateEmptyState() {
        if #available(iOS 17.0, *) {
            updateContentUnavailable()
        } else {
            tableView.backgroundView = nil
        }
    }
    @available(iOS 17.0, *)
    private func updateContentUnavailable() {
        if isContentsTab {
            if !contents.isEmpty || contentsMessage == "正在读取目录…" {
                contentUnavailableConfiguration = nil
            } else if contentsMessage.hasPrefix("目录读取失败") {
                contentUnavailableConfiguration = BookContentUnavailable.configuration(
                    title: "目录读取失败",
                    detail: "请关闭后重试；仍可阅读正文。",
                    symbol: "exclamationmark.triangle",
                    actionTitle: "关闭",
                    action: { [weak self] in self?.done() }
                )
            } else {
                contentUnavailableConfiguration = BookContentUnavailable.configuration(
                    title: contentsMessage,
                    detail: "可用书内搜索定位原文。",
                    symbol: "list.bullet",
                    actionTitle: "搜索原文",
                    action: { [weak self] in self?.openSearch() }
                )
            }
        } else if bookmarks.isEmpty {
            contentUnavailableConfiguration = BookContentUnavailable.configuration(
                title: "暂无书签",
                detail: "轻点右上角 + 保存当前位置，书签会留在本书里。",
                symbol: "bookmark",
                actionTitle: "保存当前位置",
                action: { [weak self] in self?.addBookmark() }
            )
        } else {
            contentUnavailableConfiguration = nil
        }
    }
    override func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true)
        if isContentsTab {
            guard contents.indices.contains(indexPath.row) else { return }
            let link = contents[indexPath.row].0
            Task {
                let target = await publication.locate(link)
                open(target, failure: "目标位置无效，请选择其他目录。")
            }
        } else {
            guard bookmarks.indices.contains(indexPath.row) else { return }
            let bookmark = bookmarks[indexPath.row]
            Task { open(try? bookmark.location(), failure: "目标位置无效，请选择其他书签。") }
        }
    }
    private func open(_ target: Locator?, failure: String) {
        guard let target else {
            showFailure(title: "无法定位原文", message: failure, retry: nil)
            return
        }
        dismiss(animated: true) { [navigate] in navigate(target) }
    }
    @objc private func addBookmark() {
        navigationItem.rightBarButtonItem?.isEnabled = false
        Task {
            defer { navigationItem.rightBarButtonItem?.isEnabled = true }
            do {
                let bookmark = try await capture()
                try library.checkRevision(bookRevision, for: bookID)
                save(bookmark)
            } catch { showFailure(title: "无法添加书签", message: "当前没有可确认的原文位置，请返回正文后重试。", retry: nil) }
        }
    }
    private func save(_ bookmark: Bookmark) {
        do {
            try library.checkRevision(bookRevision, for: bookID)
            try library.saveBookmark(bookmark, for: bookID)
            tabs.selectedSegmentIndex = 1
            feedback = "书签已保存"
            refresh()
        } catch { showFailure(title: "书签保存失败", message: "尚未保存，重启后不会保留。可重试或取消本次添加。", retry: { [weak self] in self?.save(bookmark) }) }
    }
    override func tableView(_ tableView: UITableView, canEditRowAt indexPath: IndexPath) -> Bool {
        !isContentsTab && !bookmarks.isEmpty
    }
    override func tableView(_ tableView: UITableView, titleForDeleteConfirmationButtonForRowAt indexPath: IndexPath) -> String? { "移除" }
    override func tableView(_ tableView: UITableView, commit editingStyle: UITableViewCell.EditingStyle, forRowAt indexPath: IndexPath) {
        guard !isContentsTab, bookmarks.indices.contains(indexPath.row) else { return }
        remove(bookmarks[indexPath.row].id)
    }
    private func remove(_ id: UUID) {
        do {
            try library.checkRevision(bookRevision, for: bookID)
            try library.removeBookmark(id, for: bookID)
            feedback = "书签已移除"
            refresh()
        } catch { showFailure(title: "书签移除失败", message: "原书签仍保留，可重试或取消本次移除。", retry: { [weak self] in self?.remove(id) }) }
    }
    private func showFailure(title: String, message: String, retry: (() -> Void)?) {
        feedback = nil
        refresh()
        let alert = BookAlertController(title: title, message: message, preferredStyle: .alert)
        if let retry { alert.addAction(BookAlertAction(title: "重试保存", style: .default) { _ in retry() }) }
        alert.addAction(BookAlertAction(title: retry == nil ? "知道了" : "取消", style: .cancel))
        present(alert, animated: true)
    }
}

@MainActor
private final class ReadingSettingsController: UITableViewController {
    private var settings: ReadingSettings
    private let apply: (ReadingSettings) -> Void
    private let mode = UISegmentedControl(items: ["分页", "滚动", "仿真"])
    private let theme = UISegmentedControl(items: ["明亮", "深色"])
    private let size = UILabel()
    private let decrease = UIButton(type: .system)
    private let increase = UIButton(type: .system)
    private lazy var sizeRow = makeSizeRow()
    private var sectionTitles: [String] { ["阅读方式", "字号", "主题"] }

    init(settings: ReadingSettings, apply: @escaping (ReadingSettings) -> Void) {
        self.settings = settings
        self.apply = apply
        super.init(style: .insetGrouped)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "阅读设置"
        BookDesign.formTable(tableView)
        view.backgroundColor = BookDesign.paper
        navigationItem.leftBarButtonItem = UIBarButtonItem(title: "取消", style: .plain, target: self, action: #selector(cancel))
        navigationItem.rightBarButtonItem = UIBarButtonItem(title: "完成", style: .done, target: self, action: #selector(done))
        tableView.register(ReadingControlCell.self, forCellReuseIdentifier: "settings-row")
        mode.selectedSegmentIndex = settings.pageCurl == true ? 2 : settings.scroll ? 1 : 0
        theme.selectedSegmentIndex = settings.dark ? 1 : 0
        for control in [mode, theme] {
            control.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
        }
        decrease.addTarget(self, action: #selector(smaller), for: .touchUpInside)
        increase.addTarget(self, action: #selector(larger), for: .touchUpInside)
        updateSize()
    }

    private func makeSizeRow() -> UIStackView {
        size.font = BookType.body
        size.adjustsFontForContentSizeCategory = true
        size.textAlignment = .center
        size.accessibilityIdentifier = "font-size"
        for (button, title, label) in [(decrease, "A−", "缩小字号"), (increase, "A+", "增大字号")] {
            var configuration = UIButton.Configuration.plain()
            configuration.title = title
            button.configuration = configuration
            button.accessibilityLabel = label
            button.widthAnchor.constraint(equalToConstant: 44).isActive = true
            button.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
        }
        let stack = UIStackView(arrangedSubviews: [decrease, size, increase])
        stack.axis = .horizontal
        stack.alignment = .center
        stack.spacing = 12
        size.setContentHuggingPriority(.defaultLow, for: .horizontal)
        return stack
    }

    override func numberOfSections(in tableView: UITableView) -> Int { sectionTitles.count }
    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { 1 }
    override func tableView(_ tableView: UITableView, titleForHeaderInSection section: Int) -> String? {
        sectionTitles[section]
    }
    override func tableView(_ tableView: UITableView, titleForFooterInSection section: Int) -> String? {
        section == sectionTitles.count - 1 ? "仅用于本书" : nil
    }
    override func tableView(_ tableView: UITableView, willDisplayHeaderView view: UIView, forSection section: Int) {
        BookDesign.formHeaderFooter(view)
    }
    override func tableView(_ tableView: UITableView, willDisplayFooterView view: UIView, forSection section: Int) {
        BookDesign.formHeaderFooter(view)
    }
    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = tableView.dequeueReusableCell(withIdentifier: "settings-row", for: indexPath)
        guard let controlCell = cell as? ReadingControlCell else { return cell }
        switch indexPath.section {
        case 0: controlCell.host(mode)
        case 1: controlCell.host(sizeRow)
        default: controlCell.host(theme)
        }
        return controlCell
    }
    @objc private func smaller() { settings.fontSize -= 25; updateSize() }
    @objc private func larger() { settings.fontSize += 25; updateSize() }
    private func updateSize() {
        size.text = "\(settings.fontSize)%"
        decrease.isEnabled = settings.fontSize > 75
        increase.isEnabled = settings.fontSize < 200
    }
    @objc private func cancel() { dismiss(animated: true) }
    @objc private func done() {
        settings.scroll = mode.selectedSegmentIndex == 1
        settings.pageCurl = mode.selectedSegmentIndex == 2
        settings.dark = theme.selectedSegmentIndex == 1
        dismiss(animated: true) { [apply, settings] in apply(settings) }
    }
}

/// 设置表单里的系统控件行：控件由控制器持有，复用 cell 时移入当前 contentView。
private final class ReadingControlCell: UITableViewCell {
    private var hosted: UIView?

    override init(style: UITableViewCell.CellStyle, reuseIdentifier: String?) {
        super.init(style: style, reuseIdentifier: reuseIdentifier)
        selectionStyle = .none
        backgroundColor = BookDesign.surface
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    func host(_ view: UIView) {
        if hosted === view && view.superview === contentView { return }
        hosted?.removeFromSuperview()
        view.removeFromSuperview()
        view.translatesAutoresizingMaskIntoConstraints = false
        contentView.addSubview(view)
        NSLayoutConstraint.activate([
            view.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 10),
            view.bottomAnchor.constraint(equalTo: contentView.bottomAnchor, constant: -10),
            view.leadingAnchor.constraint(equalTo: contentView.layoutMarginsGuide.leadingAnchor),
            view.trailingAnchor.constraint(equalTo: contentView.layoutMarginsGuide.trailingAnchor)
        ])
        hosted = view
    }
}

// Application-owned adaptation of the original isolated reader probe.
// Only settled live pages report progress; all neighbor navigation stays private.
@MainActor
private final class CurlPage: UIViewController {
    let locator: Locator
    init(locator: Locator, image: UIImage) {
        self.locator = locator
        super.init(nibName: nil, bundle: nil)
        let snapshot = UIImageView(image: image)
        snapshot.isUserInteractionEnabled = true
        snapshot.contentMode = .scaleToFill
        view = snapshot
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }
}

@MainActor
private final class ReaderCurlController: UIViewController, UIPageViewControllerDataSource, UIPageViewControllerDelegate {
    private struct Page {
        let locator: Locator
        let reflowLocation: Locator
        let image: UIImage
        let selector: String?
        var previous: String?
        var following: String?
        var previousKnown = false
        var nextKnown = false
    }
    private let reader: EPUBNavigatorViewController
    private let publication: Publication
    private unowned let host: UIView
    private let highlightsReady: () async -> Bool
    private var requiredFocus: Locator?
    private unowned let readerParent: UIViewController
    private let busy: () -> Void
    private let userTurned: (Locator) -> Void
    private let settled: (Locator, Locator, Bool) -> Void
    private let failed: () -> Void
    private let pager = UIPageViewController(transitionStyle: .pageCurl, navigationOrientation: .horizontal,
        options: [.spineLocation: UIPageViewController.SpineLocation.min.rawValue])
    private var cache: [String: Page] = [:]
    private var order: [String] = []
    private var current: CurlPage?
    private(set) var userLocation: Locator?
    private var previous: CurlPage?
    private var following: CurlPage?
    private var active = true
    private(set) var working = true
    private var waiter: ((Locator) -> Void)?
    private var cancelWait: (() -> Void)?
    private var task: Task<Void, Never>?

    init(reader: EPUBNavigatorViewController, publication: Publication, host: UIView, parent: UIViewController,
         requiredFocus: Locator?,
         highlightsReady: @escaping () async -> Bool,
         busy: @escaping () -> Void, userTurned: @escaping (Locator) -> Void,
         settled: @escaping (Locator, Locator, Bool) -> Void, failed: @escaping () -> Void) {
        self.reader = reader; self.publication = publication; self.host = host; readerParent = parent
        self.highlightsReady = highlightsReady
        self.requiredFocus = requiredFocus
        self.busy = busy; self.userTurned = userTurned; self.settled = settled; self.failed = failed
        super.init(nibName: nil, bundle: nil)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }
    override func viewDidLoad() {
        super.viewDidLoad()
        addChild(pager)
        pager.view.frame = view.bounds
        pager.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(pager.view)
        pager.didMove(toParent: self)
        pager.dataSource = self; pager.delegate = self
        pager.isDoubleSided = false
        // Curl owns drag transitions. Its default tap turns compete with the
        // live WebView's middle-tap controls and must not turn a page instead.
        let tapGestures = pager.gestureRecognizers.compactMap { $0 as? UITapGestureRecognizer }
        tapGestures.forEach { $0.isEnabled = false }
    }
    func start() {
        working = true; busy()
        task = Task {
            // Let the initial/external go finish reporting its native location;
            // currentLocation can still be a pending target inside its callback.
            try? await Task.sleep(nanoseconds: 350_000_000)
            guard active else { return }
            await prepare()
        }
    }

    func stop() {
        active = false
        cancelWait?()
        task?.cancel()
        pager.dataSource = nil; pager.delegate = nil
        attach(to: readerParent, container: host)
        reader.nativePaginationEnabled = true
        willMove(toParent: nil); view.removeFromSuperview(); removeFromParent()
    }
    func locationChanged(_ locator: Locator) -> Bool {
        if working { waiter?(locator); return true }
        // Internal hyperlinks/accessibility navigation invalidate snapshots too.
        return current.map { same($0.locator, locator) } ?? false
    }

    private func attach(to parent: UIViewController, container: UIView) {
        reader.willMove(toParent: nil); reader.view.removeFromSuperview(); reader.removeFromParent()
        parent.addChild(reader)
        reader.view.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(reader.view)
        NSLayoutConstraint.activate([
            reader.view.topAnchor.constraint(equalTo: container.topAnchor),
            reader.view.bottomAnchor.constraint(equalTo: container.bottomAnchor),
            reader.view.leadingAnchor.constraint(equalTo: container.leadingAnchor),
            reader.view.trailingAnchor.constraint(equalTo: container.trailingAnchor)
        ])
        container.layoutIfNeeded()
        reader.didMove(toParent: parent)
    }
    private func key(_ locator: Locator) -> String {
        "\(locator.href.string)|\(String(format: "%.7f", locator.locations.progression ?? 0))"
    }
    private func same(_ lhs: Locator, _ rhs: Locator) -> Bool {
        lhs.href == rhs.href && abs((lhs.locations.progression ?? 0) - (rhs.locations.progression ?? 0)) < 0.0001
    }
    private func store(_ page: Page) {
        let id = key(page.locator)
        cache[id] = page
        order.removeAll { $0 == id }; order.append(id)
        while order.count > 8 { cache.removeValue(forKey: order.removeFirst()) }
    }
    private func controller(_ id: String?) -> CurlPage? {
        guard let id, let page = cache[id] else { return nil }
        return CurlPage(locator: page.locator, image: page.image)
    }
    private func capture(_ locator: Locator) async throws -> Page {
        let highlights = await highlightsReady()
        guard highlights, active else {
            trace("capture unavailable highlights=\(highlights) active=\(active)")
            throw MoveError.highlights
        }
        // Highlight/layout work can finish after the initial location callback.
        // Give the snapshot and its cache entry the native viewport's position,
        // rather than the stale callback that started preparation.
        guard let native = await reader.refreshLocationFromViewport(),
              native.href == locator.href else { throw MoveError.display }
        let first = await reader.firstVisibleElementLocator()
        var reflowLocation = native
        if case let .success(anchor as [String: String]) = await reader.evaluateJavaScript(ReaderController.visibleTextAnchor) {
            reflowLocation.locations.cssSelector = anchor["selector"]
            reflowLocation.locations.otherLocations.removeValue(forKey: "domRange")
            reflowLocation.text = Locator.Text(after: anchor["after"], before: anchor["before"], highlight: anchor["highlight"])
        }
        let image = UIGraphicsImageRenderer(bounds: reader.view.bounds).image { _ in
            reader.view.drawHierarchy(in: reader.view.bounds, afterScreenUpdates: true)
        }
        return Page(locator: native, reflowLocation: reflowLocation, image: image, selector: first?.locations.cssSelector)
    }
    private func trace(_ message: String) {
        #if DEBUG
        NSLog("SHUDENG_CURL %@", message)
        #endif
    }
    private enum MoveError: Error { case highlights, failed, display }

    // Success requires BOTH go completion and a matching location callback.
    // The timer is only a failure watchdog; it never makes a page ready.
    private func move(to expected: Locator? = nil, direction: Int = 0) async throws -> Locator? {
        guard active, let start = reader.currentLocation else { throw MoveError.failed }
        trace("move start=\(key(start)) target=\(expected.map(key) ?? String(direction))")
        if let expected, same(start, expected),
           expected.locations.cssSelector == nil ||
           start.locations.cssSelector == expected.locations.cssSelector {
            return start
        }
        let location: Locator? = try await withCheckedThrowingContinuation { continuation in
            var finished = false
            var accepted = false
            var candidate: Locator?
            @MainActor func finish(_ result: Result<Locator?, Error>) {
                guard !finished else { return }
                finished = true
                waiter = nil; cancelWait = nil
                trace("move result=\(result) actual=\(reader.currentLocation.map(key) ?? "nil")")
                continuation.resume(with: result)
            }
            cancelWait = { finish(.failure(MoveError.failed)) }
            waiter = { [self] locator in
                let matches: Bool
                if let expected { matches = same(locator, expected) }
                else if locator.href == start.href {
                    matches = Double(direction) * ((locator.locations.progression ?? 0) - (start.locations.progression ?? 0)) > 0.0001
                } else {
                    let old = publication.readingOrder.firstIndex { $0.url().removingFragment() == start.href.removingFragment() }
                    let new = publication.readingOrder.firstIndex { $0.url().removingFragment() == locator.href.removingFragment() }
                    matches = old != nil && new != nil && direction * (new! - old!) > 0
                }
                guard matches else { return }
                candidate = locator
                if accepted { finish(.success(locator)) }
            }
            Task {
                guard active, !finished else { return }
                let result: Bool
                if let expected { result = await reader.go(to: expected, options: .none) }
                else if direction > 0 { result = await reader.goForward(options: .none) }
                else { result = await reader.goBackward(options: .none) }
                guard !finished else { return }
                accepted = result
                trace("accepted=\(result)")

                if !result {
                    // A refused turn is a boundary only at the corresponding book end.
                    let first = start.href.removingFragment() == publication.readingOrder.first?.url().removingFragment()
                    let last = start.href.removingFragment() == publication.readingOrder.last?.url().removingFragment()
                    let endVisible: Bool
                    if case let .success(atEnd as Bool) = await reader.evaluateJavaScript(
                        "Math.abs(window.scrollX) + innerWidth >= document.scrollingElement.scrollWidth - 2") {
                        endVisible = atEnd
                    } else { endVisible = false }
                    let boundary = expected == nil && ((direction < 0 && first && (start.locations.progression ?? 0) < 0.0001) || (direction > 0 && last && endVisible))

                    finish(boundary ? .success(nil) : .failure(MoveError.failed))
                } else if let candidate { finish(.success(candidate)) }
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 8) { finish(.failure(MoveError.failed)) }
        }
        // Readium 3.11 debounces scroll-end by 0.3s. Its location callback can
        // arrive from an earlier pending update before that debounce completes.
        // A reverse move during that window can cancel the next notification.
        // Serialize past the upstream debounce AFTER verified arrival; this is
        // not a rendering-success timeout. Revalidate before using the result.
        try await Task.sleep(nanoseconds: 350_000_000)
        guard active else { throw MoveError.failed }
        if let location, let actual = reader.currentLocation, !same(location, actual) { throw MoveError.failed }
        return location
    }

    private func prepare() async {
        guard active, var original = reader.currentLocation else { return }
        trace("prepare start=\(key(original))")
        userLocation = original
        working = true; busy()
        pager.view.isUserInteractionEnabled = false
        do {
            var record: Page
            if let existing = cache[key(original)] { record = existing }
            else { record = try await capture(original) }
            guard active else { return }
            original = record.locator
            userLocation = requiredFocus ?? record.reflowLocation
            let page = CurlPage(locator: original, image: record.image)
            current = page
            pager.setViewControllers([page], direction: .forward, animated: false)
            attach(to: readerParent, container: host)
            host.sendSubviewToBack(reader.view)
            following = controller(record.following); previous = controller(record.previous)
            if !record.nextKnown || (record.following != nil && following == nil) {
                if let location = try await move(direction: 1) {
                    var neighbor = try await capture(location)
                    neighbor.previous = key(original); neighbor.previousKnown = true
                    store(neighbor); record.following = key(neighbor.locator); following = controller(record.following)
                    _ = try await move(direction: -1)
                }
                record.nextKnown = true
                trace("prepare nextKnown")
            }
            if !record.previousKnown || (record.previous != nil && previous == nil) {
                if let location = try await move(direction: -1) {
                    var neighbor = try await capture(location)
                    neighbor.following = key(original); neighbor.nextKnown = true
                    store(neighbor); record.previous = key(neighbor.locator); previous = controller(record.previous)
                    _ = try await move(direction: 1)
                }
                record.previousKnown = true
                trace("prepare previousKnown")
            }
            guard active else { return }
            store(record)
            attach(to: page, container: page.view)
            let displayed = await reader.firstVisibleElementLocator()
            guard active else { return }
            let exactVisible: Bool
            if case let .success(visible as Bool) = await reader.evaluateJavaScript(ReaderController.targetIsVisible(requiredFocus ?? record.reflowLocation, fullyVisible: true)) {
                exactVisible = visible
            } else { exactVisible = false }
            guard let actual = await reader.refreshLocationFromViewport(), same(actual, original),
                  displayed?.locations.cssSelector == record.selector, exactVisible else {
                trace("display mismatch native=\(reader.currentLocation.map(key) ?? "nil") expected=\(key(original)) selector=\(displayed?.locations.cssSelector ?? "nil") wanted=\(record.selector ?? "nil")")
                throw MoveError.display
            }
            pager.dataSource = nil; pager.dataSource = self
            pager.view.isUserInteractionEnabled = true
            working = false
            trace("ready \(key(actual))")
            settled(actual, record.reflowLocation, true)
        } catch {
            trace("prepare failed \(error)")
            if active { working = true; failed() }
        }
    }
    func pageViewController(_ pageViewController: UIPageViewController, viewControllerBefore viewController: UIViewController) -> UIViewController? {
        guard !working else { return nil }
        if viewController === current { return previous }
        if viewController === following { return current }
        return nil
    }
    func pageViewController(_ pageViewController: UIPageViewController, viewControllerAfter viewController: UIViewController) -> UIViewController? {
        guard !working else { return nil }
        if viewController === current { return following }
        if viewController === previous { return current }
        return nil
    }
    func pageViewController(_ pageViewController: UIPageViewController, willTransitionTo pendingViewControllers: [UIViewController]) {
        reader.clearSelection()
        busy()
    }
    func pageViewController(_ pageViewController: UIPageViewController, didFinishAnimating finished: Bool,
                            previousViewControllers: [UIViewController], transitionCompleted completed: Bool) {
        guard completed, let target = pager.viewControllers?.first as? CurlPage else {
            // No navigation and no save on a cancelled drag.
            if let current { settled(current.locator, cache[key(current.locator)]?.reflowLocation ?? current.locator, false) }
            return
        }
        // Publish the completed target synchronously, before go or prepare can
        // suspend. Rotation must keep it even while the reader visits neighbors.
        userLocation = cache[key(target.locator)]?.reflowLocation ?? target.locator
        requiredFocus = userLocation
        // Unlike prepare(), this event is an explicit completed user action.
        // Publish synchronously so interruption/rotation retains its target.
        if let userLocation { userTurned(userLocation) }
        working = true; pager.view.isUserInteractionEnabled = false
        task = Task {
            guard active else { return }
            attach(to: readerParent, container: host)
            host.sendSubviewToBack(reader.view)
            do {
                _ = try await move(to: target.locator)
                guard active else { return }
                await prepare()
            } catch { if active { failed() } }
        }
    }
}

/// 页角书签丝带：当前页有书签时显示的小标记。
private final class BookmarkRibbonButton: UIButton {
    override init(frame: CGRect) {
        super.init(frame: frame)
        var configuration = UIButton.Configuration.plain()
        configuration.image = BookDesign.symbol("bookmark.fill", size: 15, weight: .semibold)
        configuration.baseForegroundColor = BookDesign.lampInk
        configuration.contentInsets = .zero
        self.configuration = configuration
        backgroundColor = BookDesign.paper
        layer.cornerRadius = 7
        layer.cornerCurve = .continuous
        layer.borderWidth = 1
        layer.shadowColor = UIColor.black.cgColor
        layer.shadowOpacity = 0.08
        layer.shadowRadius = 2
        layer.shadowOffset = CGSize(width: 0, height: 1)
        accessibilityIdentifier = "reader-bookmark-ribbon"
        accessibilityLabel = "添加本页书签"
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    override func layoutSubviews() {
        super.layoutSubviews()
        layer.borderColor = BookDesign.line.resolvedColor(with: traitCollection).cgColor
    }
}

/// 高亮后出现的轻量 4 色调节条（非全屏、不遮挡正文中心）。
@MainActor
private final class HighlightColorBar: UIView {
    private let selected: HighlightColor
    private let swatchStack = UIStackView()
    private var buttons: [HighlightColor: UIButton] = [:]
    var onPick: ((HighlightColor) -> Void)?
    var onClose: (() -> Void)?

    init(selected: HighlightColor) {
        self.selected = selected
        super.init(frame: .zero)
        backgroundColor = BookDesign.surface
        layer.cornerRadius = 16
        layer.cornerCurve = .continuous
        layer.borderWidth = 1
        layer.borderColor = BookDesign.line.resolvedColor(with: traitCollection).cgColor
        BookElevation.floating(self)
        accessibilityIdentifier = "highlight-color-bar"
        accessibilityLabel = "高亮颜色"

        swatchStack.axis = .horizontal
        swatchStack.alignment = .center
        swatchStack.spacing = 14
        swatchStack.translatesAutoresizingMaskIntoConstraints = false
        for color in HighlightColor.allCases {
            let button = makeSwatch(color)
            swatchStack.addArrangedSubview(button)
        }
        addSubview(swatchStack)

        let close = UIButton(type: .system)
        var closeConfiguration = UIButton.Configuration.plain()
        closeConfiguration.image = BookDesign.symbol("xmark", size: 11, weight: .semibold)
        closeConfiguration.baseForegroundColor = BookDesign.ink3
        closeConfiguration.contentInsets = .zero
        close.configuration = closeConfiguration
        close.accessibilityIdentifier = "highlight-color-bar-close"
        close.accessibilityLabel = "收起调色条"
        close.translatesAutoresizingMaskIntoConstraints = false
        close.addAction(UIAction { [weak self] _ in self?.onClose?() }, for: .touchUpInside)
        addSubview(close)

        NSLayoutConstraint.activate([
            swatchStack.topAnchor.constraint(equalTo: topAnchor, constant: 10),
            swatchStack.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -10),
            swatchStack.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 16),
            swatchStack.trailingAnchor.constraint(equalTo: close.leadingAnchor, constant: -12),
            close.centerYAnchor.constraint(equalTo: centerYAnchor),
            close.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -12),
            close.widthAnchor.constraint(equalToConstant: 32),
            close.heightAnchor.constraint(equalToConstant: 32)
        ])
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    private func makeSwatch(_ color: HighlightColor) -> UIButton {
        let button = UIButton(type: .system)
        button.backgroundColor = color.tint
        button.layer.cornerRadius = 14
        button.layer.cornerCurve = .continuous
        button.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            button.widthAnchor.constraint(equalToConstant: 28),
            button.heightAnchor.constraint(equalToConstant: 28)
        ])
        button.accessibilityIdentifier = "highlight-color-" + color.rawValue
        button.accessibilityLabel = color.title + "高亮"
        button.accessibilityTraits = color == selected ? [.button, .selected] : .button
        button.layer.borderWidth = color == selected ? 2 : 0
        button.layer.borderColor = BookDesign.ink.resolvedColor(with: traitCollection).cgColor
        button.addAction(UIAction { [weak self] _ in
            self?.onPick?(color)
        }, for: .touchUpInside)
        buttons[color] = button
        return button
    }

    func update(selected color: HighlightColor) {
        for (swatchColor, button) in buttons {
            button.accessibilityTraits = swatchColor == color ? [.button, .selected] : .button
            button.layer.borderWidth = swatchColor == color ? 2 : 0
            button.layer.borderColor = BookDesign.ink.resolvedColor(with: traitCollection).cgColor
        }
    }

    func place(in host: UIView) {
        NSLayoutConstraint.activate([
            centerXAnchor.constraint(equalTo: host.centerXAnchor),
            bottomAnchor.constraint(equalTo: host.safeAreaLayoutGuide.bottomAnchor, constant: -92),
            widthAnchor.constraint(lessThanOrEqualToConstant: 320)
        ])
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        layer.borderColor = BookDesign.line.resolvedColor(with: traitCollection).cgColor
    }

    func appear() {
        guard !UIAccessibility.isReduceMotionEnabled else { alpha = 1; return }
        alpha = 0
        transform = CGAffineTransform(translationX: 0, y: 8)
        UIView.animate(withDuration: 0.2, delay: 0, options: [.beginFromCurrentState, .curveEaseOut]) {
            self.alpha = 1
            self.transform = .identity
        }
    }

    func disappear(completion: (() -> Void)? = nil) {
        guard !UIAccessibility.isReduceMotionEnabled else { alpha = 0; completion?(); return }
        UIView.animate(withDuration: 0.15, animations: {
            self.alpha = 0
        }, completion: { _ in completion?() })
    }
}

/// 纸白高亮调色盘：4 色纸墨色卡，用于新建高亮选色与已有高亮改色。
@MainActor
private final class HighlightColorPaletteController: UIViewController {
    private let selected: HighlightColor?
    private let onPick: (HighlightColor) -> Void
    private let onDelete: (() -> Void)?
    private let deleteTitle: String
    private let dim = UIView()
    private let card = UIView()

    init(
        selected: HighlightColor?,
        onPick: @escaping (HighlightColor) -> Void,
        onDelete: (() -> Void)? = nil,
        deleteTitle: String = "删除高亮"
    ) {
        self.selected = selected
        self.onPick = onPick
        self.onDelete = onDelete
        self.deleteTitle = deleteTitle
        super.init(nibName: nil, bundle: nil)
        modalPresentationStyle = .overFullScreen
        modalTransitionStyle = .crossDissolve
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .clear
        view.accessibilityViewIsModal = true
        view.accessibilityIdentifier = "highlight-color-palette"

        dim.backgroundColor = UIColor.black.withAlphaComponent(0.34)
        dim.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(dim)
        dim.addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(cancelTapped)))
        NSLayoutConstraint.activate([
            dim.topAnchor.constraint(equalTo: view.topAnchor),
            dim.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            dim.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            dim.trailingAnchor.constraint(equalTo: view.trailingAnchor)
        ])

        card.backgroundColor = BookDesign.paper
        card.layer.cornerRadius = BookRadius.sheet
        card.layer.cornerCurve = .continuous
        BookElevation.floating(card)
        card.translatesAutoresizingMaskIntoConstraints = false
        card.accessibilityIdentifier = "highlight-color-card"
        view.addSubview(card)

        let stack = UIStackView()
        stack.axis = .vertical
        stack.spacing = 14
        stack.isLayoutMarginsRelativeArrangement = true
        stack.layoutMargins = UIEdgeInsets(top: 20, left: 20, bottom: 16, right: 20)
        stack.translatesAutoresizingMaskIntoConstraints = false
        card.addSubview(stack)

        let title = BookDesign.label("高亮颜色", font: BookType.serif(17, weight: .semibold, style: .headline))
        stack.addArrangedSubview(title)

        let swatches = UIStackView()
        swatches.axis = .horizontal
        swatches.distribution = .fillEqually
        swatches.spacing = 12
        for color in HighlightColor.allCases {
            swatches.addArrangedSubview(makeSwatch(color))
        }
        stack.addArrangedSubview(swatches)

        if let onDelete {
            let delete = makeTextButton(deleteTitle, colour: BookDesign.error)
            delete.accessibilityIdentifier = "highlight-delete"
            delete.addAction(UIAction { [weak self] _ in
                guard let self else { return }
                self.finish(then: onDelete)
            }, for: .touchUpInside)
            stack.addArrangedSubview(delete)
        }
        let cancel = makeTextButton("取消", colour: BookDesign.ink2)
        cancel.addAction(UIAction { [weak self] _ in self?.dismissPalette() }, for: .touchUpInside)
        stack.addArrangedSubview(cancel)

        NSLayoutConstraint.activate([
            card.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 8),
            card.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -8),
            card.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -8),
            stack.topAnchor.constraint(equalTo: card.topAnchor),
            stack.leadingAnchor.constraint(equalTo: card.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: card.trailingAnchor),
            stack.bottomAnchor.constraint(equalTo: card.bottomAnchor)
        ])
    }

    private func makeSwatch(_ color: HighlightColor) -> UIView {
        let button = UIButton(type: .system)
        button.backgroundColor = color.tint
        button.layer.cornerRadius = 22
        button.layer.cornerCurve = .continuous
        button.layer.borderWidth = color == selected ? 3 : 1
        button.layer.borderColor = (color == selected ? BookDesign.ink : BookDesign.line)
            .resolvedColor(with: traitCollection).cgColor
        button.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            button.widthAnchor.constraint(equalToConstant: 44),
            button.heightAnchor.constraint(equalToConstant: 44)
        ])
        button.accessibilityIdentifier = "highlight-color-" + color.rawValue
        button.accessibilityLabel = color.title + "高亮"
        button.accessibilityTraits = color == selected ? [.button, .selected] : .button
        button.addAction(UIAction { [weak self] _ in
            guard let self else { return }
            self.finish(then: { self.onPick(color) })
        }, for: .touchUpInside)

        let label = BookDesign.label(color.title, font: BookType.caption, colour: BookDesign.ink2)
        label.textAlignment = .center
        let column = UIStackView(arrangedSubviews: [button, label])
        column.axis = .vertical
        column.alignment = .center
        column.spacing = 6
        column.translatesAutoresizingMaskIntoConstraints = false
        return column
    }

    private func makeTextButton(_ title: String, colour: UIColor) -> UIButton {
        let button = UIButton(type: .system)
        var configuration = UIButton.Configuration.plain()
        configuration.title = title
        configuration.baseForegroundColor = colour
        configuration.contentInsets = NSDirectionalEdgeInsets(top: 12, leading: 16, bottom: 12, trailing: 16)
        configuration.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { incoming in
            var outgoing = incoming
            outgoing.font = BookType.sans(14, weight: .medium, style: .subheadline)
            return outgoing
        }
        button.configuration = configuration
        button.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
        return button
    }

    @objc private func cancelTapped() { dismissPalette() }

    private func dismissPalette() { finish(then: {}) }

    private func finish(then action: @escaping () -> Void) {
        let animate = !UIAccessibility.isReduceMotionEnabled
        UIView.animate(withDuration: animate ? 0.16 : 0, animations: {
            self.dim.alpha = 0
            self.card.alpha = 0
        }) { _ in
            self.dismiss(animated: false) { action() }
        }
    }
}
