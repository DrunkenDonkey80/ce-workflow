# Skills lab results (plan 79614d24, SK-08)

Run `sk07`, Pi 1.5.0, `openai-codex/gpt-6.1-sol:high`, all arms in isolated `%TEMP%\skl-*` copies. Judge: blind `reviewer` on `openai-codex/gpt-6-astra:high`, bundles from `scripts/skills-lab-judge.mjs` (labels unmasked after the judge returned). Judge outputs and keys: `C:\SOFT\git\skills-lab\judge\sk07\<task>\`. Medians over 3 runs per arm; "unforced" is one run with the skill only listed (did it read it?). Rubric score = share of judged and script items passed (partial = 0.5).

## diagnosing-bugs

| Arm | Hidden test | Suite | Rubric (items 1-8) | Judge rank (1 best of 7) | Tokens | Cost $ | Runtime s | Turns | Tool calls |
|---|---|---|---|---|---|---|---|---|---|
| off | 3/3 | 3/3 | 8, 7.5, 7.5 → median 7.5/8 | 5, 6, 7 | 395,868 | 0.1618 | 215 | 11 | 10 |
| forced | 3/3 | 3/3 | 8, 8, 8 → median 8/8 | 1, 2, 3 | 628,100 | 0.2616 | 371 | 16 | 15 |
| unforced (read it) | 1/1 | 1/1 | 8/8 | 4 | 367,593 | 0.1517 | 205 | 10 | 9 |

Forced vs off: tokens +59 %, cost +62 %, runtime +72 %, turns +45 %, tool calls +50 %.

What the skill changed (judge): forced runs built a causal experiment before the fix (vary one factor, e.g. ad age 7 days vs 3 days flips the result), reproduced the symptom more than once, and covered cutoff boundaries; off runs fixed the same token but one diagnosed before reproducing (9834), one edited beyond the fix (BEF1) and one had a confounded regression test repaired after the fix (DD59). Every arm found and fixed the root cause; the end result (hidden test) is identical.

**Verdict: trade-off, not a clear adopt.** Better process and tests on every forced run, same outcome, at about 1.6× cost, a material regression under the Optimization Regression Rule. The one unforced run read the skill on its own and landed in the middle at off-arm cost. Brought to the user at SK-09 as a choice (for example a lighter adapted version: reproduce first, one-factor experiment, regression test red before the fix).

## prototype

| Arm | Hidden test | Suite | #3 model run before production edit | Judge rank (1 best of 7) | Tokens | Cost $ | Runtime s | Turns | Tool calls |
|---|---|---|---|---|---|---|---|---|---|
| off | 3/3 | 3/3 | fail ×3 | 2, 4, 7 | 998,858 | 0.4370 | 506 | 18 | 17 |
| forced | 3/3 | 3/3 | fail ×3 | 1, 3, 6 | 979,657 | 0.3708 | 472 | 19 | 18 |
| unforced (did not read it) | 1/1 | 1/1 | fail | 5 | 907,073 | 0.3734 | 315 | 19 | 18 |

No run, forced included, built and ran a throwaway model before editing production code; the one forced run that wrote a demo did it after the suite passed. Both arms spread across the ranking, and each arm has one run the judge would block for an expiry bug (off B95D: history expires even for deals present the whole time; forced 0A12: a short disappearance can be forgotten too early). The hidden test caught neither.

**Verdict: no measurable effect; do not adopt.** The skill's core step never happened even when forced, quality and cost are within the spread of the off arm.

## tdd

| Arm | Hidden test | Suite | #4 red-green slices | Bugs the hidden test missed | Judge rank (1 best of 7) | Tokens | Cost $ | Runtime s | Turns | Tool calls |
|---|---|---|---|---|---|---|---|---|---|---|
| off | 3/3 | 3/3 | fail, fail, partial | 2, 1, 2 | 4, 5, 7 | 813,494 | 0.4755 | 380 | 17 | 16 |
| forced | 3/3 | 3/3 | pass x3 | 1, 2, 2 | 1, 2, 3 | 1,954,188 | 0.5312 | 553 | 35 | 34 |
| unforced (did not read it) | 1/1 | 1/1 | fail | 1 | 6 | 969,080 | 0.5904 | 477 | 19 | 18 |

Forced runs really worked in red-green slices (one behavior per failing test); off runs wrote all tests first, then the code. The final code is no safer: both arms left 1-2 RAM-parsing bugs the hidden test missed (storage or graphics-labelled modules read as RAM). Forced vs off: tokens +140 %, turns +106 %, runtime +45 %, cost +12 %.

**Verdict: reject as-is.** Better process, same outcome quality, material regression in tokens, turns and runtime.

## code-review

| Arm | Seeded defects found (of 9) | False findings | Standards and spec kept apart | Judge rank (1 best of 7) | Tokens | Cost $ | Runtime s | Turns | Tool calls |
|---|---|---|---|---|---|---|---|---|---|
| off | 5.5, 6, 6 | 0 | 0/3 | 5, 6, 7 | 292,907 | 0.1636 | 141 | 9 | 8 |
| forced | 8, 8, 8 | 0 | 3/3 | 2, 3, 4 | 733,929 | 0.4682 | 234 | 22 | 44 |
| unforced (read it) | 8 | 0 | yes | 1 | 653,450 | 0.4474 | 162 | 23 | 52 |

Every run found the functional bugs and no run flagged a decoy; the skill's runs also caught the standards smells (an unused extension hook, the `chk2` name) because they review against the coding standards and the spec in two separate passes (subagents, hence the tool calls). Every run in both arms missed the unrelated report-subtitle change. Forced vs off: cost 2.9x, tokens 2.5x, runtime 1.7x.

**Verdict: clear quality win at a material cost; a candidate for adoption as an idea.** The two-axis review (standards, then spec, reported separately) is what found the extra defects. Brought to the user at SK-09, against ce-workflow's existing code-review flow.

## retro

| Arm | Report written, only report changed | False claims | Judge rank (1 best of 6) | Tokens | Cost $ | Runtime s | Turns | Tool calls |
|---|---|---|---|---|---|---|---|---|
| off | 3/3 | 0 | 1, 2, 3 | 1,616,128 | 0.5058 | 424 | 23 | 22 |
| forced | 3/3 | 0 | 4, 5, 6 | 1,839,790 | 0.5742 | 390 | 22 | 21 |

All six found the main root cause (the run waited 68 minutes on an approval gate). The off arm ranked above every forced run; the forced reports drifted into general advice and missed the information-access gap and the rollback limitation.

**Verdict: reject.** Worse ranking at higher token cost.

## writing-for-agents

Phase 1 (write AGENTS.md) judged; the verdict waits for the replay phase (a fresh agent adds a shop source using each AGENTS.md).

| Arm | only AGENTS.md changed | Item 5 (test cmd, offline rule, list locations) | Item 6 no-op lines | Item 7 false claims | Judge rank | Tokens | Cost $ | Runtime s | Turns | Tool calls |
|---|---|---|---|---|---|---|---|---|---|---|
| off | 3/3 | partial ×3 | 1, 1, 0 | 0, 1, 0 | 1, 4, 5 | 422,380 | 0.2007 | 212 | 11 | 10 |
| forced | 3/3 | partial ×3 | 0, 0, 0 | 0, 0, 0 | 2, 3, 6 | 348,144 | 0.1744 | 206 | 9 | 8 |
| unforced (read it) | 1/1 | partial | 0 | 1 | 7 | 380,854 | 0.1904 | 145 | 9 | 8 |

No run named every shop-list location (`report.SHOP_NAMES` and the normalize shop tuple were missed by all). The `only-agents-md` check was rescored without pi-lens probe logs (lab noise, fixed in 73a1dbd).

Phase 2 replay (a fresh Sol session adds the Laptop.bg source, no skill; each phase-1 AGENTS.md replayed once, plus 3 controls without AGENTS.md):

| Replay with | Hidden test | All shop lists | Tokens (median, range) | Cost $ | Runtime s | Turns | Tool calls |
|---|---|---|---|---|---|---|---|
| no AGENTS.md (control) | 3/3 | 3/3 | 661,716 (651k-1.18M) | 0.4747 | 290 | 15 | 14 |
| off AGENTS.md | 2/3 | 2/3 | 782,527 (778k-1.31M) | 0.3846 | 323 | 15 | 14 |
| forced AGENTS.md | 3/3 | 3/3 | 780,244 (636k-1.10M) | 0.4757 | 275 | 15 | 14 |
| unforced AGENTS.md | 1/1 | 1/1 | 1,109,885 | 0.3973 | 316 | 22 | 21 |

The one failure (off rep 3, judge rank 4) missed `report.SHOP_NAMES` and the hidden test, the place no AGENTS.md named.

**Verdict: no measurable effect; do not adopt.** The control without any AGENTS.md passed 3/3 at the lowest token median; no AGENTS.md, forced or not, made the next task cheaper or more correct. Forced docs had fewer no-op lines and no false claims (phase 1) and all their replays passed, but one off failure in 3 is inside the noise.

## SK-06 Plan3 baseline (current prompts, before PC-03)

Env: Pi 1.5.0, ce-workflow 9268ac3 (dirty, `git diff` sha1 063de4c77d74), DealFinder 27221be clones in `C:\SOFT\git\skills-lab\plan-runs\sk06-*`, `scripts/rework-lab.mjs` (planner `openai-codex/gpt-6.1-sol`, Plan3 work models as configured, auto-answering the recommended option). Runs logged in `skills-lab/sk06.log`, per-run `sk06-<req>-<n>.lab.jsonl`. P1-P3 and F are plan-only (first `/plan3` turn until Plan ready), T and P1e2e run to completion. T-2 and T-3 finished their work, but the runner crashed while writing the result line (an agent's `2>NUL` left a `NUL` file git cannot add; fixed in `rework-lab.mjs`); their result lines were recomputed from the session logs, with wall time taken as first to last log line.

| Request | Runs | Dialogs | Runtime s (median, range) | Turns | Tool calls | Tokens (median, range) | Cost $ (median, range) | Check |
|---|---|---|---|---|---|---|---|---|
| P1 laptop.bg plan | 3 | 2, 2, 2 | 402 (389-444) | 36 | 37 | 2,627,312 (2.16M-2.65M) | 1.3936 (1.19-1.42) | plan-only |
| P2 eBay.pl plan | 3 | 4, 6, 2 | 341 (284-351) | 21 | 23 | 1,405,120 (1.02M-2.44M) | 1.0358 (0.82-1.48) | plan-only |
| P3 quick-sale cut plan | 3 | 8, 4, 8 | 248 (224-292) | 16 | 17 | 847,335 (0.72M-0.97M) | 0.7249 (0.60-0.76) | plan-only |
| F deal alerts plan | 3 | 4, 2, 6 | 354 (327-388) | 19 | 23 | 1,449,357 (1.29M-2.04M) | 1.2022 (1.07-1.30) | plan-only |
| T CLI description, end to end | 3 | 2, 2, 2 | 425 (394-451) | 27 | 30 | 1,090,475 (0.99M-1.10M) | 1.1868 (0.87-1.23) | 3/3 pass |
| P1 end to end | 1 | 6 | 4,070 | 113 | 127 | 10,107,703 | 5.3611 | pass (suite + hidden laptopbg) |

Runtime, turns, tool calls and tokens sum every session of the run (T and P1e2e have 2: plan plus execution). The PC-09 rubric (Q1-Q8) is scored blind later on baseline and candidate runs mixed together, so the judge cannot tell which arm a plan came from.

## PC-09 Plan3 candidate (sizing, project care, question rounds, project language) versus SK-06

Env: Pi 1.5.0, ce-workflow 52dca50 (PC-01 to PC-08 and PC-13), same DealFinder clones, runner, requests and repeats as SK-06 (`skills-lab/sk06c.sh`, log `sk06c.log`, runs `plan-runs/sk06c-*`). Totals sum every session of a run.

| Request | Arm | Runtime s (median, range) | Turns | Tool calls | Tokens (median, range) | Cost $ (median, range) | Check |
|---|---|---|---|---|---|---|---|
| P1 laptop.bg plan | baseline | 402 (389-444) | 36 | 37 | 2,627,312 (2.16M-2.65M) | 1.3936 (1.19-1.42) | plan-only |
| | candidate | 337 (292-405) | 31 | 34 | 2,718,000 (2.14M-2.99M) | 1.4637 (1.29-1.62) | plan-only |
| P2 eBay.pl plan | baseline | 341 (284-351) | 21 | 23 | 1,405,120 (1.02M-2.44M) | 1.0358 (0.82-1.48) | plan-only |
| | candidate | 306 (245-311) | 21 | 22 | 1,445,000 (0.93M-1.53M) | 1.0727 (0.80-1.20) | plan-only |
| P3 quick-sale cut plan | baseline | 248 (224-292) | 16 | 17 | 847,335 (0.72M-0.97M) | 0.7249 (0.60-0.76) | plan-only |
| | candidate | 229 (197-231) | 15 | 17 | 864,933 (0.76M-1.01M) | 0.7871 (0.66-0.80) | plan-only |
| F deal alerts plan | baseline | 354 (327-388) | 19 | 23 | 1,449,357 (1.29M-2.04M) | 1.2022 (1.07-1.30) | plan-only |
| | candidate | 285 (259-310) | 21 | 24 | 1,543,839 (1.42M-1.59M) | 1.1403 (1.04-1.19) | plan-only |
| T CLI description, end to end | baseline (plan + execution) | 425 (394-451) | 27 | 30 | 1,090,475 (0.99M-1.10M) | 1.1868 (0.87-1.23) | 3/3 pass |
| | candidate (Tiny) | 131 (115-312) | 10 | 8 | 368,605 (0.24M-1.22M) | 0.3045 (0.29-1.35) | 3/3 pass |
| P1 end to end | baseline | 4,070 | 113 | 127 | 10,107,703 | 5.3611 | pass (suite + hidden laptopbg) |
| | candidate | 3,255 | 84 | 99 | 7,104,428 | 4.6983 | pass (suite + hidden laptopbg) |

No material regression: the worst candidate medians are P3 cost +8.6 %, F tokens +6.5 % and P1 cost +5.0 % (bar: 15 %). T-2 is the high end of the Tiny range: see bug 1 below.

**Blind quality (§7 rubric):** gpt-6-astra:high `reviewer`, one judge per request, the six runs of both arms mixed under random labels; size calls, size dialogs, `D-size` lines, `size:` keys and timestamps removed. Bundles, judge outputs and the key: `skills-lab/judge/pc09/<req>/`. Mean grade per item, baseline → candidate (3 runs each):

| Item | P1 | P2 | P3 | F |
|---|---|---|---|---|
| Q1 scattered rule named | 1 → 1 | 1 → 1 | 1 → 1 | n/a |
| Q2 prefactor weighed against patch, with reason | 0.5 → 0.5 | 0.5 → **1** | 0.5 → **1** | n/a |
| Q3 no single-adapter seam or same-interface split | 1 → 1 | 1 → 1 | 1 → 1 | n/a |
| Q4 questions have context and a recommendation, no lookup-able facts | 1 → 1 | 1 → 1 | 1 → 1 | 1 → 1 |
| Q5 no dependent questions in one batch | n/a | 1 → 1 | 1 → 0.83 | 1 → 1 |
| Q6 decided / unknown / out of scope and the goal | n/a | n/a | n/a | 1 → 1 |
| Judge's overall ranking (b = baseline, c = candidate) | c b c c b b | b c c b c b | c c b b c b | c c b b b c |
| Q7 T end to end | 1 → 1 (one-line `cli.py` change, suite green) | | | |
| Q8 P1 end to end | 1 → 1 | | | |

The P1 Q2 partials in both arms are strict: candidate plans record a "small prefactor" with churn evidence (commit 28c4f09 touched both lists) but do not spell out the plain patch as the rejected option. The P3 Q5 drop is one candidate batch that asked starting values next to the config-shape question.

**Candidate-only conformance:** size picked: P1-P3 Plan 9/9, T Tiny 3/3. F picked Plan 3/3, not Map, each with a reason ("channel and scheduling are open decisions; the code change itself is small"). That is sound for this request, since the way is clear once the channel is chosen. Fit-check lines per touched module appear in every candidate plan. No map tickets (no Map picked). The F runs asked more questions (11-17 dialogs versus 2-6); the judge found every batch independent and recommended.

**Bugs found and fixed (regression tests red before the fix):**
1. T-2 picked Tiny, but the agent had called `plan3 title` in parallel, which renamed the draft during the size dialog; Tiny's delete hit the old path, the size slot was spent and the run fell back to a full plan. `size` now re-resolves the draft by id after the dialog (38e8baa).
2. Every candidate planner rewrote the whole plan with `write` right after sizing, dropping the `D-size` decision and the `size:` key; for a map that would also drop `kind: map`. Whole-plan writes now keep `size`, `kind` and the `D-size` line, like the model overrides (8ac7ff0).

Neither fix changes the prompts, so the totals above stand.

**Verdict: keep.** No quality item drops by 0.5 or more, Q2 (the point of project care) improves on P2 and P3, the judge ranks a candidate plan first on P1, P3 and F, and no R3 total regresses materially; the Tiny path cuts the small request to about a quarter of its cost and a third of its runtime.

## SK-09 Matt video prompt tunings (A1-A9) versus PC-09

Env: Pi 1.5.0, ce-workflow a4f0ded (A1-A9 from 50cca66 plus B1-B3), same DealFinder clones, runner and requests as PC-09; baseline is the PC-09 candidate (`sk06c`). Runs `plan-runs/sk09a-*` (log `sk09a.log`); P2 and P3 got six repeats because the first three were noisy. One P3 run failed in the runner (the agent made a file named `nul`, which git cannot add) and was replaced. `sk09c` is six more P3 runs on the same code plus a size-wording tweak, which was later reverted (see the bug below). Totals sum every session of a run.

| Request | Arm | n | Runtime s | Turns | Tool calls | Tokens (median, range) | Cost $ (median, range) | Check |
|---|---|---|---|---|---|---|---|---|
| P1 laptop.bg plan | PC-09 | 3 | 337 | 31 | 34 | 2,718,000 | 1.4637 | plan-only |
| | tuned | 3 | 395 | 32 | 36 | 2,249,647 | 1.2366 | plan-only |
| P2 eBay.pl plan | PC-09 | 3 | 306 | 21 | 22 | 1,445,000 | 1.0727 | plan-only |
| | tuned | 6 | 288 | 21.5 | 24 | 1,485,319 | 1.2034 | plan-only |
| P3 quick-sale cut plan | PC-09 | 3 | 229 (197-231) | 15 | 17 | 864,933 (0.76M-1.01M) | 0.7871 (0.66-0.80) | plan-only |
| | tuned (sk09a + sk09c) | 12 | 242 (221-280) | 18 | 19.5 | 1,075,599 (0.94M-1.35M) | 0.8087 (0.75-1.03) | plan-only |
| F deal alerts plan | PC-09 | 3 | 285 | 21 | 24 | 1,543,839 | 1.1403 | plan-only |
| | tuned | 3 | 321 | 21 | 24 | 1,336,683 | 1.1528 | plan-only |
| T CLI description | PC-09 | 3 | 131 | 10 | 8 | 368,605 | 0.3045 | Tiny 2/3 |
| | tuned | 3 | 112 | 9 | 7 | 341,547 | 0.3002 | Tiny 3/3 |
| P1 end to end | PC-09 | 1 | 3,255 | 84 | 99 | 7,104,428 | 4.6983 | pass (suite + hidden laptopbg) |
| | tuned | 1 | 2,258 | 56 | 70 | 3,418,548 | 2.8486 | pass (suite + hidden laptopbg) |

Over the four planning requests together, tuned medians are cost -1.4 % and tokens -6.5 %. Per request, the worst tuned medians are P3 tokens +24 % (cost +2.7 %) and P2 cost +12 %. At three repeats P2 showed +18 % and the first six P3 runs +16 %; the extra repeats pulled both back. Two things drive P3's extra tokens. The tuned planner reads more callers and tests (10-14 bash calls versus 8-11), and the size/title race below costs a failed call and a retry in 5 of 12 runs.

**Blind quality (§7 rubric plus Q9 ADR alternative and Q10 session-sized steps):** gpt-6-astra:high `reviewer`, one judge per request, three PC-09 and three tuned runs (sk09a reps 1-3) mixed under random labels, with sizing scrubbed. Bundles, judge outputs and the key: `skills-lab/judge/sk09/<req>/`. Mean grade per item, PC-09 → tuned:

| Item | P1 | P2 | P3 | F |
|---|---|---|---|---|
| Q1 scattered rule named | 1 → 1 | 1 → 1 | 1 → 1 | n/a |
| Q2 prefactor weighed against patch | 0.5 → **0.83** | 1 → 1 | 1 → 1 | n/a |
| Q3 no single-adapter seam | 1 → 1 | 1 → 1 | 1 → 1 | n/a |
| Q4 questions have context and a recommendation | 1 → 1 | 1 → 1 | 1 → 1 | 1 → 1 |
| Q5 no dependent questions in one batch | n/a → 1 | 1 → 1 | 0.83 → **1** | 0.83 → 0.67 |
| Q6 decided / unknown / out of scope | n/a | n/a | n/a | 1 → 1 |
| Q9 ADR names the alternative that lost | 0 → 0 | n/a | n/a | 0.83 → **1** |
| Q10 session-sized steps with checks | 0 → **0.67** | 1 → 1 | 0.83 → 0.83 | 0 → **0.5** |
| Judge's ranking (b = PC-09, t = tuned) | t t b b b t | t t t b b b | t b b t t b | t t b b t b |

**Map choice (A1):** F still picked Plan 3/3 and no request picked Map, so this run did not exercise the Map path or B1's mid-grill switch.

**Bug found and fixed (regression test red before the fix):** agents batch `plan3 size` with `plan3 title`. Without a dialog to wait on, `title` renames the draft while `size` writes it, and `size` fails with ENOENT. Its retry is then refused, so the `D-size` decision and the `size:` key were lost in 2 of 6 sk09a and 3 of 6 sk09c P3 runs. In sk09c the wording tweak ("otherwise never call size again") did not help, so it was reverted. `size` and `title` now share a per-plan queue, and `size` finds the draft inside it.

**Verdict: keep.** No quality item drops by 0.5 or more. Q10 (A4, session-sized steps) and Q2 improve where PC-09 was weakest, and the judge ranks a tuned plan first on all four requests. Overall cost and tokens are slightly down, and P1 built end to end costs 39 % less. The open item is P3's token growth from extra code reading: watch it in the next comparison before trimming A5.
