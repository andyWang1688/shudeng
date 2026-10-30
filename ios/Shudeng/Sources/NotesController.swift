import UIKit
import ReadiumShared

/// 合并后的笔记记录：高亮（正文为空）与笔记（有正文）统一展示；书签不再进入本页。
private struct NoteRecord {
    let note: BookNote

    var id: UUID { note.id }
    var quote: String { note.quote }
    var body: String { note.body }
    var chapter: String { (try? note.location().title) ?? "阅读位置" }
    /// PDF 页级标注的页码（BookNote.pdf 几何优先，其次 locator.position）。
    var pdfPage: Int? {
        if let page = note.pdf?.page { return page }
        return (try? note.location())?.locations.position
    }
    var hasBody: Bool { !note.body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    var accessibilityIdentifier: String { "annotation-\(note.id.uuidString)" }

    func location() throws -> Locator { try note.location() }
}


/// Independent presentation preferences for each grouped list, scoped to its library.
@MainActor
final class BookGroupListState {
    private struct Snapshot: Codable {
        var expanded: [String: Bool] = [:]
        var offsetY: Double = 0
    }

    private let file: URL
    private var snapshot: Snapshot?
    private var restoredScroll = false

    init(root: URL, page: String) {
        file = root.appendingPathComponent("\(page)-book-groups.json")
        snapshot = (try? Data(contentsOf: file)).flatMap { try? JSONDecoder().decode(Snapshot.self, from: $0) }
    }

    func initialize(latestBookID: String?) {
        guard snapshot == nil, let latestBookID else { return }
        snapshot = Snapshot(expanded: [latestBookID: true])
        save()
    }

    func isExpanded(_ bookID: String, searching: Bool = false) -> Bool {
        searching || snapshot?.expanded[bookID] == true
    }

    func setExpanded(_ expanded: Bool, for bookID: String) {
        if snapshot == nil { snapshot = Snapshot() }
        guard snapshot?.expanded[bookID] != expanded else { return }
        snapshot?.expanded[bookID] = expanded
        save()
    }

    func restoreScroll(in scrollView: UIScrollView) {
        guard !restoredScroll, scrollView.bounds.height > 0 else { return }
        restoredScroll = true
        scrollView.layoutIfNeeded()
        setOffset(CGFloat(snapshot?.offsetY ?? 0), in: scrollView)
    }

    func rememberScroll(in scrollView: UIScrollView) {
        guard restoredScroll, snapshot != nil else { return }
        snapshot?.offsetY = Double(scrollView.contentOffset.y)
        save()
    }

    private func setOffset(_ y: CGFloat, in scrollView: UIScrollView) {
        let minimum = -scrollView.adjustedContentInset.top
        let maximum = max(minimum, scrollView.contentSize.height - scrollView.bounds.height + scrollView.adjustedContentInset.bottom)
        scrollView.setContentOffset(CGPoint(x: 0, y: min(maximum, max(minimum, y))), animated: false)
    }

    private func save() {
        guard let snapshot, let data = try? JSONEncoder().encode(snapshot) else { return }
        try? data.write(to: file, options: .atomic)
    }
}

@MainActor
final class NotesController: UIViewController, UICollectionViewDelegate, UISearchControllerDelegate, UISearchResultsUpdating {
    private enum SectionID: Hashable { case book(String) }
    private enum ItemID: Hashable {
        case header(String)
        case record(UUID)
    }

    private let library: LibraryStore
    private let covers = BookCoverStore()
    private let thumbnails = BookThumbnailStore()
    private let groupState: BookGroupListState
    private let searchController = UISearchController(searchResultsController: nil)
    private var offsetBeforeSearch: CGPoint?
    private var query = ""
    private var sections: [(book: Book, records: [NoteRecord])] = []
    private var appliedSectionIDs: [SectionID] = []
    private var libraryObserver: NSObjectProtocol?
    private(set) var collectionView: UICollectionView!
    private lazy var dataSource = makeDataSource()
    private lazy var headerRegistration = UICollectionView.CellRegistration<UICollectionViewListCell, ItemID> {
        [weak self] cell, _, item in
        guard let self, case let .header(bookID) = item else { return }
        self.configure(header: cell, bookID: bookID)
    }
    private lazy var recordRegistration = UICollectionView.CellRegistration<UICollectionViewListCell, ItemID> {
        [weak self] cell, indexPath, item in
        guard let self, case let .record(recordID) = item else { return }
        self.configure(record: cell, indexPath: indexPath, recordID: recordID)
    }

    init(library: LibraryStore) {
        self.library = library
        groupState = BookGroupListState(root: library.root, page: "notes")
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    deinit {
        if let libraryObserver { NotificationCenter.default.removeObserver(libraryObserver) }
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "笔记"
        view.backgroundColor = BookDesign.paper
        view.accessibilityIdentifier = "notes-surface"

        navigationItem.largeTitleDisplayMode = .always
        BookDesign.applyListPageNavigationAppearance(to: navigationItem)
        let export = UIBarButtonItem(
            image: BookDesign.symbol("square.and.arrow.up", size: 17, weight: .medium),
            style: .plain,
            target: self,
            action: #selector(exportNotes)
        )
        export.accessibilityLabel = "导出笔记"
        export.accessibilityIdentifier = "notes-export"
        export.tintColor = BookDesign.ink2
        navigationItem.rightBarButtonItem = export

        searchController.searchResultsUpdater = self
        searchController.delegate = self
        searchController.obscuresBackgroundDuringPresentation = false
        searchController.searchBar.placeholder = "搜索笔记"
        searchController.searchBar.searchTextField.accessibilityIdentifier = "notes-search"
        searchController.searchBar.searchTextField.font = BookType.body
        searchController.searchBar.tintColor = BookDesign.lamp
        navigationItem.searchController = searchController
        navigationItem.hidesSearchBarWhenScrolling = false
        if #available(iOS 16.0, *) {
            // iOS 26 默认把搜索栏放到底部 integrated 位置；固定为 stacked，保持搜索在标题下方。
            navigationItem.preferredSearchBarPlacement = .stacked
        }
        definesPresentationContext = true

        configureCollectionView()
        installCollectionView()
        registerForDynamicTypeChanges()

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
        navigationController?.setNavigationBarHidden(false, animated: false)
        navigationController?.navigationBar.prefersLargeTitles = true
        refresh()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        groupState.restoreScroll(in: collectionView)
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        rememberScroll()
    }

    func scrollViewDidEndDragging(_ scrollView: UIScrollView, willDecelerate decelerate: Bool) {
        if !decelerate { rememberScroll() }
    }

    func scrollViewDidEndDecelerating(_ scrollView: UIScrollView) {
        rememberScroll()
    }

