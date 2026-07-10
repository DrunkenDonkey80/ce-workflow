# pi-work-orchestrator

Beads-backed Pi workflow package for running software work through short `/work-*` commands.

The package is intentionally boring: one core workflow skill, one autopilot wrapper skill, one tiny workflow extension, seventeen prompt templates, and seven role subagents. Beads owns work state. Git owns code state. There is no package database.

## Install

From this repository:

```bash
pi install /absolute/path/to/pi-work-orchestrator
```

Required companion packages and CLI:

```bash
pi install npm:pi-subagents
pi install npm:pi-compound-engineering
pi install npm:pi-ask-user
npm install -g @beads/bd
bd --help
```

On Windows, the extension resolves the npm `bd.cmd` shim to the underlying
`@beads/bd` Node entrypoint so `/work-init` works from Pi without a shell
wrapper.

Recommended, optional companions:

```bash
pi install npm:pi-intercom    # child agents can ask the parent session for decisions
```

Target repositories can be bootstrapped from Pi:

```text
/work-init
# or just
/work-plan <idea-or-plan-file>
```

The workflow initializes Beads with `bd init --non-interactive --skip-agents` so target projects do not get generic Beads AGENTS.md noise.

## Commands

| Command | Use when | What it does |
| --- | --- | --- |
| `/work-init` | Repo has no Beads workspace yet | Extension command: runs `bd init --non-interactive --skip-agents` only when needed |
| `/work-plan [epic-id\|idea-or-plan-file]` | New idea, brainstorm, roadmap, or master plan | Extension command: initializes Beads if needed, plans from raw input or an epic-linked brainstorm, then creates an epic from the produced master roadmap plan |
| `/work-ideate [target action\|topic]` | Capture, list, inspect, accept, reject, discuss, or import ideas | Extension command: shows Beads-backed ideas, guards numeric indexes, and mutates only the resolved idea |
| `/work-brainstorm [idea <target>\|topic] [path]` | Brainstorm an idea or topic without losing lineage | Extension command: initializes Beads when needed, creates a standalone brainstorm epic if no active epic exists, links artifacts to exact idea records, and reports near-duplicates instead of fuzzy merging |
| `/work-master <brainstorm-or-plan>` | Legacy alias | Same as `/work-plan` |
| `/work-migrate <sources>` | Existing plans, TODOs, tracker exports, partial implementations, or branches | Extension command: normalizes migration sources and hands them to `bead-migrator` without editing code or changing branches |
| `/work-small <task>` | Clear, low-risk work in one or two files inside an epic | Extension command: creates one child Bead, then hands it to the implementation role loop |
| `/work-med <task>` | Bounded work inside an epic with a few choices | Extension command: creates one planning Bead for one executable child by default, then hands it to `bead-planner` |
| `/work-big <task>` | Large, risky, or architectural slice inside an epic | Extension command: creates one planning Bead for deeper slicing, then hands it to `bead-planner` |
| `/work-debug <bug-or-bead-id\|symptom[: guidance]>` | Failing test, blocked/debug-needed Bead, regression, or broken behavior | Extension command: resolves/reuses or creates a debug Bead, then hands that compact state to the existing debug role loop |
| `/work-auto <task>` | You want the orchestrator to classify size | Extension command: rejects empty input, routes explicit blocked/debug-needed Beads to debug, otherwise hands unchanged text to the auto skill path |
| `/work-resume [repo-path\|instruction]` | Resume autonomous project work | Extension command: starts/resumes a `/work-goal` project loop from Beads/git state. With no path it uses the current repo; plain text becomes the constraint. Self-improving ce-workflow fixes are opt-in via `.pi/settings.json` `workResume.selfImproving` |
| `/work-catch-up [focus]` | Self-improving mode is on and this package should catch up to upstream Pi/CE/subagent changes | Extension command: compares the recorded release baseline in `extensions/work-catch-up-baseline.json` with current package versions, writes diff artifacts, then starts a self-improving `/work-goal` only when something changed |
| `/work-resume-stop [reason]` | Stop overnight/autonomous work cleanly | Marks the active `/work-resume` loop as stopping, asks the agent to checkpoint and stop at the next safe phase boundary, then leaves it resumable with `/work-resume` |
| `/work-menu` | Open the small work menu | Extension command/shortcut target for resume, stop, roadmap, status, and report |
| `/work-add [--epic <id>] [--blocked-by <bead-id>] <task>` | Add urgent or discovered work mid-epic | Extension command: creates one child Bead under an unambiguous epic and adds only explicit `--blocked-by` dependencies |
| `/work-pause [note]` | Stop safely | Extension command: appends a deterministic checkpoint with git files, verification, failures, remaining work, and next step |
| `/work-report [epic-id\|last\|bead-id] [--json]` | Human handoff for blockers | Extension command: deterministic blocked/debug-needed Bead report, failure artifacts, dependencies, suggested debug commands, and optional JSON |
| `/work-roadmap [list\|tasks\|plan\|set-current\|close\|reopen]` | Manage roadmap epics | Extension command: fast epic picker, task submenu with summaries, linked brainstorm/plan handoff, blocker debug handoff, and explicit-only close/reopen |
| `/work-telemetry [today\|all\|epic <id>\|bead <id>] [--json]` | See timing/token/context cost | Extension command: summarizes `.pi/work-runs/*.jsonl` without an LLM |
| `/work-usage [today\|all\|epic <id>\|bead <id>] [--open\|--jsonl]` | Write a usage report | Extension command: writes escaped sortable/filterable HTML under `.pi/work-runs/usage/` and prints the path; `--open` launches it; `--jsonl` prints machine-readable rows without HTML |
| `/work-finish <bead-id\|epic-id>` | Classify commit/close readiness | Extension command: checks PASS review, verification evidence, related dirty files, and emits a deterministic commit-ready or stop state |
| `/work-status [epic-id\|last]` | Inspect state | Extension command: cheap deterministic Beads/git status with epic title, progress %, ready/in-progress/planned/decision counts, and next command |
| `/work-goal [--tokens 100k] <objective>` | Run a raw autonomous goal | Extension command: appends goal-management rules, microcompacts before continuations, retries transient provider/context errors, caps optional token budgets, rejects contradictory completion summaries, auto-consumes clear-winner questions, and pauses on human-decision blockers |
| `/work-context [status\|compact\|on\|off\|set <tokens>]` | Prevent context rot | Extension command and hook for proactive instant compaction; no extra LLM call, drops reasoning/full tool logs |
| `/work-models [status\|reset]` | Pick role models/effort | Extension command with model/effort picker; persists overrides to `.pi/settings.json` |
| `/work-settings [status]` | Settings submenu | Extension command: effort profiles (low/medium/high/max), role + advisor model/effort, and advisor/critic gates; enter flips booleans live |

