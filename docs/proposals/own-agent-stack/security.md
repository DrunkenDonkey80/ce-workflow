# What an agent can do here, and what a sandbox would stop (T-03)

Snapshot 2026-11-12 on this machine: Windows native, user `Flex` (not elevated), WSL distro Ubuntu-26.04, Pi 1.5.2. Part of the map `docs/plans/2026-11-12-own-agent-stack-instead-of-pi-go-no-go-map-11005151-plan3.md`.

## Rights today

Pi documents this plainly (`docs/security.md` in the Pi package): Pi, its tools, every extension and every child process run with the full rights of the user that started them. Pi has no built-in sandbox. Project trust only decides what a folder may load; it does not limit tool calls.

- **Files:** read and write everything `Flex` can reach. That includes credentials found present (contents not read):
  - Pi: `~/.pi/agent/auth.json` and `claude-pool.json` (Anthropic and OpenAI Codex OAuth, OpenRouter key).
  - Other tools: `~/.claude/.credentials.json`, `~/.codex/auth.json`, the GitHub CLI `hosts.yml`.
  - Machine and cloud: `~/.ssh`, `~/.aws`.
- **Network:** unrestricted outbound. The hub listens on 127.0.0.1 only and requires a local key; remote access goes through Tailscale `serve` with an owner login and paired devices (`hub/src/hub.ts`, `hub/src/remote.ts`).
- **Processes:** any; Git Bash by default, PowerShell optionally; browser, app, phone and VM automation through our own extensions (`browser_act`, `app_act`, `mobile_act`, `vm_act`).

## Code we run (counted with `pkgs.mjs`)

| Root | Installed packages | With install scripts |
|---|---|---|
| Pi 1.5.2 release | 122 | `@google/genai`, `protobufjs` |
| `~/.pi/agent/npm` (pi-lens, pi-subagents, pi-web-access, pi-intercom, pi-goal, context7, prompt-template-model) | 259 | `@ast-grep/cli`, `esbuild` |
| ce-workflow | 133 | `@google/genai`, `protobufjs` |
| pi-provider-claude-ex, ponytail (git) | 0 extra | none |

About 500 installed packages, 4 with install scripts. The hub's auto-update (`hub/src/auto-update.ts`) runs `pi update <source>` for each package when a check finds a new version. A new upstream release of any third-party package is therefore loaded into every session without review.

## Realistic threats, ranked

1. **Prompt injection reaching shell or file tools.** Web pages, fetched docs, issues and repository files are read daily (inventory D-09). An injected instruction can read and send any credential listed above. This is the most likely threat, and it needs no bug anywhere.
2. **Supply chain through auto-updated packages.** A compromised release of a third-party Pi package, or of one of its ~500 dependencies, runs in-process with full rights on the next update.
3. **Destructive commands by mistake** (deletes, force pushes). Mitigated today by git and by rules, not by any boundary.
4. **Remote hub exposure.** Narrow already: loopback plus local key, or a Tailscale owner login.

## What a sandbox stops, and where

| Sandbox | Covers | Stops | Does not stop |
|---|---|---|---|
| Whole Pi plus hub in WSL as a dedicated Linux user, or in Docker | Pi, tools, extensions | reads of Windows-side credentials, `~/.ssh` and `~/.aws` unless mounted | anything mounted in, provider tokens inside, network exfiltration unless filtered |
| Tools-only sandbox (Gondolin micro-VM extension, Pi docs) | built-in tools and `!` commands | injected shell commands touching the host | extensions (in-process), host environment variables |
| Codex-style per-command sandbox (`codex-rs/windows-sandbox-rs`: restricted token, elevated mode with a sandbox user; Linux and macOS have their own) | each shell command | writes outside the workspace; with the elevated mode, reads of denied paths | the agent process itself and its plugins or MCP servers |
| Tool-level permission prompts (OpenCode, Goose) | nothing at OS level | only what the user denies | everything else; OpenCode's own security page says so |

Sources: Pi `docs/security.md` and `docs/containerization.md` (1.5.2); Codex `codex-rs/sandboxing/src/windows.rs`, `windows-sandbox-rs/src/token.rs` (github.com/openai/codex, main as of 2026-11-12); Goose issue #12805 (no OS sandbox yet, one proposed; the macOS seatbelt mode was removed in v1.25.0, per a third-party guide, unverified); OpenCode `github.com/anomalyco/opencode/security`.

Per server OS (D-08):
- **Windows native:** only Codex ships a sandbox (restricted token or a sandbox user). Pi, Goose and OpenCode have none. The strength of Codex's sandbox was not tested here.
- **WSL and Linux:** Codex ships landlock and seccomp (from the candidate research, not re-read here). For any agent, a dedicated Linux user, a container or bubblewrap is available.

## Verdict: hardening is possible on Pi

**Possible on Pi**, at three levels of cost (a rough judgement, not measured):

1. **Fewer packages, no blind updates (small).** Pin third-party packages and update them only after review, instead of auto-update. Drop the rare ones (pi-goal) and replace pi-lens (298k lines, mostly one daily tool) with a small owned diagnostics tool. This shrinks threat 2 without touching Pi.
2. **Per-command sandbox for bash (medium).** An owned extension that runs `bash` through a restricted helper. On Windows that could be Codex's Apache-2.0 `windows-sandbox-rs` built as a helper binary (addable: the code exists, untested here); on WSL and Linux, bubblewrap. Credentials stay out of the commands' reach. Extensions still run in-process.
3. **Whole stack in WSL as a separate user (medium).** The hub plus Pi run in WSL and only the project folders are mounted, with Windows-side credentials not mounted. The Windows clients connect over loopback. This covers extensions too. It changes the D-08 Windows-native server story: Windows native would only launch it.

No candidate removes threat 1 by itself: any agent that may read the web and run commands needs one of these boundaries. A rewrite would buy a sandbox only if it adopted Codex's sandbox code, and that code can be used from Pi as well (level 2).

Unverified: Codex sandbox strength on Windows; Goose's removed seatbelt mode (secondary source); whether bubblewrap works inside this WSL distro.
