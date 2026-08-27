#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const { default: workModelsExtension } = await import(
	pathToFileURL(path.join(import.meta.dirname, "../extensions/work-models.js"))
		.href
);
const { loadVerifierStore } = await import(
	pathToFileURL(
		path.join(import.meta.dirname, "../extensions/background-verifiers.js"),
	).href
);
const { assert } = await import(
	pathToFileURL(path.join(import.meta.dirname, "./work-command-fixture.mjs"))
		.href
);

const cwd = mkdtempSync(path.join(tmpdir(), "work-finish-verifier-hook-"));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = path.join(cwd, ".empty-agent");
const git = (...args) =>
	execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" }).trim();

try {
	git("init", "-q");
	git("config", "user.email", "verifier@example.invalid");
	git("config", "user.name", "Verifier Hook Test");
	writeFileSync(path.join(cwd, "README.md"), "# verifier hook\n");
	git("add", "README.md");
	git("commit", "-qm", "initial");
	const initial = git("rev-parse", "HEAD");

	mkdirSync(path.join(cwd, ".pi"), { recursive: true });
	writeFileSync(
		path.join(cwd, ".pi", "settings.json"),
		`${JSON.stringify({ workOrchestrator: { backgroundVerifiers: { "fixture/verifier": { operations: ["correctness"], thinking: "low" } } } })}\n`,
	);

	const hooks = {};
	const listeners = new Map();
	let launchCount = 0;
	const pi = {
		events: {
			on(name, handler) {
				const handlers = listeners.get(name) ?? new Set();
				handlers.add(handler);
				listeners.set(name, handlers);
				return () => handlers.delete(handler);
			},
			emit(name, payload) {
				if (name !== "subagents:rpc:v1:request") return;
				launchCount += 1;
				for (const handler of listeners.get(
					`subagents:rpc:v1:reply:${payload.requestId}`,
				) ?? [])
					handler({
						success: true,
						data: {
							details: {
								asyncId: `verifier-${launchCount}`,
								asyncDir: path.join(cwd, `.run-${launchCount}`),
							},
						},
					});
			},
		},
		on(name, handler) {
			hooks[name] = handler;
		},
		registerCommand() {},
	};
	workModelsExtension(pi);
	const ctx = {
		cwd,
		model: { provider: "fixture", id: "main" },
		ui: { notify() {}, setStatus() {}, setTitle() {} },
	};

	const finish = async (toolCallId, workItemId, file) => {
		await hooks.tool_execution_start(
			{
				toolName: "bash",
				toolCallId,
				args: {
					command: `node "C:\\soft\\Universal\\ce-workflow\\scripts\\work-helper.mjs" finish-task ${workItemId}`,
				},
			},
			ctx,
		);
		writeFileSync(
			path.join(cwd, file),
			`export const id = ${JSON.stringify(workItemId)};\n`,
		);
		git("add", file);
		git("commit", "-qm", `complete ${workItemId}`);
		const commit = git("rev-parse", "HEAD");
		await hooks.tool_execution_end(
			{
				toolName: "bash",
				toolCallId,
				isError: false,
				result: {
					content: [
						{
							type: "text",
							text: JSON.stringify({
								status: "PASS",
								work_item_id: workItemId,
								commit_hash: commit,
							}),
						},
					],
					details: { exitCode: 0 },
				},
			},
			ctx,
		);
		return commit;
	};

	const first = await finish("finish-1", "TASK-1", "first.js");
	const second = await finish("finish-2", "TASK-2", "second.js");
	const batches = Object.values(loadVerifierStore(cwd).batches);
	assert(
		batches.length === 2,
		"each nested finish ToolResult creates one batch",
	);
	assert(
		batches.some(
			(batch) =>
				batch.checkpoint.base === initial &&
				batch.checkpoint.snapshot === first &&
				batch.checkpoint.paths.join(",") === "first.js",
		),
		"the first finish keeps its immutable commit boundary",
	);
	assert(
		batches.some(
			(batch) =>
				batch.checkpoint.base === first &&
				batch.checkpoint.snapshot === second &&
				batch.checkpoint.paths.join(",") === "second.js",
		),
		"the second finish creates a distinct later checkpoint",
	);

	await hooks.before_agent_start(
		{
			prompt:
				"work-orchestrator\nWorkflow Run ID: tracked-finish\nActivity: implementation",
			systemPrompt: "",
		},
		ctx,
	);
	await hooks.agent_start({}, ctx);
	await finish("finish-3", "TASK-3", "third.js");
	assert(
		Object.keys(loadVerifierStore(cwd).batches).length === 2,
		"a finish inside a tracked agent waits for settlement verification",
	);
	process.stdout.write(
		"ok - finish ToolResults queue standalone commits and defer tracked-agent commits\n",
	);
} finally {
	if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
	rmSync(cwd, { recursive: true, force: true });
}