## Mental model

1. `/work-plan` initializes the workflow when needed, wraps `ce-plan`, and creates the durable epic/master plan. `/work-master` is a legacy alias.
2. `/work-ideate` keeps idea records in Beads so accepted, contender, rejected, discussed, brainstormed, and planned ideas stay visible without becoming executable work.
3. `/work-brainstorm` links brainstorm artifacts and later plans back to idea records instead of relying on chat history. In a fresh repo or unrelated context with no active epic, it creates a standalone brainstorm epic first.
4. `/work-usage` turns existing telemetry into a local HTML report without creating another source of truth; pass `--jsonl` for agent-readable rows or `--open` only when you want a browser.
5. `/work-migrate` converts existing partial project state into an epic when work did not start in this system.
6. `/work-big`, `/work-med`, `/work-small`, `/work-debug`, and `/work-add` operate inside that epic.
7. Ready Beads move through role agents: planner → worker/debugger → reviewer → fixer if needed → committer. The planner verifies dependency direction with `bd ready --json`; the parent orchestrator coordinates and should not become the worker.
8. Roadmap epics are not auto-closed. When a roadmap looks complete, use `/work-roadmap close <epic-id>`; unresolved child Beads require confirmation or `--force`.
9. `/work-resume` is the project autopilot entrypoint. It targets the current repo by default, or a path when the first argument is an existing path, then continues from Beads/git state until done or a real human decision is needed.
10. `/work-small`, `/work-med`, `/work-big`, `/work-plan`, `/work-master`, and `/work-migrate` now do deterministic start-gate intake in extension code; role agents still execute planning, migration, implementation, review, and commits.
11. `/work-debug`, `/work-add`, and `/work-pause` now do deterministic Beads/git intake in extension code; role agents still execute debugging, implementation, review, and commits.
12. `/work-finish` classifies whether reviewed work is commit-ready; it does not auto-commit.
13. `/work-status` is the cheap dashboard; it does not ask the LLM when the extension command is loaded.
14. `/work-report` is the deterministic human handoff view for blocked/debug-needed work and failure artifacts; `--json` emits the same computed state for automation.
15. `/work-telemetry` records command/agent wall time, assistant token usage when exposed by Pi, context token snapshots, tool/subagent durations, and backing artifact files in `.pi/work-runs/*.jsonl`. Repeated `/work-resume` blocked reports for the same blocker are deduped for one hour to keep continuation loops from bloating telemetry; set `WORK_ORCH_TELEMETRY_BLOCKED_DEDUPE_MINUTES=0` or `WORK_ORCH_TELEMETRY_DEDUPE_OFF=1` to capture every blocked poll. Set `WORK_ORCH_TELEMETRY_NOTES=1` only if you also want one-line Bead note pointers.
16. `/work-usage` reads those same files and writes local HTML under `.pi/work-runs/usage/`; generated reports stay ignored by git and only open in a browser with `--open`. Use `--jsonl` for agent/subagent consumption.
17. `/work-goal` runs a session-scoped autonomous loop with scoped human-decision stops, `/work-context` microcompaction before continuations, retryable provider/context-error recovery, optional `--tokens` budgets, and contradictory-completion rejection; `/work-resume` wraps it with project-autopilot rules and optional self-improvement pressure.
18. `/work-context` proactively compacts before context rot; Beads/git keep durable state, compacted chat keeps only visible goals/state.
19. `/work-pause` writes a checkpoint into Beads so any future session can continue.

