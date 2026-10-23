// Pi Hub desktop app: one window, a local tab strip (ui/index.html) that drives everything, one child webview per hub (D6),
// state from each hub page's title (D5), live taskbar/overlay/tray icons drawn by the strip (D8, D14), tray (D9, D11).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use tauri::{
    image::Image,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    webview::WebviewBuilder,
    window::WindowBuilder,
    AppHandle, LogicalPosition, LogicalSize, Manager, Rect, RunEvent, WebviewUrl, WindowEvent,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

const STRIP: f64 = 36.0;
#[cfg(windows)]
const UA_BASE: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0";
#[cfg(not(windows))]
const UA_BASE: &str = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const EXT: &str = if cfg!(windows) { ".exe" } else { ".AppImage" };

fn ua() -> String { format!("{UA_BASE} PiHubApp/{}", env!("CARGO_PKG_VERSION")) }
/// The install folder: the hub writes app.json there and reads app.lock (hub/src/app-install.ts).
fn install_dir() -> PathBuf {
    // An AppImage runs from a mount; $APPIMAGE is the real file.
    let exe = std::env::var_os("APPIMAGE").map(PathBuf::from).or_else(|| std::env::current_exe().ok()).unwrap_or_default();
    exe.parent().map(Path::to_path_buf).unwrap_or_default()
}
fn main_file() -> PathBuf { install_dir().join(format!("pi-hub-app{EXT}")) }
fn next_file() -> PathBuf { install_dir().join(format!("pi-hub-app.next{EXT}")) }
fn old_file() -> PathBuf { install_dir().join(format!("pi-hub-app.old{EXT}")) }
fn read_json(path: &Path) -> Option<Value> { serde_json::from_str(&std::fs::read_to_string(path).ok()?).ok() }
fn app_config() -> Value { read_json(&install_dir().join("app.json")).unwrap_or_else(|| json!({})) }
fn arg_after(name: &str) -> Option<String> { let args: Vec<String> = std::env::args().collect(); args.iter().position(|a| a == name).and_then(|i| args.get(i + 1).cloned()) }

/// The hub data folder saved at install (a login or desktop launch may lack PI_CODING_AGENT_DIR), else the hub's own default.
fn hub_data() -> PathBuf {
    if let Some(dir) = arg_after("--hub-data").or_else(|| app_config()["hubData"].as_str().map(String::from)) { return dir.into(); }
    let agent = std::env::var("PI_CODING_AGENT_DIR").map(PathBuf::from).unwrap_or_else(|_| {
        let home = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")).unwrap_or_default();
        Path::new(&home).join(".pi").join("agent")
    });
    agent.join("pi-control-hub")
}
/// D7: the local hub's link from hub.json (port) and config.json (key), read fresh so a changed port never goes stale.
fn local_hub_url() -> Option<String> {
    let dir = hub_data();
    let port = read_json(&dir.join("hub.json"))?["port"].as_u64()?;
    let key = read_json(&dir.join("config.json"))?["localKey"].as_str()?.to_string();
    Some(format!("http://127.0.0.1:{port}/?token={key}"))
}

/// Hands an http(s)/mailto link to the OS default browser or mail app.
fn open_external(url: &tauri::Url) {
    if !matches!(url.scheme(), "http" | "https" | "mailto") { return }
    #[cfg(windows)]
    let _ = hidden(std::process::Command::new("rundll32").args(["url.dll,FileProtocolHandler", url.as_str()])).spawn();
    #[cfg(not(windows))]
    let _ = std::process::Command::new("xdg-open").arg(url.as_str()).spawn();
}
#[cfg(windows)]
fn hidden(command: &mut std::process::Command) -> &mut std::process::Command { use std::os::windows::process::CommandExt; command.creation_flags(0x0800_0000) }
#[cfg(not(windows))]
fn hidden(command: &mut std::process::Command) -> &mut std::process::Command { command }
fn alive(pid: u32) -> bool {
    if cfg!(windows) {
        let out = hidden(std::process::Command::new("tasklist").args(["/FI", &format!("PID eq {pid}"), "/NH", "/FO", "CSV"])).output();
        out.map(|o| String::from_utf8_lossy(&o.stdout).contains(&format!("\"{pid}\""))).unwrap_or(false)
    } else { Path::new(&format!("/proc/{pid}")).exists() }
}
fn other_instance() -> bool {
    std::fs::read_to_string(install_dir().join("app.lock")).ok().and_then(|s| s.trim().parse::<u32>().ok()).is_some_and(|pid| pid != std::process::id() && alive(pid))
}
/// D14: ink follows the Windows taskbar theme, not the page's colour scheme; None elsewhere (the strip then uses prefers-color-scheme).
fn taskbar_dark() -> Option<bool> {
    if !cfg!(windows) { return None }
    let out = hidden(std::process::Command::new("reg").args(["query", r"HKCU\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize", "/v", "SystemUsesLightTheme"])).output().ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    if text.contains("0x1") { Some(false) } else if text.contains("0x0") { Some(true) } else { None }
}

