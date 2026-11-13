---
plan3: true
status: complete
created: 2026-11-13
updated: 2026-11-13T07:47:00.194Z
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
### IDEA-e550c9eb: K1: make knowledge recall quieter and fix non-Latin queries

> Recall precision improves on the replay without losing known-good matches; focused tests scripts/test-work-knowledge.mjs and scripts/test-work-knowledge-retrieval.mjs pass.
### IDEA-f35158c9: Add the missing compaction-audit test to npm run verify

> npm run verify lists and runs test-audit-compaction.mjs.



## Decisions

- **D-01 Scope: all six areas B1 to B6.** Source: user via ask_user 2026-11-13.
- **D-02 Same pin and clone as the first pass.** `deepset-ai/haystack` at `104a83f8799b1b8d9d18a88eb9a08305133aea2d`, clone at `C:\SOFT\git\haystack-review\haystack` (checked: HEAD 104a83f87, 2026-11-12). Source: agent check.
- **D-03 Method: same as last time.** We write a desk review and Astra writes an independent one. Astra is `openai-codex/gpt-6-astra` at high thinking, running as the builtin read-only `reviewer` (as in 2af79ca5 D-07). The two are merged, then the shortlist goes out as idea popups. Astra gets the clone, the B1 to B6 table and a short capability brief, but not our verdicts. Source: user via ask_user 2026-11-13; the request authorizes this subagent.
- **D-04 Measure the gap before the popup.** Agent proposal based on the umbrella outcome: three of the five accepted ideas had nothing to gain (b71bab2b D-08 to D-10), and a log scan could have ruled each out before it was offered. So a cheap local measurement now runs before the shortlist (R3). Source: agent; the user can veto it at review.
- **D-05 Build accepted ideas in this plan, not in separate follow-up drafts.** This follows the user's later choice of one umbrella plan ("one umbrella plan for all five ... decide keep/not keep and implement") and the option picked 2026-11-13 ("then build or drop each idea after measuring it"). Source: user.
- **D-06 Ports carry the Apache-2.0 notice; re-implementing needs none.** Carried over from 2af79ca5 D-09. Source: user, 2026-11-12.
- IDEA-e550c9eb: accepted — K1: make knowledge recall quieter and fix non-Latin queries. Source: user via Plan3 idea review; not independently verified. Response: {"kind":"selection","selections":["Accept (Recommended)"]}
- IDEA-f35158c9: accepted — Add the missing compaction-audit test to npm run verify. Source: user via Plan3 idea review; not independently verified. Response: {"kind":"selection","selections":["Accept (Recommended)"]}
- **D-07 Accepted: K1 recall precision (IDEA-e550c9eb) and the verifier omission (IDEA-f35158c9).** Dropped before the popup on measured gaps: B2 fallback, B3 main-content fetch, B4 security, B5 summary audit, B6 CI. Source: user via plan3 ideas 2026-11-13.




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
- [x] **HW-02** Desk review written: B4 Already covered, B1/B2/B3/B5/B6 Test first; 5 candidates K1 recall, W1 main-content fetch, M1 side-model fallback, E1 checkpoint faithfulness, T1 fast tests.
- [x] **HW-03** Gaps measured from 19 days of session logs: K1 real (half of recall turns carry no useful claim), W1/T1 small, M1/E1 none.
- [x] **HW-04** Astra merged (agreement 4 of 6); shortlist: K1 recall precision, verifier omission; B2/B3/B4/B5 and CI dropped on measured gaps.

### Phase 2: Idea review [think]

- [x] **HW-05** User accepted both shortlisted ideas (K1 recall precision, verifier omission); D-07.

### Phase 3: Build and keep or drop [code]

- [x] **HW-06** Both accepted ideas built and measured via HW-08..HW-13: Unicode tokens and verify-list line kept, timer change reverted, user-scope floor not built.

### Phase 4: Records [code]

- [x] **HW-07** docs/upstream/haystack.md gains the B1-B6 second-pass table, adopted/dropped ideas and no-watch decision; CHANGELOG Unreleased updated; commit 0277c1f7.
- [x] **HW-08** Baseline: 1,294 deduped prompts, recall fires 94.7%, 2.47 claims/prompt; 52-turn sample judged 78 useful / 52 noise claims, 11 noise-only turns; known-search hash 7f5f016dfaa7.
- [x] **HW-09** Unicode/NFC query tokens + Bulgarian stop words, Cyrillic/accent/unrelated cases in the retrieval test; replay unchanged (bug fix, no precision gain); commit 835ea3e2.
- [x] **HW-10** Reverted: treating timer wake-ups as machine text dropped judged precision 60% to 47% (78/52 to 52/59); timer text often names the job and recalls the right facts.
- [x] **HW-11** Not built: user-scope claims are 43% useful vs 69% for project ones, but useful and noise interleave across scores (useful at 10-11 and 36+, noise at 12-33), so no floor helps without losing good matches.
- [x] **HW-12** Kept: Unicode tokens (835ea3e2, correctness fix, precision unchanged) and the verify-list line (250e9814); timer change reverted, user-scope floor not built.
- [x] **HW-13** test-audit-compaction.mjs added to the verify-package.mjs list; commit 250e9814.

