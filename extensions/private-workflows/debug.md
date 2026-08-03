# Private Debug Playbook

<!-- generated; source-closure-sha256: 642fb1515f183430a4663ed9a2eb2ec863b4c915c363f9f9920c435df4608287 -->

## Boundary

Investigate only the assigned bug work item. Treat the work item, current Git state, named artifacts, and direct command output as evidence; inherited chat is not source of truth. Do not commit, close work items, broaden the fix, or substitute diagnosis for required verification.

## Reproduce, root cause, fix, verify

1. Reproduce the reported failure with the smallest safe command before editing. Record observed versus expected behavior and preserve the exact failing command and useful output.
2. Trace every caller of the failing boundary and establish the causal chain. Distinguish the root cause from downstream symptoms; do not patch until the chain explains the reproduction.
3. Apply the smallest fix at the shared causal boundary. Preserve unrelated behavior and existing work-item, hardware, and actor-visible contracts.
4. Rerun the smallest check that failed, then the assigned verification contract. A fix is complete only when the original reproduction and required verification pass.

## Failure and blocker evidence

If reproduction or verification cannot proceed safely after a real attempt, do not guess or report success. Preserve the command, exit or status, artifact paths, failing phase, observed versus expected behavior, touched files, current causal hypothesis, required external state or decision, and the exact next debug command. Create or reuse the caller-required blocker/debug/decision work item and leave the assigned bug open and explicitly blocked.

## Actor-visible handoff

Return the work item, reproduced symptom, root cause, fix or diagnosis-only blocker, verification result, work-item updates, and whether durable learning capture is warranted. For a learning candidate, supply one stable lowercase hyphenated key and preferred destination. End with the caller's exact resume or blocker command.
