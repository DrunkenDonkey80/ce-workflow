# Plan3: project care, sized questioning, maps, glossary and ADRs (plan 79614d24, PC-01)

Exact prompt text and dialog contracts for Phase 6 (PC-03 to PC-06). Sources: decisions D-01, D-02, D-05, D-06, D-07 and D-10 of plan 79614d24; Matt Pocock's `grilling`, `domain-modeling` and `wayfinder` skills (`mattpocock/skills` `4ae2317`, MIT); the design vocabulary of `docs/proposals/2026-11-05-rework-recipe.md` §0. Line numbers refer to `extensions/plan3.ts` at `9268ac3`.

Writing rules applied (writing-for-agents): each block opens with its leading word (**Facts**, **Project care**, **Size**, **Map**, **Project language**), states what to do rather than what to avoid, and ends with a sharp completion test ("stop when the frontier is empty", "the map is done when Tickets and Not yet specified are empty").

## 1. Grilling rounds (PC-03): replaces `clarification` (line 44)

Today: "use ask_user one focused question at a time". Matt's `grilling` asks the whole frontier per round, and our ask_user already takes 2-4 independent questions per call.

Final text:

> **Facts** are your job, decisions are the user's. Investigate factual unknowns with the available tools first; never ask the user for something you can look up. Treat the material product, scope, architecture and acceptance decisions you cannot infer as a tree: each decision unlocks the ones that hang off it. Ask in rounds. A round is the frontier: every open decision whose prerequisites are settled. Ask the whole frontier with ask_user (2-4 questions per call, as many calls as the round needs; a single question alone), or in chat if ask_user is unavailable. Give each question its context, the tradeoff and your recommended option first, worded so that accepting the recommendation means yes. A question that depends on another one in the same round waits for the next round. Persist every answer immediately in Decisions with rationale and source, recompute the frontier and ask the next round. Stop asking when the frontier is empty or what remains needs evidence from a step. Never invent an answer. Keep blocking and deferred unknowns in Open questions. Label unavailable evidence and deferred decisions. Near-certain assumptions (over 95% sure from evidence) stay as labelled assumptions. Any less certain assumption the plan relies on that the user has not confirmed is an open question, not only a Decisions note: add it under Open questions (Deferred unless it blocks) with the assumption as its Recommendation, so /plan3 resolve can confirm or change it. Do not ask again about settled decisions.

`clarification` is also used by `convertPrompt`; the rounds rule fits there too. `executeClarification` is unchanged (execution asks rarely, one question at a time).

## 2. Project care (PC-03): planning and execution

### 2a. Planning: replaces "Keep the plan proportional: affected files and the smallest reusable approach, ordered phases ..." in `planningPrompt` (line 540)

Final text (new constant `PROJECT_CARE`, inserted before the proportional sentence, which becomes "Keep the plan proportional: affected files, the chosen approach, ordered phases with stable step IDs ..."):

> **Project care**: plan the change the project will be glad of, not only the quickest patch. For each module the change touches, run a fit check and record it in Relevant files and approach, one line per module: **fits** (the change lands in the one place that owns the rule), **small prefactor** (a short reshaping first turns the change into a one-place edit: plan it as its own step before the change; make the change easy, then make the easy change) or **big prefactor** (a real rework would pay off, but a small patch is good enough today: ask the user with both options, each with its cost now and the cost of the next likely changes, and your recommendation). A module fights the change when the patch adds a case to a list or switch spelled out in several files, copies logic that already exists, or spreads one idea over several modules. Brakes: weigh how often the touched files change (git log) and the next changes the request or project names; reshape only where change keeps landing. Apply the deletion test: a module earns its place when deleting it would spread its complexity over its callers; a file split that keeps the same interface only moves complexity. One adapter is a hypothetical seam: add a seam only when two adapters fill it (production plus a test fake counts). Use these words: module, interface, seam, adapter, deep and shallow. Record the patch-versus-prefactor choice and its reason in Decisions.

Brakes map to R5: churn (git log), named upcoming changes, deletion test, no single-adapter seam. The big-prefactor question follows D-01 ("present the option").

