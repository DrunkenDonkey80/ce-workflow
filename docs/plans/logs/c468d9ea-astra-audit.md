# Result

Reviewed **66 distinct plans across all 15 repository roots in `jobs.json`**—13 project families after grouping the Belot and SketchUp worktrees. The sample supports **targeted wording changes, not a step-count rule**.

The strongest finding is the interaction between **fragmented steps, mandatory judgment phases, and full-suite runs at every phase boundary**. The weakest claims are that every separate verification step is wasteful, or that the sensitivity rule requires both red/green and mutation: neither is supported.

## Inherited decisions

- Research only; no product changes.
- D-03: Tiny/Plan/Map sizing is out of scope.
- D-04: wording only; no step budget or new granularity lint. Avoid both command-sized steps and multi-day implementation blocks.
- Bug batches normally use one step per report, with reproduction, fix and regression together, plus shared final testing.
- D-05: targeted checks during implementation; full suite before completion and release.
- D-06: matched planning-and-execution benchmark, two repetitions per arm; aggregate all continuation sessions and all required metrics.

## Diagnosis

### Method and limits

I read the supplied Original request and Phases ranges directly from the plan files, fetched request continuations where necessary, and inspected selected Decisions/Amendments for review and sensitivity provenance.

These are **qualitative classifications of current plan documents**, not measurements of execution waste. Many completed plans contain subsequent user requests and discoveries. A long final plan does not establish that its original planner oversplit it.

Pattern codes below identify **candidate fragmentation**, not mechanically forbidden forms:

| Code | Meaning |
|---|---|
| C | Routine test-writing/checking split away from its implementation, or fragmented final verification |
| R | Reproduction/diagnosis separated from the fix despite no evident independent investigation deliverable |
| S | Commit/shipping administration made a separate fragment |
| M | Qualification scenarios potentially share one environment/run |
| F | One outcome fragmented by file, component, documentation or implementation detail |
| T | A small judgment/evaluation operation receives its own phase |
| U | Conversely, a step bundles several substantial outcomes or mixes runnable implementation with blocked qualification |
| A | Confirmed review-added checking/acceptance work; **not automatically unnecessary** |

### Plans read

“Mixed” means preserve the meaningful boundaries but merge or reconsider particular fragments. Phase line ranges refer to the files identified by plan ID in `jobs.json`.

