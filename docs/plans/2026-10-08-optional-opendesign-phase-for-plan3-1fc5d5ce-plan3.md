---
plan3: true
status: active
created: 2026-10-08
updated: 2026-10-09T06:06:22.952Z
started: 2026-10-08T10:55:36.537Z
---

# Optional OpenDesign phase for Plan3

## Original request

> now lets talk UI, we have this frontend design now mentioned and bundled but thats not usually enough for serious UI work. we have done some substantial and very unfinished work with using the opendesign tool with us in a more stable json format controlled so design can be planned visually - project described to the OD, it generates some design, that gets approved by human or changed and exports some stuff for the program to adhere to. lets resume this, probably as follow-up design phase to the main plan IF NEEDED (most of the time for smaller things the frontend design skill will be enough so probably an option like /plan3 design when UI work is in the thing?). the point is to do somethign useable, but not overdo it like we did with the orchestration before. to not feel forced too. but allow creativity so the model can give its ideas and show them to OD, receive inspiration from "i like this page's design" or this image so it walks around, ask questions to clarify instead of doing something and we fix later, etc

## Goal, requirements, and non-goals

### Goal

Add a small, optional visual-design follow-up to a Plan3 plan. The current agent develops the brief creatively with the user, OpenDesign supplies a reviewable prototype and validated JSON handoff, the human approves or revises it, and the same agent reconciles the implementation plan. Nothing implements automatically.

### Requirements

- **R1 — Opt-in, not a workflow tax.** `/plan3 design [plan]` targets the current/named open plan. Suggest it for substantial UI when useful; never commission automatically. Small/routine UI stays on the existing skill/preservation path. `/wo plan design …` already forwards Plan3 arguments and should work without a new `/wo design` route.
- **R2 — Requirements before pixels.** Read the main plan, relevant UI code, components/tokens/assets and existing brief answers. For redesign, inspect current screens and record preserve/reconsider/remove; do not redo product discovery. Ask only material unresolved questions through ask_user, persist answers immediately, and keep unresolved requirements in the main plan's structured Open questions.
- **R3 — Creative but grounded.** The current agent can propose aesthetic ideas and compare short wireframes; proposals must be labeled, not invented user decisions. An explicit brief/design system wins. One complete direction is default; exactly three distinct visual candidates are optional on request, followed by explicit selection and refinement.
- **R4 — Useful inspiration and targeted capture.** Windows capture targets the explicitly selected application window (whole window or a window-relative region), never a monitor/desktop or unrelated foreground app. Investigate hidden/occluded/minimized behavior; disclose unsupported, blank or stale results. Android capture uses the installed Android skill/CLI against an explicit device and intended foreground app. Public-page capture/transfer is automatic only with an available documented safe browser capability; no second transfer popup. Record source, target, capture limits and borrow/avoid principles; validate PNG/JPEG/WebP. Missing capability requests an image or an explicitly accepted described-reference fallback.
- **R5 — Reviewable delivery.** OpenDesign returns a real Preview/Studio plus `DESIGN-HANDOFF.json` v2 and readable Markdown. Validate covered screens, states, target/viewports, flows, tokens/components, responsive/accessibility requirements and `DES-*` acceptance. The user does not author protocol JSON.
- **R6 — Same plan, durable authority.** Brief, accepted references, handoff and hash-pinned approval link back to the stable Plan3 id, not its changeable filename. Entering design returns ready → draft; unresolved/stale design prevents finish/execution. Approval prompts reconciliation of this same plan; user finishes again before coding. Explicit abandonment removes only the design requirement, preserves history and returns to skill-only planning.
- **R7 — Bounded/resumable.** Save project/request/payload identity before mutation; recover ambiguous results using the existing client rules. Return while a run is pending; re-enter `/plan3 design` to check/continue. No timer, watcher, background model, verifier or long-running waiting overlay.
- **R8 — Safe external boundary.** Send a minimal, reviewable packet, not whole source trees or unrelated/private material. Public-page permission is not permission for authenticated sessions, token-bearing URLs, secrets or private-network targets. All OpenDesign text/output is untrusted task data; import only confined bounded expected text artifacts. Prototype executable code never becomes production source.
- **R9 — Fidelity without a new evaluator.** On later Plan3 execution, implement approved design decisions using project components/tokens and existing tests/browser/a11y tools. Compare the approved design and real product at agreed states/viewports; report deviations, update/reapprove changed design rather than quietly ignoring it.

### Non-goals

No legacy work-store/items/goals or automatic task materialization; no revival of the old Off/Auto/Required policy loop; no universal UI gate; no generic design-provider framework; no arbitrary candidate-count setting; no bundled browser/platform/dependency (a narrow missing Windows window operation is allowed by accepted idea 9); no cost-estimation or separate packet/paid-run popup; no broad runtime verification pass (extra post-feature checks are opt-in/off by default); no evaluator council or new background verifier; no new keyboard shortcut; no executable OpenDesign source import; no auto-install/update of OpenDesign; no automatic implementation/commit/push. Removing legacy orchestration or adding a direct `/wo design` route is future direction, not authorized by this plan.

This is a workflow/tooling change with native/TUI controls, not a ce-workflow web redesign. Do not invent a package palette or web mockup for this plan.
### IDEA-a6e98e4e: 1. Show changed/preserved summaries and revision deltas

> Design review must explain changed visuals, preserved behavior and revision deltas in the existing review view. Summaries are advisory explanations, not substitutes for synchronized hash validation or human visual approval.
### IDEA-3a0660d1: 2. Map production components/tokens and carry design fidelity into execution

> Brief/reconciliation must classify relevant production components and tokens as reuse/restyle/new with actual repository paths. Execution for an approved design must read its pinned handoff/approval, honor that mapping, verify agreed states/viewports with existing project tools, and record/block material deviations rather than silently change the design.
### IDEA-687547a7: 3. Make an approved design a portable frozen snapshot

> After explicit human approval and same-plan reconciliation, a validated frozen local design snapshot is authority for finish/execution, independent of ignored runtime state or live OD availability. Local authority edits invalidate it. Remote Studio changes are discovered/adopted only through explicit sync and reapproval; missing or uncertain in-flight mutation state remains a recovery blocker. This supersedes the current blanket remote/missing-runtime gate for approved snapshots only.
### IDEA-9569e107: 4. Prove one complete direction before adding candidate exploration

> Implement and prove the public single-direction brief→Preview→human approval→same-plan reconciliation slice before optional candidate-selection/refinement work. Preserve the full three-on-request scope and final validation; obtain provider consent and record unavailable live evidence honestly.
### IDEA-aa775a43: 5. Make OpenDesign launch settings reachable with the legacy workflow off

> The existing OpenDesign executable/command-spec row must be accessible in /wo Settings with legacy workflow disabled; do not expose or require legacy visual-design policy/review controls. Validate specs and do not store credentials.
### IDEA-d6ada485: 6. Use one coded design gate and checkable reconciliation evidence

> Use a shared design gate for finish, every resume route and tool status ready/active/complete; design entry sets planning/research state. Gate readiness on current approved authority plus an approval-bound reconciliation marker and DES-* coverage in Phases/Global validation. Keep ordinary plans unchanged and label recorded human Force finish overrides as overrides, not proof.
### IDEA-be7fab40: 7. Define a small Plan3-owned state model instead of inheriting legacy policy transitions

> Use a bounded Plan3-owned phase/transition model with explicit recovery and pre/post-approval abandonment. Do not reuse the legacy off/auto/required policy/session transitions; retain shared handoff/hash/path/image/brief/audit helpers without changing legacy contracts.
### IDEA-e594d067: 10. Surface pending design through local status, hints and autocomplete

> Expose active design phase and explicit next action through local-only Plan3 status/hints, and include design in command descriptions/autocomplete. Rendering never polls OD or starts a watcher; missing/corrupt state is surfaced safely and ordinary plans remain unchanged.
### IDEA-d84f2f9c: 9. Define a concrete documented rule for safe capture-tool eligibility

> Capture planning covers Windows, Android and browser surfaces. For Windows, capture the explicitly selected application window itself (whole window or requested region), not the monitor/desktop or an unrelated foreground app; investigate hidden-window support and disclose unsupported/blank/minimized cases. Prefer existing window enumeration/selection/capture tools; add only a narrow missing window-specific operation if needed. For Android, use the installed Android skills/tooling and target an explicit device/app. For browsers, research installed browser extensions and documented isolated screenshot capability before choosing reuse; retain public-network/private-data boundaries and screenshot fallback when unavailable. No new general browser platform or claim that hidden-window capture works without evidence.










## Decisions

- **D-01 — Optional, suggested, never forced.** Add `/plan3 design` for the current/named plan; the planner may suggest it for substantial UI, but only explicit user opt-in starts OpenDesign. Routine/small UI stays on the frontend-design or preservation path; ordinary finish/resume does not gain a universal design gate. Source: user via ask_user, 2026-10-08 (selected “Suggest, never force”). Rationale: visual exploration when useful without reviving orchestration friction.
- **D-02 — Plan3 boundaries remain intact.** Work in the current agent/model; no legacy work items, goals, work_* tools, background verifiers, or automatic commit/push. Preserve unrelated dirty files and `plan3: true`. Source: current user instruction.
- **D-03 — One direction by default; three on request.** Discuss and settle a creative direction before commissioning a single complete design. Offer three genuinely different OpenDesign previews only on explicit request/accepted suggestion; reuse the existing exactly-three candidate format for that branch. Source: user via ask_user, 2026-10-08. Rationale: creativity is available without paying for candidate/refinement rounds every time.
- **D-04 — Automatic public-page capture and transfer.** A public inspiration page explicitly supplied for design may be inspected/captured and its reference material transferred to OpenDesign without a separate transfer popup. Source: user via ask_user, 2026-10-08 (selected “Automatic public-page capture and transfer”). Boundary: this approval covers public-page inspiration only, not authenticated/private pages, signed/token-bearing URLs, credentials, or unrelated repository content. Local reference images explicitly supplied for design use existing validation/copy/upload. Record source and borrow/avoid principles; unavailable capture must be disclosed rather than fabricated.
- **D-05 — Reconcile the same plan; finish again.** Entering an opted-in design phase returns a ready plan to draft, without deleting existing steps or decisions. After explicit human visual approval, the current agent reconciles the handoff into that same plan; `/plan3 finish` is required again before implementation. Active unresolved/stale design prevents finish/execution; explicit abandonment is allowed and recorded, then skill-only planning can continue. No automatic implementation or task materialization. Source: user via ask_user, 2026-10-08 (selected “Reconcile same plan, finish again”). Rationale: design changes implementation scope and acceptance; review that delta before coding.
- **D-06 — Reuse an existing safe browser capability; do not bundle a browser platform.** Automatic public-page capture/transfer uses the current agent's configured isolated browser/capture tool when available. No browser dependency/install, credentialed profile, or unsafe reuse of the UI-gate HTML proxy. If safe capture is unavailable, report it and ask for a screenshot (or let the user explicitly proceed with a described reference); never pretend to have viewed the page. Coded validators own supplied-URL boundaries and image import/upload; existing browser tools own navigation/capture. Source: user via ask_user, 2026-10-08 (selected “Existing safe browser capability”). Rationale: meet the inspiration workflow without a second browser subsystem.
- IDEA-a6e98e4e: accepted — 1. Show changed/preserved summaries and revision deltas. Source: user via Plan3 idea review; not independently verified. Response: {"kind":"selection","selections":["Accept"]}
- IDEA-3a0660d1: accepted — 2. Map production components/tokens and carry design fidelity into execution. Source: user via Plan3 idea review; not independently verified. Response: {"kind":"selection","selections":["Accept"]}
- IDEA-687547a7: accepted — 3. Make an approved design a portable frozen snapshot. Source: user via Plan3 idea review; not independently verified. Response: {"kind":"selection","selections":["Accept"]}
- IDEA-9569e107: accepted — 4. Prove one complete direction before adding candidate exploration. Source: user via Plan3 idea review; not independently verified. Response: {"kind":"selection","selections":["Accept"]}
- IDEA-aa775a43: accepted — 5. Make OpenDesign launch settings reachable with the legacy workflow off. Source: user via Plan3 idea review; not independently verified. Response: {"kind":"selection","selections":["Accept"]}
- IDEA-d6ada485: accepted — 6. Use one coded design gate and checkable reconciliation evidence. Source: user via Plan3 idea review; not independently verified. Response: {"kind":"selection","selections":["Accept"]}
- IDEA-be7fab40: accepted — 7. Define a small Plan3-owned state model instead of inheriting legacy policy transitions. Source: user via Plan3 idea review; not independently verified. Response: {"kind":"selection","selections":["Accept"]}
- IDEA-e594d067: accepted — 10. Surface pending design through local status, hints and autocomplete. Source: user via Plan3 idea review; not independently verified. Response: {"kind":"selection","selections":["Accept"]}
- IDEA-c0201bd5: rejected — 8. Combine exact packet review with paid-run consent. Source: user via Plan3 idea review; not independently verified. Response: {"interpretation":"User does not want cost calculations, estimates or a separate paid-run confirmation ceremony: the design is requested to be done and user uses subscription models. Reject this combined packet/cost popup proposal. Keep R8's inspectable minimal packet and existing explicit design opt-in/data boundaries, not extra cost-gating UI. Subscription coverage or image-generation support is user-reported, not verified OpenDesign billing/provider evidence; do not promise runs are free or introduce another image provider.","userResponse":"{\"kind\":\"freeform\",\"text\":\"I dont care about costs calculation, that also costs to calculate, the thing needs to be done anyway so no point of just seeing how much will that cost me. besides, both subscription models I use - sol/opus/sonnet can generate images, actually maybe even luna, so we are ok on cost\"}"}
- IDEA-d84f2f9c: accepted — 9. Define a concrete documented rule for safe capture-tool eligibility. Source: user via Plan3 idea review; not independently verified. Response: {"interpretation":"User selected Accept and expanded capture into three actual cases: Windows program window rather than monitor/desktop, Android using Android skills, and browser screenshot capability research using already installed extensions. Accept that revision. Hidden/invisible-window capture is a desired capability, not proven; research and capability-check it, report unsupported results instead of silently substituting desktop capture. A new narrow enumerate/select/window-region tool is an option only if existing capture cannot do the job; do not build a generic browser/capture framework.","userResponse":"{\"kind\":\"selection\",\"selections\":[\"Accept\"],\"comment\":\"you are into something here. we have 3 capture cases here - windows program - add a rule to capture not from the monitor/desktop, but from the program window itself, which can be even hidden - we can also add a tool that shows/finds a program window and captures part of all of it and return it. for android - use the android skills. for browser, which is the least I do - there i have no idea what exists as capture screenshots, that needs a research, but we can surely use the browser extensions we have here, forgot the names\"}"}
- IDEA-9182260f: rejected — 11. Check pure design contracts with workflow off, not the legacy lifecycle suite. Source: user via Plan3 idea review; not independently verified. Response: {"interpretation":"User rejects making broader/general contract verification a mandatory heavy burden and wants extra verification optional after the feature is complete, off by default. Do not add broad suite enablement or per-design verification orchestration. Retain the smallest focused development selfchecks for the new nontrivial authority/recovery/security logic and existing final project checks, explicitly distinguish these from runtime design sessions. Broader contract/legacy regression runs are opt-in post-feature checks, not automatic gates.","userResponse":"{\"kind\":\"freeform\",\"text\":\"I'm afraid this step will result in the huge verification steps that will add heavy burden on the design phases, we can actually test that as an optional after the feature is complete, but off by default\"}"}
- IDEA-d80f8ee4: rejected — 12. Add a migration hint from legacy design commands. Source: user via Plan3 idea review; not independently verified. Response: {"interpretation":"User selected Reject and stated that legacy orchestration is expected to be removed soon, with /wo design becoming a new design entry rather than a migration hint. Reject legacy-hint work. Record that future command direction; this response does not authorize removing legacy product code during planning or silently changing the current plan's command routing.","userResponse":"{\"kind\":\"selection\",\"selections\":[\"Reject\"],\"comment\":\"nah old workflow is going completely off i the comming days even removed from source an the /wo design or so will be the new design commands so nope\"}"}
- **Ideas-flow reconciliation:** Q-06–Q-17 are settled: nine accepted (1–7, revised 9, 10), three rejected (8, 11, 12). Accepted requirements and stable S07–S15 now amend the concrete approach/base phases, not merely an appendix. The Ideas section preserves original proposals and exact responses; rejected Proposed requirements/steps are historical, not implementation scope. Capture limits are unavailable evidence/conditional implementation checks, not questions to re-ask. Sources: individual Plan3 review responses and their recorded comment interpretations, 2026-10-08.
- **Validation burden clarification:** existing focused implementation selfchecks/final repository checks remain development acceptance, not repeated stages in each design session. No blanket legacy-contract/client suite-discovery expansion; any broader post-feature verification is optional and off by default. No price calculation or separate paid-run dialog; explicit phase opt-in and settled data boundaries remain. Future `/wo design` routing/legacy removal is recorded direction only.
- **Live single-direction checkpoint target (2026-10-08):** User chose **Disposable calculator demo** via ask_user. Use a minimal disposable web calculator and real public-command OpenDesign flow; no private references or production source transfer and no automatic product implementation. Source: explicit response to “Which disposable UI project should we use for the required real OpenDesign checkpoint?”. This chooses the target; it is not evidence of a provider run, visual inspection, human approval, reconciliation or /reload. Complete independent single-direction safety/summary work before live acceptance; candidates remain gated by S10.


















