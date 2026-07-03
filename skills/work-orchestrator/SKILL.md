---
name: work-orchestrator
description: Drive Beads-backed software work from /work-* prompts. Use when creating, resuming, pausing, or checking autonomous development work with Beads, git, and pi-subagents.
---

# Work Orchestrator

Use this skill for `/work-master`, `/work-migrate`, `/work-small`, `/work-med`, `/work-big`, `/work-debug`, `/work-auto`, `/work-resume`, `/work-continue`, `/work-add`, `/work-report`, `/work-status`, and `/work-pause`. Use the extension command `/work-models` to persist model/effort overrides for the role agents. Use `/work-context` to inspect or tune the built-in proactive instant compaction guard. The extension command `/work-status` provides the cheap deterministic status view when loaded.

## Source of Truth

- Beads is the only durable work state: scope, status, acceptance, dependencies, discovered work, and resume notes live in Beads.
- Git is the only code state: changed files, diffs, commits, and branches live in git.
- Chat memory is not source of truth. A fresh session must resume from `bd ready --json`, `bd list --status=in_progress --json`, and `git status`.
- Work one ready Bead at a time unless isolated worktrees are explicitly used.
- The parent orchestrator coordinates only; implementation, review, fixes, debugging, migration, and commit gates run through role agents. If `pi-subagents`/`subagent` is unavailable, stop with a setup blocker instead of doing the work in the parent chat.
- One executable Bead is the default session boundary: after committing/closing it, stop with the next `/work-resume <epic-id>` command instead of dragging old context into the next slice.
- Do not overwrite manual edits silently.

## Preflight

Run these before mutating work:

```bash
bd prime
bd where
git status --short --branch
```

If no Beads workspace exists, stop and ask the user to initialize Beads in the target repo. Ignore Pi runtime artifacts such as `.pi-subagents/`; if they appear untracked, add them to `.gitignore` only when that is the smallest safe cleanup. If git is dirty, run the worktree hygiene gate before launching a writer:

```bash
git status --porcelain=v1 --untracked-files=all
git diff --name-only
git diff --cached --name-only
```

Classify file names, not human diff/stat summaries such as `1 -0`:

- belongs to the current Bead: include it and verify it;
- unrelated but safe: leave it untouched and pass it to children as a known-unrelated dirty allowlist;
- unrelated whitespace-only scratch in a tracked file, especially `AGENTS.md`/instructions touched by tooling: restore it before spawning children when it is clearly not user work;
- conflicts with the current Bead: stop and ask;
- completed work: create or update a Bead and commit that work first.

Children should not rediscover already-classified dirt from chat memory. Include the exact related file list and known-unrelated dirty allowlist in every worker/reviewer/committer task.

## Verification Contract

Project instructions can define mandatory verification such as TDD, hardware-in-the-loop checks, fixture runs, safety tests, or exact commands. Treat those as a verification contract, not advice.

During preflight, read the relevant project instructions (`AGENTS.md`, `CLAUDE.md`, `.pi/`, README/test docs when referenced) and extract only concrete verification rules that apply to the requested work. Propagate them into the epic and every child Bead's `acceptance`/`notes` before implementation. If the contract says real hardware testing is required for affected modules, each affected Bead must name the module/device check and require real hardware evidence.

Workers must run the contract or stop. Reviewers and committers must fail/hold the Bead when contract evidence is missing. Do not replace required hardware verification with mocks, simulation, or static checks unless the contract or user explicitly allows that substitute.

## Beads Conventions

Use core Beads fields before inventing metadata:

- `type=epic`: master goal, master plan, scope, acceptance, constraints.
- `type=task`: executable implementation slice.
- `type=decision`: human/product/architecture uncertainty.
- `type=bug`: reviewer failure or regression fix.
- `description`: problem, scope, why this exists.
- `design`: approach, decisions, relevant plan references.
- `acceptance`: concrete done criteria and verification contract.
- `notes`: progress, files changed, verification result, handoff.
- dependencies: only real blockers.

Every non-epic Bead created inside an epic must use Beads hierarchy (`bd create --parent <epic-id>` or the equivalent). Do not create top-level task/decision Beads for epic work.

