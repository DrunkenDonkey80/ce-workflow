---
plan3: true
status: complete
created: 2026-10-08
source: catch-up
catch-up: {"@earendil-works/pi-coding-agent":"1.1.0"}
updated: 2026-10-08T05:56:40.624Z
started: 2026-10-08T05:51:22.494Z
---

# Review Pi 1.1.0 compatibility and useful changes

## Original request

> Catch ce-workflow up with the new releases of the Pi packages it still uses: review every release after the last reviewed version up to the target, decide what helps or breaks this repository, apply what is adopted, then record the reviewed versions.

## Review targets

| Package | Last reviewed | Target | Installed | Changelog excerpt | Full diff |
|---|---|---|---|---|---|
| @earendil-works/pi-coding-agent | 1.0.4 | 1.1.0 | 1.0.4 | `C:\SOFT\git\ce-workflow\.pi\work-catch-up\2026-10-08T05-24-20-108Z\earendil-works-pi-coding-agent-1.0.4-to-1.1.0.changelog.md` | `C:\SOFT\git\ce-workflow\.pi\work-catch-up\2026-10-08T05-24-20-108Z\earendil-works-pi-coding-agent-1.0.4-to-1.1.0.diff` |

Several releases may lie between the last reviewed version and the target; review all of them, not only the newest notes. Start from the changelog excerpt (the CHANGELOG lines added across every intermediate release). The full diff (`npm diff` between the versions) can be very large: search it with rg for the files or APIs a change names instead of reading it whole. Without an excerpt, or when the diff starts with an error, read the changelog from the installed package or its GitHub releases.

## How to review (planning)

1. For each target, list the changes in every release since the last reviewed version that could affect ce-workflow: Pi extension hooks/events/context, tool registration and exposure, commands, settings, SDK, TUI, model runtime; for plugins their tool schemas, lifecycle and skills. Skip unrelated trivia.
2. Understand before judging. When a change touches a feature or term you cannot explain from this repository (for example "codemode can now do X"), research it first: the package's README/docs/examples (Pi docs live in the installed package's docs/), its source in node_modules, context7, or the web. Put a one-line explanation of the feature in the decision rationale. Never grade a change you could not explain.
3. Map each change to this repository: search extensions/ and scripts/ for the affected API or feature and state what it would fix, delete, simplify or enable here — or why it does not apply.
4. Grade it: Adopt or Trial → status "adopted"; Reject or Not-our-problem → status "no-action". Hold is not allowed: when you cannot decide, ask the user with the tradeoff and your recommendation, and record the answer in Decisions.
5. Record every graded change in the Catch-up decisions JSON below (a package with nothing relevant gets one Not-our-problem decision saying so). For each adopted change, add a step to Phase 1 with its focused check; when nothing is adopted, replace the Phase 1 placeholder with "None — nothing adopted."

## Catch-up decisions

Review covers the sole intervening release, **1.1.0 (2026-10-07)**. These are agent technical judgments from the sources below, not new user-approved scope expansions. `adopted` means selected for implementation, not already implemented. Add the Adopt entry's `verification` only after CU-93 passes; the recorder supplies `version`.

