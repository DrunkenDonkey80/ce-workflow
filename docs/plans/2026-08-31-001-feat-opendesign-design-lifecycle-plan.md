---
title: First-class resumable OpenDesign lifecycle
kind: feat
date: 2026-08-31
topic: opendesign-design-lifecycle
artifact_contract: ce-unified-plan/v1
artifact_readiness: executable
product_contract_source: C:/Users/Flex/AppData/Local/Temp/ce-workflow-ui-design-plans/FULL-PLAN.md
execution: code
---

# First-class resumable OpenDesign lifecycle

## Goal capsule

- **Objective:** Put a durable, human-approved visual-design lifecycle between settled requirements and implementation for substantial UI work, using OpenDesign through its public stdio MCP surface when explicitly enabled.
- **User outcome:** `/wo redesign <objective>`, `/wo design …`, and ordinary `/wo resume` can audit an existing UI, commission and revise a design, synchronize manual OpenDesign edits, pin approval to exact hashes, materialize implementation work, and require design-linked proof without making users author provider schemas.
- **Product authority:** The source full plan defines the product contract. Current ce-workflow code and current OpenDesign public README/MCP implementation define integration reality. Older repository plans are precedents only.
- **Open blockers/questions:** None. Conflicts are resolved in **Decisions**; the Open Question Gate must remain clean.

## Product contract

### Problem and target flow

Today ce-workflow links a brainstorm artifact directly to planning. It has no first-class visual-design state, OpenDesign adapter, approved-handoff hash, or finish gate that proves the implemented UI matches an accepted direction. The target lifecycle is:

```text
intent → requirements brainstorm → visual preflight/current-UI audit
→ OpenDesign generation or text fallback → human review/revision/sync
→ hash-pinned approval → validated design handoff → implementation plan
→ UI implementation → interaction/visual/responsive/accessibility proof → finish
```

OpenDesign is optional and disabled by default in the first release. Enabling it must not weaken non-UI or unavailable-provider behavior.

### Actors

- **User/reviewer:** Supplies product intent and aesthetic judgment, reviews Preview/Studio, requests changes, approves, waives, or cancels.
- **ce-workflow orchestrator:** Owns eligibility, prompts, durable state, MCP requests, synchronization, validation, approval, lineage, planning gates, and proof requirements.
- **OpenDesign daemon/MCP peer:** Creates projects and runs its own configured agent. Its responses and generated files are untrusted input.
- **Planner/builder/verifier:** Consume only approved, hash-bound design facts and scoped `DES-*` criteria; they never treat prototype code as production authority.

## Decisions

1. **No new top-level command.** All user actions stay under `/wo`: `/wo redesign <objective>`, `/wo design [status|open|sync|revise|approve|skip|cancel] [target]`, and `/wo resume [target]`. The bare F7 overlay adds **Redesign existing UI** and **Design status/review** rows through `extensions/work-dialogs.js`.
2. **First release is opt-in.** `workOrchestrator.visualDesignWorkflow` is `off | auto | required`; default is `off`. This supersedes the source plan's eventual default-Auto rollout, while preserving Auto and Required as explicit choices. Telemetry may justify a later default change, but this roadmap does not.
3. **Launch configuration is structured.** Settings support `Auto` plus an explicit `{ command, args, env }` command spec copied from OpenDesign Settings. `OD_BIN` and a verified PATH `od` remain compatibility inputs. No shell interpolation or auto-install is permitted.
4. **Identity is proved before availability.** Auto discovery rejects known collisions such as macOS `/usr/bin/od`, then performs a bounded `initialize` + `tools/list` probe and requires server identity plus the tools needed for the intended action. A filesystem name alone is never proof that the binary is OpenDesign.
5. **One stdio process per ce-workflow action.** A process may execute the calls needed for one command/resume step, then closes. Long runs persist `{projectId, runId, requestId}` and reconcile on explicit `/wo resume`, `/wo design status/sync`, or an extension-owned wake if one is already available; no 5–30 minute modal or immortal child process is introduced.
6. **Persist before mutation.** A preallocated valid project ID, canonical random UUID request ID, and exact bounded start payload are written atomically before their mutations. An ambiguous `create_project` is reconciled by `get_project` with the persisted explicit ID; it is never blindly replayed. When `start_run` loses its response before a run ID is known, its documented idempotent recovery is one replay with the exact persisted request ID and payload; no new mutation identity or changed payload is allowed.
7. **Use explicit project IDs.** `create_project` receives the preallocated ID; every later call uses it and never depends on expiring active-project context.
8. **Preview is delivery; source import is narrow.** Success returns Preview/Studio for user review. OpenDesign sync imports only expected Markdown/JSON. Reference images may enter the design directory only from existing repository files or ce-workflow's browser adapter because the public MCP surface cannot read binary content. Generated HTML/JS, commands, package files, provider instructions, and remote binary files are never fetched, executed, or promoted.
9. **Approval follows sync.** Approval is possible only after a current, valid, question-free handoff is synchronized. It pins canonical brief, handoff, remote fingerprint, owner, and revision hashes. Any relevant mutation invalidates approval.
10. **Reuse the native store.** Design lineage is encoded through existing document links and bounded `wo:design` notes. No work-store schema change is planned. Runtime sessions live with current ce-workflow runtime data under `.ce-workflow/work-runs/design-sessions/`, not the source plan's older `.pi/work/` suggestion.
11. **Text fallback preserves governance.** Auto may create a validated text-only handoff when OpenDesign is unavailable or declined. Required blocks until OpenDesign succeeds or the user records an explicit reasoned waiver. Off leaves existing non-design behavior unchanged.
12. **Semantic fidelity, not pixel equality.** Browser proofs cover interactions, desktop/mobile presentation, required states, console/accessibility behavior, and human/goal inspection. Pixel diff remains deferred.
13. **No provider abstraction.** Implement one narrow OpenDesign adapter. Extract a generic provider interface only after a second real provider exists.
14. **Public-surface compatibility.** Current upstream tool schemas are authoritative: `create_project`, `get_project`, `start_run`, `get_run`, and `cancel_run` are required for generation/reconciliation; `list_files`, `get_artifact`, and `get_file` are required only for text sync/import. `requestId`, terminal statuses, `previewUrl`, `studioUrl`, `agentMessage`, recharge/resume diagnostics, and the prohibition on raw API keys are preserved.
15. **ce-workflow owns the brief.** `DESIGN-BRIEF.md` is the authoritative complete brief; the adapter does not call OpenDesign's interactive `collect_brief`/`confirm_brief` tools and accepts the default `briefState: not_applicable`.

