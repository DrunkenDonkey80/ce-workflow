---
plan3: true
status: ready
created: 2026-10-27
updated: 2026-10-27T19:02:39.329Z
reviewed: 2026-10-27
started: 2026-10-27T18:49:18.546Z
---

# browser_fetch: agent page loads through your own browser

## Original request

> dude wondering about something - there is a web search plugin here which we use and thats fine, buuut what do you think about our own version that uses a browser plugin like we have in FurnitureDB/1 (intercom 01a174d5) so we are not hit by freaking cloudflare and protections that often?

> nah I'd love the extension, so lets make this one. but you are right about security, so lets make it but add sites it can't touch by default - things like main mail clients and to have a list in there you can add more if you want. also to be opt-in - whenver it needs to access a site to pop a ask_user that approves here (not sure how you'd do it) that allows that request, this site globally or this site for an hour, 2 or 4. any more ideas?

Follow-up answers (ask_user): everyday profile; deny after 5 minutes unanswered; extras: redirect re-check, full URL in the approval, fetch log, pause button. On "read-only, no downloads": "it will probably be used for the images on the site. should probably download all stuff in temp folder and return the links so the agent looks itself?"

## Goal, requirements, and non-goals

Goal: a `browser_fetch` Pi tool that loads a page in the user's real Chromium browser (Helium; Chrome, Edge and Chromium also registered) through a browser extension, so Cloudflare and similar bot checks see a real browser, and returns the page text plus downloaded images.

Requirements (user):
- R1 Default block list the agent can never open: main mail clients (and, agent proposal, sign-in pages, password managers, local and private addresses). The user can add more entries.
- R2 Opt-in per site: before a load, ask through ask_user (works in the terminal, the hub page and phone): allow this request once, allow the site for 1, 2 or 4 hours, allow the site always, deny.
- R3 Unanswered approval counts as deny after 5 minutes.
- R4 Redirect re-check: a page that ends on another site is checked again (block list and approval) before anything is returned.
- R5 The approval shows the full URL, so a `?data=...` leak is visible.
- R6 Fetch log: every request with time, project, URL, final URL and what allowed or refused it.
- R7 Pause: the extension's toolbar button pauses all agent browsing; requests while paused fail with "paused by the user".
- R8 Images on the page download to a temp folder; the tool returns their paths so the agent views them itself.
- R9 Runs in the user's everyday browser profile (user choice, accepting that loads carry the user's cookies; R1 to R5 are the guard).

Non-goals (v1): clicking, typing or form submission; replacing the search plugin (search APIs are not Cloudflare-blocked, page fetches are); Linux install (the host is cross-platform, install is Windows first); a separate browser window (not picked by the user; agent tabs open inactive and close after reading).

## Decisions

