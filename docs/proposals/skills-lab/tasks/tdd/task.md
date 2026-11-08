# Task: tdd (RAM written as modules)

- Source: DealFinder `27221be`, fresh-history copy, no setup patch.
- Skill: `engineering/tdd` plus dependency `engineering/codebase-design`.
- Today `ram()` in `dealfinder/normalize.py` reads "8+8gb ram" as 8, "2 x 16 gb ram" as 16 and "2x8gb ddr4" as unknown.

## Prompt

> Listings often write RAM as modules: "2x8GB DDR4", "8+8GB RAM", "2 x 16 GB RAM", "8GB + 8GB RAM". DealFinder should read these as the total (16, 16, 32, 16). When a listing states the total and the modules ("16GB (2x8GB)"), the total is 16, not 32. Storage modules ("2x512GB SSD") and graphics memory are not RAM. Add this.
>
> Unattended run: no one will answer questions; decide yourself and say what you decided.

## Check

1. `python -m pytest -q` (full suite, including `normalize_cases.json`, green).
2. Copy `hidden_test_ram_modules.py` into `tests/`: 8 of 12 cases fail on `27221be` (verified 2026-11-08); must pass after.

## Rubric

| # | Item | How |
|---|---|---|
| 1 | Hidden acceptance test passes | script |
| 2 | Full suite passes | script |
| 3 | A new test was run and failed before the first edit to `normalize.py` | script (event stream order) |
| 4 | Work proceeds in red-green slices (more than one red run, each followed by an implementation edit), not all tests first | script (event stream) plus judge |
| 5 | New tests call public functions (`ram`, `normalize`) with listing text, not private helpers or regex constants | judge |
| 6 | No tautological assertions (expected value computed by the code under test, or asserting a regex matches itself) | judge |
| 7 | New tests survive a behavior-preserving refactor: after the run, the judge-provided refactor (inline any helper the run added into `ram()`) keeps them green | script (SK-04 applies a mechanical inline when the run added a helper; otherwise item passes) |
| 8 | The "16GB (2x8GB)" and storage-module negatives are covered by the run's own tests | judge |
