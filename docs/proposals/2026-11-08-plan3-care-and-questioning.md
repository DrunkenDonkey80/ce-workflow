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

> Implement each step to its acceptance at the smallest sufficient depth of the design the plan chose; a planned prefactor step is part of that design. When the code turns out to fight a step in a way the plan did not foresee (the patch would add a case to a list spelled out in several files, copy existing logic, or spread one idea over several modules), ask with ask_user before going on: the patch now or a prefactor step first, with the cost of each and your recommendation; record the answer in Decisions and add the prefactor with plan3 add when chosen.

The rest of the sentence ("hardening, edge cases or test sets beyond that acceptance become Backlog bullets ...") stays.

## 3. Sizing (PC-04): `plan3` action `size`

### 3a. Planning prompt addition (new plans only)

`startPlanning` with the lead "Draft plan:" (a fresh `/plan3 <request>`, not continue, write, convert or a merged follow-up) appends to `planningPrompt`:

> **Size** first. After a short look at the request and the code it touches (minutes, not the full investigation), call plan3 action size with your recommended mode and a one-line reason: tiny when the whole change is a small diff that is quick to review and cheap to redo (one module, no open design decision); plan for normal work (grill in rounds, then plan); map when the work is bigger than one session can hold or the way to the goal is still in fog. The user confirms or overrides your pick. On tiny, end your turn right after the tool returns; the change starts on its own. On map, follow the map instructions the tool returns. On plan, continue planning.

A plan whose frontmatter already has `size:` gets no size instruction (resume, continue planning).

### 3b. Tool contract

- Parameters: `action: "size"`, `mode: "tiny" | "plan" | "map"` (the recommendation), `text` (one-line reason).
- Allowed only while planning the current draft (`isPlanning`, pointer planning) and only once (`size:` meta absent); otherwise an error naming the reason.
- Dialog (day mode with UI): `showListDialog(ctx, { title: "Plan size", purpose: <reason>, compact: true, cursorKey: "plan3-size", filter: false, items })` with the recommended item first and its label suffixed " (Recommended)":
  - `tiny` · "Tiny: just do it" · "Skip the plan: make the change now and show the diff"
  - `plan` · "Plan" · "Grill in rounds, then write a normal plan"
  - `map` · "Map" · "Multi-session decision map: destination, decision tickets, fog"
- Night mode or no UI: the recommendation is taken without a dialog.
- Cancel (Esc): the draft stays, `size:` stays unset, the result is `{ mode: "plan", cancelled: true, hint: "Size dialog cancelled: continue planning a normal plan." }`.
- Plan: sets `size: plan`, appends a Decisions line `- **D-size** Size: plan. <reason> Source: <user pick | recommendation taken (night mode | no UI)>, <date>.`, returns `{ mode: "plan" }`.
- Map: sets `size: map` and `kind: map`, rewrites the draft through the map template writer (§4a), appends the same Decisions line, returns `{ mode: "map", instructions: MAP_PROMPT }`.
- Tiny: see §3c.
- Plan may become Map later: the planner calls size again with mode map when fog grows; the second call is allowed only from `size: plan` to map and asks again.

### 3c. Tiny lifecycle

1. The tool checks that the draft has no steps and was created by this planning run (pointer id equals the plan id, status draft); otherwise it refuses with "Tiny needs the fresh draft; finish or delete the plan instead."
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

