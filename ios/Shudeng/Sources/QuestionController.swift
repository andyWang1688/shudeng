import UIKit
import ReadiumShared

@MainActor
enum QuestionSheetPresentation {
    static let heightFraction: CGFloat = 0.76
    static let cornerRadius: CGFloat = 23

    static func configure(_ navigation: UINavigationController) {
        navigation.modalPresentationStyle = .pageSheet
        guard let sheet = navigation.sheetPresentationController else { return }
        sheet.detents = [
            .custom(identifier: .init("shudeng.question.76")) { context in
                min(
                    context.maximumDetentValue,
                    UIScreen.main.bounds.height * heightFraction
                )
            }
        ]
        sheet.prefersGrabberVisible = false
        sheet.preferredCornerRadius = cornerRadius
        sheet.prefersScrollingExpandsWhenScrolledToEdge = false
    }
}

private final class QuestionSheetHeader: UIView {
    let close = UIButton(type: .system)
    var onClose: (() -> Void)?

    override init(frame: CGRect) {
        super.init(frame: frame)
        accessibilityIdentifier = "question-sheet-header"

        let handle = UIView()
        handle.backgroundColor = BookDesign.secondary
        handle.alpha = 0.45
        handle.layer.cornerRadius = 2
        handle.accessibilityIdentifier = "question-sheet-handle"
        handle.isAccessibilityElement = true
        handle.accessibilityLabel = "问答面板把手"

        let lamp = UIImageView(image: BookDesign.symbol("lightbulb", size: 22))
        lamp.contentMode = .scaleAspectFit
        lamp.tintColor = BookDesign.ink
        lamp.setContentHuggingPriority(.required, for: .horizontal)
        lamp.widthAnchor.constraint(equalToConstant: 25).isActive = true
        lamp.heightAnchor.constraint(equalToConstant: 25).isActive = true

        let title = BookDesign.label("问问书灯", size: 17, weight: .semibold, style: .headline)
        let brand = UIStackView(arrangedSubviews: [lamp, title, UIView()])
        brand.spacing = 8
        brand.alignment = .center

        close.setImage(BookDesign.symbol("xmark", size: 18), for: .normal)
        close.tintColor = BookDesign.ink
        close.accessibilityLabel = "收起问答，继续阅读"
        close.accessibilityIdentifier = "question-close"
        close.addAction(UIAction { [weak self] _ in self?.onClose?() }, for: .touchUpInside)
        close.widthAnchor.constraint(equalToConstant: 44).isActive = true
        close.heightAnchor.constraint(equalToConstant: 44).isActive = true

        let row = UIStackView(arrangedSubviews: [brand, close])
        row.alignment = .center
        row.spacing = 4

        for child in [handle, row] {
            child.translatesAutoresizingMaskIntoConstraints = false
            addSubview(child)
        }
        NSLayoutConstraint.activate([
            handle.topAnchor.constraint(equalTo: topAnchor, constant: 8),
            handle.centerXAnchor.constraint(equalTo: centerXAnchor),
            handle.widthAnchor.constraint(equalToConstant: 33),
            handle.heightAnchor.constraint(equalToConstant: 4),
            row.topAnchor.constraint(equalTo: handle.bottomAnchor, constant: 6),
            row.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 23),
            row.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -15),
            row.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -4),
            row.heightAnchor.constraint(greaterThanOrEqualToConstant: 44)
        ])
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }
}

