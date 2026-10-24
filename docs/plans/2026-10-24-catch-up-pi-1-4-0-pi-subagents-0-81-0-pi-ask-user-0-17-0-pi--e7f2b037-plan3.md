---
plan3: true
status: active
created: 2026-10-24
source: catch-up
catch-up: {"@earendil-works/pi-coding-agent":"1.4.0","pi-subagents":"0.81.0","pi-ask-user":"0.17.0","pi-intercom":"0.18.1"}
updated: 2026-10-24T22:02:28.974Z
reviewed: 2026-10-24
started: 2026-10-24T21:59:19.099Z
---

# Catch up Pi 1.4.0, pi-subagents 0.81.0, pi-ask-user 0.17.0, pi-intercom 0.18.1

## Original request

> Catch ce-workflow up with the new releases of the Pi packages it still uses: review every release after the last reviewed version up to the target, decide what helps or breaks this repository, apply what is adopted, then record the reviewed versions.

## Review targets

| Package | Last reviewed | Target | Installed | Changelog excerpt | Full diff |
|---|---|---|---|---|---|
| @earendil-works/pi-coding-agent | 1.3.0 | 1.4.0 | 1.3.0 | `C:\SOFT\git\ce-workflow\.pi\work-catch-up\2026-10-24T21-41-16-629Z\earendil-works-pi-coding-agent-1.3.0-to-1.4.0.changelog.md` | `C:\SOFT\git\ce-workflow\.pi\work-catch-up\2026-10-24T21-41-16-629Z\earendil-works-pi-coding-agent-1.3.0-to-1.4.0.diff` |
| pi-subagents | 0.79.1 | 0.81.0 | 0.79.1 | `C:\SOFT\git\ce-workflow\.pi\work-catch-up\2026-10-24T21-41-16-629Z\pi-subagents-0.79.1-to-0.81.0.changelog.md` | `C:\SOFT\git\ce-workflow\.pi\work-catch-up\2026-10-24T21-41-16-629Z\pi-subagents-0.79.1-to-0.81.0.diff` |
| pi-ask-user | 0.16.0 | 0.17.0 | not installed | none | `C:\SOFT\git\ce-workflow\.pi\work-catch-up\2026-10-24T21-41-16-629Z\pi-ask-user-0.16.0-to-0.17.0.diff` |
| pi-intercom | 0.17.1 | 0.18.1 | 0.18.1 | none | `C:\SOFT\git\ce-workflow\.pi\work-catch-up\2026-10-24T21-41-16-629Z\pi-intercom-0.17.1-to-0.18.1.diff` |

Several releases may lie between the last reviewed version and the target; review all of them, not only the newest notes. Start from the changelog excerpt (the CHANGELOG lines added across every intermediate release). The full diff (`npm diff` between the versions) can be very large: search it with rg for the files or APIs a change names instead of reading it whole. Without an excerpt, or when the diff starts with an error, read the changelog from the installed package or its GitHub releases.

## How to review (planning)

1. For each target, list the changes in every release since the last reviewed version that could affect ce-workflow: Pi extension hooks/events/context, tool registration and exposure, commands, settings, SDK, TUI, model runtime; for plugins their tool schemas, lifecycle and skills. Skip unrelated trivia.
2. Understand before judging. When a change touches a feature or term you cannot explain from this repository (for example "codemode can now do X"), research it first: the package's README/docs/examples (Pi docs live in the installed package's docs/), its source in node_modules, context7, or the web. Put a one-line explanation of the feature in the decision rationale. Never grade a change you could not explain.
3. Map each change to this repository: search extensions/ and scripts/ for the affected API or feature and state what it would fix, delete, simplify or enable here — or why it does not apply.
   For pi-ask-user, compare the target release index.ts and single-select-layout.ts with extensions/ask-user/. Read extensions/ask-user/UPSTREAM.md; port relevant changes into our vendored copy, preserve the native single/batch remote-answer race and D12 coexistence behavior, update its pinned version/provenance, and verify terminal popup and remote-answer tests. Do not patch or overwrite the installed upstream package.
