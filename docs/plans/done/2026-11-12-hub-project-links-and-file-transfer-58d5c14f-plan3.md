---
plan3: true
status: complete
created: 2026-11-12
updated: 2026-11-12T14:24:59.196Z
reviewed: 2026-11-12
---

# Hub project links and file transfer

## Original request

> enh on inter-hub comm: [screenshot of the "Link to a session on <hub>" picker: a flat list of "session · project (parked)" rows] reverse the display and show as a tree the project and sessions of it, sorted by project name, allow sending of files with a limit of 5mb, allow not only session but other session of specific project, basically a project to project link instead of session to session

## Goal, requirements, and non-goals

- Picker: project first, as a tree (project heading, its sessions beneath), sorted by project name. Done before this plan (see Phases, PL-00).
- Project-to-project link: one link joins a local project folder and a project folder on a paired hub.
  - Every session of the local project reaches every session of the remote project, and the reverse (D-01).
- Files up to 5 MB, any type, sent over a link; the receiving hub saves them in the target project and the message names the saved path (D-02, D-06, D-07).
- Non-goals: replacing hub pairing, tailnet transport or credentials; links between hubs that are not paired; files over 5 MB; cross-hub `/handover`.

## Decisions

- **D-01 (user)** Project links are every session ↔ every session: each local session in the project sees one stand-in per remote session, named `name~hub`; replies route back to the actual sender. Rejected: one inbox stand-in per project where the remote hub picks the receiver.
- **D-02 (user)** Files: any type up to 5 MB, sent base64, saved on arrival in the receiving project's `.pi/inbox/`, the delivered message naming the saved path. Rejected: passing only intercom text attachments.
- **D-03 (agent proposal)** The protocol changes, so `COMM` in `hub/src/link.ts` goes 1→2; an un-updated peer gets the existing comm-mismatch explanation naming both numbers (D6 of plan d21eefbf). Existing session links keep working after both hubs update.
- **D-04 (agent proposal)** Keep session links; a project link is a new link kind beside them, stored in the same link store with `kind: "project"` and folders instead of records.
- **D-05 (agent finding)** pi-intercom 0.18.1 has native cross-machine send over SSH to Herdr saved machines, but its v1 supports no `ask`, `replyTo` or attachments (pi-intercom README "Cross-machine coordination over ssh"); it does not replace hub links on this Windows plus tailnet setup.
- **D-06 (user, Q-01)** A file travels as an intercom attachment `{type: "file", name, content: "@<absolute path>"}`; the sending hub reads the file and ships it base64. Any other attachment travels as text. Rejected: a separate `hub_send_file` tool.
  - Verified: pi-intercom 0.18.1 delivers `content.attachments` to receivers (types.ts:98-101), so the stand-in's `forward()` sees them; today it forwards only `content.text`.
  - Agents learn the convention from the stand-in's description line (link.ts `describe`), which every intercom list shows.
- **D-07 (user, Q-02)** The sending hub reads files only inside the sender's project folder or the OS temp folder, after resolving the real path (so links and `..` cannot escape); anything else is refused back to the sender with the reason.
- **D-08 (user, Q-03)** Upload first, then send the text. forward() sends each file by a separate `/link/file` op (no 3 s race, its own bounded timeout), the receiving hub saves it and returns the saved path, then the text goes by `deliver` naming those paths. The receipt is sent only after `deliver` succeeds. Rejected: a two-phase receipt with a follow-up message; refusing files that cannot finish in 3 s.
  - Verified consequence: the pi-intercom broker fails an unconfirmed send after 5 s (`RECEIPT_TIMEOUT_MS`, broker.ts:49 and 1172; env can raise it to 10 s at most), so a slow upload makes the sender see `E_RECEIPT_TIMEOUT` while the hub keeps going. The user chose this knowingly.
  - Agent proposal, to keep that tradeoff from causing resends: when the delivery completes after the sender's receipt window, the stand-in tells the sender "delivered to … after all"; when it fails, it tells the reason, as forward() already does. A slow `file` op never marks the hub offline.
  - Files saved before a failed `deliver` stay in the inbox; the failure message names them.
