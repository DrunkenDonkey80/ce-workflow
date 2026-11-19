---
plan3: true
status: active
created: 2026-11-19
updated: 2026-11-19T21:01:03.981Z
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
- [ ] **RR-02** After RR-03 and RR-04 are committed, launch Astra (D-11, model set explicitly) blind and async on the RR-01 brief; verdicts land in astra-verdicts.md.
  - Task tells Astra to write the file and end with a neutral one-line reply; our verdicts are already frozen, so the wake preview cannot anchor them.
- [ ] **RR-05** Merge Astra's column: agreement count, each disagreement settled in code, final verdicts, shortlist and both dropped groups.
  - Drop weak or duplicate candidates with reasons; split them into Already covered and Not covered, but not recommended (R5).

### Phase 2: Idea review [think]

- [ ] **RR-06** Reply with both dropped groups and one checkbox ask_user (R5), then `plan3 ideas` for the shortlist plus picked items; record decisions.
  - Each popup: what it is here, benefit with example, drawbacks, approach, cost, recommendation, sources with upstream `path:line` and measured gap.
  - The checkbox question has a "None, continue with the shortlist" option (Enter submits the highlighted row, `extensions/ask-user/index.ts:728`); skip the question when group 2 is empty.
  - Accepting an idea auto-adds its requirement and build steps to this plan (`extensions/plan3-ideas.ts:76`); RR-07 moves both, with any user edits, to the umbrella draft and keeps the idea blocks and decisions here.

### Phase 3: Records [code]

- [ ] **RR-07** Write the three ledgers (R7); when ideas were accepted, create the umbrella Plan3 draft (R8) and link it from each ledger.
  - The draft request names each idea, its upstream paths and pin, the evidence, the catch-up entry to add when built, and D-04 with the per-file license note.
  - Remove the auto-added requirements and steps from this plan after copying them into the draft (RR-06 sub-bullet).
  - Check: `git show --name-status` for this plan's commits and `git status --short --untracked-files=all` list only `docs/` paths from this work.

## Global validation

- R1 to R9 hold; the acceptance examples match the files.
- `git show --name-status` for this plan's commits and `git status --short --untracked-files=all` show only `docs/` paths from this work (other sessions' dirty files are named and left alone); `extensions/work-catch-up-baseline.json` and `docs/upstream/processed-videos.json` are unchanged.

## Resume context

Planning and review done; status draft, no open questions. The review accepted all 9 advisor findings (see Amendments): Astra now runs after our 32 verdicts are committed (order RR-01, RR-03, RR-04, RR-02, RR-05). C3 uses absolute paths, C4 binds to loopback, and S2 uses Pi's own loader check. RR-06 gets a None option, RR-07 moves accepted requirements and steps to the umbrella draft, and the validation uses git show plus git status. Next: RR-01 after the user runs /plan3 finish.

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
