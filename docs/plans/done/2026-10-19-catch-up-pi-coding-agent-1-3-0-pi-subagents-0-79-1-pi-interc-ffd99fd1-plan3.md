---
plan3: true
status: complete
created: 2026-10-19
source: catch-up
catch-up: {"@earendil-works/pi-coding-agent":"1.3.0","pi-subagents":"0.79.1","pi-intercom":"0.17.1","pi-lens":"4.4.4"}
updated: 2026-10-20T12:02:46.137Z
reviewed: 2026-10-19
tagsChecked: 51893b22
started: 2026-10-20T12:02:16.401Z
---

# Catch up pi-coding-agent 1.3.0, pi-subagents 0.79.1, pi-intercom 0.17.1, pi-lens 4.4.4

## Original request

> Catch ce-workflow up with the new releases of the Pi packages it still uses: review every release after the last reviewed version up to the target, decide what helps or breaks this repository, apply what is adopted, then record the reviewed versions.

## Review targets

| Package | Last reviewed | Target | Installed | Changelog excerpt | Full diff |
|---|---|---|---|---|---|
| @earendil-works/pi-coding-agent | 1.1.0 | 1.3.0 | 1.1.0 | `C:\SOFT\git\ce-workflow\.pi\work-catch-up\2026-10-19T12-58-49-054Z\earendil-works-pi-coding-agent-1.1.0-to-1.3.0.changelog.md` | `C:\SOFT\git\ce-workflow\.pi\work-catch-up\2026-10-19T12-58-49-054Z\earendil-works-pi-coding-agent-1.1.0-to-1.3.0.diff` |
| pi-subagents | 0.76.1 | 0.79.1 | 0.79.1 | `C:\SOFT\git\ce-workflow\.pi\work-catch-up\2026-10-19T12-58-49-054Z\pi-subagents-0.76.1-to-0.79.1.changelog.md` | `C:\SOFT\git\ce-workflow\.pi\work-catch-up\2026-10-19T12-58-49-054Z\pi-subagents-0.76.1-to-0.79.1.diff` |
| pi-intercom | 0.16.1 | 0.17.1 | 0.17.1 | none | `C:\SOFT\git\ce-workflow\.pi\work-catch-up\2026-10-19T12-58-49-054Z\pi-intercom-0.16.1-to-0.17.1.diff` |
| pi-lens | 4.3.0 | 4.4.4 | 4.4.4 | none | `C:\SOFT\git\ce-workflow\.pi\work-catch-up\2026-10-19T12-58-49-054Z\pi-lens-4.3.0-to-4.4.4.diff` |

Several releases may lie between the last reviewed version and the target; review all of them, not only the newest notes. Start from the changelog excerpt (the CHANGELOG lines added across every intermediate release). The full diff (`npm diff` between the versions) can be very large: search it with rg for the files or APIs a change names instead of reading it whole. Without an excerpt, or when the diff starts with an error, read the changelog from the installed package or its GitHub releases.

Evidence notes from planning:
- The "Installed 1.1.0" for pi-coding-agent is the repo devDependency (`package.json` devDependencies). The running Pi is 1.3.0 (`C:\Users\Flex\.pi\agent\install\releases\1.3.0`).
- The pi-lens diff artifact is only an error (`spawnSync ... ETIMEDOUT`). pi-lens was reviewed from the installed `C:\Users\Flex\.pi\agent\npm\node_modules\pi-lens\CHANGELOG.md` (4.4.0 through 4.4.4).
- pi-intercom has no changelog. It was reviewed from the diff (README, `idle-wake.ts`, `types.ts`, `reply-tracker.ts`, `config.ts`) and the installed `index.ts`.
- Installed sources read: pi-subagents `src/shared/parent-wake.js`, `src/extension/index.js` (around line 1040, the compaction resume), `src/extension/subagent-options.js`, `src/extension/schemas.js`. Pi 1.3.0 `dist/core/agent-session.js` (`_prepareRun` around line 1449, `sendCustomMessage` and `_appendCustomMessage` around lines 1820 to 1858) and `docs/extensions.md`.