Use labels for workflow state:

- `wo:planning`
- `wo:implementation`
- `wo:debug`
- `wo:debug-needed`
- `wo:blocked`
- `wo:fix`
- `wo:decision`

For discovered work, create a Bead and include `discovered-from:<current-bead-id>` in notes. Add a blocking dependency only when it truly blocks current or future work.

## Failure and Blocker Lifecycle

A failed verification or live evidence result is durable work state, not chat trivia. Record a compact failure artifact in the Bead notes with: command/run ID, artifact paths, failing phase, exit code/status, observed vs expected result, touched files, suspected owner, and exact next debug command. If the harness passes but product evidence says `failed`, `hardware-blocked`, `terminal-failed`, or similar, treat those as separate fields: the harness task may close only when its acceptance was evidence capture, but a follow-up debug Bead must exist for the product failure before downstream dependent work proceeds.

When an implementation Bead fails its own acceptance or verification, do not close it. Create or reuse a `type=bug` child Bead under the same epic, label it `wo:debug`, include `discovered-from:<failed-bead-id>` and the failure artifact, then add a dependency so the failed Bead and any downstream slices wait for the bug. Mark the failed Bead notes with `debug-needed:<bug-id>` and `wo:debug-needed` when labels are available. If Beads supports a blocked status in the project, use it; otherwise keep the blocker represented by dependencies and labels.

If mandatory verification cannot run because the environment is missing a toolchain, device, credential, or other external prerequisite, do not repeatedly re-run the same implementation Bead. Create or reuse a `type=decision` child Bead labeled `wo:blocked` with the exact missing prerequisite and next verification command, add it as a blocker for the failed Bead, checkpoint any related code state if needed to leave git clean, and stop with that blocker as the next ready item.

When `ce-debug` cannot safely fix or verify, record the debugger's failure artifact in the bug Bead, create a `type=decision` Bead for the human question when needed, label the bug `wo:blocked`, and add a dependency from the bug to that decision. `/work-resume` should then continue with the next unrelated ready Bead from `bd ready --json`; it must not spin on blocked work. `/work-report` is the human handoff surface for blocked/debug-needed Beads.

## Mode: master

Use to create a new master epic from a brainstorm, rough feature idea, or existing plan.

When the input points at a brainstorm or asks for a master plan, run `ce-plan` first to turn that source into a detailed master plan for later slicing. Tell `ce-plan` to auto-accept plan creation and skip interactive confirmation unless it needs a real human decision. Then create the epic Bead from the produced plan: put the summary/scope in `description`, key decisions and implementation units in `design`, acceptance/verification contract in `acceptance`, and the source brainstorm plus local plan path in `notes`. Beads remains source of truth; the plan file is a reference.

1. Create only the master epic Bead with the master plan captured in Beads fields.
2. Create only one initial `wo:planning` Bead that tells `bead-planner` to split the epic into the next one to three executable slices.
3. Do not create executable task Beads in the parent; that is only `bead-planner`'s job.
4. Launch `bead-planner`.
5. Planner creates or reuses executable Beads and decision Beads.
6. Start `Mode: resume` for the epic.

Do not implement until the epic contains the master plan and durable executable Beads exist. Do not create duplicate task Beads for the same implementation unit.

## Mode: migrate

Use to import existing project state from CE brainstorms/plans, non-CE plans, TODOs, issue exports, docs, git history, and unfinished branches into Beads.

Migration is read-only for source code and git history. Do not checkout, merge, rebase, delete branches, edit source files, stage, or commit. Run preflight, then inspect the requested artifacts and branch state:

```bash
git status --short --branch
git branch --all --no-color --sort=-committerdate
git log --all --decorate --date=short --pretty=format:'%h %ad %d %s' --max-count=80
```

