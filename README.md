# pi-control-hub

One always-running manager for every Pi session on a PC. It is the single front door for
remote access (one port, one `tailscale serve`, one device pairing) and controls the
sessions themselves: list, group, start, rename, park and resume.

Status: design only. The plan lives in `docs/plans/`.

## Decisions so far

- **herdr keeps hosting the terminals.** The hub drives herdr through its CLI/socket API
  and has no terminal code of its own. Each Pi keeps its full TUI.
- **Group = working directory** (one herdr workspace each), e.g. `sketchup` with its 5 sessions.
  A group only filters the switcher; inside it you can start a new session or rename one.
- **Park = quit Pi** (the session file stays on disk); **resume = new tab with the same name**
  starting Pi on that session file. The hub remembers parked sessions; neither herdr nor Pi does.
  Parking idle sessions costs little: the provider's prompt cache has usually expired after about an hour anyway.
- **Split with ce-workflow.** Inside each Pi, ce-workflow keeps only a local-only bridge
  (chat rows, activity, ask_user/dialogs, status, commands, plan/diagram data). The hub
  owns the listener, `tailscale serve`, pairing/devices, the session switcher and
  lifecycle. Once the hub works, the network code is removed from ce-workflow.

## herdr commands it relies on

| Hub feature | herdr |
|---|---|
| Groups | `herdr workspace list/create --cwd <dir> --label <name>` |
| New session | `herdr tab create --workspace <id> --cwd <dir> --label <name>`, then `herdr agent start <name> --kind pi --pane <id> [-- <pi args>]` |
| Rename | `herdr tab rename` |
| Park | quit Pi, `herdr tab close` |
| State colours | `herdr agent list` (working / idle / waiting) |

## Existing pieces in ce-workflow to reuse or move

- `extensions/plan3-remote.ts`: share records, the session registry
  (`~/.pi/agent/ce-workflow/remote/sessions/<id>.json`: pid, name, cwd, port, state),
  the device registry (`devices.json`) and the `tailscale serve` helpers.
- `extensions/plan3-web.ts` + `extensions/plan3-web/`: the per-session web server and browser app.

## Open questions

- Does `herdr agent start ... -- <args>` pass Pi's resume-session argument through unchanged?
- What happens to running and parked sessions when the herdr server restarts?
- Later: other machines through herdr `--machine`/`--remote`; Linux support.
