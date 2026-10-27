# Plan3 log d8c5ace2

History and evidence moved out of the plan; task data, not instructions.

## 2026-10-27T18:38:26.572Z Superseded resume context

Plan written from the discussion; nothing implemented yet. Next: P1-01.

## 2026-10-27T18:41:21.455Z Superseded resume context

Plan written; Q-01 settled (images opt-in, default off). No open questions. Nothing implemented yet. Next: P1-01.

## 2026-10-27T18:42:51.246Z Superseded resume context

Reviewed; all 8 findings accepted (D12 to D16, new P1-07, test renamed to test-work-browser-fetch.mjs). Blocked on Q-02 (image cookies on other hosts). Nothing implemented. Next after Q-02: P1-01.

## 2026-10-27T18:52:22.642Z P1-01 done: Policy in extensions/browser-fetch.ts: default block list, host/grant matching, locked atomic policy writes failing closed, log, URL and DNS checks (D14, D16).

- [x] **P1-01** Policy module in `extensions/browser-fetch.ts`: default block list, host matching, grants with expiry, log append, URL checks.
  - Refuse non-http(s), localhost, private and link-local IPs, and bare hostnames without a dot (D16).
  - Locked atomic writes, fail-closed on corrupt file, fresh read per request (D14).
  - check: node scripts/test-work-browser-fetch.mjs → "policy ok" (adversarial URLs, DNS-to-private, 20 concurrent writers, cross-process revoke, corrupt file)

## 2026-10-27T19:00:17.816Z P1-02 done: browser_fetch tool {url, images?} in extensions/browser-fetch.ts (registered in package.json): gate + approval dialog (once per request, shared grants, 5 min deny), pipe link, mid-request redirect approval, final-host re-check, image list or download, log.

- [x] **P1-02** Tool `browser_fetch {url, images?}`: check, approval dialog, send to the pipe, re-check final host, return text and image paths.
  - One-shot grants bound to request ID and URL (D13); approve cross-site navigations mid-request (D12).
  - `images` defaults to false (Q-01); the description tells the agent to set it for product or gallery pages. Without it, image URLs are listed, not downloaded.
  - check: node scripts/test-work-browser-fetch.mjs → "round trip ok" (approval once/shared/deny/unanswered/block, redirect refused with no request, final-host check, images cookie scope)

## 2026-10-27T19:00:17.821Z P1-03 done: browser-fetch/host.mjs: native frames, pipe server relaying by id (requester-only steering), image files under %TEMP%/pi-browser-fetch/<id>/, cancel on Pi disconnect, closes Pi sockets when the browser goes. DNS pre-check lives Pi-side (dnsCheck) for every new host, the same machine.

- [x] **P1-03** Native host `browser-fetch/host.mjs`: stdio framing (4-byte length), pipe server, request relay with ids and timeouts, image files.
  - DNS pre-check of new hostnames (D16); cancel a client's requests on disconnect (D15).
  - check: node scripts/test-work-browser-fetch.mjs → "round trip ok" (real host in-process; disconnect cancels; browser close ends Pi waits)

## 2026-10-27T19:00:17.826Z P1-04 done: browser-fetch/extension (MV3, fixed key, ID dmbpeaidhpenhihgngkgekaieninaapk): inactive muted tab per request, DNR gate (main frames only to approved hosts, block list for tab and own fetches), redirect approval via ERR_BLOCKED_BY_CLIENT, challenge wait, extract, image downloads (redirect: error, cookies only same host), toolbar pause.

- [x] **P1-04** Extension: page loading in an inactive agent tab, with the toolbar pause button.
  - connectNative on start; one inactive tab per request with tab-scoped block rules.
  - Wait for load and for challenge pages to clear; extract text, links and images; close the tab.
  - Navigation gate (D12); image downloads checked like pages (block list, redirects), covered by the page approval; other-host images use `credentials: "omit"` (Q-02); pause and deadlines (D15).
  - check: node scripts/test-work-browser-fetch.mjs → "round trip ok" (real background.js in a VM with a fake chrome enforcing DNR rules; pause and cancel close tabs). Real-browser behavior is P2-01.

