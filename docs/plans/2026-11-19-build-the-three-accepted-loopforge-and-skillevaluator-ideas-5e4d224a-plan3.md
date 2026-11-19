---
plan3: true
status: draft
created: 2026-11-19
updated: 2026-11-19T21:29:08.688Z
---

# Build the three accepted LoopForge and SkillEvaluator ideas

## Original request

> Build the three ideas accepted in the LoopForge / Claude-BugHunter / SkillEvaluator review (plan 3f8f9ab7, review docs/proposals/2026-11-19-loopforge-bughunter-skillevaluator-review.md): S5 honest small-sample benchmark and judge results (SkillEvaluator), L13 quiet-process notice in the hub (LoopForge), L3 post-plan retro digest tested first on finished plans across several models with recommendations for the project flow and for ce-workflow (LoopForge). One phase per idea.

The user's comment on L3 at idea review (verbatim): "can we also do trials from the already finished plans, stuff is recorded right? test the different models, I guess the thinker ones will perform better here. the outcome can be 2 sided tho - improvement in the project flow and improvement in ce-wf".

## Goal, requirements, and non-goals

**Goal:** build the three ideas the user accepted in plan `3f8f9ab7` (umbrella plan, D-03 there), each re-implemented in our code.

Requirements (moved from the mining plan, wording as accepted):

- R1 (IDEA-b08832b1, S5): benchmark comparisons and judge summaries show sample counts, judge errors apart from failures, and say when the sample cannot separate the arms.
- R2 (IDEA-2f20a933, L13): a running command that has printed nothing for a while is shown as quiet, with its last output line, without stopping it.
- R3 (IDEA-cec728e2, L3): when a plan finishes, the user gets a short evidence-cited retro from its stats, kept only if a trial shows useful recommendations. As changed by the user: the trial runs offline on already finished plans, compares several models including thinking ones, and tags each recommendation as project flow or ce-workflow.
- R4: when an idea is built, its upstream ledger moves it from Pending to Adopted (or Dropped after measurement) and `extensions/work-catch-up-baseline.json` gets a scoped `kind: "git"` entry only if code was ported (mining plan D-09).

Non-goals:

