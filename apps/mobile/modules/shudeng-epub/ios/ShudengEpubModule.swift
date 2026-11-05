import ExpoModulesCore
import UIKit
import WebKit

/// WebKit and UIKit are presentation ports. TypeScript owns books, pagination,
/// locators, annotations and the prepare/commit transaction.
public final class ShudengEpubModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ShudengEpub")
    AsyncFunction("openEpubArchive") { (uri: String) async throws -> [String: Any] in
      try await EpubResourceStore.shared.open(uri).bridgeValue
    }
    AsyncFunction("readEpubArchiveText") { (sessionID: String, resourceID: String) async throws -> String in
      try await EpubResourceStore.shared.archives.readText(sessionID: sessionID, resourceID: resourceID)
    }
    AsyncFunction("materializeEpubResource") { (sessionID: String, resourceID: String) async throws -> [String: Any] in
      try await EpubResourceStore.shared.archives.materialize(sessionID: sessionID, resourceID: resourceID).bridgeValue
    }
    AsyncFunction("releaseEpubResource") { (sessionID: String, leaseID: String) async in
      await EpubResourceStore.shared.archives.release(sessionID: sessionID, leaseID: leaseID)
    }
    AsyncFunction("closeEpubArchive") { (sessionID: String) async in
      await EpubResourceStore.shared.archives.close(sessionID)
    }
    View(ShudengEpubView.self) {
      Events("onEpubEvent")
      Prop("html", "") { (view, html: String) in view.setHTML(html) }
      Prop("archiveSessionID", "") { (view, sessionID: String) in view.setArchiveSessionID(sessionID) }
      Prop("command", "") { (view, command: String) in view.submit(command) }
      Prop("curl", false) { (view, enabled: Bool) in view.setCurl(enabled) }
      Prop("dark", false) { (view, dark: Bool) in view.setDark(dark) }
    }
    View(ShudengEpubNavigationView.self) {
      Events("onNavigationAction")
      Prop("visible", false) { (view, value: Bool) in view.setVisible(value) }
      Prop("state", "") { (view, value: String) in view.setState(value) }
      Prop("dark", false) { (view, value: Bool) in view.setDark(value) }
    }
    View(ShudengEpubSettingsView.self) {
      Events("onSettingsAction")
      Prop("visible", false) { (view, value: Bool) in view.setVisible(value) }
      Prop("value", "") { (view, value: String) in view.setValue(value) }
      Prop("saving", false) { (view, value: Bool) in view.setSaving(value) }
      Prop("dark", false) { (view, value: Bool) in view.setDark(value) }
      Prop("curlAvailable", true) { (view, value: Bool) in view.setCurlAvailable(value) }
    }
    View(ShudengEpubChromeView.self) {
      Events("onChromeAction")
      Prop("title", "") { (view, value: String) in view.setTitle(value) }
      Prop("chapter", "") { (view, value: String) in view.setChapter(value) }
      Prop("progress", "") { (view, value: String) in view.setProgress(value) }
      Prop("referenceMode", false) { (view, value: Bool) in view.setReferenceMode(value) }
      Prop("bookmarked", false) { (view, value: Bool) in view.setBookmarked(value) }
      Prop("chromeVisible", true) { (view, value: Bool) in view.setChromeVisible(value) }
      Prop("controlsEnabled", true) { (view, value: Bool) in view.setControlsEnabled(value) }
      Prop("dark", false) { (view, value: Bool) in view.setDark(value) }
    }
  }
}

