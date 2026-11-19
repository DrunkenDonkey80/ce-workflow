---
plan3: true
status: complete
created: 2026-11-19
updated: 2026-11-19T21:29:08.688Z
size: plan
reviewed: 2026-11-19
started: 2026-11-19T20:39:08.879Z
---

# Mine LoopForge, Claude-BugHunter and SkillEvaluator for ce-workflow ideas

## Original request

> since we are on an update loop, analyze deeply these repos for ideas for us to implement fully or partially:
> 
> https://github.com/Tencent/LoopForge
> https://github.com/elementalsouls/Claude-BugHunter
> https://github.com/NVIDIA/SkillEvaluator
> 
> if you need clone them to a temp folder to fully examine their source

## Goal, requirements, and non-goals

**Goal:** find the ideas in the three repos worth taking into ce-workflow (whole or in part), judged by us and blind by Astra, and let the user accept or reject each one. Accepted ideas are built in one umbrella follow-up plan (D-03).

Requirements:

- R1: every area in the review scope (table below) gets a verdict with a reason, the ce-workflow counterpart it was compared with, and upstream evidence as `path:line` at the pinned commit (D-02, D-07).
- R2: Astra reviews the same areas blind (pinned clones, area table, a short ce-workflow capability brief; not our verdicts or this plan). The review doc shows both verdicts side by side, the agreement count and how each disagreement was settled after checking the code (D-01).
- R3: an idea whose benefit depends on how often something happens here gets a measured number from our session logs before it is offered, or says that the logs cannot show it (D-06).
- R4: the free local checks of SkillEvaluator (quality-check, harness-check) and BugHunter (`scripts/lint_skills.py`) run on our own skills and their findings feed the S1, S2 and B3 verdicts (D-05).
- R5: before the idea popups, the reply lists dropped candidates in two groups: Already covered (one line each, naming what covers it) and Not covered, but not recommended (2-3 lines each with the upstream path). Then one ask_user with checkboxes, one per group-2 item, asks which to expand; every picked item becomes a full proposal next to the recommended ones (D-08).
- R6: every recommended or picked idea reaches the user through `plan3` action `ideas`; each gets an accepted or rejected decision in Decisions.
- R7: one ledger per upstream, `docs/upstream/loopforge.md`, `docs/upstream/claude-bughunter.md` and `docs/upstream/skillevaluator.md`, records the pin and what we took, left, already have and skipped; no catch-up watch until an idea is built (D-09).
- R8: when at least one idea is accepted, one umbrella Plan3 draft holds all of them (one phase per idea) with upstream paths, evidence, the catch-up entry to add when built and the port-with-notice rule (D-03, D-04).
- R9: this plan changes only files under `docs/` (plus the new draft plan); nothing is implemented, no paid model runs except Astra's review (D-05).

Review scope (D-02: everything, web UIs included). Counterparts are starting points, not verdicts.

LoopForge (pin D-07, MIT):

| Area | Upstream paths | ce-workflow counterpart to compare |
|---|---|---|
| L1 SOP run engine: agent, script, human-gate and sub-SOP nodes, dependencies, rework edges, rerun from a node | `internal/engine/engine.go`, `node_execute.go`, `lifecycle.go`, `internal/domain/workflow.go` | Plan3 phases and steps, `[human]` steps, night mode (`extensions/plan3.ts`, `plan3-night.ts`) |
| L2 Verification gates with `onFailure` loop, reject, fail or human; self-correct loop; loop-retro artifact | `internal/domain/workflow.go:10`, `internal/engine/gate_*.go`, `internal/engine/observability.go:99` | Plan3 step checks (recorded text, not executed), `extensions/self-verify.ts`, `test-sensitivity.ts`, `run-budget.ts` |
| L3 Run evaluation: facts digest, weighted dimensions, applicable recommendations | `internal/runeval/`, `internal/domain/run_eval*.go` | `extensions/plan3-stats.ts` speed hints, `agents-audit.ts`, the Matt retro A/B in Backlog |
| L4 Roles: prompt, executor, model, rules, skills and MCP per role, as SOP node or chat subagent | `local/.claude/agents/`, `internal/domain/` agent definitions | `utility-agents/`, pi-subagents agents, phase models in `extensions/work-models.ts` |
| L5 Requirements to delivery: tracking, clarification gate, PR and merge status | `internal/tracker/`, issues in `internal/repo/` | Plan3 Original request, requirements (`extensions/plan3-needs.ts`); no issue tracker |
| L6 Failure diagnostics: per-turn export, first error kept, termination cause, evidence versus unknowns | `docs/proposals/cli-execution-diagnostics.md`, `chatbot/src/GenerationDiagnostics.jsx` | `hub/src/pi-sdk.ts`, `hub/src/update-check.ts` |
| L7 Token and cost accounting per run and conversation | `docs/token-pricing.md`, usage code in `internal/` | hub usage footer (`hub/src/usage-UPSTREAM.md`), `plan3-stats.ts`, `scripts/lab-metrics.mjs` |
| L8 Scheduled AI tasks and the task template market | `docs/ai-scheduled-task-capabilities.md`, `internal/schedule/` | `schedule` tool (`extensions/hub-command.ts`), the 5-day AGENTS.md audit |
| L9 Chat workbench UI: queued and steered messages, `@` picker, artifact side panel, activity trace, approvals, run alerts, permission picker | `chatbot/src/*.jsx`, `docs/assets/readme/chat-home.svg` | `hub/web/app.ts`, `hub/src/sessions.ts` |
| L10 SOP designer and run page UI: canvas, node inspector, run status, approval inbox | `web/app/`, `docs/assets/readme/designer-en.svg`, `run-approval-en.svg` | `extensions/plan3-web.ts`, `plan3-diagram.ts`, hub attention badge |
| L11 Knowledge distillation and knowledge service | `internal/knowledge/`, `local/.claude/skills/knowledge-distillation/` | `extensions/work-knowledge.ts`, knowledge discoverer |
| L12 Dev process: AGENTS.md ownership rules, `design.md`, acceptance matrix, validation record, release review, upstream sync | `AGENTS.md`, `design.md`, `docs/testing/acceptance-matrix.md`, `docs/validation.md`, `docs/release-readiness.md`, `docs/upstream-sync.md` | our `AGENTS.md`, `docs/agent-rules.md`, `CHANGELOG.md`, README checks |
| L13 Execution environments: sandboxes, runners, process watch | `internal/runtime/`, `internal/runner/`, `internal/procwatch/` | Pi processes, hub session host |
| L14 LoopForge Local devflow: workflow-state spec, gate checklists, sub-developer prompt | `local/.claude/runtime/`, `local/.claude/checklists/`, `local/.claude/workflows/devflow.md` | Plan3 and `/resume3` |

