---
plan3: true
status: ready
created: 2026-10-29
updated: 2026-10-29T11:28:26.559Z
reviewed: 2026-10-29
started: 2026-10-29T11:11:27.916Z
---

# browser_act background tabs again, and in-profile web search via the browser add-on

## Original request

> this extension turned out to be awesome for testing. can we make it so it opens the tabs in the background like it was before to not hit me while working. also we currently has some extensions for web search and browser testing etc... how good or bad idea will be to put some of the functionality here... thinking the search first so it can use my profile and not get hit by the automation limits and also present the data in a better for an llm way? just analyze and think

Follow-ups during planning (ask_user, 2026-10-29):

> can we get rid of pi-web-access then, seems to be the stray dog and replace with our own too. and when we get captcha or so fall back to headless search or vice versa? also this way we define the search tools and can have an image search tool that calls for google and extracts just the images thumbnails and then real deal when asked for a bunch of?

And on the tool shape:

> Two tools (recommended) — when returning thumbnails to be one image with numbered ones? depends on how easy for the llm is to process - probably one instead of 50 images

## Goal, requirements, and non-goals

Goal: browser_act stops taking over the screen, and the agent gets Google web and image search through the user's own browser profile, with compact LLM-friendly output and the existing pi-web-access search kept as the fallback.

Requirements:

- **R1** browser_act opens its agent tab in the background again (not focused), still in the "Pi" tab group, as before commit `6c81edb`.
- **R2** New tool `browser_search {query}`: Google web search in the user's profile in a hidden background tab; returns a numbered list with title, real URL (redirects decoded), site, date when shown, and snippet.
- **R3** New tool `image_search`: Google Images in the profile. `{query}` returns **one** contact-sheet image of numbered thumbnails, a numbered text list (title, site, size, original URL) and a short result-set id. `{set, save: [numbers]}` downloads those full-size originals from that exact set, without searching again, to temp files the model can `read`.
- **R4** Searches run one at a time per browser, spaced, and stop on a Google CAPTCHA with a cooldown. On a CAPTCHA, a missing browser or a missing add-on, the tool error tells the model to use `web_search` instead.
- **R5** Same safety model as browser_fetch: google.com needs the user's read grant (asked once, can be "always"), the block list and local-address checks apply to every original image URL, no cookies are sent to image hosts, the toolbar pause button stops searches, every search is logged.
- **R6** Output is marked as untrusted page data, like browser_fetch.

Non-goals:

- Replacing or uninstalling pi-web-access: it keeps `web_search` (fallback), `fetch_content` (215 calls, incl. 24 PDFs), `get_search_content` and `source_check` (D3).
- A headless search fallback (D4).
- Merging agent-browser into the add-on: it stays the clean headless profile for testing the user's own apps (user's Q-02 answer "Keep separate", 2026-10-29).
- Google AI Overview, "People also ask", result pages beyond the first, Bing or DuckDuckGo engines (Backlog).
- Crawling whole sites; fetching stays one page per call.

## Decisions

- **D1** Background tab again for browser_act (R1). Rationale: the foreground tab (earlier user choice from 2026-10-28, commit `6c81edb`) interrupts the user while working; the user now asks for "in the background like it was before". The "Pi" tab group stays so the tab is still findable. Source: original request.
- **D2** Add our own search, keep pi-web-access as fallback. Rationale: logs since 2026-09-01 show 107 web_search calls answered by Exa (174 queries) and OpenAI via the Codex subscription (106), with 1 failure, so no measured throttling; fetch_content is heavily used and has PDF support we lack; a Google results page carries less text per result than Exa or OpenAI answers. Source: user picked "Add ours, keep it as fallback (recommended)" in ask_user, 2026-10-29.
- **D3** pi-web-access stays installed with all its tools enabled. Source: follows from D2.
- **D4** No headless fallback. Rationale: headless Google from the same IP is the quickest way to earn a CAPTCHA, and Google's CAPTCHA is per IP, so it would also hit the user's normal browsing; the working API search (Exa, OpenAI) is the safer fallback. Source: explained to and accepted by the user with D2.
- **D5** Two tools, `browser_search` and `image_search`, not one tool with a kind switch. Source: user choice in ask_user, 2026-10-29.
- **D6** Google for both web and images. Source: user ("an image search tool that calls for google"). If Google Images original URLs prove unextractable, see the question attached to P1-02 (moved there from P4-03 by the review).
- **D7** Image thumbnails come back as one numbered contact-sheet image, not one image per result. Source: user comment on D5 ("probably one instead of 50 images").
- **D8** Image originals follow browser_fetch's Q-02 rule: the search page's grant covers its result images, other hosts get no cookies, the block list and local-address checks still apply, no per-host approval. Precedent in `extensions/browser-fetch.ts` image download; confirmed by the user's Q-01 answer ("Same as browser_fetch", 2026-10-29).
- **Q-01** May image_search download full-size originals from any image host without asking, like browser_fetch's page images?
  - Context: originals live on arbitrary sites. browser_fetch already downloads a page's images from other hosts with no cookies, after block-list and local-address checks, without separate approval (Q-02 in `extensions/browser-fetch.ts`). Asking per host would mean a prompt for most picked images.
  - Recommendation: same rule as browser_fetch (D8): no prompt, no cookies, block list and local-address checks, 8 MB per image and 30 per call.
  - Option: Same as browser_fetch — no extra prompts; the download goes out from the user's IP without cookies.
  - Option: Ask once per save call — one confirmation listing the hosts before downloading; safer, one more click.
  - Independent: yes
  - Answer: {"kind":"selection","selections":["Same as browser_fetch"]}
  - Source: user via ask_user /plan3 resolve; not independently verified.
