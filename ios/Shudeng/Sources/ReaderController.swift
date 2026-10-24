import UIKit
import ReadiumShared
import ReadiumNavigator

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
    private let statusPanel = UIView()
    private let status = UILabel()
    private let retry = UIButton(type: .system)
    private var pendingLocation: Locator?
    private var saveFailed = false
    private var loading = true
    private var toolbarHidden = false
    private var loadFailed = false
    private var navigating = false
    private var navigationFailed = false
    private var curl: ReaderCurlController?
    private var curlBusy = false
    private var curlSize = CGSize.zero
    private var leaving = false
    private var changingBounds = false
    private var openingTarget: Locator?
    private var highlightedIDs: [UUID] = []
    var questionOrigin: Locator? {
        didSet {
            updateReferenceNavigation()
            if questionOrigin == nil { navigator.apply(decorations: [], in: "question-citation") }
        }
    }
    var referenceReturn: (() -> Void)?
    private var activeQuestion: UINavigationController?
    private var currentChapter = ""
    private var selectionMenu: ReaderSelectionMenu?
    private var menuPresentedAt: CFTimeInterval = 0

    init(book: Book, publication: Publication, library: LibraryStore, target: Locator? = nil) throws {
        self.book = book
        self.library = library
        bookRevision = library.revision(for: book.id)
        self.publication = publication
        openingTarget = target
        settings = book.readingSettings ?? ReadingSettings()
        navigator = try EPUBNavigatorViewController(publication: publication, initialLocation: library.location(for: book.id),
                                                   config: Self.configuration(settings))
        super.init(nibName: nil, bundle: nil)
        navigator.delegate = self
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }
    static let designedFontSize: CGFloat = 20
    static let designedLineHeight: Double = 1.95
    static let designedGutter: CGFloat = 29
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
                        textColor: Color(uiColor: BookDesign.ink.resolvedColor(with: traits)), theme: settings.dark ? .dark : .light)
    }

    static func configuration(_ settings: ReadingSettings) -> EPUBNavigatorViewController.Configuration {
        var rs = CSSRSProperties()
        rs.pageGutter = CSSPxLength(designedGutter)
        rs.selectionBackgroundColor = CSSIntColor(settings.dark ? 0x5B4D2D : 0xF4E3AC)
        rs.selectionTextColor = CSSIntColor(settings.dark ? 0xF0F1E9 : 0x282B26)
        let inset = EPUBContentInsets(top: designedGutter, bottom: 22)
        return .init(preferences: readingPreferences(settings), editingActions: [
            EditingAction(title: "高亮", action: #selector(highlightSelection)),
            EditingAction(title: "写笔记", action: #selector(noteSelection)),
            EditingAction(title: "提问", action: #selector(askSelection))
        ], contentInset: [.compact: inset, .regular: inset], readiumCSSRSProperties: rs)
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
        statusPanel.layer.cornerRadius = 12
        statusPanel.layer.borderWidth = 1
        statusPanel.layer.borderColor = BookDesign.line.cgColor
        status.font = BookDesign.font(12, style: .caption1)
        status.textColor = BookDesign.secondary
        status.numberOfLines = 0
        status.accessibilityIdentifier = "reading-save-status"
        status.text = "正在打开…"
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
        for child in [toolbar, content, footer, statusPanel] {
            child.translatesAutoresizingMaskIntoConstraints = false
            view.addSubview(child)
        }
        NSLayoutConstraint.activate([
            toolbar.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            toolbar.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            toolbar.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            toolbar.heightAnchor.constraint(equalToConstant: 51),
            content.topAnchor.constraint(equalTo: toolbar.bottomAnchor),
            content.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            content.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            content.bottomAnchor.constraint(equalTo: footer.topAnchor),
            footer.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            footer.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            footer.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor),
            footer.heightAnchor.constraint(equalToConstant: 66),
            statusPanel.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 20),
            statusPanel.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -20),
            statusPanel.bottomAnchor.constraint(equalTo: footer.topAnchor, constant: -8)
        ])
        attachNavigator()
        NotificationCenter.default.addObserver(self, selector: #selector(background), name: UIApplication.willResignActiveNotification, object: nil)
    }
    deinit { NotificationCenter.default.removeObserver(self) }
    private func attachNavigator() {
        applyHighlights()
        if questionOrigin != nil, let target = openingTarget {
            navigator.apply(decorations: [Decoration(id: "citation", locator: target, style: .highlight(tint: BookDesign.selection))], in: "question-citation")
        }
        navigator.observeDecorationInteractions(inGroup: "notes") { [weak self] event in
            guard let self, !self.loading, !self.curlBusy, !self.navigating,
                  let note = self.library.books.first(where: { $0.id == self.book.id })?.notes?.first(where: { $0.id.uuidString == event.decoration.id }) else { return }
            self.edit(note)
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
        status.text = text
        status.textColor = error ? BookDesign.error : BookDesign.secondary
        retry.isHidden = !retryVisible
        retry.isUserInteractionEnabled = retryVisible
        statusPanel.alpha = visible ? 1 : 0
        statusPanel.isUserInteractionEnabled = visible
        if visible { view.bringSubviewToFront(statusPanel) }
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
        guard (changed != settings || force), !loading, !curlBusy else { return }
        stopCurl()
        loading = true
        toolbar.settingsButton.isEnabled = false
        toolbar.contentsButton.isEnabled = false
        content.isUserInteractionEnabled = false
        setStatus("正在应用阅读设置…", visible: true)
        navigator.delegate = nil
        Task {
            do {
                var location = userLocation ?? navigator.currentLocation ?? pendingLocation
                // An interrupted prefetch is showing a temporary neighbor. Its
                // JavaScript anchor must not overwrite the explicit user page.
                if userLocation == nil,
                   force || changed.scroll != settings.scroll || changed.pageCurl != settings.pageCurl || changed.fontSize != settings.fontSize,
                   case let .success(anchor as [String: String]) = await navigator.evaluateJavaScript(Self.visibleTextAnchor) {
                    location?.locations.cssSelector = anchor["selector"]
                    location?.text = Locator.Text(after: anchor["after"], before: anchor["before"], highlight: anchor["highlight"])
                }
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
                settings = changed
                setRetryVisible(saveFailed)
                navigator.delegate = self
                applyTheme()
                attachNavigator()
            } catch { showError() }
        }
    }
    // Transient reflow anchor; native locations remain the persisted format.
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
    @objc private func toggleToolbar() {
        toolbarHidden.toggle()
        // The 51 pt strip always remains reserved so revealing the controls
        // never repaginates or moves the reader's current line.
        toolbar.setSideControlsHidden(toolbarHidden)
        hideSelectionMenu()
        view.accessibilityCustomActions = [
            UIAccessibilityCustomAction(
                name: toolbarHidden ? "显示工具栏" : "隐藏工具栏",
                target: self,
                selector: #selector(toggleToolbar)
            )
        ]
    }
    func navigator(_ navigator: VisualNavigator, didTapAt point: CGPoint) {
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
    func navigator(_ navigator: Navigator, locationDidChange locator: Locator) {
        guard !leaving, !changingBounds, navigator === self.navigator, !loadFailed, !navigating, !navigationFailed else { return }
        if let target = openingTarget {
            openingTarget = nil
            loading = false
            navigate(to: target)
            return
        }
        if let curl {
            if curl.locationChanged(locator) { return }
            stopCurl()
        }
        if settings.pageCurl == true {
            pendingLocation = locator
            startCurl()
            return
        }
        loading = false
        content.isUserInteractionEnabled = true
        toolbar.settingsButton.isEnabled = true
        toolbar.contentsButton.isEnabled = true
        pendingLocation = locator
        updateLocationChrome(locator)
        hideSelectionMenu()
        // Never replace a native pagination location with a paragraph start.
        persistPending()
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
            try library.saveReadingState(pendingLocation, settings: settings, for: book.id)
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
        persistPending()
        guard !saveFailed, !loading else {
            let alert = UIAlertController(title: "位置与设置尚未保存", message: "返回书架后，未保存的变更可能丢失。", preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "留在阅读页", style: .cancel))
            alert.addAction(UIAlertAction(title: "仍然返回", style: .destructive) { [weak self] _ in self?.finishReading() })
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
        let alert = UIAlertController(title: "原文加载失败", message: "无法读取此处内容，请返回书架后重新打开。", preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "知道了", style: .default))
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
                pendingLocation = actual
                updateLocationChrome(actual)
                if settings.pageCurl == true { startCurl() }
                else { persistPending() }
            } else {
                setStatus("未能到达原文，未保存此次跳转；请重新选择目录或书签", error: true)
                let alert = UIAlertController(title: "无法定位原文", message: "目标位置无效或原文未显示，未覆盖上次阅读位置。", preferredStyle: .alert)
                alert.addAction(UIAlertAction(title: "知道了", style: .default))
                present(alert, animated: true)
            }
            completion?(arrived)
        }
    }

    private func startCurl() {
        guard !leaving, curl == nil else { return }
        navigator.nativePaginationEnabled = false
        curlSize = content.bounds.size
        let controller = ReaderCurlController(reader: navigator, publication: publication, host: content, parent: self,
            highlightsReady: { [weak self] in await self?.highlightsReady() ?? false },
            busy: { [weak self] in
                guard let self else { return }
                self.curlBusy = true
                self.toolbar.settingsButton.isEnabled = false
                self.toolbar.contentsButton.isEnabled = false
                self.setStatus("正在准备翻页…", visible: true)
            }, settled: { [weak self] actual, commit in
                guard let self else { return }
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
                self.view.setNeedsLayout()
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
        let alert = UIAlertController(title: "翻页准备失败", message: "未保存内部准备位置，可重试或恢复普通分页阅读。", preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "使用分页", style: .default) { [weak self] _ in
            self?.settings.pageCurl = false
            self?.retrySave()
        })
        alert.addAction(UIAlertAction(title: "稍后重试", style: .cancel))
        if presentedViewController == nil { present(alert, animated: true) }
    }
    override func viewWillTransition(to size: CGSize, with coordinator: UIViewControllerTransitionCoordinator) {
        super.viewWillTransition(to: size, with: coordinator)
        guard settings.pageCurl == true else { return }
        let userLocation = curl?.userLocation ?? pendingLocation
        #if DEBUG
        NSLog("SHUDENG_CURL rotate user=%@ actual=%@", userLocation?.description ?? "live", navigator.currentLocation?.description ?? "nil")
        #endif
        changingBounds = true
        stopCurl()
        coordinator.animate(alongsideTransition: nil) { [weak self] _ in
            guard let self, !self.leaving else { return }
            self.changingBounds = false
            self.loading = false
            self.changeSettings(self.settings, force: true, restoring: userLocation)
        }
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

    private func applyHighlights() {
        highlightedIDs = notes.map(\.id)
        navigator.apply(decorations: notes.compactMap { note in
            guard let locator = try? note.location() else { return nil }
            return Decoration(id: note.id.uuidString, locator: locator, style: .highlight(tint: BookDesign.selection))
        }, in: "notes")
    }
    // Readium applies decorations asynchronously. Verify actual ranges before
    // capturing a curl snapshot, including newly loaded neighboring resources.
    private func highlightsReady() async -> Bool {
        let reader = navigator
        guard let href = reader.currentLocation?.href.removingFragment() else { return false }
        let expected = notes.filter { (try? $0.location().href.removingFragment()) == href }.map { $0.id.uuidString }
        guard !expected.isEmpty else { return true }
        let ids = String(data: try! JSONEncoder().encode(expected), encoding: .utf8)!
        let script = """
        (() => {
          const items = readium.getDecorations('notes').items;
          return \(ids).every(id => {
            const item = items.find(i => i.decoration.id === id);
            if (!item || !item.container || !item.container.childElementCount) return false;
            const loc = item.decoration.locator, root = document.querySelector(loc.locations.cssSelector);
            if (!root || item.range.toString() !== loc.text.highlight) return false;
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
        guard highlightedIDs != notes.map(\.id) else { return }
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
        let sheet = UINavigationController(rootViewController: editor)
        sheet.overrideUserInterfaceStyle = overrideUserInterfaceStyle
        sheet.modalPresentationStyle = .fullScreen
        present(sheet, animated: true)
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
        guard let frame = selection.frame else { return }
        let menu = ReaderSelectionMenu()
        menu.onHighlight = { [weak self] in
            self?.captureSelection(writeNote: false, selection: selection)
        }
        menu.onNote = { [weak self] in
            self?.captureSelection(writeNote: true, selection: selection)
        }
        menu.onAsk = { [weak self] in
            self?.captureSelection(writeNote: false, question: true, selection: selection)
        }
        view.addSubview(menu)
        let selectionFrame = navigator.view.convert(frame, to: view)
        menu.place(in: view, above: selectionFrame)
        selectionMenu = menu
        menuPresentedAt = CACurrentMediaTime()
        Task { [weak self, weak menu] in
            guard let self, let menu,
                  case let .success(bounds as [String: Any]) =
                    await self.navigator.evaluateJavaScript(Self.selectionBounds),
                  let x = bounds["x"] as? CGFloat,
                  let y = bounds["y"] as? CGFloat,
                  let width = bounds["width"] as? CGFloat,
                  let height = bounds["height"] as? CGFloat,
                  width > 0, height > 0,
                  self.selectionMenu === menu,
                  self.navigator.currentSelection != nil else { return }
            let fullSelection = self.navigator.view.convert(
                CGRect(x: x, y: y, width: width, height: height),
                to: self.view
            )
            menu.place(in: self.view, above: fullSelection)
        }
    }
    private func hideSelectionMenu() {
        selectionMenu?.removeFromSuperview()
        selectionMenu = nil
        menuPresentedAt = 0
    }
    @objc private func highlightSelection() { captureSelection(writeNote: false) }
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
        navigation.modalPresentationStyle = .pageSheet
        navigation.sheetPresentationController?.detents = [.large()]
        present(navigation, animated: true)
    }
    private func showQuestionReference(_ target: Locator, origin: Locator) {
        guard !loading, !navigating, !curlBusy else { return }
        questionOrigin = origin
        navigator.clearSelection()
        navigator.apply(decorations: [Decoration(id: "citation", locator: target, style: .highlight(tint: BookDesign.glow))], in: "question-citation")
        navigate(to: target)
    }
    @objc private func backToQuestion() {
        guard loadFailed || (!loading && !navigating && !curlBusy) else { return }
        persistPending()
        if saveFailed {
            let alert = UIAlertController(title: "位置与设置尚未保存", message: "返回问答后，未保存的阅读位置或设置可能丢失。", preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "留在阅读页", style: .cancel))
            alert.addAction(UIAlertAction(title: "仍然返回问答", style: .destructive) { [weak self] _ in self?.finishQuestionReturn() })
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
                    sheet.sheetPresentationController?.detents = [.large()]
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
                let alert = UIAlertController(title: "无法保存选文", message: "未能确认原文选区，请重新选择。", preferredStyle: .alert)
                alert.addAction(UIAlertAction(title: "知道了", style: .default))
                present(alert, animated: true)
            }
        }
    }
    private func saveHighlight(_ note: BookNote) {
        do {
            try library.checkRevision(bookRevision, for: book.id)
            try library.saveNote(note, for: book.id, highlightOnly: true)
            navigator.clearSelection()
            refreshHighlights()
        } catch {
            let alert = UIAlertController(title: "高亮保存失败", message: "尚未保存；重试仍使用同一条记录。", preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "重试保存高亮", style: .default) { [weak self] _ in self?.saveHighlight(note) })
            alert.addAction(UIAlertAction(title: "取消", style: .cancel))
            present(alert, animated: true)
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
      const rect = selection.getRangeAt(0).getBoundingClientRect();
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

    private static func targetIsVisible(_ locator: Locator) -> String {
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
          const visible = r => r.width > 0 && r.height > 0 && r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight;
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
    private let titleLabel = BookDesign.label(nil, size: 13, weight: .semibold)
    private let chapterLabel = BookDesign.label(nil, size: 10, colour: BookDesign.secondary, style: .caption2)
    private let leadingRegion = UIView()
    private let trailingRegion = UIView()
    private var leadingWidth: NSLayoutConstraint!
    private var backWidth: NSLayoutConstraint!

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = BookDesign.paper
        accessibilityIdentifier = "reader-toolbar"

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
        titleLabel.accessibilityIdentifier = "reader-title"
        chapterLabel.textAlignment = .center
        chapterLabel.lineBreakMode = .byTruncatingTail
        chapterLabel.adjustsFontForContentSizeCategory = true
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
            leadingRegion.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 13),
            leadingRegion.centerYAnchor.constraint(equalTo: centerYAnchor),
            leadingRegion.heightAnchor.constraint(equalToConstant: 44),
            trailingRegion.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -13),
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

    func setSideControlsHidden(_ hidden: Bool) {
        for control in [backButton, contentsButton, settingsButton] {
            control.alpha = hidden ? 0 : 1
            control.accessibilityElementsHidden = hidden
            control.isUserInteractionEnabled = !hidden
        }
    }

    private func configure(_ button: UIButton, image: String) {
        var config = UIButton.Configuration.plain()
        config.image = BookDesign.symbol(image, size: 20)
        config.baseForegroundColor = BookDesign.ink
        config.contentInsets = .zero
        config.imagePlacement = .leading
        config.imagePadding = 5
        config.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer {
            var attributes = $0
            attributes.font = BookDesign.font(14, weight: .medium)
            return attributes
        }
        button.configuration = config
        button.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
    }
}

@MainActor
final class ReaderFooterView: UIView {
    let askButton = UIButton(type: .system)
    private let progressLabel = BookDesign.label(nil, size: 11, colour: BookDesign.secondary, style: .caption2)
    private let chapterLabel = BookDesign.label(nil, size: 11, colour: BookDesign.secondary, style: .caption2)

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = BookDesign.paper
        accessibilityIdentifier = "reader-footer"

        var config = UIButton.Configuration.plain()
        config.title = "问问书灯"
        config.image = BookDesign.symbol("lightbulb", size: 19)
        config.imagePadding = 7
        config.baseForegroundColor = BookDesign.ink
        config.contentInsets = NSDirectionalEdgeInsets(top: 0, leading: 16, bottom: 0, trailing: 16)
        config.background.backgroundColor = BookDesign.surface
        config.background.strokeColor = BookDesign.line
        config.background.strokeWidth = 1
        config.background.cornerRadius = 24
        config.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer {
            var attributes = $0
            attributes.font = BookDesign.font(13, weight: .semibold)
            return attributes
        }
        askButton.configuration = config
        askButton.accessibilityLabel = "问问书灯"
        askButton.accessibilityIdentifier = "reader-ask-book"
        askButton.layer.shadowColor = BookDesign.ink.cgColor
        askButton.layer.shadowOpacity = 0.06
        askButton.layer.shadowRadius = 5
        askButton.layer.shadowOffset = CGSize(width: 0, height: 3)

        progressLabel.accessibilityIdentifier = "reader-progress"
        chapterLabel.accessibilityIdentifier = "reader-footer-chapter"
        chapterLabel.textAlignment = .right
        chapterLabel.lineBreakMode = .byTruncatingHead

        for child in [askButton, progressLabel, chapterLabel] {
            child.translatesAutoresizingMaskIntoConstraints = false
            addSubview(child)
        }
        NSLayoutConstraint.activate([
            askButton.centerXAnchor.constraint(equalTo: centerXAnchor),
            askButton.heightAnchor.constraint(equalToConstant: 44),
            askButton.topAnchor.constraint(equalTo: topAnchor, constant: 4),
            progressLabel.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 24),
            progressLabel.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -8),
            chapterLabel.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -24),
            chapterLabel.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -8),
            chapterLabel.leadingAnchor.constraint(greaterThanOrEqualTo: progressLabel.trailingAnchor, constant: 12)
        ])
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    func update(progress: String, chapter: String) {
        progressLabel.text = progress
        chapterLabel.text = chapter
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
        let useBelow = preferredAbove < minY
            && preferredBelow + 46 <= host.bounds.height - 82
        if useBelow {
            size.height = 46
        }
        var y = useBelow ? preferredBelow : preferredAbove
        if !useBelow, y < minY {
            y = minY
        }
        y = min(y, host.bounds.height - size.height - 82)
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
        tabs.selectedSegmentIndex = 0
        tabs.addTarget(self, action: #selector(refresh), for: .valueChanged)
        navigationItem.titleView = tabs
        navigationItem.leftBarButtonItem = UIBarButtonItem(title: "完成", style: .done, target: self, action: #selector(done))
        toolbarItems = [UIBarButtonItem(title: "书内搜索", style: .plain, target: self, action: #selector(openSearch)),
                        UIBarButtonItem(systemItem: .flexibleSpace),
                        UIBarButtonItem(title: "已读范围", style: .plain, target: self, action: #selector(openReadChapters))]
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
    @objc private func refresh() { tableView.reloadData() }
    @objc private func openSearch() {
        guard let book = library.books.first(where: { $0.id == bookID }) else { return }
        navigationController?.pushViewController(BookSearchController(library: library, book: book, navigate: navigate), animated: true)
    }
    @objc private func openReadChapters() {
        navigationController?.pushViewController(ReadChaptersController(publication: publication, library: library, bookID: bookID), animated: true)
    }
    @objc private func done() { dismiss(animated: true) }
    override func tableView(_ tableView: UITableView, titleForFooterInSection section: Int) -> String? { feedback }
    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
        max(1, tabs.selectedSegmentIndex == 0 ? contents.count : bookmarks.count)
    }
    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = UITableViewCell(style: .subtitle, reuseIdentifier: nil)
        cell.textLabel?.font = .preferredFont(forTextStyle: .body)
        cell.detailTextLabel?.font = .preferredFont(forTextStyle: .caption1)
        for label in [cell.textLabel, cell.detailTextLabel] { label?.numberOfLines = 0; label?.adjustsFontForContentSizeCategory = true }
        if tabs.selectedSegmentIndex == 0 {
            if contents.isEmpty { cell.textLabel?.text = contentsMessage; cell.selectionStyle = .none }
            else {
                let (link, depth) = contents[indexPath.row]
                cell.textLabel?.text = link.title ?? "未命名章节"
                cell.indentationLevel = min(depth, 4)
                cell.accessoryType = .disclosureIndicator
            }
        } else if bookmarks.isEmpty { cell.textLabel?.text = "暂无书签"; cell.selectionStyle = .none }
        else {
            let bookmark = bookmarks[indexPath.row]
            cell.textLabel?.text = bookmark.title
            cell.detailTextLabel?.text = bookmark.excerpt
            cell.accessibilityIdentifier = "bookmark-\(bookmark.id)"
            cell.accessoryType = .disclosureIndicator
        }
        return cell
    }
    override func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true)
        let isContents = tabs.selectedSegmentIndex == 0
        guard isContents ? !contents.isEmpty : !bookmarks.isEmpty else { return }
        let link = isContents ? contents[indexPath.row].0 : nil
        let bookmark = isContents ? nil : bookmarks[indexPath.row]
        Task {
            let target: Locator?
            if let link { target = await publication.locate(link) }
            else { target = try? bookmark?.location() }
            guard let target else { showFailure(title: "无法定位原文", message: "目标位置无效，请选择其他目录或书签。", retry: nil); return }
            dismiss(animated: true) { [navigate] in navigate(target) }
        }
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
        tabs.selectedSegmentIndex == 1 && !bookmarks.isEmpty
    }
    override func tableView(_ tableView: UITableView, titleForDeleteConfirmationButtonForRowAt indexPath: IndexPath) -> String? { "移除" }
    override func tableView(_ tableView: UITableView, commit editingStyle: UITableViewCell.EditingStyle, forRowAt indexPath: IndexPath) {
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
        let alert = UIAlertController(title: title, message: message, preferredStyle: .alert)
        if let retry { alert.addAction(UIAlertAction(title: "重试保存", style: .default) { _ in retry() }) }
        alert.addAction(UIAlertAction(title: retry == nil ? "知道了" : "取消", style: .cancel))
        present(alert, animated: true)
    }
}

@MainActor
private final class ReadingSettingsController: UIViewController {
    private var settings: ReadingSettings
    private let apply: (ReadingSettings) -> Void
    private let mode = UISegmentedControl(items: ["分页", "滚动", "仿真"])
    private let theme = UISegmentedControl(items: ["明亮", "深色"])
    private let size = UILabel()
    private let decrease = UIButton(type: .system)
    private let increase = UIButton(type: .system)

    init(settings: ReadingSettings, apply: @escaping (ReadingSettings) -> Void) {
        self.settings = settings
        self.apply = apply
        super.init(nibName: nil, bundle: nil)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }
    override func viewDidLoad() {
        super.viewDidLoad()
        title = "阅读设置"
        view.backgroundColor = .systemBackground
        navigationItem.leftBarButtonItem = UIBarButtonItem(title: "取消", style: .plain, target: self, action: #selector(cancel))
        navigationItem.rightBarButtonItem = UIBarButtonItem(title: "完成", style: .done, target: self, action: #selector(done))
        mode.selectedSegmentIndex = settings.pageCurl == true ? 2 : settings.scroll ? 1 : 0
        theme.selectedSegmentIndex = settings.dark ? 1 : 0
        decrease.setTitle("A−", for: .normal)
        decrease.accessibilityLabel = "缩小字号"
        decrease.addTarget(self, action: #selector(smaller), for: .touchUpInside)
        increase.setTitle("A+", for: .normal)
        increase.accessibilityLabel = "增大字号"
        increase.addTarget(self, action: #selector(larger), for: .touchUpInside)
        size.font = .preferredFont(forTextStyle: .body)
        size.adjustsFontForContentSizeCategory = true
        size.textAlignment = .center
        size.accessibilityIdentifier = "font-size"
        let font = UIStackView(arrangedSubviews: [decrease, size, increase])
        for button in [decrease, increase] {
            button.widthAnchor.constraint(equalToConstant: 44).isActive = true
        }
        for control in [mode, theme, decrease, increase] { control.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true }
        let stack = UIStackView(arrangedSubviews: [label("阅读方式"), mode, label("字号"), font, label("主题"), theme, label("仅用于本书；点击完成后应用并保存。")])
        stack.axis = .vertical
        stack.spacing = 20
        let scroll = UIScrollView()
        scroll.translatesAutoresizingMaskIntoConstraints = false
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(scroll)
        scroll.addSubview(stack)
        NSLayoutConstraint.activate([
            scroll.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            scroll.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor),
            scroll.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            stack.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor, constant: 24),
            stack.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor, constant: -24),
            stack.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor, constant: 24),
            stack.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor, constant: -24),
            stack.widthAnchor.constraint(equalTo: scroll.frameLayoutGuide.widthAnchor, constant: -48)
        ])
        updateSize()
    }
    private func label(_ text: String) -> UILabel {
        let label = UILabel()
        label.text = text
        label.font = .preferredFont(forTextStyle: .body)
        label.adjustsFontForContentSizeCategory = true
        label.numberOfLines = 0
        return label
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

@MainActor
private final class ReadChaptersController: UITableViewController {
    private let publication: Publication
    private let library: LibraryStore
    private let bookID: String
    private var names: [String] = []
    private var feedback: String?
    init(publication: Publication, library: LibraryStore, bookID: String) {
        self.publication = publication; self.library = library; self.bookID = bookID
        super.init(style: .insetGrouped)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }
    override func viewDidLoad() {
        super.viewDidLoad()
        title = "已读范围"; tableView.accessibilityIdentifier = "read-chapters"
        names = publication.readingOrder.enumerated().map { $0.element.title ?? "正文\($0.offset + 1)" }
        Task {
            if let contents = try? await publication.tableOfContents().get() {
                func titles(_ links: [Link], href: AnyURL) -> [String] {
                    links.flatMap { link in
                        (link.url().removingFragment() == href ? [link.title ?? "未命名章节"] : []) + titles(link.children, href: href)
                    }
                }
                names = publication.readingOrder.enumerated().map { index, link in
                    let values = titles(contents, href: link.url().removingFragment())
                    return values.isEmpty ? names[index] : values.joined(separator: "、")
                }
                tableView.reloadData()
            }
        }
    }
    override func tableView(_ tableView: UITableView, titleForHeaderInSection section: Int) -> String? {
        "请明确确认已读章节；可跳章勾选，不包含之前未勾选的章节。"
    }
    override func tableView(_ tableView: UITableView, titleForFooterInSection section: Int) -> String? {
        (feedback.map { $0 + "\n" } ?? "") + "每项对应原书一个完整正文文件，可能包含多个目录小节；全部读过才确认。仅浏览、翻页、搜索、引用往返及内部预取不会改变已读范围。旧阅读进度不推算为已读；仅已读可能缺少后文解释。"
    }
    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { names.count }
    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = UITableViewCell(style: .subtitle, reuseIdentifier: nil)
        cell.textLabel?.text = names[indexPath.row]
        let read = library.readScope(for: bookID).permits(chapter: indexPath.row, ordinal: 0)
        cell.detailTextLabel?.text = read ? "已确认已读" : "未确认已读"
        cell.isAccessibilityElement = true
        cell.accessibilityLabel = names[indexPath.row] + "，" + (read ? "已确认已读" : "未确认已读")
        for label in [cell.textLabel, cell.detailTextLabel] { label?.numberOfLines = 0; label?.adjustsFontForContentSizeCategory = true }
        cell.accessoryType = read ? .checkmark : .none
        cell.accessibilityIdentifier = "read-chapter-\(indexPath.row)"
        return cell
    }
    override func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true)
        let chapter = indexPath.row
        let read = library.readScope(for: bookID).permits(chapter: chapter, ordinal: 0)
        let alert = UIAlertController(title: read ? "移出已读范围？" : "确认整项已读？",
            message: names[chapter] + "\n包含此正文文件的全部内容及目录小节；确认后可用于仅已读问答。其他章节不受影响。", preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "取消", style: .cancel))
        alert.addAction(UIAlertAction(title: read ? "移出" : "确认已读", style: .default) { [weak self] _ in self?.save(chapter, read: !read) })
        present(alert, animated: true)
    }
    private func save(_ chapter: Int, read: Bool) {
        do {
            try library.setChapterRead(chapter, read: read, for: bookID)
            feedback = "已读范围已保存"; tableView.reloadData()
        } catch {
            let alert = UIAlertController(title: "已读范围保存失败", message: "此次变更未生效；仅已读仍使用上次已保存范围。", preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "取消", style: .cancel))
            alert.addAction(UIAlertAction(title: "重试保存", style: .default) { [weak self] _ in self?.save(chapter, read: read) })
            present(alert, animated: true)
        }
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
    private unowned let readerParent: UIViewController
    private let busy: () -> Void
    private let settled: (Locator, Bool) -> Void
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
         highlightsReady: @escaping () async -> Bool,
         busy: @escaping () -> Void, settled: @escaping (Locator, Bool) -> Void, failed: @escaping () -> Void) {
        self.reader = reader; self.publication = publication; self.host = host; readerParent = parent
        self.highlightsReady = highlightsReady
        self.busy = busy; self.settled = settled; self.failed = failed
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
        guard await highlightsReady(), active else { throw MoveError.failed }
        let first = await reader.firstVisibleElementLocator()
        var reflowLocation = locator
        if case let .success(anchor as [String: String]) = await reader.evaluateJavaScript(ReaderController.visibleTextAnchor) {
            reflowLocation.locations.cssSelector = anchor["selector"]
            reflowLocation.text = Locator.Text(after: anchor["after"], before: anchor["before"], highlight: anchor["highlight"])
        }
        let image = UIGraphicsImageRenderer(bounds: reader.view.bounds).image { _ in
            reader.view.drawHierarchy(in: reader.view.bounds, afterScreenUpdates: true)
        }
        return Page(locator: locator, reflowLocation: reflowLocation, image: image, selector: first?.locations.cssSelector)
    }
    private func trace(_ message: String) {
        #if DEBUG
        NSLog("SHUDENG_CURL %@", message)
        #endif
    }
    private enum MoveError: Error { case failed }

    // Success requires BOTH go completion and a matching location callback.
    // The timer is only a failure watchdog; it never makes a page ready.
    private func move(to expected: Locator? = nil, direction: Int = 0) async throws -> Locator? {
        guard active, let start = reader.currentLocation else { throw MoveError.failed }
        trace("move start=\(key(start)) target=\(expected.map(key) ?? String(direction))")
        if let expected, same(start, expected) { return start }
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
        guard active, let original = reader.currentLocation else { return }
        userLocation = original
        working = true; busy()
        pager.view.isUserInteractionEnabled = false
        do {
            var record: Page
            if let existing = cache[key(original)] { record = existing }
            else { record = try await capture(original) }
            guard active else { return }
            userLocation = record.reflowLocation
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
                    store(neighbor); record.following = key(location); following = controller(record.following)
                    _ = try await move(to: original)
                }
                record.nextKnown = true
            }
            if !record.previousKnown || (record.previous != nil && previous == nil) {
                if let location = try await move(direction: -1) {
                    var neighbor = try await capture(location)
                    neighbor.following = key(original); neighbor.nextKnown = true
                    store(neighbor); record.previous = key(location); previous = controller(record.previous)
                    _ = try await move(to: original)
                }
                record.previousKnown = true
            }
            guard active else { return }
            store(record)
            attach(to: page, container: page.view)
            let displayed = await reader.firstVisibleElementLocator()
            guard active else { return }
            guard let actual = reader.currentLocation, same(actual, original), displayed?.locations.cssSelector == record.selector else {
                trace("display mismatch native=\(reader.currentLocation.map(key) ?? "nil") expected=\(key(original)) selector=\(displayed?.locations.cssSelector ?? "nil") wanted=\(record.selector ?? "nil")")
                throw MoveError.failed
            }
            pager.dataSource = nil; pager.dataSource = self
            pager.view.isUserInteractionEnabled = true
            working = false
            trace("ready \(key(actual))")
            settled(actual, true)
        } catch { if active { working = true; failed() } }
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
            if let current { settled(current.locator, false) }
            return
        }
        // Publish the completed target synchronously, before go or prepare can
        // suspend. Rotation must keep it even while the reader visits neighbors.
        userLocation = cache[key(target.locator)]?.reflowLocation ?? target.locator
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
