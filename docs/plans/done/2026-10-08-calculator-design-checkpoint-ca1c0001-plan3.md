---
plan3: true
design: docs/designs/2026-10-08-plan3-ca1c0001
status: complete
created: 2026-10-08
updated: 2026-10-09T14:16:42.338Z
started: 2026-10-09T14:07:28.247Z
---

# Calculator design checkpoint

## Original request

User selected “Disposable calculator demo” for the real single-direction public-command OpenDesign checkpoint of plan 1fc5d5ce. This is visual planning only, no automatic product implementation or private material transfer.

## Goal, requirements, and non-goals

Reach a real OpenDesign Preview/Studio, human visual approval and reconciliation of this same disposable plan through `/plan3 design ca1c0001`. Use a minimal responsive web calculator: digits, decimal, four arithmetic operations, equals, clear/backspace, readable result and divide-by-zero error; preserve keyboard operation, visible focus and adequate contrast. Inspect desktop/mobile normal/error/focus states. No repository source, credentials, production assets or private references go to the provider. No calculator source/build/dependency is added to ce-workflow.

## Decisions

- **D-01** Visual authority is whatever page(s) the user approves at `/plan3 design finish ca1c0001`; prototype HTML is reference only, never production source. Source: user, 2026-10-09.
- **D-02** Build the calculator from the approved design in `C:/SOFT/git/calc-demo` (outside ce-workflow): plain HTML/CSS/JS, no dependencies. Supersedes the original "no automatic product implementation" for this scratch folder only. Source: user, 2026-10-09.
- **D-03** Builder model: Sol 6.1. Plan3 executes in the current agent, so switch to Sol 6.1 with /model before Start work. Source: user, 2026-10-09.
- **D-04** Behavior/accessibility are verified on the built calculator, not on the prototype; defects are fixed in calc-demo, not in OD. Source: user, 2026-10-09.
- **D-05 (assumed)** Use a separate local Git repository on master in C:/SOFT/git/calc-demo so implementation commits never include dirty ce-workflow files; no remote configured. Browser selfchecks reuse the installed Windows agent-browser/Chromium, with evidence in system temp; no app dependency added.


## Open questions

### Blocking

None.

### Deferred

None.

## Phases

- [x] **CALC-01** Built independent Kids calculator in calc-demo; initial screenshots match the approved reference pixel-for-pixel at 1800/1280/390/320; local commit d274468.
- [x] **CALC-02** 15 build-only browser checks pass: arithmetic/errors/recovery, keyboard/focus, 44px targets, desktop/mobile layout, rendered contrast and axe zero violations; local commit 62131e0.

## Global validation

- Calculator works and matches the approved design at desktop and mobile; nothing added to ce-workflow besides this plan and its design folder.
- **DES-NATIVE-SNAPSHOT** Implement the approved native pages as the visual authority (layout, tokens, copy) with the settled component/brief mapping; verify behavior and accessibility in the implementation with project checks. The prototype is reference only: never QA, revise or reapprove it for behavior defects; fix those in product code. Approved snapshot: docs/designs/2026-10-08-plan3-ca1c0001.
- **Final implementation evidence:** C:/SOFT/git/calc-demo/CHECKS.md; visual comparison 4/4 PASS at 1800/1280/390/320; build browser selfchecks 15/15 PASS, including numeric overflow and Clear recovery. Axe 0 violations; pseudo-element text contrast separately sampled >=4.5:1. Initial/selected/error and long-entry layouts fit; keyboard focus/18-button order/native activation and reduced motion pass. Frozen design gate returned [] before building. No behavior qualification of the prototype or new OD generation/export.
- **Unavailable checks:** human screen-reader listening and non-Chromium engines. No full WCAG certification claimed. Normal JS floating-point precision applies. Final LSP reports no errors, but the push-only JS server cannot confirm clean; node syntax/browser checks pass. Existing ce-workflow code/dirty files were not changed by implementation; no package suite rerun needed for this standalone build.


## Resume context

Complete: Sol 6.1 built C:/SOFT/git/calc-demo/index.html, style.css and calculator.js from the approved frozen Kids reference. Four initial screenshot comparisons are pixel-identical; final 15 build browser checks pass. Evidence and unavailable listening/cross-browser checks: C:/SOFT/git/calc-demo/CHECKS.md. Scratch repo master commits d274468 (CALC-01) and 62131e0 (CALC-02), no remote/push. Only ce-workflow plan/log updated; pre-existing dirty code/design/reset changes remain unstaged. No further implementation step; open index.html locally. Stop reason: scope complete.

## Amendments

- 2026-10-09 reset to pre-export state to rerun the native design flow end to end; previous plan backed up outside the repo.

## Visual design

Mode: native OpenDesign export
Phase: reconciled (local snapshot; no live monitoring)
Next: /resume3 ca1c0001
Artifacts: docs/designs/2026-10-08-plan3-ca1c0001