1. Require the user to name the artifacts, branches, tracker export, or description to migrate. If scope is too vague, ask first.
2. If the source is a clean CE brainstorm/plan with no partial implementation to reconcile, prefer `Mode: master` instead.
3. Launch `bead-migrator` with the sources, current branch, suspected base branch, and instruction to mutate only Beads.
4. `bead-migrator` creates or reuses exactly one epic unless the user asked for multiple epics.
5. The epic notes must include provenance: artifacts read, branches inspected, current branch, base branch assumption, and migration date.
6. Create closed child Beads only for completed units with strong evidence from artifacts plus code/commit/test evidence. Git log is evidence, not truth; never create one Bead per commit.
7. Create open task/bug Beads for remaining work and decision Beads for ambiguity.
8. For unmerged or stale branches, create review/integration Beads or decision Beads under the epic; never auto-merge or checkout branches during migration.
9. If artifacts are messy but substantial, run `ce-plan` only to consolidate a reference plan, auto-accepting plan creation unless a real decision is needed, then store the resulting plan path in epic notes. Beads remains source of truth.
10. After migration, show the created/reused epic ID and ask whether to start `Mode: resume` for that epic.

Stop if completion evidence is weak but the user asked to mark work done, branch handling requires checkout/merge/rebase, artifact claims conflict with code, or dirty source changes make provenance unsafe.

## Mode: small

Use for clear, low-risk changes in one or two files inside an existing epic.

1. Resolve the active epic first; if ambiguous, ask.
2. Create a child Bead under that epic (`--parent <epic-id>`) unless an existing Bead already matches it.
3. Claim it.
4. Implement directly or launch `bead-worker` for exactly that Bead.
5. Run the smallest real verification that satisfies the Bead's verification contract.
6. Do a light review against acceptance and diff.
7. Commit related files with `<bead-id>: <summary>`.
8. Close the Bead only after the commit exists.

Stop if the task is not actually small, acceptance is unclear, or dirty files conflict.

## Mode: med

Use for bounded work inside an existing epic with a few choices and fewer than about ten files.

1. Resolve the active epic first; if ambiguous, ask.
2. Create a parent Bead under that epic.
3. Create one to three executable child Beads.
4. Add dependencies only where real.
5. Run the first ready child through the continue loop.
6. Continue while ready work remains and no stop condition fires.

Use an in-session plan only to decide Bead slicing; durable scope still goes into Beads.

## Mode: big

Use for large, risky, cross-cutting, or architectural work inside an existing epic.

1. Resolve the active epic first; if ambiguous, ask.
2. Create a `wo:planning` Bead under that epic describing the requested large slice.
3. Launch `bead-planner` to split that slice into the next one to three executable Beads and any decision Beads.
4. Start `Mode: resume` for the epic.

Do not create a new master epic here; use `Mode: master` for that.

## Mode: debug

Use for failing tests, errors, regressions, blocked/debug-needed Beads, or broken behavior inside an existing epic.

1. Resolve the active epic first; if ambiguous, ask.
2. If the argument starts with an existing Bead ID, inspect that Bead instead of creating a duplicate. Treat text after `:` as human guidance and append it to the debug Bead notes before debugging. If the target is an implementation Bead with `debug-needed:<bug-id>`, debug the bug Bead.
3. Otherwise create a `type=bug` child Bead under that epic (`--parent <epic-id>`) with the reported symptom, reproduction command, expected behavior, and failure artifact when supplied.
4. Default path: launch `bead-debugger` with that bug Bead and require the `ce-debug` workflow: reproduce, root-cause, fix, verify.
5. Interactive path: when the user explicitly asks to debug a blocked Bead in the console or gives direct guidance (`/work-debug <bead-id>: ...`), the parent may run the debug loop directly for observability. Keep Beads/git as source of truth, avoid unrelated edits, and then run the same review/commit/close gates as the agent path.
6. If `ce-debug` fixes and verifies the issue, review the debug diff with `bead-reviewer`; if it fails, return to `bead-debugger` or `bead-fixer` with exact findings.
7. Commit through `bead-committer` or the parent commit gate, then close the bug Bead only after verification passes and no related dirty files remain. Remove or satisfy blocking dependencies so `/work-resume` can continue downstream work.
8. If debugging produced a reusable root-cause lesson, run `ce-compound mode:headless <short context>` after the fix commit and commit any generated learning docs before closing the epic.

Stop and mark blocked when reproduction needs unavailable external state, the root cause requires a product/architecture decision, or `ce-debug` cannot verify safely. The blocked bug Bead must contain the failure artifact, current hypothesis, attempted commands, and exact human decision needed.

