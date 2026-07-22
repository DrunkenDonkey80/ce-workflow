# pi-work-orchestrator

Native Pi workflow package for staged software work through one filterable **Orchestrator** dialog.

The native work-item store at `.ce-workflow/work-items.json` is the only durable work state. Git is the only code state. Runtime logs, telemetry, locks, recovery files, exports, and backups stay ignored.

## Install

```bash
pi install /absolute/path/to/pi-work-orchestrator
pi install npm:pi-subagents
pi install npm:pi-compound-engineering
pi install npm:pi-ask-user
# Optional: pi install npm:pi-intercom
```

No tracker CLI is required for normal operation. Press **F7** to open **Orchestrator**, then type to filter its actions. **Roadmaps** is first and initially selected; its picker remembers the last open roadmap or initiative. Press **F8** to microcompact immediately when idle or at the next safe boundary.

## Orchestrator actions

| Action | Native behavior |
| --- | --- |
| **Initialize workspace** | Creates the native store when absent. |
| **Plan** | Creates or resumes a plan roadmap. |
| **Small task**, **Medium task**, **Large task**, **Auto-route task** | Classifies and creates one scoped work item. |
| **Resume work**, **Status**, **Blocker report**, **Roadmaps** | Reads and advances native state; Roadmaps also prepares initiative child plans and converts standalone roadmaps into initiatives. |
| **Add work**, **Debug**, **Checkpoint and pause**, **Finish work item** | Mutates, checkpoints, or finalizes a native work item. |
| **Brainstorm**, **Ideas**, **Usage report**, **Telemetry** | Manages ideas and local reports. |
| **Settings**, **Context guard**, **Autonomous goal** | Configures orchestration and context behavior. Proactive compaction defaults on at 150k tokens. |
| **Catch up project** | Reviews changed monitored Pi/plugin releases and records Adopt/Defer/Skip decisions. |
| **Improve orchestrator** | Validates, deduplicates, and executes open self-improvement reports in the configured source checkout. |
| **Migrate legacy workspace** | Performs the one-way migration for a detected former workflow workspace. |

Ordinary task actions use one durable `Misc` roadmap when no current roadmap is selected. When another roadmap is current, the UI asks whether new work belongs there or in `Misc`. Dedicated planning, brainstorming, and migration actions still create their own roadmaps. Untargeted **Resume work** falls back to ready `Misc` work and leaves an empty `Misc` idle.

Role agents are `work-planner`, `work-worker`, `work-reviewer`, `work-fixer`, `work-debugger`, `work-committer`, `work-migrator`, and three identical configurable advisor roles: `work-advisor`, `work-advisor-2`, and `work-advisor-3`. Configured advisors review brainstorms and plans in parallel; slice plans use the profile's `none` / `first` / `all` policy. They use `scripts/work-helper.mjs` native helpers for compact work-item summaries, initiative hierarchy, preview/apply, children, ready, claim, note, label, and blocker operations.

## Background verifiers

`F7 → Settings` → **Background verifiers** configures zero, one, or many profiles. New profiles start as **Model: [Inherit: High]** with **Test coverage** enabled; Inherit is stored as-is and resolves to the active session model only when a verifier is launched. Each profile has one unique model identity, independent checks, and a thinking effort. Global profiles apply by default; project profiles override a matching model, and a project removal is a tombstone that disables an inherited profile. Removing the last check disables that profile.

Every normal commit or checkpoint snapshots the selected scope and schedules each enabled profile asynchronously. `F7 → Analyze` uses one main menu to select checks, verifier models, and an immutable scope: current changes, last commit, whole project, or repository-relative paths/globs. Verifiers read only that immutable snapshot; they never write code or affect the active checkout. Similar completed findings are grouped for a compact inbox while retaining each model and operation attribution and its full private report. At the next `F7 → Resume work`, triage every completed, unprocessed group before roadmap work: validate it against current code, record accepted, rejected, or stale with a reason, then fix and verify every accepted finding before continuing. Running and failed jobs never block a resume. Commits made only for accepted verifier fixes do not schedule another verifier batch.

