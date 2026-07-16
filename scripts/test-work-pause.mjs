#!/usr/bin/env node
import { realpathSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { assert, installWorkflowFixture } from "./work-command-fixture.mjs";

const { buildWorkPauseState } = await import(
	pathToFileURL(
		realpathSync(
			path.join(import.meta.dirname, "../extensions/work-models.js"),
		),
	).href
);

const fixture = installWorkflowFixture({ native: true });
try {
	let state = buildWorkPauseState(fixture.cwd, "handoff after lint");
	assert(
		state.ok && state.action === "checkpoint-appended",
		"active in-progress WorkItem gets checkpoint",
	);
	assert(state.selectedWorkItem.id === "IMP-1", "pause selects in-progress WorkItem");
	assert(
		state.note.includes("last verification: Command: npm run verify"),
		"checkpoint includes last verification",
	);
	assert(
		state.note.includes("failures: Failure: lint failed"),
		"checkpoint includes failures",
	);
	assert(
		state.note.includes("remaining work: Next: fix lint and rerun"),
		"checkpoint includes remaining work",
	);
	assert(
		state.note.includes("note: handoff after lint"),
		"checkpoint includes user note",
	);
	assert(!state.handoffPrompt, "pause never queues a handoff");
	assert(
		fixture.store().items["IMP-1"].notes.some((note) => note.includes("work-pause checkpoint")) &&
			fixture.logs().length === 0,
		"pause persists checkpoint natively without bd",
	);

	fixture.reset("active", "unknown");
	state = buildWorkPauseState(fixture.cwd, "dirty checkpoint");
	assert(
		state.ok && state.note.includes("extensions/work-models.js"),
		"dirty files are listed by path",
	);

	fixture.reset("ambiguous");
	state = buildWorkPauseState(fixture.cwd, "ambiguous");
	assert(
		!state.ok && state.reason === "ambiguous-target",
		"ambiguous active epics stop",
	);
	assert(fixture.logs().length === 0, "ambiguous pause does not invoke bd");

	fixture.reset("noInProgress");
	state = buildWorkPauseState(fixture.cwd, "draft only");
	assert(
		state.ok && state.action === "draft-checkpoint",
		"no in-progress WorkItem renders draft",
	);
	assert(!state.handoffPrompt, "draft checkpoint does not queue handoff");
	assert(fixture.logs().length === 0, "draft checkpoint does not invoke bd");

	fixture.reset("active");
	state = buildWorkPauseState(fixture.cwd, "native");
	assert(state.ok, "native pause does not require bd");
} finally {
	fixture.cleanup();
}

console.log("ok - coded work-pause behavior");