## Requirements

### Eligibility, audit, and brief

- **R1.** Classify substantial UI work without changing behavior for non-UI work; policy Off bypasses the design lifecycle.
- **R2.** `/wo redesign <objective>` creates one durable redesign initiative, not a ready-to-code task, and `/wo resume` selects its next design or implementation action without requiring an ID in the common case.
- **R3.** Brownfield redesign starts from declared repository run commands and existing browser/service adapters; it records routes/screens, reachable states, screenshots/provenance, components/tokens/assets, accessibility/responsive defects, and explicit preserve/reconsider/remove decisions in bounded `CURRENT-UI-AUDIT.md/.json`. When visual direction is genuinely open, it produces 2–3 bounded direction boards and requires the user to select one before detailed commissioning.
- **R4.** `DESIGN-BRIEF.md` traces the source brainstorm/work item, settled actors/flows/states/content/non-goals, repository constraints, real copy, responsive/accessibility requirements, visual preflight, prohibited directions, return contract, and brief hash without secrets or unrelated source.
- **R5.** The visual preflight fixes subject, audience, single job, real vocabulary/content, 4–6 named role colors, intentional type roles, layout concept, one signature element, one intentional risk, anti-default critique, responsive/keyboard/contrast/reduced-motion behavior, and all visible loading/empty/error/success/disabled states.

### OpenDesign adapter

- **R6.** Discovery order is explicit command spec, `OD_BIN`, then verified PATH candidates (including Windows wrappers); no auto-install, shell interpolation, or unverified bare `od` use.
- **R7.** The stdio client uses JSON-RPC 2.0 initialize/initialized, `tools/list`, correlated monotonically unique request IDs, bounded LF/CRLF parsing for the current SDK transport, typed rejection of unrecognized framing, separate stderr capture, byte/time caps, AbortSignal cancellation, child-tree cleanup, and secret scrubbing.
- **R8.** Discovery requires the OpenDesign server identity and action-specific tools. Missing daemon/tools/provider returns a typed, actionable state and never crashes unrelated `/wo` flows.
- **R9.** Mutating calls are not generically retried after ambiguous failure. Safe reads may retry once in a fresh process. `create_project` is read-reconciled. If `start_run` loses its response before returning a run ID, one explicit recovery call replays the exact persisted request ID and payload, relying on OpenDesign's documented idempotency; a different payload with that ID is rejected. A recharge resume occurs only after explicit user confirmation of top-up and calls `start_run` with that same request ID/original payload plus `resume: true`. Raw API keys and credential-like plugin inputs are rejected.
- **R10.** `create_project` receives a persisted preallocated ID; an ambiguous response is resolved through `get_project` for that ID without replay. `start_run` persists run/studio references; `get_run` recognizes `queued|running|succeeded|failed|canceled`, preserves bounded `agentMessage`, failure action/recharge URL, and missing-deliverable diagnostics; cancel preserves uncertainty when transport is lost.
- **R11.** Every peer value is validated and clamped. URLs are inert `http/https` display/open references, never fetched automatically; prompts, credentials, tokens, full artifacts, and token-bearing URLs never enter telemetry or ordinary logs.

### Durable lifecycle and review

- **R12.** `extensions/work-design.js` validates the full state machine from `not_applicable` through audit/brief/commission/run/review/sync/approval/import/plan/implementation/proof plus terminal/superseded states, and atomically stores a bounded versioned session.
- **R13.** A completed start action records owner, policy, project/conversation/run/request IDs, exact payload digest, paths/hashes, revision, timestamps, URLs, bounded error, and next action before returning control.
- **R14.** A successful run without preview but with a genuine question enters `clarification_required`; settled brief facts answer automatically, while the user sees exactly one unresolved judgment question.
- **R15.** The shared review dialog has a muted purpose line and rows for Open Preview/Studio, Approve current revision, Request changes, Sync edits, Continue text-only, and Cancel. It preserves parent cursor, filtering, Escape, Enter, Space, and non-TUI behavior through existing dialog primitives. Disabled rows cannot be selected in either TUI or native fallback. Open Preview/Studio refreshes daemon-session URLs through `get_run` before opening.
- **R16.** Natural-language feedback becomes a bounded revision prompt against the same project, preserving accepted facts and regression constraints. Each confirmed revision gets one new persisted request ID; transport retry reuses it.
- **R17.** Cancel requests remote cancellation when reachable, terminates the local child after a grace period, preserves evidence, and reports uncertain remote cancellation honestly.

### Handoff, sync, and approval

- **R18.** `DESIGN-HANDOFF.json` v1 implements the source contract for identity, direction, content, tokens, screens/states, flows, components, responsive rules, interactions, accessibility, assets/licenses, implementation constraints, `DES-*` acceptance, empty open questions, and provenance. Markdown is human-readable; canonical JSON is automation authority.
- **R19.** Validation applies version, enum, uniqueness, array/string/size, hex color, viewport/proof, path containment, symlink/device/reserved-name, file type, executable-field, brief-hash, and empty-open-question rules. Unknown top-level data may remain in raw source but is ignored by v1 automation.
- **R20.** Sync fingerprints relevant remote metadata, fetches only the expected bundle/files when changed, validates before writing, canonicalizes/hashes atomically, increments revision, and invalidates stale approval. Manual OpenDesign edits are checked at sync, approval, resume, and planning boundaries—not by a watcher.
- **R21.** If Preview exists but handoff is missing/invalid, retain review access and issue one deterministic repair prompt listing validation errors; a second failure stays resumable and does not ask the user to author JSON.
- **R22.** Repository writes are confined to `docs/designs/<date>-<slug>/`. OpenDesign sync imports only bounded Markdown/JSON because its public MCP surface cannot return binary files. Approved image types may be copied only from existing repository assets or fresh ce-workflow browser-adapter screenshots. No generated executable code, symlink, device, arbitrary URL/binary fetch, or unknown-license production asset is imported.
- **R23.** `APPROVAL.json` pins owner, brief/handoff/remote hashes, revision, human decision/time, and bounded notes. Any brief/handoff/fingerprint/owner/revision mutation makes it stale and requires one focused reapproval after a delta summary.
- **R24.** Work-item notes/document links preserve source brainstorm, design directory, handoff/approval paths and hashes, project/run IDs, state, and supersession lineage without overloading `brainstorm-path` or changing the store schema.

