import UIKit
import ReadiumShared

@MainActor
final class QuestionController: UIViewController, UITextViewDelegate {
    private let library: LibraryStore
    private var id: UUID
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
    private let followUp = UIButton(type: .system)
    private let history = UIStackView()
    private let range = UISegmentedControl(items: ["整书", "仅已读"])
    private let rangeHelp = UILabel()
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
        let free = library.questions.record(id)?.freeQuestion == true
        title = free ? "问这本书" : "选文问答"
        view.backgroundColor = .systemBackground
        navigationItem.rightBarButtonItem = UIBarButtonItem(title: "关闭", style: .plain, target: self, action: #selector(closePanel))
        let scroll = UIScrollView(); scroll.keyboardDismissMode = .interactive; scroll.accessibilityIdentifier = "question-scroll"
        stack.axis = .vertical; stack.spacing = 16
        history.axis = .vertical; history.spacing = 16
        references.axis = .vertical; references.spacing = 12
        let collapse = UIButton(type: .system)
        collapse.setTitle("展开／收起提问选文", for: .normal)
        collapse.isHidden = free
        collapse.addTarget(self, action: #selector(toggleQuote), for: .touchUpInside)
        quote.isHidden = true; quote.accessibilityIdentifier = "question-selection"
        for label in [quote, status, scope, answer] {
            label.font = .preferredFont(forTextStyle: .body); label.adjustsFontForContentSizeCategory = true; label.numberOfLines = 0
        }
        status.accessibilityIdentifier = "question-status"
        scope.accessibilityIdentifier = "question-scope"
        answer.accessibilityIdentifier = "question-answer"
        scope.textColor = .secondaryLabel
        range.accessibilityIdentifier = "question-reading-range"
        range.addTarget(self, action: #selector(changeRange), for: .valueChanged)
        rangeHelp.font = .preferredFont(forTextStyle: .footnote); rangeHelp.adjustsFontForContentSizeCategory = true
        rangeHelp.numberOfLines = 0; rangeHelp.textColor = .secondaryLabel
        rangeHelp.text = "仅已读只参考你在“目录与书签 → 已读范围”确认的章节，可能缺少后文解释。访问与翻页不会自动确认；历史超出范围时须新建问题。"
        input.font = .preferredFont(forTextStyle: .body); input.adjustsFontForContentSizeCategory = true
        input.backgroundColor = .secondarySystemBackground; input.layer.cornerRadius = 8
        input.accessibilityIdentifier = "question-input"; input.accessibilityLabel = "问题"
        input.delegate = self; input.heightAnchor.constraint(equalToConstant: 120).isActive = true
        send.setTitle("发送问题", for: .normal); send.accessibilityIdentifier = "question-send"
        send.addTarget(self, action: #selector(sendQuestion), for: .touchUpInside)
        cancel.setTitle("取消生成", for: .normal); cancel.addTarget(self, action: #selector(cancelQuestion), for: .touchUpInside)
        retry.setTitle("重试保存", for: .normal); retry.addTarget(self, action: #selector(retrySave), for: .touchUpInside)
        materials.setTitle("查看本次实际发送材料", for: .normal); materials.addTarget(self, action: #selector(showMaterials), for: .touchUpInside)
        followUp.setTitle("继续追问", for: .normal); followUp.accessibilityIdentifier = "question-follow-up"
        followUp.addTarget(self, action: #selector(continueConversation), for: .touchUpInside)
        for item in [history, collapse, quote, range, rangeHelp, input, status, retry, send, cancel, scope, materials, answer, references, followUp] { stack.addArrangedSubview(item) }
        for button in [collapse, send, cancel, retry, materials, followUp] {
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
        let conversation = library.questions.conversation(record.conversation)
        for view in history.arrangedSubviews { history.removeArrangedSubview(view); view.removeFromSuperview() }
        for previous in conversation?.turns ?? [] where (previous.turnIndex ?? 0) < (record.turnIndex ?? 0) {
            let label = UILabel(); label.numberOfLines = 0
            label.font = .preferredFont(forTextStyle: .body); label.adjustsFontForContentSizeCategory = true
            label.text = previous.question + "\n" + previous.answer + "\n" + previous.state.label
            history.addArrangedSubview(label)
            for evidence in previous.citations {
                let button = UIButton(type: .system); button.setTitle("引用 " + evidence.chapter, for: .normal)
                button.titleLabel?.numberOfLines = 0
                button.addAction(UIAction { [weak self] _ in self?.open(evidence) }, for: .touchUpInside)
                history.addArrangedSubview(button)
            }
        }
        if !input.isFirstResponder { input.text = record.question }
        input.isEditable = record.state == .draft || record.state == .incomplete
        range.selectedSegmentIndex = record.onlyRead == true ? 1 : 0
        range.isEnabled = input.isEditable
        quote.text = (record.selectionParts ?? [record.selection]).map(\.quote).joined(separator: "\n")
        let unsaved = library.questions.unsaved(id)
        followUp.isHidden = record.state != .complete
        let available = library.sourceAvailable(for: record.bookID)
        followUp.isEnabled = !unsaved && available
        status.text = unsaved ? "保存失败：当前内容尚未保存，请重试保存；关闭应用可能丢失未存内容。" : record.state.label
        if let failure = record.failure { status.text! += "\n" + failure }
        if !available { status.text! += "\n原书不可用，记录仍保留；重新导入相同文件后可返回原文并继续问答。" }
        status.textColor = unsaved || record.failure != nil ? .systemRed : .secondaryLabel
        let busy = record.state == .preparing || record.state == .generating
        send.isHidden = busy || record.state == .complete
        send.setTitle(record.state == .incomplete ? "重新请求（重新生成，不接续）" : "发送问题", for: .normal)
        send.isEnabled = available && !unsaved && !record.question.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
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
    @objc private func changeRange() { library.questions.setOnlyRead(id, value: range.selectedSegmentIndex == 1); refresh() }
    @objc private func continueConversation() {
        guard let record = library.questions.record(id), let next = library.questions.followUp(record.conversation) else { return }
        id = next; refresh(); input.becomeFirstResponder()
    }
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
            guard library.sourceAvailable(for: record.bookID) else { throw LibraryError.missing }
            let store = try AIConfigurationStore(root: library.root)
            guard let configuration = store.configurations.first(where: { $0.id == store.selectedID }) else { throw QuestionError.configuration }
            let ready = library.preparation.states[record.bookID]?.ready == true
            let continuing = (record.turnIndex ?? 0) > 0
            if continuing && !ready {
                let alert = UIAlertController(title: "资料尚未准备完整", message: "追问需要重新查书，请等待资料准备；草稿已保留。", preferredStyle: .alert)
                alert.addAction(UIAlertAction(title: "等待资料准备", style: .cancel)); present(alert, animated: true); return
            }
            let free = record.freeQuestion == true
            let message = (free ? "问题与本次查到的书内原文" : "问题、提问选文与本次查到的书内原文") + (ready ? "（可能来自其他章节）" : "（当前资料未齐，仅可主动选择局部解释）") + "将交给“\(configuration.name)”（\(configuration.address)），请求一次回答，可能产生费用。实际材料会记录在本对话；有限片段不代表完整概括全书。"
            let extra = continuing ? "本次还会发送此前各轮问题与回答以理解追问，历史回答不作为原文依据。容量不足会明确提示。" : ""
            let restriction = record.onlyRead == true ? "仅已读：仅发送明确确认已读章节内的原文，可能缺少后文解释。没有已读资料或选文、历史越界时不发送，请确认已读范围或新建问题。" : "整书：允许参考未读内容。"
            let alert = UIAlertController(title: ready ? "发送书内原文" : "资料尚未准备完整", message: restriction + message + extra, preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: ready ? "发送并查找书内依据" : (free ? "仅用已准备资料解释" : "仅用选文解释"), style: .default) { [weak self] _ in
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
            guard let self, let record = self.library.questions.record(self.id), let target = try? evidence.location(), let origin = try? record.origin() else { return }
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
    private var groups: [[ReadingConversation]] {
        Dictionary(grouping: library.questions.conversations, by: { $0.first.bookID }).values.map {
            $0.sorted { $0.updated > $1.updated }
        }.sorted { $0[0].updated > $1[0].updated }
    }
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
    override func numberOfSections(in tableView: UITableView) -> Int { max(1, groups.count) }
    override func tableView(_ tableView: UITableView, titleForHeaderInSection section: Int) -> String? { groups.isEmpty ? nil : groups[section][0].first.bookTitle }
    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { groups.isEmpty ? 1 : groups[section].count }
    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = UITableViewCell(style: .subtitle, reuseIdentifier: nil)
        if library.questions.loadFailed { cell.textLabel?.text = "对话读取失败，点此重试；未覆盖原记录" }
        else if library.questions.records.isEmpty { cell.textLabel?.text = "还没有对话；阅读时选文提问" }
        else {
            let conversation = groups[indexPath.section][indexPath.row], record = conversation.latest
            cell.textLabel?.text = conversation.title
            cell.detailTextLabel?.text = record.bookTitle + " · " + (library.questions.unsaved(record.id) ? "尚未保存" : record.state.label)
            cell.accessibilityIdentifier = "question-\(conversation.id)"; cell.accessoryType = .disclosureIndicator
        }
        cell.textLabel?.numberOfLines = 0; cell.detailTextLabel?.numberOfLines = 0; return cell
    }
    override func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true)
        if library.questions.loadFailed { library.questions.load(); tableView.reloadData(); return }
        guard !library.questions.records.isEmpty else { return }
        let controller = QuestionController(library: library, id: groups[indexPath.section][indexPath.row].latest.id)
        let navigation = UINavigationController(rootViewController: controller); navigation.modalPresentationStyle = .pageSheet
        navigation.sheetPresentationController?.detents = [.large()]; present(navigation, animated: true)
    }
    override func tableView(_ tableView: UITableView, trailingSwipeActionsConfigurationForRowAt indexPath: IndexPath) -> UISwipeActionsConfiguration? {
        guard !groups.isEmpty, !library.questions.loadFailed else { return nil }
        let conversation = groups[indexPath.section][indexPath.row]
        let rename = UIContextualAction(style: .normal, title: "改名") { [weak self] _, _, done in
            done(false); self?.rename(conversation)
        }
        let delete = UIContextualAction(style: .destructive, title: "删除") { [weak self] _, _, done in
            done(false); self?.delete(conversation)
        }
        let actions = UISwipeActionsConfiguration(actions: [delete, rename]); actions.performsFirstActionWithFullSwipe = false; return actions
    }
    private func rename(_ conversation: ReadingConversation) {
        let alert = UIAlertController(title: "对话改名", message: "生成中或内容尚未保存时请先取消生成或重试保存。", preferredStyle: .alert)
        alert.addTextField { $0.text = conversation.title; $0.accessibilityIdentifier = "conversation-name" }
        alert.addAction(UIAlertAction(title: "取消", style: .cancel))
        alert.addAction(UIAlertAction(title: "保存", style: .default) { [weak self] _ in
            guard let self else { return }
            if !self.library.questions.rename(conversation.id, title: alert.textFields?[0].text ?? "") { self.failure("改名尚未保存，原名称未变；请检查名称、生成及保存状态后重试。") }
        })
        present(alert, animated: true)
    }
    private func delete(_ conversation: ReadingConversation) {
        let alert = UIAlertController(title: "删除对话？", message: "删除本对话的所有轮次及引用快照；生成中的请求将取消。", preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "取消", style: .cancel))
        alert.addAction(UIAlertAction(title: "删除", style: .destructive) { [weak self] _ in
            guard let self else { return }
            if !self.library.questions.delete(conversation.id) { self.failure("删除失败，对话仍保留；生成已取消，请重试删除。") }
        })
        present(alert, animated: true)
    }
    private func failure(_ message: String) {
        let alert = UIAlertController(title: "操作未保存", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "知道了", style: .default)); present(alert, animated: true)
    }
}
