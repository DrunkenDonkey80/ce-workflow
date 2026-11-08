# Task: code-review (seeded change with a spec and standards)

- Source: DealFinder `27221be`, fresh-history copy with two commits: base ("DealFinder" + the standards file below), then the seeded change "Skip low-feedback eBay sellers". Fixed point = base commit.
- Skill: `engineering/code-review` (no skill dependencies; it spawns two subagents).
- Review only: no repair. Repair would mix review quality with fixing quality.

## Base commit additions

`CODING_STANDARDS.md`:
- Money is `Decimal` through `pricing.money`; never compare prices as floats.
- Every config key is read with a default in code and documented with a comment in `config.toml`.
- Tests use fixtures and fake clients; no network.

`docs/specs/seller-feedback.md` (the spec):
- New config key `min_seller_feedback_pct` (default 98): `scan` skips eBay listings whose seller feedback percentage is below it.
- Listings with unknown feedback are kept.
- `scan` returns the number skipped as `"skipped_sellers"` in its result dict.
- A test covers a skipped, a kept and an unknown-feedback listing.

## Seeded change (built by SK-04 as a patch; each planted item is independent)

| ID | Axis | Planted defect |
|---|---|---|
| S1 | Spec, missing | `"skipped_sellers"` is not added to the `scan` result |
| S2 | Spec, wrong | unknown feedback (`None`) is skipped instead of kept |
| S3 | Spec, scope creep | also changes the report subtitle text in `report.py` |
| S4 | Standards, documented | `min_seller_feedback_pct` read as `config["min_seller_feedback_pct"]` (no default) and not documented in `config.toml` |
| S5 | Standards, documented | margin pre-check compares `float(price)` values in the new filter |
| S6 | Smell | the feedback check is copy-pasted in `scan` and in `worth_detail` (Duplicated Code) |
| S7 | Smell | new `filters=None` parameter on `scan` that no caller passes (Speculative Generality) |
| S8 | Smell | helper named `chk2` (Mysterious Name) |
| N1 | Decoy, fine | the new test builds listings with a small local dict factory instead of the fixtures (allowed: it is still fixture-free and offline) |
| N2 | Decoy, fine | uses a generator expression with `sum(...)` to count skips (unusual but clear) |

## Prompt

> Review the changes since `<base sha>` against the spec in `docs/specs/seller-feedback.md` and the project's standards. Report findings; do not change code. You may use subagents.
>
> Unattended run: no one will answer questions; decide yourself and say what you decided.

## Check

None beyond the report (the tree must be unchanged: `git status --porcelain` empty).

## Rubric

| # | Item | How |
|---|---|---|
| 1-8 | S1..S8 each found (finding names the file/line or behavior) | judge, one item each |
| 9 | N1 and N2 not reported as defects (a "judgement call" note is fine, a defect is a false positive) | judge |
| 10 | Other false positives: count of reported defects that are not real | judge (count; reported separately, lower is better) |
| 11 | Spec and standards findings kept apart (no single merged severity ranking across axes) | judge |
| 12 | Tree unchanged | script |
