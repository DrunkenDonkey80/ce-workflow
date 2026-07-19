#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import {
	appendFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const {
	buildWorkTelemetry,
	buildWorkTelemetryState,
	completeWorkflowOnce,
	default: workModelsExtension,
	directRoleHandoffParams,
	parseWorkPromptMeta,
	reconcilePendingDirectRuns,
	recordPendingDirectRun,
	recordSpawnedDirectRun,
	recordWorkTelemetry,
	withCommandTelemetry,
} = await import(
	pathToFileURL(
		realpathSync(
			path.join(import.meta.dirname, "../extensions/work-models.js"),
		),
	).href
);
const { installWorkflowFixture, seedNativeStore } = await import(
	pathToFileURL(
		realpathSync(path.join(import.meta.dirname, "work-command-fixture.mjs")),
	).href
);

function assert(ok, message) {
	if (!ok) throw new Error(message);
}

function telemetryEvents(cwd) {
	const dir = path.join(cwd, ".pi", "work-runs");
	return readdirSync(dir)
		.filter((file) => file.endsWith(".jsonl"))
		.flatMap((file) =>
			readFileSync(path.join(dir, file), "utf8")
				.split(/\r?\n/)
				.filter(Boolean)
				.flatMap((line) => {
					try {
						return [JSON.parse(line)];
					} catch {
						return [];
					}
				}),
		);
}

