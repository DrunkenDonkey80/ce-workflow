# Work orchestrator

The work orchestrator persists durable workflow state in `.ce-workflow/work-items.json`; Git remains the durable code history. Chat memory and runtime telemetry are not sources of truth.

## Native loop

1. Run `/work-status <roadmap-id>` or `/work-resume <roadmap-id>`.
2. Select one ready native work item.
3. A planner creates executable work items and real blocker edges only.
4. A worker implements one work item, records changed files and verification evidence, and leaves final closure to the finish gate.
5. A reviewer reports PASS or FAIL. A fixer addresses only concrete findings.
6. `/work-finish <work-item-id>` verifies, commits when configured, and closes only after durable evidence exists.

Use `/work-pause` to record the active item, git state, verification, failures, and next step. Resume from native state with `/work-resume`; manual edits are classified before writers run.

## Boundaries

- One writer at a time; reviewers are read-only.
- Plans and brainstorms remain documents linked from work items, not duplicate stores.
- Native helpers in `scripts/work-helper.mjs` provide compact summary, children, ready, claim, note, label, and blocker operations.
- Runtime logs, telemetry, locks, temporary files, exports, and backups are ignored.
- Normal commands never require or invoke a tracker executable.

## Legacy repositories

A repository containing the retired tracker workspace must run `/work-remove-beads` before normal workflow commands. That one-way migration validates parity, retains an ignored backup, migrates role settings, and is the sole legacy-export boundary.
