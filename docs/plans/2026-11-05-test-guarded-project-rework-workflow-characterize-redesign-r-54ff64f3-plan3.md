---
plan3: true
status: ready
created: 2026-11-05
updated: 2026-11-06T08:44:03.853Z
reviewed: 2026-11-05
started: 2026-11-05T10:39:25.505Z
---

# Test-guarded project rework workflow (characterize, redesign, replay, switch)

## Original request

> lets talk code refactoring - I have lot of projects, that are gradually added features upon, a sort of vibe coding style after their plans were complete. in time these projects became a mess, duplicate code that is not reused or can be reused with small modifications, code that can be redone in a different classes, different modules to be more clean, ways to communicate with the modules that could have been much better, etc, etc. I have tried before to run a few 'optimize' skills that resulted in nothing pretty much, what im thinking is a rework of a project - analyze, rethink, spending the 90% of the time of designing internals how they best communicate each other, think of a better modules to be used, better, libs/extensions/platforms, etc, discuss with the human of options and then a rework on the thing or part of the thing that needs rewriting. the smooth thansition before/after is to be ensured by testing - the "current" version is rigged with tests where it is missing, then results recorded, then new one repllayed testing to ensure nothing broke and we got an improvement in both code quality and performance and stability etc. so both vers may coexist for some time before the switch over, which I dont know how will happen - git worktrees?
> think about it, ask astra buddy what it thinks too

## Goal, requirements, and non-goals

**Goal:** a repeatable rework method for grown-messy projects, proven by hand on real projects first, then codified in ce-workflow as `/plan3 rework`.

The method (one loop per rework target):

1. **Map**: as-is module map tied to code (responsibilities, dependency direction, state ownership, runtime flows), duplicate clusters, git churn hotspots, and 2–3 concrete change scenarios that hurt today ("adding a source edits 5 modules").
2. **Characterize**: rig the current version with boundary tests (CLI, HTTP, public API, intent contracts; not private classes), record the results as a behavior corpus, and record baseline numbers.
3. **Design**: 2–3 genuinely different options, always including "local repair, no rewrite", each with module map, interface contracts, library or platform changes (what they remove, migration cost), expected benefit, risk and reversibility; one thin experiment for the riskiest assumption.
4. **Human picks** the option.
5. **Build alongside**: the new part lives next to the old one behind one seam; tests can select either.
6. **Replay and compare**: the same corpus against old and new; a scorecard fixed before building.
7. **Switch and retire**: human approves the switch; old code is deleted after an agreed watch window.

Requirements:

- R1: baseline before change. No replacement code is written before the corpus and baseline numbers are committed.
- R2: boundary corpus. Each case has input, setup state, action sequence, expected observations and an explicit comparison rule. Old-versus-old runs prove the corpus is stable before old-versus-new counts. One deliberately broken change must make the corpus fail (proves it detects regressions).
- R3: every observed behavior is classified preserve, approved intentional change, or unresolved. Bugs found are not automatically preserved. Agents never update the oracle themselves; changed expectations need the human.
- R4: predeclared scorecard with three separate dimensions (maintainability, performance, stability), each with metric, workload, baseline, threshold and repetition count. No single weighted score. Improvement claims name all of these; a material regression in one dimension is not hidden by gains in another (same spirit as the AGENTS.md Optimization Regression Rule). "Inconclusive" and "do not rewrite" are valid outcomes.
- R5: design gate. Build steps are not runnable until the human has picked an option; switch-over is not runnable until the human approves it.
- R6: coexistence. Only one implementation performs real writes; any side-by-side run uses disposable isolated state.
- R7: the method works for code-only projects like `C:\SOFT\git\ipc\AI-Wedge` (Kotlin, Android SDKs), where device checks are separate [blocked] steps.

Non-goals:

- A workflow engine, a language-neutral test protocol, or adapters for every stack. Each project uses its own runner (pytest, vitest, Gradle) behind shared case IDs.
- Automatic production switching or deployment.
- Exhaustive snapshots of everything; whole-project rewrites by default.
- Building `/plan3 rework` before a pilot has shown what the recipe needs.

