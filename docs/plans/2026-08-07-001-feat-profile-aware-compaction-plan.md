---
title: Profile-aware deterministic compaction - Plan
type: feature
date: 2026-08-07
topic: profile-aware-compaction
artifact_contract: ce-unified-plan/v1
artifact_readiness: executable
execution: code
---

<!-- markdownlint-disable-next-line MD025 -->
# Profile-aware deterministic compaction - Plan

## Goal capsule

- **Objective:** Keep ce-workflow as the sole compaction formatter and continuation owner while replacing its lossy work-only summary with deterministic freeform, work-resume, and autonomous-goal profiles.
- **Authority:** Native work-item state, persisted work-goal state, Git, and files remain authoritative. Conversation extraction is bounded supporting context.
- **Constraints:** No external compaction hook, summarization model, background memory worker, embeddings, settings migration, or work-store schema change.
- **Validation:** Focused formatter fixtures, lifecycle integration fixtures, package verification, and one live Pi smoke after restart.

## Decisions

1. Add one pure `extensions/work-compaction.js` policy module. It performs message normalization, profile formatting, bounded section selection, and trigger arithmetic without filesystem or Pi access.
2. Keep all runtime reads and continuation behavior in `extensions/work-models.js`.
3. Format every compaction event so extension load order cannot select another summary, but record trigger ownership separately. Native-triggered work-goal compaction must retain its existing recovery branch; ce-triggered compaction resumes through its callback.
4. Select `work-resume` only from a generation-scoped explicit WorkItem hint. Do not infer a work profile merely because the repository contains ready or in-progress work.
5. Treat these persisted work-goal statuses as autonomous context: `active`, `paused`, `waiting_usage_limit`, `needs_human`, and `budget_limited`.
6. Regenerate durable sections on every compaction. A previous ce-workflow summary contributes only selected earlier highlights, preventing recursive summary growth.
7. Use forward slashes for normalized paths and LF for text. Stable input produces byte-identical output.
8. Context guard settings control proactive triggering, not formatter ownership.

## Summary contract

Sections are emitted in this stable order:

| Section | Source | Required | Budget priority |
| --- | --- | ---: | ---: |
| Header/profile | Formatter | yes | protected |
| Objective | Latest user request, selected WorkItem, or persisted goal | yes | protected |
| Durable work state | Read-only store/Git projection | work profiles | high |
| Decisions and blockers | Goal decision plus scoped decision/blocked items | when present | medium |
| Changes and verification | File operations plus durable evidence | when present | medium |
| Next action | Profile-derived recovery action | yes | protected |
| Earlier compacted context | Selected sections from previous ce summary, otherwise bounded prior summary | when present | lowest |
| Recent visible context | Latest user/assistant lines, tool-call names, and failed tool output | when present | low |

Low-priority sections shrink or disappear before protected content. Any shrink adds `[... omitted by compaction budget ...]`. Successful tool payloads and reasoning remain omitted. Durable data is delimited and field-bounded before formatting.

## Trigger contract

Given configured trigger `T`, context window `C`, requested Pi retention `K`, and summary budget `S` characters:

```text
summaryTokens = ceil(S / 4)
effectiveKeep = C ? min(K, floor(C / 2)) : K
headroom = C ? min(floor(C / 2), effectiveKeep + summaryTokens) : 0
ceiling = C ? max(1, C - headroom) : T
minimum = C ? min(30_000, ceiling) : 30_000
trigger = C ? max(minimum, min(T, ceiling)) : max(30_000, T)
```

Status reports requested retention, effective retention, headroom, ceiling, and trigger. A small model's 30K minimum can never override its safe ceiling.

## Implementation units

### U1. Pure formatter and trigger policy

- Add `extensions/work-compaction.js`.
- Export profile constants, `contentText`, `filesFromOps`, `compactionThreshold`, and `formatCompactionSummary`.
- Normalize CRLF and Windows paths; stable-deduplicate without timestamps.
- Keep complete high-value sections under `maxSummaryChars`; explicitly mark omissions.
- Parse prior ce summaries by section rather than nesting the full prior summary.

