---
plan3: true
status: active
created: 2026-10-18
updated: 2026-10-18T16:55:21.555Z
reviewed: 2026-10-18
tagsChecked: 6990795e
started: 2026-10-18T16:38:35.082Z
---

# pi-control-hub: RPC session host with one web front door

## Original request

The user's requests, in order (2026-10-18):

> what if we get rid of herdr and make a process that hosts different pi sessions and IT is the host for our stuff. i.e. it can have different pi sessions that can be ran on demand, we share once, create groups of pi sessions and control them just like we do here but instead per pi process to be global. and also park (exit pi) unused sessions and resume them on need. [...] probably this belongs to another project - stripping all the share functionality of ce-workflow and moving it to a separate manager?

> yeah on groups just filter by directory i.e Sketchup with 5 or so sub and ability to start new one or rename one

> [...] herdr managemnt now looks bad idea to me. can you research and list me what we need to change to go via hub controls everything and starts pi sessions on its own via rpc and it is the one that control the stuff completely and then we may even move more code in the hub as oppoised to the pi session. so herdr stays there if I need a terminal, hub has the remote sessions it started and controls and parks and stuff

> no prob with the camera, will go away with it now that I have the phone working. shortcuts we will get runing in the web at some way. about ask_user - we own that extension anyway so can't we extend it in case of ran via rpc to send all the things needed to the hub [...] this way the hub will create the ask_user form code too having all the info and we wont have to keep in the pi the stuff?

> yes remove old plans, create new one around that idea AND make it complete i.e we wont be using another pi instance for developing the whole thing - it will happen here because the stuff is very interconnected. still in that new folder tho, but it will be YOU making the stuff

## Goal, requirements, and non-goals

Goal: an always-running hub (`C:\SOFT\git\pi-control-hub`) that starts and controls Pi sessions itself through Pi's RPC mode and is the single remote front door. Code that only exists for remote use moves out of ce-workflow into the hub.

Requirements:
- The hub starts each session as its own `pi --mode rpc` child process and drives it completely: prompt, steer, follow-up, stop, model, thinking level, compact, rename, extension commands.
- Sessions are grouped by working folder (for example `sketchup` with five sessions). A group filters the session list; inside it you can start a new session or rename one.
- Park ends the Pi process and keeps the session file. Resume starts Pi again on that file. Idle sessions can be parked automatically.
- One address, one `tailscale serve` (never Funnel), one device pairing for every session. Paired devices keep working through the move where possible.
- The browser app keeps every feature the per-session web view has today (inventory in "Relevant files"), served by the hub.
- ask_user and the `/wo` menus send their complete data to the hub over the RPC pipe, and the hub draws the forms. Without the hub they behave exactly as today.
- "Open in terminal" opens the session in a plain window on request; nothing depends on herdr (D20). A session file is never open in the hub and a terminal at the same time.
- Once the hub has parity, ce-workflow loses its web server, sharing, pairing, devices, Tailscale code, chat and activity mirror, and web dialog relay.
- All development happens in this session, across both repositories. No other Pi instance builds any part.

Non-goals: any herdr dependency (D20); camera use in hub sessions (user: not needed now that the phone works); hosting terminals in the hub; controlling sessions the user started in a terminal; Linux and other machines (Backlog); running sessions inside the hub's own process through the SDK.

## Decisions

User decisions:
- **D1 Hub owns the sessions through RPC** (its herdr part is superseded by D20). Source: user, 2026-10-18 ("herdr managemnt now looks bad idea [...] herdr stays there if I need a terminal"). Replaces the earlier herdr-driving design, whose plans were deleted on request.
- **D2 Group = working folder,** with New and Rename inside the group. Source: user, 2026-10-18.
- **D3 Move as much code as possible into the hub,** keeping in Pi only what must run inside it. Source: user, 2026-10-18.
- **D4 ask_user (and the `/wo` menus) send their full data to the hub, which draws the forms;** the form code then lives only in the hub. Source: user, 2026-10-18.
- **D5 Camera is not needed in hub sessions;** keyboard shortcuts are to be provided in the web. Source: user, 2026-10-18.
- **D6 This session builds everything,** in `C:\SOFT\git\pi-control-hub` plus the ce-workflow changes. Source: user, 2026-10-18.