Acceptance examples:

- DealFinder: a corpus run on the baseline worktree and on master gives the same pass list twice in a row; a planted bug in the reworked module makes at least one case fail; the scorecard table shows baseline and candidate numbers per dimension.
- `/plan3 rework "DealFinder sources"` in a project creates a draft whose Build and Replay phases carry `needs: R-design-approved`, Switch `R-cutover-approved` and Retire `R-retire-approved`, so neither night mode nor `/resume3` runs them before the human turns each on.

## Decisions

- **D-01 Pilot first, then codify.** Run the method by hand as Plan3 plans on real projects; only then turn what worked into `/plan3 rework`. Rationale: cheapest, avoids building a recipe from guesses. Source: user via ask_user, 2026-11-05.
- **D-02 Targets.** DealFinder (Python, 33 .py files, `C:\SOFT\git\DealFinder`) is the warm-up pilot that runs the full loop. PhotoBook (TS, 441 .ts and 70 .tsx, `C:\SOFT\git\PhotoBook`) gets the real analysis. Code-only projects like AI-Wedge (Kotlin, 466 .kt, `C:\SOFT\git\ipc\AI-Wedge`) are the real rework target the codified recipe must serve. Source: user via ask_user, 2026-11-05 (confirmed reading of "dealfinder is easy but really analyze photobook and code only things like AI-Wedge").
- **D-03 Coexistence: seam on master plus a baseline worktree for replay.** The new part sits next to the old behind one entry point (branch-by-abstraction); switch = flip that one selection; old code deleted after the watch window. A detached `git worktree` of the baseline commit is used only to replay the corpus and benchmarks against "before" (it does not isolate databases, ports or devices). A long-lived rewrite worktree is allowed only when the design phase shows no seam exists and the user approves it. Source: user via ask_user, 2026-11-05; matches each project's develop-on-current-branch rules.
- **D-04 Astra's second opinion is input, merged here.** plan3-advisor on `openai-codex/gpt-6-astra:high` (run 66b4ba27, full text in `C:\Users\Flex\.pi\agent\sessions\--C--SOFT-git-ce-workflow--\subagent-artifacts\66b4ba27-a8fb-4356-8571-17c0a94b1a31_plan3-advisor_output.md`) recommended: a small recipe plus narrow comparator, not an engine; boundary corpus with preserve/intentional/unresolved classes; predeclared scorecard; change scenarios with a "no rewrite" option; seam by default; human cutover with data-aware rollback; pilot one module first. Adopted in Goal and requirements R1–R6.
- **D-05 Design gate uses Plan3 requirements.** Verified fact: Plan3's `workState` (`extensions/plan3.ts:173-179`) runs pending steps even after an unanswered `[human]` step, but skips steps whose `needs:` requirement is off, and requirements nobody has set start off (night mode answers no). So build phases carry `needs: R-design-approved` and the switch step `needs: R-cutover-approved`. This replaces Astra's two-linked-plans handoff for the pilots; the codified command revisits it with pilot evidence (RW-12). Source: code inspection plus Astra finding.
- **D-06 Pilot plans live in the target project.** Each pilot is its own Plan3 plan in that project's `docs/plans/`, worked by a Pi session in that project (the target's AGENTS.md, tests and commit rules apply). This plan in ce-workflow holds the recipe, launches pilots, runs the retros and codifies. Confirmed by the user (Q-02 answer, D-08).
- **D-07 (Q-01) "90% designing" means think hard before coding.** No time quota and no design-versus-build ratio measurement; the gate is R1 plus R5 and the Map and Design phases run as [think]. Answer: "Just a think hard before codinf". Source: user via /plan3 resolve, 2026-11-05.
- **D-08 (Q-02) One Plan3 plan per target project, with a commit first.** Each pilot plan lives in its target repo (D-06). Before the pilot changes anything there, the pilot session makes a local pre-rework commit of the project's current state; that commit is the baseline sha for the replay worktree. It never stages credentials or junk files (such as the stray `nul` files seen in DealFinder and AI-Wedge), never pushes, and follows the target's AGENTS.md commit rules where they are stricter. Answer: "Plan per target project" with comment "But commit before making changes". Interpretation of the comment is the agent's reading, not separately confirmed. Source: user via /plan3 resolve, 2026-11-05.
- **D-09 (Q-03) PhotoBook runs the full loop in this plan, commit first.** Map, Characterize, Design, Pick, Build, Replay, Switch and Retire on the chosen PhotoBook part, with the same pre-rework commit as D-08. Answer: "Full loop" with comment "Again commit first". Source: user via /plan3 resolve, 2026-11-05.
- **D-10 (Q-01) AI-Wedge is read-only: analysis only.** RW-16 never writes to `C:\SOFT\git\ipc\AI-Wedge`: no commits (so the D-08 commit-first and its release-flow conflict do not arise), no new tests, no builds or Gradle runs (they write `build/` output beside unreleased release work). Its rework plan is created by `/plan3 rework` from a ce-workflow session and stored in ce-workflow `docs/plans/`, reading AI-Wedge by absolute path; it stops after Design and Pick, so its gated Build, Replay, Switch and Retire phases stay off. Characterize becomes a proposed corpus (which boundaries, such as `intent-contract`, cases and metrics) written in that plan, not code. Device qualification (RW-18) moves to Backlog. Answer: "Yea aiwedge should go read only just analyse". Where the plan is stored and the no-builds rule are the agent's reading of "read only". Source: user in chat, 2026-11-05.

