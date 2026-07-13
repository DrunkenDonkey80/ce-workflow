---
name: work-orchestrator
description: Drive uncomputed Beads-backed /work-* requests. Do not load for WO_INLINE_V1 or prompts that already contain precomputed extension state; those prompts are self-contained.
---

# Work Orchestrator

## Fast rule

When the prompt contains `WO_INLINE_V1` or says it has precomputed extension state, trust that state. The prompt is the execution contract: do not rediscover the epic/Bead, reread this skill, dump Beads JSON, or load the full policy reference. Verify only that named files/state are still fresh, then execute the named action.

Work directly in the current session by default. Use code for intake, routing, bounded validation, commit, close, and push. Do not call `subagent list`; the extension selects exact specialist names. Launch a role only when it adds distinct judgment:

- `bead-planner`: ambiguous, architectural, or large semantic slicing;
- `bead-debugger`: reproduced failure needing root-cause investigation;
- `bead-worker`: high-risk work that benefits from an isolated writer;
- `bead-reviewer`: sensitive, large, hardware/live-evidence, UI-acceptance, or ambiguous diff;
- `bead-fixer`: concrete reviewer findings only;
- `bead-migrator`: legacy artifact/branch reconciliation.

Routine work gets no planner, reviewer, or committer agent. Never launch a second writer/reviewer when equivalent passing evidence exists. `bead-committer` is an exceptional fallback only; normal commits use the coded finalizer.

## Source of truth and safety

- Beads is durable work state; git is code state; chat is disposable.
- Never overwrite manual edits. Stop for conflicting dirt, credentials, destructive production actions, or a genuine product/architecture decision.
- Project verification contracts are mandatory, including real hardware evidence when required.
- Failed verification stays open and becomes compact Bead evidence. Root-cause work becomes/reuses a `wo:debug` bug; unavailable external prerequisites become a blocked decision.
- Work one writer at a time unless isolated worktrees were explicitly chosen.

## Inline execution

For small/medium/routine resume work:

1. Trust coded target selection and claim; do not rerun broad preflight.
2. Read only task-named files/symbols. Search only when a required path is missing.
3. Implement the smallest correct change, preferring existing code, stdlib, and one-shot scripts for deterministic text/JSON transforms.
4. Pass the smallest real verification directly to the coded finalizer; do not run it separately first unless diagnosing a failure.
5. Finish once with:

```text
node <work-helper.mjs> finish-task <bead-id> --max-files <2|8> --message "<summary>" --verify "<command>" [--expect "<stdout>"] --push
```

For JSON use `--json <file> --equals <path=value>`. The helper enforces file scope and sensitive-path review, records `wo:verify-check`, commits, closes, amends Beads close state, pushes only with an upstream, and checks cleanliness.

If it reports independent review required, launch exactly one `bead-reviewer`, record PASS in the Bead, and rerun with `--reviewed`. If scope or verification fails, do not commit/close.

## Modes

- **small** — inline, two implementation files maximum.
- **med** — inline by default, eight files maximum; escalate to big if semantic slicing is needed.
- **big** — one `wo:planning` Bead and one exact `bead-planner`; propagate `wo:execution-agent` to risky executable children.
- **resume** — coded one-Bead boundary. Inline routine work; exact planner/debugger/high-risk worker only when policy requires it. Stop after one executable Bead.
- **goal** — autonomous current-session loop with on-demand microcompaction. Work inline; exact specialists only for the cases above. Completion requires verified evidence.
- **debug** — exact `bead-debugger`, then one scoped reviewer only after a verified fix; coded finalizer commits.
- **auto** — trust the extension's deterministic classification; do not reclassify with an LLM.
- **plan/master** — use `ce-plan` and planner/advisor only when requirements are genuinely semantic or uncertain. master mode must clear the Open Question Gate: `/work-plan` scans the plan for unresolved open questions (including non-blocking ones with a stated default) and blocks epic creation until each is resolved via one `ask_user`, then re-run.
- **migrate** — exact `bead-migrator`; source and branch inspection is read-only.
- **init/status/report/usage/telemetry/roadmap/add/pause/finish** — deterministic extension paths; no agent.

## Opt-in autonomous workflow improvement

This is off by default behind `workResume.selfImproving`. Terminal workflows are analyzed once in code; ordinary signals accumulate before any model launch, while hard regressions may become actionable after one run. Source resolution is `workImprovement.sourceCheckout`, then `CE_WORKFLOW_SOURCE_DIR`, then a valid package-root Git checkout. Missing or unsafe source state defers without consumer edits. Improvement, benchmark, validation, and revert markers never generate nested candidates.

Normal work does not push by default. The narrow opt-in exception lets the coded coordinator commit and push the synchronized current source branch only after lease, verification, benchmark, and independent-review gates pass. Post-push failure uses a normal revert commit; never force-push or discard unrelated work. Print and JSON report modes do not queue autonomy.

## Handoff hygiene

Use compact helper commands (`bd-summary`, `bd-children-summary`, `blocker-search`, `search-summary`, `json-assert`) instead of raw epic JSON, CLI help, broad scans, or repeated status/diff. Specialist children receive one Bead ID, concrete acceptance, relevant paths, verification, and known unrelated dirt; they must not launch subagents.

An ambiguous subagent RPC acknowledgement must not trigger a fallback writer because the first launch may already be active. Check the active-run widget before retrying.

## Optional detailed reference

Only load `references/full-policy.md` when the precomputed prompt lacks a rule needed for planning, migration, blocker lifecycle, hardware contracts, intercom, or an unusual commit/review policy. Routine inline work must not load it.
