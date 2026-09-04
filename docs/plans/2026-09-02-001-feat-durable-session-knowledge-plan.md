# Durable Session Knowledge and Compaction Repair Plan

**Date:** 2026-09-02  
**Status:** E2 implementation and gates complete; sanitized compaction replay, behavioral A/B, and end-to-end regression gates remain open  
**Scope:** ce-workflow compaction, in-session context filtering/microcompact, session restart/resume, and explicit fact storage/search

## Executive decision

Do not build a general memory service.

Ship in this order:

1. **Repair deterministic compaction first.** Real autonomous summaries spend up to roughly half their text on repeated synthetic prompts and duplicated sections. Adding memory before removing that waste cannot meet the existing cost target.
2. **Add a small, explicit, append-only fact ledger.** Use two local JSONL files, deterministic lexical/path retrieval, one `/wo fact` command family, and one model tool with actions. Do not add SQLite, FTS, embeddings, a daemon, or a background observer.
3. **Inject retrieved facts into every context-loss seam.** Native compaction and microcompact use the shared formatter. The context hook regenerates one ephemeral fact block on each relevant model call, including active filtering and the first request after restart. This is safer than persisting a hidden session message: corrections take effect immediately, no injected block re-enters history, and streaming turns are never steered.
4. **Keep automatic extraction off until a held-out replay proves it.** The real logs support explicit capture and deterministic retrieval. They do not yet prove that any extractor is accurate enough, that recall causes better behavior, or that GLM, Opus, or another model is best.
5. **Treat policies and approved work decisions as existing durable channels.** Project/user policy belongs in loaded `AGENTS.md`; approved WorkItem decisions remain WorkItem `decision` records. The new ledger covers facts, procedures, dead ends, preferences, and correction history that do not fit either channel.

This is the smallest design supported by the evidence.

### Implementation checkpoint (2026-09-02)

Implemented:

- marker-based machine-continuation filtering plus a pinned latest-human-request fallback;
- regenerated-section removal, objective single-copying, volatile-key dedupe, file-op fallback, foreign knowledge-block stripping, and fifteen-generation stability checks;
- project/user JSONL ledgers with strict loading, append locking, `fsync`, valid-tail preservation, torn-tail repair, correction/rejection/expiry/binding resolution, secret rejection, and fingerprinted query caching;
- `/wo fact add|search|show|correct|forget|promote` and one constrained `knowledge` tool; model writes are capped and cannot alter human/verified claims;
- native compaction, F8 microcompact, ordinary-session, and active-filter injection, with correction replacement that leaves the frozen cut anchor unchanged.

Verified locally:

```text
node scripts/test-work-knowledge.mjs           -> ok (including eight-process append and 21-run 10k strict scan)
node scripts/test-work-knowledge-retrieval.mjs -> ok (sanitized held-out incident fixture)
node scripts/test-work-compaction.mjs          -> ok (including fifteen generations and saturation)
node scripts/test-work-goal.mjs                -> ok (command/tool/native/filter integration)
node scripts/test-work-microcompact-agent.mjs  -> ok (real Pi AgentSession harness)
node scripts/verify-package.mjs --quiet         -> ok
```

The named-host 21-run benchmark (`FlexPC`, Node v24.14.0, Intel Core Ultra 7 265K, local filesystem, 1,916,780-byte JSONL) measured a 33.4 ms strict-scan median and 0.08 ms cached-query p90. The committed sanitized incident fixture at `benchmarks/session-knowledge/v1/retrieval-cases.json` measured Recall@5 0.909, MRR 1.000, and unrelated retrieval 0.091.

Not yet satisfied: committed shingle/section compaction replay, behavioral A/B, and the aggregate calculator/redesign regression run. Automatic extraction remains off, and this feature must still be described as deterministic recall rather than proven mistake prevention.

---

## What was tested

### Corpus

Eight real Pi session logs were inspected, covering four projects and several execution modes:

