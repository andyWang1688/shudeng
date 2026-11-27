import Foundation
import CoreGraphics
import WebKit

// Browser/UI boundary substitutes. Production queue, schedule, drain, mode and
// attach/remove bodies are inserted verbatim by the runner before execution.
struct AutoresizingMask: OptionSet {
  let rawValue: Int
  static let flexibleWidth = Self(rawValue: 1)
  static let flexibleHeight = Self(rawValue: 2)
}
@MainActor class UIView {
  weak var superview: UIView?
  var frame = CGRect(x: 0, y: 0, width: 375, height: 600)
  var bounds: CGRect { CGRect(origin: .zero, size: frame.size) }
  var autoresizingMask: AutoresizingMask = []
  var additions = 0
  var removals = 0
  var layouts = 0
  func addSubview(_ child: UIView) { additions += 1; child.superview = self }
  func removeFromSuperview() { removals += 1; superview = nil }
  func layoutIfNeeded() { layouts += 1 }
}
typealias UIImageView = UIView
struct EpubPage { var metadata: [String: Any]; var image = 0 }
@MainActor final class EpubCurlPage {
  let page: EpubPage
  let view = UIView()
  init(_ page: EpubPage) { self.page = page }
}
@MainActor final class Pager {
  var parent: UIView?
  let view = UIView()
  func willMove(toParent: UIView?) {}
  func removeFromParent() { parent = nil }
}
@MainActor enum UIAccessibility { static var isReduceMotionEnabled = false }
final class ResourceScheme {
  let pageURL = URL(string: "https://reader.invalid/index.html")!
  func setReaderHTML(_ html: String) {}
}
@MainActor final class WebView: UIView {
  var scripts: [String] = []
  var loadCount = 0
  var failNextEvaluation = false
  var onEvaluation: ((String) -> Void)?
  func evaluateJavaScript(_ script: String) async throws -> Any? {
    scripts.append(script)
    if failNextEvaluation {
      failNextEvaluation = false
      throw NSError(domain: "test-browser", code: 1)
    }
    onEvaluation?(script)
    return nil
  }
  func load(_ request: URLRequest) { loadCount += 1 }
}
@MainActor final class PresentationHost {
  let view = UIView()
  let web = WebView()
  let pager = Pager()
  let resourceScheme = ResourceScheme()
  var emitted: [[String: Any]] = []
  var nativeCalls: [(String, [String: Any])] = []
  var prepares = 0
  var engineCurl = false
  var onNative: ((String) -> Void)?
  var failures: [String] = []
  var recoveryPosition: [String: Any]?
/* PRODUCTION_STATE */

  init() {
    view.addSubview(web)
    view.additions = 0
    web.removals = 0
    loaded = true; ready = true; dirty = false
    web.onEvaluation = { [weak self] script in
      if script.contains("reader:open") { self?.engineCurl = false; self?.ready = true }
    }
  }
  func emitJSON(_ value: [String: Any]) { emitted.append(value) }
  func setGesturesEnabled(_ enabled: Bool) {}
  func failure(_ error: Error) { failures.append(error.localizedDescription) }
  func showCover(_ image: Any) { cover = UIView() }
  func native(_ method: String, _ arguments: [String: Any] = [:]) async throws -> Any? {
    nativeCalls.append((method, arguments))
    onNative?(method)
    if method == "setCurl" { engineCurl = arguments["enabled"] as? Bool ?? false }
    if method == "navigate" { return ["operationId": "nav", "status": "arrived"] }
    if method == "recoveryPosition" { return recoveryPosition }
    return nil
  }
  func prepare() async throws {
    prepares += 1
    current = EpubCurlPage(EpubPage(metadata: [:]))
    pager.parent = view
    current!.view.addSubview(web)
    usingCurl = true
    dirty = false
  }
/* PRODUCTION_METHODS */
}

