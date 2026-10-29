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
    let profile = ProfileController(root: root, secrets: secrets, library: library)
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
    private enum Section: Int, CaseIterable { case brand, settings, about }
    private let root: URL
    private let secrets: AISecrets
    private let library: LibraryStore?
    private var serviceSummary = "尚未配置，阅读仍可使用"
    private var appearanceName = "跟随系统"
    private var stats: (books: Int, notes: Int, chats: Int)?

    init(root: URL, secrets: AISecrets = KeychainSecrets(), library: LibraryStore? = nil) {
        self.root = root
        self.secrets = secrets
        self.library = library
        super.init(collectionViewLayout: ProfileController.makeLayout())
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    private static func makeLayout() -> UICollectionViewCompositionalLayout {
        UICollectionViewCompositionalLayout { index, environment in
            var configuration: UICollectionLayoutListConfiguration
            switch Section(rawValue: index) {
            case .brand:
                configuration = UICollectionLayoutListConfiguration(appearance: .plain)
                configuration.showsSeparators = false
            case .settings:
                configuration = UICollectionLayoutListConfiguration(appearance: .insetGrouped)
                configuration.headerMode = .supplementary
            default:
                configuration = UICollectionLayoutListConfiguration(appearance: .insetGrouped)
                configuration.headerMode = .supplementary
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
        collectionView.register(ProfileBrandCell.self, forCellWithReuseIdentifier: "profile-brand")
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
        reloadStats()
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        navigationController?.setNavigationBarHidden(true, animated: false)
        reloadService()
        updateAppearanceRow()
        reloadStats()
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

    private func reloadStats() {
        guard let library else {
            stats = nil
            return
        }
        let books = library.books.filter { $0.removal == nil }
        stats = (
            books.count,
            books.reduce(0) { $0 + ($1.notes?.count ?? 0) },
            library.questions.conversations.count
        )
    }

    private var version: String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.3.0"
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
        case .brand: return 1
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
        if indexPath.section == Section.brand.rawValue {
            let cell = collectionView.dequeueReusableCell(withReuseIdentifier: "profile-brand", for: indexPath) as! ProfileBrandCell
            cell.configure(stats: stats)
            return cell
        }
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

/// 我的页品牌区：标题 + 灯标 + 字标 + 副题 + 统计；作为列表首项，内容自适应。
private final class ProfileBrandCell: UICollectionViewCell {
    private let icon = ProfileBrandIconView(image: BookDesign.brandMark)
    private let wordmark = BookDesign.label("书灯", font: BookType.serif(22, weight: .semibold, style: .title2))
    private let motto = BookDesign.label(
        "一盏照书的灯，AI 照亮你读不懂的地方",
        font: BookType.serif(12.5, weight: .regular, style: .footnote),
        colour: BookDesign.ink2
    )
    private let booksValue = BookDesign.label(nil, font: BookType.serif(17, weight: .semibold, style: .headline))
    private let notesValue = BookDesign.label(nil, font: BookType.serif(17, weight: .semibold, style: .headline))
    private let chatsValue = BookDesign.label(nil, font: BookType.serif(17, weight: .semibold, style: .headline))
    private let statsRow = UIStackView()

    override init(frame: CGRect) {
        super.init(frame: frame)
        let title = BookDesign.label("我的", font: BookType.display)
        title.accessibilityIdentifier = "profile-title"

        icon.isAccessibilityElement = true
        icon.accessibilityLabel = "书灯图标"
        icon.accessibilityIdentifier = "profile-brand-icon"
        icon.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            icon.widthAnchor.constraint(equalToConstant: 56),
            icon.heightAnchor.constraint(equalToConstant: 56)
        ])

        wordmark.textAlignment = .center
        wordmark.accessibilityIdentifier = "profile-wordmark"
        motto.textAlignment = .center
        motto.numberOfLines = 0
        motto.accessibilityLabel = "一盏照书的灯，AI 照亮你读不懂的地方"
        motto.accessibilityIdentifier = "profile-motto"

        configureStats()
        let identity = UIStackView(arrangedSubviews: [icon, wordmark, motto, statsRow])
        identity.axis = .vertical
        identity.alignment = .center
        identity.spacing = 10
        identity.setCustomSpacing(12, after: icon)
        identity.setCustomSpacing(4, after: wordmark)
        identity.setCustomSpacing(18, after: motto)
        identity.accessibilityIdentifier = "profile-brand"
        identity.isLayoutMarginsRelativeArrangement = true
        identity.layoutMargins = UIEdgeInsets(top: 20, left: 16, bottom: 18, right: 16)
        identity.translatesAutoresizingMaskIntoConstraints = false

        let hero = UIView()
        hero.backgroundColor = BookDesign.paperDeep
        hero.layer.cornerRadius = 16
        hero.layer.cornerCurve = .continuous
        hero.addSubview(identity)
        NSLayoutConstraint.activate([
            identity.topAnchor.constraint(equalTo: hero.topAnchor),
            identity.bottomAnchor.constraint(equalTo: hero.bottomAnchor),
            identity.leadingAnchor.constraint(equalTo: hero.leadingAnchor),
            identity.trailingAnchor.constraint(equalTo: hero.trailingAnchor)
        ])

        let stack = UIStackView(arrangedSubviews: [title, hero])
        stack.axis = .vertical
        stack.spacing = 20
        stack.translatesAutoresizingMaskIntoConstraints = false
        contentView.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 6),
            stack.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: BookSpacing.screen),
            stack.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -BookSpacing.screen),
            stack.bottomAnchor.constraint(equalTo: contentView.bottomAnchor, constant: -20)
        ])
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    private func configureStats() {
        statsRow.axis = .horizontal
        statsRow.alignment = .center
        statsRow.distribution = .fillEqually
        statsRow.spacing = 0
        statsRow.accessibilityIdentifier = "profile-stats"
        for (value, label) in [(booksValue, "本书"), (notesValue, "条笔记"), (chatsValue, "段对话")] {
            let column = UIStackView(arrangedSubviews: [value, BookDesign.label(label, font: BookType.caption, colour: BookDesign.ink3)])
            column.axis = .vertical
            column.alignment = .center
            column.spacing = 2
            statsRow.addArrangedSubview(column)
            value.textAlignment = .center
        }
        for index in 0..<2 {
            let separator = UIView()
            separator.backgroundColor = BookDesign.line
            separator.translatesAutoresizingMaskIntoConstraints = false
            let container = UIView()
            container.addSubview(separator)
            container.heightAnchor.constraint(equalToConstant: 24).isActive = true
            NSLayoutConstraint.activate([
                separator.widthAnchor.constraint(equalToConstant: 1),
                separator.heightAnchor.constraint(equalToConstant: 24),
                separator.centerXAnchor.constraint(equalTo: container.centerXAnchor),
                separator.centerYAnchor.constraint(equalTo: container.centerYAnchor)
            ])
            statsRow.insertArrangedSubview(container, at: min(index * 2 + 1, statsRow.arrangedSubviews.count))
        }
    }

    func configure(stats: (books: Int, notes: Int, chats: Int)?) {
        guard let stats else {
            statsRow.isHidden = true
            return
        }
        statsRow.isHidden = false
        booksValue.text = String(stats.books)
        notesValue.text = String(stats.notes)
        chatsValue.text = String(stats.chats)
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
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.3.0"
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
        icon.isAccessibilityElement = false
        icon.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            icon.widthAnchor.constraint(equalToConstant: 64),
            icon.heightAnchor.constraint(equalToConstant: 64)
        ])
        wordmark.textAlignment = .center
        motto.textAlignment = .center
        motto.numberOfLines = 0
        release.textAlignment = .center
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
    private let searchBar = UISearchBar()
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

        searchBar.searchBarStyle = .minimal
        searchBar.placeholder = "书名或作者"
        searchBar.showsCancelButton = true
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
    }

    override func scrollViewWillBeginDragging(_ scrollView: UIScrollView) {
        searchBar.resignFirstResponder()
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
