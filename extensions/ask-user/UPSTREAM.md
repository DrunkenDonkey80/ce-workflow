# Vendored pi-ask-user

Source: https://github.com/edlsh/pi-ask-user
Pinned npm release: **0.16.0**, copied from the installed release on 2026-10-13.
License: MIT (see LICENSE). Author: Enzo Lucchesi.

Files: index.ts and single-select-layout.ts. Keep the terminal UI and result contract aligned with upstream; use Plan3 catch-up to review upstream changes, not automatic overwrites.

## Divergences

- index.ts imports single-select-layout.ts with an explicit .ts specifier for Pi's jiti loader.
- ASK_USER_VERSION is pinned to 0.16.0 instead of reading upstream package.json (this directory is part of ce-workflow, not a standalone npm package).
- Two SAFETY comments explain upstream shim schema assertions for the repository's analyzer.
- Removed unused upstream AskComponent.frameRawLines method (no callers).
- Result rendering handles missing details before narrowing batch versus single results, preserving cancellation output while passing TypeScript checking.
- remote.ts adds validated single/batch answer decoding and an abortable first-answer-wins race, always emitting ask:pending and correlated ask:closed. index.ts wraps each native prompt with it; upstream answer summaries, cancellation and batch skipped states stay unchanged. Browser answers are not environment-gated. The same race carries typed list menus and browser cancellation; work-dialogs.ts aborts losing overlays/selectors. Intercom forwarding remains opt-in in work-ask-remote.ts and skips list menus.

- Factory registration waits for session_start, after all extensions load; if another ask_user exists it skips ours and warns once (D12). registerAskUser is exported so the Plan3 command adapter can instantiate the same tool without lifecycle hooks.

## Updating

Compare the upstream release's two source files with this directory, port applicable changes, run package verification and terminal/browser dialog checks, and update this version and divergence list. Preserve ce-workflow's remote channel and coexistence handling when those are added.
