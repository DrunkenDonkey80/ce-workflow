---
plan3: true
status: active
created: 2026-11-11
updated: 2026-11-12T08:33:52.371Z
reviewed: 2026-11-11
started: 2026-11-11T20:56:51.270Z
---

# Visual design library and reference-led studio kickoff

## Original request

The user identified that OpenDesign and Astryx integration exposes agent tools but gives users nowhere to see available visual directions before choosing one. They proposed `/wo design`: a visual browser on the left, chat on the right, selecting styles or individual elements with Ctrl-click, right-click or mobile hold, and composing a brief such as “I want a design like this with elements from this and this, and a background like this URL; design me 2 variants.” They then requested a plan.

The accepted direction adds visible Add reference controls alongside shortcuts, stable @ref IDs and removable thumbnail chips, mobile Browse/Chat views, and a single brief that starts existing variant sessions. Browsing precedes generation; visual inspiration must not silently select or install a component runtime. Supplied examples and previews generated from style guides must be distinguished.

## Goal, requirements, and non-goals

Provide a discoverable visual entry point to the existing studio. Users can browse OpenDesign styles, pinned Astryx themes and components, and saved designs; inspect whole examples or selected aspects; attach site or image URLs; explain a mixture in chat; then request independent variants.

Required: remote browser operation without client development tools; desktop library/chat split; mobile Browse/Chat with preserved draft; accessible visible selection controls; stable references backed by actual assets and source metadata; explicit source and preview provenance; no generation on browsing alone; reuse the existing per-direction design sessions and refinement workflow.

Non-goals: replacing the studio, restoring the OpenDesign runtime, promoting Astryx to the default, downloading every theme or generating every preview with an LLM, creating a second variant engine, or claiming the prior remote/Safari release gates are complete.

## Decisions

- D1 — User request: `/wo design` is the kickoff command; desktop shows a visual library beside chat so users can describe what they see.
- D2 — Accepted assistant proposal: mobile uses Browse/Chat switching and preserves selections; Add reference is the primary accessible action, with Ctrl-click, context and hold as optional accelerators.
- D3 — Accepted assistant proposal: selected styles or aspects become removable thumbnails with stable @ref IDs. Example: “@ref1 overall direction, @ref2 cards, @ref3 typography, background inspired by this URL; two variants.”
- D4 — Accepted assistant proposal: browse both sources and saved designs in one place, but distinguish their capabilities. OpenDesign supplies guides and sometimes tokens; Astryx supplies a pinned component library, theme metadata and palette generation. Do not imply all catalog entries are installed themes or complete page templates.
- D5 — Accepted assistant proposal: browsing is separate from generation. Sending the brief initiates the existing design-session workflow; selecting inspiration does not change the implementation foundation or authorize installation.
- D6 — Planning only now. Preserve dirty shared files and the separate prior integration plan 55b392b8 (current status recorded in D7). No product edits, downloads, paid generation, commits or pushes are authorized by this planning request.
- D7 — Current durable state supersedes the initial planning note: the user force-finished and archived 55b392b8 with P3-14/P3-16 unfinished. Leave it untouched. This new feature's tests and environmental prerequisite stand independently; archived status is not evidence those old checks passed.
- **Q-01** Should `/wo design` use the current conversation or open a separate design-brief conversation?
  - Context: The hub already has session-scoped drafts and left panes; design start creates separate variant sessions only after a brief is sent. Either approach can reuse those variants. Current-session reuse preserves project discussion; a dedicated brief session keeps browsing and experimentation out of unrelated work. Sources: C:/SOFT/git/ce-workflow/hub/web/app.ts saveDraft and C:/SOFT/git/ce-workflow/extensions/design.ts start/openSession.
  - Recommendation: Open the library in the current conversation, preserving its draft; keep the existing separate sessions for generated variants. This is the smallest complete flow and retains context.
  - Option: Current conversation — Open the library beside this chat; no extra session until variants are requested. Terminal-only use opens a hub briefing session when it cannot attach to an existing one.
  - Option: Separate briefing conversation — Start or reopen a dedicated design-brief session for this project, leaving the invoking conversation unchanged; carry explicit project context into it.
  - Independent: yes
  - Answer: {"kind":"selection","selections":["Current conversation"]}
  - Source: user via ask_user /plan3 resolve; not independently verified.