## How to review (planning)

1. For each target, list the changes in every release since the last reviewed version that could affect ce-workflow: Pi extension hooks/events/context, tool registration and exposure, commands, settings, SDK, TUI, model runtime; for plugins their tool schemas, lifecycle and skills. Skip unrelated trivia.
2. Understand before judging. When a change touches a feature or term you cannot explain from this repository (for example "codemode can now do X"), research it first: the package's README/docs/examples (Pi docs live in the installed package's docs/), its source in node_modules, context7, or the web. Put a one-line explanation of the feature in the decision rationale. Never grade a change you could not explain.
3. Map each change to this repository: search extensions/ and scripts/ for the affected API or feature and state what it would fix, delete, simplify or enable here — or why it does not apply.
4. Grade it: Adopt or Trial → status "adopted"; Reject or Not-our-problem → status "no-action". Hold is not allowed: when you cannot decide, ask the user with the tradeoff and your recommendation, and record the answer in Decisions.
5. Record every graded change in the Catch-up decisions JSON below (a package with nothing relevant gets one Not-our-problem decision saying so). For each adopted change, add a step to Phase 1 with its focused check; when nothing is adopted, replace the Phase 1 placeholder with "None — nothing adopted."

## Catch-up decisions

Fill during planning. Each entry: {"title", "pov": "Adopt|Trial|Reject|Not-our-problem", "status": "adopted|no-action", "rationale"}; adopted entries also need "verification" (the check command and its result), added when the step is done. The recorder fills in the version.

