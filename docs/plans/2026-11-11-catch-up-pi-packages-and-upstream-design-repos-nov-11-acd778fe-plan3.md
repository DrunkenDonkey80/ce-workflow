---
plan3: true
status: active
created: 2026-11-11
source: catch-up
catch-up: {"@earendil-works/pi-coding-agent":"1.5.2","pi-subagents":"0.88.0","pi-lens":"4.4.12","meta/astryx":"b8335ba861a8207a7b22bba1f0748d400d022a65","nexu-io/open-design":"614795896e09a2c1682b24cc1406529baf531bd7"}
updated: 2026-11-11T20:56:09.054Z
reviewed: 2026-11-11
started: 2026-11-11T20:55:15.681Z
---

# Catch up Pi packages and upstream design repos (Nov 11)

## Original request

> Catch ce-workflow up with the new releases of the Pi packages and scoped upstream source/skill repos it still uses: review every release after the last reviewed version up to the target, decide what helps or breaks this repository, apply what is adopted, then record the reviewed versions.

## Review targets

| Package | Last reviewed | Target | Installed | Changelog excerpt | Full diff |
|---|---|---|---|---|---|
| @earendil-works/pi-coding-agent | 1.5.0 | 1.5.2 | 1.5.0 | `C:\SOFT\git\ce-workflow\.pi\work-catch-up\2026-11-11T19-51-37-239Z\earendil-works-pi-coding-agent-1.5.0-to-1.5.2.changelog.md` | `C:\SOFT\git\ce-workflow\.pi\work-catch-up\2026-11-11T19-51-37-239Z\earendil-works-pi-coding-agent-1.5.0-to-1.5.2.diff` |
| pi-subagents | 0.86.0 | 0.88.0 | 0.86.0 | `C:\SOFT\git\ce-workflow\.pi\work-catch-up\2026-11-11T19-51-37-239Z\pi-subagents-0.86.0-to-0.88.0.changelog.md` | `C:\SOFT\git\ce-workflow\.pi\work-catch-up\2026-11-11T19-51-37-239Z\pi-subagents-0.86.0-to-0.88.0.diff` |
| pi-lens | 4.4.9 | 4.4.12 | 4.4.12 | `C:\SOFT\git\ce-workflow\.pi\work-catch-up\2026-11-11T19-51-37-239Z\pi-lens-4.4.9-to-4.4.12.changelog.md` | `C:\SOFT\git\ce-workflow\.pi\work-catch-up\2026-11-11T19-51-37-239Z\pi-lens-4.4.9-to-4.4.12.diff` |
| meta/astryx | fd5cf0d | b8335ba | git repo | `C:\SOFT\git\ce-workflow\.pi\work-catch-up\2026-11-11T19-51-37-239Z\meta-astryx-fd5cf0d-to-b8335ba.changelog.md` | `C:\SOFT\git\ce-workflow\.pi\work-catch-up\2026-11-11T19-51-37-239Z\meta-astryx-fd5cf0d-to-b8335ba.diff` |
| nexu-io/open-design | 07a86b1 | 6147958 | git repo | none | `C:\SOFT\git\ce-workflow\.pi\work-catch-up\2026-11-11T19-51-37-239Z\nexu-io-open-design-07a86b1-to-6147958.diff` |

Several releases may lie between the last reviewed version and the target; review all of them, not only the newest notes. Start from the changelog excerpt (the CHANGELOG lines added across every intermediate release). The full diff (`npm diff` between the versions) can be very large: search it with rg for the files or APIs a change names instead of reading it whole. Without an excerpt, or when the diff starts with an error, read the changelog from the installed package or its GitHub releases.

## How to review (planning)

