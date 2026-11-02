---
plan3: true
status: ready
created: 2026-11-02
source: catch-up
catch-up: {"pi-subagents":"0.84.0","pi-ask-user":"0.17.2","pi-lens":"4.4.8"}
updated: 2026-11-02T07:07:37.557Z
reviewed: 2026-11-02
---

# Catch up pi-subagents 0.84.0, pi-ask-user 0.17.2, pi-lens 4.4.8

## Original request

> Catch ce-workflow up with the new releases of the Pi packages it still uses: review every release after the last reviewed version up to the target, decide what helps or breaks this repository, apply what is adopted, then record the reviewed versions.

## Review targets

| Package | Last reviewed | Target | Installed | Changelog excerpt | Full diff |
|---|---|---|---|---|---|
| pi-subagents | 0.81.0 | 0.84.0 | 0.79.1 | `C:\SOFT\git\ce-workflow\.pi\work-catch-up\2026-11-02T06-27-48-637Z\pi-subagents-0.81.0-to-0.84.0.changelog.md` | `C:\SOFT\git\ce-workflow\.pi\work-catch-up\2026-11-02T06-27-48-637Z\pi-subagents-0.81.0-to-0.84.0.diff` |
| pi-ask-user | 0.17.0 | 0.17.2 | not installed | none | `C:\SOFT\git\ce-workflow\.pi\work-catch-up\2026-11-02T06-27-48-637Z\pi-ask-user-0.17.0-to-0.17.2.diff` |
| pi-lens | 4.4.4 | 4.4.8 | 4.4.8 | `C:\SOFT\git\ce-workflow\.pi\work-catch-up\2026-11-02T06-27-48-637Z\pi-lens-4.4.4-to-4.4.8.changelog.md` | `C:\SOFT\git\ce-workflow\.pi\work-catch-up\2026-11-02T06-27-48-637Z\pi-lens-4.4.4-to-4.4.8.diff` |

Installed versions: the 0.79.1 pi-subagents is the repo's peer auto-install (`node_modules`, lockfile). The Pi installs on Windows (`~/.pi/agent/npm`) and in WSL x1600 run pi-subagents 0.84.0 and pi-lens 4.4.8 (checked 2026-11-02).

Several releases may lie between the last reviewed version and the target; review all of them, not only the newest notes. Start from the changelog excerpt (the CHANGELOG lines added across every intermediate release). The full diff (`npm diff` between the versions) can be very large: search it with rg for the files or APIs a change names instead of reading it whole. Without an excerpt, or when the diff starts with an error, read the changelog from the installed package or its GitHub releases.

## How to review (planning)

1. For each target, list the changes in every release since the last reviewed version that could affect ce-workflow: Pi extension hooks/events/context, tool registration and exposure, commands, settings, SDK, TUI, model runtime; for plugins their tool schemas, lifecycle and skills. Skip unrelated trivia.
2. Understand before judging. When a change touches a feature or term you cannot explain from this repository (for example "codemode can now do X"), research it first: the package's README/docs/examples (Pi docs live in the installed package's docs/), its source in node_modules, context7, or the web. Put a one-line explanation of the feature in the decision rationale. Never grade a change you could not explain.
3. Map each change to this repository: search extensions/ and scripts/ for the affected API or feature and state what it would fix, delete, simplify or enable here — or why it does not apply.
   For pi-ask-user, compare the target release index.ts and single-select-layout.ts with extensions/ask-user/. Read extensions/ask-user/UPSTREAM.md; port relevant changes into our vendored copy, preserve the native single/batch remote-answer race and D12 coexistence behavior, update its pinned version/provenance, and verify terminal popup and remote-answer tests. Do not patch or overwrite the installed upstream package.
4. Grade it: Adopt or Trial → status "adopted"; Reject or Not-our-problem → status "no-action". Hold is not allowed: when you cannot decide, ask the user with the tradeoff and your recommendation, and record the answer in Decisions.
5. Record every graded change in the Catch-up decisions JSON below (a package with nothing relevant gets one Not-our-problem decision saying so). For each adopted change, add a step to Phase 1 with its focused check; when nothing is adopted, replace the Phase 1 placeholder with "None — nothing adopted."

## Catch-up decisions