## Source-of-truth rules

- Beads is the only durable work state: master plans, acceptance, status, dependencies, discovered work, and resume notes.
- Git is the only code state: diffs, branches, commits, and changed files.
- Chat memory is not source of truth.
- One executable Bead is the default session boundary: close/commit/checkpoint it, then run `/work-resume` again from a fresh Pi session.
- Manual dirty changes are classified before writer agents run.
- Use `git status --porcelain=v1 --untracked-files=all` and `git diff --name-only`; do not treat human diff/stat summaries like `1 -0` as file content.
- Known-unrelated dirty files are passed to children as an allowlist, and unrelated whitespace-only scratch in tracked instruction files is restored before spawning children when it is clearly not user work.
- Project verification contracts from project instructions/docs are copied into Bead acceptance and enforced before close.
- Do not mutate workflow Beads directly in normal use; use `/work-*` commands or the dedicated role agents.
- Failed verification or failed live/product evidence is recorded as a failure artifact in Bead notes, then linked to a `wo:debug` bug or `wo:blocked` decision path instead of being left in chat.
- Work happens one ready Bead at a time unless isolated worktrees are explicitly used.

## Live/test feedback loop

Whenever a disposable or real project run exposes workflow friction, feed it back into this package before calling the run done. Ask: what small `ce-workflow` change would prevent this class of failure next time? Apply the safe fix here, or record a concrete follow-up.

Recent examples this package now handles:

- hardware smoke where the harness passes but product evidence is `terminal-failed`/`hardware-blocked`, requiring a follow-up debug Bead before dependent work proceeds;
- repeated dirty-file stop loops from whitespace-only `AGENTS.md` changes, including child-created instruction-file dirt at startup or after review/fix runs;
- agents misreading `git diff --stat`/numstat lines as source content;
- delayed/stale intercom asks after the Bead was already closed;
- workers/fixers closing Beads before review and commit;
- unnecessary committer-agent spawn when the parent can run the deterministic commit gate.

## Master plan epics

For brainstorm-driven work, use `/work-plan` with the brainstorm epic, brainstorm path, or request:

```text
/work-plan E-123 fork
/work-plan docs/brainstorms/example.md
/work-plan Build a small CLI from this description...
```

The orchestrator runs `ce-plan` when a detailed master plan does not already exist and tells it to write a new plan for non-plan sources instead of reusing an older weaker plan. It preserves every source decision instead of compressing the brainstorm into a vague summary. Any authoritative reference or target behavior becomes a generic Acceptance Contract: source, must-match invariants, must-not regressions, proof artifacts/checks, and approval path. Plan self-audit findings must become plan fixes, blocking questions, decision/blocker Bead instructions, or explicit waivers — not passive risk prose; `/work-plan` repeats that hardening loop until no blocking uncertainty remains. It then creates an epic Bead with the plan summary/scope in `description`, the full plan stored via `design`, acceptance and verification in `acceptance`, and source paths in `notes`. Later `bead-planner` usually slices that epic into one executable Bead at a time, creating up to three only when the next steps are obvious and low-risk. The other `/work-*` commands add or execute work inside an existing epic.

