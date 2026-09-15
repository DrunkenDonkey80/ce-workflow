# Payload stripping implementation verification

## Implemented

- The active compaction path now emits the stripped `outgoing` tail instead of the original messages.
- Aged image payloads become deterministic recoverable path markers after two successful assistant responses.
- Aged tool results of 24,000+ characters retain bounded head/tail context.
- Successful later edit/write results replace superseded reads with re-read markers; failed mutations do not.
- Large identical text-only tool results retain the newest surviving copy; stale targets are excluded and mixed text/image results are not collapsed.
- Thinking removal remains default-off and requires `STRIP_THINKING=1` pending a provider replay matrix.
- `npm run audit:payload-strip -- <session...>` audits reconstructed active session contexts without opening or rewriting session logs.

## Focused and adjacent checks

- `node scripts/test-work-compaction-notifications.mjs` — PASS
- `node scripts/test-work-goal.mjs` — PASS
- `node scripts/test-work-resume.mjs` — PASS
- LSP diagnostics for `extensions/work-models.ts`, `scripts/test-work-compaction-notifications.mjs`, `scripts/audit-payload-strip.mjs`, and `package.json` — clean
- `git diff --check` for the same implementation files — PASS
- Corpus audit over the five requested session directories — 172 files, 0 malformed lines, 0 anomalies; default stripping 93,844,486 → 49,636,968 bytes (47.11% saved); thinking opt-in 93,844,486 → 37,119,092 bytes (60.45% saved).
- Images alone account for 38,049,022 bytes: 86.07% of default-mode savings and 40.55% of the full reconstructed active-context corpus.

## Credentialed live A/B checks

Model: `anthropic/claude-haiku-4-5:high`; identical prompt and one run per side. Both sides completed with correct delayed recall and identical turn/tool-call counts.

| Workload | Mode | Correct | Turns | Tool calls | Runtime s | Total tokens | Cost USD |
|---|---|---:|---:|---:|---:|---:|---:|
| image delayed recall (`7319`) | baseline | yes | 4 | 3 | 13.707 | 134,121 | 0.025917 |
| image delayed recall (`7319`) | enabled | yes | 4 | 3 | 14.690 | 133,060 | 0.024880 |
| giant middle recall (`4826`) | baseline | yes | 4 | 3 | 17.433 | 166,003 | 0.068110 |
| giant middle recall (`4826`) | enabled | yes | 4 | 3 | 16.445 | 161,325 | 0.061019 |
| aggregate | baseline | yes | 8 | 6 | 31.140 | 300,124 | 0.094027 |
| aggregate | enabled | yes | 8 | 6 | 31.135 | 294,385 | 0.085899 |

Aggregate enabled vs baseline: total tokens -1.91%, cost -8.64%, runtime effectively flat, turns/tool calls unchanged. This short smoke used one image and only one request after the two-successful-assistant grace window, so it validates delayed recall but does **not** measure the repeated-image workload that dominates corpus savings. Treat it only as no-observed-regression evidence, not a savings benchmark.

### Terra size/use matrix

A later wire-instrumented `openai-codex/gpt-5.6-terra` matrix ran small/large images × rolling on/off × three rotated repetitions in each of two use patterns. All 24 runs passed. Values below are medians; deltas compare rolling on with off.

| Use pattern | Image | Rolling off tokens / cost | Rolling on tokens / cost | Token delta | Cost delta | Runtime delta |
|---|---|---:|---:|---:|---:|---:|
| needed again | 480×320 | 41,977 / $0.026912 | 47,113 / $0.033418 | +12.24% | +24.18% | +33.54% |
| needed again | 2000×1333 | 62,988 / $0.057940 | 64,993 / $0.063396 | +3.18% | +9.42% | -0.88% |
| finished | 480×320 | 29,560 / $0.013790 | 29,024 / $0.018178 | -1.81% | **+31.82%** | -10.67% |
| finished | 2000×1333 | 44,545 / $0.029034 | 35,044 / $0.026611 | **-21.33%** | **-8.35%** | -12.58% |
| complete text record retained | 480×320 | 30,307 / $0.017207 | 29,866 / $0.018432 | -1.46% | **+7.12%** | -15.22% |
| complete text record retained | 2000×1333 | 45,387 / $0.036498 | 35,886 / $0.026702 | **-20.93%** | **-26.84%** | -4.89% |

