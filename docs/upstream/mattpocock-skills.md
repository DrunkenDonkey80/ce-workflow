# Matt Pocock's skills: what we took and what we left

Upstream: [mattpocock/skills](https://github.com/mattpocock/skills) (MIT). Tested and adopted at commit `4ae2317` (2026-10-31). Evidence: plan `docs/plans/2026-11-08-adopt-matt-pocock-skill-ideas-project-care-questioning-skill-79614d24-plan3.md`, desk review `docs/proposals/2026-11-08-mattpocock-skills-review.md`, lab results `docs/proposals/skills-lab/results.md`.

`/wo → Catch up packages` watches this repository (entry `mattpocock/skills` in `extensions/work-catch-up-baseline.json`). When upstream moves past the reviewed commit, the catch-up plan diffs the adopted skills' paths below, desk-reviews new skills, and offers each finding as an idea to test, adopt or reject. Update this file in that plan.

## Adopted

| Upstream skill (path under `skills/`) | What we took | Where it lives here | Evidence |
|---|---|---|---|
| `productivity/grilling` (+ `grill-me`) | Ask in rounds: the whole frontier of answerable questions, each with a recommendation; facts are the agent's job | Plan3 planning prompt (`extensions/plan3.ts`), 6eb96eb | PC-09 blind judge: question items equal; keep |
| `engineering/ask-matt` (only its sizing branch, from Matt's "new session" flow) | Size the request first: Tiny (just do it), Plan, Map | `plan3 size` action, 271109e; fixes 38e8baa, 8ac7ff0 | PC-09: small request $1.19 → $0.30, 425 s → 131 s |
| `engineering/wayfinder` | Multi-session decision map: destination, fog, out of scope, typed ticket steps | Plan3 map plans, cdc3be9 | Not yet exercised live (no run picked Map) |
| `engineering/codebase-design` (vocabulary via plan 54ff64f3) | Project care: per touched module, patch versus prefactor, with brakes (churn, deletion test, no one-adapter seam) | Plan3 planning and execute prompts, 6eb96eb | PC-09: patch-vs-prefactor reasoning up on P2 and P3 |
| `engineering/to-tickets` | Thin end-to-end slices, prefactor first, wide refactors as expand → migrate → contract | Plan3 planning prompt, 8f948a2 | Shipped with PC-09's keep verdict |
| `engineering/domain-modeling` (+ `grill-with-docs`) | Lazy `GLOSSARY.md` and ADRs (hard to reverse, surprising, a real trade-off) | Plan3 project-language prompt; finish checklist in `extensions/plan3-docs.ts`, 505282c | One glossary term written in the P1 end-to-end run; ADRs not yet exercised |
| `engineering/code-review` | Two-axis review (Standards and Spec, reported side by side) | `skills/two-axis-review/`, 09b7a78 | Lab: 8 of 9 planted defects versus 5.5 to 6, at 2.9× cost; on request only |
| `engineering/diagnosing-bugs` | Repro command first, ranked falsifiable hypotheses, regression test red before the fix | `skills/diagnosing-bugs/`, 09b7a78 | Lab: better process and tests, same outcome, 1.6× cost; on request only |
| `productivity/writing-for-agents` (levers only) | Leading words, positive phrasing, sharp completion criteria when writing prompts | The Plan3 prompt text written in PC-01 to PC-06 | The AGENTS.md-writing use was rejected (below) |
| `engineering/prototype` (ticket type only) | "prototype" as a map ticket type: throwaway, marked, verdict in Decisions | Map plans, cdc3be9 | The skill itself was rejected (below) |

## Rejected after testing

| Upstream skill | Why |
|---|---|
| `engineering/tdd` | Better process, same outcome quality, material regression in tokens, turns and runtime |
| `engineering/retro` | Ranked worse by the blind judge at higher token cost |
| `engineering/prototype` (as a skill) | No measurable effect; the prototype step never happened even when forced |
| `productivity/writing-for-agents` (writing AGENTS.md) | No AGENTS.md, forced or not, made the next task cheaper or more correct |

## Rejected at idea review

| Upstream skill | Why |
|---|---|
| `misc/git-guardrails-claude-code` | A regex hook is no security boundary; the git rules already live in AGENTS.md |
| `engineering/pr` | No PR workflow here; its "one-way door" test overlaps the adopted ADR test |

## Already covered here

`engineering/ask-matt` (the router itself: Plan3), `engineering/implement` (`/resume3` execution), `engineering/improve-codebase-architecture` (rework recipe, plan 54ff64f3), `engineering/research` (researcher agent, research mode), `engineering/to-spec` (`/plan3 write`), `productivity/handoff` and `in-progress/claude-handoff` (intercom handover), `in-progress/chief-of-staff` (night mode, logs, knowledge), `productivity/to-questionnaire` (Plan3 open questions; exporting questions for another person to answer is not covered).

## Skipped

Issue-tracker flows (`engineering/triage`, `engineering/implement-spec`, `engineering/setup-matt-pocock-skills`), project-specific setup (`misc/setup-pre-commit`, `misc/migrate-to-shoehorn`, `in-progress/setup-ts-deep-modules`, `engineering/wizard`), writing and course tools (`in-progress/writing-beats`, `writing-fragments`, `writing-shape`, `misc/scaffold-exercises`, `productivity/teach`), and out of scope (`in-progress/loop-me`, `in-progress/software-factory`, `productivity/wait-what`). Reasons per skill: the desk review. Narrowed after the videos: `productivity/teach` only as "explain this before I answer", through a handover to a notes folder, if ever; `engineering/retro` only as a manual sampled audit, never automatic (Matt: "you don't want to automate this"); `engineering/wizard`: if a credential setup ever comes up, secrets go through a script, never the model.

## Divergences kept on purpose

- Matt opens a fresh session per ticket; we continue in one session with compaction. Experiment C2 in the video proposal tests the threshold (150k vs 200k).

## From the videos

Ideas from 46 video digests: `docs/proposals/2026-11-09-matt-video-ideas.md`. Done: A1-A9 prompt tunings and skill routing (50cca66), B1 Plan → Map mid-grill (39fa417), B2 glossary redefinitions at finish (f71de98), B3 compaction auto-facts limited to observed facts (80c1de7), D docs (README and this ledger). Open: B4 map frontier (only when a real map stalls), C1-C6 experiments (a benchmark plan, nothing run yet).
