# Rework recipe: characterize, redesign, replay, switch

Status: draft for the DealFinder pilot (plan 54ff64f3, RW-01). It changes after each pilot retro.

This is a way to rework one part of a messy project safely. The current code gets tests first, and their results are recorded. Then a new design is chosen together with the human. The new code is built next to the old, the same tests are replayed against both, and the human approves the switch. Most of the effort goes into Map and Design: think hard before coding.

The aim is not a smaller file or a safer split. The aim is a **deeper module** (§0): callers need to know less, change concentrates in one place, and the next realistic changes touch fewer files. A rework that only moves code between files has failed, even when every test passes.

Out of scope: a workflow engine, one test protocol for every language, automatic deployment, snapshots of everything, and rewriting the whole project by default. Each project uses its own test runner (pytest, vitest, Gradle), with case IDs shared between the old and new runs.

## 0. Design vocabulary and tests

Adapted from Matt Pocock's `codebase-design` and `improve-codebase-architecture` skills (github.com/mattpocock/skills). Use these words exactly in Map, Design and the scorecard. Do not swap in "component", "service", "API" or "boundary".

- **Module**: anything with an interface and an implementation (a function, class, package, or slice across tiers).
- **Interface**: everything a caller must know to use the module correctly. That includes the type signature, plus invariants, ordering rules, error modes, required configuration, and unwritten rules such as "always re-read before writing".
- **Deep module**: a lot of behavior behind a small interface. **Shallow module**: the interface is nearly as complex as the implementation (pass-throughs, one-line helpers, a facade that forwards every method).
- **Seam**: the place where a module's interface lives, where behavior can change without editing callers. **Adapter**: a concrete thing that fills a seam.
- **Leverage**: what callers gain (one implementation pays back across N call sites and M tests). **Locality**: what maintainers gain (change, bugs and verification concentrate in one place).

Tests to apply:

- **Deletion test**: imagine deleting the module. If the complexity vanishes, it was a pass-through. If the complexity reappears across N callers, it was earning its keep. A candidate is good when deepening it **concentrates** complexity; it is bad when it just **moves** complexity (a file split that keeps the same interface usually only moves it).
- **The interface is the test surface**: callers and tests cross the same seam. Tests that must reach past the interface mean the module has the wrong shape.
- **One adapter is a hypothetical seam; two adapters make a real one.** Do not add a port unless something actually varies across it (production plus test counts).
- **Dependency category** of a candidate decides how it is tested:
  - in-process: merge and test directly;
  - local-substitutable: test with the local stand-in, such as a temp dir or an in-memory database;
  - remote but owned: a port with production and in-memory adapters;
  - true external: an injected port, with a mock adapter in tests.
- **Replace, don't layer**: once tests exist at the deepened interface, delete the old unit tests of the shallow modules it absorbed. This is about tests of the old shallow internals; it never touches the corpus, which is frozen (§2).

What to avoid:

- **Callers may change.** Do not default to "keep the public interface, callers untouched, smallest switch". That default produces file splits that fail the deletion test. Changing 60 call sites mechanically is acceptable when the interface shrinks and a rule moves into the module. The corpus (§2) protects behavior, not the old interface.
- **YAGNI still holds.** Deepen only where change keeps happening (churn) or where the next named changes land. A deep redesign of a module nobody touches is waste.

## 1. The loop

One loop per rework target (a module or a group of modules, never "the whole project" by default).

1. **Map** [think]. Explore before picking.
   1. **Scope by churn.** Find the hot spots: `git log --format= --name-only -n 150 | sort | uniq -c | sort -rn | head -30`, plus which files change together. Recent churn gets more weight. If churn is scattered, widen the net.
   2. **Read the code.** Read the project's AGENTS.md, any GLOSSARY.md, and any ADRs (`docs/adr/`); do not re-argue an ADR unless the friction is real. Then walk the hot code in the open, without a checklist, and note friction:
      - Where does one concept require bouncing between many small modules?
      - Where are modules shallow?
      - Where does every caller have to follow an unwritten rule (a lock, an ordering, a re-read)? Count the callers that break it.
      - Where do tightly coupled modules leak across their seams?
      - What is untested, or hard to test through its current interface?
   3. **Map the hot area as it is**, with every claim tied to files and lines: responsibilities, dependency direction, state ownership, runtime flows, duplicate clusters.
   4. **List 3–6 deepening candidates.** Each candidate gives:
      - files;
      - the problem in one sentence;
      - the solution in one sentence;
      - the deletion-test result;
      - its dependency category;
      - the interface as callers see it before and after (entry points and rules), and how many call sites change;
      - tests at the new interface, and which tests become waste;
      - a strength: Strong, Worth exploring, or Speculative.
   5. **Future-changes check.** Name 3 realistic upcoming changes from recent commits, plans, backlogs and docs. For each one, count the files and edit sites it touches today versus after each Strong candidate. Write each as one bounded scenario (the exact change, e.g. "add a Code39 symbology to the CLI and GUI") and keep the same three scenarios fixed through Design and Replay. Pass rule: at least one improves, and none gets worse.
   6. **Pick the rework target**: the candidate with the best leverage and locality on hot code. A bug the friction hides (such as lost updates) raises its priority; record it as unresolved for the human (§2).

   A proposed module map may go in the plan diagram (`plan3_diagram`).
