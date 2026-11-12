---
plan3: true
status: draft
created: 2026-11-12
updated: 2026-11-12T21:29:37.353Z
---

# Prune old tool results at the Ultrafull checkpoint (from Haystack review)

## Original request

> Prune old tool results at the Ultrafull checkpoint. Requirement: pruning at the checkpoint keeps more recent turns verbatim without raising re-calls, tokens or cost overall. Background: Ultrafull summarizes everything outside a recent tail at 150k and does no stripping in between (extensions/work-models.ts:222, :1775; tail selection extensions/work-compaction.ts:111 tightenPreparation). Haystack's ToolResultPruningCompactor (haystack/hooks/compaction/tool_result_pruning.py:14-80) replaces older large tool results with "Call `{tool_name}` again if you need it", keeps the newest step whole and small results untouched. Must run only at the checkpoint (rolling pruning breaks the prompt cache). Proposed steps: replay recent Ultrafull compactions to see how much of the kept tail is old tool output; prune at checkpoint time only with the re-call placeholder; compare kept turns, re-call rate and audit-compaction scores with current Ultrafull; end-to-end benchmark, keep or revert. Upstream paths for the watch: haystack/hooks/compaction/tool_result_pruning.py.
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
