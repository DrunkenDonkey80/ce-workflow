# Work-Ideate — ce-ideate Integration + Scored Ideas Dashboard

```yaml
status: plan
type: feature-plan
created: 2026-09-06
source: user request 2026-09-06 (chat) + analyzer-list UX precedent (k-mtluv0mx/k-mtlv5zuu); ce-ideate integration confirmed as the primary goal
```

## Goal capsule

**Primary: integrate upstream `ce-ideate` into the compound-source sync**
the same way ce-brainstorm/ce-plan/etc. are integrated — translator source,
policy workflow entry, sha256-verified closure, generated private playbook
— and make it the ideation prompt that `/work-ideate` runs internally.
On top of it: an agent-driven, scored, dashboard-first flow —
ask Narrow or Wide (Wide = 3 background divergent agents), run the
c-ideate-derived playbook internally, then render an **Ideas** section — a looping
list sorted by 0-100 confidence, color-coded (green >70, yellow 30-70,
red <30), several-line rows, Enter for full details — with per-idea actions
**Go back / Brainstorm / Reject / Delete** and chat-editable descriptions.
Brainstormed and rejected ideas persist but hide behind trailing toggles;
later ideate runs never re-propose rejected ideas.

## Current state (verified 2026-09-06)

| Piece | Where | Today |
|---|---|---|
| Ideate command | `extensions/work-models.js` `workIdeateDir`→`buildWorkIdeateState` (~L17558-18400) | topic → epic → `ideationHandoffPrompt`: "roughly 20 ideas, ~7 top picks accepted, rest contenders" — **no numeric score**; ideas saved as `wo:idea` children with `source-run-id`/`source-index` |
| Dashboard | same block, `parseWorkIdeateArgs`/`resolveIdeaTarget` | numeric-index list guarded by `.ce-workflow/work-ideate/dashboard.json` snapshot; actions accept/reject/discuss/inspect/import (`IDEA_ACTIONS` L17536) |
| Statuses | `deriveIdeaStatus`/`ideaActionHint` | raw/accepted/contender/discussed/brainstormed/planned/… rejected exists with accept-back path |
| 3-agent pattern | `CREATIVE_MODES`/`DIVERGENT_FRAMES` (~L670-690), packaged advisor launch (~L4194-4246) | off/ask/auto; ask = "Quick or Wide"; auto = 3 isolated divergent branches |
| Analyzer list UX | `handleWorkReviewAnalysisCommand` (~L24660) | looping `showListDialog`: colored `labelSegments`, Space toggles, Enter → details + choose() loop, trailing accept-all/discard-all, discarded stay gray and never resurface |
| Delete | — | **no `deleteWorkflowWorkItem` exists**; only status transitions |
| Tests | `scripts/test-work-ideate.mjs` (283 lines) | capture/parse/dashboard-index coverage |
| CE skill sync | `work-compound-source-policy.json` + `work-compound-catch-up.js` + `generate-work-private-workflows.mjs` | pins EveryInc/compound-engineering-plugin @ v3.21.0 (provenance v3.21.4); translates exactly 9 upstream skills into private playbooks — **`ce-ideate` exists upstream (55KB SKILL.md + references/ + scripts/, present already at v3.21.0) but is NOT in the synced set**; ideation today is the inline hand-rolled prompt |

## Design decisions (defaults; veto any)

1. **Ideation prompt = translated `ce-ideate` playbook** (new
   `extensions/private-workflows/ideate.md`), generated and verified like the
   other 9; the inline `ideationHandoffPrompt` body is replaced by a pointer
   to the playbook plus the machine contract (schema v2 JSON).
2. **Top 20**: main list shows the top 20 by score; overflow (if any) sits
   behind a trailing "Show all (N)" toggle. Generation target rises to
   "roughly 20-30 ideas".
3. **Merge**: exact `normalizedIdeaTitle` fingerprint merges within and
   across runs (max score, `merged-from` note). Near-duplicates are NOT
   force-merged (brainstorm policy refuses fuzzy auto-merge); agents tag
   each idea with an `area:` label and the list groups adjacent areas.
4. **Delete** = new store op that removes the `wo:idea` work item record
   permanently. No tombstone — `rejected` already covers
   compare-later-without-showing.
5. **Brainstorm button** reuses the existing `/wo → Brainstorm idea <id>`
   flow verbatim (backlink → derived status `brainstormed` → hidden behind
   the toggle). Optional text appends to the brainstorm topic prompt.

## Units

### U0 — Integrate upstream ce-ideate into the compound-source sync (the main thing)

- Extend `scripts/generate-work-private-workflows.mjs`:
  `IDEATE_SOURCE = "skills/ce-ideate/SKILL.md"`, `WORKFLOW_SOURCES.ideate`
  with closure prefix `skills/ce-ideate/`; translation rules for the 55KB
  source — strip pi discovery frontmatter/executable helpers, preserve the
  upstream ideation method (lenses/divergence/scoring approach it ships),
  adapt the output to our `ideas[]` schema-v2 JSON capture contract
  (score 0-100 + area + title + summary per idea).
- `work-compound-source-policy.json` `workflows[]` += `ce-ideate`;
  regenerate `work-compound-inventory.json` and
  `extensions/private-workflows/{manifest,provenance}.json` + the new
  `ideate.md` via the existing generator flow (sha256 closures verified).
