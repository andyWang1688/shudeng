import UIKit
import UniformTypeIdentifiers

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?
    func application(_ application: UIApplication, didFinishLaunchingWithOptions options: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        BookDesign.install()
        let window = UIWindow(frame: UIScreen.main.bounds)
        self.window = window
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
func makeApplicationTabs(library: LibraryStore, root: URL, secrets: AISecrets) -> UITabBarController {
    let tabs = UITabBarController()
    tabs.view.accessibilityIdentifier = "app-tabs"
    let shelf = UINavigationController(rootViewController: LibraryController(library: library))
    shelf.tabBarItem = UITabBarItem(title: "书架", image: UIImage(systemName: "books.vertical"), tag: 0)
    shelf.tabBarItem.accessibilityIdentifier = "tab-library"
    let notes = UINavigationController(rootViewController: NotesController(library: library))
    notes.tabBarItem = UITabBarItem(title: "笔记", image: UIImage(systemName: "square.and.pencil"), tag: 1)
    notes.tabBarItem.accessibilityIdentifier = "tab-notes"
    let chats = UINavigationController(rootViewController: QuestionHistoryController(library: library))
    chats.tabBarItem = UITabBarItem(title: "对话", image: UIImage(systemName: "bubble.left.and.bubble.right"), tag: 2)
    chats.tabBarItem.accessibilityIdentifier = "tab-conversations"
    let profile = AboutController(root: root, secrets: secrets)
    profile.tabBarItem = UITabBarItem(title: "我的", image: UIImage(systemName: "person.crop.circle"), tag: 3)
    profile.tabBarItem.accessibilityIdentifier = "tab-profile"
    tabs.viewControllers = [shelf, notes, chats, UINavigationController(rootViewController: profile)]
    return tabs
}

final class AboutController: UIViewController {
    private let root: URL
    private let secrets: AISecrets
    private let service = BookDesign.label(nil, size: 14, colour: BookDesign.secondary)
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
        super.viewDidLoad(); title = "我的"; navigationController?.navigationBar.prefersLargeTitles = false
        view.backgroundColor = BookDesign.paper
        view.accessibilityIdentifier = "profile-surface"
        let icon = UIImageView(image: UIImage(named: "BrandIcon")); icon.contentMode = .scaleAspectFit
        icon.layer.cornerRadius = 16; icon.clipsToBounds = true; icon.accessibilityIdentifier = "brand-icon"
        icon.widthAnchor.constraint(equalToConstant: 68).isActive = true; icon.heightAnchor.constraint(equalToConstant: 68).isActive = true
        let wordmark = BookDesign.label("书灯", size: 26, weight: .semibold)
        let identity = UIStackView(arrangedSubviews: [icon, wordmark, UIView()]); identity.spacing = 16; identity.alignment = .center
        let motto = BookDesign.label("一盏照书的灯，\nAI 照亮你读不懂的地方。", size: 19)
        motto.font = BookDesign.readingFont(19)
        let ai = UIButton(type: .system); BookDesign.button(ai, title: "AI 服务", symbol: "sparkle")
        ai.contentHorizontalAlignment = .leading; ai.addTarget(self, action: #selector(aiSettings), for: .touchUpInside)
        service.accessibilityIdentifier = "current-ai-service"
        let disclosure = BookDesign.label("阅读内容留在本机。提问时，问题、必要书内原文和所需对话会发送到你选择的 AI 服务；书灯不提供或代付服务。", size: 13, colour: BookDesign.secondary)
        let appearance = UISegmentedControl(items: ["跟随系统", "浅色", "深色"])
        let values: [UIUserInterfaceStyle] = [.unspecified, .light, .dark]
        appearance.selectedSegmentIndex = values.firstIndex(of: UIUserInterfaceStyle(rawValue: UserDefaults.standard.integer(forKey: "interface-style")) ?? .unspecified) ?? 0
        appearance.accessibilityIdentifier = "app-appearance"
        appearance.addAction(UIAction { [weak self, weak appearance] _ in
            guard let self, let appearance else { return }
            let choice = values[appearance.selectedSegmentIndex]
            UserDefaults.standard.set(choice.rawValue, forKey: "interface-style")
            self.view.window?.overrideUserInterfaceStyle = choice
        }, for: .valueChanged)
        let button = UIButton(type: .system); BookDesign.button(button, title: "第三方许可", symbol: "doc.text")
        button.contentHorizontalAlignment = .leading; button.addTarget(self, action: #selector(licenses), for: .touchUpInside)
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? ""
        let stack = UIStackView(arrangedSubviews: [identity, motto, separator(), ai, service, disclosure,
            separator(), BookDesign.label("外观", size: 16, weight: .medium), appearance, separator(), button,
            BookDesign.label("书灯 " + version + " · 以阅读为中心", size: 12, colour: BookDesign.secondary)])
        stack.axis = .vertical; stack.spacing = 18
        let scroll = UIScrollView(); scroll.translatesAutoresizingMaskIntoConstraints = false; stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(scroll); scroll.addSubview(stack)
        NSLayoutConstraint.activate([
            scroll.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor), scroll.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor),
            scroll.leadingAnchor.constraint(equalTo: view.leadingAnchor), scroll.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            stack.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor, constant: 24), stack.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor, constant: -32),
            stack.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor, constant: 24), stack.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor, constant: -24),
            stack.widthAnchor.constraint(equalTo: scroll.frameLayoutGuide.widthAnchor, constant: -48)
        ])
    }
    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        do {
            let store = try AIConfigurationStore(root: root, secrets: secrets)
            let current = store.configurations.first { $0.id == store.selectedID }
            service.text = current.map { $0.name + " · " + $0.model } ?? "尚未配置，阅读仍可使用"
        } catch { service.text = "服务配置暂时无法读取；已有配置未覆盖" }
    }
    private func separator() -> UIView {
        let line = UIView(); line.backgroundColor = BookDesign.line; line.heightAnchor.constraint(equalToConstant: 1).isActive = true; return line
    }
    @objc private func licenses() {
        let controller = UIViewController(); controller.title = "第三方许可"
        let text = UITextView(); text.isEditable = false; text.font = .preferredFont(forTextStyle: .body)
        text.adjustsFontForContentSizeCategory = true; text.backgroundColor = BookDesign.paper; text.textColor = BookDesign.ink
        text.text = Bundle.main.url(forResource: "ThirdPartyNotices", withExtension: "txt").flatMap { try? String(contentsOf: $0, encoding: .utf8) } ?? "许可文件无法读取"
        controller.view = text; navigationController?.pushViewController(controller, animated: true)
    }
}

