# Product generation comparison: HTML versus Astryx

P3-15, plan `55b392b8`. Three authorized production-wired runs completed within the shared $40 ledger. **No efficiency win and no demonstrated visual advantage for the component option.** Keep HTML default; do not promote Astryx beyond explicit experimental use on this evidence. The approved direction remains our existing studio plus useful standalone tooling and optional Astryx components. This one dashboard pair does not establish the value of every borrowed capability or require reopening that adoption decision.

## Method and accounting

A = pre-change product HTML; B = final product HTML; C = final product Astryx. Same frozen dashboard brief/refinement, Opus 5.5/high, ultrafull, one initial generation plus one retained refinement. Actual hub design start, role, tools, system selection and applicable build/snapshot lifecycle were used. This is not the older worker-only pilot.

Independent re-aggregation of canonical session entries matched every recorded usage/cost/turn/tool total; continuation prefixes were deduplicated and compaction usage included. Each arm retained one canonical session file; C compacted once. All attempts, including **1/2/10 tool error results** in A/B/C, remain included. Zero provider errors does not mean zero failed tool attempts. Stage metrics are cumulative and must not be summed; active durations may be summed.

The frozen brief/refinement hashes still match the manifest. Copies of design.ts, design-guide.md, design-guide.UPSTREAM.md and frontend-design.md match byte-for-byte between B and C. Complete effective system prompts and every imported module were not retained. This dirty-tree, one-sample-per-arm study cannot isolate a particular prompt/tool change as the cause of a regression.

Initial/refined outputs, guide copies, canonical sessions and budget remain locally under `C:/SOFT/git/ce-workflow/.pi/astryx-product-benchmark/`. Public records omit private session paths, signed URLs and transcripts. C's final generated-file hashes match its build receipt. No generated arm was repaired after scoring.

## Full-run efficiency

| Metric | A: pre-change HTML | B: final HTML | C: final Astryx |
|---|---:|---:|---:|
| End-to-end seconds | 572.068 | 690.417 | 2039.499 |
| Active seconds | 558.998 | 687.072 | 1980.614 |
| input | 76 | 74 | 27190 |
| output | 55494 | 68867 | 76142 |
| cacheRead | 2501426 | 2750727 | 8261543 |
| cacheWrite | 205433 | 242362 | 274788 |
| totalTokens | 2762429 | 3062030 | 8639663 |
| turns | 36 | 35 | 85 |
| toolCalls | 42 | 51 | 97 |
| compactions | 0 | 0 | 1 |
| Reported USD | 2.6376342 | 3.1395914 | 4.5248508 |
| Provider errors | 0 | 0 | 0 |
| Tool error results | 1 | 2 | 10 |
| Refined runtime bytes | 43901 | 52106 | 2133482 |
| Per-file gzip bytes | 13297 | 15035 | 584216 |

B versus A: end-to-end **+20.69%**, active **+22.91%**, total tokens **+10.85%**, cost **+19.03%**, turns **−2.78%**, tool calls **+21.43%**. Fewer turns is not an overall improvement.

C versus A: end-to-end **+256.51%**, tokens **+212.76%**, cost **+71.55%**, turns **+136.11%**, tool calls **+130.95%**. Versus final HTML, C took **2.95×** as long, used **2.82×** the tokens and cost **1.44×** as much.

The approved product ledger spent **$10.3020764 of $40**. Parent evaluation/advice time and cost are separate and not included in those model-run figures. No paid reruns or new budget root were used.

Runtime size sums both screens' local HTML/CSS/JS/assets, excluding authored source, notes and checks. C's refined runtime is **2.13 MB**, versus B's **52.1 kB**: **40.95× raw / 38.86× per-file gzip**. These are local asset totals, not measured wire transfers or renderDesign envelope sizes. A and B need no component build.

C10 did **not** separately instrument build duration, cold install time or download bytes; null means unmeasured, not zero. These runs reused the approved warm host cache. Separate C11 measurements recorded builds of 52.943/50.063 seconds, zero runtime downloads and approximately 1.47 MB preview responses for a different, smaller fixture. Do not substitute those timings/bytes for this dashboard. See [remote-results.md](remote-results.md) and [provisioning-results.md](provisioning-results.md).

## Independent functional and responsive checks

`node docs/proposals/astryx-study/probes/acceptance.mjs --production --product` checked the **refined** outputs against the current production bridge/design CSP. The final independent evaluation took 27.226 seconds, after all generation ended. An initial adapter run failed on selector/timing assumptions; only the probe adapter was corrected, not the applications or frozen brief. The final result is **298/300**, not all green.

