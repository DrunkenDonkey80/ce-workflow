# Astryx versus HTML: Relay dashboard pilot

## Recommendation

**Keep our remotely accessible studio and HTML-first default. Borrow Astryx's useful tooling and testing ideas. Do not switch wholesale or make Astryx the default.** Keep a component-backed Astryx path as a gated, optional experiment for genuinely complex applications—not as a proven speed/cost optimization.

The best immediate result was finding problems in our own studio: form saves are blocked by its sandbox, comments disappear behind modal dialogs, and screenshot-only verification misses real interactions. Fixing these helps both approaches.

This is a one-pair research result, not statistical proof. No product code, dependency manifest, commit or push was changed by this investigation.

## Experiment

User chose one pair on a remote-friendly project dashboard. Both fresh native Pi workers used **anthropic/claude-opus-5-5, high effort**, identical brief/data/craft guides, identical verification tools, and identical refinement request. `ultrafull` was configured in both; Astryx actually crossed its 200k checkpoint and its compaction record confirms that mode. HTML did not compact.

Initial build: six projects, overview, search/status filters, edit modal, settings, four prototype states, stable IDs and phone/desktop layouts. Refinement: Paused status, owner search, Reset filters and reachable modal actions on short phones. All attempts and retained continuations counted. Frozen hashes and pinned package versions: [manifest.json](manifest.json). Detailed criteria: [rubric.md](rubric.md).

Dependencies were preinstalled and shared read-only; cold installation/download time is excluded. Astryx received version-specific documentation instructions and build requirements; HTML used native browser controls. Parent orchestration/evaluation overhead is separate and was not billed to either arm. This exercises generation + refinement + real renderer/bridge, not the complete live hub start/select/restore workflow.

## Measurements (initial plus refinement)

| Metric | HTML | Astryx |
|---|---:|---:|
| Initial run | 12m57s | 21m26s |
| Refinement | 3m44s | 4m47s |
| Sum of active run elapsed time | **16m41s** | **26m14s** |
| Launch-to-final elapsed, including the workflow barrier | 25m14s | 26m16s |
| Provider total tokens, including cache traffic and compaction | **5,208,115** | **12,852,944** |
| Output tokens, including compaction output | 85,351 | 107,998 |
| Recorded cost estimate | **$4.0550** | **$19.9657** |
| Assistant turns recorded | 58 | 103 |
| Tool calls | 93 | 130 |
| Sum of runtime assets, uncompressed | 52,523 B | 1,436,489 B |
| Sum of separately gzipped runtime assets | 14,038 B | 415,298 B |

Astryx took **57% more active time**, **2.47× total provider tokens**, about **4.92× estimated cost**, and **29.6× gzipped artifact bytes** in this pair. The workflow waited for both initial builds before refinement, so HTML's launch-to-final elapsed includes ~8m32s waiting for Astryx; it is not HTML computation time.

Cost is a rate-based estimate stored by the provider adapter, **not an invoice**. Cache writes materially affect this result. Initial estimates were $2.65 versus $5.51; refinement was $1.40 versus $14.45. Do not attribute all of that difference to library code: documentation exploration, cache behavior and a compaction boundary contributed. Keep it in the totals nevertheless. One zero-usage assistant record is included in Astryx's 103 recorded turns; do not equate this blindly with 103 billable model calls.

The native retained resume uses the same canonical session file per arm. Those files were each counted once, not by adding copied transcript prefixes. The existing repo `scripts/lab-metrics.mjs` supplied message totals; `metrics.mjs` additionally included Astryx's separately recorded compaction usage (36,374 tokens, $0.0040286 estimate). Full provenance, stages, token categories, source candidates and asset sizes: [metrics.json](metrics.json). No missing assistant usage/cost fields were found; some zero-usage housekeeping is present.

These numbers do **not** support describing this integration as a successful optimization. No product optimization was installed, so there is nothing to revert.

## Independent functional results

The agents reported their own file-URL selfchecks passing: HTML 112/112, Astryx 103/103. Their case lists differ, so those counts are not comparable quality scores.

The parent ran the same browser acceptance driver against both through **the real DESIGN_BRIDGE and SANDBOX_CSP**, with external requests blocked. It covered both screens at 360×800, 390×844, 820×1180, 1440×900 and 844×390, plus 360×360 modal actions. Detailed interactions ran at 390 touch and 1440 mouse.

### A shared studio bug: forms cannot save

Actual policy: HTML **95/98**, Astryx **92/98** assertions passed, with no harness exceptions. Both failed dashboard Save and settings Save. Astryx additionally lost submit-triggered validation; HTML's separate blur validation still ran. Four dependent saved-Paused checks (two per arm) were explicitly blocked, not passed.

The browser reported: `Blocked form submission ... frame is sandboxed and the 'allow-forms' permission is not set.` This prevents ordinary JavaScript form submit handlers too, even when they would call preventDefault(). Both children tested interactions with file:// pages, where this restriction does not apply.

Discriminating controls, without changing either application's bytes:
- Add `allow-forms` to only the scratch iframe and CSP: **100/100 assertions per arm**.
- Add `allow-forms` **and** CSP `form-action 'none'`: also **100/100 per arm**.
- Separate security probe: local prevented submit handler ran; an unhandled POST was blocked with a `form-action` violation; localStorage stayed inaccessible. An unrestricted positive control actually reached the loopback POST endpoint, proving the instrument could detect submission.

Evidence: [actual results](parent-checks/results.json), [allow-forms control](parent-control-forms/results.json), [local-only control](parent-control-local-forms/results.json), [security control](form-security.json).