Each entry: {"title", "pov": "Adopt|Trial|Reject|Not-our-problem", "status": "adopted|no-action", "rationale"}; adopted entries also need "verification" (the check command and its result), added when the step is done. The recorder fills in the version.

```json
{
  "pi-subagents": [
    {
      "title": "Subagent notices moved from the context hook to context_with_system so tool and prompt changes keep the prompt cache (0.83.0, #3058, #3063)",
      "pov": "Trial",
      "status": "adopted",
      "rationale": "In Pi 1.4, when a `context` handler returns a changed message list, Pi merges every mid-conversation system message (prompt-section and toolsAdded/toolsRemoved updates) into one leading system message (runner.js restoreSystemMessages). Each tool change then rewrites the start of the prompt and the whole cache misses. Without the merge, pi-ai sends the change to Claude as appended tool_addition blocks and the cache holds (anthropic-messages.js:1055-1080). pi-subagents fixed this for itself; the installed 0.84.0 already has the fix. ce-workflow's three `context` handlers (work-models.ts:3796-3798: vision bridge, filteredContext with the durable-knowledge append, compactionNoteNudge) change the list on most turns and so force the merge. In x1600 session 01a19840, 4 of 6 cache misses not explained by idle time or compaction came right after a tool change (about 0.6M cache-write tokens in 86 turns). Trial per D1: CU-10 to CU-13."
    },
    {
      "title": "subagent:jobs-changed event and asyncStarted/jobsChanged in the RPC ping (0.83.0, #3068)",
      "pov": "Reject",
      "status": "no-action",
      "rationale": "The event tells host views to re-read status on any background run change. plan3-web.ts:155-171 already re-reads on async-started, async-complete and child-status, and polls every 3 s while a run is active; the peer floor (>=0.75.0) keeps that poll needed. The event would only shorten a 3 s delay on chain-step changes nobody reported."
    },
    {
      "title": "Workflow script sandbox fix GHSA-6v8j-6w28-2w8r; runs.run single-object form rejected (0.84.0, 0.83.1)",
      "pov": "Not-our-problem",
      "status": "no-action",
      "rationale": "Workflow scripts can no longer set Error.prepareStackTrace or call import(). ce-workflow's only script is built by spawnSubagentRpc (work-models.ts:2458-2479, used by the retired knowledge discoverer): runs.run(\"main\", task), with no import() and no stack hooks. The Windows and x1600 Pi installs run 0.84.0. The repo's 0.79.1 is a peer auto-install that is never loaded as an extension (test-work-native-smoke.mjs:90 prefers the Pi install), so no lockfile bump and no peer-floor raise."
    },
    {
      "title": "Agent frontmatter: blank lines inside indented blocks, quoted names, +name/-name tool entries and thinking levels validated (0.82.0 to 0.83.1)",
      "pov": "Not-our-problem",
      "status": "no-action",
      "rationale": "utility-agents/context-knowledge-discoverer.md, diff-reviewer.md and plan3-advisor.md use plain comma tool lists, thinking low or high, and no blank lines inside blocks, so every file parses the same as before."
    },
    {
      "title": "Other 0.82.0 to 0.84.0 changes",
      "pov": "Not-our-problem",
      "status": "no-action",
      "rationale": "Workflow auto-resume after a Pi exit, foreground run history and resume by id, Rex and Herdr placement, boot-id process liveness, bg_wait matching by session id, interrupt without id refused, mission completion needing a checked result, capability ceilings keyed by session id, background runs deleted after 90 days, a missing-provider diagnostic, final-reply drain fixes, a smaller bundled skill and an undici update. ce-workflow spawns with mission:false, registers no capability ceilings, uses no machine placement and never calls interrupt (rg over extensions/ and hub/src/), so nothing changes here; the fixes help users without code changes."
    }
  ],
  "pi-ask-user": [
    {
      "title": "Top-level context, options, allowMultiple and allowFreeform sent with questions are ignored instead of an error (0.17.2, #88)",
      "pov": "Adopt",
      "status": "adopted",
      "rationale": "Upstream dropped the BATCH_ENTRY_FIELDS check because models that echo schema defaults looped on the validation error. Our copy still throws it (extensions/ask-user/index.ts:226, 2619-2623, which also lists initialText). No local or x1600 session hit it yet, but the change is a deletion that removes a retry trap and a divergence from upstream. CU-01."
    },
    {
      "title": "Single-select rows wrap by terminal columns with pi-tui wrapTextWithAnsi (0.17.2)",
      "pov": "Adopt",
      "status": "adopted",
      "rationale": "single-select-layout.ts wrapText counts UTF-16 length, so emoji and CJK options overflow the row width; upstream replaces the 40-line word wrapper with pi-tui's column-aware wrapTextWithAnsi, which index.ts already imports from for truncation. A deletion that fixes wide-character rows. CU-02."
    },
    {
      "title": "Tern sheet docked in the composer, shortLabel tab labels, README wording (0.17.1, 0.17.2)",
      "pov": "Reject",
      "status": "no-action",
      "rationale": "Tern support was not ported in the 0.17.0 review (UPSTREAM.md); shortLabel only serves Tern tabs and review keys. ce-workflow targets the terminal and the hub."
    }
  ],
  "pi-lens": [
    {
      "title": "Background git status reads set GIT_OPTIONAL_LOCKS=0 so they never hold or orphan .git/index.lock (4.4.7, #4930)",
      "pov": "Adopt",
      "status": "adopted",
      "rationale": "git status takes .git/index.lock for an optional index refresh; a concurrent git add or commit then fails with \"index.lock: File exists\", and a killed status can leave the lock behind. pi-lens fixed its own reads. The hub polls git status per session folder every 4 s with a 5 s timeout (hub/src/api.ts:76) and in the Files view (hub/src/files.ts:10-18), without that variable. x1600 session logs hold 14 such failures (10 in 01a155ad, 4 in 01a193d1, latest 2026-11-01). The cause of each is unproven; adopted without diagnosis (D5). CU-04."
    },
    {
      "title": "tools.lazy \"auto\" and --lens-retain-injections for prompt caches on folding models (4.4.5)",
      "pov": "Not-our-problem",
      "status": "no-action",
      "rationale": "User options in pi-lens config. They work around the same merge as the pi-subagents Trial entry, which ce-workflow's own context handlers trigger; that trial fixes it at the source."
    },
    {
      "title": "Tool surface: path is the one single-file parameter, ast_grep_outline and symbol_search return compact text, lens_diagnostics says inconclusive instead of clean (4.4.5 to 4.4.8)",
      "pov": "Not-our-problem",
      "status": "no-action",
      "rationale": "ce-workflow only classifies lens tools by name and reads args.path and args.paths (work-compaction.ts:281-290, 356-359; work-models.ts:1828-1834); it parses no lens output. The tool names did not change, and inconclusive-not-clean matches the 4.3.0 decision."
    },
    {
      "title": "Other 4.4.5 to 4.4.8 changes",
      "pov": "Not-our-problem",
      "status": "no-action",
      "rationale": "Commit-gate (--lens-guard) record ownership and quoting, per-session blockers and read guards for in-process subagents, LSP root, cascade and freshness fixes, trust-gated command lookup, dispatch.disabledRunners, opt-in fallow and effect-tsgo servers, formatter and linter no-fix flags, and the pi 0.86.1 host floor (the host runs 1.4.0). None has a ce-workflow code path."
    }
  ]
}
```