```json
{
  "@earendil-works/pi-coding-agent": [
    {
      "title": "before_agent_start also fires for sendMessage triggerTurn runs (messageType union)",
      "pov": "Adopt",
      "status": "adopted",
      "rationale": "1.2.0: runs started by pi.sendMessage(..., { triggerTurn: true }) now emit before_agent_start with messageType \"custom\" and the starting message, before that message's message_start (agent-session.js _prepareRun). work-models.ts:3721-3725 marks every before_agent_start as a user prompt (pendingPromptBackedAgentStart = true). A custom run is therefore treated as user work, and the internal background-notice guard (work-models.ts:3732-3760) never aborts it. The unit test in test-work-compaction-notifications.mjs (around line 197) still passes only because it replays the pre-1.2 order without before_agent_start. Today the guard covers only the retired knowledge discoverer (launchKnowledgeDiscoverer has no production caller), so the fix stays minimal: a custom run is not marked as prompt-backed, plus one 1.2-ordered unit case. Research-mode prompt sections now also reach custom runs, which is intended. advisor-model.ts, jev-tools.ts:511 and work-images.ts:267 work for both kinds. CU-03.",
      "verification": "node scripts/test-work-compaction-notifications.mjs: Pi 1.2-ordered custom-run case fails before the fix, passes after (commit 84a45f3)."
    },
    {
      "title": "Pin the devDependency types to the runtime 1.3.0",
      "pov": "Adopt",
      "status": "adopted",
      "rationale": "package.json devDependencies pins @earendil-works/pi-coding-agent 1.1.0 for editor and LSP types, while the runtime is 1.3.0. CU-03 reads event.messageType, which 1.1.0 types lack. The catch-up tool also reads this pin as 'Installed'. Bump it to 1.3.0 exactly and keep package-lock.json in sync. Dev-only; nothing ships at runtime. CU-04.",
      "verification": "npm install --save-dev --save-exact @earendil-works/pi-coding-agent@1.3.0: package.json and package-lock at 1.3.0; C2 passes after updating the assistant fixture for 1.3.0 estimateTokens (commits 1808861, bfee8bb)."
    },
    {
      "title": "Session counts as busy while a run starts; sendUserMessage needs deliverAs then; sendMessage queues into the starting run",
      "pov": "Not-our-problem",
      "status": "no-action",
      "rationale": "1.2.0: ctx.isIdle() is false during start and before_agent_start. A triggerTurn sendMessage in that window joins the starting run instead of failing with 'Agent is already processing'. plan3-web.ts:39-42 already sends steer when !ctx.isIdle(). work-models.ts:2730-2738 and plan3.ts:697 pass deliverAs. work-models.ts:2244 sends after compaction completes, from an idle session. Our triggerTurn wakes (work-camera-watch.ts:44, plan3-night.ts:66) gain the queueing fix with no change."
    },
    {
      "title": "Codemode: input-constraint tags, elapsed time, @options must be the first line, two-worker admission, node --watch bridge, quadratic text() join",
      "pov": "Not-our-problem",
      "status": "no-action",
      "rationale": "1.2.0 and 1.3.0 change how Pi declares and runs codemode scripts. ce-workflow never generates codemode scripts. Its tools (jev_*, process_image, generate_image) are called from scripts, and Pi generates their declarations from the existing schemas. Nothing to change."
    },
    {
      "title": "reachesTools and namespace aliases on tool definitions",
      "pov": "Not-our-problem",
      "status": "no-action",
      "rationale": "1.2.0: a tool that calls other tools may declare which ones a call can reach. The MCP extension uses this to wait for servers and to decide whether a replacement codemode or tool_search reaches MCP tools (docs/extensions.md). jev-tools.ts:469 runs only bash through ctx.executeTool and never MCP tools, so declaring it changes nothing."
    },
    {
      "title": "Model switching drops thinking from other models; serializeConversation omits thinking",
      "pov": "Not-our-problem",
      "status": "no-action",
      "rationale": "1.3.0 drops earlier models' thinking blocks on a model switch. 1.2.0 drops thinking from compaction and branch-summary serialization. The STRIP_THINKING filter (work-models.ts:1757, 1988) is a separate opt-in context experiment. Plan3 advisors run in fresh child sessions. No duplicate logic to delete, nothing to add."
    },
    {
      "title": "ctx.ui.custom overlay done() closes its own overlay",
      "pov": "Not-our-problem",
      "status": "no-action",
      "rationale": "1.3.0 fix: done() used to close the topmost overlay, which could leave another extension's dialog unresolved. The vendored ask_user overlays (extensions/ask-user/index.ts:543, 557) get the fix automatically. The repo has no workaround to remove."
    },
    {
      "title": "Resumed sessions keep their active tools",
      "pov": "Not-our-problem",
      "status": "no-action",
      "rationale": "1.3.0 restores tools activated during the session on resume. The only setActiveTools caller, plan3.ts:1270 (adds plan3_design), now survives a resume as intended."
    },
    {
      "title": "Provider, catalog, retry, MCP, OpenRouter, Kimi, Nix, config-schema, clipboard, /share, --model ambiguity, tool-argument parsing and print-mode fixes",
      "pov": "Not-our-problem",
      "status": "no-action",
      "rationale": "1.2.0 and 1.3.0 provider and runtime fixes and features owned by Pi. ce-workflow ships no themes or theme $schema, does not parse `pi mcp list`, and its scripts pass provider-qualified --model ids and use RPC mode, not -p. Benefits arrive automatically."
    }
  ],
  "pi-subagents": [
    {
      "title": "Idle-parent wake prompt text changed to 'Inspect subagent updates above. …'",
      "pov": "Adopt",
      "status": "adopted",
      "rationale": "0.77.0 rewrote PARENT_WAKE_TEXT (installed src/shared/parent-wake.js:1) to a longer instruction. work-compaction.ts:449-453 syntheticWakePrompt matches only the 0.76.1 text 'Subagent updates above.'. New wake prompts are therefore kept as protected user requests in compaction summaries and memory (work-compaction-memory.ts:62), which is the problem the 0.76.1 adoption fixed. Match the old and new exact texts, since old sessions still hold the old one. CU-01.",
      "verification": "node scripts/test-work-compaction.mjs: both the old and new wake texts are classified as synthetic (commit 9fda699)."
    },
    {
      "title": "Post-compaction resume now goes through the shared parent wake",
      "pov": "Adopt",
      "status": "adopted",
      "rationale": "0.77 and 0.78: when background runs are active and the parent is idle, pi-subagents appends the hidden 'Compaction is complete. Resume the parent task now…' message without a trigger, then wakes with PARENT_WAKE_TEXT as a user prompt (src/extension/index.js around line 1040). work-models.ts blocks the resume by its text. before_agent_start resets the block for the wake prompt (work-models.ts:3722), so the guard no longer works. The user decided to let pi-subagents resume: the guard existed for the removed ce-workflow goal loop (Decisions D1). Delete the compaction-resume guard and keep the summary-hygiene regex in work-compaction.ts. CU-02.",
      "verification": "node scripts/test-work-compaction-notifications.mjs: the input-hook regression case passes; live C5 with Pi 1.3.0 and openai-codex/gpt-6-luna passes (commit a1f357b)."
    },
    {
      "title": "subagent schema moves rare fields into options; launch by name with did-you-mean errors",
      "pov": "Adopt",
      "status": "adopted",
      "rationale": "0.77.0: the tool description now says to launch by name with an exact provider/id. Unknown agents or models fail with suggestions, so list and models are needed only on demand. Top-level management fields still work: subagent-options.js flattens them and schemas.js:44 allows extra properties. The launches in plan3.ts:563 and work-models.ts:1236 (context: \"fresh\") and the model:thinking suffix that advisor-model.ts sets need no change. The research advisor prompt (work-models.ts:491) still tells the model to call action:list capabilities:true and action:models first. Per Decisions D2, drop that clause and claim no savings. CU-05.",
      "verification": "node scripts/test-work-compaction-notifications.mjs asserts that the advisor prompt has no action:list or action:models (commit bfee8bb)."
    },
    {
      "title": "bg_wait and subagent_supervisor are declared only after delegation",
      "pov": "Not-our-problem",
      "status": "no-action",
      "rationale": "0.79.1 leaves these tools undeclared until subagent is enabled or other background work registers. Plan3 ideas, review and the research advisors call subagent (after subagents_enable) before any wait, which turns them on. No ce-workflow code calls or lists them."
    },
    {
      "title": "Forks reuse the parent prompt cache, get <subagent_instructions> and see parent context",
      "pov": "Not-our-problem",
      "status": "no-action",
      "rationale": "0.78.0 and 0.79.0 change only context: \"fork\" children. Every ce-workflow launch uses context: \"fresh\" (plan3.ts:563, work-models.ts:491, 1236)."
    },
    {
      "title": "Built-in reviewer, oracle and evidence-auditor skip the acceptance report unless acceptance is passed",
      "pov": "Not-our-problem",
      "status": "no-action",
      "rationale": "0.78.0. Research advisors use oracle for read-only critique and read its reply text. plan3-advisor is ce-workflow's own agent. Neither wants an acceptance report."
    },
    {
      "title": "Shared idle wake with pi-intercom; Esc keeps the parent stopped",
      "pov": "Not-our-problem",
      "status": "no-action",
      "rationale": "0.77 and 0.78: one wake reservation per session (Symbol.for(\"pi.idle-wake.v1\")), and completions after Esc no longer restart the parent. ce-workflow's own wakes use sendMessage triggerTurn, which Pi 1.2 queues into a starting run. Joining the reservation contract would add coupling to a private symbol for no observed problem."
    },
    {
      "title": "Handoff ownership, reuseFrom, finished-child resume, RPC snapshot fields, launcher sandboxes, program status, tmux inspector, parallel workflow, pinToolDeclarations, activeRunsPrompt, PI_SUBAGENTS_COMPONENT_UI, run-history removal, watchdog and runner fixes",
      "pov": "Not-our-problem",
      "status": "no-action",
      "rationale": "0.77.0 to 0.79.1 features and fixes inside pi-subagents. The hub runs Pi as `--mode rpc` (hub/src/rpc-client.ts:33) and renders ask_user forms, not custom TUI components, so PI_SUBAGENTS_COMPONENT_UI does not apply. Plan3 uses only fresh async advisors. The benefits arrive automatically."
    }
  ],
  "pi-intercom": [
    {
      "title": "Shared idle-wake reservation (idle-wake.ts); wake text unchanged",
      "pov": "Not-our-problem",
      "status": "no-action",
      "rationale": "0.17 moves the wake into a reservation shared with pi-subagents. The prompt is still 'New intercom message above.' (installed index.ts:1312), which work-compaction.ts already treats as synthetic. Nothing to change."
    },
    {
      "title": "Delivery receipts, E_SESSION_HELD, /intercom-pool, broker liveness drop, bare-reply targeting, Windows fsync fix",
      "pov": "Not-our-problem",
      "status": "no-action",
      "rationale": "0.17.x broker and protocol changes. ce-workflow's only integration, work-ask-remote.ts, emits intercom:outbox-request and reads intercom_message details.from.id and bodyText. Neither changed in the diff, and it does not read delivery results. No stableId or PI_INTERCOM_* use in the repo."
    }
  ],
  "pi-lens": [
    {
      "title": "4.4.0 to 4.4.4: Pi 1.2 and 1.3 support, unavailable or disabled LSP reported as unconfirmed, read-guard, cascade and performance fixes; tool surface unchanged",
      "pov": "Not-our-problem",
      "status": "no-action",
      "rationale": "Reviewed from the installed CHANGELOG.md because the diff artifact timed out. ce-workflow only names lens tools (read_symbol, read_enclosing, module_report, lens_diagnostics) for compaction classification (work-compaction.ts:237, 291-306; work-models.ts:1822). Those names and parameters are unchanged. Reporting a file no server answered for as unconfirmed matches the 4.3.0 decision not to treat inconclusive LSP results as clean. No local shim."
    }
  ]
}
```