Recommended production direction: preserve opaque origin, allow local form events while preventing native form navigation with `form-action 'none'`, scoped to the design preview/renderer. This is a tested candidate, **not a shipped fix or a complete security audit**. Add regression coverage for targets/popups and other file viewers before changing the real policy. Do not simply enable unrestricted form submission.

### Other findings

- Both arms loaded offline without page errors/missing local assets and without horizontal overflow across tested sizes. Phone controls met the measured 44px target checks; short-screen Save/Cancel were reachable.
- Both passed name/owner filtering, reset, Cancel/Escape discard and focus return, modal focus containment, prototype state switching/retry, settings switches, stable comment picks and live inline CSS edits. Saved edit/validation checks passed under the controlled local-form policy only.
- Both could be commented inside a native modal, but the numbered pin remained in a body layer **behind the modal**. Settled screenshots confirm the missing pin. This is our bridge issue, not specifically Astryx.
- Astryx's 820px touch tablet used 20–32px controls; the phone-specific CSS fix did not apply there. This is a remote-touch usability gap, not a violation of a brief that specifically requested 44px phone targets. Test input capability independently of width.
- Mark still creates a fresh document. This experiment does not make an open modal or unsaved draft reproducible through Mark. The limitation is visible in the current RenderState contract.
- Astryx authoring sources and build recipe live outside its public output. A production snapshot/export must retain these plus exact pins/lockfile; a working minified preview alone is not an editable handoff.
- Astryx's generated notice file records some license declarations rather than every full upstream copyright/permission notice. Audit/fix notices before distributing copied runtime assets.

## Visual comparison

Parent judgment, **not blinded or an independent panel**. Both independently chose DIN-like headings and a transit/relay-line motif. Tool-call audit found no sibling-source reads; the similarity is not evidence of copying.

| Criterion (1–5 rubric) | HTML | Astryx | Observation |
|---|---:|---:|---|
| Hierarchy/scanability | 3 | 4 | Astryx shows project rows within the 900px desktop view; HTML spends more height on its overview. |
| Consistency | 4 | 4 | Both have coherent typography, spacing, tokens and status shapes. |
| Phone adaptation | 3 | 3 | Both reflow cleanly, but the overview occupies almost the entire first phone screen before the working list. |
| Craft/distinctiveness | 3 | 3 | Both are competent and restrained; neither demonstrates a dramatic library-driven design advantage. |
| Secondary-state presentation | 3 | 4 | Astryx's modal is more compact; HTML repeats a long project name as a large title on short screens. Both retain reachable actions. |

Astryx is somewhat more polished/compact, not remotely enough evidence to justify the measured overhead as a default. Its value lies in choosing richer reusable behaviors when the task needs them.

Matched evidence: [HTML desktop](parent-checks/html-index.html-1440x900.png), [Astryx desktop](parent-checks/astryx-index.html-1440x900.png), [HTML phone](parent-checks/html-index.html-390x844.png), [Astryx phone](parent-checks/astryx-index.html-390x844.png), [HTML short modal](parent-checks/html-short-360x360.png), [Astryx short modal](parent-checks/astryx-short-360x360.png). Modal captures wait for opening transitions; early transitional captures are not treated as rendering defects.

## What to take, in order

1. **Shared studio correctness first:** local-form event support with navigation restrictions; top-layer-aware pins; interaction checks in the actual sandbox; explicit touch contexts; settled screenshot readiness.
2. **Theme tools without mandatory React:** coherent accent/neutral ramps, type scale, semantic radii, light/dark pairs, contrast checks. Reuse public compiler/tooling or a small verified pure helper; do not import the entire engine for a few CSS variables. Feed existing Tweaks and DESIGN.md/HANDOFF.md.
3. **Bounded, version-aware discovery:** use Astryx's installed-version component docs/search only for a selected system, through bounded structured output. Reuse our design tool rather than adding a new family of tools. No catalog dump into every prompt; no CLI host embedded in the hub process.
4. **Optional component-backed app prototypes, gated:** pin core/CLI/theme, bundle locally, preserve src + build recipe + notices + output atomically, exclude dependency caches from versions, and fail visibly on build errors. Keep the remote studio UI unchanged. Re-run the same full benchmark before calling a curated starter an optimization.
5. **Scoped upstream tracking:** a small Astryx ledger for adopted utilities/component docs/browser behavior, not an automatic import of everything upstream.

Defer: whole complex-component swizzling, unpublished/internal interaction harness packages, experimental native targets, static reverse-export as the live preview, and generalized gesture engines without a concrete use. Do not rewrite the hub in React. HTML decks and bespoke web pages retain the existing path.

Upstream evidence and caveats are in [the earlier source assessment](../astryx-assessment.md): pinned source fd5cf0df987791117e96ccc0bec603c64be8b136, MIT license, published components 0.7.12, docs/code contradictions, experimental export limitations and 607-request CDN sample. These are reasons for careful selection, not wholesale adoption.

## Limits and protocol deviations

One pair cannot establish repeatability. No physical phone/Safari, assistive-technology audit, complete WCAG review, upstream full suite, cold-network benchmark, full live hub lifecycle or source restore round trip was completed. Tablet target gaps and source/notices are not erased by a passing control test.

HTML briefly wrote two scratch artifacts outside its arm into system Temp and deleted them; both agents wrote their bound reports outside their arm. HTML listed the parent directory, but the audited calls did not show sibling source reads. No hidden OS sandbox was claimed. Initial source snapshots are output-only, so they are not proof of Astryx authoring-source restore. Other sessions changed product files during this research; those were not touched or validated here.

Implementation remains blocked by user-enabled research mode. The project plan records a proposal; it does not silently approve product edits.
