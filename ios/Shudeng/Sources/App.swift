import UIKit
import UniformTypeIdentifiers

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?
    func application(_ application: UIApplication, didFinishLaunchingWithOptions options: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        let window = UIWindow(frame: UIScreen.main.bounds)
        self.window = window
        do {
            let root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Shudeng")
            let library = try LibraryStore(root: root)
            library.prepareBooks()
            let tabs = UITabBarController()
            let shelf = UINavigationController(rootViewController: LibraryController(library: library))
            shelf.tabBarItem = UITabBarItem(title: "书架", image: UIImage(systemName: "books.vertical"), tag: 0)
            let notes = UINavigationController(rootViewController: NotesController(library: library))
            notes.tabBarItem = UITabBarItem(title: "笔记", image: UIImage(systemName: "square.and.pencil"), tag: 1)
            let chats = placeholder(title: "对话", message: "还没有对话", symbol: "bubble.left.and.bubble.right", tag: 2)
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
    private func placeholder(title: String, message: String, symbol: String, tag: Int) -> UIViewController {
        let controller = UIViewController()
        controller.title = title
        controller.view.backgroundColor = .systemBackground
        let label = UILabel()
        label.text = message
        label.textColor = .secondaryLabel
        label.font = .preferredFont(forTextStyle: .body)
        label.translatesAutoresizingMaskIntoConstraints = false
        controller.view.addSubview(label)
        NSLayoutConstraint.activate([label.centerXAnchor.constraint(equalTo: controller.view.centerXAnchor), label.centerYAnchor.constraint(equalTo: controller.view.centerYAnchor)])
        let navigation = UINavigationController(rootViewController: controller)
        navigation.tabBarItem = UITabBarItem(title: title, image: UIImage(systemName: symbol), tag: tag)
        return navigation
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

@MainActor
final class LibraryController: UITableViewController, UIDocumentPickerDelegate {
    private let library: LibraryStore
    private var busy = false
    private var preparationObserver: NSObjectProtocol?
    init(library: LibraryStore) { self.library = library; super.init(style: .insetGrouped) }
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }
    deinit { if let preparationObserver { NotificationCenter.default.removeObserver(preparationObserver) } }
    override func viewDidLoad() {
        super.viewDidLoad()
        title = "书架"
        navigationController?.navigationBar.prefersLargeTitles = true
        navigationItem.rightBarButtonItem = UIBarButtonItem(title: "导入", style: .plain, target: self, action: #selector(importFile))
        tableView.accessibilityIdentifier = "library"
        preparationObserver = NotificationCenter.default.addObserver(forName: BookPreparation.changed, object: library.preparation, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.refresh() }
        }
        refresh()
    }
    private func refresh() {
        tableView.reloadData()
        if library.books.isEmpty {
            let label = UILabel()
            label.text = "导入 EPUB，开始阅读"
            label.textAlignment = .center
            label.textColor = .secondaryLabel
            tableView.backgroundView = label
        } else { tableView.backgroundView = nil }
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
        navigationItem.rightBarButtonItem?.isEnabled = false
        Task {
            defer { busy = false; navigationItem.rightBarButtonItem?.isEnabled = true }
            do {
                let result = try await library.importBook(from: url)
                refresh()
                message(title: result.isDuplicate ? "书籍已在书架" : "已加入书架", text: result.isDuplicate ? "复用已有书籍和阅读进度。" : result.book.title)
            } catch { message(title: "导入失败", text: error.localizedDescription) }
        }
    }
    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { library.books.count }
    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let book = library.books[indexPath.row]
        let cell = UITableViewCell(style: .subtitle, reuseIdentifier: nil)
        cell.textLabel?.text = book.title
        cell.textLabel?.numberOfLines = 0
        let state = library.preparation.states[book.id] ?? BookPreparationState()
        cell.detailTextLabel?.text = (book.author.isEmpty ? "EPUB" : book.author) + "\n" + state.message
        cell.detailTextLabel?.numberOfLines = 0
        cell.accessibilityValue = state.message
        cell.accessoryType = .disclosureIndicator
        cell.accessibilityIdentifier = "book-\(book.id)"
        return cell
    }
    override func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true)
        guard !busy else { return }
        let book = library.books[indexPath.row]
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