## Decisions

- **D1 (user, 2026-10-19, ask_user)** Let pi-subagents resume after compaction. Remove ce-workflow's compaction-resume guard instead of adapting it to the 0.79.1 wake prompt. Rationale from the user: the guard existed because of the old ce-workflow goal loop, which is gone. Try without it and reintroduce it if problems appear.
- **D2 (user, 2026-10-19, ask_user)** Drop the "call subagent action:list capabilities:true and action:models before launching" clause from the research advisor prompt (work-models.ts:491). Add a small assertion. No benchmark and no savings claim, per the Optimization Regression Rule in AGENTS.md.
- **D3 (planning, evidence)** Keep the old wake text and add the new one as exact strings in syntheticWakePrompt. Old sessions hold the old text. Exact matching follows the existing approach.
- **D4 (planning, evidence)** Fix the before_agent_start regression minimally: only a run with messageType "custom" stays out of prompt-backed tracking. The retired knowledge-discoverer guard is not extended to the shared-wake path (no production caller). Deleting the dormant discoverer code is out of scope.
- **D5 (planning, evidence)** Keep the summary-hygiene regex for "Compaction is complete. Resume the parent task now" in work-compaction.ts. It keeps resume notes out of protected user requests and is unrelated to the removed turn guard.
- **Assumption (over 95%, evidence)** Bumping the devDependency to 1.3.0 is dev-only. Runtime resolution uses Pi's own install, and no packaged code imports the dev copy at runtime.

