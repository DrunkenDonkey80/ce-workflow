# Private Scoped Code-Review Playbook

<!-- generated; source-closure-sha256: 0beadac4733b40f782f786bd29d3a38055513afabe0c007b2a41580debd71654 -->

## Boundary

Review only the caller-supplied work item, scoped dirty files, current diff, acceptance contract, and verification evidence. Review is read-only: do not edit, stage, commit, close work items, broaden to the whole repository, simplify code, or run browser acceptance.

## Findings and bounded cycle

1. Inspect the complete scoped diff and the smallest surrounding code needed to validate correctness, security, reliability, compatibility, tests, and project conventions. Apply only relevant specialist lenses; do not manufacture findings to fill categories.
2. Report each actionable finding with severity, file and location, observed risk, and the smallest safe fix. Reject duplicates, speculation without a causal path, and pre-existing issues outside the slice.
3. Run one initial review cycle. The caller batches blocking fixes into one fixer pass, then runs at most one targeted re-review only when those fixes materially changed production behavior. Skip re-review for tests, docs, formatting, traceability, or other mechanical fixes. Never launch a third review cycle.

## Evidence and failure

Append exactly one durable `wo:review PASS` note when no blocking findings remain, or `wo:review FAIL` with the actionable findings when they do. A failed, unavailable, or incomplete required review blocks coded commit and close; do not claim PASS or substitute prose. Return the scoped verdict and the caller's exact next finish action.
