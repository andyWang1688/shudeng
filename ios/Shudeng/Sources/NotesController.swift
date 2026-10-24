import UIKit
import ReadiumShared

private enum NotesFilter: String, CaseIterable {
    case all = "全部"
    case highlights = "高亮"
    case notes = "笔记"
    case bookmarks = "书签"

    var accessibilityIdentifier: String {
        switch self {
        case .all: return "note-filter-all"
        case .highlights: return "note-filter-highlights"
        case .notes: return "note-filter-notes"
        case .bookmarks: return "note-filter-bookmarks"
        }
    }

    func includes(_ record: NoteRecord) -> Bool {
        switch self {
        case .all:
            return true
        case .highlights:
            guard case let .note(note, _) = record else { return false }
            return note.body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        case .notes:
            guard case let .note(note, _) = record else { return false }
            return !note.body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        case .bookmarks:
            guard case .bookmark = record else { return false }
            return true
        }
    }
}

private enum NoteRecord {
    case note(BookNote, draft: Bool)
    case bookmark(Bookmark)

    var id: UUID {
        switch self {
        case let .note(note, _): return note.id
        case let .bookmark(bookmark): return bookmark.id
        }
    }

    var quote: String {
        switch self {
        case let .note(note, _): return note.quote
        case let .bookmark(bookmark): return bookmark.excerpt
        }
    }

    var body: String {
        switch self {
        case let .note(note, _): return note.body
        case .bookmark: return ""
        }
    }

    var isDraft: Bool {
        guard case let .note(_, draft) = self else { return false }
        return draft
    }

    var kind: String {
        switch self {
        case let .note(note, draft):
            if draft { return "笔记 · 草稿" }
            return note.body.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "高亮" : "笔记"
        case .bookmark:
            return "书签"
        }
    }

    var chapter: String {
        switch self {
        case let .note(note, _): return (try? note.location().title) ?? "阅读位置"
        case let .bookmark(bookmark): return bookmark.title
        }
    }

    var accessibilityIdentifier: String {
        switch self {
        case let .note(note, _): return "note-\(note.id.uuidString)"
        case let .bookmark(bookmark): return "bookmark-\(bookmark.id.uuidString)"
        }
    }

    func location() throws -> Locator {
        switch self {
        case let .note(note, _): return try note.location()
        case let .bookmark(bookmark): return try bookmark.location()
        }
    }
}

@MainActor
final class NotesController: UITableViewController {
    private let library: LibraryStore
    private let covers = BookCoverStore()
    private let pageHeader = NotesPageHeader()
    private var filter: NotesFilter = .all
    private var sections: [(book: Book, records: [NoteRecord])] = []
    private var libraryObserver: NSObjectProtocol?

    init(library: LibraryStore) {
        self.library = library
        super.init(style: .plain)
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

        tableView.backgroundColor = BookDesign.paper
        tableView.separatorStyle = .none
        tableView.rowHeight = UITableView.automaticDimension
        tableView.estimatedRowHeight = 190
        tableView.keyboardDismissMode = .onDrag
        tableView.sectionHeaderTopPadding = 0
        tableView.contentInset = UIEdgeInsets(top: 0, left: 0, bottom: 24, right: 0)
        tableView.accessibilityIdentifier = "notes"
        tableView.register(NoteRecordCell.self, forCellReuseIdentifier: "note-record")

        pageHeader.onExport = { [weak self] in self?.exportNotes() }
        pageHeader.onFilter = { [weak self] selected in
            guard let self else { return }
            filter = selected
            refresh()
        }
        pageHeader.setFilter(filter)
        tableView.tableHeaderView = pageHeader

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

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        layoutPageHeader()
    }

    private func layoutPageHeader() {
        let width = max(view.bounds.width, 320)
        let size = pageHeader.systemLayoutSizeFitting(
            CGSize(width: width, height: UIView.layoutFittingCompressedSize.height),
            withHorizontalFittingPriority: .required,
            verticalFittingPriority: .fittingSizeLevel
        )
        let frame = CGRect(origin: .zero, size: CGSize(width: width, height: ceil(size.height)))
        guard pageHeader.frame != frame else { return }
        pageHeader.frame = frame
        tableView.tableHeaderView = pageHeader
    }