## Start-to-completion example

Fresh repo:

```bash
mkdir habit-app && cd habit-app
git init
pi
```

In Pi:

```text
/work-plan Build a tiny CLI habit tracker. It should add habits, list habits, mark done today, and show streaks. Keep storage local and simple.
```

What happens:

1. `work-orchestrator` initializes Beads if needed and checks git.
2. `ce-plan` turns the idea into a concrete master plan and auto-accepts plan creation unless a real decision is needed.
3. An epic Bead is created with scope, full plan design, acceptance, and verification.
4. A planning Bead is created under the epic.
5. `bead-planner` creates the next child task Bead under the epic, or up to three only for obvious low-risk sequences.
6. `/work-resume` starts executing one ready Bead.
7. `bead-worker` implements that Bead.
8. `bead-reviewer` checks diff, acceptance, and verification evidence.
9. `bead-fixer` fixes reviewer failures when needed.
10. `bead-committer` commits related files with `<bead-id>: <summary>` and closes the Bead.
11. The run prints status and the next `/work-resume` command. Start a fresh Pi session for the next slice.
12. If no ready Bead exists but the epic is not complete, `/work-resume` asks `bead-planner` to compare the epic plan against existing children and create the next executable slice instead of declaring done.

Check progress any time:

```text
/work-status
```

Continue later, even in a fresh Pi session:

```text
/work-resume
```

When you need to constrain the next run, add plain text after the command, for example `/work-resume finish U3 only`.

`/work-status` reports the same state without spending agent context: current epic title/status, closed slices over total slices, percent complete, ready/in-progress/planned-ahead/open-decision counts, git state, and the next command. Use `/work-report <epic-id>` when a human needs the full blocker ledger without spending agent context: blocked/debug-needed Beads, failure artifacts, artifact paths, dependencies, and suggested `/work-debug <bead-id>: <guidance>` commands. Add `--json` for the machine-readable state that future resume automation can reuse. Use `/work-telemetry today` or `/work-telemetry epic <id>` to see which commands, role agents, subagent/tool calls, token usage, and context jumps are expensive enough to optimize. Use `/work-usage` for the local sortable/filterable HTML version, including review scope/payoff when the telemetry recorded it; use `/work-usage --jsonl` for agents and add `--open` only when you want a browser.

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
  "warp": { "enabled": true },
  "workResume": {
    "selfImproving": true,
    "newSessionBetweenIterations": true
  },
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

Warp notifications auto-enable when Warp's env vars are present; set `"warp": { "enabled": true }` to force them or `false` to disable. `/work-resume` self-improvement is off by default for external projects; set `"workResume": { "selfImproving": true }` only when the agent should fix ce-workflow friction it observes while running target-project goals. `/work-catch-up` is registered only in that self-improving mode; after releases, update `extensions/work-catch-up-baseline.json` so the command can diff from the versions that built that release. `/work-resume` also starts each automatic continuation in a fresh session by default; set `"workResume": { "newSessionBetweenIterations": false }` only if you want one growing chat. Pi keeps the recent suffix according to `compaction.keepRecentTokens`; `/work-context on` writes at least 30k there. Compacting is still useful inside a noisy single agent turn, but overnight project loops should rely on Beads/git plus fresh-session continuations.

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
8. Recommends `/work-resume` when migration is complete.

Git log is evidence, not truth. The migrator does not create one Bead per commit.

For a clean CE brainstorm or plan with no partial implementation to reconcile, skip migration and use:

```text
/work-plan docs/brainstorms/my-feature.md
# or
/work-plan docs/plans/my-feature-plan.md
```

Then continue:

```text
/work-resume
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
/work-resume
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

With no arguments it resumes the current repo. To steer it, pass plain text:

```text
/work-resume finish U3 and stop after one Bead closes
```

To target another repo, make the first argument an existing path:

```text
/work-resume C:\soft\git\AI-Wedge finish U3
```

## Optional intercom coordination

`pi-intercom` is optional. Without it, the workflow still works: children persist blockers in Beads and stop safely.

With `pi-intercom` installed, `pi-subagents` can give child agents a private `contact_supervisor` channel back to the parent Pi session. The child uses it only when it should not guess:

- `reason: "need_decision"` — blocking product, architecture, scope, hardware, verification, or dirty-worktree decision.
- `reason: "progress_update"` — short non-blocking update when discovery changes the plan.

Example request:

```text
/work-resume
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

