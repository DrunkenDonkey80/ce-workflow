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
- Parity with Pi. That is about 44 to 78 weeks by the map's estimate without a TUI (D-16, revised in `decision.md`).
- Porting pi-subagents, pi-lens or pi-web-access.
- A terminal UI, in this plan or later (user decision, see Decisions).
- Migrating old sessions.
- Retiring Pi.

## Decisions

Carried from the map (user decisions unless marked):
- **D-07 / D-08:** gates G1 and G2 as above.
- **D-14:** weights and the G1 meaning: direct OAuth only.
- **No terminal UI (user, after map T-10):** the server has hub, web and native-app clients only. That drops `pi-tui` and Pi's interactive mode (about 35k of Pi's 116k core lines). Extension dialogs (`ctx.ui`) are drawn by the hub only.
- **Pure Rust (user):** no embedded Node or JS runtime and no extension host. Our extensions are ported to Rust natively; the user judges the few we use as easy to port. This settles the old Q-01.
- **Native subagents (user):** subagents, the supervisor channel and intercom become sessions inside the core, not a package.
- **pi-lens replacement (agent finding):** `lens_diagnostics` and code search are rebuilt natively on LSP clients plus the ast-grep and tree-sitter crates, which are Rust already.
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

- **Q-01** What replaces codemode, given no embedded JS?
  - Context: codemode is the model writing a short JS program that calls tools. In the last 30 days of session files there were 12,817 codemode calls. 53% only call tools and return the results. 47% use logic between the calls: loops 28%, conditionals 23%, string operations 18%, filter and map 15%. The logic is mostly loops over search results and cutting long outputs down before they reach the context, which is where the token savings come from.
  - Recommendation: a batch tool first (parallel or ordered tool calls, each with built-in output cuts such as line filter, head and limit). It covers the 53% and much of the cutting. Measure turns and tokens against Pi's codemode in Phase 3, and add a script language only if the batch tool loses.
  - Option: Batch tool with output cuts — pure Rust and simplest; no loops or branches, so some work takes extra turns
  - Option: Starlark (pure-Rust crate) — a small Python-like language that models write well; sandboxed and deterministic
  - Option: Rhai (pure-Rust crate) — Rust-like scripting; models know it less well
  - Option: Boa (JS engine written in Rust) — the model keeps writing JS, but it is a whole JS engine inside the server
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

- [ ] **T-01** Write the server design: process model, session tasks, client protocol, the in-core tool and event API for ported extensions, session format (Q-02).
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

- [ ] **T-08** Run the acceptance benchmark, including a codemode comparison (turns and tokens on the same tasks) if the batch tool from Q-01 was built, against Pi on Windows native and WSL; append the results to `baseline.md`.
- [ ] **T-09** From the numbers, rank the next build plan: codemode replacement (Q-01), compaction with our modes, extension ports, subagents.

## Global validation

- Gates:
  - G1: one real turn each through Claude (pool), OpenAI Codex and OpenRouter, on Windows native and WSL.
  - G2: the server builds and runs on Windows native, WSL and Linux, tested in CI.
- The T-02 benchmark targets are met or explained.
- Pi sessions keep working throughout; no change to Pi's auth files beyond what the shared Claude pool already does.
- Linux is covered by CI only, since no standalone Linux machine is known.

## Backlog

- Codemode, compaction with our custom modes, context edits, custom entries.
- Native ports of our extensions: plan3, ask_user (hub-drawn), schedule, knowledge, compaction modes, then the device tools (screen_read, app_act, mobile_act, vm_act).
- Native subagents with the supervisor channel and intercom.
- Native `lens_diagnostics` (LSP plus ast-grep), then web search and fetch.
- Wishes: settings sync, hub-to-hub notices, a login hub.
- Session migration from Pi, then retiring Pi.

## Resume context

Draft written from map 11005151 T-10. Next: the user answers Q-01 to Q-03 with `/plan3 resolve`, then approves with `/plan3 finish`. Nothing is implemented.

## Amendments

Append material changes and their reasons; preserve the original request and settled decisions.
