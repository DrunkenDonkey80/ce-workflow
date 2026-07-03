#!/usr/bin/env node
import { realpathSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { assert, installWorkflowFixture } from "./work-command-fixture.mjs";

const { buildWorkAddState } = await import(
	pathToFileURL(
		realpathSync(
			path.join(import.meta.dirname, "../extensions/work-models.js"),
		),
	).href
);

const fixture = installWorkflowFixture();
try {
	let state = buildWorkAddState(process.cwd(), "Add coded pause tests");
	assert(state.ok && state.action === "work-added", "task creates child Bead");
	assert(state.epic.id === "E-1", "task is created under active epic");
	assert(
		fixture
			.logs()
			.some(
				(entry) =>
					entry.op === "create" &&
					entry.issue.title === "Add coded pause tests",
			),
		"create command is recorded",
	);

	state = buildWorkAddState(process.cwd(), "");
	assert(
		!state.ok && state.reason === "usage",
		"empty task returns usage stop",
	);

	fixture.reset("ambiguous");
	state = buildWorkAddState(process.cwd(), "Needs explicit parent");
	assert(
		!state.ok && state.reason === "ambiguous-target",
		"ambiguous active epic without --epic stops",
	);
	assert(fixture.logs().length === 0, "ambiguous add does not create Beads");

	fixture.reset("openReadyAmbiguous");
	state = buildWorkAddState(process.cwd(), "Must not guess open ready epic");
	assert(
		!state.ok && state.reason === "no-active-epic",
		"mutating add does not guess among open epics",
	);
	assert(
		fixture.logs().length === 0,
		"open epic heuristic does not mutate Beads",
	);

	fixture.reset("ambiguous");
	state = buildWorkAddState(
		process.cwd(),
		"--epic E-1 Add explicit parent task",
	);
	assert(
		state.ok && state.epic.id === "E-1",
		"--epic resolves ambiguous active epics",
	);

	fixture.reset("debug");
	state = buildWorkAddState(
		process.cwd(),
		"--blocked-by BUG-1 Add blocked task",
	);
	assert(
		state.ok && state.blockedBy.id === "BUG-1",
		"--blocked-by is preserved",
	);
	assert(
		fixture
			.logs()
			.some((entry) => entry.op === "dep-add" && entry.earlier === "BUG-1"),
		"dependency is added in correct direction",
	);

	fixture.reset("active");
	state = buildWorkAddState(process.cwd(), "Add independent task");
	assert(state.ok && !state.blockedBy, "no blocker creates no dependency");
	assert(
		!fixture.logs().some((entry) => entry.op === "dep-add"),
		"no blocker target means no dep add",
	);

	fixture.reset("active", "unknown");
	state = buildWorkAddState(process.cwd(), "Should not create");
	assert(
		!state.ok && state.reason === "dirty-stop",
		"unsafe dirty state stops before mutation",
	);
	assert(fixture.logs().length === 0, "dirty stop does not create Beads");

	fixture.reset("create-fail");
	state = buildWorkAddState(process.cwd(), "Create fails");
	assert(
		!state.ok && state.message.includes("create failed"),
		"create failure preserves native text",
	);
} finally {
	fixture.cleanup();
}

console.log("ok - coded work-add behavior");
