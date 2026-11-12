# Haystack desk review: brief for an independent reviewer

You are reviewing a competitor framework for ideas that ce-workflow could borrow. Read only this brief, the Haystack clone and the ce-workflow source files named below. Do **not** read anything under `docs/plans/` or `docs/proposals/` other than this brief: another reviewer is doing the same review in parallel, and we want your independent judgment.

## The two projects

- **Haystack** (`deepset-ai/haystack`, Apache-2.0, Python): pinned clone at `C:\SOFT\git\haystack-review\haystack`, commit `104a83f8799b1b8d9d18a88eb9a08305133aea2d` (2026-11-12, `VERSION.txt` 3.6.0-rc0). All Haystack paths below are relative to `haystack/` inside that clone unless they start with `../`.
- **ce-workflow** (`C:\SOFT\git\ce-workflow`, TypeScript): an extension package for the Pi coding agent (a terminal agent harness like Claude Code). Pi itself owns the agent loop, tools (read, bash, edit, write), sessions, skills and extension events; ce-workflow adds planning, compaction, dialogs and utility tools. `README.md` is the full feature description. Ideas we adopt are re-implemented in TypeScript, or ported with the Apache-2.0 notice.

## What to judge

For each area A1 to A16, give one verdict:

- **Adopt idea**: a clear win for ce-workflow, small to build.
- **Test first**: promising, but needs a measured trial (cost, tokens, turns or reliability) before adoption.
- **Already covered**: ce-workflow or Pi already does this; name where.
- **Skip**: not applicable or not worth it; say why.

For each area write: the verdict, a two- to four-sentence reason, the specific Haystack mechanism (`path:line` at the pin) and the ce-workflow file it compares with. Judge the mechanism, not the RAG framing. Then list your **top 5 ideas** overall, ranked, each with the concrete change you would make in ce-workflow and how you would measure it.

Out of scope: RAG and model plumbing (retrievers, embedders, document stores, converters, preprocessors, rankers, routers, joiners, generators, data classes), Haystack's integrations repo, Hayhooks, deepset Studio and the docs website.

## Areas and what ce-workflow has today

| Area | Haystack paths | ce-workflow counterpart |
|---|---|---|
| A1 Compaction hooks | `hooks/compaction/` | `extensions/work-compaction.ts`, `extensions/work-compaction-memory.ts` |
| A2 Tool-result offloading | `hooks/tool_result_offloading/` | `stripProcessedPayloads` in `extensions/work-models.ts`, `extensions/work-images.ts` |
| A3 Budget hooks | `hooks/budget/` | none dedicated (see below) |
| A4 Human in the loop | `hooks/human_in_the_loop/` | `extensions/ask-user/`, research-mode Git guard, camera and browser consent |
| A5 Structured output | `hooks/structured_output/` | `extensions/jev-tools.ts`, tool parameter schemas in `extensions/plan3.ts` |
| A6 Hook protocol | `hooks/protocol.py`, `hooks/invocation.py`, `hooks/from_function.py` | Pi extension events (`pi.on(...)`) as used across `extensions/*.ts` |
| A7 Agent loop and state | `components/agents/` | Pi's agent loop; pi-subagents |
| A8 Searchable toolset | `tools/searchable_toolset.py`, `tools/toolset.py` | `extensions/tool-loader.ts` (`tools_enable`) |
| A9 Skills | `skill_stores/`, `tools/skills/` | Pi skills (`skills/` in this repo, `SKILL.md` files) |
| A10 Agents and pipelines as tools | `tools/agent_tool.py`, `tools/pipeline_tool.py`, `tools/component_tool.py` | pi-subagents, codemode |
| A11 Breakpoints and snapshots | `core/pipeline/breakpoint.py` | Plan3 resume context and sidecar logs (`extensions/plan3.ts`), `compaction_note`, night mode |
| A12 Token counters | `token_counters/` | billed-token tail limit in `extensions/work-compaction.ts` (`tightenPreparation`) |
| A13 Tracing and telemetry | `tracing/`, `telemetry/` | `extensions/plan3-stats.ts`, `scripts/audit-compaction.mjs` |
| A14 Evaluation | `evaluation/`, `components/evaluators/` | `benchmarks/`, `scripts/benchmark-*.mjs`, skills-lab blind judge |
| A15 Caching | `components/caching/` | provider prompt cache; cold-cache compaction in `extensions/work-compaction.ts` |
| A16 Dev process | `../AGENTS.md`, `hooks/compaction/AGENTS.md`, `../releasenotes/`, `../e2e/` | `AGENTS.md`, `CHANGELOG.md` with version-before-push rule, `scripts/test-work-*.mjs` |

