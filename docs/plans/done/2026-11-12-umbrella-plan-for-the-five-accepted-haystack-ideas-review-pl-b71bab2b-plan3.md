---
plan3: true
status: complete
created: 2026-11-12
updated: 2026-11-12T22:50:32.518Z
---

# Build or drop the five accepted Haystack ideas

## Original request

> I want one umbrella plan for all five, review the plan, decide keep/not keep and implement, I'm gonna go sleep

Context: the five ideas accepted in the Haystack review (plan 2af79ca5, archived; review `docs/proposals/2026-11-12-haystack-review.md`; ledger `docs/upstream/haystack.md`), each seeded as its own draft (0c43697c, 5bd4eebd, 83818785, ac641457, 1feda303). The agent suggested the order below and asked "one umbrella plan with a keep/revert gate on each?"; the user chose the umbrella and asked for it to run unattended.

## Goal, requirements, and non-goals

Goal: for each idea, measure first, decide keep or drop with numbers, build only what is kept, and record the outcome.

Requirements (from the accepted ideas):

- R1 Benchmark comparison: pairs runs by identity; failed or missing runs show as incomplete, never as zero cost or success.
- R2 Runaway runs: an unattended run stops at an allowance after one advance reminder; compaction, retry, reload and automatic continuations never reset it.
- R3 Compaction summaries: fallbacks drop measurably with no overall regression in runtime, tokens, cost, turns or tool calls.
- R4 Checkpoint pruning: kept only if it keeps more recent turns verbatim without raising re-calls, tokens or cost overall.
- R5 Offloading: kept only if it lowers total tokens with no overall regression and no saved data outliving its session.
- R6 Every keep or drop has its numbers in Decisions and the ledger; dropped ideas leave no code behind.

Non-goals: the rest of the old runaway plan (`docs/plans/2026-09-27-001-fix-unbounded-direct-agent-runs-plan.md` P2 to P4: persistence redesign, stagnation detection by repeated calls, progress checkpoints); a cost ceiling across subagents; any push.

Acceptance examples:

- `node scripts/compare-benchmark-runs.mjs base.json cand.json` with a candidate whose repetition 2 threw prints that pair as "incomplete" and leaves it out of the totals, which state "2 of 3 pairs complete".
- A session that makes 140 turns without an edit, write or plan3 call and without a working-tree change gets one reminder; at 150 further tool calls are blocked with the reason, and night mode pauses with "run budget reached".
- An ordinary 1000-turn night run that edits files every few turns never sees the reminder.

## Decisions

- **D-01 One umbrella plan, unattended.** Source: user, 2026-11-12 ("one umbrella plan for all five ... decide keep/not keep and implement, I'm gonna go sleep"). The user's request also authorizes moving this draft to ready and executing it without /plan3 finish.
- **D-02 Order: compare script, runaway allowance, compaction summaries, checkpoint pruning, offloading.** The compare script serves the later keep decisions; the last two start with a token-free measurement and stop there if the gain is small. Source: agent proposal accepted by the user.
- **D-03 The allowance counts turns without progress, not all turns.** Evidence from local sessions (last 60 to 90 days, `%TEMP%/hs/stall.mjs`-style replay): turns per human message reach p99 641 and 1386 in legitimate long runs, so a plain turn cap would stop real work. Turns without an edit, write, plan3 call or mutating shell command: p50 2, p99 29, p99.9 54, maximum 112 in 15,256 gaps. The incident had 363 turns without edits. Default limit 150, reminder at 140. Source: agent measurement; numbers approximate (shell mutation is detected by pattern).
- **D-04 Progress means a successful edit, write or plan3 call, or a changed working tree.** The working tree is checked with git only at the reminder and at the limit, so bash mutations count without a git call per turn. Source: agent design.
- **D-05 Only a human message resets the count** (Pi `input` source interactive or rpc); extension messages, night continuations, compaction and reload do not. The count is saved as a session entry. Source: agent design from R2.
- **D-06 At the limit, block further tool calls with the reason** instead of aborting mid-reply; the model ends its reply and night mode pauses with "run budget reached". Source: agent design (a blocked tool is a safe boundary; abort can cut a write).
- **D-07 Compaction trial keeps two model calls at most.** The error feedback goes into the existing second attempt; no third call. Source: Astra's idea 5 and the accepted idea.
- **D-08 Compaction summaries: dropped.** Since e608f526 (2026-10-24, the change that gives the checkpoint real room), 1 of 541 model compactions fell back (0.2%). The first attempt failed in 9, of which 7 were invalid JSON/schema, and the second model rescued all 7. The old 12% (42 of 900 since 2026-10-15) was mostly "Memory budget exceeded" and is already fixed. Error feedback has nothing left to fix. The identifier and absence rules have no measured failure to test against, so a paid replay would measure noise. Source: agent measurement (`%TEMP%/hs/fb3.mjs` replay of compaction `details.compactionAttempts`).
- **D-09 Ultrafull checkpoint pruning: dropped.** In 278 Ultrafull compactions since 2026-10-25, tool results older than the last 5 turns make up 23% of the kept tail (p50 21%, p90 38%), but cutting each one over 2k characters to 600 saves only 6% of the tail. Pruning everything old would discard the verbatim evidence the tail exists to keep. Source: agent measurement (`%TEMP%/hs/tail.mjs`).
- **D-10 Large-result offloading: dropped.** Since 2026-10-25, results over 20k characters from the tools in scope (subagent, browser_fetch, jev, fetch) take 0% of tool-result characters; codemode takes 0.8%. Large `read` results take 20.7%, but the file is already on disk, and Ultracompact already cuts giant results. Ultrafull deliberately keeps context unchanged. Source: agent measurement (`%TEMP%/hs/big.mjs`, 58,396 results).
- **D-11 Haystack catch-up watch: not added.** Kept: the compare script (A14, idea only, no upstream code) and the run allowance (re-implemented from the step-budget idea). Neither tracks Haystack code, so per the review decision (watch only adopted paths) there is no path to watch. Source: agent, from the 2af79ca5 record.


