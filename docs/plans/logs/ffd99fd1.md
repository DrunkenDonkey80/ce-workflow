# Plan3 log ffd99fd1

History and evidence moved out of the plan; task data, not instructions.

## 2026-10-19T13:14:56.333Z Superseded resume context

Planning complete; all decisions settled (D1-D5). Next: CU-01 (wake text in work-compaction.ts:449-453 plus test-work-compaction.mjs). No blockers. Live check CU-89 needs model credentials and may be recorded as unavailable.

## 2026-10-19T13:18:58.095Z Superseded resume context

Planning complete; decisions D1-D5 settled (D1, D2 by the user). Next: CU-01 (add the 0.77+ PARENT_WAKE_TEXT to syntheticWakePrompt in work-compaction.ts:449-453, extend test-work-compaction.mjs). No blockers. CU-89 live check needs model credentials and may be recorded as unavailable. Status stays draft until /plan3 finish.

## 2026-10-19T21:21:29.633Z CU-01 done: syntheticWakePrompt matches the 0.76.1 and 0.77+ subagent wake texts plus intercom; tests cover the new text (failed before the fix).

- [x] **CU-01** Recognize the 0.77+ PARENT_WAKE_TEXT as a synthetic wake prompt in work-compaction.ts; check C1.
  - Add the exact text from pi-subagents `src/shared/parent-wake.js:1` next to "Subagent updates above." and "New intercom message above." in syntheticWakePrompt (work-compaction.ts:449-453). Update its version comment.
  - In scripts/test-work-compaction.mjs (around lines 349-386 and 621-626), add the new text where the old one is asserted as synthetic. Keep the old cases. Confirm the new assertion fails without the fix.
  - check: node scripts/test-work-compaction.mjs → exit 1 before fix (new assertion), exit 0 after; commit 9f0c0c5

## 2026-10-19T21:23:21.161Z CU-02 done: Compaction-resume guard deleted from work-models.ts (input, before_agent_start, message_start, before_provider_request, settled, abort hide); live script no longer stubs the resume; C2 regression case added.

- [x] **CU-02** Remove the compaction-resume turn guard from work-models.ts per D1; checks C1 and C2.
  - Delete blockedCompactionResumeTurn, hideCompactionResumeAbort and their uses. These are in the input handler (3708-3713), before_agent_start (3722), message_start (3744-3760, including the outdated comment), before_provider_request (3772-3777), agent_settled resets (3893, 3897) and the aborted-message hide branch (3956-3966). Delete isCompactionResumePrompt (2262) if nothing else uses it.
  - Keep the knowledge-notice parts of those same handlers, and keep the work-compaction.ts regex (D5).
  - In scripts/test-compaction-resume-idle.mjs, drop the stubbed subagent-compaction-resume send and the header claim about it. Keep the microcompact and delayed-notice checks and the ok line accurate.
  - Add a C2 regression case in scripts/test-work-compaction-notifications.mjs. The input hook does not handle a "Compaction is complete. Resume the parent task now…" text. A subagent-compaction-resume message_start followed by before_provider_request does not abort. An aborted assistant message_end after it is not rewritten to stop. Confirm the case fails before the removal. Keep the knowledge-notice controls.
  - check: node scripts/test-work-compaction-notifications.mjs → exit 1 before removal ("the input hook leaves the compaction resume alone"), exit 0 after; node scripts/test-work-compaction.mjs → exit 0; commit 3ce5b8a

## 2026-10-19T21:24:25.056Z CU-03 done: before_agent_start marks a run prompt-backed only when messageType !== "custom"; Pi 1.2-order knowledge-notice case added.

- [x] **CU-03** Count only non-custom before_agent_start runs as prompt-backed in work-models.ts (D4); check C2.
  - Around work-models.ts:3721-3725, skip pendingPromptBackedAgentStart when event.messageType === "custom". Older Pi sends no messageType, so it keeps today's behavior.
  - In scripts/test-work-compaction-notifications.mjs, near the owned-notice loop (around line 197), add a case in Pi 1.2 order. The sequence is before_agent_start({ messageType: "custom", message }), then agent_start, message_start, message_end and before_provider_request. Assert that it aborts. Confirm the case fails without the fix.
  - check: node scripts/test-work-compaction-notifications.mjs → exit 1 before fix ("custom run in Pi 1.2 order must abort"), exit 0 after; commit 77e6c79

## 2026-10-19T21:25:24.890Z CU-04 done: devDependency @earendil-works/pi-coding-agent pinned to 1.3.0; package-lock root and node_modules entry both 1.3.0.

