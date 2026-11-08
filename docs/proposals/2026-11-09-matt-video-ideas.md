# Ideas from Matt Pocock's videos (46 digests)

Source: `C:\Users\Flex\Downloads\video-digests` (44 on-topic digests; the Rust and TypeScript-tips videos were skipped). Read in full by five gpt-6-astra readers, each finding tied to a transcript timestamp, then cross-checked against the digests' Takeaways and our code. Raw reports: `video-ideas.task-1..5.md` in run `6d7670fe`. What we already took or rejected: `docs/upstream/mattpocock-skills.md`.

Nothing here is measured. Matt's numbers (120k-150k "dumb zone", ~100k per prototype session) are his estimates.

## A. Prompt tunings (one or two sentences each)

| # | Change | Where | Evidence |
|---|---|---|---|
| A1 | **Map is for fog, not size.** Clear multi-session work goes to Plan with session-sized slices; Map only when reaching a buildable design needs research, prototypes or several decision sessions. Matt: "if you already know the way… no need for Wayfinder"; FAQ: using it on a well-scoped feature is "the common mistake". Three readers found this on their own. | `SIZE_RULE`, map downgrade line (`plan3.ts:50-51`), sizing tests | wayfinder [11:52], v1.2 [0:54], end-to-end [8:13, 11:03] |
| A2 | **Questions you can't answer by talking ("ungrillable": how something feels or behaves) become a prototype/evidence step** in normal Plan too, instead of more guessing. Resume asking once the evidence exists. | `clarification` (`plan3.ts:46`) | 9 things [1:47-3:24], prototype [1:41-3:51], end-to-end [8:03] |
| A3 | **Prototype tickets get two shapes and leave a trail:** logic → tiny interactive state model; UI → contrasting variants on the existing page (Matt: "a more honest representation"). Record the artifact path, the converged verdict (often a mix of variants), non-obvious learnings; the handoff carries the path, and implementation removes prototype-only code. | `MAP_EXECUTE` (`plan3.ts:52`) | v1.1 [11:58], prototype [4:20-9:45], handoff [7:27-8:43] |
| A4 | **One step or ticket per usable session:** merge splits that only add handoffs, split ones that degrade before finishing; reference the plan's acceptance criteria instead of copying them. | `PROJECT_CARE`, `MAP_PROMPT` | end-to-end [12:20-13:44], v1.1 [9:16] |
| A5 | **Sharpen language, don't just check it:** propose a precise term for a vague one, test it with one concrete scenario, check the user's claims about current behavior against the code; applies in a new repo without a glossary too. | `PROJECT_LANGUAGE` | grill-with-docs [5:33-9:49, 13:34] |
| A6 | **ADR candidates name the strongest rejected alternative** and why it lost (what code can't tell you). | `PROJECT_LANGUAGE` | delete docs [1:23] |
| A7 | **Question the need** when the request has no clear user outcome: offer the smaller or no-build option before design details. | `clarification` | interviews [0:17], 9 things [5:41] |
| A8 | **ask_user's global default** still says "one question per call"; make it "ask the independent frontier together (2-4) when planning", matching Plan3. | `extensions/ask-user/index.ts:2904` | this change [0:10-1:22] |
| A9 | **Skill routing:** `diagnosing-bugs` description narrowed to unclear causes, repeated failed fixes, flaky bugs, perf regressions (an obvious few-line bug is Tiny). `two-axis-review`: read `GLOSSARY.md`/ADRs as context; say "same-context self-review" when no fresh reviewer ran; from a ticket, follow back to the parent plan's full outcome. | the two `SKILL.md` files | human review [1:02], grill-with-docs [7:04], end-to-end [14:41-16:04] |

## B. Code changes

| # | Change | Size | Note |
|---|---|---|---|
| B1 | **Plan → Map mid-grill.** Matt: when grilling turns out "I can't do this in a single grilling session", turn it into a map. We can't: `size()` refuses after the first turn (`plan3.ts:974`) and Map would overwrite the body. Add a confirmed switch that keeps request, Decisions, answered questions and turns open ones into tickets. | medium | when-not-to-grill [0:53-1:24] |
| B2 | **Glossary redefinitions at finish.** `docCandidates()` skips any term already in `GLOSSARY.md`, so a settled redefinition never lands. Offer old → new replacements, ticked like the rest. | medium | grill-with-docs [9:14], v1.3 [8:20] |
| B3 | **Compaction memory scope.** Matt: one feature's preference "influences every single conversation". Our compaction asks for "several facts per ten aging records" and stores them project-wide (`work-compaction-memory.ts:238`). Trial: drop the quota, keep auto-facts in the session checkpoint, keep explicit `knowledge`/`/wo fact`; add a test that a feature-local preference doesn't leak into an unrelated task. | small + benchmark | kill memory.md [0:23-1:20] |
| B4 | **Map frontier (`blocked-by`)** so a waiting [human] ticket doesn't block independent research. Build only when a real map stalls. | medium | wayfinder [6:37-9:42] |

## C. Experiments (benchmark first, per the Optimization Regression Rule)

- **C1** Coding effort one level lower on the accepted `/resume3` benchmark, planning unchanged (effort videos [0:37], [0:26]).
- **C2** Ultrafull checkpoint at 150k vs 200k on the same long workload (dumb zone [1:00]).
- **C3** Re-test prototype as a human-in-the-loop loop with scripted reactions. Our lab ran it unattended, so the core loop (react, combine variants, iterate) could never happen (prototype [4:33-8:38]).
- **C4** Request-prefix audit: rank system blocks and tool schemas by size from one captured request before deferring any tool (bloated tools [0:05]).
- **C5** Quieter per-edit pi-lens diagnostics plus one batched check before each commit (harness hooks [0:21]).
- **C6** A few declared mutations in the rework recipe's sensitivity check, extending its planted-bug test (mutation testing [0:11]).

## D. Docs and ledger

- README: "agent ignored or invented something": load the missing source first; if it contradicts what's already in context, F8 or a fresh session from the plan (hallucinated [0:30]).
- README: same goal → compact; separate out-of-scope goal → focused handover, original plan stays (handoff [4:20-7:15]).
- README: night mode is not isolation (no sandbox for files, network, credentials) (software factory [0:16]).
- Ledger: divergence kept on purpose: Matt opens a fresh session per ticket, we continue with compaction (C2 tests the threshold). `teach` reconsidered only as "explain this before I answer" via handover to a notes folder. `retro` only as a manual sampled audit, never automatic (Matt: "you don't want to automate this"). `to-questionnaire`: export questions for another person to answer is not covered. `wizard`: secrets go through a script, never the model, if a credential setup ever comes up.

## Skip

Whole-round dictation field (until someone asks), a `/teach` skill, scorecard goal loop (rework recipe §4 covers it), hub reducer rewrite, AFK sandbox runner, automatic retro, mandatory TDD (v1.1/factory show red-green-refactor, but give no outcome evidence).