```json
{
  "@earendil-works/pi-coding-agent": [
    {
      "title": "agent_settled.aborted: fail cancelled RPC benchmark samples",
      "pov": "Adopt",
      "status": "adopted",
      "rationale": "1.1.0 adds a boolean identifying cancellation at final, notification-only settlement. runRpcSample currently advances options.prompts or requests final stats for every agent_settled (R1:1237–1262); cancellation without an assistant error can therefore become completed. Use event.aborted === true to return the existing fail('aborted', 'RPC sample aborted') before either success branch; preserve absent/false compatibility. Source: S1, S2:34–38/6279–6285, S3 docs/json.md, R1:1082–1085. CU-92/CU-93 implement the shared guard and fixture coverage.",
      "verification": "node \"scripts/test-workflow-evaluation-rpc.mjs\" — exit 0, ok - workflow evaluation RPC fixtures (5.3s); the same new cancellation assertion failed before the guard with completed vs failed. Covers true final/intermediate cancellation, explicit false and existing absent-flag success, retries and external abort."
    },
    {
      "title": "+name/-name CLI and SDK tool selection",
      "pov": "Reject",
      "status": "no-action",
      "rationale": "1.1.0 can modify startup defaults instead of replacing them; plain names still form an allowlist, and mixing names/modifiers or modifier globs now fails validation. Keep benchmark-image-strip-live.mjs, benchmark-reasoning-strip-live.mjs and R1:959 explicit tool allowlists: inherited defaults would change controlled experiments or broaden read-only scopes. No existing modifier call needs migration. Source: S1, S2:154–202/4511–4630, S3 docs/cli.md."
    },
    {
      "title": "Native durationMs on tool events/render context and persistent Took",
      "pov": "Reject",
      "status": "no-action",
      "rationale": "1.1.0 exposes execute-only monotonic milliseconds (absent when a tool did not run), and fixes built-in shell Took after reload. R3:2474–2485 still computes an event-to-event wall duration, but its sole caller at 31530 records activeWorkAgent, created for pendingWorkPrompt at 31371. Changing legacy workflow telemetry and historical comparability is not needed for the Plan3 path; retain it rather than turn this review into telemetry work. Built-in display fixes arrive automatically. Source: S1, S2:6260–6295, R3."
    },
    {
      "title": "outputPad in tool render context and wider transcript padding coverage",
      "pov": "Not-our-problem",
      "status": "no-action",
      "rationale": "1.1.0 passes horizontal transcript padding to renderers and applies it to tools, shell output, summaries and custom entries; self-shell renderers must apply it themselves. Repository extension search found no renderCall/renderResult/registerToolRenderer or outputPad consumers. Existing work-dialogs.ts overlays are separate UI components, not transcript tool renderers. No padding shim or dialog redesign. Source: S1, S2:4669–4737, S3 docs/tui.md and dist/core/extensions/types.d.ts."
    },
    {
      "title": "OSC 7501 program status reporting",
      "pov": "Not-our-problem",
      "status": "no-action",
      "rationale": "1.1.0 reports working, blocked on UI/login, done, error or idle to supporting terminals after capability negotiation; PI_PROGRAM_STATUS overrides detection. Pi owns the terminal and observes extension UI prompts. ce-workflow supplies dialogs, not an OSC dashboard, so do not emit a duplicate reporter or force a host setting. Real terminal support is unverified. Source: S1, S3 docs/terminal-setup.md#program-status."
    },
    {
      "title": "Claude Haiku 5.5 with adaptive effort and Bedrock caching",
      "pov": "Not-our-problem",
      "status": "no-action",
      "rationale": "1.1.0 adds an authenticated chat-model catalog entry and supported effort levels. Plan3 chooseAdvisors reads registry availability then filters the already-configured scope (R4:218–224); work-models.ts also uses the registry. Catalog availability is inherited, not a reason to change current model, saved role selections or benchmark defaults. Source: S1, S3 docs/models.md, R3/R4."
    },
    {
      "title": "GPT-6 Luna Decisions API and image classifier contexts",
      "pov": "Reject",
      "status": "no-action",
      "rationale": "1.1.0 offers typed classification via OpenAI and optional image blocks. Jev tools deliberately accept JSON/files and resolve only configured OpenRouter classifier IDs (R5:7/22–28); work-vision.ts already handles model vision separately. Adding providers, image inputs or screenshot adjudication would enlarge the requested scope without an acceptance use case. Luna uses API-key authentication, not ChatGPT login, so a provider swap is not drop-in. Source: S1, S3 docs/models.md#use-classifier-models and docs/codemode.md#classify, R5."
    },
    {
      "title": "Native llama.cpp decision models through /v1/systemone",
      "pov": "Reject",
      "status": "no-action",
      "rationale": "1.1.0 recognizes decision-model GGUF metadata on llama.cpp >=0.6.0, lists Julia-1/Laya/Kev/lev/OpenJev only as classifiers, and calls their native typed-decision endpoint; ordinary chat models can still classify via next-token probabilities. Pi supplies that discovery. Jev tools remain OpenRouter-only; no local backend, downloads or new configuration are needed. Plan3 chat availability comes from the existing registry, not a hand-maintained local-model list. Local hardware/server behavior is unverified. Source: S1, S3 docs/llama-cpp.md#classification, R4/R5."
    },
    {
      "title": "Codemode async discovery documentation and output boundaries",
      "pov": "Not-our-problem",
      "status": "no-action",
      "rationale": "1.1.0 marks searchTools/describeTool/describeNamespace as async and separates text outputs with ==> text N/M <== plus one console_output block. This fixes the model-visible built-in contract; ce-workflow does not implement those helpers or parse those presentation delimiters. benchmark-jev-live.mjs aggregates structured calls/usage, not these headings. No prompt-copy or parser workaround. Source: S1, S2:3080–3198/4738–4761, S3 docs/codemode.md, R6."
    },
    {
      "title": "MCP manager responsiveness, whole-login timeout, cancellation and shutdown fixes",
      "pov": "Not-our-problem",
      "status": "no-action",
      "rationale": "1.1.0 opens /mcp before every server connects and bounds the entire OAuth sign-in, aborts it on Esc/shutdown, caps each authorization request at 15s, and avoids refreshing tokens just to close. ce-workflow has no MCP login/manager implementation; controlled RPC invocation R1:943–955 disables discovered/built-in extensions and explicitly loads dependencies. Keep Pi-owned behavior; no extra OAuth or timeout layer. Source: S1, S3 docs/cli.md, R1."
    },
    {
      "title": "Managed release retention and standalone launch-directory environment loading",
      "pov": "Not-our-problem",
      "status": "no-action",
      "rationale": "1.1.0 pi update retains the new release and its immediate predecessor, and fixes standalone binaries loading .env/.env.local/.env.development from the launch directory. ce-workflow does not ship a standalone Pi binary; piReleaseRoots and Plan3 self-checks already search retained releases newest-first, not a fixed older directory. No installer/rollback automation or environment-file reliance is introduced. Runtime upgrades are outside this plan; review remains pinned to 1.1.0. Source: S1, R3:22850–22883, R2 scripts/test-work-plan3.mjs:539–545, package.json."
    },
    {
      "title": "Image-resize worker, ANSI chunk handling, dim shell headers and transcript selection fixes",
      "pov": "Not-our-problem",
      "status": "no-action",
      "rationale": "1.1.0 ignores Node worker housekeeping messages while resizing images under node --watch, fixes split ANSI codes in !/RPC bash output, preserves !! header dimming and clears fullscreen selection on transcript rebuilds. Pi owns those workers, shell components and transcript selection; work-vision.ts and payload stripping consume normal image/message blocks. No duplicate worker or ANSI parser. Current Node is 24.14.0; affected watch versions (24.19+/26.x) were not exercised. Source: S1, S2:72–131/3223–3313, R3."
    },
    {
      "title": "Provider thinking/headers, retryable errors, context estimation and tiered session costs",
      "pov": "Not-our-problem",
      "status": "no-action",
      "rationale": "1.1.0 honors OpenAI-on-Bedrock effort and Codex header overrides, retries server_busy/servers are currently busy and Mistral finish_reason:error, estimates input at 3.5 instead of 4 characters/token, filters disabled Radius models, and corrects prompt-length-tier costs across providers. ce-workflow delegates provider calls to the registry and aggregates supplied usage; the RPC runner waits for agent_settled across retries. Retain existing error/usage gates and context budgets. Historical reported costs may not be comparable; this is not evidence of a performance improvement. Source: S1, S3 docs/extensions.md, R1/R3 and scripts/test-work-usage.mjs."
    },
    {
      "title": "Anthropic free-loopback-port login, Herdr links and Termux clipboard fixes",
      "pov": "Not-our-problem",
      "status": "no-action",
      "rationale": "1.1.0 falls back from reserved port 53692 during Anthropic browser login (useful on Hyper-V/WSL Windows), fixes clickable Markdown links in Herdr, and repairs Termux paste/API hints. ce-workflow neither owns OAuth callback listeners nor terminal clipboard/link handling. Benefit is inherited from Pi; no UI redesign or platform workaround. These live integrations were not tested. Source: S1, S3 docs/terminal-setup.md."
    }
  ]
}
```

