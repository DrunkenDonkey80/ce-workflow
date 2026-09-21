# Slim CE: remove compulsory reasoning stages, keep useful independent feedback

Date: 2026-09-21

Status: execution proposal; no runtime changes or live experiments performed for this plan

Repository: `C:/SOFT/git/ce-workflow` — inspected on `master`, HEAD `ece29c9` with pre-existing dirty work

## Decision

Keep CE as a thin execution and evidence layer. Delete compulsory slice planning and its fallback CE-plan generation. Make simplicity part of implementation, not a second mandatory workflow. Keep GLM/Opus feedback where it improves decisions and catches defects; reduce the main developer's coordination and triage burden instead of optimizing away inexpensive reviewers.

**Explicit user decision:** GLM/Opus review of a finished brainstorm or master plan waits at the artifact handoff, before the next phase starts. Not a pre-draft committee, not a per-slice review loop.

The recommendations below are implementation scope, not a claim that performance or quality improvements have already been measured. The earlier settings-only candidate disabled reviews and background verifiers; that is NOT this proposal.

## Target flow

```text
Explicit brainstorm → draft → parallel GLM/Opus artifact review → resolve blockers
Explicit master plan → draft → parallel GLM/Opus artifact review → resolve blockers

Ready implementation unit → read its requirements → implement + simplify locally
                          → focused verification → existing finish/proof boundary
                          → background code verification + bounded finding triage

Explicit catch-up → inspect upstream changes → decide/implement/verify → update baseline
```

Routine work does not gain a mandatory brainstorm or master plan. Existing roadmap execution keeps its already-approved master plan, acceptance contract, durable progress and recovery. Missing material requirements still require a decision; the alternative to ceremony is not guessing.

## What is actually being removed

| Area | Decision | Replacement or retained value |
| --- | --- | --- |
| Mandatory slice planning | **Delete**, not a setting default | Execute the matching master-plan unit and task acceptance directly. |
| CE plan generation for “messy” slices | **Delete the slice dispatch path** | Investigate concrete ambiguity in context; ask a material question or stop on a real blocker. Explicit master planning remains available. |
| Slice-plan advisor gate | **Delete** | Completed brainstorm/master-plan review and code feedback remain. |
| Slice-plan successor prefetch | **Delete that producer/consumer**, not the shared lane infrastructure | No speculative replacement prefetch system in this change. |
| Pre-brainstorm advisor committee | **Delete the automatic stage** | Review the completed artifact once; user-requested exploration is still possible. |
| Separate mandatory simplification workflow | **Recommend deletion after the bounded experiment below** | One implementation instruction plus actionable simplification findings in background review. |
| Internal self-improvement during ordinary work | **Disable automatic activation/injection** | Keep passive local evidence and an explicit catch-up command. |
| GLM/Opus background code verification | **Keep** | Scoped, checkpoint-bound independent findings; no main-model clone by default. |
| GLM/Opus brainstorm/master-plan review | **Keep at artifact handoff** | Parallel review, compact actionable findings, no repeated full committee for editorial changes. |
| Verification, dirty-file protection, authorization, recovery | **Keep** | These are correctness infrastructure, not planning ceremony. |

Do not replace deleted stages with a new “light planner,” tiny plan schema, obligatory scratch-plan note, or simplify certificate. That would rename the same cost.

## Evidence and important distinctions