2. **Characterize** [code]. Write tests at the boundaries: CLI, HTTP, public API, intent contracts. Never test private classes. **Pin behavior above the target's interface**, at a boundary that survives the redesign: usually HTTP routes, CLI commands or the callers' observable effects. Do not pin the interface Design may replace. Cases that go through the old module interface would block the very change the rework is for. When the target's own interface is the only practical boundary, keep those cases few and mark them `interface-bound`; Design may retire them with human approval, and they must be covered from above first. Record the results as a behavior corpus (section 2) and record baseline numbers for the scorecard (section 4). Commit the corpus, its fixtures and the baseline records. That commit's SHA is the **corpus SHA**.
3. **Design** [think]. **Design It Twice.** First write the constraints that any new interface must meet, and the dependency category. Then get 3 interfaces that really differ, each from a fresh sub-agent working in parallel. Use the `subagent` tool; this recipe authorizes the delegation. Give each sub-agent the same technical brief (files, coupling, dependency category, §0 vocabulary, project domain terms), and one of these constraints:
   - minimal interface: 1–3 entry points, maximum leverage per entry point;
   - the most common caller is trivial;
   - ports and adapters for the dependencies that cross the seam.

   Each sub-agent returns: the interface (types, invariants, ordering, error modes), a caller usage example, what hides behind the seam, its adapters, and its trade-offs.

   Compare the designs by depth, locality and seam placement, then take an opinionated pick or a hybrid. The options presented at Pick are this pick, the strongest alternative, and "local repair, no rewrite". Each option gives:
   - its module map and interface contracts;
   - interface size before and after (entry points plus the rules callers must know) and the call sites that change;
   - the future-changes counts from Map;
   - any library or platform changes: what they remove and what migration costs;
   - expected benefit, risk and reversibility;
   - whether stored state or file formats change (section 5).

   Run one small experiment on the riskiest assumption, and record the result in the plan. End with one recommendation judged against the request's goal (what should get easier, safer or faster; ask for it at planning when the request has none). Recommend local repair or stop only when it meets that goal better than the structural options, and mark the recommended option "(Recommended)" in the Pick question.
4. **Pick** (human step). The human picks one of two outcomes:
   - **an option to build**, including "local repair": the human turns on `R-design-approved`. The gate counts only after the pick is recorded in Decisions; if it was turned on earlier, Build still waits for that record.
   - **stop**, meaning no change is built: `R-design-approved` stays off. Mark Build, Replay, Switch and Retire done with the summary "not run: stopped at Pick". Commit the Map, corpus and Design as the outcome.
5. **Build** [code]. The new part sits next to the old one behind one seam (section 3). Tests can select either side. Only one side does real writes (R6).
6. **Replay** [think]. Run the same corpus against old and new, then fill in the scorecard that was fixed before Build started.
7. **Switch** (human step). The human reads the scorecard and the rollback rules, then turns on `R-cutover-approved` and sets a watch window. Switching means flipping the one selection at the seam.
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

A bug that is found is not preserved automatically: it becomes unresolved until the human classifies it. Agents never edit expected observations themselves.

The baseline expectations committed at the corpus SHA never change. An intentional change is written as a separate **approved delta**: one file (for example `tests/rework/approved-delta.*`) keyed by case ID, giving the new expectation and the approval reference. During replay:

- **old side**: every case must match its baseline expectation.
- **new side**: preserve cases must match the baseline, and intentional-change cases must match their approved delta. Matching the baseline instead of the delta is a failure, because the change did not happen.
- **unresolved cases**: these block Switch.

After the corpus SHA, `git diff <corpus sha> -- <corpus paths>` may show only the approved-delta file. Any other change to the corpus needs human approval.

Before any old-versus-new result counts, the corpus must pass two checks:

1. **Stable**: run it twice against the old code (on the corpus SHA). The pass lists must be identical. Fix or quarantine flaky cases, and record each quarantine with its reason.
2. **Sensitive**: plant one deliberate bug in the target module, on a scratch change that is never committed. At least one case must fail. Record which case failed, then revert the bug.

### 2a. Comparison rules and normalization limits

- Only these may be normalized: timestamps, generated IDs, absolute temp paths, ordering of sets that the contract does not order, and floats within a stated tolerance.
- Name each normalized field in the case. Never normalize a whole output.
- Errors compare by type or code plus the key message fields, not by stack traces.
- Performance is never asserted inside corpus cases; it belongs to the scorecard.

## 3. Seam, SHAs and replay worktree (D-03, R6)

Seam: the new part sits next to the old one behind one entry point (branch-by-abstraction), on the project's current branch. The selection is one config value, an environment variable or a single call site. Tests can choose either side. A test-only selection (a test-runner or bundler alias) proves replay but not runtime rollback: the rollback rules then say that switching back is a `git revert`. Use a long-lived rewrite worktree only when Design shows that no seam exists and the human approves it.

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

