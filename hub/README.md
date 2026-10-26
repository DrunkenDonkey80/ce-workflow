# pi-control-hub

One always-running hub for every Pi session on a PC. It starts each session itself as
`pi --mode rpc`, groups sessions by folder, parks and resumes them, and is the single
remote front door (one port, one `tailscale serve`, one device pairing). ce-workflow no
longer serves its own web page or `/wo share`; the hub is the only browser and phone access.

The plan is tracked in ce-workflow (the Plan3 tool only follows plans in the folder its
session runs in):
`C:\SOFT\git\ce-workflow\docs\plans\2026-10-18-pi-control-hub-rpc-session-host-with-one-web-front-door-0db155f7-plan3.md`

## Use

In Pi, `/wo hub` shows the hub's status and addresses with Install, Start, Open, Restart and remote/login options
(Windows and Linux; Node 24+). `/wo hub <command>` runs any command below. From a terminal: `node hub/src/cli.ts install`.

`pi-hub install | start | stop [--force] | restart | update [--yes] | status [--json] | open [remote] | new [folder] [name] | remote on|off | autostart on|off|status`

- `install` adds the `pi-hub` command (`npm link`, best effort), starts the hub at login and starts it now.

- `update` stops the hub, runs `pi update --all` (Pi and extensions) and starts it again with the sessions that were running. It refuses while a session is busy (never interrupts) and warns about Pi windows outside the hub, which keep the old version and can lock extension files.
- The ⚙ button on the page has Restart hub (same busy rule as `restart`), so the phone can do it too.
- `start` runs the hub; `open` opens its page on this PC; `new` adds a folder's first session (later ones from the page).
- `remote on` adds a tailnet-only `tailscale serve` on the hub's port (never Funnel); new devices pair with a code approved on the hub page → Devices.
- `autostart on` starts the hub at login: Windows per-user Run key (no admin rights), Linux `~/.config/autostart` (desktop logins).
- WSL2: links open in the Windows default browser (`wslview`, else `rundll32`), and `open`/`new` always print a signed link to click. The hub binds 127.0.0.1, which WSL2 forwards to Windows. `pi-hub` found only under `/mnt/` (the Windows PATH) counts as not installed. `autostart on` writes a systemd user unit (`~/.config/systemd/user/pi-control-hub.service`; the hub starts when WSL starts for you) and needs `[boot] systemd=true` in `/etc/wsl.conf`; without systemd there is no login start, so run `pi-hub start`.
- Usage and the Claude accounts window come from the hub itself, so they show with every session parked. With pi-provider-claude-ex in Pi's packages, the hub runs its `cpool` CLI for the account list and actions, and keeps one `cpool daemon` refreshing logins (it leaves an already running daemon alone and stops only its own). `PI_HUB_CPOOL=<path to cpool.ts>` overrides the lookup.
- The hub shows only sessions it started. "Open in terminal" parks a session and hands it to a plain console Pi; the hub takes it back when that Pi exits.

## Desktop app

Pi Hub (`hub/app`, Tauri) is one window with a tab per hub and live state dots on the taskbar icon (up to 4 hubs), its
overlay and the tray (asking red, working amber, finished-unseen blue), even with the window hidden.

- Install: on this PC's hub page, ⚙ → Desktop app → Install. The hub downloads the build of its own ce-workflow version (GitHub release
  `app-v<version>`), checks it against the SHA-256 GitHub reports and installs per user (Windows `%LOCALAPPDATA%\Programs\pi-hub-app`, Start menu "Pi Hub";
  Linux `~/.local/share/pi-hub-app` AppImage plus a menu entry). Uninstall is in the same row; quit the app from the tray first.
- Start at login: the row's checkbox (Windows Run key, Linux `~/.config/autostart`); the app then starts hidden in the tray
  and waits for the hub if it starts first.
- Tabs: the first is this PC's hub; `+` adds another hub by its link (another PC's tailnet address pairs like a phone).
  Right-click renames (names are per PC; an empty name shows only the icon) or removes, drag reorders, Alt+1…9 switches while the app has focus. Closing hides to the tray; Quit is in the tray menu.
- Updates: the app has the ce-workflow version. After an update the hub (at start, then hourly until CI has published the
  build) downloads the matching build and restarts a running app onto it; drafts and tabs are kept, hubs and sessions keep running.
- WSL: install from the Windows hub; its app reaches the WSL hub through 127.0.0.1.
- Linux limits: GNOME shows the tray only with the AppIndicator extension, and live icon changes may not show on Wayland.
- Release: automatic. Every push that changes the version in `package.json` builds both files as release `app-v<version>`
  (`.github/workflows/app-release.yml`, which stamps that version into the app).
  Local build: `cargo tauri build --no-bundle` in `hub/app/src-tauri`.

## Development

Node 24; no install step of its own (ce-workflow's `npm install` covers the imported modules). `npm test` runs `scripts/test-*.mjs`; `scripts/fake-pi.mjs` stands in for `pi --mode rpc`.