- D1 (user) Extension approach, not CDP-driving a headless or real Chrome: harder to detect.
- D2 (user) Everyday profile, see R9.
- D3 (user) Deny after 5 minutes unanswered.
- D4 (user) Extras in v1: redirect re-check, full URL, fetch log, pause button; images downloaded to temp instead of "no downloads".
- D5 (agent proposal) Transport follows FurnitureDB `browser/`: MV3 extension with a fixed `key` (stable ID), native-messaging host registered per user (HKCU NativeMessagingHosts for Helium, Chrome, Edge, Chromium). The extension keeps a `connectNative` port open (which also keeps its service worker alive); the host listens on a local pipe (`\\.\pipe\pi-browser-fetch`, a socket file on Linux) that Pi sessions connect to. Only that extension ID can start the host. Works without the hub.
- D6 (agent proposal) Block list enforced in two places: Pi checks the requested and the final host; the extension also adds session `declarativeNetRequest` rules scoped to the agent tab, so a blocked site never loads in that tab, redirects included.
- D7 (agent proposal) Policy (block list, site grants) lives Pi-side in `~/.pi/agent/browser-fetch/policy.json`, shared by all sessions; edited from a `/wo` settings entry "Browser access", like Camera. Log in `~/.pi/agent/browser-fetch/log.jsonl`.
- D8 (agent proposal) Approval items: Allow once; Allow <host> 1 hour; 2 hours; 4 hours; Always allow <host>; Deny; Block <host> always. Parallel requests for the same host share one question. Sessions without UI (subagents) get only already-granted sites, otherwise "not approved: ask the user to allow <host> in the main session".
- D9 (agent proposal) Grants match the exact host (`www.` stripped); block-list entries match the host and its subdomains.
- D10 (agent proposal) Images are fetched by the extension with the browser's own network stack (cookies, Cloudflare clearance), capped at 30 images, 8 MB each and 60 MB total, saved by the host under `%TEMP%/pi-browser-fetch/<request>/`, paths returned. Text capped at 100 KB. Returned content is marked untrusted.
- D12 (review) Cross-site navigation is gated before it happens: the extension watches the agent tab's main-frame navigations (`webNavigation.onBeforeNavigate` and redirects via `webRequest.onBeforeRedirect`), stops the tab on any new host, and asks Pi to check and approve that URL before resuming. At most 5 redirects. A denied destination must receive no request.
- D13 (review) "Allow once" binds to one request ID and its full URL. Only timed or permanent site grants are reused by other requests; concurrent requests to the same host after a one-shot answer ask again. Coalescing is per Pi process.
- D14 (review) Policy writes are serialized read-modify-write with atomic replace (temp file and rename) under a lock file; a corrupt policy file fails closed (everything treated as needing approval, nothing granted). Every request re-reads the policy just before dispatch, so a revoke in one session applies in all.
- D15 (review) Pause cancels active and queued requests, aborts image downloads, closes the agent's tabs and removes their rules. Deadlines: page load 30 s, challenge wait 20 s more, whole request 90 s. When Pi or the pipe disconnects, the host cancels that client's requests.
- D16 (review) Private-network protection is best effort and documented as such: literal IPv4 and IPv6 (including mapped and shortened forms) are normalized and refused when private, loopback or link-local; the host resolves each new hostname with DNS before dispatch and refuses private results. DNS rebinding between that check and the browser's own lookup stays possible; Chromium's Private Network Access gives partial cover.
- D11 (agent proposal) Install files are copied to `~/.pi/agent/browser-fetch/` (extension and host), so package updates do not move the loaded unpacked folder; `/wo` Browser access offers Install and shows the folder to load.
- **Q-01** Should images download by default or only when the agent asks (`images: true`)?
  - Context: most fetches are for text; downloading 30 images costs seconds and disk. The user expects images to be a main use.
  - Recommendation: a parameter defaulting to false, the tool description telling the agent to set it for product or gallery pages.
  - Option: Opt-in parameter — fast text fetches, agent decides.
  - Option: Always — simplest for the agent, slower.
  - Independent: yes
  - Answer: {"kind":"selection","selections":["Opt-in parameter"]}
  - Source: user via ask_user /plan3 resolve; not independently verified.
- **Q-02** Does approving a page also cover downloading its images from other hosts (CDNs)?
  - Context: product images usually live on a CDN host (for example `cdn.shopify.com`, `images.example-cdn.net`), not the page's host. Image downloads run from the extension's worker with your cookies (FurnitureDB background.js uses `fetch(url, {credentials: "include"})`), so they are requests to those hosts. Block list and redirect checks apply either way (review finding 2).
  - Recommendation: Page approval covers its images, sent without cookies to other hosts — downloads to other hosts use `credentials: "omit"`, so no logged-in data goes to them, and you are not asked once per CDN.
  - Option: Covered, without cookies — one approval per page; other-host images fetched without cookies; rare cookie-gated images fail.
  - Option: Covered, with cookies — one approval; your cookies go to every image host on the page.
  - Option: Ask per image host — strictest; on a shop page that is one or more extra questions per fetch.
  - Answer: {"kind":"selection","selections":["Covered, without cookies"]}
  - Source: user via ask_user /plan3 resolve; not independently verified.
- (user, standing) Never `git push` unless explicitly told; commit only when asked.
- (user, standing) "before pushing run only the targeted tests for the changed code, not the full suite".
- (user, standing) Do not commit `NUL`, `docs/plans/logs/*.json` or the intentionally untracked `extensions/package-lock.json`.
- (user, standing) The worktree holds uncommitted hub work from the same conversation (View page, CPU/memory popup, hidden-hub taskbar icon, CHANGELOG lines); keep it, do not revert or mix it into this plan's commits unless asked.
- (user, standing) Do not restart the hub yourself: it restarts every session and the user's sessions are usually busy; tell the user to run `node hub/src/cli.ts restart` when it suits them.
- (user, standing) Browser work for testing stays headless (agent-browser); the live extension check runs in the user's own Helium (P2-01).




## Open questions

### Blocking

None.

### Deferred

None.

## Relevant files and approach

