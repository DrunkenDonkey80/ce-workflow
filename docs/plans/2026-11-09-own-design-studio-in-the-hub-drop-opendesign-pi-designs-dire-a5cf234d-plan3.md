---
plan3: true
status: ready
created: 2026-11-09
updated: 2026-11-09T11:40:03.820Z
size: plan
reviewed: 2026-11-09
---

# Own design studio in the hub: drop OpenDesign, Pi designs directly with comments and device frames

## Original request

> loook... we have opendesign incorporated and are using it through cli. but it is a too fucked up solution, because we are working via remote in pi-hub, so cli stuff with OD is just a bad workaround. can you clone OD somewhere and look at its source, the idea is for us to fully implement what OD does - our design sessions that display the stuff to be able to create the stuff like OD does, talk our way to perfection, clone design ideas from sites, use frontend design and whatever other ideas OD has in its sleeve, one big thing OD has is the ability to click on any component in the web page and add a comment to it, something similar we have in the UML digrams, so that message is put in the chat and you can have many comments for various components then hit submit and it makes the new version, then we use it. you already have mobile and desktop versions of the design, I think thats good enough for web pages, for applications (we will be making a lot of these) we may have different screen sizes like small and large phones, landscape and portrait, tablet, etc. lets make this right and drop OD completely from the equation

User comment in round 1 (on comments): "no idea if pins is better or like in diagram the controls to have distinct ids internally that I can click on a control and typing something mentioning it. if pin is enough for the llm to find out wtf I'm talking about then yes. mind you, the design agent should be able to see the rendered page or part of it at any point of time, in any resolution so we gotta think about it can switch tablet mobile phone landscape etc and receive the result report"

## Goal, requirements, and non-goals

Goal: design sessions in the hub work fully without OpenDesign. The session's own agent builds the design while the user watches it live, from any device including a remote phone. The user refines it by talking, by clicking elements to comment, by hand edits and by drawing, at any device size, and then selects it for implementation.

Builds on design sessions v2 (`docs/plans/2026-11-05-design-sessions-v2-live-preview-session-subtitles-select-and-ff701750-plan3.md`, done). Hub sessions per design, 🎨 rows, subtitles, the live preview, select (ask where, delta) and clone (fork) all stay. Only their OD backing changes.

Requirements:
- **R1 Local build loop (D1).** `design start` creates one folder and one hub session per direction. That session's agent writes the design itself, and the preview reloads on every save. No OD process, CLI, project or polling.
- **R2 Design guide (D8, D7).** Design sessions get a compact guide: frontend-design plus OD's craft rules, `data-id` on meaningful elements, one HTML file per screen, a deck framework for the deck kind, and generated images allowed (D15).
- **R3 Write guard (D9).** Design sessions can write and edit only inside their own folder and the shared references folder.
- **R4 Agent sees the render (D3).** `design look` renders any screen at any preset or size, optionally one element, headless, and returns a small image plus a report (overflow, console errors, failed resources).
- **R5 Device frames (D4).** One device picker with every preset plus rotate, scaled to fit the panel, remembered per design.
- **R6 Screens (D7).** A screen picker lists the design's HTML files, `index.html` first.
- **R7 Comments (D2).** Comment mode: click an element, type a note, and a numbered pin appears while a line goes into the chat box. Any number of comments go out with one Send.
- **R8 Hand edits (D12).** Direct CSS edits and Tweaks values apply live in the preview. "Keep" adds a chat line for the agent to write.
- **R9 Draw (D13).** "Mark" renders the current screen at the current device size and opens it in the existing image annotator. The result goes into the chat as an image plus its note lines.
- **R10 Versions (D5).** Every agent turn that changed the design is kept as a version. The preview can step back and forward, and Restore brings one back as a new version.
- **R11 Site references (D6).** `design reference <url>` saves headless screenshots plus measured style tokens, with browser_fetch as the fallback.
- **R12 Design-system library (D14).** List OD's design systems and fetch the chosen one on demand into a cache. The project's own system is offered first.
- **R13 Decks (D16).** A deck design kind with a fixed 1920×1080 framework and slide navigation in the preview, and slide numbers in comment lines. HTML only.
- **R14 Handoff at select (D15).** Select writes `HANDOFF.md` (screens, tokens, required states, viewport matrix, implementation checklist) beside the exported files.
- **R15 OD removed (D11).** No OD runtime integration remains: no client code, setting, test, fixture or README text about running OD. OD stays named only as an upstream source (provenance, D14 library, D21 catch-up). The old optional-OpenDesign plan is marked superseded.