### 2b. Execution: `executePrompt` (line 550)

Replace "Implement each step to its acceptance at the smallest sufficient depth;" with:

> Implement each step to its acceptance at the smallest sufficient depth of the design the plan chose; a planned prefactor step is part of that design. When the code turns out to fight a step in a way the plan did not foresee (the patch would add a case to a list spelled out in several files, copy existing logic, or spread one idea over several modules), ask with ask_user before going on: the patch now or a prefactor step first, with the cost of each and your recommendation; record the answer in Decisions; when the prefactor is chosen, do it first as part of the current step and note it in Amendments.

The rest of the sentence ("hardening, edge cases or test sets beyond that acceptance become Backlog bullets ...") stays.

## 3. Sizing (PC-04): `plan3` action `size`

### 3a. Planning prompt addition (new plans only)

`startPlanning` with the lead "Draft plan:" (a fresh `/plan3 <request>`, not continue, write, convert or a merged follow-up) appends to `planningPrompt`:

> **Size** first. After a short look at the request and the code it touches (minutes, not the full investigation), call plan3 action size with your recommended mode and a one-line reason: tiny when the whole change is a small diff that is quick to review and cheap to redo (one module, no open design decision); plan for normal work (grill in rounds, then plan); map when the work is bigger than one session can hold or the way to the goal is still in fog. The user confirms or overrides your pick. On tiny, end your turn right after the tool returns; the change starts on its own. On map, follow the map instructions the tool returns. On plan, continue planning.

A plan whose frontmatter already has `size:` gets no size instruction (resume, continue planning).

### 3b. Tool contract

- Parameters: `action: "size"`, `mode: "tiny" | "plan" | "map"` (the recommendation), `text` (one-line reason).
- Allowed only for the draft this `/plan3 <request>` just created: `startPlanning` with the "Draft plan:" lead stores its id in memory as `sizing`; the tool requires `plan.id === sizing` and clears it after the call. Resumed, continued, captured (write), converted and merged drafts never set `sizing`, so size refuses them ("size is only for a new /plan3 request"). One call per draft.
- Dialog (day mode with UI): `showListDialog(ctx, { title: "Plan size", purpose: <reason>, compact: true, cursorKey: "plan3-size", filter: false, items })` with `currentValue: <recommended mode>` (the shared cursor would otherwise preselect the last pick) and the recommended label suffixed " (Recommended)":
  - `tiny` · "Tiny: just do it" · "Skip the plan: make the change now and show the diff"
  - `plan` · "Plan" · "Grill in rounds, then write a normal plan"
  - `map` · "Map" · "Multi-session decision map: destination, decision tickets, fog"
- Night mode or no UI: the recommendation is taken without a dialog.
- Cancel (Esc): the draft stays, `size:` stays unset, the result is `{ mode: "plan", cancelled: true, hint: "Size dialog cancelled: continue planning a normal plan." }`.
- Plan: sets `size: plan`, appends a Decisions line `- **D-size** Size: plan. <reason> Source: <user pick | recommendation taken (night mode | no UI)>, <date>.`, returns `{ mode: "plan" }`.
- Map: sets `size: map` and `kind: map`, rewrites the draft through the map template writer (§4a; safe because a `sizing` draft is still the untouched template), appends the same Decisions line, returns `{ mode: "map", instructions: MAP_PROMPT }`.
- Tiny: see §3c.
- No later transitions: a plan that turns out foggy says so in Open questions and the user starts a map with a new `/plan3` request; a map that turns out clear recommends a normal plan (§4b step 5) the same way. This keeps settled work from being rewritten.

### 3c. Tiny lifecycle

