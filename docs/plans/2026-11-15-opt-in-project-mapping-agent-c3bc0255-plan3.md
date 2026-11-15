---
plan3: true
status: ready
created: 2026-11-15
updated: 2026-11-15T21:41:20.424Z
reviewed: 2026-11-15
started: 2026-11-15T21:13:02.675Z
---

# Opt-in project mapping agent

## Original request

> okay lets put that into practice, lets have into settings a mapping agent that when set to something uses that agent to create map of the project and keep it updated and standing instructions for the main agent to use that map, only if we have an agnet to keep it up, think about all cases and how to get it done correctly and all edge cases etc

Earlier motivation: agents should care about project-wide ownership, find existing capabilities, consolidate or extend matching responsibilities rather than write parallel implementations. User proposed a cheap mapper with the main agent retaining design authority. The user now requests an opt-in product feature following the exploratory pilot, not another experiment alone.

## Goal, requirements, and non-goals

- Add a Mapping agent setting to existing settings surfaces; selecting a model enables maintenance, None disables it. Respect established global and project overrides and model-picker behavior.
- Produce and incrementally maintain a useful project ownership map, with source references, freshness and explicit unknowns. Main agent consults relevant sections and verifies source before new implementation paths, only when a mapping agent is configured and a usable map exists.
- Main agent owns decisions; the mapper is not an adviser, code reviewer or source writer. No invented decisions inferred from implementation. Observations and explicit approved requirements remain distinct.
- Handle multiple sessions, uncommitted changes, external edits, source drift during a run, settings changes, restarts, failures, missing models, branches and worktrees without publishing misleading freshness or reviving an idle conversation.
- Bound resource use and make progress/failure visible without forcing a foreground model turn. No repeated full scans or whole-map injection into every request.
- Reuse existing settings, native subagent lifecycle, source intelligence and locking mechanisms where they fit. No external agent CLI, new symbol database, or unrelated refactor.
- Default disabled is an agent recommendation consistent with opt-in intent; do not select Terra automatically or change user settings merely by installing this feature.
- No push requested. Preserve unrelated untracked `C:/SOFT/git/ce-workflow/NUL`.

## Decisions

### User decisions

- Implement a mapping-agent setting, map creation and upkeep, and conditional standing instructions. Source: current request.
- Prefer project-wide reusable solutions over duplicated code; main agent decides how to act on map evidence. Source: earlier discussion and current request.

### Evidence, not product promises

- Pilot: `C:/Users/Flex/AppData/Local/Temp/project-map-only-87ZFuy/REPORT.md`. All frozen checkpoints passed; post-hoc symmetric checks found two defects only in the unmapped candidate. One pair does not prove causation or scaling.
- Mapper creation plus three updates cost approximately $0.14; mapped total resource use increased. No optimization baseline was accepted. User now requests an opt-in capability; do not describe it as a measured optimization or enable by default.
- Maps were 538–767 words; the first two makers read them whole, the third used targeted retrieval. Whole-project selective navigation remains untested.
- Mapper source-intelligence tools were unavailable in the pilot, requiring narrow search. Production must report unavailable coverage rather than establish absence from an incomplete graph.

### Proposed implementation boundaries

- Keep generated data outside AGENTS.md and the product architecture diagram; do not overwrite human-authored design or diagram edits.
- No standing promise of a current map when missing, disabled, failed or stale. Source always wins over generated claims.
- Read-only child returns a candidate result; parent validates and atomically publishes it. Shared state decisions must be based on the state read under the lock.
- Source mutation is not needed to maintain a map. Avoid the completion-guard problem seen when nominally read-only background work used mutation-enabled child profiles.
### Confirmed product choices (ask_user)

- Q-01: User selected **Local, untracked data**. Persist maps across sessions, isolate each checkout, do not commit generated maps or modify human-authored documentation. This resolves storage policy; exact local cache path remains an implementation detail.
- Q-02: User selected **Wait for the initial map**. The initial enabled-project coding task waits for a usable map, with a visible failure/cancellation escape; subsequent refreshes run in the background. Do not implement a silent nonblocking first run.
- Usable must not be represented as exhaustive: initial coverage, ignored scopes and uninspected areas must be explicit, especially for large projects. This is an agent-proposed correctness requirement, not approval to truncate silently.
### Proposed production contract to implement and verify