Claude-BugHunter (pin D-07, MIT code, CC BY 4.0 skill text):

| Area | Upstream paths | ce-workflow counterpart |
|---|---|---|
| B1 Eval harness: skills on versus off with a self-grading oracle, ceiling-effect notes, committed baseline table | `eval/run_eval*.py`, `eval/README.md`, `eval/BASELINE.md` | `scripts/benchmark-self-verify-live.mjs`, `compare-benchmark-runs.mjs`, `skills-lab.mjs` |
| B2 False-positive trap benchmark (win: fewer false positives without fewer true ones) | `eval/run_fp.py`, `eval/fp_app.py`, `eval/fp_cases.json` | `diff-reviewer`, `skills/two-axis-review/`, `agents-audit.ts`, claim-verifier |
| B3 Skill lint with grounding (`sources:`), hashed identifier denylist pre-commit, leak guard | `scripts/lint_skills.py`, `scripts/scan_identifiers.py`, `.githooks/pre-commit`, `.github/workflows/leak-guard.yml` | AGENTS.md credential rule, `extensions/redact.ts`, `command-guard.ts` |
| B4 Deterministic-first engine: map first, agents opt-in and skills off, read-only adversarial validator, scope allowlist | `engine/README.md`, `engine/engine.py`, `engine/agent.py` | project map, jev tools, pi-subagents, `diff-reviewer` |
| B5 Discipline skills: 7-question validation gate, evidence hygiene (PII in screenshots), hypothesis discipline | `skills/triage-validation/`, `skills/evidence-hygiene/`, `skills/bb-methodology/` | `self-verify.ts`, claim-verifier, `screen_read` |
| B6 Packaging: multi-harness install with manifest-safe uninstall, doc-count check, generated catalog | `scripts/install.sh`, `scripts/check_doc_counts.py`, `scripts/gen_skill_catalog.py` | `work-self-update.ts`, `scripts/verify-package.mjs`, README counts |
| B7 Engagement state and memory: state store, memory, coverage ledger, `/remember`, `/memory-gc`, `/pickup` | `engine/state.py`, `engine/memory.py`, `commands/` | `work-knowledge.ts`, Plan3 resume, compaction notes |
| B8 Security content and the model-switch note (Opus 5 falls back to Opus 4.8 on some cyber requests) | `skills/hunt-*`, `README.md` "Why your model switched" | none; provider replies' model id in the hub |

SkillEvaluator (pin D-07, Apache-2.0):