4. Grade it: Adopt or Trial → status "adopted"; Reject or Not-our-problem → status "no-action". Hold is not allowed: when you cannot decide, ask the user with the tradeoff and your recommendation, and record the answer in Decisions.
5. Record every graded change in the Catch-up decisions JSON below (a package with nothing relevant gets one Not-our-problem decision saying so). For each adopted change, add a step to Phase 1 with its focused check; when nothing is adopted, replace the Phase 1 placeholder with "None — nothing adopted."

## Catch-up decisions

Fill during planning. Each entry: {"title", "pov": "Adopt|Trial|Reject|Not-our-problem", "status": "adopted|no-action", "rationale"}; adopted entries also need "verification" (the check command and its result), added when the step is done. The recorder fills in the version.

```json
{
  "@earendil-works/pi-coding-agent": [
    {
      "title": "Pin the devDependency to the reviewed release 1.4.0",
      "pov": "Adopt",
      "status": "adopted",
      "rationale": "package.json pins @earendil-works/pi-coding-agent 1.3.0 for type checks and tests, while the managed host already runs 1.4.0 (~/.pi/agent/install/current-version). The extension API types are unchanged between the installed 1.3.0 and 1.4.0 releases (only agent-session, compaction, model-config, provider-composer, interactive-mode and pi-user-agent .d.ts files differ), so the bump is low risk. Same step as CU-04 of the 1.3.0 catch-up (ffd99fd1). CU-01."
    },
    {
      "title": "Compaction and branch summaries use the model's output limit; generateSummary(WithUsage) ignore reserveTokens (#9512)",
      "pov": "Not-our-problem",
      "status": "no-action",
      "rationale": "Pi no longer sets a fixed maxTokens on summary requests, so long reasoning cannot cut a summary at the cap. work-models.ts summarizeNativeContext passes reserveTokens positionally to generateSummaryWithUsage; 1.4.0 keeps that parameter as _reserveTokens (compaction.d.ts:114) and the later positions (signal, customInstructions, previousSummary, streamFn, retry) are unchanged, so the call stays valid and the native and default modes get the fix for free. Keeping the argument keeps older Pi hosts (peerDependency \"*\") working."
    },
    {
      "title": "Same fixed-cap pattern in ce-workflow's own hybrid compaction and vision calls",
      "pov": "Reject",
      "status": "no-action",
      "rationale": "work-compaction-memory.ts:236 (maxTokens 16384) and work-vision.ts:56 (maxTokens 4096) still cap output while reasoning, the failure class Pi fixed. A search of every session log found no \"Compaction response stopped: length\" or \"Vision model failed (length)\" outside this review, and both paths fail safely (the next compaction model or local memory; a clear vision error). Raising the caps could raise cost with no observed failure. Revisit if a length stop appears."
    },
    {
      "title": "Concurrent extension dialogs form a stack instead of replacing each other (#11166)",
      "pov": "Reject",
      "status": "no-action",
      "rationale": "Pi now stacks select, confirm, input, editor and inline custom() dialogs so no promise is left pending. plan3.ts:690-697 serialUI works around exactly the old bug, but it stays: Pi's stack does not cover overlay custom() components, which ask_user uses by default; serialUI keeps first-in-first-out order for parallel requirement asks instead of newest-first; and it still protects older Pi hosts. Other concurrent dialogs benefit without changes."
    },
    {
      "title": "Resume and /tree keep extension tools active unless registered with defaultActive: false (#11062, #11075)",
      "pov": "Not-our-problem",
      "status": "no-action",
      "rationale": "The restore applies only to direct and model-only tools (agent-session.js _isActivatedOnRegistration). The opt-in camera tools (model-only) are re-synced by syncCameraTools on session_start and before_agent_start (work-models.ts:3651, 3697), so a restored camera tool is removed before the next request. plan3_design is deferred and unaffected. Every other ce-workflow tool is meant to be active."
    },
    {
      "title": "Codemode waits for a free worker; PI_CODEMODE_MAX_WORKERS raises the limit (#11184)",
      "pov": "Not-our-problem",
      "status": "no-action",
      "rationale": "Parallel codemode scripts and in-process subagents now queue for up to 60 s instead of failing. ce-workflow has no workaround to delete (no busy-worker handling or PI_CODEMODE references). The process_image wait in work-images.ts:137 handles a different race (a screenshot file not written yet)."
    },
    {
      "title": "Provider attribution headers come from pi-ai's client identity; before_provider_headers no longer sees them",
      "pov": "Not-our-problem",
      "status": "no-action",
      "rationale": "ce-workflow registers no before_provider_headers handler and sets no User-Agent or attribution header."
    },
    {
      "title": "Codemode models.classify() accepts images for Jev and Clef",
      "pov": "Reject",
      "status": "no-action",
      "rationale": "jev-tools.ts sends typed questions about JSON and file text through registry.classify; image questions already go through process_image and the configured vision model. Nobody asked for image classification."
    },
    {
      "title": "Extension loader exposes @earendil-works/pi-ai/models (#11156)",
      "pov": "Not-our-problem",
      "status": "no-action",
      "rationale": "No ce-workflow extension imports @earendil-works/pi-ai."
    },
    {
      "title": "Other 1.4.0 runtime fixes and additions",
      "pov": "Not-our-problem",
      "status": "no-action",
      "rationale": "Recovery from responses cut at the output limit (#11227), grep --no-config, Windows shell detection, BOM-tolerant managed-install.json and mcp.json, terminal teardown, clipboard on Ctrl+Z, /compact instructions on split turns, retries, prompt-cache fix, Markdown and HTML rendering, Rex terminal, models.json reference, new and default models. None has a ce-workflow code path or workaround; the extension types.d.ts is identical between 1.3.0 and 1.4.0."
    }
  ],
  "pi-subagents": [
    {
      "title": "An idle parent is woken by the notice itself; no \"Inspect subagent updates above\" line (0.80.0)",
      "pov": "Not-our-problem",
      "status": "no-action",
      "rationale": "work-compaction.ts:449-457 keeps the old wake texts so old sessions stay clean (D3 of ffd99fd1). The new wake is the notice, a role \"custom\" message, which gather() in work-compaction-memory.ts:83 never records as a user request. The hub has no wake-text handling. 0.80 needs Pi 1.2.0 or newer; the host runs 1.4.0."
    },
    {
      "title": "Model-visible notices are wrapped in <pi_subagents_notice> by a context hook (0.81.0)",
      "pov": "Not-our-problem",
      "status": "no-action",
      "rationale": "The wrapper changes only the provider request (src/extension/index.js:561-586); the stored transcript, customType and details stay the same, and ce-workflow's checks read those (work-compaction.ts:406, work-models.ts:831). The content-based check in isKnowledgeDiscovererCompletionMessage serves the retired knowledge discoverer, which has no production caller."
    },
    {
      "title": "parallel, tasks and chain children accept per-child cwd and model (0.80.0)",
      "pov": "Reject",
      "status": "no-action",
      "rationale": "Plan3 review launches one async subagent call per advisor (plan3.ts:575). Merging them into one tasks call would change how completions wake the parent and, under the Optimization Regression Rule in AGENTS.md, needs an end-to-end benchmark before it counts as an improvement. No problem with the current launches is reported."
    },
    {
      "title": "providerDiagnostics on structured delegation :update and :response events (0.81.0)",
      "pov": "Reject",
      "status": "no-action",
      "rationale": "ce-workflow uses only the v1 status RPC (plan3-web.ts:68) and has no view of child retry state; nobody asked for one."
    },
    {
      "title": "A child with outputSchema that skips structured_output gets one follow-up turn (0.81.0)",
      "pov": "Not-our-problem",
      "status": "no-action",
      "rationale": "The only subagent launch with outputSchema is the retired knowledge discoverer (work-models.ts:1229, no production caller). jev-tools.ts outputSchema is a tool result schema, not a subagent one."
    },
    {
      "title": "Other 0.79.2 to 0.81.0 fixes and options",
      "pov": "Not-our-problem",
      "status": "no-action",
      "rationale": "Faster Windows start and EPERM temp-folder fix, completion notices kept across a restart, steer fixes, children no longer get APPEND_SYSTEM.md, compacted sessions keep subagent, YAML frontmatter comments, enableSlashCommands, FleetView mouse support, Codex-wire tool ids. ce-workflow neither uses APPEND_SYSTEM.md nor sets enableSlashCommands, and none of these has a ce-workflow code path. The notice-across-restart fix helps hub-parked sessions without changes."
    }
  ],
  "pi-ask-user": [
    {
      "title": "A top-level question sent with questions becomes the batch heading instead of an error (#80)",
      "pov": "Adopt",
      "status": "adopted",
      "rationale": "0.17.0 shows that question as the batch heading (frame title, review page, dialog fallback, result text, call card) and no longer throws \"Use exactly one of question or questions\". Our vendored copy still throws it (extensions/ask-user/index.ts:2606-2611), and 15 earlier session files contain that error, each costing the model a retry. The hub batch form already renders ask.title as its heading (hub/web/prompts.ts:21), so passing the heading as title covers the browser too. CU-02."
    },
    {
      "title": "ask_user is registered with exposure \"model-only\"",
      "pov": "Adopt",
      "status": "adopted",
      "rationale": "Pi's extensions.md:270 says model-only is meant for tools that ask the user: declared to the model, never callable from codemode. A codemode script waiting on a dialog runs into script deadlines and holds a worker. ce-workflow's own callers use execute directly (registerAskUser for the Plan3 adapter) or the model, never codemode (rg tools.ask_user: none). One line. CU-03."
    },
    {
      "title": "ask-user.json settings file for display defaults (settings.ts)",
      "pov": "Reject",
      "status": "no-action",
      "rationale": "Adds a second configuration source and an 81-line module next to the environment variables, which keep working. ce-workflow keeps its own settings; nobody asked for this file."
    },
    {
      "title": "Tern native sheet (tern.ts) and the Space and Enter activate/submit refactor",
      "pov": "Reject",
      "status": "no-action",
      "rationale": "ce-workflow targets the terminal and the hub, not Tern panes; the refactor only serves Tern's sheets and changes no terminal behavior. README and skill text changes describe these features; ce-workflow does not ship the upstream skill."
    }
  ],
  "pi-intercom": [
    {
      "title": "Mailbox: sends to a disconnected session report that the message waits; the broker stays up while mail waits; late messages emit expired",
      "pov": "Not-our-problem",
      "status": "no-action",
      "rationale": "hub-command.ts intercomParkedSessions wakes a parked session before sending and only rewrites error results; a \"waiting for reconnect\" result is not an error. work-ask-remote.ts sends through intercom:outbox-request and does not read delivery text. No ce-workflow code depends on broker exit timing."
    },
    {
      "title": "Click to expand or collapse one intercom message in fullscreen mode",
      "pov": "Not-our-problem",
      "status": "no-action",
      "rationale": "Terminal display only; the hub renders its own chat."
    }
  ]
}
```