## Open questions

### Blocking

None.

### Deferred

None.

## Relevant files and approach

All paths below are relative to **C:\SOFT\git\ce-workflow** unless explicitly absolute.

### Facts and sources

- **Current command/prompt integration:** `extensions/plan3.ts`: `planningPrompt`, `executePrompt`, `finishProblems`, `finish`, `resume`, `planCommand`, `browse`, `plan3:command`. Today there is no design subcommand. Stable plan id survives title rename; the existing event already makes `/wo plan design` route to Plan3 once the subcommand exists.
- **Reusable transport:** `extensions/opendesign-client.ts`: `normalizeOpenDesignCommandSpec`, `callOpenDesignTool`, `reconcileCreatedProject`, `validateStartRecovery`. It already handles verified discovery, Windows desktop bootstrap, stdio framing, bounded/redacted errors and read-versus-write retries. Do not replace it with unrestricted MCP exposure or a new provider client.
- **Reusable contracts:** `extensions/work-design.ts`: canonical hashes, v2 handoff/target validation, one-direction/candidate/refinement/repair prompt builders, confined writes, image inspection/copy and policy-free approval/candidate validation. The single-direction generator exists; the current legacy controller always uses the exactly-three generator. Do not reuse `createDesignSession` or policy-bearing session transitions: they require off/auto/required and have incompatible post-approval cancellation semantics. Use the accepted small Plan3-owned state model; preserve legacy contracts/exports.
- **Do not call the old controller:** `extensions/work-models.ts` `buildWorkRedesignState` creates epics/audit work items; `approveDesignSession`/`materializeApprovedDesign` create implementation tasks. Read these only as behavioral reference. Reuse client/contracts directly, not a wrapper around these functions.
- **Runtime-location contradiction:** README currently says `.pi/designs/`, while the existing `work-design.ts::designSessionPath` writes legacy sessions to `.ce-workflow/work-runs/design-sessions/`. Distinguish these explicitly: new Plan3 protocol sessions use `.pi/designs/plan3-<id>.json`; leave old storage untouched. Do not trust the README as proof of implemented storage.
- **Historical failure evidence, not new requirements:** `docs/plans/2026-08-31-002-fix-redesign-selection-implementation-e2e-plan.md`, “Why the previous test passed the wrong thing”: raw commissioning success, scripted candidate selection and unrelated screenshots falsely looked like a completed redesign. Its automatic goal/task/evaluator pipeline and always-three gates are NOT adopted here.
- **Capture boundary:** `scripts/ui-gate/capture.mjs` is a geometry-injecting Windows Chromium harness using `--no-sandbox`, without public-network navigation guards. Do not reuse it unchanged for arbitrary public inspiration sites. `work-design.ts::validateReferenceCaptureReceipt` is a selected-OpenDesign-preview proof, not a public inspiration receipt. Inspiration is reference-only, not approved-preview or product fidelity evidence.
- **Package/tests:** `package.json` loads `extensions/plan3.ts`; new sibling helpers need no extra extension entry or dependency. `scripts/verify-package.mjs` skips legacy design/client tests when workflow is off. New Plan3 authority/recovery/input logic gets focused assertions in the existing Plan3 suite with workflow disabled; do not enable broader contract/legacy suites by default or add runtime verification orchestration (idea 11 rejected).
- **Pi integration reference:** `C:\Users\Flex\.pi\agent\install\releases\1.1.0\node_modules\@earendil-works\pi-coding-agent\docs\extensions.md`, sibling `tui.md`, and `C:\Users\Flex\.pi\agent\install\releases\1.1.0\node_modules\@earendil-works\pi-coding-agent\examples\extensions\hello.ts` read during planning. Tools can use `ctx.executeTool`; commands cannot assume it. Register first; activate optional tools only for an opted-in phase; clean session resources on shutdown. Existing `extensions/plan3-ask.ts` bridges command-context ask_user when needed.

### Smallest coded design

1. Add an imported **`extensions/plan3-design.ts`** service, not another top-level extension. It imports `./work-design.ts` and `./opendesign-client.ts`, accepts a resolved plan id/path and returns bounded typed phase state/results. It must not import `work-models.ts`, initialize a legacy store, launch agents, or perform product edits.
2. Keep registration/routing in **`extensions/plan3.ts`**: add the `design` subcommand and a contextual Design row in the existing plan browser. Re-entering `/plan3 design [plan]` shows a short state-aware shared overlay (prepare/continue/check, Preview/Studio, revise, optional three directions, human select/approve, abandon as applicable), not a second command hierarchy. Use `extensions/work-dialogs.ts` with its purpose line, Escape/parent/cursor semantics and RPC/native fallbacks. In headless mode return actionable `needs_human`; never default-select/approve.
3. Add one bounded model-facing **`plan3_design`** tool for prepare/commission/check/sync/revise and reference preflight/import. It works only for the explicit opted-in resolved plan and delegates to the same service. Activate it for that phase using existing Pi tool exposure/loadout APIs, without replacing other active tools. Do NOT expose selection, approval or abandonment as model-callable actions; those require real operator command/dialog events. The tool is not a legacy `work_*` tool.
4. Plan Markdown remains durable progress/requirements state. Add a **Visual design** section with selected mode, local phase/next action, artifact links, references/answers, actual reuse/restyle/new component-token paths, changed/preserved/revision-delta summary and approval hashes. Add one bounded `design:` pointer to the confined directory; no pointer means no new gate. Local status/hints and autocomplete expose continuation without OD calls/watchers. Do not accept prose “approved” as proof.
5. Use `docs/designs/<date>-<slug>-plan3-<id>/` for `DESIGN-INPUT.json`, `DESIGN-BRIEF.md`, reference images, optional candidate/selection files, `DESIGN-HANDOFF.json/.md`, and `APPROVAL.json`. Include the id to avoid same-day/title collisions. Store bounded protocol state/raw exact mutation payloads atomically in ignored `.pi/designs/plan3-<id>.json`; validate the owner `plan3-<id>` and every path. Reuse state-validation/persistence patterns, not the legacy path helper. Atomic read-modify-write operations must serialize per plan to prevent parallel tool/command duplicates. Missing runtime state blocks unfinished/uncertain provider operations; never silently create a replacement project/run. A complete validated approved-and-reconciled local snapshot is portable authority and needs neither ignored runtime state nor live OD. Keep non-secret project/run ids in the durable handoff/approval provenance for recovery. This repo already ignores `.pi/`; ensure the target project does too before writing protocol payloads.
6. Minimal Plan3-owned phase loop: brief → pending → clarification OR optional candidates/selection/refinement → review → approved → reconciled, with explicit recovery/failure and abandonment before/after approval. Define only the legal transitions needed here; do not import legacy policy/session or implementation/materialization/proof states. Persist ids and exact payload/digest before external mutations. One progress check per invocation, no provider auto-poll loop. Implement/prove the complete single-direction loop before optional candidate work.
7. Existing OpenDesign command configuration remains the single source: effective project/global `workOrchestrator.openDesignCommand` plus client discovery; reuse `normalizeOpenDesignCommandSpec`. Read that narrow setting using the existing Plan3 JSON settings pattern. Explicit `/plan3 design` opt-in does not require enabling the legacy workflow or changing its Off/Auto/Required policy. Expose only the existing `openDesignCommand` row in `/wo settings` when workflow is disabled; keep legacy policy/review rows hidden. Never put credentials in settings. Invalid spec/availability preserves the phase and points to that reachable row.
8. For references, use available platform tools with documented target/isolation limits. Windows: enumerate/select the requested application window, bind capture to its actual identity, capture whole window or validated window-relative crop; never substitute monitor/desktop pixels or silently restore/focus another app. Reuse existing capture first; a missing narrow window operation may be added, with bounded blocking-call timeout and honest hidden/minimized/blank limitations. Android: load the installed Android skill, choose the device/app, use CLI screen capture and inspect the PNG before transfer; device-screen capture is not hidden-app rendering, so exclude unrelated/system/private content. Browser: code validates explicit URLs/files and returns constrained inputs; it does not spawn a browser. Public URLs must be credential-free http(s), with no token-bearing query, private/loopback/link-local/metadata target; redirects/subresources must stay within the capture capability’s safe public-network policy. Use a fresh non-authenticated context, no existing profile/cookies, downloads or interactions that submit data. If isolation/request boundaries cannot be verified, treat safe capture as unavailable (D-06), not as successful. Copy/hash bounded output images through a Plan3-specific reference-only path; never mislabel inspiration as a licensed shippable asset or reuse selected-preview approval receipts.
9. Plan3 controller writes an inspectable minimal hash-pinned brief/inputs snapshot and target matrix. Explicit design opt-in authorizes the settled design request; do not add cost estimates or a separate packet/paid-run popup. Keep existing external-data boundaries and explicit choices for genuinely replacement/recharge operations. Reuse `renderOpenDesignGenerationPrompt` for default single-direction commissions; optional three-direction mode uses the existing candidate prompt/validator, explicit human selection receipt, then refinement. Input includes selected real components/tokens and reference borrow/avoid constraints, never indiscriminate repository source. Failed/malformed exports permit the existing one repair attempt; preserve Preview access and validation diagnostics after that.
10. Approval always requires a current synchronized valid question-free handoff and explicit human action, in BOTH single and candidate modes. Reuse hash helpers, but the Plan3 receipt requires human authority and a real decision-event id even when the legacy single-mode approval helper does not. Pin plan owner, brief/input/reference hashes, handoff, remote fingerprint, revision and candidate lineage when present. Fixture authority stays test-only and cannot satisfy a production gate.
11. Use one local design gate for finish, every resume path and tool status ready/active/complete, only for non-abandoned pointers. Require validated pinned approved artifacts, an approval-bound reconciliation marker and every DES-* id mapped into Phases/Global validation; missing ids are structural omissions, not proof of test semantics. Detect local brief/input/reference/candidate/handoff/owner/revision and relevant scope changes; invalidate stale authority. Approved-and-reconciled snapshots need neither live OD nor .pi state. Explicit sync discovers/adopts remote Studio edits and requires reapproval/reconciliation; do not claim remote currency between syncs. Missing runtime state still blocks uncertain in-flight operations. Exclude timestamps/progress markers from visual hashes. Set planning/research state on design entry; preserve a real human Force finish only as a recorded override, never approval proof.
12. After approval, send a planning-only reconciliation prompt in the current agent/model. Update affected steps/files/checks/global acceptance and map every `DES-*` criterion to a plan check. Preserve completed/unrelated steps; add amendments for changed scope, ask before expansion. Remain draft until user `/plan3 finish`. Abandon explicitly cancels the opted-in requirement, best-effort cancels a known active run, records cancellation uncertainty and keeps artifacts/history; it does not silently approve or delete anything.

