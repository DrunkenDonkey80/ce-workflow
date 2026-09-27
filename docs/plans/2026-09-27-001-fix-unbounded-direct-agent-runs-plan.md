# Bound runaway agent runs without losing 150K context filtering

Date: 2026-09-27
Status: Investigation recorded; proposed fixes, not implemented. Persistence redesign and budget values remain undecided.

## Objective and constraints

Prevent an unattended repetitive run from consuming unbounded time and usage. Preserve ce-workflow's 150,000-token context-filtering policy, bounded retained context, and deterministic local summaries. Compaction controls request size; a separate circuit breaker must control run length and spending.

Do not promise that a model can never loop. Enforce finite run budgets and a durable pause that automated continuations cannot bypass. Do not infer workflow or goal authorization from ordinary chat.

## Incident evidence

Session log:
`C:/Users/Flex/.pi/agent/sessions/--C--SOFT-git-sketchup--/2026-09-25T19-40-22-369Z_01a0da15-45e0-747c-a8fa-bc6bf6fe0822.jsonl`

- Line 1273, 2026-09-26 20:05:36 UTC (23:05 local): user requested a plan, full execution, and testing.
- Until the morning abort: 363 assistant responses, including 362 `toolUse` responses and one aborted response; 444 tool calls (357 bash, 86 read, one subagent status query).
- Recorded reasoning usage: 3,257,340 tokens. Recorded assistant cost: $169.3653368; cache-warming cost: $0.9786398. Approximately $170.34 total for this window, not a statement of actual subscription billing. Earlier $174.83/383-response totals incorrectly included morning activity.
- No edit/write tool calls occurred in this window. Repository inspection found no overnight source-file changes or commits. The existing rooms/apartments plan predated the request. Bash calls were predominantly repeated inspection; absence of edit/write tools alone would not prove absence of shell mutations.
- Line 2096, 2026-09-27 07:09:35.554 UTC: `stopReason: aborted`. The user confirmed issuing this abort in the morning.
- The aborted response contains 27,261 characters of streamed thinking despite recorded output usage of two tokens. That incomplete accounting does not establish a provider hang.
- Line 2097, 07:09:35.691 UTC: compaction with `kind: work-orchestrator-instant`, `reason: manual`, `triggerOwner: ce-workflow`, `profile: freeform`, and `tokensBefore: 140319`.
- Line 2098, 07:09:46.983 UTC: the user's morning check-in.

This was one long user-request/agent run, not an absence of intermediate tool-turn boundaries. Lack of persisted compaction entries does not prove absence of request-local filtering.

## Verified mechanisms

### 1. Native compaction is not a runaway detector

Current local model metadata gives `anthropic/claude-opus-5-5` a 1,000,000-token window. Pi's default reserve is 16,384 tokens, placing its native threshold at 983,616 tokens. No project compaction override was found. The overnight recorded assistant usage range was 51,745–163,368 tokens; 18 responses reached at least 150,000 tokens.

Installed Pi 0.87.1 checks context between assistant responses. Native context protection does not impose an elapsed-time, repetition, or cumulative-spend limit. Current metadata is not a historical snapshot of every runtime setting.

### 2. ce-workflow filters while busy and persists when idle

In `C:/SOFT/git/ce-workflow/extensions/work-models.ts`:

- `DEFAULT_CONTEXT` sets a 150,000-token trigger, 30,000 recent-token retention, and 12,000-character summary budget, subject to model-window safety clamping.
- `tool_call` invokes `maybeCompact` even for ordinary chat.
- When busy, `maybeCompact` calls `requestContextFilter`; it does not invoke native compaction immediately.
- `prepareContextFilter` and `filteredContext` replace the outgoing prefix with a deterministic summary and retained tail. The filter can rebase during a long run.
- `agent_settled` schedules `scheduleFilteredContextPersistence`, which waits for idle/no pending messages before calling `runNativeMicrocompact`.

This bounds outgoing context without terminating the agent run. Later provider usage reflects smaller requests, keeping the native high-window threshold out of reach. The morning abort supplied the idle boundary for persistence.

### 3. The existing no-progress breaker excludes this request

`enforceProjectGoalCircuitBreakers` immediately returns unless an active, running goal has mode `project`. Its 30-call nudge and 60-call no-progress stop therefore do not protect ordinary direct chat. These are existing project-goal thresholds, not yet chosen defaults for a universal guard.

### 4. Context retention may contribute, but causality is not proven

`C:/SOFT/git/ce-workflow/extensions/work-compaction.js` builds bounded summaries from requests, visible assistant messages, file operations, and selected tool records. It does not semantically summarize private reasoning. Repeated filtering can lose task decisions that were never externalized.

