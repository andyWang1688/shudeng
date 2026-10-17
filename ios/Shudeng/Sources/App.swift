import UIKit
import UniformTypeIdentifiers

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?
    func application(_ application: UIApplication, didFinishLaunchingWithOptions options: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        let window = UIWindow(frame: UIScreen.main.bounds)
        self.window = window
        do {
            var root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Shudeng")
#if DEBUG
            if ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] != nil ||
                ProcessInfo.processInfo.arguments.contains("--isolated-reading-test") {
                root = FileManager.default.temporaryDirectory.appendingPathComponent("ShudengReadingTests")
            }
#endif
            let library = try LibraryStore(root: root)
            library.prepareBooks()
            let tabs = UITabBarController()
            let shelf = UINavigationController(rootViewController: LibraryController(library: library))
            shelf.tabBarItem = UITabBarItem(title: "书架", image: UIImage(systemName: "books.vertical"), tag: 0)
            let notes = UINavigationController(rootViewController: NotesController(library: library))
            notes.tabBarItem = UITabBarItem(title: "笔记", image: UIImage(systemName: "square.and.pencil"), tag: 1)
            let chats = UINavigationController(rootViewController: QuestionHistoryController(library: library))
            chats.tabBarItem = UITabBarItem(title: "对话", image: UIImage(systemName: "bubble.left.and.bubble.right"), tag: 2)
            let about = AboutController(root: root)
            about.tabBarItem = UITabBarItem(title: "我的", image: UIImage(systemName: "person.crop.circle"), tag: 3)
            tabs.viewControllers = [shelf, notes, chats, UINavigationController(rootViewController: about)]
            window.rootViewController = tabs
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

final class AboutController: UIViewController {
    private let root: URL
    init(root: URL) { self.root = root; super.init(nibName: nil, bundle: nil) }
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }
    @objc private func aiSettings() { navigationController?.pushViewController(AISettingsController(root: root), animated: true) }
    override func viewDidLoad() {
        super.viewDidLoad()
        title = "我的"
        view.backgroundColor = .systemBackground
        let button = UIButton(type: .system)
        button.setTitle("第三方许可", for: .normal)
        button.addTarget(self, action: #selector(licenses), for: .touchUpInside)
        button.translatesAutoresizingMaskIntoConstraints = false
        let ai = UIButton(type: .system)
        ai.setTitle("AI 服务", for: .normal)
        ai.addTarget(self, action: #selector(aiSettings), for: .touchUpInside)
        ai.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(ai)
        NSLayoutConstraint.activate([ai.centerXAnchor.constraint(equalTo: view.centerXAnchor), ai.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 24)])
        view.addSubview(button)
        NSLayoutConstraint.activate([button.centerXAnchor.constraint(equalTo: view.centerXAnchor), button.topAnchor.constraint(equalTo: ai.bottomAnchor, constant: 24)])
    }
    @objc private func licenses() {
        let controller = UIViewController()
        controller.title = "第三方许可"
        let text = UITextView()
        text.isEditable = false
        text.font = .preferredFont(forTextStyle: .body)
        text.text = Bundle.main.url(forResource: "ThirdPartyNotices", withExtension: "txt").flatMap { try? String(contentsOf: $0, encoding: .utf8) } ?? "许可文件无法读取"
        controller.view = text
        navigationController?.pushViewController(controller, animated: true)
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
            let width = (environment.container.effectiveContentSize.width - 32 - CGFloat(columns - 1) * 12) / CGFloat(columns)
            let item = NSCollectionLayoutItem(layoutSize: .init(widthDimension: .absolute(width), heightDimension: .estimated(240)))
            let group = NSCollectionLayoutGroup.horizontal(layoutSize: .init(widthDimension: .fractionalWidth(1), heightDimension: .estimated(240)), repeatingSubitem: item, count: columns)
            group.interItemSpacing = .fixed(12)
            let section = NSCollectionLayoutSection(group: group)
            section.interGroupSpacing = 12
            section.contentInsets = .init(top: 12, leading: 16, bottom: 24, trailing: 16)
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
        navigationController?.navigationBar.prefersLargeTitles = true
        navigationItem.rightBarButtonItems = [importButton, sortButton, removedButton]
        sortButton.accessibilityLabel = "排序"
        search.searchResultsUpdater = self
        search.obscuresBackgroundDuringPresentation = false
        search.searchBar.placeholder = "书名或作者"
        search.searchBar.searchTextField.accessibilityIdentifier = "library-search"
        navigationItem.searchController = search
        navigationItem.hidesSearchBarWhenScrolling = false
        definesPresentationContext = true
        collectionView.accessibilityIdentifier = "library"
        collectionView.backgroundColor = .systemGroupedBackground
        collectionView.keyboardDismissMode = .onDrag
        collectionView.register(ShelfCell.self, forCellWithReuseIdentifier: "book")
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
        sortButton.menu = UIMenu(title: "排序", children: ShelfOrder.allCases.map { choice in
            UIAction(title: choice.rawValue, state: order == choice ? .on : .off) { [weak self] _ in
                self?.order = choice
                self?.refresh()
            }
        })
        collectionView.reloadData()
        if displayed.isEmpty {
            let label = UILabel()
            label.text = showingRemoved ? "没有已移除的书籍" : library.books.isEmpty ? "导入 EPUB，开始阅读" : "没有找到匹配的书籍"
            label.font = .preferredFont(forTextStyle: .body)
            label.adjustsFontForContentSizeCategory = true
            label.numberOfLines = 0
            label.textAlignment = .center
            label.textColor = .secondaryLabel
            collectionView.backgroundView = label
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
        cell.accessibilityValue = message
        cell.accessibilityIdentifier = "book-\(book.id)"
        return cell
    }
    override func collectionView(_ collectionView: UICollectionView, didSelectItemAt indexPath: IndexPath) {
        collectionView.deselectItem(at: indexPath, animated: true)
        guard !busy else { return }
        let id = displayed[indexPath.item].id
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
                let reader = try ReaderController(book: book, publication: publication, library: library)
                reader.modalPresentationStyle = .fullScreen
                present(reader, animated: true)
            } catch { message(title: "无法打开书籍", text: error.localizedDescription) }
        }
    }
    private func message(title: String, text: String) {
        let alert = UIAlertController(title: title, message: text, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "知道了", style: .default))
        present(alert, animated: true)
    }
}

