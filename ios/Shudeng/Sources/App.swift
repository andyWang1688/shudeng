import UIKit
import UniformTypeIdentifiers
import ReadiumShared

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?
    func application(_ application: UIApplication, didFinishLaunchingWithOptions options: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        BookDesign.install()
        let window = UIWindow(frame: UIScreen.main.bounds)
        self.window = window
#if DEBUG
        if let fixture = DesignFixture.request(in: CommandLine.arguments) {
            do {
                let session = try DesignFixture.makeSession(fixture)
                window.overrideUserInterfaceStyle = fixture.theme
                window.rootViewController = makeApplicationTabs(
                    library: session.library,
                    root: session.root,
                    secrets: session.secrets
                )
                window.makeKeyAndVisible()
                Task { @MainActor in
                    do { try await DesignFixture.seed(session) }
                    catch { print("DESIGN_FIXTURE_ERROR \(error.localizedDescription)") }
                }
            } catch {
                let controller = UIViewController()
                controller.view.backgroundColor = BookDesign.paper
                window.rootViewController = controller
                window.makeKeyAndVisible()
                print("DESIGN_FIXTURE_ERROR \(error.localizedDescription)")
            }
            return true
        }
#endif
        window.overrideUserInterfaceStyle = UIUserInterfaceStyle(rawValue: UserDefaults.standard.integer(forKey: "interface-style")) ?? .unspecified
        do {
            var root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Shudeng")
#if DEBUG
            if ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] != nil ||
                ProcessInfo.processInfo.arguments.contains("--isolated-reading-test") {
                root = FileManager.default.temporaryDirectory.appendingPathComponent("ShudengReadingTests")
            }
#endif
            let secrets = KeychainSecrets()
            let library = try LibraryStore(root: root, secrets: secrets)
            library.prepareBooks()
            window.rootViewController = makeApplicationTabs(library: library, root: root, secrets: secrets)
        } catch {
            let controller = UIViewController()
            controller.view.backgroundColor = .systemBackground
            window.rootViewController = controller
            DispatchQueue.main.async {
                let alert = UIAlertController(title: "书架无法读取", message: "已有数据未被覆盖。请检查储存空间后重新打开应用。", preferredStyle: .alert)
                alert.addAction(UIAlertAction(title: "知道了", style: .default))
                controller.present(alert, animated: true)
            }
        }
        window.makeKeyAndVisible()
        return true
    }
}

@MainActor
func makeApplicationTabs(library: LibraryStore, root: URL, secrets: AISecrets) -> RootTabController {
    let shelf = UINavigationController(rootViewController: ShelfController(library: library))
    let notes = UINavigationController(rootViewController: NotesController(library: library))
    let chats = UINavigationController(rootViewController: QuestionHistoryController(library: library))
    let profile = ProfileController(root: root, secrets: secrets)
    return RootTabController(viewControllers: [shelf, notes, chats, UINavigationController(rootViewController: profile)])
}

final class ProfileController: UIViewController {
    private let root: URL
    private let secrets: AISecrets
    private let serviceRow = ProfileSettingsRow(
        symbol: "lightbulb",
        title: "AI 服务",
        identifier: "profile-ai-service"
    )
    private let appearanceRow = ProfileSettingsRow(
        symbol: "sun.max",
        title: "外观",
        identifier: "profile-appearance"
    )
    private let aboutRow = ProfileSettingsRow(
        symbol: "doc.text",
        title: "关于书灯",
        identifier: "profile-about"
    )

