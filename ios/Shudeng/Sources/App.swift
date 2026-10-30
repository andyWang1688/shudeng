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
            window.rootViewController = makeApplicationTabs(library: library, root: root, secrets: secrets)
            // 轻量化：首屏渲染后再启动索引准备，避免启动时与首屏/封面渲染抢 CPU（准备过程不阻塞阅读）。
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                library.prepareBooks()
            }
        } catch {
            let controller = UIViewController()
            controller.view.backgroundColor = BookDesign.paper
            window.rootViewController = controller
            DispatchQueue.main.async {
                let alert = BookAlertController(title: "书架无法读取", message: "已有数据未被覆盖。请检查储存空间后重新打开应用。", preferredStyle: .alert)
                alert.addAction(BookAlertAction(title: "知道了", style: .default))
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

private func listHeaderConfiguration(_ text: String) -> UIListContentConfiguration {
    var content = UIListContentConfiguration.groupedHeader()
    content.text = text
    content.textProperties.font = BookType.caption
    content.textProperties.color = BookDesign.ink3
    content.textProperties.adjustsFontForContentSizeCategory = true
    return content
}

private func listFooterConfiguration(_ text: String) -> UIListContentConfiguration {
    var content = UIListContentConfiguration.groupedFooter()
    content.text = text
    content.textProperties.font = BookType.caption
    content.textProperties.color = BookDesign.ink3
    content.textProperties.adjustsFontForContentSizeCategory = true
    return content
}

private final class ProfileBrandIconView: UIImageView {
    override init(image: UIImage?) {
        super.init(image: image?.withRenderingMode(.alwaysTemplate))
        contentMode = .scaleAspectFit
        tintColor = BookDesign.lamp
        backgroundColor = BookDesign.lampWash
        layer.cornerRadius = 16
        layer.borderWidth = 1
        if #available(iOS 17.0, *) {
            registerForTraitChanges([UITraitUserInterfaceStyle.self]) { (self: ProfileBrandIconView, _) in
                self.updateDecoration()
            }
        }
        updateDecoration()
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        updateDecoration()
    }

    override func traitCollectionDidChange(_ previousTraitCollection: UITraitCollection?) {
        super.traitCollectionDidChange(previousTraitCollection)
        // iOS 17+ 由 registerForTraitChanges 负责，旧系统保留此回调。
        if #unavailable(iOS 17.0),
           previousTraitCollection?.userInterfaceStyle != traitCollection.userInterfaceStyle {
            updateDecoration()
        }
    }

    private func updateDecoration() {
        layer.borderColor = BookDesign.line.resolvedColor(with: traitCollection).cgColor
    }
}

final class ProfileController: UICollectionViewController {
    private enum Section: Int, CaseIterable { case settings, about }
    private let root: URL
    private let secrets: AISecrets
    private var serviceSummary = "尚未配置，阅读仍可使用"
    private var appearanceName = "跟随系统"

    init(root: URL, secrets: AISecrets = KeychainSecrets()) {
        self.root = root
        self.secrets = secrets
        super.init(collectionViewLayout: ProfileController.makeLayout())
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    private static func makeLayout() -> UICollectionViewCompositionalLayout {
        UICollectionViewCompositionalLayout { index, environment in
            var configuration = UICollectionLayoutListConfiguration(appearance: .insetGrouped)
            configuration.headerMode = .supplementary
            if Section(rawValue: index) == .about {
                configuration.footerMode = .supplementary
            }
            configuration.backgroundColor = BookDesign.paper
            configuration.separatorConfiguration.color = BookDesign.line
            return NSCollectionLayoutSection.list(using: configuration, layoutEnvironment: environment)
        }
    }

    @objc private func aiSettings() {
        navigationController?.pushViewController(AISettingsController(root: root, secrets: secrets), animated: true)
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "我的"
        view.backgroundColor = BookDesign.paper
        view.accessibilityIdentifier = "profile-surface"
        collectionView.backgroundColor = BookDesign.paper
        collectionView.accessibilityIdentifier = "profile-list"
        collectionView.contentInset = UIEdgeInsets(top: 0, left: 0, bottom: 24, right: 0)
        collectionView.register(UICollectionViewListCell.self, forCellWithReuseIdentifier: "profile-row")
        collectionView.register(
            UICollectionViewListCell.self,
            forSupplementaryViewOfKind: UICollectionView.elementKindSectionHeader,
            withReuseIdentifier: "profile-header"
        )
        collectionView.register(
            UICollectionViewListCell.self,
            forSupplementaryViewOfKind: UICollectionView.elementKindSectionFooter,
            withReuseIdentifier: "profile-footer"
        )
        reloadService()
        updateAppearanceRow()
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        navigationController?.setNavigationBarHidden(true, animated: false)
        reloadService()
        updateAppearanceRow()
        collectionView.reloadData()
    }

    private func reloadService() {
        do {
            let store = try AIConfigurationStore(root: root, secrets: secrets)
            if let current = store.configurations.first(where: { $0.id == store.selectedID }) {
                serviceSummary = current.name + " · " + current.model
            } else {
                serviceSummary = "尚未配置，阅读仍可使用"
            }
        } catch {
            serviceSummary = "服务配置暂时无法读取；已有配置未覆盖"
        }
    }

    private var version: String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.4.1"
    }

    private var selectedAppearance: UIUserInterfaceStyle {
        UIUserInterfaceStyle(
            rawValue: UserDefaults.standard.integer(forKey: "interface-style")
        ) ?? .unspecified
    }

    private func updateAppearanceRow() {
        switch selectedAppearance {
        case .light: appearanceName = "浅色"
        case .dark: appearanceName = "深色"
        default: appearanceName = "跟随系统"
        }
    }

    @objc private func showAppearance() {
        // 防止重复点按/重复回调叠出两层弹层。
        guard presentedViewController == nil else { return }
        let sheet = BookAlertController(
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
            sheet.addAction(BookAlertAction(title: prefix + name, style: .default) { [weak self] _ in
                self?.setAppearance(style)
            })
        }
        sheet.addAction(BookAlertAction(title: "取消", style: .cancel))
        present(sheet, animated: true)
    }

    func setAppearance(_ style: UIUserInterfaceStyle) {
        UserDefaults.standard.set(style.rawValue, forKey: "interface-style")
        view.window?.overrideUserInterfaceStyle = style
        updateAppearanceRow()
        collectionView.reloadData()
    }

    @objc private func showAbout() {
        navigationController?.pushViewController(AboutController(), animated: true)
    }

    override func numberOfSections(in collectionView: UICollectionView) -> Int {
        Section.allCases.count
    }

    override func collectionView(_ collectionView: UICollectionView, numberOfItemsInSection section: Int) -> Int {
        switch Section(rawValue: section) {
        case .settings: return 2
        default: return 1
        }
    }

    override func collectionView(
        _ collectionView: UICollectionView,
        viewForSupplementaryElementOfKind kind: String,
        at indexPath: IndexPath
    ) -> UICollectionReusableView {
        if kind == UICollectionView.elementKindSectionHeader {
            let header = collectionView.dequeueReusableSupplementaryView(
                ofKind: kind,
                withReuseIdentifier: "profile-header",
                for: indexPath
            ) as! UICollectionViewListCell
            header.contentConfiguration = listHeaderConfiguration(
                indexPath.section == Section.settings.rawValue ? "设置" : "关于"
            )
            return header
        }
        let footer = collectionView.dequeueReusableSupplementaryView(
            ofKind: kind,
            withReuseIdentifier: "profile-footer",
            for: indexPath
        ) as! UICollectionViewListCell
        footer.contentConfiguration = listFooterConfiguration(
            "书灯 " + version + " · 读得慢一点，也想得明白一点"
        )
        footer.accessibilityIdentifier = "profile-footer"
        return footer
    }

    override func collectionView(_ collectionView: UICollectionView, cellForItemAt indexPath: IndexPath) -> UICollectionViewCell {
        let cell = collectionView.dequeueReusableCell(withReuseIdentifier: "profile-row", for: indexPath) as! UICollectionViewListCell
        if indexPath.section == Section.settings.rawValue {
            if indexPath.item == 0 {
                var content = UIListContentConfiguration.subtitleCell()
                content.image = BookDesign.symbol("lightbulb", size: 18, weight: .medium)
                content.imageProperties.tintColor = BookDesign.lamp
                content.text = "AI 服务"
                content.textProperties.font = BookType.sans(15, weight: .medium, style: .body)
                content.textProperties.color = BookDesign.ink
                content.secondaryText = serviceSummary
                content.secondaryTextProperties.font = BookType.footnote
                content.secondaryTextProperties.color = BookDesign.ink3
                cell.contentConfiguration = content
                cell.accessories = [.disclosureIndicator()]
                cell.accessibilityIdentifier = "profile-ai-service"
                cell.accessibilityValue = serviceSummary
            } else {
                var content = UIListContentConfiguration.valueCell()
                content.image = BookDesign.symbol("sun.max", size: 18, weight: .medium)
                content.imageProperties.tintColor = BookDesign.ink2
                content.text = "外观"
                content.textProperties.font = BookType.sans(15, weight: .regular, style: .body)
                content.textProperties.color = BookDesign.ink
                content.secondaryText = appearanceName
                content.secondaryTextProperties.font = BookType.footnote
                content.secondaryTextProperties.color = BookDesign.ink3
                cell.contentConfiguration = content
                cell.accessories = [.disclosureIndicator()]
                cell.accessibilityIdentifier = "profile-appearance"
                cell.accessibilityValue = appearanceName
            }
        } else {
            var content = UIListContentConfiguration.valueCell()
            content.image = BookDesign.symbol("doc.text", size: 18, weight: .medium)
            content.imageProperties.tintColor = BookDesign.ink2
            content.text = "关于书灯"
            content.textProperties.font = BookType.sans(15, weight: .regular, style: .body)
            content.textProperties.color = BookDesign.ink
            content.secondaryText = version
            content.secondaryTextProperties.font = BookType.footnote
            content.secondaryTextProperties.color = BookDesign.ink3
            cell.contentConfiguration = content
            cell.accessories = [.disclosureIndicator()]
            cell.accessibilityIdentifier = "profile-about"
            cell.accessibilityValue = version
        }
        return cell
    }

    override func collectionView(_ collectionView: UICollectionView, didSelectItemAt indexPath: IndexPath) {
        collectionView.deselectItem(at: indexPath, animated: true)
        switch Section(rawValue: indexPath.section) {
        case .settings:
            if indexPath.item == 0 { aiSettings() } else { showAppearance() }
        case .about:
            showAbout()
        default:
            break
        }
    }
}

private final class AboutController: UICollectionViewController {
    private let rows: [(title: String, symbol: String, identifier: String)] = [
        ("隐私政策", "hand.raised", "about-privacy-policy"),
        ("第三方许可", "doc.text", "about-third-party")
    ]

    init() {
        super.init(collectionViewLayout: AboutController.makeLayout())
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    private static func makeLayout() -> UICollectionViewCompositionalLayout {
        UICollectionViewCompositionalLayout { index, environment in
            var configuration: UICollectionLayoutListConfiguration
            if index == 0 {
                configuration = UICollectionLayoutListConfiguration(appearance: .plain)
                configuration.showsSeparators = false
            } else {
                configuration = UICollectionLayoutListConfiguration(appearance: .insetGrouped)
            }
            configuration.backgroundColor = BookDesign.paper
            configuration.separatorConfiguration.color = BookDesign.line
            return NSCollectionLayoutSection.list(using: configuration, layoutEnvironment: environment)
        }
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "关于书灯"
        navigationItem.largeTitleDisplayMode = .never
        view.backgroundColor = BookDesign.paper
        view.accessibilityIdentifier = "about-surface"
        collectionView.backgroundColor = BookDesign.paper
        collectionView.accessibilityIdentifier = "about-list"
        collectionView.contentInset = UIEdgeInsets(top: 0, left: 0, bottom: 24, right: 0)
        collectionView.register(AboutBrandCell.self, forCellWithReuseIdentifier: "about-brand")
        collectionView.register(UICollectionViewListCell.self, forCellWithReuseIdentifier: "about-row")
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        navigationController?.setNavigationBarHidden(false, animated: false)
    }

    private var version: String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.4.1"
    }

    override func numberOfSections(in collectionView: UICollectionView) -> Int { 2 }

    override func collectionView(_ collectionView: UICollectionView, numberOfItemsInSection section: Int) -> Int {
        section == 0 ? 1 : rows.count
    }

    override func collectionView(_ collectionView: UICollectionView, cellForItemAt indexPath: IndexPath) -> UICollectionViewCell {
        if indexPath.section == 0 {
            let cell = collectionView.dequeueReusableCell(withReuseIdentifier: "about-brand", for: indexPath) as! AboutBrandCell
            cell.configure(version: version)
            return cell
        }
        let row = rows[indexPath.item]
        let cell = collectionView.dequeueReusableCell(withReuseIdentifier: "about-row", for: indexPath) as! UICollectionViewListCell
        var content = UIListContentConfiguration.cell()
        content.image = BookDesign.symbol(row.symbol, size: 18, weight: .medium)
        content.imageProperties.tintColor = BookDesign.ink2
        content.text = row.title
        content.textProperties.font = BookType.sans(15, weight: .regular, style: .body)
        content.textProperties.color = BookDesign.ink
        cell.contentConfiguration = content
        cell.accessories = [.disclosureIndicator()]
        cell.accessibilityIdentifier = row.identifier
        return cell
    }

    override func collectionView(_ collectionView: UICollectionView, didSelectItemAt indexPath: IndexPath) {
        collectionView.deselectItem(at: indexPath, animated: true)
        guard indexPath.section == 1 else { return }
        if rows[indexPath.item].identifier == "about-privacy-policy" {
            navigationController?.pushViewController(AIPrivacyController(), animated: true)
        } else {
            navigationController?.pushViewController(LicensesController(), animated: true)
        }
    }
}

/// 关于页品牌区：灯标 + 字标 + 副题 + 版本；作为列表首项，内容自适应。
private final class AboutBrandCell: UICollectionViewCell {
    private let icon = ProfileBrandIconView(image: BookDesign.brandMark)
    private let wordmark = BookDesign.label("书灯", font: BookType.serif(22, weight: .semibold, style: .title2))
    private let motto = BookDesign.label(
        "一盏照书的灯，AI 照亮你读不懂的地方",
        font: BookType.serif(12.5, weight: .regular, style: .footnote),
        colour: BookDesign.ink2
    )
    private let release = BookDesign.label(nil, font: BookType.caption, colour: BookDesign.ink3)

    override init(frame: CGRect) {
        super.init(frame: frame)
        icon.isAccessibilityElement = true
        icon.accessibilityLabel = "书灯图标"
        icon.accessibilityIdentifier = "about-brand-icon"
        icon.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            icon.widthAnchor.constraint(equalToConstant: 64),
            icon.heightAnchor.constraint(equalToConstant: 64)
        ])
        wordmark.textAlignment = .center
        wordmark.accessibilityIdentifier = "about-wordmark"
        motto.textAlignment = .center
        motto.numberOfLines = 0
        motto.accessibilityLabel = "一盏照书的灯，AI 照亮你读不懂的地方"
        motto.accessibilityIdentifier = "about-motto"
        release.textAlignment = .center
        release.accessibilityIdentifier = "about-version"
        let identity = UIStackView(arrangedSubviews: [icon, wordmark, motto, release])
        identity.axis = .vertical
        identity.alignment = .center
        identity.spacing = 12
        identity.isLayoutMarginsRelativeArrangement = true
        identity.layoutMargins = UIEdgeInsets(top: 20, left: 16, bottom: 20, right: 16)
        identity.translatesAutoresizingMaskIntoConstraints = false
        contentView.addSubview(identity)
        NSLayoutConstraint.activate([
            identity.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 6),
            identity.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: BookSpacing.screen),
            identity.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -BookSpacing.screen),
            identity.bottomAnchor.constraint(equalTo: contentView.bottomAnchor, constant: -20)
        ])
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    func configure(version: String) {
        release.text = "版本 " + version
    }

    override func preferredLayoutAttributesFitting(
        _ layoutAttributes: UICollectionViewLayoutAttributes
    ) -> UICollectionViewLayoutAttributes {
        let attributes = super.preferredLayoutAttributesFitting(layoutAttributes)
        let width = layoutAttributes.size.width > 0 ? layoutAttributes.size.width : contentView.bounds.width
        let fitting = contentView.systemLayoutSizeFitting(
            CGSize(width: width, height: UIView.layoutFittingCompressedSize.height),
            withHorizontalFittingPriority: .required,
            verticalFittingPriority: .fittingSizeLevel
        )
        attributes.frame.size.height = ceil(fitting.height)
        return attributes
    }
}