## Open questions

### Blocking

None.

### Deferred

None.

## Commands

- C1: `node scripts/test-work-compaction.mjs`
- C2: `node scripts/test-work-compaction-notifications.mjs`
- C3: `npm install --save-dev --save-exact "@earendil-works/pi-coding-agent@1.3.0"`
- C4: lens_diagnostics source=lsp scope=paths on `extensions/advisor-model.ts`, `extensions/jev-tools.ts` and `extensions/work-images.ts`. work-models.ts is over the LSP size limit, so do not count it as clean.
- C5 (live, optional): `node scripts/test-compaction-resume-idle.mjs --model <available provider/id>`, with PI_CLI set to `C:\Users\Flex\.pi\agent\install\releases\1.3.0\node_modules\@earendil-works\pi-coding-agent\dist\bundle\cli.js`
- C6: `npm run verify:quiet`
- C7: `node scripts/work-catch-up-record.mjs ffd99fd1`

## Phases

### Phase 1: Apply adopted changes [think]

- [x] **CU-01** syntheticWakePrompt matches the 0.76.1 and 0.77+ subagent wake texts plus intercom; tests cover the new text (failed before the fix).
- [x] **CU-02** Compaction-resume guard deleted from work-models.ts (input, before_agent_start, message_start, before_provider_request, settled, abort hide); live script no longer stubs the resume; C2 regression case added.
- [x] **CU-03** before_agent_start marks a run prompt-backed only when messageType !== "custom"; Pi 1.2-order knowledge-notice case added.
- [x] **CU-04** devDependency @earendil-works/pi-coding-agent pinned to 1.3.0; package-lock root and node_modules entry both 1.3.0.
- [x] **CU-05** Research advisor prompt drops the action:list/action:models pre-launch call; C2 asserts its absence. Also fixed a CU-04 fallout: pi 1.3.0 estimateTokens counts string-content assistant messages as 0, so the overflow fixture now uses array content.

