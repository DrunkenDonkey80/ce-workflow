import SwiftUI
import UserNotifications
import WebKit

/// D4: the native shell around the desktop strip. The strip (hub/app/ui/index.html + shim.js) keeps all tab logic;
/// this class does what hub/app/src-tauri/src/main.rs does for it: one WKWebView per hub, icons, menus, notifications.
final class Hub: NSObject, WKScriptMessageHandlerWithReply, WKNavigationDelegate, WKUIDelegate, UNUserNotificationCenterDelegate {
    static let shared = Hub()
    let container = Container()
    private(set) var strip: WKWebView!
    private var hubs: [Int: WKWebView] = [:], origins: [Int: String] = [:], titles: [Int: NSKeyValueObservation] = [:]
    private var permission = "default"
    /// The menu bar item's hubs (Mac); set_tray fills it.
    var onTray: (([(Int, String)]) -> Void)?
    var onTrayIcon: ((PImage) -> Void)?

    override init() {
        super.init()
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(Bundled(), forURLScheme: "pihub")
        config.userContentController.addUserScript(WKUserScript(source: resource("shim.js"), injectionTime: .atDocumentStart, forMainFrameOnly: true))
        config.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "pihub")
        strip = WKWebView(frame: .zero, configuration: config)
        strip.isInspectable = true
        container.addSubview(strip)
        strip.load(URLRequest(url: URL(string: "pihub://app/index.html")!))
        let center = UNUserNotificationCenter.current()
        center.delegate = self
        center.requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
            DispatchQueue.main.async { self.setPermission(granted ? "granted" : "denied") }
        }
        Platform.onActive { [weak self] front in self?.activeChanged(front) }
        #if DEBUG
        debugProbe()
        #endif
    }

    #if DEBUG
    /// Live checks (AP-13/AP-14): a script in <tmp>/pihub-eval.js (first line `strip` or a hub id) runs there; its result,
    /// the Dock badge and icon land next to it in pihub-eval.out and pihub-dock.png.
    private func debugProbe() {
        let dir = FileManager.default.temporaryDirectory, input = dir.appendingPathComponent("pihub-eval.js")
        print("pihub debug probe: \(input.path)")
        Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            guard let self, let text = try? String(contentsOf: input, encoding: .utf8) else { return }
            try? FileManager.default.removeItem(at: input)
            let lines = text.split(separator: "\n", maxSplits: 1).map(String.init)
            let target = lines.first == "strip" ? strip : Int(lines.first ?? "").flatMap { self.hubs[$0] }
            target?.evaluateJavaScript(lines.count > 1 ? lines[1] : "") { result, error in
                var out = "\(result ?? error ?? "nil")"
                #if os(macOS)
                out += "\nbadge=\(NSApp.dockTile.badgeLabel ?? "") hubs=\(self.hubs.keys.sorted()) shown=\(self.hubs.filter { !$0.value.isHidden }.keys.sorted()) strip=\(self.container.stripHeight)"
                if let tiff = NSApp.applicationIconImage.tiffRepresentation, let png = NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:]) {
                    try? png.write(to: dir.appendingPathComponent("pihub-dock.png"))
                }
                #else
                out += "\nhubs=\(self.hubs.keys.sorted()) shown=\(self.hubs.filter { !$0.value.isHidden }.keys.sorted()) strip=\(self.container.stripHeight)"
                #endif
                try? out.write(to: dir.appendingPathComponent("pihub-eval.out"), atomically: true, encoding: .utf8)
            }
        }
    }
    #endif

    func stripEval(_ script: String) { strip.evaluateJavaScript(script, completionHandler: nil) }
    /// Cmd+1..9 (menu commands) pick the strip's tab, like Alt+1..9 on Windows.
    func shortcut(_ index: Int) { stripEval("window.shortcut && shortcut(\(index))") }
    func select(_ id: Int) { stripEval("window.select && select(\(id))") }

    // MARK: strip commands (the invoke names index.html uses)

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void) {
        guard let body = message.body as? [String: Any], let cmd = body["cmd"] as? String else { return replyHandler(nil, "Bad call") }
        let args = body["args"] as? [String: Any] ?? [:]
        // Hub pages get the notification bridge only, never the strip's commands.
        let fromStrip = message.webView === strip
        Task { @MainActor in
            do { replyHandler(try await fromStrip ? self.command(cmd, args) : self.hubCommand(cmd, args, message.webView), nil) }
            catch { replyHandler(nil, "\(error)") }
        }
    }

    @MainActor private func command(_ cmd: String, _ args: [String: Any]) async throws -> Any? {
        let id = (args["id"] as? NSNumber)?.intValue ?? -1
        switch cmd {
        case "config":
            var config: [String: Any] = ["hubs": loadHubs(), "dark": NSNull(), "staged": false, "frame": false, "wrap": true, "version": appVersion, "platform": Platform.name]
            #if os(macOS)
            config["local"] = Platform.localHubURL() ?? NSNull()
            config["bigSize"] = 256
            #else
            config["local"] = false // D12: iPhone and iPad only view other hubs
            #endif
            return config
        case "save": try saveHubs(args["hubs"] ?? [])
        case "open": try open(id, args["url"] as? String ?? "")
        case "show": show(id)
        case "close": close(id)
        case "set_icons": setIcons(args)
        case "set_tray":
            let list = (args["hubs"] as? [[Any]] ?? []).compactMap { pair -> (Int, String)? in
                guard pair.count == 2, let id = (pair[0] as? NSNumber)?.intValue, let label = pair[1] as? String else { return nil }
                return (id, label)
            }
            onTray?(list)
        case "flash": Platform.flash()
        case "local_url":
            #if os(macOS)
            return Platform.localHubURL()
            #else
            return nil
            #endif
        case "in_front": return Platform.isActive
        case "staged", "pinned": return false
        case "gear": hubEval(id, "window.piHubSettings && piHubSettings()")
        case "attend": hubEval(id, "window.piHubAttention && piHubAttention()")
        case "go": hubEval(id, "window.piHubGo && piHubGo(\(json(args["session"] as? String ?? "")))")
        case "menu":
            let items = (args["items"] as? [Any] ?? []).map { $0 as? String }
            let point = CGPoint(x: (args["x"] as? NSNumber)?.doubleValue ?? 0, y: (args["y"] as? NSNumber)?.doubleValue ?? 0)
            return await Platform.menu(items, at: point, in: strip)
        case "height": container.stripHeight = CGFloat((args["height"] as? NSNumber)?.doubleValue ?? 36)
        default: break // strip_left, attention_key, restart_update: Windows-only
        }
        return nil
    }

    // MARK: hubs

    private var hubsFile: URL {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Pi Hub")
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("hubs.json")
    }
    private func loadHubs() -> Any {
        guard let data = try? Data(contentsOf: hubsFile), let saved = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return [] }
        return saved["hubs"] ?? []
    }
    private func saveHubs(_ hubs: Any) throws {
        try JSONSerialization.data(withJSONObject: ["hubs": hubs], options: [.prettyPrinted]).write(to: hubsFile, options: .atomic)
    }

    private func origin(_ url: URL) -> String { "\(url.scheme ?? "")://\(url.host ?? ""):\(url.port ?? (url.scheme == "https" ? 443 : 80))" }
    private func idOf(_ web: WKWebView?) -> Int? { hubs.first { $0.value === web }?.key }

    @MainActor private func open(_ id: Int, _ link: String) throws {
        guard let url = URL(string: link), ["http", "https"].contains(url.scheme ?? "") else { throw Failure("Bad link") }
        origins[id] = origin(url)
        if let web = hubs[id] { web.load(URLRequest(url: url)); return }
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default() // pairing cookies survive restarts
        config.applicationNameForUserAgent = Platform.userAgentName // D8
        config.mediaTypesRequiringUserActionForPlayback = []
        #if os(iOS)
        config.allowsInlineMediaPlayback = true
        #endif
        config.userContentController.addUserScript(WKUserScript(source: "window.__piHubPermission=\(json(permission));" + resource("notify.js"), injectionTime: .atDocumentStart, forMainFrameOnly: true))
        config.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "pihub")
        let web = WKWebView(frame: .zero, configuration: config)
        web.isInspectable = true
        web.navigationDelegate = self
        web.uiDelegate = self
        web.isHidden = true
        hubs[id] = web
        container.addSubview(web)
        titles[id] = web.observe(\.title, options: [.new]) { [weak self] web, _ in
            self?.stripEval("window.onTitle && onTitle(\(json("hub\(id)")), \(json(web.title ?? "")))")
        }
        web.load(URLRequest(url: url))
        container.relayout()
    }

    private func show(_ id: Int) {
        for (key, web) in hubs { web.isHidden = key != id }
        guard let web = hubs[id] else { return }
        Platform.focus(web)
        web.evaluateJavaScript("window.piHubFocus && piHubFocus()", completionHandler: nil)
    }

    private func close(_ id: Int) {
        hubs.removeValue(forKey: id)?.removeFromSuperview()
        titles.removeValue(forKey: id)
        origins.removeValue(forKey: id)
    }

    private func hubEval(_ id: Int, _ script: String) { hubs[id]?.evaluateJavaScript(script, completionHandler: nil) }

    /// main.rs: a hub page that still has focus while another app is in front must not mark a finished run seen.
    private func activeChanged(_ front: Bool) {
        stripEval("window.__piHubFocus && __piHubFocus(\(front))")
        for web in hubs.values {
            web.evaluateJavaScript("window.piHubFront=\(front);" + (front ? "dispatchEvent(new Event('focus'))" : ""), completionHandler: nil)
        }
    }

    // MARK: icons (AP-07, AP-09)

    private func setIcons(_ args: [String: Any]) {
        let count = (args["count"] as? NSNumber)?.intValue ?? 0
        #if os(macOS)
        if let big = image(args["big"], (args["bigSize"] as? NSNumber)?.intValue ?? 64) { NSApp.applicationIconImage = big }
        NSApp.dockTile.badgeLabel = count > 0 ? String(count) : nil
        if let small = image(args["small"], (args["smallSize"] as? NSNumber)?.intValue ?? 32) { onTrayIcon?(small) }
        #else
        UNUserNotificationCenter.current().setBadgeCount(count)
        #endif
    }

    // MARK: notifications (D11)

    private func setPermission(_ value: String) {
        permission = value
        for web in hubs.values { web.evaluateJavaScript("window.__piHubPermission=\(json(value))", completionHandler: nil) }
    }

    @MainActor private func hubCommand(_ cmd: String, _ args: [String: Any], _ web: WKWebView?) async throws -> Any? {
        guard let id = idOf(web) else { return nil }
        let tag = args["tag"] as? String ?? ""
        switch cmd {
        case "notify_permission":
            let granted = (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])) ?? false
            setPermission(granted ? "granted" : "denied")
            return permission
        case "notify":
            let content = UNMutableNotificationContent()
            content.title = args["title"] as? String ?? ""
            content.body = args["body"] as? String ?? ""
            content.sound = .default
            content.userInfo = ["hub": id, "tag": tag]
            try await UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "\(id):\(tag)", content: content, trigger: nil))
        case "notify_close":
            UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: ["\(id):\(tag)"])
        default: break
        }
        return nil
    }

    // The hub decides when to notify, so banners show while the app is in front too.
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler done: @escaping (UNNotificationPresentationOptions) -> Void) {
        done([.banner, .list, .sound])
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler done: @escaping () -> Void) {
        let info = response.notification.request.content.userInfo
        DispatchQueue.main.async {
            if let id = (info["hub"] as? NSNumber)?.intValue {
                Platform.bringForward()
                self.select(id)
                self.hubEval(id, "window.__piHubClicked && __piHubClicked(\(json(info["tag"] as? String ?? "")))")
            }
            done()
        }
    }

    // MARK: navigation: links off the hub open in the system browser; the hub's own popups stay in the app

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url, let id = idOf(webView), action.targetFrame?.isMainFrame ?? true,
              ["http", "https"].contains(url.scheme ?? ""), origin(url) != origins[id] else { return decisionHandler(.allow) }
        Platform.openExternal(url)
        decisionHandler(.cancel)
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        guard let url = action.request.url else { return nil }
        let own = ["blob", "about", "data"].contains(url.scheme ?? "") || idOf(webView).map { origins[$0] == origin(url) } ?? false
        guard own else { Platform.openExternal(url); return nil }
        let popup = WKWebView(frame: .zero, configuration: configuration)
        popup.uiDelegate = self
        Platform.present(popup)
        return popup
    }

    func webViewDidClose(_ webView: WKWebView) { Platform.dismiss(webView) }

    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        let hub = idOf(webView).flatMap { origins[$0] }
        decisionHandler(hub?.hasPrefix("\(origin.protocol)://\(origin.host):") == true ? .grant : .prompt)
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        Platform.alert(message, buttons: ["OK"], field: nil) { _, _ in completionHandler() }
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        Platform.alert(message, buttons: ["OK", "Cancel"], field: nil) { button, _ in completionHandler(button == 0) }
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        Platform.alert(prompt, buttons: ["OK", "Cancel"], field: defaultText ?? "") { button, text in completionHandler(button == 0 ? text : nil) }
    }

    #if os(macOS)
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = parameters.allowsDirectories
        panel.begin { completionHandler($0 == .OK ? panel.urls : nil) }
    }
    #endif
}