| Area | Upstream paths | ce-workflow counterpart |
|---|---|---|
| S1 Tier 1 static quality score of SKILL.md | `src/skillevaluator/validators/`, `src/skillevaluator/config/quality-default.yaml` | none for skills; `agents-audit.ts` for instruction files |
| S2 Harness check: loader compatibility per harness (six harnesses, Pi not among them: `docs/harness-check.mdx:298`) | `src/skillevaluator/harness/`, `docs/harness-check.mdx` | Pi's real loader check in `scripts/test-work-plan3.mjs:1464` (all three shipped skills load with no diagnostics) |
| S3 Tier 2 dedup: overlap inside a skill and between skills | `src/skillevaluator/deduplication/`, `docs/tier2-deduplication.mdx` | `agents-audit.ts`, `scripts/context-report.mjs` |
| S4 Tier 3 live lift: with versus without, pass@k, interaction experiments, activation buckets | `src/skillevaluator/tier3/`, `docs/tier3-experiments.mdx` | benchmark arms in `benchmark-self-verify-live.mjs`, `bench-sections-off.ts` |
| S5 Metrics and judge rules: booleans only, verifier does the arithmetic, one retry, errors unscored, N/A drops out, Wilson and bootstrap intervals, sufficiency policy, no placebo arm, "what has not been established" | `docs/metrics-reference.mdx`, `src/skillevaluator/evaluation/` | `judge-handoff.mjs`, `judge-design-extras.mjs`, `skills-lab-judge.mjs`, `compare-benchmark-runs.mjs` |
| S6 Grader validation against a labelled suite | `docs/grader-validation.mdx` model judges `scripts/judge-handoff.mjs` and `scripts/judge-design-extras.mjs` with no labelled validation set; earlier spot checks were made in chat only, not recorded in the repo |
| S7 Plugin context cost and inventory | `src/skillevaluator/plugin_context_cost.py`, `plugin_inventory.py` | `scripts/context-report.mjs` |
| S8 Security scans: unicode smuggling, PII, secrets, trajectory security signal | `src/skillevaluator/config/unicode_smuggle_patterns.yaml`, `pii_patterns.yaml`, `tier3/eval_core/checks.py` | `work-extension-scout.ts`, `command-guard.ts`, `redact.ts` |
| S9 Reporting and CI: HTML, JSON, JUnit, dashboard, CI templates, pre-commit hooks, finding verifier | `src/skillevaluator/reporting/`, `ci/`, `inference/finding_verifier.py` | hub views, `plan3-web.ts`, `npm run verify` |
| S10 Eval datasets from traces and autopilot case generation | `docs/trace-datasets.mdx`, `docs/prepare-dataset.mdx` | benchmarks built from real sessions (`benchmark-compaction-recall-live.mjs`) |

Non-goals:

- Building any idea or changing extension, hub or script code in this plan (D-03, R9).
- Copying upstream code here. The umbrella plan may port with license and notice (D-04).
- Installing Docker or running the full LoopForge platform (D-05 UI decision); paid model runs other than Astra's review.
- Using any BugHunter security technique against a target; its hunting content is read only as material for the B8 verdict.

Acceptance examples:

- `docs/proposals/2026-11-19-loopforge-bughunter-skillevaluator-review.md` has 32 area rows (L1-L14, B1-B8, S1-S10), each with our verdict, Astra's verdict, final verdict, reason, counterpart, `path:line` evidence and, where R3 applies, the measured number; plus "agree on N of 32".
- An S5 row reads, for example: "Adopt idea. Their judge returns only booleans and the verifier computes the score; a failed judge call is unscored, not zero (`docs/metrics-reference.mdx:171`). Our `scripts/judge-handoff.mjs` ... Counterpart: ...".
- The reply before the popups has the two dropped groups and one checkbox question; picked items appear as popups.
- With zero accepted ideas: the three ledgers exist, no umbrella draft exists, `extensions/work-catch-up-baseline.json` is unchanged.




## Decisions

- **D-01 Astra reviews blind, then we merge.** One read-only Astra review across the three repos, given the pinned clones, the area table and a short capability brief, not our verdicts (Haystack D-03 precedent). Source: user via ask_user 2026-11-19, round 1.
- **D-02 Scope: everything, web UIs included.** 32 areas above; the security-hunting content is one area (B8). Source: user via ask_user 2026-11-19, round 1 (the agent had recommended workflow and evaluation overlap only).
- **D-03 One umbrella follow-up plan for accepted ideas.** All accepted ideas in one draft, one phase each; this plan ends at records. Source: user via ask_user 2026-11-19, round 1 (precedent b71bab2b).
- **D-04 Ports allowed with notice.** A port carries the upstream license and attribution (MIT, CC BY 4.0 for BugHunter skill text, Apache-2.0 with NOTICE); re-implementing stays the default. Source: user via ask_user 2026-11-19, round 2 (same as Haystack D-09).
- **D-05 LoopForge UI from source and screenshots; try the chat UI alone.** No Docker install. If `chatbot/` cannot run standalone in a headless browser, the review says so and uses source and the README SVGs. Keyless upstream checks run on our files (R4); no other paid runs before the idea review. Source: user via ask_user 2026-11-19, round 2.
- **D-06 Measure frequency-dependent gaps on session logs first.** Ideas whose benefit depends on how often something happens get a number from our logs, or say the logs cannot show it. Source: user via ask_user 2026-11-19, round 2 (Haystack second-pass precedent).
- **D-07 Pins.** LoopForge `6f606cf2a7354f05d1dbf2085f4eb832b7e89ccb`, Claude-BugHunter `0e70a021e59d6875004e7a563f8511aca2ba3bc1`, SkillEvaluator `d8ddd4f76de78dfc3425d0a829d2c7dc9ccb9037` (all 2026-11-19). Later upstream changes are out of scope unless a step re-pins. Source: planning-time shallow clones.
- **D-08 Dropped ideas shown in two groups with expand checkboxes.** Source: user request 2026-11-19 ("for the future mine ideas, can you also list as few lines the dropped ideas that we don't already have covered, but you just dont recommend, with checkboxes to expand on them too"); the Mine videos button prompt was changed the same way.
- **D-09 Ledgers always, catch-up watch only when built.** Same as Haystack D-05 and D-10: the umbrella plan adds scoped `kind: "git"` entries to `extensions/work-catch-up-baseline.json` when it builds an idea; no watch for a repo whose ideas were all rejected. Source: agent from precedent, confirmed by the user's Q-01 answer "Only when built" (/plan3 resolve 2026-11-19).
- **D-10 Patch, no prefactor.** Only new docs and one draft plan; no module fights the change. Source: agent fit check.
- **D-11 Astra model: gpt-6.2-astra high.** The blind review runs as the builtin read-only `reviewer` with the model passed explicitly as `openai-codex/gpt-6.2-astra:high` (the builtin `reviewer` has no model configured in `~/.pi/agent/settings.json`, so it must not be left to the default). Newer than the gpt-6-astra used for the Haystack and Matt reviews, so agreement counts are not strictly comparable across reviews. Source: user's Q-02 answer (/plan3 resolve 2026-11-19); replaces the agent's gpt-6-astra assumption.
- **D-size** Size: plan. Known recipe (Haystack review), no product code. Source: user confirmed the plan size.
- **Q-01** Is a catch-up watch added only when an idea is built, as for Haystack?
  - Context: D-09 copies Haystack D-05 and D-10. LoopForge is busy (30 KB changelog), so an unscoped watch would be noise; a scoped watch needs the accepted ideas' paths.
  - Recommendation: Yes, the umbrella plan adds scoped entries when it builds an idea.
  - Option: Only when built — no watch for repos whose ideas were all rejected.
  - Option: Watch all three now — notices for any upstream change, mostly noise.
  - Independent: yes
  - Answer: {"kind":"selection","selections":["Only when built"]}
  - Source: user via ask_user /plan3 resolve; not independently verified.