private final class LicensesController: UIViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        title = "第三方许可"
        navigationItem.largeTitleDisplayMode = .never
        view.backgroundColor = BookDesign.paper
        let text = UITextView()
        text.isEditable = false
        text.font = BookType.body
        text.adjustsFontForContentSizeCategory = true
        text.backgroundColor = BookDesign.paper
        text.textColor = BookDesign.ink
        text.textContainerInset = UIEdgeInsets(top: 16, left: 20, bottom: 28, right: 20)
        text.alwaysBounceVertical = true
        text.text = Bundle.main.url(forResource: "ThirdPartyNotices", withExtension: "txt")
            .flatMap { try? String(contentsOf: $0, encoding: .utf8) }
            ?? "许可文件无法读取"
        text.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(text)
        NSLayoutConstraint.activate([
            text.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            text.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            text.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            text.trailingAnchor.constraint(equalTo: view.trailingAnchor)
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

/// 扫描页确认卡的 continuation 保底：用户切 tab/弹卡失败/任务取消时也要 resume(false)，
/// 否则 `library.importBook` 会永远等待、书架 busy 卡死。
private final class ImportConfirmationGate: @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<Bool, Never>?
    private var resumed = false

    func install(_ continuation: CheckedContinuation<Bool, Never>) {
        lock.lock()
        if resumed {
            lock.unlock()
            continuation.resume(returning: false)
            return
        }
        self.continuation = continuation
        lock.unlock()
    }

    var hasResumed: Bool {
        lock.lock()
        defer { lock.unlock() }
        return resumed
    }

    func resume(_ value: Bool) {
        lock.lock()
        if resumed {
            lock.unlock()
            return
        }
        resumed = true
        let continuation = self.continuation
        self.continuation = nil
        lock.unlock()
        continuation?.resume(returning: value)
    }
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
final class ShelfController: UICollectionViewController, UIDocumentPickerDelegate, UISearchBarDelegate {
    private let library: LibraryStore
    private let covers = BookCoverStore()
    private var didPurgeCoverCache = false
    private let searchBar = UISearchBar()
    private weak var visibleHeader: ShelfPageHeader?
    private var latestPresentation: ShelfPresentation?
    private var latestSortMenu: UIMenu?
    private var order = ShelfOrder.imported
    private var displayed: [Book] = []
    private var busy = false
    private var showingRemoved = false
    private var searchTask: Task<Void, Never>?
    private var importTask: Task<Void, Never>?
    private var pdfProgressView: PDFImportProgressView?
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
        importTask?.cancel()
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

        searchBar.searchBarStyle = .minimal
        searchBar.placeholder = "书名或作者"
        // 空闲态只保留放大镜+输入框；取消按钮在开始编辑时才出现（避免被误认为搜索按钮）。
        searchBar.showsCancelButton = false
        searchBar.tintColor = BookDesign.lampInk
        searchBar.searchTextField.accessibilityIdentifier = "library-search"
        searchBar.delegate = self

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
        if !didPurgeCoverCache {
            didPurgeCoverCache = true
            // 延迟到 recoverRemovals/prepareBooks 完成后清理孤儿封面（覆盖启动时续删的书籍）。
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in
                guard let self else { return }
                self.covers.purgeOrphanedCovers(keeping: Set(self.library.books.filter { $0.removal == nil }.map(\.id)))
            }
        }
    }

    override func scrollViewWillBeginDragging(_ scrollView: UIScrollView) {
        searchBar.resignFirstResponder()
    }

    func searchBarTextDidBeginEditing(_ searchBar: UISearchBar) {
        searchBar.setShowsCancelButton(true, animated: true)
    }

    func searchBarTextDidEndEditing(_ searchBar: UISearchBar) {
        searchBar.setShowsCancelButton(false, animated: true)
    }

    func searchBarSearchButtonClicked(_ searchBar: UISearchBar) {
        searchTask?.cancel()
        searchBar.resignFirstResponder()
        refresh()
    }

    func searchBarCancelButtonClicked(_ searchBar: UISearchBar) {
        searchTask?.cancel()
        searchBar.text = ""
        searchBar.resignFirstResponder()
        refresh()
    }

    func searchBar(_ searchBar: UISearchBar, textDidChange searchText: String) {
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
        let query = searchBar.text ?? ""
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
            let shortLocation = location.components(separatedBy: " · ").first ?? location
            return ShelfContinuation(
                book: book,
                detail: shortLocation + " · " + String(max(0, min(100, percent))) + "%",
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
                detail: "导入你的 EPUB 或 PDF，\n让阅读与理解一起发生。",
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
        let wasFocused = searchBar.searchTextField.isFirstResponder
        visibleHeader = header
        if let presentation = latestPresentation {
            configure(header, with: presentation)
        }
        if wasFocused {
            DispatchQueue.main.async { [weak self] in self?.searchBar.becomeFirstResponder() }
        }
        return header
    }

    private func configure(_ header: ShelfPageHeader, with presentation: ShelfPresentation) {
        header.onImport = { [weak self] in self?.importFile() }
        header.onOpenContinuation = { [weak self] in
            guard let self, let book = self.continuationBook() else { return }
            self.openBook(book.id)
        }
        header.attachSearch(searchBar)
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
        searchBar.resignFirstResponder()
        busy = true
        let openBookStart = CFAbsoluteTimeGetCurrent()
        Task {
            defer { busy = false }
            do {
                let reader: UIViewController
                if book.resolvedFormat == .pdf {
                    // PDF Spike：正文由系统 PDFKit 渲染；EPUB 仍走 Readium。
                    reader = try PDFReaderController(book: book, library: library)
                    NSLog("PDF_OPEN_TIMING shelf.readerCreated %.1fms", (CFAbsoluteTimeGetCurrent() - openBookStart) * 1000)
                } else {
                    let publication = try await library.open(book)
                    reader = try ReaderController(book: book, publication: publication, library: library)
                }
                UserDefaults.standard.set(book.id, forKey: "last-read-" + library.root.path)
                reader.modalPresentationStyle = .fullScreen
                present(reader, animated: true)
                NSLog("PDF_OPEN_TIMING shelf.presented(since tap) %.1fms", (CFAbsoluteTimeGetCurrent() - openBookStart) * 1000)
            } catch {
                message(title: "无法打开书籍", text: error.localizedDescription)
            }
        }
    }

    @objc private func importFile() {
        guard !busy else { return }
        let epub = UTType(filenameExtension: "epub") ?? UTType(importedAs: "org.idpf.epub-container")
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: [epub, .pdf, .data], asCopy: true)
        picker.delegate = self
        picker.allowsMultipleSelection = false
        present(picker, animated: true)
    }

    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let url = urls.first, !busy else { return }
        busy = true
        rootTabsController?.setTabInteractionEnabled(false)
        let isPDF = url.pathExtension.lowercased() == "pdf"
        if isPDF { showPDFImportProgress() }
        importTask = Task { [weak self] in
            guard let self else { return }
            defer {
                hidePDFImportProgress()
                busy = false
                importTask = nil
                rootTabsController?.setTabInteractionEnabled(true)
            }
            do {
                let result = try await library.importBook(
                    from: url,
                    pdfProgress: { progress in
                        self.pdfProgressView?.update(completed: progress.completed, total: progress.total)
                    },
                    confirmPDFInfo: { info in
                        self.hidePDFImportProgress()
                        return await self.confirmScannedPDF(info)
                    }
                )
                hidePDFImportProgress()
                showingRemoved = false
                refresh()
                message(
                    title: result.isDuplicate ? "书籍已在书架" : "已加入书架",
                    text: result.isDuplicate
                        ? "相同文件复用已有书籍、进度和记录；不同字节的同名文件按另一本书处理。"
                        : result.book.title
                )
            } catch is CancellationError {
                // 用户取消检查/取消继续导入：静默回到书架，不写目录。
            } catch {
                hidePDFImportProgress()
                handleImportFailure(error, isPDF: isPDF)
            }
        }
    }

    // MARK: PDF 导入检查（进度 + 扫描页提示卡）

    /// 底部 tab（RootTabController 挂在 window 根上）；导入期间禁用，避免切换后确认流程失联。
    private var rootTabsController: RootTabController? {
        view.window?.rootViewController as? RootTabController
    }

    /// 从 window 顶层 present 确认卡；不用仅属于书架栈的导航控制器，切 tab 后也不会失效。
    private var topMostPresenter: UIViewController? {
        var top = view.window?.rootViewController
        while let presented = top?.presentedViewController { top = presented }
        return top
    }

    private func showPDFImportProgress() {
        guard pdfProgressView == nil else { return }
        let overlay = PDFImportProgressView()
        overlay.onCancel = { [weak self] in
            self?.importTask?.cancel()
            self?.hidePDFImportProgress()
        }
        // 遮罩挂到 window 顶层，导入中切 tab/滚动书架都不会带走它。
        overlay.show(in: view.window ?? navigationController?.view ?? view)
        pdfProgressView = overlay
    }

    private func hidePDFImportProgress() {
        pdfProgressView?.hide()
        pdfProgressView = nil
    }

    /// 只有检查出扫描页才弹提示卡（文字页 PDF 静默导入）。
    /// 从 window 顶层 present；确认卡失败/任务取消时都要 resume(false)，避免导入任务永久等待。
    private func confirmScannedPDF(_ info: PDFInfo) async -> Bool {
        let gate = ImportConfirmationGate()
        return await withTaskCancellationHandler {
            await withCheckedContinuation { continuation in
                gate.install(continuation)
                presentScannedConfirmation(info) { accepted in
                    gate.resume(accepted)
                }
            }
        } onCancel: {
            gate.resume(false)
        }
    }

    /// 选完文件后 document picker 可能还在 dismiss 动画中：等顶层 presenter 就位再弹卡（最多约 1s）。
    private func presentScannedConfirmation(
        _ info: PDFInfo,
        attempts: Int = 0,
        completion: @escaping @MainActor (Bool) -> Void
    ) {
        guard let presenter = topMostPresenter, presenter.presentedViewController == nil else {
            guard attempts < 10 else {
                completion(false)
                return
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { [weak self] in
                Task { @MainActor in
                    self?.presentScannedConfirmation(info, attempts: attempts + 1, completion: completion)
                }
            }
            return
        }
        let alert = BookAlertController(
            title: info.scannedPagesTitle,
            message: info.scannedPagesMessage,
            preferredStyle: .alert
        )
        alert.addAction(BookAlertAction(title: "取消", style: .cancel) { _ in
            completion(false)
        })
        alert.addAction(BookAlertAction(title: "继续导入", style: .default) { _ in
            completion(true)
        })
        presenter.present(alert, animated: true) { [weak alert, weak presenter] in
            // 弹卡未真正进入窗口（例如被其他 present 抢占）：保底取消导入，恢复书架可用。
            if alert?.view.window == nil {
                presenter?.presentedViewController?.dismiss(animated: false)
                completion(false)
            }
        }
    }

    private func handleImportFailure(_ error: Error, isPDF: Bool) {
        if isPDF, let libraryError = error as? LibraryError {
            switch libraryError {
            case .unsupported:
                message(title: "这份 PDF 打不开", text: "这个文件需要密码才能打开，目前还不能导入。")
                return
            case .invalid:
                message(title: "这个文件读不出来", text: "文件可能已损坏，未能加入书架。")
                return
            default:
                break
            }
        }
        message(title: "导入失败", text: error.localizedDescription)
    }

    private func confirmRemoval(_ id: String, deleteRecords: Bool) {
        guard !busy, let book = library.books.first(where: { $0.id == id }) else { return }
        let title = deleteRecords ? "彻底删除这本书及记录？" : "移除原书？"
        let text = deleteRecords
            ? "将删除《\(book.title)》的原书、笔记、草稿、对话与引用记录，无法撤销。其他书籍不受影响。"
            : "保留笔记、草稿、对话与引用文字；正在进行的准备和回答将取消。重新导入相同文件后可返回原文并继续问答。"
        let alert = BookAlertController(title: title, message: text, preferredStyle: .alert)
        alert.addAction(BookAlertAction(title: "取消", style: .cancel))
        alert.addAction(BookAlertAction(
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
                covers.removeCover(forBookID: id)
            } catch {
                let alert = BookAlertController(
                    title: "移除尚未完成",
                    message: "\(error.localizedDescription) 已完成的清理不会撤销，请重试完成本次操作。",
                    preferredStyle: .alert
                )
                alert.addAction(BookAlertAction(title: "稍后重试", style: .cancel))
                alert.addAction(BookAlertAction(title: "重试", style: .default) { [weak self] _ in
                    self?.performRemoval(id, deleteRecords: deleteRecords)
                })
                present(alert, animated: true)
            }
        }
    }

    private func message(title: String, text: String) {
        let alert = BookAlertController(title: title, message: text, preferredStyle: .alert)
        alert.addAction(BookAlertAction(title: "知道了", style: .default))
        present(alert, animated: true)
    }
}

