# Global work orchestrator idea

This package is a small Pi workflow layer for driving software work without repeated long prompts. Native work items hold status, acceptance, dependencies, notes, and pause/resume handoffs; Git holds code history.

## Core model

- A roadmap scopes the work.
- A planning work item creates the next executable work item or records a decision.
- An implementation work item is one shippable slice.
- Review, verification, commit, and closure are separate safety gates.
- Ideas and documents are linked to work items and never replace the native store.

## Command shape

`F7 → Small task`, `F7 → Medium task`, `F7 → Large task`, and `F7 → Auto-route task` create correctly scoped work. `F7 → Resume work` starts the extension-owned autonomous loop and advances one ready item at a time until the selected scope completes or needs a real decision. `F7 → Add work`, `F7 → Debug`, and `F7 → Checkpoint and pause` preserve the same graph through interruptions. `F7 → Status` and `F7 → Blocker report` are cheap deterministic projections; `F9 → Fleet` shows the main-chat orchestrator as the root above its direct, prefetch, and verifier agents.

Use role agents named `work-planner`, `work-worker`, `work-reviewer`, `work-fixer`, `work-debugger`, and `work-committer` only where their distinct judgment is needed. Routine bounded work stays in the current session.

## Migration boundary

New repositories need no tracker installation. Existing legacy workspaces are explicitly migrated with `F7 → Migrate legacy workspace`; it is the only legacy boundary and normal native commands do not fall back to it.
