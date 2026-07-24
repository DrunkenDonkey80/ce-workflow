#!/usr/bin/env node
import { realpathSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { assert, installWorkflowFixture } from "./work-command-fixture.mjs";

const { buildWorkAutoState } = await import(
	pathToFileURL(
		realpathSync(
			path.join(import.meta.dirname, "../extensions/work-models.js"),
		),
	).href
);

const fixture = installWorkflowFixture({ native: true });
try {
	let state = buildWorkAutoState(fixture.cwd, "");
	assert(
		!state.ok && state.reason === "usage",
		"empty auto input returns usage",
	);
	assert(!state.handoffPrompt, "empty auto input sends no follow-up");

	fixture.reset("blocked");
	state = buildWorkAutoState(fixture.cwd, "BLOCK-1");
	assert(
		state.ok && state.action === "debug-blocked",
		"blocked WorkItem routes through debug intake without retrying blindly",
	);
	assert(
		state.suggestedCommands[0] === "/work-report BLOCK-1",
		"blocked WorkItem points to report handoff",
	);

	fixture.reset("debug");
	state = buildWorkAutoState(fixture.cwd, "IMP-2");
	assert(
		state.ok && state.selectedWorkItem.id === "BUG-1",
		"debug-needed WorkItem routes through debug intake",
	);

	fixture.reset("active");
	state = buildWorkAutoState(fixture.cwd, "test failure: expected 200 got 500");
	assert(
		state.ok &&
			state.action === "debug-ready" &&
			state.autoClassification === "debug",
		"failing-test prose routes directly to the debugger policy",
	);

	state = buildWorkAutoState(fixture.cwd, "migrate old TODO list");
	assert(
		state.ok &&
			state.action === "handoff-migrate" &&
			state.autoClassification === "migrate",
		"migration-like prose routes directly to migration",
	);

	state = buildWorkAutoState(fixture.cwd, "add a tiny status helper");
	assert(
		state.ok &&
			state.action === "run-implementation" &&
			state.autoClassification === "small" &&
			state.executionPolicy.level === "small" &&
			!state.inlineWork,
		"ordinary tiny feature routes to a small scoped worker",
	);

	fixture.reset("active", "unknown");
	state = buildWorkAutoState(fixture.cwd, "add a feature");
	assert(
		!state.ok && state.reason === "dirty-stop",
		"unsafe dirty state blocks auto handoff",
	);
} finally {
	fixture.cleanup();
}

console.log("ok - coded work-auto behavior");
