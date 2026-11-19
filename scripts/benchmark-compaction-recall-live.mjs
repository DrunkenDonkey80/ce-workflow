#!/usr/bin/env node
// Planted-fact recall of the compaction model: plants known facts at set depths of real session transcripts, runs the
// real ce-workflow summarizer (compactMemory, the ultracompact/ultrafull path) with each model, and counts the facts
// that survive in the summary. Rerun it on every new model release before changing the compaction model.
// Usage: node scripts/benchmark-compaction-recall-live.mjs --models openai-codex/gpt-6-luna,anthropic/claude-opus-5-5
//          [--thinking medium] [--transcripts a.jsonl,b.jsonl] [--sizes 60000,150000] [--reps 1] [--output DIR]
// Default transcripts: the 3 largest sessions of this repo. Each run is one model call through `pi --mode rpc`
// with no tools and a one-line system prompt; Anthropic models also load the user's Claude provider extension.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Each fact is a unique token a summary must keep to continue the work; kinds follow what compaction must preserve.
export const FACTS = [
	{ token: "check-quartz-ledger-41", role: "toolResult", text: "FAIL scripts/check-quartz-ledger-41.mjs: expected 3 ledger rows, got 2. This is the one failing check left; fix it before the release." },
	{ token: "RETRY_LIMIT=7", role: "assistant", text: "Decision with the user: keep RETRY_LIMIT=7 in src/vendor-client.ts because the vendor rate limit resets every 7 seconds; do not raise it." },
	{ token: "48213", role: "toolResult", text: "dev server listening on port 48213 (the only port the corporate proxy allows; other ports are blocked)" },
	{ token: "zephyr-lock.json", role: "assistant", text: "Constraint from the user: never edit vendor/zephyr-lock.json by hand; regenerate it with the vendor tool." },
	{ token: "otter-sync-93", role: "toolResult", text: "Next step agreed: finish test-otter-sync-93 (keeps the cursor after reconnect) once the ledger check passes." },
];
export const DEPTHS = [0.1, 0.3, 0.5, 0.7, 0.9];

const textOf = (content) => typeof content === "string" ? content : (content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
const bytes = (messages) => Buffer.byteLength(JSON.stringify(messages.map((m) => [m.role, textOf(m.content)])), "utf8");

/** The first messages of a transcript up to `size` bytes, with FACTS[i] inserted at DEPTHS[i] of that slice. */
export function plant(messages, size) {
	const slice = [];
	for (const message of messages) { if (bytes(slice) > size) break; slice.push(message); }
	const out = [...slice];
	FACTS.map((fact, i) => [fact, Math.floor(DEPTHS[i] * slice.length)]).reverse().forEach(([fact, at], i) => {
		const timestamp = Date.now();
		out.splice(at, 0, fact.role === "toolResult"
			? { role: "toolResult", toolCallId: `planted-${i}`, toolName: "bash", content: [{ type: "text", text: fact.text }], isError: false, timestamp }
			: { role: "assistant", content: [{ type: "text", text: fact.text }], timestamp });
	});
	return out;
}

/** Which planted facts the summary still holds (case-insensitive token match), and the share. */
export function score(summary) {
	const text = String(summary ?? "").toLowerCase();
	const kept = FACTS.map((fact, i) => ({ depth: DEPTHS[i], token: fact.token, kept: text.includes(fact.token.toLowerCase()) }));
	return { kept, recall: kept.filter((k) => k.kept).length / FACTS.length };
}

export function transcriptMessages(file) {
	return readFileSync(file, "utf8").split("\n").flatMap((line) => { try { const e = JSON.parse(line); return e.type === "message" && ["user", "assistant", "toolResult"].includes(e.message?.role) ? [e.message] : []; } catch { return []; } });
}

const value = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };
const providerExtension = path.join(os.homedir(), ".pi", "agent", "git", "github.com", "DrunkenDonkey80", "pi-provider-claude-ex", "index.ts");
const launcher = path.join(os.homedir(), ".pi", "agent", "bin", "pi-launcher.js");

