---
name: work-orchestrator
description: Drive native work-item software work from /work-* prompts. Use when creating, resuming, pausing, or checking autonomous development work with work items, git, and pi-subagents.
---

# Work Orchestrator

Use this skill for `/work-plan`, `/work-init`, `/work-master`, `/work-migrate`, `/work-small`, `/work-med`, `/work-big`, `/work-debug`, `/work-auto`, `/work-resume`, `/work-goal`, `/work-add`, `/work-report`, `/work-telemetry`, `/work-finish`, `/work-status`, and `/work-pause`. Use `/work-plan` as the human-facing bootstrap command; `/work-master` is a legacy alias. Use `/work-resume` for one coded work item boundary and `/work-goal [--tokens 100k] <objective>` for autonomous multi-step goals. `/work-goal` retries transient provider/context errors, preserves budget telemetry across compaction, rejects contradictory completion summaries, and pauses only for real human decisions, budget limit, non-retryable errors, or explicit stop. Use `/work-models` for role model/effort overrides and `/work-context` for the proactive compaction guard. Extension commands provide cheap deterministic init, status, report, telemetry, start-gate, pause/debug/add/auto intake, and finish-gate state when loaded.

## Common execution policy

Work directly in the current session by default. Use code for intake, routing, bounded validation, commit, close, and push. Do not call `subagent list`; the extension selects exact specialist names. Launch a role only when it adds distinct judgment: `work-planner` for ambiguous/large slicing, `work-debugger` for root-cause work, `work-worker` for high-risk isolation, `work-reviewer` for sensitive/large/ambiguous evidence, and `work-fixer` only for concrete findings. Routine work gets no planner, reviewer, or committer agent. Do not ask the user how to run each slice; apply the coded execution policy and proceed. Set `sliceExecutionMode` (`inline` default, or `agent`) in `/work-settings` to control whether each slice runs in-session or via an isolated `work-worker`.

## Source of Truth

- The native work-item store is the only durable work state: scope, status, acceptance, dependencies, discovered work, and resume notes live in work items.
- Git is the only code state: changed files, diffs, commits, and branches live in git.
- Chat memory is not source of truth. A fresh session must resume from `node scripts/work-helper.mjs work-ready-summary`, `native helper list --status=in_progress --json`, and `git status`.
- Work one ready work item at a time unless isolated worktrees are explicitly used.
- The current session is the default worker for clear bounded work. Intake, implementation, verification, and commit/close use coded helpers inline; role agents are reserved for semantic planning, root-cause debugging, high-risk isolated writing, and independent review when risk evidence requires it.
- Each executable work item is a fresh-context session boundary: after committing/closing one, continue the autonomous loop with the next ready work item in a fresh session (`/new`) instead of dragging old context into the next slice. Use `/work-stop` to halt the loop at the next safe phase.
- Do not overwrite manual edits silently.

## Preflight

Run these before mutating work:

```bash
/work-status
git status --short --branch
```

If no work items workspace exists, use `/work-init` or `/work-plan <idea-or-plan-file>`; they run `/work-init` so work items does not add generic AGENTS.md instructions. Ignore Pi runtime artifacts such as `.pi-subagents/`; if they appear untracked, add them to `.gitignore` only when that is the smallest safe cleanup. When a coded start is blocked by other dirt, the extension passes its Git file list to the LLM for read-only inspection, asks once whether to apply the exact non-destructive recommendation or cancel for manual cleanup, and requeues the original command only after accepted cleanup clears the original blockers. If git is dirty, run the worktree hygiene gate before launching a writer:

```bash
git status --porcelain=v1 --untracked-files=all
git diff --name-only
git diff --cached --name-only
```

Classify file names, not human diff/stat summaries such as `1 -0`:

- belongs to the current work item: include it and verify it;
- unrelated but safe: leave it untouched and pass it to children as a known-unrelated dirty allowlist;
- unrelated whitespace-only scratch in a tracked file, especially `AGENTS.md`/instructions touched by tooling: restore it before spawning children when it is clearly not user work;
- conflicts with the current work item: stop and ask;
- completed work: create or update a work item and commit that work first.

Children should not rediscover already-classified dirt from chat memory. Include the exact related file list and known-unrelated dirty allowlist in every worker/reviewer/committer task.

## Verification Contract

Project instructions can define mandatory verification such as TDD, hardware-in-the-loop checks, fixture runs, safety tests, or exact commands. Treat those as a verification contract, not advice.

During preflight, read the relevant project instructions (`AGENTS.md`, `CLAUDE.md`, `.pi/`, README/test docs when referenced) and extract only concrete verification rules that apply to the requested work. Propagate them into the roadmap and every child work item's `acceptance`/`notes` before implementation. If the contract says real hardware testing is required for affected modules, each affected work item must name the module/device check and require real hardware evidence.

Workers must run the contract or stop. Reviewers and committers must fail/hold the work item when contract evidence is missing. Do not replace required hardware verification with mocks, simulation, or static checks unless the contract or user explicitly allows that substitute.

## work items Conventions

Use core work items fields before inventing metadata:

- roadmap record: master goal, master plan, scope, acceptance, constraints.
- `type=task`: executable implementation slice.
- `type=decision`: human/product/architecture uncertainty.
- `type=bug`: reviewer failure or regression fix.
- `description`: problem, scope, why this exists.
- `design`: approach, decisions, relevant plan references.
- `acceptance`: concrete done criteria and verification contract.
- `notes`: progress, files changed, verification result, handoff.
- dependencies: only real blockers.

Every non-roadmap work item created inside a roadmap must use work items hierarchy (`node scripts/work-helper.mjs work-create --parent <roadmap-id>` or the equivalent). Do not create top-level task/decision work items for roadmap work.

