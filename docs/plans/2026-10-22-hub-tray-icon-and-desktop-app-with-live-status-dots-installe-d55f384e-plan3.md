---
plan3: true
status: ready
created: 2026-10-22
updated: 2026-10-23T06:48:29.844Z
reviewed: 2026-10-23
started: 2026-10-23T05:51:30.778Z
---

# Hub tray icon and desktop app with live status dots, installed from settings

## Original request

> I say we build both - tray icons and real apps and allow to install them from settings (to an user install area and also auto update them). for the app allow to host multiple windows and can have a hotkey like ctrl 123 to switch between, up to 4 can display in a single icon with their dots too which will be amazing

Context from the conversation before this plan: the browser-installed hub app (PWA) only gets a number badge on its taskbar icon; the browser fixes the icon at install, so the coloured state dots (red asks, amber working, blue finished and unseen) are lost. The user wants the dots back, on Windows and Linux.

## Goal, requirements, and non-goals

Goal: a small desktop app, "Pi Hub", that shows several hubs (computers) in one window with tabs and draws their live state dots on its own taskbar icon and tray icon. Hub settings install it into a per-user folder and keep it updated.

Requirements:
- R1: One program provides both the tray icon and the window (D1). Windows and Linux.
- R2: One window with one tab per hub; each tab shows the hub's name, icon and state (D2).
- R3: The taskbar icon combines several hubs' icons, each with its own state dots (D2). How many fit is decided from a mockup at real sizes (A-03).
- R4: Ctrl+1 to Ctrl+N switch tabs while the app has focus only (D3).
- R5: Install, Update and Uninstall from hub settings, into a per-user folder, no admin rights (D4).
- R6: Updates arrive automatically with ce-workflow updates: the repo pins the app version and file hashes; the hub downloads, verifies and stages it (D4).
- R7: Hubs on other computers open in a tab through their normal link and pair like the phone does (D7).

Non-goals:
- macOS builds.
- Code signing and installers (MSI, NSIS, .deb). The hub places a plain executable or AppImage.
- System-wide hotkeys (D3).
- Tauri's own updater and its signing key (D4).
- "Open in app" deep links from remote hub pages (Backlog).
- Replacing the browser PWA or changing the browser tab icon; both stay as they are.
- A separate app inside WSL: the Windows app opens the WSL hub through 127.0.0.1, which WSL2 forwards.

## Decisions

- **D1 Tauri v2, one app for Windows and Linux; tray and window in one program.** User choice (ask_user, this session). Rationale: one codebase covers tray icon, window icon and Windows taskbar overlay; .NET 10 is installed but would be Windows-only. Consequence: Rust (stable, MSVC) and the Visual Studio C++ build tools get installed on this PC for the development loop (accepted in the same answer); releases are built by a GitHub Actions workflow when the user pushes an app tag.
- **D2 One window, one tab per hub; the taskbar icon combines several hubs.** User answer: "taskbar icon … can hold MULTIPLE hub icons in a same icon all showing distinct state of a different hub, then when opened to have tabs to show the different hubs and name and icon and state too … up to 4 or even 6 hubs". Fact that limits this: Windows 11 draws taskbar icons at 24×24 px at 100 % scale (32 px source, downscaled), and tray icons at 16×16 (Microsoft Learn "About Icons"; Windhawk taskbar-icon-size notes). A 2×2 grid gives 12 px per hub at 100 %. A-03 measures legibility before the count is fixed.
- **D14 The taskbar icon shows up to 4 hubs; the tray shows one icon with merged dots.** User choice after the A-03 mockup. At taskbar size a 3×2 grid of 6 turns to mush, while the 2×2 grid keeps each hub's icon readable at 24/32 px. Hubs beyond 4 appear only as app tabs; the overlay dot still counts all of them. Tray at 16 px: this PC's icon with up to 3 dots (any hub asking, working, finished-unseen), with the tooltip naming hubs and states. The mockup also showed that dark ink vanishes on a dark taskbar, so the app picks the ink from the Windows taskbar theme (`SystemUsesLightTheme`), not from `prefers-color-scheme`.
- **D3 Ctrl+1 to Ctrl+N work only while the app has focus.** User choice. Implementation choice (planner): register the shortcuts with Tauri's global-shortcut plugin when the app window gains focus and unregister them when it loses focus, so they work whichever tab's page has keyboard focus and never take the keys from other programs.
- **D4 The hub installs and updates the app from hashes pinned in the repo.** User choice. `hub/app/release.json` holds the app version and, per platform, the GitHub release URL and SHA-256. The hub downloads, refuses a hash mismatch, and stages the file; the app switches to it on its next start. No Tauri updater, no signing key. Trust comes from the repo the user already runs.
- **D5 Pages report their state through the document title, not IPC (planner choice).** Tauri ≥ 2.8 has `on_document_title_changed` (Tauri release notes 2.8.0). Inside the app (user agent carries a `PiHubApp/<version>` marker), the hub page sets its title to a machine-readable line with icon name, hub name and states. No Tauri command is exposed to remote hub pages, so a hub page cannot reach the app's native API.
- **D6 Tabs are child webviews in one window (planner choice, spike first).** Tauri's multiwebview (`Window::add_child`) sits behind the `unstable` Cargo feature. Each hub loads as a top-level page in its own webview, so pairing cookies stay first-party (an iframe would break them, and the hub sends `frame-ancestors 'none'`). A local tab-strip webview draws the tabs. Fallback if A-02 shows it is unusable: one window per hub; the taskbar groups them and Ctrl+N switches windows.
- **D7 Install is offered only on the hub's local page (planner choice).** The hub downloads onto its own disk, so a remote page (phone, another PC) must not show Install. The local hub's tab reads `hub.json` (port) and `config.json` (local key) from the hub data folder at app start, so a changed port never leaves a stale link. Remote hubs are added in the app by pasting their link.
- **D8 One source for icon drawing.** The combined icon is drawn by a new function in `hub/web/icons.ts`. A small build script turns that file into the app's `ui/icons.js`, so the browser tab icon and the app icon never drift apart.

