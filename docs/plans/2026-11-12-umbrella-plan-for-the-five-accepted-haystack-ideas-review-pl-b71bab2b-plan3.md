---
plan3: true
status: active
created: 2026-11-12
updated: 2026-11-12T22:41:55.597Z
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

- [ ] **HU-01** Write the compare script and its self-check; document it in the Optimization Regression Rule.
  - Pairs by `repetition`; per pair runtime, total tokens, cost, turns, tool calls and deltas; incomplete pairs (missing, error, not completed, duplicate) marked and left out of totals. Check: C1.

### Phase 2: Runaway allowance [code]

- [ ] **HU-02** Build `extensions/run-budget.ts` per D-03 to D-06, wire it into plan3 and night mode, with the setting and its test.
  - Check: C2 covers reminder once, block at limit, progress reset, extension input no reset, restore keeps count, git change resets. Keep: safety feature, no benchmark needed.

### Phase 3: Compaction summaries [think]

- [ ] **HU-03** Baseline: add fallback reasons per mode to `scripts/audit-compaction.mjs`; record rates over recent sessions.
- [ ] **HU-04** Add the exact-identifier and absence rules and the error feedback on the second attempt (D-07); C3 green.
- [ ] **HU-05** Measure old against new on replayed real compaction inputs; keep or revert by the Optimization Regression Rule.
  - Bounded paid calls; record accepted summaries, fallbacks, tokens, cost and time for both.

### Phase 4: Checkpoint pruning [think]

- [ ] **HU-06** Token-free: in recent Ultrafull compactions, how much of the kept tail is tool output older than the newest step.
  - Drop if pruning could add little (record the share); otherwise add build and benchmark steps.

### Phase 5: Offloading [think]

- [ ] **HU-07** Token-free: how many tokens large non-bash tool results take in recent sessions; drop if small, otherwise add steps.

### Phase 6: Records [code]

- [ ] **HU-08** Update ledger, CHANGELOG Unreleased and catch-up entry for kept ideas; delete the five drafts; note the old runaway plan.

## Global validation

- C1, C2 and C3 pass; LSP clean on touched `.ts` files.
- Every idea has a keep or drop line with numbers in Decisions and in `docs/upstream/haystack.md`.
- Nothing pushed; unrelated dirty files untouched.

## Resume context

Plan written; next HU-01.

## Amendments

Append material changes and their reasons; preserve the original request and settled decisions.