enum ShelfOrder: String, CaseIterable {
    case imported = "导入顺序", title = "书名"

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

@MainActor
final class LibraryController: UICollectionViewController, UIDocumentPickerDelegate, UISearchResultsUpdating {
    private let library: LibraryStore
    private let search = UISearchController(searchResultsController: nil)
    private var order = ShelfOrder.imported
    private var displayed: [Book] = []
    private let covers = BookCoverStore()
    private lazy var importButton = UIBarButtonItem(title: "导入", style: .plain, target: self, action: #selector(importFile))
    private let sortButton = UIBarButtonItem(title: "排序", image: UIImage(systemName: "arrow.up.arrow.down"))
    private var busy = false
    private var preparationObserver: NSObjectProtocol?
    private var libraryObserver: NSObjectProtocol?
    private var showingRemoved = false
    private lazy var removedButton = UIBarButtonItem(title: "已移除", style: .plain, target: self, action: #selector(toggleRemoved))
    init(library: LibraryStore) {
        self.library = library
        let layout = UICollectionViewCompositionalLayout { _, environment in
            let columns = environment.traitCollection.preferredContentSizeCategory.isAccessibilityCategory ? 1 : 2
            let width = (environment.container.effectiveContentSize.width - 48 - CGFloat(columns - 1) * 22) / CGFloat(columns)
            let item = NSCollectionLayoutItem(layoutSize: .init(widthDimension: .absolute(width), heightDimension: .estimated(240)))
            let group = NSCollectionLayoutGroup.horizontal(layoutSize: .init(widthDimension: .fractionalWidth(1), heightDimension: .estimated(240)), repeatingSubitem: item, count: columns)
            group.interItemSpacing = .fixed(22)
            let section = NSCollectionLayoutSection(group: group)
            section.interGroupSpacing = 24
            section.contentInsets = .init(top: 12, leading: 24, bottom: 32, trailing: 24)
            section.boundarySupplementaryItems = [.init(layoutSize: .init(widthDimension: .fractionalWidth(1), heightDimension: .estimated(240)), elementKind: UICollectionView.elementKindSectionHeader, alignment: .top)]
            return section
        }
        super.init(collectionViewLayout: layout)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }
    deinit {
        if let preparationObserver { NotificationCenter.default.removeObserver(preparationObserver) }
        if let libraryObserver { NotificationCenter.default.removeObserver(libraryObserver) }
    }
    override func viewDidLoad() {
        super.viewDidLoad()
        title = "书架"
        // Compact system titles remain visible on the supported small-screen
        // runtime, where the scroll-edge large-title view can render empty.
        navigationController?.navigationBar.prefersLargeTitles = false
        navigationItem.rightBarButtonItems = [importButton, sortButton]
        importButton.image = UIImage(systemName: "plus"); importButton.accessibilityLabel = "导入"
        sortButton.image = UIImage(systemName: "ellipsis.circle")
        sortButton.accessibilityLabel = "排序"
        search.searchResultsUpdater = self
        search.obscuresBackgroundDuringPresentation = false
        search.searchBar.placeholder = "书名或作者"
        search.searchBar.searchTextField.accessibilityIdentifier = "library-search"
        navigationItem.searchController = search
        navigationItem.hidesSearchBarWhenScrolling = false
        definesPresentationContext = true
        collectionView.accessibilityIdentifier = "library"
        collectionView.backgroundColor = BookDesign.paper
        collectionView.keyboardDismissMode = .onDrag
        collectionView.register(ShelfCell.self, forCellWithReuseIdentifier: "book")
        collectionView.register(ShelfHeader.self, forSupplementaryViewOfKind: UICollectionView.elementKindSectionHeader, withReuseIdentifier: "header")
        preparationObserver = NotificationCenter.default.addObserver(forName: BookPreparation.changed, object: library.preparation, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.refresh() }
        }
        libraryObserver = NotificationCenter.default.addObserver(forName: LibraryStore.changed, object: library, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.refresh() }
        }
        refresh()
    }
    override func viewWillAppear(_ animated: Bool) { super.viewWillAppear(animated); refresh() }
    func updateSearchResults(for searchController: UISearchController) { refresh() }
    private func refresh() {
        displayed = order.books(library.books.filter { showingRemoved ? $0.removal != nil : $0.removal == nil }, matching: search.searchBar.text ?? "")
        title = showingRemoved ? "已移除的书籍" : "书架"
        removedButton.title = showingRemoved ? "返回书架" : "已移除"
        sortButton.menu = UIMenu(children: [UIMenu(title: "排序", children: ShelfOrder.allCases.map { choice in
            UIAction(title: choice.rawValue, state: order == choice ? .on : .off) { [weak self] _ in
                self?.order = choice
                self?.refresh()
            }
        }), UIAction(title: showingRemoved ? "返回书架" : "已移除的书籍", image: UIImage(systemName: "archivebox")) { [weak self] _ in self?.toggleRemoved() }])
        collectionView.reloadData()
        if displayed.isEmpty {
            let label = UILabel()
            label.text = showingRemoved ? "没有已移除的书籍" : library.books.isEmpty ? "导入 EPUB，开始阅读" : "没有找到匹配的书籍"
            label.font = .preferredFont(forTextStyle: .body)
            label.adjustsFontForContentSizeCategory = true
            label.numberOfLines = 0
            label.textAlignment = .center
            label.textColor = .secondaryLabel
            let box = UIStackView(arrangedSubviews: [label]); box.axis = .vertical; box.alignment = .center; box.spacing = 16
            if !showingRemoved && library.books.filter({ $0.removal == nil }).isEmpty {
                let button = UIButton(type: .system); BookDesign.button(button, title: "导入 EPUB", symbol: "plus", filled: true)
                button.addTarget(self, action: #selector(importFile), for: .touchUpInside); box.addArrangedSubview(button)
            }
            let empty = UIView(); box.translatesAutoresizingMaskIntoConstraints = false; empty.addSubview(box)
            NSLayoutConstraint.activate([box.centerXAnchor.constraint(equalTo: empty.centerXAnchor), box.centerYAnchor.constraint(equalTo: empty.centerYAnchor),
                box.leadingAnchor.constraint(greaterThanOrEqualTo: empty.leadingAnchor, constant: 24), box.trailingAnchor.constraint(lessThanOrEqualTo: empty.trailingAnchor, constant: -24)])
            collectionView.backgroundView = empty
        } else { collectionView.backgroundView = nil }
    }
    @objc private func toggleRemoved() { showingRemoved.toggle(); refresh() }
    override func collectionView(_ collectionView: UICollectionView, contextMenuConfigurationForItemAt indexPath: IndexPath, point: CGPoint) -> UIContextMenuConfiguration? {
        let book = displayed[indexPath.item]
        guard !busy else { return nil }
        return UIContextMenuConfiguration(identifier: nil, previewProvider: nil) { [weak self] _ in
            var actions: [UIAction] = []
            if book.removal != .removed && book.removal != .deleting {
                actions.append(UIAction(title: "移除原书，保留记录") { _ in self?.confirmRemoval(book.id, deleteRecords: false) })
            }
            actions.append(UIAction(title: "连同记录彻底删除", attributes: .destructive) { _ in self?.confirmRemoval(book.id, deleteRecords: true) })
            return UIMenu(children: actions)
        }
    }
    private func confirmRemoval(_ id: String, deleteRecords: Bool) {
        guard !busy, let book = library.books.first(where: { $0.id == id }) else { return }
        let title = deleteRecords ? "彻底删除这本书及记录？" : "移除原书？"
        let text = deleteRecords ? "将删除《\(book.title)》的原书、笔记、草稿、对话与引用记录，无法撤销。其他书籍不受影响。" : "保留笔记、草稿、对话与引用文字；正在进行的准备和回答将取消。重新导入相同文件后可返回原文并继续问答。"
        let alert = UIAlertController(title: title, message: text, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "取消", style: .cancel))
        alert.addAction(UIAlertAction(title: deleteRecords ? "确认彻底删除" : "移除原书，保留记录", style: deleteRecords ? .destructive : .default) { [weak self] _ in
            self?.performRemoval(id, deleteRecords: deleteRecords)
        })
        present(alert, animated: true)
    }
    private func performRemoval(_ id: String, deleteRecords: Bool) {
        guard !busy else { return }
        busy = true; importButton.isEnabled = false
        Task {
            defer { busy = false; importButton.isEnabled = true; refresh() }
            do { try await library.removeBook(id, deleteRecords: deleteRecords) }
            catch {
                let alert = UIAlertController(title: "移除尚未完成", message: "\(error.localizedDescription) 已完成的清理不会撤销，请重试完成本次操作。", preferredStyle: .alert)
                alert.addAction(UIAlertAction(title: "稍后重试", style: .cancel))
                alert.addAction(UIAlertAction(title: "重试", style: .default) { [weak self] _ in self?.performRemoval(id, deleteRecords: deleteRecords) })
                present(alert, animated: true)
            }
        }
    }
    @objc private func importFile() {
        guard !busy else { return }
        // All files remain selectable so unsupported inputs get an honest error.
        let epub = UTType(filenameExtension: "epub") ?? UTType(importedAs: "org.idpf.epub-container")
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: [epub, .data], asCopy: true)
        picker.delegate = self
        picker.allowsMultipleSelection = false
        present(picker, animated: true)
    }
    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let url = urls.first else { return }
        busy = true
        importButton.isEnabled = false
        Task {
            defer { busy = false; importButton.isEnabled = true }
            do {
                let result = try await library.importBook(from: url)
                showingRemoved = false; refresh()
                message(title: result.isDuplicate ? "书籍已在书架" : "已加入书架", text: result.isDuplicate ? "相同文件复用已有书籍、进度和记录；不同字节的同名文件按另一本书处理。" : result.book.title)
            } catch { message(title: "导入失败", text: error.localizedDescription) }
        }
    }
    override func collectionView(_ collectionView: UICollectionView, numberOfItemsInSection section: Int) -> Int { displayed.count }
    override func collectionView(_ collectionView: UICollectionView, cellForItemAt indexPath: IndexPath) -> UICollectionViewCell {
        let book = displayed[indexPath.item]
        let cell = collectionView.dequeueReusableCell(withReuseIdentifier: "book", for: indexPath) as! ShelfCell
        let state = library.preparation.states[book.id] ?? BookPreparationState()
        let message = book.removal?.pending == true ? "移除尚未完成，点此重试" : book.removal == .removed ? "原书已移除，笔记与对话仍保留" : state.message
        cell.configure(book, preparation: message)
        cell.coverTask = Task { [weak cell, covers, library] in
            let image = await covers.image(for: book, library: library)
            guard !Task.isCancelled else { return }; cell?.setCover(image, for: book)
        }
        cell.accessibilityValue = message
        cell.accessibilityIdentifier = "book-\(book.id)"
        return cell
    }
    override func collectionView(_ collectionView: UICollectionView, didSelectItemAt indexPath: IndexPath) {
        collectionView.deselectItem(at: indexPath, animated: true)
        guard !busy else { return }
        openBook(displayed[indexPath.item].id)
    }
    private func openBook(_ id: String) {
        guard !busy else { return }
        guard let book = library.books.first(where: { $0.id == id }) else { return }
        if let removal = book.removal {
            confirmRemoval(id, deleteRecords: removal != .removing)
            return
        }
        search.searchBar.resignFirstResponder()
        busy = true
        Task {
            defer { busy = false }
            do {
                let publication = try await library.open(book)
                UserDefaults.standard.set(book.id, forKey: "last-read-" + library.root.path)
                let reader = try ReaderController(book: book, publication: publication, library: library)
                reader.modalPresentationStyle = .fullScreen
                present(reader, animated: true)
            } catch { message(title: "无法打开书籍", text: error.localizedDescription) }
        }
    }
    override func collectionView(_ collectionView: UICollectionView, viewForSupplementaryElementOfKind kind: String, at indexPath: IndexPath) -> UICollectionReusableView {
        let header = collectionView.dequeueReusableSupplementaryView(ofKind: kind, withReuseIdentifier: "header", for: indexPath) as! ShelfHeader
        let preferred = UserDefaults.standard.string(forKey: "last-read-" + library.root.path)
        let continuing = showingRemoved || !(search.searchBar.text ?? "").isEmpty ? nil :
            displayed.first(where: { $0.id == preferred }) ?? displayed.first(where: { $0.locatorJSON != nil })
        header.configure(continuing, count: displayed.count)
        if let continuing {
            header.open = { [weak self] in self?.openBook(continuing.id) }
            header.coverTask = Task { [weak header, covers, library] in
                let image = await covers.image(for: continuing, library: library)
                guard !Task.isCancelled else { return }; header?.setCover(image, for: continuing)
            }
        } else { header.open = nil }
        return header
    }
    private func message(title: String, text: String) {
        let alert = UIAlertController(title: title, message: text, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "知道了", style: .default))
        present(alert, animated: true)
    }
}

