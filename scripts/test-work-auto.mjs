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

const fixture = installWorkflowFixture();
try {
	let state = buildWorkAutoState(process.cwd(), "");
	assert(
		!state.ok && state.reason === "usage",
		"empty auto input returns usage",
	);
	assert(!state.handoffPrompt, "empty auto input sends no follow-up");

	fixture.reset("blocked");
	state = buildWorkAutoState(process.cwd(), "BLOCK-1");
	assert(
		state.ok && state.action.startsWith("debug"),
		"blocked Bead routes through debug intake",
	);
	assert(
		state.handoffPrompt.includes("mode: debug"),
		"blocked Bead gets debug handoff",
	);

	fixture.reset("debug");
	state = buildWorkAutoState(process.cwd(), "IMP-2");
	assert(
		state.ok && state.selectedBead.id === "BUG-1",
		"debug-needed Bead routes through debug intake",
	);

	fixture.reset("active");
	state = buildWorkAutoState(
		process.cwd(),
		"test failure: expected 200 got 500",
	);
	assert(
		state.ok && state.action === "handoff-auto",
		"failing-test prose stays in auto skill path",
	);
	assert(
		state.handoffPrompt.includes("Task: test failure: expected 200 got 500"),
		"failure prose is preserved unchanged",
	);

	state = buildWorkAutoState(process.cwd(), "migrate old TODO list");
	assert(
		state.ok && state.action === "handoff-auto",
		"migration-like prose stays in auto skill path",
	);

	state = buildWorkAutoState(process.cwd(), "add a tiny status helper");
	assert(
		state.ok && state.action === "handoff-auto",
		"ordinary feature text hands off to auto",
	);

	fixture.reset("active", "unknown");
	state = buildWorkAutoState(process.cwd(), "add a feature");
	assert(
		!state.ok && state.reason === "dirty-stop",
		"unsafe dirty state blocks auto handoff",
	);
} finally {
	fixture.cleanup();
}

console.log("ok - coded work-auto behavior");