struct Failure: Error, CustomStringConvertible { let description: String; init(_ text: String) { description = text } }

let appVersion = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0"

func resource(_ name: String) -> String {
    Bundle.main.url(forResource: name, withExtension: nil).flatMap { try? String(contentsOf: $0, encoding: .utf8) } ?? ""
}

func json(_ value: String) -> String {
    String(data: try! JSONSerialization.data(withJSONObject: value, options: .fragmentsAllowed), encoding: .utf8)!
}

/// RGBA pixels from the strip's canvas (straight alpha) to an image.
func image(_ value: Any?, _ size: Int) -> PImage? {
    guard let numbers = value as? [NSNumber], numbers.count == size * size * 4 else { return nil }
    let bytes = numbers.map { $0.uint8Value }
    guard let provider = CGDataProvider(data: Data(bytes) as CFData),
          let cg = CGImage(width: size, height: size, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: size * 4, space: CGColorSpace(name: CGColorSpace.sRGB)!,
                           bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.last.rawValue), provider: provider, decode: nil, shouldInterpolate: true, intent: .defaultIntent)
    else { return nil }
    #if os(macOS)
    return NSImage(cgImage: cg, size: NSSize(width: size, height: size))
    #else
    return UIImage(cgImage: cg)
    #endif
}

/// Serves the strip's files from the app bundle (index.html imports icons.js as a module, which file:// refuses).
final class Bundled: NSObject, WKURLSchemeHandler {
    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url, let file = Bundle.main.url(forResource: url.lastPathComponent, withExtension: nil),
              let data = try? Data(contentsOf: file) else { return task.didFailWithError(URLError(.fileDoesNotExist)) }
        let type = url.pathExtension == "js" ? "text/javascript" : "text/html"
        task.didReceive(HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "\(type); charset=utf-8"])!)
        task.didReceive(data)
        task.didFinish()
    }
    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}

/// AP-04: the strip across the top at the height it reports, the shown hub page below it.
final class Container: PView {
    var stripHeight: CGFloat = 36 { didSet { if stripHeight != oldValue { relayout() } } }
    #if os(macOS)
    override var isFlipped: Bool { true }
    override func layout() { super.layout(); place() }
    func relayout() { needsLayout = true }
    #else
    override func layoutSubviews() { super.layoutSubviews(); place() }
    func relayout() { setNeedsLayout() }
    #endif
    private func place() {
        for view in subviews {
            view.frame = view === Hub.shared.strip
                ? CGRect(x: 0, y: 0, width: bounds.width, height: stripHeight)
                : CGRect(x: 0, y: stripHeight, width: bounds.width, height: max(0, bounds.height - stripHeight))
        }
    }
}
