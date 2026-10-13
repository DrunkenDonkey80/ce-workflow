# Vendored pi-ask-user

Source: https://github.com/edlsh/pi-ask-user
Pinned npm release: **0.16.0**, copied from the installed release on 2026-10-13.
License: MIT (see LICENSE). Author: Enzo Lucchesi.

Files: index.ts and single-select-layout.ts. Keep the terminal UI and result contract aligned with upstream; use Plan3 catch-up to review upstream changes, not automatic overwrites.

## Divergences

- index.ts imports single-select-layout.ts with an explicit .ts specifier for Pi's jiti loader.
- ASK_USER_VERSION is pinned to 0.16.0 instead of reading upstream package.json (this directory is part of ce-workflow, not a standalone npm package).
- Two SAFETY comments explain upstream shim schema assertions for the repository's analyzer.

## Updating

Compare the upstream release's two source files with this directory, port applicable changes, run package verification and terminal/browser dialog checks, and update this version and divergence list. Preserve ce-workflow's remote channel and coexistence handling when those are added.
