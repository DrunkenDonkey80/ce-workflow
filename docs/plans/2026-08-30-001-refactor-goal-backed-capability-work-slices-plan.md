---
title: Goal-backed capability-driven work slices - Plan
type: refactor
date: 2026-08-30
topic: goal-backed-capability-work-slices
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
---

<!-- markdownlint-disable-next-line MD025 -->
# Goal-backed capability-driven work slices - Plan

## Goal capsule

- **Objective:** Preserve ce-workflow's durable roadmap, safety, recovery, and coded finalization while letting one autonomous goal own each executable WorkItem from claim through real product acceptance.
- **Primary correction:** Stop routine fresh-context planner/worker/reviewer chains from fragmenting implementation ownership and replaying context.
- **Validation model:** Use per-WorkItem capability-driven verification contracts, not one global application type and not web-path heuristics.
- **Multi-slice model:** Execute one vertical WorkItem per operational window, persist its proof, commit and close it, compact, then start the next window with the roadmap's durable product capsule.
- **Constraints:** One writer, no nested goals, no silent gate waiver, no mandatory reviewer for ordinary work, and no claim that unavailable desktop/device capabilities passed.
- **Validation:** Focused state/contract fixtures, non-UI and browser benchmark A/B runs, mixed-capability fixtures, multi-slice interruption recovery, package verification, and live modality smokes where the required runtime exists.

## Execution baseline and scope

This repository already contains a partial candidate implementation. Execution must reconcile and extend it rather than restart the design:

- **Candidate present:** verification-contract schema/status, requirement inference, partial executable-plan materialization, goal-owned slice routing, coded proof/finalization, and focused fixtures.
- **Live benchmark evidence present:** one two-slice browser calculator run completed with retained interaction, logs, screenshot, and inspection records. This is benchmark evidence only; it does not establish trusted adapter-issued proof until U1/U4 provenance is implemented.
- **Still required:** validated materialization of declared fields/dependencies/contracts, hard proof provenance, per-entry command binding, close-path enforcement, blocked-item lifecycle, a goal-window writer fence, a generic adapter registry and lifecycle, headless/service proof, Windows desktop proof, Android emulator proof, mixed-capability recovery, cross-slice impact, telemetry attribution, and the complete adoption matrix.
- **Not established by the calculator:** generic browser provisioning, desktop/mobile portability, service/device behavior, interruption recovery, lower token cost, or zero routine specialist launches.

Implementation and live-proof scope for this plan:

| Surface | Required implementation proof | Live proof in this environment |
| --- | --- | --- |
| Command/CLI/data | exact process, stdin/files, stdout/stderr, exit status, output artifacts | required |
| Service/backend | lifecycle, health/protocol interaction, logs, shutdown | required |
| Browser UI | interaction, accessibility, logs/console, viewport screenshots, inspection | required |
| Windows desktop | configured native launch/interaction runner, logs, screenshots, cleanup | required when a runnable fixture/driver is available; otherwise typed blocker plus deterministic adapter fixture |
| Android mobile | Gradle/ADB emulator identity, install/launch, interaction, rotation/state when declared, logcat, screenshots, cleanup | required with the available Android emulator |
| Hardware/manual | device identity where available and explicit manual authority where automation ends | deterministic fixture; live only when hardware exists |
| macOS/iOS | capability must be representable and must report unavailable without fabricated proof | live execution deferred because no macOS/iOS runtime is available |

No production path, adapter, prompt, or acceptance gate may depend on the calculator benchmark directory, its hidden acceptance script, or a parent-relative fixture path. The calculator is one consumer of the same public capability contract used by all fixtures.

## Plan review disposition

A fresh read-only Claude Opus 5 review blocked the earlier draft on proof integrity and lifecycle gaps. This revision accepts its evidenced findings: trusted adapter provenance, per-entry command binding, close-path enforcement, no missing-contract PASS, blocked-item continuation, writer fencing, declared-first contract derivation, validated materialization, explicit background-verifier accounting, named Android/Windows fixtures, durable human waivers, readiness vocabulary, mid-window compaction, headless parity, and repeated benchmark statistics. GLM 5.3 did not review the plan because its provider quota was exhausted; no GLM opinion is represented here.

## Evidence motivating the change

The calculator A/B at source revision `cc30c13` used the same model, effort, plan, seed, and viewport.

| Lane | Result | Runtime | Provider tokens | Cost | Product acceptance |
| --- | --- | ---: | ---: | ---: | ---: |
| ce-workflow recovered through `/wo resume` | Stopped at 2/3 slices | 1,002.673 s | 2,963,008 | $3.491149 | 17/18, failed console cleanliness |
| direct `/goal` | Complete | 665.271 s | 1,875,127 | $2.152210 | 18/18, passed |

