#!/usr/bin/env node
// Plan fee49985 CU-11/CU-13: live prompt-cache benchmark for ce-workflow's context handlers across a mid-session tool change.
// Usage: node scripts/benchmark-context-cache-live.mjs --label baseline [--model anthropic/claude-opus-5-5] [--repetitions 2] [--output DIR]
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const value = (flag, fallback) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : fallback);
const model = value("--model", "anthropic/claude-opus-5-5");
const repetitions = Number(value("--repetitions", "2"));
const label = value("--label", "run");
const outputRoot = path.resolve(value("--output", path.join(repo, ".pi", "context-cache-benchmark", `${new Date().toISOString().replaceAll(":", "-")}-${label}`)));
const npmRoot = () => { try { return execFileSync("npm", ["root", "-g"], { encoding: "utf8", shell: true }).trim(); } catch { return path.join(process.env.APPDATA ?? "", "npm", "node_modules"); } };
const piCli = [path.join(process.env.USERPROFILE ?? process.env.HOME ?? "", ".pi", "agent", "install", "releases", "1.4.0", "node_modules", "@earendil-works", "pi-coding-agent", "dist", "bundle", "cli.js"), path.join(npmRoot(), "@earendil-works", "pi-coding-agent", "dist", "bundle", "cli.js")].find(existsSync);
if (!piCli) throw new Error("Pi CLI not found");
// The user's Anthropic OAuth pool provider (real sessions load it; --no-extensions would leave a revoked auth.json token).
const providerExtension = value("--provider-extension", path.join(process.env.USERPROFILE ?? process.env.HOME ?? "", ".pi", "agent", "git", "github.com", "DrunkenDonkey80", "pi-provider-claude-ex", "index.ts"));

// Probe: a loader tool activates a deferred tool mid-run (Pi appends a system message with toolsAdded), and a last
// context_with_system handler logs where system messages sit in each request, after ce-workflow's handlers ran.
const probe = `
import { Type } from "typebox";
import { appendFileSync } from "node:fs";
export default function (pi) {
	pi.registerTool({ name: "word_count", label: "word_count", description: "Count whitespace-separated words in a file.", exposure: "deferred",
		parameters: Type.Object({ path: Type.String() }),
		async execute(_id, params, _signal, _update, ctx) {
			const { readFileSync } = await import("node:fs"); const { resolve } = await import("node:path");
			const words = readFileSync(resolve(ctx.cwd, params.path), "utf8").split(/\\s+/).filter(Boolean).length;
			return { content: [{ type: "text", text: String(words) }], details: { words } };
		} });
	pi.registerTool({ name: "enable_word_count", label: "enable_word_count", description: "Activate the word_count tool.", parameters: Type.Object({}),
		async execute() { pi.setActiveTools([...pi.getActiveTools(), "word_count"]); return { content: [{ type: "text", text: "word_count is now available." }], details: {} }; } });
	pi.on("context_with_system", (event) => {
		const m = event.messages;
		appendFileSync(process.env.CACHE_BENCH_PROBE, JSON.stringify({ roles: m.map((x) => x.role === "custom" ? "custom:" + x.customType : x.role),
			system: m.flatMap((x, i) => x.role === "system" ? [{ i, added: (x.toolsAdded ?? []).map((t) => t.name).filter((n) => n === "word_count" || n === "enable_word_count"), sections: Object.keys(x.sections ?? {}).length }] : []) }) + "\\n");
	});
}
`;

const prompts = [
	"Create greet.mjs exporting greet(name) that returns `Hello, ${name}!`. Verify it with one node -e command. Reply with one line.",
	"Call enable_word_count, then use word_count on greet.mjs and write only that number to count.txt. Reply with one line.",
	"Add a farewell(name) export to greet.mjs returning `Bye, ${name}!`, verify both exports with one node -e command, then run word_count on greet.mjs again and overwrite count.txt with only the new number. Reply with one line.",
];