private struct ShelfBookStatus {
    let text: String
    let accent: Bool
}

private final class ShelfBookCell: UICollectionViewCell {
    private let cover = BookCoverView()
    private let title = BookDesign.label(nil, font: BookType.serif(14, weight: .semibold, style: .subheadline))
    private let author = BookDesign.label(nil, font: BookType.caption, colour: BookDesign.ink3)
    private let status = BookDesign.label(nil, font: BookType.caption, colour: BookDesign.ink3)
    private var represented: String?
    var coverTask: Task<Void, Never>?

    override init(frame: CGRect) {
        super.init(frame: frame)
        title.numberOfLines = 2
        author.numberOfLines = 1
        status.numberOfLines = 1
        let stack = UIStackView(arrangedSubviews: [cover, title, author, status])
        stack.axis = .vertical
        stack.spacing = 0
        stack.setCustomSpacing(8, after: cover)
        stack.setCustomSpacing(2, after: title)
        stack.setCustomSpacing(3, after: author)
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
        status.textColor = value.accent ? BookDesign.lampInk : BookDesign.ink3
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
    private let titleLabel = BookDesign.label("书架", font: BookType.display)
    private let importButton = CircularIconButton(symbol: "plus", label: "导入", style: .solid)
    private let preparation = ShelfPreparationBanner()
    private let continueCard = ShelfContinueCard()
    private let sectionLabel = BookDesign.label("我的书籍", font: BookType.headline)
    private let countLabel = BookDesign.label(nil, font: BookType.caption, colour: BookDesign.ink3)
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
        headerRow.spacing = 6

        continueCard.addAction(UIAction { [weak self] _ in self?.onOpenContinuation?() }, for: .touchUpInside)
        continueCard.setContentHuggingPriority(.required, for: .vertical)
        continueCard.setContentCompressionResistancePriority(.required, for: .vertical)
        preparation.setContentHuggingPriority(.required, for: .vertical)
        countLabel.setContentHuggingPriority(.required, for: .horizontal)
        let sectionIdentity = UIStackView(arrangedSubviews: [sectionLabel, countLabel, UIView()])
        sectionIdentity.axis = .horizontal
        sectionIdentity.alignment = .firstBaseline
        sectionIdentity.spacing = 6
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
            headerRow,
            searchHost,
            preparation,
            continueCard,
            libraryRow,
            emptyView
        ] as [UIView] {
            stack.addArrangedSubview(view)
        }
        stack.setCustomSpacing(12, after: headerRow)
        addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: topAnchor, constant: 6),
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

    func attachSearch(_ bar: UISearchBar) {
        if bar.superview !== searchHost {
            bar.removeFromSuperview()
            bar.translatesAutoresizingMaskIntoConstraints = false
            searchHost.addSubview(bar)
            NSLayoutConstraint.activate([
                bar.topAnchor.constraint(equalTo: searchHost.topAnchor),
                bar.leadingAnchor.constraint(equalTo: searchHost.leadingAnchor),
                bar.trailingAnchor.constraint(equalTo: searchHost.trailingAnchor),
                bar.bottomAnchor.constraint(equalTo: searchHost.bottomAnchor)
            ])
        }
    }

    func configure(_ presentation: ShelfPresentation) {
        titleLabel.text = presentation.title
        sectionLabel.text = presentation.sectionTitle
        countLabel.text = String(presentation.count)
        libraryRow.isHidden = !presentation.showsLibraryHeading

        continueCard.isHidden = presentation.continuation == nil
        if let continuation = presentation.continuation {
            continueCard.configure(continuation)
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
            stack.setCustomSpacing(16, after: searchHost)
        } else {
            stack.setCustomSpacing(16, after: searchHost)
            stack.setCustomSpacing(18, after: preparation)
        }
        stack.setCustomSpacing(24, after: continueCard)
        stack.setCustomSpacing(24, after: libraryRow)
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
        configuration.image = BookDesign.symbol("chevron.down", size: 10, weight: .medium)
        configuration.imagePlacement = .trailing
        configuration.imagePadding = 3
        configuration.baseForegroundColor = BookDesign.ink2
        configuration.contentInsets = .zero
        configuration.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { incoming in
            var outgoing = incoming
            outgoing.font = BookType.footnote
            return outgoing
        }
        sortButton.configuration = configuration
    }
}