- **Q-02** Use the configured oracle model (gpt-6-astra high) for the blind review?
  - Context: the system rules name `openai-codex/gpt-6-astra:high` for oracle and advisor subagents; `openai-codex/gpt-6.2-astra` is the newer Astra now used for compaction (93% recall). The Haystack review used gpt-6-astra high.
  - Recommendation: gpt-6-astra high, for comparability with the Haystack and Matt reviews.
  - Option: gpt-6-astra high — same as earlier reviews.
  - Option: gpt-6.2-astra high — newer; untested as a reviewer here.
  - Independent: yes
  - Answer: {"kind":"selection","selections":["gpt-6.2-astra high"]}
  - Source: user via ask_user /plan3 resolve; not independently verified.
- IDEA-2aa23198: rejected — S6 Judge calibration: labelled cases and a --check mode for our model judges. Source: user via Plan3 idea review; not independently verified. Response: {"kind":"selection","selections":["Reject"]}
- IDEA-b08832b1: accepted — S5 Honest small-sample results: judge error counts, both-direction changes and a 'not established' line. Source: user via Plan3 idea review; not independently verified. Response: {"kind":"selection","selections":["Accept"]}
- IDEA-2f20a933: accepted — L13 Quiet-process notice: show when a running command has printed nothing for a while. Source: user via Plan3 idea review; not independently verified. Response: {"kind":"selection","selections":["Accept"]}
- IDEA-cec728e2: accepted — L3 Post-plan retro digest (Test first). Source: user via Plan3 idea review; not independently verified. Response: {"interpretation":"Accepted with changes: trial offline on already finished plans (37 stats.json in docs/plans/logs, 50 done plans) instead of waiting for new finishes; compare several retro models incl. thinking ones; score recommendations on two sides: the project's own flow and ce-workflow itself.","userResponse":"{\"kind\":\"selection\",\"selections\":[\"Accept\"],\"comment\":\"can we also do trials from the already finished plans, stuff is recorded right? test the different models, I guess the thinker ones will perform better here. the outcome can be 2 sided tho - improvement in the project flow and improvement in ce-wf\"}"}







## Open questions

### Blocking

None.

### Deferred

None.

## Relevant files and approach

Approach: pin clones outside the repo, write a capability brief, do our desk review per repo (with keyless upstream checks on our skills and session-log measurements) and commit it, then launch Astra blind on the same brief (its completion wake shows a result preview, so it starts only after our verdicts are frozen), merge, show the two dropped groups and the popups, then write the ledgers and the umbrella draft. Reuse the Haystack review's doc shape (`docs/proposals/2026-11-12-haystack-review.md`, `docs/proposals/haystack-review/astra-verdicts.md`) and ledger shape (`docs/upstream/haystack.md`).

Locations:

- Clones (outside the repo): `C:\SOFT\git\repo-review\<repo>` at the D-07 pins. Planning-time clones in the system-temp research folder are not relied on.
- Review doc: `docs/proposals/2026-11-19-loopforge-bughunter-skillevaluator-review.md`.
- Astra brief and verdicts: `docs/proposals/repo-review-3f8f9ab7/astra-brief.md`, `docs/proposals/repo-review-3f8f9ab7/astra-verdicts.md`.
- Keyless check outputs: `docs/proposals/repo-review-3f8f9ab7/keyless-checks.md` (summary only, no raw dumps).
- Ledgers: `docs/upstream/loopforge.md`, `docs/upstream/claude-bughunter.md`, `docs/upstream/skillevaluator.md`.
- Our skills for R4: `skills/frontend-design/`, `skills/two-axis-review/`, `skills/diagnosing-bugs/` (confirm the list with `ls skills` at RR-04).

Fit check per touched module (D-10):

- `docs/proposals/` review doc and Astra files: **fits** (the established place for reviews).
- `docs/upstream/<repo>.md`: **fits** (one ledger per upstream, as for Haystack, Matt, Astryx and OpenDesign).
- `extensions/work-catch-up-baseline.json`: not touched here (D-09).

Verdict words (as in the Haystack review): **Adopt idea**, **Test first** (needs a measured trial in the umbrella plan), **Already covered** (name where), **Skip** (with reason).

Planning findings to verify, not verdicts (from the planning survey):

- Plan3 step checks are text the agent records; LoopForge gates run commands and route failures (L2).
- `scripts/compare-benchmark-runs.mjs` prints no intervals; SkillEvaluator marks small runs provisional (S5).
- BugHunter measured about zero capability gain from skills and turned them off for its agents, saving 12-15k tokens each (B1, B4).
- SkillEvaluator names "no control arm for instruction presence" as a limit; our X3 ablation had none either (S5).

Commands (referenced by steps; run them as written, report failures):

- C1 clone: for each repo, `git clone "https://github.com/<owner>/<repo>.git" "C:/SOFT/git/repo-review/<repo>"` then `git -C "C:/SOFT/git/repo-review/<repo>" checkout "<pin>"`.
- C2 SkillEvaluator keyless, from the pinned source: `uvx --python 3.13 --from "C:/SOFT/git/repo-review/SkillEvaluator" skillevaluator quality-check "<skill dir>"` and the same with `harness-check`. Unverified until RR-04; if uvx cannot build it, use `uv venv` plus `uv pip install` in the system-temp folder and say so.
- C3 BugHunter lint: `python "C:/SOFT/git/repo-review/Claude-BugHunter/scripts/lint_skills.py" "C:/SOFT/git/ce-workflow/skills/<skill>"` with absolute paths only (relative paths resolve against BugHunter's clone, `scripts/lint_skills.py:243`). A "missing SKILL.md" result is a bad input, not a finding; grounding errors for missing `sources:` are findings, not failures.
- C4 LoopForge chat UI alone: `npm ci`, then `npx vite --host 127.0.0.1` in `C:/SOFT/git/repo-review/LoopForge/chatbot` with `LOOPFORGE_API` set to a loopback port first confirmed unused (`npm run dev` binds `0.0.0.0` and proxies `/api` and `/mcp` to `127.0.0.1:8080` by default, `chatbot/vite.config.js:3`). Open it headless with agent-browser, read it with `screen_read`, and say whether only the shell rendered or data views worked.
- C2 results describe the six upstream harnesses only; Pi compatibility comes from the existing loader check in `scripts/test-work-plan3.mjs:1464`.
- Licenses for any port (D-04): carry the license and notices of the actual source file. BugHunter puts docs, wordlists, regex catalogs and rubrics under CC BY 4.0 (`README.md:335`); LoopForge's MIT grant excludes the third-party components its `LICENSE` lists.
- C5 session-log measurements: existing scripts first (`scripts/tool-usage-census.mjs`, `scripts/audit-compaction.mjs`, `scripts/context-report.mjs`); throwaway readers go in the system-temp folder.

## Phases

### Phase 1: Review [think]

- [x] **RR-01** Pinned clones in C:\SOFT\git\repo-review (3/3 at D-07 SHAs); blind Astra brief at docs/proposals/repo-review-3f8f9ab7/astra-brief.md.
- [x] **RR-03** LoopForge L1–L14 rows written (1 Test first: post-plan retro L3; rest covered/skip) with path:line evidence and log measurements.
- [x] **RR-04** B1–B8 and S1–S10 verdicts written (2 Adopt idea: S5 uncertainty line, S6 labelled judge suites; rest covered/skip with measurements); keyless checks in repo-review-3f8f9ab7/keyless-checks.md.
- [x] **RR-02** Blind Astra (gpt-6.2-astra high, fresh context) wrote astra-verdicts.md: 32 rows + top 7; session log shows no reads of our review doc, keyless-checks or plan.
- [x] **RR-05** Merged: 17/32 same verdict, 21/32 same outcome; 11 disagreements settled by code/log evidence; shortlist S6, S5, L3; 25 covered drops, 8 uncovered-not-recommended.

### Phase 2: Idea review [think]

- [x] **RR-06** Dropped groups shown; checkbox pick L13; 4 popups: S5 and L13 accepted, L3 accepted with changes (offline multi-model trial on finished plans, two-sided recommendations), S6 rejected.

### Phase 3: Records [code]

- [x] **RR-07** Ledgers docs/upstream/{loopforge,claude-bughunter,skillevaluator}.md written; umbrella draft 5e4d224a (UB-01..08, Q-01/Q-02 deferred) holds the moved requirements and steps; no catch-up entry.

## Global validation

- R1 to R9 hold; the acceptance examples match the files.
- `git show --name-status` for this plan's commits and `git status --short --untracked-files=all` show only `docs/` paths from this work (other sessions' dirty files are named and left alone); `extensions/work-catch-up-baseline.json` and `docs/upstream/processed-videos.json` are unchanged.