## Open questions

### Blocking

None.

### Deferred

None.

## Relevant files and approach

Approach: write the recipe as a document, run it by hand (DealFinder full loop, PhotoBook analysis), fix the recipe from each retro, then codify the smallest command that reproduces it. Reuse what exists: Plan3 plans, `[think]`/`[code]` tags, requirements as gates, `plan3_diagram` for proposed module maps, `/plan3 ideas` and `review` for second opinions, the diff reviewer in `extensions/advisor-model.ts`, and Plan3 stats for time spent.

ce-workflow files:

- `docs/proposals/2026-11-05-rework-recipe.md` (new): the recipe text (loop, corpus case format, scorecard template, seam and worktree procedure, gate requirements, retro questions). Not shipped (package `files` excludes `docs/` except changelog).
- `extensions/plan3-rework.ts` (new, Phase 5): recipe prompt and plan skeleton, following the `extensions/plan3-catch-up.ts` pattern (code-generated Plan3 plan).
- `extensions/plan3.ts`: `SUBCOMMANDS` (line 43), argument completions (line 1963), request routing near line 1997, plan creation through the existing template writer (line 540).
- `scripts/test-work-plan3.mjs`: the `"re"` completion expectation at line 92 gains `rework`; new routing and gate assertions.
- `scripts/test-work-plan3-types.mjs`: include the new module if it lists sources explicitly.
- `README.md` (Plan3 section) and `CHANGELOG.md` (Unreleased).

Target projects (read-only from here; edited only by their own pilot sessions):

- `C:\SOFT\git\DealFinder`: `dealfinder/` (cli, sources, sync, verify, pricing, report, db), `tests/` with fixtures; CLI `python -m dealfinder run|sync-bg|scan|verify|report`.
- `C:\SOFT\git\PhotoBook`: `server/` (routes, services with many harness CLIs), `shared/`, web `src`; `npm test` (vitest), `npm run build`.
- `C:\SOFT\git\ipc\AI-Wedge`: `intent-contract`, `intent-autotest` (unattended validator on device), `testing/` rig harness; unit tests via Gradle per its AGENTS.md.

Baseline worktree procedure (recipe text, used in target repos). Two SHAs are recorded in the pilot plan:

- **pre-rework SHA**: the D-08 commit (or HEAD when the tree was already clean), made before `/plan3` runs; it is the rollback point.
- **corpus SHA**: the commit that ends Characterize; old code plus the committed corpus, fixtures and baseline records. This is the replay baseline, so the same tests run on both sides.

