# Claude-BugHunter: what we took and what we left

Upstream: [elementalsouls/Claude-BugHunter](https://github.com/elementalsouls/Claude-BugHunter) (MIT code; CC BY 4.0 for docs, wordlists, regex catalogs and rubrics, `README.md:335`). Reviewed at commit `0e70a021e59d6875004e7a563f8511aca2ba3bc1` (2026-11-19); security-hunting content was read only as material for the model-switch verdict. Plan `docs/plans/done/2026-11-19-mine-loopforge-claude-bughunter-and-skillevaluator-for-ce-wo-3f8f9ab7-plan3.md`; review `docs/proposals/2026-11-19-loopforge-bughunter-skillevaluator-review.md` (areas B1-B8); its skill lint run on our skills: `docs/proposals/repo-review-3f8f9ab7/keyless-checks.md`.

Nothing taken, so no catch-up watch.

## Adopted

None.

## Not covered, not recommended (user may revive)

B3 staged-blob leak check before commit (the tracked tree holds only 3 deliberate test fixtures).

## Already covered here

B1 skills on/off evals (X3 ablation, skills-lab), B2 false-positive traps (skills-lab code-review decoys N1/N2 and false-positive count), B4 deterministic first (project map, jev tools, read-only reviewers), B5 discipline skills (`skills/diagnosing-bugs`, the `screen_read` rule to capture only the app under test), B7 memory and resume (knowledge store, Plan3, `compaction_note`).

## Skipped

B3 `sources:` lint and identifier denylist (house conventions for bounty targets), B6 multi-harness installer and doc counts (Pi packages; no counts in our docs), B8 hunting skills (out of scope) and the model-switch note (sessions record only the requested model; the hub notes cache misses after a model switch).
