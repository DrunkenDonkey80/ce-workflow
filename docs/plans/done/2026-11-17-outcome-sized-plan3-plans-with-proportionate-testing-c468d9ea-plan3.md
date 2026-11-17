---
plan3: true
status: complete
created: 2026-11-17
updated: 2026-11-17T14:25:42.281Z
started: 2026-11-17T12:48:04.621Z
---

# Outcome-sized Plan3 plans with proportionate testing

## Original request

> Plans split into too many tiny steps and over-test each one. Example: a certificate change became 7 steps (really 3); 3 Belot bug reports became 9–14 steps costing 77–90 min and $15 each, with 41–62 desktop test runs, mutation runs on every fix, full suite at every tiny phase boundary, and review findings that added new checks. Find where ce-workflow's Plan3 rules cause this and tighten them so plans are outcome-sized and testing is proportionate, without losing real verification. Astra may be used for review.

User's words: "lets plan something about that, use astra if needed too, we overdid it somewhere". Later: "we are not making belot rules here tho... we are editing ce-wf so it suits all, so analyze as many plans recently as you see and lets find what will work to make them not overengineered".

## Goal, requirements, and non-goals

Goal: in every project, a Plan3 plan splits work logically, one reviewable outcome per step, and proves each behavior once; the full suite runs on the final state.

Requirements:
- Each step delivers a reviewable outcome with its reproduction, implementation and targeted proof inside it.
- Bug batches: usually one step per report, plus one shared final testing step when there is more than one report.
- Split by independent acceptance, risk or prerequisites, not by command or file area; work too large to finish and review in one session is still split.
- Qualification scenarios that share an environment and prerequisites are one step with scenario sub-bullets; different signing, deployment, approval or recovery boundaries stay separate.
- A long step line gets sub-bullets; a long piece of work gets more steps. The 200-character line limit stays.
- One proof per behavior: genuine red/green or one targeted mutation, not both.
- Full suite on the final relevant state before completion and before an authorized release or push; one run covers both when the state is unchanged. Phase boundaries alone do not trigger it. Explicit project and user test limits win.
- Plan review also looks for needless splits and duplicate proof; a proposed check or step must address a requirement, safety risk or acceptance gap, optional hardening and process go to Backlog, and new acceptance requirements need the user's decision.
- Real verification stays: targeted tests per step, final full suite, machine and device qualification where the plan needs it, legitimate standalone steps (final integrated validation, signed builds, migration rehearsal, experiments, requested deployment).

Non-goals:
- Tiny / Plan / Map sizing (D-03).
- Any step-count number or granularity lint (D-04).
- Belot's own `docs/bugreports.md`, its tests, and the Mac's ~30-second command kill (Backlog).
- The automatic ARCH-RECONCILE phase (Backlog).

## Findings

