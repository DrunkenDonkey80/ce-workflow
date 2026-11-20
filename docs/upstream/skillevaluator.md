# SkillEvaluator: what we took and what we left

Upstream: [NVIDIA/SkillEvaluator](https://github.com/NVIDIA/SkillEvaluator) (Apache-2.0). Reviewed at commit `d8ddd4f76de78dfc3425d0a829d2c7dc9ccb9037` (2026-11-19). Plan `docs/plans/done/2026-11-19-mine-loopforge-claude-bughunter-and-skillevaluator-for-ce-wo-3f8f9ab7-plan3.md`; review `docs/proposals/2026-11-19-loopforge-bughunter-skillevaluator-review.md` (areas S1-S10); keyless `quality-check`, `harness-check`, `pii-scan` and `security-scan` runs on our skills: `docs/proposals/repo-review-3f8f9ab7/keyless-checks.md`.

Catch-up watch: `NVIDIA/SkillEvaluator` in `extensions/work-catch-up-baseline.json`, scoped to `LICENSE`, `NOTICE` and `docs/metrics-reference.mdx` (D-09, user: "Only when built"). S5 is a re-implementation, not a port: no SkillEvaluator code or NOTICE text is copied.

## Adopted

Umbrella plan: `docs/plans/done/2026-11-19-build-the-three-accepted-loopforge-and-skillevaluator-ideas-5e4d224a-plan3.md`.

| Idea | Upstream path (idea source) | Ours | Evidence |
| --- | --- | --- | --- |
| S5 Honest small-sample results: judge errors and n/a apart from failures, both-direction pair counts, 95% Wilson intervals, a "not established" line when they overlap | `docs/metrics-reference.mdx:24-27,58,191-193,289-290,412,607` | `scripts/compare-benchmark-runs.mjs`, `scripts/judge-common.mjs`, `scripts/judge-handoff.mjs`, `scripts/judge-design-extras.mjs` | UB-01 5ff59103, UB-02 34d93a6d; `test-compare-benchmark-runs` and `test-judge-common` (mutants caught). On the X6 self-verify runs: 15/15 vs 14/15, intervals 80–100% vs 70–99%, "not established" |

## Rejected

S6 grader validation against a hand-labelled suite (`docs/grader-validation.mdx`): recommended by both reviewers, rejected by the user at idea review.

## Not covered, not recommended (user may revive)

S4 skill routing trial (paid; our 3 skills are already read on demand 59/11/9 times), S8 invisible-unicode warning in the extension scout (0 of 207 installed instruction files had any), S10 trace case queue (no recurring failure missing from fixtures).

## Already covered here

S2 harness check (Pi's own loader test, `scripts/test-work-plan3.mjs:1464`), S3 dedup (agents audit, context_report), S4 live lift (X3 ablation, skills-lab), S7 context cost (`scripts/context-report.mjs`), S10 datasets from traces (compaction recall benchmark).

## Skipped

S1 static quality grade (our skills score 88.5/B on publication-template findings only), S9 HTML/JUnit reports and CI templates (no CI; hub and `npm run verify`).
