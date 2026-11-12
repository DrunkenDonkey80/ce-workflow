---
plan3: true
status: active
created: 2026-11-12
updated: 2026-11-12T13:53:25.755Z
reviewed: 2026-11-12
---

# Visual design library: tabs, real previews, image search

## Original request

> (User, after trying `/wo design` live) "this is... incomplete - you are expected to pick a design and you see NO design whatsoever? not a single pic?! not even when you click when you should have had a rich visual display?! … the compact/expanded chat should get a per session option, because I click on design and it should be auto compacted there, I click on some other tab should be what I left it, i.e. expanded … I wanted to google search for some interfaces but dont even have a search button and enter does nothing, besides even textboxes are not aligned … are you sure this thing is complete?"

Follow-up answers (ask_user, this session):
1. OpenDesign previews: download automatically as you scroll.
2. Card types: "we shall have subtabs here for the types: ready whole designs (big, juicy images showing everything, can click and explore all), color themes, also big and showing, image search tab that you can google for ideas and add as you find something you like (which means the image referenced/its site should stay in temp cache even if new google searches are done), components that come from astryx but I think we really need a visual version of that, maybe we can on update of these components render them off-site and take images? if I look for a button I'm a visual thing, I won't read button1, button2, I will see the button I like then go exploring its features."
3. Search: "when in an image search tab enter should initiate search (when you have typed something)".
4. The chat setting that follows the tab is the chat **width** (wide or narrow pane), not the Full/Thinking/Compact view.

## Goal, requirements, and non-goals

Goal: the Design library is browsed by sight. Every card a user is meant to pick from shows a real picture of the source, and clicking explores the full source.

Requirements:
- R1 Sub-tabs inside the library: **Designs**, **Themes**, **Components**, **Image search**. They replace the source and type dropdowns. The chosen tab survives reload.
- R2 Designs: OpenDesign systems, studio drafts and selected exports, as big preview cards. Inspect opens the full source page, and Add reference works.
- R3 OpenDesign previews download on demand when a card scrolls into view, are cached on disk, and are never downloaded twice for the same commit.
- R4 Themes: big pictures for every Astryx theme, plus each OpenDesign system's color page (`preview/colors.html`), fetched lazily like R3.
- R5 Components: every Astryx component has a real rendered picture, made offline by a maintainer script on each Astryx pin update and bundled. Browsing never renders or provisions anything.
- R6 Image search: a search box where Enter (with text typed) or a Search button runs a Google image search in the user's browser through this session, with no model turn. Results show as pictures. Adding one keeps its image and source page in this conversation's saved picks, which survive later searches (the existing Found store: newest 60). Capture page stays available.
- R7 Elsewhere, the search box only filters the current tab, and Enter does nothing extra.
- R8 The chat pane width follows the left tab, per session: the Design library widens the left pane and narrows the chat; other tabs restore the width last used there.
- R9 The library's input rows line up (one consistent grid, equal heights and widths).

Non-goals: no model-curated search inside the tab (the `design found` tool action stays for chat requests); no new design sources; no hub-side headless browser for browsing; no change to how references are frozen and sent.

## Decisions

- D1 (user) OpenDesign previews download automatically as cards scroll into view. This replaces the earlier rule that browsing never downloads. The per-commit cache keeps it to one fetch per system.
- D2 (user) The library is split into type tabs (R1); metadata-only Astryx components are not shown as text cards. They get rendered pictures (R5).
- D3 (user) Enter searches the web only in the Image search tab, and only when text is typed.
- D4 (user) The chat setting tied to the tab is the pane width, per session (R8). The Full, Thinking and Compact chat view stays a global setting.
- D5 (agent, from findings) The tab's image search calls the session's `image_search` directly through a hub-to-session route, the same pattern as page capture (`call(id, "/api/designurl")` in hub/src/api.ts). No model tokens are spent.
- D6 (agent) The OpenDesign card preview is the system's own self-contained `components.html`, shown in a sandboxed, scaled, lazily loaded frame. The same file is the Inspect page, so the card and the explorer show the same thing.
- D7 (user, Q-01 via /plan3 resolve) The Themes tab also lists each OpenDesign system's color page (`preview/colors.html`), about 152 more cards, each a small lazy download on scroll. Rejected: Astryx themes only.
  - Fact checked after the answer: colors.html is about 2.7 KB and loads `../tokens.css` (airbnb, agentic, bmw at the indexed commit), so it must be cached at `preview/colors.html` beside the system's `tokens.css`, which `fetchSystem` already saves. No other external links were found.
- D8 (user, Q-02 via /plan3 resolve) The browser extension sends each result's own thumbnail as a separate image, alongside the unchanged contact sheet for the image_search tool. The user added: "but big enough to be workable". Rejected: cutting tiles from the contact sheet (number badges, at most 162 px) and downloading every original per search.
  - Implication (agent): Google's grid thumbnails are small, and their real size is not measured yet. Tiles show the thumbnail at its natural size, never upscaled past it; opening a result fetches that one original on demand (the existing save path, 8 MB cap, consent rules) and shows it full size, so a promising result is always workable without downloading all 30. The extension update needs the user to update and reload the browser extension once (/wo → Settings → Browser access).