- D8 — Q-01 reconciled: the user selected Current conversation. `/wo design` opens the library beside the invoking chat and preserves its draft/history; it does not create a separate design-brief conversation. Generated variants still use their existing separate design sessions after an explicit request. The selected option's terminal-only fallback may open a hub briefing session when the invoking conversation cannot be attached. This settles UX ownership, not verification of terminal attachment support.
- **Q-02** Should Saved designs include unfinished studio designs as well as selected exports?
  - Context: The project has live studio folders at .pi/designs/design-N/ and selected exports at docs/designs/<name>/; they can differ or outlive each other. Including drafts makes more examples reusable but requires clear status labels and a consistent snapshot when attached. Sources: C:/SOFT/git/ce-workflow/extensions/design.ts start, snapshot, select and exportFolder. Q-01's current-conversation choice remains settled.
  - Recommendation: Include both, visibly labelled Draft or Selected export, so useful work can become a reference before final selection; snapshot the exact displayed source revision and avoid duplicate cards for identical content.
  - Option: Both drafts and exports — Browse current-project studio designs and selected exports with source/status labels; freeze the chosen revision when attached.
  - Option: Selected exports only — Browse only docs/designs outputs; cleaner library, but unfinished studio work is not directly discoverable there.
  - Independent: yes
  - Answer: {"kind":"selection","selections":["Both drafts and exports"]}
  - Source: user via ask_user /plan3 resolve; not independently verified.
- D9 — Q-02 reconciled: the user selected Both drafts and exports. Saved designs includes current-project live studio drafts and selected exports, visibly labelled with source/status. Freeze the exact chosen revision when attached; identical-content grouping must preserve provenance and must not hide diverged revisions. This settles source coverage, not verification of discovery or snapshot consistency.
- D10 — withdrawn assumption: excluding Astryx component cards would change approved scope. Keep component metadata discovery and honest unavailable-preview states; never provision a runtime merely by browsing. Theme-preview regions remain an additional element-reference path.
D11 — User clarification for Q-03: an existing URL/browser capture extension uses the user's local browser (Helium). Inspect its supported output and per-site consent plumbing as a reuse candidate before further guarded-Chromium fixes; this clarification is not approval to browse arbitrary sites or bypass the existing per-site approval. Q-03 remains under investigation, not an accepted URL-feature deferral.
D12 — User selected Shared read-only capture helper (recommended). Reuse the existing Helium/browser_fetch path and its per-site approval for URL reference capture. First extract the existing bounded screenshot routine from browser_act's browser worker into a shared read-only helper; browser_fetch may use that helper without granting the studio click/type control. No external browsing was performed or authorized by this implementation choice.









## Open questions

### Blocking

None.

### Deferred

None. Q-03 was resolved by D11–D12: reuse consent-gated browser_fetch/Helium with the approved shared read-only capture prefactor.

## Relevant files and approach

### Confirmed integration points