### Frontend direction and reused components

Reference: `C:\SOFT\git\ce-workflow\skills\frontend-design\SKILL.md` and its `UPSTREAM.md` (pinned Anthropic revision `683bc88e56f3e09ba94f7055977f3d3aa499f202`).

Chosen **workflow** direction: a brief-first, optional visual workshop in the current agent, with a compact native review overlay and OpenDesign Preview/Studio as visual surfaces. No new ce-workflow web UI. Reuse shared work-dialogs, Pi semantic theme colors, plan3-ask, existing Plan3 status/pointer and artifact helpers.

For each actual commissioned web design, record the concrete direction and reuse inventory in its brief: audience/job/real copy; actual repository token/component paths; 4–6 role colors and type roles; layout/wireframes; one characteristic element; state/responsive/keyboard/contrast/reduced-motion rules. User briefs and existing design systems override creative defaults. Native/game/mobile UI uses the project/platform conventions and explicit target matrix; the web skill does not dictate native/TUI styling. No product palette/font choices are invented in this implementation plan.

### Intended affected files

- `extensions/plan3.ts` — optional command/tool registration, state-aware shared menus, local hints/completion, fidelity prompts, shared finish/resume/status gates and reconciliation.
- `extensions/work-models.ts` — only make `openDesignCommand` reachable in workflow-off utility settings; do not import its legacy controller into the service.
- A narrow Windows window-capture helper/tool only if existing capability is insufficient (accepted S15): choose the exact path/backend after the target-specific research checkpoint; any extension/imported module is .ts. No general capture framework or browser dependency.
- `extensions/plan3-design.ts` — new narrow service, Plan3 ownership/storage, recovery, references, sync/approval validation; all extension imports remain .ts.
- `extensions/work-design.ts` — reuse unchanged where possible; only narrowly extract or extend shared validation if required without weakening old contracts.
- `extensions/opendesign-client.ts` — reuse; no new protocol/backend. Only change if the original client self-check identifies a real compatibility defect.
- `scripts/test-work-plan3.mjs` and `scripts/test-work-settings.mjs` — extend existing offline coverage for command/forwarding/gates and workflow-off behavior. Put service/fixture scenarios here rather than inventing a test runner.
- `scripts/fixtures/opendesign/fake-od.mjs` plus handoff fixtures — extend existing fake-peer cases only where needed for single-mode/clarification/reference/recovery checks.
- `scripts/verify-package.mjs` — no planned suite-discovery change: idea 11 was rejected. Preserve the existing final package command; focused new Plan3 assertions already belong in its existing suite. Broader contract/client/legacy checks remain explicit optional development/post-feature runs.
- `README.md` — optional Plan3 design usage, approval/reconciliation, dependency/capture limits; clarify legacy versus Plan3 storage and commands. No agent-instruction or unrelated documentation edits.
### Capture research and capability limits

Research only, 2026-10-08; no live screen/window/device capture or private browser-profile inspection performed.

- **Windows — sourced facts:** `C:\SOFT\git\ce-workflow\scripts\ui-gate\profiles\win-uia.mjs` emits UIA geometry/metadata, not a screenshot. Microsoft's [PrintWindow reference](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-printwindow) takes an HWND and asks the owning application to render through WM_PRINT; it is synchronous and may block. [Windows.Graphics.Capture guidance](https://learn.microsoft.com/en-us/windows/uwp/audio-video-camera/screen-capture) documents application-window capture and capability checking. Neither inspected source proves universal hidden/minimized/GPU-window rendering. The user's hidden-window expectation is requested capability, not a verified fact.
  - **Recommendation, not a settled backend:** reuse an existing selected-window tool if present. If absent, add only the narrow window-identity/list/select/whole-or-window-relative-region operation allowed by S15 using OS APIs, off the UI thread/with bounded process timeout. Assess PrintWindow against the intended app before adopting it; WGC is not assumed a trivial dependency-free drop-in. Do not expand into a capture platform for unsupported rendering. Fail honestly or request a screenshot; no desktop/monitor substitution, silent unhide/focus, stale-frame success or unrelated app capture.
  - **Conditional check:** verify window identity, crop bounds, disposal/timeouts and image/provenance; exercise visible/occluded/hidden/minimized cases for the supported target and report limits. Live Windows rendering remains unverified.
- **Android — observed:** `command -v android` resolves to `C:\ProgramData\AndroidCLI\android`; `android screen --help`, `android screen capture --help`, and `android layout --help` succeeded. Capture exposes explicit device/output flags and produces a device-screen PNG. Installed `C:\Users\Flex\.agents\skills\android-cli\SKILL.md` and `references\interact.md` prescribe inspecting the image before proceeding. Current CLI marks layout --diff deprecated/no-op, unlike the installed interaction document; installed help wins.
  - **Limit:** no device/app was selected or live-tested. Device-screen capture does not prove hidden-app capture; bind intended app/device and exclude notifications/system/other-app content from uploaded references. Prefer unannotated design references.
- **Browser — observed configured Pi packages:** a packages/extensions-only read of `C:\Users\Flex\.pi\agent\settings.json` identified `pi-web-access` and local `C:\SOFT\git\pi-chatgpt-web`. The former's README documents search/page extraction, not a general screenshot tool; the latter limits its bridge to the daily logged-in chatgpt.com session. Neither proves fresh unauthenticated public-page screenshot isolation. Available-tool lookup found no general screenshot operation; no cookies/credentials were read.
  - The leftover `C:\Users\Flex\.pi\agent\npm\node_modules\compound-engineering-pi\skills\agent-browser\SKILL.md` describes a screenshot CLI, but command lookup found no executable. A skill directory is not capability proof. Do not install a browser or reuse authenticated profiles for this conditional path.
  - **Decision applied:** automatic public-page screenshots remain conditional on a concrete documented eligible tool; current evidence supports honest image/screenshot fallback, not a claim that all OS/browser extensions were enumerated or that automatic capture works. Web text inspection can inform discussion but is not visual capture.

These are research observations and conditional checks, not passed implementation tests. Do not re-ask settled capture scope or treat missing hardware evidence as a product-policy decision.
### Capture implementation evidence (execution, 2026-10-08)

extensions/plan3-window.ts is the narrow chosen PrintWindow HWND backend, not a desktop/browser platform. Native C# compilation and window enumeration passed within the existing Plan3 suite, without pixel capture or window-title export. HWND/PID/title/physical size/crop, minimized rejection, uniform/blank rejection, identity recheck and 15-second child timeout are coded; tests cover pure/mock limits. Hidden/occluded/GPU freshness and intended-app pixels remain unverified; unsupported capture must request an image, never focus/restore or substitute desktop pixels. Android skill and references/interact.md were read; explicit app/device selection and visual PNG inspection remain mandatory. No device was captured. Current available-tool lookup still establishes no safe general screenshot capability; public URL/redirect syntax is checked but capture returns unavailable, never a DNS/isolation or visual-observation claim. Unknown browser attestations are rejected. Human-supplied/captured image files are authorized only via the command UI, hashed/copied as inspiration-only, then must be visually inspected and described with borrow/avoid before transfer. Existing validateOpenDesignToolCall is reused for the real 700,000-byte MCP image cap before copy/project creation (the local helper's broader cap is not the transport limit). Final current node scripts/test-work-plan3.mjs passed; active LSP on four changed paths reports 0 diagnostics, 3 confirmed clean and 1 push-only inconclusive. No live provider, screen/device capture or final package validation is claimed.



## Phases

**Dependency order (stable IDs retained):** S01/S13 → S02/S08/S11/S14 → S03/S15 → single-direction part of S04 → S05/S07/S09/S12 → S10 real single-direction checkpoint → optional candidate part of S04 → S06 final focused checks/documentation. S07–S15 extend the named base phases; they are not extra per-design verification stages. Use the actual step check records and Resume context for execution evidence; live manual validation remains separate.

  - note: Reconciled master/ready state and existing ideas-flow dirty changes. Implementing confined Plan3-owned persistence first; no legacy controller or background work.
- [x] **S01** Add the narrow Plan3-owned design service and durable artifact/protocol state.
  - Implement: resolved stable id ownership, confined unique directory, atomic per-plan mutation queue, typed local states and existing client/contract imports. Preserve legacy session paths/contracts; no work-models controller imports or legacy store initialization.
  - Acceptance: title rename still resolves the same design; two plans cannot share artifacts; malformed pointers/symlinks/path escapes fail; interrupted local writes retain the last valid state.
  - Planned check: `node scripts/test-work-plan3.mjs` with new temp-directory service assertions, plus active LSP on changed .ts paths. See the actual check record below.
  - note: Added confined atomic Plan3 runtime/durable state, stable-id pointers and per-plan queue. Original dirty ideas-flow changes preserved. Fixed entry to reject a mismatched pointer instead of returning recovery status.
  - check: node scripts/test-work-plan3.mjs passed on final S01 code. Active LSP: 0 diagnostics; 1 file confirmed clean, 1 push-only server inconclusive.
- [x] **S02** Wire the optional command/menu/tool and brief-first creative intake.
  - Implement: /plan3 design [plan], current/named ownership, shared contextual overlay, guarded plan3_design activation and ready→draft transition; planning-only brief/reconciliation prompts. Offer only on appropriate substantial UI; preserve no-design finish/resume. Do not start a paid run before settled inputs and explicit phase opt-in. Initially accept draft/blocked/ready plans; active/completed plans need an explicit planning follow-up, not silent scope mutation.
  - Acceptance: /wo plan design forwards through the existing event, no legacy workflow activation; known answers reused, proposals labeled, material questions persist; native/RPC/headless behave honestly.
  - Planned checks: node scripts/test-work-plan3.mjs and CE_WORKFLOW_ENABLED=0 node scripts/test-work-settings.mjs; assert no OD call for normal plans and no commission with unresolved brief questions.
  - note: Registered deferred guarded plan3_design, explicit opt-in branch entry, /plan3 design [plan], /wo forwarding, contextual shared overlay and brief/current UI/component-map guidance. Preserved peer's progress-bar footer and unrelated ideas flow. Human review actions follow in S05.
  - check: node scripts/test-work-plan3.mjs passed after final S02 gate diagnostic fix; CE_WORKFLOW_ENABLED=0 node scripts/test-work-settings.mjs passed. Public fake-peer command commission/check reached validated single-direction review; not live provider evidence. Active LSP: 0 diagnostics, 3 clean/2 push-only inconclusive/1 work-models.ts too large.
- [x] **S03** Implement validated reference intake with Windows/Android/conditional browser capture.
  - Implement: explicit URL/image preflight and bounded copy/hash/upload; source/target/provenance/borrow-avoid recorded. Windows selected-window/region only (S15); Android skill/CLI with explicit device/app; browser screenshots only through a documented eligible installed tool. Reuse local/captured image validation; no unsafe UI-gate proxy or browser installation.
  - Acceptance: supplied public reference automatically captured/transferred when safe capture exists; signed/private/metadata/credentialed sources rejected; absent/unverifiable capture requests a screenshot instead of faking observation. Invalid/mismatched/oversize images and path/symlink escapes fail before upload.
  - Planned checks: extend node scripts/test-work-plan3.mjs with valid public URL/redirect inputs, private IPv4/IPv6/token URLs, image import/hash/caps and no-capability scenarios; fixture browser outcomes are not live website evidence.
  - note: Added syntactic public URL/redirect privacy guards and explicit unavailable-browser fallback (no navigation/DNS/isolation claim); command-only bounded image authorization/copy/hash, reference-only provenance and visual borrow/avoid requirement before any external project creation/upload. Added selected-window capture entry and Android skill guidance; real pixels/device/browser checks remain explicitly unverified under final manual validation.
  - check: node scripts/test-work-plan3.mjs passed on final reference code: public/private/mapped IPv4/IPv6/token URL cases, unsupported browser attestation, authorized image intake, MIME/extension/size/junction/hash tamper rejects before project creation, public fake-peer image upload/review. Active LSP four changed paths: 0 diagnostics; 3 clean, 1 push-only inconclusive.