## Decisions

- **D-01 — Boundaries (user-approved).** Planning only, current agent/model, no delegation, legacy work items, goals, work_* tools, background verifiers, implementation, commits or pushes. Preserve unrelated dirty files, `plan3: true`, this exact path and stable step IDs; status stays draft until the user runs `/plan3 finish`. Source: current user request and research-mode contract.
- **D-02 — One release, fixed target (observed).** The installed target CHANGELOG has 1.1.0 immediately followed by 1.0.4; no intermediate published release is listed. Review the complete added 1.1.0 notes and relevant diff, not a newer catalog/release. Preserve the generated Installed=1.0.4 table as capture-time evidence: the managed 1.1.0 package/docs are present now, while direct repository `require.resolve` for the package fails. No dependency install/pin is required by the source change; `package.json` uses a wildcard Pi peer. Source: S1/S3 and planning evidence below.
- **D-03 — Smallest adopted change (agent technical judgment).** Reject Pi-reported aborted benchmark samples via the existing failure path; allow missing/false flags for older runtimes and fixtures. Explicit cancellation is a correctness signal, not an optimization. Source: S2, S3 docs/json.md, R1:1082–1085/1237–1262.
- **D-04 — Preserve product defaults (agent technical judgment).** No Haiku role switch, Luna/images/local classifier support, inherited benchmark tool sets, legacy telemetry rewrite, OSC reporter or TUI redesign. New capabilities alone do not justify code. Existing configured-model scopes, OpenRouter Jev JSON/file boundaries and shared dialogs remain unchanged. Source: Catch-up decisions and R3/R4/R5.
- **D-05 — Previously settled scope (prior user answer, not reopened).** Legacy wake-turn handling remains no-action; this catch-up does not re-enable the legacy workflow. Source: S4 Decisions, ask_user answer on 2026-10-06, “Legacy: no-action (recommended)”. This is not a blanket assertion that all legacy APIs are compatible.
- **D-06 — Verification and recording order (agent technical judgment).** Use the existing fake RPC fixture harness for red/green coverage; run explicit RPC/runner fixtures as the workflow-off package gate skips them. Add real Adopt verification only after implementation. Record only 1.1.0 using the existing Plan3 recorder after all gates pass; do not execute it in planning. Source: R1/R2/R7.
- No new user answers were needed: the adopted event guard follows the existing failure contract; optional scope expansions have been rejected rather than left implicit.
- **D-07 — Execution authorized (user, 2026-10-08).** The latest execute/resume request supersedes D-01's planning-only/draft boundary and authorizes CU-92 → CU-93 → CU-90 → CU-91 in this same agent/model. All no-delegation, no legacy work tools/background verifiers, no automatic commit/push and preservation requirements remain. Initial execution Git state: master, only this ready plan untracked; no tracked product changes. Existing settlement code still lacks the cancellation guard, so implementation is not already complete.


