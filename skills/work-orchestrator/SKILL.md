---
name: work-orchestrator
description: Drive Beads-backed software work from /work-* prompts. Use when creating, resuming, pausing, or checking autonomous development work with Beads, git, and pi-subagents.
---

# Work Orchestrator

Use this skill for `/work-small`, `/work-med`, `/work-big`, `/work-auto`, `/work-continue`, `/work-add`, `/work-status`, and `/work-pause`.

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

If no Beads workspace exists, stop and ask the user to initialize Beads in the target repo. If git is dirty, classify the files before launching a writer:

- belongs to the current Bead: include it and verify it;
- unrelated but safe: leave it untouched;
- conflicts with the current Bead: stop and ask;
- completed work: create or update a Bead and commit that work first.

## Beads Conventions

Use core Beads fields before inventing metadata:

- `type=epic`: master goal, scope, acceptance, constraints.
- `type=task`: executable implementation slice.
- `type=decision`: human/product/architecture uncertainty.
- `type=bug`: reviewer failure or regression fix.
- `description`: problem, scope, why this exists.
- `design`: approach, decisions, relevant plan references.
- `acceptance`: concrete done criteria and verification.
- `notes`: progress, files changed, verification result, handoff.
- dependencies: only real blockers.

Use labels for workflow state:

- `wo:planning`
- `wo:implementation`
- `wo:fix`
- `wo:decision`

For discovered work, create a Bead and include `discovered-from:<current-bead-id>` in notes. Add a blocking dependency only when it truly blocks current or future work.

## Mode: small

Use for clear, low-risk changes in one or two files.

1. Create a Bead for the task unless an existing Bead already matches it.
2. Claim it.
3. Implement directly or launch `bead-worker` for exactly that Bead.
4. Run the smallest real verification.
5. Do a light review against acceptance and diff.
6. Commit related files with `<bead-id>: <summary>`.
7. Close the Bead only after the commit exists.

Stop if the task is not actually small, acceptance is unclear, or dirty files conflict.

## Mode: med

Use for bounded work with a few choices and fewer than about ten files.

1. Create a parent Bead.
2. Create one to three executable child Beads.
3. Add dependencies only where real.
4. Run the first ready child through the continue loop.
5. Continue while ready work remains and no stop condition fires.

Use an in-session plan only to decide Bead slicing; durable scope still goes into Beads.

## Mode: big

Use for cross-cutting, architectural, high-risk, vague, or large work.

1. Create a master epic Bead.
2. Create an initial `wo:planning` Bead.
3. Launch `bead-planner`.
4. Planner creates executable Beads and decision Beads.
5. Start `Mode: continue` for the epic.

Do not implement until durable executable Beads exist.

## Mode: auto

Classify the task, then route:

- small: clear, low-risk, one or two files;
- med: bounded, some choices, fewer than about ten files;
- big: cross-cutting, high-risk, unclear, architecture/product decisions, or more than about ten files.

If classification is big or ambiguous, ask before starting. Do not silently turn a vague request into an epic.

## Mode: continue

Argument may be an explicit epic Bead ID, `last`, or empty.

When empty or `last`, resolve from Beads, not chat memory:

1. in-progress epic in the current repo;
2. latest epic with ready descendants;
3. ask the user when ambiguous.

Loop:

1. Run `bd ready --json`.
2. Pick exactly one ready Bead belonging to or blocking the target epic.
3. Run `bd show <id> --json`.
4. If it is a planning Bead, launch `bead-planner`.
5. If it is an implementation Bead, launch `bead-worker`.
6. Launch `bead-reviewer` against the diff, Bead acceptance, and verification notes.
7. If review returns `FAIL`, launch `bead-fixer`, then review again.
8. After `PASS`, launch `bead-committer` or commit in the parent with the same gate.
9. Repeat until a stop condition fires.

## Mode: add

Use when new work appears during an active epic.

1. Create a new Bead with current context and `discovered-from:<current-bead-id>` in notes.
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

### bead-planner

Allowed to mutate Beads through `bd`. Must not edit source code.

Responsibilities:

- read the planning Bead and master epic;
- create the next one to three executable Beads when needed;
- create decision Beads for uncertainty;
- add only real `blocks` dependencies;
- close or update the planning Bead when durable Beads exist.

### bead-worker

Single writer for implementation. Must not commit.

Responsibilities:

- claim the Bead;
- read only relevant context;
- implement exactly that Bead;
- run the Bead verification;
- update notes with files changed, verification, and remaining work;
- create discovered follow-up Beads when needed.

### bead-reviewer

Read-only reviewer.

Responsibilities:

- inspect git diff;
- inspect Bead acceptance criteria;
- inspect verification notes;
- report `PASS` or `FAIL` with evidence;
- when failing, provide exact fix instructions or a fix Bead.

### bead-fixer

Single writer for reviewer-identified issues only. Must not commit.

Responsibilities:

- fix only reviewer findings;
- rerun verification;
- update Bead notes;
- hand back to reviewer.

### bead-committer

Commit and close gate. Must not edit source code.

Responsibilities:

- inspect `git status` and diff;
- confirm verification passed;
- commit only related files;
- use commit message `<bead-id>: <summary>`;
- close the Bead only after the commit exists;
- push only when repo/session policy requires it.

## Stop Conditions

Stop and ask or hand off when:

- no ready Beads remain;
- human product or architecture decision is needed;
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