### Planning, implementation, and proof

- **R25.** Planning discovers only approved/imported design handoffs (or explicit validated fallback/waiver), synchronizes first, and blocks with a concrete `/wo design …` recovery action on stale or incomplete design.
- **R26.** The master plan records source brainstorm/brief/handoff/approval paths and hashes, every `DES-*` criterion, screen/flow/state/viewport matrix, reuse/non-introduction/assets constraints, and the rule that prototype code is reference only.
- **R27.** Every `DES-*` ID maps to one or more implementation units and their verification entries. Materialized work items keep assigned criteria and shared constraints through acceptance, design links/notes, compaction, and builder handoff.
- **R28.** Builders receive only their assigned design scope plus shared hashes/constraints. A necessary deviation pauses affected work for handoff revision, reapproval, and targeted plan refresh; code never silently rewrites design authority.
- **R29.** Design-linked UI contracts reuse existing capabilities: browser interaction, desktop/mobile visual screenshots, browser logs/accessibility inspection, and optional manual final approval only under Strict proof. Each executable browser entry copies the declared repository/browser-runner command into `operation.command`; unavailable configuration becomes a typed blocker. No capability enum change is required.
- **R30.** Finish computes a bounded fidelity matrix by `DES-*`/screen/state/viewport/proof, rejects missing or stale revision-bound evidence, and returns exact `/wo resume` recovery actions. A stable cell-to-proof manifest groups cells sharing proof type, executable operation, and viewport set into at most 32 contract entries while retaining every cell and expected artifact. Semantic inspection covers hierarchy/signature, tokens, required regions/content, reflow, states, clipping/overlap, focus, and reduced motion.

### Settings, packaging, docs, telemetry

- **R31.** Shared settings expose Visual design workflow (`Off|Auto|Required for UI`), OpenDesign launch (`Auto|configured command spec`), and Design review proof (`Standard|Strict`). Project overrides and global defaults follow existing settings scope/reset rules; first-release workflow default is Off.
- **R32.** A packaged `skills/work-design-handoff/SKILL.md` carries the brief/handoff/approval and design-to-plan discipline without embedding credentials, invoking OpenDesign itself, or creating a second orchestration surface.
- **R33.** README documents enablement, command-spec guidance from OpenDesign Settings, `/usr/bin/od` collision, provider/network disclosure, commands, fallback, runtime/artifact locations, approval semantics, and troubleshooting.
- **R34.** Bounded telemetry records eligibility, policy, availability category, phase durations, revisions/clarifications/repair/sync/stale counts, fallback, approval duration, criterion/proof counts, cancellation/failure category, and never design content, prompts, source, credentials, or token-bearing URLs.
- **R35.** Default verification is fully offline through a fake stdio server. A real OpenDesign smoke is optional/manual and never required by package CI.

## Artifact and schema contracts

### Runtime state

Runtime files are versioned JSON below `.ce-workflow/work-runs/design-sessions/<owner-id>.json`, written temp-file + rename under the existing runtime ownership/ignore policy. They contain only bounded operational metadata and hashes. An optional bounded transition tail serves as the 3am diagnostic record; no separate unbounded journal is introduced.

### Repository artifacts

```text
docs/designs/<date>-<slug>/
  CURRENT-UI-AUDIT.md/.json   # brownfield only
  DESIGN-BRIEF.md
  DESIGN-HANDOFF.md/.json
  APPROVAL.json
  reference/*.png|jpg|webp    # optional; repo-local or browser-adapter source only
```

The original brainstorm remains requirements authority and links forward. Design artifacts link back and plans bind all authoritative hashes.

### Acceptance contract for OpenDesign compatibility

- **Source:** Current `nexu-io/open-design` README and `apps/daemon/src/mcp.ts` public tool definitions; re-check before adapter implementation.
- **Must match:** stdio initialize flow, action-specific tool names/schemas, stable `requestId`, explicit project ID, terminal statuses, Preview/Studio default delivery, bounded `agentMessage`, recharge/resume behavior, and no raw API keys.
- **Must not regress:** no mutation replay, no active-project dependency, no credential logging, no generated-code execution/import, no blocking TUI wait, and no impact when disabled.
- **Proof:** fake peer protocol matrix, contract fixtures, command-spec/identity probes, interruption/restart tests, and optional manual real smoke.
- **Approval path:** focused unit checks, advisor-reviewed master plan, and final `npm run verify:quiet`; real provider billing is never implied by offline PASS.

## Key flows

### F1 — New substantial UI idea

1. Brainstorm settles product behavior and links its artifact.
2. Eligibility + policy initialize a design session and write a complete brief/preflight.
3. If enabled and available, ce-workflow verifies OpenDesign, creates a project, persists request state, starts a run, and returns control.
4. `/wo resume` reconciles to clarification, failure, or review-ready Preview/Studio.
5. User revises/syncs/approves or chooses allowed text fallback.
6. Validated artifacts and approval hashes become planning input; only then are implementation units materialized.

### F2 — Brownfield redesign

1. `/wo redesign <objective>` creates a redesign initiative.
2. Declared run commands and existing adapters produce the current-UI audit and preserve/reconsider/remove split.
3. Direction boards are optional when the direction is genuinely open; the chosen direction is commissioned against the complete state/responsive contract.
4. After approval, coherent surface/state slices replace premature file-based tasks.

### F3 — Lost or interrupted OpenDesign run

1. Persist request ID + payload digest before mutation and project/run IDs immediately when known.
2. Close the stdio child when the command step ends.
3. On resume, read durable state, verify the configured peer, reconcile an ambiguous `create_project` by `get_project` with the preallocated ID, and query a known `runId`; when no run ID was returned, replay `start_run` once with the exact persisted request ID and payload to recover OpenDesign's idempotent result.
4. A recharge resume requires explicit user confirmation and the exact original start payload plus `resume: true`; never start a duplicate logical run merely because a response was lost.

### F4 — Manual OpenDesign edit and stale approval

1. Approval/planning/resume computes a remote fingerprint.
2. A change fetches only expected files, validates/canonicalizes them, and compares hashes.
3. Changed authority increments revision and invalidates approval.
4. Planning and finish remain blocked until focused reapproval.

