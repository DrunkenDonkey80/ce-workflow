---
plan3: true
status: ready
created: 2026-11-08
updated: 2026-11-08T13:21:17.083Z
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

- [ ] **SK-07** Run every shortlisted skill task: 2 arms by 3 repeats on Sol 6.1 (C-lab), B arm forced, plus one unforced B run per skill (Q-02).
  - Check: results file has 7 runs per skill (3 off, 3 forced, 1 unforced, with whether the skill was read); failed runs are rerun or reported, never dropped.
- [ ] **SK-08** Judge blind with Astra and fill the scorecard: per skill, per-arm medians for every R3 metric and a verdict (adopt, reject, inconclusive).
  - Judge: read-only `reviewer` on gpt-6-astra:high gets both diffs and transcripts with arm labels shuffled, plus the rubric; the agent checks each judgment against the evidence.
  - Check: results.md has a scorecard and verdict per tested skill; no verdict rests on a single weighted score.
- [ ] **SK-09** Bring adoption proposals to the user with plan3 action ideas: one per winning skill and per desk idea worth doing.
  - Each proposal names its form per Q-03: folded into Plan3 prompts or code, or an adapted copy in `skills/` with credit and the MIT notice. Accepted ideas add steps (Backlog or a new phase) through the ideas flow.
  - Check: every proposal is accepted or rejected in the plan's Ideas section.

### Phase 4: Plan3 care and questioning design [think]

- [ ] **PC-01** Write docs/proposals/2026-11-08-plan3-care-and-questioning.md with the exact prompt text and dialog contracts for D-01, D-05, D-06, D-07 and grilling rounds.
  - Project care (D-01, R5): fit check per touched module: fits as is; small prefactor planned first; or big prefactor versus one-liner asked as a question. Brakes: churn weight, named upcoming changes, deletion test, no single-adapter seam. Vocabulary from rework recipe §0.
  - Grilling rounds: ask the whole frontier (questions whose prerequisites are settled) as ask_user batches of 2-4, each with a recommendation worded so yes accepts it; facts are the agent's job; repeat until the frontier is empty or the rest needs step evidence; then write.
  - Sizing (D-05): `plan3` action `size` (mode tiny, plan or map; reason); compact dialog, recommendation preselected; night mode and headless take the recommendation; Plan may switch to Map later when fog grows.
  - Tiny lifecycle: `size` returns early without rereading the deleted draft, clears the planning pointer and sets a pending flag; at `agent_settled` code leaves research (forced) and sends the implementation prompt with the original request, like `afterTagging` (`extensions/plan3.ts:1092`). A mid-run research off is only deferred (`extensions/work-models.ts:1482`), hence the settled handoff.
  - Map (D-06): template sections, ticket types (research AFK, prototype and grill as [human], task either), handoff to normal plans when tickets and fog are empty.
  - Map order: `workState` skips [human] steps and picks later pending ones (`extensions/plan3.ts:166`), so linear order needs enforcement. Default design: in a map plan, only the first open ticket (including [human]) is runnable; PC-01 confirms or picks requirements instead.
  - Glossary and ADR (D-07, D-10): plan `## Glossary` section, "(ADR candidate)" marker, one-paragraph ADR format, numbering from the highest existing file.
  - Finish export: checklist Esc saves selections (`extensions/ask-user/menu.ts:440`), so ticks stay provisional; files are written only after the Plan ready pick succeeds (the last cancellable dialog, `extensions/plan3.ts:1243`). Idempotent: skip terms already in GLOSSARY.md and ADRs whose source line names the same plan and decision ID.
  - Freeze the PC-09 rubric here, before the baseline runs.
  - Apply writing-for-agents levers (leading words, positive phrasing, sharp completion criteria) and state the prompt size change in tokens.
  - Check: the doc gives final text for every prompt change and every dialog's items, purpose line and outcomes.
- [ ] **PC-02** Astra review: plan3-advisor reviews this plan with the PC-01 proposal as its named reference (review job, D-08); validate findings, record dispositions in Amendments.
  - Check: Amendments lists every finding as accepted or rejected with reason; the proposal reflects the accepted ones.

### Phase 5: Baseline [think]

