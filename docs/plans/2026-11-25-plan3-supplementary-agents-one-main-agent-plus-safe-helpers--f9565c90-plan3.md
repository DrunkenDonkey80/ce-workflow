---
plan3: true
status: ready
created: 2026-11-25
updated: 2026-11-25T11:56:59.945Z
size: plan
reviewed: 2026-11-25
tagsChecked: a8b7e57e
started: 2026-11-25T11:09:04.023Z
---

# Plan3 supplementary agents: one main agent plus safe helpers for parallel work

## Original request

> look at WorkOrchestrator/1 (intercom 01a20c53) and the work it is doing so far and in future plans, dont use intercom just analyze logs. the vast majority of the time went into thinking. Im pretty sure there are things that could have been parallel like research tasks, different modules, etc. can you research it and tell me if there is a good and safe way we may modify our panning/map system so it uses one main agent, true, but also a supplementary agents for other tasks

Follow-up from the user (round 1): "I want this thing to be general, not only for this project which will be completed anyway. the priority is safe, so we don't make it worse. as a human when writing a plan I can fan out some tasks to someone like research what can be done or what is the best way, try this stuff while Im working on that, or don't step in my way while making something. never overlapping same functionality so we should not do that if it risks mess, but even same files but a completely different areas are fine. worktrees are the way to go?"

## Findings (log analysis, 2026-11-25)

Sources: session `C:/Users/Flex/.pi/agent/sessions/--C--SOFT-git-WorkOrchestrator--/2026-11-24T06-51-54-501Z_01a20c53-4905-7127-8bdc-a127797a3d0d.jsonl` (plans 5 and 6) and `C:/SOFT/git/WorkOrchestrator/docs/plans/logs/*.stats.json`. Analysis scripts are in the research temp folder, not the repo.

- Session wall time 25.1 h: model replies 6.8 h (2.59 M output tokens, 0.97 M of them reasoning), bash 3.5 h (mostly cargo tests), 73 compactions at about 77 s each = 97 min blocking, about 3 h idle (one 101 min idle stall the user had to notice, one 375 min PC crash).
- Plan 6 (b400c470) stats: 8.8 h active; model thinking 2.5 h plus acting 1.8 h; tools 3.8 h, of which tests 2.7 h. Steps W-01..W-15 took 7.9 h; tests were 34 % of step time. Earlier plans look the same (plan 5: 4.8 h, thinking 1.5 h, tests 1.2 h).
- Model time by reply kind (plan 6 execution, 4.3 h): reading and exploring 50 %, writing code 26 %, test runs 6 %, plan bookkeeping 6 %. Only 35 min of the exploring read the Pi reference source; 106 min read the core's own code (integration points, failures, re-reads after compaction).
- Planning plan 6 cost only 11 min of model time, so parallel research in planning helps little for this project; it helps maps and research-heavy plans.
- Work is serial by construction: `extensions/plan3.ts:56` ("Work in the current agent with the current model") and the execute prompt (`plan3.ts:607`, "continue ... in this same agent", "Keep one [wip] step"). Only `/plan3 ideas|review` launch subagents (read-only advisors); `MAP_EXECUTE` (`plan3.ts:67`) allows subagents for research tickets.
- Plan 6 after W-01 is about six independent chains (web, context7 plus jev plus images, browser, devices, design, video plus camera). Every step also touched the hub files `session.rs`, `tools.rs`, `main.rs`, `ws.rs` (13 to 14 of 15 commits), the UI tests kill every `wo-keeper.exe` (global state), and one cargo target dir serializes builds. So writers need separate checkouts and full gates must stay serial.
- Rough upper bound for plan 6 with the main agent plus 2 helpers: about 470 min of steps would become roughly 160 to 200 min of parallel work plus serial gates and landing, about 40 % less wall time. Not measured; the pilot (S-07) measures it.
- Prior art: ce-workflow deleted its lead, worker, slice-planner and successor-prefetch agents on 2026-09-21 (commit e5b7b89e, slimdown plan in that commit): planner-to-builder relays matched correctness but cost more time and money on small tasks, and a 2026-09-19 A/B pilot died on setup fragility. Lessons kept here: no prefetch or extra planning stage, no mandatory extra pass, helpers only where the plan marks independent work, the main agent keeps every decision.
- pi-subagents 0.90.0 already gives async runs that wake the parent, model per child and usage in `subagent-artifacts/<run>_meta.json` (usage, cost, durationMs, parentSessionId). Its `worktree: true` refuses any dirty checkout, untracked files included (`src/runs/shared/worktree.js:215-231`), which a plan run always is mid-step.