private final class ShelfContinueCard: UIControl {
    private let cover = BookCoverView()
    private let eyebrow = BookDesign.label("继续阅读", font: BookType.caption, colour: BookDesign.lampInk)
    private let title = BookDesign.label(nil, font: BookType.title)
    private let author = BookDesign.label(nil, font: BookType.footnote, colour: BookDesign.ink3)
    private let detail = BookDesign.label(nil, font: BookType.caption, colour: BookDesign.ink3)
    private let progress = ShelfProgressView()
    private let follow = BookDesign.label("接着读", font: BookType.subhead, colour: BookDesign.lampInk)
    private let arrowImage = UIImageView(image: BookDesign.symbol("arrow.right", size: 12, weight: .semibold))
    private var represented: String?
    var coverTask: Task<Void, Never>?

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = BookDesign.paperDeep
        layer.cornerRadius = BookRadius.card
        isAccessibilityElement = true
        accessibilityTraits = .button
        accessibilityIdentifier = "continue-reading"
        heightAnchor.constraint(greaterThanOrEqualToConstant: 114).isActive = true

        cover.translatesAutoresizingMaskIntoConstraints = false
        addSubview(cover)

        eyebrow.accessibilityIdentifier = "continue-eyebrow"
        title.numberOfLines = 1
        title.lineBreakMode = .byTruncatingTail
        author.numberOfLines = 1
        detail.textAlignment = .right
        detail.numberOfLines = 1
        detail.lineBreakMode = .byTruncatingTail
        detail.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        follow.isUserInteractionEnabled = false