Use labels for workflow state:

- `wo:planning`
- `wo:implementation`
- `wo:debug`
- `wo:debug-needed`
- `wo:blocked`
- `wo:fix`
- `wo:decision`

For discovered work, create a work item and include `discovered-from:<current-work-item-id>` in notes. Add a blocking dependency only when it truly blocks current or future work.

## Failure and Blocker Lifecycle

A failed verification or live evidence result is durable work state, not chat trivia. Record a compact failure artifact in the work item notes with: command/run ID, artifact paths, failing phase, exit code/status, observed vs expected result, touched files, suspected owner, latest relevant messages, and exact next debug/status command. The extension also auto-appends `wo:failure-summary` notes for failing role-agent runs; do not delete them. If the harness passes but product evidence says `failed`, `hardware-blocked`, `terminal-failed`, or similar, treat those as separate fields: the harness task may close only when its acceptance was evidence capture, but a follow-up debug work item must exist for the product failure before downstream dependent work proceeds.

When an implementation work item fails its own acceptance or verification, do not close it. Create or reuse a `type=bug` child work item under the same roadmap, label it `wo:debug`, include `discovered-from:<failed-work-item-id>` and the failure artifact, then add a dependency so the failed work item and any downstream slices wait for the bug. Mark the failed work item notes with `debug-needed:<bug-id>` and `wo:debug-needed` when labels are available. If work items supports a blocked status in the project, use it; otherwise keep the blocker represented by dependencies and labels.

If mandatory verification cannot run because the environment is missing a toolchain, device, credential, or other external prerequisite, do not repeatedly re-run the same implementation work item. Create or reuse a `type=decision` child work item labeled `wo:blocked` with the exact missing prerequisite and next verification command, add it as a blocker for the failed work item, checkpoint any related code state if needed to leave git clean, and stop with that blocker as the next ready item.

When `ce-debug` cannot safely fix or verify, record the debugger's failure artifact in the bug work item, create a `type=decision` work item for the human question when needed, label the bug `wo:blocked`, and add a dependency from the bug to that decision. `/work-resume` should then continue with the next unrelated ready work item from `node scripts/work-helper.mjs work-ready-summary`; it must not spin on blocked work. `/work-report` is the human handoff surface for blocked/debug-needed work items.

## Mode: init

Use to initialize the current repository for this workflow.

Run `/work-init` only when `/work-status` shows no workspace. Do not install generic work items instructions into AGENTS.md; this workflow owns work items mutation through `/work-*` commands and role agents.

Final output: `Next: /work-plan <idea-or-plan-file>`.

## Mode: master

Use to create a new master roadmap from a brainstorm roadmap, brainstorm artifact, rough feature idea, or existing plan. Prefer the user-facing command name `/work-plan`; `/work-master` remains an alias.

When the input points at a brainstorm roadmap, brainstorm artifact, or asks for a master plan, run `ce-plan` first to turn that source into a detailed master plan for later slicing. If the source is not already a plan file, write a new plan artifact rather than reusing or lightly updating an older weaker plan unless the user explicitly asks. The `/work-plan` handoff must preserve every decided requirement, constraint, non-goal, reference, acceptance example, and open question from the source; trace each into a plan requirement, implementation unit, verification/acceptance proof, open question, or dropped-with-rationale note. For any authoritative reference or target behavior, require a generic Acceptance Contract: source, must-match traits/invariants, must-not regressions, proof artifacts/checks, and approval path. This applies beyond UI: API compatibility, CLI behavior, C++ ABI/performance/thread-safety, data invariants, security posture, hardware behavior, and visual parity are all the same pattern. Tell `ce-plan` to ask clarification questions one at a time when the source is broad, important, or underspecified; auto-accept only skips final write-confirmation after discovery is clear, not planning questions. Any material uncertainty, subjective acceptance, weak proof, missing input, or P0/P1 doc-review finding must become a plan fix, blocking question, decision/blocker work item instruction, or explicit user waiver — never passive risk prose. Repeat that hardening loop until no blocking uncertainty remains, asking the user only for decisions that cannot be inferred. Before creating the roadmap, the Open Question Gate scans the finalized plan for any remaining open questions — including non-blocking ones that carry a stated default — and `/work-plan` blocks roadmap creation if any remain, handing back a resolve loop: for each open question run exactly one `ask_user` with `allowComment=true` (show the question, offer its suggested default as the recommended option, allow a freeform answer and an explicit waive), fold the answer into the plan as a confirmed decision or waiver, then re-run `/work-plan <plan-path>`; the roadmap is created only when the scan is clean. A non-blocking open question with a default is never allowed to ship unresolved — the default is a suggestion to present, not a silent resolution. For a raw-idea source, ce-plan writes the plan and the orchestrator bootstraps the roadmap in the same flow via `node scripts/work-helper.mjs bootstrap-plan-roadmap <plan-path>` (no second `/work-plan`); for an existing plan file, `/work-plan <plan-path>` does the same bootstrap directly — both run the Open Question Gate first. Then create the roadmap work item from the produced plan: put the summary/scope in `description`, key decisions and implementation units in `design`, acceptance/verification contract in `acceptance`, and the source brainstorm plus local plan path in `notes`. The native work-item store remains the source of truth; the plan file is a reference.

