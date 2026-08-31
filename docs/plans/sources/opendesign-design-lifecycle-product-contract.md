# Full plan: first-class, resumable design lifecycle with OpenDesign

## Vision

Make visual design a first-class, human-approved, machine-verifiable lifecycle between requirements brainstorming and implementation planning:

```text
product intent
  -> requirements brainstorm
  -> distinctive visual-direction brief
  -> OpenDesign generation
  -> user walkthrough / comments / revisions
  -> cryptographically pinned approval
  -> structured design handoff
  -> implementation plan
  -> UI build
  -> browser + accessibility + fidelity verification
  -> finish
```

The user supplies product intent and aesthetic judgment in ordinary language. ce-workflow owns orchestration, OpenDesign prompt construction, return schemas, polling, synchronization, artifact import, stale-state detection, and downstream proof requirements.

The design is not a detached mockup. The approved handoff becomes a versioned input to planning and a verification contract for implementation.

## Product outcomes

1. A user can describe a feature once during brainstorming.
2. ce-workflow turns settled requirements into a complete design commissioning packet.
3. OpenDesign produces a live prototype and structured handoff without the user learning its schema.
4. The user can review in Preview/Studio, edit there, comment, approve, or reject.
5. ce-workflow can resume the exact design session after interruption.
6. Planning cannot silently ignore or mutate approved design decisions.
7. Implementation cannot finish while required screens, states, viewports, accessibility behavior, or approval-linked fidelity proofs are missing.
8. OpenDesign remains optional: missing installations have a safe text-design fallback unless project policy makes visual design required.

## Design principles

- **Requirements before pixels.** OpenDesign receives settled actors, flows, states, content, and constraints—not an ambiguous product request.
- **Distinctive before decorative.** A preflight based on the subject, audience, page job, typography, palette, layout, signature element, and anti-default critique runs before generation.
- **Human approval is explicit.** A generated preview is not approved because a run succeeded.
- **Approval is pinned.** Approval references exact brief and handoff hashes; later edits make it stale.
- **Files are the contract.** Human-readable Markdown and machine-readable JSON travel with the repository.
- **Prototype code is reference material.** It is not copied into production unless a later implementation task deliberately chooses and reviews it.
- **No user schema work.** ce-workflow writes OpenDesign prompts and repair prompts and parses the response.
- **No new dependency unless necessary.** A small stdio MCP client can be built with Node stdlib.
- **Trust boundaries stay strict.** OpenDesign output is external/untrusted until path-confined, size-bounded, parsed, and validated.
- **No fake real-time claim.** Manual OpenDesign edits are synchronized at command/resume boundaries or explicit sync, because the public MCP surface is polling-oriented.

## What OpenDesign provides

The current OpenDesign repository exposes a public stdio MCP server (`od mcp`) that proxies to its local daemon. Relevant tools include:

- `list_projects`
- `get_active_context`
- `get_project`
- `create_project`
- `list_skills`
- `list_plugins`
- `list_agents`
- `start_run`
- `get_run`
- `cancel_run`
- `get_artifact`
- `get_file`
- `list_files`
- `search_files`
- `create_artifact`
- `write_file`

`start_run` commissions OpenDesign's own agent and returns a `runId` immediately. `get_run` returns `queued|running|succeeded|failed|canceled`, plus `previewUrl` and `agentMessage` where available. `requestId` is an idempotency key and must be stable across retries. Preview/Studio is the default delivery; source is pulled only when needed.

OpenDesign also supports design systems (`DESIGN.md`), skills (`SKILL.md`), plugins, sandboxed previews, and project files. This plan consumes public surfaces only and does not import OpenDesign internals.

## Frontend-design preflight

The preflight adapts the useful principles of Anthropic's Apache-2.0 `frontend-design` skill into ce-workflow's own concise contract:

1. Name the concrete subject, audience, and surface's single job.
2. Use real product content and domain vocabulary.
3. Choose 4–6 named colors with roles and values.
4. Choose intentional display/body/utility typography roles.
5. Define a layout concept and compare compact wireframes when ambiguity warrants it.
6. Name one signature element the design should be remembered by.
7. Spend boldness in one place; remove unsupported decoration.
8. Reject generic defaults not grounded in the subject.
9. Match execution complexity to the chosen direction.
10. Specify responsive, keyboard, contrast, reduced-motion, empty, loading, success, and failure behavior.
11. Critique the direction before sending it to OpenDesign.

This is always pre-OpenDesign for substantial UI work. On design rejection, the rejection reason feeds a revised preflight before another OpenDesign run. If the user rejects OpenDesign itself, the same preflight produces the text-only handoff.

## Existing-UI redesign entry point

A brownfield project does not need to begin with a new feature idea. The explicit entry point is:

```text
/wo redesign <objective>
```

Example:

```text
/wo redesign Redesign the existing Belot game UI. Preserve rules, networking,
terminology, and card behavior, but reconsider the complete visual hierarchy
and interaction presentation.
```

This creates a durable **redesign initiative**, not an implementation task with guessed acceptance criteria. The initiative owns the current-UI audit, OpenDesign project/session, approvals, and eventual implementation roadmap. It is immediately resumable with `/wo resume`.