        arrowImage.tintColor = BookDesign.lampInk
        arrowImage.contentMode = .scaleAspectFit
        let followRow = UIStackView(arrangedSubviews: [follow, arrowImage, UIView(), detail])
        followRow.axis = .horizontal
        followRow.alignment = .center
        followRow.spacing = 3

        let meta = UIStackView(arrangedSubviews: [eyebrow, title, author, UIView(), progress, followRow])
        meta.axis = .vertical
        meta.spacing = 0
        meta.setCustomSpacing(5, after: eyebrow)
        meta.setCustomSpacing(2, after: title)
        meta.setCustomSpacing(8, after: followRow)
        meta.translatesAutoresizingMaskIntoConstraints = false
        addSubview(meta)

        NSLayoutConstraint.activate([
            cover.topAnchor.constraint(equalTo: topAnchor, constant: 12),
            cover.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 12),
            cover.widthAnchor.constraint(equalToConstant: 64),
            cover.heightAnchor.constraint(equalToConstant: 90),
            cover.bottomAnchor.constraint(lessThanOrEqualTo: bottomAnchor, constant: -12),
            meta.topAnchor.constraint(equalTo: topAnchor, constant: 13),
            meta.leadingAnchor.constraint(equalTo: cover.trailingAnchor, constant: 12),
            meta.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -12),
            meta.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -12),
            progress.heightAnchor.constraint(equalToConstant: 2),
            arrowImage.widthAnchor.constraint(equalToConstant: 12),
            arrowImage.heightAnchor.constraint(equalToConstant: 12)
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
    private let title = BookDesign.label(nil, font: BookType.footnote, colour: BookDesign.ink)
    private let detail = BookDesign.label(nil, font: BookType.caption, colour: BookDesign.ink3)
    private let progress = ShelfProgressView()

    override init(frame: CGRect) {
        super.init(frame: frame)
        layer.cornerRadius = BookRadius.field
        icon.tintColor = BookDesign.ink3
        icon.translatesAutoresizingMaskIntoConstraints = false
        let lines = UIStackView(arrangedSubviews: [title, detail, progress])
        lines.axis = .vertical
        lines.spacing = 4
        lines.translatesAutoresizingMaskIntoConstraints = false
        title.textAlignment = .left
        detail.textAlignment = .left
        progress.label = "正在准备问答资料"
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
    private let icon = UIImageView(image: BookDesign.brandMark)
    private let title = BookDesign.label(nil, font: BookType.serif(24, weight: .semibold, style: .title2))
    private let detail = BookDesign.label(nil, font: BookType.subhead, colour: BookDesign.ink2)
    private let button = UIButton(type: .system)
    var onAction: (() -> Void)?

    override init(frame: CGRect) {
        super.init(frame: frame)
        accessibilityIdentifier = "shelf-empty"
        icon.tintColor = BookDesign.lamp
        icon.contentMode = .scaleAspectFit
        icon.widthAnchor.constraint(equalToConstant: 44).isActive = true
        icon.heightAnchor.constraint(equalToConstant: 44).isActive = true
        detail.textAlignment = .center
        title.textAlignment = .center
        detail.numberOfLines = 0
        var configuration = UIButton.Configuration.filled()
        configuration.title = "导入书籍"
        configuration.image = BookDesign.symbol("plus", size: 15, weight: .semibold)
        configuration.imagePadding = 6
        configuration.baseForegroundColor = BookDesign.paper
        configuration.baseBackgroundColor = BookDesign.ink
        configuration.background.cornerRadius = 12
        configuration.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { incoming in
            var outgoing = incoming
            outgoing.font = BookType.sans(14, weight: .medium, style: .subheadline)
            return outgoing
        }
        button.configuration = configuration
        button.accessibilityLabel = "导入"
        button.accessibilityIdentifier = "shelf-empty-import"
        button.widthAnchor.constraint(equalToConstant: 168).isActive = true
        button.heightAnchor.constraint(equalToConstant: 44).isActive = true
        button.addAction(UIAction { [weak self] _ in self?.onAction?() }, for: .touchUpInside)

        let stack = UIStackView(arrangedSubviews: [icon, title, detail, button])
        stack.axis = .vertical
        stack.alignment = .center
        stack.spacing = 0
        stack.setCustomSpacing(20, after: icon)
        stack.setCustomSpacing(10, after: title)
        stack.setCustomSpacing(24, after: detail)
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: topAnchor, constant: 64),
            stack.leadingAnchor.constraint(greaterThanOrEqualTo: leadingAnchor, constant: 15),
            stack.trailingAnchor.constraint(lessThanOrEqualTo: trailingAnchor, constant: -15),
            stack.centerXAnchor.constraint(equalTo: centerXAnchor),
            stack.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -32)
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

