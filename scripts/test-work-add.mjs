#!/usr/bin/env node
import { realpathSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { assert, installWorkflowFixture } from "./work-command-fixture.mjs";

const { buildWorkAddState, handleWorkflowAction } = await import(
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
	const miscId = state.epic.id;
	assert(
		state.epic.title === "Misc" && state.epic.labels.includes("wo:misc"),
		"ordinary task without a current roadmap creates Misc",
	);
	assert(
		fixture.store().items[state.selectedWorkItem.id].parentId === miscId &&
			fixture.logs().length === 0,
		"task is created under Misc without invoking bd",
	);
	state = buildWorkAddState(fixture.cwd, "Reuse Misc");
	assert(
		state.ok &&
			state.epic.id === miscId &&
			Object.values(fixture.store().items).filter((item) =>
				item.labels?.includes("wo:misc"),
			).length === 1,
		"ordinary tasks reuse one durable Misc roadmap",
	);

	state = buildWorkAddState(fixture.cwd, "");
	assert(
		!state.ok && state.reason === "usage",
		"empty task returns usage stop",
	);

	fixture.reset("active");
	state = buildWorkAddState(
		fixture.cwd,
		"--roadmap E-1 Remember the current roadmap",
	);
	const beforeChoice = Object.keys(fixture.store().items).length;
	state = buildWorkAddState(fixture.cwd, "Needs placement choice");
	assert(
		!state.ok &&
			state.reason === "task-roadmap-choice-required" &&
			state.roadmapChoices.length === 2,
		"a current roadmap asks current versus Misc",
	);
	assert(
		Object.keys(fixture.store().items).length === beforeChoice,
		"placement choice creates neither Misc nor a task",
	);
	const notices = [];
	state = await handleWorkflowAction(
		buildWorkAddState,
		"Place through dialog",
		{
			cwd: fixture.cwd,
			mode: "tui",
			ui: {
				notify: (message, level) => notices.push({ message, level }),
				select: async (_title, labels) =>
					labels.find((label) => label.startsWith("Misc")),
			},
		},
		{},
	);
	assert(
		state.ok && state.epic.labels.includes("wo:misc"),
		"interactive placement can select and create Misc",
	);

	fixture.reset("openReadyAmbiguous");
	state = buildWorkAddState(fixture.cwd, "Must not guess open ready roadmap");
	assert(
		state.ok && state.epic.labels.includes("wo:misc"),
		"unselected open roadmaps do not override Misc",
	);
	assert(fixture.logs().length === 0, "Misc routing does not invoke bd");

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
	state = buildWorkAddState(
		fixture.cwd,
		"--roadmap E-1 --blocked-by BUG-1 Add blocked task",
	);
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
	state = buildWorkAddState(
		fixture.cwd,
		"--roadmap E-1 Add independent task",
	);
	assert(state.ok && !state.blockedBy, "no blocker creates no dependency");
	assert(
		fixture.store().items[state.selectedWorkItem.id].dependencies.length === 0,
		"no blocker target means no dependency",
	);

	fixture.reset("active", "unknown");
	state = buildWorkAddState(fixture.cwd, "--roadmap E-1 Should not create");
	assert(
		!state.ok && state.reason === "dirty-stop",
		"unsafe dirty state stops before mutation",
	);
	assert(fixture.logs().length === 0, "dirty stop does not create WorkItems");

	fixture.reset("create-fail");
	state = buildWorkAddState(
		fixture.cwd,
		"--roadmap E-1 Native create succeeds without command fixture",
	);
	assert(
		state.ok && fixture.logs().length === 0,
		"native create never invokes bd",
	);
} finally {
	fixture.cleanup();
}

console.log("ok - coded work-add behavior");
