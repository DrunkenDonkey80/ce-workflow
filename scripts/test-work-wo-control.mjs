import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import workModelsExtension from "../extensions/work-models.ts";

const cwd = mkdtempSync(path.join(tmpdir(), "ce-work-wo-control-"));
const commands = {};
const hooks = {};
const shortcuts = {};
const tools = {};
const entries = [];
const sent = [];
const contextMessages = [];
const notices = [];
let aborts = 0;
let idle = true;
let compactOptions;
let reloads = 0;
let activeTools = [
	"ask_user",
	"work_goal_complete",
	"work_goal_human_decision",
];

const pi = {
	getActiveTools: () => activeTools,
	setActiveTools: (tools) => {
		activeTools = tools;
	},
	getThinkingLevel: () => "medium",
	setThinkingLevel: () => {},
	on: (name, handler) => {
		const previous = hooks[name];
		hooks[name] = name === "context" && previous
			? async (event, ctx) => {
				const result = await previous(event, ctx);
				return await handler(result ? { ...event, ...result } : event, ctx) ?? result;
			}
			: handler;
	},
	registerCommand: (name, config) => {
		commands[name] = config;
	},
	registerTool: (tool) => {
		tools[tool.name] = tool;
	},
	registerShortcut: (name, config) => {
		shortcuts[name] = config;
	},
	appendEntry: (customType, data) => {
		entries.push({ type: "custom", customType, data });
	},
	sendUserMessage: async (message, options) => {
		sent.push({ message, options });
	},
	sendMessage: (message, options) => {
		contextMessages.push({ message, options });
	},
};

workModelsExtension(pi);

const ctx = {
	cwd,
	mode: "tui",
	getContextUsage: () => ({ tokens: 25_000 }),
	isIdle: () => idle,
	hasPendingMessages: () => false,
	abort: () => {
		aborts += 1;
	},
	compact: (options) => {
		compactOptions = options;
	},
	reload: async () => {
		reloads += 1;
	},
	sessionManager: {
		getBranch: () => entries,
		getEntries: () => entries,
		getSessionId: () => "wo-control-test",
	},
	ui: {
		notify: (message, level) => notices.push({ message, level }),
		setStatus: () => {},
		setWidget: () => {},
	},
};

