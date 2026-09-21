# Simplification-stage GLM ablation

Date: 2026-09-21

Purpose: test whether a separate simplification pass adds enough value to remain a mandatory per-slice stage when implementation already carries a short simplicity instruction.

## Design

- Model: `zai/glm-5.3:high` for implementation and simplification.
- Fixtures: `public-export` and `atomic-patch` from `scripts/model-relay-fixtures.mjs`.
- Arms: A = integrated simplicity instruction plus a fresh separate simplification pass; B = integrated instruction only.
- Repetitions: two per fixture and arm, with opaque labels reversed between repetitions.
- Total: eight implementation trials and four additional simplification passes.
- Every implementation ran the immutable baseline and a newly added regression check. Acceptance was then run outside the agent workspace from the fixture's held-out contract.
- Disposable roots and raw evidence: `C:/SOFT/git/ce-workflow/.pi/simplification-ablation-2026-09-21/`.
- Workflow run: `8a2d4500-ddbc-4c49-8c44-55f9eb71a7fb`.

This was a small model-controlled ablation, not a production-workflow benchmark. It did not use Astra as implementer, a blinded Opus comparison, or the six-case end-to-end CE benchmark.

## Results

| Result | Integrated + separate pass (A) | Integrated only (B) |
| --- | ---: | ---: |
| Held-out acceptance | 4/4 | 4/4 |
| Baseline/regression checks | 4/4 | 4/4 |
| Separate pass made a code edit | 2/4 | n/a |
| Separate pass returned NOOP | 2/4 | n/a |

All eight final implementations passed the same held-out functional, argument-validation, immutability and secret/prototype-safety checks.

The two editing passes found only local cleanup:

1. Replace a one-use rest array with `args.length > 2` in an 11-line command function.
2. Flatten duplicated terminal throws and inline a one-use `Object.entries` binding in an 8/19-line command/settings implementation.

The two other passes found no justified edit after inspecting alternatives and rerunning tests. They were nevertheless reported as failed by the generic mutation-worker completion guard because they correctly made no edits. This is an execution-policy mismatch, not a failed simplification: a simplifier must be allowed to return a verified NOOP.

Final production-file line counts were mixed rather than categorically better:

- `public-export`: A 12 and 11 lines; B 12 and 15 lines.
- `atomic-patch` settings: A 19 and 18 lines; B 20 and 17 lines.

The separate passes consumed 90,835 GLM tokens, 25 turns and 45 tool calls across four trials. Their summed child duration was 485 seconds; children ran in parallel, so this is not wall-clock elapsed time. Implementation trials consumed 137,315 GLM tokens, 52 turns and 78 tool calls. These are provider-usage measures, not main-developer model usage or an invoice.

## Interpretation

The separate pass can catch real small cleanups, so simplification feedback is useful. It did not catch a correctness, security, compatibility or test defect, and it did not produce a consistent final-size advantage over implementations that already received the integrated instruction. Half the passes were valid NOOPs.

For this project's stated objective, a mandatory blocking stage is not justified:

- It adds another full agent lifecycle even when no edit exists.
- It turns a healthy NOOP into a protocol edge case unless the role is explicitly non-mutating/no-op-capable.
- The useful findings are exactly the kind that the retained background `simplification`/maintainability verification can report without delaying every slice.
- GLM usage may be inexpensive, but latency, orchestration, failure handling and main-agent triage are not free.

## Decision

Delete the mandatory separate simplification workflow and its finish-gate marker. Keep:

1. The short integrated implementation instruction: reuse existing code, make the smallest complete change, remove avoidable complexity introduced by the change, and rerun relevant checks.
2. Background simplification/maintainability review where configured.
3. An explicit on-demand cleanup command only if an existing user-facing route remains useful; it must accept a verified NOOP as success.

Do not claim that this ablation proves end-to-end token or quality improvement. That requires the frozen current-vs-slim workflow benchmark specified in the slimdown plan. The ablation is sufficient only for the narrower product decision that simplification should be feedback, not a mandatory per-slice ceremony.