/// H-03 swap, before the single-instance lock: running file → .old, .next → main, relaunch, exit.
/// Windows allows renaming a running exe; a failed step puts the old file back and keeps running it.
fn swap_staged() -> Result<(), String> {
    // "Restart to update": wait (up to 10 s) for the quitting process, or the single-instance lock would hand us back to it.
    if std::env::args().any(|a| a == "--restarted") {
        for _ in 0..50 { if !other_instance() { break } std::thread::sleep(std::time::Duration::from_millis(200)); }
    }
    let (main, next, old) = (main_file(), next_file(), old_file());
    if !next.exists() { let _ = std::fs::remove_file(&old); return Ok(()) } // the next good start deletes .old
    if other_instance() || !std::env::current_exe().map(|e| e == main || std::env::var_os("APPIMAGE").is_some()).unwrap_or(false) { return Ok(()) }
    let _ = std::fs::remove_file(&old);
    std::fs::rename(&main, &old).map_err(|e| format!("Update not applied: {e}"))?;
    if let Err(error) = std::fs::rename(&next, &main) { let _ = std::fs::rename(&old, &main); return Err(format!("Update not applied: {error}")) }
    let args: Vec<String> = std::env::args().skip(1).filter(|a| a != "--restarted").collect();
    std::process::Command::new(&main).args(args).spawn().map_err(|e| format!("Updated, but the new version did not start: {e}"))?;
    std::process::exit(0);
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
fn strip_eval(app: &AppHandle, script: String) { if let Some(strip) = app.get_webview("strip") { let _ = strip.eval(script); } }
fn bring_forward(app: &AppHandle) {
    if let Some(window) = app.get_window("main") { let _ = window.show(); let _ = window.unminimize(); let _ = window.set_focus(); }
}

struct Startup { error: Option<String> }

#[tauri::command]
fn config(state: tauri::State<Startup>) -> Value {
    json!({ "hubs": app_config()["hubs"], "local": local_hub_url(), "dark": taskbar_dark(), "staged": next_file().exists(), "version": env!("CARGO_PKG_VERSION"), "error": state.error })
}
#[tauri::command]
fn local_url() -> Option<String> { local_hub_url() }
#[tauri::command]
fn staged() -> bool { next_file().exists() }
/// Saves the tab list (order, names, remote links) next to the hub's hubData.
#[tauri::command]
fn save(hubs: Value) -> Result<(), String> { save_key("hubs", hubs) }
fn save_key(key: &str, data: Value) -> Result<(), String> {
    let mut value = app_config();
    value[key] = data;
    let path = install_dir().join("app.json");
    let temp = path.with_extension("json.tmp");
    std::fs::write(&temp, serde_json::to_string_pretty(&value).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    std::fs::rename(&temp, &path).map_err(|e| e.to_string())
}
/// Creates hub `id`'s webview (async: creating webviews in a sync command deadlocks on Windows).
#[tauri::command]
async fn open(app: AppHandle, id: u32, url: String) -> Result<(), String> {
    let label = format!("hub{id}");
    if let Some(webview) = app.get_webview(&label) { return webview.navigate(url.parse().map_err(|_| "Bad link")?).map_err(|e| e.to_string()) }
    let window = app.get_window("main").ok_or("no window")?;
    let handle = app.clone();
    let hub: tauri::Url = url.parse().map_err(|_| "Bad link")?;
    let (popup_hub, nav_hub) = (hub.origin(), hub.origin());
    let builder = WebviewBuilder::new(&label, WebviewUrl::External(hub))
        .user_agent(&ua())
        // Links off the hub (chat links, docs) open in the default browser; the hub's own popups (images, files) stay in the app.
        .on_new_window(move |url, _| if url.origin() == popup_hub { tauri::webview::NewWindowResponse::Allow } else { open_external(&url); tauri::webview::NewWindowResponse::Deny })
        .on_navigation(move |url| url.origin() == nav_hub || !matches!(url.scheme(), "http" | "https") || { open_external(url); false })
        .on_document_title_changed(move |webview, title| {
            strip_eval(&handle, format!("window.onTitle && onTitle({}, {})", json!(webview.label()), json!(title)));
        });
    let child = window.add_child(builder, LogicalPosition::new(0.0, STRIP), LogicalSize::new(800.0, 600.0)).map_err(|e| e.to_string())?;
    child.hide().map_err(|e| e.to_string())?;
    layout(&app);
    Ok(())
}
#[tauri::command]
fn show(app: AppHandle, id: u32) {
    let label = format!("hub{id}");
    if let Some(window) = app.get_window("main") {
        for webview in window.webviews() {
            if webview.label() == "strip" { continue }
            let _ = if webview.label() == label { webview.show().and_then(|_| webview.set_focus()) } else { webview.hide() };
        }
    }
}
#[tauri::command]
fn close(app: AppHandle, id: u32) { if let Some(webview) = app.get_webview(&format!("hub{id}")) { let _ = webview.close(); } }
#[tauri::command]
fn reload(app: AppHandle, id: u32) { if let Some(webview) = app.get_webview(&format!("hub{id}")) { let _ = webview.eval("location.reload()"); } }
/// Tauri's set_icon only sets the small (title bar) icon; the taskbar button draws the big one, else the exe's own icon.
#[cfg(windows)]
fn set_taskbar_icon(window: &tauri::Window, rgba: &[u8], size: u32) -> Result<(), String> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{CreateIcon, DestroyIcon, SendMessageW, ICON_BIG, WM_SETICON};
    static LAST: std::sync::Mutex<usize> = std::sync::Mutex::new(0);
    let bgra: Vec<u8> = rgba.chunks_exact(4).flat_map(|p| [p[2], p[1], p[0], p[3]]).collect();
    let mask = vec![0u8; (size * size / 8) as usize]; // all 0: alpha decides
    let hwnd = window.hwnd().map_err(|e| e.to_string())?.0;
    unsafe {
        let icon = CreateIcon(std::ptr::null_mut(), size as i32, size as i32, 1, 32, mask.as_ptr(), bgra.as_ptr());
        if icon.is_null() { return Err("CreateIcon failed".into()) }
        SendMessageW(hwnd as _, WM_SETICON, ICON_BIG as usize, icon as isize);
        let mut last = LAST.lock().unwrap();
        if *last != 0 { DestroyIcon(*last as _); }
        *last = icon as usize;
    }
    Ok(())
}
/// The strip draws the icons on a canvas and hands over RGBA pixels; the overlay carries state on pinned buttons (A-02).
#[tauri::command]
fn set_icons(app: AppHandle, big: Vec<u8>, big_size: u32, small: Vec<u8>, small_size: u32, overlay: Option<Vec<u8>>) -> Result<(), String> {
    let window = app.get_window("main").ok_or("no window")?;
    #[cfg(windows)]
    set_taskbar_icon(&window, &big, big_size)?;
    window.set_icon(Image::new_owned(big, big_size, big_size)).map_err(|e| e.to_string())?;
    #[cfg(windows)]
    window.set_overlay_icon(overlay.map(|o| Image::new_owned(o, 16, 16))).map_err(|e| e.to_string())?;
    #[cfg(not(windows))]
    let _ = overlay;
    if let Some(tray) = app.tray_by_id("tray") { tray.set_icon(Some(Image::new_owned(small, small_size, small_size))).map_err(|e| e.to_string())?; }
    Ok(())
}
/// P-04: tray menu lists the hubs with their state; "Restart to update" only while an update is staged (D11).
#[tauri::command]
fn set_tray(app: AppHandle, hubs: Vec<(u32, String)>, tooltip: String) -> Result<(), String> {
    let Some(tray) = app.tray_by_id("tray") else { return Ok(()) };
    let menu = Menu::new(&app).map_err(|e| e.to_string())?;
    for (id, label) in hubs { menu.append(&MenuItem::with_id(&app, format!("hub:{id}"), label, true, None::<&str>).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?; }
    menu.append(&PredefinedMenuItem::separator(&app).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    menu.append(&MenuItem::with_id(&app, "open", "Open", true, None::<&str>).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    if next_file().exists() { menu.append(&MenuItem::with_id(&app, "restart", "Restart to update", true, None::<&str>).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?; }
    menu.append(&MenuItem::with_id(&app, "quit", "Quit", true, None::<&str>).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    tray.set_menu(Some(menu)).map_err(|e| e.to_string())?;
    tray.set_tooltip(Some(tooltip)).map_err(|e| e.to_string())
}

fn restart(app: &AppHandle) {
    let args: Vec<String> = std::env::args().skip(1).filter(|a| a != "--hidden").collect();
    if std::process::Command::new(main_file()).args(args).arg("--restarted").spawn().is_ok() { app.exit(0) }
}

/// Pinned buttons keep a fixed icon, so only they get the overlay badge. Windows has no API for "is pinned"; a pin made
/// from our window stores our app ID (UTF-16) in a shortcut under User Pinned\TaskBar. A pin of the old shortcut won't match it.
#[tauri::command]
fn pinned() -> bool {
    #[cfg(windows)]
    {
        let id: Vec<u8> = AUMID.encode_utf16().flat_map(|u| u.to_le_bytes()).collect();
        let Some(dir) = std::env::var_os("APPDATA").map(|a| PathBuf::from(a).join(r"Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar")) else { return false };
        let Ok(entries) = std::fs::read_dir(dir) else { return false };
        entries.flatten().any(|e| std::fs::read(e.path()).is_ok_and(|bytes| bytes.windows(id.len()).any(|w| w == id.as_slice())))
    }
    #[cfg(not(windows))]
    false
}
#[cfg(windows)]
const AUMID: &str = "dev.ce-workflow.pi-hub-app.live";
fn main() {
    // Windows 11 draws a Start Menu shortcut's icon for any window it matches to that shortcut (by exe path) and ignores
    // WM_SETICON. An explicit app ID that no shortcut carries keeps the live hub grid on the taskbar.
    #[cfg(windows)]
    unsafe { windows_sys::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID(windows_sys::core::w!("dev.ce-workflow.pi-hub-app.live") /* = AUMID */); }
    let error = swap_staged().err();
    let start_hidden = std::env::args().any(|a| a == "--hidden");
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| bring_forward(app)))
        .plugin(tauri_plugin_global_shortcut::Builder::new().with_handler(|app, shortcut, event| {
            if event.state != ShortcutState::Pressed { return }
            let (key, first) = (shortcut.key as u32, tauri_plugin_global_shortcut::Code::Digit1 as u32);
            if key >= first && key < first + 9 { strip_eval(app, format!("window.shortcut && shortcut({})", key - first)); }
        }).build())
        .manage(Startup { error })
        .invoke_handler(tauri::generate_handler![config, local_url, staged, save, open, show, close, reload, set_icons, set_tray, pinned])
        .setup(move |app| {
            // The hub's running check (hub/src/app-install.ts): our pid, removed on exit.
            let _ = std::fs::write(install_dir().join("app.lock"), std::process::id().to_string());
            let window = WindowBuilder::new(app, "main").title("Pi Hub").inner_size(1200.0, 800.0).maximized(app_config()["maximized"] == true).visible(!start_hidden).build()?;
            window.add_child(WebviewBuilder::new("strip", WebviewUrl::App("index.html".into())).disable_drag_drop_handler(), LogicalPosition::new(0.0, 0.0), LogicalSize::new(1200.0, STRIP))?;
            let handle = app.handle().clone();
            window.on_window_event(move |event| match event {
                WindowEvent::Resized(_) => {
                    layout(&handle);
                    // Remember maximized for the next start; minimizing also resizes, so it doesn't count.
                    if let Some(w) = handle.get_window("main") {
                        if let (Ok(false), Ok(max)) = (w.is_minimized(), w.is_maximized()) { if app_config()["maximized"] != max { let _ = save_key("maximized", json!(max)); } }
                    }
                }
                // D9: close hides to the tray so the dots stay live; Quit is in the tray menu.
                WindowEvent::CloseRequested { api, .. } => { api.prevent_close(); if let Some(w) = handle.get_window("main") { let _ = w.hide(); } }
                // D3: Alt+1..9 (Ctrl+1..9 belongs to the hub page's bookmarks) only while the app has focus; the strip ignores numbers past its last tab.
                WindowEvent::Focused(focused) => {
                    let shortcuts = handle.global_shortcut();
                    if *focused { for i in 1..=9 { let _ = shortcuts.register(format!("alt+{i}").as_str()); } } else { let _ = shortcuts.unregister_all(); }
                }
                _ => {}
            });
            TrayIconBuilder::with_id("tray")
                .icon(app.default_window_icon().cloned().ok_or("no icon")?)
                .tooltip("Pi Hub")
                .menu(&Menu::with_items(app, &[&MenuItem::with_id(app, "open", "Open", true, None::<&str>)?, &MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?])?)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => bring_forward(app),
                    "restart" => restart(app),
                    "quit" => app.exit(0),
                    id => if let Some(hub) = id.strip_prefix("hub:") { bring_forward(app); strip_eval(app, format!("window.select && select({hub})")); },
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event { bring_forward(tray.app_handle()); }
                })
                .build(app)?;
            layout(app.handle());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while starting Pi Hub");
    app.run(|_app, event| if let RunEvent::Exit = event {
        let lock = install_dir().join("app.lock");
        if std::fs::read_to_string(&lock).is_ok_and(|pid| pid.trim() == std::process::id().to_string()) { let _ = std::fs::remove_file(lock); }
    });
}
