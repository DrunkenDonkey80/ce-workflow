---
plan3: true
status: draft
created: 2026-11-08
updated: 2026-11-08T23:07:34.925Z
---

# Benchmark the Matt video experiments C1-C6

## Original request

> From the video-ideas pick (2026-11-09, ask_user): "C: plan the benchmarks: Create a Plan3 plan for C1-C6 (lower effort, 150k vs 200k, prototype HITL relab, prefix audit, pi-lens noise, mutations) without running them yet."
>
> The user approved this while leaving for the night ("do what you can without me"). Planning only: nothing below has been run.

## Goal, requirements, and non-goals

- Goal: one benchmark design per experiment C1-C6 from `docs/proposals/2026-11-09-matt-video-ideas.md` section C, each able to say keep or revert under the Optimization Regression Rule (AGENTS.md): same end-to-end workload, every continuation session aggregated, runtime, total provider tokens, cost, turns and tool calls compared with the last accepted baseline.
- Requirement: quality is measured with the change, not inferred from fewer turns (hidden tests, rubric or blind judge as in the skills lab).
- Requirement: live tests and benchmarks use the `ultrafull` compaction mode (AGENTS.md Compaction Mode in Tests Rule), except C2, which varies the Ultrafull threshold itself.
- Non-goal: running any benchmark in this plan's planning phase. Non-goal: B4 (map frontier), built only when a real map stalls.

## Decisions

- **D-01** Planning only for now; runs wait for the user's go. Source: user pick "C: plan the benchmarks … without running them yet", 2026-11-09.
- **D-02** Reuse the existing harnesses instead of new ones: `scripts/skills-lab.mjs` (isolated copies, arms, `results.jsonl`), `scripts/rework-lab.mjs` (unattended Plan3 over RPC on a throwaway clone), `scripts/lab-metrics.mjs` (tokens, cost, turns, tool calls incl. subagent children), `scripts/skills-lab-judge.mjs` (blind judge bundles). Source: agent proposal; these already produced the PC-09 and SK-08 results.
- **D-03** Every arm compares like with like: same task, same base commit, same model (`openai-codex/gpt-6.1-sol` as in the skills lab unless the experiment varies it), three reps per arm as in SK-08. Source: agent proposal, following `docs/proposals/skills-lab/results.md`.

## Open questions

### Blocking

- **Q-01** Which workload is the "accepted /resume3 benchmark" baseline for C1 and C2?
  - Context: the proposal names an accepted `/resume3` benchmark, but no single artifact is marked accepted. Candidates: the rework-lab runs (`docs/proposals/rework-lab/run-03..05.md`, multi-hour, Plan3 end to end) and the PC-09 planning requests (`docs/proposals/skills-lab/tasks/planning-requests.md`, planning only). C1 needs execution; C2 needs a session long enough to cross 150k.
  - Recommendation: a rework-lab run on the photobook fixture for both, since it executes and crosses 200k; record its numbers as the baseline in this plan before any arm runs.
  - Option: Rework-lab run — real execution, long sessions; slow and costly per rep.
  - Option: Skills-lab tasks — cheap, three reps easy; too short to reach 150k, so C2 would not trigger.
  - Option: Both — skills-lab for C1, rework-lab for C2.
  - Independent: yes
- **Q-02** C3 needs a human in the loop: who reacts to the prototypes?
  - Context: the SK-08 prototype arm ran unattended, so Matt's core loop (react, combine variants, iterate) never happened. A scripted reaction keeps runs comparable; a real human is closer to Matt's claim but varies per run.
  - Recommendation: scripted reactions written before the runs (one per variant round), driven by the rework-lab dialog driver; one live human run at the end as a sanity check.
  - Option: Scripted reactions — repeatable; may not match how a person reacts.
  - Option: You react live — realistic; needs your time for every rep.
  - Independent: yes

### Deferred

- **Q-03** Budget cap per experiment. The skills lab ran without a cap ("unlimited, lets get it right", plan 79614d24); assume the same unless you say otherwise.

## Relevant files and approach

- `docs/proposals/2026-11-09-matt-video-ideas.md` section C: the six experiments and their video evidence.
- `scripts/skills-lab.mjs`, `scripts/rework-lab.mjs`, `scripts/lab-metrics.mjs`, `scripts/skills-lab-judge.mjs`: harnesses (D-02).
- `docs/proposals/skills-lab/design.md` and `results.md`: arm, rep and judging conventions to copy.
- `docs/proposals/2026-11-05-rework-recipe.md` §2 (line 125): the sensitivity check with one planted bug that C6 extends.
- `scripts/audit-compaction.mjs`: re-read and re-ask counts after compaction, a C2 quality signal.
- Settings: `workOrchestrator.context.compactAtTokens` (`/wo context set 150000`) for C2; thinking effort per phase for C1.

## Phases

### Phase 1: Benchmark designs [think]

- [ ] **C-01** Settle Q-01 and Q-02, then record the baseline workload and its metrics command for each experiment.
- [ ] **C-02** C1 design: coding effort one level lower on `[code]` phases only, planning unchanged.
  - Arms: current effort vs one lower; metrics from `lab-metrics.mjs`; quality from hidden tests and the blind judge.
  - Keep only if quality holds and cost or runtime drops materially.
- [ ] **C-03** C2 design: Ultrafull checkpoint at 150k vs 200k on the same long workload.
  - Quality: task outcome plus `audit-compaction.mjs` counts (files re-read, commands re-run, questions re-asked).
  - Cost: more compactions at 150k add summary calls; aggregate every continuation session.
- [ ] **C-04** C3 design: prototype re-test with reactions (Q-02); arm off vs forced as in SK-08.
  - Success signal: a throwaway prototype built and reacted to before the production edit, and a better judge rank.
- [ ] **C-05** C4 design: capture one real request and rank system blocks and tool schemas by bytes and tokens.
  - An audit, not an A/B: output is a ranked table. Any deferral it suggests gets its own A/B later.
- [ ] **C-06** C5 design: quieter per-edit pi-lens diagnostics plus one batched check before each commit.
  - Arms on the same `/resume3` workload; count diagnostics tokens, turns spent on lint advisories and bugs that escape to the final check.
- [ ] **C-07** C6 design: a few declared mutations in the rework recipe's sensitivity check (§2), extending its one planted bug.
  - Measure: mutations caught versus survived; added runtime per check.

### Phase 2: Runs [think]

- [human] **C-08** User go for the runs, with Q-03's budget.
- [ ] **C-09** Run and report each experiment in its design's order; one results section per experiment with keep or revert.

## Global validation

- Every run's numbers come from `node scripts/lab-metrics.mjs <session-dir>` over all its sessions, children included.
- Every keep verdict compares against the recorded baseline (C-01) and states quality and cost side by side.

## Resume context

Planning draft written at night without the user. Next: /plan3 resolve for Q-01 and Q-02, then fill the designs C-02 to C-07. Nothing has run.

## Amendments

Append material changes and their reasons; preserve the original request and settled decisions.