    init(root: URL, secrets: AISecrets = KeychainSecrets()) {
        self.root = root
        self.secrets = secrets
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    @objc private func aiSettings() {
        navigationController?.pushViewController(AISettingsController(root: root, secrets: secrets), animated: true)
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = BookDesign.paper
        view.accessibilityIdentifier = "profile-surface"

        let title = BookDesign.label("我的", size: 31, weight: .bold, style: .largeTitle)
        title.accessibilityIdentifier = "profile-title"

        let icon = ProfileBrandIconView(image: UIImage(named: "BrandIcon"))
        icon.isAccessibilityElement = true
        icon.accessibilityLabel = "书灯图标"
        icon.accessibilityIdentifier = "profile-brand-icon"

        let wordmark = BookDesign.label("书灯", size: 20, weight: .semibold)
        wordmark.textAlignment = .center
        wordmark.accessibilityIdentifier = "profile-wordmark"

        let motto = BookDesign.label("一盏照书的灯", size: 19)
        motto.font = BookDesign.readingFont(19)
        motto.textAlignment = .center

        let subtitle = BookDesign.label("AI 照亮你读不懂的地方", size: 12, colour: BookDesign.secondary)
        subtitle.textAlignment = .center
        motto.accessibilityLabel = "一盏照书的灯，AI 照亮你读不懂的地方"
        motto.accessibilityIdentifier = "profile-motto"
        subtitle.isAccessibilityElement = false

        let identity = UIStackView(arrangedSubviews: [icon, wordmark, motto, subtitle])
        identity.axis = .vertical
        identity.alignment = .center
        identity.spacing = 13
        identity.setCustomSpacing(12, after: wordmark)
        identity.setCustomSpacing(4, after: motto)
        identity.accessibilityIdentifier = "profile-brand"

        let settings = UIStackView()
        settings.axis = .vertical
        settings.spacing = 0
        settings.addArrangedSubview(separator())
        settings.addArrangedSubview(serviceRow)
        settings.addArrangedSubview(separator())
        settings.addArrangedSubview(appearanceRow)
        settings.addArrangedSubview(separator())
        settings.addArrangedSubview(aboutRow)
        settings.addArrangedSubview(separator())
        settings.accessibilityIdentifier = "profile-settings"

        let caption = BookDesign.label(
            "阅读进度、笔记与对话保存在本机。\n提问时，问题与必要原文会发送给你选择的 AI 服务。",
            size: 11,
            colour: BookDesign.secondary
        )
        caption.accessibilityIdentifier = "profile-storage-disclosure"

        let page = UIStackView(arrangedSubviews: [title, identity, settings, caption])
        page.axis = .vertical
        page.spacing = 0
        page.setCustomSpacing(28, after: title)
        page.setCustomSpacing(30, after: identity)
        page.setCustomSpacing(20, after: settings)

        let scroll = UIScrollView()
        scroll.alwaysBounceVertical = true
        scroll.translatesAutoresizingMaskIntoConstraints = false
        page.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(scroll)
        scroll.addSubview(page)
        NSLayoutConstraint.activate([
            scroll.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            scroll.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor),
            scroll.leadingAnchor.constraint(equalTo: view.leadingAnchor), scroll.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            page.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor, constant: 9),
            page.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor, constant: -24),
            page.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor, constant: 24),
            page.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor, constant: -24),
            page.widthAnchor.constraint(equalTo: scroll.frameLayoutGuide.widthAnchor, constant: -48),
            icon.widthAnchor.constraint(equalToConstant: 70),
            icon.heightAnchor.constraint(equalToConstant: 70)
        ])

        serviceRow.addTarget(self, action: #selector(aiSettings), for: .touchUpInside)
        appearanceRow.addTarget(self, action: #selector(showAppearance), for: .touchUpInside)
        aboutRow.addTarget(self, action: #selector(showAbout), for: .touchUpInside)
        aboutRow.setValue(version)
        updateAppearanceRow()
        reloadService()
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        navigationController?.setNavigationBarHidden(true, animated: false)
        reloadService()
        updateAppearanceRow()
    }

    private func reloadService() {
        do {
            let store = try AIConfigurationStore(root: root, secrets: secrets)
            let current = store.configurations.first { $0.id == store.selectedID }
            if let current {
                let separator = traitCollection.preferredContentSizeCategory.isAccessibilityCategory
                    ? "\n"
                    : " · "
                serviceRow.setDetail(current.name + separator + current.model)
            } else {
                serviceRow.setDetail("尚未配置，阅读仍可使用")
            }
        } catch {
            serviceRow.setDetail("服务配置暂时无法读取；已有配置未覆盖")
        }
    }

    override func traitCollectionDidChange(_ previousTraitCollection: UITraitCollection?) {
        super.traitCollectionDidChange(previousTraitCollection)
        if previousTraitCollection?.preferredContentSizeCategory
            != traitCollection.preferredContentSizeCategory {
            reloadService()
        }
    }

    private func separator() -> UIView {
        let line = UIView()
        line.backgroundColor = BookDesign.line
        line.heightAnchor.constraint(equalToConstant: 1).isActive = true
        return line
    }

    private var version: String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.1.0"
    }

    private var selectedAppearance: UIUserInterfaceStyle {
        UIUserInterfaceStyle(
            rawValue: UserDefaults.standard.integer(forKey: "interface-style")
        ) ?? .unspecified
    }

    private func updateAppearanceRow() {
        switch selectedAppearance {
        case .light: appearanceRow.setValue("浅色")
        case .dark: appearanceRow.setValue("深色")
        default: appearanceRow.setValue("跟随系统")
        }
    }

    @objc private func showAppearance() {
        let sheet = UIAlertController(
            title: "外观",
            message: "选择适合此刻阅读的界面外观。",
            preferredStyle: .actionSheet
        )
        for (style, name) in [
            (UIUserInterfaceStyle.unspecified, "跟随系统"),
            (.light, "浅色"),
            (.dark, "深色")
        ] {
            let prefix = selectedAppearance == style ? "✓ " : ""
            sheet.addAction(UIAlertAction(title: prefix + name, style: .default) { [weak self] _ in
                self?.setAppearance(style)
            })
        }
        sheet.addAction(UIAlertAction(title: "取消", style: .cancel))
        sheet.popoverPresentationController?.sourceView = appearanceRow
        sheet.popoverPresentationController?.sourceRect = appearanceRow.bounds
        present(sheet, animated: true)
    }

    func setAppearance(_ style: UIUserInterfaceStyle) {
        UserDefaults.standard.set(style.rawValue, forKey: "interface-style")
        view.window?.overrideUserInterfaceStyle = style
        updateAppearanceRow()
    }

    @objc private func showAbout() {
        navigationController?.pushViewController(
            AboutController(),
            animated: true
        )
    }
}

private final class ProfileBrandIconView: UIImageView {
    override init(image: UIImage?) {
        super.init(image: image)
        contentMode = .scaleAspectFit
        backgroundColor = BookDesign.surface
        layer.cornerRadius = 18
        layer.borderWidth = 1
        layer.shadowColor = UIColor.black.cgColor
        layer.shadowOpacity = 0.04
        layer.shadowRadius = 6
        layer.shadowOffset = CGSize(width: 0, height: 3)
        updateDecoration()
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        updateDecoration()
    }

    override func traitCollectionDidChange(_ previousTraitCollection: UITraitCollection?) {
        super.traitCollectionDidChange(previousTraitCollection)
        if previousTraitCollection?.userInterfaceStyle != traitCollection.userInterfaceStyle {
            updateDecoration()
        }
    }

    private func updateDecoration() {
        layer.borderColor = BookDesign.line.resolvedColor(with: traitCollection).cgColor
    }
}

private final class ProfileSettingsRow: UIControl {
    private let symbolView = UIImageView()
    private let titleLabel = BookDesign.label(nil, size: 15, weight: .medium)
    private let detailLabel = BookDesign.label(nil, size: 12, colour: BookDesign.secondary)
    private let valueLabel = BookDesign.label(nil, size: 12, colour: BookDesign.secondary)
    private let chevron = UIImageView(image: BookDesign.symbol("chevron.right", size: 15, weight: .medium))
    private let title: String
    private var detail: String?
    private var value: String?

    init(symbol: String, title: String, identifier: String) {
        self.title = title
        super.init(frame: .zero)
        accessibilityIdentifier = identifier
        isAccessibilityElement = true
        accessibilityTraits = .button

        symbolView.image = BookDesign.symbol(symbol, size: 20)
        symbolView.tintColor = BookDesign.accent
        symbolView.contentMode = .scaleAspectFit
        symbolView.isAccessibilityElement = false
        titleLabel.text = title
        detailLabel.isHidden = true
        valueLabel.textAlignment = .right
        chevron.tintColor = BookDesign.secondary
        chevron.contentMode = .scaleAspectFit
        chevron.isAccessibilityElement = false

        let text = UIStackView(arrangedSubviews: [titleLabel, detailLabel])
        text.axis = .vertical
        text.alignment = .leading
        text.spacing = 2
        text.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)

        let row = UIStackView(arrangedSubviews: [symbolView, text, UIView(), valueLabel, chevron])
        row.axis = .horizontal
        row.alignment = .center
        row.spacing = 12
        row.isUserInteractionEnabled = false
        row.translatesAutoresizingMaskIntoConstraints = false
        addSubview(row)