- In `C:/SOFT/git/ce-workflow/extensions/work-models.ts`, the slice-planning machinery includes `slicePlanAdvisorGateState`, slice-plan requirements/handoffs, `planReference`, and implementation routing. The “messy” branch uses task text longer than 4,000 characters or more than 12 executable slices. Those thresholds do not establish uncertainty.
- `configuredPrefetchAdvisorChallenge` and `prefetchRoleTask` also produce a `slicePlan` and preserve a future advisor challenge. Removing only the visible planner launch would leave this indirect source of plans alive.
- `brainstormHandoffPrompt` assembles pre-draft and post-draft advisors. `buildWorkPlanLikeState` assembles master-plan reviews on both generation and existing-plan intake. The new handoff needs to avoid reviewing the same unchanged artifact twice.
- `scheduleCommittedRunVerifiers` excludes `docs/plans/`. Background code verification is not a substitute for artifact review. Keep the existing advisor route for document review rather than forcing every review into a new universal engine.
- `C:/SOFT/git/ce-workflow/extensions/background-verifiers.js` already supports correctness, security, simplification, maintainability, test-gap and performance operations. Reuse those operations; no new simplicity service is needed.
- `runnableBackgroundVerifierProfiles` can resolve an inherited profile to the current model. That can accidentally spend the main developer's quota. Explicit GLM/Opus selection matters more than switching all verifiers off.
- `buildWorkCatchUpState` currently refuses to run when `selfImproving` is false. The menu describes project-history catch-up, but the implementation primarily reviews monitored package releases and verified private-workflow updates. Decouple the command and correct the label; do not pretend it already implements historical session mining.
- Private workflows are generated and integrity-checked. Changing only `C:/SOFT/git/ce-workflow/extensions/private-workflows/simplify.md` or `plan.md` is not a durable change: generation and catch-up can restore old behavior.
- The earlier comparison report, `C:/SOFT/git/ce-workflow/docs/research/2026-09-19-ce-workflow-comparison.md`, records two infrastructure-invalid attempts and no completed CE/thin/direct comparison. Its large wasted usage is evidence of startup fragility, not proof of inferior code quality. Do not use it as an accepted performance baseline.

## R1 — Delete slice planning end to end

Remove the requirement, action selection, CE slice-plan dispatch, slice advisor gate, success markers as prerequisites, settings UI, effort-profile overrides, and planner-only successor prefetch. Trace callers in regular resume, goal-owned execution, helper handoffs and recovery; changing one prompt is insufficient.

Delete the obsolete `slicePlanBeforeWork` and `advisorUsageForSlicePlans` control paths rather than leaving hidden opt-ins. Old configuration keys must not reactivate them, even through inherited global settings or a high-effort profile. Ignore deprecated keys without rewriting unrelated user settings.

Keep genuine roadmap/backlog planning and explicit master-plan generation. A task being long, or having many siblings, is not a reason to send an already-defined unit through another planning agent.

**Compatibility:** preserve existing slice-plan notes and referenced documents as historical/contextual input. Some contain requirements not duplicated elsewhere. Read them when present; never require new notes or fabricate “planned” evidence. Old in-flight prefetch results cannot be promoted as fresh implementation authority. Close out/reconcile their runtime records without changing user source or deleting evidence.

Acceptance:

1. Ready units without `wo:slice-planned` route directly to implementation in regular and goal-owned execution.
2. A long description and a roadmap with more than 12 units do not trigger CE slice planning.
3. Explicit master planning and genuine missing-requirement blockers still work.
4. Old flags, profiles, notes and resumed state cannot resurrect a mandatory slice-planning stage.
5. Existing acceptance/design/verification requirements and finite-backlog scope are preserved.

## R2 — Keep independent review, stop making the developer run a committee

Use the existing configured advisor slots for two explicit reviewers: a runnable GLM model and a runnable Opus model. Resolve exact installed IDs during execution; do not silently substitute Astra/the current developer model when one is unavailable. Existing users' explicit model choices are not silently overwritten.

For completed brainstorms and master plans:

- Launch the two read-only reviews in parallel through native pi-subagents, with the artifact and relevant source requirements. Source facts, constraints and alternatives matter; formatting preferences alone do not.
- Wait before advancing to the next phase, as the user selected. This applies to artifact intake as well as newly generated artifacts.
- Reuse durable evidence mechanisms to bind review to the artifact revision and relevant source revision. Same unchanged artifact at the next command is not another full review. A changed requirement invalidates affected coverage.
- Return findings with location/requirement, concrete consequence, evidence and smallest proposed correction. Keep full reports on disk. Show the main developer compact actionable findings and coverage failures, not both transcripts and repeated summaries.
- Fix material omissions, contradictions, infeasible assumptions and genuine safety/compatibility issues. Record non-blocking suggestions without turning them into new slices.
- Re-review only affected material fixes, preferably with the reviewer who raised the issue. No blanket full-committee loop after every wording change. A remaining blocker stops the handoff; it does not trigger endless automatic redrafting.
- Failed/unavailable reviewers are missing coverage, not approval. Preserve partial results and offer an explicit retry or user waiver rather than quietly proceeding.

