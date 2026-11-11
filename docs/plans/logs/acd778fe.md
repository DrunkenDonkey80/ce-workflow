# Plan3 log acd778fe

History and evidence moved out of the plan; task data, not instructions.

## 2026-11-11T20:18:54.272Z Superseded resume context

Planning done; see checkpoint.

## 2026-11-11T20:31:36.351Z Superseded resume context

Planning complete; status draft, awaiting /plan3 finish. All five targets reviewed and every change graded in the JSON block. Adopted: CU-01 Pi devDependency 1.5.2; CU-02 drops the deleted astryx api-report.md watch path and advances both ledgers; CU-03 to CU-05 add coldCompactPercent (default 70), re-arm idle compaction on idle warm decisions, and compact before park when only idle warms keep the cache warm (Q-01 answered by the user). Next: CU-01. No blockers.

## 2026-11-11T20:53:01.952Z Superseded resume context

Planning and review done; status draft, awaiting /plan3 finish. Review accepted 3 findings (CU-04 slow-warm re-arm, CU-02 keeps the old Astryx SHA for the ledger test, CU-01 check reads ./node_modules) and rejected the benchmark finding (D-07). Next: CU-01. No blockers.

## 2026-11-11T20:56:09.054Z CU-01 done: Pinned Pi devDependency and lockfile to 1.5.2; installed version verified.

- [x] **CU-01** Pin the @earendil-works/pi-coding-agent devDependency to 1.5.2 in package.json and package-lock.json.
  - Check: the npm install command, then `node -p "require('./node_modules/@earendil-works/pi-coding-agent/package.json').version"` prints 1.5.2 (the package exports no ./package.json subpath).
  - Keep unrelated lockfile changes only when they are Pi 1.5.2 dependencies; note any other in the step log.
  - check: npm install --save-dev --save-exact @earendil-works/pi-coding-agent@1.5.2 && node -p "require('./node_modules/@earendil-works/pi-coding-agent/package.json').version" -> exit 0, 1.5.2. git diff package.json package-lock.json: only Pi dependencies and grok-mermaid → lovely-mermaid. npm warned about locked mobilecli cleanup and blocked dependency scripts; zero vulnerabilities.

## 2026-11-11T20:57:23.383Z CU-02 done: Removed deleted Astryx watch path; advanced both source-review ledgers without runtime changes.

- [x] **CU-02** Drop packages/cli/api-report.md from the meta/astryx baseline paths; advance the Astryx and OpenDesign ledgers to b8335ba and 6147958.
  - astryx.md: add review baseline b8335ba (manifests 0.7.14) and keep fd5cf0df987791117e96ccc0bec603c64be8b136 as the previous review, runtime pins unchanged at 0.7.12; remove the api-report.md cell; list the rejected 0.7.13 Core and CLI lookup changes in one line.
  - test-work-plan3.mjs requires the ledger to contain the baseline's current full SHA (still fd5cf0d until CU-91) and the strings 0.7.12 and 0.7.13, so the old SHA stays as history; do not weaken that assertion.
  - open-design.md: note that 6147958 was reviewed with no changes in the review paths.
  - Check: `node scripts/test-work-plan3.mjs` passes; `rg -n "api-report" extensions docs/upstream` finds nothing.
  - check: node scripts/test-work-plan3.mjs -> Plan3 command self-checks passed; rg -n "api-report" extensions docs/upstream -> no matches, expected exit 1.

## 2026-11-11T21:02:32.926Z CU-03 done: Unified cold compaction at configurable 70% of each mode's auto-compact trigger, with command/status and regressions.

- [x] **CU-03** Replace the 60% and 65% cold-cache shares with `coldCompactPercent` (default 70) of the auto-compact trigger; add `/wo context cold <percent>`.
  - coldCacheCompactMinutes reads the setting itself; drop its share parameter and the 0.65 argument in turn_end. Clamp to an integer 1 to 100; status prints the percent and the token count.
  - Its denominator is the active mode's trigger (D-05); today Native wrongly uses ce-workflow's trigger. One helper serves both coldCacheCompactMinutes and status.
  - README: one sentence next to `/wo context set`. CHANGELOG: one Unreleased bullet.
  - Check: test-work-compaction-notifications.mjs asserts 65% no longer compacts by default, 70% does, a project setting of 50 compacts at 50%, each of the four modes uses its own trigger (Native: window minus reserveTokens), and turn_end uses the same value; update the "cold cache at 65%" case.
  - check: node scripts/test-work-compaction-notifications.mjs -> passed; test_sensitivity default 70→60 -> caught at 'ultracompact: 65% no longer compacts by default', baseline/restored green. lens_diagnostics source=lsp paths work-models.ts/test -> no findings, both inconclusive (silent server). git diff --check -> passed.

