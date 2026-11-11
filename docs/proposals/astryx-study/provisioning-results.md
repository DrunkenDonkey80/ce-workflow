# P3-18: pinned host runtime provisioning

Verified 2026-11-11 on Windows x64, Node 26.13.0. This is provisioning evidence, not a completed remote-studio or performance comparison.

## Delivered boundary

- `extensions/design-runtime.ts` provisions only the bundled manifest/lock, outside projects at `<Pi agent directory>/cache/design-runtimes/astryx/<lock-digest>/<platform>-<arch>/`.
- Direct pins: core, CLI and neutral theme **0.7.12**; React/React DOM **19.3.1**; StyleX **0.19.1**; esbuild **0.28.2**. The lock contains 178 non-root package records, including optional platform binaries. All resolved archives use registry.npmjs.org and SHA-512 integrity; no links or arbitrary package inputs.
- Installation uses the Node installation's npm CLI (11.20.0 here), a new staging project/private npm cache, empty user/global config, explicit registry, disabled lifecycle scripts/bin links/audit/funding, no fetch retries, and no inherited npm configuration or Node code-loading hooks. Project manifests/configs do not participate.
- The required native esbuild executable must report the pinned version before activation. Exact installed package versions, bundled manifest/lock/notices and a bounded full-file SHA-256 inventory are verified. Publication uses the existing inter-process lock and staged rename/rollback; failure/cancellation does not activate staging or replace an existing cache.
- The full license/copyright text is embedded in `extensions/astryx-runtime/notices.json` for every locked package and materialized as `THIRD_PARTY_NOTICES.md` in the cache. Published-package omissions are supplied from the same-project MIT notice or version-matching upstream license. StyleX uses tag 0.19.1, Flow uses v0.339.0, and imurmurhash's published source matches its upstream Git blob. Source checkout provenance is separately recorded as fd5cf0df987791117e96ccc0bec603c64be8b136, not mislabelled as the published package revision.

## One approved real cold install

Existing `ask_user` explicitly approved one cold-cache host download. The one-off module check passed that already-obtained approval to `ensureDesignRuntime`; this is not authority to auto-approve future cold installs. No paid benchmark/model generation was run.

| Measurement | Result |
|---|---:|
| Exact compressed package payloads | 29,126,578 bytes (27.8 MiB) |
| Installed file content, excluding receipt | 153,545,745 bytes (146.4 MiB) |
| Inventoried files | 18,826 |
| Cold install plus verification | 17,021 ms |
| Immediate warm offline integrity check | 8,574 ms |
| Warm package download bytes | 0 |

Payload bytes are counted from the unique SHA-512-addressed installed-package archives in npm's private cache, not HTTP/TLS overhead, filesystem allocation or an estimate. The private download cache is removed before publication. The cold timer excludes approval wait; it includes package installation, native verification and the initial inventory. File inventory digest: `3b50afd0c2bc97dcf11383ccd054d445444c7fb8e75981286900c7d47bca1957`. Lock digest: `93973bb82266e3f12b669f500aeef2d0be05e66b7b0b73d4c99fc79ebaa6dbe5`.

The real warm check supplied both a confirmation callback and an installer/native runner that throw if called. It returned `cold:false`, zero download bytes and the matching cache. Warm verification still hashes the whole tree and has substantial measured latency; it is not a speed win. Account for it in P3-14/P3-15 rather than claiming an end-to-end improvement.

## Checks on final provisioning code

- **C1:** `node scripts/test-work-design.mjs` — passed. Exercises fixed lock/notices, refusal before execution, cancellation before and during installation, offline miss, unusable native builder, staging cleanup, warm reuse without prompt/runner, same-version content corruption, refused/failed repair preserving the existing cache, successful atomic replacement, concurrent same-process requests with one approval/install, and symlinked cache refusal. Existing design checks also pass.
- **C7:** `node scripts/test-work-tool-loader.mjs` — passed.
- **C9:** active LSP probe of `extensions/design-runtime.ts` — zero errors, eight informational type/style hints; not an empty-cache assertion. The file-name lexical-sort warning was explicitly classified as a false positive. No claim of zero findings.
- An additional C6 run initially failed at the existing parallel headless size/title fixture; a subsequent run passed after an experimental shared-lock wait change was reverted. `extensions/plan3-files.ts` is unchanged. This does not establish or fix the intermittent race.
- **Package delivery:** `npm pack --dry-run --json --ignore-scripts`, checked by a parent-side assertion script, passed: 301 entries, 1,847,613 compressed bytes and 5,318,403 unpacked bytes on this shared checkout. Contains the manifest (396 bytes), runtime lock (85,761 bytes), full notices (288,553 bytes) and `design-runtime.ts`; contains no `node_modules/` tree or temporary notice-generation file. Package totals include other sessions' current checkout work and are not an isolated size benchmark.

The pack assertion accepts either npm's older array or npm 12's object keyed by package name before checking the file list. The PATH npm shim is 12.2.1 here, unlike the direct Node-installation CLI used for provisioning. Two parent parsers incorrectly assumed an array; one read-only oracle identified the shape change, and the corrected assertion passed on the original command. No package change was needed to solve that check failure.

## Limits / remaining integration

- P3-08 onward must wire the existing ask_user confirmation and progress UI into actual design actions; merely importing this helper does not add a tool or a new user workflow. Ordinary HTML/deck actions must never call it. Real remote first-use UI remains P3-14 evidence.
- The existing shared lock waits ten seconds across processes. Another session can receive an explicit busy/retry error during a longer cold install; same-process requests are queued. There is no claim that simultaneous cross-process cold starts were exercised.
- Only this Windows/native-binary path was exercised live. Other supported hosts, actual cold offline network failure, interruption by process termination, filesystem publication failure/rollback and real remote device/browser behavior are not established by the mocked boundary checks.
- npm integrity and the file receipt detect unexpected/corrupted bytes; they are not publisher signatures or a sandbox against a malicious trusted package or the OS user editing both files and receipt.