If a Bead already has a failure artifact or `debug-needed:<bug-id>`, target it directly:

```text
/work-debug RFLib-9g6.12: try lowering the RF retry timeout and re-run the COM7/COM8 smoke
```

The default path sends the bug Bead through `bead-debugger`, which follows `ce-debug` discipline: reproduce first, root-cause second, fix third, verify last. When you explicitly target a blocked Bead with guidance and want to watch the console, the parent may run an interactive debug loop directly, then use the same review/commit/close gates. If debugging cannot safely fix or verify, the bug is left blocked with a failure artifact and any human decision Bead needed; `/work-resume` then picks the next unrelated ready Bead.

Non-trivial reusable debugging lessons trigger `ce-compound mode:headless` after the fix commit.

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

`/work-settings` is the umbrella submenu: effort profiles, per-role (and advisor) model + effort, and the advisor/critic gates. Enter on a boolean flips it immediately and writes `.pi/settings.json`; selecting a profile copies its effort levels and gates onto your current settings (your chosen models are kept). `/work-models` remains as a focused role model/effort picker that writes the same settings.

### Effort profiles

Profiles set effort per role plus the advisor, and the advisory gates. Applying one overwrites effort and gates, not models:

| profile | plan | work | debug | review | commit | advisor | backup advisor | critic (brainstorm/plan) | slice plan before work | slice plan mode | advisor verifies task | simplify before review | browser tests on UI diff | ce-code-review before commit |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| low | low | low | medium | low | low | medium | low | off / off | on | bead-planner note | off | off | off | off |
| medium | medium | medium | high | medium | low | high | medium | on / on | on | ce-plan Lightweight | on | off | on | off |
| high | high | high | high | high | low | xhigh | medium | on / on | on | ce-plan Standard | on | on | on | off |
| max | xhigh | xhigh | xhigh | high | medium | xhigh | high | on / on | on | ce-plan Deep | on | on | on | on |

### Advisor and gates (prompt-live)

The advisor (`bead-advisor`, read-only, xhigh by default, inherits the control model) is a critic that the orchestrator actually launches from the handoff prompts when the matching gate is on. If it is unavailable, usage-limited, or fails to start, the prompt falls back once to `bead-advisor-backup`, which you can pin to a smaller model in `/work-settings`.

- **critic on brainstorm / plan** — after `ce-brainstorm`/`ce-plan` produces the artifact, run `bead-advisor` to find weak requirements, unverified acceptance, incomplete decisions, and untested assumptions. On for medium/high/max, off for low.
- **slice plan before work** — before an executable Bead runs for the first time, a planning pass writes a compact `wo:slice-plan` note and `wo:slice-planned` label. The worker executes that plan as the spec (the Bead is the tracking item, not the spec). Always on by profile: low uses one cheap `bead-planner` note; medium uses ce-plan Lightweight; high uses ce-plan Standard (normal); max uses ce-plan Deep. ce-plan **cannot disable individual research agents** (it dispatches `ce-repo-research-analyst` + `ce-learnings-researcher` in parallel by default; flow analysis is depth-gated, external research is skip-when-local-patterns-strong), so the real cost lever is this depth ladder.
- **advisor verifies task vs plan** — once a slice is implemented and self-verified (before review/finish), run `bead-advisor` to compare the change against the plan's acceptance and flag drift or missing evidence. On for medium/high/max.
- **simplify before review** — after a slice is implemented and self-verified but before it signals done-for-review, run `ce-simplify-code` on the diff to tighten clarity and drop over-engineering/dead flexibility. Closes the core-loop simplify step that otherwise only ran on review FAIL. On for high/max.
- **browser tests on UI diff** — at the `/work-finish` commit-ready gate, if the related files touch a runnable web frontend (routes/pages/components/styles), run `ce-test-browser` on the affected pages; skipped automatically for backend/CLI/docs-only diffs or projects with no web frontend. Trigger-based, not effort-bound: on for medium/high/max.
- **full ce-code-review before commit** — at the `/work-finish` commit-ready gate, run the full `ce-code-review` skill on the diff before the committer commits. On for max only.