## Mode: auto

Classify the task, then route:

- small: clear, low-risk, one or two files;
- med: bounded, some choices, fewer than about ten files;
- debug: failing test, error, regression, stack trace, or broken behavior;
- big: cross-cutting, high-risk, unclear, architecture/product decisions, or more than about ten files inside an existing epic;
- master: new brainstorm, new product idea, or request to create a master plan/epic;
- migrate: existing partially completed project, legacy TODO/issue tracker, non-CE artifact set, or branch/history reconciliation.

If classification is big, master, migrate, or ambiguous, ask before starting. Do not silently turn a vague request into an epic.

## Mode: resume

Argument may be an explicit epic Bead ID, `last`, or empty. Default behavior is one executable Bead per invocation; the user can run `/work-resume <epic-id>` again from a fresh Pi session for the next slice.

When empty or `last`, resolve from Beads, not chat memory:

1. in-progress epic in the current repo;
2. latest not-completed epic with ready descendants;
3. if no single latest epic can be proven, list active not-completed epics and ask the user to pick one.

Build the choice list with Beads commands such as `bd list --type=epic --status=open --json`, `bd list --type=epic --status=in_progress --json`, and `bd children <epic-id> --json` when available. The choice list must include, for each epic: Bead ID, created date, last worked date, status, ready/open/in-progress child counts when available, and a one-line description. Compute dates from Beads JSON fields such as `created_at`/`updated_at` when available; otherwise use child updates, notes, or `unknown`. Do not guess from chat memory.

## Mode: continue

Legacy alias for `Mode: resume`. Follow the same resolution and loop.

Loop:

1. Run `bd ready --json`.
2. Run the worktree hygiene gate and resolve/record dirty files before spawning any child. Prefer one parent cleanup over repeated child stop/retry loops. Repeat this gate after every child returns; restore whitespace-only tracked instruction-file changes such as `AGENTS.md` before interpreting review results or committing. Because some child starts can recreate this whitespace dirt after the parent gate, include a startup allowlist telling children to continue when the only dirty file is whitespace-only `AGENTS.md`/instruction-file EOF dirt, and to leave it for parent cleanup.
3. Inspect `bd children <epic-id> --json`. If ready contains `wo:planning` Beads and executable child Beads already exist, close the satisfied planning Bead with a note naming the created children; do not run it as implementation work.
4. Pick exactly one non-planning ready Bead belonging to or blocking the target epic. Prefer `wo:debug` bug Beads when they unblock in-progress/debug-needed work; otherwise pick the earliest unblocked implementation slice. Skip `wo:blocked` Beads unless the user explicitly chose them with `/work-debug`.
5. If no non-planning ready Bead belongs to the target epic, inspect the epic master plan. If open decisions, blocked/debug-needed children, or failed evidence exist, report them with `/work-report <epic-id>` style details and stop. If the epic is not closed and no blocker explains the empty ready set, create or reuse a `wo:planning` Bead under the epic and launch `bead-planner` to compare the master plan against closed/open children and create the next one to three slices; require the planner to close the planning Bead once executable children exist, verify `bd ready --json` now shows the earliest executable slice rather than a later dependent slice, then stop so the next `/work-resume <epic-id>` starts fresh. Only report "done" when the planner confirms no remaining implementation units and all child Beads are closed or deliberately deferred.
6. Run `bd show <id> --json`.
7. If it is a planning Bead, launch `bead-planner` with `context:fresh` and file-only/concise output when available, require it to close or update the planning Bead, verify `bd ready --json` exposes the earliest executable slice and not the planning Bead or a later dependent slice, then stop at the planning boundary.
8. If it is an implementation Bead, launch `bead-worker` with `context:fresh` and a concrete task containing only the epic ID, Bead ID, acceptance, verification contract, relevant paths, related file allowlist, and known-unrelated dirty allowlist. Always include the instruction-file whitespace startup allowlist from step 2 so workers do not contact the supervisor for harmless EOF-only `AGENTS.md` dirt.
9. Launch `bead-reviewer` with `context:fresh`, scoped files, acceptance, verification evidence, known-unrelated dirty allowlist, and the same instruction-file whitespace startup allowlist from step 2. Request a short PASS/FAIL summary and keep full output in `.pi-subagents/artifacts/` when available. Treat out-of-scope whitespace-only instruction-file dirt as parent cleanup, not an implementation failure, once restored.
10. If review returns `FAIL` for fixable code, launch `bead-fixer` with `context:fresh`, exact findings, and the assigned Bead, then review again. If review or verification shows the Bead cannot meet acceptance without root-cause debugging, apply the Failure and Blocker Lifecycle: create/reuse a `wo:debug` bug Bead, attach the failure artifact, add blocker dependencies, and stop so the next `/work-resume` can pick the debug Bead or unrelated ready work.
11. After `PASS`, launch `bead-committer` with `context:fresh` or commit in the parent with the same gate. For small PASS-reviewed Beads, prefer the parent commit gate when spawning a committer would only repeat deterministic status/stage/commit/close work. Before close, confirm any product evidence failure was either accepted as evidence-only scope or has a linked debug Bead.
12. For big/master/debug work only, run the learning-capture gate: if the work produced reusable debugging, architecture, workflow, or integration knowledge, run `ce-compound mode:headless <short context>` once and commit any generated learning docs. Skip this gate for routine small/med work to avoid token and time waste.
13. After commit/close, always run a clean-boundary gate: `git status --short`, the Bead verification if any related source files changed after commit, `bd children <epic-id> --json`, and `/work-status <epic-id>` or the same status calculation.
14. If autoformat/test tooling changed related files after commit, verify and commit those related changes before stopping; do not report completion with dirty related files.
15. Stop after one executable Bead closes. Final output must include the epic ID, closed Bead ID, status summary, and `Next: start a fresh Pi session and run /work-resume <epic-id>` unless a blocker or true epic completion exists.

