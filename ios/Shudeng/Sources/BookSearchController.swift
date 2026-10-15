import UIKit
import ReadiumShared

@MainActor
final class BookSearchController: UITableViewController, UISearchBarDelegate {
    private let library: LibraryStore
    private let book: Book
    private let navigate: (Locator) -> Void
    private let search = UISearchBar()
    private var hits: [BookSearchHit] = []
    private var message = "输入中英关键词，仅搜索当前书原文"
    private var generation = 0
    private var observer: NSObjectProtocol?
    private var task: Task<Void, Never>?

    init(library: LibraryStore, book: Book, navigate: @escaping (Locator) -> Void) {
        self.library = library; self.book = book; self.navigate = navigate
        super.init(style: .insetGrouped)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }
    deinit { if let observer { NotificationCenter.default.removeObserver(observer) }; task?.cancel() }
    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        navigationController?.setToolbarHidden(true, animated: false)
    }
    override func viewDidLoad() {
        super.viewDidLoad()
        title = "书内搜索"
        search.placeholder = "当前书关键词"
        search.accessibilityIdentifier = "book-search-query"
        search.searchTextField.accessibilityIdentifier = "book-search-query"
        search.delegate = self
        search.searchTextField.autocorrectionType = .no
        search.searchTextField.autocapitalizationType = .none
        tableView.tableHeaderView = search
        search.sizeToFit()
        tableView.accessibilityIdentifier = "book-search-results"
        tableView.keyboardDismissMode = .onDrag
        observer = NotificationCenter.default.addObserver(forName: BookPreparation.changed, object: library.preparation, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.refresh() }
        }
        refresh()
    }
    private var state: BookPreparationState { library.preparation.states[book.id] ?? BookPreparationState() }
    private func refresh() {
        let title = state.failure != nil ? "重试准备" : "重新准备"
        navigationItem.rightBarButtonItem = UIBarButtonItem(title: title, style: .plain, target: self, action: #selector(prepareBook))
        navigationItem.rightBarButtonItem?.isEnabled = state.ready || state.failure != nil
        runSearch()
    }
    @objc private func prepareBook() { library.preparation.start(book, file: library.fileURL(for: book), rebuild: state.ready) }
    func searchBar(_ searchBar: UISearchBar, textDidChange searchText: String) { runSearch() }
    func searchBarSearchButtonClicked(_ searchBar: UISearchBar) { searchBar.resignFirstResponder(); runSearch() }
    private func runSearch() {
        generation += 1
        let current = generation
        let query = (search.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        task?.cancel()
        guard !query.isEmpty else {
            hits = []; message = "输入中英关键词，仅搜索当前书原文"; tableView.reloadData(); return
        }
        task = Task {
            do {
                try await Task.sleep(nanoseconds: 200_000_000)
                let result = try await library.preparation.index.search(bookID: book.id, query: query)
                guard !Task.isCancelled, generation == current else { return }
                hits = result
                message = result.isEmpty ? "已准备原文中没有匹配结果" : "找到\(result.count)处原文"
            } catch is CancellationError { return }
            catch {
                guard generation == current else { return }
                hits = []; message = "资料暂时无法搜索，请重试准备；仍可阅读"
            }
            tableView.reloadData()
        }
    }
    override func tableView(_ tableView: UITableView, titleForHeaderInSection section: Int) -> String? { state.message }
    override func tableView(_ tableView: UITableView, titleForFooterInSection section: Int) -> String? { message }
    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { hits.count }
    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let hit = hits[indexPath.row]
        let cell = UITableViewCell(style: .subtitle, reuseIdentifier: nil)
        cell.textLabel?.text = "\(hit.chapter) · \(indexPath.row + 1)"
        cell.detailTextLabel?.text = hit.context
        cell.textLabel?.font = .preferredFont(forTextStyle: .body)
        cell.detailTextLabel?.font = .preferredFont(forTextStyle: .body)
        for label in [cell.textLabel, cell.detailTextLabel] { label?.numberOfLines = 0; label?.adjustsFontForContentSizeCategory = true }
        cell.accessibilityIdentifier = "search-hit-" + hit.id
        cell.accessoryType = .disclosureIndicator
        return cell
    }
    override func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        let target = hits[indexPath.row].locator
        search.resignFirstResponder()
        dismiss(animated: true) { [navigate] in navigate(target) }
    }
}
