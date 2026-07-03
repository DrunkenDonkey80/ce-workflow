#!/usr/bin/env node
import { realpathSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { assert, installWorkflowFixture } from "./work-command-fixture.mjs";

const { buildWorkflowIntakeState } = await import(
	pathToFileURL(
		realpathSync(
			path.join(import.meta.dirname, "../extensions/work-models.js"),
		),
	).href
);

const fixture = installWorkflowFixture();
try {
	let state = buildWorkflowIntakeState(process.cwd(), "E-1");
	assert(state.ok, "clean explicit epic returns intake state");
	assert(state.epic.id === "E-1", "intake includes epic");
	assert(state.git.safeForHandoff, "clean git is safe");

	fixture.reset("no-beads");
	state = buildWorkflowIntakeState(process.cwd(), "last");
	assert(
		!state.ok && state.reason === "beads-unavailable",
		"missing Beads is parseable",
	);

	fixture.reset("ambiguous");
	state = buildWorkflowIntakeState(process.cwd(), "last");
	assert(
		!state.ok && state.reason === "ambiguous-target",
		"ambiguous epic stops",
	);
	assert(state.candidates.length === 2, "ambiguous stop includes candidates");

	fixture.reset("active", "unknown");
	state = buildWorkflowIntakeState(process.cwd(), "E-1");
	assert(!state.git.safeForHandoff, "unknown dirty file is unsafe");
	assert(
		state.git.dirtyPaths.includes("extensions/work-models.js"),
		"dirty paths come from porcelain",
	);

	fixture.reset("active", "benign");
	state = buildWorkflowIntakeState(process.cwd(), "E-1");
	assert(
		state.git.safeForHandoff && state.git.benignDirty,
		"whitespace-only instruction dirt is benign",
	);

	fixture.reset("active", "instruction-substantive");
	state = buildWorkflowIntakeState(process.cwd(), "E-1");
	assert(!state.git.safeForHandoff, "substantive instruction dirt is unsafe");

	fixture.reset("active", "staged-instruction");
	state = buildWorkflowIntakeState(process.cwd(), "E-1");
	assert(!state.git.safeForHandoff, "staged instruction dirt is unsafe");

	fixture.reset("active", "untracked-instruction");
	state = buildWorkflowIntakeState(process.cwd(), "E-1");
	assert(!state.git.safeForHandoff, "untracked instruction dirt is unsafe");
} finally {
	fixture.cleanup();
}

console.log("ok - coded work-intake behavior");