## Mode: add

Use when new work appears during an active epic.

1. Create a new Bead under the active epic (`--parent <epic-id>`) with current context and `discovered-from:<current-bead-id>` in notes.
2. If it blocks current work, add a real dependency.
3. If optional or future, do not block the active Bead.
4. If the user says to do it now, run it as small or med work, then return to the previous epic.

## Mode: pause

Checkpoint and stop safely:

1. Inspect the active Bead and `git status`.
2. Update Bead notes with current state, files changed, last verification, failures, and next step.
3. Do not create speculative work.
4. Stop at a clean boundary.

## Mode: status

Read-only summary. Prefer the extension command `/work-status` when available because it does not spend LLM context. If using the skill path, compute the same fields without mutating Beads or git:

- current epic ID, title, status, created date, last worked date, and one-line description;
- slice progress: closed executable slices / total executable slices and percent complete;
- ready slices, in-progress slices, planned-ahead/open slices that are not ready, open decisions, and planning Beads;
- tasks completed and remaining by Beads status;
- whether `bd ready` is empty because the epic is complete, blocked, or needs another `bead-planner` slicing pass;
- git status;
- active subagent runs when visible;
- next command, usually `/work-resume <epic-id>`.

Do not mutate Beads or git in status mode.

## Mode: report

Read-only detailed handoff for a whole epic or one blocked/debug-needed Bead. Use when the user wants to know what is blocked, why, what failed, and what command/guidance to give next. Do not mutate Beads or git.

For an epic target, report:

- epic ID, title, status, progress percent, and next ready Bead from `bd ready --json`;
- ready unblocked work that `/work-resume` can continue;
- blocked/debug-needed Beads, grouped by `wo:blocked`, `wo:debug-needed`, open decisions, and unmet dependencies;
- for each blocked item: blocker Bead/dependency, latest failure artifact summary, artifact paths, last verification command/result, owner/phase, and exact suggested command such as `/work-debug <bug-id>: <human guidance>`;
- downstream Beads waiting on each blocker;
- git status and any active/stale subagent coordination.

For a Bead target, show the detailed failure artifact from notes: command, exit/status, logs/artifact paths, observed vs expected, attempted fixes, current hypothesis, human decision needed, dependencies, and what `/work-debug <bead-id>: ...` would do. If the Bead is not blocked, say so and point back to `/work-resume <epic-id>`.