@MainActor
final class QuestionController: UIViewController, UITextViewDelegate {
    private let library: LibraryStore
    private var id: UUID
    private let jump: ((Locator, Locator) -> Void)?
    private let sheetHeader = QuestionSheetHeader()
    private let scroll = UIScrollView()
    private let messages = UIStackView()
    private let composer = UIStackView()
    private let composerDivider = UIView()
    private let composerContext = UIStackView()
    private let input = UITextView()
    private let placeholder = BookDesign.label("问问书灯…", size: 16, colour: BookDesign.secondary)
    private let statusBox = UIView()
    private let status = BookDesign.label(nil, size: 12, colour: BookDesign.secondary)
    private let scope = BookDesign.label(nil, size: 12, colour: BookDesign.secondary)
    private let quote = BookDesign.label(nil)
    private let selection = UIButton(type: .system)
    private let range = UISegmentedControl(items: ["整书", "仅已读"])
    private let help = UIButton(type: .system)
    private let send = UIButton(type: .system)
    private let cancel = UIButton(type: .system)
    private let retry = UIButton(type: .system)
    private let retryGeneration = UIButton(type: .system)
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
        title = "问问书灯"
        view.backgroundColor = BookDesign.paper
        view.accessibilityIdentifier = "question-sheet"
        view.layer.cornerRadius = QuestionSheetPresentation.cornerRadius
        view.layer.maskedCorners = [.layerMinXMinYCorner, .layerMaxXMinYCorner]
        view.clipsToBounds = true
        navigationItem.rightBarButtonItem = UIBarButtonItem(image: UIImage(systemName: "xmark"), style: .plain, target: self, action: #selector(closePanel))
        navigationItem.rightBarButtonItem?.accessibilityLabel = "关闭"
        sheetHeader.onClose = { [weak self] in self?.closePanel() }

        scroll.keyboardDismissMode = .interactive
        scroll.accessibilityIdentifier = "question-scroll"
        scroll.alwaysBounceVertical = true
        scroll.contentInset = UIEdgeInsets(top: 6, left: 0, bottom: 18, right: 0)
        messages.axis = .vertical
        messages.spacing = 24

        composer.axis = .vertical
        composer.spacing = 8
        composer.backgroundColor = BookDesign.paper
        composer.isLayoutMarginsRelativeArrangement = true
        composer.layoutMargins = .init(top: 12, left: 20, bottom: 12, right: 20)
        composer.accessibilityIdentifier = "question-composer"

        status.accessibilityIdentifier = "question-status"; scope.accessibilityIdentifier = "question-scope"
        statusBox.layer.cornerRadius = 12
        status.translatesAutoresizingMaskIntoConstraints = false
        statusBox.addSubview(status)
        NSLayoutConstraint.activate([
            status.topAnchor.constraint(equalTo: statusBox.topAnchor, constant: 9),
            status.leadingAnchor.constraint(equalTo: statusBox.leadingAnchor, constant: 11),
            status.trailingAnchor.constraint(equalTo: statusBox.trailingAnchor, constant: -11),
            status.bottomAnchor.constraint(equalTo: statusBox.bottomAnchor, constant: -9)
        ])
        quote.font = BookDesign.readingFont(13)
        quote.textColor = BookDesign.secondary
        quote.accessibilityIdentifier = "question-selection"
        quote.isHidden = true
        selection.contentHorizontalAlignment = .leading
        BookDesign.button(selection, title: "附带选文", symbol: "text.quote")
        selection.tintColor = BookDesign.lamp
        selection.accessibilityLabel = "展开／收起提问选文"
        selection.addTarget(self, action: #selector(toggleQuote), for: .touchUpInside)
        range.accessibilityIdentifier = "question-reading-range"
        range.addTarget(self, action: #selector(changeRange), for: .valueChanged)
        help.setImage(UIImage(systemName: "info.circle"), for: .normal); help.accessibilityLabel = "问答范围说明"
        help.tintColor = BookDesign.lamp
        help.widthAnchor.constraint(equalToConstant: 44).isActive = true
        help.addAction(UIAction { [weak self] _ in self?.rangeInformation() }, for: .touchUpInside)
        let ranges = UIStackView(arrangedSubviews: [range, help]); ranges.spacing = 8
        composerContext.axis = .vertical
        composerContext.spacing = 4
        composerContext.addArrangedSubview(selection)
        composerContext.addArrangedSubview(quote)
        composerContext.addArrangedSubview(ranges)

        input.font = BookDesign.font(14); input.adjustsFontForContentSizeCategory = true
        input.textColor = BookDesign.ink; input.backgroundColor = .clear
        input.textContainerInset = .init(top: 8, left: 8, bottom: 8, right: 4)
        input.accessibilityIdentifier = "question-input"; input.accessibilityLabel = "问题"; input.delegate = self
        input.heightAnchor.constraint(equalToConstant: 44).isActive = true
        placeholder.isUserInteractionEnabled = false
        input.addSubview(placeholder); placeholder.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([placeholder.topAnchor.constraint(equalTo: input.topAnchor, constant: 9),
                                     placeholder.leadingAnchor.constraint(equalTo: input.leadingAnchor, constant: 11)])
        var sendConfiguration = UIButton.Configuration.filled()
        sendConfiguration.image = BookDesign.symbol("arrow.up", size: 18)
        sendConfiguration.baseBackgroundColor = BookDesign.ink
        sendConfiguration.baseForegroundColor = BookDesign.paper
        sendConfiguration.background.cornerRadius = 13
        send.configuration = sendConfiguration
        send.accessibilityIdentifier = "question-send"; send.addTarget(self, action: #selector(sendQuestion), for: .touchUpInside)
        send.widthAnchor.constraint(equalToConstant: 44).isActive = true
        send.heightAnchor.constraint(equalToConstant: 44).isActive = true
        let field = UIStackView(arrangedSubviews: [input, send]); field.alignment = .center; field.spacing = 6
        field.accessibilityIdentifier = "question-composer-field"
        field.backgroundColor = BookDesign.wash; field.layer.cornerRadius = 16; field.layer.borderWidth = 1
        field.layer.borderColor = BookDesign.line.cgColor
        field.isLayoutMarginsRelativeArrangement = true; field.layoutMargins = .init(top: 6, left: 6, bottom: 6, right: 6)
        BookDesign.button(cancel, title: "取消生成"); cancel.addTarget(self, action: #selector(cancelQuestion), for: .touchUpInside)
        BookDesign.button(retry, title: "重试保存"); retry.addTarget(self, action: #selector(retrySave), for: .touchUpInside)
        BookDesign.button(materials, title: "查看本次实际发送材料", symbol: "doc.text")
        materials.addTarget(self, action: #selector(showMaterials), for: .touchUpInside)
        BookDesign.button(followUp, title: "继续追问", symbol: "arrow.turn.down.right")
        followUp.accessibilityIdentifier = "question-follow-up"; followUp.addTarget(self, action: #selector(continueConversation), for: .touchUpInside)
        BookDesign.button(retryGeneration, title: "重试回答", symbol: "arrow.clockwise")
        retryGeneration.contentHorizontalAlignment = .leading
        retryGeneration.accessibilityIdentifier = "question-retry-generation"
        retryGeneration.addTarget(self, action: #selector(retryGenerationTapped), for: .touchUpInside)
        composer.addArrangedSubview(composerContext)
        composer.addArrangedSubview(field)
        composer.addArrangedSubview(cancel)
        composer.addArrangedSubview(retry)
        composerDivider.backgroundColor = BookDesign.line
        for child in [sheetHeader, scroll, composerDivider, composer] {
            child.translatesAutoresizingMaskIntoConstraints = false
            view.addSubview(child)
        }
        messages.translatesAutoresizingMaskIntoConstraints = false; scroll.addSubview(messages)
        NSLayoutConstraint.activate([
            sheetHeader.topAnchor.constraint(equalTo: view.topAnchor),
            sheetHeader.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            sheetHeader.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            scroll.topAnchor.constraint(equalTo: sheetHeader.bottomAnchor),
            scroll.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            scroll.bottomAnchor.constraint(equalTo: composerDivider.topAnchor),
            composerDivider.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            composerDivider.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            composerDivider.bottomAnchor.constraint(equalTo: composer.topAnchor),
            composerDivider.heightAnchor.constraint(equalToConstant: 1),
            composer.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            composer.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            composer.bottomAnchor.constraint(equalTo: view.keyboardLayoutGuide.topAnchor),
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
    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        navigationController?.setNavigationBarHidden(true, animated: false)
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
        composerContext.isHidden = !editable
        let busy = record.state == .preparing || record.state == .generating
        let unsaved = library.questions.unsaved(id), available = library.sourceAvailable(for: record.bookID)
        send.isHidden = busy
        send.isEnabled = available && !unsaved && editable && !record.question.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        send.accessibilityLabel = record.state == .incomplete ? "重新请求（重新生成，不接续）" : "发送问题"
        cancel.isHidden = !busy; retry.isHidden = !unsaved
        status.text = unsaved ? "保存失败：当前内容尚未保存，请重试保存。" : record.state.label
        if let failure = record.failure { status.text! += "\n" + failure }
        if !available { status.text! += "\n原书不可用，记录仍保留；重新导入相同文件后可返回原文。" }
        status.textColor = unsaved || record.failure != nil ? BookDesign.error : BookDesign.secondary
        if unsaved || record.failure != nil {
            statusBox.backgroundColor = BookDesign.errorWash
        } else if record.state == .preparing || record.state == .generating {
            statusBox.backgroundColor = BookDesign.wash
        } else {
            statusBox.backgroundColor = .clear
        }
        scope.text = record.notice.isEmpty ? "仅围绕当前书回答；发送前会告知服务与原文范围。" : record.notice
        materials.isHidden = record.evidence.isEmpty
        followUp.isHidden = record.state != .complete; followUp.isEnabled = !unsaved && available
        retryGeneration.isHidden = record.state != .incomplete || record.failure == nil
        let turns = library.questions.conversation(record.conversation)?.turns ?? [record]
        let signature = turns.map { "\($0.id)|\($0.question)|\($0.answer)|\($0.state)|\($0.citations)|\(expanded.contains($0.id))" }.joined()
        if signature != rendered {
            rendered = signature
            let offset = scroll.contentOffset
            for view in messages.arrangedSubviews { messages.removeArrangedSubview(view); view.removeFromSuperview() }
            for turn in turns where turn.state != .draft { append(turn, latest: turn.id == id) }
            for child in [statusBox, retryGeneration, scope, materials, followUp] {
                messages.addArrangedSubview(child)
            }
            view.layoutIfNeeded(); scroll.setContentOffset(offset, animated: false)
        }
    }
    private func append(_ turn: ReadingQuestion, latest: Bool) {
        let question = UILabel()
        question.numberOfLines = 0
        question.adjustsFontForContentSizeCategory = true
        question.font = BookDesign.font(15)
        question.textColor = BookDesign.ink
        let paragraph = NSMutableParagraphStyle()
        paragraph.lineSpacing = 4
        question.attributedText = NSAttributedString(
            string: turn.question,
            attributes: [.font: BookDesign.font(15), .foregroundColor: BookDesign.ink, .paragraphStyle: paragraph]
        )
        question.accessibilityIdentifier = "question-user-\(turn.id)"
        question.accessibilityLabel = "你的提问，" + turn.question

        let bubble = UIStackView(); bubble.axis = .vertical; bubble.spacing = 8
        bubble.accessibilityIdentifier = "question-user-bubble-\(turn.id)"
        bubble.backgroundColor = BookDesign.wash
        bubble.layer.cornerRadius = 16
        bubble.layer.borderWidth = 1
        bubble.layer.borderColor = BookDesign.line.cgColor
        bubble.layer.maskedCorners = [.layerMinXMinYCorner, .layerMinXMaxYCorner, .layerMaxXMaxYCorner]
        bubble.isLayoutMarginsRelativeArrangement = true
        bubble.layoutMargins = .init(top: 12, left: 15, bottom: 12, right: 15)
        if turn.freeQuestion != true {
            let attachment = UIButton(type: .system)
            var attachmentConfiguration = UIButton.Configuration.plain()
            attachmentConfiguration.image = BookDesign.symbol("text.quote", size: 15)
            attachmentConfiguration.title = (expanded.contains(turn.id) ? "收起选文" : "附带选文") + " · " + turn.bookTitle
            attachmentConfiguration.imagePadding = 6
            attachmentConfiguration.contentInsets = .zero
            attachmentConfiguration.baseForegroundColor = BookDesign.secondary
            attachmentConfiguration.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { incoming in
                var outgoing = incoming
                outgoing.font = BookDesign.font(11, style: .caption1)
                return outgoing
            }
            attachment.configuration = attachmentConfiguration
            attachment.contentHorizontalAlignment = .leading
            attachment.accessibilityIdentifier = "question-attachment-\(turn.id)"
            attachment.addAction(UIAction { [weak self] _ in
                guard let self else { return }
                if self.expanded.contains(turn.id) { self.expanded.remove(turn.id) } else { self.expanded.insert(turn.id) }
                self.refresh()
            }, for: .touchUpInside)
            bubble.addArrangedSubview(attachment)
            if expanded.contains(turn.id) {
                let quoteText = (turn.selectionParts ?? [turn.selection]).map(\.quote).joined(separator: "\n")
                let quoteBox = UIView()
                let rule = UIView(); rule.backgroundColor = BookDesign.line
                let text = BookDesign.label(quoteText, size: 13, colour: BookDesign.secondary)
                text.font = BookDesign.readingFont(13)
                text.accessibilityIdentifier = "question-selection-\(turn.id)"
                for child in [rule, text] {
                    child.translatesAutoresizingMaskIntoConstraints = false
                    quoteBox.addSubview(child)
                }
                NSLayoutConstraint.activate([
                    rule.leadingAnchor.constraint(equalTo: quoteBox.leadingAnchor),
                    rule.topAnchor.constraint(equalTo: quoteBox.topAnchor, constant: 2),
                    rule.bottomAnchor.constraint(equalTo: quoteBox.bottomAnchor),
                    rule.widthAnchor.constraint(equalToConstant: 2),
                    text.leadingAnchor.constraint(equalTo: rule.trailingAnchor, constant: 9),
                    text.trailingAnchor.constraint(equalTo: quoteBox.trailingAnchor),
                    text.topAnchor.constraint(equalTo: quoteBox.topAnchor),
                    text.bottomAnchor.constraint(equalTo: quoteBox.bottomAnchor)
                ])
                bubble.addArrangedSubview(quoteBox)
            }
        }
        bubble.addArrangedSubview(question)
        let row = UIView(); bubble.translatesAutoresizingMaskIntoConstraints = false; row.addSubview(bubble)
        NSLayoutConstraint.activate([
            bubble.leadingAnchor.constraint(greaterThanOrEqualTo: row.leadingAnchor, constant: 28),
            bubble.trailingAnchor.constraint(equalTo: row.trailingAnchor),
            bubble.topAnchor.constraint(equalTo: row.topAnchor),
            bubble.bottomAnchor.constraint(equalTo: row.bottomAnchor),
            bubble.widthAnchor.constraint(lessThanOrEqualTo: row.widthAnchor, multiplier: 0.88)
        ])
        messages.addArrangedSubview(row)

        let identity = BookDesign.label("书灯 · AI", size: 13, weight: .medium)
        identity.accessibilityIdentifier = "question-ai-identity-\(turn.id)"
        let lamp = UIImageView(image: BookDesign.symbol("lightbulb", size: 17))
        lamp.tintColor = BookDesign.lamp
        lamp.contentMode = .scaleAspectFit
        lamp.backgroundColor = BookDesign.glow
        lamp.layer.cornerRadius = 12.5
        lamp.widthAnchor.constraint(equalToConstant: 25).isActive = true
        lamp.heightAnchor.constraint(equalToConstant: 25).isActive = true
        let heading = UIStackView(arrangedSubviews: [lamp, identity, UIView()])
        heading.spacing = 7
        heading.alignment = .center
        let body = CitationAnswerView(answer: turn.answer, citations: turn.citations) { [weak self] evidence, text, range in
            self?.referenceFocus = (text.accessibilityIdentifier ?? "", range)
            self?.open(evidence, origin: turn)
        }
        body.textContainerInset = .zero; body.textContainer.lineFragmentPadding = 0
        body.font = BookDesign.font(15); body.adjustsFontForContentSizeCategory = true; body.textColor = BookDesign.ink
        body.isHidden = turn.answer.isEmpty
        body.accessibilityIdentifier = latest ? "question-answer" : "question-answer-\(turn.id)"
        let reply = UIStackView(arrangedSubviews: [heading, body]); reply.axis = .vertical; reply.spacing = 12
        for (index, evidence) in turn.citations.enumerated() {
            let button = UIButton(type: .system)
            var configuration = UIButton.Configuration.plain()
            configuration.title = "\(index + 1) · \(turn.bookTitle) · \(evidence.chapter)\n查看原文，核对这段解释"
            configuration.image = BookDesign.symbol("arrow.up.right", size: 18)
            configuration.imagePlacement = .trailing
            configuration.imagePadding = 8
            configuration.titleAlignment = .leading
            configuration.baseForegroundColor = BookDesign.ink
            configuration.background.backgroundColor = BookDesign.paper
            configuration.background.cornerRadius = 12
            configuration.background.strokeColor = BookDesign.line
            configuration.background.strokeWidth = 1
            configuration.contentInsets = .init(top: 13, leading: 12, bottom: 13, trailing: 12)
            configuration.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { incoming in
                var outgoing = incoming
                outgoing.font = BookDesign.font(12, style: .footnote)
                return outgoing
            }
            button.configuration = configuration
            button.contentHorizontalAlignment = .leading
            button.titleLabel?.numberOfLines = 0
            button.accessibilityIdentifier = latest ? "question-reference-\(index)" : "question-reference-\(turn.id)-\(index)"
            button.addAction(UIAction { [weak self, weak button] _ in
                self?.referenceFocus = (button?.accessibilityIdentifier ?? "", nil); self?.open(evidence, origin: turn)
            }, for: .touchUpInside)
            reply.addArrangedSubview(button)
        }
        if latest && (turn.state == .preparing || turn.state == .generating) {
            reply.addArrangedSubview(QuestionSkeletonView(identifier: "question-skeleton"))
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
    @objc private func retryGenerationTapped() { sendQuestion() }
    @objc private func showMaterials() {
        guard let record = library.questions.record(id) else { return }
        navigationController?.setNavigationBarHidden(false, animated: false)
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

private final class QuestionSkeletonView: UIView {
    init(identifier: String) {
        super.init(frame: .zero)
        accessibilityIdentifier = identifier
        accessibilityLabel = "书灯正在组织回答"
        let widths: [CGFloat] = [0.82, 1.0, 0.62]
        let bars = widths.map { _ -> UIView in
            let bar = UIView()
            bar.backgroundColor = BookDesign.line
            bar.layer.cornerRadius = 4
            bar.translatesAutoresizingMaskIntoConstraints = false
            bar.heightAnchor.constraint(equalToConstant: 10).isActive = true
            return bar
        }
        let stack = UIStackView(arrangedSubviews: bars)
        stack.axis = .vertical
        stack.alignment = .leading
        stack.spacing = 8
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(stack)
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: topAnchor),
            stack.leadingAnchor.constraint(equalTo: leadingAnchor),
            stack.bottomAnchor.constraint(equalTo: bottomAnchor)
        ])
        for (bar, width) in zip(bars, widths) {
            bar.widthAnchor.constraint(equalTo: stack.widthAnchor, multiplier: width).isActive = true
        }
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }
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
        let paragraph = NSMutableParagraphStyle()
        paragraph.lineSpacing = 4
        let attributed = NSMutableAttributedString(string: text, attributes: [
            .font: BookDesign.font(15), .foregroundColor: BookDesign.ink, .paragraphStyle: paragraph])
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
    private struct Section {
        let book: Book?
        let bookID: String
        let bookTitle: String
        let conversations: [ReadingConversation]
    }

    private let library: LibraryStore
    private let covers = BookCoverStore()
    private let pageHeader = ConversationsPageHeader()
    private var sections: [Section] = []
    private var query = ""
    private var observers: [NSObjectProtocol] = []

    init(library: LibraryStore) {
        self.library = library
        super.init(style: .plain)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }
    deinit { observers.forEach { NotificationCenter.default.removeObserver($0) } }

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "对话"
        view.backgroundColor = BookDesign.paper
        view.accessibilityIdentifier = "conversations-surface"

        tableView.backgroundColor = BookDesign.paper
        tableView.separatorStyle = .none
        tableView.rowHeight = UITableView.automaticDimension
        tableView.estimatedRowHeight = 132
        tableView.keyboardDismissMode = .onDrag
        tableView.sectionHeaderTopPadding = 0
        tableView.contentInset = UIEdgeInsets(top: 0, left: 0, bottom: 24, right: 0)
        tableView.accessibilityIdentifier = "question-history"
        tableView.register(ConversationRecordCell.self, forCellReuseIdentifier: "conversation-record")

        pageHeader.onSearch = { [weak self] text in
            guard let self else { return }
            query = text
            reload()
        }
        tableView.tableHeaderView = pageHeader

        let questions = NotificationCenter.default.addObserver(
            forName: QuestionStore.changed,
            object: library.questions,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in self?.reload() }
        }
        let catalogue = NotificationCenter.default.addObserver(
            forName: LibraryStore.changed,
            object: library,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in self?.reload() }
        }
        observers = [questions, catalogue]
        reload()
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        navigationController?.setNavigationBarHidden(true, animated: false)
        reload()
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

    private func reload() {
        guard !library.questions.loadFailed else {
            sections = []
            tableView.reloadData()
            updateBackground()
            return
        }
        let all = library.questions.conversations
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines)
        let filtered = needle.isEmpty ? all : all.filter { matches($0, needle: needle) }
        let grouped = Dictionary(grouping: filtered, by: { $0.first.bookID })
        sections = grouped.values.compactMap { conversations in
            guard let latest = conversations.max(by: { $0.updated < $1.updated }) else { return nil }
            return Section(
                book: library.books.first { $0.id == latest.first.bookID },
                bookID: latest.first.bookID,
                bookTitle: latest.first.bookTitle,
                conversations: conversations.sorted { $0.updated > $1.updated }
            )
        }.sorted { $0.conversations[0].updated > $1.conversations[0].updated }
        tableView.reloadData()
        updateBackground()
    }

    private func matches(_ conversation: ReadingConversation, needle: String) -> Bool {
        let text = [conversation.title, conversation.first.question, conversation.latest.answer, conversation.first.bookTitle]
            .joined(separator: "\n")
        return text.localizedCaseInsensitiveContains(needle)
    }

    private func updateBackground() {
        guard sections.isEmpty else {
            tableView.backgroundView = nil
            return
        }
        let empty: ConversationsEmptyView
        if library.questions.loadFailed {
            empty = ConversationsEmptyView(
                symbol: "exclamationmark.triangle",
                title: "对话读取失败",
                detail: "原记录未被覆盖。检查储存空间后重试。",
                actionTitle: "重试"
            )
            empty.onAction = { [weak self] in
                guard let self else { return }
                library.questions.load()
                reload()
            }
        } else if !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            empty = ConversationsEmptyView(
                symbol: "magnifyingglass",
                title: "没有找到相关对话",
                detail: "换一个关键词，或清除搜索查看全部记录。",
                actionTitle: "清除搜索"
            )
            empty.onAction = { [weak self] in
                guard let self else { return }
                query = ""
                pageHeader.clearSearch()
                reload()
            }
        } else {
            empty = ConversationsEmptyView(
                symbol: "bubble.left.and.bubble.right",
                title: "还没有对话",
                detail: "阅读时选中原文提问，问题与回答会留在这里。",
                actionTitle: "去书架读书"
            )
            empty.onAction = { [weak self] in self?.rootTabs?.select(RootDestination.library.rawValue) }
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
        sections[section].conversations.count
    }

    override func tableView(_ tableView: UITableView, viewForHeaderInSection section: Int) -> UIView? {
        let item = sections[section]
        let header = BookGroupHeader()
        header.configure(
            bookID: item.bookID,
            bookTitle: item.bookTitle,
            book: item.book,
            covers: covers,
            library: library,
            identifierPrefix: "conversations-book"
        )
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
        let cell = tableView.dequeueReusableCell(withIdentifier: "conversation-record", for: indexPath) as! ConversationRecordCell
        let conversation = sections[indexPath.section].conversations[indexPath.row]
        cell.configure(
            conversation,
            dateText: Self.dateText(conversation.updated),
            unsaved: library.questions.unsaved(conversation.latest.id)
        )
        return cell
    }

    override func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true)
        guard sections.indices.contains(indexPath.section),
              sections[indexPath.section].conversations.indices.contains(indexPath.row) else { return }
        let conversation = sections[indexPath.section].conversations[indexPath.row]
        let controller = QuestionController(library: library, id: conversation.latest.id)
        let navigation = UINavigationController(rootViewController: controller)
        QuestionSheetPresentation.configure(navigation)
        present(navigation, animated: true)
    }

    override func tableView(_ tableView: UITableView, trailingSwipeActionsConfigurationForRowAt indexPath: IndexPath) -> UISwipeActionsConfiguration? {
        guard sections.indices.contains(indexPath.section),
              sections[indexPath.section].conversations.indices.contains(indexPath.row) else { return nil }
        let conversation = sections[indexPath.section].conversations[indexPath.row]
        let rename = UIContextualAction(style: .normal, title: "改名") { [weak self] _, _, done in
            done(false)
            self?.rename(conversation)
        }
        let delete = UIContextualAction(style: .destructive, title: "删除") { [weak self] _, _, done in
            done(false)
            self?.delete(conversation)
        }
        let actions = UISwipeActionsConfiguration(actions: [delete, rename])
        actions.performsFirstActionWithFullSwipe = false
        return actions
    }

    private func rename(_ conversation: ReadingConversation) {
        let alert = UIAlertController(title: "对话改名", message: "生成中或内容尚未保存时请先取消生成或重试保存。", preferredStyle: .alert)
        alert.addTextField { $0.text = conversation.title; $0.accessibilityIdentifier = "conversation-name" }
        alert.addAction(UIAlertAction(title: "取消", style: .cancel))
        alert.addAction(UIAlertAction(title: "保存", style: .default) { [weak self] _ in
            guard let self else { return }
            if !self.library.questions.rename(conversation.id, title: alert.textFields?[0].text ?? "") {
                self.failure("改名尚未保存，原名称未变；请检查名称、生成及保存状态后重试。")
            }
        })
        present(alert, animated: true)
    }

    private func delete(_ conversation: ReadingConversation) {
        let alert = UIAlertController(title: "删除对话？", message: "删除本对话的所有轮次及引用快照；生成中的请求将取消。", preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "取消", style: .cancel))
        alert.addAction(UIAlertAction(title: "删除", style: .destructive) { [weak self] _ in
            guard let self else { return }
            if !self.library.questions.delete(conversation.id) {
                self.failure("删除失败，对话仍保留；生成已取消，请重试删除。")
            }
        })
        present(alert, animated: true)
    }

    private func failure(_ message: String) {
        let alert = UIAlertController(title: "操作未保存", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "知道了", style: .default))
        present(alert, animated: true)
    }

    private static func dateText(_ date: Date) -> String {
        let clock = DateFormatter()
        clock.locale = Locale(identifier: "zh_CN")
        clock.dateFormat = "HH:mm"
        let calendar = Calendar.current
        if calendar.isDateInToday(date) { return "今天 \(clock.string(from: date))" }
        if calendar.isDateInYesterday(date) { return "昨天 \(clock.string(from: date))" }
        clock.dateFormat = "M月d日 HH:mm"
        return clock.string(from: date)
    }
}

@MainActor
private final class ConversationsPageHeader: UIView, UITextFieldDelegate {
    var onSearch: ((String) -> Void)?
    private let searchField = UITextField()

    override init(frame: CGRect) {
        super.init(frame: frame)
        accessibilityIdentifier = "conversations-header"
        backgroundColor = BookDesign.paper

        let title = BookDesign.label("对话", size: 31, weight: .bold, style: .largeTitle)
        title.accessibilityIdentifier = "conversations-title"
        let description = BookDesign.label(
            "读过的疑问，留在这本书里。",
            size: 12,
            colour: BookDesign.secondary
        )
        description.accessibilityIdentifier = "conversations-description"

        let search = UIView()
        search.backgroundColor = BookDesign.wash
        search.layer.cornerRadius = 12
        search.accessibilityIdentifier = "conversation-search-surface"
        let icon = UIImageView(image: BookDesign.symbol("magnifyingglass", size: 19))
        icon.tintColor = BookDesign.secondary
        icon.alpha = 0.65
        icon.contentMode = .scaleAspectFit
        icon.isAccessibilityElement = false
        searchField.placeholder = "搜索你的问题"
        searchField.font = BookDesign.font(15)
        searchField.textColor = BookDesign.ink
        searchField.tintColor = BookDesign.accent
        searchField.adjustsFontForContentSizeCategory = true
        searchField.clearButtonMode = .whileEditing
        searchField.returnKeyType = .search
        searchField.autocorrectionType = .no
        searchField.spellCheckingType = .no
        searchField.delegate = self
        searchField.accessibilityIdentifier = "conversation-search"
        searchField.addAction(UIAction { [weak self] _ in
            self?.onSearch?(self?.searchField.text ?? "")
        }, for: .editingChanged)

        for child in [icon, searchField] {
            child.translatesAutoresizingMaskIntoConstraints = false
            search.addSubview(child)
        }
        NSLayoutConstraint.activate([
            icon.leadingAnchor.constraint(equalTo: search.leadingAnchor, constant: 14),
            icon.centerYAnchor.constraint(equalTo: search.centerYAnchor),
            icon.widthAnchor.constraint(equalToConstant: 19),
            icon.heightAnchor.constraint(equalToConstant: 19),
            searchField.leadingAnchor.constraint(equalTo: icon.trailingAnchor, constant: 8),
            searchField.trailingAnchor.constraint(equalTo: search.trailingAnchor, constant: -14),
            searchField.topAnchor.constraint(equalTo: search.topAnchor),
            searchField.bottomAnchor.constraint(equalTo: search.bottomAnchor)
        ])

        for child in [title, description, search] {
            child.translatesAutoresizingMaskIntoConstraints = false
            addSubview(child)
        }
        NSLayoutConstraint.activate([
            title.topAnchor.constraint(equalTo: topAnchor, constant: 18),
            title.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 24),
            title.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -24),
            description.topAnchor.constraint(equalTo: title.bottomAnchor, constant: 7),
            description.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 24),
            description.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -24),
            search.topAnchor.constraint(equalTo: description.bottomAnchor, constant: 17),
            search.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 24),
            search.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -24),
            search.heightAnchor.constraint(equalToConstant: 44),
            search.bottomAnchor.constraint(equalTo: bottomAnchor)
        ])
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    func clearSearch() {
        searchField.text = ""
        onSearch?("")
    }

    func textFieldShouldClear(_ textField: UITextField) -> Bool {
        onSearch?("")
        return true
    }

    func textFieldShouldReturn(_ textField: UITextField) -> Bool {
        textField.resignFirstResponder()
        return true
    }
}

