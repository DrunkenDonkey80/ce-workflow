# pi-work-orchestrator

Native Pi workflow package for staged software work through one filterable **Orchestrator** dialog.

The native work-item store at `.ce-workflow/work-items.json` is the only durable work state. Git is the only code state. Runtime logs, telemetry, locks, recovery files, exports, and backups stay ignored.

## Install

```bash
pi install /absolute/path/to/pi-work-orchestrator
pi install npm:pi-subagents
pi install npm:pi-ask-user
# Optional: pi install npm:pi-intercom
```

No tracker CLI is required for normal operation. Run **`/wo`** or press **F7** to open **Orchestrator**, then type to filter its actions. **Roadmaps** is first and initially selected; its picker remembers the last open roadmap or initiative. `/wo goal <objective>` starts an autonomous goal, `/wo pause` waits for the current tool boundary, and `/wo resume` continues the paused goal, workflow, or direct request. `/wo compact` and **F8** share one path: compact immediately when idle, otherwise compact at the next tool boundary and continue the same operation.

Typed or dictated TUI input can use the strict start-of-line prefix **`orchestrator`**: `orchestrator list roadmaps`, `orchestrator resume work-3`, `orchestrator resume last`, `orchestrator status`, or `orchestrator compact`. `orchestrator 1` runs a currently displayed recommended action. The extension parses and handles this fixed grammar before the model sees it; unknown prefixed commands stop with usage help, while extension-authored messages cannot invoke this user command surface.

Ordinary chat requests stay direct: bare words such as `pause`, scout phrases, and numbered replies do not create work items or run workflow actions. ce-workflow orchestration starts only from an explicit `/wo` action or `orchestrator …` command.

If startup prints `pi remove npm:pi-compound-engineering`, the retired legacy package is still installed. Run that recommendation yourself; ce-workflow never invokes a package manager for legacy removal. To remove its old managed block from an `AGENTS.md`, first run `node scripts/work-helper.mjs legacy-instructions-preview AGENTS.md`, inspect the exact `removed` and `result` bytes, then explicitly apply the returned token with `node scripts/work-helper.mjs legacy-instructions-apply AGENTS.md --confirm <token>`. Missing or malformed marker pairs never mutate the file.

## Orchestrator actions

| Action | Native behavior |
| --- | --- |
| **Initialize workspace** | Creates the native store when absent. |
| **Plan** | Creates or resumes a plan roadmap. |
| **Small task**, **Medium task**, **Large task**, **Auto-route task** | Classifies and creates one scoped work item. |
| **Resume work**, **Status**, **Blocker report**, **Roadmaps** | Resume starts the extension-owned autonomous loop for the selected target; the other actions inspect or manage native state. Roadmaps also prepares initiative child plans and converts standalone roadmaps into initiatives. |
| **Add work**, **Debug**, **Checkpoint and pause**, **Finish work item** | Mutates, checkpoints, or finalizes a native work item. |
| **Brainstorm**, **Ideas**, **Usage report**, **Telemetry** | Manages ideas and local reports. |
| **Settings**, **Context guard**, **Autonomous goal** | Configures orchestration and context behavior. Proactive compaction defaults on at 150k tokens. |
| **Catch up project** | Reviews changed monitored Pi/plugin releases and records Adopt/Defer/Skip decisions. |
| **Improve orchestrator** | Validates and deduplicates new reports, then executes all open self-improvement work in the configured source checkout. |
| **Migrate legacy workspace** | Performs the one-way migration for a detected former workflow workspace. |

Ordinary task actions use one durable `Misc` roadmap when no current roadmap is selected. When another roadmap is current, the UI asks whether new work belongs there or in `Misc`. Dedicated planning, brainstorming, and migration actions still create their own roadmaps. Untargeted **Resume work** falls back to ready `Misc` work and leaves an empty `Misc` idle. A resumable target runs autonomously until its requested scope completes or a real decision, limit, error, or explicit stop pauses it; an explicit child WorkItem ID limits the loop to that item, and questions use the main chat UI.

## Context compaction

ce-workflow formats every Pi compaction locally and deterministically. It selects one of three profiles without a model call: **freeform** preserves the current user request and bounded visible context; **work-resume** rereads the explicitly selected WorkItem, evidence, related decisions, and Git state; **autonomous-goal** rereads the persisted goal and its selected durable work. Successful tool payloads and reasoning are omitted, while failed tool output is bounded and retained.

The context guard controls proactive triggering only. Turning it off does not relinquish formatter ownership: native overflow compaction and F8/manual compaction still receive a local profile. The default trigger is 150k tokens when the model is large enough; smaller context windows reserve effective recent-context retention plus the summary allowance, capped at half the window, before calculating the trigger. During an active goal, the guard checks after every completed tool and safely pauses the turn at the threshold; F8 does the same immediately instead of letting a queued compaction starve behind more model turns. Both preserve the exactly-once continuation path.

Do not install another automatic compaction extension into the same Pi profile. ce-workflow makes no background memory, embedding, summarization-model, or network request for compaction.