- `C:/SOFT/git/ce-workflow/extensions/work-models.ts`: woSubcommands drives terminal completions and wo:web-info; registerCommand("wo") dispatches subcommands. Add design to dispatch, help and discovery, not just a browser-only button.
- `C:/SOFT/git/ce-workflow/extensions/hub-command.ts` and `C:/SOFT/git/ce-workflow/hub/src/cli.ts`: reuse the hub-opening bridge in the current conversation, as selected in Q-01. Terminal-only use opens a hub briefing session only when the invoking conversation cannot be attached; do not substitute an unrelated session merely because it shares the project folder. Do not silently install or start a different network exposure.
- `C:/SOFT/git/ce-workflow/hub/web/app.ts`: setTab, setLeft and setMobile own the layout; renderMentions/renderComposerThumbs and saveDraft own the composer. Existing drafts are localStorage strings keyed by hub session, not a synchronized cross-device reference store.
- `C:/SOFT/git/ce-workflow/hub/web/index.html` and `C:/SOFT/git/ce-workflow/hub/web/styles.css`: extend the existing hub shell and design tokens; do not redesign the hub. Keep gallery behavior in a focused new `C:/SOFT/git/ce-workflow/hub/web/design-library.ts` module rather than growing app.ts with the entire gallery.
- `C:/SOFT/git/ce-workflow/hub/src/api.ts`: current designpreview is deliberately restricted to a design session's own handle. A browse API must separately authorize current-project catalog and saved-design assets; do not loosen designpreview globally. Reuse capability serving in `C:/SOFT/git/ce-workflow/hub/src/explore.ts`.
- `C:/SOFT/git/ce-workflow/extensions/design.ts`: systems fetches OD DESIGN.md and optional tokens.css; start accepts 1–6 directions, distinct names and up to 30 input files. Each direction opens a hub session. Its current references array is initially empty, and buildPrompt describes one selected system, so attaching several references needs an explicit bundle rather than overloading system.
- `C:/SOFT/git/ce-workflow/extensions/design-lookup.ts` and `C:/SOFT/git/ce-workflow/extensions/design-theme.ts`: reuse bounded pinned catalog lookup and token generation, without executing suggested install commands or requiring React for a token-only style reference.
- `C:/SOFT/git/ce-workflow/extensions/design-render.ts`: reuse captureSite's screenshots and measured STYLE.md, but its visible entry validation only checks HTTP(S) and whitespace; automated URL ingestion must establish a safe network boundary, not assume this is already SSRF-safe.
- `C:/SOFT/git/ce-workflow/hub/web/annotate.ts`, `C:/SOFT/git/ce-workflow/hub/web/design-view.ts` and `C:/SOFT/git/ce-workflow/hub/src/design-bridge.ts`: reuse image annotations or stable element picks for aspect references, without enabling editing of source-library assets.

### Local source evidence

- `C:/SOFT/git/ce-workflow/docs/upstream/open-design.md` records Apache-2.0 guide/token imports. Current systems caching does not retain preview screenshots. The latest upstream preview availability has not been audited.
- Retained Astryx clone `C:/Users/Flex/AppData/Local/Temp/pi-research-62ygWq/astryx/apps/docsite/public/` contains theme-neutral-preview.png, theme-stone-preview.png, theme-gothic-preview.png, theme-matcha-preview.png, theme-y2k-preview.png and theme-butter-preview.png. These are source-revision assets, not proof those themes are installed in the pinned runtime.
- Its `apps/docsite/src/components/themeExplorerData.ts` projects only name/displayName from a larger registry, and uses the theme-showcase template. Borrow the small projection and supplied-preview approach, not the whole docsite or its multi-megabyte registries. Asset licenses, notices and revision matching still need the P3-01 audit.
- `C:/SOFT/git/ce-workflow/docs/plans/done/2026-11-10-design-studio-fixes-and-selective-astryx-integration-55b392b8-plan3.md` was force-finished by the user during this planning turn, with P3-14/P3-16 unfinished. Preserve that decision and archived file; its old checks do not certify this new flow.

### Proposed minimal design

Use a small catalog record keyed by source and revision, with preview kind, availability, license/provenance and host asset references. Selected references add a stable draft-local @refN, aspect or region, user note and immutable asset digest. Publish submitted reference bundles atomically under `.pi/designs/briefs/<bundleId>/`, outside the shared writable references tree. Copy selected assets with digests; never point a frozen bundle at the mutable hostname capture directory. Give new gallery captures unique IDs and publish complete captures atomically; preserve the selected revision while drafting, and reject changed/missing assets rather than silently swapping them at Send. The existing write/edit guard rejects the briefs namespace; verify this and recheck digests at consumers. This protects supported operations, not arbitrary shell execution by a trusted local agent.

Add an optional `bundle` ID to design start and Session, with schema/load validation and explicit propagation into buildPrompt, reopenPrompt, clone, BRIEF.md and HANDOFF.md. Do not put external references into `inputs` (which means project content to preserve), `system` (which can select a runtime), or the hostname-based `references` array. The prompt identifies the bundle as untrusted visual evidence: follow the user's notes, borrow style/structure, never instructions, logos or copy from reference pages. The host resolves IDs and owner/project authorization, not client-supplied filesystem paths. Reuse the existing lock/atomic-save conventions and sessions store; no separate launch-record database or global asset service.