final class ShudengEpubView: ExpoView {
  let onEpubEvent = EventDispatcher()
  private let host = EpubPresentationController()
  private var attached = false

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    host.emit = { [weak self] json in self?.onEpubEvent(["message": json]) }
    addSubview(host.view)
    host.view.frame = bounds
    host.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window != nil, !attached {
      var responder: UIResponder? = self
      while let next = responder?.next {
        if let parent = next as? UIViewController {
          parent.addChild(host)
          host.didMove(toParent: parent)
          attached = true
          break
        }
        responder = next
      }
    }
    host.setActive(window != nil)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    host.view.frame = bounds
    host.viewportChanged(bounds.size)
  }

  func setHTML(_ html: String) { host.load(html) }
  func setArchiveSessionID(_ sessionID: String) { host.activateArchive(sessionID) }
  func submit(_ command: String) { host.submit(command) }
  func setCurl(_ enabled: Bool) { host.setCurl(enabled) }
  func setDark(_ dark: Bool) { host.setDark(dark) }

  deinit {
    let closingHost = host
    Task { @MainActor in
      closingHost.dispose()
      closingHost.willMove(toParent: nil)
      closingHost.view.removeFromSuperview()
      closingHost.removeFromParent()
    }
  }
}

private struct EpubPage {
  let metadata: [String: Any]
  let image: UIImage
  var key: String { metadata["key"] as? String ?? "" }
  var signature: String { metadata["signature"] as? String ?? "" }
}

private final class EpubCurlPage: UIViewController {
  let page: EpubPage
  init(_ page: EpubPage) {
    self.page = page
    super.init(nibName: nil, bundle: nil)
    let image = UIImageView(image: page.image)
    image.contentMode = .scaleToFill
    image.isUserInteractionEnabled = true
    view = image
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }
}

/// WKUserContentController retains handlers; the proxy keeps view teardown finite.
private final class EpubScriptHandler: NSObject, WKScriptMessageHandler {
  weak var owner: EpubPresentationController?
  func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
    guard message.frameInfo.isMainFrame,
      let url = message.frameInfo.request.url,
      url.scheme == EpubResourceScheme.scheme, url.host == "reader", url.path == "/index.html" else { return }
    owner?.receive(message.body)
  }
}

