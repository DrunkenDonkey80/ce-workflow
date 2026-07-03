---
date: 2026-07-03
topic: coded-work-report
title: Coded Work Report Requirements
---

# Coded Work Report Requirements

## Summary

Build a deterministic `/work-report` implementation that renders Beads/git blocker handoffs without spending an LLM turn. The command should support the same report targets developers use today and expose an optional JSON view that later `/work-resume` work can reuse.

---

## Problem Frame

`/work-status` already proves that useful workflow state can be produced directly from Beads and git. `/work-report` still asks the model to reconstruct a mostly mechanical blocker report from fixed-shape Beads data, git status, dependencies, and notes. That is slower, less predictable, and burns context on information the package can compute.

The immediate pain is blocked-work handoff. A report like the RFLib C-compiler blocker should be cheap, repeatable, and available in a fresh session before any agent reasoning starts.

---

## Key Decisions

- **Report before resume.** `/work-report` is the first coded slice because it gives the fastest token-saving win and produces reusable state for later resume automation.
- **Keep the human report shape.** The default output stays readable text so existing usage does not change.
- **Add optional JSON.** A flag should return machine-readable state for follow-on automation instead of forcing later code to parse prose.
- **Parse existing notes heuristically.** Version one should work with current Beads notes and fall back to raw notes when it cannot extract clean fields.
- **Do not require note migration.** Structured markers can be added later, but current projects should benefit without rewriting old Beads.

---

## Actors

- A1. **Developer** runs `/work-report` to understand why an epic or bead is blocked and what command or environment action is needed next.
- A2. **Work extension** reads Beads and git, resolves report targets, computes blocker relationships, and renders text or JSON.
- A3. **Beads workspace** stores epic hierarchy, statuses, dependencies, labels, acceptance, and notes.
- A4. **Git repository** provides branch, cleanliness, ahead/behind, and latest commit context.
- A5. **Future resume automation** consumes the JSON shape to avoid re-resolving the same state with an LLM.

---

## Requirements

**Report targets**

- R1. `/work-report <epic-id>` must render a detailed read-only report for that epic.
- R2. `/work-report last` and `/work-report` must resolve the same active or latest epic candidates used by the work workflow.
- R3. `/work-report <bead-id>` must render a focused report for one bead when the target is not an epic.
- R4. When target resolution is ambiguous, the command must list candidate epics with enough metadata for the developer to choose.

**Report content**

- R5. An epic report must include epic status, child counts by status, ready count, blocked/debug-needed count, and current git state.
- R6. An epic report must group current blockers, downstream blocked work, open decisions, and ready work separately.
- R7. A bead report must show the bead status, direct blockers, direct dependents, relevant failure detail, and a suggested next command when one can be inferred.
- R8. Reports must include raw note excerpts when heuristic extraction cannot confidently summarize the blocker.
- R9. Reports must not mutate Beads or git.

**Failure and blocker extraction**

- R10. The report must detect common failure details from existing notes, including command names, artifact/run IDs, observed blocker text, passed verification, and required next action.
- R11. Heuristic extraction may be imperfect, but it must never hide the underlying notes needed for a human handoff.
- R12. A `wo:blocked`, `wo:debug-needed`, bug, decision, or dependency edge must be enough to surface a bead as blocked even if notes are sparse.

**JSON mode**

- R13. The command must support an optional JSON output mode with the resolved target, epic summary, blocker list, downstream blocked list, git state, and suggested command fields.
- R14. JSON output must be stable enough for later `/work-resume` code to consume without parsing the human report.
- R15. JSON mode must preserve raw notes or excerpts for blockers whose details are not machine-extracted.

**Compatibility and behavior**

- R16. The default text report should remain close enough to the current LLM-written report that developers recognize the sections.
- R17. The coded report should reuse existing deterministic Beads/git helpers where possible rather than adding a separate workflow database.
- R18. The command must fail clearly when Beads is unavailable or the target is missing.

---

## Key Flows

- F1. Epic blocker report
  - **Trigger:** A1 runs `/work-report RFLib-9g6` or an equivalent epic target.
  - **Actors:** A1, A2, A3, A4
  - **Steps:** A2 resolves the epic, reads children and ready state, computes blocked and downstream work, reads git state, extracts failure details, and renders the text handoff.
  - **Covered by:** R1, R5, R6, R9, R10, R12, R16

- F2. Focused bead report
  - **Trigger:** A1 runs `/work-report RFLib-9g6.10` for a blocked or debug-needed bead.
  - **Actors:** A1, A2, A3
  - **Steps:** A2 resolves the bead, identifies blockers and dependents, summarizes notes, includes raw fallback text when needed, and suggests the next debug or environment action.
  - **Covered by:** R3, R7, R8, R10, R11

- F3. JSON handoff
  - **Trigger:** A1 or future automation requests JSON output.
  - **Actors:** A2, A3, A4, A5
  - **Steps:** A2 computes the same report state and emits a stable JSON object instead of human text.
  - **Covered by:** R13, R14, R15

---

## Acceptance Examples

- AE1. **Covers R1, R5, R6, R16.** Given an epic with one in-progress blocked child and one downstream blocked child, when `/work-report <epic-id>` runs, then the text report shows the current blocker and downstream blocked work without invoking an LLM.
- AE2. **Covers R3, R7, R8, R11.** Given a bead whose notes contain an unstructured verification failure, when `/work-report <bead-id>` runs, then the report shows direct blockers and includes enough note excerpt text for a human to act.
- AE3. **Covers R10, R12.** Given a blocker note mentions a failed CMake command, run IDs, and a required compiler action, when the report runs, then those details appear in the blocker summary when heuristics can extract them.
- AE4. **Covers R13-R15.** Given the same blocked epic, when JSON output is requested, then the response includes target, git state, blockers, downstream blocked work, suggested command, and raw fallback note fields.
- AE5. **Covers R2, R4, R18.** Given multiple active epics and no explicit target, when `/work-report` runs, then it lists candidate epics instead of guessing.

---

## Success Criteria

- The common blocked-epic report path runs as extension code and does not require a model response.
- The text output is predictable across repeated runs against unchanged Beads/git state.
- The JSON output can serve as the state contract for a later deterministic `/work-resume` resolver.
- Existing Beads notes remain usable; structured note markers are not required for v1.

---

## Scope Boundaries

- Full deterministic `/work-resume` execution is deferred to a follow-up slice.
- New structured failure-note markers are deferred; v1 uses heuristics plus raw-note fallback.
- The report remains read-only and must not create, close, label, or reorder Beads.
- The feature does not replace worker, reviewer, fixer, debugger, or committer agents.

---

## Dependencies / Assumptions

- Beads JSON commands provide enough hierarchy, dependency, status, label, and notes data to compute reports.
- Git is available in the target repository for branch and cleanliness context.
- The Pi extension command surface can register a coded `/work-report` alongside the existing coded `/work-status`.

---

## Sources / Research

- `README.md` documents `/work-status` as a cheap deterministic command and `/work-report` as the human blocker handoff view.
- `extensions/work-models.js` contains the current coded Beads/git helpers and `buildWorkStatus` implementation.
- `skills/work-orchestrator/SKILL.md` defines current report behavior, blocker lifecycle, and resume selection rules.
- Scout grounding dossier: `/tmp/compound-engineering/ce-brainstorm/llm-to-code-1783091584/grounding.md`.
