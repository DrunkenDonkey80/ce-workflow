---
name: work-epic-autopilot
description: Run a Beads-backed epic in a target repository through repeated work-orchestrator resume/debug cycles while using telemetry to improve the workflow package. Use when the user wants an autonomous project-completion loop that takes a directory path, minimizes intervention, and fixes observed orchestrator friction in code.
---

# Work Epic Autopilot

Use this skill when the user wants: "take this repo directory and keep running the work workflow until the epic is done or truly blocked." It is a wrapper around the `work-orchestrator` skill, not a replacement.

## Arguments

```text
/skill:work-epic-autopilot <product-dir> [--epic <id|last>] [--workflow <workflow-package-dir>] [--max-resumes <n>]
```

- `<product-dir>` is required. It is the repository whose epic should be completed.
- `--epic` defaults to `last`.
- `--workflow` is optional. Use it when workflow/plugin friction should be fixed in a local package checkout.
- `--max-resumes` is optional safety only. If omitted, continue until a stop condition fires.

Do not hard-code product names. The directory argument is the source of truth.

## Preflight

1. Normalize all paths to absolute paths.
2. Verify `<product-dir>` exists and is a git repo:

   ```bash
   cd "<product-dir>" && git status --short --branch && bd where
   ```

3. If `--workflow` is supplied, verify it is the workflow package repo:

   ```bash
   cd "<workflow-package-dir>" && git status --short --branch && node -e "console.log(require('./package.json').name)"
   ```

4. Load `work-orchestrator` and use its `Mode: resume`, `Mode: debug`, `Mode: status`, `Mode: report`, and telemetry guidance. All product commands and role-agent `cwd` values must point at `<product-dir>`.

If the current Pi cwd is not `<product-dir>`, do not pretend slash commands changed cwd. Run the equivalent `work-orchestrator` mode from this parent session with every shell command prefixed by `cd "<product-dir>" && ...`, every file path absolute, and every role-agent launch using `cwd: "<product-dir>"`.

## Operating Loop

Repeat:

1. Inspect compact product state in `<product-dir>`: active epic, ready/debug/blocked Beads, git status, and recent telemetry. Prefer `/work-status`, `/work-report --json`, `/work-telemetry --json`, or direct `.pi/work-runs/*.jsonl` summaries over raw full Bead JSON.
2. Run a real `work-orchestrator` resume cycle for exactly one executable Bead. If slash commands are available in the target cwd, use `/work-resume <epic>`. Otherwise follow `work-orchestrator` `Mode: resume` exactly from this session using the target cwd rules above.
3. Closely monitor for errors, stalls, repeated supervisor asks, noisy parent context, excessive invocations, expensive role agents, weak handoffs, weak verification, dirty-file loops, stale intercom, or confusing stop messages.
4. If product work fails or blocks, run `work-orchestrator` `Mode: debug` / `/work-debug <bead-or-bug>` once for that blocker, then resume if it succeeds.
5. If the friction is caused by workflow behavior and `--workflow` is available, switch to `<workflow-package-dir>`, implement the smallest code fix, run its verification, then return to `<product-dir>` and continue.
6. At each phase boundary, before the next resume/debug cycle, run the phase-boundary gate below.
7. If no safe workflow code fix is obvious, record a concrete follow-up in the product Bead notes or final report, then continue only if product work is not blocked.

## Phase-Boundary Gate

Before starting the next product phase:

1. Review only friction observed in the just-finished phase.
2. If a safe `<workflow-package-dir>` fix exists, implement it, verify it, and commit it in the workflow repo before returning to product work.
3. Never mix product changes and workflow changes in one commit.
4. Do not make speculative workflow improvements. If the fix is too large or risky, record a follow-up and continue only if product work is not blocked.

## Optimization Targets

Optimize only from observed evidence in real runs, in this order:

1. Fewer required user interventions.
2. Reliable phase-to-phase progress.
3. Lower token/context waste in the parent session.
4. Noisy/specialized work moved to fresh subagents or artifacts.
5. Better telemetry and clearer error visibility.
6. Stronger verification, review, and debug handoffs.
7. Simpler workflow code with fewer moving parts.

Prefer a workflow code fix over a manual process workaround. Every safe workflow fix should prevent future users from repeating the same manual recovery.

## Workflow Fix Rules

When editing `<workflow-package-dir>`:

- Fix only the observed failure class.
- Keep the diff small; deletion/rewording beats new machinery.
- Add or update the smallest existing test/script that would catch the regression.
- Run the package verification command, usually:

  ```bash
  cd "<workflow-package-dir>" && npm run verify
  ```

- Commit verified workflow fixes before the next product phase. This skill invocation is the commit authorization for workflow-package fixes only; product commits still follow `work-orchestrator` rules.
- Return to the product repo immediately after the workflow fix is verified and committed.

## Parent Context Hygiene

- Keep the parent as coordinator only.
- Use fresh-context role agents for implementation, review, fixing, debugging, planning, and committing.
- Prefer `outputMode: "file-only"` for long role outputs.
- Keep only IDs, paths, short summaries, and next commands in the parent chat.
- Do not paste full logs, full diffs, full Bead JSON, or whole master plans into the parent.
- Use telemetry files and artifacts for bulk evidence.

## User Intervention Policy

Do not pause between phases. Ask the user only for a real product, architecture, credential, hardware, destructive-git, or verification decision that cannot be safely inferred or recorded as a blocked Bead.

## Stop Conditions

Stop only when one is true:

- the target epic is complete;
- remaining product blockers still fail after `work-orchestrator` debug and require user/product/environment input;
- workflow-package changes are needed but no `--workflow` directory was supplied and continuing would hide the same failure;
- continuing would overwrite unclassified manual changes;
- the optional `--max-resumes` limit is reached.

Final output must include: product directory, epic ID, completed/blocked status, workflow fixes made, verification run, residual blockers, and exact next command if any.