- **D-09 (user, Q-04)** 5 MB is the total of all files in one message. The `/link/file` body cap is 5 MB as base64 (6,990,508 bytes) plus 64 KB for metadata; every other `/link/` op keeps 64 KB. The sending hub sums file sizes before reading any and refuses over 5 MB with the total.
- **D-10 (revised after use)** A project link keeps a stand-in for every session of the other project, parked ones too; a message to a parked one resumes it (as session links do). The first version kept only live ones, and since the hub auto-parks idle sessions the link usually had no target. A `deliver` from a session the hub has not seen yet triggers one ping of that hub before it is refused.
- **D-11 (assumed)** A traversal file name (`../../x`) is not refused: it is reduced to its sanitized base name inside `.pi/inbox`, as `savePastedImage` does, so the file still arrives.

## Open questions

### Blocking

None.

### Deferred

None recorded.

## Relevant files and approach

- `hub/src/link.ts` (426 lines): `COMM`, `serve` ops `link`/`ping`/`deliver`, `link()`, `forward()` (only the linked session may send; text only — attachments dropped), `wakeAndSend()`, `tick()` (30 s ping), stand-ins (one pi-intercom client per link, `standinName`), `Link` type and `createLinkStore`.
- `hub/src/api.ts:319` `links` page API (`list`, `sessions`, `link`, `unlink`, `pair`).
- `hub/web/app.ts` `openHubLinks` (session menu → "Hub links…").
- `hub/scripts/test-link.mjs` — existing link tests (they call `serve()` directly, so they miss the HTTP body cap).
- `hub/scripts/test-remote.mjs:164-181` — pairing over real HTTP; hardcodes comm 1 for success and 2 for mismatch.
- `hub/src/hub.ts:46,283` — `/link/*` bodies capped at `PAGE_BODY` 65,536 bytes.
- `hub/src/images.ts:20-35` `savePastedImage` — existing safe name and exclusive (`wx`) write pattern to reuse.
- Approach: project link stores `{ kind: "project", folder, hub, remote: { folder, name } }`. Each `ping` reply also carries the linked project's sessions (record, name, live), so `tick()` keeps one stand-in per remote session per project link. `forward()` accepts any local session whose folder is the link's folder and sends `deliver { link, from: record, to: record, message, files? }`; the receiving side checks `to` is a session in its linked folder and `from` is a session it was told about for the linked remote project, then delivers through the stand-in for `from`, so replies route back. Session links keep their fixed endpoints. `wakeAndSend` stays per target record.

## Phases

### Phase 0: Picker [code]

- [x] **PL-00** Remote-session picker shows a project tree sorted by name, sessions beneath with "(parked)".
  - Review finding: it groups by folder basename, so two remote folders named `app` merge into one heading; PL-05 fixes this before headings become link targets.
  - Done in `hub/web/app.ts` openHubLinks and `.menu-group`/`.menu-child` in `hub/web/styles.css`; LSP showed only pre-existing findings. Not yet browser-checked or committed (Design session has unrelated edits in the same files).

### Phase 1: Project links [code]

- [x] **PL-01** Project link kind in the link store, COMM 2, existing mismatch message.
- [x] **PL-02** `link` serves and calls projects (linkProject); `ping` lists each linked project's sessions.
- [x] **PL-03** One stand-in per live remote session per project link, keyed link/record, refreshed on tick, names deduped.
- [x] **PL-04** forward() accepts any session of the linked folder; deliver carries from/to, checked against the folder and the remote list (one refresh on miss).
- [x] **PL-05** Hub links menu groups remote sessions by full folder (same names show parent), the heading links the whole project; unlink shows the project label; page API passes folder to linkProject.
- [x] **PL-06** test-link covers project link, 2x2 matrix with replies to the sender only, forged ends, outside sender, new session, parked drop, unlink; test-remote uses COMM.

