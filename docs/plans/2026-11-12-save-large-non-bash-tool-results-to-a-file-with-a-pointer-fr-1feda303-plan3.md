---
plan3: true
status: draft
created: 2026-11-12
updated: 2026-11-12T21:29:41.156Z
---

# Save large non-bash tool results to a file with a pointer (from Haystack review)

## Original request

> Save large non-bash tool results to a file with a pointer. Requirement: offloading lowers total tokens on browsing-heavy runs with no overall regression and no saved data outliving its session. Background: Pi saves big bash output to a temp file and images become references, but subagent output, browser_fetch pages and jev results stay inline (giant-result cut extensions/work-models.ts:1902-1916; extensions/work-images.ts). Haystack's ToolResultOffloadHook (haystack/hooks/tool_result_offloading/hooks.py:60-134, utils.py:73-113, stores.py:12-76) saves first, then replaces with a preview and pointer; a failed write leaves the result inline. Review recommendation was defer unless browsing-heavy sessions are a known cost: measure first and stop if the gain is small. Saved files may hold sensitive content, so they stay session-scoped. Proposed steps: measure tokens taken by large non-bash results in recent sessions (stop here if small); save large subagent, browser_fetch and jev results to a session folder with preview and path, errors and failed writes inline; clean up with the session, never offload twice; benchmark a browsing-heavy run, keep or revert. Upstream paths for the watch: haystack/hooks/tool_result_offloading/.
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
