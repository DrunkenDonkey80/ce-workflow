# Matt experiments C3–C6: unattended results

Plan: `C:/SOFT/git/ce-workflow/docs/plans/2026-11-08-benchmark-the-matt-video-experiments-c1-c6-427dd6a8-plan3.md`.

## Status

| Experiment | Result | Action |
|---|---|---|
| C3, prototype with reactions | Tests tied; mixed blind ranks; forced costs 43.7% more | Reject adoption of this tested setup; live prototype-first benefit remains unmeasured |
| C4, request prefix | Two captures ranked; about 90 KB each | Audit complete, no change adopted; native child context is not identical to interactive context |
| C5, pi-lens overhead | Inconclusive against the 5% latency gate | No optimization or A/B justified by these logs |
| C6, declared mutations | 5 caught, 3 survived; 139.15 seconds | Keep existing one-mutation recipe: the approved 120-second total gate failed |

No benchmark improvement is claimed. C4–C6 are audits and sensitivity tests, not replacement end-to-end coding benchmarks. No production behavior was changed by this run. C4 report: `C:/SOFT/git/ce-workflow/docs/proposals/2026-11-10-c4-prefix-audit.md`.

## C3: reject adoption of the tested forced-skill setup

### Frozen setup and integrity

Native workflow `f5a0e538-20bf-4210-8cdd-3c5cb0058367` completed all 18 child turns: three paired rounds, initial task plus two predeclared reactions in each arm. `off` receives the task without the prototype skill; `forced` is instructed to read the supplied skill and its logic branch. Same model, effort, task, reactions and tool configuration in both arms. The runtime also makes native supervisor reporting available; those calls are counted.

Evidence root: `C:/SOFT/git/skills-lab/c3-native-retry1/`. `manifest.json` pins the task and source; `results.json` contains checks, metrics and native session paths; `evidence/<run>/<stage>/` contains all 18 source snapshots and file hashes. `source-audit.json` records before/after Python AST comparisons. Evaluation script: `C:/SOFT/git/skills-lab/c3-evaluate.mjs`.

- Frozen DealFinder commit: `27221bee0074264ca685c9c41e9b22d7655fcf52`, fetched locally into six isolated shallow copies, with empty indexes and no newly created commits. Untouched suite: **119 passed**. Hidden tests fail collection on the base because the requested module does not exist.
- Sol high in every native launch and continuation. Ultrafull 150k settings retained in every fixture. Source runtime at `C:/SOFT/git/skills-lab/c3-native/runtime` remains hash `602e3c05dcc95be3cc4e04cfe21e3612beb4937279bcad427ed4301227aae49e`; ce-workflow source HEAD at capture was `fef8912c2fd9220c0424a2f344a56d00d0cc882e` with existing dirty changes.
- All 18 snapshot hashes checked; final working sources match final snapshots. Each of the six real retained session files contains exactly three user messages with the correct initial task and ordered reactions. The 18 run receipts reference these **six files**, so summing receipt-level cumulative sessions would overcount.
- Hidden tests were introduced only after every coder ended, then removed. No coder received their failures or another repair turn. The nine scenarios were fixed before launch.
- No compactions occurred. Largest reported input context was 57,893 tokens, well below 150k: configured mode was retained, but this is not another compaction-threshold experiment. The frozen hash covers copied source, not the junction's dependencies. Host documentation identifies Pi 1.5.2; an exact executable version was not separately archived per child. These are reproducibility limitations, not evidence of a mid-run change.

### Independent host checks

| Run | Full suite | Hidden scenarios | Active execution, minutes | Elapsed, minutes | Total provider tokens | Estimated cost | Turns | Calls |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| off-1 | 136 passed | 9/9 | 5.10 | 7.61 | 965,787 | $0.268926 | 33 | 41 |
| forced-1 | 137 passed | 9/9 | 7.68 | 8.19 | 1,431,361 | $0.485378 | 39 | 46 |
| off-2 | 141 passed | 9/9 | 5.99 | 7.43 | 1,185,091 | $0.318864 | 40 | 47 |
| forced-2 | 119 passed | 9/9 | 8.24 | 8.33 | 1,454,893 | $0.402717 | 43 | 52 |
| off-3 | 133 passed | 9/9 | 4.66 | 6.09 | 1,031,933 | $0.264087 | 31 | 34 |
| forced-3 | 135 passed | 9/9 | 6.23 | 6.47 | 1,164,592 | $0.335829 | 37 | 44 |