| Session | Messages | Compactions | Main use |
|---|---:|---:|---|
| ce-workflow autonomous catch-up, 2026-08-27 | 4,269 | 97 | compaction churn and duplicated synthetic prompts |
| ce-workflow OpenDesign, 2026-08-31 | 3,922+ | 19 | repeated `od.exe` mistake and five-generation loss |
| ce-workflow verifier, 2026-08-21 | 1,898 | 51 | repeated machine continuations and foreground tax |
| ce-workflow microcompact, 2026-08-30 | 1,083 | 6 | microcompact/filter seam |
| ce-workflow regression, 2026-08-29 | 2,929 | 14 | user refutation of a locally green optimization |
| Belot UI work, 2026-08-21 | 2,296 | 9 | repeated visual preference/design correction |
| Nexus Android autonomous run, 2026-08-17 | 7,255 | 20 | long-running recovery |
| cmux monitor work, 2026-06-16 | 1,609 | 3 | contradictory hardware evidence and rollback |

The source logs remain outside the repository under `C:\Users\Flex\.pi\agent\sessions\...`; benchmark fixtures must be sanitized before they are committed.

### Test A — literal survival across real compactions

A replay script located the first source event and every later compaction containing the same literal.

| Incident literal | Later compactions | Later summaries containing it | Result |
|---|---:|---:|---|
| OpenDesign `GNU coreutils` | 18 | 0 | lost |
| OpenDesign `project recovery ignored` | 18 | 0 | lost |
| user correction `second time in a row` | 12 | 1 | lost well before five generations |
| regression `serious regression` | 2 | 2 | survived only because the session ended soon |
| Belot `random yet beautiful` / `not just colors` | 4 | 2 | partial survival; insufficient horizon |
| monitor `preset name before` | 2 | 0 in the survival replay | not enough generations for a memory conclusion |

The OpenDesign timeline is the strongest case: the GNU `od.exe` identity was discovered, five complete compaction generations elapsed, a sixth compaction boundary ran nine seconds before the user reported the same mistake, and no declarative claim survived.

**What this proves:** real conclusions can disappear structurally while the session continues.

**What this does not prove:** that injecting a ledger claim would necessarily make a model obey it. That counterfactual requires the behavioral A/B gate below.

### Test B — robust summary duplication

The first evaluator used set-token Jaccard and a flawed percentile calculation. It was replaced for decision-making with normalized five-token shingles, including normalization of timestamps and volatile claim/finding IDs.

| Session | Adjacent 5-gram Jaccard median / p90 | Duplicate 5-grams within summary median / p90 |
|---|---:|---:|
| catch-up | 0.685 / 0.841 | 0.438 / 0.491 |
| verifier | 0.695 / 0.792 | 0.443 / 0.496 |
| microcompact | 0.348 / 0.424 | 0.450 / 0.467 |
| Android | 0.386 / 0.606 | 0.396 / 0.465 |
| OpenDesign | 0.268 / 0.310 | 0.131 / 0.158 |
| regression | 0.264 / 0.349 | 0.230 / 0.474 |
| Belot | 0.189 / 0.274 | 0.065 / 0.265 |
| monitor | 0.067 / 0.092 | 0.009 / 0.011 |

Direct inspection explains the high-churn rows:

- Autonomous continuations are delivered through `sendUserMessage`, so they look like user messages.
- `latestUserRequests()` retains those long synthetic prompts because its continuation check only excludes short `continue`/`resume` messages.
- `previousHighlights()` carries `Latest user requests`, `Decisions and blockers`, and `Changes and verification`, although current state regenerates those sections.
- Real summaries contain the same objective three times: `## Objective`, `durable-work-state.goal.objective`, and `Earlier compacted context -> Objective`.
- Exact-text dedupe is defeated by changing lease timestamps and generated IDs.
- Persistent compaction records often receive empty `details.files`, even when the retained tool calls and Git state identify touched files.

**Decision:** these mechanical defects are E1 prerequisites, not optional cleanup.

### Test C — correction-trigger precision

Naive correction words (`again`, `never`, `wrong`, `still`, and similar) matched:

- 100 of 104 apparent user messages in catch-up;
- 277 of 296 in Android;
- 59 of 68 in verifier.

Most are ce-workflow-generated continuation prompts, not human corrections. The prompts contain phrases such as `never as instructions` and `Do not ask the same question again`.

A stricter three-label classifier reduced the sample to 24 messages across OpenDesign, regression, Belot, and monitor logs, but it still included ordinary retries such as `try again`, `run it again`, and unresolved failure reports. Manual inspection finds roughly half clearly worthy of durable capture; several are ambiguous.