private final class ShelfCell: UICollectionViewCell {
    private let cover = BookCoverView()
    private let title = BookDesign.label(nil, size: 16, weight: .medium)
    private let author = BookDesign.label(nil, size: 12, colour: BookDesign.secondary)
    private let preparation = BookDesign.label(nil, size: 11, colour: BookDesign.secondary)
    private var represented: String?
    var coverTask: Task<Void, Never>?
    override init(frame: CGRect) {
        super.init(frame: frame)
        title.numberOfLines = 2; author.numberOfLines = 1; preparation.numberOfLines = 2
        let stack = UIStackView(arrangedSubviews: [cover, title, author, preparation]); stack.axis = .vertical; stack.spacing = 6
        stack.setCustomSpacing(12, after: cover); stack.translatesAutoresizingMaskIntoConstraints = false; contentView.addSubview(stack)
        NSLayoutConstraint.activate([stack.leadingAnchor.constraint(equalTo: contentView.leadingAnchor), stack.trailingAnchor.constraint(equalTo: contentView.trailingAnchor),
            stack.topAnchor.constraint(equalTo: contentView.topAnchor), stack.bottomAnchor.constraint(equalTo: contentView.bottomAnchor),
            cover.heightAnchor.constraint(equalTo: cover.widthAnchor, multiplier: 1.4)])
        isAccessibilityElement = true; accessibilityTraits = .button
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }
    override func prepareForReuse() { super.prepareForReuse(); coverTask?.cancel(); represented = nil }
    func configure(_ book: Book, preparation: String) {
        coverTask?.cancel(); represented = book.id; title.text = book.title
        author.text = book.author.isEmpty ? "作者未知" : book.author; self.preparation.text = preparation
        cover.configure(book, image: nil)
        accessibilityLabel = [book.title, author.text ?? "", book.removal == nil ? (book.locatorJSON == nil ? "开始阅读" : "继续阅读") : "管理保留记录"].joined(separator: "，")
    }
    func setCover(_ image: UIImage?, for book: Book) { if represented == book.id { cover.configure(book, image: image) } }
}