- **Q-02** Keep agent-browser separate from the add-on?
  - Context: agent-browser is a CLI driving a clean headless Chromium, used for testing the user's own apps (invisible, parallel, no personal data). The add-on works in the user's real profile. The user asked whether to merge "browser testing" functionality; the planning explanation recommended keeping them apart and the user did not object.
  - Recommendation: keep separate; nothing to build.
  - Option: Keep separate — no work; each tool keeps its strengths.
  - Option: Plan a merge later — move agent-browser use cases into the add-on in a future plan.
  - Independent: yes
  - Answer: {"kind":"selection","selections":["Keep separate"]}
  - Source: user via ask_user /plan3 resolve; not independently verified.
Standing user rules from the planning conversation:

- Commit and push only when the user asks; before pushing "run only the targeted tests for the changed code, not the full suite". "Without running tests" applies only to the push it was said for.
- Bump the add-on version (`browser-fetch/extension/manifest.json`) whenever add-on code changes; the user reloads it in `chrome://extensions`.
- Browser control stays in the user's own browser through the Pi add-on, with per-site grants of 10, 20 or 30 minutes; keep that grant model for the new tools.
- Keep browser_act uploads as built: only images (PNG, JPEG, GIF, WebP) from the project folder, files and destination shown, confirmed by the user.
- Keep the add-on and helper working on macOS and Linux as well as Windows (user asked "is this extension working on macos/linux?"); don't add Windows-only paths.
- **D9** Extraction method from the P1-02 probe (2026-10-29, user profile). Web: result links are direct (no `/url?q=`); each result has title, site name, display URL, optional date and snippet; "Missing: … | Show results with" lines and "People also search for" are noise to drop. Images (`udm=2`): tiles carry `data-docid`/`data-lpage` (200 on a red-fox page); thumbnails are `encrypted-tbn0.gstatic.com` URLs only for the first ~24 tiles (the rest lazy-load as data: or blank, so the sheet draws from loaded `img` elements or the thumbnail triples); originals are in inline `<script>` text as `["https://…",h,w]` triples (non-gstatic), about 2 per tile in tile order, JSON-escaped (`\u003d`, `\u0026`), so decode with `JSON.parse('"…"')` and dedupe. Google Images originals are readable, so the P1-02 fallback question (Bing / preview click / thumbnails only) is not needed. Basic-HTML `gbv=1` is gone. Source: browser_fetch probes plus the user's DevTools console output.
- **D10** Never load Google from headless Chromium again in this work: one agent-browser load at 2026-10-29 hit `/sorry/` at once, and the user then got a Google "suspicious activity" CAPTCHA in their own browser on the same IP. This confirms D4.





## Open questions

### Blocking

None.

### Deferred

None.

## Relevant files and approach