### F5 — Design-linked completion

1. Planner maps `DES-*` criteria into scoped units and proof entries.
2. Builder implements product code without copying prototype code.
3. Existing adapters produce interaction, desktop/mobile visual, accessibility/log, and optional manual proof bound to the target revision.
4. Finish reports exact missing matrix cells or closes only when every required cell passes.

## Scope boundaries and deferred work

- No automatic OpenDesign install/update, cloud provisioning, credential entry, provider abstraction, background file watcher, organization policy service, multi-designer approval, Figma round trip, remote MCP binary-image import, or generated framework-code import.
- No pixel-diff service; add only after stable baselines and measured semantic-review misses justify it.
- No auto-open of remote URLs, delete-project call, or execution of generated HTML/JS/package commands.
- No default-Auto rollout in this roadmap; enabling Auto globally requires later reliability evidence and an explicit product decision.
- No `extensions/work-dialogs.js` change unless the existing list dialog cannot express a disabled row/reason; prefer reuse.
- No `extensions/work-store.js` or verification-capability schema change unless a focused unit proves existing links/notes/capabilities insufficient.

## Risks and controls

- **Wrong `od` executable:** deny known collisions, avoid shell resolution after discovery, verify MCP server identity/tools, and make explicit command spec the reliable path.
- **Malicious/noisy stdio peer:** bounded dual framing parser, request correlation, strict schemas, stderr separation/redaction, timeout/abort, and process-tree cleanup.
- **Duplicate paid run/project:** persist explicit project/request identity before dispatch; read-reconcile ambiguous create, use only OpenDesign's same-ID/same-payload idempotent replay for a lost start response, and use explicit-confirmation `resume: true` only for recharge.
- **Long run blocks Pi:** process-per-action and durable lazy reconciliation; no persistent modal or child required.
- **Stale design becomes implementation authority:** mandatory sync at approval/resume/planning, canonical hashes, owner/revision binding, and plan/finish stale gates.
- **Prototype contaminates production:** confined allowlist imports and explicit planner/builder non-goal.
- **Scope explosion in `work-models.js`:** lifecycle/validation/transport live in new modules; `work-models.js` keeps routing and projections only.
- **Proof burden becomes unusable:** derive only matrix cells declared by `DES-*`; Standard omits final human sign-off, Strict adds it.
- **Sensitive diagnostics:** use bounded redacted operational summaries; a richer support bundle is deferred until a reviewed redaction contract exists.

## wo:divergent-analysis

- **Inversion/adversary — completed:** Adopted process-per-command rather than a long-lived child, on-demand durable reconciliation rather than a perpetual poller, verified identity before availability, and inert validated URL handling. Rejected one process per individual RPC because command-level batching is simpler and OpenDesign may add session context.
- **3am operator — completed:** Folded the useful journal idea into a bounded atomic transition tail, adopted explicit cancel/kill/reconcile semantics and a disposable preflight, and rejected a support bundle for this roadmap because redaction becomes a new product surface.
- **Remove the load-bearing assumption — completed:** Adopted lazy `get_run` reconciliation. Rejected direct daemon attachment (undocumented public contract), deterministic content-derived request IDs (identical intentional reruns collide), and reading OpenDesign's private settings store (format and credential risk); users may paste the authoritative public Settings command spec instead.

## Planning architecture findings

1. `extensions/work-models.js` already centralizes F7 `/wo`, settings, brainstorm linking, planning, resume, finish, telemetry, notifications, and long-running orchestration; it should route, not absorb protocol/state code.
2. `extensions/work-dialogs.js::showListDialog` already supplies purpose, filtering, cursor persistence, Enter/Space, Escape/back, detail rows, and native fallback. Design menus should reuse it.
3. `linkBrainstormArtifactFromFinal`, `brainstormHandoffPrompt`, `buildWorkPlanLikeState`, `planResumeAction`, and `buildWorkFinishState` are the lineage/gate seams. `epicPlanningSources` and implementation-unit extraction are the plan-source/materialization seams.
4. Current brainstorm→plan linkage stores the plan in `documentLinks.design`; design artifacts need distinct bounded `wo:design` notes/document references so the existing key is not ambiguously overloaded.
5. Current executable plan materialization requires structured units with exact dependencies, scope, and executable verification contracts. This plan supplies them below and must not launch another planner after advisor approval.
6. Package discovery already ships all `extensions/`, `scripts/`, and `skills/`; adding the new module, fake fixture, and skill needs no package manifest dependency or runtime library.
7. `npm run verify:quiet` is the real aggregate gate; focused `scripts/test-*.mjs` files are the iteration checks.

## Implementation units

### U1 — Pure design lifecycle, artifacts, and approval

- Add `extensions/work-design.js` with state transitions, atomic runtime persistence, brief/audit renderers, handoff v1 validation/canonicalization/hash, remote fingerprint normalization, approval/staleness, revision prompt rendering, and bounded lineage-note helpers.
- Add valid/invalid handoff fixtures and `scripts/test-work-design.mjs` covering schema caps, illegal transitions, path/symlink/device rejection, canonical hashes, open questions, repair limit, approval invalidation, text fallback, and restart loading.
- Do not spawn processes, edit UI, or change the work-store schema.

### U2 — Safe stdio MCP adapter

- Add `extensions/opendesign-client.js` and `scripts/fixtures/opendesign/fake-od.mjs`.
- Implement structured command resolution, collision rejection, bounded identity/tool probe, JSON-RPC lifecycle, bounded LF/CRLF framing with typed rejection of unrecognized framing, response correlation, secret-safe stderr, per-call/overall timeouts, AbortSignal, child-tree cleanup, action-specific tool wrappers, request mutation policy, and normalized errors.
- `scripts/test-work-opendesign-client.mjs` drives executable absent, wrong `od`, daemon unreachable, split/coalesced frames, malformed/oversized frames, stderr noise, missing tools, timeout/cancel/exit, success/failure/canceled/clarification, read retry, lost `create_project` reconciliation, rejected changed-payload mutation, same-ID/same-payload lost-start recovery, explicit recharge `resume: true`, and Windows wrapper resolution with no real provider.

### U3 — Redesign/audit/commissioning and resume routing

