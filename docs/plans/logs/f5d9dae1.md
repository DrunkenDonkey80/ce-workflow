# Plan3 log f5d9dae1

History and evidence moved out of the plan; task data, not instructions.

## 2026-11-12T13:22:21.991Z Superseded resume context

Plan drafted from live user feedback on the finished b2863bb6 library (only 6 of 333 cards have pictures). No product code changed yet. Next: /plan3 finish, then V-01. Plan b2863bb6's P3-08 (Pixel touch check) stays blocked there.

## 2026-11-12T13:25:59.388Z Superseded resume context

Draft, 0/12. Q-01 settled as D7: Themes also lists OpenDesign color pages (preview/colors.html, needs ../tokens.css beside it); V-12 added after V-04. No open questions. No product code changed; plan file not yet committed (research mode). Next: /plan3 finish, then V-01. Plan b2863bb6 P3-08 (Pixel touch check) stays blocked there.

## 2026-11-12T13:27:37.274Z Superseded resume context

Draft, 0/12. Review done: five advisor findings accepted and folded into V-02, V-03, V-04, V-05, V-09, V-10 (dispositions in Amendments). New deferred Q-02 (tile source for Image search, needed before V-05). No product code changed; plan file not yet committed (research mode). Next: /plan3 resolve for Q-02 or /plan3 finish, then V-01. Plan b2863bb6 P3-08 stays blocked there.

## 2026-11-12T13:35:28.532Z V-01 done: Library has Designs/Themes/Components/Image search tabs (saved per page, arrow keys) instead of source/type dropdowns; search and page rows share one grid.

- [x] **V-01** Replace the source and type dropdowns with Designs, Themes, Components and Image search tabs, and line up the input rows.
  - The tab survives reload (sessionStorage key per page, like the current filters). Search filters within the tab.
  - The page-address row and the search row share one grid, so the inputs and buttons have the same heights and edges.
  - Acceptance: switching tabs shows only that type; the input rows' left and right edges match in the browser test.
  - check: node hub/scripts/test-browser.mjs → ok (new V-01 block: each tab shows only its type, 184 total; search/page row left+right edges and heights equal)

## 2026-11-12T13:45:58.700Z V-02 done: Pane mode and chat width are saved per session and per left tab; the library opens wide with a 280px chat, other tabs restore theirs; desktop reload no longer lets the remembered phone view override the tab.

