# Compare current CE, thin CE, and direct-agent work

Date: 2026-09-19
Status: experiment authorized; no production adoption authorized
Owner: parent session; implementation and investigation: Sol (`openai-codex/gpt-5.6-sol`)
Repository: `C:/SOFT/git/ce-workflow`
Starting branch/HEAD: `master` / `8cd33bb48f9a9e2f096177cd70654fadf71fe817`

## Decision to make

Should ordinary development and product thinking continue through the current CE workflow, use a much thinner CE operational layer, or use a direct agent with minimal task instructions?

Working hypothesis, not a conclusion: retain reliable execution infrastructure while removing mandatory reasoning ceremony. Strong models may benefit more from precise goals, project knowledge, tools, and feedback than prescribed planning/advisor pipelines. Measure quality and total effort, not prompt length alone. A result favoring current CE is valid.

## Findings motivating the experiment

- Private brainstorm/plan/debug/review playbooks are already only about 323/473/278/222 words. Much of the burden lives in prompt builders, role instructions, and configuration rather than SKILL.md alone.
- The planner role is about 1,777 words and the worker about 1,160, including helper protocols and recovery exceptions.
- Observed global settings enable three advisors, pre-brainstorm advisors, all-advisor slice planning, task-advisor verification, simplification before review, and three background-verifier profiles. Refresh this observation before freezing the baseline.
- A fresh brainstorm can request three pre-draft and three post-draft advisors; Wide can add three divergent branches. These are potential configured calls, not measured counts for every task.
- Ideation prescribes 20–30 candidates, numeric confidence scores, and dropping unverifiable ideas; this may discourage useful uncertain hypotheses.
- The coded Open Question Gate blocks on all detected questions, including otherwise non-blocking questions with defaults.
- Some discovery guidance limits searches to missing named paths; some generic finalization guidance conflicts with newer push restrictions. Preserve the higher-priority user approval boundary in every arm.
- Existing live relay evidence found added planner handoffs slower/more expensive on small tasks with equal acceptance: Astra→Sol versus Sol about +50% time/+75% estimated cost; Opus→Sonnet versus Sonnet about +62%/+132%. This does not establish CE-versus-direct performance or harder-task quality.
- `scripts/run-work-slice-benchmarks.mjs` measures synthetic local operations and word counts, not live provider workflow performance. Do not use its adoption percentages as experimental evidence.

Relevant local sources:

- `C:/SOFT/git/ce-workflow/extensions/private-workflows/`
- `C:/SOFT/git/ce-workflow/extensions/work-models.ts`
- `C:/SOFT/git/ce-workflow/agents/`
- `C:/SOFT/git/ce-workflow/skills/work-orchestrator/SKILL.md`
- `C:/SOFT/git/ce-workflow/.pi/model-relay-benchmark/report.md`
- `C:/SOFT/git/ce-workflow/.pi/model-relay-benchmark/pilot-results.json`
- `C:/SOFT/git/ce-workflow/scripts/workflow-evaluation.mjs`
- `C:/SOFT/git/ce-workflow/scripts/benchmark-model-relay.mjs`
- `C:/SOFT/git/ce-workflow/benchmarks/workflow-evaluation/v1/`

External context (not proof about this installation):

- <https://arxiv.org/html/2602.11988v2> — repository context can increase cost without a significant success benefit; not a blanket result about skills.
- <https://arxiv.org/html/2602.12670v4> — curated specialized skills can improve success; gains vary, and some tasks regress.
- <https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents> — high-signal context and flexible heuristics rather than brittle procedural prompting.

## Candidate policy to test, not install

| Operation | Thin candidate |
| --- | --- |
| Brainstorm | Flexible exploration; clarify decisions that materially change direction; save a compact artifact when useful. |
| Ideate | A few distinct promising ideas, evidence, uncertainty, and cheap experiments; no candidate quotas or calibrated-looking confidence scores. |
| Plan | Durable plans for consequential or multi-session work; routine implementation stays in one context. Defer reversible non-blocking choices explicitly. |
| Work | One agent owns implementation and verification. Delegate only independently useful work. |
| Debug | Reproduce where feasible, establish the causal chain, fix the shared cause, rerun the original failure and relevant checks. Fresh investigator only when useful. |
| Review | Independent review for consequential changes; no routine committee. |
| Simplify | Part of implementation judgment, not a compulsory separate completion gate. |
| Learn | Retain demonstrated reusable project facts, not ritual retrospective artifacts. |
| Infrastructure | Keep approvals, manual-edit protection, relevant proof, durable progress/recovery for long tasks, and safe Git operations. |

Minimal task contract:

> Outcome; constraints/invariants; relevant facts and starting points; observable acceptance; approval boundaries. Choose the approach, preserve unrelated work, verify the result, and disclose uncertainty.

