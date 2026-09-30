---
description: Implement a well-scoped change directly with focused verification
argument-hint: "<task>"
---
Implement this task: $@

This is an ordinary direct request, not an Orchestrator /wo run. If no task was supplied, ask for one. Inspect the real code and its callers, preserve existing behavior and the user's constraints, and state the intended change and smallest relevant check briefly. Do not require a written plan, approval ceremony, subagents, or new work items for routine work; this invocation authorizes implementation. Resolve consequential ambiguity with the user before changing code.

Make the smallest correct change, run an existing focused test/self-check (or add one small regression check for nontrivial new logic), and report files changed, verification and any untested risk. Do not claim success from a check that did not run. Never push unless the user explicitly instructs it.