private final class ShelfHeader: UICollectionReusableView {
    private let heading = BookDesign.label("继续阅读", size: 13, colour: BookDesign.secondary)
    private let cover = BookCoverView()
    private let title = BookDesign.label(nil, size: 20, weight: .medium)
    private let detail = BookDesign.label(nil, size: 13, colour: BookDesign.secondary)
    private let count = BookDesign.label(nil, size: 18, weight: .semibold)
    private let card = UIButton(type: .system)
    private var represented: String?
    var coverTask: Task<Void, Never>?
    var open: (() -> Void)?
    override init(frame: CGRect) {
        super.init(frame: frame)
        cover.widthAnchor.constraint(equalToConstant: 64).isActive = true
        cover.heightAnchor.constraint(equalToConstant: 92).isActive = true
        let text = UIStackView(arrangedSubviews: [title, detail]); text.axis = .vertical; text.spacing = 8
        let arrow = UIImageView(image: UIImage(systemName: "arrow.right")); arrow.tintColor = BookDesign.lamp
        arrow.setContentHuggingPriority(.required, for: .horizontal)
        let content = UIStackView(arrangedSubviews: [cover, text, arrow]); content.spacing = 16; content.alignment = .center
        content.isUserInteractionEnabled = false; content.translatesAutoresizingMaskIntoConstraints = false
        card.addSubview(content); card.backgroundColor = BookDesign.surface; card.layer.cornerRadius = 16
        card.addAction(UIAction { [weak self] _ in self?.open?() }, for: .touchUpInside)
        let stack = UIStackView(arrangedSubviews: [heading, card, count]); stack.axis = .vertical; stack.spacing = 12
        stack.setCustomSpacing(28, after: card); stack.translatesAutoresizingMaskIntoConstraints = false; addSubview(stack)
        NSLayoutConstraint.activate([stack.topAnchor.constraint(equalTo: topAnchor, constant: 8), stack.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -8),
            stack.leadingAnchor.constraint(equalTo: leadingAnchor), stack.trailingAnchor.constraint(equalTo: trailingAnchor),
            content.topAnchor.constraint(equalTo: card.topAnchor, constant: 16), content.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -16),
            content.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 16), content.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -16)])
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }
    func configure(_ book: Book?, count: Int) {
        represented = book?.id; coverTask?.cancel()
        heading.isHidden = book == nil; card.isHidden = book == nil
        self.count.text = "书库 · " + String(count) + " 本"
        if let book {
            cover.configure(book, image: nil); title.text = book.title; detail.text = "从上次读到的地方继续"
            card.accessibilityLabel = "继续阅读，" + book.title; card.accessibilityIdentifier = "continue-reading"
        }
    }
    func setCover(_ image: UIImage?, for book: Book) { if represented == book.id { cover.configure(book, image: image) } }
}