Replay: `git worktree add --detach "<temp dir>" <corpus sha>`; set up dependencies there as the project's README says; run the corpus there and in the main checkout with separate output dirs, ports and data dirs, recording which checkout and which implementation each run used. Corpus changes after the corpus SHA show in `git diff <corpus sha> -- <corpus paths>` and need human approval (R3). `git worktree remove "<temp dir>"` after Retire.

Cutover and rollback (recipe text): each design option states whether persisted formats or stored state change. Before Switch, the pilot plan records rollback triggers, how the old code handles state the new code wrote, and (when formats change) a restore or migration rehearsed on disposable state. Retire runs only after the watch window the human set at Switch has passed with its evidence recorded.

## Requirements

- **R-df-pilot-done** The DealFinder pilot finished and the user accepted its evidence (gates the DealFinder retro and everything after it).
- **R-pb-pilot-done** The PhotoBook pilot finished and the user accepted its evidence (gates the PhotoBook retro and codification).

## Commands

- C-p3: `node scripts/test-work-plan3.mjs` (ce-workflow Plan3 self-check)
- C-types: `node scripts/test-work-plan3-types.mjs`
- C-verify: `npm run verify:quiet` (full ce-workflow suite, once before completion)
- C-df: `python -m pytest` in `C:\SOFT\git\DealFinder` (from its plan 7003a034, C-test)
- C-pb: `npm test` and `npm run build` in `C:\SOFT\git\PhotoBook`

## Phases

### Phase 1: Recipe draft [think]

- [x] **RW-01** Recipe written at docs/proposals/2026-11-05-rework-recipe.md (loop, corpus format, comparison rules, two-SHA replay, scorecard, rollback, gates, skeleton, retro questions).
- [x] **RW-02** Recipe reviewed by plan3-advisor (run 661d6254); all 6 findings accepted and applied to the recipe and plan, dispositions in Amendments.

### Phase 2: DealFinder warm-up pilot [think]

- [x] **RW-03** DealFinder pilot plan b8ad3205 created by the DealFinder session (pre-rework SHA 27221be, skeleton with three gates); Map not started.
- [wip] **RW-18** Lab driver `scripts/rework-lab.mjs`: fresh full clone of DealFinder at pre-rework SHA 27221be in C:\SOFT\git\rework-lab\<run> (no origin remote, later commits pruned, data/ copied, .env left out), project .pi/settings.json sets planningModel opus and codingModel gpt-6.1-sol, then drives Pi over RPC: /plan3 with the recipe request, /resume3, answers dialogs with the recommended option, turns gates on in order when the run stalls on them, and stops when the plan is complete or makes no progress. Check: a smoke run reaches plan creation in a clone with the real DealFinder repo unchanged.
- [ ] **RW-19** Lab iterations: run the driver, then evaluate the clone (diff against 27221be, full test suite, corpus replay, and a review of code improvement, readability, security and performance, plus time and cost from the stats file). Strengthen the recipe and prompts, then repeat on a fresh clone. Record each run's scorecard under docs/proposals/rework-lab/. Check: the latest run's evaluation shows no regression on any dimension and a clear improvement, or names the blocker; the user agrees to move to a more serious project.
- [ ] **RW-04** Drive the DealFinder pilot plan through Map, Characterize, Design, Pick, Build, Replay, Switch and Retire.
  - Acceptance from Goal: stable old-versus-old corpus, planted bug caught, scorecard with baseline and candidate per dimension, rollback rules recorded, old code retired after the watch window, C-df green on master. Any intentional behavior change replays through the recipe's approved-delta file; if none occurs, the plan says so.
  - Check: `git log` in DealFinder shows the pre-rework commit before the plan file; corpus SHA recorded; pilot plan complete or an explicit stop reason.
  - When done, the user turns on R-df-pilot-done (Alt+A) if the evidence is acceptable.
  - note: 2026-11-05: user approved; go sent to DealFinder session 01a17e92 (Map to Design, stop at PICK-01). Pre-rework SHA 27221be, pilot plan b8ad3205.
  - note: Paused 2026-11-05 at the DealFinder Pick (plan b8ad3205, R-design-approved off) in favour of the clone lab RW-18/RW-19, per the user.
