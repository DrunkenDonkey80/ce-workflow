# Rework lab run-03 (DealFinder clone at 27221be)

Clone: `C:\SOFT\git\rework-lab\run-03`; plan `9c938ec0` (archived in `docs/plans/done/`). Rework commits `27221be..180d4b0` (20). Driver: `scripts/rework-lab.mjs`, Opus 5.5 planning, GPT-6.1 Sol high coding.

## Outcome

- Full recipe loop ran to the end: Map, Characterize, Design, Pick, Build with seam `DF_REWORK_SIDE`, Replay, Switch, Retire (seam removed).
- Target (picked by Map): Bulgarian sources layer (`dealfinder/sources/*`, `sync.sync_bg`). Reasoned well against `verify` and `sync`.
- Pick: **L, local repair**. Not a real choice: no option was marked recommended, and the driver took the first option after "Stop". Design leaned to R (source catalog) if the goal is easier source additions.
- Product change: `text()` moved from `kvant.py` to new `sources/common.py`; 3 imports changed. Nothing else.

## Evaluation

| Area | Result |
|---|---|
| Tests | 125 pass (full suite); corpus 6/6 old and new, stable ×3, planted bug caught |
| Code improvement | Minimal: one sibling dependency removed; DUP-2..4 and the 6-files-per-shop pain (SC-1) untouched |
| Readability | Product: neutral to slightly better. Corpus: `tests/rework/baseline.json` is 22k lines (full DB table dumps per case, about 1 MB): strict but unreadable |
| Security | No change in behavior or surface |
| Performance | Inconclusive by design: cold 0.224 → 0.221 s, warm 0.065 → 0.066 s, all within spread; memory +0.01% |
| Design quality | Strong: three distinct options with import-cycle, stored-state and rollback analysis; self-review corrected its own overclaims; DES-02 experiment found a real clock-patch trap |
| Time / cost | Wall 77 min; plan stats: 37.6 min active, Opus $3.59 + Sol $1.43 = $5.02 (planning-session cost not in the stats file) |

## Problems found (and fixes)

1. Pick without a marked recommendation → the driver chose by position. Fix: driver answers in free text ("go with your recommendation"); recipe now requires a goal-based recommendation marked "(Recommended)".
2. No goal in the request → Design recommended "stop or L" by default. Fix: lab request states the goal; recipe says Design judges options against it.
3. Map, Characterize and Design ran inside the planning session on Opus, including the `[code]` Characterize phase. Fix: request and recipe say planning writes the plan only.
4. After the plan was archived to `done/`, the driver lost it and `/resume3` resumed the clone's old plan `7003a034` (commit `6f2f0a0`, plan files only). Fix: driver follows the plan into `done/`.
5. (run-02/run-03 driver bugs, fixed earlier) hub env leak, missing `/plan3 finish`, gates granted too early, Requirements checklist loop.

## Next

run-04 with the same baseline and the fixes above; compare whether Pick lands on a structural option and what Build then produces.