Answer to "worktrees are the way to go?": yes, for anything that writes. A worktree gives a helper its own files, build output and git index, so it cannot touch the user's or the main agent's work; edits to different areas of one file merge cleanly, and a real overlap shows up as a cherry-pick conflict instead of silent mess. Read-only scouts need no worktree.

## Goal, requirements, and non-goals

Goal: in any project, a Plan3 run keeps one main agent that owns the plan, decisions, integration and full checks, and hands independent work to at most N helpers running at the same time, so plans finish sooner without new risk.

Requirements:

- Three helper kinds, matching how a person fans out work (D-01, user round 1):
  - **Scout**: read-only research ("what can be done, what is the best way"), in planning, map research tickets and execution. Returns a report; no worktree.
  - **Trial**: a throwaway experiment in its own worktree ("try this while I work on that"); never landed; returns findings and its diff path.
  - **Lane**: implements one plan step marked independent in its own worktree ("don't step in my way"); the main agent lands it on master.
- Never two in-flight writers on the same functionality: the plan marks which steps are independent (`after:` lines, D-05); same file, different area is fine, and a cherry-pick conflict counts as overlap (D-08).
- Safe first (user round 1): with helpers off, or on any helper failure, the run behaves exactly as today (the main agent does the step itself). No helper writes the plan file, the user's checkout or master directly; nothing lands without the main agent's checks.
- Helpers on by default, at most 2 at once, `0` turns them off (D-03).
- Helper time and cost appear in the plan's stats so the pilot can be judged (D-02, D-04).

Non-goals:

- No successor prefetch, slice planner or mandatory review pass (deleted on 2026-09-21 for cost).
- No helper that asks the user, edits the plan, pushes, or runs the project's full gate; those stay with the main agent.
- No parallel full gates: gates on the shared checkout stay serial.
- No port to WorkOrchestrator's `crates/core/src/plan3.rs` in this plan (Backlog).
- No build-cache tooling (sccache, shared target dirs) beyond keeping slot worktrees warm (D-07).

## Decisions

