---
plan3: true
status: ready
created: 2026-11-13
updated: 2026-11-13T07:10:09.640Z
started: 2026-11-13T07:10:09.640Z
---

# Wider Haystack review: the parts the first pass skipped

## Original request

> "I expected more tbh. Can we do a wider analysis of haystack to see if there is anything else worth taking"

Context: the first review (plan 2af79ca5, `docs/proposals/2026-11-12-haystack-review.md`) covered only the 16 agent-runtime areas (A1 to A16) and produced five accepted ideas. The umbrella plan b71bab2b then kept two of them (`scripts/compare-benchmark-runs.mjs`, `extensions/run-budget.ts`) and dropped three after measuring them (D-08 to D-10 there). The first review marked everything else "RAG, no counterpart", which was partly wrong: several of those parts line up with things ce-workflow has.

User answers (ask_user, 2026-11-13):
- Areas: all six offered (retrieval and ranking; model calls with fallback, rate limits and routing; web and ingestion; security utilities; evaluators; engineering process).
- Method: "Same as last time". That means a Plan3 plan, a desk review plus Astra's independent verdicts, merged, then accept/reject popups. After that, each accepted idea is built or dropped after measuring it.

## Goal, requirements, and non-goals

**Goal:** find any further Haystack ideas worth taking from the six areas below, with fewer dead ends than last time, then build the accepted ones that measurement supports.

Requirements:

- R1: every area B1 to B6 gets a verdict with a reason, the ce-workflow counterpart it was compared with, and upstream `path:line` evidence at the pin (D-02).
- R2: Astra reviews the same areas without seeing our verdicts or this plan. The review doc shows both verdicts, the agreement count, and how each disagreement was settled in code (D-03).
- R3: before an idea reaches the user, it carries a cheap local number showing the gap it would fix, such as a session-log scan or a count in our code. An idea with no measurable gap is either offered with that stated plainly or dropped (D-04).
- R4: each shortlisted idea goes through `plan3` action `ideas`, and its accept or reject is recorded in Decisions.
- R5: each accepted idea is built in this plan. An idea that touches runtime cost is kept or reverted by the AGENTS.md Optimization Regression Rule; any other idea is kept or reverted by its own focused test (D-05).
- R6: `docs/upstream/haystack.md` gains the second-pass verdicts. A catch-up watch entry is added only for upstream paths whose code we port (umbrella D-11 reasoning).

Review scope (D-01). Paths are under `haystack/` at the pin unless noted. Counterparts are starting points, not verdicts.

| Area | Haystack paths | ce-workflow counterpart to compare |
|---|---|---|
| B1 Retrieval and ranking | `components/retrievers/` (in_memory BM25, multi_query, sentence_window, auto_merging), `components/rankers/` (lost_in_the_middle, llm_ranker, meta_field), `components/query/query_expander.py`, `components/joiners/`, `document_stores/in_memory/` | durable-knowledge recall in `extensions/work-knowledge.ts` (word overlap plus fixed bonuses, near line 721), `extensions/jev-tools.ts` ranking, `symbol_search`, the `tools_enable` list |
| B2 Model calls | `components/generators/chat/fallback.py`, `_rate_limit_headers.py`, retry and timeout handling in `openai.py`, `components/routers/llm_messages_router.py`, `conditional_router.py` | compaction model candidates in `extensions/work-compaction-memory.ts`, model pickers and roles in `extensions/work-models.ts`, `extensions/advisor-model.ts` |
| B3 Web and ingestion | `components/fetchers/link_content.py`, `components/converters/` (html, markdown, pdf, output_adapter), `components/preprocessors/` (document_cleaner, splitters, markdown_header_splitter) | `extensions/browser-fetch.ts`, `extensions/browser-search.ts`, `extensions/plan3-web.ts`, video digests in the sibling `yt-ingest` repo (comparison only, no edits there) |
| B4 Security utilities | `utils/jinja2_sandbox.py`, `core/serialization_security.py`, `utils/url_validation.py`, `utils/auth.py` (Secret) | `extensions/redact.ts`, browser-fetch site approval, hub trust boundaries, `extensions/work-env.ts` |
| B5 Evaluators | `components/evaluators/` (llm_evaluator, faithfulness, context_relevance, sas_evaluator), `components/validators/json_schema.py` | `extensions/work-verification-contract.ts`, benchmark scoring in `scripts/benchmark-*.mjs`, the skills-lab blind judge |
| B6 Engineering process | repo root: `.github/workflows/` (37 files), `test/` layout and markers, `releasenotes/` and reno config, `docs-website/` structure, directory `AGENTS.md` files, lint and type settings in `pyproject.toml` | `scripts/verify-package.mjs`, `scripts/test-*`, `CHANGELOG.md` and the version rule, `AGENTS.md` |

Non-goals:

- Re-reviewing A1 to A16, or revisiting the three ideas dropped in b71bab2b.
- Haystack's integrations repo, Hayhooks and deepset Studio. Embedding or vector infrastructure is out unless B1 shows that our word-overlap recall misses things.
- Editing the `yt-ingest` repo. B3 ideas for it are recorded as notes only.

Acceptance examples:

- `docs/proposals/2026-11-13-haystack-wider-review.md` has six rows (B1 to B6). Each row shows our verdict, Astra's verdict, the final verdict, the reason, the counterpart and `path:line` evidence. Rows marked Adopt idea or Test first also give the gap number, for example "knowledge recall returned nothing in N% of turns that later re-read a recorded fact".
- Each idea popup states its gap number, or says "no measured gap".

## Decisions

- **D-01 Scope: all six areas B1 to B6.** Source: user via ask_user 2026-11-13.
- **D-02 Same pin and clone as the first pass.** `deepset-ai/haystack` at `104a83f8799b1b8d9d18a88eb9a08305133aea2d`, clone at `C:\SOFT\git\haystack-review\haystack` (checked: HEAD 104a83f87, 2026-11-12). Source: agent check.
- **D-03 Method: same as last time.** We write a desk review and Astra writes an independent one. Astra is `openai-codex/gpt-6-astra` at high thinking, running as the builtin read-only `reviewer` (as in 2af79ca5 D-07). The two are merged, then the shortlist goes out as idea popups. Astra gets the clone, the B1 to B6 table and a short capability brief, but not our verdicts. Source: user via ask_user 2026-11-13; the request authorizes this subagent.
- **D-04 Measure the gap before the popup.** Agent proposal based on the umbrella outcome: three of the five accepted ideas had nothing to gain (b71bab2b D-08 to D-10), and a log scan could have ruled each out before it was offered. So a cheap local measurement now runs before the shortlist (R3). Source: agent; the user can veto it at review.
- **D-05 Build accepted ideas in this plan, not in separate follow-up drafts.** This follows the user's later choice of one umbrella plan ("one umbrella plan for all five ... decide keep/not keep and implement") and the option picked 2026-11-13 ("then build or drop each idea after measuring it"). Source: user.
- **D-06 Ports carry the Apache-2.0 notice; re-implementing needs none.** Carried over from 2af79ca5 D-09. Source: user, 2026-11-12.

## Open questions

### Blocking

None.

### Deferred

None. Each idea is accepted or rejected in HW-05, with its numbers attached.

## Relevant files and approach

Reuse the first pass's shapes:
- review doc: `docs/proposals/2026-11-12-haystack-review.md`
- Astra brief and verdicts: `docs/proposals/haystack-review/`
- ledger: `docs/upstream/haystack.md`
- idea popups: `plan3` action `ideas`

Session-log scans follow the umbrella's throwaway scripts: they walk `~/.pi/agent/sessions/**/*.jsonl` and drop duplicate entries. Put a scan in `scripts/` only if it is worth keeping; otherwise put it in `%TEMP%/hs/`.

New files:

- `docs/proposals/haystack-review/astra-brief-wider.md`, `docs/proposals/haystack-review/astra-verdicts-wider.md`
- `docs/proposals/2026-11-13-haystack-wider-review.md`

Verdict words: **Adopt idea**, **Test first**, **Already covered** (name where), **Skip** (with reason).

Commands:

- C1 Astra: `subagent` with agent `reviewer` and model `openai-codex/gpt-6-astra:high`, run async. The task points at the brief and asks for `astra-verdicts-wider.md`.
- C2 focused tests: only the touched module's existing `scripts/test-*.mjs` (AGENTS.md Test Scope Rule).
- C3 regression comparison for runtime-cost ideas: `node scripts/compare-benchmark-runs.mjs <baseline> <candidate>`.

## Phases

### Phase 1: Review [think]

- [x] **HW-01** Astra brief docs/proposals/haystack-review/astra-brief-wider.md written (B1-B6 table, counterpart summaries, gap-measure ask); Astra run a6b7b88f launched async.
- [wip] **HW-02** Write the desk review of B1 to B6 into the review doc without reading Astra's file, and list candidate ideas.
- [ ] **HW-03** For each candidate, measure the gap it would fix with a local scan or code count; drop or flag candidates with no gap (D-04).
  - B1: recall misses (turns that re-read or re-ask a fact the knowledge store already had).
  - B2: provider errors and retries in session logs.
  - B3: browser_fetch page sizes and the share of boilerplate.
  - B6: run time and flaky failures of `npm run verify`.
- [ ] **HW-04** When Astra lands, merge its column, count agreement, settle disagreements in code, and write the shortlist with gap numbers.

### Phase 2: Idea review [think]

- [ ] **HW-05** Offer the shortlist through `plan3` `ideas`; record each accept or reject in Decisions.

### Phase 3: Build and keep or drop [code]

- [ ] **HW-06** Build each accepted idea with a focused test (C2); keep or revert by R5, one local commit per idea.
  - Steps per idea are added with `plan3` `add` after HW-05.

### Phase 4: Records [code]

- [ ] **HW-07** Update docs/upstream/haystack.md with B1 to B6 verdicts, adopted and dropped ideas, and the watch decision (R6).
  - Add CHANGELOG Unreleased bullets for anything user-visible.

## Global validation

- R1 to R6 hold, and the acceptance examples match the files.
- Every kept change passes its focused test. Every runtime-cost change has a C3 comparison with no material overall regression.
- Nothing is pushed.

## Resume context

Plan drafted 2026-11-13 from the user's answers; nothing has run yet. Next: HW-01 (Astra brief and launch), with HW-02 alongside it.

## Amendments

None.
