---
plan3: true
status: active
created: 2026-11-10
updated: 2026-11-10T22:28:04.989Z
reviewed: 2026-11-10
started: 2026-11-10T20:34:40.770Z
---

# Design studio fixes and selective Astryx integration

## Original request

> “okay do the comparison. since our studio is accessible from remote I'd love that we grab everything valuable from astryx and implement with us”

> “research is off, make a plan with all the features we are worth borrowing”

This is the implementation plan following comparison cfaad2ca. The current request authorizes planning, not implementing it now. User priority: keep the studio usable through the remote hub, including phones, and incorporate the useful Astryx features rather than replacing that workflow with a CLI.
> “and the fixes in our code too”

Explicit scope clarification: the shared sandbox, modal-pin, touch/settled-render and Mark-state fixes in our existing code are required deliverables, not merely observations or backlog suggestions.


## Goal, requirements, and non-goals

Make our existing design studio better at building, inspecting and handing off interactive applications. Borrow proven Astryx capabilities while retaining the fast HTML-first path and existing remote session UX.

Requirements:
- **R1 Safe local forms.** Generated HTML and component forms validate and save in the real preview sandbox; native form submission cannot navigate or send data. Preserve opaque origin and existing viewer boundaries.
- **R2 Comments on layered controls.** Stable-ID picks, visible numbered pins and inline edits work inside dialogs and popovers, including scrolling, resizing and phone layouts.
- **R3 Real interaction evidence.** Existing look reports input capability as well as dimensions; exercise touch, mouse, keyboard, focus, reduced motion and short-screen dialogs in the actual sandbox. Screenshots wait for a bounded ready/settled condition rather than capturing opening transitions.
- **R4 Reproducible Mark states.** Mark can reproduce declared app states, including an open modal and supported unsaved field values. State support and fidelity are explicit; no silent fresh-page screenshot advertised as the current state.
- **R5 Theme tools independent of React.** Generate coherent accent and neutral ramps, semantic type and radius scales, light/dark CSS tokens and contrast evidence. Reuse Tweaks, DESIGN.md and HANDOFF.md; choosing tokens alone must not require a component runtime.
- **R6 Version-aware discovery.** The existing design tool can obtain bounded installed-version component, template, theme and usage documentation on demand. No full catalog in every prompt; returned provenance identifies exact versions.
- **R7 Optional Astryx app foundation.** Selecting Astryx creates a locally bundled, pinned component-backed prototype inside the same design session and preview. HTML remains default; existing web and deck designs remain independent of Astryx. No CDN dependency during preview or restored-version viewing.
- **R8 Editable, coherent versions and handoff.** Source, build recipe, exact dependency pins/lockfile, notices and generated output remain consistent through turn snapshots, restore, clone and select. Build failure is visible and never replaces the last good preview. Dependency caches are not copied into every version.
- **R9 Scoped upstream maintenance.** Track adopted Astryx areas in catch-up with a pinned baseline and provenance ledger, retaining MIT copyright/permission notices and dependency notices.
- **R10 Evidence before success claims.** Repeat the same end-to-end generation/refinement benchmark and aggregate all continuations, compaction, runtime, provider tokens, cost, turns and tools. Do not retain or describe an optimization as successful after a material overall regression.
- **R11 Existing remote UX stays.** Sessions, directions, chat comments, device and screen pickers, versions, restore, clone, selection, reference capture and handoff continue through existing controls. Follow the shared ask_user dialog conventions; no new standalone studio page or end-user CLI workflow.

Non-goals: rewrite the hub in React; mandate Astryx; import every upstream component or dependency; replace interactive previews with static export; ship experimental native targets; copy the internal interaction framework or general gesture engine; automatically execute imported source; promise arbitrary live-browser state capture or whole-site WCAG compliance.

## Decisions

