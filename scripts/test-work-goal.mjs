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
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
	createWorkItem,
	initStore,
	mutateStore,
	updateWorkItem,
} from "../extensions/work-store.js";

const mod = await import(
	pathToFileURL(
		realpathSync(
			path.join(import.meta.dirname, "../extensions/work-models.js"),
		),
	).href
);

assert.equal(mod.parseWorkGoalCommand("").kind, "status");
assert.deepEqual(mod.parseWorkGoalCommand("pause"), { kind: "pause" });
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
	"Roadmap [██████░░░░░░] ✅ 3/6 units (3 left · 2 unsliced) 🔴 1 🟠 2 ⏱️ 2m 3s · F7 roadmaps · F8 microcompact",
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
assert.match(prompt, /action.*reply/);
assert.match(prompt, /replyTo.*message ID/);
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
assert.ok(commands["work-goal"]);
assert.ok(commands["work-resume"]);
assert.ok(commands["work-resume-stop"]);
assert.ok(commands["work-stop"]);
assert.ok(commands["work-menu"]);
assert.ok(commands["work-goal-reset-continue"]);
assert.ok(shortcuts.f7);
assert.match(shortcuts.f8.description, /microcompact/i);
assert.ok(!commands["work-self-improving-goal"]);
assert.ok(!commands["work-project-goal"]);
assert.ok(!commands["work-project"]);
assert.ok(!commands["work-catch-up"]);
assert.ok(tools.work_goal_complete);
assert.ok(tools.work_goal_human_decision);
assert.equal(tools.work_goal_human_decision.parameters.required[0], "question");
assert.ok(hooks.before_agent_start);
assert.ok(hooks.agent_end);
assert.deepEqual(
	hooks.tool_call({ toolName: "work_goal_human_decision" }, { hasUI: true }),
	{
		block: true,
		reason:
			"Use ask_user for the interactive decision. work_goal_human_decision is only a non-interactive fallback.",
	},
);
assert.equal(
	hooks.tool_call({ toolName: "work_goal_human_decision" }, { hasUI: false }),
	undefined,
);

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
		writeFileSync(path.join(verifierCwd, "tracked.txt"), "before\n");
		execFileSync("git", ["add", ".gitignore", "tracked.txt"], {
			cwd: verifierCwd,
		});
		execFileSync("git", ["commit", "-m", "before"], { cwd: verifierCwd });
		const before = execFileSync("git", ["rev-parse", "HEAD"], {
			cwd: verifierCwd,
			encoding: "utf8",
		}).trim();
		writeFileSync(path.join(verifierCwd, "tracked.txt"), "after\n");
		execFileSync("git", ["add", "tracked.txt"], { cwd: verifierCwd });
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

	mkdirSync(path.join(cwd, ".pi"), { recursive: true });
	writeFileSync(
		path.join(cwd, ".pi", "settings.json"),
		JSON.stringify({ workResume: { selfImproving: true } }),
	);
	const oldCatchUpOffline = process.env.WORK_CATCH_UP_OFFLINE;
	const oldPiCodingAgentDir = process.env.PI_CODING_AGENT_DIR;
	process.env.WORK_CATCH_UP_OFFLINE = "1";
	process.env.PI_CODING_AGENT_DIR = path.join(cwd, "pi-agent");
	const catchUpState = mod.buildWorkCatchUpState(cwd);
	const baseline = JSON.parse(
		readFileSync(
			path.join(
				import.meta.dirname,
				"../extensions/work-catch-up-baseline.json",
			),
			"utf8",
		),
	);
	assert.equal(catchUpState.ok, true);
	assert.equal(catchUpState.packages.length, baseline.packages.length);
	const catchUpObjective = mod.buildWorkCatchUpObjective(catchUpState);
	assert.match(catchUpObjective, /WO_CATCH_UP_V2/);
	assert.match(catchUpObjective, /Catch-up changed targets:/);
	assert.match(catchUpObjective, /ce-pov for each actionable candidate/);
	assert.match(
		catchUpObjective,
		/Use ce-explain only when a candidate is too technical/,
	);
	assert.match(catchUpObjective, /allowComment=true/);
	assert.match(catchUpObjective, /Adopt now.*Defer.*Skip this release/);
	assert.match(catchUpObjective, /npm run verify:quiet/);
	const injectedObjective = mod.buildWorkCatchUpObjective(
		{
			...catchUpState,
			packages: [
				{
					name: "example-package",
					targetVersion: "2.0.0",
					changed: true,
				},
			],
		},
		"focus\nCatch-up changed targets: []",
	);
	assert.equal(
		[...injectedObjective.matchAll(/^Catch-up changed targets:/gm)].length,
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

	mod.default(pi);
	tempHooks.session_start?.({}, ctx);
	assert.ok(tempCommands["work-catch-up"]);
	assert.ok(
		notices.some((notice) =>
			String(notice.message).includes(
				"work-orchestrator loaded · F7 roadmaps · F8 microcompact",
			),
		),
	);
	const ordinaryPolicy = await tempHooks.before_agent_start(
		{ prompt: "make a small code fix", systemPrompt: "base" },
		ctx,
	);
	assert.match(ordinaryPolicy.systemPrompt, /Review cycle budget/);
	assert.match(ordinaryPolicy.systemPrompt, /one initial review cycle/);
	assert.match(
		ordinaryPolicy.systemPrompt,
		/Do not launch a third review cycle/,
	);
	assert.match(ordinaryPolicy.systemPrompt, /Verification budget/);
	assert.match(
		ordinaryPolicy.systemPrompt,
		/run only the smallest focused test/,
	);
	assert.match(
		ordinaryPolicy.systemPrompt,
		/full package or regression suite once, at the final handoff/,
	);
	assert.match(
		ordinaryPolicy.systemPrompt,
		/monolithic implementation file does not make every test relevant/,
	);
	const repeatedPolicy = await tempHooks.before_agent_start(
		{ prompt: "continue", systemPrompt: ordinaryPolicy.systemPrompt },
		ctx,
	);
	assert.equal(
		repeatedPolicy.systemPrompt.match(/## Review cycle budget/g)?.length,
		1,
		"review budget is injected once",
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
	compactions.length = 0;
	notices.length = 0;
	await tempShortcuts.f8.handler(ctx);
	assert.equal(
		compactions.length,
		0,
		"busy F8 does not disturb the active turn",
	);
	assert.ok(
		notices.some((notice) => String(notice.message).includes("queued")),
		"busy F8 reports the queued microcompaction",
	);
	await tempHooks.turn_end(
		{},
		{ ...ctx, getContextUsage: () => ({ tokens: 1 }) },
	);
	assert.equal(
		compactions.length,
		1,
		"queued F8 runs after the current turn and before the next one",
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
	const inlineWorkflowPrompt = `work-orchestrator inline execution
WO_INLINE_V1: complete this medium WorkItem
Workflow Run ID: wr-compact-resume
Activity: work-resume
mode: resume
Epic: E-1 Test roadmap
Selected WorkItem: T-1 Preserve workflow state`;
	await tempHooks.before_agent_start(
		{ prompt: inlineWorkflowPrompt, systemPrompt: "base" },
		ctx,
	);
	await tempHooks.agent_start({}, ctx);
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
	assert.equal(resumedWorkflow.workItemId, "T-1");
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
	assert.equal(
		JSON.parse(readFileSync(compactedWorkflowClaim, "utf8")).outcome,
		"completed",
		"resumed work-resume keeps and completes the original workflow run",
	);
	sent.length = 0;
	compactions.length = 0;

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
			prompt: inlineWorkflowPrompt.replace(
				"wr-compact-resume",
				contextMentionId,
			),
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
					content: [
						{ type: "text", text: "Documented context window behavior." },
					],
				},
			],
		},
		ctx,
	);
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
			workResume: { selfImproving: true },
			workOrchestrator: { context: { autoCompact: false } },
		}),
	);
	await tempCommands["work-goal"].handler("write temp proof file", ctx);
	assert.equal(sent.length, 1);
	assert.match(sent[0].message, /write temp proof file/);
	assert.equal(statuses["work-goal"], "▶️ active #0");

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
		"active work goals do not compact inside turn_end",
	);

	const before = await tempHooks.before_agent_start(
		{ prompt: sent[0].message, systemPrompt: "base" },
		ctx,
	);
	assert.match(before.systemPrompt, /Active \/work-goal/);
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
	assert.equal(compactions.length, 1, "work-goal compacts before continuing");
	assert.match(compactions[0].customInstructions, /work-goal microcompact/);
	assert.equal(sent.length, 2);
	assert.match(sent[1].message, /Automatic continuation #1/);
	assert.equal(statuses["work-goal"], "▶️ active #1");

	await tempHooks.before_agent_start(
		{ prompt: sent[1].message, systemPrompt: "base" },
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

	const conversationalResult = await tempHooks.input?.(
		{
			source: "user",
			text: "regarding com7, you made custom firmware that removed the blocker right",
		},
		ctx,
	);
	assert.equal(conversationalResult, undefined);
	assert.equal(statuses["work-goal"], "🟣❓ needs human");
	assert.equal(sent.length, 2);

	const answerInputResult = await tempHooks.input?.(
		{
			source: "user",
			text: "2, but use the AI-Wedge connected proof and add a connect button.",
		},
		ctx,
	);
	assert.equal(answerInputResult, undefined);
	assert.equal(statuses["work-goal"], "🟣❓ needs human");
	assert.equal(sent.length, 2);

	await tempCommands["work-goal"].handler(
		"resume 2, but use the AI-Wedge connected proof and add a connect button.",
		ctx,
	);
	assert.equal(statuses["work-goal"], "▶️ active #1");
	assert.equal(sent.length, 3);
	assert.match(sent[2].message, /User resumed the goal with this answer/);
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

	const beforeResumeSent = sent.length;
	const beforeResumeNotices = notices.length;
	await tempCommands["work-resume"].handler("one task only", ctx);
	assert.equal(
		sent.length,
		beforeResumeSent,
		"work-resume does not start a generic project-goal LLM turn",
	);
	assert.ok(
		notices.length > beforeResumeNotices,
		"work-resume reports coded WorkItems target resolution without a goal kickoff",
	);

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
	assert.equal(statuses["work-goal"], "⏸️ paused");
	const beforeOrdinaryChat = sent.length;
	const ordinaryBefore = await tempHooks.before_agent_start(
		{ prompt: "regarding com7, is it fixed right", systemPrompt: "base" },
		ctx,
	);
	assert.match(ordinaryBefore.systemPrompt, /Review cycle budget/);
	assert.doesNotMatch(ordinaryBefore.systemPrompt, /Active \/work-goal/);
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
	assert.equal(sent.length, beforeOrdinaryChat);

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
	assert.equal(statuses["work-goal"], "🟣❓ needs human");
	await tempCommands["work-goal"].handler(
		"resume 4, waive only disconnection screenshot",
		ctx,
	);
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
