---
plan3: true
status: draft
created: 2026-11-10
updated: 2026-11-10T19:32:56.464Z
started: 2026-11-10T18:52:52.349Z
---

# Astryx versus HTML: remote design studio comparison and integration

## Original request

> “okay do the comparison. since our studio is accessible from remote I'd love that we grab everything valuable from astryx and implement with us”

User answered via ask_user: use a remote-friendly project dashboard; run one pair first (two isolated fresh native Pi agents with the same model/effort, then the same refinement and browser checks).

## Goal, requirements, and non-goals

Compare current HTML-first designs with Astryx component-backed designs on one identical app brief, emphasizing our remotely accessible studio.

Requirements:
- R1 Same brief, data, model, effort, ultrafull compaction and verification opportunities in fresh isolated contexts; only the design-system treatment differs.
- R2 One initial build and identical refinement per arm. Include every attempt and continuation in runtime, provider tokens, cost, turns and tool calls. Missing telemetry stays unknown.
- R3 Evaluate functional correctness, accessibility, responsive/visual quality, and studio compatibility. Distinguish directly checked outcomes from inferred gaps.
- R4 All scratch artifacts/dependencies stay under C:/Users/Flex/AppData/Local/Temp/pi-research-62ygWq/. No product edits, commits or pushes while research is on.
- R5 Recommend valuable Astryx integrations while preserving remote-first sessions and existing workflows.

Non-goals: a React rewrite of the hub, wholesale upstream copying, statistical certainty from one pair, or treating phone-width screenshots as physical iPhone verification.

## Decisions

- D1 User selected a remote-friendly project dashboard. Proposed fixed scope: overview, project filters and edit dialog, settings, loading/empty/error/populated states; 390px and 1440px layouts.
- D2 User selected one pair first. Expand only after reviewing evidence if close or inconclusive; no automatic six-run benchmark.
- D3 Native Pi agents are authorized by the selected comparison option. Use two fresh isolated contexts; do not fork the parent's Astryx findings into either worker.
- D4 User wants valuable features incorporated into our studio. Exact integration choices follow evidence; research is still user-enabled and implementation must wait for /research or Alt+R. Product implementation remains mode-blocked, not implicitly authorized by completing the comparison.
- D5 Agent recommendation: Astryx is an optional prototype foundation, not a replacement for session orchestration. Use published core/CLI/theme 0.7.12 for this frozen comparison; inspected source was fd5cf0df987791117e96ccc0bec603c64be8b136.
- D6 Existing research established opaque-sandbox compatibility, working component picks/CSS edits and clean existing renderDesign reports. It also found modal pins hidden behind top-layer dialogs, size-only phone emulation, and Mark lacking transient state capture. These are integration gaps, not evidence that either benchmark arm has failed.
- D7 Research report: C:/Users/Flex/AppData/Local/Temp/pi-research-62ygWq/astryx-assessment.md. Upstream MIT permits reuse with notices; complex swizzled components bring dependencies, and native/export tools have experimental limitations.

## Open questions

### Blocking

None.

### Deferred

None recorded.

## Relevant files and approach

- C:/SOFT/git/ce-workflow/extensions/design-guide.md and skills/frontend-design/SKILL.md: identical craft guidance for both arms.
- C:/SOFT/git/ce-workflow/extensions/design-render.ts and hub/src/design-bridge.ts: reuse actual renderer/bridge for compatibility checks without editing them.
- C:/SOFT/git/ce-workflow/scripts/lab-metrics.mjs: existing multi-session usage aggregation to inspect/reuse where native-run artifacts permit.
- Native pi-subagents: same explicit model/effort, toolset and compaction, separate temp cwd per writer; retain child transcripts and output references.
- C:/Users/Flex/AppData/Local/Temp/pi-research-62ygWq/trial/: prior compatibility probes and isolated pinned packages. Do not expose the earlier assessment or other arm to benchmark workers.
- Existing plan a5cf234d: studio functionality is implemented; real hub generation/phone acceptance remains separately unverified. This benchmark must not silently mark those checks complete.
### Post-comparison integration proposal (agent recommendation, not approved implementation)

Keep the existing remotely accessible studio and HTML-first default. The measured regression does not justify a replacement or an Astryx default. The initial D5 recommendation is narrowed to a gated optional path; none of the user decisions are changed.

