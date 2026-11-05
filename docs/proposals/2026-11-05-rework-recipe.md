# Rework recipe: characterize, redesign, replay, switch

Status: draft for the DealFinder pilot (plan 54ff64f3, RW-01). It changes after each pilot retro.

This is a way to rework one part of a messy project safely. The current code gets tests first, and their results are recorded. Then a new design is chosen together with the human. The new code is built next to the old, the same tests are replayed against both, and the human approves the switch. Most of the effort goes into Map and Design: think hard before coding.

Out of scope: a workflow engine, one test protocol for every language, automatic deployment, snapshots of everything, and rewriting the whole project by default. Each project uses its own test runner (pytest, vitest, Gradle), with case IDs shared between the old and new runs.

## 1. The loop

One loop per rework target (a module or a group of modules, never "the whole project" by default).

1. **Map** [think]. Map the code as it is, with every claim tied to files and lines:
   - what each module is responsible for;
   - which way the dependencies point;
   - who owns which state;
   - how things flow at runtime.

   Also list clusters of duplicate code, the files that change most (`git log --format= --name-only | sort | uniq -c | sort -rn | head -30`), and 2–3 concrete changes that hurt today (for example "adding a source means editing 5 modules"). A proposed module map may go in the plan diagram (`plan3_diagram`).
2. **Characterize** [code]. Write tests at the boundaries: CLI, HTTP, public API, intent contracts. Never test private classes. Record the results as a behavior corpus (section 2) and record baseline numbers for the scorecard (section 4). Commit the corpus, its fixtures and the baseline records. That commit's SHA is the **corpus SHA**.
3. **Design** [think]. Write 2–3 options that really differ, always including "local repair, no rewrite". Each option gives:
   - its module map and interface contracts;
   - any library or platform changes: what they remove and what migration costs;
   - expected benefit, risk and reversibility;
   - whether stored state or file formats change (section 5).

   Run one small experiment on the riskiest assumption, and record the result in the plan.
4. **Pick** [human]. The human picks an option, or "no rewrite", and turns on `R-design-approved`.
5. **Build** [code]. The new part sits next to the old one behind one seam (section 3). Tests can select either side. Only one side does real writes (R6).
6. **Replay** [think]. Run the same corpus against old and new, then fill in the scorecard that was fixed before Build started.
7. **Switch** [human]. The human reads the scorecard and the rollback rules, then turns on `R-cutover-approved` and sets a watch window. Switching means flipping the one selection at the seam.
8. **Retire** [code]. After the watch window passes with its evidence recorded, the human turns on `R-retire-approved`. Then delete the old code and remove the seam if it is no longer needed.

"Inconclusive" and "do not rewrite" are valid outcomes at Design, Replay and Switch.

## 2. Corpus case format and classification (R1, R2, R3)

Write one case per observable behavior at a boundary, in the project's own test runner. Each case ID is stable (for example `DF-SYNC-003`) and appears in the test name, so results line up across the old and new runs.

Every case states:

- **Input**: arguments, request body, or intent extras.
- **Setup state**: fixtures, seeded database or files, environment; always disposable and isolated.
- **Action sequence**: the calls or commands, in order.
- **Expected observations**: output, exit code, response, written state, emitted events.
- **Comparison rule**: exact match, or which named fields are normalized (section 2a).

Every observed behavior gets one of three classes, recorded next to the case:

- **preserve**: the new code must match it.
- **intentional change**: the human approved a different result; record the approval (date, quote) in the plan's Decisions.
- **unresolved**: not yet decided; it blocks Switch.

A bug that is found is not preserved automatically: it becomes unresolved until the human classifies it. Agents never edit expected observations themselves. After the corpus SHA, any change to the corpus shows up in `git diff <corpus sha> -- <corpus paths>` and needs human approval.

Before any old-versus-new result counts, the corpus must pass two checks:

1. **Stable**: run it twice against the old code (on the corpus SHA). The pass lists must be identical. Fix or quarantine flaky cases, and record each quarantine with its reason.
2. **Sensitive**: plant one deliberate bug in the target module, on a scratch change that is never committed. At least one case must fail. Record which case failed, then revert the bug.

### 2a. Comparison rules and normalization limits

- Only these may be normalized: timestamps, generated IDs, absolute temp paths, ordering of sets that the contract does not order, and floats within a stated tolerance.
- Name each normalized field in the case. Never normalize a whole output.
- Errors compare by type or code plus the key message fields, not by stack traces.
- Performance is never asserted inside corpus cases; it belongs to the scorecard.

## 3. Seam, SHAs and replay worktree (D-03, R6)

Seam: the new part sits next to the old one behind one entry point (branch-by-abstraction), on the project's current branch. The selection is one config value, an environment variable or a single call site. Tests can choose either side. Use a long-lived rewrite worktree only when Design shows that no seam exists and the human approves it.

Record two SHAs in the pilot plan:

- **pre-rework SHA**: before `/plan3` runs, the session checks `git status`. If there are uncommitted changes, it makes a local commit of the current state; if the tree is clean, it records HEAD. This SHA is the rollback point. The commit never stages credentials or junk files (such as stray `nul` files), never pushes, and follows the target's AGENTS.md commit rules where they are stricter.
- **corpus SHA**: the commit that ends Characterize, containing the old code plus the committed corpus, fixtures and baseline records. This is the replay baseline, so the same tests run on both sides.

Replay procedure:

```bash
git worktree add --detach "<temp dir>" <corpus sha>
# install dependencies in <temp dir> as the project's README says
# run the corpus in <temp dir> (old) and in the main checkout (new),
# each with its own output dir, port and data dir
git worktree remove "<temp dir>"   # after Retire
```

