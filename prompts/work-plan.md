---
description: Plan an idea or roadmap into a Beads epic
argument-hint: "<idea-or-plan-file>"
---

Use the `work-orchestrator` skill in mode: `master` via `/work-plan`.

If the input is a raw idea or non-plan artifact, run `ce-plan` first, asking clarification questions one at a time when the input is broad, important, or underspecified. Auto-accept only skips the final write-confirmation after discovery is clear; it does not skip questions. Then call `/work-plan <created-plan-path>`.

Task: $ARGUMENTS

Final line must be one of:

- `Next: /work-plan <created-plan-path>` after ce-plan writes a plan.
- `Next: /work-resume` after the epic and first planning Bead exists.
