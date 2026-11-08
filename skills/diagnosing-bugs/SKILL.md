---
name: diagnosing-bugs
description: "Diagnosis loop for hard bugs and performance regressions; reproduce with one command before theorizing, prove the cause one change at a time, regression test red before the fix. Use when the user says \"diagnose\" or \"debug this\", when the cause of a failure or slowdown is unclear, a fix already failed, or the bug is flaky. An obvious few-line fix does not need it: make it and add the regression check."
license: Complete terms in LICENSE.txt
---

# Diagnosing bugs

A discipline for hard bugs. Skip a phase only with a stated reason. Read `GLOSSARY.md` and the ADRs in the area (when present) for the right mental model.

**Redact** every secret in commands, outputs and artifacts you show (`<REDACTED>`); keep credentials in environment variables, and quote only the lines that carry the signal.

## 1. Build a feedback loop

**This is the skill.** With a tight pass/fail signal that goes red on _this_ bug, you will find the cause; without one, reading code will not save you. Spend most of the effort here.

Ways to build one, roughly in order: a failing test at the seam that reaches the bug; a curl or HTTP script against a dev server; a CLI run on a fixture diffed against a known-good output; a headless browser script; a replayed captured request or event log; a throwaway harness around the one code path; a property or fuzz loop for "sometimes wrong"; a `git bisect run` harness between a good and a bad state; a differential run of old versus new. A human in the loop is the last resort, driven by a script that prompts them step by step and captures what they report.

Tighten it: faster (narrow scope, cache setup), sharper (assert the exact symptom, not "did not crash"), deterministic (pin time, seed randomness, isolate files and network). For flaky bugs, raise the reproduction rate (loop, parallelize, stress) until it is debuggable.

If you cannot build a loop, stop and say so: list what you tried and ask for access to an environment that reproduces it, a redacted artifact (log, HAR, dump) or permission for temporary instrumentation. Do not hypothesize without a loop.

**Done when** you can name **one command** you have **already run** (show it and its output) that drives the real bug path and asserts the user's exact symptom, gives the same verdict every run, takes seconds and runs unattended. If you catch yourself reading code to build a theory before this command exists, stop.

## 2. Reproduce and minimize

Run the loop and watch it go red with the failure the **user** described, not a nearby one (wrong bug, wrong fix). Capture the exact symptom. Then cut inputs, callers, config and steps **one at a time**, rerunning after each cut, until every remaining element is load-bearing.

## 3. Hypothesize

Write **3 to 5 ranked, falsifiable hypotheses** before testing any: "If X is the cause, changing Y makes the bug disappear." A hypothesis without a prediction is a vibe; sharpen or drop it. Show the list to the user when they are present (they often rerank it at once); do not block on it.

## 4. Instrument

Each probe tests one prediction; **change one variable at a time**. Prefer a debugger or REPL, then targeted logs at the boundaries that separate hypotheses; never log everything and grep. Tag every debug line with one unique prefix (`[DEBUG-a4f2]`) so cleanup is one grep. For performance, measure a baseline first (timer, profiler, query plan), then bisect.

## 5. Fix with a regression test

Write the regression test **before the fix**, at a seam that exercises the real bug pattern as it happens at the call site. If no such seam exists, that is a finding: say so instead of writing a shallow test that gives false confidence.

1. Turn the minimized repro into a failing test there and **watch it fail**.
2. Apply the smallest fix for the proven cause; do not edit beyond it.
3. Watch the test pass, then rerun the original loop on the full scenario.

## 6. Clean up

- [ ] The original loop no longer reproduces.
- [ ] The regression test passes (or the missing seam is stated).
- [ ] Every `[DEBUG-...]` line is removed (grep the prefix) and throwaway harnesses are deleted.
- [ ] The confirmed hypothesis is stated in the final message or commit, so the next debugger learns.

---

Adapted and shortened from Matt Pocock's `diagnosing-bugs` skill; provenance and changes in [UPSTREAM.md](UPSTREAM.md), MIT license in [LICENSE.txt](LICENSE.txt).