Infer lifecycle shape from the confirmed delivery-scope mapping, not title or heading heuristics. One scope uses the standalone bootstrap unchanged. Multiple independently completable scopes require the planner to emit the versioned semantic proposal accepted by `initiative-preview --proposal-json <json>`; show that complete hierarchy and coverage in F7, then let that user-facing confirmation mint the single-use approval receipt and call `initiative-apply` with the confirmed token and receipt. Preserve the brainstorm roadmap as the initiative, retain idea and artifact backlinks, create only child roadmap stubs, and put one `wo:planning` item under the explicitly selected child. Empty, incomplete, stale, ambiguous, or unapproved proposals stop without mutation. Agents never edit the raw store.

1. Create only the master roadmap work item with the master plan captured in work items fields.
2. Create only one initial `wo:planning` work item that tells `work-planner` to split the roadmap into the next executable slice, or at most three obvious low-risk slices.
3. Do not create executable task work items in the parent; that is only `work-planner`'s job.
4. Launch `work-planner`.
5. Planner creates or reuses executable work items and decision work items.
6. Start `Mode: resume` for the roadmap.

Do not implement until the roadmap contains the master plan and durable executable work items exist. Do not create duplicate task work items for the same implementation unit.

## Mode: ideate

Prefer the extension command `/work-ideate` when available. It lists `wo:idea` work items, guards numeric dashboard indexes with a disposable snapshot, and mutates only the resolved idea for `accept`, `reject`, `discuss`, `inspect`, and `import`.

Fallback behavior: read the active roadmap's child work items, filter idea records marked with `wo:idea`, and show their derived status. For a topic handoff, run CE ideation, ask for structured JSON with `ideas[]` and optional `topPicks`, save every parsed idea under the roadmap with `source-run-id` and `source-index` notes, and create a recovery decision work item if parsing or saving fails. Never treat an idea record as executable work; only linked planning/task descendants can be resumed.

## Mode: brainstorm

Prefer the extension command `/work-brainstorm` when available. It resolves `idea <target>` before freeform topics, reuses exact normalized title matches, refuses fuzzy auto-merge by reporting possible duplicates, and appends brainstorm/plan backlinks to `wo:idea` work items.

Fallback behavior: if no active roadmap exists and the target is a freeform topic, initialize work items if needed and create one standalone brainstorm roadmap before saving ideas under it. When no artifact path is supplied, run `ce-brainstorm` interactively for the selected idea or topic, asking one question at a time until requirements are clear; do not silently synthesize broad, important, or underspecified brainstorms. Stop after the requirements artifact is written; skip ce-brainstorm's post-doc planning/build menu because `/work-brainstorm` owns the brainstorm→plan handoff. Save the artifact, link it back with `/work-brainstorm idea <id> <path>`, then run `/work-plan <path>` so the preservation/self-audit contract above is applied.

## Mode: usage

Prefer the extension command `/work-usage` when available. It reads existing `.pi/work-runs` telemetry, defaults to the one active roadmap only when unambiguous, writes an escaped local HTML report under `.pi/work-runs/usage/`, prints machine-readable rows with `--jsonl`, opens a browser only with `--open`, and never creates or mutates work items.

Fallback behavior: summarize existing telemetry only. If multiple roadmaps could match, ask for `roadmap <id>` instead of blending them.

## Mode: migrate

Use to import existing project state from CE brainstorms/plans, non-CE plans, TODOs, issue exports, docs, git history, and unfinished branches into work items.

Migration is read-only for source code and git history. Do not checkout, merge, rebase, delete branches, edit source files, stage, or commit. Run preflight, then inspect the requested artifacts and branch state:

```bash
git status --short --branch
git branch --all --no-color --sort=-committerdate
git log --all --decorate --date=short --pretty=format:'%h %ad %d %s' --max-count=80
```

1. Require the user to name the artifacts, branches, tracker export, or description to migrate. If scope is too vague, ask first.
2. If the source is a clean CE brainstorm/plan with no partial implementation to reconcile, prefer `Mode: master` instead.
3. Launch `work-migrator` with the sources, current branch, suspected base branch, and instruction to mutate only work items.
4. `work-migrator` creates or reuses exactly one roadmap unless the user asked for multiple roadmaps.
5. The roadmap notes must include provenance: artifacts read, branches inspected, current branch, base branch assumption, and migration date.
6. Create closed child work items only for completed units with strong evidence from artifacts plus code/commit/test evidence. Git log is evidence, not truth; never create one work item per commit.
7. Create open task/bug work items for remaining work and decision work items for ambiguity.
8. For unmerged or stale branches, create review/integration work items or decision work items under the roadmap; never auto-merge or checkout branches during migration.
9. If artifacts are messy but substantial, run `ce-plan` only to consolidate a reference plan, auto-accepting plan creation unless a real decision is needed, then store the resulting plan path in roadmap notes. The native work-item store remains the source of truth.
10. After migration, show the created/reused roadmap ID and ask whether to start `Mode: resume` for that roadmap.

Stop if completion evidence is weak but the user asked to mark work done, branch handling requires checkout/merge/rebase, artifact claims conflict with code, or dirty source changes make provenance unsafe.

## Mode: small

Use for clear, low-risk changes in one or two files inside an existing roadmap.

1. Resolve the active roadmap first; if ambiguous, ask.
2. Create a child work item under that roadmap (`--parent <roadmap-id>`) unless an existing work item already matches it.
3. Claim the work item during coded intake, then implement directly in the current session with targeted reads.
4. Use `finish-task --max-files 2` for the smallest real verification, evidence note, commit, close, and push when an upstream exists. Deterministic JSON uses `--json <file> --equals <path=value>`.
5. Do not list or launch agents for routine `/work-small`. If the coded finalizer detects sensitive paths, launch exactly one `work-reviewer`, persist PASS evidence, then rerun with `--reviewed`.
6. If scope exceeds two implementation files, verification fails, acceptance is unclear, or dirty files conflict, leave the work item open and route the next invocation through med/debug rather than silently cutting scope.