`F7 → Status` exposes `not-configured`, `queued/running`, `failed/orphaned`, `completed-awaiting-triage`, or `fully-triaged`. Durable state, recovery copies, and private raw runtime reports live under `.ce-workflow/work-runs/verifiers/`; use `F7 → Status` to recover after interruption and `F7 → Resume work` to triage when reports complete. Late valid reports from acknowledgement-timeout/orphaned launches remain recoverable. A triaged group stays out of later resumes unless explicitly reopened.

Verifier source text and reports are untrusted data. The `work-background-verifier` role is isolated to checkpoint read/list/find/grep tools: no writes, shell, network, credentials, commits, or agent launches. Its advice is attributable and advisory; it neither replaces nor satisfies the required foreground review and finish gates. Verification is checkpoint-scoped, not a whole-repository patrol.

## Workflow rules

- One executable work item is the normal session boundary.
- Use `F7 → Checkpoint and pause` to persist a checkpoint, then `F7 → Resume work <roadmap-id>` in a fresh session.
- `F7 → Status` and `F7 → Blocker report` are deterministic local projections; do not edit the store by hand during normal use.
- Initiatives aggregate child progress and route explicit execution through their durable child order. Planning a child returns to F7 instead of starting implementation; execution consumes the prepared prefix and pauses at the first child that needs planning. Initiative close cannot be forced past unresolved coverage, stale source/plan lineage, or open children. F7 previews complete hierarchy and coverage before its confirmation mints the single-use apply receipt.
- Finish requires verification evidence and any required review before the store item closes.
- Manual changes are classified before writer work starts. No parallel writers, automatic branch checkout, or push automation.
- Put project verification contracts in project instructions. Real hardware or product proof is not replaced by mocks without approval.

## Legacy migration

For a repository with the former tracker workspace, use only:

```text
F7 → Migrate legacy workspace
```

The migration command is idempotent, validates export parity, keeps an ignored backup, migrates role settings, and stops safely on lock, source-change, corruption, or recovery errors. Normal commands stop and point to this command until migration completes. The migration boundary is the only packaged code that can invoke the legacy exporter.

## Workflow improvement reporting

Set `workResume.selfImproving` to `true` only when a producer session may explicitly call `work_report_improvement`. The tool requires an observation, expected behavior, impact, and at least one approved local log. It copies complete evidence to ignored `.pi/self-improvement-reports/` storage in the configured ce-workflow checkout and creates one child task under its `Self-improving` roadmap. Reports never inspect source cleanliness, dispatch an improver, or change the source checkout. In the configured source checkout, `F7 → Improve orchestrator preview` shows the current report snapshot and `F7 → Improve orchestrator` processes it through the normal work-goal lifecycle; reports arriving during the run wait for the next invocation.

## Workflow evaluation harness

The standalone harness compares one declared workflow factor against immutable calculator and CSV-expenses bundles. Work-stage samples finalize native items in `.ce-workflow/work-items.json`; the harness does not require a tracker CLI.

Run the directly usable diagnostic descriptor from the package root:

```bash
node scripts/workflow-evaluation.mjs benchmarks/workflow-evaluation/v1/experiments/smoke.example.json
```

Every invocation uses `node scripts/workflow-evaluation.mjs <descriptor.json>` and prints retained artifact paths such as `evidencePath` and, when applicable, `reportPath` under a new operating-system temporary directory. Disposable sample workspaces are removed; the source checkout and versioned bundles must remain unchanged.

| Mode | Authority |
| --- | --- |
| `smoke` | One pair for fast failure detection. Always non-decision-grade. |
| `calibration` | Three unchanged pairs that establish noise and per-project/stage budgets without weakening fixed quality or cost floors. |
| `decision` | Three alternating fresh pairs with blinded scoring. Requires a matching calibration and fresh SHA-bound human golden approval. |
| `golden-update` | Records generated artifact hashes and acceptance evidence; it mutates approval records only after explicit human approval. |
| `sentinel` | Runs both projects through actual brainstorm → plan → work handoffs without golden substitution. Requires current approvals and calibration for all six project-stage combinations. |