Of ce-workflow's 1,087,881 additional provider tokens, 1,001,908 (92.1%) were cache reads. Novel input/output was still 41.2% higher. The workflow replayed parent orchestration, planner/recovery, fresh workers, review, monitoring, and blocker context while losing coherent product ownership between those contexts.

The direct goal had no independent UI reviewer. It produced the stronger result because one context owned HTML, CSS, JavaScript, browser provisioning, executable acceptance, screenshot inspection, and correction. The workflow instead split behavior from presentation, accepted the UI slice using a Node VM test, and deferred its required browser proof into a later external blocker.

## Decisions

1. **Use the existing project goal instead of nesting `/goal`.** `/work-resume` already calls `startWorkGoal("project", ...)`. Starting another goal would replace the active goal. The active project goal becomes the routine implementation owner.
2. **Keep coded orchestration around the goal.** Target selection, dependency checks, claim, dirty-tree safety, proof completeness, commit, close, push, and recovery remain deterministic extension behavior.
3. **One WorkItem equals one operational window.** The same goal context implements, verifies, inspects artifacts, and corrects one selected item until its verification contract passes or a real blocker is recorded.
4. **Compact only at a durable boundary.** After coded commit/close, regenerate context from the native store, Git, the parent product capsule, and retained proof. Do not carry the full implementation transcript into the next item.
5. **Prefer vertical slices.** A WorkItem must be independently demonstrable against a user-observable outcome. Planning must merge or reslice layer-only work when markup, behavior, styling, persistence, or device interaction cannot be accepted independently.
6. **Do not plan twice.** A newly produced executable plan creates its roadmap and children during plan finalization. An imported executable plan gets one bounded materialization pass, not another open-ended planner. `/work-resume` invokes a planner only when no implementation-ready units exist or new evidence invalidates the current plan.
7. **Use capability-driven verification contracts.** Every executable WorkItem declares required proof independently of project type. A mixed repository or one item may require several capabilities.
8. **Declared proof is authoritative; inference is additive.** Requirement-derived proof cannot be removed by changed-path heuristics. Conservative project/path inference may add a missing gate or stop for clarification, but it may never silently waive a declared gate.
9. **Visual proof is platform-neutral.** Browser, desktop, and Android UI work all require representative rendered states, interaction where applicable, runtime logs, retained screenshots, and recorded inspection by the owning goal. Browser-specific logic is only one adapter.
10. **Unavailable required capability blocks.** The goal may safely provision a local runtime or use a configured device, but missing browser, emulator, desktop driver, credential, hardware, or human authority is `blocked`, never `PASS`.
11. **Reviews are exceptions, not phase boundaries.** Keep independent review for security-sensitive, large, ambiguous, policy-required, or explicitly requested changes. Do not launch a reviewer merely because a routine slice exists or has UI.
12. **Measure quality before savings.** Adoption requires non-regressing acceptance and qualitative output first, then lower context, tokens, runtime, and unnecessary role calls.

## Product contract

### Actors

- **Developer:** supplies a request, approved plan, decisions, credentials, devices, or explicit waivers when genuinely required.
- **Coded orchestrator:** owns durable selection, claims, safety, contracts, state transitions, finalization, and recovery.
- **Active project goal:** owns one selected WorkItem's implementation and complete proof loop.
- **Capability adapter:** probes and executes one observable proof surface such as command, service, browser, desktop, Android, device, inspection, or manual authority.
- **Optional specialist:** handles a proven planning, debugging, review, or fixing exception without becoming the routine path.

### Requirements

#### Planning and materialization

- **R1.** `/work-plan` finalization must persist the approved plan and its validated implementation units together; resuming that roadmap must not create a second planning item.
- **R2.** An imported plan marked `implementation-ready` must be materialized once into native children while preserving unit order, declared dependencies, acceptance, files/surfaces, verification requirements, non-goals, and parent product constraints. `executable` is accepted only as a backward-compatible alias normalized to `implementation-ready`.
- **R3.** A materializer may normalize and validate units but may not redesign, broaden, or reslice an approved plan. Every materialized unit requires a stable key/title, independently testable outcome, acceptance, dependency declaration, files/surfaces or an explicit discovery allowance, and a declared verification contract. Ambiguous or incomplete input returns a planning-required state listing the exact missing fields; headings alone never imply readiness.
- **R4.** A planner is eligible only for raw objectives, plans without executable units, exhausted roadmaps with new failing evidence, or an explicit user request to replan.
- **R5.** Every executable child must be vertical enough to produce independent observable proof. Layer-only units that cannot pass independently must be merged or rewritten before execution.

