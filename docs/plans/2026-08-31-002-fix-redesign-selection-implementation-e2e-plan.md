---
title: Close the OpenDesign redesign chain and prove it on the calculator
kind: fix
date: 2026-08-31
topic: redesign-selection-implementation-e2e
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
supersedes:
  - docs/plans/2026-08-31-001-feat-opendesign-design-lifecycle-plan.md#R3
  - docs/plans/2026-08-31-001-feat-opendesign-design-lifecycle-plan.md#F2
  - docs/plans/2026-08-31-001-feat-opendesign-design-lifecycle-plan.md#U3
  - docs/plans/2026-08-31-001-feat-opendesign-design-lifecycle-plan.md#U8
---

# Close the OpenDesign redesign chain and prove it on the calculator

## Goal capsule

- **Objective:** Make redesign one durable, resumable chain from UI requirements through three real OpenDesign visual candidates, explicit user selection, final design review and approval, implementation-work creation, product implementation, and side-by-side fidelity proof.
- **Live acceptance project:** `benchmarks/workflow-evaluation/v1/projects/calculator` copied into a disposable Git repository.
- **Live redesign prompt:** `Create a kids-like calculator design that features bright colors.`
- **Why this prompt:** The seed calculator is deliberately plain. A bright, child-oriented direction is visibly different from the baseline, so a false pass using the old UI or unrelated screenshots is easy to detect.
- **Human gates:** The user personally chooses one of three OpenDesign candidates, personally approves the refined selected design, and personally accepts or rejects the final side-by-side implementation comparison.
- **Automation boundary:** Everything except those aesthetic decisions advances automatically and durably. A command may return while OpenDesign or implementation runs, but the persisted continuation must resume the same chain; no manual retry script or direct internal-function shortcut is allowed.
- **Completion rule:** Offline tests are necessary but insufficient. This correction is complete only after one retained real OpenDesign calculator run reaches implementation and passes behavior, accessibility, lineage, deterministic design checks, independent visual comparison, and final human fidelity review.

## Why the previous test passed the wrong thing

The prior exercise was a commissioning smoke, not an end-to-end redesign test:

1. It called internal lifecycle functions directly and supplied a hardcoded `selectedDirection`.
2. Its three choices were locally generated text descriptions, not three OpenDesign previews.
3. It did not exercise the real selection dialog or capture a human selection receipt.
4. The first OpenDesign run failed after a daemon restart; a separate direct MCP retry succeeded without updating the failed ce-workflow design session.
5. It did not execute review, sync, approval, planning, task materialization, implementation, or fidelity finish gates.
6. It accepted OpenDesign files as the terminal result and later used screenshots from a different application revision.

The corrected test must make each omission impossible to report as PASS.

## Corrected lifecycle

```text
redesign request
→ UI requirements brainstorm and current-UI audit
→ OpenDesign produces exactly three visual candidates
→ user opens all candidates and selects one
→ selection receipt pins candidate and artifact hashes
→ OpenDesign refines the selected candidate into the complete design
→ sync and validate final handoff
→ user explicitly approves the final design
→ approval transaction queues planning
→ plan and implementation work items are materialized
→ the active project goal implements the approved design
→ calculator behavior/accessibility/browser checks run
→ approved-preview and implemented-product screenshots are captured at identical states/viewports
→ deterministic fidelity checks and independent visual comparison run
→ user accepts or rejects the final side-by-side result
→ finish only after every gate passes
```

Only three states may wait for the user: candidate selection, final design approval, and final implementation fidelity acceptance. Provider/runtime failures produce a durable typed blocker with one resume action; they never create an alternate untracked path.

## Decisions