### Phase 2: Files [code]

- [x] **PL-07a** `/link/file` reads up to FILE_BODY (5 MB base64 + 64 KB); deliver and other /link/ ops keep 64 KB; fetch timeout 120 s for files.
- [x] **PL-07** forward() checks `@path` files (real path in sender project or temp, absolute, ≤5 MB total), uploads each by /link/file, then delivers text naming saved paths; other attachments as text; stand-in model line names the convention.
- [x] **PL-08** saveInbox writes `.pi/inbox/<iso time>-<random>-<sanitized name>` with wx after checking the inbox real path stays in the project; late success told as "after all", upload failures told and never take the hub offline.
- [x] **PL-09** test-link: binary round trip, snippet as text, same-name kept, traversal name kept in inbox, outside/junction/relative/over-5MB refused before upload, inbox junction refused, late success and late failure; test-remote: exact cap 400, +1 byte 413, deliver 64 KB.

### Phase 3: Finish [code]

- [x] **PL-10** Changelog Unreleased bullets for project links and files with a picker screenshot; hub links are documented only in the changelog (no README section exists).

## Global validation

- `cd hub && node --test "scripts/test-link.mjs"` (existing link tests plus new ones).
- `cd hub && node --test "scripts/test-remote.mjs"` (pairing and the /link/ body cap over real HTTP).
- `cd hub && node --test "scripts/test-browser.mjs"` only when no other session runs browser tests.

## Resume context

Draft; no open questions. Q-03 → D-08 (files go first by /link/file, then the text; a slow upload can hit pi-intercom's 5 s receipt timeout, so the stand-in tells the sender the late outcome) and Q-04 → D-09 (5 MB total per message; /link/file body cap 6,990,508 plus 64 KB). PL-00 picker tree is done but uncommitted (shares hub/web files with the Design session) and needs full-folder grouping in PL-05. Next step PL-01 after /plan3 finish.

## Amendments

Append material changes and their reasons; preserve the original request and settled decisions.
- 2026-11-12 resolve: Q-01 → D-06 and Q-02 → D-07; PL-07 and PL-09 now name the convention, the folder rule and a junction test.
- 2026-11-12 review (plan3-advisor, gpt-6-astra), each finding checked against the code:
  - Finding 1, /link/ bodies capped at 64 KB: accepted. hub.ts:46 PAGE_BODY 65,536 and hub.ts:283 apply it to /link/*; test-link.mjs bypasses HTTP. Added PL-07a and Q-04 (the limit decides the cap).
  - Finding 2, COMM bump breaks test-remote.mjs: accepted. Lines 164-181 hardcode comm 1 and use 2 as the mismatch; PL-06 and Global validation now cover it.
  - Finding 3, picker merges same-named projects: accepted. PL-00 keys by basename; PL-05 groups by full folder and shows the parent path for duplicates.
  - Finding 4, incoming from and to records unchecked: accepted. link.ts:144-152 derives the target from the stored link today; Approach and PL-04 now check both, PL-06 tests forged records and a 2 by 2 matrix.
  - Finding 5, inbox writes through a junction and name collisions: accepted. PL-08 checks the inbox real path and writes with wx plus a random suffix (images.ts pattern); PL-09 tests both.
  - Finding 6, 3 s forward deadline versus large uploads: accepted. link.ts:14 DELIVER_MS 3 s, fetch 15 s; how the sender is told is a user choice, so Q-03 blocks Phase 2.
- 2026-11-12 resolve: Q-03 → D-08 (upload first by a separate /link/file op, then the text) and Q-04 → D-09 (5 MB total per message). Checked pi-intercom broker.ts: unconfirmed sends fail after 5 s, so D-08 adds a late "delivered after all" or failure message (agent proposal). PL-07a now adds /link/file instead of raising the deliver cap; PL-07 to PL-09 follow.
