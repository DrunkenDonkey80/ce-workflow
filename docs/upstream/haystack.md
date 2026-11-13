# Haystack: what we took and what we left

Upstream: [deepset-ai/haystack](https://github.com/deepset-ai/haystack) (Apache-2.0). Reviewed at commit `104a83f8799b1b8d9d18a88eb9a08305133aea2d` (2026-11-12, `VERSION.txt` 3.6.0-rc0), agent-runtime overlap only (areas A1 to A16). Evidence: plan `docs/plans/2026-11-12-review-deepset-ai-haystack-for-ideas-to-borrow-with-an-astra-2af79ca5-plan3.md`, desk review with Astra merged `docs/proposals/2026-11-12-haystack-review.md`, Astra's independent review `docs/proposals/haystack-review/astra-verdicts.md` (agreement 9 of 16).

No catch-up watch: the two kept ideas are re-implementations, not ports, so no upstream path is tracked (umbrella plan D-11).

## Adopted

All five accepted ideas were measured in one umbrella plan, `docs/plans/done/2026-11-12-umbrella-plan-for-the-five-accepted-haystack-ideas-review-pl-b71bab2b-plan3.md`, which replaced the five per-idea drafts.

| Idea | Upstream path (idea source) | Ours | Evidence |
|---|---|---|---|
| Pair benchmark runs with the baseline and show missing ones (A14) | `haystack/evaluation/eval_run_result.py` | `scripts/compare-benchmark-runs.mjs`, named in the AGENTS.md Optimization Regression Rule | HU-01 |
| Warn before stopping a runaway run (A3) | `haystack/hooks/budget/hooks.py` | `extensions/run-budget.ts`: turns without progress since the last human message, reminder 10 turns before the limit (default 150, `runBudget.turns`), then tools blocked and night mode paused | HU-02, D-03 to D-06 |

## Dropped after measurement

| Idea | Why |
|---|---|
| Better compaction summaries: two prompt rules and error feedback (A1, A5) | Fallback is already 0.2% (1 of 541) since the checkpoint got real room; no failure left to fix (D-08) |
| Prune old tool results at the Ultrafull checkpoint (A1) | A safe cut saves 6% of the kept tail (D-09) |
| Save large non-bash tool results to a file with a pointer (A2) | In-scope tools' large results are 0% of tool-result characters (D-10) |

## Rejected

None at idea review. Areas judged not worth borrowing are under Skipped.

## Already covered here

A4 human in the loop (ask_user dialogs, research Git guard, browser and camera consent), A6 hook protocol (Pi events), A7 agent loop and state (Pi owns the loop, Plan3 the durable state), A8 searchable toolset (deferred situational tools in `extensions/tool-loader.ts`), A9 skills (Pi's skill loader), A10 agents and pipelines as tools (pi-subagents, codemode), A12 token counting (billed-token tail in `extensions/work-compaction.ts`), A16 dev process (focused tests, CHANGELOG, version rule). Reasons per area: the review doc.

## Skipped

A11 breakpoints and snapshots (we do not own Pi's execution engine; Plan3 checkpoints and sessions cover resume), A13 tracing and telemetry (compaction outcomes are already in session entries and `scripts/audit-compaction.mjs`; no tracing backend, no external telemetry), A15 caching (document dedup, not prompt caching; no safe freshness policy for coding tools).

## Out of scope (first pass)

RAG and integrations: embedders, readers, extractors, classifiers, the pipeline graph engine and serialization, chat generator integrations and `docs-website/`. Retrieval, ranking, converters, preprocessors, routers, fallback, security utilities, evaluators and engineering process got the second pass below.

## Second pass (B1 to B6)

Same pin. Plan `docs/plans/2026-11-13-wider-haystack-review-the-parts-the-first-pass-skipped-19abb9ec-plan3.md`; review with gap measurements and the Astra merge `docs/proposals/2026-11-13-haystack-wider-review.md`; Astra's review `docs/proposals/haystack-review/astra-verdicts-wider.md` (agreement 4 of 6). Every gap was measured on 19 days of session logs before an idea was offered.

| Area | Final | Why |
|---|---|---|
| B1 Retrieval and ranking | Adopted (small) | Unicode/NFC query tokens and Bulgarian stop words in `extensions/work-knowledge.ts` (idea source: the tokenizer in `haystack/document_stores/in_memory/document_store.py`, re-implemented). A Bulgarian-only query matched nothing. Replay of 1,294 prompts: precision unchanged (60% of recalled claims judged useful). Two precision tweaks were tried and dropped: skipping timer wake-ups lowered precision to 47%, and no score floor separates useful from noisy user-wide claims. |
| B2 Model calls | Already covered | Compaction already falls back across models; 4 usage-limit stops in 19 days. |
| B3 Web and ingestion | Dropped | Main-content extraction would trim about a quarter of 343k fetched characters in 19 days. |
| B4 Security utilities | Already covered | Our URL checks are stronger than `utils/url_validation.py`; no pipeline serialization to guard. |
| B5 Evaluators | Dropped | No compaction-caused loss found in 711 compactions; the faithfulness-judge recipe was used to measure B1. |
| B6 Engineering process | Adopted (one line) | `scripts/test-audit-compaction.mjs` now runs in `npm run verify` (found by Astra). CI dropped: one committer, about 5 minutes of full checks a day. |

No catch-up watch for the second pass either: the tokenizer is a re-implementation, not a port.
