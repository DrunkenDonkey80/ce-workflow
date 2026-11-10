# Astryx assessment for ce-workflow's design studio

## Recommendation

**Keep the studio. Add Astryx as an optional component-backed design choice, especially for app screens, dashboards and forms. Borrow its token tooling and component discovery approach. Do not rewrite the hub or make every design depend on Astryx.**

This is a research recommendation, not an approved implementation decision. No ce-workflow product files, dependencies, agent instructions or commits were changed by this investigation.

## What was inspected

- Clone: `C:/Users/Flex/AppData/Local/Temp/pi-research-62ygWq/astryx`
- Source revision: `fd5cf0df987791117e96ccc0bec603c64be8b136` (2026-11-10).
- Published runtime examined: core, CLI and neutral theme **0.7.12**, installed only in the temporary `trial` folder with lifecycle scripts disabled. The source checkout's package manifests say 0.7.13; source HEAD and npm latest are not the same release.
- Read architecture, component implementation/documentation, templates, theme generators, CLI discovery/hosting/export contracts, interaction-test design, native status, license, and our rendering/preview/system-selection code. This was a targeted integration assessment, not a line-by-line audit of the entire repository.
- Ran isolated browser compatibility experiments and our actual existing `renderDesign` function against temporary fixtures. Did not run upstream's full test suite or an agent-generation benchmark.

## What Astryx is—and is not

