---
plan3: true
status: complete
created: 2026-10-06
updated: 2026-10-06T10:19:59.112Z
---

# Make Plan3 official: legacy workflow switch, plan tool, progress and plans UI

## Original request

> lets talk about this plan3 system, it was tested and working, time to make it more official. can we have the old roadmap/work/thing on a switch, disabled for now but can be turned back on, before we completely remove it. that removes the fleet ui F9 thing too
> then for plans:
> - better name of the file - when the plan is processing it can summarize itself as one liner so this gets the plan name
> - code support - a tool definition that can work with the plan instead of the llm manually updating it - get what the current wip is, mark step done, open the next, mark it as complete, etc, all the operations with the plan file to be actually a single tool - makes sense?
> - progress support - we have progress for our old system, but with these plans we currently have whats done on the plan, whats worked on, whats left etc, so with code we can clearly show a 10/15 steps done and use the old system's progress to show the plan progress.
> - "the plan" means the last worked on plan or first available 
> - ui support - plans3 to have a better ui listing of the how much is done on the plan (undone/sorted by recent on the top, the current one on the very top) so I can hit one and have a command to resume, force finish it, delete it (with confirmation)
> - before starting /plan3 to make new plan to switch on research mode, finishing planning completely when it stores it to turn it off. force compaction when starting/resuming a plan if it was not the last plan we worked on?
> 
> anything else you can think of?

## Goal, requirements, and non-goals

Goal: Plan3 becomes the primary, code-supported planning/execution flow; the legacy ce-workflow orchestration is behind a settings switch, off by default, and can be re-enabled until it is removed later.

