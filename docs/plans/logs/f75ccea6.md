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
