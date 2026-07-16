---
description: Migrate existing plans, TODOs, branches, or legacy tracker state into a native work-item epic
argument-hint: "<artifacts, branches, or description>"
---

Use the `work-orchestrator` skill in mode: `migrate`.

Migration sources: $ARGUMENTS

Preserve the source text verbatim. Analyze artifacts, git history, and branches read-only; create a clean epic plus child work items; do not checkout, merge, or edit source code.
