---
description: Verify and migrate a legacy work items workspace into the native Git-tracked work store.
---

Use the `work-orchestrator` skill in mode: `remove-beads`.

Run `/work-remove-beads` only for a detected legacy workspace. It is a one-way, verified migration: preserve the ignored backup, do not stage or commit, and stop on parity, lock, source-change, or recovery errors.

Arguments: $ARGUMENTS