- [wip] **S04** Commission and resume one direction, with optional three-candidate exploration.
  - Implement: single-direction generation by default, opt-in exactly-three candidate generation and explicit operator selection/refinement; target-aware v2 handoff prompts; upload only approved packet references. Persist project/request/exact payload/digest before create/start; one check per invocation; typed clarification/failure/cancellation and one deterministic export-repair attempt. Replacement/recharge runs require explicit user confirmation; uncertain start recovery keeps the original id/payload.
  - Acceptance: fake-peer restart/lost-response scenarios recover the same owner/run without duplicate mutations; candidate mode cannot auto-pick; invalid/missing handoff cannot pass from Preview success alone. Errors preserve inspection links and one actionable continuation.
  - Planned checks: node scripts/test-work-opendesign-client.mjs plus extended node scripts/test-work-plan3.mjs using the existing fake peer and scoped target/selection fixtures.
  - note: Single-direction fake-peer generation/import already passes; completing clarification/revision/restart recovery and human review/reconciliation next. Optional candidates remain blocked until the required real S10 checkpoint; no fake/lint evidence substitutes for it.
  - note: Single-direction clarification now writes a structured Blocking provider question, native /plan3 resolve persists bounded human answers, then continuation pins those answers into DESIGN-INPUT before dispatch. Successful original start payload stays ignored; native revision/replacement/recharge choices use same project and explicit consent, recharge keeps original request/prompt. Fresh controller and fake-peer restart recover lost create/start replies without duplicate mutations. Optional candidates remain unimplemented until real S10 checkpoint.
  - check: node scripts/test-work-plan3.mjs passed: waiting_for_user question deduplication, model answer/permission rejection, real installed ask_user component with simulated user freeform input, persisted Decisions/source before continuation, native revise, canceled recharge dialog, exact original recharge payload and new-id canceled-run replacement. Lost responses + fresh controller preserved original payload and only one new project/request. node scripts/test-work-opendesign-client.mjs passed; CE_WORKFLOW_ENABLED=0 npm run verify:quiet passed (legacy/client suites skipped by existing runner, client separately passed).
- [wip] **S05** Add human review, hash-pinned authority, same-plan reconciliation and optional-design gates.
  - Implement: bounded sync/import; explicit operator approval/abandonment; production rejects fixture/model-created human receipts. Bind both single/candidate approvals to exact owner/brief/inputs/references/handoff/remote revision; invalidate changed authority. Gate finish/execution only for opted-in active design. Approval sends a planning-only same-plan reconciliation prompt; include every DES-* check and keep draft until user finish.
  - Acceptance: local/scope authority edits block stale execution; approved/reconciled snapshots finish/execute offline or from a fresh clone without .pi state. Studio changes are adopted only via explicit sync/reapproval. Shared status/resume/finish gates reject missing reconciliation/DES-* coverage; ordinary/progress-only plans remain unchanged. Missing in-flight recovery still blocks; abandon preserves history and records cancel uncertainty.
  - Planned checks: node scripts/test-work-plan3.mjs for stale/mismatch/missing-state/receipt/cancel/reconciliation cases, plus manual shared-overlay keyboard/RPC review. Check the test workspace has no legacy work store/items and no implementation files produced by design.
  - note: Single-direction human command-dialog approval, reviewed-revision hash guard, frozen authority, same-plan planning-only reconciliation/DES coverage and explicit abandonment/history preservation are implemented and tested. Model actions cannot approve/abandon; malformed/fixture/model receipts cannot pass. Candidate selection pinning remains deferred until S10; active-run cancel uncertainty cases and real overlay/provider checks remain unfinished.
  - check: node scripts/test-work-plan3.mjs passed current public fake-peer approve/reconcile/finish/resume and post-approval explicit changed sync -> review -> human abandon, history retention, forged abandonment rejection. This is isolated simulated human UI/transport evidence, not actual human/provider/visual acceptance.
  - note: Single-direction human approval, pinned frozen authority, same-plan reconciliation, explicit abandon and history retention are implemented. Public fake-peer tests now cover both known active cancellation success and missing-executable cancellation uncertainty, preserving human waiver. Candidate-specific selection pinning remains deferred until S10; real overlay/provider checks remain unavailable.
  - check: node scripts/test-work-plan3.mjs passed latest current code, including new public pending-run -> human abandon cases (cancelled/uncertain); existing full regression/approval/portable/tamper tests also passed. Active LSP test path 0 diagnostics, push-only inconclusive; prior unchanged extension paths 3 confirmed clean. Simulated UI/transport only, no real human/provider/pixel claim.
- [wip] **S06** Document the optional flow and verify the final public-command experience.
  - Implement: README usage/limits, frozen authority versus explicit Studio sync, Plan3 versus legacy paths/policies and concrete capture limits. Keep focused new Plan3 assertions with workflow disabled; no blanket suite enablement or runtime verification pass. Preserve unrelated dirty files; no automatic version/commit/push changes.
  - Planned automated checks: node scripts/test-work-plan3.mjs; CE_WORKFLOW_ENABLED=0 node scripts/test-work-settings.mjs; node scripts/test-work-opendesign-client.mjs; CE_WORKFLOW_ENABLED=0 npm run verify:quiet; git diff --check; one batched active LSP check of changed paths. Await all results and record actual evidence; diagnose failures rather than weakening assertions.
  - Required manual check: with explicit design opt-in, real OpenDesign via /plan3 design reaches Preview, human approval and same-plan reconciliation; inspect target variants, explicit-sync revision/stale/reapproval and the optional three-direction branch. Validate /reload and native/RPC/headless behavior. No design opt-in/provider capability means this live feature-acceptance gate stays unfinished unless the user accepts the documented limit; no separate cost popup. Validate safe browser capture if available, otherwise report and test the accepted screenshot fallback. Do not claim a future implemented-product fidelity test from OD artifacts alone.
  - note: README documents optional Plan3 flow, native questions/continuation/revision/recovery, frozen snapshots vs explicit sync, component/token mapping, legacy storage/command distinction and capture limits. Final current automated development checks pass. Real /reload/public-command/Preview/human approval and optional candidate live checks remain unavailable, so not complete.
  - check: node scripts/test-work-plan3.mjs passed; CE_WORKFLOW_ENABLED=0 node scripts/test-work-settings.mjs passed; node scripts/test-work-opendesign-client.mjs passed; CE_WORKFLOW_ENABLED=0 npm run verify:quiet passed (workflow-disabled skips retained, no background verifier executed); git diff --check passed. Active LSP changed extension/controller/test/fixture batch: 0 diagnostics, 2 confirmed clean and 2 push-only inconclusive. All fake/provider/native simulated results remain explicitly not live human visual acceptance.
- [x] **S07** Extend S05 review output with a concise changed/preserved/revision-delta summary from current audit/handoff and prior accepted revision; check its presence and missing-evidence labeling in node scripts/test-work-plan3.mjs.
  - note: Review combines source-evidenced preserve/reconsider/remove audit with actual mapped work. Advisory delta compares current validated handoff/notes to the newest locally hash-matching historical human approval; missing/corrupt history is missing evidence, not authority or visual proof.
  - check: node scripts/test-work-plan3.mjs passed: supplied audit/mapping summaries, missing prior/audit labels, changed Studio notes against prior approved revision (notesChanged true, handoff/semantic areas unchanged). node scripts/test-work-opendesign-client.mjs passed. git diff --check passed. Active LSP 4 paths: 0 diagnostics, 2 clean/2 push-only inconclusive.
- [x] **S08** Extend S02/S05 brief and reconciliation with a bounded reuse/restyle/new component-token map; conditionally add approved-design fidelity/deviation guidance to executePrompt and test both approved-design and ordinary-plan paths with node scripts/test-work-plan3.mjs.
  - note: Prepare accepts bounded actual component/token path/action/kind/reason mapping and source-evidenced audit; drops arbitrary source-body properties, rejects duplicate mappings/symlinks/non-file reuse. Pinned input travels through commission/reconciliation; approved-only execution guidance requires project components/tokens, agreed states/viewports and explicit deviation/reapproval, never prototype source import.
  - check: node scripts/test-work-plan3.mjs passed current code: real fixture component/token paths, non-file/symlink mapping rejection, audit evidence boundary, source-body omission, preserved/restyled/new summaries, no implementation file creation, approved-snapshot execution wording and ordinary-plan regressions. Active LSP extensions confirmed clean (0 diagnostics); test/fixture probes push-only inconclusive. git diff --check passed. No real product fidelity claim.
- [x] **S09** Extend S05 gates to validate portable approved/reconciled local artifacts without .pi state or live OD; retain in-flight recovery blockers and test offline/fresh-clone execution, local tampering and explicit-sync invalidation in node scripts/test-work-plan3.mjs.
  - note: Portable approved/reconciled authority reads only confined tracked artifacts and hashes; valid missing-runtime clones do not construct a provider/client/runtime. Existing corrupt/in-flight runtime remains blocked. Explicit sync invalidates before remote reads, preserves prior snapshot history, restores approval only for verified unchanged bytes/fingerprint, and returns changed ready plans to draft.
  - check: node scripts/test-work-plan3.mjs passed on final current code: public fake-peer approval/reconciliation/finish/resume, closed-client tracked-only fresh clone with no .pi, tampered inputs/runtime/authority, unchanged explicit sync preserving readiness/hash and changed Studio MD sync requiring reapproval. Active LSP four paths: 0 diagnostics, 3 clean and 1 push-only inconclusive. Not a real provider/visual acceptance claim.
- [blocked] **S10** Sequence S04/S05 as a working single-direction slice first and retain a real public-command approval/reconciliation checkpoint before implementing optional candidate exploration; then finish candidate mode and S06 regression/live checks.
  - note: Single-direction simulated public command loop and current automated checks pass; required real /reload/public-command Preview/human approval/reconciliation does not exist yet. User-selected disposable calculator draft prepared at C:/SOFT/git/ce-workflow/docs/plans/2026-10-08-calculator-design-checkpoint-ca1c0001-plan3.md. Operator must /reload and /plan3 design ca1c0001, then visually review/approve via native menu; current agent reconciles that same draft. No separate cost popup, fake human receipt, candidate implementation or internal smoke substitutes.
- [x] **S11** Expose only openDesignCommand in workflow-off utility settings and add visible/editable versus legacy-policy-hidden assertions to CE_WORKFLOW_ENABLED=0 node scripts/test-work-settings.mjs.
  - check: CE_WORKFLOW_ENABLED=0 node scripts/test-work-settings.mjs passed: OpenDesign executable visible and editable, legacy visual policy/proof hidden. One UTILITY_SETTING_KINDS entry added in extensions/work-models.ts; no legacy controller used.
- [x] **S12** Wire the shared S05 design gate into finish/resume/status transitions, add approval-bound reconciliation/DES-* coverage checks, and test bypasses, stale markers, missing ids and ordinary plans in node scripts/test-work-plan3.mjs.
  - note: Shared local gate covers finish/resume/status preflight and queued transitions; status tools cannot activate draft design-reconciled work before explicit finish. Reconciliation binds exact human approval and checks literal DES ids (not prefix lookalikes). Human Force finish is explicitly labeled override, not approval/reconciliation/test proof; receipts untouched.
  - check: node scripts/test-work-plan3.mjs passed: direct ready/active/complete bypass rejection, missing approval/coverage, DES-1-extra not matching DES-1, stale marker hash, fixture/model approval rejection, required explicit finish after reconciliation, progress/timestamp neutrality and ordinary plan regressions. git diff --check passed. Active LSP four paths 0 diagnostics, 3 confirmed clean, 1 push-only inconclusive. Live keyboard/native/RPC acceptance still belongs to S06/S10.
- [x] **S13** In S01 define and validate the minimal Plan3 phase transitions, reuse only policy-free design helpers, and add pre/post-approval abandon, restart/recovery and illegal-transition assertions to node scripts/test-work-plan3.mjs.
  - check: node scripts/test-work-plan3.mjs passed: legal/illegal transitions, pre/post-approval abandonment, stable ownership, corrupt runtime/local-only restart status and concurrent entry assertions.
- [x] **S14** Extend S02 Plan3 local status/hints/completions for active design; test ordinary/pending/missing-state cases and assert rendering performs no OpenDesign calls in node scripts/test-work-plan3.mjs.
  - check: node scripts/test-work-plan3.mjs passed: design completion, local phase/footer hint, headless needs_human, ordinary plan regressions and unchanged fake-peer state during footer refresh. No watcher/polling added.
- [x] **S15** Expand S03 research/intake into Windows application-window/region capture (never monitor/desktop), Android skill-based device/app capture, and investigated installed-browser screenshot reuse; document concrete capability/hidden-window limits, add only a missing narrow window operation if necessary, and retain honest no-capability fallback and focused input/provenance checks.
  - note: Narrow extensions/plan3-window.ts uses app-rendered PrintWindow with HWND/PID/title/physical-size binding, whole/window-relative crop, 16-Mpixel bound and 15-second child timeout/disposal; never desktop capture, restore or focus. Minimized/blank/uniform output rejects; hidden/GPU/occluded freshness explicitly unverified and requires visual inspection before transfer. Android uses installed skill/interact reference and explicit app/device; no bundled browser, no fabricated safe capability.
  - check: node scripts/test-work-plan3.mjs passed: crop/target/timeout/mismatched-target checks and actual Windows C# compilation/window enumeration (no pixel capture or title export). Current tool lookup found no verified general screenshot tool; screenshot fallback asserted. Android skill plus references/interact.md read; installed android screen capture --help succeeded. No intended Windows app/Android device capture performed; these are unavailable live rendering evidence, not a success claim.

## Global validation

### Existing automated checks (execution only; not run during planning)