1. **Configuration:** `Mapping agent: None | explicit model`, with effort and normal global/project inheritance. No implicit current-model fallback. Selecting a mapper authorizes source analysis by that configured provider; the UI must say it may incur background model cost. Disabling cancels owned work, removes guidance and preserves local map data for later reuse without trusting it automatically.
2. **Map, not duplicate database:** a compact project index plus module ownership sections: responsibilities, existing capabilities, entry points, relevant tests, relationships, source references, verified fingerprints and explicit unknowns. Reuse source-intelligence metadata; do not reconstruct a second symbol graph. Observed code behavior is not an approved design decision. Cite stable project decision documents where available, never mine unrelated conversations.
3. **Identity and storage:** isolate by canonical checkout/worktree and effective project scope, not remote URL or branch name alone. Store generated maps outside the worktree under an agent-cache directory keyed by canonical path hash; if a custom agent directory lies inside the source scope, use a verified outside-worktree cache or refuse safely. Never edit the user's .gitignore. Global enablement applies only to Git checkouts; a non-Git folder requires its own explicit project-scoped model setting. Reject drive/home roots as accidental project scopes. Treat submodules and nested repositories as boundaries; no symlink escape. Keep the reader's map location stable across published generations.
4. **Data minimization:** only eligible project text; respect ignore rules and exclude credentials, local environment files, generated/dependency/cache/build output and large binary assets. Native tool labels alone are not path restrictions. Read-only child cannot run shells, install packages, browse sites, edit source, spawn children or contact other sessions. Redaction is defense in depth, not a guarantee that arbitrary source contains no secrets.
5. **Freshness:** fingerprints include eligible working-tree contents, adds/deletes and relevant config, not HEAD alone. Record the actual observed coverage and source generation. Build against a stable evidence snapshot or reject/requeue changed sections; never stamp the final current HEAD onto analysis of older content. Previously valid unaffected sections may stay useful; stale sections are hints requiring source checks.
6. **Scheduling:** after session initialization, start a missing initial map when this project's mapper is enabled in Settings or an enabled eligible project starts/resumes. The first top-level prompt joins that same job and waits for a usable map. Later refreshes are coalesced at final settled boundaries, with startup/task-boundary reconciliation for external edits. None and child sessions do no scanning. No per-tool LLM analysis, minute-by-minute rescans or self-triggering map updates. Initial mapping and each refresh have finite read/output/runtime limits and progress status; exhaustion produces explicit partial coverage, not completeness. A non-interactive run also attempts the bounded initial build; only actual build failure/timeout prevents its foreground request with an actionable error. It does not fail merely because a map is initially absent or silently bypass the user's wait choice.
7. **Publication:** claim and publish under a shared cross-process lock using a unique job/generation identity; do all merge/eligibility decisions from locked current state. LLM work stays outside the lock. A source edit during a run stays pending; disabling, switching project or superseding a job prevents its late output from publishing. Age alone does not prove a live mapper dead.
8. **Failures and restarts:** preserve the last good map. Fail closed on malformed, oversized, secret-bearing, out-of-scope or incompatible output. Read current native job state before recovering; an RPC timeout is uncertain, not a failed launch. No silent model switch or automatic failure loop. Reload/session switching must reconcile ownership and release listeners; no stale context object may write into another project.
9. **Quiet completion:** a map completion changes cache and UI only, not the foreground conversation. Do not rely on deleting the notice after it has already triggered a turn. Mixed completion batches and user-owned children must remain untouched. Verify the supported execution route before considering this guaranteed.
10. **Guidance:** one conditional, byte-stable named prompt section contains the stable map path and the reuse/verify rule, not generation IDs, timestamps, fingerprints or changing coverage. Current readiness and coverage live in the map and UI. Update the structured sections collection without returning a whole systemPrompt override; verify the host capability before enabling this feature. The agent reads relevant sections, checks freshness and referenced source/callers, and extends shared ownership only when responsibilities fit. The map never proves absence or overrides user/project instructions. Missing/unusable map means the initial gate; stale/partial map means explicit limitations; None or a child session means no mapping guidance. A routine refresh leaves prompt-section bytes unchanged.
11. **Child and harness isolation:** child contexts must register no mapper gate, scan, launch, refresh or guidance. For detached runners, use the documented exact-PID marker; it is not universal detection for explicitly configured foreground child extensions. Verify that case separately. If a mapper profile is used, suppress ambient extensions and inspect effective capabilities, including required-child extensions which can survive an empty extensions list. Non-mapping live/benchmark fixtures explicitly pin project Mapping agent to None and assert zero mapping calls even under an enabled global default; intentional mapper fixtures may opt in. Do not use a blanket temp-directory ban as a substitute for explicit scope/isolation.
### P3-01 lifecycle contract (agent decisions from source evidence; runtime proof follows in P3-03/P3-04/P3-05)