| Project | Plan ID; phase lines | Verdict | Patterns and concrete evidence |
|---|---|---|---|
| BarcodeDisplay | `2e4b2c42`; 89–120 | Mixed | F,C: meaningful screens, but theme/gradient/dialog/docs fragments and separate G11/G12 validation could be consolidated. |
| BarcodeDisplay | `1e1efb62`; 264–313 | Right-sized | A: Map→Characterize→Design→Pick→Build→Replay→Switch→Retire is explicitly requested. Review added real-caller smoke coverage; preserve gates. |
| BarcodeDisplay | `a18e261d`; 156–182 | Mixed | F: FW-04 says the idle-frame work already landed with FW-03. Firmware, host management and physical acceptance otherwise have real boundaries. |
| BugReport | `f2ceca9b`; 153–201 | Mixed | F,C: S15 client and S16 its tests can be one outcome; several setup/documentation fragments. Threat model, deployment and installed-client pilot remain distinct. |
| BugReport | `de85c778`; 121–149 | Right-sized | Static gate, screener, confined analyzer, live attack evaluation and machine cutover are substantive outcomes. |
| BugReport | `6b3037ee`; 123–157 | Mixed | F,C: Kotlin library/test split K1/K2 and small administrative pieces. Android, desktop and iOS qualification must not disappear. |
| DealFinder | `7003a034`; 161–212 | Right-sized | Broad new pipeline with independent source-access uncertainty, pricing, AI validation and sustained evaluation. Thirty steps alone proves nothing. |
| DealFinder | `b8ad3205`; 173–218 | Right-sized | Explicit rework recipe; characterization, replay and human cutover are requested deliverables, not accidental testing phases. |
| DomainCheck | `79990282`; 198–226 | Mixed | C,F: checker and scheduler tests split P2-1/P2-2; rule-suggestion proof separated again at P4-3. Live model tuning remains meaningful. |
| DomainCheck | `aa100138`; 105–136 | Mixed | F: environment-file and record-only fragments; security scan and first deployment are explicitly required by the runbook. |
| DomainCheck | `7ef94b9c`; 99–132 | Mixed | S,M: C12 is a commit-only step; owner/test-account checks C9/C10 could share one deployment qualification. Credential/DNS prerequisites remain distinct. |
| DomainCheck | `0c55372d`; 112–130 | Oversplit | F,C,S: CSS, markup, old-CSS removal, checks and commit become separate steps for one selected design. Deployment approval remains legitimate. |
| FurnitureDB | `b26fd581`; 150–201 | Mixed | C: some criteria/API checks can sit within their parent design/pilot outcome. Preserve schema application, immutable pipeline identity and acceptance gates. |
| FurnitureDB | `7383b547`; 191–230 | Mixed | M: H2 manual capture scenarios and V1 verification overlap in one Helium acceptance run. The live schema migration is a separate risk boundary. |
| FurnitureDB | `a3553f86`; 181–228 | Right-sized | Multiple actual asset pipelines, durable jobs, publication, live tuning and external integration guide. Not a small feature disguised as 28 steps. |
| FurnitureDB | `5c946347`; 217–249 | Mixed | C: S3 offline acceptance belongs with S2 worker; sustained acquisition, discovery audit and coverage population are different outcomes despite tiny phases. |
| FurnitureDB | `1b037b9a`; 128–149 | Right-sized | New formats, migration/rehearsal, consumer compatibility, live migration and irreversible cleanup deserve separate checkpoints. |
| FurnitureDB | `c6f5908f`; 103–129 | Mixed | F: registration and exclusion guard A1/A5 can accompany the ingest slice. Texture generation, live pilot and handoff remain substantial. |
| LetMeBuy | `8da6f8ba`; 227–354 | Mixed | U: O01/O02 mix runnable source work with extensive external qualification and accumulate many partial outcomes. Most of the 51-step restoration scope is genuine. |
| LetMeBuy | `a1683400`; 108–151 | Mixed | F,A: phone-only voice is split by client/server removal; review added labeled evaluation and physical-device proof. Hosted features and provider qualification stay separate. |
| PhotoBook | `6b5c5c72`; 210–335 | Right-sized | Payments, privacy, print supplier, email, backups, legal approval and public cutover have materially different prerequisites. A three-step collapse would be unsafe. |
| PhotoBook | `aecf9f33`; 250–283 | Mixed | C,F: cleanup and verification fragments; later B16–B20 reflect subsequent design work, so repeated verification is not inherently redundant. |
| PhotoBook | `4be7eb9c`; 127–165 | Mixed | F,C: many client-foundation pieces and separate final suite/browser/sensitivity steps. Account ownership and consent changes are real independent risks. |
| SpaceMind | `c1c155fc`; 144–258 | Mixed | C,F: many separate invariant/test/report steps; substantial later scope accumulated. Real-room, owner-taste and construction-feasibility gates cannot be merged away. |
| SpaceMind | `c49b180c`; 209–265 | Mixed | C,F: repeated “port→tests pass→record” fragments. Data copying, client cutover and destructive retirement remain independent boundaries. |
| WebPublish | `84942c29`; 139–199 | Mixed | C: scanner implementation and scanner tests split P4-01/02/03. Research guides are requested artifacts, not gratuitous documentation steps. |
| WebPublish | `d39cf003`; 40–49 | Mixed | F: inspection and inventory bookkeeping can accompany DNS/server outcomes. Exact-command approval is a real gate. |
| ainews | `3d1de926`; 123–157 | Mixed | F: scaffold/schema/wiring and final report bookkeeping are fragmented. Fetch, judgment, feedback learning and online sync are genuine features. |
| Belot | `b6df803a`; 88–134 | Mixed | F,T: GC-01 is a separate settled-questions phase; interface/entitlement/wiring fragments. Two-player Game Center proof remains necessary. |
| Belot | `77951b54`; 140–182 | Mixed | C,F: fonts/data plumbing and final verification fragments. The seven user-selected UI areas are not one small outcome. |
| Belot | `f291ff96`; 139–183 | Right-sized | Search, bidding experiments, personalities and adaptation require real measured decisions. Rejecting unsuccessful experiments is a valid outcome. |
| Belot | `c3a4f689`; 111–156 | Right-sized | Broad animation overhaul, shared timeline and later scoring/bot requests. Device profiling and multi-platform acceptance are justified. |
| Belot | `851e0b89`; 114–134 | Mixed | M: simulator parity and online lifecycle could share a qualification step, with the local Worker prerequisite explicit. Platform implementation is substantive. |
| Belot | `67abca66`; 81–110 | Right-sized | User explicitly requested audit first, shared fixes, then Mac verification. Do not ban its audit or separate Mac check. |
| Belot | `8320b579`; 113–161 | Mixed | F,C: shell/strip fragments and documentation/check pieces. Mac, simulator and signed-device checks have distinct environments. |
| Belot | `f3385209`; 73–89 | Right-sized | Bounded strategy experiment; setup, measured rounds and record/cleanup are real research deliverables. |
| Belot | `ec7e32bd`; 64–90 | Mixed | F: line-ending repair and standalone result reporting can accompany the relevant outcome. Upload and strategy harness are separate requested features. |
| Belot | `b0910726`; 48–63 | Mixed | C: S3 “All rules jvm tests pass” needlessly interrupts the fixes. **S5 shipping is explicitly requested in the Original request.** |
| Belot | `91548ef0`; 75–132 | Mixed | C,F,A: separate lifecycle-test and string steps S10b/S11; review added the former. Real two-phone qualification must not be replaced by desktop tests. |
| ce-workflow | `79614d24`; 173–218 | Mixed | C,F: documentation/suite/prompt fragments; substantial experiments and independent features otherwise justify a long plan. |
| ce-workflow | `427dd6a8`; 98–143 | Right-sized | Benchmarking is the task. Separate experiments, harness, results and live-reaction trial are not “check-only waste.” |
| ce-workflow | `45682eea`; 154–173 | Oversplit | C,F: CU-01 fixes the predicate; CU-02 adds its regression as a separate step. Record-reviewed-versions remains a real final state transition. |
| ce-workflow | `4b311224`; 48–64 | Oversplit | C,F: upload, tests, live check, changelog, later fixes, another check and diagram bookkeeping become nine steps for one feature plus corrections. |
| ce-workflow | `54ff64f3`; 119–203 | Mixed | C,F: retro→apply-retro and decide→record fragments; preserve requested pilots and gates. Includes an automatically inserted architecture step. |
| ce-workflow | `cfaad2ca`; 79–98 | Right-sized | Freeze comparison, build/refine, independently inspect, judge and propose integration: evidence is the deliverable. |
| ce-workflow | `d49034f9`; 54–65 | Right-sized | Bound the safeguard, implement it with proof, then demonstrate native integration. |
| ce-workflow | `be05f446`; 45–52 | Oversplit | R,C: reproduce→fix→regressions are three steps for one writer-coordination bug. |
| ce-workflow | `46156860`; 46–61 | Mixed | R,T: reproduction can accompany the fix; final Evaluate can accompany benchmark judgment. **Baseline/candidate benchmarks must remain explicit.** |
| ce-workflow | `714509f1`; 45–58 | Right-sized | Configuration lifecycle investigation, shared policy rollout and native provenance/rollout qualification. |
| SketchUp import loop | `49c8fb6e`; 236–300 | Mixed | F,A: many harness/report/metric fragments. Numerous additions were explicitly accepted ideas; Amendments already fold five “rule steps” into their parent steps. |
| SketchUp | `a18e55f3`; 264–304 | Mixed | F,C,A: rig, sun, meadow and their test split; vegetation tests split again. Review added a useful two-camera regression. |
| SketchUp | `5d68894a`; 83–111 | Right-sized | Mostly one outcome per reported defect plus integrated real-model review. A: review added transport checks and proposed numeric performance acceptance. |
| SketchUp | `7256ce8f`; 50–64 | Right-sized | Inventory/privacy boundary, portable export and verified archive. Extra S4 records the user’s OS-direction change, not original oversplitting. |
| SketchUp | `0cf7d64d`; 315–363 | Mixed | F,U: launcher and model pieces are fragmented, while E-04 editor and E-13 PDF workflow are candidates for more bounded slices. |
| SketchUp | `75b51cc9`; 74–115 | Mixed | U: V-04 is a broad fixes bucket; substantial construction later accumulates inside “Morning report.” The initial commit was explicitly requested. |
| SketchUp | `d4e21dbd`; 84–101 | Oversplit | F,C: R-05 explicitly says its implementation already landed with R-04 and only the test remains. One catalogue is divided by consumers. |
| SketchUp | `02fc8094`; 95–114 | Right-sized | Generic families, kitchen planning, guarded house integration and isolated/live qualification are coherent bounded outcomes. |
| SketchUp | `71636077`; 94–115 | Mixed | F,C: dependency-status and documentation-only pieces; interaction and bake/export boundaries remain real. |
| SketchUp | `f47d2ae4`; 102–144 | Right-sized | Mostly one step per reported visual bug plus shared bake; later F14–F19 are subsequent feedback. A: review added per-behavior regressions. |
| SketchUp | `b825a38e`; 81–110 | Mixed | R,T,U: Diagnose walk→Fix walk and Diagnose looks→Fix looks create tiny phases, while W-02 bundles several independent movement bugs. |
| SketchUp | `353eeac9`; 50–60 | Right-sized | Geometry hypothesis, native candidate, justified shared fix and archived matched-view evidence. |
| SketchUp | `fbbe1188`; 71–105 | Mixed | F: B-01/B-02 are one bedding change in the same commit. Matching experiments and recognition improvements remain separate. |
| SketchUp | `3a006178`; 44–61 | Mixed | R,U: three reports grouped as “all causes→all fixes→all validation.” Only three steps, but the decomposition is still poor. |
| SketchUp | `445f1581`; 37–44 | Right-sized | Bounded visual-asset prototype plus actual browser/walkthrough qualification. |
| SketchUp | `c0985363`; 39–48 | Mixed | F: shared recipe boundary and shorthand/test work overlap across P3-01/P3-02. Native component comparison is a separate qualification outcome. |
| SketchUp | `27a11af3`; 39–47 | Right-sized | Controlled geometry experiment: freeze comparison, run native builds, preserve evidence and verdict. |

