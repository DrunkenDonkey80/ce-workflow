#!/usr/bin/env node
// Live end-to-end: a blocking ask_user in a real pi RPC session is answered
// remotely through the patched pi-ask-user ask:answer channel — no local
// input, no timeout, no cancel. Requires the patch from
// scripts/patch-ask-user-remote-answer.mjs to be applied.
//
// Usage: node scripts/test-ask-remote-live.mjs [--model provider/id] [--keep]
import { execSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
const cwd = mkdtempSync(path.join(tmpdir(), "ce-ask-remote-"));
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
const askUser = path.join(
	process.env.PI_ASK_USER_DIR ??
		path.join(
			process.env.USERPROFILE ?? process.env.HOME ?? "",
			".pi",
			"agent",
			"npm",
			"node_modules",
			"pi-ask-user",
		),
	"index.ts",
);
if (!existsSync(askUser)) {
	console.error(`pi-ask-user not found at ${askUser}`);
	process.exit(1);
}

// Answers every pending ask remotely after 1.5s, like the intercom bridge does.
writeFileSync(
	path.join(cwd, "remote-answerer.js"),
	`import { writeFileSync } from "node:fs";
const pendingMarker = ${JSON.stringify(path.join(cwd, "ask-pending-seen"))};
const answeredMarker = ${JSON.stringify(path.join(cwd, "remote-answered"))};
export default function remoteAnswerer(pi) {
	pi.events.on("ask:pending", (ask) => {
		if (!ask?.askId) return;
		writeFileSync(pendingMarker, "1");
		setTimeout(() => {
			pi.events.emit("ask:answer", { askId: ask.askId, text: "Local B" });
			writeFileSync(answeredMarker, "1");
		}, 1500);
	});
}
`,
);

const child = spawn(
	process.execPath,
	[
		piCli,
		"--mode",
		"rpc",
		"--session-dir",
		path.join(cwd, "sessions"),
		"--no-extensions",
		"-e",
		askUser,
		"-e",
		path.join(cwd, "remote-answerer.js"),
		"--model",
		model,
		"--thinking",
		"off",
		"-t",
		"ask_user",
		"-a",
	],
	{
		cwd,
		stdio: ["pipe", "pipe", "pipe"],
		env: { ...process.env, PI_ASK_USER_REMOTE_ANSWERS: "1" },
	},
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
		message:
			"Call the ask_user tool now with question 'Pick one', options 'Local A' and 'Local B', allowFreeform=false, allowMultiple=false. Do not answer the question yourself and do not reply before the tool returns.",
	});
	await waitFor(
		(event) => event.type === "agent_settled",
		180_000,
		"agent settled",
	);
	if (!existsSync(path.join(cwd, "ask-pending-seen")))
		fail("ask:pending never fired (patch missing or opt-in env not set)");
	if (!existsSync(path.join(cwd, "remote-answered")))
		fail("remote answer was never emitted");
	const askResult = events.find(
		(event) =>
			event.type === "tool_execution_end" && event.toolName === "ask_user",
	);
	if (!askResult) fail("ask_user tool never completed");
	const text = JSON.stringify(askResult);
	if (!/Local B/.test(text))
		fail(
			`ask_user did not resolve with the remote answer: ${text.slice(0, 400)}`,
		);
	if (/cancelled/.test(text) && /"cancelled"\s*:\s*true/.test(text))
		fail("ask_user resolved as cancelled instead of answered");
	console.log("ok - blocking ask_user answered remotely via ask:answer");
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
