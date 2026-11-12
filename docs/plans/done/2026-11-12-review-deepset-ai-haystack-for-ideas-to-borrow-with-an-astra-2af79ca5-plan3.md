---
plan3: true
status: complete
created: 2026-11-12
updated: 2026-11-12T21:30:23.646Z
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
- IDEA-2bbccd30: accepted — Warn before stopping a runaway run. Source: user via Plan3 idea review; not independently verified. Response: {"kind":"selection","selections":["Accept (Recommended)"]}
- IDEA-1578b056: accepted — Pair benchmark runs with the baseline and show missing ones. Source: user via Plan3 idea review; not independently verified. Response: {"kind":"selection","selections":["Accept (Recommended)"]}
- IDEA-f53f54d6: accepted — Better compaction summaries: two prompt rules and error feedback. Source: user via Plan3 idea review; not independently verified. Response: {"kind":"selection","selections":["Accept (Recommended)"]}
- IDEA-a6cb60e7: accepted — Prune old tool results at the Ultrafull checkpoint. Source: user via Plan3 idea review; not independently verified. Response: {"kind":"selection","selections":["Accept (Recommended)"]}
- IDEA-cc717692: accepted — Save large non-bash tool results to a file with a pointer. Source: user via Plan3 idea review; not independently verified. Response: {"kind":"selection","selections":["Accept"]}








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
- [x] **HR-02** Astra (gpt-6-astra:high) independent review landed: 16 verdicts + top 5 ideas in docs/proposals/haystack-review/astra-verdicts.md.
- [x] **HR-03** Desk review written: 16 area rows (Test first A1, A2, A3, A16; Already covered A4-A6, A8-A10, A12; Skip A7, A11, A13-A15), 5 candidate ideas, out-of-scope list; Astra verdicts not read.
- [x] **HR-04** Merged Astra column + Final verdicts: agree on 9 of 16; 6 disagreements settled in code (A1, A3, A5, A14 kept/raised; A13, A16 dropped); shortlist of 5 ideas written.

### Phase 2: Idea review [think]

- [x] **HR-05** Idea review: all 5 shortlisted ideas accepted (IDEA-2bbccd30, -1578b056, -f53f54d6, -a6cb60e7, -cc717692); auto-added build steps moved out to the follow-up drafts.

### Phase 3: Records [code]

- [x] **HR-06** Ledger docs/upstream/haystack.md: pin, 5 accepted (build pending), none rejected, already covered, skipped, out of scope; no watch until built.
- [x] **HR-08** Five follow-up Plan3 drafts created (5bd4eebd budget warning, 0c43697c benchmark pairing, 83818785 compaction summaries, ac641457 checkpoint pruning, 1feda303 offloading), each with idea, upstream paths, evidence, catch-up entry and port-with-notice rule; linked in docs/upstream/haystack.md.

## Global validation

- R1 to R5 hold; the acceptance examples above match the files.
- No product code or extension data changed: `git diff --stat` touches only `docs/` (R6).

## Resume context

HR-01 done (c93bd0dd), HR-03 done (2f3ebfe3: 16-row desk review in docs/proposals/2026-11-12-haystack-review.md, 5 candidate ideas). HR-02 wip: Astra run 3dd537b0 still running (native completion wakes the session) → docs/proposals/haystack-review/astra-verdicts.md. Next when it lands: mark HR-02 done, then HR-04 merge (add Astra verdict column, agreement count, shortlist).

## Amendments

Append material changes and their reasons; preserve the original request and settled decisions.

