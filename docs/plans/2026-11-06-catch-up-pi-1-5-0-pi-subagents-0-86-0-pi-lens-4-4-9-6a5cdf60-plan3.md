---
plan3: true
status: ready
created: 2026-11-06
source: catch-up
catch-up: {"@earendil-works/pi-coding-agent":"1.5.0","pi-subagents":"0.86.0","pi-lens":"4.4.9"}
updated: 2026-11-06T10:12:45.350Z
reviewed: 2026-11-06
---

# Catch up Pi 1.5.0, pi-subagents 0.86.0, pi-lens 4.4.9

## Original request

> Catch ce-workflow up with the new releases of the Pi packages it still uses: review every release after the last reviewed version up to the target, decide what helps or breaks this repository, apply what is adopted, then record the reviewed versions.

## Review targets

| Package | Last reviewed | Target | Installed | Changelog excerpt | Full diff |
|---|---|---|---|---|---|
| @earendil-works/pi-coding-agent | 1.4.0 | 1.5.0 | 1.5.0 | `C:\SOFT\git\ce-workflow\.pi\work-catch-up\2026-11-06T09-06-11-004Z\earendil-works-pi-coding-agent-1.4.0-to-1.5.0.changelog.md` | `C:\SOFT\git\ce-workflow\.pi\work-catch-up\2026-11-06T09-06-11-004Z\earendil-works-pi-coding-agent-1.4.0-to-1.5.0.diff` |
| pi-subagents | 0.84.0 | 0.86.0 | 0.79.1 | `C:\SOFT\git\ce-workflow\.pi\work-catch-up\2026-11-06T09-06-11-004Z\pi-subagents-0.84.0-to-0.86.0.changelog.md` | `C:\SOFT\git\ce-workflow\.pi\work-catch-up\2026-11-06T09-06-11-004Z\pi-subagents-0.84.0-to-0.86.0.diff` |
| pi-lens | 4.4.8 | 4.4.9 | 4.4.9 | `C:\SOFT\git\ce-workflow\.pi\work-catch-up\2026-11-06T09-06-11-004Z\pi-lens-4.4.8-to-4.4.9.changelog.md` | `C:\SOFT\git\ce-workflow\.pi\work-catch-up\2026-11-06T09-06-11-004Z\pi-lens-4.4.8-to-4.4.9.diff` |

Several releases may lie between the last reviewed version and the target; review all of them, not only the newest notes. Start from the changelog excerpt (the CHANGELOG lines added across every intermediate release). The full diff (`npm diff` between the versions) can be very large: search it with rg for the files or APIs a change names instead of reading it whole. Without an excerpt, or when the diff starts with an error, read the changelog from the installed package or its GitHub releases.

## How to review (planning)

1. For each target, list the changes in every release since the last reviewed version that could affect ce-workflow: Pi extension hooks/events/context, tool registration and exposure, commands, settings, SDK, TUI, model runtime; for plugins their tool schemas, lifecycle and skills. Skip unrelated trivia.
2. Understand before judging. When a change touches a feature or term you cannot explain from this repository (for example "codemode can now do X"), research it first: the package's README/docs/examples (Pi docs live in the installed package's docs/), its source in node_modules, context7, or the web. Put a one-line explanation of the feature in the decision rationale. Never grade a change you could not explain.
3. Map each change to this repository: search extensions/ and scripts/ for the affected API or feature and state what it would fix, delete, simplify or enable here — or why it does not apply.
4. Grade it: Adopt or Trial → status "adopted"; Reject or Not-our-problem → status "no-action". Hold is not allowed: when you cannot decide, ask the user with the tradeoff and your recommendation, and record the answer in Decisions.
5. Record every graded change in the Catch-up decisions JSON below (a package with nothing relevant gets one Not-our-problem decision saying so). For each adopted change, add a step to Phase 1 with its focused check; when nothing is adopted, replace the Phase 1 placeholder with "None — nothing adopted."

## Catch-up decisions

Each entry: {"title", "pov": "Adopt|Trial|Reject|Not-our-problem", "status": "adopted|no-action", "rationale"}; adopted entries also need "verification" (the check command and its result), added when the step is done. The recorder fills in the version.

