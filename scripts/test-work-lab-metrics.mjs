// Self-check for scripts/lab-metrics.mjs: parent plus child session counted, subagent-artifacts copy skipped.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { sessionMetrics } from "./lab-metrics.mjs";

const dir = mkdtempSync(path.join(os.tmpdir(), "lab-metrics-"));
const assistant = (tools, cost) => JSON.stringify({ type: "message", message: { role: "assistant", provider: "p", model: "m",
	content: [{ type: "text", text: "x" }, ...Array.from({ length: tools }, () => ({ type: "toolCall" }))],
	usage: { input: 10, output: 5, cacheRead: 100, cacheWrite: 0, totalTokens: 115, cost: { total: cost } } } });
const lines = (...items) => `${items.join("\n")}\nnot json\n`;
try {
	writeFileSync(path.join(dir, "parent.jsonl"), lines(JSON.stringify({ type: "message", message: { role: "user", content: "hi" } }), assistant(2, 0.5), assistant(0, 0.25)));
	mkdirSync(path.join(dir, "parent", "run-id", "run-0"), { recursive: true });
	writeFileSync(path.join(dir, "parent", "run-id", "run-0", "session.jsonl"), lines(assistant(1, 0.125)));
	mkdirSync(path.join(dir, "subagent-artifacts"));
	writeFileSync(path.join(dir, "subagent-artifacts", "copy_transcript.jsonl"), lines(assistant(9, 9)));
	const m = sessionMetrics(dir);
	assert.deepEqual([m.sessions, m.turns, m.toolCalls, m.input, m.totalTokens, m.cost], [2, 3, 3, 30, 345, 0.875]);
	assert.deepEqual(m.models, { "p/m": 3 });
	assert.equal(sessionMetrics(path.join(dir, "missing")).turns, 0);
	console.log("lab-metrics ok");
} finally {
	rmSync(dir, { recursive: true, force: true });
}
