# Plan3: optimize command, lean conversion and compact resume

Status: proposal, not implemented. Sources: analysis of a converted PrinterDrivers plan, a read-only Astra (plan3-advisor) review, and the executing session's own process review (`C:\Users\Flex\Downloads\2026-10-09-session-process-review.md`).

## Problem

A plan converted from an older document (`2026-10-07-convert-c-soft-win-printerdrivers-...-1fb6f083-plan3.md`) progresses very slowly and keeps stopping, so the user has to `/resume3` repeatedly.

Measured on that plan and its session logs:

- 814 lines, 211 KB, ~24,000 words; ~20 stacked "LATEST"/"SUPERSEDING" checkpoints in Resume context, some contradicting later ones.
- Each resume rereads the plan plus 1,943 lines of external sources (`executePrompt` demands "read the entire plan and named authoritative sources").
- 13 context compactions, 50 paged plan reads, 24 source reads during execution.
- 11 final replies, several while runnable software work remained.
- 11 WIP steps: implementation is finished but VM, hardware or installed-system acceptance keeps the step open.
- 5 post-pilot backlog steps inflate the denominator (10/35 understates pilot progress).
- `plan3 get` reports S12 as next while the checkpoint says S32: the plan has no single authoritative next step.
- The agent hashed 39 unrelated files every resume to prove it had not touched them.

### What is not the problem

- **Tiny steps.** The steps are large. Merging 35 IDs into 6 would not speed anything up.
- **Tests.** The full workspace suite takes about 20 s, and tests caught real bugs. Do not defer testing or add a result cache.

The main cost is the **stop → resume → reread → document** cycle.

## Root causes in `extensions/plan3.ts`

| Cause | Code |
| --- | --- |
| Resume requires a full reread of the plan and sources | `executePrompt()` |
| Evidence is append-only: every `step` call adds `note:`/`check:` lines forever | `markStep()` |
| `section` appends by default, so checkpoints stack | tool `section` action |
| Conversion embeds the whole source and tells the agent to preserve all progress/evidence | `createPlan()` `## Imported plan`, `convertPrompt()` |
| `next` completes the **first** WIP step, not the one actually being worked on | tool `next` action (~line 826) |
| `get` returns metadata only, so the agent reads the file instead | tool `get` / `summarize()` |
| Backlog steps count toward done/total | `summarize()` |

## Proposal

### 1. Shared `OPTIMIZE_RULES` (universal, used by convert and optimize)

One prompt constant applied to every converted or optimized plan:

1. **Resume context is one current checkpoint.** It holds the state, the exact next action and active blockers. History moves to the sidecar log.
2. **Done steps become one line:** `- [x] **S03** <summary> (log: S03)`. The full notes/checks go to the sidecar.
3. **Decisions:** active ones get one line each with their source. Superseded ones move to the log.
4. **Split implementation from external qualification.** Work needing a VM, hardware, signing, deployment or a human gets its own step ID in a final qualification phase, marked `[blocked]` with the prerequisite named. Software completion is never held hostage by missing equipment, and qualification is never waived.
5. **Backlog:** post-scope work goes in `## Backlog` with no step IDs and does not count toward progress.
6. **`## Checks` section:** canonical commands with exact env/paths are written once. Each step names its targeted check; the full suite runs at phase boundaries and before completion. This prevents guessed paths, such as the nonexistent PDFium directory that failed 6 tests.
7. **References** are listed once with the steps that need them. A resume does not require rereading them; reopen a source only when its requirement or content changed.
8. **Keep stable IDs.** Record any split/merge mapping in Amendments. Group connected work into phases; do not merge large steps just to cut the count.
9. **Never drop** requirements, non-goals, safety constraints, acceptance criteria or open questions.
10. **Unrelated files:** Git is the baseline for tracked files. Do not hash files manually.
11. **Size:** as small as faithful, with before/after size reported.

### 2. Code support in `plan3.ts`

- **`step` with `mark=done` accepts `summary`** (one line). That step's existing `note:`/`check:` lines move to the sidecar `<plan>.log.md`, and the step keeps the summary plus a log reference.
- **`checkpoint` action** *replaces* Resume context; nothing can append to it. The previous checkpoint is archived to the log.
- **`get view:"resume"`** returns a compact packet:
  - title and goal
  - constraints and non-goals
  - active decisions
  - done-step summaries
  - the full current step
  - the next step outline
  - blockers and open questions
  - the Checks section
  - the checkpoint

  It must never silently truncate safety constraints; it reports anything omitted. `view:"step"|"section"|"full"` expand on demand.
