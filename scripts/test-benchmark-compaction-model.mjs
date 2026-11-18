#!/usr/bin/env node
// Offline self-check of the compaction-model matrix in benchmark-reasoning-strip-live.mjs: a fake RPC Pi stands in
// for the real one, so this checks the arm order, extension loading, compaction between phases and pairing only.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compareRuns } from "./compare-benchmark-runs.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const work = mkdtempSync(path.join(tmpdir(), "bench-compaction-model-"));
const fake = path.join(work, "fake-pi.mjs");
// Answers prompts with agent_settled and compact with a response; writes a session whose compaction entries carry
// usage and the configured compaction model, the way ultrafull does. Logs every call to calls.jsonl in its cwd.
writeFileSync(fake, `import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import readline from "node:readline";
const argv = process.argv.slice(2);
const sessionDir = argv[argv.indexOf("--session-dir") + 1];
mkdirSync(sessionDir, { recursive: true });
writeFileSync(process.env.REASONING_WIRE_PROBE, "");
let settings = {};
try { settings = JSON.parse(readFileSync(".pi/settings.json", "utf8")); } catch {}
const session = path.join(sessionDir, "s.jsonl");
const log = (entry) => appendFileSync("calls.jsonl", JSON.stringify(entry) + "\\n");
const usage = { totalTokens: 10, cost: { total: 0.01 } };
log({ argv });
for await (const line of readline.createInterface({ input: process.stdin })) {
  const command = JSON.parse(line);
  log({ command: command.type });
  if (command.type === "prompt") {
    appendFileSync(session, JSON.stringify({ type: "message", message: { role: "assistant", content: [], usage } }) + "\\n");
    process.stdout.write(JSON.stringify({ type: "agent_settled" }) + "\\n");
  } else if (command.type === "compact") {
    appendFileSync(session, JSON.stringify({ type: "compaction", usage: { totalTokens: 5, cost: { total: 0.002 } }, details: { compactionModel: settings.workOrchestrator?.context?.compactionModel, compactionMode: settings.workOrchestrator?.context?.mode } }) + "\\n");
    process.stdout.write(JSON.stringify({ type: "response", command: "compact", success: true }) + "\\n");
  }
}
`);

const output = path.join(work, "out");
const repetitions = 3;
let stdout;
try {
	stdout = execFileSync(process.execPath, [path.join(repo, "scripts", "benchmark-reasoning-strip-live.mjs"), "--matrix", "compaction-model", "--repetitions", String(repetitions), "--output", output], {
		encoding: "utf8",
		env: { ...process.env, BENCH_PI_CLI: fake },
		stdio: ["ignore", "pipe", "pipe"],
	});
} catch (error) {
	stdout = error.stdout; // the fake writes no calculator, so verification fails and the harness exits 1
}
const { results } = JSON.parse(stdout);

// Two-arm order alternates per repetition.
assert.deepEqual(results.map((r) => r.policy), ["L", "T", "T", "L", "L", "T"]);
const extension = path.join(repo, "extensions", "work-models.ts");
for (const r of results) {
	const calls = readFileSync(path.join(r.cwd, "calls.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
	// ce-workflow loads in both arms; compaction sits between the three phases, never after the last.
	assert.equal(calls[0].argv[calls[0].argv.indexOf("--extension") + 1], extension, `${r.policy} loads ce-workflow`);
	assert.deepEqual(calls.slice(1).map((c) => c.command), ["prompt", "compact", "prompt", "compact", "prompt"]);
	const settings = JSON.parse(readFileSync(path.join(r.cwd, ".pi", "settings.json"), "utf8"));
	assert.equal(settings.workOrchestrator.context.mode, "ultrafull");
	// Compaction model and usage are read from the compaction entries and counted once in the totals.
	assert.deepEqual(r.compactionModels, Array(2).fill(r.policy === "L" ? "openai-codex/gpt-6-luna" : "openai-codex/gpt-6.1-terra"));
	assert.equal(r.compactionTokens, 10);
	assert.equal(r.usage.totalTokens, 40);
	assert.equal(r.scenario, "calculator-lite");
	assert.equal(r.passed, false);
}

// Per-arm files pair into N complete pairs with comparable quality.
const arm = (id) => JSON.parse(readFileSync(path.join(output, `results-${id}.json`), "utf8"));
const comparison = compareRuns(arm("L"), arm("T"));
assert.equal(comparison.complete, repetitions);
assert.equal(comparison.total, repetitions);
assert.equal(comparison.quality.notComparable, 0);
assert.equal(comparison.quality.passed.pairs, repetitions);

rmSync(work, { recursive: true, force: true });
console.log("benchmark compaction-model matrix: ok");
