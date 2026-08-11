#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = realpathSync(path.join(import.meta.dirname, ".."));
const helperPath = path.join(root, "scripts", "work-helper.mjs");
const quotedHelper = JSON.stringify(helperPath);
const { directRoleHandoffParams } = await import(
	pathToFileURL(path.join(root, "extensions", "work-models.js")).href
);

function assertQuotedHelperCommands(text, expectedPath) {
	const commands = [
		...text.matchAll(
			/\bnode\s+(.+?work-helper\.mjs"?)(?=\s+[a-z][a-z0-9-]*(?:\s|$))/g,
		),
	];
	assert(commands.length > 0, "fixture must contain a helper command");
	for (const command of commands)
		assert.equal(
			command[1],
			JSON.stringify(expectedPath),
			`helper command is not absolute and shell-quoted: ${command[0]}`,
		);
}

const states = [
	{
		agent: "work-planner",
		state: {
			action: "run-planner",
			handoffPrompt: "planned",
			epic: { id: "work-1", title: "Roadmap" },
			selectedWorkItem: {
				id: "work-1.1",
				type: "task",
				status: "open",
				title: "Plan next slice",
			},
			git: { dirtyPaths: [] },
		},
	},
	{
		agent: "work-worker",
		state: {
			action: "run-implementation",
			handoffPrompt: "implement",
			selectedWorkItem: {
				id: "work-1.2",
				type: "task",
				status: "open",
				title: "Implement slice",
			},
			git: { dirtyPaths: [] },
		},
	},
];

for (const fixture of states) {
	const handoff = directRoleHandoffParams(fixture.state, root);
	assert.equal(handoff.agent, fixture.agent);
	assert(handoff.params.task.includes(`shell-quoted as ${quotedHelper}`));
	assertQuotedHelperCommands(handoff.params.task, helperPath);
}

const requiredContract =
	"exact supplied absolute path shell-quoted, especially on Windows";
for (const role of ["work-planner.md", "work-worker.md"]) {
	const contract = readFileSync(path.join(root, "agents", role), "utf8");
	assert(contract.includes(requiredContract), `${role} requires quoted helper paths`);
	assert(!/\bnode\s+"?(?:\.?[\\/])?scripts[\\/]work-helper\.mjs\b/.test(contract));
}

const workerContract = readFileSync(
	path.join(root, "agents", "work-worker.md"),
	"utf8",
);
assert.match(workerContract, /browser-driven web acceptance.*parent-owned finish gate/);
assert.match(workerContract, /Browser gate: pending parent/);
assert.match(workerContract, /do not contact the supervisor, create a blocker, or report verification failure/);

const windowsHelper = String.raw`C:\Program Files\ce workflow\scripts\work-helper.mjs`;
assertQuotedHelperCommands(
	`node ${JSON.stringify(windowsHelper)} work-summary work-1`,
	windowsHelper,
);
assert.throws(
	() =>
		assertQuotedHelperCommands(
			String.raw`node C:\Program Files\ce workflow\scripts\work-helper.mjs work-summary work-1`,
			windowsHelper,
		),
	/helper command is not absolute and shell-quoted/,
);

process.stdout.write("work helper handoff fixtures passed\n");
