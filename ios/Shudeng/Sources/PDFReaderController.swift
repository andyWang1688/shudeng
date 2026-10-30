import UIKit
import PDFKit
import ReadiumShared

/// PDF 阅读器：系统 PDFKit 渲染 + 页码/进度 + 扫描页说明 + 页级书签与目录面板。
///
/// - 渲染：`PDFView`（autoScales、连续滚动，可切换单页分页）
/// - 进度：当前页写入既有 `Book.locatorJSON`（`position` = 页号），
///   书架的继续阅读与「已读 X%」直接复用现有字段，无需新存储。
/// - 书签：复用 `Bookmark` 与 `LibraryStore.saveBookmark/removeBookmark`；
///   约定 `href = "pdf://page/N"`、`position = N`、`title = "第 N 页"`、
///   `text.highlight = 该页首行摘要`（扫描页为空）。
/// - 标注：选中文字 → 纸白浮层（高亮/写笔记/取消）；高亮渲染为 PDFAnnotation `.highlight`，
///   笔记渲染为 `.underline` + `.text` 图标；几何存 `BookNote.pdf`（归一化页面矩形）。
/// - AI：选区浮层「问 AI」与页脚「问书灯」入口；引用按 `pdf://page/N` 回到本页（扫描版提示无文字）。
/// 阅读器专用 PDFView：safeAreaInsets 恒为 0。
/// PDFKit 内部滚动视图默认会随 safe area（状态栏显隐）调整 contentInset，
/// 即使 PDFView 外框固定，页面也会竖向跳动；把 safe area 归零后内部 inset 不再变化。
private final class ImmersivePDFView: PDFView {
    override var safeAreaInsets: UIEdgeInsets { .zero }
}

extension UIView {
    /// 递归找到内部滚动视图并关闭自动 safe-area inset 调整（PDFView 不公开 scrollView）。
    func disableAutomaticContentInsetAdjustment() {
        if let scrollView = self as? UIScrollView {
            scrollView.contentInsetAdjustmentBehavior = .never
            scrollView.automaticallyAdjustsScrollIndicatorInsets = false
        }
        for subview in subviews { subview.disableAutomaticContentInsetAdjustment() }
    }
}

@MainActor
final class PDFReaderController: UIViewController, UIGestureRecognizerDelegate {
    private let book: Book
    private let library: LibraryStore
    /// 打开性能：PDFDocument 在串行队列异步创建，回主线程后再挂到 PDFView。
    private var document: PDFKit.PDFDocument?
    private let documentURL: URL
    private var openTask: Task<Void, Never>?
    private let openClock = CFAbsoluteTimeGetCurrent()
    private let loadingView = UIView()
    private let loadingLabel = BookDesign.label(nil, font: BookType.subhead, colour: BookDesign.ink2)
    private let loadingSpinner = UIActivityIndicatorView(style: .medium)
    private var layoutPassCount = 0
    private var firstPageChangeLogged = false
    private let pdfView = ImmersivePDFView()
    private let toolbar = UIView()
    private let footer = UIView()
    private let backButton = UIButton(type: .system)
    private let modeButton = UIButton(type: .system)
    private let bookmarkButton = UIButton(type: .system)
    private let contentsButton = UIButton(type: .system)
    private let helpButton = UIButton(type: .system)
    private let titleLabel = BookDesign.label(nil, font: BookType.serif(15, weight: .semibold, style: .subheadline))
    private let pageLabel = BookDesign.label(nil, font: BookType.subhead, colour: BookDesign.ink2)
    private let progressView = UIProgressView(progressViewStyle: .default)
    private let bookmarkRibbon = PDFBookmarkRibbonButton()
    private var continuousScroll = true
    private var lastKnownPage = 0
    private var didRestoreProgress = false
    private var progressWriteItem: DispatchWorkItem?
    private var pendingProgressPage: Int?
    private var bookmarkRibbonVisible = false
    private lazy var feedbackGenerator = UIImpactFeedbackGenerator(style: .light)
    // PDF 文字标注（高亮/笔记）
    private static let noteAnnotationPrefix = "shudeng-pdf-note:"
    private var noteAnnotations: [UUID: [PDFAnnotation]] = [:]
    private var notesSignature = ""
    private var didRenderAnnotations = false
    private var notesObserver: NSObjectProtocol?
    private var activeSelection: PDFSelection?
    private var selectionMenu: PDFSelectionMenu?
    private var selectionMenuWorkItem: DispatchWorkItem?
    private weak var pageTapGesture: UITapGestureRecognizer?
    private var selectionAtTouchStart = false
    private lazy var selectionFeedback = UISelectionFeedbackGenerator()
    // 沉浸式阅读：隐藏顶部工具栏/底部页脚，PDFView 扩到全屏
    private var chromeHidden = false
    private var chromeAnimating = false
    // 书内 AI 问答
    private let targetPage: Int?
    private let askButton = UIButton(type: .system)
    private var activeQuestion: UINavigationController?

    init(book: Book, library: LibraryStore, target: Locator? = nil) throws {
        guard book.resolvedFormat == .pdf else { throw LibraryError.invalid }
        let url = library.fileURL(for: book)
        guard FileManager.default.fileExists(atPath: url.path) else { throw LibraryError.missing }
        // 这里只做轻量校验：PDFDocument 创建可能很慢（大 PDF），放到串行队列异步打开，
        // 先让阅读器以纸白「正在打开」占位出现，避免点书后主线程长时间空白。
        self.book = book
        self.library = library
        self.documentURL = url
        targetPage = target?.pdfPageNumber
        super.init(nibName: nil, bundle: nil)
        // 全屏阅读器自行控制状态栏隐藏（沉浸式）。
        modalPresentationCapturesStatusBarAppearance = true
        logOpenTiming("init", since: openClock)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    deinit {
        openTask?.cancel()
        NotificationCenter.default.removeObserver(self)
        if let notesObserver { NotificationCenter.default.removeObserver(notesObserver) }
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        let viewDidLoadStart = CFAbsoluteTimeGetCurrent()
        view.backgroundColor = BookDesign.paper
        view.accessibilityIdentifier = "pdf-reader"
        configurePDFView()
        configureToolbar()
        configureFooter()
        configureBookmarkRibbon()
        configureLayout()
        configureLoadingView()
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(pageChanged),
            name: .PDFViewPageChanged,
            object: pdfView
        )
        configureNoteAnnotations()
        configureSelectionInteraction()
        logOpenTiming("viewDidLoad(不含打开文档)", since: viewDidLoadStart)
        // 异步打开 PDF：占位先出现，文档就绪后再挂载/恢复页码/首帧，之后才做标注与书签等次要工作。
        openTask = Task { [weak self] in
            guard let self else { return }
            await self.openDocumentAndInstall()
        }
    }

    override func traitCollectionDidChange(_ previousTraitCollection: UITraitCollection?) {
        super.traitCollectionDidChange(previousTraitCollection)
        if previousTraitCollection?.userInterfaceStyle != traitCollection.userInterfaceStyle {
            renderNoteAnnotations()
        }
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        logOpenTiming("viewDidAppear(since init)", since: openClock)
        pdfView.disableAutomaticContentInsetAdjustment()
        feedbackGenerator.prepare()
        restoreProgressIfNeeded()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        // 内部滚动视图可能延迟创建；布局时补关自动 inset（幂等，不改动 PDFKit 自己的 inset 数值）。
        pdfView.disableAutomaticContentInsetAdjustment()
        layoutPassCount += 1
        if layoutPassCount <= 5 {
            logOpenTiming("viewDidLayoutSubviews #\(layoutPassCount) (since init)", since: openClock)
        }
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        // 关闭按钮读屏文案按来源：书架 / 笔记 / 问答（presenting 链上找来源控制器）。
        backButton.accessibilityLabel = closeAccessibilityLabel()
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        clearActiveSelection()
        flushProgress()
        if document == nil {
            // 加载中就被关闭：取消打开任务，避免加载完成后对已关闭的阅读器继续做挂载工作。
            openTask?.cancel()
            openTask = nil
        }
    }

    private func closeAccessibilityLabel() -> String {
        var candidate: UIViewController? = presentingViewController
        var visited: Set<ObjectIdentifier> = []
        while let current = candidate, visited.insert(ObjectIdentifier(current)).inserted {
            if let label = sourceLabel(in: current) { return label }
            candidate = current.presentingViewController
        }
        return "书架"
    }

    private func sourceLabel(in controller: UIViewController) -> String? {
        if controller is ShelfController { return "书架" }
        if controller is NotesController { return "笔记" }
        if controller is QuestionController || controller is QuestionHistoryController { return "问答" }
        for child in controller.children {
            if let label = sourceLabel(in: child) { return label }
        }
        return nil
    }

    // MARK: - PDFView

    private func configurePDFView() {
        pdfView.backgroundColor = BookDesign.paper
        pdfView.accessibilityIdentifier = "pdf-reader-view"
        pdfView.displayMode = .singlePageContinuous
        pdfView.displayDirection = .vertical
        // 打开性能：减少首屏无谓的阴影/分页装饰与页间距重排。
        pdfView.pageShadowsEnabled = false
        pdfView.displaysPageBreaks = false
        pdfView.pageBreakMargins = .zero
        pdfView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(pdfView)
    }

    // MARK: - 打开文档（性能：异步 + 分段计时）

    private func openDocumentAndInstall() async {
        let loadStart = CFAbsoluteTimeGetCurrent()
        do {
            let doc = try await PDFReaderDocumentLoader.open(url: documentURL)
            logOpenTiming("PDFDocument.open(serialQueue)", since: loadStart)
            guard !Task.isCancelled, isViewLoaded else { return }
            install(document: doc)
        } catch is CancellationError {
            return
        } catch {
            guard !Task.isCancelled else { return }
            presentOpenFailure(error)
        }
    }