        NSLayoutConstraint.activate([
            row.topAnchor.constraint(equalTo: topAnchor),
            row.bottomAnchor.constraint(equalTo: bottomAnchor),
            row.leadingAnchor.constraint(equalTo: leadingAnchor),
            row.trailingAnchor.constraint(equalTo: trailingAnchor),
            heightAnchor.constraint(greaterThanOrEqualToConstant: 66),
            symbolView.widthAnchor.constraint(equalToConstant: 20),
            symbolView.heightAnchor.constraint(equalToConstant: 20),
            chevron.widthAnchor.constraint(equalToConstant: 15),
            chevron.heightAnchor.constraint(equalToConstant: 15)
        ])
        updateAccessibility()
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    func setDetail(_ detail: String?) {
        self.detail = detail
        detailLabel.text = detail
        detailLabel.isHidden = detail == nil
        updateAccessibility()
    }

    func setValue(_ value: String?) {
        self.value = value
        valueLabel.text = value
        updateAccessibility()
    }

    private func updateAccessibility() {
        accessibilityLabel = title
        accessibilityValue = detail ?? value
    }

    override var isHighlighted: Bool {
        didSet { alpha = isHighlighted ? 0.72 : 1 }
    }
}

private final class AboutController: UIViewController {
    init() {
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "关于书灯"
        navigationItem.largeTitleDisplayMode = .never
        view.backgroundColor = BookDesign.paper
        view.accessibilityIdentifier = "about-surface"

        let icon = ProfileBrandIconView(image: UIImage(named: "BrandIcon"))
        icon.isAccessibilityElement = false

        let wordmark = BookDesign.label("书灯", size: 20, weight: .semibold)
        wordmark.textAlignment = .center
        let motto = BookDesign.label("一盏照书的灯，AI 照亮你读不懂的地方", size: 15)
        motto.font = BookDesign.readingFont(15)
        motto.textAlignment = .center

        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.1.0"
        let release = BookDesign.label("版本 " + version, size: 12, colour: BookDesign.secondary)
        release.textAlignment = .center

        let thirdParty = ProfileSettingsRow(
            symbol: "doc.text",
            title: "第三方许可",
            identifier: "about-third-party"
        )
        thirdParty.addTarget(self, action: #selector(showLicenses), for: .touchUpInside)

        let group = UIStackView(arrangedSubviews: [separator(), thirdParty, separator()])
        group.axis = .vertical
        group.spacing = 0

        let identity = UIStackView(arrangedSubviews: [icon, wordmark, motto, release])
        identity.axis = .vertical
        identity.alignment = .center
        identity.spacing = 12

        let page = UIStackView(arrangedSubviews: [identity, group])
        page.axis = .vertical
        page.spacing = 30

        let scroll = UIScrollView()
        scroll.translatesAutoresizingMaskIntoConstraints = false
        page.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(scroll)
        scroll.addSubview(page)
        NSLayoutConstraint.activate([
            scroll.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            scroll.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor),
            scroll.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            page.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor, constant: 28),
            page.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor, constant: -32),
            page.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor, constant: 24),
            page.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor, constant: -24),
            page.widthAnchor.constraint(equalTo: scroll.frameLayoutGuide.widthAnchor, constant: -48),
            icon.widthAnchor.constraint(equalToConstant: 70),
            icon.heightAnchor.constraint(equalToConstant: 70)
        ])
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        navigationController?.setNavigationBarHidden(false, animated: false)
    }

    private func separator() -> UIView {
        let line = UIView()
        line.backgroundColor = BookDesign.line
        line.heightAnchor.constraint(equalToConstant: 1).isActive = true
        return line
    }

    @objc private func showLicenses() {
        navigationController?.pushViewController(
            LicensesController(),
            animated: true
        )
    }
}

private final class LicensesController: UIViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        title = "第三方许可"
        view.backgroundColor = BookDesign.paper
        let text = UITextView()
        text.isEditable = false
        text.font = .preferredFont(forTextStyle: .body)
        text.adjustsFontForContentSizeCategory = true
        text.backgroundColor = BookDesign.paper
        text.textColor = BookDesign.ink
        text.text = Bundle.main.url(forResource: "ThirdPartyNotices", withExtension: "txt")
            .flatMap { try? String(contentsOf: $0, encoding: .utf8) }
            ?? "许可文件无法读取"
        text.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(text)
        NSLayoutConstraint.activate([
            text.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            text.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            text.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 20),
            text.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -20)
        ])
    }
}

enum ShelfOrder: String, CaseIterable {
    case imported = "最近阅读", title = "书名排序"

    func books(_ books: [Book], matching query: String) -> [Book] {
        let query = query.trimmingCharacters(in: .whitespacesAndNewlines)
        let matches = books.filter { query.isEmpty || $0.title.localizedCaseInsensitiveContains(query) || $0.author.localizedCaseInsensitiveContains(query) }
        guard self == .title else { return matches }
        return matches.sorted {
            let order = $0.title.localizedStandardCompare($1.title)
            return order == .orderedSame ? $0.id < $1.id : order == .orderedAscending
        }
    }
}

private struct ShelfContinuation {
    let book: Book
    let detail: String
    let progress: CGFloat
}

private struct ShelfPreparationNotice {
    let title: String
    let detail: String
    let progress: CGFloat
    let failure: Bool
}

private struct ShelfEmptyState {
    let title: String
    let detail: String
    let actionTitle: String?
}

private struct ShelfPresentation {
    let title: String
    let sectionTitle: String
    let count: Int
    let continuation: ShelfContinuation?
    let preparation: ShelfPreparationNotice?
    let empty: ShelfEmptyState?
    let showsLibraryHeading: Bool
    let sortTitle: String
}

@MainActor
final class ShelfController: UICollectionViewController, UIDocumentPickerDelegate, UITextFieldDelegate {
    private let library: LibraryStore
    private let covers = BookCoverStore()
    private let searchField = UISearchTextField()
    private weak var visibleHeader: ShelfPageHeader?
    private var latestPresentation: ShelfPresentation?
    private var latestSortMenu: UIMenu?
    private var order = ShelfOrder.imported
    private var displayed: [Book] = []
    private var busy = false
    private var showingRemoved = false
    private var searchTask: Task<Void, Never>?
    private var preparationObserver: NSObjectProtocol?
    private var libraryObserver: NSObjectProtocol?