#### Goal-backed operational window

- **R6.** `/work-resume` must select and claim one ready WorkItem, then let the already-active project goal own it until completion or a durable blocker.
- **R7.** Routine `run-implementation` must not launch a fresh `work-worker`. The current goal receives a bounded capsule containing item identity, parent objective, requirements, acceptance, dependencies, decisions, allowed safety scope, verification contract, and current Git state.
- **R8.** The goal may inspect and change every file needed for the selected vertical outcome, subject to dirty-tree safety and explicit exclusions; file lists are evidence/safety bounds, not artificial layer boundaries.
- **R9.** Intermediate model turns, failed checks, artifact inspection, and fixes remain in the same operational window. The workflow must not hand implementation, browser proof, or ordinary corrections to a fresh agent merely to advance a phase.
- **R10.** Coded completion must reject an open contract requirement, stale artifact, uninspected required visual, dirty unrelated path, failed check, missing commit evidence, or nonterminal WorkItem.
- **R11.** After completion, coded finalization commits and closes exactly that item, persists a bounded result capsule, then compacts or starts a fresh session before selecting the next item.
- **R12.** Interruption recovery must reconstruct the same window from store/Git state without duplicate writers, duplicate goals, repeated planning, or reliance on chat transcripts.

#### Capability-driven verification

- **R13.** Add a validated `verificationContract` to executable WorkItems. Version 1 contains bounded required proof entries with stable IDs and these fields:
  - `capability`: `inspection`, `command`, `service`, `browser`, `desktop`, `android`, `device`, or `manual`;
  - `proof`: `build`, `test`, `interaction`, `output`, `visual`, `accessibility`, `logs`, `performance`, `security`, or `approval`;
  - `source`: requirement/acceptance reference;
  - bounded execution parameters or instructions;
  - required artifact kinds;
  - whether model inspection or human approval is required.
- **R14.** Every executable item has at least one required proof entry. Documentation/configuration-only work may use inspection or command proof; it is not forced through a UI adapter.
- **R15.** Planning derives contracts from requirements and acceptance, not merely filenames. Project capability probes and changed paths are conservative validation inputs that may add requirements but may not remove declared proof.
- **R16.** Mixed items may require multiple capabilities, such as command tests plus browser visual/accessibility, Android interaction plus logcat, or service interaction plus output validation.
- **R17.** Adapter evidence records adapter/capability/version identity, exact operation or command, exit/result, bounded logs, artifact paths and hashes, target revision, cleanup result, and the WorkItem/contract entry it satisfies. PASS evidence for executable capabilities is accepted only from the coded adapter runner; model-authored prose or artifact references cannot mint PASS.
- **R18.** A required `visual` proof records representative state names and screenshots. Completion also requires a recorded read/inspection of the current artifact hash by the owning goal, with concise observations; artifact existence alone is insufficient.
- **R19.** A required `logs` proof defines its failure condition, such as no browser console errors, no Android fatal logcat entries, or no desktop runtime exceptions. A non-visual unit is not forced to produce screenshots.
- **R20.** A required capability that cannot be probed or executed returns a typed blocker containing the missing runtime/device/credential/human action and a safe resume path. It cannot degrade to coded review, NOOP, or inferred PASS. Blocking releases the active writer fence, persists partial proof, and permits independent ready slices to proceed; the roadmap remains incomplete until the blocker is resolved or explicitly waived.
- **R21.** Waiving required proof requires explicit user authority, a bounded rationale, affected contract entry IDs, and durable human-decision evidence. The owning goal cannot create its own waiver or weaken a contract it will satisfy.
- **R38.** Each command proof declares its own command, environment, timeout, expected exit status, and bounded output/file assertions. One verification invocation cannot fan out PASS to several contract entries unless the contract explicitly declares one shared operation and each assertion is independently evaluated.
- **R39.** Hand-authored `work-proof` may record inspection/manual evidence or FAIL/BLOCKED observations. PASS for command, service, browser, desktop, Android, or device proof is issued only by the matching coded adapter after execution.
- **R40.** Every executable item has a validated contract before claim. Legacy items receive one bounded command or inspection contract through a deterministic compatibility migration; missing contract is never `ok: true` for executable work.
- **R41.** Every close path, including direct close and roadmap closure, rejects incomplete, blocked, stale, uninspected, wrong-revision, or untrusted proof. Only deterministic finalization may close a contract-bearing executable item.
- **R42.** A blocked item transitions durably, releases its claim/window fence, records the exact resume action, and does not deadlock the controller. An autonomous goal may continue independent ready items but must end `blocked`/`needs_human`, not `complete`, while required blockers remain.
- **R43.** Goal-owned windows acquire a session-owned writer fence with heartbeat, generation, base revision, and bounded stale/orphan recovery. A second session cannot claim the same item until coded recovery proves the prior owner is gone.
- **R44.** Declared verification requirements are authoritative. Keyword/path inference runs only when declared proof is absent and may add conservative entries; inferred-only false positives have a bounded explicit-user correction path with durable provenance.

