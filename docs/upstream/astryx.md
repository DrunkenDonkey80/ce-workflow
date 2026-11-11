# Astryx: adopted surfaces and compatibility watch

Upstream: [meta/astryx](https://github.com/meta/astryx), MIT. Audited source baseline: `fd5cf0df987791117e96ccc0bec603c64be8b136` (2026-11-10), confirmed from the retained research checkout. This is a scoped source/API review, not a whole-repository audit.

## Two independent pins

- **Git review:** the commit above; its package manifests say **0.7.13**. `/wo → Catch up packages` reviews changes after that commit only along the paths in `extensions/work-catch-up-baseline.json`.
- **Consumed npm runtime:** CLI/core/neutral theme **0.7.12**, React/React DOM 19.3.1, StyleX 0.19.1 and esbuild 0.28.2. The full reviewed dependency graph and integrity fields live in `extensions/astryx-runtime/runtime-lock.json`; its SHA-256 is `93973bb82266e3f12b669f500aeef2d0be05e66b7b0b73d4c99fc79ebaa6dbe5`.

Advancing a git review does **not** upgrade those npm pins, the host cache, a design's `APP.json`, or a retained version. Changing the runtime requires a separate explicit pin/integrity/notices review and the existing real-cache build/browser/round-trip checks. Consult installed-version API documentation, not a newer source article, for callable behavior.

## Adopted or monitored contracts

| Exact upstream paths | Use here | Local code and evidence |
| --- | --- | --- |
| `packages/cli/api/index.mjs`, `api-report.md`, `api/theme/palette/generate/`, `api/theme/generateTonalPalette.doc.mjs` (the latter paths under `packages/cli/`) | Published `generateTonalPalette`; candidate ramps only, not an accessibility certificate | `extensions/design-theme.ts`, `design-library.ts`; C1 and `docs/proposals/astryx-study/theme-results.md` |
| `packages/cli/api/search/`, `component/`, `template/`, `docs/`, `hook/`, `theme/list/` (all under the same `api/`) | Bounded selected-only, read-only installed catalog contracts; no auto-init or suggested-command execution | `extensions/design-lookup.ts`, `design-library.ts`, `design.ts`; C1/C7 and `lookup-results.md` |
| `packages/core/src/Button/`, `packages/core/src/theme/`, `packages/themes/neutral/`, `packages/core/package.json` | Prebuilt component/theme exports consumed by the optional app foundation; not copied raw StyleX source | `extensions/design-app.ts`, `design-runtime.ts`, `design-build.ts`; C1/C2/C3/C4/C8 and `app-results.md` |
| `packages/core/src/Dialog/`, `Popover/`, `Selector/` (under `packages/core/src/`) | Layered-surface and adaptive-presentation compatibility watch from the integration probes; not a claim that every component/state is verified | `hub/src/design-bridge.ts`, `hub/web/design-view.ts`, `extensions/design-render.ts`; modal/comment/replay fixtures and `interaction-contract-results.md` |
| `packages/cli/assets/docs/browser-support.doc.mjs`, `packages/core/CHANGELOG.md` | CSS anchor/Popover/light-dark browser-floor and behavior changes | Plan55b392b8 browser gates; genuine Safari/hardware evidence is still required |
| `LICENSE`, CLI/core package metadata, the neutral theme package | Notice, export and dependency compatibility changes | `extensions/astryx-runtime/notices.json`, full exported `THIRD_PARTY_NOTICES.md`, runtime integrity tests |

No upstream palette/discovery implementation was copied: the optional installed public API supplies its results; our token mapping, validation, build/publication and hub workflow are local code. Full dependency license texts ship with the reviewed runtime and editable exports. Source availability is not a trademark grant; separately introduced fonts/icons/assets need their own review. The foundation is optional and experimental; the Windows cache/build/handoff checks do not certify the entire component catalog, Safari or touch hardware. Remote transport and final quality evidence stay separately scoped in plan 55b392b8.

## Review procedure and exclusions

Review the scoped diff and map findings to the table before proposing an adoption. Add a changed component path only when we actually depend on its contract. Re-run that row's targeted checks; for runtime or browser-floor changes also repeat the genuine component/offline/state/remote checks and preserve honest unsupported-browser errors.

Do not watch or import the entire repository. The native/canary runtime, chart/lab packages, upstream MCP/server/CLI orchestration, project auto-configuration and unbounded template installation are not adopted. The hub remains the session/comment/version/handoff system, and ordinary HTML/deck designs do not need Astryx. Catch-up offers reviewed ideas, never automatic code or dependency replacement.
