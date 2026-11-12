# Haystack: what we took and what we left

Upstream: [deepset-ai/haystack](https://github.com/deepset-ai/haystack) (Apache-2.0). Reviewed at commit `104a83f8799b1b8d9d18a88eb9a08305133aea2d` (2026-11-12, `VERSION.txt` 3.6.0-rc0), agent-runtime overlap only (areas A1 to A16). Evidence: plan `docs/plans/2026-11-12-review-deepset-ai-haystack-for-ideas-to-borrow-with-an-astra-2af79ca5-plan3.md`, desk review with Astra merged `docs/proposals/2026-11-12-haystack-review.md`, Astra's independent review `docs/proposals/haystack-review/astra-verdicts.md` (agreement 9 of 16).

No catch-up watch yet. The first follow-up plan that builds an idea adds the `deepset-ai/haystack` entry to `extensions/work-catch-up-baseline.json`, with `paths` limited to the adopted ideas' upstream paths below. Code ports carry the Apache-2.0 license and attribution notice; re-implementing needs neither.

## Accepted, build pending

Each idea has its own follow-up Plan3 draft that builds and measures it; nothing is adopted until that plan keeps it.

| Idea | Upstream path | Our counterpart | Follow-up |
|---|---|---|---|
| Warn before stopping a runaway run (A3) | `haystack/hooks/budget/hooks.py` | Runaway-run plan `docs/plans/2026-09-27-001-fix-unbounded-direct-agent-runs-plan.md`, `extensions/plan3-night.ts` | draft `docs/plans/2026-11-12-warn-before-stopping-a-runaway-run-from-haystack-review-5bd4eebd-plan3.md` |
| Pair benchmark runs with the baseline and show missing ones (A14) | `haystack/evaluation/eval_run_result.py` | `scripts/benchmark-context-cache-live.mjs`, AGENTS.md Optimization Regression Rule | draft `docs/plans/2026-11-12-pair-benchmark-runs-with-the-baseline-and-show-missing-ones--0c43697c-plan3.md` |
| Better compaction summaries: two prompt rules and error feedback (A1, A5) | `haystack/hooks/compaction/summarization.py`, `haystack/hooks/structured_output/hooks.py` | `extensions/work-compaction-memory.ts` | draft `docs/plans/2026-11-12-better-compaction-summaries-two-prompt-rules-and-error-feedb-83818785-plan3.md` |
| Prune old tool results at the Ultrafull checkpoint (A1) | `haystack/hooks/compaction/tool_result_pruning.py` | `extensions/work-compaction.ts`, Ultrafull mode in `extensions/work-models.ts` | draft `docs/plans/2026-11-12-prune-old-tool-results-at-the-ultrafull-checkpoint-from-hays-ac641457-plan3.md` |
| Save large non-bash tool results to a file with a pointer (A2) | `haystack/hooks/tool_result_offloading/` | Giant-result cut in `extensions/work-models.ts`, `extensions/work-images.ts` | draft `docs/plans/2026-11-12-save-large-non-bash-tool-results-to-a-file-with-a-pointer-fr-1feda303-plan3.md` |

## Rejected

None at idea review. Areas judged not worth borrowing are under Skipped.

## Already covered here

A4 human in the loop (ask_user dialogs, research Git guard, browser and camera consent), A6 hook protocol (Pi events), A7 agent loop and state (Pi owns the loop, Plan3 the durable state), A8 searchable toolset (deferred situational tools in `extensions/tool-loader.ts`), A9 skills (Pi's skill loader), A10 agents and pipelines as tools (pi-subagents, codemode), A12 token counting (billed-token tail in `extensions/work-compaction.ts`), A16 dev process (focused tests, CHANGELOG, version rule). Reasons per area: the review doc.

## Skipped

A11 breakpoints and snapshots (we do not own Pi's execution engine; Plan3 checkpoints and sessions cover resume), A13 tracing and telemetry (compaction outcomes are already in session entries and `scripts/audit-compaction.mjs`; no tracing backend, no external telemetry), A15 caching (document dedup, not prompt caching; no safe freshness policy for coding tools).

## Out of scope

RAG and integrations: document stores, retrievers, rankers, embedders, converters, preprocessors, splitters, readers, extractors, classifiers, routers, joiners, the pipeline graph engine and serialization, chat generator integrations and `docs-website/`.
