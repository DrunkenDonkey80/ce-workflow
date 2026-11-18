---
plan3: true
status: active
created: 2026-11-17
updated: 2026-11-18T08:21:41.188Z
size: plan
reviewed: 2026-11-18
tagsChecked: a310673c,811f1a0f
started: 2026-11-18T08:08:04.066Z
---

# Mine the 32 newly reviewed videos for orchestration quality and speed improvements

## Original request

> right, we have added 32 or so new videos to the process list, do a thorough examination of that and look for interesting stuff that can help us in developing, can improve the quality or speed or both of our orchestration system

## Goal, requirements, and non-goals

Goal: build the still-open, user-selected improvements from the 32 videos added to `docs/upstream/processed-videos.json` in daf9682d. Each video's digest already has a "Takeaways for ce-workflow" section; this planning session read all 32 and checked every candidate against the current code.

Requirements (selected by the user, D-01..D-03):
- R1 Code guards: during Plan3 execute runs and night mode, code blocks `git push`. Night mode also blocks a small set of destructive commands. Today both rules exist only in prompts.
- R2 Agent-facing prompt and text fixes:
  - when the user cancels an ask_user dialog, the result says not to ask again;
  - the `/plan3 ideas` merge lists contradictions and discarded ideas, with reasons;
  - the review prompts get a "do not flag" list, a confirm-or-drop rule for uncertain findings, a "Could not verify" line and no lockfiles in the diff;
  - the word "load-bearing" is removed from the research prompt.
- R3 Benchmark quality: `compare-benchmark-runs.mjs` compares an optional per-run pass/score, and a paired live experiment compares compaction on gpt-6-luna vs gpt-6.1-terra.
- R4 Per-phase tool profiles: Plan3 phases get only the tools that real sessions show they use, based on a census of real logs and judged afterwards by real use (D-07, D-08).

Non-goals: agent teams with a lead and specialist members (D-08); tailoring the system prompt text per phase (no measured evidence; Backlog); building the code-run step check (Backlog, D-02); docs-only items (README egress table, related-plan links, other-repos list; D-04); swarms, agent teams, races, sandboxes, a Jev bash gate, background compaction and the other items the digests already marked Skip. No push.

## Decisions

- **D-01 Quick wins.** All five quick wins are in scope: push and destructive-command guards, the ask_user cancel text, the ideas-merge discards, the review prompt edits and dropping "load-bearing". They are deterministic code or one-line prompt edits taken from the video takeaways. Source: user, ask_user round 1.
- **D-02 Code-run step checks go to Backlog.** Two videos (2026-07-13, 2026-08-03) argue that code, not the agent's word, should confirm "done". No session here has shown a false check claim, and many checks are tool checks that code cannot rerun. Source: user, round 1.
- **D-03 Quality metric plus compaction experiment.** Add the metric, then run a paired live experiment: compaction model `openai-codex/gpt-6-luna` (the current setting) vs `openai-codex/gpt-6.1-terra`. Both run on the Codex subscription, so the reported costs are token-priced estimates, not billed spend. Source: user, rounds 1–2.
- **D-04 No docs-only items.** Source: user, round 2.
- **D-05 Prefactor: one shared command guard.** `researchGitPublicationCommand` (`extensions/work-models.ts:1450`) already parses shell words and sees through `-c` wrappers and git global options. The small prefactor moves it into a small module that takes the git verbs to match, which research mode, Plan3 execute and night mode then share. A second regex in `plan3-night.ts` would copy parsing that already exists. Source: fit check (agent).
- **D-06 Execute-run push guard is scoped to the turn.** The block starts with the agent run that a Plan3 execute or resume prompt starts and ends at that run's `agent_end`. A later ordinary chat request such as "commit and push" stays allowed: the user authorizes pushes outside Plan3 runs. Source: boundary text `plan3.ts:52`, global AGENTS.md (agent, >95% from evidence).
- **D-size** Size: plan. Read the 32 digest takeaways and check them against the repo now; then the user picks which findings to build as plan steps. Source: user pick, 2026-11-17.