## Role Loop

Use `pi-subagents` from the parent session. Children get concrete Bead IDs and must not launch their own subagent workflows unless explicitly assigned a fanout role. Use the exact package role agents (`bead-planner`, `bead-worker`, `bead-reviewer`, `bead-fixer`, `bead-debugger`, `bead-committer`, `bead-migrator`) in the `agent` field; do not substitute builtin `worker`, `reviewer`, `planner`, or `delegate` for these roles. The parent must not read broad source modules or implement source edits itself; if it cannot launch the required role agent, it stops with a setup blocker. Always launch role agents with fresh context (`context:fresh`) unless the user explicitly asks to review the parent conversation. Prefer file-only artifact output plus a short structured summary in the parent; do not paste long tool logs, full `bd show` epic JSON, or whole master plans back into the control session.

## Context Budget Policy

Beads and git preserve the memory; Pi chat is disposable working context. The package extension registers `/work-context`; it does not force pre-prompt compaction in normal chats. Pi's native/ultracompact auto-compaction remains responsible unless the user explicitly enables the work guard.

- before any compact/restart boundary, write the current decision, changed files, verification, blockers, and next command into Bead notes;
- rely on `/work-context status` for current token/trigger state; default opt-in trigger is 150k tokens, capped by model context, and keeps at least the latest 30k tokens via Pi compaction settings;
- compact only inside a single Bead when context gets high or after a noisy debug/review phase;
- after one executable Bead is committed and closed, stop instead of continuing to the next unrelated slice in the same session;
- if the user explicitly requests continuous mode, run at most one more ready Bead after a compact/checkpoint boundary and stop when context budget is high.

## Cost and Model Policy

Keep the parent/main orchestrator on the user's chosen model/effort. For role agents, use the cheapest setting that can satisfy the role: migrator/planner high, debugger high, worker/fixer/reviewer medium, committer low. `/work-models` is the friendly settings UI; it writes project `subagents.agentOverrides` for `brainstorm/plan/migration`, `work`, `debug`, `review`, and `commit`. Blank model means inherit the current control-session model. For spawned smoke-test Pi instances, use low/minimal effort unless explicitly stress-testing reasoning quality. Do not hard-code provider-specific models in this package.

## Optional Intercom Coordination

`pi-intercom` is optional, never required. When the `pi-subagents` intercom bridge is active, children use `contact_supervisor` for parent coordination:

- `reason: "need_decision"` for blocking product, architecture, scope, hardware, verification, or dirty-worktree decisions;
- `reason: "progress_update"` for short non-blocking updates when discovery changes the plan.

The parent relays the question to the user when needed, records the answer in Bead notes, then resumes the role loop. Before answering a delayed intercom ask, run `intercom({ action: "pending" })` or equivalent; if the ask is no longer pending, the Bead is already closed, or the run has completed, treat it as stale intercom and do not restart work. If `contact_supervisor` is unavailable, times out, or delivery fails, the child must persist the blocker in Beads (decision Bead or notes) and stop safely. Do not require the user to install `pi-intercom`, do not ask the user directly from a child, and do not guess decisions just to keep the run moving.

### bead-migrator

Allowed to mutate Beads through `bd`. Must not edit source code or change git branches.

Responsibilities:

- read requested artifacts and git branch/history evidence;
- create or reuse one migration epic with provenance notes;
- create closed child Beads only for strongly evidenced completed units;
- create open task/bug/decision Beads for remaining or ambiguous work;
- represent unfinished branches as review/integration Beads or decision Beads, not automatic merges;
- hand back the epic ID for `Mode: resume`.

### bead-planner

Allowed to mutate Beads through `bd`. Must not edit source code.

Responsibilities:

- read the planning Bead and master epic, including the epic's master plan fields;
- propagate the project verification contract into child Bead acceptance;
- list existing children of the epic before creating anything;
- create the next one to three executable Beads under the epic (`--parent <epic-id>`) only when no existing open/in-progress/closed child already covers that implementation unit;
- create decision Beads for uncertainty under the epic (`--parent <epic-id>`);
- add only real `blocks` dependencies, using `bd dep add <later-id> <earlier-id>` when later slices must wait for earlier slices;
- run `bd ready --json` after dependency changes and repair the order if the earliest executable slice is not ready first;
- close or update the planning Bead when durable Beads exist.