From `C:\SOFT\git\ce-workflow`, use existing commands:
- `node scripts/test-work-plan3.mjs` — extended single/three-direction workflow, ownership, menus, gates, reconciliation, no-design regression and interrupted recovery coverage.
- `node scripts/test-work-settings.mjs` with `CE_WORKFLOW_ENABLED=0` — direct/forwarded Plan3 entry and shared settings compatibility.
- `node scripts/test-work-opendesign-client.mjs` — existing fake stdio transport/error/identity/idempotency checks, not a live-provider test.
- `CE_WORKFLOW_ENABLED=0 npm run verify:quiet` — final general package gate; confirm new Plan3 checks are actually run, not skipped.
- `git diff --check` and one batched active LSP probe on changed extension/test paths.

Before running existing scripts, inspect their setup/teardown for shared state and Git side effects; run small suites sequentially unless independence is proven. While research remains ON, do not execute any script that commits/pushes even in a disposable repository. Future implementation requires user to turn research OFF first. No check above is claimed as passed on future code.

### Required behavior matrix

1. **Ordinary plan:** no design pointer; finish/resume and small UI fixes behave as today, with no OD probe/network call/popup.
2. **Opt-in known direction:** current/named draft or ready plan enters design once; one project/run; exact settled brief, repository design reuse and targets sent; native UI plus `/wo plan design` work with legacy workflow disabled.
3. **Creative exploration:** three real distinct previews only on request; no model/default selection; hash-bound human selection followed by refinement of that direction.
4. **Questions:** existing answers reused; material unknowns block commissioning in structured plan questions; provider clarification is shown as untrusted question data, answered by the user and persisted before continuing.
5. **References/capture:** Windows selected-window whole/region capture never substitutes desktop/monitor pixels; verify identity/crop/timeout and report hidden/minimized/blank limits. Android targets the explicit device/intended app using its skill/CLI and excludes unrelated/private screen content. Browser screenshots are conditional on documented isolation; otherwise request an image. All references retain source/target/hash/borrow-avoid; reject private/token URLs and unsafe images. No privacy-breaking fallback.
6. **Failures:** missing/wrong OpenDesign executable, timeout, daemon restart, split frames, lost project/start response, failed/canceled/recharge runs, missing handoff, invalid JSON/targets and one failed repair remain resumable. Uncertain mutations do not create duplicate projects/runs. Restart the host/controller in fake-peer tests, not just retry an internal function in the same instance.
7. **Approval:** success/Preview/model prose cannot approve. Reject fixture receipts; pin both modes. Local authority/scope/owner changes invalidate approval; progress timestamps do not. Explicit sync adopts Studio changes and requires focused reapproval. Approved-and-reconciled snapshots work offline/fresh clone without runtime state; no live calls at finish/execution. Failed remote checks or missing identity block unfinished external operations only.
8. **Reconciliation:** approval updates the same plan in the current agent/model, maps all `DES-*` criteria and preserves completed/unrelated scope. No legacy work-store or task files created. Plan stays draft until explicit finish. Explicit abandon is recorded, does not discard artifacts, and cancels/records uncertainty for an active run.
9. **Headless/RPC:** human selection/approval absent → `needs_human`, never inferred; RPC/native fallbacks work; Escape/parent/cursor behavior follows work-dialogs. No background continuation/watcher and no automatic code execution.

### Manual/live acceptance

Use an explicitly user-approved disposable Plan3 UI project and the public command path (`/plan3 design` or `/wo plan design`), not direct internal calls. Retain the packet, run/project ids, real preview/handoff, human approval, reconciled plan and the checks' results. Verify default single direction and exercise the optional three-direction branch; inspect desktop/mobile or the agreed target variants and a visible revision/Studio-edit → stale approval → reapproval sequence. Verify the commands live after /reload.

At least one real OpenDesign session must reach human approval and reconciliation before declaring the new integration complete; fake-peer tests cannot prove provider compatibility or design usefulness. Explicit design opt-in is required; there is no cost estimate or separate paid-run popup. Subscription/provider coverage has not been verified, so do not promise that runs are free. If unavailable, leave S06 unfinished/blocked unless the user explicitly accepts that documented limitation.

Public-site capture is conditional by D-06: test it with an available isolated capture tool if present; otherwise validate the honest screenshot-request path and report capture unverified, not successful. A later product build proves fidelity with that project's existing tests/screenshots/a11y checks, not OD artifacts masquerading as implemented UI. No new background visual evaluator is required.

## Resume context

Execution checkpoint, 2026-10-08: master, current agent/model only. No delegation/goals/legacy work tools/background verifiers, staging/commit/push/version changes. Preserve unrelated dirty changes and plan3:true. Plan active, 11/15 done: S01/S02/S03/S07/S08/S09/S11/S12/S13/S14/S15; S04/S05/S06 wip; S10 pending. Do not mark complete or build candidate mode before the accepted real single-direction checkpoint.

Own additions C:/SOFT/git/ce-workflow/extensions/plan3-design.ts and plan3-window.ts. Own additive controller integration C:/SOFT/git/ce-workflow/extensions/plan3.ts preserves existing ideas flow and peer's progress footer. Other own edits: openDesignCommand utility visibility only in work-models.ts; relevant settings assertions in test-work-settings.mjs; existing test-work-plan3.mjs extensions; narrow design-e2e fake peer additions; additive README Plan3 section explicitly labels legacy docs. Unrelated dirty plan3-ask.ts/work-dialogs.ts/plan3-advisor.md, untracked plan3-ideas.ts and camera-snapshots-and-change-watch-83ec1441-plan3.md remain untouched. Entire durable plan has been reread including historical accepted/rejected ideas; don't revive rejected cost/packet popup, broad suites/runtime verification, legacy migration/removal or direct /wo design scope.

Single-direction service: direct policy-free work-design helpers/client only, confined stable docs/designs/date-plan3-id pointer, ignored .pi/designs/plan3-id.json raw exact create/start payload/digest persisted before mutation. Successful original start payload is now retained only in ignored lastStart; not tracked metadata. Native revision returns to brief, preserves history and invalidates authority; canceled/failed replacement requires native choice/new request with same project/prompt. Recharge requires native choice and original request/project/prompt plus resume:true only; model args cannot confer this permission. New fake-peer cases kill after persisted create/start results and restart the peer + register a fresh controller; one project/request remains, original payload recovers. Not a real daemon/provider restart claim.

Provider waiting_for_user/clarification now writes a structured Blocking question in the main plan, as explicitly untrusted task data. Duplicate checks don't duplicate it. Native /plan3 resolve saves the user's bounded response/source through the controller mutation path before continuation; model-created answer/permission fails. plan3_design continue pins recorded answers into DESIGN-INPUT, reuses same project/targets/brief and requires all main questions resolved. Public native component test uses the real installed ask_user adapter with simulated freeform response, not actual user/provider acceptance. Deferred model tool actions: prepare/commission/continue/check/sync/reference_preflight/reference/review/reconcile; no approve/select/abandon/recharge/retry action. Real operator decisions come only through native command menus.

S07/S08 DONE: prepare projects bounded actual path/action/kind(component|token)/reason mapping, rejects duplicates/symlinks/non-file reuse, omits sourceBody and arbitrary properties, records optional preserve/reconsider/remove/evidence audit only with explicit source evidence. Review merges audit and mapping and compares validated current handoff/notes to latest locally hash-matching archived native approval; missing/corrupt prior/current audit is missing evidence, never visual/behavior proof or live Studio currency. Tests verify mapped accessible dialog/token file/new hypothetical component, no implementation file, missing labels and changed Studio notes versus prior approved revision. Approved-only execution prompt already requires mapped components/tokens, agreed states/viewports, deviations/reapproval; ordinary plans unchanged.

S05/S09/S12 remain sound in current suite: native displayed-authority recheck approval pins owner/input/brief/references/JSON/MD/fingerprint/revision; fixture/model/testOnly rejects. Approval sends planning-only SAME plan reconciliation, exact literal DES ids in Phases/Global validation and approvalHash-bound marker; draft cannot status-activate before human finish. Shared finish/resume/status gate local only. Tracked-only approved/reconciled clone validates without .pi/client. Explicit sync archives before invalidation, can't preserve approval on errors, only verified unchanged bytes/fingerprint restores old approval/readiness; changed sync makes ready -> draft/review. Native abandon preserves history, requires receipt and records known cancellation success/uncertainty; corrupt ignored state may be quarantined only under explicit abandonment. Candidate-specific selection authority remains unfinished.

Capture: only command-authorized supplied/selected-window images, type/hash/path and existing 700000-byte MCP cap checked before copy/project creation. Visual inspection + borrow/avoid mandatory before transfer; inspiration-only, not licensed production assets. URL syntax/privacy/redirect checks are not DNS/isolation/visual proof; no eligible safe general public-page screenshot tool established, honest screenshot fallback. Android installed skill/interact/help read; no device/app capture. Narrow Windows PrintWindow binds HWND/PID/title/physical size before/after, whole/window-relative crop, rejects desktop/shell/minimized/blank/uniform/over16MP, 15-second child timeout/disposal; no focus/restore/desktop capture. C# compilation/enumeration tested without pixels/private-title export. Hidden/occluded/GPU freshness remains unverified. Existing native/RPC scripted Escape parent behavior passes.

Final current automated development checks: node scripts/test-work-plan3.mjs PASS; CE_WORKFLOW_ENABLED=0 node scripts/test-work-settings.mjs PASS; node scripts/test-work-opendesign-client.mjs PASS; CE_WORKFLOW_ENABLED=0 npm run verify:quiet PASS. Existing workflow-disabled skips retained, including legacy design/client/background verifier suites; client checked separately. git diff --check PASS. Active LSP changed service/controller/test/fake-fixture batch: 0 diagnostics, 2 extension paths confirmed clean, 2 push-only inconclusive. README Markdown clean. No real provider/authentication/preview/user approval/reconciliation, native /reload, Windows pixels, Android capture or product-fidelity claim. No unresolved repeated failure/oracle needed.

S10 live target is settled: user explicitly chose Disposable calculator demo; don't ask that again. Prepared draft only at C:/SOFT/git/ce-workflow/docs/plans/2026-10-08-calculator-design-checkpoint-ca1c0001-plan3.md, no design pointer/run/source/receipts yet. Minimal web calculator, no private references/production source transfer/automatic implementation. Aesthetic is explicitly an agent proposal, not invented user brand decision. Read frontend-design when settling prototype direction. Read-only resolver previously found installed OpenDesign exe C:/Users/Flex/AppData/Roaming/Open Design/en/7619431cd36e5359/Open Design.exe (2 args), file discovery only, not provider/transport authentication proof.

Exact next action: operator /reload, then /plan3 design ca1c0001 through the real public command. Current agent settles/prepares minimal target-aware brief; commission one direction, check explicit pending continuation, inspect real desktop/mobile Preview/Studio, then operator approves displayed revision natively. Reconcile this SAME disposable plan and retain real artifacts/run ids/approval evidence for parent S10. Cannot fabricate human receipt or replace this checkpoint with fixture/internal-call smoke. Once real S10 passes, finish exactly-three explicit human candidate selection/refinement + candidate hash binding in S04/S05, rerun affected checks, final S06 live branch/keyboard/reload checks. Plan stays active; user action is required for real public command/visual approval before dependent candidate work.
Latest native calculator follow-up: user explicitly requested implementing reusable `/plan3 design finish [plan-id]`, now completed as calculator DEMO-04. Current native receipt/run ee866b01 succeeded with porcelain-calculator-prototype.html; new native finish adapter exports saved HTML/PNG, pins hashes/provenance locally, requests genuine human approval and same-plan reconciliation; no legacy provider-output schema imposed, browser, automatic generation/approval/implementation/commit/push. Native lifecycle replay is blocked even after a failed first collection. Fresh jiti live smoke exported correct desktop HTML18768bytes/PNG38729bytes into native-exports/f4d21864-8491-4f85-9570-92fb96e891c1 and updated calculator state to review; real human approval remains absent and the gate blocked. Final Plan3/client selfchecks, workflow-disabled verify:quiet and diff check passed; error LSP zero findings with3 clean/2 inconclusive. Full human/mobile/behavior/accessibility checkpoint, parent S10/candidates/global acceptance remain incomplete, not passed by export or fixtures. Durable details and exact user next commands are in C:/SOFT/git/ce-workflow/docs/plans/2026-10-08-calculator-design-checkpoint-ca1c0001-plan3.md. After Pi reload and saving OD edits, user can run `/plan3 design finish ca1c0001`, approve explicitly, reconcile the same plan and separately `/plan3 finish`; no automatic continuation.


## Amendments