The frozen model-role campaign lives in
`benchmarks/workflow-evaluation/v1/experiments/model-role-campaign.example.json`.
Its companion `role-smoke.example.json` is always non-decision-grade: one
retained diagnostic pair per exact role/model/effort arm may block only that
arm for wiring, capability, provenance, or harness failure. Smoke never ranks
candidates or promotes one because another provider is unavailable. Campaign,
pricing, seed, budgets, retry policy, approved endpoints, payload visibility,
evaluator identities, and 30-day evidence expiry must be fingerprinted before
the first paid sample. Provider credentials remain in host provider clients and
live smoke requires explicit billing authorization.

`role-calibration.example.json` freezes three unchanged pairs per applicable
project/role cell. Incumbent and finalist calibrations bind the exact bundle,
role map, prompt/tools/context, evaluator panel, seed, price table, endpoint,
rubric, and runtime fingerprints. Decisions use the conservative maximum of
both records; a missing finalist record returns `needs-more-evidence`, while a
stale or tampered record fails closed. Calibration evidence is explicitly
non-decision-grade and never enters decision aggregation.

`role-decisions/u8.example.json` freezes the U8 confirmatory matrix for
brainstorm, planner, migrator, and advisor-backup. Every contrast requires three
alternating pairs, exact identity and telemetry, two-sided calibration, and
agreement from both blinded evaluators. Unavailable, disagreement, stale, or
insufficient evidence can only produce unavailable, no-winner, or
`needs-more-evidence`; U8 never changes defaults, and committer remains the
configured deterministic control.

`role-decisions/u9.example.json` applies the same fail-closed protocol to worker,
fixer, debugger, and reviewer cases. Product behavior, verification, repository
finalization, and source immutability are hard gates checked before cost; U9
reuses U8 committer evidence and does not change defaults.

`critique-decisions/u10.example.json` freezes the shared-high 2x3 critic
factorial, declared effort cells, fixed reviser, signed empty controls, and the
optional balanced dual-critic interaction. Writer/reviser samples require real
writable fixtures; missing calibration, consumption, or valid lifecycle evidence
returns `needs-more-evidence` and cannot change defaults.

The completed U8-U10 campaign authorized no integrated mapping, so U11 retains
provider-neutral defaults and does not synthesize live sentinels or presets. A
future mapping must have fresh evidence, complete shared-role coverage, exact
observed identities, evaluator agreement, and both real project sentinels before
it becomes eligible for explicit adoption.

The other files in `benchmarks/workflow-evaluation/v1/experiments/` are starting templates. Replace every `replace-with-*` value with a retained path before running them. Missing provider credentials, evaluator access, browser capability, provenance, telemetry, calibration, or approval fails closed and cannot become passing or decision-grade evidence. Sentinel runs are mandatory for handoff, artifact, routing, finalization, default-behavior, extension, prompt, skill, agent, or otherwise non-narrow changes; documentation, benchmark-fixture, and focused test-only changes are narrow.

Candidate extensions execute with full process permissions. Path containment and fresh disposable roots protect benchmark integrity but are **not a hostile-code sandbox**. Only run trusted candidates with `"trusted": true`; untrusted candidates require `"isolation": "os"` plus an external `sandboxCommand`. Reports sanitize credential-like fields and authority-resource paths; hidden contracts, unshown answer-bank data, unselected goldens, evaluator labels, and undeclared environment differences are never exposed to the tested workflow.

CI gating, dashboards, and a `/work-*` UI wrapper remain deferred until local calibration proves the standalone harness reliable and affordable.

## Smoke checks

A clean native smoke needs no legacy executable or workspace:

```bash
node scripts/test-work-store.mjs
node scripts/test-work-store-performance.mjs
node scripts/test-work-start-finish.mjs
npm run verify
```

A legacy migration smoke is covered by:

```bash
node scripts/test-work-remove-beads.mjs
node scripts/test-work-remove-beads-windows.mjs
```

`npm pack --dry-run` verifies the publish surface. `npm run verify:quiet` is the compact package gate.
