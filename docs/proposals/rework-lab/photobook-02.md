# Rework lab photobook-02 (PhotoBook clone at 5cb626e, merged recipe)

Clone: `C:\SOFT\git\rework-lab\photobook-02`; plan `28025ea7` (archived in `docs/plans/done/`). Rework commits `5cb626e..481386e` (15, no checkpoint loop). Same driver and models as photobook-01. The recipe now has Matt Pocock's ideas (§0 vocabulary, deletion test, churn-scoped Map with candidates and future-changes counts, corpus above the target's interface, Design It Twice with 3 parallel sub-agents).

## Outcome

- Map: 5 candidates (K1 atomic workspace writes, K2 field table, K3 public allowlist, K4 client mutation runner, K5 domain split, rejected by the deletion test). A runtime probe proved the bug K1 hides: 10 concurrent audit appends kept **1 of 10**.
- Design It Twice ran as real parallel sub-agents (run `971c8510`): minimal, common-caller, ports and adapters. Ports were rejected as a hypothetical seam (one real adapter).
- First Pick returned to Design: the agent's own acceptance review found its pick did not improve every future change. Revised pick K1″ = callback-only writes + an exhaustive field-visibility table.
- Product change:
  - `updateWorkspace(id, current => patch)` is the only write form; `saveWorkspace` is private; `importWorkspace` is locked.
  - All 52 production calls in 27 files now derive their patch inside the lock.
  - `WORKSPACE_FIELDS` classifies every workspace key; it derives `PublicProjectWorkspace`, and the public projection becomes an allowlist.
  - Creation reuses `normalizeWorkspace`, removing the 30-line defaults block.
- Two approved behavior changes, kept in `approved-delta.ts`: concurrent appends are kept (10/10), and unknown private fields no longer reach the browser.

## Evaluation (vs photobook-01)

| Area | photobook-01 (old recipe) | photobook-02 (merged) |
|---|---|---|
| Change | store/normalizer/facade split, same 14 methods, callers untouched | write interface narrowed, 52 call sites migrated, field table |
| Deletion test | moves complexity | concentrates it (lock rule out of 52 callers, field knowledge into one table) |
| Caller rules | unchanged (4) | 4 → 1 |
| Future changes (files/sites) | not measured | new field 3/6 → 2/3; concurrent append 1/2 → 1/1; deletion-respecting writes 29+ files → 1 site |
| Bugs | none found | lost-update bug proven and fixed; private-field leak path closed |
| Tests (my rerun, `vitest --maxWorkers=4`) | 1156/1164, same 8 pre-existing failures | 1160/1160, 206 files; build green |
| Corpus | 12 cases through the repository class | 7 cases above the interface (HTTP and payment harness) + 2 approved deltas; stable 5/5, planted bug caught |
| Performance | thresholds passed | absolute threshold missed on both old and new (machine load); interleaved pairs show no regression. Recipe §4 now uses relative, interleaved thresholds |
| Gates | held, ~1 h driver loop | held, no loop; human classified both deltas |
| Time / cost | 64.7 min active, $10.99 | 84.8 min active, $15.24 (Opus $11.42 + Sol $3.82), sub-agent and advisor runs not included |

## Verdict

The merge gives the change photobook-01 should have made: a smaller interface, a rule moved into the module, a real bug fixed, and fewer files for the next changes, with every test green. Matt's half finds and shapes the right change. Ours proves it safe: the corpus, replay, approved deltas, stored-format rehearsal and gates. His skill stops at a grilling conversation, with no verification, so it replaces our Map and Design, not the loop.