    private var searching: Bool {
        !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private func rememberScroll() {
        if !searching { groupState.rememberScroll(in: collectionView) }
    }

    private func configureCollectionView() {
        var configuration = UICollectionLayoutListConfiguration(appearance: .insetGrouped)
        configuration.headerMode = .firstItemInSection
        configuration.headerTopPadding = 12
        configuration.showsSeparators = true
        configuration.backgroundColor = BookDesign.paper
        configuration.separatorConfiguration.color = BookDesign.line
        configuration.trailingSwipeActionsConfigurationProvider = { [weak self] indexPath in
            self?.trailingSwipeActions(at: indexPath)
        }
        configuration.leadingSwipeActionsConfigurationProvider = { [weak self] indexPath in
            self?.leadingSwipeActions(at: indexPath)
        }
        let layout = UICollectionViewCompositionalLayout.list(using: configuration)

        let collectionView = UICollectionView(frame: .zero, collectionViewLayout: layout)
        collectionView.backgroundColor = BookDesign.paper
        collectionView.keyboardDismissMode = .onDrag
        collectionView.contentInset = UIEdgeInsets(top: 0, left: 0, bottom: 24, right: 0)
        collectionView.accessibilityIdentifier = "notes"
        collectionView.delegate = self
        self.collectionView = collectionView
        // UIKit 禁止在 cell provider 内首次创建 CellRegistration；在设置 dataSource 前先求值。
        _ = headerRegistration
        _ = recordRegistration
        collectionView.dataSource = dataSource
    }

    private func installCollectionView() {
        collectionView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(collectionView)
        NSLayoutConstraint.activate([
            collectionView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            collectionView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            collectionView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            collectionView.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])
    }

    private func makeDataSource() -> UICollectionViewDiffableDataSource<SectionID, ItemID> {
        let dataSource = UICollectionViewDiffableDataSource<SectionID, ItemID>(collectionView: collectionView) {
            [weak self] collectionView, indexPath, item in
            guard let self else { return nil }
            switch item {
            case .header:
                return collectionView.dequeueConfiguredReusableCell(
                    using: self.headerRegistration,
                    for: indexPath,
                    item: item
                )
            case .record:
                return collectionView.dequeueConfiguredReusableCell(
                    using: self.recordRegistration,
                    for: indexPath,
                    item: item
                )
            }
        }
        return dataSource
    }

    private func registerForDynamicTypeChanges() {
        if #available(iOS 17.0, *) {
            registerForTraitChanges([UITraitPreferredContentSizeCategory.self]) {
                (self: NotesController, _: UITraitCollection) in
                self.reconfigureListFonts()
            }
        }
    }

    override func traitCollectionDidChange(_ previousTraitCollection: UITraitCollection?) {
        super.traitCollectionDidChange(previousTraitCollection)
        guard #unavailable(iOS 17.0) else { return }
        if previousTraitCollection?.preferredContentSizeCategory != traitCollection.preferredContentSizeCategory {
            reconfigureListFonts()
        }
    }

    /// 字号变化后重配可见 cell：BookType 字体是一次性 UIFontMetrics 缩放的，不随 Dynamic Type 自动更新。
    private func reconfigureListFonts() {
        for cell in collectionView.visibleCells {
            guard let listCell = cell as? UICollectionViewListCell,
                  let indexPath = collectionView.indexPath(for: cell),
                  let item = dataSource.itemIdentifier(for: indexPath) else { continue }
            switch item {
            case let .header(bookID):
                configure(header: listCell, bookID: bookID)
            case let .record(recordID):
                configure(record: listCell, indexPath: indexPath, recordID: recordID)
            }
        }
    }

    // MARK: - UISearchControllerDelegate（iOS 26 取消搜索后大标题不绘制的恢复）

    func willPresentSearchController(_ searchController: UISearchController) {
        offsetBeforeSearch = collectionView.contentOffset
    }

    func didDismissSearchController(_ searchController: UISearchController) {
        guard let before = offsetBeforeSearch else { return }
        offsetBeforeSearch = nil
        collectionView.setContentOffset(before, animated: false)
        guard #available(iOS 26.0, *) else { return }
        let top = -collectionView.adjustedContentInset.top
        guard abs(before.y - top) < 1 else { return }
        // iOS 26（stacked 搜索 + 系统大标题）：取消搜索后导航栏高度已恢复大标题布局，
        // 但大标题的 scroll-edge 进度可能停在搜索态（label 存在、屏幕却不绘制）。
        // 同 runloop 内改 offset 会被合并、不产生真实 scroll 事件；推迟到后续 runloop
        // 做两段 offset 变化（+1pt → 回位），复刻一次真实滚动让导航栏重算大标题进度。
        // 位移仅 1pt，不可见，也不改变用户原有的滚动位置。
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { [weak self] in
            guard let self else { return }
            self.collectionView.setContentOffset(CGPoint(x: before.x, y: top + 1), animated: false)
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { [weak self] in
                guard let self else { return }
                self.collectionView.setContentOffset(before, animated: false)
                self.navigationController?.navigationBar.setNeedsLayout()
                self.navigationController?.navigationBar.layoutIfNeeded()
            }
        }
    }

    func updateSearchResults(for searchController: UISearchController) {
        let text = searchController.searchBar.text ?? ""
        guard text != query else { return }
        rememberScroll()
        query = text
        refresh()
    }

    /// 供单元测试与程序化展开／收起：与分组头轻点走同一路径。
    func toggleGroup(bookID: String) {
        guard !searching else { return }
        let sectionID = SectionID.book(bookID)
        let header = ItemID.header(bookID)
        var snapshot = dataSource.snapshot(for: sectionID)
        guard snapshot.contains(header) else { return }
        let wasExpanded = snapshot.isExpanded(header)
        if wasExpanded {
            snapshot.collapse([header])
        } else {
            snapshot.expand([header])
        }
        groupState.setExpanded(!wasExpanded, for: bookID)
        dataSource.apply(snapshot, to: sectionID, animatingDifferences: !UIAccessibility.isReduceMotionEnabled) {
            [weak self] in
            self?.updateHeaderAccessibility(bookID: bookID)
            self?.rememberScroll()
        }
    }

    private func updateHeaderAccessibility(bookID: String) {
        guard let indexPath = dataSource.indexPath(for: ItemID.header(bookID)),
              let cell = collectionView.cellForItem(at: indexPath) as? UICollectionViewListCell else { return }
        cell.accessibilityValue = groupState.isExpanded(bookID, searching: searching) ? "已展开" : "已收起"
    }