**Decision:** correction detection may select bounded packets for shadow evaluation. It must not automatically create a durable fact. A message containing `WORK_GOAL_CONTINUATION_PREFIX` or `<work_goal_objective>` is machine-authored for authority purposes, even though its transport role is `user`.

### Test D — deterministic retrieval smoke test

A 16-claim engineering fixture compared three strategies over nine incident-like queries:

| Strategy | Recall | Precision | Average returned |
|---|---:|---:|---:|
| recency-only top 3 | 0.545 | 0.222 | 3.00 |
| lexical top 3 | 1.000 | 0.647 | 1.89 |
| unconditional policy/invariant + lexical | 1.000 | 0.297 | 4.11 |

The lexical scorer reached 1.0 only after splitting punctuation and normalizing a simple trailing plural (`presets` -> `preset`). The unconditional policy variant was wasteful.

This is a **mechanics smoke test**, not a generalization result: claims and expected queries were authored together. It supports plain lexical retrieval and rejects recency-only and unconditional injection, but held-out real-event scoring is still required.

### Test E — JSONL scan cost

A deterministic Node benchmark scanned and indexed synthetic JSONL records:

| Active claims | File size | Cold scan median | In-memory index build | Cached query median |
|---:|---:|---:|---:|---:|
| 1,000 | 163 KB | 1.70 ms | 3.21 ms | <0.01 ms |
| 10,000 | 1.65 MB | 11.33 ms | 20.14 ms | 0.01 ms |
| 100,000 | 16.66 MB | 114.65 ms | 188.48 ms | 0.01 ms |

The observed legacy Hermes store contains only 12 memory rows. JSONL is comfortably sufficient. SQLite/FTS is not justified for v1.

### Test F — lifecycle mechanics

An append-only prototype passed checks for:

- duplicate record collapse;
- correction via `supersedes`;
- rejection tombstones;
- newest-live resolution;
- stale-path handling;
- secret-pattern rejection.

These checks validate the ledger mechanics only. They do not validate extraction or behavioral usefulness.

### Existing repository checks

The current tree passed before plan finalization:

```text
node scripts/test-work-compaction.mjs  -> ok - work compaction policy
node scripts/test-work-goal.mjs        -> ok - work-goal helpers
```

---

## Proven facts about the current implementation

### Compaction is deterministic and model-free

`extensions/work-compaction.js` already has the right foundation:

- separate latest-user-request preservation;
- no reasoning-channel preservation;
- no successful payload replay for read/write/edit tools;
- bounded `recent` and `critical` records;
- one `fitSections()` budget pass;
- `previousHighlights()` with an explicit title allowlist.

The problem is what is selected and copied, not the lack of a second summarizer.

### Native compaction and microcompact share the formatter

The call graph converges on `formatCompactionSummary()`:

- native `session_before_compact` -> `buildCompactionContext()` -> formatter;
- `runNativeMicrocompact()` -> native compact hook -> formatter;
- in-session context filtering -> `prepareContextFilter()` -> formatter.

However, the in-session path stores one frozen `contextFilterState.summary`. A fact recorded, corrected, or rejected while that filtered window remains active will not appear in that frozen text. The fact block therefore needs a small dynamic path in `filteredContext()` rather than being baked only into the snapshot.

### Durable WorkItem state is incomplete outside a selected item

`buildCompactionProjection()` returns after Git state when no `targetId`; freeform also omits durable state without a parked goal. Existing project decisions are only visible within their sibling WorkItem scope.

The new feature must not depend on a selected WorkItem. Existing WorkItem decisions should still be projected where relevant, but they are not a substitute for local session knowledge.

### A previous memory store proves persistence, not product fit

The legacy Hermes SQLite schema stored sessions, messages, FTS indexes, and 12 memory rows. It also persisted a plaintext credential in message storage. Reusing that database would import dormant semantics and a demonstrated secret-retention risk.

The new ledger stores short validated claims only, redacts before persistence, and never imports raw transcripts.

---

## Data ownership

Use the existing durable channel when one fits:

| Knowledge class | Destination |
|---|---|
| standing project/user policy | project or global `AGENTS.md` after explicit promotion |
| approved work decision | existing WorkItem `decision` record |
| verification result | existing verification-proof contract |
| project fact, dead end, procedure, preference | project-local fact ledger |
| machine/user fact or preference | user-local fact ledger |
| raw evidence | existing session log; reference it, do not copy it |