### Totals

| Classification | Plans |
|---|---:|
| Right-sized | 22 |
| Mixed | 39 |
| Oversplit | 5 |
| Purely undersplit | 0 |
| **Total** | **66** |

Five mixed plans contain **undersplitting risks**. That matters: fewer steps is not a sufficient success criterion.

| Pattern | Flagged plans |
|---|---:|
| File/component/detail fragmentation F | 31 |
| Detached or fragmented checking C | 24 |
| Reproduction/diagnosis fragments R | 4 |
| Commit/shipping administration S | 2 |
| Potential shared-run scenario fragmentation M | 3 |
| Small standalone judgment phases T | 3 |
| Undersized decomposition / overlarge steps U | 5 |
| Review-added checking confirmed A | At least 7 |

Additional proof findings:

- **Seven plans explicitly document planted-bug/mutation sensitivity:** `1e1efb62`, `b8ad3205`, `de85c778`, `4be7eb9c`, `427dd6a8`, `d49034f9`, `714509f1`.
- **Zero confirmed local examples of a blanket requirement to perform both genuine bug red/green and another mutation for every fix.**
- The supplied Mac reports may establish that behavior there, but they remain **externally reported evidence**, not replicated by this local audit.
- M flags are consolidation candidates, not proof that the recorded checks actually happened in the same session.
- Review-added checks are often useful: missing real callers, state transitions or device behavior. Their origin alone does not justify moving them to Backlog.

