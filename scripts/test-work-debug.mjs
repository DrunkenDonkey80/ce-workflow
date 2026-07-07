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

const fixture = installWorkflowFixture();
try {
	fixture.reset("debug");
	let state = buildWorkDebugState(process.cwd(), "BUG-1");
	assert(
		state.ok && state.selectedBead.id === "BUG-1",
		"explicit bug target is used",
	);
	assert(
		state.handoffPrompt.includes("Debug Bead: BUG-1"),
		"debug handoff names target",
	);

	fixture.reset("debug");
	state = buildWorkDebugState(process.cwd(), "IMP-2");
	assert(
		state.ok && state.selectedBead.id === "BUG-1",
		"debug-needed marker is followed",
	);

	fixture.reset("blocked");
	state = buildWorkDebugState(process.cwd(), "BLOCK-1");
	assert(
		state.ok && state.action === "debug-blocked" && !state.handoffPrompt,
		"blocked debug target stops without explicit retry guidance",
	);
	assert(
		state.suggestedCommands[0] === "/work-report BLOCK-1",
		"blocked debug target points to report handoff",
	);

	fixture.reset("blocked");
	state = buildWorkDebugState(process.cwd(), "BLOCK-1: device is available");
	assert(
		state.ok && state.selectedBead.id === "BLOCK-1",
		"explicit blocked target with guidance is debugged directly",
	);
	assert(
		state.handoffPrompt.includes("Guidance: device is available"),
		"blocked target guidance is preserved",
	);
	assert(
		fixture.logs().some(
			(entry) =>
				entry.op === "update" &&
				entry.id === "BLOCK-1" &&
				entry.status === "open",
		),
		"blocked target with retry guidance is reopened before handoff",
	);

	fixture.reset("blocked");
	state = buildWorkDebugState(process.cwd(), "1: device is available");
	assert(
		state.ok && state.selectedBead.id === "BLOCK-1",
		"numeric shorthand resolves to active epic child bead",
	);

	fixture.reset("blocked");
	state = buildWorkDebugState(process.cwd(), "1 device is available");
	assert(
		state.ok && state.selectedBead.id === "BLOCK-1",
		"numeric shorthand plus prose is treated as retry guidance, not a new bug",
	);
	assert(
		state.handoffPrompt.includes("Guidance: device is available"),
		"space-separated shorthand guidance is preserved",
	);

	fixture.reset("debug");
	state = buildWorkDebugState(process.cwd(), "IMP-1: rerun: npm test");
	assert(
		state.ok && state.selectedBead.id === "BUG-1",
		"existing debug dependency is reused",
	);
	assert(
		state.handoffPrompt.includes("Guidance: rerun: npm test"),
		"guidance after first colon is preserved",
	);
	assert(
		!fixture.logs().some((entry) => entry.op === "create"),
		"reuse path does not create duplicate bug",
	);

	fixture.reset("active");
	state = buildWorkDebugState(process.cwd(), "terminal hangs: inspect COM8");
	assert(
		state.ok && state.selectedBead.id.startsWith("BUG-NEW-"),
		"symptom-only request creates bug",
	);
	assert(
		state.selectedBead.title === "terminal hangs",
		"symptom title is preserved",
	);
	assert(
		state.handoffPrompt.includes("Guidance: inspect COM8"),
		"symptom guidance is preserved",
	);

	fixture.reset("ambiguous");
	state = buildWorkDebugState(process.cwd(), "ambiguous symptom");
	assert(
		!state.ok && state.reason === "ambiguous-target",
		"symptom-only ambiguous epic stops",
	);
	assert(fixture.logs().length === 0, "ambiguous debug does not create bug");

	fixture.reset("debug");
	state = buildWorkDebugState(process.cwd(), "NOPE-1");
	assert(
		!state.ok && state.reason === "unknown-target",
		"unknown Bead target stops",
	);

	fixture.reset("no-beads");
	state = buildWorkDebugState(process.cwd(), "broken thing");
	assert(
		!state.ok && state.reason === "beads-unavailable",
		"Beads failure is parseable",
	);
	assert(fixture.logs().length === 0, "Beads failure does not create bug");

	fixture.reset("active", "unknown");
	state = buildWorkDebugState(process.cwd(), "IMP-1");
	assert(
		!state.ok && state.reason === "dirty-stop",
		"dirty git stops debug handoff",
	);
} finally {
	fixture.cleanup();
}

console.log("ok - coded work-debug behavior");