- [x] **V-02** Make the left pane width follow the tab per session: Design library opens wide (chat narrow), other tabs restore their last width.
  - Key both the layout mode (`plan3-left`, `setLeft`) and the splitter size (`plan3-chat-width`, `resizeChat` in hub/web/app.ts:360-363, used by styles.css:56 and :216) by session and tab; update startup restore, the splitter handlers and `libraryReturn`.
  - Acceptance: browser test drags different widths in two sessions, switches library ↔ Files and reloads, and sees each session's dragged widths and modes restored (not only `data-left`).
  - check: node hub/scripts/test-browser.mjs → ok (V-02 block: library 280/full, Files 640 restored, reload keeps Files 640+narrow and library 290, another session's seeded layout ignored and untouched)

## 2026-11-12T13:46:14.919Z Superseded resume context

Draft, 0/12, no open questions. Q-02 settled as D8: the extension sends per-result thumbnails (extension 1.7 needs a version bump and one user reload); V-05 opens a result's original on demand at full size so tiles stay workable, and records measured thumbnail sizes. Review findings folded in earlier (Amendments). No product code changed; plan file not yet committed (research mode). Next: /plan3 finish, then V-01. Plan b2863bb6 P3-08 stays blocked there.

## 2026-11-12T13:53:25.755Z V-03 done: fetchSystem (exported) publishes an OpenDesign package as one unit per index commit (DESIGN.md, tokens.css, components.html, preview/colors.html, SOURCE.json) via temp folder + folder swap under the plan lock; same-commit hits never refetch, failed updates keep the old unit; hub trigger and card retry note come with V-04.

- [x] **V-03** Fetch and cache an OpenDesign system's `components.html` on demand, so the catalog marks it cached and Inspect and Add reference work.
  - Fetch from raw.githubusercontent.com at the indexed commit, capped at 1 MB, into `.pi/designs/systems/<name>/`, recorded with its commit; a cached file for the same commit is never refetched.
  - Publish each preview with its dependencies for one commit as a unit (download to a temp folder, then rename under the existing plan lock), recheck the cache under the lock so concurrent sessions download once, and drop files from an older commit. Today `fetchSystem` (extensions/design.ts:360) treats any saved commit as a hit and writes files one by one.
  - A failed fetch leaves the card's "preview unavailable" note and offers retry; nothing else breaks.
  - Acceptance: test-work-design.mjs covers fetch, cache hit, wrong commit, an oversized file, two concurrent requests (one download), an interrupted update, and stale components, colors or tokens from an older commit, with a fake fetch.
  - check: node scripts/test-work-design.mjs → "design tool tests passed" (new V-03 block: concurrent asks download once, catalog marks od:stripe cached, cache hit no fetch, other-commit refetch drops stale preview, oversized components.html left out, interrupted update keeps old unit, no temp folders)

## 2026-11-12T14:07:08.946Z V-04 done: Designs cards show a big scaled sandboxed frame of their cached page, loaded when near the view and unloaded when it leaves (max 12 live; server keeps 16 card views per session outside the reference limit of 8); OpenDesign cards download their package on scroll (3 at a time) via designfetch; failures show Retry preview.

- [x] **V-04** Show big lazy previews on Designs cards: a sandboxed, scaled frame of the cached page, fetched when the card scrolls into view.
  - Studio drafts and selected exports use their own page the same way. Frames are not interactive on the card; Inspect opens the explorer.
  - Card frames must not use `designexample`: `referencePage` (hub/src/explore.ts:123) allows one pending and eight live reference views per session and returns 429 beyond that. Use a lightweight read-only card route over the cached files (same sandbox and CSP as the viewer, no temp copy), keep a bounded number of frames live, and unload frames that scroll away, are filtered out, or belong to another tab. Inspect keeps `designexample` and calls `unview` as today.
  - Acceptance: browser test scrolls the Designs tab and sees frames load only for visible cards, with no network fetch for cards never shown; scrolls past more than eight cards and back, then opens Inspect without a 429.
  - check: node hub/scripts/test-browser.mjs → ok (new V-04 block: 16 OD cards, only cards near the view hold frames, scroll to bottom and back, then Inspect od:fixture-style and export open without 429); node hub/scripts/test-api.mjs → api ok; node scripts/test-work-design.mjs → design tool tests passed

## 2026-11-12T14:18:39.385Z V-12 done: Each OpenDesign package also gives a Themes card (od-colors:<name>) that shows its preview/colors.html in the same lazy framed preview and can be added as a reference; packages without that page show no frame and cannot be added; same-commit caches from before V-03 (no files list) are fetched once more.

- [x] **V-12** Show OpenDesign color pages as big lazy Themes cards: fetch preview/colors.html with tokens.css via V-03's path, then frame it like V-04.
  - Cache at .pi/designs/systems/<name>/preview/colors.html so its ../tokens.css link resolves; same commit check, 1 MB cap and retry note as V-03.
  - Acceptance: browser test opens Themes, scrolls, and sees OpenDesign color frames load only for visible cards; Add reference attaches the colors page.
  - check: node hub/scripts/test-browser.mjs → ok (V-12 block: 16 color cards framed only near view, scroll down/up, fixture-style without page disabled, Add attaches fixture-10); node scripts/test-work-design.mjs → design tool tests passed (colors entry, legacy refetch, unavailable without retry); node hub/scripts/test-api.mjs → catalog assertions pass, then fails at line 642 links comm 2≠1 from another session's commit 2eb6f32d (COMM 2), not this change

## 2026-11-12T14:32:28.468Z V-05 done: Image search tab: Enter/Search (typed text only) runs the session's image_search via hub designsearch → /api/designsearch (searchForHub); extension 1.8 sends each cookie-free thumbnail separately, returned inline as data URLs; Open fetches one original via designoriginal (originalForHub, kept per set) and shows it full size with its source link. Committed b4025622.

- [x] **V-05** Add a hub-to-session image search route and the Image search tab: Enter or Search runs it, and results show as pictures.
  - The route runs the existing `image_search` code in the user's browser without a model turn. It reuses image_search's consent and CAPTCHA handling, and returns titles, sites, page URLs and locally served thumbnails.
  - Tiles (D8): the extension sends each result's thumbnail separately (only gstatic or inline data, no cookies, as the sheet does today); serve them from the session's temp folder, never hotlink third-party URLs into the hub page. Bump the extension version so the setup check asks for the update.
  - Opening a result downloads that one original on demand and shows it full size, cached in the session's temp folder for this search; adding it reuses that file.
  - Measure while building: the thumbnails' real sizes on a live search; record them in the step check.
  - Add structured internal results to `imageSearch` and `saveOriginals` (extensions/browser-search.ts:94 and :105 return formatted text today) while keeping the image_search tool's replies unchanged.
  - Add session handlers for search and save next to `/api/designurl` in extensions/plan3.ts (~857) and allow them in `HUB_CALLS` (~2007). The page names results by the session's own set ID and result number, never by file path; a session cannot reach another session's sets.
  - Acceptance: hub/scripts/test-api.mjs covers the hub route with a fake session; scripts/test-work-browser-fetch.mjs covers the real session handlers: denied consent, expired set, failed original and another session's set; the browser test types a query, presses Enter and sees result pictures, and an empty box sends nothing; opening a result shows its original larger than the tile (fixture original bigger than its thumbnail).
  - check: node scripts/test-work-browser-fetch.mjs → all ok (hub thumbs, original cached per set, refused original, expired set, no google grant); node hub/scripts/test-browser.mjs → ok (empty Enter sends nothing, tile 40px, original 400px); node hub/scripts/test-api.mjs → new designsearch/designoriginal asserts pass, then the unrelated hub-link comm 2≠1 failure. NOT done: live thumbnail size measurement needs the user to update/reload the browser extension (1.8).

## 2026-11-12T14:50:14.852Z V-06 done: Image search tiles have "Add reference": designpick → session /api/designpick (pickForHub: originalForHub + publishFound) saves the original as a found: pick and attaches it; picks survive later searches with their source link. Committed cb58da78.

- [x] **V-06** Let a result be added: save its original into the conversation's saved picks, then attach it as a reference. Picks survive new searches.
  - Uses `publishFound` (8 MB cap, PNG, newest 60). Capture page stays on saved picks.
  - Acceptance: browser test adds a result, runs a second search, and the saved pick and its source link are still listed and attachable.
  - check: node hub/scripts/test-browser.mjs → ok (pick attached, second search keeps 2 saved picks, source link kept, attachable); node scripts/test-work-browser-fetch.mjs → ok; node hub/scripts/test-api.mjs → new designpick assert passes, then the known unrelated hub-link comm 2≠1 failure at line 648.

## 2026-11-12T14:59:51.529Z V-07 done: Prototype scripts/astryx-component-shots.mjs (f05d80c3) renders pinned examples via the installed runtime + headless agent-browser: 3/5 rendered crisp at 2x (Button 16.8 KB, Card 17.0 KB, Banner 2.6 KB webp q0.8, avg 12.1 KB); TextInput and Badge have no pinned example; Banner's example only shows a button before interaction; build ~48 s per component, render+shot ~1.2 s.

- [x] **V-07** Prototype rendering five Astryx components from their pinned examples into images; measure quality, file size and render time.
  - Use the consent-provisioned lookup cache and a local headless browser in a maintainer script, never during browsing.
  - With the numbers, ask the user about the bundle size budget and image size (add it as an open question then).
  - check: node scripts/astryx-component-shots.mjs → 3 images written to %TEMP%\astryx-component-shots, 2 "no pinned example" rows (exit 1 by design); images inspected visually.

## 2026-11-12T15:07:55.543Z V-08 done: Example choice: scripts/astryx-examples/<Name>.jsx (hand-written, default export) wins, else the first pinned example; TextInput, Badge, Banner now have hand-written ones (bd020e30). User decided: 2x webp within ~1.5 MB total.

- [x] **V-08** Decide the per-component example choice and the fallback for components whose examples do not render alone.
  - check: node scripts/astryx-component-shots.mjs "" TextInput Badge Banner → TextInput 9.0 KB, Badge 7.2 KB, Banner 12.6 KB webp, all hand-written; images inspected visually.

## 2026-11-12T15:40:47.215Z V-09 done: 36c3e265: astryx-component-shots.mjs renders each component's pinned CLI showcase template (overlays opened first) → 162/174 bundled 2x webp, 1480.7 KB, components.json keyed by lockDigest; catalog/designimage serve them; test-work-design fails on a pin move without rerun. 12 sub-parts without a usable template stay picture-less.

- [x] **V-09** Render all 174 components and the theme without a bundled image; bundle them with the pin digest as revision; make the script part of the pin update.
  - The same script exports each component's usage and props as small bundled metadata keyed to the pin, because the lookup (`runAstryx` in extensions/design-library.ts:16-18) provisions the runtime first and browsing must not.
  - Acceptance: catalog entries for components report `preview: "image"`; a test fails when the bundled images or metadata do not match the pin.
  - check: node scripts/astryx-component-shots.mjs → 162/174 pictured, 1480.7 KB; node scripts/test-work-design.mjs → design tool tests passed; node hub/scripts/test-api.mjs → new component-picture asserts pass, then the known unrelated hub-link failure (now line 656).

## 2026-11-12T16:03:16.469Z V-10 done: f54533d2 + bacde83c: all 174 components pictured (5 hand-written examples, hash-named files, 1529.8 KB); component cards show the whole picture; Inspect shows bundled usage+props via api/designdocs (docs.json 587 KB) with no runtime. Themes keep their existing picture cards.

- [x] **V-10** Show Components and Themes as big picture cards, with Inspect showing the picture plus the bundled usage and props.
  - Acceptance: browser test opens the Components tab and sees an image on every card; Components Inspect shows usage and props with no runtime installed and provisioning forbidden.
  - check: node hub/scripts/test-browser.mjs → ok (new V-10 block: every component card has its picture; Button Inspect shows Usage/Props/label *); node hub/scripts/test-api.mjs → designdocs/designimage asserts pass, then known unrelated hub-link failure (line 659); node scripts/test-work-design.mjs → passed.

## 2026-11-12T16:29:44.852Z V-11 done: ef4bbddf: browser test covers Components pictures + Inspect usage/props; changelog shots (components, component inspect, image search); README tabs bullet; CHANGELOG Unreleased entry; Inspect shows the picture first; grey stand-ins for example photos that can't load offline.

- [x] **V-11** Update the browser test end to end, take changelog shots of each tab, and update README and CHANGELOG.
  - check: node hub/scripts/test-browser.mjs → ok (3 earlier runs failed in unrelated early steps: agent-browser daemon EOF, chat wait, voice eval; the 4th passed); node scripts/test-work-design.mjs → passed; node hub/scripts/test-changelog.mjs → ok; node hub/scripts/test-api.mjs → design asserts pass, fails only at the known unrelated hub-link line 659.
