---
name: work-orchestrator
description: Drive Beads-backed software work from /work-* prompts. Use when creating, resuming, pausing, or checking autonomous development work with Beads, git, and pi-subagents.
---

# Work Orchestrator

Use this skill for `/work-master`, `/work-small`, `/work-med`, `/work-big`, `/work-debug`, `/work-auto`, `/work-resume`, `/work-continue`, `/work-add`, `/work-status`, and `/work-pause`.

## Source of Truth

- Beads is the only durable work state: scope, status, acceptance, dependencies, discovered work, and resume notes live in Beads.
- Git is the only code state: changed files, diffs, commits, and branches live in git.
- Chat memory is not source of truth. A fresh session must resume from `bd ready --json`, `bd list --status=in_progress --json`, and `git status`.
- Work one ready Bead at a time unless isolated worktrees are explicitly used.
- Do not overwrite manual edits silently.

## Preflight

Run these before mutating work:

```bash
bd prime
bd where
git status --short --branch
```

If no Beads workspace exists, stop and ask the user to initialize Beads in the target repo. Ignore Pi runtime artifacts such as `.pi-subagents/`; if they appear untracked, add them to `.gitignore` only when that is the smallest safe cleanup. If git is dirty, classify the files before launching a writer:

- belongs to the current Bead: include it and verify it;
- unrelated but safe: leave it untouched;
- conflicts with the current Bead: stop and ask;
- completed work: create or update a Bead and commit that work first.

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
- `wo:fix`
- `wo:decision`

For discovered work, create a Bead and include `discovered-from:<current-bead-id>` in notes. Add a blocking dependency only when it truly blocks current or future work.

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

Use for failing tests, errors, regressions, or broken behavior inside an existing epic.

1. Resolve the active epic first; if ambiguous, ask.
2. Create a `type=bug` child Bead under that epic (`--parent <epic-id>`) with the reported symptom, reproduction command, and expected behavior.
3. Launch `bead-debugger` with that bug Bead and require the `ce-debug` workflow: reproduce, root-cause, fix, verify.
4. Review the debug diff with `bead-reviewer`; if it fails, return to `bead-debugger` or `bead-fixer` with exact findings.
5. Commit through `bead-committer`, then close the bug Bead only after verification passes and no related dirty files remain.
6. If debugging produced a reusable root-cause lesson, run `ce-compound mode:headless <short context>` after the fix commit and commit any generated learning docs before closing the epic.

Stop when reproduction needs unavailable external state, the root cause requires a product/architecture decision, or `ce-debug` cannot verify safely.

## Mode: auto

Classify the task, then route:

- small: clear, low-risk, one or two files;
- med: bounded, some choices, fewer than about ten files;
- debug: failing test, error, regression, stack trace, or broken behavior;
- big: cross-cutting, high-risk, unclear, architecture/product decisions, or more than about ten files inside an existing epic;
- master: new brainstorm, new product idea, or request to create a master plan/epic.

If classification is big, master, or ambiguous, ask before starting. Do not silently turn a vague request into an epic.

## Mode: resume

Argument may be an explicit epic Bead ID, `last`, or empty.

When empty or `last`, resolve from Beads, not chat memory:

1. in-progress epic in the current repo;
2. latest not-completed epic with ready descendants;
3. if ambiguous or no single latest epic can be found, list active not-completed epics and ask the user to pick one.

## Mode: continue

Legacy alias for `Mode: resume`. Follow the same resolution and loop.

Loop:

1. Run `bd ready --json`.
2. Pick exactly one ready Bead belonging to or blocking the target epic.
3. Run `bd show <id> --json`.
4. If it is a planning Bead, launch `bead-planner`.
5. If it is an implementation Bead, launch `bead-worker`.
6. Launch `bead-reviewer` against the diff, Bead acceptance, and verification notes.
7. If review returns `FAIL`, launch `bead-fixer`, then review again.
8. After `PASS`, launch `bead-committer` or commit in the parent with the same gate.
9. For big/master/debug work only, run the learning-capture gate: if the work produced reusable debugging, architecture, workflow, or integration knowledge, run `ce-compound mode:headless <short context>` once and commit any generated learning docs. Skip this gate for routine small/med work to avoid token and time waste.
10. After commit/close, always run a clean-boundary gate: `git status --short`, the Bead verification if any related source files changed after commit, and `bd list --status=open --json` plus `bd list --status=in_progress --json` for the target epic.
11. If autoformat/test tooling changed related files after commit, verify and commit those related changes before moving on; do not report completion with dirty related files.
12. Repeat until a stop condition fires.

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

Read-only report:

- active epic or in-progress Beads;
- ready Beads;
- blocked Beads;
- git status;
- active subagent runs when visible.

Do not mutate Beads or git in status mode.

## Role Loop

Use `pi-subagents` from the parent session. Children get concrete Bead IDs and must not launch their own subagent workflows unless explicitly assigned a fanout role.

## Cost and Model Policy

Keep the parent/main orchestrator on the user's chosen model/effort. For role agents, use the cheapest setting that can satisfy the role: planner high, debugger high, worker/fixer/reviewer medium, committer low. For spawned smoke-test Pi instances, use low/minimal effort unless explicitly stress-testing reasoning quality. Prefer project `subagents.agentOverrides` for concrete model IDs (for example frontier model for `bead-worker`, cheaper model for `bead-committer`) instead of hard-coding provider-specific models in this package.

All human questions from children must flow through the parent session. A child uses `contact_supervisor` with `reason: "need_decision"`; the parent relays the single concrete question to the user, records the answer in Beads notes, then resumes the role loop. Do not let a child block invisibly on user input.

### bead-planner

Allowed to mutate Beads through `bd`. Must not edit source code.

Responsibilities:

- read the planning Bead and master epic, including the epic's master plan fields;
- propagate the project verification contract into child Bead acceptance;
- list existing children of the epic before creating anything;
- create the next one to three executable Beads under the epic (`--parent <epic-id>`) only when no existing open/in-progress/closed child already covers that implementation unit;
- create decision Beads for uncertainty under the epic (`--parent <epic-id>`);
- add only real `blocks` dependencies;
- close or update the planning Bead when durable Beads exist.

### bead-worker

Single writer for implementation. Must not commit.

Responsibilities:

- claim the Bead;
- read only relevant context;
- implement exactly that Bead;
- run the Bead verification contract, including real hardware checks when required;
- update notes with files changed, verification, and remaining work;
- create discovered follow-up Beads when needed.

### bead-reviewer

Read-only reviewer.

Responsibilities:

- inspect git diff;
- inspect Bead acceptance criteria;
- inspect verification contract evidence in notes;
- report `PASS` or `FAIL` with evidence;
- when failing, provide exact fix instructions or a fix Bead.

### bead-debugger

Single writer for root-cause debugging. Must not commit.

Responsibilities:

- read the bug Bead and current git state;
- use `ce-debug` discipline to reproduce, trace, root-cause, fix, and verify;
- update Bead notes with symptoms, causal chain, files changed, verification contract evidence, and result;
- create follow-up Beads under the same epic only for separate work;
- request `ce-compound mode:headless` when a non-trivial reusable lesson was learned.

### bead-fixer

Single writer for reviewer-identified issues only. Must not commit.

Responsibilities:

- fix only reviewer findings;
- rerun the verification contract;
- update Bead notes;
- hand back to reviewer.

### bead-committer

Commit and close gate. Must not edit source code.

Responsibilities:

- inspect `git status` and diff;
- confirm the verification contract passed;
- commit only related files;
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

## Review Strategy

Default loop:

```text
worker -> reviewer -> fixer if needed -> reviewer -> committer
```

For larger or risky Beads, the parent may run a read-only reviewer fanout for correctness, tests, simplicity, and any relevant security/performance/API risk. Keep writers single-threaded unless using isolated worktrees.