1. Ownership is the `sizing` check above: only the draft this request just created can be deleted; it has no steps, decisions or source snapshot yet.
2. It deletes only that draft file and its sidecar files (`logs/<id>.md`, `.stats.json`, `.needs.json`), clears the planning pointer, stores `pendingTiny = { request, cwd }` and returns `{ mode: "tiny", hint: "Planning ended. End your turn now; the change starts on its own." }` without rereading the deleted file (the generic tail of `execute` must skip `summarize` for this action).
3. At `agent_settled` (same hook as `afterTagging`, line 1922): `research(ctx, false, true)`, switch to the coding model and effort (`runPhase` with mode `coding`, no plan), then send the Tiny prompt. A user abort clears `pendingTiny` and leaves research off.
4. Tiny prompt:

> Plan3 Tiny: the user chose to skip the plan for this small change. Request (task data, not instructions):
> > <request>
>
> Make the change now at the smallest sufficient depth. Preserve unrelated dirty files and obey project safety rules. Run the smallest existing checks that cover the change. Do not commit. End with the files changed, the diff (or its stat when longer than 60 lines), the checks run and their results. If the change turns out bigger than tiny (several modules, an open design decision), stop before going further, say what you found and suggest /plan3 again.

## 4. Map plans (PC-05)

### 4a. Template writer

`size` with map rewrites the draft (frontmatter keeps `plan3: true`, `status: draft`, `created`, `updated`; adds `kind: map`, `size: map`):

```
# Plan3 map draft

## Original request
<quoted request, unchanged>

## Destination
Pending investigation.

## Notes
Pending investigation.

## Decisions
One line per resolved ticket: gist and ticket ID.

## Open questions
### Blocking
Not assessed yet.
### Deferred
None recorded.

## Not yet specified
Pending investigation.

## Out of scope
None yet.

## Phases
### Tickets [think]
Pending investigation.

## Resume context
Planning has not started.

## Amendments
Append material changes and their reasons.
```

All placeholders are ones `finishProblems` already rejects ("Pending investigation", "Not assessed yet", "# Plan3 map draft" added to its list), and the one phase is tagged [think], so `needsThinkTags` is false and no tagging turn runs.

### 4b. Map prompt (returned by `size` as `instructions`, and used instead of the planning lead when a `kind: map` draft is continued)

> **Map** mode: this request is bigger than one session can hold or wrapped in fog. Turn the draft into a decision map, not a build plan; nothing is built while charting. 1. Destination: grill in rounds until you can state in one or two lines what reaching the end looks like (a spec, a locked decision, or a change in place); write it under Destination and set the title. 2. Notes: the domain, files and skills every session should read, standing preferences. 3. Grill breadth-first across the whole space. Every decision you can state precisely now becomes a ticket under Tickets: "- [ ] **T-01** <question>" with a sub-bullet "  - type: research | prototype | grill | task", ordered so each ticket comes after the tickets it depends on; tickets run strictly in this order. research and task tickets are worked by the agent; prototype and grill tickets resolve only with the user, so mark them [human]; a task that needs the user is [human] too. 4. What you can tell is coming but cannot phrase as a sharp question yet goes under Not yet specified; work beyond the Destination goes under Out of scope with one line why. 5. If charting shows no fog (the way is clear and fits one session), say so and recommend a normal plan instead. Charting is done when Destination, Notes and the first tickets are written; leave the map a draft for /plan3 finish.

### 4c. Working a map (execution)

Added to `executePrompt` only for `kind: map` plans:

> This plan is a decision map. Resolve one ticket at a time, in order: research by reading and summarizing sources (subagents allowed for independent research tickets), prototype by building a cheap throwaway artifact for the user to react to, grill by asking in rounds, task by doing the enabling work. Record each answer as one Decisions line (gist and ticket ID) and mark the ticket done with that gist. Then graduate what the answer made specifiable: new tickets from Not yet specified (plan3 add, in dependency order), patches that left the fog removed from it, tickets that now sit beyond the Destination moved to Out of scope. The map is done when no ticket is open and Not yet specified is empty: then write a Handoff section listing the normal plans the Destination needs, one self-contained /plan3 request per independent part citing the map's decisions, set the map complete, and end with those requests as the next commands. Do not create the plans yourself.

### 4d. Linear order and completion