1. For each target, list the changes in every release since the last reviewed version that could affect ce-workflow: Pi extension hooks/events/context, tool registration and exposure, commands, settings, SDK, TUI, model runtime; for plugins their tool schemas, lifecycle and skills. Skip unrelated trivia.
2. Understand before judging. When a change touches a feature or term you cannot explain from this repository (for example "codemode can now do X"), research it first: the package's README/docs/examples (Pi docs live in the installed package's docs/), its source in node_modules, context7, or the web. Put a one-line explanation of the feature in the decision rationale. Never grade a change you could not explain.
3. Map each change to this repository: search extensions/ and scripts/ for the affected API or feature and state what it would fix, delete, simplify or enable here — or why it does not apply.
   For an upstream repo (meta/astryx: ledger `docs/upstream/astryx.md`; nexu-io/open-design: ledger `docs/upstream/open-design.md`), read its ledger first: what we adopted, where it lives here and the commit we tested. The diff starts with `git diff --name-status`.
   - Adopted skills: diff each one's upstream path. For every real change (a new rule, technique or fix, not rewording), say what it would change in our copy or prompt.
   - New skills (`A <dir>/SKILL.md`): desk-review each like `docs/proposals/2026-11-08-mattpocock-skills-review.md` (summary, overlap here, verdict adopt idea / A/B test / already covered / skip, reason).
   - Rejected or skipped skills: only when a change removes the recorded reason.
   - Adopted library/API contracts: follow the ledger's scoped paths, browser-floor and license changes. Keep the git review commit separate from installed npm pins; never upgrade a runtime just by advancing this review. Use the relevant API/build/browser regressions, not skill text grading.
   Offer every finding through plan3 ideas so the user accepts or rejects each one: test first (skills-lab A/B per `docs/proposals/skills-lab/design.md` for skill/prompt changes, contract-specific regressions for libraries; graded Trial), adopt directly, or reject. Accepted ones become Phase 1 steps. Update the ledger (tested commit, adopted and rejected lists) as a Phase 1 step.
4. Grade it: Adopt or Trial → status "adopted"; Reject or Not-our-problem → status "no-action". Hold is not allowed: when you cannot decide, ask the user with the tradeoff and your recommendation, and record the answer in Decisions.
5. Record every graded change in the Catch-up decisions JSON below (a package with nothing relevant gets one Not-our-problem decision saying so). For each adopted change, add a step to Phase 1 with its focused check; when nothing is adopted, replace the Phase 1 placeholder with "None — nothing adopted."

## Catch-up decisions

Fill during planning. Each entry: {"title", "pov": "Adopt|Trial|Reject|Not-our-problem", "status": "adopted|no-action", "rationale"}; adopted entries also need "verification" (the check command and its result), added when the step is done. The recorder fills in the version.

