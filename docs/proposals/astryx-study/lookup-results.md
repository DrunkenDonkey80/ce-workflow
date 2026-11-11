# Installed-version discovery — P3-09

## Delivered

The existing `design` tool now accepts `action: "lookup"`:

- `query` searches components, templates, themes, docs and hooks; optional `catalog` narrows it, and `limit` defaults to 5 (maximum 10).
- `catalog` plus exact `name` reads a requested item. Component sections support `usage`, `props` and `examples`; docs accept a section heading and hooks accept `params`.
- Optional `libraryVersion` must equal the pinned CLI release. Package/version selectors, filesystem paths and traversal names are refused before provisioning.
- Every reply includes exact dependency versions and the reviewed lock digest. Documentation is returned as reference data, not permission to run CLI setup/install/scaffold commands.

`systems` exposes small pinned Astryx reference metadata alongside the existing brand catalog, even when the brand index is unavailable. Explicit selection caches only its compact guide and source metadata; normal sessions do not receive the catalog or other systems' guidance. Session storage and exported BRIEF.md distinguish an Astryx dependency lock from an OpenDesign Git commit. Merely selecting this reference does not install tooling or create a component app starter; that remains P3-10.

## Boundaries

- Query: 256 UTF-8 bytes, without control characters. Exact names: 120 bytes, without package selectors or traversal segments.
- Child: fixed extension TypeScript entry through jiti, shell disabled, 20-second timeout, cancellation and 128 KiB stdout/stderr limits. Ambient Node/npm/Astryx hooks are stripped; jiti filesystem compilation caching is disabled.
- Public API response: maximum 48 KiB before the fixed provenance wrapper. Errors are bounded to 600 characters before their fixed prefix.
- At most 32 successful lookup responses are retained in memory, keyed by reviewed lock, cache directory and normalized request, never `latest`. Returned cached values are cloned. Runtime integrity verification still happens before cache reuse.
- Cache-root manifest and installed CLI/core versions are checked before loading the public API. Cache-root Astryx configuration is refused. The root package.json stops normal config discovery before project ancestors; the reviewed manifest declares core/CLI, so the cache is an in-project package set rather than an outside-project/global-integration search.
- Component reads are core-scoped and compact. Template reads explicitly use the inspected `show: true` branch with no destination, CDN or overwrite option. Discovery never calls the CLI host, init, copy, theme writers or configured remote discover sources.
- Theme generation reuses the same bounded worker while retaining its standalone CSS/JSON output.

## Checks

- Red before implementation: `node "scripts/test-work-design.mjs"` failed on the absent lookup module.
- Final C1: `node "scripts/test-work-design.mjs"` passed in 62.8 seconds. Covers schema/input/count/size limits, source/version metadata, immutable cached replies, read-only template dispatch, unknown names, pin/installed-version mismatch, malformed cache metadata, refused cache configuration, pre-start and running cancellation, no new project/cache files, offline reference listing, selected-only guide, and reference provenance through selection/start/export. Existing theme and design regressions also pass.
- A new malformed-root-manifest assertion initially expected only our metadata error. Node rejects that manifest before the worker loads, with `Invalid package config`; the assertion now accepts that precise native rejection too. No product fix or retry of paid work was needed.
- C7: `node "scripts/test-work-tool-loader.mjs"` passed.
- C9: active LSP checks returned no errors on design-library.ts, design-lookup.ts, design-theme.ts, design.ts and test-work-design.mjs. Explicit advertised TypeScript `syntacticDiagnosticsSync` and `semanticDiagnosticsSync` requests also succeeded with empty diagnostic bodies on all five files.
- `git diff --check` passed. No full test suite, paid benchmark, commit or push was run for this step.

## Actual installed 0.7.12 API checks

Used the already approved verified host cache, with an approval callback that throws instead of authorizing any download. All six bounded worker calls succeeded:

| Request | Time, including runtime verification | Reply bytes, including provenance |
| --- | ---: | ---: |
| Search `dashboard`, limit 3 | 9,976 ms | 1,991 |
| Component `Button` | 8,321 ms | 12,289 |
| Template `dashboard`, read-only source | 8,453 ms | 28,765 |
| Theme `neutral` | 8,905 ms | 794 |
| Docs `tokens`, namespace summary | 8,539 ms | 947 |
| Hook `useClickableContainer` | 8,497 ms | 4,408 |

A subsequent full runtime integrity check succeeded with `cold: false` and zero downloaded bytes. A follow-up docs search resolved `authoring/building-blocks/docs/add-a-topic`; its requested detail returned 7,834 bytes. After sharing the worker, real theme generation also passed in 7,811 ms, producing 4,587 CSS bytes and 16/16 passing sampled contrast pairs.

Lock: `93973bb82266e3f12b669f500aeef2d0be05e66b7b0b73d4c99fc79ebaa6dbe5`. CLI/core/neutral theme: 0.7.12. Other direct pins: StyleX 0.19.1, esbuild 0.28.2, React/React DOM 19.3.1.

These are capability and integrity checks, not a speed-optimization or end-to-end benchmark claim. Verification remains expensive at roughly 8–10 seconds per measured request. Remote browser/device checks and the component starter/build lifecycle remain later plan work; real Safari/touch hardware is still unverified.
