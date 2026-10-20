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
- The hub shows only sessions it started. "Open in terminal" parks a session and hands it to a plain console Pi; the hub takes it back when that Pi exits.

## Development

Node 24; no install step of its own (ce-workflow's `npm install` covers the imported modules). `npm test` runs `scripts/test-*.mjs`; `scripts/fake-pi.mjs` stands in for `pi --mode rpc`.