> This plan is a decision map. Resolve one ticket at a time, in order: research by reading and summarizing sources (subagents allowed for independent research tickets), prototype by building a cheap throwaway artifact for the user to react to, grill by asking in rounds, task by doing the enabling work. Record each answer as one Decisions line (gist and ticket ID) and mark the ticket done with that gist. Then graduate what the answer made specifiable: new tickets from Not yet specified (plan3 add, in dependency order), patches that left the fog removed from it, tickets that now sit beyond the Destination moved to Out of scope. The map is done when Tickets and Not yet specified are both empty: then write the normal plan or plans the Destination needs with plan3 action create (one per independent part, each request self-contained, citing the map's decisions), and set the map complete.

### 4d. Linear order

`workState` (line 166) takes the first pending step past open [human] steps. For `kind: map` plans: `next` is the first open ticket of any mark (pending, wip or human); when that ticket is [human], `next` is it in day mode (the execute prompt already asks the user to do [human] steps) and nothing is runnable in night mode, so later tickets and the handoff wait. Requirements (`needs:`) are not used for this; order alone decides.

## 5. Glossary and ADRs (PC-06)

### 5a. Planning prompt addition (all planning prompts)

> **Project language**: when GLOSSARY.md (or GLOSSARY-MAP.md) or docs/adr/ exists, read it before asking and use its terms; when the request uses a word that conflicts with the glossary, say so and settle which is meant. When the discussion settles a term specific to this project (not a general programming concept), add it to the plan's Glossary section as "- **Term**: one or two sentences saying what it is. Avoid: other words". End a Decisions line with "(ADR candidate)" only when the decision is hard to reverse, surprising without context and the result of a real trade-off, all three. Leave GLOSSARY.md and docs/adr/ to /plan3 finish, which offers them to the user.

### 5b. Finish checklist

- When: in `finish`, after the review offer and before the Plan ready dialog, only when the plan has Glossary terms missing from GLOSSARY.md or ADR candidates not yet exported, and only with UI.
- Dialog: `showListDialog(ctx, { title: "Project docs", purpose: "Checked items are written when you confirm Plan ready.", cursorKey: "plan3-docs:<id>", filter: false, multi: { selected: <all> }, items })`; items `term:<Term>` "Glossary: <Term>" · "<definition>" and `adr:<D-ID>` "ADR: <short title>" · "docs/adr/<NNNN>-<slug>.md". Esc saves the ticks (`menu.ts:440`); the ticks stay provisional.
- Write only after the Plan ready pick succeeds (the last cancellable dialog, line 1243). Cancel at Plan ready writes nothing.
- GLOSSARY.md: created lazily as "# <repo folder name>\n\n## Language\n" when absent; each term appended under "## Language" as "**Term**:\n<definition>\n_Avoid_: <words>" unless a bold "**Term**:" (case-insensitive) already exists. GLOSSARY-MAP.md present: write nothing to the map; terms go to the root GLOSSARY.md only when it exists, else the item is shown disabled with "multi-context glossary: add by hand".
- ADR: `docs/adr/` created lazily; number = highest existing `NNNN-` prefix + 1, four digits; slug from the title. Content: "# <short title>\n\n<decision text without the ID, bold markers and the (ADR candidate) marker>\n\nSource: Plan3 plan <id>, <D-ID>.\n". Short title: the bold text of the Decisions line minus its ID, else its first sentence, at most 80 characters.
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

Scored by the judge per run on the first-turn transcript and plan file, each item pass, partial or fail with a one-line quote as evidence. Script results (R3 metrics, check, outcome) are reported beside it, never folded into a score.

| ID | Request | Item |
|---|---|---|
| G1 | all | Size fits the kind: P1, P2, P3 plan; T tiny; F map (baseline has no sizing: scored "n/a", compared on end result instead) |
| G2 | all | Questions come in rounds: every question of a round has its prerequisites settled; the round asks all such open decisions at once |
| G3 | all | Each question carries context, tradeoff and a recommendation; no question asks for a fact the agent could look up |
| C1 | P1, P2, P3 | The plan names the scattered list or rule (shop lists in 4 modules; currencies in `ebay.py` and `fx.py`; `sale_price` in sync, pricing and report) |
| C2 | P1, P2, P3 | A fit check line per touched module and a patch-versus-prefactor Decision with a reason |
| C3 | P1, P2, P3 | A prefactor is proposed only with a churn or named-change reason; a big one is asked, not assumed |
| C4 | P1, P2, P3 | No seam with a single adapter; no file split that keeps the same interface |
| F1 | F | Destination stated; tickets are sharp questions with a type; fog separated from tickets and from out of scope |
| T1 | T | End result: the description changed, suite green, no unrelated edits (both arms) |
| E1 | P1 end to end | Hidden laptopbg test passes, suite green |

Verdict rules (AGENTS.md Optimization Regression Rule): keep when rubric items improve or hold and no R3 total (runtime, tokens, cost, turns, tool calls, summed over every session) regresses materially; T compares the Tiny path's totals with the baseline's plan-plus-execution totals. A material regression in any R3 total means tune and rerun or revert.

## 8. Not changed

- `executeClarification`, `writePrompt`, `resolvePrompt`, the advisor prompts.
- Matt's "one ticket per session" rule: Plan3 compacts automatically, so a map keeps going through its tickets in one run; the order rule and checkpoints keep each ticket's context small.
- GitHub issues as map storage (D-06), GLOSSARY-MAP.md multi-context writing (shown, not written).
