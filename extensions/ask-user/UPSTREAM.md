# Vendored pi-ask-user

Source: https://github.com/edlsh/pi-ask-user
Reviewed npm release: **0.17.0**, selectively ported on 2026-10-24 from the 0.16.0 vendored base (copied 2026-10-13).
License: MIT (see LICENSE). Author: Enzo Lucchesi.

Files: index.ts and single-select-layout.ts. Keep the terminal UI and result contract aligned with upstream; use Plan3 catch-up to review upstream changes, not automatic overwrites.

## Divergences

- index.ts imports single-select-layout.ts with an explicit .ts specifier for Pi's jiti loader.
- ASK_USER_VERSION is pinned to 0.17.0 instead of reading upstream package.json (this directory is part of ce-workflow, not a standalone npm package).
- Two SAFETY comments explain upstream shim schema assertions for the repository's analyzer.
- Removed unused upstream AskComponent.frameRawLines method (no callers).
- Result rendering handles missing details before narrowing batch versus single results, preserving cancellation output while passing TypeScript checking.
- remote.ts adds validated single/batch answer decoding and an abortable first-answer-wins race, always emitting ask:pending and correlated ask:closed. index.ts wraps each native prompt with it; upstream answer summaries, cancellation and batch skipped states stay unchanged. Browser answers are not environment-gated. The same race carries typed list menus and browser cancellation; work-dialogs.ts aborts losing overlays/selectors. Intercom forwarding remains opt-in in work-ask-remote.ts and skips list menus.

- `initialText` (single question or batch entry, no options, at most 16,000 characters) pre-fills the answer: the AskComponent opens in its multi-line editor holding the text (a single pre-filled question skips the one-line `ui.input`, which cannot pre-fill), dialog fallbacks use `ui.editor(title, text)`, and the browser prompt shows it in its textarea. Used by Plan3 Generate for remembered directions; `loadPlan3Ask` reports `prefills: false` for an external pi-ask-user so callers fall back to the terminal editor.
- Factory registration waits for session_start, after all extensions load; if another ask_user exists it skips ours and warns once (D12). registerAskUser is exported so the Plan3 command adapter can instantiate the same tool without lifecycle hooks.
- Alt+V in the answer/comment editor pastes a clipboard image (native clipboard; PNG, JPEG, GIF or WebP) as a `pi-clipboard-<uuid>` temp-file path, like Pi's chat editor (`pasteClipboardImage`).

## 0.17.0 review

- Ported the optional batch heading (top-level question), including terminal frame/review, fallback dialogs, result text and call card. The remote race passes it as `title` for ask:pending and the hub form.
- Ported model-only tool exposure with the upstream-compatible spread; direct Plan3 adapter execution is unchanged.
- Not ported: ask-user.json settings (environment defaults remain), Tern native sheets, or the Tern activate/submit refactor. Terminal/hub behavior and the native single/batch remote-answer race and D12 coexistence stay intact.
- single-select-layout.ts has no relevant change to port.

## Updating

Compare the upstream release's two source files with this directory, port applicable changes, run package verification and terminal/browser dialog checks, and update this version and divergence list. Preserve ce-workflow's remote channel and coexistence handling when those are added.