Non-goals:
- No PPTX, MP4 or deck PDF export (user: "HTML decks only"). No OD cloud, BYOK proxy, plugins, connectors, collaboration or sharing.
- No hub-side source patching: hand edits reach the files only through the agent (D12).
- No vendored design-system catalog in the npm package (D14).
- No new hub page, list or command for designs. Everything stays in the design session page from v2.
- Not a hub redesign: the new preview controls follow the existing hub styles (`hub/web/styles.css`, `files-width` buttons, `dialog.compact`).

## Glossary

- **Design session**: a hub Pi session bound to one design handle (`design-N`) whose agent builds that one design. Avoid: OD session, design run.
- **Design folder**: `.pi/designs/<handle>/`, the working files of one design and the only place its session writes. Avoid: mirror (v2 term, gone with OD).
- **Bridge**: the script the hub injects into a design page it serves. It handles comment picking, pins, live CSS edits, Tweaks and slide navigation over `postMessage`. Avoid: overlay.
- **Comment line**: one line in the chat box made by a click in Comment mode, naming the screen, the element and the note.
- **Device preset**: a named preview size (Phone small, Phone, Phone large, Foldable, Tablet, Laptop, Desktop, Slide), rotatable. Used by both the preview and `design look`.
- **Version**: a snapshot of the design folder after an agent turn that changed it, numbered from 1 per design.
- **Reference**: a captured site in `.pi/designs/references/<site>/` (screenshots plus `STYLE.md` of measured tokens).

## Decisions

- **D1 The design session's own agent builds the design (user decision, round 1).** Each design hub session's Pi agent writes the design files itself into `.pi/designs/<handle>/`. The preview reloads on every save through the existing live viewer (`hub/src/explore.ts` watch and `file-changed`). No OD project, run, watcher or mirror. The design session model must be a strong model, so the `workOrchestrator.designModel` setting text changes ("cheap fast model" is wrong now). Rejected: a subagent per message (more code, can't be watched or steered mid-build). Source: user via ask_user. (ADR candidate: dropping an external design engine for the in-session agent is hard to reverse and beat a background-subagent design.)
- **D2 Comments are pins plus lines in the chat box, sent together (user decision, round 1, with comment).** Comment mode: click an element in the preview, type a note, a numbered pin shows on it and one line goes into the chat box. The user adds any number and presses Send once, like the diagram edit lines (`hub/web/app.ts` `addEditLine`). The user's comment asked whether pins alone tell the model what is meant, or whether controls need distinct internal ids like the diagram. Resolution (agent proposal from OD's source): both. The guide asks the agent to give meaningful elements a stable `data-id` (OD does this with `data-od-id`, `apps/daemon/src/prompts/official-system.ts` "Inspectable HTML"). The line names the screen file, that id (`@hero-cta`, or a short CSS selector when the element has none), its tag and its visible text: `(1) index.html @hero-cta <button> "Get started": make it bigger`. The agent can call `design look` on that element for its geometry. The pin is only the visual marker. Refined while planning: no hidden context block, because the visible line is enough and stays editable.
- **D3 The agent can see the rendered design at any device size (user requirement, round 1 comment).** A `design look` action renders a screen of the session's design headless at a device preset or a width by height size, optionally one element (by `data-id` or selector) or the full page. It returns a small screenshot plus a report: horizontal overflow, elements wider than the viewport, console errors, failed resources. It accepts several presets in one call. agent-browser 0.41.1 is installed and has `set viewport`, `eval`, `console`, `errors` and `screenshot`. `extensions/screen-read.ts` already drives it headless, and it never opens a window on the user's screen.
- **D4 One device picker with every preset plus rotate (user decision, round 1).** Presets from OD's viewport matrix (`apps/web/src/runtime/exports.ts` line 258): Phone small 360×800, Phone 390×844, Phone large 430×932, Foldable 600×960, Tablet 820×1180, Laptop 1366×768, Desktop (panel width), plus Slide 1920×1080 for decks (D16). Rotate swaps width and height. The frame scales down to fit the panel. The last choice is remembered per design.
- **D5 Automatic versions with back, forward and restore (user decision, round 1).** After each agent turn that changed the design folder, its files are copied to `.pi/designs/history/<handle>/<n>/` (the last 30 are kept). The preview shows "vN ◂ ▸" to view older versions read-only. Restore copies one back as a new version, so nothing is lost. Select records which version it exported.
- **D6 Site references: headless capture plus measured tokens (user decision, round 2).** `design reference <url>` opens the page in agent-browser (headless) and takes Desktop and Phone screenshots. It also reads the computed colors, font families and sizes, spacing, radii and shadows of the main elements (body, headings, links, buttons, nav, cards) into `STYLE.md` beside them. If the site blocks headless browsing, browser_fetch with images is the fallback (the user's real browser, approved once per site). Output goes to `.pi/designs/references/<site>/`, shared by every design in the folder (agent proposal: several directions can use one capture). The guide says to borrow style and structure, never logos, brand marks or copy. The method comes from OD `skills/brand-extract/SKILL.md` (measure, don't guess).
- **D7 One HTML file per screen plus a screen picker (user decision, round 2).** The guide tells the agent to write one HTML file per screen (`index.html` first, shared `styles.css`). The preview shows a screen picker beside the device picker. `design look` and comment lines name the screen file.
- **D8 A compact design guide with OD's craft rules (user decision, round 2).** One guide of about 150 lines for design sessions: the frontend-design skill as-is plus the OD rules that apply. Those rules: real content and no filler; ask before adding sections; state the visual system before building; 44 px touch targets; avoid overused fonts and gradient slop; cover hover, focus, empty, loading and error states; stable `data-id` (D2); keep `DESIGN.md` (tokens, type scale, components) current in the design folder; one `design look` self-check at the end, not loops. Sources: OD `craft/*.md`, `apps/daemon/src/prompts/official-system.ts`, `discovery.ts`. Apache-2.0 attribution in a provenance note like `skills/frontend-design/UPSTREAM.md`.
- **D9 Design sessions write only inside their design folder (user decision, round 2).** In a design session a `tool_call` guard refuses `write` and `edit` outside `.pi/designs/<handle>/` and `.pi/designs/references/`. Reading the repo stays free. bash is covered only by the guide. The chosen design is built after select in a normal session, as today.
- **D10 All seven OD extras are in scope (user decision, round 3).** The user picked every offered extra: the handoff contract at select, generated images, the Tweaks panel, drawing on the preview, direct CSS edits, the design-system library and slide decks.
- **D11 Remove OpenDesign completely and mark the old plan superseded (user decision, round 3).** Delete:
  - `extensions/opendesign-client.ts`. `redactOpenDesignText`, which `work-models.ts` still uses for knowledge redaction, moves to a neutral name and module.
  - `scripts/test-work-opendesign-client.mjs` and `scripts/fixtures/opendesign/`.
  - The `/wo` Settings row "OpenDesign executable" (`work-models.ts`, `test-work-wo-control.mjs`).
  - The OD-run early return in `plan3.ts` (line 693) and the ask_user block in `ask-user/index.ts` (line 2859).
  - OD text in README, `tool-loader.ts` and the design tool.

  Set `docs/plans/2026-10-08-optional-opendesign-phase-for-plan3-1fc5d5ce-plan3.md` to superseded with a note (its `/plan3 design` code is already gone; only `fake-od.mjs` mentions `DESIGN-HANDOFF`). Old exports in `docs/designs/` stay as history.
