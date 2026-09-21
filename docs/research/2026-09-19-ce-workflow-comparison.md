# Current CE vs thin CE vs direct agent — stopped pilot report

Date: 2026-09-19  
Starting branch/HEAD: `master` / `8cd33bb48f9a9e2f096177cd70654fadf71fe817`  
Status: **stopped by user after two infrastructure-invalid attempts; no production adoption**

## Executive finding

No valid current-CE/thin-CE/direct comparison has completed. Two user-origin C01 `/wo` cells launched, but both were infrastructure-invalid before product implementation; C was not launched. Current CE therefore has not lost a quality comparison, but the failed startup overhead is real operational evidence.

Both A and B first saw Pi Lens probe output as untracked dirt, entered dirty recovery, launched Sol, and committed only an ignore rule. Their subsequent work commands failed because the fixtures lacked `.ce-workflow/work-items.json`. A also attempted a background verifier, which failed before model execution because Sol/high reached its usage limit until `2026-09-19T19:23:13.278Z`. Neither arm changed `commands.mjs`; both fail hidden acceptance.

Observed invalid-attempt overhead: **742,571 tokens, USD 2.191107 estimated catalog cost, about 5m20s agent duration, 34 tool calls, zero task tests, and zero product changes**. This is separate from the already-recorded experiment-preparation overhead. It is evidence of workflow/setup fragility, not evidence about implementation quality.

Fresh A2/B2 replacement fixtures preserve the failed repositories and correct both setup defects: runtime paths are ignored before Pi starts, and a validated empty native work store is tracked. They pass baseline/store/cleanliness preflight and still fail incomplete hidden acceptance. When offered a replacement run after quota reset, the user selected **Stop and report**. No more cells are authorized.

## Actual work versus preparation

| Item | Result |
| --- | --- |
| Starting dirty manifest | Captured before experiment writes, including all seven modified tracked paths and six pre-existing untracked paths |
| Effective current-CE settings | Frozen by settings hash and recorded role/gate/model map |
| Relevant source prompts | SHA-256 evidence captured for `work-models`, orchestrator skill, all agent files, and all private workflows |
| Six case classes | Prepared with visible outcomes, invariants, non-goals/approval boundaries, and observable acceptance |
| Disposable workspaces | 18 isolated snapshots created outside the checkout; hidden authority files were not copied into them |
| Acceptance preflight | Four coding seeds passed baseline checks and failed independent acceptance as required |
| C01 protocol correction | Failed originals preserved; A2/B2 pre-ignore runtime output and include a valid tracked work store; baseline passes and incomplete acceptance fails |
| Wiring trio | **Invalid/incomplete:** A and B startup attempts failed before task work; C not launched |
| Full pilot | **Not run** |
| Blinded qualitative evaluation | **Not run** |
| Production changes/adoption | **None** |

Evidence root: `.pi/workflow-comparison/2026-09-19-pilot-001/`  
Disposable root: `C:/Users/Flex/AppData/Local/Temp/ce-workflow-comparison-2026-09-19-pilot-001/`

## Frozen cases

1. Routine bounded implementation: add deterministic `list --json` while preserving compatibility.
2. Caller-tracing bug: distinguish an explicitly empty CLI label from an omitted label; the causal defect is beyond the initially named formatter.
3. Cross-layer feature: atomic validated config patch across module/command boundaries, including prototype-key rejection and compatibility.
4. Ambiguous product brainstorm: repository facts settle most scope; exactly one retention-policy decision uses a frozen answer bank.
5. Grounded ideation: reduce alert fatigue using distinct evidence-backed hypotheses and cheap tests, without candidate quotas or numeric confidence.
6. Plan→implementation→checkpoint/resume: atomic profile import with secret/data-integrity invariants and a fresh-context continuation.

Cases 1–3 and 6 have independent executable authority checks. Cases 4–5 have frozen blinded rubrics; case 4 also has a scripted clarification answer. The qualitative cases still require a permitted independent blinded evaluator or human judgment during a future run.

## Arm validity and feasibility matrix

| Arm | Prepared state | Live result | Exact blocker |
| --- | --- | --- | --- |
| A — current CE | Failed repository retained; corrected A2 fixture prepared | Invalid attempt | Dirty recovery consumed 388,912 tokens and committed only an ignore rule; task resume then lacked the work store; verifier launch hit Sol quota. |
| B — configuration-thinned operational CE candidate | Failed repository retained; corrected B2 fixture prepared | Invalid attempt | Dirty recovery consumed 353,659 tokens and committed only an ignore rule; task resume then lacked the work store. |
| C — direct | Clean matching product fixture and minimal Sol/high packet | Not run | Held to avoid an unmatched comparison; exact Sol child is quota-blocked until the reported reset. |

A's installed mixed-model roles are an intentional operational-configuration confound: Astra planning/debug, Sol work, Opus review/advisor, Astra advisor 2, GLM advisor 3, plus three background-verifier profiles. A future report must keep this explicit and must not silently replace those models with Sol.

## Quality, cost, and time evidence

### Live experiment

No valid task result exists. Two infrastructure-invalid attempts are retained:

| Arm | Tokens | Estimated cost | Agent duration | Tools | Product outcome |
| --- | ---: | ---: | ---: | ---: | --- |
| A | 388,912 | USD 1.228917 | 171,515 ms | 16 | No product change; hidden acceptance failed |
| B | 353,659 | USD 0.962190 | 148,749 ms | 18 | No product change; hidden acceptance failed |
| **Total** | **742,571** | **USD 2.191107** | **320,264 ms** | **34** | **0 task tests; 0 product changes** |

Costs are runtime estimates, not invoices. Interactive wait and failure-handling time are not included in agent duration. Detailed evidence is retained in `.pi/workflow-comparison/2026-09-19-pilot-001/raw/c01-invalid-attempts.md`.

### Preparation overhead

Preparation consisted of the original Sol session's repository inspection, local file operations, fixture generation, and local Node checks. No child agents, continuations, model substitutions, external services, or experiment task trials were launched. Authoritative original-run `status.json` reports **1,658,457 total tokens, 28 turns, 91 tools, and USD 9.05406 estimated catalog cost** (runtime estimate, not invoice). This already-spent preparation usage is separate from live trial usage. This recovery continuation must be aggregated separately by the parent runtime; its provider totals are not available inside the child.

The existing model-relay pilot and synthetic workflow-evaluation/adoption runs were inspected only for reuse and feasibility. Their measurements are **not** included as current experiment results.

## Harness reuse assessment

- `scripts/workflow-evaluation.mjs` and its RPC module contain useful patterns for hidden acceptance, provenance, failed-attempt retention, and root/child ledger reconciliation.
- That live runner spawns a Pi RPC/CLI process and targets a different baseline/candidate experiment. The current request permits only parent-controlled native pi-subagents, so it is not an allowed launcher here.
- `scripts/model-relay-fixtures.mjs` supplied the established C01 seed/acceptance pattern. Reusing a seed does not convert prior relay runs into evidence for this comparison.
- No generic production harness or workflow behavior was added or changed.

## Preflight evidence

The following baselines passed:

```text
node <C01 workspace>/selfcheck.mjs
node <C02 workspace>/test.mjs
node <C03 workspace>/selfcheck.mjs
node <C06 workspace>/selfcheck.mjs
```

Each corresponding hidden verifier returned exit 1 against the incomplete seed, proving incomplete implementations do not pass acceptance. Full output is retained in `raw/preflight-validation.log` (frozen SHA-256 in `manifest.json`).

Two later read-only hashing attempts were rejected by the direct-request authorization guard because their command text named the work store/helper. Exact runtime output for each was:

```text
Direct request mode does not authorize ce-workflow orchestration. Run `/wo resume <roadmap-id>` from the input, or run `/wo` and choose Resume work.
```

The commands made no changes. They were not retried through alternate spellings or bypasses. Consequently, the starting manifest records path/status and aggregate diff stat for that protected pre-existing dirt rather than claiming content hashes that were not obtained.

## Repository preservation

The source checkout began dirty with:

- Modified: `.ce-workflow/work-items.json`, six named test/verification/helper scripts.
- Untracked: `.pi-test-empty-agent/` files, `NUL`, the parent-owned plan, and the two model-relay scripts.

Those pre-existing paths were not edited, staged, reset, stashed, committed, or pushed by this experiment. Experiment evidence is isolated under ignored `.pi/workflow-comparison/`; disposable samples are outside the checkout. The new durable source-checkout deliverables are this report and the parent-owned plan. Local initialization/staging/commits occurred only in authorized disposable C01 repositories, with no remotes or pushes.

## Recommendation

### What the pilot supports

- **Stop using full CE ceremony as the default for routine work.** The pilot did not measure implementation quality, but it directly demonstrated operational fragility and large non-productive overhead on a trivial task.
- **Retain the safety layer:** approval boundaries, manual-edit protection, relevant tests, safe Git behavior, telemetry, and durable recovery for genuinely long work.
- **Prefer direct single-owner work for routine bounded implementation.** Escalate to planning, advisors, independent review, or durable orchestration only when task risk or duration justifies it.
- Treat the proposed configuration-thinned CE as unvalidated. It may be useful, but this pilot did not reach product work and did not test a full prompt rewrite.

### What the pilot does not support

- It does not prove direct Sol produces better code than current or thin CE.
- It does not provide task-class pass-rate, quality, or runtime comparisons.
- It does not justify deleting recovery or safety infrastructure.
- It does not authorize automatic production-setting changes.

This recommendation also considers the separately retained relay pilot, where planner→builder paths had equal correctness on small fixtures but materially higher runtime and estimated cost. That evidence is supportive context, not a substitute for this failed comparison.

## Concrete workflow follow-ups

1. A fresh repository's `/wo Small task` path should initialize the native work store or expose an explicit bootstrap action instead of failing only after recovery work.
2. Generated Pi/Pi Lens runtime files should be ignored or classified as benign before dirty recovery dispatch; spending a model call to commit an ignore rule is avoidable.
3. Benchmark preflight must start an actual interactive runtime probe before declaring the repository clean; static Git checks were insufficient.
4. Failed setup/recovery attempts must remain in total cost and token accounting even when no product task executes.

No production fix was attempted in this already-dirty checkout; these follow-ups are bounded separately from the stopped experiment.

## Closure

The user selected **Stop and report** rather than exceeding the original attempt ceiling. The corrected A2/B2 fixtures remain only as reproducibility artifacts; they are not queued or authorized to run. C was never launched. Production settings and workflow code remain unchanged.