- [ ] **RW-05** Retro: compare the pilot plan, its stats file and git log with the recipe; list what was missing, noisy or unused.
  - Inputs: the pilot plan's Amendments, questions asked and git log; its stats file only for failed tools and stuck steps.
  - needs: R-df-pilot-done
  - Check: retro section appended to the recipe document with concrete edits.
- [ ] **RW-06** Apply the retro edits to the recipe.
  - needs: R-df-pilot-done
  - Check: diff of the recipe document; each retro item marked applied or rejected with reason.

### Phase 3: PhotoBook full rework [think]

needs: R-df-pilot-done

- [ ] **RW-07** Start a PhotoBook pilot plan with the updated recipe, full loop (D-09), opened as in RW-03 (pre-rework commit before `/plan3`).
  - The request names PhotoBook's durable state (workspace normalization, payment and fulfillment, per `C:\SOFT\git\PhotoBook\server\AGENTS.md`) for the rollback rules.
  - Check: Plan3 plan in `C:\SOFT\git\PhotoBook\docs\plans\` with the skeleton gates and the pre-rework SHA.
- [human] **RW-08** Work the PhotoBook plan through Map, Characterize and Design, and pick an option (or "no rewrite").
  - Acceptance: as-is map tied to files, change scenarios, 2–3 options with contracts and costs, committed corpus and baseline numbers, C-pb green.
  - Check: `git log` shows the pre-rework commit first; Decisions in the PhotoBook plan records the chosen option.
  - If the pick is stop (no change built): RW-17 is marked done as "not run: stopped at Pick", and the user turns on R-pb-pilot-done after accepting the stop evidence (map, corpus, design).
- [human] **RW-17** Work the PhotoBook plan through Build, Replay, Switch and Retire for the chosen option.
  - Acceptance: as RW-04 (stable corpus, planted bug caught, scorecard per dimension, rollback rules rehearsed where stored state changes, human-approved switch, retire after the watch window), C-pb green. Any intentional behavior change replays through the recipe's approved-delta file; if none occurs, the plan says so.
  - When done, the user turns on R-pb-pilot-done if the evidence is acceptable.
  - Check: PhotoBook pilot plan complete or an explicit stop reason; scorecard committed. Skipped when RW-08 picks "no rewrite".
- [ ] **RW-09** Retro on PhotoBook as in RW-05 (TS, larger codebase, harness CLIs); apply edits to the recipe.
  - needs: R-pb-pilot-done
  - Check: recipe document updated; retro lists what changed versus DealFinder.

### Phase 4: Codify decisions [think]

needs: R-pb-pilot-done

- [ ] **RW-10** Decide the command shape from both retros: single plan with requirement gates (D-05) or two linked plans.
  - Ask with pilot evidence then: did any gated step run early, did the gate feel heavy.
- [ ] **RW-11** Decide whether a shared comparator helper is worth shipping, or project-native runners suffice.
  - Ask with pilot evidence then: how corpus results were compared in DealFinder and PhotoBook, and how much glue each needed.
- [ ] **RW-12** Record both choices in Decisions and turn the rest of Phase 5 into concrete steps with plan3 add.
  - Check: Decisions updated; Phase 5 steps name files and checks.

### Phase 5: Build /plan3 rework [code]

needs: R-pb-pilot-done

- [ ] **RW-13** Add `extensions/plan3-rework.ts` with the recipe prompt and plan skeleton; route `/plan3 rework <request>` in `extensions/plan3.ts`.
  - Creates the plan through the existing template writer; gates per RW-10; planning starts like `/plan3`.
  - Check: C-p3 with new assertions: routing, `"re"` completions include `rework`, and on a generated plan with the gate requirements off the plan3 tool's next step is never Build, Replay, Switch or Retire (also after a stop at Pick); the generated skeleton needs no phase-tagging turn (`needsThinkTags` false); C-types.
- [ ] **RW-14** Document `/plan3 rework` in `README.md` (Plan3 section) and add an Unreleased bullet in `CHANGELOG.md`.
  - Check: manual read; README lists limits (no auto switch, device steps blocked, corpus only covers chosen scenarios).
- [ ] **RW-15** Run C-verify once.
  - Check: suite passes.

### Phase 6: First codified run [think]

needs: R-pb-pilot-done

- [ ] **RW-16** From a ce-workflow session, run `/plan3 rework` on `C:\SOFT\git\ipc\AI-Wedge` read-only (D-10): Map, proposed corpus, Design, Pick.
  - Acceptance: plan created by the command needs no manual skeleton edits; its Build, Replay, Switch and Retire phases stay gated off; device checks appear as separate [blocked] steps.
  - Check, primary: an audit of the session's tool calls shows only reads under the AI-Wedge path (read, grep, `git log`, `git show`, `git diff`), with no writes, builds, Gradle runs or commits.
  - Check, supporting: `git -C "C:\SOFT\git\ipc\AI-Wedge" rev-parse HEAD`, `status --short --ignored` and `diff` output are identical before and after the run (saved in a temp dir outside AI-Wedge). Another session editing AI-Wedge at the same time can change these; the audit decides.
### P-ARCH [code] Product architecture

- [ ] **ARCH-RECONCILE** Reconcile the product architecture diagram with this plan's actual changes.
  - needs: R-pb-pilot-done
  - Compare actual code and git history; update through plan3_diagram target product, or mark done with no architecture change.
  - Changed plan elements: none flagged; inspect actual implementation.
  - note: Assumed: gated on R-pb-pilot-done, since product code only changes in Phase 5 (2026-11-05).


## Global validation

- Recipe document covers R1–R7 and was revised after both retros.
- DealFinder pilot meets its acceptance example (stable corpus, planted bug caught, scorecard per dimension, switch approved by the human).
- PhotoBook has a pre-rework commit, a committed corpus, baseline numbers, a human-chosen option, and (unless "no rewrite") a replayed, scored and human-approved switch.
- Every pilot repo shows its pre-rework commit before the first pilot change.
- `/plan3 rework` exists; with its gate requirements off, Build, Replay, Switch and Retire are never the next step; C-p3, C-types and C-verify pass.
- RW-16 produced an AI-Wedge analysis plan through Design and Pick without writing to the AI-Wedge repo.
- Nothing was pushed; target repos were changed only by their own pilot sessions.

## Backlog

- Full rework loop on AI-Wedge after RW-16 (only if the user lifts D-10), including RW-18: qualify the corpus on a real device through `intent-autotest` and the `testing/` rig (needs the rig device).
- Shadow runs of old and new side by side on disposable state, if a pilot shows replay alone misses issues.
- Dependency-rule checks (forbidden imports, cycles) as a standing guard after a rework, per stack.

## Resume context

RW-18 wip. photobook-01 complete (docs/proposals/rework-lab/photobook-01.md): projectRepository split into store/normalizer/facade, no new test failures (same 8 pre-existing failures at 5cb626e), gates held, $10.99, 2h24 incl ~1h driver gate loop (fixed: [human] steps pass, marker-based gate stalls, --resume). Recipe §3 test-only seam note added. All lab work (recipe, driver, run-03/04/05/photobook-01 reports) uncommitted in ce-workflow. Next: user decides — commit lab work, codify /plan3 rework (RW-19+), or another lab run.

## Amendments

Append material changes and their reasons; preserve the original request and settled decisions.

- 2026-11-05 resolve: Q-01 to Q-03 answered (D-07 to D-09). RW-05 no longer measures a design-versus-build ratio. Pre-rework commit added to RW-03, RW-04, RW-07, RW-08 and Global validation. Phase 3 widened to the full PhotoBook loop with new step RW-17; the PhotoBook build Backlog bullet was removed.
- 2026-11-05: Added RW-18 after RW-16: Review finding 6: device qualification split from the runnable code-only run (RW-16).
- 2026-11-05 review (plan3-advisor, openai-codex/gpt-6-astra:high, run 41f2e6a2), each finding checked against the code:
  - F1 pilot-first ordering not enforced: accepted. Verified `workState` (`extensions/plan3.ts:173-179`) picks pending steps past unanswered [human] steps. Added `## Requirements` R-df-pilot-done and R-pb-pilot-done; RW-05, RW-06, Phase 3 and RW-09 to Phase 6 now need them.
  - F2 Replay and Retire bypass gates: accepted. Skeleton now gates Build and Replay on R-design-approved, Switch on R-cutover-approved, Retire on R-retire-approved, all defined under `## Requirements` (verified `requirementDefs`, `extensions/plan3.ts:156-160`, only knows defined ones). RW-13 tests the actual next step, not text.
  - F3 replay SHA predates the corpus: accepted. Two SHAs: pre-rework SHA (rollback point) and corpus SHA (replay baseline, old code plus corpus); corpus drift checked with `git diff <corpus sha>`.
  - F4 `/plan3` writes into the repo before the prompt runs: accepted. Verified `newPlanFile` (`extensions/plan3.ts:534-541`) writes the draft first. RW-03 and RW-07 now commit (or record HEAD when clean) before `/plan3`. D-08 unchanged; this is its order of operations.
  - F5 no data-aware rollback: accepted. Added cutover and rollback rules (persisted-format statement, rollback triggers, rehearsal on disposable state, watch-window evidence before Retire); RW-04 now includes Retire; RW-07 names PhotoBook's durable state.
  - (later) 2026-11-05 chat: Q-01 answered as D-10, AI-Wedge read-only analysis. RW-16 rewritten as read-only; RW-18 moved to Backlog; Global validation updated.
  - F6 RW-16 blocked as a whole: accepted. RW-16 is runnable at unit level; device qualification moved to new [blocked] RW-18. Also found while applying it: AI-Wedge's dirty release tree conflicts with D-08, added as Q-01.
