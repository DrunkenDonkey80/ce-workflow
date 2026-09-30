---
description: Plan, independently challenge, approve, then execute a complex change
argument-hint: "<goal and constraints>"
---
Work on this goal: $@

This is a direct request, not an Orchestrator /wo run. If no goal was supplied, ask for it. This invocation authorizes native pi-subagent read-only plan review, NOT an automatic work-item workflow or external agent CLI.

First inspect the code, existing behavior, callers, constraints, and runnable checks. Resolve missing product decisions with the user rather than guessing. Write a durable, concise plan (in the project's existing plans directory if appropriate, otherwise a temporary file) with an absolute path: desired outcomes, user value, explicit non-goals, architecture/invariants, implementation steps, risks, and acceptance checks. A plan is a handoff, not proof.

Ask a fresh-context native reviewer to challenge the plan's assumptions, edge cases, and testability. Use a second independent perspective only when distinct risks warrant the cost. Inspect available agents/models before launching, keep reviews read-only, reconcile concrete findings into the plan, and report unavailable reviewers rather than inventing or silently substituting them. If the delegated review infrastructure fails, stop and report it; do not silently use an external agent CLI. No source edits before the user approves the revised plan.

Present the plan path, the important choices and reviewer disagreements, then ask the user to approve, amend, or stop. On explicit approval, implement the approved scope in this conversation, run the project's relevant existing checks and focused regression tests, and report results and residual risks. Amendments replace the earlier scope; re-review material changes before implementing. Do not push unless explicitly instructed. If approval is deferred, stop with the plan path so the user can resume later.