    private func refresh(animated: Bool = false) {
        let all = library.books.filter { $0.removal == nil }.compactMap { book -> (book: Book, records: [NoteRecord])? in
            let records = records(for: book)
            return records.isEmpty ? nil : (book, records)
        }
        let latest = all.max { latestTimestamp(in: $0) < latestTimestamp(in: $1) }
        groupState.initialize(latestBookID: latest?.book.id)
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines)
        sections = all.compactMap { section in
            var records = section.records
            if !needle.isEmpty {
                records = records.filter { record in
                    [section.book.title, record.quote, record.body, record.chapter]
                        .joined(separator: "\n").localizedCaseInsensitiveContains(needle)
                }
            }
            guard !records.isEmpty else { return nil }
            records.sort { lhs, rhs in
                let left = documentOrder(lhs)
                let right = documentOrder(rhs)
                if left.0 != right.0 { return left.0 < right.0 }
                if left.1 != right.1 { return left.1 < right.1 }
                return lhs.id.uuidString < rhs.id.uuidString
            }
            return (section.book, records)
        }
        applySnapshots(animated: animated)
        updateEmptyState()
    }

    /// 组内按阅读位置排序：优先总进度/进度，其次 Readium position，最后按 id 稳定排序。
    private func documentOrder(_ record: NoteRecord) -> (Double, Int) {
        guard let locator = try? record.location() else { return (1, 0) }
        let progression = locator.locations.totalProgression ?? locator.locations.progression ?? 0
        return (progression, locator.locations.position ?? 0)
    }

    private func applySnapshots(animated: Bool) {
        let sectionIDs = sections.map { SectionID.book($0.book.id) }
        if sectionIDs != appliedSectionIDs {
            var snapshot = NSDiffableDataSourceSnapshot<SectionID, ItemID>()
            snapshot.appendSections(sectionIDs)
            dataSource.apply(snapshot, animatingDifferences: animated)
            appliedSectionIDs = sectionIDs
        }
        for (index, section) in sections.enumerated() {
            let header = ItemID.header(section.book.id)
            var snapshot = NSDiffableDataSourceSectionSnapshot<ItemID>()
            snapshot.append([header])
            snapshot.append(section.records.map { ItemID.record($0.id) }, to: header)
            if groupState.isExpanded(section.book.id, searching: searching) {
                snapshot.expand([header])
            }
            dataSource.apply(snapshot, to: sectionIDs[index], animatingDifferences: animated)
        }
    }

    private func latestTimestamp(in section: (book: Book, records: [NoteRecord])) -> Date {
        section.records.compactMap { record in
            library.recordTimestamp(kind: .note, bookID: section.book.id, recordID: record.id)
        }.max() ?? .distantPast
    }

    private func records(for book: Book) -> [NoteRecord] {
        (book.notes ?? []).map { NoteRecord(note: $0) }
    }

