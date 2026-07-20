---
description: Debug a failing test, error, or broken behavior inside the active roadmap
argument-hint: "<bug-or-work-item-id|symptom[: guidance]>"
---

Fallback when the extension command is unavailable: use the `work-orchestrator` skill in mode: `debug`.

Bug: $ARGUMENTS

Preserve the bug text verbatim. Use a debug work item and `ce-debug`; route any human question back through the main conversation.