## Resume context

RR-01/03/04 done; own 32 verdicts committed 56741d40 (2 Adopt idea: S5 uncertainty line, S6 labelled judge suites; LoopForge L3 Test first). RR-02 running: async delegate c88e591a, model openai-codex/gpt-6.2-astra:high, fresh context, writes docs/proposals/repo-review-3f8f9ab7/astra-verdicts.md, final reply "Verdicts written.". On wake: check file has 32 rows + top 7, commit it, mark RR-02 done, then RR-05 merge (fill Astra/Final columns, agreement count). Never stage docs/plans/logs/{4d2fa07b,f75ccea6,f01355e6}.stats.json or nul.

## Amendments

Append material changes and their reasons; preserve the original request and settled decisions.

- 2026-11-19 /plan3 review (plan3-advisor, gpt-6.2-astra high); every finding checked in the code:
  - Accepted: Astra's completion wake shows a result preview (pi-subagents `src/runs/background/notify.js:229` `formatResultPreview`), so not opening the file is not blind enough. RR-02 now runs after our verdicts are committed (RR-03, RR-04), with a neutral final reply.
  - Accepted: `lint_skills.py:243` joins relative paths to its own repo; C3 now uses absolute ce-workflow paths and treats a missing SKILL.md as bad input.
  - Accepted: harness-check has six harness profiles, none for Pi; S2's counterpart is now the existing Pi loader check in `scripts/test-work-plan3.mjs:1464`, and C2 results are labelled cross-harness.
  - Accepted: `chatbot/vite.config.js` proxies to `127.0.0.1:8080` and `npm run dev` binds `0.0.0.0`; C4 now binds loopback and points the proxy at a confirmed unused port.
  - Accepted: ask_user submits the highlighted option when nothing is checked (`extensions/ask-user/index.ts:728`); RR-06 adds a None option and skips an empty group.
  - Accepted: accepting an idea adds a requirement as well as steps (`extensions/plan3-ideas.ts:76`); RR-06 and RR-07 now move both to the umbrella draft and keep the idea blocks here.
  - Accepted: the S6 counterpart cited spot checks that are not in the repo; replaced with the actual judge scripts and the missing labelled set.
  - Accepted as a precision note, not a change to D-04: per-source-file licenses (BugHunter `README.md:335`, LoopForge `LICENSE` third-party exclusion) added under Commands and RR-07.
  - Accepted: `git diff --stat` misses committed and untracked files; RR-07 and Global validation use `git show --name-status` and `git status --untracked-files=all`.
  - Also fixed: D-11's note that the oracle default was still gpt-6-astra is stale; it now says the builtin reviewer has no configured model.
- 2026-11-19: Added RR-08, RR-09 after RR-07: Accepted IDEA-b08832b1: S5 Honest small-sample results: judge error counts, both-direction changes and a 'not established' line
- 2026-11-19: Added RR-10, RR-11 after RR-09: Accepted IDEA-2f20a933: L13 Quiet-process notice: show when a running command has printed nothing for a while
- 2026-11-19: Added RR-12, RR-13, RR-14, RR-15 after RR-11: Accepted IDEA-cec728e2: L3 Post-plan retro digest (Test first)
- 2026-11-19 RR-07: the three accepted ideas' requirements and the auto-added steps RR-08 to RR-15 moved to the umbrella draft `docs/plans/2026-11-19-build-the-three-accepted-loopforge-and-skillevaluator-ideas-5e4d224a-plan3.md` (UB-01 to UB-08; L3 steps as revised by the user's comment). Idea records and decisions stay here.
- 2026-11-19 RR-02 note: the blind review ran as the builtin `delegate` agent (fresh context, write access limited by its task to `astra-verdicts.md`) rather than `reviewer`, because the brief requires writing that file; the model was still passed explicitly as `openai-codex/gpt-6.2-astra:high` (D-11).





## Ideas

### IDEA-2aa23198 S6 Judge calibration: labelled cases and a --check mode for our model judges

Status: rejected
Response: {"kind":"selection","selections":["Reject"]}

#### What this is

> Our model judges (scripts/judge-handoff.mjs labels final replies handoff/blocker/none; scripts/judge-design-extras.mjs ticks checklist items on blinded pages) decided D-08..D-10 and the soft self-verify wording. Nothing in the repo shows they label correctly: the hand checks were never saved. SkillEvaluator runs its shipped verifier against independently hand-labelled cases, keeps tuning and assessment cases apart, and reports agreement before anyone trusts a score.

