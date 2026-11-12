---
plan3: true
status: draft
created: 2026-11-12
updated: 2026-11-12T21:30:18.993Z
---

# Own Rust agent server: first build plan

## Original request

> First build plan for path D of map 11005151: our own agent server written from scratch in Rust, to replace Pi. Draft only; no implementation until the user approves the plan. It must keep gates G1 (direct Claude subscription OAuth through our own provider code, the account pool included, plus the OpenAI Codex login and OpenRouter) and G2 (server on Windows native, WSL and Linux; macOS and iOS as clients). It may reuse Codex's Apache-2.0 sandbox crates. Pi keeps running side by side until parity. Evidence: docs/proposals/own-agent-stack/ (inventory.md, baseline.md, security.md, wishes.md, candidates.md, decision.md).

Origin: map `docs/plans/2026-11-12-own-agent-stack-instead-of-pi-go-no-go-map-11005151-plan3.md`, T-09. At T-09 the user chose "Go: Rust from scratch (D)" and asked: "we are still only investigating right, not starting the implementation?" So this plan stays a draft until the user approves it with `/plan3 finish`.

## Goal, requirements, and non-goals

Goal: the first slice of an owned Rust agent server, running side by side with Pi. It is a walking skeleton, not parity. The hub can run one real coding session on it with both subscription logins, and we can measure it against `baseline.md`.

Requirements (user decisions from the map):
- **G1:** direct Claude subscription OAuth through our own code, today's way, including the account pool from pi-provider-claude-ex. Also the OpenAI Codex subscription login and OpenRouter. The user accepted the Anthropic policy risk (D-14).
- **G2:** the server runs on Windows native, WSL and Linux. macOS and iOS need only clients (D-08).
- **Weights** (D-14): wishes 8, security 6, speed 6, simplicity 5, ownership 3. Design choices are judged on these.
- **Wishes from the map (user):**
  - settings shared across hubs;
  - direct updates between hubs;
  - LLM logins on one machine only, or spawned;
  - in-process communication;
  - one process and one protocol.
- **Security (D-11):** prompt injection into the shell is the leading threat. Commands run inside a sandbox from the start, not added later.

Non-goals for this first plan:
- Parity with Pi. That is about 56 to 98 weeks by the map's estimate (D-16).
- Porting pi-subagents, pi-lens or pi-web-access.
- A TUI.
- Migrating old sessions.
- Retiring Pi.

## Decisions

Carried from the map (user decisions unless marked):
- **D-07 / D-08:** gates G1 and G2 as above.
- **D-14:** weights and the G1 meaning: direct OAuth only.
- **D-17:** go on D, Rust from scratch, chosen against the draft recommendation A (stay on Pi). Planning only until approval.
- **Map findings this plan relies on (evidence, not user decisions):**
  - Codex core starts in 88 ms with 37 MB, and holds 5 threads in about 50 MB, against 621 MB for 5 Pi processes (D-15).
  - Our feature load costs 1.3 s and 276 MB per Pi session, so features need a cheap loading model.
  - Codex ships the only identified Windows-native sandbox, under Apache-2.0 (D-11, D-13).
  - About 85% of tool calls are the 7 core file and shell tools plus codemode (D-09).

Agent proposals (not settled):
- One multi-session server process, with sessions as in-process tasks. This targets the 5-thread memory result.
- One protocol for the hub and other clients: WebSocket with JSON messages.
- Pi keeps running beside the new server. The hub picks a backend per session.

## Open questions

### Blocking

- **Q-01** How do extensions (our 25k lines of TS: plan3, ask_user, schedule and others) run on a Rust server?
  - Context: the 33-event extension model and `ctx.ui` dialogs are the biggest cost driver (D-16: 10 to 16 weeks). Pi loads them in-process with full rights (D-11). Codex offers only client-side tools (`item/tool/call`), hooks and MCP. MCP servers start once per thread (D-15: 72 processes for 5 threads).
  - Recommendation: one shared out-of-process extension host per server (Node, later replaceable), speaking a small event and tool protocol. That keeps the TS code and isolates it from the core; Rust-native rewrites follow only where speed matters.
  - Option: Shared extension host — one Node process per server runs all TS extensions over a protocol; reuses code, one process, can be sandboxed
  - Option: WASM plugins — extensions compiled to WASM inside the server; strongest isolation, but every extension is rewritten
  - Option: Rust-only — port each extension to Rust; fastest and simplest at the end, longest road
  - Option: MCP plus hooks — standard, but loses events and dialogs, and starts a server per thread unless shared
  - Independent: yes
- **Q-02** What session file format does the new server write?
  - Context: the hub reads Pi `.jsonl` session files directly (`hub/src/sessions.ts`). Daily features include the session tree and custom entries (`plan3-current`, `jev-compaction-note` and others; inventory.md).
  - Recommendation: Pi's `.jsonl` entry format, version-pinned, so the hub, plan3 and history work unchanged during side-by-side running; our own format can come later.
  - Option: Pi-compatible jsonl — zero hub changes, inherits Pi's format decisions
  - Option: Own format plus converter — clean design, the hub reads two formats until Pi retires
  - Independent: yes
