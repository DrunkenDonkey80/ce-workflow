---
plan3: true
status: ready
created: 2026-10-14
updated: 2026-10-14T12:32:41.434Z
reviewed: 2026-10-14
started: 2026-10-14T10:47:38.068Z
---

# Browser remote for a Pi session: chat-first web workspace with diagram panel and Tailscale access

## Original request

> we have this uml thingy (still touching) but it is becoming fast a FULL BLOWN web interface for a specific pi session!! this is untapped possibility here and very good one and UML should be addition to it, not the base. lets work on that idea here - to enable specific pi session to be 'visible' in browser, that means after reload to survive and not need commands, basically a pi remote copy. the right part is the chat interface, the left is the uml/diagram/project files. left part can be collapsed either to the current chat width so chat expands or fully just a >> arrow to be left from it so chat takes all the width. the big things that we need to brainstorm - if I add tailscale will I be able to authorize a session and instead view it via mobile/remote browser? that is big thing and will allow me remote work. ofc wont be able to survie pi restart, but /reload is good enough. can you think about that

## Goal, requirements, and non-goals

Goal: one Pi session can be shared as a browser remote. Chat is the base and the diagram is one tab beside it. The page survives /reload without any command and can be opened from the user's phone over Tailscale after a one-time device approval.

Builds on plan 0899f7c0 (architecture workspace, `extensions/plan3-web.ts`). That plan's v1 non-goal "No multi-user or remote access" is superseded here for the owner's own devices only.

Requirements:
- **R1** Session sharing: a command shares the current session. The browser page is session-wide: chat on the right, left tabs for Files and Diagram (D2).
- **R2** Survives /reload: same port, same link; the open page reconnects by itself, reloads its own code when the extension build changed, and needs no command (D3).
- **R3** Resuming a shared session after a full Pi restart re-shares it automatically until sharing is turned off (D3).
- **R4** A conspicuous `[SHARED]` marker in Pi's footer status while sharing is on (D3).
- **R5** Remote access over `tailscale serve` (HTTPS, tailnet only), managed by ce-workflow; never Funnel (D1).
- **R6** Remote requests must come from the owner's Tailscale login and a paired device. The phone opens a short link, sees a matching code, and the terminal approves it; approval sets a long-lived HttpOnly Secure cookie (D1, D4).
- **R7** Left panel collapse, from the original request: full split, narrowed to the chat pane's width so chat widens, or fully collapsed to a `>>` arrow so chat takes the whole width.
- **R8** Files tab (D2): project tree with ignored and secret-shaped files hidden and changed files marked; read-only content view, or the git diff for changed files.
- **R9** Mobile layout (D2): tabs Chat, Files and Diagram; Files shows the tree above the content or diff.
- **R10** Chat parity: plain messages go to the session as typed; mentions and notes add diagram context only when used. Browser messages may start with an extension slash command (D17).
- **R11** The browser shows when Pi waits on a terminal-only dialog, using `ui_prompt_start` and `ui_prompt_end`, so a remote user knows the agent is blocked; the page never stalls on it (D17).
- **R12** Session switcher across every shared session on the PC, with colour-coded state; pair a device once per PC (D18).
- **R13** Chat status line: model and effort picker, plan line with the plan menu or New plan (D19).
- **R14** Check-in use: a page opened mid-work shows the last few messages and any waiting question quickly, within a small byte budget, and a long-open page never receives old history again (D20).

Non-goals:
- No file editing from the browser; the Files tab is read-only.
- No typed Pi built-in commands from the browser (`/model`, `/reload`, `/compact`); model and effort change through the status line instead (D19). `pi.sendUserMessage` runs only extension commands (agent-session.js prompt, lines 1522–1529).
- Other extensions' terminal dialogs cannot be answered remotely: Pi exposes only `ui_prompt_start` and `ui_prompt_end` notifications. Camera consent and device pairing are deliberately terminal-only.
- No Tailscale Funnel or public exposure; no other users; no QR code (D4).
- No survival across a Pi crash without resume; a full restart only re-shares when the session is resumed (R3).

Acceptance examples:
- **E1** `/wo share` in a session, then `/reload`: the open desktop tab shows "Pi is reloading…", reconnects within seconds on the same URL, and shows the full recent chat with no command typed.
- **E2** From the phone on the tailnet, open `https://flexpc.tailaee9f8.ts.net:<port>`. The page shows a code; the terminal asks "Approve device … showing <code>?"; after Yes the phone shows the chat, and sending "what are you doing?" reaches the session.
- **E3** Quit Pi, start it again and resume that session: `[SHARED]` is back in the footer and the phone's bookmark works without pairing again.
- **E4** Desktop: click `>>` to collapse the left panel; chat fills the width. Files tab: a modified file is marked and opens as a diff; `.env` does not appear.
- **E5** Phone: tabs Chat, Files and Diagram; Files shows the tree above the viewer; the composer stays usable with the on-screen keyboard.
- **E7** With two sessions shared (two projects), the phone pairs once; the switcher stripe shows one orange (working) and one blue (idle, unseen) letter, and tapping switches without pairing again.
- **E8** From the phone status line, switch to another scoped model and effort, then open the plan line and run Review; with no plan, New plan starts `/plan3 <request>`.
- **E9** Lock the phone during a long run, unlock it while the agent waits on ask_user: within about 2 s the page shows the last messages and the question, answering works, and the reconnect data (not cached assets) is under 100 KB.
- **E6** A request through the tailnet from another Tailscale login, or from an unpaired device, never reaches chat, files or session data.

