---
plan3: true
status: ready
created: 2026-10-28
updated: 2026-10-28T20:37:58.294Z
reviewed: 2026-10-28
started: 2026-10-28T19:39:33.590Z
---

# browser_act: agent controls a granted site in your own browser

## Original request

> lets make something dude, for the extension we have to be able to control websites. but RESTRICTED with allowing a site for 10 or 20 or 30 min. so there are tons of stuff that llm can do if it can control the real website with real credentials. we can do it so it reads the elements and tells them in a text and positions for the llm, allow to capture screenshots, clicl buttons by id, scroll and search with lits, select stuff, etc, what do you think

After the agent proposed a design (summarized under Decisions), the user answered: "yes turn into a plan" (2026-10-28).

## Goal, requirements, and non-goals

Goal: the agent can operate a website in the user's everyday browser profile (real logins and cookies) through the existing Pi browser-fetch add-on, only on a site the user granted for a short time.

Requirements from the user:
- R1: control is restricted per site, allowed for 10, 20 or 30 minutes.
- R2: the page's elements are described as text with positions, for the model.
- R3: screenshots.
- R4: click buttons by an id.
- R5: scroll.
- R6: search ("search with lists"): find elements or text without reading the whole page.
- R7: select options (dropdowns, checkboxes and similar), type text.

Requirements from the agent proposal the user approved:
- R8: one tool, `browser_act`, with an action field; not one tool per action.
- R9: the agent works in its own tab; the user's existing tabs are never touched.
- R10: the control grant is separate from browser_fetch's read grant and never "always".
- R11: the browser_fetch block list (mail, sign-in, password managers) applies to control too; banking and payment sites join that shared list (D13, D14).
- R12: navigating to another site (link, redirect, form) asks the user before the agent continues there.
- R13: the agent never types into password fields (and one-time-code fields, see D9).
- R14: actions that buy, pay, send, delete or publish ask the user first (heuristic, see D8 and Q-02).
- R15: the existing toolbar pause button also ends control: actions fail, the debugger detaches.
- R16: every action is logged in the existing browser-fetch log.

Non-goals (first version):
- Recording and replaying action sequences.
- Controlling several tabs at once, or driving tabs the user already has open.
- File uploads and downloads.
- Sites that need no login: agent-browser (headless, separate profile) already covers them.

## Decisions

- D1 (agent proposal, approved): build on browser_fetch. Reuse its policy file, block list, approval dialog, pipe, native host, pause button and log (`extensions/browser-fetch.ts`, `browser-fetch/host.mjs`, `browser-fetch/extension/background.js`). Rationale: the safety plumbing exists; control is a second permission, not a new system.
- D2 (approved): one tool `browser_act` with `action`: open, snapshot, find, click, type, select, scroll, screenshot, back. Rationale: one approval check site and a small prompt footprint.
- D3 (approved): the snapshot is a text outline of the page with short refs per element, e.g. `[e12] button "Save" @(840,120 90x32)`, `[e13] textbox "Name" = "Bob"`. Actions take a ref. Rationale: real HTML ids are often missing or random, and positions alone break; this is the Playwright MCP and agent-browser approach. Positions are included (R2) and a coordinate click is a fallback paired with a screenshot.
- D4 (approved): drive the page through `chrome.debugger` (Chrome DevTools Protocol), not injected page scripts. Rationale: `Input.dispatchMouseEvent` clicks are trusted (scripted `click()` gives `isTrusted=false`, which sites may ignore); it also gives `Page.captureScreenshot`, which works without the tab being visible (unverified for Helium). Chrome's "is debugging this browser" bar doubles as a visible "agent is driving" sign. Needs the `debugger` permission in `browser-fetch/extension/manifest.json`.
- D5 (approved): grant choices are 10, 20 and 30 minutes, for one site (the grantKey host, same rules as browser_fetch); no "once", no "always". When the grant expires mid-task, the next action asks again with the same dialog.
- D6 (approved): `find` filters the last snapshot by text and role, so the model need not reread the page (R6).
- D7 (approved): the agent tab stays open between actions while the grant lasts and closes on expiry, on pause and when the Pi session ends.
- D8 (agent proposal, approved in outline): the risky-action check runs in Pi, on the element facts the add-on reports (role, name, form, input type), not on the model's word. Labels come from the page, so this is a heuristic; the details are Q-02.
- D9 (agent proposal): password inputs and fields with `autocomplete="one-time-code"` or `current-password`/`new-password` are refused for `type`; the model is told to ask the user to type it.
- D10 (agent proposal): the screenshot is saved as a temp PNG file and its path returned, like browser_fetch images, so the model reads it only when needed.
- D11 (user, Q-01): the agent tab is a background tab in the user's current window, inside a colored "Pi" tab group. Needs the `tabGroups` permission. Hidden-tab throttling is a known risk, checked in P1-02 and P4-01.
- D12 (user, Q-02): risky actions (R14) ask first when the clicked element, or the submit button of the form being submitted, matches a word list (buy, pay, order, checkout, purchase, send, delete, remove, publish, post, transfer, confirm, subscribe, plus Bulgarian equivalents such as купи, плати, поръчай, изпрати, изтрий, премахни, публикувай, преведи, потвърди, абонирай), or the form has a payment field (`autocomplete` starting with `cc-`). Known gap: mislabelled buttons pass.
- D13 (user, Q-03): banking and payment sites go into the shared DEFAULT_BLOCKED list in `extensions/browser-fetch.ts`, so browser_fetch can no longer read them either. No separate control-only list. This changes browser_fetch behavior and gets a CHANGELOG line.
- D14 (user, Q-04): the agent seeds common Bulgarian banks plus payment sites. Domains checked to resolve via nslookup on 2026-10-28 (host and subdomains are blocked, so separate e-banking domains are listed):
  - Banks: dskbank.bg, dskdirect.bg, ubb.bg, unicreditbulbank.bg, postbank.bg, e-postbank.bg, fibank.bg, e-fibank.bg, ccbank.bg, bank.allianz.bg, procreditbank.bg, bacb.bg, iabank.bg, tbibank.bg, dbank.bg, municipalbank.bg, bbr.bg.
  - Payments: paypal.com, revolut.com, wise.com, dashboard.stripe.com, epay.bg, easypay.bg.
  - Dropped: investbank.bg (did not resolve). That each domain is the bank's real online-banking site is assumed, not verified; the user adds missing ones in /wo → Settings → Browser access.
