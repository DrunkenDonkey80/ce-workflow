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

## writing-for-agents

Phase 1 (write AGENTS.md) judged; the verdict waits for the replay phase (a fresh agent adds a shop source using each AGENTS.md).

| Arm | only AGENTS.md changed | Item 5 (test cmd, offline rule, list locations) | Item 6 no-op lines | Item 7 false claims | Judge rank | Tokens | Cost $ | Runtime s | Turns | Tool calls |
|---|---|---|---|---|---|---|---|---|---|---|
| off | 3/3 | partial ×3 | 1, 1, 0 | 0, 1, 0 | 1, 4, 5 | 422,380 | 0.2007 | 212 | 11 | 10 |
| forced | 3/3 | partial ×3 | 0, 0, 0 | 0, 0, 0 | 2, 3, 6 | 348,144 | 0.1744 | 206 | 9 | 8 |
| unforced (read it) | 1/1 | partial | 0 | 1 | 7 | 380,854 | 0.1904 | 145 | 9 | 8 |

No run named every shop-list location (`report.SHOP_NAMES` and the normalize shop tuple were missed by all). The `only-agents-md` check was rescored without pi-lens probe logs (lab noise, fixed in 73a1dbd).
