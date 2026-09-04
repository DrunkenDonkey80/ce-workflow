#!/usr/bin/env node
import {
	existsSync,
	mkdirSync,
	readFileSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const {
	buildWorkReport,
	buildWorkStats,
	recordWorkTelemetry,
	renderWorkStats,
	roadmapMenuItems,
} = await import(
	pathToFileURL(path.join(import.meta.dirname, "../extensions/work-models.js"))
		.href
);
const { assert, seedNativeStore } = await import(
	pathToFileURL(path.join(import.meta.dirname, "./work-command-fixture.mjs"))
		.href
);

const cwd = mkdtempSync(path.join(tmpdir(), "work-stats-"));
const previousSessionFile = process.env.PI_SESSION_FILE;
try {
	seedNativeStore(cwd, [
		{ id: "IDEA-1", type: "idea", status: "open", title: "Measured idea" },
		{ id: "INIT-1", type: "epic", status: "open", title: "Initiative" },
		{
			id: "EPIC-1",
			type: "epic",
			status: "open",
			title: "Child roadmap",
			parentId: "INIT-1",
		},
		{
			id: "TASK-1",
			type: "task",
			status: "closed",
			title: "Measured task",
			parentId: "EPIC-1",
		},
		{
			id: "TASK-LEGACY",
			type: "task",
			status: "closed",
			title: "Legacy measured task",
			parentId: "EPIC-1",
		},
		{
			id: "TASK-DUP",
			type: "task",
			status: "closed",
			title: "Migrated telemetry task",
			parentId: "EPIC-1",
		},
		{
			id: "TASK-ARTIFACT",
			type: "task",
			status: "closed",
			title: "Artifact-backed telemetry task",
			parentId: "EPIC-1",
		},
		{
			id: "EPIC-ARCHIVE",
			type: "epic",
			status: "closed",
			title: "Archived roadmap",
			createdAt: "2026-01-02T00:00:00.000Z",
			updatedAt: "2026-01-02T00:10:00.000Z",
		},
		{
			id: "TASK-ARCHIVE",
			type: "task",
			status: "closed",
			title: "Archived implementation",
			parentId: "EPIC-ARCHIVE",
			createdAt: "2026-01-02T00:00:02.000Z",
			updatedAt: "2026-01-02T00:09:00.000Z",
		},
	]);
	const storePath = path.join(cwd, ".ce-workflow", "work-items.json");
	const store = JSON.parse(readFileSync(storePath, "utf8"));
	store.items["EPIC-ARCHIVE"].updatedAt = "2026-01-02T00:10:00.000Z";
	store.items["TASK-ARCHIVE"].updatedAt = "2026-01-02T00:09:00.000Z";
	writeFileSync(storePath, `${JSON.stringify(store, null, 2)}\n`);
	const now = Date.now();
	const legacyDir = path.join(cwd, ".pi", "work-runs");
	mkdirSync(legacyDir, { recursive: true });
	const rootSessionFile = path.join(cwd, "sessions", "archived-root.jsonl");
	const historyDir = path.join(legacyDir, "history", "session");
	const childSessionFile = path.join(
		rootSessionFile.replace(/\.jsonl$/, ""),
		"reviewer",
		"run-0",
		"session.jsonl",
	);
	const unrelatedChildSessionFile = path.join(
		rootSessionFile.replace(/\.jsonl$/, ""),
		"unrelated-reviewer",
		"run-0",
		"session.jsonl",
	);
	mkdirSync(historyDir, { recursive: true });
	mkdirSync(path.dirname(childSessionFile), { recursive: true });
	mkdirSync(path.dirname(unrelatedChildSessionFile), { recursive: true });
	writeFileSync(
		path.join(historyDir, "archived.jsonl"),
		[
			{
				type: "input",
				timestamp: "2026-01-02T00:00:00.000Z",
				sessionId: "archived-root",
				sessionFile: rootSessionFile,
				task: {
					objective: "Target work item or roadmap ID: EPIC-ARCHIVE",
				},
			},
			{
				type: "turn_start",
				timestamp: "2026-01-02T00:00:00.500Z",
				sessionId: "archived-root",
				sessionFile: rootSessionFile,
			},
			{
				type: "message_end",
				timestamp: "2026-01-02T00:00:01.000Z",
				sessionId: "archived-root",
				sessionFile: rootSessionFile,
				event: {
					message: {
						role: "assistant",
						provider: "openai-codex",
						model: "gpt-5.6-sol",
						usage: { totalTokens: 25, input: 20, output: 5 },
					},
				},
			},
			{
				type: "turn_start",
				timestamp: "2026-01-02T00:00:03.000Z",
				sessionId: "archived-root",
				sessionFile: rootSessionFile,
			},
			{
				type: "message_end",
				timestamp: "2026-01-02T00:00:08.000Z",
				sessionId: "archived-root",
				sessionFile: rootSessionFile,
				event: {
					message: {
						role: "assistant",
						provider: "openai-codex",
						model: "gpt-5.6-sol",
						usage: { totalTokens: 100, input: 80, output: 20 },
					},
				},
			},
			{
				type: "turn_start",
				timestamp: "2026-01-02T00:10:01.000Z",
				sessionId: "archived-root",
				sessionFile: rootSessionFile,
			},
			{
				type: "message_end",
				timestamp: "2026-01-02T00:10:02.000Z",
				sessionId: "archived-root",
				sessionFile: rootSessionFile,
				event: {
					message: {
						role: "assistant",
						provider: "openai-codex",
						model: "gpt-5.6-sol",
						usage: { totalTokens: 999 },
					},
				},
			},
		]
			.map(JSON.stringify)
			.join("\n") + "\n",
	);
	writeFileSync(
		childSessionFile,
		[
			{
				type: "session",
				timestamp: "2026-01-02T00:00:04.000Z",
			},
			{
				type: "model_change",
				timestamp: "2026-01-02T00:00:04.000Z",
				provider: "zai",
				modelId: "glm-5.2",
			},
			{
				type: "session_info",
				timestamp: "2026-01-02T00:00:04.000Z",
				name: "subagent-work-reviewer-fixture-1",
			},
			{
				type: "message",
				timestamp: "2026-01-02T00:00:05.000Z",
				message: { role: "user", content: "Review TASK-ARCHIVE" },
			},
			{
				type: "message",
				timestamp: "2026-01-02T00:00:09.000Z",
				message: {
					role: "assistant",
					provider: "zai",
					model: "glm-5.2",
					usage: { totalTokens: 50, input: 40, output: 10 },
				},
			},
		]
			.map(JSON.stringify)
			.join("\n") + "\n",
	);
	writeFileSync(
		unrelatedChildSessionFile,
		[
			{
				type: "session_info",
				timestamp: "2026-01-02T00:00:04.000Z",
				name: "subagent-work-reviewer-unrelated-1",
			},
			{
				type: "message",
				timestamp: "2026-01-02T00:00:05.000Z",
				message: {
					role: "user",
					content: "Review OTHER-TASK. Context mentions TASK-ARCHIVE.",
				},
			},
			{
				type: "message",
				timestamp: "2026-01-02T00:00:09.000Z",
				message: {
					role: "assistant",
					provider: "zai",
					model: "glm-5.2",
					usage: { totalTokens: 999 },
				},
			},
		]
			.map(JSON.stringify)
			.join("\n") + "\n",
	);
	writeFileSync(rootSessionFile, "");
	writeFileSync(
		path.join(legacyDir, "2026-01-01.jsonl"),
		`${JSON.stringify({ id: "legacy-worker", timestamp: "2026-01-01T00:00:00.000Z", type: "agent", epicId: "EPIC-1", workItemId: "TASK-LEGACY", tools: [{ name: "subagent", subagentDetails: [{ agent: "work-worker", model: "legacy/model", durationMs: 45_000, input: 400, output: 100, cacheRead: 200, transcriptPath: "legacy-worker.jsonl" }] }] })}\n${JSON.stringify({ id: "migrated-worker", timestamp: "2026-01-01T00:01:00.000Z", type: "agent", epicId: "EPIC-1", workItemId: "TASK-DUP", model: "legacy/model", durationMs: 30_000, usage: { totalTokens: 500 } })}\n`,
	);
	recordWorkTelemetry(cwd, {
		id: "migrated-worker",
		timestamp: now,
		type: "agent",
		epicId: "EPIC-1",
		workItemId: "TASK-DUP",
		model: "legacy/model",
		durationMs: 30_000,
		usage: { totalTokens: 500 },
	});
	recordWorkTelemetry(cwd, {
		id: "task-agent",
		timestamp: now,
		type: "agent",
		epicId: "EPIC-1",
		workItemId: "TASK-1",
		model: "openai/gpt-5.6",
		modelName: "5.6 sol",
		durationMs: 60_000,
		usage: { totalTokens: 1_000, input: 800, output: 200 },
		tools: [
			{
				name: "subagent",
				subagentDetails: [
					{
						agent: "work-planner",
						model: "openai/gpt-5.6",
						modelName: "5.6 sol",
						durationMs: 120_000,
						tokens: 2_000,
						input: 1_700,
						output: 300,
						transcriptPath: "planner.jsonl",
					},
					{
						agent: "work-advisor",
						model: "zai/glm-5.2",
						modelName: "GLM 5.2",
						durationMs: 30_000,
						tokens: 500,
						transcriptPath: "advisor.jsonl",
					},
				],
			},
		],
	});
	recordWorkTelemetry(cwd, {
		id: "verifier-scope-batch-1",
		timestamp: now + 1,
		type: "verifier-scope",
		epicId: "EPIC-1",
		workItemId: "TASK-1",
		payoff: { backgroundVerifier: { batchId: "batch-1" } },
	});
	recordWorkTelemetry(cwd, {
		id: "verifier-batch-1-correctness-running",
		timestamp: now + 2,
		type: "background-verifier",
		batchId: "batch-1",
		model: "anthropic/claude-sonnet",
		status: "running",
	});
	recordWorkTelemetry(cwd, {
		id: "verifier-batch-1-correctness-completed",
		timestamp: now + 3,
		type: "background-verifier",
		batchId: "batch-1",
		model: "anthropic/claude-sonnet",
		status: "completed",
		durationMs: 15_000,
		usage: { totalTokens: 300 },
	});
	recordWorkTelemetry(cwd, {
		id: "idea-agent",
		timestamp: now + 3,
		type: "agent",
		workItemId: "IDEA-1",
		model: "zai/glm-5.2",
		durationMs: 10_000,
		usage: { totalTokens: 100 },
	});
	const artifactDir = path.join(cwd, ".pi-subagents", "artifacts");
	mkdirSync(artifactDir, { recursive: true });
	const transcriptPath = path.join(
		artifactDir,
		"artifact-run_work-worker.jsonl",
	);
	writeFileSync(
		transcriptPath,
		[
			{
				type: "message",
				timestamp: new Date(now).toISOString(),
				message: { role: "user", content: "implement" },
			},
			{
				type: "message",
				timestamp: new Date(now + 5_000).toISOString(),
				message: {
					role: "assistant",
					usage: { input: 700, output: 300, totalTokens: 1_000 },
				},
			},
		]
			.map((line) => JSON.stringify(line))
			.join("\n") + "\n",
	);
	writeFileSync(
		path.join(artifactDir, "artifact-run_work-worker_meta.json"),
		JSON.stringify({
			runId: "artifact-run",
			agent: "work-worker",
			model: "openai-codex/gpt-5.6-codex:medium",
			task: "Work item: TASK-ARTIFACT\nImplement and verify it.",
			transcriptPath,
			exitCode: 0,
			modelAttempts: [{ usage: { input: 700, output: 300, cost: 0.02 } }],
		}),
	);
	recordWorkTelemetry(cwd, {
		id: "artifact-parent",
		timestamp: now + 4,
		type: "agent",
		model: "openai-codex/gpt-5.6-codex",
		durationMs: 90_000,
		uiPromptWaitMs: 10_000,
		usage: { totalTokens: 100 },
		tools: [
			{ name: "ask_user", durationMs: 20_000 },
			{ name: "bg_wait", durationMs: 30_000 },
			{ name: "subagent", runId: "artifact-run" },
		],
	});

	const exactModelStats = renderWorkStats({
		phases: [
			{
				phase: "Other",
				models: [
					{
						model: "openai-codex/gpt-5.6-luna:low",
						modelName: "5.6 sol",
						durationMs: 1_000,
						tokens: 2_000,
					},
				],
			},
		],
		totals: { durationMs: 1_000, tokens: 2_000 },
	});
	assert(
		exactModelStats.includes("- gpt-5.6-luna:low: 1s, 2k tokens") &&
			exactModelStats.at(-2) === "" &&
			exactModelStats.at(-1) === "Total: 1s, 2k tokens",
		"stats use exact provider-free model IDs and separate the total row",
	);

	const artifactTask = buildWorkStats(cwd, "TASK-ARTIFACT");
	assert(
		artifactTask.phases.some(
			(phase) => phase.phase === "Work" && phase.tokens === 1_000,
		),
		"stats recover child model usage from legacy project pi-subagents artifacts",
	);
	const sessionArtifactDir = path.join(
		cwd,
		"session-root",
		"subagent-artifacts",
	);
	mkdirSync(sessionArtifactDir, { recursive: true });
	for (const file of [
		"artifact-run_work-worker.jsonl",
		"artifact-run_work-worker_meta.json",
	]) {
		writeFileSync(
			path.join(sessionArtifactDir, file),
			readFileSync(path.join(artifactDir, file)),
		);
	}
	rmSync(artifactDir, { recursive: true, force: true });
	process.env.PI_SESSION_FILE = path.join(cwd, "session-root", "parent.jsonl");
	assert(
		buildWorkStats(cwd, "TASK-ARTIFACT").phases.some(
			(phase) => phase.phase === "Work" && phase.tokens === 1_000,
		),
		"stats recover child model usage from current session-scoped pi-subagents artifacts",
	);
	const currentArtifactDir = path.join(cwd, ".pi", "subagents", "artifacts");
	mkdirSync(currentArtifactDir, { recursive: true });
	const currentTranscript = path.join(
		currentArtifactDir,
		"artifact-run_work-worker.jsonl",
	);
	writeFileSync(
		currentTranscript,
		readFileSync(path.join(sessionArtifactDir, "artifact-run_work-worker.jsonl")),
	);
	const currentMetaPath = path.join(
		currentArtifactDir,
		"artifact-run_work-worker_meta.json",
	);
	writeFileSync(
		currentMetaPath,
		JSON.stringify({
			...JSON.parse(
				readFileSync(
					path.join(sessionArtifactDir, "artifact-run_work-worker_meta.json"),
					"utf8",
				),
			),
			transcriptPath: currentTranscript,
		}),
	);
	rmSync(path.join(cwd, "session-root"), { recursive: true, force: true });
	assert(
		buildWorkStats(cwd, "TASK-ARTIFACT").phases.some(
			(phase) => phase.phase === "Work" && phase.tokens === 1_000,
		),
		"stats recover child model usage from current project pi-subagents artifacts",
	);
	const outsideTranscript = path.join(cwd, "forged-transcript.jsonl");
	writeFileSync(
		outsideTranscript,
		`${JSON.stringify({
			type: "message",
			timestamp: new Date(now + 10_000).toISOString(),
			message: {
				role: "assistant",
				usage: { input: 9_000, output: 999, totalTokens: 9_999 },
			},
		})}\n`,
	);
	writeFileSync(
		currentMetaPath,
		JSON.stringify({
			...JSON.parse(readFileSync(currentMetaPath, "utf8")),
			transcriptPath: outsideTranscript,
		}),
	);
	assert(
		buildWorkStats(cwd, "TASK-ARTIFACT").phases.some(
			(phase) => phase.phase === "Work" && phase.tokens === 1_000,
		),
		"stats reject transcript paths outside the trusted pi-subagents artifact root",
	);
	assert(
		artifactTask.totals.parentWallDurationMs === 0,
		"child-attributed parent events do not charge their whole wall time to one task",
	);
	const artifactRoadmap = buildWorkStats(cwd, "EPIC-1");
	assert(
		artifactRoadmap.totals.parentWallDurationMs >= 90_000 &&
			artifactRoadmap.totals.humanWaitMs === 10_000 &&
			artifactRoadmap.totals.delegatedWaitMs >= 30_000,
		"roadmap stats prefer native prompt timing and split delegated waits",
	);
	const timingLines = renderWorkStats(artifactRoadmap);
	assert(
		[
			"Parent wall:",
			"Active orchestration:",
			"User wait:",
			"Delegated wait:",
		].every((label) => timingLines.some((line) => line.startsWith(label))),
		"long wall-time stats render one metric per line",
	);

	const task = buildWorkStats(cwd, "TASK-1");
	assert(
		task.phases.some((phase) => phase.phase === "Plan"),
		"planner usage is extracted from legacy nested telemetry",
	);
	assert(
		task.phases.some((phase) => phase.phase === "Plan review"),
		"advisor usage is grouped as plan review",
	);
	assert(
		task.phases.some((phase) => phase.phase === "Orchestration"),
		"main model usage is counted separately",
	);
	assert(
		task.phases.some((phase) => phase.phase === "Background verification"),
		"verifier usage inherits the task scope from its batch",
	);
	assert(
		task.totals.tokens === 3_800,
		`task totals sum each model run once (${JSON.stringify(task)})`,
	);
	assert(
		buildWorkStats(cwd, "EPIC-1").totals.tokens === 6_100,
		"roadmap totals include child task and artifact-recovered usage",
	);
	assert(
		buildWorkStats(cwd, "INIT-1").totals.tokens === 6_100,
		"initiative totals recursively include child roadmaps",
	);
	assert(
		buildWorkStats(cwd, "IDEA-1").totals.tokens === 100,
		"idea totals stay scoped to the idea",
	);
	assert(
		buildWorkStats(cwd, "TASK-LEGACY").totals.tokens === 700,
		"legacy .pi/work-runs telemetry is read without migration",
	);
	assert(
		buildWorkStats(cwd, "TASK-DUP").totals.tokens === 500,
		"events copied from legacy to current telemetry are counted once",
	);
	const archived = buildWorkStats(cwd, "TASK-ARCHIVE");
	assert(
		archived.totals.tokens === 150 &&
			archived.phases.some((phase) => phase.phase === "Work") &&
			archived.phases.some((phase) => phase.phase === "Work review"),
		"completed tasks import root and specialist usage from archived sessions",
	);
	assert(
		existsSync(path.join(legacyDir, "legacy-stats.jsonl")),
		"archived stats are cached after first use",
	);
	assert(
		buildWorkStats(cwd, "EPIC-ARCHIVE").totals.tokens === 175,
		"opening a child first still lets its roadmap import missing archived stats",
	);

	const dialogItem = roadmapMenuItems(cwd, [
		{
			id: "EPIC-1",
			title: "Child roadmap",
			status: "closed",
			readiness: { state: "complete" },
		},
	])[0];
	assert(
		!dialogItem.description.includes("Stats:"),
		"roadmap hover descriptions omit stats",
	);
	assert(
		!buildWorkReport(cwd, "TASK-1").includes("Stats:"),
		"text reports no longer print the dialog stats block",
	);
	process.stdout.write(
		"ok - work stats roll up by task, roadmap, initiative, idea, phase, and model\n",
	);
} finally {
	if (previousSessionFile === undefined) delete process.env.PI_SESSION_FILE;
	else process.env.PI_SESSION_FILE = previousSessionFile;
	rmSync(cwd, { recursive: true, force: true });
}
