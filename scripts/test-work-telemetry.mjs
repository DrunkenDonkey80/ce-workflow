#!/usr/bin/env node
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

const {
	buildWorkTelemetry,
	buildWorkTelemetryState,
	default: workModelsExtension,
	recordWorkTelemetry,
} = await import(
	pathToFileURL(
		realpathSync(
			path.join(import.meta.dirname, "../extensions/work-models.js"),
		),
	).href
);
const { installWorkflowFixture } = await import(
	pathToFileURL(
		realpathSync(path.join(import.meta.dirname, "work-command-fixture.mjs")),
	).href
);

function assert(ok, message) {
	if (!ok) throw new Error(message);
}

const cwd = mkdtempSync(path.join(tmpdir(), "work-telemetry-"));
const now = Date.now();
try {
	recordWorkTelemetry(cwd, {
		id: "cmd-small",
		timestamp: now,
		type: "command",
		command: "work-small",
		action: "run-implementation",
		stopReason: "handoff-queued",
		handoff: { queued: true, started: false, role: "worker" },
		epicId: "E-1",
		beadId: "TASK-1",
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
		beadId: "TASK-1",
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
		beadId: "TASK-1",
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
		beadId: "TASK-1",
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
		beadId: "TASK-1",
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
		beadId: "PLAN-1",
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
		beadId: "PLAN-1",
		durationMs: 300_000,
		usage: { input: 6000, output: 1200, totalTokens: 7200, cost: 0.08 },
		context: { after: { tokens: 15_000 } },
	});

	const text = buildWorkTelemetry(cwd, "today");
	assert(text.includes("Work telemetry: today"), "text renders today summary");
	assert(text.includes("work-small"), "text includes work-small command phase");
	assert(text.includes("work-big"), "text includes work-big command phase");
	assert(text.includes("TASK-1"), "text groups by task bead");
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

	const bead = JSON.parse(buildWorkTelemetry(cwd, "bead TASK-1 --json"));
	assert(bead.events === 5, "bead filter isolates one task");
	assert(bead.byBead[0].key === "TASK-1", "bead JSON groups by selected bead");
	assert(bead.files.length === 1, "json reports backing telemetry file");
	assert(
		!Array.isArray(bead.slowest[0].tools) && bead.slowest[0].tools.count >= 0,
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
			beadId: "BLOCKER-1",
			reason:
				"No runnable Bead is ready; blockers or decisions need attention.",
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

	const fixture = installWorkflowFixture();
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
		const commandSummary = buildWorkTelemetryState(cwd, "bead TASK-NEW-1");
		assert(commandSummary.events === 1, "extension command writes telemetry");
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
			"print mode fails safely before creating a queued or duplicate Bead",
		);

		fixture.reset("blocked");
		const statusNotices = [];
		await commands["work-status"].handler("E-1", {
			cwd,
			getContextUsage: () => ({ tokens: 2222 }),
			ui: { notify: (message) => statusNotices.push(message) },
		});
		assert(
			statusNotices[0]?.includes("blockers: 1") &&
				statusNotices[0].includes("Next: Run /work-report BLOCK-1"),
			"work-status reports blocked Beads instead of only active/ready state",
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
			args: JSON.stringify({ agent: "bead-planner" }),
		});
		await hooks.tool_execution_end(
			{
				toolCallId: "subagent-retry",
				toolName: "subagent",
				isError: false,
				result: {
					details: {
						results: [
							{ agent: "bead-planner", status: "failed" },
							{ agent: "bead-planner", status: "completed" },
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
							"Planning boundary complete and pushed. Created next ready Bead TASK-NEW-2.",
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
		const reviewSummary = buildWorkTelemetryState(cwd, "bead TASK-NEW-1");
		assert(
			reviewSummary.slowest.some(
				(event) =>
					event.review?.scope === "bead TASK-NEW-1" &&
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
			"TASK-NEW-1",
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
			historyLines.every((line) => line.task.beadId === "TASK-NEW-1"),
			"self-improving history is grouped by Bead task",
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
	rmSync(cwd, { recursive: true, force: true });
}

console.log("ok - work telemetry behavior");
