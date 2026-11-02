---
plan3: true
status: ready
created: 2026-11-02
updated: 2026-11-02T17:59:46.863Z
reviewed: 2026-11-02
started: 2026-11-02T17:35:04.527Z
---

# Inter-hub intercom: linked sessions across hubs with a separate comm version

## Original request

> Can we think of an inter-hub intercom, like manually connect some hub sessions together and they become visible for the agents as intercom ones. I have 4 computers with hubs installed. Is there a clean and reliable way?

After the proposal (hub-to-hub link with stand-in intercom sessions):

> Yeah I need it so write a plan. But let's have a comm version so cewf updates don't break the comm unless we change something in the comm itself

## Goal, requirements, and non-goals

Goal: sessions on different hubs (the user has 4 machines, among them Windows, WSL and Mac, each running a hub on one tailnet) can talk through the normal `intercom` tool once the user links them by hand.

Requirements:
- **R1 Manual linking.** Nothing crosses hubs by default. The user links one session to a session on another hub; only linked pairs see each other (narrowed by D9: other local agents can see a stand-in's name, only the linked pair can exchange messages). Either side can unlink.
- **R2 Native to agents.** A linked remote session appears in the agent's `intercom list` as an ordinary peer named like `reviewer@mac`; `send`, `ask` and `reply` work without new agent tools or prompt changes.
- **R3 Paired hubs.** Hubs pair once, approved on the target hub like device pairing today. Every forwarded message is authenticated by that pairing; no SSH, no new open ports, tailnet only.
- **R4 Comm version (user decision).** The hub-to-hub protocol carries its own version number, separate from the ce-workflow package version. Hubs on different ce-workflow versions keep talking as long as their comm versions are equal (D6); only a change to the comm protocol itself bumps it.
- **R5 Clear failure.** An unreachable hub shows its stand-ins as offline and sending fails at once with a readable error (for example "Mac hub unreachable"). No silent loss. (Narrowed by D13: asks fail at once; plain sends wait in pi-intercom's mailbox.)

Non-goals (first version, agent proposal accepted with "Yeah I need it"):
- No attachments, handover, supersede or retry across hubs; plain text send, ask and reply only.
- No store-and-forward queue for offline hubs. (D13: pi-intercom's own mailbox is used for plain sends; no new queue.)
- No automatic discovery of sessions to link; no sharing of every session.
- No change to the pi-intercom package itself if avoidable (stand-ins register as regular sessions, like the `pi-intercom` CLI does).

## Decisions

- **D1 Hub-to-hub relay over the tailnet, not pi-intercom's SSH cross-machine mode.** Rationale: the SSH mode needs SSH between all machines plus Herdr saved machines (awkward on Windows and WSL), its sender identity is "unverified cross-machine", and v1 of it supports no ask, replyTo or attachments (source: pi-intercom README, "Cross-machine coordination over ssh", `C:/Users/Flex/.pi/agent/npm/node_modules/pi-intercom/README.md` lines 595-607, version 0.18.1). Agent proposal, accepted by the user.
- **D2 Stand-in sessions.** Each hub registers one stand-in per linked remote session in its own local broker, so pi-intercom stays local-only and unchanged. Agent proposal, accepted.
- **D3 Pairing reuses the existing device pairing model.** Remote requests already need the Tailscale owner login and a paired device (`hub/src/remote.ts` `createDeviceRegistry`, `createPairing`, D19 of the remote plan). A hub pairs as a device of another hub. Agent proposal, accepted.
  - Review refinement (A1, finding 4): the approval flow stays as decided, but the issued credential must be link-scoped. A device cookie opens every session page (`hub/src/hub.ts` remote branch: remote requests reach `/s/<id>` pages, whose API lists sessions, files and accepts messages), which would exceed linked pairs. Link requests also need their own authenticated dispatch path, since remote requests outside session pages are rejected (`Remote devices reach session pages only.`) and remote POSTs need an Origin.
- **D4 Separate comm version (user decision).** See R4. The comm version lives in its own constant in the link module and in every link request; it never reads `package.json`.
- **D5 Smallest useful scope.** Text send, ask, reply; offline fails fast. Agent proposal, accepted.
- **D6 Comm version is one integer that must match exactly (user decision, Q-01).** Hubs with equal comm numbers link whatever their ce-workflow versions; any difference refuses with a message naming both numbers and which hub to update (for example "Mac hub speaks comm 2, this hub comm 1: update this hub"). Consequence: every comm bump breaks links until all linked hubs update, so bump only for real protocol changes and keep fields stable; the protocol section (S02) lists what counts as a change.
- **D7 Links are made from the session menu (user decision, Q-02).** A "Link to another hub's session…" item lists sessions of paired hubs; the same menu shows the session's links and unlinks them.
- **D9 Stand-ins are visible to every agent on a hub; only the linked session can talk through them (user decision, Q-05).** pi-intercom lists every session in a scope to every other session (`broker.ts` list and broadcast by exact scope), so hiding stand-ins would need a pi-intercom change. R1 therefore means: only linked pairs can exchange messages; other local agents may see the stand-in's name. A message to a stand-in from any session other than its linked one is refused with a readable error (for example "reviewer~mac is linked to planner, not to this session") and never forwarded. This holds on both hubs (D8).
- **D10 A link targets a hub session record, not an intercom id (assumed, S01).** The hub record id survives parking, hub restarts and `/new`; the intercom id changes on `/new`. Each delivery looks up the record's current intercom id. Reversible; folder links stay open as Q-04.
- **D11 Stand-in naming (assumed, S03).** Name: `<remote session name>~<remote hub name>`, where the hub name is the other hub's hostname (the hub already shows `os.hostname()`); both parts lowercased, any character outside `a-z 0-9 . _ -` becomes `-`, so no `@` or spaces. If that name is already taken on this hub (a local session or another stand-in), add the first 4 characters of the remote record id: `reviewer-1a2b~mac`. The stand-in registers with a fixed session id per link (`hublink-<link id>`), so reconnects keep its identity. A remote rename reaches the stand-in through a presence update at the next link sync. Verified live: a probe stand-in `probe~mac` appeared in the real `intercom list`; `send` arrived and `ask` returned the probe's reply.
- **D12 Unlink while the other hub is offline (assumed, S03).** Remove the link here at once and keep telling the other hub until it confirms. Until then the other side's stand-in still exists, but its messages are refused by this hub (D9 "not linked"), so nothing leaks.
- **D13 Stand-ins disconnect while their hub is offline (user decision, Q-06).** Asks then fail at once with pi-intercom's "not currently connected"; plain sends wait in pi-intercom's existing mailbox (up to 24 h, 256 messages) with its honest "waiting in the broker mailbox" text, and go out when the stand-in reconnects with the same id after the hub returns. A failure after the broker already accepted (hub drops mid-send) gives pi-intercom's generic "could not be confirmed" text plus a follow-up message from the stand-in naming the cause. No pi-intercom change. This relaxes R5 and the queue non-goal for plain sends only: the queue is pi-intercom's, no new queue code.
- **Q-06** pi-intercom cannot show the sender why a cross-hub message failed. Which offline behavior should v1 use?
  - Context: S01 findings above. A stand-in can only confirm or withhold a receipt; a withheld one fails after 5 s with pi-intercom's fixed text "could not be confirmed ... may still arrive", and the receipt detail with the real cause is never shown to the agent. A disconnected stand-in makes asks fail at once with "not currently connected" but queues plain sends in the broker mailbox for up to 24 h, delivered when the stand-in reconnects. This conflicts with R5 ("fails at once with a readable error") and the non-goal "no store-and-forward queue". Read from code, not run.
  - Recommendation: Disconnect stand-ins while their hub is offline. Asks fail at once; plain sends wait in pi-intercom's existing mailbox and go out when the hub is back, with honest "waiting in the mailbox" text and no new queue code. The rare failure after acceptance (hub drops mid-send) gives the generic text plus a follow-up message from the stand-in naming the cause. No pi-intercom change.
  - Option: Disconnect while offline — asks fail at once, sends wait in pi-intercom's mailbox (24 h) and are forwarded on return. Honest texts, no pi-intercom change; R5 and the queue non-goal are relaxed for plain sends.
  - Option: Stay connected, mark offline — the stand-in's status shows "offline: Mac hub unreachable" in `intercom list`; every send and ask fails after 5 s with the generic "could not be confirmed, may still arrive" text plus a follow-up message naming the cause. No queue, but slower and the main text is misleading.
  - Option: Change pi-intercom — add a receiver rejection (a receipt that fails the send with its reason and a known outcome). Meets R5 exactly; depends on an upstream change or a local patch of a package we don't own.
  - Independent: yes
  - Answer: {"kind":"selection","selections":["Disconnect while offline (recommended)"]}
  - Source: user via ask_user during /plan3 execute; not independently verified.
- **D8 One link connects both ways (user decision, Q-03).** Both hubs store the link and each registers a stand-in for the other side; unlinking on either hub removes it on both.
- **Q-01** How should comm versions that differ be handled?
  - Context: R4 requires links to survive ce-workflow updates. Hubs update at different times, so two hubs can run different comm versions for a while. The rule decides whether a comm change forces updating all four hubs at once.
  - Recommendation: integer major plus minor. Same major works (new fields are optional and ignored by older hubs); a different major refuses the link with "Mac hub speaks comm 2, this hub comm 1: update the older one". Rationale: additive changes never break, only real protocol breaks need everyone updated.
  - Option: Major and minor — compatible within a major; newer fields optional. Slightly more rules to follow when changing the protocol.
  - Option: Single integer, exact match — simplest, but every comm change breaks links until all hubs update.
  - Option: Range negotiation — each hub states min and max it supports and they pick the highest common one. Most flexible, more code and tests.
  - Independent: yes
  - Answer: {"kind":"selection","selections":["Single integer, exact match"]}
  - Source: user via ask_user /plan3 resolve; not independently verified.
- **Q-02** Where does the user link sessions?
  - Context: R1 needs a manual link. The hub page already has an "@" picker that lists other hub sessions and writes their intercom reference (`hub/web/app.ts` around line 1129) and a per-session menu (`openSessionMenu`).
  - Recommendation: a "Link to another hub's session…" item in the session menu, listing sessions of paired hubs; links shown and removable in the same menu.
  - Option: Session menu item — discoverable per session, needs a remote session list.
  - Option: Hub settings (gear) list of links — one place for all links, less direct.
  - Option: Agent tool or CLI only (`pi-hub link`) — least UI, the user must ask an agent.
  - Independent: yes
  - Answer: {"kind":"selection","selections":["Session menu item"]}
  - Source: user via ask_user /plan3 resolve; not independently verified.
- **Q-03** Should a link be one-way or both ways?
  - Context: a link from A's session to B's session could make B visible to A only, or both to each other. Replies to an ask must flow back either way.
  - Recommendation: both ways; one link makes the pair visible to each other, which matches "connect some hub sessions together".
  - Option: Both ways — one action, symmetric, simplest mental model.
  - Option: One way — finer control; the target only sees the sender when a message arrives.
  - Independent: yes
  - Answer: {"kind":"selection","selections":["Both ways"]}
  - Source: user via ask_user /plan3 resolve; not independently verified.
- **Q-05** Stand-ins are visible to every agent on a hub, not only the linked session. How should R1 be met?
  - Context: pi-intercom's broker lists and announces every session in the same scope to every other session (`pi-intercom/broker/broker.ts` list handler around line 683, `broadcast` around line 1494; scopes match exactly, `sameScope` line 185). So a stand-in `reviewer~mac` registered for one linked session is visible in `intercom list` of all other sessions on that hub. The hub can refuse to forward messages from unlinked senders, but cannot hide the name without changing pi-intercom. Non-goal: no pi-intercom change if avoidable. Verified by reading the installed 0.18.1 code; not run.
  - Recommendation: Visible, linked-only delivery. Every agent on the hub can see `reviewer~mac`, but only the linked session's messages are forwarded; others get "not linked to this session". The name reveals only a session name and hub, all on your own machines, and it keeps pi-intercom unchanged.
  - Option: Visible, linked-only delivery — stand-in names show to all local agents; only the linked session can message through them. No pi-intercom change; weakens "only linked pairs see each other" to "only linked pairs can talk".
  - Option: Change pi-intercom — add per-session visibility (a filter on list and registration events) upstream or as a local patch. Strict R1, but depends on a package we don't own and its update cadence.
  - Option: Separate hub tool instead of stand-ins — a `hub_intercom` tool only linked sessions get. Strict privacy, but breaks R2 (agents use a new tool, not `intercom`).
  - Independent: yes
  - Answer: {"kind":"selection","selections":["Visible, linked-only delivery"]}
  - Source: user via ask_user /plan3 resolve; not independently verified.





## Open questions

### Blocking

None.

### Deferred

- **Q-04** Should a link also be able to target a folder (whatever session is live in that project) instead of one session?
  - Context: S01 found the hub session record id is stable across parking, hub restarts and `/new` (only the intercom id changes on `/new`), so session links already survive the usual replacements. v1 links sessions (D10, assumed). Folder links are in Backlog.
  - Recommendation: Session links only for v1; revisit if you often start fresh sessions in a new hub record for the same work.
  - Option: Session links only — simplest; a link survives park, restart and `/new`, but not closing the session and starting a new one.
  - Option: Also folder links — the link follows whichever session is live in a folder; needs a rule for several live sessions in one folder.
  - Independent: yes

## Relevant files and approach

- `hub/src/remote.ts`: Tailscale serve, device registry and pairing; a hub pairs as a device here (D3).
- `hub/src/hub.ts`: HTTP routes (`routes` table, `POST /api/...`); new link endpoints go here. Note the page router only accepts lowercase letter endpoint names (`/^\/api\/([a-z]+)$/`).
- `hub/src/api.ts`: session list with `intercomId` (first 8 characters of the Pi session id); remote session list for the link picker builds on it.
- `hub/src/sessions.ts`: marks runs started by `intercom_message` as intercom runs; inbound cross-hub messages must arrive the same way so unseen and auto-park behave as for local intercom.
- New `hub/src/link.ts` (proposed): comm version constant, paired-hub store, stand-in registration, forwarding.
- pi-intercom (installed, not ours): `broker/client.ts`, `broker/protocol.ts`, `cli.ts` show how a regular session registers, receives and replies. Unverified: whether one process can hold several registered sessions, and how a reply to an ask is correlated (S01).
  - Verified constraints (review A1): the `intercom` tool and CLI treat any target containing `@` as SSH cross-machine and the CLI refuses `ask` to such targets (`pi-intercom/index.ts` around line 1827, `cli.ts` around line 185), so stand-in names must not contain `@`. Ordinary clients report "delivered" once the broker writes to the target socket (`broker.ts` `completeSocketDelivery` around line 1160); a disconnected target's messages can go to a broker mailbox (`broker.ts` around line 841-884).
  - `package.json` lists pi-intercom as an optional peer dependency with any version; no ce-workflow code uses its `IntercomClient` today, so the hub must load it at run time (jiti, per the Extension File Rule) and work without it.
- `hub/scripts/test-remote.mjs`: existing remote authentication and routing tests that S05 and S06 must keep passing.

S01 findings (read from installed pi-intercom 0.18.1 and the hub code, not run; the two-hub harness verifies them later):
- **Several stand-ins per hub:** one `IntercomClient` per stand-in, each its own socket (`broker/client.ts` `connect(registration, sessionId)`). The same process id is allowed; the broker refuses a session id only when a different live process holds it (`broker.ts` register, around line 537). Limit: one connection per stand-in.
- **Ask and reply:** an ask is a message with `expectsReply`; the broker records an ask edge by message id (`askEdges.set`, around line 800) and accepts a reply only from the asked session with `replyTo` set to that id (`E_REPLY_TARGET` otherwise). So the reply crosses back with the original ask id, and each hub's stand-in replies with `replyTo` = the id its local agent used. Reusing one message id on both hubs is enough.
- **Reconnect:** the client does not reconnect by itself. The hub listens for `disconnected`, starts the broker if needed (`broker/spawn.ts` `spawnBrokerIfNeeded`) and reconnects with the same session id, as pi-intercom's own `scheduleReconnect` does (`index.ts` around line 1562).
- **Delivery result:** with `acknowledgesReceipts: true` (Pi sessions set it, `index.ts` line 1018) the sender hears "delivered" only after the stand-in sends a receipt with a proof status (`receiver_received`, `acknowledged`, `queued`, `injected`). Without a receipt the broker fails the send after `RECEIPT_TIMEOUT_MS` (5000 ms default, `PI_INTERCOM_RECEIPT_TIMEOUT_MS` below 10000) with the fixed text "Receiver did not confirm receipt within 5000ms", shown to the agent as "could not be confirmed ... may still arrive" (`index.ts` `undeliveredText`). A receipt's `detail` (for example "Mac hub unreachable") is forwarded to the sender but never shown in the tool result (`index.ts` keeps only its status). So the whole hop to the other hub and its local delivery must finish well inside 5 s, and a failure after acceptance cannot carry a readable reason. Confirmed live in S03: a stand-in that withholds its receipt made the real `intercom` send fail with exactly that text after 5 s.
- **Mailbox:** a stand-in that disconnects or unregisters stays remembered for 24 h (`DISCONNECTED_SESSION_RETENTION_MS`). Plain sends to it are queued (up to 256, 24 h) and the sender reads "waiting in the broker mailbox until that session reconnects"; asks fail at once with "Target session is not currently connected; blocking asks are not queued" (`broker.ts` around line 841-884). The queue is delivered when the same session id reconnects (`flushMailboxForSession`). A stand-in kept connected never gets mailbox traffic.
- **Names:** the broker does not check name characters; `~` works, `@` selects SSH mode (A1). Names match without case; two equal names give `E_AMBIGUOUS_TARGET` and the agent must use the id.
- **Identity stability:** a session's intercom id is its Pi session id (file name), unless an extension claims a stable id (`index.ts` `resolveConfiguredIntercomSessionId`; ce-workflow claims none). Parking and hub restarts resume the same file (`hub/src/sessions.ts` `--session record.sessionFile`), so the id stays; `/new` makes a new file and a new intercom id, while the hub record id stays and the registry follows the new file (`sessions.ts` around line 179-185).
- `hub/web/app.ts`: session menu and "@" picker for the link UI.

Approach (stand-in names shown with `~` because `@` selects pi-intercom's SSH mode; final naming in S03): hub A keeps a broker client per stand-in. When a local agent sends to `reviewer~mac`, the stand-in receives it and A posts it to hub B over the tailnet with its pairing token and comm version. Hub B delivers it through its own broker from a stand-in named `planner~home`, so the receiving agent can reply normally; B forwards the reply back the same way. Asks are held open on A's stand-in until B returns the reply or the ask times out.

## Comm protocol (S02, comm 1)

Transport: HTTPS through each hub's existing `tailscale serve` address, `https://<peer tailnet host>:<peer port>/link/<op>`, POST with a JSON body, no Origin, no cookie. Every request and response body has `"comm": 1`. Receivers ignore unknown fields.

Check order on the receiving hub (D3 refinement, A1 finding 4):
1. The existing remote checks: tailnet Host, `x-forwarded-proto: https`, `tailscale-user-login` equal to the owner login (all four hubs belong to one owner).
2. `/link/` paths are dispatched here, before the browser Origin and cookie checks. Any other path keeps today's rules.
3. Credential: header `x-hub-link: <id>.<secret>`, checked against the device registry with `kind: "hub"` (new optional field; old entries are browser devices). Missing or wrong: 401 `unpaired`. Only `pair-start` and `pair-status` skip this step. A hub credential never opens session pages (the page path refuses `kind: "hub"`), and a browser cookie never opens `/link/`.
4. Comm: body `comm` not equal to mine: 409 `{ comm: <mine>, error: "comm-mismatch" }`. The caller shows "Mac hub speaks comm 2, this hub comm 1: update this hub" (or "update Mac hub"), per D6.
5. Payload validation and the operation.

Operations:
- `pair-start` `{ comm, hub: { name } }` — starts today's pairing (`createPairing`: one pending request, 2-minute code, approval on the target hub's local page) with label `Hub <name>`. Reply `{ comm, id, code, hub }`; the caller shows the code to compare.
- `pair-status` `{ comm, id }` — waits up to 10 s like today. Reply `{ comm, state, credential? }`; the credential arrives once, on `approved`.
- `pair-finish` `{ comm, offer, hub: { name, url } }` (with the new credential) — `offer` is a hub credential the caller just issued in its own registry, so one approval pairs both directions (D8). The target stores the caller as a paired hub. If this fails, the caller revokes `offer`.
- `sessions` `{ comm }` — for the user's link picker only (D7). Reply `{ comm, hub: <hostname>, sessions: [{ record, name, folder, live }] }`.
- `link` `{ comm, link: { id, from: { record, name }, to: { record } } }` — the receiver stores the link and starts its stand-in for `from`. Reply `{ comm, name, session: { name } }`: `name` is the stand-in name the receiver chose (D11), `session.name` the linked session's name for the caller's stand-in. The calling hub is the paired hub its credential was issued to (`peers.json` `device`), never a URL in the body; a link id another hub owns is refused. The caller stores the link only after this succeeds; if storing fails, it sends `unlink`.
- `unlink` `{ comm, link }` — removes the link and its stand-in, only when it belongs to the calling hub. Unknown link ids succeed, so retries are safe (D12).
- `deliver` `{ comm, link, message: { id, text, expectsReply?, replyTo? } }` — send, ask and reply in one operation; the message id is kept across hubs (S01). The receiver checks the link exists, sends from its stand-in to the linked record's current intercom id (D10) and replies `{ comm, delivered: true }` after its own broker's delivery result. Errors: 404 `not-linked`, 410 `session-gone` (record deleted), 502 `not-delivered` with pi-intercom's reason.
- `ping` `{ comm }` — reply `{ comm, hub, links: [{ id, name }] }`; carries renames (D11) and lets each side drop links the other no longer has (D12).

Delivery flow and deadlines:
- A local agent sends to stand-in `reviewer~mac`. The stand-in checks the sender is its linked session (D9). If not, it withholds the receipt (the send fails after 5 s with pi-intercom's generic text) and at once sends the sender a message: "reviewer~mac is linked to planner, not to this session; not forwarded". Nothing crosses.
- Otherwise it posts `deliver` with a 3 s deadline (inside pi-intercom's 5 s receipt window, S01) and sends the receipt `receiver_received` only on `delivered: true`. On an error or timeout it withholds the receipt and sends the sender a follow-up naming the cause ("Mac hub unreachable", "reviewer on Mac was closed"), per D13.
- A parked target: the receiving hub starts resuming it and answers `{ comm, delivered: true, resuming: true }` at once, then delivers once it joins intercom (up to 60 s). If that fails, it sends the failure back through `deliver` as a message from its stand-in, so the sender still reads the cause.
- An ask: the receiving stand-in asks the real session with the same id; the real reply arrives at that stand-in and goes back with `deliver` and `replyTo`, where the first stand-in replies to the asking agent. The ask's overall timeout is the asking agent's own intercom timeout.
- Offline: a hub with links pings each linked hub every 30 s. Two failed pings or one `deliver` timeout mark it offline and disconnect its stand-ins (D13); pings continue, and the first success reconnects them with the same ids, which delivers pi-intercom's queued mailbox through the normal `deliver` path.

What forces a comm bump (every bump breaks links until all linked hubs update, D6):
- Removing or renaming an operation, field or error code, or changing its type or meaning.
- Making a field required, or a new field the receiver must understand to act correctly.
- Changing the credential header, its format, the check order or the transport.

What does not: adding an optional field older hubs can safely ignore, new error text, UI changes, any change to ce-workflow outside this protocol.

## Commands

- C1 `node hub/scripts/test-api.mjs` (hub API, existing)
- C2 `node hub/scripts/test-commands.mjs` style unit test for the new link module: add a new `hub/scripts/test-link.mjs` (S04 creates it)
- C3 `node hub/scripts/test-browser.mjs` (page; currently fails earlier at "own unseen", pre-existing; seen in this session, not reproduced by the reviewer)
- C4 `node hub/scripts/test-remote.mjs` (remote authentication and routing, existing)

## Phases

### Phase 1: Protocol and feasibility [think]

- [x] **S01** pi-intercom 0.18.1 read: stand-ins work (one client each, reply by ask id, hub-driven reconnect); readable post-acceptance failure is impossible without a pi-intercom change, raised Q-06; ids stable except on /new, D10 assumed, Q-04 deferred
- [x] **S02** Comm protocol 1 written: /link/ ops over tailscale serve, hub-kind credential header, check order, deliver flow with 3 s deadline, 30 s ping offline rule, comm bump rules
- [x] **S03** Naming and identity decided as assumed D11 (name~hub, collision suffix, fixed hublink id) and D12 (offline unlink); ~ names verified with the real intercom tool

### Phase 2: Build the link [code]

- [x] **S04** hub/src/link.ts: COMM=1 with commMismatch (D6 message), peers.json store failing closed, jiti loader for pi-intercom's client with present/absent/too-old reasons; hub/scripts/test-link.mjs covers them
- [x] **S05** Hub pairing: hub-kind credentials in the device registry (never open session pages; browser cookies never open /link/), /link/ dispatch before Origin/cookie rules, pair-start/status/finish, local /api/hubs and /api/hubs/pair
- [x] **S06** Links: links.json store (fails closed, pending unlinks for D12), /link/ sessions/link/unlink with the caller known by its credential, local API (hub sessions, session links, link, unlink); both hubs store each link
- [x] **S07** Stand-ins: one pi-intercom session per link (hublink-<id>, D11 name), forward send/ask/reply via deliver with the 3 s receipt rule, D9 refusal, parked targets resumed, 30 s ping (offline/reconnect, renames, D12 cleanup and unlink retry); hub wires intercom id from the session file and resume
- [x] **S08** Session menu "Hub links…": shows the session's links (stand-in name, offline state, unlink), links to a session on each paired hub, pairs a new hub; served through the page API "links" so phones work too
- [ ] **S09** Inbound messages count as intercom runs (unseen, auto-park) like local intercom; test in C1

### Phase 3: Live check [code]

- [human] **S10** User pairs two real hubs (for example Home and Mac) and links one session on each
  - note: Needs the user to approve pairing on a second real hub and pick sessions to link.
- [ ] **S11** Live round trip: send, ask with reply, unlink, and a hub going offline; record results here
### P-ARCH [code] Product architecture

- [ ] **ARCH-RECONCILE** Reconcile the product architecture diagram with this plan's actual changes.
  - Compare actual code and git history; update through plan3_diagram target product, or mark done with no architecture change.
  - Changed plan elements: none flagged; inspect actual implementation.


## Backlog

- Attachments and handover across hubs.
- A short delivery queue for hubs that are briefly offline.
- Folder-level links (Q-04, raised by S01).

## Global validation

- C1, C4, the new link test and the link-menu browser test pass; C3 is not worse than its current pre-existing failure.
- A two-hub test harness (two hubs in one test, each with its own broker) covers send, ask with reply, an unrelated local session seeing the stand-in but being refused with the D9 error and nothing forwarded, broker restart, a hub going offline, and a link or unlink that fails halfway.
- Two hubs with the same comm number but different ce-workflow versions still link (the harness runs them with different version strings).
- Hubs with different comm numbers refuse with a message naming both numbers and which hub to update.
- A link made on one hub is visible and usable from both; unlinking on either removes it on both.
- Another hub's sessions are listed only in the user's link picker, to a paired hub. An unlinked session never shows in agents' intercom lists on another hub and is unreachable through the delivery endpoints.
- A hub's link credential cannot open session pages or their API.

## Resume context

S01-S04 done (HEAD 941ef12). Next: S05 hub-to-hub pairing. Design worked out: Device gets optional kind "hub" in hub/src/remote.ts (pair(label, login, kind), check(cookie, login, kind) refuses a kind mismatch, so hub credentials never open session pages and browser cookies never open /link/); createPairing.start takes an optional label/kind for hubs ("Hub <name>"). hub/src/hub.ts remote branch dispatches /link/* right after the owner check (line ~264), before the Missing-Origin and cookie checks. Mutual credential deviates from S02 text: after approval the caller posts authenticated `pair-finish` {comm, offer} with a credential it just issued, instead of an inactive offer in pair-start; pair-start carries hub {name, url}. Update the protocol section and record an amendment. Test in hub/scripts/test-remote.mjs (C4) using its remote() helper with an x-hub-link header. Unverified: tailscale serve sets tailscale-user-login for requests from another user-owned node.

## Amendments

Append material changes and their reasons; preserve the original request and settled decisions.

- **A6 (2026-11-02) S05: mutual credential moved to `pair-finish`.** S02 put an inactive `offer` in `pair-start`; an authenticated `pair-finish` after approval needs no inactive-credential state. Comm stays 1 (never shipped).
- **A5 (2026-11-02) S02 done.** Protocol written as section "Comm protocol (S02, comm 1)". Two consequences of S01 recorded there: D9's readable refusal and D13's failure cause reach the sender as an immediate follow-up message (the send itself shows pi-intercom's generic text after 5 s); `reply` folded into `deliver` with `replyTo`, and `ping` added for offline detection and D12 clean-up.
- **A4 (2026-11-02) S03 done.** D11 naming and D12 offline unlink recorded as assumed defaults; `~` names checked with the real `intercom` tool through a probe stand-in.
- **A3 (2026-11-02) S01 done (read-only).** The delivery-failure gate fails without a pi-intercom change: raised blocking Q-06 with options; status blocked. Recorded D10 (assumed) and deferred Q-04.
- **A2 (2026-11-02) Q-05 answered: visible, linked-only delivery.** Added D9; R1 gets a note narrowing "see each other" to "exchange messages"; S07 and the two-hub harness check the refusal.
- **A1 (2026-11-02) Review by plan3-advisor, each finding checked against the code.**
  - Finding 1, stand-ins visible to all local sessions: accepted. Confirmed in `broker.ts` (list and broadcast by exact scope). Conflicts with R1 as written; raised as blocking Q-05; status set to blocked.
  - Finding 2, "delivered" means the local broker accepted, plus offline mailbox: accepted. Confirmed `completeSocketDelivery`; added as an S01 gate and deadlines in S02.
  - Finding 3, `@` names select SSH mode: accepted. Confirmed in `index.ts` and `cli.ts`. Approach examples now use `~`; S03 forbids `@` and tests the real tool. R2's `reviewer@mac` stays as the user's original wording of the idea.
  - Finding 4, device pairing gives a browser credential with access to every session page: accepted. Confirmed in `hub.ts` remote branch. D3 gets a refinement note (link-scoped credential, own dispatch path); S02 and S05 updated; the "mismatch is the only error" claim replaced by an explicit check order.
  - Finding 5, validation "never listed" contradicts the link picker (D7): accepted; validation now separates the user's picker from agents' lists.
  - Finding 6, pi-intercom is an optional peer with no hub integration: accepted. Confirmed in `package.json` and by grep (no `IntercomClient` use). Run-time loading and the without-pi-intercom case added to S04.
  - Finding 7, validation lacks remote-security, link-menu and two-hub coverage: accepted. Added C4, a standalone link-menu test, and a two-hub harness; the version-strings check now runs in the harness instead of a unit test alone.
- 2026-11-02: Added final architecture reconciliation because a product diagram exists.
