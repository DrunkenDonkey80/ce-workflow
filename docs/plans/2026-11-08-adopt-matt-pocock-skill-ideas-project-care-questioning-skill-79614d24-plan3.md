---
plan3: true
status: ready
created: 2026-11-08
updated: 2026-11-08T15:32:18.438Z
reviewed: 2026-11-08
tagsChecked: 94b415d9
started: 2026-11-08T12:39:32.742Z
---

# Adopt Matt Pocock skill ideas: project care, questioning, skill evaluation

## Original request

> we are here to talk skills. this dude has lot of highly appreciated ones:
> https://github.com/mattpocock/skills/tree/main/skills/
> another session is researching how to improve project rework using https://github.com/mattpocock/skills/tree/main/skills/engineering/improve-codebase-architecture
> 
> we are here to talk other stuff we can use. namely:
> - project care: implement in our planning the idea that the agent needs to care for the project not just the task in front, but the road ahead, to not think of the easiest way to do it now, but to think of the best way to make it work, the most future proof, the best in codebase structure, when a 2 line hack is possible to think if rewriting a module to be a supportive of these new functions is the better way to handle
> - maybe bit and small term questioning, look into wayfinder for full project ideation
> - look into grill with docs for some ideas
> - check his other skills, evaluate every, see if there is something valuable, test with/without using sol 6.1 agents, use astra to give oppinon about it too and lets get some good ideas out of him

## Goal, requirements, and non-goals

**Goal:** bring the best of Matt Pocock's skills into ce-workflow, proven by experiment, not taste. Four parts:

1. **Project care** in Plan3 planning: the planner judges whether the change fits the code it touches, and plans a prefactor ("make the change easy, then make the easy change") when the module fights the change, instead of defaulting to the smallest hack (D-01).
2. **Questioning sized to the work**, after Matt's flow (D-02): tiny work is one-shot, normal work is grilled in rounds, big foggy work becomes a wayfinder-style decision map (D-05, D-06).
3. **grill-with-docs ideas**: a shared project language (GLOSSARY.md) and ADRs for hard-to-reverse decisions, created lazily (D-07).
4. **Evaluate every other skill**: a desk review of all 39, Astra's independent opinion, and A/B runs (skill on versus off, both on Sol 6.1) for the promising ones; winners come to the user as accept/reject ideas (D-03, D-04, D-08).

Requirements:

- R1: every skill in the pinned upstream commit gets a verdict with a reason (adopt idea, A/B test, already covered, or skip).
- R2: A/B arms differ only in the skill: same clone, same task, same model (`openai-codex/gpt-6.1-sol`), same Pi environment.
- R3: every A/B and prompt comparison reports outcome quality, check result, runtime, total tokens, cost, turns and tool calls per arm (AGENTS.md Optimization Regression Rule). No single weighted score; a material regression in one dimension is not hidden by a gain in another. "Inconclusive" is a valid verdict.
- R4: the Plan3 prompt changes are measured against a baseline recorded before they land, and reverted or tuned if they cause a material overall regression.
- R5: project care has brakes: it weighs hot code (git churn) and named upcoming changes, applies the deletion test, and adds no seam with only one adapter. Big prefactors with a good-enough one-liner alternative go to the user as a choice (D-01).
- R6: lab runs never write to the real DealFinder or PhotoBook repos; they use throwaway clones outside ce-workflow.

Non-goals:

- Installing Matt's skills as-is (they assume Claude Code's Skill tool and a configured issue tracker); winners are folded or adapted per winner (Q-03).
- Re-evaluating `codebase-design`, `improve-codebase-architecture` and Design It Twice: plan 54ff64f3 already adopted them in `docs/proposals/2026-11-05-rework-recipe.md` §0 and §1.3; this plan reuses that vocabulary for project care.
- GitHub issues as a store for maps or tickets (D-06).
- Writing skills (writing-beats, writing-fragments, writing-shape), course tooling (scaffold-exercises, teach) and software-factory design beyond a desk verdict.

Acceptance examples:

- `docs/proposals/2026-11-08-mattpocock-skills-review.md` lists all 39 skills, each with verdict, reason, and Astra's verdict beside it.
- `docs/proposals/skills-lab/results.md` shows, for each tested skill, a per-arm table (quality score, check pass rate, median runtime, tokens, cost, turns, tool calls) over 3 repeats and a verdict.
- `/plan3 add a new deal source` in a DealFinder clone (where adding a source edits several modules) shows a size dialog, asks grilling rounds, and writes a plan whose approach records a patch-versus-prefactor fit check per touched module.
- `/plan3 rename the CLI help text` shows the size dialog recommending Tiny; picking it removes the draft, leaves research mode, and the agent just makes the change.
- `/plan3 finish` on a plan with glossary terms and an ADR candidate offers a checklist; ticked items land in `GLOSSARY.md` and `docs/adr/0001-<slug>.md`.
### IDEA-384217f4: Two-axis code review skill (adapted from code-review)