/// 阅读/准备进度：系统 UIProgressView 承载绘制，2–3pt 高度由调用方约束。
private final class ShelfProgressView: UIView {
    private let bar = UIProgressView(progressViewStyle: .default)
    /// VoiceOver 的进度上下文，例如「已读」「正在准备问答资料」。
    var label = "已读" {
        didSet { updateAccessibilityValue() }
    }
    var value: CGFloat = 0 {
        didSet {
            bar.progress = Float(max(0, min(1, value)))
            updateAccessibilityValue()
        }
    }

    override init(frame: CGRect) {
        super.init(frame: frame)
        isAccessibilityElement = true
        bar.isUserInteractionEnabled = false
        bar.progressTintColor = BookDesign.lamp
        bar.trackTintColor = BookDesign.line
        bar.translatesAutoresizingMaskIntoConstraints = false
        addSubview(bar)
        NSLayoutConstraint.activate([
            bar.topAnchor.constraint(equalTo: topAnchor),
            bar.leadingAnchor.constraint(equalTo: leadingAnchor),
            bar.trailingAnchor.constraint(equalTo: trailingAnchor),
            bar.bottomAnchor.constraint(equalTo: bottomAnchor)
        ])
        updateAccessibilityValue()
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    private func updateAccessibilityValue() {
        let percent = Int((max(0, min(1, value)) * 100).rounded())
        accessibilityValue = label + " " + String(percent) + "%"
    }
}

/// PDF 导入检查遮罩：纸白卡片显示「正在检查这份 PDF…（X/Y）」并可取消。
/// 只覆盖书架页面；检查在后台执行，取消会终止检查并丢弃暂存文件（不写目录）。
private final class PDFImportProgressView: UIView {
    var onCancel: (() -> Void)?