This avoids one giant memory store and avoids duplicating approved decisions.

---

## Minimal ledger

### Paths

- User/machine scope: `~/.pi/agent/knowledge/claims.jsonl`
- Project scope: `<repo>/.ce-workflow/local/knowledge.jsonl`

The project path must be added to `.gitignore` in the same change that creates it. Neither file is automatically committed or synchronized. Explicit promotion is the only route into a loaded repository file.

### Append-only operations

Record:

```json
{"id":"k-01","op":"record","recordedAt":"2026-08-31T21:17:14Z","claim":"On this machine, od.exe on PATH is GNU coreutils, not OpenDesign.","kind":"environment","scope":"user","authority":"human","paths":["extensions/opendesign-client.js"],"symbols":["resolveOpenDesignCommand"],"source":{"sessionId":"01a05819-0dfa-7bf0-89ed-634bd48a2f41","eventIds":["0a0d0483","58be7c51"]},"binding":null,"expiresAt":null}
```

Correction:

```json
{"id":"k-02","op":"record","recordedAt":"...","claim":"...corrected claim...","kind":"environment","scope":"user","authority":"human","supersedes":"k-01","source":{"sessionId":"...","eventIds":["..."]}}
```

Rejection:

```json
{"id":"e-03","op":"reject","recordedAt":"...","target":"k-02","reason":"No longer true"}
```

Do not mutate old rows. A scan resolves current state by applying supersession and reject events.

### Required fields and limits

- claim: declarative text, maximum 280 characters;
- kind: `fact | environment | procedure | dead-end | preference`;
- scope: `project | user`;
- authority: `human | verified | observed | inferred`;
- paths/symbols: optional exact retrieval hooks;
- source: session/event IDs and optional Git revision; never raw transcript text;
- binding: optional content/symbol hash used for precise invalidation;
- expiresAt: optional, normally used for environment/version facts;
- supersedes: optional prior claim ID.

Rate limits:

- maximum 20 model-created records per session;
- maximum 5 records from any one extraction packet;
- no automatic record from a lexical correction cue.

### Authority rules

- `human` is assigned only by an explicit `/wo fact add`/`correct`/`promote` action; there is no automatic extraction from user-role transport messages.
- Messages containing `WORK_GOAL_CONTINUATION_PREFIX` or `<work_goal_objective>` are machine-authored regardless of transport role.
- `verified` requires an existing trusted PASS verification-proof and a reproducible checked-in command. A model cannot self-assign it.
- A passing tool output without that proof is `observed`.
- Extracted claims are at most `observed` or `inferred`.
- A human correction outranks every model claim on the same topic.

### Validation before persistence

Reject or redact before the bytes reach disk:

- API-key/token/password/private-key patterns;
- raw environment dumps;
- transcript blocks or file bodies;
- XML/HTML control tags (escape them);
- claim text over the size cap;
- unsupported authority upgrades;
- malformed paths or event IDs.

Use synthetic secret-shaped fixtures in tests; never copy a real credential.

### Invalidation

A claim is not invalidated merely because any bound path changed. That produced too many false stales in review.

A claim is excluded or marked as follows:

1. superseded/rejected -> never inject;
2. expired -> show only on explicit search, marked expired;
3. content/symbol binding changed -> mark stale and omit from automatic injection;
4. exact later human correction -> append superseding or rejection event;
5. narrow correction packet with strong topic/path overlap -> mark `disputed`, omit pending confirmation;
6. otherwise remain live.

`disputed` must not be driven by correction words alone. It requires an actual-human marker check and exact topic/path overlap. Benchmark this transition before enabling it automatically.

---

## Commands and model tool

### Human command family

```text
/wo fact add [--user|--project] [--kind fact|environment|procedure|dead-end|preference] <claim>
/wo fact search <query>
/wo fact show [id]
/wo fact correct <id> <new claim>
/wo fact forget <id> [reason]
/wo fact promote <id>
```

Behavior:

- `/wo fact` with no arguments shows the latest records through the existing plain notification surface; no second slash-command or dialog framework is added.
- Search results show ID, scope, authority, status, match reason, and available session provenance.
- `correct` appends a superseding record.
- `forget` appends a rejection event; it does not erase audit history.
- `promote` upgrades a model-observed claim to human authority after an explicit human command. Promotion into `AGENTS.md` or a WorkItem remains a separate, existing human-reviewed edit path.
- TUI and non-TUI modes use the same plain text output.