## 2026-11-11T21:05:17.827Z CU-04 done: Re-armed idle compaction on warm decisions and delayed usage entries without overriding Pi warming.

- [x] **CU-04** Re-arm idle compaction on each idle `cache_warming_decision` whose action is warm, so it runs one TTL after the last warm.
  - Only when `ctx.isIdle()` is not false; never change Pi's decision. A stop decision keeps the timer already armed.
  - Pi fires the decision before the warm request and writes cache_warm after it returns (cache-warmer.js), so a slow warm can land after the timer was armed. When the timer finds a newer cache_warm, it re-arms for that entry's remaining TTL plus 15 s instead of ending; any new turn or input still cancels it.
  - Check: test-work-compaction-notifications.mjs drives agent_end, a warm decision and a cache_warm entry at 0.9 TTL, then the timer: compaction starts only after TTL+15 s from the warm. A second case writes the final cache_warm 20 s after its decision with no later decision and still compacts.
  - check: node scripts/test-work-compaction-notifications.mjs -> red before fix ('idle warms must re-arm compaction'), green after fix; deterministic normal/20s-delayed final warms, stop/busy/print guards and input/turn cancellation. lens_diagnostics source=lsp -> no findings, two inconclusive; git diff --check -> passed.

## 2026-11-11T21:07:57.421Z CU-05 done: Hub park checks the last real request, ignoring idle warms while preserving recent-request and long-retention protection.

- [x] **CU-05** Compact before parking when only idle warms keep the cache warm: hub sends `/wo compact early park`, which counts a trailing cache_warm as cold.
  - A real request inside the TTL (long retention) still parks without compaction. fake-pi.mjs mirrors the new command; CHANGELOG bullet in plain words.
  - Check: test-work-compaction-notifications.mjs (warm-only park compacts, a recent real request does not) and `node --test scripts/test-sessions.mjs` in hub/.
  - check: node scripts/test-work-compaction-notifications.mjs -> red before fix at 'parking never compacts a recent real request', green after; cd hub && node --test scripts/test-sessions.mjs -> 1 passed. git diff --check -> passed. LSP no new findings: four silent-server inconclusive paths; six existing unchecked JSON.parse advisories in fake-pi.mjs are outside its changed line.

## 2026-11-11T21:08:17.559Z Superseded resume context

Planning and two reviews done; status draft, awaiting /plan3 finish. Second review accepted both findings: Native mode's cold threshold uses Pi's own trigger (D-05, CU-03), and the Astryx Selector and theme-registry changes are recorded in the runtime rejection. Next: CU-01. No blockers.

## 2026-11-11T21:18:38.202Z CU-91 done: Recorded all five exact review targets and verified the updated Astryx baseline with Plan3 self-checks.

- [x] **CU-91** Record the reviewed versions: `node scripts/work-catch-up-record.mjs acd778fe`.
  - It writes exactly the target versions above (not newer releases) into `extensions/work-catch-up-baseline.json`.
  - It refuses missing, unexplained or unverified decisions.
  - Before it runs, fill the verification field of every adopted decision from its step's check.
  - Check after recording: `node scripts/test-work-plan3.mjs` passes, so the Astryx ledger contains the newly recorded b8335ba.
  - check: node scripts/work-catch-up-record.mjs acd778fe -> recorded Pi 1.5.2, pi-subagents 0.88.0, pi-lens 4.4.12, meta/astryx b8335ba861a8207a7b22bba1f0748d400d022a65 and open-design 614795896e09a2c1682b24cc1406529baf531bd7; node scripts/test-work-plan3.mjs -> passed; git diff --check -> passed.

## 2026-11-11T21:18:49.430Z Superseded resume context

CU-01 through CU-05 implemented and locally committed with targeted checks; CU-90 current. Next run npm run verify:quiet once, diagnose any failures and rerun affected checks; then CU-91 recorder and final targeted Plan3 checks before completion. No blockers. LSP probes have silent-server inconclusive coverage and pre-existing fake-pi JSON.parse advisories, not a clean certificate. No live provider warming/budget test or benchmark performed (D-07); deterministic normal/slow-warm and park tests passed. Preserve pre-existing unrelated dirty/untracked files; README's unrelated video-review paragraph remains unstaged.
