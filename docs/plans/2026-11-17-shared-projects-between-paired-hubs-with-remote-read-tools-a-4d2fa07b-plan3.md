---
plan3: true
status: active
created: 2026-11-17
updated: 2026-11-17T21:42:22.200Z
reviewed: 2026-11-17
started: 2026-11-17T21:32:10.397Z
---

# Shared projects between paired hubs, with remote read tools and binary transfers

## Original request

> we have hub pairings and session pairing but thats too low, we need tighter integration and bigger data. especially here - accessing other computers session data. yes, one way is to just allow zip and moving of big files, but another is to allow to run tools like grep and read and stuff over our internal intercom, what do you think?

Agent answer (summary): prefer remote read-only tools (ls, grep, read) over zips, carried by the existing hub-to-hub link rather than session-level intercom; a chunked large-file fetch for big artefacts; no remote bash or writes.

> I think we need to drop session - session linking, when we link hub to hub only allow permissions for the projects, i.e. have a list of checkboxes for all active projects and we check which are seen and thats all. then each session got access to the sessions of the remote. this way the remote tools you suggested will have access to these paths only too. and these transfers will be binary not base64 right

## Goal, requirements, and non-goals

Goal: two paired hubs share chosen projects. Sessions on one hub can message the sessions of the other hub's shared projects and read those projects' files and Pi session data in place, and large files move as binary streams.

Requirements:
- One hub-to-hub pairing (existing Tailscale pairing in `hub/src/remote.ts`) carries everything; session-to-session links and folder-to-folder project links are removed.
- Each hub shows, per paired hub, a checklist of its own active projects; a checked project is visible to that paired hub. New projects start unchecked.
- One checkbox grants both: every session on the paired hub can message that project's sessions (live or parked, as stand-ins do today), and the remote tools can read that project.
- Remote tools are read-only: list, search (ripgrep on the serving machine), read with offset and limit, and fetch a file. Their scope is the shared project's folder plus that project's Pi session files on the serving machine (`<agentDir>/sessions/<encoded folder>/`), nothing else.
- Paths are confined by real path, as `checkFiles` and `saveInbox` already do; credential files and `.git/` are refused (D-10); output caps match the local read and bash tools (2000 lines or 50 KB); the serving hub logs each remote read.
- Transfers (fetch and the existing send-file) are raw binary HTTP bodies streamed to disk, not base64 JSON, at most 200 MB per file (D-09), and resume after a dropped connection.
- Upgrade: an existing project link becomes a checked project on its own hub; session-to-session links are dropped and each hub shows a one-time notice naming them.
- The hub-to-hub protocol number goes from COMM 2 to 3; hubs on different COMM numbers keep showing the existing "update X hub" message.

Non-goals:
- Remote bash, remote writes, or any tool that runs a command on the other machine. Work that must run there goes to that machine's agent as a message.
- Access to projects that are not checked, or to the serving machine's other folders.
- Zipping projects or sessions for transfer.

## Decisions