Agent design choices (from Pi 1.2.0 docs and installed code; change if a phase disproves them):
- **D7 One child process per session, not the SDK.** A crash ends only that session, memory is returned on Park, and ce-workflow's module state already assumes one session per process. The hub writes its own small JSONL client rather than depending on Pi's `RpcClient`, because the hub must answer `extension_ui_request` records and must split records on LF only (Pi `docs/rpc.md` "Framing"). P1-01 confirms whether `RpcClient` would do instead.
- **D22 (assumed, from F8) The channel's ask uses `input`, not `editor`:** marker title, JSON in the placeholder, the answer as the value. Pi then drops the request itself on abort or timeout, and the channel still publishes `closed` so the hub removes the form. Reversible: both carry 1 MB unchanged (F7).
- **D8 Hub channel inside the RPC pipe, no second connection** (the `editor` transport for asks is superseded by D22). When the hub sets `PI_HUB=1`, ce-workflow sends request-and-answer data as one `editor` prompt with a marker title (`pi-hub:<kind>`) and JSON in the pre-filled text, and sends one-way updates as `setStatus` with a reserved key prefix (`pi-hub:<kind>`). Both pass through RPC unchanged per Pi `docs/rpc-extension-ui.md`; P1 verifies it. The existing `ask:pending` payload (`extensions/work-ask-remote.ts`) is the ask_user format, so intercom and the hub share one format.
- **D9 Exclusive session files through a lock file.** Pi's session manager has no file locking (`dist/core/session-manager.js` has no lock code) and loads the file before extensions start (`_setSessionFile`, around line 665). So the owner is whoever atomically creates `<session file>.lock` (create-new, holding pid and start time): the hub creates it before spawning a child and removes it only after the child has exited; for "Open in terminal" the hub keeps holding it until the terminal Pi exits. A terminal Pi started by the user takes the same lock in ce-workflow's `session_start` and refuses to continue, telling the user, if the hub holds it. Stale locks (dead pid) are taken over. Known limit: a Pi started without ce-workflow (for example `--no-extensions`) takes no lock, so the hub cannot see it; the README says so. Replaces the earlier advisory "open by pid" record (review finding 1).
- **D10 The plan file lives in ce-workflow,** because the plan3 tool only tracks plans in the folder its session runs in; the code lives in pi-control-hub. The hub README links here.
- **D11 Hub data lives in `<agent dir>/pi-control-hub/`** (`PI_CODING_AGENT_DIR` or `~/.pi/agent`), with atomic writes like `plan3-remote.ts`. The hub listens on 127.0.0.1 on one fixed port chosen at first start and saved, so bookmarks stay valid.
- **D12 Reload = restart the child.** RPC has no reload command (`dist/modes/rpc/rpc-types.d.ts`), so the web Reload button parks and resumes the session, allowed only while idle.
- **D13 Keep the current browser app and move it,** not a redesign: its look and behaviour were tuned with the user over many rounds. New UI (folder groups, Park, Resume, Open in terminal, pairing approval) reuses its existing tokens and components in `plan3-web/styles.css`.

Rejected: driving herdr tabs with the hub (D1); keeping the per-session web servers behind a proxy (previous plan, rejected by the user as keeping everything where it is now); a second network channel from each Pi to the hub (D8 makes it unnecessary).

