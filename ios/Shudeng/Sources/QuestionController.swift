import UIKit
import ReadiumShared

@MainActor
enum QuestionSheetPresentation {
    static let heightFraction: CGFloat = 0.76
    static let cornerRadius: CGFloat = 22

    static func configure(_ navigation: UINavigationController) {
        navigation.modalPresentationStyle = .pageSheet
        guard let sheet = navigation.sheetPresentationController else { return }
        sheet.detents = [
            .custom(identifier: .init("shudeng.question.76")) { context in
                min(
                    context.maximumDetentValue,
                    UIScreen.main.bounds.height * heightFraction
                )
            },
            .large()
        ]
        sheet.prefersGrabberVisible = false
        sheet.preferredCornerRadius = cornerRadius
        // 向上拖动内容或把手可展开到全屏。
        sheet.prefersScrollingExpandsWhenScrolledToEdge = true
    }
}

private final class QuestionSheetHeader: UIView {
    let close = UIButton(type: .system)
    var onClose: (() -> Void)?

    override init(frame: CGRect) {
        super.init(frame: frame)
        accessibilityIdentifier = "question-sheet-header"

        let handle = UIView()
        handle.backgroundColor = BookDesign.ink3
        handle.alpha = 0.35
        handle.layer.cornerRadius = 2
        handle.accessibilityIdentifier = "question-sheet-handle"
        handle.isAccessibilityElement = true
        handle.accessibilityLabel = "问答面板把手"

        let mark = UIView()
        mark.backgroundColor = BookDesign.lampWash
        mark.layer.cornerRadius = 15
        mark.isAccessibilityElement = false
        let lamp = UIImageView(image: BookDesign.symbol("lightbulb", size: 15, weight: .medium))
        lamp.contentMode = .scaleAspectFit
        lamp.tintColor = BookDesign.lamp
        lamp.translatesAutoresizingMaskIntoConstraints = false
        mark.addSubview(lamp)
        mark.setContentHuggingPriority(.required, for: .horizontal)
        mark.widthAnchor.constraint(equalToConstant: 30).isActive = true
        mark.heightAnchor.constraint(equalToConstant: 30).isActive = true
        mark.accessibilityIdentifier = "question-sheet-mark"
        NSLayoutConstraint.activate([
            lamp.centerXAnchor.constraint(equalTo: mark.centerXAnchor),
            lamp.centerYAnchor.constraint(equalTo: mark.centerYAnchor)
        ])

        let title = BookDesign.label("问问书灯", font: BookType.serif(16, weight: .semibold, style: .headline))
        let brand = UIStackView(arrangedSubviews: [mark, title, UIView()])
        brand.spacing = 8
        brand.alignment = .center

        close.setImage(BookDesign.symbol("xmark", size: 15, weight: .medium), for: .normal)
        close.tintColor = BookDesign.ink2
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
    private let serviceHint = UIButton(type: .system)
    private let input = UITextView()
    private let placeholder = BookDesign.label("问问书灯…", size: 16, colour: BookDesign.secondary)
    private let statusBox = UIView()
    private let status = BookDesign.label(nil, size: 12, colour: BookDesign.secondary)
    private let quote = BookDesign.label(nil)
    private let selection = UIButton(type: .system)
    private let send = UIButton(type: .system)
    private let cancel = UIButton(type: .system)
    private let retry = UIButton(type: .system)
    private let retryGeneration = UIButton(type: .system)
    private let materials = UIButton(type: .system)
    private var observer: NSObjectProtocol?
    private var expanded: Set<UUID> = []
    private var rendered = ""
    private var referenceFocus: (identifier: String, range: NSRange?)?
    private var serviceHintLoaded = false
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

        status.accessibilityIdentifier = "question-status"
        statusBox.accessibilityIdentifier = "question-status-box"
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
        composerContext.axis = .vertical
        composerContext.spacing = 4
        composerContext.addArrangedSubview(selection)
        composerContext.addArrangedSubview(quote)

        input.font = BookDesign.font(14); input.adjustsFontForContentSizeCategory = true
        input.textColor = BookDesign.ink; input.backgroundColor = .clear
        input.textContainerInset = .init(top: 10, left: 6, bottom: 8, right: 4)
        input.accessibilityIdentifier = "question-input"; input.accessibilityLabel = "问题"; input.delegate = self
        input.heightAnchor.constraint(equalToConstant: 44).isActive = true
        placeholder.font = BookType.sans(13, weight: .regular, style: .subheadline)
        placeholder.isUserInteractionEnabled = false
        input.addSubview(placeholder); placeholder.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([placeholder.topAnchor.constraint(equalTo: input.topAnchor, constant: 9),
                                     placeholder.leadingAnchor.constraint(equalTo: input.leadingAnchor, constant: 11)])
        var sendConfiguration = UIButton.Configuration.filled()
        sendConfiguration.image = BookDesign.symbol("arrow.up", size: 16, weight: .semibold)
        sendConfiguration.baseBackgroundColor = BookDesign.ink
        sendConfiguration.baseForegroundColor = BookDesign.paper
        sendConfiguration.background.cornerRadius = 17
        send.configuration = sendConfiguration
        send.accessibilityIdentifier = "question-send"; send.addTarget(self, action: #selector(sendQuestion), for: .touchUpInside)
        send.widthAnchor.constraint(equalToConstant: 34).isActive = true
        send.heightAnchor.constraint(equalToConstant: 34).isActive = true
        let field = UIStackView(arrangedSubviews: [input, send]); field.alignment = .center; field.spacing = 6
        field.accessibilityIdentifier = "question-composer-field"
        field.backgroundColor = BookDesign.paperDeep; field.layer.cornerRadius = BookRadius.pill
        field.isLayoutMarginsRelativeArrangement = true; field.layoutMargins = .init(top: 5, left: 12, bottom: 5, right: 5)
        BookDesign.button(cancel, title: "取消生成"); cancel.addTarget(self, action: #selector(cancelQuestion), for: .touchUpInside)
        BookDesign.button(retry, title: "重试保存"); retry.addTarget(self, action: #selector(retrySave), for: .touchUpInside)
        var moreConfiguration = UIButton.Configuration.plain()
        moreConfiguration.title = "更多"
        moreConfiguration.image = BookDesign.symbol("ellipsis", size: 15)
        moreConfiguration.imagePadding = 5
        moreConfiguration.baseForegroundColor = BookDesign.secondary
        moreConfiguration.contentInsets = .zero
        moreConfiguration.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { incoming in
            var outgoing = incoming
            outgoing.font = BookDesign.font(11, style: .caption1)
            return outgoing
        }
        materials.configuration = moreConfiguration
        materials.contentHorizontalAlignment = .leading
        materials.accessibilityIdentifier = "question-more"
        materials.accessibilityLabel = "更多选项"
        materials.showsMenuAsPrimaryAction = true
        materials.menu = UIMenu(children: [
            UIAction(title: "查看本次实际发送材料", image: BookDesign.symbol("doc.text", size: 15)) { [weak self] _ in
                self?.showMaterials()
            }
        ])
        BookDesign.button(retryGeneration, title: "重试回答", symbol: "arrow.clockwise")
        retryGeneration.contentHorizontalAlignment = .leading
        retryGeneration.accessibilityIdentifier = "question-retry-generation"
        retryGeneration.addTarget(self, action: #selector(retryGenerationTapped), for: .touchUpInside)
        var serviceConfiguration = UIButton.Configuration.plain()
        serviceConfiguration.image = BookDesign.symbol("lock.shield", size: 13)
        serviceConfiguration.imagePadding = 5
        serviceConfiguration.baseForegroundColor = BookDesign.secondary
        serviceConfiguration.contentInsets = .zero
        serviceConfiguration.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { incoming in
            var outgoing = incoming
            outgoing.font = BookDesign.font(11, style: .caption1)
            return outgoing
        }
        serviceHint.configuration = serviceConfiguration
        serviceHint.contentHorizontalAlignment = .leading
        serviceHint.accessibilityIdentifier = "question-ai-service"
        serviceHint.addTarget(self, action: #selector(openAISettings), for: .touchUpInside)
        composer.addArrangedSubview(composerContext)
        composer.addArrangedSubview(serviceHint)
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
        refreshServiceHint()
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
        composerContext.isHidden = !editable || selection.isHidden
        let busy = record.state == .preparing || record.state == .generating
        let unsaved = library.questions.unsaved(id), available = library.sourceAvailable(for: record.bookID)
        send.isHidden = busy
        send.isEnabled = available && !unsaved && editable && !record.question.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        send.accessibilityLabel = record.state == .incomplete ? "重新请求（重新生成，不接续）" : "发送问题"
        cancel.isHidden = !busy; retry.isHidden = !unsaved
        status.text = unsaved ? "保存失败：当前内容尚未保存，请重试保存。" : record.state.label
        if let failure = record.failure { status.text! += "\n" + failure }
        let citationWarning = record.notice.components(separatedBy: "\n").dropFirst().joined(separator: "\n")
        if !citationWarning.isEmpty { status.text! += "\n" + citationWarning }
        if !available { status.text! += "\n原书不可用，记录仍保留；重新导入相同文件后可返回原文。" }
        if !serviceHintLoaded { refreshServiceHint() }
        serviceHint.isHidden = record.state == .preparing || record.state == .generating
        status.textColor = unsaved || record.failure != nil ? BookDesign.error : BookDesign.secondary
        if unsaved || record.failure != nil {
            statusBox.backgroundColor = BookDesign.errorWash
        } else if record.state == .preparing || record.state == .generating {
            statusBox.backgroundColor = BookDesign.wash
        } else {
            statusBox.backgroundColor = .clear
        }
        statusBox.isHidden = record.state == .complete && !unsaved && record.failure == nil && available && citationWarning.isEmpty
        materials.isHidden = record.evidence.isEmpty
        retryGeneration.isHidden = record.state != .incomplete || record.failure == nil
        let turns = library.questions.conversation(record.conversation)?.turns ?? [record]
        let signature = turns.map { "\($0.id)|\($0.question)|\($0.answer)|\($0.state)|\($0.citations)|\(expanded.contains($0.id))" }.joined()
        if signature != rendered {
            rendered = signature
            let offset = scroll.contentOffset
            for view in messages.arrangedSubviews { messages.removeArrangedSubview(view); view.removeFromSuperview() }
            for turn in turns where turn.state != .draft { append(turn, latest: turn.id == id) }
            for child in [statusBox, retryGeneration, materials] {
                messages.addArrangedSubview(child)
            }
            view.layoutIfNeeded(); scroll.setContentOffset(offset, animated: false)
        }
    }
    private func append(_ turn: ReadingQuestion, latest: Bool) {
        let question = UILabel()
        question.numberOfLines = 0
        question.adjustsFontForContentSizeCategory = true
        question.font = BookType.body
        question.textColor = BookDesign.ink
        let paragraph = NSMutableParagraphStyle()
        paragraph.lineSpacing = 4
        question.attributedText = NSAttributedString(
            string: turn.question,
            attributes: [.font: BookType.body, .foregroundColor: BookDesign.ink, .paragraphStyle: paragraph]
        )
        question.accessibilityIdentifier = "question-user-\(turn.id)"
        question.accessibilityLabel = "你的提问，" + turn.question

        let bubble = UIStackView(); bubble.axis = .vertical; bubble.spacing = 8
        bubble.accessibilityIdentifier = "question-user-bubble-\(turn.id)"
        bubble.backgroundColor = BookDesign.paperDeep
        bubble.layer.cornerRadius = BookRadius.card
        bubble.layer.maskedCorners = [.layerMinXMinYCorner, .layerMinXMaxYCorner, .layerMaxXMaxYCorner]
        bubble.isLayoutMarginsRelativeArrangement = true
        bubble.layoutMargins = .init(top: 10, left: 12, bottom: 10, right: 12)
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
                let rule = UIView(); rule.backgroundColor = BookDesign.lamp
                let text = BookDesign.label(quoteText, font: BookType.serif(13, weight: .regular, style: .footnote), colour: BookDesign.ink2)
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

        let identity = BookDesign.label("书灯 · AI", font: BookType.caption, colour: BookDesign.ink2)
        identity.accessibilityIdentifier = "question-ai-identity-\(turn.id)"
        let lamp = UIImageView(image: BookDesign.symbol("lightbulb", size: 13, weight: .medium))
        lamp.tintColor = BookDesign.lamp
        lamp.contentMode = .scaleAspectFit
        lamp.backgroundColor = BookDesign.lampWash
        lamp.layer.cornerRadius = 9
        lamp.widthAnchor.constraint(equalToConstant: 18).isActive = true
        lamp.heightAnchor.constraint(equalToConstant: 18).isActive = true
        let heading = UIStackView(arrangedSubviews: [lamp, identity, UIView()])
        heading.spacing = 7
        heading.alignment = .center
        let body = CitationAnswerView(answer: turn.answer, citations: turn.citations) { [weak self] evidence, text, range in
            self?.referenceFocus = (text.accessibilityIdentifier ?? "", range)
            self?.open(evidence, origin: turn)
        }
        body.textContainerInset = .zero; body.textContainer.lineFragmentPadding = 0
        body.font = BookType.body; body.adjustsFontForContentSizeCategory = true; body.textColor = BookDesign.ink
        body.isHidden = turn.answer.isEmpty
        body.accessibilityIdentifier = latest ? "question-answer" : "question-answer-\(turn.id)"
        let reply = UIStackView(arrangedSubviews: [heading, body]); reply.axis = .vertical; reply.spacing = 9
        for (index, evidence) in turn.citations.enumerated() {
            let button = UIButton(type: .system)
            var configuration = UIButton.Configuration.plain()
            configuration.title = citationTitle(evidence, index: index, bookTitle: turn.bookTitle)
            configuration.image = BookDesign.symbol("arrow.up.right", size: 18)
            configuration.imagePlacement = .trailing
            configuration.imagePadding = 8
            configuration.titleAlignment = .leading
            configuration.baseForegroundColor = BookDesign.ink
            configuration.background.backgroundColor = BookDesign.surface
            configuration.background.cornerRadius = BookRadius.field
            configuration.contentInsets = .init(top: 11, leading: 12, bottom: 11, trailing: 12)
            configuration.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { incoming in
                var outgoing = incoming
                outgoing.font = BookType.footnote
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
        if !turn.answer.isEmpty {
            let hint = BookDesign.label("解释供参考，可回原文核查", size: 10, colour: BookDesign.secondary)
            let copy = UIButton(type: .system)
            copy.setImage(BookDesign.symbol("doc.on.doc", size: 15), for: .normal)
            copy.tintColor = BookDesign.secondary
            copy.accessibilityLabel = "复制回答"
            copy.accessibilityIdentifier = latest ? "question-copy" : "question-copy-\(turn.id)"
            copy.widthAnchor.constraint(equalToConstant: 44).isActive = true
            copy.heightAnchor.constraint(equalToConstant: 44).isActive = true
            copy.addAction(UIAction { _ in
                UIPasteboard.general.string = turn.answer
                UIAccessibility.post(notification: .announcement, argument: "回答已复制")
            }, for: .touchUpInside)
            let footer = UIStackView(arrangedSubviews: [hint, UIView(), copy])
            footer.alignment = .center
            footer.spacing = 8
            reply.addArrangedSubview(footer)
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
    @objc private func toggleQuote() {
        if expanded.contains(id) { expanded.remove(id) } else { expanded.insert(id) }; refresh()
    }
    @objc private func closePanel() { input.resignFirstResponder(); dismiss(animated: true) }
    @objc private func cancelQuestion() { library.questions.cancel(id) }
    @objc private func retrySave() { library.questions.retrySave(id) }
    @objc private func retryGenerationTapped() { sendQuestion() }
    @objc private func showMaterials() {
        guard let record = library.questions.record(id) else { return }
        navigationController?.setNavigationBarHidden(false, animated: false)
        navigationController?.pushViewController(EvidenceController(values: record.evidence), animated: true)
    }
    @objc private func openAISettings() {
        let settings = AISettingsController(root: library.root, secrets: library.secrets)
        navigationController?.setNavigationBarHidden(false, animated: true)
        navigationController?.pushViewController(settings, animated: true)
    }
    private func refreshServiceHint() {
        let title: String
        do {
            let store = try AIConfigurationStore(root: library.root, secrets: library.secrets)
            if let configuration = store.configurations.first(where: { $0.id == store.selectedID }) {
                title = store.hasSendConsent(for: configuration)
                    ? "发送给 \(configuration.name)"
                    : "确认 \(configuration.name) 的发送说明"
            } else {
                title = "设置 AI 服务"
            }
        } catch {
            title = "检查 AI 服务"
        }
        var configuration = serviceHint.configuration ?? .plain()
        configuration.title = title
        serviceHint.configuration = configuration
        serviceHint.accessibilityLabel = title + "，轻点查看或修改 AI 服务"
        serviceHintLoaded = true
    }
    @objc private func sendQuestion() {
        input.resignFirstResponder()
        guard let record = library.questions.record(id) else { return }
        do {
            guard library.sourceAvailable(for: record.bookID) else { throw LibraryError.missing }
            let store = try AIConfigurationStore(root: library.root, secrets: library.secrets)
            let configuration = try store.selectedConfigurationForSending()
            _ = try store.key(for: configuration)
            let ready = library.preparation.states[record.bookID]?.ready == true
            let continuing = (record.turnIndex ?? 0) > 0
            if continuing && !ready {
                let alert = BookAlertController(title: "资料尚未准备完整", message: "追问需要重新查书，请等待资料准备；草稿已保留。", preferredStyle: .alert)
                alert.addAction(BookAlertAction(title: "等待资料准备", style: .cancel)); present(alert, animated: true); return
            }
            if ready {
                library.questions.send(id, library: library, local: false)
                return
            }
            let free = record.freeQuestion == true
            let alert = BookAlertController(
                title: "资料尚未准备完整",
                message: "可以继续等待，或先用本次\(free ? "已准备资料" : "选文")解释。",
                preferredStyle: .alert
            )
            alert.addAction(BookAlertAction(title: free ? "仅用已准备资料解释" : "仅用选文解释", style: .default) { [weak self] _ in
                guard let self else { return }
                self.library.questions.send(self.id, library: self.library, local: true)
            })
            alert.addAction(BookAlertAction(title: "等待资料准备", style: .cancel))
            present(alert, animated: true)
        } catch let error as AIError {
            let alert = BookAlertController(
                title: error == .consentRequired ? "先确认发送说明" : "AI 服务需要处理",
                message: error.errorDescription,
                preferredStyle: .alert
            )
            alert.addAction(BookAlertAction(title: "去 AI 服务", style: .default) { [weak self] _ in
                self?.openAISettings()
            })
            alert.addAction(BookAlertAction(title: "取消", style: .cancel))
            present(alert, animated: true)
        } catch {
            let alert = BookAlertController(title: "尚未发送", message: error.localizedDescription, preferredStyle: .alert)
            alert.addAction(BookAlertAction(title: "去 AI 服务", style: .default) { [weak self] _ in
                self?.openAISettings()
            })
            alert.addAction(BookAlertAction(title: "取消", style: .cancel))
            present(alert, animated: true)
        }
    }
    private func citationTitle(_ evidence: QuestionEvidence, index: Int, bookTitle: String) -> String {
        guard evidence.pdfPage != nil else {
            return "\(index + 1) · \(bookTitle) · \(evidence.locationTitle)\n查看原文，核对这段解释"
        }
        let quote = evidence.quote
            .replacingOccurrences(of: "\n", with: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let excerpt = quote.count > 36 ? String(quote.prefix(36)) + "…" : quote
        return "\(index + 1) · \(bookTitle) · \(evidence.locationTitle)\n\(excerpt)"
    }
    private func open(_ evidence: QuestionEvidence, origin record: ReadingQuestion) {
        guard let target = try? evidence.location(), let origin = try? record.origin() else { return }
        input.resignFirstResponder(); returningFromReference = true
        if let jump { dismiss(animated: true) { jump(target, origin) }; return }
        guard let book = library.books.first(where: { $0.id == record.bookID }), library.sourceAvailable(for: record.bookID) else {
            let alert = BookAlertController(title: "原文不可用", message: "引用文字仍可回看；重新导入相同文件后可定位原书。", preferredStyle: .alert)
            alert.addAction(BookAlertAction(title: "知道了", style: .default)); present(alert, animated: true); return
        }
        if book.resolvedFormat == .pdf {
            do {
                let reader = try PDFReaderController(book: book, library: library, target: target)
                reader.modalPresentationStyle = .fullScreen
                present(reader, animated: true)
            } catch {
                let alert = BookAlertController(title: "原文不可用", message: "引用文字已保留，未能打开原书。", preferredStyle: .alert)
                alert.addAction(BookAlertAction(title: "知道了", style: .default)); present(alert, animated: true)
            }
            return
        }
        Task {
            do {
                let publication = try await library.open(book)
                let reader = try ReaderController(book: book, publication: publication, library: library, target: target)
                reader.referenceReturn = { [weak reader] in reader?.dismiss(animated: true) }
                reader.questionOrigin = origin; reader.modalPresentationStyle = .fullScreen
                present(reader, animated: true)
            } catch {
                let alert = BookAlertController(title: "原文不可用", message: "引用文字已保留，未能打开原书。", preferredStyle: .alert)
                alert.addAction(BookAlertAction(title: "知道了", style: .default)); present(alert, animated: true)
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
        isAccessibilityElement = true
        accessibilityIdentifier = identifier
        accessibilityLabel = "书灯正在组织回答"
        accessibilityTraits = .updatesFrequently
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
        tableView.register(EvidenceRecordCell.self, forCellReuseIdentifier: "evidence-record")
        if jump != nil { navigationItem.rightBarButtonItem = UIBarButtonItem(title: "跳转原文", style: .plain, target: self, action: #selector(go)) }
    }
    @objc private func go() { jump?() }
    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int { values.count }
    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        guard let cell = tableView.dequeueReusableCell(withIdentifier: "evidence-record", for: indexPath) as? EvidenceRecordCell else {
            return UITableViewCell()
        }
        let value = values[indexPath.row]
        cell.textLabel?.text = "\(value.id) · \(value.locationTitle)\n\(value.quote)"
        cell.detailTextLabel?.text = value.context
        cell.textLabel?.numberOfLines = 0; cell.detailTextLabel?.numberOfLines = 0
        cell.textLabel?.font = BookDesign.readingFont(17); cell.textLabel?.textColor = BookDesign.ink
        cell.detailTextLabel?.font = BookDesign.font(14); cell.detailTextLabel?.textColor = BookDesign.secondary
        cell.textLabel?.adjustsFontForContentSizeCategory = true; cell.detailTextLabel?.adjustsFontForContentSizeCategory = true
        cell.selectionStyle = .none
        return cell
    }
}

private final class EvidenceRecordCell: UITableViewCell {
    override init(style: UITableViewCell.CellStyle, reuseIdentifier: String?) {
        super.init(style: .subtitle, reuseIdentifier: reuseIdentifier)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }
}

@MainActor
final class QuestionHistoryController: UIViewController, UICollectionViewDelegate, UISearchControllerDelegate, UISearchResultsUpdating {
    private struct Section {
        let book: Book?
        let bookID: String
        let bookTitle: String
        let conversations: [ReadingConversation]
    }

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
    private var sections: [Section] = []
    private var appliedSectionIDs: [SectionID] = []
    private var query = ""
    private var observers: [NSObjectProtocol] = []
    private(set) var collectionView: UICollectionView!
    private lazy var dataSource = makeDataSource()
    private lazy var headerRegistration = UICollectionView.CellRegistration<UICollectionViewListCell, ItemID> {
        [weak self] cell, _, item in
        guard let self, case let .header(bookID) = item else { return }
        self.configure(header: cell, bookID: bookID)
    }
    private lazy var recordRegistration = UICollectionView.CellRegistration<UICollectionViewListCell, ItemID> {
        [weak self] cell, indexPath, item in
        guard let self, case let .record(conversationID) = item else { return }
        self.configure(record: cell, indexPath: indexPath, conversationID: conversationID)
    }

    init(library: LibraryStore) {
        self.library = library
        groupState = BookGroupListState(root: library.root, page: "conversations")
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }
    deinit { observers.forEach { NotificationCenter.default.removeObserver($0) } }

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "对话"
        view.backgroundColor = BookDesign.paper
        view.accessibilityIdentifier = "conversations-surface"

        navigationItem.largeTitleDisplayMode = .always
        BookDesign.applyListPageNavigationAppearance(to: navigationItem)
        searchController.searchResultsUpdater = self
        searchController.delegate = self
        searchController.obscuresBackgroundDuringPresentation = false
        searchController.searchBar.placeholder = "搜索你的问题"
        searchController.searchBar.searchTextField.accessibilityIdentifier = "conversation-search"
        searchController.searchBar.searchTextField.font = BookType.body
        searchController.searchBar.tintColor = BookDesign.lamp
        searchController.searchBar.searchTextField.textColor = BookDesign.ink
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
        navigationController?.setNavigationBarHidden(false, animated: false)
        navigationController?.navigationBar.prefersLargeTitles = true
        reload()
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

    private func registerForDynamicTypeChanges() {
        if #available(iOS 17.0, *) {
            registerForTraitChanges([UITraitPreferredContentSizeCategory.self]) {
                (self: QuestionHistoryController, _: UITraitCollection) in
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
            case let .record(conversationID):
                configure(record: listCell, indexPath: indexPath, conversationID: conversationID)
            }
        }
    }

    private func configureCollectionView() {
        var configuration = UICollectionLayoutListConfiguration(appearance: .insetGrouped)
        configuration.headerMode = .firstItemInSection
        configuration.headerTopPadding = 12
        configuration.showsSeparators = true
        configuration.backgroundColor = BookDesign.paper
        configuration.separatorConfiguration.color = BookDesign.line
        configuration.trailingSwipeActionsConfigurationProvider = { [weak self] indexPath in
            self?.swipeActions(at: indexPath)
        }
        let layout = UICollectionViewCompositionalLayout.list(using: configuration)

        let collectionView = UICollectionView(frame: .zero, collectionViewLayout: layout)
        collectionView.backgroundColor = BookDesign.paper
        collectionView.keyboardDismissMode = .onDrag
        collectionView.contentInset = UIEdgeInsets(top: 0, left: 0, bottom: 24, right: 0)
        collectionView.accessibilityIdentifier = "question-history"
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

    private func reload() {
        guard !library.questions.loadFailed else {
            sections = []
            applySnapshots(animated: false)
            updateBackground()
            return
        }
        let all = library.questions.conversations
        groupState.initialize(latestBookID: all.max(by: { $0.updated < $1.updated })?.first.bookID)
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
        applySnapshots(animated: false)
        updateBackground()
    }

    private func applySnapshots(animated: Bool) {
        let sectionIDs = sections.map { SectionID.book($0.bookID) }
        if sectionIDs != appliedSectionIDs {
            var snapshot = NSDiffableDataSourceSnapshot<SectionID, ItemID>()
            snapshot.appendSections(sectionIDs)
            dataSource.apply(snapshot, animatingDifferences: animated)
            appliedSectionIDs = sectionIDs
        }
        for (index, section) in sections.enumerated() {
            let header = ItemID.header(section.bookID)
            var snapshot = NSDiffableDataSourceSectionSnapshot<ItemID>()
            snapshot.append([header])
            snapshot.append(section.conversations.map { ItemID.record($0.id) }, to: header)
            if groupState.isExpanded(section.bookID, searching: searching) {
                snapshot.expand([header])
            }
            dataSource.apply(snapshot, to: sectionIDs[index], animatingDifferences: animated)
        }
    }

    private func matches(_ conversation: ReadingConversation, needle: String) -> Bool {
        let text = [conversation.title, conversation.first.question, conversation.latest.answer, conversation.first.bookTitle]
            .joined(separator: "\n")
        return text.localizedCaseInsensitiveContains(needle)
    }

    private func updateBackground() {
        guard sections.isEmpty else {
            collectionView.backgroundView = nil
            if #available(iOS 17.0, *) { contentUnavailableConfiguration = nil }
            return
        }
        let symbol: String
        let title: String
        let detail: String
        let actionTitle: String
        let action: () -> Void
        if library.questions.loadFailed {
            symbol = "exclamationmark.triangle"
            title = "对话读取失败"
            detail = "原记录未被覆盖。检查储存空间后重试。"
            actionTitle = "重试"
            action = { [weak self] in
                guard let self else { return }
                self.library.questions.load()
                self.reload()
            }
        } else if !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            symbol = "magnifyingglass"
            title = "没有找到相关对话"
            detail = "换一个关键词，或清除搜索查看全部记录。"
            actionTitle = "清除搜索"
            action = { [weak self] in
                guard let self else { return }
                self.query = ""
                self.searchController.searchBar.text = ""
                self.reload()
            }
        } else {
            symbol = "bubble.left.and.bubble.right"
            title = "还没有对话"
            detail = "阅读时选中原文提问，问题与回答会留在这里。"
            actionTitle = "去书架读书"
            action = { [weak self] in self?.rootTabs?.select(RootDestination.library.rawValue) }
        }
        if #available(iOS 17.0, *) {
            contentUnavailableConfiguration = BookContentUnavailable.configuration(
                title: title,
                detail: detail,
                symbol: symbol,
                actionTitle: actionTitle,
                action: action
            )
        } else {
            let empty = ConversationsEmptyView(symbol: symbol, title: title, detail: detail, actionTitle: actionTitle)
            empty.onAction = action
            collectionView.backgroundView = empty
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
        reload()
    }

    private var rootTabs: RootTabController? {
        var current = parent
        while let controller = current {
            if let tabs = controller as? RootTabController { return tabs }
            current = controller.parent
        }
        return nil
    }

    private func configure(header cell: UICollectionViewListCell, bookID: String) {
        guard let section = sections.first(where: { $0.bookID == bookID }) else { return }
        let countText = "\(section.conversations.count) 段对话"
        cell.contentConfiguration = BookDesign.listGroupHeaderContent(
            title: section.bookTitle,
            countText: countText,
            image: thumbnails.placeholder(for: section.bookTitle)
        )
        let expanded = groupState.isExpanded(bookID, searching: searching)
        cell.accessories = [.outlineDisclosure(
            options: UICellAccessory.OutlineDisclosureOptions(style: .header),
            actionHandler: { [weak self] in self?.toggleGroup(bookID: bookID) }
        )]
        cell.accessibilityIdentifier = "conversations-book-\(bookID)"
        cell.accessibilityLabel = "\(section.bookTitle)，\(countText)"
        cell.accessibilityValue = expanded ? "已展开" : "已收起"
        cell.accessibilityTraits = [.header, .button]
        cell.accessibilityHint = searching ? "搜索期间自动展开匹配记录" : "轻点展开或收起本书的记录"
        loadCover(of: section.book, bookTitle: section.bookTitle, bookID: bookID, into: cell)
    }

    private func loadCover(of book: Book?, bookTitle: String, bookID: String, into cell: UICollectionViewListCell) {
        guard let book else { return }
        Task { [weak self, weak cell] in
            guard let self, let cell else { return }
            let image = await self.thumbnails.image(for: book, covers: self.covers, library: self.library)
            guard cell.accessibilityIdentifier == "conversations-book-\(bookID)",
                  var content = cell.contentConfiguration as? UIListContentConfiguration else { return }
            content.image = image
            cell.contentConfiguration = content
        }
    }

    private func configure(record cell: UICollectionViewListCell, indexPath: IndexPath, conversationID: UUID) {
        guard sections.indices.contains(indexPath.section),
              let conversation = sections[indexPath.section].conversations.first(where: { $0.id == conversationID }) else { return }
        let dateText = BookDateFormat.conversationTime(conversation.updated)
        let unsaved = library.questions.unsaved(conversation.latest.id)
        let meta = "\(conversation.submittedCount) 次提问" + (unsaved ? " · 尚未保存" : "")
        let preview = conversation.latest.answer.trimmingCharacters(in: .whitespacesAndNewlines)
        let renderedPreview = String(preview.prefix(180))

        var content = UIListContentConfiguration.subtitleCell()
        content.attributedText = paragraph(
            conversation.title,
            font: BookType.serif(16, weight: .semibold, style: .headline),
            colour: BookDesign.ink,
            lineHeightMultiple: 1.45
        )
        content.textProperties.numberOfLines = 2
        let secondary = NSMutableAttributedString()
        if !renderedPreview.isEmpty {
            secondary.append(NSAttributedString(
                string: renderedPreview + "\n",
                attributes: [
                    .font: BookType.sans(12.5, weight: .regular, style: .footnote),
                    .foregroundColor: BookDesign.ink2
                ]
            ))
        }
        secondary.append(NSAttributedString(
            string: meta,
            attributes: [
                .font: BookType.caption,
                .foregroundColor: BookDesign.ink3
            ]
        ))
        content.secondaryAttributedText = secondary
        content.secondaryTextProperties.numberOfLines = renderedPreview.isEmpty ? 1 : 3
        cell.contentConfiguration = content

        var timeOptions = UICellAccessory.LabelOptions(font: BookType.caption, adjustsFontForContentSizeCategory: true)
        timeOptions.tintColor = BookDesign.ink3
        cell.accessories = [
            .label(text: dateText, options: timeOptions),
            .disclosureIndicator()
        ]
        cell.accessibilityIdentifier = "question-\(conversation.id)"
        cell.accessibilityLabel = [conversation.title, renderedPreview, dateText, meta].joined(separator: "\n")
        cell.accessibilityTraits = .button
        cell.isAccessibilityElement = true
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

    func collectionView(_ collectionView: UICollectionView, didSelectItemAt indexPath: IndexPath) {
        collectionView.deselectItem(at: indexPath, animated: true)
        guard sections.indices.contains(indexPath.section) else { return }
        guard let item = dataSource.itemIdentifier(for: indexPath), case let .record(conversationID) = item,
              let conversation = sections[indexPath.section].conversations.first(where: { $0.id == conversationID }) else { return }
        let controller = QuestionController(library: library, id: conversation.latest.id)
        let navigation = UINavigationController(rootViewController: controller)
        QuestionSheetPresentation.configure(navigation)
        present(navigation, animated: true)
    }

    private func swipeActions(at indexPath: IndexPath) -> UISwipeActionsConfiguration? {
        guard let item = dataSource.itemIdentifier(for: indexPath), case let .record(conversationID) = item else { return nil }
        return swipeActions(forConversationID: conversationID)
    }

    /// 供单元测试验证滑动操作；与列表 layout 的 provider 是同一实现。
    func swipeActions(forConversationID conversationID: UUID) -> UISwipeActionsConfiguration? {
        guard let conversation = sections.flatMap(\.conversations).first(where: { $0.id == conversationID }) else { return nil }
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
        let alert = BookAlertController(title: "对话改名", message: "生成中或内容尚未保存时请先取消生成或重试保存。", preferredStyle: .alert)
        alert.addTextField { $0.text = conversation.title; $0.accessibilityIdentifier = "conversation-name" }
        alert.addAction(BookAlertAction(title: "取消", style: .cancel))
        alert.addAction(BookAlertAction(title: "保存", style: .default) { [weak self] _ in
            guard let self else { return }
            if !self.library.questions.rename(conversation.id, title: alert.textFields?[0].text ?? "") {
                self.failure("改名尚未保存，原名称未变；请检查名称、生成及保存状态后重试。")
            }
        })
        present(alert, animated: true)
    }

    private func delete(_ conversation: ReadingConversation) {
        let alert = BookAlertController(title: "删除对话？", message: "删除本对话的所有轮次及引用快照；生成中的请求将取消。", preferredStyle: .alert)
        alert.addAction(BookAlertAction(title: "取消", style: .cancel))
        alert.addAction(BookAlertAction(title: "删除", style: .destructive) { [weak self] _ in
            guard let self else { return }
            if !self.library.questions.delete(conversation.id) {
                self.failure("删除失败，对话仍保留；生成已取消，请重试删除。")
            }
        })
        present(alert, animated: true)
    }

    private func failure(_ message: String) {
        let alert = BookAlertController(title: "操作未保存", message: message, preferredStyle: .alert)
        alert.addAction(BookAlertAction(title: "知道了", style: .default))
        present(alert, animated: true)
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

        let icon = UIImageView(image: BookDesign.symbol(symbol, size: 40, weight: .light))
        icon.tintColor = BookDesign.lamp
        icon.contentMode = .scaleAspectFit
        icon.widthAnchor.constraint(equalToConstant: 40).isActive = true
        icon.heightAnchor.constraint(equalToConstant: 40).isActive = true

        let heading = BookDesign.label(title, font: BookType.serif(24, weight: .semibold, style: .title2))
        heading.textAlignment = .center
        heading.accessibilityIdentifier = "\(identifier)-title"
        let description = BookDesign.label(detail, font: BookType.subhead, colour: BookDesign.ink2)
        description.textAlignment = .center
        description.numberOfLines = 0
        description.accessibilityIdentifier = "\(identifier)-detail"

        var configuration = UIButton.Configuration.filled()
        configuration.title = actionTitle
        configuration.baseForegroundColor = BookDesign.paper
        configuration.baseBackgroundColor = BookDesign.ink
        configuration.background.cornerRadius = 12
        configuration.contentInsets = NSDirectionalEdgeInsets(top: 10, leading: 20, bottom: 10, trailing: 20)
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