#### What you gain

> We would know a judge's error rate before reading a difference between arms into it. Example: soft vs strict self-verify differed by 1 vs 0 judged handoffs. If the handoff judge mislabels 1 in 10 'please run node --test' replies, that difference is noise. Switching the judge model (Luna today) becomes a measured step, not a guess.

#### Drawbacks and risks

> Labelling takes about an hour of human time per judge, and the labels can be wrong too. Each --check run costs a few cents of judge calls. A small set (20-30 cases) shows gross errors only, not fine accuracy.

#### Implementation and affected files

> Per judge, a JSON file of cases under scripts/fixtures/judges/<judge>/ with a hand label and a split (tune/assess), built from real final replies and pages we already have plus a few paired edge cases (asks to run a test it could run vs asks for a physical device). Add --check to each judge script: run it on the assess split, print agreement, a confusion table and the disagreeing case ids; exit non-zero below a stated floor. Reuse the judges' existing prompt and parsing unchanged.

#### Cost

> Small build (~1 script change per judge plus fixtures); about 1 hour of labelling by you or a labelled draft you correct; cents per --check run.

#### Recommendation

> Adopt. Both reviewers chose it independently; it is the cheapest way to make the paid benchmark decisions trustworthy.

#### Sources and agreement

> SkillEvaluator docs/grader-validation.mdx:6-27,108 (14 assessment + 2 tuning cases, --check-suite); docs/metrics-reference.mdx:588. Ours: scripts/judge-handoff.mjs:18,49, scripts/judge-design-extras.mjs:40-51. Measured: 0 labelled judge cases in repo. Astra rank 1.

#### Proposed requirement

> Every model judge we use for decisions has a committed labelled assessment set and a --check mode that reports its agreement.

#### Proposed steps

> - Collect 20-30 cases per judge (handoff, design extras) from existing benchmark results, add paired edge cases, draft labels and have the user confirm them; split tune/assess
> - Add --check to judge-handoff.mjs and judge-design-extras.mjs: run on the assess split, print agreement, confusion table and disagreeing ids, non-zero exit below the floor; a fixture-only self-check for the scoring code
> - Run --check once per judge on the current judge model and record the numbers in docs/agent-rules.md next to the benchmark rule

### IDEA-b08832b1 S5 Honest small-sample results: judge error counts, both-direction changes and a 'not established' line

Status: accepted
Response: {"kind":"selection","selections":["Accept"]}

#### What this is

> Our decisions rest on 3-5 repetitions per arm (X3 6 arms x 3, X6 5 vs 5) and print bare rates such as 'locked tests 0/3 vs 3/3'. compare-benchmark-runs.mjs already pairs runs and drops incomplete pairs; judge-design-extras.mjs already asks for booleans and does the arithmetic. What is missing is the uncertainty and the separation of judge failures from real failures. SkillEvaluator's rules: booleans only, code does the math, one retry on an invalid reply, judge errors unscored, N/A drops out, intervals, and a 'what has not been established' statement.

#### What you gain

> Readers see when a result cannot separate the arms. Example: 3/3 vs 0/3 has wide intervals; '9/9 both arms' would print 'not established: arms not separable at this n' instead of reading as a tie. A judge timeout no longer counts as a failed run.

#### Drawbacks and risks

> More output lines per comparison. Intervals at n=3 are so wide they may feel discouraging (that is the point). Some care to not treat repetitions of one task as independent cases.

#### Implementation and affected files

> In compare-benchmark-runs.mjs: count distinct scenarios, complete pairs, improved/regressed/unchanged pairs and unscored or errored runs; for binary outcomes print a Wilson 95% interval per arm and one 'not established' line when intervals overlap. In the judge scripts: validate the reply shape, retry once, count judge errors and N/A separately. Fixture self-check with duplicate reps, a judge timeout and an inapplicable metric.

#### Cost

> Small: ~60-100 lines across 2-3 scripts plus a fixture self-check; no paid runs.

#### Recommendation

> Adopt. Both reviewers chose it; it changes reporting only, not benchmarks.

#### Sources and agreement

> SkillEvaluator docs/metrics-reference.mdx:24-27,58,191-193,289-290,412,578,607,638. Ours: scripts/compare-benchmark-runs.mjs:1-5, scripts/judge-design-extras.mjs:42,51,78, scripts/judge-handoff.mjs:49. Astra rank 2.

#### Proposed requirement

> Benchmark comparisons and judge summaries show sample counts, judge errors apart from failures, and say when the sample cannot separate the arms.

#### Proposed steps

> - compare-benchmark-runs.mjs: distinct cases, both-direction pair counts, unscored/error counts, Wilson intervals for binary outcomes and a 'not established' line; fixture self-check (duplicate reps, judge timeout, N/A metric)
> - judge-handoff.mjs and judge-design-extras.mjs: reply shape check, one retry, judge error and N/A counted apart from failures, intervals on printed rates

### IDEA-cec728e2 L3 Post-plan retro digest (Test first)