The brownfield flow is:

1. Discover how to run the existing app from declared repository commands; never guess a package command.
2. Use the existing browser/service adapters to inspect the live UI at desktop and mobile sizes.
3. Inventory reachable screens, overlays, transitions, and visible states.
4. Inspect repository routes, components, design tokens, assets, terminology, and UI-facing constraints.
5. Capture representative screenshots and record states that cannot yet be reached deterministically.
6. Separate `preserve`, `reconsider`, and `remove` decisions. Game rules, networking, persistence, and domain behavior default to preserve unless the objective says otherwise.
7. Write `CURRENT-UI-AUDIT.md` and its bounded JSON companion.
8. Run the frontend-design preflight against the product's subject and purpose rather than imitating the old styling.
9. Ask OpenDesign for 2–3 meaningfully different direction boards when the desired direction is still open.
10. Let the user choose/reject a direction in Preview/Studio.
11. Commission the selected direction as the complete screen/state/responsive prototype and structured handoff.
12. Approve and hash the synchronized handoff.
13. Materialize the implementation roadmap and work items only after the accepted design is known.
14. Apply changes through normal work execution and verify against the approved handoff.

### Current-UI audit contract

The audit records:

- how the app was started and inspected;
- routes/screens and their purpose;
- lobby, onboarding, loading, empty, error, disconnected/reconnecting, active, completed, and permission-limited states where applicable;
- desktop/mobile screenshots with provenance;
- current navigation and interaction flow;
- existing components/tokens/assets worth reusing;
- accessibility and responsive defects;
- obvious visual hierarchy, density, readability, feedback, and consistency problems;
- behavior that must be preserved;
- styling/layout that may be replaced;
- unknown or unreachable states requiring a fixture, seed, or manual walkthrough;
- baseline artifact hashes.

For the Belot game this should normally cover at least lobby/table selection, player seating, bidding/trump selection, active-turn indication, trick resolution, score/history, game completion, disconnect/reconnect, errors, and narrow/mobile layout.

Screenshots and existing source are evidence for understanding behavior, not a visual direction to imitate. OpenDesign receives explicit `preserve` and `replace` lists.

### Outcome and resumption semantics

`/wo redesign ...` produces one parent redesign initiative immediately. It does **not** create a ready-to-code work item before design approval.

- Before approval, `/wo resume` resumes the next design action: audit, generation polling, clarification, preview review, synchronization, or revision.
- After approval, ce-workflow turns the handoff into a roadmap and one or more normal implementation work items. A small redesign may become one item; a full Belot redesign will usually be sliced by coherent surface/state groups rather than arbitrary files.
- During implementation, `/wo resume` resumes the next unblocked implementation item and retains the parent initiative as traceability context.
- After implementation, `/wo resume` continues missing browser, responsive, accessibility, or fidelity proof work until finish gates pass.

The user therefore has one command to start and one command to continue. IDs remain available for status and disambiguation but are not required for the common path.

## Lifecycle state machine

Persist one extension-owned design session per brainstorm idea or roadmap:

```text
not_applicable
existing_ui_audit
brief_draft
brief_confirmed
provider_unavailable
commissioning
running
clarification_required
review_ready
changes_requested
sync_required
approved
handoff_imported
planned
implementing
verification_required
verified
superseded
canceled
failed
```

### Transition rules

- `not_applicable -> existing_ui_audit`: `/wo redesign` starts a brownfield initiative against the current project.
- `existing_ui_audit -> brief_draft`: current screens/states, constraints, and preserve/replace decisions are recorded.
- `brief_draft -> brief_confirmed`: requirements and visual preflight are settled.
- `brief_confirmed -> commissioning`: OpenDesign is available and policy permits it.
- `brief_confirmed -> provider_unavailable`: no usable OpenDesign; fallback is possible.
- `commissioning -> running`: `start_run` returns a run ID.
- `running -> clarification_required`: terminal/agent output contains no preview and asks a real unresolved question.
- `running -> review_ready`: run succeeds and preview/project files exist.
- `review_ready -> changes_requested`: user supplies ordinary feedback.
- `changes_requested -> running`: ce-workflow sends a normalized revision prompt against the same project.
- `review_ready -> sync_required`: OpenDesign file metadata/hash changed since the last imported handoff.
- `review_ready|sync_required -> approved`: user explicitly approves the current synchronized revision.
- `approved -> handoff_imported`: Markdown/JSON/assets are validated and written to repo paths.
- Any mutation to the imported handoff after approval moves it to `sync_required` and invalidates approval.
- `handoff_imported -> planned`: a plan records the exact handoff hash.
- `planned -> implementing -> verification_required -> verified`: ordinary work execution plus design-specific proof gates.
- `canceled`, `failed`, and `superseded` retain history and can be retried or replaced without deleting evidence.

No state transition relies on parsing conversational prose alone. UI actions and tool results write explicit state.

## Persistent data

### Runtime state (gitignored)

Store under:

```text
.pi/work/design-sessions/<idea-or-roadmap-id>.json
```

