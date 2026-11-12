# Agents we could fork (T-05)

Snapshot 2026-11-12. Part of the map `docs/plans/2026-11-12-own-agent-stack-instead-of-pi-go-no-go-map-11005151-plan3.md`. Primary-source research by a `researcher` subagent (raw brief kept at `%TEMP%\own-agent-stack\candidates-research.md`), with the gate-critical claims re-checked here. Release tags are the pins; exact commit SHAs were not exposed for every tag.

## Gates

- **G1 (D-07):** keep the Claude subscription, the OpenAI Codex subscription logins and the other enabled providers.
- **G2 (D-08):** the server runs on Windows native, WSL and Linux.
- Verdicts: **passed** (shipped, cited), **addable** (missing, but shown feasible by existing code), **unverified**, **failed**.

## A finding that changes G1 for every path

Anthropic's usage policy (`code.claude.com/docs/en/legal-and-compliance`, fetched 2026-11-12) says:
- Subscription OAuth "is designed to support ordinary use of Claude Code and other native Anthropic applications".
- "Developers may not collect, store, or intermediate Claude.ai credentials or session tokens".
- It does allow "an end user signing in to the unmodified Claude Code binary with their own Claude subscription".
- News reports say this has been enforced against third-party agents since 2026-04-04 (VentureBeat 2026-04-04, The Register 2026-02-20; secondary sources).

What it means here:
- **How we use Claude today:** Pi's `anthropic` OAuth login plus pi-provider-claude-ex call the API directly with subscription tokens, under Claude Code-shaped tool names (see the pi-provider-claude-ex README). That is the pattern the policy describes as off-limits. This is a reading of the policy text, not legal advice.
- **The policy-safe route:** run the unmodified `claude` binary under your own login. Goose does this with its `claude-acp` provider, and so do other tools that wrap Claude Code.
- **Cost of that route:** a Claude turn then runs Claude Code's own agent loop. Our tools reach it only as MCP servers, and our extensions don't run inside that loop (inferred from how ACP wrapping works; not tested).
- **Which paths are affected:** the same choice exists for Pi, a Pi fork and every owned server, so it doesn't favour a rewrite. It does decide what "passed" means for G1. Question Q-01 asks it.

The OpenAI Codex subscription has no such restriction in the sources found: OpenCode and Goose ship ChatGPT sign-in, and Pi ships it too.

## Candidates

| Candidate | Lang, license, pin | Server for our hub | G1 Claude | G1 Codex | G2 | Sandbox, Windows native | Extensions | Fit notes |
|---|---|---|---|---|---|---|---|---|
| **Pi** (stay, harden, or fork) | TS, MIT, v1.5.2 (2026-11-10) | RPC per process today; SDK in-process sessions (`docs/sdk.md`) | passed by direct OAuth (policy risk above); addable by the `claude` binary via an ACP or Agent SDK extension | passed | passed (runs here on Windows; WSL documented in `docs/windows.md`); Linux per installer | none; hardening per `security.md` | TS in-process extensions, 33 events we use; MCP via `pi-mcp` | Our 25k lines of extensions and the hub run as they are |
| **Codex `codex-rs`** | Rust, Apache-2.0, v0.167.1 (2026-11-10), ~125k stars | `codex app-server`: JSON-RPC over stdio or WebSocket (`--listen ws://`), one process hosts many threads (OpenAI blog 2026-02-04, `app-server-transport/src/transport/websocket.rs` @ 5af85998) | addable: port our TS OAuth code, or wrap the `claude` binary (same policy question) | passed (native ChatGPT sign-in) | passed (Windows, Linux binaries; WSL documented) | **shipped**: restricted token, or an elevated sandbox user (`windows-sandbox-rs`); Linux landlock and seccomp; strength untested | MCP, hooks, subagents in the protocol; no in-process plugin language | Best server and sandbox; built around OpenAI, upstream moves fast; every extension would be rewritten as MCP or in Rust |
| **Goose** (`aaif-goose/goose`, ex Block) | Rust, Apache-2.0, v1.59.0 (2026-11-10), ~56.5k stars | `goosed` REST and SSE (discussion #7697); official API schema and multi-session per process unverified | passed via `claude-acp` (wraps the `claude` binary, policy-safe) | passed (`chatgpt-codex` native, or `codex-acp`) | passed for Windows and Linux; WSL unverified | **none** (issue #12805 proposes one; seatbelt mode removed, secondary source) | MCP-first (70+ extensions), recipes | ACP providers lack session fork and resume (Goose docs), and we use the session tree weekly |
| **OpenCode** (`anomalyco/opencode`) | TS, MIT, v2.2.6 (2026-11-06) | HTTP server mode with API, opt-in with a password (`opencode.ai/docs/server`) | **failed** for its own Claude login: removed from the bundle, Anthropic forbids it; addable only by wrapping the `claude` binary (unverified) | passed | passed for Windows and Linux; WSL unverified; a Windows path bug in `external_directory` deny (issue #16126) | none (its own security page says permissions are not isolation) | plugins (TS), MCP, custom tools, agents | Closest TS alternative to Pi with a real server, but its Claude login was removed |
| **Zed agent** | Rust, GPL and Apache mix, editor-bound | none standalone | via ACP | via ACP | Windows sandbox only inside WSL | — | — | Screened out: tied to the editor, no standalone server |
| **Rust from scratch** | Rust, ours | ours to design | addable (port of our TS code, or the `claude` binary) | addable (Codex OAuth flow is open in `codex-rs`) | by construction | addable: reuse Codex's Apache-2.0 sandbox crates | ours to design | Largest cost: Pi core alone is ~116k lines (D-09) |
| **Own TS server** | TS, ours | ours to design | addable (we own the provider code already) | addable (port Pi's MIT login code) | by construction | addable, same as Pi hardening | ours to design | Converges with "fork Pi" unless something specific in Pi hurts |

Screened out without a full look: Forge (no authoritative source found), Python and Go agents (outside D-04's Rust-versus-TS comparison). Haystack (Apache-2.0, Python) is a design reference only: its `Agent` component loops model and tool calls until an exit condition. It adds nothing on sandbox or logins.

## Reading

- **No candidate passes both gates in the same way as today.** Today's direct Claude OAuth works only in Pi (and in any owned stack that copies our code) and carries the policy risk. With the policy-safe route, Claude turns run inside Claude Code in every stack.
- **Codex** is the strongest base for a Rust server: a multi-thread app-server over WebSocket, plus the only Windows-native sandbox. It would need our Claude provider added, and all extensions moved to MCP or Rust.
- **Goose** passes G1 through ACP but loses session fork and resume on those providers, and it has no sandbox.
- **OpenCode** fails G1 for its own Claude login.
- **Pi** (stay, harden, or fork) keeps everything that works today. Its gaps (sandbox, process per session) are possible on Pi per `wishes.md` and `security.md`.

For T-07, the finalists to measure are **Codex app-server** (Rust, best server and sandbox) against **Pi** (already measured in `baseline.md`). Goose is the reserve if Q-01 picks the policy-safe route.

## Unverified

- Codex Windows sandbox strength.
- Goose `goosed` schema and multi-session behaviour, and WSL.
- OpenCode WSL support, and whether a `claude`-binary wrapper exists for it.
- The tool and extension behaviour of Claude turns under ACP.
- Stars, contributors and line counts for Goose, Pi and OpenCode.