## Open questions

### Blocking

None.

### Deferred

None.

## Affected files and non-goals

| File | Smallest intended change |
|---|---|
| `C:\SOFT\git\ce-workflow\scripts\workflow-evaluation-rpc.mjs` | Guard `runRpcSample` settlement cancellation using the existing `fail` helper. One shared fix; callers inherit the existing failure shape. |
| `C:\SOFT\git\ce-workflow\scripts\test-workflow-evaluation-rpc.mjs` | Extend in-memory `fakeProcess` cases; no new fixture files, dependencies or harness. |
| `C:\SOFT\git\ce-workflow\extensions\work-catch-up-baseline.json` | Recorder-only target review metadata/decisions after verification. |
| `C:\SOFT\git\ce-workflow\docs\plans\2026-10-08-catch-up-pi-packages-b00e42e8-plan3.md` | Durable decisions, ordered pending steps and later actual check results. |

Read-only consumers/coverage: `C:\SOFT\git\ce-workflow\scripts\workflow-evaluation.mjs` and its runner fixture test. No export, signature, manifest, lockfile or new configuration change is planned. Existing jiti loading and `.ts` extension imports stay intact.

Non-goals: runtime/package installation; packages beyond this target; new model/backend/image features; legacy workflow repair/activation; prompt/skill changes; paid campaigns; version bump; commit/push. No new/substantially redesigned web UI: frontend-design is not applicable. Native/TUI behavior and `C:\SOFT\git\ce-workflow\extensions\work-dialogs.ts` remain unchanged. Live provider/terminal/local-server proof is outside acceptance, not a deferred adoption choice.