### bead-worker

Single writer for implementation. Must not commit.

Responsibilities:

- claim the Bead;
- read only relevant context;
- inspect git with porcelain/name-only commands and do not parse diff/stat summaries as file content;
- implement exactly that Bead;
- ignore a parent-provided known-unrelated dirty allowlist unless those files conflict with the Bead;
- run the Bead verification contract, including real hardware checks when required;
- update notes with files changed, verification, hardware evidence when applicable, and remaining work;
- when verification fails after a real attempt, attach a failure artifact and ask the parent to create/reuse a `wo:debug` bug Bead with blocker dependencies;
- create discovered follow-up Beads when needed.

### bead-reviewer

Read-only reviewer.

Responsibilities:

- inspect git diff;
- inspect Bead acceptance criteria;
- inspect verification contract evidence in notes;
- require a linked debug Bead when product evidence failed but harness/evidence-capture scope passed;
- report `PASS` or `FAIL` with evidence;
- when failing, provide exact fix instructions, a required debug Bead, or a fix Bead.

### bead-debugger

Single writer for root-cause debugging. Must not commit.

Responsibilities:

- read the bug Bead and current git state;
- use `ce-debug` discipline to reproduce, trace, root-cause, fix, and verify;
- update Bead notes with symptoms, causal chain, files changed, verification contract evidence, hardware evidence when applicable, and result;
- when reproduction or verification fails after a real attempt, attach a failure artifact, label the bug `wo:blocked` when available, create a decision Bead for any human question, and leave dependencies so `/work-resume` can move to unrelated ready work;
- create follow-up Beads under the same epic only for separate work;
- request `ce-compound mode:headless` when a non-trivial reusable lesson was learned.

### bead-fixer

Single writer for reviewer-identified issues only. Must not commit.

Responsibilities:

- fix only reviewer findings;
- rerun the verification contract;
- if the finding becomes a root-cause/debug problem instead of a local fix, attach a failure artifact and ask the parent to create/reuse a `wo:debug` bug Bead;
- update Bead notes;
- hand back to reviewer.

### bead-committer

Commit and close gate. Must not edit source code.

Responsibilities:

- inspect `git status` and diff with porcelain/name-only commands;
- confirm the verification contract passed;
- refuse close when the Bead contains unresolved failed product evidence without a linked debug/blocked Bead, unless acceptance explicitly says the Bead only captures evidence;
- commit only related files;
- leave parent-declared known-unrelated dirty files unstaged and report them, stopping only if they conflict or are not on the allowlist;
- use commit message `<bead-id>: <summary>`;
- after commit, re-run `git status --short`; if related files changed due autoformat/test tooling, rerun verification and commit those changes before closing;
- close the Bead only after the commit exists and no related dirty files remain;
- push only when repo/session policy requires it.

## Stop Conditions

Stop and ask or hand off when:

- no ready Beads remain;
- human product, architecture, or debugging-environment decision is needed;
- verification failure invalidates the plan;
- the same subagent fails twice;
- context budget is high;
- dirty/manual changes need classification;
- acceptance criteria conflict with the implementation plan;
- required verification cannot run and no safe substitute exists.

## Live/Test Project Feedback Loop

Whenever a live or disposable test project exposes workflow friction, treat it as product evidence for this package. Before declaring the run done, ask what small ce-workflow change would prevent the same failure class. If the fix is inside this package and safe, apply it here; otherwise record a concrete follow-up. Prefer deleting/rewording brittle role instructions over adding new machinery.

Examples to capture: repeated dirty-file stop loops, child-created instruction-file whitespace, stale intercom asks, wrong Beads dependency order, missing verification propagation, workers/fixers closing Beads before commit, or role agents doing parent work.

## Review Strategy

Default loop:

```text
worker -> reviewer -> fixer if needed -> reviewer -> committer
```

For larger or risky Beads, the parent may run a read-only reviewer fanout for correctness, tests, simplicity, and any relevant security/performance/API risk. Keep writers single-threaded unless using isolated worktrees.
