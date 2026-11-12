---
plan3: true
status: draft
created: 2026-11-12
updated: 2026-11-12T21:29:29.479Z
---

# Better compaction summaries: two prompt rules and error feedback (from Haystack review)

## Original request

> Better compaction summaries: two prompt rules and error feedback. Requirement: compaction fallbacks drop measurably with no overall regression in runtime, tokens, cost, turns or tool calls. Background: local session logs show 744 hybrid vs 106 fallback compactions (~12% fallback); attempt errors mostly "Memory budget exceeded", then unknown citations and invalid JSON (approximate counts). Today a failed reply retries the next model with the same task (extensions/work-compaction-memory.ts:174-188 validateMemory, :238-259). Haystack's summary prompt (haystack/hooks/compaction/summarization.py:34-70) demands identifiers copied exactly and says absence is not evidence; its structured-output hook (haystack/hooks/structured_output/hooks.py:132-200) feeds the validation error back in a bounded loop. Proposed steps: baseline fallback rate and reasons with scripts/audit-compaction.mjs (add a reason count if missing); add the two prompt rules; on validation failure retry once with the concrete error within the same deadline, keep the local fallback; compare fallback rate, re-reads and repeated commands, then the end-to-end benchmark; keep or revert. Upstream paths for the watch: haystack/hooks/compaction/summarization.py, haystack/hooks/structured_output/.
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