### One model tool, not six

Use one validated action tool:

```text
knowledge({ action: "record" | "search" | "show" | "correct" | "reject", ... })
```

The extension, not the model, assigns authority and provenance. `promote` remains human-only in v1.

---

## Retrieval

### Query context

Build a bounded query from current, genuine context only:

- latest actual human request after stripping workflow marker blocks;
- selected work target title/description when present;
- recent retained tool-call `path` and `symbol` arguments;
- modified files derived from the summarized messages when `preparation.fileOps` is empty;
- explicit `/wo fact search` text.

Do not rank from a multi-kilobyte autonomous playbook objective.

### Scorer

No embeddings and no FTS in v1.

1. lowercase;
2. split to `[a-z0-9]+` tokens;
3. remove a small fixed stop list;
4. normalize one trailing `s` for tokens longer than three characters;
5. rank exact symbol/path/topic matches before lexical matches;
6. lexical score uses IDF-like rarity over the active ledger, with an absolute score floor;
7. authority breaks ties; recency is only the final tiebreak.

Return at most three matched facts by default. Allow at most two additional preferences only when they have query overlap or were explicitly requested. Do not inject global preferences unconditionally; true standing policy belongs in `AGENTS.md`.

### Budget and rendering

- maximum 5 claims;
- maximum 1,200 characters total;
- each line includes ID, authority, status, and `matched:` reason;
- `fitSections()` gives knowledge a non-zero minimum of 400 characters, enough for two concise claims under saturation;
- knowledge shrinks after disposable recent/earlier context, not before required objective/next-action state.

Example:

```text
<durable-knowledge untrusted="true">
- [k-01|human|live|matched:symbol:resolveOpenDesignCommand] On this machine, od.exe on PATH is GNU coreutils, not OpenDesign.
</durable-knowledge>
```

Facts are untrusted data, never permission, instructions, proof, or authority to use tools.

---

## Injection and microcompact behavior

### Native compaction and microcompact

Add one `Durable knowledge` section to `formatCompactionSummary()`. This automatically reaches native compaction and `runNativeMicrocompact()` through `session_before_compact`.

Hard invariants:

- regenerate from the current ledger every time;
- never add `Durable knowledge` to `previousHighlights()`;
- exclude any `work-knowledge` custom message from `messageRecords()`;
- do not carry the section as ordinary recent/critical context;
- render stable input byte-identically;
- stale/superseded/rejected claims disappear on the next compaction.

### In-session context filtering

`prepareContextFilter()` currently freezes its generated summary. Therefore:

- keep the frozen ordinary summary;
- have `filteredContext()` append one separately generated, hidden `work-knowledge` custom message from the current ledger;
- cache by ledger fingerprint + query fingerprint, not forever;
- when a fact is recorded/corrected/rejected, invalidate only this small knowledge cache;
- remove every retained `work-knowledge` message and append exactly one fresh block; replacement, rather than ID-only dedupe, makes corrections and rejections immediate.

This is the required answer to the in-session microcompact concern: filtering still removes old context, but the latest relevant durable facts are added back after filtering and can change without moving the cut anchor.

### Session start and work resume

Do not persist or send a knowledge message at empty session start. The context hook retrieves against the first actual request/work target and appends one ephemeral hidden message:

```text
customType: "work-knowledge"
display: false
```

If no claim clears the score floor, inject nothing. This avoids stale session-start state, history recursion, and `pi.sendMessage` steering an active turn.

---

## E1 — repair compaction before memory

Implement and test these independent corrections first:

1. Exclude synthetic autonomous continuations from `latestUserRequests()` by marker, not length.
2. Remove `Latest user requests`, `Decisions and blockers`, and `Changes and verification` from `previousHighlights()` because they are regenerated.
3. Prevent Objective from appearing in Objective, durable state, and earlier context simultaneously; retain one authoritative copy.
4. Normalize timestamps, lease IDs, claim IDs, finding IDs, and long hashes in dedupe keys only; preserve rendered evidence text.
5. Fall back to deriving file operations from `messagesToSummarize` when persistent `preparation.fileOps` is empty.
6. Do not guess that `I responded...` is machine-authored: no stable producer marker was found. Filter only proven markers, and retain the previous `### Current` human request when a generation contains only machine continuations.
7. Add a five-generation feedback harness that passes each summary as the next `previousSummary`.
8. Measure per-section characters and normalized five-token-shingle duplication.