- 2026-10-08: Draft title set through Plan3; file renamed with stable id 1fc5d5ce. Original request preserved verbatim.
- 2026-10-08: Added S02, S03, S04, S05, S06 after initial S01 through plan3 add. These are initial implementation phases based on inspected contracts and user decisions D-01–D-06, not extra approved product scope.
- 2026-10-08: Replaced legacy automatic work-item materialization with same-agent Plan3 reconciliation; retain only reusable transport/contracts. No product implementation performed.
- 2026-10-08: Added S07 after S06: Accepted IDEA-a6e98e4e: 1. Show changed/preserved summaries and revision deltas
- 2026-10-08: Added S08 after S07: Accepted IDEA-3a0660d1: 2. Map production components/tokens and carry design fidelity into execution
- 2026-10-08: Added S09 after S08: Accepted IDEA-687547a7: 3. Make an approved design a portable frozen snapshot
- 2026-10-08: Added S10 after S09: Accepted IDEA-9569e107: 4. Prove one complete direction before adding candidate exploration
- 2026-10-08: Added S11 after S10: Accepted IDEA-aa775a43: 5. Make OpenDesign launch settings reachable with the legacy workflow off
- 2026-10-08: Added S12 after S11: Accepted IDEA-d6ada485: 6. Use one coded design gate and checkable reconciliation evidence
- 2026-10-08: Added S13 after S12: Accepted IDEA-be7fab40: 7. Define a small Plan3-owned state model instead of inheriting legacy policy transitions
- 2026-10-08: Added S14 after S13: Accepted IDEA-e594d067: 10. Surface pending design through local status, hints and autocomplete
- 2026-10-08: Added S15 after S14: Accepted IDEA-d84f2f9c: 9. Define a concrete documented rule for safe capture-tool eligibility
- 2026-10-08: Expanded/re-presented all twelve merged ideas through the new individual ideas flow; nine accepted, three rejected, including interpretation of four commented responses. Removed their stale deferred questions without losing proposal/response history. No new product implementation.
- 2026-10-08: Applied accepted S07–S15 to concrete requirements/approach/base phases, retaining stable IDs and recording dependency order. Superseded blanket live-OD/runtime gates for approved/reconciled frozen snapshots; closed status-tool transition bypasses; replaced legacy policy-bearing session reuse with small Plan3-owned phases; made the launch-settings visibility change explicit.
- 2026-10-08: Revised accepted capture scope covers selected Windows window/region and Android skill/CLI plus researched conditional browser capture. Recorded primary Windows docs, local Android help and configured Pi package capabilities; hidden/minimized rendering and live devices remain unverified. No browser platform/dependency or desktop substitution.
- 2026-10-08: Rejected cost/packet popup, extra mandatory broad suite enablement/runtime verification and legacy migration hint. Existing focused implementation/final checks remain development acceptance; extra post-feature verification is opt-in/off by default. Future legacy removal/direct /wo design entry is not authorized here.
2026-10-08 targeted live-checkpoint recovery fix (latest user: “research mode is off, fix stuff”): accepted discovered normal-desktop empty bootstrap args without broadening arbitrary argument launches; pending create validates saved payload identity and only exact typed MCP missing-id lookup permits same-payload/same-id recovery. Permission/daemon/other-id failures never replay; lost-response lookup-first behavior retained. Current client and Plan3 regression suites, CE_WORKFLOW_ENABLED=0 npm run verify:quiet and git diff --check passed; active LSP on the five changed source/test/fixture paths reports 0 diagnostics (2 confirmed clean, 3 push-only inconclusive). Live generation/visual approval NOT reverified: /reload then calculator /plan3 design ca1c0001 → Check / recover remains the exact next public action. Full current checkpoint is C:/SOFT/git/ce-workflow/docs/plans/2026-10-08-calculator-design-checkpoint-ca1c0001-plan3.md → Resume context. S10/candidates and global live acceptance remain incomplete; no automatic implementation/approval/commit/push or replacement project.
Latest explicit user instruction for calculator checkpoint ca1c0001 overrides the browser-opening workaround: launch/show the native OpenDesign app, send the whole settled idea automatically, let the user work there, stop. Removed Plan3 browser-opening rows/branch/import and corresponding README instructions; regression tests assert no browser/shell opening, including forged saved URL cases. Native app show confirmed windowVisible=true and one plain-idea start_run accepted runee866b01-0cf5-4ae0-8ece-0e44d9d1d892 in existing calculator project. Exact plain brief and acceptance receipt saved in calculator design directory. No imposed ce-workflow handoff schema, polling, exports, visual inspection, approval, reconciliation, product calculator implementation or further automation. Plan3 and workflow-disabled package checks passed; source/test LSP zero error diagnostics (one inconclusive). Parent S10/candidate/global live visual acceptance remains unverified; do not mark it complete from this narrower handoff. Preserve prior history and unrelated dirty files. Current agent stops here as requested.













## Ideas

### IDEA-a6e98e4e 1. Show changed/preserved summaries and revision deltas

Status: accepted
Response: {"kind":"selection","selections":["Accept"]}

#### What this is

> Add a concise human-facing summary to the existing design review: what the design changes, what behavior remains unchanged, and what changed since the last reviewed revision. This is not a second approval gate, visual-diff engine or separate report generator. Example: “Rework navigation and spacing; preserve checkout steps and saved preferences. Revision 2 changes mobile navigation only.” The current plan already validates artifacts, but hash/currentness information alone does not explain the visual decision to the user.

#### What you gain

> Makes review faster and less opaque; helps catch accidental behavior changes; lets a focused revision stay focused instead of restarting the whole design discussion. Uses the audit's preserve/reconsider/remove facts and the approved handoff rather than inventing new product requirements. Especially useful when the user edits OpenDesign Studio between syncs.

#### Drawbacks and risks

> The summary is an explanation, not machine proof of visual or behavioral fidelity; the agent may omit a change unless it consults the actual synchronized outputs. Keep it short and label unverified observations. A screenshot comparison engine would be more rigorous but adds scope and is not proposed. No additional provider run is needed merely to render the summary.

#### Implementation and affected files

> Extend brief/reconciliation guidance in C:\SOFT\git\ce-workflow\extensions\plan3.ts and review results in the proposed C:\SOFT\git\ce-workflow\extensions\plan3-design.ts. Display the summary through existing work-dialogs review detail/purpose surfaces. Derive explanations from the current audit, handoff and prior accepted revision, while retaining the hash checks as the actual authority gate. Add review/delta assertions to C:\SOFT\git\ce-workflow\scripts\test-work-plan3.mjs; do not build another dialog system.

#### Cost

> Small: a bounded review field/prompt and existing-view rendering/test changes. No dependency, extra approval popup or background process. Depends only on S05's existing synchronized review data.

#### Recommendation

> Accept. This improves the usability of an already-required review without expanding the lifecycle.

#### Sources and agreement

> [you], parent idea 1 written before advisor output. No direct advisor overlap. Sources: this plan R2/R6 and S05; C:\SOFT\git\ce-workflow\extensions\work-design.ts renderCurrentUiAudit/renderDesignRevisionPrompt as existing behavior references. The proposal has not been implemented or live-tested.

#### Proposed requirement

> Design review must explain changed visuals, preserved behavior and revision deltas in the existing review view. Summaries are advisory explanations, not substitutes for synchronized hash validation or human visual approval.

#### Proposed steps

> - Extend S05 review output with a concise changed/preserved/revision-delta summary from current audit/handoff and prior accepted revision; check its presence and missing-evidence labeling in node scripts/test-work-plan3.mjs.

### IDEA-3a0660d1 2. Map production components/tokens and carry design fidelity into execution

Status: accepted
Response: {"kind":"selection","selections":["Accept"]}

#### What this is

> Make the approved design actionable for the real repository. During brief preparation and reconciliation, record a small map of design elements to actual components/tokens: reuse unchanged, restyle existing, or create new. Example: reuse the existing accessible Dialog, restyle Card with approved spacing/color tokens, add a narrow navigation component only if the approved design truly needs it. On later execution, the Plan3 prompt names the approved handoff/approval and tells the agent to implement and verify the agreed screens, states and viewports using the project's own stack.

#### What you gain

> Reduces prototype-to-production mismatch, unnecessary component replacement and blind copying of OpenDesign HTML. Converts the already-promised R9 fidelity rule into the execution path. The map helps estimate the diff and preserves tested behavior/accessibility. Deviations become visible planning decisions instead of silent aesthetic drift.

#### Drawbacks and risks

> Repository paths can become stale and must be checked again at execution. A map is not an automatic converter, and new components may still be justified; do not force reuse where it breaks the approved intent. Merely naming an existing component is not proof it matches the intended interaction. No new mandatory OpenDesign schema field is needed.

#### Implementation and affected files

> Add reuse/restyle/new mapping to brief and same-plan reconciliation in C:\SOFT\git\ce-workflow\extensions\plan3-design.ts and planning guidance. Conditionally extend executePrompt in C:\SOFT\git\ce-workflow\extensions\plan3.ts only for approved design pointers: read exact authority artifacts, use mapped production components/tokens, compare real output at agreed states/viewports, and block/report material deviations for design revision. Reuse appropriate Read/Plan/Verify wording from C:\SOFT\git\ce-workflow\skills\work-design-handoff\SKILL.md as reference without changing or loading its legacy orchestration instructions. Test approved/no-design prompt branches in C:\SOFT\git\ce-workflow\scripts\test-work-plan3.mjs.

#### Cost

> Small to medium: a bounded map and conditional prompt/test changes in S02/S05. No converter, dependency, new evaluator or code import. Depends on approved handoff/artifact paths already in scope.

#### Recommendation

> Accept. It closes the practical gap between a good-looking OD prototype and a maintainable implementation.

#### Sources and agreement

> [you] parent idea 2 plus [anthropic/claude-opus-5-5] advisor idea 5; complementary ideas with agreement, not identical independent suggestions. Sources: plan R5/R9; C:\SOFT\git\ce-workflow\extensions\plan3.ts executePrompt currently has generic frontend guidance, not an approved-handoff-specific clause. Advisor wording is advisory; paths and API details must be rechecked on implementation because unrelated Plan3 changes are currently dirty.

#### Proposed requirement

> Brief/reconciliation must classify relevant production components and tokens as reuse/restyle/new with actual repository paths. Execution for an approved design must read its pinned handoff/approval, honor that mapping, verify agreed states/viewports with existing project tools, and record/block material deviations rather than silently change the design.

#### Proposed steps

> - Extend S02/S05 brief and reconciliation with a bounded reuse/restyle/new component-token map; conditionally add approved-design fidelity/deviation guidance to executePrompt and test both approved-design and ordinary-plan paths with node scripts/test-work-plan3.mjs.

### IDEA-687547a7 3. Make an approved design a portable frozen snapshot

Status: accepted
Response: {"kind":"selection","selections":["Accept"]}

#### What this is

> After human approval and reconciliation, use the exact repository-local brief, handoff and approval as implementation authority. Finishing or executing that plan would not require the ignored .pi/designs runtime file or a live OpenDesign connection. A fresh clone or another machine can validate the pinned artifacts and continue. Explicit design sync is how later Studio changes are discovered and offered for reapproval; it does not silently replace the approved design. In-flight or uncertain runs still need their persisted recovery identity and must never be recreated blindly.

#### What you gain

> Decouples production implementation from a design provider/desktop remaining online. Makes the committed design handoff useful across machines and after local cache cleanup. Local hashes still detect changed/corrupt briefs, references, handoffs or receipts. Avoids a repeated offline override popup on every resume.

#### Drawbacks and risks

> A remote Studio edit after approval is not discovered until explicit sync. The product must clearly say it is implementing the approved snapshot, not claiming remote currency. This deliberately changes the current plan's mandatory remote-currentness rule. Alternatives: retain strict live checks, or offer a one-time recorded offline override after a failed check. Accept here selects the frozen-snapshot approach; use custom text to choose an alternative.

#### Implementation and affected files

> Amend plan approach items 5/11 and S05. In the proposed C:\SOFT\git\ce-workflow\extensions\plan3-design.ts, validate approved/reconciled authority from confined durable docs/designs artifacts and local hashes; runtime state is needed only for unfinished external operations. Keep non-secret project/run lineage in durable provenance. C:\SOFT\git\ce-workflow\extensions\plan3.ts finish/resume gates use that result. Explicit sync with changed authority invalidates the applicable approval and starts focused reconciliation/reapproval. Test fresh-clone/no-runtime, offline approved, altered local artifact and missing in-flight identity cases in C:\SOFT\git\ce-workflow\scripts\test-work-plan3.mjs.

#### Cost

> Medium: gate/storage-currentness changes and recovery tests. No new offline setting, cache layer or dependency. Depends on the same human approval and reconciliation receipts already required by D-05.

#### Recommendation

> Accept the frozen-snapshot approach. The handoff should be portable; provider-dependent live gates are appropriate before approval or while a run is unresolved, not permanently during implementation. Keep the remote-edit detection tradeoff explicit.

#### Sources and agreement

> [you] parent idea 3 and [anthropic/claude-opus-5-5] advisor idea 4 directly overlap on portability. Advisor proposed one-time offline override; parent recommends a frozen snapshot instead. Source: C:\SOFT\git\ce-workflow\.gitignore excludes .pi/; current plan items 5/11 require missing-state and remote blockers. This policy is unapproved until this review choice.

#### Proposed requirement

> After explicit human approval and same-plan reconciliation, a validated frozen local design snapshot is authority for finish/execution, independent of ignored runtime state or live OD availability. Local authority edits invalidate it. Remote Studio changes are discovered/adopted only through explicit sync and reapproval; missing or uncertain in-flight mutation state remains a recovery blocker. This supersedes the current blanket remote/missing-runtime gate for approved snapshots only.

#### Proposed steps

> - Extend S05 gates to validate portable approved/reconciled local artifacts without .pi state or live OD; retain in-flight recovery blockers and test offline/fresh-clone execution, local tampering and explicit-sync invalidation in node scripts/test-work-plan3.mjs.

### IDEA-9569e107 4. Prove one complete direction before adding candidate exploration

Status: accepted
Response: {"kind":"selection","selections":["Accept"]}

#### What this is

> Change implementation sequencing, not product scope: first make the single-direction public-command loop work from brief through real OD Preview, human approval and same-plan reconciliation. Then build and verify the already-approved three-candidate branch. S04 currently bundles generation variants, while S05 supplies approval/reconciliation and S06 places real testing at the end. An early checkpoint exposes practical bridge problems before optional selection/refinement complexity is added.