- `extensions/work-models.js`: `ideationHandoffPrompt` now points the
  orchestrator at the private ideate playbook (same pattern as the
  brainstorm/plan handoffs) while keeping the machine-capture contract
  lines; `/work-ideate` unchanged from the caller's view.
- Reconcile the v3.21.0 (policy/inventory) vs v3.21.4 (provenance) drift in
  the same pass so all three pin one release.
- Files: `scripts/generate-work-private-workflows.mjs`,
  `extensions/work-compound-source-policy.json`,
  `extensions/work-compound-inventory.json`,
  `extensions/private-workflows/*`, `extensions/work-models.js`.
- Tests: `scripts/test-work-private-workflows.mjs` — ce-ideate closure
  verification, manifest hash round-trip, policy workflow list matches the
  10 generated workflows; `scripts/test-work-ideate.mjs` — handoff prompt
  references the playbook and still carries the capture contract.

### U1 — Scored capture contract (schema v2)

- `parseIdeationIdeas`: read `score` (int, clamp 0-100, derive default from
  status), read `area` (single token).
- `IDEA_SCHEMA_VERSION` bump; note line gains `score=` and `area=`.
- Handoff (now U0's playbook pointer): "roughly 20-30 ideas, score each
  0-100 confidence, tag one area each, no topPicks".
- Cross-run fingerprint merge in `captureIdeationIdeas`: same-fingerprint
  existing idea → keep, bump score to max, append merge note; new run ids
  recorded.
- **Ingest suppression**: ideas whose fingerprint matches an existing
  `rejected` idea are parsed but not saved (counted as `suppressed`).
- Files: `extensions/work-models.js`.
- Tests (`scripts/test-work-ideate.mjs`): score parse/clamp/derive; schema
  v2 note round-trip; cross-run merge keeps max score; rejected fingerprint
  suppressed on next run; recovery path unchanged.

### U2 — Front door: Narrow or Wide

- `/work-ideate <topic>` first asks via `ask_user`/`choose`: **Narrow**
  (single in-session ideation pass, current behavior) or **Wide**
  (3 background agents, one per `DIVERGENT_FRAME`, each returning `ideas[]`
  JSON; harvested, then merged/grouped by U1 logic).
- Wide reuses the packaged 3-branch background launch machinery; each agent
  gets the topic + its frame prompt + the schema-v2 JSON contract.
- `buildWorkIdeateState` gains `agents: narrow|wide` and run telemetry
  (`agentCount`).
- Files: `extensions/work-models.js`.
- Tests: arg/state wiring for narrow vs wide; merge of three agents' outputs
  with one overlapping fingerprint produces one idea (max score) and
  per-area grouping order.

### U3 — Ideas dashboard (scored, color-coded, toggled)

- Rewrite the dashboard list on `showListDialog` (analyzer pattern):
  - items sorted score desc; `labelSegments` `[score] title` colored
    `success` (>70) / `warning` (30-70) / `error` (<30); several-line
    description = idea summary (`descriptionMaxLines`);
  - Enter → `ctx.ui.editor` full details (description + metadata + status);
  - trailing rows: `Show brainstormed (N)`, `Show rejected (N)`,
    `Show all (N)` (only when N > 0 / overflow) — in-loop toggles that
    redraw with those groups appended (dim rows), mirroring the analyzer's
    category headers;
  - snapshot `dashboard.json` still pins numeric indexes (extend entries
    with score).
- Files: `extensions/work-models.js`.
- Tests: ordering + color thresholds (70/30 boundaries); toggle groups
  appear/disappear; brainstormed/rejected absent from the main body;
  snapshot round-trip with score.

### U4 — Per-idea action loop + description editing + delete

- Details view → `choose()` loop with buttons:
  - **Go back** — return to list;
  - **Brainstorm** — confirm dialog with optional freeform text (checkbox
    pattern from ask-user) → existing brainstorm flow on the idea; idea
    disappears from main list (status brainstormed);
  - **Reject** — existing reject action; hidden to `Show rejected`;
  - **Delete** — confirm once, then permanently remove the record;
  - **Discuss in chat** — existing discuss follow-up; the prompt authorizes
    the main agent to update the description through the new
    `/work-ideate <target> edit <text>` action and the loop reflects it.
- `IDEA_ACTIONS` += `edit`, `delete`; new `deleteWorkflowWorkItem(cwd, id)`
  store op (filter + write; refuses non-idea items or items with children).
- Files: `extensions/work-models.js`.
- Tests: action transitions (raw→brainstormed hidden, raw→rejected hidden
  - suppressed next run, raw→deleted gone); edit updates description and
  survives reopen; delete refuses ideas with linked children (safety).

## Non-goals

- No fuzzy auto-merge of near-duplicate ideas (grouping only).
- No change to brainstorm/plan flows themselves.
- No new persistence format — ideas stay `wo:idea` work items.

## Verification

- `node scripts/test-work-private-workflows.mjs` green with ce-ideate
  closure + manifest cases (U0).
- `node scripts/test-work-ideate.mjs` green with all new cases.
- `node scripts/verify-package.mjs` full gate green (suites already wired in
  the hardcoded test list — confirm, else add).
- Manual: `/work-ideate <topic>` wide run on a scratch topic, exercise all
  four buttons and both toggles; confirm the ideation output visibly follows
  the ce-ideate playbook's method.
