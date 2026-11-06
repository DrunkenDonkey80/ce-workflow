# Rework lab run-05 (DealFinder clone at 27221be)

Clone: `C:\SOFT\git\rework-lab\run-05`; plan `32a54c11` (archived in `docs/plans/done/`). Rework commits `27221be..c04824c` (15). Same driver and models, plus the run-04 gate fix.

## Outcome

- Full loop. The **gates held**: the driver granted R-design, R-cutover and R-retire itself (`grant` lines in the log), and no `needs:` line was removed (`git log -S"needs: R-"`).
- Target and pick were the same as run-04 (`verify.py`, package split, recommended option B), reached independently. Map and Design gave a stable answer two runs in a row.
- Product change: `verification/` has 4 modules (`makers` 165, `photos` 121, `runner` 206, `verdict` 288 lines), each with an explicit `__all__`. `verify.py` is a 2-line `from .verification import *` facade. That is cleaner than run-04's `sys.modules` swap.

## Evaluation

| Area | Result |
|---|---|
| Tests | 141 pass (119 original + 15 corpus + 7 new helper checks); corpus 15/15 identical ×5 per side |
| Code improvement | Real: max module 714 → 288 lines, no import cycles, total 787 lines (+73 for the module split). Coarser than run-04 (4 modules instead of 8) |
| Readability | Good. The facade is plain Python. One oddity: three existing tests now patch `f"{verify_listing.__module__}.pi_command"`, where a literal `dealfinder.verification.runner.pi_command` would be clearer |
| Contract change | `dealfinder.verify.pi_command` is no longer the patch point. The human approved this up front (D-10, a mechanical test move); no assertion changed |
| Security | No change in behavior; the scorecard explicitly checks the boundary controls (photo permission, CDN allow-list, subprocess `--` flags) |
| Performance | Neutral (2.0 s median both sides) |
| Time / cost | Wall 52 min; plan stats: 42.6 min active, Opus $4.45 + Sol $2.77 = $7.22 |

## run-04 vs run-05

| | run-04 | run-05 |
|---|---|---|
| Modules / max lines | 8 / 160 | 4 / 288 |
| Compatibility | `sys.modules` swap, lazy import cycle | star-import facade, acyclic |
| Old tests edited | no | 3 patch targets (approved) |
| Gates | bypassed by chat | held, granted by driver |
| Cost | $9.01 | $7.22 |

## Problems found

None that block. Open items: `/plan3` could enforce `needs:` lines in code; the run costs leave out the planning session.

## Verdict

The recipe now produces a real structural rework with honest scorecards and gates that hold, and gives the same answer in repeated runs. Ready for a more serious project.