- S6 judge calibration: rejected by the user at idea review (IDEA-2aa23198). Do not add labelled judge sets here.
- Killing quiet processes (L13 is display only; LoopForge's kill policy was explicitly not adopted).
- A placebo arm, pass@k or bootstrap machinery beyond the Wilson interval for binary outcomes (S5 scope).
- The dropped-but-uncovered ideas (L2, L6, L12, B3, S4, S8, S10); see the review doc.

## Decisions

- **D-01 One umbrella plan, one phase per idea.** Source: user, mining plan 3f8f9ab7 D-03.
- **D-02 Re-implement by default; a port carries the source file's license and notice.** LoopForge is MIT with listed third-party exceptions; SkillEvaluator Apache-2.0 with NOTICE. Source: user, mining plan D-04.
- **D-03 Catch-up watch only when a port is built.** Source: user, mining plan D-09 and Q-01.
- **D-04 L3 trial runs offline on finished plans, several models, two-sided recommendations.** Source: user comment at idea review (above). Replaces the original "trial on the next 5-10 finishes".
- **D-05 L13 is display only, never a kill.** Source: idea as accepted; Astra's review also said "warning, not kill".

## Open questions

### Blocking

None.

### Deferred

- **Q-01** Which models does the L3 retro trial compare?
  - Context: the user expects thinking models to do better. Candidates already used here: GPT-6 Luna (cheap), Terra, gpt-6.2-astra high, Opus 5.5. Price per call matters only if the retro runs on every plan finish.
  - Recommendation: Luna, Terra, gpt-6.2-astra high and Opus 5.5 (two cheap, two thinking), on the same digests.
  - Option: Four models — Luna, Terra, Astra 6.2 high, Opus 5.5; best coverage, a few dollars.
  - Option: Two thinking models only — Astra 6.2 high and Opus 5.5; cheaper trial, no cheap baseline.
  - Independent: yes
- **Q-02** How many finished plans go into the L3 trial?
  - Context: 37 `docs/plans/logs/*.stats.json` exist (34 tracked) and 50 plans in `docs/plans/done/`; not every done plan has stats. The user scores a sample blind.
  - Recommendation: 8 plans with stats, mixed sizes, so scoring stays within about half an hour.
  - Option: 8 plans — quick to score.
  - Option: All plans with stats — more evidence, much more scoring.
  - Independent: yes

## Relevant files and approach

Review with evidence and both reviewers' verdicts: `docs/proposals/2026-11-19-loopforge-bughunter-skillevaluator-review.md`; Astra: `docs/proposals/repo-review-3f8f9ab7/astra-verdicts.md`. Upstream clones at the mining plan's pins under `C:\SOFT\git\repo-review\<repo>`: LoopForge `6f606cf2a7354f05d1dbf2085f4eb832b7e89ccb`, SkillEvaluator `d8ddd4f76de78dfc3425d0a829d2c7dc9ccb9037`.

- **S5.** `scripts/compare-benchmark-runs.mjs` (pairs by scenario and rep, drops incomplete pairs; prints no intervals), test `scripts/test-compare-benchmark-runs.mjs` (in `scripts/verify-package.mjs:112`). Judges `scripts/judge-handoff.mjs:49` (JSON array parse, no retry) and `scripts/judge-design-extras.mjs:42,51,78` (boolean array, rejects unparsable verdict, prints bare rates). Idea source: SkillEvaluator `docs/metrics-reference.mdx:24-27,58,191-193,289-290,412,578,607,638`.
- **L13.** Tool rows: `extensions/plan3-web.ts:144-148` already handles `tool_execution_start`, `tool_execution_update` (partial output) and `tool_execution_end`; the hub reacts to tool events in `hub/src/view.ts:73` and draws chat tool blocks from `hub/src/chat.ts:69-92`. Tests: `scripts/test-work-plan3-web.mjs`; hub page checks in `hub/scripts/test-browser.mjs`. Idea source: LoopForge `internal/procwatch/procwatch.go:60`. Measured gap: 17,930 bash calls, 94.5% with a timeout, 75 (0.4%) timed out.
- **L3.** Stats: `extensions/plan3-stats.ts` (`recordCommand` :58, `recordReply` :72, `statsItems` :222-262 incl. slowest commands and speed hints), per-plan `docs/plans/logs/<id>.stats.json` plus sidecar `docs/plans/logs/<id>.md`; test `scripts/test-work-plan3-stats.mjs`. Idea source: LoopForge `internal/runeval/facts.go:72`, `internal/domain/run_eval.go:40`, `internal/runeval/apply.go:10`. Earlier asks: skills-lab `results.md:55-64`, plan 79614d24 backlog line 233.

Commands: targeted tests only (`node scripts/test-compare-benchmark-runs.mjs`, `node scripts/test-work-plan3-web.mjs`, `node scripts/test-work-plan3-stats.mjs`, `node hub/scripts/test-browser.mjs`); push rules per AGENTS.md (version bump and changelog only on push).

## Phases

### Phase 1: Honest small-sample results (S5) [code]

- [ ] **UB-01** compare-benchmark-runs.mjs: distinct cases, both-direction pair counts, unscored/error counts, Wilson intervals and a 'not established' line
  - Fixture self-check in `scripts/test-compare-benchmark-runs.mjs`: duplicate reps, a judge timeout and an N/A metric must not add independent cases or count as quality failures.
- [ ] **UB-02** judge-handoff.mjs and judge-design-extras.mjs: reply shape check, one retry, judge error and N/A apart from failures, intervals on rates
  - Self-check on canned judge replies (valid, invalid then valid, invalid twice); no paid calls.

### Phase 2: Quiet-process notice (L13) [code]

- [ ] **UB-03** Track last-output time per running bash call and show 'quiet for N min' plus the last line on its tool row past a threshold
  - Display only (D-05); threshold about 120 s; fake-clock self-check in `scripts/test-work-plan3-web.mjs` or the hub test that owns the row.
  - Check in the headless hub (agent-browser + screen_read) with a command that sleeps silently past a lowered test threshold.

### Phase 3: Post-plan retro trial (L3) [think]

- [ ] **UB-04** Code-only digest from a plan's stats.json and sidecar log: repeated and failed commands, slowest steps, wait share, retries
  - Fixture self-check in `scripts/test-work-plan3-stats.mjs`; no model call.
- [ ] **UB-05** Offline trial on finished plans: digest plus retro prompt on the Q-01 models; each recommendation tagged project flow or ce-workflow, citing digest lines
  - Plans chosen per Q-02; outputs blinded by model before scoring.
- [ ] **UB-06** [human] User scores a blinded sample useful or not; pick the model by useful count and cost; record in the log and decide keep or drop
  - Ask with the numbers then: keep with model X, or drop the retro.
- [ ] **UB-07** If kept: run the retro at plan finish with the chosen model, at most 3 cited recommendations per side, to the sidecar log plus one notice

### Phase 4: Records [code]

- [ ] **UB-08** Update docs/upstream/loopforge.md and skillevaluator.md (Pending to Adopted or Dropped, with evidence); catch-up entry only for ports (D-03)

## Global validation

- R1 to R4 hold; the targeted tests above pass after each step; the hub check for UB-03 was observed in a headless browser.
- No paid runs except UB-05's trial (and any rerun the user approves).

## Resume context

Draft written from mining plan 3f8f9ab7 RR-07. Next: user runs /plan3 resolve (Q-01, Q-02) and /plan3 finish; then UB-01.

## Amendments

- 2026-11-19: created from mining plan 3f8f9ab7; requirements and build steps for IDEA-b08832b1, IDEA-2f20a933 and IDEA-cec728e2 moved here from that plan (idea records and decisions stay there).