## Global validation

- R1 to R6 hold, and the acceptance examples match the files.
- Every kept change passes its focused test. Every runtime-cost change has a C3 comparison with no material overall regression.
- Nothing is pushed.

## Resume context

All steps done. Kept: Unicode/NFC knowledge query tokens (835ea3e2), compaction-audit test in verify (250e9814); ledger 0277c1f7. Nothing pushed. Full suite not run.

## Amendments

None.
- 2026-11-13: Added HW-08, HW-09, HW-10, HW-11, HW-12 after HW-07: Accepted IDEA-e550c9eb: K1: make knowledge recall quieter and fix non-Latin queries
- 2026-11-13: Added HW-13 after HW-12: Accepted IDEA-f35158c9: Add the missing compaction-audit test to npm run verify




## Ideas

### IDEA-e550c9eb K1: make knowledge recall quieter and fix non-Latin queries

Status: accepted
Response: {"kind":"selection","selections":["Accept (Recommended)"]}

#### What this is

> Every turn, ce-workflow quietly adds 3 to 5 remembered facts to the model's context. Measured over 1,897 recent prompts: it fires on 95% of them, and in a judged sample of 29 turns, 14 carried nothing useful (for example the '/tmp maps to AppData\Local\Temp' fact showing up for a question about tools_enable). Prompts written only in Bulgarian get no recall at all.

#### What you gain

> Less noise in every turn's context, so the model is less often steered by an unrelated fact; Bulgarian prompts start matching Bulgarian facts.

#### Drawbacks and risks

> A stricter filter can also hide a fact that would have helped. Recall precision is judged by a classifier, so the before/after numbers are estimates.

#### Implementation and affected files

> Three small changes in extensions/work-knowledge.ts, each measured with the same replay used for the gap: (1) the query tokenizer keeps Unicode letters and normalizes accents (NFC), (2) scheduled-timer messages ('⏰ Scheduled ...') count as machine text, so recall uses your last real request instead, (3) user-wide facts (they have no project) need a stronger word match than project facts. Keep each change only if the share of no-useful turns drops and the 12 known-good knowledge searches still find their facts.

#### Cost

> About an hour of agent time plus a few cents of classifier calls for the before/after replay.

#### Recommendation

> Accept. It is the only area where the measurement found a real gap, and Astra independently found the Bulgarian bug.

#### Sources and agreement

> docs/proposals/2026-11-13-haystack-wider-review.md (Gap measurements K1, Astra merge B1); Haystack document_stores/in_memory/document_store.py:42-61 (Unicode tokenizer); extensions/work-knowledge.ts:655 (tokens), :48 (machine markers)

#### Proposed requirement

> Recall precision improves on the replay without losing known-good matches; focused tests scripts/test-work-knowledge.mjs and scripts/test-work-knowledge-retrieval.mjs pass.

#### Proposed steps

> - Save the HW-03 replay + Jev judging as a repeatable throwaway baseline (no-useful share, average claims per turn, the 12 known-good searches).
> - Unicode/NFC query tokenizer with a Cyrillic regression case in test-work-knowledge-retrieval.mjs.
> - Treat scheduled-timer messages as machine-authored in isMachineAuthoredUserText, with a test.
> - Raise the match floor for user-scope claims; keep only if the replay shows fewer no-useful turns and no lost known-good matches.
> - Commit each kept change with its numbers; revert any that do not help.

### IDEA-f35158c9 Add the missing compaction-audit test to npm run verify

Status: accepted
Response: {"kind":"selection","selections":["Accept (Recommended)"]}

#### What this is

> scripts/test-audit-compaction.mjs is an offline test that passes, but the full check (npm run verify) never runs it because it is not in the list in scripts/verify-package.mjs. Astra found this; I confirmed it.

#### What you gain

> A break in the compaction audit script gets caught by the normal pre-push check.

#### Drawbacks and risks

> Adds about a second to the full check.

#### Implementation and affected files

> Add one line, "test-audit-compaction.mjs", to the tests list in scripts/verify-package.mjs. CI (Astra's other suggestion) is left out: one committer on Windows, about 5 minutes of full checks a day.

#### Cost

> A few minutes.

#### Recommendation

> Accept.

#### Sources and agreement

> scripts/verify-package.mjs:107-113; Astra verdicts B6 (docs/proposals/haystack-review/astra-verdicts-wider.md)

#### Proposed requirement

> npm run verify lists and runs test-audit-compaction.mjs.

#### Proposed steps

> - Add test-audit-compaction.mjs to the verify-package.mjs tests list and run node scripts/test-audit-compaction.mjs.