- 2026-11-12 reconcile: Q-01 answered (D-09, ports allowed with notice in follow-up plans). The user's comment "don't implement anything" led to D-10: step HR-07 (catch-up entry) was removed and its content folded into HR-08's draft requests, so this plan only touches `docs/`. Command C2 went with it.
- 2026-11-12: Added HR-09, HR-10, HR-11, HR-12, HR-13, HR-14 after HR-08: Accepted IDEA-2bbccd30: Warn before stopping a runaway run
- 2026-11-12: Added HR-15, HR-16, HR-17, HR-18 after HR-14: Accepted IDEA-1578b056: Pair benchmark runs with the baseline and show missing ones
- 2026-11-12: Added HR-19, HR-20, HR-21, HR-22, HR-23 after HR-18: Accepted IDEA-f53f54d6: Better compaction summaries: two prompt rules and error feedback
- 2026-11-12: Added HR-24, HR-25, HR-26, HR-27 after HR-23: Accepted IDEA-a6cb60e7: Prune old tool results at the Ultrafull checkpoint
- 2026-11-12: Added HR-28, HR-29, HR-30, HR-31 after HR-27: Accepted IDEA-cc717692: Save large non-bash tool results to a file with a pointer







- 2026-11-12 HR-05: the idea review accepted all five ideas and auto-added their build steps (HR-09 to HR-31) and requirements here. Removed them from this plan: D-04 and D-10 put each accepted idea in its own follow-up draft (HR-08), and this plan changes only `docs/`. Each idea's steps and requirement stay in its block under Ideas and are carried into its draft.

## Ideas

### IDEA-2bbccd30 Warn before stopping a runaway run

Status: accepted
Response: {"kind":"selection","selections":["Accept (Recommended)"]}

#### What this is

> An unattended run can loop for hours: one overnight run made 363 replies and cost about $170 with no edits (docs/plans/2026-09-27-001-fix-unbounded-direct-agent-runs-plan.md, investigated, never built). Haystack pairs a hard token budget that stops the run with a reminder in the last few steps: "You have N of M steps remaining... start working toward your final answer", and on the last step "you will not see the results of any further tool calls".

#### What you gain

> Caps the damage of a loop at a known size. The reminder lets a healthy run wrap up and write its checkpoint instead of being cut off mid-step. Both reviews (ours and Astra) rank it first.

#### Drawbacks and risks

> Picking a limit is a judgment call: too low cuts real long plans short. A parent-session allowance does not cap subagents that run on their own. Needs care so compaction, retries and resume do not reset the count.

#### Implementation and affected files

> Count model turns per run, persisted across automatic continuations and compaction. A few turns before the limit add one reminder message; at the limit pause with a named reason (never mark the plan complete). Reset only on an explicit user action. Build it into the existing runaway-run plan rather than a new mechanism.

#### Cost

> Medium: one counter in the run/continuation path plus persistence, a reminder message, a pause state, and replay tests.

#### Recommendation

> Accept. It is the only idea that closes a proven, expensive gap.

#### Sources and agreement

> Haystack hooks/budget/hooks.py:31-112 (TokenBudgetHook), :114-193 (StepBudgetReminderHook); ours docs/plans/2026-09-27-001-fix-unbounded-direct-agent-runs-plan.md, extensions/plan3-night.ts, extensions/plan3.ts:1199; Astra idea 1 in docs/proposals/haystack-review/astra-verdicts.md

#### Proposed requirement

> An unattended run stops at a user-approved turn allowance after one advance reminder, and compaction, retry or resume never reset the allowance.

#### Proposed steps

> - Pick the default allowance and where the user changes it, from the overnight incident numbers
> - Count turns per run, persisted across automatic continuations, compaction, retry and resume
> - Add one reminder a few turns before the limit, marked as generated so session memory does not treat it as a user request
> - Pause with a named budget reason at the limit; never mark the plan complete; reset only on explicit user action
> - Replay the looping session: no new parent turn after the limit, below-limit runs unchanged
> - Add the deepset-ai/haystack catch-up entry for hooks/budget/ and Apache-2.0 credit if code is ported

### IDEA-1578b056 Pair benchmark runs with the baseline and show missing ones

Status: accepted
Response: {"kind":"selection","selections":["Accept (Recommended)"]}