// compactMemory's registry, backed by one `pi --mode rpc` call per request so every provider (and its auth) works.
function rpcRegistry(thinking) {
	return {
		find: (provider, id) => ({ provider, id, contextWindow: 200_000 }), // same input budget for every model: a fair comparison
		streamSimple: (model, request) => ({ result: () => new Promise((resolve, reject) => {
			const ref = `${model.provider}/${model.id}`;
			const args = ["--mode", "rpc", "--model", ref, "--thinking", thinking, "--no-tools", "--no-extensions", "--no-session", "--system-prompt", "You write compaction checkpoints."];
			if (ref.startsWith("anthropic/") && existsSync(providerExtension)) args.push("--extension", providerExtension);
			const child = spawn(process.execPath, [launcher, ...args], { stdio: ["pipe", "pipe", "pipe"] });
			let buffer = "", stderr = "", last;
			const timer = setTimeout(() => { child.kill(); reject(new Error(`${ref}: timed out`)); }, 600_000);
			child.stderr.on("data", (chunk) => { stderr += chunk; });
			child.stdout.on("data", (chunk) => {
				buffer += chunk;
				const lines = buffer.split("\n");
				buffer = lines.pop() ?? "";
				for (const line of lines) {
					let event;
					try { event = JSON.parse(line); } catch { continue; }
					if (event.type === "message_end" && event.message?.role === "assistant") last = event.message;
					if (event.type === "response" && event.success === false) { clearTimeout(timer); child.kill(); reject(new Error(`${ref}: ${event.error}`)); }
					if (event.type === "agent_settled" || event.type === "agent_end") { clearTimeout(timer); child.kill(); last ? resolve(last) : reject(new Error(`${ref}: no answer`)); }
				}
			});
			child.on("exit", (code) => { clearTimeout(timer); if (!last) reject(new Error(`${ref}: pi exited ${code}: ${stderr.slice(-1000)}`)); });
			child.stdin.write(`${JSON.stringify({ type: "prompt", message: textOf(request.messages[0].content) })}\n`);
		}) }),
	};
}

async function main() {
	const { compactMemory } = await import("../extensions/work-compaction-memory.ts");
	const models = value("--models", "openai-codex/gpt-6-luna").split(",");
	const thinking = value("--thinking", "medium");
	const sizes = value("--sizes", "60000,150000").split(",").map(Number);
	const reps = Number(value("--reps", "1"));
	const sessions = path.join(os.homedir(), ".pi", "agent", "sessions", "--C--soft-git-ce-workflow--");
	const transcripts = value("--transcripts", "").split(",").filter(Boolean);
	if (!transcripts.length) transcripts.push(...readdirSync(sessions).filter((f) => f.endsWith(".jsonl")).map((f) => path.join(sessions, f)).sort((a, b) => statSync(b).size - statSync(a).size).slice(0, 3));
	const out = path.resolve(value("--output", path.join(repo, ".pi", "compaction-recall", new Date().toISOString().replace(/[:.]/g, "-"))));
	mkdirSync(out, { recursive: true });
	const registry = rpcRegistry(thinking);
	for (const model of models) {
		const runs = [];
		for (let rep = 1; rep <= reps; rep++) for (const file of transcripts) for (const size of sizes) {
			const messages = plant(transcriptMessages(file), size);
			const started = Date.now();
			const result = await compactMemory({ messages, model, thinking, registry });
			const scored = score(result.mode === "hybrid" ? result.summary : "");
			const run = { model, rep, transcript: path.basename(file), size, mode: result.mode, error: result.fallback, recall: scored.recall, kept: scored.kept, costUsd: result.usage?.cost?.total ?? 0, inputTokens: result.usage?.input, summary: result.summary, s: Math.round((Date.now() - started) / 1000) };
			runs.push(run);
			console.log(JSON.stringify({ model, rep, transcript: run.transcript, size, mode: run.mode, recall: run.recall, cost: run.costUsd, s: run.s }));
		}
		writeFileSync(path.join(out, `${model.replace(/[\\/:]/g, "_")}.json`), JSON.stringify({ model, thinking, sizes, transcripts, runs }, null, 2));
		const ok = runs.filter((r) => r.mode === "hybrid");
		console.log(`${model}: ${ok.length}/${runs.length} valid checkpoints, cost $${runs.reduce((s, r) => s + r.costUsd, 0).toFixed(3)}`);
		for (const size of sizes) { const rs = ok.filter((r) => r.size === size); console.log(`  ${size} bytes: recall ${rs.length ? Math.round(100 * rs.reduce((s, r) => s + r.recall, 0) / rs.length) : "-"}% (${rs.length} runs)`); }
		for (const depth of DEPTHS) { const ks = ok.flatMap((r) => r.kept.filter((k) => k.depth === depth)); console.log(`  depth ${depth}: ${ks.filter((k) => k.kept).length}/${ks.length}`); }
	}
	console.log(`results: ${out}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
