---
description: Alias for /work-plan; create a master roadmap from an idea or plan
argument-hint: "<idea-or-plan-file>"
---

Prefer `/work-plan` for new users. This legacy alias uses the `work-orchestrator` skill in mode: `master`.

When this runs `ce-plan`, auto-accept plan creation unless a real human decision is needed, then create the roadmap in-flow via `node scripts/work-helper.mjs bootstrap-plan-roadmap <created-plan-path>` (runs the Open Question Gate). One delivery scope stays standalone; multiple scopes use the coded initiative proposal → preview → F7 approval receipt → apply path. For an initiative, use coded preparation state to plan only the selected broad child; after its bootstrap, return only the available `plan_next`, `select_child`, `start_execution`, and `stop` choices. Never treat plan completion as execution approval.

Task: $ARGUMENTS

Final line: standalone bootstrap names `/work-resume <roadmap-id>`; initiative bootstrap names its suggested next planning action and waits for explicit execution approval.