#### Modality behavior

- **R22.** Browser items can require navigation, viewport/state interaction, accessibility, console, persistence, and screenshot proof through a browser adapter.
- **R23.** Desktop items can require build/launch, application interaction through an available platform driver, runtime logs, window-state screenshots, and cleanup through a desktop adapter.
- **R24.** Android items can require build/install/launch, emulator or connected-device identity, UI interaction, rotation/state handling when declared, logcat checks, screenshots, and cleanup through an Android adapter.
- **R25.** Backend/service items can require startup/health, protocol interactions, response assertions, logs, and shutdown without any visual gate.
- **R26.** CLI/data items can require exact commands, stdin/files, stdout/stderr, exit status, output hashes/content, and no partial writes without any application profile.
- **R27.** Hardware/device items can require detected device identity and executable checks where available; inherently physical or safety-sensitive observations remain explicit manual proof rather than fabricated automation.
- **R28.** A repository does not receive one permanent `web`, `desktop`, `android`, or `backend` label. Capabilities attach to individual proof entries so one roadmap can span several products and surfaces.

#### Multi-slice continuity and specialists

- **R29.** Every item window receives a stable parent product capsule containing cross-slice invariants, approved design/reference traits, non-goals, decisions, and prior user-observable outcomes.
- **R30.** Dependency evidence and relevant artifacts pass forward by bounded reference and hash, not by copying prior transcripts or all WorkItem notes.
- **R31.** A later item may revise earlier code when required by its vertical outcome, but it must rerun every affected prior contract entry selected by deterministic impact rules.
- **R32.** Planner, debugger, reviewer, and fixer launches require a coded reason. Their output returns to the same item window or durable state; they do not silently create a new implementation owner.
- **R33.** One writer remains authoritative. Independent read-only checks may run concurrently only when their evidence and target revision are fenced.

#### Context and telemetry

- **R34.** Telemetry must separate current-goal implementation, coded orchestration, optional specialists, adapters, and deterministic verification.
- **R35.** Record total/input/output/cache-read/cache-write tokens, cost, runtime, model turns, compactions, role launches, retries, repeated file reads, questions, and acceptance outcomes per WorkItem window.
- **R36.** Context summaries include only the current item capsule, parent capsule, bounded blockers/decisions, Git state, current failed evidence, and next action. Operational policy prose must not be copied into WorkItem notes repeatedly.
- **R37.** A routine successfully planned implementation must use one implementation owner and zero planner/reviewer/fixer launches unless a coded exception is recorded. Read-only background verifiers are not implementation specialists, but their launches, tokens, wall time, findings, and completion gating are attributed separately and cannot be hidden from the comparison.
- **R45.** Mid-window compaction preserves the writer-fence generation, item/parent capsule, contract hash, passed/failed/blocked entry IDs, artifact hashes, Git revision, current blocker, and next action. It cannot create another writer or replay planning.
- **R46.** Budget/no-progress exhaustion stops the window with durable partial state and a typed resume reason; it never turns incomplete proof into PASS or silently loops.
- **R47.** Goal-owned routing and one-writer semantics are equivalent in TUI, RPC, print, and JSON/headless operation. A non-interactive caller must not fall back to a fresh routine worker merely because no TUI is present.

## Verification contract examples

### Browser UI slice

```json
{
  "version": 1,
  "required": [
    { "id": "tests", "capability": "command", "proof": "test", "source": "Slice acceptance", "artifacts": ["result"] },
    { "id": "interaction", "capability": "browser", "proof": "interaction", "source": "User flows", "artifacts": ["result"] },
    { "id": "visual", "capability": "browser", "proof": "visual", "source": "Responsive presentation", "artifacts": ["screenshot"], "inspection": "goal" },
    { "id": "console", "capability": "browser", "proof": "logs", "source": "Console cleanliness", "artifacts": ["log"] }
  ]
}
```

### Android slice

```json
{
  "version": 1,
  "required": [
    { "id": "build", "capability": "command", "proof": "build", "source": "Release criteria", "artifacts": ["result"] },
    { "id": "device-flow", "capability": "android", "proof": "interaction", "source": "Screen flow", "artifacts": ["result"] },
    { "id": "screen", "capability": "android", "proof": "visual", "source": "Screen states", "artifacts": ["screenshot"], "inspection": "goal" },
    { "id": "logcat", "capability": "android", "proof": "logs", "source": "Crash-free operation", "artifacts": ["log"] }
  ]
}
```

