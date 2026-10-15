import UIKit
import ReadiumShared

@MainActor
final class QuestionController: UIViewController, UITextViewDelegate {
    private let library: LibraryStore
    private let id: UUID
    private let jump: ((Locator, Locator) -> Void)?
    private let stack = UIStackView()
    private let quote = UILabel()
    private let input = UITextView()
    private let status = UILabel()
    private let scope = UILabel()
    private let answer = UILabel()
    private let references = UIStackView()
    private let send = UIButton(type: .system)
    private let cancel = UIButton(type: .system)
    private let retry = UIButton(type: .system)
    private let materials = UIButton(type: .system)
    private var observer: NSObjectProtocol?
    private var shownReferences: [QuestionEvidence] = []
    init(library: LibraryStore, id: UUID, jump: ((Locator, Locator) -> Void)? = nil) {
        self.library = library; self.id = id; self.jump = jump
        super.init(nibName: nil, bundle: nil)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }
    deinit { if let observer { NotificationCenter.default.removeObserver(observer) } }
    override func viewDidLoad() {
        super.viewDidLoad()
        title = "选文问答"
        view.backgroundColor = .systemBackground
        navigationItem.rightBarButtonItem = UIBarButtonItem(title: "关闭", style: .plain, target: self, action: #selector(closePanel))
        let scroll = UIScrollView(); scroll.keyboardDismissMode = .interactive; scroll.accessibilityIdentifier = "question-scroll"
        stack.axis = .vertical; stack.spacing = 16
        references.axis = .vertical; references.spacing = 12
        let collapse = UIButton(type: .system)
        collapse.setTitle("展开／收起提问选文", for: .normal)
        collapse.addTarget(self, action: #selector(toggleQuote), for: .touchUpInside)
        quote.isHidden = true; quote.accessibilityIdentifier = "question-selection"
        for label in [quote, status, scope, answer] {
            label.font = .preferredFont(forTextStyle: .body); label.adjustsFontForContentSizeCategory = true; label.numberOfLines = 0
        }
        status.accessibilityIdentifier = "question-status"
        scope.accessibilityIdentifier = "question-scope"
        answer.accessibilityIdentifier = "question-answer"
        scope.textColor = .secondaryLabel
        input.font = .preferredFont(forTextStyle: .body); input.adjustsFontForContentSizeCategory = true
        input.backgroundColor = .secondarySystemBackground; input.layer.cornerRadius = 8
        input.accessibilityIdentifier = "question-input"; input.accessibilityLabel = "问题"
        input.delegate = self; input.heightAnchor.constraint(equalToConstant: 120).isActive = true
        send.setTitle("发送问题", for: .normal); send.accessibilityIdentifier = "question-send"
        send.addTarget(self, action: #selector(sendQuestion), for: .touchUpInside)
        cancel.setTitle("取消生成", for: .normal); cancel.addTarget(self, action: #selector(cancelQuestion), for: .touchUpInside)
        retry.setTitle("重试保存", for: .normal); retry.addTarget(self, action: #selector(retrySave), for: .touchUpInside)
        materials.setTitle("查看本次实际发送材料", for: .normal); materials.addTarget(self, action: #selector(showMaterials), for: .touchUpInside)
        for item in [collapse, quote, input, status, retry, send, cancel, scope, materials, answer, references] { stack.addArrangedSubview(item) }
        for button in [collapse, send, cancel, retry, materials] {
            button.titleLabel?.font = .preferredFont(forTextStyle: .body); button.titleLabel?.adjustsFontForContentSizeCategory = true
            button.titleLabel?.numberOfLines = 0; button.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
        }
        scroll.translatesAutoresizingMaskIntoConstraints = false; stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(scroll); scroll.addSubview(stack)
        NSLayoutConstraint.activate([
            scroll.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor), scroll.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: view.trailingAnchor), scroll.bottomAnchor.constraint(equalTo: view.keyboardLayoutGuide.topAnchor),
            stack.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor, constant: 16), stack.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor, constant: -24),
            stack.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor, constant: 20), stack.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor, constant: -20),
            stack.widthAnchor.constraint(equalTo: scroll.frameLayoutGuide.widthAnchor, constant: -40)
        ])
        observer = NotificationCenter.default.addObserver(forName: QuestionStore.changed, object: library.questions, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.refresh() }
        }
        refresh()
    }
    private func refresh() {
        guard let record = library.questions.record(id) else { return }
        if !input.isFirstResponder { input.text = record.question }
        input.isEditable = record.state == .draft || record.state == .incomplete
        quote.text = (record.selectionParts ?? [record.selection]).map(\.quote).joined(separator: "\n")
        let unsaved = library.questions.unsaved(id)
        status.text = unsaved ? "保存失败：当前内容尚未保存，请重试保存；关闭应用可能丢失未存内容。" : record.state.label
        if let failure = record.failure { status.text! += "\n" + failure }
        status.textColor = unsaved || record.failure != nil ? .systemRed : .secondaryLabel
        let busy = record.state == .preparing || record.state == .generating
        send.isHidden = busy || record.state == .complete
        send.setTitle(record.state == .incomplete ? "重新请求（重新生成，不接续）" : "发送问题", for: .normal)
        send.isEnabled = !unsaved && !record.question.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        cancel.isHidden = !busy; retry.isHidden = !unsaved
        answer.text = record.answer; answer.isHidden = record.answer.isEmpty
        scope.text = record.notice.isEmpty ? "发送前会告知服务与原文范围；可能包括当前书其他章节。资料未齐时可等待或主动局部解释。" : record.notice
        materials.isHidden = record.evidence.isEmpty
        if shownReferences != record.citations {
            shownReferences = record.citations
            for view in references.arrangedSubviews { references.removeArrangedSubview(view); view.removeFromSuperview() }
            for (index, evidence) in record.citations.enumerated() {
                let button = UIButton(type: .system)
                button.setTitle("引用 \(evidence.id) · \(evidence.chapter)", for: .normal)
                button.accessibilityIdentifier = "question-reference-\(index)"
                button.titleLabel?.numberOfLines = 0; button.titleLabel?.font = .preferredFont(forTextStyle: .body)
                button.titleLabel?.adjustsFontForContentSizeCategory = true
                button.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
                button.addAction(UIAction { [weak self] _ in self?.open(evidence) }, for: .touchUpInside)
                references.addArrangedSubview(button)
            }
        }
    }
    func textViewDidChange(_ textView: UITextView) { library.questions.edit(id, text: textView.text) }
    @objc private func toggleQuote() { quote.isHidden.toggle() }
    @objc private func closePanel() { input.resignFirstResponder(); dismiss(animated: true) }
    @objc private func cancelQuestion() { library.questions.cancel(id) }
    @objc private func retrySave() { library.questions.retrySave(id) }
    @objc private func showMaterials() {
        guard let record = library.questions.record(id) else { return }
        navigationController?.pushViewController(EvidenceController(values: record.evidence), animated: true)
    }
    @objc private func sendQuestion() {
        input.resignFirstResponder()
        guard let record = library.questions.record(id) else { return }
        do {
            let store = try AIConfigurationStore(root: library.root)
            guard let configuration = store.configurations.first(where: { $0.id == store.selectedID }) else { throw QuestionError.configuration }
            let ready = library.preparation.states[record.bookID]?.ready == true
            let message = "问题、选文、附近原文" + (ready ? "和当前书关键词命中（可能来自其他章节）" : "（当前资料未齐，仅可主动选择局部解释）") + "将交给“\(configuration.name)”（\(configuration.address)），可能产生费用。单次原文容量有限，实际材料和不足范围将记录在本对话。"
            let alert = UIAlertController(title: ready ? "发送书内原文" : "资料尚未准备完整", message: message, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: ready ? "发送并查找书内依据" : "仅用选文和邻文解释", style: .default) { [weak self] _ in
                guard let self else { return }; self.library.questions.send(self.id, library: self.library, local: !ready)
            })
            alert.addAction(UIAlertAction(title: ready ? "取消" : "等待资料准备", style: .cancel))
            present(alert, animated: true)
        } catch {
            let alert = UIAlertController(title: "尚未发送", message: (error as? QuestionError)?.errorDescription ?? "服务配置无法读取，请到“我的 → AI 服务”检查。", preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "知道了", style: .default)); present(alert, animated: true)
        }
    }
    private func open(_ evidence: QuestionEvidence) {
        let page = EvidenceController(values: [evidence]) { [weak self] in
            guard let self, let record = self.library.questions.record(self.id), let target = try? evidence.location(), let origin = try? record.selection.location() else { return }
            if let jump = self.jump { self.dismiss(animated: true) { jump(target, origin) } }
            else { self.openReader(record, target: target, origin: origin) }
        }
        navigationController?.pushViewController(page, animated: true)
    }
    private func openReader(_ record: ReadingQuestion, target: Locator, origin: Locator) {
        guard let book = library.books.first(where: { $0.id == record.bookID }), FileManager.default.fileExists(atPath: library.fileURL(for: book).path) else {
            let alert = UIAlertController(title: "原文不可用", message: "引用文字仍可回看，当前无法跳转原书。", preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "知道了", style: .default)); present(alert, animated: true); return
        }
        Task {
            do {
                let publication = try await library.open(book)
                let reader = try ReaderController(book: book, publication: publication, library: library, target: target)
                reader.questionOrigin = origin; reader.modalPresentationStyle = .fullScreen
                present(reader, animated: true)
            } catch {
                let alert = UIAlertController(title: "原文不可用", message: "引用文字已保留，未能打开原书。", preferredStyle: .alert)
                alert.addAction(UIAlertAction(title: "知道了", style: .default)); present(alert, animated: true)
            }
        }
    }
}

