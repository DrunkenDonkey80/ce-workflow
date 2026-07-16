---
description: Report epic progress, blockers, failed/debug-needed work items, and next commands
argument-hint: "[epic-id|last|blocked-work-item-id]"
---

Use the `work-orchestrator` skill in mode: `report`.

Target: $ARGUMENTS

Read-only. Summarize epic status from work items and git. If the target is a blocked/debug-needed work item, show its failure artifact, blocker reason, dependencies, and suggested `/work-debug <work-item-id>: <human guidance>` command.