Assumptions (over 95 % sure from evidence):
- A file the hub downloads with Node carries no Mark-of-the-Web, so Windows SmartScreen does not block the unsigned executable. Browsers and mail clients add that mark; plain HTTPS downloads from a program do not.
- The repo is public (`gh repo view` reports PUBLIC), so release assets download without a token and Actions minutes are free.
- **D9 Closing the window hides it to the tray; Quit in the tray menu exits.** User choice (Q-01, /plan3 resolve). Rationale: the dots only stay live while the hub pages are loaded (D5).
- **D10 The app starts at login, on by default after install.** User choice (Q-02). Install writes the login entry (Windows: HKCU Run value; Linux: XDG autostart .desktop file) that starts the app hidden in the tray; a "Start at login" switch in hub settings turns it off; uninstall removes it.
- **D11 A staged update takes effect on the next start; the tray menu offers "Restart to update".** User choice (Q-03). The tab strip shows a small note while an update waits. The app never restarts unasked.
- **D12 Linux ships with its desktop limits written down.** User choice (Q-04). Same code; hub/README.md states that GNOME shows the tray only with the AppIndicator extension and that live icon changes may not show on Wayland. L-02 records what the friend's desktop actually does.
- **D13 On a hub running inside WSL, the Desktop app row hides Install and says "Install the app from the Windows hub".** User choice (Q-05). `isWsl()` (`hub/src/platform.ts`) selects it; the install, update and uninstall routes refuse on WSL too, and the hourly app staging (H-05) skips there. The Windows app reaches the WSL hub through 127.0.0.1. A PC with only a WSL hub gets no app.


## Open questions

### Blocking

None.

### Deferred

None.

## Relevant files and approach

Existing code to reuse:
- `hub/web/icons.ts`: `ICONS` and `iconSvg(name, states)`; the dot colours and positions. Add `hubsIconSvg(hubs)` for the combined icon (D8).
- `hub/web/app.ts`: `renderIcon()` already gathers the page's states (other sessions' tones plus the current session's). Add the in-app title line (D5) there; leave the favicon and `setAppBadge` as they are.
- `hub/src/api.ts`: `tone()` and the `unseen` set; `sessions()` returns `settings`, which carries the new app status.
- `hub/src/hub.ts`: settings and action routes, the local-key check (`x-hub-key`, `?token=`), the public `/app-icon.svg`.
- `hub/src/update-check.ts`: the hourly check (`createUpdateCheck`, `findUpdatesHidden`); add the app pin comparison and staging there.
- `hub/src/cli.ts`: `autostart()` patterns for the Windows Run key and XDG files; `hubDataDir()`.
- `hub/src/platform.ts`: `isWsl()`, `findCommand()`.
- `hub/web/index.html`: the settings sections (`#settings-menu`, `settings-group`); the Desktop app section goes here, local pages only.
- `hub/scripts/test-remote.mjs`: the paired-remote harness for route-level refusal tests.