### All-continuation comparison

| Mean per build | off | forced | Forced change |
|---|---:|---:|---:|
| Active native execution, minutes | 5.253 | 7.383 | +40.6% |
| Initial launch to final completion, minutes | 7.045 | 7.662 | +8.8% |
| Total provider tokens, including cache reads | 1,060,937 | 1,350,282 | +27.3% |
| Estimated cost | $0.283959 | $0.407975 | +43.7% |
| Assistant turns | 34.67 | 39.67 | +14.4% |
| Tool calls | 40.67 | 47.33 | +16.4% |
| Parent suite plus hidden-test time, seconds | 4.010 | 3.815 | reported separately |

Active time sums all three launch-to-completion intervals per build, including native wrapper overhead; elapsed time also includes waiting at the paired reaction barriers. The faster arm waits for its partner before receiving the next reaction, so elapsed differences are compressed. Host verification time is outside both coding intervals; adding it does not alter the direction. Tokens and cost sum every assistant response in each unique real session exactly once, including failed tool attempts, cache reads and all continuations. Artifact transcript copies are excluded. All six accepted builds together used **7,233,657 provider tokens, estimated $2.075800**; judge and discarded setup overhead are not silently attributed to one arm.

### Observed learning and rework

All six first implementations already chose the later-confirmed G1–G3 policies. Reactions mainly strengthened examples, documentation and tests rather than overturning decisions. Production Python line churn (added plus deleted lines) across both reactions totals **16 off / 31 forced** over three builds. ASTs excluding docstrings are unchanged in five builds; the sixth only hoists a reason-label dictionary out of a printing loop. This is not evidence that the prototype saved a costly policy rewrite: the scripted reactions did not demand one.

The observable tool sequences show no policy model executed before the first production Python edit in any build. Forced runs produced HTML afterward. That ordering is a central limitation of this test of the *prototype-first* idea. The independent judge awarded no pre-production model-execution point to any build; producing later HTML did not earn credit. `forced-2` retains no new regression-test file; it used inline synthetic probes and the original 119-test suite. The other five builds retain added tests. A passing case count alone does not settle comparative maintainability.

### Blind quality review

Following the existing skills-lab protocol, fresh read-only Astra-high review `766b0302-ca5c-4b1c-a259-d0e29e43da70` read all six randomly labelled bundles. `blind-review.md` is the full report; `judge-key.json` was read by the parent only after the review returned. Costs, arm names and skill reads were withheld. Full final changed source and bounded observable transcripts were included. Artifact shape can still reveal the likely treatment, so blinding is imperfect. One judge, small n, and a judge related to the coding model limit generalization.

| Run | Anonymous label | Overall quality rank | Rubric result |
|---|---|---:|---|
| off-1 | E02F86 | 4 (tie) | 7 known points; design-time trap recognition unknown |
| forced-1 | 0AD188 | 2 (tie) | 7 known points; design-time trap recognition unknown |
| off-2 | 846640 | 1 | 8/9 |
| forced-2 | 10FE05 | 6 | 7 known points; design-time trap recognition unknown |
| off-3 | 88E854 | 4 (tie) | 7 known points; design-time trap recognition unknown |
| forced-3 | 30D348 | 2 (tie) | 7 known points; design-time trap recognition unknown |

Every build passes both host-check items, applies all three reaction decisions, records decisions, and either has no prototype artifact or marks it throwaway. Every build scores **0** for executing a runnable model before production edits. For five builds, the bounded observable transcript cannot securely establish when the scan-reset trap was explicitly recognized; these are **unknown**, not zero. A complete rubric median cannot therefore be claimed. The judge's top build, `off-2`, earns that point from its initial history-table comment and has the strongest persistent real-verify regression. Parent spot-checks confirmed both citations.

Forced wins the paired overall rank in rounds 1 and 3, while off wins round 2. The average competition ranks are off 3.00 / forced 3.33; these ordinal summaries are descriptive, not significance tests. The judge flags one P2 maintainability issue: `forced-2` has no persistent alert regression tests, despite its useful inline probes. The parent verified the report's explicit no-new-tests statement and final files. No benchmark artifact was repaired after scoring.

### Verdict and limits

**Do not adopt the tested forced-skill setup.** Hidden checks are tied, quality ranks are mixed, and forced materially regresses cost (+43.7%), tokens (+27.3%), active runtime (+40.6%), turns (+14.4%) and calls (+16.4%). Even its two paired rank wins do not satisfy the approved no-material-cost-regression rule. Leave the current workflow unchanged; no skill installation, UI-variants expansion, or production refactor follows from this result.