[The README](https://github.com/meta/astryx/blob/fd5cf0df987791117e96ccc0bec603c64be8b136/README.md) describes a beta React 19+ component library, authored with StyleX, with 150+ components, seven ready-made themes, templates and agent-facing CLI tooling. Its claim of internal use across 13,000+ apps is a vendor claim, not evidence that this public beta or our integration is production-proven.

It is not an equivalent replacement for our design sessions: it does not supply our Pi orchestration, shared terminal/web forms, reference capture, comments, Mark workflow, folder versions, clone/select and implementation handoff. Those remain our responsibility.

Prebuilt JS/CSS consumption does not require adopting a StyleX compiler. React and the StyleX runtime are still peer dependencies. Copying raw component source is different: it can bring StyleX compilation and a substantial internal dependency graph.

## Options

| Option | What changes | Assessment |
|---|---|---|
| Keep current HTML workflow; borrow ideas/utilities | Token generation, curated patterns, tests and discovery | Lowest coupling; useful even for non-React targets |
| Optional Astryx-powered prototypes inside the existing studio | React runtime inside the isolated design document; pinned assets and source; selected-system-specific guidance | **Recommended pilot**; no React conversion of the hub required |
| Make Astryx mandatory for all generated designs | Every design inherits its component/runtime conventions | Not justified; constrains non-React implementation targets and bespoke marketing/deck work |
| Rebuild the hub itself with Astryx | Reconcile imperative DOM/event code, React ownership, shared ask_user forms, styling and browser support | High-risk rewrite, no demonstrated payoff; not recommended |

Our current system picker fetches `DESIGN.md` and optional `tokens.css` from OpenDesign. Astryx's component library is not a drop-in replacement for those files. A token-only system can be adapted; a component-backed option needs a declared runtime/build contract.

## Best things to take

### 1. Generate a coherent theme instead of asking the agent to invent every value

[Theme implementation](https://github.com/meta/astryx/tree/fd5cf0df987791117e96ccc0bec603c64be8b136/packages/core/src/theme) includes:

- `expandColorScale.ts`: HCT-based accent and neutral ramps, light/dark outputs, stronger-contrast option, and contrast adjustment for control borders.
- `contrast.ts`: actual WCAG luminance/contrast calculations, including compositing a translucent foreground against its backdrop.
- `expandTypeScale.ts`: a base/ratio-generated type scale and semantic text roles.
- `expandRadiusScale.ts`: semantic inner/control/container/page radii.
- `defineTheme` and the CLI theme compiler: an explicit theme definition compiled to CSS.

This fits our existing Tweaks panel and token handoff better than adding more prose rules. First try producing theme CSS with the public tooling; vendor small pure utilities and their tests only if that proves simpler. Do not copy the whole theme engine just for a few token values. Generated token contrast is not a guarantee that an arbitrary finished page is accessible.

### 2. Version-aware, on-demand component and pattern discovery

[The CLI](https://github.com/meta/astryx/blob/fd5cf0df987791117e96ccc0bec603c64be8b136/packages/cli/README.md) searches components, hooks, templates, docs and themes together. Results include a follow-up command. JSON responses identify the CLI/core versions that answered; component docs include props, anatomy, theming and good/bad usage.

The live `search dashboard --limit 5 --json` experiment returned an exact dashboard template plus related components/patterns. This is a concrete way to reduce guessed APIs, not a reason to load the entire catalog into every prompt. Use it only when a design selects Astryx, or as a model for our own selected-system discovery.

Keep it out of the hub process: the documented `@astryxdesign/cli/host` entry owns process state and can terminate the process. A bounded subprocess or deliberately selected API is safer. Do not run `init` in the repository automatically: it writes agent instruction files.

### 3. Reuse complex behavior rather than redraw inert controls

Forms, selectors, dialogs, command palettes, tables and navigation are the compelling parts. Our research fixture exercised real state changes, focus return and touch-specific selection rather than screenshots of fake controls.

Templates are useful starting structures, not dependency-free assets. For example, the dashboard page imports Recharts and Heroicons in addition to Astryx. Its sample data is fixture content, not copy to ship. Select only the patterns needed for the brief.

[Swizzle](https://github.com/meta/astryx/blob/fd5cf0df987791117e96ccc0bec603c64be8b136/packages/cli/api/swizzle/swizzle.doc.mjs) copies needed internal modules as well as the component; it does not copy tests, stories or docs. Prefer public components over maintaining copied complex controls. Small framework-independent helpers are a better borrowing target.

### 4. Better interaction evidence

[The internal interaction harness](https://github.com/meta/astryx/blob/fd5cf0df987791117e96ccc0bec603c64be8b136/internal/interaction-harness/README.md) measures trusted touch input, gesture cancellation, animation frames, reduced motion, and main-thread stalls, with negative controls for some instruments. It is internal/unpublished, not a ready supported dependency.

Borrow the testing method first: a phone-width screenshot is not a touch test. Focus, keyboard dismissal, input method composition, enlarged text, reduced motion and transient states deserve explicit checks. Do not import the full harness or its governance machinery into our smaller project without a demonstrated need.

Some gesture factories such as `createPanGesture` and `createDragToSnapPoints` operate on DOM elements without React. They still depend on a shared gesture/motion engine; they are not isolated ten-line snippets. Keep them on the watchlist for a concrete gesture problem.

### 5. Portable HTML export with recoverable source

[Astryx experimental render](https://github.com/meta/astryx/blob/fd5cf0df987791117e96ccc0bec603c64be8b136/packages/cli/assets/docs/tree/render-pages.doc.mjs) can produce a self-contained static HTML artifact, prune CSS, embed local assets, and embed source that can be restored.

The isolated trial produced a 39,970-byte artifact; reverse export reported `exact: true`, and comparison of the original/restored TSX found no difference. This is a useful idea for shareable design handoffs.

Important limits: it is experimental, does not preserve live state/effects/click handlers, and embeds source files that recipients can read. A trial with direct package CSS imports failed with `ERR_RENDER_FAILED` / unknown `.css` extension; removing those imports allowed its automatic core CSS path to succeed. The successful test did not establish full custom-theme CSS fidelity. Do not replace our live preview with this exporter.

## Compatibility results

All experiment files are under `C:/Users/Flex/AppData/Local/Temp/pi-research-62ygWq/trial/`.

### No-build CDN starter

`cdn-probe.mjs` used the CLI-generated HTML starter plus one stable `data-id`, our actual `DESIGN_BRIDGE`, and our opaque-origin iframe/CSP policy.

- Rendered successfully; no page errors, failed requests or HTTP error responses recorded.
- Comment pick returned the correct button ID and text; pin appeared in the screenshot.
- Live style editing worked after the CSS transition settled.
- localStorage remained inaccessible (`SecurityError`), confirming the sandbox restriction was retained.
- **607 observed requests** in the final probe, including the parent/preview documents; **604 resource timing entries**. The first measurement stopped at the browser's 250-entry timing buffer; the final probe enlarged that buffer and separately counted requests. This tiny example imports the package root and traverses a broad module graph. This is not a general lower bound for optimized Astryx applications.

Conclusion: useful for a quick experiment, not the preferred default for durable/offline versions. Pinned top-level CDN URLs still led to a ranged Lucide dependency URL. Bundle/cache the complete dependency graph for reproducibility rather than depending on future CDN resolution.

### Locally bundled interactive fixture

`local-probe.mjs` used published prebuilt packages, no StyleX build plugin, and blocked every non-loopback request. Tested 1440px mouse, 390px mouse and 390px emulated touch.

- Controlled text input, selector choices, native dialog open/Escape, focus return and light/dark switching worked.
- Our real bridge identified components by `data-id`, intercepted comment clicks and applied inline CSS edits.
- No page errors or initial horizontal overflow were reported.
- With explicit `presentation="adaptive"`, the same selector became a popover with mouse input and a bottom sheet with touch input.
- Screenshots were visually inspected. Early local captures caught transitions and were blank; settled captures were correct. This reinforces the need for a defined render-ready/settled condition.
- Sample payload: JS 815,502 bytes (263,868 gzip); JS plus three CSS files approximately 309 KiB gzip. This is one unoptimized fixture including React, theme, input, selector and dialog—not an application benchmark or minimum size.

`render-probe.mjs` then called our existing `renderDesign` at 390×900 and 1440×900. Both produced nonempty screenshots with no overflow, page/console errors or failed resources.

### Gaps found in our studio, not reasons to discard Astryx

1. **Input mode:** `C:/SOFT/git/ce-workflow/hub/web/design-view.ts` and `C:/SOFT/git/ce-workflow/extensions/design-render.ts` change dimensions, not pointer capabilities. Phone sizing on a desktop cannot faithfully show touch-adaptive behavior. A real-browser touch check or an explicit preview presentation mechanism is needed; an ordinary iframe cannot turn the parent's mouse into a coarse pointer.
2. **Modal pins:** `C:/SOFT/git/ce-workflow/hub/src/design-bridge.ts` puts pins in a body-level layer. A pick inside an Astryx native dialog worked, but its pin was hidden behind the dialog/top-layer backdrop. Verified in the screenshot. Overlay-aware pins need their own integration check.
3. **Mark and transient state:** Mark opens a fresh render from folder, screen, dimensions, hash and style edits. It does not transport an open dialog, filled form or React state. This follows directly from `RenderState`/`renderDesign`; it is also a limitation for other interactive HTML. Need an explicit state contract or a live-state capture approach before claiming exact interactive-state screenshots.
4. **Source versus built output:** Comments should resolve stable IDs into editable source, not generated bundle fragments. Keep authoring source and compiled assets in the versioned design; keep node_modules/build caches outside per-version snapshots. If a build step is added, mark a version ready only after its build succeeds.

## Maturity, contradictions and license

- **Beta and moving APIs:** pin exact core/CLI/theme versions together. Source HEAD differs from npm latest. Changelogs include behavior changes even where the API shape stays similar.
- **Docs contradiction:** the v0.6.0 release article describes adaptive Selector behavior as the default. Both the checked-in `Selector.tsx` (line 1199) and installed 0.7.12 implementation default to `popover`; current component docs also say popover. The experiment confirmed it. Use installed-version component docs and code over a release article.
- **Browser floor:** [browser-support docs](https://github.com/meta/astryx/blob/fd5cf0df987791117e96ccc0bec603c64be8b136/packages/cli/assets/docs/browser-support.doc.mjs) rely on CSS anchor positioning, Popover and light-dark(). They explicitly warn that older-browser layered surfaces may open without correct anchoring. Our real iPhone/Safari paths remain to be checked.
- **Not every document is a finished feature:** `docs/design/agentic-states.md` is explicitly an unresolved draft, not a ready-designed agent-status language.
- **Native is not a production alternative:** [native README](https://github.com/meta/astryx/blob/fd5cf0df987791117e96ccc0bec603c64be8b136/packages/native/README.md) says experimental/canary only, unsupported for production, with Android and React Native bindings not built yet. Lab and chart packages also have distinct publication/stability limits.
- **License:** [MIT](https://github.com/meta/astryx/blob/fd5cf0df987791117e96ccc0bec603c64be8b136/LICENSE) permits using/modifying/copying code, retaining the copyright and permission notice. Preserve notices and check separately bundled fonts/icons/assets; source availability is not a trademark grant.
- **Trust boundary:** the browser sandbox is not an OS sandbox for CLI/build execution. Project config and page modules can execute code; loading them requires ordinary project trust. Never auto-execute third-party reverse-exported source.

## Proposed next step, if approved

Run a bounded comparison using one real app/settings or dashboard brief, not a hub rewrite:

1. Current HTML approach versus optional Astryx components, with equivalent brief/model/settings and fresh sessions.
2. Preserve comments, edits, snapshots/restore and handoff; explicitly test modal pins, touch presentation and transient-state screenshots.
3. Compare design quality and accessibility alongside total runtime, provider tokens, cost, turns and tool calls across all continuations. The compatibility probes above do not establish an efficiency win.
4. Keep Astryx optional only if the complete result is better for its intended class of designs. Adopt token/discovery/testing improvements independently where they help every design.

No real-phone/Safari trial, assistive-technology audit, full upstream test run, or end-to-end generation/cost benchmark was performed. Those are the remaining evidence gaps, not proven failures.
