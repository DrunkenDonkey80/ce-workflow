---
name: work-orchestrator
description: Drive uncomputed /work-* requests, including verified legacy work items migration. Do not load for WO_INLINE_V1 or prompts that already contain precomputed extension state; those prompts are self-contained.
---

# Work Orchestrator

## Fast rule

When the prompt contains `WO_INLINE_V1` or says it has precomputed extension state, trust that state. The prompt is the execution contract: do not rediscover the roadmap/work item, reread this skill, dump work items JSON, or load the full policy reference. Verify only that named files/state are still fresh, then execute the named action.

Work directly in the current session by default. Use code for intake, routing, bounded validation, commit, close, and push. Do not call `subagent list`; the extension selects exact specialist names. Launch a role only when it adds distinct judgment:

- `work-planner`: ambiguous, architectural, or large semantic slicing;
- `work-debugger`: reproduced failure needing root-cause investigation;
- `work-worker`: high-risk work that benefits from an isolated writer;
- `work-reviewer`: sensitive, large, hardware/live-evidence, UI-acceptance, or ambiguous diff;
- `work-fixer`: concrete reviewer findings only;
- `work-migrator`: legacy artifact/branch reconciliation.

Routine work gets no planner, reviewer, or committer agent. Never launch a second writer/reviewer when equivalent passing evidence exists. Review budget is one initial cycle plus at most one targeted re-review after substantive production-code fixes; skip re-review for mechanical fixes and never launch a third cycle without an explicit user request. `work-committer` is an exceptional fallback only; normal commits use the coded finalizer.

## Source of truth and safety

- work items is durable work state; git is code state; chat is disposable.
- Never overwrite manual edits. Stop for conflicting dirt, credentials, destructive production actions, or a genuine product/architecture decision.
- Project verification contracts are mandatory, including real hardware evidence when required.
- Failed verification stays open and becomes compact work item evidence. Root-cause work becomes/reuses a `wo:debug` bug; unavailable external prerequisites become a blocked decision.
- Work one writer at a time unless isolated worktrees were explicitly chosen.

## Inline execution

For small/medium/routine resume work:

1. Trust coded target selection and claim; do not rerun broad preflight.
2. Read only task-named files/symbols. Search only when a required path is missing.
3. Implement the smallest correct change, preferring existing code, stdlib, and one-shot scripts for deterministic text/JSON transforms.
4. Pass the smallest real verification directly to the coded finalizer; do not run it separately first unless diagnosing a failure.
5. Finish once with:

```text
node <work-helper.mjs> finish-task <work-item-id> --max-files <2|8> --message "<summary>" --verify "<command>" [--expect "<stdout>"] --push
```

For JSON use `--json <file> --equals <path=value>`. The helper enforces file scope and sensitive-path review, records `wo:verify-check`, commits, closes, amends work items close state, pushes only with an upstream, and checks cleanliness.

If it reports independent review required, use its complete labelled reviewer handoff verbatim; do not handcraft or broaden the reviewer task. Launch exactly one `work-reviewer`, require one durable `wo:review PASS|FAIL` note, and rerun the same finish command with `--reviewed` only after PASS. After FAIL and substantive fixes, rerun that finish command without `--reviewed` to regenerate the complete targeted re-review handoff; never handcraft the re-review or omit its helper/path fields. If scope or verification fails, do not commit/close.

## Modes

- **small** — inline, two implementation files maximum.
- **med** — inline by default, eight files maximum; escalate to big if semantic slicing is needed.
- **big** — one `wo:planning` work item and one exact `work-planner`; propagate `wo:execution-agent` to risky executable children.
- **resume** — autonomous slice loop. Run each ready work item inline by default (set `sliceExecutionMode=agent` in `/work-settings` to route each slice to an isolated `work-worker`); exact planner/debugger/reviewer only when policy requires it. Do NOT ask how to run each slice — apply the coded execution policy and run. After a slice closes, continue to the next ready work item automatically (re-run `/work-resume`; use `/work-goal` for automatic `/new` per slice). Stop the loop only for: an open `type=decision` work item needing human input, a blocker/debug-needed work item, roadmap completion, or `/work-stop`.
- **goal** — autonomous current-session loop with on-demand microcompaction. Work inline; exact specialists only for the cases above. Completion requires verified evidence. Stop with `/work-stop`.
- **debug** — exact `work-debugger`, then one scoped reviewer only after a verified fix; coded finalizer commits.
- **auto** — trust the extension's deterministic classification; do not reclassify with an LLM.
- **plan/master** — use `ce-plan` and planner/advisor only when requirements are genuinely semantic or uncertain. master mode must clear the Open Question Gate: `/work-plan` scans the plan for unresolved open questions (including non-blocking ones with a stated default) and blocks roadmap creation until each is resolved via one `ask_user` with `allowComment=true`, then re-run. One delivery scope keeps the standalone roadmap path. Multiple independently completable scopes require a versioned semantic initiative proposal, coded preview, explicit approval, and coded apply; select one child for just-in-time planning and never plan or execute sibling stubs automatically.
- **remove-beads** — deterministic one-way legacy migration; it verifies export parity and backup, never commits, and stops on any mismatch.
- **migrate** — exact `work-migrator`; source and branch inspection is read-only.
- **init/status/report/usage/telemetry/roadmap/add/pause/finish** — deterministic extension paths; no agent.

## Opt-in workflow improvement reporting

This is off by default behind `workResume.selfImproving`. When enabled, `work_report_improvement` is available for an explicit, concrete ce-workflow problem with observation, expected behavior, impact, and one or more local logs. It copies accepted evidence into ignored local storage and creates one child task under the ce-workflow checkout's `Self-improving` roadmap.

Reporting never analyzes terminal workflows, launches an improver, changes, benchmarks, commits, pushes, reverts, or waits on the ce-workflow source. Source resolution is `workImprovement.sourceCheckout`, then `CE_WORKFLOW_SOURCE_DIR`, then the package checkout; a maintainer processes report tasks later through normal work-item flow.

## Handoff hygiene

Use compact helper commands (`work-summary`, `work-children-summary`, `blocker-search`, `search-summary`, `json-assert`) instead of raw roadmap JSON, CLI help, broad scans, or repeated status/diff. Specialist children receive one work item ID, concrete acceptance, relevant paths, verification, and known unrelated dirt; they must not launch subagents.

An ambiguous subagent RPC acknowledgement must not trigger a fallback writer because the first launch may already be active. Check the active-run widget before retrying.

## Optional detailed reference

Only load `references/full-policy.md` when the precomputed prompt lacks a rule needed for planning, migration, blocker lifecycle, hardware contracts, intercom, or an unusual commit/review policy. Routine inline work must not load it.