    private func updateEmptyState() {
        guard sections.isEmpty else {
            collectionView.backgroundView = nil
            if #available(iOS 17.0, *) { contentUnavailableConfiguration = nil }
            return
        }
        let title = searching ? "没有找到相关笔记" : "还没有笔记"
        let detail = searching
            ? "换一个关键词，或清除搜索后再看。"
            : "阅读时选中原文，画下高亮或写下想法，之后会出现在这里。"
        let actionTitle = searching ? "清除搜索" : "去书架读书"
        let action: () -> Void = { [weak self] in self?.emptyAction() }
        if #available(iOS 17.0, *) {
            contentUnavailableConfiguration = BookContentUnavailable.configuration(
                title: title,
                detail: detail,
                symbol: "square.and.pencil",
                actionTitle: actionTitle,
                action: action
            )
        } else {
            let empty = NotesEmptyView(title: title, detail: detail, actionTitle: actionTitle)
            empty.onAction = action
            collectionView.backgroundView = empty
        }
    }

    private func emptyAction() {
        if searching {
            query = ""
            searchController.searchBar.text = ""
            refresh(animated: !UIAccessibility.isReduceMotionEnabled)
        } else {
            rootTabs?.select(RootDestination.library.rawValue)
        }
    }

    private var rootTabs: RootTabController? {
        var current = parent
        while let controller = current {
            if let tabs = controller as? RootTabController { return tabs }
            current = controller.parent
        }
        return nil
    }

    /// PDF 笔记显示页号（「第 N 页」），EPUB 继续使用 locator 章节标题。
    private func chapterText(for record: NoteRecord, book: Book) -> String {
        if book.resolvedFormat == .pdf, let page = record.pdfPage {
            return "第 \(page) 页"
        }
        return record.chapter.isEmpty ? "阅读位置" : record.chapter
    }

    private func configure(header cell: UICollectionViewListCell, bookID: String) {
        guard let section = sections.first(where: { $0.book.id == bookID }) else { return }
        let countText = "\(section.records.count) 条笔记"
        cell.contentConfiguration = BookDesign.listGroupHeaderContent(
            title: section.book.title,
            countText: countText,
            image: thumbnails.placeholder(for: section.book.title)
        )
        let expanded = groupState.isExpanded(bookID, searching: searching)
        cell.accessories = [.outlineDisclosure(
            options: UICellAccessory.OutlineDisclosureOptions(style: .header),
            actionHandler: { [weak self] in self?.toggleGroup(bookID: bookID) }
        )]
        cell.accessibilityIdentifier = "notes-book-\(bookID)"
        cell.accessibilityLabel = "\(section.book.title)，\(countText)"
        cell.accessibilityValue = expanded ? "已展开" : "已收起"
        cell.accessibilityTraits = [.header, .button]
        cell.accessibilityHint = searching ? "搜索期间自动展开匹配笔记" : "轻点展开或收起本书的笔记"
        loadCover(of: section.book, into: cell)
    }

    private func loadCover(of book: Book, into cell: UICollectionViewListCell) {
        let bookID = book.id
        Task { [weak self, weak cell] in
            guard let self, let cell else { return }
            let image = await self.thumbnails.image(for: book, covers: self.covers, library: self.library)
            guard cell.accessibilityIdentifier == "notes-book-\(bookID)",
                  var content = cell.contentConfiguration as? UIListContentConfiguration else { return }
            content.image = image
            cell.contentConfiguration = content
        }
    }

    private func configure(record cell: UICollectionViewListCell, indexPath: IndexPath, recordID: UUID) {
        guard sections.indices.contains(indexPath.section),
              let record = sections[indexPath.section].records.first(where: { $0.id == recordID }) else { return }
        let book = sections[indexPath.section].book
        let timestamp = library.recordTimestamp(kind: .note, bookID: book.id, recordID: record.id)
        let chapter = chapterText(for: record, book: book)
        let dateText = timestamp.map(BookDateFormat.recordTime) ?? "时间未记录"
        cell.contentConfiguration = NotesRowContentConfiguration(
            quote: record.quote,
            body: record.body.trimmingCharacters(in: .whitespacesAndNewlines),
            chapter: chapter,
            dateText: dateText,
            tint: record.hasBody ? BookDesign.lamp : record.note.highlightColor.tint
        )
        cell.isAccessibilityElement = true
        cell.accessibilityIdentifier = record.accessibilityIdentifier
        cell.accessibilityLabel = [chapter, record.quote, record.body, dateText]
            .filter { !$0.isEmpty }
            .joined(separator: "，")
        cell.accessibilityTraits = .button
        cell.accessibilityHint = "轻点回到原文；左滑编辑，右滑删除"
    }

    private func record(at indexPath: IndexPath) -> (book: Book, record: NoteRecord)? {
        guard sections.indices.contains(indexPath.section) else { return nil }
        let section = sections[indexPath.section]
        guard let item = dataSource.itemIdentifier(for: indexPath), case let .record(recordID) = item,
              let record = section.records.first(where: { $0.id == recordID }) else { return nil }
        return (section.book, record)
    }

    private func trailingSwipeActions(at indexPath: IndexPath) -> UISwipeActionsConfiguration? {
        guard let target = record(at: indexPath) else { return nil }
        let delete = UIContextualAction(style: .destructive, title: "删除") { [weak self] _, _, done in
            done(false)
            self?.confirmDelete(book: target.book, record: target.record)
        }
        let configuration = UISwipeActionsConfiguration(actions: [delete])
        configuration.performsFirstActionWithFullSwipe = false
        return configuration
    }

    private func leadingSwipeActions(at indexPath: IndexPath) -> UISwipeActionsConfiguration? {
        guard let target = record(at: indexPath), target.record.hasBody else { return nil }
        let edit = UIContextualAction(style: .normal, title: "编辑") { [weak self] _, _, done in
            done(false)
            self?.presentEditor(book: target.book, record: target.record)
        }
        let configuration = UISwipeActionsConfiguration(actions: [edit])
        configuration.performsFirstActionWithFullSwipe = false
        return configuration
    }

    /// 供单元测试验证滑动操作；与列表 layout provider 同一实现。
    func trailingSwipeActions(for annotationID: UUID) -> UISwipeActionsConfiguration? {
        guard let indexPath = dataSource.indexPath(for: ItemID.record(annotationID)) else { return nil }
        return trailingSwipeActions(at: indexPath)
    }

    /// 供单元测试验证滑动操作；仅带正文的笔记返回 leading 编辑。
    func leadingSwipeActions(for annotationID: UUID) -> UISwipeActionsConfiguration? {
        guard let indexPath = dataSource.indexPath(for: ItemID.record(annotationID)) else { return nil }
        return leadingSwipeActions(at: indexPath)
    }

    private func confirmDelete(book: Book, record: NoteRecord) {
        let alert = BookAlertController(
            title: "删除笔记？",
            message: "删除后无法恢复；原文中的高亮与笔记也会移除。",
            preferredStyle: .alert
        )
        alert.addAction(BookAlertAction(title: "取消", style: .cancel))
        alert.addAction(BookAlertAction(title: "删除", style: .destructive) { [weak self] _ in
            guard let self else { return }
            do {
                try self.library.removeNote(record.id, bookID: book.id)
                self.refresh(animated: !UIAccessibility.isReduceMotionEnabled)
            } catch {
                self.showFailure("删除失败，笔记仍保留；请重试。")
            }
        })
        present(alert, animated: true)
    }

    private func presentEditor(book: Book, record: NoteRecord) {
        let editor = NoteEditorController(
            library: library,
            bookID: book.id,
            note: record.note,
            changed: { [weak self] in self?.refresh() }
        )
        present(editor, animated: false)
    }

    private func showFailure(_ message: String) {
        let alert = BookAlertController(title: "操作未保存", message: message, preferredStyle: .alert)
        alert.addAction(BookAlertAction(title: "知道了", style: .default))
        present(alert, animated: true)
    }

    func collectionView(_ collectionView: UICollectionView, didSelectItemAt indexPath: IndexPath) {
        collectionView.deselectItem(at: indexPath, animated: true)
        guard let target = record(at: indexPath) else { return }
        open(target.book, record: target.record)
    }

    private func open(_ book: Book, record: NoteRecord) {
        if book.resolvedFormat == .pdf {
            openPDF(book, record: record)
            return
        }
        Task {
            do {
                let locator = try record.location()
                let publication = try await library.open(book)
                let current = library.books.first { $0.id == book.id } ?? book
                let reader = try ReaderController(
                    book: current,
                    publication: publication,
                    library: library,
                    target: locator
                )
                reader.modalPresentationStyle = .fullScreen
                present(reader, animated: true)
            } catch {
                let alert = BookAlertController(
                    title: "无法返回原文",
                    message: error.localizedDescription,
                    preferredStyle: .alert
                )
                alert.addAction(BookAlertAction(title: "知道了", style: .default))
                present(alert, animated: true)
            }
        }
    }

    /// PDF 笔记：把笔记 locator 作为 target 直接交给 PDFReaderController（由其恢复进度时跳到第 N 页）。
    /// 不再预写 saveReadingState，打开失败不会改动原阅读进度。
    private func openPDF(_ book: Book, record: NoteRecord) {
        Task {
            do {
                let locator = try record.location()
                let current = library.books.first { $0.id == book.id } ?? book
                let reader = try PDFReaderController(book: current, library: library, target: locator)
                reader.modalPresentationStyle = .fullScreen
                present(reader, animated: true)
            } catch {
                let alert = BookAlertController(
                    title: "无法返回原文",
                    message: error.localizedDescription,
                    preferredStyle: .alert
                )
                alert.addAction(BookAlertAction(title: "知道了", style: .default))
                present(alert, animated: true)
            }
        }
    }

    @objc private func exportNotes() {
        let lines = sections.flatMap { section in
            section.records.map { record in
                var values = ["《\(section.book.title)》", chapterText(for: record, book: section.book)]
                if !record.quote.isEmpty { values.append("原文：\(record.quote)") }
                if !record.body.isEmpty { values.append("想法：\(record.body)") }
                return values.joined(separator: "\n")
            }
        }
        guard !lines.isEmpty else {
            let alert = BookAlertController(
                title: "还没有可导出的笔记",
                message: "阅读时选中原文，写下高亮或笔记后再导出。",
                preferredStyle: .alert
            )
            alert.addAction(BookAlertAction(title: "知道了", style: .default))
            present(alert, animated: true)
            return
        }
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyyMMdd"
        let file = FileManager.default.temporaryDirectory
            .appendingPathComponent("书灯笔记-\(formatter.string(from: Date())).txt")
        do {
            try lines.joined(separator: "\n\n").appending("\n").write(to: file, atomically: true, encoding: .utf8)
            let share = UIActivityViewController(activityItems: [file], applicationActivities: nil)
            share.popoverPresentationController?.barButtonItem = navigationItem.rightBarButtonItem
            present(share, animated: true)
        } catch {
            let alert = BookAlertController(
                title: "无法导出",
                message: "笔记仍保存在本机，请检查储存空间后重试。",
                preferredStyle: .alert
            )
            alert.addAction(BookAlertAction(title: "知道了", style: .default))
            present(alert, animated: true)
        }
    }
}

