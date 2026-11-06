---
plan3: true
status: ready
created: 2026-11-05
updated: 2026-11-06T06:37:50.408Z
reviewed: 2026-11-05
---

# Design sessions v2: live preview, session subtitles, select and clone

## Original request

> now lets discuss disign tasks again. the idea - I open a design chat/tab in a small chat/preview (no files) mode:
> - we chat, the design updates visually
> - im happy with the design, I say I select this design and this goes back to the session I started the design from wiich makes the implementation plan. or if easier - to start a new session for implementing it
> - the design sessions do hide somehow, this is what we want to discuss, BUT I want to recall them at any point so I can make design updates later and the updated/delta to be implemented. suggest me ways to do so - like hide them from the list but a still provide a way to list design sessions and restore some
> - the design sessions should be having a proper name so eitither: does not include "design" word because it takes lot of space but the real name and the D icon to be a painter with a brush, or utilize the subtext space where the plan progress on other sessions is or we directly implement a subtext feature of the tabs where the name could be. so later when i want I want to see the design variants we had and the star picked one

After the agent's proposal (hiding options A-D, naming, select flow):

> for 3 I'd actually go with C, with a small handling - design sessions to be always at the bottom so they dont mess with the rest, this way regardless of the starting session I can always come back. and when I select one it will just ask new session or the existing one if it is there at all
> icon something like [palette with a brush picture]
> yeah lets have a general second line
>
> design session works with one variant only, for others we call new sessions. BUT you should be able to clone a design into a new tab to try a different approach
>
> for the preview, this is a general feature - when the underlying file changes the preview should update regardless if that is a md file, html or png or so. with html it should do so if the main html or any of the resources included are modified

Then: "1 shold ask" (a clone asks for its name) and "yeah make one good plan" (one plan, order: live preview, second line, design changes).

## Goal, requirements, and non-goals

Goal: a design is a chat with a live preview. The user refines it by talking, selects it to hand it to implementation, and can come back to it any time later for a delta.

Requirements:
- **R1 Live preview (general).** The hub's file viewer reloads when the viewed file changes, for every viewable kind: Markdown, HTML, images, text, PDF. An HTML page also reloads when any file it actually loaded (styles, scripts, images, fonts) changes. Scroll position is kept where the browser allows.
- **R2 Session second line (general).** Any session can show a short line of text under its name in the session list (`pi-hub subtitle <id> <text>`, and from extensions through the hub channel). Plan progress keeps its bar.
- **R3 One variant per design session.** A design session holds one direction. More directions are separate sessions; "clone" copies a design into a new session, asking for its name first (user decision).
- **R4 Naming and icon.** The session is named by its real direction (`Calm`, `Bold editorial`), never `design-N`; its row shows a palette-with-brush icon (🎨) instead of the first letter; its second line is the brief (`Home page`), with ★ once selected.
- **R5 Hiding (user decision, option C).** Design sessions park when idle like any session and always sort to the bottom of their folder, so the existing hide-idle fold (`+`/`−`) hides them and they never mix with working sessions. Bringing one back is opening it from the fold.
- **R6 Session page.** A design session's page shows the chat beside a live preview of the design's `index.html` (R1), with desktop and phone (390 px) width toggles. No files list, and no screenshots posted to the chat.
- **R7 Select.** "Select this" exports the design to `docs/designs/<name>/`, stars it (R4) and asks where to implement it: the session the design was started from (offered only if that session still exists) or a new session. The chosen session gets a message naming the folder. A later reselect exports into the same folder, so the delta to implement is `git diff docs/designs/<name>/`.
- **R8 Recall.** A design session can be reopened at any time (it resumes from parked), keeps its OpenDesign project, and continues where it was.

Non-goals:
- No separate design list, menu, page or `/designs` command (options A, B and D rejected for option C).
- No several variants side by side in one session (user: one variant per session).
- No HTML parsing to find a page's resources: the hub serves the page's files itself and records what it served (see D3).
- No new icon asset: the 🎨 emoji is the palette with a brush the user showed.

## Decisions