1. **OpenDesign owns the three visual candidates.** Delete the production use of locally synthesized `designDirectionBoards()`. Text-only direction suggestions may remain only as an explicit no-OpenDesign fallback and cannot satisfy a Required workflow.
2. **Exactly three candidates for candidate-first redesign.** Each candidate is a separately addressable visual artifact with a stable ID, title, rationale, validated launcher fragment/artifact, target coverage, and host-computed content hash. A list of prose labels is invalid. The host reads candidate files through the allowlisted OpenDesign `read` operation, computes hashes itself, and never trusts manifest self-hashes alone.
3. **Candidates and target variants are different concepts.** `DESIGN-CANDIDATES.json` contains competing visual directions. `DESIGN-HANDOFF.json` v2 `variants[]` continues to describe platform/viewport variants of the one selected direction.
4. **Selection and approval are separate human decisions.** Selection chooses what OpenDesign should refine. Approval accepts the refined synchronized handoff as implementation authority. Neither live decision may be inferred from a successful run, default choice, scripted answer, or previous approval. Offline fixture decisions use explicit non-production authority and can never be upgraded to human receipts.
5. **No default candidate in the live UI.** The shared dialog may recommend a candidate but must not preselect or auto-submit it. Headless mode returns `needs_human` with three host-projected preview actions derived from one validated OpenDesign preview base plus allowlisted candidate fragments.
6. **Selection is hash-pinned.** Add `DIRECTION-SELECTION.json`. It records owner, brief hash, candidate-manifest hash, selected candidate ID/hash, decision authority/event, timestamp, and bounded note. Changing any candidate artifact invalidates the selection and final approval.
7. **The final handoff proves selection lineage.** New candidate-first commissions require a backward-compatible `selection` block in `DESIGN-HANDOFF.json` v2. It must match `DIRECTION-SELECTION.json`; old handoffs without a candidate phase remain readable.
8. **Approval creates a crash-recoverable continuation, not a dead end.** The atomic design-session transition to `approved` stores `approvalHash` and `pendingContinuation={kind:"materialize-approved-design", key, approvalHash, state:"queued"}` together. The key is the hash of owner ID, approval hash, and continuation kind. Resume reconciles orphan approval artifacts and partially materialized units by that key, then marks the continuation complete only after all linked work exists; it must not stop with only `Next: /wo resume`.
9. **Plan materialization is part of redesign.** The approved handoff is converted into an implementation-ready roadmap and normal work items. Every `DES-*` criterion and selected-candidate hash must be present in at least one work item or shared parent authority.
10. **The current project goal implements the work.** Do not launch a second routine writer. After materialization, the same autonomous project loop claims and implements the first ready design-linked item, then continues until the redesign roadmap is complete or a real blocker/human gate occurs.
11. **Recovery stays inside the lifecycle.** A daemon restart, lost response, Pi restart, or compaction resumes through the persisted session and original mutation identity. Direct `callOpenDesignTool()` retry scripts are forbidden in end-to-end tests.
12. **Fidelity is semantic plus visual, not raw pixel identity.** Exact approved tokens and required regions are checked deterministically; layout geometry and typography use bounded tolerances. Visual comparison reuses the existing Pi evaluator launch, model-fingerprint, JSON-validation, blinding, and evidence-store machinery through one image-pair adapter; final human review judges the remaining match.
13. **No screenshot provenance ambiguity.** Every final screenshot records disposable workspace root, Git HEAD, browser URL, state, viewport, timestamp, file hash, handoff hash, and approval hash. Evidence outside the disposable calculator workspace cannot satisfy implementation proof.
14. **Reference capture is an explicit user action.** Candidate/refined OpenDesign URLs remain inert until the user chooses Preview/Capture. Capture runs in a fresh no-cookie browser context restricted to the validated preview origin and binds project/run, candidate/selection hashes, DOM candidate marker, viewport, and screenshot hash. There is no background fetch of arbitrary remote URLs.
15. **Reuse the calculator benchmark and evaluation evidence store.** Add a dedicated redesign scenario beside the existing calculator request; do not mutate the original calculator benchmark or create another toy application.
16. **Offline CI and live acceptance have different authority.** The fake OpenDesign test is mandatory package CI and proves orchestration/recovery. A fixture decision is accepted only when the session is marked `testOnly`, the OpenDesign adapter fingerprint is `fixture`, and the disposable workspace is under the test harness root; all materialized outputs remain non-production. The real OpenDesign run is a retained release/adoption gate and proves the actual visual chain.

## Product requirements

### Candidate generation and selection

- **R1.** Candidate-first redesign writes a complete requirements/audit brief before contacting OpenDesign and preserves the original user prompt verbatim.
- **R2.** The OpenDesign candidate prompt requires exactly three meaningfully distinct interpretations of the settled direction, each using the same product content and representative states at every required target viewport.
- **R3.** OpenDesign returns root `DESIGN-CANDIDATES.json` v1, one candidate launcher, and exactly three separately addressable candidate artifacts. Each fragment renders its candidate artifact in a same-origin document exposing bounded `data-ce-candidate-id` and `data-ce-brief-hash` markers. Candidate HTML remains sandboxed in OpenDesign and is not imported into production source.
- **R4.** Candidate sync allowlists only `DESIGN-CANDIDATES.json` metadata locally, then reads the three named artifacts through verified OpenDesign `read` calls to compute host hashes. Validation rejects missing/duplicate IDs, fewer or more than three candidates, invalid launcher fragments, prose-only candidates, absent artifacts, incomplete target coverage, path traversal, unbounded fields, changed brief hash, identical host hashes, and response project/run mismatches.
- **R5.** The controller derives `candidatePreviews[]` from the persisted normalized run `previewUrl` plus each allowlisted `#candidate=<ID>` fragment; the manifest cannot supply an origin, credentials, query, or absolute URL. The shared design dialog shows three candidate rows with a muted purpose line, explicit Preview/Capture action, summary, differentiators, target coverage, and selection action. Escape returns to the parent. Opening or capturing is not selection.
- **R6.** A real user action creates `DIRECTION-SELECTION.json` with `authority: "human"`; the controller cannot create human authority from options, tests, defaults, model prose, or run success. The offline controller accepts `authority: "fixture"` only under the three test-only conditions in Decision 16 and rejects that receipt in every live/production session.
- **R7.** Rejection can request three new candidates against the same requirements. It creates a new request ID and candidate-manifest revision while preserving prior evidence and invalidating the old selection.

