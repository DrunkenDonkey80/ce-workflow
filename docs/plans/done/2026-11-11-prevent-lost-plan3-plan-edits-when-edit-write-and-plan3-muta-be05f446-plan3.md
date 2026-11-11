---
plan3: true
status: complete
created: 2026-11-11
updated: 2026-11-11T16:00:55.617Z
started: 2026-11-11T15:40:32.572Z
---

# Plan3 write coordination

## Original request

> A parallel Edit and Plan3 checkpoint both reported success but checkpoint replaced the plan with its older copy, losing the edit. The user requested the proper fix: coordinate writers, rather than rely on the model remembering to serialize calls.

## Goal, requirements, and non-goals

Prevent silent lost updates between Plan3 mutations and native Edit/Write operations on plan files. Preserve unrelated repository work. No commit or push requested. Shell writes and external editors that bypass coordination are outside the guarantee.

## Decisions

- Use shared file coordination, preserving existing cross-process plan locking. Reject a conflicting operation clearly if it cannot safely wait.
- A final re-read before rename alone is not safe: another write can still occur after that read. Do not use it as the fix.
- Native parallel tool preflight runs before execution; waiting in preflight for a sibling to finish can deadlock. Cover this explicitly.
- Prefer Pi's existing file-mutation queue where it fully solves the coordination requirement; inspect its lifecycle before choosing integration.
- Test the real Plan3 checkpoint path and actual native file tools with forced overlap, not probabilistic sleeps.

## Open questions

### Blocking

None; implementation details are agent-owned.

### Deferred

None.

## Relevant files and approach

- `C:/SOFT/git/ce-workflow/extensions/plan3.ts`: checkpoint/mutate and existing native write hook.
- `C:/SOFT/git/ce-workflow/extensions/plan3-files.ts`: shared locks, move/rename paths and callers.
- `C:/SOFT/git/ce-workflow/scripts/test-work-plan3.mjs`: existing Plan3 regression runner.
- Installed Pi extension docs: `withFileMutationQueue` is the supported native Edit/Write coordination seam; event lifecycle defines preflight and finalization.
- Other shared-lock callers (diagram and design) must remain compatible.

## Phases

### Phase 1: Reproduce and coordinate writers [code]

- [x] **S1** Reproduced checkpoint erasing a successful native Edit with a deterministic pause after reading.
- [x] **S2** Plan3 and native Edit/Write share canonical cross-process reservations; conflicts reject immediately and finalization releases locks.
- [x] **S3** Deterministic overlap, rename, cancellation, shutdown, aliases and cross-process regressions pass with affected targeted suites.

## Global validation

Run `node scripts/test-work-plan3.mjs`, plus the existing targeted checks covering any changed shared lock callers. Run active LSP diagnostics for changed source and `git diff --check`. Record failures and unavailable coverage explicitly. No full suite or paid model requests.

## Resume context

Implementation and targeted verification complete. Native Edit/Write reserve the same canonical cross-process lock as Plan3 from preflight through tool_execution_end; busy preflights reject immediately, so sibling preflights cannot deadlock. Plan3 waits for accepted native writes. Native-tool, cross-process, error/cancel/shutdown and deterministic rename/readback regressions pass. README and Unreleased changelog updated. Four LSP probes remain inconclusive; no reported diagnostics. External editors/shell writes remain outside the guarantee. No commit or push; unrelated dirty changes preserved.

## Amendments

None.