### CLI/data slice

```json
{
  "version": 1,
  "required": [
    { "id": "tests", "capability": "command", "proof": "test", "source": "Behavior cases", "artifacts": ["result"] },
    { "id": "report", "capability": "command", "proof": "output", "source": "Exact report contract", "artifacts": ["stdout", "file"] }
  ]
}
```

These are examples, not fixed application profiles. A WorkItem includes only the proof it actually needs.

## Key flows

### F1. Approved plan proceeds without second planning

1. Plan finalization validates implementation units and their verification contracts.
2. It persists the plan, roadmap, children, dependencies, and parent product capsule together.
3. `/work-resume` finds a ready child and does not create or launch a planning item.
4. If an external plan lacks materializable units, one bounded materializer reports exact missing fields or creates children without redesigning it.

### F2. One goal-backed WorkItem window

1. Coded resume selects and claims one ready item after safety checks.
2. The active project goal receives its bounded durable capsule.
3. The goal reads requirements/code, implements across the necessary surfaces, and runs required proof adapters.
4. Failures and artifact inspection feed the same goal until every entry passes or a typed blocker is durable.
5. Coded finish validates revision-bound evidence, commits, closes, and compacts.

### F3. Multi-slice roadmap

1. The next item is selected only after the prior item's durable boundary.
2. It receives the parent product capsule, dependency outcomes, and relevant artifact references.
3. It owns a new operational window without replaying earlier implementation transcripts.
4. If it affects prior accepted behavior, deterministic impact rules add the affected proof entries.
5. The loop continues until the roadmap closes or a real external decision/capability blocks it.

### F4. Modality-specific proof without app profiles

1. Planning attaches proof entries based on requirements.
2. The adapter registry probes only capabilities required by the selected item.
3. Web, desktop, Android, service, CLI, and device entries execute through their matching adapter.
4. Missing optional capabilities are irrelevant; missing required capabilities block precisely.
5. Visual artifacts are inspected by the owning goal regardless of rendering platform.

### F5. Exceptional specialist

1. A coded condition identifies planning ambiguity, unexplained failure, sensitive/large diff, or a concrete finding.
2. One matching specialist receives bounded evidence.
3. Its result is persisted and returned to the same item window or coded next state.
4. No routine worker/reviewer chain is launched.

## Acceptance examples

- **AE1 — No double planning:** Given an approved executable plan with two validated units, `/work-resume` immediately claims the first unit and launches no planner.
- **AE2 — Imported incomplete plan:** Given a prose plan without acceptance or verification, materialization stops with the missing fields; it does not invent a backlog and call it approved.
- **AE3 — Coherent UI ownership:** Given a browser slice spanning markup, behavior, style, persistence, and accessibility, one goal may modify all required files, must pass browser interaction/console/screenshot proof, must read the screenshot, and only then may finish.
- **AE4 — Non-UI efficiency:** Given a CLI parser slice requiring exact output and error behavior, no browser, screenshot, UI reviewer, desktop, or Android gate runs.
- **AE5 — Android proof:** Given an Android UI item and an available emulator, completion requires build/install/launch, declared interaction, screenshot inspection, and clean declared logcat conditions. Without an emulator/device, the item blocks with the required operator action.
- **AE6 — Desktop proof:** Given a desktop visual item, a browser screenshot cannot satisfy its desktop visual entry; the configured desktop runner and current artifact are required.
- **AE7 — Mixed repository:** Given one roadmap with backend, browser, and Android children, each child runs only its contract capabilities while sharing the parent product invariants.
- **AE8 — Multi-slice continuity:** Given three dependent vertical items, each commits and closes independently; the next starts from durable state after compaction, and later changes rerun affected prior proof without replaying prior chats.
- **AE9 — Real blocker:** Given required physical-device approval that cannot be automated, the workflow records a manual proof blocker and stops rather than substituting tests or a reviewer.
- **AE10 — Reviewer exception:** Given a small ordinary item whose contract passes, zero reviewers run; given a security-sensitive item, the coded policy requires one revision-fenced review before finish.
- **AE11 — Recovery:** Given interruption after changes but before proof completion, resume reconstructs the same claimed item and failed entries without a second writer, planner, or duplicate implementation goal.
- **AE12 — Context reduction:** In the calculator benchmark, the candidate must pass all product gates and qualitative scoring before token/runtime comparison; it must reduce total and novel context without adding questions or role failures.
- **AE13 — Trusted proof:** Given a browser/desktop/Android contract, a model-authored PASS note and a matching screenshot file cannot satisfy it; only revision-bound adapter-issued execution evidence plus required inspection can.
- **AE14 — Per-entry commands:** Given separate test and exact-output entries, one trivial command cannot satisfy both; each declared assertion is evaluated against its own or explicitly shared operation.
- **AE15 — No close bypass:** Given incomplete contract proof, direct close, roadmap close, and goal completion all reject the item.
- **AE16 — Block and continue:** Given one unavailable Android slice and one independent CLI slice, the Android item releases its fence with a typed blocker, the CLI slice may proceed, and the roadmap cannot report complete.
- **AE17 — Writer fencing:** Given two sessions resuming the same item, only one acquires the goal-window fence; stale recovery requires generation and process/session evidence.
- **AE18 — Headless parity:** Given the same ready item through TUI and RPC/JSON operation, both use the active goal owner and neither launches a routine fresh worker.