### Phase 2: Verify and record [code]

- [x] **CU-89** Live C5 passed against Pi 1.3.0 with openai-codex/gpt-6-luna.
- [x] **CU-90** verify:quiet green except one environment-only live check: test-work-screen-read's attached-device branch fails on the non-phone device ingenic-serial (android CLI cannot screencap it); screen-read code untouched by this plan.
- [x] **CU-91** Catch-up baseline recorded for pi-coding-agent 1.3.0, pi-subagents 0.79.1, pi-intercom 0.17.1 and pi-lens 4.4.4; the adopted decisions now carry verification.
### P-ARCH [code] Product architecture

- [x] **ARCH-RECONCILE** Product diagram reconciled: only drift was the Pi host version label, updated 1.1.0 → 1.3.0 (CU-04); no components or connections added or removed by this plan.


## Acceptance

- Compaction summaries treat both the old and the new pi-subagents wake prompts as synthetic (C1).
- ce-workflow no longer handles, aborts or hides a post-compaction resume turn, shown by a dedicated C2 case. Knowledge-notice guard tests pass in both the pre-1.2 and the 1.2 event order (C2).
- The research advisor prompt no longer asks for action:list or action:models (C2).
- The devDependency pins 1.3.0, and the lockfile matches it.
- C6 passes, and C7 records 1.3.0, 0.79.1, 0.17.1 and 4.4.4 with verified adopted decisions.

## Resume context

Planning and review complete; decisions D1-D5 settled, review findings recorded in Amendments. Next: CU-01 (add the 0.77+ PARENT_WAKE_TEXT to syntheticWakePrompt in work-compaction.ts:449-453, extend test-work-compaction.mjs). No blockers or open questions. CU-89 live check needs model credentials and may be recorded as unavailable. Status stays draft until /plan3 finish.

## Amendments

- 2026-10-19: Generated by /wo → Catch up packages.
- 2026-10-19: Planning filled the decisions, Phase 1 (CU-01 to CU-05), the live check CU-89, Commands and Acceptance. The user answered D1 and D2.
- 2026-10-19 review (advisor openai-codex/gpt-6-astra:high):
  - Finding 1 (CU-02 removal has no regression test): accepted. Verified that C2 covers only knowledge notices and that CU-02 removes the only resume injection from the live script. Added a dedicated C2 case to CU-02 and tightened Acceptance.
  - Finding 2 (CU-90 verify:quiet conflicts with the AGENTS.md Test Scope Rule): partly accepted. Added a C1 and C2 rerun after the dependency bump in CU-04. Kept CU-90: the catch-up template generates it (extensions/plan3-catch-up.ts:115), it runs once at the end rather than after every edit, the previous catch-up recorded one full run in work-catch-up-baseline.json, and it is the only check that covers the hub suite and every test-work-* script after the lockfile change.
- 2026-10-19: Added final architecture reconciliation because a product diagram exists.
- 2026-10-20: Force-finished by the user.