- **`executePrompt` embeds the resume packet** instead of "read the entire plan and sources".
- **Fix `next`:** complete the step being worked on (explicit `id`, else the sole WIP, else error), and skip `[blocked]` steps when picking the next one.
- **`summarize()`** excludes Backlog from the counts.
- **Sidecar paths** follow the plan through `title` renames and `archive()`.
- **Size warning:** tool results warn when the plan exceeds a KB threshold or a step holds more than a few notes.

### 3. Execution stop rule (prompt change; the session report ranks it #1)

Replace the soft "continue" wording in `executePrompt` with an explicit rule:

> After each verified increment, update the step and checkpoint, then start the next runnable step in the same turn. Stop only for: a required user decision or physical action; an external prerequisite that blocks **all** remaining runnable work; completion; cancellation; or a hard limit. A missing VM/hardware blocks only its qualification step, not unrelated software work. Record the exact stop reason in the checkpoint.

Also add check cadence: targeted checks while working, the full suite after integrated changes and before completion.

### 4. "Optimize" in the `/plans3` plan menu

In `browse()`, add `{ value: "optimize", label: "Optimize", description: "Compact into a current work document; history moves to <plan>.log.md" }` for open plans.

Flow:

1. Require an idle agent (existing `idle(ctx)`).
2. Code copies the full current plan into the sidecar log under a dated `## Pre-optimize snapshot` heading.
3. Code records the step IDs, decision IDs, open-question count and byte size.
4. Send the optimize prompt: `OPTIMIZE_RULES` plus "rewrite this plan in place, run no product checks, write no product code".
5. After the agent finishes, code **verifies**:
   - every original step ID still exists or appears in the Amendments mapping;
   - decision IDs and open questions are preserved;
   - the size before and after.

   On failure it notifies and points to the snapshot; it never deletes or overwrites the backup.

`/plan3 convert` uses the same rules. The imported source snapshot goes to the sidecar instead of `## Imported plan`.

## Rejected or deferred

- **Code-driven auto-continue on `agent_end`.** Deferred. Astra calls it a relaunch-loop risk. Try the stop rule plus the compact resume first and measure; add a capped version only if stops persist. Whether pi can queue a follow-up from `agent_end` is also unverified.
- **Automatic hash snapshot/verify tool.** Rejected for now. One plan shows it can help, but nothing shows it is common. The Git-baseline prompt rule removes the waste. Reconsider an explicit `protect snapshot|verify` action if it recurs.
- **Check-freshness fingerprints / test-result cache.** Rejected. Suites are cheap; restart overhead dominates.
- **Merging steps to reduce count.** Rejected. Steps are already large; batch by phase instead.
- **Project helpers** (e.g. an `xtask verify` command, promoting temporary serial diagnostics into the CLI). Valid, but they are PrinterDrivers project work, not plan3.
- **Partial multi-edit application.** It belongs to pi's `edit` tool, not plan3.

## Validation

1. Extend `scripts/test-work-plan3.mjs` to cover:
   - summary-on-done moving notes to the sidecar
   - checkpoint replace and archive
   - the resume view content and its no-silent-truncation rule
   - `next` focus and the `[blocked]` skip
   - backlog counts
   - sidecar survival through rename and archive
   - optimize verification failure keeping the snapshot
2. Optimize the PrinterDrivers plan as the first real run; record the before/after size and the ID mapping check.
3. Per the Optimization Regression Rule, run a comparable resume session before and after, aggregating every continuation session. Compare runtime, total tokens, cost, turns, tool calls, compactions and premature stops. Revert any part that causes a material overall regression.

## Order

1. Fix the `next` bug.
2. Summary-on-done with the sidecar log, plus `checkpoint`.
3. `get view:"resume"` and the rewritten `executePrompt` (stop rule, check cadence, no full reread).
4. `OPTIMIZE_RULES`, applied to `convertPrompt` and to the new Optimize menu item with its code verification.
5. Optimize the PrinterDrivers plan and measure.
6. Only if stops persist: capped auto-continue.
