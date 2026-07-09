#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
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
assert.deepEqual(mod.parseWorkGoalCommand("--tokens 100k ship it"), {
	kind: "start",
	objective: "ship it",
	tokenBudget: 100000,
});
assert.deepEqual(mod.parseWorkGoalCommand("edit --tokens 1.5m ship it"), {
	kind: "edit",
	objective: "ship it",
	tokenBudget: 1500000,
});
assert.match(
	mod.parseWorkGoalCommand("edit --tokens nope ship it").error,
	/Invalid token budget/,
);
assert.equal(mod.parseTokenBudget("42"), 42);
assert.equal(mod.formatTokenCount(1500), "1.5k");
assert.equal(
	mod.isRetryableWorkGoalInterruption({
		stopReason: "error",
		errorMessage: "context length exceeded",
	}),
	true,
);
assert.equal(
	mod.isWorkGoalContextOverflow({
		errorMessage: "input exceeds the context window",
	}),
	true,
);
assert.equal(
	mod.isRetryableWorkGoalInterruption({
		stopReason: "error",
		errorMessage: "invalid api key",
	}),
	false,
);
assert.equal(
	mod.isWorkGoalUsageLimit({
		errorMessage:
			'429: {"code":"1308","message":"已达到 5 小时的使用上限。您的限额将在 2026-07-10 03:31:19 重置。"}',
	}),
	true,
);
assert.equal(mod.isWorkGoalUsageLimit({ errorMessage: "usage reached" }), true);
assert.equal(mod.isContradictoryWorkGoalCompletion("tests still fail"), true);

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
assert.equal(mod.workGoalHumanInputKind("2, but add this"), "answer");
assert.equal(mod.workGoalHumanInputKind("clarify: what changed?"), "clarify");
assert.equal(mod.workGoalHumanInputKind("What changed?"), "clarify");
assert.equal(
	mod.workWarpMode("self-improving", { objective: "Project autopilot policy" }),
	"project",
);
assert.equal(mod.workWarpTitle("brainstorm", "C:/soft/git/demo"), "✦ - demo");
assert.equal(mod.progressBar(3, 6), "[██████░░░░░░]");
assert.deepEqual(
	mod.extractImplementationUnits(
		`## Implementation Units\n\n### U1. First slice\n\n### U2. Second slice\n\n## Done`,
	),
	[
		{ key: "U1", title: "First slice" },
		{ key: "U2", title: "Second slice" },
	],
);
assert.equal(
	mod.renderProjectGoalProgress({
		title: "Epic",
		source: "plan",
		complete: 3,
		total: 6,
		unsliced: 2,
		failed: 1,
		blocked: 2,
		elapsedMs: 123_000,
	}),
	"Epic [██████░░░░░░] ✅ 3/6 units (3 left · 2 unsliced) 🔴 1 🟠 2 ⏱️ 2m 3s · F7 roadmaps · F8 menu",
);
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
assert.match(prompt, /ask the user to make that state available/);
assert.match(prompt, /WORK_GOAL_NEEDS_HUMAN_DECISION/);
assert.match(prompt, /work_goal_complete/);