## Decisions

- **D1 (user, 2026-11-02)**: Trial the cache-safe context handlers in this plan. Add a [think] design phase and a [code] phase, measure cache misses and cost against the current baseline, and revert if it regresses. Rationale: the cache-miss mechanism is confirmed in Pi 1.4 and pi-ai source and matches x1600 logs, but it is a redesign, so the repo's Optimization Regression Rule requires an end-to-end benchmark. Source: ask_user answer "Trial in this plan (recommended)".
- **D2 (assumption, over 95% from source)**: pi-ai's `getCurrentSystemMessage` is the merge Pi itself uses (runner.js:4, 104). Whether an extension can import it is checked in CU-10 and is not yet confirmed.
- **D3**: The hub change covers only the hub's own periodic git reads (api.ts readGit, the files.ts helper). plan3.ts:612 runs one git status per Plan3 action and stays as it is.
- **D4 (user, 2026-11-02, was Q-01)**: The live cache benchmark (CU-11, CU-13) uses the default Claude model with 2 repetitions per side. Default model on Windows and x1600: anthropic/claude-opus-5-5, thinking high (~/.pi/agent/settings.json, checked 2026-11-02).
  - Context: The mid-conversation tool_addition path that keeps the cache exists for Claude in pi-ai, so the benchmark needs a Claude model. The Optimization Regression Rule needs the same benchmark before and after, with runtime, tokens, cost, turns and tool calls compared. Existing live benchmarks (scripts/benchmark-reasoning-strip-live.mjs) take a --model and --repetitions.
  - Recommendation: The user's default Claude model, a short scripted session that enables one situational tool mid-way, 2 repetitions per side (roughly 1–2M mostly cached tokens in total).
  - Option: Default Claude, 2 repetitions — enough to see a full miss per tool change; small spend.
  - Option: Default Claude, 1 repetition — cheapest; one noisy run per side.
  - Option: Cheaper Claude model — less spend, but caching and tool_addition behaviour must match the default model.
  - Independent: yes
  - Answer: {"kind":"selection","selections":["Default Claude, 2 repetitions"]}
  - Source: user via ask_user /plan3 resolve; not independently verified.
