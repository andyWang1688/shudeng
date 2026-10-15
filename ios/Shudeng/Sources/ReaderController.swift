import UIKit
import ReadiumShared
import ReadiumNavigator

@MainActor
final class ReaderController: UIViewController, EPUBNavigatorDelegate {
    private let book: Book
    private let library: LibraryStore
    private let publication: Publication
    private var navigator: EPUBNavigatorViewController
    private var settings: ReadingSettings
    private let content = UIView()
    private let status = UILabel()
    private let retry = UIButton(type: .system)
    private let close = UIButton(type: .system)
    private let configure = UIButton(type: .system)
    private let toggle = UIButton(type: .system)
    private var pendingLocation: Locator?
    private var saveFailed = false
    private var loading = true
    private var toolbarHidden = false
    private var loadFailed = false

    init(book: Book, publication: Publication, library: LibraryStore) throws {
        self.book = book
        self.library = library
        self.publication = publication
        settings = book.readingSettings ?? ReadingSettings()
        navigator = try EPUBNavigatorViewController(publication: publication, initialLocation: library.location(for: book.id),
                                                   config: .init(preferences: Self.preferences(settings)))
        super.init(nibName: nil, bundle: nil)
        navigator.delegate = self
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }
    private static func preferences(_ settings: ReadingSettings) -> EPUBPreferences {
        EPUBPreferences(fontSize: Double(settings.fontSize) / 100, publisherStyles: false,
                        scroll: settings.scroll, theme: settings.dark ? .dark : .light)
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
        toggle.setImage(UIImage(systemName: "eye.slash"), for: .normal)
        toggle.accessibilityLabel = "隐藏工具栏"
        toggle.addTarget(self, action: #selector(toggleToolbar), for: .touchUpInside)
        for button in [close, configure, toggle] {
            button.titleLabel?.font = .preferredFont(forTextStyle: .body)
            button.titleLabel?.adjustsFontForContentSizeCategory = true
            button.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
        }
        toggle.widthAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
        let header = UIStackView(arrangedSubviews: [close, UIView(), configure, toggle])
        header.spacing = 12
        status.font = .preferredFont(forTextStyle: .caption1)
        status.adjustsFontForContentSizeCategory = true
        status.textColor = .secondaryLabel
        status.numberOfLines = 0
        status.accessibilityIdentifier = "reading-save-status"
        status.text = "正在打开…"
        retry.setTitle("重试保存", for: .normal)
        retry.titleLabel?.font = .preferredFont(forTextStyle: .body)
        retry.titleLabel?.adjustsFontForContentSizeCategory = true
        retry.addTarget(self, action: #selector(retrySave), for: .touchUpInside)
        retry.isHidden = true
        let footer = UIStackView(arrangedSubviews: [status, retry])
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
    private func changeSettings(_ changed: ReadingSettings) {
        guard changed != settings, !loading else { return }
        loading = true
        configure.isEnabled = false
        content.isUserInteractionEnabled = false
        status.text = "正在应用阅读设置…"
        navigator.delegate = nil
        Task {
            do {
                var location = navigator.currentLocation ?? pendingLocation
                if changed.scroll != settings.scroll || changed.fontSize != settings.fontSize,
                   case let .success(anchor as [String: String]) = await navigator.evaluateJavaScript(Self.visibleTextAnchor) {
                    location?.locations.cssSelector = anchor["selector"]
                    location?.text = Locator.Text(after: anchor["after"], before: anchor["before"], highlight: anchor["highlight"])
                }
                // A fresh navigator emits its initial location even for theme-only
                // changes. Save only its settled location with the new preferences.
                let next = try EPUBNavigatorViewController(publication: publication,
                    initialLocation: location,
                    config: .init(preferences: Self.preferences(changed)))
                loading = true
                configure.isEnabled = false
                retry.isHidden = true
                status.text = "正在应用阅读设置…"
                status.textColor = .secondaryLabel
                navigator.delegate = nil
                navigator.willMove(toParent: nil)
                navigator.view.removeFromSuperview()
                navigator.removeFromParent()
                navigator = next
                settings = changed
                navigator.delegate = self
                applyTheme()
                attachNavigator()
            } catch { showError() }
        }
    }
    // Transient reflow anchor; native locations remain the persisted format.
    // Preserve the first visible character, including inside a long paragraph,
    // with element-scoped quotation context rather than a paragraph start.
    private static let visibleTextAnchor = """
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
        close.accessibilityElementsHidden = toolbarHidden
        configure.accessibilityElementsHidden = toolbarHidden
        toggle.accessibilityLabel = toolbarHidden ? "显示工具栏" : "隐藏工具栏"
        toggle.setImage(UIImage(systemName: toolbarHidden ? "eye" : "eye.slash"), for: .normal)
    }
    func navigator(_ navigator: VisualNavigator, didTapAt point: CGPoint) {
        guard point.x > content.bounds.width * 0.3, point.x < content.bounds.width * 0.7 else { return }
        toggleToolbar()
    }
    func navigator(_ navigator: Navigator, locationDidChange locator: Locator) {
        guard navigator === self.navigator, !loadFailed else { return }
        loading = false
        content.isUserInteractionEnabled = true
        configure.isEnabled = true
        pendingLocation = locator
        // Never replace a native pagination location with a paragraph start.
        persistPending()
    }
    private func persistPending() {
        guard !loading, let pendingLocation else { return }
        do {
            try library.saveReadingState(pendingLocation, settings: settings, for: book.id)
            saveFailed = false
            status.text = "阅读位置已保存"
            status.textColor = .secondaryLabel
            retry.isHidden = true
        } catch {
            saveFailed = true
            status.text = "位置与设置保存失败，重启将恢复上次已保存状态"
            status.textColor = .systemRed
            retry.isHidden = false
        }
    }
    @objc private func retrySave() {
        if loadFailed {
            loadFailed = false
            loading = true
            retry.isHidden = true
            status.text = "正在重新打开…"
            navigator.delegate = nil
            navigator.willMove(toParent: nil)
            navigator.view.removeFromSuperview()
            navigator.removeFromParent()
            do {
                navigator = try EPUBNavigatorViewController(publication: publication, initialLocation: pendingLocation,
                    config: .init(preferences: Self.preferences(settings)))
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
            alert.addAction(UIAlertAction(title: "仍然返回", style: .destructive) { [weak self] _ in self?.dismiss(animated: true) })
            present(alert, animated: true)
            return
        }
        dismiss(animated: true)
    }
    func navigator(_ navigator: Navigator, presentError error: NavigatorError) { showError() }
    func navigator(_ navigator: Navigator, didFailToLoadResourceAt href: RelativeURL, withError error: ReadError) { showError() }
    private func showError() {
        status.text = "原文加载失败，未保存此次变更"
        status.textColor = .systemRed
        loadFailed = true
        loading = true
        content.isUserInteractionEnabled = false
        configure.isEnabled = false
        retry.isHidden = false
        saveFailed = true
        guard presentedViewController == nil else { return }
        let alert = UIAlertController(title: "原文加载失败", message: "无法读取此处内容，请返回书架后重新打开。", preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "知道了", style: .default))
        present(alert, animated: true)
    }
}

@MainActor
private final class ReadingSettingsController: UIViewController {
    private var settings: ReadingSettings
    private let apply: (ReadingSettings) -> Void
    private let mode = UISegmentedControl(items: ["分页", "滚动"])
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
        mode.selectedSegmentIndex = settings.scroll ? 1 : 0
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
        settings.dark = theme.selectedSegmentIndex == 1
        dismiss(animated: true) { [apply, settings] in apply(settings) }
    }
}