    init(library: LibraryStore) {
        self.library = library
        let layout = UICollectionViewCompositionalLayout { _, environment in
            let columns = environment.traitCollection.preferredContentSizeCategory.isAccessibilityCategory ? 1 : 2
            let width = (environment.container.effectiveContentSize.width - 48 - CGFloat(columns - 1) * 21) / CGFloat(columns)
            let item = NSCollectionLayoutItem(
                layoutSize: NSCollectionLayoutSize(widthDimension: .absolute(width), heightDimension: .estimated(270))
            )
            let group = NSCollectionLayoutGroup.horizontal(
                layoutSize: NSCollectionLayoutSize(widthDimension: .fractionalWidth(1), heightDimension: .estimated(270)),
                repeatingSubitem: item,
                count: columns
            )
            group.interItemSpacing = .fixed(21)
            let section = NSCollectionLayoutSection(group: group)
            section.interGroupSpacing = 22
            section.contentInsets = NSDirectionalEdgeInsets(top: 0, leading: 24, bottom: 32, trailing: 24)
            section.boundarySupplementaryItems = [
                NSCollectionLayoutBoundarySupplementaryItem(
                    layoutSize: NSCollectionLayoutSize(widthDimension: .fractionalWidth(1), heightDimension: .estimated(560)),
                    elementKind: UICollectionView.elementKindSectionHeader,
                    alignment: .top
                )
            ]
            return section
        }
        super.init(collectionViewLayout: layout)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    deinit {
        searchTask?.cancel()
        if let preparationObserver { NotificationCenter.default.removeObserver(preparationObserver) }
        if let libraryObserver { NotificationCenter.default.removeObserver(libraryObserver) }
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "书架"
        navigationController?.navigationBar.prefersLargeTitles = false
        navigationController?.setNavigationBarHidden(true, animated: false)

        view.backgroundColor = BookDesign.paper
        collectionView.accessibilityIdentifier = "library"
        collectionView.backgroundColor = BookDesign.paper
        collectionView.alwaysBounceVertical = true
        collectionView.keyboardDismissMode = .onDrag
        collectionView.register(ShelfBookCell.self, forCellWithReuseIdentifier: "shelf-book")
        collectionView.register(
            ShelfPageHeader.self,
            forSupplementaryViewOfKind: UICollectionView.elementKindSectionHeader,
            withReuseIdentifier: "shelf-header"
        )

        searchField.placeholder = "书名或作者"
        searchField.accessibilityIdentifier = "library-search"
        searchField.font = BookDesign.font(15, style: .body)
        searchField.textColor = BookDesign.ink
        searchField.backgroundColor = BookDesign.wash
        searchField.background = UIImage()
        searchField.layer.cornerRadius = 12
        searchField.clipsToBounds = true
        searchField.borderStyle = .none
        searchField.returnKeyType = .search
        searchField.clearButtonMode = .whileEditing
        searchField.delegate = self
        searchField.addTarget(self, action: #selector(searchChanged), for: .editingChanged)

        preparationObserver = NotificationCenter.default.addObserver(
            forName: BookPreparation.changed,
            object: library.preparation,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in self?.refresh() }
        }
        libraryObserver = NotificationCenter.default.addObserver(
            forName: LibraryStore.changed,
            object: library,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in self?.refresh() }
        }
        refresh()
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        navigationController?.setNavigationBarHidden(true, animated: false)
        refresh()
    }

    override func scrollViewWillBeginDragging(_ scrollView: UIScrollView) {
        searchField.resignFirstResponder()
    }

    func textFieldShouldReturn(_ textField: UITextField) -> Bool {
        searchTask?.cancel()
        textField.resignFirstResponder()
        refresh()
        return false
    }

