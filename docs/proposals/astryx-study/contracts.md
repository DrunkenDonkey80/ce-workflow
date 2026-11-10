# P3-02 implementation contracts

These settle interfaces, not claims that the product implements them. Requirements and user decisions remain in Plan3 `55b392b8`.

## Evidence

- `theme-contract.mjs` passed against installed CLI **0.7.12**: public `generateTonalPalette` returns deterministic 21-stop accent/neutral ramps for both modes, hex-only values, rejects invalid seed/stops and preserves an exact anchor. No React in the output; no generator copied from main. Default generation does **not** necessarily preserve a seed at stop 50, so request an exact anchor when required. Public API docs and types in the installed package, not main's API report, govern the integration.
- `input-contract.mjs` passed: at the same **820×1180**, CDP reports mouse as touch=0/coarse=false and touch as touch=1/coarse=true; reduced motion confirmed in both. `agent-browser set device` followed by `set viewport` resets mobile/touch. Do not combine those commands and claim touch. Use isolated session-owned CDP emulation with explicit metrics/touch/media settings, check the observed values, then capture.
- `state-contract.mjs` passed for HTML and React: a page-owned capture/restore API reopens a dialog and restores **Unsaved Delta**, after a real page reload. Replay acknowledgement matches captured state; 16 KiB and unsafe-key checks reject test payloads. This proves bounded declared drafts are feasible without serializing React internals. Product bridge, stale-load and timeout regressions remain P3-06.
- `form-targets.mjs --candidate` passed all **15 groups**: required validation, local save/Enter, dialog-method close, parent/storage isolation; GET/POST to self, parent, top, blank and an existing named popup; submit/requestSubmit and per-button overrides; positive unrestricted control receives a POST. CSP blocks form actions; parent/top are rejected earlier by sandbox navigation checks. Require an observed rejection and unchanged URLs, not a timing-only zero-request assertion. Console wording is Chromium-specific. The advisory run failed model verification; its suggestions were independently checked by this persisted probe, not accepted as verified advisor evidence.

Commands use `STUDY_DEPS=<reviewed installed node_modules>`, optionally `CHROME_PATH=<installed Chromium executable>`, and `node docs/proposals/astryx-study/probes/<name>.mjs`. No probe downloads a package/browser. First-use cold-cache downloading and timings are intentionally deferred to P3-18's consented provisioning test, not silently counted as zero.

## Page state and rendering (HTML and React)

Use one opt-in authored API:

```ts
interface DesignPreview {
  capture(): JSONValue | Promise<JSONValue>;
  restore(value: JSONValue): void | Promise<void>;
  states?: Record<string, JSONValue>;
}
// The authored page assigns an implementation to window.designPreview.
```

`restore` acknowledges only after the DOM has committed; restoring an already-current value must also acknowledge. Named states use the same restore path. No closures, DOM serialization or inferred React state. A static page can explicitly capture/restore `null`. Legacy pages without this API remain viewable; Mark must explain missing state support instead of annotating a falsely labelled current-state image.

- Accept only finite JSON primitives, arrays and plain objects: no functions, undefined, bigint, cycles, custom prototypes or reserved prototype keys. Maximum serialized UTF-8 size **16 KiB**, nesting **8**, and **256 total object keys/array entries**. Validate before/after bridge transport and again at the server boundary. Do not log the payload; authors must omit credentials and unrelated/private app data.
- Mark requests capture from the current iframe with a fresh request ID plus its existing load ID. Bind response to `contentWindow`, request/load, screen and version. Any reload, viewer change or stale response cancels the pending capture. **3-second** capture timeout; error is shown before opening the annotator. Do not fall back to default state.
- Pass the captured JSON, actual input capability, slide/hash and live inline edits through `MarkState` → app → allowlisted `designshot` → `RenderState`. Restore in the isolated rendered page, require a successful round-trip capture equal to the requested state (canonical JSON comparison), then settle and capture. Unsupported restore, timeout, mismatch or malformed data is an error, not a PNG success. A named `look` state resolves only from the page's declared `states`.
- Bounded readiness: optional authored `window.designReady` promise, fonts, images, finite animations and stable layout/paint; **5-second total** budget. Ignore explicitly infinite decorative animations; do not wait forever for network idle. Failed resources and timeouts are reported. No screenshot presented as settled when the readiness check failed.
- Report requested and observed viewport/input capability, touch points, coarse pointer and reduced motion. Desktop-sized touch and phone-sized mouse are both valid distinct cases. The live device picker changes dimensions, not a desktop browser's hardware capabilities; Mark reproduces the live iframe's actual capability. Never call Chromium emulation a real-touch or Safari check.