- **Runtime (assumed, reversible):** in-process, tool-free `ctx.modelRegistry.streamSimple` fed with bounded evidence our own code collects (pattern: work-vision.ts:40-66). No child process, so no completion notice can wake the parent, no recursion, and the model has no tools: read-only is enforced by code, not prompt. No utility-agent profile, so verify-package roster stays unchanged. No fallback model.
- **Lease:** state.json holds job {id, pid, epoch, deadline}. Reclaim only when the pid is dead or the hard deadline (request timeout + grace) passed. Publication re-reads state under the lock and requires the same job id, current epoch and an enabled effective setting, so a reclaimed or disabled job's late result is rejected.
- **Gate:** await inside the `input` handler (Pi awaits input handlers: agent-session.js:1733-1762), for idle inputs (streamingBehavior undefined) from interactive/rpc/extension, placed before compactColdCache in work-models' input handler. TUI/RPC: showListDialog with an AbortSignal (Continue without map / Cancel message), aborted when the map is ready; on failure: Continue without map / Retry / Cancel. Headless (no UI): bounded wait; on failure, write an actionable stderr error and return handled. A second idle input during a pending gate is held and replayed after the first starts via sendUserMessage followUp with expandPromptTemplates = (source !== "extension") (assumed; verify in P3-04).
- **Child guard:** whole mapper is a no-op when `process.env.PI_SUBAGENT_CHILD === "1"` (pi-subagents src/runs/shared/child-runtime-config.js:6, used by its own extension/index.js:217). This covers detached children and processes they spawn. In-process foreground children never load ambient extensions (extension-api.md:500). An explicitly configured foreground child has no supported marker: recorded limitation.
- **Evidence:** no supported scoped source-intelligence API exists, so use `git ls-files -co --exclude-standard -z` (respects ignore rules) at the Git root, confined paths, no symlinks, a secret/generated/binary exclusion list, and per-file outlines (declarations plus leading comments). Skipped files are listed as uncovered. Non-Git folders: refused under global enablement; with a project setting, they need a bounded walk using the same exclusions.
- **Storage:** `<agentDir>/project-maps/<sha256(realpath root) 16 hex>/map.md` is one file with a metadata header, so atomic rename publishes contents and freshness together. state.json holds lease, pending, fingerprints and the last error. Both sit under a session-lock lock. A global epoch file is bumped on every mapping setting change.
- **States:** ready (fingerprints match, full coverage), partial (caps hit; uncovered list), stale (fingerprints changed since publication), failed (last error; last good map kept).
- **Limits:** evidence ≤150k chars, file ≤256 KB, outline ≤40 lines/2k chars per file, output ≤60k chars, maxTokens 16k, request timeout 180 s, headless gate deadline 240 s.




## Open questions

### Blocking

None.

### Deferred

None.

## Relevant files and approach

Confirmed starting points:

- `C:/SOFT/git/ce-workflow/extensions/work-models.ts`: settings model pickers, native background knowledge-discoverer lifecycle and completion suppression, main-agent hooks.
- `C:/SOFT/git/ce-workflow/extensions/ask-user/menu.ts`: shared terminal, web and hub dialog rendering.
- `C:/SOFT/git/ce-workflow/extensions/plan3-files.ts`: existing locked atomic publication pattern; inspect for reusable ownership without coupling project maps to plans unnecessarily.
- `C:/SOFT/git/ce-workflow/extensions/work-extension-scout.ts`: background status persistence pattern, not assumed to be the correct agent execution owner.
- `C:/SOFT/git/ce-workflow/package.json` and targeted test scripts: discover existing entry points before choosing commands.
- Installed Pi docs at `C:/Users/Flex/.pi/agent/install/releases/1.5.2/node_modules/@earendil-works/pi-coding-agent/docs/`: extension lifecycle, supported prompt sections, native background execution and cancellation APIs. Full relevant docs/examples must be read before implementation.

Project report is stale and only 23% covered; verify every selected owner against current source. Current branch is master; preflight showed only unrelated untracked NUL. No product code changed.
### Confirmed reusable seams and pitfalls

- `C:/SOFT/git/ce-workflow/extensions/work-models.ts:617-683` has `chooseModel`. Use one `workOrchestrator.mappingModel` string (`provider/id:effort` or NONE_MODEL), following design/vision settings and splitLevel; no separately drifting effort override. Update `workSettingsLoop`, `hasProjectOverride`, `workSettingsStatus` (4202-4214), menu description (2792), reset/import paths and tests. `clearProjectOverride` can then use its existing default property deletion after hasProjectOverride recognizes mappingModel. The clear action currently writes a stale menu-opening projectSettings snapshot (4552-4556), and scoped writes (343-365) are plain writeFileSync; make the mapping setting's read-modify-write atomic and test competing unrelated updates without a general settings rewrite. Default None; project None overrides global selection; never fall back to the foreground model.
- `C:/SOFT/git/ce-workflow/scripts/test-work-settings.mjs` already exercises global/project inheritance, explicit None, model menus and real shared dialog components. `scripts/test-work-dialogs.mjs` covers dialog conventions.
- Existing `launchKnowledgeDiscoverer` and `spawnSubagentRpc` in work-models show native launch plumbing, but the discoverer is retired from normal compaction. Do not reactivate it or copy its fallback-to-inherited-model behavior for mapping.
- Native API docs: `C:/Users/Flex/.pi/agent/npm/node_modules/pi-subagents/docs/extension-api.md:104-177` document spawn, exact lost-ack correlation through `rpc-spawn-<requestId>`, status and cancellation. An acknowledgement timeout is UNKNOWN, not permission to launch twice. Current helper does not expose request identity to its caller; preserve it if reused.
- Same document: structured owned-leaf delegation at lines 334-428; native detached completion wakes and durable lifecycle at 660 onward. An ordinary detached child can outlive the parent; memory-only in-flight maps are not enough. Decide the quiet completion route with an actual integration probe before committing to a runtime backend. Never monkey-patch global notification behavior or hide unrelated mixed child batches.
- `utility-agents/context-knowledge-discoverer.md` demonstrates `acceptanceRole: read-only`, fresh context, no inherited project context/skills and a tool-free structured result. A mapper needs a deliberately constrained source-reading surface or bounded supplied evidence; the general worker profile is inappropriate.
- Native permission docs `.../pi-subagents/docs/watchdog.md:168-187`: omitted tools default allow and Bash cannot be blocked through that permission mechanism. A prompt saying read-only is not a source/secret boundary. Do not give a mapper shell, mutation, delegation, web, intercom or supervisor-contact tools. Verify actual effective tools/ambient extensions rather than assuming profile labels enforce isolation.
- `C:/SOFT/git/ce-workflow/extensions/plan3-files.ts` exports reusable `confined`, bounded `read` and `atomic`. Its withPlanLock is plan-specific: plan3-locks directory, 10-second deadline, lowercased keys and a plan/diagram error. Use session-lock.ts's non-reentrant takeSessionLock/releaseSessionLock in a small mapper-owned lock wrapper, or minimally parameterize a genuinely shared primitive; do not show plan-specific errors or invent a second lock algorithm. No filesystem lock across an LLM request. Publication and state merges read current effective policy and job generation under the same lock; PID liveness alone is not proof a mapping job remains active.
- Installed Pi extension documentation is only partially read so far; finish relevant lifecycle, prompt-section, tool and example cross-references before product implementation. No product tests or UI checks have been run in this planning phase.
### Additional verified integration scope from review