For background code verification:

- Retain checkpoint-bound read tools, confinement, immutable evidence, failed-operation handling, stale-finding checks and existing completion obligations. Do not give checkpoint reviewers live Lens state as if it represented their snapshot.
- Keep useful operations across GLM/Opus, including simplification and maintainability. Do not remove overlap merely because it looks redundant: measure distinct accepted findings first.
- Use existing grouping/disposition machinery. Preserve all substantive findings; compact presentation must not silently truncate them. Validate findings against current code before applying fixes.
- Do not automatically create and execute improvement roadmaps from style suggestions. Existing explicit analysis remains a user action.
- This pass does not redesign verifier ownership, completion gates, or the entire analysis subsystem. If a cheap synthesis pass later shows measured value, consider it separately; do not add one speculatively.

## R3 — Remove the simplification ritual, retain the quality signal

Use this implementation instruction:

> Reuse existing code; make the smallest complete change. Before finishing, remove avoidable duplication or abstractions introduced by this change, without weakening validation or changing behavior. Run the relevant checks.

That belongs in the implementation contract. It does not require a second model call, a report, a label, or an obligatory edit when the code is already simple. Background reviewers can still flag a concrete removable abstraction, unnecessary dependency, duplicate policy or speculative generalization.

### Completed GLM ablation

The bounded experiment is recorded in `C:/SOFT/git/ce-workflow/docs/research/2026-09-21-simplification-ablation.md` with raw evidence under `C:/SOFT/git/ce-workflow/.pi/simplification-ablation-2026-09-21/`.

- Eight of eight implementations passed immutable baseline checks, their regression checks and held-out acceptance: A 4/4 and B 4/4.
- Two of four separate passes made small local cleanups; two correctly returned NOOP. No pass found a correctness, security, compatibility or test defect.
- Final production-file size was mixed across arms rather than consistently better with the separate pass.
- The four extra passes consumed 90,835 GLM tokens, 25 turns and 45 tool calls. This was not main-developer-model usage, but it added latency and orchestration.
- The generic mutation-worker guard marked both verified NOOPs as failures because no edit occurred. Simplification feedback must never require churn to count as success.

This small GLM-only ablation does not prove end-to-end workflow savings or Astra/Sol equivalence. It is sufficient for the narrower product decision: the signal has value, but a mandatory blocking stage does not.

Remove `simplifyBeforeReview`, finish-gate prerequisites and stage handoffs together. Retain the verifier's `simplification` operation and allow verified NOOP findings. Remove the private simplify workflow only when no intentional on-demand caller remains; update its generator/source inventory/manifest, parity checks, owned outputs and catch-up/rollback expectations consistently. A verified upstream refresh must not resurrect the deleted stage.

## R4 — No internal self-improvement during development; explicit catch-up stays

Default/normal development must not inject a self-improvement appendix, expose the improvement-report tool as an obligation, start maintenance/scouting/monitoring, or generate source-repo improvement work. Existing logs, telemetry and previously recorded reports remain available locally; disabling behavior is not deleting history.

Treat this as an execution-mode boundary, not just setting `selfImproving: false` in this repository. Trace the reporting registration/guards, goal/worker prompt appendices, session/turn hooks, menu visibility, inherited defaults and resume paths. Existing `selfImprovingDefault: true` must not silently re-enable the old behavior for ordinary work.

Keep explicit maintenance commands only as explicit user actions. Do not resume the already-paused catch-up goal as part of installing this change. Any legacy active maintenance state must be shown and deliberately resumed/stopped, not silently launched or discarded.

The existing catch-up command must work with internal reporting disabled:

1. Remove its dependency on `workResume.selfImproving`; command invocation supplies the explicit maintenance intent.
2. Keep package/release evidence, project-grounded verdicts, verified private-source promotion, baseline integrity, rollback and completion checks.
3. Do not append the automatic reporting/workflow overlay to the catch-up objective. Do not broaden its current authority over unrelated projects or package installation.
4. Correct the menu/help to say upstream/package capability catch-up. Reviewing historical local workflow friction can remain an explicit, separately scoped improve request; do not build a session-mining system under this change.
5. Update this repository's `C:/SOFT/git/ce-workflow/AGENTS.md` feedback/continuous-improvement instructions so they no longer demand incidental maintenance during every development task. Keep the code-first preference and optimization regression rule. Do not edit the user's global instructions.

