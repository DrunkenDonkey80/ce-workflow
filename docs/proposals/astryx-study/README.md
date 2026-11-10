# Astryx study: frozen pilot and product benchmark

Plan: `55b392b8`. This folder is evidence, not shipped runtime code. The package `files` allowlist excludes it (`npm pack --dry-run --json`, 2026-11-10: 295 included files, no study files).

## Historical pilot (not the product baseline)

`brief.md`, `refinement.md`, `rubric.md`, `manifest.json`, `metrics.json` and `comparison-report.md` preserve the one-pair worker-only experiment. `manifest.json` retains the original input hashes and exact published versions; `original-probe-sha256.txt` retains the original scripts' hashes before portability edits. Brief and refinement hashes still match the frozen manifest. Raw transcripts, dependency trees, audit tool arguments and redundant screenshots are intentionally omitted. Metrics retain deduplicated totals, compaction usage, stages and audit candidate counts, not raw audit arguments or private session paths. The old setup/native workflow is superseded by the product driver, not offered as a second production benchmark.

Selected matched desktop/phone/short-modal and modal-pin images are in `screenshots/`. The two generated applications' editable sources are in `fixtures/`: HTML output directly; Astryx JSX, authored CSS/HTML and original build recipe without its generated vendor bundles. The original build recipe's incomplete license fallback is a known pilot limitation, **not approved release packaging**. Build only in scratch with matching dependencies; never install into this archive. `astryx-assessment.md` and `comparison-report.md` are historical reports: their Temp paths, old authorization statements and upstream-main API descriptions are not current execution authority or proof of 0.7.12 APIs.

## Security and interaction probes

`probes/form-security.mjs` and `probes/acceptance.mjs` use the production bridge/CSP through repo-relative imports. Set `STUDY_ROOT` to a scratch fixture/output root, `STUDY_DEPS` to an already installed matching node_modules and optionally `CHROME_PATH` to a headless Chromium executable. No package is downloaded by these probes.

- `node docs/proposals/astryx-study/probes/form-security.mjs`: original sandbox blocks local submit; design-only candidate permits the prevented handler and blocks POST; positive unrestricted control actually receives POST. Storage is opaque throughout.
- `node docs/proposals/astryx-study/probes/acceptance.mjs`: expected red baseline, HTML 95/98 and Astryx 92/98, no harness exceptions. Both modal pins exist outside the modal's top layer.
- Add `--control-local-forms`: temporary `allow-forms` plus `form-action 'none'`, 100/100 each, no harness exceptions. Not a product fix.

These commands were rerun against HEAD `28a5d72a082f1810b2c3f04194ae0f2cc234782f` plus the recorded concurrent dirty working tree on 2026-11-10. Results live in `parent-checks/`, `parent-control-local-forms/`, `form-security.json`. `parent-control-forms/` is the original historical broader control. Reproduction at the old policy is expected to fail its Save assertions; never weaken them to get a green baseline. `probes/look.mjs` renders either scratch arm through the production renderer. `probes/metrics.mjs` re-aggregates the historical retained sessions when `STUDY_ROOT/runs.json` and `SUBAGENT_RUNS_DIR` explicitly locate the local run metadata; raw sessions are intentionally not archived.

## Product-wired C10

`probes/product-benchmark.mjs` calls production `runDesign(start)` against the real running hub. The resulting Pi gets the actual design role/guide/tool and snapshot lifecycle, not a worker imitation. It fixes Opus 5.5/high, ultrafull, fresh initial context, one retained refinement and a unique isolated project/output directory. Its identical translation paragraph maps only fixture locations and checking instructions onto production equivalents. Frozen content, IDs, behavior and refinement remain unchanged. Product arms are comparable to each other; the historical pilot remains a separate experiment.

```text
node docs/proposals/astryx-study/probes/product-benchmark.mjs --self-check
node docs/proposals/astryx-study/probes/product-benchmark.mjs --root "<scratch-root>" --label prechange-html --run
node docs/proposals/astryx-study/probes/product-benchmark.mjs --root "<same-root>" --label final-html --run
node docs/proposals/astryx-study/probes/product-benchmark.mjs --root "<same-root>" --label final-astryx --arm astryx --run
```

Omit `--run` to prepare only, without provider calls. Use a new label, never overwrite a run or automatically retry a failed provider/setup run. All paid invocations must share the same root and $40 `budget.json` (D15); a cross-process lock serializes budget ownership. The monitor stops its own session at the recorded limit; an in-flight call can overshoot. An unfinished prior run blocks more spending until its actual usage is reconciled. Credentials and signed hub URLs are never written to the archive.

Local `result.json` keeps HEAD/dirty paths, exact production guide/module copies, effective model counts, compaction, canonical session paths, tool names, stage and end-to-end time, deduplicated usage including compaction attempts, missing-usage flags and version metadata. Raw local sessions remain available for prompt/tool-context audit; do not commit transcripts. Final acceptance and browser behavior are evaluated separately in P3-14, not inferred from a generated HTML file or an agent's self-report.

Execution baseline C4: `node --no-warnings hub/scripts/test-browser.mjs` passed on the recorded working tree (136 seconds). All five preserved `.mjs` probes pass `node --check`; the product driver's accounting self-check passes. Active LSP probing found no diagnostics but could not confirm clean for any of the five scripts (push-only/silent-on-clean server); this is not a clean LSP result. This does not establish Safari or physical touch-device support. The completed pre-change product baseline is in `product-prechange-html.json`: 572.068 seconds, 2,762,429 provider tokens, estimated $2.6376342, 36 turns and 42 tool calls. Its self-check used file://, not the actual sandbox, and canonical logs do not retain the full effective system prompt; neither limitation is claimed as verified. P3-02's tested interface choices and candidate-policy results are in `contracts.md` and `contracts-results.json`.

## Integration caller audit (pre-change)

LSP references plus literal cross-checks confirmed: `SANDBOX_CSP` is used by the dedicated renderer's `serve()` and generic `sendExplored()`; the latter already identifies own designs with `access?.own` for `withBridge()`. Keep generic responses unchanged. `renderDesign()` has product callers in `design.look()` and `api.designshot`, plus renderer assertions in `scripts/test-work-design.mjs`. `designshot` allowlists `screen/version/width/height/hash/styleEdits`; `MarkState` and `designFrame()` in `hub/web/design-view.ts` feed it through `hub/web/app.ts`. The bridge is one injected script string, not a separately served module, and must still work in opaque-origin classic-script pages.

Lifecycle ownership remains centralized in `extensions/design.ts`: `start/openSession`, `Session/Store/fromV1/load`, `snapshot/restore/clone/select`, `designGuide/DESIGN_ROLE`, `look` and `agent_end`. `test-work-design.mjs`, `test-explore.mjs`, `test-api.mjs`, and the real `test-browser.mjs` cover these boundaries. Concurrent dirty `hub/web/app.ts`, chat/view and browser-test changes belong to another session and must be preserved when later applying narrow edits; Git, not private file hashes, is their baseline.
