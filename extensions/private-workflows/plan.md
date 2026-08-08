# Private Plan Playbook

<!-- generated; source-closure-sha256: f76bca616b02d347b2126cf3082dca9ff5d18045b05272041c9960fc083e573f -->

## Boundary

Convert the caller's source into an implementation-ready plan. Plan only: do not implement, debug, review code, create unrelated work, or invoke a public Compound Engineering skill. The ce-workflow caller owns roadmap mutation and the final actor-visible next action.

## Clarification and depth

1. Read every named source artifact and settled decision before planning. Ask exactly one focused clarification per turn when the input is broad, important, contradictory, or underspecified; never replace a required product or architecture decision with an assumption.
2. Honor the caller-selected depth. Lightweight uses strong local patterns and skips flow analysis and external research. Standard adds repository flow analysis. Deep performs the full warranted research and deepening pass. Depth changes evidence effort, not requirement preservation or the final quality gate.
3. Inspect the repository, history, project instructions, and available learnings only enough to identify the real architecture, affected files, reusable patterns, boundaries, and verification seams. Record requested-but-unavailable evidence rather than pretending it ran.

## Requirement preservation and self-audit

Preserve every decided requirement, constraint, non-goal, actor-visible flow, acceptance example, authoritative reference, and open question. Trace each source decision to a plan requirement, implementation unit, verification proof, explicit open question, or intentionally dropped-with-rationale note. Keep product scope unchanged unless the user explicitly approves a substantive change.

After drafting, self-audit for missing source decisions, weak or subjective proof, uncovered failure behavior, cross-layer effects, unsafe sequencing, and implementation units that are too broad. Resolve each material uncertainty by fixing the plan, asking one blocking question, recording a decision/blocker instruction, or documenting an explicit waiver. Never leave a blocking uncertainty as passive risk prose.

## Artifact and Open Question Gate

Write the caller-requested Markdown plan under `docs/plans/`. A master plan includes a goal capsule, product and planning contracts, stable implementation units with Goal/Files/Approach/Test scenarios/Verification, scope boundaries, risks, sources, a verification contract, and definition of done. A slice plan stays compact and contains exactly the caller-requested implementation unit. Set implementation-ready metadata when producing a complete software plan.

Keep unresolved questions explicit and classify blocking versus deferred. Do not bootstrap, attach, or hand implementation a plan with blocking open questions. Run the caller-provided work-helper bootstrap command when present; if its Open Question Gate blocks, ask each reported decision through the platform's blocking question UI, fold the answer into the plan, and rerun the same helper.

## Actor-visible handoff

Follow the caller's exact handoff: master planning returns the hardened plan and coded roadmap/initiative next action; slice planning appends the requested `wo:slice-plan` note and stops for the next resume. Do not show the legacy post-generation menu, invoke legacy `ce-work`, or invent a different next command.
