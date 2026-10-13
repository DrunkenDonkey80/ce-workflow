---
plan3: true
status: ready
created: 2026-10-13
updated: 2026-10-13T13:42:20.571Z
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
- **D20** 2026-10-13 (P1-01) — Ids and mentions: every node, edge and note id matches `^[a-z][a-z0-9_]{0,47}---
plan3: true
status: ready
created: 2026-10-13
updated: 2026-10-13T13:40:36.371Z
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
 and is unique across the whole diagram; `@id` in chat mentions it. Edge ids default to `<from>__<to>` (suffix `_2` on collision); note ids are `note_<n>`.
- **D21** 2026-10-13 (P1-01) — Zoom bands by scale: far < 0.6 shows top-level groups as closed blocks with labels and group-to-group edges; mid 0.6–1.6 shows nodes, labels and edge labels; near > 1.6 adds summary, tech, details and inline notes. Notes show on hover in every band.
- **D22** 2026-10-13 (P1-01, assumed) — Plan versus product: `status` (new|changed|removed|existing) is allowed only in plan diagrams. A new plan diagram is seeded from the product diagram when one exists, every element status existing, so the plan shows its change in context; otherwise it starts empty. Reversible: seeding is one function in plan3-diagram.ts.
- **D23** 2026-10-13 (P1-01) — Browser assets under `extensions/plan3-web/` are `.js`, `.css` and `.html`: the Extension File Rule covers modules loaded by Pi’s jiti or Node, and these files are served over HTTP to the browser and never imported by an extension (layout.js may be imported by node tests only).

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
- [ ] **P1-03** Run the frontend-design token pass for the workspace; record palette, type, layout wireframe and the one bold element in Decisions.
  - Brief is fixed by D4; do not restart brainstorming; check keyboard focus and reduced motion requirements.
- [ ] **P1-04** Feasibility probes in a scratch extension; record results in Decisions.
  - Duplicate `ask_user` registration behaviour and how to detect a loaded pi-ask-user (D12).
  - Activity events from D9 fire with usable payloads; `ctx.abort()` works from an HTTP callback (D13).
  - Activity coverage: `agent_settled` as the final boundary (retries and compaction can follow `agent_end`), compaction start and failure, and queue contents.
  - `queue_update` is emitted to session subscribers (`dist/core/agent-session.js:657`), not extension events; find how an extension sees queue changes from the terminal, else record the gap.
  - A command ctx kept by the server can later run `planCommand` handlers and `ctx.ui` dialogs between turns.
  - `pi.sendUserMessage` from an HTTP callback when idle and when busy; `message_update` gives streamable assistant text.
  - Acceptance: each probe has a recorded pass or fail with the observed behaviour; a failure gets a design alternative before Phase 2.

### Phase 2: Vendored ask_user [code]

- [ ] **P2-01** Copy pi-ask-user 0.16.0 into `extensions/ask-user/` with LICENSE and UPSTREAM.md listing pinned version and every divergence.
  - Minimal edits only: imports, module paths, `.ts` specifiers; register from `package.json` `pi.extensions`.
- [ ] **P2-02** Add the native remote channel: emit `ask:pending` for single and batched questions, accept `ask:answer`, first answer wins.
  - Keep `PI_ASK_USER_REMOTE_ANSWERS` gating for intercom forwarding in `work-ask-remote.ts`; the browser bridge is not gated.
  - Remove `scripts/patch-ask-user-remote-answer.mjs` and its live test once unused; update `test-work-ask-remote.mjs`.
- [ ] **P2-03** Point `plan3-ask.ts` at the vendored copy; apply D12 for a loaded pi-ask-user; update README install lines and peer dependencies.
- [ ] **P2-04** Make catch-up plans for pi-ask-user tell the reviewer to diff upstream against `extensions/ask-user/` and update UPSTREAM.md.
  - Check: C-PLAN3, C-ASKREMOTE, C-DIALOGS, C-LSP pass; existing resolve popup tests run against the vendored copy.

### Phase 3: Diagram model and agent tool [code]

- [ ] **P3-01** Implement `extensions/plan3-diagram.ts`: schema validation, atomic locked save with revision, storage paths per D7.
  - Reject unknown parents, dangling edges, duplicate ids, oversized text; bounded file size.
- [ ] **P3-02** Add apply operations (add, update, move, remove node, edge or note) returning dependents of every changed element.
  - Dependents: nodes linked by an edge in either direction, children of a changed group, notes anchored to it.
- [ ] **P3-03** Register the `plan3_diagram` tool (get, apply) with a guideline: after an edit, offer updates to listed dependents through ask_user.
- [ ] **P3-04** Move the sibling diagram on every plan rename: `archive()`, the plan3 title action and `enterPlanDesign()`; resolve it for archived plans.
  - Rename sites: `extensions/plan3.ts` title action (renames plan and log), `extensions/plan3-design.ts` `enterPlanDesign()` (adds a stable id).
  - Never overwrite an existing diagram at the destination; on a failed move keep both files and report.
  - An open workspace rebinds to the new path by plan id.
  - Check: C-DIAGRAM covers validation, operations, dependents, and rename then reopen then archive with notes and positions intact; C-PLAN3 and C-LSP pass.

### Phase 4: Local server and session bridge [code]

- [ ] **P4-01** Implement `extensions/plan3-web.ts` server: 127.0.0.1 ephemeral port, token, Host and Origin checks, CSP, body limits, SSE.
  - One server per session; closed idempotently in `session_shutdown`; reopening the command reuses it.
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

Planning draft, reviewed; no product code written; no open questions. Settled D1 to D18: D15 Force finish reconciles architecture with what was built, then archives; D16 an aborted update offers archive anyway with a recorded waiver; D17 the first plan diagram offers a product diagram (P6-04); D18 a declined offer is remembered in .pi/settings.json and never repeated. D13 Stop button is to be verified in P1-04. Next action: finish planning; implementation starts at P1-01.

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