- **D-07 Judge tool tailoring from real logs, not synthetic runs.** A census of real session logs shows which tools each phase actually uses, and a rerun after real use judges the change. It accounts for the on-demand tool loading that began 2026-10-31 (318b4244) and was refined 2026-11-13 (17b68ef2). Source: user, after the hYIymEMB9x4 source check.
- **D-08 Specialize tools per phase, not agents.** The video's team evidence (Anthropic Fable 5.2 system card §8.12) tests peers with identical tools and prompts. It shows teams buying latency with tokens, not specialization winning, so teams stay out. Tool narrowing has independent support: Anthropic's Tool Search reports Opus 4 at 49%→74% selection accuracy, with selection degrading past 30–50 tools; RAG-MCP (arXiv 2505.03275) reports 43.13% vs 13.62%. Source: research this session; user asked to pursue it.

- **D-09 Near-unused tools become on-demand.** Every always-on tool under the E7 usage threshold loads only through `tools_enable`, whichever package registers it. This applies to all sessions, not only Plan3 phases, and is not gated on E6's verdict. Source: user, 2026-11-18, after the cross-machine pilot census.

## Open questions

### Blocking

None.

### Deferred

None recorded. The experiment's repetition budget is asked in step E2 with pilot numbers.

## Relevant files and approach

Fit check per module:
- `extensions/work-models.ts` (research guard at 1450 and 3798; prompt at 482) — **small prefactor**: move the publication-command parser to `extensions/command-guard.ts`, which matches a verb set given as a parameter; research mode keeps commit and push. The `load-bearing` edit **fits**.
- `extensions/plan3-night.ts` (`nightBlockReason`, `POWER`) — **fits**: add push and destructive patterns next to POWER, using the shared guard; the shortcut comment names the limits.
- `extensions/plan3.ts` (`tool_call` hooks near 2104; execute prompt; ideas merge prompt at 615) — **fits**: a turn-scoped push block keyed on the execute run (`RUN` entries, `executingPlan`), plus one sentence in the merge prompt.
- `extensions/ask-user/index.ts` (cancel results at 2792, 3065, 3125) — **small prefactor**: one shared cancel-text constant instead of three literals.
- `skills/two-axis-review/SKILL.md` (steps 1, 4, 5) and `utility-agents/diff-reviewer.md` — **fits**: prompt edits only.
- `scripts/compare-benchmark-runs.mjs` — **fits**: an optional quality metric, compared when either side reports it; a drop in quality flags the candidate.
- `scripts/benchmark-reasoning-strip-live.mjs` (compaction matrix at 58–90; `verification` field) — **fits**: add a `compaction-model` matrix with ultrafull mode and one policy per compaction model; emit `passed` from `verification`.

- `scripts/tool-usage-census.mjs` (new) — **fits**: read-only analysis script beside the benchmark scripts; no existing script parses session tool calls by phase.
- `extensions/plan3.ts` `runPhase` (around 980) — **fits**: it already applies per-phase model and thinking, so the tool profile joins it there. `extensions/tool-loader.ts` and the `tools_enable` catalog stay the way back.
- `extensions/tool-loader.ts` (E7) — **small prefactor**: today `tools_enable` only lists tools registered as deferred. One more input, the list of tools from other packages that ce-workflow switched off at start, lets one loader cover both kinds instead of adding a second loader. The trigger activations go next to the code that gives each instruction (the goal hooks, research mode in `work-models.ts`, the intercom stop handling, Plan3 diagram detection and subagents_enable).

Tests: `scripts/test-work-compaction-notifications.mjs` (research guard), `scripts/test-work-plan3-night.mjs`, `scripts/test-work-plan3.mjs`, `scripts/test-work-ask-user.mjs`, `scripts/test-advisor-model.mjs`, `scripts/test-compare-benchmark-runs.mjs`.

Commands (run directly with node, with PI_HUB cleared): `env -u PI_HUB node "scripts/<test>.mjs"`. Live experiment: `node scripts/benchmark-reasoning-strip-live.mjs --matrix compaction-model --repetitions N --model <foreground>`, which writes one results file per arm; then `node scripts/compare-benchmark-runs.mjs <L results> <T results>`.

## Phases

### Phase 1: Guards and prompt fixes [think]

