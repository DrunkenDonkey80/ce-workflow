---
plan3: true
status: draft
created: 2026-11-08
updated: 2026-11-10T06:07:52.028Z
started: 2026-11-09T11:22:42.019Z
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
- **D-04** Q-01: C1 and C2 both use a rework-lab run on the photobook fixture as the workload; its numbers are recorded as the baseline before any arm runs. Source: user, 2026-11-09 ("1 yea agreed").
- **D-05** Q-02: C3 uses scripted reactions written before the runs (one per variant round), plus one live run with the user at the end. Source: user, 2026-11-09 ("2. yep").
- **D-06** Q-03: no budget cap, as in the skills lab. Source: user, 2026-11-09 ("3 yep").
- **D-07** C1 arms: `codingEffort` high (what we all use today; rework-lab's default) vs medium; planning unchanged. Needs a `--coding-effort` option in `scripts/rework-lab.mjs`, which writes `codingEffort: "high"` into the clone's settings today. Source: user, 2026-11-09 ("we all use high for coding so test med").
- **D-08** C1 is coding-only: plan and design once on Opus high, then reuse that decided plan for every coding arm. Source: user, 2026-11-09 ("plan once on high opus and stop! reuse that plan for several coding sessions… opus high vs med, sol high vs med"). Frozen point: `c1-high-1` at `1d0fb5c` (PICK recorded, before Build). Arms: coding model Sol or Opus × effort high or medium, 3 reps, all four side by side per rep (`C:/SOFT/git/rework-lab/c1b-run.sh`, `rework-lab.mjs --from-plan`). Remaining [think] phases (Replay, Switch) stay on Opus high in every arm. The first full-run pair (`c1-high-1` $14.72 green, `c1-medium-1` $54.44, 1 failing test, a different and 3× larger pick) is kept only as evidence that full runs vary too much; rounds 2-3 were stopped.
- **D-09** C1 result (12 coding-only runs, 3 rounds, blind Opus + Astra judges, keys in C:/SOFT/git/rework-lab/judge/c1b-r{1,2,3}.key.json): keep coding effort **high** and Sol as coder. Astra average rank: sol-high 1.3, sol-medium 2.3, opus-high 3.0, opus-medium 3.3. Arm-specific race bugs flagged by Astra across 3 rounds: sol-high 4, sol-medium 5, opus-high 12, opus-medium 12. Objective check: payment-webhook dedupe inside the lock in 6/6 Sol builds, 1/6 Opus builds. Default suite green: sol-high 3/3, sol-medium 1/3, opus 2/3 each. Sol medium saves only ~3 min and ~$0.90 per build. Caveats: the Opus judge ran out of context on rounds 2-3 (partial reads); Astra shares Sol's model family.




## Open questions

None open. Q-01 → D-04, Q-02 → D-05, Q-03 → D-06.

## Relevant files and approach

- `docs/proposals/2026-11-09-matt-video-ideas.md` section C: the six experiments and their video evidence.
- `scripts/skills-lab.mjs`, `scripts/rework-lab.mjs`, `scripts/lab-metrics.mjs`, `scripts/skills-lab-judge.mjs`: harnesses (D-02).
- `docs/proposals/skills-lab/design.md` and `results.md`: arm, rep and judging conventions to copy.
- `docs/proposals/2026-11-05-rework-recipe.md` §2 (line 125): the sensitivity check with one planted bug that C6 extends.
- `scripts/audit-compaction.mjs`: re-read and re-ask counts after compaction, a C2 quality signal.
- Settings: `workOrchestrator.context.compactAtTokens` (`/wo context set 150000`) for C2; thinking effort per phase for C1.

## Phases

### Phase 1: Benchmark designs [think]

  - note: Baseline = the C1 high arm itself (current settings, current ce-workflow 24bb80d): photobook-02 ran on an older recipe/ce-workflow, so it can't be the baseline. Runner: C:/SOFT/git/rework-lab/c1-run.sh (3 reps, high+medium side by side per rep, --check = npm run build + vitest). Metrics: wallMs/metrics/check in each c1-*.lab.jsonl done line (lab-metrics sessionMetrics).
- [x] **C-01** C1 done (D-08/D-09): coding-only 2x2x3 from one Opus-high plan; verdict keep Sol on high effort; medium rejected for coding.
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

- [x] **C-08** User said "go" (2026-11-09) after D-04..D-07; no budget cap.
- [ ] **C-09** Run and report each experiment in its design's order; one results section per experiment with keep or revert.

## Global validation

- Every run's numbers come from `node scripts/lab-metrics.mjs <session-dir>` over all its sessions, children included.
- Every keep verdict compares against the recorded baseline (C-01) and states quality and cost side by side.

## Resume context

C1 coding-only: all 12 runs done. Coding time/cost per arm via C:/SOFT/git/rework-lab/c1b-report.mjs (time split by plan3-run mode markers): opus-high 38 min/$9.9, opus-medium 29/$7.0, sol-high 58/$4.5, sol-medium 55/$3.6; default-suite pass 2/2/3/1 of 3 (all fails = PB-010 delta-default wrap-up miss). Rounds 2-3 blind judging running (workflow cf65b394; judge/c1b-r2, c1b-r3, keys judge/c1b-r{2,3}.key.json; Opus + Astra each, race-hunt instruction added). Next: unmask, verify flagged races per arm, combine with round 1 (judge/c1b-r1), decide high vs medium per coding model.

## Amendments

Append material changes and their reasons; preserve the original request and settled decisions.