@MainActor
private final class ConversationRecordCell: UITableViewCell {
    private let question = BookDesign.label(nil, size: 16, weight: .semibold)
    private let answer = BookDesign.label(nil, size: 13, colour: BookDesign.secondary)
    private let meta = BookDesign.label(nil, size: 11, colour: BookDesign.muted)
    private let bottomLine = UIView()

    override init(style: UITableViewCell.CellStyle, reuseIdentifier: String?) {
        super.init(style: style, reuseIdentifier: reuseIdentifier)
        backgroundColor = BookDesign.paper
        contentView.backgroundColor = BookDesign.paper
        selectionStyle = .default

        question.numberOfLines = 2
        question.lineBreakMode = .byTruncatingTail
        answer.numberOfLines = 2
        answer.lineBreakMode = .byTruncatingTail
        meta.numberOfLines = 1
        bottomLine.backgroundColor = BookDesign.line

        let stack = UIStackView(arrangedSubviews: [question, answer, meta])
        stack.axis = .vertical
        stack.spacing = 7
        stack.setCustomSpacing(11, after: answer)
        for child in [stack, bottomLine] {
            child.translatesAutoresizingMaskIntoConstraints = false
            contentView.addSubview(child)
        }
        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: contentView.topAnchor, constant: 19),
            stack.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 24),
            stack.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -24),
            stack.bottomAnchor.constraint(equalTo: contentView.bottomAnchor, constant: -20),
            bottomLine.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 24),
            bottomLine.trailingAnchor.constraint(equalTo: contentView.trailingAnchor, constant: -24),
            bottomLine.bottomAnchor.constraint(equalTo: contentView.bottomAnchor),
            bottomLine.heightAnchor.constraint(equalToConstant: 1)
        ])
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    func configure(_ conversation: ReadingConversation, dateText: String, unsaved: Bool) {
        question.text = conversation.title
        answer.text = String(conversation.latest.answer.prefix(180))
        var values = [dateText, "\(conversation.turns.count) 次提问"]
        if unsaved { values.append("尚未保存") }
        meta.text = values.joined(separator: " · ")
        accessibilityIdentifier = "question-\(conversation.id)"
        accessibilityLabel = [conversation.title, answer.text ?? "", meta.text ?? ""].joined(separator: "\n")
        accessibilityTraits = .button
        isAccessibilityElement = true
    }
}

