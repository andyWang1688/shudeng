import UIKit
import ReadiumShared

@MainActor
final class NotesController: UITableViewController {
    private let library: LibraryStore
    private let filter = UISegmentedControl(items: ["全部", "高亮", "笔记"])
    private var books: [Book] { library.books.filter { !rows($0).isEmpty } }
    init(library: LibraryStore) { self.library = library; super.init(style: .insetGrouped) }
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }
    override func viewDidLoad() {
        super.viewDidLoad()
        title = "笔记"
        navigationController?.navigationBar.prefersLargeTitles = false
        BookDesign.table(tableView)
        tableView.accessibilityIdentifier = "notes"
        filter.accessibilityIdentifier = "note-filter"; filter.selectedSegmentIndex = 0
        filter.addAction(UIAction { [weak self] _ in self?.refresh() }, for: .valueChanged)
        let header = UIView(frame: CGRect(x: 0, y: 0, width: 320, height: 64))
        filter.translatesAutoresizingMaskIntoConstraints = false; header.addSubview(filter)
        NSLayoutConstraint.activate([filter.leadingAnchor.constraint(equalTo: header.leadingAnchor, constant: 24),
            filter.trailingAnchor.constraint(equalTo: header.trailingAnchor, constant: -24), filter.centerYAnchor.constraint(equalTo: header.centerYAnchor),
            filter.heightAnchor.constraint(greaterThanOrEqualToConstant: 44)])
        tableView.tableHeaderView = header
    }
    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        refresh()
    }
    private func refresh() {
        tableView.reloadData()
        let empty = UILabel()
        empty.text = "还没有这类笔记\n阅读时选中原文，即可高亮或写下想法"
        empty.font = BookDesign.font(15); empty.numberOfLines = 0; empty.adjustsFontForContentSizeCategory = true
        empty.textColor = BookDesign.secondary
        empty.textAlignment = .center
        tableView.backgroundView = books.isEmpty ? empty : nil
    }
    private func rows(_ book: Book) -> [BookNote] {
        let drafts = book.noteDrafts ?? []
        let all = drafts + (book.notes ?? []).filter { note in !drafts.contains { $0.id == note.id } }
        return all.filter { filter.selectedSegmentIndex == 0 || (filter.selectedSegmentIndex == 1 ? $0.body.isEmpty : !$0.body.isEmpty) }
    }
    override func numberOfSections(in tableView: UITableView) -> Int { books.count }
    override func tableView(_ tableView: UITableView, titleForHeaderInSection section: Int) -> String? { books[section].title }
    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { rows(books[section]).count }
    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let book = books[indexPath.section], note = rows(book)[indexPath.row]
        let draft = (book.noteDrafts ?? []).contains { $0.id == note.id }
        let cell = UITableViewCell(style: .subtitle, reuseIdentifier: nil)
        cell.textLabel?.text = "“" + note.quote + "”"
        cell.textLabel?.numberOfLines = 3
        cell.textLabel?.font = BookDesign.readingFont(18)
        cell.textLabel?.textColor = BookDesign.ink
        cell.detailTextLabel?.text = (draft ? "草稿 · " : "") + (note.body.isEmpty ? "高亮 · 返回原文" : note.body)
        cell.detailTextLabel?.numberOfLines = 3
        cell.detailTextLabel?.font = BookDesign.font(15)
        cell.detailTextLabel?.textColor = BookDesign.secondary
        cell.contentView.directionalLayoutMargins = .init(top: 18, leading: 0, bottom: 18, trailing: 0)
        cell.imageView?.image = UIImage(systemName: "quote.opening"); cell.imageView?.tintColor = BookDesign.lamp
        cell.textLabel?.adjustsFontForContentSizeCategory = true
        cell.detailTextLabel?.adjustsFontForContentSizeCategory = true
        cell.accessoryType = .disclosureIndicator
        cell.accessibilityIdentifier = "note-\(note.id)"
        return cell
    }
    override func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true)
        let book = books[indexPath.section], note = rows(book)[indexPath.row]
        let editor = NoteEditorController(library: library, bookID: book.id, note: note,
            changed: { [weak self] in self?.refresh() }, returnToText: { [weak self] in self?.open(book, note: note) })
        let sheet = UINavigationController(rootViewController: editor)
        sheet.modalPresentationStyle = .fullScreen
        present(sheet, animated: true)
    }
    private func open(_ book: Book, note: BookNote) {
        Task {
            do {
                let publication = try await library.open(book)
                let current = library.books.first { $0.id == book.id } ?? book
                let reader = try ReaderController(book: current, publication: publication, library: library, target: note.location())
                reader.modalPresentationStyle = .fullScreen
                present(reader, animated: true)
            } catch {
                let alert = UIAlertController(title: "无法返回原文", message: error.localizedDescription, preferredStyle: .alert)
                alert.addAction(UIAlertAction(title: "知道了", style: .default))
                present(alert, animated: true)
            }
        }
    }
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
        self.library = library; self.bookID = bookID; self.changed = changed; self.returnToText = returnToText
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
        quote.backgroundColor = BookDesign.surface; quote.textColor = BookDesign.ink; quote.layer.cornerRadius = 12
        quote.accessibilityIdentifier = "note-quote"
        let bodyTitle = UILabel()
        bodyTitle.text = "个人笔记"
        bodyTitle.font = .preferredFont(forTextStyle: .headline)
        bodyTitle.numberOfLines = 0
        body.text = note.body
        body.font = .preferredFont(forTextStyle: .body)
        body.adjustsFontForContentSizeCategory = true
        body.backgroundColor = BookDesign.surface; body.textColor = BookDesign.ink; body.layer.cornerRadius = 12
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
        stack.axis = .vertical; stack.spacing = 8
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
            body.heightAnchor.constraint(greaterThanOrEqualToConstant: 160), fill
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
            savedBody = note.body; hasSavedDraft = true
            state.text = "草稿已保存，可继续编辑"; state.textColor = .secondaryLabel
            changed()
            return true
        } catch {
            state.text = "草稿保存失败，内容仍在此页；请重试保存草稿"
            state.textColor = .systemRed
            return false
        }
    }
    @objc private func saveDraft() { persistDraft() }
    @objc private func background() { if body.text != savedBody { persistDraft() } }
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