## Runtime, source ownership and lifecycle

One optional Astryx foundation; no provider/plugin framework. HTML stays default. Store optional foundation metadata without invalidating existing version-2 sessions or v1 migration.

- Agent edits `src/` entries/styles/assets and design/handoff documents. The fixed extension-owned recipe emits normal root HTML screens and bundled local assets. The agent does not run a package manager, imported build script or arbitrary build config. Set compiler options explicitly, including JSX/tsconfig behavior. Imported local source is bundled, not executed on the host. Resolve only confined source/assets and the reviewed cache; refuse escaping paths/symlinks and unreviewed dependencies.
- Use content-addressed bundle assets, stage all output before publication, publish complete files atomically, and write the matching build receipt last. Keep old assets until no current output needs them. Suppress reloads while publishing; design-serving operations coordinate through the same per-design lock so a new viewer never reads half a publication. Generated root HTML is not an editable source copy.
- Minimal build receipt: schema/recipe version, foundation, exact dependency-lock SHA-256, source digest, and generated path→digest map. Keep source, recipe, package manifest/lock, notices and matching output in snapshots/exports, **not node_modules, shared cache or staging folders**. No timestamp in source/build digests.
- One `ensureBuilt` path runs on `look`, before `agent_end` snapshots, and on `select`/`clone`; restore uses the same serialization. Unchanged source and verified matching output skip rebuilding. Split existing snapshot's locking from its copy body only as needed to avoid nested-lock deadlocks; preserve existing retention/delta behavior. Do not introduce a second competing snapshot/build path.
- Failed draft: preserve authored source and last-good generated preview; expose the error and last-good status. Never label it a successful new component version or select it as a coherent handoff. Preserve the failed draft before restore; do not silently discard edits. Snapshot metadata must distinguish failed draft from matching built output. Historical views use retained local output without rebuilding or registry access.
- These are lifecycle guarantees inside the existing project-trust boundary, not a bash sandbox. Source-only write guards must not be described as preventing arbitrary shell execution. Errors previously swallowed by `agent_end` must become visible.

## Provisioning and discovery

Host-only first-use consent through existing ask_user. No Node/Git/npm on remote clients. Base package carries only reviewed integration code, provisioning manifest/lock and full notices; no mandatory Astryx root dependencies or installed dependency tree.

- Exact reviewed direct pins: core/CLI/theme-neutral **0.7.12**, React/ReactDOM **19.3.1**, StyleX runtime **0.19.1**, esbuild **0.28.2**. The pilot's caret-ranged package.json is **not** the provisioning manifest. Produce and review a complete transitive integrity lock in P3-18; no git/file/link dependencies or arbitrary registries.
- Cache under `PI_CODING_AGENT_DIR` (default `~/.pi/agent`), `astryx/<lock-sha256>/<platform>-<arch>/`. Serialize installation with the existing lock primitive. Install into staging with lifecycle scripts disabled, then verify package pins, lock/integrity, native builder and required notices before publishing a ready receipt. Interrupted/failed staging is not reusable. Enforce the tooling's Node minimum (22.13.0).
- No network/install on ordinary HTML/deck use. First cold use reports progress and actual elapsed/bytes/failure; cancellation leaves the existing cache intact. Warm use verifies its receipt/content before reuse without running a registry command. Cold offline use reports unavailable, never silently substitutes a different version. npm cache is not an integrity bypass.
- CLI APIs run in a bounded child at the reviewed cache, not as a CLI host embedded in the hub. Never evaluate a design/project config for lookup/theme generation. Bound request/result sizes and execution time; return installed versions and provenance. Search returns small summaries, then requested component/template/theme/usage detail. Do not inject a complete catalog into prompts or mutate project instructions during discovery.
- Standalone theme action uses the public pure palette API with explicit semantic light/dark mappings plus type/radius scales; output CSS/JSON and measured contrast pairs, not a React requirement or a blanket accessibility claim. Existing Tweaks Keep remains chat-based; DESIGN.md/HANDOFF.md record the chosen values. Preserve full MIT and transitive runtime notices; missing notices block publication rather than trigger a fabricated license fallback.

The source/output convention, publication atomicity, interrupted/corrupt cache behavior and all lifecycle triggers must get executable product regressions in P3-11/P3-12/P3-18. This document does not substitute for them or establish cold-install performance.
