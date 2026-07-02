# Global Work Orchestrator Idea

This is a global Pi workflow package for driving software work through Beads + Compound Engineering without writing long prompts every time.

The orchestrator is not RFLib-specific. RFLib is just one repo it should be able to move forward.

## Goal

Create a global set of Pi skills, prompt templates, and subagents that can:

- use Beads as the only durable source of truth for work state;
- use git as the only source of truth for code state;
- run one executable slice at a time;
- brainstorm and plan only when needed;
- implement, review, fix, verify, commit, and close Beads;
- pause and resume cleanly after interruptions;
- tolerate manual user edits without losing state;
- let the user add urgent work, implement it, then continue the previous epic.

## Core Principle

Do not build a giant custom app first.

MVP should be a global Pi package containing:

```text
pi-work-orchestrator/
  package.json
  skills/
    work-orchestrator/SKILL.md
  prompts/
    work-small.md
    work-med.md
    work-big.md
    work-auto.md
    work-continue.md
    work-add.md
    work-status.md
    work-pause.md
  agents/
    bead-planner.md
    bead-worker.md
    bead-reviewer.md
    bead-fixer.md
    bead-committer.md
  extensions/
    work-orchestrator.ts   # v2, only after prompt/agent MVP works
```

The extension is optional at first. Prompt templates + agents + one skill are enough to prove the workflow.

## Install Shape

Package globally so every repo gets the commands:

```bash
pi install C:\path\to\pi-work-orchestrator
```

Package manifest:

```json
{
  "name": "pi-work-orchestrator",
  "type": "module",
  "keywords": ["pi-package"],
  "pi": {
    "skills": ["./skills"],
    "prompts": ["./prompts"],
    "extensions": ["./extensions/work-orchestrator.ts"],
    "subagents": {
      "agents": ["./agents"]
    }
  },
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": "*"
  }
}
```

## Beads Model

Beads owns durable work state. Plans, status, acceptance, dependencies, and discovered work go into Beads.

Suggested issue types:

- **Epic bead**: master goal, scope, acceptance, constraints.
- **Planning bead**: asks planner to create/update executable beads.
- **Implementation bead**: one shippable slice.
- **Decision bead**: human/product/architecture uncertainty.
- **Fix bead**: reviewer failure or discovered regression.

Suggested field usage:

- `description`: problem, scope, why this exists.
- `design`: implementation approach and decisions.
- `acceptance`: concrete done criteria.
- `notes`: progress, changed files, verification results, handoff.
- dependencies: only real blockers.

CE brainstorm/plan can be used to reason, but the durable result must be converted into Beads. A plan doc may exist as a reference, but Beads wins.

## Command Set

### `/work-small <task>`

For obvious, low-risk changes.

Flow:

1. Create a Bead for the task.
2. Claim it.
3. Implement directly or with one `bead-worker`.
4. Run the smallest real verification.
5. Light review.
6. Commit.
7. Close the Bead.

Use when: typo, small bug, simple helper, one small behavior change.

### `/work-med <task>`

For bounded work that needs a short plan.

Flow:

1. Create a parent Bead.
2. Create 1-3 executable child Beads.
3. Add dependencies only where real.
4. Work first ready child through worker/reviewer/fixer/committer.
5. Continue if safe.

Use when: a few files, some choices, but not a full epic.

### `/work-big <task>`

For features, refactors, or uncertain scope.

Flow:

1. Create master epic Bead.
2. Create initial planning Bead.
3. Run `bead-planner`.
4. Planner creates executable Beads + decision Beads.
5. Start `/work-continue <epic-id>`.

Use when: cross-cutting, architectural, high-risk, vague, or >10 files.

### `/work-auto <task>`

Classifier wrapper.

Default rules:

```text
small = clear, low-risk, 1-2 files
med   = bounded, some choices, <10 files
big   = cross-cutting, high-risk, unclear, architecture/product decisions
```

Then route to `/work-small`, `/work-med`, or `/work-big`.

### `/work-continue [epic-id|last]`

Main autonomous loop.

If empty or `last`, resolve the active epic from Beads state first, not chat memory. Prefer:

1. in-progress epic in current repo;
2. latest epic with ready descendants;
3. explicit user choice if ambiguous.

Loop:

1. Run `bd ready --json`.
2. Pick exactly one ready Bead belonging to or blocking the target epic.
3. Run `bd show <id> --json`.
4. If planning bead: run `bead-planner`.
5. If implementation bead: run `bead-worker`.
6. Run `bead-reviewer`.
7. If failed: run `bead-fixer`, then review again.
8. If pass: run `bead-committer`.
9. Repeat until stop condition.

Stop when:

- no ready Beads remain;
- human decision is needed;
- verification failure invalidates the plan;
- same subagent fails twice;
- context budget is high;
- manual/dirty changes need user classification.

### `/work-add <task>`

Create new work while in the middle of an epic.

Rules:

- If it blocks the current Bead or epic, add a real dependency.
- If it is optional/future, create it with discovered-from/current context but do not block.
- If the user says to do it now, run it as its own small/med flow, then return to previous epic.

### `/work-pause`

Checkpoint and stop safely.

Flow:

1. Inspect active Bead and git status.
2. Update Bead notes with current state.
3. Record changed files and last verification.
4. Do not invent new work unless needed for resumption.
5. Stop at a safe boundary.

### `/work-status`

Read-only status.

Show:

- active epic / in-progress Beads;
- ready Beads;
- blocked Beads;
- git status;
- active subagent runs if available.

## Subagent Roles

### `bead-planner`

Allowed to mutate Beads. Not allowed to edit source.

Responsibilities:

- read the current planning Bead;
- read the master epic;
- create next 1-3 executable Beads;
- create decision Beads for uncertainty;
- add real dependencies only;
- close/update the planning Bead when durable Beads exist.

Output:

- created/updated Beads;
- dependencies added;
- decisions deferred;
- why the plan is now executable.

### `bead-worker`

Single writer for implementation.

Responsibilities:

- inspect Bead;
- claim it;
- inspect relevant context only;
- implement exactly that Bead;
- run Bead verification commands;
- update Bead notes with files changed and verification result;
- create discovered follow-up Beads when needed;
- never commit.

Stop if:

- acceptance is ambiguous;
- product/architecture decision is required;
- manual dirty changes conflict with work;
- verification cannot be run and no safe substitute exists.

### `bead-reviewer`

Read-only.

Responsibilities:

- inspect git diff;
- inspect Bead acceptance criteria;
- inspect worker verification result;
- report `PASS` or `FAIL`;
- if fail, give exact fix instructions or create/update a fix Bead.

No source edits.

### `bead-fixer`

Single writer for reviewer-identified issues only.

Responsibilities:

- fix only reviewer findings;
- do not expand scope;
- rerun verification;
- update Bead notes;
- hand back to reviewer.

### `bead-committer`

Commit and close gate.

Responsibilities:

- inspect `git status` and diff;
- confirm tests/verification passed;
- commit only related files;
- commit message: `<bead-id>: <summary>`;
- close Bead only after commit exists;
- push only when repo/session policy requires it.

## Manual Changes Handling

Manual edits should not break the orchestrator.

Before any worker starts:

1. Inspect `git status`.
2. If dirty files exist, classify them:
   - belong to current Bead: include and verify;
   - unrelated but safe: leave untouched;
   - conflict with current Bead: stop and ask;
   - completed work: create/update Bead and commit first.

Never overwrite manual changes silently.

## Resume Contract

A fresh session should be able to continue with only:

```bash
bd ready --json
bd list --status=in_progress --json
git status
```

No chat memory required.

Every worker/fixer/committer must update Beads enough that the next session knows:

- what was attempted;
- what changed;
- what verification ran;
- what failed;
- what remains;
- which Bead to pick next.

## Review Strategy

Default review loop:

```text
worker -> reviewer -> fixer if needed -> reviewer -> committer
```

For larger or risky Beads, reviewer can be a parent-orchestrated fanout:

- correctness/regression reviewer;
- tests/verification reviewer;
- simplicity/maintainability reviewer;
- security/performance/API reviewer only when relevant.

Keep writers single-threaded unless using isolated worktrees.

## Extension v2 Ideas

Only after MVP works.

Extension can add:

- `/work-*` native commands instead of prompt templates;
- Bead ID autocomplete;
- status widget for active epic/current Bead;
- persisted convenience pointer for `last` epic;
- pause/resume helpers;
- deterministic `bd` preflight checks;
- guardrails for dirty git state before worker runs;
- context-budget stop trigger.

Do not build a custom dashboard first. Plain Beads + git + prompts are enough to prove value.

## MVP Build Plan

1. Create package skeleton.
2. Add `work-orchestrator` skill with the loop, rules, and stop conditions.
3. Add prompt templates for `/work-small`, `/work-med`, `/work-big`, `/work-auto`, `/work-continue`, `/work-add`, `/work-status`, `/work-pause`.
4. Add five role agents.
5. Test in a disposable repo with Beads enabled.
6. Test interruption/resume.
7. Test manual dirty changes.
8. Test on RFLib only after the disposable repo works.
9. Add extension niceties only if prompt-template UX is not enough.

## Non-goals for MVP

- No custom TUI dashboard.
- No parallel writers in the same checkout.
- No separate task database.
- No markdown TODO ledger.
- No repo-specific logic.
- No plan docs as source of truth.

## Open Questions

- Exact Beads schema/conventions for epic membership and discovered-from links.
- Whether `last` should be inferred only from Beads or also cached by the extension.
- Whether commit/push behavior should be repo-policy-driven or command-flag-driven.
- Whether planner should use CE plan docs temporarily before transcribing to Beads.
- How much automatic classification `/work-auto` should do before asking the user.