    @objc private func searchChanged() {
        searchTask?.cancel()
        searchTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(180))
            guard !Task.isCancelled else { return }
            self?.refresh()
        }
    }

    private func continuationBook() -> Book? {
        let preferred = UserDefaults.standard.string(forKey: "last-read-" + library.root.path)
        return displayed.first(where: { $0.id == preferred }) ?? displayed.first(where: { $0.locatorJSON != nil })
    }

    private func refresh() {
        let query = searchField.text ?? ""
        let allBooks = library.books.filter { showingRemoved ? $0.removal != nil : $0.removal == nil }
        displayed = order.books(allBooks, matching: query)
        let preferred = UserDefaults.standard.string(forKey: "last-read-" + library.root.path)
        let removingSearch = !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        let continuing = showingRemoved || removingSearch
            ? nil
            : displayed.first(where: { $0.id == preferred }) ?? displayed.first(where: { $0.locatorJSON != nil })

        let continuation = continuing.map { book in
            let progress = readingProgress(book)
            let percent = Int((progress.total * 100).rounded())
            let location = progress.chapter ?? "继续上次阅读"
            return ShelfContinuation(
                book: book,
                detail: location + " · 已读 " + String(max(0, min(100, percent))) + "%",
                progress: CGFloat(max(0, min(1, progress.total)))
            )
        }

        let notice = preparationNotice()
        let baseIsEmpty = library.books.filter { $0.removal == nil }.isEmpty && !showingRemoved
        let sectionTitle = showingRemoved ? "已移除的书籍" : removingSearch ? "搜索结果" : "我的书籍"
        let empty: ShelfEmptyState?
        if baseIsEmpty && !removingSearch {
            empty = ShelfEmptyState(
                title: "从一本书开始",
                detail: "导入你的 EPUB，\n让阅读与理解一起发生。",
                actionTitle: "导入书籍"
            )
        } else if displayed.isEmpty && removingSearch {
            empty = ShelfEmptyState(
                title: "没有找到这本书",
                detail: "试试书名中的其他字，或作者名字。",
                actionTitle: nil
            )
        } else if displayed.isEmpty && showingRemoved {
            empty = ShelfEmptyState(
                title: "没有已移除的书籍",
                detail: "移除原书后，笔记与对话仍会保留在这里。",
                actionTitle: nil
            )
        } else {
            empty = nil
        }

        let presentation = ShelfPresentation(
            title: showingRemoved ? "已移除的书籍" : "书架",
            sectionTitle: sectionTitle,
            count: displayed.count,
            continuation: continuation,
            preparation: notice,
            empty: empty,
            showsLibraryHeading: !(baseIsEmpty && !removingSearch),
            sortTitle: order.rawValue
        )
        latestPresentation = presentation
        latestSortMenu = sortMenu()
        if let visibleHeader {
            configure(visibleHeader, with: presentation)
        }
        collectionView.reloadData()
    }

    private func readingProgress(_ book: Book) -> (chapter: String?, total: Double) {
        guard let json = book.locatorJSON,
              let locator = try? Locator(json: JSONValue(jsonString: json, warnings: nil), warnings: nil)
        else { return (nil, 0) }
        return (locator.title, locator.locations.totalProgression ?? locator.locations.progression ?? 0)
    }

    private func preparationNotice() -> ShelfPreparationNotice? {
        for book in displayed {
            guard let state = library.preparation.states[book.id] else { continue }
            if let failure = state.failure {
                return ShelfPreparationNotice(
                    title: "《\(book.title)》资料准备失败",
                    detail: failure + "；仍可阅读，可稍后重试。",
                    progress: 0,
                    failure: true
                )
            }
            if state.preparing || (state.total > 0 && !state.ready) {
                let progress = state.total > 0 ? CGFloat(state.completed) / CGFloat(state.total) : 0
                return ShelfPreparationNotice(
                    title: "正在准备《\(book.title)》的问答资料",
                    detail: "你可以先阅读，准备好后再提问。",
                    progress: max(0.08, min(1, progress)),
                    failure: false
                )
            }
        }
        return nil
    }

    private func sortMenu() -> UIMenu {
        let actions = ShelfOrder.allCases.map { choice in
            UIAction(title: choice.rawValue, state: order == choice ? .on : .off) { [weak self] _ in
                self?.order = choice
                self?.refresh()
            }
        }
        let removed = UIAction(
            title: showingRemoved ? "返回书架" : "已移除的书籍",
            image: BookDesign.symbol("archivebox", size: 15)
        ) { [weak self] _ in
            self?.showingRemoved.toggle()
            self?.refresh()
        }
        return UIMenu(title: "排序", children: actions + [removed])
    }

    override func collectionView(_ collectionView: UICollectionView, numberOfItemsInSection section: Int) -> Int {
        displayed.count
    }

    override func collectionView(
        _ collectionView: UICollectionView,
        cellForItemAt indexPath: IndexPath
    ) -> UICollectionViewCell {
        let book = displayed[indexPath.item]
        let cell = collectionView.dequeueReusableCell(withReuseIdentifier: "shelf-book", for: indexPath) as! ShelfBookCell
        let preparation = library.preparation.states[book.id]?.message ?? ""
        cell.configure(book, status: bookStatus(book), preparation: preparation)
        cell.coverTask = Task { [weak cell, covers, library] in
            let image = await covers.image(for: book, library: library)
            guard !Task.isCancelled else { return }
            cell?.setCover(image, for: book)
        }
        cell.accessibilityIdentifier = "book-\(book.id)"
        return cell
    }

    private func bookStatus(_ book: Book) -> ShelfBookStatus {
        if book.removal?.pending == true {
            return ShelfBookStatus(text: "移除尚未完成，点此重试", accent: false)
        }
        if book.removal == .removed {
            return ShelfBookStatus(text: "原书已移除，记录仍保留", accent: false)
        }
        guard book.locatorJSON != nil else {
            return ShelfBookStatus(text: "未开始", accent: false)
        }
        let percent = Int((readingProgress(book).total * 100).rounded())
        return ShelfBookStatus(text: "已读 " + String(max(0, min(100, percent))) + "%", accent: true)
    }

    override func collectionView(
        _ collectionView: UICollectionView,
        viewForSupplementaryElementOfKind kind: String,
        at indexPath: IndexPath
    ) -> UICollectionReusableView {
        let header = collectionView.dequeueReusableSupplementaryView(
            ofKind: kind,
            withReuseIdentifier: "shelf-header",
            for: indexPath
        ) as! ShelfPageHeader
        let wasFocused = searchField.isFirstResponder
        visibleHeader = header
        if let presentation = latestPresentation {
            configure(header, with: presentation)
        }
        if wasFocused {
            DispatchQueue.main.async { [weak self] in self?.searchField.becomeFirstResponder() }
        }
        return header
    }

    private func configure(_ header: ShelfPageHeader, with presentation: ShelfPresentation) {
        header.onImport = { [weak self] in self?.importFile() }
        header.onOpenContinuation = { [weak self] in
            guard let self, let book = self.continuationBook() else { return }
            self.openBook(book.id)
        }
        header.attachSearch(searchField)
        header.configure(presentation)
        if let latestSortMenu { header.setSortMenu(latestSortMenu) }
        header.coverTask?.cancel()
        if let book = presentation.continuation?.book {
            header.coverTask = Task { [weak header, covers, library] in
                let image = await covers.image(for: book, library: library)
                guard !Task.isCancelled else { return }
                header?.setContinuationCover(image, for: book)
            }
        }
    }

    override func collectionView(_ collectionView: UICollectionView, didSelectItemAt indexPath: IndexPath) {
        collectionView.deselectItem(at: indexPath, animated: true)
        guard !busy, displayed.indices.contains(indexPath.item) else { return }
        let book = displayed[indexPath.item]
        if let removal = book.removal {
            confirmRemoval(book.id, deleteRecords: removal != .removing)
        } else {
            openBook(book.id)
        }
    }

    private func openBook(_ id: String) {
        guard !busy, let book = library.books.first(where: { $0.id == id }) else { return }
        searchTask?.cancel()
        searchField.resignFirstResponder()
        busy = true
        Task {
            defer { busy = false }
            do {
                let publication = try await library.open(book)
                UserDefaults.standard.set(book.id, forKey: "last-read-" + library.root.path)
                let reader = try ReaderController(book: book, publication: publication, library: library)
                reader.modalPresentationStyle = .fullScreen
                present(reader, animated: true)
            } catch {
                message(title: "无法打开书籍", text: error.localizedDescription)
            }
        }
    }

    @objc private func importFile() {
        guard !busy else { return }
        let epub = UTType(filenameExtension: "epub") ?? UTType(importedAs: "org.idpf.epub-container")
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: [epub, .data], asCopy: true)
        picker.delegate = self
        picker.allowsMultipleSelection = false
        present(picker, animated: true)
    }

    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let url = urls.first else { return }
        busy = true
        Task {
            defer { busy = false }
            do {
                let result = try await library.importBook(from: url)
                showingRemoved = false
                refresh()
                message(
                    title: result.isDuplicate ? "书籍已在书架" : "已加入书架",
                    text: result.isDuplicate
                        ? "相同文件复用已有书籍、进度和记录；不同字节的同名文件按另一本书处理。"
                        : result.book.title
                )
            } catch {
                message(title: "导入失败", text: error.localizedDescription)
            }
        }
    }

    private func confirmRemoval(_ id: String, deleteRecords: Bool) {
        guard !busy, let book = library.books.first(where: { $0.id == id }) else { return }
        let title = deleteRecords ? "彻底删除这本书及记录？" : "移除原书？"
        let text = deleteRecords
            ? "将删除《\(book.title)》的原书、笔记、草稿、对话与引用记录，无法撤销。其他书籍不受影响。"
            : "保留笔记、草稿、对话与引用文字；正在进行的准备和回答将取消。重新导入相同文件后可返回原文并继续问答。"
        let alert = UIAlertController(title: title, message: text, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "取消", style: .cancel))
        alert.addAction(UIAlertAction(
            title: deleteRecords ? "确认彻底删除" : "移除原书，保留记录",
            style: deleteRecords ? .destructive : .default
        ) { [weak self] _ in
            self?.performRemoval(id, deleteRecords: deleteRecords)
        })
        present(alert, animated: true)
    }

    private func performRemoval(_ id: String, deleteRecords: Bool) {
        guard !busy else { return }
        busy = true
        Task {
            defer { busy = false; refresh() }
            do {
                try await library.removeBook(id, deleteRecords: deleteRecords)
            } catch {
                let alert = UIAlertController(
                    title: "移除尚未完成",
                    message: "\(error.localizedDescription) 已完成的清理不会撤销，请重试完成本次操作。",
                    preferredStyle: .alert
                )
                alert.addAction(UIAlertAction(title: "稍后重试", style: .cancel))
                alert.addAction(UIAlertAction(title: "重试", style: .default) { [weak self] _ in
                    self?.performRemoval(id, deleteRecords: deleteRecords)
                })
                present(alert, animated: true)
            }
        }
    }

    private func message(title: String, text: String) {
        let alert = UIAlertController(title: title, message: text, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "知道了", style: .default))
        present(alert, animated: true)
    }
}

