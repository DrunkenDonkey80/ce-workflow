---
plan3: true
status: complete
created: 2026-10-06
source: catch-up
catch-up: {"@earendil-works/pi-coding-agent":"1.0.4","pi-subagents":"0.76.1","pi-intercom":"0.16.1"}
updated: 2026-10-06T12:43:54.798Z
started: 2026-10-06T12:43:05.504Z
---

# Catch up pi-coding-agent 1.0.4, pi-subagents 0.76.1, pi-intercom 0.16.1

## Original request

> Catch ce-workflow up with the new releases of the Pi packages it still uses: review every release after the last reviewed version up to the target, decide what helps or breaks this repository, apply what is adopted, then record the reviewed versions.

## Review targets

| Package | Last reviewed | Target | Installed | Changelog excerpt | Full diff |
|---|---|---|---|---|---|
| @earendil-works/pi-coding-agent | 1.0.2 | 1.0.4 | 1.0.4 | `C:\SOFT\git\ce-workflow\.pi\work-catch-up\2026-10-06T12-27-53-209Z\earendil-works-pi-coding-agent-1.0.2-to-1.0.4.changelog.md` | `C:\SOFT\git\ce-workflow\.pi\work-catch-up\2026-10-06T12-27-53-209Z\earendil-works-pi-coding-agent-1.0.2-to-1.0.4.diff` |
| pi-subagents | 0.75.0 | 0.76.1 | 0.76.1 | `C:\SOFT\git\ce-workflow\.pi\work-catch-up\2026-10-06T12-27-53-209Z\pi-subagents-0.75.0-to-0.76.1.changelog.md` | `C:\SOFT\git\ce-workflow\.pi\work-catch-up\2026-10-06T12-27-53-209Z\pi-subagents-0.75.0-to-0.76.1.diff` |
| pi-intercom | 0.16.0 | 0.16.1 | 0.16.1 | none | `C:\SOFT\git\ce-workflow\.pi\work-catch-up\2026-10-06T12-27-53-209Z\pi-intercom-0.16.0-to-0.16.1.diff` |

Several releases may lie between the last reviewed version and the target; review all of them, not only the newest notes. Start from the changelog excerpt (the CHANGELOG lines added across every intermediate release). The full diff (`npm diff` between the versions) can be very large: search it with rg for the files or APIs a change names instead of reading it whole. Without an excerpt, or when the diff starts with an error, read the changelog from the installed package or its GitHub releases.

## How to review (planning)

1. For each target, list the changes in every release since the last reviewed version that could affect ce-workflow: Pi extension hooks/events/context, tool registration and exposure, commands, settings, SDK, TUI, model runtime; for plugins their tool schemas, lifecycle and skills. Skip unrelated trivia.
2. Understand before judging. When a change touches a feature or term you cannot explain from this repository (for example "codemode can now do X"), research it first: the package's README/docs/examples (Pi docs live in the installed package's docs/), its source in node_modules, context7, or the web. Put a one-line explanation of the feature in the decision rationale. Never grade a change you could not explain.
3. Map each change to this repository: search extensions/ and scripts/ for the affected API or feature and state what it would fix, delete, simplify or enable here — or why it does not apply.
4. Grade it: Adopt or Trial → status "adopted"; Reject or Not-our-problem → status "no-action". Hold is not allowed: when you cannot decide, ask the user with the tradeoff and your recommendation, and record the answer in Decisions.
5. Record every graded change in the Catch-up decisions JSON below (a package with nothing relevant gets one Not-our-problem decision saying so). For each adopted change, add a step to Phase 1 with its focused check; when nothing is adopted, replace the Phase 1 placeholder with "None — nothing adopted."

## Catch-up decisions

Fill during planning. Each entry: {"title", "pov": "Adopt|Trial|Reject|Not-our-problem", "status": "adopted|no-action", "rationale"}; adopted entries also need "verification" (the check command and its result), added when the step is done. The recorder fills in the version.

