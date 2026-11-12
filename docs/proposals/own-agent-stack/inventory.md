# What we use from Pi (T-01)

Snapshot 2026-11-12, Pi 1.5.2, ce-workflow at `e17a66ac` plus uncommitted work. Part of the go/no-go map `docs/plans/2026-11-12-own-agent-stack-instead-of-pi-go-no-go-map-11005151-plan3.md`.

## How usage was counted

- Script: `%TEMP%\own-agent-stack\usage.mjs` (text below). It reads every `*.jsonl` under `~/.pi/agent/sessions` (2.3 GB, 791 files, subagent child runs included) and counts tool calls, custom entries, provider switches and compactions per calendar day.
- Window: 2026-10-13 to 2026-11-12, 33 days with entries.
- Bands: **daily** = used on at least half the days; **weekly** = at least one day in seven; **rare** = less; **unused** = registered but no call in the window.
- Slash commands cannot be counted: Pi expands them before logging (only `/compact` and `/designs` showed up). Hub RPC traffic is not logged per call.

```js
// usage.mjs <sessionsDir> <sinceDate>: per key, count and distinct days
for each *.jsonl with date >= since:
  model_change -> provider:<provider>; custom -> custom:<customType>; compaction -> entry:compaction
  message.content[type=toolCall] -> tool:<name>; other entry types -> entry:<type>
band = days >= active/2 ? daily : days >= active/7 ? weekly : rare
```

## Tool calls by owner (30 days)

| Owner | Tool: calls (days) | Band |
|---|---|---|
| Pi core | bash 57,197 (33), read 16,362 (33), edit 7,242 (33), write 3,003 (33), grep 1,174 (23), ls 436 (23), find 187 (24) | daily |
| Pi core (`pi-codemode`) | codemode 9,116 (33) | daily |
| ce-workflow | plan3 4,894 (32), ask_user 622 (32), compaction_note 664 (33), screen_read 458 (28), schedule 682 (16), knowledge 61 (21), research_note 98 (17) | daily |
| ce-workflow | process_image 430, browser_act 390, tools_enable 102, jev_evidence 97, design 61, mobile_act 53, plan3_diagram 25, research_exit 19, project_commands 15, app_act 15, session_dialog 12, browser_fetch 40, browser_search 9 | weekly |
| ce-workflow | video_digest 72, test_sensitivity 8, jev_triage 8, image_search 6, generate_image 5, camera_capture 1, plan3_design 1 | rare |
| pi-subagents | subagent 1,358 (29), subagents_enable 273 (29), contact_supervisor 217 (26) | daily |
| pi-subagents | subagent_supervisor 183, bg_wait 10 | weekly |
| pi-lens | lens_diagnostics 998 (30), read_symbol 379 (14) | daily |
| pi-lens | module_report 70, lens_diagnostic_mark 54, read_enclosing 31, symbol_search 21 | weekly |
| pi-lens | pi_lens_activate_tools 15, lsp_navigation 6, project_report 3; effective_config 0 | rare / unused |
| pi-intercom | intercom 433 (26) | daily |
| pi-web-access | fetch_content 42 (14) daily; web_search 49, web_enable 20, get_search_content 13 | weekly |
| context7 | resolve-library-id 46, query-docs 71 | weekly |
| pi-goal | goal_wait 12; goal_complete, goal_blocked 0 | rare / unused |

Takeaway: about 85% of calls hit the seven Pi core file and shell tools plus codemode. Of the big packages, pi-subagents (subagent, supervisor channel) is daily, pi-lens is daily but mostly one tool (`lens_diagnostics`), and pi-web-access is weekly.

## Session features (30 days)

| Feature | Evidence | Band |
|---|---|---|
| Compaction | 1,447 compaction entries, 664 `compaction_note` calls, ce-workflow `work-compaction.ts` custom modes | daily |
| Session tree: fork, switch, navigate | `session_before_fork`, `session_tree`, hub RPC `fork` and `get_fork_messages` | weekly (estimate) |
| Custom entries | `plan3-current` 915, `plan3-run` 369, `work-research-context` 337, `intercom_sent` 369, `jev-compaction-note` 5,443 | daily |
| Thinking level changes | 558 | daily |
| Context edits | 90 (`context_edit`) | daily |
| Providers | `openai-codex` (subagents and advisors) 29 days, `anthropic` 28 days, `openrouter` 2 days | daily, daily, rare |