private final class ShelfCell: UICollectionViewCell {
    private let title = UILabel()
    private let author = UILabel()
    private let action = UILabel()
    private let preparation = UILabel()
    override init(frame: CGRect) {
        super.init(frame: frame)
        contentView.backgroundColor = .secondarySystemGroupedBackground
        contentView.layer.cornerRadius = 12
        let cover = UIImageView(image: UIImage(systemName: "book.closed"))
        cover.contentMode = .scaleAspectFit
        cover.tintColor = .secondaryLabel
        cover.heightAnchor.constraint(equalToConstant: 72).isActive = true
        title.font = .preferredFont(forTextStyle: .headline)
        author.font = .preferredFont(forTextStyle: .subheadline)
        author.textColor = .secondaryLabel
        action.font = .preferredFont(forTextStyle: .caption1)
        action.textColor = .tintColor
        preparation.font = .preferredFont(forTextStyle: .caption1)
        preparation.textColor = .secondaryLabel
        for label in [title, author, action, preparation] {
            label.numberOfLines = 0
            label.adjustsFontForContentSizeCategory = true
        }
        let stack = UIStackView(arrangedSubviews: [cover, title, author, action, preparation])
        stack.axis = .vertical
        stack.spacing = 8
        stack.translatesAutoresizingMaskIntoConstraints = false
        contentView.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 12),
            stack.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -12),
            stack.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 16),
            stack.bottomAnchor.constraint(equalTo: contentView.bottomAnchor, constant: -16)
        ])
        isAccessibilityElement = true
        accessibilityTraits = .button
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }
    func configure(_ book: Book, preparation: String) {
        title.text = book.title
        author.text = book.author.isEmpty ? "作者未知" : book.author
        action.text = book.removal == nil ? (book.locatorJSON == nil ? "开始阅读" : "继续阅读") : "管理保留记录"
        self.preparation.text = preparation
        accessibilityLabel = [title.text, author.text, action.text].compactMap { $0 }.joined(separator: "，")
    }
}
