---
description: Report epic progress, blockers, failed/debug-needed Beads, and next commands
argument-hint: "[epic-id|last|blocked-bead-id]"
---

Use the `work-orchestrator` skill in mode: `report`.

Target: $ARGUMENTS

Read-only. Summarize epic status from Beads and git. If the target is a blocked/debug-needed Bead, show its failure artifact, blocker reason, dependencies, and suggested `/work-debug <bead-id>: <human guidance>` command.