- **Q-03** Where does the Rust code live?
  - Context: ce-workflow is a TS package (`package.json`, `extensions/`, `hub/`). The hub already has a Tauri app with a Rust toolchain.
  - Recommendation: a new repo, so the agent has its own releases; ce-workflow's hub talks to it over the protocol.
  - Option: New repo — clear ownership and releases; cross-repo changes for protocol work
  - Option: Inside ce-workflow (`agent/`) — one place, one commit for protocol changes; mixes the Cargo and npm toolchains
  - Independent: yes

### Deferred

- **Q-04** Reuse more Codex crates than the sandbox (for example the protocol types or `apply_patch`)?
  - Context: the map allows the sandbox crates. Using more of Codex moves toward path C and its upkeep (D-16).
  - Recommendation: decide per crate in T-04, after the skeleton exists.
  - Option: Sandbox only — least coupling
  - Option: Per crate, vendored — copy what saves time and own it from then on
- **Q-05** A TUI, or hub and web only?
  - Context: the TUI is 6 to 10 weeks for D (D-16). The hub's web and native clients already cover the hub sessions.
  - Recommendation: hub only until parity; revisit after the first plan.

## Relevant files and approach

- **Evidence:** `docs/proposals/own-agent-stack/`:
  - `inventory.md`: what must be carried, by weight.
  - `baseline.md`: Pi and Codex numbers, plus the benchmark scripts.
  - `security.md`, `wishes.md`, `candidates.md`.
  - `decision.md`: costs and scores.
- **Hub integration points:**
  - `hub/src/rpc-client.ts` spawns `pi --mode rpc` and sends 22 commands.
  - `hub/src/pi-sdk.ts` holds the in-process Pi models, sessions and settings.
  - `hub/src/sessions.ts` reads the session files.
- **Claude provider to port:** `github.com/DrunkenDonkey80/pi-provider-claude-ex`: account pool, rotation-safe locks, cross-machine sync (`sync.ts`), tool renaming.
- **Benchmark:** `%TEMP%\own-agent-stack\bench.mjs` and `codex-bench.mjs`. The scripts are reproduced in `baseline.md`. They become the acceptance harness.

Approach: build the thinnest path that a real session needs, measure it against the baseline, then decide what to port next with numbers.

## Phases

### Phase 1: Design [think]

- [ ] **T-01** Write the server design: process model, session tasks, client protocol, extension host (Q-01), session format (Q-02).
  - Output: `docs/proposals/own-agent-stack/server-design.md` in the agent repo or ce-workflow (Q-03).
  - The protocol covers the 22 hub RPC commands (`prompt`, `steer`, `follow_up`, `abort`, `get_state`, `set_model`, `fork` and others) and the event stream.
- [ ] **T-02** Define the acceptance benchmark and targets from `baseline.md`.
  - Targets per scenario (start, memory for 1 and 5 sessions, overhead before the model) on Windows native and WSL.
  - The numbers come from the design, not guesses.

### Phase 2: Walking skeleton [code]

- [ ] **T-03** Cargo workspace with the server binary; CI builds for Windows, Linux and WSL.
- [ ] **T-04** Agent loop with the 7 core tools (bash, read, edit, write, grep, ls, find); bash runs in the sandbox reused from Codex.
- [ ] **T-05** Providers: OpenAI Codex OAuth, then the Claude OAuth pool ported from pi-provider-claude-ex, then OpenRouter.
  - Each provider ends with one real turn as its test.
  - The Claude pool must share accounts with the running Pi without breaking its token rotation.
- [ ] **T-06** Sessions: multi-session server, session files in the Q-02 format, fork and resume.
- [ ] **T-07** Hub backend switch: the hub can run a session on the new server through the protocol, beside Pi sessions.

### Phase 3: Measure and decide [think]

- [ ] **T-08** Run the acceptance benchmark against Pi on Windows native and WSL; append the results to `baseline.md`.
- [ ] **T-09** From the numbers, rank the next build plan: codemode, compaction with our modes, extension host, subagents.

## Global validation

- Gates:
  - G1: one real turn each through Claude (pool), OpenAI Codex and OpenRouter, on Windows native and WSL.
  - G2: the server builds and runs on Windows native, WSL and Linux, tested in CI.
- The T-02 benchmark targets are met or explained.
- Pi sessions keep working throughout; no change to Pi's auth files beyond what the shared Claude pool already does.
- Linux is covered by CI only, since no standalone Linux machine is known.

## Backlog

- Codemode, compaction with our custom modes, context edits, custom entries.
- Extension host and the ports of plan3, ask_user, schedule and knowledge.
- pi-subagents replacement: supervisor channel and intercom.
- `lens_diagnostics` replacement, then web search and fetch.
- Wishes: settings sync, hub-to-hub notices, a login hub.
- Session migration from Pi, then retiring Pi.

## Resume context

Draft written from map 11005151 T-10. Next: the user answers Q-01 to Q-03 with `/plan3 resolve`, then approves with `/plan3 finish`. Nothing is implemented.

## Amendments

Append material changes and their reasons; preserve the original request and settled decisions.