    private func refresh() {
        sections = library.books.filter { $0.removal == nil }.compactMap { book in
            let records = records(for: book).filter(filter.includes)
            return records.isEmpty ? nil : (book, records)
        }
        tableView.reloadData()
        updateEmptyState()
    }

    private func records(for book: Book) -> [NoteRecord] {
        let drafts = book.noteDrafts ?? []
        let draftIDs = Set(drafts.map(\.id))
        let notes = drafts.map { NoteRecord.note($0, draft: true) }
            + (book.notes ?? []).filter { !draftIDs.contains($0.id) }.map { NoteRecord.note($0, draft: false) }
        let bookmarks = (book.bookmarks ?? []).map(NoteRecord.bookmark)
        return notes + bookmarks
    }

    private func updateEmptyState() {
        guard sections.isEmpty else {
            tableView.backgroundView = nil
            return
        }
        let filtered = filter != .all
        let empty = NotesEmptyView(
            title: filtered ? "没有这类阅读痕迹" : "还没有阅读痕迹",
            detail: filtered
                ? "换一个筛选，看看其他高亮、笔记和书签。"
                : "阅读时选中原文，即可高亮或写下自己的想法。",
            actionTitle: filtered ? "查看全部" : "去书架读书"
        )
        empty.onAction = { [weak self] in
            guard let self else { return }
            if filtered {
                filter = .all
                pageHeader.setFilter(.all)
                refresh()
            } else {
                rootTabs?.select(RootDestination.library.rawValue)
            }
        }
        tableView.backgroundView = empty
    }

    private var rootTabs: RootTabController? {
        var current = parent
        while let controller = current {
            if let tabs = controller as? RootTabController { return tabs }
            current = controller.parent
        }
        return nil
    }

    override func numberOfSections(in tableView: UITableView) -> Int {
        sections.count
    }

    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
        sections[section].records.count
    }

    override func tableView(_ tableView: UITableView, viewForHeaderInSection section: Int) -> UIView? {
        let header = NotesBookHeader()
        header.configure(book: sections[section].book, covers: covers, library: library)
        return header
    }

    override func tableView(_ tableView: UITableView, heightForHeaderInSection section: Int) -> CGFloat {
        53
    }

    override func tableView(_ tableView: UITableView, heightForFooterInSection section: Int) -> CGFloat {
        section == sections.indices.last ? 18 : 0
    }

    override func tableView(_ tableView: UITableView, viewForFooterInSection section: Int) -> UIView? {
        UIView()
    }

    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = tableView.dequeueReusableCell(withIdentifier: "note-record", for: indexPath) as! NoteRecordCell
        let record = sections[indexPath.section].records[indexPath.row]
        let book = sections[indexPath.section].book
        let timestamp: Date?
        switch record {
        case let .note(note, _):
            timestamp = library.recordTimestamp(kind: .note, bookID: book.id, recordID: note.id)
        case let .bookmark(bookmark):
            timestamp = library.recordTimestamp(kind: .bookmark, bookID: book.id, recordID: bookmark.id)
        }
        cell.configure(record, timestamp: timestamp)
        cell.onReturn = { [weak self] in
            guard let self else { return }
            open(sections[indexPath.section].book, record: record)
        }
        return cell
    }

    override func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true)
        let book = sections[indexPath.section].book
        let record = sections[indexPath.section].records[indexPath.row]
        switch record {
        case let .note(note, _):
            let editor = NoteEditorController(
                library: library,
                bookID: book.id,
                note: note,
                changed: { [weak self] in self?.refresh() },
                returnToText: { [weak self] in self?.open(book, record: record) }
            )
            let sheet = UINavigationController(rootViewController: editor)
            sheet.modalPresentationStyle = .fullScreen
            present(sheet, animated: true)
        case .bookmark:
            open(book, record: record)
        }
    }

    private func open(_ book: Book, record: NoteRecord) {
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
                let alert = UIAlertController(
                    title: "无法返回原文",
                    message: error.localizedDescription,
                    preferredStyle: .alert
                )
                alert.addAction(UIAlertAction(title: "知道了", style: .default))
                present(alert, animated: true)
            }
        }
    }

    private func exportNotes() {
        let lines = sections.flatMap { section in
            section.records.map { record in
                var values = ["《\(section.book.title)》", record.chapter, record.kind]
                if !record.quote.isEmpty { values.append("原文：\(record.quote)") }
                if !record.body.isEmpty { values.append("想法：\(record.body)") }
                return values.joined(separator: "\n")
            }
        }
        guard !lines.isEmpty else {
            let alert = UIAlertController(
                title: "还没有可导出的笔记",
                message: "阅读时选中原文，写下高亮或笔记后再导出。",
                preferredStyle: .alert
            )
            alert.addAction(UIAlertAction(title: "知道了", style: .default))
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
            share.popoverPresentationController?.sourceView = pageHeader.exportButton
            share.popoverPresentationController?.sourceRect = pageHeader.exportButton.bounds
            present(share, animated: true)
        } catch {
            let alert = UIAlertController(
                title: "无法导出",
                message: "笔记仍保存在本机，请检查储存空间后重试。",
                preferredStyle: .alert
            )
            alert.addAction(UIAlertAction(title: "知道了", style: .default))
            present(alert, animated: true)
        }
    }
}

