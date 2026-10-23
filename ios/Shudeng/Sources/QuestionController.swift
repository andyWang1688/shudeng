import UIKit
import ReadiumShared

@MainActor
final class QuestionController: UIViewController, UITextViewDelegate {
    private let library: LibraryStore
    private var id: UUID
    private let jump: ((Locator, Locator) -> Void)?
    private let scroll = UIScrollView()
    private let messages = UIStackView()
    private let composer = UIStackView()
    private let input = UITextView()
    private let placeholder = BookDesign.label("问问书灯…", size: 16, colour: BookDesign.secondary)
    private let status = BookDesign.label(nil, size: 12, colour: BookDesign.secondary)
    private let scope = BookDesign.label(nil, size: 12, colour: BookDesign.secondary)
    private let quote = BookDesign.label(nil)
    private let selection = UIButton(type: .system)
    private let range = UISegmentedControl(items: ["整书", "仅已读"])
    private let send = UIButton(type: .system)
    private let cancel = UIButton(type: .system)
    private let retry = UIButton(type: .system)
    private let materials = UIButton(type: .system)
    private let followUp = UIButton(type: .system)
    private var observer: NSObjectProtocol?
    private var expanded: Set<UUID> = []
    private var rendered = ""
    private var referenceFocus: (identifier: String, range: NSRange?)?
    private var returningFromReference = false