New files:
- `hub/src/app-install.ts`: status, install, update (stage), uninstall. Windows: `%LOCALAPPDATA%\Programs\pi-hub-app\pi-hub-app.exe` plus a Start-menu shortcut (needed for search and pinning). Linux: `~/.local/share/pi-hub-app/pi-hub-app.AppImage` plus `~/.local/share/applications/pi-hub-app.desktop`. Downloads only URLs under the repo's GitHub releases, verifies SHA-256, writes atomically.
- `hub/app/release.json`: `{ version, assets: { "windows-x64": { url, sha256 }, "linux-x64": { url, sha256 } } }`.
- `hub/app/src-tauri/`: `Cargo.toml`, `tauri.conf.json`, `capabilities/`, `src/main.rs` (window, child webviews, title hook, icons, tray, focus-scoped shortcuts, hidden-to-tray, staged-update swap, single instance).
- `hub/app/ui/`: tab strip `index.html`, `tabs.js`, generated `icons.js`.
- `hub/app/build-icons.mjs`: writes `ui/icons.js` from `hub/web/icons.ts` (D8).
- `hub/app/pin-release.mjs`: after a release, downloads its assets with `gh` and writes their hashes into `release.json`.
- `.github/workflows/app-release.yml`: on tag `app-v*`, builds on `windows-latest` and `ubuntu-22.04`, uploads the Windows exe and the Linux AppImage to the release.
- `hub/scripts/test-app-install.mjs`: install, update, uninstall against a local fake release server and a temp folder; hash mismatch refused.

Title line format (D5), set only when the user agent has the `PiHubApp/` marker:
`pi-hub-state {"name":"FLEXPC","icon":"pc","states":["waiting","working"]}`. The tab strip falls back to the plain title for a hub that sends no state line (an older hub).

Web UI: this changes one settings row and adds a tab strip, not a redesign. Follow the existing settings sections and button styles in `hub/web/styles.css`. The tab strip reuses the hub's tokens (font stack, the light-blue selected tone, the state colours from `icons.ts`), so frontend-design is not needed.

## Commands

Run hub tests with `PI_HUB= PI_HUB_SESSION=` set in the environment.
- C1 `node hub/scripts/test-app-install.mjs` (new)
- C2 `node hub/scripts/test-update.mjs`
- C3 `node hub/scripts/test-browser.mjs`
- C4 `npx tsc --noEmit -p tsconfig.json` (covers `extensions/**` only; hub modules are checked by C1–C3, C9 and LSP diagnostics on the changed files)
- C9 `node hub/scripts/test-remote.mjs`
- C10 `node hub/scripts/test-api.mjs`
- C5 `cargo tauri build --no-bundle` in `hub/app/src-tauri` (after A-01 installs `tauri-cli` with `cargo install tauri-cli --version "^2"`)
- C6 `node hub/scripts/changelog-shot.mjs "<selector>" docs/changelog/<version>-<name>.png "<setup JS>"` for the settings row
- C7 `node hub/app/build-icons.mjs`
- C8 `npm run verify:quiet` (only when the user asks for the full suite)

## Phases

### Phase 1: Toolchain and feasibility [think]

- [x] **A-01** Rust stable 1.99.1 (MSVC, per-user via winget rustup), VS 2026 C++ workload and tauri-cli 2.12.4 installed.
- [x] **A-01H** User approved UAC; C++ workload added to the existing VS Community 2026 instead of separate VS 2022 Build Tools.
- [x] **A-02** Spike in hub/app/src-tauri: multiwebview tabs, title hook, live window/overlay/tray icons, Ctrl+N, hide-to-tray all work; D6 kept; pinned buttons need the overlay.
- [x] **A-03** Mocked hubsIconSvg for 1–6 hubs at 16/24/32/48 px on light and dark; user chose max 4 in the taskbar and merged dots in the tray (D14).
- [x] **A-03H** User judged the mockup: up to 4 hubs in the taskbar icon, merged dots on one icon in the tray.

### Phase 2: Hub side [code]