Provider `thinking_dropped` / `prefix_binding_mismatch` diagnostics are not proof that filtering caused the loop. A controlled replay is needed to distinguish model behavior, summary loss, and payload transformations.

## Proposed fixes, in priority order

### P1. Universal bounded-run protection

Add shared protection for ordinary chat as well as authorized goal/internal-continuation paths, without turning ordinary chat into a workflow.

- Use independent hard budgets for model requests, elapsed active time, and cumulative usage. Select defaults explicitly; account for a bounded in-flight request and unavailable pricing/usage.
- Detect repeated calls/results and lack of new evidence as stagnation signals. No file writes alone is not a valid test: legitimate research is read-only.
- Warn once, then pause at a safe boundary. A successful repeated read is activity, not necessarily progress.
- Persist the budget/pause identity across compaction, retries, reload/resume, and internal continuations. Reset or extend it only through explicit user authorization, not a synthetic resume message.
- A tripped pause must block automatic restarts from queued work, compaction-resume, and background completion notifications.
- Cover long in-flight provider requests separately from between-request checks; do not interrupt file mutation carelessly.
- Record the reason, counters, relevant repeated-call evidence, and explicit continuation path.

This is the first safety fix. It must work even if context filtering and persistence remain unchanged.

### P2. Evaluate durable boundary persistence without replacing the 150K filter

**Conditional design, not an approved replacement for the current filter.**

The intended change is where an already-selected context cut becomes durable, not when filtering triggers or how much context is retained. Evaluate Pi's completed-tool/`turn_end` boundary entry API rather than aborting an active request to call `ctx.compact`.

Required invariants:

- Keep the configured 150K trigger and existing small-window safety clamping.
- Keep bounded retained context and deterministic local summaries; no added summarization-model call by default.
- Do not replace the 150K policy with the native approximately 984K threshold.
- Persist only on an actual context cut/rebase, not on every tool call.
- Preserve complete tool-call/result pairs, the current user request, latest results, and continuation semantics.
- Align the stored projection with the chosen filtered context without double-compaction or an extra model turn. Use stable entry anchors, not indexes from an unrelated projection.
- Keep cache prefixes stable between necessary cuts. Earlier persistence can change retained entries, system checkpoints, and cache behavior; equivalence must be demonstrated, not assumed.
- Persistence must not reset run budgets or wake a circuit-breaker-paused run.

If equivalent, low-regression persistence cannot be demonstrated, retain the current filter-and-persist design. P1 still prevents another unbounded overnight run. Observability alone may be the smaller justified improvement.

### P3. Preserve a bounded task-progress checkpoint

Evaluate retaining explicit completed work, decisions, failed approaches, remaining work, and next action across repeated filtering. Reuse existing durable artifacts/visible checkpoints; do not recover or expose private chain-of-thought, add another memory subsystem, or claim the formatter can infer unwritten decisions.

Treat this as a hypothesis-driven retention improvement, not a proven fix for the model's repetition.

### P4. Failure-focused verification

Extend existing checks rather than introducing a parallel test framework:

- Endless successful read/bash loop in ordinary chat must stop within its configured budget.
- Compaction, retry, reload, and internal resume must not reset budgets or bypass a pause.
- Background completion and queued messages must not automatically restart a stopped run.
- Legitimate read-only research with new evidence must not be classified as stalled merely for lacking edits.
- Provider stalls and user cancellation must be distinguished from repetitive successful requests.
- If P2 proceeds, test repeated in-run cuts, persistence before settlement, tool pairing, canonical/outgoing projection equivalence, and no extra model turns.
- Preserve idle/manual compaction and authorized goal continuation behavior.

Existing checks run during investigation:

```sh
node scripts/test-work-compaction.mjs
node scripts/test-work-microcompact-agent.mjs
```

Both passed. The second explicitly expects request-local filtering with zero persisted compactions during active work, then persistence after settlement. Passing these checks does not establish runaway protection.

Before accepting a filtering/persistence optimization, rerun the same end-to-end benchmark against the last accepted baseline, aggregate every continuation session, and compare runtime, total provider tokens, cost, turns, and tool calls. Revert a material overall regression. Use bounded replay/live budgets; do not recreate an uncontrolled eleven-hour run.

## Scope and next decision

Only this investigation/plan is being recorded. No runtime settings or code changes are authorized by this document. Universal budget defaults, stop/continuation UX, and whether P2 is necessary remain implementation decisions. Preserve 150K filtering while addressing the independent runaway-protection gap first.
