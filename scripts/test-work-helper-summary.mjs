#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const { assert, installWorkflowFixture } = await import(
	pathToFileURL(
		realpathSync(path.join(import.meta.dirname, "work-command-fixture.mjs")),
	).href
);
const { createWorkItem, mutateStore } = await import(
	pathToFileURL(
		realpathSync(path.join(import.meta.dirname, "../extensions/work-store.js")),
	).href
);

const fixture = installWorkflowFixture({ native: true });
const helper = path.join(import.meta.dirname, "work-helper.mjs");
const run = (...args) => {
	const output = execFileSync(process.execPath, [helper, ...args], {
		cwd: fixture.cwd,
		encoding: "utf8",
	});
	try {
		return JSON.parse(output);
	} catch (error) {
		throw new Error(`Invalid helper JSON: ${output.slice(0, 200)}`, {
			cause: error,
		});
	}
};

try {
	fixture.reset("active");
	mutateStore(fixture.cwd, (store) => {
		for (let index = 0; index < 65; index += 1)
			createWorkItem(store, {
				parentId: "E-1",
				title: `Large child ${index}`,
				description: "x".repeat(4000),
				acceptance: "y".repeat(4000),
			});
	});

	const compact = run("work-children-summary", "E-1");
	assert(
		compact.length === 51 &&
			compact.at(-1).truncated === true &&
			compact.at(-1).total >= 65 &&
			compact.at(-1).shown === 50,
		"large child summaries are capped with explicit truncation metadata",
	);
	assert(
		JSON.stringify(compact).length < 12000 &&
			compact[0].description === undefined &&
			compact[0].dependencies,
		"default child summaries keep planning identity while bounding output",
	);

	const targeted = run("work-children-summary", "E-1", "--status", "closed");
	assert(
		targeted.length === 0,
		"status filtering provides targeted compact intake",
	);

	const full = run("work-children-summary", "E-1", "--full", "--limit", "1");
	assert(
		full.length === 2 &&
			full[0].description.length === 4000 &&
			full[1].truncated === true,
		"full detail remains an explicit bounded opt-in",
	);

	const epic = run("work-create", "Fresh roadmap", "--type", "epic");
	const state = JSON.parse(
		readFileSync(
			path.join(fixture.cwd, ".pi", "work-orchestrator-state.json"),
			"utf8",
		),
	);
	assert(
		state.lastEpicId === epic.id && state.lastEpicStatus === "open",
		"helper-created top-level epics become the current roadmap",
	);
} finally {
	fixture.cleanup();
}

console.log("ok - bounded work-helper child summaries");
