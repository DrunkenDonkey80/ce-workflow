# Matt Pocock skills: review for ce-workflow

Plan 79614d24, steps SK-01 (agent desk review) and SK-02 (Astra's independent verdicts).

Upstream: `github.com/mattpocock/skills` at `4ae2317` (2026-10-31), MIT. Local clone: `C:\SOFT\git\skills-lab\mattpocock-skills`. 39 skills (`skills/**/SKILL.md`).

Verdicts:

- **adopt idea**: fold a named idea into ce-workflow (Plan3 prompt or code, a utility agent, or an adapted skill).
- **A/B test**: measure skill on versus off on Sol 6.1 with a concrete task (SK-03, SK-07).
- **already covered**: ce-workflow already has it; the feature is named.
- **skip**: not useful here; the reason is named.

Common blockers for installing as-is: many skills say "Call the Skill tool with X" (Claude Code's tool; Pi loads skills by reading the file, `/skill:name` forces it), and the engineering flow assumes an issue tracker configured by `setup-matt-pocock-skills`.

Overlap was checked against: README "Plan3" (planning, research mode, Open questions and `/plan3 resolve`, ideas and review advisors, night mode, `[human]` steps, requirements, stats), README "Context compaction" (compaction notes, knowledge tool), intercom handover, utility agents (`plan3-advisor`, `diff-reviewer`, `context-knowledge-discoverer`), builtin pi-subagents agents (`reviewer`, `researcher`, `oracle`, `worker`, `scout`), the shipped `frontend-design` skill, the user's global `ponytail-review`/`ponytail-audit` skills, and the rework recipe (`docs/proposals/2026-11-05-rework-recipe.md` §0, §1.3).

## Agent desk review (SK-01)

| # | Skill | Summary | Overlap in ce-workflow | Verdict | Reason |
|---|---|---|---|---|---|
| 1 | engineering/ask-matt | Router over the suite: main flow grill → (prototype) → spec → tickets → implement/tdd → code-review → retro; on-ramps triage, diagnosing-bugs, wayfinder; phase boundaries (continue, clear, handoff, compact). | Plan3 is the router (plan, resolve, finish, resume3); sizing D-05 adds the tiny/plan/map branch. | already covered | Its routing only makes sense with the whole suite installed; the one branch we lacked (sizing) is D-05. |
| 2 | engineering/code-review | Diff since a fixed point, reviewed on two separate axes in parallel fresh subagents: Standards (repo docs plus a Fowler smell baseline, labelled judgement calls) and Spec (missing, scope creep, wrong); reported side by side, never merged. | `diff-reviewer` reviews a diff against its task (Spec-like); `ponytail-review` covers quality; nothing applies a fixed smell baseline as a separate axis. | A/B test | Observable: findings on a diff with planted standards and spec defects. If it wins, the two-axis split and smell baseline fold into `diff-reviewer`. |
| 3 | engineering/codebase-design | Deep-module vocabulary (module, interface, depth, seam, adapter, leverage, locality), deletion test, design it twice. | Rework recipe §0 and §1.3 (plan 54ff64f3). | already covered | Adopted; this plan reuses §0 for project care (non-goal to re-evaluate). |
| 4 | engineering/diagnosing-bugs | Hard-bug loop: build a tight, red-capable feedback loop first (one command already run), reproduce and minimise, 3-5 falsifiable ranked hypotheses, tagged instrumentation, regression test at a correct seam before the fix, cleanup checklist. | Nothing specific; Plan3 execution says "fix root causes"; AGENTS.md "When stuck" escalates to an oracle. | A/B test | Observable in transcript and diff: repro command before code reading, regression test red then green, no leftover debug logs, root cause named. Planted-bug task. |
| 5 | engineering/domain-modeling | Active domain language: challenge terms against GLOSSARY.md, sharpen fuzzy words, scenarios, cross-check with code; lazy GLOSSARY.md and one-paragraph ADRs only when hard to reverse, surprising and a real trade-off. | Nothing. | adopt idea | Planned as D-07/D-10 (PC-06): planner records terms and ADR candidates; finish writes them. Formats adapted from `GLOSSARY-FORMAT.md` and `ADR-FORMAT.md` with credit. |
| 6 | engineering/grill-with-docs | Wrapper: grilling plus domain-modeling. | Plan3 Open questions; `/plan3 resolve` batches. | adopt idea | Planned (PC-03 grilling rounds, PC-06 glossary). Nothing beyond its two parts. |
| 7 | engineering/implement-spec | Orchestrates tickets as a task graph: implementer subagents per ticket in worktrees, merger subagent, integration branch, final code-review. | Plan3 execution; pi-subagents workflows with worktrees. | skip | Needs an issue tracker and branch-per-ticket merges; the user develops on `master` in one agent (Branch Rule). |
| 8 | engineering/implement | Implement from a spec or tickets: tdd at agreed seams, typecheck often, full suite once, code-review, commit. | `/resume3` execution prompt (smallest checks while working, full suite at phase boundaries, local commits). | already covered | Same loop; tdd and code-review are judged separately (rows 2, 15). |
| 9 | engineering/improve-codebase-architecture | Scan for deepening opportunities, HTML report, grill the picked one. | Rework recipe Map and Design phases. | already covered | Adopted by plan 54ff64f3 (non-goal here). |
| 10 | engineering/pr | PR body template: smallest visual (pseudocode, call tree, diff sketch, Mermaid), before/after evidence, one-way or two-way door, blast radius. | No PR flow; the user never pushes without being told. | skip | No PR workflow. "One-way or two-way door" overlaps the ADR "hard to reverse" test already adopted. |
| 11 | engineering/prototype | Throwaway code answering one question: logic branch (one shareable HTML state-machine page) or UI branch (several variants on one route, switch bar); marked as prototype, no persistence, state surfaced, captured on a throwaway branch. | Design sessions (OpenDesign) cover UI variants; nothing for logic prototypes. | adopt idea | Map plans (D-06) have prototype tickets; PC-01 gives them the logic-versus-UI branch and the "throwaway, marked, verdict recorded in Decisions" rules. |
| 12 | engineering/research | Background agent reads primary sources, writes one cited Markdown file where the repo keeps notes. | Builtin `researcher` agent, research mode with notebook, web tools. | already covered | Same capability; map research tickets (D-06) use the existing researcher. |
| 13 | engineering/retro | Review a session for environment fixes: navigation pointers, automated checks (mechanical rules become checks), coding standards for the reviewer, AGENTS.md bloat, tool economy, no-ops, information access; ranked list. | Plan3 stats record time per tool and speed hints; no retro step. | A/B test | Observable: on a saved session with known friction, which planted problems the report names and whether fixes are concrete. Backlog already gates a Plan3 retro on this result. |
| 14 | engineering/setup-matt-pocock-skills | Configure issue tracker, triage labels and domain doc layout for the suite. | n/a | skip | Only needed for the upstream suite, which we do not install. |
| 15 | engineering/tdd | Red-green reference: test through public interfaces at pre-agreed seams, anti-patterns (implementation-coupled, tautological, horizontal slicing), vertical slices, refactor after. | Execution prompt asks for tests of changed code, not test-first. | A/B test | Observable: test written and run red before the implementation, tests at the public seam, no tautological assertions. Feature task with an existing test suite. |
| 16 | engineering/to-spec | Synthesize the conversation into a spec (problem, solution, long user story list, decisions, testing, out of scope) and publish to the tracker. | Plan3 plan is the spec; `/plan3 write` captures a discussion. | already covered | Same role as `/plan3 write`; tracker publishing is not used. |
| 17 | engineering/to-tickets | Tracer-bullet vertical slices with blocking edges; prefactor first; wide refactors as expand, migrate in batches, contract; quiz the user on granularity. | Plan3 steps and phases; requirements as gates. | adopt idea | Fold "vertical slices, prefactor first, expand-migrate-contract for wide refactors" into the planning prompt with D-01 (PC-01 decides wording). |
| 18 | engineering/triage | Issue/PR state machine (needs-triage, needs-info, ready-for-agent/human, wontfix), redundancy and prior-rejection checks, agent briefs, `.out-of-scope/` knowledge base. | None; no incoming issue flow. | skip | The user's projects have no external issue intake. The `.out-of-scope/` idea overlaps Plan3 Non-goals and Backlog. |
| 19 | engineering/wayfinder | Multi-session decision map on the tracker: destination, notes, decisions so far, fog (not yet specified), out of scope; typed decision tickets (research AFK, prototype and grilling HITL, task either), one ticket per session, fog graduates into tickets. | Plan3 plans, `[human]` steps, Open questions. | adopt idea | Planned as D-06 (PC-05) with a map template in Plan3; no tracker. |
| 20 | engineering/wizard | Generate a bash wizard from a template to walk a human through manual setup (open URL, capture value, write .env / gh secret, confirm). | `[human]` steps plus ask_user. | skip | Niche for this user (Windows, few credential flows); ask_user covers one-off steps. Backlog candidate if a project needs repeatable setup. |
| 21 | in-progress/chief-of-staff | Long-running goal in one session through background subagents; dated wiki memory (history, not present); two tracks: tactical task and strategic environment improvement; "no workarounds". | Night mode, Plan3 sidecar logs, knowledge tool, hub timers. | already covered | Orchestration and memory exist. The strategic track ("improve the environment for the next task") feeds the project-care fit check (D-01). |
| 22 | in-progress/claude-handoff | Handoff summary launched as a background `claude --bg` agent. | intercom `handover` action. | already covered | Same; Claude-specific command. |
| 23 | in-progress/loop-me | Grill the user into workflow specs for recurring life loops. | n/a | skip | Personal-workflow design, outside ce-workflow's coding scope. |
| 24 | in-progress/setup-ts-deep-modules | Install dependency-cruiser rules so each TS package is reachable only through its root entry files; prove the rules bite. | None. | skip | Project-specific tooling; ce-workflow's extensions are flat modules, not packages. A rework target project could use it (rework recipe Backlog). |
| 25 | in-progress/software-factory | Vocabulary for designing a software factory (tasks, runners, trackers, observability). | n/a | skip | Non-goal (software-factory design). |
| 26 | in-progress/writing-beats | Writing: assemble raw material into beats. | n/a | skip | Non-goal (writing skills). |
| 27 | in-progress/writing-fragments | Writing: mine raw fragments. | n/a | skip | Non-goal (writing skills). |
| 28 | in-progress/writing-shape | Writing: shape material into an article. | n/a | skip | Non-goal (writing skills). |
| 29 | misc/git-guardrails-claude-code | Claude Code PreToolUse hook script blocking push, reset --hard, clean, branch -D and similar. | AGENTS.md rule "never git push"; no code guard in ce-workflow (`grep` of `extensions/` finds none). | adopt idea | Code-First rule: a Pi `tool_call` guard for destructive git commands, with an explicit user allowance for requested pushes. Desk idea for SK-09, not A/B. |
| 30 | misc/migrate-to-shoehorn | Replace `as` in TS tests with @total-typescript/shoehorn. | n/a | skip | Library-specific migration. |
| 31 | misc/scaffold-exercises | Course exercise directory scaffolding. | n/a | skip | Non-goal (course tooling). |
| 32 | misc/setup-pre-commit | Husky + lint-staged + typecheck + tests. | Repo checks (`npm run verify:quiet`). | skip | Project-specific setup; no gain over doing it by request. |
| 33 | productivity/grill-me | Wrapper: grilling. | Open questions. | adopt idea | Same as row 34. |
| 34 | productivity/grilling | Design tree worked in rounds: ask the whole frontier (questions whose prerequisites are settled), numbered, each with a recommendation worded so yes accepts it; facts are the agent's job; done when the frontier is empty. | Plan3 Open questions with `Independent: yes` batches; `/plan3 resolve`. | adopt idea | Planned (PC-03): frontier rounds as ask_user batches of 2-4; measured by SK-06 versus PC-09. |
| 35 | productivity/handoff | Handoff doc in the temp dir, pointers instead of copies, suggested skills, redaction. | intercom `handover`, compaction notes, `/plan3 write`. | already covered | Same function. |
| 36 | productivity/teach | Multi-session teaching workspace (mission, lessons, learning records). | n/a | skip | Non-goal (course/teaching tooling). |
| 37 | productivity/to-questionnaire | Turn an unanswerable decision into an async questionnaire for another person. | Plan3 Open questions already carry context, recommendation and options. | already covered | Self-contained questions exist; exporting them for a third person is a Backlog idea at most. |
| 38 | productivity/wait-what | User command: re-pitch the last message in Simplified Technical English using GLOSSARY terms. | User's plain-words writing rules. | skip | One-line user prompt; no code or prompt change gains from it. |
| 39 | productivity/writing-for-agents | Writing documents for agents: context pointers, context and cognitive load, information hierarchy and disclosure, completion criteria, leading words, positive phrasing over negation, pruning no-ops and duplication. | AGENTS.md rules; prompt work in Plan3. | adopt idea | PC-01 applies its levers (leading words, positive phrasing, sharp completion criteria) to the Plan3 prompt changes. Also a reference for future prompt edits. |

Counts: adopt idea 9, A/B test 4, already covered 10, skip 16. Total 39.

Desk shortlist for A/B (SK-03 designs one task each): diagnosing-bugs, tdd, code-review, retro.

## Astra's verdicts (SK-02)

Pending.

## Final shortlist

Pending (SK-02 merge).