    init(library: LibraryStore, id: UUID, jump: ((Locator, Locator) -> Void)? = nil) {
        self.library = library; self.id = id; self.jump = jump
        super.init(nibName: nil, bundle: nil)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }
    deinit { if let observer { NotificationCenter.default.removeObserver(observer) } }
    override func viewDidLoad() {
        super.viewDidLoad()
        title = "问问书灯"; view.backgroundColor = BookDesign.paper
        navigationItem.rightBarButtonItem = UIBarButtonItem(image: UIImage(systemName: "xmark"), style: .plain, target: self, action: #selector(closePanel))
        navigationItem.rightBarButtonItem?.accessibilityLabel = "关闭"
        scroll.keyboardDismissMode = .interactive; scroll.accessibilityIdentifier = "question-scroll"
        messages.axis = .vertical; messages.spacing = 24
        composer.axis = .vertical; composer.spacing = 8; composer.backgroundColor = BookDesign.paper
        status.accessibilityIdentifier = "question-status"; scope.accessibilityIdentifier = "question-scope"
        quote.font = BookDesign.readingFont(15); quote.accessibilityIdentifier = "question-selection"; quote.isHidden = true
        selection.contentHorizontalAlignment = .leading
        BookDesign.button(selection, title: "附带选文", symbol: "text.quote")
        selection.accessibilityLabel = "展开／收起提问选文"
        selection.addTarget(self, action: #selector(toggleQuote), for: .touchUpInside)
        range.accessibilityIdentifier = "question-reading-range"
        range.addTarget(self, action: #selector(changeRange), for: .valueChanged)
        let help = UIButton(type: .system)
        help.setImage(UIImage(systemName: "info.circle"), for: .normal); help.accessibilityLabel = "问答范围说明"
        help.widthAnchor.constraint(equalToConstant: 44).isActive = true
        help.addAction(UIAction { [weak self] _ in self?.rangeInformation() }, for: .touchUpInside)
        let ranges = UIStackView(arrangedSubviews: [range, help]); ranges.spacing = 8
        input.font = BookDesign.font(16); input.adjustsFontForContentSizeCategory = true
        input.textColor = BookDesign.ink; input.backgroundColor = .clear
        input.textContainerInset = .init(top: 12, left: 12, bottom: 12, right: 10)
        input.accessibilityIdentifier = "question-input"; input.accessibilityLabel = "问题"; input.delegate = self
        input.heightAnchor.constraint(equalToConstant: 76).isActive = true
        placeholder.isUserInteractionEnabled = false
        input.addSubview(placeholder); placeholder.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([placeholder.topAnchor.constraint(equalTo: input.topAnchor, constant: 12),
                                     placeholder.leadingAnchor.constraint(equalTo: input.leadingAnchor, constant: 17)])
        BookDesign.button(send, title: "发送", symbol: "arrow.up", filled: true)
        send.accessibilityIdentifier = "question-send"; send.addTarget(self, action: #selector(sendQuestion), for: .touchUpInside)
        send.widthAnchor.constraint(greaterThanOrEqualToConstant: 64).isActive = true
        let field = UIStackView(arrangedSubviews: [input, send]); field.alignment = .center; field.spacing = 4
        field.backgroundColor = BookDesign.surface; field.layer.cornerRadius = 16
        field.isLayoutMarginsRelativeArrangement = true; field.layoutMargins = .init(top: 0, left: 0, bottom: 0, right: 8)
        BookDesign.button(cancel, title: "取消生成"); cancel.addTarget(self, action: #selector(cancelQuestion), for: .touchUpInside)
        BookDesign.button(retry, title: "重试保存"); retry.addTarget(self, action: #selector(retrySave), for: .touchUpInside)
        BookDesign.button(materials, title: "查看本次实际发送材料", symbol: "doc.text")
        materials.addTarget(self, action: #selector(showMaterials), for: .touchUpInside)
        BookDesign.button(followUp, title: "继续追问", symbol: "arrow.turn.down.right")
        followUp.accessibilityIdentifier = "question-follow-up"; followUp.addTarget(self, action: #selector(continueConversation), for: .touchUpInside)
        for child in [selection, quote, ranges, field, cancel, retry] { composer.addArrangedSubview(child) }
        for child in [scroll, composer] { child.translatesAutoresizingMaskIntoConstraints = false; view.addSubview(child) }
        messages.translatesAutoresizingMaskIntoConstraints = false; scroll.addSubview(messages)
        NSLayoutConstraint.activate([
            scroll.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor), scroll.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: view.trailingAnchor), scroll.bottomAnchor.constraint(equalTo: composer.topAnchor, constant: -8),
            composer.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 20), composer.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -20),
            composer.bottomAnchor.constraint(equalTo: view.keyboardLayoutGuide.topAnchor, constant: -8),
            messages.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor, constant: 16),
            messages.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor, constant: -16),
            messages.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor, constant: 20),
            messages.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor, constant: -20),
            messages.widthAnchor.constraint(equalTo: scroll.frameLayoutGuide.widthAnchor, constant: -40)
        ])
        observer = NotificationCenter.default.addObserver(forName: QuestionStore.changed, object: library.questions, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.refresh() }
        }
        refresh()
    }
    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        if returningFromReference {
            returningFromReference = false
            if let focus = referenceFocus, let target = descendant(with: focus.identifier, in: view) {
                if let text = target as? UITextView, let range = focus.range { text.selectedRange = range }
                UIAccessibility.post(notification: .layoutChanged, argument: target)
            }
        }
    }
    private func refresh() {
        guard let record = library.questions.record(id) else { return }
        let editable = record.state == .draft || record.state == .incomplete
        if !input.isFirstResponder { input.text = editable ? record.question : "" }
        input.isEditable = editable || record.state == .complete
        placeholder.text = record.state == .complete || (record.turnIndex ?? 0) > 0 ? "继续问书灯…" : "问问书灯…"
        placeholder.isHidden = !input.text.isEmpty
        selection.isHidden = record.freeQuestion == true || !editable
        quote.text = (record.selectionParts ?? [record.selection]).map(\.quote).joined(separator: "\n")
        quote.isHidden = selection.isHidden || !expanded.contains(id)
        range.selectedSegmentIndex = record.onlyRead == true ? 1 : 0; range.isEnabled = editable
        let busy = record.state == .preparing || record.state == .generating
        let unsaved = library.questions.unsaved(id), available = library.sourceAvailable(for: record.bookID)
        send.isHidden = busy
        send.isEnabled = available && !unsaved && editable && !record.question.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        send.accessibilityLabel = record.state == .incomplete ? "重新请求（重新生成，不接续）" : "发送问题"
        cancel.isHidden = !busy; retry.isHidden = !unsaved
        status.text = unsaved ? "保存失败：当前内容尚未保存，请重试保存。" : record.state.label
        if let failure = record.failure { status.text! += "\n" + failure }
        if !available { status.text! += "\n原书不可用，记录仍保留；重新导入相同文件后可返回原文。" }
        status.textColor = unsaved || record.failure != nil ? .systemRed : BookDesign.secondary
        scope.text = record.notice.isEmpty ? "仅围绕当前书回答；发送前会告知服务与原文范围。" : record.notice
        materials.isHidden = record.evidence.isEmpty
        followUp.isHidden = record.state != .complete; followUp.isEnabled = !unsaved && available
        let turns = library.questions.conversation(record.conversation)?.turns ?? [record]
        let signature = turns.map { "\($0.id)|\($0.question)|\($0.answer)|\($0.state)|\($0.citations)|\(expanded.contains($0.id))" }.joined()
        if signature != rendered {
            rendered = signature
            let offset = scroll.contentOffset
            for view in messages.arrangedSubviews { messages.removeArrangedSubview(view); view.removeFromSuperview() }
            for turn in turns where turn.state != .draft { append(turn, latest: turn.id == id) }
            for child in [status, scope, materials, followUp] { messages.addArrangedSubview(child) }
            view.layoutIfNeeded(); scroll.setContentOffset(offset, animated: false)
        }
    }
    private func append(_ turn: ReadingQuestion, latest: Bool) {
        let question = BookDesign.label(turn.question, size: 16)
        question.accessibilityIdentifier = "question-user-\(turn.id)"; question.accessibilityLabel = "你的提问，" + turn.question
        let bubble = UIStackView(); bubble.axis = .vertical; bubble.spacing = 8
        bubble.backgroundColor = BookDesign.surface; bubble.layer.cornerRadius = 16
        bubble.isLayoutMarginsRelativeArrangement = true; bubble.layoutMargins = .init(top: 12, left: 16, bottom: 12, right: 16)
        if turn.freeQuestion != true {
            let attachment = UIButton(type: .system)
            BookDesign.button(attachment, title: expanded.contains(turn.id) ? "收起选文" : "附带选文", symbol: "text.quote")
            attachment.contentHorizontalAlignment = .leading; attachment.accessibilityIdentifier = "question-attachment-\(turn.id)"
            attachment.addAction(UIAction { [weak self] _ in
                guard let self else { return }
                if self.expanded.contains(turn.id) { self.expanded.remove(turn.id) } else { self.expanded.insert(turn.id) }
                self.refresh()
            }, for: .touchUpInside)
            bubble.addArrangedSubview(attachment)
            if expanded.contains(turn.id) {
                let text = BookDesign.label((turn.selectionParts ?? [turn.selection]).map(\.quote).joined(separator: "\n"), size: 15, colour: BookDesign.secondary)
                text.font = BookDesign.readingFont(15); text.accessibilityIdentifier = "question-selection-\(turn.id)"
                bubble.addArrangedSubview(text)
            }
        }
        bubble.addArrangedSubview(question)
        let row = UIView(); bubble.translatesAutoresizingMaskIntoConstraints = false; row.addSubview(bubble)
        NSLayoutConstraint.activate([bubble.leadingAnchor.constraint(greaterThanOrEqualTo: row.leadingAnchor, constant: 28),
            bubble.trailingAnchor.constraint(equalTo: row.trailingAnchor), bubble.topAnchor.constraint(equalTo: row.topAnchor), bubble.bottomAnchor.constraint(equalTo: row.bottomAnchor)])
        messages.addArrangedSubview(row)
        let identity = BookDesign.label("书灯 · AI", size: 13, weight: .medium)
        let lamp = UIImageView(image: UIImage(systemName: "lightbulb")); lamp.tintColor = BookDesign.lamp
        lamp.contentMode = .scaleAspectFit; lamp.backgroundColor = BookDesign.glow; lamp.layer.cornerRadius = 16
        lamp.widthAnchor.constraint(equalToConstant: 32).isActive = true; lamp.heightAnchor.constraint(equalToConstant: 32).isActive = true
        let heading = UIStackView(arrangedSubviews: [lamp, identity, UIView()]); heading.spacing = 8; heading.alignment = .center
        let body = CitationAnswerView(answer: turn.answer, citations: turn.citations) { [weak self] evidence, text, range in
            self?.referenceFocus = (text.accessibilityIdentifier ?? "", range)
            self?.open(evidence, origin: turn)
        }
        body.textContainerInset = .zero; body.textContainer.lineFragmentPadding = 0
        body.font = BookDesign.font(17); body.adjustsFontForContentSizeCategory = true; body.textColor = BookDesign.ink
        body.isHidden = turn.answer.isEmpty
        body.accessibilityIdentifier = latest ? "question-answer" : "question-answer-\(turn.id)"
        let reply = UIStackView(arrangedSubviews: [heading, body]); reply.axis = .vertical; reply.spacing = 12
        for (index, evidence) in turn.citations.enumerated() {
            let button = UIButton(type: .system)
            BookDesign.button(button, title: "\(index + 1) · \(evidence.chapter)\n\(String(evidence.quote.prefix(110)))", symbol: "arrow.up.right")
            button.configuration?.baseForegroundColor = BookDesign.ink
            button.configuration?.background.backgroundColor = BookDesign.surface
            button.contentHorizontalAlignment = .leading; button.titleLabel?.numberOfLines = 0
            button.accessibilityIdentifier = latest ? "question-reference-\(index)" : "question-reference-\(turn.id)-\(index)"
            button.addAction(UIAction { [weak self, weak button] _ in
                self?.referenceFocus = (button?.accessibilityIdentifier ?? "", nil); self?.open(evidence, origin: turn)
            }, for: .touchUpInside)
            reply.addArrangedSubview(button)
        }
        messages.addArrangedSubview(reply)
    }
    func textViewShouldBeginEditing(_ textView: UITextView) -> Bool {
        if library.questions.record(id)?.state == .complete {
            guard createFollowUp() else { return false }
        }
        return true
    }
    func textViewDidChange(_ textView: UITextView) {
        placeholder.isHidden = !textView.text.isEmpty
        library.questions.edit(id, text: textView.text); refresh()
    }
    private func createFollowUp() -> Bool {
        guard let record = library.questions.record(id), let next = library.questions.followUp(record.conversation) else { return false }
        id = next; input.text = ""; refresh(); return true
    }
    @objc private func continueConversation() { if createFollowUp() { input.becomeFirstResponder() } }
    @objc private func toggleQuote() {
        if expanded.contains(id) { expanded.remove(id) } else { expanded.insert(id) }; refresh()
    }
    @objc private func changeRange() { library.questions.setOnlyRead(id, value: range.selectedSegmentIndex == 1); refresh() }
    @objc private func closePanel() { input.resignFirstResponder(); dismiss(animated: true) }
    @objc private func cancelQuestion() { library.questions.cancel(id) }
    @objc private func retrySave() { library.questions.retrySave(id) }
    @objc private func showMaterials() {
        guard let record = library.questions.record(id) else { return }
        navigationController?.pushViewController(EvidenceController(values: record.evidence), animated: true)
    }
    private func rangeInformation() {
        let alert = UIAlertController(title: "问答范围", message: "整书允许参考未读章节。仅已读只参考在“目录与书签 → 已读范围”明确确认的章节，可能缺少后文解释；访问与翻页不会自动确认。历史越界时请新建问题。", preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "知道了", style: .default)); present(alert, animated: true)
    }
    @objc private func sendQuestion() {
        input.resignFirstResponder()
        guard let record = library.questions.record(id) else { return }
        do {
            guard library.sourceAvailable(for: record.bookID) else { throw LibraryError.missing }
            let store = try AIConfigurationStore(root: library.root, secrets: library.secrets)
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
            alert.addAction(UIAlertAction(title: ready ? "取消" : "等待资料准备", style: .cancel)); present(alert, animated: true)
        } catch {
            let alert = UIAlertController(title: "尚未发送", message: (error as? QuestionError)?.errorDescription ?? "服务配置无法读取，请到“我的 → AI 服务”检查。", preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "知道了", style: .default)); present(alert, animated: true)
        }
    }
    private func open(_ evidence: QuestionEvidence, origin record: ReadingQuestion) {
        guard let target = try? evidence.location(), let origin = try? record.origin() else { return }
        input.resignFirstResponder(); returningFromReference = true
        if let jump { dismiss(animated: true) { jump(target, origin) }; return }
        guard let book = library.books.first(where: { $0.id == record.bookID }), library.sourceAvailable(for: record.bookID) else {
            let alert = UIAlertController(title: "原文不可用", message: "引用文字仍可回看；重新导入相同文件后可定位原书。", preferredStyle: .alert)
            alert.addAction(UIAlertAction(title: "知道了", style: .default)); present(alert, animated: true); return
        }
        Task {
            do {
                let publication = try await library.open(book)
                let reader = try ReaderController(book: book, publication: publication, library: library, target: target)
                reader.referenceReturn = { [weak reader] in reader?.dismiss(animated: true) }
                reader.questionOrigin = origin; reader.modalPresentationStyle = .fullScreen
                present(reader, animated: true)
            } catch {
                let alert = UIAlertController(title: "原文不可用", message: "引用文字已保留，未能打开原书。", preferredStyle: .alert)
                alert.addAction(UIAlertAction(title: "知道了", style: .default)); present(alert, animated: true)
            }
        }
    }
    func restoreReferenceFocus() { returningFromReference = true }
    private func descendant(with identifier: String, in view: UIView) -> UIView? {
        if view.accessibilityIdentifier == identifier { return view }
        for child in view.subviews { if let found = descendant(with: identifier, in: child) { return found } }
        return nil
    }
}

