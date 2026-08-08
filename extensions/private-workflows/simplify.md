# Private Scoped Simplification Playbook

<!-- generated; source-closure-sha256: f5525b31d981b528bea3a94e5784bbea09e5a4a59801a7f4e76dcfce37e3c38e -->

## Boundary and selection

Run only on the caller-supplied non-trivial implementation diff after self-verification and before review. Inspect the scoped diff for concrete duplication, dead flexibility, unnecessary abstraction, avoidable indirection, or code that can be made plainly smaller without changing behavior, public contracts, error handling, validation, security, or accessibility. Do not redesign or widen scope.

## Equivalent change or no-op

If no material simplification is justified, do not churn the diff; append `wo:simplify NOOP`. Otherwise make the smallest equivalent cleanup, rerun the focused verification affected by the edit, and append `wo:simplify PASS` with the command and result. Do not stage, commit, close the work item, or perform correctness review or browser testing here.

## Failure

If equivalence or verification is uncertain, restore or leave the last verified behavior unchanged, record the exact failure evidence, and stop. Missing PASS/NOOP evidence blocks the coded review/commit path.
