---
plan3: true
status: active
created: 2026-10-12
updated: 2026-10-12T08:13:19.990Z
reviewed: 2026-10-12
tagsChecked: 1775df81
started: 2026-10-12T07:37:44.039Z
---

# Remove the legacy ce-workflow orchestration system

## Original request

> now the good thing - I want the old ce-workflow system completely rid of, no menu, no legacy, no nothing, leave only the option to convert if old ce-w plans are detected and that's it, I want the source gone for good

Scope answer (ask_user, 2026-10-12): keep durable knowledge, /wo monitor, extension scout and /wo catch-up. "Ask me if some of these will leave a substantial legacy code, besides catch up. Actually catch up is quite limited now compared to what it was before so it is worth slimming down too of the legacy features."

## Goal, requirements, and non-goals

- Goal: the package contains no legacy orchestrator source, menu, toggle, agents, skill, prompts, scripts or tests. Git history is the only archive.
- Keep, working as today:
  - Plan3 with night mode, needs, stats, design, ideas and the "Convert legacy work" entry in /plans3. The convert entry must still read old work items.
  - /research and research mode, compaction with compaction_note, the /wo Settings dialog without the Workflow toggle.
  - The subscription footer, camera tools, screen_read, process_image and generate_image, Jev tools, the advisor, Enter-runs.
  - Durable knowledge: the knowledge tool, /wo fact and the recall in compaction summaries.
  - The extension scout, and /wo catch-up as its Plan3 path only. /wo monitor goes (D-07).
  - /wo plan, /wo plans, /wo resume (Plan3 aliases) and /wo compact.
- Delete:
  - The orchestrator: /wo goal, pause, resume-work, the Workflow toggle, F9, the work_* tools and the goal machinery.
  - agents/ (work-* agents), skills/work-orchestrator, and the work-design-handoff skill if only legacy uses it.
  - Background verifiers, read-only lanes, fleet, initiatives, sentinel, capability adapters, action leases, beads migration and private workflows.
  - The work store except the read-only loader that convert needs.
  - /ideate and the prompts idea.md, simple.md and complicated.md.
  - /wo telemetry and /wo usage (workflow-telemetry), unless Plan3 stats or the footer still need part of it.
  - /wo design, /wo redesign and /ui-gate. Plan3's own design phase stays, with the work-design.ts helpers it imports.
  - Legacy CLI scripts, generators, benchmarks, evaluation harnesses, tests, docs and verify-package checks for the removed features.
- Non-goals: rewriting the kept features beyond what removing legacy code requires, any monitor replacement or Backlog item for one (D-07), renaming the package, pushing.

## Decisions

- D-01 The user chose to keep durable knowledge, /wo monitor, extension scout and /wo catch-up; the rest of the gray-zone list goes (ask_user, 2026-10-12).
- D-02 Ask the user before keeping a large legacy-only code path that a kept feature (knowledge, monitor, scout) still depends on. Catch-up is slimmed without asking.
- D-03 Remove dead code mechanically with a throwaway TypeScript AST script in %TEMP%; TypeScript goes only into a temp prefix, never into the package. Before sweeping, delete legacy exports and their test and CLI consumers, and define the runtime roots: the five pi.extensions entries, their registered commands, tools and hooks, and the scripts kept. After the sweep, review the remaining declarations by hand for unreachable groups that only reference each other. Agent proposal, refined by review.
- D-04 /wo catch-up keeps only its Plan3 path (`startPlan3CatchUp` and plan3-catch-up.ts). The legacy branch (`buildWorkCatchUpState` promotion, private workflow releases, goal launch) and work-compound-catch-up.ts go. Agent proposal under D-01.
- D-05 Plan3 convert tests switch to static legacy-store JSON fixtures before the store writers are removed. They keep the assertions for marker mapping, numeric child order, duplicate-conversion suppression and unchanged source bytes. The read-only loader keeps `loadStore`'s recovery-file fallback, with a test. Agent proposal from review.
- D-06 verify-package loses its workflow-switch skip (`workflowOn`, `GENERAL_TESTS`), so every kept test always runs. Acceptance: every check passes except the one known machine-only failure in test-work-screen-read.mjs (Android), which is reported by name. Agent proposal from review.
- D-07 Drop /wo monitor with the goal engine; no replacement and no Backlog item ("let it die"). This narrows D-01 for monitor only. Removes `handleWorkMonitorCommand`, the `work_monitor_bind` and `work_monitor_reload` tools, the monitor scheduler and the monitor tests in scripts/test-work-wo-control.mjs:112–180. Source: user via /plan3 resolve Q-01, 2026-10-12.
- D-08 Delete this repository's tracked legacy store .ce-workflow/work-items.json in P3; unconverted items survive only in git history. The ignored .ce-workflow/local/ and .ce-workflow/work-runs/ are untracked local data and are left alone; the .ce-workflow lines in .gitignore stay so old local data never gets committed. Source: user via /plan3 resolve Q-02, 2026-10-12; the ignored-directory handling is an agent proposal.


## Open questions

### Blocking

None.

### Deferred

None.

## Relevant files and approach