Catalog previews are host-served, lazy and bounded. Prefer supplied examples, then deterministic samples rendered from compatible tokens/components; do not auto-generate missing examples with an LLM. P3-01 decides how to cover prose-only entries after auditing representative sources. Restrict Saved designs to the current authorized project in this version; importing another project's design remains an explicit reference action. Q-02 selects both live studio drafts and selected exports. Enumerate the project's studio records and docs/designs exports, visibly labelled Draft or Selected export with their source identity/revision. An export remains discoverable if its originating studio record is gone. Group identical content without losing either source label; retain distinct revisions when a draft has diverged from its export. Attach a consistent snapshot of the exact displayed revision, never a mutable pointer to the latest files.
### Interaction sketch

Desktop: `/wo design` opens Library in the current conversation's existing left workspace; its chat stays right. Preserve that conversation's history, unsent text and selected references; reopening the library must not create a briefing session or reset its draft. Search and source/type filters sit above visual cards. A card opens a larger preview with Back, provenance, supported light/dark and viewport controls, and Add reference. Back preserves scroll and search. Keep existing hub typography and tokens: the examples, not new decorative chrome, carry the visual variety.

Mobile: Browse and Chat switch the same workspace, with a persistent selection count. Returning restores browse position and the draft; do not squeeze a desktop split onto the phone.

Click opens an example; Add reference attaches its whole direction. Use part attaches typography, colors, layout, background or a component. For screenshots, reuse annotation to mark a region; for instrumented samples, use stable element IDs. Ctrl-click adds a whole card; context action or hold opens reference actions without hijacking native controls, text selection or scrolling. Keyboard users can reach every action; Escape closes detail before the library.

Composer chips show @ref1 — overall direction and @ref2 — cards, with thumbnails, editable notes and removal. Add URL is explicit, not automatic fetching of every chat link. Loading and failure must preserve the brief. An image crop must not pretend to identify a DOM element.

The user writes the product brief and count in normal language. Existing orchestration translates an explicit generation request to 1–6 named design directions. Discussion alone does not start variants. Freeze the bundle at submission so later browsing cannot change running instructions. Return each variant link and partial failures without duplicating successful creations.
### Review-validated integration additions

- `C:/SOFT/git/ce-workflow/hub/src/hub.ts:72-83`: ASSETS drives WEB_FILES and the build fingerprint. Register the new browser module here; a new .ts file alone is not served.
- `C:/SOFT/git/ce-workflow/extensions/plan3.ts:854-874`: the real /api/message handler accepts only target/text/comments/diagrams; add validated bundle metadata and scoped reference context here. `C:/SOFT/git/ce-workflow/hub/src/api.ts` merely forwards ordinary messages. Preserve `C:/SOFT/git/ce-workflow/extensions/plan3-web.ts` command/diagram forwarding behavior; bound reference context so the catalog itself is never injected wholesale.
- `C:/SOFT/git/ce-workflow/extensions/design.ts:96-149,220-250,344-395,432`: inputs preserve project copy; the shared references directory is writable and hostname captures overwrite; existing open retries missing sessions but returns early on hubSessionId after a first-prompt failure. These facts require a separate bundle field, protected bundle storage and distinct creation/delivery recovery, not a second orchestration engine.
- `C:/SOFT/git/ce-workflow/hub/web/app.ts:1339-1352,1567`: Send clears persistent text while a message is in flight. Keep a bounded pending submission with the same bundle ID until acknowledgment/reconciliation, while retaining any newer edits separately. Reload must not lose the pending brief or blindly send it twice. This is narrowly reference-aware draft recovery, not cross-device sync.
### P3-01 audit result (2026-11-11)

