---
description: Plan an idea or roadmap into a Beads epic
argument-hint: "<idea-or-plan-file>"
---

Use the `work-orchestrator` skill in mode: `master` via `/work-plan`.

If the input is a raw idea or non-plan artifact, run `ce-plan` first, auto-accept plan creation unless a real human decision is needed, then call `/work-plan <created-plan-path>`.

Task: $ARGUMENTS

Final line must be one of:

- `Next: /work-plan <created-plan-path>` after ce-plan writes a plan.
- `Next: /work-resume <epic-id>` after the epic and first planning Bead exist.