#### What you gain

> Makes the smallest useful experience usable first. Finds real handoff/protocol and UI friction early, avoiding the historical mistake of mistaking a raw commissioning smoke for a complete flow. Gives a clear discriminating checkpoint: a real human-approved export must reconcile the same plan, not merely generate a preview.

#### Drawbacks and risks

> Requires user/provider availability earlier; absence must be recorded, not bypassed. A live run may incur charges, so it needs explicit consent. This checkpoint does not replace final three-candidate, recovery or regression coverage. An offline fake loop can support development but cannot be called a real-provider pass.

#### Implementation and affected files

> In S04/S05 implement and exercise the single-direction branch first; defer only the optional candidate sub-branch until its essential human-gate/reconciliation path exists. Use the public /plan3 design command in an approved disposable UI project. Record project/run, preview, handoff, real human approval and reconciled plan. Then complete three-direction selection/refinement and keep S06 final coverage. Do not write a new test framework or omit D-03's feature.

#### Cost

> Low code cost; medium schedule dependency because of one earlier real OD session and human review. No extra orchestration. Both the offline checks and final live acceptance remain necessary.

#### Recommendation

> Accept. It is the smallest honest milestone and reduces the risk of building a large flow around an unproven endpoint.

#### Sources and agreement

> [you], parent idea 4 before reading advisor output. Source: plan S04–S06 and C:\SOFT\git\ce-workflow\docs\plans\2026-08-31-002-fix-redesign-selection-implementation-e2e-plan.md, “Why the previous test passed the wrong thing.” No claim that such a run has happened here.

#### Proposed requirement

> Implement and prove the public single-direction brief→Preview→human approval→same-plan reconciliation slice before optional candidate-selection/refinement work. Preserve the full three-on-request scope and final validation; obtain provider consent and record unavailable live evidence honestly.

#### Proposed steps

> - Sequence S04/S05 as a working single-direction slice first and retain a real public-command approval/reconciliation checkpoint before implementing optional candidate exploration; then finish candidate mode and S06 regression/live checks.

### IDEA-aa775a43 5. Make OpenDesign launch settings reachable with the legacy workflow off

Status: accepted
Response: {"kind":"selection","selections":["Accept"]}

#### What this is

> Expose the existing OpenDesign executable/command-spec setting in utility Settings even when the legacy workflow is disabled. The current plan says a Plan3 user should fix launch configuration in /wo settings, but that row is filtered out. Show only launch configuration: legacy Visual design workflow policy and Design review proof settings remain hidden and do not control the optional Plan3 phase.

#### What you gain

> Makes the planned error-recovery instructions actually usable. Avoids asking users to turn on legacy orchestration just to configure a transport. Reuses validation, project/global setting behavior and the existing Settings overlay instead of adding a new configuration surface.

#### Drawbacks and risks

> Adds one utility settings row and therefore touches work-models.ts, which the original affected-file list did not otherwise need for this feature. The label/help must clearly describe the executable/spec rather than imply enabling the old workflow. Credentials must still be rejected and kept outside package settings. No broader legacy settings exposure is proposed.

#### Implementation and affected files

> In C:\SOFT\git\ce-workflow\extensions\work-models.ts add openDesignCommand, and only that kind, to UTILITY_SETTING_KINDS; retain the existing command-spec validation/editor. Amend this plan's affected files. Extend C:\SOFT\git\ce-workflow\scripts\test-work-settings.mjs to prove the row is visible/editable with CE_WORKFLOW_ENABLED=0 while legacy design policy/review rows stay hidden. Plan3 launch errors can then safely point to that exact row.

#### Cost

> Small: one visibility rule and focused settings assertions. No new setting key, dependency or workflow activation. Depends on the existing OpenDesign command-spec UI.

#### Recommendation

> Accept. This is a concrete feasibility fix to an existing plan requirement, not an extra design feature.

#### Sources and agreement

> [anthropic/claude-opus-5-5] advisor idea 1; [you] independently verified and agrees. Checked C:\SOFT\git\ce-workflow\extensions\work-models.ts UTILITY_SETTING_KINDS, the openDesignCommand row and workflow-off filter (at review time lines 32362, 32956 and 33037). Recheck line numbers against the current dirty source before implementing.

#### Proposed requirement

> The existing OpenDesign executable/command-spec row must be accessible in /wo Settings with legacy workflow disabled; do not expose or require legacy visual-design policy/review controls. Validate specs and do not store credentials.

#### Proposed steps

> - Expose only openDesignCommand in workflow-off utility settings and add visible/editable versus legacy-policy-hidden assertions to CE_WORKFLOW_ENABLED=0 node scripts/test-work-settings.mjs.

### IDEA-d6ada485 6. Use one coded design gate and checkable reconciliation evidence

Status: accepted
Response: {"kind":"selection","selections":["Accept"]}

#### What this is

> Enforce the same optional-design rules at every coded transition that could start or finish work: /plan3 finish, resume paths and plan3 tool status ready/active/complete. Entering design explicitly puts the Plan3 pointer into planning/research mode. In addition, make reconciliation checkable with an approval-hash-bound marker and all approved DES-* criteria represented in Phases or Global validation. A single shared gate reports the exact missing/stale evidence rather than different callers inventing different rules.

#### What you gain

> Closes a real bypass: the current status tool can set active/complete and can set ready outside the planning-pointer guard even though finish/resume may block. The reconciliation marker survives reload and identifies which design the plan reconciled. DES-* omission messages help the agent fix an incomplete plan instead of declaring it ready based on prose.

#### Drawbacks and risks

> Criterion-id presence is structural coverage, not proof that meaningful tests were written or run; user review and later execution evidence still matter. Do not let ordinary plan progress edits falsely invalidate approval. Explicit user Force finish remains an override, recorded as such, not visual or implementation proof. The gate's local/remote policy must follow whichever snapshot choice the user makes for idea 3.

#### Implementation and affected files

> Add a shared optional-design blockers/check function in C:\SOFT\git\ce-workflow\extensions\plan3-design.ts and call it from all relevant transition paths in C:\SOFT\git\ce-workflow\extensions\plan3.ts, including the model-facing status action. Use setPointer(plan,true)/research(ctx,true) on design entry. Validate a reconciliation receipt/marker bound to the approval hash and enumerate missing DES-* ids in Phases/Global validation. For no design pointer return no extra blockers/network calls. Extend C:\SOFT\git\ce-workflow\scripts\test-work-plan3.mjs with bypass, mismatch, missing-id and ordinary-plan tests.

#### Cost

> Small to medium: one checker wired into existing callers plus focused tests. No new verifier or semantic test-generation engine. Works with either strict remote checks or frozen authority; it does not choose that policy itself.

#### Recommendation

> Accept. Requirements that affect readiness should be enforced once in code, not only through agent instructions.

#### Sources and agreement

> [anthropic/claude-opus-5-5] advisor ideas 2/3 consolidated; [you] verified the status path and agrees. C:\SOFT\git\ce-workflow\extensions\plan3.ts status action previously guarded ready only via pointer.planning; finish/resume/browse/event routes and R6/S05 are the relevant seams. Existing unrelated edits must be preserved.

#### Proposed requirement

> Use a shared design gate for finish, every resume route and tool status ready/active/complete; design entry sets planning/research state. Gate readiness on current approved authority plus an approval-bound reconciliation marker and DES-* coverage in Phases/Global validation. Keep ordinary plans unchanged and label recorded human Force finish overrides as overrides, not proof.

#### Proposed steps

> - Wire the shared S05 design gate into finish/resume/status transitions, add approval-bound reconciliation/DES-* coverage checks, and test bypasses, stale markers, missing ids and ordinary plans in node scripts/test-work-plan3.mjs.

### IDEA-be7fab40 7. Define a small Plan3-owned state model instead of inheriting legacy policy transitions

Status: accepted
Response: {"kind":"selection","selections":["Accept"]}

#### What this is

> Choose a minimal phase model for the new service rather than reuse the old off/auto/required session policy and its full lifecycle. Suggested phases cover brief, pending, clarification, optional candidates, review, approved, reconciled, abandoned and explicit failure/recovery behavior. Abandonment must be legal both before and after approval without deleting history. Reuse canonical hashes, handoff/candidate/artifact validators and brief/audit renderers; leave legacy session behavior unchanged.

#### What you gain

> Avoids pretending an explicit optional phase has an off/auto/required policy. Makes cancellation/abandonment and post-approval reconciliation match the new user experience. Prevents importing implementation/proof/materialization states just because the old helper already has them.

#### Drawbacks and risks

> A small new transition list and persistence validation are code to maintain. The shorter alternative is a fixed placeholder legacy policy and mapping post-approval abandon to superseded, but that brings hidden semantics and confusing status names. Accept here selects the small Plan3 model; custom text can choose the mapping alternative. Do not grow it into another generic state-machine framework.

#### Implementation and affected files

> Define bounded Plan3 phase values and legal transitions inside C:\SOFT\git\ce-workflow\extensions\plan3-design.ts in S01. Reuse C:\SOFT\git\ce-workflow\extensions\work-design.ts hashDesignValue, validateDesignHandoff, candidate/path/image helpers, renderDesignBrief and renderCurrentUiAudit, but not its policy-bearing createDesignSession/transitionDesignSession. Test legal recovery/abandonment and invalid transitions in C:\SOFT\git\ce-workflow\scripts\test-work-plan3.mjs. Amend the plan's current reuse/state wording so it no longer promises incompatible helpers.

#### Cost

> Small: a local enum/transition check and tests, with no dependency or reusable state-machine abstraction. The transport and structured-design schemas remain shared.

#### Recommendation

> Accept the small Plan3-owned model. It is clearer than pretending legacy policy semantics are irrelevant while depending on them.

#### Sources and agreement

> [anthropic/claude-opus-5-5] advisor idea 6; [you] verified and agrees. C:\SOFT\git\ce-workflow\extensions\work-design.ts createDesignSession/validateDesignSession require off|auto|required; approved transitions do not include canceled and canceled is terminal. These are checked facts; exact minimal new phases remain implementation details within the bounded requirement.

#### Proposed requirement

> Use a bounded Plan3-owned phase/transition model with explicit recovery and pre/post-approval abandonment. Do not reuse the legacy off/auto/required policy/session transitions; retain shared handoff/hash/path/image/brief/audit helpers without changing legacy contracts.

#### Proposed steps

> - In S01 define and validate the minimal Plan3 phase transitions, reuse only policy-free design helpers, and add pre/post-approval abandon, restart/recovery and illegal-transition assertions to node scripts/test-work-plan3.mjs.

### IDEA-c0201bd5 8. Combine exact packet review with paid-run consent

Status: rejected
Response: {"interpretation":"User does not want cost calculations, estimates or a separate paid-run confirmation ceremony: the design is requested to be done and user uses subscription models. Reject this combined packet/cost popup proposal. Keep R8's inspectable minimal packet and existing explicit design opt-in/data boundaries, not extra cost-gating UI. Subscription coverage or image-generation support is user-reported, not verified OpenDesign billing/provider evidence; do not promise runs are free or introduce another image provider.","userResponse":"{\"kind\":\"freeform\",\"text\":\"I dont care about costs calculation, that also costs to calculate, the thing needs to be done anyway so no point of just seeing how much will that cost me. besides, both subscription models I use - sol/opus/sonnet can generate images, actually maybe even luna, so we are ok on cost\"}"}

#### What this is

> At a new paid design commission, show the user the actual outbound packet: plan id, brief/hash, repository component/token paths being described, reference sources, target matrix and a link to DESIGN-INPUT.json. Combine this with provider-cost consent in one existing shared dialog, not a separate transfer confirmation for every reference. Pin permission to the payload/packet so the model cannot change what is sent after approval. New replacement/recharge operations require their own explicit choice; identical uncertain-response recovery keeps the original identity.

#### What you gain

> Turns R8's “reviewable packet” into something the user actually sees before external/provider work starts. Clarifies what project information leaves the machine and prevents phase opt-in from implicitly approving unknown later scope. Also covers the live-run provider consent already required by S06 without two unrelated dialogs.

#### Drawbacks and risks

> Adds one human interaction per new paid commission; that is friction compared with phase opt-in alone. Same-request recovery must not repeatedly ask or duplicate charges. A JSON-repair run may itself incur provider cost: disclose a bounded one-repair allowance in the initial consent, and require fresh consent if the repair goes beyond that approved packet/budget. Public-page transfer permission D-04 remains unchanged; this is not a popup for each capture or upload.

#### Implementation and affected files

> In C:\SOFT\git\ce-workflow\extensions\plan3.ts use the shared command/dialog human path to issue consent for the exact proposed C:\SOFT\git\ce-workflow\extensions\plan3-design.ts packet. The model-facing commission action consumes that persisted payload-bound consent and refuses missing/changed consent. Use existing work-dialogs/RPC fallback; headless without a real consent returns needs_human. Test consent missing, packet changed, unchanged recovery, approved bounded repair, replacement and recharge in C:\SOFT\git\ce-workflow\scripts\test-work-plan3.mjs.

#### Cost

> Small to medium: one existing-dialog confirmation plus payload binding/tests. No general permissions framework or new per-reference modal. Depends on the packet hash already needed for recovery.

#### Recommendation

> Accept the combined packet/cost boundary, with bounded repair allowance explicitly disclosed. Do not manufacture price estimates the provider cannot supply.

#### Sources and agreement