## Mode: med

Use for bounded work inside an existing roadmap with a few choices and fewer than about ten files.

1. Resolve the active roadmap first; if ambiguous, ask.
2. Create and claim one executable work item directly; do not create a planning work item or planner agent for an already explicit bounded request.
3. Implement directly in the current session with a limit of eight implementation files.
4. Use `finish-task --max-files 8` for verification and coded commit/close. Launch exactly one `work-reviewer` only when the coded risk gate, ambiguous acceptance, or failed evidence requires independent review.
5. If semantic slicing or architecture decisions are genuinely required, stop the inline path and route to big/planner rather than inventing child work items.

Durable scope still goes into work items; a short in-session checklist is enough for routine medium work.

## Mode: big

Use for large, risky, cross-cutting, or architectural work inside an existing roadmap.

1. Resolve the active roadmap first; if ambiguous, ask.
2. Create a `wo:planning` work item under that roadmap describing the requested large slice.
3. Launch `work-planner` to split that slice into the next executable work item by default, plus any decision work items; create up to three executable work items only for obvious low-risk sequential work. Mark executable descendants with `wo:execution-agent` in notes so resume preserves the big/risky writer boundary.
4. Start `Mode: resume` for the roadmap.

Do not create a new master roadmap here; use `Mode: master` for that.

## Mode: debug

Use for failing tests, errors, regressions, blocked/debug-needed work items, or broken behavior inside an existing roadmap.

1. Resolve the active roadmap first; if ambiguous, ask.
2. If the argument starts with an existing work item ID or numeric shorthand, inspect that work item instead of creating a duplicate. Treat text after `:` or after the first target token as human retry guidance, append it to the debug work item notes, and reopen a blocked target before debugging. If the target is an implementation work item with `debug-needed:<bug-id>`, debug the bug work item.
3. Otherwise create a `type=bug` child work item under that roadmap (`--parent <roadmap-id>`) with the reported symptom, reproduction command, expected behavior, and failure artifact when supplied.
4. Default path: launch `work-debugger` with that bug work item and require the `ce-debug` workflow: reproduce, root-cause, fix, verify.
5. Interactive path: when the user explicitly asks to debug a blocked work item in the console or gives direct guidance (`/work-debug <work-item-id>: ...`), the parent may run the debug loop directly for observability. Keep native work-item store/git as source of truth, avoid unrelated edits, and then run the same review/commit/close gates as the agent path.
6. If `ce-debug` fixes and verifies the issue, review the debug diff with `work-reviewer`; if it fails, return to `work-debugger` or `work-fixer` with exact findings.
7. Commit and close through the coded `finish-task` gate after verification and review pass. Use `work-committer` only when unusual repository policy cannot be represented by that gate. Remove or satisfy blocking dependencies so `/work-resume` can continue downstream work.
8. Run the learning-capture gate after the fix commit. Repeated attempts to discover a reusable project-specific operational fact—such as the canonical build/test command, an executable location, environment setup, or tool invocation—qualify alongside non-trivial root-cause lessons. Prefer executable configuration or project instructions for direct procedures; use `ce-compound mode:headless <short context>` for non-obvious rationale and troubleshooting. Before writing, search existing instructions and `docs/solutions/`; update rather than duplicate. Derive a stable lowercase hyphenated learning key, check the roadmap notes for `wo:learning:<key>=<artifact>`, and after capture append that marker with `work-note` so later exits skip the same lesson. Commit the durable artifact before closing the roadmap.

Stop and mark blocked when reproduction needs unavailable external state, the root cause requires a product/architecture decision, or `ce-debug` cannot verify safely. The blocked bug work item must contain the failure artifact, current hypothesis, attempted commands, and exact human decision needed.

## Mode: auto

Classify the task, then route:

- small: clear, low-risk, one or two files;
- med: bounded, some choices, fewer than about ten files;
- debug: failing test, error, regression, stack trace, or broken behavior;
- big: cross-cutting, high-risk, unclear, architecture/product decisions, or more than about ten files inside an existing roadmap;
- master: new brainstorm, new product idea, or request to create a master plan/roadmap;
- migrate: existing partially completed project, legacy TODO/issue tracker, non-CE artifact set, or branch/history reconciliation.

If classification is big, master, migrate, or ambiguous, ask before starting. Do not silently turn a vague request into a roadmap.

## Mode: resume

Argument may be an explicit roadmap work item ID, `last`, empty, or project-loop guidance from `/work-resume`. Default behavior is one executable work item per invocation; the user can run `/work-resume` again from a fresh Pi session for the next slice.

When empty or `last`, resolve from work items, not chat memory:

1. in-progress roadmap in the current repo;
2. latest not-completed roadmap with ready descendants;
3. if no single latest roadmap can be proven, list active not-completed roadmaps and ask the user to pick one.

Build the choice list with compact commands such as `node scripts/work-helper.mjs work-children-summary <roadmap-id>` when available. The choice list must include, for each roadmap: work item ID, created date, last worked date, status, ready/open/in-progress child counts when available, and a one-line description. Compute dates from work items JSON fields such as `created_at`/`updated_at` when available; otherwise use child updates, notes, or `unknown`. Do not guess from chat memory.

If the prompt starts with "Use the work-orchestrator skill in mode: resume with this precomputed extension state", trust that extension-resolved roadmap/action/selected work item as the starting point. Verify native work-item store/git freshness, then continue at the matching loop step below instead of repeating target selection or ready-work discovery.

