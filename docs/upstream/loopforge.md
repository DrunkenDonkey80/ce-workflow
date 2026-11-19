# LoopForge: what we took and what we left

Upstream: [Tencent/LoopForge](https://github.com/Tencent/LoopForge) (MIT, with listed third-party exceptions). Reviewed at commit `6f606cf2a7354f05d1dbf2085f4eb832b7e89ccb` (2026-11-19), everything including the chat workbench and SOP designer UIs. Plan `docs/plans/done/2026-11-19-mine-loopforge-claude-bughunter-and-skillevaluator-for-ce-wo-3f8f9ab7-plan3.md`; review with measurements and the blind Astra merge `docs/proposals/2026-11-19-loopforge-bughunter-skillevaluator-review.md` (areas L1-L14).

No catch-up watch yet: nothing is built. The umbrella plan adds a scoped entry when it builds an idea from this repo (D-09, user: "Only when built").

## Pending (accepted, not built)

Umbrella plan: `docs/plans/2026-11-19-build-the-three-accepted-loopforge-and-skillevaluator-ideas-5e4d224a-plan3.md`.

| Idea | Upstream path (idea source) | Ours (planned) |
| --- | --- | --- |
| L13 Quiet-process notice: show a running command that printed nothing for a while, with its last line; never kill | `internal/procwatch/procwatch.go:60` | tool rows via `extensions/plan3-web.ts:144-148` (UB-03) |
| L3 Post-plan retro: digest of a plan's stats, recommendations for the project flow and for ce-workflow, trialled offline on finished plans across models first | `internal/runeval/facts.go:72`, `internal/domain/run_eval.go:40`, `internal/runeval/apply.go:10` | `extensions/plan3-stats.ts` (UB-04 to UB-07) |

## Rejected

None at idea review.

## Not covered, not recommended (user may revive)

L2 tool-backed step gate (63% of 412 Plan3 checks already trace to a run), L6 per-turn diagnostic export (an obscured first error happened 3 times in 152,612 replies), L12 acceptance matrix (tests already map by module name).

## Already covered here

L1 run engine (Plan3 steps and resume), L4 roles (pi-subagents agents and phase models), L6 error record (Pi session logs), L8 scheduling (`schedule` tool, agents audit), L9 chat workbench (hub steering, dialogs, files), L11 knowledge (`extensions/work-knowledge.ts`), L12 dev process (AGENTS.md, `scripts/verify-package.mjs`), L14 devflow (Plan3 and `/resume3`).

## Skipped

L5 issue and merge tracking (local-commit workflow), L7 missing-price accounting (0 of 93,802 replies lacked a cost), L10 graphical SOP designer (Plan3 diagram covers architecture), L13 sandboxes and runners (multi-user remote execution).