- [ ] **SK-06** Record the baseline right before Phase 6 lands: each SK-03 request, 3 repeats, current prompts (C-rework), at the SK-03 endpoints.
  - Record Pi version, model ids, ce-workflow HEAD plus a hash of `git diff` (the checkout may be dirty), and the clone settings (Q-01). No Plan3 code changes between this step and PC-03.
  - Check: baseline table in docs/proposals/skills-lab/results.md with R3 metrics and the frozen PC-01 rubric scores per request.

### Phase 6: Build in Plan3 [think]

- [ ] **PC-03** Project care and grilling rounds: update `clarification`, `planningPrompt` and `executePrompt` in extensions/plan3.ts per PC-01; update C-p3 assertions.
  - Execution keeps "smallest sufficient depth" for the chosen design and gains the mid-work prefactor question rule (D-01).
  - Check: C-p3 passes with assertions for the fit check, grilling rounds and the prefactor question rule.
- [ ] **PC-04** Sizing: add `plan3` action `size` with a compact showListDialog (Tiny, Plan, Map); record the pick in Decisions; Tiny removes the draft and leaves research.
  - Night mode and headless take the recommendation without a dialog. Map hands over to PC-05's template.
  - Tiny per the PC-01 lifecycle: early tool return, pointer cleared, research actually off at `agent_settled`, then the implementation prompt.
  - Check: C-p3 covers each mode, the recommended preselect, the night-mode path, Tiny's successful tool return, research off after settle, the implementation prompt sent, cancel leaving the draft, and only the new draft deleted (other plans intact).
- [ ] **PC-05** Map plans: template writer, map planning prompt and linear ticket order per PC-01; map plans pass `finishProblems` and need no tagging turn.
  - Check: C-p3 creates a map plan, asserts its sections and typed [think] tickets, `finishProblems` empty after filling, `needsThinkTags` false, and that an open [human] ticket keeps the next ticket and the handoff unrunnable, in day and night mode.
- [ ] **PC-06** Glossary and ADR: prompts read GLOSSARY.md and docs/adr when present; finish shows a checklist and writes selected terms and ADRs.
  - Lazy creation, merge by term, next ADR number from existing files, ADR names the source plan and decision ID; written only after the Plan ready pick; idempotent (PC-01).
  - Check: C-p3 runs finish on a fixture plan in a temp dir and asserts GLOSSARY.md and `docs/adr/0001-*.md` contents; no files when nothing is selected or when Plan ready is cancelled after ticking; a second finish adds no duplicate.
- [ ] **PC-07** Document sizing, map plans, project care, grilling rounds and glossary/ADR in README's Plan3 section; add CHANGELOG Unreleased bullets.
  - Check: manual read; README states limits (map order is linear, Tiny skips planning entirely).
- [ ] **PC-08** Run C-types and C-verify once.
  - Check: both pass.

### Phase 7: Measure and trial [think]

- [ ] **PC-09** Rerun the SK-06 requests right after PC-08 with the new prompts (3 repeats, same endpoints) and compare with the baseline per R3 and the rubric.
  - Tiny request: baseline is plan plus execution, candidate is the Tiny path; both compared on the end result (C-df, diff) and R3 totals.
  - Rubric: right size picked, fit check present and sound, prefactor proposed only where churn or named changes justify it, big options asked not assumed, questions in rounds.
  - Material overall regression: tune and rerun, or revert the change (AGENTS.md Optimization Regression Rule).
  - Check: results.md has baseline versus candidate tables and a keep, tune or revert verdict.
- [human] **PC-10** Live trial: the user runs /plan3 on one real request in a real project and judges sizing, grilling rounds and the fit check.
  - Check: the user's verdict and any follow-ups recorded in Decisions or Backlog.

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

Executing. SK-01..SK-03 done. Next SK-04: scripts/skills-lab.mjs (C-lab) per docs/proposals/skills-lab/design.md: fresh-history copy of DealFinder 27221be (export C:\SOFT\git\skills-lab\df-base), task setup patch, pi -p --mode json run per arm (A off, B forced /skill:, C unforced; deps via --skill), hidden test check, one result line per run with R3 metrics (all sessions incl. subagents). SK-04 still has to build: code-review seeded patch + standards/spec files, laptopbg_list.html fixture + replay hidden test, prototype hidden scenario test.

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