- Add `/wo redesign`, `/wo design` routing/completions, F7 rows, substantial-UI eligibility, current-UI audit orchestration, optional 2–3 direction boards plus user selection when direction is open, brief confirmation, OpenDesign project/run start, text fallback, and design-session selection/resume before planning.
- Integrate `brainstormHandoffPrompt` and `linkBrainstormArtifactFromFinal` without changing existing Off/non-UI behavior.
- Persist the explicit project ID before create and request identity before start, return control after dispatch, and reconcile ambiguous creates/known runs on explicit resume.

### U4 — Settings and human review/revision loop

- Add scoped workflow/launch/proof settings to the existing settings loop and status, with first-release Off default and command-spec validation/redaction.
- Reuse `showListDialog` for the review overlay, including disabled approval reasons, refreshed Preview/Studio display/open action, request-changes capture, sync, text fallback/waiver, cancel, and non-TUI projections. Rely on its existing TUI/native disabled-row guard and cover that reuse with focused design-flow tests; do not change the shared dialog.
- Keep all choices under `/wo`; no separate extension command or custom dialog implementation.

### U5 — Sync, repair, confined import, approval, and lineage

- Implement command-boundary `list_files` fingerprinting, expected Markdown/JSON fetch, one deterministic repair run, validated confined artifact writes, optional bounded licensed images only from repository-local/browser-adapter sources, canonical approval, stale invalidation, and `wo:design` notes/document links.
- Ensure manual OpenDesign edits at approval/resume/planning force sync and reapproval when authority changes.
- Never import or execute prototype code.

### U6 — Design-aware planning and work-item propagation

- Extend approved planning sources and handoff prompt contracts with source/hashes, `DES-*` criteria, screen/state/viewport matrix, constraints, assets/licenses, and prototype non-authority.
- Require current approval or explicit allowed waiver before bootstrap; map every `DES-*` ID into one or more implementation units and bounded existing-store metadata/acceptance.
- Route stale design to exact `/wo design sync|approve|revise` actions and preserve assigned criteria through compaction/builder handoff.

### U7 — Fidelity proof and finish gates

- Derive existing verification-contract entries for interactions, desktop/mobile visuals, logs/accessibility, and Strict-only human approval; populate every executable browser entry from the declared browser-runner operation.
- Add a stable lossless cell-to-proof manifest that groups the fidelity matrix into at most 32 contract entries, plus finish blockers/recovery actions; bind evidence to handoff and target revision and invalidate affected proof after approved design change.
- Reuse capability adapters and `verificationProofRecord`; add no new capability enum or pixel diff.

### U8 — Packaged skill, docs, telemetry, and end-to-end hardening

- Add `skills/work-design-handoff/SKILL.md`, README enablement/troubleshooting/security/provider disclosure, bounded telemetry, and a fake-peer end-to-end restart/compaction/cancel flow.
- Confirm package inventory, disabled/non-UI regression, optional manual smoke documentation, and final aggregate verification.
- Do not add a dependency or make Auto the default.

## Dependency order

`U1 || U2 → U3 → U4 → U5 → U6 → U7 → U8`.

U1 and U2 are independent foundations. U3 is the first vertical preview/fallback tracer. U4 adds human iteration, U5 makes authority durable, U6 propagates it into executable work, U7 closes proof, and U8 ships the supported product surface.

## Executable implementation manifest

