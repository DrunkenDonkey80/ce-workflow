# Pinned component starter and publication checks

Verified on Windows, 2026-11-11. This is implementation evidence, not the paid end-to-end quality comparison.

## Delivered

- Explicit Astryx app starts produce editable JSX, screen shells, fixed recipe/dependency metadata, full notices, root HTML and local content-addressed bundles. HTML/deck starts remain independent.
- Builds use the reviewed host cache and a bounded stdin worker. Source imports cannot escape the design, load Node APIs/URLs, or install arbitrary packages/configuration.
- Look, snapshots, select, clone and restore share the build/publication boundary. Immutable preview generations preserve the last good view during failure. Failed edits are retained as explicitly failed drafts, not described as successfully built versions.
- Preview controls show building/failure/ready without resetting an unsaved last-good iframe. A successful new generation retargets the existing preview. Mark carries the displayed generation; stale generation captures fail visibly.

## Checks

Passed the existing design-tool, tool-loader, hub explore, hub API, hub sessions and full hub browser scripts. Added regressions exercise failure, cancellation, source changes during compilation, source/output mismatch repair, missing/corrupt generated caches, cleanup, concurrent snapshot/look/select/clone/restore, and unchanged snapshot retention.

The installed pinned runtime passed two identical-input builds compared with bounded SHA-256 maps, a source input exceeding 70 KB, hostile import rejection, and a real component render at 820×1180 with touch input:

- Download bytes: **0**.
- Generated output bytes: **1,460,291**.
- Action target height: **44 px**.
- Requested prototype state restored and rendering settled.
- No page errors or failed resources.

Explicit TypeScript semantic and syntactic requests returned `success:true` and empty diagnostic bodies for design-app, design-build, design-library, design-runtime, design, hub API/explore and web files/design-view. The initial silent push-only probes were inconclusive, not a clean result. Hub requests required opening/routing to their own project.

The new browser fixture initially failed because its textbox accessible name included a trailing space. The diagnostic tree proved that mismatch; fixing the fixture, without changing product behavior, made the unchanged interaction assertions pass. Its bounded failure-tree diagnostic remains.

## P3-12: editable handoff and offline round-trip

Store loading now validates session identity/counters, foundation kind and version/lock metadata without silently upgrading pins or rewriting invalid data. Legacy migration retains unrelated fields and fixes missing legacy counters from the highest existing handle; obsolete OpenDesign run fields still disappear. The retained-field regression was observed red before the fix.

Selected component exports contain editable entry points, screen shells, pins, full notices and machine-readable build pointers. BRIEF/HANDOFF describe the experimental foundation, readiness/state protocol, declared named states and an honest verification matrix rather than certifying untested states or hardware. Export-only handoff files are included in the exported source receipt without altering the studio snapshot.

The real-cache test copied a selected export to an isolated folder, removed its generated output, rebuilt offline, and matched every generated output hash. The restored component state's rendered PNG also matched. A broken recipe failed selection without replacing the previous handoff or silently repairing the authored metadata; restore recovered its retained version.

C1, C2, C3, C4 and C8 pass after these changes. Explicit TypeScript semantic/syntax requests for design, design-build and the design test return empty bodies with confirmed success.

The growing C1 check exceeded its former 240-second command budget. One read-only oracle measured the hostile rejects at 0.26–0.59s each and real builds around 35–42s; the timeout was not evidence of a stuck hostile import. The loose rejection regex could nevertheless accept a killed worker as success, so it now requires the exact plugin/error and rejects timeout/killed results, with small negative selfchecks. Large-source and deterministic-input coverage share two builds instead of adding a third duplicate build. The complete C1 command then passed in **264.9 seconds** under a 420-second outer budget. The earlier large-Buffer-diff explanation was a hypothesis, not an established cause. No product timeout was changed.

## Remaining

Scoped catch-up tracking is implemented. The [instrumented loopback Chromium interaction/transport check](remote-results.md) now passes, with its measured repeated payload cost and explicit isolation limits. Physically remote first-use/lifecycle verification, the paid quality comparison and final browser-floor/packaging gates remain in the plan. This evidence does not establish paid generation quality, real Safari compatibility, or physical touch-device behavior. No new runtime download or paid model run occurred for these checks.