@MainActor
private final class NotesPageHeader: UIView {
    var onExport: (() -> Void)?
    var onFilter: ((NotesFilter) -> Void)?
    let exportButton = CircularTextlessButton(symbol: "square.and.arrow.up", label: "导出笔记")
    private let filters = NotesFilterBar()

    override init(frame: CGRect) {
        super.init(frame: frame)
        accessibilityIdentifier = "notes-header"
        backgroundColor = BookDesign.paper

        let title = BookDesign.label("笔记", size: 31, weight: .bold, style: .largeTitle)
        title.accessibilityIdentifier = "notes-title"
        let titleRow = UIStackView(arrangedSubviews: [title, UIView(), exportButton])
        titleRow.axis = .horizontal
        titleRow.alignment = .center
        titleRow.spacing = 12

        exportButton.accessibilityIdentifier = "notes-export"
        exportButton.addAction(UIAction { [weak self] _ in self?.onExport?() }, for: .touchUpInside)

        let description = BookDesign.label(
            "留下读过的痕迹，也留下自己的想法。",
            size: 12,
            colour: BookDesign.secondary
        )
        description.accessibilityIdentifier = "notes-description"

        filters.accessibilityIdentifier = "note-filter"
        filters.onSelect = { [weak self] selected in self?.onFilter?(selected) }

        for child in [titleRow, description, filters] {
            child.translatesAutoresizingMaskIntoConstraints = false
            addSubview(child)
        }
        NSLayoutConstraint.activate([
            titleRow.topAnchor.constraint(equalTo: topAnchor, constant: 18),
            titleRow.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 24),
            titleRow.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -24),
            titleRow.heightAnchor.constraint(greaterThanOrEqualToConstant: 44),
            description.topAnchor.constraint(equalTo: titleRow.bottomAnchor, constant: 7),
            description.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 24),
            description.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -24),
            filters.topAnchor.constraint(equalTo: description.bottomAnchor, constant: 17),
            filters.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 24),
            filters.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -24),
            filters.heightAnchor.constraint(equalToConstant: 44),
            filters.bottomAnchor.constraint(equalTo: bottomAnchor)
        ])
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    func setFilter(_ filter: NotesFilter) {
        filters.setSelected(filter)
    }
}