- 2026-11-05: Added final architecture reconciliation because a product diagram exists.
- 2026-11-05 recipe review (plan3-advisor, openai-codex/gpt-6-astra:high, run 661d6254), each finding checked against the code:
  - F1 "no rewrite" still turned on the Build gate: accepted. Recipe Pick has two outcomes: build an option, including local repair (gate on), or stop (gates stay off, Build to Retire marked "not run: stopped at Pick"). RW-08 says how the stop unlocks R-pb-pilot-done; RW-13 tests the stop case.
  - F2 intentional changes had no replay rule: accepted. Baseline expectations at the corpus SHA never change. An approved-delta file keyed by case ID holds approved new expectations. Old side matches the baseline; new side matches the baseline plus the delta. BLD-01, RW-04 and RW-17 updated. A forced intentional change in each pilot was rejected as artificial; the pilot records "none" instead.
  - F3 review-before-pilot not enforced: accepted. Resolved by finishing RW-02 with these fixes applied before RW-03 runs; no extra gate needed.
  - F4 RW-16 status check cannot prove read-only: accepted. The primary check is now an audit of tool calls; HEAD, `status --ignored` and diff are supporting.
  - F5 `[human]` used as a phase tag: accepted. Verified that `needsThinkTags` (`extensions/plan3.ts:413-416`) only accepts `[think]`/`[code]`. Pick and Switch phases are now `[think]` with `[human]` steps; RW-13 asserts no tagging turn.
  - F6 night-mode wording: accepted. Verified that `nightSet` copies the day set and `setBoth` sets both (`extensions/plan3-needs.ts:27-31`). The recipe now says approved gates stay on at night.
- 2026-11-05: Added RW-18, RW-19 after RW-03: 2026-11-05 user direction: run the recipe autonomously on throwaway full clones of DealFinder (thinker anthropic/claude-opus-5-5, worker openai-codex/gpt-6.1-sol), evaluate each result (code improvement, readability, security, performance), strengthen the prompts and repeat until good; then move to a more serious project. The real-repo pilot RW-04 is paused at its Pick.