Example:

```json
{
  "version": 1,
  "ownerId": "wo-...",
  "status": "review_ready",
  "policy": "auto",
  "provider": "opendesign",
  "odProjectId": "checkout-redesign",
  "odConversationId": "...",
  "runId": "...",
  "requestId": "stable-uuid-or-ulid",
  "previewUrl": "http://...",
  "studioUrl": "http://...",
  "briefPath": "docs/designs/.../DESIGN-BRIEF.md",
  "briefSha256": "...",
  "handoffPath": "docs/designs/.../DESIGN-HANDOFF.json",
  "handoffSha256": "...",
  "remoteFileFingerprint": "...",
  "revision": 3,
  "startedAt": "...",
  "updatedAt": "...",
  "lastError": null,
  "approval": null
}
```

All fields are bounded and versioned. URLs are display/open references, not executable commands.

### Repository artifacts

For substantial UI work:

```text
docs/designs/<date>-<slug>/
  CURRENT-UI-AUDIT.md    # existing-UI redesigns only
  CURRENT-UI-AUDIT.json  # existing-UI redesigns only
  DESIGN-BRIEF.md
  DESIGN-HANDOFF.md
  DESIGN-HANDOFF.json
  APPROVAL.json
  reference/
    desktop.png          # optional, if OpenDesign/browser provides it
    mobile.png           # optional
```

The original `docs/brainstorms/*.md` links to this directory and remains the product-requirements source. The design directory contains only validated design facts and bounded reference assets.

### Work-item links

Use existing note/document-link patterns instead of changing the core work-store schema unless tests prove a real need:

```text
wo:design
status=approved
design-brief=docs/designs/.../DESIGN-BRIEF.md
design-handoff=docs/designs/.../DESIGN-HANDOFF.json
design-sha256=<hash>
od-project=<id>
od-run=<id>
```

Extend artifact discovery so planning recognizes `docs/designs/**/DESIGN-HANDOFF.{md,json}` as a design source. Do not overload `brainstorm-path` with non-brainstorm files.

## Machine-readable handoff contract

OpenDesign is instructed to return both `DESIGN-HANDOFF.md` and `DESIGN-HANDOFF.json`. JSON is authoritative for automation; Markdown is for humans.

### `DESIGN-HANDOFF.json` version 1

```json
{
  "version": 1,
  "identity": {
    "title": "string",
    "subject": "string",
    "audience": ["string"],
    "singleJob": "string"
  },
  "direction": {
    "summary": "string",
    "principles": ["string"],
    "signatureElement": "string",
    "intentionalRisk": "string",
    "avoid": ["string"]
  },
  "content": {
    "primaryMessage": "string",
    "primaryAction": "string",
    "vocabulary": ["string"],
    "requiredCopy": [{ "id": "string", "text": "string", "context": "string" }]
  },
  "tokens": {
    "colors": [{ "name": "string", "value": "#RRGGBB", "role": "string", "contrastOn": ["string"] }],
    "typography": [{ "role": "display|body|utility", "family": "string", "fallback": "string", "weights": [400], "usage": "string" }],
    "spacing": { "base": "string", "density": "string", "rules": ["string"] },
    "shape": { "radius": "string", "borders": "string", "elevation": "string" }
  },
  "screens": [{
    "id": "string",
    "name": "string",
    "purpose": "string",
    "entry": ["string"],
    "primaryAction": "string",
    "exit": ["string"],
    "regions": [{ "id": "string", "purpose": "string", "content": "string" }],
    "states": ["default", "loading", "empty", "error", "success", "disabled"]
  }],
  "flows": [{ "id": "string", "actor": "string", "steps": ["string"], "failureRecovery": ["string"] }],
  "components": [{ "id": "string", "purpose": "string", "variants": ["string"], "states": ["string"], "reuseHint": "string" }],
  "responsive": [{ "viewport": "mobile|tablet|desktop", "width": 390, "rules": ["string"], "priority": ["string"] }],
  "interactions": [{ "trigger": "string", "response": "string", "feedback": "string", "reducedMotion": "string" }],
  "accessibility": {
    "keyboard": ["string"],
    "focus": ["string"],
    "contrast": ["string"],
    "labels": ["string"],
    "announcements": ["string"],
    "motion": ["string"]
  },
  "assets": [{ "id": "string", "kind": "string", "source": "string", "license": "string", "required": true, "fallback": "string" }],
  "implementationConstraints": {
    "existingSystem": ["string"],
    "mustReuse": ["string"],
    "mustNotIntroduce": ["string"],
    "performance": ["string"]
  },
  "acceptance": [{
    "id": "DES-001",
    "statement": "string",
    "screen": "string",
    "viewports": ["mobile", "desktop"],
    "proof": ["interaction", "visual", "accessibility"]
  }],
  "openQuestions": [],
  "provenance": {
    "briefSha256": "64 lowercase hex",
    "odProjectId": "string",
    "odRunId": "string",
    "revision": 1,
    "generatedAt": "ISO-8601"
  }
}
```

### Validation rules