## Decisions

- **D1** 2026-10-14 — Remote access: ce-workflow runs `tailscale serve --bg` (HTTPS, tailnet only, never Funnel) for a shared session and removes the mapping when sharing stops or Pi quits. A remote request needs the session token, must carry the owner's `Tailscale-User-Login`, and the device must be paired: the first time a new device opens the link, the terminal asks the user to approve it, and the device then gets a long-lived cookie. Rationale: limits the damage if the link leaks; accepted cost: a new device can only be paired while the user is at the PC. Source: user via ask_user ("Serve + one-time pairing approval").
- **D2** 2026-10-14 — Layout is tabs. Desktop: chat stays on the right; the left side has tabs, first **Files** (a project tree with ignored and secret-shaped files hidden and changed files marked, plus a content or diff viewer to its right, so the screen becomes a three-way split), then **Diagram** when a diagram exists. Mobile: three tabs, Chat, Files and Diagram; Files shows the tree on top and the content or diff below. Files are read-only (no editing was requested). Source: user via ask_user (custom answer).
- **D3** 2026-10-14 — Sharing is per session and keeps the same port, link and paired devices for that session. It survives /reload with no commands, and resuming a shared session after a full Pi restart re-shares it automatically until the user turns sharing off. While shared, the footer status shows a conspicuous `[SHARED]` marker. Source: user via ask_user ("Yes, resume re-shares automatically — with a nice FAT [SHARED] note in the status").
- **D4** 2026-10-14 — First link from a phone: the remote link is the short address (`https://<machine>.<tailnet>.ts.net:<port>`), with no token. An unpaired device sees a pairing page with a short matching code; the terminal asks the user to approve that device and code, and approval sets a long-lived HttpOnly Secure cookie that replaces the token for that device. Local desktop links keep the token. No QR code and no new dependency. This refines D1's token requirement for remote devices; tailnet-only access, the owner login check and terminal approval remain. Source: user via ask_user ("Short link + matching-code approval").
- **D5** 2026-10-14 (assumed, reversible) — Command `/remote on|off|status|devices`; `/share` is a Pi built-in (docs/slash-commands.md line 39). `/remote on` shares locally and adds Tailscale when available. When Tailscale is missing or HTTPS certificates are off, local sharing still works and the reply names the missing step. `/plan3 diagram` and `/plan3 architecture` open the same shared page on the Diagram tab (Q-03).
- **D6** 2026-10-14 (assumed, near-certain from the session-export risk) — Secrets never go into the session file, because Pi's `/share` uploads sessions. The session gets only a custom entry `{ shared: true }` (it follows the session, so resume re-shares, D3). Port, token and paired-device cookie hashes live in a user-only file under `~/.pi/agent/ce-workflow/remote/<sessionId>.json`.
- **D7** 2026-10-14 (assumed, reversible) — Port: the first share asks the OS for a free port and saves it; later shares reuse it. If it is taken, pick a new one, update the Tailscale mapping and tell the user the link changed. Tailscale's HTTPS port equals the local port. On reload, listen retries briefly while the old runtime releases the port.
- **D8** 2026-10-14 (from Tailscale source `ipn/ipnlocal/serve.go`) — Serve keeps the incoming Host (`<machine>.<tailnet>.ts.net:<port>`), sets `X-Forwarded-Host`, `X-Forwarded-Proto` and `X-Forwarded-For`, and adds `Tailscale-User-Login` after stripping forged copies. Identity headers are absent for tagged devices and Funnel. Request mode therefore follows the Host: `127.0.0.1:<port>` uses the token, the tailnet hostname uses owner login plus device cookie, and anything else is rejected. Owner login comes from `tailscale status --json` (Self.UserID → User[...].LoginName). Local processes are inside the trust boundary, since they can read the token file anyway.
- **D9** 2026-10-14 (assumed, security requirement) — The pairing dialog and camera consent are never mirrored to the browser dialog bridge, so a remote page cannot approve itself. Pairing needs a terminal UI; without one (print or RPC mode), remote pairing is refused.
- **D10** 2026-10-14 (frontend-design, `skills/frontend-design/SKILL.md`) — Not a new visual direction: reuse plan 0899f7c0 D24 and D25 tokens (white canvas, ink #1e1e1e, focus #1971c2, chat #f8f9fa, system-ui 13/15/18 px, one 6 px radius, no shadows). The diagram stays the only hand-drawn element. Files and diff use the system monospace stack for code only; diff added #b2f2bb and removed #ffc9c9 (D24 fills). `[SHARED]` uses the camera warning's red treatment so it reads as exposure.
- **D11** 2026-10-14 (assumed, reversible) — Files data: tree from `git ls-files --cached --others --exclude-standard` (honours .gitignore), with a bounded walk outside git. Hidden paths use the jev-tools sensitive-path filter (`forbiddenPath`, exported for reuse). Content uses `captureSource` from `extensions/jev-tools.ts` (bounded, contained, no binary or secret-shaped content). Changed marks come from `git status --porcelain=v1 -z`; diff from `git diff -- <path>`. The tree refreshes after write, edit and bash tool runs and on tab focus; no file watcher.
- **D12** 2026-10-14 (from code, assumed for reload) — After reload the server binds to the `session_start` ExtensionContext instead of a stored command context. The plan3 handlers use no command-only ctx methods (grep for waitForIdle, newSession, fork, navigateTree, switchSession and reload found none). Browser plan buttons and typed slash commands go through `pi.sendUserMessage(text, { expandPromptTemplates: true })`, which runs extension commands with a real command context. P1-02 verifies this live.
- **Q-01** How long should a paired device stay paired?
  - Context: D1 and D4 say "long-lived cookie" without a length. The cookie is the remote credential, on top of tailnet-only access and the owner login. Every device stays revocable with `/remote devices`.
  - Recommendation: 90 days, extended on each use, so a phone in daily use never re-pairs and a lost device expires on its own.
  - Option: 90 days, extended on use — Recommended balance.
  - Option: Until revoked — Never expires; depends on remembering to revoke.
  - Option: 30 days fixed — Re-pair monthly, even when in use.
  - Independent: yes
  - Answer: {"kind":"selection","selections":["90 days, extended on use"]}
  - Source: user via ask_user /plan3 resolve; not independently verified.
- **Q-02** May browser messages run extension slash commands (`/plan3 finish`, `/resume3`, `/wo …`)?
  - Context: `pi.sendUserMessage` with `expandPromptTemplates: true` runs extension commands as if typed (agent-session.js 1522–1529). Built-ins such as `/model` and `/reload` cannot run this way. A command that opens a terminal-only dialog would wait at the PC; R11 shows that in the browser.
  - Recommendation: Yes. A remote copy of Pi should accept the same extension commands; the paired owner is the only remote user.
  - Option: Yes, extension commands — Full parity except built-ins.
  - Option: Only the plan buttons — Typed `/…` is sent to the agent as plain text.
  - Independent: yes
  - Answer: {"kind":"freeform","text":"we replaced ask_user extension with outs, not in this session I guess /reload is needed, but defailt pi-as-user is gone and ours is active where we can do anything we want including rerouting prompts to the web chat/tailscale and allow answer from multiple places - other sessions, direct, web, etc, does that change the question?"}
  - Source: user via ask_user /plan3 resolve; not independently verified.
- **Q-03** Should `/plan3 diagram` turn on sharing that survives reload and resume, like `/remote on` without Tailscale?
  - Context: today `/plan3 diagram` opens a temporary local page that dies on reload. One sharing state is less code; but under D3 resume re-shares, so a quick diagram look would keep the session shared until `/remote off`.
  - Recommendation: Yes, local only. It shows `[SHARED]`, never adds Tailscale (only `/remote on` does), and `/remote off` ends it.
  - Option: Yes, local sharing — One state, survives reload, visible marker.
  - Option: No, temporary page — Diagram page dies on reload unless `/remote on` was used.
  - Independent: yes
  - Answer: {"kind":"selection","selections":["Yes, local sharing"],"comment":"diagram is okay to turn it on but really we gotta add a /wo share that toggles on/off per session. we can have several chat sessions in same folder, what do we do with them like I have 3 here, how to handle?"}
  - Source: user via ask_user /plan3 resolve; not independently verified.
- **D13** 2026-10-14 — Q-01 settled: a paired device stays paired for 90 days, extended on each use; revocable any time. Source: user via /plan3 resolve.
- **D14** 2026-10-14 — Q-03 settled: `/plan3 diagram` and `/plan3 architecture` turn on local sharing (survives reload and resume, shows `[SHARED]`, never adds Tailscale). Source: user via /plan3 resolve.
- **D15** 2026-10-14 — Supersedes D5's command name: sharing is toggled per session with `/wo share` (on or off for the current session), as the user asked in the Q-03 comment; `/wo share devices` lists and revokes paired devices; the `/wo` utilities menu shows a Share row with the current state. No separate `/remote` command. Turning sharing on adds Tailscale when available, as D5 described. Source: user comment on Q-03 ("we gotta add a /wo share that toggles on/off per session").
- **D16** 2026-10-14 (from repo state) — Answer to the Q-02 comment: ce-workflow's vendored ask_user (`extensions/ask-user/`, `remote.ts` emits `ask:pending` and accepts `ask:answer`) is active and the global `pi-ask-user` package is loaded with no extensions (`~/.pi/agent/settings.json`). The workspace dialog bridge already races browser answers against the terminal for ask_user and Plan3 list dialogs (plan 0899f7c0 P4-03), so those prompts are answerable from the phone with no new work; intercom answers from other sessions keep working. Dialogs from other extensions (`ctx.ui.select`, `confirm`, `input`) still cannot be rerouted, so R11 stays. This is a separate path from typed slash commands, which Q-02 asks about.
- **D17** 2026-10-14 — Q-02 settled: typed extension slash commands in the browser chat run as if typed in the terminal; built-ins reply "terminal only". The HTTP handler never awaits a command or the run it starts. When a command opens a terminal-only dialog, the page shows R11's waiting banner and stays usable (Stop, plan menu, session switcher). Plan3 and ask_user dialogs stay answerable from the page through the bridge. Source: user via ask_user ("make sure to not stall the thing waiting for native command and everything is blocked").
- **D18** 2026-10-14 — Several sessions: each shared session keeps its own server, port and link (D3), across every project on the PC. Pairing is per PC, not per session: one machine-wide device registry (`~/.pi/agent/ce-workflow/remote/devices.json`, cookie hashes, D13 expiry), and browsers send the cookie to every port of the host. A session switcher lists every live shared session on the PC: closed by default on mobile and desktop, a slide-out menu with the full list, and a thin stripe when closed. The stripe shows each session's first letter, colour coded: orange working, red waiting on ask_user or a dialog, blue idle with activity not yet seen on this device, light gray idle and seen. Each session publishes name, cwd, port and state to its record file; the page reads the list through its own server, skipping records whose pid is gone. "Seen" is kept per device in browser storage. Source: user via ask_user ("Per-session links, shared pairing, session switcher" plus comment).
- **D19** 2026-10-14 — Chat-section status line, compact by default and expandable. Line 1 shows the current model and effort. Clicking it opens a picker with the scoped models first and an effort picker, applied with `pi.setModel` and `pi.setThinkingLevel` (types.d.ts lines 1274 and 1281) to the same session. Line 2 shows the current plan (title, progress); clicking it opens the plan menu: resolve, ideas, review, finish, start or continue work, switch plan, new plan. With no plan, line 2 shows only New plan, which asks for the request and runs `/plan3 <request>`. The expanded view adds context use and `[SHARED]`. This replaces P4-05's status strip and the top-bar plan buttons. Source: user via ask_user comment on Q-02.
- **D20** 2026-10-14 — Check-in use and traffic budget (user: the phone may be off and connect mid-work; it should start from the last few messages and any waiting ask_user, and a long-connected page must not receive megabytes of old messages). Facts from `extensions/plan3-web.ts`: each (re)connect sends a full snapshot with up to 100 chat rows or 512 KB, plus an activity snapshot with up to 50 tools or 512 KB, up to 64 KB of thinking and the queue. `message_update` republishes the whole row on every token delta (createChatMirror `put`). The activity mirror republishes its whole snapshot on every tool event and thinking delta. A long reply therefore costs roughly the square of its length in bytes, and every phone wake-up costs up to about 1.5 MB. Decision:
  - Check-in snapshot: the last 20 chat rows, with thinking and tool blocks as one-line titles (body fetched on expand). It also carries pending dialogs (ask_user first), the terminal-dialog waiting banner, working or idle state and running tools only. Budget 64 KB. "Show earlier" pages back through the rows the server keeps (100).
  - Live stream: text arrives as appended deltas, and updates are coalesced to at most 4 per second per row. Activity sends only the changed tool row; thinking sends a delta or a title only.
  - The page keeps its existing 100-row DOM cap.
  - Cheap cues: a waiting ask_user sets the page title to "(!) <session> needs an answer", and the D18 switcher shows red.
  - Phone push notifications are in the Backlog (not vital, per the user).
  Source: user request in chat; numbers assumed and reversible.
- **D21** 2026-10-14 (plan review, each finding checked against code) — Corrections to D11, D18 and D20. All of them are needed to meet decisions already recorded, so none widens the scope:
  - **Diff safety and semantics (refines D11):** the diff for a changed file is `git diff HEAD -- <path>`, covering staged and unstaged changes together, including deletions and renames. Untracked files show their content. An unborn repository (no HEAD) shows content. The returned diff text itself passes the same `secret` pattern, binary and size bounds as `captureSource`, so a removed secret line is never shown. Paths are validated without requiring the working file to exist.
  - **Browser authentication (refines D4 and D8):** every fetch, asset and event-stream request authenticates per mode. Local mode keeps the explicit token. Remote mode uses the same-origin cookie, with no token in URLs, assets or the page. Today `app.ts` sends `credentials: "omit"` in 3 places and assets embed `__TOKEN__`; both must change.
  - **Cross-process device registry (refines D18):** `devices.json` is read and written only under a cross-process lock file with atomic replace, the pattern in `extensions/work-camera-state.ts` (openSync `wx` lock, temp file and rename, bounded wait with stale-lock detection). Corrupt state fails closed (no remote access) with a clear terminal message. `withPlanDesignLock` is in-process only and is not used for it.
  - **Revocation reaches open streams:** each event stream is tagged with its device id. Every session server re-reads the registry when it changes (checked at least every 2 s) and closes revoked or expired streams within 5 s, including queued frames.
  - **Seen state (refines D18):** browser storage is per origin, and every session has its own port, so "seen" is kept server-side. Each session record stores, per device id, the last revision that device viewed; pages post it when they show the latest row, and the switcher reads it through the authenticated server.
  - **Budget scope (refines D20):** 64 KB is the total encoded snapshot. The diagram is no longer in the snapshot; it loads when the Diagram tab opens. Each row carries a text excerpt of at most 2 KB, with the full text on expand. A pending dialog over 16 KB is sent as its title and options, with the full body fetched. E9's 100 KB counts reconnect data only. Assets become cacheable under build-fingerprint URLs, instead of today's `Cache-Control: no-store` for everything.
  - **Delta boundary (refines D20):** each row carries a revision (its text length). A delta is `{ id, offset, text }`. The page applies a delta only when offset equals its current length, ignores older ones, and refetches the row on a gap. This prevents duplicate text from events buffered during snapshot construction (`plan3-web.ts` lines 111–124).
  - **Lifecycle events:** Pi 1.1.0 has no `session_switch` event (absent from types.d.ts); replacement arrives as `session_shutdown` and `session_start` with reasons new, resume and fork. The existing `session_switch` handler (`plan3.ts` line 1975) and its test (`test-work-plan3.mjs` line 1282) are dead, and the lifecycle is rebuilt on those reasons. Old links must not reach a replacement conversation, except the same shared session resumed (D3).
- **D22** 2026-10-14 (P1-03; assumed, reversible) — Session API and pairing protocol. One server per shared session; `target` is optional everywhere and defaults to the current plan, else product.
  - **Assets:** `GET /` (index.html, `no-store`) and `GET /a/<build>/<file>` (`Cache-Control: immutable`, one year). `<build>` is the first 12 hex characters of the sha256 over the `plan3-web/` assets plus `plan3-web.ts`. Remote assets never contain the token; local index.html keeps it, as today.
  - **Reads:** `/api/snapshot` (D20/D21 check-in packet: `build`, session `{id,name,cwd}`, the last 20 row excerpts with revisions, running tools, dialogs, terminal-dialog waiting state, status `{model, effort, plan}`); `/api/events` (SSE: a `hello {build}` frame, then a snapshot, then deltas); `/api/row?id=` (full row); `/api/rows?before=<id>` (Show earlier, 20 per page); `/api/diagram?target=`; `/api/files`, `/api/file?path=`, `/api/diff?path=`; `/api/sessions`; `/api/models`.
  - **Writes (JSON POST):** `/api/message {text, comments?, target?}`; text starting with `/` goes through `pi.sendUserMessage(text, { expandPromptTemplates: true })`, never awaited (P1-02). Also `/api/answer`, `/api/comment`, `/api/move`, `/api/stop`, `/api/paste`, `/api/seen {revision}`, `/api/model {provider, id}` and `/api/effort {level}`. `/api/command` is removed: plan-menu buttons send `/plan3 <command>` through `/api/message`, so they no longer need a stored command ctx (D12).
  - **Pairing:**
    - **Start:** a remote request without a valid device cookie gets only the static pairing page. `POST /pair/start` creates a pending pairing `{id, code}` with a 6-digit code shown as `482 913`, valid for 2 minutes. There is one pending pairing per server and at most 5 starts per 10 minutes; anything more returns 429.
    - **Approval:** the terminal shows `Approve device <user-agent summary> at <X-Forwarded-For> showing <code>?` through serialUI (D9). There is no terminal UI in print or RPC mode, so the pairing is refused there.
    - **Cookie:** the page long-polls `GET /pair/status?id=`. On approval the response sets `pi_remote=<deviceId>.<secret>` (`HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age` 90 days, host-only so every port shares it). The registry stores sha256(secret), deviceId, label, owner login, created, lastUsed and expires.
    - **Sliding expiry (D13):** expiry renews at most once per hour per device, to limit registry writes.
  - **Remote mode test (D8):** Host equals `<dns>:<port>`, `X-Forwarded-Proto` is `https`, and `Tailscale-User-Login` equals the owner login from `tailscale status --json` and the device record. Origin must be `https://<dns>:<port>`.









## Open questions

### Blocking

None.

### Deferred

None.

## Relevant files and approach

Prerequisite: plan 0899f7c0 is active with only P7-01 left. Another session still has uncommitted edits in `extensions/plan3-web*`, `extensions/plan3.ts`, `extensions/plan3-diagram.ts` and their tests. Execution starts only after those are committed (P1-01).

Existing code to reuse:
- `extensions/plan3-web.ts` — `createPlan3Web` (token, Host and Origin checks, CSP, SSE with snapshot fence, `/api/paste`), `createChatMirror`, `createDialogBridge`, `createActivityMirror`, `forwardDiagramChat`.
- `extensions/plan3.ts` — `getWeb`, `postWeb`, `openDiagram`, `closeWeb`, `session_start` and `session_shutdown` handlers (the `session_switch` handler is dead, D21), `serialUI` and `waitForUser` for the pairing dialog, `refresh` for footer status.
- `extensions/plan3-web/` — `index.html`, `app.ts`, `styles.css`, `diagram.ts`, `prompts.ts`.
- `extensions/jev-tools.ts` — `captureSource`, the `secret` pattern and `forbiddenPath`.
- `extensions/work-camera*.ts` — red warning status style for `[SHARED]`.
- Pi 1.1.0 APIs: `session_start` and `session_shutdown` reasons (`reload`, `resume`, `quit`), `ui_prompt_start` and `ui_prompt_end`, `pi.appendEntry`, `ctx.sessionManager.getSessionId()`.

New files:
- `extensions/plan3-remote.ts` — share record (D6), port policy (D7), Tailscale detection and serve management (D1, D8), machine-wide device registry and cookies (D4, D13, D18), session list for the switcher (D18), `/wo share` helpers (D15).
- `extensions/plan3-web/files.ts` — browser Files tab (tree, viewer, diff).
- `extensions/work-models.ts` — `/wo` command and menu gain `share` (D15); scoped-model ordering reused for the browser model picker (D19).

Approach: the server stops being target-centric. The snapshot and event stream become session-wide, and the diagram target becomes a tab parameter. Each request is classified by Host into local mode (token) or remote mode (owner login plus device cookie), otherwise rejected. Sharing state lives in the session entry plus the user-only record; `session_start` (startup, resume, reload) re-shares when the entry says so. `session_shutdown` closes the server, and also removes the Tailscale mapping when the reason is not reload. The page treats a dropped stream as "Pi is reloading", retries, compares the build fingerprint in the snapshot and reloads itself when the code changed.

## Phases

Commands (existing; referenced by steps):
- **C-WEB** `node scripts/test-work-plan3-web.mjs`
- **C-BROWSER** `node scripts/test-work-plan3-browser.mjs` (headless agent-browser)
- **C-PLAN3** `node scripts/test-work-plan3.mjs`
- **C-TYPES** `node scripts/test-work-plan3-types.mjs` (its source list needs `plan3-web/files.ts` and `plan3-remote.ts` added)
- **C-VERIFY** `npm run verify:quiet`
- **C-LSP** `lens_diagnostics` with source lsp, scope paths, on changed `.ts` files.
- **C-TS** `tailscale status --json`, `tailscale serve status`, and `tailscale serve --https=<port> off` for cleanup.

### Phase 1: Prerequisites and feasibility [think]

- [x] **P1-01** plan3-web is committed (17fea6c, plan 0899f7c0 complete); the only dirty relevant file is extensions/plan3.ts, holding another idle session's resolve edits, which stay unstaged.
- [x] **P1-02** SDK probe: after session.reload() the new runtime rebinds the saved port (EADDRINUSE retry), and an HTTP handler's unawaited pi.sendUserMessage("/cmd") runs the command with a full command ctx; reply in 0 ms.
- [x] **P1-03** Session API, cacheable build-fingerprinted assets and the 6-digit pairing protocol recorded as D22; /api/command is replaced by slash text through /api/message.
- [x] **P1-04** Tailscale HTTPS enabled (cert flexpc.tailaee9f8.ts.net); iPhone 11 joined the tailnet as the same untagged user.
- [x] **P1-05** tailscale serve --bg --https=<port> works as D8: Host and X-Forwarded-Host keep <dns>:<port>, the owner login is added and forged copies are stripped, and SSE streams unbuffered (about 40 ms); the mapping is removed with `--https=<port> off`.

### Phase 2: Session sharing that survives reload [code]

- [x] **P2-01** Added external credential records and saved-port/token binding with bounded retry and port-conflict fallback; reuse, corrupt-state, containment and Unix file-mode checks covered.
- [x] **P2-02** Session snapshot/events work without a diagram target; Stop and answers are session-wide, chat adds diagram context only for mentions/notes, and the browser follows the resolved target.
- [x] **P2-03** Typed slash commands and plan-menu buttons dispatch through unawaited sendUserMessage with expansion enabled; documented Pi built-ins return terminal-only errors. Legacy command endpoint remains until the UI/API migration is finished.
- [x] **P2-04** Sharing persists a boolean-only entry; reload and resume restore the saved local link using a fresh session context. Shutdown releases the server; new sessions get new credentials and the nonexistent session_switch dependency is removed.
- [x] **P2-05** /wo share and the Utilities row toggle per-session sharing with persisted on/off state; while live, a red bold [SHARED] status shows; diagram/architecture opens share locally.
- [x] **P2-06** Snapshots carry a 12-hex build fingerprint and SSE retry 1000; the page reconnects itself with 1–15 s backoff after HTTP errors, shows "Pi is reloading… reconnecting", and reloads when the build changed.
- [x] **P2-07** Activity mirror tracks ui_prompt_start/end as a dialog title; the page shows "Pi is waiting for a terminal dialog: <title>" unless a bridged dialog is open there.
- [x] **P2-09** Check-in snapshot is slim: newest 20 rows as 2 KB excerpts (block titles only), running tools, whole dialogs, capped at 64 KB; diagram via GET /api/diagram, full rows via /api/row, paging via /api/rows?before=; page loads the diagram lazily, has Show earlier and Show full message/expand-on-open.
- [x] **P2-10** Live stream: chat rows travel as {id,offset,text} deltas coalesced to ≤4/s per row (final updates immediate, blocks brief and only when changed); activity sends state without tools/thinking, single changed tool rows and coalesced thinking deltas; page applies at current length, ignores stale, refetches on gap; tab title shows "(!) … needs an answer".
- [x] **P2-11** C-WEB byte tests pass. checkIn() in plan3-web.ts builds the check-in packet within 64 KB: surrogate-safe excerpts, dialogs over 16 KB sent brief with the full body at /api/dialog, queue capped. The page's delta rule moved to the shared plan3-web/stream.ts. Assets are served under /a/<build>/ with immutable caching.
- [x] **P2-08** Phase 2 gate green: C-WEB, C-PLAN3, C-TYPES (stream.ts added to its source list) and C-LSP pass. Lifecycle tests cover reload on the same port, resume re-share, a new session rejecting the old link, and now fork (copies the shared entry but never serves the parent's link).

### Phase 3: Tailscale remote and device pairing [code]

- [x] **P3-01** Tailscale detection and serve mapping. plan3-remote.ts adds tailscaleStatus (installed, logged in, MagicDNS, HTTPS certificates, owner login, untagged; each missing step named), plus serveAdd/serveRemove (tailnet HTTPS on the same port, never Funnel). Sharing adds the mapping, or warns which step is missing and still shares locally; turning sharing off, quit, new and fork remove it, and reload keeps it. A changed port removes the old mapping. Remote Host stays 403 until P3-02.
- [x] **P3-02** Request mode follows the Host (D8). 127.0.0.1:port requires the token and ignores cookies. The tailnet host:port requires X-Forwarded-Proto https, the owner Tailscale-User-Login and a pi_remote cookie accepted by options.device, never the token, with Origin https://host:port. Remote assets carry an empty token, and the page then uses same-origin credentials for fetch, POST, paste and EventSource. plan3.ts passes the serve mapping as remote; device is unset until P3-03, so remote requests fail closed with 401.
- [x] **P3-03** Pairing works end to end. Unpaired owner devices get only pair.html/pair.js/styles.css plus /pair/start (6-digit code, 2-minute expiry, one pending, 5 per 10 minutes) and /pair/status (long-poll; sets the pi_remote HttpOnly Secure SameSite=Strict cookie once, 90 days). Approval is a terminal-only list dialog (new showListDialog terminalOnly, not bridged; needs a terminal UI). The machine-wide devices.json registry stores secret hashes, renews hourly, prunes expired devices and uses a pid-stamped cross-process lock; corrupt state fails closed with one warning. /wo share devices lists and revokes.
- [x] **P3-04** Forged-header C-WEB coverage is complete. Already covered: wrong or missing login, missing or unpaired cookie, token-only remote, foreign Host, local Origin on the remote host, http proto, 409, and 429. New: a device revoked through the real registry gets 401 on its next request; the 2-minute pairing expiry (mocked timers) aborts the terminal dialog and the code then 404s; D9 isolation (terminalOnly dialogs never reach a bound browser bridge, and a session without a terminal UI denies pairing).
- [x] **P3-06** Two-process registry test: two Node processes each pair 20 devices, renew 10 and revoke 5 against one devices.json; all 30 survivors validate, all 10 revoked are rejected, renewals persist and the lock is released. The P3-03 registry already provides the pid-stamped lock, atomic rename and fail-closed corrupt state.
- [x] **P3-07** Revocation reaches open streams. Each remote SSE client keeps its device cookie and login; an unref'd 2-second sweep re-checks them through options.device (the registry re-reads devices.json), and a revoked, expired or erroring device has its queued frames dropped and the stream destroyed. Other devices keep streaming; close clears the sweep.
- [x] **P3-05** Switcher session records. createSessionRecords writes remote/sessions/<id>.json (pid, name, cwd, port, state working/waiting/idle, revision, per-device seen map) only from the owning process, atomically. A run ending raises the revision; seen is clamped and capped at 50 devices; list skips dead pids and invalid files. /api/sessions and /api/seen identify the viewer by paired device id or "local", never the secret. plan3.ts publishes on share and on activity/dialog events, and removes the record on share-off and non-reload quit.

### Phase 4: Tabbed browser workspace [code]

- [x] **P4-01** Desktop layout: the left panel has Files and Diagram tabs (ARIA tablist, arrow keys, Files is a placeholder until P4-03) and the chat stays on the right. R7 collapse states: full; narrow (the panel takes the chat width, the chat widens, splitter direction follows); collapsed to a >> button (the chat takes the width). Focus moves between << and >>, the state and tab persist in localStorage, and the rules apply only at ≥900 px. A diagram first drawn while hidden fits when its tab is shown.
- [x] **P4-02** Files API in extensions/plan3-files.ts with /api/files, /api/file?path= and /api/diff?path= (403 FileRefused, capability required). The tree comes from git ls-files (honours .gitignore) with a bounded walk outside git, and jev-tools forbiddenPath hides paths. Change marks come from porcelain status (root-relative paths are mapped to cwd so subfolder sessions work). Content goes through captureSource. Diffs use git diff HEAD, which covers staged and unstaged edits, deletions and renames (the rename source is added to the pathspec). The diff text gets the secret, NUL and 256 KB checks. Untracked files and unborn repositories show content. A files SSE ping follows write, edit and bash tools. jev-tools exports forbiddenPath, secret and safePath, and object() became a type guard.
- [x] **P4-03** Files tab UI in extensions/plan3-web/files.ts: a native details/summary folder tree (keyboard toggling, folders with changes start open, open/closed state kept across refreshes), file buttons with M/??/D/R marks coloured per D10, and a viewer beside the tree on desktop and below it under 900 px. Changed files load /api/diff and the others /api/file; diff lines are coloured (add #b2f2bb, del #ffc9c9). Everything renders through textContent. The files SSE event refreshes a visible tab or marks a hidden one stale; the selected file reloads on refresh.
- [x] **P4-04** Phone layout under 900 px: a Chat/Files/Diagram tablist (arrow keys wrap, choice kept in localStorage) shows one full-height view at a time, and Files and Diagram reuse the desktop panels with the left tabs hidden. The page height follows visualViewport (--app-height) and the viewport meta sets interactive-widget=resizes-content, so the composer stays above the on-screen keyboard. An Image button (file input, accepts PNG/JPEG/GIF/WebP) uploads through the same /api/paste path as clipboard paste and resets so the same photo can be attached again. Desktop ignores the phone view.
- [x] **P4-08** D19 endpoints: GET /api/models returns {model, effort, scoped, others, efforts}, scoped models first and the rest from modelRegistry.getAvailable. POST /api/model {provider,id} accepts only available models and gives 404/409/400. POST /api/effort {level} accepts EFFORTS levels and returns the level after clamping. Both publish a status SSE event, as do terminal model_select and thinking_level_select. The snapshot carries status {model, effort}. A hanging slash command leaves the HTTP request returning and the server serving (D17).
- [x] **P4-05** D19 status line in the chat. Line 1 is a model · effort button that opens a picker: effort buttons, a filter input (Enter picks the first match), scoped models first, then all models. Line 2 shows plan · done/total and opens the plan menu (resolve, ideas, review, finish, resume3, switch via a bare /plan3, new plan); with no plan, New plan prefills '/plan3 ' in the composer. ⋯ expands a red [SHARED] badge and context %. Menus close on Escape (focus returns to the button) or an outside click. Status comes from the snapshot and the status SSE event, which now also refreshes when a run ends. The top-bar #commands buttons are removed.
- [ ] **P4-07** Session switcher UI (D18): slide-out list, closed stripe of colour-coded letters, per-device seen state; mobile and desktop.
- [ ] **P4-06** Extend C-BROWSER: collapse states, Files diff, reload reconnect, status line, switcher A to B to A seen state, 390 px mobile tabs; run C-VERIFY.
  - Remote-mode browser test through a local test proxy that sets the tailnet Host and identity headers: pair, load assets, chat, answer a dialog and upload an image, with no URL token.

### Phase 5: Docs [code]

- [ ] **P5-01** README: sharing, reload and resume behaviour, Tailscale setup, pairing, revoke, security model and limits; CHANGELOG entry.

### Phase 6: Live acceptance [think]

- [human] **P6-01** User runs E1 to E9 on the desktop and phone; record findings or explicitly accepted limitations. Needs P1-04.
### P-ARCH [code] Product architecture

- [ ] **ARCH-RECONCILE** Reconcile the product architecture diagram with this plan's actual changes.
  - Compare actual code and git history; update through plan3_diagram target product, or mark done with no architecture change.
  - Changed plan elements: none flagged; inspect actual implementation.


## Global validation

- C-VERIFY passes on the final tree; C-LSP is clean on changed `.ts` files.
- E1 to E9 pass in P6-01, or the user explicitly accepts each recorded limitation.
- C-WEB proves that no session data is served to a foreign Host, a wrong Tailscale login, an unpaired or revoked device, or a request without the token in local mode.
- A revoked device's open streams close within 5 s in every session process (P3-07).
- `tailscale serve status` shows no mapping after sharing is turned off with `/wo share` or Pi quits (C-TS).
- The session file never contains the token, port record or device secrets (C-WEB test reads the written session entries).
- `/plan3 diagram` behaviour from plan 0899f7c0 still passes its C-BROWSER checks.

## Backlog

- Phone notifications ("session X is waiting for an answer"), not vital per the user. Options: iOS Web Push needs the page added to the Home Screen (iOS 16.4+), a service worker and VAPID-signed, RFC 8291-encrypted pushes through Apple's push service (no dependency, but real crypto work); or a push app such as ntfy, which sends text through a third party unless self-hosted.
- Reload and compact from the browser through dedicated extension endpoints (model and effort are in scope, D19).
- Loading earlier chat history beyond the mirror's 100 recent rows.
- Editing files from the browser.

## Resume context

P4-01..P4-03 committed locally (26/34; HEAD 907b94f). Next: P4-04, the mobile layout under 900 px: Chat/Files/Diagram tabs, the composer kept usable with the on-screen keyboard, and an image attach button. Then P4-05 (D19 status line), P4-07 (switcher), P4-06 (C-BROWSER and C-VERIFY), P5. The working tree still holds the other session's hunks in plan3.ts and test-work-plan3.mjs, plus work-images.ts and test-work-compaction-notifications.mjs; stage with the hunk filter and leave those out.

## Amendments

Append material changes and their reasons; preserve the original request and settled decisions.
- 2026-10-14: Added P3-05 after P3-04: User answer on several sessions: per-session links, machine-wide pairing, session switcher with colour-coded state (D18).
- 2026-10-14: Added P4-07 after P4-05: D18 switcher UI.
- 2026-10-14: Added P4-08 after P4-07: D19 model picker needs server endpoints; D17 requires a no-stall test.
- 2026-10-14: Added P2-09, P2-10, P2-11 after P2-07: User: the phone checks in occasionally and must start from recent messages and any waiting question, without megabytes of history or per-token full-row updates (D20).
- 2026-10-14: Plan review by plan3-advisor (gpt-6-astra). Each finding was checked against the code; all nine accepted and recorded as D21:
  - 1 accepted: `captureSource` checks only current content (jev-tools.ts 67–87), so diff text now passes the secret, binary and size checks too (P4-02).
  - 2 accepted: `git status` reports staged and untracked files that `git diff -- <path>` misses; now `git diff HEAD`, content for untracked files and an unborn repository, with per-case tests (P4-02).
  - 3 accepted: confirmed `credentials: "omit"` in 3 fetches and `__TOKEN__` embedded in assets; P3-02 now migrates every request path, and P4-06 adds a remote-mode browser test.
  - 4 accepted: SSE responses authenticate once and stay open (plan3-web.ts 108–125); added P3-07 for revocation reaching open streams within 5 s.
  - 5 accepted: `withPlanDesignLock` is in-process only (plan3-design.ts 13–18); added P3-06 using the work-camera-state.ts cross-process lock pattern.
  - 6 accepted: the snapshot includes the full diagram (up to `DIAGRAM_BYTES` 1,000,000), so the diagram now loads lazily, rows carry excerpts, large dialogs are trimmed, and E9 counts reconnect data only (P2-11).
  - 7 accepted: the stream subscribes before the snapshot and buffers events (plan3-web.ts 111–124), so deltas now carry offsets with exact-text tests (P2-11).
  - 8 accepted: browser storage is per origin and every session has its own port, so seen state moves server-side (P3-05, P4-06).
  - 9 accepted: `session_switch` is absent from Pi 1.1.0 types; the lifecycle uses shutdown and start reasons, and the dead handler is removed (P2-04, P2-08).
- 2026-10-14: Added final architecture reconciliation because a product diagram exists.
