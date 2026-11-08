---
name: two-axis-review
description: "Review the changes since a fixed point (commit, branch, tag or merge-base) along two separate axes: Standards (does the code follow this repo's documented coding standards and a baseline of code smells?) and Spec (does it do what the request, plan or issue asked?). Reports both side by side, never merged. Use when the user asks to review a diff, a branch, a PR, work in progress, or \"review since X\"."
license: Complete terms in LICENSE.txt
---

Two-axis review of the diff between `HEAD` and a fixed point:

- **Standards**: does the code conform to this repo's documented coding standards?
- **Spec**: does the code faithfully implement what was asked?

The axes stay apart so one cannot mask the other. When the user has authorized delegation, run each axis as its own fresh-context subagent (pi-subagents, both in one parallel call) and aggregate their reports. Otherwise review Standards first and then Spec yourself, each from the diff and its own sources only, and keep the two sets of notes separate.

## 1. Pin the fixed point

Use the fixed point the user named (a SHA, branch, tag, `main`, `HEAD~5`, ...); if none, ask for it. Capture `git diff <fixed-point>...HEAD` (three dots: against the merge-base) and `git log <fixed-point>..HEAD --oneline`. For uncommitted work, also include `git diff HEAD`.

Confirm first that the ref resolves (`git rev-parse <fixed-point>`) and the diff is not empty; a bad ref or an empty diff fails here, not inside the reviews.

## 2. Find the spec

In this order:

1. A path or request text the user passed.
2. The Plan3 plan the change belongs to (`docs/plans/*-plan3.md`: Original request, Decisions and the steps), or issue references in the commit messages.
3. A spec under `docs/`, `specs/` or `.scratch/` matching the branch or feature.
4. Otherwise ask the user. If there is none, skip the Spec axis and report "no spec available".

## 3. Find the standards

Every file that documents how code is written here: `AGENTS.md`, `CLAUDE.md`, `CODING_STANDARDS.md`, `CONTRIBUTING.md`, style or architecture docs. When `CODING_STANDARDS.md` or `CONTRIBUTING.md` exists, it must be on the list.

On top of what the repo documents, the Standards axis always carries this **smell baseline** (Fowler, _Refactoring_, ch. 3). Two rules bind it:

- **The repo overrides.** A documented repo standard always wins; where it endorses something the baseline would flag, drop the smell.
- **Always a judgement call.** Each smell is a labelled heuristic ("possible Feature Envy"), never a hard violation. Skip anything tooling already enforces.

Each smell reads *what it is* → *how to fix*:

- **Mysterious Name**: a function, variable or type whose name does not reveal what it does or holds. → rename it; if no honest name comes, the design is murky.
- **Duplicated Code**: the same logic shape in more than one hunk or file of the change. → extract the shared shape and call it from both.
- **Feature Envy**: a method that reaches into another object's data more than its own. → move it onto the data it envies.
- **Data Clumps**: the same few fields or parameters keep travelling together. → bundle them into one type and pass that.
- **Primitive Obsession**: a primitive or string standing in for a domain concept. → give the concept its own small type.
- **Repeated Switches**: the same `switch`/`if` cascade on the same type recurs across the change. → one map or polymorphism both sites share.
- **Shotgun Surgery**: one logical change forces scattered edits across many files. → gather what changes together into one module.
- **Divergent Change**: one file or module is edited for several unrelated reasons. → split so each changes for one reason.
- **Speculative Generality**: abstraction, parameters or hooks for needs the spec does not have. → delete it; inline until a real need shows.
- **Message Chains**: long `a.b().c().d()` navigation the caller should not depend on. → hide the walk behind one method.
- **Middle Man**: a class or function that mostly delegates onward. → cut it and call the real target.
- **Refused Bequest**: a subclass or implementer that ignores most of what it inherits. → drop the inheritance, use composition.

## 4. Review each axis

**Standards** gets the diff command and commit list, the standards files from step 3 and the whole smell baseline (a subagent has no other copy). Brief: "Report, per file or hunk, (a) every place the diff breaks a documented standard, citing the file and rule; (b) any baseline smell, named, with the hunk quoted. Separate hard violations from judgement calls: documented-standard breaches can be hard, baseline smells never are, and a documented standard overrides the baseline. Skip what tooling enforces. Under 400 words."

**Spec** gets the diff command and commit list and the spec (path or contents). Brief: "Report (a) requirements that are missing or partial; (b) behaviour the spec did not ask for (scope creep, including unrelated edits); (c) requirements that look implemented but wrong. Quote the spec line for each finding. Under 400 words."

## 5. Report

Show the two reports under `## Standards` and `## Spec`, verbatim or lightly cleaned. Do **not** merge or rerank findings across axes. End with one line: findings per axis and the worst issue within each axis. Do not pick one winner across axes; that is the reranking the separation prevents.

## Why two axes

Code can follow every standard and implement the wrong thing (Standards pass, Spec fail), or do exactly what was asked while breaking the project's conventions (Spec pass, Standards fail). Reporting them apart stops one from hiding the other.

---

Adapted from Matt Pocock's `code-review` skill; provenance and changes in [UPSTREAM.md](UPSTREAM.md), MIT license in [LICENSE.txt](LICENSE.txt).