If the prompt starts with a precomputed extension state for `small`, `med`, `big`, `master`, `migrate`, or `finish` (or for `debug`, `add`, `pause`, or `auto`), trust its resolved target/action as intake state, verify native work-item store/git freshness, then continue at that mode's role-loop or stop boundary instead of rediscovering the target.

Loop:

1. Run `node scripts/work-helper.mjs work-ready-summary` unless precomputed extension state already names the selected action and work item for this invocation.
2. Run the worktree hygiene gate and resolve/record dirty files before spawning any child. Prefer one parent cleanup over repeated child stop/retry loops. Repeat this gate after every child returns; restore whitespace-only tracked instruction-file changes such as `AGENTS.md` before interpreting review results or committing. Because some child starts can recreate this instruction-file dirt after the parent gate, include a startup allowlist telling children to continue when the only dirty file is whitespace/formatter-only `AGENTS.md`/instruction-file dirt, and to leave it for parent cleanup.
3. Inspect `node scripts/work-helper.mjs work-children-summary <roadmap-id>` unless precomputed extension state already handled stale planning for this invocation. If ready contains `wo:planning` work items and executable child work items already exist, close the satisfied planning work item with a note naming the created children; do not run it as implementation work.
4. Pick exactly one non-planning ready work item belonging to or blocking the target roadmap. Prefer `wo:debug` bug work items when they unblock in-progress/debug-needed work; otherwise pick the earliest unblocked implementation slice. Skip `wo:blocked` work items unless the user explicitly chose them with `/work-debug`.
5. If no non-planning ready work item belongs to the target roadmap, inspect the roadmap master plan through compact fields or the referenced plan file section, not raw roadmap JSON. If open decisions, blocked/debug-needed children, or failed evidence exist, report them with `/work-report <roadmap-id>` style details and stop. If the roadmap is not closed and no blocker explains the empty ready set, create or reuse a `wo:planning` work item under the roadmap and launch `work-planner` to compare the master plan against closed/open children and create the next executable slice by default, or up to three obvious low-risk slices; require the planner to close the planning work item once executable children exist, verify `node scripts/work-helper.mjs work-ready-summary` now shows the earliest executable slice rather than a later dependent slice, then stop so the next `/work-resume` starts fresh. Only report "done" when the planner confirms no remaining implementation units and all child work items are closed or deliberately deferred; never close the roadmap automatically.
6. Do not dump raw `native helper show <id> --json` into the parent chat. Use the precomputed extension state, `/work-report <id> --json`, or small `native helper show ... | python/node` projections. Child role agents may read full child work items, but planner must not read full roadmap/master-plan JSON when a plan path or expected unit is available.
7. If it is a planning work item, launch `work-planner` with `context:fresh` and file-only/concise output when available, require it to close or update the planning work item, verify `node scripts/work-helper.mjs work-ready-summary` exposes the earliest executable slice and not the planning work item or a later dependent slice, then stop at the planning boundary.
8. If it is an implementation work item, apply the coded execution policy. Clear bounded work runs directly in the current session and finishes with `finish-task`; high-risk markers (security/auth, persistence/migration, payments, concurrency, breaking API/ABI, destructive production work, or explicit big-mode provenance) launch exactly `work-worker` with `context:fresh`.
9. Skip an independent reviewer when acceptance is explicit, deterministic verification passed, and the bounded diff is non-sensitive. Launch exactly one `work-reviewer` for high-risk, large, UI-acceptance, hardware/live-evidence, ambiguous, or failed/missing-verification changes. Never call `subagent list`; the extension resolves the exact role in code.
10. If the initial review returns `FAIL` for fixable code, batch its exact findings into one `work-fixer` pass. Run at most one scoped re-review, and only when the fixes materially changed production behavior; skip it for test-only, documentation, formatting, traceability, or other mechanical fixes. If that re-review fails, stop with the durable findings instead of launching another fixer/reviewer cycle. If root-cause debugging is needed, create/reuse a `wo:debug` bug work item and stop so the next `/work-resume` selects `work-debugger`.
11. Commit, close, amend work items state, and push through the coded finish helper. Do not launch `work-committer` for routine work; reserve it only for unusual repository commit policy that cannot be represented by the coded gate.
12. For big/master/debug work only, run the learning-capture gate. Capture reusable debugging, architecture, workflow, or integration knowledge, including project-specific operational facts that took repeated attempts to discover (for example the canonical build/test command, an executable location, environment setup, or tool invocation). Prefer executable configuration or project instructions for direct procedures; use `ce-compound mode:headless <short context>` for non-obvious rationale and troubleshooting. Before writing, search existing instructions and `docs/solutions/`; update rather than duplicate. Derive a stable lowercase hyphenated learning key, check the roadmap notes for `wo:learning:<key>=<artifact>`, and after capture append that marker with `work-note` so later exits skip the same lesson. Commit the durable artifact. Skip this gate for routine small/med work and any learning key already recorded on the roadmap.
13. After commit/close, always run a clean-boundary gate: `git status --short`, the work item verification if any related source files changed after commit, `node scripts/work-helper.mjs work-children-summary <roadmap-id>`, and `/work-status <roadmap-id>` or the same status calculation.
14. If autoformat/test tooling changed related files after commit, verify and commit those related changes before stopping; do not report completion with dirty related files.
15. Do not stop and ask after a work item closes — continue the autonomous loop to the next ready work item (fresh `/new` per slice when practical; `/work-goal` does this automatically). Stop the loop only when (a) an open `type=decision` work item needs human input, (b) a blocker/debug-needed work item cannot proceed, (c) the roadmap has no remaining executable work, or (d) the user ran `/work-stop`. When the loop stops, the final output must include the roadmap ID, the last closed work item ID, a status summary, and the one-line next action: `Next: /work-resume` when work remains, the exact blocker/debug command when blocked, or `Next: roadmap <roadmap-id> "<title>" is complete; close it explicitly with /work-roadmap close <roadmap-id>.` when truly complete.