@MainActor
private final class CircularTextlessButton: UIButton {
    init(symbol: String, label: String) {
        super.init(frame: .zero)
        backgroundColor = BookDesign.wash
        tintColor = BookDesign.ink
        layer.cornerRadius = 22
        setImage(BookDesign.symbol(symbol, size: 19), for: .normal)
        accessibilityLabel = label
        widthAnchor.constraint(equalToConstant: 44).isActive = true
        heightAnchor.constraint(equalToConstant: 44).isActive = true
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    override var isHighlighted: Bool {
        didSet {
            alpha = isHighlighted ? 0.72 : 1
            transform = isHighlighted ? CGAffineTransform(scaleX: 0.98, y: 0.98) : .identity
        }
    }
}

@MainActor
private final class NotesFilterBar: UIView {
    var onSelect: ((NotesFilter) -> Void)?
    private let buttons = NotesFilter.allCases.map(NotesFilterButton.init)
    private let line = UIView()
    private(set) var selected: NotesFilter = .all

    override init(frame: CGRect) {
        super.init(frame: frame)
        let row = UIStackView(arrangedSubviews: buttons)
        row.axis = .horizontal
        row.distribution = .fillEqually
        line.backgroundColor = BookDesign.line
        for child in [row, line] {
            child.translatesAutoresizingMaskIntoConstraints = false
            addSubview(child)
        }
        NSLayoutConstraint.activate([
            row.topAnchor.constraint(equalTo: topAnchor),
            row.leadingAnchor.constraint(equalTo: leadingAnchor),
            row.trailingAnchor.constraint(equalTo: trailingAnchor),
            row.bottomAnchor.constraint(equalTo: bottomAnchor),
            line.leadingAnchor.constraint(equalTo: leadingAnchor),
            line.trailingAnchor.constraint(equalTo: trailingAnchor),
            line.bottomAnchor.constraint(equalTo: bottomAnchor),
            line.heightAnchor.constraint(equalToConstant: 1)
        ])
        for (index, button) in buttons.enumerated() {
            button.tag = index
            button.addAction(UIAction { [weak self] _ in self?.choose(index) }, for: .touchUpInside)
        }
        setSelected(.all)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    func setSelected(_ filter: NotesFilter) {
        selected = filter
        for button in buttons {
            button.isSelected = button.filter == filter
        }
    }

    private func choose(_ index: Int) {
        guard buttons.indices.contains(index) else { return }
        setSelected(buttons[index].filter)
        onSelect?(buttons[index].filter)
    }
}

@MainActor
private final class NotesFilterButton: UIControl {
    let filter: NotesFilter
    private let label: UILabel
    private let marker = UIView()

    init(_ filter: NotesFilter) {
        self.filter = filter
        label = BookDesign.label(filter.rawValue, size: 14, weight: .medium, colour: BookDesign.secondary)
        super.init(frame: .zero)
        accessibilityIdentifier = filter.accessibilityIdentifier
        accessibilityLabel = filter.rawValue
        accessibilityTraits = .button
        marker.backgroundColor = BookDesign.ink
        marker.layer.cornerRadius = 1
        label.textAlignment = .center
        label.isAccessibilityElement = false
        for child in [label, marker] {
            child.translatesAutoresizingMaskIntoConstraints = false
            addSubview(child)
        }
        NSLayoutConstraint.activate([
            label.centerXAnchor.constraint(equalTo: centerXAnchor),
            label.centerYAnchor.constraint(equalTo: centerYAnchor, constant: -1),
            marker.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 3),
            marker.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -3),
            marker.bottomAnchor.constraint(equalTo: bottomAnchor),
            marker.heightAnchor.constraint(equalToConstant: 2)
        ])
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    override var isSelected: Bool {
        didSet {
            label.textColor = isSelected ? BookDesign.ink : BookDesign.secondary
            label.font = BookDesign.font(14, weight: isSelected ? .semibold : .medium)
            marker.isHidden = !isSelected
            accessibilityTraits = isSelected ? [.button, .selected] : .button
        }
    }

    override var isHighlighted: Bool {
        didSet { alpha = isHighlighted ? 0.72 : 1 }
    }
}

@MainActor
private final class NotesBookHeader: UIView {
    private let cover = UIView()
    private let coverImage = UIImageView()
    private let initial = BookDesign.label(nil, size: 11, weight: .semibold, colour: BookDesign.paper)
    private let title = BookDesign.label(nil, size: 12, colour: BookDesign.secondary)
    private var token = UUID()

