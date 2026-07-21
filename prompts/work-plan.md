---
description: Plan an idea or roadmap into a work items roadmap
argument-hint: "<idea-or-plan-file>"
---

Use the `work-orchestrator` skill in mode: `master` via `/work-plan`.

If the input is a raw idea or non-plan artifact, run `ce-plan` first, asking clarification questions one at a time when the input is broad, important, or underspecified; auto-accept only skips the final write-confirmation, not discovery questions. Then create the roadmap in-flow via `node scripts/work-helper.mjs bootstrap-plan-roadmap <created-plan-path>` — that helper enforces the Open Question Gate, so resolve each remaining open question via one `ask_user`, fold it into the plan, and re-run until it creates the roadmap. When planning an existing initiative child, include `--roadmap <selected-child-id>`.

Infer lifecycle shape from confirmed delivery scopes. One scope keeps the standalone path. Multiple independently completable scopes require a versioned semantic proposal, `initiative-preview --proposal-json <json>`, then F7 confirmation of the full hierarchy/coverage; only that user-facing confirmation mints the single-use receipt for `initiative-apply`. For an initiative, consume the coded preparation state, plan only its selected broad child, and never plan siblings or mutate the raw store.

After `initiative-apply` or `bootstrap-plan-roadmap --roadmap <initiative-child>`, return the coded preparation choices (`plan_next`, `select_child`, `start_execution`, `stop`). Plan completion is not execution approval: suggest the returned next planning boundary and wait for an explicit `start_execution` choice.

Task: $ARGUMENTS

Final line: standalone roadmap bootstrap keeps `Next: /work-resume <roadmap-id>`; initiative bootstrap reports its coded preparation state and does not resume execution.