- `C:/SOFT/git/ce-workflow/extensions/work-compaction-memory.ts:230-260` and `extensions/work-vision.ts:40-66`: existing registry.streamSimple patterns for a candidate tool-free runtime. Source evidence selection, coverage quality and restart behavior still need a P3-01 probe; quiet behavior is not yet tested.
- `C:/SOFT/git/ce-workflow/extensions/plan3.ts:743`: kickoff uses sendUserMessage with expansion disabled and deliverAs followUp. Installed `.../pi-coding-agent/dist/core/agent-session.js:1733-1762` awaits input handlers and only exposes streamingBehavior while streaming; `:2012-2039` shows sendUserMessage's expansion default false. Preserve these semantics rather than blanket-skipping extension inputs or blindly enabling expansion on every replay.
- `C:/SOFT/git/ce-workflow/scripts/rework-lab.mjs:57,104` writes ultrafull fixture settings then launches RPC Pi; `scripts/benchmark-self-verify-live.mjs:91-122` creates Git fixtures and launches print/json Pi with extensions and inherited environment. Both need explicit project mappingModel None. Inventory other existing real-Pi test/benchmark launch sites and apply the same opt-out where global settings can leak; explicitly mapping-focused fixtures alone opt in. Verify isolation without changing the user's global settings or running the full live benchmark suite during ordinary edits.
- `C:/SOFT/git/ce-workflow/scripts/verify-package.mjs:37-40` asserts an exact static utility-agent roster; its line 113 auto-discovers test-work-*.mjs. If a native mapper profile is selected, reconcile roster/discovery and intended manual launchability; an in-process implementation needs no utility-agent addition.
- `C:/SOFT/git/ce-workflow/hub/scripts/test-browser.mjs:1-3,111-113` stubs ce-workflow and records slash commands instead of executing real settings. `hub/scripts/changelog-shot.mjs:1-6,68-72` renders supplied ask JSON using fake Pi. Use these honestly as visual fixtures, with C-settings and a targeted real-runtime fixture providing the missing behavior evidence.
- Installed `C:/Users/Flex/.pi/agent/npm/node_modules/pi-subagents/docs/extension-api.md:494-498` documents exact-PID detached-runner detection and the absence of that marker for foreground child sessions. Its agents.md:502-506 states required child extensions survive extensions:[]; an empty profile is not sufficient proof of isolation.
- Reuse of Lens metadata is conditional on an identified supported provider: current `C:/SOFT/git/ce-workflow/extensions/work-lens-format.ts` only sets config defaults. No direct project/module graph API was found in the inspected ce-workflow integration.



## Phases

### Phase 1: Lifecycle and map contract [think]

- [x] **P3-01** Lifecycle contract chosen from source evidence: in-process tool-free streamSimple runtime, awaited input gate, PI_SUBAGENT_CHILD guard, git ls-files evidence, external cache, lease/epoch publication (see Decisions).

### Phase 2: Settings and maintenance [code]

- [x] **P3-02** Mapping agent setting added (workOrchestrator.mappingModel "provider/id:effort", None default, malformed fails closed to None, project None wins, clear inherits model+effort, clear re-reads settings instead of writing the menu snapshot); commit 9ee519c0.
- [x] **P3-03** extensions/work-project-map.ts: projectRoot/mapLocation (outside-worktree cache, drive/home refused), single-snapshot scan (git ls-files or bounded walk; generated/credential/binary/huge/symlink excluded and listed), tool-free registryComplete, createProjectMapper (refresh with in-process join, locked claim/publish by job id, pending re-run, disable, waitForIdle, status); commit 32acd699.

### Phase 3: Main-agent guidance and verification [code]