```json
{
  "@earendil-works/pi-coding-agent": [
    {
      "title": "Pin the devDependency to the reviewed release 1.5.0",
      "pov": "Adopt",
      "status": "adopted",
      "rationale": "package.json still pins @earendil-works/pi-coding-agent 1.4.0 for type checks and tests, while the host now runs 1.5.0 (summary.json installedVersion). The 1.4.0 catch-up adopted the same pin rule. Step CU-01."
    },
    {
      "title": "Image resizing now picks the smaller of PNG and JPEG: keep generate_image output PNG",
      "pov": "Adopt",
      "status": "adopted",
      "rationale": "1.5.0 'Fixed resized photos being sent as multi-megabyte PNGs': resizeImage now tries the smaller encoding first (dist/utils/image-resize-core.js `const preferred`); 1.4.0 always took PNG first when no byte budget applied. extensions/work-images.ts fitImage scales every sized generate_image result (Codex draws about 1448x1086 for 800x600) with maxBytes MAX_SAFE_INTEGER, and execute() names the file by the returned mimeType, so a requested out.png can now be saved as out.jpg, and pngSize() then skips the size check. shrinkImage (process_image input) benefits from smaller JPEGs and stays as is. Step CU-02."
    },
    {
      "title": "Tool argument validation moved to pi-schema (breaking change)",
      "pov": "Not-our-problem",
      "status": "no-action",
      "rationale": "Pi now validates tool arguments as plain JSON Schema and coerces loosely typed values for every tool, and drops a null in an optional property whose schema rejects null (pi-schema dist/coerce.js). rg finds no Type.Refine, BigInt, Undefined, Codec or Format.Set in extensions, scripts or hub/src, and no test asserts TypeBox error wording. extensions/ask-user imports @sinclair/typebox, which the 1.5.0 loader still maps (core/extensions/loader.js). Required nullable fields use type unions that accept null; jev_triage state has an empty schema, so coercion passes it through."
    },
    {
      "title": "Extension update changelogs shown by Pi after a package update",
      "pov": "Not-our-problem",
      "status": "no-action",
      "rationale": "Pi reads CHANGELOG.md from an extension package and shows entries newer than the last seen version on the next fresh TUI launch (docs/packages.md 'Show a changelog'). Its parser (dist/utils/changelog.js) matches our `## x.y.z — date` headings and skips `## Unreleased`; every push bumps package.json version, so ce-workflow notes appear once per update. Hub sessions run in RPC mode, where the interactive notice does not show, and the hub keeps its own changelog. Default kept."
    },
    {
      "title": "ctx.ui.custom() `blocked` option for inline dialogs",
      "pov": "Reject",
      "status": "no-action",
      "rationale": "The option only makes Pi report OSC 7501 program status `blocked` (Rex, iTerm2; docs/terminal-setup.md 'Program status'). The vendored ask-user defaults to overlays, which ignore it; inline list menus in extensions/ask-user/menu.ts could pass it, but this setup is Windows plus the hub, which tracks open questions itself."
    },
    {
      "title": "pi.exec, setActiveTools order, tool_search ranking, Windows path case and session-write fixes",
      "pov": "Not-our-problem",
      "status": "no-action",
      "rationale": "Host fixes that help without code changes: pi.exec output cap and SIGKILL after timeout (plan3.ts and browser-fetch.ts call pi.exec for short commands), no redundant system prompt update when the exposure manager re-sets the same tools in another order, better tool_search and searchTools ranking for tools_enable and codemode, case-insensitive Windows path comparison in Pi, and no lost history after a failed session write."
    },
    {
      "title": "selfUpdateCommand, keyHint/keyText injection, MarkdownTransformContext ids, responseModel",
      "pov": "Not-our-problem",
      "status": "no-action",
      "rationale": "rg finds no use of keyHint, keyText, markdown transforms or responseModel in extensions or hub/src. The hub's Update all runs pi update --all on the pi.dev installer, which needs no custom update command."
    },
    {
      "title": "Usage.cost.totalFromProvider: keep summed compaction usage correct",
      "pov": "Adopt",
      "status": "adopted",
      "rationale": "1.5.0 adds the boolean Usage.cost.totalFromProvider, true when the total is the provider's billed amount; combined usage counts as provider-reported only when every part is. Two loops add every cost field as a number: extensions/work-models.ts (chunked native summary, around line 1694) and extensions/work-compaction-memory.ts (hybrid memory attempts, around line 251). A true flag becomes 1, and mixed parts stay truthy. Sum only numeric fields and AND the flag. Step CU-04 (found by the plan review)."
    },
    {
      "title": "Model catalog v2: image-only models are no longer chat models",
      "pov": "Not-our-problem",
      "status": "no-action",
      "rationale": "generateImages() in extensions/work-images.ts finds image models with registry.findOfType('image', ...) and only draws with chat models of api openai-codex-responses, so removing image-only models from the chat list changes nothing here."
    }
  ],
  "pi-subagents": [
    {
      "title": "Session switches with background work now ask stay, take or leave: report a cancelled Plan3 handoff",
      "pov": "Adopt",
      "status": "adopted",
      "rationale": "0.85.0 adds a session_before_switch guard (src/extension/session-switch.js): with queued or running runs, undelivered results or open supervisor questions it asks via ctx.ui.select, and in RPC mode a 60 s timeout cancels the switch. The hub's new_session path already reports `Pi kept the current session.` (hub/src/sessions.ts). Plan3 startFresh (extensions/plan3.ts) ignores ctx.newSession's `{ cancelled }` result, so a refused or timed-out switch leaves the user with no message after the handoff. Step CU-03."
    },
    {
      "title": "Workflow children go through a nested subagent_launch tool call",
      "pov": "Not-our-problem",
      "status": "no-action",
      "rationale": "0.85.0 runs a deferred, model-hidden subagent_launch tool before each workflow child so tool_call handlers can block it (src/extension/subagent-launch-tool.js). Every ce-workflow tool_call handler filters on its own tool names (bash, read, intercom, ask_user, subagent), so none blocks it. Changing event.input does not reach the child, because pi-subagents launches from its own args object, so advisor-model.ts cannot pin the oracle model there and keeps its prompt guideline for workflow scripts."
    },
    {
      "title": "Subagent tools restored after compaction once pi-subagents was reloaded",
      "pov": "Not-our-problem",
      "status": "no-action",
      "rationale": "0.86.0 fix (#3198). Idle sessions in the hub reload onto updated extensions by themselves, so this upstream fix removes a case where subagent and subagents_enable disappeared after a later compaction; nothing to change here."
    },
    {
      "title": "structured_output checked strictly against outputSchema",
      "pov": "Not-our-problem",
      "status": "no-action",
      "rationale": "0.85.0 validates the model's raw structured_output before Pi coercion. The context-knowledge-discoverer schema (KNOWLEDGE_DISCOVERER_SCHEMA in work-models.ts) uses plain strings, enums and string arrays; a wrong type now fails validation and the child calls again, which is correct."
    },
    {
      "title": "Resume hardening, waitTool.name, requireLauncher, workflow script sandbox, Herdr and Rex placement fixes",
      "pov": "Not-our-problem",
      "status": "no-action",
      "rationale": "ce-workflow registers no bg_wait, sets no launcher or placement, and starts its subagents through spawnSubagentRpc or the subagent tool. Runs started before 0.85.0 cannot be resumed, which only affects runs that were already interrupted."
    }
  ],
  "pi-lens": [
    {
      "title": "4.4.9 tool output and guard changes",
      "pov": "Not-our-problem",
      "status": "no-action",
      "rationale": "4.4.9 changes lsp_navigation's default output to text, rejects unknown severity and read_symbol kind values, routes partial edit applies through Pi's edit tool, and repeats unresolved blockers at the next prompt. ce-workflow calls none of these tools from code: work-compaction.ts and work-models.ts only list the names read_symbol, read_enclosing, module_report and lens_diagnostics, and these names are unchanged. The only ce-workflow write guard (extensions/plan3.ts, around line 1900) handles the write tool for new Plan3 files; the upstream change concerns partial edit batches, and no ce-workflow handler guards edit, so it has nothing to reach."
    }
  ]
}
```

## Decisions

- **D1 (evidence)**: Generated images stay PNG. When Pi's resize returns another format, CU-02 converts it back with Pi's exported `convertToPng`, asking for `jpegQuality: 100` so a JPEG candidate is near lossless before conversion. Source: the generate_image schema says "Output .png path"; Pi 1.5.0 `ImageResizeOptions` has no format option. The user chose this approach in Q-01 (below).
- **D2 (observed, not pursued)**: The review table lists pi-subagents installed as 0.79.1, but every root `installedPackageVersion` reads now holds 0.86.0 or nothing. This only affects a display column; the targets come from npm.
- **D4 (assumed)**: CU-01's lockfile also gains `node_modules/pi-subagents` 0.86.0, because npm 12.2.1 now installs the root's required peer `pi-subagents >=0.75.0`. It is kept: no repo code imports pi-subagents from local node_modules (test-work-native-smoke.mjs resolves the global install). The other version changes in the lockfile are dependencies of the Pi 1.5.0 packages.
- **D3 (observed)**: `scripts/benchmark-context-cache-live.mjs` names the 1.4.0 release path first and falls back to the npm root, so it keeps working after 1.4.0 is removed. No change.
- **Q-01** When Pi's resize returns a JPEG for a generated image, should generate_image convert it back to PNG?
  - Context: Pi 1.5.0 resizeImage picks the smaller of PNG and JPEG, so sized generate_image output (always downscaled from Codex's about 1448x1086) can be saved as .jpg. Pi exports convertToPng; the resize options cannot force PNG.
  - Recommendation: Convert back to PNG with jpegQuality 100; the file keeps the requested name and the size check still runs.
  - Option: Convert back to PNG — keeps the .png contract; one extra encode and a slightly larger file.
  - Option: Keep the unscaled original — always PNG with no JPEG step, but the size argument stops working for most images.
  - Option: Accept JPEG — smallest files, but the saved name and type differ from the requested .png path.
  - Independent: yes
  - Answer: {"kind":"selection","selections":["Convert back to PNG"]}
  - Source: user via ask_user /plan3 resolve; not independently verified.


## Open questions

### Blocking

None.

### Deferred

None.

## Commands

- `npm install --save-dev --save-exact @earendil-works/pi-coding-agent@1.5.0` — updates package.json and package-lock.json.
- `node scripts/test-work-compaction-notifications.mjs` — holds the fitImage checks.
- `node scripts/test-work-plan3.mjs` — holds the startFresh newSession checks.
- `node scripts/test-work-compaction.mjs` — holds the hybrid memory usage checks.
- `npm run verify:quiet` — full suite, once, in CU-90.
- `node scripts/work-catch-up-record.mjs 6a5cdf60` — records the reviewed versions.

## Phases

### Phase 1 — Apply adopted changes [code]

- [x] **CU-01** Pinned the @earendil-works/pi-coding-agent devDependency to 1.5.0 in package.json and package-lock.json.
- [x] **CU-02** fitImage asks for jpegQuality 100 and converts a non-PNG resize of a PNG back with an injectable convertToPng; a failed conversion keeps the original.
- [x] **CU-03** Plan3 startFresh warns "Pi kept this session; the plan is ready · /resume3 <id>" when ctx.newSession returns cancelled.
- [ ] **CU-04** Summed compaction usage: add only numeric cost fields; set `totalFromProvider` true only when every part has it true.
  - Fix both loops: extensions/work-models.ts (around line 1694) and extensions/work-compaction-memory.ts (around line 251).
  - Extend scripts/test-work-compaction.mjs (around line 640) and scripts/test-work-compaction-notifications.mjs (around line 1685): all true, mixed, and absent.
  - Check: both test scripts pass.

### Phase 2 — Verify and record [code]

- [ ] **CU-90** Run `npm run verify:quiet` after the adopted changes and record the result.
- [ ] **CU-91** Record the reviewed versions: `node scripts/work-catch-up-record.mjs <this plan's id>`.
  - It writes exactly the target versions above (not newer releases) into `extensions/work-catch-up-baseline.json`.
  - It refuses missing, unexplained or unverified decisions.
  - Before running it, add each adopted decision's `verification` (command and result from CU-01 to CU-03) to the JSON above.

