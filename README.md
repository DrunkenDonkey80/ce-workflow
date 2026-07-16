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