    override init(frame: CGRect) {
        super.init(frame: frame)
        cover.layer.cornerRadius = 2
        cover.clipsToBounds = true
        coverImage.contentMode = .scaleAspectFill
        coverImage.clipsToBounds = true
        initial.textAlignment = .center
        initial.isHidden = true
        for child in [coverImage, initial] {
            child.translatesAutoresizingMaskIntoConstraints = false
            cover.addSubview(child)
        }
        let row = UIStackView(arrangedSubviews: [cover, title, UIView()])
        row.axis = .horizontal
        row.alignment = .center
        row.spacing = 8
        row.translatesAutoresizingMaskIntoConstraints = false
        addSubview(row)
        NSLayoutConstraint.activate([
            cover.widthAnchor.constraint(equalToConstant: 22),
            cover.heightAnchor.constraint(equalToConstant: 30),
            coverImage.topAnchor.constraint(equalTo: cover.topAnchor),
            coverImage.leadingAnchor.constraint(equalTo: cover.leadingAnchor),
            coverImage.trailingAnchor.constraint(equalTo: cover.trailingAnchor),
            coverImage.bottomAnchor.constraint(equalTo: cover.bottomAnchor),
            initial.centerXAnchor.constraint(equalTo: cover.centerXAnchor),
            initial.centerYAnchor.constraint(equalTo: cover.centerYAnchor),
            row.topAnchor.constraint(equalTo: topAnchor, constant: 23),
            row.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 24),
            row.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -24),
            row.bottomAnchor.constraint(lessThanOrEqualTo: bottomAnchor)
        ])
        isAccessibilityElement = true
        accessibilityTraits = .header
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    func configure(book: Book, covers: BookCoverStore, library: LibraryStore) {
        token = UUID()
        let current = token
        title.text = book.title
        accessibilityIdentifier = "notes-book-\(book.id)"
        accessibilityLabel = book.title
        cover.backgroundColor = palette(for: book.title)
        coverImage.image = nil
        initial.text = String(book.title.prefix(1))
        initial.isHidden = false
        Task { [weak self] in
            let image = await covers.image(for: book, library: library)
            guard let self, token == current else { return }
            coverImage.image = image
            initial.isHidden = image != nil
        }
    }

    private func palette(for title: String) -> UIColor {
        let colours = [0x565D4A, 0x79513E, 0x4E626B, 0x75634C]
        let index = title.utf8.reduce(0) { ($0 + Int($1)) % colours.count }
        return BookDesign.rgb(colours[index])
    }
}

@MainActor
private final class NoteRecordCell: UITableViewCell {
    var onReturn: (() -> Void)?
    private let quoteLine = UIView()
    private let quote = UILabel()
    private let body = UILabel()
    private let meta = UILabel()
    private let returnButton = UIButton(type: .system)
    private let bottomLine = UIView()
    private let quoteRow = UIView()
    private let contentStack = UIStackView()

