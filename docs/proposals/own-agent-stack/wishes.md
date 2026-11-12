# Which wishes and pains Pi can meet today (T-04)

Snapshot 2026-11-12, Pi 1.5.2. Part of the map `docs/plans/2026-11-12-own-agent-stack-instead-of-pi-go-no-go-map-11005151-plan3.md`. Per D-05, every D-01 item gets "possible on Pi" or "needs a new stack". A "possible" item becomes its own small plan and is no reason to rewrite.

## Multi-hub wishes

| Wish | Verdict | What exists | Small Pi follow-up | Rough cost |
|---|---|---|---|---|
| Hubs share settings | **Possible on Pi** | `~/.pi/agent/pi-sync.json` (v3) syncs settings, keybindings, models, AGENTS, skills, prompts, themes and extensions through git (`my_pi_config`); manual, last used July 29, its package no longer loaded | Bring the sync into the hub: one setting, pull on hub start, push on change, show conflicts in the hub page | small to medium |
| Hubs push updates to each other | **Possible on Pi** | The hub already updates packages (`hub/src/auto-update.ts`) and reaches other devices over Tailscale (`hub/src/remote.ts`) | A hub-to-hub notice over the existing Tailscale link: "update ready" or "settings changed", and the receiver runs its normal update path | medium |
| LLM logins live on one computer, or are spawned | **Possible on Pi** | pi-provider-claude-ex (ours) shares Claude logins between machines (`/claude-pool-sync`) and has a single-writer daemon (`cpool daemon`); Pi supports custom providers (`docs/custom-provider.md`) | Option A: keep syncing logins (works today for Claude). Option B: one "login hub" that proxies model calls for the others; a custom provider on each other hub points at it, and tokens never leave the login hub | A: done for Claude, small for Codex; B: medium |
| In-process communication | **Possible on Pi** | Pi's SDK runs sessions in-process (`createAgentSession`, `AgentSessionRuntime`, `docs/sdk.md`); the hub already imports Pi in-process for models, sessions and settings (`hub/src/pi-sdk.ts`) but runs turns in `pi --mode rpc` children | Host sessions inside the hub process through the SDK, keep RPC children as a fallback. Removes the two node processes per session (D-10) and the JSON hop | medium to large; risks below |

In-process risks (unverified, to check in the follow-up plan): extensions that keep module-level state would then be shared by all sessions in the hub; one crashing or hanging extension stops every session instead of one; `/reload` would affect the whole hub.

## Pains

| Pain | Verdict | Evidence | Follow-up on Pi |
|---|---|---|---|
| Security | **Possible on Pi** | D-11, `security.md`: no candidate fixes prompt injection alone; three hardening levels exist on Pi | Pin and review packages; per-command bash sandbox (Codex's Apache-2.0 sandbox code on Windows, bubblewrap on Linux); or run the stack in WSL as a separate user |
| Speed | **Possible on Pi** | D-10, `baseline.md`: Pi core starts in 0.27 s; our packages add 1.1 to 2.7 s and 150 MB per session; the agent loop adds about 10 ms per turn | Cut package load (lazy-load or replace pi-lens and other heavy packages); in-process sessions (above) remove the per-session process start entirely |
| Ownership | **Partly possible on Pi** | Pi is MIT: a fork is ours. Third-party packages are ~600k lines, and we use few of their features daily (D-09) | Fork Pi only if upstream changes ever hurt (none recorded so far); replace third-party packages one by one with small owned ones, starting with those we use least |
| Simplicity | **Partly possible on Pi** | Today: hub + N Pi children (2 node processes each) + RPC + extension layer | In-process sessions give one process and one protocol for clients; the extension layer stays. A different agent would still need an extension or plugin layer for our ~25k lines of extensions |

## Summary

No D-01 item strictly needs a new stack. Two are only partly met on Pi:
- **Ownership:** full ownership means a fork, and a Pi fork is the cheapest one.
- **Simplicity:** the extension layer remains whichever agent is chosen.

The rewrite case therefore rests on value judgements (T-06), not on blocked wishes.

## Follow-up drafts (for T-10)

1. Hub settings sync between machines (from pi-sync).
2. Hub-to-hub notices for updates and settings.
3. A login hub, or Codex login sync next to the Claude pool.
4. In-process sessions in the hub through Pi's SDK.
5. Package hardening: pinned, reviewed updates; replace pi-lens with a small owned diagnostics tool.
6. A per-command bash sandbox extension.