@MainActor
private final class EpubPresentationController: UIViewController, WKNavigationDelegate,
  UIPageViewControllerDataSource, UIPageViewControllerDelegate {
  var emit: ((String) -> Void)?
  private let handler = EpubScriptHandler()
  private let resourceScheme = EpubResourceScheme(archives: EpubResourceStore.shared.archives)
  private lazy var web: WKWebView = {
    let configuration = WKWebViewConfiguration()
    configuration.setURLSchemeHandler(resourceScheme, forURLScheme: EpubResourceScheme.scheme)
    configuration.defaultWebpagePreferences.allowsContentJavaScript = true
    configuration.userContentController.add(handler, name: "shudengEpub")
    let bridge = """
      window.ReactNativeWebView={postMessage:function(message){window.webkit.messageHandlers.shudengEpub.postMessage(message);}};
      """
    configuration.userContentController.addUserScript(WKUserScript(source: bridge, injectionTime: .atDocumentStart, forMainFrameOnly: true))
    let chrome = """
      var style=document.createElement('style');style.textContent='#chrome,#footer{display:none!important}#app{padding:0!important;height:100%!important}#reader{height:100vh!important}';document.head.appendChild(style);
      """
    configuration.userContentController.addUserScript(WKUserScript(source: chrome, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
    let web = WKWebView(frame: .zero, configuration: configuration)
    web.navigationDelegate = self
    web.isOpaque = false
    web.scrollView.isScrollEnabled = false
    web.scrollView.bounces = false
    web.scrollView.contentInsetAdjustmentBehavior = .never
    web.allowsBackForwardNavigationGestures = false
    if #available(iOS 16.4, *) { web.isInspectable = true }
    return web
  }()
  private lazy var pager: UIPageViewController = {
    let pager = UIPageViewController(transitionStyle: .pageCurl, navigationOrientation: .horizontal,
      options: [.spineLocation: UIPageViewController.SpineLocation.min.rawValue])
    pager.isDoubleSided = false
    pager.dataSource = self
    pager.delegate = self
    return pager
  }()
  private var source = ""
  private var pending: [[String: Any]] = []
  private var navigationReceipts: [[String: Any]] = []
  private var lastCommand = 0
  private var loaded = false
  private var ready = false
  private var active = true
  private var disposed = false
  private var wantsCurl = false
  private var usingCurl = false
  private var selecting = false
  private var working = false
  private var transitioning = false
  private var dirty = true
  private var viewport = CGSize.zero
  private var revision = 0
  private var current: EpubCurlPage?
  private var previous: EpubCurlPage?
  private var following: EpubCurlPage?
  private var pendingTurn: EpubPage?
  private var cache: [String: EpubPage] = [:]
  private var cacheOrder: [String] = []
  private var cover: UIImageView?
  private var observer: NSObjectProtocol?

  override func viewDidLoad() {
    super.viewDidLoad()
    handler.owner = self
    view.clipsToBounds = true
    view.backgroundColor = UIColor(red: 250/255, green: 247/255, blue: 241/255, alpha: 1)
    attachWeb(to: view)
    observer = NotificationCenter.default.addObserver(forName: UIAccessibility.reduceMotionStatusDidChangeNotification,
      object: nil, queue: .main) { [weak self] _ in Task { @MainActor in self?.invalidate() } }
  }

  deinit {
    if let observer { NotificationCenter.default.removeObserver(observer) }
  }

  func load(_ html: String) {
    guard !html.isEmpty, html != source else { return }
    source = html
    loaded = false
    ready = false
    clearCache()
    resourceScheme.setReaderHTML(html)
    web.load(URLRequest(url: resourceScheme.pageURL))
  }

  func activateArchive(_ sessionID: String) {
    guard !disposed, !sessionID.isEmpty else { return }
    resourceScheme.activate(sessionID)
  }

  /// Detaching while another screen covers the reader keeps its publication alive.
  /// Actual view disposal revokes Foliate URLs before cancelling/joining native I/O.
  func dispose() {
    guard !disposed else { return }
    disposed = true
    active = false
    ready = false
    loaded = false
    pending.removeAll()
    clearCache()
    web.stopLoading()
    let closingWeb = web
    let closingScheme = resourceScheme
    Task { @MainActor in
      _ = try? await closingWeb.evaluateJavaScript("window.__readerClose && window.__readerClose();true;")
      await closingScheme.close()
      closingWeb.configuration.userContentController.removeScriptMessageHandler(forName: "shudengEpub")
    }
  }

  func setActive(_ value: Bool) {
    active = value
    if value { schedule() }
  }

  func setCurl(_ value: Bool) {
    guard wantsCurl != value else { return }
    wantsCurl = value
    invalidate()
  }

  func setDark(_ dark: Bool) {
    let paper = dark ? UIColor(red: 27/255, green: 26/255, blue: 23/255, alpha: 1)
      : UIColor(red: 250/255, green: 247/255, blue: 241/255, alpha: 1)
    view.backgroundColor = paper
    web.backgroundColor = paper
    if pager.parent != nil { pager.view.backgroundColor = paper }
  }

  func viewportChanged(_ size: CGSize) {
    guard size.width > 0, size.height > 0, size != viewport else { return }
    viewport = size
    invalidate()
  }

  private func clearCache() {
    revision += 1
    cache.removeAll()
    cacheOrder.removeAll()
    dirty = true
  }

  private func invalidate() {
    clearCache()
    schedule()
  }

  func submit(_ raw: String) {
    guard !raw.isEmpty, let data = raw.data(using: .utf8),
      let envelopes = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else { return }
    for envelope in envelopes {
      guard let id = envelope["id"] as? Int, id > lastCommand,
        let message = envelope["message"] as? [String: Any] else { continue }
      lastCommand = id
      pending.append(message)
    }
    emitJSON(["type": "native:ack", "payload": ["id": lastCommand]])
    schedule()
  }

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    // A module script may execute after didFinish. Its explicit handshake is
    // authoritative; this probe also handles an already-completed handshake.
    Task { [weak self] in
      guard let self else { return }
      do {
        let available = try await webView.evaluateJavaScript("typeof window.__readerHost === 'function' && typeof window.__readerNative === 'object'")
        if available as? Bool == true { self.hostReady() }
      } catch { self.failure(error) }
    }
  }

  private func hostReady() {
    guard !loaded else { return }
    loaded = true
    emitJSON(["type": "native:loaded"])
    schedule()
  }

  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { failure(error) }
  func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
    guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
    if navigationAction.targetFrame?.isMainFrame == true {
      decisionHandler(url == resourceScheme.pageURL ? .allow : .cancel)
    } else {
      decisionHandler(url.scheme == "blob" || url.absoluteString == "about:blank" ? .allow : .cancel)
    }
  }
  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { failure(error) }
  func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
    ready = false
    clearCache()
    emitJSON(["type": "reader:error", "payload": ["message": "阅读器已被系统回收，请重试打开书籍。"]])
  }

  func receive(_ body: Any) {
    guard let json = body as? String, let data = json.data(using: .utf8),
      let event = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let type = event["type"] as? String else { return }
    switch type {
    case "reader:hostReady": hostReady(); return
    case "reader:ready": ready = true; dirty = true; schedule()
    case "reader:selection": selecting = true; setGesturesEnabled(false)
    case "reader:selectionCleared": selecting = false; setGesturesEnabled(true); schedule()
    case "reader:turnRequested":
      let direction = (event["payload"] as? [String: Any])?["direction"] as? Int ?? 1
      turn(direction)
      return
    default: break
    }
    emit?(json)
  }

  private func emitJSON(_ value: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: value), let json = String(data: data, encoding: .utf8) else { return }
    emit?(json)
  }

  private func failure(_ error: Error) {
    emitJSON(["type": "reader:error", "payload": ["message": error.localizedDescription]])
  }

  private func attachWeb(to container: UIView) {
    web.removeFromSuperview()
    web.frame = container.bounds
    web.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    container.addSubview(web)
    container.layoutIfNeeded()
  }

  private func installPager() {
    guard pager.parent == nil else { return }
    addChild(pager)
    pager.view.frame = view.bounds
    pager.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    view.addSubview(pager.view)
    pager.didMove(toParent: self)
    pager.gestureRecognizers.compactMap { $0 as? UITapGestureRecognizer }.forEach { $0.isEnabled = false }
  }

  private func removePager() {
    attachWeb(to: view)
    if pager.parent != nil {
      pager.willMove(toParent: nil)
      pager.view.removeFromSuperview()
      pager.removeFromParent()
    }
    current = nil; previous = nil; following = nil
    usingCurl = false
    cover?.removeFromSuperview(); cover = nil
  }

  private func setGesturesEnabled(_ enabled: Bool) {
    guard pager.parent != nil else { return }
    for gesture in pager.gestureRecognizers where !(gesture is UITapGestureRecognizer) {
      gesture.isEnabled = enabled && !working && !selecting
    }
  }

  private func jsonString(_ value: Any) throws -> String {
    String(decoding: try JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed]), as: UTF8.self)
  }

  private func native(_ method: String, _ arguments: [String: Any] = [:]) async throws -> Any? {
    let expression: String
    switch method {
    case "setCurl": expression = "return await window.__readerNative.setCurl(enabled)"
    case "step": expression = "return await window.__readerNative.step(direction)"
    case "restore": expression = "return await window.__readerNative.restore(page)"
    case "finish": expression = "return await window.__readerNative.finish(commit)"
    case "abort": expression = arguments["page"] == nil
      ? "return await window.__readerNative.abort()"
      : "return await window.__readerNative.abort(page)"
    case "navigate": expression = "return await window.__readerNative.navigate(command)"
    default: expression = "return await window.__readerNative.\(method)()"
    }
    do {
      return try await web.callAsyncJavaScript(expression, arguments: arguments, in: nil, contentWorld: .page)
    } catch {
      let native = error as NSError
      let detail = native.userInfo["WKJavaScriptExceptionMessage"] as? String ?? native.localizedDescription
      throw NSError(domain: "ShudengEpub", code: 3,
        userInfo: [NSLocalizedDescriptionKey: method + "：" + detail, NSUnderlyingErrorKey: native])
    }
  }

  private func descriptor(_ value: Any?) throws -> [String: Any] {
    guard let page = value as? [String: Any], page["key"] is String, page["cfi"] is String else {
      throw NSError(domain: "ShudengEpub", code: 1, userInfo: [NSLocalizedDescriptionKey: "没有可确认的卷页位置"])
    }
    return page
  }

  private func capture(_ metadata: [String: Any]) async throws -> EpubPage {
    let key = metadata["key"] as? String ?? ""
    if let cached = cache[key], cached.signature == metadata["signature"] as? String { return EpubPage(metadata: metadata, image: cached.image) }
    let configuration = WKSnapshotConfiguration()
    configuration.rect = web.bounds
    configuration.afterScreenUpdates = true
    let image = try await web.takeSnapshot(configuration: configuration)
    let page = EpubPage(metadata: metadata, image: image)
    cache[key] = page
    cacheOrder.removeAll { $0 == key }; cacheOrder.append(key)
    while cacheOrder.count > 8 { cache.removeValue(forKey: cacheOrder.removeFirst()) }
    return page
  }

  private func showCover(_ image: UIImage) {
    cover?.removeFromSuperview()
    let imageView = UIImageView(image: image)
    imageView.contentMode = .scaleToFill
    imageView.frame = view.bounds
    imageView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    view.addSubview(imageView)
    cover = imageView
  }

  private func schedule() {
    guard active, loaded, !working, !transitioning else { return }
    working = true
    setGesturesEnabled(false)
    Task { [weak self] in await self?.drain() }
  }

  private func drain() async {
    let completedTarget = pendingTurn
    var inFlightNavigation: String?
    defer {
      working = false
      setGesturesEnabled(true)
      if !dirty, !transitioning, active, pending.isEmpty, pendingTurn == nil {
        let completed = navigationReceipts
        navigationReceipts.removeAll()
        for receipt in completed { emitJSON(["type": "reader:navigated", "payload": receipt]) }
      }
      if !pending.isEmpty || pendingTurn != nil || (dirty && ready && active && !selecting) { schedule() }
    }
    do {
      if let target = pendingTurn {
        pendingTurn = nil
        _ = try await native("begin")
        _ = try await native("restore", ["page": target.metadata])
        _ = try await native("finish", ["commit": true])
        dirty = true
      }
      while !pending.isEmpty {
        let message = pending.removeFirst()
        let type = message["type"] as? String ?? ""
        if ["reader:open", "reader:theme", "reader:fontSize", "reader:flow", "reader:goTo", "reader:navigate", "reader:annotation:add", "reader:annotation:remove"].contains(type) {
          clearCache()
          // Keep the displayed page in place while the live document repaginates.
          if let current, cover == nil { showCover(current.page.image) }
        }
        if type == "reader:navigate", let command = message["payload"] as? [String: Any], let operationID = command["operationId"] as? String {
          inFlightNavigation = operationID
          guard let receipt = try await native("navigate", ["command": command]) as? [String: Any] else {
            throw NSError(domain: "ShudengEpub", code: 4, userInfo: [NSLocalizedDescriptionKey: "引用位置未能确认"])
          }
          navigationReceipts.append(receipt)
          inFlightNavigation = nil
          continue
        }
        let script = "window.__readerHost(\(try jsonString(message))); true;"
        _ = try await web.evaluateJavaScript(script)
      }
      guard ready else { return }
      if wantsCurl && !UIAccessibility.isReduceMotionEnabled {
        _ = try await native("setCurl", ["enabled": true])
        if dirty && !selecting { try await prepare() }
      } else {
        _ = try await native("setCurl", ["enabled": false])
        removePager()
        dirty = false
      }
    } catch {
      if let operationID = inFlightNavigation { navigationReceipts.append(["operationId": operationID, "status": "failed"]) }
      navigationReceipts = navigationReceipts.map { receipt in
        ["operationId": receipt["operationId"] ?? "", "status": "failed", "message": error.localizedDescription]
      }
      pendingTurn = nil
      _ = try? await native("abort", completedTarget.map { ["page": $0.metadata] } ?? [:])
      removePager()
      dirty = false
      failure(NSError(domain: "ShudengEpub", code: 2, userInfo: [NSLocalizedDescriptionKey: "仿真翻页未能准备完成：\(error.localizedDescription)"]))
    }
    // Events arriving during a transaction stay queued until its original page is restored.
  }

  private func prepare() async throws {
    let token = revision
    let original = try descriptor(await native("begin"))
    let page = try await capture(original)
    showCover(page.image)
    attachWeb(to: view)
    view.sendSubviewToBack(web)
    var nextPage: EpubPage?
    var previousPage: EpubPage?
    if original["canNext"] as? Bool == true, let next = try await native("step", ["direction": 1]) as? [String: Any] {
      nextPage = try await capture(next)
      _ = try await native("restore", ["page": original])
    }
    if original["canPrevious"] as? Bool == true, let previous = try await native("step", ["direction": -1]) as? [String: Any] {
      previousPage = try await capture(previous)
      _ = try await native("restore", ["page": original])
    }
    _ = try await native("finish", ["commit": false])
    guard token == revision, active else {
      removePager()
      dirty = true
      return
    }
    let current = EpubCurlPage(page)
    self.current = current
    previous = previousPage.map(EpubCurlPage.init)
    following = nextPage.map(EpubCurlPage.init)
    installPager()
    pager.setViewControllers([current], direction: .forward, animated: false)
    pager.view.layoutIfNeeded()
    attachWeb(to: current.view)
    cover?.removeFromSuperview(); cover = nil
    usingCurl = true
    dirty = false
    pager.dataSource = nil; pager.dataSource = self
  }

  private func turn(_ direction: Int) {
    guard wantsCurl else { return }
    guard !working, !transitioning, !selecting, usingCurl else { dirty = true; schedule(); return }
    guard let target = direction < 0 ? previous : following else { return }
    transitioning = true
    attachWeb(to: view)
    view.sendSubviewToBack(web)
    pager.setViewControllers([target], direction: direction < 0 ? .reverse : .forward, animated: !UIAccessibility.isReduceMotionEnabled) { [weak self] completed in
      guard let self else { return }
      self.transitioning = false
      if completed { self.completedTurn(target) }
      else if let current = self.current { self.attachWeb(to: current.view); self.schedule() }
    }
  }

  private func completedTurn(_ target: EpubCurlPage) {
    current = target
    pendingTurn = target.page
    // The payload was produced and verified by TypeScript when this snapshot was made.
    // Publish the completed user turn before an app interruption can save the old page.
    if let progress = target.page.metadata["progress"] as? [String: Any] {
      emitJSON(["type": "reader:progress", "payload": progress])
    }
    schedule()
  }

  func pageViewController(_ pageViewController: UIPageViewController, viewControllerBefore controller: UIViewController) -> UIViewController? {
    guard !working, !selecting else { return nil }
    if controller === current { return previous }
    if controller === following { return current }
    return nil
  }
  func pageViewController(_ pageViewController: UIPageViewController, viewControllerAfter controller: UIViewController) -> UIViewController? {
    guard !working, !selecting else { return nil }
    if controller === current { return following }
    if controller === previous { return current }
    return nil
  }
  func pageViewController(_ pageViewController: UIPageViewController, willTransitionTo pendingViewControllers: [UIViewController]) {
    transitioning = true
    web.evaluateJavaScript("window.__readerHost({type:'reader:selection:clear'});true;")
    attachWeb(to: view)
    view.sendSubviewToBack(web)
  }
  func pageViewController(_ pageViewController: UIPageViewController, didFinishAnimating finished: Bool,
    previousViewControllers: [UIViewController], transitionCompleted completed: Bool) {
    transitioning = false
    if completed, let target = pager.viewControllers?.first as? EpubCurlPage { completedTurn(target) }
    else {
      if let current { attachWeb(to: current.view) }
      // Cancelled drags never issue a navigation/commit command or a progress event.
      schedule()
    }
  }
}
