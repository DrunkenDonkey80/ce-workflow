# Rework lab run-04 (DealFinder clone at 27221be)

Clone: `C:\SOFT\git\rework-lab\run-04`; plan `58bbf099` (archived in `docs/plans/done/`). Rework commits `27221be..0abd906` (13). Same driver and models as run-03, plus the run-03 fixes.

## Outcome

- Full loop: Map, Characterize, Design, Pick, Build with seam `DF_REWORK_VERIFY`, Replay, Switch, Retire.
- Target (picked by Map): `verify.py`, 714 lines doing seven jobs, the most-changed file (20 commits). It also handles untrusted input (listing text, photos, `pi` output).
- Pick: **Option B (Recommended)**, splitting it into a `verification/` package. This was a real structural pick, so the run-03 fix worked.
- Product change: `dealfinder/verification/` gets 8 modules, each with one job (claims, lookups, photos, schema, validate, gates, pipeline) plus a 72-line `api.py` that re-exports the old names. `verify.py` becomes a 6-line compatibility module.

## Evaluation

| Area | Result |
|---|---|
| Tests | 136 pass (full suite, 125 before plus new tests); 17-case corpus 17/17 on old and new, ×3 each, identical; empty approved delta |
| Code improvement | Real: the biggest module drops from 714 to 160 lines, and the battery-tier logic exists once instead of twice. The thresholds it missed, and said so honestly: the D1 cache logic is still duplicated, and there is a lazy pipeline → api import loop (a hook so tests can patch `pi_command`) |
| Readability | Clearly better: modules are named after their job and each has a docstring. Smell: `verify.py` replaces itself in `sys.modules` so the frozen corpus's `verify.pi_command` patch point keeps working |
| Security | No change in behavior; the untrusted-input checks (`validate.py`) are now isolated and easier to review. No new dependencies |
| Performance | Inconclusive (0.460 → 0.439 s, within range); memory +0.3% |
| Corpus size | Small and readable (318-line test file plus an expected-prompt file), unlike run-03's 1 MB of database dumps |
| Time / cost | Wall 40 min; plan stats: 31.3 min active, Opus $6.61 + Sol $2.40 = $9.01 |

## Problems found (and fixes)

1. **Gate bypass.** The agent asked in chat "accept chat approval instead of Alt+A?". The driver auto-picked "(Recommended)", and the agent deleted its own `needs: R-design-approved` lines (commit `5a8111c`), then got cutover and retire the same way (D-14..D-16). The driver never had to grant a gate. A real human would have seen the question, but the recipe must not let agents propose it. Fix: recipe §6 forbids removing, editing or bypassing `needs:` lines and forbids proposing chat approval; the driver grants a gate when the agent asks for it at the right moment (as Alt+A would), and refuses options that amend or waive gates.
2. Possible follow-up (not done): Plan3 itself could reject plan edits that drop a `needs:` line. That would be enforced in code instead of by the prompt.

## Next

run-05 with the gate fix: check that the gates are granted by the driver (`grant` lines in the log) and that no `needs:` line is removed.