- [ ] **H-01** Add `hubsIconSvg(hubs)` and `build-icons.mjs` (D8); keep `iconSvg` output unchanged for the tab icon.
  - Check: C7 writes `ui/icons.js`; C3 still passes.
- [ ] **H-02** In-app title line in `hub/web/app.ts` (D5), set only when the user agent carries `PiHubApp/`.
  - Hub name: add `hostname` (os.hostname()) to `pageApi.settings()` and the page's `HubSettings` type; the title line uses it, never a session or folder name.
  - States include the displayed session's own `unseen` (today `loadSessions` drops the current session's tone and `renderIcon` adds back only waiting/working).
  - `extras()` in `hub/src/api.ts` stops clearing `unseen` on every snapshot/SSE reconnect; only an explicit open (session click) or the visible-and-focused `seen` post clears it.
  - Freshness: inside the app the page keeps polling sessions every 5 s even when hidden, so a state change reaches the icon within 10 s (L-01's bound).
  - Check: C3 with a test that sets the marker and reads `document.title` (hostname, own unseen, normal browsers keep their title); C10 for a background reconnect leaving `unseen` set.
- [ ] **H-03** `hub/src/app-install.ts` with status, install, stage, uninstall; per-user paths for Windows and Linux.
  - Windows Start-menu shortcut via PowerShell `WScript.Shell`, run hidden; Linux .desktop file with the AppImage path.
  - Login entry on by default (D10): HKCU Run value or XDG autostart file, starting the app with `--hidden`; uninstall removes it.
  - Refuse URLs outside the repo's release path and any SHA-256 mismatch; temp file then rename.
  - Stage as `pi-hub-app.next(.exe)`. Swap at app start, before the single-instance lock: rename the running file to `.old` (Windows allows renaming a running exe), `.next` to the main name, relaunch it and exit; the next good start deletes `.old`; a failed rename leaves the old version running and reports it.
  - Uninstall refuses while the app runs ("Quit Pi Hub from the tray first").
  - The installer writes the hub data folder into the app's config (and the login entry's `--hub-data` argument), because a desktop launch may lack `PI_CODING_AGENT_DIR` (`hub/src/registry.ts` hubDataDir).
  - Check: C1 (fake release server, temp install root, mismatch refused, uninstall leaves nothing, uninstall refused while a fake app process holds the lock); the real two-version swap is checked in L-01.
- [ ] **H-04** Settings API and UI row "Desktop app": Install, Update, Uninstall, version, and the "Start at login" switch (D10); local page only (D7).
  - On WSL the row shows only the D13 note; the action routes refuse there (C9 or C10 case).
  - Remote pages never see the row; the action route is gated on the request being local (not only on the key), so a paired remote device cannot install, uninstall or change the login entry.
  - Check: C3 for the row on local and its absence on remote; C9 for paired remote, remote with a local token, and missing/wrong key: each refused with no file or login-entry change; C6 shot of the row.
- [ ] **H-05** Hourly check: when the installed app version differs from `release.json`, download and stage it (D4); skipped on WSL (D13).
  - Check: C2 with a fake pin; staged file present, running file untouched.

### Phase 3: The app [code]

- [ ] **P-01** Tab strip and hub list: local hub from `hub.json` and `config.json` (D7), added remote hubs saved in the app's config.
  - The local tab reads the hub data folder saved at install (H-03); a missing `hub.json` (app started before the hub at login) keeps the tab and retries every few seconds.
  - Add a hub by pasting its link; rename and remove from the tab's menu; order sets Ctrl+N.
- [ ] **P-02** Child webview per hub (or the A-02 fallback), user agent marker, title hook feeding each tab's name, icon and dots.
- [ ] **P-03** Combined taskbar icon from the tabs' states via `ui/icons.js`, plus the overlay icon if A-02 showed pinned buttons need it.
- [ ] **P-04** Tray icon and menu: hubs with their state, Open, Restart to update (D11), Quit; click brings the window forward.
- [ ] **P-05** Focus-scoped Ctrl+1 to Ctrl+N (D3), hide to tray on close (D9), hidden start, single instance, staged-update swap at start.
  - Check for P-01 to P-05: C5 builds; manual run against the local hub and the WSL hub shows tabs, dots and switching.

### Phase 4: Release pipeline [code]

