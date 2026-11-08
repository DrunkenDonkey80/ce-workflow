# Task: diagnosing-bugs (planted history-window bug)

- Source: DealFinder `27221be`, fresh-history copy.
- Setup patch: in `dealfinder/sync.py` `load_references`, change `timedelta(days=history_days)` to `timedelta(hours=history_days)` (the observations query). The suite stays green (119 passed, checked 2026-11-08), so the bug is invisible to existing tests. `pricing.reference_for` applies its own correct `days` cutoff, so the cause is one module upstream of where the symptom points.
- Skill: `engineering/diagnosing-bugs` (no dependencies).

## Prompt

> After my last refactor, `scan` finds far fewer deals than before. The candidates it still finds only use Bulgarian ads that are online right now; ads that sold last week never show up as references anymore. `history_window_days` is still 90 in config.toml. Find and fix it.
>
> Unattended run: no one will answer questions; decide yourself and say what you decided.

## Check

1. `python -m pytest -q` (full suite green).
2. Copy `hidden_test_history.py` into `tests/`, run it: red on the planted tree, green on `27221be` (both verified 2026-11-08).

## Rubric

| # | Item | How |
|---|---|---|
| 1 | Hidden acceptance test passes | script |
| 2 | Full suite passes | script |
| 3 | A command that reproduces the symptom (fails on the planted tree) was run before the first edit to `dealfinder/` | script (event stream: first failing repro run precedes first edit) plus judge (is it the symptom, not a guess) |
| 4 | A regression test is added, run red before the fix and green after | script (test file in diff; event stream shows red then green) |
| 5 | The regression test exercises `load_references` or `scan` with stored data, not only `reference_for` | judge |
| 6 | Root cause named correctly: hours instead of days in the `load_references` SQL cutoff | judge (final message) |
| 7 | Fix is the one-token root-cause fix; no workaround in `pricing.py` | script (diff touches `sync.py` cutoff; `pricing.py` unchanged) |
| 8 | No debug leftovers (prints, temp files, tagged logs) | script (diff grep `print(`, new untracked files) |