> Q-03 form: adapted copy in skills/ with credit and the MIT notice.
### IDEA-da049cbe: Debugging skill (adapted from diagnosing-bugs)

> Q-03 form: adapted copy in skills/ with credit and the MIT notice.
### IDEA-eff9da13: Vertical slices and expand-migrate-contract in planning (from to-tickets)

> Fold into Plan3 prompts (Q-03).




## Decisions

- **D-01 Project care is a planning fit check that judges and adapts, or asks.** For each module the change touches, the planner judges whether the change fits its shape. A small prefactor that clearly wins is planned as its own step first. When a big rework has a real benefit but a one-liner is good enough, the planner presents both as a question with a recommendation. Execution still builds the chosen design at the smallest sufficient depth; a prefactor need found mid-work becomes a question, not a silent scope change. Source: user via ask_user 2026-11-08 ("judge the stuff and adapt or ask when finding a huge change has a benefit but we might do a one liner that is good enough too to present the option").
- **D-02 Reference flow: Matt's "new session" diagram.** Is the diff tiny (quick to review, cheap to retry)? yes: one shot, review after the diff. No: grill-with-docs (align first, firm up domain language). Bigger than you thought (more fog, context going into the dumb zone)? yes: wayfinder map; no: keep grilling. Source: user's two screenshots, 2026-11-08.
- **D-03 A/B means skill on versus off, both arms on Sol 6.1.** Same task, clone and model `openai-codex/gpt-6.1-sol`; only the skill differs. Source: user via ask_user 2026-11-08.
- **D-04 Budget: unlimited for the lab.** "unlimited, lets get it right". Each run's cost is still recorded (R3). Source: user via ask_user 2026-11-08.
- **D-05 /plan3 sizes the request and the user confirms.** The first planning turn judges size and shows one dialog: Tiny (skip the plan, just do it and show the diff), Plan (grill in rounds, then plan) or Map (multi-session decision map), with the recommendation preselected. Source: user via ask_user 2026-11-08.
- **D-06 A map is a Plan3 plan file.** Destination, Notes, Decisions, Not yet specified (fog) and Out of scope sections; decision tickets are [think] steps typed research, prototype, grill or task; when the way is clear the map hands off to normal Plan3 plans. Source: user via ask_user 2026-11-08.
- **D-07 GLOSSARY.md and ADRs, lazily.** Planning reads `GLOSSARY.md` and `docs/adr/` when present, sharpens fuzzy terms, and records settled terms; at finish it offers ADRs for decisions that are hard to reverse, surprising without context and a real trade-off (all three). Files are created only when there is something to write. Source: user via ask_user 2026-11-08.
- **D-08 Astra is authorized as the second opinion.** The user asked to "use astra to give oppinon": steps SK-02, SK-08 and PC-02 launch `plan3-advisor` or a read-only judge on `openai-codex/gpt-6-astra:high`. Source: Original request.
- **D-09 Upstream is pinned.** `mattpocock/skills` at `4ae2317` (2026-10-31), MIT licensed. Later upstream changes are out of scope unless a step re-pins. Source: clone made during planning.
- **D-10 Glossary terms and ADRs are written by code at finish, not by the planner.** Research mode forbids editing documentation outside the plan, so the planner records terms in a plan `## Glossary` section and marks ADR candidates in Decisions; the finish checklist writes the selected ones. Assumption from the research-mode boundary (high confidence), not a user decision.
- **Q-01** How is the Plan3 prompt change compared with the current prompts?
  - Context: lab clones load ce-workflow from the user's live checkout (`~/.pi/agent/settings.json` packages entry `..\..\..\..\SOFT\git\ce-workflow`), so baseline and candidate cannot run side by side without a switch. Model or Pi updates between the two batches can skew results. Affects SK-06 and PC-09.
  - Recommendation: Sequential: record the baseline (SK-06) right before Phase 5 lands, run the candidate right after, and note Pi and model versions for both. No setting nobody asked for.
  - Option: Sequential baseline then candidate — no new code; some drift risk between batches.
  - Option: Lab-only setting toggle — interleaved runs, cleaner comparison; adds a setting and code path to maintain.
  - Option: Load a ce-workflow worktree in the clone — exact versions side by side; needs the global package disabled per clone, untested.
  - Independent: yes
  - Answer: {"kind":"selection","selections":["Sequential baseline then candidate"]}
  - Source: user via ask_user /plan3 resolve; not independently verified.
- **Q-02** Is the skill force-loaded in the B arm, or left for the model to pick up?
  - Context: Pi lists skills by description and the model decides whether to read them (`docs/skills.md`); `/skill:name` forces it. Forced runs measure the skill's content; unforced runs measure real-life triggering too. Affects SK-03 and SK-07.
  - Recommendation: Forced in all 3 B repeats (measures value), plus one extra unforced B run per skill to note whether the description triggers it.
  - Option: Forced plus one unforced check — clear value signal and a trigger note; one extra run per skill.
  - Option: Forced only — cheapest, says nothing about triggering.
  - Option: Unforced only — realistic, but a skill the model never reads looks worthless.
  - Independent: yes
  - Answer: {"kind":"selection","selections":["Forced plus one unforced check"]}
  - Source: user via ask_user /plan3 resolve; not independently verified.