const { recordKnowledge } = await import(pathToFileURL(path.join(repo, "extensions", "work-knowledge.ts")).href);
function scaffold(cwd) {
	mkdirSync(cwd, { recursive: true });
	writeFileSync(path.join(cwd, "package.json"), '{"name":"greet","private":true,"type":"module"}\n');
	execFileSync("git", ["init", "-q", "-b", "master"], { cwd });
	// ultrafull, the default mode going forward: filteredContext changes the list only for images or the compaction nudge.
	mkdirSync(path.join(cwd, ".pi"), { recursive: true });
	writeFileSync(path.join(cwd, ".pi", "settings.json"), '{"workOrchestrator":{"context":{"mode":"ultrafull","enabled":true,"autoCompact":true}}}\n');
	// A live project-knowledge claim makes filteredContext append its knowledge message, as in real ce-workflow repos.
	recordKnowledge(cwd, { claim: "greet.mjs is an ES module; greet(name) and farewell(name) return template strings.", kind: "fact", scope: "project", authority: "observed", paths: ["greet.mjs"] });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function readJsonl(file) {
	try { return readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)); }
	catch (error) { throw new Error(`unreadable or malformed JSONL ${file}: ${error.message}`); }
}
async function run(repetition) {
	const cwd = path.join(outputRoot, `rep-${repetition + 1}`);
	scaffold(cwd);
	const probeFile = path.join(outputRoot, `probe-${repetition + 1}.mjs`), probeLog = path.join(cwd, "probe.jsonl");
	writeFileSync(probeFile, probe);
	writeFileSync(probeLog, "");
	const sessionDir = path.join(cwd, "sessions");
	const child = spawn(process.execPath, [piCli, "--mode", "rpc", "--session-dir", sessionDir, "--model", model, "--thinking", "high", "--no-extensions",
		...(existsSync(providerExtension) ? ["--extension", providerExtension] : []), "--extension", path.join(repo, "extensions", "work-models.ts"), "--extension", probeFile, "-a"], { cwd, env: { ...process.env, CACHE_BENCH_PROBE: probeLog, PI_HUB: "" }, stdio: ["pipe", "pipe", "pipe"] });
	const events = [];
	let stdout = "", stderr = "", buffer = "";
	child.stdout.on("data", (chunk) => { stdout += chunk; buffer += chunk; const lines = buffer.split("\n"); buffer = lines.pop() ?? ""; for (const line of lines) { try { events.push(JSON.parse(line)); } catch {} } });
	child.stderr.on("data", (chunk) => { stderr += chunk; });
	const started = Date.now();
	try {
		for (const prompt of prompts) {
			const settled = events.filter((e) => e.type === "agent_settled").length;
			child.stdin.write(`${JSON.stringify({ type: "prompt", message: prompt })}\n`);
			const deadline = Date.now() + 600_000;
			while (events.filter((e) => e.type === "agent_settled").length <= settled) {
				if (child.exitCode !== null) throw new Error(`pi exited ${child.exitCode}: ${stderr.slice(-2000)}`);
				if (Date.now() > deadline) throw new Error("prompt timed out");
				await sleep(250);
			}
		}
	} finally {
		child.kill();
		writeFileSync(path.join(cwd, "rpc.stdout.jsonl"), stdout);
		writeFileSync(path.join(cwd, "rpc.stderr.log"), stderr);
	}
	const elapsedMs = Date.now() - started;
	// Completion check: both exports work and count.txt holds the final word count.
	let completed = false;
	try {
		const out = execFileSync(process.execPath, ["--input-type=module", "-e", "const m=await import('./greet.mjs');console.log(m.greet('A')+'|'+m.farewell('B'))"], { cwd, encoding: "utf8" }).trim();
		const words = readFileSync(path.join(cwd, "greet.mjs"), "utf8").split(/\s+/).filter(Boolean).length;
		completed = out === "Hello, A!|Bye, B!" && readFileSync(path.join(cwd, "count.txt"), "utf8").trim() === String(words);
	} catch {}
	// Every session file of the run, not only the first.
	const entries = readdirSync(sessionDir).filter((n) => n.endsWith(".jsonl")).flatMap((n) => readJsonl(path.join(sessionDir, n)));
	const assistant = entries.filter((e) => e.type === "message" && e.message?.role === "assistant").map((e) => e.message);
	const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, costUsd: 0 };
	for (const m of [...assistant, ...entries.filter((e) => e.type === "compaction" && e.usage).map((e) => ({ usage: e.usage }))]) {
		for (const k of ["input", "output", "cacheRead", "cacheWrite", "totalTokens"]) usage[k] += m.usage?.[k] ?? 0;
		usage.costUsd += m.usage?.cost?.total ?? 0;
	}
	const requests = readJsonl(probeLog);
	// Proof of a mid-session tool change seen by the handlers: some request carries word_count in a system message.
	const changed = requests.filter((r) => r.system.some((s) => s.added.includes("word_count")));
	const toolChange = changed.length > 0;
	const midSystemKept = changed.some((r) => r.system.some((s) => s.i > 0 && s.added.includes("word_count")));
	return {
		repetition: repetition + 1, completed, toolChange, midSystemKept, elapsedMs, turns: assistant.length,
		toolCalls: assistant.reduce((n, m) => n + (m.content ?? []).filter((p) => p?.type === "toolCall").length, 0),
		perTurn: assistant.map((m) => ({ input: m.usage?.input ?? 0, cacheRead: m.usage?.cacheRead ?? 0, cacheWrite: m.usage?.cacheWrite ?? 0 })),
		requests: requests.length, knowledgeRequests: requests.filter((r) => r.roles.includes("custom:work-knowledge") || r.roles.some((x) => x.startsWith("custom:") && x.includes("knowledge"))).length,
		usage, cwd,
	};
}

mkdirSync(outputRoot, { recursive: true });
const results = await Promise.all(Array.from({ length: repetitions }, (_, i) => run(i).catch((error) => ({ repetition: i + 1, error: String(error?.stack ?? error) }))));
const ok = results.filter((r) => !r.error);
const mean = (pick) => ok.length ? ok.reduce((s, r) => s + pick(r), 0) / ok.length : NaN;
const summary = { label, model, repetitions, outputRoot, mean: { costUsd: mean((r) => r.usage.costUsd), totalTokens: mean((r) => r.usage.totalTokens), cacheRead: mean((r) => r.usage.cacheRead), cacheWrite: mean((r) => r.usage.cacheWrite), elapsedMs: mean((r) => r.elapsedMs), turns: mean((r) => r.turns), toolCalls: mean((r) => r.toolCalls) }, results };
writeFileSync(path.join(outputRoot, "results.json"), `${JSON.stringify(summary, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
if (results.some((r) => r.error || !r.completed || !r.toolChange)) process.exitCode = 1;