Assumptions (over 95% from evidence): `pi --mode rpc --session <file>` resumes a saved session (Pi `docs/cli.md`); closing the child's stdin shuts Pi down in order (Pi `docs/rpc.md` "Shutdown"); RPC prompts accept images and extension commands, also while a run is going (`docs/rpc-commands.md`); ce-workflow's dialogs already fall back to plain prompts outside the terminal (`work-dialogs.ts:304`, `ask-user/index.ts:2524`).
Resolved through `/plan3 resolve` (user via ask_user, 2026-10-18; user choices, not technical evidence):
- **D14 (Q-01) Import shared code from ce-workflow.** ce-workflow keeps the diagram model, plan reading, project files and usage reader as small Pi-free modules; the hub imports them through a `file:../ce-workflow` dependency. One copy of the logic; the hub needs ce-workflow checked out next to it.
- **D15 (Q-02) Park refuses while busy** (working, compacting, subagents running, or a dialog open) and says why. Automatic parking only parks idle sessions.
- **D16 (Q-03) Automatic parking after 60 minutes idle,** with no open dialog and no browser viewing; changeable in hub settings, 0 turns it off. User comment: "60 minutes? we do a compact because of cache miss in like... 6? I dont mind just seems strange." Correction to the question's context: the prompt cache normally expires after 5 minutes (`work-models.ts:coldCacheCompactMinutes` uses the model's short `promptCache` retention, default 300 s; one hour is only the long retention). So parking at any point after 5 minutes costs no extra model tokens. 60 minutes stays as chosen: its only purpose is freeing memory without making you wait for a restart when you come back soon.
- **D17 (Q-04) After a hub restart, the hub starts again the sessions that were running** (including night mode); the rest stay parked. A normal restart is refused while any session is working.
- **D18 (Q-05) Hub-started sessions plus recent existing ones, kept apart.** Folder groups hold the hub's sessions. Pi sessions from the last 30 days that the hub did not start appear in a separate "Recents" group, closed by default. Starring a recent session moves it into its folder's group (creating the group if needed) under a name you give it, such as "1". Unstarring removes it from the group; it then only shows in Recents while it is recent. Interpretation of the user's comment; unstarring a hub-started session works the same way.
- **D19 (Q-06) New devices are approved on the local hub page** (127.0.0.1 with the hub's local key), which shows the pending device and its matching code with Approve and Reject.
- **D21 One prompt interface: ask_user, terminal included.** Every prompt (questions, `/wo` and night mode menus, confirms such as "Compact before sending?", model pickers) is an ask_user question. ask_user's own view draws them in the terminal and the separate `work-dialogs.ts` overlay is deleted. Simple prompts with only a few actions get a compact view. Source: user via ask_user, 2026-10-18 ("Fully unified, terminal too — we can have a minimilistic version of that when there are no needs of say somethng else like just 2 actions"). Rejected: keeping the menu overlay in the terminal and unifying only the data. Already half there: menus travel on the same `ask:pending` bus as `kind: "list"` (`plan3-web.ts:createDialogBridge`). Prompts from other extensions and from Pi itself arrive at the hub as plain select, confirm, input or editor, and the hub converts them into the same form. Night mode's answering policy is unchanged; only the format is shared.
- **D20 (Q-07) No herdr at all.** "Open in terminal" always opens a plain window (Windows Terminal when installed, otherwise a console window). User comment: "we make this not depend on herdr in any way or form, it is us + pi, that's all." This supersedes the herdr part of D1. On the user's question "I guess the hub will be started from terminal?": the hub starts by itself at Windows logon, hidden (H6-04), and the `pi-hub` command starts, stops or checks it from any terminal (H2-05).

## Open questions

### Blocking

None. Phase 1 can start; later phases use the Recommendations below until resolved.

### Deferred

None. All seven questions are resolved (D14 to D20).

## Relevant files and approach

ce-workflow (`C:\SOFT\git\ce-workflow`):
- `extensions/plan3-web.ts` (656 lines) and `extensions/plan3-web/` (`app.ts` 1045, `diagram.ts`, `layout.ts`, `files.ts`, `prompts.ts`, `stream.ts`, `pair.ts`, `pair.html`, `index.html`, `styles.css`, `vendor/`): the web server and app that move to the hub.
- Web features to keep (endpoints in `plan3-web.ts:196,259` and `plan3.ts` `readWeb`/`postWeb`): message, answer, comment, move, edit, generate, command, commands, stop, model, models, effort, bias, row, rows, dialog, diagram, files, file, diff, plans, usage, image, paste, events (SSE), sessions, seen. Plus: compact chat, final reply, research and night mode chips, plan actions (resolve, review, finish, resume, delete), push to talk, image thumbnails and viewer, light and dark themes, phone layout.
- `extensions/plan3-remote.ts` (192): share records, session records, device registry, `tailscale serve` helpers. Devices and Tailscale move to the hub; live session records are replaced by session lock files (D9).
- `extensions/plan3.ts`: the web glue (`getWeb`, `readWeb`, `postWeb`, `publishSession`, `approvePairing`, `manageDevices`, `/wo share`, auto re-share near lines 1024 and 2214, chat mirror and activity, subagent polling via `subagentRuns` in `plan3-web.ts:547`), plan reading (`summarize`, `listPlans`).
- `extensions/work-ask-remote.ts` (112): intercom forwarding of `ask:pending`; its web part goes, its intercom part stays.
- `extensions/ask-user/index.ts`: vendored ask_user; RPC fallback at 2524; sends `ask:pending`.
- `extensions/work-dialogs.ts`: all ce-workflow menus; non-terminal fallback at 304 and 678.
- `extensions/subscription-footer.ts`: usage reading (`claudePoolQuota` and friends), needed by the hub's usage popup.
- `extensions/plan3-diagram.ts`, `extensions/plan3-files.ts`, `extensions/plan3-design.ts`: diagram model and project file reading the hub reuses (Q-01).

pi-control-hub (`C:\SOFT\git\pi-control-hub`, only `README.md` and `.gitignore` so far; commit `6e1d4a6`): new TypeScript package run by Node 24 directly (type stripping), no build step. Planned files: `src/rpc.ts` (JSONL client), `src/sessions.ts` (registry and lifecycle), `src/server.ts` (HTTP, SSE, auth), `src/remote.ts` (devices, Tailscale), `src/terminal.ts`, `src/hub.ts` (entry and CLI), `web/` (the moved app), `scripts/test-*.mjs` and a fake Pi for tests.

Pi facts used (Pi 1.2.0, `C:\Users\Flex\.pi\agent\install\releases\1.2.0\node_modules\@earendil-works\pi-coding-agent`): `docs/rpc.md`, `docs/rpc-commands.md`, `docs/rpc-extension-ui.md`, `docs/sdk.md`, `dist/modes/rpc/rpc-types.d.ts`. RPC commands: prompt (images, steer, followUp), abort, get_state, get_messages, get_entries, set_model, set_thinking_level, compact, new_session, switch_session, fork, set_session_name, get_commands, get_session_stats. Extension UI over RPC: select, confirm, input, editor, notify, setStatus, setWidget, setTitle; `custom()` is unavailable. The `pi` launcher is `C:\Users\Flex\.pi\agent\bin\pi.cmd`.

## Commands

- ce-workflow web server: `node scripts/test-work-plan3-web.mjs`
- ce-workflow browser app: `node scripts/test-work-plan3-browser.mjs`
- ce-workflow record types: `node scripts/test-work-plan3-types.mjs`
- ce-workflow full suite, once before a push: `npm run verify:quiet`
- Hub tests: `npm test` in `C:\SOFT\git\pi-control-hub`, created in H2-01 (does not exist yet).

## Phases

### Phase 1: Prove RPC hosting [think]

- [x] **H1-01** RPC child works on Windows: node on pi-launcher.js (no shell) and pi.cmd via shell both start; prompt, events, get_messages, set_model/thinking, stdin-close exit (code 0, ~1.6–3.6 s) and --session resume verified.
- [x] **H1-02** Channel verified: 1 MB JSON (unicode, CRLF, U+2028, quotes) round-trips unchanged through editor prefill, input placeholder and setStatus; input with an AbortSignal resolves undefined and a late hub answer is ignored without error.
- [x] **H1-03** ce-workflow runs in RPC: /plan3, /wo, /research and ask_user work through plain select/input; breaks are flattened menus, ask_user's comment prompt, ANSI in status text (see Findings).
- [x] **H1-04** Findings F1–F10 recorded; D22 (assumed) moves the channel ask to input; H2-02/H5-02 notes added; no other decision changes.

### Phase 2: Hub core [code]

- [x] **H2-01** Hub package (type module, Node ≥24, `npm test` = node --test scripts/test-*.mjs) with scripts/fake-pi.mjs speaking RPC; committed d-hub H2-01.
- [x] **H2-02** src/rpc-client.ts RpcChild: node+launcher spawn, byte-level LF framing, id-correlated sends, ui/event emitters, ANSI-stripped status, cached model list, crash rejects pending, stdin-close stop with kill fallback.
- [x] **H2-03** src/registry.ts: atomic sessions.json registry (membership = star per D18, no separate field), folder groups, Recents scan (30 days, top-level files, header + latest session_info via byte search, cached), star/unstar keeps files.
- [x] **H2-04** src/sessions.ts SessionHost (create/resume/park/rename/restart/autoPark/shutdown/restoreRunning, busy reasons) and src/session-lock.ts (atomic wx lock, stale-pid takeover with move-aside, release only by owner after child exit).
- [x] **H2-05** src/hub.ts (single hub via hub.lock, fixed saved port + local key, key-guarded JSON API, busy-refused stop, D17 restore, auto-park timer) and src/cli.ts pi-hub start (detached, log to hub.log)/stop [--force]/restart/status/open.

### Phase 3: Hub channel in ce-workflow [think]

- [x] **H3-01** ce-workflow extensions/hub-channel.ts (ask via marker input + JSON placeholder, always publishes `closed`; publish via pi-hub:<kind> setStatus; inert without PI_HUB). Hub sessions.ts drops forms on `closed` and lists pendingDialogs for reconnects.
- [ ] **H3-06** Extend ask_user for menus: search box for long lists, current item marked, submenus where Esc goes back, checklists that toggle in place.
  - Also a multi-line text answer with pre-filled text (night mode rules), and the model picker's Tab switch between scoped and all models.
- [ ] **H3-07** Add ask_user's compact view for simple prompts with only a few actions and nothing else to say: one line in the terminal, a small card in the web.
- [ ] **H3-08** Move every work-dialogs.ts menu and confirm onto ask_user, delete the separate overlay, and point the AGENTS.md Dialog UX Rule at ask_user.
  - Every ce-workflow prompt, not only `work-dialogs.ts` users: direct `ctx.ui` calls in `plan3-night.ts:96` (editor), `work-models.ts:1014`, `:2711`, `:4301`, `:4513` and `jev-tools.ts:555` (confirm, input, editor). Re-check with a search before deleting.
  - Update `scripts/test-work-dialogs.mjs`, `scripts/test-work-ask-user.mjs`, `scripts/test-work-ask-remote.mjs` and the source list in `scripts/test-work-plan3-types.mjs` in this step, before the module goes.
- [ ] **H3-02** ask_user sends its full `ask:pending` payload through the channel and applies the answer; without the hub nothing changes.
  - Include several questions, comments, recommended options and image paths. The intercom path in `work-ask-remote.ts` stays.
- [ ] **H3-03** Every ask_user prompt, menus included (D21), goes through the channel; answers and Esc-back come back the same way.
  - Include TUI-only offers that should also reach hub sessions: "Compact before sending?" returns early outside the terminal today (`work-models.ts:offerColdCacheCompact`).
- [ ] **H3-04** Publish what only Pi knows: subagent runs, current plan and phase bias, research and night mode, compaction.
- [ ] **H3-09** Hub-to-Pi calls: a hidden `/pi-hub <json>` command (only with PI_HUB) runs plan commands on a chosen plan, bias and Generate; results come back by id.
  - Today `/api/command` passes the browser's selected plan separately (`plan3.ts` around line 845); a typed `/plan3 review` would use the session's current plan instead. Bias and Generate call internal functions.
  - Inputs validated against a fixed list of operations; no model turn unless the operation itself starts one. Test: plan B chosen in the browser while the session's current plan is A, and an error coming back to the browser.
- [ ] **H3-10** Night mode after a hub restart: a restarted session with night mode on and not paused or complete starts its next turn once, keeping retry backoff.
  - `night.restore()` only restores flags, banner and keep-awake (`plan3-night.ts` around line 181), and the retry timer dies with the process. The hub marks restarts with `PI_HUB_RESTARTED=1`.
  - Test: restart after an interrupted turn and during retry backoff; paused and complete night sessions stay quiet; no double continuation.
- [ ] **H3-05** With `PI_HUB=1`, ce-workflow starts no web server and no automatic re-share; every Pi takes the session lock at start (D9).
  - Check: `node scripts/test-work-plan3-web.mjs` and `node scripts/test-work-plan3-types.mjs`, plus a channel test with a stubbed UI.

### Phase 4: Shared modules [code]

- [ ] **H4-01** Make the code the hub reuses importable without Pi, per D14: plan reading out of `plan3.ts`, diagram model, project files, usage reader.
  - No behaviour change in ce-workflow; its existing tests must pass unchanged.
  - Diagram saves must lock across processes: `withPlanDesignLock` (`plan3-design.ts`) is only an in-memory queue, so the hub and a Pi could both accept the same revision. Wrap the revision check and write in a lock file; test two processes saving at once.

### Phase 5: Hub web server and app [code]

- [ ] **H5-01** Move the browser app into `web/` and serve it from the hub under `/s/<session>/` with relative URLs.
- [ ] **H5-02** Session view: chat history from the hub's buffer and `get_messages`, live SSE from RPC events, paging and reconnect as today.
  - Older chat than the last compaction comes from the session JSONL, read-only (F3); never forward the stored system message (F4).
- [ ] **H5-03** Map every endpoint in the inventory to RPC commands, the hub channel or the shared modules; keep the request checks and size limits.
  - Write the mapping as a table in Findings first: each endpoint, what serves it (RPC command, hub call from H3-09, shared module or hub-only), and its test.
- [ ] **H5-04** One form for every prompt (D21): draw ask_user data, including menus and the compact view; convert plain RPC dialogs into it.
  - Move `prompts.ts` logic; keep image paste, comments and the first-answer-wins rule.
- [ ] **H5-05** Session list grouped by folder with state colours, New, Rename, Park, Resume, Reload, and keyboard shortcuts in the web (D5).
  - Recents group closed by default, with Star and Unstar (D18). Page title: folder, session name and current plan (no herdr tab name).
  - Reuse the existing switcher and its colours: orange working, red waiting, blue unseen idle, grey seen idle.
- [ ] **H5-06** Port the browser test to the hub against the fake Pi; it covers every inventory feature, not only the new ones.

### Phase 6: Remote access [code]

- [ ] **H6-01** Move devices, pairing and `tailscale serve` into the hub: one port, Tailscale login check, never Funnel.
- [ ] **H6-02** Import existing paired devices from `<agent dir>/ce-workflow/remote/devices.json` so the phone stays paired.
- [ ] **H6-03** Device approval on the local hub page (D19), and revoking devices from the hub page.
- [ ] **H6-04** Start the hub at Windows logon (scheduled task or Startup entry), hidden, with a log file.

### Phase 7: Open in terminal [code]

- [ ] **H7-01** "Open in terminal": park, open `pi --session <file>` in a plain window (D20), mark the session as in terminal, take it back when that Pi exits.
  - The hub keeps the session lock during the handoff (D9) and watches the Pi process itself, not the window launcher.

### Phase 8: Live acceptance [think]

- [ ] **H8-01** Run the hub for real on this PC with three folders and several sessions; fix what fails, including the night mode case.
  - Include a hub restart with a night mode session working (H3-10).
- [human] **H8-02** User tries it on the phone and desktop: pairing, New, Rename, Park, Resume, forms, menus, Open in terminal.

### Phase 9: Remove the remote code from ce-workflow [code]

- [ ] **H9-01** Delete ce-workflow's web server and app, `/wo share`, pairing, devices, Tailscale, share status, chat mirror and web dialog relay.
  - Also the herdr tab lookup used only for the web title (`plan3.ts:refreshHerdrTab`).
  - First list every import, command, test, fixture and README section; keep the hub channel, the session lock and intercom ask.
- [ ] **H9-02** Update both READMEs, bump the ce-workflow version, and run `npm run verify:quiet` and the hub's `npm test`.
### P-ARCH [code] Product architecture

- [ ] **ARCH-RECONCILE** Reconcile the product architecture diagram with this plan's actual changes.
  - Compare actual code and git history; update through plan3_diagram target product, or mark done with no architecture change.
  - Changed plan elements: none flagged; inspect actual implementation.


## Backlog

- Linux support for the hub (the friend's machine): launch, autostart and terminal opening.
- Sessions on other machines.
- Camera consent through the hub page, if camera use in hub sessions is ever wanted.

## Global validation

- Every feature in the inventory works through the hub for at least two sessions in two folders, on desktop and phone.
- Park, Resume, Reload and automatic parking never lose a finished exchange and never modify a session file themselves.
- A session file is never open in the hub and a terminal at once.
- Without the hub, a terminal Pi with ce-workflow behaves as before Phase 9, and after Phase 9 has no network listener.
- Only paired devices with the right Tailscale login reach the hub remotely; revoked devices are refused at once.
- Hub tests and ce-workflow targeted tests pass after each change; `npm run verify:quiet` once before any push.

## Findings

Phase 1 (2026-10-18, Pi 1.2.0, Node 24.14; scratch scripts in `%TEMP%\pi-hub-h1\rpc1.mjs` to `rpc4.mjs`, not kept in either repo):
- F1 Launch: `node <agent dir>/bin/pi-launcher.js --mode rpc ...` with no shell works and is what the hub uses. `pi.cmd` through a shell also works but Node warns (DEP0190) and arguments are not escaped.
- F2 Stop: closing stdin exits with code 0 in 1.6 to 3.6 s; the session file then holds the last exchange, and `--session <file>` resumes it with the same messages and file.
- F3 History: `get_messages` returns only the context after the last compaction (a 29 MB session gave 23 messages, 168 KB, in 4 ms; start-up to `get_state` took 2.2 s). Older chat must be read from the session JSONL, read-only.
- F4 Every session stores a "system" message of about 78 KB, which also arrives in `message_start`/`message_end`. The hub must not forward it to browsers.
- F5 `get_available_models` is 250 KB (415 models): fetch once per child and cache. `set_model` changed the thinking level (to high), so the hub reads `get_state` after a model change.
- F6 The RPC response to an extension command (`/plan3`, `/wo`) arrives only after its handler finishes, which can be minutes when it waits for a dialog. The hub never waits on it in order.
- F7 Channel: 1 MB of JSON with Unicode, CRLF, U+2028 and quotes round-trips unchanged through `editor` prefill, `input` placeholder and `setStatus` text.
- F8 `input`, `select` and `confirm` accept a signal and timeout and remove their pending request inside Pi on abort; `editor` cannot (`rpc-mode.js` `createDialogPromise`). A late hub answer to an aborted request is ignored without error. Pi does not tell the hub that a request was dropped.
- F9 ce-workflow in RPC: `/plan3`, `/wo` and `/research` run. `/wo` arrives as one `select` whose options are strings like "● Settings — description", so structure is lost (fixed by D21 and H3-03). ask_user arrives as `select` followed by an "Optional comment" `input`, and cancelling that input cancels the whole answer. Status texts can carry ANSI colour codes (ponytail). Start-up sends 53 `setStatus`, 18 `setWidget` and 6 `notify`.
- F10 D7 stands: the hub's own JSONL client was about 40 lines in the scratch scripts and must answer `extension_ui_request` itself.

## Resume context

Active, 10/36. Phase 2 is done and H3-01 is done. Hub HEAD 4870c41, npm test 5 pass. ce-workflow e54de1e adds extensions/hub-channel.ts plus test-work-hub-channel.mjs; nothing is wired yet. Next: H3-06, ask_user menu features (search box, current item marked, submenus with Esc back, checklists that toggle in place) in extensions/ask-user/. After that H3-07 adds the compact view and H3-08 moves work-dialogs onto ask_user, which needs the user's live terminal check. No blockers.

## Amendments

- 2026-10-18: Added H3-06 to H3-08 and reworded H3-03 and H5-04 for D21 (every prompt is ask_user, terminal included).
- 2026-10-18: Resolved Q-01 to Q-07 as D14 to D20. D20 removes herdr entirely, superseding the herdr part of D1. D18 adds the Recents group with Star and Unstar. D16 corrects the cache lifetime from about an hour to 5 minutes. H3-03 now also covers the terminal-only "Compact before sending?" offer.
- 2026-10-18: Added H3-06, H3-07, H3-08 after H3-01: User decision D21: every prompt is an ask_user question, in the terminal too, with a compact view for simple prompts.
- 2026-10-18: Added H3-09, H3-10 after H3-04: Review findings 4 and 6: the hub needs a defined way to call extension operations, and night.restore() only restores flags, so a restarted night session would sit idle.
- 2026-10-18 Phase 1: findings F1 to F10; D22 switches the channel's ask from `editor` to `input`; H2-02 and H5-02 got notes from F1, F3 to F6 and F9.
- 2026-10-18 review (plan3-advisor, GPT-6 Astra; each finding checked against the code):
  - Finding 1, session ownership: accepted. Records in `plan3-remote.ts` are advisory and Pi loads the file before extensions run. D9 now uses an atomic lock file held by the hub until child exit; H2-04 tests races and stale locks; the `--no-extensions` limit is documented.
  - Finding 2, diagram write lock: accepted. `withPlanDesignLock` is an in-memory promise map. H4-01 adds a cross-process lock and a two-process test.
  - Finding 3, editor cancellation: accepted. RPC `editor` has no cancel or timeout. H3-01 adds a `closed` message and a drain response, with tests.
  - Finding 4, hub-to-Pi calls: accepted. `/api/command` passes the selected plan separately. Added H3-09 (hidden `/pi-hub` command) and a mapping table in H5-03.
  - Finding 5, prompts outside work-dialogs: accepted. Direct `ctx.ui` calls exist in `plan3-night.ts`, `work-models.ts` and `jev-tools.ts`. H3-08 lists them and the tests to update; H3-06 adds multi-line text and the model picker's scope switch.
  - Finding 6, night mode after restart: accepted. `night.restore()` does not start a turn. Added H3-10 and a restart case in H8-01.
- 2026-10-18: Added final architecture reconciliation because a product diagram exists.