## Decisions

- **D1 (planning, evidence)** Port only the batch heading and the model-only exposure from pi-ask-user 0.17.0. Not ported: ask-user.json, Tern and the activate/submit refactor. List them in UPSTREAM.md so the next catch-up does not review them again.
- **D2 (planning, evidence)** The hub shows the heading through the existing `title` of the batch form (hub/web/prompts.ts:21). No hub code change. Script asks through `/api/sessions/:id/ask` are unchanged.
- **D3 (planning, evidence)** Keep plan3.ts serialUI despite Pi #11166. Pi's dialog stack does not cover overlays, and first-in-first-out order is intended.
- **D4 (planning, evidence)** Keep the fixed maxTokens in work-compaction-memory.ts and work-vision.ts. Session logs show no length stops, and both paths fail safely.
- **Assumption (over 95%, evidence)** No ce-workflow flow calls ask_user from codemode, so model-only exposure removes nothing in use. rg finds no `tools.ask_user` in extensions or scripts.
- **Assumption (over 95%, evidence)** Bumping the devDependency is dev-only. Runtime uses Pi's managed install, the same assumption as the 1.3.0 catch-up.
- **User preference (2026-10-24)** "Here we are developing the ce-workflow, we shall be running DIRECTLY from the source": Pi loads ce-workflow from `C:\SOFT\git\ce-workflow` (global settings.json package entry), never the GitHub install. Test changes against the source checkout.


