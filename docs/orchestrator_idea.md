# Global work orchestrator idea

This package is a small Pi workflow layer for driving software work without repeated long prompts. Native work items hold status, acceptance, dependencies, notes, and pause/resume handoffs; Git holds code history.

## Core model

- A roadmap scopes the work.
- A planning work item creates the next executable work item or records a decision.
- An implementation work item is one shippable slice.
- Review, verification, commit, and closure are separate safety gates.
- Ideas and documents are linked to work items and never replace the native store.

## Command shape

`/work-small`, `/work-med`, `/work-big`, and `/work-auto` create correctly scoped work. `/work-resume` selects one ready item. `/work-add`, `/work-debug`, and `/work-pause` preserve the same graph through interruptions. `/work-status` and `/work-report` are cheap deterministic projections.

Use role agents named `work-planner`, `work-worker`, `work-reviewer`, `work-fixer`, `work-debugger`, and `work-committer` only where their distinct judgment is needed. Routine bounded work stays in the current session.

## Migration boundary

New repositories need no tracker installation. Existing legacy workspaces are explicitly migrated with `/work-remove-beads`; it is the only legacy boundary and normal native commands do not fall back to it.