## Logins and providers

- `auth.json`: `anthropic` (OAuth subscription), `openai-codex` (OAuth subscription), `openrouter` (API key). No `models.json`.
- `settings.json` `enabledModels`: only `anthropic/*` and `openai-codex/*`; default `anthropic/claude-opus-5-5`.
- pi-provider-claude-ex (our own repo, `github.com/DrunkenDonkey80/pi-provider-claude-ex`) runs a Claude account pool and syncs accounts between machines (`sync.ts`, `~/.pi/agent/claude-pool-*`).

## Pi API surface our code depends on

- **Extensions (`extensions/`, 13 entry points in `package.json` `pi.extensions`):** 33 distinct events. The most used are `session_start` (8), `tool_call` (6), `session_shutdown`, `input`, `agent_start` (4 each), then `turn_end`, `session_compact`, `message_end`, `agent_settled`, `agent_end` (3 each). The rest (`context`, `before_provider_request`, `session_before_compact`, `cache_warming_decision`, `queue_exact` and others) are used once or twice but carry core features such as compaction and plan3 runs.
- **`pi.*`:** `events` bus 52, `registerTool` 16, `sendUserMessage` 11, `appendEntry` 11, `exec` 8, `registerCommand` 7 (`wo`, `plan3`, `plans3`, `resume3`, `research`, `night`, `pi-hub`), `registerShortcut` 6, `sendMessage` 5, plus thinking, model, active-tool and settings getters and setters.
- **`ctx.*`:** `ui.notify` 108, `ui.custom` 8 (TUI components through `@earendil-works/pi-tui`), `ui.editor`, `ui.select`, `ui.input`, widgets and status; `modelRegistry` 31 (`getAvailable`, `streamSimple`, `getAvailableOfType`), `sessionManager` 27, `isIdle` 25, `getContextUsage` 12, `newSession`, `switchSession`, `waitForIdle`.
- **Hub (`hub/src`):**
  - RPC: spawns `pi --mode rpc` per session (`rpc-client.ts`) and sends about 22 RPC commands (`prompt`, `steer`, `follow_up`, `abort`, `get_state`, `set_model`, `set_thinking_level`, `fork`, `get_messages`, `extension_ui_response` and others).
  - SDK: imports Pi in-process (`pi-sdk.ts`): `ModelRuntime`, `ModelRegistry`, `SessionManager`, `SettingsManager`, `DefaultPackageManager`, `resolveModelScopeWithDiagnostics`, `getShellConfig`.
  - Session files: reads the `.jsonl` files directly (`sessions.ts`).
- **Skills and agents:** 3 skills, `utility-agents` for pi-subagents; ponytail, context7 and prompt-template-model add skills and prompts.
- **MCP:** Pi core ships `pi-mcp`; none of our extensions register MCP servers. Tools named `mcp__pi__*` (11 calls) only appear in sessions run through other front ends.

## What a replacement must carry (by weight)

1. **Daily, core:** the file and shell tools, codemode, compaction (with our custom modes), the session tree and custom entries, both subscription logins plus the Claude pool, the extension event model, and the RPC plus SDK surface the hub uses.
2. **Daily, ours:** plan3, ask_user (dialogs in TUI, web and hub), screen_read, schedule, knowledge, the research notebook.
3. **Daily, third-party:** subagents (with supervisor and intercom), `lens_diagnostics`, intercom.
4. **Weekly:** web search and fetch, browser, design, mobile and app automation, jev classifiers, context7, the other pi-lens navigation tools.
5. **Rare or unused:** pi-goal, video and image tools, camera, most pi-lens extras, openrouter.

Unverified: per-call hub RPC frequency and slash-command frequency (not logged); the band of tree operations is an estimate from code, not counts.