const commands = {};
const tools = {};
const hooks = {};
const shortcuts = {};
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
	registerShortcut: (key, config) => {
		shortcuts[key] = config;
	},
});
assert.ok(commands["work-goal"]);
assert.ok(commands["work-resume"]);
assert.ok(commands["work-resume-stop"]);
assert.ok(commands["work-menu"]);
assert.ok(commands["work-goal-reset-continue"]);
assert.ok(shortcuts.f7);
assert.ok(shortcuts.f8);
assert.ok(!commands["work-self-improving-goal"]);
assert.ok(!commands["work-project-goal"]);
assert.ok(!commands["work-project"]);
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
		registerShortcut: () => {},
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
			setWidget: () => {},
			confirm: async () => true,
		},
	};

	mod.default(pi);
	tempHooks.session_start?.({}, ctx);
	assert.ok(
		notices.some((notice) =>
			String(notice.message).includes(
				"work-orchestrator loaded · F7 roadmaps · F8 menu",
			),
		),
	);
	await tempCommands["work-goal"].handler("write temp proof file", ctx);
	assert.equal(sent.length, 1);
	assert.match(sent[0].message, /write temp proof file/);
	assert.equal(statuses["work-goal"], "▶️ active #0");

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
	assert.equal(statuses["work-goal"], "▶️ active #1");

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
	assert.equal(statuses["work-goal"], "🟣❓ needs human");
	assert.ok(
		notices.some((notice) =>
			String(notice.message).includes("needs human decision"),
		),
	);
	assert.equal(sent.length, 2);

	const clarifyResult = await tempHooks.input?.(
		{ source: "user", text: "clarify: what screenshot is missing?" },
		ctx,
	);
	assert.equal(clarifyResult, undefined);
	assert.equal(statuses["work-goal"], "🟣❓ needs human");
	const pausedBefore = await tempHooks.before_agent_start(
		{ prompt: "clarify: what screenshot is missing?", systemPrompt: "base" },
		ctx,
	);
	assert.match(pausedBefore.systemPrompt, /Paused \/work-goal/);
	assert.match(
		pausedBefore.systemPrompt,
		/Answer the user's clarification only/,
	);

	const inputResult = await tempHooks.input?.(
		{
			source: "user",
			text: "2, but use the AI-Wedge connected proof and add a connect button.",
		},
		ctx,
	);
	assert.deepEqual(inputResult, { action: "handled" });
	assert.equal(statuses["work-goal"], "▶️ active #1");
	assert.equal(sent.length, 3);
	assert.match(sent[2].message, /Act on this answer immediately/);
	assert.match(sent[2].message, /perform an action, do that action first/);
	assert.match(sent[2].message, /add a connect button/);

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

	await tempCommands["work-resume"].handler("one task only", ctx);
	assert.match(sent.at(-1).message, /Project autopilot policy/);
	tempHooks.agent_start?.({}, ctx);
	assert.equal(statuses["work-goal"], "🔵 working #0");
	await tempCommands["work-resume-stop"].handler("after this phase", ctx);
	assert.equal(statuses["work-goal"], "🛑 stopping… #0");
	assert.match(sent.at(-1).message, /Clean stop requested/);
	const afterStopSent = sent.length;
	await tempCommands["work-resume"].handler("", ctx);
	assert.equal(statuses["work-goal"], "🔵 working #0");
	assert.equal(sent.length, afterStopSent);
	await tempCommands["work-resume-stop"].handler("after this phase", ctx);
	assert.equal(statuses["work-goal"], "🛑 stopping… #0");
	await tempHooks.agent_end(
		{
			messages: [
				{
					role: "assistant",
					content: [{ type: "text", text: "Closed one project Bead." }],
				},
			],
		},
		ctx,
	);
	assert.equal(statuses["work-goal"], "⏹️ stopped #0");
	assert.doesNotMatch(sent.at(-1).message, /^\/work-goal-reset-continue /);
	await tempCommands["work-resume"].handler("", ctx);
	assert.match(
		sent.at(-1).message,
		/Started in a fresh session|User resumed the goal/,
	);
	await tempCommands["work-goal"].handler("clear", ctx);

	mkdirSync(path.join(cwd, ".pi"), { recursive: true });
	writeFileSync(
		path.join(cwd, ".pi", "work-orchestrator-state.json"),
		JSON.stringify({
			workGoal: {
				id: "wg-restart",
				mode: "self-improving",
				objective: "resume after restart",
				status: "needs_human",
				iteration: 1,
				decision: { question: "Pick one?" },
			},
		}),
	);
	tempHooks.session_start?.({}, ctx);
	const restartedInput = await tempHooks.input?.(
		{ source: "user", text: "4, waive only disconnection screenshot" },
		ctx,
	);
	assert.deepEqual(restartedInput, { action: "handled" });
	assert.match(sent.at(-1).message, /waive only disconnection screenshot/);

	writeFileSync(
		path.join(cwd, ".pi", "work-orchestrator-state.json"),
		JSON.stringify({
			lastActions: {
				source: "test",
				updatedAt: new Date().toISOString(),
				actions: ["/work-status"],
			},
		}),
	);
	const noticeCount = notices.length;
	const numberedResult = await tempHooks.input?.(
		{ source: "user", text: "1, but show current status" },
		ctx,
	);
	assert.deepEqual(numberedResult, { action: "handled" });
	assert.ok(
		notices
			.slice(noticeCount)
			.some((notice) =>
				String(notice.message).includes("Running 1. /work-status"),
			),
		"numbered choice with trailing text runs the selected action",
	);

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

	const oldUsageDelay = process.env.WORK_GOAL_USAGE_LIMIT_RETRY_MS;
	process.env.WORK_GOAL_USAGE_LIMIT_RETRY_MS = "1";
	await tempCommands["work-goal"].handler("survive usage windows", ctx);
	const beforeUsageRetry = sent.length;
	await tempHooks.agent_end(
		{
			messages: [
				{
					role: "assistant",
					stopReason: "error",
					errorMessage:
						'429: {"code":"1308","message":"已达到 5 小时的使用上限。"}',
					content: [{ type: "text", text: "" }],
				},
			],
		},
		ctx,
	);
	assert.equal(statuses["work-goal"], "⏸️ usage wait #0");
	await new Promise((resolve) => setTimeout(resolve, 20));
	assert.equal(sent.length, beforeUsageRetry + 1);
	assert.match(sent.at(-1).message, /usage\/rate limit/);
	if (oldUsageDelay === undefined)
		delete process.env.WORK_GOAL_USAGE_LIMIT_RETRY_MS;
	else process.env.WORK_GOAL_USAGE_LIMIT_RETRY_MS = oldUsageDelay;
} finally {
	rmSync(path.join(cwd, ".git"), { recursive: true, force: true });
	rmSync(path.join(cwd, ".pi"), { recursive: true, force: true });
	try {
		rmSync(cwd, {
			recursive: true,
			force: true,
			maxRetries: 3,
			retryDelay: 100,
		});
	} catch {
		// Windows can hold the just-created temp repo directory briefly.
	}
}

console.log("ok - work-goal helpers");