### E1 gate

On the real sanitized catch-up and verifier fixtures:

- no regenerated section is copied into Earlier context;
- objective has one authoritative representation;
- machine continuation prompts do not enter Latest user requests;
- required latest request, next action, durable state, and critical errors still survive;
- within-summary duplicate five-token ratio improves by at least 50% from the recorded median baselines (0.438 catch-up, 0.443 verifier);
- adjacent-summary p90 materially improves from 0.841 catch-up and 0.792 verifier;
- no existing compaction/goal test regression.

Do not claim optimization success until the same end-to-end benchmark is rerun and all continuation sessions are aggregated.

---

## E2 — explicit fact ledger and deterministic recall

Implement only:

- two JSONL stores;
- append-only lifecycle;
- validation/redaction;
- `/wo fact` command family;
- one `knowledge` action tool;
- deterministic retrieval;
- first-request, resume, native compaction, microcompact, and dynamic context-filter injection;
- precise supersession/rejection/expiry/binding invalidation.

No extractor in E2.

### E2 gate

- JSONL round-trip and crash-safe append;
- fingerprint dedupe;
- correction and rejection chains;
- secret rejection before write and before rendering;
- model cannot write `human` or `verified` authority;
- continuation-marked pseudo-user messages cannot become human claims;
- stale/superseded/rejected claims are never automatically injected;
- knowledge appears exactly once after each of five compaction generations and after restart;
- a correction during an active filtered window appears on the next context event without moving the cut anchor;
- top-5 held-out retrieval Recall >= 0.90 and MRR >= 0.85;
- unrelated injected claims <= 10%; returning zero is valid;
- on a named host and filesystem, 21-run 10,000-claim strict-scan median remains <=50 ms and cached-query p90 remains <=2 ms; record Node version, CPU, filesystem, file size, median, and p90.

---

## E3 — extraction research, shadow only

Before enabling any automatic write, commit a sanitized benchmark:

```text
benchmarks/session-knowledge/v1/
  corpus.jsonl
  cases/<case-id>/source-events.jsonl
  cases/<case-id>/state-before.json
  cases/<case-id>/ledger.jsonl
  cases/<case-id>/expected.json
  results/<revision>/<model>-<trial>.json
scripts/run-session-knowledge-replay.mjs
scripts/score-session-knowledge-replay.mjs
```

### Minimum corpus before extractor selection

- 40 durable positive packets;
- 20 ambiguous/non-durable negative packets;
- at least 8 sessions and 4 projects;
- at least 10 corrections, 10 verified fixes, 5 dead ends, and 5 preferences;
- all evidence-bearing event types, including tool-call arguments, proof/state events, and instruction sources;
- split by whole session, never random rows;
- 20% independently double-labelled with disagreement adjudication;
- no event after a replay cutoff available to extraction or retrieval.

Use correction detection only to nominate candidate packets. Explicitly include negative examples such as ordinary `try again`, generated work-goal prompts, and unresolved `still failing` reports.

### Blind model comparison

Run the same bounded packet and schema through the configured candidate models, including Opus and GLM. Do not preselect a winner by price or reputation.

Acceptance on held-out sessions:

- macro precision >= 0.90;
- macro recall >= 0.80;
- scope/kind/authority accuracy >= 0.95;
- unsupported `verified` upgrades = 0;
- secrets persisted or dispatched = 0;
- maximum 20 extraction calls per session, failing closed;
- extractor failure cannot block foreground work.

Run shadow mode first. Log what would have been recorded and later retrieved, but do not change context. If fewer than 10% of accepted shadow claims would have prevented a later rediscovery/correction, stop; explicit capture is enough.

---

## E4 — behavioral A/B

Literal survival and retrieval scores are not sufficient. Use the same model, effort, repository revision, task state, and prompt; treatment differs only by injected facts.

Initial cases:

1. OpenDesign binary collision (`od.exe` vs real OpenDesign);
2. OpenDesign fake fallback/configuration;
3. benchmark optimization later rejected as a serious regression;
4. Belot approved deck/card design preference.

