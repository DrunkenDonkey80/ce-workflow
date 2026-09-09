#!/usr/bin/env node
// Live guard test: small task completes, then a microcompact must do the
// compaction and NOTHING more. Reproduces the real replay path — pi-subagents
// emits its resume message with pi.sendMessage(..., {triggerTurn:true}), which
// calls _runAgentPrompt directly and never emits before_agent_start.
//
// Usage: node scripts/test-compaction-resume-idle.mjs [--model provider/id] [--keep]
import { execSync, spawn } from "node:child_process";
import {
	appendFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const model =
	argv[argv.indexOf("--model") + 1]?.startsWith("-") || !argv.includes("--model")
		? "openai-codex/gpt-5.6-luna"
		: argv[argv.indexOf("--model") + 1];
const keep = argv.includes("--keep");
const cwd = mkdtempSync(path.join(tmpdir(), "ce-compact-resume-"));
// Global install: pi is not a dependency of this repo, so resolve from npm root.
function npmRoot() {
	try {
		return execSync("npm root -g", { encoding: "utf8" }).trim();
	} catch {
		return path.join(process.env.APPDATA ?? "", "npm", "node_modules");
	}
}
const piCli =
	process.env.PI_CLI ??
	path.join(
		npmRoot(),
		"@earendil-works",
		"pi-coding-agent",
		"dist",
		"bundle",
		"cli.js",
	);

mkdirSync(path.join(cwd, ".pi"));
writeFileSync(
	path.join(cwd, ".pi", "settings.json"),
	JSON.stringify({
		workKnowledge: { discoverer: { model: "inherit", thinking: "low" } },
	}),
);
// Replay both the immediate resume and delayed internal failure/control notices.
// The RPC stub records a discoverer identity without launching any child/model.
writeFileSync(
	path.join(cwd, "resume-stub.js"),
	`import { writeFileSync } from "node:fs";
export default function resumeStub(pi) {
	const runId = "43b46a2e-ec06-4f14-b99e-e3f81478d87a";
	const timers = [];
	pi.events.on("subagents:rpc:v1:request", (request) => {
		if (request.method !== "spawn") return;
		writeFileSync(${JSON.stringify(path.join(cwd, "discoverer-launched"))}, request.params.workflowScript);
		pi.events.emit("subagents:rpc:v1:reply:" + request.requestId, {
			success: true, data: { runId },
		});
	});
	pi.on("session_shutdown", () => timers.forEach(clearTimeout));
	pi.on("session_compact", () => {
		writeFileSync(${JSON.stringify(path.join(cwd, "stub-fired"))}, "1");
		pi.sendMessage(
			{
				customType: "subagent-compaction-resume",
				content: "Compaction is complete. Resume the parent task now; background subagent results will arrive separately when ready.",
				display: false,
			},
			{ triggerTurn: true },
		);
		const failure = "Subagent failed: delegate\\nRun: " + runId + " step 1\\nSignal: delegate completed without making edits for an implementation task";
		const messages = [
			{ customType: "subagent_control_notice", content: failure, details: { event: { runId, reason: "completion_guard" } } },
			{ customType: "intercom_message", content: failure, details: { from: { id: "subagent-control" }, bodyText: failure } },
			{ customType: "subagent-notify", content: "Background task failed: **workflow**\\nWorkflow run: wrapper-run\\nChild runs: main=" + runId + " (failed)" },
		];
		messages.forEach((message, index) => timers.push(setTimeout(() => {
			pi.sendMessage({ ...message, display: false }, { triggerTurn: true });
			writeFileSync(${JSON.stringify(path.join(cwd, "notice-fired-"))} + index, "1");
		}, (index + 1) * 750)));
	});
}
`,
);

const debugLog = path.join(repo, ".tmp", "compaction-resume-events.jsonl");

const child = spawn(
	process.execPath,
	[
		piCli,
		"--mode",
		"rpc",
		// A real session file is required: pi only emits session_compact after the
		// compaction entry is saved.
		"--session-dir",
		path.join(cwd, "sessions"),
		"--no-extensions",
		"-e",
		path.join(repo, "extensions", "work-models.ts"),
		"-e",
		path.join(cwd, "resume-stub.js"),
		"--model",
		model,
		"--thinking",
		"off",
		"-nt",
		"-a",
	],
	{ cwd, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env } },
);

const events = [];
let buffer = "";
child.stdout.on("data", (chunk) => {
	buffer += chunk;
	const lines = buffer.split("\n");
	buffer = lines.pop() ?? "";
	for (const line of lines) {
		if (!line.trim()) continue;
		try {
			events.push(JSON.parse(line));
			if (process.env.WORK_TEST_DEBUG) appendFileSync(debugLog, `${line}\n`);
		} catch {
			// non-JSON banner lines
		}
	}
});
let stderr = "";
child.stderr.on("data", (chunk) => {
	stderr += chunk;
});

const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function waitFor(predicate, timeoutMs, label) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const hit = events.find(predicate);
		if (hit) return hit;
		if (child.exitCode !== null)
			throw new Error(
				`pi exited (${child.exitCode}) waiting for ${label}\n${stderr}`,
			);
		await sleep(200);
	}
	throw new Error(`timeout waiting for ${label}\n${stderr}`);
}

function cleanup() {
	child.kill();
	if (keep) return;
	try {
		rmSync(cwd, { recursive: true, force: true });
	} catch {
		// the child may still hold the temp dir on Windows; it is a temp dir.
	}
}

function fail(message) {
	console.error(`FAIL ${message}`);
	console.error(
		`events: ${events
			.map((event) => event.type)
			.join(", ")
			.slice(-1_500)}`,
	);
	cleanup();
	process.exit(1);
}

try {
	await sleep(1_500);
	// 1. small work that completes
	send({ type: "prompt", message: "Reply with exactly: DONE" });
	await waitFor(
		(event) => event.type === "agent_settled",
		120_000,
		"task settled",
	);

	// 2. microcompact via ce-workflow's own F8 path
	const settledBefore = events.filter(
		(event) => event.type === "agent_settled",
	).length;
	// pi refuses to compact a tiny session, so pad it first.
	send({ type: "prompt", message: "/wo context-fill" });
	await sleep(3_000);
	send({ type: "prompt", message: "/wo compact" });
	await waitFor(
		(event) => event.type === "compaction_end",
		120_000,
		"compaction_end",
	);

	// 3. nothing more: no further model turn after the compaction
	await sleep(20_000);
	if (!existsSync(path.join(cwd, "stub-fired")))
		fail("resume stub never fired: session_compact was not emitted");
	if (!existsSync(path.join(cwd, "discoverer-launched")))
		fail("knowledge discovery did not register its run identity");
	for (let index = 0; index < 3; index++)
		if (!existsSync(path.join(cwd, `notice-fired-${index}`)))
			fail(`delayed internal notice ${index} was not delivered`);
	// The guard aborts the resume turn before the provider request, so an empty
	// aborted assistant message is fine; any streamed text or tool call is not.
	const after = events.slice(
		events.findIndex((event) => event.type === "compaction_end"),
	);
	const spoke = after.filter(
		(event) =>
			event.type === "message_update" ||
			event.type === "tool_execution_start" ||
			(event.type === "message_end" &&
				event.message?.role === "assistant" &&
				(event.message.content?.length || event.message.usage?.output)),
	);
	if (spoke.length)
		fail(
			`microcompact spent a model turn: ${spoke.length} post-compaction model events (${settledBefore} settled before)`,
		);
	console.log(
		"ok - microcompact and delayed internal failure notices spend no model turn",
	);
	cleanup();
} catch (error) {
	fail(error.message);
}