/// Only verified citation IDs become links. Unverified model text cannot create destinations.
private final class CitationAnswerView: UITextView, UITextViewDelegate {
    private let citations: [QuestionEvidence]
    private let open: (QuestionEvidence, UITextView, NSRange) -> Void
    init(answer: String, citations: [QuestionEvidence], open: @escaping (QuestionEvidence, UITextView, NSRange) -> Void) {
        self.citations = citations; self.open = open
        super.init(frame: .zero, textContainer: nil)
        isEditable = false; isScrollEnabled = false; backgroundColor = .clear; delegate = self
        var text = answer
        // The protocol supplies answer-level sources, not per-sentence alignment.
        // A trailing inline list makes no claim about which individual sentence each source supports.
        if !citations.isEmpty { text += "\n\n书内依据 " + citations.indices.map { "[\($0 + 1)]" }.joined(separator: "  ") }
        let paragraph = NSMutableParagraphStyle(); paragraph.lineSpacing = 7
        let attributed = NSMutableAttributedString(string: text, attributes: [
            .font: BookDesign.font(17), .foregroundColor: BookDesign.ink, .paragraphStyle: paragraph])
        for (index, evidence) in citations.enumerated() {
            let markers = ["[\(evidence.id)]", "[\(index + 1)]"]
            for marker in markers {
                var search = NSRange(location: 0, length: (text as NSString).length)
                while search.length > 0 {
                    let range = (text as NSString).range(of: marker, range: search)
                    guard range.location != NSNotFound else { break }
                    attributed.addAttribute(.link, value: "shudeng://citation/\(index)", range: range)
                    search = NSRange(location: NSMaxRange(range), length: (text as NSString).length - NSMaxRange(range))
                }
            }
        }
        attributedText = attributed
        linkTextAttributes = [.foregroundColor: BookDesign.lamp, .backgroundColor: BookDesign.glow]
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }
    func textView(_ textView: UITextView, shouldInteractWith URL: URL, in characterRange: NSRange, interaction: UITextItemInteraction) -> Bool {
        if URL.scheme == "shudeng", URL.host == "citation", let index = Int(URL.lastPathComponent), citations.indices.contains(index) { open(citations[index], self, characterRange) }
        return false
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
        BookDesign.table(tableView)
        if jump != nil { navigationItem.rightBarButtonItem = UIBarButtonItem(title: "跳转原文", style: .plain, target: self, action: #selector(go)) }
    }
    @objc private func go() { jump?() }
    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { values.count }
    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let value = values[indexPath.row], cell = UITableViewCell(style: .subtitle, reuseIdentifier: nil)
        cell.textLabel?.text = "\(value.id) · \(value.chapter)\n\(value.quote)"
        cell.detailTextLabel?.text = value.context
        cell.textLabel?.numberOfLines = 0; cell.detailTextLabel?.numberOfLines = 0
        cell.textLabel?.font = BookDesign.readingFont(17); cell.textLabel?.textColor = BookDesign.ink
        cell.detailTextLabel?.font = BookDesign.font(14); cell.detailTextLabel?.textColor = BookDesign.secondary
        cell.textLabel?.adjustsFontForContentSizeCategory = true; cell.detailTextLabel?.adjustsFontForContentSizeCategory = true
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
        navigationController?.navigationBar.prefersLargeTitles = false; BookDesign.table(tableView)
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
            let date = record.updated.formatted(date: .abbreviated, time: .shortened)
            cell.detailTextLabel?.text = String(record.answer.prefix(90)) + "\n" + date + " · " + (library.questions.unsaved(record.id) ? "尚未保存" : record.state.label)
            cell.accessibilityIdentifier = "question-\(conversation.id)"; cell.accessoryType = .disclosureIndicator
        }
        cell.textLabel?.font = BookDesign.font(17, weight: .medium); cell.textLabel?.textColor = BookDesign.ink
        cell.detailTextLabel?.font = BookDesign.font(13); cell.detailTextLabel?.textColor = BookDesign.secondary
        cell.textLabel?.adjustsFontForContentSizeCategory = true; cell.detailTextLabel?.adjustsFontForContentSizeCategory = true
        cell.contentView.directionalLayoutMargins = .init(top: 16, leading: 0, bottom: 16, trailing: 0)
        cell.textLabel?.numberOfLines = 2; cell.detailTextLabel?.numberOfLines = 3; return cell
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
