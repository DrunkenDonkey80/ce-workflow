# Rework lab photobook-01 (PhotoBook clone at 5cb626e)

Clone: `C:\SOFT\git\rework-lab\photobook-01`; plan `a5a54d43` (archived in `docs/plans/done/`). Rework commits `5cb626e..e5a3bbd` (30, of which about 14 are checkpoint commits from the stuck gate loop). Same driver and models. No `.env` and no `.local-data`, so only mock providers ran.

## Outcome

- Full loop. The gates held: the driver granted all three, and no `needs:` line was removed.
- Target (picked by Map from 4 candidates): project persistence, `server/services/projectRepository.ts` (689 lines: file I/O, locking, legacy-record migration and domain rules in one class).
- Pick: Option 2 (Recommended), a store / normalizer / facade split.
- Product change: `projectStore.ts` (108 lines: file I/O, safe IDs, atomic writes, per-project lock), `projectRecordNormalizer.ts` (331 lines: legacy-record defaults and validation) and `projectRepository.ts` as a 281-line facade with the same public API. The callers did not change.

## Evaluation

| Area | Result |
|---|---|
| Tests | 1156/1164 pass. The same 8 tests fail on the untouched `5cb626e` (checked in a separate worktree), so there are no new failures. +15 tests (12-case corpus plus 3 compatibility tests); corpus 12/12 identical on both sides, 5 final runs |
| Code improvement | Real: largest module 689 → 331 lines, largest function 70 → 48 lines, total +31 lines. Each class has one job |
| Readability | Good: short JSDoc per method, and the store's "why" comment on `%2F` decoding is kept |
| Security | Kept and pinned by the corpus: path-traversal guard (PB-REPO-003), owner/foreign 401/403 and public DTO redaction (PB-REPO-011), consent revocation before cleanup (PB-REPO-007), paid-state protection (PB-REPO-008) |
| Behavior questions | One unresolved behavior (a deleted project is returned by find-by-email) went to the human and was preserved (D-14), as the recipe requires |
| Performance | Not a goal of this split; the scorecard's thresholds passed |
| Seam | Test-only (a Vitest alias, D-17): replay proved both sides, but production had no runtime switch. Rollback after Switch would have been a git revert. The recipe §3 note was added |
| Time / cost | Wall 2 h 24 min, including about 1 h stuck at the gate; plan stats: 64.7 min active, Opus $5.82 + Sol $5.18 = $10.99 |

## Problems found (and fixes)

1. **Driver gate bug.** `nextGate` required every earlier step to be `[x]`, but Pick stays `[human]`; and checkpoint commits reset the stall counter. Result: about 1 h of "awaiting gate" checkpoint commits. Fix: `[human]` steps count as passed, gate stalls are measured on step markers only, and `--resume` continues an existing run.
2. **Test-only seam.** Fine for the lab; the recipe now says what it means for rollback.
3. Not checked: D-10 named 7 cross-project scan callers as part of the target, but the final diff leaves them unchanged, so the scope narrowed to the repository class.

## Verdict

The recipe works on a larger TypeScript project with security invariants: a real structural improvement with no new failures, and the gates and the human classification held. Remaining driver risk is loops; the end-of-run timer plus a checkpoint watchdog cover it.
