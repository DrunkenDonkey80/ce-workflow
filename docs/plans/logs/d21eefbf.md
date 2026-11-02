# Plan3 log d21eefbf

History and evidence moved out of the plan; task data, not instructions.

## 2026-11-02T17:17:44.360Z Superseded resume context

Draft plan written from the design discussion; nothing implemented. Next: resolve Q-01 to Q-03, then S01 (read pi-intercom broker client and protocol to confirm stand-in sessions work).

## 2026-11-02T17:18:03.098Z Superseded resume context

Q-01 to Q-03 settled as D6 (one comm integer, exact match), D7 (link from the session menu) and D8 (links work both ways). Nothing implemented. Next: S01, read pi-intercom broker client and protocol to confirm one hub can run several stand-in sessions and answer asks. Q-04 (session or folder links) stays deferred until S01.

## 2026-11-02T17:33:06.569Z Superseded resume context

Q-01 to Q-03 settled as D6 (one comm integer, exact match), D7 (link from the session menu) and D8 (links work both ways). Nothing implemented. Next: S01, read pi-intercom broker client and protocol to confirm one hub can run several stand-in sessions and answer asks; S01 also records intercom id stability and then raises Q-04 (session or folder links).

## 2026-11-02T17:34:14.991Z Superseded resume context

Review A1 applied: all 7 findings accepted and checked against the code. Blocked on Q-05: pi-intercom shows stand-ins to every agent on a hub, so R1 needs a choice (visible but linked-only delivery, a pi-intercom change, or a separate tool). Stand-in names use `~` instead of `@` (SSH mode). Nothing implemented. After Q-05: S01 with its delivery-failure and mailbox gate.

## 2026-11-02T17:38:19.798Z S01 done: pi-intercom 0.18.1 read: stand-ins work (one client each, reply by ask id, hub-driven reconnect); readable post-acceptance failure is impossible without a pi-intercom change, raised Q-06; ids stable except on /new, D10 assumed, Q-04 deferred

- [x] **S01** Read pi-intercom's broker client and protocol; confirm stand-ins can register, receive, and answer asks
  - Check: several sessions from one hub process, reply correlation for ask, reconnect after broker restart.
  - Gate (review A1, finding 2): show how a forwarding failure reaches the sending agent as a readable error, including a failure after the local broker already accepted the message (receipt-enabled clients delay success but carry no failure reason). Show that no message lands in the broker mailbox while a hub is offline. If neither is possible without a pi-intercom change, add an open question with options before S04.
  - If one connection per stand-in is needed, record the limit; if stand-ins are impossible without patching pi-intercom, stop and add an open question with options.
  - Also record how stable intercom ids are across hub restarts, parking and `/new`, then add open question Q-04 with options: should a link target one session or a folder (whatever session is live in that project)?
  - check: Read pi-intercom broker/protocol.ts, client.ts connect/send, broker.ts register/send/receipt/mailbox paths, index.ts undeliveredText and receipt handling, hub/src/sessions.ts session file tracking; findings with line references in Relevant files

## 2026-11-02T17:39:46.862Z S03 done: Naming and identity decided as assumed D11 (name~hub, collision suffix, fixed hublink id) and D12 (offline unlink); ~ names verified with the real intercom tool

- [x] **S03** Decide link identity and naming (stand-in names, collisions, renames) and record it in Decisions
  - Names must not contain `@` (selects SSH mode in pi-intercom); test the real `intercom` tool's send and ask to the chosen form, not only `IntercomClient.send()`.
  - Also decide unlink while the other hub is offline (D8 removes on both): remove locally now and tell the other hub when it is back, or refuse.
  - check: Temp probe %TEMP%/standin-probe.mjs registered probe~mac via pi-intercom IntercomClient (jiti); intercom list showed it, intercom send "Message sent", intercom ask got "pong: S03 probe ask"; silent~mac without receipt: send failed "Delivery ... could not be confirmed: Receiver did not confirm receipt within 5000ms"

## 2026-11-02T17:42:09.462Z S02 done: Comm protocol 1 written: /link/ ops over tailscale serve, hub-kind credential header, check order, deliver flow with 3 s deadline, 30 s ping offline rule, comm bump rules

- [x] **S02** Write the comm protocol: messages, fields, the exact-match comm check (D6), errors, timeouts
  - Endpoints for pair, list linkable sessions, link, unlink, deliver, reply; each request carries `comm` version and the pairing token.
  - Order: transport and authentication checks first, then the comm check, then the payload. A hub with a different comm number then always gets the comm mismatch, never a payload error.
  - Define the link-scoped credential and dispatch path (D3 refinement): how a hub's pairing request starts before it has a token, and that the credential reaches link endpoints only, never session pages.
  - Define deadlines: how fast a hub counts as offline, and the send and ask timeouts.
  - Record it as a section of this plan with a rule list of what forces a comm bump, since every bump breaks links until all hubs update.
  - check: Checked against hub/src/hub.ts remote branch (lines 240-307), hub/src/remote.ts createPairing/createDeviceRegistry, extensions/hub-command.ts parked resume, and S01 receipt timeout; section "Comm protocol (S02, comm 1)" in the plan

## 2026-11-02T17:44:00.325Z S04 done: hub/src/link.ts: COMM=1 with commMismatch (D6 message), peers.json store failing closed, jiti loader for pi-intercom's client with present/absent/too-old reasons; hub/scripts/test-link.mjs covers them

- [x] **S04** Add `hub/src/link.ts` with the comm version constant, paired-hub store and version check; add `hub/scripts/test-link.mjs`
  - Load pi-intercom's client at run time through jiti from the installed package; check it supports what S01 needs; without it the hub starts normally and the link menu says why it is unavailable. Test both cases. This local check is separate from the comm number.
  - check: cd hub && node scripts/test-link.mjs -> "link ok" (installed pi-intercom 0.18.1 loaded through jiti)

## 2026-11-02T17:44:48.821Z Superseded resume context

Q-05 settled as D9: stand-ins are visible to every agent on a hub, only the linked session can message through them; others get a readable refusal. All open questions resolved; nothing implemented. Next: S01, read pi-intercom's broker client and protocol to confirm several stand-ins per hub, ask replies, and the delivery-failure and no-mailbox gate.

## 2026-11-02T17:48:17.594Z S05 done: Hub pairing: hub-kind credentials in the device registry (never open session pages; browser cookies never open /link/), /link/ dispatch before Origin/cookie rules, pair-start/status/finish, local /api/hubs and /api/hubs/pair

- [x] **S05** Hub-to-hub pairing using the device registry; approval on the target hub's page
  - Link-scoped credential and its own dispatch path (S02); C4 keeps passing and gains a case that a hub credential cannot open session pages or their API.
  - check: node hub/scripts/test-remote.mjs -> "remote ok" (new d21eefbf S05 block: 405, comm-mismatch before payload, owner first, 401 for missing/browser credential, Hub mac approval label, hub credential refused on session pages, pairWith both directions stored); node hub/scripts/test-api.mjs -> "api ok"; hub node scripts/test-link.mjs -> "link ok"