Belot analysis (Mac session, plans 40b87278 and 11624e75, from their stats files; plan files, logs, stats and `docs/bugreports.md` later attached by the Mac session over a hub link, copies in `.pi/inbox/` of this repo):
- 40b87278 (3 reports): 14 steps in 6 phases, 90 min, $15, 62 desktop test runs, 14 mutation runs (10 failed or inconclusive, 11 min), 34 min waiting on background jobs.
- 11624e75 (5 reports): 9 steps in 5 phases, 77 min, $15, 41 desktop test runs, 2 golden-image comparisons; an advisor review added a manual screenshot-diff check (G1) to every step.
- Shape of the actual plans: 40b87278 split its 3 reports into 9 detail steps (A1–A3, B1–B2, D1, L1–L3), then V1 suites, V2 offline web and V3 online match as 3 steps, then H1 approval and H2 deploy as 2 steps. 11624e75: P1–P2, B1–B2, E1, then V1–V2 and H1–H2. Outcome-sized, both are about 5 steps: one per report, one shared verification run, one approved release.
- Mutation runs (Mac session's reading of the logs): both sources contributed. Plan text asked for them in places (40b87278 A1 "Prove with test_sensitivity", 11624e75 P1 "restore `else -> 4 * t`"); most other 40b87278 steps recorded mutations where the step only asked for a regression check, consistent with the global rule. One fix (11624e75 V2, crown clipping) had both red/green and a mutation, on different layout branches.
- The ~30-second kill is the Hypa shell's inner limit (`[hypa: command timed out after 30s; killed process; exit=124]`, Rewrite session entry 2363c365, bash timeout 220 passed); not ce-workflow, not the bash timeout argument. Hypa is not installed on this Windows machine.
- Certificate plan (other machine): 7 steps, really 3; the agent named "own [blocked] step" read per VM scenario and the 200-character limit answered with more steps.

Local sample: 119 Plan3 plans since 2026-10-01 across C:/SOFT/git (1,913 steps, 571 phases, 16 steps and 4.8 phases per plan on average); in the 40 newest, 42% of phases hold one or two steps, so "full suite at each phase boundary" fires almost every step.

Astra audit (oracle run 21a609bb, read-only; full output and exact before and after wording in `docs/plans/logs/c468d9ea-astra-audit.md`): 66 distinct plans across 13 project families.
- Verdicts: 22 right-sized, 39 mixed, 5 oversplit, 0 purely undersplit; 5 mixed plans also hold overlarge steps, so fewer steps alone is not success.
- Patterns: file or detail fragmentation in 31 plans, detached checking in 24, overlarge steps in 5, reproduce-before-fix splits in 4, shared-run scenarios split in 3, tiny judgment phases in 3, commit-only steps in 2, review-added checks in at least 7 (often useful).
- Clear oversplits: 0c55372d (CSS, markup, cleanup, checks, commit as steps of one design), 45682eea (fix then its regression as a separate step), 4b311224 (nine steps for one feature plus corrections), be05f446 (reproduce, fix, regressions for one bug), d4e21dbd (a step whose code had already landed with the previous one).
- Undersplit examples: 3a006178 ("all causes, all fixes, all validation" for three reports), b825a38e W-02 (several movement bugs in one step), 75b51cc9 V-04 (broad fixes bucket).
- Right-sized examples: 714509f1 (investigate, implement both paths with tests, qualify), 27a11af3 (freeze, run native builds, report verdict), 1b037b9a (five steps justified by migration safety boundaries), 6b5c5c72 (55 steps justified by distinct prerequisites).
- No local plan requires both red/green and a mutation for every fix; that remains Mac-reported evidence.
- Caution: October plans predate the November project-care and test-sensitivity rules, so not every shape traces to current wording.

Rule sources (verified in code, line numbers at master 2026-11-17):
1. `PLAN_SHAPE` (`extensions/plan3.ts` 83): "its own [blocked] step" without grouping; the 200-character limit without "not extra steps". `writePrompt` (580) gets `PLAN_SHAPE` but not `PROJECT_CARE`, so granularity wording belongs in `PLAN_SHAPE`.
2. `PROJECT_CARE` (55): "small prefactor … plan it as its own step before the change"; "thin end-to-end slices" with a weak merge brake.
3. `THINK_RULE` (79): "keep judgment work in its own phase instead of mixing it into a build phase".
4. `OPTIMIZE_RULES` 4 (88), 6 (90), 8 (92): own step ID per qualification; full suite at phase boundaries; "do not merge large steps only to reduce the count".
5. Execute prompt (590): "the full suite once at each phase boundary and before completion".
6. `TEST_SENSITIVITY` (`extensions/test-sensitivity.ts` 6, system prompt every turn): "During planning, put this check in the relevant implementation step".
7. `advisorPrompt` review body (618): asks what is missing, never what is redundant; no Backlog brake (Optimize rule 9 has one).
8. `ensureArchitectureStep` (1357–1366): code appends a P-ARCH phase with ARCH-RECONCILE when a product diagram exists; wording cannot remove it.

## Decisions

- D-01 Fix the rules at their source in the Plan3 prompt constants; no new lint. Source: agent proposal under the repo's Code-First Workflow Rule, narrowed by D-04.
- D-02 Keep the 200-character step-line limit and its lint; the wording says detail goes to sub-bullets, not extra steps. Source: agent proposal.
- D-03 Sizing (Tiny / Plan / Map) is out of scope: the problem is the step count once something is a plan. Source: user, Q-01 answer.
- D-04 Wording only, no step budget or lint that forces a number. Split logically, neither oversplit (not every command a slice with its own tests) nor undersplit (two days of work is not one step). Bug reports: one step per report, plus one final testing step when there are several. Source: user, Q-02 answer.
- D-05 Full suite before completion and before release; each step runs its targeted tests only. Source: user, Q-03 answer. Agent reading: one run on an unchanged final state covers both.
- D-06 Benchmark: small fixture, plan and execute, 2 repetitions per arm. The rules serve every project: base them on as many recent plans as available. Source: user, Q-04 answer.
- D-07 Use Astra's wording (rule sources 1–7) as the starting text, with two corrections to the earlier draft: standalone final-check, qualification, experiment and requested-deployment steps stay allowed; review findings move to Backlog unless they address a requirement, safety risk or acceptance gap (not only "a correctness bug"). Source: Astra audit, adopted by the agent; not yet confirmed by the user.
- D-08 No in-prompt example list; at most the one-line bug-batch example inside `PLAN_SHAPE`. Source: Astra audit (prompt cost), agent agrees.
- D-09 Execution benchmark skipped; S2 is judged on plan shape and the two quality-control re-plans only, and the execution cost of the new rules is unmeasured. Round 1 stalled on the review dialog in 3 of 4 runs (no pi-subagents in `--ce-workflow` runs); the rerun hit the ChatGPT usage limit with 0 tokens. Source: user, after the rerun failed.


## Open questions

### Blocking

None.

### Deferred

None recorded.

## Relevant files and approach

- `extensions/plan3.ts` — **fits**: all plan-shaping rules are prompt constants in this one module. Edits: `PLAN_SHAPE`, `PROJECT_CARE` (prefactor and ordering sentences), `THINK_RULE` own-phase clause, `OPTIMIZE_RULES` 4, 6 and 8, execute prompt check cadence, `advisorPrompt` review body. No parsing, sizing, model routing or lint changes.
- `extensions/test-sensitivity.ts` — **fits**: one sentence in `TEST_SENSITIVITY`. It is in the system prompt every turn: keep the edit short.
- `scripts/test-work-plan3.mjs`, `scripts/test-work-test-sensitivity.mjs` — existing tests; pin the new key phrases and the removed ones.
- Benchmark: `scripts/skills-lab.mjs` with a new bug-batch task under `docs/proposals/skills-lab/tasks/`, compared with `scripts/compare-benchmark-runs.mjs`.

## Checks

- C1: `node scripts/test-work-plan3.mjs`
- C2: `node scripts/test-work-test-sensitivity.mjs`
- C3: `node scripts/skills-lab.mjs <run> --task <bug-batch task> --arm <arm> --reps 2`, then `node scripts/compare-benchmark-runs.mjs <baseline> <candidate>` (exact form settled in S2)

## Phases

### Phase 1: Rules [code]

  - note: Baseline commit for S2: daf9682d
- [x] **S1** Plan-shaping, cadence, review and proof wording rewritten per D-07 (plan3.ts, test-sensitivity.ts, advisor agent, README); C1 and C2 pin it

### Phase 2: Measure [think]

- [x] **S2** Plan shape on three-bug fixture: base 3 steps, cand 4 (adds the shared final check); QC re-plans keep their boundaries (migration 7 vs 8, experiment 3 vs 3); execution cost unmeasured (D-09)

## Backlog

- Belot `docs/bugreports.md` step 3: size each bug batch first. Mac repo; hand to the belot/1 session.
- Mac: raise or bypass Hypa's 30-second inner command limit (25–47 min of polling per plan); trace its setting on the Mac.
- Belot tests that pin exact milliseconds: assert ordering and behavior instead of tuning constants.
- Plans that test only desktop and headless browser while the reported bugs show on real phones: a device-run step when the bug was seen on a device.
- ARCH-RECONCILE: code appends a whole phase when a product diagram exists; consider folding it into the final step.

## Global validation

- C1 and C2 pass.
- S2: fewer steps and test commands on the fixture, every bug fixed with a test, no material regression in runtime, tokens, cost, turns or tool calls, and the two quality-control plans keep their boundaries.

## Resume context

S1 done (75db6ce9). S2 running: 4 rework-lab runs c468-{base,cand}-{1,2} (fixture C:/SOFT/git/rework-lab/fixtures/three-bugs @8170ecc, hidden check three-bugs-check.mjs) and 2 plan-only QC runs c468-qc-{migration,experiment} (candidate rules), all under C:/SOFT/git/rework-lab. Arms load ce-workflow worktrees .pi/bench-wt/base (daf9682d) and cand (75db6ce9) via new rework-lab --ce-workflow. Next: when runs finish, count steps, phases and test commands per plan, build results.json per arm, run compare-benchmark-runs, judge QC plans, record verdict. No blockers.

## Amendments

- 2026-11-17: Earlier S1 (plan shape) and S2 (test cadence) merged into S1: one module, one outcome. The earlier "no check-only steps" and "Backlog unless a correctness bug" requirements were narrowed per the Astra audit (D-07). Sizing and lint removed from scope (D-03, D-04).
- S1 also updated `utility-agents/plan3-advisor.md` (the advisor's own review checklist, same redundancy and Backlog wording) and README's check-cadence line, which carried the same old phrases. Wide-refactor staging keeps its "(add the new form beside the old)" and "(remove the old)" explanations, which Astra's draft dropped.
