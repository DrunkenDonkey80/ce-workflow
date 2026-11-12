---
plan3: true
status: ready
created: 2026-11-12
updated: 2026-11-12T20:46:59.961Z
size: plan
started: 2026-11-12T20:41:04.471Z
---

# Review deepset-ai/haystack for ideas to borrow, with an Astra second opinion

## Original request

> check this competitor here намерих ти и една конкуренция но не съм я разследвал изцяло https://github.com/deepset-ai/haystack
> 
> See if there are any good ideas we can borrow, use Astra too

(Bulgarian part: "I found you a competitor too, but I haven't investigated it fully".)

## Goal, requirements, and non-goals

**Goal:** find the Haystack ideas worth borrowing for ce-workflow, judged by us and independently by Astra, and let the user accept or reject each one. Building accepted ideas happens in their own follow-up plans (D-04).

Requirements:

- R1: every area in the review scope (below) gets a verdict with a reason, the ce-workflow counterpart it was compared with, and upstream evidence as `path:line` at the pinned commit (D-02, D-06).
- R2: Astra reviews the same areas independently, without seeing our verdicts or this plan; the review doc shows both verdicts side by side, the agreement count, and how each disagreement was settled after checking the code (D-03).
- R3: every shortlisted idea reaches the user through `plan3` action `ideas`; each gets an accepted or rejected decision recorded in Decisions.
- R4: `docs/upstream/haystack.md` records the pinned commit and what we took, left and already have, and says there is no catch-up watch until an idea is built (D-05, D-10).
- R5: each accepted idea gets its own Plan3 draft whose request names the idea, its upstream paths, the evidence, the catch-up watch entry to add when it is built, and that ports need the Apache-2.0 notice (D-04, D-09, D-10).
- R6: this plan changes only files under `docs/`; nothing is implemented (D-10).

Review scope (D-02): agent-runtime parts of Haystack that overlap ce-workflow. Counterparts are starting points, not verdicts.

| Area | Haystack paths (under `haystack/` at the pin) | ce-workflow counterpart to compare |
|---|---|---|
| A1 Compaction hooks | `hooks/compaction/` (sliding window, summarization, tool-result pruning and offloading) | `extensions/work-compaction.ts`, `work-compaction-memory.ts`, payload stripping |
| A2 Tool-result offloading | `hooks/tool_result_offloading/` (policies, stores) | payload and image stripping, `extensions/work-images.ts` |
| A3 Budget hooks | `hooks/budget/` | usage footer, unbounded-run fix (plan 2026-09-27-001) |
| A4 Human in the loop | `hooks/human_in_the_loop/` (policies, strategies, user interfaces) | `extensions/ask-user/`, research-mode git guard, camera consent |
| A5 Structured output | `hooks/structured_output/` | jev typed questions, plan3 tool schemas |
| A6 Hook protocol | `hooks/protocol.py`, `invocation.py`, `from_function.py` | Pi extension events as used in `extensions/plan3.ts` |
| A7 Agent loop and state | `components/agents/` | Pi agent loop, pi-subagents |
| A8 Searchable toolset | `tools/searchable_toolset.py`, `toolset.py` | `extensions/tool-loader.ts`, `tools_enable` |
| A9 Skills | `skill_stores/`, `tools/skills/` | Pi skills, `skills/` |
| A10 Agents and pipelines as tools | `tools/agent_tool.py`, `pipeline_tool.py`, `component_tool.py` | pi-subagents, codemode |
| A11 Breakpoints and snapshots | `core/pipeline/breakpoint.py` | Plan3 resume context, `compaction_note`, night mode |
| A12 Token counters | `token_counters/` | billed-token compaction limit (07432bb1) |
| A13 Tracing and telemetry | `tracing/`, `telemetry/` | `.pi` logs, `extensions/plan3-stats.ts` |
| A14 Evaluation | `evaluation/`, `components/evaluators/` | `benchmarks/`, skills-lab blind judge |
| A15 Caching | `components/caching/` | Pi prompt cache, cold-cache compaction |
| A16 Dev process | `../AGENTS.md`, `hooks/compaction/AGENTS.md`, `../releasenotes/`, `../e2e/` | our AGENTS.md, CHANGELOG and version rule, scripts/test-* |

Everything else (retrievers, embedders, document stores, converters, preprocessors, rankers, routers, joiners, generators, data classes) gets one "out of scope: RAG or model plumbing" line in the review doc.

Non-goals:

- Building any idea or changing extension code or data in this plan (D-04, D-10); A/B labs before the idea review (D-01).
- Copying Haystack code in this plan. Follow-up plans may port code with the Apache-2.0 license and notice (D-09).
- Reviewing Haystack's integrations repo, Hayhooks, deepset Studio or the docs website.

Acceptance examples:

- `docs/proposals/2026-11-12-haystack-review.md` has 16 area rows (A1 to A16), each with our verdict, Astra's verdict, reason, counterpart and `path:line` evidence, plus the out-of-scope list and an agreement count such as "agree on 12 of 16".
- An area like A1 reads, for example: "Test first. Haystack offloads large tool results to a store and leaves a reference (`hooks/tool_result_offloading/hooks.py:NN`); we strip aged payloads in place. Counterpart: `extensions/work-compaction.ts`."
- The idea popup shows each shortlisted idea with benefits, drawbacks, approach, cost and sources; after it, Decisions has one accepted or rejected line per idea.
- With or without accepted ideas, `extensions/work-catch-up-baseline.json` is unchanged; with zero accepted ideas, `docs/upstream/haystack.md` exists and no follow-up drafts exist.

## Decisions

- **D-01 Output: desk review plus Astra, then accept/reject ideas.** No A/B lab before the idea review; building and measuring come after acceptance. Source: user via ask_user 2026-11-12, round 1.
- **D-02 Scope: agent-runtime overlap only.** Areas A1 to A16 above; RAG components get one out-of-scope line each. Source: user via ask_user 2026-11-12, round 1.
- **D-03 Astra reviews independently, then we merge.** Astra gets the pinned clone, the area table and a short ce-workflow capability brief, not our verdicts or this plan (the Matt review's Astra read the plan and was anchored: `docs/proposals/2026-11-08-mattpocock-skills-review.md` line 68). Source: user via ask_user 2026-11-12, round 1.
- **D-04 One follow-up Plan3 plan per accepted idea.** This plan ends at the idea review and records; compaction or stripping ideas need their own end-to-end benchmark (AGENTS.md Optimization Regression Rule). Source: user via ask_user 2026-11-12, round 2.
- **D-05 Ledger always; catch-up watch only when an idea is accepted.** `docs/upstream/haystack.md` always; a `kind: "git"` entry with `paths` limited to accepted ideas' upstream paths in `extensions/work-catch-up-baseline.json` only if one is accepted. Haystack is busy (1529 release notes), so an unscoped watch would be noise. Source: user via ask_user 2026-11-12, round 2 (the answer carried a cut-off comment, "If we accept any idea that is", read as agreeing with the option).
- **D-06 Upstream pin.** `deepset-ai/haystack` at `104a83f8799b1b8d9d18a88eb9a08305133aea2d` (2026-11-12, `VERSION.txt` 3.6.0-rc0), Apache-2.0. Later upstream changes are out of scope unless a step re-pins. Source: shallow clone made during planning.
- **D-07 Astra means `openai-codex/gpt-6-astra` at high thinking, as the builtin read-only `reviewer`.** Same setup as plan 79614d24 D-08; the model is configured in `~/.pi/agent/settings.json`. The request authorizes this subagent. Source: Original request ("use Astra too") and precedent.
- **D-08 Patch versus prefactor: patch everywhere.** Only data and docs change: a new review doc, a new ledger and maybe one JSON entry that the generic catch-up code already reads (`extensions/plan3-catch-up.ts` `writeGitCatchUpDiff` takes `paths`). No module fights the change. Source: agent fit check.
- **D-09 Follow-up plans may port Haystack code with notice.** Answer to Q-01: a port carries the Apache-2.0 license text and attribution notice; re-implementing stays allowed. This plan copies nothing. Source: user via ask_user /plan3 resolve 2026-11-12.
- **D-10 This plan only researches and gathers ideas; the catch-up watch moves to the follow-up plans.** No product code or extension data changes here. The `deepset-ai/haystack` entry in `extensions/work-catch-up-baseline.json` (scoped `paths`, as D-05 describes) is added by the first follow-up plan that builds an idea, so each accepted idea's draft request names it. Replaces D-05's "watch when an idea is accepted" timing; the ledger part of D-05 stands. Source: user's Q-01 comment ("don't implement anything, we are just researching and gathering ideas now") and ask_user reconcile 2026-11-12.
- **D-size** Size: plan. Known recipe (desk review of a competitor repo plus an Astra second opinion, ideas to the user) like the Matt Pocock review; no product code until ideas are accepted. Source: user pick, 2026-11-12.
- **Q-01** Do accepted ideas get re-implemented, never copied?
  - Context: Haystack is Apache-2.0 (Python); ce-workflow extensions must be `.ts` (AGENTS.md Extension File Rule). Copying code would need the Apache license and NOTICE handling; re-implementing an idea needs neither. This plan only writes idea texts; the question matters for the follow-up plans.
  - Recommendation: Re-implement ideas only; any follow-up that wants to port code raises it in its own plan with license handling.
  - Option: Ideas only — no license work; we write our own code.
  - Option: Allow ports with notice — faster for big algorithms; adds license files and attribution upkeep.
  - Independent: yes
  - Answer: {"kind":"selection","selections":["Allow ports with notice"],"comment":"don't implement anything, we are just researching and gathering ideas now"}
  - Source: user via ask_user /plan3 resolve; not independently verified.



## Open questions

### Blocking

None.

### Deferred

None.

## Relevant files and approach

Approach: pin a clone outside the repo, read the scoped areas against our counterparts, have Astra do the same blind, merge, offer the shortlist as ideas, then write the records. Reuse what exists: the Matt review's doc shape (`docs/proposals/2026-11-08-mattpocock-skills-review.md`, `docs/proposals/skills-lab/astra-verdicts.md`), its ledger shape (`docs/upstream/mattpocock-skills.md`), the catch-up entry shape (`extensions/work-catch-up-baseline.json`, `nexu-io/open-design` entry with `paths`), and `plan3` actions `ideas` and `create`.

Locations:

- Upstream clone (outside the repo): `C:\SOFT\git\haystack-review\haystack` at the D-06 pin. A planning-time shallow clone also sits in the system-temp research folder; do not rely on it.
- Review doc: `docs/proposals/2026-11-12-haystack-review.md`.
- Astra brief and verdicts: `docs/proposals/haystack-review/astra-brief.md`, `docs/proposals/haystack-review/astra-verdicts.md`.
- Ledger: `docs/upstream/haystack.md`.

Fit check per touched module (D-08):

- `docs/proposals/` review doc and Astra files: **fits** (new files, the established place for reviews).
- `docs/upstream/haystack.md`: **fits** (one ledger per upstream, as for Matt, Astryx and OpenDesign).
- `extensions/work-catch-up-baseline.json`: not touched here (D-10); the follow-up plan that adds the entry finds it **fits** (the catch-up code handles `kind: "git"` entries with `paths` generically).

Verdict words (same as the Matt review): **Adopt idea** (clear win, small), **Test first** (promising, needs a measured trial in its follow-up plan), **Already covered** (name where), **Skip** (not applicable or not worth it, with reason).

Commands (referenced by steps):

- C1 clone: `git clone "https://github.com/deepset-ai/haystack.git" "C:/SOFT/git/haystack-review/haystack"` then `git -C "C:/SOFT/git/haystack-review/haystack" checkout "104a83f8799b1b8d9d18a88eb9a08305133aea2d"`.

## Phases

### Phase 1: Review [think]

- [x] **HR-01** Clone at pin in C:\SOFT\git\haystack-review\haystack; Astra brief with area table and counterpart summaries in docs/proposals/haystack-review/astra-brief.md.
- [wip] **HR-02** Launch Astra (D-07) on `astra-brief.md` and the clone, async, writing `astra-verdicts.md`; do HR-03 meanwhile.
  - Brief asks for a verdict, reason and `path:line` per area A1 to A16, its own top ideas, and nothing from `docs/plans/`.
  - Call `subagents_enable` first; follow the pi-subagents skill.
- [x] **HR-03** Desk review written: 16 area rows (Test first A1, A2, A3, A16; Already covered A4-A6, A8-A10, A12; Skip A7, A11, A13-A15), 5 candidate ideas, out-of-scope list; Astra verdicts not read.
- [ ] **HR-04** Merge Astra's verdicts as a column; count agreements; settle each disagreement by checking the code; pick the shortlist.
  - Shortlist: areas where either review says Adopt idea or Test first and the merge keeps it. Write the shortlist with reasons at the end of the review doc.
  - Check: every row A1 to A16 has both verdicts (R1, R2).

### Phase 2: Idea review [think]

- [ ] **HR-05** Offer the shortlist with `plan3` action `ideas`, one idea each with sources and follow-up steps; record every decision.
  - Each idea's steps describe the follow-up plan (what to build, the benchmark or regression it needs), not work in this plan.
  - An empty shortlist skips the popup and says so in Decisions.

### Phase 3: Records [code]

- [ ] **HR-06** Write `docs/upstream/haystack.md`: pin, accepted (build pending), rejected with reasons, already covered, out of scope.
  - Same table shape as `docs/upstream/mattpocock-skills.md`; link the review doc and this plan. State "no catch-up watch until an idea is built" (D-10).
- [ ] **HR-08** For each accepted idea, `plan3 create` a draft with the idea, upstream paths and evidence; link the drafts here.
  - Each request also names the catch-up entry to add when built (`name` `deepset-ai/haystack`, `kind` `git`, `url`, `ledger`, `paths`, `version` and `reviewedVersion` at the pin) and the port-with-notice rule (D-09, D-10).
  - `create` moves the current-plan pointer to the new draft: pass `plan: "2af79ca5"` to every later `plan3` call on this plan.

## Global validation

- R1 to R5 hold; the acceptance examples above match the files.
- No product code or extension data changed: `git diff --stat` touches only `docs/` (R6).

## Resume context

HR-01 done (c93bd0dd). HR-02 wip: Astra (reviewer, openai-codex/gpt-6-astra:high) launched async, run 3dd537b0, output → docs/proposals/haystack-review/astra-verdicts.md; mark HR-02 done when it lands (do not read it before HR-03 is written). HR-03 in progress: draft notes in docs/proposals/2026-11-12-haystack-review.md cover A1, A2, A6; next read A3 hooks/budget/hooks.py, then A4 to A16, then rewrite the doc as the A1 to A16 table plus out-of-scope list.

## Amendments

Append material changes and their reasons; preserve the original request and settled decisions.

- 2026-11-12 reconcile: Q-01 answered (D-09, ports allowed with notice in follow-up plans). The user's comment "don't implement anything" led to D-10: step HR-07 (catch-up entry) was removed and its content folded into HR-08's draft requests, so this plan only touches `docs/`. Command C2 went with it.
