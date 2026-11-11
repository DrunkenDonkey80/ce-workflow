# Standalone theme generation — P3-08

## Implementation boundary

The existing `design` tool now accepts `action: "theme"`, a required six-digit accent seed, and optional neutral seed, body size, type ratio and radius. It returns CSS, JSON, measured contrast, DESIGN.md notes and optional Tweaks markup. The design session remains the source writer. Selection carries the token files into the existing handoff.

Generation consumes the published `@astryxdesign/cli/api#generateTonalPalette` from the verified 0.7.12 cache in a fixed, shell-free child. The worker uses the cache as its working directory, never project configuration; input is validated before provisioning. The child has a 20-second timeout, 128 KiB output cap and cancellation, and strips ambient Node/npm code hooks. It loads extension TypeScript through jiti, including when installed under node_modules.

The generated files import neither React nor StyleX and need no component build/runtime to preview, version or export. Generation uses the optional host tooling cache established by P3-18; ordinary HTML designs still do not provision it. This is a capability, not a speed optimization.

No upstream implementation was copied. The public pinned API supplies 21-stop accent/neutral ramps and exact seed anchors in both modes. Our semantic mapping, scale CSS, contrast calculation and preview helper are local code. Existing bundled package notices remain applicable. API details were checked against the installed 0.7.12 declarations/docs and the upstream public API documentation, not assumed from newer main.

## Output and interaction

- `tokens.css`: mode-specific ramps and semantic colors, CSS-variable-based type/radius scales, system dark-mode preference and explicit root `data-theme` switching.
- `theme.tokens.json`: exact API/version/lock/recipe, inputs, ramps, modes, scales and sixteen unrounded contrast measurements with separate pass/fail thresholds.
- `designNotes`: mergeable DESIGN.md notes, including failed pairs; not a whole-page accessibility claim.
- Optional native Tweaks controls use the existing `design:tweaks` / Keep-to-chat path. Live seed changes are explicitly temporary overrides; Keep requires regeneration of both ramps and evidence. Type/radius changes update their dependent variables. Capture/restore supports those knob values without replacing the app's declared draft API.
- Coarse-pointer controls have 44×44 minimum targets. Real-device and Safari compatibility is still outstanding.

## Verification — 2026-11-11, Windows, Node 26.13.0

- Red before implementation: `node "scripts/test-work-design.mjs"` failed on the missing theme module.
- Final C1: `node "scripts/test-work-design.mjs"` passed, 64.5s. Covers a fixed CSS golden, deterministic outputs, light/dark semantics, invalid colors/null/nonfinite/range inputs, exact threshold handling, foreground/background alpha compositing, bounded jiti/public-API worker execution, tool routing, export/handoff and actual coarse-pointer rendering. All five generated controls meet 44×44 bounds under observed touch input.
- Final C4: `node --no-warnings "hub/scripts/test-browser.mjs"` passed, 168.7s. The real hub with fake Pi verifies live color/type/radius/dark values, exact Keep text, no source mutation, restored generated dark color, invalid draft refusal and the existing preview/Mark interactions.
- One added C4 touch-driver check failed because late page-level emulation left the opaque iframe reporting a fine pointer. That is not claimed as touch evidence. The unchanged target-size/capability assertion now runs through the production renderer's before-navigation touch setup in C1, where it passed. C4 was rerun unchanged apart from moving this check and passed.
- C7: `node "scripts/test-work-tool-loader.mjs"` passed.
- A pre-existing scheduler readonly-stdio tuple produced four TypeScript errors. A type-only mutable tuple correction preserves its behavior; `node --no-warnings "hub/scripts/test-scheduler.mjs"` passed, 11.2s. An existing changelog list-spacing blocker was corrected without changing its words.
- C9 active `lens_diagnostics`, `source=lsp`, `scope=paths`, reported no diagnostics but was inconclusive on silent push-only rechecks. To avoid calling that clean, the advertised LSP command `typescript.tsserverRequest` explicitly ran `syntacticDiagnosticsSync` and `semanticDiagnosticsSync` on design-theme.ts, design.ts, test-work-design.mjs, test-browser.mjs and scheduler.ts. All ten responses succeeded with empty diagnostic bodies. This does not certify the full workspace or silent auxiliary analyzers.
- `git diff --check` passed.

## Real pinned-library call

The final `runTheme({accent: "#c2410c"})` used the existing verified cache with a confirmation callback that throws if any new install prompt occurs. It completed without that callback, in 9,277ms, after an earlier successful 8,192ms warm call. No new download or paid model run was performed. Integrity verification still dominates warm use; this is not evidence of faster reuse.

Source: CLI 0.7.12, recipe `astryx-oklch-v1`, dependency-lock digest `93973bb82266e3f12b669f500aeef2d0be05e66b7b0b73d4c99fc79ebaa6dbe5`.

The final call returned 4,587 bytes of CSS and 3,007 bytes of optional controls. Light accent was exactly `#c2410c`; dark semantic accent was `#f68966`. All sixteen measured token pairs passed for that example only; the synthetic gray regression deliberately contains failures. Final rendered pages and their states still require their own checks.