```json
{
  "implementationUnits": [
    {
      "key": "U1",
      "title": "Pure design lifecycle, artifacts, and approval",
      "outcome": "Versioned design sessions, briefs/audits, validated canonical handoffs, approval hashes, staleness, repair limits, and lineage helpers are deterministic and restart-safe without process or UI integration.",
      "acceptance": [
        "Every lifecycle transition and persisted field is bounded/versioned and illegal transitions fail closed.",
        "Handoff v1 validation covers required structure, enums, caps, IDs, colors, viewports, paths, executable fields, provenance, and empty open questions.",
        "Canonical hashes are key-order stable; changed brief/handoff/fingerprint/owner/revision invalidates approval.",
        "Text fallback and one-pass repair state are represented without a provider dependency."
      ],
      "dependencies": [],
      "files": [
        "extensions/work-design.js",
        "scripts/test-work-design.mjs",
        "scripts/fixtures/opendesign/handoff-valid.json",
        "scripts/fixtures/opendesign/handoff-invalid.json"
      ],
      "surfaces": ["state", "filesystem", "security"],
      "nonGoals": ["MCP process", "dialogs", "work-store schema change"],
      "verificationContract": {
        "version": 1,
        "required": [
          {
            "id": "work-design-contracts",
            "capability": "command",
            "proof": "test",
            "source": "R12-R16, R18-R19, and R23 pure lifecycle and trust-boundary acceptance",
            "operation": {
              "command": "node scripts/test-work-design.mjs",
              "timeoutMs": 120000,
              "expectedExit": 0,
              "assertions": [{"target": "exit", "operator": "equals", "value": "0"}]
            }
          }
        ]
      }
    },
    {
      "key": "U2",
      "title": "Safe OpenDesign stdio MCP adapter",
      "outcome": "A dependency-free, bounded OpenDesign client verifies launch identity, speaks JSON-RPC over current stdio framing, enforces mutation idempotency policy, and survives malformed peers, cancellation, and process exit.",
      "acceptance": [
        "Explicit command spec, OD_BIN, PATH, macOS collision, and Windows wrapper cases resolve without shell injection or auto-install.",
        "Initialize/tools discovery is required before calls and missing identity/tools produces typed diagnostics.",
        "Split/coalesced LF/CRLF messages work; unrecognized framing, malformed/oversized output, stderr, timeout, abort, cleanup, and process exit are bounded.",
        "Safe reads may retry once, lost create is read-reconciled by preallocated ID, lost start permits one documented same-requestId/same-payload idempotent recovery call, changed-payload mutation is rejected, and recharge resume uses the original identity/payload plus resume:true after user confirmation."
      ],
      "dependencies": [],
      "files": [
        "extensions/opendesign-client.js",
        "scripts/test-work-opendesign-client.mjs",
        "scripts/fixtures/opendesign/fake-od.mjs"
      ],
      "surfaces": ["process", "stdio", "security", "windows", "macos"],
      "nonGoals": ["real provider call", "SDK dependency", "daemon private API", "provider abstraction"],
      "verificationContract": {
        "version": 1,
        "required": [
          {
            "id": "opendesign-client-protocol",
            "capability": "command",
            "proof": "test",
            "source": "R6-R11 adapter acceptance and OpenDesign compatibility contract",
            "operation": {
              "command": "node scripts/test-work-opendesign-client.mjs",
              "timeoutMs": 180000,
              "expectedExit": 0,
              "assertions": [{"target": "exit", "operator": "equals", "value": "0"}]
            }
          }
        ]
      }
    },
    {
      "key": "U3",
      "title": "Redesign audit, commissioning, and resumable routing",
      "outcome": "Substantial new UI and /wo redesign create durable design work, audit existing UI when applicable, commission or fall back safely, and resume known OpenDesign runs before planning without blocking the TUI.",
      "acceptance": [
        "/wo redesign creates a parent initiative and audit phase rather than implementation work; /wo resume advances the common path without an ID.",
        "Off and non-UI paths remain unchanged; Auto falls back and Required blocks with exact recovery/waiver actions.",
        "Brief/audit output contains settled product, repository, visual, state, responsive, accessibility, and preserve/replace facts; genuinely open directions produce 2–3 boards and a user selection.",
        "A preallocated create_project ID persists before mutation and reconciles through get_project; request state persists before start_run and the command returns control with a resumable next action."
      ],
      "dependencies": ["U1", "U2"],
      "files": [
        "extensions/work-design.js",
        "extensions/work-models.js",
        "scripts/test-work-design.mjs",
        "scripts/test-work-brainstorm.mjs",
        "scripts/test-work-resume.mjs",
        "scripts/test-work-roadmap.mjs"
      ],
      "surfaces": ["orchestrator", "brainstorm", "redesign", "resume", "browser"],
      "nonGoals": ["approval/import", "implementation materialization", "long-lived poller"],
      "verificationContract": {
        "version": 1,
        "required": [
          {
            "id": "design-commissioning-state",
            "capability": "command",
            "proof": "test",
            "source": "R1-R14 design lifecycle acceptance",
            "operation": {
              "command": "node scripts/test-work-design.mjs",
              "timeoutMs": 180000,
              "expectedExit": 0,
              "assertions": [{"target": "exit", "operator": "equals", "value": "0"}]
            }
          },
          {
            "id": "design-brainstorm-link",
            "capability": "command",
            "proof": "test",
            "source": "F1 brainstorm-to-design acceptance",
            "operation": {
              "command": "node scripts/test-work-brainstorm.mjs",
              "timeoutMs": 180000,
              "expectedExit": 0,
              "assertions": [{"target": "exit", "operator": "equals", "value": "0"}]
            }
          },
          {
            "id": "design-resume-routing",
            "capability": "command",
            "proof": "test",
            "source": "F2-F3 redesign and restart acceptance",
            "operation": {
              "command": "node scripts/test-work-resume.mjs",
              "timeoutMs": 180000,
              "expectedExit": 0,
              "assertions": [{"target": "exit", "operator": "equals", "value": "0"}]
            }
          },
          {
            "id": "design-roadmap-routing",
            "capability": "command",
            "proof": "test",
            "source": "R2 redesign initiative/roadmap acceptance",
            "operation": {
              "command": "node scripts/test-work-roadmap.mjs",
              "timeoutMs": 180000,
              "expectedExit": 0,
              "assertions": [{"target": "exit", "operator": "equals", "value": "0"}]
            }
          }
        ]
      }
    },
    {
      "key": "U4",
      "title": "Scoped settings and human review/revision loop",
      "outcome": "Users can opt in, configure a safe OpenDesign command spec, review a generated direction, revise/sync/approve/fallback/cancel through shared dialogs, and use equivalent headless projections.",
      "acceptance": [
        "Workflow defaults Off and global/project setting inheritance, reset, command-spec validation, and redaction match existing settings behavior.",
        "The review overlay uses showListDialog with purpose, filtering, cursor, Enter/Space, Escape/back, details, and non-selectable disabled approval rows in TUI and native fallback.",
        "Feedback commissions a same-project revision with a newly persisted action requestId; cancel preserves evidence and uncertainty.",
        "No /work-design or other separate command/dialog surface is registered."
      ],
      "dependencies": ["U3"],
      "files": [
        "extensions/work-design.js",
        "extensions/work-models.js",
        "extensions/work-dialogs.js",
        "scripts/test-work-design.mjs",
        "scripts/test-work-settings.mjs",
        "scripts/test-work-dialogs.mjs"
      ],
      "surfaces": ["settings", "tui", "rpc", "review"],
      "nonGoals": ["custom dialog framework", "default Auto rollout", "support bundle"],
      "verificationContract": {
        "version": 1,
        "required": [
          {
            "id": "design-settings",
            "capability": "command",
            "proof": "test",
            "source": "R31 scoped settings acceptance",
            "operation": {
              "command": "node scripts/test-work-settings.mjs",
              "timeoutMs": 180000,
              "expectedExit": 0,
              "assertions": [{"target": "exit", "operator": "equals", "value": "0"}]
            }
          },
          {
            "id": "design-review-dialog",
            "capability": "command",
            "proof": "test",
            "source": "R15 shared dialog and disabled-row acceptance",
            "operation": {
              "command": "node scripts/test-work-dialogs.mjs",
              "timeoutMs": 180000,
              "expectedExit": 0,
              "assertions": [{"target": "exit", "operator": "equals", "value": "0"}]
            }
          },
          {
            "id": "design-revision-state",
            "capability": "command",
            "proof": "test",
            "source": "R16-R17 review/revision/cancel acceptance",
            "operation": {
              "command": "node scripts/test-work-design.mjs",
              "timeoutMs": 180000,
              "expectedExit": 0,
              "assertions": [{"target": "exit", "operator": "equals", "value": "0"}]
            }
          }
        ]
      }
    },
    {
      "key": "U5",
      "title": "Sync, confined import, approval, and lineage",
      "outcome": "Expected OpenDesign handoff files synchronize safely, repair once, import into a confined design directory, pin human approval, invalidate on remote/manual changes, and link durably to brainstorm/roadmap state.",
      "acceptance": [
        "Remote fingerprint changes fetch only expected files; invalid output receives one repair and remains resumable after a second failure.",
        "OpenDesign contributes only bounded Markdown/JSON; licensed images enter docs/designs only from repository-local or browser-adapter sources, while executable/prototype files, traversal, symlinks, devices, remote binaries, and unknown-license production assets fail closed.",
        "Approval syncs first and pins exact owner/brief/handoff/fingerprint/revision; any authority change invalidates it.",
        "wo:design notes/document references preserve backward/forward lineage without changing work-store schema or overloading brainstorm-path."
      ],
      "dependencies": ["U4"],
      "files": [
        "extensions/work-design.js",
        "extensions/work-models.js",
        "scripts/test-work-design.mjs",
        "scripts/test-work-brainstorm.mjs",
        "scripts/test-work-store.mjs"
      ],
      "surfaces": ["filesystem", "sync", "approval", "work-items", "security"],
      "nonGoals": ["generated code import", "background watcher", "delete_project"],
      "verificationContract": {
        "version": 1,
        "required": [
          {
            "id": "design-sync-approval",
            "capability": "command",
            "proof": "test",
            "source": "R18-R23 and F4 handoff/approval acceptance",
            "operation": {
              "command": "node scripts/test-work-design.mjs",
              "timeoutMs": 180000,
              "expectedExit": 0,
              "assertions": [{"target": "exit", "operator": "equals", "value": "0"}]
            }
          },
          {
            "id": "design-brainstorm-lineage",
            "capability": "command",
            "proof": "test",
            "source": "R24 source/design lineage acceptance",
            "operation": {
              "command": "node scripts/test-work-brainstorm.mjs",
              "timeoutMs": 180000,
              "expectedExit": 0,
              "assertions": [{"target": "exit", "operator": "equals", "value": "0"}]
            }
          },
          {
            "id": "design-store-compatibility",
            "capability": "command",
            "proof": "test",
            "source": "R24 existing-store compatibility acceptance",
            "operation": {
              "command": "node scripts/test-work-store.mjs",
              "timeoutMs": 180000,
              "expectedExit": 0,
              "assertions": [{"target": "exit", "operator": "equals", "value": "0"}]
            }
          }
        ]
      }
    },
    {
      "key": "U6",
      "title": "Design-aware planning and work-item propagation",
      "outcome": "Planning synchronizes approved design authority, records exact hashes, maps every DES criterion into executable units and proof, and gives builders only scoped criteria plus shared constraints while stale design blocks safely.",
      "acceptance": [
        "Approved handoff/fallback/waiver is a recognized planning source; stale or incomplete authority blocks with an exact design recovery action.",
        "Plans bind brainstorm/brief/handoff/approval hashes and map every DES ID across screen/state/viewport scope with reuse, licensing, and prototype-reference constraints.",
        "Materialized work items retain assigned DES IDs, shared hashes/constraints, and design links through resume and compaction.",
        "Design deviations pause affected work for revision/reapproval instead of silently mutating the handoff."
      ],
      "dependencies": ["U5"],
      "files": [
        "extensions/work-design.js",
        "extensions/work-models.js",
        "scripts/test-work-design.mjs",
        "scripts/test-work-plan-open-questions.mjs",
        "scripts/test-work-resume.mjs",
        "scripts/test-work-start-finish.mjs"
      ],
      "surfaces": ["planning", "materialization", "resume", "compaction", "builder-handoff"],
      "nonGoals": ["new planner", "prototype code reuse", "core work-store schema change"],
      "verificationContract": {
        "version": 1,
        "required": [
          {
            "id": "design-plan-source",
            "capability": "command",
            "proof": "test",
            "source": "R25-R28 approved design planning source acceptance",
            "operation": {
              "command": "node scripts/test-work-design.mjs",
              "timeoutMs": 180000,
              "expectedExit": 0,
              "assertions": [{"target": "exit", "operator": "equals", "value": "0"}]
            }
          },
          {
            "id": "design-plan-open-gate",
            "capability": "command",
            "proof": "test",
            "source": "R25 unresolved/stale design gate acceptance",
            "operation": {
              "command": "node scripts/test-work-plan-open-questions.mjs",
              "timeoutMs": 180000,
              "expectedExit": 0,
              "assertions": [{"target": "exit", "operator": "equals", "value": "0"}]
            }
          },
          {
            "id": "design-plan-resume",
            "capability": "command",
            "proof": "test",
            "source": "R27-R28 propagated resume/handoff acceptance",
            "operation": {
              "command": "node scripts/test-work-resume.mjs",
              "timeoutMs": 180000,
              "expectedExit": 0,
              "assertions": [{"target": "exit", "operator": "equals", "value": "0"}]
            }
          },
          {
            "id": "design-plan-materialization",
            "capability": "command",
            "proof": "test",
            "source": "R26-R28 work-item materialization acceptance",
            "operation": {
              "command": "node scripts/test-work-start-finish.mjs",
              "timeoutMs": 240000,
              "expectedExit": 0,
              "assertions": [{"target": "exit", "operator": "equals", "value": "0"}]
            }
          }
        ]
      }
    },
    {
      "key": "U7",
      "title": "Design fidelity proof and finish gates",
      "outcome": "Design-linked UI units receive existing-capability interaction, responsive visual, accessibility/log, and optional human proof; finish reports exact missing fidelity cells and rejects stale evidence.",
      "acceptance": [
        "DES criteria deterministically derive only required browser interaction, desktop/mobile visual, accessibility/log, and Strict manual entries; executable entries include the declared browser-runner operation.",
        "Proof is bound to target revision and approved handoff hash; a design change invalidates affected evidence.",
        "A stable manifest losslessly groups all screen/state/viewport/proof cells into at most 32 entries and gives concrete /wo resume recovery actions.",
        "Non-design/non-UI finish behavior and capability enums remain unchanged; pixel equality is not introduced."
      ],
      "dependencies": ["U6"],
      "files": [
        "extensions/work-design.js",
        "extensions/work-models.js",
        "extensions/work-verification-contract.js",
        "scripts/test-work-design.mjs",
        "scripts/test-work-verification-contract.mjs",
        "scripts/test-work-browser-adapter.mjs",
        "scripts/test-work-start-finish.mjs"
      ],
      "surfaces": ["verification", "browser", "accessibility", "finish"],
      "nonGoals": ["new capability enum", "pixel diff", "mandatory human proof under Standard"],
      "verificationContract": {
        "version": 1,
        "required": [
          {
            "id": "design-fidelity-matrix",
            "capability": "command",
            "proof": "test",
            "source": "R29-R30 lossless bounded fidelity-matrix acceptance",
            "operation": {
              "command": "node scripts/test-work-design.mjs",
              "timeoutMs": 180000,
              "expectedExit": 0,
              "assertions": [{"target": "exit", "operator": "equals", "value": "0"}]
            }
          },
          {
            "id": "design-proof-contracts",
            "capability": "command",
            "proof": "test",
            "source": "R29 generated executable proof-contract acceptance",
            "operation": {
              "command": "node scripts/test-work-verification-contract.mjs",
              "timeoutMs": 180000,
              "expectedExit": 0,
              "assertions": [{"target": "exit", "operator": "equals", "value": "0"}]
            }
          },
          {
            "id": "design-browser-operations",
            "capability": "command",
            "proof": "test",
            "source": "R29 browser runner operation/evidence acceptance",
            "operation": {
              "command": "node scripts/test-work-browser-adapter.mjs",
              "timeoutMs": 240000,
              "expectedExit": 0,
              "assertions": [{"target": "exit", "operator": "equals", "value": "0"}]
            }
          },
          {
            "id": "design-finish-gate",
            "capability": "command",
            "proof": "test",
            "source": "R30 and F5 finish/recovery acceptance",
            "operation": {
              "command": "node scripts/test-work-start-finish.mjs",
              "timeoutMs": 240000,
              "expectedExit": 0,
              "assertions": [{"target": "exit", "operator": "equals", "value": "0"}]
            }
          }
        ]
      }
    },
    {
      "key": "U8",
      "title": "Packaged design handoff, docs, telemetry, and end-to-end hardening",
      "outcome": "The optional feature is documented, skill-backed, privacy-bounded, package-complete, restart/compaction/cancel hardened, and verified end to end against the fake peer with disabled workflows unchanged.",
      "acceptance": [
        "The packaged skill carries design-to-plan discipline without credentials, direct provider calls, or a second command surface.",
        "README covers opt-in configuration, authoritative Settings command spec, /usr/bin/od collision, provider disclosure, fallback, paths, approval, and troubleshooting.",
        "Telemetry contains only bounded operational categories/counts/timing and excludes content, prompts, source, credentials, and token-bearing URLs.",
        "Fake-peer end-to-end tests survive cancellation, process loss, restart, compaction, stale sync, and disabled/non-UI regression; package verification passes."
      ],
      "dependencies": ["U7"],
      "files": [
        "skills/work-design-handoff/SKILL.md",
        "README.md",
        "extensions/work-design.js",
        "extensions/work-models.js",
        "scripts/test-work-design.mjs",
        "scripts/test-work-opendesign-client.mjs",
        "scripts/test-work-brainstorm.mjs",
        "scripts/test-work-resume.mjs",
        "scripts/test-work-settings.mjs"
      ],
      "surfaces": ["skill", "documentation", "telemetry", "package", "e2e"],
      "nonGoals": ["real provider CI", "automatic install", "default Auto", "new dependency"],
      "verificationContract": {
        "version": 1,
        "required": [
          {
            "id": "package-regression",
            "capability": "command",
            "proof": "test",
            "source": "R31-R35 final package and offline end-to-end acceptance",
            "operation": {
              "command": "npm run verify:quiet",
              "timeoutMs": 900000,
              "expectedExit": 0,
              "assertions": [{"target": "exit", "operator": "equals", "value": "0"}]
            }
          }
        ]
      }
    }
  ]
}
```