## Pattern → shaping rule

| Pattern | Source sentence | Assessment |
|---|---|---|
| Detached implementation/tests | `plan3.ts:578`: “ordered phases with stable step IDs … and their checks”; `:90`: “Each step names its targeted check” | Neither requires test-only steps, but neither explicitly keeps reproduction/fix/proof together. Add that positive instruction. |
| Small implementation fragments | `:55`, PROJECT_CARE: “small prefactor … plan it as its own step before the change” | Direct pressure to create another step even for a tiny preparatory edit. |
| File-area fragmentation | `:55`: “thin end-to-end slices” | “Thin” can be overread, but **end-to-end actually opposes file-area splitting**. Treat this as an insufficient brake, not a demonstrated root cause. |
| Scenario-per-step qualification | `:83`: “work needing a VM, hardware, signing or deployment is its own [blocked] step”; `:88`: “gets its own step ID” | No grouping rule; can become one step per scenario. Keep independent prerequisites and risk boundaries. |
| Tiny think phases | `:79`: “keep judgment work in its own phase instead of mixing it into a build phase” | Direct cause candidate. Every small diagnosis/evaluation can trigger a phase/model switch. |
| Repeated full suites | `:90` and `:590`: full suite at phase boundaries and completion | **Strongest explicit multiplier.** A cosmetic phase boundary changes test cost. |
| Mutation after adequate bug proof | `test-sensitivity.ts:6`: “Genuine failing-before-fix and passing-after-fix evidence … counts; otherwise … one targeted mutation” | Already alternatives. Clarify planning language; do not weaken or replace the safety rule. |
| Review inflates acceptance | `plan3.ts:618`: checks “missing steps or files … unclear acceptance”; no proportionality instruction | Reviewer is asked what is missing, not what is redundant. Optimize rule 9 (`:92`) has a Backlog brake absent here. |
| Small extra architecture phase | `plan3.ts:1357–1366`, particularly `:1365` | **Code appends ARCH-RECONCILE**, observed in `4b311224` and `54ff64f3`. Wording cannot eliminate this step. Report it; changing it exceeds the agreed wording-only correction. |