- **Q-03** In what form do winning skills ship?
  - Context: AGENTS.md Code-First Workflow Rule prefers coded automation over prompt-only guidance. Upstream skills say "Call the Skill tool", assume an issue tracker (`setup-matt-pocock-skills`) and chain other skills. ce-workflow already ships skills via `package.json` `pi.skills` (`./skills/frontend-design`). Upstream is MIT, so adapted copies need the copyright notice. Ask with lab results at SK-09.
  - Recommendation: Workflow ideas fold into Plan3 prompts or code; model-invoked reference skills that win (for example diagnosing-bugs) ship as adapted copies in `skills/` with credit and the MIT notice.
  - Option: Fold or adapt per winner — fits the code-first rule and Pi's tools; we maintain the copies.
  - Option: Install upstream with `npx skills@latest add mattpocock/skills -a pi` — self-updating, but Claude-specific wording and tracker setup.
  - Option: Fold into Plan3 only — no shipped skills; reference skills lose their on-demand loading.
  - Independent: yes
  - Answer: {"kind":"selection","selections":["Fold or adapt per winner"]}
  - Source: user via ask_user /plan3 resolve; not independently verified.
- IDEA-384217f4: accepted — Two-axis code review skill (adapted from code-review). Source: user via Plan3 idea review; not independently verified. Response: {"kind":"selection","selections":["Accept (Recommended)"]}
- IDEA-da049cbe: accepted — Debugging skill (adapted from diagnosing-bugs). Source: user via Plan3 idea review; not independently verified. Response: {"kind":"selection","selections":["Accept (Recommended)"]}
- IDEA-eff9da13: accepted — Vertical slices and expand-migrate-contract in planning (from to-tickets). Source: user via Plan3 idea review; not independently verified. Response: {"kind":"selection","selections":["Accept (Recommended)"]}
- IDEA-8407f24d: rejected — Git guardrail as a Pi tool_call guard (from git-guardrails). Source: user via Plan3 idea review; not independently verified. Response: {"kind":"selection","selections":["Reject (Recommended)"]}
- IDEA-87891b19: rejected — Evidence and reversibility for cutovers (from pr). Source: user via Plan3 idea review; not independently verified. Response: {"kind":"selection","selections":["Reject (Recommended)"]}









## Open questions

### Blocking

None.

### Deferred

None.

## Relevant files and approach

Approach: evaluate the skills first, then design the decided Plan3 changes, record the baseline right before building, build, and measure right after. Reuse what exists: the rework lab's clone-and-drive pattern (`scripts/rework-lab.mjs`), Pi's `--no-skills` and `--skill <path>` flags (`docs/cli.md` lines 200-203 of the Pi package), `plan3-advisor` for reviewing this plan and the builtin read-only `reviewer` for skill verdicts and blind judging (both on Astra), `plan3` action `ideas` for accept/reject popups, `showListDialog` and the `requirement` action pattern for code-owned dialogs, and the §0 design vocabulary of the rework recipe for project care.

Upstream and lab locations (outside the repo):

- Upstream clone: `C:\SOFT\git\skills-lab\mattpocock-skills` at `4ae2317` (D-09).
- Lab runs: `C:\SOFT\git\skills-lab\<run>` (clones, Pi session dirs, raw JSON events). Only reports are committed, under `docs/proposals/skills-lab/`.
- Lab sources: DealFinder (`C:\SOFT\git\DealFinder`, pre-rework SHA `27221be`, Python, pytest) first; PhotoBook (`C:\SOFT\git\PhotoBook`, TS, vitest) only when a result is borderline or the task needs TS.

ce-workflow files:

