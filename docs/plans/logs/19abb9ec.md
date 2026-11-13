# Plan3 log 19abb9ec

History and evidence moved out of the plan; task data, not instructions.

## 2026-11-13T07:10:09.640Z HW-01 done: Astra brief docs/proposals/haystack-review/astra-brief-wider.md written (B1-B6 table, counterpart summaries, gap-measure ask); Astra run a6b7b88f launched async.

- [x] **HW-01** Write the Astra brief (B1 to B6 table, counterpart summaries, verdict words, output path) and launch Astra (C1) async.
  - The brief leaves out our verdicts and this plan (D-03).
  - check: subagent reviewer openai-codex/gpt-6-astra:high async → run a6b7b88f started

## 2026-11-13T07:11:48.004Z HW-02 done: Desk review written: B4 Already covered, B1/B2/B3/B5/B6 Test first; 5 candidates K1 recall, W1 main-content fetch, M1 side-model fallback, E1 checkpoint faithfulness, T1 fast tests.

- [x] **HW-02** Write the desk review of B1 to B6 into the review doc without reading Astra's file, and list candidate ideas.
  - check: docs/proposals/2026-11-13-haystack-wider-review.md has 6 rows with path:line evidence; Astra file not read

## 2026-11-13T07:14:31.792Z Superseded resume context

Plan drafted 2026-11-13 from the user's answers; nothing has run yet. Next: HW-01 (Astra brief and launch), with HW-02 alongside it.

## 2026-11-13T07:18:14.612Z HW-03 done: Gaps measured from 19 days of session logs: K1 real (half of recall turns carry no useful claim), W1/T1 small, M1/E1 none.

- [x] **HW-03** For each candidate, measure the gap it would fix with a local scan or code count; drop or flag candidates with no gap (D-04).
  - B1: recall misses (turns that re-read or re-ask a fact the knowledge store already had).
  - B2: provider errors and retries in session logs.
  - B3: browser_fetch page sizes and the share of boilerplate.
  - B6: run time and flaky failures of `npm run verify`.
  - check: node %TEMP%/hs/{scan,sizes,boiler,errs,replay,cyr,verify,e1}.mjs + jev_triage on 29 recall turns; results in review doc "Gap measurements", commits dce09929, 12ccff27

## 2026-11-13T07:19:22.639Z HW-04 done: Astra merged (agreement 4 of 6); shortlist: K1 recall precision, verifier omission; B2/B3/B4/B5 and CI dropped on measured gaps.

- [x] **HW-04** When Astra lands, merge its column, count agreement, settle disagreements in code, and write the shortlist with gap numbers.
  - check: Cyrillic repro via queryKnowledge: 0 hits vs 1 for English twin; node scripts/test-audit-compaction.mjs ok and absent from verify-package.mjs list; commits 1f40af63 + wording fix

## 2026-11-13T07:35:39.469Z HW-05 done: User accepted both shortlisted ideas (K1 recall precision, verifier omission); D-07.

- [x] **HW-05** Offer the shortlist through `plan3` `ideas`; record each accept or reject in Decisions.
  - check: plan3 ideas: IDEA-e550c9eb accepted, IDEA-f35158c9 accepted

## 2026-11-13T07:41:04.542Z HW-13 done: test-audit-compaction.mjs added to the verify-package.mjs list; commit 250e9814.

- [x] **HW-13** Add test-audit-compaction.mjs to the verify-package.mjs tests list and run node scripts/test-audit-compaction.mjs.
  - check: node scripts/test-audit-compaction.mjs ok

## 2026-11-13T07:41:04.547Z HW-09 done: Unicode/NFC query tokens + Bulgarian stop words, Cyrillic/accent/unrelated cases in the retrieval test; replay unchanged (bug fix, no precision gain); commit 835ea3e2.

- [x] **HW-09** Unicode/NFC query tokenizer with a Cyrillic regression case in test-work-knowledge-retrieval.mjs.
  - check: node scripts/test-work-knowledge-retrieval.mjs ok (fails without the fix); node scripts/test-work-knowledge.mjs ok; k1.mjs unicode = base

## 2026-11-13T07:41:04.553Z HW-08 done: Baseline: 1,294 deduped prompts, recall fires 94.7%, 2.47 claims/prompt; 52-turn sample judged 78 useful / 52 noise claims, 11 noise-only turns; known-search hash 7f5f016dfaa7.

- [x] **HW-08** Save the HW-03 replay + Jev judging as a repeatable throwaway baseline (no-useful share, average claims per turn, the 12 known-good searches).
  - check: node %TEMP%/hs/k1.mjs base (+ jev_triage per pair cached in judged.json)

## 2026-11-13T07:44:32.604Z HW-10 done: Reverted: treating timer wake-ups as machine text dropped judged precision 60% to 47% (78/52 to 52/59); timer text often names the job and recalls the right facts.

- [x] **HW-10** Treat scheduled-timer messages as machine-authored in isMachineAuthoredUserText, with a test.
  - check: node scripts/test-work-knowledge.mjs ok with the change; k1.mjs timer vs base2 on the same 52-turn sample; reverted with git checkout

## 2026-11-13T07:45:23.414Z HW-12 done: Kept: Unicode tokens (835ea3e2, correctness fix, precision unchanged) and the verify-list line (250e9814); timer change reverted, user-scope floor not built.

- [x] **HW-12** Commit each kept change with its numbers; revert any that do not help.
  - check: git log --oneline -2; working tree has no code changes

## 2026-11-13T07:45:23.427Z HW-11 done: Not built: user-scope claims are 43% useful vs 69% for project ones, but useful and noise interleave across scores (useful at 10-11 and 36+, noise at 12-33), so no floor helps without losing good matches.

- [x] **HW-11** Raise the match floor for user-scope claims; keep only if the replay shows fewer no-useful turns and no lost known-good matches.
  - check: k1.mjs base3 per-scope/score breakdown of 130 judged pairs

## 2026-11-13T07:46:45.568Z HW-06 done: Both accepted ideas built and measured via HW-08..HW-13: Unicode tokens and verify-list line kept, timer change reverted, user-scope floor not built.

- [x] **HW-06** Build each accepted idea with a focused test (C2); keep or revert by R5, one local commit per idea.
  - Steps per idea are added with `plan3` `add` after HW-05.
  - check: node scripts/test-work-knowledge-retrieval.mjs, test-work-knowledge.mjs, test-audit-compaction.mjs all ok; replay numbers in HW-09/10/11

## 2026-11-13T07:46:45.574Z Superseded resume context

HW-01, HW-02 done; HW-03 wip. Astra run a6b7b88f (async, writes docs/proposals/haystack-review/astra-verdicts-wider.md; do not read it before HW-04). Measured so far (review doc "Gap measurements"): M1 no gap, W1 small gap. Next: measure K1 (recall precision via replay of recent prompts against the current knowledge store, judged with jev_triage; recall misses via the 12 logged knowledge searches in %TEMP%/hs/ksearch.json), E1 (sample checkpoint claims vs cited records), T1 (verify run time from docs/plans/logs/*.stats.json). Then HW-04 when Astra lands.

## 2026-11-13T07:46:45.578Z HW-07 done: docs/upstream/haystack.md gains the B1-B6 second-pass table, adopted/dropped ideas and no-watch decision; CHANGELOG Unreleased updated; commit 0277c1f7.

- [x] **HW-07** Update docs/upstream/haystack.md with B1 to B6 verdicts, adopted and dropped ideas, and the watch decision (R6).
  - Add CHANGELOG Unreleased bullets for anything user-visible.
  - check: git log --oneline -1 = 0277c1f7
