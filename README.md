# pi-work-orchestrator

Native Pi workflow package for staged software work through short `/work-*` commands.

The native work-item store at `.ce-workflow/work-items.json` is the only durable work state. Git is the only code state. Runtime logs, telemetry, locks, recovery files, exports, and backups stay ignored.

## Install

```bash
pi install /absolute/path/to/pi-work-orchestrator
pi install npm:pi-subagents
pi install npm:pi-compound-engineering
pi install npm:pi-ask-user
# Optional: pi install npm:pi-intercom
```

No tracker CLI is required for normal operation. In a new repository run:

```text
/work-init
/work-small add focused behavior
/work-finish <work-item-id>
```

## Commands

| Command | Native behavior |
| --- | --- |
| `/work-init` | Creates the native store when absent. |
| `/work-plan`, `/work-master` | Creates or resumes a plan epic. |
| `/work-small`, `/work-med`, `/work-big`, `/work-auto` | Classifies and creates one scoped work item. |
| `/work-resume`, `/work-status`, `/work-report`, `/work-roadmap` | Reads native state without an agent or tracker subprocess. |
| `/work-add`, `/work-debug`, `/work-pause`, `/work-finish` | Mutates, checkpoints, or finalizes a native work item. |
| `/work-brainstorm`, `/work-ideate`, `/work-usage`, `/work-telemetry` | Manages ideas and local reports. |
| `/work-settings`, `/work-context`, `/work-catch-up`, `/work-goal` | Configures orchestration and context behavior. |
| `/work-remove-beads` | One-way migration for a detected legacy workspace. |

Role agents are `work-planner`, `work-worker`, `work-reviewer`, `work-fixer`, `work-debugger`, `work-committer`, `work-migrator`, and the two work-advisor roles. They use `scripts/work-helper.mjs` native helpers for compact work-item summaries, children, ready, claim, note, label, and blocker operations.

## Workflow rules

- One executable work item is the normal session boundary.
- Use `/work-pause` to persist a checkpoint, then `/work-resume <epic-id>` in a fresh session.
- `/work-status` and `/work-report` are deterministic local projections; do not edit the store by hand during normal use.
- Finish requires verification evidence and any required review before the store item closes.
- Manual changes are classified before writer work starts. No parallel writers, automatic branch checkout, or push automation.
- Put project verification contracts in project instructions. Real hardware or product proof is not replaced by mocks without approval.

## Legacy migration

For a repository with the former tracker workspace, use only:

```text
/work-remove-beads
```

The migration command is idempotent, validates export parity, keeps an ignored backup, migrates role settings, and stops safely on lock, source-change, corruption, or recovery errors. Normal commands stop and point to this command until migration completes. The migration boundary is the only packaged code that can invoke the legacy exporter.

## Smoke checks

A clean native smoke needs no legacy executable or workspace:

```bash
node scripts/test-work-store.mjs
node scripts/test-work-store-performance.mjs
node scripts/test-work-start-finish.mjs
npm run verify
```

A legacy migration smoke is covered by:

```bash
node scripts/test-work-remove-beads.mjs
node scripts/test-work-remove-beads-windows.mjs
```

`npm pack --dry-run` verifies the publish surface. `npm run verify:quiet` is the compact package gate.