1. **Fix common studio correctness before adding components.** In C:/SOFT/git/ce-workflow/extensions/design-render.ts (SANDBOX_CSP), hub/web/files.ts (iframe sandbox), and hub/src/explore.ts (served preview policy), allow local form handlers with allow-forms plus form-action 'none', preserving the opaque origin. Scope the change to design previews; inspect generic viewer callers first. Regression cases: local prevented submit succeeds, unhandled self/parent/popup form navigation stays blocked, storage stays inaccessible, both HTML and React Save work. Scratch form-security.mjs establishes the mechanism, not a complete security review. Existing checks: scripts/test-work-design.mjs, hub/scripts/test-explore.mjs, hub/scripts/test-browser.mjs.
2. **Make comments and inspection work on real interactive states.** In hub/src/design-bridge.ts, render pins in the appropriate top-layer surface and keep existing screen/stable-ID semantics; test modal/popover open, close, scroll, resize, and stale-load rejection. Add settled-image checks to the actual sandbox, not only standalone file pages. Existing hub/scripts/test-browser.mjs and test-explore.mjs are the regression homes. Keep one agent writer and existing chat comments.
3. **Add truthful touch/state evidence to existing look and Mark.** In extensions/design-render.ts, extensions/design.ts, hub/web/design-view.ts and the designshot route in hub/src/api.ts, distinguish viewport size from input capability; a desktop iframe cannot pretend its actual mouse is coarse. Headless checks should cover touch/tablet, keyboard/focus, reduced motion and settled screenshots. For Mark, prototype a small bounded page-state replay contract (declared named states/hash first, then explicitly supported draft state), with capability reporting when exact current state cannot be reproduced. Do not label a fresh screenshot as exact live capture. Verify rotated sizes, modal draft restoration and unsupported-state messaging. Existing test-work-design, test-api, test-explore, test-browser and test-annotate scripts cover the touched surfaces.
4. **Borrow theme and discovery tools without forcing React.** Reuse existing systems/Tweaks/design actions rather than adding a parallel studio. Generate semantic accent/neutral ramps, type/radius scales, light/dark CSS and contrast evidence; keep tokens in DESIGN.md and handoff. Prefer the public theme compiler or small audited pure helpers, with MIT notice and upstream tests, over copying the whole engine. Add bounded version-labelled component/template/doc search only for a selected Astryx system: exact core/CLI/theme pins, schema/size/time limits, no full-catalog prompt dump. Do not embed the CLI host (process-global lifecycle) or auto-run init (instruction-file writes). Likely files: extensions/design.ts, a focused .ts helper only if justified, design-guide.md, and test-work-design.mjs. Measured end-to-end benefit still needs a repeat of this frozen experiment.
5. **Gate optional component-backed prototypes on correct ownership and measured value.** A minimal cached pinned starter may emit index.html/settings.html/assets in the existing design root, with editable src and a repeatable build recipe beside them. Keep node_modules/shared build cache outside version snapshots. Build must succeed before ready-preview/snapshot/export; keep last successful output on failure. Snapshot/restore/clone/select must retain matching source, exact dependency lock/pins, generated output and complete copyright/permission notices. Stable data-id points back to source, not minified bundles. Do not conflate token-only OD systems with component runtimes. Relevant code: extensions/design.ts snapshot/restore/select and hub/src/explore.ts watcher/serving; tests: test-work-design.mjs, test-explore.mjs, test-browser.mjs. Browser-floor/Safari evidence and source/build restore round trip are release gates. Only call a starter an optimization after rerunning identical brief/model/refinement and aggregating every continuation against this baseline; revert if materially worse overall.
6. **Track only adopted upstream areas.** If borrowing proceeds, add meta/astryx to extensions/plan3-catch-up.ts and extensions/work-catch-up-baseline.json with a small docs/upstream/astryx.md ledger pinned to the audited revision. Review adopted theme helpers, component docs/templates, browser-support changes and license; do not mirror the whole repository. Reuse the existing catch-up pattern and its targeted tests.

### Deferred or rejected

- Reject wholesale hub React rewrite and mandatory Astryx on web pages/decks.
- Defer complex swizzling, extra chart/template dependency stacks, general gesture engines, unpublished internal harness packages and experimental native targets until a specific task needs them.
- Defer experimental static reverse-export as a sharing feature; it strips interactions, had CSS-import failure in the trial, and embeds source. Never replace the live preview with it or execute imported source automatically.
- Physical-device/Safari and assistive-tech validation remain separate verification work, not claims earned by Chromium emulation.

This is a staged proposal, not product work authorized by the completed research steps. User-controlled research mode must be turned off before implementation; no commits or pushes were authorized.


## Phases

### Phase 1: Freeze the comparison [think]

- [x] **S01** Frozen Relay brief, refinement and rubric; prepared identical fresh Opus 5.5 high workers with ultrafull and isolated temp folders.

### Phase 2: Build and refine both arms [think]

  - note: Launched native async workflow 10a9faec-08ce-456e-9425-87f79f9539f7: html/astryx initial builds, then retained refinement in the same workflow; fresh Opus 5.5 high workers. Completion will wake this session; do not poll.
- [x] **S02** Both fresh builds and retained refinements completed; initial/final artifacts and canonical sessions retained for full accounting.

### Phase 3: Verify and judge [think]

- [x] **S03** Independent sandbox/touch checks found blocked form saves and hidden modal pins; bounded local-form CSP control passed all 200 assertions.
- [x] **S04** Complete usage audit and visual comparison favor HTML-first default; Astryx is slower/costlier in this pair with only modest visual gains.

