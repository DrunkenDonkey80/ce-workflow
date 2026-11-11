# C2: 150k versus 200k Ultrafull checkpoints

## Verdict

**User approved a provisional 150k trial; the shared Ultrafull default is now 150k. Explicit project/global thresholds are preserved.** On this workload, 150k was cheaper and used fewer provider tokens, without an aggregate quality regression. Both blind judges preferred 150k in rounds 1 and 3 and 200k in round 2. That is two winning build pairs, not four independent replications. It does not establish that earlier compaction generally improves code quality.

Both settings still produced serious concurrency bugs. These are benchmark checkouts, not changes to PhotoBook's live code; no result here certifies either build for release.

## Question and controls

The idea came from the Matt Pocock video collection's context “dumb zone” estimate, not a measured fact. See [the original experiment list](2026-11-09-matt-video-ideas.md), C2, and benchmark plan `427dd6a8`, D-14.

- Three fresh paired rounds, each starting at the **same frozen Opus-high plan**, commit `1d0fb5ccfcaccaf662996fea1943585ae2cb9261`, before Build. No replanning per arm.
- Sol-high coding; subsequent think phases Opus-high in both arms. This is not a thinking-effort experiment.
- Same ce-workflow runtime, pinned to `28a5d72a082f1810b2c3f04194ae0f2cc234782f`, content hash `5889235e6bac8272ebddbc0dbd1ff0eec957dfa1e0bd5610240a46ffcbff9944`. Runner reported `workflowUnchanged=true`.
- Ultrafull in both arms; only explicit per-clone `workOrchestrator.context.compactAtTokens` differed: 150000 or 200000. Paired arms ran concurrently; rounds ran sequentially.
- Each complete run included Build, Replay, Switch, Retire and the external final build/test check. The 200k arm is a fresh same-version baseline, not a historical C1 timing.
- All six passed `npm run build` and the full task vitest suite with `REWORK_EXPECT=delta`, the preapproved PB-010 correction. Some final trees still require that environment variable for the ordinary test command; passing the external check does not mean plain `npm test` passes.

## End-to-end measurements

Means per complete run; runtime includes the final external checks, not just coding. Provider tokens include input, output and cache tokens. Recorded costs are estimates, not invoices.

| Metric | 150k | 200k | Change at 150k |
|---|---:|---:|---:|
| Runtime | 58.78 min | 61.09 min | -3.8% |
| Total provider tokens | 10.886M | 13.454M | -19.1% |
| Estimated cost | $6.853 | $7.557 | -9.3% |
| Assistant turns | 115.7 | 121.3 | -4.7% |
| Tool calls | 112.0 | 118.7 | -5.6% |
| Compactions, total over three runs | 8 | 5 | +3 |

| Round | 150k runtime | 200k runtime | 150k tokens | 200k tokens | 150k cost | 200k cost |
|---|---:|---:|---:|---:|---:|---:|
| 1 | 70.5 min | 60.3 min | 14.375M | 12.805M | $8.601 | $8.581 |
| 2 | 51.1 min | 63.8 min | 9.975M | 15.079M | $7.270 | $6.810 |
| 3 | 54.7 min | 59.2 min | 8.308M | 12.479M | $4.687 | $7.280 |

Totals include every real session, compaction-entry usage (including retries, once), and classifier/codemode usage recorded on tool results. Transcript copies in `subagent-artifacts` are excluded. Blind-review overhead is excluded from both build arms. The current `lab-metrics.mjs` assistant-only totals alone would omit summary and classifier usage; the lab-local `c2-report.mjs` adds them.

The average saving is not a uniform win: round 1 was slower with more tokens at 150k, and round 2 was cheaper at 200k despite using more tokens. Do not promise a speedup from this sample.

## Did the thresholds actually differ?

First coding checkpoint `tokensBefore`, by round:

| Round | 150k arm | 200k arm |
|---|---:|---:|
| 1 | 146444 | 191492 |
| 2 | 143670 | 197728 |
| 3 | 143921 | 204973 |

This confirms different checkpoint timing. These recorded sizes are not exact hard caps: decisions use context estimates and can cross tool results or model/phase changes. A later checkpoint in 150k round 2 occurred on Opus at 225710 tokens. Thus this tests the configured policy in the real workflow, not strict 150k/200k maximum contexts.

`audit-compaction.mjs` flagged two rereads at 150k versus zero at 200k; both arms had zero flagged repeated commands, redone edits, reasks, repeated user requests or corrections. These are heuristics and do not cover all bash-based reads, so they are not evidence of zero rework or of better quality.

## Blind quality review

Two read-only judges, Astra-high and Opus-high, independently reviewed each pair. Bundles contained arm-redacted final snapshots, production and full diffs, the common base and the final plans; no performance figures or threshold labels. Judges audited final production callers, including inherited bugs, rather than just counting callback syntax. All six reports were read in full.

Scores below are **150k / 200k**:

| Round | Astra quality /10 | Opus quality /10 | Winner, both judges |
|---|---:|---:|---|
| 1 | 6 / 4 | 7 / 5 | 150k |
| 2 | 5 / 6 | 6 / 7.5 | 200k |
| 3 | 6 / 5 | 7.5 / 6 | 150k |
| Mean | 5.67 / 5.00 | 6.83 / 6.17 | 150k in 2 of 3 pairs |

Reported finding counts, **150k / 200k**, are kept separate by judge:

