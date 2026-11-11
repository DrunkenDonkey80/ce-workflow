---
plan3: true
status: complete
created: 2026-11-11
updated: 2026-11-11T08:52:21.568Z
started: 2026-11-11T08:37:32.889Z
---

# Project-independent test sensitivity

## Original request

> Add an always-on, project-independent test-sensitivity safeguard to ce-workflow. User explicitly rejects PhotoBook-only work: 'always, we dont care one project, if something can't benefit the whole development cycle drop it'. Require meaningful red/green evidence for nontrivial behavior changes; automate safe focused mutation execution/restoration where practical, reuse existing test commands, no new framework or broad sweep. Preserve old benchmark evidence, unrelated dirty work; no commits/pushes.

## Goal, requirements, and non-goals

Make meaningful test sensitivity part of ordinary development in every project using ce-workflow, not a PhotoBook-specific exercise. A green test alone is insufficient evidence that it protects changed behavior. Require a relevant failing assertion before the fix, or one deliberate plausible regression caught by the same targeted test, followed by a green final run.

Automate mechanical safety and evidence where possible; selecting a meaningful regression still needs the coding agent's judgment. Preserve unrelated dirty work, never mutate a user's shared source tree merely to test sensitivity, and reuse project test commands. No new mutation framework, broad sweeps, live-service tests, PhotoBook changes, commits or pushes. This is a safety change, not a measured workflow optimization.

## Decisions

- D-01 User authorized strengthening the safeguard, then explicitly chose general ce-workflow coverage: “always, we dont care one project, if something can't benefit the whole development cycle drop it”. Drop the proposed PhotoBook-only tests.
- D-02 Existing C6 evidence remains unchanged: five of eight mutations caught, two stale-read mutants and expiry equality survived; broad sweep took 139.15 seconds against the 120-second gate. These findings motivate risk-directed checks, not a global eight-mutation requirement.
- D-03 Existing shared entry point is extensions/plan3.ts: before_agent_start installs locked-write guidance in every coding session, including non-Plan3 sessions. Use that path rather than per-project AGENTS.md edits.
- D-04 Agent approach: one targeted plausible mutant for nontrivial changed behavior, or reuse genuine bug-fix red/green evidence. Documentation-only work needs no fake mutation; explicit no-tests requests and unavailable prerequisites must be disclosed, not bypassed or claimed verified.
- D-05 Investigate a small reusable isolated runner for baseline, mutant and restored runs. It must distinguish an intended assertion failure from infrastructure failure and retain bounded evidence. Do not introduce a universal completion blocker based on guessed shell commands or file extensions.
- D-06 Implementation choice: add test_sensitivity as a tool registered by Plan3's existing globally loaded extension, and inject TEST_SENSITIVITY alongside locked-writes into before_agent_start (sections API plus legacy fallback). No per-project edits, no final-response blocker, and no model-based guessing of whether shell commands ran tests. Meaningful mutant selection/assertion review stays an agent obligation; the code automates a current-working-files Git snapshot, one exact replacement, baseline/mutant/restored commands, bounded logs and status classification. Genuine bug-fix red/green can satisfy the rule without another mutation.
- D-07 Safety: copy tracked and nonignored untracked files, including dirty bytes, into system temp; never patch the original. Optional explicitly named dependency directories are linked and cannot contain tracked source or the mutation target. No Git metadata, branch creation, commits, package installs or live-service commands. Non-Git repos and unsupported snapshots must disclose an unmet check or use their own safe isolated proof. This is source-copy isolation, not an OS sandbox: test commands still have normal machine permissions. Logs/result remain in temp; copied source is removed in finally.
- D-08 Outcome: caught requires exit0 baseline, exit1 mutant with declared assertion marker absent from baseline and no recognized infrastructure error/killed/truncated result, then exit0 restored. Unexpected failures stay inconclusive; a green mutant survives. Validate exact source replacement and preserve captured source hashes. No claim of a complete language-independent assertion parser or guaranteed test quality.


## Open questions

### Blocking

None.

### Deferred

- Plan3's existing concurrent headless size/title test failed twice at the pre-rename Tapir path, then passed unchanged. Read-only oracle identified a stale plan.file fallback after the per-plan queue; the baseline HEAD archive also passed on its one completed run. Timing dependence is observed; baseline failure was not reproduced. Leave that separate race out of this safeguard change and do not describe the suite as consistently green.
- Active LSP reported no errors, but repeated clean-file probes can be unconfirmed because this server is push-only. Do not treat silence as proof of a fully clean static analysis.

