#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const {
	buildWorkStats,
	default: workModelsExtension,
	launchCurrentTaskReadOnlyLanes,
	materializeVerifierAnalysis,
} = await import(
	pathToFileURL(path.join(import.meta.dirname, "../extensions/work-models.js"))
		.href
);
const {
	addFinding,
	createBatch,
	loadVerifierStore,
	mutateVerifierStore,
	recordOperationResult,
	verifierStatus,
} = await import(
	pathToFileURL(
		path.join(import.meta.dirname, "../extensions/background-verifiers.js"),
	).href
);
const { assert, seedNativeStore } = await import(
	pathToFileURL(path.join(import.meta.dirname, "./work-command-fixture.mjs"))
		.href
);

const cwd = mkdtempSync(path.join(tmpdir(), "work-verifier-flow-"));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = path.join(cwd, ".empty-agent");
const git = (...args) =>
	execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" }).trim();
try {
	git("init", "-q");
	git("config", "user.email", "verifier@example.invalid");
	git("config", "user.name", "Verifier Flow Test");
	writeFileSync(path.join(cwd, "README.md"), "# verifier flow\n");
	git("add", "README.md");
	git("commit", "-qm", "initial");
	mkdirSync(path.join(cwd, ".pi"), { recursive: true });
	writeFileSync(
		path.join(cwd, ".pi", "settings.json"),
		`${JSON.stringify({ workOrchestrator: { backgroundVerifiers: { "fixture/verifier": { operations: ["correctness", "performance"], thinking: "low" }, "anthropic/claude-opus-5": { operations: ["correctness"], thinking: "high" } } } })}\n`,
	);

	const hooks = {};
	const rpcListeners = new Map();
	const launches = [];
	const followUps = [];
	const events = {
		on(name, handler) {
			const listeners = rpcListeners.get(name) ?? new Set();
			listeners.add(handler);
			rpcListeners.set(name, listeners);
			return () => listeners.delete(handler);
		},
		emit(name, payload) {
			if (name !== "subagents:rpc:v1:request") return;
			launches.push(payload.params);
			const asyncDir = path.join(cwd, ".runtime", `run-${launches.length}`);
			mkdirSync(asyncDir, { recursive: true });
			for (const listener of rpcListeners.get(
				`subagents:rpc:v1:reply:${payload.requestId}`,
			) ?? [])
				listener({
					success: true,
					data: {
						details: {
							asyncId: `run-${launches.length}`,
							asyncDir,
						},
					},
				});
		},
	};
	const pi = {
		events,
		on: (name, handler) => {
			hooks[name] = handler;
		},
		registerCommand: () => {},
		sendUserMessage: async (text, options) => {
			followUps.push({ text, options });
		},
	};
	workModelsExtension(pi);
	let aborts = 0;
	const ctx = {
		cwd,
		model: { provider: "fixture", id: "main", name: "Main" },
		getContextUsage: () => ({ tokens: 0 }),
		isIdle: () => true,
		abort: () => {
			aborts += 1;
		},
		ui: { notify: () => {}, setStatus: () => {}, setTitle: () => {} },
	};
	const prompt = [
		"work-orchestrator",
		"mode: resume",
		"Workflow Run ID: verifier-flow",
		"Activity: implementation",
		"Action: run-implementation",
		"Epic: EPIC-1",
		"Selected WorkItem: TASK-1",
	].join("\n");
	await hooks.before_agent_start({ prompt, systemPrompt: "" }, ctx);
	await hooks.agent_start({}, ctx);

	seedNativeStore(cwd, [
		{ id: "EPIC-1", type: "epic", status: "open", title: "Verifier epic" },
		{
			id: "TASK-1",
			type: "task",
			status: "closed",
			title: "Completed task",
			parentId: "EPIC-1",
		},
	]);
	writeFileSync(
		path.join(cwd, "feature.js"),
		"export const completed = true;\n",
	);
	git("add", ".ce-workflow/work-items.json", "feature.js");
	git("commit", "-qm", "complete TASK-1");

	await hooks.agent_end(
		{ messages: [{ role: "assistant", content: "Completed TASK-1." }] },
		ctx,
	);
	await hooks.agent_settled({}, ctx);
	let store;
	for (let index = 0; index < 20; index += 1) {
		await new Promise((resolve) => setImmediate(resolve));
		store = loadVerifierStore(cwd);
		if (
			launches.length === 2 &&
			Object.values(store.jobs).every((job) => job.launch?.status === "running")
		)
			break;
	}
	store ??= loadVerifierStore(cwd);
	assert(
		launches.length === 2,
		`completed task commit fires every configured background verifier (${JSON.stringify({ batches: Object.values(store.batches), jobs: Object.values(store.jobs).map((job) => ({ status: job.status, launch: job.launch?.status, failure: job.launch?.failure })) })})`,
	);
	const fixtureLaunch = launches.find(
		(launch) => launch.model === "fixture/verifier:low",
	);
	const opusLaunch = launches.find(
		(launch) => launch.model === "anthropic/claude-opus-5:high",
	);
	assert(fixtureLaunch && opusLaunch, "both configured verifier models launch");
	assert(
		launches.every((launch) => launch.agent === "work-background-verifier"),
		"completion launches the verifier role",
	);
	assert(
		fixtureLaunch?.thinking === undefined,
		"the requested verifier thinking level is encoded in the model override",
	);
	assert(
		fixtureLaunch?.outputSchema?.required?.join(",") ===
			"version,jobId,model,checkpoint,results" &&
			fixtureLaunch.outputSchema.properties.results.minItems === 2 &&
			fixtureLaunch.outputSchema.properties.results.maxItems === 2,
		"verifier output requires one result for every requested operation",
	);
	assert(
		fixtureLaunch?.task.includes("Never print a tool-call object as text"),
		"verifier instructions reject textual pseudo-tool calls",
	);
	assert(
		fixtureLaunch?.output === undefined &&
			fixtureLaunch.outputMode === undefined,
		"structured verifier output does not request an impossible agent-side file write",
	);
	assert(
		fixtureLaunch?.paths.includes("feature.js"),
		"verifier receives the completed task source path",
	);
	assert(
		!fixtureLaunch?.paths.some((file) => file.startsWith(".ce-workflow/")),
		"workflow state is excluded from verifier source paths",
	);
	const job = Object.values(store.jobs).find(
		(candidate) => candidate.model === "fixture/verifier",
	);
	assert(
		job?.launch?.status === "running",
		"verifier launch is durably recorded as running",
	);
	const opusJob = Object.values(store.jobs).find(
		(candidate) => candidate.model === "anthropic/claude-opus-5",
	);
	assert(
		opusJob?.launch?.status === "running" && opusLaunch,
		"Opus launches after its provider adapter passes the live checkpoint-tool probe",
	);
	assert(
		buildWorkStats(cwd, "TASK-1").phases.some((phase) =>
			phase.models.some((model) => model.model === "fixture/main"),
		),
		"completed task telemetry persists the orchestration model",
	);
	const batchCount = Object.keys(store.batches).length;
	await launchCurrentTaskReadOnlyLanes(
		cwd,
		[
			{
				laneKind: "discovery",
				workItemId: "TASK-1",
				generation: 1,
				relevantPaths: ["feature.js"],
				resourceKeys: ["repo:read"],
				workflowRunId: "read-only-attribution",
			},
		],
		{
			spawn: async () => ({
				ok: true,
				completed: true,
				data: { runId: "read-only-1" },
			}),
		},
	);
	assert(
		Object.keys(loadVerifierStore(cwd).batches).length === batchCount,
		"read-only lane settlement is separate from activeWorkAgent commit attribution",
	);
	const asyncDir = path.join(
		cwd,
		".runtime",
		`run-${launches.indexOf(fixtureLaunch) + 1}`,
	);
	const structuredOutput = path.join(asyncDir, "structured-output.json");
	const checkpoint = store.batches[job.batchId].checkpoint;
	writeFileSync(
		structuredOutput,
		JSON.stringify({
			version: 1,
			jobId: job.id,
			model: job.model,
			checkpoint,
			results: [
				{
					jobId: job.id,
					model: job.model,
					checkpoint,
					operation: "correctness",
					outcome: "findings",
					findings: [
						{
							path: "feature.js",
							startLine: 1,
							endLine: 1,
							category: "fixture-correctness",
							severity: "high",
							rationale: "The fixture needs review.",
							evidence: "The exported value is fixed.",
							suggestion: "Confirm the intended value.",
						},
					],
				},
				{
					jobId: job.id,
					model: job.model,
					checkpoint,
					operation: "performance",
					outcome: "no-findings",
				},
			],
		}),
	);
	writeFileSync(
		path.join(asyncDir, "status.json"),
		JSON.stringify({
			state: "completed",
			steps: [{ structuredOutputPath: structuredOutput }],
		}),
	);
	const opusAsyncDir = path.join(
		cwd,
		".runtime",
		`run-${launches.indexOf(opusLaunch) + 1}`,
	);
	const opusStructuredOutput = path.join(
		opusAsyncDir,
		"structured-output.json",
	);
	writeFileSync(
		opusStructuredOutput,
		JSON.stringify({
			version: 1,
			jobId: opusJob.id,
			model: opusJob.model,
			checkpoint,
			results: [
				{
					jobId: opusJob.id,
					model: opusJob.model,
					checkpoint,
					operation: "correctness",
					outcome: "no-findings",
				},
			],
		}),
	);
	writeFileSync(
		path.join(opusAsyncDir, "status.json"),
		JSON.stringify({
			state: "completed",
			steps: [{ structuredOutputPath: opusStructuredOutput }],
		}),
	);
	const completion = {
		message: {
			role: "custom",
			customType: "intercom_message",
			content: "subagent results: Step 0 (work-background-verifier): completed",
		},
	};
	await hooks.message_end(completion, ctx);
	assert(
		aborts === 1 &&
			followUps.length === 0 &&
			loadVerifierStore(cwd).batches[job.batchId].presentationStatus ===
				"pending",
		"the verifier wake turn is aborted before synthesis is queued",
	);
	const hiddenWakeAbort = await hooks.message_end(
		{
			message: {
				role: "assistant",
				content: [],
				stopReason: "aborted",
				errorMessage: "Operation aborted",
			},
		},
		ctx,
	);
	assert(
		hiddenWakeAbort?.message?.stopReason === "stop" &&
			!hiddenWakeAbort.message.errorMessage,
		"the internal verifier wake cancellation is not shown as Operation aborted",
	);
	await hooks.agent_settled({}, ctx);
	assert(
		followUps.length === 0 &&
			loadVerifierStore(cwd).batches[job.batchId].purpose === "verification" &&
			loadVerifierStore(cwd).batches[job.batchId].presentationStatus ===
				"pending",
		"ordinary completion verification remains in raw triage and never enters Analyze synthesis",
	);
	if (followUps.length) {
		await hooks.before_agent_start(
			{ prompt: followUps[0].text, systemPrompt: "" },
			ctx,
		);
		await hooks.agent_start({}, ctx);
		assert(
			(await hooks.message_end(
				{
					message: {
						role: "assistant",
						content: [{ type: "text", text: "Inspecting current source." }],
						stopReason: "toolUse",
					},
				},
				ctx,
			)) === undefined,
			"intermediate synthesis tool turns are never persisted as the report",
		);
		const firstCheckpoint =
			loadVerifierStore(cwd).batches[job.batchId].checkpoint;
		const newerCheckpoint = {
			...firstCheckpoint,
			snapshot: "c".repeat(40),
			patchHash: "d".repeat(64),
		};
		const newerBatch = mutateVerifierStore(cwd, (state) =>
			createBatch(state, {
				checkpoint: newerCheckpoint,
				profiles: [
					{
						model: "fixture/newer",
						operations: ["correctness"],
						thinking: "low",
					},
				],
				now: "2099-01-01T00:00:00.000Z",
			}),
		);
		const newerJob = Object.values(loadVerifierStore(cwd).jobs).find(
			(candidate) => candidate.batchId === newerBatch.id,
		);
		const newerReport = mutateVerifierStore(cwd, (state) =>
			recordOperationResult(state, {
				jobId: newerJob.id,
				operation: "correctness",
				outcome: "findings",
				now: "2099-01-01T00:00:01.000Z",
			}),
		);
		mutateVerifierStore(cwd, (state) =>
			addFinding(state, {
				reportId: newerReport.id,
				operation: "correctness",
				model: newerJob.model,
				checkpoint: newerCheckpoint,
				path: "feature.js",
				startLine: 1,
				endLine: 1,
				category: "correctness",
				severity: "high",
				rationale: "newer race",
				evidence: "feature.js:1",
				suggestedAction: "fix newer race",
				now: "2099-01-01T00:00:02.000Z",
			}),
		);
		seedNativeStore(cwd, []);
		const synthesis = await hooks.message_end(
			{
				message: {
					role: "assistant",
					content: [
						{
							type: "text",
							text: "# Background analysis\n\n## Actionable items\n\n### 1. Fix the race\n\n- **Priority:** P1\n- **Source:** `feature.js:1`\n- **Root cause:** The update is not serialized.\n- **Evidence:** Concurrent calls overlap.\n- **Recommendation:** Serialize the update.\n\n### 2. Clean up state\n\n- **Priority:** P2\n- **Source:** `feature.js:1`\n- **Root cause:** Cleanup is incomplete.\n- **Evidence:** State remains set.\n- **Recommendation:** Reset state in finally.\n",
						},
					],
					stopReason: "stop",
				},
			},
			ctx,
		);
		const reportPath = synthesis?.message?.content?.[0]?.text
			?.split("Analysis report: ")[1]
			?.split("\n")[0];
		const synthesizedText = synthesis.message.content[0].text;
		const synthesizedItems = Object.values(
			JSON.parse(
				readFileSync(path.join(cwd, ".ce-workflow", "work-items.json"), "utf8"),
			).items,
		);
		const synthesizedTasks = synthesizedItems.filter((item) => item.parentId);
		const raceTask = synthesizedTasks.find(
			(item) => item.title === "Fix the race",
		);
		const cleanupTask = synthesizedTasks.find(
			(item) => item.title === "Clean up state",
		);
		assert(
			reportPath &&
				existsSync(reportPath) &&
				(process.platform === "win32" ||
					((statSync(path.dirname(reportPath)).mode & 0o077) === 0 &&
						(statSync(reportPath).mode & 0o077) === 0)) &&
				readFileSync(reportPath, "utf8").includes("## Actionable items") &&
				synthesizedText.includes("2 synthesized items") &&
				synthesizedText.includes("F7 → Resume work") &&
				!synthesizedText.includes("Feed this file") &&
				synthesizedItems.some((item) => item.labels?.includes("wo:misc")) &&
				synthesizedTasks.length === 2 &&
				raceTask.labels.includes("wo:analysis") &&
				raceTask.labels.includes("wo:debug") &&
				cleanupTask.dependencies.includes(raceTask.id) &&
				loadVerifierStore(cwd).batches[job.batchId].presentationStatus ===
					"queued",
			"completed synthesis persists its report and materializes its merged items under Misc",
		);
		assert(
			verifierStatus(loadVerifierStore(cwd)) === "completed-awaiting-triage",
			"a newer batch that was not represented by the report remains triageable",
		);
		const newerMarkdown = `# Background analysis

## Actionable items

### 1. Fix the newest race

${requiredItemFields}`;
		const newerReportPath = path.join(path.dirname(reportPath), "newer.md");
		writeFileSync(newerReportPath, newerMarkdown);
		mutateVerifierStore(cwd, (state) => {
			state.batches[newerBatch.id].presentationStatus = "queued";
			state.batches[newerBatch.id].presentedAt = "2099-01-01T00:00:03.000Z";
		});
		const newerMaterialization = materializeVerifierAnalysis(cwd, {
			batchIds: [newerBatch.id],
			markdown: newerMarkdown,
			reportPath: newerReportPath,
		});
		materializeVerifierAnalysis(cwd, {
			batchIds: [newerBatch.id],
			markdown: newerMarkdown,
			reportPath: newerReportPath,
		});
		const repeatedItems = Object.values(
			JSON.parse(
				readFileSync(path.join(cwd, ".ce-workflow", "work-items.json"), "utf8"),
			).items,
		);
		assert(
			newerMaterialization.count === 1 &&
				repeatedItems.filter(
					(item) =>
						item.status === "open" && item.labels?.includes("wo:analysis"),
				).length === 1 &&
				repeatedItems.filter((item) => item.labels?.includes("wo:analysis"))
					.length === 3 &&
				repeatedItems
					.filter(
						(item) => item.title !== "Fix the newest race" && item.parentId,
					)
					.every((item) => item.status === "closed") &&
				verifierStatus(loadVerifierStore(cwd)) === "fully-triaged",
			"a newer synthesis supersedes prior active tasks, is idempotent, and suppresses covered raw findings",
		);
		seedNativeStore(cwd, []);
		await hooks.session_start({}, ctx);
		assert(
			Object.values(
				JSON.parse(
					readFileSync(
						path.join(cwd, ".ce-workflow", "work-items.json"),
						"utf8",
					),
				).items,
			).filter((item) => item.parentId && item.labels?.includes("wo:analysis"))
				.length === 1,
			"session startup rematerializes the latest synthesized list without duplicates",
		);
		const emptyReportPath = path.join(path.dirname(reportPath), "empty.md");
		const emptyMarkdown =
			"# Background analysis\n\n## Actionable items\n\nNone.\n";
		writeFileSync(emptyReportPath, emptyMarkdown);
		materializeVerifierAnalysis(cwd, {
			batchIds: [newerBatch.id],
			markdown: emptyMarkdown,
			reportPath: emptyReportPath,
		});
		assert(
			Object.values(
				JSON.parse(
					readFileSync(
						path.join(cwd, ".ce-workflow", "work-items.json"),
						"utf8",
					),
				).items,
			).every(
				(item) =>
					item.status !== "open" || !item.labels?.includes("wo:analysis"),
			),
			"an empty latest synthesis closes previously active analysis tasks",
		);
		rmSync(path.dirname(reportPath), { recursive: true, force: true });
		await hooks.agent_settled({}, ctx);
		await hooks.agent_start({}, ctx);
		await hooks.message_end(completion, ctx);
		assert(
			aborts === 2 && followUps.length === 1,
			"a later completion banner is hidden without duplicating the synthesis",
		);
		const hiddenAbort = await hooks.message_end(
			{
				message: {
					role: "assistant",
					content: [],
					stopReason: "aborted",
					errorMessage: "Operation aborted",
				},
			},
			ctx,
		);
		assert(
			hiddenAbort?.message?.stopReason === "stop" &&
				!hiddenAbort.message.errorMessage,
			"the internal verifier wake cancellation is not shown as Operation aborted",
		);
		await hooks.agent_settled({}, ctx);
		await hooks.before_agent_start(
			{ prompt: "Current user request", systemPrompt: "" },
			ctx,
		);
		await hooks.message_end(completion, ctx);
		assert(
			aborts === 2,
			"a verifier notification cannot abort a pending prompt-backed user turn",
		);
		await hooks.agent_start({}, ctx);
		await hooks.message_end(completion, ctx);
		assert(
			aborts === 2,
			"a verifier notification cannot abort an active prompt-backed user turn",
		);
		assert(
			(await hooks.message_end(
				{
					message: {
						role: "assistant",
						content: [],
						stopReason: "aborted",
						errorMessage: "User aborted",
					},
				},
				ctx,
			)) === undefined,
			"real user aborts remain visible",
		);
	}
	process.stdout.write(
		"ok - completed task commit fires a background verifier in a disposable repository\n",
	);
} finally {
	if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
	rmSync(cwd, { recursive: true, force: true });
}