This closes the automated comparison, **not** the general case for prototyping. The treatment did not achieve prototype-first ordering, the scripted reactions mostly confirmed policies already chosen, and no human drove a demo. The benefit of a genuine human-reactive prototype remains unmeasured. The live C-16 run is **not performed** and still needs the user; arm selection is deferred until they return rather than interrupting the unattended run.

### Recorded child-execution overhead

The blind judge used **1,163,330 provider tokens, estimated $2.619020, 16 turns, 15 calls and 172.351 active seconds**, with no compaction (`judge-metrics.json`). Accepted builds plus the discarded setup below plus this judge total **9,031,257 reported tokens and estimated $4.998282**, 267 turns and 317 calls. This is the recorded C3 child-execution total, not a claim to include the parent's orchestration tokens, host-only verification time or unreported cancelled-request billing. Judge cost stays outside the arm comparison.

### Discarded setup attempt and verification

First workflow `884582e4-70b2-4265-af8d-323bf5d186b6` was stopped because the parent-created baseline was staged and native acceptance required an empty index. Its two real sessions (including the stopped forced child absent from the compact receipt) were found and counted: **634,270 tokens, estimated $0.303462, 28 turns, 38 calls, 355.154 summed active seconds**. They are excluded from paired quality comparisons, not from research overhead. An in-flight cancelled request may have unreported provider usage. Retry preparation asserted that the old fixture reproduced the staged-index problem and all six replacements had clean indexes.

`node "C:/SOFT/git/skills-lab/c3-evaluate.mjs"` verified all snapshots/runtime/settings/continuations and ran the existing full-suite and hidden-test commands: six full suites green and **54/54** hidden cases passed. Its first invocation stopped before testing because the receipt state is named `complete`, not `completed`; after inspecting the actual schema, the parser was corrected and rerun. `node "C:/SOFT/git/skills-lab/c3-judge-bundle.mjs"` built six arm-scrubbed bundles with assertions. Targeted LSP reported no diagnostics but could not confirm clean for these two lab scripts. No product suite or live-service checks were run.

## C5: pi-lens audit

### Evidence and method

- Script: `C:/SOFT/git/rework-lab/c5-audit.mjs`.
- Machine-readable results: `C:/SOFT/git/rework-lab/c5-results.json`.
- Scope: all 27 runs in C1b, C1c, C1d and C2, including real continuation and child session files if present. Copied `subagent-artifacts` transcripts excluded; session IDs deduplicated within each run. Found 27 real sessions.
- Denominator: each run's recorded `done` or `failed` wall time, totaling 97,164,164 ms (26.99 hours).
- Lower bound: clean-footer times printed in actual edit/write tool results, including nested codemode results. These do not cover every warning, pending, failed, or asynchronous diagnostic.
- Conservative upper bound: the whole duration of edit/write and explicit `lens_diagnostics` calls. Nested calls use recorded `details.calls[].durationMs`; direct calls use result timestamp minus the assistant call timestamp, which includes queueing and possibly other tools. Summing calls can overcount parallel time. This is not diagnostic-only attribution or critical-path time.
- Text sizes are stored characters, **not provider tokens**. No token or cost reduction is inferred from them.

### Results

| Metric | Value |
|---|---:|
| Direct edit/write calls | 196 |
| Nested edit/write calls | 1,444 |
| Timed clean footers | 359 |
| Timed footers inside codemode | 305 |
| Sum of printed footer times | 896,399 ms |
| Printed-time share of wall time | 0.923% |
| Largest individual printed-time share | 4.77% (c1b-sol-high-2) |
| Conservative aggregate upper bound | 8,755,274 ms, 9.011% |

**Correction to the plan's preliminary D-17 evidence:** codemode does not generally bypass per-edit hooks. For example, c2-150k-1's codemode result contains `✓ JavaScript/TypeScript clean · 3158ms` after an edit. Treating every codemode result as unrelated to diagnostics badly understates hook coverage. Bash edits remain a separate path; this audit does not infer their diagnostic behavior from their tool name.

### Verdict

The user-approved gate remains 5%. The observed lower bound is below it, but the loose upper bound is above it. Therefore the existing logs do **not** establish which side the true hook cost falls on. Do not close this as proven cheap, and do not launch an expensive A/B as though the gate had been exceeded. A future instrumented run would need hook-only elapsed time for all outcomes, including pending diagnostics, and overlap-aware attribution. This is deferred evidence work, not an adopted optimization.