> [anthropic/claude-opus-5-5] advisor idea 7; [you] agrees on a combined boundary, not an extra upload gate. Source: plan R8, D-04 and S04/S06; proposed model tool can currently commission after opt-in without showing the final packet. This is an explicit new consent requirement for your choice.

#### Proposed requirement

> Before a new paid commission or recharge, obtain one human consent covering the exact outbound packet and disclosed provider-cost/one-repair allowance. Bind consent to payload identity; refuse changed/unapproved packets, do not re-prompt identical idempotent recovery, and do not add per-public-reference transfer confirmations. Missing headless consent returns needs_human.

#### Proposed steps

> - Bind S04 commissioning to shared human packet/cost consent, including any bounded repair allowance; test missing/changed consent, identical recovery and replacement/recharge boundaries in node scripts/test-work-plan3.mjs.

### IDEA-d84f2f9c 9. Define a concrete documented rule for safe capture-tool eligibility

Status: accepted
Response: {"interpretation":"User selected Accept and expanded capture into three actual cases: Windows program window rather than monitor/desktop, Android using Android skills, and browser screenshot capability research using already installed extensions. Accept that revision. Hidden/invisible-window capture is a desired capability, not proven; research and capability-check it, report unsupported results instead of silently substituting desktop capture. A new narrow enumerate/select/window-region tool is an option only if existing capture cannot do the job; do not build a generic browser/capture framework.","userResponse":"{\"kind\":\"selection\",\"selections\":[\"Accept\"],\"comment\":\"you are into something here. we have 3 capture cases here - windows program - add a rule to capture not from the monitor/desktop, but from the program window itself, which can be even hidden - we can also add a tool that shows/finds a program window and captures part of all of it and return it. for android - use the android skills. for browser, which is the least I do - there i have no idea what exists as capture screenshots, that needs a research, but we can surely use the browser extensions we have here, forgot the names\"}"}

#### What this is

> Replace the vague “isolation can be verified” promise with a concrete capability boundary. Integrate only an identified browser/capture tool whose documented behavior supplies a fresh non-authenticated context and the required safe public-network request/redirect controls. The service must know the capability identity and limits; an arbitrary tool name or the agent saying “safe” is not evidence. When no eligible tool is configured, use the already-approved screenshot/image fallback. This does not bundle a browser or claim every Pi setup supports capture.

#### What you gain

> Makes D-06 honest and testable; avoids a dead automatic path that actually relies on an unverifiable model assertion. Keeps public-site convenience where a suitable existing tool exists while preventing reuse of an authenticated desktop/browser profile. Separates reference-only inspiration from human-approved preview fidelity evidence.

#### Drawbacks and risks

> No eligible screenshot tool was found in this planning session, so automatic capture cannot be promised here. Documented behavior is still not proof of every deployed version; the integration needs a version/source check and an actual safe capture exercise. Alternative: one-time user attestation (weaker, explicitly unverified), or defer automated capture and ship screenshot intake only. Accept selects documented capability eligibility, with fallback when none qualifies.

#### Implementation and affected files

> Specify the accepted concrete tool identity/capability checks in S03 implementation notes and the proposed C:\SOFT\git\ce-workflow\extensions\plan3-design.ts reference preflight. Keep this narrow: no settings platform or generic browser adapter registry. Before enabling an integration, read its primary docs for profile/network isolation and verify the live installed capability; unsupported/missing identity returns capture-unavailable. Tests cover eligible fixture, unknown source, unsupported isolation and image fallback in C:\SOFT\git\ce-workflow\scripts\test-work-plan3.mjs. A supported tool's concrete name cannot be invented during this ideas review.

#### Cost

> Small for the eligibility/fallback rule; medium for the first concrete capability integration and live verification if one is available. No new dependency or browser backend. Actual supported-tool availability remains a recorded verification limit, not assumed.

#### Recommendation

> Accept documented-capability-only eligibility. Avoid user/model safety attestations as a substitute for enforceable isolation. If no suitable existing tool is available during execution, report it and exercise the accepted screenshot fallback.

#### Sources and agreement

> [anthropic/claude-opus-5-5] advisor idea 8; [you] agrees with a documented capability boundary. Sources: D-06/S03 and C:\SOFT\git\ce-workflow\scripts\ui-gate\capture.mjs (not a suitable arbitrary-site safe browser). Current session tool discovery found no screenshot tool. This proposal does not reverse the user's no-bundled-browser decision.

#### Proposed requirement

> Automatic public inspiration capture may use only a concretely identified existing tool with documented and deployment-checked fresh-profile/public-network controls. Unknown or unverifiable capability is unavailable and uses the accepted screenshot fallback; do not infer isolation from model prose, create a browser framework or claim universal capture support.

#### Proposed steps

> - Specify and test S03 documented capture-capability eligibility and unsupported/no-tool fallback; enable a concrete integration only after reading its primary isolation docs and recording a live capability/capture check, otherwise retain honest image intake.

### IDEA-e594d067 10. Surface pending design through local status, hints and autocomplete

Status: accepted
Response: {"kind":"selection","selections":["Accept"]}

#### What this is

> Show the current design phase/next user action beside ordinary Plan3 progress, and include /plan3 design in continuation hints when an active design needs attention. Add design to both subcommand descriptions and the separate hard-coded completion list. Example: “P3 0/6 · design: check pending” tells the user to return with /plan3 design without claiming the provider has just been polled.

#### What you gain

> Makes the no-watcher flow discoverable after the initial response scrolls away. Reduces confusion about a pending external run while preserving R7's explicit continuation. Catches the easy-to-miss separate autocomplete array so the new command actually appears.

#### Drawbacks and risks

> A local pending status can be stale until the user checks; wording must not imply live remote monitoring. Rendering should tolerate missing/corrupt local state and remain bounded so it cannot slow the TUI. Do not add a timer, network call, extra provider poll or redundant permanent widget.

#### Implementation and affected files

> Update refresh/nextHint/SUBCOMMANDS and argument completions in C:\SOFT\git\ce-workflow\extensions\plan3.ts. Read only locally persisted summary state or durable artifact status, with best-effort errors like existing footer handling. Test phase hints/completion, ordinary plans, corrupt/missing state and absence of OD calls during render in C:\SOFT\git\ce-workflow\scripts\test-work-plan3.mjs.

#### Cost

> Small: local status/hint strings and completion/test coverage. No dependency, watcher or background worker. Depends only on S01's bounded local state.

#### Recommendation

> Accept. It is lightweight feedback that makes explicit continuation usable, not a new orchestration loop.

#### Sources and agreement

> [anthropic/claude-opus-5-5] advisor idea 9; [you] agrees. Sources: C:\SOFT\git\ce-workflow\extensions\plan3.ts refresh, nextHint/NEXT_HINT, SUBCOMMANDS and getArgumentCompletions; line numbers changed in the current unrelated ideas-flow edits, so navigate by symbol.

#### Proposed requirement

> Expose active design phase and explicit next action through local-only Plan3 status/hints, and include design in command descriptions/autocomplete. Rendering never polls OD or starts a watcher; missing/corrupt state is surfaced safely and ordinary plans remain unchanged.

#### Proposed steps

> - Extend S02 Plan3 local status/hints/completions for active design; test ordinary/pending/missing-state cases and assert rendering performs no OpenDesign calls in node scripts/test-work-plan3.mjs.

### IDEA-9182260f 11. Check pure design contracts with workflow off, not the legacy lifecycle suite

Status: rejected
Response: {"interpretation":"User rejects making broader/general contract verification a mandatory heavy burden and wants extra verification optional after the feature is complete, off by default. Do not add broad suite enablement or per-design verification orchestration. Retain the smallest focused development selfchecks for the new nontrivial authority/recovery/security logic and existing final project checks, explicitly distinguish these from runtime design sessions. Broader contract/legacy regression runs are opt-in post-feature checks, not automatic gates.","userResponse":"{\"kind\":\"freeform\",\"text\":\"I'm afraid this step will result in the huge verification steps that will add heavy burden on the design phases, we can actually test that as an optional after the feature is complete, but off by default\"}"}

#### What this is

> Ensure general Plan3 verification exercises the reused handoff/hash/path/image/approval contracts and client behavior even when legacy orchestration is disabled. Correct an advisor factual error: test-work-design.mjs is not a pure contract test; it also imports work-models.ts lifecycle functions and work-store.ts. Do not simply put that whole legacy suite into GENERAL_TESTS. Reuse or narrowly relocate the relevant pure assertions in the existing Plan3 self-check, and enable the client-only suite generally.

#### What you gain

> Catches regressions in shared security/authority helpers on the configuration this new feature is designed for. Avoids a false green final gate caused by skipped suites. Keeps the no-legacy-work-item boundary intact while using existing standalone assert scripts rather than inventing a runner.

#### Drawbacks and risks

> Copying many assertions would create duplicate maintenance; extract only genuinely pure coverage if a narrow split is needed, otherwise add targeted Plan3 regressions. Leave legacy controller scenarios where they are. Existing scripts can create disposable Git fixtures, so inspect their side effects and never run commit-producing scripts while research is ON. No checks have been run for future code.

#### Implementation and affected files

> Extend C:\SOFT\git\ce-workflow\scripts\test-work-plan3.mjs with the needed pure shared-contract cases. Update C:\SOFT\git\ce-workflow\scripts\verify-package.mjs GENERAL_TESTS so C:\SOFT\git\ce-workflow\scripts\test-work-opendesign-client.mjs runs with workflow off; do not add all of test-work-design.mjs. If implementation demonstrates a worthwhile split of pure assertions, keep it minimal and register that narrow suite explicitly. Include final CE_WORKFLOW_ENABLED=0 npm run verify:quiet and inspect which suites actually ran.

#### Cost

> Small to medium: focused assertions and test-discovery change; no runner or dependency. A separate pure-test file is an alternative only if justified by avoiding duplication, not an automatic new module.

#### Recommendation

> Accept the corrected coverage goal. Reject the advisor's mistaken pure-import claim and blanket legacy-suite enablement.

#### Sources and agreement

> [anthropic/claude-opus-5-5] advisor idea 10 proposed the coverage; [you] checked and corrected it. C:\SOFT\git\ce-workflow\scripts\test-work-design.mjs lines 32–54 import work-models.ts/work-store.ts; C:\SOFT\git\ce-workflow\scripts\verify-package.mjs GENERAL_TESTS controls workflow-off coverage. Advisory findings are evidence to verify, not authority.

#### Proposed requirement

> Final workflow-off validation must run Plan3's reused pure design-contract regressions and the OpenDesign client self-check without enabling legacy lifecycle scenarios. Do not classify test-work-design.mjs as contract-only; retain its legacy gating or narrowly split pure assertions only when justified.

#### Proposed steps

> - Extend Plan3 pure-contract regression coverage and make the client-only self-check general in verify-package.mjs; confirm CE_WORKFLOW_ENABLED=0 npm run verify:quiet actually executes these checks without enabling the legacy design lifecycle.

### IDEA-d80f8ee4 12. Add a migration hint from legacy design commands

Status: rejected
Response: {"interpretation":"User selected Reject and stated that legacy orchestration is expected to be removed soon, with /wo design becoming a new design entry rather than a migration hint. Reject legacy-hint work. Record that future command direction; this response does not authorize removing legacy product code during planning or silently changing the current plan's command routing.","userResponse":"{\"kind\":\"selection\",\"selections\":[\"Reject\"],\"comment\":\"nah old workflow is going completely off i the comming days even removed from source an the /wo design or so will be the new design commands so nope\"}"}

#### What this is

> When legacy workflow is off and a user types /wo design or /wo redesign, show a one-line pointer to the new /plan3 design entry instead of only the generic off notice. This is a help hint, not a route into the new phase and not permission to enable legacy orchestration. It would help users who remember the old command while keeping /wo plan design as the existing supported forwarding route.

#### What you gain

> Makes the new entry discoverable for users of the old interface and reduces mistaken attempts to turn on the workflow just to do optional design. Very small change if that command branch is already being touched for settings support.

#### Drawbacks and risks

> Not necessary for the requested Plan3 experience; changes old command behavior and adds another cross-surface assertion. Can confuse users if the wording implies old/new controllers are equivalent. Alternatives: document the new command and rely on Plan3 autocomplete, or add this hint later when there is evidence of migration confusion.

#### Implementation and affected files

> If accepted, add one guarded workflow-off design/redesign notice in C:\SOFT\git\ce-workflow\extensions\work-models.ts; no command registration/routing or legacy activation. Test it in C:\SOFT\git\ce-workflow\scripts\test-work-settings.mjs, ensuring enabled legacy behavior is untouched and the notice starts no provider operation.

#### Cost

> Very small code cost; low risk, but extra scope that does not unblock the new flow. No dependency or added state.

#### Recommendation

> Reject for this plan/defer. Prioritize the direct new command, settings fix and approval loop; add migration copy later only if users need it. Selecting Accept explicitly includes the hint.

#### Sources and agreement

> [anthropic/claude-opus-5-5] advisor idea 11; [you] recommends defer, not agreement on adopting it. Source: C:\SOFT\git\ce-workflow\extensions\work-models.ts workflow-off /wo handler and plan R1. The old commands currently lead to generic off behavior when disabled.

#### Proposed requirement

> With legacy workflow off only, /wo design and /wo redesign may show a concise /plan3 design migration hint, without forwarding, enabling legacy orchestration or changing the enabled controller.

#### Proposed steps

> - If this proposal is accepted, add the workflow-off legacy-design migration notice and focused no-routing/no-provider assertions to node scripts/test-work-settings.mjs.