@MainActor
private final class ConversationsEmptyView: UIView {
    var onAction: (() -> Void)?
    private let action = UIButton(type: .system)

    init(symbol: String, title: String, detail: String, actionTitle: String) {
        super.init(frame: .zero)
        let identifier = title == "对话读取失败"
            ? "conversations-failed"
            : (title == "没有找到相关对话" ? "conversations-search-empty" : "conversations-empty")
        accessibilityIdentifier = identifier
        backgroundColor = BookDesign.paper

        let icon = UIImageView(image: BookDesign.symbol(symbol, size: 47, weight: .light))
        icon.tintColor = BookDesign.secondary
        icon.contentMode = .scaleAspectFit
        icon.alpha = 0.55
        icon.widthAnchor.constraint(equalToConstant: 47).isActive = true
        icon.heightAnchor.constraint(equalToConstant: 47).isActive = true

        let heading = BookDesign.label(title, size: 24, style: .title2)
        heading.font = BookDesign.readingFont(24)
        heading.textAlignment = .center
        heading.accessibilityIdentifier = "\(identifier)-title"
        let description = BookDesign.label(detail, size: 13, colour: BookDesign.secondary)
        description.textAlignment = .center
        description.accessibilityIdentifier = "\(identifier)-detail"

        var configuration = UIButton.Configuration.filled()
        configuration.title = actionTitle
        configuration.baseForegroundColor = BookDesign.paper
        configuration.baseBackgroundColor = BookDesign.ink
        configuration.cornerStyle = .capsule
        configuration.contentInsets = NSDirectionalEdgeInsets(top: 11, leading: 22, bottom: 11, trailing: 22)
        action.configuration = configuration
        action.accessibilityIdentifier = "\(identifier)-action"
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
            stack.widthAnchor.constraint(lessThanOrEqualToConstant: 280)
        ])
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }
}
