#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
const { assert } = await import(
	pathToFileURL(
		realpathSync(path.join(import.meta.dirname, "work-command-fixture.mjs")),
	).href
);
const { isWorkflowDirt, isGeneratedBuildArtifact } = await import(
	pathToFileURL(
		realpathSync(
			path.join(import.meta.dirname, "../extensions/work-models.js"),
		),
	).href
);

const cwd = process.cwd();
const dirt = (file) => isWorkflowDirt(cwd, { path: file });

// The workflow's own runtime artifacts must never block a transition.
assert(dirt(".beads/interactions.jsonl"), "beads state dirt is tolerated");
assert(dirt(".beads/issues.jsonl"), "beads issues dirt is tolerated");
assert(
	dirt(".pi/work-runs/2026-07-13.jsonl"),
	".pi/work-runs dirt is tolerated",
);
assert(
	dirt(".pi/work-orchestrator-state.json"),
	".pi orchestrator state is tolerated",
);
assert(
	dirt(".pi-subagents/artifacts/x_output.md"),
	".pi-subagents dirt is tolerated",
);

// Generated build artifacts (PyInstaller build/dist, __pycache__, etc.) must not
// block, even when a project forgets to gitignore them.
assert(
	isGeneratedBuildArtifact("tools/x/build/pkg/Analysis-00.toc"),
	"build/ output is a generated artifact",
);
assert(
	isGeneratedBuildArtifact("tools/x/dist/app.exe"),
	"dist/ output is a generated artifact",
);
assert(
	isGeneratedBuildArtifact("pkg/__pycache__/m.pyc"),
	"__pycache__ is generated",
);
assert(isGeneratedBuildArtifact("src/m.pyc"), "*.pyc is generated");
assert(
	isGeneratedBuildArtifact("a/b/node_modules/lib/index.js"),
	"node_modules is generated",
);
assert(
	dirt("tools/barcode-display-gui/build/barcode-display-gui/PYZ-00.toc"),
	"generated build output is tolerated (non-blocking)",
);
assert(
	dirt("tools/barcode-display-gui/dist/barcode-display-gui.exe"),
	"generated dist output is tolerated (non-blocking)",
);
assert(
	!isGeneratedBuildArtifact("src/main.py"),
	"source is not a build artifact",
);
assert(
	!isGeneratedBuildArtifact("docs/build-guide.md"),
	"a file named build-guide.md is not a build/ directory",
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

// Windows reserved-name junk (e.g. a stray `nul`) cannot be real source.
if (process.platform === "win32") {
	assert(dirt("nul"), "Windows reserved-name junk (nul) is tolerated");
	assert(
		dirt("src/CON.log"),
		"Windows reserved name in a subpath is tolerated",
	);
}

// Real source/config is NOT tolerated — these correctly remain blockers.
assert(!dirt("src/main.py"), "real source files are not tolerated");
assert(!dirt("package.json"), "package.json is not tolerated");

// Formatter-only (whitespace/blank-line) changes to a tracked file are tolerated,
// so an editor/workflow formatter that runs after a commit cannot stall the flow.
const git = (repo, args) =>
	execFileSync("git", args, {
		cwd: repo,
		stdio: ["ignore", "pipe", "pipe"],
	});
const repo = mkdtempSync(path.join(tmpdir(), "wo-fmt-"));
git(repo, ["init", "-q"]);
git(repo, ["config", "user.email", "t@t.test"]);
git(repo, ["config", "user.name", "test"]);
writeFileSync(path.join(repo, "x.py"), "def f():\n    return 1\n");
git(repo, ["add", "-A"]);
git(repo, ["commit", "-q", "-m", "init"]);
writeFileSync(path.join(repo, "x.py"), "\ndef f():\n  return 1\n");
assert(
	isWorkflowDirt(repo, { path: "x.py", x: " ", y: "M" }),
	"formatter-only whitespace change is tolerated",
);
writeFileSync(path.join(repo, "x.py"), "def f():\n    return 2\n");
assert(
	!isWorkflowDirt(repo, { path: "x.py", x: " ", y: "M" }),
	"substantive source change is NOT tolerated",
);

console.log("dirt tolerance: PASS");