try {
	assert.deepEqual(
		commands.wo.getArgumentCompletions("").map(({ value }) => value),
		[
			"goal",
			"pause",
			"compact",
			"resume",
			"resume-work",
			"design",
			"redesign",
			"fact",
		],
	);

	mkdirSync(path.join(cwd, ".pi"), { recursive: true });
	writeFileSync(
		path.join(cwd, ".pi", "settings.json"),
		JSON.stringify({ workResume: { selfImproving: false }, workOrchestrator: { context: { mode: "ultracompact" } } }),
	);

	await commands.wo.handler("context-fill", ctx);
	assert.equal(contextMessages.length, 8);
	assert(
		contextMessages.every(
			({ message, options }) =>
				message.customType === "work-context-fill" &&
				message.display === false &&
				options === undefined,
		),
	);
	assert.equal(
		contextMessages.reduce(
			(total, { message }) => total + message.content.length,
			0,
		),
		" the".repeat(75_000).length,
	);
	assert.match(notices.at(-1).message, /75000 tokens/i);

	idle = false;
	await commands.wo.handler("pause", ctx);
	assert.match(notices.at(-1).message, /current LLM cycle finishes/i);
	assert.equal(aborts, 0, "pause lets the current LLM cycle finish");
	await hooks.turn_end({}, ctx);
	assert.equal(
		aborts,
		1,
		"pause aborts only after turn_end completes the current LLM cycle",
	);
	idle = true;
	await hooks.agent_settled({}, ctx);
	assert.match(notices.at(-1).message, /Job paused/i);
	await commands.wo.handler("resume", ctx);
	assert.match(sent.at(-1).message, /last completed LLM cycle/i);

	entries.push({
		type: "custom",
		customType: "goal-state",
		data: { goal: { id: "external-goal", status: "active" } },
	});
	await commands.wo.handler("pause", ctx);
	assert.equal(sent.at(-1).message, "/goal pause");
	entries.push({
		type: "custom",
		customType: "goal-state",
		data: { goal: { id: "external-goal", status: "paused" } },
	});
	await commands.wo.handler("resume", ctx);
	assert.equal(sent.at(-1).message, "/goal resume");
	entries.push({
		type: "custom",
		customType: "goal-state",
		data: { goal: null },
	});

	const beforeCompact = sent.length;
	idle = false;
	await shortcuts.f8.handler(ctx);
	assert.equal(
		compactOptions,
		undefined,
		"busy F8 does not start native compaction",
	);
	const filtered = await hooks.context(
		{
			messages: [
				...Array.from({ length: 5 }, (_, index) => ({
					role: "assistant",
					content: `old-${index} ${"x".repeat(30_000)}`,
				})),
				{ role: "user", content: "continue current work" },
			],
		},
		ctx,
	);
	assert.equal(filtered.messages[0].role, "compactionSummary");
	await hooks.turn_end({}, ctx);
	idle = true;
	await hooks.agent_settled({}, ctx);
	await new Promise((resolve) => setTimeout(resolve, 20));
	assert(compactOptions, "idle settlement persists the F8 context filter");
	compactOptions.onComplete();
	await hooks.session_compact({ compactionEntry: { details: {} } }, ctx);
	assert.equal(
		sent.length,
		beforeCompact,
		"F8 filtering needs no resume prompt",
	);

	compactOptions = null;
	await commands.wo.handler("compact", ctx);
	assert.ok(
		compactOptions,
		"/wo compact starts the same native compaction as F8",
	);

	await commands.wo.handler("goal pause only after proving the alias", ctx);
	assert.match(sent.at(-1).message, /pause only after proving the alias/i);
	entries.push({
		type: "custom",
		customType: "goal-state",
		data: { goal: { id: "parent-goal", status: "active" } },
	});
	idle = false;
	const beforeGracefulPause = aborts;
	const goalStateCount = entries.filter(
		(entry) => entry.customType === "work-goal-state",
	).length;
	assert.deepEqual(
		await hooks.input(
			{ source: "interactive", text: "pause", streamingBehavior: "steer" },
			ctx,
		),
		{ action: "handled" },
		"bare pause is consumed as control input instead of reaching the model",
	);
	assert.equal(
		aborts,
		beforeGracefulPause,
		"bare pause does not interrupt the current LLM cycle",
	);
	assert.equal(
		entries.filter((entry) => entry.customType === "work-goal-state").length,
		goalStateCount,
		"bare pause does not pause durably before the cycle boundary",
	);
	assert.match(notices.at(-1).message, /current LLM cycle finishes/i);
	await hooks.turn_end({}, ctx);
	assert.equal(
		aborts,
		beforeGracefulPause + 1,
		"bare pause stops before the next LLM cycle",
	);
	assert.equal(
		entries.filter((entry) => entry.customType === "work-goal-state").at(-1).data
			.goal.status,
		"paused",
		"bare pause durably pauses the /wo goal at the cycle boundary",
	);
	assert.deepEqual(sent.at(-1), {
		message: "/goal pause",
		options: { expandPromptTemplates: true, deliverAs: "steer" },
	});
	idle = true;
	await hooks.agent_settled({}, ctx);
	entries.push({
		type: "custom",
		customType: "goal-state",
		data: { goal: { id: "parent-goal", status: "paused" } },
	});
	const beforeGoalResume = sent.length;
	await commands.wo.handler("resume", ctx);
	assert.equal(
		sent.length,
		beforeGoalResume + 2,
		"resume restores both controllers",
	);
	assert.match(sent.at(-2).message, /Continue the active autonomous goal/i);
	assert.equal(sent.at(-1).message, "/goal resume");

	process.stdout.write("work /wo control tests passed\n");
} finally {
	rmSync(cwd, { recursive: true, force: true });
}