Verification: `node "C:/SOFT/git/rework-lab/c5-audit.mjs"` completed with assertions for the parser and the 27-run scope. Initial parser failed on string user-message content; it was corrected to handle both string and block-array content and rerun successfully.

## C6: eight declared mutations

### Frozen setup

- Isolated worktree: `C:/SOFT/git/rework-lab/c6-mutations`.
- Frozen SHA: `98217168efb728888053fc3f9dab4fc95e0e134c`.
- No changes to the source fixture at `C:/SOFT/git/rework-lab/c1-high-1` or the PhotoBook product repository.
- Dependencies reused through a junction to the existing fixture's `node_modules`; no installation or manifest changes.
- Predeclared patches and exact replacement manifest: `C:/SOFT/git/rework-lab/c6-evidence/manifest.json` and `M01.patch` through `M08.patch`, written before any test run. Each source file has a SHA-256 guard. No commits were made.
- Runner: `C:/SOFT/git/rework-lab/c6-run.mjs`; declaration script: `C:/SOFT/git/rework-lab/c6-declare.mjs`.
- Command per run: `node "node_modules/vitest/vitest.mjs" run "server/rework" --reporter=json --outputFile=<evidence file>` from the isolated worktree. This runs the existing Vitest corpus directly, without an npx download. `REWORK_RECORD`, `REWORK_EXPECT` and `REWORK_PERF_OUT` are removed from the child environment.
- Every mutation is applied alone and restored in `finally`. The runner asserts a clean tracked worktree after each mutation. Baselines are never regenerated.

### Results

Both unmodified baselines passed all PB-001–PB-011 cases, in 17.73 and 13.94 seconds. The opt-in performance probe was skipped as intended.

| Mutation | Intended defect | Result | Catching cases | Seconds |
|---|---|---|---|---:|
| M01 | Invert consent assignment (positive control) | Caught | PB-003, PB-004 | 17.06 |
| M02 | Read analysis consent/deletion state before acquiring the lock | Survived | None | 15.95 |
| M03 | Read draft protection/fingerprint state before acquiring the lock | Survived | None | 15.14 |
| M04 | Remove person-role validation | Caught | PB-004 | 14.89 |
| M05 | Change session expiry equality from valid to expired | Survived | None | 16.81 |
| M06 | Remove audit-event redaction | Caught | PB-006 | 18.71 |
| M07 | Skip session invalidation on deletion | Caught | PB-007 | 18.27 |
| M08 | Replace feedback history instead of appending | Caught | PB-005 | 22.33 |

Mutation runs totaled **139.15 seconds**; including the two baseline runs, **170.82 seconds**. Each ran the complete frozen behavior corpus. Results and full Vitest assertions are saved under `C:/SOFT/git/rework-lab/c6-evidence/`.

### Meaning of the survivors

- **M02:** the corpus lacks a controlled interleaving between analysis reading consent and acquiring its write lock. A smallest discriminating addition would withdraw consent while the save is queued and assert that old identity results cannot be restored; repeat with deletion. This is a proposed test, not a reproduced privacy incident.
- **M03:** the corpus does not make a queued draft commit observe a changed payment/protection state or gallery fingerprint. A controlled competing write followed by an assertion that the stale commit is rejected would distinguish the mutant. No PhotoBook fix was made.
- **M05:** no corpus case requests a session at exactly its expiry timestamp. Use the existing injected `now` argument to check one millisecond before, equality and one millisecond after. The mutation changes frozen behavior; it is not evidence that the original equality policy is a security bug.

### Verdict

The corpus catches straightforward validation, privacy-redaction, invalidation and append regressions, but both stale-read mutations survive. That is useful sensitivity evidence, not proof that the current application has those newly planted races.

The approved keep rule also required the total extra check to stay under two minutes. **139.15 seconds exceeds that gate.** Retain the existing one-planted-bug recipe; do not quietly relax the threshold, select faster runs, or amend the recipe based only on the survivors. A smaller targeted mutation set would be a separate experiment if desired.

Verification: `node "C:/SOFT/git/rework-lab/c6-run.mjs"` exited 0 after two green baselines and all eight declared mutation runs; positive control failed PB-003 as expected; tracked source restored after every run. No whole-product suite or live provider testing was needed for this corpus-sensitivity experiment.
