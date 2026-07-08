#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const mod = await import(
	pathToFileURL(
		realpathSync(
			path.join(import.meta.dirname, "../extensions/work-models.js"),
		),
	).href
);

assert.equal(mod.parseWorkGoalCommand("").kind, "status");
assert.deepEqual(mod.parseWorkGoalCommand("pause"), { kind: "pause" });
assert.deepEqual(mod.parseWorkGoalCommand("edit ship it"), {
	kind: "edit",
	objective: "ship it",
});
assert.deepEqual(mod.parseWorkGoalCommand("ship it"), {
	kind: "start",
	objective: "ship it",
});

const objective = mod.buildWorkSelfImprovingObjective("C:/soft/git/AI-Wedge", {
	project: true,
});
assert.match(objective, /Target project: C:\/soft\/git\/AI-Wedge/);
assert.match(objective, /Self-improving overlay/);
assert.match(objective, /fix this ce-workflow package in code/);
const oneTaskObjective = mod.buildWorkSelfImprovingObjective(
	"C:/soft/git/AI-Wedge one task only: fix login",
	{ project: true },
);
assert.match(oneTaskObjective, /Target project: C:\/soft\/git\/AI-Wedge/);
assert.match(
	oneTaskObjective,
	/User instruction for the target project: one task only: fix login/,
);
assert.match(oneTaskObjective, /Project autopilot policy/);
assert.match(
	oneTaskObjective,
	/if it says one task only, stop after one executable Bead closes/,
);
assert.deepEqual(
	mod.parseWorkProjectGoalInput("C:/soft/git/AI-Wedge task 19"),
	{
		project: "C:/soft/git/AI-Wedge",
		task: "task 19",
	},
);
assert.deepEqual(
	mod.parseWorkProjectGoalInput('"C:/soft/git/path with spaces" first blocker'),
	{ project: "C:/soft/git/path with spaces", task: "first blocker" },
);
assert.equal(mod.workWarpMode("generic"), "goal");
assert.equal(
	mod.workWarpMode("self-improving", { objective: "Project autopilot policy" }),
	"project",
);
assert.equal(mod.workWarpTitle("brainstorm", "C:/soft/git/demo"), "✦ - demo");
assert.deepEqual(
	mod.warpPayload(
		"prompt_submit",
		{ cwd: "C:/soft/git/demo", sessionManager: { getSessionId: () => "s1" } },
		{ query: "/work-plan" },
	),
	{
		v: 1,
		agent: "pi",
		event: "prompt_submit",
		session_id: "s1",
		cwd: "C:/soft/git/demo",
		project: "demo",
		query: "/work-plan",
	},
);

const prompt = mod.buildWorkGoalSystemPrompt({
	objective: "Do the thing",
	iteration: 0,
});
assert.match(prompt, /Do not stop for plan approval/);
assert.match(prompt, /work_goal_human_decision only when/);
assert.match(prompt, /WORK_GOAL_NEEDS_HUMAN_DECISION/);
assert.match(prompt, /work_goal_complete/);

const commands = {};
const tools = {};
const hooks = {};
mod.default({
	on: (name, handler) => {
		hooks[name] = handler;
	},
	registerCommand: (name, config) => {
		commands[name] = config;
	},
	registerTool: (tool) => {
		tools[tool.name] = tool;
	},
});
assert.ok(commands["work-goal"]);
assert.ok(commands["work-self-improving-goal"]);
assert.ok(commands["work-project-goal"]);
assert.ok(commands["work-project"]);
assert.ok(tools.work_goal_complete);
assert.ok(tools.work_goal_human_decision);
assert.equal(tools.work_goal_human_decision.parameters.required[0], "question");
assert.ok(hooks.before_agent_start);
assert.ok(hooks.agent_end);

