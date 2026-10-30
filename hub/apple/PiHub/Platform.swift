import SwiftUI
import WebKit

#if os(macOS)
import AppKit
typealias PView = NSView
typealias PImage = NSImage

enum Platform {
    static let name = "macos"
    static let userAgentName = "Version/18.0 Safari/605.1.15 PiHubApp/\(appVersion)"
    static var isActive: Bool { NSApp.isActive }
    private static var popups: [NSWindow] = []

    static func onActive(_ change: @escaping (Bool) -> Void) {
        NotificationCenter.default.addObserver(forName: NSApplication.didBecomeActiveNotification, object: nil, queue: .main) { _ in change(true) }
        NotificationCenter.default.addObserver(forName: NSApplication.didResignActiveNotification, object: nil, queue: .main) { _ in change(false) }
    }
    static func focus(_ web: WKWebView) { web.window?.makeFirstResponder(web) }
    static func flash() { if !NSApp.isActive { NSApp.requestUserAttention(.informationalRequest) } }
    static func openExternal(_ url: URL) { NSWorkspace.shared.open(url) }
    static func bringForward() { MacApp.shared?.showWindow() }

    /// D7/main.rs local_hub_url: this Mac's hub from hub.json (port) and config.json (key), read fresh each time.
    static func localHubURL() -> String? {
        let dir = (ProcessInfo.processInfo.environment["PI_CODING_AGENT_DIR"].map { URL(fileURLWithPath: $0) }
            ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".pi/agent")).appendingPathComponent("pi-control-hub")
        func read(_ name: String) -> [String: Any]? {
            (try? Data(contentsOf: dir.appendingPathComponent(name))).flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
        }
        guard let port = (read("hub.json")?["port"] as? NSNumber)?.intValue, let key = read("config.json")?["localKey"] as? String else { return nil }
        return "http://127.0.0.1:\(port)/?token=\(key)"
    }

    static func menu(_ items: [String?], at point: CGPoint, in view: NSView) async -> Int? {
        let menu = NSMenu()
        var pick: Int?
        for (index, text) in items.enumerated() {
            if let text { menu.addItem(ActionItem(text) { pick = index }) } else { menu.addItem(.separator()) }
        }
        menu.popUp(positioning: nil, at: point, in: view) // returns after the menu closed
        await Task.yield() // let the picked item's action run first
        return pick
    }

    static func alert(_ message: String, buttons: [String], field: String?, done: @escaping (Int, String) -> Void) {
        let alert = NSAlert()
        alert.messageText = message
        for title in buttons { alert.addButton(withTitle: title) }
        let input = field.map { text -> NSTextField in
            let input = NSTextField(string: text)
            input.frame = NSRect(x: 0, y: 0, width: 300, height: 24)
            return input
        }
        alert.accessoryView = input
        input.map { alert.window.initialFirstResponder = $0 }
        let answer = alert.runModal().rawValue - NSApplication.ModalResponse.alertFirstButtonReturn.rawValue
        done(answer, input?.stringValue ?? "")
    }

    static func present(_ web: WKWebView) {
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1000, height: 750), styleMask: [.titled, .closable, .resizable, .miniaturizable], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.contentView = web
        window.center()
        window.makeKeyAndOrderFront(nil)
        popups.removeAll { !$0.isVisible }
        popups.append(window)
    }
    static func dismiss(_ web: WKWebView) { web.window?.close() }
}

/// An NSMenuItem that runs a closure.
final class ActionItem: NSMenuItem {
    private let run: () -> Void
    init(_ title: String, key: String = "", run: @escaping () -> Void) {
        self.run = run
        super.init(title: title, action: #selector(fire), keyEquivalent: key)
        target = self
    }
    required init(coder: NSCoder) { fatalError() }
    @objc private func fire() { run() }
}

#else
import UIKit
typealias PView = UIView
typealias PImage = UIImage

enum Platform {
    static var name: String { UIDevice.current.userInterfaceIdiom == .pad ? "ipados" : "ios" }
    static let userAgentName = "Mobile/15E148 PiHubApp/\(appVersion)"
    static var isActive: Bool { UIApplication.shared.applicationState == .active }

    static func onActive(_ change: @escaping (Bool) -> Void) {
        NotificationCenter.default.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { _ in change(true) }
        NotificationCenter.default.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: .main) { _ in change(false) }
    }
    static func focus(_ web: WKWebView) {}
    static func flash() {}
    static func openExternal(_ url: URL) { UIApplication.shared.open(url) }
    static func bringForward() {}

    private static var top: UIViewController? {
        var controller = UIApplication.shared.connectedScenes.compactMap { ($0 as? UIWindowScene)?.keyWindow }.first?.rootViewController
        while let next = controller?.presentedViewController { controller = next }
        return controller
    }

    /// An action sheet stands in for the desktop's popup menu (a popover at the tab on iPad).
    @MainActor static func menu(_ items: [String?], at point: CGPoint, in view: UIView) async -> Int? {
        await withCheckedContinuation { done in
            let sheet = UIAlertController(title: nil, message: nil, preferredStyle: .actionSheet)
            for (index, text) in items.enumerated() {
                guard let text else { continue }
                sheet.addAction(UIAlertAction(title: text, style: text == "Remove" ? .destructive : .default) { _ in done.resume(returning: index) })
            }
            sheet.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in done.resume(returning: nil) })
            sheet.popoverPresentationController?.sourceView = view
            sheet.popoverPresentationController?.sourceRect = CGRect(origin: point, size: .zero)
            guard let top else { return done.resume(returning: nil) }
            top.present(sheet, animated: true)
        }
    }

    static func alert(_ message: String, buttons: [String], field: String?, done: @escaping (Int, String) -> Void) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        if let field { alert.addTextField { $0.text = field } }
        for (index, title) in buttons.enumerated() {
            alert.addAction(UIAlertAction(title: title, style: title == "Cancel" ? .cancel : .default) { _ in done(index, alert.textFields?.first?.text ?? "") })
        }
        guard let top else { return done(buttons.count - 1, "") }
        top.present(alert, animated: true)
    }

    static func present(_ web: WKWebView) {
        let controller = UIViewController()
        controller.view = web
        controller.navigationItem.rightBarButtonItem = UIBarButtonItem(systemItem: .done, primaryAction: UIAction { _ in controller.dismiss(animated: true) })
        top?.present(UINavigationController(rootViewController: controller), animated: true)
    }
    static func dismiss(_ web: WKWebView) { web.window?.rootViewController?.presentedViewController?.dismiss(animated: true) }
}
#endif