#### What this is

> The Optimization Regression Rule asks every optimization to be compared with the last accepted baseline on runtime, tokens, cost, turns and tool calls. Today scripts/benchmark-context-cache-live.mjs averages only runs that did not throw (lines 130-137), so a failed run silently drops out of the means; the comparison with the baseline is done by hand. Haystack's EvalRunResult keeps per-run rows and aligns comparisons by identifier, keeping unmatched rows.

#### What you gain

> Every later trial (including the other ideas here) gets an honest side-by-side table; a candidate cannot look cheaper just because its failed runs vanished.

#### Drawbacks and risks

> One more script to keep in step with benchmark output formats.

#### Implementation and affected files

> A small compare script that takes two results.json files, pairs runs by repetition, prints each metric per pair and the totals, and marks failed or missing runs as incomplete instead of zero.

#### Cost

> Small: one script plus a self-check with synthetic reordered, missing and failed rows.

#### Recommendation

> Accept. Cheap and protects every measurement the other ideas depend on.

#### Sources and agreement

> Haystack haystack/evaluation/eval_run_result.py:38-76, :244-329; ours scripts/benchmark-context-cache-live.mjs:130-137, AGENTS.md Optimization Regression Rule; Astra idea 2

#### Proposed requirement

> A baseline comparison pairs runs by identity and shows failed or missing runs as incomplete, never as zero cost or success.

#### Proposed steps

> - Write the compare script for two benchmark results.json files, paired by repetition
> - Show runtime, total tokens, cost, turns and tool calls per pair and in total, with incomplete pairs marked
> - Add a self-check with reordered, missing, failed and duplicate rows
> - Document it next to the Optimization Regression Rule

### IDEA-f53f54d6 Better compaction summaries: two prompt rules and error feedback

Status: accepted
Response: {"kind":"selection","selections":["Accept (Recommended)"]}

#### What this is

> Our compaction summarizer (extensions/work-compaction-memory.ts:238) asks for JSON with a checkpoint and knowledge. Session logs show 744 accepted and 106 local-fallback compactions (about 12% fall back); attempt errors are mostly "Memory budget exceeded", then unknown citations and invalid JSON. A failed reply is retried on the next model with the same task, without the error. Haystack's summary prompt also demands identifiers copied character for character and says absence from the summarized part is not evidence something did not happen.

#### What you gain

> Fewer fallbacks (each one loses the model summary), and fewer lost paths and IDs after compaction, which shows up as re-reads and repeated commands.

#### Drawbacks and risks

> A repair call adds latency and tokens to a compaction that failed; the prompt rules make the prompt a bit longer. The log counts are approximate.

#### Implementation and affected files

> Add the two rules to the prompt. On a validation failure retry once with the concrete error (for example: output was N characters, maximum M) within the same deadline; keep the local fallback. Measure with scripts/audit-compaction.mjs before and after (fallback rate and reasons, re-reads, repeated commands), then the end-to-end benchmark.

#### Cost

> Small code change; the measurement is most of the work.

#### Recommendation

> Accept as a measured trial; keep only if fallbacks drop with no overall regression.

#### Sources and agreement

> Haystack hooks/compaction/summarization.py:34-70 (prompt), :452-457 (reject non-shrinking summary), hooks/structured_output/hooks.py:132-200 (correction loop); ours extensions/work-compaction-memory.ts:174-188, :238-259; Astra idea 5

#### Proposed requirement

> Compaction fallbacks drop measurably with no overall regression in runtime, tokens, cost, turns or tool calls.

#### Proposed steps

> - Baseline: fallback rate and reasons from scripts/audit-compaction.mjs over recent sessions (add a reason count if missing)
> - Add the exact-identifier and absence rules to the summarizer prompt
> - On a validation failure, retry once with the concrete error inside the same deadline; keep the local fallback
> - Compare fallback rate, re-reads and repeated commands before and after, then run the end-to-end benchmark against the baseline
> - Keep or revert by the Optimization Regression Rule

