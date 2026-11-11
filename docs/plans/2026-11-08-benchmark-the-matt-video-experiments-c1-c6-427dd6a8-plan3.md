---
plan3: true
status: blocked
created: 2026-11-08
updated: 2026-11-10T23:47:02.200Z
started: 2026-11-09T11:22:42.019Z
---

# Benchmark the Matt video experiments C1-C6

## Original request

> From the video-ideas pick (2026-11-09, ask_user): "C: plan the benchmarks: Create a Plan3 plan for C1-C6 (lower effort, 150k vs 200k, prototype HITL relab, prefix audit, pi-lens noise, mutations) without running them yet."
>
> The user approved this while leaving for the night ("do what you can without me"). Planning only: nothing below has been run.

## Goal, requirements, and non-goals

- Goal: one benchmark design per experiment C1-C6 from `docs/proposals/2026-11-09-matt-video-ideas.md` section C, each able to say keep or revert under the Optimization Regression Rule (AGENTS.md): same end-to-end workload, every continuation session aggregated, runtime, total provider tokens, cost, turns and tool calls compared with the last accepted baseline.
- Requirement: quality is measured with the change, not inferred from fewer turns (hidden tests, rubric or blind judge as in the skills lab).
- Requirement: live tests and benchmarks use the `ultrafull` compaction mode (AGENTS.md Compaction Mode in Tests Rule), except C2, which varies the Ultrafull threshold itself.
- Non-goal: running any benchmark in this plan's planning phase. Non-goal: B4 (map frontier), built only when a real map stalls.

## Decisions