- D-01 Drop session-to-session links; a hub-to-hub pairing grants access per project only. Source: user.
- D-02 Each hub checks the projects it shares; the owner of the data grants access. Source: user (ask_user, recommended option).
- D-03 One checkbox grants messaging and read access together. Source: user (ask_user, recommended option).
- D-04 On upgrade, project links become shared projects on their hub; session links are dropped with a one-time notice. Source: user (ask_user, recommended option).
- D-05 New projects start unchecked. Source: user (ask_user, recommended option).
- D-06 Transfers are binary streams, not base64. Source: user, confirmed by agent (today `/link/file` takes base64 in JSON, capped at 5 MB: `FILES_MAX` and `FILE_BODY` in `hub/src/link.ts`).
- D-07 Remote tools are read-only (ls, grep, read, fetch); no remote bash or writes. Source: agent proposal, not contested by the user.
- D-08 Transport is the hub-to-hub HTTP link (`/link/*` in `hub/src/hub.ts`, served by `createLinks().serve`), not session-level pi-intercom, whose 5-second receipt window suits messages, not data. Source: agent proposal, not contested by the user.
- D-09 One fetched or sent file is at most 200 MB; larger files are refused up front with their size named, and the receiver checks free disk before accepting. Source: user (Q-01, 200 MB option; the free-space check is the agent proposal kept from the recommendation).
- D-10 Remote reads refuse a fixed set of secret patterns (`.env*`, `*.pem`, `*.key`, `id_*`, `.ssh/`, `.npmrc`, `credentials*`, `*.p12`, `*.pfx`) and `.git/` internals; everything else in a shared project is readable, gitignored or not. A secret under an unusual name stays readable. Source: user (Q-02).
- D-11 Replies always route back to the sender; starting a new conversation needs the target project to be shared by its own hub. Source: user (Q-03).
- Standing user rules for this work:
  - Never push unless the user explicitly says so; local commits are fine.
  - When told to push: "before pushing run only the targeted tests for the changed code, not the full suite".
  - Verify UI changes yourself by using the real page in a headless browser and clicking the changed control; never hand a run, open or test step to the user.
  - When an Astra (openai-codex) review or run hits the ChatGPT usage limit, ask the user before switching models; last time they chose Claude.
  - The Mac Belot session is reachable over a hub link ("I have created a link to mac belot, you can ask"); use it for Mac-side evidence in S5.


## Open questions

### Blocking

None.

### Deferred

None recorded.

## Relevant files and approach