- **D12 Hand edits apply live, and Keep goes through the chat (user decision, round 4).** Direct CSS edits (an inspector for the clicked element: color, background, font size and weight, padding, margin, gap, radius) and Tweaks panel values change the page at once through the bridge. "Keep" adds a line such as `Set index.html @hero-cta: font-size 20px; color #c2410c` or `Keep tweaks: accent #c2410c, scale 1.125` to the chat box. The agent stays the only writer, so the files stay clean and there is one version per turn (D5). Rejected: hub source patching (OD's `edit-mode/source-patches.ts` is 739 lines, and it adds a second writer).
- **D13 Draw = render, then the existing annotator (user decision, round 4).** "Mark" asks the hub to render the current screen at the current preset with the D3 renderer. The PNG opens in `hub/web/annotate.ts` (pen, arrows, boxes, numbered markers). Saving puts the image path plus its legend lines into the chat box, the same as an annotated pasted image (`app.ts` `annotateImage`). The frame is sandboxed to an opaque origin, so the hub page cannot screenshot it.
- **D14 Design-system library fetched on demand (user decision, round 4).** `design systems` lists OD's packages (154 at commit 07a86b1) from a cached index of the GitHub tree. Picking one, at start or later, downloads only its `DESIGN.md` and `tokens.css` (Apache-2.0, plus the package's `manifest.json` source note) into `.pi/designs/systems/<name>/`. The project's own system (its `DESIGN.md` or CSS tokens) is offered first. Nothing is added to the npm package.
- **D15 Handoff contract and generated images (user decision, round 3).** Select writes `HANDOFF.md` from code: the screens list, the version, the agent's `DESIGN.md` tokens, required states, the viewport matrix (D4 presets), and an implementation checklist adapted from OD `exports.ts` `buildDesignHandoffContent`. Chrome marked `data-design-chrome` (the Tweaks panel) is listed as "not product UI". The guide lets the agent use generate_image for real visuals saved under `assets/`.
- **D16 HTML decks with slide navigation, no PDF (user decision, round 4).** `kind: deck` at start. The guide carries a small fixed deck framework: a 1920×1080 stage scaled to fit, arrow keys, `data-screen-label` per slide, and the slide position in `location.hash`. Assumption (over 95% from the sandbox CSP in `explore.ts`): localStorage throws in the opaque-origin frame. The preview shows the Slide preset with previous and next buttons and the counter, and comment lines include `slide N`.
- **D17 Prefactor the design preview out of the Files viewer (agent, project-care fit check).** Design controls live inside `hub/web/files.ts` today (lines 108-113, a `from.design` branch), and this plan adds about ten controls there. A design view module (`hub/web/design-view.ts`) that owns the frame, presets, screen and version pickers and the bridge messages keeps files.ts the generic viewer. A small prefactor step first, with no behavior change.
- **Q-01** What should select export besides the design files, now that there is no OD conversation?
  - Context: v2's select wrote `CONVERSATION.md` and `COMMENTS.json` from OD's API (`design.ts` `notes`). The chat now lives in the design session's Pi session file. D15 adds `HANDOFF.md`.
  - Recommendation: `BRIEF.md` (brief, direction, kind, design system, references used) plus `HANDOFF.md`, and no chat transcript. The implementer needs the decisions, not the back and forth.
  - Option: BRIEF.md plus HANDOFF.md — small, decision-focused.
  - Option: Also export the user's chat messages — full history of what was asked, noisier.
  - Independent: yes
  - Answer: {"kind":"selection","selections":["BRIEF.md plus HANDOFF.md"]}
  - Source: user via ask_user /plan3 resolve; not independently verified.
