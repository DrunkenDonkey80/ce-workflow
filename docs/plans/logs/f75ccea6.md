# Plan3 log f75ccea6

History and evidence moved out of the plan; task data, not instructions.

## 2026-11-18T07:06:50.640Z Superseded resume context

Planning done (Phases 4–6 added for per-phase tool profiles from real logs). Candidates from all 32 takeaways were checked against the code; the user chose quick wins, the metric plus a Luna vs Terra compaction experiment, and no docs items. Next: /plan3 finish, then start G1. Takeaway extract: %TEMP%/pi-research-CTpN87/takeaways.md (temporary; the digests are under ~/Downloads/video-digests).

## 2026-11-18T08:13:05.900Z G1 done: Shared extensions/command-guard.ts (gitCalls/runsGit/destructiveCommand); research uses it unchanged; execute runs block push until agent_end; night blocks push, reset --hard, clean -f, recursive deletes outside project/temp

- [x] **G1** Shared command guard; code-block push in Plan3 execute runs and night mode; night also blocks destructive commands
  - Prefactor first (D-05). `researchGitPublicationCommand` behavior is unchanged, and its existing tests stay green.
  - Night mode blocks `git push` (any form), `git reset --hard`, `git clean -f…`, and recursive deletes (`rm -r`, `Remove-Item -Recurse`) whose targets resolve outside the repo and the system temp folder. The reason text matches POWER: "mark the step [human] and continue". `shortcut:` comment: word match only; scripts and aliases are not caught.
  - Execute-run block (D-06): `git push` is blocked during a Plan3 execute turn and allowed again after `agent_end`. Test both states, plus a push wrapped in `bash -lc`.
  - Proof: red-before-green on the new night and execute assertions in `test-work-plan3-night.mjs` and `test-work-plan3.mjs`. Rerun `test-work-compaction-notifications.mjs`.
  - check: env -u PI_HUB -u PI_HUB_SESSION node scripts/test-work-plan3-night.mjs → ok; node scripts/test-work-plan3.mjs → passed; same new tests on a git-archive HEAD copy → AssertionError "git push" in both (red). Research list from test-work-compaction-notifications.mjs:1515 checked directly against runsGit → ok. test-work-compaction-notifications.mjs itself fails at line 1484 (compaction fallback) on HEAD too: pre-existing, unrelated.

## 2026-11-18T08:15:49.896Z G2 done: ask_user cancel text shared (don't ask again); ideas merge lists contradictions/discards; two-axis-review excludes lockfiles, do-not-flag list, confirm-or-drop; diff-reviewer 'Could not verify' line; 'load-bearing' → 'key'