- D15 (agent proposal, review finding 1): control is a session, not a fetch job. Pi sends `control-open` with a session id; `host.mjs` records socket ownership for it like for `fetch`, so only the opening socket can steer or close it. Each action is a message `{type: "act", id: session, seq, ...}` answered with the same `seq`; navigation and expiry events between actions go to the owner. `control-close` (or the owner socket closing) ends it. The `done`-after-each-call pattern of browser_fetch is not reused.
- D16 (agent proposal, finding 4): every acting action is inspect, then authorize, then execute. The add-on resolves the target (ref, or for a coordinate click the element under the point via `DOM.getNodeForLocation`) and reports its facts (tag, role, name, input type, autocomplete, form cc-* fields, document URL). Pi applies D9 and D12. The execute message carries those facts; the add-on resolves the target again and refuses when the element, its facts or the document URL changed. Unresolved targets fail closed.
- D17 (agent proposal, finding 6): parameters per action. open: url. snapshot: none. find: query (text) and optional role. click: ref, or x and y (CSS pixels in the viewport). type: ref, text, optional submit (press Enter). select: ref and value (option text or value of a `<select>`); checkboxes and radios use click. scroll: direction (up, down) or ref (scroll into view). screenshot: none. back: none. Other combinations are rejected before anything is sent.
- D18 (agent proposal, finding 2): navigation is gated before the request. The add-on keeps the existing main-frame block rule on the agent tab, with allow rules only for the granted site and hosts approved in this session; back and form posts hit the same rule. A blocked navigation is reported to Pi, which asks the user. Approval only adds the host to the allow list; the add-on never replays the request (that would turn a POST into a GET). The agent is told to repeat the action.
- D19 (agent proposal, finding 5): the first version acts only in the agent tab's top document. A tab or window opened by the agent tab (`target=_blank`, `window.open`) is closed at once and its URL reported, which the agent can `open` through the normal approval. Iframes appear in the snapshot as `[frame] url` and cannot be acted in. shortcut: sites whose controls live in iframes do not work; add frame support if a real task needs it.
- D20 (agent proposal, finding 3): the grant deadline is sent with each action and the add-on sets a `chrome.alarms` alarm that closes the tab and detaches at the deadline, even when Pi is idle. Pi closes the session on `session_shutdown` and `session_switch` (the hooks `extensions/jev-tools.ts` already uses). Each action rereads the policy, so a grant revoked from another session stops the next action; Pi rechecks the grant after any approval dialog before executing.
- D21 (user, P1-04): the P1-02 prototype lives in the existing add-on, not a separate one. Helium loads that add-on straight from `C:\SOFT\git\ce-workflow\browser-fetch\extension` (Helium Secure Preferences, profile Default, id dmbpeaidhpenhihgngkgekaieninaapk). Prototype: `browser-fetch/extension/proto.js`, loaded by a guarded `importScripts` at the end of `background.js`, started from the right-click menu (the toolbar click stays pause). It adds the permissions `debugger`, `tabGroups` (kept for P3-01), `downloads` and `contextMenus` (prototype only). Kept uncommitted; removed when P1-02 ends.
- D22 (agent, from P1-02 evidence): the snapshot uses `Accessibility.getFullAXTree`, not a DOM walk. Keep non-ignored nodes with roles button, link, textbox, searchbox, checkbox, radio, combobox, listbox, option, menuitem(checkbox/radio), tab, switch, slider, spinbutton, treeitem, heading, Iframe; box from `DOM.getBoxModel` (border quad) by backendDOMNodeId, in chunks of 50; drop nodes without a box. Line format as D3: `[e12] button "Save" @(840,120 90x32)`, plus ` = "value"` and ` [checked]`. getFullAXTree returns nodes out of visual order (footer headings came early), so sort lines by y, then x. Element facts for D16 (input type, autocomplete, form cc-* fields) come from `DOM.describeNode` attributes on the same backend node, not from the AX tree. Measured in Helium (Chrome/156 UA) on 2026-10-28, hidden background tab in the Pi group:
  - dash.cloudflare.com account home: AX 38 elements, 1,764 chars, 0 nameless, 153 ms; DOM walk 139 elements, 6,288 chars, including links inside collapsed menus that the screenshot shows hidden.
  - github.com profile: AX 67, 3,434 chars, 0 nameless, 124 ms; DOM walk 84 with 16 nameless links.
  - github.com repo page (14,657 px tall): AX 143, 8,101 chars, 144 ms; 141 of 143 lines fit in 8,000 chars.
  - All three: debugger attach 4 ms, tab group ok, `Page.captureScreenshot` of the hidden tab ok (124 to 353 ms, 100 to 210 KB PNG), `document.visibilityState` "hidden". Adding the debugger permission by reloading the unpacked add-on worked with no reported re-approval.
  - Not covered: a page with a form (only one textbox seen), so D16 field facts are untested live; P4-01 covers them. Cloudflare's tiles were still loading skeletons 2 s after load, so a snapshot shows the page as it is at that moment and the agent re-snapshots after waiting.
