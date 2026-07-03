# pi-work-orchestrator

Beads-backed Pi workflow package for running software work through short `/work-*` commands.

The package is intentionally boring: one skill, one tiny settings/status extension, eleven prompt templates, and seven role subagents. Beads owns work state. Git owns code state. There is no package database.

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
| `/work-migrate <sources>` | Existing plans, TODOs, tracker exports, partial implementations, or branches | Imports legacy state into one epic plus child Beads without editing code or changing branches |
| `/work-small <task>` | Clear, low-risk work in one or two files inside an epic | Creates/claims a Bead, implements, verifies, lightly reviews, commits, closes |
| `/work-med <task>` | Bounded work inside an epic with a few choices | Creates a parent Bead and one to three executable child Beads, then works ready slices |
| `/work-big <task>` | Large, risky, or architectural slice inside an epic | Creates a planning Bead under the active epic, then slices it before implementation |
| `/work-debug <bug>` | Failing test, error, regression, or broken behavior | Creates a bug Bead, runs `ce-debug` through `bead-debugger`, verifies, and compounds reusable lessons |
| `/work-auto <task>` | You want the orchestrator to classify size | Routes to small, med, debug, big, master, or migrate; asks before big/master/migrate/ambiguous work |
| `/work-resume [epic-id\|last]` | Resume epic work | Resolves state from Beads, handles one executable Bead, then stops with status and the next resume command |
| `/work-continue [epic-id\|last]` | Legacy resume alias | Same as `/work-resume` |
| `/work-add <task>` | Add urgent or discovered work mid-epic | Creates a Bead, adds dependency only if truly blocking, optionally runs it now |
| `/work-pause [note]` | Stop safely | Updates Bead notes with git status, changed files, verification, and next step |
| `/work-status [epic-id\|last]` | Inspect state | Extension command: cheap deterministic Beads/git status with epic title, progress %, ready/in-progress/planned/decision counts, and next command |
| `/work-context [status\|compact\|on\|off\|set <tokens>]` | Prevent context rot | Extension command and hook for proactive instant compaction; no extra LLM call, drops reasoning/full tool logs |
| `/work-models [status\|reset]` | Pick role models/effort | Extension command with model/effort picker; persists overrides to `.pi/settings.json` |

## Mental model

1. `/work-master` creates the durable epic/master plan.
2. `/work-migrate` converts existing partial project state into an epic when work did not start in this system.
3. `/work-big`, `/work-med`, `/work-small`, `/work-debug`, and `/work-add` operate inside that epic.
4. Ready Beads move through role agents: planner → worker/debugger → reviewer → fixer if needed → committer. The planner verifies dependency direction with `bd ready --json`; the parent orchestrator coordinates and should not become the worker.
5. `/work-resume` rebuilds state from Beads and git, not chat history, and stops after one executable Bead; if it only had to create new slices, planning is the one task and implementation starts on the next resume.
6. `/work-status` is the cheap dashboard; it does not ask the LLM when the extension command is loaded.
7. `/work-context` proactively compacts before context rot; Beads/git keep durable state, compacted chat keeps only visible goals/state.
8. `/work-pause` writes a checkpoint into Beads so any future session can continue.

## Source-of-truth rules

- Beads is the only durable work state: master plans, acceptance, status, dependencies, discovered work, and resume notes.
- Git is the only code state: diffs, branches, commits, and changed files.
- Chat memory is not source of truth.
- One executable Bead is the default session boundary: close/commit/checkpoint it, then run `/work-resume <epic-id>` again from a fresh Pi session.
- Manual dirty changes are classified before writer agents run.
- Use `git status --porcelain=v1 --untracked-files=all` and `git diff --name-only`; do not treat human diff/stat summaries like `1 -0` as file content.
- Known-unrelated dirty files are passed to children as an allowlist, and unrelated whitespace-only scratch in tracked instruction files is restored before spawning children when it is clearly not user work.
- Project verification contracts from `AGENTS.md`/docs are copied into Bead acceptance and enforced before close.
- Work happens one ready Bead at a time unless isolated worktrees are explicitly used.

## Live/test feedback loop

Whenever a disposable or real project run exposes workflow friction, feed it back into this package before calling the run done. Ask: what small `ce-workflow` change would prevent this class of failure next time? Apply the safe fix here, or record a concrete follow-up.

Recent examples this package now handles:

- repeated dirty-file stop loops from whitespace-only `AGENTS.md` changes, including child-created instruction-file dirt at startup or after review/fix runs;
- agents misreading `git diff --stat`/numstat lines as source content;
- delayed/stale intercom asks after the Bead was already closed;
- workers/fixers closing Beads before review and commit;
- unnecessary committer-agent spawn when the parent can run the deterministic commit gate.

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
6. `/work-resume` starts executing one ready Bead.
7. `bead-worker` implements that Bead.
8. `bead-reviewer` checks diff, acceptance, and verification evidence.
9. `bead-fixer` fixes reviewer failures when needed.
10. `bead-committer` commits related files with `<bead-id>: <summary>` and closes the Bead.
11. The run prints status and the next `/work-resume <epic-id>` command. Start a fresh Pi session for the next slice.
12. If no ready Bead exists but the epic is not complete, `/work-resume` asks `bead-planner` to compare the epic plan against existing children and create the next one to three slices instead of declaring done.

Check progress any time:

```text
/work-status
```

