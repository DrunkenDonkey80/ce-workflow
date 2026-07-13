#!/usr/bin/env node
import { realpathSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
const { assert } = await import(
	pathToFileURL(
		realpathSync(path.join(import.meta.dirname, "work-command-fixture.mjs")),
	).href
);
const { isWorkflowDirt } = await import(
	pathToFileURL(
		realpathSync(path.join(import.meta.dirname, "../extensions/work-models.js")),
	).href
);

const cwd = process.cwd();
const dirt = (file) => isWorkflowDirt(cwd, { path: file });

// The workflow's own runtime artifacts must never block a transition.
assert(dirt(".beads/interactions.jsonl"), "beads state dirt is tolerated");
assert(dirt(".beads/issues.jsonl"), "beads issues dirt is tolerated");
assert(dirt(".pi/work-runs/2026-07-13.jsonl"), ".pi/work-runs dirt is tolerated");
assert(
	dirt(".pi/work-orchestrator-state.json"),
	".pi orchestrator state is tolerated",
);
assert(
	dirt(".pi-subagents/artifacts/x_output.md"),
	".pi-subagents dirt is tolerated",
);

// Plan dirt is tolerated only when the plan path is supplied (resume/bootstrap).
assert(
	!dirt("docs/plans/my-plan.md"),
	"plan path is not tolerated unless listed in planPaths",
);
assert(
	isWorkflowDirt(cwd, { path: "docs/plans/my-plan.md" }, [
		"docs/plans/my-plan.md",
	]),
	"plan path is tolerated when listed in planPaths",
);

// Windows reserved-name junk (e.g. a stray `nul`) cannot be real source and
// must not block a transition.
if (process.platform === "win32") {
	assert(dirt("nul"), "Windows reserved-name junk (nul) is tolerated");
	assert(dirt("src/CON.log"), "Windows reserved name in a subpath is tolerated");
}

// Real source/config is NOT tolerated — these correctly remain blockers.
assert(!dirt("src/main.py"), "real source files are not tolerated");
assert(!dirt("package.json"), "package.json is not tolerated");

console.log("dirt tolerance: PASS");
