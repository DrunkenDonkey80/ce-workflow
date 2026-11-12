---
plan3: true
status: draft
created: 2026-11-12
updated: 2026-11-12T21:29:31.514Z
---

# Warn before stopping a runaway run (from Haystack review)

## Original request

> Warn before stopping a runaway run. Requirement: an unattended run stops at a user-approved turn allowance after one advance reminder, and compaction, retry or resume never reset the allowance. Background: an overnight run made 363 replies (~$170) with no edits; the investigated but unbuilt plan docs/plans/2026-09-27-001-fix-unbounded-direct-agent-runs-plan.md covers the stop; this adds Haystack's StepBudgetReminderHook (haystack/hooks/budget/hooks.py:114-193: "You have N of M steps remaining... start working toward your final answer") and TokenBudgetHook (:31-112). Counterparts: extensions/plan3-night.ts, extensions/plan3.ts:1199. Caveat: a parent-session allowance does not cap subagents running on their own. Proposed steps: pick the default allowance and where the user changes it from the incident numbers; count turns per run persisted across continuations, compaction, retry and resume; one reminder a few turns before the limit, marked generated so session memory does not treat it as a user request; pause with a named budget reason at the limit, never mark the plan complete, reset only on explicit user action; replay the looping session (no new parent turn after the limit, below-limit runs unchanged). Upstream paths for the watch: haystack/hooks/budget/.
> 
> Source: accepted idea from the Haystack review (plan 2af79ca5, docs/proposals/2026-11-12-haystack-review.md, ledger docs/upstream/haystack.md). Upstream deepset-ai/haystack at 104a83f8799b1b8d9d18a88eb9a08305133aea2d (Apache-2.0). A port of Haystack code carries the Apache-2.0 license text and attribution notice; re-implementing needs neither. When this plan builds the idea and it is kept, add the catch-up entry to extensions/work-catch-up-baseline.json if no other Haystack follow-up has: name "deepset-ai/haystack", kind "git", url "https://github.com/deepset-ai/haystack.git", ledger "docs/upstream/haystack.md", paths limited to the adopted upstream paths, version and reviewedVersion at the pin; then update the ledger row. Keep or revert by the AGENTS.md Optimization Regression Rule (Ultrafull for live runs).

## Goal, requirements, and non-goals

Pending investigation.

## Decisions

Record each settled choice, rationale, and source here.

## Open questions

### Blocking

Not assessed yet.

### Deferred

None recorded.

## Relevant files and approach

Pending investigation.

## Phases

Use stable step IDs (- [ ] **ID** text); markers [ ] pending / [wip] / [x] / [f] failed / [blocked]. Each phase needs concrete actions, acceptance examples, and existing verification commands (or an automated check with the agent's tools; a manual check only for what no tool can observe).

## Global validation

Pending investigation.

## Resume context

Planning has not started.

## Amendments

Append material changes and their reasons; preserve the original request and settled decisions.
