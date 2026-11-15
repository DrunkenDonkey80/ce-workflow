---
plan3: true
status: complete
created: 2026-11-15
updated: 2026-11-15T08:41:59.252Z
started: 2026-11-15T08:37:18.213Z
---

# Preserve append-only tools through the final Pi request

## Original request

User: “lets fix this properly”, following the investigation of two large cache misses after activating lens_diagnostic_mark.

## Goal, requirements, and non-goals

Remove the confirmed unnecessary forced-prompt override in CE. Preserve research instructions, research exit authority, camera synchronization and internal-wakeup state. Regression coverage must reach Pi's native final prompt projection, not just CE's context handler. Keep unrelated dirty work. No commit, push, restarts or changes to installed Pi. The second consecutive historical miss is not explained by this bug and is not silently claimed fixed.

## Decisions

- The existing before_agent_start callback returns a whole systemPrompt even with research off. Pi treats every defined return as forced, then collapses chronological tool declarations after context_with_system. This defeats CE's existing preservation logic.
- Use structured research sections on current Pi; no prompt override with research off. Retain the existing legacy fallback for hosts without structured sections.
- Reuse existing compaction, research and native-package test harnesses. Preserve user-controlled research and Plan3-controlled exit instructions.
- A benchmark improvement is not established by prefix assertions. Compare all requests and continuation sessions, runtime, tokens, cost, turns and tool calls using the existing benchmark and comparison scripts.
- The previous accepted benchmark is .pi/context-cache-benchmark/2026-11-02T07-17-05.983Z-after/results.json. Its old host is no longer installed; also capture a fresh pre-fix baseline with the current host to separate the patch from host changes.

## Open questions

### Blocking

None: the user authorized the diagnosed fix.

### Deferred

The second historical cache miss remains unproven; no separate changes are authorized by a speculative cause.

## Relevant files and approach

- extensions/work-models.ts: before_agent_start research hook.
- scripts/test-work-compaction-notifications.mjs: normal, research and research-exit behavior.
- scripts/test-work-native-smoke.mjs: actual native runner and final request projection from the packed extension.
- scripts/benchmark-context-cache-live.mjs: replace stale hard-coded Pi 1.4 discovery with installed-release discovery, then use unchanged task prompts for both runs.
- CHANGELOG.md: describe the corrected behavior without claiming measured savings prematurely.
- Diagnostic evidence: C:/Users/Flex/AppData/Local/Temp/ce-cache-miss-findings.md and ce-cache-forced-prompt-probe.mjs. Original and counterfactual replay ran successfully before this plan.

## Phases

### Phase 1: Reproduce and baseline [code]

- [x] **S1** Regression tests fail on the original ordinary-startup override and native final tool-prefix rewrite.
- [x] **S2** Updated installed-host discovery; captured two complete pre-fix benchmark repetitions on Pi 1.5.2.

### Phase 2: Fix and validate [code]

- [x] **S3** Ordinary startup leaves the prompt alone; current Pi gets structured research instructions, with legacy fallback and startup state preserved.
- [x] **S4** Two complete candidate repetitions retain cache at tool activation; paired totals show no material patch-induced regression.

### Phase 3: Evaluate [think]

- [x] **S5** Reviewed minimal production fix, regression coverage and paired benchmark; retained without material patch-induced regression, preserving unrelated changes.

## Global validation

- `node scripts/test-work-compaction-notifications.mjs`: research behavior and cache-context coverage.
- `node scripts/test-work-native-smoke.mjs`: packed-extension real native projection.
- `node scripts/test-work-wo-control.mjs`: startup utility behavior.
- `node scripts/benchmark-context-cache-live.mjs --label <baseline|candidate> --repetitions 2 --output <artifact-directory>`: unchanged three-prompt scenario, ultrafull.
- `node scripts/compare-benchmark-runs.mjs <baseline-results> <candidate-results>`: complete paired runs only.
- Active LSP diagnostics for changed code and `git diff --check`.
Benchmark artifacts: C:/SOFT/git/ce-workflow/.pi/context-cache-benchmark/46156860-baseline/results.json and C:/SOFT/git/ce-workflow/.pi/context-cache-benchmark/46156860-candidate/results.json. Existing three-prompt scenario, ultrafull, Pi 1.5.2, anthropic/claude-opus-5-5; all session JSONL usage aggregated. Both repetitions completed; middle system messages and tool activation preserved. Totals: 39124 → 39285 ms (+0.4%); 322374 → 322621 tokens (+0.1%); $0.3648604 → $0.2027124 (-44.4%); 22 turns and 18 tool calls unchanged. At tool activation (turn 5), baseline cache reads were 0/5173 tokens, candidate 14293/14300 (the preceding prefix). Candidate initial requests also shared 5091 cached tokens, so the entire cost difference is not attributable solely to the fix. Two repetitions do not establish precise latency improvement.

Previous accepted baseline comparison: runtime -25.8%, tokens +12.3%, cost -45.0%, turns +10%, tool calls unchanged. Its old host is unavailable. Current PRE-fix baseline already has 11 turns/~161k tokens per run versus historical 10 turns/~143.6k; the fresh baseline separates the patch from intervening changes. No material patch-induced overall regression observed, no broad workflow savings claimed.

Native final-projection regression: red on original hook, green after fix. Live benchmark covers Anthropic, not Codex; historical Codex causation and the second miss remain unproven. Research behavior/exit authority covered by targeted tests, not live research benchmark. LSP: no diagnostics, one confirmed clean, three inconclusive. Installed Pi and running sessions unchanged.


## Resume context

Implementation complete and targeted tests pass. Native final projection preserves prior prefix after tool activation. Two-repetition ultrafull benchmark compared against fresh pre-fix and previous accepted baselines; no material patch-induced regression. See Global validation for artifacts and caveats: live provider is Anthropic, shared initial-cache warmth affects cost delta, second historical Codex miss unresolved, three LSP checks inconclusive. Unrelated dirty work preserved. No commit, push, restart or installed Pi change.

## Amendments

None.