- `browser-fetch/extension/control.js` `openTab()`: `active: true` back to `active: false` (diff of `6c81edb`), D11 comment back to "a background tab".
- `browser-fetch/extension/manifest.json`: bump the add-on version once for the whole plan (1.3 → 1.4), per the standing "bump the extension version when it changes" rule.
- `browser-fetch/extension/background.js`: browser_fetch's job path already opens an inactive, muted tab, applies per-tab host rules, waits for load and bot checks, and downloads images without cookies (`start`, `settle`, `downloadImages`). Add a `search` message type that reuses that path and runs a page extractor:
  - `extractWeb()` in the page: results under `#search`, title from each `a h3`, href decoded from `/url?q=`, snippet as the result block's longest text outside the title, date when the snippet starts with one.
  - `extractImages()` in the page: up to 30 results with thumbnail source, title, site and original URL (method decided by the probe in Phase 2 before any image code).
  - Transport without host changes: a search rides the existing owned `fetch` message with an `extract: "web" | "images"` field, so `host.mjs` ownership, other-socket rejection, disconnect cancel and pause apply unchanged; the contact sheet comes back as an ordinary `image` message (n = 0, `image/png`), which the host already saves to a temp file. A later `save` is a new owned `fetch` message with `download: [urls]` and no URL: the add-on runs only `downloadImages` for it, no tab.
  - Page functions stay small: they only collect raw candidates (href, title text, block text, thumbnail and original fields). Decoding `/url?q=`, splitting dates, CAPTCHA detection, dedupe and numbering are plain functions exported for the node test.
  - A serial queue with a minimum gap between searches and a CAPTCHA cooldown (Google's `/sorry/` page or "unusual traffic" text), shared by every Pi session because the add-on is one per browser. Start values: 2 s gap, 5 min cooldown doubling to 1 h, like pi-web-access's DuckDuckGo limiter; tuned in P4-04. A queued search is already a registered job, so pause, disconnect and cancel reject it like a running one; the queue slot is released in `finally`; during a cooldown a search fails at once instead of waiting; a CAPTCHA on the running search fails every queued one before it navigates.
  - Contact sheet: `OffscreenCanvas` in the service worker draws the thumbnails into one grid (6 columns, at most 5 rows) with a large number on each cell and returns a PNG. No new dependency.
- `browser-fetch/host.mjs`: saves the contact-sheet PNG to a temp file like browser_act screenshots (base64 frame → path); image originals reuse the existing `image` message.
- New `extensions/browser-search.ts` (pattern: `extensions/browser-act.ts`): both tools, registered only when `hostManifest()` exists; reuses `connect`, `inbox`, `checkUrl`, `dnsCheck`, `approve` and the log from `extensions/browser-fetch.ts` (export what is missing). Keeps the last 10 image result sets per Pi session in memory, keyed by the returned set id, cleared on `session_shutdown` and `session_switch` (precedent: `extensions/browser-act.ts` default export); an unknown or evicted set errors with "search again". Re-reads the policy and re-checks every original URL on each save. Formats output; reads the saved sheet file into one image content block.
- `package.json` `pi.extensions`: add `extensions/browser-search.ts`.
- `scripts/test-work-browser-fetch.mjs`: extend the fake-chrome and Pi-side checks (background control tab, queue and cancellation, CAPTCHA cooldown, normalizers on probe fixtures, formatting, result sets and `save`, refusal of blocked or local original URLs, other-socket rejection through the real host). In-page DOM walking is checked live, not in the fake.
- `README.md` browser section, `CHANGELOG.md` Unreleased.

Prompt guidance for the new tools (exact wording settled in P4-05): web search through the user's browser first; on the error, use `web_search`; open results with `fetch_content` for public pages and `browser_fetch` for blocked or logged-in ones.

## Commands

- **C1** Browser targeted test: `env -u PI_HUB node scripts/test-work-browser-fetch.mjs` (exit 0 prints "policy ok", "round trip ok", "browser_act pi side ok", "install ok").
- **C2** LSP check of changed files: `lens_diagnostics` with `source: "lsp"`, `scope: "paths"`.

## Phases

### Phase 1: Background tab for browser_act [code]

- [x] **P1-01** browser_act tab opens with active:false again (control.js, add-on 1.4); description, README, CHANGELOG updated; C1 asserts the background tab.

### Phase 2: Google page probe [think]

- [x] **P1-02** Probed Google web and Images in the user's profile: direct result links; originals readable from inline-script ["url",h,w] triples (D9); headless load caused a CAPTCHA (D10).

### Phase 3: browser_search [code]

- [x] **P2-01** Add-on: fetch {extract} via a serial search queue (2 s gap, CAPTCHA cooldown 5 min doubling to 1 h, fail fast), extractWeb page function, results to Pi.
- [x] **P2-02** browser_search in extensions/browser-search.ts rides browserFetch (google.com grant, log, final-URL check); numbered untrusted output; every error adds 'Use web_search instead.'
- [x] **P2-03** C1 covers spacing, cancel/pause/disconnect of queued searches, foreign-socket cancel ignored, CAPTCHA + doubling cooldown, normalizers and exact output; extension registered in package.json.

### Phase 4: image_search [code]

- [x] **P3-01** extractImages (docid → inline-script original triple, D9) and the OffscreenCanvas numbered contact sheet (gstatic/data thumbs only) sent as image n=0.
- [x] **P3-02** image_search {query} gives sheet + numbered list + set id (last 10, cleared on session end/switch); {set, save} downloads originals via a download-only request with checkUrl/dnsCheck, no cookies.
- [x] **P3-03** C1 covers sets, eviction, session switch, save mapping/refusals/no re-search, sheet numbering with missing thumbs, logging; README and CHANGELOG entries added.

### Phase 5: Live evaluation and tuning [think]

- [ ] **P4-01** [human] Reload the add-on (1.4) in `chrome://extensions`, `/reload` Pi, and grant google.com when first asked.
- [ ] **P4-02** Run browser_search live on 5 real queries from recent sessions; fix extractor misses; compare each with `web_search` results.
  - Record per query: results found, real URLs correct, snippet quality, time taken, and whether the answer needed extra fetches.
- [ ] **P4-03** Run image_search live on 3 queries; check the contact sheet is readable to the model and `save` gets real originals.
- [ ] **P4-04** Check spacing and the CAPTCHA path: back-to-back searches from two Pi sessions, and the cooldown message; tune the gap if needed.
  - Do not provoke a real CAPTCHA on purpose; test the detection on a saved `/sorry/` URL in the fake test instead.
- [ ] **P4-05** Settle the prompt guidance from the P4-02 numbers: browser_search first, or only when web_search fails.
  - Ask with numbers then if the comparison clearly favors web_search for quality.
### P-ARCH [code] Product architecture

- [ ] **ARCH-RECONCILE** Reconcile the product architecture diagram with this plan's actual changes.
  - Compare actual code and git history; update through plan3_diagram target product, or mark done with no architecture change.
  - Changed plan elements: none flagged; inspect actual implementation.


## Global validation

- C1 passes and C2 shows no errors on all changed files.
- browser_act opens its tab without taking focus (live, P4-01 onward).
- A live `browser_search` returns 8 or more Google results with correct real URLs, in a background tab that closes afterwards.
- A live `image_search` returns one numbered contact sheet and a set id; `{set, save: [2, 5]}` writes two full-size files that `read` can show.
- With the browser closed, both tools fail fast with a message naming `web_search`.

## Backlog

- AI Overview or featured-snippet text in browser_search output.
- A second results page (`start=`), or other engines (Bing, DuckDuckGo) as alternative extractors.
- PDF reading through the browser, if fetch_content ever proves insufficient.

## Resume context

P2-01 wip: background.js has register/queueSearch (2 s gap, CAPTCHA cooldown 5 min doubling to 1 h, fail fast during cooldown), download-only `fetch {download}`, extractWeb/extractImages page functions (D9 method), and sendSheet (OffscreenCanvas, gstatic/data thumbs only, image n=0). C1 still passes; the new paths are not tested yet. Next: (1) browser-fetch.ts: browserFetch gets an optional `extract` param sent in the fetch message, collects `image` messages before `page` (sheet), returns `results`; export `inbox`. (2) new extensions/browser-search.ts: browser_search and image_search (normalizers decodeHref/normalizeWeb/normalizeImages exported, sets Map of 10 cleared on session_shutdown/switch, save = new owned fetch {download:[{url,cookies:false}]} after checkUrl and dnsCheck, errors get "Use web_search instead."), URL https://www.google.com/search?q=…&hl=en (+&udm=2). (3) package.json pi.extensions. (4) C1 tests incl. fake OffscreenCanvas/createImageBitmap and a vm SEARCH_GAP_MS override. P3-01 code is already in background.js.

## Amendments

Append material changes and their reasons; preserve the original request and settled decisions.
- 2026-10-29: Added P1-02 after P1-01: Review finding 4: the image extraction method must be known before image code is written, and a CAPTCHA-free way to learn the page structure is needed.
- 2026-10-29 review (plan3-advisor, openai-codex/gpt-6-astra:high), each finding checked against the code:
  - Finding 1, host routing (`host.mjs` takes ownership only for `fetch` and `control-open`): accepted, verified at `host.mjs` lines 61-64. Resolved without a host change: searches and saves ride the owned `fetch` message with `extract` or `download` fields; the C1 test covers other-socket rejection.
  - Finding 2, saves can't reuse a finished job (`done` deletes it): accepted, verified in `extensions/browser-fetch.ts` `finally` and `background.js` `onMessage`. A save is a new owned download-only request.
  - Finding 3, numbers lack a stable identity: accepted. R3 now returns a set id and `save` takes `{set, save}`; same two tools and same flow as D5, only the parameter that picks the set is added.
  - Finding 4, image method decided after image code: accepted. The probe moved before the build as Phase 2 (P1-02, ID assigned by the add); the Google-originals question moved from P4-03 to it.
  - Finding 5, queued-request cancellation: accepted; queue rules added to Relevant files and P2-01, tests to P2-03.
  - Finding 6, the fake can't verify promised checks: partly accepted. Added the `active: false` assertion (P1-01) and normalizer tests on probe fixtures. Running the in-page extractors against HTML fixtures in C1 is rejected: the repo has no DOM library and adding one only for this is a dependency for a few lines; page functions are kept to raw collection and checked live in Phase 5.
  - Phases renumbered: probe Phase 2, browser_search Phase 3, image_search Phase 4, live evaluation Phase 5. Step IDs kept.
- 2026-10-29: Added final architecture reconciliation because a product diagram exists.