### Selected design, approval, and authority

- **R8.** The refinement prompt names the selected candidate ID/hash and requires OpenDesign to preserve its defining palette, typography, composition, signature element, and target coverage while completing all required states/interactions.
- **R9.** Final `DESIGN-HANDOFF.json` v2 must include target variants plus candidate-selection lineage. Sync rejects a final handoff that references another candidate or omits the selection block in a candidate-first session.
- **R10.** Review presents the refined selected preview, not the candidate launcher or an unrelated active OpenDesign project. Preview URLs are refreshed from the persisted project/run identity.
- **R11.** Explicit approval occurs only after current sync and validation. It pins brief, candidate manifest, selected candidate, final handoff, remote fingerprint, owner, and revision hashes.
- **R12.** Any relevant remote or repository design-authority mutation invalidates approval and downstream unstarted work. Implemented work pauses for focused reapproval and affected-proof refresh.

### Automatic planning and implementation

- **R13.** Approval artifact creation and session transition are reconciled as one recoverable transaction: write the approval artifact atomically, then atomically store `approved`, its hash, and the queued continuation in the same session write. Resume may attach an orphan approval only when its persisted decision-event ID and all authority hashes match the still-current session; otherwise it quarantines the artifact and asks again.
- **R14.** The continuation invokes the existing approved-plan/materialization path with its deterministic key. Each unit uses `(ownerId, approvalHash, unitKey)` as its idempotency identity; resume discovers/reconciles existing partial work before creating anything and marks the continuation complete only when the entire expected unit set exists.
- **R15.** Every item carries brief, candidate manifest, selection, handoff, and approval paths/hashes; continuation key; assigned `DES-*` IDs; required screens/states/viewports; prototype non-authority; and exact verification entries.
- **R16.** Production planning/implementation requires current human selection and final human approval. Test-only sessions may use fixture-authority receipts solely to exercise the disposable offline chain; their work items are marked `testOnly` and cannot be reconciled into a production store.
- **R17.** The active project goal implements product files in the disposable repository, never the OpenDesign prototype workspace. It may reuse ideas/tokens but cannot copy generated application code blindly.
- **R18.** The redesign controller continues through all ready implementation items and proof work without another user command. It stops only for the three human gates, an external capability blocker, or failed acceptance requiring correction.

### Recovery and observability

- **R19.** Candidate generation and selected-design refinement each persist project ID, run ID, request ID, payload digest, phase, and next action before/after mutation using the existing idempotency rules.
- **R20.** A terminal OpenDesign run updates the owning design session through one controller path. A successful raw MCP result without the matching session transition is ignored by planning and cannot count as progress.
- **R21.** Fake-peer coverage must interrupt candidate generation and final refinement independently, restart the controller, and prove same-session recovery with no duplicate project/run/selection/approval/task.
- **R22.** The run ledger records every state transition and decision receipt. Missing phase records fail end-to-end acceptance instead of being treated as telemetry loss.
- **R23.** Result reporting distinguishes OpenDesign candidate/refinement artifacts, synchronized authority, production implementation, and final product evidence. It may never label an OpenDesign preview as implemented product output.

### Fidelity and completion

- **R24.** The approved handoff must expose concrete role colors/tokens, required regions, typography roles, signature element, responsive rules, and `DES-*` criteria sufficient for bounded verification.
- **R25.** Browser proof captures the selected OpenDesign preview and implemented calculator in the same representative state at 390×844 and 1024×768 unless the approved target matrix explicitly replaces one viewport. Reference capture requires the user's Preview/Capture action and a fresh isolated context with no cookies, credentials, downloads, clipboard, or cross-origin requests; navigation and static subresources are restricted to the normalized preview origin. The adapter hashes the rendered candidate document response bytes and requires equality with the host-computed OpenDesign artifact hash. Page markers, project/run IDs, candidate/selection hashes, viewport, origin hash, browser fingerprint, and screenshot hash form the receipt.
- **R26.** Deterministic fidelity checks cover:
  - exact selected-candidate/final-handoff/approval lineage;
  - required calculator regions and controls;
  - approved role colors and CSS tokens after browser normalization;
  - normalized container/display/keypad/control geometry within 15% per declared anchor;
  - typography size/weight hierarchy within 15%;
  - required responsive reflow, no horizontal overflow, visible focus, and contrast;
  - baseline-to-final change and the accepted bright/kids-like direction.
