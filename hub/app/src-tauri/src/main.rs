// A-02 spike: one window, a local tab strip, one child webview per hub, title hook, live icons, tray, focus-scoped Ctrl+N.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use std::sync::Mutex;
use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    webview::WebviewBuilder,
    window::WindowBuilder,
    AppHandle, LogicalPosition, LogicalSize, Manager, Rect, WebviewUrl, WindowEvent,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

const STRIP: f64 = 36.0;
const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0 PiHubApp/0.1.0";

struct Hubs { urls: Vec<String>, active: Mutex<usize> }

fn local_hub_url() -> Option<String> {
    let home = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")).ok()?;
    let dir = std::path::Path::new(&home).join(".pi/agent/pi-control-hub");
    let read = |name: &str| -> Option<serde_json::Value> { serde_json::from_str(&std::fs::read_to_string(dir.join(name)).ok()?).ok() };
    let port = read("hub.json")?["port"].as_u64()?;
    let key = read("config.json")?["localKey"].as_str()?.to_string();
    Some(format!("http://127.0.0.1:{port}/?token={key}"))
}

fn layout(app: &AppHandle) {
    let Some(window) = app.get_window("main") else { return };
    let scale = window.scale_factor().unwrap_or(1.0);
    let Ok(size) = window.inner_size() else { return };
    let (w, h) = (size.width as f64 / scale, size.height as f64 / scale);
    for webview in window.webviews() {
        let (y, height) = if webview.label() == "strip" { (0.0, STRIP) } else { (STRIP, (h - STRIP).max(0.0)) };
        let _ = webview.set_bounds(Rect { position: LogicalPosition::new(0.0, y).into(), size: LogicalSize::new(w, height).into() });
    }
}

fn show_tab(app: &AppHandle, index: usize) {
    let hubs = app.state::<Hubs>();
    if index >= hubs.urls.len() { return }
    *hubs.active.lock().unwrap() = index;
    for i in 0..hubs.urls.len() {
        if let Some(webview) = app.get_webview(&format!("hub{i}")) {
            let _ = if i == index { webview.show().and_then(|_| webview.set_focus()) } else { webview.hide() };
        }
    }
    if let Some(strip) = app.get_webview("strip") { let _ = strip.eval(format!("window.selected && selected({index})")); }
}

#[tauri::command]
fn select(app: AppHandle, index: usize) { show_tab(&app, index) }

#[tauri::command]
fn hubs(state: tauri::State<Hubs>) -> Vec<String> { state.urls.clone() }

/// The strip draws icons on a canvas (one drawing source, D8) and hands the pixels over.
#[tauri::command]
fn set_icons(app: AppHandle, big: Vec<u8>, big_size: u32, small: Vec<u8>, small_size: u32, overlay: Option<Vec<u8>>) -> Result<(), String> {
    let window = app.get_window("main").ok_or("no window")?;
    window.set_icon(Image::new_owned(big, big_size, big_size)).map_err(|e| e.to_string())?;
    #[cfg(windows)]
    window.set_overlay_icon(overlay.map(|o| Image::new_owned(o, 16, 16))).map_err(|e| e.to_string())?;
    #[cfg(not(windows))]
    let _ = overlay;
    if let Some(tray) = app.tray_by_id("tray") { tray.set_icon(Some(Image::new_owned(small, small_size, small_size))).map_err(|e| e.to_string())?; }
    Ok(())
}

fn bring_forward(app: &AppHandle) {
    if let Some(window) = app.get_window("main") { let _ = window.show(); let _ = window.unminimize(); let _ = window.set_focus(); }
}

fn main() {
    let mut urls: Vec<String> = std::env::args().skip(1).filter(|a| a.starts_with("http")).collect();
    if urls.is_empty() { urls.extend(local_hub_url()); }
    let hidden = std::env::args().any(|a| a == "--hidden");
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().with_handler(|app, shortcut, event| {
            if event.state != ShortcutState::Pressed { return }
            let key = shortcut.key as u32;
            let first = tauri_plugin_global_shortcut::Code::Digit1 as u32;
            if key >= first && key < first + 9 { show_tab(app, (key - first) as usize); }
        }).build())
        .manage(Hubs { urls: urls.clone(), active: Mutex::new(0) })
        .invoke_handler(tauri::generate_handler![select, hubs, set_icons])
        .setup(move |app| {
            // Spike comparison: one plain webview window (no strip, no child webviews).
            if std::env::args().any(|a| a == "--plain") {
                tauri::WebviewWindowBuilder::new(app, "plain", WebviewUrl::External(urls[0].parse()?)).title("Pi Hub plain").inner_size(1200.0, 800.0).user_agent(UA).build()?;
                return Ok(());
            }
            let window = WindowBuilder::new(app, "main").title("Pi Hub").inner_size(1200.0, 800.0).visible(!hidden).build()?;
            window.add_child(WebviewBuilder::new("strip", WebviewUrl::App("index.html".into())), LogicalPosition::new(0.0, 0.0), LogicalSize::new(1200.0, STRIP))?;
            for (i, url) in urls.iter().enumerate() {
                let handle = app.handle().clone();
                let builder = WebviewBuilder::new(format!("hub{i}"), WebviewUrl::External(url.parse()?))
                    .user_agent(UA)
                    .on_document_title_changed(move |webview, title| {
                        if let Some(strip) = handle.get_webview("strip") {
                            let label = serde_json::to_string(webview.label()).unwrap();
                            let _ = strip.eval(format!("window.onTitle && onTitle({label}, {})", serde_json::to_string(&title).unwrap()));
                        }
                    });
                let child = window.add_child(builder, LogicalPosition::new(0.0, STRIP), LogicalSize::new(1200.0, 800.0 - STRIP))?;
                if i != 0 { child.hide()?; }
            }
            let handle = app.handle().clone();
            window.on_window_event(move |event| match event {
                WindowEvent::Resized(_) => layout(&handle),
                WindowEvent::CloseRequested { api, .. } => { api.prevent_close(); if let Some(w) = handle.get_window("main") { let _ = w.hide(); } }
                // D3: Ctrl+1..N only while the app has focus.
                WindowEvent::Focused(focused) => {
                    let shortcuts = handle.global_shortcut();
                    eprintln!("focused {focused}");
                    if *focused {
                        let n = handle.state::<Hubs>().urls.len().min(9);
                        for i in 1..=n { let _ = shortcuts.register(format!("ctrl+{i}").as_str()); }
                    } else { let _ = shortcuts.unregister_all(); }
                }
                _ => {}
            });
            let open = MenuItem::with_id(app, "open", "Open", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            TrayIconBuilder::with_id("tray")
                .icon(app.default_window_icon().cloned().ok_or("no icon")?)
                .tooltip("Pi Hub")
                .menu(&Menu::with_items(app, &[&open, &quit])?)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() { "open" => bring_forward(app), "quit" => app.exit(0), _ => {} })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event { bring_forward(tray.app_handle()); }
                })
                .build(app)?;
            layout(app.handle());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Pi Hub");
}