```json
{
  "@earendil-works/pi-coding-agent": [
    {
      "title": "--tools keeps MCP tools; * patterns; --no-mcp",
      "pov": "Not-our-problem",
      "status": "no-action",
      "rationale": "1.0.4: `--tools` now keeps MCP (mcp.json-configured server) tools unless an entry starts with mcp__, and --no-mcp disables MCP for a run. Our --tools callers (benchmark-image-strip-live, benchmark-reasoning-strip-live, workflow-evaluation-rpc) run with --no-extensions, and neither ~/.pi/agent/mcp.json nor .pi/mcp.json exists, so their tool sets are unchanged. Add --no-mcp only if an mcp.json is ever configured."
    },
    {
      "title": "Codemode tools.read() returns image blocks; image() saves temp files",
      "pov": "Not-our-problem",
      "status": "no-action",
      "rationale": "1.0.3/1.0.4: inside codemode scripts, reading an image file now yields an image block that image() can show, and image() also writes a temp file and names its path. extensions/work-vision.ts projects every image part in outgoing messages for non-vision models, so codemode images are already routed to process_image; no ce-workflow code calls tools.read or image()."
    },
    {
      "title": "Hidden tools left out of prompt rules; codemode shows per-tool prompt guidelines (ToolLoadout.getPromptGuidelines)",
      "pov": "Not-our-problem",
      "status": "no-action",
      "rationale": "1.0.4: tools hidden by an extension's prepareLoadout are no longer named in system-prompt rules, and codemode lists each tool's promptGuidelines next to its declaration. ce-workflow does not use prepareLoadout (rg finds none); Jev tools already carry promptSnippet, so they benefit without changes."
    },
    {
      "title": "Azure provider renamed azure-openai-responses -> azure (breaking)",
      "pov": "Not-our-problem",
      "status": "no-action",
      "rationale": "1.0.3 breaking rename of a provider key. rg finds no azure-openai-responses in this repo or in ~/.pi/agent settings.json/auth.json; no models.json exists."
    },
    {
      "title": "Home/End now always move the editor cursor; transcript top/bottom moved to Ctrl+Home/Ctrl+End",
      "pov": "Not-our-problem",
      "status": "no-action",
      "rationale": "1.0.3 keybinding change in Pi's editor. extensions/work-dialogs.ts and plan3.ts bind no home/end keys."
    },
    {
      "title": "Codemode built-ins frozen; restart hint after Pi update; output files user-only; OAuth/Bedrock/MCP OAuth/EIO/highlighting fixes",
      "pov": "Not-our-problem",
      "status": "no-action",
      "rationale": "1.0.3/1.0.4 runtime robustness fixes in Pi itself; no ce-workflow code patches codemode built-ins, depends on output-file permissions, or touches these providers. Benefit arrives automatically."
    }
  ],
  "pi-subagents": [
    {
      "title": "Idle-parent wake now sends a user prompt 'Subagent updates above.'",
      "pov": "Adopt",
      "status": "adopted",
      "rationale": "0.76.1 (PARENT_WAKE_TEXT): a subagent result/supervisor notice that wakes an idle parent is followed by a real user message so Pi runs the normal prompt lifecycle (before_agent_start, prompt sections, cache). ce-workflow's compaction collectors treat every role:user message as a user request: work-compaction.ts latestUserRequests (filter syntheticUserRequest) and work-compaction-memory.ts gather (kind user-request = protected record). Wake prompts would crowd out real protected requests in summaries. Adopt: treat this exact text as synthetic in both collectors. Legacy workflow (switch ON) before_agent_start goal-turn matching may also misclassify these turns; user chose no-action for legacy (see Decisions).",
      "verification": "node scripts/test-work-compaction.mjs -> ok (exit 0); wake-prompt assertion fails without the fix"
    },
    {
      "title": "/reload after a pi-subagents update now errors with 'restart Pi'",
      "pov": "Not-our-problem",
      "status": "no-action",
      "rationale": "0.76.1: Node cannot re-import an already-loaded ESM module, so pi-subagents refuses a mixed reload. ce-workflow avoids the same problem by loading .ts through jiti (AGENTS.md Extension File Rule); nothing to change."
    },
    {
      "title": "Child system prompt now starts with Pi's base prompt (append mode)",
      "pov": "Not-our-problem",
      "status": "no-action",
      "rationale": "0.76.1: affects systemPromptMode: append children only. All ce-workflow agents, including agents/plan3-advisor.md, use systemPromptMode: replace."
    },
    {
      "title": "Partial output on child timeout/crash; outputSchema result saved to output file",
      "pov": "Not-our-problem",
      "status": "no-action",
      "rationale": "0.76.0: failed children return text labeled 'Partial output before ...' with outputPartial:true, and structured results land in the output file. Plan3 advisors read the child's returned text and do not use outputSchema/output files; the legacy workflow is off. The outputSchema in extensions/jev-tools.ts is a Pi tool schema, not a subagent option."
    },
    {
      "title": "Settings write-lock (settings.json.write-lock) for concurrent settings saves",
      "pov": "Reject",
      "status": "no-action",
      "rationale": "0.76.0: pi-subagents locks its own read-modify-write of settings.json. ce-workflow writes workOrchestrator settings from interactive toggles only; honoring the lock would add locking code for a race requiring a simultaneous subagent settings save. Revisit if a lost setting is ever observed."
    },
    {
      "title": "Daily/weekly schedules, worktree.cleanup apply, headless result delivery, capacity release, MCP name aliases, plain js workflow blocks, multiline descriptions, watchdog, Herdr pane color, doctor/stop fixes",
      "pov": "Not-our-problem",
      "status": "no-action",
      "rationale": "0.76.0/0.76.1 features and fixes inside pi-subagents. ce-workflow (workflow off) uses subagents only for Plan3 advisors (ideas/review), which need none of these; benefits arrive automatically."
    }
  ],
  "pi-intercom": [
    {
      "title": "Idle wake now sends a user prompt 'New intercom message above.'",
      "pov": "Adopt",
      "status": "adopted",
      "rationale": "0.16.1 index.ts: an inbound message that should trigger a turn on an idle session is followed by pi.sendUserMessage('New intercom message above.') because Pi skips before_agent_start for sendMessage({triggerTurn}) turns (pi#5581). Same compaction-memory pollution as the pi-subagents wake; covered by the same Phase 1 change.",
      "verification": "node scripts/test-work-compaction.mjs -> ok (exit 0); wake-prompt assertion fails without the fix"
    },
    {
      "title": "intercom send/ask renderCall shows the full message when expanded",
      "pov": "Not-our-problem",
      "status": "no-action",
      "rationale": "0.16.1 UI-only rendering change in pi-intercom's tool call display; ce-workflow does not render intercom calls."
    }
  ]
}
```

