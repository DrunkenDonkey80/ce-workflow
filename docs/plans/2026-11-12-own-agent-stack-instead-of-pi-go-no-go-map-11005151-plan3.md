---
plan3: true
status: ready
created: 2026-11-12
updated: 2026-11-12T18:23:40.671Z
size: map
kind: map
reviewed: 2026-11-12
started: 2026-11-12T18:13:51.339Z
---

# Own agent stack instead of Pi: go/no-go map

## Original request

> from haystack analysys here I got this very great idea - why do we need PI at all? can we drop it completely and recreate in rust our complete environment that is having a single agent server and display clients + all the features we are using but in a fast and secure env

## Destination

A decision document, `docs/proposals/own-agent-stack/decision.md`, that says go or no-go on replacing Pi, names the chosen path and backs it with measurements, a feature inventory and a scored comparison (D-02). On go, a first Plan3 build draft exists; on no-go, small Plan3 drafts exist for the wishes that work on Pi (D-05).

Paths compared (D-03, D-04): stay on Pi; stay and harden (sandbox, fewer packages); fork Pi (MIT, TypeScript) and own it; an own TypeScript server; fork an existing Rust agent (Codex `codex-rs`, Goose, others found); Rust from scratch. Haystack serves as a design reference.

## Notes

Read before any ticket:

- `hub/README.md` and `hub/src/pi-sdk.ts`: the hub already is one server with web, Tauri (`hub/app`) and Swift (`hub/apple`) clients, but spawns one `pi --mode rpc` per session.
- `package.json` `pi` block and `C:\Users\Flex\.pi\agent\settings.json` `packages`: what Pi loads for us.
- Pi docs under `C:\Users\Flex\.pi\agent\install\releases\1.5.2\node_modules\@earendil-works\pi-coding-agent\docs` (extensions, sdk, rpc).
- Haystack review plan `2026-11-12-review-deepset-ai-haystack-...-2af79ca5-plan3.md` (pin `104a83f8`, area A7 agent loop); reuse its clone and findings when it has run.

Planning-time facts (2026-11-12, counted with `wc -l` over shipped JS or TS):

- Pi 1.5.2 (MIT, `github.com/earendil-works/pi`) core: coding-agent 66.6k lines, pi-ai 21.3k, pi-tui 16.3k, schema 4.4k, mcp 3.2k, codemode 2.2k, agent-core 1.4k; about 116k in total.
- Third-party packages we load: pi-subagents 182k, pi-lens 298k, pi-web-access 96k, pi-goal 12k, pi-intercom 11k, prompt-template-model 8k, plus context7, ponytail and pi-provider-claude-ex.
- Our code: `extensions/` 25k, `hub/src` 6.3k, `hub/web` 5.9k, `scripts/` 17k, plus the Tauri and Swift apps. It uses about 33 Pi events (`pi.on`), `ctx.ui` (notify, custom, editor, select, widgets), the model registry (`getAvailable`, `streamSimple`, `classify`) and 7 commands.
- No recorded Pi breakages found in `CHANGELOG.md` or `docs/` (grep for workaround and Pi bug).
- Unverified (training knowledge): `codex-rs` (Apache-2.0) has an app-server JSON-RPC protocol and OS sandboxing; Goose (Apache-2.0) has a `goosed` server, desktop client and MCP extensions. T-05 checks primary sources.

Standing rules for every ticket:

- No product code and no Pi changes; outputs go to `docs/proposals/own-agent-stack/`, scratch work to system temp.
- Evidence carries a version or commit pin and a source; label anything unverified.
- Measurements use the same script and machine for every option, so numbers compare.

## Decisions