## Phases

### Phase 1 — Apply adopted changes

Only one compatibility change is selected. CU-92 precedes CU-93; IDs retain their original identity despite numeric order. All check descriptions below are future implementation gates, not planning PASS claims.

  - note: Reconciled actual code, fixture harness and caller search; adding red/green cancellation cases to the existing offline fake-process test.
- [x] **CU-92** Extend the existing RPC fixtures with Pi-reported cancellation, normal settlement and backward-compatible settlement cases; show the new cancellation assertion fails before the guard. Check: node "scripts/test-workflow-evaluation-rpc.mjs".
  - In R2 reuse `fakeProcess`, `classify` and `expectFailure`; no new harness or paid provider calls. Cover `{type:"agent_settled",aborted:true}` with otherwise valid stats and no assistant error, both final-prompt and intermediate-prompt cancellation. Assert `status:"failed"`, `failure:"aborted"`, no success-only stats request (`id:"stats"`; initial stats are allowed), and no dispatch of the next prompt. Retain external AbortController/timeout tests and successful absent-flag fixtures; add an explicit `aborted:false` success fixture.
  - Red check: the current unguarded implementation must fail the new cancellation assertion; diagnose unrelated fixture failures instead of claiming a useful red result. Record that actual command/output on CU-92.
  - note: Added explicit false success and true cancellation cases for one/two prompts in the existing fake-process harness. Assertions cover failure shape, preserved usage/events, no next prompt and no final stats. New cancellation regression fails before the guard as required.
  - check: node "scripts/test-workflow-evaluation-rpc.mjs" — exit 1, AssertionError at expectFailure:866 / cancellation case:876, actual completed vs expected failed; Node v24.14.0. This is the intended red regression, not a passing product gate.
- [x] **CU-93** Handle agent_settled.aborted === true in runRpcSample with the existing aborted failure path before dispatching another prompt or requesting final stats; rerun the RPC fixtures and record the Adopt decision's verification. Check: node "scripts/test-workflow-evaluation-rpc.mjs".
  - In R1 add the narrow guard at the start of the `agent_settled` branch and return the existing `fail("aborted", "RPC sample aborted")`. Do not introduce statuses, schema fields, event subscriptions or a general lifecycle wrapper. Preserve retry settlement, cleanup, provenance, initial usage and older Pi events that omit `aborted`.
  - Green check: the same fixture command exits 0 with `ok - workflow evaluation RPC fixtures`; paste the actual result into the Adopt entry's `verification` and mark the step through Plan3. Probe changed `.mjs` paths with active LSP diagnostics if supported; unavailable coverage is not a clean result.
  - note: Apply the narrow guard to the shared settlement branch, then rerun the same fixtures.
  - note: Added only the event.aborted === true guard before both settlement success branches, using the existing aborted failure path; no public signature/status/config change. Adopt JSON now has actual green verification. Active diagnostic scan covered both changed .mjs files; two pre-existing Semgrep child_process findings at 897/910, untouched by the one-line production diff; not reported clean.
  - check: node "scripts/test-workflow-evaluation-rpc.mjs" — exit 0, ok - workflow evaluation RPC fixtures, 5.3s. lens_diagnostics source=lsp scope=paths (both changed .mjs, waitMs=2000): supported, 2 existing auxiliary Semgrep errors in defaultSpawn/terminate, no new-line finding. git diff confirmed only the settlement guard changes production.

### Phase 2 — Verify and record