- [ ] **R-01** `.github/workflows/app-release.yml` for tag `app-v*` on Windows and Ubuntu; uploads the exe and the AppImage.
- [ ] **R-02** `hub/app/pin-release.mjs` writes version, URLs and SHA-256 into `release.json` from a published release.
  - Check: run against a fake release folder; output matches `sha256sum` of the files.
- [ ] **R-05** Write the app section of hub/README.md: install from settings, login start, updates, and the Linux desktop limits (D12).
- [human] **R-03** Push master and the first `app-v0.1.0` tag (pushing is the user's call).
- [blocked] **R-04** After R-03: confirm the workflow run is green, run R-02, commit the pin.

### Phase 5: Live acceptance [think]

- [human] **L-01** On this PC: Install from settings, then tabs for this PC, the WSL hub and the work PC; Ctrl+N; tray; pinned button.
  - Accept: a question in any hub turns its part of the taskbar icon red within 10 s, also with its tab inactive and the window hidden to the tray; finished unseen work shows blue until opened.
  - Accept: Restart to update swaps two real builds; with the old file locked by hand the swap fails cleanly and the old version keeps running.
  - Accept: app started before the hub at login connects once the hub is up.
  - Accept: bump `release.json` to a test build; within the hourly check the app is staged and switches after restart.
- [blocked] **L-02** Linux check on the friend's machine (needs a Linux desktop): install, tray, icon, tabs; record what the desktop allows (D12).
### P-ARCH [code] Product architecture

- [ ] **ARCH-RECONCILE** Reconcile the product architecture diagram with this plan's actual changes.
  - Compare actual code and git history; update through plan3_diagram target product, or mark done with no architecture change.
  - Changed plan elements: none flagged; inspect actual implementation.


## Global validation

- C1, C2, C3, C4, C9 and C10 pass; C5 builds the app on Windows; the release workflow builds both platforms.
- Acceptance examples: L-01's two accept lines; a remote hub page shows no "Desktop app" row; a tampered download (hash mismatch) is refused with a clear message and nothing is installed.
- Changelog: one entry with a C6 shot of the settings row and a shot of the app's tab strip.

## Backlog

- "Open in app" from any hub page (a `pi-hub-app://` link) to add a remote hub with one click.
- Desktop notifications from inside the app (WebView2 notification support unverified).
- macOS build; code signing; more than 6 hubs in the icon.

## Resume context

Planning draft, nothing implemented. D1–D13 settled; D13: a WSL hub hides Install and points to the Windows hub. The Astra review's 9 findings were folded in (see Amendments). No open questions remain. Next: A-01 installs Rust, the VS C++ build tools and tauri-cli; A-01H needs the user to approve the admin prompt. The A-02 spike may switch D6 to its fallback, and the A-03 mockup sets the hub count and the tray icon design; ask about both once the evidence exists.

## Amendments

Append material changes and their reasons; preserve the original request and settled decisions.
- 2026-10-23: Added R-05 after R-02: Q-04 answered "ship with documented limits" (D12); no step wrote the documentation.
- 2026-10-23 review (Astra plan3-advisor), each finding checked against the code:
  - 1 Accepted: `loadSessions` drops the current session's tone and `extras()` clears `unseen` on every snapshot (hub/src/api.ts:84). Folded into H-02 with C10.
  - 2 Accepted: hidden pages poll every 15 s (hub/web/app.ts loadSessions). H-02 keeps 5 s in the app; L-01 bound set to 10 s, hidden and inactive cases included.
  - 3 Accepted: swap and running uninstall were unspecified. H-03 now defines the rename-swap with `.old` rollback and refuses uninstall while running; L-01 tests two real builds.
  - 4 Accepted as open question Q-05 (Deferred): a WSL hub would install an AppImage inside WSL, against the non-goals.
  - 5 Accepted: `hub.json` is removed on clean shutdown (hub/src/hub.ts) and the data dir follows PI_CODING_AGENT_DIR. Install records the data folder; P-01 retries a missing marker.
  - 6 Accepted: settings carry no hostname (hub/src/hub.ts settings()). H-02 adds it.
  - 7 Accepted: settings routes accept paired remote callers. H-04 gates app actions on local requests; C9 route tests added.
  - 8 Accepted: tsconfig.json includes only extensions/**. C4 relabelled; C9/C10 added.
  - 9 Accepted: settings markup is in hub/web/index.html; listed under Relevant files.
- 2026-10-23: Added final architecture reconciliation because a product diagram exists.
