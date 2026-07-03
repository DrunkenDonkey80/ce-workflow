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

const fixture = installWorkflowFixture();
try {
	let state = buildWorkPauseState(process.cwd(), "handoff after lint");
	assert(
		state.ok && state.action === "checkpoint-appended",
		"active in-progress Bead gets checkpoint",
	);
	assert(state.selectedBead.id === "IMP-1", "pause selects in-progress Bead");
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
		fixture
			.logs()
			.some((entry) => entry.op === "update" && entry.id === "IMP-1"),
		"pause appends note through bd update",
	);

	fixture.reset("active", "unknown");
	state = buildWorkPauseState(process.cwd(), "dirty checkpoint");
	assert(
		state.ok && state.note.includes("extensions/work-models.js"),
		"dirty files are listed by path",
	);

	fixture.reset("ambiguous");
	state = buildWorkPauseState(process.cwd(), "ambiguous");
	assert(
		!state.ok && state.reason === "ambiguous-target",
		"ambiguous active epics stop",
	);
	assert(fixture.logs().length === 0, "ambiguous pause does not mutate Beads");

	fixture.reset("noInProgress");
	state = buildWorkPauseState(process.cwd(), "draft only");
	assert(
		state.ok && state.action === "draft-checkpoint",
		"no in-progress Bead renders draft",
	);
	assert(!state.handoffPrompt, "draft checkpoint does not queue handoff");
	assert(fixture.logs().length === 0, "draft checkpoint does not mutate Beads");

	fixture.reset("no-beads");
	state = buildWorkPauseState(process.cwd(), "blocked");
	assert(
		!state.ok && state.reason === "beads-unavailable",
		"Beads failure is parseable",
	);
} finally {
	fixture.cleanup();
}

console.log("ok - coded work-pause behavior");