private struct ShelfBookStatus {
    let text: String
    let accent: Bool
}

private final class ShelfBookCell: UICollectionViewCell {
    private let cover = BookCoverView()
    private let title = BookDesign.label(nil, size: 15, weight: .semibold, style: .subheadline)
    private let author = BookDesign.label(nil, size: 11, colour: BookDesign.secondary, style: .caption1)
    private let status = BookDesign.label(nil, size: 11, colour: BookDesign.accent, style: .caption1)
    private var represented: String?
    var coverTask: Task<Void, Never>?

    override init(frame: CGRect) {
        super.init(frame: frame)
        title.numberOfLines = 0
        author.numberOfLines = 0
        status.numberOfLines = 0
        let stack = UIStackView(arrangedSubviews: [cover, title, author, status])
        stack.axis = .vertical
        stack.spacing = 0
        stack.setCustomSpacing(11, after: cover)
        stack.setCustomSpacing(3, after: title)
        stack.setCustomSpacing(5, after: author)
        stack.translatesAutoresizingMaskIntoConstraints = false
        contentView.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: contentView.topAnchor),
            stack.leadingAnchor.constraint(equalTo: contentView.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: contentView.trailingAnchor),
            stack.bottomAnchor.constraint(equalTo: contentView.bottomAnchor),
            cover.heightAnchor.constraint(equalTo: cover.widthAnchor, multiplier: 1.4)
        ])
        isAccessibilityElement = true
        accessibilityTraits = .button
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    override func prepareForReuse() {
        super.prepareForReuse()
        coverTask?.cancel()
        represented = nil
    }

    func configure(_ book: Book, status value: ShelfBookStatus, preparation: String) {
        coverTask?.cancel()
        represented = book.id
        title.text = book.title
        author.text = book.author.isEmpty ? "作者未知" : book.author
        status.text = value.text
        status.textColor = value.accent ? BookDesign.accent : BookDesign.secondary
        cover.configure(book, image: nil)
        accessibilityLabel = [book.title, author.text ?? "", value.text].joined(separator: "，")
        accessibilityValue = preparation
    }

    func setCover(_ image: UIImage?, for book: Book) {
        guard represented == book.id else { return }
        cover.configure(book, image: image)
    }
}

private final class ShelfPageHeader: UICollectionReusableView {
    var onImport: (() -> Void)?
    var onOpenContinuation: (() -> Void)?
    var coverTask: Task<Void, Never>?

    private let searchHost = UIView()
    private let titleLabel = BookDesign.label("书架", size: 31, weight: .bold, style: .largeTitle)
    private let importButton = CircularIconButton(symbol: "plus", label: "导入")
    private let preparation = ShelfPreparationBanner()
    private let continueHeading = BookDesign.label("继续阅读", size: 18, weight: .semibold, style: .headline)
    private let continueCard = ShelfContinueCard()
    private let sectionLabel = BookDesign.label("我的书籍", size: 18, weight: .semibold, style: .headline)
    private let countLabel = BookDesign.label(nil, size: 12, colour: BookDesign.muted, style: .caption1)
    private let sortButton = UIButton(type: .system)
    private let libraryRow = UIStackView()
    private let emptyView = ShelfEmptyView()
    private let stack = UIStackView()