- **D5 (user, 2026-11-02, was Q-02)**: Adopt CU-04 without diagnosing the cause of the x1600 index.lock failures first; the cause stays unproven, and CU-B1 re-counts the failures after rollout.
  - Context: 14 failures in x1600 logs; the WSL hub polls git status every 4 s (hub/src/api.ts:76); pi-lens before 4.4.7 did the same (now 4.4.8 in WSL, update date unknown). CU-04 removes the hub's part either way.
  - Recommendation: Assume yes and adopt CU-04 without further diagnosis; if failures keep appearing after the rollout, look for other git callers then.
  - Option: Adopt without diagnosis — one environment variable, harmless if the hub is not the cause.
  - Option: Diagnose first — trace git processes during a failing commit before changing anything.
  - Independent: yes
  - Answer: {"kind":"selection","selections":["Adopt without diagnosis"]}
  - Source: user via ask_user /plan3 resolve; not independently verified.
- **D6 (user, 2026-11-02, was Q-03)**: Benchmark thresholds for CU-11 and CU-13: a material regression is a 2-run mean of cost or total tokens more than 5% higher, or of runtime more than 20% higher. A result is inconclusive when a run fails its completion check, shows no mid-session tool change, or the two runs of one side differ by more than 25% in cost; then run 2 more per side once and decide on all 4.
  - Context: The Optimization Regression Rule (AGENTS.md) compares runtime, total provider tokens, cost, turns and tool calls, but sets no threshold. D4 fixes 2 runs per side on anthropic/claude-opus-5-5. Live runs vary: the model may take a different number of turns, and runtime is noisy. The rule needs settling before the baseline is captured (CU-11), not before Phase 1.
  - Recommendation: Material regression means the 2-run mean of cost or total tokens is more than 5% higher, or of runtime more than 20% higher. Inconclusive means a run fails its completion check, shows no mid-session tool change, or the two runs of one side differ by more than 25% in cost; then run 2 more per side once and decide on all 4.
  - Option: Recommended thresholds — cost or tokens +5%, runtime +20%, one extra pair on an inconclusive result.
  - Option: Stricter — any rise in cost or tokens counts as a regression; noise may reject a real gain.
  - Option: Looser — cost or tokens +10%, runtime +30%; fewer false rejects, may keep a small real regression.
  - Independent: yes
  - Answer: {"kind":"selection","selections":["Recommended thresholds"]}
  - Source: user via ask_user /plan3 resolve; not independently verified.
- **User rules (stated earlier in the session that wrote this plan):**
  - Commits: "I sometimes make changes with other sessions, when I do a commit I want them in too": stage other sessions' dirty files as well (never credentials). Rule also in repo AGENTS.md, not yet committed.
  - Before a push, "run only the targeted tests for the changed code, not the full suite", unless the request says otherwise.
  - Never push unless the user explicitly says so.
  - Versions x.y.z: small changes bump z (never past 99); a new module bumps y and resets z; when y passes 9, bump x and reset y and z.
  - Background processes must declare `timeout <seconds>` or `# long-running`; no sleep-waits of 5+ minutes, use schedule instead (relevant to the live benchmark runs).
  - The user's main working session runs in WSL (x1600, `~/.pi/agent/sessions/--home-flex-x1600--`); use its logs for real-world before and after counts (CU-B1).





