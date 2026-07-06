---
description: Alias for /work-plan; create a master epic from an idea or plan
argument-hint: "<idea-or-plan-file>"
---

Prefer `/work-plan` for new users. This legacy alias uses the `work-orchestrator` skill in mode: `master`.

When this runs `ce-plan`, auto-accept plan creation unless a real human decision is needed, then return to `/work-plan <created-plan-path>`.

Task: $ARGUMENTS

Final line must name the next command: `/work-plan <created-plan-path>` or `/work-resume <epic-id>`.