- **D1 Hiding = option C plus bottom sort (user decision).** Rejected: A (designs folded under their starting session, medium cost, lost when that session closes), B (a Designs section per folder), D (a list command or menu). Rationale (user): sorted at the bottom "regardless of the starting session I can always come back".
- **D2 Select asks where to implement (user decision).** Two choices: the starting session, only if it still exists, or a new session. The new session gets the same message as its first prompt.
- **D3 HTML resources are tracked by the hub, not the browser (agent proposal, from code).** A viewed page is served by the hub under `/x/<key>/` (`hub/src/explore.ts` `viewPage`, `sendExplored`; `hub/src/hub.ts` "Explored archives" branch), from an opaque origin, so the parent page cannot read the frame's loaded-resources list. The hub records every file it serves per key and watches exactly those; a change reloads that key's open viewers. Replaces the earlier idea of the page reporting `performance` entries.
  - Review refinement (A1, finding 4): `viewPage` reuses one key per folder, project and access mode (`explore.ts` line ~60), so per-key records would merge unrelated pages in one folder. Each open viewer gets its own key (a view id), with its own served-file set and lifecycle, dropped when the page closes or the event stream disconnects.
- **D4 Change notices travel over the existing event stream (agent proposal).** The page already holds `api/events` (`hub/src/view.ts` text/event-stream, `hub/web/app.ts` EventSource). The viewer tells the hub what it shows; the hub sends a `file-changed` event; the page reloads only that viewer. No new connection or polling.
- **D5 Subtitle is general (user decision "yeah lets have a general second line").** Stored per session by the hub, set by `pi-hub subtitle <id> <text>` or published by an extension through the hub channel's status keys (`extensions/hub-channel.ts`, the same path plan state uses). Empty text clears it.
- **D6 Clone asks for a name (user decision "1 shold ask").** Clone copies the current files and the brief so far into a new OpenDesign project and opens a new design session with the given name.
- **D7 Design output is mirrored into the project (agent proposal).** After each run the design tool copies OpenDesign's files into `.pi/designs/<handle>/` (git-ignored), which the session page previews (R6) and R1 reloads. Select exports from there to `docs/designs/<name>/` (tracked). Reuses the export path checks already in `extensions/design.ts`.
  - Review refinement (A1, finding 1): chat-link checks refuse every dot folder (`hub/src/linked-files.ts` line 22, used by the `explore` API and by `sendExplored`), so `.pi/designs/<handle>/` cannot be opened as a chat link. The hub gets a design-preview call that takes only a design session's id, resolves `<its folder>/.pi/designs/<its handle>/` itself (realpath confined to that folder, no symlink escape) and serves it through the same per-viewer keys; every other `.pi` file stays refused.
  - Review refinement (A1, findings 3, 6, 7): the mirror is rebuilt per run into a temp folder and swapped in only when complete, deleting files the run no longer has; the last mirrored run id is stored per handle, and `open`, resume and the watcher's first pass mirror any run that ended while the session was parked (the v1 watcher marks such runs "known" and skips them, `extensions/design.ts` line ~285).
- **D8 Build order (user decision "yeah make one good plan").** Live preview, then second line, then the design changes; the first two are useful alone.
- **D9 Handles stay internal (agent proposal).** `design-N` stays the stable id agents and `.pi/designs/sessions.json` use and appears in the row's hover title; only the visible name changes.
- **D10 The delta is measured against the last selection, not git (agent proposal, review finding 8).** Plain `git diff docs/designs/<name>/` misses untracked files and compares with the index, not the last selection. Select keeps a copy of what it exported in `.pi/designs/<handle>/selected/`; a reselect reports added, changed and removed files against that copy, and the message to the implementing session lists them (with `git diff --no-index <copy> docs/designs/<name>/` as the way to see the lines). The tool makes no commits.
- **D11 Exports replace, never lose (agent proposal, review finding 7).** Select builds the new export in a temp folder, then replaces the owned destination in one swap; on any failure the previous export stays. A destination without this handle's `DESIGN.json` is never written (Q-01 suffix instead).
- **Q-01** What should `<name>` in `docs/designs/<name>/` be when two designs share a name?
  - Context: R7 exports to a folder named after the design. Names come from the user (clone, D6) or the direction at start; two sessions can end up with the same name. Not decided in discussion.
  - Recommendation: a lowercase slug of the name, plus `-2`, `-3` on a clash with a folder owned by another handle; the owning handle is written in the folder (`DESIGN.json`) so a reselect finds its own folder after a rename.
  - Option: Slug plus suffix — readable, stable after renames through DESIGN.json.
  - Option: Handle folder (`docs/designs/design-3/`) — never clashes, but not readable, which the user disliked for names.
  - Independent: yes
  - Answer: {"kind":"selection","selections":["Slug plus suffix"]}
  - Source: user via ask_user /plan3 resolve; not independently verified.
