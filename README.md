# pi-work-orchestrator

Beads-backed Pi workflow package for running software work through short `/work-*` commands.

The package is intentionally boring: one skill, eight prompt templates, and five role subagents. Beads owns work state. Git owns code state. There is no package database.

## Install

From this repository:

```bash
pi install /absolute/path/to/pi-work-orchestrator
```

Required companion package and CLI:

```bash
pi install npm:pi-subagents
bd --help
```

Recommended for nicer confirmation prompts:

```bash
pi install npm:pi-ask-user
```

Target repositories must have Beads initialized before the workflow can mutate work state:

```bash
bd init
bd prime
```

## Commands

| Command | Use when | What it does |
| --- | --- | --- |
| `/work-small <task>` | Clear, low-risk work in one or two files | Creates/claims a Bead, implements, verifies, lightly reviews, commits, closes |
| `/work-med <task>` | Bounded work with a few choices | Creates a parent Bead and one to three executable child Beads, then works ready slices |
| `/work-big <task>` | Vague, cross-cutting, risky, or architectural work | Creates an epic and planning Bead, then runs planner before implementation |
| `/work-auto <task>` | You want the orchestrator to classify size | Routes to small, med, or big; asks before big or ambiguous work |
| `/work-continue [epic-id\|last]` | Resume durable work | Resolves state from Beads and runs one ready Bead at a time |
| `/work-add <task>` | Add urgent or discovered work mid-epic | Creates a Bead, adds dependency only if truly blocking, optionally runs it now |
| `/work-pause [note]` | Stop safely | Updates Bead notes with git status, changed files, verification, and next step |
| `/work-status [epic-id\|last]` | Inspect state | Read-only Beads, git, and subagent status summary |

## Source-of-truth rules

- Beads is the only durable work state: plans, acceptance, status, dependencies, discovered work, and resume notes.
- Git is the only code state: diffs, branches, commits, and changed files.
- Chat memory is not source of truth.
- Manual dirty changes are classified before writer agents run.
- Work happens one ready Bead at a time unless isolated worktrees are explicitly used.

## Role agents

| Agent | Writes source? | Commits? | Job |
| --- | --- | --- | --- |
| `bead-planner` | No | No | Creates executable Beads and decision Beads |
| `bead-worker` | Yes | No | Implements exactly one Bead and updates notes |
| `bead-reviewer` | No | No | Reports `PASS` or `FAIL` from diff, acceptance, and verification |
| `bead-fixer` | Yes | No | Fixes reviewer-identified issues only |
| `bead-committer` | No | Yes | Verifies, commits related files, then closes the Bead |

## Verify this package

```bash
npm run verify
```

The verifier checks package manifest paths, prompt routing, skill coverage, role-agent boundaries, and MVP non-goals.

## Disposable repo smoke test

After static verification passes, test behavior in a throwaway repo:

```bash
mkdir /tmp/wo-smoke && cd /tmp/wo-smoke
git init
bd init
pi -e /absolute/path/to/pi-work-orchestrator
```

Then try:

```text
/work-small add a README with one sentence
/work-status
/work-pause smoke test checkpoint
```

## MVP limits

- No TypeScript extension.
- No custom dashboard.
- No push automation by default.
- No parallel writers in one checkout.
- No package-owned task database.
- No markdown TODO ledger as source of truth.

Add an extension later only if prompt templates plus the shared skill are not enough.