The monitor sequence is not a recall success case: relevant text was often still present while behavior regressed. Use it as a stale/disputed-authority and rollback case.

A behavioral case is valid only when baseline repeats the target mistake in at least 3 of 5 fresh trials. For at least four valid cases, treatment must:

- repeat the target mistake in 0 of 5 trials;
- preserve task success;
- introduce no forbidden/stale action;
- show the exact injected claim IDs used.

If baseline cannot reproduce the mistake, the case cannot support a causal claim.

---

## E5 — end-to-end acceptance

Rerun the same accepted calculator/redesign benchmark and aggregate every continuation session.

Required:

- total provider tokens and cost <= 2% over the accepted baseline;
- wall-clock p50/p90, turns, and tool calls each <= 5% regression;
- no increase in user repeat-corrections;
- no recursive summary growth;
- zero secret persistence;
- zero automatic use of stale/superseded/rejected claims;
- one failed extractor or ledger read leaves ordinary workflow behavior unchanged.

Revert any optimization that materially regresses the aggregate, even if one submetric improves.

---

## Explicitly rejected for v1

- per-turn or per-compaction LLM extraction;
- background observational memory;
- transcript ingestion into a new database;
- reuse of the Hermes SQLite database;
- SQLite/FTS before JSONL exceeds 5 MB or roughly 10,000 active claims and measured cold scans matter;
- embeddings/vector search;
- LLM arbitration during retrieval;
- recency-only ranking;
- unconditional injection of all policies/preferences;
- automatic durable writes from correction regexes;
- automatic Git synchronization of user/machine facts;
- adapting `/compound` into the compaction path;
- six separate model tools for one CRUD/search surface.

---

## Implementation files

Expected minimum change surface:

- `extensions/work-compaction.js` — E1 repair, knowledge section, fit budget, custom-message exclusion;
- `extensions/work-models.js` — dynamic context injection, native compaction wiring, command/tool surface, and machine-prompt marker discrimination;
- one small ledger module under `extensions/` — JSONL read/append/resolve/search/validate;
- `extensions/work-dialogs.js` — reuse only, no new dialog framework;
- `.gitignore` — project-local ledger;
- `scripts/test-work-compaction.mjs` — five-generation and saturation tests;
- `scripts/test-work-knowledge.mjs` — ledger/retrieval/security/filter-refresh tests;
- `benchmarks/session-knowledge/v1/**` and two replay scripts only when E3 begins.

Do not change `work-verification-contract.js`; consume its proof records through the existing interface.

---

## Required checks by phase

### E1

```text
node scripts/test-work-compaction.mjs
node scripts/test-work-goal.mjs
```

Plus the committed shingle/section replay over sanitized catch-up and verifier fixtures.

### E2

```text
node scripts/test-work-knowledge.mjs
node scripts/test-work-compaction.mjs
node scripts/test-work-goal.mjs
```

Run LSP diagnostics on every edited JavaScript file before broader checks.

### E3/E4

```text
node scripts/run-session-knowledge-replay.mjs
node scripts/score-session-knowledge-replay.mjs
```

Persist revision, model, effort, trial, tokens, cost, runtime, turns, tool calls, and claim IDs in each result.

### Final

Use the repository's defined verification scripts from `package.json`; do not invent `npm test`.

---

## Definition of done

The work is done only when:

1. E1 removes measured recursive/synthetic compaction waste without an end-to-end regression.
2. A fact explicitly stored with `/wo fact add` is retrievable after restart and appears exactly once through native compaction, microcompact, and active in-session filtering.
3. Correction/rejection during an active filtered window takes effect on the next context event.
4. Secrets and workflow-generated pseudo-user prompts cannot become durable human facts.
5. Held-out retrieval meets the E2 thresholds.
6. Automatic extraction remains disabled unless E3 and E4 both pass.
7. The full benchmark satisfies the Optimization Regression Rule.

Until E4 passes, describe the feature as **durable fact storage and deterministic recall**, not as proven mistake prevention.

---

## Advisor and experiment references

### Initial architecture reports

- Opus 5 high, run `25294080-5955-430d-9edb-d88252880ee2`:
  `C:/Users/Flex/.pi/agent/sessions/--C--SOFT-git-ce-workflow--/subagent-artifacts/outputs/cede3da0-0373-43b9-bdce-81633298fe92/analysis/opus-memory.md`