Role agents are `work-planner`, `work-worker`, `work-reviewer`,
`work-fixer`, `work-debugger`, `work-committer`, `work-migrator`, the
tool-free `work-divergent` generator, and three configurable advisor roles:
`work-advisor`, `work-advisor-2`, and `work-advisor-3`. Configured advisors
review brainstorms and plans in parallel; slice plans use the profile's
`none` / `first` / `all` policy. During autonomous Resume, the active project
goal owns each routine WorkItem from claim through implementation, proof,
correction, and coded finalization; it does not fracture that window into a
fresh `work-worker`. Specialists remain available for coded planning, debug,
review, or fix exceptions. They use `scripts/work-helper.mjs` native helpers
for compact summaries, initiative hierarchy, preview/apply, children, ready,
claim, note, label, capability proof, and blocker operations.

## Creative sidecar

`/wo → Settings` → **Creative sidecar** supports **Off**, **Ask** (default), and
**Auto**. Ask offers Quick or Wide for direct brainstorms, large tasks, and new
master plans; Auto chooses Wide without another prompt. Wide runs three fresh,
mutually isolated `work-divergent` branches under fixed cognitive frames, forms
the ordinary baseline independently, then merges only constraint-compatible
candidates before the configured advisors critique the result. Generator
branches reuse the enabled Advisor 1–3 model selections round-robin; with only
Inherit configured, all three still run as separate contexts on the current
model. Existing `wo:divergent-analysis` provenance is reused instead of
regenerating it.

## Background verifiers

`/wo → Settings` → **Background verifiers** configures zero, one, or many profiles. New profiles start as **Model: [Inherit: High]** with **Test coverage** enabled; Inherit is stored as-is and resolves to the active session model only when a verifier is launched. Each profile has one unique model identity, independent checks, and a thinking effort. Global profiles apply by default; project profiles override a matching model, and a project removal is a tombstone that disables an inherited profile. Removing the last check disables that profile.

Every normal commit or checkpoint snapshots the selected scope and schedules each enabled profile asynchronously. `/wo → Analyze` uses one main menu to select checks, verifier models, and an immutable scope: current changes, last commit, whole project, or repository-relative paths/globs. Verifiers read only that immutable snapshot; they never write code or affect the active checkout.

Ordinary completion verification keeps its compact raw-finding triage: at the next `/wo → Resume work`, validate each completed group, record accepted, rejected, or stale with a reason, then fix and verify accepted findings. Manual **Analyze** results instead enter `/wo → Review analysis`, where accepted and rejected recommendations remain advisory until a developer resolves the governing decision, reviews the exact task proposal, and explicitly finalizes the group. Pending or deferred analysis creates no `Misc` work; finalization alone creates executable tasks. Untargeted Resume surfaces this review first, while an explicit work-item target remains explicit. Later analyses replace pending or deferred groups without altering finalized or rejected decisions. Running and failed jobs never block a resume. Commits made only for accepted verifier fixes do not schedule another verifier batch.

`/wo → Status` exposes `not-configured`, `queued/running`, `failed/orphaned`, `completed-awaiting-triage`, or `fully-triaged`. Durable state, recovery copies, and private raw runtime reports live under `.ce-workflow/work-runs/verifiers/`; use `/wo → Status` to recover after interruption and `/wo → Resume work` to triage when reports complete. Late valid reports from acknowledgement-timeout/orphaned launches remain recoverable. A triaged group stays out of later resumes unless explicitly reopened.

Verifier source text and reports are untrusted data. The `work-background-verifier` role is isolated to checkpoint read/list/find/grep tools: no writes, shell, network, credentials, commits, or agent launches. Its advice is attributable and advisory; it neither replaces nor satisfies the required foreground review and finish gates. Verification is checkpoint-scoped, not a whole-repository patrol.

## Read-only lanes

Current-task discovery and debug can use bounded read-only lanes. Their versioned envelopes and recovery state live under `.ce-workflow/work-runs/read-only-lanes/`; `/wo → Status` reports lane kind, WorkItem, generation, checkpoint/HEAD, lifecycle, resource claims, age, reason, and concurrency/waste metrics. Same-key lanes serialize locally, while independent keys may overlap up to the configured bound. Results promote only when their generation and before/after HEAD, source, untracked-file, and WorkItem-store fingerprints still match. Cancelled, stale, late, mutation-producing, or dead-local-runner results are discarded, failed, or orphaned and never attributed as a writer commit or used to queue committed-scope verifiers.

When **Prepare next candidate** is enabled, a known direct-run reconciliation or agent-settle window may use one lane slot to prepare exactly one stable depth-one successor. The packaged `work-prefetch` role is read-only and cannot launch agents. It returns provisional context, a compact slice plan, focused future verification, unresolved decisions, and the configured advisor challenge. The main orchestrator re-derives resume selection and checks HEAD, task/acceptance, dependencies, roadmap children, verifier status, settings, relevant paths, cancellation, generation, and output shape before appending the prepared note once. Mismatches remain visible as `selection-changed`, `head-changed`, `task-revised`, `dependencies-changed`, `triage-required`, `paths-changed`, `cancelled`, `late-generation`, or `invalid-output`; ambiguous launch acknowledgement occupies the slot so duplicate work is not launched.