- Version must be exactly supported.
- Unknown top-level fields may be retained in raw source but ignored by v1 automation; required fields cannot be omitted.
- IDs must be unique, bounded, and safe.
- Arrays have explicit caps to prevent context and storage abuse.
- Strings have field-specific limits.
- Colors must be valid hex values for v1.
- Viewports and proof types are enums.
- Paths are project-relative, normalized, confined, non-symlinked, and size-bounded.
- No executable command, environment, package-install, or script field is accepted.
- `openQuestions` must be empty before approval. A non-empty list returns to clarification.
- `briefSha256` must equal the commissioned brief.
- Approval stores the canonical handoff hash, not the raw unordered JSON bytes.

### Automatic repair

If preview succeeds but the handoff is absent or invalid:

1. retain `review_ready` and preview access;
2. generate one deterministic repair prompt listing validation errors;
3. ask OpenDesign to rewrite only the handoff files without changing the approved visual direction;
4. re-fetch and revalidate once;
5. if still invalid, mark `failed` with a resumable action rather than asking the user to format JSON.

## Human-readable design brief

`DESIGN-BRIEF.md` contains:

- source brainstorm and work-item IDs;
- problem, actors, outcomes, and non-goals;
- complete visible flows and failure behavior;
- frontend-design preflight;
- existing product/design-system constraints discovered from the repo;
- real content/copy available;
- viewport and accessibility requirements;
- prohibited directions;
- OpenDesign return contract;
- brief hash.

It must not contain secrets, private environment values, unrelated repository source, or implementation instructions that do not affect product behavior.

## Automated feedback normalization

The user can say things like:

- “too corporate”;
- “keep the left rail but make the main task clearer”;
- “mobile feels cramped”;
- “I changed the colors in OpenDesign, use those”;
- “reject this approach; use the earlier editorial option.”

ce-workflow converts that into a provider prompt:

```text
Design revision <n>

Current approved/preserved facts:
- ...

User-observed problems:
- ...

Requested changes:
- ...

Must not regress:
- product requirements
- accepted screens/flows
- responsive behavior
- accessibility baseline
- settled content

Synchronize these files completely:
- preview entry file
- DESIGN-HANDOFF.md
- DESIGN-HANDOFF.json

Do not require the user to provide structured fields. Ask only one genuinely unresolved product/design question if required.
```

The revision is sent to the same OpenDesign project. A new stable `requestId` is generated per confirmed revision action and reused for transport retries.

## Manual OpenDesign edits

The user may edit or comment inside OpenDesign instead of asking ce-workflow to revise.

At `/wo design sync`, the planning boundary, `/wo resume`, and approval boundaries:

1. call `list_files` and compute a stable fingerprint from relevant path/mtime/size metadata;
2. if changed, call `get_artifact`/`get_file` for the current handoff and preview entry;
3. validate and hash the new handoff;
4. increment the local revision;
5. invalidate prior approval if the handoff hash changed;
6. show the changed direction summary and ask for approval again.

No background file watcher or indefinite polling is required. Command-boundary synchronization is honest, deterministic, and sufficient.

## OpenDesign adapter

### Discovery

Resolve in order:

1. explicit project setting for OpenDesign executable, if configured;
2. `OD_BIN` when it names an executable entry point;
3. PATH scan for `od`, including Windows executable wrappers.

Do not auto-install OpenDesign. Report install/configuration guidance and apply policy fallback.

### Transport

Add a small Node stdlib MCP stdio client:

- spawn `od mcp`;
- send MCP `initialize` and `notifications/initialized`;
- inspect `tools/list` rather than assuming every tool exists;
- send `tools/call` with monotonically unique JSON-RPC IDs;
- parse newline/content-length framing supported by the current server;
- keep stdout protocol separate from stderr diagnostics;
- cap response bytes;
- enforce per-call and overall-run timeouts;
- support cancellation and child cleanup;
- never retry mutating calls automatically after an ambiguous transport failure;
- safely retry read calls;
- reuse OpenDesign `requestId` when the caller explicitly retries `start_run`.

No MCP SDK dependency is needed unless the stdio framing proves materially more complex in implementation.

### Adapter API

`extensions/opendesign-client.js` should expose a narrow surface:

```js
probeOpenDesign(options)
createOpenDesignProject(input)
startOpenDesignRun(input)
getOpenDesignRun(runId)
cancelOpenDesignRun(runId)
getOpenDesignProject(project)
listOpenDesignFiles(project, since)
getOpenDesignArtifact(project, entry, include)
getOpenDesignFile(project, path)
closeOpenDesignClient()
```

Return normalized ce-workflow objects. Keep raw MCP payloads bounded in debug artifacts, not work-item notes.

## ce-workflow integration

### New module: `extensions/work-design.js`

Own:

- state-machine validation;
- design session paths and atomic persistence;
- design brief rendering;
- JSON handoff validation/canonicalization/hash;
- approval records;
- synchronization fingerprints;
- work-item note/document links;
- revision prompt construction;
- plan/finalization gates;
- status rendering for dialogs and text fallback.

### `extensions/work-models.js`

Integrate at existing boundaries:

- `brainstormHandoffPrompt()` — include design commissioning contract.
- `linkBrainstormArtifactFromFinal()` — after linking requirements, initialize eligible design session.
- brainstorm command completion — drive brief confirmation and OpenDesign launch.
- planning state builder — sync and require approved/imported design according to policy; users reach it through `/wo resume` or the bare `/wo` menu.
- planning source discovery — include approved design handoff.
- `planResumeAction()` — route stale/unfinished design sessions before planning/implementation.
- `/wo resume` — continue `existing_ui_audit`, `running`, `clarification_required`, `review_ready`, `changes_requested`, implementation, or proof work.
- `buildWorkFinishState()` — require design-linked browser/accessibility/fidelity proofs for affected UI.
- telemetry — record bounded phase, duration, revisions, fallback reason, and proof result; never prompt/source contents.

Keep orchestration out of `work-models.js` helpers where possible; this file is already large.

### Commands

Keep every user-facing command under the existing `/wo` namespace:

```text
/wo redesign <objective>
/wo design [status|open|sync|revise|approve|skip|cancel] [target]
/wo resume [target]
```

Do not register a separate `/work-design` command.

Ordinary flow:

- `/wo redesign <objective>` creates the durable brownfield redesign initiative, begins the current-UI audit, and advances until user review or an external wait is required.
- `/wo resume` phase-detects and continues audit, OpenDesign work, review, planning, implementation, or verification.

Expert/recovery semantics under `/wo design`:

- `status`: show provider, phase, revision, paths, freshness, and next action.
- `open`: open/show current Preview/Studio URL.
- `sync`: fetch current OpenDesign files and invalidate stale approval.
- `revise`: collect one normal-language feedback message and commission revision.
- `approve`: sync first, then record explicit approval.
- `skip`: require a reason when policy is `required`; otherwise create text-only handoff.
- `cancel`: cancel in-flight run, retain artifacts/history.

Add `redesign` and `design` to `/wo` argument completions and route them through the existing orchestrator handler. The bare `/wo` overlay also exposes **Redesign existing UI** and **Design status/review** rows using the shared dialog system.

### Settings

Add a shared-dialog setting:

```text
Visual design workflow: Auto | Required for UI | Off
OpenDesign executable: Auto | configured path
Design review proof: Standard | Strict
```

Defaults:

- workflow `Auto`;
- executable `Auto`;
- proof `Standard`.

`Auto` uses OpenDesign for substantial UI work when available and text fallback otherwise. `Required for UI` blocks planning until an approved OpenDesign or explicitly waived design exists. `Off` still produces ordinary brainstorm UI requirements.

All selection UI must use `extensions/work-dialogs.js`, include the muted purpose line, preserve parent cursor state, support Escape semantics, and retain non-TUI fallback.

## Dialog UX

When design is ready, present:

**Title:** Review visual direction  
**Purpose:** Approve what implementation will be measured against.

Rows:

- Open Preview/Studio
- Approve current revision
- Request changes
- Sync edits from OpenDesign
- Continue with text-only design
- Cancel design session

The details pane shows:

- direction summary;
- signature element;
- screen count;
- desktop/mobile coverage;
- unresolved questions;
- current revision and freshness;
- handoff/brief hashes abbreviated;
- provider errors or fallback reason.

Approval is disabled while open questions exist, handoff validation fails, or remote changes are unsynchronized.

## Approval contract

`APPROVAL.json`:

```json
{
  "version": 1,
  "ownerId": "wo-...",
  "briefSha256": "...",
  "handoffSha256": "...",
  "remoteFileFingerprint": "...",
  "revision": 3,
  "decision": "approved",
  "approvedBy": "human",
  "approvedAt": "ISO-8601",
  "notes": "optional bounded note"
}
```

Approval is invalid when:

- brief hash changes;
- handoff hash changes;
- relevant OpenDesign files change;
- design session owner/target changes;
- imported file is manually edited;
- a newer revision succeeds.

Reapproval is a single focused decision after showing the delta summary.

## Planning contract

The planning action reached through `/wo resume` or the bare `/wo` menu receives:

- requirements brainstorm path/hash;
- design brief path/hash;
- handoff path/hash;
- approval path/hash;
- every machine acceptance item;
- screen/flow/state/viewport matrix;
- repository constraints (`mustReuse`, `mustNotIntroduce`);
- assets/licensing facts;
- explicit note that OpenDesign prototype code is not production code.

The planner must:

1. map each `DES-*` acceptance ID to one or more implementation units;
2. preserve wording or document an explicit approved deviation;
3. include loading/empty/error/success and mobile/desktop work, not just the happy desktop screen;
4. identify existing components/tokens to reuse after repository inspection;
5. define browser/accessibility proof operations;
6. record the approved handoff hash in plan metadata/frontmatter;
7. fail with a clear stale-design action if hashes no longer match.

Plan materialization copies design acceptance IDs into work-item acceptance/verification metadata so they survive compaction and subagent handoffs.

## Implementation contract

Builder handoff includes:

- approved handoff paths and hashes;
- exact assigned `DES-*` criteria;
- screen/state/viewport scope;
- existing components/tokens to reuse;
- asset and licensing constraints;
- instruction to implement product code, not transplant the OpenDesign prototype blindly;
- instruction to report intentional deviations before continuing if they alter approved behavior or direction.

A builder may choose simpler code than the prototype. It may not silently choose a different user experience.

## Fidelity and verification

### Proof model

Use existing verification contract primitives; no new capability enum is required.

For design-linked UI work, generate requirements such as:

1. `browser` + `interaction` — core flow works.
2. `browser` + `visual` — desktop screenshot/log.
3. `browser` + `visual` — mobile screenshot/log.
4. `browser` + `accessibility` — keyboard/focus/labels/reduced-motion checks.
5. `inspection` or `manual` + `approval` only when strict project policy requires a final human visual sign-off.

Artifacts use current screenshot/log hashing through `verificationProofRecord()` and `work-capability-adapters.js`.

### Fidelity matrix

Generate a bounded matrix from the handoff:

| Acceptance | Screen | State | Desktop | Mobile | Interaction | A11y |
|---|---|---|---|---|---|---|
| DES-001 | checkout | default | required | required | required | required |
| DES-002 | checkout | error | required | required | recovery | announcement |

The finish gate reports missing matrix cells and the exact `/wo resume` action that can produce evidence.

### Visual comparison strategy

Default to semantic visual inspection, not raw pixel equality:

- hierarchy and signature element;
- palette/type/token adherence;
- required regions and content;
- responsive reflow;
- visible states;
- no clipping/overlap;
- focus visibility and reduced motion.

Pixel diff is optional because browser/font/platform variance makes it noisy. Add it later only if telemetry shows reviewers repeatedly miss regressions and stable baselines exist.

### Design changes during implementation

If implementation discovers a necessary product/design change:

1. stop the affected unit;
2. record proposed deviation and reason;
3. update/revise the design handoff through the design lifecycle;
4. reapprove;
5. refresh affected plan criteria only;
6. continue.

Do not mutate the handoff quietly to match whatever was built.

## Failure and fallback behavior

| Failure | Behavior |
|---|---|
| `od` missing | `Auto`: text fallback; `Required`: blocker with install/configure/waive actions. |
| Daemon unreachable | Keep brief/session; show how to start OpenDesign; retry reads safely. |
| No OpenDesign agents/models | Show provider message; let user configure OD or use text fallback. |
| `start_run` response lost | Do not replay with a new ID; retry using exact requestId/payload only after ambiguity is resolved. |
| Run takes long | Persist run ID, return control, resume/poll on wake or `/wo resume`; support cancel. |
| Run asks a question | Surface only the unresolved question; answer automatically from settled brief where possible. |
| Run fails | Preserve project/run/error and offer retry, revise brief, or fallback. |
| Preview exists, handoff invalid | Automatic one-pass repair; never ask user to write JSON. |
| User edits in OpenDesign | Sync at approval/plan/resume boundaries; invalidate stale approval. |
| User rejects direction | Normalize feedback, revise preflight, rerun same project. |
| User rejects OpenDesign | Create text-only handoff and continue unless policy requires OD. |
| OpenDesign output includes code/instructions | Keep in sandbox/project; import only validated facts and approved bounded assets. |
| OpenDesign URL is remote/non-loopback | Display/open only under user action; do not send secrets or fetch arbitrary URLs through ce-workflow. |

## Security and privacy

- Treat MCP/daemon responses as untrusted external input.
- Confine every imported path under the target repo design directory.
- Reject absolute paths, traversal, symlinks, devices, reserved Windows names, and oversized files.
- Permit Markdown, JSON, and explicitly allowed image formats only.
- Never execute OpenDesign-generated HTML, JS, shell, package manifests, or commands in the product repository.
- Use OpenDesign's sandboxed preview for visual review.
- Do not forward `.env`, credentials, tokens, unrelated source, customer data, or telemetry logs in the brief.
- Record no model/API credentials in design session state or telemetry.
- Keep MCP stderr bounded and scrub likely secrets before persistence.
- Use explicit confirmation for cancel/delete actions; never call `delete_project` automatically.
- Respect OpenDesign's local configuration: local-first does not guarantee a local model. The UI should state that the selected OpenDesign runtime may contact its configured provider.

## Telemetry

Record only bounded operational signals:

- eligibility classification;
- policy;
- provider available/unavailable reason;
- time to first preview;
- revision count;
- clarification count;
- fallback chosen;
- handoff repair count/result;
- sync/stale approval count;
- approval duration;
- plan criteria count;
- fidelity proof pass/fail/missing counts;
- cancellation/failure category.

Do not record briefs, prompts, user feedback, source, generated HTML, URLs containing tokens, or design content.

Use telemetry to decide whether to keep:

- automatic OpenDesign launch;
- one-pass handoff repair;
- strict final approval;
- pixel-diff experimentation;
- revision limits or timeouts.

## Files to add/change

### Add

- `extensions/opendesign-client.js`
  - executable discovery and stdio MCP client.
- `extensions/work-design.js`
  - lifecycle, contract, state, import, approval, synchronization, and gates.