| Round | Astra findings | Opus findings |
|---|---:|---:|
| 1 | 9 / 13 | 3 / 7 |
| 2 | 15 / 11 | 4 / 3 |
| 3 | 11 / 14 | 4 / 6 |
| Descriptive sum | 35 / 38 | 11 / 16 |

These are not verified counts of unique race bugs: judges group invariants differently; Astra includes test-default configuration defects in rounds 2 and 3, and Opus labels one round-3 retention finding probable. Shared inherited defects also count against both builds. Do not pool judges, infer precise percentages, or compare these sums directly with earlier C1 review batches.

### What drove the verdicts

- **Round 1, 150k better:** its checkout commit recomputes the current kind/bundle under lock and rejects stale provider results. The 200k build can restore checkout state after an earlier webhook has already marked the order paid. The 150k build also serializes consent changes through cleanup, avoiding re-enable bypassing identity stripping.
- **Round 2, 200k better:** its checkout commit rejects an initial checkout if the current order became paid; the 150k build still writes its pre-lock initial-payment decision. It also has stronger current-state consent handling. Both retain other defects.
- **Round 3, 150k narrowly better:** it revalidates the checkout bundle and coordinates consent changes. The 200k build rejects a paid initial commit by returning an empty patch but still returns the unrecorded checkout URL. The 200k build handles late analysis/failed cleanup better; the 150k build can lose references needed to retry private-file deletion.

Parent spot-checks read the checkout transactions in all six snapshots, round-1 consent cleanup and round-2 analysis completion. They support the decisive payment/consent distinctions. The described interleavings were **not executed as new reproductions**. Neither arm merits a blanket “race-free” claim; render, retention, long-running snapshot publication and other inherited races remain.

## Limits and decision boundary

- Three paired builds of one repository/task; not a cross-project or cross-model result. Both judges rate the same builds, so six verdicts are not six independent workload samples.
- The 150k build lost round 2 to both judges. No claim of guaranteed quality preservation for each run, or statistically established quality improvement.
- Both judges chose anonymous label B in every pair. Labels were randomized independently of threshold, but a label/order effect was not separately tested. Parent source checks support the winners; they do not eliminate this possible review bias.
- Concurrent local runs can share machine load. Recorded costs depend on provider/cache accounting. A modest mean runtime difference is especially noisy.
- Plans and tests were visible to judges. Reading final code is not live-provider, crash-recovery or multiprocess verification.

**Recommendation:** 150k is worth a provisional default trial on the strength of lower overall tokens/cost and no aggregate quality regression in this sample. The user approved this trial after reviewing the results. The shared Ultrafull fallback now uses 150k; existing explicit thresholds and Native 200k remain unchanged. Rerun the same end-to-end benchmark before retaining further compaction optimizations; revert a material overall regression rather than rationalizing it from one improved metric. Planning stays on high, and this result does not justify lowering coding effort.

## Default-change checks

After user approval, the shared special-case 200k fallback was removed from `C:/SOFT/git/ce-workflow/extensions/work-models.ts`; Ultrafull now uses the existing 150k default. No settings files were migrated or overrides replaced. Menu copy, README and changelog match. Reload is needed for an already-running extension to pick up the change.

Targeted checks passed:

- `node "C:/SOFT/git/ce-workflow/scripts/test-work-compaction-notifications.mjs"`: 149999 waits, 150000 checkpoints; an explicit 200k override still waits at 199999 and checkpoints at 200000. Existing small-window, native, research, summarizer and retained-tool-pair checks pass too.
- `node "C:/SOFT/git/ce-workflow/scripts/test-work-compaction.mjs"`: policy, summary fallback/retries, accounting, cancellation and protected-history checks pass.
- Scoped `git diff --check`: passed.

The first boundary fixture was itself over 150k; its old-result payload was reduced to 315000 characters, preserving the native unstripped-payload assertion while isolating the mocked usage boundary. A read-only oracle confirmed the fixture diagnosis before the final retest. Active LSP probes reported no diagnostics but could not confirm clean (push-only/silent-on-clean); no full repository suite or live-provider rerun was performed for this fallback-only change. The six measured builds already used explicit 150k/200k settings with the same effective policy.

## Local evidence

All paths below are absolute; artifacts remain outside the ce-workflow repository:

- Manifest and runtime pin: `C:/SOFT/git/rework-lab/c2.manifest.json`, `C:/SOFT/git/rework-lab/c2.status.json`.
- Complete metrics: `C:/SOFT/git/rework-lab/c2-results.json`; reproduce with `node "C:/SOFT/git/rework-lab/c2-report.mjs"`.
- Original run logs/sessions: `C:/SOFT/git/rework-lab/c2-{150k,200k}-{1,2,3}.lab.jsonl` and matching `-sessions/` directories.
- Arm-redacted snapshots/diffs: `C:/SOFT/git/rework-lab/judge/c2-r1/`, `C:/SOFT/git/rework-lab/judge/c2-r2/`, `C:/SOFT/git/rework-lab/judge/c2-r3/`.
- Unblinding keys outside those bundles: `C:/SOFT/git/rework-lab/judge/c2-r{1,2,3}.key.json`.
- Full verdicts: `C:/SOFT/git/rework-lab/judge/c2-verdict.task-{1,2,3}.md` (Astra) and `C:/SOFT/git/rework-lab/judge/c2-verdict.task-{4,5,6}.md` (Opus).