const cwd = mkdtempSync(path.join(tmpdir(), "ce-work-goal-"));
try {
	execFileSync("git", ["init"], { cwd, stdio: "ignore" });
	const tempCommands = {};
	const tempHooks = {};
	const tempTools = {};
	const sent = [];
	const statuses = {};
	const notices = [];
	const entries = [];
	const pi = {
		on: (name, handler) => {
			tempHooks[name] = handler;
		},
		registerCommand: (name, config) => {
			tempCommands[name] = config;
		},
		registerTool: (tool) => {
			tempTools[tool.name] = tool;
		},
		appendEntry: (customType, data) => {
			entries.push({ type: "custom", customType, data });
		},
	};
	const ctx = {
		cwd,
		isIdle: () => false,
		hasPendingMessages: () => false,
		sendUserMessage: async (message, options) => {
			sent.push({ message, options });
		},
		compact: ({ onComplete }) => onComplete?.(),
		sessionManager: { getBranch: () => entries },
		ui: {
			notify: (message, level) => notices.push({ message, level }),
			setStatus: (key, value) => {
				statuses[key] = value;
			},
			confirm: async () => true,
		},
	};

	mod.default(pi);
	tempHooks.session_start?.({}, ctx);
	await tempCommands["work-goal"].handler("write temp proof file", ctx);
	assert.equal(sent.length, 1);
	assert.match(sent[0].message, /write temp proof file/);
	assert.equal(statuses["work-goal"], "active #0");

	const before = await tempHooks.before_agent_start(
		{ prompt: sent[0].message, systemPrompt: "base" },
		ctx,
	);
	assert.match(before.systemPrompt, /Active \/work-goal/);
	assert.match(before.systemPrompt, /work_goal_human_decision/);

	await tempHooks.agent_end(
		{
			messages: [
				{
					role: "assistant",
					content: [{ type: "text", text: "Made progress." }],
				},
			],
		},
		ctx,
	);
	assert.equal(sent.length, 2);
	assert.match(sent[1].message, /Automatic continuation #1/);
	assert.equal(statuses["work-goal"], "active #1");

	await tempHooks.before_agent_start(
		{ prompt: sent[1].message, systemPrompt: "base" },
		ctx,
	);
	await tempHooks.agent_end(
		{
			messages: [
				{
					role: "assistant",
					content: [
						{
							type: "text",
							text: "WORK_GOAL_NEEDS_HUMAN_DECISION: Which repo should I use?",
						},
					],
				},
			],
		},
		ctx,
	);
	assert.equal(statuses["work-goal"], "needs human");
	assert.ok(
		notices.some((notice) =>
			String(notice.message).includes("needs human decision"),
		),
	);
	assert.equal(sent.length, 2);

	tempHooks.input?.({ source: "user" }, ctx);
	await tempHooks.turn_end?.({}, ctx);
	assert.equal(statuses["work-goal"], "active #1");
	assert.equal(sent.length, 3);
	assert.match(sent[2].message, /human answered the pending decision/);

	await tempHooks.before_agent_start(
		{ prompt: sent[2].message, systemPrompt: "base" },
		ctx,
	);
	await tempTools.work_goal_complete.execute(
		"t1",
		{ summary: "verified in temp harness" },
		null,
		null,
		ctx,
	);
	assert.equal(statuses["work-goal"], undefined);

	await tempCommands["work-goal"].handler("format decision notice", ctx);
	await tempTools.work_goal_human_decision.execute(
		"t2",
		{
			question: "Pick one?",
			whyUserNeeded: "Only the user can choose.",
			options: "1. Approve. 2. Request changes.",
			recommendation: "Pick 1.",
		},
		null,
		null,
		ctx,
	);
	const decisionNotice = String(notices[notices.length - 1].message);
	assert.match(decisionNotice, /Question:\n {2}Pick one\?/);
	assert.match(
		decisionNotice,
		/Options:\n {2}1\. Approve\.\n {2}2\. Request changes\./,
	);
} finally {
	rmSync(cwd, { recursive: true, force: true });
}

console.log("ok - work-goal helpers");