## Mode: roadmap

Use when listing or managing roadmaps. `/work-roadmap` opens an interactive menu when available; subcommands are `list`, `tasks`, `plan`, `set-current`, `close`, and `reopen`. `plan` hands the selected roadmap to `/work-plan`, so linked brainstorms/plans stay work items-first. The task menu groups blockers first; task summary uses the focused report, and blocker full-info/action goes through `/work-debug`. Closing a roadmap is manual only: if unresolved child work items remain, ask before `--force`.

## Mode: add

Use when new work appears during an active roadmap.

1. Create a new work item under the active roadmap (`--parent <roadmap-id>`) with current context and `discovered-from:<current-work-item-id>` in notes.
2. If it blocks current work, add a real dependency.
3. If optional or future, do not block the active work item.
4. If the user says to do it now, run it as small or med work, then return to the previous roadmap.

## Mode: pause

Checkpoint and stop safely:

1. Inspect the active work item and `git status`.
2. Update work item notes with current state, files changed, last verification, failures, and next step.
3. Do not create speculative work.
4. Stop at a clean boundary.

## Mode: status

Read-only summary. Prefer the extension command `/work-status` when available because it does not spend LLM context. If using the skill path, compute the same fields without mutating work items or git:

- current roadmap ID, title, status, created date, last worked date, and one-line description;
- slice progress: closed executable slices / total executable slices and percent complete;
- ready slices, in-progress slices, planned-ahead/open slices that are not ready, open decisions, and planning work items;
- tasks completed and remaining by work items status;
- whether `native helper ready` is empty because the roadmap is complete, blocked, or needs another `work-planner` slicing pass;
- git status;
- active subagent runs when visible;
- next command, usually `/work-resume`.

Do not mutate work items or git in status mode.

## Mode: report

Prefer the extension command `/work-report` when available because it does not spend LLM context and can emit compact `--json`. The skill path is the fallback for environments where the extension command is not loaded. In the parent/control chat, do not run raw `native helper show --json` for roadmaps unless debugging the extension itself; use `/work-report` or slim work items fields instead.

Read-only detailed handoff for a whole roadmap or one blocked/debug-needed work item. Use when the user wants to know what is blocked, why, what failed, and what command/guidance to give next. Do not mutate work items or git.

For a roadmap target, report:

- roadmap ID, title, status, progress percent, and next ready work item from `node scripts/work-helper.mjs work-ready-summary`;
- ready unblocked work that `/work-resume` can continue;
- blocked/debug-needed work items, grouped by `wo:blocked`, `wo:debug-needed`, open decisions, and unmet dependencies;
- for each blocked item: blocker work item/dependency, latest failure artifact summary, artifact paths, last verification command/result, owner/phase, and exact suggested command such as `/work-debug <bug-id>: <human guidance>`;
- downstream work items waiting on each blocker;
- git status and any active/stale subagent coordination.

For a work item target, show the detailed failure artifact from notes: command, exit/status, logs/artifact paths, observed vs expected, attempted fixes, current hypothesis, human decision needed, dependencies, and what `/work-debug <work-item-id>: ...` would do. If the work item is not blocked, say so and point back to `/work-resume`.

## Role Loop

Work inline in the current session unless the coded policy requires specialization. Do not call `subagent list` during a workflow. When needed, launch the exact package role (`work-planner`, `work-worker`, `work-reviewer`, `work-fixer`, `work-debugger`, `work-migrator`, or `work-advisor`) directly; do not substitute builtin roles. Children get concrete work item IDs and must not launch their own subagent workflows. Always use fresh context unless the user explicitly requests inherited history. Use `outputMode: "file-only"` with a short relative output filename for review/research/work outputs unless the complete result is under about 20 lines; do not pass `.pi-subagents/` paths because the subagent tool owns the artifact directory. Keep only a short structured summary in the parent; do not paste long tool logs, full `native helper show` roadmap JSON, raw `node scripts/work-helper.mjs work-ready-summary`, raw `native helper children --json`, or whole master plans back into the control session. Pipe work items JSON through python/node projections when only IDs/status/titles are needed.

Do not put tiny wall-clock limits on real role agents. Prefer no explicit timeout; if the runtime requires one, use at least 10 minutes for planner/worker/reviewer/fixer/debugger/migrator and at least 3 minutes for committer. Use async/background for broad reviews, hardware work, or repo-scale investigation. A child timeout is an infrastructure failure artifact, not a review `FAIL` or implementation result.

## Context Budget Policy

work items and git preserve the memory; Pi chat is disposable working context. The package extension registers `/work-context` and proactively compacts at safe turn boundaries by default; Pi's native/ultracompact compaction still handles hard context overflow and retry.

- before any compact/restart boundary, write the current decision, changed files, verification, blockers, and next command into work item notes;
- rely on `/work-context status` for current token/trigger state; proactive compaction is enabled by default at 150k tokens, capped by model context, and keeps at least the latest 30k tokens via Pi compaction settings; use `/work-context off` to disable it;
- compact only inside a single work item when context gets high or after a noisy debug/review phase;
- `/work-resume` is an autonomous slice loop; each slice still gets a fresh-context boundary, but the loop continues to the next ready work item until a decision, blocker, completion, or `/work-stop`;
- self-improvement reporting is off by default; opt in with `workResume.selfImproving: true` and use `work_report_improvement` only for explicit evidence intake; it never changes the ce-workflow source from a producer project;
- `/work-stop` requests a clean stop for any active work (project goal, resume loop, or inline slice): checkpoint native work-item store/git, finish the current safe phase, and do not start another work item; (`/work-resume-stop` is a kept alias)
- after a work item is committed and closed, continue to the next ready work item automatically rather than stopping to ask.