- D23 (agent, P1-03): the exact D9 and D12 rules, applied in Pi to the D16 facts.
  - Words checked: for `click` (by ref or point), the element's accessible name; when the element is a submit button, or `type` has submit=true, also the names of the form's submit buttons. Lowercased, matched as whole words (letters on both sides do not count, Unicode-aware, so Cyrillic works).
  - English words, optional trailing s/ed/ing: buy, pay, order, checkout, check out, purchase, send, delete, remove, publish, post, transfer, confirm, subscribe.
  - Bulgarian stems, matched as word prefixes: куп, плат, плащ, поръч, изпрат, изпращ, изтри, премахн, публикув, преведи, превод, потвърд, абонир.
  - Payment field: the form holding the target contains an input whose `autocomplete` starts with `cc-`; then any submit from that form and any `type` into a `cc-` field asks.
  - Password rule: `type` is refused (not asked) when the input type is `password` or `autocomplete` contains `current-password`, `new-password` or `one-time-code`. The error tells the model to ask the user to type it in the Pi tab.
  - Examples:

    | Action | Element facts | Result |
    | --- | --- | --- |
    | click | button "Save" | runs |
    | click | button "Delete repository" | asks |
    | click | link "Posts" | asks (post + s); accepted false positive |
    | click | link "Postal code help" | runs (postal is not post) |
    | click | button "Изпрати" | asks |
    | click | button "Купи сега" | asks |
    | click | button "Next" in a form with an `autocomplete=cc-number` field | asks (payment form) |
    | click | point (900,400) resolving to button "Pay now" | asks |
    | type | textbox "Search", submit=false | runs |
    | type | textbox "Comment", submit=true, form button "Post comment" | asks |
    | type | input type=password | refused |
    | type | input autocomplete=one-time-code | refused |
    | type | input autocomplete=cc-number | asks |
    | select | combobox "Country" | runs |