## Acceptance

- generate_image with a size saves a PNG at the requested path, even when Pi's resize prefers JPEG.
- A cancelled fresh-session handoff in Plan3 tells the user how to continue.
- Summed compaction usage keeps numeric costs and marks the total provider-reported only when every part is.
- package.json and package-lock.json pin `@earendil-works/pi-coding-agent` 1.5.0.
- `npm run verify:quiet` passes.
- `extensions/work-catch-up-baseline.json` records Pi 1.5.0, pi-subagents 0.86.0 and pi-lens 4.4.9.

## Resume context

Planned and reviewed: 4 adopted changes (CU-01 devDependency pin, CU-02 PNG-preserving fitImage with stubbed-converter test, CU-03 cancelled-handoff notice, CU-04 totalFromProvider-safe usage sums); every other change is graded no-action. Q-01 settled (convert back to PNG). No open questions. Next: the user runs /plan3 finish, then CU-01.

## Amendments

- 2026-11-06: Generated by /wo → Catch up packages.
- 2026-11-06: Planned: decisions graded, Phase 1 filled with CU-01 to CU-03.
- 2026-11-06: Review (plan3-advisor, gpt-6-astra), each finding checked against the code:
  - Accepted (major): the two cost-summing loops turn the new boolean `totalFromProvider` into a number; added an Adopt decision and CU-04.
  - Accepted (major): asserting only `image/png` would pass when conversion fails; CU-02 now stubs the converter and asserts resized PNG, the failure fallback and `jpegQuality: 100`. D1 unchanged.
  - Accepted (minor): acceptance mixed the Pi pin, the suite and the baseline; split into separate bullets (the suite does not prove plugin versions).
  - Accepted (minor): the pi-lens rationale wrongly said no handler guards write; plan3.ts guards write for new plans. Rationale corrected, no-action kept.
