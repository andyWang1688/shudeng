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
    private let status = UILabel()
    private let retry = UIButton(type: .system)
    private let close = UIButton(type: .system)
    private let configure = UIButton(type: .system)
    private let browse = UIButton(type: .system)
    private let toggle = UIButton(type: .system)
    private let askBook = UIButton(type: .system)
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
    var questionOrigin: Locator? { didSet { returnToQuestion.isHidden = questionOrigin == nil } }
    private let returnToQuestion = UIButton(type: .system)

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
    private static func preferences(_ settings: ReadingSettings) -> EPUBPreferences {
        EPUBPreferences(fontSize: Double(settings.fontSize) / 100, publisherStyles: false,
                        scroll: settings.scroll && settings.pageCurl != true, theme: settings.dark ? .dark : .light)
    }
    private static func configuration(_ settings: ReadingSettings) -> EPUBNavigatorViewController.Configuration {
        .init(preferences: preferences(settings), editingActions: [
            EditingAction(title: "高亮", action: #selector(highlightSelection)),
            EditingAction(title: "提问", action: #selector(askSelection)),
            EditingAction(title: "写笔记", action: #selector(noteSelection))
        ] + EditingAction.defaultActions)
    }
    override func viewDidLoad() {
        super.viewDidLoad()
        applyTheme()
        close.setTitle("书架", for: .normal)
        close.addTarget(self, action: #selector(closeReader), for: .touchUpInside)
        configure.setTitle("设置", for: .normal)
        configure.accessibilityLabel = "阅读设置"
        configure.addTarget(self, action: #selector(openSettings), for: .touchUpInside)
        configure.isEnabled = false
        browse.setImage(UIImage(systemName: "list.bullet"), for: .normal)
        browse.accessibilityLabel = "目录与书签"
        browse.addTarget(self, action: #selector(openNavigation), for: .touchUpInside)
        browse.isEnabled = false
        browse.widthAnchor.constraint(equalToConstant: 44).isActive = true
        toggle.setImage(UIImage(systemName: "eye.slash"), for: .normal)
        toggle.accessibilityLabel = "隐藏工具栏"
        toggle.addTarget(self, action: #selector(toggleToolbar), for: .touchUpInside)
        askBook.setImage(UIImage(systemName: "bubble.left"), for: .normal)
        askBook.accessibilityLabel = "问这本书"; askBook.accessibilityIdentifier = "reader-ask-book"
        askBook.addTarget(self, action: #selector(askCurrentBook), for: .touchUpInside)
        askBook.widthAnchor.constraint(equalToConstant: 44).isActive = true
        for button in [close, configure, browse, toggle, askBook] {
            button.titleLabel?.font = .preferredFont(forTextStyle: .body)
            button.titleLabel?.adjustsFontForContentSizeCategory = true
            button.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
        }
        if traitCollection.preferredContentSizeCategory.isAccessibilityCategory {
            configure.setTitle(nil, for: .normal)
            configure.setImage(UIImage(systemName: "gearshape"), for: .normal)
            configure.widthAnchor.constraint(equalToConstant: 44).isActive = true
        }
        for button in [browse, configure, toggle] {
            button.setPreferredSymbolConfiguration(.init(pointSize: 20), forImageIn: .normal)
        }
        toggle.widthAnchor.constraint(equalToConstant: 44).isActive = true
        let header = UIStackView(arrangedSubviews: [close, UIView(), askBook, browse, configure, toggle])
        header.spacing = 12
        status.font = .preferredFont(forTextStyle: .caption1)
        status.adjustsFontForContentSizeCategory = true
        status.textColor = .secondaryLabel
        status.numberOfLines = 0
        status.heightAnchor.constraint(greaterThanOrEqualToConstant: status.font.lineHeight * 2).isActive = true
        status.accessibilityIdentifier = "reading-save-status"
        status.text = "正在打开…"
        retry.setTitle("重试保存", for: .normal)
        retry.titleLabel?.font = .preferredFont(forTextStyle: .body)
        retry.titleLabel?.adjustsFontForContentSizeCategory = true
        retry.addTarget(self, action: #selector(retrySave), for: .touchUpInside)
        setRetryVisible(false)
        returnToQuestion.setTitle("回提问处", for: .normal)
        returnToQuestion.addTarget(self, action: #selector(backToQuestion), for: .touchUpInside)
        returnToQuestion.isHidden = questionOrigin == nil
        returnToQuestion.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
        let footer = UIStackView(arrangedSubviews: [status, returnToQuestion, retry])
        footer.axis = .vertical
        footer.spacing = 4
        content.accessibilityIdentifier = "reading-content"
        for child in [header, content, footer] { child.translatesAutoresizingMaskIntoConstraints = false; view.addSubview(child) }
        NSLayoutConstraint.activate([
            header.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 4),
            header.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 16),
            header.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -16),
            content.topAnchor.constraint(equalTo: header.bottomAnchor),
            content.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            content.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            content.bottomAnchor.constraint(equalTo: footer.topAnchor, constant: -4),
            footer.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 20),
            footer.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -20),
            footer.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -4),
            footer.heightAnchor.constraint(greaterThanOrEqualToConstant: 28)
        ])
        attachNavigator()
        NotificationCenter.default.addObserver(self, selector: #selector(background), name: UIApplication.willResignActiveNotification, object: nil)
    }
    deinit { NotificationCenter.default.removeObserver(self) }
    private func attachNavigator() {
        applyHighlights()
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
        view.backgroundColor = .systemBackground
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
        configure.isEnabled = false
        browse.isEnabled = false
        content.isUserInteractionEnabled = false
        status.text = "正在应用阅读设置…"
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
                configure.isEnabled = false
                setRetryVisible(false)
                status.text = "正在应用阅读设置…"
                status.textColor = .secondaryLabel
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
        // Reserve the same space: showing controls never covers or repaginates
        // the text. The reveal button remains accessible without a gesture.
        close.alpha = toolbarHidden ? 0 : 1
        configure.alpha = toolbarHidden ? 0 : 1
        browse.alpha = toolbarHidden ? 0 : 1
        close.accessibilityElementsHidden = toolbarHidden
        configure.accessibilityElementsHidden = toolbarHidden
        browse.accessibilityElementsHidden = toolbarHidden
        toggle.accessibilityLabel = toolbarHidden ? "显示工具栏" : "隐藏工具栏"
        toggle.setImage(UIImage(systemName: toolbarHidden ? "eye" : "eye.slash"), for: .normal)
    }
    func navigator(_ navigator: VisualNavigator, didTapAt point: CGPoint) {
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
        configure.isEnabled = true
        browse.isEnabled = true
        pendingLocation = locator
        // Never replace a native pagination location with a paragraph start.
        persistPending()
    }
    private func setRetryVisible(_ visible: Bool) {
        // Keep a stable footer in curl mode. Collapsing the retry row on every
        // rebuild would alternately resize the viewport and invalidate itself.
        retry.isHidden = !visible && settings.pageCurl != true
        retry.alpha = visible ? 1 : 0
        retry.accessibilityElementsHidden = !visible
        retry.isUserInteractionEnabled = visible
    }
    private func persistPending() {
        guard !leaving, !changingBounds, !loading, !curlBusy, !navigating, !navigationFailed, let pendingLocation else { return }
        do {
            try library.checkRevision(bookRevision, for: book.id)
            try library.saveReadingState(pendingLocation, settings: settings, for: book.id)
            saveFailed = false
            status.text = "阅读位置已保存"
            status.textColor = .secondaryLabel
            setRetryVisible(false)
        } catch {
            saveFailed = true
            status.text = "位置与设置保存失败，重启将恢复上次已保存状态"
            status.textColor = .systemRed
            setRetryVisible(true)
        }
    }
    @objc private func retrySave() {
        if loadFailed {
            stopCurl()
            loadFailed = false
            loading = true
            setRetryVisible(false)
            status.text = "正在重新打开…"
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
        status.text = "原文加载失败，未保存此次变更"
        status.textColor = .systemRed
        loadFailed = true
        loading = true
        content.isUserInteractionEnabled = false
        configure.isEnabled = false
        browse.isEnabled = false
        setRetryVisible(true)
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

    private func navigate(to target: Locator) {
        guard (try? library.checkRevision(bookRevision, for: book.id)) != nil, library.sourceAvailable(for: book.id) else { return }
        guard !loading, !navigating else { return }
        stopCurl()
        navigating = true
        navigationFailed = false
        content.isUserInteractionEnabled = false
        for button in [browse, configure, close] { button.isEnabled = false }
        setRetryVisible(false)
        status.text = "正在定位原文…"
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
                       case let .success(visible as Bool) = await navigator.evaluateJavaScript(Self.targetIsVisible(target)), visible {
                        arrived = true
                        break
                    }
                    try? await Task.sleep(nanoseconds: 100_000_000)
                }
            }
            if arrived { try? await Task.sleep(nanoseconds: 350_000_000) }
            navigating = false
            close.isEnabled = true
            guard !loadFailed else { return }
            browse.isEnabled = true
            configure.isEnabled = arrived
            content.isUserInteractionEnabled = arrived
            navigationFailed = !arrived
            if arrived, let actual = navigator.currentLocation {
                pendingLocation = actual
                if settings.pageCurl == true { startCurl() }
                else { persistPending() }
            } else {
                status.text = "未能到达原文，未保存此次跳转；请重新选择目录或书签"
                status.textColor = .systemRed
                let alert = UIAlertController(title: "无法定位原文", message: "目标位置无效或原文未显示，未覆盖上次阅读位置。", preferredStyle: .alert)
                alert.addAction(UIAlertAction(title: "知道了", style: .default))
                present(alert, animated: true)
            }
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
                self.configure.isEnabled = false; self.browse.isEnabled = false
                self.status.text = "正在准备翻页…"
            }, settled: { [weak self] actual, commit in
                guard let self else { return }
                self.curlBusy = false; self.loading = false
                self.content.isUserInteractionEnabled = true
                self.configure.isEnabled = true; self.browse.isEnabled = true
                if commit { self.pendingLocation = actual; self.persistPending() }
                else { self.status.text = self.saveFailed ? "位置与设置保存失败" : "阅读位置已保存" }
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
        configure.isEnabled = false; browse.isEnabled = false
        status.text = "仿真翻页准备失败，请重试或使用分页"
        status.textColor = .systemRed
        setRetryVisible(true)
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
            return Decoration(id: note.id.uuidString, locator: locator, style: .highlight(tint: .systemYellow))
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
                status.text = "高亮未能显示，请返回书架后重试；已保存记录仍在笔记中"
                status.textColor = .systemRed
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
    @objc private func highlightSelection() { captureSelection(writeNote: false) }
    @objc private func noteSelection() { captureSelection(writeNote: true) }
    @objc private func askSelection() { captureSelection(writeNote: false, question: true) }
    @objc private func askCurrentBook() {
        guard (try? library.checkRevision(bookRevision, for: book.id)) != nil, library.sourceAvailable(for: book.id) else { return }
        guard !loading, !curlBusy, !navigating, !library.questions.loadFailed, let origin = navigator.currentLocation else { return }
        let record = ReadingQuestion(book: book, origin: origin)
        library.questions.save(record)
        navigator.clearSelection()
        let controller = QuestionController(library: library, id: record.id) { [weak self] target, origin in
            self?.questionOrigin = origin; self?.navigate(to: target)
        }
        let navigation = UINavigationController(rootViewController: controller)
        navigation.modalPresentationStyle = .pageSheet
        navigation.sheetPresentationController?.detents = [.large()]
        present(navigation, animated: true)
    }
    @objc private func backToQuestion() { if let questionOrigin { navigate(to: questionOrigin) } }
    private func captureSelection(writeNote: Bool, question: Bool = false) {
        guard !loading, !curlBusy, !navigating, let selection = navigator.currentSelection else { return }
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
                        self?.questionOrigin = origin; self?.navigate(to: target)
                    }
                    let sheet = UINavigationController(rootViewController: controller)
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