- `scripts/test-opendesign-client.mjs`
  - deterministic fake MCP process tests.
- `scripts/test-work-design.mjs`
  - lifecycle/contract/approval/stale-state tests.
- `scripts/fixtures/opendesign/fake-od.mjs`
  - scripted `od mcp` fixture, no real provider cost.
- `scripts/fixtures/opendesign/handoff-valid.json`
- `scripts/fixtures/opendesign/handoff-invalid.json`

### Change

- `extensions/work-models.js`
  - brainstorm/design/resume/plan/finish integration and command registration.
- `extensions/work-dialogs.js`
  - design review/settings overlays if existing generic primitives are insufficient; prefer reuse.
- `extensions/work-store.js`
  - only if existing notes/document links cannot preserve design links; otherwise leave unchanged.
- `extensions/work-verification-contract.js`
  - likely no schema change; only add inference/mapping if design acceptance needs it.
- `scripts/test-work-brainstorm.mjs`
- plan/resume/finish test files that cover new gates.
- `scripts/verify-package.mjs`
  - include new focused selfchecks if it uses an explicit roster.
- `README.md`
  - document optional OpenDesign integration, policy, command, and fallback.
- package/source inventory files if the repository's packaging verification requires explicit inclusion.

## Implementation slices

### Slice 1 — contracts and pure state

- Add design-session schema and transition validation.
- Add brief renderer.
- Add handoff JSON validator/canonical hash.
- Add approval/staleness logic.
- Add pure tests.

Exit: no process or UI integration; all lifecycle rules deterministic.

### Slice 2 — OpenDesign MCP adapter

- PATH/config discovery.
- stdio MCP initialization, tool discovery, calls, timeouts, cancellation, cleanup.
- normalized tool wrappers.
- fake-MCP tests for Windows/POSIX command resolution, malformed output, response loss, read retry, and mutation ambiguity.

Exit: adapter can create fixture project, start fixture run, poll, and fetch fixture handoff without OpenDesign installed.

### Slice 3 — brownfield audit and brainstorm commissioning

- `/wo redesign <objective>` routing and durable parent initiative.
- existing-app command discovery through declared repository commands.
- browser/source current-UI audit and baseline screenshots.
- preserve/reconsider/remove classification.
- `CURRENT-UI-AUDIT.{md,json}` rendering and validation.
- UI eligibility and frontend-design preflight.
- write `DESIGN-BRIEF.md`.
- create/reuse OD project.
- start/persist/poll run.
- preview-ready and clarification states.
- text fallback.

Exit: substantial UI brainstorm reaches a resumable preview or deterministic fallback.

### Slice 4 — dialog and feedback loop

- shared design review overlay.
- open/show Studio.
- normal-language revision normalization.
- same-project reruns.
- explicit approve/skip/cancel.

Exit: user can iterate without knowing OD schemas.

### Slice 5 — sync/import/approval

- file fingerprinting and manual-edit sync.
- handoff fetch/validation/one-pass repair.
- repo artifact import.
- approval hash and stale invalidation.
- work-item links.

Exit: approved design is durable, reviewable, and tamper/staleness evident.

### Slice 6 — plan and execution propagation

- planning source discovery.
- acceptance-ID materialization.
- approved hash in plan/work-item state.
- builder handoff and resume routing.
- plan invalidation on handoff changes.

Exit: every implementation unit can trace to approved design criteria.

### Slice 7 — fidelity verification and finish gate

- generate browser/visual/mobile/accessibility requirements.
- fidelity matrix status.
- finish blocker/action rendering.
- optional strict final human approval.

Exit: UI work cannot finish with missing required design proofs.

### Slice 8 — docs, telemetry, end-to-end hardening

- operational telemetry.
- README/settings docs.
- package verify integration.
- disposable-project e2e with fake MCP and browser fixture.
- cancellation, restart, compaction, and interrupted-session recovery.

Exit: full lifecycle survives restart and repository verification.

## Tests

### Pure contract tests

- valid v1 handoff accepted;
- required field missing;
- duplicate IDs;
- invalid enums/colors/viewports;
- oversized arrays/strings;
- traversal/absolute/symlink paths;
- brief hash mismatch;
- canonical hash stable under key ordering;
- open questions block approval;
- modified handoff invalidates approval;
- transition table rejects illegal transitions.

### MCP adapter tests

- executable absent;
- daemon unreachable;
- initialize/tools list success;
- missing required tool;
- create/start/poll/fetch happy path;
- queued/running/succeeded sequence;
- failed/canceled sequence;
- clarifying `agentMessage` with no preview;
- stderr noise does not corrupt protocol;
- oversized/malformed response;
- timeout and child cleanup;
- safe read retry;
- no implicit mutation retry;
- stable `requestId` reuse;
- Windows wrapper resolution.

### Workflow tests

