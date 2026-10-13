---
plan3: true
status: ready
created: 2026-10-13
updated: 2026-10-13T14:38:45.636Z
reviewed: 2026-10-13
started: 2026-10-13T13:40:36.371Z
---

# Interactive architecture diagram workspace for plans and products

## Original request

> now lets talk UML. the idea here is during architectural phases, project description, plans, all of these to be able to see the system. what I'm thinking:
> 
> 1. I make a plan, we talk, we chat, I give /plan3 diagram or uml and it opens me out web page that is very interactive - zoom in shows more details, left-drag around the architecture, zoom out leaves the whole block. I can leave comments that are recorded with notes that are visible when zoomed or hover (!). best - I can chat with the plan running now - I click the server and say "add such functionality" and it thinks and it is added and also pops a suggestion to update the X eleements that use it too, so I yes and it continues like that, so a chat interface on the right and a diagram on the left, I want the WHOLE planning to be able to happen from the design area up until I run the thing, then it is saved alongside the plan. and archived with the plan.
> 
> 2. I can request whole product diagram, that lists modules, connections etc, see what goes where, actually request changes, a product chat so to speak but in there and mentioning components. I can start typing and ctrl+click on a web client box, it is mentioned in the chat as @web_module or whatever so we are all clear whats there
> 
> 3. when the product changes and evolves there is a standing note to update when product architecture changes
> 
> I know this is big to swallow, basically we webify our design and work and modify process

Follow-up from the user (2026-10-13): "possible interface: https://excalidraw.nyc3.cdn.digitaloceanspaces.com/lp-cms/media/system%20design.png" — an Excalidraw system-design sketch: hand-drawn black strokes, blue rounded component boxes, gray dashed group containers, pink sticky-note questions, labeled arrows, white canvas.

## Goal, requirements, and non-goals

Goal: a local browser workspace where a Plan3 plan (and the whole product) is seen and changed as an architecture diagram, with the live planning session as a chat on the right, so planning can run end to end from the browser.

Requirements:
- **R1** `/plan3 diagram [plan]` (alias `/plan3 uml`) opens a local web page: diagram on the left, chat with the current Pi session on the right.
- **R2** Semantic zoom: zoomed out shows groups as whole blocks; zooming in reveals nodes, then summaries, tech, details and notes. Left-drag pans; nodes can be dragged and their positions persist.
- **R3** Comments: the user pins notes to a node, edge or canvas spot; they are saved in the diagram, shown on hover always and inline when zoomed in, and visible to the agent.
- **R4** Chat drives the live session: messages typed in the browser go to the current agent; its replies stream back; ctrl+click on a box inserts `@node_id` into the message and the agent receives the mentioned nodes' current data.
- **R5** The agent edits the diagram through a validated tool; each edit reports the elements that depend on what changed so the agent can offer follow-up updates, and the browser updates live.
- **R6** Whole planning in the browser: Plan3 commands (resolve, ideas, review, finish, start work) run from the page, and every ask_user question and Plan3 dialog can be answered in the browser as well as the terminal (first answer wins).
- **R7** The plan diagram is saved next to the plan and moves with it when the plan is archived.
- **R8** `/plan3 architecture` opens the same workspace on the whole-product diagram (modules, connections), with the same chat and mentions.
- **R9** Standing rule: product architecture changes get reconciled into the product diagram (code-enforced, D8).
- **R10** Excalidraw-like hand-drawn look per the user's reference.
- **R11** The browser shows what the agent is doing, like Pi's terminal: working or idle, streaming thinking and text, tool calls with progress and results, queued messages, compaction and errors (D9).

Non-goals (v1):
- No free-hand drawing or Excalidraw editing; the structured model is the source of truth (D1).
- No multi-user or remote access; the server is local to this machine and this session.
- No UML notation families (sequence, class, state diagrams); v1 is a component and connection architecture view. Candidate for Backlog.
- No auto-generation of the product diagram from source code analysis beyond what the agent writes.