- **D1 User scope:** plan all features judged worth borrowing from the completed investigation, with remote access central. Research mode is off by the user's statement; this request remains planning only.
- **D2 Keep the studio and HTML default (agent recommendation carried into this draft).** Astryx is an explicit app-design option, not a new hub implementation or a default imposed on websites/decks. The comparison showed modest visual gains with materially greater runtime/token/cost overhead. Optional availability is a capability claim, not an optimization claim.
- **D3 Borrow capabilities, not the repository wholesale (agent proposal).** Include theme generation/contrast utilities, bounded version-aware discovery, reusable component behavior, interaction evidence and upstream tracking. Shared form, modal-pin, rendering and ownership fixes are prerequisites that benefit both approaches.
- **D4 Candidate sandbox fix, experimentally supported.** Use a design-only response CSP with allow-forms and form-action 'none', retaining no allow-same-origin. The live design iframe currently has no sandbox attribute: sendExplored applies the shared SANDBOX_CSP header to generic viewers too. Keep that generic policy unchanged; select the design policy only for authorized own-design responses (access?.own, as used for bridge injection), and use the equivalent design policy in renderDesign's dedicated serve(). Local submit handlers then work while an unhandled POST is blocked. Validate target/popup cases and non-design viewers before settling the production change; do not simply enable unrestricted forms.
- **D5 Pin the audited runtime (agent proposal).** Initial core, CLI and neutral theme use 0.7.12 together. Inspected source revision was fd5cf0df987791117e96ccc0bec603c64be8b136, whose manifests describe a newer main version. Record source provenance separately from published runtime versions. Updates are reviewed, not silently pulled per render.
- **D6 Prefer supported public tooling/components.** Prebuilt JS/CSS does not require a StyleX compiler. Prefer public theme APIs/compiler or small verified pure helpers over the full engine. Prefer public complex controls over swizzling their internal dependency graphs. Preserve full licenses, not just package.json's license field.
- **D7 Keep authority at existing boundaries.** Design agent remains the only source writer; existing hand edits still enter chat. The extension owns a single ensure-built path: design look runs it before rendering so the agent gets errors in the same turn; agent_end runs it before snapshot publication. Select and clone flush through it, and restore shares the same per-design serialization. Unchanged source skips a rebuild. Agents edit source and call existing design actions, not shell builds; generated output is published only by this path with a matching source/build digest. The existing write/edit guard is not a shell sandbox, so this is lifecycle enforcement, not a claim that arbitrary bash is prevented. CLI/build execution is trusted code execution, not protected by the iframe sandbox: no auto-init, arbitrary package installation, CLI host embedded in the hub process, or execution of imported configs/source without the existing project-trust boundary.
- **D8 Separate token systems from component runtimes.** Existing OD systems are DESIGN.md/tokens.css packages. An Astryx runtime needs explicit source/build/provenance ownership, not a fake token-only catalog entry. Extend existing system selection minimally rather than inventing a plugin framework.
- **D9 State fidelity must be honest (agent proposal).** Start with declared named states and a bounded serializable page-state bridge for supported drafts. Use it for both HTML and React. Unsupported state, timeout or failed replay must be visible before Mark annotation, never silently replaced by a blank/default state. No generic serialization of closures, functions, DOM or arbitrary React internals.
- **D10 Reuse existing components and controls.** Existing design tool, preview, Tweaks, annotator, snapshots, catch-up and ask_user UI remain the integration points. All new extension/imported extension modules are .ts. No new dependency for a few simple helpers.

- **D11 Evidence-dependent choices.** Technical choices requiring evidence belong to the investigation steps. If those reveal a user-facing tradeoff that cannot preserve the stated requirements, record a concrete question under Open questions before proceeding; do not silently narrow R4 or R8.
- **Q-01** How should the optional pinned Astryx tooling/runtime be delivered? Blocks P3-18 and its dependents; shared correctness fixes do not require it. This is an agent recommendation, not an approved decision.
  - Option: Download once on first use (recommended) — Ask through existing ask_user before a host-side download of the reviewed lockfile into the shared Pi cache; report progress and failure. No phone-side install. Warm use is offline; a cold offline cache cannot use Astryx tooling. Keep ordinary HTML sessions and the base package lean.
  - Option: Include it with the package — Larger ce-workflow installation/update for everyone, but no separate first-use runtime download. Preserve fixed versions and full notices; verify npm package/dependency footprint.
  - Answer: {"kind":"freeform","text":"wait wait, we are stealing stuff from astryx, why pinning or downloadin git? or are you saying that we will use it internally? this is better than just copy the code?!"}
  - Source: user via ask_user /plan3 resolve; not independently verified.
- **D12 Q-01 clarification, not approval:** The user's submitted freeform response asks why the plan needs downloading/pinning rather than copying useful code. It selects neither delivery option and does not authorize removing the proposed component path. Preserve the original Q-01 response above. Resolve adoption scope in Q-02 before returning to delivery: borrowing helpers/patterns does not inherently require Astryx as a runtime dependency; consuming published complex components does. The current optional-library sections remain proposals pending clarification.
- **D13 User adoption decision (resolves Q-02):** “it looks using astryx as a lib and use everythig valuable with it is the best choice, we will get that working from a remote right?” The user selects library integration alongside the valuable standalone tooling/ideas, rather than deferring it or copying the complex component framework. Retain the proposed optional component path and all shared studio fixes; do not treat this as a request to import every upstream package or rewrite the hub. Remote hub operation is required: dependencies/builds run on the host; remote browsers receive local bundled assets and use the existing chat/preview/comments/version/handoff controls, without installing Node, Git or Astryx on the client. This is approved direction, not proof of complete remote/device compatibility. P3-14/P3-16 still provide that verification. Dependency delivery on the host remains unresolved; Q-01's earlier freeform response did not select download or inclusion.
- **Q-01** How should the approved Astryx library/tooling be delivered to the host machine? Q-02 adoption scope is settled by D13; the earlier Q-01 response requested clarification, not a delivery selection. Blocks P3-18 and dependent runtime work, not shared correctness fixes. Neither option requires installing developer tools on the remote phone/computer.
  - Option: Download once on first use (recommended) — With explicit consent through existing ask_user, download the reviewed pinned dependencies into the host's shared Pi cache; show progress/errors. Warm use needs no registry access; first use needs network. Keep the base package lean.
  - Option: Include it with the package — Increase the host's ce-workflow installation/update footprint so no separate first-use runtime download is needed. Preserve exact pins/notices and verify package footprint.
  - Answer: {"kind":"selection","selections":["Download once on first use (recommended)"]}
  - Source: user via ask_user /plan3 resolve; not independently verified.