- **R27.** The prompt-specific bright/kids-like gate requires at least four approved role colors, at least three distinct hue families, non-neutral saturated accents, a handoff-declared playful signature element, and final computed styles using those approved values. The exact chosen aesthetic remains the user's decision.
- **R28.** `scripts/workflow-visual-evaluation.mjs` reuses the existing `pi --mode json --print --no-session` evaluator launcher and model-fingerprint checks. It copies hash-verified screenshot pairs to random A/B filenames, supplies only the approved rubric/traits and image paths to `agents/workflow-visual-evaluator.md`, requires an evaluator provider/model fingerprint different from the recorded implementation writer, and validates `visual-evaluation/v1` JSON. Palette, hierarchy, composition, typography, signature element, and responsive adaptation must each score at least 3/4 and the mean must be at least 3.25. Missing images, changed hashes/model identity, malformed output, evaluator failure, or evaluator/writer identity equality invalidates the run.
- **R29.** After automated gates pass, the user sees the selected-design and final-product screenshots side by side and records `FINAL-FIDELITY-ACCEPTANCE.json` as accepted or rejected. Rejection returns implementation to correction with notes and does not alter the approved design silently.
- **R30.** Finish requires calculator functional acceptance, clean console, accessibility, both viewport screenshots, deterministic fidelity, independent comparison, and final human acceptance, all bound to the same implementation Git HEAD.

## Durable artifact contracts

### Design candidate manifest

`DESIGN-CANDIDATES.json` v1 contains:

```json
{
  "version": 1,
  "ownerId": "work-id",
  "briefHash": "sha256",
  "revision": 1,
  "candidates": [
    {
      "id": "CANDIDATE-1",
      "title": "string",
      "summary": "string",
      "differentiators": ["string"],
      "previewArtifact": "candidate-1.html",
      "previewFragment": "#candidate=CANDIDATE-1",
      "targets": ["TARGET-RESPONSIVE"],
      "viewports": ["mobile", "desktop"],
      "artifactHash": "sha256"
    }
  ]
}
```

Validation requires exactly three candidates and three distinct host-computed artifact hashes. The manifest never carries a usable remote origin. After a successful candidate run, the controller validates and persists one normalized base `previewUrl`, then projects each action as that base with the exact allowlisted fragment. The base is refreshed only from the matching OpenDesign project/run; a changed project, run, origin, artifact hash, or marker makes the action stale.

### Decision receipt authority

`DIRECTION-SELECTION.json` v1 contains the owner, brief hash, candidate-manifest hash/revision, selected candidate ID/artifact hash, `authority` (`human` or `fixture`), decision-event ID, decision time, and optional bounded note. Final `APPROVAL.json` uses the same authority model.

`human` is emitted only by a live shared-dialog event. `fixture` is accepted only when the persisted design session has `testOnly: true`, the verified adapter fingerprint equals `fixture`, and the workspace is a descendant of the harness-created temporary root. The controller checks all three at the selection, approval, planning, and finish boundaries. Fixture receipts and work items remain labeled `testOnly`; copying them to another store or changing any condition fails closed.

### Final handoff lineage

Candidate-first `DESIGN-HANDOFF.json` v2 adds:

```json
{
  "selection": {
    "manifestHash": "sha256",
    "candidateId": "CANDIDATE-2",
    "candidateHash": "sha256",
    "selectionHash": "sha256"
  }
}
```

The field is optional for legacy sessions and mandatory when the runtime session has a candidate manifest.

### Approval continuation record

The design session persists:

```json
{
  "pendingContinuation": {
    "kind": "materialize-approved-design",
    "key": "sha256(ownerId + approvalHash + kind)",
    "approvalHash": "sha256",
    "state": "queued",
    "expectedUnitKeys": ["U1"],
    "completedUnitKeys": [],
    "attempts": 0
  }
}
```

The atomic session write contains `state: "approved"`, `approvalHash`, and this record together. The materializer tags each output with the continuation key and `(ownerId, approvalHash, unitKey)`. Resume reconciles existing tags before writing, advances `completedUnitKeys` atomically, and clears/marks the record complete only when expected and actual units match. A crash after approval-file write but before session write is recovered only from the matching persisted human/fixture decision event; a crash after partial task writes cannot duplicate tasks.

### Reference capture receipt

Candidate and refined-preview capture is a user-triggered capability, not an automatic URL fetch. The browser adapter starts a fresh storage-less context; restricts navigation and subresources to the exact normalized preview origin; disables cookies, credentials, downloads, clipboard, popups, and cross-origin requests; verifies `data-ce-candidate-id` plus `data-ce-brief-hash`; hashes the candidate document response bytes against the artifact read through OpenDesign; and captures the declared viewport. `reference-captures.json` binds origin hash (not tokenized URL), project/run, candidate/artifact/selection hashes, DOM markers, viewport, timestamp, browser fingerprint, and screenshot SHA-256. A receipt is stale when any bound value changes.

