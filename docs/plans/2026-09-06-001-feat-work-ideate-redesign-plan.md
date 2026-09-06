# Work-Ideate — ce-ideate Integration + Scored Ideas Dashboard

```yaml
status: implemented
type: feature-plan
created: 2026-09-06
revised: 2026-09-06 (v2 — Opus-5 adversarial review + user decisions: top-20 only, agent-side semantic merge, delete on list rows, idea-as-file-in-epat)
revised: 2026-09-06 (v3 — second Opus-5 pass: pinned edit/target grammar + emitter/test migration, global top-20 trim with zombie cleanup, work-dialogs row-action key, ideate sidecar variant + cwd threading, schema range check, documentLinks write path)
source: user request 2026-09-06 (chat) + analyzer-list UX precedent (k-mtluv0mx/k-mtlv5zuu); ce-ideate integration confirmed as the primary goal
```

## Goal capsule

**Primary (done): integrate upstream `ce-ideate` into the compound-source sync**
— shipped in U0 (commit `d777472`): policy pinned v3.23.4, 10 translated
workflows including `extensions/private-workflows/ideate.md`, sha256-verified.
On top of it: an agent-driven, scored, dashboard-first flow — ask Narrow or
Wide (Wide = 3 background divergent agents, merged agent-side), run the
ce-ideate playbook internally via `dispatchPrivateWorkflow`, then render an
**Ideas** dashboard — the **top 20 only** by 0-100 confidence, color-coded
(green >70, yellow 30-70, red <30), multi-line rows, Enter for full details
— with per-idea actions **Go back / Brainstorm / Reject / Delete**,
delete directly on list rows, chat-editable descriptions, and
brainstormed/rejected ideas hidden behind trailing toggles. Later ideate runs
never re-propose rejected ideas. Brainstormed ideas attach to their epic as an
optional file, like plan attachments.

## Current state (verified 2026-09-06, post-d777472)

| Piece | Where | Today |
|---|---|---|
| CE skill sync | `work-compound-source-policy.json` + `work-compound-catch-up.js` + `generate-work-private-workflows.mjs` | **done**: pins v3.23.4, translates 10 workflows incl. `ideate.md` |
| Ideation handoff | `extensions/work-models.js` `ideationHandoffPrompt` (~L17884) | points at the playbook; contract line now demands score 0-100 + area, agent-side similar-idea merge, top-20 capture, no topPicks (live fix, this session) |
| Playbook dispatch | `work-private-workflows.js` AUTHORITIES (~L48-83) | brainstorm/plan have `work-models:wf:*:v1` tokens; **no `ideate` token — the handoff cannot inline the playbook yet** |
| Ideate command | `work-models.js` `buildWorkIdeateState` (~L17558-18400), handler (~L28637) | fire-and-forget: build state → `notify` → follow-up; no interactive `ctx` handler exists |
| Arg grammar | `parseWorkIdeateArgs` (~L17664) | action = **last** token; `edit <text>`/`wide` keywords unparseable |
| Dashboard | same block, `writeIdeaSnapshot`/`resolveIdeaTarget` | numeric-index text list guarded by `dashboard.json` snapshot; actions accept/reject/discuss/inspect/import |
| Statuses | `deriveIdeaStatus`/`ideaActionHint`; `parseIdeationIdeas` (~L17797) | raw/accepted/contender/discussed/brainstormed/planned; `accepted` derives from topPicks (to be removed) |
| 3-agent pattern | `CREATIVE_MODES`/`DIVERGENT_FRAMES` (~L670-690), `creativeSidecarStep` (~L4261-4300) | prompt-text machinery: tells the agent to spawn divergent subagents; **extension never harvests them** |
| Analyzer list UX | `handleWorkReviewAnalysisCommand` (~L24648) | looping `showListDialog`: colored `labelSegments`, Space toggles, Enter → details + choose() loop, trailing toggles |
| Delete | `work-store.js` `deleteWorkItem` (~L808) | **exists** — validated, refuses referenced items; not wired to `/work-ideate` |
| Row descriptions | `work-dialogs.js` | `item.detailLines` renders per-row multi-line text; `descriptionMaxLines` is a single highlighted-row Details pane |
| Tests | `scripts/test-work-ideate.mjs` | asserts status-grouped text output and `ideaSchemaVersion: 1` fixtures |