### Phase 4: Integration design [think]

- [x] **S05** Documented staged proposal: safe local forms, modal pins, touch/state evidence, token/discovery tooling, gated component path and scoped upstream tracking.

## Commands

- C1 Native subagent workflow: exact model, task hashes and run IDs recorded at launch; native resume for both refinement passes.
- C2 Existing renderDesign imported from extensions/design-render.ts into a temp research driver; exact driver command recorded when created.
- C3 Temp browser acceptance driver using the already isolated Playwright installation; exact command and case results recorded when run.
- C4 Existing sessionMetrics or native usage artifacts aggregated across initial and resumed runs; exact artifact provenance recorded with results.

## Global validation

Both arms use the frozen brief/model/effort and equivalent tools/context. All continuation usage is included, missing cost is not zero, and early failures remain visible. Each claimed functional or visual outcome cites an artifact or actual check. No adoption claim comes from fewer turns or focused checks alone. A real remote-device trial is a separate prerequisite for final production acceptance.
### Comparison evidence (2026-11-10)

Full research report: C:/Users/Flex/AppData/Local/Temp/pi-research-62ygWq/comparison/comparison-report.md. Raw evidence in that folder: manifest.json, metrics.json, parent-checks/results.json, parent-control-local-forms/results.json and form-security.json.

| Both stages combined | HTML | Astryx |
|---|---:|---:|
| Active elapsed time | 16m41s | 26m14s |
| Total provider tokens incl. cache traffic and compaction | 5,208,115 | 12,852,944 |
| Recorded cost estimate, not invoice | $4.0550 | $19.9657 |
| Recorded assistant turns | 58 | 103 |
| Tool calls | 93 | 130 |
| Gzipped runtime artifact bytes | 14,038 | 415,298 |

Same actual Opus5.5/high model and fresh context; canonical retained sessions counted once, compaction attempts added separately. Ultrafull mode was configured in both and confirmed by Astryx's actual compaction record (HTML did not compact). One Astryx turn is a zero-usage assistant record. Launch-to-final was 25m14s vs 26m16s because HTML waited ~8m32s at the initial-build barrier. Cache writes materially affected estimated cost; do not attribute the whole gap solely to the library. Warm dependency setup and parent evaluation overhead are excluded. No product optimization was installed or retained.

Actual sandbox results: HTML 95/98, Astryx 92/98, no harness exceptions. Both cannot Save because the iframe/CSP omits allow-forms and the browser blocks submit handlers. Astryx also loses submit-triggered validation; HTML blur validation still runs. Saved-Paused assertions were blocked, not passed. Child file:// selfchecks missed the boundary.

Discriminating scratch controls changed no app bytes: allow-forms yields 100/100 per arm; allow-forms plus form-action 'none' also yields 100/100. Separate security test confirms prevented local submit works, unhandled POST is blocked, unrestricted control actually posts, and opaque storage remains inaccessible. No production policy was changed; targets/popups and other viewer boundaries still need security coverage.

Both work offline and pass responsive/phone-target, comment-pick, inline-edit, keyboard/focus and state tests in the checked contexts. Both hide pins behind native modal top layer (settled screenshots inspected). Astryx has 20–32px controls at 820px coarse-pointer width: a tablet gap, not a phone acceptance violation. Mark cannot capture arbitrary unsaved modal/form state through the current fresh-render contract.

Parent visual judgment, not blind: hierarchy/consistency/phone/craft/secondary-state scores HTML 3/4/3/3/3; Astryx 4/4/3/3/4. Astryx is somewhat more compact on desktop/modals; both push the working list below the initial phone viewport. This does not offset the measured overall overhead as a default optimization.

Limits: one pair; no physical phone/Safari, AT/full WCAG audit, upstream suite, cold-network benchmark, full live hub lifecycle or editable-source restore round trip. HTML briefly wrote two deleted shared-Temp artifacts; both wrote bound reports outside cwd. Audited calls show no sibling-source reads. Other sessions' product edits were preserved, not verified.


## Resume context

Research comparison and proposal are finished (S01–S05 done). Plan remains draft: integration choices are recommendations, not newly approved product work. User-enabled research mode is still ON; no product edits, commits or pushes. Full temp report: C:/Users/Flex/AppData/Local/Temp/pi-research-62ygWq/comparison/comparison-report.md; metrics.json includes both canonical initial+refinement sessions plus compaction. Actual sandbox fails form saves for both arms; allow-forms + form-action none scratch control passes 200 assertions and blocked-POST probe. Biggest near-term work: safe local forms, modal pins, touch/state-aware verification; keep HTML default. Optional Astryx is gated after a measured regression, not a successful optimization. Before any implementation, user must turn research off and scope the proposed stages; preserve other sessions' dirty product files. No more benchmark reruns or workers are pending.

## Amendments

Append material changes and their reasons; preserve the original request and settled decisions.
