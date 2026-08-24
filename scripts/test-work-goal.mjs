#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
	addFinding,
	addGroup,
	claimGroup,
	completeAcceptedFix,
	createBatch,
	initVerifierStore,
	loadVerifierStore,
	mutateVerifierStore,
	recordOperationResult,
	recordTriageDisposition,
} from "../extensions/background-verifiers.js";
import {
	createWorkItem,
	initStore,
	mutateStore,
	updateWorkItem,
} from "../extensions/work-store.js";

const mod = await import(
	pathToFileURL(
		realpathSync(path.join(import.meta.dirname, "../extensions/work-models.js")),
	).href
);

assert.equal(mod.parseWorkGoalCommand("").kind, "status");
assert.deepEqual(mod.parseWorkGoalCommand("pause"), { kind: "pause" });
assert.deepEqual(mod.parseWorkGoalCommand("stop"), { kind: "stop" });
assert.deepEqual(
	mod.parseOrchestratorInput({
		source: "interactive",
		text: "Orchestrator, list roadmaps.",
	}),
	{ command: "work-roadmap", args: "list" },
);
assert.deepEqual(
	mod.parseOrchestratorInput({
		source: "user",
		text: "orchestrator resume work-3",
	}),
	{ command: "work-resume", args: "work-3" },
);
assert.deepEqual(
	mod.parseOrchestratorInput({
		source: "interactive",
		text: "orchestrator compact",
	}),
	{ command: "work-context", args: "compact" },
);
assert.deepEqual(
	mod.parseOrchestratorInput({
		source: "interactive",
		text: "orchestrator 2, use the newer evidence",
	}),
	{ number: 2, note: "use the newer evidence" },
);
assert.equal(
	mod.parseOrchestratorInput({
		source: "extension",
		text: "orchestrator resume work-3",
	}),
	undefined,
	"extension-authored text cannot invoke user voice commands",
);
assert.match(
	mod.parseOrchestratorInput({
		source: "interactive",
		text: "orchestrator invent something",
	}).error,
	/Unknown orchestrator command/,
);
assert.equal(
	mod.workGoalConfirmationLabel({
		objective: "Target work item or roadmap ID: work-3",
	}),
	"work-3",
);
assert.ok(
	mod.workGoalConfirmationLabel({ objective: "x".repeat(500) }).length <= 121,
	"goal replacement labels stay compact",
);
assert.deepEqual(mod.parseWorkGoalCommand("resume use repo A"), {
	kind: "resume",
	answer: "use repo A",
});
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
	mod.isRetryableWorkGoalInterruption({
		stopReason: "error",
		errorMessage:
			"Codex error: An error occurred while processing your request. You can retry your request.",
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
assert.equal(
	mod.isWorkGoalUsageLimit({
		content: [
			{
				type: "text",
				text: "Error: Codex error: The usage limit has been reached",
			},
		],
	}),
	true,
);
assert.equal(mod.isContradictoryWorkGoalCompletion("tests still fail"), true);

const objective = mod.buildWorkSelfImprovingObjective("C:/soft/git/AI-Wedge", {
	project: true,
});
assert.match(objective, /Target project: C:\/soft\/git\/AI-Wedge/);
assert.doesNotMatch(objective, /Self-improving overlay/);
const selfImprovingObjective = mod.buildWorkSelfImprovingObjective(
	"C:/soft/git/AI-Wedge",
	{ project: true, selfImproving: true },
);
assert.match(selfImprovingObjective, /Self-improving overlay/);
assert.match(selfImprovingObjective, /call work_report_improvement/);
assert.match(
	selfImprovingObjective,
	/do not modify the ce-workflow source from the producer project/,
);
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
assert.match(oneTaskObjective, /launch it async/);
assert.match(
	oneTaskObjective,
	/if it says one task only, stop after one executable WorkItem closes/,
);
const workItemObjective = mod.buildWorkSelfImprovingObjective(
	"C:/soft/git/AI-Wedge work-2",
	{ project: true },
);
assert.match(workItemObjective, /Target work item or roadmap ID: work-2/);
assert.match(
	workItemObjective,
	/Identifiers such as work-2 are targets, never task counts/,
);
assert.match(
	mod.buildWorkSelfImprovingObjective("C:/soft/git/AI-Wedge fix-login", {
		project: true,
	}),
	/User instruction for the target project: fix-login/,
);
const targetCwd = mkdtempSync(path.join(tmpdir(), "ce-work-goal-target-"));
try {
	initStore(targetCwd);
	mutateStore(targetCwd, (store) =>
		createWorkItem(store, {
			id: "work-2",
			type: "epic",
			title: "Target epic",
		}),
	);
	const targetGoal = {
		mode: "project",
		objective: mod.buildWorkSelfImprovingObjective(`${targetCwd} -- work-2`, {
			project: true,
		}),
	};
	assert.match(
		mod.workGoalCompletionBlocker(targetGoal, targetCwd),
		/target work-2 is still open/,
	);
	mutateStore(targetCwd, (store) =>
		updateWorkItem(store, "work-2", { status: "closed" }),
	);
	assert.equal(mod.workGoalCompletionBlocker(targetGoal, targetCwd), undefined);
} finally {
	rmSync(targetCwd, { recursive: true, force: true });
}

const baselineVerifierCwd = mkdtempSync(
	path.join(tmpdir(), "ce-work-goal-baseline-verifier-"),
);
try {
	initVerifierStore(baselineVerifierCwd);
	const baselineSnapshot = "2".repeat(40);
	const baselineBatch = mutateVerifierStore(baselineVerifierCwd, (store) =>
		createBatch(store, {
			checkpoint: {
				base: "1".repeat(40),
				snapshot: baselineSnapshot,
				patchHash: "3".repeat(64),
				paths: ["src/example.js"],
				repository: baselineVerifierCwd,
			},
			profiles: [
				{
					model: "openai/gpt-5",
					operations: ["correctness"],
					thinking: "high",
				},
			],
			now: "2026-08-09T08:35:00.000Z",
		}),
	);
	const baselineJob = Object.values(
		loadVerifierStore(baselineVerifierCwd).jobs,
	)[0];
	mutateVerifierStore(baselineVerifierCwd, (store) =>
		recordOperationResult(store, {
			jobId: baselineJob.id,
			operation: "correctness",
			outcome: "failed",
			failure: "prior goal provider failure",
		}),
	);
	const baselineGoal = {
		mode: "generic",
		objective: "unrelated next goal",
		startedAt: Date.parse("2026-08-09T08:34:00.000Z"),
		baselineHead: baselineSnapshot,
	};
	assert.equal(
		mod.workGoalCompletionBlocker(baselineGoal, baselineVerifierCwd),
		undefined,
		"the caller excludes a failed verifier batch for the persisted goal baseline",
	);
	assert.equal(
		mod.workGoalCompletionBlocker(
			{ ...baselineGoal, baselineHead: baselineBatch.checkpoint.base },
			baselineVerifierCwd,
		),
		undefined,
		"provider failures after the baseline remain visible without blocking completion",
	);
} finally {
	rmSync(baselineVerifierCwd, { recursive: true, force: true });
}

const legacyBaselineCwd = mkdtempSync(
	path.join(tmpdir(), "ce-work-goal-legacy-baseline-"),
);
try {
	execFileSync("git", ["init"], { cwd: legacyBaselineCwd, stdio: "ignore" });
	execFileSync("git", ["config", "user.name", "Test"], {
		cwd: legacyBaselineCwd,
	});
	execFileSync("git", ["config", "user.email", "test@example.com"], {
		cwd: legacyBaselineCwd,
	});
	writeFileSync(path.join(legacyBaselineCwd, "tracked.txt"), "before\n");
	execFileSync("git", ["add", "tracked.txt"], { cwd: legacyBaselineCwd });
	execFileSync("git", ["commit", "-m", "before"], {
		cwd: legacyBaselineCwd,
		env: {
			...process.env,
			GIT_AUTHOR_DATE: "2026-08-09T08:30:00Z",
			GIT_COMMITTER_DATE: "2026-08-09T08:30:00Z",
		},
	});
	const legacyBaseline = execFileSync("git", ["rev-parse", "HEAD"], {
		cwd: legacyBaselineCwd,
		encoding: "utf8",
	}).trim();
	writeFileSync(path.join(legacyBaselineCwd, "tracked.txt"), "after\n");
	execFileSync("git", ["commit", "-am", "after"], {
		cwd: legacyBaselineCwd,
		env: {
			...process.env,
			GIT_AUTHOR_DATE: "2026-08-09T08:40:00Z",
			GIT_COMMITTER_DATE: "2026-08-09T08:40:00Z",
		},
	});
	assert.equal(
		mod.workGoalBaselineHead(
			{ startedAt: Date.parse("2026-08-09T08:35:00Z") },
			legacyBaselineCwd,
		),
		legacyBaseline,
		"legacy goals derive the HEAD that existed when they started",
	);
	assert.equal(mod.workGoalBaselineHead({}, legacyBaselineCwd), undefined);
	assert.equal(
		mod.workGoalBaselineHead(
			{ startedAt: Date.parse("2026-08-09T08:35:00Z") },
			path.join(legacyBaselineCwd, "missing"),
		),
		undefined,
	);
} finally {
	rmSync(legacyBaselineCwd, { recursive: true, force: true });
}
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
const projectGoalProgress = mod.renderProjectGoalProgress({
	title: "Epic",
	source: "plan",
	complete: 3,
	total: 6,
	unsliced: 2,
	failed: 1,
	blocked: 2,
	elapsedMs: 123_000,
});
assert.equal(
	projectGoalProgress,
	"Roadmap [██████░░░░░░] 3/6 units (3 left · 2 unsliced) · 2m 3s · /wo Orchestrator · F8 microcompact · F9 Fleet",
);
assert.doesNotMatch(
	projectGoalProgress,
	/\p{Extended_Pictographic}/u,
	"project progress contains no emoji status glyphs",
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
assert.match(prompt, /native edit tool/);
assert.match(prompt, /Do not rewrite tracked files/);
assert.match(prompt, /Use ask_user for every question/);
assert.match(prompt, /allowComment=true for planning, product, and adoption/);
assert.match(prompt, /allowComment=false for destructive actions/);
assert.match(
	prompt,
	/use ask_user to ask the user to make that state available/,
);
assert.match(prompt, /work_goal_human_decision is only a durable fallback/);
assert.match(prompt, /WORK_GOAL_NEEDS_HUMAN_DECISION/);
assert.match(prompt, /work_goal_complete/);
assert.match(prompt, /After it succeeds, send one concise final response/);
assert.match(prompt, /launch it async/);
assert.match(
	prompt,
	/needsAttentionAfterMs=30000 is an attention notification, not a hard timeout/,
);
assert.match(prompt, /at least 10 minutes/);
assert.match(
	prompt,
	/do not handcraft a reviewer task when a coded handoff is available/,
);
assert.match(
	prompt,
	/waiting on contact_supervisor is not an implementation or review failure/,
);
assert.match(prompt, /intercom.*pending/);
assert.match(prompt, /terminal.*stale/);
assert.match(
	prompt,
	/stale.*do not reply, resume, append another verdict, or restart work/,
);
assert.match(prompt, /list-cwd only for operator peer discovery/);
assert.match(prompt, /exact session ID/);
assert.match(prompt, /action.*reply/);
assert.match(prompt, /replyTo.*message ID/);
assert.match(prompt, /Timeout is not cancellation/);
assert.match(prompt, /cancel only a known queued message ID/);
assert.match(prompt, /supersedes.*authored replacement/);
assert.match(prompt, /retryOf.*authored retry/);
assert.match(prompt, /never block the TUI on a foreground child/);

const commands = {};
const tools = {};
const hooks = {};
const shortcuts = {};
mod.default({
	getActiveTools: () => ["ask_user", "work_goal_human_decision"],
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
assert.deepEqual(
	Object.keys(commands).filter((name) => name.startsWith("work-")),
	[],
	"all user-facing work slash commands are removed",
);
assert.ok(commands["__orchestrator-goal-continue"]);
assert.ok(commands.wo);
assert.equal(commands.wf, undefined);
assert.match(commands.wo.description, /\/wo resume/);
assert.deepEqual(
	commands.wo.getArgumentCompletions("res")?.[0]?.value,
	"resume",
);
assert.match(shortcuts.f7.description, /orchestrator/i);
const openWorkflow = (ctx) => commands.wo.handler("", ctx);
assert.match(shortcuts.f8.description, /microcompact/i);
assert.match(shortcuts.f9.description, /fleet/i);
let fleetNotice;
await shortcuts.f9.handler({
	cwd: process.cwd(),
	mode: "print",
	ui: { notify: (message) => (fleetNotice = message) },
});
assert.ok(fleetNotice, "F9 opens the fleet view");
let orchestratorLabels = [];
await openWorkflow({
	cwd: process.cwd(),
	mode: "print",
	ui: {
		select: async (title, labels) => {
			assert.equal(title, "Orchestrator");
			orchestratorLabels = labels;
			return undefined;
		},
	},
});
assert.match(orchestratorLabels[0], /Roadmaps/);
let f7Title;
await shortcuts.f7.handler({
	cwd: process.cwd(),
	mode: "print",
	ui: {
		select: async (title) => {
			f7Title = title;
			return undefined;
		},
	},
});
assert.equal(f7Title, "Orchestrator", "F7 opens the same /wo menu");
for (const action of [
	"Roadmaps",
	"Status",
	"Resume work",
	"Autonomous goal",
	"Stop safely",
	"Initialize workspace",
	"Blocker report",
	"Ideas",
	"Research",
	"Brainstorm",
	"Plan",
	"Migrate work",
	"Migrate legacy workspace",
	"Checkpoint and pause",
	"Analyze",
	"Agent health",
	"Small task",
	"Medium task",
	"Large task",
	"Finish work item",
	"Debug",
	"Add work",
	"Auto-route task",
	"Telemetry",
	"Usage report",
	"Context guard",
	"Settings",
	"Catch up project",
	"Microcompact now",
])
	assert(
		orchestratorLabels.some((label) => label.includes(action)),
		action,
	);
assert(orchestratorLabels.every((label) => !label.includes("/work-")));
assert(
	orchestratorLabels.every((label) => !/\p{Extended_Pictographic}/u.test(label)),
	"/wo labels avoid ambiguous-width icons",
);
assert(orchestratorLabels.some((label) => label.includes("Roadmaps")));
assert(orchestratorLabels.some((label) => label.includes("Resume work")));
assert(orchestratorLabels.some((label) => label.includes("Context guard")));
const orchestratorRenders = [];
await openWorkflow({
	cwd: process.cwd(),
	mode: "tui",
	ui: {
		custom: async (factory) => {
			let closed = false;
			const component = factory(
				{ requestRender() {} },
				{ fg: (_color, text) => text, bold: (text) => text },
				{ matches: () => false },
				() => {
					closed = true;
				},
			);
			orchestratorRenders.push(component.render(90));
			component.handleInput("down");
			orchestratorRenders.push(component.render(90));
			for (const key of "settings") component.handleInput(key);
			orchestratorRenders.push(component.render(90));
			component.handleInput("escape");
			component.handleInput("escape");
			assert(closed);
		},
	},
});
assert(orchestratorRenders[0].some((line) => line.includes("Browse, inspect")));
assert(
	orchestratorRenders[0].some((line) => line.includes("last open roadmap")),
);
assert(orchestratorRenders[2].some((line) => line.includes("Settings")));
assert(
	orchestratorRenders.every((render) =>
		render.every((line) => !line.endsWith("\r")),
	),
	"/wo uses normal TUI rendering without overlay control-character padding",
);

const editorMarker = "Idea or prompt:\n";
const editorNotices = [];
const editorCtx = (session, draft = "") => {
	let editorText = draft;
	const widgetUpdates = [];
	return {
		cwd: process.cwd(),
		mode: "tui",
		sessionManager: { getSessionId: () => session },
		ui: {
			workDialogsNative: true,
			select: async (_title, labels) =>
				labels.find((label) => label.includes(editorCtx.selection)),
			input: async () => {
				throw new Error("main-editor actions must not open input");
			},
			editor: async () => {
				throw new Error("main-editor actions must not open editor");
			},
			getEditorText: () => editorText,
			setEditorText: (text) => {
				editorText = text;
			},
			setWidget: (key, value) => widgetUpdates.push({ key, value }),
			notify: (message, level) => editorNotices.push({ message, level }),
		},
		get editorText() {
			return editorText;
		},
		widgetUpdates,
	};
};
const routedEditorActions = [];
for (const [selection, action] of [
	["Research", "work-research"],
	["Brainstorm", "work-brainstorm"],
	["Plan", "work-plan"],
	["Small task", "work-small"],
	["Medium task", "work-med"],
	["Large task", "work-big"],
]) {
	editorCtx.selection = selection;
	const actionCtx = editorCtx(`editor-${action}`);
	await openWorkflow(actionCtx);
	assert.equal(actionCtx.editorText, editorMarker, `${action} exact marker`);
	const handled = await mod.consumePendingMainEditorAction(
		{ source: "interactive", text: `${editorMarker}  Build useful thing  ` },
		actionCtx,
		{
			execute: async (command, args, _ctx, options) =>
				routedEditorActions.push({
					command,
					args,
					...(options ? { options } : {}),
				}),
		},
	);
	assert.equal(handled?.action, "handled", `${action} consumes once`);
	assert(
		actionCtx.widgetUpdates.some(
			(update) =>
				update.key === "work-operation-progress" &&
				update.value?.[0] === `${selection}: starting…`,
		),
		`${action} shows native startup progress`,
	);
	assert.equal(
		actionCtx.widgetUpdates.at(-1)?.value,
		undefined,
		`${action} clears native startup progress`,
	);
	assert(
		editorNotices.some(({ message }) => message === `${selection} is starting.`),
		`${action} emits a native startup notice`,
	);
}
editorCtx.selection = "Brainstorm";
const preflightOrder = [];
const preflightEditorCtx = Object.assign(
	editorCtx("editor-brainstorm-preflight"),
	{
		model: { provider: "test", id: "control" },
		modelRegistry: {
			find: (provider, id) => ({ provider, id }),
			complete: async () => {
				preflightOrder.push("probe");
				return { stopReason: "stop", content: [{ type: "text", text: "HI" }] };
			},
		},
	},
);
const setPreflightEditorText = preflightEditorCtx.ui.setEditorText;
const setPreflightWidget = preflightEditorCtx.ui.setWidget;
preflightEditorCtx.ui.setEditorText = (text) => {
	preflightOrder.push("editor");
	setPreflightEditorText(text);
};
preflightEditorCtx.ui.setWidget = (key, value) => {
	if (key === "work-brainstorm-agent-health" && value)
		preflightOrder.push("progress");
	setPreflightWidget(key, value);
};
await openWorkflow(preflightEditorCtx);
assert.equal(preflightEditorCtx.editorText, editorMarker);
assert(
	preflightOrder.includes("progress") &&
		preflightOrder.includes("probe") &&
		preflightOrder.indexOf("editor") > preflightOrder.indexOf("probe"),
	"Brainstorm checks agents with live progress before opening the editor",
);
let preflightRoute;
await mod.consumePendingMainEditorAction(
	{ source: "interactive", text: `${editorMarker}Ready topic` },
	preflightEditorCtx,
	{
		execute: async (command, args, _ctx, options) => {
			preflightRoute = { command, args, options };
		},
	},
);
assert.equal(preflightRoute.command, "work-brainstorm");
assert.equal(preflightRoute.options.brainstormHealth.checked, true);

assert.deepEqual(
	routedEditorActions,
	[
		{ command: "work-research", args: "Build useful thing" },
		{
			command: "work-brainstorm",
			args: "Build useful thing",
			options: { explicitFreeform: true },
		},
		{ command: "work-plan", args: "Build useful thing" },
		{ command: "work-small", args: "Build useful thing" },
		{ command: "work-med", args: "Build useful thing" },
		{ command: "work-big", args: "Build useful thing" },
	],
	"all six main-editor actions route freeform input and only Brainstorm carries private freeform provenance",
);

editorCtx.selection = "Brainstorm";
const typoMarkerCtx = editorCtx("editor-brainstorm-typo-marker");
await openWorkflow(typoMarkerCtx);
let typoMarkerRoute;
await mod.consumePendingMainEditorAction(
	{ source: "interactive", text: "Idea or promt:\nKeep this brainstorm" },
	typoMarkerCtx,
	{
		execute: async (command, args, _ctx, options) => {
			typoMarkerRoute = { command, args, options };
		},
	},
);
assert.deepEqual(
	typoMarkerRoute,
	{
		command: "work-brainstorm",
		args: "Keep this brainstorm",
		options: { explicitFreeform: true },
	},
	"an armed Brainstorm tolerates the common visible prompt marker typo",
);

const clipboardPath =
	"C:\\Users\\Flex\\AppData\\Local\\Temp\\pi-clipboard-68605870-29c4-41f9-a1e9-5878ea4f214a.png";
const clipboardBody = `First line\nSecond line\n${clipboardPath}`;
editorCtx.selection = "Brainstorm";
const clipboardCtx = editorCtx("editor-brainstorm-clipboard");
await openWorkflow(clipboardCtx);
const clipboardRoutes = [];
await mod.consumePendingMainEditorAction(
	{ source: "interactive", text: `${editorMarker}${clipboardBody}` },
	clipboardCtx,
	{
		execute: async (command, args, _ctx, options) =>
			clipboardRoutes.push({ command, args, options }),
	},
);
assert.deepEqual(
	clipboardRoutes,
	[
		{
			command: "work-brainstorm",
			args: clipboardBody,
			options: { explicitFreeform: true },
		},
	],
	"Windows clipboard path routes once as private explicit freeform text",
);

const sourceImage = { type: "image", mimeType: "image/png", data: "cG5n" };
const imageCtx = editorCtx("editor-brainstorm-image");
await openWorkflow(imageCtx);
let materializedImages;
let imageRoute;
await mod.consumePendingMainEditorAction(
	{
		source: "interactive",
		text: `${editorMarker}${clipboardBody}`,
		images: [sourceImage],
	},
	imageCtx,
	{
		materializeTaskImages: (_cwd, images) => {
			materializedImages = images;
			return [
				{
					path: ".pi/work-artifacts/task-images/image.png",
					mimeType: "image/png",
					bytes: 3,
				},
			];
		},
		execute: async (command, args, _ctx, options) => {
			imageRoute = { command, args, options };
		},
	},
);
assert.equal(materializedImages[0], sourceImage);
assert.match(imageRoute.args, /C:\\Users\\Flex\\AppData/);
assert.match(
	imageRoute.args,
	/- \.pi\/work-artifacts\/task-images\/image\.png \(image\/png, 3 bytes\)/,
);
assert(
	!imageRoute.args.includes(sourceImage.data) &&
		!imageRoute.args.includes("data:"),
);
assert.deepEqual(imageRoute.options, { explicitFreeform: true });

const emptyImagesCtx = editorCtx("editor-brainstorm-empty-images");
await openWorkflow(emptyImagesCtx);
let emptyMaterializerCalls = 0;
let emptyRoutes = 0;
await mod.consumePendingMainEditorAction(
	{ source: "interactive", text: `${editorMarker}No image`, images: [] },
	emptyImagesCtx,
	{
		materializeTaskImages: () => emptyMaterializerCalls++,
		execute: async () => emptyRoutes++,
	},
);
assert.equal(emptyMaterializerCalls, 0, "empty images skip materialization");
assert.equal(emptyRoutes, 1, "empty images still route once");

const failedImageCtx = editorCtx("editor-brainstorm-failed-image");
await openWorkflow(failedImageCtx);
const failedSubmission = `${editorMarker}${clipboardBody}`;
let materializeAttempts = 0;
let failedImageRoutes = 0;
const retryRuntime = {
	materializeTaskImages: () => {
		if (++materializeAttempts === 1) throw new Error("disk full");
		return [
			{
				path: ".pi/work-artifacts/task-images/retry.png",
				mimeType: "image/png",
				bytes: 3,
			},
		];
	},
	execute: async () => failedImageRoutes++,
};
assert.equal(
	(
		await mod.consumePendingMainEditorAction(
			{ source: "interactive", text: failedSubmission, images: [sourceImage] },
			failedImageCtx,
			retryRuntime,
		)
	)?.action,
	"handled",
);
assert.equal(failedImageRoutes, 0, "materialization failure does not execute");
assert.equal(
	failedImageCtx.editorText,
	failedSubmission,
	"failure restores submission",
);
assert.match(editorNotices.at(-1).message, /Reattach the image and retry/);
await mod.consumePendingMainEditorAction(
	{ source: "interactive", text: failedSubmission, images: [sourceImage] },
	failedImageCtx,
	retryRuntime,
);
assert.equal(materializeAttempts, 2, "failed image submission remains armed");
assert.equal(failedImageRoutes, 1, "reattached image retries exactly once");

editorCtx.selection = "Plan";
const blankCtx = editorCtx("editor-blank");
await openWorkflow(blankCtx);
assert.equal(
	(
		await mod.consumePendingMainEditorAction(
			{ source: "interactive", text: editorMarker },
			blankCtx,
			{ execute: async () => assert.fail("blank must not route") },
		)
	)?.action,
	"handled",
);
assert.equal(blankCtx.editorText, editorMarker, "blank input restores marker");
assert.match(editorNotices.at(-1).message, /Add an idea or prompt/);
let blankRoutes = 0;
await mod.consumePendingMainEditorAction(
	{ source: "interactive", text: `${editorMarker}Now route` },
	blankCtx,
	{ execute: async () => blankRoutes++ },
);
assert.equal(blankRoutes, 1, "blank submission keeps pending action armed");

const mismatchCtx = editorCtx("editor-mismatch");
await openWorkflow(mismatchCtx);
assert.equal(
	await mod.consumePendingMainEditorAction(
		{ source: "interactive", text: "ordinary chat" },
		mismatchCtx,
		{ execute: async () => assert.fail("mismatch must not route") },
	),
	undefined,
);
assert.equal(
	await mod.consumePendingMainEditorAction(
		{ source: "interactive", text: `${editorMarker}late"` },
		mismatchCtx,
		{ execute: async () => assert.fail("mismatch must clear pending") },
	),
	undefined,
);

const staleCtx = editorCtx("editor-stale");
await openWorkflow(staleCtx);
assert.equal(
	await mod.consumePendingMainEditorAction(
		{ source: "interactive", text: `${editorMarker}stale` },
		staleCtx,
		{
			now: () => Date.now() + 31 * 60 * 1000,
			execute: async () => assert.fail("stale must not route"),
		},
	),
	undefined,
);

const sourceCtx = editorCtx("editor-sources");
await openWorkflow(sourceCtx);
for (const source of ["rpc", "extension"])
	assert.equal(
		await mod.consumePendingMainEditorAction(
			{ source, text: `${editorMarker}${source}` },
			sourceCtx,
			{ execute: async () => assert.fail(`${source} must not route`) },
		),
		undefined,
	);
let sourceRoutes = 0;
await mod.consumePendingMainEditorAction(
	{ source: "interactive", text: `${editorMarker}interactive` },
	sourceCtx,
	{ execute: async () => sourceRoutes++ },
);
assert.equal(sourceRoutes, 1, "RPC and extension inputs do not clear pending");

const draftCtx = editorCtx("editor-draft", "unrelated draft");
await openWorkflow(draftCtx);
assert.equal(
	draftCtx.editorText,
	"unrelated draft",
	"existing draft is preserved",
);
assert.match(editorNotices.at(-1).message, /already has a draft/);
assert.equal(
	await mod.consumePendingMainEditorAction(
		{ source: "interactive", text: `${editorMarker}must remain ordinary` },
		draftCtx,
		{ execute: async () => assert.fail("draft case must not arm") },
	),
	undefined,
);

const sessionCtx = editorCtx("editor-session-clear");
await openWorkflow(sessionCtx);
hooks.session_start(
	{},
	{
		...sessionCtx,
		mode: "print",
		sessionManager: {
			getSessionId: () => "editor-session-clear",
			getBranch: () => [],
		},
		ui: {
			...sessionCtx.ui,
			setStatus() {},
			setWidget() {},
		},
	},
);
assert.equal(
	await mod.consumePendingMainEditorAction(
		{ source: "interactive", text: `${editorMarker}after start` },
		sessionCtx,
		{ execute: async () => assert.fail("session start must clear pending") },
	),
	undefined,
);
sessionCtx.ui.setEditorText("");
await openWorkflow(sessionCtx);
await hooks.session_shutdown(
	{},
	{
		...sessionCtx,
		ui: { ...sessionCtx.ui, setStatus() {} },
	},
);
assert.equal(
	await mod.consumePendingMainEditorAction(
		{ source: "interactive", text: `${editorMarker}after shutdown` },
		sessionCtx,
		{ execute: async () => assert.fail("session shutdown must clear pending") },
	),
	undefined,
);

let resumePrompted = 0;
let resumeSelections = 0;
await openWorkflow({
	cwd: process.cwd(),
	mode: "tui",
	ui: {
		workDialogsNative: true,
		select: async (_title, labels) =>
			resumeSelections++ === 0
				? labels.find((label) => label.includes("Resume work"))
				: undefined,
		input: async () => {
			resumePrompted++;
			return null;
		},
	},
});
assert.equal(
	resumePrompted,
	1,
	"unrelated menu actions retain argument dialogs",
);
assert.equal(Object.keys(tools).length, 14);
const assertStrictSchema = (schema) => {
	if (!schema || typeof schema !== "object") return;
	if (schema.properties) {
		assert.deepEqual(schema.required, Object.keys(schema.properties));
		assert.equal(schema.additionalProperties, false);
		for (const property of Object.values(schema.properties))
			assertStrictSchema(property);
	}
	if (schema.items) assertStrictSchema(schema.items);
	for (const option of schema.anyOf ?? []) assertStrictSchema(option);
};
for (const tool of Object.values(tools)) {
	assert.deepEqual(tool.constrainedSampling, {
		type: "json_schema",
		strict: "prefer",
	});
	assertStrictSchema(tool.parameters);
}
assert.deepEqual(
	tools.work_verifier_read.parameters.properties.startLine.type,
	["integer", "null"],
);
assert.equal(
	tools.work_verifier_read.parameters.properties.path.type,
	"string",
);
assert.ok(tools.work_goal_complete);
assert.ok(tools.work_goal_human_decision);
assert.deepEqual(tools.work_goal_complete.parameters.properties.question.type, [
	"string",
	"null",
]);
assert.equal(
	tools.work_goal_human_decision.parameters.properties.question.type,
	"string",
);
assert.ok(hooks.before_agent_start);
assert.ok(hooks.agent_end);
assert.deepEqual(
	hooks.tool_call({ toolName: "work_goal_human_decision" }, { hasUI: true }),
	{
		block: true,
		terminate: true,
		reason:
			"Use ask_user for the interactive decision. work_goal_human_decision is only a non-interactive fallback.",
	},
);
assert.match(
	hooks.tool_call({ toolName: "work_goal_human_decision" }, { hasUI: false })
		?.reason ?? "",
	/Direct request mode/,
);
assert.ok(hooks.tool_result);

const cwd = mkdtempSync(path.join(tmpdir(), "ce-work-goal-"));
try {
	execFileSync("git", ["init"], { cwd, stdio: "ignore" });
	const tempCommands = {};
	const tempHooks = {};
	const tempTools = {};
	const tempShortcuts = {};
	const sent = [];
	const statuses = {};
	const notices = [];
	const entries = [];
	const compactions = [];
	const thinkingChanges = [];
	let thinkingLevel = "high";
	let aborts = 0;
	let activeTools = [
		"ask_user",
		"work_goal_complete",
		"work_goal_human_decision",
	];
	const pi = {
		getActiveTools: () => activeTools,
		setActiveTools: (next) => {
			activeTools = next;
		},
		getThinkingLevel: () => thinkingLevel,
		setThinkingLevel: (level) => {
			thinkingLevel = level;
			thinkingChanges.push(level);
		},
		on: (name, handler) => {
			tempHooks[name] = handler;
		},
		registerCommand: (name, config) => {
			tempCommands[name] = config;
		},
		registerTool: (tool) => {
			tempTools[tool.name] = tool;
		},
		registerShortcut: (key, config) => {
			tempShortcuts[key] = config;
		},
		appendEntry: (customType, data) => {
			entries.push({ type: "custom", customType, data });
		},
	};
	const verifierCwd = mkdtempSync(path.join(tmpdir(), "ce-work-verifier-"));
	try {
		execFileSync("git", ["init"], { cwd: verifierCwd, stdio: "ignore" });
		execFileSync("git", ["config", "user.name", "Test"], { cwd: verifierCwd });
		execFileSync("git", ["config", "user.email", "test@example.com"], {
			cwd: verifierCwd,
		});
		mkdirSync(path.join(verifierCwd, ".pi"), { recursive: true });
		writeFileSync(
			path.join(verifierCwd, ".pi", "settings.json"),
			JSON.stringify({
				workOrchestrator: {
					backgroundVerifiers: {
						"test/verifier": {
							operations: ["correctness"],
							thinking: "low",
						},
					},
				},
			}),
		);
		writeFileSync(path.join(verifierCwd, ".gitignore"), ".pi/\n.ce-workflow/\n");
		const quotedPath = "träcked.txt";
		writeFileSync(path.join(verifierCwd, quotedPath), "before\n");
		execFileSync("git", ["add", ".gitignore", quotedPath], {
			cwd: verifierCwd,
		});
		execFileSync("git", ["commit", "-m", "before"], { cwd: verifierCwd });
		const before = execFileSync("git", ["rev-parse", "HEAD"], {
			cwd: verifierCwd,
			encoding: "utf8",
		}).trim();
		writeFileSync(path.join(verifierCwd, quotedPath), "after\n");
		execFileSync("git", ["add", quotedPath], { cwd: verifierCwd });
		execFileSync("git", ["commit", "-m", "after"], { cwd: verifierCwd });
		const after = execFileSync("git", ["rev-parse", "HEAD"], {
			cwd: verifierCwd,
			encoding: "utf8",
		}).trim();
		const scheduled = mod.scheduleCommittedRunVerifiers(verifierCwd, pi, {
			before,
			after,
		});
		assert.equal(scheduled.status, "queued", scheduled.reason);
		await scheduled.launch;
		const [scheduledBatch] = Object.values(
			loadVerifierStore(verifierCwd).batches,
		);
		assert.deepEqual(scheduledBatch.checkpoint.paths, [quotedPath]);
		assert(
			existsSync(
				path.join(
					verifierCwd,
					".ce-workflow",
					"work-runs",
					"verifiers",
					"state.json",
				),
			),
			"normal committed agent runs schedule configured background verifiers",
		);
	} finally {
		rmSync(verifierCwd, { recursive: true, force: true });
	}
	const ctx = {
		cwd,
		isIdle: () => false,
		abort: () => {
			aborts += 1;
		},
		hasPendingMessages: () => false,
		sendUserMessage: async (message, options) => {
			sent.push({ message, options });
		},
		compact: (options) => {
			compactions.push(options);
			options.onComplete?.();
		},
		sessionManager: { getBranch: () => entries },
		ui: {
			select: async (_title, labels) =>
				labels.find((label) => /microcompact/i.test(label)),
			notify: (message, level) => notices.push({ message, level }),
			setStatus: (key, value) => {
				statuses[key] = value;
			},
			setWidget: () => {},
			confirm: async () => true,
		},
	};
	const settle = (target = ctx) =>
		tempHooks.agent_settled({}, { ...target, isIdle: () => true });

	mkdirSync(path.join(cwd, ".pi"), { recursive: true });
	writeFileSync(
		path.join(cwd, ".pi", "settings.json"),
		JSON.stringify({ workResume: { selfImproving: true } }),
	);
	const oldCatchUpOffline = process.env.WORK_CATCH_UP_OFFLINE;
	const oldPiCodingAgentDir = process.env.PI_CODING_AGENT_DIR;
	const oldAppData = process.env.APPDATA;
	const baseline = JSON.parse(
		readFileSync(
			path.join(import.meta.dirname, "../extensions/work-catch-up-baseline.json"),
			"utf8",
		),
	);
	const piCodingAgentDir = path.join(
		cwd,
		"pi-agent",
		"npm",
		"node_modules",
		"@earendil-works",
		"pi-coding-agent",
	);
	mkdirSync(piCodingAgentDir, { recursive: true });
	writeFileSync(
		path.join(piCodingAgentDir, "package.json"),
		JSON.stringify({
			version: baseline.packages.find(
				(pkg) => pkg.name === "@earendil-works/pi-coding-agent",
			).version,
		}),
	);
	process.env.WORK_CATCH_UP_OFFLINE = "1";
	process.env.APPDATA = path.join(cwd, "empty-appdata");
	process.env.PI_CODING_AGENT_DIR = path.join(cwd, "pi-agent");
	const catchUpState = mod.buildWorkCatchUpState(cwd);
	assert.equal(catchUpState.ok, true);
	assert.equal(catchUpState.packages.length, baseline.packages.length);
	const stableRelease = catchUpState.packages.find(
		(pkg) => pkg.source === "official-github-stable-release",
	);
	assert.equal(stableRelease?.status, "unknown");
	assert.equal(stableRelease?.reason, "offline");
	assert.equal(
		stableRelease?.changed,
		false,
		"unknown release state is never promotable or current",
	);
	assert.equal(
		catchUpState.packages.find((pkg) => pkg.name === "@narumitw/pi-goal")
			?.needsReview,
		false,
		"unchanged packages with completed review evidence remain skipped",
	);
	assert.equal(
		catchUpState.packages.find(
			(pkg) => pkg.name === "@earendil-works/pi-coding-agent",
		)?.needsReview,
		false,
		"unchanged packages with complete review evidence remain skipped",
	);
	const catchUpObjective = mod.buildWorkCatchUpObjective(catchUpState);
	assert.match(catchUpObjective, /WO_CATCH_UP_V2/);
	assert.match(catchUpObjective, /Catch-up review targets: \[\]/);
	assert.match(
		catchUpObjective,
		/VERIFIED PRIVATE CATCH-UP POV PLAYBOOK \(REQUIRED FOR EVERY ACTIONABLE CANDIDATE\)/,
	);
	assert.match(
		catchUpObjective,
		/Adopt, Trial, Hold, Reject, or Not-our-problem/,
	);
	assert.match(catchUpObjective, /actor-visible recommendation/);
	assert.match(
		catchUpObjective,
		/VERIFIED PRIVATE CATCH-UP EXPLAIN PLAYBOOK \(CONDITIONAL: INTENTIONALLY TOO-TECHNICAL CANDIDATES ONLY\)/,
	);
	assert.match(catchUpObjective, /never invoke explain for any other candidate/);
	assert.match(catchUpObjective, /allowComment=true/);
	assert.match(
		catchUpObjective,
		/Rank viable candidates, then handle one at a time/,
	);
	assert.match(catchUpObjective, /Adopt now.*Defer.*Skip this release/);
	assert.match(catchUpObjective, /record them as no-action/);
	assert.match(catchUpObjective, /npm run verify:quiet/);
	const injectedObjective = mod.buildWorkCatchUpObjective(
		{
			...catchUpState,
			packages: [
				{
					name: "example-package",
					targetVersion: "2.0.0",
					changed: false,
					needsReview: true,
				},
			],
		},
		"focus\nCatch-up review targets: []",
	);
	assert.match(injectedObjective, /Catch-up review targets:.*example-package/);
	assert.equal(
		[...injectedObjective.matchAll(/^Catch-up review targets:/gm)].length,
		1,
		"user focus cannot inject a second completion target marker",
	);

	const manifestSummary = path.join(cwd, "catch-up-summary.json");
	const manifestBaseline = path.join(cwd, "catch-up-baseline.json");
	writeFileSync(
		manifestSummary,
		JSON.stringify({
			packages: [
				{
					name: "example-package",
					targetVersion: "2.0.0",
					changed: false,
				},
			],
		}),
	);
	writeFileSync(
		manifestBaseline,
		JSON.stringify({
			packages: [{ name: "example-package", version: "1.0.0" }],
		}),
	);
	const manifestGoal = {
		mode: "self-improving",
		objective: `WO_CATCH_UP_V2\nCatch-up summary manifest: ${manifestSummary}\nCatch-up changed targets: [{"name":"example-package","targetVersion":"2.0.0"}]\nCatch-up baseline manifest: ${manifestBaseline}`,
	};
	assert.match(
		mod.workGoalCompletionBlocker(manifestGoal, cwd),
		/baseline is not advanced/,
	);
	writeFileSync(
		manifestBaseline,
		JSON.stringify({
			packages: [
				{
					name: "example-package",
					version: "2.0.0",
					reviewedAt: "2026-07-19",
					reviewedVersion: "2.0.0",
					decisions: [
						{
							version: "2.0.0",
							title: "Use the new API",
							pov: "Adopt",
							status: "adopted",
							rationale: "Removes compatibility code",
							verification: "focused test passed",
						},
						{
							version: "2.0.0",
							title: "Defer the larger migration",
							pov: "Trial",
							status: "deferred",
							rationale: "Needs a bounded follow-up",
							workItemId: "work-2",
						},
						{
							version: "2.0.0",
							title: "Skip optional polish",
							pov: "Hold",
							status: "skipped",
							rationale: "Actor skipped this release",
						},
						{
							version: "2.0.0",
							title: "Host-owned fix",
							pov: "Not-our-problem",
							status: "no-action",
							rationale: "Inherited without a local change",
						},
					],
				},
			],
		}),
	);
	assert.equal(mod.workGoalCompletionBlocker(manifestGoal, cwd), undefined);
	if (oldCatchUpOffline === undefined) delete process.env.WORK_CATCH_UP_OFFLINE;
	else process.env.WORK_CATCH_UP_OFFLINE = oldCatchUpOffline;
	if (oldPiCodingAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = oldPiCodingAgentDir;
	if (oldAppData === undefined) delete process.env.APPDATA;
	else process.env.APPDATA = oldAppData;

	mod.default(pi);
	const committedFixCwd = mkdtempSync(
		path.join(tmpdir(), "ce-work-goal-committed-fix-"),
	);
	try {
		execFileSync("git", ["init"], { cwd: committedFixCwd, stdio: "ignore" });
		execFileSync("git", ["config", "user.name", "Test"], {
			cwd: committedFixCwd,
		});
		execFileSync("git", ["config", "user.email", "test@example.com"], {
			cwd: committedFixCwd,
		});
		writeFileSync(path.join(committedFixCwd, ".gitignore"), ".ce-workflow/\n");
		writeFileSync(path.join(committedFixCwd, "fix.js"), "before\n");
		writeFileSync(path.join(committedFixCwd, "untouched.js"), "before\n");
		writeFileSync(path.join(committedFixCwd, "support.js"), "before\n");
		writeFileSync(path.join(committedFixCwd, "rename-source.js"), "move me\n");
		writeFileSync(path.join(committedFixCwd, "test-gap.js"), "production\n");
		writeFileSync(path.join(committedFixCwd, "dispose-source.js"), "current\n");
		writeFileSync(path.join(committedFixCwd, "relocated-source.js"), "before\n");
		execFileSync("git", ["add", "."], { cwd: committedFixCwd });
		execFileSync("git", ["commit", "-m", "checkpoint"], {
			cwd: committedFixCwd,
		});
		const checkpoint = execFileSync("git", ["rev-parse", "HEAD"], {
			cwd: committedFixCwd,
			encoding: "utf8",
		}).trim();
		initVerifierStore(committedFixCwd);
		const batch = mutateVerifierStore(committedFixCwd, (store) =>
			createBatch(store, {
				checkpoint: {
					repository: "committed-fix-test",
					base: "a".repeat(40),
					snapshot: checkpoint,
					paths: [
						"fix.js",
						"untouched.js",
						"support.js",
						"rename-source.js",
						"test-gap.js",
						"dispose-source.js",
						"relocated-source.js",
					],
					patchHash: "c".repeat(64),
				},
				profiles: [
					{
						model: "test/verifier",
						operations: ["correctness"],
						thinking: "low",
					},
				],
			}),
		);
		const job = Object.values(loadVerifierStore(committedFixCwd).jobs).find(
			(candidate) => candidate.batchId === batch.id,
		);
		const report = mutateVerifierStore(committedFixCwd, (store) =>
			recordOperationResult(store, {
				jobId: job.id,
				operation: "correctness",
				outcome: "findings",
			}),
		);
		const findings = [
			"fix.js",
			"untouched.js",
			"rename-source.js",
			"test-gap.js",
			"dispose-source.js",
			"relocated-source.js",
		].map((file) =>
			mutateVerifierStore(committedFixCwd, (store) =>
				addFinding(store, {
					reportId: report.id,
					operation: report.operation,
					model: report.model,
					checkpoint: report.checkpoint,
					path: file,
					startLine: 1,
					endLine: 1,
					category: "correctness",
					severity: "medium",
					rationale: "reproduced",
					evidence: "line 1",
					suggestedAction: "fix it",
				}),
			),
		);
		const ownerSession = "fix-session";
		const claims = findings.map((finding, index) => {
			const group = mutateVerifierStore(committedFixCwd, (store) =>
				addGroup(store, { findingIds: [finding.id] }),
			);
			const claim = mutateVerifierStore(committedFixCwd, (store) =>
				claimGroup(store, { groupId: group.id, ownerSession }),
			);
			if (index !== 4)
				mutateVerifierStore(committedFixCwd, (store) =>
					recordTriageDisposition(store, {
						claimId: claim.id,
						ownerSession,
						findingId: finding.id,
						disposition: "accepted",
						reason: "reproduced",
					}),
				);
			return claim;
		});
		writeFileSync(path.join(committedFixCwd, "fix.js"), "fixed\n");
		execFileSync("git", ["commit", "-am", "coded finish"], {
			cwd: committedFixCwd,
		});
		const committedHead = execFileSync("git", ["rev-parse", "HEAD"], {
			cwd: committedFixCwd,
			encoding: "utf8",
		}).trim();
		const fixResult = await tempTools.work_verifier_complete_fix.execute(
			"committed-fix",
			{
				claimId: claims[0].id,
				findingIds: [findings[0].id],
				verification: ["node focused-test"],
			},
			null,
			null,
			{
				...ctx,
				cwd: committedFixCwd,
				sessionManager: { getSessionId: () => ownerSession },
			},
		);
		assert.equal(fixResult.details.commit, committedHead);
		assert.equal(
			execFileSync("git", ["rev-parse", "HEAD"], {
				cwd: committedFixCwd,
				encoding: "utf8",
			}).trim(),
			committedHead,
			"clean reconciliation does not create or rewrite a commit",
		);
		await assert.rejects(
			tempTools.work_verifier_complete_fix.execute(
				"missing-committed-fix",
				{
					claimId: claims[1].id,
					findingIds: [findings[1].id],
					verification: ["node focused-test"],
				},
				null,
				null,
				{
					...ctx,
					cwd: committedFixCwd,
					sessionManager: { getSessionId: () => ownerSession },
				},
			),
			/no exact ancestor commit/,
		);
		writeFileSync(path.join(committedFixCwd, "untouched.js"), "fixed\n");
		writeFileSync(path.join(committedFixCwd, "support.js"), "support fix\n");
		const multiPathResult = await tempTools.work_verifier_complete_fix.execute(
			"multi-path-fix",
			{
				claimId: claims[1].id,
				findingIds: [findings[1].id],
				fixPaths: ["untouched.js", "support.js"],
				verification: ["node focused-test"],
			},
			null,
			null,
			{
				...ctx,
				cwd: committedFixCwd,
				sessionManager: { getSessionId: () => ownerSession },
			},
		);
		assert.deepEqual(
			execFileSync(
				"git",
				["show", "--pretty=", "--name-only", multiPathResult.details.commit],
				{
					cwd: committedFixCwd,
					encoding: "utf8",
				},
			)
				.trim()
				.split(/\r?\n/)
				.sort(),
			["support.js", "untouched.js"],
			"an explicit bounded fixPaths superset commits the exact cross-file fix",
		);
		execFileSync("git", ["config", "status.renames", "false"], {
			cwd: committedFixCwd,
		});
		renameSync(
			path.join(committedFixCwd, "rename-source.js"),
			path.join(committedFixCwd, "rename-destination.js"),
		);
		const renameResult = await tempTools.work_verifier_complete_fix.execute(
			"rename-fix",
			{
				claimId: claims[2].id,
				findingIds: [findings[2].id],
				fixPaths: ["rename-source.js", "rename-destination.js"],
				verification: ["node focused-test"],
			},
			null,
			null,
			{
				...ctx,
				cwd: committedFixCwd,
				sessionManager: { getSessionId: () => ownerSession },
			},
		);
		assert.match(
			execFileSync(
				"git",
				[
					"show",
					"--pretty=",
					"--name-status",
					"--find-renames",
					renameResult.details.commit,
				],
				{ cwd: committedFixCwd, encoding: "utf8" },
			).trim(),
			/^R\d+\s+rename-source\.js\s+rename-destination\.js$/,
			"an explicitly declared relocation authorizes both rename paths",
		);
		renameSync(
			path.join(committedFixCwd, "dispose-source.js"),
			path.join(committedFixCwd, "dispose-destination.js"),
		);
		execFileSync("git", ["add", "-A"], { cwd: committedFixCwd });
		execFileSync("git", ["commit", "-m", "relocate disposition target"], {
			cwd: committedFixCwd,
		});
		const disposeBytes = readFileSync(
			path.join(committedFixCwd, "dispose-destination.js"),
		);
		await assert.rejects(
			tempTools.work_verifier_dispose.execute(
				"renamed-disposition-bad-hash",
				{
					claimId: claims[4].id,
					findingId: findings[4].id,
					disposition: "stale",
					reason: "renamed target inspected",
					currentCode: {
						path: "dispose-destination.js",
						sha256: "0".repeat(64),
					},
				},
				null,
				null,
				{
					...ctx,
					cwd: committedFixCwd,
					sessionManager: { getSessionId: () => ownerSession },
				},
			),
			/Changed target requires matching current-code/,
		);
		await tempTools.work_verifier_dispose.execute(
			"renamed-disposition",
			{
				claimId: claims[4].id,
				findingId: findings[4].id,
				disposition: "stale",
				reason: "renamed target inspected",
				currentCode: {
					path: "dispose-destination.js",
					sha256: createHash("sha256").update(disposeBytes).digest("hex"),
				},
			},
			null,
			null,
			{
				...ctx,
				cwd: committedFixCwd,
				sessionManager: { getSessionId: () => ownerSession },
			},
		);
		renameSync(
			path.join(committedFixCwd, "relocated-source.js"),
			path.join(committedFixCwd, "relocated-destination.js"),
		);
		execFileSync("git", ["add", "-A"], { cwd: committedFixCwd });
		execFileSync("git", ["commit", "-m", "historical relocation"], {
			cwd: committedFixCwd,
		});
		writeFileSync(
			path.join(committedFixCwd, "relocated-destination.js"),
			"fixed after relocation\n",
		);
		const relocatedResult = await tempTools.work_verifier_complete_fix.execute(
			"relocated-fix",
			{
				claimId: claims[5].id,
				findingIds: [findings[5].id],
				fixPaths: ["relocated-destination.js"],
				verification: ["node focused-test"],
			},
			null,
			null,
			{
				...ctx,
				cwd: committedFixCwd,
				sessionManager: { getSessionId: () => ownerSession },
			},
		);
		assert.equal(
			execFileSync(
				"git",
				["show", "--pretty=", "--name-only", relocatedResult.details.commit],
				{ cwd: committedFixCwd, encoding: "utf8" },
			).trim(),
			"relocated-destination.js",
			"a Git-proven historical relocation may replace an obsolete finding path",
		);
		writeFileSync(path.join(committedFixCwd, "test-gap.js"), "changed\n");
		writeFileSync(path.join(committedFixCwd, "test-gap.test.js"), "covered\n");
		await assert.rejects(
			tempTools.work_verifier_complete_fix.execute(
				"changed-test-gap-fix",
				{
					claimId: claims[3].id,
					findingIds: [findings[3].id],
					fixPaths: ["test-gap.test.js"],
					verification: ["node focused-test"],
				},
				null,
				null,
				{
					...ctx,
					cwd: committedFixCwd,
					sessionManager: { getSessionId: () => ownerSession },
				},
			),
			/omitted accepted finding paths must remain unchanged/,
		);
		writeFileSync(path.join(committedFixCwd, "test-gap.js"), "production\n");
		const testOnlyResult = await tempTools.work_verifier_complete_fix.execute(
			"test-only-fix",
			{
				claimId: claims[3].id,
				findingIds: [findings[3].id],
				fixPaths: ["test-gap.test.js"],
				verification: ["node focused-test"],
			},
			null,
			null,
			{
				...ctx,
				cwd: committedFixCwd,
				sessionManager: { getSessionId: () => ownerSession },
			},
		);
		assert.equal(
			execFileSync(
				"git",
				["show", "--pretty=", "--name-only", testOnlyResult.details.commit],
				{ cwd: committedFixCwd, encoding: "utf8" },
			).trim(),
			"test-gap.test.js",
			"a test-only fix commits only the declared test path",
		);
	} finally {
		rmSync(committedFixCwd, { recursive: true, force: true });
	}
	const invoke = (name, args, commandCtx = ctx) =>
		mod.executeOrchestratorAction(name, args, commandCtx, pi);
	const staleHandoffCwd = mkdtempSync(
		path.join(tmpdir(), "ce-work-goal-stale-handoff-"),
	);
	mkdirSync(path.join(staleHandoffCwd, ".pi"), { recursive: true });
	writeFileSync(
		path.join(staleHandoffCwd, ".pi", "work-orchestrator-state.json"),
		JSON.stringify({
			workGoal: {
				id: "wg-stale-handoff",
				objective: "stay paused",
				status: "paused",
				updatedAt: 200,
			},
		}),
	);
	tempHooks.session_start?.(
		{},
		{
			...ctx,
			cwd: staleHandoffCwd,
			sessionManager: {
				getBranch: () => [
					{
						type: "custom",
						customType: "work-goal-state",
						data: {
							goal: {
								id: "wg-stale-handoff",
								objective: "stale active handoff",
								status: "active",
								resumeOnSessionStart: true,
								updatedAt: 100,
							},
						},
					},
				],
			},
		},
	);
	assert.equal(
		statuses["work-goal"],
		"paused",
		"newer durable pause overrides a stale active fresh-session handoff",
	);
	rmSync(staleHandoffCwd, { recursive: true, force: true });
	tempHooks.session_start?.({}, ctx);
	assert.ok(activeTools.includes("ask_user"));
	assert.ok(activeTools.includes("work_report_improvement"));
	assert.ok(!activeTools.includes("work_goal_complete"));
	assert.ok(
		!activeTools.includes("work_goal_human_decision"),
		"goal tools are hidden outside an active autonomous goal",
	);
	const automationResult = await tempHooks.input?.(
		{ source: "extension", text: "ORCHESTRATOR_RUN_V1 work-status" },
		ctx,
	);
	assert.deepEqual(automationResult, { action: "handled" });
	assert.deepEqual(
		Object.keys(tempCommands).filter((name) => name.startsWith("work-")),
		[],
	);
	assert.ok(
		notices.some((notice) =>
			String(notice.message).includes(
				"work-orchestrator loaded · /wo Orchestrator · F8 microcompact · F9 Fleet",
			),
		),
	);
	const ordinaryPolicy = await tempHooks.before_agent_start(
		{ prompt: "make a small code fix", systemPrompt: "base" },
		ctx,
	);
	assert.match(ordinaryPolicy.systemPrompt, /Direct request mode/);
	assert.match(
		ordinaryPolicy.systemPrompt,
		/Work directly in the current agent/,
	);
	assert.match(ordinaryPolicy.systemPrompt, /Do not invoke work_\* tools/);
	assert.match(ordinaryPolicy.systemPrompt, /smallest relevant check/);
	assert.doesNotMatch(ordinaryPolicy.systemPrompt, /Review cycle budget/);
	assert.match(
		(
			await tempHooks.tool_call(
				{ toolName: "subagent", input: { agent: "work-worker" } },
				ctx,
			)
		)?.reason ?? "",
		/Direct request mode/,
	);
	assert.match(
		(
			await tempHooks.tool_call(
				{
					toolName: "bash",
					input: { command: "node scripts/work-helper.mjs work-create test" },
				},
				ctx,
			)
		)?.reason ?? "",
		/Direct request mode/,
	);
	assert.equal(
		await tempHooks.tool_call(
			{ toolName: "edit", input: { path: "src/app.js" } },
			ctx,
		),
		undefined,
	);
	const repeatedPolicy = await tempHooks.before_agent_start(
		{ prompt: "continue", systemPrompt: ordinaryPolicy.systemPrompt },
		ctx,
	);
	assert.equal(
		repeatedPolicy.systemPrompt.match(/## Direct request mode/g)?.length,
		1,
		"direct-request policy is injected once",
	);
	const originalChildAgent = process.env.PI_SUBAGENT_CHILD_AGENT;
	try {
		process.env.PI_SUBAGENT_CHILD_AGENT = "work-background-verifier";
		const managedChildPolicy = await tempHooks.before_agent_start(
			{ prompt: "inspect the assigned checkpoint", systemPrompt: "base" },
			ctx,
		);
		assert.match(managedChildPolicy.systemPrompt, /Review cycle budget/);
		assert.doesNotMatch(managedChildPolicy.systemPrompt, /Direct request mode/);
		assert.equal(
			await tempHooks.tool_call(
				{ toolName: "work_verifier_list", input: { path: null } },
				ctx,
			),
			undefined,
			"managed work subagents retain their workflow tools",
		);
	} finally {
		if (originalChildAgent === undefined)
			delete process.env.PI_SUBAGENT_CHILD_AGENT;
		else process.env.PI_SUBAGENT_CHILD_AGENT = originalChildAgent;
	}
	await tempHooks.before_agent_start(
		{ prompt: "continue ordinary chat", systemPrompt: "base" },
		ctx,
	);

	await tempShortcuts.f8.handler({
		...ctx,
		isIdle: () => true,
		ui: {
			...ctx.ui,
			select: async () => {
				throw new Error("F8 must not open a menu");
			},
		},
	});
	assert.equal(compactions.length, 1, "idle F8 microcompacts immediately");
	assert.match(compactions[0].customInstructions, /on-demand microcompact/);
	const freeformCompaction = await tempHooks.session_before_compact(
		{
			reason: "overflow",
			preparation: {
				messagesToSummarize: [
					{ role: "user", content: "Keep this freeform task active." },
				],
				fileOps: { modifiedFiles: ["src\\freeform.js"] },
				firstKeptEntryId: "freeform-1",
				tokensBefore: 31_000,
			},
		},
		ctx,
	);
	assert.equal(freeformCompaction.compaction.details.profile, "freeform");
	assert.equal(freeformCompaction.compaction.details.triggerOwner, "native");
	assert.match(
		freeformCompaction.compaction.summary,
		/Keep this freeform task active/,
	);
	assert.match(freeformCompaction.compaction.summary, /src\/freeform\.js/);
	assert.doesNotMatch(freeformCompaction.compaction.summary, /\/work-resume/);
	await tempHooks.session_compact(
		{ compactionEntry: { details: freeformCompaction.compaction.details } },
		ctx,
	);
	compactions.length = 0;
	notices.length = 0;
	const abortsBeforeBusyCompact = aborts;
	await tempShortcuts.f8.handler(ctx);
	assert.equal(
		compactions.length,
		1,
		"busy F8 starts microcompaction at a safe interruption boundary",
	);
	assert.equal(
		aborts,
		abortsBeforeBusyCompact + 1,
		"busy F8 pauses the active turn so compaction cannot starve",
	);
	assert.ok(
		notices.some((notice) => String(notice.message).includes("Pausing")),
		"busy F8 reports the safe pause",
	);
	await tempHooks.turn_end(
		{},
		{ ...ctx, getContextUsage: () => ({ tokens: 1 }) },
	);
	assert.equal(
		compactions.length,
		1,
		"turn end does not duplicate the completed F8 request",
	);
	assert.equal(sent.length, 1, "queued F8 resumes work after compaction");
	assert.match(sent[0].message, /Continue from the compacted context/);
	assert.equal(sent[0].options?.deliverAs, "followUp");
	assert.ok(
		notices.some((notice) => String(notice.message).includes("resuming work")),
		"queued F8 reports automatic resumption",
	);
	sent.length = 0;
	await tempHooks.agent_settled({}, { ...ctx, isIdle: () => true });
	assert.equal(compactions.length, 1, "settling does not repeat the request");
	compactions.length = 0;

	const workflowClaim = (workflowId) =>
		path.join(
			cwd,
			".pi",
			"work-runs",
			"claims",
			`${createHash("sha256").update(workflowId).digest("hex")}.complete`,
		);
	initStore(cwd);
	mutateStore(cwd, (store) => {
		createWorkItem(store, {
			id: "work-7",
			type: "epic",
			title: "Compaction roadmap",
		});
		createWorkItem(store, {
			id: "work-7.1",
			parentId: "work-7",
			title: "Preserve workflow state",
			status: "in_progress",
			description: "Use the explicitly selected durable task.",
			acceptance: "Selected task acceptance survives compaction.",
			evidence: [{ closeEvidence: "focused durable evidence" }],
		});
		createWorkItem(store, {
			id: "work-7.2",
			parentId: "work-7",
			type: "decision",
			title: "Choose compaction rollout",
		});
		createWorkItem(store, {
			id: "work-8",
			type: "epic",
			title: "Unrelated roadmap",
		});
		createWorkItem(store, {
			id: "work-8.1",
			parentId: "work-8",
			title: "Unrelated in-progress task",
			status: "in_progress",
		});
	});
	const inlineWorkflowPrompt = `work-orchestrator inline execution
WO_INLINE_V1: complete this medium WorkItem
Workflow Run ID: wr-compact-resume
Activity: work-resume
mode: resume
Roadmap: work-7 Test roadmap
Selected WorkItem: work-7.1 Preserve workflow state`;
	await tempHooks.before_agent_start(
		{ prompt: inlineWorkflowPrompt, systemPrompt: "base" },
		ctx,
	);
	await tempHooks.agent_start({}, ctx);
	const workCompaction = await tempHooks.session_before_compact(
		{
			reason: "overflow",
			preparation: {
				messagesToSummarize: [
					{ role: "user", content: "Continue the selected workflow slice." },
				],
				fileOps: {},
				firstKeptEntryId: "work-1",
				tokensBefore: 90_000,
			},
		},
		ctx,
	);
	assert.equal(workCompaction.compaction.details.profile, "work-resume");
	assert.equal(workCompaction.compaction.details.triggerOwner, "native");
	assert.equal(
		workCompaction.compaction.details.workflowAuthorization?.marker,
		"work-orchestrator",
		"compaction metadata preserves managed-work authorization",
	);
	assert.equal(
		workCompaction.compaction.details.workflowAuthorization?.workflowRunId,
		"wr-compact-resume",
		"compaction metadata preserves workflow identity",
	);
	assert.equal(workCompaction.compaction.details.durableStateAvailable, true);
	assert.match(workCompaction.compaction.summary, /work-7\.1/);
	assert.match(
		workCompaction.compaction.summary,
		/Selected task acceptance survives compaction/,
	);
	assert.match(workCompaction.compaction.summary, /focused durable evidence/);
	assert.doesNotMatch(workCompaction.compaction.summary, /work-8\.1/);
	await tempHooks.session_compact(
		{ compactionEntry: { details: workCompaction.compaction.details } },
		ctx,
	);
	const compactResumePolicy = await tempHooks.before_agent_start(
		{
			prompt:
				"Compaction is complete. Resume the parent task now; background subagent results will arrive separately when ready.",
			systemPrompt: "base",
		},
		ctx,
	);
	assert.match(compactResumePolicy.systemPrompt, /Review cycle budget/);
	assert.doesNotMatch(compactResumePolicy.systemPrompt, /Direct request mode/);
	assert.equal(
		await tempHooks.tool_call(
			{
				toolName: "bash",
				input: { command: "node scripts/work-helper.mjs work-summary work-7.1" },
			},
			ctx,
		),
		undefined,
		"the runtime compaction-resume turn retains helper authorization",
	);
	const postCompactionOrdinaryPolicy = await tempHooks.before_agent_start(
		{ prompt: "explain the latest change", systemPrompt: "base" },
		ctx,
	);
	assert.match(postCompactionOrdinaryPolicy.systemPrompt, /Direct request mode/);
	assert.doesNotMatch(
		postCompactionOrdinaryPolicy.systemPrompt,
		/Review cycle budget/,
	);
	await tempHooks.before_agent_start(
		{ prompt: inlineWorkflowPrompt, systemPrompt: "base" },
		ctx,
	);
	await tempShortcuts.f8.handler(ctx);
	await tempHooks.turn_end(
		{},
		{ ...ctx, getContextUsage: () => ({ tokens: 1 }) },
	);
	assert.equal(compactions.length, 1, "queued F8 compacts inline work-resume");
	assert.equal(sent.length, 1, "inline work-resume continues after compaction");
	const resumedWorkflow = mod.parseWorkPromptMeta(sent[0].message);
	assert.ok(
		resumedWorkflow,
		"compaction continuation keeps work-orchestrator metadata",
	);
	assert.equal(resumedWorkflow.workflowRunId, "wr-compact-resume");
	assert.equal(resumedWorkflow.workItemId, "work-7.1");
	assert.equal(resumedWorkflow.inlineWork, true);
	await tempHooks.agent_end(
		{
			messages: [
				{
					role: "assistant",
					stopReason: "aborted",
					errorMessage: "Request aborted for manual compaction",
					content: [],
				},
			],
		},
		ctx,
	);
	const compactedWorkflowClaim = workflowClaim("wr-compact-resume");
	assert.equal(
		existsSync(compactedWorkflowClaim),
		false,
		"manual compaction does not fail the interrupted work-resume run",
	);
	await tempHooks.before_agent_start(
		{ prompt: sent[0].message, systemPrompt: "base" },
		ctx,
	);
	await tempHooks.agent_start({}, ctx);
	await tempHooks.agent_end(
		{
			messages: [
				{
					role: "assistant",
					content: [{ type: "text", text: "Finished after compaction." }],
				},
			],
		},
		ctx,
	);
	await settle();
	assert.equal(
		JSON.parse(readFileSync(compactedWorkflowClaim, "utf8")).outcome,
		"completed",
		"resumed work-resume keeps and completes the original workflow run",
	);
	sent.length = 0;
	compactions.length = 0;

	const nativeRetryId = "wr-native-provider-retry";
	const nativeRetryClaim = workflowClaim(nativeRetryId);
	await tempHooks.before_agent_start(
		{
			prompt: inlineWorkflowPrompt.replace("wr-compact-resume", nativeRetryId),
			systemPrompt: "base",
		},
		ctx,
	);
	await tempHooks.agent_start({}, ctx);
	await tempHooks.agent_end(
		{
			messages: [
				{
					role: "assistant",
					stopReason: "error",
					errorMessage:
						"Our servers are currently overloaded. Please try again later.",
					content: [],
				},
			],
		},
		ctx,
	);
	assert.equal(
		existsSync(nativeRetryClaim),
		false,
		"agent_end cannot fail work while Pi may still retry",
	);
	await tempHooks.agent_start({}, ctx);
	await tempHooks.agent_end(
		{
			messages: [
				{
					role: "assistant",
					content: [{ type: "text", text: "Recovered on Pi's native retry." }],
				},
			],
		},
		ctx,
	);
	assert.equal(
		existsSync(nativeRetryClaim),
		false,
		"workflow completion waits for agent_settled",
	);
	await settle();
	assert.equal(
		JSON.parse(readFileSync(nativeRetryClaim, "utf8")).outcome,
		"completed",
		"native provider retries remain one successful work-resume run",
	);

	const endWithOverflow = async (workflowId) => {
		await tempHooks.before_agent_start(
			{
				prompt: inlineWorkflowPrompt.replace("wr-compact-resume", workflowId),
				systemPrompt: "base",
			},
			ctx,
		);
		await tempHooks.agent_start({}, ctx);
		await tempHooks.agent_end(
			{
				messages: [
					{
						role: "assistant",
						stopReason: "error",
						errorMessage: "context_length_exceeded",
						content: [],
					},
				],
			},
			ctx,
		);
		return workflowClaim(workflowId);
	};

	const overflowClaim = await endWithOverflow("wr-overflow-resume");
	assert.equal(
		existsSync(overflowClaim),
		false,
		"overflow retry does not terminally fail the work-resume run",
	);
	await tempHooks.session_compact(
		{ willRetry: true, compactionEntry: { details: {} } },
		ctx,
	);
	await tempHooks.agent_start({}, ctx);
	await tempHooks.agent_end(
		{
			messages: [
				{
					role: "assistant",
					content: [{ type: "text", text: "Recovered after compaction." }],
				},
			],
		},
		ctx,
	);
	await settle();
	assert.equal(
		JSON.parse(readFileSync(overflowClaim, "utf8")).outcome,
		"completed",
		"overflow retry remains the same tracked work-resume run",
	);

	const declinedRetryClaim = await endWithOverflow("wr-overflow-no-retry");
	await tempHooks.session_compact(
		{ willRetry: false, compactionEntry: { details: {} } },
		ctx,
	);
	await settle();
	assert.equal(
		JSON.parse(readFileSync(declinedRetryClaim, "utf8")).outcome,
		"failed",
		"overflow without retry terminally fails the work-resume run",
	);

	const failedCompactionClaim = await endWithOverflow(
		"wr-overflow-compaction-failed",
	);
	await tempHooks.agent_settled({}, { ...ctx, isIdle: () => true });
	assert.equal(
		JSON.parse(readFileSync(failedCompactionClaim, "utf8")).outcome,
		"failed",
		"failed compaction terminally fails the work-resume run on settlement",
	);

	const contextMentionId = "wr-context-mention";
	const contextMentionClaim = workflowClaim(contextMentionId);
	await tempHooks.before_agent_start(
		{
			prompt: inlineWorkflowPrompt.replace("wr-compact-resume", contextMentionId),
			systemPrompt: "base",
		},
		ctx,
	);
	await tempHooks.agent_start({}, ctx);
	await tempHooks.agent_end(
		{
			messages: [
				{
					role: "assistant",
					content: [{ type: "text", text: "Documented context window behavior." }],
				},
			],
		},
		ctx,
	);
	await settle();
	assert.equal(
		JSON.parse(readFileSync(contextMentionClaim, "utf8")).outcome,
		"completed",
		"ordinary context-window text is not mistaken for an overflow retry",
	);

	const unavailableNoticeCount = notices.length;
	const unavailableCtx = { ...ctx, compact: undefined };
	await tempShortcuts.f8.handler(unavailableCtx);
	assert.ok(
		notices.some((notice) =>
			String(notice.message).includes("unavailable in this mode"),
		),
		"F8 reports unavailable compaction instead of queueing forever",
	);
	await tempHooks.agent_settled({}, { ...unavailableCtx, isIdle: () => true });
	assert.equal(
		notices.length,
		unavailableNoticeCount + 1,
		"unavailable F8 leaves no queued retry",
	);

	writeFileSync(
		path.join(cwd, ".pi", "settings.json"),
		JSON.stringify({
			workResume: { selfImproving: true },
			workOrchestrator: { context: { autoCompact: true } },
		}),
	);
	await tempShortcuts.f8.handler(ctx);
	await tempHooks.turn_end(
		{},
		{ ...ctx, getContextUsage: () => ({ tokens: 160_000 }) },
	);
	assert.equal(
		compactions.length,
		1,
		"queued F8 takes precedence over turn-end auto-compaction",
	);
	assert.match(compactions[0].customInstructions, /on-demand microcompact/);
	assert.equal(
		sent.length,
		1,
		"queued F8 still resumes when auto-compaction is enabled",
	);
	sent.length = 0;
	await tempHooks.agent_settled({}, { ...ctx, isIdle: () => true });
	assert.equal(compactions.length, 1, "fulfilled F8 request is not repeated");
	compactions.length = 0;
	writeFileSync(
		path.join(cwd, ".pi", "settings.json"),
		JSON.stringify({ workResume: { selfImproving: true } }),
	);
	const highUsageCtx = {
		...ctx,
		isIdle: () => true,
		getContextUsage: () => ({ tokens: 160_000 }),
	};
	await tempHooks.turn_end({}, highUsageCtx);
	assert.equal(
		compactions.length,
		0,
		"turn-end auto-compaction waits until the agent is settled",
	);
	await tempHooks.agent_settled({}, highUsageCtx);
	assert.equal(
		compactions.length,
		1,
		"settled auto-compaction is enabled by default",
	);
	assert.match(compactions[0].customInstructions, /on-demand microcompact/);
	compactions.length = 0;

	const oldCompactions = [];
	await tempShortcuts.f8.handler({
		...ctx,
		isIdle: () => true,
		compact: (options) => oldCompactions.push(options),
	});
	await tempHooks.session_shutdown({}, ctx);
	tempHooks.session_start?.({}, ctx);
	const newCompactions = [];
	const delayedCtx = {
		...ctx,
		isIdle: () => true,
		compact: (options) => newCompactions.push(options),
	};
	await tempShortcuts.f8.handler(delayedCtx);
	oldCompactions[0].onComplete?.();
	await tempShortcuts.f8.handler(delayedCtx);
	assert.equal(
		newCompactions.length,
		1,
		"a stale callback cannot clear the new session's in-flight compaction",
	);
	newCompactions[0].onComplete?.();

	writeFileSync(
		path.join(cwd, ".pi", "settings.json"),
		JSON.stringify({
			workResume: {
				selfImproving: true,
				goalThinkingLevel: "medium",
			},
			workOrchestrator: { context: { autoCompact: false } },
		}),
	);
	await invoke("work-goal", "write temp proof file", ctx);
	assert.equal(thinkingLevel, "medium");
	assert.equal(sent.length, 1);
	assert.match(sent[0].message, /write temp proof file/);
	assert.equal(statuses["work-goal"], "active #0");
	assert.ok(activeTools.includes("work_goal_complete"));
	assert.ok(activeTools.includes("work_goal_human_decision"));
	assert.doesNotMatch(
		statuses["work-goal"],
		/\p{Extended_Pictographic}/u,
		"workflow status contains no emoji",
	);

	await tempHooks.turn_end(
		{},
		{
			...ctx,
			getContextUsage: () => ({ tokens: 160_000 }),
		},
	);
	assert.equal(
		compactions.length,
		0,
		"active work goals honor the auto-compaction opt-out",
	);
	writeFileSync(
		path.join(cwd, ".pi", "settings.json"),
		JSON.stringify({
			workResume: {
				selfImproving: true,
				goalThinkingLevel: "medium",
			},
			workOrchestrator: { context: { autoCompact: true } },
		}),
	);
	await tempHooks.turn_end(
		{},
		{
			...ctx,
			getContextUsage: () => ({ tokens: 160_000 }),
		},
	);
	assert.equal(
		compactions.length,
		1,
		"active work goals compact at the configured threshold",
	);
	assert.match(compactions[0].customInstructions, /on-demand microcompact/);
	compactions.length = 0;

	const before = await tempHooks.before_agent_start(
		{ prompt: sent[0].message, systemPrompt: "base" },
		ctx,
	);
	assert.match(before.systemPrompt, /Active autonomous goal/);
	assert.match(before.systemPrompt, /Review cycle budget/);
	assert.doesNotMatch(before.systemPrompt, /Direct request mode/);
	assert.equal(
		await tempHooks.tool_call(
			{ toolName: "subagent", input: { agent: "work-worker" } },
			ctx,
		),
		undefined,
		"tagged workflow turns may use managed work roles",
	);
	assert.match(before.systemPrompt, /work_goal_human_decision/);
	await tempHooks.agent_start({}, ctx);

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
	await settle();
	assert.equal(compactions.length, 1, "work-goal compacts before continuing");
	assert.match(compactions[0].customInstructions, /work-goal microcompact/);
	assert.equal(sent.length, 2);
	assert.match(sent[1].message, /Automatic continuation #1/);
	assert.equal(statuses["work-goal"], "active #1");

	const nativeGoalCompaction = await tempHooks.session_before_compact(
		{
			reason: "overflow",
			preparation: {
				messagesToSummarize: [
					{ role: "user", content: "Continue the autonomous goal." },
				],
				fileOps: {},
				firstKeptEntryId: "goal-native-1",
				tokensBefore: 120_000,
			},
		},
		ctx,
	);
	assert.equal(
		nativeGoalCompaction.compaction.details.profile,
		"autonomous-goal",
	);
	assert.equal(nativeGoalCompaction.compaction.details.triggerOwner, "native");
	const sentBeforeGoalRecovery = sent.length;
	await tempHooks.session_compact(
		{
			compactionEntry: {
				details: {
					...nativeGoalCompaction.compaction.details,
					triggerOwner: "ce-workflow",
				},
			},
		},
		ctx,
	);
	assert.equal(
		sent.length,
		sentBeforeGoalRecovery,
		"ce-triggered compaction leaves continuation to its callback",
	);
	await tempHooks.turn_end(
		{},
		{ ...ctx, getContextUsage: () => ({ tokens: 160_000 }) },
	);
	assert.equal(
		compactions.length,
		1,
		"native compaction fences the overlapping ce-workflow threshold",
	);
	await tempHooks.session_compact(
		{ compactionEntry: { details: nativeGoalCompaction.compaction.details } },
		ctx,
	);
	assert.equal(
		sent.length,
		sentBeforeGoalRecovery + 1,
		"native compaction recovers exactly one pending continuation",
	);
	assert.equal(
		compactions.length,
		1,
		"native recovery reuses the completed compaction",
	);
	await tempHooks.session_compact(
		{ compactionEntry: { details: nativeGoalCompaction.compaction.details } },
		ctx,
	);
	assert.equal(
		sent.length,
		sentBeforeGoalRecovery + 1,
		"repeated native compact event cannot duplicate continuation",
	);
	const staleCompactionResumePolicy = await tempHooks.before_agent_start(
		{
			prompt:
				"Compaction is complete. Resume the parent task now; background subagent results will arrive separately when ready.",
			systemPrompt: "base",
		},
		ctx,
	);
	assert.match(
		staleCompactionResumePolicy.systemPrompt,
		/Direct request mode/,
		"stale compaction metadata cannot reauthorize a later resume prompt",
	);
	assert.doesNotMatch(
		staleCompactionResumePolicy.systemPrompt,
		/Review cycle budget/,
	);

	await tempHooks.session_before_compact(
		{
			reason: "threshold",
			preparation: {
				messagesToSummarize: [],
				fileOps: {},
				firstKeptEntryId: "abandoned-native",
				tokensBefore: 160_000,
			},
		},
		ctx,
	);
	const compactionsBeforeStaleRecovery = compactions.length;
	const abortsBeforeInFlightCompact = aborts;
	await tempShortcuts.f8.handler(ctx);
	assert.equal(
		aborts,
		abortsBeforeInFlightCompact + 1,
		"busy F8 releases an already-queued compaction by pausing the turn",
	);
	assert(
		notices.some((notice) => String(notice.message).includes("queued; pausing")),
	);
	const noticesBeforeStaleRecovery = notices.length;
	await tempShortcuts.f8.handler({ ...ctx, isIdle: () => true });
	assert.equal(
		compactions.length,
		compactionsBeforeStaleRecovery,
		"an unfinished native compaction initially fences F8",
	);
	assert.ok(
		notices
			.slice(noticesBeforeStaleRecovery)
			.some((notice) => String(notice.message).includes("already in progress")),
	);
	await tempHooks.turn_start({}, ctx);
	await tempShortcuts.f8.handler({ ...ctx, isIdle: () => true });
	assert.equal(
		compactions.length,
		compactionsBeforeStaleRecovery + 1,
		"a new turn releases an abandoned native compaction fence",
	);
	compactions.length = compactionsBeforeStaleRecovery;

	await tempHooks.before_agent_start(
		{ prompt: sent[2].message, systemPrompt: "base" },
		ctx,
	);
	await tempHooks.agent_start({}, ctx);
	const proactiveCompactionCtx = {
		...ctx,
		compact: (options) => compactions.push(options),
	};
	const abortsBeforeThreshold = aborts;
	await tempHooks.tool_execution_end(
		{
			toolCallId: "threshold-tool",
			toolName: "write",
			isError: false,
			result: "Successfully wrote evidence",
		},
		{ ...proactiveCompactionCtx, getContextUsage: () => ({ tokens: 160_000 }) },
	);
	assert.equal(
		compactions.length,
		2,
		"an active goal crossing the threshold compacts at the next tool boundary",
	);
	assert.equal(
		aborts,
		abortsBeforeThreshold + 1,
		"threshold compaction pauses the turn before context can keep growing",
	);
	assert.match(compactions[1].customInstructions, /on-demand microcompact/);
	assert.equal(
		await tempHooks.message_end(
			{
				message: {
					role: "assistant",
					stopReason: "aborted",
					errorMessage: "Provider socket closed",
					content: [],
				},
			},
			proactiveCompactionCtx,
		),
		undefined,
		"compaction does not hide unrelated abort errors",
	);
	const hiddenCompactionAbort = await tempHooks.message_end(
		{
			message: {
				role: "assistant",
				stopReason: "aborted",
				errorMessage: "This operation was aborted",
				content: [],
			},
		},
		proactiveCompactionCtx,
	);
	assert.deepEqual(hiddenCompactionAbort?.message, {
		role: "assistant",
		stopReason: "stop",
		content: [],
	});
	compactions[1].onComplete?.();
	await tempHooks.agent_end(
		{
			messages: [
				{
					role: "assistant",
					content: [{ type: "text", text: "Made more progress." }],
				},
			],
		},
		ctx,
	);
	await settle();
	assert.equal(
		compactions.length,
		2,
		"active-goal continuation reuses the completed F8 microcompact",
	);
	assert.equal(sent.length, 4, "active goal resumes after F8 microcompaction");
	assert.match(sent[3].message, /Automatic continuation #2/);
	assert.equal(statuses["work-goal"], "active #2");

	await tempHooks.before_agent_start(
		{ prompt: sent[3].message, systemPrompt: "base" },
		ctx,
	);
	await tempHooks.agent_start({}, ctx);
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
	await settle();
	assert.equal(statuses["work-goal"], "needs human");
	assert.ok(!activeTools.includes("work_goal_complete"));
	assert.ok(!activeTools.includes("work_goal_human_decision"));
	assert.equal(thinkingLevel, "high");
	assert.ok(
		notices.some((notice) =>
			String(notice.message).includes("needs human decision"),
		),
	);
	assert.equal(sent.length, 4);

	const clarifyResult = await tempHooks.input?.(
		{ source: "user", text: "clarify: what screenshot is missing?" },
		ctx,
	);
	assert.equal(clarifyResult, undefined);
	assert.equal(statuses["work-goal"], "needs human");
	const pausedBefore = await tempHooks.before_agent_start(
		{ prompt: "clarify: what screenshot is missing?", systemPrompt: "base" },
		ctx,
	);
	assert.match(pausedBefore.systemPrompt, /Paused autonomous goal/);
	assert.match(
		pausedBefore.systemPrompt,
		/Answer the user's clarification only/,
	);

	const conversationalResult = await tempHooks.input?.(
		{
			source: "user",
			text:
				"regarding com7, you made custom firmware that removed the blocker right",
		},
		ctx,
	);
	assert.equal(conversationalResult, undefined);
	assert.equal(statuses["work-goal"], "needs human");
	assert.equal(sent.length, 4);

	const answerInputResult = await tempHooks.input?.(
		{
			source: "user",
			text: "2, but use the AI-Wedge connected proof and add a connect button.",
		},
		ctx,
	);
	assert.equal(answerInputResult, undefined);
	assert.equal(statuses["work-goal"], "needs human");
	assert.equal(sent.length, 4);

	await tempCommands.wo.handler(
		"resume 2, but use the AI-Wedge connected proof and add a connect button.",
		ctx,
	);
	assert.equal(statuses["work-goal"], "active #2");
	assert.match(sent.at(-1).message, /Retry only abnormal, retryable failures/);
	assert.ok(activeTools.includes("work_goal_complete"));
	assert.ok(activeTools.includes("work_goal_human_decision"));
	assert.equal(thinkingLevel, "medium");

	const sentBeforeAskPause = sent.length;
	await tempHooks.tool_result(
		{
			toolName: "ask_user",
			isError: false,
			details: {
				question: "How should this blocked goal proceed?",
				response: {
					kind: "selection",
					selections: ["Pause as externally blocked"],
				},
				cancelled: false,
			},
		},
		ctx,
	);
	assert.equal(statuses["work-goal"], "paused");
	assert.equal(thinkingLevel, "high");
	await tempHooks.agent_end(
		{
			messages: [
				{
					role: "assistant",
					content: [{ type: "text", text: "Pause selected." }],
				},
			],
		},
		ctx,
	);
	await settle();
	assert.equal(
		sent.length,
		sentBeforeAskPause,
		"ask_user pause selection does not queue another continuation",
	);
	await invoke(
		"work-goal",
		"resume 2, but use the AI-Wedge connected proof and add a connect button.",
		ctx,
	);
	assert.equal(statuses["work-goal"], "active #2");
	await tempHooks.tool_result(
		{
			toolName: "ask_user",
			isError: false,
			details: {
				response: { kind: "selection", selections: ["Implement upstream"] },
				cancelled: false,
			},
		},
		ctx,
	);
	assert.equal(
		statuses["work-goal"],
		"active #2",
		"ordinary ask_user selections do not pause the goal",
	);
	assert.equal(sent.length, 6);
	assert.match(sent[5].message, /User resumed the goal with this answer/);
	assert.match(sent[5].message, /add a connect button/);

	await tempHooks.before_agent_start(
		{ prompt: sent[5].message, systemPrompt: "base" },
		ctx,
	);
	await tempHooks.agent_start({}, ctx);
	initVerifierStore(cwd);
	const completionBatch = mutateVerifierStore(cwd, (store) =>
		createBatch(store, {
			checkpoint: {
				repository: "goal-test",
				base: "a".repeat(40),
				snapshot: "b".repeat(40),
				paths: ["tracked.txt"],
				patchHash: "c".repeat(64),
			},
			profiles: [
				{
					model: "test/verifier",
					operations: ["correctness"],
					thinking: "low",
				},
			],
			now: new Date(Date.now() + 1_000).toISOString(),
		}),
	);
	const blockedCompletion = await tempTools.work_goal_complete.execute(
		"t-verifier-active",
		{ summary: "verification still running" },
		null,
		null,
		ctx,
	);
	assert.equal(blockedCompletion.completed, false);
	assert.match(blockedCompletion.content[0].text, /still queued or running/);
	assert.equal(statuses["work-goal"], "working #2");
	const completionJob = Object.values(loadVerifierStore(cwd).jobs).find(
		(job) => job.batchId === completionBatch.id,
	);
	const completionReport = mutateVerifierStore(cwd, (store) =>
		recordOperationResult(store, {
			jobId: completionJob.id,
			operation: "correctness",
			outcome: "findings",
		}),
	);
	const completionFinding = mutateVerifierStore(cwd, (store) =>
		addFinding(store, {
			reportId: completionReport.id,
			operation: completionReport.operation,
			model: completionReport.model,
			checkpoint: completionReport.checkpoint,
			path: "tracked.txt",
			startLine: 1,
			endLine: 1,
			category: "correctness",
			severity: "medium",
			rationale: "goal continuation must expose this finding",
			evidence: "line 1",
			suggestedAction: "triage it",
		}),
	);
	mutateVerifierStore(cwd, (store) =>
		addGroup(store, { findingIds: [completionFinding.id] }),
	);
	const awaitingTriage = await tempTools.work_goal_complete.execute(
		"t-verifier-triage",
		{ summary: "verification finding triaged" },
		null,
		null,
		ctx,
	);
	assert.match(awaitingTriage.content[0].text, /findings awaiting triage/);
	await tempHooks.agent_end(
		{
			messages: [
				{
					role: "assistant",
					content: [{ type: "text", text: "Verifier triage remains." }],
				},
			],
		},
		ctx,
	);
	await settle();
	assert.match(
		sent.at(-1).message,
		/Verifier triage is mandatory/,
		"automatic continuation includes the claimed verifier handoff",
	);
	await tempHooks.before_agent_start(
		{ prompt: sent.at(-1).message, systemPrompt: "base" },
		ctx,
	);
	await tempHooks.agent_start({}, ctx);
	const verifierInbox = await tempTools.work_verifier_inbox.execute(
		"goal-verifier-inbox",
		{},
		null,
		null,
		ctx,
	);
	assert.equal(
		verifierInbox.details.claims[0].findings[0].id,
		completionFinding.id,
		"automatic continuation claims completed verifier findings before prompting",
	);
	mutateVerifierStore(cwd, (store) =>
		recordTriageDisposition(store, {
			claimId: verifierInbox.details.claims[0].claim.id,
			ownerSession: `process-${process.pid}`,
			findingId: completionFinding.id,
			disposition: "accepted",
			reason: "goal continuation claim path verified",
		}),
	);
	await tempHooks.agent_end(
		{
			messages: [
				{
					role: "assistant",
					content: [{ type: "text", text: "Accepted verifier fix remains." }],
				},
			],
		},
		ctx,
	);
	await settle();
	assert.match(
		sent.at(-1).message,
		/already accepted; fix completion pending/,
		"accepted findings resume as fix work rather than fresh triage",
	);
	mutateVerifierStore(cwd, (store) =>
		completeAcceptedFix(store, {
			claimId: verifierInbox.details.claims[0].claim.id,
			ownerSession: `process-${process.pid}`,
			findingIds: [completionFinding.id],
			commit: "d".repeat(40),
			verification: ["fixture verification"],
		}),
	);
	const completionResult = await tempTools.work_goal_complete.execute(
		"t1",
		{ summary: "verified in temp harness" },
		null,
		null,
		ctx,
	);
	assert.equal(completionResult.terminate, undefined);
	assert.match(
		completionResult.content[0].text,
		/Now give the user a concise final summary/,
	);
	assert.equal(statuses["work-goal"], undefined);
	assert.ok(!activeTools.includes("work_goal_complete"));
	assert.ok(!activeTools.includes("work_goal_human_decision"));
	assert.equal(thinkingLevel, "high");
	assert.deepEqual(thinkingChanges.slice(0, 4), [
		"medium",
		"high",
		"medium",
		"high",
	]);

	// Compaction continuation matrix. A 30k threshold exercises the same hooks as
	// production without spending model tokens in a nested Pi process.
	writeFileSync(
		path.join(cwd, ".pi", "settings.json"),
		JSON.stringify({
			workResume: {
				selfImproving: true,
				goalThinkingLevel: "medium",
			},
			workOrchestrator: {
				context: { autoCompact: true, compactAtTokens: 30_000 },
			},
		}),
	);
	const queuedCallbackCompactions = [];
	const queuedCallbackSent = sent.length;
	const queuedCallbackCtx = {
		...ctx,
		compact: (options) => queuedCallbackCompactions.push(options),
	};
	await tempShortcuts.f8.handler(queuedCallbackCtx);
	await tempHooks.turn_end(
		{},
		{ ...queuedCallbackCtx, getContextUsage: () => ({ tokens: 1 }) },
	);
	assert.equal(queuedCallbackCompactions.length, 1);
	queuedCallbackCompactions[0].onError?.(new Error("operation aborted"));
	queuedCallbackCompactions[0].onComplete?.();
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(
		sent.length,
		queuedCallbackSent + 1,
		"ordinary queued compaction resumes once across duplicate callbacks",
	);

	const directLifecycleCompactions = [];
	const directLifecycleSent = sent.length;
	const directLifecycleCtx = {
		...ctx,
		isIdle: () => true,
		getContextUsage: () => ({ tokens: 33_000 }),
		compact: (options) => directLifecycleCompactions.push(options),
	};
	const directLifecycleRun = mod.handleWorkflowAction(
		() => ({
			ok: true,
			reason: "ready",
			action: "implement",
			inlineWork: true,
			inlineLevel: "medium",
			epic: { id: "work-7" },
			selectedWorkItem: { id: "work-7.1" },
			handoffPrompt: inlineWorkflowPrompt.replace(
				"wr-compact-resume",
				"wr-direct-threshold",
			),
		}),
		"",
		directLifecycleCtx,
		pi,
	);
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(
		directLifecycleCompactions.length,
		1,
		"direct work compacts once before a high-context handoff",
	);
	assert.equal(
		sent.length,
		directLifecycleSent,
		"direct work waits for compaction before dispatch",
	);
	directLifecycleCompactions[0].onComplete?.();
	directLifecycleCompactions[0].onError?.(new Error("late duplicate callback"));
	await directLifecycleRun;
	assert.equal(
		sent.length,
		directLifecycleSent + 1,
		"direct work dispatches exactly once after compaction",
	);

	const finishedLifecycleCompactions = [];
	const finishedLifecycleSent = sent.length;
	const finishedPrompt = inlineWorkflowPrompt.replace(
		"wr-compact-resume",
		"wr-finished-threshold",
	);
	await tempHooks.before_agent_start(
		{ prompt: finishedPrompt, systemPrompt: "base" },
		ctx,
	);
	await tempHooks.agent_start({}, ctx);
	await tempHooks.agent_end(
		{
			messages: [
				{
					role: "assistant",
					content: [{ type: "text", text: "Direct task finished." }],
				},
			],
		},
		ctx,
	);
	const finishedLifecycleCtx = {
		...ctx,
		isIdle: () => true,
		getContextUsage: () => ({ tokens: 30_001 }),
		compact: (options) => finishedLifecycleCompactions.push(options),
	};
	await tempHooks.agent_settled({}, finishedLifecycleCtx);
	assert.equal(
		finishedLifecycleCompactions.length,
		1,
		"finished direct work still performs one threshold compaction",
	);
	finishedLifecycleCompactions[0].onComplete?.();
	finishedLifecycleCompactions[0].onError?.(
		new Error("late duplicate callback"),
	);
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(
		sent.length,
		finishedLifecycleSent,
		"finished direct work does not invent another turn",
	);

	const beforeProjectGoal = sent.length;
	await invoke("work-goal", "exercise work-resume phase compaction", ctx);
	assert.equal(
		sent.length,
		beforeProjectGoal + 1,
		"autonomous work starts its goal turn",
	);
	const projectGoalPrompt = sent.at(-1).message;
	await tempHooks.before_agent_start(
		{ prompt: projectGoalPrompt, systemPrompt: "base" },
		ctx,
	);
	await tempHooks.agent_start({}, ctx);
	const projectGoalCompactions = [];
	const projectGoalSent = sent.length;
	const projectGoalCtx = {
		...ctx,
		isIdle: () => false,
		getContextUsage: () => ({ tokens: 30_001 }),
		compact: (options) => projectGoalCompactions.push(options),
	};
	await tempHooks.turn_end({}, projectGoalCtx);
	assert.equal(
		projectGoalCompactions.length,
		1,
		"goal threshold and phase boundary share one compaction",
	);
	await tempHooks.agent_end(
		{
			messages: [
				{
					role: "assistant",
					stopReason: "error",
					errorMessage: "This operation was aborted",
					content: [],
				},
			],
		},
		projectGoalCtx,
	);
	await tempHooks.agent_settled({}, { ...projectGoalCtx, isIdle: () => true });
	assert.equal(
		sent.length,
		projectGoalSent,
		"goal continuation waits for the in-flight compaction callback",
	);
	projectGoalCompactions[0].onError?.(new Error("This operation was aborted"));
	projectGoalCompactions[0].onComplete?.();
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(
		projectGoalCompactions.length,
		1,
		"aborted and completed callbacks cannot launch a second compaction",
	);
	assert.equal(
		sent.length,
		projectGoalSent + 1,
		"goal work continues exactly once after the winning callback",
	);
	assert.match(sent.at(-1).message, /Automatic continuation/);

	const ceOwnedPrompt = sent.at(-1).message;
	await tempHooks.before_agent_start(
		{ prompt: ceOwnedPrompt, systemPrompt: "base" },
		ctx,
	);
	await tempHooks.agent_start({}, ctx);
	await tempHooks.agent_end(
		{
			messages: [
				{
					role: "assistant",
					content: [{ type: "text", text: "Completed the next phase." }],
				},
			],
		},
		ctx,
	);
	const ceOwnedCompactions = [];
	const ceOwnedSent = sent.length;
	const ceOwnedCtx = {
		...ctx,
		isIdle: () => true,
		getContextUsage: () => ({ tokens: 1 }),
		compact: (options) => ceOwnedCompactions.push(options),
	};
	const ceOwnedSettle = tempHooks.agent_settled({}, ceOwnedCtx);
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(
		ceOwnedCompactions.length,
		1,
		"a normal goal phase starts one ce-owned compaction",
	);
	const ceOwnedEntry = await tempHooks.session_before_compact(
		{
			reason: "manual",
			preparation: {
				messagesToSummarize: [],
				fileOps: {},
				firstKeptEntryId: "ce-owned-phase",
				tokensBefore: 30_001,
			},
		},
		ceOwnedCtx,
	);
	assert.equal(ceOwnedEntry.compaction.details.triggerOwner, "ce-workflow");
	await tempHooks.session_compact(
		{ compactionEntry: { details: ceOwnedEntry.compaction.details } },
		ceOwnedCtx,
	);
	assert.equal(
		sent.length,
		ceOwnedSent,
		"ce-owned session_compact cannot race its completion callback",
	);
	ceOwnedCompactions[0].onComplete?.();
	ceOwnedCompactions[0].onError?.(new Error("late duplicate callback"));
	await ceOwnedSettle;
	assert.equal(
		sent.length,
		ceOwnedSent + 1,
		"ce-owned compaction delivers one continuation",
	);
	const pendingContinuationCompactions = [];
	const pendingContinuationSent = sent.length;
	const pendingContinuationCtx = {
		...ctx,
		isIdle: () => true,
		compact: (options) => pendingContinuationCompactions.push(options),
	};
	await tempShortcuts.f8.handler(pendingContinuationCtx);
	assert.equal(
		pendingContinuationCompactions.length,
		1,
		"microcompaction starts while a goal continuation is queued",
	);
	pendingContinuationCompactions[0].onComplete?.();
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(
		sent.length,
		pendingContinuationSent + 1,
		"completed microcompaction replaces the queued continuation exactly once",
	);
	await tempHooks.before_agent_start(
		{ prompt: sent.at(-1).message, systemPrompt: "base" },
		ctx,
	);
	const beforeNativeWithoutPending = sent.length;
	const nativeWithoutPending = await tempHooks.session_before_compact(
		{
			reason: "overflow",
			preparation: {
				messagesToSummarize: [],
				fileOps: {},
				firstKeptEntryId: "native-after-ce",
				tokensBefore: 30_001,
			},
		},
		ctx,
	);
	await tempHooks.session_compact(
		{ compactionEntry: { details: nativeWithoutPending.compaction.details } },
		ctx,
	);
	assert.equal(
		sent.length,
		beforeNativeWithoutPending,
		"ce-owned recovery state cannot leak into the next native compaction",
	);

	await tempTools.work_goal_complete.execute(
		"t-compaction-matrix",
		{ summary: "compaction lifecycle matrix verified" },
		null,
		null,
		ctx,
	);
	writeFileSync(
		path.join(cwd, ".pi", "settings.json"),
		JSON.stringify({
			workResume: {
				selfImproving: true,
				goalThinkingLevel: "medium",
			},
			workOrchestrator: { context: { autoCompact: true } },
		}),
	);

	await invoke("work-goal", "survive a WebSocket retry", ctx);
	const retryPrompt = sent.at(-1).message;
	await tempHooks.before_agent_start(
		{ prompt: retryPrompt, systemPrompt: "base" },
		ctx,
	);
	await tempHooks.agent_start({}, ctx);
	const retryNotices = notices.length;
	await tempHooks.agent_end(
		{
			messages: [
				{
					role: "assistant",
					stopReason: "error",
					errorMessage: "WebSocket error",
					content: [],
				},
			],
		},
		ctx,
	);
	assert.equal(
		statuses["work-goal"],
		"working #0",
		"agent_end does not consume a goal iteration before Pi settles",
	);
	assert.equal(notices.length, retryNotices);
	await tempHooks.agent_start({}, ctx);
	await tempHooks.agent_end(
		{
			messages: [
				{
					role: "assistant",
					content: [{ type: "text", text: "Recovered on Pi's native retry." }],
				},
			],
		},
		ctx,
	);
	await settle();
	assert.match(
		statuses["work-goal"],
		/active/,
		"native provider retries keep the autonomous-goal indicator active",
	);
	assert.equal(
		notices
			.slice(retryNotices)
			.some((notice) => String(notice.message).includes("transient error")),
		false,
		"successful native retries do not trigger a duplicate workflow retry",
	);
	await tempTools.work_goal_complete.execute(
		"t-websocket",
		{ summary: "retry state verified" },
		null,
		null,
		ctx,
	);
	assert.equal(statuses["work-goal"], undefined);

	await invoke("work-goal", "halt this active turn", ctx);
	const stopPrompt = sent.at(-1).message;
	await tempHooks.before_agent_start(
		{ prompt: stopPrompt, systemPrompt: "base" },
		ctx,
	);
	await tempHooks.agent_start({}, ctx);
	const sentBeforeStop = sent.length;
	const abortsBeforeStop = aborts;
	const stopInputResult = await tempHooks.input?.(
		{
			source: "extension",
			text: "ORCHESTRATOR_RUN_V1 work-stop remote stop",
		},
		ctx,
	);
	assert.deepEqual(stopInputResult, { action: "handled" });
	assert.equal(
		aborts,
		abortsBeforeStop + 1,
		"Stop safely aborts the active Pi turn immediately",
	);
	assert.equal(
		sent.length,
		sentBeforeStop,
		"Stop safely does not queue a steer",
	);
	assert.match(statuses["work-goal"], /stopping/);
	await tempHooks.agent_end(
		{
			messages: [
				{
					role: "assistant",
					stopReason: "aborted",
					errorMessage: "Request aborted",
					content: [],
				},
			],
		},
		ctx,
	);
	await settle();
	assert.match(statuses["work-goal"], /stopped/);
	await invoke("work-goal", "clear", ctx);
	assert.equal(statuses["work-goal"], undefined);

	await invoke("work-goal", "retain a goal during ordinary chat", ctx);
	const pauseCwd = mkdtempSync(path.join(tmpdir(), "ce-work-pause-goal-"));
	execFileSync("git", ["init"], { cwd: pauseCwd, stdio: "ignore" });
	initStore(pauseCwd);
	mutateStore(pauseCwd, (store) => {
		createWorkItem(store, {
			id: "pause-roadmap",
			type: "epic",
			title: "Pause roadmap",
		});
		createWorkItem(store, {
			id: "pause-task",
			parentId: "pause-roadmap",
			status: "in_progress",
			title: "Pause task",
		});
	});
	mod.rememberWorkflowEpicForHelper(pauseCwd, {
		id: "pause-roadmap",
		type: "epic",
		status: "open",
		title: "Pause roadmap",
	});
	const sentBeforeCheckpointPause = sent.length;
	const checkpointPause = await invoke(
		"work-pause",
		"operator requested checkpoint",
		{ ...ctx, cwd: pauseCwd },
	);
	assert.equal(checkpointPause.ok, true, checkpointPause.message);
	assert.equal(
		statuses["work-goal"],
		"paused",
		"Checkpoint and pause persists the autonomous goal as paused",
	);
	assert.equal(
		sent.length,
		sentBeforeCheckpointPause,
		"Checkpoint and pause cannot queue a fresh-session continuation",
	);
	rmSync(pauseCwd, { recursive: true, force: true });
	await tempHooks.before_agent_start(
		{ prompt: "ordinary chat while goal is paused", systemPrompt: "base" },
		ctx,
	);
	await tempHooks.agent_start({}, ctx);
	const abortsBeforeOrdinaryStop = aborts;
	await invoke("work-stop", "stop ordinary turn", ctx);
	assert.equal(aborts, abortsBeforeOrdinaryStop + 1);
	assert.match(
		statuses["work-goal"],
		/stopped/,
		"stopping a non-goal turn does not strand the persisted goal in stopping",
	);
	await tempHooks.agent_end(
		{
			messages: [
				{
					role: "assistant",
					stopReason: "aborted",
					content: [],
				},
			],
		},
		ctx,
	);
	await settle();
	assert.match(statuses["work-goal"], /stopped/);
	await invoke("work-goal", "clear", ctx);

	const beforeResumeSent = sent.length;
	const beforeResumeNotices = notices.length;
	await invoke("work-resume", "one task only", ctx);
	assert.equal(
		sent.length,
		beforeResumeSent,
		"work-resume does not start a generic project-goal LLM turn",
	);
	assert.ok(
		notices.length > beforeResumeNotices,
		"work-resume reports coded WorkItems target resolution without a goal kickoff",
	);

	entries.length = 0;
	writeFileSync(
		path.join(cwd, ".pi", "work-orchestrator-state.json"),
		JSON.stringify({
			workGoal: {
				id: "wg-reset",
				mode: "project",
				objective: "continue across sessions",
				status: "active",
				iteration: 2,
				resumeOnSessionStart: true,
			},
		}),
	);
	tempHooks.session_start?.({}, ctx);
	assert.match(statuses["work-goal"], /active #2/);
	await tempHooks.before_agent_start(
		{
			prompt:
				"Continue the roadmap.\n\n<!-- work-goal-continuation:wg-reset:2:test -->",
			systemPrompt: "base",
		},
		ctx,
	);
	await tempHooks.agent_start({}, ctx);
	const beforeResetContinuationSent = sent.length;
	await tempHooks.agent_end(
		{
			messages: [
				{
					role: "assistant",
					content: [{ type: "text", text: "Continue the roadmap." }],
				},
			],
		},
		ctx,
	);
	await settle();
	assert.equal(sent.length, beforeResetContinuationSent + 1);
	assert.match(sent.at(-1).message, /^\/__orchestrator-goal-continue wg-reset /);
	assert.equal(
		sent.at(-1).options?.expandPromptTemplates,
		true,
		"automatic fresh-session continuations dispatch their internal command",
	);
	const beforeFallbackCompactions = compactions.length;
	const beforeFallbackSent = sent.length;
	await tempCommands["__orchestrator-goal-continue"].handler(
		"wg-reset wg-reset:2:fallback",
		{
			...ctx,
			newSession: async () => ({ cancelled: true }),
		},
	);
	assert.equal(compactions.length, beforeFallbackCompactions + 1);
	assert.equal(sent.length, beforeFallbackSent + 1);
	assert.match(sent.at(-1).message, /microcompact/);

	let handoffEntry;
	let freshPrompt;
	await tempCommands["__orchestrator-goal-continue"].handler(
		"wg-reset wg-reset:2:fresh",
		{
			...ctx,
			newSession: async (options) => {
				options.setup({
					appendCustomEntry: (customType, data) => {
						handoffEntry = { type: "custom", customType, data };
					},
				});
				await options.withSession({
					sendUserMessage: async (message) => {
						freshPrompt = message;
					},
				});
				return { cancelled: false };
			},
		},
	);
	assert.equal(handoffEntry.data.goal.resumeOnSessionStart, true);
	assert.match(freshPrompt, /Started in a fresh session/);
	entries.length = 0;
	entries.push(handoffEntry);
	tempHooks.session_start?.({}, ctx);
	assert.match(statuses["work-goal"], /active #3/);
	await invoke("work-goal", "clear", ctx);

	writeFileSync(
		path.join(cwd, ".pi", "work-orchestrator-state.json"),
		JSON.stringify({
			workGoal: {
				id: "wg-inert-restart",
				mode: "self-improving",
				objective: "must resume by command",
				status: "active",
				iteration: 1,
			},
		}),
	);
	tempHooks.session_start?.({}, ctx);
	assert.equal(statuses["work-goal"], "paused");
	const abortsBeforeStaleContinuation = aborts;
	const staleBefore = await tempHooks.before_agent_start(
		{
			prompt:
				"Continue the active autonomous goal.\n\n<!-- work-goal-continuation:wg-inert-restart:1:stale -->",
			systemPrompt: "base",
		},
		ctx,
	);
	assert.doesNotMatch(staleBefore.systemPrompt, /Active autonomous goal/);
	await tempHooks.agent_start({}, ctx);
	assert.equal(
		aborts,
		abortsBeforeStaleContinuation + 1,
		"a queued continuation cannot reactivate a paused goal",
	);
	await tempHooks.agent_end(
		{
			messages: [
				{
					role: "assistant",
					stopReason: "aborted",
					content: [],
				},
			],
		},
		ctx,
	);
	await settle();
	assert.equal(statuses["work-goal"], "paused");
	assert.ok(
		notices.some((notice) =>
			String(notice.message).includes("stale autonomous-goal continuation"),
		),
	);
	const beforeOrdinaryChat = sent.length;
	const ordinaryBefore = await tempHooks.before_agent_start(
		{ prompt: "regarding com7, is it fixed right", systemPrompt: "base" },
		ctx,
	);
	assert.match(ordinaryBefore.systemPrompt, /Direct request mode/);
	assert.doesNotMatch(ordinaryBefore.systemPrompt, /Review cycle budget/);
	assert.doesNotMatch(ordinaryBefore.systemPrompt, /Active autonomous goal/);
	await tempHooks.agent_start({}, ctx);
	await tempHooks.agent_end(
		{
			messages: [
				{
					role: "assistant",
					content: [{ type: "text", text: "Answered normal chat." }],
				},
			],
		},
		ctx,
	);
	await settle();
	assert.equal(sent.length, beforeOrdinaryChat);

	entries.length = 0;
	writeFileSync(
		path.join(cwd, ".pi", "work-orchestrator-state.json"),
		JSON.stringify({
			workGoal: {
				id: "wg-improvement-stall",
				mode: "improvement",
				objective:
					"Work-improvement snapshot IDs: work-7.1\nDo bounded improvement work.",
				status: "active",
				iteration: 0,
				resumeOnSessionStart: true,
				updatedAt: Date.now() + 1_000,
			},
		}),
	);
	tempHooks.session_start?.({}, ctx);
	assert.match(statuses["work-goal"], /active/);
	for (let turn = 0; turn < 3; turn += 1) {
		await tempHooks.before_agent_start(
			{
				prompt: `Continue safely.\n\n<!-- work-goal-continuation:wg-improvement-stall:${turn}:stall -->`,
				systemPrompt: "base",
			},
			ctx,
		);
		await tempHooks.agent_start({}, ctx);
		await tempHooks.agent_end(
			{
				messages: [
					{
						role: "assistant",
						content: [{ type: "text", text: "No durable progress yet." }],
					},
				],
			},
			ctx,
		);
		await settle();
	}
	assert.equal(
		statuses["work-goal"],
		"paused",
		"improvement goals pause after two unchanged continuations",
	);
	assert.ok(
		notices.some((notice) =>
			String(notice.message).includes("no durable improvement progress"),
		),
	);
	await invoke("work-goal", "clear", ctx);

	entries.length = 0;
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
	assert.equal(restartedInput, undefined);
	assert.equal(statuses["work-goal"], "needs human");
	await invoke(
		"work-goal",
		"resume 4, waive only disconnection screenshot",
		ctx,
	);
	assert.match(sent.at(-1).message, /waive only disconnection screenshot/);
	const sentBeforePlainPause = sent.length;
	const plainPauseResult = await tempHooks.input?.(
		{ source: "user", text: "pause" },
		ctx,
	);
	assert.equal(plainPauseResult, undefined);
	assert.match(statuses["work-goal"], /active/);
	const prefixedPauseResult = await tempHooks.input?.(
		{ source: "user", text: "orchestrator pause" },
		ctx,
	);
	assert.deepEqual(prefixedPauseResult, { action: "handled" });
	assert.equal(statuses["work-goal"], "paused");
	assert.equal(
		sent.length,
		sentBeforePlainPause,
		"prefixed pause does not queue another autonomous continuation",
	);

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
	assert.equal(numberedResult, undefined);
	assert.equal(
		notices
			.slice(noticeCount)
			.some((notice) => String(notice.message).includes("Running 1.")),
		false,
		"unprefixed numbered chat never invokes workflow actions",
	);
	assert.deepEqual(
		await tempHooks.input?.(
			{ source: "user", text: "orchestrator 1, show current status" },
			ctx,
		),
		{ action: "handled" },
	);
	assert.ok(
		notices
			.slice(noticeCount)
			.some((notice) =>
				String(notice.message).includes("Running 1. /wo → Status"),
			),
		"prefixed numbered choice runs the selected action",
	);
	assert.deepEqual(
		await tempHooks.input?.({ source: "user", text: "orchestrator status" }, ctx),
		{ action: "handled" },
	);

	await invoke("work-goal", "format decision notice", ctx);
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
	await invoke("work-goal", "survive usage windows", ctx);
	const beforeUsageRetry = sent.length;
	await tempHooks.before_agent_start(
		{ prompt: sent.at(-1).message, systemPrompt: "base" },
		ctx,
	);
	await tempHooks.agent_start({}, ctx);
	await tempHooks.agent_end(
		{
			messages: [
				{
					role: "assistant",
					content: [
						{
							type: "text",
							text: "Error: Codex error: The usage limit has been reached",
						},
					],
				},
			],
		},
		ctx,
	);
	await settle();
	assert.equal(statuses["work-goal"], "usage wait #0");
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
