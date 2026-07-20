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

const fixture = installWorkflowFixture({ native: true });
try {
	let state = buildWorkAddState(fixture.cwd, "Add coded pause tests");
	assert(
		state.ok && state.action === "work-added",
		"task creates child WorkItem",
	);
	assert(state.epic.id === "E-1", "task is created under active epic");
	assert(
		fixture.store().items[state.selectedWorkItem.id].title ===
			"Add coded pause tests" && fixture.logs().length === 0,
		"creation is one native mutation without bd",
	);

	state = buildWorkAddState(fixture.cwd, "");
	assert(
		!state.ok && state.reason === "usage",
		"empty task returns usage stop",
	);

	fixture.reset("ambiguous");
	state = buildWorkAddState(fixture.cwd, "Needs explicit parent");
	assert(
		!state.ok && state.reason === "ambiguous-target",
		"ambiguous active roadmap without --roadmap stops",
	);
	assert(fixture.logs().length === 0, "ambiguous add does not invoke bd");

	fixture.reset("openReadyAmbiguous");
	state = buildWorkAddState(fixture.cwd, "Must not guess open ready roadmap");
	assert(
		!state.ok && state.reason === "no-active-epic",
		"mutating add does not guess among open roadmaps",
	);
	assert(
		fixture.logs().length === 0,
		"open roadmap heuristic does not invoke bd",
	);

	fixture.reset("ambiguous");
	state = buildWorkAddState(
		fixture.cwd,
		"--roadmap E-1 Add explicit parent task",
	);
	assert(
		state.ok && state.epic.id === "E-1",
		"--roadmap resolves ambiguous active roadmaps",
	);

	fixture.reset("debug");
	state = buildWorkAddState(fixture.cwd, "--blocked-by BUG-1 Add blocked task");
	assert(
		state.ok && state.blockedBy.id === "BUG-1",
		"--blocked-by is preserved",
	);
	assert(
		fixture
			.store()
			.items[state.selectedWorkItem.id].dependencies.includes("BUG-1") &&
			fixture.logs().length === 0,
		"dependency is added natively in correct direction",
	);

	fixture.reset("active");
	state = buildWorkAddState(fixture.cwd, "Add independent task");
	assert(state.ok && !state.blockedBy, "no blocker creates no dependency");
	assert(
		fixture.store().items[state.selectedWorkItem.id].dependencies.length === 0,
		"no blocker target means no dependency",
	);

	fixture.reset("active", "unknown");
	state = buildWorkAddState(fixture.cwd, "Should not create");
	assert(
		!state.ok && state.reason === "dirty-stop",
		"unsafe dirty state stops before mutation",
	);
	assert(fixture.logs().length === 0, "dirty stop does not create WorkItems");

	fixture.reset("create-fail");
	state = buildWorkAddState(
		fixture.cwd,
		"Native create succeeds without command fixture",
	);
	assert(
		state.ok && fixture.logs().length === 0,
		"native create never invokes bd",
	);
} finally {
	fixture.cleanup();
}

console.log("ok - coded work-add behavior");