Acceptance: start/resume ordinary work with legacy self-improvement flags enabled and observe no automatic maintenance/reporting prompt or launch. Invoke catch-up explicitly with reporting off and verify discovery can run and its evidence/completion gates still apply. No network/provider call belongs in an offline regression test; use existing stubs.

## R5 — Shorter prompts through deletion, not loss of requirements

After removing stages, trim their repeated instructions from the planner/worker/orchestrator surfaces. Keep one authoritative statement of scope, acceptance, edit ownership, verification and approval boundaries. Do not duplicate entire role manuals inside generated handoffs.

Priority paths:

- `C:/SOFT/git/ce-workflow/extensions/work-models.ts`
- `C:/SOFT/git/ce-workflow/agents/work-planner.md`
- `C:/SOFT/git/ce-workflow/agents/work-worker.md`
- `C:/SOFT/git/ce-workflow/agents/work-prefetch.md`
- `C:/SOFT/git/ce-workflow/skills/work-orchestrator/SKILL.md`
- `C:/SOFT/git/ce-workflow/scripts/work-helper.mjs`
- `C:/SOFT/git/ce-workflow/README.md`

Preserve upstream private-workflow integrity through `C:/SOFT/git/ce-workflow/scripts/generate-work-private-workflows.mjs`, `C:/SOFT/git/ce-workflow/extensions/work-private-workflows.js`, `C:/SOFT/git/ce-workflow/extensions/work-compound-inventory.json`, and `C:/SOFT/git/ce-workflow/extensions/work-compound-catch-up.js`; do not hand-edit generated prompts and leave stale hashes.

No large module split in this pass. The 33k-line orchestration file is a maintainability warning, but moving it into ten files would not remove any workflow. Delete obsolete branches first; extract code later only for a demonstrated reason.

## Execution order and focused checks

Before edits, capture the dirty manifest and establish the relevant existing checks' baseline. Preserve pre-existing changes, especially in the helper/tests. Work on `master`; no branch switch, bulk staging, push or work-item creation is implied by this plan.

| Unit | Scope and exit condition | Existing focused checks to update/run |
| --- | --- | --- |
| 0 | Freeze baseline source/settings/model identities and effective handoff text. Distinguish existing failures from introduced ones. | Relevant checks below, once before their unit. |
| 1 | Delete slice planning, slice advisors, CE slice dispatch and planner-only prefetch; preserve old requirement references. | `C:/SOFT/git/ce-workflow/scripts/test-work-resume.mjs`; `C:/SOFT/git/ce-workflow/scripts/test-work-goal-owned-slices.mjs`; `C:/SOFT/git/ce-workflow/scripts/test-work-helper-handoffs.mjs`; `C:/SOFT/git/ce-workflow/scripts/test-work-prefetch.mjs`; `C:/SOFT/git/ce-workflow/scripts/test-work-settings.mjs` |
| 2 | One completed-artifact GLM/Opus review; remove pre-draft committee; compact findings and retain code verifiers. | `C:/SOFT/git/ce-workflow/scripts/test-work-brainstorm.mjs`; `C:/SOFT/git/ce-workflow/scripts/test-work-plan-open-questions.mjs`; `C:/SOFT/git/ce-workflow/scripts/test-work-background-verifier-flow.mjs`; `C:/SOFT/git/ce-workflow/scripts/test-background-verifiers.mjs` |
| 3 | Run the small simplification ablation; record its decision; remove mandatory simplify stage and its dead private resource if justified. | `C:/SOFT/git/ce-workflow/scripts/test-work-quality-policy.mjs`; `C:/SOFT/git/ce-workflow/scripts/test-work-start-finish.mjs`; `C:/SOFT/git/ce-workflow/scripts/test-work-private-workflows.mjs` |
| 4 | Disable incidental self-improvement; decouple explicit catch-up and correct help/rules. | `C:/SOFT/git/ce-workflow/scripts/test-work-improvement-reporting.mjs`; `C:/SOFT/git/ce-workflow/scripts/test-work-goal.mjs`; `C:/SOFT/git/ce-workflow/scripts/test-work-settings.mjs`; `C:/SOFT/git/ce-workflow/scripts/test-work-private-workflows.mjs` |
| 5 | Remove dead prompt/settings/documentation references; verify combined behavior and run the adoption comparison. | `C:/SOFT/git/ce-workflow/scripts/test-work-multi-slice-continuity.mjs`; `C:/SOFT/git/ce-workflow/scripts/test-work-helper-contract.mjs`; then `npm run verify:quiet` from `C:/SOFT/git/ce-workflow` |