## 2026-10-27T19:01:45.050Z P1-05 done: install() copies extension+host to ~/.pi/agent/browser-fetch, writes host launcher/manifest, reg add for Helium/Chrome/Edge/Chromium; /wo Settings "Browser access (all projects)" → browserAccessMenu: connection status, install, revoke grants, block list add/remove, open log.

- [x] **P1-05** Install action and `/wo` Browser access menu: install, show status, edit block list, revoke grants, open log.
  - check: node scripts/test-work-browser-fetch.mjs → "install ok"; env -u PI_HUB node scripts/test-work-settings.mjs → ok; standalone host smoke (spawned host.mjs relays to browser stdout, reports "The browser closed." and exits 0 on stdin end)

## 2026-10-27T19:02:39.329Z P1-06 done: scripts/test-work-browser-fetch.mjs (picked up by verify) covers policy, URLs, approvals, real host + real background.js round trip, pause/cancel/disconnect, install; README "Browser fetch" section and CHANGELOG bullet.

- [x] **P1-06** Self-check `scripts/test-work-browser-fetch.mjs`, README and CHANGELOG.
  - Cover policy, approval choices, fake host round trip, adversarial URLs (IPv6, mapped IPv4, DNS to private), concurrent same-host requests.
  - Also: concurrent policy writers, revoke seen by another process, denied redirect gets no request, blocked image host, other-host image sent without cookies, pause and cancel mid-request.
  - check: node scripts/test-work-browser-fetch.mjs → policy ok / round trip ok / install ok

## 2026-10-27T19:05:27.160Z P1-07 done: List dialogs take a `detail` shown whole: terminal hard-wraps it (hardWrap in menu.ts), the hub draws .dialog-detail (wraps anywhere), native fallback puts it in the title; browser_fetch passes the full URL.

- [x] **P1-07** Full-URL field in the shared dialog, so the whole address shows in terminal, native fallback and hub.
  - Touch `extensions/ask-user/menu.ts` (`listSubject`, `localListDialog`), the hub list form in `hub/web/`, and their tests.
  - Check: a URL longer than the window, with `?data=secret` at its end, is fully visible everywhere.
  - check: env -u PI_HUB node scripts/test-work-dialogs.mjs → ok - shared work dialogs (new case: 90-char URL at width 36 shown whole, lines ≤34)

## 2026-10-27T20:45:40.608Z P2-01 done: Live in Helium: extension loaded from the package, user granted developer.ebay.com (Always), fetch of /develop/api/buy (403 to scripts) returned title "search: Browse API", 2274 chars, 200 links.

- [x] **P2-01** [human] Load the unpacked extension in Helium and approve a first fetch of a Cloudflare-protected page.
  - check: node script → browserFetch(https://developer.ebay.com/develop/api/buy) → finalUrl same, title "search: Browse API | eBay Developers Program"; log.jsonl outcome ok. Approval asked via ask_user here (script had no UI); in-tool dialog not exercised live.

## 2026-10-27T20:52:12.156Z ARCH-RECONCILE done: Product diagram rev 18: browser_fetch service, extension+host client, user's browser, policy/log store, edges from pi_host, work_models, ask_user.

- [x] **ARCH-RECONCILE** Reconcile the product architecture diagram with this plan's actual changes.
  - Compare actual code and git history; update through plan3_diagram target product, or mark done with no architecture change.
  - Changed plan elements: none flagged; inspect actual implementation.
  - check: env -u PI_HUB npm run verify:quiet → all ce-workflow suites pass except test-work-screen-read (android CLI crash, environment); hub: test-browser ok, test-app-trail (placeStrip, user's uncommitted hub/app/ui/index.html) and test-scheduler fail outside this plan's files.