Fix the scorecard in the plan before Build starts (it is part of what Pick approves). Choose the performance metric and workload in Characterize, before CHR-03 records the baseline; Design may tighten the threshold but never picks the metric after the baseline. If the baseline spread is close to the median, the metric cannot show a difference: narrow the workload (e.g. warm cache, fewer process spawns) and re-baseline before Design. Score three dimensions separately. There is no weighted total.

| Dimension | Metric | Workload | Baseline (old) | Candidate (new) | Threshold | Repetitions | Result |
|---|---|---|---|---|---|---|---|
| Maintainability | interface size (entry points plus rules callers must know); call sites that must follow an unwritten rule; files and edit sites per Map future change; deletion test (concentrates / moves). Line counts are not the measure | the Map candidates and future changes | | | | 1 | |
| Performance | e.g. wall time of `<command>` on fixture X; peak memory | named fixture | | | | ≥5, report median and spread | |
| Stability | corpus pass list; flaky count over N runs; error-path cases passing | full corpus | | | | ≥3 | |

Rules:

- An improvement claim names the metric, workload, baseline, threshold and repetitions.
- A material regression in one dimension is never offset by gains in another; report it, and it needs the human at Switch.
- "Inconclusive" (spread larger than the difference) is a valid result.
- Performance thresholds are relative: old and new runs interleaved in pairs on the same machine, not an absolute number from an earlier session. Machine load changes absolute timings (photobook-02: the unchanged old code itself missed its absolute threshold at Replay).

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

The human turns each one on with Alt+A. Agents never remove, edit or bypass a `needs:` line, and never propose chat approval in place of Alt+A: when the next phase waits on a gate, stop and name the gate. Until the human does, a gate is off by day and in night mode, so unattended runs cannot pass it. Once a gate is approved it stays on at night too: night mode does not take back an approval.

Code-only and device projects (R7): device checks are separate `[blocked]` steps with the device as a prerequisite. Unit-level characterization runs without them. When the target has several real callers (a CLI and a GUI), the device smoke goes through each of them.

## 7. Plan skeleton

Planning writes this plan only; Map and every later phase run after `/plan3 finish`, so each phase runs on its tagged model. The pilot session fills in this skeleton in its target repo's plan (Plan3 syntax). Replace `<...>` placeholders and step texts with the target's real files and commands. Phase headings take only the `[think]` or `[code]` tag; `[human]` is a step marker, never a phase tag.

```markdown
## Requirements

- **R-design-approved** The human picked a Design option (gates Build and Replay).
- **R-cutover-approved** The human approved the switch after Replay (gates Switch).
- **R-retire-approved** The watch window passed with evidence recorded (gates Retire).

## Phases

### Phase 1: Map [think]

- [ ] **MAP-01** Churn hot spots, open exploration, as-is map of the hot area tied to files.
- [ ] **MAP-02** 3–6 deepening candidates (deletion test, interface before/after, dependency category, strength), future-changes check, rework target picked.

### Phase 2: Characterize [code]

- [ ] **CHR-01** Boundary corpus cases above the target's interface, with IDs, setup, actions, expectations and comparison rules; classify each behavior.
- [ ] **CHR-02** Stability (two old runs, identical pass lists) and sensitivity (planted bug fails a case, reverted).
- [ ] **CHR-03** Baseline scorecard numbers; commit the corpus, record the corpus SHA.

### Phase 3: Design [think]

- [ ] **DES-01** Design It Twice: constraints, 3 parallel sub-agent interfaces, comparison and pick; options at Pick are the pick, the strongest alternative and "local repair, no rewrite", each with module map, interface size, call sites, future-change counts, risk, reversibility, stored-state change.
- [ ] **DES-02** Thin experiment on the riskiest assumption; fix the scorecard thresholds.

### Phase 4: Pick [think]

- [human] **PICK-01** Human picks an option (including local repair) and turns on R-design-approved, or picks stop: gates stay off and Build to Retire are marked "not run: stopped at Pick". Recorded in Decisions.

### Phase 5: Build [code]

needs: R-design-approved

- [ ] **BLD-01** Seam with old and new selectable; new part built; old side green against the baseline, new side green against the baseline plus the approved delta.

### Phase 6: Replay [think]

needs: R-design-approved

- [ ] **RPL-01** Replay the corpus on the corpus-SHA worktree and on the main checkout; fill in the scorecard; write down the rollback rules.

### Phase 7: Switch [think]

needs: R-cutover-approved

- [human] **SW-01** Flip the seam; human sets the watch window.

### Phase 8: Retire [code]

needs: R-retire-approved

- [ ] **RET-01** Delete old code and the seam if no longer needed; remove the replay worktree; corpus green.
- [ ] **RET-02** Only when the repo tracks built artifacts (installers, executables, firmware images): rebuild them from the final source with the project's own build command and commit them, so the shipped files match the reworked code. Skip with the note "no tracked artifacts" otherwise.
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
