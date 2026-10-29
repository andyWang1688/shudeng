import UIKit
import ReadiumShared

/// 书内搜索：系统导航栏搜索框 + 系统列表与空态。
@MainActor
final class BookSearchController: UITableViewController, UISearchResultsUpdating {
    private let library: LibraryStore
    private let book: Book
    private let navigate: (Locator) -> Void
    private let searchController = UISearchController(searchResultsController: nil)
    private var hits: [BookSearchHit] = []
    private var query = ""
    private var status = "输入中英关键词，仅搜索当前书原文"
    private var searchFailed = false
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
        BookDesign.formTable(tableView)
        tableView.register(UITableViewCell.self, forCellReuseIdentifier: "search-hit")
        tableView.accessibilityIdentifier = "book-search-results"
        tableView.keyboardDismissMode = .onDrag
        searchController.obscuresBackgroundDuringPresentation = false
        searchController.hidesNavigationBarDuringPresentation = false
        searchController.searchResultsUpdater = self
        searchController.searchBar.placeholder = "当前书关键词"
        searchController.searchBar.accessibilityIdentifier = "book-search-query"
        searchController.searchBar.searchTextField.accessibilityIdentifier = "book-search-query"
        navigationItem.searchController = searchController
        navigationItem.hidesSearchBarWhenScrolling = false
        definesPresentationContext = true
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
    func updateSearchResults(for searchController: UISearchController) {
        let text = searchController.searchBar.text ?? ""
        guard text != query else { return }
        query = text
        runSearch()
    }
    private func runSearch() {
        task?.cancel()
        generation += 1
        let current = generation
        guard !query.isEmpty else {
            hits = []; searchFailed = false; status = "输入中英关键词，仅搜索当前书原文"
            tableView.reloadData(); updateEmptyState(); return
        }
        task = Task {
            do {
                try await Task.sleep(nanoseconds: 200_000_000)
                let result = try await library.preparation.index.search(bookID: book.id, query: query)
                guard !Task.isCancelled, generation == current else { return }
                hits = result
                searchFailed = false
                status = result.isEmpty ? "已准备原文中没有匹配结果" : "找到\(result.count)处原文"
            } catch is CancellationError { return }
            catch {
                guard generation == current else { return }
                hits = []; searchFailed = true; status = "资料暂时无法搜索，请重试准备；仍可阅读"
            }
            tableView.reloadData()
            updateEmptyState()
        }
    }
    private var emptyTitle: String { searchFailed ? "资料暂时无法搜索" : "已准备原文中没有匹配结果" }
    private var emptyDetail: String { state.message }
    private func updateEmptyState() {
        let empty = !query.isEmpty && hits.isEmpty
        if #available(iOS 17.0, *) {
            if empty {
                contentUnavailableConfiguration = BookContentUnavailable.configuration(
                    title: emptyTitle,
                    detail: emptyDetail,
                    symbol: searchFailed ? "exclamationmark.triangle" : "magnifyingglass",
                    actionTitle: "清空搜索",
                    action: { [weak self] in self?.clearSearch() }
                )
            } else {
                contentUnavailableConfiguration = nil
            }
        } else {
            tableView.backgroundView = empty ? fallbackEmptyView() : nil
        }
    }
    private func clearSearch() {
        task?.cancel()
        generation += 1
        searchController.searchBar.text = ""
        query = ""
        hits = []
        searchFailed = false
        status = "输入中英关键词，仅搜索当前书原文"
        tableView.reloadData()
        updateEmptyState()
    }
    /// iOS 16 回退：系统 content-unavailable 只能用于 iOS 17+，这里用纸墨令牌的简单空态。
    private func fallbackEmptyView() -> UIView {
        var action = UIButton.Configuration.plain()
        action.title = "清空搜索"
        action.baseForegroundColor = BookDesign.lampInk
        let button = UIButton(configuration: action)
        button.addAction(UIAction { [weak self] _ in self?.clearSearch() }, for: .touchUpInside)
        let title = BookDesign.label(emptyTitle, font: BookType.serif(22, weight: .semibold, style: .title3))
        title.textAlignment = .center
        let detail = BookDesign.label(emptyDetail, font: BookType.subhead, colour: BookDesign.ink2)
        detail.textAlignment = .center
        detail.numberOfLines = 0
        let stack = UIStackView(arrangedSubviews: [title, detail, button])
        stack.axis = .vertical
        stack.alignment = .center
        stack.spacing = 10
        stack.translatesAutoresizingMaskIntoConstraints = false
        let container = UIView()
        container.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.centerXAnchor.constraint(equalTo: container.centerXAnchor),
            stack.centerYAnchor.constraint(equalTo: container.centerYAnchor),
            stack.leadingAnchor.constraint(greaterThanOrEqualTo: container.leadingAnchor, constant: 24),
            stack.trailingAnchor.constraint(lessThanOrEqualTo: container.trailingAnchor, constant: -24)
        ])
        return container
    }
    override func tableView(_ tableView: UITableView, titleForHeaderInSection section: Int) -> String? {
        state.message
    }
    override func tableView(_ tableView: UITableView, titleForFooterInSection section: Int) -> String? {
        hits.isEmpty && !query.isEmpty ? nil : status
    }
    override func tableView(_ tableView: UITableView, willDisplayHeaderView view: UIView, forSection section: Int) {
        BookDesign.formHeaderFooter(view)
    }
    override func tableView(_ tableView: UITableView, willDisplayFooterView view: UIView, forSection section: Int) {
        BookDesign.formHeaderFooter(view)
    }
    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { hits.count }
    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let hit = hits[indexPath.row]
        let cell = tableView.dequeueReusableCell(withIdentifier: "search-hit", for: indexPath)
        var content = UIListContentConfiguration.subtitleCell()
        content.text = "\(hit.chapter) · \(indexPath.row + 1)"
        content.textProperties.font = BookType.body
        content.textProperties.color = BookDesign.ink
        content.textProperties.numberOfLines = 0
        content.secondaryText = hit.context
        content.secondaryTextProperties.font = BookType.footnote
        content.secondaryTextProperties.color = BookDesign.ink2
        content.secondaryTextProperties.numberOfLines = 0
        cell.contentConfiguration = content
        cell.accessoryType = .disclosureIndicator
        cell.accessibilityIdentifier = "search-hit-" + hit.id
        return cell
    }
    override func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true)
        let target = hits[indexPath.row].locator
        searchController.isActive = false
        dismiss(animated: true) { [navigate] in navigate(target) }
    }
}