## Implementation units

### U1. Verification-contract schema and deterministic core

- **Files:** `extensions/work-store.js`, `extensions/work-action-leases.js`, a small new capability-contract module, helper commands, and focused tests.
- **Approach:** Add bounded `verificationContract` validation, stable proof IDs, trusted adapter evidence validation, revision/artifact hashes, per-entry command operations/assertions, explicit human waiver records, declared-first/additive inference, and proof-completeness calculation. Restrict hand-authored PASS, enforce every close path, and preserve old items through a compatibility path that materializes one bounded command/inspection requirement rather than treating missing proof as pass.
- **Independent proof:** Valid mixed contracts round-trip deterministically; malformed/oversized/unknown entries fail closed; trivial/shared command fan-out, self-authored PASS/waiver, direct-close bypass, unavailable/failed/stale/uninspected/wrong-revision proof cannot satisfy finish.

### U2. Plan finalization and one-time materialization

- **Files:** private plan workflow contract, plan reconciliation/finalization code, migration path, work-store creation helpers, and planner/migration fixtures.
- **Approach:** Make new plan finalization return validated structured implementation units and persist native children with the plan. Parse declared acceptance, dependencies, files/surfaces, non-goals, and verification contracts instead of inferring readiness from headings or linearizing every dependency. Add a bounded external-plan materializer that preserves authority and has no redesign permission. Normalize readiness vocabulary, remove the automatic planning placeholder when ready children exist, and repair action-lease/helper contract drift exposed by the calculator run.
- **Independent proof:** New and imported implementation-ready two-slice plans preserve declared graph/contracts and resume directly with zero planner launches; incomplete or heading-only plans stop with deterministic missing-field evidence.

### U3. Goal-backed command/non-UI operational window

- **Files:** `extensions/work-models.js`, work-goal lifecycle code, compaction projection, action-lease integration, and focused resume/goal tests.
- **Approach:** Route routine `run-implementation` to the already-active project goal in TUI and headless/RPC modes instead of `directRoleHandoffParams(... context: "fresh")`. Acquire one session-owned window fence; let repeated turns and mid-window compaction preserve that generation; release it on coded close or durable block; gate `goal_complete` on native proof completeness; run coded finalization, then compact at the item boundary.
- **Independent proof:** The CSV benchmark completes multiple slices with one owner per item, no routine worker/reviewer, exact output proof, interruption and mid-window compaction recovery, clean commits, headless/TUI parity, and lower context than baseline.

### U4. Browser and platform-neutral visual proof

- **Files:** capability adapter registry, existing private browser workflow seam, visual artifact tracking/inspection, finish gates, and browser fixtures.
- **Approach:** Replace web-path-as-authority with declared browser/visual contracts. Implement a coded browser adapter over the available browser-provider/tool seam; the existing private browser prompt may guide operations but is not proof provenance. Require adapter-issued viewport/state interactions, console/log conditions, screenshot hashes, target revision, cleanup, and recorded goal inspection. Keep changed-path detection only as an additive safety net for undeclared UI changes.
- **Independent proof:** A repository-owned calculator fixture passes behavior, accessibility, persistence, console, screenshot, provenance, and qualitative UI gates without benchmark-parent paths or a routine reviewer; self-reported, stale, wrong-revision, or unread screenshots fail.

### U5. Generic adapter lifecycle and non-browser modalities