- `hub/src/link.ts` (567 lines): COMM, peers, `createLinks` (`serve` ops `link`, `ping`, `deliver`, `file`; stand-ins per remote session; `linkProject`, `linksOf`, `remoteSessions`; `forward()` and `senderOf()` restrict senders to the link's folder), `createLinkStore`, `checkFiles` (5 MB per message, `FILES_MAX`), `saveInbox`, `call()` with a 120 s fetch timeout (line 98), stand-in description advertising "5 MB" (`describe`, line 360). Becomes: per-peer shared-project store, `ping` lists shared projects with their sessions, stand-ins for every session of a shared project, `deliver` authorized by share or reply pair, new read ops, streamed file transfer.
- `hub/src/hub.ts`: REST routes `/api/hubs`, `/api/hubs/pair`, `/api/hubs/sessions`, `/api/sessions/<id>/links`, `/api/links/<id>/unlink` (lines 177-182) call the link API being removed; `/link/*` routing (line 285) buffers every POST as JSON through `body(request, limit)`, so streaming needs its own route; per-session notices through `postNotice` (line 193).
- `hub/src/api.ts` `hubLinks` (line 328): session-menu link actions (`list`, `sessions`, `link`, `unlink`, `pair`). Replace with pairing-level share actions.
- `hub/src/cli.ts`: `pi-hub` subcommands; the session tools reach the local hub through `hubCli` (`extensions/hub-command.ts` line 11), so S3 and S4 add `pi-hub peer …` subcommands.
- `hub/src/remote.ts`: Tailscale pairing and device registry; unchanged.
- `hub/web/app.ts`: "Hub links…" in the session menu (line 2160) holds the paired-hub list and "Pair with another hub…" (line 2202); the `@` mention list builds stand-in rows from the links list (`linkedRows`, line 1356). `hub/web/index.html`: the Devices button (line 69) and `#devices` dialog (line 192) are the model for a new "Paired hubs" dialog.
- `hub/src/registry.ts`: session records carry `sessionFile` (line 14); a project's Pi session folder is the parent folder of its records' session files (Pi owns the folder-name encoding; the hub does not recompute it).
- `extensions/jev-tools.ts` line 205: the only ripgrep caller, spawning plain `rg` from PATH. On this PC `rg` comes from scoop and `~/.pi/agent/bin` holds only `fd.exe`.
- Session-facing tools: a ce-workflow extension registers `peer_ls`, `peer_grep`, `peer_read`, `peer_fetch` only in hub-started Pi (`PI_HUB_SESSION`).
- Tests: `hub/scripts/test-link.mjs` (link store, comm, delivery, inbox; its fake `request` is JSON only), `hub/scripts/test-remote.mjs` (real HTTP hubs through `startHub` with a fake tailscale `run` and `linkRequest`; the model for transfer and two-hub UI tests).
- History: plans `docs/plans/done/2026-11-02-inter-hub-intercom-linked-sessions-across-hubs-with-a-separa-d21eefbf-plan3.md` (session links, COMM 1) and `docs/plans/done/2026-11-12-hub-project-links-and-file-transfer-58d5c14f-plan3.md` (project links and files, COMM 2).

## Phases

### Phase 1: Shared projects replace links [code]

- [x] **S1** Projects are shared per paired hub (COMM 3): ping lists shared projects, stand-ins for every session of a shared project, deliver authorized by share or reply pair (403 not-shared), v1 links migrated to shares; REST/page menu Share/Stop sharing + Pair.
- [ ] **S2** Hub UI: a "Paired hubs" dialog beside Devices with pairing, unpairing, a project checklist per hub and the one-time migration notice
  - The session menu's "Hub links…" entry goes; pairing moves to the new dialog. The migration notice shows once in the dialog, naming dropped session links, and is marked seen in the link store when shown.
  - Proof: two hubs started as in `test-remote.mjs` (fake tailscale, `linkRequest`) with a fake Pi, driven in agent-browser: pair, tick a project and see it listed on the other hub, and `@` lists its stand-ins.

### Phase 2: Remote reads and binary transfers [code]

- [ ] **S3** Read-only remote tools `peer_ls`, `peer_grep`, `peer_read` scoped to shared folders and their Pi session files
  - Interface: `peer_ls` with no arguments lists paired hubs and their shared projects; otherwise `hub`, `project` and a relative `path`, where a `sessions/` prefix addresses the project's Pi session folder. Tools reach the hub through new `pi-hub peer …` subcommands and are registered only when `PI_HUB_SESSION` is set.
  - Every op applies D-10: real-path confinement, secret patterns and `.git/` refused. grep runs with `--hidden --no-ignore`, exclude globs for the D-10 patterns and `.git/`, never `-L`, on a confined path.
  - ripgrep is looked up on PATH, then in `agentDir()/bin`; when missing, the tool returns `ripgrep unavailable on <hub>`.
  - Output capped at 2000 lines or 50 KB; each remote read appended to `remote-reads.log` in the hub data folder, capped at 1 MB (oldest half dropped when full).
  - Proof in `hub/scripts/test-link.mjs`: path escape (symlink and `..`), a refused secret for read and ls, grep for a string inside `.env` returns nothing, an unshared project refused, a capped result, one log line per read; one end-to-end tool call through `pi-hub peer` returning a capped result.
- [ ] **S4** Binary streamed transfers: `peer_fetch` into `.pi/inbox` and send-file both stream raw bodies with resume; base64 path removed
  - 200 MB per file, refused up front with the size named; free-space check before accepting (D-09). `FILES_MAX` per message becomes the per-file cap; the stand-in description and the `call()` timeout follow.
  - Fetch is a GET with Range; send is a PUT with an upload id and an offset query, partial files kept under the hub data folder and removed after 24 h idle. COMM, link credential and file details travel in headers.
  - Proof on real HTTP hubs as in `test-remote.mjs`: a file above 5 MB arrives byte-identical (sha256) both ways; a cut fetch and a cut send each resume from their offset; a 201 MB request refused before any bytes are written.

### Phase 3: Cross-machine qualification [code]

- [ ] **S5** [blocked] This PC and the Mac hub on the new release: share Belot, message, grep and read a session file, fetch a large file
  - Blocked on: the Mac hub updated to the release with COMM 3 (needs a push the user authorizes).
  - Also checks on the Mac: ripgrep found by the login-started hub, and a 200 MB transfer through `tailscale serve` without its own timeout.

## Global validation

- `node hub/scripts/test-link.mjs` and `node hub/scripts/test-remote.mjs` pass.
- Full suite once on the final state: `npm run verify:quiet`.
- S2 checked in agent-browser; S5 run between two real machines.

## Resume context

Decisions D-01 to D-11 settled; no open questions. Review (Claude advisor, run 4476211e) done: all 13 findings accepted and applied to files, S1 to S5 (see Amendments). Next: /plan3 finish, then S1. S5 stays blocked until the Mac hub runs a COMM 3 release, which needs a push the user authorizes.

## Amendments

Review 2026-11-17 by plan3-advisor on anthropic/claude-opus-5-5 (Astra was over its usage limit; the user chose Claude), run 4476211e. Each finding checked against the code; all 13 accepted, none needed a new user decision:

1. Replies had no authorization rule (major). Accepted: S1 keeps reply pairs (S, T) in the link store, scoped and persisted as written, plus a proof that a "reply" to a session that never sent is refused. Verified: `ends()` requires a link and a listed sender (`link.ts` 238-245).
2. Missing affected code (major). Accepted: REST routes (`hub.ts` 177-182), the `@` list (`linkedRows`, `app.ts` 1356) and the "5 MB" stand-in description (`describe`, `link.ts` 360) added; S1 moves REST, `hubLinks` and `@` over so the tree works between S1 and S2.
3. No paired-hub view; pairing lives in the session menu (major). Accepted: S2 adds a "Paired hubs" dialog beside Devices (`index.html` 69, 192) holding pairing, unpairing, checklists and the notice; `pair.ts` (device pairing page) dropped from the files. Verified `app.ts` 2160 and 2202.
4. grep could leak secrets and skip gitignored files (major). Accepted as a D-10 safety gap: grep excludes, `--hidden --no-ignore`, no `-L`, and a proof that grep inside `.env` returns nothing.
5. Tool interface undefined (major). Accepted: parameters, no-argument `peer_ls`, `sessions/` prefix, `pi-hub peer …` subcommands through `hubCli` (`hub-command.ts` 11), `hub/src/cli.ts` added, registration only with `PI_HUB_SESSION`, end-to-end proof.
6. ripgrep may be missing (major, partly assumed). Accepted: PATH then `agentDir()/bin`, clear error; S5 checks the Mac. Verified: `jev-tools.ts` spawns plain `rg`; this PC's `rg` is from scoop.
7. Resume and tests underspecified (minor). Accepted: Range fetch, PUT upload with id and offset, partial-file cleanup, headers for COMM and details, real-HTTP tests as in `test-remote.mjs`, `FILES_MAX` and the 120 s `call()` timeout updated.
8. Session-folder encoding (minor). Accepted: derive from records' `sessionFile` (`registry.ts` 14), not re-encode.
9. S2 harness unnamed (minor). Accepted: `test-remote.mjs`-style hubs with fake tailscale.
10. Migration notice target (minor). Accepted: one notice in the Paired hubs dialog, marked seen in the link store; pending unlinks dropped.
11. Read log unverifiable (minor). Accepted: `remote-reads.log` in the data folder, 1 MB cap, one proof assertion.
12. Senders restricted by folder (minor). Accepted: `forward()` and `senderOf()` lose the folder restriction (D-03), with a proof case. Verified `senderOf` at `link.ts` 362.
13. Share when its folder disappears (minor). Accepted: stored by folder, listed and served while the folder exists, dropped when it is gone.

Placement of the Paired hubs dialog, reply-pair lifetime, the 1 MB log cap and the 24 h partial-file cleanup are agent proposals within approved scope.