- [x] **CU-90** Run `npm run verify:quiet` after the adopted changes and record the result.
  - Also run `node "scripts/test-workflow-evaluation-rpc.mjs"` explicitly: the package gate skips workflow-evaluation fixtures when the legacy workflow is off. Run `node "scripts/test-workflow-evaluation-runner.mjs"` for the immediate failed-sample consumer. Keep the workflow off; do not change saved settings. Require exit 0 and preserve failures for diagnosis. No E2E benchmark/optimization claim is made by these fixtures.
  - note: Next run the existing runner fixture then npm run verify:quiet with CE_WORKFLOW_ENABLED=0; no saved setting changes or live campaigns. RPC final-code fixture is already green.
  - note: All required current-code gates passed sequentially. Package runner deliberately skipped workflow-only suites; explicit RPC and runner fixture commands covered the adopted benchmark path without enabling the workflow or running live providers.
  - check: node "scripts/test-workflow-evaluation-rpc.mjs" — exit 0, ok - workflow evaluation RPC fixtures (5.3s); node "scripts/test-workflow-evaluation-runner.mjs" — exit 0, ok - workflow evaluation smoke and decision lifecycle fixtures (1.9s); CE_WORKFLOW_ENABLED=0 npm run verify:quiet — exit 0, ok - package checks passed. Workflow-only/background-verifier suites skipped by the existing gate, as requested.
- [x] **CU-91** Record the reviewed versions: `node "scripts/work-catch-up-record.mjs" b00e42e8`. It writes exactly the target versions above (not newer releases) into `extensions/work-catch-up-baseline.json` and refuses missing, unexplained or unverified decisions.
  - After CU-93 and CU-90 pass, use the exact existing command `node "scripts/work-catch-up-record.mjs" b00e42e8`. Never run it during planning. Inspect the baseline diff: only this package's version/reviewedVersion/reviewedAt/decisions and capturedAt change; target stays exactly 1.1.0 and all other package records are preserved. Then run `node "scripts/test-work-plan3.mjs"` for recorder/Plan3 regression coverage. Review `git status --short` and `git diff --stat`; leave unrelated dirty files and all commits/pushes alone.
  - note: Verification passed and Adopt evidence persisted; now record pinned target 1.1.0, compare baseline against saved pre-run contents, then run Plan3 self-check.
  - note: Recorded exactly Pi 1.1.0 with 14 graded decisions and verified Adopt evidence. Compared parsed baseline with the pre-run snapshot: only capturedAt and the target's version/reviewedAt/reviewedVersion/decisions changed; all other packages and top-level metadata identical. Post-record Plan3 check and whitespace diff check passed.
  - check: node "scripts/work-catch-up-record.mjs" b00e42e8 — exit 0, recorded: @earendil-works/pi-coding-agent@1.1.0; codemode JSON comparison — target version/reviewedVersion 1.1.0, 14 decisions all pinned, Adopt verified, unrelated records preserved=true; node "scripts/test-work-plan3.mjs" — exit 0, Plan3 command self-checks passed (2.0s); git diff --check — exit 0. git status showed only the planned baseline/RPC source/test and plan.

## Global acceptance

- Every relevant 1.1.0 feature/change/fix is graded with explanation, repository mapping and retained source. No Hold, empty decision array or unexplained rejection.
- Given valid RPC provenance and stats but `{type:"agent_settled",aborted:true}` without an assistant error, return `status:"failed", failure:"aborted"`, never completed. Intermediate cancellation does not dispatch the next prompt; final cancellation does not request success stats (`id:"stats"`).
- `aborted:false` and an absent flag retain normal completion; automatic-retry, external-abort, timeout, provider-error, malformed-stream, provenance and missing-usage fixtures continue passing. Preserve cleanup, initial usage and captured events.
- The new cancellation assertion demonstrably fails without the guard and passes with it using the same existing RPC command. Adopt verification contains that actual result, not today's planning baseline.
- Explicit RPC/runner checks and `npm run verify:quiet` pass with workflow off; probe active diagnostics on supported changed paths without treating absent coverage as clean.
- Recorder output is exactly `recorded: @earendil-works/pi-coding-agent@1.1.0`; baseline only changes the targeted review record and capture timestamp. Plan3 self-check passes afterward; all other package entries/files are preserved.
- No automatic commit/push, branch change, legacy execution, new model default or implementation during planning. No performance/cost improvement is asserted from focused tests.

## Sources and planning evidence

Source aliases (primary local artifacts):