- **D-01 Helper shapes: lanes plus scouts, and trials.** Lanes for independent plan steps and read-only scouts in planning and execution; trials cover "try this while I work on that". General for every project, not tuned to WorkOrchestrator. Planning-scouts-only lost: little gain on execution-heavy plans. No-build tuning lost: the user wants parallel helpers. Source: user, ask_user round 1.
- **D-02 Cost ceiling: up to +30 % cost for at least a 30 % wall-time cut.** Lanes stay on by default only if the pilot (S-07) meets it with no lost work and no new regressions; otherwise the default becomes 0. Source: user, round 1.
- **D-03 On by default, at most 2 helpers.** Setting `workOrchestrator.plan3.helpers` (project, then global), default 2, 0 = today's behaviour. Off by default lost: the user wants it used. Source: user, round 2.
- **D-04 Writers use the coding model; scouts may be cheaper.** Lanes and trials run on `codingModel` and `codingEffort`; scouts use a new `scoutModel` setting, unset = the coding model. Source: user, round 2.
- **D-05 Independence is written in the plan as `after:` lines.** A step sub-line `  - after: W-01, W-03` says the step needs only those steps. `after:` only decides lane eligibility: a step may go to a lane when every listed step is done. The main agent's own selection stays exactly as today (first ready pending step, requirement-off steps skipped, `scripts/test-work-plan3.mjs:548`), except that it also waits on unmet `after:` ids, which then appear in `waiting` so completion cannot archive a pending dependent (`plan3.ts:1867-1868`). It lives beside the existing `needs:` parsing in `workState` (`plan3.ts:200`), the one work selector. (Revised after review: the first version made every step wait for its predecessor, which changed existing plans.) A phase-level `[parallel]` tag lost: it cannot express chains such as browser W-07 to W-09 running beside design W-13 to W-15. Source: fit check, 2026-11-25.
- **D-06 Throwaway helper branches are allowed.** Each lane or trial works on `plan3/<plan id>/<step or trial>` inside its worktree; the main checkout never switches branch; the main agent cherry-picks onto master and the branch is deleted. Source: user, round 2 (exception to "always develop on master" for helper worktrees only).
- **D-07 Plan3 owns its slot worktrees instead of pi-subagents `worktree: true`.** A new module creates up to N slot worktrees per repository outside it (`~/.pi/agent/worktrees/<repo>-<hash>/slot-<n>`), resets a free slot to the base commit per lane (tracked and untracked files reset, ignored build output kept, so later builds stay incremental) and passes the slot as the helper's `cwd`. Slots are shared by every plan of the repository, so allocation, reuse, admission and removal run under one repository lock (`withPlanLock` on the repository's `slots.json`, which locks across processes, `plan3-files.ts:8-20`) and every slot records its owner (plan, step or trial, kind, run id). pi-subagents' own worktrees lost: they refuse the dirty checkout a plan run always has mid-step and start every lane on a cold build. Source: fit check of `worktree.js:215-231`, 2026-11-25. (ADR candidate)
- **D-08 Landing is the main agent's job, through code, and the combined result is checked before master moves.** `plan3 lane land` pins the reviewed lane commit range, cherry-picks it onto the main checkout's current HEAD inside the slot (`git rebase --onto`), and refuses commits that touch `docs/plans/`. On a conflict at any commit it aborts the whole sequence and reports the files (D-14). On a clean pick the main agent runs the step's targeted checks in the slot; then `land` fast-forwards master in the main checkout (`git merge --ff-only`) only if HEAD still equals the pinned base, otherwise it repeats the pick; git refuses the fast-forward rather than overwrite the user's dirty files. A failing check leaves master untouched; the main agent then redoes the step serially (D-14) or fixes it in the slot. Full gates follow the project's rules, serially, once per landed batch when the project allows. Cherry-picking straight onto master lost: a clean pick that then fails its check would already be on master. Source: safety requirement, user round 1; review 2026-11-25.
- **D-09 Pilot on a real plan against stats baselines.** The next real plan (any project) with 3 or more independent steps runs with helpers 2; its stats are compared with similar past plans' stats. A controlled A/B lost: double cost and the 2026-09 setup failure. Source: user, round 2.
- **D-10 Fit: no prefactor needed.** `workState` already owns step selection (add `after:` there); prompts live in `plan3.ts`; git and slot mechanics go into one new deep module `extensions/plan3-lanes.ts` behind a small interface (start, land, drop, list), so `plan3.ts` only wires the tool action; helper usage joins `plan3-stats.ts`. Source: fit check, 2026-11-25.
- **D-11 (assumed) Helpers never talk to the user.** Their agent files exclude `ask_user`, `plan3`, `subagent` and `intercom` (scouts get only read, grep, find and ls, no bash); a helper that needs a decision stops and reports it, and the main agent asks. Source: pi-subagents children have no UI; global AGENTS.md "children escalate to the parent".
- **D-12 (assumed) Lanes run only `[code]` steps** that have an `after:` line, no `needs:` requirement, are not `[human]`, and are not live checks on shared hardware, devices, VMs, browsers or accounts. Scouts and trials may serve `[think]` work. Source: safety requirement and night-mode rules.
- **D-17 Writers are confined by code, and the main checkout is watched.** A `cwd` is not a write boundary. In a child (`PI_SUBAGENT_CHILD=1`) whose cwd is a registered slot, ce-workflow installs a `tool_call` guard like the design-session one (`extensions/design.ts:643-647`): write and edit only inside the slot; bash refused when it names the main checkout's path or changes any ref but the lane's own branch (push, update-ref, branch -f, checkout or reset of other branches); night mode's blocked commands always refused. If the guard cannot be shown active in the child, no writer launches and the step runs serially. The main agent also records its checkout's HEAD, master ref and tracked status before each lane start and checks them at land; an unexpected change stops all helpers and the run continues serially, reporting it. Residual risk: a deliberately disguised bash command can still escape; the lane runs the same model and rules as the main agent, which already has unconstrained bash on the real checkout. Source: review 2026-11-25, finding 1.
- **D-18 Lane ownership lives in the sidecar, not in step markers.** A step handed to a lane keeps its `[ ]` marker; `lanes.json` records the owner. `workState` leaves lane-owned steps out of the main agent's `next` and `wip`, so the one-wip lint (`plan3.ts:152`), the resume focus (`:481`), stats step attribution (`:1248-1250`) and `next` (`:1905-1912`) keep working; the step is marked done by the main agent after landing. Source: review 2026-11-25, finding 5.
- **D-19 A slot is reused only after its helper is known to have stopped.** `lane start` reserves the slot; the launch records the pi-subagents run id in it. Reset, removal or reuse require that run to be finished or stopped (pi-subagents status); a timeout or unknown run leaves the slot unavailable and the step runs serially. On resume, recorded run ids are reconciled first. This also tells the night stop check a live helper from a dead one. Source: review 2026-11-25, finding 3.
- **D-20 One admission count for every helper kind.** Scouts, trials and lanes together never exceed the Helpers setting (0 to 2), counted in the repository's `slots.json` with their run ids; scouts take no slot folder. Source: review 2026-11-25, finding 8 (D-03 says at most 2).
- **D-size** Size: plan. Way is known (pi-subagents exists, change lands in plan3 prompts, plan format and stats); a few design choices to grill plus one measured pilot phase. Source: user pick, 2026-11-25.
- **D-13 Helpers run in night mode with the same limits (Q-01).** At most the Helpers setting, night mode's blocked commands apply to helpers too, enforced in the child by D-17's guard (the parent's night hook does not reach children, `plan3-night.ts:145-149`); S-05 makes lane start, land and drop count as progress so waiting on lanes is not a stall. Day only lost: slower unattended runs for no safety gain once lanes cannot land without the main agent. Source: user via ask_user /plan3 resolve.
- **D-14 A lane that cannot land cleanly is redone serially (Q-02).** After `land` aborts (D-08), the main agent drops the lane and implements the step itself on current master, using the lane's diff only as a reference. Resolving conflicts in code it did not write and relaunching the lane lost: wrong merges or repeated conflicts. Source: user via ask_user /plan3 resolve.
- **D-15 Slot worktrees are removed when their plan is set complete (Q-03).** Bounded disk; the next plan pays one cold build per slot. Removal refuses a slot holding an unlanded lane and leaves saved trial patches (kept outside the slot folders). Keeping slots warm across plans lost: disk grows (WorkOrchestrator's target is 34 GB). Source: user via ask_user /plan3 resolve.
- **D-16 The WorkOrchestrator core gets the helpers only after the pilot passes (Q-04).** S-07, on a passing verdict, writes one self-contained request for WorkOrchestrator's next plan (changed prompts, the `after:` rule, landing and fallback rules); porting is not part of this plan. Never porting lost: the core replaces Pi at its plan 9. Source: user via ask_user /plan3 resolve.

## Open questions

### Blocking

None.

### Deferred

None.

## Glossary

- **Helper**: a subagent the main Plan3 agent runs beside itself: a scout, a trial or a lane. At most `workOrchestrator.plan3.helpers` run at once. _Avoid_: worker (alone), verifier
- **Scout**: a read-only helper that researches one question and returns a report. _Avoid_: prefetch, researcher
- **Trial**: a helper that tries something in its own worktree and reports; its work is never landed. _Avoid_: spike, prototype (that is a map ticket kind; a trial may build one)
- **Lane**: a helper that implements one independent plan step in a slot worktree; its commits are landed by the main agent. _Avoid_: parallel step, worker
- **Land**: the main agent cherry-picking a finished lane's commits onto master through `plan3 lane land`. _Avoid_: merge (it never merges)
- **Slot**: one reusable worktree outside the repository that lanes and trials take turns in, keeping ignored build output. _Avoid_: sandbox

## Relevant files and approach

Fit check per module (D-10):

- `extensions/plan3.ts` — **fits**. `workState` (`:200`) gains `after:` next to `needs:`, returns the lane-eligible steps beside today's `next`, and leaves lane-owned steps out of `next` and `wip` (D-18); `finishProblems` (`:642`) rejects unknown or cyclic `after:` ids; `resumePacket` (`:473`) lists runnable steps and in-flight lanes; `boundary` (`:56`), `planningPrompt` (`:595`), `executePrompt` (`:605`) and `MAP_EXECUTE` (`:67`) get the helper rules only when helpers > 0; the plan3 tool gets a `lane` action wired to the new module.
- `extensions/plan3-lanes.ts` (new, deep) — slot allocation outside the repo with owners and run ids in the repository's `slots.json` under the repository lock (D-07, D-19, D-20), reset to a base commit, throwaway branch, `land` (pin range, pick in the slot, check, fast-forward master; D-08), `drop`, `list`; per-plan lane state in `docs/plans/logs/<id>.lanes.json` under the plan lock. Guard: every destructive git command runs only in a path under the slot root that `git worktree list` shows for this repository. Also the child-side write guard of D-17 (a `tool_call` hook active only in a child whose cwd is a registered slot).
- `extensions/plan3-stats.ts` — **fits**. Joins helper usage, cost, model and duration by the run id recorded at launch (D-19) with the plan and step stored there; usage from `<session dir>/subagent-artifacts/<run>_meta.json`, duration from its `durationMs` or pi-subagents' run result when the meta lacks it (installed 0.90.0 writes it for some agents only; the repo's dev copy is 0.87.0); a missing metric shows as unknown, never 0; the viewer shows helper time and cost beside the main agent's.
- `extensions/plan3-night.ts` — **fits**. Lane progress counts in the stall fingerprint; the stop check does not push the main agent while only lane-owned steps remain (D-13).
- `extensions/work-models.ts` — **fits**. Settings rows "Helpers" (0 to 2, default 2; D-03, D-20) and "Scout model" beside Planning and Coding model (`:4501`).
- `utility-agents/plan3-lane.md`, `utility-agents/plan3-scout.md` (new) — same pattern as `plan3-advisor.md`. The lane agent (lanes and trials) has read, bash, edit and write only; the scout is read-only. Both state D-11's escalation rule.
- `scripts/verify-package.mjs:40` — the exact utility-agent list gains the two files.
- `README.md` (Plan3 section, Statistics at `:131`, Plan models at `:159`), `CHANGELOG.md` Unreleased.
- Tests: new `scripts/test-work-plan3-lanes.mjs` (picked up by `verify-package.mjs:120`), plus `scripts/test-work-plan3.mjs`, `test-work-plan3-stats.mjs`, `test-work-plan3-night.mjs`, `test-work-settings.mjs`.

How a run works with helpers on (S-05 writes it into the execute prompt):

1. The main agent takes its own next step as today. For lane-eligible steps (D-12), within the shared count (D-20), it calls `plan3 lane start` (base = current HEAD commit; the step stays `[ ]`, owned in the sidecar, D-18), launches an async `plan3-lane` subagent with `cwd` = the slot, the step block, standing rules and the targeted test commands, and records the run id on the lane (D-19).
2. The lane commits in its slot and reports changed files, checks run and open points.
3. At its own step boundary (its work committed), the main agent reads the lane's diff and runs `plan3 lane land` (D-08): pick onto current HEAD in the slot, targeted checks in the slot, fast-forward master. Then it marks the step done. Full gates run serially per project rules.
4. Any helper failure, conflict or failing check: drop the lane and do the step serially (D-14). A timeout or unknown run state leaves the slot unavailable until the run is confirmed stopped (D-19). Never retry the same lane blindly.
5. Scouts run any time for independent questions; trials for "try X" while the main agent continues; their reports go into step notes or Decisions, never straight into code.

Locked writes: `slots.json` changes only under the repository lock and `lanes.json` only under the plan lock, with decisions taken from the state read inside them. Tests: two `lane start` calls for the same step at once give one lane; two steps of one plan, and two different plans, racing for the last free slot give one start and one refusal; a scout and a lane racing for the last admission give one; completing one plan while another plan owns a slot leaves that slot alone; `land` and `drop` of one lane at once give one outcome. A test also checks that no code path writes either file outside its lock.

## Phases

### Phase 1: Foundations with no behaviour change [code]

- [x] **S-01** after: lines in workState (unmet ids wait, lane-eligible [code] steps listed in summary and resume packet), finish lint for unknown and cyclic ids
  - note: Design (assumed, from code reading): slot root = <PI_CODING_AGENT_DIR or ~/.pi/agent>/worktrees/<repo basename>-<sha8 of lowercased git toplevel>; slots.json there {limit, slots:[{n,path,owner|null,lastPlan}], scouts:[{plan,run}]} under withPlanLock(slots.json); per-plan docs/plans/logs/<id>.lanes.json {lanes:[{id,kind,slot,branch,base,run}]} under withPlanLock(lanes.json), lock order always repo then plan. Ops on tool action lane (param op): start (step|trial), run (record run id), scout (admit run id, no slot), drop, list; land is S-08. Run stopped = status.json state in complete/failed/partial/stopped/rejected/paused found at <PI_SUBAGENTS_TEMP_ROOT or tmpdir/pi-subagents-*>/async-subagent-runs/<run>/status.json; missing/queued/running = not stopped; status reader injectable for tests. workState gets lane-owned ids from lanes.json via summarize/resume (excluded from next/wip, still counted open for status complete). Complete: refuse while plan owns a lane; remove slots whose lastPlan is this plan and owner null.
- [x] **S-02** plan3-lanes.ts slots (repo-wide admission cap shared with scouts, run-status guard, orphan slots, drop patches, completion cleanup) + plan3 action lane start|trial|run|scout|drop|list; lane-owned steps leave next/wip but block completion
- [x] **S-08** lane pick (stopped helper, pinned range, refuse docs/plans/, cherry-pick onto current HEAD in slot, conflict aborts naming files) + lane land (ff-only main if HEAD unchanged else repick; D-17 watch: branch switch or rewritten history refused)
- [x] **S-03** lane run records {run,id,kind,step,artifacts} durably in lanes.json runs; helperRuns() joins pi-subagents <run>_*_meta.json (usage/cost/model, durationMs else status endedAt-startedAt, missing = unknown); stats viewer shows a Helpers section after main rows

### Phase 2: Helpers in planning and execution [think]

- [x] **S-04** Helpers 0..2 (project>global, unset 2, 0 refuses start/trial/scout, other values throw) and Scout model (unset = coding model) in phaseSettings + /work-settings rows; lane start/trial/scout return launch {agent, cwd, model}; agents plan3-lane (read,bash,edit,write) and plan3-scout (read,grep,find,ls); slotGuard child tool_call guard in plan3-lanes.ts wired into plan3.ts; verify-package list updated
- [x] **S-05** Execute prompt gets helperRule(n) only when Helpers > 0 (lanes/trials/scouts, pick-check-land, D-14 drop-and-redo, D-17 changed-checkout serial fallback); plan summary carries laneLive/lanesFile; night fingerprint includes the lanes sidecar; day stop check and night settle stay quiet with only running lanes and push a land-or-drop note for stopped ones
- [x] **S-06** planHelpers(n) appended to planning and write prompts only when Helpers > 0: after: only for steps sharing no functionality (same file other area fine, unsure = serial), scouts for research, map prototype tickets as trials; README Helpers bullet and CHANGELOG Unreleased entries

### Phase 3: Pilot [think]

- [ ] **S-07** Pilot: judge the next real plan run with helpers 2 against past stats; keep default 2 or set 0 per D-02
  - needs: R-pilot-plan
  - Baseline: per-step and total wall time and cost of the closest past plans (for WorkOrchestrator, `docs/plans/logs/b400c470.stats.json` and `50c64af2.stats.json`).
  - Verdict (keep or off) on end-to-end plan elapsed time and total main plus helper cost against D-02; lane-eligible work speed, landing conflicts, serial fallbacks and lost or reverted work are reported beside it. Record in Decisions and, on failure, set the default to 0 in one commit.
  - When baselines or costs are not comparable (different plan size, missing helper metrics), record the verdict as inconclusive; a historical comparison is the user-chosen pilot (D-09), not the matched benchmark `docs/agent-rules.md` Optimization Regression Rule needs to call the optimization verified.
  - Ask with numbers then: if the result is near a threshold, the user decides keep or off.
  - On a passing verdict (D-16): write one self-contained request for WorkOrchestrator's next plan (changed prompts, `after:` rule, landing and fallback rules) into the verdict note.

## Requirements

- **R-pilot-plan** A real plan, in any project, with 3 or more steps marked independent, run by the user with helpers on (S-07 reads its stats)

## Global validation

Commands (from `C:/SOFT/git/ce-workflow`):

- Targeted: `node scripts/test-work-plan3.mjs`, `node scripts/test-work-plan3-lanes.mjs`, `node scripts/test-work-plan3-stats.mjs`, `node scripts/test-work-plan3-night.mjs`, `node scripts/test-work-settings.mjs`.
- Full suite once at completion: `npm run verify:quiet`.
- LSP check of changed `.ts` files with `lens_diagnostics` (source lsp, scope paths).

Plan acceptance:

- With helpers 0 every Plan3 prompt and the step selection are exactly as before (tests compare).
- Lanes never write the plan file, the main checkout or master (code guard plus watch, D-17); only `plan3 lane land` brings their commits to master, and a conflict or failing check leaves master untouched.
- Helper time and cost appear in the plan's stats.
- S-07 has a recorded verdict, or stays waiting on R-pilot-plan with everything else done.

## Backlog

- Port to the WorkOrchestrator core's Plan3 after the pilot passes (D-16), as that project's own plan.
- Shared build caches (sccache or similar) if cold slot builds dominate lane time.

## Resume context

S-01..S-06 and S-08 done and committed (HEAD 32ff9ea1). Full `npm run verify:quiet`: exit 1 with 4 failures, none in the code this plan touched: test-work-compaction-notifications (:1484), test-work-wo-control (:41) and test-work-native-smoke (Cannot find module @earendil-works/pi-coding-agent) fail the same way on the pre-feature commit e8fc929d in a temporary worktree; the hub test-scheduler failed inside the suite but passes on its own (exit 0). All plan-targeted suites are green (plan3, -lanes, -stats, -night, settings). Remaining: S-07 is a pilot only the user can run (R-pilot-plan is off): the next real plan with 3+ independent steps at helpers=2, compared with the stats.json baselines; keep the default of 2 only if wall time drops at least 30% at no more than 30% extra cost, else set 0. No push.

## Amendments

Append material changes and their reasons; preserve the original request and settled decisions.

- 2026-11-25 /plan3 review (advisor plan3-advisor, openai-codex/gpt-6.2-astra:high), each finding checked against the code:
  - Accepted, write boundary: a cwd confines nothing and the advisor template's read-only rule is prose (`utility-agents/plan3-advisor.md`). Added D-17 (child `tool_call` guard modelled on `extensions/design.ts:643-647`, main-checkout watch, serial fallback) to S-04 and S-05; scouts lose bash (D-11). Residual bash risk recorded in D-17. Strengthens the approved "safe first" requirement, no scope change.
  - Accepted, cross-plan slot race: `withPlanLock` keys on one file (`plan3-files.ts:8-20`). Slots now live in a repository `slots.json` under its own lock with owners (D-07); tests for two plans racing and completing one while the other owns a slot.
  - Accepted, stale writer: a timeout does not prove the child stopped. D-19 records run ids, reconciles on resume and reuses a slot only after confirmed stop.
  - Accepted, implicit predecessor: `test-work-plan3.mjs:548` expects N-03 to run while N-02 waits on a requirement. D-05 revised: `after:` only adds lane eligibility and explicit waits; the main selector is otherwise unchanged; unmet `after:` steps appear in `waiting` so completion is refused (`plan3.ts:1867-1868`). D-05 was a fit-check choice, not a user decision.
  - Accepted, extra wip markers: confirmed at `plan3.ts:152,481,1248-1250,1905-1912`. D-18 keeps lane ownership in the sidecar; S-02 tests selection and attribution.
  - Accepted, post-land failure and multi-commit conflict: D-08 now picks onto current HEAD inside the slot, checks there and fast-forwards master only when HEAD is unchanged; S-08 holds the landing tests. Stays within D-06 (the user's cherry-pick onto master, linear history) and D-14.
  - Accepted, night guard in children: confirmed the guard is the parent's `tool_call` hook (`plan3-night.ts:145-149`). D-13 now relies on D-17's child guard, proven with a harmless blocked command in S-04.
  - Accepted, helper cap: settings range 0 to 2 per D-03, and one admission count for scouts, trials and lanes (D-20).
  - Accepted in part, stats source: the repo's dev copy is pi-subagents 0.87.0, the runtime one 0.90.0; `durationMs` appears in some meta files only. S-03 joins by recorded run id and shows unknown for missing metrics.
  - Accepted, pilot verdict: judged on end-to-end elapsed time and total cost, with inconclusive allowed; the Optimization Regression Rule caveat recorded in S-07. D-02 and D-09 unchanged.
  - Accepted, duplicate full suite: S-04 no longer runs `npm run verify:quiet`; the final run covers the package list (`verify-package.mjs:40`).
- 2026-11-25: Added S-08 after S-02: Review 2026-11-25: landing needs its own recoverable boundary (D-08) and tests; split from S-02 to keep each step one session.
