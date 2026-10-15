---
plan3: true
status: active
created: 2026-10-15
updated: 2026-10-15T19:00:35.284Z
reviewed: 2026-10-15
started: 2026-10-15T09:18:46.375Z
---

# Project and plan diagram tabs with an editing toolbar and remembered generate directions

## Original request

> lets talk diagrams. we shall have global and per plan so where files are to be project diagram and plan diagram tabs, with plan one being empty most of the time. we have button to generate diagram that opens this text window we have so you give directions, and these are remembered so next time they are there and we can change them. in that regard probably we need to extend ask_user to have a direct text edit and have it pre-filled? it is ours now so we shalll have it as best suited to us as possible, you can think of other use cases for it too
> I say we remove that overall view completely, it will fail with editing capabilities
> there should be a bar for editing diagram - creating new group with specific color (that defines the color of the tiles in it), adding more tiles, making connections, removing conenctions etc. every action is with a prompt connected and becomes with some red highlight to be known that it is something editted and when it is done then it blends with the rest, I see it like I make new plan with that new plan menu and it shows empty diagram and I start draw in there, resize the boxes, add new elements, connect each to them and every operation that adds to the chat what is needed for what where and then just send. chat needs to be even bigger in desktop tbh, give it 2 more lines
> so when I delete a connection somewhere it becomes a red line with the X in it to notify it is removed, etc. what do you think, it is a rough idea, but hope you can make it better. the grand idea is to visually display the ideas you have and then have them created

## Goal, requirements, and non-goals

Goal: the shared web workspace becomes a place to sketch an idea as a diagram, hand it to the agent in one message, and see which parts the agent has not taken in yet.