- `docs/proposals/2026-11-08-mattpocock-skills-review.md` (new): verdict per skill (SK-01, SK-02).
- `docs/proposals/skills-lab/design.md`, `tasks/*.md`, `results.md` (new): experiment design, task fixtures, scorecards.
- `scripts/skills-lab.mjs` (new): one-shot A/B runner. Per run: clone (or copy the tree into fresh one-commit history so a planted bug is not visible in `git log`), apply the task setup, run `pi --mode json -p --no-skills [--skill <dir>...] --model openai-codex/gpt-6.1-sol --thinking high --session-dir <run dir>` with the task prompt, run the task's check, and append one result line (arm, repeat, check result, wall time, tokens, cost, turns, tool calls, diff stat) parsed from the JSON events.
- `scripts/rework-lab.mjs`: `--plan-only`, R3 metrics through the shared event parser, a `tiny` outcome when no plan exists, pinned clone settings (SK-05).
- `scripts/lab-metrics.mjs` (new, or a section inside skills-lab.mjs if only one runner needs it): parse Pi JSON or RPC events into wall time, tokens, cost, turns and tool calls (SK-04, SK-05).
- `docs/proposals/2026-11-08-plan3-care-and-questioning.md` (new): exact prompt text and dialog contracts for Phase 5 (PC-01).
- `extensions/plan3.ts`: `workState` (line 166; map ticket order), `afterTagging` (line 1092; the settled handoff Tiny copies), `planningPrompt` (line 540, "smallest reusable approach"), `clarification` (line 44, one question at a time), `executePrompt` (line 550, "smallest sufficient depth"), `newPlanFile` template (line 531), `startPlanning` (line 929), the `plan3` tool actions (line 1565 onward; `requirement` at 1677 is the dialog pattern), finish flow and the Plan ready dialog (line 1243), `finishProblems` (placeholders and sections).
- `extensions/ask-user/menu.ts`: `showListDialog` and `askConfirm` (Dialog UX rule; compact for few-action prompts).
- `scripts/test-work-plan3.mjs`: prompt assertions (line 379 matches "smallest sufficient depth"; line 567 the planning prompt), plus new size, map, glossary and ADR tests.
- `README.md` Plan3 section and `CHANGELOG.md` Unreleased.

Initial desk triage (agent proposal from reading every SKILL.md during planning; SK-01 and SK-02 confirm or change it):

- Decided in this plan: grilling, grill-me, grill-with-docs, domain-modeling (D-05, D-07); wayfinder (D-06); ask-matt's flow (D-02).
- Already adopted elsewhere: codebase-design, improve-codebase-architecture (rework recipe, plan 54ff64f3).
- A/B candidates: diagnosing-bugs (feedback loop first, ranked falsifiable hypotheses, tagged debug logs), tdd (seams agreed first, tautological and implementation-coupled anti-patterns), code-review (Standards and Spec axes plus Fowler smell baseline, versus our `diff-reviewer`), writing-for-agents (leading words, no-op hunting, positive phrasing; test by auditing one Plan3 prompt), retro (environment fixes after a session; test on a recorded lab session).
- Ideas to fold in without A/B: to-tickets' prefactor-first and expand-contract for wide refactors (feeds D-01), to-spec's "agree test seams first", chief-of-staff's "no workarounds" rule and dated wiki claims, prototype's throwaway-answer rule for [think] decision tickets.
- Likely skip (Pi or ce-workflow already covers, or out of scope): handoff, claude-handoff, research, implement, implement-spec, setup-matt-pocock-skills, triage, to-questionnaire, wait-what, pr, wizard, teach, loop-me, software-factory, setup-ts-deep-modules (Backlog for TS projects), git-guardrails-claude-code, setup-pre-commit, migrate-to-shoehorn, scaffold-exercises, writing-beats, writing-fragments, writing-shape.

## Commands

- C-p3: `node scripts/test-work-plan3.mjs`
- C-types: `node scripts/test-work-plan3-types.mjs`
- C-verify: `npm run verify:quiet` (full suite; once before completion)
- C-lab: `node scripts/skills-lab.mjs <run> --task <task file> --arm <none|skill dir> --rep <n>` (created in SK-04; arguments fixed there)
- C-rework: `node scripts/rework-lab.mjs <run> --source <dir> --sha <sha> --request-file <file> --plan-only` (`--plan-only` added in SK-05)
- C-df: `python -m pytest` in a DealFinder clone

## Phases

### Phase 1: Skill review and experiment design [think]

- [x] **SK-01** Desk review of all 39 skills in docs/proposals/2026-11-08-mattpocock-skills-review.md; desk A/B shortlist: diagnosing-bugs, tdd, code-review, retro.
- [x] **SK-02** Astra (reviewer, gpt-6-astra:high) verdicts merged: agrees on 27/39; final A/B shortlist diagnosing-bugs, tdd, code-review, retro, writing-for-agents, prototype; SK-09 desk ideas to-tickets, pr evidence+reversibility, git guard.
- [x] **SK-03** Experiment design in docs/proposals/skills-lab/design.md: 6 task files (DealFinder offline tasks, photobook-01 retro), arms A/B/C, Pi adaptations, R3 incl. subagent sessions, blind Astra judge, 5 planning requests with endpoints; hidden tests for diagnosing-bugs and tdd verified red.

### Phase 2: Lab harness [code]

- [x] **SK-04** scripts/skills-lab.mjs runs each arm in a fresh-history copy (or clone) with its own session dir, up to 5 in parallel, checks with hidden tests copied in only for the check, and records metrics, skillRead and outside-path audit per run; lab.json plus fixtures for all six tasks and the writing-for-agents replay.
- [x] **SK-05** rework-lab.mjs: --plan-only (draft copied to <run>.plan.md), --check, --add (task inputs committed, tagged lab-base), outcome tiny/plan-only/complete/stuck, R3 metrics via shared lab-metrics.mjs on every final line, clone pins ultrafull compaction.