### Independent visual evaluation

`scripts/workflow-visual-evaluation.mjs` is a thin image-pair adapter over the existing workflow evaluator process contract. It verifies input hashes, copies images to random A/B filenames outside the project workspace, randomizes pair order, invokes `agents/workflow-visual-evaluator.md` through the existing non-session Pi JSON launcher, validates the configured provider/model fingerprint, and removes the blinded copies afterward. The configured evaluator fingerprint must differ from the implementation writer fingerprint recorded by goal telemetry.

The adapter writes `visual-evaluation/v1` with input hashes, evaluator fingerprint, blinded-control hash, six 0–4 dimension scores, bounded rationale, mean, pass/fail, and wall time. The secret A/B mapping is stored separately in `evaluator-control.json`; neither the evaluator prompt nor image filenames reveal selected/implemented roles. Missing identity, malformed scores, hash drift, process failure, or identity equality fails closed.

### End-to-end evidence

Retain one evidence directory using the existing workflow-evaluation evidence-store rules:

```text
<evidence-root>/<run-id>/
  evidence.json
  lifecycle.jsonl
  DESIGN-CANDIDATES.json
  DIRECTION-SELECTION.json
  DESIGN-HANDOFF.json
  APPROVAL.json
  FINAL-FIDELITY-ACCEPTANCE.json
  work-items.json
  git.json
  reference-captures.json
  visual-evaluation.json
  evaluator-control.json
  screenshots/
    baseline-mobile.png
    candidate-1-mobile.png
    candidate-2-mobile.png
    candidate-3-mobile.png
    selected-mobile.png
    implemented-mobile.png
    selected-desktop.png
    implemented-desktop.png
  fidelity.json
  calculator-acceptance.json
  report.json
```

`evidence.json` contains hashes and bounded metadata, not prompts, credentials, tokenized URLs, or prototype source.

## Calculator end-to-end test protocol

### Fixture preparation

1. Copy only `benchmarks/workflow-evaluation/v1/projects/calculator/seed` into a new temporary directory and initialize a new Git repository.
2. Record the seed commit and baseline screenshots at 390×844 and 1024×768.
3. Configure this repository to use the local ce-workflow checkout, `visualDesignWorkflow: required`, strict design proof, the real browser adapter, and the explicit verified OpenDesign command spec.
4. Keep the original calculator behavior contract and acceptance verifier unchanged.
5. Add a dedicated redesign request/contract/rubric beside the existing benchmark files; do not replace `request.txt`, `product-contract.md`, or `rubric.json` used by earlier evaluations.

### Public workflow drive

The live harness must drive the same public `/wo redesign`, design-dialog, resume/controller, goal implementation, and finish surfaces used by a user. It may observe exported state; it may not call `prepareDesignSession()`, `approveDesignSession()`, `buildWorkPlanState()`, or `callOpenDesignTool()` to advance phases.

1. Submit exactly: `Create a kids-like calculator design that features bright colors.`
2. Complete the normal UI discovery/current-UI audit using the existing calculator product contract as behavior authority.
3. Wait for three real candidate previews.
4. Pause and let the user explicitly Preview/Capture all three candidates at the declared viewports, inspect them, and choose one. Capture failure blocks selection proof.
5. Persist the real selection receipt.
6. Commission/refine the selected candidate, then pause for final design review and explicitly capture the refined authority at both viewports.
7. Let the user approve or request changes. Approval must be explicit and pins the refined capture hashes.
8. Observe automatic planning/materialization and record created roadmap/work-item IDs.
9. Let the active project goal implement the redesign and correct failures until all work items close.
10. Run existing calculator behavior/accessibility acceptance.
11. Reuse the approval-pinned refined-design captures and capture implemented-product screenshots at matched states/viewports; never depend on an expired preview URL after implementation.
12. Run deterministic and independent fidelity checks.
13. Show side-by-side evidence to the user and record final fidelity acceptance.
14. Commit/close only after all evidence is current and emit the retained report path.

### Hard anti-shortcut assertions

The end-to-end run fails when any of the following is true:

- the candidate count is not exactly three;
- candidate previews are missing, identical, or only prose;
- selection or approval is supplied through options/defaults instead of a recorded decision event;
- selection and approval are collapsed into one event;
- a retry starts outside the persisted lifecycle controller;
- no implementation work item is created after approval;
- product files are unchanged from the seed;
- implementation screenshots resolve outside the disposable workspace;
- a screenshot predates the implementation HEAD or lacks its revision hash;
- OpenDesign preview files are reported as production implementation;
- calculator functional/accessibility/console checks fail;
- the final design does not satisfy the selected handoff tokens/regions/geometry;
- the final UI remains visually equivalent to the plain baseline;
- independent visual scoring or final human fidelity approval is missing;
- any lifecycle phase is absent from `lifecycle.jsonl`.