- **Q-02** Does Restore run through the agent or directly in the hub?
  - Context: D5 restore copies an old version back as a new one. D12 keeps the agent as the only writer of design files.
  - Recommendation: the Restore button sends "Restore version N" as a chat message, and the agent calls `design restore`. There is one writer and no race with a running turn, and it costs one short turn.
  - Option: Through the agent — consistent, one short turn.
  - Option: Hub copies directly — instant, but a second writer that can race a running turn.
  - Independent: yes
  - Answer: {"kind":"selection","selections":["Through the agent"]}
  - Source: user via ask_user /plan3 resolve; not independently verified.
- **Q-03** Does the design-system library follow OD's main branch or a pinned commit?
  - Context: D14 fetches packages from github.com/nexu-io/open-design. Main changes often (the clone at 07a86b1 was hours old).
  - Recommendation: main, with the commit recorded in the cache so a design names exactly what it used; `design systems refresh` updates the index.
  - Option: Main plus a recorded commit — current, traceable.
  - Option: Pinned commit in code — stable, but bumped by hand.
  - Independent: yes
  - Answer: {"kind":"selection","selections":["Main plus a recorded commit"],"comment":"so catchup will be able to check for new stuff in OD skills right?"}
  - Source: user via ask_user /plan3 resolve; not independently verified.
- **D18 Select exports BRIEF.md plus HANDOFF.md, no chat transcript (Q-01 answer).** `BRIEF.md` holds the brief, direction, kind, design system and references used. v2's `CONVERSATION.md` and `COMMENTS.json` go with OD. Source: user via /plan3 resolve.
- **D19 Restore runs through the agent (Q-02 answer).** The preview's Restore button sends "Restore version N" as a chat message, and the agent calls `design restore`, which copies that version back as version n+1. The agent stays the only writer. Source: user via /plan3 resolve.
- **D20 The library follows OD main and records the commit (Q-03 answer).** The cached index and every fetched package record the OD commit they came from, `design systems refresh` updates the index, and a design's `BRIEF.md` names the system and its commit. Source: user via /plan3 resolve.
- **D21 Catch-up watches OpenDesign through a scoped ledger (user decision, from the Q-03 comment).** The user asked whether catch-up will check OD for new things. It would not as planned: catch-up reviews only `PLAN3_CATCH_UP_PACKAGES` (`extensions/plan3-catch-up.ts` line 9). Add `nexu-io/open-design` as a git source like `mattpocock/skills`: a list entry, and a baseline entry in `extensions/work-catch-up-baseline.json` at the commit ported from (07a86b1 unless re-cloned). Also add `docs/upstream/open-design.md`. The ledger lists what was ported and where it lives here. It limits the review to `craft/`, `skills/`, `design-templates/`, `apps/daemon/src/prompts/`, `apps/web/src/runtime/comment-bridge.ts`, `apps/web/src/comments.ts` and `apps/web/src/runtime/exports.ts`, because OD commits many times a day. New design systems need no catch-up (D20). Source: user via ask_user.