- non-UI skip;
- `/wo redesign` creates a resumable parent initiative, not a premature implementation item;
- existing Belot-like app audit inventories gameplay screens/states and preserve/replace constraints;
- `/wo resume` continues each redesign phase without requiring an ID in the common path;
- approved handoff materializes one or more implementation work items;
- UI-light text brief;
- UI-design OpenDesign auto path;
- required policy blocker;
- user feedback becomes normalized revision prompt;
- OD rejection falls back without schema burden;
- invalid handoff auto-repairs once;
- manual OD edit syncs and invalidates approval;
- approval writes exact hashes;
- plan sees design sources and acceptance IDs;
- stale design blocks plan/resume;
- builder receives only assigned criteria;
- desktop/mobile/accessibility proof matrix;
- finish blocked on missing proof;
- cancellation/resume after restart;
- compaction retains paths, IDs, state, and next action.

### Real smoke tests

Optional/manual, never in default CI:

- installed OpenDesign + local daemon;
- create a small project;
- run a no-cost/mock agent if available;
- open preview;
- edit in Studio;
- sync;
- approve;
- generate a plan;
- execute browser fixture proofs.

## Verification commands

Run focused checks after each slice, for example:

```bash
node scripts/test-work-design.mjs
node scripts/test-opendesign-client.mjs
node scripts/test-work-brainstorm.mjs
node scripts/test-work-plan-open-questions.mjs
node scripts/test-work-verification-contract.mjs
node scripts/test-work-browser-adapter.mjs
```

Before completion:

```bash
npm run verify:quiet
```

Also run LSP diagnostics on every edited JavaScript module before the package check, then `lens_diagnostics mode=all` to ensure no blocking edited-file diagnostics remain.

## Acceptance criteria

### User experience

1. The user never writes an OpenDesign prompt schema or handoff JSON.
2. `/wo redesign <objective>` starts an existing-UI redesign and `/wo resume` continues it end to end.
3. The redesign begins with a browser/source audit and explicit preserve/reconsider/remove decisions.
4. A substantial UI brainstorm automatically reaches visual review when OD is available.
5. The user can approve, request changes, sync manual edits, decline OD, or cancel.
6. Every question is focused and only asks for judgment/facts that automation cannot infer.
7. Interrupted design sessions resume from exact project/run/revision state.
8. Implementation work items are created only after approval supplies stable acceptance criteria.
9. Missing OD has a clear fallback and does not corrupt the brainstorm.

### Data integrity

1. Brief, handoff, and approval are versioned and hashed.
2. Approval is impossible with unresolved questions or invalid/stale handoff.
3. Remote/manual changes invalidate approval before planning.
4. Imported paths and content are confined, bounded, validated, and non-executable.
5. Mutating MCP calls are not blindly replayed after ambiguous failure.

### Planning and implementation

1. Every design acceptance ID maps to implementation and proof.
2. Plans record the approved handoff hash.
3. Builders receive only relevant design scope plus shared constraints.
4. Prototype code is never silently promoted to production.
5. Design deviations require explicit lifecycle update and reapproval.

### Verification

1. Required desktop/mobile screens and states have browser visual evidence.
2. Required interactions have runnable browser evidence.
3. Accessibility expectations have explicit proof.
4. The finish gate reports missing fidelity cells and concrete `/wo resume` recovery actions.
5. Existing non-UI workflows remain unchanged.

## Rollout strategy

### Stage A — hidden/experimental

- setting available only through project config;
- fake MCP and manual local testing;
- collect failure categories, not content.

### Stage B — opt-in

- expose in Work settings as `Off | Auto`;
- no required policy yet;
- evaluate preview success, revision count, fallback, stale approval, and proof burden.

### Stage C — default auto

- enable `Auto` by default when reliability is demonstrated;
- keep instant text fallback;
- display first-use explanation that OpenDesign may use its configured model provider.

### Stage D — required policy

- expose `Required for UI` for teams that want design governance;
- require explicit waiver reason and record it;
- do not make required the global default.

## Decisions intentionally deferred

- Pixel-perfect image diff service.
- Real-time OpenDesign event subscription/file watching.
- Automatic OpenDesign installation/update.
- Cloud project provisioning or credentials.
- Provider abstraction beyond OpenDesign until a second real provider exists.
- Importing generated React/Vue/etc. into production.
- Multi-designer concurrent approval workflow.
- Organization policy server.
- Figma round-trip integration.

Add any of these only after usage proves the simpler lifecycle insufficient.

## Licensing and attribution

- Integrate OpenDesign through its Apache-2.0 public MCP/CLI surface; do not vendor its code unless separately reviewed.
- Adapt visual preflight principles from the Apache-2.0 `anthropics/skills/skills/frontend-design` source and preserve required notices for copied language.
- Do not copy from the generally commercial-terms `anthropics/claude-code` repository path.
- Preserve asset-level licenses in `DESIGN-HANDOFF.json`; assets with unknown or incompatible rights are reference-only and must have a production fallback.

## Definition of done

The full implementation is complete when `/wo redesign <objective>` can audit an existing interface, create a durable resumable redesign initiative, autonomously commission, revise, synchronize, validate, import, and pin a human-approved OpenDesign design, materialize correctly sliced implementation work items only after approval, carry every approved requirement into execution, and prevent UI completion without the required interaction, visual, responsive, and accessibility evidence—while remaining safe and useful on machines where OpenDesign is absent.
