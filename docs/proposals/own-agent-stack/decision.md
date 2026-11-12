# Cost, score and recommendation (T-08)

Draft for the go/no-go call (T-09). Part of the map `docs/plans/2026-11-12-own-agent-stack-instead-of-pi-go-no-go-map-11005151-plan3.md`. Inputs: `inventory.md` (T-01), `baseline.md` (T-02, T-07), `security.md` (T-03), `wishes.md` (T-04), `candidates.md` (T-05), weights and G1 rule from D-14.

## Paths

| Path | What it is | Gates |
|---|---|---|
| **A: Stay on Pi, reshape** | Keep upstream Pi; do the six follow-ups from `wishes.md` (settings sync, hub-to-hub notices, a login hub, in-process sessions through Pi's SDK, package hardening, a bash sandbox) | G1 passed, G2 passed |
| **B: Fork Pi** | A, but on our own fork of Pi (MIT): strip, reshape, take upstream changes by choice | G1 and G2 passed |
| **C: Rust on a Codex fork** | The hub drives a forked `codex app-server`; port our Claude provider to Rust; move extensions to the protocol's client-side tools (`item/tool/call`), hooks, skills or Rust | G1 addable (port), G2 passed on Windows, untested in WSL with a login |
| **D: Rust from scratch** | Our own Rust server, reusing Codex's Apache-2.0 sandbox crates | G1 and G2 addable |
| **E: Own TS server** | Our own TypeScript server, designed in-process and multi-session | G1 and G2 addable (all the login code is TS already) |

Goose and OpenCode drop out: Goose reaches Claude only through ACP, which loses session fork and resume (D-14); OpenCode's own Claude login was removed (D-13).

## Cost drivers per path

Coarse effort estimates, in weeks of focused agent-assisted work, from the sizes in D-09 and `inventory.md`. They are judgement, not measurement; treat anything above 8 weeks as plus or minus 50%.

| Driver | A | B | C | D | E |
|---|---|---|---|---|---|
| Hub protocol (today `rpc-client.ts` spawns `pi --mode rpc`, 22 commands) | in-process SDK: 2 to 4 | same | rewrite onto `thread/*`, `turn/*` and `item/*` events: 2 to 3 | design and build: 3 to 5 | design and build: 3 to 5 |
| Hub's in-process Pi use (`pi-sdk.ts`: models, sessions, settings, packages) | none | none | replace: 1 to 2 | replace: 1 to 2 | replace: 1 to 2 |
| Agent core: loop, 7 tools, codemode, compaction with our modes, session tree, custom entries | none | none | compaction modes, custom entries, context edits as Rust changes in the fork: 6 to 12 | all of it (Pi core is 116k lines): 20 to 35 | all of it, part copied from Pi (MIT): 12 to 20 |
| Logins: Claude pool (rotation-safe locks, tool renaming), Codex, OpenRouter | none | none | port pi-provider-claude-ex to Rust: 2 to 4 | Claude port 2 to 4, plus Codex and OpenRouter: 1 to 2 | copy: 1 |
| Extension model: 33 events, `registerTool`, commands, `ctx.ui` dialogs, custom TUI | none | none | dynamic tools carry tools; events and dialogs have no equivalent: 8 to 12 | design and port 25k lines: 10 to 16 | design and port: 6 to 10 |
| Big packages: pi-subagents (with supervisor and intercom), pi-lens (`lens_diagnostics`), pi-web-access | hardening: replace pi-lens with a small owned tool, 1 to 2 | same | Codex subagents differ; rebuild supervisor and intercom, run the others as MCP (which start once per thread, D-15): 4 to 8 | rebuild: 6 to 10 | rebuild, or port the TS: 4 to 6 |
| TUI (terminal sessions) | none | none | Codex's Rust TUI without our dialogs; rebuild them or go hub-only: 4 to 8 | build: 6 to 10 | Pi's `pi-tui` (MIT) reusable: 2 to 4 |
| Sessions and settings migration, side-by-side running | none | small: 1 | convert `.jsonl` to Codex rollouts, run both for weeks: 2 to 3 | 2 to 3 | 2 to 3 |
| Security (`security.md`) | bash sandbox plus pinned packages: 2 to 4 | same | the sandbox ships with Codex: 0 to 1 | reuse Codex crates: 2 to 4 | as A: 2 to 4 |
| Wishes (`wishes.md`): settings sync, hub notices, login hub | 3 to 5 | same | 3 to 5 | 3 to 5 | 3 to 5 |
| **Total to parity** | **8 to 15 weeks, each piece ships on its own** | **9 to 16** | **34 to 66** | **56 to 98** | **38 to 64** |
| Upkeep | Pi releases weekly; packages updated after review | merge upstream by choice: about half a day a week, or freeze | `codex-rs` moves daily (0.166 to 0.167 within days); a diverged fork means owning a very large Rust tree | everything; providers change OAuth and APIs without notice | everything except what we keep copying from Pi |
| Main risk | in-process sessions share extension state, and one crash stops every session (`wishes.md`) | fork drift | OpenAI-centred design; the extension model shrinks to tools only | years before parity, while Pi keeps moving | converges with B but costs 4 times more |

## Scores (0 to 10 at the end state, after the cost is paid)

Weights from D-14: wishes 8, security 6, speed 6, simplicity 5, ownership 3.

| Criterion (weight) | A | B | C | D | E | Why |
|---|---|---|---|---|---|---|
| Wishes (8) | 8 | 8 | 7 | 7 | 8 | All wishes are possible on Pi (D-12). C keeps the multi-thread WebSocket server, but every wish is still built by us |
| Security (6) | 6 | 6 | 8 | 7 | 6 | Only Codex ships a Windows-native sandbox (D-11). A, B and E can use the same code as a bash helper; extensions still run in-process |
| Speed (6) | 6 | 7 | 8 | 8 | 7 | Codex core: 88 ms and 37 MB, about 50 MB for 5 threads (D-15). Our features cost most of the time on any stack: Pi full takes 1.3 s and 276 MB, of which core is 0.27 s and 122 MB |
| Simplicity (5) | 5 | 6 | 5 | 6 | 7 | C means two languages plus a bridge from tools to the protocol. E is one language and one process, designed for us |
| Ownership (3) | 3 | 7 | 7 | 10 | 9 | B, C: a fork is ours, but a fork of a fast-moving upstream |
| **Weighted (of 10)** | **6.1** | **6.9** | **7.1** | **7.4** | **7.3** | |
| **Weeks to parity** | **8 to 15** | **9 to 16** | **34 to 66** | **56 to 98** | **38 to 64** | |

How the weighted score is computed: the sum of score times weight, divided by 28.

## Reading

- **End state:** D and E score about 1.2 above A. The gap is mostly ownership (weight 3) and small speed and simplicity margins. Wishes, the heaviest weight, are equal or better on Pi.
- **Speed:** most of today's speed pain is our own package load (D-10). A rewrite carrying the same features would pay much of that cost again. What Codex shows is the gain from in-process sessions (621 MB against 50 MB for five), and A reaches for the same gain through Pi's SDK.
- **Security:** no path removes prompt injection; each needs a boundary (D-11). The only shipped Windows boundary is Codex's code, and A can use it.
- **Cost:** A reaches most of the value in 2 to 4 months, piece by piece, with Pi still running. C, D and E need 8 to 24 months to reach parity while Pi keeps moving, and they deliver nothing usable until parity, apart from side-by-side running.
- **Upkeep:** forking Codex (C) means owning OpenAI's very active Rust tree, and its design is centred on OpenAI. D is the purest "own it all", but it is the longest road and has the highest upkeep (providers, OAuth, three server OSes).

## Recommendation (draft)

**No-go on a rewrite now; go on A, with B as a ready option.**

1. Turn the six follow-ups in `wishes.md` into small plans (T-10), in this order:
   1. In-process sessions through the SDK (speed and simplicity, measured against D-15).
   2. Package hardening and a bash sandbox (security).
   3. Settings sync.
   4. A login hub.
   5. Hub-to-hub notices.
2. Fork Pi (B) when one of these happens:
   - an upstream change breaks a daily need;
   - upstream blocks the in-process work;
   - an upstream package update conflicts with our hardening.
3. Re-open this go/no-go, with the measurements in `baseline.md`, if any of these happens:
   - Anthropic enforcement forces Claude through the `claude` binary (that changes G1 for every path);
   - in-process SDK sessions prove unworkable;
   - after A, start time or memory per session is still a pain;
   - Pi's license or direction changes.

**If the call is "go" anyway:**
- The cheapest real go is **E grown from B**: fork Pi, then reshape it into an in-process, multi-session server, copying rather than rewriting.
- A Rust go would start with a **3-week spike on C**:
  - The hub drives `codex app-server` over WebSocket.
  - One ce-workflow tool runs as a client-side dynamic tool.
  - The Claude pool is ported to Rust.
  - Kill criteria: a Claude turn through the port, plus compaction with our modes, both inside the spike.

Not checked: the cost figures are estimates; in-process SDK sessions in the hub are untested; Codex's Windows sandbox strength is untested; Codex with a login in WSL is untested.

## Decision (T-09, 2026-11-12)

The user chose **go on D: Rust from scratch**, against the draft recommendation. This remains investigation, as the user asked: T-10 drafts the first build plan; no implementation starts from this map.