The listed scripts already exist and run with `node <absolute-script-path>`. Extend established tests, not a new framework. If an entire feature disappears, replace its positive-stage tests with a small retirement/compatibility regression; do not leave tests requiring the deleted stage. Add targeted checks for changed-artifact invalidation, duplicate review avoidance, failed reviewer coverage and legacy flags. Run LSP checks on changed source before the broad verification command; inspect session diagnostics before declaring completion.

## Measurement and adoption gate

**Primary objective:** reduce main-developer model usage, including prompt reads, orchestration turns, repeated planning, review synthesis, retries and repairs. Do not count only generated tokens or only the first implementation session.

Report two ledgers:

1. Main developer/root/continuations and any main-model child usage.
2. GLM/Opus reviewers, other helpers and evaluation overhead, separately identified.

Also retain combined provider tokens, catalog-cost estimate with provenance, wall time, turns and tool calls. Subscription-backed reviewers may be practically free to the user; that does not make their usage zero or justify hiding latency/rework. The repository's overall-regression rule remains in force.

For adoption, rerun the same six end-to-end cases and acceptance from `C:/SOFT/git/ce-workflow/docs/plans/2026-09-19-001-ce-workflow-thin-vs-direct-comparison-plan.md`, with authentic current and candidate CE behavior, all children/continuations/triage counted, and repeated alternating trials. The failed September 19 pilot is not the accepted baseline: establish a valid frozen current-behavior run before comparing. Reuse prepared fixtures after validating them; do not spend another large campaign rebuilding the harness.

The previous experiment was explicitly stopped. A future execution needs renewed live-run authorization and its supported native orchestration entry point; do not bypass direct-request guards or switch to a CLI/SDK launcher. If the faithful benchmark is unavailable, report that blocker and do not claim a verified optimization from prompt counts or the GLM ablation.

Adoption requires preserved functional/requirement/security outcomes and no material overall regression. Report main-model savings prominently, but revert a candidate that materially worsens overall results rather than explaining away the loss with one improved metric. Freeze materiality thresholds before live trials; do not choose them after seeing results. Fewer stages, fewer lines and focused tests are structural evidence, not measured workflow savings.

## Not in this change

- No removal of master plans, explicit brainstorms, debugging, design authority, relevant browser/hardware evidence, or proof-of-completion gates.
- No removal of all reviewers, forced weakening of the Open Question Gate, or automatic acceptance of unresolved material questions.
- No new provider router, review framework, configurable miniature workflow language, telemetry dashboard or historical-session mining system.
- No blanket redesign of ideation quotas, learning/knowledge retrieval, UI workflows or large-file architecture. Those are separate candidates after this deletion pass, not prerequisites.
- No implementation, model trial, settings change, commit, push, goal resume or work-item mutation is authorized merely by writing this document.

## Done means

- Deleted stages cannot be reached through settings, inherited profiles, alternate execution paths, old labels, regeneration or catch-up.
- Ready work starts implementing against preserved requirements rather than producing a second plan.
- Completed brainstorms/master plans retain the approved GLM/Opus handoff review; useful background code verification remains intact.
- Ordinary work has no incidental maintenance loop; explicit catch-up works independently.
- Simplification has a recorded experiment decision, with correctness and maintainability evidence rather than LOC alone.
- Existing tests pass or pre-existing failures are explicitly separated; performance claims have the full end-to-end evidence above.