```json
{
  "@earendil-works/pi-coding-agent": [
    {
      "title": "Pin the devDependency to the reviewed release 1.5.2",
      "pov": "Adopt",
      "status": "adopted",
      "rationale": "package.json pins @earendil-works/pi-coding-agent 1.5.0 for type checks and tests (local node_modules reads 1.5.0), while the host runs the 1.5.2 release (~/.pi/agent/install/releases/1.5.2). Earlier catch-ups adopted the same pin rule (d09de120, 29288787). Step CU-01.",
      "verification": "CU-01: npm install --save-dev --save-exact @earendil-works/pi-coding-agent@1.5.2 passed; installed package version prints 1.5.2; lockfile changes only Pi packages and its Mermaid dependency replacement."
    },
    {
      "title": "cacheWarming now defaults to idle: re-arm ce-workflow's cold-cache compaction around warms",
      "pov": "Adopt",
      "status": "adopted",
      "rationale": "Idle warming re-sends the prompt with a one-token output cap for up to 30 minutes between runs when Pi expects it to save money (pi-ai dist/cache-warming.js evaluateCacheWarming: 0.15 x missCost - warmCost >= $0.05). coldCacheCompactMinutes (work-models.ts) counts cache_warm usage entries as fresh, so after a warm the idle-compaction timer and the hub's compact-before-park (sessions.ts compactBeforePark) skip compaction and the next message waits for it. Rare today (about 345k prompt tokens on Opus 5.5, 270k on GPT-6.1 Sol, 86k on Fable 5.2), but the user chose to keep warming and re-arm compaction (Q-01), and to make the cold-cache threshold one setting at 70% of the auto-compact point. Steps CU-03 to CU-05."
    },
    {
      "title": "Anthropic message threads",
      "pov": "Not-our-problem",
      "status": "no-action",
      "rationale": "Requests on api.anthropic.com send only new messages and continue a server-side thread; any changed prefix (compaction, tool list) sends the full request, and thread_not_found and similar rejections retry once as a new thread (pi-ai dist/api/anthropic-messages.js sendThreadRequest). Recent sessions show 6 thread_not_found fallbacks, each recovered. Claude pool account switches land in the same fallback. hub/src/cache-miss.ts reads usage fields only; usage reported under threads was not separately verified."
    },
    {
      "title": "Missing session cwd: Continue, Fork or Cancel",
      "pov": "Not-our-problem",
      "status": "no-action",
      "rationale": "The prompt is interactive only (interactive-mode.js promptForMissingSessionCwd; main.js shows it only through the startup selector). ce-workflow calls no ctx.switchSession, and hub sessions run in RPC mode, whose path is unchanged."
    },
    {
      "title": "ctx.ui.custom() overlays now honor blocked",
      "pov": "Reject",
      "status": "no-action",
      "rationale": "The 1.5.0 review rejected this because overlays ignored the option; 1.5.1 removes that reason. The option only reports OSC 7501 program status blocked (docs/terminal-setup.md Program status) for Rex or iTerm2. This setup is Windows Terminal plus the hub, which tracks open questions itself."
    },
    {
      "title": "grep, find, read and edit tool fixes; GrepOperations.readFile deprecated",
      "pov": "Not-our-problem",
      "status": "no-action",
      "rationale": "rg finds no GrepOperations, ReadOperations, createGrepTool or createReadTool in extensions or hub/src, so the breaking grep change and the streaming read change reach nothing here; the Windows find and line-ending fixes help without code."
    },
    {
      "title": "pi auth login/logout from the shell",
      "pov": "Not-our-problem",
      "status": "no-action",
      "rationale": "The hub's Re-login runs cpool login (hub/src/pool.ts), not Pi's /login."
    },
    {
      "title": "Markdown transformer surfaces, Mermaid, classifiers, new models and default models, compat flags, RPC shutdown and reload fixes, pi update summaries",
      "pov": "Not-our-problem",
      "status": "no-action",
      "rationale": "rg finds no registerMarkdownTransformer in ce-workflow; jev tools pick their own classifier; plan3.ts calls ctx.shutdown only in terminal sessions; the hub never reloads over RPC (it parks and resumes); hub/src/cli.ts runs pi update with inherited stdio and parses nothing. reviewExtensionFinalist still names claude-opus-5 on purpose; the new anthropic default does not change it."
    }
  ],
  "pi-subagents": [
    {
      "title": "provider/id models run only on that provider (0.87.0)",
      "pov": "Not-our-problem",
      "status": "no-action",
      "rationale": "spawnSubagentRpc (work-models.ts) retries the knowledge discoverer on the inherited model when a configured model fails to launch; advisor models come from /wo Plan models, which lists signed-in providers."
    },
    {
      "title": "Truncated final replies now fail (0.88.0)",
      "pov": "Not-our-problem",
      "status": "no-action",
      "rationale": "The only ce-workflow child that parses output, context-knowledge-discoverer, returns structured_output against KNOWLEDGE_DISCOVERER_SCHEMA, which upstream still counts as success."
    },
    {
      "title": "Fork copy cleanup, supervisor waits outside timeoutMs, progress in widget and status, list cap and search, stop drain, defaultInheritGlobalContext, Windows and Electron fixes",
      "pov": "Not-our-problem",
      "status": "no-action",
      "rationale": "ce-workflow manages no fork copies, sets no run timeoutMs, does not call list, and ships its utility agents with explicit inheritProjectContext. defaultInheritGlobalContext is a user setting in ~/.pi/agent/settings.json, not package code. The installed copy already reads 0.88.0."
    }
  ],
  "pi-lens": [
    {
      "title": "4.4.10 to 4.4.12 tool, guard, runner and config changes",
      "pov": "Not-our-problem",
      "status": "no-action",
      "rationale": "ce-workflow calls no pi-lens tool from code and only lists the unchanged names read_symbol, read_enclosing, module_report and lens_diagnostics. The MCP-only path argument change, the complexity-vs-main edit line, glob and lang filters and the .pi-lens.json upward layering need nothing here; work-lens-format.ts writes only the global ~/.pi-lens/config.json format.enabled key, which layering does not touch."
    }
  ],
  "meta/astryx": [
    {
      "title": "Watched packages/cli/api-report.md was deleted upstream",
      "pov": "Adopt",
      "status": "adopted",
      "rationale": "b8335ba deletes packages/cli/api-report.md and the api:report scripts. The baseline still watches that path and the ledger cites it as part of the palette contract; packages/cli/api/index.mjs stays watched for exports. Drop the path and advance the ledger review commit. Step CU-02."
    },
    {
      "title": "Runtime 0.7.12 to 0.7.14: Core 0.7.13 fixes and CLI lookup changes",
      "pov": "Reject",
      "status": "no-action",
      "rationale": "Manifests move to 0.7.14. Core 0.7.13 drops data: URLs in Markdown, shares the layer runtime with swizzled copies, keeps light-dismiss Popovers open during an outside touch pan, and renders disabled submit Buttons as type=button while hydrating. Search ignores keywords that name another entry, component reads add an example-block pointer to errors, and theme.list adds meta.skippedThemes. In the watched Selector and theme paths, the Selector list now writes its entrance side itself after the overlay margin moves it (hooks.ts, usePopoverInternal writesEntranceSide), and the theme and icon registries are shared by every Core copy on one React (themeRegistry.ts sharedForReact); our foundation builds one Core copy per design, so neither changes a contract we rely on. None fixes a failure in our pinned 0.7.12 runtime. Per the ledger, a runtime bump is a separate pin, integrity and browser review."
    }
  ],
  "nexu-io/open-design": [
    {
      "title": "No changes in the review paths",
      "pov": "Not-our-problem",
      "status": "no-action",
      "rationale": "The scoped git diff 07a86b1..6147958 over the ledger's review paths is empty: no craft rule, skill, template, prompt, comment bridge or export changed. The ledger's review commit advances in CU-02."
    }
  ]
}
```

