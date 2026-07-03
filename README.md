# pi-work-orchestrator

Beads-backed Pi workflow package for running software work through short `/work-*` commands.

The package is intentionally boring: one skill, ten prompt templates, and five role subagents. Beads owns work state. Git owns code state. There is no package database.

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
| `/work-master <brainstorm-or-plan>` | New brainstorm, idea, or master plan | Runs `ce-plan` when needed, saves the master plan into an epic Bead, then creates planning/slice Beads |
| `/work-small <task>` | Clear, low-risk work in one or two files inside an epic | Creates/claims a Bead, implements, verifies, lightly reviews, commits, closes |
| `/work-med <task>` | Bounded work inside an epic with a few choices | Creates a parent Bead and one to three executable child Beads, then works ready slices |
| `/work-big <task>` | Large, risky, or architectural slice inside an epic | Creates a planning Bead under the active epic, then slices it before implementation |
| `/work-auto <task>` | You want the orchestrator to classify size | Routes to small, med, big, or master; asks before big/master/ambiguous work |
| `/work-resume [epic-id\|last]` | Resume latest master epic work | Resolves state from Beads; if unclear, lists active not-completed epics to pick from |
| `/work-continue [epic-id\|last]` | Legacy resume alias | Same as `/work-resume` |
| `/work-add <task>` | Add urgent or discovered work mid-epic | Creates a Bead, adds dependency only if truly blocking, optionally runs it now |
| `/work-pause [note]` | Stop safely | Updates Bead notes with git status, changed files, verification, and next step |
| `/work-status [epic-id\|last]` | Inspect state | Read-only Beads, git, and subagent status summary |

## Source-of-truth rules

- Beads is the only durable work state: master plans, acceptance, status, dependencies, discovered work, and resume notes.
- Git is the only code state: diffs, branches, commits, and changed files.
- Chat memory is not source of truth.
- Manual dirty changes are classified before writer agents run.
- Work happens one ready Bead at a time unless isolated worktrees are explicitly used.

## Master plan epics

For brainstorm-driven work, use `/work-master` with the brainstorm path or request:

```text
/work-master plan docs/brainstorms/example.md into a detailed master plan for slicing later
```

The orchestrator runs `ce-plan` when a detailed master plan does not already exist, then creates an epic Bead with the plan summary/scope in `description`, key decisions and implementation units in `design`, acceptance and verification in `acceptance`, and source paths in `notes`. Later `bead-planner` slices that epic into one to three executable Beads at a time. The other `/work-*` commands add or execute work inside an existing epic.

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
