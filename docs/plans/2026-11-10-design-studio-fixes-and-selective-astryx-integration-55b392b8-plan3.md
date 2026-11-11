---
plan3: true
status: blocked
created: 2026-11-10
updated: 2026-11-11T16:12:41.600Z
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
D16 Final benchmark confirmation (2026-11-11): after inspecting the original shared ledger ($40 limit, completed baseline $2.6376342, $37.3623658 remaining), user selected “Run both within the remaining budget.” This explicitly authorizes the final product-wired HTML and Astryx arms under that same ledger, frozen brief/model/ultrafull and complete continuation accounting; no automatic paid retries or new runtime downloads. This supersedes the checkpoint's paid-call pause, not the delivery/runtime pins or hardware gaps.
D17 Benchmark interpretation / withdrawn agent gate: the user objected that Q-03 reopened the already agreed direction without context: our studio plus valuable Astryx components, responsive behavior, themes and tweaks. The agent withdraws Q-03 as an unnecessary gate; this is not a new user approval or rejection of measured overhead. D13/D14 remain governing. The one dashboard benchmark measures generation/refinement cost and that output's asset size, not the usefulness of every borrowed capability or interactive page latency. No release/default scope change or expanded runs are proposed. Retain honest regression/quality findings; complete P3-15's measurements without blocking adoption on a redundant question.









## Open questions

### Blocking

None. Agent-proposed Q-03 was withdrawn; D13/D14 already settle adoption and delivery. Remaining physical-environment gates are recorded in P3-14/P3-16.

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
C11 durable Chromium transport extension: `STUDY_DEPS="C:/Users/Flex/AppData/Local/Temp/pi-research-62ygWq/trial/node_modules" node --no-warnings "C:/SOFT/git/ce-workflow/hub/scripts/test-browser.mjs" --design-remote` (600s outer budget). Reuses retained Playwright 1.65.0 and the approved host cache read-only, verifies that cache on every actual build as production does, and refuses any installer consent/download. It does not copy the 153 MB runtime into the deeper temporary fixture cache. The ordinary C4 prefix remains unchanged; optional probe attaches only to its owned agent-browser instance, uses a fresh SW-blocked context, gates HTTP and WebSocket egress across frames, and delays bounded response fulfilment by 150ms + upload/32KiB/s + decoded body/64KiB/s. SSE, WebSockets and range responses remain unthrottled. Delivery is per response and non-streaming, not a shared physical link; payload counts exclude wire compression and HTTP/TLS overhead. Writes redacted request/transport evidence to docs/proposals/astryx-study/remote-browser-results.json. This is an instrumented loopback per-response timing model, not real Safari, touch hardware or a physically remote client. It does not alone prove every P3-14 lifecycle/first-use case.


## Phases

### Phase 1: Preserve evidence and settle technical contracts [think]
- [x] **P3-01** Preserved portable pilot evidence and captured a real pre-change product HTML initial/refinement baseline with explicit context/acceptance limits.
- [x] **P3-02** Settled bounded draft replay/readiness/input, public theme API, host cache and source/build lifecycle contracts; candidate form targets and HTML/React drafts independently passed.

### Phase 2: Fix the shared studio correctness gaps [code]

- [x] **P3-03** Design-only form handlers now run while native navigation remains blocked; generic viewers retain their original sandbox.
- [x] **P3-04** Pins paint above native modal/popover layers, follow layout/scroll and hide stale controls; modal inline edits and real-pointer isolation pass screenshot regressions.
- [x] **P3-05** Headless captures use a shared five-second readiness watchdog, observed mouse/touch/motion reports and size-only live-preview labels.
- [x] **P3-06** Mark replays bounded, acknowledged HTML/React drafts and live styles; stale/unsupported/failed captures cannot annotate a fresh or wrong preview.
- [x] **P3-07** Added shared real-sandbox mouse/touch/keyboard/form/date/retry checks and coarse-tablet guidance, preserving desktop density and existing Mark/pin behavior.

### Phase 3: Provision pinned tooling and borrow theme/discovery features [code]

- [x] **P3-18** Added fixed consent-gated host provisioning with full dependency notices, atomic verified cache publication and offline warm reuse; approved Windows cold install and package delivery checks passed.

- [x] **P3-08** Added standalone pinned-API theme tokens, measured contrast, live Tweaks/replay and token-preserving handoff without a client component runtime.
- [x] **P3-09** Added bounded pinned-version lookup and selected-only Astryx reference guidance, with exact provenance and verified read-only public APIs.

### Phase 4: Add the optional component path and safe lifecycle [code]

- [x] **P3-10** Added explicit pinned Astryx app source/root bundles with stable controls, full notices and touch-safe starter; HTML/deck defaults remain dependency-free.
- [x] **P3-11** Serialized component lifecycle with fixed-recipe builds, immutable complete generations, last-good status/error handling and explicit failed drafts.
- [x] **P3-12** Validated and preserved stored metadata, retained legacy fields, and exported editable source/pins/notices with a coherent receipt and honest handoff; isolated offline rebuild/render roundtrip passes.
- [x] **P3-13** Added scoped meta/astryx catch-up baseline and adoption ledger, keeping audited Git HEAD distinct from the pinned npm runtime and targeting API/browser/license contracts.