### IDEA-a6cb60e7 Prune old tool results at the Ultrafull checkpoint

Status: accepted
Response: {"kind":"selection","selections":["Accept (Recommended)"]}

#### What this is

> Ultrafull compacts at 150k by summarizing everything outside a recent tail, and does no stripping in between. Haystack's ToolResultPruningCompactor instead first replaces older large tool results in place with "Tool result removed to free up context. Call `{tool_name}` again if you need it", keeps the newest step whole and small results untouched, so every call keeps its result and the model knows how to recover.

#### What you gain

> After a checkpoint more of the recent conversation could stay word for word (its bulk is usually tool output), so the model loses less reasoning and fewer decisions.

#### Drawbacks and risks

> The model may re-run tools to get pruned output back, costing turns. Done between checkpoints it would break the prompt cache, so it must run only at the checkpoint.

#### Implementation and affected files

> At the Ultrafull checkpoint only, prune large tool results older than the newest step before choosing the kept tail, then compare with the current Ultrafull on the same sessions.

#### Cost

> Medium: changes the tail selection in work-compaction; needs a replay comparison.

#### Recommendation

> Accept only as a trial; lower priority than the three above.

#### Sources and agreement

> Haystack hooks/compaction/tool_result_pruning.py:14-80; ours extensions/work-compaction.ts:111 (tightenPreparation), extensions/work-models.ts:222 and :1775 (Ultrafull has no stripping)

#### Proposed requirement

> Pruning at the checkpoint keeps more recent turns verbatim without raising re-calls, tokens or cost overall.

#### Proposed steps

> - Replay recent Ultrafull compactions: how much of the kept tail is old tool output
> - Prune large tool results older than the newest step at checkpoint time only, with the re-call placeholder
> - Compare kept turns, re-call rate and audit-compaction scores with current Ultrafull
> - Run the end-to-end benchmark against the baseline; keep or revert by the rule

### IDEA-cc717692 Save large non-bash tool results to a file with a pointer

Status: accepted
Response: {"kind":"selection","selections":["Accept"]}

#### What this is

> Pi saves big bash output to a temp file and we turn images into references, but subagent output, browser_fetch pages (up to 100 KB) and jev results stay inline. Haystack's ToolResultOffloadHook writes a large result to a store first, then replaces it with a preview and a pointer, with per-tool policies; a failed write leaves the result inline.

#### What you gain

> Big one-off outputs stop filling the context while staying exactly recoverable.

#### Drawbacks and risks

> Each later need costs a read turn; saved files may hold sensitive page or subagent content and need session-scoped cleanup; overlaps with existing stripping.

#### Implementation and affected files

> Offload only large outputs that cannot be cheaply re-run, at the existing giant-result boundary; save first, then replace; keep errors and failed writes inline; measure retrieval turns against tokens saved.

#### Cost

> Medium: a session-scoped store, per-tool size policy, cleanup, and a browsing-heavy benchmark.

#### Recommendation

> Defer or reject unless browsing-heavy sessions are a known cost; the gain is unproven and it adds stored sensitive data.

#### Sources and agreement

> Haystack hooks/tool_result_offloading/hooks.py:60-134, utils.py:73-113, stores.py:12-76; ours extensions/work-models.ts:1902-1916 (giant-result cut), extensions/work-images.ts; Astra idea 4

#### Proposed requirement

> Offloading lowers total tokens on browsing-heavy runs with no overall regression and no saved data outliving its session.

#### Proposed steps

> - Measure how many tokens large non-bash results take in recent sessions
> - Save large subagent, browser_fetch and jev results to a session folder with a preview and path; leave errors and failed writes inline
> - Clean up with the session; never offload twice
> - Benchmark a browsing-heavy run against the baseline; keep or revert by the rule