| Source | Entries | Supplied preview | Strategy | Rights / revision |
|---|---|---|---|---|
| OpenDesign design-systems @ 6147958 (tree API, not truncated) | 152 systems (plus `_schema`) | All 152 contain `components.html`, `tokens.css` and a preview directory. Exactly 150 contain `system/kit.html`; cloudflare-kumo and tom-modern do not. Airbnb/linear-app/stripe representative component files are 15–57 KB; this is not a bound on all systems. Two PNGs total (tom-modern). | Card = upstream `system/kit.html` when present, otherwise `components.html`; detail = `components.html` + supplied preview pages. Fetched on demand per visible card from the pinned index commit, cached beside existing `.pi/designs/systems/<name>/` with commit; rendered in a sandboxed iframe (no scripts) under a `default-src 'none'; style-src 'unsafe-inline'; img-src data:` CSP, so webfonts fall back. Labelled "Source sample". No prose-only systems, so no generation question. | Apache-2.0 (repo LICENSE); attribution already in docs/upstream/open-design.md |
| Astryx themes @ fd5cf0d (= pinned runtime sourceRevision) | 7 non-private source theme packages: neutral, stone, gothic, matcha, y2k, butter, chocolate (probe is a private test fixture, excluded); source package presence is not proof of publication. Chocolate package.json is 0.7.13, unlike the 0.7.12 runtime. | 6 docsite PNGs (0.5–1.4 MB); chocolate none | Package downscaled copies (ImageMagick, ≤960 px wide, JPEG) under hub web assets; chocolate shows "No supplied preview" with metadata only. Labelled "Source preview". Only theme-neutral is installed in the pin: cards say inspiration, not installed theme. | MIT (Meta), same sourceRevision as runtime notices, but source themes must not be represented as installed 0.7.12 themes; record in docs/upstream/astryx.md |
| Astryx components | pinned catalog via existing lookup | none static | Retain component discovery using pinned metadata without automatic provisioning; unavailable visual samples must be labelled honestly. Theme regions also support element references. Verified locally against the already-warm 0.7.12 runtime (no download): `component()` lists 174 components in 78 groups and `themeListAvailable()` lists all 7 themes, chocolate included (bundled). Neither supplies per-component preview images, so component cards are text/metadata with a 'no visual sample' label; when the runtime is not warm, the Components tab says so and offers the existing consent-gated provisioning, never auto-downloads. | — |
| Saved designs (D9) | `.pi/designs/design-N/` drafts + `docs/designs/<name>/` exports | their own HTML | Sandboxed iframe of the screen's index.html via a new browse route, labelled Draft / Selected export; export DESIGN.json handle links to its draft, identical content grouped. | project-owned |

Contracts. Catalog entry: `{ id: "<source>:<name>", source: "od"|"astryx"|"draft"|"export", name, category?, revision, preview: "sample"|"image"|"none", license, url? }`. Reference: `{ ref: "ref<N>", entry id, revision, aspect: "whole"|"colors"|"typography"|"layout"|"background"|"component"|"region", region?: [x,y,w,h], note, digest }`; bundle = `{ id, refs[], urls[] }` frozen at Send into `.pi/designs/briefs/<id>/`.

Limits: host fetch concurrency 4; kit.html ≤ 64 KB, components/preview pages ≤ 256 KB each; index from the existing systemIndex cache. Offline: cached entries render, uncached OD cards say "Not cached (offline)"; Astryx images are packaged so always available. Ownership: Q-01/D8 (current conversation) stands.




## Phases

### Phase 1: Confirm the visual catalog contract [think]

- [x] **P3-01** Audit corrected: OD 152 systems (150 kit.html, 2 fall back to components.html); Astryx runtime 0.7.12 lists 174 components/78 groups and 7 themes with no per-component images; component cards stay in scope as metadata, no auto-download.

### Phase 2: Implement reference browsing and briefing [code]

- [x] **P3-02** Added /wo design dispatch, same-chat library entry/deep links, approved terminal fallback reuse, and authenticated pinned metadata without generation or provisioning.
- [x] **P3-03** Library now inspects cached OD samples, six Astryx images, live drafts and retained exports in isolated, bounded previews, groups identical authored sources, and restores the live studio without losing unsaved forms.
- [x] **P3-10** Shared bounded screenshot helper now serves browser_act and internal read-only browser_fetch capture, retaining site approval without control grants.
- [x] **P3-04** References attach with stable IDs and notes; page URLs are captured only through the session's per-site-approved browser_fetch screenshot (user decision), validated as a PNG and stored as untrusted, inspiration-only evidence; the guarded hub-side Chromium capture was set aside (patch in .pi/backups) and the design containment suite is green again.
- [x] **P3-05** Reference-led Send freezes and authorizes one bundle, starts the existing variant workflow at most once per bundle with source-asset prompt context, tracks hub creation/first-prompt stages without blind resend, and keeps clone/export provenance.

### Phase 3: Validate the complete kickoff flow [code]