### Phase 5: Exercise the integrated remote hub flow [code]

- [blocked] **P3-14** Verify the real hub lifecycle and remote-browser behavior with agent-controlled tools.
  - From a remote browser, exercise first-use host-download consent/progress/failure and subsequent warm-cache start without client-side developer tools. Exercise HTML and Astryx start, live build/refinement, multi-screen/device controls, modal comments, CSS Keep, Mark draft state, versions, restore, clone and select. Prove offline runtime behavior by logging every browser request and blocking non-loopback/non-hub destinations after provisioning, including nested frames, CSS/font/image URLs and fetches; a clean failed-resource report or permissive https CSP is not proof.
  - Measure transferred bytes and latency for initial load and repeated live reloads over a throttled remote link; /x/ currently sends private,no-store. Do not claim runtime reuse from local bundler caching. If transport cost is excessive, investigate private content-addressed vendor caching with capability revocation, cross-session isolation and invalidation tests before choosing a fix. Include a deliberate build failure and replay failure; verify honest UI and last-good preservation. Check keyboard navigation, enlarged text/reduced motion and measured contrast at their actual scope. Use C11 plus applicable C1–C9; capture evidence of control and dialog, not only static screenshots.
  - note: First optional C11 run reached native compilation but hit the existing 60s worker limit before browser/network testing (report passed:false, network:[]). Minimized identical-source comparison: approved host cache compiled in42.135s, 1,460,874 output bytes; a fresh copy into the deeper fixture location hit60.031s/SIGTERM, excluding hub auto-update activity as necessary for that failure. Exact filesystem/startup cause is not established. Removed that unneeded fixture copy and now use the actual verified host cache read-only, with verification per build and no product deadline change. C11 transport/UI assertions still unverified pending rerun; no successful optimization claim.
  - note: Accepted the one read-only oracle advisory after independent validation. Removed all page CDP work from paused routes; root-only throttling demonstrably misses OOPIFs. A parent-run tiny opaque-frame negative control was observed red at4ms/100,027B with no delay and green at1687ms with response-level delay (150ms+body/64KiB/s); native child document1692ms/100,046B. Instrumentation now uses public fetch/fulfil, preserves policy headers, gates all UI-context HTTP/WS, bypasses live SSE/WS/ranges and measures decoded payload bytes with explicit non-streaming/per-response limits. Original C11 rerun next; actual remote hardware remains unverified.
  - note: Original C11 rerun no longer stalls in CDP: native build48.587s/0 downloads, then route.fetch immediately reports ECONNREFUSED. Separate proven fixture problem: C4 advertises an actionable nonexistent git update, causing real automatic pi-update attempts and an idle detached maintenance restart that closes the test hub. Changed only its fixture to the supported legacy update-summary shape (same badge/menu assertions, no actionable install source); product updater unchanged and its dedicated existing selfcheck will run. No additional oracle round for the already-resolved paused-CDP issue.
  - note: C11 progressed through real initial load, native validation/focus, modal comments, CSS edit, React draft/CSS Mark replay, syntax-failure last-good retention and successful refinement. Current final assertion fails because context.serviceWorkers().length is1 despite serviceWorkers:'block'; do not claim C11 pass. Measured initial build51.138s / first visible26.489s / 1,471,390 prototype bytes; refinement build46.216s / visible65.022s / 1,471,398 bytes; large bundles delayed17.993–18.020s. External nested image/style/font/fetch negative controls were intercepted/blocked; instrumentationErrors=[] and downloads0. Prior unauthenticated fresh context fixed with host-test key in context headers, errors redacted, 401 fails fast. Existing C4 fixture source metadata no longer triggers maintenance; updater selfcheck passed.
  - note: Original C11 command passed in358.0s (outer360.2s). Chromium148.0.7778.97; 0 runtime downloads; real initial/refinement payloads1,471,390 /1,471,398B, visible26.559s /69.137s; initial/refinement builds52.943s /50.063s; large bundle fulfilment17.995s /17.998s at64KiB/s+150ms. All four nested external image/style/font/fetch controls reached blocked terminal outcomes; no instrumentation errors. Same C4 prefix and native interaction assertions pass. Exact browser-owned extension-worker exemption independently verified with blank-page blocked/allowed web-SW controls. First-use remote provisioning and physically remote/browser-floor gates remain unverified.
  - note: Instrumented loopback/native C11 is green and evidence complete in remote-results.md. Remaining P3-14 requirement is a controllable physically remote client for first-use consent/progress/failure and full lifecycle (including requested accessibility checks); no such approved client/environment is available. Do not equate the current loopback simulation/C4/C1 checks with it. Existing cold-host Windows provisioning remains separate; no additional downloads authorized. P3-15 paid product comparison is runnable under new D16 and currently running; P3-17 done.
  - note: User offered Pixel 9a/10a for agent-controlled verification. ADB now sees physical Pixel 10a, Android 17, wireless transport, wlan0 192.168.1.202; host LAN 192.168.1.117. Pixel 9a not currently enumerated. Investigating a bounded owned-tab fixture path; do not change user's tabs, global networking/security, real hub sessions or install/download. Real Android can cover physical touch; Safari remains unavailable. Production hub rejects foreign LAN Host and binds loopback, so raw LAN exposure is not an acceptable shortcut.
  - note: Physical Pixel 10a/Android17/Chrome157.0.8103.46 C11 completed with touch activation and 0 downloads. Owned incognito context, existing user tabs preserved; fixture-only wireless-ADB reverse tunnel, NOT production paired Tailscale HTTPS. Initial/refined decoded payload1,471,390/1,471,398B; visible28.928s/62.755s, native builds42.902s/43.477s. Screenshots exposed a real toolbar layout bug despite functional pass. New C4 assertion ran red before product edit: at320px Comment wrapped into7 lines, controls shrank to29–34px and picker/links escaped viewer. Scoped CSS now wraps whole controls and preserves44px touch targets. Next run the same C4 prefix plus physical C11 and inspect screenshots. Do not call whole Android/remote gate green yet.
  - note: C4 plus physical C11 now passes on Pixel10a/Android17/Chrome157.0.8103.46. New toolbar check was red before product CSS edit (Comment7lines, controls29–34px, overflow), green after scoped wrap/44px-target fix at320×800,390×844,844×390,390×844+2×UI zoom and actual phone. Screenshots inspected; evidence in remote-results.md/android-browser-results.json. Initial/refinement:40.780/45.879s host build,27.077/65.588s visible,1,471,390/1,471,398decoded prototype bytes,0 downloads. Exact owned-page clock fixed an unrelated1:05→1:06 fixture race; original formatting assertion retained. Temporary device CDP forward/reverse mappings removed, git diff --check passed; active LSP batch had only existing auxiliary advisories/no blocker. Still blocked on full production paired remote lifecycle/first-use consent/progress/failure and requested real accessibility scope; ADB fixture tunnel is NOT that gate. No extra paid runs/downloads authorized.
  - check: C11_DEVICE_CDP_URL/C11_DEVICE_SERIAL selected the approved physical Pixel10a; node --no-warnings "C:/SOFT/git/ce-workflow/hub/scripts/test-browser.mjs" --design-remote → exit0, C11:true and existing C4 passed. git diff --check → exit0. ADB forward --list/reverse --list → empty after owned mapping cleanup.

