# Haystack wider review: brief for an independent reviewer

You are reviewing a competitor framework for ideas that ce-workflow could borrow. Read only this brief, the Haystack clone and the ce-workflow source files named below. Do **not** read anything under `docs/plans/` or `docs/proposals/` other than this brief: another reviewer is doing the same review in parallel, and we want your independent judgment.

## The two projects

- **Haystack** (`deepset-ai/haystack`, Apache-2.0, Python): pinned clone at `C:\SOFT\git\haystack-review\haystack`, commit `104a83f8799b1b8d9d18a88eb9a08305133aea2d` (2026-11-12, 3.6.0-rc0). Haystack paths below are relative to `haystack/` inside that clone unless they start with `../` (the repo root).
- **ce-workflow** (`C:\SOFT\git\ce-workflow`, TypeScript): an extension package for the Pi coding agent (a terminal agent harness like Claude Code). Pi owns the agent loop, core tools, sessions, skills and extension events; ce-workflow adds planning (Plan3), compaction, dialogs, a control hub and utility tools. `README.md` is the full feature description. Adopted ideas are re-implemented in TypeScript, or ported with the Apache-2.0 notice.

An earlier review already covered Haystack's agent runtime (hooks, compaction, tool-result offloading, budgets, human in the loop, structured output, agents, toolsets, skills, breakpoints, token counters, tracing, the evaluation harness, caching). Do not re-review those. This pass covers the parts that earlier review skipped as "RAG", because several of them line up with real ce-workflow features.

## What to judge

For each area B1 to B6, give one verdict:

- **Adopt idea**: a clear win for ce-workflow, small to build.
- **Test first**: promising, but needs a measured trial before adoption.
- **Already covered**: ce-workflow or Pi already does this; name where.
- **Skip**: not applicable or not worth it; say why.

For each area write the verdict, a two- to four-sentence reason, the specific Haystack mechanism (`path:line` at the pin) and the ce-workflow file it compares with. Judge the mechanism, not the RAG framing. An area may hold several mechanisms; name the best one and mention any runner-up.

Then list your **top ideas overall** (up to 5, ranked; fewer is fine if fewer are worth it). For each, give the concrete change in ce-workflow and **a cheap way to measure the gap first**: what local data (Pi session logs under `~/.pi/agent/sessions/**/*.jsonl`, the knowledge store, the code itself) would show the problem is real before anything is built. An idea whose gap you cannot name a way to measure should say so.

Out of scope: embedding and vector infrastructure for its own sake, Haystack's integrations repo, Hayhooks and deepset Studio.

## Areas and what ce-workflow has today

| Area | Haystack paths | ce-workflow counterpart |
|---|---|---|
| B1 Retrieval and ranking | `components/retrievers/` (in_memory BM25, multi_query, sentence_window, auto_merging), `components/rankers/` (lost_in_the_middle, llm_ranker, meta_field), `components/query/query_expander.py`, `components/joiners/`, `document_stores/in_memory/` | `extensions/work-knowledge.ts` (`searchKnowledge` near line 700), `extensions/jev-tools.ts`, `extensions/tool-loader.ts` |
| B2 Model calls | `components/generators/chat/fallback.py`, `components/generators/chat/_rate_limit_headers.py`, retry and timeout handling in `components/generators/chat/openai.py`, `components/routers/llm_messages_router.py`, `components/routers/conditional_router.py` | `extensions/work-compaction-memory.ts` (model candidates near line 230), `extensions/work-models.ts`, `extensions/advisor-model.ts` |
| B3 Web and ingestion | `components/fetchers/link_content.py`, `components/converters/` (html, markdown, pypdf, output_adapter), `components/preprocessors/` (document_cleaner, text_cleaner, document_splitter, markdown_header_splitter) | `extensions/browser-fetch.ts`, `browser-fetch/extension/background.js`, `extensions/browser-search.ts`, `extensions/plan3-web.ts` |
| B4 Security utilities | `utils/jinja2_sandbox.py`, `core/serialization_security.py`, `utils/url_validation.py`, `utils/auth.py` (Secret) | `extensions/redact.ts`, `extensions/browser-fetch.ts` (`privateIp`, URL check near line 60), `extensions/work-env.ts`, `hub/` |
| B5 Evaluators | `components/evaluators/` (llm_evaluator, faithfulness, context_relevance, sas_evaluator, answer_exact_match), `components/validators/json_schema.py` | `extensions/work-verification-contract.ts`, `scripts/benchmark-*.mjs`, `scripts/skills-lab-judge.mjs`, `scripts/audit-compaction.mjs` |
| B6 Engineering process | `../.github/workflows/` (37 files), `../test/` layout and pytest markers, `../releasenotes/` with reno, `../AGENTS.md` and directory `AGENTS.md` files, lint and type settings in `../pyproject.toml` | `scripts/verify-package.mjs`, `scripts/test-*.mjs`, `CHANGELOG.md`, `AGENTS.md`, `package.json` |

