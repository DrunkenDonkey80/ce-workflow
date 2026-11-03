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

## 2026-11-02T17:51:52.510Z S06 done: Links: links.json store (fails closed, pending unlinks for D12), /link/ sessions/link/unlink with the caller known by its credential, local API (hub sessions, session links, link, unlink); both hubs store each link

- [x] **S06** Link and unlink endpoints plus a remote linkable-session list; both hubs store each link (D8)
  - check: hub: node scripts/test-link.mjs -> "link ok" (two in-process hubs: pairing both ways, remote sessions, refused link stored nowhere, both stores hold the link, wrong-hub unlink 401, offline unlink pending, online unlink both sides, corrupt list fails closed); node hub/scripts/test-remote.mjs -> "remote ok"; node hub/scripts/test-api.mjs -> "api ok"

## 2026-11-02T17:57:39.958Z S07 done: Stand-ins: one pi-intercom session per link (hublink-<id>, D11 name), forward send/ask/reply via deliver with the 3 s receipt rule, D9 refusal, parked targets resumed, 30 s ping (offline/reconnect, renames, D12 cleanup and unlink retry); hub wires intercom id from the session file and resume

- [x] **S07** Stand-in sessions in the local broker; forward send, ask and reply; offline stand-ins fail fast
  - Refuse messages from any session but the linked one with a readable error, before forwarding (D9).
  - check: hub: node scripts/test-link.mjs -> "link ok" (fake broker per hub: D11 names, fixed id, send receipt after remote take, ask/reply with same id, D9 refusal and nothing crossed, parked wake, unreachable cause + offline + ping reconnect, rename via ping, not-linked cause, stop disconnects); test-remote "remote ok"; test-api "api ok"; live: real pi-intercom broker accepted hublink-<uuid> id and listed probe~mac

## 2026-11-02T17:59:46.863Z S08 done: Session menu "Hub links…": shows the session's links (stand-in name, offline state, unlink), links to a session on each paired hub, pairs a new hub; served through the page API "links" so phones work too

- [x] **S08** Session menu item "Link to another hub's session" (D7); the menu shows the session's links, their state and unlink
  - A targeted browser test for the link menu that passes on its own, independent of C3's earlier failure.
  - check: node hub/scripts/test-api.mjs -> "api ok" (links list shape, unknown session 404, pair refused without remote access, unpaired hub 404); LSP: no new errors in hub/web/app.ts or hub/src/api.ts (existing ones at app.ts:120/1944/2002 untouched). Menu not clicked in a browser (C3 fails earlier, pre-existing)

## 2026-11-02T18:00:36.021Z S09 done: No code needed: a stand-in is an ordinary pi-intercom sender, so its messages wake the target as intercom_message runs (quiet, not unseen, auto-park as usual) and parked targets resume through host.resume, the same path as `pi-hub wake`; S11 confirms the quiet run live

- [x] **S09** Inbound messages count as intercom runs (unseen, auto-park) like local intercom; test in C1
  - check: hub/src/sessions.ts:83-87 classifies runs by the intercom_message type only (sender-independent); node hub/scripts/test-api.mjs -> "api ok" incl. "an intercom-only run stays seen" (test-api.mjs:319-323); link.ts wakeAndSend calls intercom.wake = host.resume, as cli.ts `wake` does via /api/sessions/<id>/resume

## 2026-11-02T18:01:07.037Z Superseded resume context

S01-S04 done (HEAD 941ef12). Next: S05 hub-to-hub pairing. Design worked out: Device gets optional kind "hub" in hub/src/remote.ts (pair(label, login, kind), check(cookie, login, kind) refuses a kind mismatch, so hub credentials never open session pages and browser cookies never open /link/); createPairing.start takes an optional label/kind for hubs ("Hub <name>"). hub/src/hub.ts remote branch dispatches /link/* right after the owner check (line ~264), before the Missing-Origin and cookie checks. Mutual credential deviates from S02 text: after approval the caller posts authenticated `pair-finish` {comm, offer} with a credential it just issued, instead of an inactive offer in pair-start; pair-start carries hub {name, url}. Update the protocol section and record an amendment. Test in hub/scripts/test-remote.mjs (C4) using its remote() helper with an x-hub-link header. Unverified: tailscale serve sets tailscale-user-login for requests from another user-owned node.

## 2026-11-02T18:01:07.043Z ARCH-RECONCILE done: Product diagram rev 22: pi_control_hub summary names hub links (hub/src/link.ts, comm 1 over Tailscale /link/); new edge pi_control_hub -> pi_intercom "stand-ins name~hub"

- [x] **ARCH-RECONCILE** Reconcile the product architecture diagram with this plan's actual changes.
  - Compare actual code and git history; update through plan3_diagram target product, or mark done with no architecture change.
  - Changed plan elements: none flagged; inspect actual implementation.
  - check: plan3_diagram apply target=product expectedRevision=21 -> revision 22, changed [pi_control_hub, pi_control_hub__pi_intercom]; dependents unchanged (still accurate)

## 2026-11-03T09:22:09.416Z S10 done: User paired the Windows hub with flexs-macbook-pro and linked belot/1 to the Mac session; agents on both sides talk

- [x] **S10** User pairs two real hubs (for example Home and Mac) and links one session on each
  - note: Needs the user to approve pairing on a second real hub and pick sessions to link.
  - check: User report ("inter-hub is currently operational, guys talk each other"); intercom list here shows stand-in 1~flexs-macbook-pro.local (hublink-23ebee73) idle next to belot/1 (01a178b1)