Requirements:
- R1 Tabs where Files is today: **Files**, **Project** (whole-product diagram) and **Plan** (the displayed plan's own diagram). On the phone the same three views sit next to Chat.
- R2 The plan diagram is empty unless something was drawn or generated for that plan; it no longer starts as a copy of the project diagram.
- R3 Each diagram tab has a **Generate** button. It opens a text box pre-filled with that diagram's saved directions (or a short default). Sending saves the directions with the diagram and asks the agent to draw or update the diagram from them. Next time the box shows the saved text for editing.
- R4 ask_user gains a pre-filled text-edit question, usable by the model and by ce-workflow code, in the terminal and in the browser. R3 uses it.
- R5 Remove the zoomed-out overview band completely (collapsed top-level boxes and lifted edges). Zoom only scales the normal and detailed views.
- R6 An editing bar for each diagram: select and move, add a box, add a group with one of the palette colors (its boxes take that color), connect two elements, delete, rename, resize a box.
- R7 Every edit is saved at once. Meaning edits (add, connect, rename, recolor, delete) are drawn red as pending; layout edits (move, resize) are not marked and add no chat line (D3). A removed connection or box stays visible as a red line or outline with an X until settled. Each edit also adds one line to the chat box saying what changed where; the user sends once.
- R8 A pending mark clears when the agent has taken the edit into the plan (D1). For the Project tab, done means the agent updated the project diagram to match. Clearing a removal deletes the element.
- R9 The desktop message box gets two more lines (4 to 6 rows); the phone keeps its current height.
- R10 (2026-10-15, user feedback at J-01) Tabs "UML Project" and "UML Plan" with icons; Select, Box and Group tools with icons; the selected color visibly marked.
- R11 Groups and boxes are drawn by dragging, with a live outline in the selected color.
- R12 Group title band: grab cursor, drag moves the group; corners resize it (left button).
- R13 Boxes are grabbed by their title and dropped into a group (they travel with it, the group arranges them and grows to fit) or dragged out.
- R14 Creating opens no dialog; an "A+" cursor over a label means click to edit it.
- R15 Side midpoints of a box or group are connect handles. Clicking a connection lets you label or delete it; boxes and groups get Delete in their label dialog; deleting asks for confirmation.

Non-goals:
- No free-form drawing (arrows to nowhere, text, freehand). Elements stay typed boxes, groups, edges and notes.
- Layout stays the existing automatic grid with manual position pins; no free placement engine.
- Pending marks do not track whether code was built (D1 rejects that option).
- No new dependency.

## Decisions

- **D1 Pending edits settle when the agent took them into the plan.** After Send the agent works the edits into the plan (steps, decisions) or answers about them, then clears the marks itself; removed elements disappear then. In the Project tab "done" means the agent updated the project diagram to match. Rationale: red then means "not yet discussed", and the plan tab does not stay red for days. Rejected: until code is built; clear on Send. Source: user via ask_user, 2026-10-15.
- **D2 Edits are written to the diagram file at once, not kept as a browser draft.** They survive reloads, reach other open pages and are readable by the agent through plan3_diagram. Source: request R7 ("every operation adds to the chat … then just send") plus D1, which needs the agent to see and clear the marks.
- **D3 One `edit` mark (`add`, `change`, `remove`) on nodes and edges, separate from the plan-only `status` (new, changed, removed, existing).** `status` keeps meaning "relative to the product"; `edit` means "user-edited, not yet settled" and is allowed in both diagram kinds. Moving and resizing are layout, not meaning, and add no mark. Source: existing schema in `extensions/plan3-diagram.ts`; assumption over 95% from the request's separation of red highlight and normal content.
- **D4 The agent settles marks with a new `settle` operation in plan3_diagram apply** (`{op: "settle", entity, id}`): it clears `edit`, and for `edit: "remove"` deletes the element with today's cascade. Rationale: `update` cannot delete a field (JSON has no undefined; null is invalid), and one explicit verb is easy to prompt for. Source: `applyDiagramOperations` in `extensions/plan3-diagram.ts`.
- **D5 Deleting an element that is still pending `add` removes it outright** and drops its chat line, so a mistake does not need the agent. Source: assumption over 95%; undo of one's own unsent sketch.
- **D6 Generate directions are stored in the diagram JSON as `directions`.** A diagram file with only directions and no elements is valid, so the plan tab can remember directions before anything is drawn. The product file lives at `docs/architecture/product.diagram.json`, the plan file beside its plan and archived with it. Source: existing storage rules (README Plan3 diagram section).
- **D7 Group colors are the existing 8-color `PALETTE` (stored as `color: 0..7` on groups).** A box takes the color of its nearest colored ancestor group, else today's top-level color. CSP blocks inline styles, so styles stay `.tone-N` classes. Source: `extensions/plan3-web/diagram.ts`, `styles.css`.
- **D8 Box size is stored as optional `w` and `h` on boxes (not groups).** Layout uses them as the box size, never smaller than the label needs; groups keep sizing to their content. Source: `nodeSize` in `layout.ts`.
- **D9 ask_user pre-fill is a per-question `initialText` string.** A question with no options and `initialText` opens straight in the editor (terminal) or a textarea (browser) holding that text; the answer is the edited text. Divergence is recorded in `extensions/ask-user/UPSTREAM.md`. Source: request R4; existing no-options editor path in `extensions/ask-user/index.ts` (around line 1292) and `showAskDialog` in `extensions/work-dialogs.ts`.
- **D10 Groups also take optional `w` and `h`, as a minimum size** (amends D8). Layout uses the larger of that and the content, so dropping boxes in still grows the group (R12, R13). Source: user feedback 2026-10-15.
- **D11 Changing a box's or group's parent is a meaning edit** (`change` mark and a chat line); moving within the same parent stays layout (D3). Rationale: structure changes what the plan builds, position does not.
- **D12 The bar is Select, Box, Group and the color swatches; Connect and Delete tools are removed** (Q-04). Side handles connect (U-06) and dialogs delete (U-07). Source: user via ask_user, 2026-10-15.
- **D13 A group drawn around boxes adopts every box whose center is inside it**, one move line per box (Q-05). Source: user via ask_user, 2026-10-15.

Labelled assumptions (over 95% from evidence):
- A1 The Plan tab shows the plan the page is displaying today (URL `target`, else the current plan); the existing plan picker in the plan menu switches it.
- A2 Chat context follows the diagram each line came from, not the active tab: toolbar chat lines remember their diagram (Project or this plan), and Send attaches context for every diagram whose lines or mentions are in the message, so the same id in both diagrams is never confused. Typed @mentions without a toolbar line use the active diagram tab (the last one when only Files is open). The displayed plan identity stays separate from the active diagram target.
- A3 Box and Group share the drag-to-draw gesture; a click places the default size. The request names it for groups; one gesture for both is simpler to learn.
- **Q-01** Should the diagram editing bar appear on the phone?
  - Context: The phone shows one view at a time with a small screen; drawing and connecting with touch needs bigger targets and a pan or edit mode switch. Notes and viewing already work there.
  - Recommendation: Desktop and tablet widths only (900 px and up) for the first version; the phone views diagrams and adds notes. Add touch editing later if wanted.
  - Option: Desktop only — less work, phone stays view and notes.
  - Option: Phone too — same bar in a bottom sheet with a pan or edit toggle; roughly doubles the interaction testing.
  - Independent: yes
  - Answer: {"kind":"selection","selections":["Desktop only"]}
  - Source: user via ask_user /plan3 resolve; not independently verified.
- **Q-02** What should Generate do when the diagram already has elements?
  - Context: Generate sends the saved directions to the agent. Rebuilding from scratch loses manual positions, notes and pending marks; updating in place keeps ids so notes and mentions stay attached.
  - Recommendation: Update in place: keep ids, positions and notes, add and remove what the directions require, and report what changed. Starting over stays possible by writing "start over" in the directions.
  - Option: Update in place — keeps notes and positions.
  - Option: Ask each time — a choice in the dialog between update and start over.
  - Independent: yes
  - Answer: {"kind":"selection","selections":["Update in place"]}
  - Source: user via ask_user /plan3 resolve; not independently verified.
- **Q-03** Remove the automatic project-diagram creation and the "Create a product diagram?" offer?
  - Context: Today `/plan3 architecture` creates an empty product diagram and immediately asks the agent to fill it (`createProductDiagram` in `extensions/plan3.ts`), and the first plan workspace offers it once (`offerProductDiagram`, declining is saved as `workOrchestrator.plan3.productDiagram`). With a Generate button on the empty Project tab both are redundant.
  - Recommendation: Remove both; the empty Project tab shows "No project diagram yet" and the Generate button. Keep reading the old `declined` setting harmlessly (ignore it).
  - Option: Remove both — one way to create diagrams, less code.
  - Option: Keep them — `/plan3 architecture` still starts generation without the dialog.
  - Independent: yes
  - Answer: {"kind":"selection","selections":["Remove both"]}
  - Source: user via ask_user /plan3 resolve; not independently verified.
- **D10 amended (H-01, user choice):** on the open canvas, a dragged box or group stays exactly where it is dropped; boxes never dragged are still grid-placed; inside groups the grid still auto-arranges and pins only pick a cell. Overlaps on the canvas are accepted.





## Open questions

### Blocking

None.

### Deferred

None.

## Relevant files and approach

Smallest approach: extend the existing diagram model, server endpoints and canvas; no new modules except where the toolbar code would push `app.ts` or `diagram.ts` past readability (then one `extensions/plan3-web/edit.ts`).

- `extensions/plan3-diagram.ts`: schema (`edit`, `color`, `w`, `h`, `directions`), `settle` operation, `emptyDiagram` stops copying the product for plans (R2), validation bounds.
- `extensions/plan3.ts`: plan3_diagram tool schema, description and guidelines (settle after taking edits into the plan); web endpoints for toolbar edits (`/api/edit`, server-side marking and id generation from labels) and Generate (`/api/generate`); diagram GET for both targets; `diagramChatMessage` hint listing pending edits; Q-03 cleanup.
- `extensions/plan3-web.ts`: routing for the new endpoints if it owns them (check where `/api/move` and `/api/comment` are routed and follow that).
- `extensions/plan3-web/index.html`, `app.ts`: three tabs (desktop and phone drawer views), per-tab diagram state, Generate button, editing bar, composer lines, textarea rows.
- `extensions/plan3-web/diagram.ts`: remove the far band (`FAR`, `farSummary`, lifted edges, closed groups) including commit 76a61bd's overview summary; draw pending marks and the removal X; tool-driven pointer gestures; resize handles; group colors.
- `extensions/plan3-web/layout.ts`: honor `w` and `h`.
- `extensions/plan3-web/styles.css`: toolbar, pending red, `.tone-N` for chosen colors, desktop rows.
- `extensions/plan3-ask.ts` (external pi-ask-user fallback, A-01), `extensions/ask-user/index.ts`, `extensions/ask-user/remote.ts` (if the browser payload needs it), `extensions/plan3-web/prompts.ts`, `extensions/work-dialogs.ts` (`showAskDialog` caller), `extensions/ask-user/UPSTREAM.md`.
- `README.md` Plan3 diagram section (lines around 113–118).
- Tests: `scripts/test-work-plan3-diagram.mjs`, `scripts/test-work-plan3-web.mjs`, `scripts/test-work-plan3-browser.mjs`, `scripts/test-work-ask-user.mjs`, `scripts/test-work-ask-remote.mjs`, `scripts/test-work-plan3.mjs`; fixtures under `scripts/fixtures/diagrams/`.

Design direction (frontend-design skill, `skills/frontend-design/SKILL.md`, applied to an existing design system): keep the Excalidraw-like Rough.js canvas and existing tokens; no new typefaces. The editing bar is one compact row of labelled icon buttons in the left-panel top bar next to the zoom controls (the user asked earlier that canvas controls live in the top bar, not over the canvas). The active tool uses the light-blue selection treatment (`--blue` fill, `--focus` outline) the user asked for in menus. Group color is chosen from 8 swatches drawn from `PALETTE`. Pending is the one bold element: red stroke `--error` with a 2 px dashed outline, and a red X at the midpoint of removed edges; everything else stays quiet. Button copy uses verbs: "Box", "Group", "Connect", "Delete", "Generate".

Pointer model with the bar: Select tool (default) keeps plain drag to pan on empty canvas and moves a box with drag on the box (no Shift needed); Box and Group tools place on click and ask for a label in the existing note-dialog style; Connect drags from one element to another; Delete clicks an element; Escape returns to Select. Ctrl+click mention and right-click note keep working.

Chat lines (R7) use @mentions so `diagramChatMessage` attaches context, for example:
- `Add box @cache "Cache" in @backend`
- `Connect @api → @cache`
- `Remove connection @api__db`
- `Rename @queue to "Job queue"`, `Color group @backend green`

## Commands

- C1 `node scripts/test-work-plan3-diagram.mjs`
- C2 `node scripts/test-work-plan3-web.mjs`
- C3 `node scripts/test-work-plan3-browser.mjs` (known flakes: the early diagram revision wait and "plain drag on a box pans"; rerun once before blaming a change)
- C4 `node scripts/test-work-ask-user.mjs` and `node scripts/test-work-ask-remote.mjs`
- C5 `node scripts/test-work-plan3.mjs`
- C6 `node scripts/test-work-plan3-types.mjs`
- C7 `node scripts/test-work-dialogs.mjs`
- C8 `npm run verify:quiet` once, before a push only

## Phases

### Phase 1: Diagram model and agent contract [code]

- [x] **M-01** Schema/validator accept edit marks, group color 0–7, box w/h, bounded directions; apply ops share the field lists.
- [x] **M-02** settle op (clears edit; settled removal cascades); plan diagrams start empty; product param removed at every caller.
- [x] **M-03** plan3_diagram documents edit/color/w/h and settle with a settle-only-what-you-addressed guideline; chat context lists pendingEdits plus a hint.

### Phase 2: Pre-filled text in ask_user [code]

- [x] **A-01** ask_user initialText (single and batch, no options, ≤16k): terminal editor and dialog fallbacks pre-filled, browser textarea holds it; loadPlan3Ask reports prefills; UPSTREAM.md divergence.

### Phase 3: Tabs, overview removal and composer height [code]

- [x] **T-01** Files | Project | Plan tabs (desktop and phone drawer) share one canvas with a diagram per tab; both load at start, SSE diagram events route by target, old "diagram" tab value maps to Plan, product links open Project; moves/notes/messages carry the shown diagram's target; README updated.
- [x] **T-02** Removed the far overview band (FAR, farSummary, lifted/merged edges, collapsed groups, -far CSS); fit is one mid-layout pass at any scale; README zoom line updated.
- [x] **T-03** Message box has 6 rows from 900 px up and keeps 4 on phones, set where the layout switches between phone and desktop.

### Phase 4: Editing endpoint and pending rendering [code]

- [x] **E-01** POST /api/edit applies one toolbar edit (box, group+color, connect, rename, recolor, resize, move, delete) via toolbarEdit() in plan3-diagram.ts, with server-side add/change/remove marks, D5 undo of pending adds, label-derived unique ids, 409 on stale; returns diagram, chat line and cascade-removed ids.
- [x] **E-02** Pending marks drawn: red dashed outline for add/change boxes, solid outline + X for removals, red edges (dashed for add/change, X at midpoint for remove); pending edges never bundled; group color inherits from the nearest colored group; layout honors box w/h (never shorter than content).

### Phase 5: Editing bar interactions [code]

- [x] **E-03** Editing bar (Select, Box, Group + 8 color swatches, Connect, Delete) in the left tab bar, desktop only and hidden on the Files tab; tools act through the diagram click/Enter hook, labels reuse the note dialog, each edit posts /api/edit and appends its chat line; Escape returns to Select.
- [x] **E-04** Rename by double-click (open groups only by their title) or F2 via the pre-filled label dialog; a swatch recolors the selected group; the selected box gets a resize handle (bounded 120–1200 × 60–1200, no chat line); a plain drag on a box moves it, while empty canvas or an open group pans.
- [x] **E-05** Toolbar lines are tracked with their diagram and touched ids. Undoing a pending add drops every line in its cascade instead of adding a Delete line, and leaves the user's typing alone. Send groups the remaining lines per diagram (`diagrams: [{target, ids}]`), and the server builds one context block per diagram. The displayed diagram also owns any mention no other diagram claims.

### Phase 6: Generate with remembered directions [code]

- [x] **G-01** Generate button (in the diagram controls, on both tabs and the phone) → POST /api/generate. Opens ask_user pre-filled with the unsaved draft, the saved directions or a per-target default. Cancel saves nothing. Saves `directions` with a revision check and one retry on a stale revision; on failure the text is kept for the next Generate and nothing is sent. Then sends the in-place update prompt (keep ids, positions, notes and pending marks; "start over" allows a rebuild; report changes).
- [x] **G-02** Removed createProductDiagram/offerProductDiagram; /plan3 diagram and architecture only open the workspace; empty Project tab says "No project diagram yet. Generate one, or draw with the bar above."; README offer line dropped; the old declined setting is simply ignored.
### Phase 6b: Direct manipulation on the canvas [code]

- [x] **U-01** Tabs read "UML Project"/"UML Plan" (desktop and phone) with an inline SVG diagram icon; Select, Box and Group carry pointer, card and dashed-group icons; the chosen swatch is larger with a focus-colored ring.
- [x] **U-02** Box/Group press-drag draws with a live .draw-preview in the chosen color; release creates at drawn w/h (≥120×60, else click = default size); drawn groups adopt enclosed boxes (D13).
- [x] **U-03** Creation opens no dialog (server default labels New box/New group N, tool returns to Select); A+ cursor on .node-label, click opens the pre-filled label dialog; renaming a pending add rewrites its own chat line.
- [x] **U-04** Group title band has grab cursor and moves the group; corner .resize-handle on groups and boxes resizes (layout, no chat line); groups keep min w/h (D10).
- [x] **U-05** Dragging a box onto a group (lit .drop-target) reparents it in; onto empty canvas moves it out; one Move line each (D11).
- [x] **U-06** Hover shows side-midpoint .connect-handle (pointer); drag with live .connect-preview onto another element connects; self/duplicate add nothing.
- [x] **U-07** Edge click opens its label dialog; label and edge dialogs have #comment-delete, which arms to 'Confirm: delete <what>' (incl. 'and N inside') before deleting; undoing a drawn group rescues adopted settled boxes.
- [x] **U-08** C3 rewritten for Phase 6b gestures (visible-point helper avoids handles/overlays), C1 rescue assert, README Editing (desktop) line.

### Phase 7: Agent behavior trial [think]

- [x] **J-01** Live run on scratch plan 7f809491: three toolbar edits via the live server + Send; the agent added D2 and step S-02, then settled exactly the four pending marks (incl. the earlier unsent Sync API add, listed in pendingEdits); no wording change needed. Caveat: the receiving agent was this session, so the judgment of how well edits were taken in is biased — H-01 is the unbiased check.

### Phase 8: Live acceptance [human] [code]

- [wip] **H-01** User tries the flow on the desktop and records findings: new plan, empty Plan tab, draw, send, red marks clear.
  - Covers acceptance examples X1–X6 below; on the phone only viewing and notes (Q-01).
  - note: User sketch on the real Plan tab (rev 5): group "New group" (blue) with boxes "Ke pasa" and "New box" inside; one Send produced three @mention chat lines with diagram context. Agent treated them as test placeholders (no plan content), settled exactly those three; red cleared. Not yet exercised: connection drawing, connection label/delete.
  - note: Second sketch (rev 8): side-handle connection "New box" → "Ke pasa" inside the group, plus a top-level box "New box 2"; one Send gave two chat lines; agent settled exactly those two (edge + node). Connection label/delete via the edge dialog not yet exercised; no user feedback on feel yet.
  - note: Third sketch (rev 13): edge label "connection" via the connection dialog worked; settled. FINDING: top-level "New box 2" snaps back on drag. Reproduced with layout(): drops at (608,-37),(204,-77),(1200,-37),(-400,0) all render at 654,209 — the D10 grid collapses empty cells, so a pin only orders boxes, and a pin colliding with the group's cell is pushed to the nearest free cell. Awaiting user decision: free placement at top level vs keep grid.
### P-ARCH [code] Product architecture

- [x] **ARCH-RECONCILE** Product diagram rev 5: plan3_diagram (pending marks, directions), plan3_web (edit/Generate endpoints), browser_app (Project/Plan tabs, editing bar, drag-moves-box), plan3 (Generate prompt, no product offer), plan3→settings edge relabeled "phase models". No nodes or edges added or removed; dependents unaffected.


## Global validation

Acceptance examples:
- X1 A new plan's Plan tab is empty and shows the draw-or-generate hint; the Project tab shows the product diagram or its own empty hint.
- X2 Zooming out never collapses groups or lifts edges; there is no overview band.
- X3 Adding a group "Backend" in green and a box "Cache" inside it draws both red and green-toned and adds two chat lines; after Send the agent updates the plan and both turn normal.
- X4 Deleting the connection API to DB draws it red with an X; after the agent settles it, it is gone.
- X5 Generate opens a text box with last time's directions; editing and sending updates the diagram; reopening shows the edited text.
- X6 ask_user with `initialText` shows the text ready to edit in the terminal and in the browser, and returns the edited text.

Checks: C1–C7 pass for touched code; C8 once before any push.

## Resume context

23/25; Phase 6b (U-01..U-08) done and committed locally (not pushed). NEXT J-01 live check with scratch plan 7f809491 (archive after), then H-01. Never push; bump 0.1.41→0.1.42 only before push. Leave other-session dirty files unstaged (work-images.ts, test-work-compaction-notifications.mjs, logs sidecars, scratch plan).

## Backlog

- Use the pre-filled text box for night mode rules (`extensions/plan3-night.ts` uses `ctx.ui.editor`, which does not reach the browser), editing a saved idea's text, and reviewing a drafted commit message.
- Touch editing on the phone (Q-01 chose desktop only for now).
- Undo and redo for toolbar edits beyond deleting a pending add.
- A terminal command to run Generate without the web page.

## Amendments

Append material changes and their reasons; preserve the original request and settled decisions.

- 2026-10-15 review (plan3-advisor, Astra), each finding checked in the code:
  - F1 accepted: chat lines and Send target one diagram (`app.ts` `post` sends one `target`); A2, E-05 now bind lines to their diagram.
  - F2 accepted: cross-group edges are bundled and hidden without focus (`diagram.ts` ~89, `styles.css` ~98); E-02 keeps pending edges out of bundles.
  - F3 accepted: node removal cascades (`plan3-diagram.ts` ~168–179); E-01 returns removed ids, E-05 drops all lines about them.
  - F4 accepted: `loadPlan3Ask` still allows external pi-ask-user 0.16.x without `initialText`; A-01 adds a terminal `ctx.ui.editor` fallback (assumption over 95%: rare setup, keeps Generate working).
  - F5 accepted: `saveDiagram` needs the current revision; G-01 reloads and saves only directions, sends nothing on failure.
  - F6 accepted: C2 stubs `post`; endpoint behavior checks moved to C5's real-session harness.
  - F7 accepted: R7 now limits pending marks and chat lines to meaning edits.
  - Own check accepted: single-question ask_user uses `ctx.ui.input` (no pre-fill); A-01 switches it to `ctx.ui.editor` when `initialText` is set.
  - Own check accepted: `emptyDiagram` is also called in `plan3-diagram.ts`; M-02 names every caller.
- 2026-10-15: Q-01 to Q-03 answered (desktop-only bar, Generate updates in place, remove automatic product-diagram creation and offer). E-03, G-01, G-02 and H-01 now state the chosen behavior; G-02 also names the README line and the test block to drop.
- 2026-10-15: Added final architecture reconciliation because a product diagram exists.
- 2026-10-15: Added U-01 to U-08 (Phase 6b) after G-02: User feedback at the start of J-01 (2026-10-15): the bar should work by direct manipulation (drag to draw, grab to move or resize, side handles to connect, click a label to edit or delete) instead of tool-then-dialog. J-01 waits for it.