/// 笔记行内容配置：颜色点 + 章节 + 右侧日期、引文、正文（缩进 + 2pt 左侧细线）。
private struct NotesRowContentConfiguration: UIContentConfiguration, Hashable {
    var quote: String = ""
    var body: String = ""
    var chapter: String = ""
    var dateText: String = ""
    var tint: UIColor = BookDesign.lamp

    func makeContentView() -> UIView & UIContentView {
        NotesRowContentView(self)
    }

    func updated(for state: UIConfigurationState) -> NotesRowContentConfiguration { self }
}

private final class NotesRowContentView: UIView, UIContentView {
    private let dot = UIView()
    private let chapterLabel = UILabel()
    private let dateLabel = UILabel()
    private let quoteLabel = UILabel()
    private let bodyLabel = UILabel()
    private let rule = UIView()
    private let bodyRow = UIStackView()
    private var appliedConfiguration: NotesRowContentConfiguration?

    var configuration: UIContentConfiguration {
        get { appliedConfiguration ?? NotesRowContentConfiguration() }
        set {
            guard let value = newValue as? NotesRowContentConfiguration else { return }
            apply(value)
        }
    }

    init(_ configuration: NotesRowContentConfiguration) {
        super.init(frame: .zero)
        build()
        apply(configuration)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    private func build() {
        directionalLayoutMargins = NSDirectionalEdgeInsets(top: 10, leading: 16, bottom: 10, trailing: 16)

        dot.translatesAutoresizingMaskIntoConstraints = false
        dot.layer.cornerRadius = 4
        dot.setContentHuggingPriority(.required, for: .horizontal)
        dot.widthAnchor.constraint(equalToConstant: 8).isActive = true
        dot.heightAnchor.constraint(equalToConstant: 8).isActive = true

        chapterLabel.font = BookType.caption
        chapterLabel.textColor = BookDesign.ink3
        chapterLabel.numberOfLines = 1
        chapterLabel.lineBreakMode = .byTruncatingTail
        chapterLabel.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)

        dateLabel.font = BookType.caption
        dateLabel.textColor = BookDesign.ink3
        dateLabel.textAlignment = .right
        dateLabel.setContentHuggingPriority(.required, for: .horizontal)
        dateLabel.setContentCompressionResistancePriority(.required, for: .horizontal)

        quoteLabel.numberOfLines = 4
        quoteLabel.lineBreakMode = .byTruncatingTail

        bodyLabel.font = BookType.sans(13, weight: .regular, style: .footnote)
        bodyLabel.textColor = BookDesign.ink2
        bodyLabel.numberOfLines = 3
        bodyLabel.lineBreakMode = .byTruncatingTail

        rule.backgroundColor = BookDesign.line
        rule.translatesAutoresizingMaskIntoConstraints = false
        rule.widthAnchor.constraint(equalToConstant: 2).isActive = true

        bodyRow.axis = .horizontal
        bodyRow.spacing = 6
        bodyRow.alignment = .fill
        bodyRow.addArrangedSubview(rule)
        bodyRow.addArrangedSubview(bodyLabel)

        let metaRow = UIStackView(arrangedSubviews: [dot, chapterLabel, UIView(), dateLabel])
        metaRow.axis = .horizontal
        metaRow.alignment = .center
        metaRow.spacing = 8

        let stack = UIStackView(arrangedSubviews: [metaRow, quoteLabel, bodyRow])
        stack.axis = .vertical
        stack.spacing = 6
        stack.setCustomSpacing(8, after: metaRow)
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: layoutMarginsGuide.topAnchor),
            stack.leadingAnchor.constraint(equalTo: layoutMarginsGuide.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: layoutMarginsGuide.trailingAnchor),
            stack.bottomAnchor.constraint(equalTo: layoutMarginsGuide.bottomAnchor)
        ])
    }

    private func apply(_ configuration: NotesRowContentConfiguration) {
        appliedConfiguration = configuration
        chapterLabel.text = configuration.chapter
        dateLabel.text = configuration.dateText
        quoteLabel.attributedText = Self.quoteText(configuration.quote)
        bodyLabel.text = configuration.body
        bodyRow.isHidden = configuration.body.isEmpty
        dot.backgroundColor = configuration.tint
    }

    private static func quoteText(_ quote: String) -> NSAttributedString {
        let style = NSMutableParagraphStyle()
        style.lineHeightMultiple = 1.45
        style.lineBreakMode = .byTruncatingTail
        return NSAttributedString(
            string: "“" + quote + "”",
            attributes: [
                .font: BookType.serif(15, weight: .regular, style: .body),
                .foregroundColor: BookDesign.ink,
                .paragraphStyle: style
            ]
        )
    }
}

@MainActor
private final class NotesEmptyView: UIView {
    var onAction: (() -> Void)?
    private let action = UIButton(type: .system)

    init(title: String, detail: String, actionTitle: String) {
        super.init(frame: .zero)
        accessibilityIdentifier = "notes-empty"
        backgroundColor = BookDesign.paper
        let icon = UIImageView(image: BookDesign.symbol("square.and.pencil", size: 47, weight: .light))
        icon.tintColor = BookDesign.secondary
        icon.contentMode = .scaleAspectFit
        icon.alpha = 0.55
        icon.widthAnchor.constraint(equalToConstant: 47).isActive = true
        icon.heightAnchor.constraint(equalToConstant: 47).isActive = true

        let heading = BookDesign.label(title, size: 24, style: .title2)
        heading.font = BookDesign.readingFont(24)
        heading.textAlignment = .center
        heading.accessibilityIdentifier = "notes-empty-title"
        let description = BookDesign.label(detail, size: 13, colour: BookDesign.secondary)
        description.textAlignment = .center
        description.accessibilityIdentifier = "notes-empty-detail"

        var configuration = UIButton.Configuration.filled()
        configuration.title = actionTitle
        configuration.baseForegroundColor = BookDesign.paper
        configuration.baseBackgroundColor = BookDesign.ink
        configuration.cornerStyle = .capsule
        configuration.contentInsets = NSDirectionalEdgeInsets(top: 11, leading: 22, bottom: 11, trailing: 22)
        action.configuration = configuration
        action.accessibilityIdentifier = "notes-empty-action"
        action.addAction(UIAction { [weak self] _ in self?.onAction?() }, for: .touchUpInside)

        let stack = UIStackView(arrangedSubviews: [icon, heading, description, action])
        stack.axis = .vertical
        stack.alignment = .center
        stack.spacing = 13
        stack.setCustomSpacing(20, after: description)
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(stack)
        NSLayoutConstraint.activate([
            stack.centerXAnchor.constraint(equalTo: centerXAnchor),
            stack.centerYAnchor.constraint(equalTo: centerYAnchor, constant: -52),
            stack.leadingAnchor.constraint(greaterThanOrEqualTo: leadingAnchor, constant: 28),
            stack.trailingAnchor.constraint(lessThanOrEqualTo: trailingAnchor, constant: -28),
            stack.widthAnchor.constraint(lessThanOrEqualToConstant: 260)
        ])
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }
}