Continue later, even in a fresh Pi session:

```text
/work-resume last
```

When there is no obvious latest epic, `/work-resume` lists active epics with created date, last worked date, status, child counts, and one-line description so you can pick.

`/work-status` reports the same state without spending agent context: current epic title/status, closed slices over total slices, percent complete, ready/in-progress/planned-ahead/open-decision counts, git state, and the next command.

## Context management

The package installs `/work-context`, but it does not pre-prompt compact normal chats by default. Pi's native/ultracompact auto-compaction can keep running normally. If you explicitly enable the work guard, it checks at turn boundaries and compacts at 150k tokens (capped by the active model window). `/work-context compact` and opted-in work guard compactions use an instant local summary instead of another LLM call.

Useful commands:

```text
/work-context status
/work-context compact
/work-context set 150000
/work-context off
```

Settings are optional and live in `.pi/settings.json`:

```json
{
  "workOrchestrator": {
    "context": {
      "enabled": true,
      "autoCompact": false,
      "compactAtTokens": 150000,
      "keepRecentTokens": 30000,
      "maxSummaryChars": 24000
    }
  }
}
```

Pi keeps the recent suffix according to `compaction.keepRecentTokens`; `/work-context on` writes at least 30k there. Use fresh sessions between Beads anyway; compacting keeps long single-Bead debug/review loops from rotting, not a reason to run an entire epic in one chat.

## Migrating existing projects

Use `/work-migrate` when a project already has plans, TODOs, old tracker exports, partial implementation, or unmerged branches from another workflow:

```text
/work-migrate Take docs/roadmap.md, TODO.md, and branches feature/importer and ui-redesign. Convert what is already done and what remains into one epic.
```

What migration does:

1. Reads the named artifacts plus relevant README/docs.
2. Inspects git read-only: current branch, all branches by recent activity, and recent decorated history.
3. Creates or reuses one epic with provenance notes: artifacts read, branches inspected, current branch, base branch assumption, and migration date.
4. Creates closed child Beads only when evidence is strong: artifact says done and code/commit/test evidence supports it.
5. Creates open task/bug Beads for remaining work.
6. Creates decision Beads for unclear ownership, product choices, or conflicting evidence.
7. Represents unmerged/stale branches as review or integration Beads; it never checks out, merges, rebases, or deletes branches.
8. Recommends `/work-resume <epic-id>` when migration is complete.

Git log is evidence, not truth. The migrator does not create one Bead per commit.

For a clean CE brainstorm or plan with no partial implementation to reconcile, skip migration and use:

```text
/work-master docs/brainstorms/my-feature.md
# or
/work-master docs/plans/my-feature-plan.md
```

Then continue:

```text
/work-resume <epic-id>
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

The parent records the answer in Beads notes and resumes the role loop. If a delayed ask appears after a run already completed, first check pending state:

```text
intercom({ action: "pending" })
```

If there is no pending ask, the Bead is closed, or the child run already exited, treat it as stale intercom and do not restart work. If messages do not appear, run:

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
| `bead-migrator` | No | No | Imports legacy artifacts, completed work evidence, remaining tasks, and branch review needs into Beads |
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

Use `/work-models` for the easy path: pick `brainstorm/plan/migration`, `work`, `debug`, `review`, or `commit`, then choose from available models and effort levels. Blank model means “inherit the current control-session model.” Blank effort means “use the role default.” Settings persist in `.pi/settings.json`.

Role prompts use fresh child context by default and concise/file-artifact outputs so the parent session does not inherit every tool log or full master plan. The orchestrator must launch the exact package agents (`bead-worker`, `bead-reviewer`, etc.), not builtin stand-ins like `worker`; if `pi-subagents` is unavailable it stops with a setup blocker instead of implementing in the control chat. Role prompts set effort defaults: migrator/planner/debugger high, worker/fixer/reviewer medium, committer low. `/work-models` writes the same `subagents.agentOverrides` settings you can edit by hand:

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

`/work-context` is separate from model choice. It is on by default and uses no model call for its compact summary.

## Verify this package

```bash
npm run verify
```

The verifier checks package manifest paths, prompt routing, skill coverage, role-agent boundaries, migration policy, CE integration hooks, optional `pi-intercom` policy, and MVP non-goals.

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
/work-migrate README.md and git history into one epic, marking only strongly evidenced completed work as closed
/work-master Build a one-file notes CLI with add/list commands
/work-status
/work-add Add --version output
/work-pause smoke test checkpoint
/work-resume last
```

From Git Bash, disable MSYS path conversion when using non-interactive slash commands, or `/work-resume` can be rewritten into `C:/Program Files/Git/work-resume` before Pi receives it:

```bash
MSYS_NO_PATHCONV=1 pi --effort high -p "/work-resume last"
```

## MVP limits

- No custom dashboard.
- No push automation by default.
- No parallel writers in one checkout.
- No package-owned task database.
- No markdown TODO ledger as source of truth.
- No automatic branch checkout, merge, rebase, or deletion during migration.
- No mandatory `pi-intercom`; it is used when installed, with Beads as the fallback.
- No `ce-compound` on routine small tasks; it runs only for big/master/debug work with reusable learning.
- No provider-specific model IDs baked into the package; use `/work-models` or Pi settings overrides.
- No external ultracompact dependency; the built-in `/work-context` guard is intentionally smaller.