E1 inventory (import graph of extensions/ and scripts/, 2026-10-12). Baseline `verify-package --quiet` (workflow off, 52 s): 2 failures, test-work-screen-read.mjs (known, "ProcessFile ... Parameter is not valid") and test-work-plan3.mjs ("Plan frontmatter is not closed"), which passes alone with the same env, so it is flaky inside the full run.

- extensions/work-models.ts (33.6k lines) mixes the legacy and kept code. `workflowEnabled()` and `workflowOn` gate about 38 legacy sites. Entry points: the work_verifier_* tools near line 11883, research_note, compaction_note and knowledge around 30389, the hooks from 30434 to 32200, the commands `research`, `ideate` and `wo`, and the menu `handleWorkMenuCommand` near 26302. Legacy exports around 30205–30370.
- Keep as is: advisor-model, enter-runs, jev-tools, opendesign-client, plan3*.ts, screen-read, subscription-footer (+UPSTREAM.md), work-ask-remote, work-camera*.ts, work-dialogs, work-images, work-vision, work-knowledge (+ utility-agents/context-knowledge-discoverer.md, launched by `launchKnowledgeDiscoverer`), work-extension-scout, work-compaction-memory, work-catch-up-baseline.json, utility-agents/plan3-advisor.md, skills/frontend-design.
- Trim:
  - work-models.ts: everything legacy.
  - work-design.ts: keep the 9 helpers plan3-design.ts imports (line 7).
  - work-compound-source.ts: keep `normalizeSourcePath` and `readConfinedFile` for the scout (work-extension-scout.ts:5).
  - work-compaction.ts: drop the WORK_RESUME and AUTONOMOUS_GOAL profiles and /work-resume guidance.
  - work-store.ts: keep the read-only loader with recovery fallback for plan3.ts:17 (`loadStore`, `listWorkItems`, `childWorkItems`); work-verification-contract.ts stays only if that loader needs it.
- Delete (extensions): background-verifiers, read-only-lanes, work-fleet, work-initiatives, work-action-leases, legacy-beads-migration, work-private-workflows + private-workflows/, work-ui-gate, work-quality-policy, work-improvement-reporting, workflow-telemetry, work-compound-catch-up, work-sentinel, work-capability-adapters, work-compound-inventory.json, work-compound-source-policy.json.
- Delete (package): agents/ (all work-* and workflow-* agents), skills/work-orchestrator, skills/work-design-handoff (only legacy tests and verify-package use it), prompts/ (idea, simple, complicated), benchmarks/workflow-evaluation, benchmarks/work-slice-adoption.json, docs/orchestrator.md, docs/orchestrator_idea.md.
- Keep (scripts): verify-package (trim), work-catch-up-record, patch-ask-user-remote-answer, audit-payload-strip, benchmark-image-strip-live, benchmark-reasoning-strip-live, benchmark-jev-live, benchmark-context-continuity (+ benchmarks/context-continuity), reasoning-wire-probe, test-ask-remote-live, test-compaction-resume-idle, fixtures/camera-parent.mjs, fixtures/opendesign (test-work-plan3 uses it), benchmarks/session-knowledge.
- Kept tests: test-advisor-model, test-jev-tools, test-work-ask-remote, test-work-camera, test-work-camera-state, test-work-compaction, test-work-compaction-notifications, test-work-compound-source (trim), test-work-dialogs, test-work-enter-runs, test-work-extension-scout, test-work-knowledge, test-work-knowledge-retrieval, test-work-microcompact-agent, test-work-native-smoke, test-work-plan3, test-work-plan3-night, test-work-plan3-stats, test-work-screen-read, test-work-settings, test-work-subscription-footer, test-work-store (trim to the loader); test-work-opendesign-client and test-work-design-fidelity are kept only if they cover the work-design helpers Plan3 uses.
- Delete (scripts): work-helper, work-goal-watchdog, work-hygiene (work-models imports `formatPendingFiles`; check in S1), work-command-fixture, generate-work-private-workflows, probe-work-compound-source, ui-gate/, fixtures/ui-gate, fixtures/capabilities, run-work-slice-benchmarks, work-improvement-benchmark, workflow-evaluation*, workflow-visual-evaluation, run-work-redesign-calculator-e2e, verify-work-redesign-evidence, test-work-prompt-commands (checks the deleted prompts), test-work-telemetry and test-work-usage (legacy telemetry), test-work-store-performance, test-work-child-auth-live, and every other test-* not kept above.
- scripts/test-work-plan3.mjs:26 imports `createWorkItem`, `initStore` and `mutateStore`; lines 777–794 build convert fixtures with them (E5).
- package.json: pi.extensions stays; drop pi.prompts and the agents/, benchmarks/, prompts/ files entries as their contents go. scripts/verify-package.mjs: legacy checks, the test list and the workflow switch (lines 546–600).

## Phases

### Phase 1: Inventory [think]

- [x] **E1** Import graph done; keep, trim and delete lists for extensions, scripts, tests and package dirs recorded under Relevant files.

### Phase 2: Entry points [code]

- [x] **E4** Removed monitor command, tools, scheduler, wake/reload handling and monitor control tests; residual goal status strings disappear with E2/S1.

