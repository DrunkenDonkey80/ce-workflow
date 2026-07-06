---
description: Render a local HTML usage report from work telemetry
argument-hint: "[today|all|epic <id>|bead <id>]"
---

Fallback when the extension command is unavailable: use the `work-orchestrator` skill in mode: `usage`.

Scope: $ARGUMENTS

Read existing `.pi/work-runs` telemetry only. Do not create or mutate Beads.