Status: accepted
Response: {"interpretation":"Accepted with changes: trial offline on already finished plans (37 stats.json in docs/plans/logs, 50 done plans) instead of waiting for new finishes; compare several retro models incl. thinking ones; score recommendations on two sides: the project's own flow and ce-workflow itself.","userResponse":"{\"kind\":\"selection\",\"selections\":[\"Accept\"],\"comment\":\"can we also do trials from the already finished plans, stuff is recorded right? test the different models, I guess the thinker ones will perform better here. the outcome can be 2 sided tho - improvement in the project flow and improvement in ce-wf\"}"}

#### What this is

> plan3-stats.ts already records per plan: model thinking/acting time, cost, tool time, tests and builds, slowest commands, failed commands, user wait and per-step totals, and sends speed hints during the run. Nobody turns that into lessons when the plan finishes. LoopForge builds a bounded facts digest of a run (retries, errors, slow nodes) and turns it into applicable recommendations; skills-lab results.md and plan 79614d24 already asked for a post-plan retro.

#### What you gain

> A short list at plan finish such as 'npm run verify ran 9 times (14 min); RR-04 step had 3 failed edits on the same file; 40% of time was waiting for you' points at fixable patterns. Example: the repeated full test run would become a rule to run targeted tests.

#### Drawbacks and risks

> Easy to produce generic advice nobody acts on; costs one cheap model call per finished plan; adds one more message at finish. Value unknown until measured, hence Test first.

#### Implementation and affected files

> At plan finish (/plan3 finish or status complete), build a code-only digest from the plan's stats.json (top repeated commands, failed commands, slowest steps, wait share, retries) and ask a cheap model for at most 3 recommendations that cite digest lines. Write them to the sidecar log; show one notice. Trial on the next 5-10 finished plans, counting recommendations you accept and later find useful; keep only if that count is non-trivial.

#### Cost

> Small build (digest function + one model call); trial needs ~5-10 real plan finishes, cents each.

#### Recommendation

> Test first, as both reviewers said: build the digest cheaply, keep the recommendation step only if the trial shows accepted, useful items.

#### Sources and agreement

> LoopForge internal/runeval/facts.go:72, internal/domain/run_eval.go:40, internal/runeval/apply.go:10. Ours: extensions/plan3-stats.ts:43-58,222-262; skills-lab results.md:55-64; plan 79614d24 backlog line 233. Astra L3 Test first.

#### Proposed requirement

> When a plan finishes, the user gets a short evidence-cited retro from its stats, kept only if a trial shows useful recommendations.

#### Proposed steps

> - Code-only digest from a plan's stats.json at finish (repeated and failed commands, slowest steps, wait share), written to the sidecar log, with a fixture self-check
> - One cheap model call turning the digest into at most 3 cited recommendations, shown as one notice at finish
> - Trial on the next 5-10 finished plans: record accepted/useful counts in the log and decide keep or remove

### IDEA-2f20a933 L13 Quiet-process notice: show when a running command has printed nothing for a while

Status: accepted
Response: {"kind":"selection","selections":["Accept"]}

#### What this is

> LoopForge's process watch kills a command that stops printing and keeps its last lines. We never kill, but neither the hub nor the terminal tells you a bash call has gone silent: you see 'running' until the timeout. plan3-web.ts already receives tool_execution_update with partial output, so silence is observable without new hooks.

#### What you gain

> You notice a hung command (a waiting prompt, a stuck dev server, a dead network call) minutes before its timeout, and the agent can be steered. Example: a git clone waiting for credentials would show 'quiet for 3 min, last line: Username for https://github.com:' in the hub.

#### Drawbacks and risks

> Healthy quiet builds and tests also look silent, so the notice must never stop anything and needs a sensible threshold. Measured gap is small: 75 of 17,930 bash calls (0.4%) hit their timeout; how many long quiet stretches ended fine is not in the logs.

#### Implementation and affected files

> In the hub's tool-row tracking (plan3-web.ts tool_execution_start/update/end), keep the time of the last partial output per running bash call; after a threshold (e.g. 120 s of no new output) mark the row 'quiet for N min' with the last output line. No kill, no agent message. Optionally one hub notice. Self-check with a fake clock.

#### Cost

> Small: ~30-50 lines in the hub/plan view plus a fake-clock self-check; no paid runs.

#### Recommendation

> Small and safe, but the measured gap is low (0.4% timeouts); worth it only as a display hint, never a kill policy.

#### Sources and agreement

> LoopForge internal/procwatch/procwatch.go:60, internal/procwatch/group_windows.go:7. Ours: extensions/plan3-web.ts:144-148 (tool_execution_update already observed), hub/src/sessions.ts. Measured: 17,930 bash calls, 94.5% with timeout, 75 timed out. Astra L13 Test first (warning, not kill).

#### Proposed requirement

> A running command that has printed nothing for a while is shown as quiet, with its last output line, without stopping it.

#### Proposed steps

> - Track last-output time per running bash call from tool_execution_update and show 'quiet for N min' plus the last line on its tool row after a threshold; fake-clock self-check
> - Check it in the headless hub with a command that sleeps silently past the threshold
