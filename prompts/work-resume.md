---
description: Resume the latest active master epic or ask which one to use
argument-hint: "[epic-id|last]"
---

Use the `work-orchestrator` skill in mode: `resume`.

Target: $ARGUMENTS

Resolve empty or `last` from Beads state. Handle one executable Bead, then stop with status and the next `/work-resume <epic-id>` command. If no ready Bead exists but the epic is not complete, ask `bead-planner` to create the next slice before declaring done. If no single epic is obvious, list active not-completed epics and ask the user to pick one.