## Design decisions (user-confirmed)

1. **Playbook runs in-process**: new authority token
   `work-models:wf:ideate:v1`; handoff inlines playbook bytes via
   `dispatchPrivateWorkflow("ideate", …)` — same pattern as brainstorm/plan.
   No repo-relative paths in handoff text.
2. **Top 20 only**: generation targets 20-30 ideas, capture trims to the
   top 20 by score. The rest is dropped — no overflow storage, no "Show all".
3. **Merge is agent-side, identity is hash-side**: the capturing agent merges
   semantically similar ideas (e.g. "hero page with banner" ≡ "hero page with
   red banner") into one entry, max score, before emitting JSON. The extension
   never fuzzy-merges; it keeps exact-title dedup and rejected-suppression via
   a **full-title fingerprint** (sha256 of the normalized FULL title, stored in
   idea metadata at capture time — immune to display truncation). If agent-side
   merging proves unreliable in practice, drop merging entirely (user-accepted
   fallback); exact fingerprints stay for identity either way.
4. **Delete reuses `deleteWorkItem`** (already refuses referenced items).
   Available both as a direct row action on the list (confirm once) and in the
   details loop. No new store op, no raw filter+write.
5. **Idea attaches to its brainstorm epic as an optional file** via the
   existing `documentLinks` mechanism: the brainstorm flow writes the idea
   file and links it with `updateWorkItemNative(cwd, epicId, { documentLinks:
   { idea: ideaFile } })`; the dashboard derives `brainstormed` by scanning
   epics for `documentLinks.idea` (read back by `issueArtifactPaths`), and
   the old `brainstormId`/`brainstormPath` chain in `deriveIdeaStatus`
   (~L7754) is retired in the same unit. No backlink parsing.
6. **Leading-token grammar**: `wide`/`narrow` and actions (`edit`, `delete`,
   `accept`, …) parse from the **first** token; the rest is target/topic text.

## Units

### U0 — Integrate upstream ce-ideate into the compound-source sync — DONE

Shipped as `d777472` (2026-09-06): policy v3.23.4, 10 workflows, generator
closure + tests, allowlist/parity/owned-outputs updated. Not re-scoped here.

### U1a — Dispatch authority + stable fingerprints + arg grammar (unblocks everything) — DONE

- `extensions/work-private-workflows.js`: AUTHORITIES +=
  `["work-models:wf:ideate:v1", { caller: WORK_MODELS_CALLER, workflows:
  new Set(["ideate"]), callerUrl: import.meta.url }]` (the token binds to the
  workflow KEY; ALLOWLIST already maps `ideate → ideate.md`); verifyAuthority
  passes it.
- `extensions/work-models.js` `ideationHandoffPrompt`: replace the
  playbook-path sentence with `dispatchPrivateWorkflow("ideate", { actionToken,
  … })` inlined bytes (brainstorm pattern at ~L18293).
- `captureIdeationIdeas`: compute and store `titleFingerprint` (sha256 of
  normalizedIdeaTitle of the FULL title, before any truncation) in idea
  metadata. Cross-run exact dedup and rejected-suppression compare
  fingerprints, never stored titles. Pre-U1a ideas without a stored hash fall
  back to hash-of-stored-title at read time (best effort — suppression
  degrades gracefully, never crashes). Consolidate `titleFingerprint` vs
  `normalizedIdeaTitle` call sites into one helper (~L17566).
- `parseWorkIdeateArgs` pinned grammar: first token = action (an
  `IDEA_ACTIONS` member or `wide`/`narrow`); for `edit`/`delete` the target is
  the **second token only** (numeric index, `IDEA-3`, or exact id — titles are
  not addressable, killing the target-vs-text ambiguity); for `edit` the
  remaining tokens are the new description text. `IDEA_ACTIONS` += `edit`,
  `delete`. Migrate every trailing-action emitter and test to the leading
  form in this unit: call sites ~L17753 (`inspect`), ~L18400/18416/18427
  (`discuss`/`inspect`), `/wo` placeholder ~L24829; tests ~L139-165, 249-262
  in `scripts/test-work-ideate.mjs`.
- Files: `extensions/work-private-workflows.js`, `extensions/work-models.js`.
- Tests: authority dispatch for ideate; fingerprint dedup survives a long
  title that displays truncated; rejected fingerprint suppressed on next run;
  grammar: `/work-ideate edit IDEA-3 new description text`,
  `/work-ideate wide hero page`.

### U1 — Scored capture contract (schema v2) — DONE

- `parseIdeationIdeas`: read `score` (int, clamp 0-100, default derive),
  `area` (single token); drop topPicks parsing — every captured idea is
  `contender` unless accepted via dashboard action. Update
  `IDEA_STATUS_ORDER`/`ideaActionHint` accordingly.
- `IDEA_SCHEMA_VERSION` → 2, and `isIdeaIssue` accepts version 1 or 2
  (range, not equality — schema-1 ideas stay identified); note line gains
  `score=`/`area=`. Keep `accepted` in `IDEA_STATUS_ORDER` (accept and
  accept-back still produce it); only topPicks parsing is removed.
- Capture trims **globally**: fingerprint-merge the new run into the epic's
  existing ideas, keep the top 20 by score, and permanently remove the
  dropped `wo:idea` records via `deleteWorkItem` — no invisible epic children.
  Dashboard cap = the same 20.
- Files: `extensions/work-models.js`.
- Tests: score parse/clamp/derive; schema-v2 round-trip; **migrate existing
  fixtures** (`ideaSchemaVersion: 1` → 2, ~L38) and the status-grouped text
  assertions (~L129-141); rejected suppression (from U1a) re-verified here.

### U2 — Front door: Narrow or Wide (agent-side orchestration) — DONE

- `/work-ideate [wide|narrow] <topic>`: leading keyword wins; without one, TUI
  asks via `showListDialog` (purpose line, two options, keyboard filter;
  non-TUI → `nativeListDialog`); agent-issued/menu invocations without a
  keyword default to `narrow` (never block a non-interactive caller).
- Wide = the handoff instructs the orchestrating agent to launch 3 divergent
  subagents via an **ideate-shaped variant** of `creativeSidecarStep` (drop
  its merge-into-artifact / `wo:divergent-analysis` / post-hoc critics text;
  keep the 3-frame launch), then **merge their outputs and semantically
  similar ideas into one top-20 schema-v2 JSON** before one
  `captureIdeationIdeas` call. The extension never harvests subagent output —
  single capture, no fan-in code.
- Thread the sidecar's real inputs: `ideationHandoffPrompt` gains `cwd` +
  model-health preflight (mirror the brainstorm branch's
  `brainstormAgentHealthPreflight` ~L28690) so the variant receives
  `offlineModels`/`currentModel`.
- `buildWorkIdeateState` gains `agents: narrow|wide` + `agentCount` telemetry.
- Files: `extensions/work-models.js`.
- Tests: keyword + dialog + default wiring; state fields; prompt contains the
  merge instruction for wide.

### U3 — Ideas dashboard (interactive handler, scored, color-coded, toggled) — DONE

- New `handleWorkIdeateCommand(ctx, pi)` async handler replaces the
  fire-and-forget notify path **but keeps** `withCommandTelemetry`,
  `cleanupBenignInstructionDirt`, and `stateTelemetry` from the live branch
  (~L28637-28643); agent-issued non-interactive actions (`<id> reject` etc.)
  stay dialog-free; `/wo` menu row (~L24820) rewritten to the new contract.
- List = `showListDialog` (analyzer pattern):
  - sorted score desc, top 20; rows carry `labelSegments` score chip colored
    `success` (>70) / `warning` (30-70) / `error` (<30) — **leave `item.color`
    unset** so the selected-row accent survives;
  - per-row multi-line summary via `item.detailLines` (NOT
    `descriptionMaxLines`, which is a single highlighted-row pane);
  - **Delete as a direct row action**: add a generic per-row action-key hook
    to `work-dialogs.js` (e.g. `rowAction: { key: "d", label: "Delete" }`,
    honoring the Dialog UX Rule; confirm once → `deleteWorkItem`).
    `spaceAction` keeps its toggle semantics — do not reassign it;
  - Enter → full details (`ctx.ui.editor` or details pane);
  - trailing toggles `Show brainstormed (N)` / `Show rejected (N)` (dim rows);
    rejected group rows offer **accept-back** (restore);
  - snapshot `dashboard.json` pins indexes over the **full ordered list** —
    hidden rows keep their index; toggles only reveal (no stale-index risk).
- Dialog UX acceptance criteria (from AGENTS.md): one muted purpose line,
  Escape → parent / close at root, Enter and Space semantics preserved,
  keyboard filter where lists are long, native fallback verified.
- Files: `extensions/work-models.js`, `extensions/work-dialogs.js`
  (row-action key hook).
- Tests: ordering + 70/30 color boundaries; toggle groups; brainstormed/
  rejected absent from main body; snapshot index stability across toggles;
  delete row action removes idea and refuses referenced ones.

### U4 — Per-idea action loop + description editing + brainstorm attachment — DONE

- Details → `choose()` loop: **Go back** / **Brainstorm** / **Reject** /
  **Delete** / **Discuss in chat**.
- Brainstorm = two-step confirm: `showListDialog` (Go / Go with extra text /
  cancel) then `ctx.ui.editor` for the optional text when chosen (work-dialogs
  exports no text-field dialog; this is the established editor precedent
  ~L24611). Runs the existing brainstorm flow; the new epic stores the idea as
  an optional file/attachment (decision 5); dashboard hides the idea behind
  `Show brainstormed` by scanning epics for the attachment.
- Reject = existing action → hidden to `Show rejected`, restorable there,
  fingerprint-suppressed in future runs.
- Delete = confirm once → `deleteWorkItem`.
- Discuss = existing follow-up; authorizes the main agent to update the
  description via `/work-ideate <target> edit <text>` (U1a grammar); loop
  reflects it.
- Files: `extensions/work-models.js`, `extensions/work-store.js` (only if the
  epic-attachment write needs a helper).
- Tests: raw→brainstormed hidden + epic attachment present; edit updates
  description and survives reopen; delete flow end-to-end; accept-back from
  rejected restores visibility and future re-capture.

## Non-goals

- No fuzzy merge in extension code (agent-side only; fallback = none).
- No storage beyond the top 20 (excess is dropped, per user decision).
- No change to brainstorm/plan flows themselves beyond the optional
  idea-file attachment.

## Verification

- Implemented and verified 2026-09-06: `node scripts/test-work-ideate.mjs`
  (authority dispatch, fingerprints, grammar, schema v2, trim, dashboard,
  handler dialogs, headless default), `node scripts/test-work-brainstorm.mjs`,
  `node scripts/test-work-dialogs.mjs`, `node scripts/test-work-private-workflows.mjs`
  (61 checks, zeroSurface=true), and the full `node scripts/verify-package.mjs`
  gate all green; plus a disposable temp-repo end-to-end run (store seed →
  wide handoff → 25-idea capture trimmed to top 20 → snapshot → dialog
  reject/suppress/accept-back/recapture → brainstorm attachment → edit →
  delete → headless narrow → clean git commit) passing all checks. Deviation:
  legacy `brainstormId`/`brainstormPath` metadata keys stay valid brainstormed
  indicators in `deriveIdeaStatus` alongside the new `brainstormEpicId`/
  `ideaFile` keys — retiring them outright would break the existing
  brainstorm flow, which is an explicit non-goal to change.

- `node scripts/test-work-private-workflows.mjs` green (ideate dispatch case).
- `node scripts/test-work-ideate.mjs` green with all new cases.
- `node scripts/verify-package.mjs` full gate green (new `test-work-*` suites
  auto-glob — no manual wiring).
- Manual: `/work-ideate wide <scratch topic>` end-to-end — dialog, 3-agent
  run, merged top-20 capture, all row/details actions, both toggles,
  accept-back, edit round-trip; non-TUI fallback smoke; Dialog UX checklist
  (purpose line, Escape semantics, native fallback).