- [ ] **P3-06** Extend targeted tests for catalog safety, stable references, draft persistence and variant kickoff.
  - Extend C1–C6 and C9/C10 where touched; tests accompany each implementation step, then this step exercises the integrated fixture flow. Fake provider/session plumbing keeps it deterministic, with no paid generation assumed.
  - Test malformed IDs and URLs, cross-project access, no silent installs, duplicate sends, missing sources, variant count and each attached asset reaching the right session.
  - C3/C4/C5 cover a draft-only design, an export with no remaining studio record, identical draft/export content, diverged revisions, and source changes during attachment. Labels and the attached snapshot must match the displayed revision; updates must not retarget an existing reference.
  - Include protected-bundle write refusal, two captures from the same host, recapture during drafting and after Send, digest corruption, legacy sessions without bundle metadata, clone/reopen/export provenance, duplicate start after a lost response and separate creation versus first-prompt failures. C9 exercises the real message handler; C10 protects existing command and diagram forwarding.
- [ ] **P3-07** Verify the desktop and mobile browser flow with controlled fixtures and capture both controls and dialogs.
  - Browse, inspect, select aspects, paste URL, remove a reference, request two variants, enter their sessions and refine. Verify keyboard controls, touch-sized targets, overflow and no draft loss.
  - Run C5 with desktop, 390px phone, narrow 320px and landscape layouts, enlarged UI and reduced motion. Inspect small cropped captures with screen_read, including both reference controls and the detail/annotation view.
  - Record actual browser and transport; emulated phone layout is not physical touch or production remote verification. C8 checks changed source; no full repository suite unless requested.
- [blocked] **P3-08** Verify the new flow on an approved paired remote touch device.
  - Prerequisite: an approved, reachable production-paired test environment and agent-controllable physical device. Pixel 10a was previously offered, but the earlier ADB fixture tunnel did not verify production pairing.
  - Exercise touch selection, hold versus scroll, mobile Browse/Chat, URL references and both variant links using agent tools. Do not ask the user to substitute for automated verification or change global networking/security.

### Phase 4: Document the shipped workflow [code]

- [ ] **P3-09** Document discoverability, reference semantics and limitations; add focused changelog screenshots.
  - Update C:/SOFT/git/ce-workflow/README.md, command/tool help, C:/SOFT/git/ce-workflow/extensions/design-guide.md as needed and C:/SOFT/git/ce-workflow/CHANGELOG.md. Keep hub and /wo wording together; explain source previews versus samples and inspiration versus runtime selection. Record attribution in existing upstream ledgers for copied assets/code.
  - Use C7 for the entry control, gallery and reference-detail view. No version bump, commit or push is part of this planning request.

## Global validation

Acceptance: `/wo design` opens Library beside chat; inspect an OD direction, select an Astryx element and add a background URL; explain their mixture and request two variants. Both existing design sessions receive the same frozen bundle, distinct directions and original user notes, and can be refined normally. Reload, switching sessions, Back and mobile Browse/Chat preserve unsent selections. Removed @ref IDs never point at a different selection. Browser draft persistence is not a promise of live cross-device draft synchronization. Saved designs includes both studio drafts and selected exports with clear source labels; identical-content grouping preserves provenance, diverged revisions remain distinguishable, and attachments retain the exact chosen snapshot even after source edits.

Keyboard users need no modifier or hold. All interactive targets are at least 44×44 CSS pixels, focus is visible, reduced motion is honored, supported previews show actual capabilities, and phone layouts do not overflow. Source previews, rendered samples and unavailable examples have distinct honest labels. Browse-only tests assert zero design starts and zero provider calls. C1/C2/C5 also verify the current session ID and history remain unchanged, reopening preserves its unsent text/references, and no briefing session is created from an existing hub conversation. Test the approved terminal-only fallback separately from variant creation. Selecting Astryx inspiration never authorizes installation or silently changes the runtime.

Security coverage: malformed catalog and reference IDs, arbitrary filesystem paths, symlink escape, another project's assets, XSS in metadata, URL credentials and unsafe schemes, private/loopback/link-local destinations, redirect and subresource bypasses, oversized downloads and blocked-site fallback. Add a safe capture wrapper or narrow the existing renderer boundary as required before wiring user-entered URLs to it. Use owned local test origins only through injected test policy. Do not execute imported source/configs to create catalog previews or silently use the user's logged-in browser. Blocked sites may request browser_fetch with its existing per-site approval, or accept an explicitly supplied screenshot instead.

