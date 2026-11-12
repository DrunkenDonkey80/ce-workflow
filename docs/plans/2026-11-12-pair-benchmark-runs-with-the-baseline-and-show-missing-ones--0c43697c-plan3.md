---
plan3: true
status: draft
created: 2026-11-12
updated: 2026-11-12T21:29:35.424Z
---

# Pair benchmark runs with the baseline and show missing ones (from Haystack review)

## Original request

> Pair benchmark runs with the baseline and show missing ones. Requirement: a baseline comparison pairs runs by identity and shows failed or missing runs as incomplete, never as zero cost or success. Background: scripts/benchmark-context-cache-live.mjs:130-137 averages only runs that did not throw, so failed runs drop out of the means; the Optimization Regression Rule comparison is done by hand. Haystack's EvalRunResult (haystack/evaluation/eval_run_result.py:38-76, :244-329) keeps per-run rows and aligns comparisons by identifier. Proposed steps: compare script for two results.json files paired by repetition; runtime, total tokens, cost, turns and tool calls per pair and in total, incomplete pairs marked; self-check with reordered, missing, failed and duplicate rows; document it next to the Optimization Regression Rule. Upstream paths for the watch: haystack/evaluation/eval_run_result.py.
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