- GLM 5.3 high, run `6e02c2b7-fd13-4f66-b4f9-a8e14c4e28ea`:
  `C:/Users/Flex/.pi/agent/sessions/--C--SOFT-git-ce-workflow--/subagent-artifacts/outputs/cede3da0-0373-43b9-bdce-81633298fe92/analysis/glm-memory.md`

### Real-log evaluation and cross-examination

- GLM evaluation:
  `C:/Users/Flex/.pi/agent/sessions/--C--SOFT-git-ce-workflow--/subagent-artifacts/outputs/c36d8534-9e05-4cdc-8af7-e4982e4dbfa2/analysis/glm-eval.md`
- Opus cross-examination:
  `C:/Users/Flex/.pi/agent/sessions/--C--SOFT-git-ce-workflow--/subagent-artifacts/outputs/1a39ec8d-d295-4291-b924-948f4bd0e178/analysis/opus-cross.md`
- GLM cross-examination:
  `C:/Users/Flex/.pi/agent/sessions/--C--SOFT-git-ce-workflow--/subagent-artifacts/outputs/0938fcc5-bd93-4658-bd87-97fff508328e/analysis/glm-cross.md`
- Opus architecture review, run `1c7af59d-4e84-4604-97cc-e2f5b9deb5df`:
  `C:/Users/Flex/.pi/agent/sessions/--C--SOFT-git-ce-workflow--/subagent-artifacts/1c7af59d-4e84-4604-97cc-e2f5b9deb5df_reviewer_0_output.md`
- GLM retrieval/microcompact review, run `7b1d4f10-ccb8-4411-a7a4-695dbb5d95cf`:
  `C:/Users/Flex/.pi/agent/sessions/--C--SOFT-git-ce-workflow--/subagent-artifacts/7b1d4f10-ccb8-4411-a7a4-695dbb5d95cf_reviewer_0_output.md`
- GPT-5.6 Sol empirical-method review, run `2754b60f-da68-417c-ba44-95ee7a1b0cf9`:
  `C:/Users/Flex/.pi/agent/sessions/--C--SOFT-git-ce-workflow--/subagent-artifacts/2754b60f-da68-417c-ba44-95ee7a1b0cf9_reviewer_0_output.md`

### Implementation seam and test reviews

- Opus implementation map, run `bac914f7-a4d2-4923-9f0c-eec7b1a6bc84`:
  `C:/Users/Flex/.pi/agent/sessions/--C--SOFT-git-ce-workflow--/subagent-artifacts/outputs/12c36805-30f6-4399-989f-5a67b73263e3/analysis/opus-implementation-map.md`
- GLM security/retrieval review, run `4fccbac9-5e43-439d-bda5-5cb2d3b5fbca`:
  `C:/Users/Flex/.pi/agent/sessions/--C--SOFT-git-ce-workflow--/subagent-artifacts/outputs/12c36805-30f6-4399-989f-5a67b73263e3/analysis/glm-security-retrieval.md`
- Sol executable test strategy, run `a24ca8a4-2e69-46c2-b970-4dab58c75205`:
  `C:/Users/Flex/.pi/agent/sessions/--C--SOFT-git-ce-workflow--/subagent-artifacts/outputs/12c36805-30f6-4399-989f-5a67b73263e3/analysis/sol-test-strategy.md`

### Local exploratory artifacts

The following uncommitted files generated the measurements above. They are evidence inputs only; E3 must replace them with sanitized repository fixtures:

- `C:/Users/Flex/AppData/Local/Temp/ce-memory-eval.py`
- `C:/Users/Flex/AppData/Local/Temp/ce-memory-eval.out`
- `C:/Users/Flex/AppData/Local/Temp/ce-correction-eval.py`
- `C:/Users/Flex/AppData/Local/Temp/ce-correction-eval.out`
- `C:/Users/Flex/AppData/Local/Temp/ce-survival-eval.py`
- `C:/Users/Flex/AppData/Local/Temp/ce-shingle-eval.py`
- `C:/Users/Flex/AppData/Local/Temp/ce-retrieval-eval.py`
- `C:/Users/Flex/AppData/Local/Temp/ce-ledger-bench.mjs`
