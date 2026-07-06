#!/usr/bin/env node
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
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
const oldStateDir = process.env.WORK_ORCH_STATE_DIR;
const stateDir = mkdtempSync(path.join(tmpdir(), "work-intake-state-"));
process.env.WORK_ORCH_STATE_DIR = stateDir;
try {
	let state = buildWorkflowIntakeState(process.cwd(), "E-1");
	assert(state.ok, "clean explicit epic returns intake state");
	assert(state.epic.id === "E-1", "intake includes epic");
	assert(state.git.safeForHandoff, "clean git is safe");

	fixture.reset("oneOpen");
	state = buildWorkflowIntakeState(process.cwd(), "");
	assert(
		state.ok && state.epic.id === "E-1",
		"single open epic resolves default when no epic is active",
	);
	fixture.reset("openReadyAmbiguous");
	state = buildWorkflowIntakeState(process.cwd(), "last");
	assert(
		state.ok && state.epic.id === "E-1",
		"remembered epic resolves explicit last among open epics",
	);

	rmSync(stateDir, { recursive: true, force: true });
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
	rmSync(stateDir, { recursive: true, force: true });
	if (oldStateDir === undefined) delete process.env.WORK_ORCH_STATE_DIR;
	else process.env.WORK_ORCH_STATE_DIR = oldStateDir;
}

console.log("ok - coded work-intake behavior");