    /// 文档就绪后回主线程挂载：先恢复页码，再去掉 loading 让用户可交互；标注/书签延后到下一帧。
    private func install(document doc: PDFKit.PDFDocument) {
        let installStart = CFAbsoluteTimeGetCurrent()
        let fileSize = (try? FileManager.default.attributesOfItem(atPath: documentURL.path)[.size] as? NSNumber)?.doubleValue ?? 0
        NSLog("PDF_OPEN_TIMING info pages=%d file=%.1fMB", doc.pageCount, fileSize / 1024 / 1024)
        document = doc
        let setStart = CFAbsoluteTimeGetCurrent()
        pdfView.document = doc
        logOpenTiming("pdfView.document=", since: setStart)
        let scaleStart = CFAbsoluteTimeGetCurrent()
        pdfView.autoScales = true
        logOpenTiming("pdfView.autoScales", since: scaleStart)
        let restoreStart = CFAbsoluteTimeGetCurrent()
        restoreProgressIfNeeded()
        logOpenTiming("restoreProgressIfNeeded", since: restoreStart)
        let layoutStart = CFAbsoluteTimeGetCurrent()
        view.layoutIfNeeded()
        logOpenTiming("first layoutIfNeeded(含首屏渲染)", since: layoutStart)
        hideLoading()
        logOpenTiming("install done / 可交互(loading hidden)", since: installStart)
        logOpenTiming("TOTAL 可交互(since init)", since: openClock)
        // 观察首帧后主线程是否仍被 PDFKit 长时间占用（日志延迟出现即说明主线程被阻塞）。
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
            guard let self else { return }
            self.logOpenTiming("mainLoop 0.5s after interactive(since init)", since: self.openClock)
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.0) { [weak self] in
            guard let self else { return }
            self.logOpenTiming("mainLoop 2.0s after interactive(since init)", since: self.openClock)
        }
        // 次要工作延后到首帧后：标注重建、书签 UI、页码/进度刷新。
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            let deferredStart = CFAbsoluteTimeGetCurrent()
            self.updatePageIndicator()
            self.refreshBookmarkUI(animated: false)
            self.renderNoteAnnotations()
            self.logOpenTiming("post-first-frame(标注+书签+页码)", since: deferredStart)
            self.logOpenTiming("TOTAL 首帧后次要工作完成(since init)", since: self.openClock)
        }
    }

    private func configureLoadingView() {
        loadingView.backgroundColor = BookDesign.paper
        loadingView.accessibilityIdentifier = "pdf-reader-loading"
        loadingView.accessibilityViewIsModal = true
        loadingView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(loadingView)
        loadingLabel.text = "正在打开这本书…"
        loadingLabel.textAlignment = .center
        loadingSpinner.color = BookDesign.ink3
        loadingSpinner.startAnimating()
        for child in [loadingLabel, loadingSpinner] as [UIView] {
            child.translatesAutoresizingMaskIntoConstraints = false
            loadingView.addSubview(child)
        }
        NSLayoutConstraint.activate([
            loadingView.topAnchor.constraint(equalTo: view.topAnchor),
            loadingView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            loadingView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            loadingView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            loadingSpinner.centerXAnchor.constraint(equalTo: loadingView.centerXAnchor),
            loadingSpinner.centerYAnchor.constraint(equalTo: loadingView.centerYAnchor, constant: -18),
            loadingLabel.topAnchor.constraint(equalTo: loadingSpinner.bottomAnchor, constant: 12),
            loadingLabel.centerXAnchor.constraint(equalTo: loadingView.centerXAnchor)
        ])
    }

    private func hideLoading() {
        loadingSpinner.stopAnimating()
        loadingView.isHidden = true
        loadingView.removeFromSuperview()
    }

    private func presentOpenFailure(_ error: Error) {
        loadingSpinner.stopAnimating()
        loadingLabel.text = "无法打开这本书"
        guard view.window != nil, presentedViewController == nil else { return }
        let alert = BookAlertController(title: "无法打开这本书", message: error.localizedDescription, preferredStyle: .alert)
        alert.addAction(BookAlertAction(title: "知道了", style: .cancel) { [weak self] _ in
            self?.dismiss(animated: true)
        })
        present(alert, animated: true)
    }

    /// 打开流程分段计时：`NSLog` 在真机/模拟器 Console 可见（QA 抓日志用，阶段完成可移除）。
    private func logOpenTiming(_ label: String, since start: CFAbsoluteTime) {
        let milliseconds = (CFAbsoluteTimeGetCurrent() - start) * 1000
        NSLog("PDF_OPEN_TIMING %@ %.1fms", label, milliseconds)
    }

    // MARK: - 工具栏（返回 / 书名 / 书签 / 目录 / 说明）

    private func configureToolbar() {
        toolbar.backgroundColor = BookDesign.paper.withAlphaComponent(0.94)
        toolbar.accessibilityIdentifier = "pdf-reader-toolbar"
        toolbar.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(toolbar)

        let hairline = UIView()
        hairline.backgroundColor = BookDesign.line
        hairline.translatesAutoresizingMaskIntoConstraints = false
        toolbar.addSubview(hairline)

        var backConfig = UIButton.Configuration.plain()
        backConfig.image = BookDesign.symbol("arrow.left", size: 18, weight: .medium)
        backConfig.baseForegroundColor = BookDesign.ink2
        backConfig.contentInsets = .zero
        backButton.configuration = backConfig
        backButton.accessibilityLabel = "书架"
        backButton.accessibilityIdentifier = "reader-close"
        backButton.addTarget(self, action: #selector(close), for: .touchUpInside)

        var bookmarkConfig = UIButton.Configuration.plain()
        bookmarkConfig.image = BookDesign.symbol("bookmark", size: 18, weight: .medium)
        bookmarkConfig.baseForegroundColor = BookDesign.ink2
        bookmarkConfig.contentInsets = NSDirectionalEdgeInsets(top: 13, leading: 13, bottom: 13, trailing: 13)
        bookmarkButton.configuration = bookmarkConfig
        bookmarkButton.accessibilityLabel = "添加本页书签"
        bookmarkButton.accessibilityIdentifier = "pdf-bookmark-toggle"
        bookmarkButton.addTarget(self, action: #selector(toggleBookmark), for: .touchUpInside)

        var contentsConfig = UIButton.Configuration.plain()
        contentsConfig.image = BookDesign.symbol("list.bullet", size: 18, weight: .medium)
        contentsConfig.baseForegroundColor = BookDesign.ink2
        contentsConfig.contentInsets = NSDirectionalEdgeInsets(top: 13, leading: 13, bottom: 13, trailing: 13)
        contentsButton.configuration = contentsConfig
        contentsButton.accessibilityLabel = "目录与书签"
        contentsButton.accessibilityIdentifier = "pdf-contents"
        contentsButton.addTarget(self, action: #selector(openContents), for: .touchUpInside)

        var helpConfig = UIButton.Configuration.plain()
        helpConfig.image = BookDesign.symbol("questionmark.circle", size: 18, weight: .medium)
        helpConfig.baseForegroundColor = BookDesign.ink2
        helpConfig.contentInsets = NSDirectionalEdgeInsets(top: 13, leading: 13, bottom: 13, trailing: 13)
        helpButton.configuration = helpConfig
        helpButton.accessibilityLabel = "关于这份 PDF"
        helpButton.accessibilityIdentifier = "pdf-reader-help"
        helpButton.addTarget(self, action: #selector(showPDFHelp), for: .touchUpInside)
        // 仅含扫描页的 PDF 才提供说明入口；不自动弹、选字时也不提示。
        helpButton.isHidden = !(book.pdfInfo?.hasScannedPages ?? false)

        titleLabel.text = book.title
        titleLabel.textAlignment = .center
        titleLabel.lineBreakMode = .byTruncatingTail
        titleLabel.numberOfLines = 1
        // 工具栏空间不足时让标题先让位：标题压缩阻力与居中优先级都低于右侧按钮，
        // 长书名下标题会向左让位/截断，书签、目录和「?」始终保持 intrinsic 宽度与可点性。
        titleLabel.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        titleLabel.accessibilityIdentifier = "reader-title"

        for child in [backButton, titleLabel] as [UIView] {
            child.translatesAutoresizingMaskIntoConstraints = false
            toolbar.addSubview(child)
        }
        let trailing = UIStackView(arrangedSubviews: [bookmarkButton, contentsButton, helpButton])
        trailing.axis = .horizontal
        trailing.alignment = .center
        trailing.spacing = 6
        trailing.translatesAutoresizingMaskIntoConstraints = false
        toolbar.addSubview(trailing)
        // 居中只是偏好：右侧 3 个按钮 + 长书名时标题向左让位，而不是压扁按钮。
        let titleCentering = titleLabel.centerXAnchor.constraint(equalTo: toolbar.centerXAnchor)
        titleCentering.priority = .defaultLow
        NSLayoutConstraint.activate([
            toolbar.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            toolbar.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            toolbar.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            toolbar.heightAnchor.constraint(equalToConstant: 52),
            hairline.leadingAnchor.constraint(equalTo: toolbar.leadingAnchor),
            hairline.trailingAnchor.constraint(equalTo: toolbar.trailingAnchor),
            hairline.bottomAnchor.constraint(equalTo: toolbar.bottomAnchor),
            hairline.heightAnchor.constraint(equalToConstant: 1),
            backButton.leadingAnchor.constraint(equalTo: toolbar.leadingAnchor, constant: 13),
            backButton.widthAnchor.constraint(equalToConstant: 44),
            backButton.heightAnchor.constraint(equalToConstant: 44),
            backButton.centerYAnchor.constraint(equalTo: toolbar.centerYAnchor),
            trailing.trailingAnchor.constraint(equalTo: toolbar.trailingAnchor, constant: -16),
            trailing.centerYAnchor.constraint(equalTo: toolbar.centerYAnchor),
            trailing.heightAnchor.constraint(equalToConstant: 44),
            titleCentering,
            titleLabel.centerYAnchor.constraint(equalTo: toolbar.centerYAnchor),
            titleLabel.leadingAnchor.constraint(greaterThanOrEqualTo: backButton.trailingAnchor, constant: 8),
            titleLabel.trailingAnchor.constraint(lessThanOrEqualTo: trailing.leadingAnchor, constant: -8)
        ])
    }

    // MARK: - 页脚（页码 + 进度 + 单页/连续）

    private func configureFooter() {
        footer.backgroundColor = BookDesign.paper.withAlphaComponent(0.94)
        footer.accessibilityIdentifier = "pdf-reader-footer"
        footer.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(footer)

        let hairline = UIView()
        hairline.backgroundColor = BookDesign.line
        hairline.translatesAutoresizingMaskIntoConstraints = false
        footer.addSubview(hairline)

        pageLabel.textAlignment = .center
        pageLabel.accessibilityIdentifier = "pdf-reader-page"
        progressView.progressTintColor = BookDesign.lamp
        progressView.trackTintColor = BookDesign.line
        progressView.accessibilityIdentifier = "pdf-reader-progress"
        progressView.accessibilityLabel = "阅读进度"

        var modeConfig = UIButton.Configuration.plain()
        modeConfig.baseForegroundColor = BookDesign.ink2
        modeConfig.contentInsets = .zero
        modeConfig.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { incoming in
            var outgoing = incoming
            outgoing.font = BookType.sans(12, weight: .medium, style: .subheadline)
            return outgoing
        }
        modeButton.configuration = modeConfig
        modeButton.accessibilityIdentifier = "pdf-reader-mode"
        modeButton.addTarget(self, action: #selector(toggleDisplayMode), for: .touchUpInside)

        var askConfig = UIButton.Configuration.plain()
        askConfig.title = "问书灯"
        askConfig.image = BookDesign.symbol("lightbulb", size: 14, weight: .medium)
        askConfig.imagePadding = 5
        askConfig.baseForegroundColor = BookDesign.lampInk
        askConfig.contentInsets = .zero
        askConfig.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { incoming in
            var outgoing = incoming
            outgoing.font = BookType.sans(12, weight: .medium, style: .subheadline)
            return outgoing
        }
        askButton.configuration = askConfig
        askButton.accessibilityLabel = "问问书灯"
        askButton.accessibilityIdentifier = "pdf-reader-ask"
        askButton.addTarget(self, action: #selector(askCurrentPage), for: .touchUpInside)

        for child in [askButton, pageLabel, progressView, modeButton] as [UIView] {
            child.translatesAutoresizingMaskIntoConstraints = false
            footer.addSubview(child)
        }
        NSLayoutConstraint.activate([
            footer.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            footer.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            footer.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            hairline.leadingAnchor.constraint(equalTo: footer.leadingAnchor),
            hairline.trailingAnchor.constraint(equalTo: footer.trailingAnchor),
            hairline.topAnchor.constraint(equalTo: footer.topAnchor),
            hairline.heightAnchor.constraint(equalToConstant: 1),
            pageLabel.topAnchor.constraint(equalTo: footer.topAnchor, constant: 10),
            pageLabel.centerXAnchor.constraint(equalTo: footer.centerXAnchor),
            pageLabel.leadingAnchor.constraint(greaterThanOrEqualTo: askButton.trailingAnchor, constant: 8),
            askButton.leadingAnchor.constraint(equalTo: footer.leadingAnchor, constant: 14),
            askButton.centerYAnchor.constraint(equalTo: pageLabel.centerYAnchor),
            askButton.heightAnchor.constraint(equalToConstant: 44),
            pageLabel.trailingAnchor.constraint(lessThanOrEqualTo: modeButton.leadingAnchor, constant: -8),
            modeButton.trailingAnchor.constraint(equalTo: footer.trailingAnchor, constant: -12),
            modeButton.centerYAnchor.constraint(equalTo: pageLabel.centerYAnchor),
            modeButton.heightAnchor.constraint(equalToConstant: 44),
            progressView.topAnchor.constraint(equalTo: modeButton.bottomAnchor, constant: 2),
            progressView.leadingAnchor.constraint(equalTo: footer.leadingAnchor, constant: 28),
            progressView.trailingAnchor.constraint(equalTo: footer.trailingAnchor, constant: -28),
            progressView.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -10)
        ])
        updateModeButton()
    }

    // MARK: - 页面书签丝带（页面上沿右侧）

    private func configureBookmarkRibbon() {
        bookmarkRibbon.translatesAutoresizingMaskIntoConstraints = false
        bookmarkRibbon.isHidden = true
        bookmarkRibbon.alpha = 0
        bookmarkRibbon.addTarget(self, action: #selector(toggleBookmark), for: .touchUpInside)
        view.addSubview(bookmarkRibbon)
        NSLayoutConstraint.activate([
            bookmarkRibbon.trailingAnchor.constraint(equalTo: pdfView.trailingAnchor, constant: -12),
            bookmarkRibbon.topAnchor.constraint(equalTo: toolbar.bottomAnchor, constant: 10),
            bookmarkRibbon.widthAnchor.constraint(equalToConstant: 26),
            bookmarkRibbon.heightAnchor.constraint(equalToConstant: 38)
        ])
    }

    private func configureLayout() {
        // 页面永远全屏固定：工具栏/页脚悬浮在页面之上，显示/隐藏不会改变 PDFView frame 或缩放。
        NSLayoutConstraint.activate([
            pdfView.topAnchor.constraint(equalTo: view.topAnchor),
            pdfView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            pdfView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            pdfView.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])
        // 确保 chrome 在 PDFView 之上（EPS 式悬浮），不随页面滚动/缩放。
        view.bringSubviewToFront(toolbar)
        view.bringSubviewToFront(footer)
    }

    // MARK: - 沉浸式阅读（单击页面隐藏/显示上下 chrome）

    // 阅读器打开期间安全区恒定：状态栏 / home indicator 始终隐藏，与 chrome 是否显示无关。
    // 这样 chrome 显隐只需 alpha 动画，不会触发 PDFView 内部按 safeArea 重排（页面不跳）。
    override var prefersStatusBarHidden: Bool { true }

    override var prefersHomeIndicatorAutoHidden: Bool { true }

    /// 单击页面（无标注命中、无选区、无浮层）切换 chrome；PDFView 始终全屏固定、安全区恒定，
    /// 只淡出/淡入悬浮的顶部工具栏与底部页脚，页面位置与缩放完全不受影响。
    private func toggleImmersiveChrome() {
        guard presentedViewController == nil, !chromeAnimating else { return }
        let hiding = !chromeHidden
        chromeAnimating = true
        if hiding {
            // 先收掉选区/书签丝带，再隐藏 chrome，避免残留浮层。
            clearActiveSelection()
            bookmarkRibbon.isHidden = true
            bookmarkRibbon.alpha = 0
            bookmarkRibbonVisible = false
        }
        chromeHidden = hiding
        toolbar.isUserInteractionEnabled = !hiding
        footer.isUserInteractionEnabled = !hiding
        toolbar.accessibilityElementsHidden = hiding
        footer.accessibilityElementsHidden = hiding
        if !hiding {
            // 显示前先恢复层级可见，再做 0.2s alpha 动画；PDFView frame/缩放保持不变。
            toolbar.isHidden = false
            footer.isHidden = false
        }
        let reduceMotion = UIAccessibility.isReduceMotionEnabled
        UIView.animate(
            withDuration: reduceMotion ? 0 : 0.2,
            delay: 0,
            options: [.beginFromCurrentState, .allowUserInteraction]
        ) {
            self.toolbar.alpha = hiding ? 0 : 1
            self.footer.alpha = hiding ? 0 : 1
        } completion: { _ in
            self.chromeAnimating = false
            if hiding {
                self.toolbar.isHidden = true
                self.footer.isHidden = true
            } else {
                // 页面从未移动，只恢复书签丝带（按当前页书签状态）。
                self.refreshBookmarkUI(animated: false)
            }
        }
    }

    // MARK: - 页码与进度

    private func currentPageNumber() -> Int {
        guard let document = document, let page = pdfView.currentPage else { return max(1, lastKnownPage) }
        return min(max(document.index(for: page) + 1, 1), document.pageCount)
    }

    private var pageCount: Int { document?.pageCount ?? 0 }

    private func totalProgression(for page: Int) -> Double {
        pageCount > 1 ? Double(page - 1) / Double(pageCount - 1) : 1
    }

    private func updatePageIndicator() {
        let page = currentPageNumber()
        pageLabel.text = "第 \(page) / \(pageCount) 页"
        let progress = Float(totalProgression(for: page))
        progressView.progress = progress
        progressView.accessibilityValue = "已读 \(Int((Double(progress) * 100).rounded()))%"
    }

    private func savedPageNumber() -> Int? {
        guard let json = book.locatorJSON,
              let locator = try? Locator(json: JSONValue(jsonString: json, warnings: nil), warnings: nil)
        else { return nil }
        return locator.locations.position
    }

    private func restoreProgressIfNeeded() {
        // 文档未就绪时不标记完成：viewDidAppear 可能早于异步打开，等 install 后再恢复页码。
        guard document != nil, !didRestoreProgress else { return }
        didRestoreProgress = true
        // 恢复前的初始页回调不能写回书架（避免把「默认第 1 页」覆盖已保存进度）。
        pendingProgressPage = nil
        // 引用跳转直接落到引用页；否则恢复上次阅读页。
        guard let saved = targetPage ?? savedPageNumber() else { return }
        lastKnownPage = min(max(saved, 1), pageCount)
        goToPage(lastKnownPage)
        updatePageIndicator()
        refreshBookmarkUI(animated: false)
    }

    private func goToPage(_ number: Int) {
        let page = min(max(number, 1), pageCount)
        guard let document = document, let target = document.page(at: page - 1) else { return }
        pdfView.go(to: target)
        // 切换显示模式后 PDFView 可能到下一轮布局才应用目标页。
        DispatchQueue.main.async { [weak self] in
            guard let self, let current = self.pdfView.currentPage, current !== target else { return }
            self.pdfView.go(to: target)
        }
    }

    @objc private func pageChanged() {
        if !firstPageChangeLogged, document != nil {
            firstPageChangeLogged = true
            logOpenTiming("first PDFViewPageChanged", since: openClock)
        }
        updatePageIndicator()
        scheduleProgressWrite()
        refreshBookmarkUI()
        clearActiveSelection()
    }

    /// 翻页时 trailing debounce 0.7s 再落盘，减少高频 saveReadingState；关闭/离开时立即 flush。
    private func scheduleProgressWrite() {
        let page = currentPageNumber()
        // 恢复完成前只记录不写，避免把初始页写回书架。
        guard didRestoreProgress else {
            pendingProgressPage = page
            return
        }
        pendingProgressPage = page
        progressWriteItem?.cancel()
        let item = DispatchWorkItem { [weak self] in
            self?.flushProgress()
        }
        progressWriteItem = item
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.7, execute: item)
    }

    /// 立即把待写页码落盘（关闭/离开阅读器/切后台时调用），无待写则用当前页。
    private func flushProgress() {
        progressWriteItem?.cancel()
        progressWriteItem = nil
        // 恢复完成前不写：防止默认第 1 页覆盖已保存的阅读进度。
        guard didRestoreProgress else { return }
        let page = pendingProgressPage ?? currentPageNumber()
        pendingProgressPage = nil
        writeReadingState(page: page)
    }

    private func writeReadingState(page: Int) {
        guard page >= 1, page <= pageCount, page != lastKnownPage else { return }
        lastKnownPage = page
        let total = totalProgression(for: page)
        guard let href = AnyURL(string: "pdf://page/\(page)") else { return }
        let locator = Locator(
            href: href,
            mediaType: .pdf,
            title: "第 \(page) 页",
            locations: .init(progression: total, totalProgression: total, position: page),
            text: .init(highlight: "")
        )
        try? library.saveReadingState(locator, settings: book.readingSettings ?? ReadingSettings(), for: book.id)
    }

    // MARK: - 页级书签

    private var bookmarks: [Bookmark] {
        library.books.first { $0.id == book.id }?.bookmarks ?? []
    }

    private func bookmarkForCurrentPage() -> Bookmark? {
        let page = currentPageNumber()
        return bookmarks.first { PDFPageBookmarks.page(of: $0) == page }
    }

    /// 书签 locator：页码 + 页级进度 + 该页首行摘要（扫描页为空）。
    /// totalProgression 沿用 Readium 页级约定 `(N-1)/pageCount`，与书架「已读 %」的平滑进度互不影响。
    private func makeBookmark(page: Int) -> Bookmark? {
        let total = pageCount > 0 ? Double(page - 1) / Double(pageCount) : 0
        guard let href = AnyURL(string: "pdf://page/\(page)") else { return nil }
        let locator = Locator(
            href: href,
            mediaType: .pdf,
            title: "第 \(page) 页",
            locations: .init(progression: total, totalProgression: total, position: page),
            text: .init(highlight: firstLine(ofPage: page))
        )
        return Bookmark(locator: locator)
    }

    private func firstLine(ofPage page: Int) -> String {
        guard let document = document, let pdfPage = document.page(at: page - 1), let text = pdfPage.string else { return "" }
        let line = text.components(separatedBy: .newlines)
            .first { !$0.trimmingCharacters(in: .whitespaces).isEmpty } ?? ""
        // 摘要只做列表展示，限制长度避免把整页塞进目录 JSON。
        return String(line.trimmingCharacters(in: .whitespaces).prefix(160))
    }

    private func refreshBookmarkUI(animated: Bool = true) {
        let bookmarked = bookmarkForCurrentPage() != nil
        bookmarkButton.configuration?.image = BookDesign.symbol(bookmarked ? "bookmark.fill" : "bookmark", size: 18, weight: .medium)
        bookmarkButton.configuration?.baseForegroundColor = bookmarked ? BookDesign.lampInk : BookDesign.ink2
        bookmarkButton.accessibilityLabel = bookmarked ? "取消本页书签" : "添加本页书签"
        bookmarkButton.accessibilityValue = bookmarked ? "此页已有书签" : nil
        setRibbonVisible(bookmarked, animated: animated)
    }

    private func setRibbonVisible(_ visible: Bool, animated: Bool) {
        // chrome 隐藏时书签丝带也视为沉浸内容的一部分，等恢复 chrome 时按当前页重算。
        guard !chromeHidden else { return }
        guard visible != bookmarkRibbonVisible else { return }
        bookmarkRibbonVisible = visible
        let reduceMotion = UIAccessibility.isReduceMotionEnabled
        if visible {
            bookmarkRibbon.isHidden = false
            bookmarkRibbon.alpha = 0
            if animated && !reduceMotion {
                bookmarkRibbon.transform = CGAffineTransform(scaleX: 0.7, y: 0.7)
                UIView.animate(withDuration: 0.18) {
                    self.bookmarkRibbon.alpha = 1
                    self.bookmarkRibbon.transform = .identity
                }
            } else {
                bookmarkRibbon.alpha = 1
                bookmarkRibbon.transform = .identity
            }
        } else if !bookmarkRibbon.isHidden {
            if animated && !reduceMotion {
                UIView.animate(withDuration: 0.15, animations: {
                    self.bookmarkRibbon.alpha = 0
                }) { _ in
                    self.bookmarkRibbon.isHidden = true
                }
            } else {
                bookmarkRibbon.isHidden = true
                bookmarkRibbon.alpha = 0
            }
        }
    }

    @objc private func toggleBookmark() {
        if let bookmark = bookmarkForCurrentPage() {
            removeBookmark(bookmark)
        } else {
            saveBookmark(page: currentPageNumber())
        }
    }

    private func saveBookmark(page: Int) {
        guard let bookmark = makeBookmark(page: page) else {
            showBookmarkFailure(title: "书签保存失败", message: "未能定位当前页，请翻页后重试。")
            return
        }
        do {
            try library.saveBookmark(bookmark, for: book.id)
            feedbackGenerator.impactOccurred()
            refreshBookmarkUI()
        } catch {
            showBookmarkFailure(title: "书签保存失败", message: "尚未保存，重启后不会保留。可稍后重试。")
        }
    }

    private func removeBookmark(_ bookmark: Bookmark) {
        do {
            try library.removeBookmark(bookmark.id, for: book.id)
            feedbackGenerator.impactOccurred()
            refreshBookmarkUI()
        } catch {
            showBookmarkFailure(title: "书签删除失败", message: "原书签仍保留，可稍后重试。")
        }
    }

    private func showBookmarkFailure(title: String, message: String) {
        guard presentedViewController == nil else { return }
        let alert = BookAlertController(title: title, message: message, preferredStyle: .alert)
        alert.addAction(BookAlertAction(title: "知道了", style: .default))
        present(alert, animated: true)
    }

    // MARK: - 目录 / 书签面板

    @objc private func openContents() {
        guard let document = document else { return }
        let panel = PDFContentsController(
            book: book,
            library: library,
            document: document,
            navigate: { [weak self] page in
                self?.goToPage(page)
                self?.refreshBookmarkUI()
            },
            onChange: { [weak self] in self?.refreshBookmarkUI() }
        )
        let sheet = UINavigationController(rootViewController: panel)
        sheet.overrideUserInterfaceStyle = overrideUserInterfaceStyle
        sheet.sheetPresentationController?.detents = [.large()]
        present(sheet, animated: true)
    }

    // MARK: - PDF 文字标注（高亮 / 笔记）

    private func configureNoteAnnotations() {
        // 标注重建延后到文档就绪/首帧之后（见 install(document:)），避免阻塞打开。
        notesObserver = NotificationCenter.default.addObserver(
            forName: LibraryStore.changed,
            object: library,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in
                self?.renderNoteAnnotations()
                self?.refreshBookmarkUI(animated: false)
            }
        }
    }

    private func configureSelectionInteraction() {
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(selectionChanged),
            name: .PDFViewSelectionChanged,
            object: pdfView
        )
        let tap = UITapGestureRecognizer(target: self, action: #selector(pdfTapped(_:)))
        tap.cancelsTouchesInView = false
        tap.delegate = self
        pageTapGesture = tap
        pdfView.addGestureRecognizer(tap)
    }

    /// 当前书的 PDF 标注（有几何的 note/highlight）；旧笔记无 geometry 不渲染。
    private func pdfNotes() -> [BookNote] {
        (library.books.first { $0.id == book.id }?.notes ?? []).filter { $0.pdf != nil }
    }

    private func annotationUserName(for id: UUID) -> String {
        Self.noteAnnotationPrefix + id.uuidString
    }

    private func pageRect(from rect: PDFNormRect, in pageBounds: CGRect) -> CGRect {
        CGRect(
            x: pageBounds.minX + rect.x * pageBounds.width,
            y: pageBounds.minY + rect.y * pageBounds.height,
            width: rect.w * pageBounds.width,
            height: rect.h * pageBounds.height
        )
    }

    /// 笔记图标放在最后一行末尾，页面上可见也用于点击命中。
    private func noteIconRect(for lastLine: CGRect) -> CGRect {
        let side = max(10, min(18, lastLine.height))
        return CGRect(x: lastLine.maxX + 2, y: lastLine.minY, width: side, height: side)
    }

    /// 笔记内容签名：进度/书签触发的 LibraryChanged 很频繁，只有标注本身变化时才重建 annotation。
    private func noteSignature() -> String {
        pdfNotes().map { note in
            let page = note.pdf?.page ?? 0
            let rects = note.pdf?.rects.map { "\($0.x),\($0.y),\($0.w),\($0.h)" }.joined(separator: "/") ?? ""
            return "\(note.id.uuidString)|\(note.body)|\(note.highlightColor.rawValue)|\(page)|\(rects)"
        }.joined(separator: ";")
    }

    /// 按 BookNote 重建 PDFAnnotation：高亮 → .highlight；笔记（body 非空）→ .underline + .text 图标。
    /// 先移除本控制器添加过的 annotation，避免重复；标注未变化时跳过。
    private func renderNoteAnnotations() {
        guard let document = document else { return }
        let signature = noteSignature()
        guard signature != notesSignature || !didRenderAnnotations else { return }
        notesSignature = signature
        didRenderAnnotations = true
        for annotations in noteAnnotations.values {
            for annotation in annotations { annotation.page?.removeAnnotation(annotation) }
        }
        noteAnnotations = [:]
        for note in pdfNotes() {
            guard let geometry = note.pdf, geometry.page >= 1, geometry.page <= document.pageCount,
                  let page = document.page(at: geometry.page - 1) else { continue }
            let pageBounds = page.bounds(for: .cropBox)
            guard pageBounds.width > 0, pageBounds.height > 0 else { continue }
            let paint = note.highlightColor.tint.resolvedColor(with: traitCollection)
            let isNote = !note.body.isEmpty
            var annotations: [PDFAnnotation] = []
            for (index, rect) in geometry.rects.enumerated() {
                let bounds = pageRect(from: rect, in: pageBounds)
                guard bounds.width > 0.1, bounds.height > 0.1 else { continue }
                let type: PDFAnnotationSubtype = isNote ? .underline : .highlight
                let annotation = PDFAnnotation(bounds: bounds, forType: type, withProperties: nil)
                annotation.color = paint
                annotation.userName = annotationUserName(for: note.id)
                annotation.contents = isNote ? note.body : note.quote
                page.addAnnotation(annotation)
                annotations.append(annotation)
                if isNote, index == geometry.rects.count - 1 {
                    let icon = PDFAnnotation(bounds: noteIconRect(for: bounds), forType: .text, withProperties: nil)
                    icon.color = paint
                    icon.contents = note.body
                    icon.userName = annotationUserName(for: note.id)
                    page.addAnnotation(icon)
                    annotations.append(icon)
                }
            }
            if !annotations.isEmpty { noteAnnotations[note.id] = annotations }
        }
        pdfView.layoutDocumentView()
    }

    private var preferredHighlightColor: HighlightColor {
        HighlightColor(rawValue: UserDefaults.standard.string(forKey: "reader-highlight-color") ?? "") ?? .yellow
    }

    private func rememberHighlightColor(_ color: HighlightColor) {
        UserDefaults.standard.set(color.rawValue, forKey: "reader-highlight-color")
    }

    private func showAnnotationFailure(title: String, message: String) {
        guard presentedViewController == nil else { return }
        let alert = BookAlertController(title: title, message: message, preferredStyle: .alert)
        alert.addAction(BookAlertAction(title: "知道了", style: .default))
        present(alert, animated: true)
    }

    // MARK: 选中文字 → 纸白浮层

    @objc private func selectionChanged() {
        guard presentedViewController == nil else { return }
        selectionMenuWorkItem?.cancel()
        selectionMenuWorkItem = nil
        hideSelectionMenu()
        guard let selection = pdfView.currentSelection else {
            activeSelection = nil
            return
        }
        let quote = (selection.string ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !quote.isEmpty else {
            activeSelection = nil
            return
        }
        activeSelection = selection
        // 保留 PDFKit 原生选区与拖拽手柄：只染色，不冻结、不设 highlightedSelections、不 clearSelection。
        selection.color = BookDesign.selection.resolvedColor(with: traitCollection)
        // 只收起系统编辑菜单（不动选区），给原生手柄留出拖拽空间。
        suppressSystemTextMenu(preserveSelection: true)
        // 拖动/调整选区期间浮层保持收起；停止约 0.25s 后再出现并重新定位。
        let item = DispatchWorkItem { [weak self] in self?.presentSelectionMenuIfStable() }
        selectionMenuWorkItem = item
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25, execute: item)
    }

    /// 选区稳定（停止拖拽手柄）后显示纸白浮层；期间任何新的 selectionChanged 都会取消/重排计时。
    private func presentSelectionMenuIfStable() {
        selectionMenuWorkItem = nil
        guard presentedViewController == nil else { return }
        guard let selection = pdfView.currentSelection else {
            activeSelection = nil
            hideSelectionMenu()
            return
        }
        let quote = (selection.string ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !quote.isEmpty else {
            activeSelection = nil
            hideSelectionMenu()
            return
        }
        activeSelection = selection
        suppressSystemTextMenu(preserveSelection: true)
        showSelectionMenu(for: selection)
    }

    private func selectionFrame(for selection: PDFSelection) -> CGRect? {
        var union: CGRect?
        for page in selection.pages {
            let pageBounds = selection.bounds(for: page)
            guard pageBounds.width > 0.1, pageBounds.height > 0.1 else { continue }
            let inPdfView = pdfView.convert(pageBounds, from: page)
            let inView = view.convert(inPdfView, from: pdfView)
            union = union.map { $0.union(inView) } ?? inView
        }
        return union
    }

    private func showSelectionMenu(for selection: PDFSelection) {
        hideSelectionMenu()
        guard let frame = selectionFrame(for: selection) else { return }
        let menu = PDFSelectionMenu()
        menu.onHighlight = { [weak self] in
            guard let self, let current = self.currentSelectionOrFallback(selection) else { return }
            self.presentHighlightPalette(for: current)
        }
        menu.onNote = { [weak self] in
            guard let self, let current = self.currentSelectionOrFallback(selection) else { return }
            self.beginNote(for: current)
        }
        menu.onAsk = { [weak self] in
            guard let self, let current = self.currentSelectionOrFallback(selection) else { return }
            self.askSelection(current)
        }
        menu.onCancel = { [weak self] in self?.clearActiveSelection() }
        view.addSubview(menu)
        menu.place(belowToolbar: toolbar.frame.maxY, aboveFooter: footer.frame.minY, near: frame, in: view)
        selectionMenu = menu
    }

    /// 菜单操作时优先用最新原生选区（用户可能刚拖过手柄），拿不到再退回显示菜单时的选区。
    private func currentSelectionOrFallback(_ fallback: PDFSelection) -> PDFSelection? {
        guard presentedViewController == nil else { return nil }
        return pdfView.currentSelection ?? fallback
    }

    private func hideSelectionMenu() {
        selectionMenu?.removeFromSuperview()
        selectionMenu = nil
    }

    private func clearActiveSelection() {
        selectionMenuWorkItem?.cancel()
        selectionMenuWorkItem = nil
        hideSelectionMenu()
        activeSelection = nil
        pdfView.highlightedSelections = nil
        if pdfView.currentSelection != nil { pdfView.clearSelection() }
    }

    /// 收起系统编辑菜单（点击标注/正常选字时用）。
    /// `preserveSelection=true` 时只 dismiss 菜单，不 clear PDFView 原生选区——正常选字流程要保留手柄让用户拖拽。
    /// PDFKit 的系统菜单可能在触点后异步弹出，因此立即清一次并在 0.05/0.2/0.5s 再补清。
    private func suppressSystemTextMenu(preserveSelection: Bool = false) {
        closeSystemSelectionMenus(preserveSelection: preserveSelection)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) { [weak self] in
            self?.closeSystemSelectionMenus(preserveSelection: preserveSelection)
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { [weak self] in
            self?.closeSystemSelectionMenus(preserveSelection: preserveSelection)
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
            self?.closeSystemSelectionMenus(preserveSelection: preserveSelection)
        }
    }

    private func closeSystemSelectionMenus(preserveSelection: Bool = false) {
        if !preserveSelection, pdfView.currentSelection != nil { pdfView.clearSelection() }
        dismissSystemEditMenus(in: view)
        // 系统编辑菜单可能挂在独立 window/overlay 上（PDFKit 内部）；只清当前阅读器所在窗口，
        // 不去动别的窗口（如键盘/其他 scene）。
        if let window = pdfView.window { dismissSystemEditMenus(in: window) }
        // PDFKit 旧路径可能仍使用 UIMenuController（iOS16 起 deprecated，保留以覆盖旧实现）。
        UIMenuController.shared.hideMenu()
    }

    /// 系统文字选择菜单（iOS16+）是 UIEditMenuInteraction，可能挂在 PDFView/窗口的任意子视图上。
    private func dismissSystemEditMenus(in root: UIView) {
        for interaction in root.interactions {
            if let edit = interaction as? UIEditMenuInteraction { edit.dismissMenu() }
        }
        for subview in root.subviews { dismissSystemEditMenus(in: subview) }
    }

    // MARK: 选中文字 → 高亮调色盘（创建）

    private func presentHighlightPalette(for selection: PDFSelection) {
        guard presentedViewController == nil, let document = document else { return }
        guard let made = PDFNoteGeometry.make(from: selection, document: document) else {
            clearActiveSelection()
            return
        }
        let palette = PDFHighlightPaletteController(
            selected: nil,
            title: "高亮",
            onPick: { [weak self] color in
                guard let self else { return }
                self.rememberHighlightColor(color)
                let note = BookNote(locator: made.locator, color: color, pdf: made.geometry)
                self.saveHighlight(note)
            },
            onDelete: nil,
            deleteTitle: nil
        )
        palette.onCancel = { [weak self] in self?.clearActiveSelection() }
        palette.overrideUserInterfaceStyle = overrideUserInterfaceStyle
        present(palette, animated: true)
    }

    private func saveHighlight(_ note: BookNote) {
        do {
            try library.saveNote(note, for: book.id, highlightOnly: true)
            selectionFeedback.selectionChanged()
            clearActiveSelection()
            renderNoteAnnotations()
        } catch {
            showAnnotationFailure(title: "高亮保存失败", message: "尚未保存，可稍后重试。")
        }
    }

    // MARK: 选中文字 → 写笔记

    private func beginNote(for selection: PDFSelection) {
        guard presentedViewController == nil, let document = document else { return }
        guard let made = PDFNoteGeometry.make(from: selection, document: document) else {
            clearActiveSelection()
            return
        }
        var note = BookNote(locator: made.locator, pdf: made.geometry)
        note.color = preferredHighlightColor
        clearActiveSelection()
        suspendDocumentInteractionBeforePresenting()
        suppressSystemTextMenu()
        presentNoteEditor(note: note)
    }

    private func presentNoteEditor(note: BookNote) {
        let editor = NoteEditorController(
            library: library,
            bookID: book.id,
            note: note,
            changed: { [weak self] in
                guard let self else { return }
                self.renderNoteAnnotations()
                self.refreshBookmarkUI(animated: false)
            }
        )
        editor.overrideUserInterfaceStyle = overrideUserInterfaceStyle
        editor.view.accessibilityIdentifier = "pdf-note-editor"
        present(editor, animated: false)
    }

    // MARK: - 书内 AI 问答

    private var hasSearchableText: Bool {
        if book.pdfInfo?.textPageCount == 0 { return false }
        if library.preparation.states[book.id]?.textIndexUnavailable == true { return false }
        return true
    }

    private func currentPageLocator() -> Locator? {
        let page = currentPageNumber()
        guard let href = AnyURL(string: "pdf://page/\(page)") else { return nil }
        let progression = totalProgression(for: page)
        return Locator(
            href: href,
            mediaType: .pdf,
            title: "第 \(page) 页",
            locations: .init(progression: progression, totalProgression: progression, position: page),
            text: .init(highlight: "")
        )
    }

    private func showNoTextAlert() {
        let alert = BookAlertController(
            title: "问问书灯",
            message: "没有可搜索的文字；阅读、缩放和加书签都可以正常使用。",
            preferredStyle: .alert
        )
        alert.addAction(BookAlertAction(title: "知道了", style: .cancel))
        present(alert, animated: true)
    }

    @objc private func askCurrentPage() {
        guard presentedViewController == nil else { return }
        if let activeQuestion {
            (activeQuestion.viewControllers.first as? QuestionController)?.restoreReferenceFocus()
            present(activeQuestion, animated: true)
            return
        }
        guard hasSearchableText else { showNoTextAlert(); return }
        guard !library.questions.loadFailed, library.sourceAvailable(for: book.id),
              let origin = currentPageLocator() else { return }
        let record = ReadingQuestion(book: book, origin: origin)
        library.questions.save(record)
        clearActiveSelection()
        presentQuestion(record.id)
    }

    private func askSelection(_ selection: PDFSelection) {
        guard presentedViewController == nil else { return }
        guard hasSearchableText else { showNoTextAlert(); return }
        guard let document = document,
              !library.questions.loadFailed, library.sourceAvailable(for: book.id),
              let made = PDFNoteGeometry.make(from: selection, document: document) else {
            clearActiveSelection()
            return
        }
        // PDF 是页级定位：一次提问对应这一页的选区。
        let evidence = QuestionEvidence(locator: made.locator)
        var record = ReadingQuestion(book: book, selection: evidence, neighbors: [])
        record.selectionParts = [evidence]
        library.questions.save(record)
        clearActiveSelection()
        presentQuestion(record.id)
    }

    private func presentQuestion(_ id: UUID) {
        let controller = QuestionController(library: library, id: id) { [weak self] target, _ in
            guard let self, let page = target.pdfPageNumber else { return }
            self.goToPage(page)
            self.updatePageIndicator()
            self.refreshBookmarkUI(animated: false)
        }
        let navigation = UINavigationController(rootViewController: controller)
        activeQuestion = navigation
        navigation.overrideUserInterfaceStyle = overrideUserInterfaceStyle
        QuestionSheetPresentation.configure(navigation)
        present(navigation, animated: true)
    }

    // MARK: 点击已有标注

    @objc private func pdfTapped(_ gesture: UITapGestureRecognizer) {
        guard presentedViewController == nil else { return }
        let hadSelectionAtTouchStart = selectionAtTouchStart
        selectionAtTouchStart = false
        let point = gesture.location(in: pdfView)
        guard let note = note(at: point) else {
            // 触点落下时已有选区/浮层，或点击瞬间选区仍在：这次单击只清选区/浮层，不切换沉浸 chrome。
            if hadSelectionAtTouchStart || activeSelection != nil || selectionMenu != nil || pdfView.currentSelection != nil {
                clearActiveSelection()
                return
            }
            toggleImmersiveChrome()
            return
        }
        handleAnnotationTap(note)
    }

    /// 点高亮 → 4 色调色盘；点笔记 → 直接打开 NoteEditor（与 EPUB「点笔记即编辑」一致）。
    /// 展示前先清选区/系统编辑菜单，并短暂关闭 documentView 交互，避免系统 Copy/Select All 浮条叠加。
    private func handleAnnotationTap(_ note: BookNote) {
        suspendDocumentInteractionBeforePresenting()
        suppressSystemTextMenu()
        clearActiveSelection()
        if note.body.isEmpty {
            presentHighlightPalette(for: note)
        } else {
            presentNoteEditor(note: note)
        }
    }

    /// 展示自定义浮层/编辑器前短暂关闭 PDF documentView 交互（0.4s），
    /// 取消 PDFKit 可能在途的文字选择/系统菜单手势；恢复不影响已经 present 的浮层。
    private func suspendDocumentInteractionBeforePresenting() {
        guard let documentView = pdfView.documentView, documentView.isUserInteractionEnabled else { return }
        documentView.isUserInteractionEnabled = false
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { [weak self] in
            self?.pdfView.documentView?.isUserInteractionEnabled = true
        }
    }

    private func note(at point: CGPoint) -> BookNote? {
        guard let document = document, let page = pdfView.page(for: point, nearest: false) else { return nil }
        let pageNumber = document.index(for: page) + 1
        let pagePoint = pdfView.convert(point, to: page)
        let pageBounds = page.bounds(for: .cropBox)
        let tolerance: CGFloat = 6
        for note in pdfNotes() where note.pdf?.page == pageNumber {
            guard let geometry = note.pdf else { continue }
            for (index, rect) in geometry.rects.enumerated() {
                var hitRect = pageRect(from: rect, in: pageBounds)
                if !note.body.isEmpty, index == geometry.rects.count - 1 {
                    hitRect = hitRect.union(noteIconRect(for: hitRect))
                }
                if hitRect.insetBy(dx: -tolerance, dy: -tolerance).contains(pagePoint) { return note }
            }
        }
        return nil
    }

    private func presentHighlightPalette(for note: BookNote) {
        guard presentedViewController == nil else { return }
        let palette = PDFHighlightPaletteController(
            selected: note.highlightColor,
            title: "高亮",
            onPick: { [weak self] color in self?.updateHighlightColor(color, note: note) },
            onDelete: { [weak self] in self?.deleteHighlight(note) },
            deleteTitle: "取消高亮"
        )
        palette.overrideUserInterfaceStyle = overrideUserInterfaceStyle
        present(palette, animated: true)
    }

    private func updateHighlightColor(_ color: HighlightColor, note: BookNote) {
        rememberHighlightColor(color)
        do {
            try library.updateNoteColor(color, forNoteID: note.id, bookID: book.id)
            selectionFeedback.selectionChanged()
            renderNoteAnnotations()
        } catch {
            showAnnotationFailure(title: "颜色保存失败", message: "高亮颜色未保存，可重试。")
        }
    }

    private func deleteHighlight(_ note: BookNote) {
        do {
            try library.removeNote(note.id, bookID: book.id)
            selectionFeedback.selectionChanged()
            renderNoteAnnotations()
        } catch {
            showAnnotationFailure(title: "删除失败", message: "内容未被删除，可重试。")
        }
    }

    func gestureRecognizer(
        _ gestureRecognizer: UIGestureRecognizer,
        shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer
    ) -> Bool { true }

    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
        if gestureRecognizer === pageTapGesture {
            // 记录触点落下瞬间是否有选区/浮层：用于“单击空白先清选区、不切沉浸”的判断。
            selectionAtTouchStart = pdfView.currentSelection != nil || activeSelection != nil || selectionMenu != nil
        }
        return true
    }

    // MARK: - 操作

    /// 阅读器「?」：与导入提示卡共用同一段说明；只有扫描页 PDF 显示入口。
    @objc private func showPDFHelp() {
        guard let info = book.pdfInfo, info.hasScannedPages else { return }
        let alert = BookAlertController(title: "关于这份 PDF", message: info.scannedPagesMessage, preferredStyle: .alert)
        alert.addAction(BookAlertAction(title: "知道了", style: .default))
        present(alert, animated: true)
    }

    @objc private func toggleDisplayMode() {
        let page = currentPageNumber()
        continuousScroll.toggle()
        if continuousScroll {
            pdfView.usePageViewController(false, withViewOptions: nil)
            pdfView.displayDirection = .vertical
            pdfView.displayMode = .singlePageContinuous
        } else {
            // PDFKit 要求先启用 page view controller，再设置 autoScales 才会缩放到页宽。
            pdfView.usePageViewController(true, withViewOptions: [
                UIPageViewController.OptionsKey.interPageSpacing: 16
            ])
            pdfView.displayDirection = .horizontal
            pdfView.displayMode = .singlePage
        }
        pdfView.autoScales = true
        clearActiveSelection()
        goToPage(page)
        updateModeButton()
        updatePageIndicator()
        refreshBookmarkUI(animated: false)
    }

    private func updateModeButton() {
        modeButton.configuration?.title = continuousScroll ? "连续" : "单页"
        modeButton.accessibilityLabel = continuousScroll ? "连续滚动，点按切换单页分页" : "单页分页，点按切换连续滚动"
    }

    @objc private func close() {
        clearActiveSelection()
        flushProgress()
        dismiss(animated: true)
    }
}

// MARK: - 目录 / 书签 / 搜索面板

/// 纸白面板：目录（PDFDocument outline，最多 2 层）+ 书签（按页排序、跳页、滑动删除）
/// + 搜索（页级命中，点击跳页；本轮不做页内高亮）。
@MainActor
private final class PDFContentsController: UITableViewController, UISearchBarDelegate {
    private enum Tab: Int {
        case contents, bookmarks, search
    }

    private enum SearchAvailability {
        case ready, preparing, unsearchableText, failed
    }

    private struct TOCRow {
        let title: String
        let page: Int?
        let depth: Int
    }

    private static let rowIdentifier = "pdf-contents-row"
    private static let searchDebounce = Duration.milliseconds(280)

    private let book: Book
    private let library: LibraryStore
    private let document: PDFKit.PDFDocument
    private let navigate: (Int) -> Void
    private let onChange: () -> Void
    private let tabs = UISegmentedControl(items: ["目录", "书签", "搜索"])
    private let searchHost = UIView()
    private let searchBar = UISearchBar()
    private var toc: [TOCRow] = []
    private var hits: [BookSearchHit] = []
    private var searchFailed = false
    private var searchTask: Task<Void, Never>?
    private var preparationObserver: NSObjectProtocol?
    private var lastSearchAvailability: SearchAvailability = .preparing

    init(
        book: Book,
        library: LibraryStore,
        document: PDFKit.PDFDocument,
        navigate: @escaping (Int) -> Void,
        onChange: @escaping () -> Void
    ) {
        self.book = book
        self.library = library
        self.document = document
        self.navigate = navigate
        self.onChange = onChange
        super.init(style: .insetGrouped)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    deinit {
        searchTask?.cancel()
        if let preparationObserver { NotificationCenter.default.removeObserver(preparationObserver) }
    }

    private var selectedTab: Tab { Tab(rawValue: tabs.selectedSegmentIndex) ?? .contents }
    private var isContentsTab: Bool { selectedTab == .contents }
    private var isSearchTab: Bool { selectedTab == .search }

    private var sortedBookmarks: [Bookmark] {
        let marks = library.books.first { $0.id == book.id }?.bookmarks ?? []
        return marks
            .compactMap { bookmark -> (Bookmark, Int)? in
                guard let page = PDFPageBookmarks.page(of: bookmark) else { return nil }
                return (bookmark, page)
            }
            .sorted { first, second in
                first.1 == second.1 ? first.0.excerpt < second.0.excerpt : first.1 < second.1
            }
            .map { $0.0 }
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "目录与书签"
        view.backgroundColor = BookDesign.paper
        BookDesign.formTable(tableView)
        tableView.register(UITableViewCell.self, forCellReuseIdentifier: Self.rowIdentifier)
        tableView.accessibilityIdentifier = "pdf-contents-panel"
        tableView.keyboardDismissMode = .onDrag
        tabs.selectedSegmentIndex = 0
        tabs.addTarget(self, action: #selector(tabChanged), for: .valueChanged)
        tabs.accessibilityIdentifier = "pdf-contents-tabs"
        navigationItem.titleView = tabs
        let done = UIBarButtonItem(title: "完成", style: .done, target: self, action: #selector(close))
        done.accessibilityIdentifier = "pdf-contents-done"
        navigationItem.leftBarButtonItem = done
        configureSearchBar()
        toc = Self.loadOutline(from: document)
        preparationObserver = NotificationCenter.default.addObserver(
            forName: BookPreparation.changed,
            object: library.preparation,
            queue: .main
        ) { [weak self] _ in
            Task { @MainActor in self?.preparationChanged() }
        }
        refresh()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        updateSearchHeader()
    }

    @objc private func tabChanged() {
        searchBar.resignFirstResponder()
        refresh()
    }

    @objc private func close() {
        searchTask?.cancel()
        dismiss(animated: true)
    }

    private func refresh() {
        tableView.accessibilityIdentifier = isSearchTab ? "pdf-search-results" : "pdf-contents-panel"
        updateSearchHeader()
        searchBar.searchTextField.isEnabled = searchAvailability == .ready
        lastSearchAvailability = searchAvailability
        tableView.reloadData()
        updateEmptyState()
    }

    // MARK: 搜索

    private func configureSearchBar() {
        searchBar.searchBarStyle = .minimal
        searchBar.placeholder = "搜索这本书"
        searchBar.delegate = self
        searchBar.accessibilityIdentifier = "pdf-search-bar"
        searchBar.searchTextField.accessibilityIdentifier = "pdf-search-field"
        searchBar.searchTextField.textColor = BookDesign.ink
        searchBar.tintColor = BookDesign.lampInk
        searchHost.backgroundColor = BookDesign.paper
        searchHost.addSubview(searchBar)
    }

    private func updateSearchHeader() {
        guard isSearchTab else {
            if tableView.tableHeaderView != nil { tableView.tableHeaderView = nil }
            return
        }
        let width = max(0, tableView.bounds.width)
        searchHost.frame = CGRect(x: 0, y: 0, width: width, height: 56)
        searchBar.frame = CGRect(x: 12, y: 8, width: max(0, width - 24), height: 40)
        if tableView.tableHeaderView !== searchHost { tableView.tableHeaderView = searchHost }
    }

    private func updateSearchHeaderIfNeeded() {
        guard isSearchTab, tableView.tableHeaderView === searchHost, searchHost.bounds.width != tableView.bounds.width else { return }
        updateSearchHeader()
    }

    private var trimmedQuery: String {
        (searchBar.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// 只在文字资料已经就绪时允许输入；扫描版、准备中、失败各有明确文案。
    private var searchAvailability: SearchAvailability {
        if let info = book.pdfInfo, info.textPageCount == 0 { return .unsearchableText }
        if let state = library.preparation.states[book.id] {
            if state.textIndexUnavailable || (state.searchablePageCount ?? 1) == 0 { return .unsearchableText }
            if state.failure != nil { return .failed }
            if state.preparing || state.completed < state.total { return .preparing }
            return .ready
        }
        // 没有可观察状态时也允许直接查询（例如调试夹具已单独建好索引）。
        return .ready
    }

    private var searchStatusText: String {
        switch searchAvailability {
        case .unsearchableText: return "没有可搜索的文字"
        case .preparing: return "正在准备搜索…"
        case .failed: return "搜索暂时不可用，请稍后重试"
        case .ready:
            if searchFailed { return "搜索暂时不可用，请稍后重试" }
            if trimmedQuery.isEmpty { return "输入关键词搜索这本书" }
            return hits.isEmpty ? "没有找到相关内容" : ""
        }
    }

    func searchBar(_ searchBar: UISearchBar, textDidChange searchText: String) {
        scheduleSearch()
    }

    func searchBarSearchButtonClicked(_ searchBar: UISearchBar) {
        searchBar.resignFirstResponder()
        scheduleSearch(immediate: true)
    }

    private func scheduleSearch(immediate: Bool = false) {
        searchTask?.cancel()
        guard searchAvailability == .ready else {
            hits = []
            searchFailed = false
            tableView.reloadData()
            return
        }
        guard !trimmedQuery.isEmpty else {
            hits = []
            searchFailed = false
            tableView.reloadData()
            updateEmptyState()
            return
        }
        searchFailed = false
        searchTask = Task { [weak self] in
            if !immediate { try? await Task.sleep(for: Self.searchDebounce) }
            guard !Task.isCancelled, let self else { return }
            let query = self.trimmedQuery
            do {
                let result = try await self.library.preparation.index.search(bookID: self.book.id, query: query)
                guard !Task.isCancelled else { return }
                self.hits = result
                self.searchFailed = false
            } catch is CancellationError {
                return
            } catch {
                guard !Task.isCancelled else { return }
                self.hits = []
                self.searchFailed = true
            }
            self.tableView.reloadData()
            self.updateEmptyState()
        }
    }

    private func preparationChanged() {
        let previous = lastSearchAvailability
        refresh()
        updateSearchHeaderIfNeeded()
        let current = lastSearchAvailability
        if previous != .ready, current == .ready, !trimmedQuery.isEmpty, hits.isEmpty, !searchFailed {
            scheduleSearch(immediate: true)
        }
    }

    private func showBookmarks() {
        tabs.selectedSegmentIndex = Tab.bookmarks.rawValue
        refresh()
    }

    // MARK: 目录数据

    private static func loadOutline(from document: PDFKit.PDFDocument) -> [TOCRow] {
        guard let root = document.outlineRoot else { return [] }
        var rows: [TOCRow] = []
        func append(_ outline: PDFOutline?, depth: Int) {
            guard let outline, depth <= 1, rows.count < 500 else { return }
            for index in 0..<outline.numberOfChildren {
                guard rows.count < 500, let child = outline.child(at: index) else { return }
                let page = destinationPage(of: child, in: document)
                let title = child.label?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                rows.append(TOCRow(
                    title: title.isEmpty ? (page.map { "第 \($0) 页" } ?? "未命名章节") : title,
                    page: page,
                    depth: depth
                ))
                append(child, depth: depth + 1)
            }
        }
        append(root, depth: 0)
        return rows
    }

    private static func destinationPage(of outline: PDFOutline, in document: PDFKit.PDFDocument) -> Int? {
        var destination = outline.destination
        if destination == nil, let goTo = outline.action as? PDFActionGoTo { destination = goTo.destination }
        guard let page = destination?.page else { return nil }
        let index = document.index(for: page)
        guard index >= 0, index < document.pageCount else { return nil }
        return index + 1
    }

    // MARK: 表格

    override func numberOfSections(in tableView: UITableView) -> Int { 1 }

    override func tableView(_ tableView: UITableView, numberOfRowsInSection section: Int) -> Int {
        switch selectedTab {
        case .contents:
            return max(1, toc.count)
        case .bookmarks:
            return max(1, sortedBookmarks.count)
        case .search:
            return searchStatusText.isEmpty ? hits.count : 1
        }
    }

    override func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let cell = tableView.dequeueReusableCell(withIdentifier: Self.rowIdentifier, for: indexPath)
        cell.contentConfiguration = nil
        cell.accessoryType = .none
        cell.selectionStyle = .default
        cell.accessibilityIdentifier = nil
        cell.accessibilityValue = nil
        switch selectedTab {
        case .contents:
            guard toc.indices.contains(indexPath.row) else {
                return messageCell(cell, text: "这份 PDF 没有目录")
            }
            let row = toc[indexPath.row]
            var content = UIListContentConfiguration.subtitleCell()
            content.text = row.title
            content.textProperties.font = BookType.body
            content.textProperties.color = BookDesign.ink
            content.textProperties.numberOfLines = 0
            content.directionalLayoutMargins = NSDirectionalEdgeInsets(
                top: 10,
                leading: 20 + CGFloat(min(row.depth, 1)) * 16,
                bottom: 10,
                trailing: 20
            )
            if let page = row.page {
                content.secondaryText = "第 \(page) 页"
                content.secondaryTextProperties.font = BookType.footnote
                content.secondaryTextProperties.color = BookDesign.ink3
                cell.accessoryType = .disclosureIndicator
                cell.accessibilityIdentifier = "pdf-toc-row-\(page)"
            } else {
                cell.selectionStyle = .none
                cell.accessibilityIdentifier = "pdf-toc-row-i\(indexPath.row)"
            }
            cell.contentConfiguration = content
        case .bookmarks:
            let rows = sortedBookmarks
            guard rows.indices.contains(indexPath.row) else {
                return messageCell(cell, text: "还没有书签")
            }
            let bookmark = rows[indexPath.row]
            guard let page = PDFPageBookmarks.page(of: bookmark) else {
                return messageCell(cell, text: "还没有书签")
            }
            var content = UIListContentConfiguration.subtitleCell()
            content.image = BookDesign.symbol("bookmark.fill", size: 13, weight: .medium)
            content.imageProperties.tintColor = BookDesign.lamp
            content.text = "第 \(page) 页"
            content.textProperties.font = BookType.body
            content.textProperties.color = BookDesign.ink
            content.textProperties.numberOfLines = 1
            if !bookmark.excerpt.isEmpty {
                content.secondaryText = bookmark.excerpt
                content.secondaryTextProperties.font = BookType.footnote
                content.secondaryTextProperties.color = BookDesign.ink3
                content.secondaryTextProperties.numberOfLines = 1
            }
            cell.contentConfiguration = content
            cell.accessoryType = .disclosureIndicator
            cell.accessibilityIdentifier = "pdf-bookmark-row-\(bookmark.id.uuidString)"
        case .search:
            if searchStatusText.isEmpty, hits.indices.contains(indexPath.row) {
                let hit = hits[indexPath.row]
                let page = hit.page ?? hit.locator.locations.position ?? 0
                var content = UIListContentConfiguration.subtitleCell()
                content.text = "第 \(page) 页"
                content.textProperties.font = BookType.body
                content.textProperties.color = BookDesign.ink
                content.textProperties.numberOfLines = 1
                content.secondaryText = hit.context
                content.secondaryTextProperties.font = BookType.footnote
                content.secondaryTextProperties.color = BookDesign.ink3
                content.secondaryTextProperties.numberOfLines = 2
                cell.contentConfiguration = content
                cell.accessoryType = .disclosureIndicator
                cell.accessibilityIdentifier = "pdf-search-row-\(page)-\(indexPath.row)"
            } else {
                let statusCell = messageCell(cell, text: searchStatusText)
                statusCell.accessibilityIdentifier = "pdf-search-empty"
                return statusCell
            }
        }
        return cell
    }

    private func messageCell(_ cell: UITableViewCell, text: String) -> UITableViewCell {
        var content = UIListContentConfiguration.cell()
        content.text = text
        content.textProperties.font = BookType.footnote
        content.textProperties.color = BookDesign.ink3
        content.textProperties.numberOfLines = 0
        cell.contentConfiguration = content
        cell.selectionStyle = .none
        cell.accessoryType = .none
        return cell
    }

    override func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true)
        switch selectedTab {
        case .contents:
            guard toc.indices.contains(indexPath.row), let page = toc[indexPath.row].page else { return }
            jump(to: page)
        case .bookmarks:
            let rows = sortedBookmarks
            guard rows.indices.contains(indexPath.row),
                  let page = PDFPageBookmarks.page(of: rows[indexPath.row]) else { return }
            jump(to: page)
        case .search:
            guard searchStatusText.isEmpty, hits.indices.contains(indexPath.row),
                  let page = hits[indexPath.row].page ?? hits[indexPath.row].locator.locations.position else { return }
            jump(to: page)
        }
    }

    private func jump(to page: Int) {
        searchTask?.cancel()
        let navigate = self.navigate
        dismiss(animated: true) { navigate(page) }
    }

    private func updateEmptyState() {
        if #available(iOS 17.0, *) {
            guard selectedTab != .search else {
                contentUnavailableConfiguration = nil
                return
            }
            if isContentsTab {
                guard toc.isEmpty else {
                    contentUnavailableConfiguration = nil
                    return
                }
                contentUnavailableConfiguration = BookContentUnavailable.configuration(
                    title: "这份 PDF 没有目录",
                    detail: "翻页阅读不受影响，也可以用书签记住当前页。",
                    symbol: "list.bullet",
                    actionTitle: "查看书签",
                    action: { [weak self] in self?.showBookmarks() }
                )
            } else if sortedBookmarks.isEmpty {
                contentUnavailableConfiguration = BookContentUnavailable.configuration(
                    title: "还没有书签",
                    detail: "在阅读页点书签按钮，保存当前页。",
                    symbol: "bookmark",
                    actionTitle: "关闭",
                    action: { [weak self] in self?.close() }
                )
            } else {
                contentUnavailableConfiguration = nil
            }
        }
    }

    override func tableView(
        _ tableView: UITableView,
        trailingSwipeActionsConfigurationForRowAt indexPath: IndexPath
    ) -> UISwipeActionsConfiguration? {
        guard selectedTab == .bookmarks, sortedBookmarks.indices.contains(indexPath.row) else { return nil }
        let bookmark = sortedBookmarks[indexPath.row]
        let action = UIContextualAction(style: .destructive, title: "删除") { [weak self] _, _, complete in
            guard let self else {
                complete(false)
                return
            }
            do {
                try self.library.removeBookmark(bookmark.id, for: self.book.id)
                self.onChange()
                self.refresh()
                complete(true)
            } catch {
                complete(false)
                let alert = BookAlertController(title: "书签删除失败", message: "原书签仍保留，可稍后重试。", preferredStyle: .alert)
                alert.addAction(BookAlertAction(title: "知道了", style: .default))
                self.present(alert, animated: true)
            }
        }
        let configuration = UISwipeActionsConfiguration(actions: [action])
        configuration.performsFirstActionWithFullSwipe = false
        return configuration
    }
}

// MARK: - 书签辅助

private enum PDFPageBookmarks {
    /// 从已有 Bookmark 的 locator 读取 PDF 页号；兼容只写了 href 的旧记录。
    static func page(of bookmark: Bookmark) -> Int? {
        guard let locator = try? bookmark.location(), locator.mediaType.matches(.pdf) else { return nil }
        if let position = locator.locations.position, position > 0 { return position }
        return locator.href.string.split(separator: "/").last.flatMap { Int($0) }
    }
}

// MARK: - 页面书签丝带

private final class PDFBookmarkRibbonButton: UIButton {
    override init(frame: CGRect) {
        super.init(frame: frame)
        var configuration = UIButton.Configuration.plain()
        configuration.image = BookDesign.symbol("bookmark.fill", size: 14, weight: .semibold)
        configuration.baseForegroundColor = BookDesign.lampInk
        configuration.contentInsets = .zero
        self.configuration = configuration
        backgroundColor = BookDesign.paper
        layer.cornerRadius = 7
        layer.cornerCurve = .continuous
        layer.borderWidth = 1
        layer.shadowColor = UIColor.black.cgColor
        layer.shadowOpacity = 0.08
        layer.shadowRadius = 2
        layer.shadowOffset = CGSize(width: 0, height: 1)
        accessibilityIdentifier = "pdf-bookmark-ribbon"
        accessibilityLabel = "取消本页书签"
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    override func layoutSubviews() {
        super.layoutSubviews()
        layer.borderColor = BookDesign.line.resolvedColor(with: traitCollection).cgColor
    }

    /// 视觉保持小丝带，命中区扩到 44pt。
    override func point(inside point: CGPoint, with event: UIEvent?) -> Bool {
        let dx = max(0, (44 - bounds.width) / 2)
        let dy = max(0, (44 - bounds.height) / 2)
        return bounds.insetBy(dx: -dx, dy: -dy).contains(point)
    }
}

// MARK: - PDF 选中文字浮层（高亮 / 写笔记 / 取消）

@MainActor
private final class PDFSelectionMenu: UIView {
    var onHighlight: (() -> Void)?
    var onNote: (() -> Void)?
    var onAsk: (() -> Void)?
    var onCancel: (() -> Void)?

    private let bubble = UIView()

    override init(frame: CGRect = .zero) {
        super.init(frame: frame)
        accessibilityIdentifier = "pdf-selection-menu"
        backgroundColor = .clear

        bubble.backgroundColor = BookDesign.surface
        bubble.layer.cornerRadius = 12
        bubble.layer.cornerCurve = .continuous
        bubble.layer.borderWidth = 1
        bubble.layer.shadowColor = UIColor.black.cgColor
        bubble.layer.shadowOpacity = 0.16
        bubble.layer.shadowRadius = 10
        bubble.layer.shadowOffset = CGSize(width: 0, height: 5)

        let highlight = actionButton("高亮", identifier: "pdf-selection-highlight", colour: BookDesign.ink)
        let note = actionButton("写笔记", identifier: "pdf-selection-note", colour: BookDesign.ink)
        let ask = actionButton("问 AI", identifier: "pdf-selection-ask", colour: BookDesign.lampInk)
        let cancel = actionButton("取消", identifier: "pdf-selection-cancel", colour: BookDesign.ink2)
        highlight.addTarget(self, action: #selector(highlightTapped), for: .touchUpInside)
        note.addTarget(self, action: #selector(noteTapped), for: .touchUpInside)
        ask.addTarget(self, action: #selector(askTapped), for: .touchUpInside)
        cancel.addTarget(self, action: #selector(cancelTapped), for: .touchUpInside)

        let stack = UIStackView(arrangedSubviews: [highlight, note, ask, cancel])
        stack.axis = .horizontal
        stack.distribution = .fillEqually
        stack.spacing = 0
        stack.translatesAutoresizingMaskIntoConstraints = false

        bubble.translatesAutoresizingMaskIntoConstraints = false
        addSubview(bubble)
        bubble.addSubview(stack)
        NSLayoutConstraint.activate([
            bubble.topAnchor.constraint(equalTo: topAnchor),
            bubble.leadingAnchor.constraint(equalTo: leadingAnchor),
            bubble.trailingAnchor.constraint(equalTo: trailingAnchor),
            bubble.bottomAnchor.constraint(equalTo: bottomAnchor),
            stack.topAnchor.constraint(equalTo: bubble.topAnchor, constant: 2),
            stack.leadingAnchor.constraint(equalTo: bubble.leadingAnchor, constant: 4),
            stack.trailingAnchor.constraint(equalTo: bubble.trailingAnchor, constant: -4),
            stack.bottomAnchor.constraint(equalTo: bubble.bottomAnchor, constant: -2)
        ])
        isAccessibilityElement = false
        accessibilityElements = [highlight, note, ask, cancel]
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    override func layoutSubviews() {
        super.layoutSubviews()
        bubble.layer.borderColor = BookDesign.line.resolvedColor(with: traitCollection).cgColor
    }

    /// 选区上方优先；空间不足时落到下方，并夹在工具栏与页脚之间。
    func place(belowToolbar minY: CGFloat, aboveFooter maxY: CGFloat, near selection: CGRect, in host: UIView) {
        let size = CGSize(width: min(320, host.bounds.width - 16), height: 46)
        var x = selection.midX - size.width / 2
        x = max(8, min(x, host.bounds.width - size.width - 8))
        var y = selection.minY - size.height - 8
        if y < minY + 4 { y = selection.maxY + 8 }
        y = min(y, maxY - size.height - 4)
        y = max(minY + 4, y)
        frame = CGRect(origin: CGPoint(x: x, y: y), size: size)
    }

    private func actionButton(_ title: String, identifier: String, colour: UIColor) -> UIButton {
        let button = UIButton(type: .system)
        var configuration = UIButton.Configuration.plain()
        configuration.title = title
        configuration.baseForegroundColor = colour
        configuration.contentInsets = .zero
        configuration.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { incoming in
            var outgoing = incoming
            outgoing.font = BookType.sans(13, weight: .medium, style: .subheadline)
            return outgoing
        }
        button.configuration = configuration
        button.accessibilityIdentifier = identifier
        return button
    }

    @objc private func highlightTapped() { onHighlight?() }
    @objc private func noteTapped() { onNote?() }
    @objc private func askTapped() { onAsk?() }
    @objc private func cancelTapped() { onCancel?() }
}

// MARK: - PDF 高亮调色盘（创建/改色/取消高亮）

@MainActor
private final class PDFHighlightPaletteController: UIViewController {
    var onCancel: (() -> Void)?
    private let selected: HighlightColor?
    private let titleText: String
    private let onPick: (HighlightColor) -> Void
    private let onDelete: (() -> Void)?
    private let deleteTitle: String?
    private let dim = UIView()
    private let card = UIView()

    init(
        selected: HighlightColor?,
        title: String,
        onPick: @escaping (HighlightColor) -> Void,
        onDelete: (() -> Void)?,
        deleteTitle: String?
    ) {
        self.selected = selected
        self.titleText = title
        self.onPick = onPick
        self.onDelete = onDelete
        self.deleteTitle = deleteTitle
        super.init(nibName: nil, bundle: nil)
        modalPresentationStyle = .overFullScreen
        modalTransitionStyle = .crossDissolve
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .clear
        view.accessibilityViewIsModal = true
        view.accessibilityIdentifier = "pdf-highlight-palette"

        dim.backgroundColor = UIColor.black.withAlphaComponent(0.34)
        dim.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(dim)
        dim.addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(cancelTapped)))
        NSLayoutConstraint.activate([
            dim.topAnchor.constraint(equalTo: view.topAnchor),
            dim.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            dim.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            dim.trailingAnchor.constraint(equalTo: view.trailingAnchor)
        ])

        card.backgroundColor = BookDesign.paper
        card.layer.cornerRadius = BookRadius.sheet
        card.layer.cornerCurve = .continuous
        BookElevation.floating(card)
        card.translatesAutoresizingMaskIntoConstraints = false
        card.accessibilityIdentifier = "pdf-highlight-card"
        view.addSubview(card)

        let stack = UIStackView()
        stack.axis = .vertical
        stack.spacing = 14
        stack.isLayoutMarginsRelativeArrangement = true
        stack.layoutMargins = UIEdgeInsets(top: 20, left: 20, bottom: 16, right: 20)
        stack.translatesAutoresizingMaskIntoConstraints = false
        card.addSubview(stack)

        stack.addArrangedSubview(BookDesign.label(titleText, font: BookType.serif(17, weight: .semibold, style: .headline)))

        let swatches = UIStackView()
        swatches.axis = .horizontal
        swatches.distribution = .fillEqually
        swatches.spacing = 12
        for color in HighlightColor.allCases {
            swatches.addArrangedSubview(makeSwatch(color))
        }
        stack.addArrangedSubview(swatches)

        if let onDelete, let deleteTitle {
            let delete = makeTextButton(deleteTitle, colour: BookDesign.error, identifier: "pdf-highlight-remove")
            delete.addAction(UIAction { [weak self] _ in
                guard let self else { return }
                self.finish(then: onDelete)
            }, for: .touchUpInside)
            stack.addArrangedSubview(delete)
        }
        let cancel = makeTextButton("取消", colour: BookDesign.ink2, identifier: "pdf-highlight-cancel")
        cancel.addAction(UIAction { [weak self] _ in self?.dismissPalette() }, for: .touchUpInside)
        stack.addArrangedSubview(cancel)

        NSLayoutConstraint.activate([
            card.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 8),
            card.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -8),
            card.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -8),
            stack.topAnchor.constraint(equalTo: card.topAnchor),
            stack.leadingAnchor.constraint(equalTo: card.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: card.trailingAnchor),
            stack.bottomAnchor.constraint(equalTo: card.bottomAnchor)
        ])
    }

    private func makeSwatch(_ color: HighlightColor) -> UIView {
        let button = UIButton(type: .system)
        button.backgroundColor = color.tint
        button.layer.cornerRadius = 22
        button.layer.cornerCurve = .continuous
        button.layer.borderWidth = color == selected ? 3 : 1
        button.layer.borderColor = (color == selected ? BookDesign.ink : BookDesign.line)
            .resolvedColor(with: traitCollection).cgColor
        button.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            button.widthAnchor.constraint(equalToConstant: 44),
            button.heightAnchor.constraint(equalToConstant: 44)
        ])
        button.accessibilityIdentifier = "pdf-highlight-color-" + color.rawValue
        button.accessibilityLabel = color.title + "高亮"
        button.accessibilityTraits = color == selected ? [.button, .selected] : .button
        button.addAction(UIAction { [weak self] _ in
            guard let self else { return }
            self.finish(then: { self.onPick(color) })
        }, for: .touchUpInside)

        let label = BookDesign.label(color.title, font: BookType.caption, colour: BookDesign.ink2)
        label.textAlignment = .center
        let column = UIStackView(arrangedSubviews: [button, label])
        column.axis = .vertical
        column.alignment = .center
        column.spacing = 6
        return column
    }

    private func makeTextButton(_ title: String, colour: UIColor, identifier: String) -> UIButton {
        let button = UIButton(type: .system)
        var configuration = UIButton.Configuration.plain()
        configuration.title = title
        configuration.baseForegroundColor = colour
        configuration.contentInsets = NSDirectionalEdgeInsets(top: 12, leading: 16, bottom: 12, trailing: 16)
        configuration.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { incoming in
            var outgoing = incoming
            outgoing.font = BookType.sans(14, weight: .medium, style: .subheadline)
            return outgoing
        }
        button.configuration = configuration
        button.accessibilityIdentifier = identifier
        button.heightAnchor.constraint(greaterThanOrEqualToConstant: 44).isActive = true
        return button
    }

    @objc private func cancelTapped() { dismissPalette() }

    private func dismissPalette() { finish(then: onCancel ?? {}) }

    private func finish(then action: @escaping () -> Void) {
        let animate = !UIAccessibility.isReduceMotionEnabled
        UIView.animate(withDuration: animate ? 0.16 : 0, animations: {
            self.dim.alpha = 0
            self.card.alpha = 0
        }) { _ in
            self.dismiss(animated: false) { action() }
        }
    }
}

// MARK: - PDF 文档异步打开

/// 在 PDFKit 串行队列创建 PDFDocument（大幅 PDF 解析可能慢），完成后回主线程挂到 PDFView。
/// PDFKit 线程约定：串行队列是唯一接触该 document 的后台线程；创建后不再在队列里访问它。
private enum PDFReaderDocumentLoader {
    static func open(url: URL) async throws -> PDFKit.PDFDocument {
        try await withCheckedThrowingContinuation { continuation in
            PDFKitWorkQueue.queue.async {
                autoreleasepool {
                    guard let document = PDFKit.PDFDocument(url: url) else {
                        continuation.resume(throwing: LibraryError.invalid)
                        return
                    }
                    guard !document.isLocked else {
                        continuation.resume(throwing: LibraryError.unsupported)
                        return
                    }
                    guard document.pageCount > 0 else {
                        continuation.resume(throwing: LibraryError.invalid)
                        return
                    }
                    continuation.resume(returning: document)
                }
            }
        }
    }
}