- **D14 User delivery decision (resolves Q-01):** The applied selection is “Download once on first use (recommended).” On first Astryx-backed use with no usable pinned cache, the host asks for consent through existing ask_user, downloads the reviewed dependencies with visible progress/errors, then reuses the verified shared cache. No developer tooling is installed on remote clients; ordinary HTML/deck use triggers no runtime download. A warm cache requires no registry access; a cold cache needs host network access. Keep the base package free of the installed runtime tree and mandatory Astryx dependencies. This settles delivery, superseding earlier unresolved-delivery statements without changing the recorded answers. It is a user choice, not evidence that provisioning or offline/remote behavior has been implemented or verified.
- **D15 Live benchmark authorization/budget:** User selected “Approve $40 budget” after being told P3-01 needs a fresh product HTML baseline and P3-15 two final product arms; the historical pilot estimated ~$4 HTML + ~$20 Astryx, excluding setup. Authorized isolated real hub design-session benchmark runs with frozen Opus 5.5/high, not delegated implementation. Track a combined $40 recorded-estimate budget across these runs, stop between calls/stages at the limit (an in-flight call may overshoot), and do not automatically repeat unsuccessful runs. No paid generation had begun at approval. Implementation remains in this agent.







## Open questions

### Blocking

None.

### Deferred

None.

## Relevant files and approach