One line per resolved ticket: gist and ticket ID.
- **D-size** Size: map. A full Rust rewrite (~116k lines of Pi core plus ~600k of packages we rely on) is fog; plan a go/no-go study first that measures the real pain and compares stay, harden, adopt an existing Rust agent, or rewrite. Source: user pick, 2026-11-12.
- **D-01 Pains to fix: security, speed, ownership, simplicity, plus multi-hub wishes.** The user also wants hubs that share settings, push updates to each other, keep LLM connections on one computer (or spawn them), and talk in-process. Source: user via ask_user 2026-11-12, round 1.
- **D-02 Destination: a go/no-go decision.** Measured pain, options compared with costs, one chosen path and its first build plan; no build while charting. Source: user via ask_user 2026-11-12, round 1.
- **D-03 Existing agents count, as forks we own.** Codex (`codex-rs`), Goose and similar may be adopted, but adopted code becomes ours to carry forward; Haystack is a reference too. Source: user via ask_user 2026-11-12, round 1.
- **D-04 Compare Rust with an owned TypeScript server.** Rust is chosen on numbers, not assumed; a Pi fork counts as an owned TypeScript option. Source: user via ask_user 2026-11-12, round 2 (Pi fork added from its MIT license).
- **D-05 Test every wish against Pi first.** Each D-01 wish is marked "possible on Pi" or "needs a new stack"; the first kind becomes its own small plan and is no reason to rewrite. Source: user via ask_user 2026-11-12, round 2.
- **D-06 No effort cap; value decides.** Cost is reported but does not veto; the decision ranks paths by value, and no-go remains a valid answer. Source: user via ask_user 2026-11-12, round 2.
- **D-07 Today's model access is a hard gate (Q-01).** Every path must keep the Claude subscription (pi-provider-claude-ex), the OpenAI Codex subscription logins and the other enabled providers; a path that cannot fails, whatever its score. Source: user via ask_user /plan3 resolve, 2026-11-12.
- **D-08 Server OS: Windows native, WSL and Linux; macOS as client only (Q-02).** A path must run the server on all three; macOS and iOS need only the clients (Swift app, web). Source: user via ask_user /plan3 resolve, 2026-11-12.
- **D-09 Usage inventory (T-01).** In 30 days, about 85% of tool calls go to Pi's core file and shell tools and codemode. Daily needs: compaction, the session tree and custom entries, both subscription logins, the 33-event extension model, and the hub's RPC and SDK surface. pi-subagents and `lens_diagnostics` are daily too, pi-web-access is weekly, and pi-goal and most pi-lens extras are rare. Evidence: `docs/proposals/own-agent-stack/inventory.md`.
- **D-10 Baseline (T-02).** Pi core is fast outside the model: 0.27 s to ready, about 120 MB private memory per session, about 10 ms of overhead per turn. Our packages add about 1.1 s warm and 2.7 s on the first start, plus 150 MB per session; long live sessions use 340 to 580 MB. The speed pain is package load and memory, not the agent loop. Evidence: `docs/proposals/own-agent-stack/baseline.md` (S1 to S5).





## Open questions

### Blocking

None.

### Deferred

None.

## Not yet specified

- Detailed design of the client protocol, extension model, package replacements and migration (T-08 settles only the coarse, cost-driving approach per finalist).
- Multi-hub sync design: trust between hubs, conflict rules, where provider logins live.

## Out of scope

- Building any part of the new stack: the destination is a decision (D-02).
- Changing Pi or upstream packages: we only read them.
- The Haystack idea review itself: it has its own plan (2af79ca5).

## Phases

### Tickets [think]

- [x] **T-01** Inventory written: core tools and codemode carry about 85% of calls; daily needs listed by owner (D-09).
- [x] **T-02** Baseline measured: Pi core 0.27 s and 120 MB per session; our packages add 1.1 to 2.7 s and 150 MB (D-10).
- [ ] **T-03** What can an agent or extension do on this machine today, and what would a sandbox stop?
  - type: research
  - Count npm packages and install scripts we run; list file, network and process rights; name realistic threats.
  - Give a "possible on Pi" verdict for hardening (sandbox, fewer packages) with its cost; T-04 links it.
  - Survey sandboxes for the server OSes (Windows native, WSL, Linux; D-08) usable with Pi and with each candidate. Output `security.md`.
- [ ] **T-04** Which D-01 wishes and pains are possible on Pi today, and at what cost?
  - type: research
  - Every D-01 item gets "possible on Pi" or "needs a new stack" (D-05): settings sync between hubs, hub-to-hub updates, one machine holding LLM logins, in-process calls, and security, speed, ownership, simplicity (linking T-02 and T-03 evidence).
  - Start from what exists: `~/.pi/agent/pi-sync.json` (git-backed settings sync, setup last used July 29, its package not loaded today) and pi-provider-claude-ex `sync.ts` (Claude account sync).
  - Name the small Pi follow-up for each "possible" item. Output `wishes.md`.
