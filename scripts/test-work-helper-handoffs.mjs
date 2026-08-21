#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = realpathSync(path.join(import.meta.dirname, ".."));
const helperPath = path.join(root, "scripts", "work-helper.mjs");
const { directRoleHandoffParams, shellQuote } = await import(
	pathToFileURL(path.join(root, "extensions", "work-models.js")).href
);
const quotedHelper = shellQuote(helperPath);

function assertQuotedHelperCommands(text, expectedPath) {
	let count = 0;
	for (const match of text.matchAll(/work-helper\.mjs/g)) {
		const lineStart = text.lastIndexOf("\n", match.index) + 1;
		const before = text.slice(lineStart, match.index);
		const nodeAt = before.lastIndexOf("node ");
		if (nodeAt < 0 || before.slice(nodeAt).includes("work-helper.mjs")) continue;
		count += 1;
		let end = match.index + match[0].length;
		if (/['"]/.test(text[end] ?? "")) end += 1;
		const commandPath = text.slice(lineStart + nodeAt + 5, end);
		assert.equal(
			commandPath,
			shellQuote(expectedPath),
			`helper command is not absolute and Bash-shell-quoted: ${text.slice(lineStart, end)}`,
		);
	}
	assert(count > 0, "fixture must contain a helper command");
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
	assert(handoff.params.task.includes(`POSIX shell as ${quotedHelper}`));
	assert(
		handoff.params.task.includes(
			`Claim exactly with: node ${quotedHelper} work-claim ${fixture.state.selectedWorkItem.id}`,
		),
		`${fixture.agent} claims its selected WorkItem before mutating it`,
	);
	assertQuotedHelperCommands(handoff.params.task, helperPath);
}

const requiredContract =
	"exact supplied absolute path quoted for the Bash tool's POSIX shell";
for (const role of ["work-planner.md", "work-worker.md"]) {
	const contract = readFileSync(path.join(root, "agents", role), "utf8");
	assert(
		contract.includes(requiredContract),
		`${role} requires quoted helper paths`,
	);
	assert(
		!/\bnode\s+"?(?:\.?[\\/])?scripts[\\/]work-helper\.mjs\b/.test(contract),
	);
}

const windowsHelper = String.raw`C:\Program Files\ce workflow\scripts\work-helper.mjs`;
assertQuotedHelperCommands(
	`node ${shellQuote(windowsHelper)} work-summary work-1`,
	windowsHelper,
);
assert.throws(
	() =>
		assertQuotedHelperCommands(
			String.raw`node C:\Program Files\ce workflow\scripts\work-helper.mjs work-summary work-1`,
			windowsHelper,
		),
	/helper command is not absolute and Bash-shell-quoted/,
);

process.stdout.write("work helper handoff fixtures passed\n");