## Verification strategy

- During each unit, run only its declared focused command. U8 runs the aggregate package gate once after the final production/package change.
- Before each production-module gate, run primary LSP diagnostics on edited JavaScript files. Before roadmap completion, run `lens_diagnostics mode=all` and resolve blocking edited-file diagnostics.
- The fake server is the default authority for framing, state, idempotency, failure, and restart tests. It must never contact a provider or require OpenDesign installation.
- Optional manual smoke: with user-approved billing/runtime, use an installed OpenDesign daemon to create a disposable project, run a tiny design, open Preview/Studio, edit, sync, approve, and inspect generated planning/proof state. Its absence cannot turn offline PASS into failure.
- Every created executable unit requires the repository's configured review/finalization policy and revision-bound proof before close.

## Success criteria

1. Off/non-UI behavior is byte-for-byte or observably unchanged at the workflow boundary.
2. Enabled substantial UI work reaches a resumable Preview/Studio or an explicit policy-correct fallback/blocker without schema work from the user.
3. Lost responses, restart, cancellation, and long generation never duplicate a logical run, lose its identity, or block the TUI.
4. Only validated design facts/assets enter the repository; generated code and credentials never do.
5. Approval cannot survive changed authority, and planning cannot proceed from stale or unresolved design.
6. Every approved `DES-*` criterion reaches implementation and required proof; finish names every missing fidelity cell.
7. `/wo redesign` audits and redesigns an existing UI before creating implementation work.
8. `npm run verify:quiet` passes with no new dependency and the packaged feature remains optional.