Requirements
- R1 Workflow switch `workOrchestrator.workflow.enabled` (boolean, effective global+project settings, unset = OFF — D02). OFF hides orchestration only (D01): /wo workflow actions (small/medium/large task, finish, debug, add, auto-route), Subagent Tasks/Fleet menu item and F9, `/wo goal|monitor|pause|resume|resume-work|design|redesign|context-fill`, work_* tools and background verifiers, and the Direct-request system prompt. Kept: /wo as utility menu (Settings, telemetry, usage, context guard, catch-up, scout, rollback of private workflows only if workflow on), `/wo compact`, `/wo fact`, F7 (opens the menu), F8, research/ideate, Jev, vision, footer, compaction.
- R2 verify-package reads the same switch; when OFF it skips a named list of workflow-only test scripts and prints `skip - <script> (workflow disabled)`; general tests always run (D02, D03).
- R3 Research mode no longer blocks auto-compaction; while research is active the auto trigger is 90% of the current model's context window instead of the configured fixed trigger (D04). Applies to all research, not only Plan3.
- R4 One agent tool `plan3` performs all structured plan operations (get, title, status, step marks, next, section append/replace). Prose bodies are still written with write/edit (D05).
- R5 File naming: the planning agent sets a one-line title through the tool; the file is renamed to `<created>-<title-slug>-<id>-plan3.md`, keeping the 8-hex id stable so references by id survive (D06).
- R6 "The plan" = the session's last worked-on plan if it is still open, else the most recently updated open plan, else none (D07). Tool calls and `/resume3` without arguments default to it.
- R7 Progress: a compact footer status chip (`ctx.ui.setStatus("plan3", …)`), e.g. `P3 10/15 · PL-02`, instead of a widget line (D16); refreshed on session start, after every plan3 tool write and on /resume3; cleared when no open plan. The /plans3 rows use the old system's `progressBar` (D08).
- R8 `/plans3` UI: overlay list (work-dialogs), current plan on top, then open plans by most recent update, then complete plans; each row shows status, done/total and bar. Selecting a plan opens Resume / Force finish / Delete; Delete requires confirmation; Escape returns to the parent (Dialog UX rule). Non-TUI keeps a text listing.
- R9 Lifecycle: `/plan3` turns research mode on before planning; `/plan3 finish` (R24) turns it off. `/resume3` turns research on for draft/blocked plans and off for ready/active plans (replaces the prompt's "ask the user to turn it off").
- R10 Before `/plan3` or `/resume3` sends its prompt, compact the session when the target is not the session's last worked-on plan and context is not trivially small (D09); send the prompt after compaction completes.
- R11 "Make it official": drop "independent Plan3 trial" wording; prompts tell the agent to use the `plan3` tool for markers/status instead of editing them by hand.
- R12 `/plan3` with no request opens the /plans3 list (idea 1).
- R13 Archive: a plan reaching `complete` (tool or Force finish) moves to `docs/plans/done/`; /plans3 lists both folders; the id and path-escape checks cover both (idea 2).
- R14 Step evidence: `step`/`next` accept an optional `check` (actual command and result), written as an indented `- check: …` line under the step (idea 4).
- R15 Stale-plan check, code only, no LLM call: on /resume3, collect repo paths named in the plan (backticked paths that exist) and list those changed in git since the plan's `updated` (`git log --since` + uncommitted `git status`); the resume prompt names them and tells the agent to re-check them first (idea 5).
- R16 Add/split steps: tool action `add {after?, steps[], reason}` inserts steps with the next free ID of that phase's prefix (e.g. after JEV-15 → JEV-16) and appends an automatic Amendments entry with the reason; splitting = add sub-steps after the original and mark the original as the agent sees fit (idea 6, "absolutely critical").
- R17 Duplicate check before `/plan3` creates a draft: code-only word-overlap of the new request against open plans' titles and original requests; if similar, offer Resume that plan / Merge as follow-up (append the request under a `### Follow-up request <date>` in Amendments, set status draft, resume planning on that plan) / Create new anyway. Non-TUI: create new and notify the similar plan (idea 7).
- R18 Timing: frontmatter `started:` (first time a step goes wip) and `updated:`; /plans3 rows show active duration and last touched (e.g. `active 3d · touched 2h ago`) (idea 8).
- R19 Plan per session branch: the current-plan pointer is read from the current session branch (`getBranch`), so a forked branch keeps its own current plan (idea 11).
- R21 Plan models: setting `workOrchestrator.plan3.models` = ordered list of `{model, thinking}` edited in a "Plan3 → Plan models" Settings row (add / remove / reorder; model picker reused from the role rows). The second opinion is the first listed model that is available and from a different family than the current model (D23); e.g. list [astra, opus] → on Opus the advisor is astra, on astra it is Opus. On your machine the list is set to `openai-codex/gpt-6-astra` high and `anthropic/claude-opus-5-5` high. No eligible entry → run with the current agent only and say why. Adding `all` (`/plan3 ideas all [focus]`, `/plan3 review all`) launches every eligible entry in parallel; outputs are merged with per-model source tags and agreement between models is marked.
- R22 `/plan3 ideas [focus]`: on the current plan (R6), the current agent first launches the second-opinion advisor asynchronously (read-only, fresh context, exact model from R21), writes its own ideas without reading the advisor output, then merges both into one numbered list with source tags, overlaps marked, a recommendation per idea, and asks the user to pick. Accepted ideas are written into the plan (requirements, steps, Decisions with source); rejected ones are recorded in Decisions.
- R23 `/plan3 review`: the advisor reviews the plan against the repository (feasibility, missing steps or files, wrong commands, contradictions with Decisions, unclear acceptance). The current agent validates every finding against the code, applies accepted corrections through the `plan3` tool / edit, and records each finding's disposition (accepted / rejected + reason) in Amendments. New blocking questions set status `blocked`. Works for draft, blocked, ready and active plans.
- R24 `/plan3 finish` (alias `done`), code only: validates the plan (original request present, no draft placeholders like `Pending investigation` / `Not assessed yet`, Blocking is `None`, at least one step); on failure lists the problems and changes nothing. On success: status `ready`, `updated`, session pointer = this plan, research mode off, then compaction (R10 threshold), then notify `Plan ready · /resume3`. Planning prompts no longer end with `/resume3` and the agent may not set `ready` itself during planning (tool refuses `ready` while research was started by Plan3; it may set `draft`/`blocked`).
- R25 After each planning turn (agent end while the current plan is draft/blocked and Plan3 research is on), code shows `Next: /plan3 ideas · /plan3 review · /plan3 finish`; the planning prompt ends its reply with the same three commands. After finish the plan is current, so `/resume3` without arguments continues it.
- R20 Legacy conversion (idea 12, reversed): when the old store (`.ce-workflow/work-items.json`, read via `extensions/work-store.js`) has unfinished epics/tasks not yet converted, /plans3 shows a `Convert legacy work (N)` row; converting an epic writes a Plan3 file (title, description as original request, children as steps: closed→[x], in_progress→[wip], blocked→[blocked], open/planned→[ ], deferred→Deferred questions; notes/evidence into Resume context) with frontmatter `source: work:<id>`. The old store is read-only; already converted ids are skipped. Works regardless of the workflow switch.

Non-goals
- Removing the legacy workflow code (later, separate plan).
- Renaming the commands (/plan3, /plans3, /resume3 stay; `/resume` is a Pi builtin).
- Git commits of plans, cross-project plan listing, plan archives (deferred ideas).
- Changing compaction modes other than the research threshold.

## Decisions

- D01 Switch scope = orchestration only; utilities stay in /wo. Source: ask_user, "Orchestration only (recommended)". Rationale: Settings live in /wo, so it must stay reachable to turn the switch back on.
- D02 Unset switch = OFF; when disabled, workflow tests do not run. Source: ask_user answers "when it is disabled tests should not run too" and "Unset = OFF".
- D03 Mechanism (inferred from D02): verify-package computes the effective switch from `${PI_CODING_AGENT_DIR ?? ~/.pi/agent}/settings.json` merged with `<repo>/.pi/settings.json`. When ON, workflow tests run with a temporary agent dir whose settings.json enables the workflow; general tests keep the existing empty agent dir.
- D04 Research mode allows auto-compaction at 90% of the context window. Source: ask_user, "research mode should still allow autocompact but at like 90% of the context window instead of fixed 200k".
- D05 (agent recommendation, inferred from "all the operations with the plan file to be actually a single tool") One `plan3` tool with an `action` enum; whole-plan prose authoring stays with write/edit because a tool cannot usefully replace free-form writing.
- D06 (inferred) Identify plans by the existing 8-hex id in the filename; renames never change it.
- D07 (inferred from the request's definition) Session pointer stored as a `plan3-current` custom session entry; plan frontmatter gains `updated:` (ISO) written by the tool so "most recent" works across sessions.
- D08 (inferred) Move `progressBar` from work-models.ts to work-dialogs.js and import it in both, instead of duplicating it.
- D09 (assumption, labelled) "Trivially small" = under 20,000 context tokens; compaction is skipped then because there is nothing worth compacting. Adjustable constant.
- D10 (inferred) The switch is read when the extension loads; the Settings toggle saves and then calls `ctx.reload()` (as the monitor reload command already does) so registrations (tools, F9) follow it without per-call gating.
- D11 (inferred; see R24 for `ready`) `status complete` via the tool is refused while `[ ]`/`[wip]` steps remain; the UI's Force finish sets complete anyway and appends an Amendments line listing unfinished steps.
- D12 (inferred) Compaction failure before a Plan3 prompt notifies the error and does not send the prompt; the user retries.
- D13 User selection of extra ideas (chat reply after the idea list): accepted 1, 2, 4, 5, 6, 7 (+ merge as follow-up), 8, 10 (instead of the widget), 11, 12 reversed into legacy→Plan3 conversion; rejected 3 ("I prefer to test and then commit") and 9 ("risky").
- D14 (inferred) Idea 5 must avoid LLM calls (user: "can be done via code mostly so no llm calls") — git-based only.
- D15 (assumption, labelled) Duplicate similarity = Jaccard overlap of lowercased word sets (≥3 letters, stop words dropped) ≥ 0.5 against title + original request; adjustable constant.
- D16 Footer chip replaces the progress widget. Source: user reply to idea 10, "lets do that instead of a widget".
- D18 User request (chat, after the idea selection): add `/plan3 ideas`, `/plan3 review`, `/plan3 finish|done`; finishing records the plan and then exits research and compacts; list ideas/review/finish after planning steps; the finished plan becomes current so `/resume3` works directly.
- D19 Second-opinion models come from a dedicated Plan3 list setting (user: "we may have to take that other alternative from our settings"; then "we can have a Plan models there to add few and whichever we are not on picks some of the rest"), not the Advisor 1 slot, because the legacy workflow settings will be removed. Initial list astra/high, opus-5-5/high.
- D23 Default one advisor per run: the first eligible list entry (user: "yeah pick just first"). Option `all` launches every eligible entry (user: "add as an option to use all i.e. review all launches them all that are not current, ideas all"). Model family = first dash-separated token of the model id (`gpt`, `claude`, `glm`, …), so another gpt-6 variant is not chosen while on gpt-6-astra.
- D20 (inferred) Delegation is authorized only by the explicit `/plan3 ideas|review` command; the advisor runs through native pi-subagents as a new bundled read-only agent `agents/plan3-advisor.md` (tools: read, grep, find, ls, read-only bash), `context: fresh`, `async: true`, model passed as an explicit override. The prompt is generated by code with the exact agent, model and plan path; ordinary Plan3 turns never delegate.
- D21 (inferred) Subcommand parsing: `review`, `review all`, `finish`, `done` only when they are the whole argument; `ideas` takes optional `all`, then optional focus text. Any other text is a new request. Argument completions list the four subcommands.
- D22 (inferred) Advisor first, own ideas second, merge last: prevents the current agent's list from anchoring on the advisor's output.
- D17 (inferred) Legacy conversion never mutates the old store; idempotence comes from the `source:` frontmatter in existing plans. Real data check: AI-Wedge store has 27 items — 1 open epic, 1 blocked task, 25 closed; this repo's store is empty.

## Open questions

### Blocking

None.

### Deferred

- Whether to later remove the legacy workflow entirely (explicitly "before we completely remove it" — a future plan).
- Ideas rejected by the user: auto-commit of plans (3), auto-closing steps from tool output (9).

## Relevant files and approach

- `extensions/plan3.js` (119 lines): plan discovery/creation/commands. Add: frontmatter `updated`, step parser (`- [ ] **ID** …`, markers `[ ]`/`[]`/`[wip]`/`[x]`/`[f]`/`[blocked]`; matches the Jev plan format), `plan3` tool, current-plan resolution, widget, /plans3 dialog, research/compaction lifecycle, revised prompts.
- `extensions/work-models.ts`: `workflowEnabled(cwd)` helper; gate /wo subcommands and menu items (~26180–26330, 32234–32360), F9 registration (32368), workflow tool registration block (30460–30990, gate only workflow tools — knowledge, research_note, compaction_note, process_image, Jev stay), Direct-request prompt injection (31241–31320), `WORK_SHORTCUT_STATUS` (258); Settings row/panel modeled on the Jev row (32574, 32641, 32892, 33053); research compaction: `maybeCompact` (7328), turn_end trigger (32014), `compactTriggerTokens`; listen to `pi.events` `plan3:research` → `setResearchContext` (6483).
- `extensions/work-dialogs.js`: export `progressBar`.
- `extensions/work-store.js`: read-only `loadStore`/`listWorkItems`/`childWorkItems` for legacy conversion (R20).
- `scripts/verify-package.mjs`: switch read + WORKFLOW_TESTS list + skip/temporary agent dir.
- `scripts/test-work-plan3.mjs`, `scripts/test-work-settings.mjs`, `scripts/test-work-compaction-notifications.mjs` (research assertions), workflow-touching tests that turn out to be general.
- `README.md`: switch, plan3 tool, /plans3 UI, research threshold.
- Cross-extension link: plan3.js and work-models.ts are separate extensions; use the existing `pi.events` bus (already used by work-fleet/work-ask-remote) rather than importing work-models.ts.

## Phases

### Phase 1 — Workflow switch
- [x] **WF-01** Add `workflowEnabled(cwd)` (effective settings, unset false). Gate at load: F9 shortcut, workflow tool registrations, verifier tools. Gate at call: /wo workflow subcommands → notify "Workflow is off — /wo → Settings → Workflow"; filter workflow menu items; skip Direct-request prompt when off; status text without F9. Acceptance: with switch off, `/wo goal x` notifies and starts nothing; menu shows Settings/Telemetry/Usage/Context/Catch-up/Scout only; F9 not registered; no work_* tools in the tool list.
- [x] **WF-02** Settings row "Workflow (legacy orchestration)" on/off, writes `workOrchestrator.workflow.enabled`, then `ctx.reload()`. Check: `node scripts/test-work-settings.mjs` extended for the row and persisted value.
- [x] **WF-03** verify-package: effective switch, WORKFLOW_TESTS list, skip output when off, temp agent dir with enabled settings when on. Classify each `test-work-*.mjs`; general tests must pass with switch off (fix or reclassify failures; root cause, not skip-to-pass). Checks: `node scripts/verify-package.mjs --quiet` with the switch off (default) and once with it on via project `.pi/settings.json` in a temp copy or by temporarily setting the user's global value — record which was done.
- [x] **WF-04** README section for the switch.
  - check: README "Legacy workflow switch" section; verify-package README vocabulary check passes

### Phase 2 — Research auto-compaction
- [x] **RC-01** Remove the research early-returns in `maybeCompact` and the turn_end trigger; in research the trigger is `floor(0.9 × model.contextWindow)` for every compaction mode; research still skips ultracompact per-request filtering. Acceptance: research + 180k tokens on a 200k window → compaction; research + 150k → none; non-research thresholds unchanged. Check: `node scripts/test-work-compaction-notifications.mjs` (update its research assertions), `node scripts/test-work-compaction.mjs`.
  - check: `node scripts/test-work-compaction-notifications.mjs` ok (research 150k → no compaction, 185k on 200k window → boundary compaction); `node scripts/test-work-compaction.mjs` ok

### Phase 3 — Plan core and tool
- [x] **PL-01** Parser/writer in plan3.js: frontmatter (status, created, updated), title heading, steps with markers, sections; preserve unknown content byte-for-byte outside edited lines; CRLF tolerant.
  - check: `node scripts/test-work-plan3.mjs` passed (CRLF preserved, frontmatter/steps/sections)
- [x] **PL-02** `plan3` tool (pi.registerTool, plain JSON schema): `action` = `get` | `title` | `status` | `step` | `next` | `section`; optional `plan` (id, filename or path inside docs/plans; realpath-checked as today); `get` returns path, id, title, status, done/total, wip steps, next pending; `step {id, mark: pending|wip|done|failed|blocked, note?}`; `next {note?}` completes current wip and opens first pending; `status {value}` with D11 rule; `title {text}` renames (R5); `section {name: Decisions|Open questions|Resume context|Amendments, text, replace?}`. Unknown step id/section → error listing valid ones. Every write updates `updated`, the session pointer and the widget.
  - check: `node scripts/test-work-plan3.mjs` passed (marks, next, unknown step/section errors list valid ones, title rename keeps id)
- [x] **PL-03** "The plan" resolution (R6/D07/R19) from the current branch's pointer, used by tool default and `/resume3` without args (no args = resume the plan; picker moves to /plans3).
  - check: `node scripts/test-work-plan3.mjs` passed (pointer → most recent open → branch scoping; /resume3 without args)
- [x] **PL-04** Tool extras: `check` evidence on step/next (R14); `add` action with auto IDs and Amendments entry (R16); `started`/`updated` frontmatter (R18); archive to `docs/plans/done/` on complete (R13).
  - check: `node scripts/test-work-plan3.mjs` passed (check line, Jev plan 15/15 then JEV-16 + Amendments, complete → docs/plans/done)
- Checks for Phase 3: extend `node scripts/test-work-plan3.mjs` — marks, next, refuse complete with open steps, rename keeps id and returns new path, current-plan resolution order and branch scoping, path escape rejected (both folders), Jev plan file parses with 15/15 done, `add` after JEV-15 yields JEV-16 plus an Amendments line, check line written under the step, complete moves the file to done/.

### Phase 4 — Progress and plans UI
- [x] **UI-01** Move `progressBar` to work-dialogs.js (re-export in work-models test list); footer chip per R7/D16.
  - check: `node scripts/test-work-dialogs.mjs` ok; footer chip `P3 1/3 · CSV-02` asserted in test-work-plan3
- [x] **UI-02** /plans3 overlay list + action submenu (Resume / Force finish / Delete with confirm) per R8, timing per R18, `/plan3` without args opens it (R12). Checks: `node scripts/test-work-plan3.mjs` (ordering, labels, force finish amendment + archive, delete only after confirm), `node scripts/test-work-dialogs.mjs`; manual TUI check (record if not performed).
  - check: `node scripts/test-work-plan3.mjs` passed (order, labels with bar/timing, force finish amendment+archive, delete only after confirm); manual TUI check not performed
- [x] **UI-03** Legacy conversion row and converter (R20/D17). Check: `node scripts/test-work-plan3.mjs` with a temp store fixture (open epic with closed/in_progress/blocked/deferred children → expected markers; second run converts nothing; store bytes unchanged).
  - check: `node scripts/test-work-plan3.mjs` passed (markers, deferred, idempotent, store bytes unchanged); AI-Wedge store temp copy shows `Convert legacy work (1)`

### Phase 5 — Lifecycle and prompts
- [x] **LC-01** `plan3:research` event: work-models listens and calls `setResearchContext`; /plan3 emits on, `/plan3 finish` (SO-03) emits off, /resume3 per R9.
  - check: `node scripts/test-work-compaction-notifications.mjs` ok (plan3:research off, repeated on is a no-op); test-work-plan3 asserts emissions
- [x] **LC-02** Compaction before prompts per R10/D09/D12 using `ctx.compact({ customInstructions, onComplete, onError })`.
  - check: `node scripts/test-work-plan3.mjs` passed (same plan no compaction, other plan compacts first, failure sends nothing)
- [x] **LC-04** Stale-plan check (R15/D14) and duplicate check with Resume / Merge as follow-up / Create new (R17/D15). Check: `node scripts/test-work-plan3.mjs` in a temp git repo (file named in the plan committed after `updated` is reported; unrelated file is not; similar request offers the three options; dissimilar creates directly; merge appends the follow-up and sets draft).
  - check: `node scripts/test-work-plan3.mjs` passed in a temp git repo (changed src/a.js reported, unchanged src/b.js not; resume/merge/new; dissimilar creates directly)
- [x] **LC-03** Rewrite /plan3 and /resume3 prompts per R11 (shorter boundary when workflow off; tool usage; title early; planning replies end with `/plan3 ideas · /plan3 review · /plan3 finish`, never `/resume3` or self-set `ready`). Checks: `node scripts/test-work-plan3.mjs` (event emission, compaction skipped under threshold / for same plan, prompt sent only on onComplete), `node scripts/test-work-compaction-notifications.mjs`.
  - check: `node scripts/test-work-plan3.mjs` passed (official wording, tool usage, Next hint, no /resume3 in planning prompt)

### Phase 6 — Second opinion and planning commands
- [x] **SO-01** Settings: Plan3 group with the Plan models list row (R21); set the user's global list to astra/high, opus-5-5/high. Check: `node scripts/test-work-settings.mjs` (add/remove/reorder persist).
  - check: `node scripts/test-work-settings.mjs` ok (add/reorder/remove persist); user global list set to astra/high, opus-5-5/high (backup ~/.pi/agent/settings.json.bak-plan3)
- [x] **SO-02** `agents/plan3-advisor.md` read-only agent with ideas and review output contracts (numbered ideas with rationale/cost; findings with location, problem, proposed correction, severity). Check: `node scripts/verify-package.mjs --quiet` (agent-contract checks over `agents/*.md` must still pass; adjust only if they wrongly assume every agent is a workflow role).
  - check: `node scripts/verify-package.mjs --quiet` ok (switch off and CE_WORKFLOW_ENABLED=1)
- [x] **SO-03** `/plan3 ideas|review|finish|done` parsing (D21), advisor selection from the list (R21/D23), generated prompts for ideas (R22/D22) and review (R23), finish validation and sequence (R24), after-turn command hint (R25). Checks: `node scripts/test-work-plan3.mjs` — subcommand parsing incl. `/plan3 ideas for caching` = ideas with focus and `/plan3 review the auth code` = new request; prompt contains agent, exact model and plan path; current model astra → advisor opus and vice versa; list with only same-family models → current-agent-only notice; `all` on Opus with [astra, glm, opus-4] launches astra and glm only; `/plan3 review all` parses as review-all; finish refuses a placeholder plan and leaves bytes unchanged; finish on a valid plan sets ready, emits research off, compacts above threshold and points `/resume3` at it; tool refuses `ready` during Plan3 planning.
  - check: `node scripts/test-work-plan3.mjs` passed (parsing, advisor selection both directions, same-family notice, `review all` on Opus → astra+glm, finish refuse/ready); paid manual ideas/review runs not performed
- Manual: one real `/plan3 ideas` and one `/plan3 review` run on a small plan (paid; record model, cost and outcome, or record as not performed).

### Phase 7 — Docs and validation
- [x] **DOC-01** README Plan3 section: tool, the plan, /plans3 actions, ideas/review/finish, second-opinion setting, research/compaction behavior.
  - check: README "Plan3" section rewritten; verify-package ok
- [x] **VAL-01** Global validation below.
  - check: verify-package --quiet ok with switch off and on; LSP: work-models.ts too large, other files inconclusive (push-only server) — tests import all of them; manual TUI checks not performed

## Global validation

- `node scripts/verify-package.mjs --quiet` passes with the switch off (default) and workflow tests are listed as skipped; passes with the switch on.
- LSP diagnostics clean on changed files (`lens_diagnostics source=lsp scope=paths`).
- Manual TUI check (or recorded as not performed): /plans3 ordering and actions, widget shows N/M, F9 absent with switch off, Settings toggle reloads.
- Acceptance examples: a 15-step plan with 10 `[x]` shows `P3 10/15` in the footer; a completed plan lives in `docs/plans/done/`; AI-Wedge's open epic is offered for conversion (in a temp copy for the check — never modify AI-Wedge); `/resume3` with no args picks the session's last plan; starting a different plan with >20k context compacts first; `/plan3` turns research on and `/plan3 finish` turns it off, then compacts; `/plan3 ideas` returns a merged numbered list tagged by source; `/plan3 review` leaves an Amendments entry per finding.

## Resume context

Complete. All steps implemented; unit checks, verify-package (switch off/on) and a live remote-pi end-to-end run (18/18) pass — see the last Amendments entry. Nothing committed. Not exercised live: `/plan3 ideas`, legacy conversion, duplicate dialog, TUI Settings toggle/F9.

## Amendments

- 2026-10-06 (execution): RC-01 — `maybeCompact` keeps its research early-return (it serves the goal path only); the turn_end boundary trigger applies the 90% research threshold for every mode.
- 2026-10-06 (execution): LC-03 — one short official boundary for all switch states (it already says not to use work items/work_* tools), so plan3.js does not read the workflow switch.
- 2026-10-06 (execution): SO-03 — advisors are launched by the current agent from a code-generated exact `subagent` call (agent, model:thinking, fresh, async), not by plan3.js itself; the R25 hint is an agent_end notify. /resume3 no longer has a picker (moved to /plans3, PL-03).
- 2026-10-06 (execution): `section` accepts any existing `##` heading, not only the four named ones.
- 2026-10-06 (execution): Switch mechanism amended from D03: verify-package and the extension both honour `CE_WORKFLOW_ENABLED=1|0` (env beats settings) because many tests set their own PI_CODING_AGENT_DIR; verify-package exports it to every test. Test classification is an allowlist of 20 general tests (GENERAL_TESTS); every other test is workflow-only and skipped when off. `/wo context-fill` stays available when off (compaction test aid used by the general test-work-microcompact-agent). /wo menu filter keeps cswap (account switcher) too.
- 2026-10-06: Added the `all` option for ideas/review (R21, D21, D23).
- 2026-10-06: Single second-opinion model replaced by a Plan models list; advisor = first eligible entry from a different family (R21, D19, D23).
- 2026-10-06: Added R21–R25, D18–D22 and Phase 6 (second opinion, ideas/review/finish); research now ends at `/plan3 finish` instead of status `ready`; docs/validation became Phase 7.
- 2026-10-06: Added R12–R20, D13–D17, PL-04, UI-03, LC-04 from the user's selection of extra ideas; the progress widget became a footer chip (D16).
- 2026-10-06 (live validation): Remote `pi --mode rpc` run on a throwaway Git repo (driver `%TEMP%/plan3-e2e/drive.mjs`, main model anthropic/claude-haiku-4-5:low, project Plan models [haiku, gpt-6-luna]). First run 14/18 — found and fixed: (1) `/plan3 finish` treated Pi's "Nothing to compact" as failure and hid "Plan ready"; (2) the executor never set complete — prompt now says so and the tool returns a hint when all steps are done; (3) footer stayed `P3 0/0` when steps were written with write/edit — now refreshed on turn_end. Rerun 18/18: draft + title via tool + research on + footer `P3 0/3` + Next hint; `/plan3 review` launched plan3-advisor on openai-codex/gpt-6-luna:low (other family) and recorded the outcome in Amendments; `/plan3 finish` → ready, research off, "Plan ready · /resume3"; `/resume3` implemented math.js + test (`node --test` passes), marked steps with check lines, set complete → archived to docs/plans/done; `/plans3` lists `[complete] … 3/3 [████████████]`. Cost $0.149 (rerun) + $0.178 (first run). Not exercised live: `/plan3 ideas`, legacy conversion, duplicate dialog, Settings toggle/F9 in the TUI (covered by unit tests only).
