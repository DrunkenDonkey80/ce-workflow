#!/usr/bin/env node
// Live end-to-end smoke: a fresh pi RPC process runs an authorized
// (WO_INLINE_V1) turn that spawns a work-planner child via the subagent
// tool; the child session must be recognized as a managed work-*
// subagent (session name subagent-work-planner-<uuid>-<n>) and its
// work-helper.mjs bash call must NOT be rejected by the direct-request
// gate. Guards the fix for the LPGSlim work-1 planner blocker.
//
// Usage: node scripts/test-work-child-auth-live.mjs [--model provider/id] [--keep]
import { execSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
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
const cwd = mkdtempSync(path.join(tmpdir(), "ce-child-auth-"));
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

// Ambient extensions (work-models.ts from the repo + pi-subagents) must load,
// so no --no-extensions here. -a auto-approves tool calls.
const child = spawn(
	process.execPath,
	[
		piCli,
		"--mode",
		"rpc",
		"--session-dir",
		path.join(cwd, "sessions"),
		"--model",
		model,
		"--thinking",
		"off",
		"-a",
	],
	{ cwd, stdio: ["pipe", "pipe", "pipe"] },
);

const events = [];
let buffer = "";
let stderr = "";
child.stdout.on("data", (chunk) => {
	buffer += chunk;
	const lines = buffer.split("\n");
	buffer = lines.pop() ?? "";
	for (const line of lines) {
		if (!line.trim()) continue;
		try {
			events.push(JSON.parse(line));
		} catch {
			// banner lines
		}
	}
});
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
function findSessionFiles(dir, found = []) {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) findSessionFiles(full, found);
		else if (entry.name === "session.jsonl") found.push(full);
	}
	return found;
}
function fail(message) {
	console.error(`FAIL ${message}\n${stderr}`);
	console.error(
		events
			.map((event) => event.type)
			.join(", ")
			.slice(-1_500),
	);
	for (const event of events.slice(-6))
		if (event.type === "message_end" && event.message?.role === "assistant")
			console.error(
				`assistant: ${JSON.stringify(event.message.content).slice(0, 600)}`,
			);
	child.kill();
	process.exit(1);
}

try {
	await sleep(1_500);
	send({
		type: "prompt",
		message: `WO_INLINE_V1: complete this small task in work-orchestrator inline mode. Call the subagent tool exactly once with agent "work-planner" and async:false. The child task must be exactly: 'Run exactly: node "${path.join(repo, "scripts", "work-helper.mjs")}" work-summary work-1.2 and reply with the exact stdout and stderr text.' Do not run work-helper yourself. After the child returns, reply with the child's final message verbatim.`,
	});
	await waitFor(
		(event) => event.type === "agent_settled",
		480_000,
		"agent settled (planner child spawn + helper call)",
	);
	const sessionFiles = findSessionFiles(path.join(cwd, "sessions"));
	const plannerFile = sessionFiles.find((file) => {
		try {
			return readFileSync(file, "utf8").includes('"subagent-work-planner-');
		} catch {
			return false;
		}
	});
	if (!plannerFile)
		fail(`no child session named subagent-work-planner-* in ${cwd}/sessions`);
	const plannerLog = readFileSync(plannerFile, "utf8");
	if (!/"name":\s*"subagent-work-planner-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-\d+"/.test(plannerLog))
		fail("child session name does not match subagent-work-<agent>-<uuid>-<n>");
	if (/Direct request mode/.test(plannerLog))
		fail(
			"work-planner child was blocked by the direct-request gate despite managed session name",
		);
	if (!/work-helper\.mjs/.test(plannerLog) || !/work-1\.2/.test(plannerLog))
		fail("child never ran the work-helper command");
	console.log("ok - spawned work-planner child authorized; work-helper ran");
	child.kill();
	if (!keep) {
		try {
			rmSync(cwd, { recursive: true, force: true });
		} catch {
			// the child may still hold the temp dir on Windows; it is a temp dir.
		}
	}
} catch (error) {
	fail(error.message);
}