- **D12 Clone is a fork: files copied one by one, chat forked (user decision on Q-02, "Widen write_file for clones" plus comment).** The user wants "a clone file by file there + if possible the session chat too like a fork. so I can say 'now make me this and this dark' and let me see it".
  - Files: `write_file` is widened only for clones: the tool may write design files (html, css, js, json, svg, images, fonts) into a project it created itself for this clone (its id recorded in `.pi/designs/sessions.json` before the first write), at the source project's own file paths (no `..`, no absolute paths, the existing path token rules), each file and the total size-capped, text files credential-checked like inputs. Every other write stays refused. Read from code: `extensions/opendesign-client.ts` lines 238-254 today allow only hashed `inputs/` and `references/`.
  - Chat: the hub forks the design session's Pi session with Pi's own `--fork <session file>` (Pi docs `docs/cli.md` line 94: copies history into a new session file in the same folder), so the clone starts with the whole conversation. The hub reads the new session file from Pi like a new session (`hub/src/sessions.ts` line ~133). The clone's first new message tells it its new handle, name and project, since its copied first message names the old ones. Not run yet.
  - Not copied: OpenDesign's own chat inside the project; the client can only read runs and messages from the daemon (`opendesign-client.ts` line ~1001), not write them. The forked Pi chat carries the conversation; the new project's first run sees the copied files.
- **Q-02** How should clone (S09) copy a design into a new OpenDesign project? Needed before S09.
  - Context: the OpenDesign client confines `write_file` to hashed `inputs/<sha16>-<name>` text files (base64, size-capped, credential-checked) and hashed `references/` images (`extensions/opendesign-client.ts` lines 238-254, enforced in `callTool` line ~839), so writing `index.html` or CSS into a new project is refused today. No project-duplicate call is known in the client (not checked against the OpenDesign app itself). Review finding 2.
  - Recommendation: Seed through inputs/. The new project gets the design's files as `inputs/` and a first prompt "rebuild this design as it is, then ..." with the new approach. No change to the write validator, which is a safety boundary; costs one OpenDesign run and the copy may differ slightly.
  - Option: Seed through inputs/ — no validator change; one extra run; text files only (images become references); copy not byte-exact.
  - Option: Widen write_file for clones — allow design files (html, css, js, images) into a project the tool itself just created, bounded by size and credential checks; exact copy, but widens a safety boundary and needs its own tests in C7.
  - Option: OpenDesign duplicate — use a project duplicate feature if the OpenDesign app has one; exact and simplest if it exists, unverified.
  - Independent: yes
  - Answer: {"kind":"selection","selections":["Widen write_file for clones"],"comment":"I literally want a clone file by file there + if possible the session chat too like a fork. so I can say \"now make me this and this dark\" and let me see it"}
  - Source: user via ask_user /plan3 resolve; not independently verified.



## Open questions

### Blocking

None.

### Deferred

None.

## Relevant files and approach

- `hub/src/explore.ts` — `viewPage` gives a viewed file's folder a key served live under `/x/<key>/`; `sendExplored` serves each file. Add: record served real paths per key; watch them (`fs.watch` per file, debounced, closed when no viewer holds the key).
- `hub/src/view.ts` — the page event stream. Add a `file-changed` event for keys or paths a page views.
- `hub/src/api.ts` — page API: `explore` case (line ~383) starts a view; add a "viewing" call so the hub knows which page shows which key or path; session list (line ~224) adds `subtitle` and design fields; sort design sessions last per folder.
- `hub/src/registry.ts` — session records (`SessionRecord`); add `subtitle` so it survives parking and hub restarts.
- `hub/src/sessions.ts` — reads published state (`pi-hub:state` handler, line ~98); store the published subtitle through the same update path as the CLI.
- `hub/src/hub.ts` — CLI HTTP routes and sidebar change notices; add the subtitle route and notify open pages.
- `hub/src/linked-files.ts` — chat-link checks (dot folders refused); unchanged, the design preview reaches `.pi/designs/<handle>/` only through the session-scoped call (D7).
- `extensions/opendesign-client.ts` — `write_file` validator; widened only for clone writes into a tool-created project (D12).
- `hub/src/sessions.ts`, `hub/src/cli.ts` — also a fork: spawn Pi with `--fork <source session file>` for a new hub record, and a `fork <id> <name>` verb (D12).
- `hub/src/cli.ts` — verbs; add `subtitle <id> <text>` (the uncommitted `prompt <id> <text>` verb from design sessions v1 stays).
- `hub/web/files.ts` — the Files viewer (`filesView.explore`, markdown and text rendering); reload the shown item on `file-changed`, keep scroll.
- `hub/web/app.ts` — `sessionRow` (line ~1770): 🎨 instead of the letter for design sessions, subtitle line below the name beside plan progress, design sort; `exploreArchive` opens viewers; events handler.
- `hub/web/styles.css` — subtitle line, design row.
- `extensions/hub-channel.ts` — publish helper; subtitle goes out as a status key.
- `extensions/design.ts` — design tool (v1 uncommitted: hub session per design, `open`, `send`, `show` with screenshots, `designModel`). Change: name sessions by direction, publish subtitle, mirror output to `.pi/designs/<handle>/` (D7), drop `show` screenshots for the preview, add `select` (export, star, ask target, message it) and `clone` (ask name), remember the starting session id.
- `extensions/work-models.ts` — `designModel` setting (v1, kept).
- `scripts/test-work-design.mjs` — design tool test with fake hub tools; must always pass fakes (real ones open real hub sessions).
- `hub/scripts/test-api.mjs`, `hub/scripts/test-hub.mjs`, `hub/scripts/test-browser.mjs`, `hub/scripts/test-explore.mjs` — hub tests to extend.