Finish may split one authoritative `--verify` command into repeated trusted `--verify-shard` JSON declarations. Each declaration names an id, exact command, optional `dependsOn`, `resourceKeys`, and repository-relative generated `outputs`; the authoritative command must equal the declared commands joined in order with ` && `. Only the finish invocation's repository-lock owner runs these nonmutating shards in the primary checkout. Dependency, resource, and overlapping output claims serialize; independent claims overlap within the bound. Immutable background review still uses the existing verifier checkpoint workspace and remains advisory to the foreground review policy.

Shard results join in declaration order into the exact version-1 finish manifest with command, exit status, bounded output hash/tail, real and virtual timing, claims, base HEAD, source fingerprint, and gate/schema versions. Admission requires the same invocation, schema, gate, command set, HEAD, fingerprint, required PASS set, and ordered checkpoint-review evidence. Missing, duplicate, stale, late, forged, mutated, or non-PASS evidence fails closed and cannot commit or close; ordinary finish without declarations retains the authoritative serial-command fallback and its single compact `wo:verify-check` note.

`/wo → Settings → Performance tweaks` contains global-only switches for next-candidate preparation and parallel/sequential read-only lanes, verification shards, background verifiers, and advisors. Defaults are next-candidate preparation off, verification sequential, and read-only lanes/background verifiers/advisors parallel. `WORK_ORCH_SERIAL=1` temporarily forces every performance path to sequential/off without changing saved settings. These controls do not disable background-verifier recovery or all-findings resume triage. `finish-task`, `finish-small`, and coded **Finish work item** hold the repository mutation boundary for their complete invocation, including verification; competing lanes cannot enter the primary checkout. These PID/resource locks are intentionally single-host. Do not share one checkout between hosts without an external lock service.

## Workflow rules

- One executable work item remains each deterministic execution boundary; **Resume work** continues across those boundaries autonomously.
- Use `/wo → Checkpoint and pause` to persist a checkpoint, then `/wo → Resume work <roadmap-id>` in a fresh session.
- Press **F9** for Fleet: the main-chat orchestrator is the root, with active and recent finished specialists, successor-prefetch lanes, and background verifiers beneath it. Fleet distinguishes running, queued, waiting-for-decision, paused, completed, stopped, and failed states.
- `/wo → Status` and `/wo → Blocker report` are deterministic local projections; do not edit the store by hand during normal use.
- Initiatives aggregate child progress and route explicit execution through their durable child order. Planning a child returns to the `/wo` menu instead of starting implementation; execution consumes the prepared prefix and pauses at the first child that needs planning. Initiative close cannot be forced past unresolved coverage, stale source/plan lineage, or open children. /wo previews complete hierarchy and coverage before its confirmation mints the single-use apply receipt.
- An implementation-ready plan with a validated JSON `implementationUnits` manifest materializes those WorkItems directly; headings alone do not assert readiness, and Resume does not launch a second planner.
- Every materialized WorkItem carries a capability-driven verification contract. Capabilities are per item (`inspection`, `command`, `service`, `browser`, `desktop`, `android`, `device`, `macos`, `ios`, or `manual`), so mixed repositories need no global application type.
- Finish requires every declared proof plus any required review before the store item closes. Browser, desktop, and Android visual proof is revision-bound to a retained screenshot and a recorded goal/human inspection; unavailable required capabilities block rather than degrade to PASS.
- Manual changes are classified before writer work starts. No parallel writers, automatic branch checkout, or push automation.
- Real hardware or product proof is not replaced by mocks without approval.

## Legacy migration

For a repository with the former tracker workspace, use only:

```text
/wo → Migrate legacy workspace
```

The migration command is idempotent, validates export parity, keeps an ignored backup, migrates role settings, and stops safely on lock, source-change, corruption, or recovery errors. Normal commands stop and point to this command until migration completes. The migration boundary is the only packaged code that can invoke the legacy exporter.

## Workflow improvement reporting

Set `workResume.selfImproving` to `true` only when a producer session may explicitly call `work_report_improvement`. The tool requires an observation, expected behavior, impact, and at least one approved local log. It copies complete evidence to ignored `.pi/self-improvement-reports/` storage in the configured ce-workflow checkout and creates one child task under its `Self-improving` roadmap. Reports never inspect source cleanliness, dispatch an improver, or change the source checkout. In the configured source checkout, `/wo → Improve orchestrator preview` shows the current backlog snapshot and `/wo → Improve orchestrator` processes it through the normal work-goal lifecycle; work arriving during the run waits for the next invocation.

## Workflow evaluation harness

The standalone harness compares one declared workflow factor against immutable calculator and CSV-expenses bundles. Work-stage samples finalize native items in `.ce-workflow/work-items.json`; the harness does not require a tracker CLI. The deterministic adoption replay (`node scripts/run-work-slice-benchmarks.mjs`) records three calculator and CSV pairs, quality, runtime, novel/cached context, provider-token totals, ownership, verifier use, and specialist counts in `benchmarks/work-slice-adoption.json`; changes below 10% are reported as noise.

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
