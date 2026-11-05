import ExpoModulesCore
import PDFKit
import UIKit

/// All extraction uses a single background queue. The viewer owns a separate document so
/// indexing and searching never mutate the PDFKit document currently displayed on screen.
public final class ShudengPdfModule: Module {
  private let files = LocalPdfFiles()
  private let queue = DispatchQueue(label: "dev.shudeng.pdf.extraction", qos: .userInitiated)
  private let searchControl = PdfSearchControl()
  private let inspectionControl = PdfInspectionControl()

  public func definition() -> ModuleDefinition {
    Name("ShudengPdf")

    // Explicit Promise rejection preserves the PDF code; a thrown Exception is
    // otherwise wrapped by Expo as ERR_FUNCTION_CALL before reaching TypeScript.
    AsyncFunction("inspectPdf") { (uri: String, requestID: String?, promise: Promise) in
      let cancellation = requestID.flatMap { self.inspectionControl.request($0) }
      defer { if let requestID { self.inspectionControl.finish(requestID) } }
      do {
        if requestID != nil && cancellation == nil { throw PdfInspectionCancelledException() }
        promise.resolve(try self.files.inspect(uri, cancellation: cancellation))
      }
      catch { promise.reject(error) }
    }.runOnQueue(queue)

    // Register before enqueueing work, so even cancellation before queue entry
    // belongs to this request. Neither function waits on the extraction queue.
    Function("beginPdfInspection") { () -> String in self.inspectionControl.begin() }
    Function("cancelPdfInspection") { (requestID: String) in self.inspectionControl.cancel(requestID) }

    AsyncFunction("readPdfPageText") { (uri: String, page: Int) -> String in
      let document = try self.files.open(uri)
      guard page > 0, page <= document.pageCount else {
        throw pdfError("PDF 页码超出范围")
      }
      return document.page(at: page - 1)?.string ?? ""
    }.runOnQueue(queue)

    AsyncFunction("releasePdf") { (uri: String) in
      self.files.release(uri)
    }.runOnQueue(queue)

    AsyncFunction("renderPdfThumbnail") { (uri: String, destinationURI: String) -> String in
      try self.files.renderThumbnail(uri, destinationURI: destinationURI)
    }.runOnQueue(queue)

    Function("getLegacyHighlightColor") { () -> String? in
      UserDefaults.standard.string(forKey: "reader-highlight-color")
    }

    Function("cancelPdfSearch") { () -> Int in self.searchControl.cancel() }

    // PDFKit/NSString owns matching and selection coordinates. TS supplies the
    // original-text bounds and owns snippet policy; no index or business state here.
    AsyncFunction("searchPdfPage") { (uri: String, query: String, token: Int, pageNumber: Int, bounds: [Int]) -> [String: Any] in
      let cancelled: [String: Any] = ["pageCount": 0, "cancelled": true, "matches": []]
      guard self.searchControl.isCurrent(token) else { return cancelled }
      let text = query.trimmingCharacters(in: .whitespacesAndNewlines)
      let document = try self.files.open(uri)
      guard document.pageCount > 0 else { return ["pageCount": 0, "cancelled": false, "matches": []] }
      guard pageNumber > 0, pageNumber <= document.pageCount, let page = document.page(at: pageNumber - 1) else {
        throw pdfError("PDF 页码超出范围")
      }
      let source = (page.string ?? "") as NSString
      guard bounds.count.isMultiple(of: 2) else { throw pdfError("PDF 搜索范围无效") }
      var ranges: [NSRange] = []
      if bounds.isEmpty { ranges = [NSRange(location: 0, length: source.length)] }
      else {
        var previousEnd = 0
        for index in stride(from: 0, to: bounds.count, by: 2) {
          let start = bounds[index], length = bounds[index + 1]
          guard start >= previousEnd, length > 0, start <= source.length, length <= source.length - start else {
            throw pdfError("PDF 搜索范围无效")
          }
          ranges.append(NSRange(location: start, length: length))
          previousEnd = start + length
        }
      }
      var matches: [[String: Any]] = []
      for range in ranges where !text.isEmpty {
        var remaining = range
        while remaining.length > 0 {
          guard self.searchControl.isCurrent(token) else { return cancelled }
          let range = source.range(of: text, options: [.caseInsensitive, .diacriticInsensitive], range: remaining)
          if range.location == NSNotFound || range.length == 0 { break }
          let selection = bounds.isEmpty ? nil : page.selection(for: range)
          matches.append(["offset": range.location, "length": range.length,
                          "rects": selection.map { normalizedRects($0, page: page) } ?? []])
          if bounds.isEmpty { break } // Presence probe; exact bounded pass returns every occurrence.
          let next = NSMaxRange(range)
          remaining = NSRange(location: next, length: NSMaxRange(remaining) - next)
        }
      }
      return ["pageCount": document.pageCount, "cancelled": false, "matches": matches]
    }.runOnQueue(queue)

    View(ShudengPdfView.self) {
      Events("onPdfEvent")
      Prop("uri") { (view, uri: String) in view.open(uri) }
      Prop("page", 1) { (view, page: Int) in view.setPage(page) }
      Prop("mode", "auto") { (view, mode: String) in view.setMode(mode) }
      Prop("dark", false) { (view, dark: Bool) in view.setDark(dark) }
      Prop("annotations", "[]") { (view, json: String) in view.setAnnotations(json) }
      Prop("command", "") { (view, json: String) in view.handleCommand(json) }
    }

    View(ShudengPdfSheetConfigurationView.self) {
      Prop("dark", false) { (view, dark: Bool) in view.setDark(dark) }
      Prop("grabber", false) { (view, grabber: Bool) in view.setGrabber(grabber) }
    }

    View(ShudengPdfChromeView.self) {
      Events("onChromeAction")
      Prop("title", "") { (view, value: String) in view.setTitle(value) }
      Prop("pagePosition", [1, 0]) { (view, value: [Int]) in
        if value.count == 2 { view.setPage(value[0], total: value[1]) }
      }
      Prop("bookmarked", false) { (view, value: Bool) in view.setBookmarked(value) }
      Prop("hasScannedPages", false) { (view, value: Bool) in view.setHasScannedPages(value) }
      Prop("referenceMode", false) { (view, value: Bool) in view.setReferenceMode(value) }
      Prop("dark", false) { (view, value: Bool) in view.setDark(value) }
      Prop("chromeVisible", true) { (view, value: Bool) in view.setChromeVisible(value) }
    }

    View(ShudengPdfPanelView.self) {
      Events("onPanelAction")
      Prop("state", "") { (view, value: String) in view.setState(value) }
      Prop("dark", false) { (view, value: Bool) in view.setDark(value) }
    }
  }
}