struct CaseResult: Codable { let name: String; var failures: [String] = [] }
@MainActor enum TestResults { static var entries: [CaseResult] = [] }
@MainActor func check(_ value: Bool, _ detail: String) {
  if !value { TestResults.entries[TestResults.entries.count - 1].failures.append(detail) }
}
@MainActor func run(_ name: String, _ body: () async -> Void) async {
  TestResults.entries.append(CaseResult(name: name))
  await body()
}

extension PresentationHost {
  func settle(expectFailure: Bool = false) async {
    for _ in 0..<100 { await Task.yield() }
    check(!working, "native task must settle")
    check(expectFailure ? failures.count == 1 : failures.isEmpty, "unexpected native failures: \(failures)")
  }
  func resetTrace() {
    emitted.removeAll(); nativeCalls.removeAll(); web.scripts.removeAll()
    view.additions = 0; view.layouts = 0; web.removals = 0; web.loadCount = 0
  }
  var acknowledgement: Int? { (emitted.last?["payload"] as? [String: Any])?["id"] as? Int }
  var completedNavigationCount: Int { emitted.filter { $0["type"] as? String == "reader:navigated" }.count }
  func attach(to target: UIView) { attachWeb(to: target) }
  func holdUntilLoaded() { loaded = false; ready = false }
  func becameLoaded() { loaded = true; schedule() }
  func becameReady() { loaded = true; ready = true }
  func queueTurn() { pendingTurn = EpubPage(metadata: ["key": "page-a"]); schedule() }
  func completeTurn(to cfi: String) {
    completedTurn(EpubCurlPage(EpubPage(metadata: ["progress": ["locator": ["type": "epub", "cfi": cfi]]])))
  }
  func selectText() { selecting = true }
  func invalidatePresentation() { invalidate() }
  var restingInHost: Bool { web.superview === view && !usingCurl && current == nil && cover == nil }
}