### Phase 3: Skill A/B runs and verdicts [think]

- [x] **SK-07** SK-07 batch complete: 6 skill tasks (off/forced x3 + unforced x1; retro off/forced x3) and 10 writing-for-agents replays, all in runs/sk07/results.jsonl; no runner failures.
- [x] **SK-08** All 6 tested skills judged blind by Astra with per-arm R3 medians in results.md: code-review quality win at 2.9x cost (candidate); diagnosing-bugs better process at 1.6x cost (trade-off); tdd, prototype, retro, writing-for-agents reject.
- [x] **SK-09** 5 proposals reviewed: accepted two-axis review skill, debugging skill (both adapted copies in skills/), vertical-slices planning sentence; rejected git guard and cutover evidence.

### Phase 4: Plan3 care and questioning design [think]

- [x] **PC-01** docs/proposals/2026-11-08-plan3-care-and-questioning.md: final text for grilling rounds, project care (plan and execute), size action and Tiny lifecycle, map template, prompts and linear order, glossary and ADR finish checklist; frozen PC-09 rubric; prompt growth about 850 tokens per new plan.
- [x] **PC-02** Astra review: 13 findings, 12 accepted (4 by removing scope), 1 rejected with reason; proposal updated (ownership via sizing id, no transitions, map order/completion, handoff section, ADR regex, rubric anchors and thresholds).

### Phase 5: Baseline [think]

- [x] **SK-06** Plan3 baseline recorded: 16 runs (P1-P3, F plan-only x3; T e2e x3; P1 e2e x1), R3 medians and ranges in results.md; rubric scored blind at PC-09.

### Phase 6: Build in Plan3 [think]

