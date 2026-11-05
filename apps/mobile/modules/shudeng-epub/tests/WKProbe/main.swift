import AppKit
import WebKit
import EpubFilePort

@MainActor final class Probe: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
    var web: WKWebView?
    var window: NSWindow?
    var handler: EpubResourceScheme?
    func run() async {
        do {
            let fixture = URL(fileURLWithPath: CommandLine.arguments[1])
            let temporary = URL(fileURLWithPath: CommandLine.arguments[2], isDirectory: true)
            let archives = EpubArchives(allowedRoots: [fixture.deletingLastPathComponent()], temporaryRoot: temporary)
            let descriptor = try await archives.open(fixture, budget: .init(maxEntries: 10000, maxResourceBytes: 64 * 1024 * 1024, maxLiveBytes: 128 * 1024 * 1024, maxInflateSeconds: 10))
            let target = descriptor.entries.first { $0.path.hasSuffix("container.xml") }!
            let path = "/" + descriptor.sessionID + "/" + target.resourceID
            let basicHTML = """
            <!doctype html><html><body>EPUB WK resource probe<script>
            (async()=>{try{const r=await fetch('\(path)');const text=await r.text();window.webkit.messageHandlers.probe.postMessage(JSON.stringify({ok:r.ok,origin:location.origin,url:r.url,bytes:new TextEncoder().encode(text).length,container:text.includes('rootfile')}))}catch(e){window.webkit.messageHandlers.probe.postMessage(JSON.stringify({ok:false,error:String(e)}))}})();
            </script></body></html>
            """
            let html: String
            if CommandLine.arguments.count > 3 {
                let script = try String(contentsOfFile: CommandLine.arguments[3], encoding: .utf8).replacingOccurrences(of: "</script", with: "<\\/script")
                let payload: [String: Any] = ["sessionID": descriptor.sessionID, "resourceBaseURL": "shudeng-epub://reader/" + descriptor.sessionID + "/",
                    "entries": descriptor.entries.map { ["path": $0.path, "resourceID": $0.resourceID, "size": $0.size] }]
                let json = String(data: try JSONSerialization.data(withJSONObject: payload), encoding: .utf8)!
                html = "<!doctype html><html><body><script>window.__archive=" + json + ";</script><script type=module>" + script + "</script></body></html>"
            } else { html = basicHTML }
            let handler = EpubResourceScheme(archives: archives)
            handler.setReaderHTML(html); handler.activate(descriptor.sessionID)
            self.handler = handler
            let config = WKWebViewConfiguration(); config.websiteDataStore = .nonPersistent()
            config.setURLSchemeHandler(handler, forURLScheme: EpubResourceScheme.scheme)
            config.userContentController.add(self, name: "probe")
            let web = WKWebView(frame: NSRect(x: 0, y: 0, width: 400, height: 700), configuration: config)
            self.web = web; web.navigationDelegate = self
            let window = NSWindow(contentRect: web.frame, styleMask: [.borderless], backing: .buffered, defer: false)
            self.window = window; window.contentView = web
            web.load(URLRequest(url: handler.pageURL))
            Task { try? await Task.sleep(nanoseconds: 20_000_000_000); await finish("{\"ok\":false,\"error\":\"WK timeout\"}") }
        } catch { await finish("ERROR: \(error)") }
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        Task { await finish(String(describing: message.body)) }
    }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        Task { await finish("ERROR: \(error)") }
    }
    func finish(_ result: String) async {
        print(result)
        await handler?.close()
        if let handler { print("native: stopped=\(handler.stoppedRequestCount), close=joined") }
        NSApplication.shared.terminate(nil)
    }
}
let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
Task { @MainActor in await Probe().run() }
app.run()