## Decisions

Record user answers and settled choices here.

- **Legacy workflow wake-turn handling: no-action.** pi-subagents 0.76.1 / pi-intercom 0.16.1 wake prompts may be misclassified by legacy before_agent_start goal-turn matching (extensions/work-models.ts, workflow switch ON only). Decision: do not fix in this catch-up; the legacy workflow is off and slated to go away. Source: ask_user 2026-10-06, answer "Legacy: no-action (recommended)".
- **Wake-prompt filter location.** One exported predicate in extensions/work-compaction.ts (which work-compaction-memory.ts already imports) matches exactly `Subagent updates above.` and `New intercom message above.`; both collectors use it. Rationale: one shared guard instead of two copies; exact-text match so real user requests are never dropped. Source: agent decision from repository reading (work-compaction-memory.ts imports ./work-compaction.ts).

## Open questions

### Blocking

None.

### Deferred

- Legacy before_agent_start handling of wake prompts (user chose no-action; revisit only if the legacy workflow is re-enabled).
- `--no-mcp` for benchmark scripts: add when an mcp.json is configured (assumption: none exists today, observed 2026-10-06).

## Phases

### Phase 1 — Apply adopted changes

Affected files: `extensions/work-compaction.ts`, `extensions/work-compaction-memory.ts`, `scripts/test-work-compaction.mjs`.