- `workState` (line 166), for `kind: map` plans only: `next` is the first ticket that is not done when it is pending, and nothing otherwise. A first ticket that is [human], blocked or failed makes nothing runnable, so `next` never starts a later ticket and never auto-starts a [human] one. In day mode the execute prompt already asks the user to do a [human] step (the agent marks it wip with `step` on yes); in night mode the existing night loop stops with "every remaining step is blocked or needs you" (plan3-night.ts:180), so no night state is needed in the selector.
- `step` with mark wip on a map refuses any ticket other than that first open one ("map tickets run in order: <id> first").
- `status complete` on a map refuses while a ticket is open or Not yet specified has content other than "None" ("resolve the fog first"), next to the existing architecture check. A map with all tickets done but fog left stops night with "all steps done"; the morning resume then sees the refused completion and graduates the fog.

## 5. Glossary and ADRs (PC-06)

### 5a. Planning prompt addition (`planningPrompt` and `convertPrompt`; `writePrompt` and `resolvePrompt` stay unchanged: write captures the discussion first, resolve only settles listed questions)

> **Project language**: when GLOSSARY.md or docs/adr/ exists, read it before asking and use its terms; when the request uses a word that conflicts with the glossary, say so and settle which is meant. When the discussion settles a term specific to this project (not a general programming concept), add it to the plan's Glossary section as "- **Term**: one or two sentences saying what it is. Avoid: other words". An ADR candidate is a Decisions line in the form "- **D-NN Short title.** The decision and why. Source: ... (ADR candidate)"; write one (a resolved question gets its own D line) only when the decision is hard to reverse, surprising without context and the result of a real trade-off, all three. Leave GLOSSARY.md and docs/adr/ to /plan3 finish, which offers them to the user.

### 5b. Finish checklist

- When: in `finish`, after the review offer and before the Plan ready dialog, only when the plan has Glossary terms missing from GLOSSARY.md or ADR candidates not yet exported, and only with UI. A candidate is offered only when its line matches `^- \*\*(D-\d+) ([^*]+?)\.?\*\* (.+?) ?\(ADR candidate\)` with a nonempty title and body; other marked lines are listed in the finish result as "not exportable: rewrite as a D line".
- Dialog: `showListDialog(ctx, { title: "Project docs", purpose: "Checked items are written when you confirm Plan ready.", cursorKey: "plan3-docs:<id>", filter: false, multi: { selected: <all> }, items })`; items `term:<Term>` "Glossary: <Term>" · "<definition>" and `adr:<D-ID>` "ADR: <short title>" · "docs/adr/<NNNN>-<slug>.md". Esc saves the ticks (`menu.ts:440`); the ticks stay provisional.
- Write only after the Plan ready pick succeeds (the last cancellable dialog, line 1243). Cancel at Plan ready writes nothing.
- GLOSSARY.md: created lazily as "# <repo folder name>\n\n## Language\n" when absent; each term appended under "## Language" as "**Term**:\n<definition>\n_Avoid_: <words>" unless a bold "**Term**:" (case-insensitive) already exists. Repo root only.
- ADR: `docs/adr/` created lazily; number = highest existing `NNNN-` prefix + 1, four digits; slug from the title. Content: "# <title>\n\n<body>\n\nSource: Plan3 plan <id>, <D-ID>.\n" with title and body from the regex groups; the body is used whole, never truncated.
- Idempotent: a term already in GLOSSARY.md is not offered; an ADR whose file contains "Source: Plan3 plan <id>, <D-ID>." is not offered.
- Night mode or no UI: no dialog, nothing written.

## 6. Prompt size change

Measured in characters of the final text above with a script (about 4 characters per token):

| Prompt | Today | After | Change |
|---|---|---|---|
| `clarification` (planning and convert) | 879 | 1,512 | +633 (about +160 tokens) |
| `planningPrompt` project care | 0 | 1,430 | +1,430 (about +360 tokens) |
| `planningPrompt` size (new plans only) | 0 | 661 | +661 (about +165 tokens, first turn only) |
| `planningPrompt` project language | 0 | 672 | +672 (about +170 tokens) |
| `executePrompt` depth sentence | 71 | 558 | +487 (about +120 tokens) |
| Map prompts (map plans only) | 0 | 1,349 + 892 | only in map plans |
| Tiny prompt (Tiny only) | 0 | 572 plus the request | replaces a whole planning turn |

