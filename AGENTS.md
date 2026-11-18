## Code-First Workflow Rule

If project workflow behavior can be handled in code without losing functionality, prefer coded automation over prompt-only or manual process guidance.

## Rules for specific work

Before building or changing a dialog or model picker, reviewing videos, judging an optimization or benchmark, or choosing a compaction mode for tests, read that section of `docs/agent-rules.md`.

## Fast Commit-and-Push Rule

For direct commit-and-push requests, use this path: one parallel preflight (`status`, `diff --stat`, branch/remote); inspect only unexpected or sensitive untracked files and never stage credentials; run one batched LSP check plus the smallest relevant tests; stage tracked changes with `git add -u`, then commit and push `master`. Changes made by other sessions belong to the commit too: never leave them out as "not mine" (still never stage credentials). Run their targeted tests as well; finish with one status/ahead check. If status and diff disagree, use `git diff-index` once instead of repeated probes. Do not create temporary comparison files.

## Test Scope Rule

After each change, run only the targeted test scripts for the touched code. Before a push,
run only the targeted tests for the pushed changes unless the request asks for the full suite
(then `npm run verify:quiet` once) or says no tests (then none). Never run the full suite after every edit.

## Version Before Push Rule

Before every push, increment the package version in `package.json` and commit it. Version `x.y.z`: small changes (fixes, tweaks) bump `z`, which never goes past 99; a new module or tool (or `z` would pass 99) bumps `y` and resets `z` to 0; when `y` would pass 9, bump `x` and reset `y` and `z` to 0. Write `z` unpadded (`0.2.0`, not `0.2.00`): npm rejects leading zeros. Keep any tracked lockfile version in sync. Retrying the same failed push does not require another increment.

In the same commit, move `CHANGELOG.md`'s Unreleased bullets (and anything else since the last version's commit) under a new `## <version> — <date>` heading with `### Added` / `### Changed` / `### Fixed`, in plain user words, hub and `/wo` together. A visible hub change also gets a screenshot: see Changelog screenshots in `docs/agent-rules.md`.

## Extension File Rule

Write every extension module (anything under `extensions/` or imported by an
extension) as `.ts`, never `.js`. Pi's jiti loader compiles `.ts` fresh on
`/reload`, but `.js` in this `"type": "module"` package goes through Node's
native ESM cache and stays stale until Pi restarts. Import siblings with the
`.ts` specifier. Scripts that may run from an installed `node_modules` copy
must load extension modules through jiti (`createJiti(import.meta.url).import`),
because Node refuses to strip types under `node_modules`; tests run from the
repo may import `.ts` natively.

## Branch Rule

Always develop directly on `master`. Do not create or switch to feature branches, and do not ask for confirmation.
