# Task: code-review (seeded change with a spec and standards)

- Source: DealFinder `27221be`, fresh-history copy with two commits: base ("DealFinder" plus `files/`), then `change.patch` as "Skip low-feedback eBay sellers". Fixed point = base commit.
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

## Seeded change (`change.patch`, suite still green: 120 passed)

Base commit = `files/` (`CODING_STANDARDS.md`, `docs/specs/seller-feedback.md`) on top of `27221be`. Each planted item is independent:

| ID | Axis | Planted defect (in `change.patch`) |
|---|---|---|
| S1 | Spec, missing | `skipped` is computed in `scan` but never returned as `"skipped_sellers"` |
| S2 | Spec, wrong | unknown feedback (`None`) is skipped instead of kept, both in `chk2` and in the `scan` loop |
| S3 | Spec, scope creep | report subtitle in `report.py` gains "Sellers below the feedback threshold are hidden." |
| S4 | Standards, documented | `config["min_seller_feedback_pct"]` read without a default; not documented in `config.toml` (the change patches the test CONFIG instead) |
| S5 | Standards, documented | the percentage is compared as `float`, not `Decimal` through `pricing.money` |
| S6 | Smell | the feedback check exists twice: `chk2` and an inline copy in the `scan` loop (Duplicated Code) |
| S7 | Smell | new `filters=None` parameter on `scan` that no caller passes (Speculative Generality) |
| S8 | Smell | helper named `chk2` (Mysterious Name) |
| S9 | Spec, missing | the new test has no unknown-feedback case |
| N1 | Decoy, fine | the test builds listings with a small local `seller()` factory instead of fixtures (still offline) |
| N2 | Decoy, fine | skips counted with `sum(1 for ...)` (unusual but clear) |

## Prompt

> Review the changes since `<base sha>` against the spec in `docs/specs/seller-feedback.md` and the project's standards. Report findings; do not change code. You may use subagents.
>
> Unattended run: no one will answer questions; decide yourself and say what you decided.

## Check

None beyond the report (the tree must be unchanged: `git status --porcelain` empty).

## Rubric

| # | Item | How |
|---|---|---|
| 1-9 | S1..S9 each found (finding names the file/line or behavior) | judge, one item each |
| 10 | N1 and N2 not reported as defects (a "judgement call" note is fine, a defect is a false positive) | judge |
| 11 | Other false positives: count of reported defects that are not real | judge (count; reported separately, lower is better) |
| 12 | Spec and standards findings kept apart (no single merged severity ranking across axes) | judge |
| 13 | Tree unchanged | script |
