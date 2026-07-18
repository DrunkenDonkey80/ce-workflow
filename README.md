# pi-work-orchestrator

Native Pi workflow package for staged software work through short `/work-*` commands.

The native work-item store at `.ce-workflow/work-items.json` is the only durable work state. Git is the only code state. Runtime logs, telemetry, locks, recovery files, exports, and backups stay ignored.

## Install

```bash
pi install /absolute/path/to/pi-work-orchestrator
pi install npm:pi-subagents
pi install npm:pi-compound-engineering
pi install npm:pi-ask-user
# Optional: pi install npm:pi-intercom
```

No tracker CLI is required for normal operation. In a new repository run:

```text
/work-init
/work-small add focused behavior
/work-finish <work-item-id>
```

## Commands

| Command | Native behavior |
| --- | --- |
| `/work-init` | Creates the native store when absent. |
| `/work-plan`, `/work-master` | Creates or resumes a plan epic. |
| `/work-small`, `/work-med`, `/work-big`, `/work-auto` | Classifies and creates one scoped work item. |
| `/work-resume`, `/work-status`, `/work-report`, `/work-roadmap` | Reads native state without an agent or tracker subprocess. |
| `/work-add`, `/work-debug`, `/work-pause`, `/work-finish` | Mutates, checkpoints, or finalizes a native work item. |
| `/work-brainstorm`, `/work-ideate`, `/work-usage`, `/work-telemetry` | Manages ideas and local reports. |
| `/work-settings`, `/work-context`, `/work-catch-up`, `/work-goal` | Configures orchestration and context behavior. |
| `/work-remove-beads` | One-way migration for a detected legacy workspace. |

Role agents are `work-planner`, `work-worker`, `work-reviewer`, `work-fixer`, `work-debugger`, `work-committer`, `work-migrator`, and the two work-advisor roles. They use `scripts/work-helper.mjs` native helpers for compact work-item summaries, children, ready, claim, note, label, and blocker operations.

## Workflow rules

- One executable work item is the normal session boundary.
- Use `/work-pause` to persist a checkpoint, then `/work-resume <epic-id>` in a fresh session.
- `/work-status` and `/work-report` are deterministic local projections; do not edit the store by hand during normal use.
- Finish requires verification evidence and any required review before the store item closes.
- Manual changes are classified before writer work starts. No parallel writers, automatic branch checkout, or push automation.
- Put project verification contracts in project instructions. Real hardware or product proof is not replaced by mocks without approval.

## Legacy migration

For a repository with the former tracker workspace, use only:

```text
/work-remove-beads
```

The migration command is idempotent, validates export parity, keeps an ignored backup, migrates role settings, and stops safely on lock, source-change, corruption, or recovery errors. Normal commands stop and point to this command until migration completes. The migration boundary is the only packaged code that can invoke the legacy exporter.

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