    override init(frame: CGRect) {
        super.init(frame: frame)
        accessibilityIdentifier = "shelf-header"

        titleLabel.accessibilityIdentifier = "page-title"
        importButton.addAction(UIAction { [weak self] _ in self?.onImport?() }, for: .touchUpInside)
        let headerRow = UIStackView(arrangedSubviews: [titleLabel, UIView(), importButton])
        headerRow.axis = .horizontal
        headerRow.alignment = .center
        headerRow.spacing = 12

        continueCard.addAction(UIAction { [weak self] _ in self?.onOpenContinuation?() }, for: .touchUpInside)
        continueCard.setContentHuggingPriority(.required, for: .vertical)
        continueCard.setContentCompressionResistancePriority(.required, for: .vertical)
        preparation.setContentHuggingPriority(.required, for: .vertical)
        countLabel.setContentHuggingPriority(.required, for: .horizontal)
        let sectionIdentity = UIStackView(arrangedSubviews: [sectionLabel, countLabel, UIView()])
        sectionIdentity.axis = .horizontal
        sectionIdentity.alignment = .center
        sectionIdentity.spacing = 5
        sortButton.accessibilityIdentifier = "library-sort"
        sortButton.accessibilityLabel = "排序"
        sortButton.showsMenuAsPrimaryAction = true
        sortButton.setContentHuggingPriority(.required, for: .horizontal)
        sortButton.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
        libraryRow.axis = .horizontal
        libraryRow.alignment = .center
        libraryRow.spacing = 8
        libraryRow.addArrangedSubview(sectionIdentity)
        libraryRow.addArrangedSubview(sortButton)

        emptyView.onAction = { [weak self] in self?.onImport?() }

        stack.axis = .vertical
        stack.spacing = 0
        stack.translatesAutoresizingMaskIntoConstraints = false
        for view in [
            BrandRow(),
            headerRow,
            searchHost,
            preparation,
            continueHeading,
            continueCard,
            libraryRow,
            emptyView
        ] as [UIView] {
            stack.addArrangedSubview(view)
        }
        stack.setCustomSpacing(13, after: headerRow)
        addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: topAnchor),
            stack.leadingAnchor.constraint(equalTo: leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: trailingAnchor),
            stack.bottomAnchor.constraint(equalTo: bottomAnchor)
        ])
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    override func preferredLayoutAttributesFitting(
        _ layoutAttributes: UICollectionViewLayoutAttributes
    ) -> UICollectionViewLayoutAttributes {
        let attributes = super.preferredLayoutAttributesFitting(layoutAttributes)
        let fitting = systemLayoutSizeFitting(
            CGSize(width: layoutAttributes.size.width, height: UIView.layoutFittingCompressedSize.height),
            withHorizontalFittingPriority: .required,
            verticalFittingPriority: .fittingSizeLevel
        )
        attributes.frame.size.height = ceil(fitting.height)
        return attributes
    }

    func attachSearch(_ field: UISearchTextField) {
        if field.superview !== searchHost {
            field.removeFromSuperview()
            field.translatesAutoresizingMaskIntoConstraints = false
            searchHost.addSubview(field)
            NSLayoutConstraint.activate([
                field.topAnchor.constraint(equalTo: searchHost.topAnchor),
                field.leadingAnchor.constraint(equalTo: searchHost.leadingAnchor),
                field.trailingAnchor.constraint(equalTo: searchHost.trailingAnchor),
                field.bottomAnchor.constraint(equalTo: searchHost.bottomAnchor),
                field.heightAnchor.constraint(greaterThanOrEqualToConstant: 44)
            ])
        }
    }

    func configure(_ presentation: ShelfPresentation) {
        titleLabel.text = presentation.title
        sectionLabel.text = presentation.sectionTitle
        countLabel.text = String(presentation.count)
        libraryRow.isHidden = !presentation.showsLibraryHeading

        continueHeading.isHidden = presentation.continuation == nil
        continueCard.isHidden = presentation.continuation == nil
        if let continuation = presentation.continuation {
            continueCard.configure(continuation)
            stack.setCustomSpacing(10, after: continueHeading)
        } else {
            continueCard.coverTask?.cancel()
        }

        preparation.isHidden = presentation.preparation == nil
        if let notice = presentation.preparation {
            preparation.configure(notice)
        }

        emptyView.isHidden = presentation.empty == nil
        if let empty = presentation.empty {
            emptyView.configure(empty)
        }

        updateSortButton(title: presentation.sortTitle)
        if preparation.isHidden {
            stack.setCustomSpacing(25, after: searchHost)
        } else {
            stack.setCustomSpacing(18, after: searchHost)
            stack.setCustomSpacing(22, after: preparation)
        }
        stack.setCustomSpacing(28, after: continueCard)
        stack.setCustomSpacing(40, after: libraryRow)
    }

    func setSortMenu(_ menu: UIMenu) {
        sortButton.menu = menu
    }

    func setContinuationCover(_ image: UIImage?, for book: Book) {
        continueCard.setCover(image, for: book)
    }

    private func updateSortButton(title: String) {
        var configuration = UIButton.Configuration.plain()
        configuration.title = title
        configuration.image = BookDesign.symbol("chevron.down", size: 11)
        configuration.imagePlacement = .trailing
        configuration.imagePadding = 4
        configuration.baseForegroundColor = BookDesign.secondary
        configuration.contentInsets = .zero
        configuration.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { incoming in
            var outgoing = incoming
            outgoing.font = BookDesign.font(12, style: .caption1)
            return outgoing
        }
        sortButton.configuration = configuration
    }
}

private final class ShelfContinueCard: UIControl {
    private let cover = BookCoverView()
    private let title = BookDesign.label(nil, size: 21, weight: .semibold, style: .title3)
    private let author = BookDesign.label(nil, size: 12, colour: BookDesign.secondary, style: .caption1)
    private let detail = BookDesign.label(nil, size: 12, colour: BookDesign.secondary, style: .caption1)
    private let progress = ShelfProgressView()
    private let arrow = UIView()
    private var represented: String?
    var coverTask: Task<Void, Never>?

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = BookDesign.wash
        layer.cornerRadius = 16
        isAccessibilityElement = true
        accessibilityTraits = .button
        accessibilityIdentifier = "continue-reading"
        heightAnchor.constraint(greaterThanOrEqualToConstant: 150).isActive = true

        cover.translatesAutoresizingMaskIntoConstraints = false
        addSubview(cover)

        title.numberOfLines = 0
        author.numberOfLines = 0
        detail.numberOfLines = 0
        let follow = BookDesign.label("接着读", size: 13, weight: .semibold, style: .subheadline)
        arrow.backgroundColor = BookDesign.ink
        arrow.layer.cornerRadius = 13.5
        let arrowImage = UIImageView(image: BookDesign.symbol("arrow.right", size: 15))
        arrowImage.tintColor = BookDesign.paper
        arrowImage.translatesAutoresizingMaskIntoConstraints = false
        arrow.addSubview(arrowImage)
        NSLayoutConstraint.activate([
            arrow.widthAnchor.constraint(equalToConstant: 27),
            arrow.heightAnchor.constraint(equalToConstant: 27),
            arrowImage.centerXAnchor.constraint(equalTo: arrow.centerXAnchor),
            arrowImage.centerYAnchor.constraint(equalTo: arrow.centerYAnchor),
            arrowImage.widthAnchor.constraint(equalToConstant: 15),
            arrowImage.heightAnchor.constraint(equalToConstant: 15)
        ])
        let foot = UIStackView(arrangedSubviews: [follow, UIView(), arrow])
        foot.axis = .horizontal
        foot.alignment = .center
        let meta = UIStackView(arrangedSubviews: [title, author, UIView(), detail, foot, progress])
        meta.axis = .vertical
        meta.spacing = 0
        meta.setCustomSpacing(4, after: title)
        meta.setCustomSpacing(8, after: detail)
        meta.setCustomSpacing(8, after: foot)
        meta.translatesAutoresizingMaskIntoConstraints = false
        addSubview(meta)

