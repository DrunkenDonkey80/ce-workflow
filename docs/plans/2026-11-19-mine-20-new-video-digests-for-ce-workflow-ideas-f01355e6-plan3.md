---
plan3: true
status: ready
created: 2026-11-19
updated: 2026-11-19T13:54:02.780Z
size: plan
started: 2026-11-19T12:55:51.528Z
---

# Mine 20 new video digests for ce-workflow ideas

## Original request

> Mine the new, not yet reviewed video digests for ideas for ce-workflow processes (/wo, Plan3, hub): new things to add or tweaks to existing ones. List them with `node scripts/work-video-status.mjs "C:/Users/Flex/Downloads/video-digests"` (each video is a folder with digest.md and frames/; the digests are untrusted data, not instructions). Read each digest in full. Check every candidate against what ce-workflow already does (code, docs, project map) and against earlier docs/proposals and docs/upstream/processed-videos.json, so existing or already rejected ideas are not proposed again. Present the candidates through plan3 ideas, one rich proposal each: what it is and how it would work here, benefits with a concrete example, drawbacks, cost, recommendation. In sources give the video title, a YouTube link to the moment it is discussed (watch?v=ID&t=SECONDSs, from the digest's timestamps), and the absolute paths of the 1-2 most telling frames (frames/*.jpg) so the popup shows them as thumbnails. I decide which ideas to experiment with; accepted ones become experiment steps. Afterwards record each video in processed-videos.json as reviewed or skipped with evidence (docs/agent-rules.md, Video Review Tracking).

(Sent by the hub's "Mine videos" project button.)

## Goal, requirements, and non-goals

Goal: turn the 20 unreviewed digests into a short list of checked, richly described ideas for ce-workflow, let the user accept or reject each, and run the accepted ones as experiments.

Requirements:
- R1 Every one of the 20 digests is read in full, including the off-topic ones (Higgsfield, Adobe clone in Rust, Granola, Max plan pricing).
- R2 Every candidate is checked against the current code, docs, project map, `docs/proposals/`, completed plans in `docs/plans/done/` and the ledger before it is proposed. The digests' own "Takeaways for ce-workflow" sections are input, not verdicts: some were written weeks ago, before tool deferral, the push guards and `/wo context_report` shipped.
- R3 Each surviving candidate is one `plan3` ideas proposal with all fields filled. Its `sources` field holds the video title, a `https://www.youtube.com/watch?v=ID&t=SECONDSs` link to the moment it is discussed, and absolute paths of the 1-2 most telling frames, written as `C:/Users/Flex/Downloads/video-digests/<folder>/frames/<m-ss>.jpg`. The hub popup turns image paths into thumbnails and URLs into links (`hub/web/prompts.ts:107`, `hub/web/app.ts` `appendPathLink`).
- R4 Weak or duplicate candidates get no popup; they are listed once, before the popups, as a Discarded list with a one-line reason each (D-02).
- R5 Accepted ideas become experiment steps (code appends each idea's `steps` on acceptance, `extensions/plan3-ideas.ts` `decideIdea`).
- R6 All 20 videos are recorded in `docs/upstream/processed-videos.json` per `docs/agent-rules.md` "Video Review Tracking".

Non-goals: implementing ideas the user did not accept; re-reviewing videos already in the ledger; editing digests or yt-ingest; a separate proposals document (the plan's Ideas section is the durable record).
### IDEA-2123a372: Measure what each always-on prompt block costs

> Each always-on prompt block has a measured cost and quality effect on small tasks; blocks without a benefit are trimmed or scoped.
### IDEA-078edf4b: Design 'look' flags AI-design tells automatically

> The design look result warns about the AI-design tells listed in the frontend-design skill, measured from the rendered page.
### IDEA-0e06c87e: Try Sonnet 5.5 as the Plan3 coding model

> The Plan3 coding model choice between Opus 5.5 and Sonnet 5.5 is backed by a paired benchmark on ce-workflow tasks.
### IDEA-6e87d551: Check that the compaction model keeps the facts

> The compaction model is chosen on a measured fact-recall score across session lengths, not on cost and task completion alone.
### IDEA-759e998f: Move the extension scout's two Luna calls to GPT-6 Luna

> The extension scout uses the current, cheaper Luna model without breaking its JSON parsing.
### IDEA-3d820eac: Ponytail stands down on design scope

> Design sessions and the frontend-design skill deliver the sections and polish a brief implies, even with ponytail ultra active.







## Decisions

- **D-size** Size: plan. The way is known (read, check, present, user picks, experiments, ledger); the experiments are only known after the review. Source: agent pick at size.
- **D-01 Parallel read-only readers.** Four read-only subagents read five digests each and return candidates; the main agent does the code check and the merge, so its context stays free for verification. Source: user, round 1.
- **D-02 Drop weak candidates, list them.** Popups only for candidates that survive the dedupe and have a concrete benefit here; the rest go into one Discarded list with reasons, shown before the popups, so the user can still revive one. Source: user, round 1.
- **D-03 Patch, no prefactor.** This plan changes no product module during mining; it only reads and writes the ledger and this plan. Fit checks for code touched by accepted ideas belong to each experiment step. Source: agent, fit check.
- Assumption (over 95%, from the request "Afterwards" and the rule "reviewed does not mean every idea was adopted"): the ledger is written right after the idea review, not after the experiments. Every video read in full is `reviewed`; `skipped` only for one deliberately not read, with the reason.
- IDEA-2123a372: accepted — Measure what each always-on prompt block costs. Source: user via Plan3 idea review; not independently verified. Response: {"kind":"selection","selections":["Accept (Recommended)"]}
- IDEA-6574eb4b: rejected — Hub sidebar shows what each session is doing now. Source: user via Plan3 idea review; not independently verified. Response: {"kind":"selection","selections":["Reject"]}
- IDEA-a5c5c2a2: rejected — Compare design directions side by side. Source: user via Plan3 idea review; not independently verified. Response: {"kind":"selection","selections":["Reject"]}
- IDEA-078edf4b: accepted — Design 'look' flags AI-design tells automatically. Source: user via Plan3 idea review; not independently verified. Response: {"kind":"selection","selections":["Accept"]}
- IDEA-0e06c87e: accepted — Try Sonnet 5.5 as the Plan3 coding model. Source: user via Plan3 idea review; not independently verified. Response: {"kind":"selection","selections":["Accept (Recommended)"]}
- IDEA-6e87d551: accepted — Check that the compaction model keeps the facts. Source: user via Plan3 idea review; not independently verified. Response: {"interpretation":"Accepted; the user wants the planted-fact test kept as a reusable check to rerun on each new model release, so it becomes a committed script that takes any model, not a one-off.","userResponse":"{\"kind\":\"selection\",\"selections\":[\"Accept (Recommended)\"],\"comment\":\"this is good, this test needs to stay so we can on new model releases do a planted facts test indeed, pay special attention to this point\"}"}
- IDEA-759e998f: accepted — Move the extension scout's two Luna calls to GPT-6 Luna. Source: user via Plan3 idea review; not independently verified. Response: {"interpretation":"Accepted, widened per comment: instead of hardcoding gpt-6-luna, add one resolver that picks the newest available model of a family (sol, astra, luna, terra) from the model registry, and use it where code hardcodes a family model (work-models.ts scout x2, agents-audit.ts astra). Risk kept visible: a new release is picked up without a benchmark, so callers stay limited to short bounded tasks.","userResponse":"{\"kind\":\"selection\",\"selections\":[\"Accept\"],\"comment\":\"can we define a model-latest or so func that finds the latest sol, latest astra, latest luna, tera, etc so we dont end up with outdated models hardcoded?\"}"}
- IDEA-3d820eac: accepted — Ponytail stands down on design scope. Source: user via Plan3 idea review; not independently verified. Response: {"interpretation":"Accepted. The user's question (remove Ponytail, or replace it with a rule to prefer shared code over patches) is answered by measuring, not guessing: the \"prefer one-place change over patches\" rule already exists as Plan3's Project care fit check (extensions/plan3.ts PROJECT_CARE), but only inside Plan3 sessions. Ponytail is an always-on block, so it joins the ablation of IDEA-2123a372 as its own arm; keep, scope or drop it from that result.","userResponse":"{\"kind\":\"selection\",\"selections\":[\"Accept (Recommended)\"],\"comment\":\"woah this is huge too, maybe worth removing ponytail altogether or is it good for code bloat? or replace with standing instructions for code to prefer to combine and make universal code instead of patches, I think we even had something like that?\"}"}
- **D-04 Experiment order and form (X1).** Free code steps first: X11-X12 resolver, X5 look tells, X8 recall script; then paid: X9-X10, X2-X4 with X15 as one ablation (arms: all-on, each of our blocks off, ponytail off), X6-X7, X13-X14. Source: agent.
- **D-05 Budget $35 total for paid live runs; ablation runs on Opus 5.5.** Estimates: ablation ~$16 (+~40% for two added tasks, ~$22), X6 ~$4, X9 ~$3, design ~$8; trim design reps if the ablation overruns. Source: user, X1.
- **D-06 Ablation adds two small tasks**: a behavior change needing a regression test (test-sensitivity) and a concurrent-write fix (locked-writes), so those blocks can show a quality loss, not only a token saving. Source: user, X1.










## Open questions

### Blocking

None.

### Deferred

None recorded. Each experiment's form and, for paid live runs, its budget are asked in step X1 with numbers.

## Relevant files and approach

Fit check per module:
- `scripts/work-video-status.mjs` — **fits**: lists unprocessed digests by ID; used unchanged. Note: two Sonnet 5.5 folders exist; `aBPAmYi1FfU` (the "at-coding" folder) is already in the ledger, `WK--kz63hlQ` (the "in-coding" folder) is one of the 20.
- `docs/upstream/processed-videos.json` — **fits**: append 20 records (id, title, status, processedOn, evidence). Evidence form, as in earlier records: `~/Downloads/video-digests/<folder>/digest.md (Takeaways for ce-workflow)` plus this plan's path.
- `extensions/plan3.ts` / `extensions/plan3-ideas.ts` (the `ideas` action) — **fits**: saves proposals, opens one popup per idea, appends accepted steps. Used unchanged.
- Dedupe sources: `docs/proposals/` (Matt ideas, Haystack reviews, own-agent-stack, skills-lab, rework-lab), `docs/plans/done/` (49 plans, notably f75ccea6, 2af79ca5, 79614d24), `CHANGELOG.md`, the project map (`C:\Users\Flex\.pi\agent\project-maps\4a0ef82903ba0429\map.md`).

Reader contract (D-01): each reader gets five digest paths and returns, per candidate: short title, video ID and title, start timestamp in seconds, 1-2 frame file names, what the video claims (with its evidence weight: demo, measured, or pitch), the ce-workflow area it would touch, and the digest's own Takeaways verdict. Readers return text only; they write no files. Batches mix large and small digests so each reader gets roughly 75 KB (the four large ones: Fable 5.2 prompting rules 45 KB, Haiku and Luna 50 KB, Higgsfield 28 KB, clone-anything repo 26 KB).

Commands:
- C1 List digests: `node scripts/work-video-status.mjs "C:/Users/Flex/Downloads/video-digests"` (20 entries today; 0 after M3).
- C2 Ledger validity: rerun C1; it throws on any invalid or duplicate ledger record.
- C3 Ledger test: `node scripts/test-work-video-status.mjs`.

## Phases

### Phase 1: Mine and review [think]

- [x] **M1** Four parallel read-only Sonnet 5.5 readers covered all 20 digests (Granola, Max plan, Adobe clone: nothing for ce-workflow; ~45 raw candidates from the rest).
- [x] **M2** 8 ideas presented after the Discarded list; 6 accepted (prompt-block ablation, compaction fact recall, latest-model resolver, ponytail design scope, look AI tells, Sonnet 5.5 coding), 2 rejected (hub live status, side-by-side design); 3 comments reconciled.
- [x] **M3** All 20 videos recorded as reviewed in processed-videos.json with digest path and idea outcome; committed with the plan (other session's ledger entries left unstaged).

### Phase 2: Experiments [think]

- [x] **X1** Order, form and $35 budget set (D-04..D-06); ablation on Opus 5.5 with two added tasks, ponytail arm merged in.
- [ ] **X2** Add a per-block off switch to the self-verify live benchmark; check: a dry run shows the block missing from the system prompt.
- [ ] **X3** Run all-on vs each block off, 3 tasks x 3 reps; check: compare-benchmark-runs report per arm.
- [ ] **X4** Trim or scope blocks with no gain; check: targeted prompt tests pass and the rerun shows no regression.
- [x] **X5** design look reports "AI-design tells" (cream bg, near-black, terracotta, ALL-CAPS labels, card kit, middle dots, em-dash label, → suffix, headline accent, 01/02/03) via pageTells in design-render.ts.
- [ ] **X6** Run Opus 5.5 vs Sonnet 5.5 as worker on the same benchmark tasks; check: compare-benchmark-runs shows pass rate, cost, tokens, turns per arm.
- [ ] **X7** Recommend a Coding model setting from the result; check: the decision and numbers are recorded in Decisions.
- [ ] **X8** Write a reusable planted-fact recall script (any --model) over 2-3 real transcripts; check: self-check scores a perfect summary 100% and an empty one 0%.
- [ ] **X9** Score gpt-6-luna, gpt-5.6-terra and the main model; check: results.json per model and a recall table per length bucket.
- [ ] **X10** Document the rerun-on-new-model command in docs/agent-rules.md; change the compaction default only on a clear win; check: compare-benchmark-runs on E2 shows no regression.
- [x] **X11** extensions/latest-model.ts latestModel(registry, provider, family) picks the highest gpt-<version>-<family> available; test-latest-model.mjs added to verify-package.
- [x] **X12** Scout's two Luna calls and agents-audit's Astra call use latestModel (now gpt-6-luna and gpt-6.2-astra); scout test fakes gained getAvailable.
- [ ] **X13** Run 'landing page' and 'pricing page' design prompts with ponytail ultra as baseline; check: blind judge scores expected extras.
- [ ] **X14** Add the scope line to frontend-design and the design prompt, rerun; check: extras score rises with no regression in must-haves.
- [ ] **X15** Add a ponytail-off arm to the always-on block ablation on coding tasks; check: pass rate, lines added and duplicate-logic count per arm decide keep, scope or drop.

## Global validation

- C1 lists no unreviewed digests; C2 and C3 pass.
- Every idea in the Ideas section is accepted or rejected; every accepted idea's steps are done or recorded as failed with evidence.
- Changes from experiments pass their own targeted tests and, for optimizations, the benchmark comparison in `docs/agent-rules.md` "Optimization Regression Rule".

## Resume context

Planning done; no step started. Next: M1, launch four parallel read-only readers over the 20 digests from C1 (reader contract in Relevant files). HEAD 8991eaf7; local commits unpushed. Never stage `docs/plans/logs/4d2fa07b.stats.json` or `f75ccea6.stats.json`.

## Amendments

Append material changes and their reasons; preserve the original request and settled decisions.
- 2026-11-19: Added X2, X3, X4 after X1: Accepted IDEA-2123a372: Measure what each always-on prompt block costs
- 2026-11-19: Added X5 after X4: Accepted IDEA-078edf4b: Design 'look' flags AI-design tells automatically
- 2026-11-19: Added X6, X7 after X5: Accepted IDEA-0e06c87e: Try Sonnet 5.5 as the Plan3 coding model
- 2026-11-19: Added X8, X9, X10 after X7: Accepted IDEA-6e87d551: Check that the compaction model keeps the facts
- 2026-11-19: Added X11, X12 after X10: Accepted IDEA-759e998f: Move the extension scout's two Luna calls to GPT-6 Luna
- 2026-11-19: Added X13, X14, X15 after X12: Accepted IDEA-3d820eac: Ponytail stands down on design scope








## Ideas

### IDEA-2123a372 Measure what each always-on prompt block costs

Status: accepted
Response: {"kind":"selection","selections":["Accept (Recommended)"]}

#### What this is

> Every request carries standing blocks: test-sensitivity (~1.5 KB), self-verify (~1.0 KB), locked-writes, reporting, plus ponytail ultra. Anthropic's guide says new models follow standing rules almost literally (one 'never retry' note in 12 stopped nearly all retries). Self-verify was benchmarked once (scripts/benchmark-self-verify-live.mjs); test-sensitivity was added (plan d49034f9) without any cost benchmark. The experiment runs the same small coding tasks with all blocks on, then with one block off at a time, and compares cost, tokens, turns and quality.

#### What you gain

> Shows which blocks pay for themselves. Example: if test-sensitivity makes a 3-line fix spend two extra turns on a mutation proof with no quality gain, we can scope it to bigger changes and save that on every small task. A block that measurably helps stays, now with evidence.

#### Drawbacks and risks

> Paid live runs (Opus 5.5 on your subscription). Small tasks may not trigger some blocks (locked-writes needs concurrent state), so a 'no effect' result for those means little. The guide's numbers are about Fable 5.2, not Opus 5.5.

#### Implementation and affected files

> Reuse the self-verify live benchmark harness: one arm per block removed (a settings or env switch per block), 3 tasks × 3 repetitions, fixed hidden checks as `passed`. Compare each arm to all-on with scripts/compare-benchmark-runs.mjs. Change a block only on a clear win; follow the Optimization Regression Rule.

#### Cost

> Medium: about half a day of harness work plus roughly 45 paid runs (budget asked with numbers in X1).

#### Recommendation

> Accept: these blocks are paid for on every request in every project, and test-sensitivity was never measured. The results decide whether to keep, trim or scope each one.

#### Sources and agreement

> Anthropic's Ten NEW Rules for Prompting Fable 5.2 (Full Guide) — https://www.youtube.com/watch?v=c_McosB62a4&t=292s — C:/Users/Flex/Downloads/video-digests/2026-11-10-anthropic-s-ten-new-rules-for-prompting-fable-5-2-full-guide/frames/4-52.jpg C:/Users/Flex/Downloads/video-digests/2026-11-10-anthropic-s-ten-new-rules-for-prompting-fable-5-2-full-guide/frames/5-00.jpg. Code: scripts/benchmark-self-verify-live.mjs, scripts/compare-benchmark-runs.mjs, docs/plans/done/…d49034f9-plan3.md.

#### Proposed requirement

> Each always-on prompt block has a measured cost and quality effect on small tasks; blocks without a benefit are trimmed or scoped.

#### Proposed steps

> - Add a per-block off switch to the self-verify live benchmark; check: a dry run shows the block missing from the system prompt.
> - Run all-on vs each block off, 3 tasks x 3 reps; check: compare-benchmark-runs report per arm.
> - Trim or scope blocks with no gain; check: targeted prompt tests pass and the rerun shows no regression.

### IDEA-6e87d551 Check that the compaction model keeps the facts

Status: accepted
Response: {"interpretation":"Accepted; the user wants the planted-fact test kept as a reusable check to rerun on each new model release, so it becomes a committed script that takes any model, not a one-off.","userResponse":"{\"kind\":\"selection\",\"selections\":[\"Accept (Recommended)\"],\"comment\":\"this is good, this test needs to stay so we can on new model releases do a planted facts test indeed, pay special attention to this point\"}"}

#### What this is

> Compaction summaries are written by openai-codex/gpt-6-luna at medium (your settings). The Haiku/Luna video's 8-needle test found GPT-6 Luna recalled only 29% of planted facts (3 of 10 at 32–64K), against Haiku's 96%. Our E2 Luna-vs-Terra run only measured whether the task still got done on one small task. A fact-recall check plants known facts (a file path, a decision, a failing test name) at different depths of a real long session, runs the compaction, and counts how many survive in the summary.

#### What you gain

> Catches the failure that runtime and cost cannot show: after compaction the agent forgets a decision and redoes or contradicts it. Example: if a 'never stage f75ccea6.stats.json' rule is dropped, the next commit stages it. A score per model lets us pick Luna, Terra or another model on evidence.

#### Drawbacks and risks

> Planted facts are artificial; real summaries are judged on what matters, not every fact. Needs some runs per model (cheap with Luna/Terra). The 29% is one creator's test with 30 questions.

#### Implementation and affected files

> A small script: take 2-3 real session transcripts (different lengths), insert 10 marked facts, call the compaction prompt with each candidate model, score recall per length bucket and write `score` into results.json for scripts/compare-benchmark-runs.mjs.

#### Cost

> Small to medium: a script of about 100 lines, plus about 30 cheap model calls per model.

#### Recommendation

> Accept: compaction quality affects every long session, and the current default is exactly the model this test found weakest; the check is cheap.

#### Sources and agreement

> We Were Completely Wrong About Haiku (and Luna) — https://www.youtube.com/watch?v=JJMChiMYW_g&t=727s — C:/Users/Flex/Downloads/video-digests/2026-10-08-we-were-completely-wrong-about-haiku-and-luna/frames/12-05.jpg C:/Users/Flex/Downloads/video-digests/2026-10-08-we-were-completely-wrong-about-haiku-and-luna/frames/13-03.jpg. Code: ~/.pi/agent/settings.json compactionModel, scripts/compare-benchmark-runs.mjs (score field), .pi/compaction-model-benchmark/e2.

#### Proposed requirement

> The compaction model is chosen on a measured fact-recall score across session lengths, not on cost and task completion alone.

#### Proposed steps

> - Write a planted-fact recall script over 2-3 real transcripts; check: a self-check with a perfect and an empty summary scores 100% and 0%.
> - Score gpt-6-luna, gpt-5.6-terra and the main model; check: results.json per model and a recall table per length bucket.
> - Change the compaction default only if a model wins clearly; check: compare-benchmark-runs on the E2 task shows no regression.

### IDEA-759e998f Move the extension scout's two Luna calls to GPT-6 Luna

Status: accepted
Response: {"interpretation":"Accepted, widened per comment: instead of hardcoding gpt-6-luna, add one resolver that picks the newest available model of a family (sol, astra, luna, terra) from the model registry, and use it where code hardcodes a family model (work-models.ts scout x2, agents-audit.ts astra). Risk kept visible: a new release is picked up without a benchmark, so callers stay limited to short bounded tasks.","userResponse":"{\"kind\":\"selection\",\"selections\":[\"Accept\"],\"comment\":\"can we define a model-latest or so func that finds the latest sol, latest astra, latest luna, tera, etc so we dont end up with outdated models hardcoded?\"}"}

#### What this is

> extensions/work-models.ts (lines 2926 and 2951) still calls openai-codex/gpt-5.6-luna for extension metadata screening and source inspection. GPT-6 Luna costs half ($0.10/$0.50 per 1M tokens against $0.20/$1.20) and makes fewer factual errors on the vendor chart (12% to 7.6% at max). Both calls are short, bounded JSON tasks, where the long-context weakness from the Haiku video does not apply.

#### What you gain

> Half the cost of every extension review, and fewer made-up claims in source inspection. Example: an /wo catch-up that screens 40 extensions sends two Luna calls per finalist; those become half price with no change in flow.

#### Drawbacks and risks

> A different model can format the JSON differently, and parseWorkflowJson would then reject it. The savings are small in absolute terms (cents).

#### Implementation and affected files

> Change the two model IDs; run one real extension review and check that both responses parse and the findings look sane; run the existing targeted test for the scout.

#### Cost

> Small: a two-line change and one live check.

#### Recommendation

> Neutral: correct and cheap, but the saving is tiny. Take it if you want the model list tidy and one model older removed.

#### Sources and agreement

> GPT 6 Sol & Luna Are Here (And 50% CHEAPER!) — https://www.youtube.com/watch?v=U_sjnF3jvCo&t=185s — C:/Users/Flex/Downloads/video-digests/2026-09-22-gpt-6-sol-luna-are-here-and-50-cheaper/frames/3-05.jpg C:/Users/Flex/Downloads/video-digests/2026-09-22-gpt-6-sol-luna-are-here-and-50-cheaper/frames/3-52.jpg. Code: extensions/work-models.ts:2926, :2951.

#### Proposed requirement

> The extension scout uses the current, cheaper Luna model without breaking its JSON parsing.

#### Proposed steps

> - Switch both scout calls to gpt-6-luna; check: one live extension review parses both responses and the scout's targeted test passes.

### IDEA-3d820eac Ponytail stands down on design scope

Status: accepted
Response: {"interpretation":"Accepted. The user's question (remove Ponytail, or replace it with a rule to prefer shared code over patches) is answered by measuring, not guessing: the \"prefer one-place change over patches\" rule already exists as Plan3's Project care fit check (extensions/plan3.ts PROJECT_CARE), but only inside Plan3 sessions. Ponytail is an always-on block, so it joins the ablation of IDEA-2123a372 as its own arm; keep, scope or drop it from that result.","userResponse":"{\"kind\":\"selection\",\"selections\":[\"Accept (Recommended)\"],\"comment\":\"woah this is huge too, maybe worth removing ponytail altogether or is it good for code bloat? or replace with standing instructions for code to prefer to combine and make universal code instead of patches, I think we even had something like that?\"}"}

#### What this is

> Ponytail runs at ultra in every session, and nothing in ce-workflow handles it. Its rule 'a vague request gets the smallest version' collides with design work. A third-party rerun found Ponytail 5 delivered 41–47% of the expected extras on 'build a landing page' and 'pricing page', against 82–89% for plain Claude (both 100% on must-haves; 94 vs 388 lines). Design sessions and the frontend-design skill would then build thin pages. The fix: one line in skills/frontend-design/SKILL.md and in the design session prompt saying the sections and polish a brief implies are the scope, not extras.

#### What you gain

> Design sessions keep their purpose while ponytail still trims code elsewhere. Example: 'make a pricing page' keeps the FAQ, comparison table and hover states the brief implies, instead of three plain cards.

#### Drawbacks and risks

> A prompt line competing with another prompt; it may only partly win. The video's evidence is two prompts from one creator. Another session-scoped option is to switch ponytail to lite in design sessions, if the ponytail extension allows it.

#### Implementation and affected files

> Run the two prompts in a design session with ponytail ultra, before and after the line, and judge expected-but-unstated features with a blind judge (as in the Ponytail rerun). Keep the line only if extras go up without bloating the code.

#### Cost

> Small: two lines of text plus about 4 paid runs and a judge.

#### Recommendation

> Accept: cheap, and the conflict is real in every design session you start while ponytail ultra is on.

#### Sources and agreement

> I Put Ponytail 5.0 To The Test (All Hype??) — https://www.youtube.com/watch?v=lHvzytIV_go&t=72s — C:/Users/Flex/Downloads/video-digests/2026-10-19-i-put-ponytail-5-0-to-the-test-all-hype/frames/1-38.jpg C:/Users/Flex/Downloads/video-digests/2026-10-19-i-put-ponytail-5-0-to-the-test-all-hype/frames/1-12.jpg. Code: skills/frontend-design/SKILL.md, extensions/design.ts (session prompt).

#### Proposed requirement

> Design sessions and the frontend-design skill deliver the sections and polish a brief implies, even with ponytail ultra active.

#### Proposed steps

> - Run 'landing page' and 'pricing page' design prompts with ponytail ultra as baseline; check: blind judge scores expected extras.
> - Add the scope line to frontend-design and the design prompt, rerun; check: extras score rises with no regression in must-haves.

### IDEA-6574eb4b Hub sidebar shows what each session is doing now

Status: rejected
Response: {"kind":"selection","selections":["Reject"]}

#### What this is

> The hub's session rows show the name, a colour, plan progress and an optional subtitle (hub/src/sessions.ts:250), which is set only by `pi-hub subtitle` or an extension. The Claude Projects mock-up shows a live line per thread ('Bisecting · 7 commits left'). Dot surfaced a blocked background job as one line ('local browser access is blocked, so I haven't verified the screens'). Here: while a session works, its row shows the running tool's title or the current Plan3 step. While it waits, the row shows the first line of its question. When a run ends blocked, the row shows the stop reason.

#### What you gain

> With 3–5 sessions open you see at a glance which is stuck and why, without opening each. Example: a night-mode Plan3 run waiting on 'R-device off' shows that on the row, instead of only a red dot.

#### Drawbacks and risks

> More text in a narrow sidebar; rows must truncate and fit the existing subtitle slot. Live tool titles change often, so the update must be throttled to avoid flicker and traffic for remote and phone pages.

#### Implementation and affected files

> The hub already mirrors tool rows (hub/src/chat.ts) and knows questions and plan progress. Derive a status line server-side (newest running tool title, or the question's first line, or the plan step) and show it in the subtitle slot when no manual subtitle is set. Throttle to one update per few seconds.

#### Cost

> Medium: hub server and web change, a view test, and a changelog screenshot.

#### Recommendation

> Accept: you run several hub sessions at once, and this answers the most frequent question (what is it doing, why is it stuck) without clicks.

#### Sources and agreement

> This Secret Claude Feature Turns It Into An Orchestration BEAST — https://www.youtube.com/watch?v=sZ1Z6XfkELo&t=1s — C:/Users/Flex/Downloads/video-digests/2026-10-17-this-secret-claude-feature-turns-it-into-an-orchestration-be/frames/0-02.jpg C:/Users/Flex/Downloads/video-digests/2026-10-17-this-secret-claude-feature-turns-it-into-an-orchestration-be/frames/0-03.jpg; OpenAI Just Gave Astra Its Own Virtual Computer With Dots — https://www.youtube.com/watch?v=C0JN0-sNPXQ&t=32s — C:/Users/Flex/Downloads/video-digests/2026-09-29-openai-just-gave-astra-its-own-virtual-computer-with-dots/frames/0-36.jpg. Code: hub/src/sessions.ts:250, hub/src/chat.ts, hub/web/app.ts (session bar).

#### Proposed requirement

> Each hub session row shows a short live status: the running tool or Plan3 step while working, the question while waiting, the stop reason when blocked.

#### Proposed steps

> - Derive a throttled status line server-side and send it with the session; check: hub view test covers working, waiting and blocked rows.
> - Show it in the subtitle slot when no manual subtitle is set; check: headless hub page screenshot shows the line truncated in the row.

### IDEA-a5c5c2a2 Compare design directions side by side

Status: rejected
Response: {"kind":"selection","selections":["Reject"]}

#### What this is

> The design tool starts one hub session per direction from the same brief. Comparing them today means switching between session pages. Claude's /design puts the variants as artboards on one canvas. Here: a read-only compare view in the hub that shows the live previews of all directions of one brief next to each other, at the same viewport, with a Select button under each.

#### What you gain

> You pick a direction by looking at all of them at once. Example: three landing-page directions at desktop width next to each other make differences in hierarchy and colour obvious, which tab-switching hides.

#### Drawbacks and risks

> Low usage so far (design loaded 10 times in the census). Several live iframes cost memory on a phone. Previews must stay read-only so the compare view does not trigger edits.

#### Implementation and affected files

> Reuse the existing design preview rendering from hub/web/design-view.ts. Add a compare view listing the designs of one start (same brief), each in a scaled iframe; Select calls the existing select action.

#### Cost

> Medium: a new hub view, its test and a changelog screenshot.

#### Recommendation

> Neutral: worth it only if you run multi-direction design sessions regularly; otherwise defer.

#### Sources and agreement

> /design is the biggest claude code upgrade in a LONG time — https://www.youtube.com/watch?v=ICJWpeJq0TU&t=33s — C:/Users/Flex/Downloads/video-digests/2026-08-28-design-is-the-biggest-claude-code-upgrade-in-a-long-time/frames/0-10.jpg C:/Users/Flex/Downloads/video-digests/2026-08-28-design-is-the-biggest-claude-code-upgrade-in-a-long-time/frames/0-46.jpg. Code: extensions/design.ts (start, select), hub/web/design-view.ts.

#### Proposed requirement

> All directions started from one design brief can be compared side by side in the hub and one selected from there.

#### Proposed steps

> - Add a hub compare view with scaled read-only previews of one brief's designs; check: hub view test plus headless screenshot with 3 designs.
> - Wire Select under each preview to the existing select action; check: test selects one and HANDOFF.md is exported.

### IDEA-078edf4b Design 'look' flags AI-design tells automatically

Status: accepted
Response: {"kind":"selection","selections":["Accept"]}

#### What this is

> skills/frontend-design/SKILL.md lists tells that read as AI-generated (terracotta #D97757 on cream, uniform radius, gradient washes, nested cards, gray text on colour). Today the agent must notice them in the screenshots. Impeccable ships 61 rule-based detectors with no model call. Here: the design `look` action also scans the rendered page's computed styles for the tells already in the skill and lists any it finds next to the pictures.

#### What you gain

> A code check instead of hoping the agent notices (Code-First Workflow Rule). Example: a design that uses #D97757 as its accent gets 'tell: Claude terracotta accent on 4 elements' in the look result, and the agent changes it before you see it.

#### Drawbacks and risks

> Rules give false positives (a brand that really is terracotta). The list must stay aligned with the skill text. Low design usage, so the benefit is modest.

#### Implementation and affected files

> look already renders headless and measures colours and fonts for references. Add a small rule list (5–8 rules from the skill) evaluated on computed styles; return hits as warnings, never block.

#### Cost

> Small to medium: about 80 lines in design-render plus a test page with planted tells.

#### Recommendation

> Neutral: cheap and in the code-first spirit, but valuable only as much as design sessions are used.

#### Sources and agreement

> Top 7 Claude Design Skills (All Free) — https://www.youtube.com/watch?v=n_iyI-C7WCs&t=88s — C:/Users/Flex/Downloads/video-digests/2026-10-21-top-7-claude-design-skills-all-free/frames/1-28.jpg C:/Users/Flex/Downloads/video-digests/2026-10-21-top-7-claude-design-skills-all-free/frames/1-30.jpg. Code: skills/frontend-design/SKILL.md:43, extensions/design-render.ts.

#### Proposed requirement

> The design look result warns about the AI-design tells listed in the frontend-design skill, measured from the rendered page.

#### Proposed steps

> - Add tell rules from the skill to look's rendered-style pass; check: a test page with planted tells gets each warning and a clean page gets none.

### IDEA-0e06c87e Try Sonnet 5.5 as the Plan3 coding model

Status: accepted
Response: {"kind":"selection","selections":["Accept (Recommended)"]}

#### What this is

> Plan3 can switch to a separate coding model when execution starts (the Coding model setting, work-models.ts phaseModel). Anthropic reports Sonnet 5.5 beats Opus 5.5 on Terminal-Bench 4.0 (70.6% vs 66.4%), trails it slightly on FrontierCode and CursorBench, and costs about half per token. The vendor itself positions Opus for judgment-heavy work. Experiment: keep Opus for planning, run coding steps with Sonnet 5.5, and compare on our own tasks.

#### What you gain

> If Sonnet holds quality on coding steps, your Opus quota goes about twice as far in long Plan3 runs. Example: a 6-step coding phase that uses a large share of the weekly Opus limit would use roughly half that on Sonnet.

#### Drawbacks and risks

> Vendor benchmarks did not predict real results in the Haiku video. A weaker coder can need more turns, eating the saving. On a subscription the gain shows as quota, not dollars, which is harder to measure.

#### Implementation and affected files

> Use the rework lab (scripts/rework-lab.mjs, which takes --worker) or the self-verify benchmark tasks: Opus vs Sonnet 5.5 as the worker, same tasks and repetitions, compare cost per successful task, turns and hidden-check pass rate with compare-benchmark-runs.

#### Cost

> Medium: no code, about 12–20 paid runs (budget asked with numbers in X1).

#### Recommendation

> Accept: a measured answer to a large quota question, with no code change unless it wins.

#### Sources and agreement

> Sonnet 5.5 just beat Opus in Coding (at half the cost) — https://www.youtube.com/watch?v=WK--kz63hlQ&t=12s — C:/Users/Flex/Downloads/video-digests/2026-09-28-sonnet-5-5-just-beat-opus-in-coding-at-half-the-cost/frames/0-13.jpg C:/Users/Flex/Downloads/video-digests/2026-09-28-sonnet-5-5-just-beat-opus-in-coding-at-half-the-cost/frames/0-30.jpg. Code: extensions/work-models.ts:4491 (codingModel), scripts/rework-lab.mjs, scripts/compare-benchmark-runs.mjs.

#### Proposed requirement

> The Plan3 coding model choice between Opus 5.5 and Sonnet 5.5 is backed by a paired benchmark on ce-workflow tasks.

#### Proposed steps

> - Run Opus 5.5 vs Sonnet 5.5 as worker on the same benchmark tasks; check: compare-benchmark-runs shows pass rate, cost, tokens, turns per arm.
> - Recommend a Coding model setting from the result; check: the decision and numbers are recorded in Decisions.