| Check group | A | B | C |
|---|---|---|---|
| Dashboard/settings load; local assets; no page errors or external requests | Pass | Pass | Pass |
| Six rows; owner search; combined status/search; no-results and Reset | Pass | Pass | Pass |
| Edit/save; blank-name validation; Cancel/Escape discard and restore focus; Tab trap | Pass | Pass | Pass |
| Paused filter/edit; updated row name/status | Pass | Pass | Pass |
| Loading/Empty/Error/Populated and Retry | Pass | Pass | Pass |
| Settings validation, notification/appearance toggle, acknowledgement | Pass | Pass | Pass |
| Unique stable IDs; one h1/language; opaque storage; no page overflow | Pass | Pass | Pass |
| Bridge stable-ID comments, inline edits and modal picks | Pass | Pass | Pass |
| Short 360×360 touch-emulated dialog actions reachable | Pass | Pass | Pass |
| Representative phone targets at least 44×44 | Pass | **Fail** | Pass |
| Total individual assertions | 100/100 | **98/100** | 100/100 |

B's notification and appearance switches are 52×30 at both 360×800 and 390×844: two failed viewport checks, each identifying both controls. Do not repair this benchmark output and silently rescore it. Across all arms there were zero harness exceptions, page errors, external requests or failed resources.

Viewport coverage: 360×800, 390×844, 820×1180, 1440×900 and 844×390, plus short-dialog cases. These are Chromium mouse/coarse-pointer emulations, not physical touch. Initial outputs are retained and their bytes measured but were not independently rescored here. Focus visibility and state presentation also received screenshot inspection; this is not a full contrast, reduced-motion, assistive-technology or WCAG audit.

Exact individual assertions: [product-acceptance.json](product-acceptance.json). Accounting audit, runtime-file totals and instrumentation gaps: [product-comparison.json](product-comparison.json).

## Visual judgment

Parent judgment, not blinded or statistically independent: A/B/C labels were used, but their implementations were known. Frozen scale: 1 unusable, 2 multiple significant weaknesses, 3 competent ordinary prototype, 4 strong with minor gaps, 5 unusually polished/complete.

| Criterion | A | B | C | Screenshot evidence |
|---|---:|---:|---:|---|
| Hierarchy / scanability | 3 | 4 | 4 | B and C separate project data and next actions clearly; A gives secondary summaries more vertical space. |
| Consistency | 3 | 4 | 3 | B's restrained type/lines hold together; C mixes its app styling with component defaults, especially in dark settings. |
| Phone adaptation | 3 | 4 | 3 | B has the leanest header/content priority; C's two-row navigation consumes more phone height. |
| Craft / distinctiveness | 4 | 4 | 3 | A/B have a deliberate quiet identity; C is competent but its library-backed result is not more distinctive. |
| State quality | 3 | 3 | 3 | All supply required states. B misses switch target sizes; C's dark brand and Retry label look low contrast, and its short modal exposes less inline error text than A/B. |

No arm earns 5 and there is no observed visual gain that explains C's overhead. Computed contrast ratios were not measured here; the C legibility concerns are visible screenshot findings, not a WCAG verdict.

| Matched evidence | A | B | C |
|---|---|---|---|
| Desktop | [A](screenshots/product-prechange-html-desktop.png) | [B](screenshots/product-final-html-desktop.png) | [C](screenshots/product-final-astryx-desktop.png) |
| Phone | [A](screenshots/product-prechange-html-phone.png) | [B](screenshots/product-final-html-phone.png) | [C](screenshots/product-final-astryx-phone.png) |
| Short dialog | [A](screenshots/product-prechange-html-short-dialog.png) | [B](screenshots/product-final-html-short-dialog.png) | [C](screenshots/product-final-astryx-short-dialog.png) |

[C dark settings](screenshots/product-final-astryx-settings-dark.png) · [C error state](screenshots/product-final-astryx-390-true-error.png).

## Feature decisions and remote limits

| Capability | Recommendation | Evidence / benefit | Cost and remaining gate |
|---|---|---|---|
| Shared form, modal-pin, state/Mark and interaction fixes | Keep correctness fixes | Functional product checks plus C4/C11 exercise existing studio behavior. | Physical remote lifecycle and real Safari/touch still blocked (P3-14/P3-16). |
| Standalone theme/contrast and bounded installed-version lookup | Keep as explicit tools | Coherent tokens/API discovery without forcing React into HTML. | First-use tooling still needs approved host provisioning; token-pair checks are not whole-page contrast certification. |
| Astryx component foundation | Keep the approved experimental opt-in scope | Required interactions and source/build ownership work in recorded Chromium scenarios. | 2.95× final-HTML generation time, 40.95× raw assets, no observed craft win; physical remote/Safari gates remain. |
| HTML default | Keep | Lowest measured payload; existing remote studio controls remain. | Final HTML still regressed versus its own pre-change baseline; do not advertise an efficiency improvement. |
| Cache/prompt/build speed optimization or default promotion | Do not claim/adopt from this evidence | No isolated end-to-end optimization win was established. | No baseline reset, budget expansion, paid retry, new dependency or runtime-pin change. |

The host builds locally; remote clients need only their browser. C11 was an instrumented loopback Chromium simulation, **not a physically remote client, physical shared bandwidth, or Safari/touch verification**. Successful C10 generation and iframe checks do not close those release gates. Choosing to keep a component capability is not choosing it as a speed optimization. Present the measured tradeoff for a decision before changing release/default scope or expanding runs.