const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
const globalDir = mkdtempSync(path.join(tmpdir(), "work-telemetry-global-"));
process.env.PI_CODING_AGENT_DIR = globalDir;
const cwd = mkdtempSync(path.join(tmpdir(), "work-telemetry-"));
const now = Date.now();
mkdirSync(path.join(cwd, ".pi"), { recursive: true });
writeFileSync(
	path.join(cwd, ".pi", "settings.json"),
	`${JSON.stringify({ workResume: { selfImproving: false } })}\n`,
);
seedNativeStore(cwd, [
	{
		id: "E-1",
		issue_type: "epic",
		status: "in_progress",
		title: "Active epic",
	},
]);
try {
	const parsedMarker = parseWorkPromptMeta(
		"work-orchestrator mode: resume\nWorkflow Run ID: wf-marker\nActivity: validation",
	);
	assert(
		parsedMarker.workflowRunId === "wf-marker" &&
			parsedMarker.activity === "validation",
		"workflow identity and activity marker survive prompt parsing",
	);
	completeWorkflowOnce(cwd, {
		workflowRunId: "wf-once",
		activity: "improvement",
		outcome: "completed",
	});
	completeWorkflowOnce(cwd, {
		workflowRunId: "wf-once",
		activity: "improvement",
		outcome: "completed",
	});
	assert(
		buildWorkTelemetryState(cwd, "today").slowest.filter(
			(event) =>
				event.type === "workflow-complete" && event.workflowRunId === "wf-once",
		).length === 1,
		"terminal workflow records are exactly once",
	);

	process.env.CE_EVAL_SAMPLE_ID = "sample-fixture";
	process.env.CE_EVAL_PAIR_ID = "pair-fixture";
	process.env.CE_EVAL_ATTEMPT_ID = "attempt-fixture";
	process.env.CE_EVAL_TREATMENT_ID = "treatment-fixture";
	recordWorkTelemetry(cwd, {
		type: "agent-dispatched",
		role: "main",
		parentAgentId: null,
		startedAt: new Date(now).toISOString(),
	});
	recordWorkTelemetry(cwd, {
		type: "agent-terminal",
		role: "main",
		parentAgentId: null,
		endedAt: new Date(now + 10).toISOString(),
		provider: "fixture",
		model: "fixture-model",
		effort: "medium",
		tokens: { input: 8, output: 2, total: 10 },
		toolCalls: 0,
		toolOutputBytes: 0,
		subagentCalls: 0,
		retries: 0,
		questions: 0,
		artifactIds: [],
		terminalReason: "completed",
	});
	for (const name of [
		"CE_EVAL_SAMPLE_ID",
		"CE_EVAL_PAIR_ID",
		"CE_EVAL_ATTEMPT_ID",
		"CE_EVAL_TREATMENT_ID",
	])
		delete process.env[name];
	const evaluationEvents = telemetryEvents(cwd).filter(
		(event) => event.sampleId === "sample-fixture",
	);
	assert(
		evaluationEvents.length === 2 &&
			evaluationEvents.every(
				(event) =>
					event.version === 2 &&
					event.pairId === "pair-fixture" &&
					event.agentId === "sample-fixture:main",
			),
		"evaluation telemetry adds stable identity without changing ordinary records",
	);

	const directDir = path.join(cwd, ".pi-subagents", "direct-1");
	mkdirSync(directDir, { recursive: true });
	recordPendingDirectRun(cwd, {
		workflowRunId: "wf-direct",
		activity: "benchmark",
		action: "run-review",
		agent: "work-reviewer",
		asyncDir: directDir,
	});
	writeFileSync(
		path.join(directDir, "status.json"),
		JSON.stringify({
			state: "complete",
			steps: [{ agent: "work-reviewer", status: "complete" }],
		}),
	);
	assert(
		reconcilePendingDirectRuns(cwd).length === 1 &&
			reconcilePendingDirectRuns(cwd).length === 0,
		"real pi-subagents complete schema reconciles exactly once",
	);
	let directEvents = buildWorkTelemetryState(cwd, "today").slowest.filter(
		(event) => event.workflowRunId === "wf-direct",
	);
	assert(
		directEvents.some(
			(event) => event.type === "agent" && event.activity === "benchmark",
		) &&
			directEvents.filter((event) => event.type === "workflow-complete")
				.length === 1,
		"direct-role reconciliation emits correlated agent and terminal records with activity",
	);

	const pendingFile = path.join(
		cwd,
		".pi",
		"work-runs",
		"direct",
		"pending-direct.jsonl",
	);
	writeFileSync(
		pendingFile,
		readFileSync(pendingFile, "utf8")
			.split(/\r?\n/)
			.filter((line) => !line.includes('"type":"completed"'))
			.filter(Boolean)
			.join("\n") + "\n",
	);
	assert(
		reconcilePendingDirectRuns(cwd).length === 1,
		"reconciliation can retry after a crash before its completed marker",
	);
	directEvents = buildWorkTelemetryState(cwd, "today").slowest.filter(
		(event) => event.workflowRunId === "wf-direct" && event.type === "agent",
	);
	assert(
		directEvents.length === 1,
		"retried reconciliation emits idempotent agent telemetry",
	);

	const failedDir = path.join(cwd, ".pi-subagents", "direct-failed");
	mkdirSync(failedDir, { recursive: true });
	recordPendingDirectRun(cwd, {
		workflowRunId: "wf-direct-failed",
		action: "run-review",
		agent: "work-reviewer",
		asyncDir: failedDir,
	});
	writeFileSync(
		path.join(failedDir, "status.json"),
		JSON.stringify({ state: "failed" }),
	);
	assert(
		reconcilePendingDirectRuns(cwd).includes("wf-direct-failed") &&
			buildWorkTelemetryState(cwd, "today").slowest.some(
				(event) =>
					event.workflowRunId === "wf-direct-failed" &&
					event.type === "workflow-complete" &&
					event.outcome === "failed",
			),
		"top-level failed status without steps emits a failed outcome",
	);

	assert(
		recordPendingDirectRun(cwd, { workflowRunId: "wf-untrackable" }) === "" &&
			Boolean(
				recordPendingDirectRun(cwd, {
					workflowRunId: "wf-ambiguous-trackable",
					runId: "run-known-after-timeout",
				}),
			),
		"ambiguous launches persist real identifiers without fabricating trackability",
	);
	appendFileSync(pendingFile, "not-json\nnull\n{}\n");
	recordPendingDirectRun(cwd, {
		workflowRunId: "wf-malformed-status",
		asyncDir: path.join(cwd, ".pi-subagents", "malformed"),
	});
	mkdirSync(path.join(cwd, ".pi-subagents", "malformed"), { recursive: true });
	writeFileSync(
		path.join(cwd, ".pi-subagents", "malformed", "status.json"),
		"{bad",
	);
	assert(
		Array.isArray(reconcilePendingDirectRuns(cwd)),
		"malformed pending and status records do not throw",
	);
	recordWorkTelemetry(cwd, {
		id: "cmd-small",
		timestamp: now,
		type: "command",
		command: "work-small",
		action: "run-implementation",
		stopReason: "handoff-queued",
		handoff: { queued: true, started: false, role: "worker" },
		epicId: "E-1",
		workItemId: "TASK-1",
		durationMs: 120,
		context: { after: { tokens: 1200 } },
	});
	recordWorkTelemetry(cwd, {
		id: "agent-worker",
		timestamp: now + 1,
		type: "agent",
		mode: "resume",
		action: "run-implementation",
		role: "worker",
		epicId: "E-1",
		workItemId: "TASK-1",
		durationMs: 420_000,
		usage: { input: 9000, output: 2000, totalTokens: 11_000, cost: 0.15 },
		payoff: {
			role: "worker",
			durationMs: 420_000,
			tokens: 11_000,
			filesChanged: 3,
			testsRun: 1,
			commitCreated: false,
		},
		context: { before: { tokens: 1200 }, after: { tokens: 18_000 } },
		tools: [
			{ name: "subagent", runId: "worker-1", durationMs: 390_000 },
			{ name: "bash", kind: "test", durationMs: 20_000 },
		],
	});
	recordWorkTelemetry(cwd, {
		id: "agent-review",
		timestamp: now + 2,
		type: "agent",
		mode: "resume",
		action: "review",
		epicId: "E-1",
		workItemId: "TASK-1",
		durationMs: 180_000,
		usage: { input: 7000, output: 1000, totalTokens: 8000, cost: 0.09 },
		context: { after: { tokens: 24_000 } },
		tools: [{ name: "subagent", runId: "reviewer-1", durationMs: 170_000 }],
	});
	recordWorkTelemetry(cwd, {
		id: "agent-compound",
		timestamp: now + 3,
		type: "agent",
		mode: "debug",
		action: "compound",
		epicId: "E-1",
		workItemId: "TASK-1",
		durationMs: 60_000,
		usage: { input: 3000, output: 600, totalTokens: 3600, cost: 0.04 },
		tools: [{ name: "ce-compound", durationMs: 55_000 }],
	});
	recordWorkTelemetry(cwd, {
		id: "agent-commit",
		timestamp: now + 4,
		type: "agent",
		mode: "finish",
		action: "commit",
		epicId: "E-1",
		workItemId: "TASK-1",
		durationMs: 30_000,
		usage: { input: 1500, output: 300, totalTokens: 1800, cost: 0.02 },
	});
	recordWorkTelemetry(cwd, {
		id: "cmd-big",
		timestamp: now + 5,
		type: "command",
		command: "work-big",
		action: "run-planner",
		epicId: "E-1",
		workItemId: "PLAN-1",
		durationMs: 250,
		context: { after: { tokens: 1300 } },
	});
	recordWorkTelemetry(cwd, {
		id: "agent-planner",
		timestamp: now + 6,
		type: "agent",
		mode: "big",
		action: "run-planner",
		epicId: "E-1",
		workItemId: "PLAN-1",
		durationMs: 300_000,
		usage: { input: 6000, output: 1200, totalTokens: 7200, cost: 0.08 },
		context: { after: { tokens: 15_000 } },
	});

	const text = buildWorkTelemetry(cwd, "today");
	assert(text.includes("Work telemetry: today"), "text renders today summary");
	assert(text.includes("work-small"), "text includes work-small command phase");
	assert(text.includes("work-big"), "text includes work-big command phase");
	assert(text.includes("TASK-1"), "text groups by task workItem");
	assert(text.includes("24000"), "text reports max context tokens");
	assert(text.includes("Handoffs: 1 queued"), "text reports handoff outcomes");
	assert(text.includes("handoff-queued"), "text reports stop reasons");
	assert(text.includes("worker: 1 runs"), "text reports role payoff");

	const epic = buildWorkTelemetryState(cwd, "epic E-1");
	assert(epic.events === 7, "epic filter includes all synthetic events");
	assert(epic.totals.tokens === 31_600, "epic totals agent token usage");
	assert(epic.totals.testRuns === 1, "epic totals classified test tools");
	assert(epic.totals.handoffsQueued === 1, "epic totals queued handoffs");
	assert(
		epic.rolePayoff.some(
			(row) => row.role === "worker" && row.filesChanged === 3,
		),
		"epic reports structured role payoff",
	);
	assert(
		epic.byPhase.some((row) => row.key === "agent/resume/review"),
		"phase summary includes review agent",
	);
	assert(
		epic.byPhase.some((row) => row.key === "agent/debug/compound"),
		"phase summary includes compound agent",
	);
	assert(
		epic.byPhase.some((row) => row.key === "agent/finish/commit"),
		"phase summary includes commit agent",
	);

	const workItem = JSON.parse(
		buildWorkTelemetry(cwd, "workItem TASK-1 --json"),
	);
	assert(workItem.events === 5, "workItem filter isolates one task");
	assert(
		workItem.byWorkItem[0].key === "TASK-1",
		"workItem JSON groups by selected workItem",
	);
	assert(workItem.files.length === 1, "json reports backing telemetry file");
	assert(
		!Array.isArray(workItem.slowest[0].tools) &&
			workItem.slowest[0].tools.count >= 0,
		"json reports compact tool summaries instead of full tool arrays",
	);

	const blockedCwd = mkdtempSync(
		path.join(tmpdir(), "work-blocked-telemetry-"),
	);
	try {
		const blockedEvent = {
			timestamp: now,
			type: "command",
			command: "work-resume",
			action: "report-blocked",
			epicId: "E-BLOCKED",
			workItemId: "BLOCKER-1",
			reason:
				"No runnable WorkItem is ready; blockers or decisions need attention.",
		};
		recordWorkTelemetry(blockedCwd, { ...blockedEvent, id: "blocked-1" });
		recordWorkTelemetry(blockedCwd, {
			...blockedEvent,
			id: "blocked-duplicate",
			timestamp: now + 1,
		});
		recordWorkTelemetry(blockedCwd, {
			id: "interleaved-status",
			timestamp: now + 2,
			type: "command",
			command: "work-status",
			action: "status",
			epicId: "E-BLOCKED",
		});
		recordWorkTelemetry(blockedCwd, {
			...blockedEvent,
			id: "blocked-after-interleaved",
			timestamp: now + 3,
		});
		assert(
			buildWorkTelemetryState(blockedCwd, "epic E-BLOCKED").events === 2,
			"duplicate report-blocked telemetry is suppressed across interleaved events",
		);
		recordWorkTelemetry(blockedCwd, {
			...blockedEvent,
			id: "blocked-later",
			timestamp: now + 60 * 60 * 1000,
		});
		assert(
			buildWorkTelemetryState(blockedCwd, "epic E-BLOCKED").events === 3,
			"blocked telemetry records again after the dedupe window",
		);
	} finally {
		rmSync(blockedCwd, { recursive: true, force: true });
	}

	const dirtySource = mkdtempSync(
		path.join(tmpdir(), "work-improvement-dirty-"),
	);
	const dirtyConsumer = mkdtempSync(
		path.join(tmpdir(), "work-improvement-consumer-"),
	);
	try {
		execFileSync("git", ["init", "--quiet"], { cwd: dirtySource });
		writeFileSync(path.join(dirtySource, "uncommitted.txt"), "dirty\n");
		mkdirSync(path.join(dirtyConsumer, ".pi"), { recursive: true });
		writeFileSync(
			path.join(dirtyConsumer, ".pi", "settings.json"),
			`${JSON.stringify({
				workResume: { selfImproving: true },
				workImprovement: { sourceCheckout: dirtySource },
			})}\n`,
		);
		let confirmations = 0;
		let commandRan = false;
		await withCommandTelemetry(
			"dirty-source-warning",
			"",
			{
				cwd: dirtyConsumer,
				mode: "tui",
				hasUI: true,
				getContextUsage: () => ({ tokens: 0 }),
				ui: {
					confirm: async (title, message) => {
						confirmations += 1;
						assert(
							title.includes("Self-improvement") &&
								message.includes("uncommitted.txt"),
							"dirty-source confirmation identifies the blocker",
						);
						return false;
					},
				},
			},
			async () => {
				commandRan = true;
				return { ok: true, handoffPrompt: "test", handoffPending: true };
			},
		);
		assert(
			confirmations === 1 && !commandRan,
			"enabled self-improvement asks before starting against a dirty source",
		);
	} finally {
		rmSync(dirtySource, { recursive: true, force: true });
		rmSync(dirtyConsumer, { recursive: true, force: true });
	}

	const commandCtx = {
		cwd,
		getContextUsage: () => ({ tokens: 0 }),
	};
	const trackedAmbiguousDir = path.join(
		cwd,
		".pi-subagents",
		"tracked-ambiguous",
	);
	const reviewHandoffState = {
		action: "run-review",
		handoffPrompt: "review",
		selectedWorkItem: {
			id: "TASK-REVIEW",
			changedPaths: ["extensions/work-models.js"],
		},
	};
	await withCommandTelemetry("ambiguous-tracking", "", commandCtx, async () => {
		const direct = directRoleHandoffParams(reviewHandoffState, cwd);
		assert(
			Boolean(
				recordSpawnedDirectRun(cwd, reviewHandoffState, direct, {
					ambiguous: true,
					data: { asyncDir: trackedAmbiguousDir },
				}),
			),
			"ambiguous acknowledgement persists launcher-provided identity",
		);
		return { ok: true, handoffPrompt: "review", handoffPending: true };
	});
	assert(
		readFileSync(pendingFile, "utf8").includes(
			trackedAmbiguousDir.replaceAll("\\", "\\\\"),
		),
		"ambiguous launch identity is durable in pending telemetry",
	);
	let outerAfterNested;
	await withCommandTelemetry("outer-context", "", commandCtx, async () => {
		try {
			await withCommandTelemetry("nested-error", "", commandCtx, async () => {
				throw new Error("expected nested failure");
			});
		} catch {}
		outerAfterNested = parseWorkPromptMeta(
			directRoleHandoffParams(reviewHandoffState, cwd).params.task,
		);
		return { ok: true };
	});
	const outerEvent = telemetryEvents(cwd).find(
		(event) => event.type === "command" && event.command === "outer-context",
	);
	assert(
		outerAfterNested.workflowRunId === outerEvent.workflowRunId,
		"nested command errors restore the outer workflow context",
	);

	let releaseFirst;
	const firstGate = new Promise((resolve) => {
		releaseFirst = resolve;
	});
	const firstCommand = withCommandTelemetry(
		"concurrent-first",
		"",
		commandCtx,
		async () => {
			await firstGate;
			return { ok: true };
		},
	);
	let secondMeta;
	const secondCommand = withCommandTelemetry(
		"concurrent-second",
		"",
		commandCtx,
		async () => {
			await firstCommand;
			secondMeta = parseWorkPromptMeta(
				directRoleHandoffParams(reviewHandoffState, cwd).params.task,
			);
			return { ok: true };
		},
	);
	releaseFirst();
	await secondCommand;
	const secondEvent = telemetryEvents(cwd).find(
		(event) =>
			event.type === "command" && event.command === "concurrent-second",
	);
	assert(
		secondMeta.workflowRunId === secondEvent.workflowRunId,
		"overlapping commands retain independent workflow identities",
	);

	const fixture = installWorkflowFixture({ native: true });
	try {
		const commands = {};
		const hooks = {};
		workModelsExtension({
			on: (name, handler) => {
				hooks[name] = handler;
			},
			registerCommand: (name, config) => {
				commands[name] = config;
			},
		});
		const sent = [];
		let compactCalls = 0;
		const hookCtx = {
			cwd,
			getContextUsage: () => ({ tokens: 0 }),
			sessionManager: { getEntries: () => [] },
			ui: {
				notify: () => {},
				setStatus: () => {},
				setTitle: () => {},
			},
		};
		await hooks.session_start({}, hookCtx);
		await hooks.input({ text: "ordinary input", source: "user" }, hookCtx);
		await hooks.session_shutdown({}, hookCtx);
		assert(
			true,
			"session and input hooks tolerate malformed reconciliation data",
		);
		process.env.WORK_ORCH_ACTIVITY_MARKER = "validation";
		await commands["work-small"].handler("Add tiny thing", {
			cwd,
			mode: "tui",
			getContextUsage: () => ({ tokens: 40_000 }),
			compact: ({ onComplete }) => {
				compactCalls += 1;
				onComplete();
			},
			isIdle: () => true,
			sendUserMessage: async (message, options) =>
				sent.push({ message, options }),
			ui: { notify: () => {} },
		});
		delete process.env.WORK_ORCH_ACTIVITY_MARKER;
		const commandSummary = buildWorkTelemetryState(cwd, "workItem E-1.1");
		assert(
			commandSummary.events === 1,
			"extension command writes telemetry before inline completion",
		);
		assert(
			commandSummary.byPhase[0].key === "command/work-small/run-implementation",
			"extension command records command/action phase",
		);
		assert(
			commandSummary.slowest[0].handoff?.queued &&
				commandSummary.slowest[0].handoff.role === "inline-small",
			"extension command records inline-small handoff role",
		);
		assert(
			compactCalls === 1 && sent.length === 1,
			"context-heavy inline commands microcompact before triggering the handoff",
		);
		assert(
			sent[0].message.includes("WO_INLINE_V1") &&
				sent[0].message.includes("Do not call subagent list"),
			"small handoff stays inline and discovery-free",
		);
		const inlineMeta = parseWorkPromptMeta(sent[0].message);
		assert(
			inlineMeta.workflowRunId && inlineMeta.activity === "validation",
			"inline handoff carries command workflow identity and activity",
		);

		fixture.reset("active");
		await commands["work-med"].handler("Do not queue", {
			cwd,
			mode: "print",
			getContextUsage: () => ({ tokens: 0 }),
			sendUserMessage: async (message, options) =>
				sent.push({ message, options }),
			ui: { notify: () => {} },
		});
		assert(
			fixture.logs().every((entry) => entry.op !== "create") &&
				sent.length === 1,
			"print mode fails safely before creating a queued or duplicate WorkItem",
		);

		fixture.reset("blocked");
		const statusNotices = [];
		await commands["work-status"].handler("E-1", {
			cwd: fixture.cwd,
			getContextUsage: () => ({ tokens: 2222 }),
			ui: { notify: (message) => statusNotices.push(message) },
		});
		assert(
			statusNotices[0]?.includes("blockers: 1") &&
				statusNotices[0].includes("Next: Run /work-report BLOCK-1"),
			"work-status reports blocked WorkItems instead of only active/ready state",
		);
		fixture.reset("active");

		await hooks.before_agent_start(
			{ prompt: sent[0].message },
			{
				cwd,
				getContextUsage: () => ({ tokens: 3000 }),
			},
		);
		await hooks.agent_start();
		await hooks.tool_execution_start({
			toolCallId: "subagent-retry",
			args: JSON.stringify({ agent: "work-planner" }),
		});
		await hooks.tool_execution_end(
			{
				toolCallId: "subagent-retry",
				toolName: "subagent",
				isError: false,
				result: {
					details: {
						results: [
							{ agent: "work-planner", status: "failed" },
							{ agent: "work-planner", status: "completed" },
						],
					},
				},
			},
			{ cwd, getContextUsage: () => ({ tokens: 3050 }) },
		);
		await hooks.agent_end(
			{
				messages: [
					{
						role: "assistant",
						content:
							"Planning boundary complete and pushed. Created next ready WorkItem TASK-NEW-2.",
					},
				],
				review: {
					outcome: "PASS",
					findings: 0,
					fixer: false,
				},
			},
			{ cwd, getContextUsage: () => ({ tokens: 3100 }) },
		);
		const reviewSummary = buildWorkTelemetryState(cwd, "workItem E-1.1");
		const correlated = reviewSummary.slowest.filter(
			(event) => event.workflowRunId === inlineMeta.workflowRunId,
		);
		assert(
			correlated.some((event) => event.type === "command") &&
				correlated.some((event) => event.type === "agent") &&
				correlated.filter((event) => event.type === "workflow-complete")
					.length === 1 &&
				correlated.every((event) => event.activity === "validation"),
			"inline command and agent share one workflow identity, marker, and terminal event",
		);
		assert(
			reviewSummary.slowest.some(
				(event) =>
					event.review?.scope === "workItem E-1.1" &&
					event.review.outcome === "PASS",
			),
			"review telemetry records scoped outcome fields",
		);
		assert(
			reviewSummary.totals.handoffsStarted === 1,
			"agent telemetry records handoff start outcome",
		);
		assert(
			!existsSync(path.join(cwd, ".pi", "work-runs", "history")),
			"self-improving history stays off unless enabled",
		);

		mkdirSync(path.join(cwd, ".pi"), { recursive: true });
		writeFileSync(
			path.join(cwd, ".pi", "settings.json"),
			`${JSON.stringify({ workResume: { selfImproving: true } })}\n`,
		);
		const historyCtx = {
			cwd,
			getContextUsage: () => ({ tokens: 3200 }),
			sessionManager: {
				getSessionId: () => "sess-history",
				getSessionFile: () => path.join(cwd, "session.jsonl"),
			},
		};
		await hooks.before_agent_start(
			{ prompt: sent[0].message, systemPrompt: "system" },
			historyCtx,
		);
		await hooks.agent_start({}, historyCtx);
		await hooks.message_end(
			{
				message: { role: "assistant", content: [{ type: "text", text: "ok" }] },
			},
			historyCtx,
		);
		await hooks.tool_execution_start(
			{ toolCallId: "read-1", toolName: "read", args: { path: "README.md" } },
			historyCtx,
		);
		await hooks.tool_execution_end(
			{
				toolCallId: "read-1",
				toolName: "read",
				isError: false,
				result: { content: [{ type: "text", text: "full local output" }] },
			},
			historyCtx,
		);
		await hooks.agent_end({ messages: [] }, historyCtx);
		const historyFile = path.join(
			cwd,
			".pi",
			"work-runs",
			"history",
			"E-1.1",
			"sess-history.jsonl",
		);
		assert(existsSync(historyFile), "self-improving history writes per task");
		const historyLines = readFileSync(historyFile, "utf8")
			.trim()
			.split(/\r?\n/)
			.map((line) => JSON.parse(line));
		assert(
			historyLines.some((line) => line.type === "message_end") &&
				historyLines.some((line) => line.type === "tool_execution_end"),
			"self-improving history records messages and tool results",
		);
		assert(
			historyLines.every((line) => line.task.workItemId === "E-1.1"),
			"self-improving history is grouped by WorkItem task",
		);
		assert(
			!fixture
				.logs()
				.some(
					(entry) =>
						entry.op === "update" && entry.notes.includes("telemetry:"),
				),
			"instrumented command keeps telemetry in .pi/work-runs by default",
		);
		assert(
			!fixture
				.logs()
				.some(
					(entry) =>
						entry.op === "update" && entry.notes.includes("wo:failure-summary"),
				),
			"recovered subagent retries do not append failure summaries",
		);
	} finally {
		fixture.cleanup();
	}
} finally {
	if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
	rmSync(globalDir, { recursive: true, force: true });
	rmSync(cwd, { recursive: true, force: true });
}

process.stdout.write("ok - work telemetry behavior\n");