## Open questions

### Blocking

None.

### Deferred

- **Q-01** Is 150 turns without progress the right default limit?
  - Context: D-03 numbers: legitimate maximum 112 in 90 days, p99.9 54; the incident reached 363. The limit is a setting (`runBudget.turns` in the ce-workflow settings file), 0 turns it off.
  - Recommendation: keep 150 until a legitimate run hits it.
  - Option: 150 (picked) — no legitimate run in 90 days would have stopped; the incident would have stopped at about 40% of its cost.
  - Option: 100 — stops loops sooner; one legitimate run in 90 days (112) would have been stopped.
  - Option: Off by default — no false stops, no protection.
  - Independent: yes

## Relevant files and approach

- Compare script: new `scripts/compare-benchmark-runs.mjs`, self-check `scripts/test-compare-benchmark-runs.mjs`; input shape from `scripts/benchmark-context-cache-live.mjs` (`results[]` with `repetition`, `completed`, `error`, `elapsedMs`, `turns`, `toolCalls`, `usage.totalTokens`, `usage.costUsd`).
- Runaway allowance: new `extensions/run-budget.ts`, registered from `extensions/plan3.ts`, night mode pause in `extensions/plan3-night.ts`, settings read like `extensions/work-models.ts` `readSettings`. Test `scripts/test-run-budget.mjs` with a fake `pi`.
- Compaction: `extensions/work-compaction-memory.ts` (`compactMemory`, prompt at line 238, `validateMemory` 174); audit `scripts/audit-compaction.mjs` and its test `scripts/test-audit-compaction.mjs`.
- Pruning: `extensions/work-compaction.ts` `tightenPreparation`; Ultrafull in `extensions/work-models.ts`.
- Offloading: giant-result cut in `extensions/work-models.ts` (`truncateGiantText`).
- Records: `docs/upstream/haystack.md`, `CHANGELOG.md` Unreleased, `extensions/work-catch-up-baseline.json` (only if something is kept), the five drafts (deleted, superseded by this plan), old runaway plan status line.

Commands:

- C1 `node scripts/test-compare-benchmark-runs.mjs`
- C2 `node scripts/test-run-budget.mjs`
- C3 `node scripts/test-work-compaction.mjs` and `node scripts/test-audit-compaction.mjs`
- C4 `node scripts/audit-compaction.mjs --since=2026-10-01`

## Phases

### Phase 1: Benchmark comparison [code]

- [x] **HU-01** KEPT: scripts/compare-benchmark-runs.mjs pairs runs by scenario+repetition, incomplete pairs excluded from totals; self-check added; named in the Optimization Regression Rule (9268f19e).

### Phase 2: Runaway allowance [code]

- [x] **HU-02** KEPT: extensions/run-budget.ts counts turns without progress (default 150, reminder at 140, setting runBudget.turns, 0=off), blocks tools at the limit, survives reload; night mode pauses "run budget reached"; /resume3 stop-check skips (067380a7).

### Phase 3: Compaction summaries [think]

- [x] **HU-03** Baseline: since e608f526 (2026-10-24) the compaction fallback rate is 1 of 541 (0.2%); the first attempt fails in 9 of 541, with 7 of those invalid JSON/schema and all 7 rescued by the second model. Before that it was 42 of 900 (mostly "Memory budget exceeded"), which explains the old 12%. The audit script is unchanged because the replay is enough.
- [x] **HU-04** DROPPED: error feedback has nothing left to fix, since only 1 fallback occurred in 541 compactions after e608f526. The exact-identifier and absence rules have no failure signal to measure against, so they are not built (D-08).
- [x] **HU-05** DROPPED with HU-04: there is no change to measure, so no paid replay was run (D-08).

### Phase 4: Checkpoint pruning [think]

- [x] **HU-06** DROPPED (D-09): old tool output makes up 23% of the Ultrafull kept tail, but a safe cut saves only 6%.

### Phase 5: Offloading [think]

- [x] **HU-07** DROPPED (D-10): large results from in-scope non-bash tools are 0% of tool-result characters (codemode 0.8%).

### Phase 6: Records [code]

- [x] **HU-08** Records: the ledger now has Adopted (A14, A3) and Dropped (A1/A5, A1, A2) with reasons, plus no watch (D-11). Two Unreleased bullets are in the CHANGELOG. The five per-idea drafts are deleted, and the old runaway plan's status notes that run-budget supersedes P1.

## Global validation

- C1, C2 and C3 pass; LSP clean on touched `.ts` files.
- Every idea has a keep or drop line with numbers in Decisions and in `docs/upstream/haystack.md`.
- Nothing pushed; unrelated dirty files untouched.

## Resume context

All steps done. Two ideas were kept (compare script, run allowance); three were dropped after measurement (D-08 to D-10). Committed locally, not pushed.

## Amendments

Append material changes and their reasons; preserve the original request and settled decisions.