Paths below are rooted at **C:/SOFT/git/ce-workflow/**:

| Files | Responsibility |
|---|---|
| extensions/design.ts; scripts/test-work-design.mjs | Session/Store fields, fromV1/load compatibility, actions, agent_end, systems, snapshots, restore/clone/select, handoff and write boundary |
| extensions/design-render.ts | Shared SANDBOX_CSP, RenderState, rendering, reports and preset dimensions |
| hub/web/files.ts; hub/src/explore.ts; hub/scripts/test-explore.mjs | Generic viewer compatibility, design-only response policy, preview serving, watching and version-specific files; generic CSP assertions stay unchanged |
| hub/src/design-bridge.ts; hub/web/design-view.ts | Comment picks/pins, inline styles, device controls, state bridge and Mark |
| hub/src/api.ts; hub/web/app.ts; hub/web/annotate.ts | designshot allowlist, Mark request/error/fidelity handling, comment dialog and existing annotation flow |
| extensions/design-guide.md; extensions/design-guide.UPSTREAM.md; skills/frontend-design/ | Session guidance and source attribution; do not stuff component catalogs into the craft guide |
| extensions/plan3-catch-up.ts; extensions/work-catch-up-baseline.json; scripts/work-catch-up-record.mjs | Hard-coded PLAN3_CATCH_UP_PACKAGES, baseline/ledger and reviewed-version recording (inspect/reuse the existing recorder, no change unless needed) |
| package.json; runtime manifest/lock assets (location settled in P3-02) | Q-01 delivery footprint, integrity pins and npm pack contents; root dependencies remain untouched under the recommended on-demand option |
| docs/upstream/astryx.md (new, proposed) | Audited upstream revision, adopted helpers/behavior, local destinations, licenses and excluded areas |
| README.md; hub/README.md; CHANGELOG.md | User-visible behavior, limits and combined hub/tool documentation |

Add a focused .ts helper only when existing modules cannot hold a coherent responsibility without becoming a dumping ground; no generic runtime-provider architecture. Before editing, reread actual bodies and callers. Concurrent product changes were present at the end of research; never overwrite or stage them incidentally.

### Existing evidence and baseline

Comparison plan: C:/SOFT/git/ce-workflow/docs/plans/2026-11-10-astryx-versus-html-remote-design-studio-comparison-and-integ-cfaad2ca-plan3.md.

Research artifacts currently live under C:/Users/Flex/AppData/Local/Temp/pi-research-62ygWq/: astryx-assessment.md and comparison/{brief.md,refinement.md,rubric.md,manifest.json,workflow.js,metrics.json,comparison-report.md,acceptance.mjs,form-security.mjs}. Preserve the necessary non-secret evidence durably before implementation; Temp is not a release asset or durable benchmark baseline.

Same fresh Opus5.5/high workers, identical brief/refinement/craft guides; ultrafull configured and confirmed in Astryx's compaction. Initial and retained refinement sessions were deduplicated; separate compaction usage included.

| Combined initial + refinement | HTML baseline | Astryx pilot |
|---|---:|---:|
| Active elapsed | 16m41s | 26m14s |
| Provider total tokens incl. cache traffic | 5,208,115 | 12,852,944 |
| Adapter cost estimate, not invoice | $4.0550 | $19.9657 |
| Recorded assistant turns | 58 | 103 |
| Tool calls | 93 | 130 |
| Separately gzipped runtime assets | 14,038 B | 415,298 B |

One Astryx turn is zero-usage housekeeping. Launch-to-final elapsed was 25m14s vs 26m16s because HTML waited ~8m32s at the workflow barrier. Cache writes materially affected costs. Warm installed dependencies and parent evaluation overhead were excluded, not silently counted as zero. One pair is a pilot, not statistical proof.

Actual sandbox checks: HTML 95/98 and Astryx 92/98 passed; no harness exceptions. Both failed Save because sandboxed submit handlers were blocked. Scratch allow-forms control passed 100/100 each; allow-forms plus form-action 'none' also passed 100/100 each. A separate positive/negative security control confirmed local handler success, blocked network POST, actual POST in unrestricted control, and opaque storage throughout. Production code was not changed.

Both support stable comment picks/inline edits but hide pins behind native modal top layer. Phone layouts passed measured targets; Astryx's 820px coarse-pointer controls were 20–32px. Settled screenshots showed modestly better Astryx desktop/modal compactness, while both overviews delayed the working list on phones. Current Mark re-renders a fresh page. No real phone/Safari, AT audit, editable-source restore round trip or full live hub lifecycle was verified.

## Commands

Run only checks relevant to touched code after each change. Commands execute from C:/SOFT/git/ce-workflow; these scripts already exist:
- **C1** `node scripts/test-work-design.mjs`
- **C2** `node --no-warnings hub/scripts/test-explore.mjs`
- **C3** `node --no-warnings hub/scripts/test-api.mjs`
- **C4** `node --no-warnings hub/scripts/test-browser.mjs`
- **C5** `node --no-warnings hub/scripts/test-annotate.mjs`
- **C6** `node scripts/test-work-plan3.mjs`
- **C7** `node scripts/test-work-tool-loader.mjs`
- **C8** `node --no-warnings hub/scripts/test-sessions.mjs`
- **C9** Active LSP diagnostic batch on changed .ts paths, source=lsp and scope=paths; unavailable/stale results are not a clean check.
- **C10** Product-wired benchmark established in P3-01: configurable isolated project/output roots, actual design start sessions and production guide/tool/build path, frozen brief/refinement/model/effort and full usage aggregation. Measure the pre-change product HTML baseline before shared changes; rerun both product HTML and Astryx at P3-15. Keep the original worker-only pilot separately for historical comparison, not as evidence that the finished studio was measured. Record exact durable driver commands when created; UI quality is verified by P3-14/C11.
- **C11** Agent-controlled browser/device verification using the available tools, with actual commands, environment and results recorded per case. No unsupported test command is implied by this label.

## Phases

### Phase 1: Preserve evidence and settle technical contracts [think]
- [x] **P3-01** Preserved portable pilot evidence and captured a real pre-change product HTML initial/refinement baseline with explicit context/acceptance limits.
- [x] **P3-02** Settled bounded draft replay/readiness/input, public theme API, host cache and source/build lifecycle contracts; candidate form targets and HTML/React drafts independently passed.

### Phase 2: Fix the shared studio correctness gaps [code]

- [x] **P3-03** Design-only form handlers now run while native navigation remains blocked; generic viewers retain their original sandbox.
- [x] **P3-04** Pins paint above native modal/popover layers, follow layout/scroll and hide stale controls; modal inline edits and real-pointer isolation pass screenshot regressions.
- [wip] **P3-05** Fix render readiness and distinguish touch capability from viewport size.
  - Add bounded readiness/settling to the existing renderer and preview evidence; do not wait forever for looping animations. Report timeout/errors rather than silently capturing transitional or blank pixels.
  - Headless rendering accepts honest mouse/touch contexts; device controls clearly distinguish size-only live iframe behavior from emulated rendering. Never claim changing iframe width emulates touch. Cover phone, tablet, landscape and reduced motion with C1–C4, C9.
- [ ] **P3-06** Fix Mark state loss through a bounded, explicitly acknowledged page-state replay contract.
  - Implement the P3-02 contract in the bridge, RenderState, designshot validation, look and Mark flow. Reuse existing annotator. Preserve screen, version, slide/hash, unsaved CSS and supported modal/form state; do not execute functions from serialized state.
  - Bind request/reply to current frame/load/version, bound payload and capture time, avoid logging transient user values, and reject stale or malformed replies. Unsupported state or failed replay is visible before annotation rather than a false exact capture.
  - Verify HTML and React open-dialog drafts, custom selectors, scroll where supported, unsaved inspector edits, stale loads, unsupported pages and replay errors. Checks C1–C5, C9.
- [ ] **P3-07** Add actual-sandbox interaction checks and a touch-safe app starter contract.
  - Fold the proven parent acceptance patterns into existing tests: Save, validation, focus trap/return, Escape, state retry, comments, modal pins, no external assets and settled images. Do not rely on file:// selfchecks for sandbox claims.
  - Extend design-guide.md's phone-only target rule to coarse-pointer tablets and test fixtures accordingly; the component starter is created later in P3-10. Preserve desktop density and test native form/date behavior where automation can observe it. Checks C1–C4, C9.

### Phase 3: Provision pinned tooling and borrow theme/discovery features [code]

- [ ] **P3-18** Provision the pinned runtime and docs cache before theme generation, discovery and starter creation.
  - Delivery is approved by Q-01/D14; depends on the P3-02 manifest/trust contract, not a further delivery decision. On first Astryx-backed use with a missing cache, obtain consent through existing ask_user, then download the pinned dependencies on the host with visible progress. Ordinary HTML/deck use must not trigger provisioning. Proposed cache: <Pi agent directory>/cache/design-runtimes/astryx/<lock-digest>, outside projects and .pi/designs. Resolve the full transitive dependency graph with integrity hashes, not caret ranges at first use.
  - Install only that reviewed manifest/lock with lifecycle scripts disabled; verify required native build binary is usable without silently enabling install scripts. Stage, integrity-check and atomically publish the cache under a provisioning lock; report cancellation, corruption, offline miss and errors through existing UI.
  - Record cold download bytes/time and package footprint. Test cold-cache consent, refusal/cancellation without partial activation, offline cache miss, and warm offline reuse without registry calls or another install prompt. A cold offline miss leaves existing HTML features available. No arbitrary user/model-supplied package names or root-project manifest changes. Verify delivery assets and notices in the npm pack dry-run, plus C1, C7, C9.

- [ ] **P3-08** Add standalone theme generation, contrast evidence and existing Tweaks integration.
  - After P3-18, emit named accent/neutral ramps, semantic type/radius scales and light/dark CSS from the supported mechanism. Borrow helpers from the version-matching published package/revision where possible; if using audited 0.7.13 main with 0.7.12 runtime, record exact helper SHA and compatibility tests in the ledger. Preserve full attribution and upstream tests; test alpha compositing and contrast thresholds.
  - Feed generated values through current live Tweaks and Keep-to-chat flow, with DESIGN.md/HANDOFF.md updated by the single writer. Existing token-only systems and no-runtime designs stay valid.
  - Golden/semantic tests cover determinism, boundary inputs, invalid tokens, both modes, readable error messages and stable handoff. Checks C1, C4, C9; no broad new theme abstraction.
- [ ] **P3-09** Add bounded installed-version discovery to the existing design tool and system selection.
  - Depends on P3-18's installed verified cache. Expose search plus requested component/template/theme details with exact source/version metadata. Bound response size, query length, result count, execution time and errors; cache by pinned version, not latest.
  - Use a bounded subprocess or safe selected API, never the process-owning CLI host or auto-init. Unknown names/version mismatches cannot write files or project instruction files. Only the chosen system's compact guidance enters its session. Checks C1, C7, C9.

### Phase 4: Add the optional component path and safe lifecycle [code]

- [ ] **P3-10** Add an explicit pinned Astryx app starter without changing the default or hub framework.
  - Reuse the current start/system-selection UI and ask_user conventions and the P3-18 runtime cache; use D14's approved first-use host download, consent and cached reuse. Use local fonts/assets and full notices; do not auto-install arbitrary template dependencies. The starter must be touch-safe on coarse-pointer tablets as well as phone widths, while preserving compact mouse layouts.
  - Emit editable source plus normal root HTML screens and bundled assets; stable IDs belong on rendered meaningful controls. Existing HTML and deck start paths need none of these dependencies. Checks C1–C4, C7–C9.
- [ ] **P3-11** Make component builds atomic and serialize publication with design lifecycle operations.
  - Implement D7's extension-owned ensure-built path at look, agent_end-before-snapshot, select/clone and restore serialization; no agent-authored shell build commands are the supported path. Bind the build to the fixed trusted recipe and confined source; cache outside history. Stage and publish matching outputs only on success, suppressing half-built watcher reloads. Identical source/lock/recipe must emit byte-identical output: deterministic content hashes, no timestamps or absolute-path noise.
  - Show build-in-progress/failure in existing preview controls. Preserve last-good preview; never label stale generated assets as the current successful source version. Define failed source drafts explicitly using P3-02 semantics.
  - Test build failure, cancellation, agent_end racing look/select/restore/clone, missing cache, mismatched source/output digests, malicious paths and cleanup. Rebuild unchanged input twice and verify snapshot does not consume a new slot in the 30-version retention window. Checks C1–C4, C8, C9.
- [ ] **P3-12** Preserve editable source and reproducible output through versions, restore, clone and select.
  - Update Session/Store validation and fromV1/load compatibility for runtime/build metadata; legacy sessions remain HTML-first without lost fields. Snapshot the coherent source/build/pins/output set; exclude node_modules and scratch caches. Restore and clone retain correct version ownership and do not silently upgrade dependencies.
  - Export full notices, source entry points, build recipe, runtime versions, tokens, supported preview states and verification matrix in existing BRIEF/HANDOFF metadata. Do not hand off only minified code or silently claim an experimental capability is production-ready.
  - Round-trip a selected design into an isolated folder and rebuild offline with the pinned cache; confirm matching rendered output. Cover legacy snapshots and partial failure without data loss. Checks C1–C4, C8, C9.
- [ ] **P3-13** Add scoped Astryx catch-up tracking and attribution for adopted areas.
  - Add the audited git baseline and ledger linking exact adopted upstream paths to local files/tests; distinguish npm runtime pins from source HEAD. Cover theme helpers, used component/docs contracts, browser-floor changes and licensing, not the entire repository.
  - Reuse the existing OpenDesign/source-tracking pattern. Verify listing/baseline/ledger fixtures with existing catch-up assertions in C6 and relevant targeted tests located during P3-01.

### Phase 5: Exercise the integrated remote hub flow [code]

- [ ] **P3-14** Verify the real hub lifecycle and remote-browser behavior with agent-controlled tools.
  - From a remote browser, exercise first-use host-download consent/progress/failure and subsequent warm-cache start without client-side developer tools. Exercise HTML and Astryx start, live build/refinement, multi-screen/device controls, modal comments, CSS Keep, Mark draft state, versions, restore, clone and select. Prove offline runtime behavior by logging every browser request and blocking non-loopback/non-hub destinations after provisioning, including nested frames, CSS/font/image URLs and fetches; a clean failed-resource report or permissive https CSP is not proof.
  - Measure transferred bytes and latency for initial load and repeated live reloads over a throttled remote link; /x/ currently sends private,no-store. Do not claim runtime reuse from local bundler caching. If transport cost is excessive, investigate private content-addressed vendor caching with capability revocation, cross-session isolation and invalidation tests before choosing a fix. Include a deliberate build failure and replay failure; verify honest UI and last-good preservation. Check keyboard navigation, enlarged text/reduced motion and measured contrast at their actual scope. Use C11 plus applicable C1–C9; capture evidence of control and dialog, not only static screenshots.

### Phase 6: Measure the complete result [think]

- [ ] **P3-15** Repeat and judge the same full generation/refinement benchmark against the preserved HTML baseline.
  - Rerun both product-wired C10 arms (HTML and Astryx), not the unchanged temp worker harness. Both traverse actual design start, production session guide/tools, system selection and applicable build lifecycle; product HTML is the regression check for shared prompt/tool overhead against P3-01's pre-change product baseline. Preserve frozen model/effort, ultrafull, fresh contexts, brief/refinement/acceptance, and complete continuation/compaction accounting. Report active and end-to-end elapsed, provider tokens, cost estimate, turns, tools, build/install overhead and payload size separately.
  - Compare quality and remote behavior as well as efficiency. Revert material-regression optimizations; do not rationalize them with one improved metric. If optional runtime value remains inconclusive, present the numbers for a decision before expanding runs or changing release/default scope.

### Phase 7: Verify external browser support and document [code]

- [blocked] **P3-16** Verify supported Safari and a real touch-device path once a controllable environment is available.
  - Prerequisite: an approved reachable Safari/iOS or equivalent supported real-device environment with agent-controlled browser/device tools. If unavailable, mark this step blocked explicitly rather than asking the user to substitute for an automated check.
  - Check layered selectors, form/date controls, orientation, touch targets, modal pins, Mark replay and remote hub navigation. Record browser/OS/device versions and unsupported-browser behavior. Use C11; Chromium emulation does not satisfy this step.
- [ ] **P3-17** Finish integrated guidance, handoff documentation and user-visible release notes.
  - Document optional system choice, first-use host download/consent and network requirement, shared-cache reuse, cold-offline limitations, and browser-only remote clients. Cover token-only use, discovery, build/source ownership, touch fidelity, Mark support/limits, safe local forms, offline behavior and tested browser floor. Keep guide compact; APIs come from bounded discovery, not a pasted catalog.
  - Update README, hub README, attribution ledger and CHANGELOG together with tight screenshots of changed visible controls/dialogs. Record actual validation and any release-blocking environment gaps.
  - Run only tests for touched behavior plus C9. Version/release packaging is separate from this planning request; no push without an explicit instruction.


## Global validation

- R1–R11 are covered by specific automated regressions and a real hub flow; relevant C1–C9 pass or any unavailable verification is explicitly unresolved.
- Legacy HTML/token-system designs need no React, CLI package or build step. Existing snapshots, clone, selection and deck behavior still work.
- A prevented local form submit validates/saves; an unhandled form cannot POST or navigate the current, parent or popup window; design storage and parent access stay blocked. Non-design viewers do not inherit unintended new permissions.
- Comment a button inside a native modal: the line names its stable ID, a visible pin is on that control, and closing the modal removes/hides the obsolete pin without breaking other comments.
- Mark an open edit dialog with a changed project name: supported state reproduces that dialog/value in the annotation image. Unsupported state shows an explicit limitation before capture; errors never become a success screenshot.
- Touch phone, touch tablet, mouse desktop and short landscape are distinct checks. Settled screenshots, keyboard/focus behavior and 44px touch policy are recorded; screenshot dimensions alone are not touch evidence.
- Token generation changes both modes coherently and records measured contrast failures rather than promising compliance. Keep sends the same values through the existing chat-based writer path.
- Astryx lookup returns bounded version-labelled results and only requested details; oversized, unavailable or mismatched docs fail clearly without mutating project instructions.
- A component design builds, is commented/refined, versions, restores, clones and selects with editable source, pinned dependencies, notices and matching generated output. An intentional build failure preserves last-good preview and cannot be selected as a successful new build. No node_modules in snapshots/exports and no remote runtime requests during offline viewing.
- Repeat C10 across all continuations. A regression is not excused by nicer screenshots, fewer turns or a faster substep. Revert an optimization with material overall regression; a separately approved optional capability may remain honestly labelled experimental, not a speed win.
- Real-device/Safari verification and assistive-technology coverage are reported at their actual scope; do not equate Chromium emulation with them.

## Backlog

Excluded from this implementation scope unless a concrete later requirement earns them: experimental native/mobile rendering targets; static HTML reverse-export with embedded source; a wholesale internal interaction harness import; generic gesture engines; complex swizzled components and additional chart/template stacks. The live interactive preview, existing HTML decks and the imperative hub remain.

## Resume context

P3-01..04 done, P3-05 wip; HEAD70d3bd64 contains user-approved first-wheel throttle fix and stale-CDP-drag settle only (partial-staged unrelated app/test work preserved). P4 pin source/tests and plan/log awaiting own-only local commit now. C4 screenshot red0orange→green; latest full sequential C4 passed all new modal/popover/Phone/scroll/close/reopen/hidden/real-pointer/no-duplicate/inline-edit cases. C2 pass. Active LSP3paths0findings butallinconclusive, not clean. Read-only oracle635d6e82 accepted after two unrelated pre-design C4 failures; no implementation delegated, no more advisory round for these failures. No skips/retry changes. Next finish own-only P4 commit, then inspect extensions/design-render.ts callers/tests and P3-02 readiness/input contracts for P5. Prechange product baseline572.068s/2,762,429tokens/$2.6376342/36turns42tools; remaining live benchmark budget37.3623658 for final2arms, no automatic paid retry. Full effective baseline prompt/independent sandbox acceptance not captured, recorded limitations. Preserve unrelated dirty cachemiss/chat/view/app/styles/index/changelog/otherplans; test-browser cache-miss hunk must remain unstaged. No push. P3-16 real Safari/touch still blocked. Continue all runnable work in parent.

## Amendments

- 2026-11-10: New implementation plan, separate from completed research comparison. Carries the measured regression, shared studio defects and scoped adoption proposal without treating the research prototype as production acceptance.
- 2026-11-10: Added P3-01, P3-02, P3-03, P3-04, P3-05, P3-06, P3-07, P3-08, P3-09, P3-10, P3-11, P3-12, P3-13, P3-14, P3-15, P3-16, P3-17 as the first steps: Populate the implementation work from the completed comparison and the user's explicit inclusion of fixes in our code.
- 2026-11-10: Added P3-18 after P3-07: Review findings 4–5: pinned dependencies must be provisioned before theme tooling and installed-version discovery; runtime delivery requires Q-01.
### Review disposition — 2026-11-10

Read-only advisor run 9957d8aa-86c7-4f73-b188-bb362bead76a returned 13 findings. Parent verified the relevant bodies/manifests and pilot inputs; all 13 concerns are incorporated, with the qualifications below. Its opening count of seven major findings is inconsistent with its numbered/structured list (five major, eight minor); use that list.

| Finding | Disposition, evidence and plan destination |
|---|---|
| 1 Shared CSP scope | Accept D4/P3-03: design-render.ts:16, explore.ts:174–181 and design-view.ts:95 confirm shared response CSP, no iframe attribute. Reject changing the existing generic CSP assertion in test-explore.mjs:34; preserve it and add own-design assertions. |
| 2 Pilot misses product | Accept C10/P3-01/P3-15: Temp workflow.js runs plain worker agents; html/TREATMENT.md has hard-coded roots. Establish pre-change product HTML baseline and rerun both product-wired arms; historical pilot remains separate. |
| 3 Build trigger/ownership | Accept D7/P3-02/P3-11: design.ts:473–479 guards write/edit only and snapshots at agent_end. Specify extension-owned triggers and serialize snapshot with build/restore/select/clone; do not claim bash confinement. |
| 4 Runtime delivery | Accept Q-01/P3-02/P3-18: package.json has no runtime/bundler; CLI 0.7.12 has transitive caret ranges. Full lock/integrity and controlled cache required; user delivery choice unresolved. |
| 5 Discovery dependency | Accept P3-18 before theme/discovery: core/docs.mjs exists in installed packages but cannot be read before provisioning. |
| 6 Starter order | Accept P3-07 guide change and P3-10 starter tests: design-guide.md:45 covers phone-only targets today. |
| 7 Missing callers | Accept file table/P3-12: app.ts Mark callback, Session/Store/load, hard-coded PLAN3_CATCH_UP_PACKAGES, recorder and generic viewer tests now explicit. Reuse recorder without speculative changes. |
| 8 Form matrix | Accept added P3-03 cases. method=dialog behavior is an untested hypothesis, not an established result. |
| 9 Offline proof | Accept P3-14 request logging/blocking: existing CSP allows https; renderer report is not a complete request audit. No global https ban that breaks unrelated viewers/reference behavior. |
| 10 Version provenance | Accept P3-08/P3-13: source manifest is 0.7.13 versus installed 0.7.12 pins. Match helper provenance or verify/document compatibility. |
| 11 Remote reload bytes | Accept measurement in P3-14: explore.ts sends private,no-store. Caching is not automatically adopted; retain capability revocation/session isolation. |
| 12 Version churn | Accept P3-11 deterministic outputs/no-op snapshot: design.ts compares bytes and keeps 30 versions. Stable content hashes are fine; random/time/path-dependent output is not. |
| 13 Evidence packaging | Accept P3-01: package files include benchmarks/ and scripts/, not proposed docs/proposals/astryx-study/. Preserve minimal evidence there; verify npm pack contents. |

Repository evidence paths are rooted at C:/SOFT/git/ce-workflow/ (extension names under extensions/, hub modules under hub/src/ or hub/web/, tests under hub/scripts/); Temp inputs/packages are under C:/Users/Flex/AppData/Local/Temp/pi-research-62ygWq/. No product edits, commits, runtime checks or product tests in this review. Browser/device verification remains future work.
### Q-02 discussion: borrowing versus dependency use

The scope picker was cancelled; the user instead requested pros/cons, size and integration difficulty. No choice or scope reduction is approved. Small standalone helpers/patterns can be adapted; copying complex components is a third, more coupled path, not automatically dependency-free. Audited swizzle documentation says it copies needed internal modules, retains public-package imports and omits tests/docs; StyleX source can need compilation. Published component consumption uses precompiled CSS and ordinary React bundling, as the local build.mjs already demonstrated; no bespoke StyleX compiler is needed on that path. CLI/tooling is host-side, not required in the browser bundle.

Measured dashboard artifacts remain 52,523 B raw / 14,038 B gzip (HTML) versus 1,436,489 B raw / 415,298 B gzip (Astryx). These include each fixture's runtime assets, not a universal library minimum, memory measurement or actual remote transfer. Compression at the serving boundary is not established by gzipping files. Current no-store serving makes repeated remote reload cost material. Read-only installed-package inspection measured core 29.12 MiB and CLI 13.36 MiB on disk; these exclude their dependency closure and are not download sizes. A full host-cache/download budget remains unmeasured.

Sources: Context7 /meta/astryx, https://github.com/meta/astryx/wiki/Why-StyleX and https://github.com/meta/astryx/wiki/Distribution; audited source packages/cli/api/swizzle/swizzle.doc.mjs at fd5cf0df987791117e96ccc0bec603c64be8b136; installed 0.7.12 manifests and comparison/astryx/build.mjs under C:/Users/Flex/AppData/Local/Temp/pi-research-62ygWq/. The pilot establishes neither a general library cost multiplier nor that copying equivalent component behavior would be cheaper. No product tests rerun for this discussion.
- Reconciled the applied Q-01 selection into D14 and P3-02/P3-18/P3-10/P3-14/P3-17: first-use host download, consent/progress, no mandatory runtime in the base package, cold-offline failure and warm-cache reuse checks, and remote-browser provisioning coverage. No new steps or scope changes required; Open questions is empty. P3-16's external device prerequisite remains unresolved.
P3-04 validation prerequisite, approved via ask_user 2026-11-10: user chose Fix both prerequisites (recommended). Read-only oracle635d6e82 identified first-wheel throttle initialized at0 and an existing stale-drag CDP synchronisation gap. Parent verified the throttle source. Scope adds only zoomedAt=-Infinity in shared app.ts, a deterministic first-event timestamp0 regression in C4 and the same1000ms settle already used by the neighboring CDP drag; no assertions weakened, skip flags or extra retries. Validate original failures via one sequential C4; drag root cause remains unproven until retest. Preserve unrelated app/test hunks with partial staging.
