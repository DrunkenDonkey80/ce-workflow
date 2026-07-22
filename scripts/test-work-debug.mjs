#!/usr/bin/env node
import { realpathSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { assert, installWorkflowFixture } from "./work-command-fixture.mjs";

const { buildWorkDebugState } = await import(
	pathToFileURL(
		realpathSync(
			path.join(import.meta.dirname, "../extensions/work-models.js"),
		),
	).href
);

const fixture = installWorkflowFixture({ native: true });
try {
	fixture.reset("debug");
	let state = buildWorkDebugState(fixture.cwd, "BUG-1");
	assert(
		state.ok && state.selectedWorkItem.id === "BUG-1",
		"explicit bug target is used",
	);
	assert(
		state.handoffPrompt.includes("Debug WorkItem: BUG-1"),
		"debug handoff names target",
	);

	fixture.reset("debug");
	state = buildWorkDebugState(fixture.cwd, "IMP-2");
	assert(
		state.ok && state.selectedWorkItem.id === "BUG-1",
		"debug-needed marker is followed",
	);

	fixture.reset("blocked");
	state = buildWorkDebugState(fixture.cwd, "BLOCK-1");
	assert(
		state.ok && state.action === "debug-blocked" && !state.handoffPrompt,
		"blocked debug target stops without explicit retry guidance",
	);
	assert(
		state.suggestedCommands[0] === "/work-report BLOCK-1",
		"blocked debug target points to report handoff",
	);

	fixture.reset("blocked");
	state = buildWorkDebugState(fixture.cwd, "BLOCK-1: device is available");
	assert(
		state.ok && state.selectedWorkItem.id === "BLOCK-1",
		"explicit blocked target with guidance is debugged directly",
	);
	assert(
		state.handoffPrompt.includes("Guidance: device is available"),
		"blocked target guidance is preserved",
	);
	assert(
		fixture.store().items["BLOCK-1"].status === "open" &&
			fixture.store().items["BLOCK-1"].notes.some((note) => note.includes("retry-guidance")) &&
			fixture.logs().length === 0,
		"blocked target is reopened natively before handoff",
	);

	fixture.reset("blocked");
	state = buildWorkDebugState(fixture.cwd, "1: device is available");
	assert(
		state.ok && state.selectedWorkItem.id === "BLOCK-1",
		"numeric shorthand resolves to active epic child workItem",
	);

	fixture.reset("blocked");
	state = buildWorkDebugState(fixture.cwd, "1 device is available");
	assert(
		state.ok && state.selectedWorkItem.id === "BLOCK-1",
		"numeric shorthand plus prose is treated as retry guidance, not a new bug",
	);
	assert(
		state.handoffPrompt.includes("Guidance: device is available"),
		"space-separated shorthand guidance is preserved",
	);

	fixture.reset("debug");
	state = buildWorkDebugState(fixture.cwd, "IMP-1: rerun: npm test");
	assert(
		state.ok && state.selectedWorkItem.id === "BUG-1",
		"existing debug dependency is reused",
	);
	assert(
		state.handoffPrompt.includes("Guidance: rerun: npm test"),
		"guidance after first colon is preserved",
	);
	assert(
		Object.values(fixture.store().items).filter((item) => item.type === "bug").length === 1,
		"reuse path does not create duplicate bug",
	);

	fixture.reset("active");
	state = buildWorkDebugState(fixture.cwd, "terminal hangs: inspect COM8");
	assert(
		state.ok &&
			state.selectedWorkItem.type === "bug" &&
			state.epic.labels.includes("wo:misc"),
		"symptom-only request creates a native bug under Misc",
	);
	assert(
		state.selectedWorkItem.title === "terminal hangs",
		"symptom title is preserved",
	);
	assert(
		state.handoffPrompt.includes("Guidance: inspect COM8"),
		"symptom guidance is preserved",
	);

	fixture.reset("active");
	state = buildWorkDebugState(
		fixture.cwd,
		"--roadmap E-1 remember current: setup",
	);
	const beforeChoice = Object.keys(fixture.store().items).length;
	state = buildWorkDebugState(fixture.cwd, "ambiguous symptom");
	assert(
		!state.ok && state.reason === "task-roadmap-choice-required",
		"symptom-only debug asks current versus Misc",
	);
	assert(
		Object.keys(fixture.store().items).length === beforeChoice,
		"debug placement choice does not create a bug",
	);

	fixture.reset("debug");
	state = buildWorkDebugState(fixture.cwd, "NOPE-1");
	assert(
		!state.ok && state.reason === "unknown-target",
		"unknown WorkItem target stops",
	);

	fixture.reset("active");
	state = buildWorkDebugState(fixture.cwd, "--roadmap E-1 broken thing");
	assert(state.ok && fixture.logs().length === 0, "native debug does not require bd");

	fixture.reset("active", "unknown");
	state = buildWorkDebugState(fixture.cwd, "IMP-1");
	assert(
		!state.ok && state.reason === "dirty-stop",
		"dirty git stops debug handoff",
	);
} finally {
	fixture.cleanup();
}

console.log("ok - coded work-debug behavior");