- **Status:** implemented; generic adapters, deterministic blockers, and live browser/process/service/Windows desktop/Android fixture proof are covered by the adoption matrix.
- **Files:** a small capability-adapter registry, process/service helpers, configured platform wrappers, fixtures, documentation, and package inventory.
- **Common contract:** each adapter exposes bounded `probe`, `run`, `collect`, and `cleanup` operations. Inputs name the WorkItem, contract entry, execution root, declared parameters, and artifact destination. Outputs include adapter/version identity, availability, exact operations, exit/result, bounded logs, artifact paths/hashes, cleanup status, and a typed blocker when unavailable.
- **Command/CLI/data:** use the native process runner; capture stdin/files, stdout/stderr, exit status, exact output assertions, and partial-write behavior.
- **Service/backend:** own startup, readiness, protocol checks, bounded logs, and shutdown. A process left running is a failed cleanup, not PASS.
- **Windows desktop:** use only an explicitly configured native runner or installed platform driver. Record executable identity, window/process state, interactions, runtime logs, screenshots, and cleanup. Browser screenshots cannot satisfy desktop proof.
- **Android mobile:** reuse configured Gradle, ADB, and emulator tooling. Record emulator/device identity, build/install/launch, declared UI interactions, rotation/state behavior when required, logcat conditions, screenshots, and cleanup.
- **macOS/iOS:** retain portable capability entries and adapter registration seams, but do not implement speculative untestable automation in this environment. Probing must return a typed unavailable blocker; future platform adapters plug into the same lifecycle contract.
- **Hardware/manual:** record detected device identity and executable checks where possible; preserve explicit human approval for inherently physical or safety-sensitive observations.
- **Constraint:** do not add a permanent project-type setting or one giant cross-platform adapter. Register only small capability implementations backed by native tools or explicit configuration.
- **Fixture deliverables:** add a minimal repository-owned local HTTP/CLI fixture, Android Gradle app, and Windows desktop fixture/runner contract. Keep each fixture only large enough to prove lifecycle and evidence; they are test subjects, not product frameworks.
- **Independent proof:** deterministic adapters cover every capability, lifecycle transition, cleanup failure, stale artifact, and unavailable state. Live command, service, browser, Android-emulator, and Windows-desktop smokes use those named fixtures and pass; unavailable macOS/iOS/hardware remain blocked, never accepted. No single external-tool or child wait exceeds 15 minutes.

### U6. Multi-slice continuity, impact, and specialist exceptions

- **Files:** resume selection, parent product capsule, dependency projection, affected-proof selection, specialist routing, context compaction, and recovery tests.
- **Approach:** Carry stable cross-slice invariants and hashed artifacts through the store; rerun prior proof affected by later changes; preserve window state through compaction; release fences on durable blockers; allow independent ready slices to proceed without reporting the roadmap complete; require coded reasons for planner/debugger/reviewer/fixer. Remove repeated operational guidance from item notes and keep it in extension policy.
- **Independent proof:** A three-slice mixed-capability roadmap survives interruption, mid-window compaction, one unavailable capability, and a competing-resume attempt; it preserves product coherence, reruns affected proof, never duplicates a writer, and launches specialists only for seeded exception cases.

### U7. Telemetry, paired evaluation, rollout, and cleanup

- **Files:** work telemetry, workflow evaluation descriptors/fixtures, README/orchestrator docs, and obsolete routine handoff paths after evidence supports removal.
- **Approach:** Attribute usage separately to coded orchestration, goal window, adapters, background verifiers, and optional specialists. Run at least three paired calculator and CSV comparisons with identical model/effort/inputs, then the mixed-capability fixture; compare medians and treat changes below 10% as noise. Quality is a hard gate; adopt only after passing output and lifecycle checks. Delete or narrow routine worker/reviewer machinery once no production path needs it.
- **Independent proof:** Reports expose novel versus cached context, background-verifier usage, and role counts; candidate quality does not regress; routine successful items have one owner and zero unnecessary implementation-specialist launches; package verification passes.

## Verification matrix

| Proof | Command/evidence | Units |
| --- | --- | --- |
| Contract validation | focused native-store and capability-contract scripts | U1 |
| Proof integrity | adapter provenance, per-entry command, close-bypass, missing-contract, waiver-authority adversarial fixtures | U1 |
| No double planning | declared-field/dependency/contract materialization plus incomplete-plan fixtures | U2 |
| Goal-backed lifecycle | writer-fence, blocked transition, TUI/headless parity, interruption and mid-window compaction fixtures | U3 |
| Browser/visual | calculator fake adapter plus one live Chromium smoke | U4 |
| Non-UI | CSV exact-output benchmark | U3, U7 |
| Adapter lifecycle | deterministic probe/run/collect/cleanup fixtures, including cleanup failure and unavailable states | U5 |
| Service/CLI | live local process/HTTP/output fixtures with teardown and exact artifacts | U5 |
| Android | live configured emulator smoke with identity, interaction, logcat, screenshot, and cleanup | U5 |
| Windows desktop | live configured runner when available; otherwise deterministic runner fixture plus typed blocker | U5 |
| macOS/iOS/hardware | deterministic unavailable/manual fixtures; no live-PASS claim | U5 |
| Multi-slice recovery | three-slice mixed-capability interruption fixture | U6 |
| Context/cost | paired telemetry report with cache and novel tokens separated | U7 |
| Regression | primary LSP, focused tests, then `npm run verify:quiet` once | U1-U7 |
| Final diagnostics | `lens_diagnostics` on changed paths, then package verification state | U7 |