Slim the whole instruction stack, including generic always-on advice where appropriate, rather than replacing CE ceremony with equally long alternative prompts. Do not remove domain knowledge or task requirements merely to reduce tokens.

## Three experimental arms

**A — Current CE:** freeze the actual installed workflow source, effective task-relevant settings, prompt/role contracts, tool surfaces, and configured model identities. Exercise applicable real stages. Count all advisors, reviews, continuations, background verifier work, triage, and failures. Do not use a hand-written long prompt as a substitute for the actual workflow.

**B — Thin CE:** same product requirements and safety/proof obligations, with the candidate policy above. Retain needed durable state and recovery, but no routine planning/advisor/simplification pipeline. Sol owns normal implementation. Candidate changes exist only in disposable experiment resources, not installed defaults.

**C — Direct:** Sol with the minimal task contract, repository-specific facts, and appropriate tools. No CE tracking/stage requirements. Keep equivalent authorization, edit protection, and acceptance evidence. Long tasks still need a small checkpoint; removing durable coherence is not the optimization being tested.

The primary comparison is between usable operational configurations. A's existing mixed-model roles are a real cost of that configuration, but confound model-versus-workflow attribution. Record this explicitly. If a matched-Sol diagnostic is feasible, label it separately as a model-controlled prompt/workflow ablation, not the current installed baseline. Never silently substitute models.

## Authority and repository safety

Authorization update, 2026-09-19: the user explicitly selected “Yes—run the faithful comparison” when asked to allow real CE lifecycle operations and local commits strictly inside disposable test repositories. The earlier blanket restriction was imposed by this experiment plan, not by the user, and is superseded within that isolated scope. Actual runtime authorization requirements still apply; approval is not permission to bypass guards.

The parent source session remains direct work, not a /wo lifecycle run. In isolated A/B trial repositories, normal CE activation, work-item state, applicable helpers/roles, Git initialization on master, staging, and local-only commits are permitted through their supported authorized entry points. Give every arm an equivalent starting Git snapshot. Never push, add a remote, disable authorization checks, or mutate the live source work-item store. If the runtime requires the user to activate /wo in a dedicated test session, provide the exact action rather than fabricate activation.

Arm B must retain and exercise the declared CE operational infrastructure in an isolated candidate; a longer direct-agent prompt alone is not thin CE. Any prompt-only diagnostic must be separately labelled and cannot decide the full operational comparison.

Use native pi-subagents for delegated model execution only. No raw agent CLI, SDK-created agent sessions, or external-mode fallback to bypass native execution policy. The Sol child does not recursively delegate: prepare bounded trial packets and request parent-controlled native launches when needed. The parent owns additional authorization and trial orchestration.

The source checkout is already dirty. Preserve all existing tracked and untracked work, including the untracked model-relay scripts. In the source checkout, do not stage, commit, push, reset, stash, switch branches, alter global/project settings, edit the live work-item store, or activate new production behavior. Experiment-specific settings may exist only within disposable trial repositories/runtime profiles. Work directly on master for any approved experiment-only source additions. No feature branches or managed worktrees; the local Git operations authorized above apply only to disposable repositories.

Capture the starting dirty manifest and relevant source hashes. Run task samples in fresh disposable directories outside this checkout, using fixture snapshots and only required source files. Do not copy credentials, private session archives, or unrelated project data. Existing provider access may be used through the approved runtime; no new paid services or installations.

Allowed persistent edits: this plan if an evidenced correction is needed, narrowly named new comparison scripts/fixtures where reuse is insufficient, and a final comparison report. Prefer existing harness components; do not refactor unrelated infrastructure or modify the pre-existing dirty scripts. Raw evidence belongs under an isolated `.pi/workflow-comparison/<run-id>/` or retained temporary artifact directory, not repository root.

## Execution

### 1. Freeze a feasible experiment

Inspect the existing evaluation and relay harnesses before building anything. Determine which authentic arms can run through the permitted native protocol, what requires parent launches or /wo authorization, and whether any existing gates/approvals are missing. Reuse fixtures and telemetry readers where they fit; no new generic framework.

Write a compact manifest before paid trials: exact source/settings/prompt hashes, models and effort, tool/extension inventory, fixtures and acceptance hashes, schedule, limits, and evidence destinations. Do not expose held-out acceptance tests or evaluator labels to sample agents.

Use six representative cases:

1. Routine bounded implementation using existing conventions.
2. Bug whose real cause requires tracing a caller beyond the initially named file.
3. Cross-layer feature with compatibility and failure-path requirements.
4. Ambiguous product brainstorm: existing facts resolve some questions; one genuine decision requires clarification.
5. Ideation: reward useful distinct grounded hypotheses and testability, not quantity or numerical scores.
6. Multi-step plan→implementation→checkpoint/resume task with a meaningful security, compatibility, or data-integrity invariant.