- [ ] **T-05** Which existing agents could we fork, and how do they fit?
  - type: research
  - Pin and read `codex-rs`, Goose, Pi itself, and any other active Rust or TS agent found; Haystack as reference.
  - Per candidate: license, server protocol, providers, extensions, MCP, sandbox, activity. Output `candidates.md`.
  - Gates first, per candidate and gate: passed (shipped support, cited), addable (missing, but shown feasible by evidence such as pi-provider-claude-ex's working login code), unverified, or failed. A cost estimate alone never makes a gate pass.
- [human] **T-06** How should security, speed, ownership, simplicity and the wishes be weighted?
  - type: grill
  - Ask with T-01 to T-05 numbers in hand; D-07 and D-08 are gates, not weights.
- [ ] **T-07** How do the top one or two candidates measure on this machine?
  - type: research
  - Run the T-02 scenarios on Windows native and WSL; one real turn each through the Claude subscription and the OpenAI Codex login (the enabled providers in `settings.json` `enabledModels`).
  - Fill a matrix: candidate by server OS (Windows native, WSL, Linux) by provider, each cell tested, cited from primary sources, or unknown. No standalone Linux machine is known, so its cells cite sources and say so.
  - Append to `baseline.md`.
- [ ] **T-08** What does each path cost and score?
  - type: research
  - Per finalist, a coarse approach for each cost driver: hub protocol (today `hub/src/rpc-client.ts` spawns `pi --mode rpc`), Pi SDK uses in the hub (`hub/src/pi-sdk.ts` `ModelRuntime`, `SessionManager`), extension model, the big packages (pi-subagents, pi-lens, pi-web-access), sessions and settings migration, side-by-side running.
  - Porting cost per inventory item, upkeep (providers, OS), risks, scored with T-06 weights. Draft `decision.md` with a recommendation.
- [human] **T-09** Go or no-go, and which path?
  - type: grill
  - The user decides from `decision.md`; record it there and in Decisions.
- [ ] **T-10** Create the follow-up drafts.
  - type: task
  - On go: `plan3 create` the first build plan. Wishes "possible on Pi": one draft each, also on go if they help before the switch.
  - Pass `plan: "11005151"` to later `plan3` calls on this map, since `create` moves the current plan.

## Resume context

Charting done and reviewed (advisor findings F1 to F5 accepted, see Amendments): D-01 to D-08 settled, no open questions. Next: T-01 inventory into docs/proposals/own-agent-stack/inventory.md. T-06 and T-09 need the user. No blockers.

## Amendments

Append material changes and their reasons.

- 2026-11-12 review (plan3-advisor, `openai-codex/gpt-6-astra:high`), each finding checked against the code:
  - F1 T-05 "unless cost stated" weakens the D-07 and D-08 gates: accepted with a change. Gates now read passed, addable, unverified or failed; "addable" stays because D-03 makes a fork ours to extend, but it needs feasibility evidence, not an estimate.
  - F2 T-07 skips standalone Linux and other providers: accepted. Added a candidate by OS by provider matrix; the enabled providers are only anthropic and openai-codex (`settings.json` `enabledModels`); Linux cells cite sources, since no Linux machine is known.
  - F3 T-02 and T-07 have no comparable benchmark: accepted. Shared scenarios, Pi-only metrics marked not comparable, script text and raw results kept in `baseline.md` (`hub/src/rpc-client.ts` `start()` confirmed as the spawn point).
  - F4 cost drivers in Not yet specified had no ticket: accepted. T-08 now settles a coarse approach per finalist (`hub/src/pi-sdk.ts` `ModelRuntime` and `SessionManager` uses confirmed); detailed design stays under Not yet specified.
  - F5 T-04 covered only multi-hub wishes: accepted. T-04 covers every D-01 item; T-03 adds a hardening verdict.
  - Own finding: `~/.pi/agent/pi-sync.json` (git settings sync) and pi-provider-claude-ex `sync.ts` (account sync) already exist; T-04 starts from them.