@MainActor
final class EvidenceController: UITableViewController {
    private let values: [QuestionEvidence]
    private let jump: (() -> Void)?
    init(values: [QuestionEvidence], jump: (() -> Void)? = nil) { self.values = values; self.jump = jump; super.init(style: .insetGrouped) }
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }
    override func viewDidLoad() {
        super.viewDidLoad(); title = "原文材料"
        if jump != nil { navigationItem.rightBarButtonItem = UIBarButtonItem(title: "跳转原文", style: .plain, target: self, action: #selector(go)) }
    }
    @objc private func go() { jump?() }
    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { values.count }
    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let value = values[indexPath.row], cell = UITableViewCell(style: .subtitle, reuseIdentifier: nil)
        cell.textLabel?.text = "\(value.id) · \(value.chapter)\n\(value.quote)"
        cell.detailTextLabel?.text = value.context
        cell.textLabel?.numberOfLines = 0; cell.detailTextLabel?.numberOfLines = 0
        cell.selectionStyle = .none
        return cell
    }
}

@MainActor
final class QuestionHistoryController: UITableViewController {
    private let library: LibraryStore
    private var observer: NSObjectProtocol?
    init(library: LibraryStore) { self.library = library; super.init(style: .insetGrouped) }
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }
    deinit { if let observer { NotificationCenter.default.removeObserver(observer) } }
    override func viewDidLoad() {
        super.viewDidLoad(); title = "对话"; tableView.accessibilityIdentifier = "question-history"
        observer = NotificationCenter.default.addObserver(forName: QuestionStore.changed, object: library.questions, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.tableView.reloadData() }
        }
    }
    override func viewWillAppear(_ animated: Bool) { super.viewWillAppear(animated); tableView.reloadData() }
    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { max(1, library.questions.records.count) }
    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = UITableViewCell(style: .subtitle, reuseIdentifier: nil)
        if library.questions.loadFailed { cell.textLabel?.text = "对话读取失败，点此重试；未覆盖原记录" }
        else if library.questions.records.isEmpty { cell.textLabel?.text = "还没有对话；阅读时选文提问" }
        else {
            let record = library.questions.records[indexPath.row]
            cell.textLabel?.text = record.question.isEmpty ? "未填写的问题草稿" : record.question
            cell.detailTextLabel?.text = record.bookTitle + " · " + (library.questions.unsaved(record.id) ? "尚未保存" : record.state.label)
            cell.accessibilityIdentifier = "question-\(record.id)"; cell.accessoryType = .disclosureIndicator
        }
        cell.textLabel?.numberOfLines = 0; cell.detailTextLabel?.numberOfLines = 0; return cell
    }
    override func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true)
        if library.questions.loadFailed { library.questions.load(); tableView.reloadData(); return }
        guard !library.questions.records.isEmpty else { return }
        let controller = QuestionController(library: library, id: library.questions.records[indexPath.row].id)
        let navigation = UINavigationController(rootViewController: controller); navigation.modalPresentationStyle = .pageSheet
        navigation.sheetPresentationController?.detents = [.large()]; present(navigation, animated: true)
    }
}
