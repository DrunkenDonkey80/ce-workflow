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