### Phase 6: Measure the complete result [think]

- [x] **P3-15** Completed all three product runs, canonical accounting, visual comparison and independent 298/300 checks; regressions disclosed, approved optional-library direction unchanged.

### Phase 7: Verify external browser support and document [code]

- [blocked] **P3-16** Verify supported Safari and a real touch-device path once a controllable environment is available.
  - Prerequisite: an approved reachable Safari/iOS or equivalent supported real-device environment with agent-controlled browser/device tools. If unavailable, mark this step blocked explicitly rather than asking the user to substitute for an automated check.
  - Check layered selectors, form/date controls, orientation, touch targets, modal pins, Mark replay and remote hub navigation. Record browser/OS/device versions and unsupported-browser behavior. Use C11; Chromium emulation does not satisfy this step.
  - note: Physical-touch subset now verified: Pixel10a, Android17, Chrome157.0.8103.46,412×924CSS screen and actual tap activation in owned incognito fixture context;44px toolbar, native form/focus, modal comments, CSS/Mark draft replay, failed-build preservation and successful refinement pass. Evidence remote-results.md/android-browser-results.json. Still no approved controllable real Safari environment; physical rotation/date-control, full production remote navigation and broader browser-floor coverage remain unverified. Do not replace these with Chromium layout emulation or ask user to perform the automated check.
- [x] **P3-17** Completed integrated optional-runtime guidance, handoff/release limits and changelog with actual control/dialog and consent crops.


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
- Existing C4 annotator note-focus assertion intermittently times out (2026-11-10): failed once before design checks, passed an unchanged traced run. Tiny-image hit target, focus timing and outside focus were candidate hypotheses, not proven causes; do not describe it as fixed.


## Resume context

BLOCKED 16/18: P3-14 and P3-16 remain blocked; Android subset is now verified, not the whole release gate. Latest passing C4+physical C11 is recorded in docs/proposals/astryx-study/remote-results.md and android-browser-results.json, with actual Pixel10a screenshots. Phone toolbar CSS fix has red-before/green-after evidence plus320px/landscape/2×UI zoom coverage. No active test process; owned device forward/reverse mappings removed; shared dirty master preserved. Next obtain an explicitly approved controllable production-paired remote test path and real Safari environment before remaining lifecycle/provisioning/browser-floor checks. Do not weaken gates, expose raw LAN, alter security/device settings/user tabs/real sessions, download/install/fetch, rerun paid generation, change pin/defaults, commit or push. P3-15 remains complete:298/300 acceptance, both final arms regressed; our studio retains valuable Astryx ideas/components, not a new adoption/parking gate. Changelog and study index now reflect the narrow Android verification honestly.

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