## Offline test strategy

The package gate remains provider-free:

1. Extend `scripts/fixtures/opendesign/fake-od.mjs` to emit three candidate artifacts/manifests and a selected-candidate final handoff.
2. Add a scripted decision adapter that exercises the same selection/approval event validation. It emits `authority: "fixture"`, and the test proves acceptance only with `testOnly: true`, adapter fingerprint `fixture`, and a harness-owned temporary workspace. Remove each condition in adversarial cases and assert that planning is blocked. Fixture authority never becomes human authority.
3. Drive the extension command/controller surface in a disposable calculator Git repository.
4. Simulate daemon/process restart after candidate dispatch and after refinement dispatch.
5. Verify exact continuation, selection invalidation, approval invalidation, plan/task materialization, implementation action routing, proof gating, and no duplicate mutations.
6. Use a deterministic fixture implementation only to prove controller completion; never treat its visuals as evidence that real OpenDesign or a real implementation agent matches.
7. Add a static assertion that the live end-to-end harness contains no imports/calls for the forbidden internal advancement functions.

## Implementation units

### U1 — Real three-candidate OpenDesign contract

- **Files:** `extensions/work-design.js`, `extensions/work-models.js`, `extensions/opendesign-client.js`, `scripts/fixtures/opendesign/fake-od.mjs`, focused design tests.
- **Change:** Add candidate manifest validation/state, candidate prompt, allowlisted artifact reads with host hashes, base-preview-plus-fragment projection, three Preview/Capture actions, selection receipt, final handoff selection lineage, and staleness rules. Remove production selection through local text boards.
- **Acceptance:** Exactly three visual candidates are required and independently openable from one validated run; origins/queries cannot come from the manifest; target variants remain separate; candidate mutation invalidates selection; wrong selected-candidate lineage blocks sync/approval.

### U2 — Human selection and approval controller

- **Files:** `extensions/work-models.js`, shared-dialog integration only where needed, design/dialog tests.
- **Change:** Add candidate review/selection projection and explicit decision-event validation. Keep final approval as a separate gate. Headless mode returns `needs_human` rather than choosing.
- **Acceptance:** No default auto-selection; opening a preview is not selection; fixture decisions cannot claim human authority; restart preserves both decision boundaries.

### U3 — Approval-to-plan-to-implementation continuation

- **Files:** `extensions/work-models.js`, existing work-store/materialization seams, resume/goal/plan tests.
- **Change:** Store approved state, approval hash, and keyed `materialize-approved-design` continuation in one session write; reconcile orphan approval/partial units; automatically invoke approved design planning/materialization; continue the active project goal through implementation and proof.
- **Acceptance:** Approval creates linked executable work without another user command; crashes before/after session commit and between unit writes resume without a second decision or duplicate work; every design hash/criterion propagates; no routine second writer.

### U4 — Revision-bound fidelity comparison

- **Files:** `extensions/work-design.js`, verification-contract/browser adapter seams, `agents/workflow-visual-evaluator.md`, `scripts/workflow-visual-evaluation.mjs`, calculator redesign verifier, focused finish tests.
- **Change:** Add explicit isolated Preview/Capture receipts; produce deterministic token/region/geometry/typography/responsive checks and selected-preview/final-product evidence pairs; run the concrete hash-addressed blinded evaluator with a different recorded identity; record final human fidelity receipt.
- **Acceptance:** Automatic/arbitrary remote fetch fails; changed preview origin/project/run/markers/hashes fail; current-release or wrong-workspace screenshots fail; plain baseline fails the bright/kids-like gate; malformed/same-identity evaluator output fails; rejection returns to correction.

### U5 — Durable offline calculator end-to-end fixture

- **Files:** dedicated calculator redesign request/contract/rubric, `scripts/test-work-redesign-calculator-e2e.mjs`, fake OpenDesign fixture, package inventory.
- **Change:** Run the full public controller chain with fixture decisions and restart injection in a disposable calculator repository.
- **Acceptance:** Every phase and hash is present; duplicates/shortcuts fail; implementation action and finish gates execute; package CI remains offline and deterministic.

### U6 — Real OpenDesign calculator adoption run

- **Files:** `scripts/run-work-redesign-calculator-e2e.mjs`, evaluator/evidence integration, operator documentation.
- **Change:** Add a live mode using the verified real OpenDesign and browser adapters, real user selection/approval/final acceptance, automatic implementation, and durable retained evidence.
- **Acceptance:** One complete retained run with the exact bright kids-like prompt passes all hard gates. A provider/runtime failure is reported as blocked, never PASS, and resumes through the same run identity.

## Executable implementation manifest