Durability coverage: concurrent duplicate submission, stale preview completion after reference deletion, immutable bundle after Send, source revision mismatch, missing assets, failure during one of two session starts, reload after failure, draft retention until successful submission. A new submission with identical assets may intentionally create another batch; retries of the same submission may not. Test protected-bundle write refusal, same-host capture collisions, snapshot consistency, digest mismatch, separate session-creation/first-prompt failures, and new edits made while an older submission awaits acknowledgment. Follow the existing locked-writes rule: make shared-state decisions under the lock; asynchronous preview completion checks the current reference revision before publishing. Test both duplicate writers and stale completion.

### Targeted command registry

These scripts already exist; extend their pertinent cases and run only those touched. Commands are registered here once and referenced by steps. No feature tests have been run in this planning turn.

- C1 — `node "C:/SOFT/git/ce-workflow/scripts/test-work-wo-control.mjs"`: `/wo` command registration, completions, routing and no unintended agent start.
- C2 — `node "C:/SOFT/git/ce-workflow/scripts/test-work-hub-command.mjs"`: terminal hub bridge and missing-hub behavior, when touched.
- C3 — `node "C:/SOFT/git/ce-workflow/scripts/test-work-design.mjs"`: catalogs, source bundle validation, multi-variant prompts and lifecycle compatibility.
- C4 — `node "C:/SOFT/git/ce-workflow/hub/scripts/test-api.mjs"`: authenticated catalog/asset access, reference submissions and hostile inputs.
- C5 — `node "C:/SOFT/git/ce-workflow/hub/scripts/test-browser.mjs"`: headless real hub with fake Pi; gallery, preview details, reference chips, failure states and mobile layouts. Use retained agent-browser, never install a browser silently.
- C6 — `node "C:/SOFT/git/ce-workflow/scripts/test-work-tool-loader.mjs"`: if extension exports or tool wiring change.
- C7 — `node "C:/SOFT/git/ce-workflow/hub/scripts/changelog-shot.mjs" "<selector>" "C:/SOFT/git/ce-workflow/docs/changelog/<version>-<name>.png" "<fixture setup JS>"`: existing isolated screenshot helper; fill actual selector/setup at implementation, capture the entry control and opened view. Finalize the version prefix when an eventual release version is assigned; this plan does not authorize a version bump or push.
- C8 — Active `lens_diagnostics` with source=lsp, scope=paths for changed source files, plus `git diff --check`; an empty session cache is not evidence of a clean file.
- C9 — `node "C:/SOFT/git/ce-workflow/scripts/test-work-plan3.mjs"`: extend the existing pi-hub /api/message fixture to exercise the real allowlist, bundle authorization and delivery with and without diagram context.
- C10 — `node "C:/SOFT/git/ce-workflow/scripts/test-work-plan3-web.mjs"`: preserve forwardDiagramChat command, idle/busy and diagram-mention behavior; verify attached @ref IDs are scoped to the bundle rather than misread as diagram IDs.

Use deterministic fake network fixtures and existing session plumbing for tests; no paid generation run is authorized here. This verifies reference delivery and session startup, not subjective design quality. Any later live quality experiment needs its own cost approval. Do not claim efficiency improvements from focused timings: the project requires the same end-to-end benchmark and complete continuation accounting.

Real touch and paired-remote verification are P3-08's separate environmental gate. The user force-finished prior plan 55b392b8 with its remote/Safari steps unfinished; do not reopen it or describe those checks as passing.

## Resume context

P3-05 done. P3-04 remains WIP: URL capture stays gated because scripts/test-work-design.mjs fails its C3 external-lookup containment check (unrelated dirty design-render.ts/design-network.ts). Next is P3-06. No push, paid generation, downloads or outside traffic. Preserve unrelated dirty files.

## Amendments

