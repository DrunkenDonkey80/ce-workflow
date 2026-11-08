# Task: retro (photobook-01 rework session)

- Source: copy of `C:\SOFT\git\rework-lab\photobook-01` (PhotoBook clone, HEAD `e5a3bbd`) into the run folder, plus copies of its three session files from `C:\SOFT\git\rework-lab\photobook-01-sessions\*.jsonl` and the driver log `photobook-01.driver.log` placed in `retro-input/` inside the copy. The ce-workflow rework recipe and `scripts/rework-lab.mjs` at the commit used by that run go into `retro-input/` too, since the friction was partly in the driver.
- Skill: `engineering/retro` plus dependency `productivity/writing-for-agents`. `disable-model-invocation: true`, so no C run.
- Ground truth: `docs/proposals/rework-lab/photobook-01.md` "Problems found" (never given to the run).

## Prompt

> Do a retrospective on the coding session in `retro-input/` (session logs, driver log, recipe and driver script). It reworked this project unattended. Suggest improvements to the agent's environment, ranked by severity, each with the evidence that shows it. Write the report to `retro-input/RETRO.md`; change nothing else.
>
> Unattended run: no one will answer questions; decide yourself and say what you decided.

## Check

`retro-input/RETRO.md` exists; no other file changed (`git status --porcelain` shows only that path and the untracked `retro-input/`).

## Rubric

| # | Item | How |
|---|---|---|
| 1 | Names the gate-wait loop (about 1 h of "awaiting gate" checkpoint commits) and traces it to the driver's gate logic (`[human]` Pick step treated as not done, or stall counter reset by checkpoint commits) | judge |
| 2 | Names the 8 pre-existing failing tests as noise the run had to rule out, and proposes a recorded known-failures baseline or similar check | judge |
| 3 | Names missing `.env` / local data (mock providers only) as an information-access gap | judge |
| 4 | Names the test-only seam (Vitest alias, no runtime switch, rollback = git revert) | judge |
| 5 | Each finding cites concrete evidence (commit, log line, session turn) | judge |
| 6 | Mechanical problems get a deterministic fix (code or check), judgement calls get prose rules | judge |
| 7 | No invented problems contradicted by the logs (count; lower is better) | judge |
| 8 | Only `RETRO.md` written | script |