- [x] **E2** Removed workflow switch, legacy public exports, F9/work_* registrations, goal entry points and settings controls; retained utilities have an isolated command regression check.
- [x] **E3** Replaced orchestrator menu/dispatcher with retained utilities; removed ideate, telemetry/usage/design/UI-gate routes and legacy catch-up launch; scout retains isolated cancellable background flow.
- [wip] **E5** Replace store-writer fixtures in test-work-plan3.mjs with static legacy JSON (D-05) before touching work-store.ts.

### Phase 3: Dead-code sweep [code]

- [ ] **S1** Run the AST sweep (D-03) on work-models.ts until stable, then review leftovers for mutually referencing dead groups.
- [ ] **S2** Delete orphan modules; trim work-design, work-compound-source, work-compaction and work-store to what kept code uses.
- [ ] **S3** Confirm knowledge and scout pull in no large legacy code; ask the user if they do (D-02).

### Phase 4: Package, tests and docs [think]

- [ ] **P1** Delete agents/, skills/work-orchestrator, legacy prompts, legacy scripts, benchmarks and docs; update package.json.
- [ ] **P2** Delete or trim legacy tests; remove the verify-package workflow switch and legacy checks (D-06).
- [ ] **P3** Update README and AGENTS.md references, delete .ce-workflow/work-items.json (D-08), bump the version and commit locally.

## Global validation

- `node scripts/verify-package.mjs --quiet` runs every kept test with no workflow switch. All pass except test-work-screen-read.mjs (Android, machine-only), reported by name (D-06).
- The LSP check on changed extensions shows no new errors.
- A grep for `workflowEnabled`, `workflowOn`, `work_goal`, `startWorkGoal`, `background-verifiers`, `read-only-lanes`, `ideate`, `ui-gate` and `monitor` across extensions/, scripts/ and package.json finds nothing outside Plan3 convert's reader.
- test-work-plan3.mjs convert tests pass on static fixtures, including the recovery-file fallback.
- Manual: after /reload, the /wo menu shows only kept utilities, and /plans3 still offers "Convert legacy work" in a project with old work items.

## Resume context

E1 and E4 committed locally (c127ff0, 5352c2a). E2 in progress: public /wo reduced to Plan3/utilities; F9, work_* registrations and legacy settings rows removed; startup/agent hooks stripped of goal activation and legacy telemetry; first unused-declaration sweep applied. Focused utility, Plan3 and compaction-notifications tests pass. Still remove legacy exports, internal goal branches and unused declarations before E2 is done; follow with E3 menu/utility dispatch cleanup, E5 static conversion fixtures, then S1 graph sweep. Baseline verifier: known screen-read failure plus Plan3 transient failure (passed isolated twice). No push. Stop reason: none; continuing after compaction checkpoint.

## Amendments

Append material changes and their reasons; preserve the original request and settled decisions.

### 2026-10-12 review (plan3-advisor, gpt-6-astra), each finding checked against the code

- A-1 Monitor depends on the goal engine: accepted. Verified at work-models.ts:22279–22299 (`startWorkGoal`, `handleWorkGoalCommand`). Added Q-01 (blocking, per D-02), step E4, and the non-goal exception.
- A-2 Mixed modules are not orphaned: accepted. Verified plan3-design.ts:7 (9 helpers), work-extension-scout.ts:5 and work-compaction.ts:1–13. S2 now trims these modules; listed under Relevant files.
- A-3 Sweep stopping condition: accepted. D-03 now removes legacy exports first, defines runtime roots and adds a manual review for mutually referencing dead groups; S1 updated.
- A-4 Legacy CLI scripts missing: accepted. Verified the scripts/ listing (work-helper.mjs, work-goal-watchdog.mjs, generate-work-private-workflows.mjs, ui-gate/ and the evaluation harnesses). E1 and P1 cover scripts; the final grep spans scripts/.
- A-5 Convert tests use the store writers: accepted. Verified at test-work-plan3.mjs:26 and 783–787 (the advisor cited line 20). Added D-05 and step E5, ordered before store trimming.
- A-6 Validation conflicts with the known failure: accepted. Verified verify-package.mjs:555–566 (workflow switch, GENERAL_TESTS). Added D-06 and rewrote the validation line.
- Own finding: /wo catch-up already routes to `startPlan3CatchUp` with the workflow off (work-models.ts:23151), so slimming it means deleting the legacy branch (D-04). work-sentinel.ts and work-capability-adapters.ts have no importers and go outright. The repo's own .ce-workflow store became Q-02.
- E1 became a [think] phase because it decides keep, trim or delete per module.

### 2026-10-12 resolve answers reconciled

- Q-01 answered "Drop monitor", no Backlog item: recorded as D-07. E4 moved from the [think] inventory phase to Phase 2 as a deletion step; the keep list, non-goals and the final grep were updated.
- Q-02 answered "Delete it in P3": recorded as D-08 and folded into P3. Checked .gitignore: .ce-workflow/local/ and .ce-workflow/work-runs/ are ignored and untracked, so only work-items.json is deleted from git.