What each counterpart does today, in short:

- **Compaction (A1, A12, A15).** Four modes. Ultracompact and Ultrafull build a code-first summary (protected verbatim user requests, a rolling checkpoint, observed facts promoted to a knowledge store) with an optional cheap summarizer model; Ultrafull saves it as a real Pi checkpoint and keeps a recent tail verbatim, capped at 30k by billed tokens rather than a chars/4 guess. Automatic compaction at 150k by default; cold-cache compaction at 70% of the trigger when the provider cache has expired. Native modes use Pi's own summary. `compaction_note` lets the agent leave a note copied verbatim into the next summary. `scripts/audit-compaction.mjs` scans session logs for re-reads, re-run commands and re-asked questions after each compaction.
- **Payload stripping (A2).** In Ultracompact, each outgoing request drops aged image payloads (replaced with a "re-read the file" marker), clips giant tool outputs, replaces stale reads of files edited since, and collapses duplicate outputs. Images never reach the main model as pixels: they become `img-…` references, and `process_image` asks a vision model a specific question. Pi's own bash tool truncates output to 2000 lines or 50 KB and saves the full output to a temp file whose path it returns.
- **Budgets (A3).** No token or cost budget hook. Plan3 statistics record cost per model; usage is shown by the separate control hub. Night mode runs a plan unattended until done, two no-progress continues, or Escape; it has no deadline or cap.
- **Human in the loop (A4).** `ask_user` draws every question in the terminal, the web hub and the phone. Per-site approvals for browser tools (once, hours, always, deny, block); risky clicks (send, delete, pay) ask first; camera needs per-request consent; research mode blocks Git commit and push; night mode blocks `ask_user` and turns questions into plan entries.
- **Structured output (A5).** Tools declare JSON schemas; `jev_triage` and `jev_evidence` ask a cheap classifier typed bool, choice or score questions. No retry-until-valid loop for the main model's free text.
- **Hooks (A6).** Pi extensions subscribe to events (`before_agent_start`, `context`, `tool_call`, `tool_result`, `turn_end`, `session_before_compact` and others) and can modify messages, block tool calls or inject steering messages.
- **Agent loop and subagents (A7, A10).** Pi runs the loop. pi-subagents launches child agents (sync or async, forked or fresh context, named agents such as `reviewer` and `oracle`). Codemode runs JavaScript that calls tools in a sandbox, for batching.
- **Deferred tools (A8).** About ten situational tools (phone, desktop app, VM, browser control, image tools) are registered deferred; their schemas are sent only after the agent calls `tools_enable` with names from a one-line-each list.
- **Skills (A9).** Pi lists each skill's name and description in the system prompt; the agent reads `SKILL.md` when one matches.
- **Plan resume (A11).** Plan3 keeps one Markdown plan per task with step markers, a single Resume context checkpoint and a sidecar log; `/resume3` sends a compact resume packet. Git is the code state. There is no mid-run snapshot of the agent's message state beyond Pi's own session files.
- **Telemetry (A13).** Plan3 statistics per plan: model thinking and acting time per model and effort, tok/s, cache hit, cost, tool time, tests and builds, slowest commands, time waiting on the user, per-step totals. No OpenTelemetry-style spans.
- **Evaluation (A14).** Live benchmarks for compaction and stripping (`benchmarks/`, `scripts/benchmark-*.mjs`), a skills A/B lab with a blind judge, and the rule that an optimization is kept only if an end-to-end benchmark shows no overall regression in runtime, tokens, cost, turns and tool calls.
- **Dev process (A16).** `AGENTS.md` holds project rules (test scope, version bump and changelog before push, dialog UX, extension file type); `CHANGELOG.md` is updated per version; self-check scripts `scripts/test-work-*.mjs` run through `npm run verify`.

## Output

Write your result to `C:\SOFT\git\ce-workflow\docs\proposals\haystack-review\astra-verdicts.md`: a table with one row per area (Area, Verdict, Reason, Haystack evidence, ce-workflow counterpart), then the ranked top 5 ideas. If you cannot write files, return the full Markdown as your final answer. Read-only otherwise: do not edit any other file.