- **D-01** Planning only for now; runs wait for the user's go. Source: user pick "C: plan the benchmarks … without running them yet", 2026-11-09.
- **D-02** Reuse the existing harnesses instead of new ones: `scripts/skills-lab.mjs` (isolated copies, arms, `results.jsonl`), `scripts/rework-lab.mjs` (unattended Plan3 over RPC on a throwaway clone), `scripts/lab-metrics.mjs` (tokens, cost, turns, tool calls incl. subagent children), `scripts/skills-lab-judge.mjs` (blind judge bundles). Source: agent proposal; these already produced the PC-09 and SK-08 results.
- **D-03** Every arm compares like with like: same task, same base commit, same model (`openai-codex/gpt-6.1-sol` as in the skills lab unless the experiment varies it), three reps per arm as in SK-08. Source: agent proposal, following `docs/proposals/skills-lab/results.md`.
- **D-04** Q-01: C1 and C2 both use a rework-lab run on the photobook fixture as the workload; its numbers are recorded as the baseline before any arm runs. Source: user, 2026-11-09 ("1 yea agreed").
- **D-05** Q-02: C3 uses scripted reactions written before the runs (one per variant round), plus one live run with the user at the end. Source: user, 2026-11-09 ("2. yep").
- **D-06** Q-03: no budget cap, as in the skills lab. Source: user, 2026-11-09 ("3 yep").
- **D-07** C1 arms: `codingEffort` high (what we all use today; rework-lab's default) vs medium; planning unchanged. Needs a `--coding-effort` option in `scripts/rework-lab.mjs`, which writes `codingEffort: "high"` into the clone's settings today. Source: user, 2026-11-09 ("we all use high for coding so test med").
- **D-08** C1 is coding-only: plan and design once on Opus high, then reuse that decided plan for every coding arm. Source: user, 2026-11-09 ("plan once on high opus and stop! reuse that plan for several coding sessions… opus high vs med, sol high vs med"). Frozen point: `c1-high-1` at `1d0fb5c` (PICK recorded, before Build). Arms: coding model Sol or Opus × effort high or medium, 3 reps, all four side by side per rep (`C:/SOFT/git/rework-lab/c1b-run.sh`, `rework-lab.mjs --from-plan`). Remaining [think] phases (Replay, Switch) stay on Opus high in every arm. The first full-run pair (`c1-high-1` $14.72 green, `c1-medium-1` $54.44, 1 failing test, a different and 3× larger pick) is kept only as evidence that full runs vary too much; rounds 2-3 were stopped.
- **D-09** C1 result (12 coding-only runs, 3 rounds, blind Opus + Astra judges, keys in C:/SOFT/git/rework-lab/judge/c1b-r{1,2,3}.key.json): keep coding effort **high** and Sol as coder. Astra average rank: sol-high 1.3, sol-medium 2.3, opus-high 3.0, opus-medium 3.3. Arm-specific race bugs flagged by Astra across 3 rounds: sol-high 4, sol-medium 5, opus-high 12, opus-medium 12. Objective check: payment-webhook dedupe inside the lock in 6/6 Sol builds, 2/6 Opus builds (corrected by C-10 recount). Default suite green: sol-high 3/3, sol-medium 1/3, opus 2/3 each. Sol medium saves only ~3 min and ~$0.90 per build. Caveats: the Opus judge ran out of context on rounds 2-3 (partial reads); Astra shares Sol's model family.
- **D-10** C-10 result (6 new Opus coding-only builds with the Locked writes rule vs the 6 C1b Opus builds, same frozen plan 1d0fb5c; blind, old and new mixed per round; keys C:/SOFT/git/rework-lab/judge/c1c-r{1,2,3}.key.json, verdicts judge/c1c-verdict.task-*.md). Race counts old -> new, summed over 3 reps: **medium** Opus judge 40 -> 27, Astra 55 -> 42 (better in all 6 pairs); **high** Opus judge 34 -> 34, Astra 54 -> 54 (net zero, 2 better, 1 tie, 1-2 worse per judge). Payment dedupe inside the lock: 4/6 new vs 2/6 old. Coding cost per build rose (high $9.9 -> $11.9, medium $7.0 -> $9.6), within noise for n=3. 7-14 races per build are shared by every build and come from the frozen plan. Decision: **keep the rule** (clear gain at medium, no measured harm at high), but it does not fix Opus at high effort; the planning half of the rule (shared design races) is still unmeasured.
- **D-11** C-11 result (3 Opus-high coding-only builds, Locked writes rule in the system prompt, ce-workflow a58154f9; each round blind-judged next to the c1b (no rule) and c1c (prompt-only rule) Opus-high build of the same rep; keys judge/c1d-r{1,2,3}.key.json, verdicts judge/c1d-verdict.task-{1..6}.md, Astra = tasks 1-3, Opus = 4-6). Race totals over 3 reps, no rule / prompt-only / system prompt: **Astra 49 / 48 / 44**, **Opus judge 27 / 27 / 24**. Per rep, both judges rank the system-prompt build best in reps 2 and 3 and worst in rep 1 (that build still dedupes payments before the lock). Payment dedupe inside the lock: 2/3. Coding time 39 min mean (c1c 40); coding cost $8.0 / $22.5 / $9.0 (the $22.5 outlier is unexplained). Read: a small gain at high (about 10%), well inside n=3 noise; no harm. Decision: **keep the system-prompt version** — it survives compaction, reaches non-Plan3 sessions and is at least as good — but the rule alone does not fix Opus at high effort; most remaining races (11-13 per build) are shared and come from the frozen plan.
- **D-12 Planning guidance (C1e) made races worse; do not count it as a fix.** Blind pairs c1d-opus-high-N (frozen reviewed plan) vs c1e-opus-high-N (own plan with Locked writes plan guidance, same Opus-high coder and system-prompt rule): all 6 verdicts favored c1d. Races c1d/c1e: Astra 21/36, 20/29, 15/28 (56/93); Opus 11/29, 10/18, 8/26 (29/73). Scores favored c1d 6-4, 6-4, 6-4 (Astra) and 7-4, 7-5, 7-4 (Opus). Cause seen in the code: the new plans chose a callback-only write API and then wrapped many old call sites mechanically (`() => precomputedPatch`, or callbacks that ignore their argument), so the API looks safe while the stale pre-lock reads stay; c1e-1 also deferred about 12 sites. Zero-argument updaters in server code: c1d 7/5/6, c1e 21/8/14. c1e coding was shorter (23/25/62 min) and the full runs cost $26-29. Caveats: each c1e run planned on its own (plan variance), n=3. The system-prompt rule (D-11) stays; the plan guidance needs a call-site audit requirement or a check that rejects updaters which ignore their argument before it is retested. Source: judge/c1e-verdict.task-1..6.md, keys judge/c1e-r{1,2,3}.key.json.
- **D-13 (C-13):** With the locked-writes check on (ce-workflow 28a5d72a), new-plan Opus-high builds still lost all 6 blind reviews to the frozen-plan builds (c1d). Race counts c1d vs c1f: Astra 23/23, 18/24, 16/26 (57 vs 73); Opus 18/18, 11/14, 9/18 (38 vs 50). That is better than C-12's c1e (Astra 93, Opus 73), but the check's note fired only 2/0/0 times, because bulk migrations went through sed, ast_grep_replace and node scripts. So the gain cannot be credited to the check; plan variance is the likelier cause. Coding time went up: 48/89/73 min (c1e 23/25/62). Keep the check (cheap, no false alarms in PhotoBook or ce-workflow). Do not claim it fixes races. The same c1d builds scored differently in C-12 and C-13 (Opus 29 vs 38), so judge noise between runs is about ±30%.
- **D-14 C2 design/start:** Resume the same frozen Opus-high plan (1d0fb5c), with Opus-high think phases and Sol-high coding; 3 fresh paired rounds, explicit per-clone Ultrafull compactAtTokens 150000 vs 200000. Reuse rework-lab --resume rather than change production/harness code. Runner C:/SOFT/git/rework-lab/c2-run.mjs; manifest c2.manifest.json pins workflow HEAD/content hash and workload. Each round runs both arms together, rounds sequential. Build/full task suite use the preapproved REWORK_EXPECT=delta. Keep 200k unless 150k preserves quality and materially improves overall metrics; collect runtime, provider tokens, cost, turns, tool calls across all continuations and children, including compaction-entry usage (lab-metrics currently counts assistant messages only). Verify compaction thresholds were actually exercised and same workflow loaded throughout; otherwise inconclusive. Audit rereads/reruns/reasks as hints, not proof of quality.
- **D-15 C2 completed:** 3 fresh paired runs at150k/200k, same frozen plan/Opus-high think/Sol-high code; all6 external build/full task suite checks passed with approved delta. Both Astra and Opus blind judges prefer150k in rounds1,3 and200k in round2 (2 winning pairs, not4 independent replications). Mean scores150k/200k: Astra5.67/5.00, Opus6.83/6.17; descriptive findings35/38 and11/16 (heterogeneous units/config/probable findings, not verified unique races). All-session E2E means:58.78/61.09min(-3.8%),10.886/13.454M provider tokens(-19.1%),$6.853/$7.557 estimated cost(-9.3%),115.7/121.3turns(-4.7%),112/118.7calls(-5.6%); includes compaction retries once and classifier usage. Checkpoints8/5; actual first coding sizes separate, but limits are not hard caps. Recommendation: provisional150k trial; keep production200k until user approves. No statistically established quality improvement; both arms retain serious bugs, round2 favors200k, all anonymous B builds won (label bias not excluded). Full report: C:/SOFT/git/ce-workflow/docs/proposals/2026-11-10-c2-context-threshold-results.md. Evidence C:/SOFT/git/rework-lab/c2-results.json and judge/c2-verdict.task-1..6.md, mapping judge/c2-rN.key.json.
- **D-16 C2 deployment approved:** user chose “Try150k as the default” in ask_user after all six reviews. Apply the shared Ultrafull fallback only; preserve explicit global/project compactAtTokens and Native200k. C-14 tracks implementation/targeted validation; this is a provisional trial, not proof of quality improvement.
- **D-17 C5 becomes an audit; the A/B runs only if it shows real cost.** Measured on 5 rework runs (c2-150k-1, c2-200k-1, c2-150k-3, c1d-opus-high-1, c1d-opus-high-2): pi-lens per-edit output is about 0.1-0.2 % of stored message text (edit 0.11 %, lens_diagnostics 0.09 %, write 0.02 %); most edits go through codemode (37 %), bash (8 %) or ast_grep_replace and never reach the per-edit hook. The audit adds the per-edit latency pi-lens prints ("· 2970ms"). Escalate to an A/B only if summed pi-lens latency exceeds 5 % of run wall time. Source: user, 2026-11-10 ask_user ("Yes: audit only, A/B only if the audit shows real cost").
- **D-18 C3 tests the logic prototype only, with two scripted reactions.** Reuse the SK-08 DealFinder alert-policy task as a new task `prototype-hitl`; the two reactions go in as follow-up messages (`pi -p` runs every supplied message in order, docs/cli.md) and answer G1-G3 like a user would; the hidden test gains one case per reaction. Arms off and forced, 3 reps, Sol high (D-03). A UI-variants task is built only if the logic task shows an effect. Source: user, 2026-11-10 ask_user ("Yes: logic task only, UI variants only if logic shows an effect").
- **D-19 C6 uses 8 declared mutations on the PhotoBook rework corpus.** Written before any run, applied one at a time to the old code at corpus SHA `9821716` in a scratch copy of `c1-high-1`: the consent-inversion control (expected PB-003), two that move a check before the lock (stale read), a dropped validation, an expiry off-by-one, a dropped redaction, a skipped session invalidation, an append turned into an overwrite. Keep rule: amend rework recipe §2 to require declared mutations (at least one stale read) if at least one realistic mutation survives and the extra check stays under 2 minutes. Stryker was rejected: new dependency, hundreds of noisy mutants, long runtime. Source: user, 2026-11-10 ask_user ("Yes: 8 declared mutations, that keep rule").
- **D-20 C4 is an audit, captured once per production model.** One plain request each on Sol and Opus from the ce-workflow checkout with the user's normal extensions, captured by a throwaway `before_provider_request` extension (Pi example `provider-payload.ts`) that writes to the lab folder, never the repo. Output is a ranked table; any deferral it suggests gets its own A/B later (Backlog). The capture script stays lab-local: one use, no repeat asked for. Source: agent proposal from the C-05 note "An audit, not an A/B"; the per-model split is cheap (two requests).
- **D-21 Order: cheapest first.** C4 and C5 audits, then C6 mutations, then the C3 harness, runs and live run, then one report. Each experiment reports keep or revert on its own, so a slow one never holds the others. Source: agent proposal; no experiment depends on another's result.
- **D-22 C3 harness change fits `scripts/skills-lab.mjs`; no new runner.** A task's `followUps` array becomes extra message arguments after the prompt, and the unattended line moves to the last message. One pure helper builds the message list so a small self-check can cover it. Patch chosen over a prefactor: the runner already owns argv building in one place (`runPi`). Source: agent fit check (Relevant files).
- **D-23 Unattended testing resumed.** The user asked to continue remaining testing overnight without them. Run the independent audits and automated experiments; retain C-16 for the user's live reactions. Source: user, 2026-11-10, “continue with the testing without me for the night if anything is left”.
- **D-24 C5 measurement correction.** The 27-run audit disproves D-17's factual claim that codemode edits bypass pi-lens: 305 of 359 timed clean footers occur inside codemode. Printed hook times total 896,399 ms over 97,164,164 ms (0.923%); the deliberately loose upper bound including entire edit/write calls and explicit diagnostics is 9.011%. Missing hook-only timings prevent proving the true share below or above the approved 5% gate. No A/B or optimization is justified yet. Keep D-17's user decision, but withdraw the earlier text-share attribution. Evidence: C:/SOFT/git/rework-lab/c5-audit.mjs and c5-results.json.
- **D-25 C4 measured scope.** Native async children captured one real Sol and Opus request with ambient extensions, project instructions and skills inherited. This avoids external agent CLIs. The child wrapper is additional context, so these sizes are exploratory, not an exact interactive-session baseline. Raw payloads stay local in C:/SOFT/git/skills-lab/c4; ranked audit and limitations are reported separately.
- **D-26 C6 verdict: retain current recipe.** Two baselines passed 11/11. Five declared mutations were caught; both pre-lock-read mutations and expiry equality survived. The eight mutation runs totaled 139.15 seconds, exceeding the approved 120-second gate. Do not amend the recipe or relax that gate. Evidence: C:/SOFT/git/rework-lab/c6-evidence/results.json.
- **D-27 C3 uses native retained sessions instead of changing the CLI harness.** D-22 was an agent implementation proposal; use native Pi continuation for the same two scripted reactions rather than introduce a raw CLI delegation path. No product runner change is needed. Six fresh copies share frozen DealFinder SHA 27221bee and a copied ce-workflow runtime (SHA-256 602e3c05dcc95be3cc4e04cfe21e3612beb4937279bcad427ed4301227aae49e). Both arms use Sol high, Ultrafull 150k, the same restricted tool set and a pinned compaction extension; this fresh comparison is not directly pooled with SK-08. The supplied prototype skill is the only arm difference. Predeclared G1–G3 scenarios follow the plan's fixture choices. Source: native subagent retained-child contract and C:/SOFT/git/skills-lab/c3-native/manifest.json. Original suite passes on the base; hidden test correctly fails collection because alerts.py does not exist.
- **D-28 C3 preflight failure and one native retry.** The first batch 884582e4 was stopped after off-1's acceptance rejected the staged baseline created by the harness. Its reported 131 passing tests do not validate a benchmark pair. Preserve that batch and count its cost as discarded setup overhead. Retry1 uses six fresh, shallow local fetches of the existing frozen commit: one visible commit, clean status, empty index, no new commits. Regression checks prove the old index is nonempty and every new one empty; the new base again passes119 tests. The acceptance gate also exposed a test-running helper to the coder; replace it with an explicit snapshot-only helper, and let the parent run hidden tests after all coding ends. No quality gate is waived: all18 snapshots, suite results and blind review remain mandatory before a verdict. Same native execution path; no external CLI fallback. Evidence: C:/SOFT/git/skills-lab/c3-retry-prepare.mjs, c3-snapshot.mjs and c3-native-retry1/manifest.json.
- **D-29 C3 automated verdict: do not adopt this tested setup.** All6 full suites and54/54 predeclared hidden cases pass. Forced/off means: active7.383/5.253min(+40.6%), elapsed7.662/7.045min(+8.8%; paired barriers), tokens1,350,282/1,060,937(+27.3%), estimated cost$0.407975/$0.283959(+43.7%), turns39.67/34.67(+14.4%), calls47.33/40.67(+16.4%). All18 native launches aggregate into6 actual retained session files, counted once. Blind Astra judge766b0302 prefers forced in rounds1,3 and off in2; ranks mixed, one forced build lacks durable tests. No runnable model precedes production edits in any build. Five rubric totals remain unknown because design-time trap recognition is unobservable; do not invent medians. Material cost regression blocks adoption despite two pairwise rank wins. This does not settle genuine human-reactive prototype-first benefits: scripted replies mostly confirmed already-chosen policies. No skill adoption, UI expansion or product edits. C16 remains human-only; defer its arm-selection question until user returns. Evidence C:/SOFT/git/skills-lab/c3-native-retry1/results.json, blind-review.md, judge-key.json; report docs/proposals/2026-11-10-matt-experiments-c3-c6-results.md. Recorded child overhead includes discarded2 sessions and judge:9,031,257tokens,$4.998282 estimated total, excluding parent orchestration and possibly unreported cancellation usage.






## Glossary

- **Scripted reaction**: a user reply to a prototype written before any run and sent at a fixed turn, the same text in every arm. Avoid: canned answer.
- **Declared mutation**: a deliberate bug written down before the corpus runs, with the case expected to catch it. Avoid: random mutant.
- **Survivor**: a declared mutation that the whole corpus still passes; it shows a gap in the corpus.

## Open questions

None open. Q-01 → D-04, Q-02 → D-05, Q-03 → D-06; C5, C3 and C6 scope → D-17, D-18, D-19.

- Assumption (labelled, over 95 %): the reactions' answers to G1-G3 are fixture preferences, not product decisions; any consistent set measures the same thing. Chosen: G1 growth since the last alert; G2 gone more than 3 days means new again; G3 a recovery alerts only when €20 above the last alerted margin.

## Relevant files and approach

- `docs/proposals/2026-11-09-matt-video-ideas.md` section C: the six experiments and their video evidence.
- `scripts/skills-lab.mjs`, `scripts/rework-lab.mjs`, `scripts/lab-metrics.mjs`, `scripts/skills-lab-judge.mjs`: harnesses (D-02).
- `docs/proposals/skills-lab/design.md` and `results.md`: arm, rep and judging conventions to copy.
- `docs/proposals/2026-11-05-rework-recipe.md` §2 (line 125): the sensitivity check with one planted bug that C6 extends.
- `scripts/audit-compaction.mjs`: re-read and re-ask counts after compaction, a C2 quality signal.
- Settings: `workOrchestrator.context.compactAtTokens` (`/wo context set 150000`) for C2; thinking effort per phase for C1.

Fit checks for the remaining experiments (ce-workflow modules only; lab scripts and fixtures live outside the repo):

- `scripts/skills-lab.mjs` (C3): **fits**. `runPi` builds the one message today; follow-ups extend that one place. Last touched e11914cc; no other module builds Pi argv for the lab.
- `scripts/test-skills-lab.mjs` (C3): new self-check for the message builder; production plus test is the only seam, no new interface.
- `docs/proposals/skills-lab/tasks/prototype-hitl/` (C3): new task copied from `tasks/prototype/`; the original stays untouched so SK-08 remains comparable.
- `docs/proposals/2026-11-05-rework-recipe.md` §2, line 125, plus CHR-02 (line 222) and retro question 4 (line 267) (C6, only on keep): **fits**. The recipe text lives only in this doc; `extensions/plan3.ts` does not embed it (grep for "planted" finds only the doc).
- C4 and C5: no ce-workflow module changes; capture extension, audit scripts and outputs stay in `C:/SOFT/git/skills-lab/` and `C:/SOFT/git/rework-lab/`.

Commands (referenced by step):

- CMD-SKL: `node scripts/skills-lab.mjs <run> --task prototype-hitl --arm off,forced --reps 3` (add `--no-pi` to set up and check only).
- CMD-JUDGE: `node scripts/skills-lab-judge.mjs <run> prototype-hitl`.
- CMD-METRICS: `node scripts/lab-metrics.mjs <session-dir>`, plus compaction-entry and tool-result usage as in `C:/SOFT/git/rework-lab/c2-report.mjs`.
- CMD-SELF: `node scripts/test-skills-lab.mjs`.
- CMD-CORPUS: in the PhotoBook scratch copy, `npx vitest run server/rework` with `REWORK_EXPECT` unset (baseline comparison at corpus SHA).

## Phases

### Phase 1: Benchmark designs [think]

  - note: Baseline = the C1 high arm itself (current settings, current ce-workflow 24bb80d): photobook-02 ran on an older recipe/ce-workflow, so it can't be the baseline. Runner: C:/SOFT/git/rework-lab/c1-run.sh (3 reps, high+medium side by side per rep, --check = npm run build + vitest). Metrics: wallMs/metrics/check in each c1-*.lab.jsonl done line (lab-metrics sessionMetrics).
- [x] **C-01** C1 done (D-08/D-09): coding-only 2x2x3 from one Opus-high plan; verdict keep Sol on high effort; medium rejected for coding.
- [x] **C-10** C1c done (D-10): Locked writes rule cuts Opus races at medium (Opus judge 40->27, Astra 55->42), no net change at high (34->34, 54->54); rule kept.
- [x] **C-11** C1d done (D-11): system-prompt rule gives Opus high a small, noisy gain (races Astra 49/48/44, Opus judge 27/27/24 for none/prompt/system); kept.
- [x] **C-12** C1e done: own-plan runs with plan guidance lost all 6 blind verdicts to the frozen-plan builds (races Astra 56→93, Opus 29→73); cause: mechanical zero-arg updater wrapping (D-12).
- [x] **C-13** C1f: check on, new-plan builds still lost 6/6 blind reviews to frozen-plan builds (races Astra 73 vs 57, Opus 50 vs 38); check fired only 2 times, so no credit to it (D-13).
- [x] **C-02** C1 design and execution already covered by C-01/D-08/D-09: frozen Opus-high plan, Sol/Opus × high/medium, 12 runs; retain Sol high.
- [x] **C-03** C2 done: 150k won 2 of 3 blind pairs with 19.1 % fewer tokens and 9.3 % lower cost, no aggregate quality regression (D-15).
- [x] **C-14** Provisional 150k Ultrafull default implemented (D-16); explicit thresholds and Native 200k kept; targeted compaction tests pass.
- [x] **C-08** User said "go" (2026-11-09) after D-04..D-07; no budget cap.

### Phase 2: Audits C4 and C5 [think]

- [x] **C-05** C4: two native request captures ranked; schemas dominate ~90KB payloads. No deferral adopted; interactive-prefix caveat recorded.
- [x] **C-06** C5 audit: observed 0.923% latency; incomplete hook timings leave 5% gate inconclusive. No A/B or change.

### Phase 3: Mutation sensitivity C6 [think]

- [x] **C-07** C6: 5 mutations caught, 3 survived; 139.15s exceeds 120s keep gate, so retain current recipe.

### Phase 4: Prototype harness C3 [code]

- [x] **C-15** Native C3 harness verified: six clean fixtures, all 18 hashed snapshots, three ordered user turns per retained session; runtime/settings/model unchanged.

### Phase 5: Prototype runs C3 [think]

- [x] **C-04** C3 scripted comparison closed: all tests pass, mixed blind ranks, forced +43.7% cost/+27.3% tokens; do not adopt tested setup.
- [human] **C-16** [human] One live C3 run: the user reacts in the TUI instead of the scripts, on the arm picked at C-04 (D-05).
  - The user reacts live for about 20 minutes. Same task copy and model; metrics and transcript kept beside the scripted runs.
  - note: Only remaining step: user must be present for live ~20-minute reactions and choose arm after seeing D29. Not asked during unattended overnight work.

### Phase 6: Report [think]

- [x] **C-09** C3–C6 report complete for automated work: no new optimization adopted; metrics, negative results, overhead and live-run limitation recorded.

## Backlog

- C4 deferral candidates from the C-05 table, each with its own A/B (D-20).
- C5 hook-only instrumentation if revisited: current lower and upper bounds straddle 5%. An A/B still requires evidence crossing D-17's gate; no optimization is adopted.
- C3 UI-variants task, only if C-04 shows an effect (D-18).
- Adoption form for the prototype skill if C-04 says adopt.

## Global validation

- Every run aggregates every real session/child, excluding copied artifact transcripts. C2 adds compaction-entry/retry usage once plus nested classifier tool usage omitted by assistant-only lab-metrics.
- Every keep verdict compares the same E2E workload with its baseline and quality plus runtime/tokens/cost/turns/calls.
- C3 to C6 acceptance: each experiment ends with a keep, revert or closed verdict in the C-09 report, with its evidence paths; audits (C4, C5) state their numbers and the rule they were judged by.
- Live runs (C3) use Ultrafull at the new 150k default (D-16); record Pi version, ce-workflow HEAD and model per run, and void a batch if any of them changes mid-batch.

### C2 complete; user-approved provisional150k default implemented

Report: `docs/proposals/2026-11-10-c2-context-threshold-results.md`. All six builds passed the final build and full task suite with the approved delta, and the workflow pin did not change. First coding compactions landed at about 144-146k versus 191-205k, so the thresholds were exercised; they are not hard caps (one later 150k checkpoint on Opus came at 225,710). Means, 150k versus 200k: 58.78 versus 61.09 min, 10.886M versus 13.454M tokens, $6.853 versus $7.557, 115.7 versus 121.3 turns, 112 versus 118.7 tool calls; 8 versus 5 compactions. Both blind judges chose 150k in rounds 1 and 3 and 200k in round 2; only 3 pairs, every anonymous B build won, so label bias is not excluded. The user approved the 150k trial (D-16): the shared fallback changed, explicit thresholds and other modes did not, and no settings were migrated. Checks: `node scripts/test-work-compaction-notifications.mjs` and `node scripts/test-work-compaction.mjs` pass, scoped `git diff --check` passes; LSP showed no diagnostics but could not confirm clean. Full suite skipped. A running Pi needs a reload to pick up the change.

## Resume context

AUTOMATED WORK COMPLETE:15/16 steps done; only C16 human live reaction remains. Plan blocked on user presence/arm choice, not a technical failure. C3 no adoption: six suites and54/54 hidden cases pass; forced +43.7%cost,+27.3%tokens,+40.6%active runtime; blind Astra prefers forced rounds1,3/off2, mixed quality and no prototype-before-production in any build. Full report C:/SOFT/git/ce-workflow/docs/proposals/2026-11-10-matt-experiments-c3-c6-results.md; C4 prefix report separate same folder. Evidence C:/SOFT/git/skills-lab/c3-native-retry1/results.json, blind-review.md, judge-key.json, judge-metrics.json and18 hashed stage snapshots. All native benchmark/judge work complete; no active runs or polling needed. D29 records verdict/limits; total recorded C3 children incl failed setup/judge9,031,257tokens,$4.998282 estimated, excludes parent/cancelled unknown usage. On user return discuss live arm (baseline recommended as no forced adoption) or skipping live run; do not run it unattended or mark entire plan complete. No product changes, commits or pushes. Preserve unrelated dirty files and reproducibility artifacts.

## Amendments

Append material changes and their reasons; preserve the original request and settled decisions.
- 2026-11-10: Added C-10 after C-01: D-09 found reads taken before the lock were Opus's main coding defect; the Locked writes prompt rule (plan3.ts) needs a measured before/after on the same frozen plan.
- 2026-11-10: Added C-11 after C-10: D-10: the prompt-only rule did not help Opus high, and compaction cut the rule out of the Plan3 handoff; the user asked to test the system-prompt version.
- 2026-11-10: Added C-12 after C-11: D-11: 11-13 races per build are shared and come from the frozen plan; the user asked to test planning next.
- 2026-11-10: Added C-13 after C-12: D-12: mechanical zero-arg updater wrapping drove the C1e regression; the user asked to build a check into ce-workflow and retest.
- 2026-11-10: Added C-14 after C-03: User chose Try150k as the default after the completed C2 comparison.
- 2026-11-10: Planned C3 to C6 (D-17 to D-22): C5 became an audit, C3 is logic-only with scripted reactions, C6 uses 8 declared mutations; C-04 to C-07 turned from design steps into run steps, C-15 (harness) and C-16 (live run) added, C-09 is the report.
