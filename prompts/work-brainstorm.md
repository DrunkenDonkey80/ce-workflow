---
description: Link brainstorms back to Beads-backed ideas
argument-hint: "[idea <target>|topic] [brainstorm-path]"
---

Fallback when the extension command is unavailable: use the `work-orchestrator` skill in mode: `brainstorm`.

Target: $ARGUMENTS

Preserve the target/topic text verbatim. Prefer deterministic Beads linking before starting CE brainstorming.

If no brainstorm artifact path is supplied, run `ce-brainstorm` interactively:
ask one question at a time until the requirements are clear, then write the
artifact and link it back. Never silently synthesize the brainstorm for broad,
important, or underspecified work.