```json
{
  "implementationUnits": [
    {
      "key": "U1",
      "title": "Real three-candidate OpenDesign contract",
      "dependencies": [],
      "files": [
        "extensions/work-design.js",
        "extensions/work-models.js",
        "extensions/opendesign-client.js",
        "scripts/fixtures/opendesign/fake-od.mjs",
        "scripts/test-work-design-candidates.mjs"
      ],
      "acceptance": [
        "Exactly three separately previewable OpenDesign candidates validate and distinct artifact hashes are required.",
        "Candidate selection is hash-bound and final handoff lineage must match it.",
        "Local prose boards cannot satisfy a Required OpenDesign redesign."
      ],
      "verificationContract": {
        "version": 1,
        "required": [{
          "id": "design-candidate-contract",
          "capability": "command",
          "proof": "test",
          "source": "R1-R12",
          "operation": {
            "command": "node scripts/test-work-design-candidates.mjs",
            "timeoutMs": 180000,
            "expectedExit": 0,
            "assertions": [{"target": "exit", "operator": "equals", "value": "0"}]
          }
        }]
      }
    },
    {
      "key": "U2",
      "title": "Human selection and approval controller",
      "dependencies": ["U1"],
      "files": [
        "extensions/work-models.js",
        "scripts/test-work-design.mjs",
        "scripts/test-work-dialogs.mjs"
      ],
      "acceptance": [
        "Selection and approval are separate explicit decision events.",
        "No TUI or headless default can claim human selection.",
        "Restart preserves candidate review and final approval gates."
      ],
      "verificationContract": {
        "version": 1,
        "required": [{
          "id": "design-human-gates",
          "capability": "command",
          "proof": "test",
          "source": "R5-R7 and R10-R12",
          "operation": {
            "command": "node scripts/test-work-design.mjs",
            "timeoutMs": 180000,
            "expectedExit": 0,
            "assertions": [{"target": "exit", "operator": "equals", "value": "0"}]
          }
        }]
      }
    },
    {
      "key": "U3",
      "title": "Approval-to-plan-to-implementation continuation",
      "dependencies": ["U2"],
      "files": [
        "extensions/work-models.js",
        "scripts/test-work-plan-open-questions.mjs",
        "scripts/test-work-resume.mjs",
        "scripts/test-work-goal.mjs"
      ],
      "acceptance": [
        "Approved state, approval hash, and a deterministic queued continuation are committed in one session write.",
        "Orphan approval and partial-unit recovery preserve the decision and create no duplicate work.",
        "Every candidate/design/approval hash and DES criterion reaches work items.",
        "The active project goal implements without a routine second writer."
      ],
      "verificationContract": {
        "version": 1,
        "required": [{
          "id": "design-automatic-continuation",
          "capability": "command",
          "proof": "test",
          "source": "R13-R18",
          "operation": {
            "command": "node scripts/test-work-goal.mjs",
            "timeoutMs": 240000,
            "expectedExit": 0,
            "assertions": [{"target": "exit", "operator": "equals", "value": "0"}]
          }
        }]
      }
    },
    {
      "key": "U4",
      "title": "Revision-bound fidelity comparison",
      "dependencies": ["U3"],
      "files": [
        "extensions/work-design.js",
        "extensions/work-models.js",
        "agents/workflow-visual-evaluator.md",
        "scripts/workflow-visual-evaluation.mjs",
        "benchmarks/workflow-evaluation/v1/projects/calculator/acceptance/verify-redesign.mjs",
        "scripts/test-work-design-fidelity.mjs"
      ],
      "acceptance": [
        "User-triggered isolated reference captures match OpenDesign project/run, origin, document bytes, candidate markers/hash, and viewport.",
        "Selected-preview and product screenshots are matched by state, viewport, workspace, Git HEAD, and design hashes.",
        "Token, region, geometry, typography, responsive, bright/kids-like, different-identity blinded evaluator, and final human gates fail closed.",
        "Unrelated or stale screenshots cannot satisfy finish."
      ],
      "verificationContract": {
        "version": 1,
        "required": [{
          "id": "design-fidelity-comparison",
          "capability": "command",
          "proof": "test",
          "source": "R24-R30",
          "operation": {
            "command": "node scripts/test-work-design-fidelity.mjs",
            "timeoutMs": 240000,
            "expectedExit": 0,
            "assertions": [{"target": "exit", "operator": "equals", "value": "0"}]
          }
        }]
      }
    },
    {
      "key": "U5",
      "title": "Durable offline calculator redesign end-to-end fixture",
      "dependencies": ["U4"],
      "files": [
        "benchmarks/workflow-evaluation/v1/projects/calculator/redesign-request.txt",
        "benchmarks/workflow-evaluation/v1/projects/calculator/redesign-contract.md",
        "benchmarks/workflow-evaluation/v1/projects/calculator/redesign-rubric.json",
        "scripts/test-work-redesign-calculator-e2e.mjs",
        "scripts/verify-package.mjs"
      ],
      "acceptance": [
        "The public controller chain covers brainstorm/audit, candidates, fixture selection, refinement, fixture approval, planning, task creation, implementation action, fidelity, and finish.",
        "Candidate and refinement restart injection resumes exactly once without direct internal advancement.",
        "Every hard anti-shortcut assertion has a seeded failing case."
      ],
      "verificationContract": {
        "version": 1,
        "required": [{
          "id": "calculator-redesign-offline-e2e",
          "capability": "command",
          "proof": "test",
          "source": "Offline test strategy and hard anti-shortcut assertions",
          "operation": {
            "command": "node scripts/test-work-redesign-calculator-e2e.mjs",
            "timeoutMs": 300000,
            "expectedExit": 0,
            "assertions": [{"target": "exit", "operator": "equals", "value": "0"}]
          }
        }]
      }
    },
    {
      "key": "U6",
      "title": "Real OpenDesign calculator adoption run",
      "dependencies": ["U5"],
      "files": [
        "scripts/run-work-redesign-calculator-e2e.mjs",
        "README.md"
      ],
      "acceptance": [
        "A retained real run uses the exact prompt and real user candidate selection, design approval, and final fidelity acceptance.",
        "Implementation passes existing calculator acceptance and all deterministic/independent fidelity gates.",
        "The report references durable evidence and never substitutes another project or release screenshot."
      ],
      "verificationContract": {
        "version": 1,
        "required": [{
          "id": "calculator-redesign-live-e2e",
          "capability": "manual",
          "proof": "approval",
          "source": "Live calculator end-to-end test protocol",
          "inspection": "human",
          "instructions": "Run node scripts/run-work-redesign-calculator-e2e.mjs --mode live --evidence-root <durable-path>; inspect all three candidates, choose one, approve the refined design, and accept only a matching final side-by-side implementation after every automated gate passes."
        }]
      }
    }
  ]
}
```