## Relevant files and approach

- C:/SOFT/git/ce-workflow/extensions/plan3.ts: shared system-prompt hook and tool registration.
- C:/SOFT/git/ce-workflow/scripts/test-work-plan3.mjs: existing hook regression tests.
- A focused extension helper and matching self-check if the isolation runner is justified; use .ts for extension-imported code.
- C:/SOFT/git/ce-workflow/README.md and CHANGELOG.md: describe actual guarantees and limitations without promising universal bug detection.
- Pi extension documentation and examples must be read before implementing hooks/tools. No external research or delegation is needed unless diagnosis becomes stuck.

Safety examples: a changed branch has a passing focused test; an inverted branch must trigger its intended assertion; syntax errors, timeouts and missing dependencies are not successful sensitivity proofs. Scratch mutations must never reach the developer's working files. Tests should control concurrent interleavings rather than sleep.

## Phases

### Phase 1: Bound the shared safeguard [think]

- [x] **S-01** Shared every-session hook and isolated one-mutant tool chosen; no PhotoBook work, broad sweep or blanket completion gate.

### Phase 2: Implement and prove sensitivity [code]

  - note: Initial helper extensions/test-sensitivity.ts and Plan3 registration/system-section wiring written. No tests run yet; self-check, hook assertions, source-safety review and docs remain.
- [x] **S-02** Added always-on shared guidance, disposable-snapshot mutation tool, 18-case self-check and ordinary-session hook coverage.
- [x] **S-03** Documented guarantees and limits; native Pi execution caught a real checker mutation with 0/1/0 evidence; scoped checks completed with caveats.

## Global validation

- Existing command: node scripts/test-work-plan3.mjs.
- Read package.json before choosing any further existing check. New nontrivial runner code needs its own focused assert-based self-check.
- The resulting system guidance reaches ordinary coding and Plan3 sessions, remains after compaction, and does not require PhotoBook-specific paths or dependencies.
- A demonstrated kill requires green baseline, a matching intended failing assertion under mutation, and green restored run; inability to prove those stays explicit.
- No project production code is changed to accommodate a test; no unrelated dirty files are staged or reverted.
### Results

- Both targeted scripts passed on their latest runs: test-work-test-sensitivity.mjs (18 isolated runs) and test-work-plan3.mjs (including new always-on tool and prompt API assertions). Two earlier Plan3 runs failed the unchanged headless size/title rename case; one unmodified HEAD archive run passed. No race fix or reproduced baseline failure is claimed.
- Native Pi execCommand demonstration mutated the helper's `mutant.code === 1` to `mutant.code === 2`: baseline 0 (2984 ms), intended AssertionError 1 (380 ms), restored 0 (3181 ms). Evidence: C:/Users/Flex/AppData/Local/Temp/pi-test-sensitivity-GmdSNw/result.json and phase logs. Helper source hash cfaa018243ea6a74c3f9087c091331958699c5ee4e2240dd7a73e29429e34a49. This proves sensitivity to one real changed-code regression, not universal bug detection or speedup.
- Active LSP batch on all four source/test files: no reported errors; three repeated push-only probes unconfirmed. Intentional path string-sort and test JSON parse exceptions marked false-positive. Scoped git diff --check passed.
- README and Unreleased changelog explain guidance vs hard enforcement, safe-use limits, evidence retention and /reload. No full suite, performance benchmark, PhotoBook changes, package/dependency changes, commits or pushes.


## Resume context

Implementation complete on master; no commits/pushes. Shared test_sensitivity helper and ordinary/Plan3 guidance activate on Pi /reload. Both targeted scripts latest passed; native executor captured genuine 0/1/0 mutation proof with logs in system temp (Global validation). Intermittent Plan3 headless size/title rename failure was diagnosed read-only and left out of scope; HEAD baseline passed once, no reproduced baseline failure claim. LSP no reported errors but 3 push-only rechecks unconfirmed. Preserve other sessions' dirty files. No further safeguard work pending.

## Amendments

Append material changes and their reasons; preserve the original request and settled decisions.