**Historical caution:** the audit includes October plans, whereas the project-care/vertical-slice adoption is documented in `79614d24` on November 8, and the always-on sensitivity addition in `d49034f9` on November 11. Those newer rules cannot explain the original creation of every older plan.

## Recommendation: exact replacement wording

These are focused text replacements, not a proposal to change parsing, sizing, model routing or lint.

### 1. Make outcome granularity available to every planning entry point

`PLAN_SHAPE`, `plan3.ts:83`

**Before**

> Plan shape: every step line under 200 characters, details in indented sub-bullets;

**After**

> Plan shape: each step delivers a reviewable outcome, including its reproduction, implementation and targeted proof. Usually one step per bug report, plus a shared final check for a batch. Split by independent acceptance, risk or prerequisites, not commands or file areas; keep each implementation step finishable with its checks in one working session. Every step line stays under 200 characters; put detail in indented sub-bullets, not extra steps merely to shorten the line;

Putting this only in `PROJECT_CARE` would miss `writePrompt`, which includes `PLAN_SHAPE` but not `PROJECT_CARE` (`:580`).

### 2. Group qualification without erasing real gates

Same constant, `:83`

**Before**

> work needing a VM, hardware, signing or deployment is its own [blocked] step naming its prerequisite once, and work needing only the user (presence, physical action, approval) is its own [human] step;

**After**

> group qualification scenarios sharing an environment and prerequisites into one step with scenario sub-bullets; keep distinct signing, deployment, approval or recovery boundaries separate. Mark unavailable external prerequisites [blocked], naming them once, and user-only prerequisites [human];

This also aligns with execution’s existing distinction: `[blocked]` means the prerequisite is unavailable, not simply that a VM is involved (`:590`).

### 3. Stop mandatory micro-prefactor steps

`PROJECT_CARE`, `:55`

**Before**

> a short reshaping first turns the change into a one-place edit: plan it as its own step before the change; make the change easy, then make the easy change

**After**

> a short reshaping first turns the change into a one-place edit: keep it inside that outcome unless it needs an independently reviewable checkpoint; make the change easy, then make the easy change

Also replace the final ordering sentence:

**Before**