    private let dim = UIView()
    private let card = UIView()
    private let titleLabel = BookDesign.label("正在检查这份 PDF…", font: BookType.sans(15, weight: .medium, style: .subheadline))
    private let progressBar = UIProgressView(progressViewStyle: .default)
    private let cancelButton = UIButton(type: .system)

    override init(frame: CGRect) {
        super.init(frame: frame)
        accessibilityIdentifier = "pdf-import-progress"
        accessibilityViewIsModal = true
        dim.backgroundColor = UIColor.black.withAlphaComponent(0.24)
        dim.translatesAutoresizingMaskIntoConstraints = false
        addSubview(dim)

        card.backgroundColor = BookDesign.paper
        card.layer.cornerRadius = BookRadius.sheet
        card.layer.cornerCurve = .continuous
        BookElevation.floating(card)
        card.translatesAutoresizingMaskIntoConstraints = false
        card.accessibilityIdentifier = "pdf-import-progress-card"
        addSubview(card)

        titleLabel.textAlignment = .center
        titleLabel.accessibilityIdentifier = "pdf-import-progress-label"
        progressBar.progressTintColor = BookDesign.lamp
        progressBar.trackTintColor = BookDesign.line
        progressBar.accessibilityIdentifier = "pdf-import-progress-bar"

        var configuration = UIButton.Configuration.plain()
        configuration.title = "取消"
        configuration.baseForegroundColor = BookDesign.ink2
        configuration.background.backgroundColor = BookDesign.paperDeep
        configuration.background.cornerRadius = 12
        configuration.contentInsets = NSDirectionalEdgeInsets(top: 10, leading: 16, bottom: 10, trailing: 16)
        configuration.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { incoming in
            var outgoing = incoming
            outgoing.font = BookType.sans(14, weight: .medium, style: .subheadline)
            return outgoing
        }
        cancelButton.configuration = configuration
        cancelButton.accessibilityIdentifier = "pdf-import-cancel"
        cancelButton.addAction(UIAction { [weak self] _ in
            guard let self else { return }
            self.cancelButton.isEnabled = false
            self.onCancel?()
        }, for: .touchUpInside)

        for child in [titleLabel, progressBar, cancelButton] as [UIView] {
            child.translatesAutoresizingMaskIntoConstraints = false
            card.addSubview(child)
        }
        NSLayoutConstraint.activate([
            dim.topAnchor.constraint(equalTo: topAnchor),
            dim.bottomAnchor.constraint(equalTo: bottomAnchor),
            dim.leadingAnchor.constraint(equalTo: leadingAnchor),
            dim.trailingAnchor.constraint(equalTo: trailingAnchor),
            card.centerXAnchor.constraint(equalTo: centerXAnchor),
            card.centerYAnchor.constraint(equalTo: centerYAnchor),
            card.leadingAnchor.constraint(greaterThanOrEqualTo: leadingAnchor, constant: 24),
            card.trailingAnchor.constraint(lessThanOrEqualTo: trailingAnchor, constant: -24),
            card.widthAnchor.constraint(lessThanOrEqualToConstant: 320),
            titleLabel.topAnchor.constraint(equalTo: card.topAnchor, constant: 22),
            titleLabel.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 20),
            titleLabel.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -20),
            progressBar.topAnchor.constraint(equalTo: titleLabel.bottomAnchor, constant: 16),
            progressBar.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 20),
            progressBar.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -20),
            cancelButton.topAnchor.constraint(equalTo: progressBar.bottomAnchor, constant: 20),
            cancelButton.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 20),
            cancelButton.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -20),
            cancelButton.heightAnchor.constraint(greaterThanOrEqualToConstant: 44),
            cancelButton.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -20)
        ])
        let preferred = card.widthAnchor.constraint(equalToConstant: 300)
        preferred.priority = .defaultHigh
        preferred.isActive = true
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    func show(in host: UIView) {
        translatesAutoresizingMaskIntoConstraints = false
        host.addSubview(self)
        NSLayoutConstraint.activate([
            topAnchor.constraint(equalTo: host.topAnchor),
            bottomAnchor.constraint(equalTo: host.bottomAnchor),
            leadingAnchor.constraint(equalTo: host.leadingAnchor),
            trailingAnchor.constraint(equalTo: host.trailingAnchor)
        ])
        alpha = 0
        UIView.animate(withDuration: UIAccessibility.isReduceMotionEnabled ? 0 : 0.18) {
            self.alpha = 1
        }
    }

    func update(completed: Int, total: Int) {
        titleLabel.text = "正在检查这份 PDF…（\(completed)/\(total)）"
        progressBar.accessibilityValue = "已检查 \(completed)/\(total) 页"
        guard total > 0 else { return }
        progressBar.setProgress(Float(max(0, min(completed, total))) / Float(total), animated: true)
    }

    func hide() {
        removeFromSuperview()
    }
}