        NSLayoutConstraint.activate([
            cover.topAnchor.constraint(equalTo: topAnchor, constant: 17),
            cover.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 17),
            cover.widthAnchor.constraint(equalToConstant: 82),
            cover.heightAnchor.constraint(equalToConstant: 116),
            cover.bottomAnchor.constraint(lessThanOrEqualTo: bottomAnchor, constant: -17),
            meta.topAnchor.constraint(equalTo: topAnchor, constant: 19),
            meta.leadingAnchor.constraint(equalTo: cover.trailingAnchor, constant: 17),
            meta.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -17),
            meta.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -17),
            progress.heightAnchor.constraint(equalToConstant: 3)
        ])
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        isUserInteractionEnabled && !isHidden && alpha > 0.01 && self.point(inside: point, with: event)
            ? self
            : nil
    }

    func configure(_ continuation: ShelfContinuation) {
        coverTask?.cancel()
        represented = continuation.book.id
        title.text = continuation.book.title
        author.text = continuation.book.author.isEmpty ? "作者未知" : continuation.book.author
        detail.text = continuation.detail
        progress.value = continuation.progress
        cover.configure(continuation.book, image: nil, compact: true)
        accessibilityLabel = "继续阅读，" + continuation.book.title + "，" + continuation.detail
    }

    func setCover(_ image: UIImage?, for book: Book) {
        guard represented == book.id else { return }
        cover.configure(book, image: image, compact: true)
    }
}

private final class ShelfPreparationBanner: UIView {
    private let icon = UIImageView(image: BookDesign.symbol("file-text", size: 18))
    private let title = BookDesign.label(nil, size: 12, weight: .semibold, style: .caption1)
    private let detail = BookDesign.label(nil, size: 11, colour: BookDesign.secondary, style: .caption2)
    private let progress = ShelfProgressView()

    override init(frame: CGRect) {
        super.init(frame: frame)
        layer.cornerRadius = 12
        icon.tintColor = BookDesign.secondary
        icon.translatesAutoresizingMaskIntoConstraints = false
        let lines = UIStackView(arrangedSubviews: [title, detail, progress])
        lines.axis = .vertical
        lines.spacing = 4
        lines.translatesAutoresizingMaskIntoConstraints = false
        title.textAlignment = .left
        detail.textAlignment = .left
        progress.heightAnchor.constraint(equalToConstant: 3).isActive = true
        addSubview(icon)
        addSubview(lines)
        NSLayoutConstraint.activate([
            icon.topAnchor.constraint(equalTo: topAnchor, constant: 13),
            icon.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 14),
            icon.widthAnchor.constraint(equalToConstant: 18),
            icon.heightAnchor.constraint(equalToConstant: 18),
            lines.topAnchor.constraint(equalTo: topAnchor, constant: 12),
            lines.leadingAnchor.constraint(equalTo: icon.trailingAnchor, constant: 10),
            lines.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -14),
            lines.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -12)
        ])
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    func configure(_ notice: ShelfPreparationNotice) {
        backgroundColor = notice.failure ? BookDesign.errorWash : BookDesign.wash
        icon.tintColor = notice.failure ? BookDesign.error : BookDesign.secondary
        title.textColor = notice.failure ? BookDesign.error : BookDesign.ink
        title.text = notice.title
        detail.text = notice.detail
        progress.isHidden = notice.failure
        progress.value = notice.progress
    }
}

private final class ShelfEmptyView: UIView {
    private let icon = UIImageView(image: BookDesign.symbol("books.vertical", size: 44))
    private let title = BookDesign.label(nil, size: 24, weight: .regular, style: .title2)
    private let detail = BookDesign.label(nil, size: 13, colour: BookDesign.secondary, style: .subheadline)
    private let button = UIButton(type: .system)
    var onAction: (() -> Void)?

    override init(frame: CGRect) {
        super.init(frame: frame)
        accessibilityIdentifier = "shelf-empty"
        icon.tintColor = BookDesign.secondary
        icon.alpha = 0.55
        title.font = BookDesign.readingFont(24)
        detail.textAlignment = .center
        title.textAlignment = .center
        var configuration = UIButton.Configuration.plain()
        configuration.title = "导入书籍"
        configuration.image = BookDesign.symbol("plus", size: 16)
        configuration.imagePadding = 6
        configuration.baseForegroundColor = BookDesign.paper
        configuration.background.backgroundColor = BookDesign.ink
        configuration.background.cornerRadius = 13
        configuration.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { incoming in
            var outgoing = incoming
            outgoing.font = BookDesign.font(14, weight: .medium, style: .subheadline)
            return outgoing
        }
        button.configuration = configuration
        button.accessibilityLabel = "导入"
        button.accessibilityIdentifier = "shelf-empty-import"
        button.widthAnchor.constraint(equalToConstant: 176).isActive = true
        button.heightAnchor.constraint(equalToConstant: 46).isActive = true
        button.addAction(UIAction { [weak self] _ in self?.onAction?() }, for: .touchUpInside)

        let stack = UIStackView(arrangedSubviews: [icon, title, detail, button])
        stack.axis = .vertical
        stack.alignment = .center
        stack.spacing = 0
        stack.setCustomSpacing(22, after: icon)
        stack.setCustomSpacing(11, after: title)
        stack.setCustomSpacing(24, after: detail)
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: topAnchor, constant: 78),
            stack.leadingAnchor.constraint(greaterThanOrEqualTo: leadingAnchor, constant: 15),
            stack.trailingAnchor.constraint(lessThanOrEqualTo: trailingAnchor, constant: -15),
            stack.centerXAnchor.constraint(equalTo: centerXAnchor),
            stack.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -35)
        ])
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    func configure(_ state: ShelfEmptyState) {
        title.text = state.title
        detail.text = state.detail
        button.isHidden = state.actionTitle == nil
        if let action = state.actionTitle {
            button.configuration?.title = action
        }
    }
}

private final class ShelfProgressView: UIView {
    private let fill = UIView()
    var value: CGFloat = 0 {
        didSet { setNeedsLayout() }
    }

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = BookDesign.line
        layer.cornerRadius = 2
        clipsToBounds = true
        fill.backgroundColor = BookDesign.accent
        addSubview(fill)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    override func layoutSubviews() {
        super.layoutSubviews()
        fill.frame = CGRect(x: 0, y: 0, width: bounds.width * max(0, min(1, value)), height: bounds.height)
    }
}