Use `/work-models` for the easy path: pick `brainstorm/plan/migration`, `work`, `debug`, `review`, `commit`, `advisor`, or `advisor backup`, then choose from available models and effort levels. Blank model means “inherit the current control-session model.” Blank effort means “use the role default.” Settings persist in `.pi/settings.json`; `/work-settings status` (and `/work-models status`) make the tuning visible and `/work-settings` lets you flip gates live.

Role prompts use fresh child context by default and file-only artifacts so the parent session does not inherit every tool log or full master plan. Subagent launches should set `outputMode: "file-only"` with a short relative output filename unless the entire result is a short PASS/FAIL summary; do not pass `.pi-subagents/` paths because the subagent tool owns the artifact directory. The orchestrator must launch the exact package agents (`bead-worker`, `bead-reviewer`, etc.), not builtin stand-ins like `worker`; if `pi-subagents` is unavailable it stops with a setup blocker instead of implementing in the control chat. Real role agents should not get tiny timeouts: omit explicit timeouts when possible, or use at least 10 minutes for planner/worker/reviewer/fixer/debugger/migrator and at least 3 minutes for committer. Role prompts set effort defaults: migrator/planner/debugger high, worker/fixer/reviewer medium, committer low. `/work-models` writes the same `subagents.agentOverrides` settings you can edit by hand:

```json
{
  "subagents": {
    "agentOverrides": {
      "bead-worker": { "model": "anthropic/claude-sonnet-4", "thinking": "medium" },
      "bead-committer": { "thinking": "low" },
      "bead-advisor": { "thinking": "xhigh" },
      "bead-advisor-backup": { "model": "openai/gpt-5-mini", "thinking": "medium" }
    }
  },
  "workOrchestrator": {
    "profile": "max",
    "critic": { "brainstorm": true, "plan": true },
    "advisorVerifyTask": true,
    "slicePlanBeforeWork": true,
    "slicePlanWithCePlan": true,
    "slicePlanCeDepth": "Deep",
    "simplifyBeforeReview": true,
    "browserTestsOnUiDiff": true,
    "codeReviewBeforeCommit": true
  }
}
```

Use low/minimal effort for disposable smoke-test Pi instances. Keep your control session on a frontier model for `/work-plan`/`ce-plan` if you want deep planning, then set `work` to a local model to save tokens.

`/work-context` is separate from model choice. It is on by default and uses no model call for its compact summary. `/work-resume` starts automatic continuations in fresh sessions by default (`workResume.newSessionBetweenIterations !== false`) so overnight loops do not inherit every prior tool log. Use `/work-resume-stop` to request a clean stop; running `/work-resume` while it says 🛑 stopping cancels that stop. The status line shows ▶️ active, 🔵 working, 🛑 stopping, ⏹️ stopped, or 🟣❓ needs human. For normal control-session inspection, use `/work-report` and `/work-resume`; avoid raw `bd show --json` for epics because it can dump full plans into chat.

Status line hints the working hotkeys: `F7 roadmaps · F8 menu`. Run `/reload` after installing or editing the package.

## Verify this package

```bash
npm run verify
npm run verify:quiet
```

Use `verify:quiet` in agent chats and `verify` when you want the full local log. The verifier checks package manifest paths, prompt routing, skill coverage, role-agent boundaries, migration policy, CE integration hooks, optional `pi-intercom` policy, and MVP non-goals.

## Disposable repo smoke test

After static verification passes, test behavior in a throwaway repo:

```bash
mkdir /tmp/wo-smoke && cd /tmp/wo-smoke
git init
pi -e /absolute/path/to/pi-work-orchestrator
```

Then try:

```text
/work-init
/work-plan Build a one-file notes CLI with add/list commands
/work-status
/work-add Add --version output
/work-pause smoke test checkpoint
/work-resume
```

From Git Bash, disable MSYS path conversion when using non-interactive slash commands, or `/work-resume` can be rewritten into `C:/Program Files/Git/work-resume` before Pi receives it:

```bash
MSYS_NO_PATHCONV=1 pi --effort high -p "/work-resume"
```

Known runtime follow-up: current Pi on this Windows bench prints `The system cannot find the path specified.` before any `pi -e ...` extension session, even for an empty extension. The work commands now print deterministic results and keep git clean despite that upstream/runtime noise; investigate Pi extension startup separately if the message becomes actionable.

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