> Order the steps as thin end-to-end slices that each leave the tree working and fit one working session with its checks (merge steps whose split only adds handoffs; point to the plan's acceptance criteria instead of copying them): a planned prefactor first, and a wide refactor as expand (add the new form beside the old), migrate callers in batches, contract (remove the old).

**After**

> Order steps as outcome-sized end-to-end slices that leave the tree working and fit one working session with their checks. Merge splits that only add handoffs; split work too large to review or finish coherently. Reference acceptance criteria instead of copying them. Do required prefactoring first within its outcome; keep wide refactors staged as expand, migrate callers in batches, contract.

### 4. Preserve model routing without creating a phase for every thought

`THINK_RULE`, `:79`

**Before**

> keep judgment work in its own phase instead of mixing it into a build phase.

**After**

> use a separate [think] phase for a substantial unresolved decision or experiment, not routine diagnosis or a short evaluation within an implementation step.

The preceding definitions of `[think]` and `[code]` remain unchanged.

### 5. Apply the same qualification grouping during Optimize/Convert

`OPTIMIZE_RULES` rule 4, `:88`

Replace its opening through “when it needs only the user”:

**Before**

> Split implementation from external qualification: work needing a VM, hardware, signing, deployment or a human gets its own step ID in a final qualification phase, marked [blocked] with the prerequisite named, or [human] when it needs only the user

**After**

> Keep independently gated external qualification separate from implementation. Group scenarios sharing an environment and prerequisites under one step; separate different approval, signing, deployment or recovery boundaries. Mark unavailable external prerequisites [blocked], naming them once, or [human] when only the user is needed

Keep its existing Requirements syntax, prohibition on waiving qualification, and `VERIFY_RULE`.

### 6. Remove phase-boundary full-suite runs in both locations

`OPTIMIZE_RULES` rule 6, `:90`

**Before**

> Each step names its targeted check; the full suite runs at phase boundaries and before completion.

**After**

> Each implementation step names its targeted checks. Run the full suite on the final relevant state before completion and before an authorized release or push; one run satisfies both when that state is unchanged. Respect explicit project and user test limits; phase boundaries alone do not trigger runs.

`executePrompt`, `:590`

**Before**

> Check cadence: while working on a step, run the smallest existing checks that cover the change (the tests of the changed code); the full suite once at each phase boundary and before completion, not after every increment.

**After**

> Check cadence: while implementing, run the smallest existing checks covering the changed behavior. Run the full suite on the final relevant state before completion and before an authorized release or push; reuse that result when the relevant state is unchanged. Respect explicit project and user test limits. A phase boundary alone does not require another run.

Retain the later instructions to rerun checks affected by fixes and verify the final relevant code/input state.

### 7. Give Optimize a positive merging rule

`OPTIMIZE_RULES` rule 8, `:92`

**Before**

> Keep stable step IDs; record every split/merge as "OLD → NEW" in Amendments. Group connected work into phases; do not merge large steps only to reduce the count.

**After**

> Keep stable step IDs; record every split/merge as "OLD → NEW" in Amendments. Merge command, file-area and reproduce/fix/check fragments of one outcome; split independently reviewable work too large for one working session. Usually keep one step per bug report plus shared final testing. Preserve real decision and qualification gates; never optimize for the count alone.

### 8. Make sensitivity alternatives explicit without expanding the safeguard

`TEST_SENSITIVITY`, `extensions/test-sensitivity.ts:6`

**Before**

> During planning, put this check in the relevant implementation step; do not execute it in research-only work.

**After**

> During planning, keep regression and sensitivity proof inside the implementation step: genuine red/green OR one targeted mutation, not both for the same behavior. Do not execute checks in research-only work.

Leave the rest intact, especially meaningful assertions, safe isolation, barriers for concurrency, final green evidence and unavailable-check reporting.

### 9. Review proportionality as well as omissions

`advisorPrompt` review body, `plan3.ts:618`

**Before**

> The advisor checks feasibility, missing steps or files, wrong commands, contradictions with Decisions and unclear acceptance.

**After**

> The advisor checks feasibility, missing files or behavior, wrong commands, contradictions with Decisions, unclear acceptance, unnecessary step splits and duplicate proof. Require each proposed check or step to address an existing requirement, safety risk or acceptance gap; optional hardening and process additions go to Backlog.

Retain disposition recording and blocking-question handling. Add after “apply accepted corrections”:

> Preserve approved scope; new acceptance requirements need the user's decision.

**Important:** “Backlog unless there is a correctness bug” is too narrow. A missing safety or acceptance test can be necessary before a bug has been demonstrated.

### Standalone check and shipping steps

Do **not** add the draft’s blanket “no check-only steps” rule. The wording above keeps routine proof inside the implementation while allowing:

- final integrated validation;
- signed-build acceptance;
- migration rehearsal;
- controlled experiments and benchmarks;
- explicitly requested deployment;
- a physical/device qualification with different prerequisites.

Likewise, do not create shipping work merely because implementation is complete. But do not remove shipping explicitly requested by the user, as in `b0910726`.

## Good examples worth retaining

These are shortened renderings of the actual plans, not verbatim quotations.

### Configuration rollout — `714509f1`, lines 54–56

1. Establish configuration precedence and idle-server behavior.
2. Implement shared lean defaults through both startup paths, with focused tests.
3. Qualify native loading and configuration provenance without disrupting live sessions.

### Controlled experiment — `27a11af3`, lines 43–45

1. Freeze the source recipe, camera, materials and comparison boundary.
2. Run isolated native builds and inspect saved geometry.
3. Preserve regression evidence and report the verdict and limitations.

Here verification **is the requested product**.

### Data migration — `1b037b9a`, lines 132–148

1. Fix the leak and support the new storage formats.
2. Implement and rehearse the migration, including rollback and idempotency.
3. Make the consuming application compatible.
4. Apply against a verified backup with writers stopped.
5. Delete only verified obsolete data, then restart and validate.

Five steps are warranted by safety boundaries. A smaller number would not be an improvement.

**Prompt-cost recommendation:** keep these in benchmark fixtures or supporting documentation. If an in-prompt example is needed, use only:

> Three bugs: fix A with its regression; fix B with its regression; fix C with its regression; shared final qualification—not reproduce/fix/test phases for each.

The broader prose already needs to protect experiment and migration exceptions; three examples in every prompt would be unnecessary overhead.

## Drift / contradiction check against the current draft

The draft is not yet reconciled with D-03–D-06:

1. **Sizing remains in the implementation scope.**  
   “Relevant files and approach” and S1 still mention tool `create` sizing. Remove those references under D-03.

2. **Lint remains in the implementation scope.**  
   D-01 says “prompts and lint”; Relevant files and S1 still mention a `shapeLint` warning. D-04 supersedes that proposal. Keep the existing 200-character lint unchanged; add no granularity lint.

3. **“A long step … never extra steps” contradicts D-04.**  
   Distinguish a long sentence from substantial work. Sub-bullets fix sentence length; independently reviewable slices fix multi-day work.

4. **“One step per machine run” needs the qualification above.**  
   Do not bundle different signers, credentials, platforms, destructive transitions or approval gates merely because one machine can perform them.

5. **“No standalone check steps” contradicts the user’s shared final-testing step.**  
   It also contradicts legitimate research, benchmark and qualification outcomes.

6. **The goal says “full suite once per plan,” while D-05 refers to completion and release.**  
   Use final-state evidence, allowing one unchanged-state run to satisfy both. Do not force two identical runs.

7. **Testing-policy precedence must remain explicit.**  
   This repository normally requires targeted tests before push unless full testing was requested. Generic Plan3 guidance must not silently override project limits or an explicit no-tests instruction.

8. **The benchmark must judge quality, not just fewer steps.**  
   D-06 is correctly scoped to a small fixture with two repetitions. Acceptance should require complete behavior, preserved qualification and no material overall regression—not just reduced step/test counts.

9. **Freeze the baseline before implementation.**  
   S3 currently says “baseline (master) against candidate,” but development is directly on master. Capture the baseline revision and prompt/configuration before S1; run both arms from isolated pinned states.

10. **The implementation plan itself can be tighter.**  
    S1 and S2 edit the same prompt module and serve one behavioral outcome. Prefer one “revise planning/proof wording with focused regression coverage” step, followed by the distinct end-to-end evaluation step. Separate them only if the main agent identifies a real review or execution boundary—not merely “shape” versus “tests.”

## Risks

- Most flags are candidates for consolidation, not proof of wasted execution time.
- October plan shapes cannot all be attributed to rules introduced in November.
- “One proof” must not erase complementary real-UI, integration, device or migration validation.
- A three-bug benchmark can test bug-batch behavior, but cannot establish that complex migration and research plans remain well-sized. Preserve a few read-only planning examples as quality controls.
- Do not change automatic architecture reconciliation under a wording-only decision; acknowledge that this source of extra steps remains.

## Need from main agent

No additional decision is required to finish the draft. Reconcile its stale scope, incorporate the narrower wording, and preserve explicit project/user testing precedence.

## Suggested execution prompt

**No implementation handoff is warranted while research mode remains active.**

Skipped execution logs, live benchmarks and historical prompt-version reconstruction; no files were edited. The findings establish planning-pattern risks, not measured savings or a verified optimization.