- [x] **PC-03** clarification now asks in frontier rounds (facts are the agent's job); PROJECT_CARE fit check in planningPrompt; executePrompt asks patch-vs-prefactor on unforeseen friction; C-p3 asserts updated (6eb96eb).
- [x] **PC-04** plan3 size (fresh drafts only): compact dialog with recommendation preselected, night/headless take it, Plan/Map record D-size, Map writes the map template, Tiny deletes draft+sidecars and sends the Tiny prompt at agent_settled with research off (271109e).
- [x] **PC-05** Map plans: template rejected by finishProblems until filled, single [think] phase (no tagging), MAP_PROMPT on continue, MAP_EXECUTE in execute, linear ticket order in workState, wip/complete refusals incl. fog (cdc3be9).
- [x] **PC-06** PROJECT_LANGUAGE in planning and convert prompts; finish shows a Project docs checklist and writes picked terms/ADRs only after Plan ready via extensions/plan3-docs.ts (lazy, merged, numbered, idempotent) (505282c).
- [x] **PC-07** README Plan3 section: size first, map plans, how planning asks/plans (care, slices), project language; CHANGELOG Unreleased: 4 Added bullets (others' Hub line left unstaged).
- [x] **PC-08** C-types and C-verify pass at 80b577a (clean worktree); the shared checkout's only failure is another session's uncommitted video-digest.ts edit.

### Phase 7: Measure and trial [think]

- [ ] **PC-09** Rerun the SK-06 requests right after PC-08 with the new prompts (3 repeats, same endpoints) and compare with the baseline per R3 and the rubric.
  - Tiny request: baseline is plan plus execution, candidate is the Tiny path; both compared on the end result (C-df, diff) and R3 totals.
  - Rubric: right size picked, fit check present and sound, prefactor proposed only where churn or named changes justify it, big options asked not assumed, questions in rounds.
  - Material overall regression: tune and rerun, or revert the change (AGENTS.md Optimization Regression Rule).
  - Check: results.md has baseline versus candidate tables and a keep, tune or revert verdict.
- [human] **PC-10** Live trial: the user runs /plan3 on one real request in a real project and judges sizing, grilling rounds and the fit check.
  - Check: the user's verdict and any follow-ups recorded in Decisions or Backlog.
- [x] **PC-11** skills/two-axis-review (SKILL.md, MIT LICENSE.txt, UPSTREAM.md), registered in pi.skills, verify-package checks, README line (09b7a78).
- [x] **PC-12** skills/diagnosing-bugs shortened adaptation (repro command first, ranked falsifiable hypotheses, one variable at a time, test red before fix, cleanup) with MIT LICENSE.txt and UPSTREAM.md, registered (09b7a78).
- [x] **PC-13** planningPrompt orders steps as thin end-to-end slices, prefactor first, wide refactors as expand/migrate/contract; asserted in C-p3 (8f948a2).

## Global validation

- R1: the review doc covers all 39 skills with both the agent's and Astra's verdicts.
- R2 and R3: every tested skill has a scorecard over 3 repeats per arm with all R3 metrics; arms differ only in the skill.
- R4: baseline and candidate planning runs are compared; no material overall regression remains.
- Acceptance examples above pass (sizing dialog, Tiny path, fit check in a DealFinder clone plan, finish writing GLOSSARY.md and an ADR).
- C-p3, C-types and C-verify pass.
- R6: DealFinder and PhotoBook repos are unchanged by the lab (`git status` and HEAD before and after).
- Nothing pushed.

## Backlog

- setup-ts-deep-modules-style dependency rules (dependency-cruiser) for TS projects such as PhotoBook, as a project-care guard; overlaps the rework plan's Backlog item on dependency rules.
- Parallel implementer worktrees in the style of implement-spec for map handoffs, if maps produce large multi-plan builds.
- Retro after each completed Plan3 plan (environment fixes from its stats file), if SK-08 shows retro helps.

## Resume context

PC-01..08, PC-11..13, SK-* done. PC-09 running: C:\SOFT\git\skills-lab\sk06c.sh started 17:31 (nohup, timeout 8h) on ce-workflow 52dca50, log sk06c.log, runs plan-runs/sk06c-*; a 5-min script timer wakes on "SK06C ALL DONE". Next: R3 medians per request (sum all sessions) vs SK-06 baseline in docs/proposals/skills-lab/results.md; blind judge baseline+candidate mixed per proposal §7 (judge bundles like skills-lab/judge/sk07, Astra reviewer); candidate-only conformance (size picked: P plan, T tiny, F map or recorded reason); verdict keep/tune/revert per Optimization Regression Rule. Then PC-10 is [human]. Never push; stage only own files (CHANGELOG has another session's Hub line; video-digest.ts dirty from another session).

## Amendments

Append material changes and their reasons; preserve the original request and settled decisions.
- 2026-11-08 resolve: Q-01 sequential baseline then candidate (SK-06 before Phase 5, PC-09 after; no toggle). Q-02 forced B arm plus one unforced run per skill: SK-07 now expects 7 runs per skill. Q-03 fold or adapt per winner: SK-09 proposals state their form instead of asking Q-03 again; Non-goals reworded to match.
- 2026-11-08 review (plan3-advisor, openai-codex/gpt-6-astra:high, run fb4ad530), each finding checked against the code:
  - F1 benchmark cannot handle Tiny: accepted. Verified `scripts/rework-lab.mjs:151` throws with no plan. SK-05 adds a `tiny` outcome; SK-03 sets endpoints (tiny request and one prefactor request run end to end); PC-09 compares Tiny against plan plus execution.
  - F2 no planning metrics: accepted. Verified the `done` line (`scripts/rework-lab.mjs:179`) has only status, HEAD and commits, and Plan3 stats follow the executing plan only (`extensions/plan3.ts:1070`). SK-05 adds a shared event parser with a fixture test and pins models and compaction; the end-to-end runs cover the execution prompt change.
  - F3 Tiny lifecycle: accepted. Verified research off mid-run is deferred (`extensions/work-models.ts:1482`) and the tool handler rereads the plan file after every action (`extensions/plan3.ts:1704`). PC-01 specifies an early return and a settled handoff like `afterTagging`; PC-04 tests it.
  - F4 [human] tickets do not enforce map order: accepted. Verified `workState` picks only pending or wip steps (`extensions/plan3.ts:166`). PC-01 defaults to first-open-ticket-only for maps; PC-05 tests day and night.
  - F5 checklist Esc saves, not cancels: accepted. Verified `back` closes with the selected values (`extensions/ask-user/menu.ts:440`). Export runs only after the Plan ready pick, idempotent; PC-06 tests cancel after ticking and a second finish.
  - F6 baseline not right before the build: accepted. SK-06 moved into a new Phase 5 Baseline after PC-02; the rubric is frozen in PC-01; the record includes a diff hash for the dirty checkout. Phases renumbered (Build 6, Measure 7); step IDs unchanged.
  - F7 plan3-advisor contract: accepted. SK-02 and SK-08 use the builtin read-only `reviewer` on Astra; PC-02 has plan3-advisor review this plan with the proposal as its reference.
- 2026-11-08: SK-06 baseline runs started before PC-01 and PC-02 (right after SK-05), in parallel with SK-07, to save wall time. The runs do not see the rubric, which PC-01 froze before any scoring; no Plan3 code changed before them (ce-workflow 9268ac3, recorded in sk06.log). PC-03 waits until SK-06 and SK-07 finish so neither batch sees changed prompts.
- 2026-11-08: SK-07 workspaces moved to their own %TEMP%\skl-* folders after the smoke showed agents listing sibling run folders (commit 9268ac3).
- 2026-11-08 PC-02 Astra review (plan3-advisor, gpt-6-astra:high, 13 findings), dispositions in the proposal:
  1. Plan→Map rewrite erases work: accepted by removal: no later size transitions; map template only on the untouched `sizing` draft (§3b, §8).
  2. Tiny ownership: accepted: in-memory `sizing` id set only by a fresh "Draft plan:" request; resumed, captured, converted and merged drafts refused (§3b, §3c).
  3. Preselect: accepted: `currentValue: <recommended>`.
  4. Linear order: accepted, smaller: map `next` is the first not-done ticket only when pending; `step wip` refuses later tickets; no auto-start of [human] (§4d).
  5. Night state in selector: rejected: with (4) a [human]/blocked first ticket leaves nothing runnable, and the existing night loop stops on that (plan3-night.ts:180); no new night state needed.
  6. Map completion: accepted: "no open ticket" wording; `status complete` refuses open tickets or remaining fog (§4d).
  7. Handoff via plan3 create switches pointer/research: accepted by removal: the map writes a Handoff section with /plan3 requests and the user starts them (§4c).
  8. Prefactor insertion before the current step: accepted by removal: a mid-work prefactor is done first inside the current step and noted in Amendments (§2b); no new add capability.
  9. Project-language entry points: accepted: planningPrompt and convertPrompt only; write and resolve unchanged (§5a).
  10. ADR candidate format: accepted: one D-line regex; non-matching marked lines reported as not exportable; body never truncated (§5a, §5b).
  11. Rubric rewards candidate layout: accepted: cross-arm items by meaning (Q1-Q8), candidate-only conformance reported apart; F may be a normal plan with a recorded reason (§7).
  12. Rubric not scorable: accepted: grade anchors, n/a and unscorable rules, aggregation, numeric material thresholds (15 % tokens/cost/runtime, 25 % turns/tool calls, outside the baseline range) (§7).
  13. GLOSSARY-MAP scope: accepted: dropped (§5b, §8).
- 2026-11-08 SK-06: baseline ran before PC-01/PC-02 (no Plan3 code changed in between, so the prompts measured are the current ones). Rubric scoring moved from SK-06 to PC-09: the baseline is scored blind together with the candidate runs, so the judge cannot tell the arms apart. T-2/T-3 result lines recomputed after the runner crashed on an agent-created `NUL` file (runner fixed: `git add -N -- . ":(exclude)NUL"`).
- 2026-11-08: Added PC-11 after PC-10: Accepted IDEA-384217f4: Two-axis code review skill (adapted from code-review)
- 2026-11-08: Added PC-12 after PC-11: Accepted IDEA-da049cbe: Debugging skill (adapted from diagnosing-bugs)
- 2026-11-08: Added PC-13 after PC-12: Accepted IDEA-eff9da13: Vertical slices and expand-migrate-contract in planning (from to-tickets)





## Ideas

### IDEA-384217f4 Two-axis code review skill (adapted from code-review)

Status: accepted
Response: {"kind":"selection","selections":["Accept (Recommended)"]}

#### What this is

> Lab winner. Review a diff in two separate passes, Standards (repo docs plus a fixed smell list) and Spec (missing, wrong, scope creep), and report them side by side, never merged.

#### What you gain

> Blind judge: skill runs found 8 of 9 planted defects vs 5.5-6 without, caught both standards smells (unused hook, bad name) and kept the axes apart; 0 false findings in both arms.

#### Drawbacks and risks

> Costs 2.9x a plain review (about $0.47 vs $0.16, 2.5x tokens) because each axis runs in a subagent. Both arms missed the unrelated-change seed, so scope creep still needs a human eye.

#### Implementation and affected files

> Adapted copy in skills/two-axis-review/SKILL.md with credit and the MIT notice, model-invoked by description ("review this diff"); no Plan3 hook, so it costs nothing unless used. Rewrite Claude-specific wording for pi-subagents.

#### Cost

> One skill file plus the package.json pi.skills entry and a README line; about an hour. No code.

#### Recommendation

> Accept: a clear quality win and on-demand only, so the cost lands only on reviews you ask for.

#### Sources and agreement

> docs/proposals/skills-lab/results.md (code-review); skills-lab/judge/sk07/code-review/judge.md; mattpocock/skills 4ae2317 engineering/code-review.

#### Proposed requirement

> Q-03 form: adapted copy in skills/ with credit and the MIT notice.

#### Proposed steps

> - Add skills/two-axis-review/SKILL.md adapted from mattpocock code-review (Standards and Spec passes via pi-subagents, side-by-side report), with credit and MIT notice; register in package.json pi.skills; README line.

### IDEA-da049cbe Debugging skill (adapted from diagnosing-bugs)

Status: accepted
Response: {"kind":"selection","selections":["Accept (Recommended)"]}

#### What this is

> Lab trade-off. Reproduce first with one command, change one factor at a time to prove the cause, and run the regression test red before the fix.

#### What you gain

> Forced runs ranked 1-3 of 7 with full rubric marks; off runs slipped (diagnosed before reproducing, edited beyond the fix, test repaired after the fix). The one run that only saw it listed read it on its own and scored 8/8 at off-arm cost.

#### Drawbacks and risks

> Forced use cost 1.6x (tokens +59 %, runtime +72 %) for the same end result: every arm fixed the bug.

#### Implementation and affected files

> Adapted, shortened copy in skills/diagnosing-bugs/SKILL.md (credit and MIT notice), model-invoked by its description only, never forced and never folded into executePrompt, so routine work pays nothing.

#### Cost

> One skill file plus the pi.skills entry; under an hour.

#### Recommendation

> Accept as an on-demand skill: the unforced run showed the model picks it up and uses it cheaply when the task is a bug.

#### Sources and agreement

> docs/proposals/skills-lab/results.md (diagnosing-bugs); skills-lab/judge/sk07/diagnosing-bugs/judge.md.

#### Proposed requirement

> Q-03 form: adapted copy in skills/ with credit and the MIT notice.

#### Proposed steps

> - Add skills/diagnosing-bugs/SKILL.md, a shortened adaptation (repro command first, one-factor experiment, ranked hypotheses, regression test red before the fix, cleanup), credit and MIT notice; register in package.json pi.skills; README line.

### IDEA-eff9da13 Vertical slices and expand-migrate-contract in planning (from to-tickets)

Status: accepted
Response: {"kind":"selection","selections":["Accept (Recommended)"]}

#### What this is

> Desk idea, picked by both the desk review and Astra. Plan phases as thin end-to-end slices, prefactor first, and wide refactors as expand, migrate in batches, contract.

#### What you gain

> Fits project care (PC-03): steps become independently verifiable and a wide refactor never leaves the tree broken between steps.

#### Drawbacks and risks

> Adds about one sentence (~60 tokens) to every planning prompt; not A/B-tested on its own.

#### Implementation and affected files

> Fold one sentence into planningPrompt next to PROJECT_CARE; measured inside the PC-09 rerun together with the other prompt changes.

#### Cost

> One sentence and one test assertion; minutes.

#### Recommendation

> Accept: cheap and measured by PC-09 anyway.

#### Sources and agreement

> docs/proposals/2026-11-08-mattpocock-skills-review.md row 17 and Astra's top 3; mattpocock/skills engineering/to-tickets.

#### Proposed requirement

> Fold into Plan3 prompts (Q-03).

#### Proposed steps

> - Add to planningPrompt: order steps as thin end-to-end slices that each leave the tree working, a planned prefactor first, and wide refactors as expand, migrate in batches, contract; assert it in C-p3.

### IDEA-8407f24d Git guardrail as a Pi tool_call guard (from git-guardrails)

Status: rejected
Response: {"kind":"selection","selections":["Reject (Recommended)"]}

#### What this is

> Desk idea (Astra: skip). Block destructive git commands in bash (push, reset --hard, clean -f, branch -D, checkout -- .) unless the user confirms in a dialog.

#### What you gain

> Turns the "never push" rule into code (Code-First rule); stops accidental data loss from a confused agent.

#### Drawbacks and risks

> Regex on shell text is no security boundary (Astra); can annoy when you asked for a push; a dialog in night mode has no one to answer, so night would just refuse.

#### Implementation and affected files

> Small extension: pi.on("tool_call") for bash, match the commands, askConfirm in day mode, block with a reason otherwise; tests for match and no-match.

#### Cost

> About 60 lines plus a test script; an hour or two.

#### Recommendation

> Reject for now: AGENTS.md rules already hold in practice and the guard adds a prompt to every wanted push; revisit if an accident happens.

#### Sources and agreement

> docs/proposals/2026-11-08-mattpocock-skills-review.md rows 29 and Astra row; extensions/plan3.ts:1906 tool_call pattern.

#### Proposed requirement

> Code-First Workflow Rule.

#### Proposed steps

> - Add extensions/git-guard.ts: tool_call guard for destructive git commands with askConfirm in day mode and a blocking reason otherwise; test script with match/no-match cases.

### IDEA-87891b19 Evidence and reversibility for cutovers (from pr)

Status: rejected
Response: {"kind":"selection","selections":["Reject (Recommended)"]}

#### What this is

> Desk idea from Astra. For substantial changes and cutovers, record before/after evidence, affected consumers, and whether rollback needs state restored.

#### What you gain

> Makes risky switches reviewable and undoable.

#### Drawbacks and risks

> Overlaps the rework recipe's Replay/Switch/Retire (now /plan3 rework, 3124dfc) and the ADR hard-to-reverse test (PC-06); a third place for the same rule.

#### Implementation and affected files

> None new: rely on /plan3 rework for cutovers and ADR candidates for one-way doors.

#### Cost

> None.

#### Recommendation

> Reject: already covered by /plan3 rework and the ADR test.

#### Sources and agreement

> docs/proposals/2026-11-08-mattpocock-skills-review.md engineering/pr rows; extensions/plan3-rework.ts.

#### Proposed requirement

> None.

#### Proposed steps

> - Add to planningPrompt: for a cutover step, record before/after evidence, affected consumers and whether rollback needs state restoration.