/// The synchronous cancellation signal must not wait behind a queued full-document search.
private final class PdfSearchControl {
  private let lock = NSLock()
  private var generation = 0

  func cancel() -> Int {
    lock.lock()
    defer { lock.unlock() }
    generation += 1
    return generation
  }

  func isCurrent(_ token: Int) -> Bool {
    lock.lock()
    defer { lock.unlock() }
    return generation == token
  }
}

/// A token only guards cancellation and the tiny final cache publication;
/// PDFKit work never runs while its lock is held.
private final class PdfInspectionCancellation {
  private let lock = NSLock()
  private var cancelled = false
  private var completed = false

  var isCancelled: Bool {
    lock.lock()
    defer { lock.unlock() }
    return cancelled
  }

  func cancel() {
    lock.lock()
    defer { lock.unlock() }
    if !completed { cancelled = true }
  }

  func check() throws {
    if isCancelled { throw PdfInspectionCancelledException() }
  }

  func complete<T>(_ publish: () -> T) throws -> T {
    lock.lock()
    defer { lock.unlock() }
    guard !cancelled else { throw PdfInspectionCancelledException() }
    let result = publish()
    completed = true
    return result
  }
}

private final class PdfInspectionControl {
  private let lock = NSLock()
  private var requests: [String: PdfInspectionCancellation] = [:]

  func begin() -> String {
    lock.lock()
    defer { lock.unlock() }
    let requestID = UUID().uuidString
    requests[requestID] = PdfInspectionCancellation()
    return requestID
  }

  func request(_ requestID: String) -> PdfInspectionCancellation? {
    lock.lock()
    defer { lock.unlock() }
    return requests[requestID]
  }

  func cancel(_ requestID: String) {
    lock.lock()
    defer { lock.unlock() }
    requests.removeValue(forKey: requestID)?.cancel()
  }

  func finish(_ requestID: String) {
    lock.lock()
    defer { lock.unlock() }
    requests.removeValue(forKey: requestID)
  }
}

private final class PdfInspectionCancelledException: Exception {
  override var code: String { "ERR_SHUDENG_PDF_INSPECTION_CANCELLED" }
  override var reason: String { "PDF 检查已取消" }
}

private final class PdfPasswordRequiredException: Exception {
  override var code: String { "ERR_SHUDENG_PDF_PASSWORD_REQUIRED" }
  override var reason: String { "此 PDF 已加密，请先解锁后再导入" }
}

private final class PdfInvalidDocumentException: Exception {
  override var code: String { "ERR_SHUDENG_PDF_INVALID_DOCUMENT" }
  override var reason: String { "PDF 已损坏或无法读取" }
}

