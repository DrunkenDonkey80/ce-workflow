---
plan3: true
status: ready
created: 2026-10-23
updated: 2026-10-24T06:23:41.603Z
reviewed: 2026-10-23
---

# Wormhole uploads from chat file links

## Original request

Implement the approved handoff at C:\Users\Flex\AppData\Local\Temp\wormhole-upload-handoff.md. Right-click a hub chat file link to Upload, Zip and upload, or (when installed) 7z and upload. Copy the encrypted Wormhole link after completion, showing progress. Run targeted offline and live compatibility checks, add a changelog bullet, and do not push.

## Goal, requirements, and non-goals

- Own upload code using exact wormhole-crypto 0.3.1, MIT licensed; never depend on the unlicensed ziuchen client.
- Fixed 24-hour lifetime, unlimited downloads, no pre-upload prompts. Encryption key only in URL fragment.
- Files only, maximum 5e9 bytes. Archive first when requested; clean temporary data after success or failure.
- Upload path authorization must match Download, including remote restrictions.
- Keep existing local commit b5ff78f and unrelated dirty diagram/archive changes intact. No push or unrequested commit.
- No folders, configurable transfer settings, or alternate providers.

## Decisions

All listed behavior is user-approved in the handoff; do not ask again. Use Wormhole's undocumented site API and official crypto instead of copying an unlicensed client. The old client may only be used for compatibility verification. Windows Zip uses System32 bsdtar, Linux requires zip. Locate 7z, 7zz or 7za with existing findCommand.

## Open questions

### Blocking

None.

### Deferred

None.

## Relevant files and approach

- Root package.json and package-lock.json: exact crypto dependency.
- hub/src/wormhole.ts: encrypted disk spool, bounded piece uploads, retries, status jobs, cleanup, archive helpers.
- hub/src/api.ts: start and poll uploads; validate with linkedFile from hub/src/linked-files.ts.
- hub/web/app.ts: existing openFileMenu in both local and remote modes; cached 7z capability, progress, clipboard fallback.
- hub/scripts/test-wormhole.mjs: offline protocol and encryption self-check; existing test-api.mjs and test-browser.mjs for integration.
- CHANGELOG.md: Unreleased bullet and visible-control screenshots where practicable using existing changelog-shot.mjs.
- Read-only protocol reference: C:\Users\Flex\AppData\Local\Temp\wh\node_modules\@ziuchen\wormhole-client\dist. Handoff records room creation, metadata bencoding, B2 upload and finish sequence.

## Phases

### Phase 1: Implement approved upload flow [code]

- [x] **S1** Added wormhole-crypto 0.3.1 and hub/src/wormhole.ts disk-spooled upload worker
- [x] **S2** Added Download-authorized upload API and file menu items with progress and clipboard
- [x] **S3** Added test-wormhole and upload refusal/menu checks; targeted tests pass
- [x] **S4** Live plain, zip and 7z round trips matched bytes; temp folders removed
- [x] **S5** Added Unreleased changelog bullet; nothing committed or pushed
- [x] **S6** Archives keep the name literal (7z -spd, zip -nw); archive test proves only the picked file is packed
- [x] **S7** First failed piece stops new pieces; in-flight pieces settle before close/cleanup; mocked-fetch success and failure tests added
- [ ] **S8** Re-run node --test scripts/test-wormhole.mjs, scripts/test-api.mjs and scripts/test-browser.mjs in hub/ plus LSP diagnostics on hub/src/wormhole.ts.
### P-ARCH [code] Product architecture

- [ ] **ARCH-RECONCILE** Reconcile the product architecture diagram with this plan's actual changes.
  - Compare actual code and git history; update through plan3_diagram target product, or mark done with no architecture change.
  - Changed plan elements: none flagged; inspect actual implementation.


## Global validation

The three menu actions use the same authorized files as Download: the upload route calls linkedFile with the same remote flag as Download, and linkedFile's remote rules already have tests in test-browser.mjs. Offline tests cover bencoding, piece lengths and hashes, encryption, refused upload requests and the local menu labels. After S7 they also cover a mocked upload run: success, a failing piece, and temp cleanup. An archive holds only the selected file (S6). Live generated-file round trips prove compatibility when the service is up; plain, zip and 7z passed on 2026-10-23.

Not covered by automated tests: the remote (phone) page menu, the 7z item's visibility, and clipboard copy and its fallback. Wormhole API changes remain a documented risk.

## Resume context

Review added S6 to S8: literal archive names (7z -spd, zip -nw), upload stopping cleanly on the first failed piece with a mocked-fetch test, and the targeted re-run. S1 to S5 code is uncommitted and not pushed. Next: S6 in hub/src/wormhole.ts archive(). Before a push, bump to 0.1.74 and add a changelog screenshot.

## Amendments

- 2026-10-23 plan3 review (plan3-advisor), dispositions:
  - Finding 1, archive wildcards: accepted. 7z help lists -spd (disable wildcard matching), and `--` only stops switches and @listfiles. Info-ZIP also expands wildcards itself unless given -nw. Windows filenames cannot contain * or ?, so this only affects Linux and macOS. Not reproduced. Added S6.
  - Finding 2, uploads continuing after a failure: accepted. In hub/src/wormhole.ts, Promise.all rejects on the first failed worker while the others keep going. They can overwrite the job's "Failed" status with "Uploading x%" and read from the closed file handle. Added S7.
  - Finding 3, validation narrower than claimed: partly accepted. Global validation overstated "frontend behavior" and now lists what is not tested. A mocked lifecycle test is added in S7. Rejected: separate remote-page and clipboard browser tests. Both menus use the same uploads list, and remote authorization reuses linkedFile with the remote flag, which already has tests. The browser clipboard can't be checked meaningfully headless. S3 stays done because its summary claims only what ran.
- 2026-10-23: Added S6, S7, S8 after S5: plan3 review: archive wildcard expansion and worker failure handling are real gaps; validation claims were broader than the tests.
- 2026-10-24: Added final architecture reconciliation because a product diagram exists.