## Sources and traceability

- `C:/Users/Flex/AppData/Local/Temp/ce-workflow-ui-design-plans/FULL-PLAN.md` — authoritative product vision, lifecycle, schemas, failure/security rules, slices, and acceptance.
- `extensions/work-models.js` — current settings, brainstorm linking, plan/resume/finish, telemetry, and command seams.
- `extensions/work-dialogs.js` — mandatory shared list/checklist UX contract.
- `extensions/work-verification-contract.js` and capability adapter tests — current executable proof model.
- `scripts/test-work-brainstorm.mjs`, `scripts/test-work-settings.mjs`, `scripts/test-work-plan-open-questions.mjs`, `scripts/test-work-resume.mjs`, `scripts/test-work-start-finish.mjs`, and `scripts/test-work-browser-adapter.mjs` — current behavior/fixture patterns.
- OpenDesign README (`https://github.com/nexu-io/open-design/blob/main/README.md`) — public installation, Pi MCP support, Settings command-spec guidance, `/usr/bin/od` collision, local daemon/security, and Preview/Studio workflow.
- OpenDesign MCP implementation (`https://github.com/nexu-io/open-design/blob/main/apps/daemon/src/mcp.ts`) — current public tool schemas, request ID, terminal status, read-vs-mutation retry behavior, no-raw-key rule, and stdio SDK transport.
- Apache-2.0 `anthropics/skills` frontend-design principles — conceptual preflight reference only; avoid copied wording or add required attribution if implementation copies text.