- [x] **CU-01** Export a `syntheticWakePrompt(text)` predicate (exact match of `Subagent updates above.` or `New intercom message above.` after trim) from `extensions/work-compaction.ts`; use it inside `syntheticUserRequest` and skip such user messages in `gather` of `extensions/work-compaction-memory.ts` (no user-request record). Check: `node scripts/test-work-compaction.mjs` passes.
  - note: syntheticWakePrompt exported from extensions/work-compaction.ts, used in syntheticUserRequest and in gather (work-compaction-memory.ts skips wake user messages).
  - check: node scripts/test-work-compaction.mjs → ok - work compaction policy, ... (exit 0)
- [x] **CU-02** Extend `scripts/test-work-compaction.mjs`: messages containing both wake prompts plus a real request → `gather` yields no user-request record for the wake texts and keeps the real request; a real request that merely contains the phrase inside longer text is kept. Check: `node scripts/test-work-compaction.mjs` passes; fill the two Adopt decisions' `verification` with that command and result.
  - note: Asserts both wake texts (string + text-part content, whitespace) are dropped, a real request and a longer request containing the phrase are kept.
  - check: node scripts/test-work-compaction.mjs → ok (exit 0); with the extension changes stashed the new assertion fails (AssertionError deepStrictEqual), so the test discriminates.

### Phase 2 — Verify and record

- [x] **CU-90** Run `npm run verify:quiet` after the adopted changes and record the result (workflow switch off, the user's default).
  - check: npm run verify:quiet → exit 0, "ok - package checks passed" (workflow switch off; 74 workflow-only scripts skipped as designed)
- [x] **CU-91** Record the reviewed versions: `node scripts/work-catch-up-record.mjs <this plan's id>`. It writes exactly the target versions above (not newer releases) into `extensions/work-catch-up-baseline.json` and refuses missing, unexplained or unverified decisions.
  - check: node scripts/work-catch-up-record.mjs 45682eea → "recorded: @earendil-works/pi-coding-agent@1.0.4, pi-subagents@0.76.1, pi-intercom@0.16.1" (exit 0); baseline shows those versions, other packages unchanged; node scripts/test-work-plan3.mjs → Plan3 command self-checks passed

## Global acceptance

- Every catch-up decision is graded with an explained rationale; both Adopt entries carry `verification`.
- Wake prompts never appear as protected user requests in compaction memory; real requests are unaffected.
- `npm run verify:quiet` passes; `node scripts/work-catch-up-record.mjs 45682eea` records pi-coding-agent 1.0.4, pi-subagents 0.76.1, pi-intercom 0.16.1.

## Non-goals

- Legacy workflow (switch ON) handling of wake prompts.
- Packages outside the five monitored ones; pi-ask-user and pi-lens are already current.

## Resume context

Complete (2026-10-06). The wake-prompt filter is in place and tested. `npm run verify:quiet` passes with the workflow switch off; a workflow-on run was not part of the acceptance and was not run. The baseline records pi-coding-agent 1.0.4, pi-subagents 0.76.1 and pi-intercom 0.16.1. Nothing is committed. No next action.

## Amendments

- 2026-10-06: Generated by /wo → Catch up packages.
- 2026-10-06: Planning filled decisions, Phase 1 (CU-01, CU-02), acceptance and non-goals.
- 2026-10-06 (execution): pi-lens flagged an unwrapped `JSON.parse` in `recoveredRecords` (extensions/work-compaction-memory.ts, pre-existing since eb66dd20). A malformed `{`-line in a persisted summary would abort compaction, so it now skips that line (try/catch). Covered by a decodeMemory assertion in scripts/test-work-compaction.mjs. Small robustness fix in a file this plan already touches; no change to approved scope.