### U2. Read-only durable projection and profile selection

- In `extensions/work-models.js`, build a bounded projection from `loadStore`, persisted work-goal data, and read-only Git commands.
- Pass WorkItem IDs only as lookup hints and reread all content from the latest store snapshot.
- Include selected item identity/status/description/acceptance, parent, dependency statuses, bounded notes/evidence, related decisions/blockers, Git HEAD/status, and next action.
- Missing or malformed state yields an explicit unavailable diagnostic, never a compaction failure.
- Freeform remains freeform when no explicit hint or active goal exists.

### U3. Formatter ownership and lifecycle fencing

- Replace `instantSummary` in `session_before_compact` and intercept native as well as ce-triggered compaction.
- Retain `details.kind`, reason, generation, and files; add profile, durable-state availability, and trigger owner.
- Distinguish formatting ownership from trigger ownership in `session_compact` so native overflow recovery still sends exactly one autonomous continuation.
- Add generation-scoped target hints to compaction state.
- Route `/work-context compact` through the existing safe manual path.
- Fence all remaining `ctx.compact` call sites with `beginContextCompaction`/`finishContextCompaction`; preserve their existing continuation semantics.

### U4. Focused verification

- Add `scripts/test-work-compaction.mjs` for all profiles, malformed inputs, CRLF/path normalization, ordering/deduplication, bounded failed-tool evidence, budget markers, previous-summary feedback over five generations, and threshold cases from 8K through large contexts.
- Extend `scripts/test-work-goal.mjs` for native compaction ownership, exact goal statuses, explicit target hints amid multiple work items, `/work-context compact`, stale/double callbacks, simultaneous requests, and no mid-tool compaction.
- Run focused tests, LSP diagnostics, `npm run verify:quiet`, and final pi-lens diagnostics.

### U5. Documentation and rollout

- Update `README.md`: three automatic profiles, local/no-LLM formatting, sole hook ownership, context guard semantics, and small-window headroom.
- No new menu or profile setting.
- Live-smoke freeform, active WorkItem, and autonomous-goal compaction after restart. Confirm one continuation and inspect compaction details.

## Agent challenge dispositions

Three advisors were launched after the draft plan; two completed and one timed out before inspection. Accepted findings:

- Separate formatter ownership from trigger ownership.
- Fence every direct `ctx.compact` path, not only F8.
- Carry a generation-scoped WorkItem hint.
- Define exact resumable goal statuses.
- Define effective retention across the two settings surfaces.
- Specify field-to-section mapping and truncation marker.
- Add repeated-compaction feedback and Windows path fixtures.
- Test stale/double callbacks and simultaneous requests.

Simplifications accepted:

- Drop a second schema-version field while retaining the existing `details.kind` compatibility marker.
- Do not expose “VCC” terminology in product output.
- Do not select arbitrary work from the store.

## Non-goals

- Raw-session recall tool in this first release.
- Semantic inference from hidden reasoning or successful tool output.
- Preserving complete transcripts indefinitely.
- Background observational memory or cross-provider model calls.
- Changing workflow claims, retry policy, completion gates, or work-store schema.
- Coexisting with another compaction formatter in the same Pi session.

## Acceptance

1. Freeform compaction preserves the current request and relevant recent/errors/files without work-only recovery instructions.
2. Work-resume compaction preserves the explicitly selected WorkItem's durable acceptance, blockers, evidence, Git state, and next action.
3. Autonomous compaction preserves objective/status/decision and sends exactly one continuation through the correct native- or ce-triggered path.
4. Five feedback compactions remain bounded and retain stable durable sections without nested-summary growth.
5. Trigger arithmetic retains nonzero headroom on 8K, 16K, and 32K windows and preserves the 150K default on sufficiently large windows.
6. Existing F8 queuing, stale callback, usage-limit, overflow, and work-resume tests continue to pass.
7. Package verification passes with no new runtime dependency.