@MainActor func exercisePresentation() async {
  await run("web content termination reloads in place and reports the latest reading position") {
    let host = PresentationHost()
    host.load("<html>reader</html>")
    host.resetTrace()
    host.rememberProgress([
      "type": "reader:progress",
      "payload": [
        "format": "epub",
        "fraction": 0.42,
        "locator": ["type": "epub", "cfi": "epubcfi(/6/24!/4/2/2:5)"],
        "scrollViewport": ["axis": "scrollTop", "width": 375, "height": 667, "offset": 123],
      ],
    ])
    host.rememberCitationLocation(["payload": ["cfi": "epubcfi(/6/22!/4/2,/1:0,/1:12)"]])
    host.recoverTerminatedWebContent()
    check(host.web.loadCount == 1, "terminated web content was not reloaded")
    check(host.emitted.count == 1, "recovery must emit exactly one native event")
    check(host.emitted.first?["type"] as? String == "native:restarting", "recovery did not reset the TypeScript bridge")
    let payload = host.emitted.first?["payload"] as? [String: Any]
    check(payload?["initialLocation"] as? String == "epubcfi(/6/24!/4/2/2:5)", "recovery lost the latest reading position")
    let viewport = payload?["initialScrollViewport"] as? [String: Any]
    check(viewport?["offset"] as? Int == 123, "recovery lost the screen position of the original text")
    check(payload?["initialCitationLocation"] as? String == "epubcfi(/6/22!/4/2,/1:0,/1:12)", "recovery lost the active citation range")
    check(!host.emitted.contains { $0["type"] as? String == "reader:error" }, "recovery presented a terminal reader error")
  }

  await run("recovery does not draw a citation cleared by a later navigation") {
    let host = PresentationHost()
    host.load("<html>reader</html>")
    host.rememberCitationLocation(["payload": ["cfi": "epubcfi(/6/22!/4/2,/1:0,/1:12)"]])
    host.rememberCitationLocation(["payload": ["cfi": NSNull()]])
    host.resetTrace()
    host.recoverTerminatedWebContent()
    let payload = host.emitted.first?["payload"] as? [String: Any]
    check(payload?["initialCitationLocation"] == nil, "cleared citation must not be restored")
  }

  await run("recovery uses the completed curl page before WebKit confirms the turn") {
    let host = PresentationHost()
    host.load("<html>reader</html>")
    host.rememberProgress(["payload": [
      "locator": ["type": "epub", "cfi": "epubcfi(/6/22)"],
      "scrollViewport": ["axis": "scrollTop", "width": 375, "height": 667, "offset": 123],
    ]])
    host.completeTurn(to: "epubcfi(/6/24)")
    host.resetTrace()
    host.recoverTerminatedWebContent()
    let payload = host.emitted.first?["payload"] as? [String: Any]
    check(payload?["initialLocation"] as? String == "epubcfi(/6/24)", "recovery used the preceding page of a completed curl")
    check(payload?["initialScrollViewport"] == nil, "recovery attached the previous scroll geometry to a page turn")
  }

  await run("a repeated web content termination stops after one automatic recovery") {
    let host = PresentationHost()
    host.load("<html>reader</html>")
    host.resetTrace()
    host.recoverTerminatedWebContent()
    check(host.web.loadCount == 1, "first termination must reload once")
    host.resetTrace()
    host.recoverTerminatedWebContent()
    check(host.web.loadCount == 0, "a repeated termination must not reload in an endless loop")
    check(host.emitted.first?["type"] as? String == "reader:error", "repeated termination must expose the fallback error")
  }

  await run("background web content termination waits for the app to become active") {
    let host = PresentationHost()
    host.load("<html>reader</html>")
    host.resetTrace()
    host.applicationWillResignActive()
    host.recoverTerminatedWebContent()
    check(host.web.loadCount == 0, "background recovery must not start a new WebKit process")
    check(host.emitted.isEmpty, "background recovery must not flash a bridge reset")
    host.applicationDidBecomeActive()
    check(host.web.loadCount == 1, "foregrounding must reload the terminated reader")
    check(host.emitted.first?["type"] as? String == "native:restarting", "foregrounding must reset the TypeScript bridge")
  }

  await run("backgrounding captures the current scroll geometry before reclamation") {
    let host = PresentationHost()
    host.load("<html>reader</html>")
    host.becameReady()
    let locator = ["type": "epub", "cfi": "epubcfi(/6/24)"]
    host.rememberProgress(["payload": ["locator": locator, "scrollViewport": ["offset": -41510]]])
    host.recoveryPosition = ["locator": locator, "scrollViewport": ["offset": -41590]]
    host.applicationWillResignActive()
    await host.settle()
    host.recoverTerminatedWebContent()
    host.applicationDidBecomeActive()
    let payload = host.emitted.first?["payload"] as? [String: Any]
    let viewport = payload?["initialScrollViewport"] as? [String: Any]
    check(viewport?["offset"] as? Int == -41590, "background snapshot must supersede an older relocation")
  }

  await run("expected web content termination and cancellation do not replace recovery with an error") {
    let host = PresentationHost()
    host.load("<html>reader</html>")
    host.resetTrace()
    host.recoverTerminatedWebContent()
    host.handleNavigationFailure(NSError(domain: WKErrorDomain, code: WKError.webContentProcessTerminated.rawValue))
    host.handleNavigationFailure(NSError(domain: NSURLErrorDomain, code: NSURLErrorCancelled))
    check(host.failures.isEmpty, "expected recovery interruptions surfaced as product errors: \(host.failures)")
    host.handleNavigationFailure(NSError(domain: "TestNavigation", code: 1, userInfo: [NSLocalizedDescriptionKey: "real failure"]))
    check(host.failures == ["real failure"], "unexpected navigation failures must remain visible")
  }

  await run("empty native envelopes acknowledge receipt without starting presentation work") {
    let host = PresentationHost()
    host.submit("[]")
    await host.settle()
    check(host.acknowledgement == 0, "empty acknowledgement retains the last accepted command ID")
    check(host.nativeCalls.isEmpty, "empty batch ran native methods: \(host.nativeCalls.map { $0.0 })")
    check(host.web.scripts.isEmpty, "empty batch evaluated browser commands")
    check(host.web.removals == 0, "empty batch detached the live WK view")
  }
  await run("duplicate envelopes keep ACK semantics without replaying or reattaching") {
    let host = PresentationHost()
    let command = #"[{"id":1,"message":{"type":"reader:contents"}}]"#
    host.submit(command)
    await host.settle()
    check(host.web.scripts.count == 1, "first command must execute once")
    host.resetTrace()
    host.submit(command); host.submit("[]")
    await host.settle()
    check(host.acknowledgement == 1, "ACK must still identify the last received ID")
    check(host.web.scripts.isEmpty, "duplicate command replayed")
    check(host.nativeCalls.isEmpty && host.web.removals == 0, "duplicate/cleared batch performed presentation work")
  }
  await run("attaching WK to its existing parent is inert and changing parent still moves it") {
    let host = PresentationHost()
    host.attach(to: host.view)
    check(host.web.removals == 0 && host.view.additions == 0 && host.view.layouts == 0, "same-parent attachment detached/readded or forced layout")
    let page = UIView()
    page.frame = CGRect(x: 0, y: 0, width: 500, height: 700)
    host.attach(to: page)
    check(host.web.superview === page, "new page must own the live WK view")
    check(host.web.frame == page.bounds, "new parent bounds must reach WK")
    check(host.web.removals == 1 && page.additions == 1 && page.layouts == 1, "actual parent change must move and lay out once")
  }
  await run("ordinary native commands do not repeatedly reset curl or detach WK") {
    let host = PresentationHost()
    host.submit(#"[{"id":1,"message":{"type":"reader:contents"}}]"#)
    await host.settle()
    host.resetTrace()
    host.submit(#"[{"id":2,"message":{"type":"reader:bookmark-context"}}]"#)
    await host.settle()
    check(host.web.scripts.count == 1, "normal browser command must still execute")
    check(host.nativeCalls.isEmpty, "unchanged non-curl mode still bridged native methods")
    check(host.web.removals == 0, "normal non-curl command detached WK")
  }
  await run("native curl enters once, stays enabled for queries and exits once") {
    let host = PresentationHost()
    host.setCurl(true)
    await host.settle()
    check(host.engineCurl && host.prepares == 1, "curl must enable the engine and prepare its page")
    host.resetTrace()
    host.submit(#"[{"id":1,"message":{"type":"reader:contents"}}]"#)
    await host.settle()
    check(host.engineCurl && host.prepares == 1, "a query cannot discard the prepared curl page")
    check(host.nativeCalls.isEmpty, "unchanged curl mode rebridged setCurl")
    host.setCurl(false)
    await host.settle()
    check(!host.engineCurl && host.restingInHost, "leaving curl must disable engine gestures and restore live WK")
    check(host.nativeCalls.filter { $0.0 == "setCurl" }.count == 1, "curl exit should be applied once")
    host.resetTrace()
    host.submit(#"[{"id":2,"message":{"type":"reader:contents"}}]"#)
    await host.settle()
    check(host.nativeCalls.isEmpty && host.web.removals == 0, "queries after curl exit must be inert presentation-wise")
  }
  await run("opening another reader reapplies the requested curl mode after engine replacement") {
    let host = PresentationHost()
    host.setCurl(true)
    await host.settle()
    host.resetTrace()
    host.submit(#"[{"id":1,"message":{"type":"reader:open"}}]"#)
    await host.settle()
    check(host.engineCurl, "new EpubReader defaults false and must adopt requested curl")
    check(host.nativeCalls.filter { $0.0 == "setCurl" && $0.1["enabled"] as? Bool == true }.count == 1, "a new reader needs one explicit curl application")
  }
  await run("commands received before load remain ordered and ACK does not mean execution") {
    let host = PresentationHost()
    host.holdUntilLoaded()
    host.submit(#"[{"id":1,"message":{"type":"reader:open"}},{"id":2,"message":{"type":"reader:theme"}}]"#)
    await host.settle()
    check(host.acknowledgement == 2 && host.web.scripts.isEmpty, "receipt ACK must precede deferred execution")
    host.becameLoaded()
    await host.settle()
    check(host.web.scripts.count == 2, "both accepted commands must execute after load")
    check(host.web.scripts.first?.contains("reader:open") == true && host.web.scripts.last?.contains("reader:theme") == true, "open must remain ahead of its following mutation")
  }
  await run("a completed curl turn still restores and commits before preparing its next page") {
    let host = PresentationHost()
    host.setCurl(true)
    await host.settle()
    host.resetTrace()
    host.queueTurn()
    await host.settle()
    check(Array(host.nativeCalls.prefix(3)).map { $0.0 } == ["begin", "restore", "finish"], "turn transaction order changed")
    check(host.nativeCalls.first { $0.0 == "finish" }?.1["commit"] as? Bool == true, "completed turn must commit")
    check(host.engineCurl && host.prepares == 2, "committed turn must prepare the next curl window")
  }
  await run("reactivating an idle reader does not create a presentation transaction") {
    let host = PresentationHost()
    host.setActive(false); host.setActive(true)
    await host.settle()
    check(host.nativeCalls.isEmpty && host.web.removals == 0, "idle reactivation reset or moved WK")
  }
  await run("leaving curl during text selection still restores the live reader") {
    let host = PresentationHost()
    host.setCurl(true)
    await host.settle()
    host.resetTrace()
    host.selectText()
    host.setCurl(false)
    await host.settle()
    check(!host.engineCurl && host.restingInHost, "selection cannot block a requested exit from curl")
    check(host.nativeCalls.filter { $0.0 == "setCurl" }.count == 1, "selection-time exit must disable native gestures once")
  }
  await run("Reduce Motion changes still leave and reenter the requested curl presentation") {
    let host = PresentationHost()
    host.setCurl(true)
    await host.settle()
    host.resetTrace()
    UIAccessibility.isReduceMotionEnabled = true
    host.invalidatePresentation()
    await host.settle()
    check(!host.engineCurl && host.restingInHost, "Reduce Motion must restore the live reader")
    UIAccessibility.isReduceMotionEnabled = false
    host.invalidatePresentation()
    await host.settle()
    check(host.engineCurl && host.prepares == 2, "restoring motion must prepare the requested curl mode")
    check(host.nativeCalls.filter { $0.0 == "setCurl" }.count == 2, "apply each motion-mode transition once")
  }
  await run("browser command failure still aborts preparation and restores the live WK parent") {
    let host = PresentationHost()
    host.setCurl(true)
    await host.settle()
    host.resetTrace()
    host.web.failNextEvaluation = true
    host.submit(#"[{"id":1,"message":{"type":"reader:goTo"}}]"#)
    await host.settle(expectFailure: true)
    check(host.nativeCalls.filter { $0.0 == "abort" }.count == 1, "failed browser mutation must retain explicit abort recovery")
    check(host.restingInHost, "failed preparation must remove its cover and restore live WK")
    host.failures.removeAll()
    host.resetTrace()
    host.setCurl(false)
    await host.settle()
    check(!host.engineCurl, "an error must not prevent the later requested curl exit")
  }
  await run("returning to a covered reader still releases its completed navigation receipt") {
    let host = PresentationHost()
    host.onNative = { method in if method == "navigate" { host.setActive(false) } }
    host.submit(#"[{"id":1,"message":{"type":"reader:navigate","payload":{"operationId":"nav"}}}]"#)
    await host.settle()
    check(host.completedNavigationCount == 0, "a covered reader must hold the arrival receipt")
    host.resetTrace()
    host.setActive(true)
    await host.settle()
    check(host.completedNavigationCount == 1, "reactivation must not strand a completed navigation receipt")
    check(host.nativeCalls.isEmpty && host.web.removals == 0, "releasing the arrival receipt needs no render-layer conversion")
    host.onNative = nil
  }
}

await exercisePresentation()
let output = try JSONEncoder().encode(TestResults.entries)
print(String(decoding: output, as: UTF8.self))
