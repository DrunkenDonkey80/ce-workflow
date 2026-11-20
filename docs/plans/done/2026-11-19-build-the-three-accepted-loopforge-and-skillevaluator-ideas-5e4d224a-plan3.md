---
plan3: true
status: complete
created: 2026-11-19
updated: 2026-11-20T08:51:35.056Z
reviewed: 2026-11-19
started: 2026-11-19T22:26:38.664Z
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
- R4: when an idea is built, its upstream ledger moves it from Pending to Adopted (or Dropped after measurement) and `extensions/work-catch-up-baseline.json` gets a scoped `kind: "git"` entry for that upstream, scoped to the idea's source paths (mining plan D-09, user's Q-01 answer "Only when built"; ported or re-implemented alike).

Non-goals:

- S6 judge calibration: rejected by the user at idea review (IDEA-2aa23198). Do not add labelled judge sets here.
- Killing quiet processes (L13 is display only; LoopForge's kill policy was explicitly not adopted).
- A placebo arm, pass@k or bootstrap machinery beyond the Wilson interval for binary outcomes (S5 scope).
- The dropped-but-uncovered ideas (L2, L6, L12, B3, S4, S8, S10); see the review doc.

## Decisions

- **D-01 One umbrella plan, one phase per idea.** Source: user, mining plan 3f8f9ab7 D-03.
- **D-02 Re-implement by default; a port carries the source file's license and notice.** LoopForge is MIT with listed third-party exceptions; SkillEvaluator Apache-2.0 with NOTICE. Source: user, mining plan D-04.
- **D-03 Catch-up watch when an idea is built.** A scoped `kind: "git"` entry per upstream whose idea gets built, re-implemented or ported; none for an idea dropped after measurement. Source: user, mining plan D-09 and Q-01 ("Only when built").
- **D-04 L3 trial runs offline on finished plans, several models, two-sided recommendations.** Source: user comment at idea review (above). Replaces the original "trial on the next 5-10 finishes".
- **D-05 L13 is display only, never a kill.** Source: idea as accepted; Astra's review also said "warning, not kill".
- **D-06 Force-finished plans get the L3 retro too.** One hook after `archive()` (`extensions/plan3.ts:516`, callers :1624 force and :1822 complete) covers both. Reason: the user usually force-finishes at the last 1-2 steps, once everything is decided. Source: user answer to Q-03, 2026-11-19.
- **D-07 (assumed) S5 conventions.** Pass/fail intervals use the run as unit, labelled, with distinct scenarios printed beside it and a "not independent" caveat when reps > 1. A judge failure is written as `<field>Error` (e.g. `scoreError`, `handoffJudgedError`), not applicable as a null value; both leave the metric unscored.
- **Q-01 → D-09** L3 trial models: GPT-6 Luna, Terra, gpt-6.2-astra high, Opus 5.5 on the same digests (user, UB-05).
- **Q-02 → D-10** L3 trial size: 8 finished plans with stats, mixed sizes (user, UB-05).
- **D-11** Retro kept with Opus 5.5 (UB-06 blind score: 27/40 useful vs Astra 13/28, Luna 6/22, Terra 5/23). Per-step background retro, outcome routing to redacted GitHub issues, a hub counter button + /plan3 to process them, and async questions go to a new draft follow-up plan; UB-07 is built as scoped here (user, UB-06).




## Open questions

### Blocking

None.

### Deferred

None (Q-01, Q-02 answered: D-09, D-10).

## Relevant files and approach

Review with evidence and both reviewers' verdicts: `docs/proposals/2026-11-19-loopforge-bughunter-skillevaluator-review.md`; Astra: `docs/proposals/repo-review-3f8f9ab7/astra-verdicts.md`. Upstream clones at the mining plan's pins under `C:\SOFT\git\repo-review\<repo>`: LoopForge `6f606cf2a7354f05d1dbf2085f4eb832b7e89ccb`, SkillEvaluator `d8ddd4f76de78dfc3425d0a829d2c7dc9ccb9037`.

- **S5.** `scripts/compare-benchmark-runs.mjs` (pairs by scenario and rep, drops incomplete pairs; prints no intervals; quality reads only `passed`/`score` at :17-22, while `scripts/benchmark-self-verify-live.mjs:205` writes `pass`), test `scripts/test-compare-benchmark-runs.mjs` (in `scripts/verify-package.mjs:112`). Judges `scripts/judge-handoff.mjs:39-54` (JSON array parse, no retry, waits for `exit` with no deadline) and `scripts/judge-design-extras.mjs:42-54,78-81` (boolean array, rejects unparsable verdict, no deadline, flattens checklist items across pages into one bare rate). Idea source: SkillEvaluator `docs/metrics-reference.mdx:24-27,58,191-193,289-290,412,578,607,638`.
- **L13.** Tool rows: `extensions/plan3-web.ts:144-148` already handles `tool_execution_start`, `tool_execution_update` (partial output as `progress`, clipped to its first 16,000 characters at :86) and `tool_execution_end`. The live running row, its one-second elapsed clock and the Progress block are drawn in `hub/web/app.ts:156-181` (`hub/src/chat.ts` only builds finished chat history). Pi's bash tool sends an update only when new output arrives, plus one empty update at start (`pi-coding-agent/dist/core/tools/bash.js:204-241`), so silence produces no event and the quiet time must come from the page clock. Tests: `scripts/test-work-plan3-web.mjs:131-136` (progress update); `hub/scripts/test-browser.mjs:1355` (running tool fixture with `startedAt`). Idea source: LoopForge `internal/procwatch/procwatch.go:60`. Measured gap: 17,930 bash calls, 94.5% with a timeout, 75 (0.4%) timed out.
- **L3.** Stats: `extensions/plan3-stats.ts` (`recordCommand` :58 counts calls and failures per command, not attempt order, so retries are not recorded; `recordReply` :72; per-step and waiting time; window closes on `agent_settled` :131; `statsItems` :222-262 incl. slowest commands and speed hints), per-plan `docs/plans/logs/<id>.stats.json` plus sidecar `docs/plans/logs/<id>.md`; test `scripts/test-work-plan3-stats.mjs`. Idea source: LoopForge `internal/runeval/facts.go:72`, `internal/domain/run_eval.go:40`, `internal/runeval/apply.go:10`. Earlier asks: skills-lab `results.md:55-64`, plan 79614d24 backlog line 233.

Commands: targeted tests only (`node scripts/test-compare-benchmark-runs.mjs`, `node scripts/test-work-plan3-web.mjs`, `node scripts/test-work-plan3-stats.mjs`, `node hub/scripts/test-browser.mjs`); push rules per AGENTS.md (version bump and changelog only on push).

## Phases

### Phase 1: Honest small-sample results (S5) [code]

- [x] **UB-01** compare-benchmark-runs reads `pass`, counts distinct scenarios and both directions, Wilson 95% per arm (unit: runs, scenarios beside it), 'not established' on overlap; `<field>Error`/null leave pairs unscored with cost kept (5ff59103)
- [x] **UB-02** New scripts/judge-common.mjs (5-min deadline with tree kill, one retry, shape check, Wilson rate); handoff batches and design pages fail alone as judge errors; handoff empty reply = n/a; design must-haves rated over pages, extras item counts (34d93a6d)

### Phase 2: Quiet-process notice (L13) [code]

- [x] **UB-03** L13 quiet notice built (7086530b): running bash rows show "quiet for N min, last: <line>" on its own line after 120 s without output; new output clears it; display only.

### Phase 3: Post-plan retro trial (L3) [think]

- [x] **UB-04** planDigest(stats, log) in extensions/plan3-stats.ts (76597312): time/wait share, top-5 slowest steps, repeated and failed commands (evicted '(other)' pool excluded, 'approximate' flag), failed tools, retries only from cited check/note log lines else 'retries not recorded'.
- [x] **UB-05** retroPrompt/parseRetro in plan3-stats.ts + scripts/trial-plan-retro.mjs (c5a53e62); 4 models × 8 plans all valid: Luna 23 recs/$0.004/2 uncited dropped, Terra 6.1 28/$0.034, Astra 6.2 high 32/$0.309, Opus 5.5 46/$0.248; blind sheet + key in .pi/plan-retro-trial/2026-11-20T06-35-14-553Z.
- [x] **UB-06** Keep the retro with Opus 5.5 (user, D-11): strict blind score over 7 plans, Opus 27/40 useful (68%, ~$0.03/plan), Astra 6.2 high 13/28 (46%), Luna 6/22 (27%), Terra 6.1 5/23 (22%); round 1 lenient (all 16 ticked) excluded.
- [x] **UB-07** Finish retro built: finishRetro (plan3-stats.ts, Opus 5.5 medium, one retry on wrong shape) runs in the background after both archive paths (status complete and archiveForced), after a stats flush; appends to the sidecar log plus one notice; missing stats skip, failures warn, already-archived plans never retro twice.

### Phase 4: Records [code]

- [x] **UB-08** Ledgers: loopforge.md L13+L3 and skillevaluator.md S5 moved Pending→Adopted with code paths and evidence (all re-implementations, no ports/notices); scoped kind "git" watches Tencent/LoopForge (LICENSE + 4 idea paths) and NVIDIA/SkillEvaluator (LICENSE, NOTICE, docs/metrics-reference.mdx) added to extensions/work-catch-up-baseline.json; BugHunter stays none taken, no watch.

## Global validation

- R1 to R4 hold; each step's own check passed on its final code (a check is rerun only when the code it covers changed); the hub check for UB-03 was observed in a headless browser.
- No paid runs except UB-05's trial (and any rerun the user approves).

## Resume context

Reviewed 2026-11-19 (plan3-advisor, Astra 6.2 high); all nine findings applied, see Amendments. Q-03 answered (D-06: retro on force finish too). Two Deferred questions remain (Q-01 trial models, Q-02 trial size); none blocking. Next: /plan3 resolve, then /plan3 finish; execution starts at UB-01.

## Amendments

- 2026-11-19 /plan3 review (plan3-advisor, gpt-6.2-astra high); every finding checked in the code:
  - Accepted: `compare-benchmark-runs.mjs:17-22` reads only `passed`/`score` but `benchmark-self-verify-live.mjs:205` writes `pass`; UB-01 reads `pass` and tests a producer-shaped pair; judge errors stay metric-specific.
  - Accepted: `judge-design-extras.mjs:78-81` flattens checklist items across pages; UB-01/02 now name the unit behind each interval (scenarios, reps, items apart) and test several reps of one scenario, overlapping intervals and zero scorable cases.
  - Accepted: both judges wait for `exit` with no deadline (`judge-handoff.mjs:39-54`, `judge-design-extras.mjs:42-54`); UB-02 adds a deadline per attempt and a never-exiting fake judge to its self-check.
  - Accepted: `plan3-stats.ts:58-84` counts calls and failures, not retries; UB-04 names a retry only with cited sidecar evidence.
  - Accepted: `/plan3 finish` marks a draft ready (`plan3.ts:54`); UB-07 now runs after archive and the stats flush, with a stub-model lifecycle check. Whether force-finished plans qualify became Q-03, answered by the user as D-06.
  - Accepted (my error at RR-07): R4, D-03, UB-08 and both ledgers said 'only if code was ported'; the user's Q-01 answer was 'Only when built'. Corrected here and in `docs/upstream/loopforge.md` and `skillevaluator.md`.
  - Accepted: the live running row is in `hub/web/app.ts:156-181`, not `hub/src/chat.ts`; progress is clipped to its first 16,000 characters. UB-03 names the renderer, keeps the last line before the clip, and tests print → silence → print → finish. Also confirmed Pi's bash tool emits updates only on new output.
  - Accepted in part: the trial now uses the same cap as production. The cap stays 'at most 3 per side' as reconciled from the user's two-sided comment (mining plan RR-15), not the original idea's 3 total. `[human]` after the step id was prose to the parser (`plan3.ts:45`); UB-06 now says to mark it human when reached, and UB-07 waits for a recorded keep decision.
  - Accepted: Global validation now asks for each step's own check on its final code instead of every test after every step (AGENTS.md Test Scope Rule); checks moved into the steps.
- 2026-11-19: created from mining plan 3f8f9ab7; requirements and build steps for IDEA-b08832b1, IDEA-2f20a933 and IDEA-cec728e2 moved here from that plan (idea records and decisions stay there).