## Open questions

### Blocking

None.

### Deferred

None.

## Relevant files and approach

OD source studied in a throwaway clone (`%TEMP%/pi-research-G9n9tQ/od`, nexu-io/open-design at 07a86b1, Apache-2.0). Ideas taken:
- The comment bridge (`apps/web/src/runtime/comment-bridge.ts`).
- The comment context format (`apps/web/src/comments.ts` line 476).
- The inspectable-id rule and craft prompts (`apps/daemon/src/prompts/official-system.ts`, `discovery.ts`, `craft/*.md`).
- The viewport matrix and handoff (`apps/web/src/runtime/exports.ts` lines 258 and 280).
- brand-extract (`skills/brand-extract/SKILL.md`).
- `design-systems/`.

The frontend-design skill (`skills/frontend-design/SKILL.md`) governs the designs the sessions produce, not the hub controls. The hub controls reuse the existing hub tokens and components (`files-width` toggle buttons, `dialog.compact`, `confirmBox`, the annotator).

Fit check per module:
- `extensions/design.ts` (487 lines; 6 commits) — **fits**, rewritten in place. The OD calls, run watcher, mirror, retry, add and send all go. It keeps start, open, select and clone, and gains the guide hook, write guard, look, reference, systems, versions and restore. Store `sessions.json` moves to version 2 (OD fields ignored when a v1 file is read).
- `extensions/design-render.ts` (new) — **fits**: one deep module driving agent-browser (serve a screen under the hub's sandbox CSP, render it at a size with the S06 render-state, collect the report, screenshot, measure styles; one isolated browser session per capture). Two callers: `design look` and `reference` in design.ts, and the hub's Mark render.
- `extensions/design-guide.md` plus provenance note (new) — the guide text (D8), read by design.ts.
- `hub/src/explore.ts` — **fits**: `sendExplored` already serves every design file, so bridge injection into HTML served for an own design key lands there. `designPage` extends to a screen file and a version folder.
- `hub/src/design-bridge.ts` (new) — the bridge script text, injected before `</body>`. It handles picking, pins, inline style edits, Tweaks messages and slide navigation.
- `hub/src/api.ts` — **fits**: the `designpreview` case gains `screen` and `version`, and a `designshot` case renders for Mark (D13) through design-render.ts.
- `hub/web/files.ts` — **small prefactor** (D17): the design branch moves out to `hub/web/design-view.ts`.
- `hub/src/hub.ts` — **fits**: every browser module is listed in `ASSETS` (line 72), which also feeds the build hash; `design-view.js` is added there in S01.
- `hub/scripts/test-sessions.mjs` — its busy-line case uses an "OpenDesign building" label (line 62); reworded to a neutral extension busy line in S17. The hub's busy mechanism itself stays.
- `hub/web/design-view.ts` (new) — device, screen and version pickers, rotate, scale to fit, Comment, Edit, Mark and Keep, pins, slide nav.
- `hub/web/app.ts` — **fits**: comment and keep lines reuse the `addEditLine` pattern; Mark reuses `annotateImage`.
- `hub/web/styles.css` — preview controls, the device frame, the inspector popover.
- `extensions/work-models.ts` — **fits**: remove the OD row; rewrite the designModel description; import the moved redact helper.
- `extensions/opendesign-client.ts` — deleted (D11). The redact helper moves to the module work-models.ts already imports for knowledge, or a small `extensions/redact.ts`; decide at the step by reading its callers.
- `extensions/plan3.ts`, `extensions/ask-user/index.ts`, `extensions/tool-loader.ts` — **fits**: OD lines removed or reworded.
- `scripts/test-work-design.mjs` — rewritten for the local loop (no OD fake). Hub tests: `hub/scripts/test-explore.mjs` (injection, screen and version paths), `test-api.mjs` (`designpreview`, `designshot`), `test-browser.mjs` (page controls).
- `README.md` "Design sessions" section, `hub/README.md`, `CHANGELOG.md` Unreleased.
- `docs/plans/2026-10-08-optional-opendesign-phase-for-plan3-1fc5d5ce-plan3.md` — status superseded (D11).

## Commands

- C1 `node scripts/test-work-design.mjs`
- C2 `node --no-warnings hub/scripts/test-explore.mjs`
- C3 `node --no-warnings hub/scripts/test-api.mjs`
- C4 `node --no-warnings hub/scripts/test-browser.mjs` (record its baseline before the first hub web change)
- C5 `node --no-warnings hub/scripts/test-annotate.mjs`
- C6 `node scripts/test-work-wo-control.mjs` and `node scripts/test-work-settings.mjs`
- C7 `node scripts/test-work-plan3.mjs`, `node scripts/test-work-ask-user.mjs` and `node scripts/test-work-tool-loader.mjs`
- C8 `node scripts/test-work-knowledge.mjs` (the redact helper move)
- C9 LSP check of changed `.ts` files: lens_diagnostics source=lsp scope=paths
- C10 `node --no-warnings hub/scripts/test-sessions.mjs`

## Phases

### Phase 1: Local design loop [code]

- [x] **S01** Design preview controls moved to hub/web/design-view.ts (designControls, resetDesign); registered in hub.ts ASSETS.
- [x] **S02** design.ts rewritten for the local loop: store v2 (brief, kind, inputs, references, system), v1 migration, start/open/show/status/select/clone without OD; watcher, mirror, send, retry, add removed.
- [ ] **S03** Design-session hooks: write guard on write and edit (D9), one shared snapshot function for versions (D5), `design restore`, designModel description updated
  - `snapshot(handle)`: copy the folder to the next history number unless it equals the newest version; returns the version. Called at agent_end, first in select (which then exports that immutable version) and first in restore (so pending edits are kept as their own version before the old one is copied back).
  - Check: C1 cases: write outside refused and inside allowed; an unchanged turn adds no version; edit then select in one turn exports the edited bytes under a version number; edit then restore keeps the edit as a version; no duplicate at agent_end; 30 kept. C6, C9.

### Phase 2: Rendering for the agent [code]

- [ ] **S06** extensions/design-render.ts: render a screen at a size (element or full page) and return a PNG plus a report of overflow, console errors and failed resources
  - Render-state contract: `{folder (design or history version), screen, width, height (rotation already applied), hash (deck slide), styleEdits[] (live, unsaved inline edits)}`. Edits are applied by eval after load, never written to files.
  - Sandbox parity: the folder is served on a short-lived 127.0.0.1 port with the same sandbox CSP as `sendExplored` (one shared constant), not `file://`.
  - Isolation: every capture uses its own agent-browser session (`design-<handle>-<random>`), closed afterwards, so look, reference and Mark never share a page or viewport.
  - agent-browser commands: `set viewport`, `open`, `eval` (report), `errors`, `console`, `screenshot [selector]`. Headless only.
  - Check: a new self-check in C1 against a fixture page with a known overflow and a console error, two overlapping captures at different sizes each get their own size, and a styleEdit shows in the shot; skipped with a notice when agent-browser is missing.
- [ ] **S07** `design look` (one or more presets, screen, element) returns small images plus the report; `design reference <url>` writes references/<site>/ screenshots and STYLE.md (D6)
  - Reference fallback: when headless gets a bot wall or an empty body, the result tells the agent to use browser_fetch with images and save into the same folder.
  - Check: C1 with the fixture page for look; reference against a local fixture page served by the test.

### Phase 3: Design guide [think]

- [ ] **S04** Write extensions/design-guide.md (D8, D2 data-id, D7 screens, D15 images, D16 deck framework) plus a provenance note; design.ts injects it in design sessions
  - Judgment: which OD craft rules earn their tokens. Keep about 150 lines, and test them in S05's live trial.
  - Check: C1 asserts the guide reaches a design session's system prompt and not other sessions'.
- [ ] **S05** Live trial: one web and one app design built by a design session; tune the guide wording from what the agent got wrong
  - Verdict to record: does the agent keep `data-id`s, one file per screen, real content, and finish with one look? Note the misses fixed.
  - Needs: the hub running and a strong designModel. Run in a throwaway folder under Temp.

### Phase 4: Preview controls [code]

- [ ] **S08** Device picker with every preset plus rotate, frame scaled to fit, choice remembered per design (D4); screen picker from the design's HTML files (D7)
  - The hub `designpreview` accepts `screen`. `designPage` allows any `.html` directly in the design folder.
  - Live metadata: for own design keys the hub also watches the design folder and `.pi/designs/history/<handle>/` for added or removed screens and new versions, and publishes `design-changed {key}`. design-view refetches the screen and version lists. Generic viewers are unchanged.
  - Check: C2 (screen path confinement; adding and removing a screen and adding a history folder each send one design-changed), C3, C4 (the picker updates while the preview stays open).
- [ ] **S09** Versions in the preview: "vN ◂ ▸" shows history folders read-only through designpreview {version}; Restore sends a chat message (D19)
  - Check: C2 (a history path confined to its own handle), C3, C4.

### Phase 5: Bridge, comments and hand edits [code]

- [ ] **S10** hub/src/design-bridge.ts injected into HTML served for own design keys; Comment mode picks an element and posts {screen, id or selector, tag, text, rect}
  - Pins are drawn by the bridge inside the page from a pin list the parent sends after every load, so they survive live reloads.
  - Trust: the page accepts bridge messages only when `event.source` is the current frame's `contentWindow` and they carry the frame's load id. Each message type has a bounded schema (text 160 chars, selector 300, numbers finite). Anything else is dropped. Messages only fill the chat box; sending always stays a user action.
  - Check: C2 (injected only for own design keys, not other explored pages), C4 (messages from another frame, a stale load and malformed payloads are ignored).
- [ ] **S11** Comment flow: a note popover, numbered pins, D2 lines added to the chat box; deleting a line drops its pin; sending clears the pins
  - Reuses the `addEditLine` and `dropEditLines` pattern in app.ts.
  - Check: C4 page test with a fixture design: two comments give two lines and two pins; a removed line removes its pin.
- [ ] **S12** Edit mode inspector (D12): computed values of the clicked element, live inline changes through the bridge, Keep adds a Set line; Tweaks messages get a Keep tweaks line
  - Tweaks contract in the guide: the page posts `{type: "design:tweaks", values}`, and the panel is marked `data-design-chrome`.
  - Check: C4.
- [ ] **S13** Mark (D13): hub designshot renders what the preview shows, opens it in the annotator, and the saved image path plus legend go into the chat box
  - It passes the S06 render-state: the shown version, screen, rotated size, deck slide hash and unsaved inline edits.
  - Check: C3 (designshot confined to the session's own design; Mark on a non-first slide, an older version and a live CSS edit each render that state), C5, C4.
- [ ] **S14** Deck kind in the preview (D16): the Slide preset, previous and next through the bridge, the slide counter, and `slide N` in comment lines
  - Check: C4 with a fixture deck.

### Phase 6: Library and handoff [code]

- [ ] **S15** `design systems` lists OD packages from a cached GitHub index; picking one fetches DESIGN.md, tokens.css and the manifest source into .pi/designs/systems/<name>/ (D14, D20)
  - Start accepts `system`. The project's own `DESIGN.md` or tokens file is listed first.
  - Check: C1 with a fake fetch (index, one package, offline cache hit).
- [ ] **S16** Select writes HANDOFF.md (D15) and BRIEF.md (D18), records the exported version, and keeps the v2 ask-where and delta flow
  - Check: C1 (HANDOFF.md lists the screens, version, presets and chrome note; reselect delta unchanged).

### Phase 7: Remove OpenDesign and document [code]

- [ ] **S17** Delete opendesign-client.ts, its test and fixtures; move the redact helper; remove the OD settings row, the plan3 and ask-user OD guards, and the tool-loader OD text (D11)
  - Also: the redaction assertion from the deleted client test (`test-work-opendesign-client.mjs` line 661) moves to the helper's new test; `test-work-knowledge.mjs` OD sample claims point at existing paths if the test checks them; `test-sessions.mjs` busy label reworded.
  - Check: `rg "opendesign-client|callOpenDesignTool|openDesignCommand|OD_PROJECT_DIR|OD_STOCK_RUN_ID|redactOpenDesignText"` over extensions, scripts and hub finds nothing. Upstream provenance, the library source (D14) and catch-up (D21) may still name nexu-io/open-design. C6, C7, C8, C9, C10.
- [ ] **S20** Add nexu-io/open-design to catch-up as a git source: list entry, baseline at the ported commit, docs/upstream/open-design.md ledger with the review paths (D21)
  - Ledger: what was ported (guide rules, viewport matrix, deck framework, brand-extract method, handoff checklist, comment bridge idea) and where it lives here.
  - Check: C7 (test-work-plan3.mjs has the catch-up cases, including mattpocock/skills) with a case that OD shows up as a git target with its ledger; C9.
- [ ] **S18** README design section, hub/README and CHANGELOG Unreleased rewritten for the studio; old OD plan marked superseded; changelog crops of the preview controls
  - Crops with `node hub/scripts/changelog-shot.mjs` (the `--design` flag from v2) for the device picker, comment pins and the inspector.

### Phase 8: Live check [code]

- [ ] **S19** [human] Live run on the real hub from a remote phone through the whole studio flow, from start to select
  - Flow: start an app design, comment on three elements, edit one CSS value, Mark a region, switch devices, look back a version, select into a new session.
  - Needs: a hub restart to load the new routes, plus the user present on a remote device. Record what failed and fix it before calling the plan done.

## Global validation

- C1 to C8 and C10 pass; C4 is not worse than its baseline; C9 is clean for changed files.
- No OD process, CLI, API or setting is involved anywhere in a design session's life (R15 grep in S17). OD appears only as an upstream source: provenance notes, the design-system library and catch-up.
- Acceptance examples:
  - "Start a home page, 2 directions": two 🎨 sessions appear, each agent writes `index.html`, and the preview fills in while it writes.
  - Clicking the hero button in Comment mode and typing "bigger" puts `(1) index.html @hero-cta <button> "Get started": bigger` in the chat box with pin 1 on the button. Three such comments go out in one Send, and the next version changes only those elements.
  - The Phone small preset rotated shows the page at 800×360 scaled to the panel. `design look` with Tablet returns a picture and "no overflow".
  - After three turns the preview shows v3; ◂ shows v2 read-only; Restore v1 makes v4 equal to v1.
  - In a design session, writing `src/app.ts` is refused with a message naming the design folder.
  - Select writes `docs/designs/<name>/` with the screens, `DESIGN.md`, `HANDOFF.md` and `DESIGN.json` (with the version), then asks where to implement it.

## Backlog

- PPTX, MP4 and deck PDF exports (OD `exports.ts`; user chose HTML decks only).
- Group selection by drawing a stroke around several elements in Comment mode (OD "pod" mode).
- Comment pins kept across sends as a resolved list (OD keeps comment status: open, applying, resolved).
- A frame's scroll position kept across live reloads (v2 backlog: the opaque-origin frame can't be read; the bridge could now report it).

## Resume context

Planning draft. D1-D21 settled; review A1 (9 findings) all accepted and applied: S01 registers design-view.js in hub.ts ASSETS, rendering moved before the guide trial (Phase 2 S06-S07, Phase 3 S04-S05), store v2 keeps brief/references/system commit, shared snapshot for select and restore, render-state contract and isolated capture sessions, bridge message trust checks, design-changed refresh, R15 scoped to runtime integration with fixture updates (C10). No open questions. No product code changed. After /plan3 finish the next action is S01: record C4's baseline first.

## Amendments

Append material changes and their reasons; preserve the original request and settled decisions.

- 2026-11-09: D2's "hidden context block" (agent proposal in round 1) was dropped while planning. The visible comment line plus `design look` on the element is enough and stays editable in the chat box.
- 2026-11-09: Added S20 after S17: Q-03 comment: the user wants catch-up to surface new OD ideas; accepted via ask_user (D21).
- 2026-11-09: Review A1 (plan3-advisor, gpt-6-astra, static read). Each finding checked against the code:
  - 1 S01 browser module not registered: accepted (`hub/src/hub.ts` line 72 `ASSETS` lists every served module and feeds the build hash). S01 registers design-view.js; hub.ts added to the files.
  - 2 S05 trial before the renderer exists: accepted. Rendering (S06, S07) is now Phase 2 and the guide (S04, S05) Phase 3; step IDs kept.
  - 3 Store loses brief, references and system commit: accepted (v1 keeps the brief only inside `prompt`, `design.ts` line 139). S02 store adds brief, inputs, references and system {name, commit}, with a v1 migration and restart and clone select tests.
  - 4 No live refresh of screen and version lists: accepted (`explore.ts` watches served files only; `files.ts` reload re-shows the selected file). S08 adds a design-changed event for own design keys.
  - 5 Snapshot timing vs select and restore: accepted. S03 defines one snapshot function called by agent_end, select and restore, with edit-then-select and edit-then-restore tests.
  - 6 Mark cannot reproduce the shown state: accepted. S06 defines the render-state (version folder, screen, rotated size, slide hash, unsaved inline edits) and serves under the same sandbox CSP instead of `file://`; S13 passes it.
  - 7 Shared browser sessions interleave: accepted. Each capture uses its own agent-browser session, with an overlapping-capture test in S06.
  - 8 Bridge trust not validated: accepted (the frame is an opaque origin, so origin checks cannot identify it). S10 checks `event.source` against the current frame plus a load id and bounded schemas; messages only fill the chat box.
  - 9 R15 grep contradicts the OD library and catch-up; fixtures missed: accepted (`test-work-knowledge.mjs` line 48, `test-sessions.mjs` line 62, the redaction assertion at `test-work-opendesign-client.mjs` line 661). R15 now forbids runtime integration only; S17 greps for integration symbols, moves the redaction assertion and updates the fixtures; C10 added.