## Cost and Model Policy

Keep the parent/main orchestrator on the user's chosen model/effort. For role agents, use the cheapest setting that can satisfy the role: migrator/planner high, debugger high, worker/fixer/reviewer medium, committer low. `/work-models` is the friendly settings UI; it writes project `subagents.agentOverrides` for `brainstorm/plan/migration`, `work`, `debug`, `review`, and `commit`. Blank model means inherit the current control-session model. For spawned smoke-test Pi instances, use low/minimal effort unless explicitly stress-testing reasoning quality. Use `/work-telemetry today`, `/work-telemetry roadmap <id>`, or `/work-usage roadmap <id> --jsonl` before changing role/model policy; they show command time, agent time, token usage, tool/subagent durations, context growth, and review payoff when telemetry recorded it. Do not add `--open` in spawned/agent runs. Do not hard-code provider-specific models in this package.

## Optional Intercom Coordination

`pi-intercom` is optional, never required. When the `pi-subagents` intercom bridge is active, children use `contact_supervisor` for parent coordination:

- `reason: "need_decision"` for blocking product, architecture, scope, hardware, verification, or dirty-worktree decisions;
- `reason: "progress_update"` for short non-blocking updates when discovery changes the plan.

The parent relays the question to the user when needed, records the answer in work item notes, then resumes the role loop. Before answering a delayed intercom ask, run `intercom({ action: "pending" })` or equivalent and check the subagent run plus work-item state; if the ask is no longer pending, the work item is already closed, or the run has completed, treat it as stale intercom and do not reply, revive the child, append another verdict, or restart work. For a live inbound request use `intercom({ action: "reply", message: "..." })`; `replyTo` is a message ID, never a child session name. If `contact_supervisor` is unavailable, times out, or delivery fails, the child must persist the blocker in work items (decision work item or notes) and stop safely without retrying. Durable decision blockers should be `type=decision`, labeled by adding `wo:blocked` and `wo:decision` without replacing existing labels (`node scripts/work-helper.mjs work-note <id> --add-label wo:blocked --add-label wo:decision`), and added as blockers for the assigned work item. Do not require the user to install `pi-intercom`, do not ask the user directly from a child, and do not guess decisions just to keep the run moving.

### work-migrator

Allowed to mutate work items through `work-helper.mjs`. Must not edit source code or change git branches.

Responsibilities:

- read requested artifacts and git branch/history evidence;
- create or reuse one migration roadmap with provenance notes;
- create closed child work items only for strongly evidenced completed units;
- create open task/bug/decision work items for remaining or ambiguous work;
- represent unfinished branches as review/integration work items or decision work items, not automatic merges;
- hand back the roadmap ID for `Mode: resume`.

### work-planner

Allowed to mutate work items through `work-helper.mjs`. Must not edit source code.

Responsibilities:

- read the planning work item and master roadmap through compact field extractors; do not dump raw roadmap JSON or full master plans into the transcript;
- prefer the referenced plan file and read only the expected next implementation-unit section plus the verification/hardware contract;
- propagate the project verification contract into child work item acceptance;
- list existing children of the roadmap before creating anything, summarized to ids/titles/status;
- create the next executable work item under the roadmap (`--parent <roadmap-id>`) by default, only when no existing open/in-progress/closed child already covers that implementation unit; create up to three executable work items only when the next units are obvious, low-risk, and sequential; propagate `wo:execution-agent` from a big/risky planning work item into each executable child's notes;
- create decision work items for uncertainty under the roadmap (`--parent <roadmap-id>`);
- add only real `blocks` dependencies, using `node scripts/work-helper.mjs work-block <later-id> --by <earlier-id>` when later slices must wait for earlier slices;
- run `node scripts/work-helper.mjs work-ready-summary` after dependency changes and repair the order if the earliest executable slice is not ready first;
- close or update the planning work item when durable work items exist.

### work-worker

Single writer for implementation. Must not commit.

Responsibilities:

- claim the work item;
- read only relevant context;
- inspect git with porcelain/name-only commands and do not parse diff/stat summaries as file content;
- implement exactly that work item;
- ignore a parent-provided known-unrelated dirty allowlist unless those files conflict with the work item;
- run the work item verification contract, including real hardware checks when required; before declaring hardware unavailable, run the smallest non-destructive availability probe for the platform (for Android, `adb devices -l`);
- update notes with files changed, verification, hardware evidence when applicable, and remaining work, using real newlines for multi-line notes rather than literal `\\n` text;
- when verification fails after a real attempt, attach a failure artifact and ask the parent to create/reuse a `wo:debug` bug work item with blocker dependencies;
- create discovered follow-up work items when needed.

### work-reviewer

Read-only reviewer.

Responsibilities:

- inspect git diff;
- inspect work item acceptance criteria;
- inspect verification contract evidence in notes;
- require a linked debug work item when product evidence failed but harness/evidence-capture scope passed;
- report `PASS` or `FAIL` with evidence and append the same compact `wo:review PASS|FAIL` verdict to the assigned work item so coded resume/finish can advance;
- when failing, provide exact fix instructions, a required debug work item, or a fix work item.

### work-debugger

Single writer for root-cause debugging. Must not commit.

Responsibilities:

- read the bug work item and current git state;
- use `ce-debug` discipline to reproduce, trace, root-cause, fix, and verify;
- update work item notes with symptoms, causal chain, files changed, verification contract evidence, hardware evidence when applicable, and result;
- when reproduction or verification fails after a real attempt, attach a failure artifact, label the bug `wo:blocked` when available, create a decision work item for any human question, and leave dependencies so `/work-resume` can move to unrelated ready work;
- create follow-up work items under the same roadmap only for separate work;
- identify non-trivial root-cause lessons and project-specific operational facts that took repeated attempts to discover, then hand the parent a stable learning key for the deduplicated learning-capture gate.

### work-fixer

Single writer for reviewer-identified issues only. Must not commit.

Responsibilities:

- fix only reviewer findings;
- rerun the verification contract;
- if the finding becomes a root-cause/debug problem instead of a local fix, attach a failure artifact and ask the parent to create/reuse a `wo:debug` bug work item;
- update work item notes;
- hand back to reviewer.

### work-committer

Exceptional commit-policy fallback only; routine work uses `finish-task`. Must not edit source code.

Responsibilities:

- inspect `git status` and diff with porcelain/name-only commands;
- confirm the verification contract passed;
- refuse close when the work item contains unresolved failed product evidence without a linked debug/blocked work item, unless acceptance explicitly says the work item only captures evidence;
- commit only related files;
- leave parent-declared known-unrelated dirty files unstaged and report them, stopping only if they conflict or are not on the allowlist;
- use commit message `<work-item-id>: <summary>`;
- after commit, re-run `git status --short`; if related files changed due autoformat/test tooling, rerun verification and commit those changes before closing;
- close the work item only after the work commit exists and no related dirty files remain;
- after close, re-run `git status --short`; if `node scripts/work-helper.mjs work-close` changed `.ce-workflow/work-items.json`, stage that canonical close record and amend the same work commit before finalizing;
- push only when repo/session policy requires it.

### work-advisor / work-advisor-2 / work-advisor-3

Identical read-only critics launched by the orchestrator from `/work-settings` (not primary implementation roles). Each slot supports `none`, inherited current model, or an explicit model at high effort; the primary defaults to inherited/high and advisors 2–3 default to none/high. Run every configured advisor in one parallel call on brainstorms and master plans; slice plans use the configured `none` / `first` / `all` policy. Advisors must not edit source code, mutate work items, or launch subagents. Do not substitute `ce-doc-review`, fallback roles, or retries for an unavailable configured advisor.

Responsibilities:

- critic gate (brainstorm/plan): hunt weak or missing requirements, unverified or subjective acceptance, incomplete decisions, ambiguous scope, untested assumptions, and Acceptance Contracts lacking proof/approval;
- task-verification gate: compare the change/diff and worker verification notes against the plan's acceptance and the implementation unit; flag drift, inconsistencies, and missing verification evidence;
- return exactly one verdict: `CLEAN` or `CONCERNS`, each finding tagged blocking or note with the smallest fix;
- record-worthy findings go back to the parent/role that launched it; the advisor does not write work items itself.

## Quality gates (prompt-live)

`/work-settings` toggles these on or off; when on, the extension appends the gate step to the matching handoff prompt, so the receiving role actually runs it. Defaults come from the effort profile:

- **advisor review on brainstorm/master plan** — run all configured advisor slots in one parallel call after `ce-brainstorm`/`ce-plan`; deduplicate findings and apply authority-grounded fixes. After fixes, the parent may rerun only the first configured advisor once when the change was substantive, never as a recursive loop.
- **advisor usage for slice plans** — profile-driven 3-state: none (low), first configured advisor (medium), or all configured advisors in parallel (high/max).
- **slice plan before work** — code writes a compact `wo:slice-plan` note for routine slices and continues without a planning boundary. Only genuinely ambiguous, architectural, or explicit big work launches planner/ce-plan.
- **advisor verifies task vs plan** — use `work-advisor` only when plan-to-diff alignment remains ambiguous after the coded acceptance/evidence check.
- **simplify before review** — use `ce-simplify-code` only when a non-trivial risky diff would materially benefit; routine bounded changes stay inline.
- **browser tests on UI diff** — at finish, run browser verification when UI acceptance requires it; backend/CLI/docs-only diffs skip it.
- **pre-commit review** — profile-driven 3-state: off (low), one `work-reviewer` pass on the scoped diff (medium/high), or full `ce-code-review` (max). Skips small diffs automatically.

Gates are orthogonal to role effort. Flip any of them live without changing models.

## Stop Conditions

Stop and ask or hand off when:

- no ready work items remain;
- human product, architecture, or debugging-environment decision is needed;
- verification failure invalidates the plan;
- the same subagent fails twice;
- context budget is high;
- dirty/manual changes need classification;
- acceptance criteria conflict with the implementation plan;
- required verification cannot run and no safe substitute exists.

## Live/Test Project Feedback Loop

Whenever a live or disposable test project exposes workflow friction, treat it as product evidence for this package. Before declaring the run done, ask what small ce-workflow change would prevent the same failure class. If the fix is inside this package and safe, apply it here; otherwise record a concrete follow-up. Prefer deleting/rewording brittle role instructions over adding new machinery.

Examples to capture: repeated dirty-file stop loops, child-created instruction-file whitespace, stale intercom asks, wrong work items dependency order, missing verification propagation, workers/fixers closing work items before commit, or role agents doing parent work.

## Review Strategy

Default loop:

```text
inline implementation -> coded verification/finalizer
```

Escalated loop for risky work:

```text
worker/debugger -> one scoped reviewer -> fixer only on concrete FAIL -> coded finalizer
```

Do not fan out routine reviews. Use extra read-only reviewers only for genuinely distinct high-risk domains; keep writers single-threaded.