## Open questions

### Blocking

None.

### Deferred

None.

## Relevant files and approach

Findings (this session, verified by reading code or fetching):
- Only 6 of 333 cards have a picture: 152 OpenDesign systems, 7 Astryx themes (6 bundled webp previews), 174 Astryx components (metadata only).
- Bug: `designCatalog` in extensions/design-catalog.ts marks an OpenDesign system cached only if `.pi/designs/systems/<name>/kit.html` or `components.html` exists, but `fetchSystem` in extensions/design.ts saves only DESIGN.md, tokens.css and SOURCE.json. So no OpenDesign card can ever show a sample, and its Add reference stays disabled.
- OpenDesign at the indexed commit has, per system: `components.html` (about 10–60 KB, no external script or stylesheet links found in airbnb's), `system/kit.html`, `preview/colors.html`, `preview/typography.html`, `preview/spacing.html`, design-tokens.json and manifest.json.
- The library UI is hub/web/design-library.ts. It has a flat source and type filter, a local search filter, a page-address row, and cards with Inspect, Add reference, and Capture page for web results. Samples open through `designexample`, and images come from `api/designimage`.
- Found web results: `publishFound` and `foundItems` in extensions/design-references.ts, served by `designImage` for `found:` IDs.
- The hub calls session tools through `call(id, "/api/designurl", …)` in hub/src/api.ts. The browser-side tools are extensions/browser-fetch.ts and the image search behind the `image_search` tool.
- Left pane modes are full, narrow and collapsed (`setLeft` in hub/web/app.ts), saved once globally as `plan3-left`. The library already remembers a return tab and width (`libraryReturn`).
- Astryx components: the pinned lookup cache (extensions/design-lookup.ts) exposes component usage, props and examples through @astryxdesign/cli's API; the runtime is provisioned with consent (extensions/design-runtime.ts).

## Phases

### Phase 1: Library tabs, alignment and chat width [code]

- [x] **V-01** Library has Designs/Themes/Components/Image search tabs (saved per page, arrow keys) instead of source/type dropdowns; search and page rows share one grid.
- [x] **V-02** Pane mode and chat width are saved per session and per left tab; the library opens wide with a 280px chat, other tabs restore theirs; desktop reload no longer lets the remembered phone view override the tab.

### Phase 2: OpenDesign previews [code]

- [x] **V-03** fetchSystem (exported) publishes an OpenDesign package as one unit per index commit (DESIGN.md, tokens.css, components.html, preview/colors.html, SOURCE.json) via temp folder + folder swap under the plan lock; same-commit hits never refetch, failed updates keep the old unit; hub trigger and card retry note come with V-04.
- [ ] **V-04** Show big lazy previews on Designs cards: a sandboxed, scaled frame of the cached page, fetched when the card scrolls into view.
  - Studio drafts and selected exports use their own page the same way. Frames are not interactive on the card; Inspect opens the explorer.
  - Card frames must not use `designexample`: `referencePage` (hub/src/explore.ts:123) allows one pending and eight live reference views per session and returns 429 beyond that. Use a lightweight read-only card route over the cached files (same sandbox and CSP as the viewer, no temp copy), keep a bounded number of frames live, and unload frames that scroll away, are filtered out, or belong to another tab. Inspect keeps `designexample` and calls `unview` as today.
  - Acceptance: browser test scrolls the Designs tab and sees frames load only for visible cards, with no network fetch for cards never shown; scrolls past more than eight cards and back, then opens Inspect without a 429.
- [ ] **V-12** Show OpenDesign color pages as big lazy Themes cards: fetch preview/colors.html with tokens.css via V-03's path, then frame it like V-04.
  - Cache at .pi/designs/systems/<name>/preview/colors.html so its ../tokens.css link resolves; same commit check, 1 MB cap and retry note as V-03.
  - Acceptance: browser test opens Themes, scrolls, and sees OpenDesign color frames load only for visible cards; Add reference attaches the colors page.

### Phase 3: Image search tab [code]

- [ ] **V-05** Add a hub-to-session image search route and the Image search tab: Enter or Search runs it, and results show as pictures.
  - The route runs the existing `image_search` code in the user's browser without a model turn. It reuses image_search's consent and CAPTCHA handling, and returns titles, sites, page URLs and locally served thumbnails.
  - Tiles (D8): the extension sends each result's thumbnail separately (only gstatic or inline data, no cookies, as the sheet does today); serve them from the session's temp folder, never hotlink third-party URLs into the hub page. Bump the extension version so the setup check asks for the update.
  - Opening a result downloads that one original on demand and shows it full size, cached in the session's temp folder for this search; adding it reuses that file.
  - Measure while building: the thumbnails' real sizes on a live search; record them in the step check.
  - Add structured internal results to `imageSearch` and `saveOriginals` (extensions/browser-search.ts:94 and :105 return formatted text today) while keeping the image_search tool's replies unchanged.
  - Add session handlers for search and save next to `/api/designurl` in extensions/plan3.ts (~857) and allow them in `HUB_CALLS` (~2007). The page names results by the session's own set ID and result number, never by file path; a session cannot reach another session's sets.
  - Acceptance: hub/scripts/test-api.mjs covers the hub route with a fake session; scripts/test-work-browser-fetch.mjs covers the real session handlers: denied consent, expired set, failed original and another session's set; the browser test types a query, presses Enter and sees result pictures, and an empty box sends nothing; opening a result shows its original larger than the tile (fixture original bigger than its thumbnail).
- [ ] **V-06** Let a result be added: save its original into the conversation's saved picks, then attach it as a reference. Picks survive new searches.
  - Uses `publishFound` (8 MB cap, PNG, newest 60). Capture page stays on saved picks.
  - Acceptance: browser test adds a result, runs a second search, and the saved pick and its source link are still listed and attachable.

### Phase 4: Component pictures [think]

- [ ] **V-07** Prototype rendering five Astryx components from their pinned examples into images; measure quality, file size and render time.
  - Use the consent-provisioned lookup cache and a local headless browser in a maintainer script, never during browsing.
  - With the numbers, ask the user about the bundle size budget and image size (add it as an open question then).
- [ ] **V-08** Decide the per-component example choice and the fallback for components whose examples do not render alone.

### Phase 5: Component and theme pictures in the library [code]

- [ ] **V-09** Render all 174 components and the theme without a bundled image; bundle them with the pin digest as revision; make the script part of the pin update.
  - The same script exports each component's usage and props as small bundled metadata keyed to the pin, because the lookup (`runAstryx` in extensions/design-library.ts:16-18) provisions the runtime first and browsing must not.
  - Acceptance: catalog entries for components report `preview: "image"`; a test fails when the bundled images or metadata do not match the pin.
- [ ] **V-10** Show Components and Themes as big picture cards, with Inspect showing the picture plus the bundled usage and props.
  - Acceptance: browser test opens the Components tab and sees an image on every card; Components Inspect shows usage and props with no runtime installed and provisioning forbidden.

### Phase 6: Docs and release notes [code]

- [ ] **V-11** Update the browser test end to end, take changelog shots of each tab, and update README and CHANGELOG.

## Global validation

Commands (run the ones for the touched code, per the Test Scope Rule):
- `node hub/scripts/test-browser.mjs`
- `node hub/scripts/test-api.mjs`
- `node scripts/test-work-design.mjs`
- `node scripts/test-work-browser-fetch.mjs`
- `node hub/scripts/test-changelog.mjs`
- `git diff --check`, plus a lens LSP check on changed files

Acceptance: in a fresh hub, every Designs card shows a picture once scrolled into view; every Themes and Components card shows a picture; Image search finds and keeps picks across searches; the chat width follows the tab per session; the input rows line up.

## Resume context

V-01 (957c2b0c) and V-02 (e426c8cf) committed; test-browser.mjs green. Next: V-03 on-demand OpenDesign preview fetch/cache in extensions/design.ts (fetchSystem ~:360) with tests in test-work-design.mjs. Unrelated dirty files from other sessions (app.ts notice hunks @57/@901/@1457, index.html, styles.css .notices lines, AGENTS/README/GLOSSARY, docs/upstream, video scripts) stay unstaged; never push.

## Amendments

Append material changes and their reasons; preserve the original request and settled decisions.
- 2026-11-12: Added V-12 after V-04: Q-01 answered: add OpenDesign color pages to the Themes tab (D7).
- 2026-11-12 review (plan3-advisor, each finding checked against the code):
  - Accepted: card frames through `designexample` would hit the 1 pending and 8 live reference-view limits (hub/src/explore.ts:123). V-04 now uses a lightweight card route, bounded live frames and unloading; V-12 inherits it.
  - Accepted: component usage and props need the provisioned runtime (extensions/design-library.ts:16-18). V-09 bundles them; V-10 tests Inspect with no runtime.
  - Accepted: search and save return only formatted text, and the session route needs handlers and a `HUB_CALLS` entry in extensions/plan3.ts. Spelled out in V-05; scripts/test-work-browser-fetch.mjs added to validation.
  - Accepted: the pane width is also stored globally as `plan3-chat-width` (hub/web/app.ts:360-363). V-02 now keys both mode and splitter size per session and tab.
  - Accepted: `fetchSystem` treats any saved commit as a cache hit and writes files one by one (extensions/design.ts:360-370). V-03 now publishes per commit as a unit, under the lock, with one download for concurrent sessions.
  - Own finding, added as Q-02: image_search sends one contact sheet, not per-result tiles (browser-fetch/extension/background.js:228-273), so V-05's tile source is a user choice.
- 2026-11-12: Q-02 answered (D8): per-result thumbnails from the extension, "big enough to be workable". V-05 now opens a result's original on demand at full size and records measured thumbnail sizes.