## Commands

- C1 `node scripts/test-work-design.mjs`
- C2 `node --no-warnings hub/scripts/test-api.mjs`
- C3 `node --no-warnings hub/scripts/test-hub.mjs`
- C4 `node --no-warnings hub/scripts/test-explore.mjs`
- C5 `node --no-warnings hub/scripts/test-browser.mjs` (page tests; check its current baseline before relying on it)
- C6 `node scripts/test-work-plan3.mjs` and `node scripts/test-work-tool-loader.mjs` (touched by design mode publication)
- C7 `node scripts/test-work-opendesign-client.mjs` (OpenDesign client validators)

## Phases

### Phase 1: Live preview [code]

- [x] **S01** Hub gives each View page its own key, watches the folders of the files it served, and sends a debounced file-changed {key} on the session's event stream; unview closes a key, and a session with no page for a minute closes its viewers
- [x] **S02** Files viewer reloads the shown file on file-changed for its own key (quiet re-render keeping the viewer's scroll; frames, images and media refetch with ?v=); the page closes the hub key when it closes or replaces the viewer

### Phase 2: Session second line [code]

- [x] **S03** Hub stores a per-session subtitle on the registry record (one setSubtitle path: plain, 80 chars, empty clears), set by `pi-hub subtitle <id> [text]` or the pi-hub:subtitle status key; session list returns it and open pages refresh
- [x] **S04** Session row shows the subtitle as the second line (ellipsis, full text in the title), with the plan's done/total and bar beside it when a plan runs; hidden in the folded stripe

### Phase 3: Design sessions v2 [code]

- [x] **S05** Design rows show 🎨 instead of the letter, the handle in the hover title, and sort last in their folder (api.ts stable sort on design); v1 text badge and its CSS removed
- [x] **S06** design tool: hub sessions named by direction (names arg, else first words), subtitle = title (brief's first line, ★ when selected), starting hub session kept as from; ended runs mirrored to .pi/designs/<handle>/ (fetch all first, then per-file replace and delete removed, mirroredRun and changes stored); watcher pass extracted as checkRuns; show returns folder, files, changes; screenshots removed
- [x] **S07** Design session page: page API `designpreview` (no path; handle from the session's published/saved modes, design-N only) serves only <folder>/.pi/designs/<handle>/ via explore.ts designPage + viewPage(own) with live reload; the page opens it beside the chat once it exists (retried on each session poll) with the file tree hidden and Desktop/Phone (390 px) buttons
- [x] **S08** design select (replaces v1 pick): catches up the mirror, syncs it plus CONVERSATION.md/COMMENTS.json/DESIGN.json into docs/designs/<slug>/ (DESIGN.json owner keeps renamed designs in their folder; foreign folders get -2…), stars it (★ subtitle, selected), keeps .pi/designs/selected/<handle>/ (+ .before/ for git diff), asks via showListDialog "starting session" (only if new `pi-hub session <id>` finds it) or "new session", wakes and prompts it with the folder or the added/changed/removed delta
- [x] **S09** design clone: name from args or askText; new handle + OD project, every source file copied through validateOpenDesignToolCall's new clone path (allowCloneWrites(project) only while copying: safe segments, 10 MB/file, NUL-free text credential-checked), mirror copied, hub session forked (new hub `fork <id> <name>` → POST /api/sessions/<id>/fork → Pi --fork <source file>) and told its new handle/project; failures recorded on the new handle

### Phase 4: Docs and live check [code]

- [x] **S10** README design section rewritten for v2 (names, 🎨, bottom sort/fold, live page, select, clone), hub/README verbs fork/session/subtitle + live viewer line, CHANGELOG Unreleased Added (live preview, second line) and v1 design bullets updated plus select/clone; changelog-shot.mjs --design flag made docs/changelog/0.2.36-design-row.png and 0.2.36-design-page.png
- [x] **S11** Live run on the real hub + OpenDesign in a throwaway folder (Temp/design-live) passed: start, chat with live preview reload, select into the starting session, reselect with delta, clone with a name; reopening a parked design was not exercised live (unit-tested only); fixed "1 files" wording found on the way

## Global validation

- C1 to C4, C6 and C7 pass; C5 not worse than its baseline.
- Editing a viewed Markdown file, image, page or a page's CSS updates the open viewer within about a second, on this PC and a remote page; nothing else reloads.
- A session set with `pi-hub subtitle` shows the line; clearing removes it; plan progress still shows.
- Design sessions sit at the bottom of their folder with 🎨, named by direction, brief below, ★ on the selected one, and fold away when idle.
- Select offers the starting session only when it exists; the target session gets a message naming `docs/designs/<name>/`; a reselect changes only that folder and lists added, changed and removed files against the last selection.
- The design preview opens only the session's own `.pi/designs/<handle>/`; every other `.pi` path stays refused.
- Clone asks a name and leaves the original design unchanged.

## Backlog

- Folder links for the subtitle (clicking the brief opens the starting session).
- A reloaded page frame starts at its top: the frame is sandboxed to an opaque origin, so the hub page cannot read or restore its scroll (Markdown and text keep theirs).
- Images opened in the chat's lightbox (not the Files viewer) do not live-reload yet.


## Resume context

S01-S04 committed (06a4034, 5f7be33, e76d989, 583e6ab). S05-S10 done and tested but uncommitted: they build on design sessions v1, which is still uncommitted and mixed with other sessions' changes (extensions/design.ts untracked; v1 hunks in api.ts, cli.ts, app.ts, styles.css, opendesign-client.ts, README, CHANGELOG), so they stay in the working tree until the user asks for a commit. Changelog crops are named 0.2.36-* (the next version); rename if the push gets another version. Next: S11 [human] live run with OpenDesign on the real hub (needs a hub restart to load the new routes, and OpenDesign running).

## Amendments

Append material changes and their reasons; preserve the original request and settled decisions.

- 2026-11-05: Review A1 (plan3-advisor, gpt-6-astra, static read). Each finding checked against the code:
  - 1 Preview in `.pi` refused by chat-link checks: accepted (`linked-files.ts` line 22 refuses dot folders). D7 refinement: session-scoped design-preview call; S07 check.
  - 2 Clone cannot write design files: accepted (`opendesign-client.ts` lines 238-254). The copy method is a scope and safety choice, raised as Q-02; S09 and C7 updated.
  - 3 Per-file watches miss atomic replacement: accepted (atomic writes rename over the file). S01 watches parent folders; checks added.
  - 4 Explore keys are per folder: accepted (`viewPage` id is folder, project, access mode). D3 refinement: one key per open viewer; S01 checks.
  - 5 Subtitle storage files missing: accepted (`registry.ts`, `sessions.ts`, `hub.ts`). Files list and S03 updated.
  - 6 Runs ending while parked are missed: accepted (the watcher marks them "known", `design.ts` line ~285). D7 refinement and S06 catch-up.
  - 7 Overwrite leaves stale files or loses the old export: accepted (`exportPages` writes only current files). D11 and S06, S08 checks.
  - 8 git diff is not the last-selection delta: accepted. D10 keeps a copy of the last selection and reports file changes; R7's "the delta is the git diff" reads through D10.
- 2026-11-05: Q-02 answered "Widen write_file for clones" with a request to fork the chat too. Recorded as D12; S09 now copies files through a clone-only write path and forks the hub session with Pi's `--fork`; files list and checks (C1, C3, C7) updated. OpenDesign's in-project chat cannot be copied (read-only daemon API); the forked Pi chat carries the conversation.
- 2026-11-05 (S06): the mirror is not swapped in as a whole folder. On Windows the hub's folder watcher (S01) blocks renaming a watched folder and would keep watching the old one. Instead every file is fetched first (a failed fetch changes nothing), then files are replaced one by one and removed files are deleted. The folder stays, so live preview keeps working. Because the mirror owns `.pi/designs/<handle>/`, S08 keeps its selection copy at `.pi/designs/selected/<handle>/` (not `<handle>/selected/`).
- 2026-11-05 (S05 on): Phase 3 builds on uncommitted design-sessions v1 code that is mixed with other sessions' changes, so these steps stay in the working tree until the user asks for a commit.
- 2026-11-05 (S07): the page API call is `designpreview`, not `design-preview`: page endpoints only match `[a-z]+` (hub.ts line ~327).