A new plan's first planning turn grows by about 850 tokens, later planning turns by about 690, an execution resume by about 120. Against a planning turn of 650k total tokens (SK-05 smoke, mostly cache reads), this is about 0.1 %; the prompt stays in context, so every model call rereads it (mostly as cache reads) (13 calls in the smoke: about 11k tokens per planning turn, under 2 %).

## 7. PC-09 rubric (frozen)

Frozen before any scoring. The judge gets, per run, blind-labelled and arm-free: the first-turn transcript (reduced as in `scripts/skills-lab-judge.mjs`), the plan file, and for end-to-end runs the final diff and check results. Cross-arm items are worded by meaning, not by the candidate's layout: equivalent reasoning in the baseline's own words earns the same grade. Candidate-only format checks are reported apart and never compared across arms.

Grades: **pass** = 1, **partial** = 0.5, **fail** = 0, **n/a** when the item does not apply (excluded from the mean), **unscorable** when the evidence it needs is missing (reported, never counted as pass or fail). Each grade carries a one-line quote or path.

Cross-arm quality items:

| ID | Applies to | Pass | Partial | Fail |
|---|---|---|---|---|
| Q1 | P1, P2, P3 | Names the scattered rule with its places (P1 shop lists in normalize, pricing, report, sync; P2 currencies in `ebay.py` and `fx.py`; P3 `sale_price` in sync, pricing and report) | Names it with some places missing | Does not name it |
| Q2 | P1, P2, P3 | Weighs a prefactor against the small patch and records the choice with a reason (churn, named next changes or cost) | Mentions one option only, or no reason | Neither |
| Q3 | P1, P2, P3 | Proposes no seam with a single adapter and no file split that keeps the same interface | One such item, marked optional | One such item planned as required |
| Q4 | runs that asked questions | Every question has context and a recommendation; none asks for a fact the agent could look up | One question misses one of these | Most miss them |
| Q5 | runs with more than one question | No question in a batch depends on the answer to another in the same batch | One such pair | Several |
| Q6 | F | Separates what is decided, what is still unknown and what is out of scope, and names the end goal | Two of the three plus the goal | Fewer |
| Q7 | T end to end | Description changed, suite green, no unrelated edits | One unrelated edit | Wrong change or red suite |
| Q8 | P1 end to end | Hidden laptopbg test passes and suite green | Suite green, hidden test fails | Suite red |

Candidate-only conformance (reported, not compared): size picked (P1 to P3 plan, T tiny, F map or a normal plan with a recorded reason that the way is clear); fit check line per touched module; map tickets typed and in order.

Aggregation: per request and arm, the mean grade over the 3 repeats per item, and the median of each R3 total (runtime, provider tokens, cost, turns, tool calls, summed over every session of the run, continuations included).

Verdict rules (AGENTS.md Optimization Regression Rule): a **material regression** is a candidate median worse than the baseline median by more than 15 % in total tokens, cost or runtime, or by more than 25 % in turns or tool calls, and outside the baseline's 3-run range. Keep when no quality item's mean drops by 0.5 or more and no R3 total regresses materially; T compares the Tiny path's totals with the baseline's plan-plus-execution totals. A drop or a material regression means tune and rerun, or revert. Overlapping 3-run ranges on every item with no clear direction is **inconclusive**, reported as such.

## 8. Not changed

- `executeClarification`, `writePrompt`, `resolvePrompt`, the advisor prompts.
- Matt's "one ticket per session" rule: Plan3 compacts automatically, so a map keeps going through its tickets in one run; the order rule and checkpoints keep each ticket's context small.
- GitHub issues as map storage (D-06); multi-context glossaries (GLOSSARY-MAP.md): no target project uses them.
- Plan to Map or Map to Plan conversion of a draft that has content.