## Glossary

- **Cold-cache compaction**: ce-workflow compacting a large session because its prompt cache has expired, so the next request would re-bill the whole prompt anyway. Avoid: early compaction.
- **Idle cache warming**: Pi re-sending the last prompt between runs, with a one-token output cap, to keep its cache alive. Avoid: keep-alive.

## Relevant files and approach

- `package.json`, `package-lock.json`: **fits**. The devDependency pin is one npm command, as in earlier catch-ups.
- `extensions/work-catch-up-baseline.json` (meta/astryx `paths`) and `docs/upstream/astryx.md`, `docs/upstream/open-design.md`: **fits**. The ledger owns the watch list and the review commit; `recordCatchUp` keeps `paths` (Object.assign) and writes only versions and decisions.
- `extensions/work-models.ts` (`coldCacheCompactMinutes`, `armIdleCompact`, `startEarlyCompact`, the `turn_end` cold check, `/wo context`): **fits**. coldCacheCompactMinutes owns the cold rule; the two literal shares (0.6 there, 0.65 in turn_end) become one setting read in that one function, and the warm handler sits beside `armIdleCompact`.
- `hub/src/sessions.ts` (`compactBeforePark`) and `hub/scripts/fake-pi.mjs`: **fits**. One prompt string, mirrored by the fake.
- No locked write path is added or changed: settings go through the existing `writeSettings`.

