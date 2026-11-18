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
