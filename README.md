# pi-control-hub

One always-running hub for every Pi session on a PC. It starts each session itself as
`pi --mode rpc`, groups sessions by folder, parks and resumes them, and is the single
remote front door (one port, one `tailscale serve`, one device pairing). ce-workflow no
longer serves its own web page or `/wo share`; the hub is the only browser and phone access.

The plan is tracked in ce-workflow (the Plan3 tool only follows plans in the folder its
session runs in):
`C:\SOFT\git\ce-workflow\docs\plans\2026-10-18-pi-control-hub-rpc-session-host-with-one-web-front-door-0db155f7-plan3.md`

## Use

`pi-hub start | stop [--force] | restart | update [--yes] | status | open | new [folder] [name] | remote on|off | autostart on|off|status`

- `update` stops the hub, runs `pi update --all` (Pi and extensions) and starts it again with the sessions that were running. It refuses while a session is busy (never interrupts) and warns about Pi windows outside the hub, which keep the old version and can lock extension files.
- `start` runs the hub; `open` opens its page on this PC; `new` adds a folder's first session (later ones from the page).
- `remote on` adds a tailnet-only `tailscale serve` on the hub's port (never Funnel); new devices pair with a code approved on the hub page → Devices.
- `autostart on` starts the hub at Windows logon (per-user Run key, no admin rights).
- The hub shows only sessions it started. "Open in terminal" parks a session and hands it to a plain console Pi; the hub takes it back when that Pi exits. Nothing depends on herdr.

## Development

Node 24 and ce-workflow checked out next to this folder (`../ce-workflow`; the hub imports its
Pi-free modules through a `file:` dependency), then `npm install`. `npm test` runs `scripts/test-*.mjs`; `scripts/fake-pi.mjs` stands in for `pi --mode rpc`.
