import SwiftUI
import UserNotifications

@main
struct PiHubApp: App {
    #if os(macOS)
    @NSApplicationDelegateAdaptor(MacApp.self) var mac
    var body: some Scene {
        // The window and menu bar item are AppKit (MacApp): closing the window keeps the hubs running.
        Settings { EmptyView() }.commands { HubCommands() }
    }
    #else
    var body: some Scene {
        WindowGroup {
            // The web views handle the keyboard themselves (as in Safari); SwiftUI shrinking them too left a blank gap.
            HubView().ignoresSafeArea([.container, .keyboard], edges: .bottom)
        }.commands { HubCommands() }
    }
    #endif
}

/// Cmd+1..9 pick a tab (Alt+1..9 on Windows), also from an iPad keyboard.
struct HubCommands: Commands {
    var body: some Commands {
        CommandMenu("Hubs") {
            ForEach(1..<10) { n in
                Button("Hub \(n)") { Hub.shared.shortcut(n - 1) }.keyboardShortcut(KeyEquivalent(Character(String(n))), modifiers: .command)
            }
        }
    }
}

#if os(iOS)
struct HubView: UIViewRepresentable {
    func makeUIView(context: Context) -> Container { Hub.shared.container }
    func updateUIView(_ view: Container, context: Context) {}
}
#else
final class MacApp: NSObject, NSApplicationDelegate, UNUserNotificationCenterDelegate {
    static weak var shared: MacApp?
    private var window: NSWindow!
    private var status: NSStatusItem!

    // SwiftUI installs its own notification delegate that forwards only to the app delegate, so this forwards to Hub;
    // it must be in place before launch finishes, or a click that launches the app is lost.
    func applicationWillFinishLaunching(_ notification: Notification) { _ = Hub.shared }
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler done: @escaping (UNNotificationPresentationOptions) -> Void) {
        Hub.shared.userNotificationCenter(center, willPresent: notification, withCompletionHandler: done)
    }
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler done: @escaping () -> Void) {
        Hub.shared.userNotificationCenter(center, didReceive: response, withCompletionHandler: done)
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        MacApp.shared = self
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1200, height: 850), styleMask: [.titled, .closable, .resizable, .miniaturizable], backing: .buffered, defer: false)
        window.title = "Pi Hub"
        window.isReleasedWhenClosed = false
        window.setFrameAutosaveName("Pi Hub")
        window.contentView = Hub.shared.container
        if !window.setFrameUsingName("Pi Hub") { window.center() }
        window.makeKeyAndOrderFront(nil)
        status = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        status.button?.image = NSImage(systemSymbolName: "circle.grid.2x2", accessibilityDescription: "Pi Hub")
        tray([])
        Hub.shared.onTray = { [weak self] hubs in self?.tray(hubs) }
        Hub.shared.onTrayIcon = { [weak self] icon in icon.size = NSSize(width: 18, height: 18); self?.status.button?.image = icon }
    }

    /// set_tray: the hubs with their state, then Show and Quit (P-04 on Windows).
    private func tray(_ hubs: [(Int, String)]) {
        let menu = NSMenu()
        for (id, label) in hubs { menu.addItem(ActionItem(label) { [weak self] in self?.showWindow(); Hub.shared.select(id) }) }
        if !hubs.isEmpty { menu.addItem(.separator()) }
        menu.addItem(ActionItem("Show Pi Hub") { [weak self] in self?.showWindow() })
        menu.addItem(ActionItem("Quit Pi Hub", key: "q") { NSApp.terminate(nil) })
        status.menu = menu
    }

    var trayTitles: [String] { status.menu?.items.map(\.title) ?? [] }

    func showWindow() {
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows: Bool) -> Bool {
        if !hasVisibleWindows { showWindow() }
        return true
    }
}
#endif