- **S1** — Complete release excerpt: `C:\SOFT\git\ce-workflow\.pi\work-catch-up\2026-10-08T05-24-20-108Z\earendil-works-pi-coding-agent-1.0.4-to-1.1.0.changelog.md`. Retains upstream issues/PRs: #10607 (settlement/status), #10549 (duration), #10557 (padding), #10382 (local decisions), and all other original references.
- **S2** — Captured npm diff: `C:\SOFT\git\ce-workflow\.pi\work-catch-up\2026-10-08T05-24-20-108Z\earendil-works-pi-coding-agent-1.0.4-to-1.1.0.diff`. Relevant non-minified hunks searched/read; no whole-bundle review claimed.
- **S3** — Target root `C:\Users\Flex\.pi\agent\install\releases\1.1.0\node_modules\@earendil-works\pi-coding-agent\`: package.json version 1.1.0; CHANGELOG.md:3/55 boundaries; README and complete docs/extensions.md, docs/tui.md, docs/cli.md, docs/codemode.md, docs/models.md, docs/llama-cpp.md, docs/terminal-setup.md, docs/json.md and docs/rpc.md. Exact API additions: dist/core/extensions/types.d.ts in S2:6260–6295. Registry availability facade: dist/core/model-registry.js:18–23/81–95.
- **S4** — Prior review: `C:\SOFT\git\ce-workflow\docs\plans\done\2026-10-06-catch-up-pi-coding-agent-1-0-4-pi-subagents-0-76-1-pi-interc-45682eea-plan3.md`.
- **R1** — `C:\SOFT\git\ce-workflow\scripts\workflow-evaluation-rpc.mjs`:914 runRpcSample; :959 tools; :1073–1085 existing failure/abort; :1237–1262 settlement success.
- **R2** — `C:\SOFT\git\ce-workflow\scripts\test-workflow-evaluation-rpc.mjs`:612–671 fake child/writes; :673–704 successful absent-flag settlement; :847–868 classify/expectFailure; :988–998 stats/timeout/external-abort.
- **R3** — `C:\SOFT\git\ce-workflow\extensions\work-models.ts`:2474/31530 timing; :31371 active legacy run; :22850–22883 release discovery; :31918 settlement hook; registry-based selectors. Reading hooks does not authorize legacy tools.
- **R4** — `C:\SOFT\git\ce-workflow\extensions\plan3.ts`:218–224 configured advisor scope/availability.
- **R5** — `C:\SOFT\git\ce-workflow\extensions\jev-tools.ts`:7/22–28 configuration and :184/358 classification; existing vision handling in `C:\SOFT\git\ce-workflow\extensions\work-vision.ts`.
- **R6** — `C:\SOFT\git\ce-workflow\scripts\benchmark-jev-live.mjs`:483–488 structured usage/call fixtures. Controlled tool callers: `C:\SOFT\git\ce-workflow\scripts\benchmark-image-strip-live.mjs`:143 and `C:\SOFT\git\ce-workflow\scripts\benchmark-reasoning-strip-live.mjs`:208.
- **R7** — `C:\SOFT\git\ce-workflow\extensions\plan3-catch-up.ts`: recordCatchUp validates target/graded decisions/verification and writes baseline; `C:\SOFT\git\ce-workflow\scripts\work-catch-up-record.mjs` is its CLI. `C:\SOFT\git\ce-workflow\scripts\verify-package.mjs`:551–609 workflow-off test selection. `C:\SOFT\git\ce-workflow\scripts\test-work-plan3.mjs` covers recorder and loads managed SDK roots newest-first.

Actually executed during planning (baseline only):

| Command | Result |
|---|---|
| `git status --short`, `git branch --show-current` | master; only this draft plan untracked at initial/follow-up probes. |
| `node --version` | v24.14.0. |
| `node -p "require.resolve(\"@earendil-works/pi-coding-agent/package.json\")"` | MODULE_NOT_FOUND from repository; managed target package separately present. No install attempted. |
| `node "scripts/test-workflow-evaluation-rpc.mjs"` | Exit 0; `ok - workflow evaluation RPC fixtures` (4.6s). Does not cover Pi-reported cancellation; not Adopt verification. |
| `node "scripts/test-work-plan3.mjs"` | Exit 0; `Plan3 command self-checks passed` (12.2s). |

Unavailable/not run: proposed cancellation regression; full package gate; runner fixture; recorder; diagnostics for implemented changes; live billing/authentication, OSC/Herdr/Termux, newer-Node image watch or local llama.cpp. No live compatibility/performance proof. Older environment observations in archived decisions are source-reported, not revalidated today.
### Execution verification (2026-10-08; supersedes planning-only availability notes)

- Re-read entire ready plan; release excerpt, relevant npm diff AgentSettledEvent hunk, target docs/json.md and docs/rpc.md, current runRpcSample/fixture helpers, sole production consumer, recorder source/CLI, package test selector and baseline. Confirmed actual master state, no prior guard, and fixed target contract. Planning-only evidence above remains historical, not implementation proof.
- CU-92 red: `node "scripts/test-workflow-evaluation-rpc.mjs"` exited 1 at new cancellation case; actual completed versus expected failed.
- CU-93 green: same command exited 0 (`ok - workflow evaluation RPC fixtures`, 5.3s) on final source/test state; covers cancelled final/intermediate prompts and normal false/absent settlements. No further source/test edits followed.
- `node "scripts/test-workflow-evaluation-runner.mjs"`: exit 0, smoke and decision lifecycle fixtures (1.9s).
- `CE_WORKFLOW_ENABLED=0 npm run verify:quiet`: exit 0, `ok - package checks passed`; existing selector skipped workflow-only/background-verifier suites. Explicit RPC/runner fixtures covered the changed path. No saved settings changed or workflow activated.
- Active `lens_diagnostics` on both changed `.mjs` paths: supported scan; test file clean; production has two pre-existing auxiliary Semgrep child_process findings at 897/910 in unchanged defaultSpawn/terminate. One-line production diff proves these wrappers are untouched. Neither suppressed nor claimed clean; no new-line diagnostic.
- Recorder: exit 0, `recorded: @earendil-works/pi-coding-agent@1.1.0`. Semantic baseline comparison found only capturedAt and target version/reviewedAt/reviewedVersion/decisions changed; all other package records and metadata identical. All 14 decisions pinned to1.1.0, Adopt verification present.
- Post-record `node "scripts/test-work-plan3.mjs"`: exit 0, `Plan3 command self-checks passed` (2.0s); `git diff --check`: exit 0. These cover the final baseline input change; no product edits afterward.
- Global acceptance satisfied using fixtures and recorded metadata. Live provider/terminal/local-server integrations and E2E performance remain outside approved acceptance. No optimization claim, delegated work, legacy work tools, background verifiers, commits or pushes.


## Resume context

All four steps complete with current execution evidence: cancellation regression red then green, explicit runner fixtures, workflow-off package gate, pinned1.1.0 recorder, target-only semantic baseline comparison, post-record Plan3 self-check and git diff --check. No further implementation action. Complete status archives this plan under docs/plans/done using the same original filename and plan3:true. Only planned product files changed; no commits/pushes or unrelated-file edits. Remaining disclosed risks: two pre-existing subprocess Semgrep findings; no paid/live provider, terminal or local-server checks. These are outside approved acceptance, not open decisions.

## Amendments

- 2026-10-08: Generated by /wo → Catch up packages.
- 2026-10-08: Added CU-92, CU-93 after CU-91: Pi 1.1.0 adds an explicit cancellation flag; source review found runRpcSample currently treats all agent_settled events as successful settlement.
- 2026-10-08: Completed release/API/repository research; graded all relevant 1.1.0 changes; selected only RPC cancellation handling; moved CU-92/CU-93 to Phase 1; recorded references and planning-only baseline checks. Preserved original request, targets, artifacts and CU-90/CU-91.
- 2026-10-08: Latest user authorized execution. Reconciled ready plan with master/untracked-plan-only Git state and actual unguarded settlement code; reproduced completed-vs-failed cancellation regression, then fixed it in the shared branch and added true/false/absent compatibility fixtures. Scope unchanged; two unchanged subprocess Semgrep findings retained as disclosed pre-existing findings, not suppressed.
- 2026-10-08: Completed all adopted implementation/verification/recording steps. Exact target 1.1.0 recorded; all unrelated baseline records preserved. Final product validation passed with legacy workflow off plus explicit RPC/runner fixtures and post-record Plan3 self-check. No scope expansion or automatic commit/push.