- [x] **P3-04** Idle inputs (interactive/RPC/extension) are held in place inside the awaited input hook until the first map exists (no replay, so text/images/expansion stay Pi's); Continue-without/Cancel/Retry dialogs, headless bounded deadline with deterministic error; stable sections["project-map"] set/deleted; background refresh at session_start/agent_settled with no auto-retry after failure; Settings row gains Rebuild/status; None disables; off in PI_SUBAGENT_CHILD (commit 84f769c8).
- [x] **P3-06** projectMapScope also returns off when PI_WORK_PROJECT_MAP=off; every live script that spawns Pi defaults it with ??= "off" (fixtures opt in with =on); test-work-settings proves a global model maps a Git checkout but not under off, and guards new live scripts (commit 6ee31eaf).
- [ ] **P3-05** Exercise the real settings UI, run changed-path LSP and targeted checks, and report rollout limits without optimization claims.
  - Drive real settings persistence and model/effort/None/cancel/clear flows in C-settings, which executes workSettingsLoop and shared dialog components. The hub test-browser stub does not execute that loop. For visual checks, capture actual generated dialog JSON and render it with the existing changelog-shot --ask facility or a targeted headless fixture; interact with that form and inspect it through screen_read. Label rendering evidence separately from settings persistence and live mapper integration; a canned screenshot is not an end-to-end proof.
  - Run C-settings, C-dialogs and C-lifecycle, plus only relevant existing lock/agent-profile checks identified by touched code. Run active LSP on changed paths; disclose verified baseline-only findings and unavailable coverage.
  - Probe the selected execution route safely in an explicitly enabled disposable mapper fixture: first-run gating, quiet background completion, cancellation, no recursion and effective read-only capability. Include print/json lifecycle and idle /resume3 input, not just direct hook mocks. If native child profiles are used, verify resolved tools/extensions; in-process mode proves no tools are supplied. Do not configure or map the user's repositories merely to exercise the feature.
  - Update user documentation and Unreleased changelog in plain language. No version bump or push unless later requested. Do not claim time/token savings; any such claim requires a complete same-benchmark comparison including all maintenance and continuation costs.

## Global validation

- None: no child launch, no map instruction, no ongoing refresh; existing generated data is not silently treated as authoritative.
- Enabled: initial map with citations and bounded source coverage; refreshed changes include adds, deletes and renames, with untouched verified entries retained.
- Dirty files and source changes during generation never produce false current-state metadata. Re-read effective settings plus the current owned job/generation inside the publish lock; reject cancelled, superseded or disabled work. Settings files have no existing epoch. Keep explicit job invalidation so disable/re-enable cannot accidentally admit an old completion with the same model string.
- Multiple sessions share one maintenance owner per checkout; no lost updates, duplicate launches or cross-worktree contamination.
- Provider failure, malformed output, unavailable tool/model and process restart preserve last good data, expose staleness and do not create retry or completion-wake loops.
- Prompt injection from source/map remains untrusted data; generated claims do not override user decisions or project rules. Secret and ignored-file boundaries are enforced in code where APIs permit, with no sandbox claims beyond actual restrictions.
- Focused regression sensitivity is required for lifecycle, concurrency, freshness and conditional instructions. Use existing test scripts; exact commands will be added after source inspection. Do not run a full suite per edit.
- UI checks are performed by the agent, not delegated to the user. No hardware requirement anticipated.
- End-to-end cost tracking includes initialization and upkeep; any performance claim requires the same complete benchmark and comparator, not focused tests or fewer searches.
### Existing focused commands

Run from `C:/SOFT/git/ce-workflow` only when the related code has changed:

- **C-settings:** `node "scripts/test-work-settings.mjs"` — scoped model settings and dialog interactions.
- **C-dialogs:** `node "scripts/test-work-dialogs.mjs"` — shared dialog behavior.
- **C-lifecycle:** `node "scripts/test-work-compaction-notifications.mjs"` — existing work-models/native-child hook fixtures; extend only the relevant integration seams without changing compaction behavior.
- **C-locks:** `node "scripts/test-work-session-lock.mjs"` and `node "scripts/test-work-locked-writes.mjs"` — run only if shared lock behavior changes; mapper race tests still belong with mapper behavior.
- **C-visual:** reuse `C:/SOFT/git/ce-workflow/hub/scripts/changelog-shot.mjs` with its documented selector/output/--ask arguments and real generated dialog JSON, then headless interaction and screen_read. Exact selector/payload follow the implementation. Its fake Pi validates rendering, not workSettingsLoop persistence or mapping execution; do not run the unrelated full hub browser suite as a mapping test.

The dedicated mapping runner is planned at C:/SOFT/git/ce-workflow/scripts/test-work-project-map.mjs; create it during P3-03 before adding its exact runnable command here. Its filename is automatically discovered by verify-package; no manual registry edit. Every nontrivial behavior change has a focused assertion and red/green or disposable semantic mutation proof. Explicitly test that the first-map gate prevents the foreground model request, not merely that a spinner renders. Prove a routine refresh produces no new foreground model call. Configuration None must have zero mapper launch and source-scan activity. No tests have yet been run for this unimplemented feature.
### Review-added acceptance cases

- Changing map generation/coverage with unchanged enablement and scope leaves the named prompt section byte-identical; never return a full systemPrompt override for mapping.
- A detached child hook pass performs zero mapper scans/spawns/refreshes and injects no map guidance. Explicit foreground child-extension loading has an independently proven exclusion mechanism, not an assumed environment marker.
- A globally enabled mapper plus a non-mapping harness's explicit project None produces zero mapping calls and no startup gate. Dedicated mapper fixtures must opt in deliberately. Check related launch sites rather than inferring isolation from a temp path.
- Publishing a map into its external cache leaves fixture git status --porcelain and eligible-source fingerprints unchanged even without .gitignore. A custom agent-dir placement inside the worktree cannot defeat this condition.
- An idle /resume3-style extension kickoff is gated; a real mid-stream follow-up retains queue semantics. Original images, raw-template expansion and already-expanded prompts survive without duplicate submission, including interaction with cold-cache compaction.
- Headless configured mapping can successfully build its first map before foreground work; missing map alone is not a failure. Actual failure/timeout returns a bounded actionable error without attempting a dialog or silently proceeding.
- Concurrent settings edits preserve unrelated keys; clear override rereads under the update lock. Disable/re-enable with the same selected model cannot publish the pre-disable job.
- New mapper runner auto-discovery and any chosen utility-agent roster are checked independently without running the full package suite after each edit.



## Resume context

Plan review complete: all 10 advisor findings independently validated against HEAD d2b4d035488fd6f265ae87898ca48f009faf46b4 and dispositioned in Amendments. Six pending steps; P3-06 adds benchmark/live-harness isolation. User choices remain local untracked maps and waiting for first usable map. Plan stays draft, with no new product-policy questions. Next P3-01 must probe runtime options (including tool-free registry calls), input gating, foreground-child exclusion and bounded evidence quality; none are runtime-verified. Product files/settings untouched; preserve unrelated NUL. Do not infer runtime proof from source review or fake-hub screenshots.

## Amendments

Initial draft preserves the explicit adoption request while distinguishing pilot quality signals from unproven optimization claims.
- 2026-11-15: Added P3-01, P3-02, P3-03, P3-04, P3-05 as the first steps: Translate the requested production feature into explicit implementation and verification steps; Phase 1 resolves policy before coding.
- 2026-11-15: Added P3-06 after P3-04: Advisor finding R3: existing throwaway Pi harnesses inherit global settings, so mapper work would otherwise alter unrelated acceptance, runtime and accounting.
### 2026-11-15 — read-only Opus plan review, validated by parent

Advisor: plan3-advisor, anthropic/claude-opus-5-5:high, fresh run `67b4d132-cf74-4833-94bb-d561c3d86435`. Full report: `C:/Users/Flex/.pi/agent/sessions/--C--SOFT-git-ce-workflow--/subagent-artifacts/67b4d132-cf74-4833-94bb-d561c3d86435_plan3-advisor_output.md`. Parent independently inspected every cited seam at repository HEAD `d2b4d035488fd6f265ae87898ca48f009faf46b4`; this was source/doc review, not runtime validation. User decisions Q-01/Q-02 remain unchanged.

- **R1 — accepted:** stable prompt sections. Pi extensions.md:657 explicitly describes section patches/cache misses; CHANGELOG.md 0.9.6 records the recent whole-prompt cache fix. Removed volatile freshness/coverage from injected text; added byte-identical refresh acceptance and structured-sections-only integration. Prefer no dynamic coarse status in the prompt either; status belongs in map/UI.
- **R2 — accepted with a detection caveat:** exclude the entire mapper in child contexts, not just startup gating. Installed extension-api.md:494-498 confirms ambient detached loading and exact-PID detection, but also explicitly says foreground children have no marker. agents.md:502-506 says required child extensions survive extensions:[]. Rejected treating either the PID check or empty extensions as universal proof; P3-01 must prove foreground exclusion and effective capabilities too.
- **R3 — accepted isolation and clarification; rejected blanket bypass:** rework-lab.mjs:57,104 and benchmark-self-verify-live.mjs:91-122 confirm globally configured mapping could leak into ordinary fixtures. Added P3-06 to pin None in non-mapping harnesses and assert zero calls. No blanket ban on all temp directories: intentional mapper fixtures may opt in. The original headless failure wording was ambiguous, not evidence every print run necessarily fails; clarified bounded first build, then fail only on actual error/timeout. Silent headless fail-open would weaken the user's wait-for-first-map choice and is not adopted. No new user-policy question is necessary for that clarification.
- **R4 — accepted:** work-knowledge.ts:148-163 writes under the worktree and this repo's .gitignore alone excludes it. The mapper now requires outside-worktree cache storage, independent of user ignore rules, plus unchanged git status/fingerprint checks; do not edit .gitignore.
- **R5 — accepted input-source/expansion coverage; rejected prescribing replay before a probe:** Pi extensions.md:1112-1160 and agent-session.js:1733-1762 confirm pre-expansion input handling and awaited handlers; plan3.ts:743 sends already-expanded kickoff with followUp, which the SDK ignores when idle. Both awaiting input and handled-plus-replay remain P3-01 candidates. Do not blanket-skip extension input, use a text-only bypass, or blindly force template expansion on an already-expanded prompt. Added exactly-once, images, queue, abort and cold-cache-composition checks.
- **R6 — accepted as a candidate, not a proven backend choice:** work-compaction-memory.ts:230-260 and work-vision.ts:40-66 confirm tool-free modelRegistry.streamSimple with timeout/usage handling. Added bounded evidence-fed in-process execution to the feasibility comparison; it has no autonomous filesystem exploration and loses work on owner death. Do not copy compaction's fallback loop or claim comparable map quality before the probe.
- **R7 — accepted:** verify-package.mjs:37-40 hard-codes the utility-agent roster; line 113 discovers test-work-*.mjs automatically. Planned test-work-project-map.mjs needs no manual registry entry. A chosen native profile requires roster/discovery/manual-launchability consideration; in-process mode does not need a gratuitous profile.
- **R8 — accepted:** parent independently read test-browser.mjs:1-3,111-113 and changelog-shot.mjs:1-6,68-72. Neither drives workSettingsLoop. Split real settings flow tests, visual form rendering/clicking and native runtime checks; removed the misleading C-hub end-to-end claim and unrelated browser-suite requirement.
- **R9 — accepted:** work-models.ts:4202-4263 and 4552-4556 confirm missing status/override seams and stale-clear writes. Use a single mappingModel provider/id:effort value, explicitly add hasProjectOverride support, reuse default deletion and include status/menu text. Keep the concurrency correction narrow, with a fresh locked settings read and preservation of unrelated keys.
- **R10 — accepted with safety preservation:** no settings epoch or usable graph API exists in the inspected settings/Lens code; plan3-files.ts:7-37 has plan-specific locking semantics. Defined global-Git/project-explicit-non-Git scope and initialization triggers; made source-intelligence use conditional on a proven API, and selected a small wrapper around existing lock primitives instead of plan-branded errors. Replace the undefined settings epoch with current locked policy plus explicit job/generation invalidation; re-reading a model string alone is not enough for disable/re-enable races.

No new blocking product question was introduced. P3-01 still contains explicit evidence-producing feasibility gates; if they fail, the resulting options must be written under Open questions and the plan marked blocked, not silently downgraded. No product implementation, tests, provider calls for mapping, UI probes, commits or pushes occurred during this review.