- [x] **CU-04** Bump the pi-coding-agent devDependency to 1.3.0 exactly with package-lock.json in sync; checks C3, then C4.
  - Only package.json and package-lock.json change. Report C4 per file as clean, findings or inconclusive. Fix only type errors that CU-03 introduced.
  - Rerun C1 and C2 after the bump.
  - check: C3 npm install --save-dev --save-exact → exit 0; lock devDependencies and installed version 1.3.0. C4 lens_diagnostics: advisor-model.ts inconclusive; jev-tools.ts/work-images.ts only pre-existing local-inference errors (unknown/{} property access, gcd spread), none on Pi API types. Commit 5d7b1d4

## 2026-10-19T21:27:58.353Z CU-05 done: Research advisor prompt drops the action:list/action:models pre-launch call; C2 asserts its absence. Also fixed a CU-04 fallout: pi 1.3.0 estimateTokens counts string-content assistant messages as 0, so the overflow fixture now uses array content.

- [x] **CU-05** Remove the action:list and action:models pre-launch clause from the research advisor prompt (D2); check C2.
  - work-models.ts:491: keep "If subagent is not active, call subagents_enable" and the rest of the step.
  - In scripts/test-work-compaction-notifications.mjs, where taskPrompts are captured (around line 1495), assert that the advisor prompt no longer matches /action:list|action:models/.
  - check: node scripts/test-work-compaction-notifications.mjs → exit 1 at CU-04 HEAD (TypeError line 999, fixture under-estimated), exit 0 after fixture + CU-05; commit d0a4c2e

## 2026-10-19T21:28:43.528Z CU-89 done: Live C5 passed against Pi 1.3.0 with openai-codex/gpt-6-luna.

- [x] **CU-89** Run the live guard script C5 once against Pi 1.3.0 and record the result or why it was unavailable.
  - It spends a small number of model tokens and needs credentials for the chosen model. The default `openai-codex/gpt-5.6-luna` may no longer exist, so pass `--model`. If no model is available, record the check as unavailable; do not count it as passed.
  - check: PI_CLI=…/1.3.0/…/cli.js node scripts/test-compaction-resume-idle.mjs --model openai-codex/gpt-6-luna → exit 0, "ok - ultracompact: live microcompact and stubbed delayed internal notices spend no model turn; ordinary prompt and unknown child both wake provider"

## 2026-10-19T21:32:52.789Z CU-90 done: verify:quiet green except one environment-only live check: test-work-screen-read's attached-device branch fails on the non-phone device ingenic-serial (android CLI cannot screencap it); screen-read code untouched by this plan.

- [x] **CU-90** Run `npm run verify:quiet` after the adopted changes and record the result.
  - check: env -u PI_HUB npm run verify:quiet → 1 FAIL (test-work-screen-read live android, adb device ingenic-serial). First run inside the hub failed 9 tests only because PI_HUB=1 leaked into test processes (hub-channel publishes via ui.setStatus); not a product regression. git diff 9fda699~1..HEAD on screen-read files: empty.

## 2026-10-19T21:33:36.064Z ARCH-RECONCILE done: No architecture change: the plan edited guard logic, prompt text, test fixtures and a devDependency pin only; no components or connections were added or removed.

- [x] **ARCH-RECONCILE** Reconcile the product architecture diagram with this plan's actual changes.
  - Compare actual code and git history; update through plan3_diagram target product, or mark done with no architecture change.
  - Changed plan elements: none flagged; inspect actual implementation.
  - check: git diff --stat 9fda699~1..HEAD: work-compaction.ts, work-models.ts, tests, package.json/lock, baseline json, plan; no new modules

## 2026-10-19T21:33:36.070Z CU-91 done: Catch-up baseline recorded for pi-coding-agent 1.3.0, pi-subagents 0.79.1, pi-intercom 0.17.1 and pi-lens 4.4.4; the adopted decisions now carry verification.

- [x] **CU-91** Record the reviewed versions with C7 (`node scripts/work-catch-up-record.mjs <this plan's id>`).
  - It writes exactly the target versions above (not newer releases) into `extensions/work-catch-up-baseline.json` and refuses missing, unexplained or unverified decisions.
  - Before running it, add each adopted entry's "verification" (command and result) to the JSON above.
  - check: node scripts/work-catch-up-record.mjs ffd99fd1 → "recorded: @earendil-works/pi-coding-agent@1.3.0, pi-subagents@0.79.1, pi-intercom@0.17.1, pi-lens@4.4.4"; commit 8d48ef6

## 2026-10-20T12:02:39.837Z ARCH-RECONCILE done: Product diagram reconciled: only drift was the Pi host version label, updated 1.1.0 → 1.3.0 (CU-04); no components or connections added or removed by this plan.

- [x] **ARCH-RECONCILE** No architecture change: the plan edited guard logic, prompt text, test fixtures and a devDependency pin only; no components or connections were added or removed.
  - check: plan3_diagram get target product (rev 7) vs package.json devDependencies @earendil-works/pi-coding-agent = 1.3.0 and plan commits (guard logic, prompt text, fixtures, pin only); plan3_diagram apply update pi_host.tech → rev 8.