## Decisions

- **D-01 Pin the Pi devDependency to 1.5.2.** Same rule as the 1.4.0 and 1.5.0 catch-ups: tests and type checks build against the reviewed host release. Source: agent, from precedent d09de120.
- **D-02 Astryx review advances; the runtime stays 0.7.12.** The ledger keeps the git review commit apart from the npm pins; nothing in 0.7.13 or 0.7.14 fixes a failure we hit. Source: docs/upstream/astryx.md "Two independent pins".
- **D-03 Keep Pi's idle warming; re-arm cold-cache compaction around it.** Each idle `cache_warming_decision` with action warm restarts the idle-compaction timer, so compaction runs one TTL after the last warm. Compact-before-park also compacts when only idle warms keep the cache warm, because parking ends the warming. Beat: stopping idle warming for big sessions (simpler, but loses warming's savings when the user returns within 30 minutes). Source: user via ask_user (Q-01).
- **D-05 One cold-cache compaction threshold: `workOrchestrator.context.coldCompactPercent`, default 70.** A percentage of the auto-compact trigger of the active mode: ultracompact and ultrafull use ce-workflow's trigger, native-200k its own trigger, and Native Pi's own (context window minus `compaction.reserveTokens`, default 16,384), replacing the hard-coded 60% (idle, park, send) and 65% (after tool results). Set with `/wo context cold <percent>` (integer 1 to 100), shown in `/wo context status`; like `compactAtTokens` it has no Settings menu row. Source: user via ask_user, confirming the reading of "these 150k should not be a hard value, but a % of what we autocompact at, default at 70%".
- **D-06 Hub park sends `/wo compact early park`.** A session still running an older extension would read the unknown argument as a microcompact; the hub and the extension ship in one package and a hub update restarts every session, so that needs a hand-mixed install. Source: agent (labelled assumption).
- **D-07 No end-to-end benchmark for CU-03 to CU-05.** They fix when cold-cache compaction runs around Pi's warms and make the user-chosen threshold configurable; nothing is retained or described as an optimization, so the Optimization Regression Rule's paired benchmark does not apply. The warm path also needs 270k+ prompt tokens and 10+ idle minutes, which a benchmark run would not reach. Source: review finding 4, agent.
- **D-04 Patch, no prefactor.** Every change is a one-place edit in the module that owns it. Source: agent fit check.

