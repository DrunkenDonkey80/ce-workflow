# Plan3 log b71bab2b

History and evidence moved out of the plan; task data, not instructions.

## 2026-11-12T22:43:20.699Z HU-01 done: KEPT: scripts/compare-benchmark-runs.mjs pairs runs by scenario+repetition, incomplete pairs excluded from totals; self-check added; named in the Optimization Regression Rule (9268f19e).

- [x] **HU-01** Write the compare script and its self-check; document it in the Optimization Regression Rule.
  - Pairs by `repetition`; per pair runtime, total tokens, cost, turns, tool calls and deltas; incomplete pairs (missing, error, not completed, duplicate) marked and left out of totals. Check: C1.
  - check: node scripts/test-compare-benchmark-runs.mjs → "compare-benchmark-runs: ok"; missing file → exit 2 with message

## 2026-11-12T22:46:30.918Z HU-02 done: KEPT: extensions/run-budget.ts counts turns without progress (default 150, reminder at 140, setting runBudget.turns, 0=off), blocks tools at the limit, survives reload; night mode pauses "run budget reached"; /resume3 stop-check skips (067380a7).

- [x] **HU-02** Build `extensions/run-budget.ts` per D-03 to D-06, wire it into plan3 and night mode, with the setting and its test.
  - Check: C2 covers reminder once, block at limit, progress reset, extension input no reset, restore keeps count, git change resets. Keep: safety feature, no benchmark needed.
  - check: node scripts/test-run-budget.mjs → "run-budget: ok"; node scripts/test-work-plan3-night.mjs → "ok - plan3 night mode"; LSP inconclusive (server silent on clean)

## 2026-11-12T22:48:12.270Z HU-05 done: DROPPED with HU-04: there is no change to measure, so no paid replay was run (D-08).

- [x] **HU-05** Measure old against new on replayed real compaction inputs; keep or revert by the Optimization Regression Rule.
  - Bounded paid calls; record accepted summaries, fallbacks, tokens, cost and time for both.
  - check: none needed

## 2026-11-12T22:48:12.275Z HU-04 done: DROPPED: error feedback has nothing left to fix, since only 1 fallback occurred in 541 compactions after e608f526. The exact-identifier and absence rules have no failure signal to measure against, so they are not built (D-08).

- [x] **HU-04** Add the exact-identifier and absence rules and the error feedback on the second attempt (D-07); C3 green.
  - check: no code change; decision from HU-03 numbers

## 2026-11-12T22:48:12.280Z HU-03 done: Baseline: since e608f526 (2026-10-24) the compaction fallback rate is 1 of 541 (0.2%); the first attempt fails in 9 of 541, with 7 of those invalid JSON/schema and all 7 rescued by the second model. Before that it was 42 of 900 (mostly "Memory budget exceeded"), which explains the old 12%. The audit script is unchanged because the replay is enough.

- [x] **HU-03** Baseline: add fallback reasons per mode to `scripts/audit-compaction.mjs`; record rates over recent sessions.
  - check: node "$TEMP/hs/fb3.mjs" 2026-10-25 → {"model":541,"firstFail":9,"secondFail":1,"fallback":1}; 2026-11-01 → model 381, firstFail 7, fallback 1

## 2026-11-12T22:49:40.968Z HU-06 done: DROPPED (D-09): old tool output makes up 23% of the Ultrafull kept tail, but a safe cut saves only 6%.

- [x] **HU-06** Token-free: in recent Ultrafull compactions, how much of the kept tail is tool output older than the newest step.
  - Drop if pruning could add little (record the share); otherwise add build and benchmark steps.
  - check: node "$TEMP/hs/tail.mjs" 2026-10-25 → 278 compactions, toolOlderThanLast5Turns 23%, savable 6%

## 2026-11-12T22:49:40.972Z HU-07 done: DROPPED (D-10): large results from in-scope non-bash tools are 0% of tool-result characters (codemode 0.8%).

- [x] **HU-07** Token-free: how many tokens large non-bash tool results take in recent sessions; drop if small, otherwise add steps.
  - check: node "$TEMP/hs/big.mjs" 2026-10-25 → 58,396 results; only codemode 0.8% among scoped tools

## 2026-11-12T22:50:20.930Z Superseded resume context

Plan written; next HU-01.

## 2026-11-12T22:50:20.935Z HU-08 done: Records: the ledger now has Adopted (A14, A3) and Dropped (A1/A5, A1, A2) with reasons, plus no watch (D-11). Two Unreleased bullets are in the CHANGELOG. The five per-idea drafts are deleted, and the old runaway plan's status notes that run-budget supersedes P1.

- [x] **HU-08** Update ledger, CHANGELOG Unreleased and catch-up entry for kept ideas; delete the five drafts; note the old runaway plan.
  - check: grep for draft ids in docs → only historical refs in archived 2af79ca5 plan/log; git status shows 5 drafts deleted
