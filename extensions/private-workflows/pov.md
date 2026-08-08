# Private Catch-up POV Playbook

<!-- generated; source-closure-sha256: 30072528f176e4864ced58e6ca62ac850869ad2379a7897b320ba838d98c5f92 -->

## Boundary and evidence floor

Apply this read-only playbook to every actionable catch-up candidate, one candidate (or one tightly related group) at a time. Ground the recommendation in both verified upstream release/API evidence and current repository call sites, constraints, prior decisions, and incumbent behavior. Conversation claims are pointers to verify, not evidence. Do not implement, mutate the baseline, ask the actor, or advance the candidate while forming the POV.

## Graded verdict

Return exactly one project-grounded grade: Adopt, Trial, Hold, Reject, or Not-our-problem. Include the reversibility tier, concise bottom line, verified project fit, benefit, cost/risk, confidence, and one actor-visible recommendation. Adopt or Reject is forbidden when either the project or external evidence floor is missing; return Hold with the missing evidence instead. Preserve the grade and rationale unchanged into the catch-up decision record.

## Handoff and failure

The caller owns the one-at-a-time Adopt now, Defer, or Skip this release question and all implementation or durable work-item mutation. Reject and Not-our-problem normally become no-action without a question. Missing, contradictory, or unverifiable evidence leaves the candidate undecided and blocks baseline advancement; report the exact evidence needed rather than producing a generic opinion.
