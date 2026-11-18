---
plan3: true
status: active
created: 2026-11-17
updated: 2026-11-18T11:33:26.981Z
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
- 2026-11-18 E2 verdict, Luna vs Terra as ultrafull summarizer (6 paired repetitions, alternating order, foreground anthropic/claude-opus-5-5, calculator-lite 3 phases, 2 checkpoint compactions per run): **no difference**. Pass 6/6 vs 6/6; runtime 582 s vs 558 s (-4.2%), total tokens 1.104M vs 1.108M (+0.4%), cost $1.84 vs $1.86 (+0.7%), turns 73 vs 74. Per-pair deltas flip sign (runtime -17 s to +14 s), so noise dominates. Compaction calls themselves: Luna ≈ $0.0009 vs Terra ≈ $0.009 per run, both under 1% of the run. Keeping Luna (cheaper, equal outcome) is the default; changing the setting is the user's call. Limit: one small task whose phases fit easily in context; a summary quality gap would show only on long, dense sessions. Results: `.pi/compaction-model-benchmark/e2/results-{L,T}.json` (untracked).
- **D-10 Per-phase tool profiles (E4).** Plan3 runs drop these always-on tools; `tools_enable` brings any back. Planning: `resolve-library-id`, `query-docs`, `project_report`, `module_report`, `read_symbol` (≈8.6 KB/request, estimated). Think: `resolve-library-id`, `query-docs`, `project_report`, `module_report` (≈7.7 KB). Coding: `project_report`, `module_report` (≈3.3 KB; context7 stays, `query-docs` is at 1.0). Basis: E3 census since 2026-10-31, calls per 1,000 assistant turns (planning 4.0k turns, think 13.5k, coding 43.5k), each dropped tool under 1.0 in its phase. Excluded on purpose: goal tools (/goal needs them), loaders, tools the standing rules name (test_sensitivity, jev_evidence, compaction_note, knowledge) and the research tools. Planning's sample is small (1 per 1,000 ≈ 4 calls). Source: user, ask_user 2026-11-18, recommended profile.


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

- [x] **E1** Pilot (foreground anthropic/claude-opus-5-5, user's pick) passed: both arms 2/2 checkpoint compactions with usage, details.compactionModel = arm model; L 76s/142k tok/$0.20, T 89s/179k/$0.30, both pass. Harness fixes: Pi CLI lookup in install/releases, Anthropic provider extension, fail fast on refused prompt, 500-token tail for this matrix (Opus phase 1 fit under 2k so Pi refused to compact)
- [x] **E2** 6 paired reps (user's budget), Opus foreground: no difference (pass 6/6 both, runtime -4.2%, tokens +0.4%, cost +0.7% Terra vs Luna, per-pair signs flip); keep Luna as default, verdict in Decisions
### Phase 4: Tool-use census from real sessions [think]

- [x] **E3** scripts/tool-usage-census.mjs (+ self-check) run over 752 sessions (this PC 711, win-flex 33, mac 8; peer copies fetched 2026-11-18 in temp) + 102 Plan3 stats: near-zero always-on (<1/1k turns in every on-demand phase): camera_capture/watch/recover/stop, goal_blocked/complete/wait, plan3_diagram, effective_config, symbol_search, read_enclosing, browser_search, browser_fetch, jev_triage, session_dialog, web_enable; est. schema bytes/request all-on 110,366, on-demand base 52,503, near-zero share 16,840 (estimate). Loads: video_digest 102, design 10. Report: %TEMP%/pi-research-CTpN87/census-e3.{txt,json}

### Phase 5: Near-unused tools on demand [code]

- [x] **E7** 12 near-unused tools start undeclared and are offered by tools_enable (camera ×4, browser_search/fetch, jev_triage, plan3_diagram, session_dialog, pi-lens symbol_search/read_enclosing/effective_config); the harness declares plan3_diagram/session_dialog when it instructs them; live start 39→27 tools, ~12 KB schema saved (estimate). Goal, context7, bg_wait, research_exit and other pi-lens tools stay: user decision (goal tools are required by /goal's command check).

### Phase 6: Per-phase tool profiles [think]

- [x] **E4** Per-phase profiles chosen and recorded as D-10: planning drops context7 pair + project_report/module_report/read_symbol, think drops context7 pair + project_report/module_report, coding drops project_report/module_report.
### Phase 7: Apply tool profiles [code]

- [x] **E5** runPhase applies the D-10 profile per phase (plan3-tools entry records what it dropped, the next phase gives back what it no longer drops); plan-less bias/normal runs and chat after execution or planning restore the full set; tools_enable offers every dropped tool.
### Phase 8: Real-use verdict [think]

- [blocked] **E6** After about two weeks of real use, rerun the census and compare misses, tool tokens and turns against the E3 baseline
  - Covers E7 too: count `tools_enable` loads of each tool moved in E7.
  - The tool-token comparison uses E3's estimated schema bytes per request, labelled as an estimate.
  - A miss is a `tools_enable` call for a tool the profile dropped. A high miss rate means that tool goes back into the profile.
  - Verdict in Decisions: keep, adjust or revert the profiles. Real use varies by task, so this is a before/after comparison, not a paired benchmark; the report states that limit.
  - note: Waits for about two weeks of real use after 2026-11-18 (E7 and E5 shipped then); rerun scripts/tool-usage-census.mjs around 2026-12-02 against the E3 baseline (%TEMP%/pi-research-CTpN87/census-e3.json is temporary: rerun E3's window from the script if it is gone).

## Backlog

- Code-run step check (D-02): an optional project-declared check command that `plan3 step done` runs itself, refusing done on failure. Build it when a session shows a false check claim, and only after an end-to-end benchmark.
- Hub resumes a night-mode session once after an unexpected Pi exit (2026-10-12 digest), if night runs are seen crashing.
- Reference codes F1/O1 and a negative-pattern sentence in REPORTING (2026-08-17 digest): benchmark-gated.
- A per-child cost line for subagent and oracle results (2026-08-24 digest): first check whether pi-subagents already reports it.

## Global validation

Run every targeted test named in Relevant files on the final state, then `npm run verify:quiet` once at completion. Phase 3 produces its own results.json files and verdict; no product setting changes without the user.

## Resume context

9/10 done. E6 (real-use verdict) waits for about two weeks of real use after 2026-11-18: rerun scripts/tool-usage-census.mjs around 2026-12-02 and compare tools_enable misses for the E7 and D-10 tools, estimated schema bytes and turns against E3. Nothing else is runnable.

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
