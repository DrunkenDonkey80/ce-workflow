#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const { buildWorkStats, default: workModelsExtension } = await import(
	pathToFileURL(path.join(import.meta.dirname, "../extensions/work-models.js"))
		.href
);
const { loadVerifierStore } = await import(
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
		`${JSON.stringify({ workOrchestrator: { backgroundVerifiers: { "fixture/verifier": { operations: ["correctness"], thinking: "low" } } } })}\n`,
	);

	const hooks = {};
	const rpcListeners = new Map();
	const launches = [];
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
					data: { runId: `run-${launches.length}`, asyncDir },
				});
		},
	};
	const pi = {
		events,
		on: (name, handler) => {
			hooks[name] = handler;
		},
		registerCommand: () => {},
	};
	workModelsExtension(pi);
	const ctx = {
		cwd,
		model: { provider: "fixture", id: "main", name: "Main" },
		getContextUsage: () => ({ tokens: 0 }),
		isIdle: () => true,
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
			launches.length > 0 &&
			Object.values(store.jobs).some((job) => job.launch?.status === "running")
		)
			break;
	}
	store ??= loadVerifierStore(cwd);
	assert(
		launches.length === 1,
		`completed task commit fires one background verifier (${JSON.stringify({ batches: Object.values(store.batches), jobs: Object.values(store.jobs).map((job) => ({ status: job.status, launch: job.launch?.status, failure: job.launch?.failure })) })})`,
	);
	assert(
		launches[0].agent === "work-background-verifier",
		"completion launches the verifier role",
	);
	assert(
		launches[0].paths.includes("feature.js"),
		"verifier receives the completed task source path",
	);
	assert(
		!launches[0].paths.some((file) => file.startsWith(".ce-workflow/")),
		"workflow state is excluded from verifier source paths",
	);
	const job = Object.values(store.jobs)[0];
	assert(
		job?.launch?.status === "running",
		"verifier launch is durably recorded as running",
	);
	assert(
		buildWorkStats(cwd, "TASK-1").phases.some((phase) =>
			phase.models.some((model) => model.model === "fixture/main"),
		),
		"completed task telemetry persists the orchestration model",
	);
	process.stdout.write(
		"ok - completed task commit fires a background verifier in a disposable repository\n",
	);
} finally {
	if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
	rmSync(cwd, { recursive: true, force: true });
}