Choose cases from existing fixtures or safely extracted project patterns. Include real difficulty rather than only trivial cases all models solve. Freeze outcomes, non-goals, and a scripted clarification answer bank first. Prefer supported local capabilities; do not create speculative hardware requirements.

### 2. Validate wiring before the pilot

Use existing relevant selfchecks. Any new non-trivial harness logic needs a focused runnable regression check integrated with the established test style. Prove incomplete implementations fail acceptance, failures remain in totals, arm context does not leak, and usage aggregation counts continuations/children exactly once. Use LSP checks before builds and inspect session diagnostics for edited files.

Run one matched trio first. Stop for infrastructure/provenance failures, unavailable exact models, missing authorization, or inability to meter the run. Do not relaunch repeatedly or change execution mode. Preserve partial results.

### 3. Bounded live pilot

Initial ceiling: six cases × three arms × one repetition = 18 top-level task trials, including the wiring trio if its frozen configuration is unchanged. This is diagnostic, not a statistically powered adoption decision. If an arm is blocked, report missing cells rather than dropping it from the denominator or declaring a winner.

Rotate A/B/C order across cases and avoid same-provider contention where practical. Use fresh fixture state and fresh contexts; no preceding arm solutions. Keep per-case effort and limits declared before runs. Before launching, propose an enforceable cumulative usage/time ceiling to the parent using the wiring estimate; do not start an unbounded campaign or add paid repetitions without approval. Count preparation/evaluation expense separately from the workflow's task execution cost.

For any proposed production optimization, the later confirmatory run must rerun the same full end-to-end cases with all continuation sessions aggregated, compare against the frozen accepted baseline, and include repeated alternating trials. Do not adopt based only on focused checks or this one-repetition pilot.

## Scoring and accounting

Hard outcomes first:

- Functional acceptance and regression checks.
- Requirement preservation, compatibility/security/data invariants.
- No unauthorized actions, overwritten manual edits, or false completion claims.
- For long work, coherent recovery and completion from the checkpoint.
- For brainstorm/ideate/plan, blinded rubric: relevance, distinctness, feasibility, grounded uncertainty, missed constraints, actionable decisions, and downstream usefulness. Human judgment or a permitted blinded evaluator is required; the implementing agent's self-score is not independent proof.

For every arm and case report:

- Success/failure/blocker and quality findings, not only averages.
- End-to-end wall time and separately active processing versus human/external waiting.
- Provider input/output/cache tokens and total tokens for root plus all children/continuations; de-duplicate records.
- Estimated catalog cost with pricing provenance; mark unavailable costs unknown, never zero. Subscription estimates are not invoices.
- Assistant turns, tool calls, role launches, retries, human questions/interventions.
- Time-to-first-useful-artifact, avoidable clarification, and operational failures where observable.
- Preparation and evaluator overhead separately; maintenance complexity qualitatively, without invented savings.

Preserve failed/aborted attempts and delayed verification/triage costs. No cherry-picked reruns. Do not claim prompt length or synthetic token estimates are actual usage.

## Interpretation and adoption gate

Give a recommendation per task class, not a forced universal winner. A candidate is promising only if required outcomes and safety remain intact and overall cost/runtime improve without material compensating regressions. Differences under 10% are descriptive noise at this pilot size, not proof; larger differences still require repetition. Equal pass rates on easy tasks do not prove quality equivalence.

Possible conclusions: keep current CE for a specific class; prefer thin CE; prefer direct work; or insufficient evidence. A cost saving with missing requirements is a failure, not a win. A faithful arm that cannot run is a feasibility finding, not a quality loss attributed to its model.

No defaults, prompts, safety gates, or package ownership change automatically. Production adoption requires user approval and the same end-to-end repeated comparison; reject/revert experimental optimization when it materially regresses overall results.

## Deliverables and done criteria

- This durable plan.
- Frozen manifest and exact arm definitions, including authentic-versus-diagnostic labels.
- Minimal reusable comparison implementation only if required, with focused validation evidence.
- Retained per-trial outputs, logs, revision/context provenance, and reconciled usage.
- Final report at `C:/SOFT/git/ce-workflow/docs/research/2026-09-19-ce-workflow-comparison.md`: matrix, per-case findings, totals, limitations, blocked arms, recommendation, and exact next step.
- Final handoff distinguishes completed analysis, harness preparation, actual live trials, and unperformed confirmation. Report all changed files and baseline preservation. Do not call the comparison complete while authorized feasible trial work is still pending; if blocked, state the concrete permission or infrastructure required.
