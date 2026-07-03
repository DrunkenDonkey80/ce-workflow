---
description: Debug a failing test, error, or broken behavior inside the active epic
argument-hint: "<bug-or-bead-id|symptom[: guidance]>"
---

Fallback when the extension command is unavailable: use the `work-orchestrator` skill in mode: `debug`.

Bug: $ARGUMENTS

Preserve the bug text verbatim. Use a debug Bead and `ce-debug`; route any human question back through the main conversation.