## Adoption gates

1. Calculator and CSV candidates pass every deterministic acceptance gate.
2. Calculator qualitative UI score does not regress; missing browser or screenshot evidence invalidates the sample.
3. No routine implementation-ready plan launches a second planner; incomplete and heading-only plans deterministically return exact missing fields.
4. No routine implementation item launches a fresh worker or reviewer. Background verifiers are allowed only as separately attributed read-only verification, not replacement implementation owners.
5. Multi-slice interruption, mid-window compaction, blocked-slice continuation, and competing resume produce no duplicate writer, goal, fence, claim, commit, or close.
6. Required capability unavailability is blocked and recoverable, releases the active fence, permits independent slices, and is never passed or counted as roadmap completion.
7. Across at least three paired runs, median novel context, total provider tokens, runtime, and implementation-specialist launches improve by at least 10% against the frozen baseline; quality remains the first gate.
8. Existing safety, dirty-tree, verification, commit, close, push, work-store, compaction, and goal lifecycle tests remain green.
9. No implementation or test outside the benchmark package references the calculator experiment directory, its hidden adapter, or parent-relative benchmark artifacts.
10. Live Android proof names the emulator/device and retains logcat plus screenshot evidence; Windows desktop proof either uses a configured native runner or remains explicitly blocked.
11. macOS/iOS and unavailable hardware are reported as unsupported in the current environment, not omitted and not counted as PASS.
12. Executable-capability PASS evidence is adapter-issued and revision-bound; hand-authored PASS, trivial command fan-out, self-authored waivers, and direct-close bypass all fail focused adversarial fixtures.
13. Every executable item has a contract before claim, every close path enforces it, and inferred-only false positives require durable explicit-user correction.
14. TUI and RPC/JSON/headless resume select the same goal-owned implementation path and produce equivalent durable state.

## Goal execution protocol

- Reconcile the current diff and map each existing change to U1–U7 before editing; preserve valid completed work and delete duplicate paths.
- Execute one independently verifiable unit at a time. Commit only at a clean durable boundary; do not carry several unfinished units in one commit.
- The active goal is the sole writer and implementation owner. Do not launch routine planners, workers, reviewers, or fixers. A specialist requires a coded exception and returns findings to the same window.
- Prefer repository commands, standard-library process/HTTP facilities, and installed platform tools. Do not add dependencies merely to create a generic framework.
- Never hardcode benchmark paths or infer PASS from filenames, platform labels, screenshots alone, review prose, or unavailable tools.
- Run focused fixtures after each unit. At milestones run primary LSP plus the smallest relevant package check; run the complete package verification and adoption matrix only at finalization.
- Do not wait indefinitely for a child, emulator, desktop driver, browser, service, or external tool; no single wait exceeds 15 minutes. After a bounded failed attempt, persist the typed blocker and exact resume action.
- Treat the Opus plan review's proof-integrity findings as acceptance requirements: adapter-only executable PASS, per-entry commands, no close bypass, no missing-contract pass, blocked lifecycle, and one-writer fencing.
- Stop only after every adoption gate has evidence, or with a precise external blocker. A successful calculator rerun alone is not completion.

## Non-goals

- One global web/desktop/Android/backend project classification.
- Mandatory screenshots for non-visual work.
- Building custom automation for every desktop framework or hardware device in the first unit.
- Replacing deterministic work state, claims, commits, or recovery with chat-only goal memory.
- Running several writer goals in one checkout.
- Keeping routine planner, worker, reviewer, and fixer calls for organizational symmetry.
- Treating a screenshot file, test command, review prose, or unavailable adapter as sufficient proof by itself.
- Optimizing token cost before product and lifecycle acceptance pass.
- Implementing or claiming live macOS/iOS automation without a testable runtime.
- Turning repository-owned Android, Windows, service, or browser fixtures into general application frameworks.

## Chosen decision

The user selected **capability-driven evidence contracts** over project-level application profiles or unrestricted goal judgment. This plan therefore models proof per WorkItem and permits mixed modalities within one roadmap.
