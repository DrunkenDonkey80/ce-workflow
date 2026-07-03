---
description: Classify work size and route to the right work-orchestrator mode
argument-hint: "<task>"
---

Use the `work-orchestrator` skill in mode: `auto`.

Task: $ARGUMENTS

Preserve the task text verbatim. Route errors/failing tests to `debug`. Route legacy artifacts, partial projects, old TODOs, or branch reconciliation to `migrate`. Ask before starting if classification is big, master, migrate, or ambiguous.