## Verification matrix

| Gate | Mandatory mode | Evidence |
| --- | --- | --- |
| Candidate schema/distinctness | offline + live | manifest, three preview hashes |
| Human-decision authority | offline adversarial + live human | event/receipt provenance |
| Daemon/controller restart | offline | lifecycle ledger, unchanged request/project identity |
| Approval staleness | offline | invalidation and recovery assertions |
| Automatic plan/task creation | offline + live | roadmap/work-item export |
| Goal-owned implementation | offline routing + live | owner/claim telemetry and Git diff |
| Calculator behavior | offline fixture + live browser | existing acceptance JSON |
| Accessibility/console | live browser | adapter-issued evidence |
| Token/region/layout match | offline adversarial + live | `fidelity.json` |
| Baseline differs | live | baseline/final hashes and computed-style report |
| Independent visual match | live | blinded score report |
| Final user fidelity | live | `FINAL-FIDELITY-ACCEPTANCE.json` |
| Package regression | offline | `npm run verify:quiet` |
| Edited-file diagnostics | offline | primary LSP then `lens_diagnostics mode=all` |

## Adoption gates

1. No production candidate selection path uses `designDirectionBoards()` or a caller-supplied `selectedDirection` without a validated decision receipt.
2. Candidate-first Required redesign cannot advance with fewer/more than three real preview artifacts.
3. Selection, final approval, and final fidelity acceptance are distinct, hash-bound decisions.
4. A daemon restart or lost response cannot require or benefit from a direct retry script.
5. Approval automatically produces design-linked executable work and the active goal reaches implementation without another user command.
6. Every `DES-*` criterion and authority hash survives plan materialization, work execution, compaction, proof, and finish.
7. Wrong-workspace, stale, baseline, OpenDesign-only, and unrelated-release screenshots all fail.
8. The existing calculator functional contract passes unchanged.
9. The real final calculator visibly follows the selected candidate: deterministic fidelity passes, every independent visual dimension is at least 3/4 with mean at least 3.25, and the user accepts the side-by-side comparison.
10. The exact live prompt and retained evidence path appear in the final report.
11. `npm run verify:quiet` and edited-file diagnostics pass with no new dependency.

## Execution order

`U1 → U2 → U3 → U4 → U5 → U6`

Run focused checks after each unit. Run the package gate once after U5. Run the paid/real OpenDesign calculator acceptance only after offline failure injection is green, so provider time is not spent discovering deterministic orchestration bugs.

## Non-goals

- Pixel-perfect equality or a general image-diff service.
- Replacing the existing calculator benchmark or weakening its behavior/accessibility contract.
- Importing or executing OpenDesign prototype code in production.
- Auto-selecting a design because a model recommends it.
- Treating fake-provider output as proof that real OpenDesign or real implementation fidelity works.
- Adding a second writer, another provider abstraction, a background watcher, or a new dependency.
- Requiring live OpenDesign billing/network access in ordinary package CI.