@MainActor
final class NoteEditorController: UIViewController, UITextViewDelegate {
    private let library: LibraryStore
    private let bookID: String
    private let bookRevision: UUID
    private var note: BookNote
    private let changed: () -> Void
    private let returnToText: (() -> Void)?
    private let body = UITextView()
    private let placeholder = BookDesign.label("写点什么…", size: 15, colour: BookDesign.ink3)
    private let saveButton = UIButton(type: .system)
    private let deleteButton = UIButton(type: .system)
    private let isEditingSavedNote: Bool
    private let dim = UIView()
    private let card = UIView()
    private let dragArea = UIView()
    private let grabber = UIView()
    private let scroll = UIScrollView()

    private var cardHeight: NSLayoutConstraint!
    private var cardBottom: NSLayoutConstraint!
    private var heightRatio: CGFloat = 0.54
    private var dragStartHeight: CGFloat = 0
    private var isDraggingCard = false
    private var isDismissingCard = false
    private var didAnimateIn = false
    private var keyboardOverlap: CGFloat = 0

    private static let initialRatio: CGFloat = 0.54
    private static let minRatio: CGFloat = 0.44
    private static let maxRatio: CGFloat = 0.92

    init(library: LibraryStore, bookID: String, note: BookNote, changed: @escaping () -> Void, returnToText: (() -> Void)? = nil) {
        self.library = library
        self.bookID = bookID
        self.changed = changed
        self.returnToText = returnToText
        bookRevision = library.revision(for: bookID)
        self.note = note
        isEditingSavedNote = (library.books.first { $0.id == bookID }?.notes ?? []).contains { $0.id == note.id }
        super.init(nibName: nil, bundle: nil)
        modalPresentationStyle = .overFullScreen
        modalTransitionStyle = .crossDissolve
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    deinit { NotificationCenter.default.removeObserver(self) }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .clear
        view.accessibilityViewIsModal = true
        navigationController?.setNavigationBarHidden(true, animated: false)

        dim.backgroundColor = UIColor.black.withAlphaComponent(0.25)
        dim.alpha = 0
        // 嵌入系统 sheet（阅读器编辑入口）时由系统负责背景遮罩，避免二次压暗。
        dim.isHidden = navigationController != nil
        dim.translatesAutoresizingMaskIntoConstraints = false
        dim.addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(dismissTapped)))
        view.addSubview(dim)

        card.backgroundColor = BookDesign.paper
        card.layer.cornerRadius = BookRadius.sheet
        card.layer.maskedCorners = [.layerMinXMinYCorner, .layerMaxXMinYCorner]
        card.clipsToBounds = true
        card.accessibilityIdentifier = "note-editor-card"
        card.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(card)

        grabber.backgroundColor = BookDesign.ink3.withAlphaComponent(0.35)
        grabber.layer.cornerRadius = 2
        grabber.translatesAutoresizingMaskIntoConstraints = false
        dragArea.translatesAutoresizingMaskIntoConstraints = false
        dragArea.addSubview(grabber)
        dragArea.addGestureRecognizer(UIPanGestureRecognizer(target: self, action: #selector(handleCardDrag(_:))))

        let close = CircularIconButton(symbol: "xmark", label: "关闭", style: .ghost, identifier: "note-close")
        close.addAction(UIAction { [weak self] _ in self?.closeTapped() }, for: .touchUpInside)

        let titleLabel = BookDesign.label("笔记", font: BookType.serif(17, weight: .semibold, style: .headline), colour: BookDesign.ink)
        titleLabel.numberOfLines = 1
        titleLabel.setContentCompressionResistancePriority(.required, for: .horizontal)

        var saveConfiguration = UIButton.Configuration.filled()
        saveConfiguration.title = "保存笔记"
        saveConfiguration.cornerStyle = .capsule
        saveConfiguration.contentInsets = NSDirectionalEdgeInsets(top: 7, leading: 14, bottom: 7, trailing: 14)
        saveConfiguration.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { incoming in
            var outgoing = incoming
            outgoing.font = BookType.sans(13, weight: .medium, style: .footnote)
            return outgoing
        }
        saveButton.configuration = saveConfiguration
        saveButton.accessibilityIdentifier = "note-save"
        saveButton.accessibilityLabel = "保存笔记"
        saveButton.addAction(UIAction { [weak self] _ in self?.save() }, for: .touchUpInside)
        saveButton.setContentHuggingPriority(.required, for: .horizontal)
        saveButton.setContentCompressionResistancePriority(.required, for: .horizontal)

        var deleteConfiguration = UIButton.Configuration.plain()
        deleteConfiguration.title = "删除笔记"
        deleteConfiguration.baseForegroundColor = BookDesign.error
        deleteConfiguration.contentInsets = NSDirectionalEdgeInsets(top: 6, leading: 8, bottom: 6, trailing: 8)
        deleteConfiguration.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { incoming in
            var outgoing = incoming
            outgoing.font = BookType.sans(13, weight: .medium, style: .footnote)
            return outgoing
        }
        deleteButton.configuration = deleteConfiguration
        deleteButton.accessibilityIdentifier = "note-delete"
        deleteButton.accessibilityLabel = "删除笔记"
        deleteButton.isHidden = !isEditingSavedNote
        deleteButton.setContentHuggingPriority(.required, for: .horizontal)
        deleteButton.setContentCompressionResistancePriority(.required, for: .horizontal)
        deleteButton.addAction(UIAction { [weak self] _ in self?.confirmDelete() }, for: .touchUpInside)

        let header = UIStackView(arrangedSubviews: [close, titleLabel, UIView(), deleteButton, saveButton])
        header.axis = .horizontal
        header.alignment = .center
        header.spacing = 8
        header.translatesAutoresizingMaskIntoConstraints = false

        let quoteContainer = UIView()
        quoteContainer.backgroundColor = BookDesign.paperDeep
        quoteContainer.layer.cornerRadius = BookRadius.field
        quoteContainer.translatesAutoresizingMaskIntoConstraints = false
        let quoteLabel = BookDesign.label(note.quote, font: BookType.serif(14, weight: .regular, style: .body), colour: BookDesign.ink)
        quoteLabel.numberOfLines = 2
        quoteLabel.lineBreakMode = .byTruncatingTail
        quoteLabel.accessibilityIdentifier = "note-quote"
        quoteLabel.translatesAutoresizingMaskIntoConstraints = false
        quoteContainer.addSubview(quoteLabel)

        body.font = BookType.sans(15, weight: .regular, style: .body)
        body.adjustsFontForContentSizeCategory = true
        body.backgroundColor = BookDesign.paper
        body.textColor = BookDesign.ink
        body.textContainerInset = UIEdgeInsets(top: 8, left: 0, bottom: 8, right: 0)
        body.textContainer.lineFragmentPadding = 0
        body.isScrollEnabled = false
        body.text = note.body
        body.accessibilityIdentifier = "note-body"
        body.accessibilityLabel = "个人笔记"
        body.delegate = self
        body.translatesAutoresizingMaskIntoConstraints = false

        placeholder.isUserInteractionEnabled = false
        placeholder.translatesAutoresizingMaskIntoConstraints = false

        let content = UIStackView(arrangedSubviews: [quoteContainer, body])
        content.axis = .vertical
        content.spacing = 10
        content.translatesAutoresizingMaskIntoConstraints = false

        scroll.keyboardDismissMode = .interactive
        scroll.showsVerticalScrollIndicator = false
        scroll.translatesAutoresizingMaskIntoConstraints = false

        card.addSubview(dragArea)
        card.addSubview(header)
        card.addSubview(scroll)
        scroll.addSubview(content)
        scroll.addSubview(placeholder)

        let contentGuide = scroll.contentLayoutGuide
        let frameGuide = scroll.frameLayoutGuide
        NSLayoutConstraint.activate([
            dim.topAnchor.constraint(equalTo: view.topAnchor),
            dim.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            dim.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            dim.bottomAnchor.constraint(equalTo: view.bottomAnchor),

            card.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            card.trailingAnchor.constraint(equalTo: view.trailingAnchor),

            dragArea.topAnchor.constraint(equalTo: card.topAnchor),
            dragArea.leadingAnchor.constraint(equalTo: card.leadingAnchor),
            dragArea.trailingAnchor.constraint(equalTo: card.trailingAnchor),
            dragArea.heightAnchor.constraint(equalToConstant: 26),
            grabber.topAnchor.constraint(equalTo: dragArea.topAnchor, constant: 8),
            grabber.centerXAnchor.constraint(equalTo: dragArea.centerXAnchor),
            grabber.widthAnchor.constraint(equalToConstant: 33),
            grabber.heightAnchor.constraint(equalToConstant: 4),

            header.topAnchor.constraint(equalTo: dragArea.bottomAnchor, constant: 2),
            // 横屏左右安全区（刘海/圆角）；竖屏为 0，布局与之前一致。
            header.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 16),
            header.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -16),
            header.heightAnchor.constraint(greaterThanOrEqualToConstant: 44),

            scroll.topAnchor.constraint(equalTo: header.bottomAnchor, constant: 8),
            scroll.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 16),
            scroll.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -16),
            // 收起键盘时卡片贴底；用卡片自身安全区给 home indicator 留 padding（键盘弹出时卡片已抬离底部，无额外留白）。
            scroll.bottomAnchor.constraint(equalTo: card.safeAreaLayoutGuide.bottomAnchor, constant: -8),

            content.topAnchor.constraint(equalTo: contentGuide.topAnchor),
            content.leadingAnchor.constraint(equalTo: contentGuide.leadingAnchor),
            content.trailingAnchor.constraint(equalTo: contentGuide.trailingAnchor),
            content.bottomAnchor.constraint(equalTo: contentGuide.bottomAnchor),
            content.widthAnchor.constraint(equalTo: frameGuide.widthAnchor),

            quoteLabel.topAnchor.constraint(equalTo: quoteContainer.topAnchor, constant: 10),
            quoteLabel.leadingAnchor.constraint(equalTo: quoteContainer.leadingAnchor, constant: 12),
            quoteLabel.trailingAnchor.constraint(equalTo: quoteContainer.trailingAnchor, constant: -12),
            quoteLabel.bottomAnchor.constraint(equalTo: quoteContainer.bottomAnchor, constant: -10),

            body.heightAnchor.constraint(greaterThanOrEqualToConstant: 96),

            placeholder.topAnchor.constraint(equalTo: body.topAnchor, constant: 8),
            placeholder.leadingAnchor.constraint(equalTo: body.leadingAnchor, constant: 1)
        ])

        cardBottom = card.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        cardBottom.isActive = true
        // 高度只由约束决定：实际值在 viewDidLayoutSubviews 里按 view.bounds 计算（初始 0，不依赖全局屏幕尺寸）。
        cardHeight = card.heightAnchor.constraint(equalToConstant: 0)
        cardHeight.priority = UILayoutPriority(999)
        cardHeight.isActive = true
        // 键盘/横屏需要把卡片压得比 44% 更矮，故最小高度约束降为高优先级（收起键盘时仍按 54% 布局）。
        let minimumHeight = card.heightAnchor.constraint(
            greaterThanOrEqualTo: view.heightAnchor,
            multiplier: Self.minRatio
        )
        minimumHeight.priority = UILayoutPriority(750)
        minimumHeight.isActive = true
        card.heightAnchor.constraint(lessThanOrEqualTo: view.heightAnchor, multiplier: Self.maxRatio).isActive = true

        updateSaveButton()
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(keyboardWillChangeFrame(_:)),
            name: UIResponder.keyboardWillChangeFrameNotification,
            object: nil
        )
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(keyboardWillHide(_:)),
            name: UIResponder.keyboardWillHideNotification,
            object: nil
        )
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        navigationController?.setNavigationBarHidden(true, animated: false)
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        guard !didAnimateIn, navigationController == nil else { return }
        didAnimateIn = true
        view.layoutIfNeeded()
        card.transform = CGAffineTransform(translationX: 0, y: cardHeight.constant + 40)
        UIView.animate(withDuration: 0.28, delay: 0, options: [.curveEaseOut]) {
            self.card.transform = .identity
            self.dim.alpha = 1
        }
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        guard !isDraggingCard, keyboardOverlap == 0, view.bounds.height > 0 else { return }
        let target = view.bounds.height * heightRatio
        if abs(cardHeight.constant - target) > 0.5 {
            cardHeight.constant = target
        }
    }

    // MARK: - 键盘（整卡上移；必要时收窄高度避免顶到屏幕）

    @objc private func keyboardWillChangeFrame(_ notification: Notification) {
        guard let userInfo = notification.userInfo,
              let frameValue = userInfo[UIResponder.keyboardFrameEndUserInfoKey] as? NSValue else { return }
        let keyboardFrame = view.convert(frameValue.cgRectValue, from: nil)
        keyboardOverlap = max(0, view.bounds.maxY - keyboardFrame.minY)
        applyKeyboardLayout(userInfo: userInfo)
    }

    @objc private func keyboardWillHide(_ notification: Notification) {
        keyboardOverlap = 0
        applyKeyboardLayout(userInfo: notification.userInfo)
    }

    /// 键盘态目标高度：min(基础 54%, 键盘顶部与安全顶部之间的可用高度)。
    /// 竖屏约 300pt；横屏（含中文候选栏）可收缩到 ~100pt，保证 grabber/关闭/保存始终在键盘上方可见。
    private func keyboardClampedHeight() -> CGFloat {
        let bounds = view.bounds.height
        let safeTop = max(view.safeAreaInsets.top, 0)
        let keyboardTop = bounds - keyboardOverlap
        let available = max(0, keyboardTop - safeTop - 8)
        return min(bounds * Self.initialRatio, available)
    }

    /// 键盘可见：只上移卡片并把高度收窄到可用高度；键盘收起：恢复基础 54% 高度。
    private func applyKeyboardLayout(userInfo: [AnyHashable: Any]?) {
        let targetBottom: CGFloat
        let targetHeight: CGFloat
        if keyboardOverlap > 0 {
            // 卡片底边精确贴在键盘顶部；不再减 safeAreaInsets.bottom，避免中文候选栏时整卡过度上移。
            targetBottom = -keyboardOverlap
            targetHeight = keyboardClampedHeight()
        } else {
            targetBottom = 0
            targetHeight = view.bounds.height * Self.initialRatio
            heightRatio = Self.initialRatio
        }
        let bottomChanged = abs(cardBottom.constant - targetBottom) > 0.5
        let heightChanged = abs(cardHeight.constant - targetHeight) > 0.5
        guard bottomChanged || heightChanged else { return }
        cardBottom.constant = targetBottom
        cardHeight.constant = targetHeight
        #if DEBUG
        NSLog(
            "[NoteEditor] keyboardOverlap=%.1f bottom=%.1f cardHeight=%.1f view=%.1f",
            keyboardOverlap, targetBottom, targetHeight, view.bounds.height
        )
        #endif
        if isDismissingCard {
            view.layoutIfNeeded()
            return
        }
        let duration = (userInfo?[UIResponder.keyboardAnimationDurationUserInfoKey] as? Double) ?? 0.25
        let curveRaw = (userInfo?[UIResponder.keyboardAnimationCurveUserInfoKey] as? Int) ?? 7
        let options = UIView.AnimationOptions(rawValue: UInt(curveRaw) << 16)
        UIView.animate(withDuration: duration, delay: 0, options: [options, .beginFromCurrentState]) {
            self.view.layoutIfNeeded()
        } completion: { _ in
            #if DEBUG
            NSLog(
                "[NoteEditor] after keyboard change height(frame)=%.1f top=%.1f bottom=%.1f",
                self.card.frame.height, self.card.frame.minY, self.cardBottom.constant
            )
            #endif
        }
    }

    // MARK: - 拖动/关闭

    @objc private func handleCardDrag(_ gesture: UIPanGestureRecognizer) {
        let available = view.bounds.height
        let minHeight = available * Self.minRatio
        let maxHeight = available * Self.maxRatio
        switch gesture.state {
        case .began:
            isDraggingCard = true
            dragStartHeight = cardHeight.constant
        case .changed:
            let proposed = dragStartHeight - gesture.translation(in: view).y
            cardHeight.constant = min(max(proposed, 0), maxHeight + 24)
            view.layoutIfNeeded()
        case .ended, .cancelled:
            isDraggingCard = false
            let moved = cardHeight.constant
            let velocity = gesture.velocity(in: view).y
            if velocity > 1200 || (keyboardOverlap == 0 && moved < minHeight) {
                dismissCard()
                return
            }
            let collapsedHeight = keyboardOverlap > 0
                ? keyboardClampedHeight()
                : available * Self.initialRatio
            let target = moved > available * 0.66 ? available * Self.maxRatio : collapsedHeight
            if keyboardOverlap == 0 { heightRatio = target / available }
            UIView.animate(withDuration: 0.32, delay: 0, usingSpringWithDamping: 0.86, initialSpringVelocity: 0) {
                self.cardHeight.constant = target
                self.view.layoutIfNeeded()
            }
        default:
            break
        }
    }

    @objc private func dismissTapped() {
        dismissCard()
    }

    private func closeTapped() {
        dismissCard(completion: returnToText)
    }

    private func dismissCard(completion: (() -> Void)? = nil) {
        isDismissingCard = true
        view.endEditing(true)
        UIView.animate(withDuration: 0.24, delay: 0, options: [.curveEaseIn]) {
            self.card.transform = CGAffineTransform(translationX: 0, y: self.cardHeight.constant + 40)
            self.dim.alpha = 0
        } completion: { _ in
            self.dismiss(animated: false, completion: completion)
        }
    }

    /// 仅编辑已保存的笔记时显示；纸白确认后删除记录并关闭弹层。
    private func confirmDelete() {
        let alert = BookAlertController(
            title: "删除笔记？",
            message: "删除后无法恢复；原文中的高亮与笔记也会移除。",
            preferredStyle: .alert
        )
        alert.addAction(BookAlertAction(title: "取消", style: .cancel))
        alert.addAction(BookAlertAction(title: "删除", style: .destructive) { [weak self] _ in
            guard let self else { return }
            do {
                try self.library.removeNote(self.note.id, bookID: self.bookID)
                self.changed()
                self.dismissCard()
            } catch {
                let failure = BookAlertController(
                    title: "删除失败",
                    message: "笔记仍保留；请检查储存空间后重试。",
                    preferredStyle: .alert
                )
                failure.addAction(BookAlertAction(title: "知道了", style: .default))
                self.present(failure, animated: true)
            }
        })
        present(alert, animated: true)
    }

    // MARK: - 编辑状态

    private var trimmedBody: String {
        body.text.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// 空正文（trim）时保存按钮明显灰底/ink3 且不可点；有正文才恢复暖灯胶囊。
    private func updateSaveButton() {
        placeholder.isHidden = !body.text.isEmpty
        let canSave = !trimmedBody.isEmpty
        var configuration = saveButton.configuration ?? .filled()
        configuration.baseBackgroundColor = canSave ? BookDesign.lamp : BookDesign.paperDeep
        configuration.baseForegroundColor = canSave ? BookDesign.paper : BookDesign.ink3
        configuration.background.backgroundColor = canSave ? BookDesign.lamp : BookDesign.paperDeep
        saveButton.configuration = configuration
        saveButton.isEnabled = canSave
        saveButton.accessibilityHint = canSave ? nil : "写点什么再保存"
    }

    func textViewDidChange(_ textView: UITextView) {
        updateSaveButton()
    }

    private func save() {
        guard !trimmedBody.isEmpty else {
            updateSaveButton()
            return
        }
        note.body = body.text
        do {
            try library.checkRevision(bookRevision, for: bookID)
            try library.saveNote(note, for: bookID)
            changed()
            dismissCard()
        } catch {
            let alert = BookAlertController(
                title: "笔记保存失败",
                message: "内容仍在此页；请检查储存空间后重试保存。",
                preferredStyle: .alert
            )
            alert.addAction(BookAlertAction(title: "知道了", style: .default))
            present(alert, animated: true)
        }
    }
}