- [x] **G1** Shared extensions/command-guard.ts (gitCalls/runsGit/destructiveCommand); research uses it unchanged; execute runs block push until agent_end; night blocks push, reset --hard, clean -f, recursive deletes outside project/temp
- [x] **G2** ask_user cancel text shared (don't ask again); ideas merge lists contradictions/discards; two-axis-review excludes lockfiles, do-not-flag list, confirm-or-drop; diff-reviewer 'Could not verify' line; 'load-bearing' → 'key'

### Phase 2: Benchmark quality metric [think]

- [x] **B1** Comparator compares optional passed/score and flags drops; reasoning-strip benchmark gains compaction-model matrix (Luna vs Terra ultrafull, alternating two-arm order, ce-workflow in both arms, checkpoint compaction, results-L/T.json with shared scenario, compaction model/usage from compaction entries) with offline fake-Pi self-check

### Phase 3: Compaction model experiment [think]

- [wip] **E1** Pilot one repetition per arm; check that compactions fire and results.json is complete
  - Both arms must show at least one checkpoint compaction with usage recorded, and `details.compactionModel` must name that arm's model. Otherwise fix the harness before spending more.
- [ ] **E2** Ask the repetition budget with pilot numbers, run the paired repetitions, compare and record the verdict
  - Ask with ask_user, using the pilot's runtime and token totals per arm; recommend 3 repetitions unless the pilot is costly.
  - Verdict in Decisions: keep Luna, switch to Terra, or no difference. It weighs pass rate first, then runtime, total tokens (foreground + compaction) and turns, per the Optimization Regression Rule. Changing the user's setting is the user's decision; this step only reports.
### Phase 4: Tool-use census from real sessions [think]

- [ ] **E3** Tool-use census from real session logs and Plan3 stats; report use per phase, before and after on-demand loading
  - New `scripts/tool-usage-census.mjs` (rerun in E6, so it belongs in the repo). It reads only entry types, tool names, `plan3-run` modes, timestamps and cwd; never message text or tool arguments, because sessions hold user content.
  - Inputs:
    - Pi session JSONL from all three machines. This PC: `~/.pi/agent/sessions`. The Flex Windows hub and the MacBook: the session files of their shared projects, listed with `peer_ls` and fetched with `peer_fetch`. `peer_fetch` can only save into the session project's `.pi/inbox` (`hub/src/link.ts` 316), which is gitignored, so the script moves each file to the system temp folder straight after fetching and never stages it. The script reads these files and never commits them. Phases come from `plan3-run` entries (planning, think, coding, normal); chat outside Plan3 counts as "normal".
    - The committed `docs/plans/logs/*.stats.json` in the 17 repos under `C:\SOFT\git` that have them. These are cross-machine, but only per-plan totals, with no phase split.
  - Windows: before 2026-10-31 (all tools always on), from 318b4244 on 2026-10-31 (situational tools on demand), and from 17b68ef2 on 2026-11-13 (trigger-oriented `tools_enable`).
  - Report per phase and window: calls per tool, the share of sessions using each tool, `tools_enable` and `pi_lens_activate_tools` loads, and always-on tools with near-zero use. Add the description and schema size of each always-on tool, from the registered tool definitions. Loads come from the `details.enabled` of `tools_enable` results (`tool-loader.ts` 43), not from tool arguments.
  - Tool-token metric: requests do not log the tools they offered, and Plan3 stats keep only total model usage (`plan3-stats.ts` 76–89). So E3 and E6 report **estimated** schema bytes per request: the summed definition sizes of the tools active in that phase, labelled as an estimate. No new logging is added.
  - Pilot census, run during planning (scratch script, temp folder; E3 rebuilds it in the repo):
    - Coverage: 256 sessions since 2026-09-01. This PC 215, Flex Windows 33, MacBook 8.
    - Assistant turns since on-demand loading: planning 2,116; think 6,660; coding 28,268; normal 16,270.
    - bash, read, edit, write, codemode and plan3 make up about 90% of calls in every phase.
    - Always-on tools near zero in every phase (at most 0.5 calls per 1,000 turns): camera tools (0), project_report, symbol_search, read_enclosing, module_report, effective_config, goal tools. plan3_diagram is used only in coding (0.2).
    - Phase-specific: research_note only in planning (19.4 per 1,000 turns); ask_user and subagent are highest in planning; screen_read, vm_act, browser_act and process_image never appear in planning; video_digest only in normal chat.
    - On-demand loads (tools_enable): video_digest 102, screen_read 48, app_act 24, browser_act 19.
    - Limits: other machines contribute only their shared projects, and the available tool list per request is not logged.
  - Gap: the tool list offered per request is not logged, so "available" comes from the registration code for each window (assumption, labelled in the report). A self-check runs the parser over a small fixture JSONL.

### Phase 5: Near-unused tools on demand [code]

- [ ] **E7** Make every always-on tool under 1 call per 1,000 turns in every phase on-demand through tools_enable; tests
  - Threshold (D-09): fewer than 1 call per 1,000 assistant turns in every phase since 2026-10-31, from the E3 census. Already-situational tools are out of scope.
  - Pilot candidates, which E3's final numbers confirm or change:
    - ce-workflow tools: the four camera tools (0 calls), jev_triage (0.1), browser_search (0.5), plan3_diagram (0.2), session_dialog (0.9), research_exit (0.9).
    - Tools from other packages: project_report, symbol_search, read_enclosing, module_report and effective_config (pi-lens); query-docs and resolve-library-id (context7); bg_wait (pi-subagents); goal_complete, goal_blocked and goal_wait; and pi_lens_activate_tools (0.3), a second loader that folds into tools_enable.
  - ce-workflow tools: register as `exposure: "deferred"`, with a one-line entry in `SITUATIONAL_TOOLS` (`extensions/tool-loader.ts`). Pi then restores enabled tools on resume, as for today's situational tools.
  - Camera: `syncCameraTools` (`work-models.ts` 4265, called at session start and before every run, 3818 and 3884) adds all camera tools whenever a camera is configured and removes them otherwise. It would undo both the deferral and an explicit enable. Change it to decide only whether the camera tools are offered by `tools_enable`, never which are active. Test two cases: a configured camera starts with the tools inactive, and an enabled camera tool stays active through the next agent start.
  - Tools from other packages: ce-workflow cannot change how they register, so it removes them from the active set (`pi.setActiveTools`) at session start and lists them in `tools_enable`. Enabling one adds it back. Check whether Pi keeps that per-branch active set on resume; if it does not, record enabled names in a session entry and reapply them, with a test.
  - Tools the harness tells the model to call at a known moment are activated by the code that gives that instruction:
    - the goal tools when a goal starts;
    - research_exit while research mode is on;
    - session_dialog when intercom reports a stopped send;
    - plan3_diagram when a plan has a diagram;
    - bg_wait together with subagents_enable.
    Otherwise the instruction would name a tool the model cannot see.
  - Prompt rules that name a moved tool (browser_search, the context7 skill, pi-lens skills) say to enable it first, or the rule moves into the tool's tools_enable line.
  - Proof:
    - Extend the tool-loader tests (find the existing ones in `scripts/`; new cases in `test-work-plan3.mjs` if none). They assert that each moved tool is inactive at start, appears in the `tools_enable` enum, becomes active after enabling, and is activated by its instruction trigger.
    - Red before the change. Then one live session start with the real package set confirms the declared tool list shrank, and reports the bytes saved per request.

### Phase 6: Per-phase tool profiles [think]

- [ ] **E4** Ask which always-on tools each Plan3 phase drops, using E3 numbers; record the profiles in Decisions
  - Only Plan3 phases are profiled. Normal chat keeps today's set, because it has no phase to tailor to.
  - Each candidate shows its calls per phase, its schema bytes and its on-demand route back. Recommend dropping only tools under a usage threshold the numbers justify.
### Phase 7: Apply tool profiles [code]

- [ ] **E5** Apply the chosen tool profile in Plan3 planning and execution runs, with tools_enable as the way back; focused test
  - Ownership: `runPhase` also serves the think and coding bias controls without a plan (`shiftBias`, `plan3.ts` 1192–1198). Profiles apply only when `runPhase` runs for a plan, never for bias changes without one.
  - Fit: `runPhase` (`extensions/plan3.ts` around 980) already switches model and thinking per phase; the tool set goes in the same place through `pi.setActiveTools`. Pi patches only the changed sections, so the extra cache miss happens once per phase switch, where the model switch already causes one.
  - Restoration: the user's set comes back when a plan run ends, from both execution and planning. The current restore hook on chat input requires `executingPlan`, which excludes planning (`plan3.ts` 1118–1121, 1998), so planning exits need their own restore. A dropped tool stays reachable through `tools_enable`, so its catalog must include each dropped tool.
  - Proof: a `test-work-plan3.mjs` case asserts four things, red before the change: the active tools per phase, the restore after execution, the restore after planning, and no profile on a bias change without a plan.
### Phase 8: Real-use verdict [think]

- [ ] **E6** After about two weeks of real use, rerun the census and compare misses, tool tokens and turns against the E3 baseline
  - Covers E7 too: count `tools_enable` loads of each tool moved in E7.
  - The tool-token comparison uses E3's estimated schema bytes per request, labelled as an estimate.
  - A miss is a `tools_enable` call for a tool the profile dropped. A high miss rate means that tool goes back into the profile.
  - Verdict in Decisions: keep, adjust or revert the profiles. Real use varies by task, so this is a before/after comparison, not a paired benchmark; the report states that limit.

## Backlog

- Code-run step check (D-02): an optional project-declared check command that `plan3 step done` runs itself, refusing done on failure. Build it when a session shows a false check claim, and only after an end-to-end benchmark.
- Hub resumes a night-mode session once after an unexpected Pi exit (2026-10-12 digest), if night runs are seen crashing.
- Reference codes F1/O1 and a negative-pattern sentence in REPORTING (2026-08-17 digest): benchmark-gated.
- A per-child cost line for subagent and oracle results (2026-08-24 digest): first check whether pi-subagents already reports it.

## Global validation

Run every targeted test named in Relevant files on the final state, then `npm run verify:quiet` once at completion. Phase 3 produces its own results.json files and verdict; no product setting changes without the user.

## Resume context

G1, G2 done and committed (68849f30, cc7c6fb5). B1 wip: add optional passed/score comparison to scripts/compare-benchmark-runs.mjs (+ test-compare-benchmark-runs.mjs) and a compaction-model matrix (Luna vs Terra, ultrafull, both arms load ce-workflow and compact; per-arm results files with same scenario name) in scripts/benchmark-reasoning-strip-live.mjs, with offline self-check. Known pre-existing failure: test-work-compaction-notifications.mjs:1484 (compaction fallback expects ["summary","current"]) fails on HEAD too; add to Backlog, it will hit global validation. Tests need env -u PI_HUB -u PI_HUB_SESSION.

## Amendments

Append material changes and their reasons; preserve the original request and settled decisions.
- 2026-11-17: Added Phase 4 (E3–E6) after E2: User asked to examine the per-task specialization idea (hYIymEMB9x4) from real logs instead of a synthetic benchmark, accounting for on-demand tool loading.
- 2026-11-18: Added E7 after E3: User decided 2026-11-18 that near-unused tools must be on-demand, regardless of the per-phase profiles.
- 2026-11-18 review (plan3-advisor, openai-codex/gpt-6-astra:high); each finding checked against the code:
  - 1 B1 two-arm harness: **accepted**. Rotations, extension loading and checkpoint compaction are hard-coded (`benchmark-reasoning-strip-live.mjs` 33, 213, 269), so B1 now adds them plus an offline self-check.
  - 2 L vs T pairing: **accepted**. The comparator keys on scenario or policy plus repetition, so results are now written as one file per arm with a shared scenario.
  - 3 compaction usage source: **accepted**. Ultrafull usage is on the compaction entry, with the model in `details.compactionModel` (`work-models.ts` 4005–4018). E1 checks each arm's model.
  - 4 peer_fetch destination: **accepted, adjusted**. It saves only to the gitignored `.pi/inbox` (`link.ts` 316), so E3 fetches there and moves each file to temp at once, never staged. This was the pilot's route and fits the intent: no session data in tracked files.
  - 5 tool-token baseline: **accepted**. Per-request offered tools are not logged, so E3 and E6 use labelled estimated schema bytes, and loads come from `details.enabled`.
  - 6 camera sync: **accepted**. `syncCameraTools` re-adds or removes camera tools at every agent start (`work-models.ts` 4265), so E7 now changes it.
  - 7 runPhase ownership and restore: **accepted**. Bias changes without a plan call runPhase (`plan3.ts` 1198), and the restore hook excludes planning (1118–1121). E5 now covers both.
  - 8 asymmetric quality fields: **accepted**. Missing or mismatched values count as not comparable.