<!-- Answered questions, kept for the record. -->
- **Q-01** Where does the agent's tab live?
  - Context: D4's screenshot works on background tabs per CDP docs (unverified in Helium); some sites pause rendering or timers in hidden tabs. The user wants to be able to watch (debugging bar already shows control is on).
  - Recommendation: a background tab in the user's current window, put in a colored "Pi" tab group so it is easy to find and watch.
  - Option: Background tab in a "Pi" tab group — visible on demand, no focus stealing; hidden-tab throttling possible.
  - Option: Separate minimized window — fully out of the way; harder to watch, minimized windows throttle too.
  - Option: Active tab in a new window — no throttling, easy to watch; steals focus every time control starts.
  - Independent: yes
  - Answer: {"kind":"selection","selections":["Background tab in a \"Pi\" tab group"]}
  - Source: user via ask_user /plan3 resolve; not independently verified.
- **Q-02** Which actions count as risky and ask first (R14)?
  - Context: D8 runs in Pi on element facts the add-on reports. Page labels can lie, so no rule is complete; too broad and every form asks.
  - Recommendation: ask when the clicked element or the submitted form's button matches a word list (buy, pay, order, checkout, purchase, send, delete, remove, publish, post, submit payment, transfer, confirm, subscribe and the Bulgarian equivalents), or the form contains a payment field (`autocomplete` cc-*).
  - Option: Word list plus payment fields — catches the common cases, few prompts; misses mislabelled buttons.
  - Option: Ask before every form submit and every click on a submit button — safest, many prompts.
  - Option: No check, rely on the short grant — fewest prompts; a page could steer the model into a harmful action.
  - Independent: yes
  - Answer: {"kind":"selection","selections":["Word list plus payment fields"]}
  - Source: user via ask_user /plan3 resolve; not independently verified.
- **Q-03** Banking and payment sites (R11): never controllable, or only blocked for control while reading stays allowed?
  - Context: the browser_fetch DEFAULT_BLOCKED list blocks reading and would block control. Reading a bank's public page is harmless; controlling a logged-in bank is the main danger.
  - Recommendation: a second default list, "never control", that browser_act checks on top of the read block list; seed it with payment sites (paypal.com, revolut.com, wise.com, stripe.com dashboard) and the user's banks, editable in /wo → Settings → Browser access.
  - Option: Control-only list — reading stays possible; one more list to show in settings.
  - Option: Add them to the shared block list — one list; browser_fetch can no longer read those sites either.
  - Option: No default list, the user adds their own — least code; nothing protected out of the box.
  - Independent: yes
  - Answer: {"kind":"selection","selections":["Add them to the shared block list"]}
  - Source: user via ask_user /plan3 resolve; not independently verified.
- **Q-04** Which bank domains go in the seed list (only if Q-03 picks a list)?
  - Context: the agent does not know the user's banks; Bulgarian banks are likely relevant.
  - Recommendation: the user names them when Q-03 is settled.
  - Option: User supplies the list — accurate, needs the user once.
  - Option: Agent seeds common Bulgarian banks — no effort for the user, may miss theirs.
  - Answer: {"kind":"selection","selections":["Agent seeds common Bulgarian banks"]}
  - Source: user via ask_user /plan3 resolve; not independently verified.





## Open questions

### Blocking

None.

### Deferred

None.

## Relevant files and approach

- `C:\SOFT\git\ce-workflow\extensions\browser-fetch.ts`: policy file (`readPolicy`, `updatePolicy`, `Grant`, `granted`), block list and `checkUrl`, `approve` and its dialog (`HOURS`), pipe link (`connect`, `inbox`), `logFetch`, tool registration (`browserFetchTool`). Add a `control` grant map, the control dialog, the `browser_act` tool and the Pi-side safety checks here, or in a sibling `extensions/browser-act.ts` if the file grows past readability (decide in P2).
- `C:\SOFT\git\ce-workflow\browser-fetch\host.mjs`: relays newline JSON from Pi to the add-on by id. Ownership is only registered for `type: "fetch"` (lines 60 to 62), so it needs D15's `control-open` ownership and close handling, plus screenshot saving like `saveImage`.
- `C:\SOFT\git\ce-workflow\browser-fetch\extension\background.js`: job handling (`onMessage`, `start`, `finish`), pause (`showPaused`, `action.onClicked`). Add the control session: tab lifecycle, debugger attach, snapshot, actions, navigation watcher.
- `C:\SOFT\git\ce-workflow\browser-fetch\extension\manifest.json`: add the `debugger` permission (and `tabGroups` if Q-01 picks a group). Loaded unpacked from the package, so a reload picks it up; whether Helium asks to re-approve permissions is unverified.
- `C:\SOFT\git\ce-workflow\scripts\test-work-browser-fetch.mjs`: existing tests with a temp agent dir, a test pipe and a `vm` harness that runs `background.js` with a fake `chrome`; extend it for control.
- `C:\SOFT\git\ce-workflow\README.md`, `C:\SOFT\git\ce-workflow\CHANGELOG.md`: user docs.