## Open questions

### Blocking

None.

### Deferred

None.

## Commands

- C1: `node scripts/test-work-ask-user.mjs`
- C2: `node scripts/test-work-ask-remote.mjs`
- C3: `npm install --save-dev --save-exact "@earendil-works/pi-coding-agent@1.4.0"`
- C4: `node scripts/test-work-compaction.mjs` and `node scripts/test-work-compaction-notifications.mjs`
- C5: lens_diagnostics source=lsp scope=paths on `extensions/ask-user/index.ts`. An inconclusive outcome is not clean.
- C6: `npm run verify:quiet`
- C7: `node scripts/work-catch-up-record.mjs e7f2b037`

## Phases

### Phase 1: Apply adopted changes [code]

- [x] **CU-01** Pinned Pi SDK and lockfile to 1.4.0; isolated native selfcheck from inherited hub mode.
- [x] **CU-02** Ported batch headings across terminal frame/review, fallbacks, results, events and hub payload; added regressions and changelog.
- [x] **CU-03** Registered ask_user as model-only using the upstream-compatible spread and asserted exposure.
- [x] **CU-04** Updated vendored version and provenance to reviewed 0.17.0, documenting ports and deliberate omissions.

### Phase 2: Verify and record [code]

- [ ] **CU-90** Run `npm run verify:quiet` (C6) after the adopted changes and record the result.
  - Environment-only failures (for example the attached-device branch of test-work-screen-read) are recorded as such, not fixed here.
