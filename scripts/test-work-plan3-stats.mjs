import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { classify, commandShape, createStats, recordCommand, recordReply, sanitize, serialHint, statsItems, emptyStats } from "../extensions/plan3-stats.ts";

assert.equal(classify("cd \"C:/x\" && node scripts/test-work-plan3.mjs"), "test");
assert.equal(classify("cargo nextest run"), "test");
assert.equal(classify("cargo build --release -j 8"), "build");
assert.equal(classify("grep -n test src/a.ts"), "shell", "read-only inspection is never a test");
assert.equal(classify("git diff -- test/"), "shell");
assert.equal(sanitize("curl -H \"Authorization: Bearer abc123\" --token=xyz API_KEY=sec run", ""), "curl -H \"Authorization: Bearer *** --token=*** API_KEY=*** run");
assert.equal(sanitize("cd C:/repo && npm  test", "C:/repo"), "cd . && npm test");

// Thinking = request start → first text/tool call; acting = the rest. Grouped by model and effort.
const replyStats = emptyStats();
recordReply(replyStats, { provider: "p", model: "m", thinkingLevel: "high", timestamp: 1000, durationMs: 10_000, usage: { input: 10, output: 500, cacheRead: 90, cacheWrite: 0, cost: { total: 0.5 } } }, 7000);
recordReply(replyStats, { provider: "p", model: "m", thinkingLevel: "high", timestamp: 1000, durationMs: 4000, usage: {} }, undefined);
assert.deepEqual(replyStats.models["p/m:high"], { replies: 2, thinkingMs: 10_000, actingMs: 4000, input: 10, output: 500, cacheRead: 90, cacheWrite: 0, cost: 0.5, errors: 0 });

// Bounded command ledger: the cheapest command folds into "(other)".
const ledger = emptyStats();
for (let i = 0; i < 201; i++) recordCommand(ledger, "bash", `cmd ${i}`, 1000 + i, i === 0);
assert.equal(Object.keys(ledger.commands).length, 200);
assert.equal(ledger.commands["\0(other)"].count, 2, "the two cheapest commands folded");
assert.equal(ledger.commands["\0(other)"].failures, 1);