## Commands

- C1: `node "scripts/test-work-browser-fetch.mjs"` (from the repo root).
- C2: pi-lens LSP check on the touched `.ts` files (`lens_diagnostics` source=lsp scope=paths).

## Phases

### Phase 1: Snapshot shape and safety rules [think]

- [x] **P1-01** Q-01 to Q-04 settled by the user via /plan3 resolve; recorded as D11 to D14.
  - note: Prototype in the existing add-on per D21; waiting for the user to reload it and run it on three logged-in pages.
- [x] **P1-04** User reloaded the Pi browser fetch add-on with the prototype (D21) and ran it on dash.cloudflare.com, a GitHub profile and a GitHub repo page.
- [x] **P1-02** Snapshot method chosen: accessibility tree sorted by position (D22); Helium supports debugger, tab groups and hidden-tab screenshots; prototype removed.
- [x] **P1-03** Risky-action and password rules written as D23 with a 14-row example table.

### Phase 2: Pi side: grants, tool and safety checks [code]

- [x] **P2-01** Policy has a separate `control` map with timed-only grants (controlUntil, CONTROL_MINUTES 10/20/30), pruned on write; a malformed map fails closed.
- [x] **P2-07** D14's 23 bank and payment domains added to DEFAULT_BLOCKED; checkUrl refuses them (browser_act reuses checkUrl, its refusal is asserted in P2-06).
- [x] **P2-02** Control approval dialog (10/20/30 min, Deny; 5 min timeout = deny) in extensions/browser-act.ts; asked again when the grant expired or was revoked.
- [x] **P2-03** browser_act tool registered (new extensions/browser-act.ts, added to package.json) with D17 validation, find over the stored snapshot, 8,000-char snapshot cut, untrusted-content guidance.
- [x] **P2-04** Pi enforces block list, private addresses, DNS, D16 inspect/judge/execute with D23 rules, D18 blocked-navigation grants, D19 spawned-tab notes, and closes control when the tab leaves granted sites.
- [x] **P2-05** Every action logged via logFetch with tool, site, action, ref, element name, decision; typed text never logged (asserted).
- [x] **P2-08** closeSession on session_shutdown/session_switch and on browser 'closed' events; grant reread every action and after a risk confirmation.
- [x] **P2-06** C1 covers validation, grants, blocks, denial, risky/password/payment cases, point click, blocked nav, spawned tab, revocation, browser close, session end, logs and the D23 table.

### Phase 3: Browser add-on: control session [code]

- [x] **P3-01** manifest gains debugger and tabGroups; control.js (importScripts from background.js) opens one background agent tab next to the active one, in a blue "Pi" group, kept per session.
- [x] **P3-07** host.mjs owns control-open/act/control-close per socket (foreign sockets dropped), saves result.png as shot-NNN.png and sends path; socket close sends cancel which ends the session.
- [x] **P3-02** Snapshot from Accessibility.getFullAXTree + DOM.getBoxModel in chunks of 50, sorted by y,x, refs per session cleared on every navigating action; unknown/removed refs fail asking for a new snapshot.
- [x] **P3-03** click (ref or hit-tested point via clickable()), type (select-all + Input.insertText, optional Enter), select (<select> by value or text), scroll, back via CDP trusted input; execute re-resolves and refuses when node/facts/url changed.
- [x] **P3-04** Page.captureScreenshot PNG relayed as base64 and saved by host.mjs under the image dir; Pi returns the path.
- [x] **P3-05** Tab-scoped DNR rules reused (rules()), blocked main-frame URLs reported and the error page undone; spawned tabs closed and reported, window.open/target rewritten to same tab; alarm, pause, debugger detach, tab close and port drop end the session with a closed message.
- [x] **P3-06** C1 controlRoundTrip covers attach, alarm deadline, snapshot order/filters/frames, click/type/select/password/risk, point click, blocked nav no request + repeat, back, spawned tab, scroll, screenshot file, foreign socket ownership, D16 changed-facts refusal, disconnect, alarm/pause/detach/tab close/closeSession endings.

