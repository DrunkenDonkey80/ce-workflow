---
plan3: true
status: ready
created: 2026-11-12
updated: 2026-11-12T19:32:05.344Z
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
- **D-11 Security (T-03).** Everything runs with full user rights over about 500 auto-updated npm packages, and credentials are reachable (`auth.json`, `~/.ssh`, `~/.aws`, gh, Claude, Codex). The top threat is prompt injection into the shell; no candidate fixes it alone. Only Codex ships a Windows-native sandbox, and its code is Apache-2.0 and usable from Pi. Hardening is possible on Pi: pin and review packages, add a per-command bash sandbox, or run the stack in WSL as a separate user. Evidence: `docs/proposals/own-agent-stack/security.md`.
- **D-12 Wishes against Pi (T-04).** All four multi-hub wishes and the security and speed pains are possible on Pi. Ownership and simplicity are only partly met: full ownership needs a fork, and the extension layer stays in any stack. No D-01 item strictly needs a new stack, so a rewrite rests on the T-06 value weights. Six follow-up drafts are listed. Evidence: `docs/proposals/own-agent-stack/wishes.md`.
- **D-13 Candidates (T-05).** Pi passes both gates with today's direct Claude OAuth. Codex fails G1 for Claude (addable) but has the best server (multi-thread app-server over WebSocket) and the only Windows-native sandbox. Goose passes G1 only through the `claude` binary over ACP, which loses session fork and resume, and it has no sandbox. OpenCode fails G1 for its own Claude login. Anthropic's policy forbids third-party agents from using subscription OAuth, so today's Claude path carries that risk on every stack. T-07 finalists: Codex app-server against Pi, with Goose as the reserve. Evidence: `docs/proposals/own-agent-stack/candidates.md`.
- **D-14 Weights and Claude route (T-06, user, 2026-11-12).** Weights out of 10: wishes 8, security 6, speed 6, simplicity 5, ownership 3. Q-01: G1 means today's direct Claude subscription OAuth through our own provider code, and the policy risk is accepted. A stack passes G1 for Claude only if it runs our provider code or a port of it. Goose drops to an unlikely candidate, because ACP loses fork and resume.
- **D-15 Measured candidates (T-07).**
  - Codex core starts about 3 times faster than Pi core (88 against 270 ms on Windows) and uses about a third of the memory. One Codex process holding five threads uses about 50 MB, against 621 MB for five Pi processes.
  - Fully loaded, both are heavy: our Pi takes 276 MB and 1.3 s per session. The user's Codex takes 364 MB and 21 processes per session, and it starts its MCP servers once per thread (72 processes for five threads).
  - On the same model, Codex full took 3.2 s to the first token against 1.7 s for Pi; the cause was not separated.
  - Claude cannot run on Codex (G1). Codex in WSL was not tested with the shared Windows config.
  - A WSL server must keep its config on ext4: Pi starts in 1.8 s from `/mnt/c` against 0.15 s from ext4.
  - Evidence: `docs/proposals/own-agent-stack/baseline.md`, section T-07.










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
- [x] **T-03** Security written: hardening possible on Pi at three cost levels; Codex sandbox code is the only Windows-native option (D-11).
- [x] **T-04** Every D-01 item is possible or partly possible on Pi; six follow-up drafts listed (D-12).
- [x] **T-05** Candidates compared on gates and fit; finalists Codex app-server and Pi; Claude policy raised as Q-01 (D-13).
- [x] **T-06** User weights: wishes 8, security 6, speed 6, simplicity 5, ownership 3; G1 Claude = direct OAuth (D-14).
- [x] **T-07** Codex app-server and Pi measured on Windows native and WSL; matrix and raw results appended to baseline.md (D-15).
- [wip] **T-08** What does each path cost and score?
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

T-01 to T-05 done (HEAD 99e70be3). Now T-06 [human]: asking the user for weights plus Q-01 (Claude route). After the answer: record D-14, then T-07 (measure the Codex app-server against the Pi baseline on Windows native and WSL).

## Amendments

Append material changes and their reasons.

- 2026-11-12 review (plan3-advisor, `openai-codex/gpt-6-astra:high`), each finding checked against the code:
  - F1 T-05 "unless cost stated" weakens the D-07 and D-08 gates: accepted with a change. Gates now read passed, addable, unverified or failed; "addable" stays because D-03 makes a fork ours to extend, but it needs feasibility evidence, not an estimate.
  - F2 T-07 skips standalone Linux and other providers: accepted. Added a candidate by OS by provider matrix; the enabled providers are only anthropic and openai-codex (`settings.json` `enabledModels`); Linux cells cite sources, since no Linux machine is known.
  - F3 T-02 and T-07 have no comparable benchmark: accepted. Shared scenarios, Pi-only metrics marked not comparable, script text and raw results kept in `baseline.md` (`hub/src/rpc-client.ts` `start()` confirmed as the spawn point).
  - F4 cost drivers in Not yet specified had no ticket: accepted. T-08 now settles a coarse approach per finalist (`hub/src/pi-sdk.ts` `ModelRuntime` and `SessionManager` uses confirmed); detailed design stays under Not yet specified.
  - F5 T-04 covered only multi-hub wishes: accepted. T-04 covers every D-01 item; T-03 adds a hardening verdict.
  - Own finding: `~/.pi/agent/pi-sync.json` (git settings sync) and pi-provider-claude-ex `sync.ts` (account sync) already exist; T-04 starts from them.