// Collector: counts only a run of the executing plan; tools by elapsed vs summed; ask_user is waiting, not tool time.
const directory = await mkdtemp(path.join(os.tmpdir(), "plan3-stats-"));
const planFile = path.join(directory, "p.md");
const log = path.join(directory, "logs", "p.md");
await writeFile(planFile, "- [x] **A-01** done\n- [~] **A-02** now\n");
const hooks = new Map(), listeners = new Map();
const pi = { on: (name, handler) => hooks.set(name, handler), events: { on: (name, handler) => listeners.set(name, handler) } };
let executing = false;
createStats(pi, {
	plan: async () => executing ? { file: planFile, log } : undefined,
	step: async () => "A-02",
});
const statsPath = path.join(directory, "logs", "p.stats.json");
await hooks.get("agent_start")({}, {});
await hooks.get("agent_settled")({}, {});
await assert.rejects(readFile(statsPath), "a run outside /resume3 records nothing");
executing = true;
await hooks.get("agent_start")({}, { cwd: directory });
hooks.get("message_start")({ message: { role: "assistant" } });
hooks.get("message_update")({ assistantMessageEvent: { type: "thinking_delta" } });
hooks.get("message_update")({ assistantMessageEvent: { type: "toolcall_start" } });
hooks.get("message_end")({ message: { role: "assistant", provider: "p", model: "m", thinkingLevel: "medium", timestamp: Date.now() - 5000, durationMs: 5000, usage: { output: 100 } } });
hooks.get("tool_execution_start")({ toolCallId: "1", toolName: "bash", args: { command: "npm test" } }, { cwd: directory });
hooks.get("tool_execution_start")({ toolCallId: "2", toolName: "bash", args: { command: "cargo build" } }, { cwd: directory });
hooks.get("tool_execution_end")({ toolCallId: "1", toolName: "bash", isError: true, durationMs: 3000 });
hooks.get("tool_execution_end")({ toolCallId: "2", toolName: "bash", isError: false, durationMs: 2000 });
hooks.get("tool_execution_start")({ toolCallId: "3", toolName: "ask_user", args: {} }, {});
hooks.get("ui_prompt_start")({});
await new Promise((resolve) => setTimeout(resolve, 30));
hooks.get("ui_prompt_end")({});
hooks.get("tool_execution_end")({ toolCallId: "3", toolName: "ask_user", isError: false, durationMs: 60_000 });
listeners.get("work:compaction-start")({});
await hooks.get("session_compact")({}, {});
await hooks.get("turn_end")({}, {});
await hooks.get("agent_settled")({}, {});
const readJson = async (file) => {
	try { return JSON.parse(await readFile(file, "utf8")); } catch (error) { throw new Error(`${file} is not valid stats JSON: ${error.message}`); }
};
const saved = await readJson(statsPath);
assert.equal(saved.runs, 1);
assert.equal(saved.models["p/m:medium"].thinkingMs + saved.models["p/m:medium"].actingMs, 5000);
assert.deepEqual(saved.categories.test, { count: 1, ms: 3000, maxMs: 3000, failures: 1 });
assert.equal(saved.categories.build.ms, 2000);
assert.equal(saved.tools.ask_user, undefined, "ask_user is waiting time, not tool time");
assert(saved.waitingMs >= 20, "dialog time is waiting for you");
assert.equal(saved.compactions.count, 1);
assert.equal(saved.steps["A-02"].testMs, 3000);
assert.equal(saved.commands["bash\0npm test"].failures, 1);
assert.deepEqual([saved.steps["A-02"].replies, saved.steps["A-02"].failures, saved.steps["A-02"].models], [1, 1, { "p/m:medium": 1 }], "steps count replies, failed tools and models");
// Serial waits: two long runs of one command family with different arguments and no edits between send one steer.
assert.equal(commandShape('cd "hub" && node import-benchmark.ts --round 0 --case bankya-f1 > out.json'), "node import-benchmark.ts");
assert.equal(commandShape("py -3 -m unittest discover -s tests -p test_a.py"), "py unittest");
const run = (command, start, edits = 0, ms = 600_000) => ({ shape: commandShape(command), command, ms, start, end: start + ms, edits });
const first = run("node bench.ts --case a", 0), fired = new Set();
assert.match(serialHint(first, run("node bench.ts --case b", 600_000), fired), /`node bench.ts` ran twice in a row[\s\S]*keep them sequential; that is fine too/);
assert.equal(serialHint(first, run("node bench.ts --case c", 600_000), fired), undefined, "once per family");
assert.equal(serialHint(first, run("node bench.ts --case b", 600_000, 1), new Set()), undefined, "an edit between means a fix-and-rerun loop");
assert.equal(serialHint(first, run("node bench.ts --case a", 600_000), new Set()), undefined, "the same command again is a rerun, not a fan-out");
assert.equal(serialHint(first, run("node bench.ts --case b", 300_000), new Set()), undefined, "overlapping runs are already parallel");
assert.equal(serialHint(first, run("node bench.ts --case b", 600_000, 0, 60_000), new Set()), undefined, "short runs are not worth it");
const steers = [], hooks3 = new Map();
createStats({ on: (name, handler) => hooks3.set(name, handler), sendMessage: (message, options) => steers.push([message.content, options.deliverAs]) }, { plan: async () => ({ file: planFile, log }), step: async () => "A-02" });
await hooks3.get("agent_start")({}, {});
for (const [id, command] of [["b1", "node bench.ts --case a"], ["b2", "node bench.ts --case b"]]) {
	hooks3.get("tool_execution_start")({ toolCallId: id, toolName: "bash", args: { command } }, { cwd: directory });
	hooks3.get("tool_execution_end")({ toolCallId: id, toolName: "bash", isError: false, durationMs: 600_000 });
}
assert.equal(steers.length, 1);
assert.equal(steers[0][1], "steer");
await hooks3.get("agent_settled")({}, {});
assert.equal((await readJson(statsPath)).hints.at(-1).shape, "node bench.ts");
// Stats persist across sessions: a fresh collector adds to the file.
const hooks2 = new Map();
createStats({ on: (name, handler) => hooks2.set(name, handler) }, { plan: async () => ({ file: planFile, log }), step: async () => "A-02" });
await hooks2.get("agent_start")({}, {});
await hooks2.get("agent_settled")({}, {});
assert.equal((await readJson(statsPath)).runs, 3, "the serial-hint run above plus this one");

const labels = statsItems(saved).map((item) => item.label).join("\n");
assert.match(labels, /Tests: \d+s/);
assert.match(labels, /p\/m:medium: 5s · 1 replies/);
assert.match(labels, /Waiting for you/);
await rm(directory, { recursive: true, force: true });
console.log("ok - plan3 stats collection, classification and viewer");