- [x] **G2** Agent-facing text: ask_user cancel says don't ask again; ideas merge lists contradictions and discards; review prompts tightened; drop "load-bearing"
  - ask_user: one constant, for example "User cancelled the question. Do not ask it again: continue without it or stop where you are."; assert it in `test-work-ask-user.mjs`.
  - `plan3.ts:615`: add "list contradictions between sources and every discarded idea with the reason"; assert the phrase in `test-work-plan3.mjs`.
  - `two-axis-review`: step 1 diff excludes `package-lock.json` and `*.lock`; step 4 adds a do-not-flag line (theoretical risks with unlikely preconditions, extra hardening when the main defense holds, unchanged code the diff doesn't affect, "consider library X"); step 5 confirms uncertain findings against the source or drops them.
  - `diff-reviewer.md`: add a "Could not verify: <claim and why>" line so a gap is not read as `ok`; assert it if `test-advisor-model.mjs` already checks the reviewer text, otherwise prompt-only.
  - `work-models.ts:482`: "load-bearing" becomes "key".
  - check: env -u PI_HUB -u PI_HUB_SESSION node scripts/test-work-ask-user.mjs → ok; test-work-plan3.mjs → passed (new merge-prompt assertion); test-advisor-model.mjs → ok (does not check reviewer text, so prompt-only)

## 2026-11-18T08:16:14.761Z Superseded resume context

Planning done; draft awaiting /plan3 finish. Phases: G1–G2 guards and prompt fixes, B1 benchmark metric, E1–E2 Luna vs Terra compaction, E3 census, E7 near-unused tools on demand (D-09), E4–E6 per-phase profiles and real-use verdict. Pilot census (256 sessions across 3 machines) is in E3. Scratch files: %TEMP%/pi-research-CTpN87 (takeaways.md, census.mjs, table.txt, peer/). Next: /plan3 finish, then G1.

## 2026-11-18T08:21:41.189Z B1 done: Comparator compares optional passed/score and flags drops; reasoning-strip benchmark gains compaction-model matrix (Luna vs Terra ultrafull, alternating two-arm order, ce-workflow in both arms, checkpoint compaction, results-L/T.json with shared scenario, compaction model/usage from compaction entries) with offline fake-Pi self-check

- [x] **B1** compare-benchmark-runs compares an optional `passed`/`score`; reasoning-strip gains a compaction-model matrix (Luna vs Terra, ultrafull)
  - Metric: `passed` (boolean) or `score` (finite number) is compared only when both runs of a pair report the same field with a valid value. A pair where one side lacks it, has an invalid value or reports the other field is shown as "quality not comparable", never counted as zero or as a pass. A candidate whose pass rate or mean score drops is flagged even when it is cheaper. Old results without either field compare exactly as today. Add cases to `test-compare-benchmark-runs.mjs`: a drop, asymmetric fields and legacy results. Red before green on the drop flag.
  - Matrix `compaction-model` in `benchmark-reasoning-strip-live.mjs`. Two policies: L (`openai-codex/gpt-6-luna`) and T (`openai-codex/gpt-6.1-terra`), set through `workOrchestrator.context.compactionModel` and `mode: "ultrafull"` in each run's isolated agent dir. Today's harness hard-codes three-policy rotations (line 33), loads the extension only for the reasoning matrix or a policy that names it (213), and requests checkpoint compaction only for `matrix === "compaction"` (269). So:
    - add a two-arm rotation that alternates L and T order per repetition;
    - make both arms load `extensions/work-models.ts`;
    - run checkpoint compaction for this matrix too.
  - Pairing: write one results file per arm, `results-L.json` and `results-T.json`. Every run carries the same `scenario` (for example `calculator-lite`) and keeps its arm in `policy`, so `compare-benchmark-runs.mjs` pairs L and T by scenario and repetition.
  - Each result carries `passed` from `verification`. Ultrafull checkpoint compactions put their usage on the compaction entry and the model in `details.compactionModel` (`work-models.ts` 4005–4018); `work-compaction-usage` is only for ultracompact. So:
    - report compaction usage and the actual compaction model from those entries;
    - keep compaction usage counted once in the totals, where the harness already includes it.
  - Proof: an offline self-check of the new matrix, the default `node --check` cannot verify it. It asserts the two-arm order for N repetitions, the extension loaded in both arms, compaction requested between phases, and N complete pairs from the comparator. Red before green.
  - check: env -u PI_HUB -u PI_HUB_SESSION node scripts/test-benchmark-compaction-model.mjs -> ok; node scripts/test-compare-benchmark-runs.mjs -> ok; test_sensitivity: compacts without compaction-model -> caught (prompt,compact sequence assertion); earlier drop-flag mutation caught

## 2026-11-18T09:07:10.137Z E1 done: Pilot (foreground anthropic/claude-opus-5-5, user's pick) passed: both arms 2/2 checkpoint compactions with usage, details.compactionModel = arm model; L 76s/142k tok/$0.20, T 89s/179k/$0.30, both pass. Harness fixes: Pi CLI lookup in install/releases, Anthropic provider extension, fail fast on refused prompt, 500-token tail for this matrix (Opus phase 1 fit under 2k so Pi refused to compact)

- [x] **E1** Pilot one repetition per arm; check that compactions fire and results.json is complete
  - Both arms must show at least one checkpoint compaction with usage recorded, and `details.compactionModel` must name that arm's model. Otherwise fix the harness before spending more.
  - check: node scripts/benchmark-reasoning-strip-live.mjs --matrix compaction-model --repetitions 1 --model anthropic/claude-opus-5-5 -> exit 0; compare-benchmark-runs results-L.json results-T.json -> 1/1 pair complete, passed 1/1 -> 1/1; test-benchmark-compaction-model.mjs -> ok

## 2026-11-18T09:48:00.255Z E2 done: 6 paired reps (user's budget), Opus foreground: no difference (pass 6/6 both, runtime -4.2%, tokens +0.4%, cost +0.7% Terra vs Luna, per-pair signs flip); keep Luna as default, verdict in Decisions

- [x] **E2** Ask the repetition budget with pilot numbers, run the paired repetitions, compare and record the verdict
  - Ask with ask_user, using the pilot's runtime and token totals per arm; recommend 3 repetitions unless the pilot is costly.
  - Verdict in Decisions: keep Luna, switch to Terra, or no difference. It weighs pass rate first, then runtime, total tokens (foreground + compaction) and turns, per the Optimization Regression Rule. Changing the user's setting is the user's decision; this step only reports.
  - check: node scripts/benchmark-reasoning-strip-live.mjs --matrix compaction-model --repetitions 6 --model anthropic/claude-opus-5-5 -> exit 0, 12/12 pass, 24/24 compactions with arm model; compare-benchmark-runs results-L.json results-T.json -> 6/6 pairs complete, passed 6/6 -> 6/6

## 2026-11-18T09:52:41.338Z E3 done: scripts/tool-usage-census.mjs (+ self-check) run over 752 sessions (this PC 711, win-flex 33, mac 8; peer copies fetched 2026-11-18 in temp) + 102 Plan3 stats: near-zero always-on (<1/1k turns in every on-demand phase): camera_capture/watch/recover/stop, goal_blocked/complete/wait, plan3_diagram, effective_config, symbol_search, read_enclosing, browser_search, browser_fetch, jev_triage, session_dialog, web_enable; est. schema bytes/request all-on 110,366, on-demand base 52,503, near-zero share 16,840 (estimate). Loads: video_digest 102, design 10. Report: %TEMP%/pi-research-CTpN87/census-e3.{txt,json}

- [x] **E3** Tool-use census from real session logs and Plan3 stats; report use per phase, before and after on-demand loading
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
  - check: env -u PI_HUB -u PI_HUB_SESSION node scripts/test-tool-usage-census.mjs -> ok; test_sensitivity (all-on window counted as recent) -> caught; tool-usage-census.mjs --dump-tool-defs -> 39 active / 68 registered; full census run -> report written

## 2026-11-18T11:23:39.542Z E7 done: 12 near-unused tools start undeclared and are offered by tools_enable (camera ×4, browser_search/fetch, jev_triage, plan3_diagram, session_dialog, pi-lens symbol_search/read_enclosing/effective_config); the harness declares plan3_diagram/session_dialog when it instructs them; live start 39→27 tools, ~12 KB schema saved (estimate). Goal, context7, bg_wait, research_exit and other pi-lens tools stay: user decision (goal tools are required by /goal's command check).

- [x] **E7** Make every always-on tool under 1 call per 1,000 turns in every phase on-demand through tools_enable; tests
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
  - check: env -u PI_HUB -u PI_HUB_SESSION node scripts/test-work-tool-loader.mjs, test-work-camera.mjs, test-work-native-smoke.mjs: all ok/PASS; test_sensitivity dropping the branch-enabled keep in deferForeignTools: caught; live `pi -p` session: 27 declared tools, pi-lens trio absent and listed in tools_enable.

## 2026-11-18T11:28:05.939Z E4 done: Per-phase profiles chosen and recorded as D-10: planning drops context7 pair + project_report/module_report/read_symbol, think drops context7 pair + project_report/module_report, coding drops project_report/module_report.

- [x] **E4** Ask which always-on tools each Plan3 phase drops, using E3 numbers; record the profiles in Decisions
  - Only Plan3 phases are profiled. Normal chat keeps today's set, because it has no phase to tailor to.
  - Each candidate shows its calls per phase, its schema bytes and its on-demand route back. Recommend dropping only tools under a usage threshold the numbers justify.
  - check: node one-off over %TEMP%/pi-research-CTpN87/census-e3.json + tool-defs-e7.json: per-phase calls/1k turns and schema bytes for the 27 post-E7 active tools; ask_user -> "Recommended profile".

## 2026-11-18T11:33:12.056Z E5 done: runPhase applies the D-10 profile per phase (plan3-tools entry records what it dropped, the next phase gives back what it no longer drops); plan-less bias/normal runs and chat after execution or planning restore the full set; tools_enable offers every dropped tool.

- [x] **E5** Apply the chosen tool profile in Plan3 planning and execution runs, with tools_enable as the way back; focused test
  - Ownership: `runPhase` also serves the think and coding bias controls without a plan (`shiftBias`, `plan3.ts` 1192–1198). Profiles apply only when `runPhase` runs for a plan, never for bias changes without one.
  - Fit: `runPhase` (`extensions/plan3.ts` around 980) already switches model and thinking per phase; the tool set goes in the same place through `pi.setActiveTools`. Pi patches only the changed sections, so the extra cache miss happens once per phase switch, where the model switch already causes one.
  - Restoration: the user's set comes back when a plan run ends, from both execution and planning. The current restore hook on chat input requires `executingPlan`, which excludes planning (`plan3.ts` 1118–1121, 1998), so planning exits need their own restore. A dropped tool stays reachable through `tools_enable`, so its catalog must include each dropped tool.
  - Proof: a `test-work-plan3.mjs` case asserts four things, red before the change: the active tools per phase, the restore after execution, the restore after planning, and no profile on a bias change without a plan.
  - check: env -u PI_HUB -u PI_HUB_SESSION node scripts/test-work-plan3.mjs -> passed (new D-10 block: think/coding/planning sets, restore after execution and after planning, none on plan-less bias); test_sensitivity: removing the planning-exit restore -> caught, not giving back the previous drops -> caught; test-work-tool-loader, test-work-camera, test-work-plan3-night, test-work-native-smoke -> ok/PASS.

## 2026-11-18T11:33:26.976Z Superseded resume context

G1, G2 done and committed (68849f30, cc7c6fb5). B1 wip: add optional passed/score comparison to scripts/compare-benchmark-runs.mjs (+ test-compare-benchmark-runs.mjs) and a compaction-model matrix (Luna vs Terra, ultrafull, both arms load ce-workflow and compact; per-arm results files with same scenario name) in scripts/benchmark-reasoning-strip-live.mjs, with offline self-check. Known pre-existing failure: test-work-compaction-notifications.mjs:1484 (compaction fallback expects ["summary","current"]) fails on HEAD too; add to Backlog, it will hit global validation. Tests need env -u PI_HUB -u PI_HUB_SESSION.