For every run, record which checkout, SHA and implementation it used, so the replay provably tested the intended side. The worktree does not isolate databases, ports or devices; do that yourself. Any side-by-side run uses disposable state, and only one implementation ever writes real data.

## 4. Scorecard template (R4)

Fix the scorecard in the plan before Build starts (it is part of what Pick approves). Score three dimensions separately. There is no weighted total.

| Dimension | Metric | Workload | Baseline (old) | Candidate (new) | Threshold | Repetitions | Result |
|---|---|---|---|---|---|---|---|
| Maintainability | e.g. files touched by change scenario 1; duplicate lines; module dependency count | the Map scenarios | | | | 1 | |
| Performance | e.g. wall time of `<command>` on fixture X; peak memory | named fixture | | | | ≥5, report median and spread | |
| Stability | corpus pass list; flaky count over N runs; error-path cases passing | full corpus | | | | ≥3 | |

Rules:

- An improvement claim names the metric, workload, baseline, threshold and repetitions.
- A material regression in one dimension is never offset by gains in another; report it, and it needs the human at Switch.
- "Inconclusive" (spread larger than the difference) is a valid result.

## 5. Cutover and rollback

- Each design option states whether stored state or file formats change.
- Before Switch, the pilot plan records:
  - rollback triggers (what observation means "switch back");
  - how the old code handles state the new code wrote;
  - when formats change, a restore or migration rehearsed on disposable state, with its result.
- Switch flips the seam selection. Rolling back flips it again, plus a restore when formats changed.
- Retire runs only after the watch window the human set at Switch has passed, with evidence recorded (what ran, what was observed).

## 6. Gate requirements (R5)

Plan3 runs pending steps past an unanswered `[human]` step. It skips only steps whose `needs:` requirement is off. A requirement that is not defined in `## Requirements` counts as never on, and the user cannot turn it on (`workState` and `requirementDefs` in `extensions/plan3.ts`). So every gated phase carries a `needs:` line under its heading, and the plan defines each requirement:

- `R-design-approved`: the human picked a Design option; gates Build and Replay.
- `R-cutover-approved`: the human approved the switch after Replay; gates Switch.
- `R-retire-approved`: the watch window passed with its evidence; gates Retire.

The human turns each one on with Alt+A. In night mode they stay off.

Code-only and device projects (R7): device checks are separate `[blocked]` steps with the device as a prerequisite. Unit-level characterization runs without them.

## 7. Plan skeleton

The pilot session fills in this skeleton in its target repo's plan (Plan3 syntax). Replace `<...>` placeholders and step texts with the target's real files and commands.

```markdown
## Requirements

- **R-design-approved** The human picked a Design option (gates Build and Replay).
- **R-cutover-approved** The human approved the switch after Replay (gates Switch).
- **R-retire-approved** The watch window passed with evidence recorded (gates Retire).

## Phases

### Phase 1: Map [think]

- [ ] **MAP-01** As-is module map of <target> tied to files: responsibilities, dependency direction, state ownership, runtime flows.
- [ ] **MAP-02** Duplicate clusters, churn hotspots, and 2–3 change scenarios that hurt today.

### Phase 2: Characterize [code]

- [ ] **CHR-01** Boundary corpus cases with IDs, setup, actions, expectations and comparison rules; classify each behavior.
- [ ] **CHR-02** Stability (two old runs, identical pass lists) and sensitivity (planted bug fails a case, reverted).
- [ ] **CHR-03** Baseline scorecard numbers; commit the corpus, record the corpus SHA.

### Phase 3: Design [think]

- [ ] **DES-01** 2–3 options including "local repair, no rewrite": module map, contracts, libraries, benefit, risk, reversibility, stored-state change.
- [ ] **DES-02** Thin experiment on the riskiest assumption; fix the scorecard thresholds.

### Phase 4: Pick [human]

- [human] **PICK-01** Human picks an option or "no rewrite", records it in Decisions, and turns on R-design-approved.

### Phase 5: Build [code]

needs: R-design-approved

- [ ] **BLD-01** Seam with old and new selectable; new part built; corpus green on both sides.

### Phase 6: Replay [think]

needs: R-design-approved

- [ ] **RPL-01** Replay the corpus on the corpus-SHA worktree and on the main checkout; fill in the scorecard; write down the rollback rules.

### Phase 7: Switch [human]

needs: R-cutover-approved

- [human] **SW-01** Flip the seam; human sets the watch window.

### Phase 8: Retire [code]

needs: R-retire-approved

- [ ] **RET-01** Delete old code and the seam if no longer needed; remove the replay worktree; corpus green.
```

The plan also records the pre-rework SHA in Resume context before MAP-01 starts.

## 8. Retro questions (after each pilot)

1. Which recipe sections were used, which skipped, and which were missing?
2. Did any gated step run early, or did a gate feel heavy?
3. Was the corpus stable on its first try? Which cases were flaky, and why?
4. Did the planted bug get caught by the case you expected?
5. How much glue code did comparing old and new need? Would a shared comparator helper have helped?
6. Did the scorecard give a clear decision, or was it inconclusive? Which metric was noise?
7. Which questions went to the human, and which could the recipe have answered itself?
8. Was the chosen option the one Map and Design predicted? What would have changed the pick?
9. What should the codified `/plan3 rework` generate that you had to write by hand?

## Requirements coverage

- R1 baseline before change: §1 steps 2 and 5; §7 CHR-03 before the gated Build.
- R2 boundary corpus, stable and sensitive: §2.
- R3 preserve / intentional / unresolved, oracle owned by the human: §2.
- R4 scorecard with three dimensions: §4.
- R5 design and switch gates: §6, §7.
- R6 one writer, disposable side-by-side state: §1 step 5, §3.
- R7 code-only and device projects: §6.