private func pdfError(_ message: String) -> NSError {
  NSError(domain: "ShudengPdf", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
}

private func localPdfURL(_ uri: String) throws -> URL {
  guard let url = URL(string: uri), url.isFileURL,
        FileManager.default.fileExists(atPath: url.path) else {
    throw pdfError("PDF 文件不存在或无法读取")
  }
  return url
}

private final class LocalPdfFiles {
  private var cachedURI: String?
  private var cachedDocument: PDFDocument?
  private var inspection: [String: Any]?

  func open(_ uri: String) throws -> PDFDocument {
    if cachedURI == uri, let document = cachedDocument { return document }
    let url = try localPdfURL(uri)
    guard let document = PDFDocument(url: url) else { throw PdfInvalidDocumentException() }
    guard !document.isLocked else { throw PdfPasswordRequiredException() }
    guard document.pageCount > 0 else { throw PdfInvalidDocumentException() }
    cachedURI = uri
    cachedDocument = document
    inspection = nil
    return document
  }

  func inspect(_ uri: String, cancellation: PdfInspectionCancellation? = nil) throws -> [String: Any] {
    try cancellation?.check()
    let document = try open(uri)
    try cancellation?.check()
    if let inspection {
      if let cancellation { return try cancellation.complete { inspection } }
      return inspection
    }
    var textPageCount = 0
    var noTextPages: [Int] = []
    for index in 0..<document.pageCount {
      try cancellation?.check()
      autoreleasepool {
        if let text = document.page(at: index)?.string,
           !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { textPageCount += 1 }
        else { noTextPages.append(index) }
      }
      try cancellation?.check()
    }
    var blankPageCount = 0
    // Match the original reader's bounded sampling: a whole scan skips rendering;
    // mixed documents inspect at most 40 no-text pages, prioritising the last ten.
    if textPageCount > 0 {
      var sampled = Set(noTextPages.suffix(10))
      if noTextPages.count <= 40 { sampled = Set(noTextPages) }
      else {
        let remaining = noTextPages.count - 10
        let step = max(1, remaining / 30)
        for cursor in stride(from: 0, to: remaining, by: step).prefix(30) { sampled.insert(noTextPages[cursor]) }
      }
      for index in sampled {
        try cancellation?.check()
        autoreleasepool {
          if let page = document.page(at: index), !pdfPageHasInk(page) { blankPageCount += 1 }
        }
        try cancellation?.check()
      }
    }
    try cancellation?.check()
    let outline = outlineItems(document, shouldContinue: { cancellation?.isCancelled != true })
    try cancellation?.check()
    let attributes = document.documentAttributes ?? [:]
    let result: [String: Any] = [
      "pageCount": document.pageCount,
      "title": (attributes[PDFDocumentAttribute.titleAttribute] as? String) as Any? ?? NSNull(),
      "author": (attributes[PDFDocumentAttribute.authorAttribute] as? String) as Any? ?? NSNull(),
      "textPageCount": textPageCount,
      "blankPageCount": blankPageCount,
      "outline": outline
    ]
    if let cancellation { return try cancellation.complete { inspection = result; return result } }
    inspection = result
    return result
  }

  func release(_ uri: String) {
    guard cachedURI == uri else { return }
    cachedURI = nil
    cachedDocument = nil
    inspection = nil
  }

  func renderThumbnail(_ uri: String, destinationURI: String) throws -> String {
    let source = try localPdfURL(uri)
    guard let destination = URL(string: destinationURI), destination.isFileURL,
          destination.pathExtension.lowercased() == "png",
          destination.standardizedFileURL != source.standardizedFileURL else {
      throw pdfError("PDF 封面保存位置无效")
    }
    // Use a short-lived document: shelf thumbnails must not retain a full book in the cache.
    guard let document = PDFDocument(url: source), !document.isLocked,
          let page = document.page(at: 0) else {
      throw pdfError("无法生成 PDF 封面")
    }
    return try autoreleasepool {
      let thumbnail = page.thumbnail(of: CGSize(width: 400, height: 600), for: .cropBox)
      guard thumbnail.size.width > 0, thumbnail.size.height > 0 else {
        throw pdfError("无法生成 PDF 封面")
      }
      let ratio = min(400 / thumbnail.size.width, 600 / thumbnail.size.height, 1)
      let size = CGSize(width: max(1, floor(thumbnail.size.width * ratio)),
                        height: max(1, floor(thumbnail.size.height * ratio)))
      let format = UIGraphicsImageRendererFormat()
      format.scale = 1
      format.opaque = true
      let image = UIGraphicsImageRenderer(size: size, format: format).image { context in
        UIColor.white.setFill()
        context.fill(CGRect(origin: .zero, size: size))
        thumbnail.draw(in: CGRect(origin: .zero, size: size))
      }
      guard let data = image.pngData() else { throw pdfError("无法生成 PDF 封面") }
      try FileManager.default.createDirectory(at: destination.deletingLastPathComponent(),
                                              withIntermediateDirectories: true)
      // Foundation writes beside the destination and renames only after the PNG is complete.
      try data.write(to: destination, options: .atomic)
      return destination.absoluteString
    }
  }
}

private func pdfPageHasInk(_ page: PDFPage) -> Bool {
  let thumbnail = page.thumbnail(of: CGSize(width: 32, height: 44), for: .cropBox)
  guard let image = thumbnail.cgImage, image.width > 0, image.height > 0 else { return true }
  let width = image.width, height = image.height
  var pixels = [UInt8](repeating: 0, count: width * height * 4)
  guard let context = CGContext(data: &pixels, width: width, height: height, bitsPerComponent: 8,
                                bytesPerRow: width * 4, space: CGColorSpaceCreateDeviceRGB(),
                                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return true }
  context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
  for index in stride(from: 0, to: pixels.count, by: 4) where pixels[index + 3] > 16 {
    if pixels[index] < 245 || pixels[index + 1] < 245 || pixels[index + 2] < 245 { return true }
  }
  return false
}

/// RN's nontransparent pageSheet Modal supplies the UIKit presenter. This invisible view
/// configures its system detent instead of approximating sheet geometry in JavaScript.
public final class ShudengPdfSheetConfigurationView: ExpoView {
  private var dark = false
  private var grabber = false
  private weak var configuredController: UIViewController?
  private var configuredDark: Bool?
  private var configuredGrabber: Bool?

  public override func didMoveToWindow() {
    super.didMoveToWindow()
    configureSheet()
    if window != nil { DispatchQueue.main.async { [weak self] in self?.configureSheet() } }
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    configureSheet()
  }

  func setDark(_ value: Bool) { dark = value; configureSheet() }
  func setGrabber(_ value: Bool) { grabber = value; configureSheet() }

  private func configureSheet() {
    guard window != nil else { return }
    var responder: UIResponder? = next
    while let current = responder {
      if let controller = current as? UIViewController {
        guard configuredController !== controller || configuredDark != dark || configuredGrabber != grabber else { return }
        guard let sheet = controller.sheetPresentationController else { return }
        controller.overrideUserInterfaceStyle = dark ? .dark : .light
        sheet.detents = [.large()]
        sheet.prefersGrabberVisible = grabber
        sheet.preferredCornerRadius = 22
        configuredController = controller
        configuredDark = dark
        configuredGrabber = grabber
        return
      }
      responder = current.next
    }
  }
}

private func outlineItems(_ document: PDFDocument, shouldContinue: () -> Bool = { true }) -> [[String: Any]] {
  guard shouldContinue() else { return [] }
  guard let root = document.outlineRoot else { return [] }
  var result: [[String: Any]] = []
  func append(_ node: PDFOutline, depth: Int) {
    guard shouldContinue(), depth < 32, result.count < 2000 else { return }
    if let page = node.destination?.page {
      let index = document.index(for: page)
      if index != NSNotFound {
        result.append(["title": node.label ?? "第 \(index + 1) 页", "page": index + 1, "depth": depth])
      }
    }
    for index in 0..<node.numberOfChildren {
      guard shouldContinue() else { return }
      if let child = node.child(at: index) { append(child, depth: depth + 1) }
    }
  }
  for index in 0..<root.numberOfChildren {
    guard shouldContinue() else { return result }
    if let child = root.child(at: index) { append(child, depth: 0) }
  }
  return result
}

/// Coordinates intentionally use the PDF crop box, with the PDF bottom-left origin.
/// This is the same normalized geometry stored by the original iOS application.
private func normalizedRects(_ selection: PDFSelection, page: PDFPage) -> [[String: Double]] {
  let bounds = page.bounds(for: .cropBox)
  guard bounds.width > 0, bounds.height > 0 else { return [] }
  return selection.selectionsByLine().compactMap { line in
    let rect = line.bounds(for: page).intersection(bounds)
    guard !rect.isNull, rect.width > 0, rect.height > 0 else { return nil }
    return ["x": Double((rect.minX - bounds.minX) / bounds.width),
            "y": Double((rect.minY - bounds.minY) / bounds.height),
            "width": Double(rect.width / bounds.width),
            "height": Double(rect.height / bounds.height)]
  }
}

private struct PdfRect: Decodable {
  let x: Double
  let y: Double
  let width: Double
  let height: Double

  func inPage(_ bounds: CGRect) -> CGRect? {
    guard x.isFinite, y.isFinite, width.isFinite, height.isFinite, width > 0, height > 0 else { return nil }
    let rect = CGRect(x: bounds.minX + x * bounds.width, y: bounds.minY + y * bounds.height,
                      width: width * bounds.width, height: height * bounds.height).intersection(bounds)
    return rect.isNull || rect.isEmpty ? nil : rect
  }
}

private struct PdfMark: Decodable {
  let id: String
  let kind: String
  let color: String?
  let body: String?
  let page: Int
  let rects: [PdfRect]
}

private struct PdfCommand: Decodable {
  let type: String
  let page: Int?
  let rects: [PdfRect]?
  let operationId: String?
  let citation: Bool?
}

private final class ImmersivePdfView: PDFView {
  override var safeAreaInsets: UIEdgeInsets { .zero }
  override func canPerformAction(_ action: Selector, withSender sender: Any?) -> Bool { false }
}

/// PDFKit owns selection geometry and handles; this view only presents platform actions.
private final class PdfSelectionMenu: UIView {
  private let bubble = UIView()

  init(onAction: @escaping (String) -> Void) {
    super.init(frame: .zero)
    accessibilityIdentifier = "pdf-selection-menu"
    backgroundColor = .clear
    bubble.backgroundColor = PdfAppearance.color(0xFFFFFF, 0x2A2723)
    bubble.layer.cornerRadius = 12
    bubble.layer.cornerCurve = .continuous
    bubble.layer.borderWidth = 1
    bubble.layer.shadowColor = UIColor.black.cgColor
    bubble.layer.shadowOpacity = 0.16
    bubble.layer.shadowRadius = 10
    bubble.layer.shadowOffset = CGSize(width: 0, height: 5)
    let items: [(String, String, UIColor)] = [
      ("高亮", "highlight", PdfAppearance.ink), ("写笔记", "note", PdfAppearance.ink),
      ("问 AI", "ask", PdfAppearance.lampInk), ("取消", "cancel", PdfAppearance.ink2)
    ]
    let buttons = items.map { title, action, color in
      let button = UIButton(type: .system)
      var configuration = UIButton.Configuration.plain()
      configuration.title = title
      configuration.baseForegroundColor = color
      configuration.contentInsets = .zero
      configuration.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { incoming in
        var result = incoming
        result.font = PdfAppearance.sans(13, weight: .medium, style: .subheadline)
        return result
      }
      button.configuration = configuration
      button.accessibilityIdentifier = "pdf-selection-" + action
      button.addAction(UIAction { _ in onAction(action) }, for: .touchUpInside)
      return button
    }
    let stack = UIStackView(arrangedSubviews: buttons)
    stack.axis = .horizontal
    stack.distribution = .fillEqually
    bubble.translatesAutoresizingMaskIntoConstraints = false
    stack.translatesAutoresizingMaskIntoConstraints = false
    addSubview(bubble)
    bubble.addSubview(stack)
    NSLayoutConstraint.activate([
      bubble.topAnchor.constraint(equalTo: topAnchor), bubble.bottomAnchor.constraint(equalTo: bottomAnchor),
      bubble.leadingAnchor.constraint(equalTo: leadingAnchor), bubble.trailingAnchor.constraint(equalTo: trailingAnchor),
      stack.topAnchor.constraint(equalTo: bubble.topAnchor, constant: 2),
      stack.bottomAnchor.constraint(equalTo: bubble.bottomAnchor, constant: -2),
      stack.leadingAnchor.constraint(equalTo: bubble.leadingAnchor, constant: 4),
      stack.trailingAnchor.constraint(equalTo: bubble.trailingAnchor, constant: -4)
    ])
    isAccessibilityElement = false
    accessibilityElements = buttons
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) is not supported") }

  override func layoutSubviews() {
    super.layoutSubviews()
    bubble.layer.borderColor = PdfAppearance.line.resolvedColor(with: traitCollection).cgColor
  }

  func place(near selection: CGRect, in host: UIView, minY: CGFloat, maxY: CGFloat) {
    let size = CGSize(width: min(320, host.bounds.width - 16), height: 46)
    let x = max(8, min(selection.midX - size.width / 2, host.bounds.width - size.width - 8))
    var y = selection.minY - size.height - 8
    if y < minY + 4 { y = selection.maxY + 8 }
    y = max(minY + 4, min(y, maxY - size.height - 4))
    frame = CGRect(origin: CGPoint(x: x, y: y), size: size)
  }
}

public final class ShudengPdfView: ExpoView, UIGestureRecognizerDelegate {
  let onPdfEvent = EventDispatcher()
  private let pdfView = ImmersivePdfView()
  private let openingQueue = DispatchQueue(label: "dev.shudeng.pdf.viewer", qos: .userInitiated)
  private var openCancellation: PdfViewerOpenCancellation?
  private var uri = ""
  private var generation = 0
  private var requestedPage = 1
  private var mode = "auto"
  private var dark = false
  private var marks: [PdfMark] = []
  private var rendered: [PDFAnnotation] = []
  private var lastCommand = ""
  private var lastDrag = -Double.infinity
  private var selectionWork: DispatchWorkItem?
  private var selectionMenu: PdfSelectionMenu?
  private var hadSelectionAtTouchStart = false
  private var installing = false
  private var opening = false
  private var pendingNavigation: PdfCommand?
  private var navigationCommitScheduled = false
  private var applyingNavigation = false

  public required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    pdfView.autoScales = true
    pdfView.displaysPageBreaks = false
    pdfView.pageBreakMargins = .zero
    pdfView.pageShadowsEnabled = false
    addSubview(pdfView)
    let tap = UITapGestureRecognizer(target: self, action: #selector(tapped(_:)))
    tap.cancelsTouchesInView = false
    tap.delegate = self
    pdfView.addGestureRecognizer(tap)
    let pan = UIPanGestureRecognizer(target: self, action: #selector(panned(_:)))
    pan.cancelsTouchesInView = false
    pan.delegate = self
    pdfView.addGestureRecognizer(pan)
    NotificationCenter.default.addObserver(self, selector: #selector(pageChanged), name: .PDFViewPageChanged, object: pdfView)
    NotificationCenter.default.addObserver(self, selector: #selector(selectionChanged), name: .PDFViewSelectionChanged, object: pdfView)
    setDark(false)
  }

  deinit {
    openCancellation?.cancel()
    selectionWork?.cancel()
    NotificationCenter.default.removeObserver(self)
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    pdfView.frame = bounds
    disableInsets(pdfView)
    if let selectionMenu, let selection = pdfView.currentSelection { placeSelectionMenu(selectionMenu, for: selection) }
    scheduleNavigationReceipt()
  }

  public override func didMoveToWindow() {
    super.didMoveToWindow()
    if window == nil {
      openCancellation?.cancel()
      openCancellation = nil
      failPendingNavigation("阅读视图已关闭")
      selectionWork?.cancel()
      hideSelectionMenu()
      pdfView.clearSelection()
      generation += 1
      opening = false
      pdfView.document = nil
      rendered.removeAll()
    } else if !uri.isEmpty, pdfView.document == nil {
      open(uri)
    }
  }

  func open(_ uri: String) {
    guard uri != self.uri || (pdfView.document == nil && !opening) else { return }
    openCancellation?.cancel()
    let operation = PdfViewerOpenCancellation()
    openCancellation = operation
    self.uri = uri
    selectionWork?.cancel()
    hideSelectionMenu()
    opening = true
    generation += 1
    let token = generation
    pdfView.document = nil
    rendered.removeAll()
    openingQueue.async { [weak self] in
      do {
        guard let document = try operation.runIfActive({
          let url = try localPdfURL(uri)
          guard let document = PDFDocument(url: url) else { throw pdfError("PDF 已损坏或无法读取") }
          guard !document.isLocked else { throw pdfError("此 PDF 已加密，请先解锁后再导入") }
          guard document.pageCount > 0 else { throw pdfError("PDF 没有可阅读的页面") }
          return document
        }) else { return }
        DispatchQueue.main.async { [weak self] in
          guard let self, self.generation == token, self.openCancellation === operation, !operation.isCancelled else { return }
          self.opening = false
          guard self.requestedPage > 0, self.requestedPage <= document.pageCount else {
            self.onPdfEvent(["type": "error", "message": "此位置不在当前 PDF 中"])
            return
          }
          self.installing = true
          self.pdfView.document = document
          self.applyMode()
          self.pdfView.autoScales = true
          self.setPage(self.requestedPage)
          self.renderMarks()
          self.onPdfEvent(["type": "ready", "pageCount": document.pageCount, "outline": outlineItems(document)])
          self.installing = false
          self.pageChanged()
          self.applyPendingNavigation()
        }
      } catch {
        guard !operation.isCancelled else { return }
        DispatchQueue.main.async { [weak self] in
          guard let self, self.generation == token, self.openCancellation === operation, !operation.isCancelled else { return }
          self.opening = false
          self.onPdfEvent(["type": "error", "message": error.localizedDescription])
        }
      }
    }
  }

  func setPage(_ page: Int) {
    requestedPage = page
    guard let document = pdfView.document else { return }
    guard page > 0, page <= document.pageCount, let target = document.page(at: page - 1) else {
      onPdfEvent(["type": "error", "message": "此位置不在当前 PDF 中"])
      return
    }
    if pdfView.currentPage !== target { pdfView.go(to: target) }
  }

  func setMode(_ mode: String) {
    guard self.mode != mode else { return }
    self.mode = mode
    let page = pdfView.currentPage
    let wasInstalling = installing
    installing = true
    applyMode()
    pdfView.autoScales = true
    if let page { pdfView.go(to: page) }
    clearSelection()
    installing = wasInstalling
    if !installing { pageChanged() }
  }

  private func applyMode() {
    let scroll = mode == "scrolled" || (mode == "auto" && (pdfView.document?.pageCount ?? 0) < 200)
    if scroll {
      pdfView.usePageViewController(false, withViewOptions: nil)
      pdfView.displayDirection = .vertical
      pdfView.displayMode = .singlePageContinuous
    } else {
      pdfView.usePageViewController(true, withViewOptions: [UIPageViewController.OptionsKey.interPageSpacing: 16])
      pdfView.displayDirection = .horizontal
      pdfView.displayMode = .singlePage
    }
  }

  func setDark(_ dark: Bool) {
    self.dark = dark
    // Preserve the source PDF colors, including scanned pages, exactly as the native app.
    pdfView.backgroundColor = uiColor(dark ? 0x1B1A17 : 0xFAF7F1)
    overrideUserInterfaceStyle = dark ? .dark : .light
    pdfView.tintColor = PdfAppearance.lamp
    pdfView.currentSelection?.color = highlightColor("yellow", dark: dark)
    renderMarks()
  }

  func setAnnotations(_ json: String) {
    guard let data = json.data(using: .utf8), let next = try? JSONDecoder().decode([PdfMark].self, from: data) else { return }
    marks = next
    renderMarks()
  }

  private func renderMarks() {
    guard let document = pdfView.document else { return }
    rendered.forEach { $0.page?.removeAnnotation($0) }
    rendered.removeAll(keepingCapacity: true)
    for mark in marks {
      guard mark.kind != "bookmark", mark.page > 0, mark.page <= document.pageCount, let page = document.page(at: mark.page - 1) else { continue }
      for (index, normalized) in mark.rects.enumerated() {
        guard let rect = normalized.inPage(page.bounds(for: .cropBox)) else { continue }
        let note = mark.kind == "note"
        let annotation = PDFAnnotation(bounds: rect, forType: note ? .underline : .highlight, withProperties: nil)
        annotation.color = highlightColor(mark.color, dark: dark)
        annotation.userName = "shudeng:\(mark.id)"
        annotation.contents = mark.body
        page.addAnnotation(annotation)
        rendered.append(annotation)
        if note, index == mark.rects.count - 1 {
          let icon = PDFAnnotation(bounds: noteIconRect(rect), forType: .text, withProperties: nil)
          icon.color = annotation.color
          icon.contents = mark.body
          icon.userName = annotation.userName
          page.addAnnotation(icon)
          rendered.append(icon)
        }
      }
    }
    pdfView.setNeedsDisplay()
  }

  func handleCommand(_ json: String) {
    guard json != lastCommand, let data = json.data(using: .utf8), let command = try? JSONDecoder().decode(PdfCommand.self, from: data) else { return }
    lastCommand = json
    switch command.type {
    case "clearSelection": clearSelection()
    case "goTo":
      failPendingNavigation("定位操作已被替换")
      pendingNavigation = command
      applyPendingNavigation()
    default: break
    }
  }

  private func failPendingNavigation(_ message: String) {
    if let operationId = pendingNavigation?.operationId {
      onPdfEvent(["type": "navigation", "operationId": operationId, "status": "failed", "message": message])
    }
    pendingNavigation = nil
    navigationCommitScheduled = false
  }

  private func applyPendingNavigation() {
    guard let command = pendingNavigation, let number = command.page else { return }
    requestedPage = number
    guard let document = pdfView.document else { return }
    guard number > 0, number <= document.pageCount, let target = document.page(at: number - 1) else {
      failPendingNavigation("此位置不在当前 PDF 中")
      return
    }
    applyingNavigation = true
    clearSelection()
    if pdfView.currentPage !== target { pdfView.go(to: target) }
    if let rect = command.rects?.first?.inPage(target.bounds(for: .cropBox)) { pdfView.go(to: rect, on: target) }
    pdfView.layoutIfNeeded()
    applyingNavigation = false
    if command.operationId == nil { pendingNavigation = nil }
    else { scheduleNavigationReceipt() }
  }

  /// Confirm the requested page/rectangle in the visible PDFKit viewport after its layer commit.
  /// No elapsed-time heuristic is used, and a replaced operation can never acknowledge a new one.
  private func scheduleNavigationReceipt() {
    guard !navigationCommitScheduled, !applyingNavigation, !installing, !opening, window != nil,
          bounds.width > 0, bounds.height > 0,
          let command = pendingNavigation, let operationId = command.operationId,
          let number = command.page, let document = pdfView.document,
          number > 0, number <= document.pageCount, let target = document.page(at: number - 1),
          pdfView.currentPage === target, pdfView.visiblePages.contains(where: { $0 === target }) else { return }
    if let rect = command.rects?.first?.inPage(target.bounds(for: .cropBox)),
       !pdfView.convert(rect, from: target).intersects(pdfView.bounds) { return }
    navigationCommitScheduled = true
    let token = generation
    CATransaction.begin()
    CATransaction.setCompletionBlock { [weak self] in
      guard let self, self.generation == token, self.pendingNavigation?.operationId == operationId else { return }
      self.navigationCommitScheduled = false
      guard self.window != nil, self.pdfView.currentPage === target,
            self.pdfView.visiblePages.contains(where: { $0 === target }) else { return }
      if let rect = command.rects?.first?.inPage(target.bounds(for: .cropBox)),
         !self.pdfView.convert(rect, from: target).intersects(self.pdfView.bounds) { return }
      self.pendingNavigation = nil
      self.pageChanged()
      self.onPdfEvent(["type": "navigation", "operationId": operationId, "status": "arrived"])
    }
    pdfView.setNeedsDisplay()
    pdfView.layoutIfNeeded()
    CATransaction.commit()
  }

  @objc private func pageChanged() {
    guard !installing else { return }
    guard let document = pdfView.document, let page = pdfView.currentPage else { return }
    let index = document.index(for: page)
    guard index != NSNotFound else { return }
    requestedPage = index + 1
    onPdfEvent(["type": "page", "page": index + 1, "pageCount": document.pageCount,
                "pageHasText": !(page.string?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true)])
    scheduleNavigationReceipt()
  }

  @objc private func selectionChanged() {
    selectionWork?.cancel()
    hideSelectionMenu()
    guard let selection = pdfView.currentSelection, let payload = selectionPayload(selection) else {
      onPdfEvent(["type": "selectionCleared"])
      return
    }
    selection.color = highlightColor("yellow", dark: dark)
    let work = DispatchWorkItem { [weak self] in
      guard let self, self.pdfView.currentSelection != nil else { return }
      self.dismissSystemMenu(self.pdfView)
      self.onPdfEvent(payload)
      self.showSelectionMenu(for: selection)
    }
    selectionWork = work
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.25, execute: work)
  }

  private func selectionPayload(_ selection: PDFSelection) -> [String: Any]? {
    guard let document = pdfView.document,
          let page = selection.pages.first, let text = selection.string?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty else {
      return nil
    }
    let pageIndex = document.index(for: page)
    guard pageIndex != NSNotFound else { return nil }
    // Native PDFNoteGeometry keeps the entire PDFKit quote, including internal
    // line/page breaks, while anchoring its geometry to the first selected page.
    return ["type": "selection", "page": pageIndex + 1, "text": text,
            "rects": normalizedRects(selection, page: page)]
  }

  private func showSelectionMenu(for selection: PDFSelection) {
    hideSelectionMenu()
    let menu = PdfSelectionMenu { [weak self] action in
      guard let self, let current = self.pdfView.currentSelection, var payload = self.selectionPayload(current) else { return }
      self.hideSelectionMenu()
      payload["type"] = "selectionAction"
      payload["action"] = action
      self.onPdfEvent(payload)
    }
    addSubview(menu)
    selectionMenu = menu
    placeSelectionMenu(menu, for: selection)
  }

  private func placeSelectionMenu(_ menu: PdfSelectionMenu, for selection: PDFSelection) {
    var selectionFrame: CGRect?
    for page in selection.pages {
      let bounds = selection.bounds(for: page)
      guard bounds.width > 0.1, bounds.height > 0.1 else { continue }
      let frame = convert(pdfView.convert(bounds, from: page), from: pdfView)
      selectionFrame = selectionFrame.map { $0.union(frame) } ?? frame
    }
    // Chrome is a sibling platform view. Read its actual frames so Dynamic Type,
    // rotation and safe-area changes use the same bounds as the native reader.
    func find(_ identifier: String, in view: UIView) -> UIView? {
      if view.accessibilityIdentifier == identifier { return view }
      for child in view.subviews { if let found = find(identifier, in: child) { return found } }
      return nil
    }
    guard let selectionFrame, let host = superview,
          let toolbar = find("pdf-reader-toolbar", in: host),
          let footer = find("pdf-reader-footer", in: host) else { menu.isHidden = true; return }
    menu.isHidden = false
    menu.place(near: selectionFrame, in: self, minY: convert(toolbar.bounds, from: toolbar).maxY,
               maxY: convert(footer.bounds, from: footer).minY)
  }

  private func hideSelectionMenu() {
    selectionMenu?.removeFromSuperview()
    selectionMenu = nil
  }

  private func clearSelection() {
    selectionWork?.cancel()
    hideSelectionMenu()
    pdfView.clearSelection()
    dismissSystemMenu(pdfView)
  }

  @objc private func tapped(_ gesture: UITapGestureRecognizer) {
    guard CACurrentMediaTime() - lastDrag >= 0.4 else { return }
    let point = gesture.location(in: pdfView)
    if let document = pdfView.document, let page = pdfView.page(for: point, nearest: false) {
      let index = document.index(for: page) + 1
      let location = pdfView.convert(point, to: page)
      let box = page.bounds(for: .cropBox)
      for mark in marks where mark.page == index {
        let hit = mark.rects.enumerated().contains { index, normalized in
          guard var rect = normalized.inPage(box) else { return false }
          if mark.kind == "note", index == mark.rects.count - 1 { rect = rect.union(noteIconRect(rect)) }
          return rect.insetBy(dx: -6, dy: -6).contains(location)
        }
        if hit {
          clearSelection()
          let documentView = pdfView.documentView
          documentView?.isUserInteractionEnabled = false
          DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { [weak documentView] in documentView?.isUserInteractionEnabled = true }
          onPdfEvent(["type": "annotation", "id": mark.id])
          return
        }
      }
    }
    if hadSelectionAtTouchStart || pdfView.currentSelection != nil {
      hadSelectionAtTouchStart = false
      clearSelection()
      return
    }
    onPdfEvent(["type": "tap"])
  }

  @objc private func panned(_ gesture: UIPanGestureRecognizer) {
    if gesture.state == .began || gesture.state == .changed || gesture.state == .ended { lastDrag = CACurrentMediaTime() }
  }

  public func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
    if gestureRecognizer is UITapGestureRecognizer { hadSelectionAtTouchStart = pdfView.currentSelection != nil }
    return true
  }

  public func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer) -> Bool { true }

  private func disableInsets(_ view: UIView) {
    if let scroll = view as? UIScrollView {
      scroll.contentInsetAdjustmentBehavior = .never
      scroll.automaticallyAdjustsScrollIndicatorInsets = false
    }
    view.subviews.forEach(disableInsets)
  }

  private func dismissSystemMenu(_ view: UIView) {
    for interaction in view.interactions { (interaction as? UIEditMenuInteraction)?.dismissMenu() }
    view.subviews.forEach(dismissSystemMenu)
  }
}

private func noteIconRect(_ lastLine: CGRect) -> CGRect {
  let side = max(10, min(18, lastLine.height))
  return CGRect(x: lastLine.maxX + 2, y: lastLine.minY, width: side, height: side)
}

private func uiColor(_ hex: UInt32) -> UIColor {
  UIColor(red: CGFloat((hex >> 16) & 255) / 255, green: CGFloat((hex >> 8) & 255) / 255,
          blue: CGFloat(hex & 255) / 255, alpha: 1)
}

private func highlightColor(_ name: String?, dark: Bool) -> UIColor {
  switch name?.lowercased() {
  case "green": return uiColor(dark ? 0x30402C : 0xDEE8D3)
  case "blue": return uiColor(dark ? 0x2C3A44 : 0xDCE6EC)
  case "rose", "pink": return uiColor(dark ? 0x472F2C : 0xF3DEDA)
  default: return uiColor(dark ? 0x5A4A2A : 0xF2DBA6)
  }
}