The result is genuinely mixed: comprehensive retained text plus large-image removal produced the strongest win and required no re-reads, while small-image cache invalidation still increased cost. Later visual reuse without a complete text record made rolling removal lose at both sizes. The implemented gate therefore keeps payloads below 64 KiB, asks the model to record reusable visual facts for larger payloads, and later rolls out only those large pixels. All 12 reuse-required runs also proved the new compaction rule at wire level: a fresh retained-tail image count changed from zero on the first post-compaction request to one only after the model re-read it. Full report: `C:\SOFT\git\ce-workflow\.pi\image-strip-terra-pilot-v3\report.md`.

## AI-Wedge historical request replay

The audit CLI's `--replay` mode reconstructs the exact context immediately before every recorded assistant response. It was run over all 11 top-level AI-Wedge logs containing image payloads, without provider calls or session mutation.

- 5,087 historical requests reconstructed; 0 malformed lines and 0 structural anomalies.
- Image payloads were resent 10,937 times, totaling 7,127,450,453 serialized bytes.
- Default stripping retained 357 grace-window image instances / 264,415,203 bytes and removed 10,580 repeated instances / 6,861,522,467 bytes.
- Image payload bytes fell **96.29%**; image instances fell **96.74%**.
- Requests carrying images fell from 2,181 to 286 (**86.89%** fewer image-bearing requests).
- Images alone saved **71.61% of all original request bytes** and contributed **96.34% of default-mode savings**.
- Total default-safe outgoing context fell 9,581,570,099 → 2,459,552,058 bytes (**74.33%**).
- At Pi's flat 1,200-token-per-image estimator, removed repeats correspond to 12,696,000 estimated image tokens; provider billing may use a different image-token formula.

Final active leaves of those same 11 logs independently fell 38,201,149 → 6,712,054 bytes (**82.43%**); images alone saved 30,505,017 bytes.

Artifacts:

- `C:\SOFT\git\ce-workflow\.pi\ai-wedge-image-replay.json`
- `C:\SOFT\git\ce-workflow\.pi\ai-wedge-image-final-leaves.json`

## GLM reasoning-stripping pilot

A wire-instrumented `zai/glm-5.3:high` pilot ran three policies × three rotated repetitions on disposable three-stage calculator-lite projects. All nine final functional checks passed, and captured provider payload metadata proved that control replayed accumulating `reasoning_content` while both treatments actually removed it.

Neither treatment passed the optimization gate:

- Completed-interaction removal (R1), median vs control: runtime +19.48%, turns +18.18%, total tokens +12.65%, cost +19.93%.
- Two-response aggressive removal (R2), median vs control: runtime -0.28%, turns +18.18%, total tokens -6.56%, cost +6.09%; means regressed runtime +10.54%, total tokens +17.38%, and cost +26.77%, with one run incurring three recoverable tool failures.

Reasoning stripping therefore remains default-off; a larger confirmation run is not justified from this pilot. Full evidence: `C:\SOFT\git\ce-workflow\.pi\reasoning-strip-glm-pilot-v2\report.md` and `results.json`.

Earlier thinking opt-in live loops:

- Anthropic Haiku high: three sequential tool calls completed, sum `66`; debug trace removed one aged thinking block only after the grace window.
- OpenAI Codex `gpt-5.6-sol:high`: three sequential tool calls completed, sum `66`; this run emitted no replayed thinking blocks, so it does not establish signed-reasoning safety.

## Full package verification

`node scripts/verify-package.mjs --quiet` ran the repository's full verifier and reported two failures:

1. `scripts/test-background-verifiers.mjs` — late schema-validated artifact-only recovery assertion.
2. `scripts/test-work-design-disabled.mjs` — expected normal resume state but received `design-resume-required` from a persisted design session.

Both failures reproduce unchanged against an isolated archive of `HEAD` with the same installed dependencies, so they are pre-existing repository baseline failures unrelated to payload stripping. All payload-stripping-focused and adjacent tests pass.