- Reference: `C:\SOFT\git\FurnitureDB\browser\` (manifest.json with key, background.js connectNative and executeScript, install.ps1 registry and ID derivation, host.bat).
- New: `browser-fetch/extension/` (manifest.json, background.js, icon), `browser-fetch/host.mjs` (stdio native-messaging relay plus pipe server, image files), `extensions/browser-fetch.ts` (tool, policy, approval, log, install, menu), test `scripts/test-work-browser-fetch.mjs` (the `test-work-*` name joins `scripts/verify-package.mjs:107` automatically).
- Touch: `package.json` (pi.extensions entry, files), `extensions/work-models.ts` (/wo settings item "Browser access"), `CHANGELOG.md`, README section.
- Dialogs: `showListDialog` and `askText` from `extensions/ask-user/menu.ts` (Dialog UX Rule); timeout through `AbortSignal.any([signal, AbortSignal.timeout(300000)])`. The full URL cannot ride in the purpose line or a description: `localListDialog` truncates lines and wraps only at spaces (`menu.ts:105-137`), and `listSubject()` (`menu.ts:311`) has no subtitle field for the hub. P1-07 adds that.

## Phases

### Phase 1: Build [code]

- [x] **P1-01** Policy in extensions/browser-fetch.ts: default block list, host/grant matching, locked atomic policy writes failing closed, log, URL and DNS checks (D14, D16).
- [x] **P1-02** browser_fetch tool {url, images?} in extensions/browser-fetch.ts (registered in package.json): gate + approval dialog (once per request, shared grants, 5 min deny), pipe link, mid-request redirect approval, final-host re-check, image list or download, log.
- [x] **P1-03** browser-fetch/host.mjs: native frames, pipe server relaying by id (requester-only steering), image files under %TEMP%/pi-browser-fetch/<id>/, cancel on Pi disconnect, closes Pi sockets when the browser goes. DNS pre-check lives Pi-side (dnsCheck) for every new host, the same machine.
- [x] **P1-04** browser-fetch/extension (MV3, fixed key, ID dmbpeaidhpenhihgngkgekaieninaapk): inactive muted tab per request, DNR gate (main frames only to approved hosts, block list for tab and own fetches), redirect approval via ERR_BLOCKED_BY_CLIENT, challenge wait, extract, image downloads (redirect: error, cookies only same host), toolbar pause.
- [x] **P1-05** install() copies extension+host to ~/.pi/agent/browser-fetch, writes host launcher/manifest, reg add for Helium/Chrome/Edge/Chromium; /wo Settings "Browser access (all projects)" → browserAccessMenu: connection status, install, revoke grants, block list add/remove, open log.
- [x] **P1-06** scripts/test-work-browser-fetch.mjs (picked up by verify) covers policy, URLs, approvals, real host + real background.js round trip, pause/cancel/disconnect, install; README "Browser fetch" section and CHANGELOG bullet.
- [wip] **P1-07** Full-URL field in the shared dialog, so the whole address shows in terminal, native fallback and hub.
  - Touch `extensions/ask-user/menu.ts` (`listSubject`, `localListDialog`), the hub list form in `hub/web/`, and their tests.
  - Check: a URL longer than the window, with `?data=secret` at its end, is fully visible everywhere.

### Phase 2: Live check [code]

- [ ] **P2-01** [human] Load the unpacked extension in Helium and approve a first fetch of a Cloudflare-protected page.
### P-ARCH [code] Product architecture

- [ ] **ARCH-RECONCILE** Reconcile the product architecture diagram with this plan's actual changes.
  - Compare actual code and git history; update through plan3_diagram target product, or mark done with no architecture change.
  - Changed plan elements: none flagged; inspect actual implementation.


## Global validation

- `node scripts/test-work-browser-fetch.mjs` (new, P1-06); it also runs in `npm run verify:quiet`.
- P1-07: the ask-user dialog tests and `hub/scripts/test-browser.mjs`.
- Live: P2-01 needs the user's browser.

## Resume context

Reviewed and all questions settled (Q-01 images opt-in, Q-02 page approval covers other-host images, sent without cookies). No open questions. Nothing implemented. Next: P1-01.

## Amendments

Append material changes and their reasons; preserve the original request and settled decisions.

- 2026-10-27 review (plan3-advisor, openai-codex/gpt-6-astra:high), each finding checked against the code:
  - 1 Redirect approval too late: accepted, D12, P1-02, P1-04.
  - 2 Image downloads outside the tab rules (confirmed in FurnitureDB background.js fetch with credentials include): accepted; checks in P1-04, cookie scope asked as Q-02.
  - 3 Private-address claim too strong: accepted; D16 states best effort and the DNS rebinding limit, R1's local-address part is best effort.
  - 4 Same-host coalescing versus Allow once: accepted, D13 refines D8.
  - 5 Full URL cannot show in the current dialog (confirmed menu.ts truncate and wrap, listSubject without subtitle): accepted, new P1-07.
  - 6 Shared policy writes: accepted, D14.
  - 7 Pause and cancel lifecycle: accepted, D15.
  - 8 Test not picked up by verify-package (confirmed `test-work-*` filter): accepted, renamed.
- 2026-10-27: Added final architecture reconciliation because a product diagram exists.