### Phase 4: Live check [code]

- [ ] **P4-01** User reloads the add-on in Helium and runs a real task on a granted logged-in site with the agent.
  - Check: debugging bar and Pi tab group show; snapshot, find, click, type, select, scroll, back and screenshot each work in the background tab.
  - Check: a 10-minute grant expires while idle and closes the tab; a link to another site asks; a `target=_blank` link is closed and reported; a password field is refused; a "Delete" button asks; the pause button stops it; ending the Pi session closes the tab.

### Phase 5: Docs [code]

- [x] **P5-01** Browser access menu gains "Controlled sites (n)" listing live control grants with deadlines; Enter revokes; blocking a site also drops its control grant.
- [x] **P5-02** README Browser act section (actions, safety, ending control, reload for new permissions) and block-list wording; CHANGELOG Unreleased Added browser_act and Changed bank/payment block.
### P-ARCH [code] Product architecture

- [ ] **ARCH-RECONCILE** Reconcile the product architecture diagram with this plan's actual changes.
  - Compare actual code and git history; update through plan3_diagram target product, or mark done with no architecture change.
  - Changed plan elements: none flagged; inspect actual implementation.


## Global validation

- C1 passes; C2 shows no errors on touched files.
- P4-01 done by the user on a real site, with each listed behavior seen. C1 results are mocked-browser evidence; only P1-02 and P4-01 show real Helium behavior.
- No push; local commits only, touching only this plan's files (other sessions have uncommitted work in the repo).

## Resume context

Phases 1 and 2 done (HEAD f602d67). Pi side in extensions/browser-act.ts speaks D15 messages: control-open {id}; act {id, seq, action, phase inspect|execute, ref, x, y, facts, text, submit, value, direction, hosts, blocked, until}; replies {type result, id, seq, url, title, items, frames, facts, blocked[], spawned[], path}; browser-initiated {type closed, id, reason}; control-close {id}. Next: P3-01, add debugger and tabGroups permissions and the agent tab in a Pi group in browser-fetch/extension/background.js; then P3-07 host.mjs ownership for control-open/control-close.

## Amendments

Append material changes and their reasons; preserve the original request and settled decisions.
- 2026-10-28: Added P2-07 after P2-01: Q-03 chose the shared block list and Q-04 an agent-seeded Bulgarian bank list; that is an edit to existing browser_fetch code no step covered.
- 2026-10-28: Added P1-04 after P1-01: Review finding 8: P1-02 needs logged-in Helium pages and the debugger permission, which only the user can provide; nothing before it set that up.
- 2026-10-28: Added P3-07 after P3-01: Review finding 1: host.mjs only registers ownership for fetch and Pi sends done after each call, so a persistent session needs host changes.
- 2026-10-28: Added P2-08 after P2-05: Review finding 3: grant lifetime was not tied to the Pi session or to idle expiry.
- 2026-10-28 review (plan3-advisor, openai-codex/gpt-6-astra:high), each finding checked against the code:
  - 1 control protocol needs host changes: accepted. Confirmed `host.mjs` lines 60 to 62 own only `fetch` and `browser-fetch.ts` sends `done` after each call. Added D15, P3-07, host bullet in Relevant files.
  - 2 navigation reporting is not an approval barrier: accepted. Confirmed `background.js` retries with `chrome.tabs.update({url})`, which would turn a POST into a GET. Added D18 (block before request, approval never replays); P3-05 and P3-06 updated.
  - 3 grant lifetime not tied to session lifetime: accepted. Confirmed expiry is only checked when Pi reads the grant and browser-fetch has no session hooks. Added D20 and P2-08; revocation takes effect at the next action or the deadline, a stated limit.
  - 4 safety checks lack an execution contract: accepted. Added D16 (inspect, authorize, execute with re-resolve; coordinate clicks inspected too); P2-04, P2-06, P3-03 updated.
  - 5 confinement covers only the original tab: accepted in reduced form. Added D19: spawned tabs closed and reported, iframes listed but not actionable (shortcut noted), instead of full frame and popup support.
  - 6 tool contract omits capabilities: accepted. Added D17 parameter table; `find` assigned to P2-03.
  - 7 acceptance incomplete: accepted. P1-02 now defines scope, truncation and measurement; P4-01 checklist covers every action and lifecycle case; Global validation separates mocked from Helium evidence.
  - 8 P1-02 lacks a setup prerequisite: accepted. Added human step P1-04.
- 2026-10-28: Added final architecture reconciliation because a product diagram exists.