    override init(style: UITableViewCell.CellStyle, reuseIdentifier: String?) {
        super.init(style: style, reuseIdentifier: reuseIdentifier)
        backgroundColor = BookDesign.paper
        contentView.backgroundColor = BookDesign.paper
        selectionStyle = .default

        quoteLine.backgroundColor = BookDesign.accent
        quote.numberOfLines = 3
        quote.lineBreakMode = .byTruncatingTail
        quote.adjustsFontForContentSizeCategory = true
        body.numberOfLines = 3
        body.lineBreakMode = .byTruncatingTail
        body.font = BookDesign.font(14, style: .subheadline)
        body.textColor = BookDesign.secondary
        body.adjustsFontForContentSizeCategory = true
        meta.font = BookDesign.font(11, style: .caption1)
        meta.textColor = BookDesign.secondary
        meta.numberOfLines = 2
        meta.adjustsFontForContentSizeCategory = true

        returnButton.tintColor = BookDesign.secondary
        returnButton.setTitleColor(BookDesign.secondary, for: .normal)
        returnButton.setImage(BookDesign.symbol("arrow.up.right", size: 14), for: .normal)
        returnButton.semanticContentAttribute = .forceRightToLeft
        returnButton.titleLabel?.font = BookDesign.font(11, weight: .medium, style: .caption1)
        returnButton.titleLabel?.adjustsFontForContentSizeCategory = true
        returnButton.setTitle("回到原文", for: .normal)
        returnButton.accessibilityLabel = "回到原文"
        returnButton.addAction(UIAction { [weak self] _ in self?.onReturn?() }, for: .touchUpInside)
        returnButton.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true

        let metaRow = UIStackView(arrangedSubviews: [meta, UIView(), returnButton])
        metaRow.axis = .horizontal
        metaRow.alignment = .center
        metaRow.spacing = 8

        for child in [quoteLine, quote] {
            child.translatesAutoresizingMaskIntoConstraints = false
            quoteRow.addSubview(child)
        }
        NSLayoutConstraint.activate([
            quoteLine.leadingAnchor.constraint(equalTo: quoteRow.leadingAnchor),
            quoteLine.topAnchor.constraint(equalTo: quoteRow.topAnchor),
            quoteLine.bottomAnchor.constraint(equalTo: quoteRow.bottomAnchor),
            quoteLine.widthAnchor.constraint(equalToConstant: 2),
            quote.leadingAnchor.constraint(equalTo: quoteRow.leadingAnchor, constant: 15),
            quote.topAnchor.constraint(equalTo: quoteRow.topAnchor),
            quote.trailingAnchor.constraint(equalTo: quoteRow.trailingAnchor),
            quote.bottomAnchor.constraint(equalTo: quoteRow.bottomAnchor)
        ])

        contentStack.addArrangedSubview(quoteRow)
        contentStack.addArrangedSubview(body)
        contentStack.addArrangedSubview(metaRow)
        contentStack.axis = .vertical
        contentStack.spacing = 13
        contentStack.setCustomSpacing(10, after: body)
        contentStack.translatesAutoresizingMaskIntoConstraints = false
        contentView.addSubview(contentStack)

        bottomLine.backgroundColor = BookDesign.line
        bottomLine.translatesAutoresizingMaskIntoConstraints = false
        contentView.addSubview(bottomLine)
        NSLayoutConstraint.activate([
            contentStack.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 20),
            contentStack.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 24),
            contentStack.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -24),
            contentStack.bottomAnchor.constraint(equalTo: contentView.bottomAnchor, constant: -14),
            bottomLine.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 24),
            bottomLine.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -24),
            bottomLine.bottomAnchor.constraint(equalTo: contentView.bottomAnchor),
            bottomLine.heightAnchor.constraint(equalToConstant: 1)
        ])
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    override func prepareForReuse() {
        super.prepareForReuse()
        onReturn = nil
        accessibilityIdentifier = nil
        accessibilityLabel = nil
    }

    func configure(_ record: NoteRecord, timestamp: Date?) {
        accessibilityIdentifier = record.accessibilityIdentifier
        let chapter = record.chapter.isEmpty ? "阅读位置" : record.chapter
        let time = timestamp.map(Self.time) ?? "时间未记录"
        meta.text = chapter + " · " + record.kind + " · " + time
        meta.accessibilityLabel = chapter + "，" + record.kind + "，" + time
        returnButton.accessibilityIdentifier = "return-\(record.id.uuidString)"

        switch record {
        case let .note(note, _):
            let font = BookDesign.readingFont(17)
            quote.font = font
            quote.textColor = BookDesign.ink
            quote.attributedText = paragraph(
                "“" + note.quote + "”",
                font: font,
                colour: BookDesign.ink,
                lineHeightMultiple: 1.8
            )
            quoteLine.isHidden = false
            let bodyText = note.body.trimmingCharacters(in: .whitespacesAndNewlines)
            body.isHidden = bodyText.isEmpty
            body.text = bodyText
            returnButton.accessibilityLabel = "回到原文"
        case let .bookmark(bookmark):
            let font = BookDesign.font(17, weight: .semibold, style: .headline)
            quote.font = font
            quote.textColor = BookDesign.ink
            quote.attributedText = paragraph(
                bookmark.title,
                font: font,
                colour: BookDesign.ink,
                lineHeightMultiple: 1.5
            )
            quoteLine.isHidden = true
            body.isHidden = true
            returnButton.accessibilityLabel = "回到原文"
        }
        setNeedsLayout()
    }

    private func paragraph(
        _ text: String,
        font: UIFont,
        colour: UIColor,
        lineHeightMultiple: CGFloat
    ) -> NSAttributedString {
        let style = NSMutableParagraphStyle()
        style.lineHeightMultiple = lineHeightMultiple
        style.lineBreakMode = .byTruncatingTail
        return NSAttributedString(
            string: text,
            attributes: [
                .font: font,
                .foregroundColor: colour,
                .paragraphStyle: style
            ]
        )
    }

    private static func time(_ date: Date) -> String {
        let calendar = Calendar.autoupdatingCurrent
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "zh_CN")
        formatter.timeZone = .autoupdatingCurrent
        formatter.dateFormat = calendar.isDateInToday(date) || calendar.isDateInYesterday(date)
            ? "HH:mm"
            : "M月d日 HH:mm"
        let clock = formatter.string(from: date)
        if calendar.isDateInToday(date) { return "今天 " + clock }
        if calendar.isDateInYesterday(date) { return "昨天 " + clock }
        return clock
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
    private let state = UILabel()
    private var savedBody: String
    private var hasSavedDraft: Bool
    private var autosave: Timer?

    init(library: LibraryStore, bookID: String, note: BookNote, changed: @escaping () -> Void, returnToText: (() -> Void)? = nil) {
        self.library = library
        self.bookID = bookID
        self.changed = changed
        self.returnToText = returnToText
        bookRevision = library.revision(for: bookID)
        let draft = library.books.first { $0.id == bookID }?.noteDrafts?.first { $0.id == note.id }
        self.note = draft ?? note
        savedBody = (draft ?? note).body
        hasSavedDraft = draft != nil
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    override func viewDidLoad() {
        super.viewDidLoad()
        title = hasSavedDraft ? "恢复笔记草稿" : "笔记"
        view.backgroundColor = BookDesign.paper
        navigationItem.leftBarButtonItem = UIBarButtonItem(title: "关闭", style: .plain, target: self, action: #selector(closeEditor))
        navigationItem.rightBarButtonItem = UIBarButtonItem(title: "保存笔记", style: .done, target: self, action: #selector(save))
        let quoteTitle = UILabel()
        quoteTitle.text = "引用原文"
        quoteTitle.font = .preferredFont(forTextStyle: .caption1)
        quoteTitle.textColor = .secondaryLabel
        quoteTitle.numberOfLines = 0
        let quote = UITextView()
        quote.isEditable = false
        quote.text = note.quote
        quote.font = BookDesign.readingFont(17)
        quote.adjustsFontForContentSizeCategory = true
        quote.backgroundColor = BookDesign.surface
        quote.textColor = BookDesign.ink
        quote.layer.cornerRadius = 12
        quote.accessibilityIdentifier = "note-quote"
        let bodyTitle = UILabel()
        bodyTitle.text = "个人笔记"
        bodyTitle.font = .preferredFont(forTextStyle: .headline)
        bodyTitle.numberOfLines = 0
        body.text = note.body
        body.font = .preferredFont(forTextStyle: .body)
        body.adjustsFontForContentSizeCategory = true
        body.backgroundColor = BookDesign.surface
        body.textColor = BookDesign.ink
        body.layer.cornerRadius = 12
        body.accessibilityIdentifier = "note-body"
        body.delegate = self
        state.font = .preferredFont(forTextStyle: .caption1)
        state.adjustsFontForContentSizeCategory = true
        state.numberOfLines = 0
        state.setContentCompressionResistancePriority(.required, for: .vertical)
        state.accessibilityIdentifier = "note-save-status"
        state.text = hasSavedDraft ? "草稿已保存，可继续编辑" : "尚未修改"
        let draft = UIButton(type: .system)
        draft.setTitle("保存草稿", for: .normal)
        draft.titleLabel?.font = .preferredFont(forTextStyle: .body)
        draft.titleLabel?.adjustsFontForContentSizeCategory = true
        draft.titleLabel?.numberOfLines = 0
        draft.addTarget(self, action: #selector(saveDraft), for: .touchUpInside)
        let original = UIButton(type: .system)
        original.setTitle("返回原文", for: .normal)
        original.titleLabel?.font = .preferredFont(forTextStyle: .body)
        original.titleLabel?.adjustsFontForContentSizeCategory = true
        original.titleLabel?.numberOfLines = 0
        original.addTarget(self, action: #selector(goBackToText), for: .touchUpInside)
        original.isHidden = returnToText == nil
        let actions = UIStackView(arrangedSubviews: [draft, original])
        actions.axis = traitCollection.preferredContentSizeCategory.isAccessibilityCategory ? .vertical : .horizontal
        actions.distribution = .fillEqually
        actions.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
        let stack = UIStackView(arrangedSubviews: [quoteTitle, quote, bodyTitle, body, state, actions])
        stack.axis = .vertical
        stack.spacing = 8
        stack.translatesAutoresizingMaskIntoConstraints = false
        let scroll = UIScrollView()
        scroll.keyboardDismissMode = .interactive
        scroll.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(scroll)
        scroll.addSubview(stack)
        let fill = stack.heightAnchor.constraint(greaterThanOrEqualTo: scroll.frameLayoutGuide.heightAnchor, constant: -16)
        fill.priority = .defaultLow
        NSLayoutConstraint.activate([
            scroll.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            scroll.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            scroll.bottomAnchor.constraint(equalTo: view.keyboardLayoutGuide.topAnchor),
            stack.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor, constant: 8),
            stack.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor, constant: 16),
            stack.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor, constant: -16),
            stack.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor, constant: -8),
            stack.widthAnchor.constraint(equalTo: scroll.frameLayoutGuide.widthAnchor, constant: -32),
            quote.heightAnchor.constraint(equalToConstant: 120),
            body.heightAnchor.constraint(greaterThanOrEqualToConstant: 160),
            fill
        ])
        NotificationCenter.default.addObserver(self, selector: #selector(background), name: UIApplication.willResignActiveNotification, object: nil)
    }

    deinit { NotificationCenter.default.removeObserver(self) }

    func textViewDidChange(_ textView: UITextView) {
        state.text = "尚未保存的修改"
        autosave?.invalidate()
        autosave = Timer.scheduledTimer(withTimeInterval: 0.6, repeats: false) { [weak self] _ in
            MainActor.assumeIsolated { self?.saveDraft() }
        }
    }

    @discardableResult private func persistDraft() -> Bool {
        autosave?.invalidate()
        note.body = body.text
        do {
            try library.checkRevision(bookRevision, for: bookID)
            try library.saveNote(note, for: bookID, draft: true)
            savedBody = note.body
            hasSavedDraft = true
            state.text = "草稿已保存，可继续编辑"
            state.textColor = .secondaryLabel
            changed()
            return true
        } catch {
            state.text = "草稿保存失败，内容仍在此页；请重试保存草稿"
            state.textColor = .systemRed
            return false
        }
    }

    @objc private func saveDraft() { persistDraft() }

    @objc private func background() {
        if body.text != savedBody { persistDraft() }
    }

    @objc private func save() {
        autosave?.invalidate()
        note.body = body.text
        do {
            try library.checkRevision(bookRevision, for: bookID)
            try library.saveNote(note, for: bookID)
            changed()
            dismiss(animated: true)
        } catch {
            state.text = "笔记保存失败，内容仍在此页；请重试保存笔记"
            state.textColor = .systemRed
        }
    }

    @objc private func closeEditor() {
        if body.text != savedBody && !persistDraft() { return }
        autosave?.invalidate()
        dismiss(animated: true)
    }

    @objc private func goBackToText() {
        if body.text != savedBody && !persistDraft() { return }
        autosave?.invalidate()
        dismiss(animated: true, completion: returnToText)
    }
}