- [ ] **CU-91** Record the reviewed versions: `node scripts/work-catch-up-record.mjs <this plan's id>` (C7).
  - It writes exactly the target versions above (not newer releases) into `extensions/work-catch-up-baseline.json` and refuses missing, unexplained or unverified decisions.
  - Before running it, add each adopted entry's "verification" (command and result) to the JSON above.
### P-ARCH [code] Product architecture

- [ ] **ARCH-RECONCILE** Reconcile the product architecture diagram with this plan's actual changes.
  - Compare actual code and git history; update through plan3_diagram target product, or mark done with no architecture change.
  - Changed plan elements: none flagged; inspect actual implementation.


## Acceptance

- ask_user with a top-level question and questions opens the batch with that question as its heading in the terminal, the dialog fallback and the hub form, and its result text starts with the heading. C1 checks the rendered frame and review page, the fallback dialog titles, the ask:pending title and the hub payload title; C2 still passes.
- ask_user is declared with exposure model-only (C1).
- UPSTREAM.md and ASK_USER_VERSION read 0.17.0 and list the parts not ported.
- The devDependency pins 1.4.0 and the lockfile matches it; C1 and C4 pass afterwards.
- C6 passes apart from recorded environment-only checks, and C7 records 1.4.0, 0.81.0, 0.17.0 and 0.18.1 with verified adopted decisions.

## Resume context

Planning and review complete: every change graded in Catch-up decisions; 3 adopted (devDependency 1.4.0, ask_user batch heading, ask_user model-only exposure). Review findings 1 and 2 accepted and applied to CU-02 and Acceptance (see Amendments). Decisions D1-D4 settled from evidence; no open questions. Next: CU-01 (C3, then C1 and C4). Status stays draft until /plan3 finish.

## Amendments

- 2026-10-24: Generated by /wo → Catch up packages.
- 2026-10-24: Planning filled the Catch-up decisions, Decisions D1-D4, Commands, Phase 1 (CU-01 to CU-04) and Acceptance.
- 2026-10-24 review (advisor openai-codex/gpt-6-astra:high):
  - Finding 1 (UI acceptance lacks targeted coverage): accepted. Verified that test-work-ask-user.mjs answers batches remotely without rendering (line 40) and checks the hub batch only for questions and answers (line 115). CU-02 now adds rendered-frame, review-page, fallback-title, ask:pending title and hub payload title assertions; Acceptance names them.
  - Finding 2 (upstream presentation described wrongly): accepted. The 0.17.0 diff adds the heading to the shared frame title (line 557) and below "Review answers" (line 634), and prefixes fallback dialog titles (line 649); question pages keep their titles. CU-02 and the decision rationale now say so.
- 2026-10-24: Added final architecture reconciliation because a product diagram exists.
CU-01 validation: the ask_user selfcheck inherited PI_HUB=1 from this runner and entered the hub path with native-only mocks. Clear PI_HUB at test startup; its explicit hub cases still enable it. No production change.