Acceptance examples:
- During planning, `/plan3 diagram` opens the browser on this plan's diagram; zooming out collapses the "Backend" group into one block; zooming in on "UploadAPI" shows its summary and a pinned comment.
- The user ctrl+clicks "Storage", types "add lifecycle rules to @storage", sends; the agent's reply streams into the chat, a changed Storage box appears, and the agent asks in the browser whether to update UploadAPI and CDN, which link to Storage; choosing yes continues.
- From the browser the user clicks Resolve, answers open questions in browser dialogs, then Finish and Start work, without touching the terminal.
- Completing the plan moves `<plan>.md` and its diagram file together into `docs/plans/done/`.

## Decisions

- **D1** 2026-10-13 — Rendering: own SVG renderer over a structured diagram model with an Excalidraw-like hand-drawn look (rough.js, MIT), not an embedded Excalidraw. Rationale: semantic zoom, mentions and reliable agent edits need a structured model; Excalidraw free drawing cannot round-trip. tldraw excluded (paid production license). Source: user via ask_user.
- **D2** 2026-10-13 — v1 scope is everything: plan diagram with live chat, product diagram with mentions, the standing architecture-update rule, Plan3 commands run from the browser and ask_user answered in the browser. Source: user via ask_user.
- **D3** 2026-10-13 — ask_user becomes ce-workflow's own tool: copy pi-ask-user 0.16.0 source (MIT; `index.ts` 3155 lines, `single-select-layout.ts` 203 lines) with minimal edits, keep a provenance file in the style of `extensions/subscription-footer-UPSTREAM.md`, and keep `pi-ask-user` in catch-up so upstream releases show what to port. Rationale: browser answering needs a native hook; the existing opt-in patch (`scripts/patch-ask-user-remote-answer.mjs`) is single-question only and not applied on this machine. Source: user via ask_user ("copy source and do minimal edits and add it into catchup").
- **D4** 2026-10-13 — Visual direction follows the user's reference, using skill `skills/frontend-design/SKILL.md` for the token pass (Phase 1): whiteboard white canvas, rough black strokes, blue component fills, gray dashed group containers, pink sticky notes for comments, labeled arrows; quiet system-font chat pane so the diagram is the one bold element. Source: user reference image plus skill; exact tokens are set in P1-03.
- **D5** 2026-10-13 (assumed, near-certain) — The browser chat talks to the same live Pi session (same agent, context and plan), not a separate model. Evidence: request says "chat with the plan running now" and "it thinks and it is added".
- **D6** 2026-10-13 (assumed, near-certain) — Server is Node's `node:http` bound to 127.0.0.1 on an ephemeral port with a per-launch random token, Host and Origin checks, body limits and a strict CSP; started by the command and closed in `session_shutdown`, per Pi's lifecycle rule in `docs/extensions.md` ("Do not start processes, sockets ... in the factory"). No new npm dependency for the server.
- **D7** 2026-10-13 — Storage (Q-01): plan diagram is a sibling file `docs/plans/<plan-file-stem>.diagram.json`, moved by `archive()` with the plan; product diagram at `docs/architecture/product.diagram.json` (the recommended path; the answer named only the sibling option). Source: user via /plan3 resolve.
- **D8** 2026-10-13 — Standing rule (Q-02): when a product diagram exists, `/plan3 finish` appends a final [code] step "Reconcile the product architecture diagram with this plan's changes" to every plan; plans with a diagram list their changed elements; completion refuses while that step is open unless it is marked done with "no architecture change". Source: user via /plan3 resolve.
- **D9** 2026-10-13 — The browser shows agent activity the way Pi's terminal does: working and idle state, streaming thinking and text, running tool calls with their progress and results, queued follow-ups, compaction and errors (R11). Source: user comment on Q-02 ("the interface should show when agent is working, etc just like the real pi does"); Pi 1.1.0 exposes the needed events (`agent_start`, `agent_end`, `message_update`, `tool_execution_start`, `tool_execution_update`, `tool_execution_end`, `session_compact`) and `ctx.isIdle`, `ctx.hasPendingMessages`, `ctx.abort` (dist/core/extensions/types.d.ts).
- **D10** 2026-10-13 — Layout (Q-03): own small layered layout (rank by edges inside each group, grid fallback) plus persisted manual positions; no layout library. Source: user via /plan3 resolve.
- **D11** 2026-10-13 — Assets (Q-04): rough.js and the hand-drawn font are vendored into the package with their licenses and served by the local server; no CDN. Source: user via /plan3 resolve.
- **D12** 2026-10-13 — Coexistence (Q-05): ce-workflow drops the pi-ask-user peer dependency and install line; if pi-ask-user is still loaded, ce-workflow skips registering its copy and warns once to uninstall it (browser answering then falls back to terminal only). Source: user via /plan3 resolve.
- **D13** 2026-10-13 — Stop button (Q-06): the browser shows Stop only while the agent is working; it calls ctx.abort() through a token-guarded endpoint and the chat records the interruption, matching Escape in the terminal. Whether ctx.abort() works from an HTTP callback is unverified until P1-04. Source: user via /plan3 resolve.
- **D14** 2026-10-13 (superseded by D15) — Force finish versus D8 (Q-07): Force finish may complete a plan whose architecture-reconciliation step is still open, as an explicit user override; its dialog and the Amendments entry name that open step so the product diagram’s staleness is visible. Ordinary completion still enforces D8. Source: user via /plan3 resolve.
- **D15** 2026-10-13 — Supersedes D14. Force finish first runs the architecture update, then completes: when a product diagram exists, the agent reconciles it with what was actually built (code and git history of this plan’s work), not with the plan’s unfinished steps, because plans deviate and the last slices may be dropped although the work is done. The plan is archived only after that update is done; unfinished steps are still listed in Amendments as today. Source: user in chat ("force finish but update the architecture to match what we really did").
- **D16** 2026-10-13 — Aborted or failed Force finish update (Q-08): Force finish then offers a second dialog to archive anyway; the user may waive the architecture update, for example when the plan or project is simple. Choosing not to archive leaves the plan open with the reconciliation step wip, and Force finish again resumes the update. A waiver is recorded in Amendments. Source: user via /plan3 resolve ("user is in control ... user can waive it").
- **D17** 2026-10-13 — First plan diagram in a project offers a product diagram: when the user first opens a plan diagram and no product diagram exists, the workspace asks whether to also create the whole-project architecture diagram, because a project may have only one complicated task. Yes creates it (agent turn, from the code and this plan); D8 applies only once it exists. Source: user comment on Q-08 ("the first time we approve making a diagram for the task it should ask if to make for the project as a whole too"). How a No is remembered is D18.
- **D18** 2026-10-13 — Declined product diagram (Q-09): a No is remembered per project as `workOrchestrator.plan3.productDiagram: "declined"` in `.pi/settings.json` and the offer is never shown again; `/plan3 architecture` still creates the product diagram on demand. Source: user via /plan3 resolve.
- **D19** 2026-10-13 (P1-01) — Diagram schema v1: `{ version: 1, kind: "plan"|"product", plan?: <plan id>, title, revision, nodes[], edges[], notes[] }`. Node: `id, label, kind (group|client|service|store|external), parent?, summary?, tech?, details?, status?, x?, y?`; groups are nodes of kind group and nest. Edge: `id, from, to, label?, status?`. Note: `id, target? (node or edge id; absent = canvas with x, y), text, author (user|agent), created`. Notes are sticky notes, not a node kind.
- **D20** 2026-10-13 (P1-01) — Ids and mentions: every node, edge and note id matches `^[a-z][a-z0-9_]{0,47}$` and is unique across the whole diagram; `@id` in chat mentions it. Edge ids default to `<from>__<to>` (suffix `_2` on collision); note ids are `note_<n>`.
- **D21** 2026-10-13 (P1-01) — Zoom bands by scale: far < 0.6 shows top-level groups as closed blocks with labels and group-to-group edges; mid 0.6–1.6 shows nodes, labels and edge labels; near > 1.6 adds summary, tech, details and inline notes. Notes show on hover in every band.
- **D22** 2026-10-13 (P1-01, assumed) — Plan versus product: `status` (new|changed|removed|existing) is allowed only in plan diagrams. A new plan diagram is seeded from the product diagram when one exists, every element status existing, so the plan shows its change in context; otherwise it starts empty. Reversible: seeding is one function in plan3-diagram.ts.
- **D23** 2026-10-13 (P1-01) — Browser assets under `extensions/plan3-web/` are `.js`, `.css` and `.html`: the Extension File Rule covers modules loaded by Pi’s jiti or Node, and these files are served over HTTP to the browser and never imported by an extension (layout.js may be imported by node tests only).
- **D24** 2026-10-13 (P1-03) — Workspace tokens (frontend-design pass, brief fixed by D4). Palette: canvas white #ffffff; ink #1e1e1e (Excalidraw default stroke, per the reference); component blue #a5d8ff; group gray #868e96 dashed; sticky pink #ffc9c9; focus and links #1971c2. Plan status fills: new #b2f2bb, changed #ffec99, removed hatched #ced4da. Chat pane #f8f9fa with ink text. Type: diagram labels in the vendored hand-drawn font (Virgil, OFL; D11), chat and controls in system-ui at 13/15/18 px, sentence case. Bold element: the hand-drawn diagram; the chat, top bar and dialogs stay flat and quiet (no shadows, one 6 px radius). Copy: Resolve questions, Ideas, Review, Finish planning, Start work, Stop; empty diagram says "No diagram yet. Ask in the chat, for example: draw the main components."
- **D25** 2026-10-13 (P1-03) — Layout: top bar (title, plan or product badge, command buttons right-aligned); diagram fills the left; chat on the right, 380 px default, resizable 280–640 px; under 900 px wide the chat stacks below the diagram. Zoom controls bottom-left of the canvas (minus, percent, plus, fit). Wireframe: `[title | badge ....... Resolve Ideas Review Finish Start] / [canvas (pan, zoom, notes) | activity + messages / chips + input + Send or Stop]`. Accessibility: 2 px #1971c2 focus outline on every control and on SVG nodes (tabindex 0; Enter mentions, arrows pan, +/- zoom); prefers-reduced-motion disables animated zoom and pan; rough.js uses a fixed seed per element so strokes do not jitter on re-render.
- **D26** 2026-10-13 (P1-04, live probe: `pi -p --no-session -ne -e probe.ts -e pi-ask-user/index.ts`, gpt-6-luna) — Pass: `ctx.abort()` from an HTTP handler stopped a running tool and gave `agent_settled { aborted: true }` (D13 feasible). Pass: `pi.sendUserMessage(text, { deliverAs: "followUp" })` from an HTTP handler while busy fires `input { source: "extension", streamingBehavior: "followUp" }` and is delivered as a later `message_start` user message. Pass: `message_update.assistantMessageEvent.type` gives text_start/delta/end and toolcall_start/delta/end; `tool_execution_update.partialResult` carries progress. Pass: `pi.getAllTools()` at session_start lists ask_user with `sourceInfo.path` of the loaded pi-ask-user, so D12 detection works.
- **D27** 2026-10-13 (P1-04, from Pi 1.1.0 dist source) — Duplicate tool names: first registration in extension order wins silently (`runner.getAllRegisteredTools`), so D12 must skip ours explicitly. Stored command ctx: getters are lazy and only throw after session replacement or reload (`assertActive`), so the server keeps the last command ctx and drops it on that error or `session_shutdown`; `ctx.ui` dialogs between turns use the same runner UI (not probed live: print mode has no UI; covered by P7-01). Queue: `queue_update` is session-internal, so the mirror tracks queued items from `input` events with `streamingBehavior` (terminal and browser alike), removes them on the matching user `message_start`, clears on `agent_settled`, and uses `ctx.hasPendingMessages()` as a check. Compaction: `session_before_compact` (start), `session_compact` (end), `session_compact_failed`. `sendUserMessage` throws during compaction and resolves only when the run ends, so HTTP handlers do not await it and report the error to the page.
- **D28** 2026-10-13 (assumed, supersedes D23's implementation detail) — All script source under extensions/ is .ts per repository AGENTS.md. Browser endpoints serve JavaScript from those sources; Node tests load them through jiti. D1–D18 feature decisions are unchanged.


## Open questions

### Blocking

None.

### Deferred

None.

## Relevant files and approach

Existing code to reuse:
- `extensions/plan3.ts` — `/plan3` command table (`SUBCOMMANDS`, `planCommand`), `archive()`, `finish()`, `resolveQuestions()`, open-file helper (`rundll32 url.dll,FileProtocolHandler` on Windows), `session_shutdown` cleanup, `pi.sendUserMessage` usage.
- `extensions/plan3-design.ts` — patterns for atomic writes, confined paths and per-file locks (`withPlanDesignLock`); reuse, do not duplicate.
- `extensions/plan3-ask.ts` — loads pi-ask-user for command popups; switches to the vendored copy.
- `extensions/work-dialogs.ts` — `showListDialog` for Plan3 menus; gains a browser race.
- `extensions/work-ask-remote.ts` and `scripts/patch-ask-user-remote-answer.mjs` — existing `ask:pending` and `ask:answer` event channel; the vendored tool emits these natively, so the patch script becomes obsolete.
- `extensions/plan3-catch-up.ts` — `PLAN3_CATCH_UP_PACKAGES` already includes pi-ask-user; catch-up plan text must tell the reviewer to diff the vendored copy.
- `extensions/subscription-footer-UPSTREAM.md` — provenance format for the vendored copy.
- Pi API (`docs/extensions.md` in the Pi install): `pi.sendUserMessage(text, { deliverAs })`, events `input`, `message_update`, `message_end`, `agent_end`; resources started from commands and closed in `session_shutdown`.

New files (names final in Phase 1):
- `extensions/ask-user/` — vendored ask_user (`.ts`), `UPSTREAM.md`, `LICENSE`.
- `extensions/plan3-diagram.ts` — diagram model: schema validation, load and save, apply operations, dependents, mention resolution; `plan3_diagram` tool.
- `extensions/plan3-web.ts` — local server, token, SSE stream, POST endpoints, chat mirror, dialog bridge registry, command dispatch.
- `extensions/plan3-web/` — static browser app (`index.html`, `app.js`, `styles.css`, `vendor/` rough.js and font). These are browser assets served over HTTP, not extension modules, so the `.ts`-only Extension File Rule does not apply; confirm in P1-01.
- `scripts/test-work-plan3-diagram.mjs`, `scripts/test-work-plan3-web.mjs` — picked up automatically by `scripts/verify-package.mjs` (pattern `test-work-*.mjs`).

Approach in one paragraph: the diagram is JSON (nodes with id, label, kind, parent group, summary, details, tech, status; edges; notes). The agent changes it only through `plan3_diagram`, which validates, saves atomically under a lock with a revision number, returns dependents of changed elements, and notifies the server, which pushes the new revision to the page over SSE. The page renders SVG with rough.js and three zoom bands. Browser chat posts to the server, which calls `pi.sendUserMessage` (as a follow-up when the agent is busy) with a context block for mentioned nodes and new comments; assistant output is mirrored back from message events. One dialog bridge serves the vendored ask_user, `showListDialog` and Plan3 popups: each pending dialog is shown in both terminal and browser and the first answer wins (the race pattern already used by the patch's `runRemoteAsk`).

## Phases

Commands (existing; referenced by steps):
- **C-VERIFY** `npm run verify:quiet` (full package check, runs every `scripts/test-work-*.mjs`).
- **C-PLAN3** `node scripts/test-work-plan3.mjs`
- **C-DIALOGS** `node scripts/test-work-dialogs.mjs`
- **C-ASKREMOTE** `node scripts/test-work-ask-remote.mjs`
- **C-DIAGRAM** `node scripts/test-work-plan3-diagram.mjs` (created in P3-01)
- **C-WEB** `node scripts/test-work-plan3-web.mjs` (created in P4-01)
- **C-LSP** `lens_diagnostics` with source lsp, scope paths, on changed `.ts` files.

### Phase 1: Model, look and feasibility [think]

- [x] **P1-01** Schema v1, ids/mentions, zoom bands, plan status and seeding, and .js browser assets recorded as D19–D23.
- [x] **P1-02** Two sample diagrams in scripts/fixtures/diagrams/ and layered layout extensions/plan3-web/layout.js (cycle-safe, manual positions) verified by C-DIAGRAM.
- [x] **P1-03** Token pass recorded as D24 (palette, type, bold element, copy) and D25 (layout wireframe, focus, reduced motion).
- [x] **P1-04** Live probe confirmed abort and followUp from HTTP callbacks, streaming payloads and ask_user source detection (D26); source-derived rules for duplicates, stored ctx, queue and compaction recorded (D27).

### Phase 2: Vendored ask_user [code]

- [x] **P2-01** Vendored pi-ask-user 0.16.0 with MIT license/provenance, .ts imports, pinned version and package registration; native host smoke passed.
- [x] **P2-02** Native single/batch answer channel validates responses, cancels losing UI and cleans listeners; intercom remains opt-in; obsolete patch/live patch test removed.
- [x] **P2-03** Plan3 uses vendored popup via host jiti; external 0.16.x remains supported, startup skips ours and warns once; README/peer dependency updated; concurrent plan writes made atomic.
- [x] **P2-04** Catch-up plans explicitly review and port vendored ask_user source/provenance while preserving native races and coexistence; Phase 2 full package verification passed.

### Phase 3: Diagram model and agent tool [code]

- [x] **P3-01** Diagram schema validation, bounded/confined loading, seeded creation and revision-checked atomic saves implemented using existing design lock/path/write helpers.
- [x] **P3-02** Validated add/update/move/remove operations preserve ids, cascade deletions safely, generate default edge/note ids, and report changed elements plus linked/child/note dependents; saves reject stale revisions.
- [x] **P3-03** plan3_diagram get/apply tool exposes schema-aware revisioned edits, preserves separate plan/product state, emits diagram-changed events and asks before dependent edits; bounded Windows rename retry fixes concurrent Plan3-reader EPERM.
- [x] **P3-04** Title, archive and design stable-id renames move sibling diagrams without clobbering; failures preserve originals. Stable-id path metadata enables workspace rebinding; full Phase 3 verification passed.

### Phase 4: Local server and session bridge [code]

- [x] **P4-01** Authenticated localhost server binds an ephemeral port, checks Host/Origin/token, applies CSP and body limits, streams sequenced SSE with bounded connections/buffers, and closes idempotently; Plan3 owns one lazy instance and shutdown cleanup.
- [ ] **P4-02** Chat bridge: POST message to `pi.sendUserMessage` with a context block for mentions and new comments; mirror input and message events to SSE.
- [ ] **P4-03** Dialog bridge registry: pending dialogs from ask_user, `showListDialog` and Plan3 popups go to SSE; browser answers resolve them.
  - Terminal and browser race; a late second answer is ignored and the browser closes the dialog.
- [ ] **P4-07** Snapshot and resync: on connect and reconnect send diagram revision, recent chat and activity, and pending dialogs; events carry sequence ids for dedup.
  - Check: C-WEB covers refresh during an unanswered question and reconnect after the terminal answered it.
- [ ] **P4-04** Endpoints for comments, node moves and Plan3 commands (resolve, ideas, review, finish, start work) via the stored command ctx.
  - Commands refuse while the agent is busy, matching `idle(ctx)` in plan3.ts.
  - Each request names the displayed plan id or the product target; the server resolves it afresh, never using `currentPlan()` defaults.
  - Start work calls the `/resume3` handler, not a `planCommand` subcommand.
  - One shared command-in-progress guard covers browser and terminal dispatch, released on error and cancel; `idle(ctx)` alone does not serialize (dialogs and compaction await outside turns, see `serialUI` in plan3.ts).
- [ ] **P4-05** Add `/plan3 diagram` with alias `uml`, and `/plan3 architecture`, to `SUBCOMMANDS`, completions and the handler; open the default browser.
  - Check: C-WEB covers token and Origin rejection, SSE delivery, chat forwarding, dialog race, refusal while busy, duplicate Finish and Resolve, and plan B displayed while plan A is current; C-PLAN3 and C-LSP pass.
- [ ] **P4-06** Activity mirror (D9): forward agent, message, tool execution and compaction events plus idle and queue state to SSE; Stop per D13.
  - Use `agent_settled` for idle, plus compaction start, end and failure events; any activity P1-04 found unavailable is listed in README, not claimed.
  - Check: C-WEB covers Stop rejected without token, rejected while idle, and calling abort while working.

### Phase 5: Browser workspace [code]

- [ ] **P5-01** Build `extensions/plan3-web/` app shell: diagram left, resizable chat right, top bar with plan title and command buttons, per P1-03 tokens.
- [ ] **P5-02** SVG renderer with rough.js: groups, nodes, labeled edges, semantic zoom bands, pan, node drag saving positions.
- [ ] **P5-03** Comments: pin to node, edge or canvas; hover cards; inline when zoomed in; sticky-note style.
- [ ] **P5-04** Chat pane: streaming replies, ctrl+click inserts `@id`, mention chips, browser dialogs for ask_user batches and list menus.
  - All user and model text is rendered as text, never as HTML.
- [ ] **P5-06** Activity view in the chat pane (D9): working indicator, thinking stream, tool call rows with progress and results, queued messages, compaction and errors.
  - Stop button visible only while working (D13).
- [ ] **P5-05** Headless check with agent-browser against a test server and the P1-02 samples; inspect with screen_read at small maxEdge.
  - Acceptance: zoom bands switch, drag persists after reload, a comment shows on hover, a replayed event stream shows working, tool rows and idle, keyboard focus is visible, reduced motion is respected.

### Phase 6: Product architecture and standing rule [code]

- [ ] **P6-01** `/plan3 architecture` creates or opens the product diagram; chat edits it through `plan3_diagram` with kind product.
- [ ] **P6-04** Offer a product diagram on the first plan diagram in a project without one (D17); remember a No per D18; test yes, no and repeat.
- [ ] **P6-02** Implement the standing update rule per D8 in `finish()` and every completion route, with tests in C-PLAN3.
  - Insert the reconciliation step idempotently with a stable id; repeated Finish does not duplicate it.
  - Completion checks that step's done mark directly; the existing open-step check covers only wip, next and waiting steps (plan3 status action).
  - Force finish (`forceFinish()`) follows D15: with a product diagram it starts an agent turn that reconciles the diagram with the actual code and git history, then archives.
  - The agent prompt says to describe what was built, not the plan's unfinished steps; without a product diagram Force finish behaves as today.
  - Tests: Force finish with a product diagram does not archive until the reconciliation step is done; without one it archives at once.
  - An aborted or failed update follows D16: dialog offers archive anyway (waiver recorded in Amendments) or stay open with the step wip.
  - Tests: abort then archive anyway records the waiver; abort then stay open, rerun Force finish resumes the update.
  - Tests: repeated Finish, step marked failed, blocked or human, step done with "no architecture change".
- [ ] **P6-03** Document the workspace, commands, storage, security model and vendored ask_user in README and CHANGELOG.
  - Check: C-VERIFY passes in full.

### Phase 7: Live acceptance [think]

- [human] **P7-01** User runs a real planning session from the browser through the four acceptance examples; record findings.
  - Needs the user at their desktop with a real browser; headless checks cannot judge feel and readability.
  - note: Needs the user present with a real browser.

## Global validation

- C-VERIFY passes on the final tree; C-LSP is clean on changed `.ts` files.
- The four acceptance examples in Goal pass in P7-01, or the user explicitly accepts each recorded limitation.
- While the agent works, the browser shows the same running state and tool calls as the terminal, and returns to idle with it (C-WEB and P7-01).
- Server rejects requests without the token or with a foreign Origin (C-WEB).
- A plan with a diagram archives with its diagram (C-DIAGRAM).
- ask_user works in the terminal with no browser open, unchanged from today (C-PLAN3 resolve tests).

## Backlog

- UML notation views (sequence, class, state) generated from the same model.
- Diagram history and diff view between plan revisions.
- Export to `.excalidraw` or SVG and PNG.
- Seeding the product diagram from code analysis (module graph).

## Resume context

Phase 3 complete (12/30 steps); full verify:quiet passed after P3-04 and targeted error-tier LSP is zero. Continue P4-01: implement localhost web server and existing-test selfcheck, then remaining Phase 4–6 inline. Preserve unrelated resolving follow-up hunks in extensions/plan3.ts and scripts/test-work-plan3.mjs unstaged. No delegation/push; no external Pi-model CLI probe. Live browser rebinding remains to verify in Phase 4/5, and SDK inferred-project warnings remain a qualification. Phase 7 needs user browser acceptance.

## Amendments

Append material changes and their reasons; preserve the original request and settled decisions.
- 2026-10-13: Plan review (plan3-advisor, gpt-6-astra) findings, each checked against the code:
  - 1 accepted: title action (`plan3.ts` title branch) and `enterPlanDesign()` rename plans, which would orphan a stem-named sibling diagram; P3-04 now covers all rename paths, no-overwrite and rebinding.
  - 2 accepted: finish, review and ideas default to `currentPlan()`, and Start work is `/resume3`; P4-04 now targets the displayed plan id and calls the resume3 handler.
  - 3 accepted: `idle(ctx)` does not serialize command flows that await dialogs (`serialUI` comment in plan3.ts); P4-04 adds a shared command guard and tests.
  - 4 accepted: `agent_settled`, compaction start and failure, and `queue_update` (session-subscriber only) verified in Pi 1.1.0 dist; P1-04 and P4-06 extended, gaps documented rather than claimed.
  - 5 accepted: added P4-07 snapshot and resync with tests.
  - 6 accepted: status complete checks only wip, next and waiting steps and `forceFinish()` bypasses all; P6-02 now checks the step directly; the Force finish conflict with D8 is open as Q-07.
  - 7 accepted: Global validation now requires passes or explicit user acceptance of each limitation.
  - 8 accepted: Resume context no longer says D13 is verified.
- 2026-10-13: Added P5-06 after P5-04: Browser rendering of the activity mirror for R11.
- 2026-10-13: Added P4-06 after P4-05: User comment on Q-02 asks the browser to show agent activity like Pi's terminal (R11, D9).
- 2026-10-13: Added P4-07 after P4-03: Review finding 5: a refreshed or late-opened browser would miss pending dialogs and streaming state.
- 2026-10-13: D14 superseded by D15 at the user's request: Force finish now updates the product architecture to match what was actually built before archiving, instead of only warning; P6-02 updated, Q-08 opened for an aborted update.
- 2026-10-13: Added P6-04 after P6-01: User comment on Q-08: a project may have only one complicated task, so the first plan diagram should offer the whole-project diagram (D17).
- 2026-10-13: Repaired an accidental duplicated plan prefix inside D20 caused by JavaScript replacement-string expansion; original request and D1–D18 preserved. D23's inferred exception was incorrect: repository AGENTS.md applies the .ts rule to anything under extensions/. layout source renamed to layout.ts; browser JavaScript will be served from .ts source, and installed-copy tests use jiti. No scope change.
- 2026-10-13 (P2-03): Focused C-PLAN3 exposed a concurrent reader seeing truncated frontmatter during requirement mutation (test line 403; tool fresh-summary read at plan3.ts:1599). mutate() now writes a unique sibling temp file and atomically renames it under the existing lock. Original concurrent-requirement assertion retained; unrelated dirty resolve-flow edits remain unstaged.