What each counterpart does today, in short:

- **Knowledge recall (B1).** Durable facts (claims up to 280 characters, with kind, scope, authority, paths and symbols) are stored per project and per user. Before each turn, the user's prompt is matched against them: IDF-weighted word overlap with stop words removed, requiring two shared words or an exact path or symbol match, plus fixed bonuses for path (+20) and symbol (+30); ties broken by authority and recency; top 3 to 5 injected as a short "background recall" block, with near-duplicate claims collapsed. No stemming, no synonyms, no length normalization, no query expansion. `jev_evidence` searches files by a literal or regex pattern and ranks matches with a cheap classifier. Deferred tools are enabled from a one-line-each list.
- **Model calls (B2).** Pi talks to providers and handles its own retries. ce-workflow makes side calls: the compaction summarizer tries a configured cheap model, then the current model, then falls back to a code-built summary; the advisor and vision helpers each call one configured model. Model roles (planning, coding, compaction, vision) are picked per role in `/wo` settings. No reading of rate-limit headers, no routing by message content.
- **Web (B3).** `browser_fetch` loads a page in the user's real browser through a browser extension and returns `document.body.innerText` (cut at 100,000 characters), up to 100 links and image URLs; no boilerplate removal, no Markdown conversion, no splitting. `browser_search` returns Google results as a numbered list. Separate web tools (another package) fetch public pages. Video transcripts are handled by a sibling repo and are out of scope here.
- **Security (B4).** `redactSecrets` strips URL token parameters, `sk-` and Bearer keys, and key=value secrets from text leaving the process (hub errors, compaction input). Browser tools refuse non-http URLs, URLs with credentials, local names and private or reserved IPs (IPv4 inside IPv6 included), and mail and sign-in sites; each new site needs the user's approval; redirects to other sites are approved separately. The hub is a local web server reached from the phone over the LAN. Plans and knowledge are Markdown and JSON, never executed.
- **Evaluation (B5).** A verification contract states what kind of proof a step needs (build, test, browser, device, manual). Live benchmarks measure runtime, tokens, cost, turns and tool calls; `scripts/compare-benchmark-runs.mjs` pairs runs with a baseline. A skills A/B lab uses a blind LLM judge on redacted transcripts. `audit-compaction.mjs` counts re-reads and repeated commands after compactions. No LLM-judged faithfulness of compaction summaries against the source transcript, no JSON-schema validation of model outputs beyond tool schemas.
- **Process (B6).** About 75 self-check scripts (`scripts/test-*.mjs`, `hub/scripts/test-*`) run through `npm run verify` (auto-discovered by name pattern plus a hardcoded list). Rules in `AGENTS.md`: run only targeted tests after a change, bump the version and move CHANGELOG Unreleased bullets before each push, `.ts` only for extensions. The only CI workflow is `.github/workflows/app-release.yml` (builds the desktop app on a pushed version); tests are not run in CI. No per-change release-note files; one root `AGENTS.md`.

## Output

Write your result to `C:\SOFT\git\ce-workflow\docs\proposals\haystack-review\astra-verdicts-wider.md`: a table with one row per area (Area, Verdict, Reason, Haystack evidence, ce-workflow counterpart), then the ranked top ideas with their gap measurement. If you cannot write files, return the full Markdown as your final answer. Read-only otherwise: do not edit any other file.
