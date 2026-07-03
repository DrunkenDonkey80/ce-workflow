# pi-work-orchestrator

Beads-backed Pi workflow package for running software work through short `/work-*` commands.

The package is intentionally boring: one skill, one tiny settings extension, eleven prompt templates, and six role subagents. Beads owns work state. Git owns code state. There is no package database.

## Install

From this repository:

```bash
pi install /absolute/path/to/pi-work-orchestrator
```

Required companion packages and CLI:

```bash
pi install npm:pi-subagents
pi install npm:pi-compound-engineering
bd --help
```

Recommended, optional companions:

```bash
pi install npm:pi-ask-user    # nicer confirmation prompts
pi install npm:pi-intercom    # child agents can ask the parent session for decisions
```

Target repositories must have Beads initialized before the workflow can mutate work state:

```bash
git init
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
| `/work-debug <bug>` | Failing test, error, regression, or broken behavior | Creates a bug Bead, runs `ce-debug` through `bead-debugger`, verifies, and compounds reusable lessons |
| `/work-auto <task>` | You want the orchestrator to classify size | Routes to small, med, debug, big, or master; asks before big/master/ambiguous work |
| `/work-resume [epic-id\|last]` | Resume latest master epic work | Resolves state from Beads; if unclear, lists active not-completed epics to pick from |
| `/work-continue [epic-id\|last]` | Legacy resume alias | Same as `/work-resume` |
| `/work-add <task>` | Add urgent or discovered work mid-epic | Creates a Bead, adds dependency only if truly blocking, optionally runs it now |
| `/work-pause [note]` | Stop safely | Updates Bead notes with git status, changed files, verification, and next step |
| `/work-status [epic-id\|last]` | Inspect state | Read-only Beads, git, and subagent status summary |
| `/work-models [status\|reset]` | Pick role models/effort | Extension command with searchable model list; persists overrides to `.pi/settings.json` |

## Mental model

1. `/work-master` creates the durable epic/master plan.
2. `/work-big`, `/work-med`, `/work-small`, `/work-debug`, and `/work-add` operate inside that epic.
3. Ready Beads move through role agents: planner → worker/debugger → reviewer → fixer if needed → committer.
4. `/work-resume` rebuilds state from Beads and git, not chat history.
5. `/work-pause` writes a checkpoint into Beads so any future session can continue.

## Source-of-truth rules

- Beads is the only durable work state: master plans, acceptance, status, dependencies, discovered work, and resume notes.
- Git is the only code state: diffs, branches, commits, and changed files.
- Chat memory is not source of truth.
- Manual dirty changes are classified before writer agents run.
- Project verification contracts from `AGENTS.md`/docs are copied into Bead acceptance and enforced before close.
- Work happens one ready Bead at a time unless isolated worktrees are explicitly used.

## Master plan epics

For brainstorm-driven work, use `/work-master` with the brainstorm path or request:

```text
/work-master plan docs/brainstorms/example.md into a detailed master plan for slicing later
```

The orchestrator runs `ce-plan` when a detailed master plan does not already exist and tells it to auto-accept plan creation unless a real human decision is needed. It then creates an epic Bead with the plan summary/scope in `description`, key decisions and implementation units in `design`, acceptance and verification in `acceptance`, and source paths in `notes`. Later `bead-planner` slices that epic into one to three executable Beads at a time. The other `/work-*` commands add or execute work inside an existing epic.

## Start-to-completion example

Fresh repo:

```bash
mkdir habit-app && cd habit-app
git init
bd init
pi
```

In Pi:

```text
/work-master Build a tiny CLI habit tracker. It should add habits, list habits, mark done today, and show streaks. Keep storage local and simple.
```

What happens:

1. `work-orchestrator` primes Beads and checks git.
2. `ce-plan` turns the idea into a concrete master plan and auto-accepts plan creation unless a real decision is needed.
3. An epic Bead is created with scope, design, acceptance, and verification.
4. A planning Bead is created under the epic.
5. `bead-planner` creates one to three child task Beads under the epic.
6. `/work-resume` starts executing ready work.
7. `bead-worker` implements one Bead.
8. `bead-reviewer` checks diff, acceptance, and verification evidence.
9. `bead-fixer` fixes reviewer failures when needed.
10. `bead-committer` commits related files with `<bead-id>: <summary>` and closes the Bead.
11. The loop repeats until no ready work remains or a stop condition needs the user.

Check progress any time:

```text
/work-status
```

Continue later, even in a fresh Pi session:

```text
/work-resume last
```

## Working inside an existing epic

Once an epic exists, add work at the right size:

```text
/work-small Add --help output for the CLI
/work-med Add JSON export and import commands
/work-big Add sync support, but first split it into safe slices
/work-debug selfcheck fails when marking the same habit twice
```

`/work-big` does **not** create a new epic. It creates a planning Bead under the active epic and asks `bead-planner` to slice it.

## Insert work mid-flow

When a task appears while work is already underway:

```text
/work-add Add a migration note for the new habits.json format
```

The orchestrator creates a child Bead under the current epic with `discovered-from:<current-bead-id>` in notes. It only adds a dependency if the new work actually blocks current or future work.

If it is urgent and should run now:

```text
/work-add Do the migration note now because the next task depends on it
```

After the inserted Bead closes, resume the original epic:

```text
/work-resume last
```

## Pause, stop, and resume

Pause at a safe boundary:

```text
/work-pause leaving for now; next run should continue export tests
```

The pause records current Bead, git status, changed files, last verification, failures, and next step in Beads notes. It does not invent new work.

Resume later:

```text
/work-resume
```

If there is exactly one active not-completed epic, it continues. If several epics are active, the orchestrator lists them and asks which to resume:

```text
/work-resume wo-abc123
```

`/work-continue` is kept as a legacy alias for `/work-resume`.

## Optional intercom coordination

`pi-intercom` is optional. Without it, the workflow still works: children persist blockers in Beads and stop safely.

With `pi-intercom` installed, `pi-subagents` can give child agents a private `contact_supervisor` channel back to the parent Pi session. The child uses it only when it should not guess:

- `reason: "need_decision"` — blocking product, architecture, scope, hardware, verification, or dirty-worktree decision.
- `reason: "progress_update"` — short non-blocking update when discovery changes the plan.

Example request:

```text
/work-resume last
```

If a worker discovers a product choice, the parent receives the question. Reply in the parent session:

```text
Use the simpler local-file format. Do not add sync yet.
```

The parent records the answer in Beads notes and resumes the role loop. If messages do not appear, run:

```text
/subagents-doctor
```

## Debugging flow

Use `/work-debug` for failures, regressions, stack traces, or broken behavior:

```text
/work-debug npm run selfcheck fails after adding the export command
```

The bug Bead goes through `bead-debugger`, which follows `ce-debug` discipline: reproduce first, root-cause second, fix third, verify last. Non-trivial reusable debugging lessons trigger `ce-compound mode:headless` after the fix commit.

## Role agents

| Agent | Writes source? | Commits? | Job |
| --- | --- | --- | --- |
| `bead-planner` | No | No | Creates executable Beads and decision Beads |
| `bead-worker` | Yes | No | Implements exactly one Bead and updates notes |
| `bead-reviewer` | No | No | Reports `PASS` or `FAIL` from diff, acceptance, and verification |
| `bead-debugger` | Yes | No | Uses `ce-debug` to reproduce, root-cause, fix, verify, and request learning capture |
| `bead-fixer` | Yes | No | Fixes reviewer-identified issues only |
| `bead-committer` | No | Yes | Verifies, commits related files, then closes the Bead |

## Verification contracts

Put project-specific must-run checks in `AGENTS.md` or referenced test docs. The orchestrator treats concrete rules as a contract and copies them into epic/child Bead acceptance. Example:

```markdown
For affected hardware modules, run the real hardware smoke test on the module before closing work. Record the module ID, command, and observed result in Bead notes. Do not substitute mocks unless the user approves.
```

Workers run that contract, reviewers check evidence, and committers refuse to close when evidence is missing.

## Model and effort tuning

Use `/work-models` for the easy path: pick `brainstorm/plan`, `work`, `debug`, `review`, or `commit`, then choose a searchable available model list and effort. Blank model means “inherit the current control-session model.” Blank effort means “use the role default.” Settings persist in `.pi/settings.json`.

Role prompts set effort defaults: planner/debugger high, worker/fixer/reviewer medium, committer low. `/work-models` writes the same `subagents.agentOverrides` settings you can edit by hand:

```json
{
  "subagents": {
    "agentOverrides": {
      "bead-worker": { "model": "anthropic/claude-sonnet-4", "thinking": "medium" },
      "bead-committer": { "thinking": "low" }
    }
  }
}
```

Use low/minimal effort for disposable smoke-test Pi instances. Keep your control session on a frontier model for `/work-master`/`ce-plan` if you want deep planning, then set `work` to a local model to save tokens.

## Verify this package

```bash
npm run verify
```

The verifier checks package manifest paths, prompt routing, skill coverage, role-agent boundaries, CE integration hooks, optional `pi-intercom` policy, and MVP non-goals.

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
/work-master Build a one-file notes CLI with add/list commands
/work-status
/work-add Add --version output
/work-pause smoke test checkpoint
/work-resume last
```

## MVP limits

- No custom dashboard.
- No push automation by default.
- No parallel writers in one checkout.
- No package-owned task database.
- No markdown TODO ledger as source of truth.
- No mandatory `pi-intercom`; it is used when installed, with Beads as the fallback.
- No `ce-compound` on routine small tasks; it runs only for big/master/debug work with reusable learning.
- No provider-specific model IDs baked into the package; use `/work-models` or Pi settings overrides.
