---
description: Plan an idea or roadmap into a Beads epic
argument-hint: "<idea-or-plan-file>"
---

Use the `work-orchestrator` skill in mode: `master` via `/work-plan`.

If the input is a raw idea or non-plan artifact, run `ce-plan` first, asking clarification questions one at a time when the input is broad, important, or underspecified; auto-accept only skips the final write-confirmation, not discovery questions. Then create the epic in-flow via `node scripts/work-helper.mjs bootstrap-plan-epic <created-plan-path>` — that helper enforces the Open Question Gate, so resolve each remaining open question via one `ask_user`, fold it into the plan, and re-run until it creates the epic.

Task: $ARGUMENTS

Final line: once the helper creates the epic, `Next: /work-resume <epic-id>` (then plan and start each slice).