- **Q-01** Leave Pi 1.5.1's idle cache warming alone, even though a warm postpones ce-workflow's idle compaction?
  - Context: Since 1.5.1, `cacheWarming: "idle"` keeps a prompt cache warm for up to 30 minutes between runs when Pi expects it to save at least $0.05. ce-workflow compacts a big session once its cache expires (idle timer at TTL+15 s, and the hub's compact-before-park after 10 idle minutes). Both read a cache_warm entry as "still warm", so after a warm neither compacts; the user then waits for compaction on the next message. The trigger needs about 345k prompt tokens on Opus 5.5 and 270k on GPT-6.1 Sol, but only about 86k on a pricier model such as Claude Fable 5.2 ($8/M input); ultrafull checkpoints at 150k. All 236 warms since 11-09 were Opus 5.5.
  - Recommendation: No change now; revisit when sessions run expensive models or contexts above 270k.
  - Option: No change — nothing to build; the gap only shows on expensive models or very large contexts.
  - Option: Stop idle warming for big sessions — a cache_warming_decision handler returns stop while idle when context is at or above the cold-compaction share; restores the old compaction timing, gives up warming there.
  - Option: Re-arm idle compaction after each warm — keeps warming; idle compaction runs once warming stops, but compact-before-park still finds a warm cache and needs its own change.
  - Option: Set cacheWarming to streaming globally — a user setting in ~/.pi/agent/settings.json; turns idle warming off everywhere.
  - Independent: yes
  - Answer: Re-arm idle compaction after each warm; the cold-cache threshold becomes a % of the auto-compact point, default 70% (confirmed: one setting replacing 60% and 65%).
  - Source: user via ask_user during planning; recorded in D-03 and D-05.
- **User preference (standing):** launch Pi processes started by tests hidden or in the background, never in the foreground ("constantly running some pi processes in a foreground ... killing my focus, can you please launch hidden").
- **User preference (standing):** validate with automated checks and finish the plan; ask the user only for what tools cannot observe, such as hardware or a printout.


## Open questions

### Blocking

None.

### Deferred

None.

## Commands

- `npm install --save-dev --save-exact @earendil-works/pi-coding-agent@1.5.2`: updates package.json and package-lock.json.
- `node scripts/test-work-plan3.mjs`: holds the catch-up plan and recorder checks.
- `node scripts/test-work-compaction-notifications.mjs`: holds the cold-cache, idle-compaction and `/wo compact early` checks.
- `node --test scripts/test-sessions.mjs`, run in `hub/`: holds the auto-park and compact-before-park checks.
- `npm run verify:quiet`: full suite, once, in CU-90.
- `node scripts/work-catch-up-record.mjs acd778fe`: records the reviewed versions.

## Phases

### Phase 1: Apply adopted changes [code]

- [x] **CU-01** Pinned Pi devDependency and lockfile to 1.5.2; installed version verified.
- [ ] **CU-02** Drop packages/cli/api-report.md from the meta/astryx baseline paths; advance the Astryx and OpenDesign ledgers to b8335ba and 6147958.
  - astryx.md: add review baseline b8335ba (manifests 0.7.14) and keep fd5cf0df987791117e96ccc0bec603c64be8b136 as the previous review, runtime pins unchanged at 0.7.12; remove the api-report.md cell; list the rejected 0.7.13 Core and CLI lookup changes in one line.
  - test-work-plan3.mjs requires the ledger to contain the baseline's current full SHA (still fd5cf0d until CU-91) and the strings 0.7.12 and 0.7.13, so the old SHA stays as history; do not weaken that assertion.
  - open-design.md: note that 6147958 was reviewed with no changes in the review paths.
  - Check: `node scripts/test-work-plan3.mjs` passes; `rg -n "api-report" extensions docs/upstream` finds nothing.
- [ ] **CU-03** Replace the 60% and 65% cold-cache shares with `coldCompactPercent` (default 70) of the auto-compact trigger; add `/wo context cold <percent>`.
  - coldCacheCompactMinutes reads the setting itself; drop its share parameter and the 0.65 argument in turn_end. Clamp to an integer 1 to 100; status prints the percent and the token count.
  - Its denominator is the active mode's trigger (D-05); today Native wrongly uses ce-workflow's trigger. One helper serves both coldCacheCompactMinutes and status.
  - README: one sentence next to `/wo context set`. CHANGELOG: one Unreleased bullet.
  - Check: test-work-compaction-notifications.mjs asserts 65% no longer compacts by default, 70% does, a project setting of 50 compacts at 50%, each of the four modes uses its own trigger (Native: window minus reserveTokens), and turn_end uses the same value; update the "cold cache at 65%" case.
- [ ] **CU-04** Re-arm idle compaction on each idle `cache_warming_decision` whose action is warm, so it runs one TTL after the last warm.
  - Only when `ctx.isIdle()` is not false; never change Pi's decision. A stop decision keeps the timer already armed.
  - Pi fires the decision before the warm request and writes cache_warm after it returns (cache-warmer.js), so a slow warm can land after the timer was armed. When the timer finds a newer cache_warm, it re-arms for that entry's remaining TTL plus 15 s instead of ending; any new turn or input still cancels it.
  - Check: test-work-compaction-notifications.mjs drives agent_end, a warm decision and a cache_warm entry at 0.9 TTL, then the timer: compaction starts only after TTL+15 s from the warm. A second case writes the final cache_warm 20 s after its decision with no later decision and still compacts.
- [ ] **CU-05** Compact before parking when only idle warms keep the cache warm: hub sends `/wo compact early park`, which counts a trailing cache_warm as cold.
  - A real request inside the TTL (long retention) still parks without compaction. fake-pi.mjs mirrors the new command; CHANGELOG bullet in plain words.
  - Check: test-work-compaction-notifications.mjs (warm-only park compacts, a recent real request does not) and `node --test scripts/test-sessions.mjs` in hub/.

### Phase 2: Verify and record [code]

- [ ] **CU-90** Run `npm run verify:quiet` after the adopted changes and record the result.
- [ ] **CU-91** Record the reviewed versions: `node scripts/work-catch-up-record.mjs acd778fe`.
  - It writes exactly the target versions above (not newer releases) into `extensions/work-catch-up-baseline.json`.
  - It refuses missing, unexplained or unverified decisions.
  - Before it runs, fill the verification field of every adopted decision from its step's check.
  - Check after recording: `node scripts/test-work-plan3.mjs` passes, so the Astryx ledger contains the newly recorded b8335ba.

## Acceptance

- package.json and package-lock.json pin `@earendil-works/pi-coding-agent` 1.5.2.
- The meta/astryx watch list no longer names a deleted upstream file, and both ledgers name the reviewed commits.
- An idle session compacts its cold cache one TTL after Pi's last idle warm; a hub park compacts a session that only idle warms kept warm.
- Cold-cache compaction starts at `coldCompactPercent` (default 70%) of the auto-compact trigger on every cold path.
- The changelog and summaries describe CU-03 to CU-05 as a timing fix and a user-chosen setting, never as a measured cost or token saving.
- `npm run verify:quiet` passes.
- `extensions/work-catch-up-baseline.json` records Pi 1.5.2, pi-subagents 0.88.0, pi-lens 4.4.12, meta/astryx b8335ba and nexu-io/open-design 6147958.

## Resume context

Planning and two reviews done; status draft, awaiting /plan3 finish. Second review accepted both findings: Native mode's cold threshold uses Pi's own trigger (D-05, CU-03), and the Astryx Selector and theme-registry changes are recorded in the runtime rejection. Next: CU-01. No blockers.

## Amendments

- 2026-11-11: Generated by /wo → Catch up packages.
- 2026-11-11 review (plan3-advisor, gpt-6-astra):
  - Finding 1, slow final warm leaves the one-shot idle timer expired: accepted. Pi 1.5.2 cache-warmer.js fires the decision before awaiting the request and appends cache_warm after it; CU-04 now re-arms from a newer warm and tests a 20 s warm.
  - Finding 2, ledger SHA test conflicts with CU-02: accepted. test-work-plan3.mjs:1145 asserts the ledger holds the baseline SHA and 0.7.12 and 0.7.13; CU-02 keeps fd5cf0d as history, CU-91 re-runs the test.
  - Finding 3, unexported package.json subpath: accepted. The require fails with the package-exports error; the check now reads ./node_modules directly (prints 1.5.0 today).
  - Finding 4, Optimization Regression Rule benchmark: rejected. The change is a timing fix plus a user-chosen setting, not an optimization claim (D-07); an acceptance line forbids describing it as a saving.
- 2026-11-11 second review (plan3-advisor, gpt-6-astra):
  - Finding 1, Native mode's cold threshold uses ce-workflow's trigger: accepted. coldCacheCompactMinutes (work-models.ts:2267) picks nativeCompactionTrigger only for native-200k; Pi's shouldCompact (compaction.js) fires at contextWindow - reserveTokens. D-05 now names each mode's trigger; CU-03 shares one helper with status and tests all four modes.
  - Finding 2, Astryx Selector and theme-registry changes not recorded: accepted. Diff lines 4821-4955 and 5120-5146 confirmed; the runtime-rejection rationale now names both and why they do not affect the pinned single-copy foundation.