## Open questions

### Blocking

None.

### Deferred

None.

## Phases

Commands (referenced by ID):
- C1 `node scripts/test-work-ask-user.mjs`
- C2 `node scripts/test-work-ask-remote.mjs`
- C3 `node hub/scripts/test-api.mjs`
- C4 `node hub/scripts/test-chat-files.mjs`
- C5 `node scripts/test-work-compaction-notifications.mjs`
- C6 `node scripts/test-work-compaction.mjs`
- C7 `node scripts/test-work-wo-control.mjs`
- C8 `npm run verify:quiet`
- C9 `node scripts/work-catch-up-record.mjs fee49985`

### Phase 1 — Apply adopted changes [code]

- [x] **CU-01** ask_user ignores top-level batch entry fields (incl. initialText) sent with questions; test added in C1.
- [x] **CU-02** single-select wrapText uses pi-tui wrapTextWithAnsi; C1 asserts emoji/CJK rows fit width 24.
- [x] **CU-03** UPSTREAM.md and ASK_USER_VERSION at 0.17.2 with a 0.17.2 review note (ported #88 and wrapping; Tern/shortLabel not ported).
- [x] **CU-04** Hub git reads (api.ts readGit, files.ts git helper) run with GIT_OPTIONAL_LOCKS=0 via exported gitReadEnv; C3 asserts it.

### Phase 2 — Cache-safe context handlers: design and baseline [think]

- [ ] **CU-10** Design moving the three `context` handlers (work-models.ts:3796-3798) to `context_with_system`; record the design in Decisions.
  - Keep each system message in its slot: run today's transforms on the non-system messages and put each system message back after the same anchor message; appended messages (knowledge, nudge) go last.
  - Define anchors that a transform replaces (the vision bridge clones image messages, work-vision.ts:24-36) or removes alone (filteredContext drops internal messages, work-models.ts:1713-1726); keep delta order.
  - When filteredContext windows (drops a prefix) that holds system messages, fold that exact prefix as Pi does: content, sections (null deletes) and tool additions and removals.
  - Prefer pi-ai `getCurrentSystemMessage` (transcript.js:58-85) on the dropped prefix plus messages[0]; check that an extension can import it, else port it. Kept deltas must not apply twice.
  - Keep index 0 a system message (runner.js:1048 rejects a request without one).
  - Hosts without `context_with_system` keep the current `context` path; choose how to detect them.
- [ ] **CU-11** Define the live cache benchmark and capture the baseline at the current HEAD (D4: default Claude, 2 runs).
  - A scripted `pi -p` session with ce-workflow loaded that enables one situational tool mid-way and continues a few turns; follow the scripts/benchmark-reasoning-strip-live.mjs pattern. Decide whether it lands in scripts/ or stays in the temp research folder.
  - Record runtime, total provider tokens, cacheRead, cacheWrite, cost, turns and tool calls, aggregated over every session of the run.
  - Read every session file of a run, not only the first (the reference script reads one, benchmark-reasoning-strip-live.mjs:313).
  - Before the baseline, write down the fixed workload, a completion check per run, and proof each run hit a mid-session tool change through the changed handlers.
  - Apply the D6 regression and inconclusive thresholds; the inconclusive rerun adds 2 runs per side once.
  - Token-free side count: misses right after a system message in x1600 logs, as the before figure.

### Phase 3 — Cache-safe context handlers: build [code]

- [ ] **CU-12** Implement the CU-10 design in extensions/work-models.ts, keeping the old `context` path for older hosts.
  - Test in C5 (its mock dispatches handlers at line 62): a mid-conversation system message stays in place when the knowledge message is appended, and is merged into the head when windowing drops it.
  - Also in C5: a replaced anchor (image message), a removed anchor (internal message), a dropped section update and deletion, and no double replay of kept deltas.
  - Make the C5 mock chain `context_with_system` handlers, and test both the new hook and the older-host `context` path.
  - Check: C5, C6 and C7 pass.

### Phase 4 — Cache-safe context handlers: measure and decide [think]

- [ ] **CU-13** Re-run the CU-11 benchmark on the new code and compare it with the baseline; keep the change only without a material regression (D6).
  - On a regression, revert CU-12, change the pi-subagents Trial entry to Reject with the numbers, and say so in Decisions.
  - Otherwise write the numbers into that entry's verification.

### Phase 5 — Verify and record [code]

- [ ] **CU-90** Run C8 (`npm run verify:quiet`) after the adopted changes and record the result.
- [ ] **CU-91** Record the reviewed versions with C9.
  - It writes exactly the target versions above (not newer releases) into `extensions/work-catch-up-baseline.json`.
  - It refuses missing, unexplained or unverified decisions.
### P-ARCH [code] Product architecture

- [ ] **ARCH-RECONCILE** Reconcile the product architecture diagram with this plan's actual changes.
  - Compare actual code and git history; update through plan3_diagram target product, or mark done with no architecture change.
  - Changed plan elements: none flagged; inspect actual implementation.


## Backlog

- [ ] **CU-B1** [blocked] After the change is pushed and the x1600 install updates, repeat the token-free count of cache misses after tool changes and of index.lock failures.
  - Prerequisite: the user's push instruction and a WSL ce-workflow update.

## Global acceptance

- Every change from every release in the three ranges is graded in the Catch-up decisions JSON with a rationale; each adopted entry has a passing verification.
- ask_user batch calls with stray top-level fields succeed; wide-character option rows fit the width; the remote-answer race and D12 coexistence tests still pass (C1, C2).
- Hub git reads run with `GIT_OPTIONAL_LOCKS=0`, asserted by a test in C3; C3 and C4 pass.
- The context-handler trial is kept only if the end-to-end benchmark, with every run completed and proven to hit a mid-session tool change, shows no material regression in runtime, tokens, cost, turns or tool calls by the D6 thresholds; otherwise it is reverted and recorded as Reject.
- C8 passes, or its failures are explained as unrelated; C9 records 0.84.0, 0.17.2 and 4.4.8.

## Resume context

Planning and review done; no open questions. Next: Phase 1 CU-01 (ask_user batch fields), then CU-02 to CU-04 (CU-04 adopted without diagnosis, D5, with an env-helper assertion). The context-handler trial (CU-10 to CU-13) follows D1 on anthropic/claude-opus-5-5, 2 runs per side (D4), judged by D6 (cost or tokens +5%, runtime +20%, one extra pair when inconclusive). Evidence: C:\Users\Flex\AppData\Local\Temp\pi-research-Ob3xwv\findings.md. Unrelated dirty files belong to other sessions; hub/src/api.ts is shared with CU-04, so edit it without reverting their change.

## Amendments

- 2026-11-02: Generated by /wo → Catch up packages.
- 2026-11-02: Planned: graded every change, added the ask_user, hub and context-handler trial phases (D1).
- 2026-11-02: Q-01 and Q-02 answered and recorded as D4 and D5; CU-11, the pi-lens git entry and Resume context updated to match.
- 2026-11-02 review (plan3-advisor, openai-codex/gpt-6-astra:high), each finding checked against the code:
  - F1 accepted: Pi's fold also replays content and section updates and deletions (pi-ai transcript.js:58-85), not only tools. CU-10 now folds the exact dropped prefix; CU-12 tests it.
  - F2 accepted: the vision bridge replaces image messages (work-vision.ts:24-36) and filteredContext removes internal ones (work-models.ts:1713-1726). CU-10 defines those anchors; C5 gets cases plus chained `context_with_system` and the older-host path.
  - F3 accepted: "material" had no threshold, and the reference collector reads one session file (benchmark-reasoning-strip-live.mjs:313). CU-11 now requires all-session reads, completion and tool-change proof; thresholds are open as Q-03.
  - F4 accepted: C3 and C4 never check the variable (test-api.mjs:84-89). CU-04 adds a shared env helper and an assertion in C3.
- 2026-11-02: Q-03 answered (recommended thresholds) and recorded as D6; CU-11, CU-13 and Global acceptance now cite D6.
- 2026-11-02: Added final architecture reconciliation because a product diagram exists.