- 2026-11-11: Captured the agreed visual-first kickoff, inspected command dispatch, draft ownership, session creation and safe preview boundaries; recorded one session-ownership choice for resolve. Located six supplied theme-preview images in the retained Astryx clone without fetching or installing anything. Full OD preview coverage and asset licensing remain P3-01 work.
- 2026-11-11: The prior integration plan was force-finished by the user during planning. Updated this draft's context without changing that archived plan or treating its unfinished checks as passed.
- 2026-11-11: Reconciled the applied Q-01 Current conversation answer into entry routing, interaction sketch, P3-01/P3-02 and C1/C2/C5 acceptance. Preserve draft/history and reuse the current view; keep the terminal fallback and separate generated variants. No new steps, product edits or technical pass claims.
### Review dispositions — advisor 0eee5f4c, independently checked

1. **Accepted:** frozen references were planned in an agent-writable directory. Parent checked design.ts writeRefusal/reference and design-render.ts captureSite writes. Use atomic `.pi/designs/briefs/<bundleId>/` publication, unique capture IDs, copied asset digests and recapture tests. This is supported-tool protection, not an OS sandbox.
2. **Accepted:** start inputs would label external inspiration as project copy to preserve. Parent checked buildPrompt and the hostname-based Session.references/briefFile. Add optional bundle metadata with validation, dedicated untrusted-reference prompt context and lifecycle/export propagation; C6 now applies.
3. **Accepted with a concrete mechanism:** command registration alone cannot switch browser panes. Parent checked LEFT_TABS/mobileViews, showDesign and CLI open. Intercept exact `/wo design` locally, add Library tab/view and a validated session deep link for terminal entry; restore existing design previews without losing unsaved state. Do not introduce a separate briefing conversation for an identified hub session.
4. **Accepted in part; rejected the blanket retry claim:** parent confirmed existing start reserves handles and open retries creation failure. But openSession returns early on hubSessionId, even if initial prompt delivery failed. Reuse the existing store and open path where applicable, distinguish delivery failure, and test ambiguous outcomes. Bundle-per-submission IDs deduplicate start; new deliberate batches get new IDs, clones retain references but not original launch membership. No new launch-record store.
5. **Accepted:** design-guide.md is under extensions, verified by prior source reads and repository files. P3-09 now uses its absolute path.
6. **Accepted:** AGENTS.md Version Before Push Rule requires version-prefixed screenshots. C7 now uses `<version>-<name>.png`; assign the prefix at release without adding push/version-bump authorization now.
7. **Accepted as a bounded implementation assumption, not proof:** PI_HUB_SESSION identifies hub-managed sessions; CLI open has no demonstrated live-terminal attach operation. Test no-identity terminal fallback as normal, retain D8, and do not build attachment machinery merely to avoid it.
8. **Accepted:** saved-design scope was ambiguous. Parent checked start/snapshot/select/exportFolder and the distinct studio/export locations. Added Q-02 with concrete options; recommending both is not approval. Implementation of that filter waits for the user's answer.
9. **Accepted parent finding:** the new browser module needs hub.ts ASSETS registration to be served and hashed; added to P3-03 and C5 coverage.
10. **Accepted parent finding:** the actual message allowlist in extensions/plan3.ts would reject reference metadata. Added explicit handoff integration and existing real handler/forwarding test scripts, rather than relying only on fake-Pi browser tests.
11. **Accepted parent finding:** app.ts deletes persistent drafts before send acknowledgment. Added pending-submission recovery and failure/reload tests so the new draft-preservation requirement is implementable without duplicate launches.

Review changed this plan only. Source inspection validates these findings, not implemented behavior; no feature tests or paid runs were executed.
- 2026-11-11: Applied Q-02 Both drafts and exports to source enumeration, labels, snapshot semantics, P3-01/P3-03/P3-06 and global acceptance. Added targeted cases for draft-only entries, exports whose studio records are gone, identical content and diverged revisions. This resolves the question raised by review finding 8; no new steps or product changes.
P3-04 prefactor approved by the user: extract the existing browser-worker screenshot routine and reuse it for consent-gated read-only URL capture through browser_fetch/Helium, rather than duplicating browser_act capture logic or expanding browser-control grants. Preserve per-site approval, opaque reference snapshots and owned-fixture-only checks. The earlier guarded-Chromium URL-capture attempt remains unverified and must not be exposed; replace its integration rather than keep two capture implementations.
- 2026-11-12: Added P3-10 after P3-03: User-approved P3-04 prefactor: reuse Helium's existing per-site read approval and browser_act's bounded screenshot routine rather than copy capture logic. This prerequisite does not expose studio URL capture or relax Global validation.