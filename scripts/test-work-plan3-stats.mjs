import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { classify, commandShape, createStats, planDigest, recordCommand, recordReply, sanitize, serialHint, statsItems, emptyStats, parseRetro, redactRequest, retroPrompt, stepDigest, stepSignal, writeRequests, knownRequests } from "../extensions/plan3-stats.ts";

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
hooks.get("tool_execution_start")({ toolCallId: "4", toolName: "bash", args: { command: "ls src; grep -n foo src/a.ts" } }, { cwd: directory });
hooks.get("tool_execution_end")({ toolCallId: "4", toolName: "bash", isError: true, durationMs: 10, result: { content: [{ type: "text", text: "a.ts\n\nCommand exited with code 1" }] } });
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
assert.equal(saved.commands["bash\0ls src; grep -n foo src/a.ts"].failures, 0, "a search that ends in no match (exit 1) is not a failed tool");
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
// Step slices (RF-02): each step counts its own commands, so a 2+1 split over two steps is no three-repeat signal.
let sliceStep = "B-01";
const hooks4 = new Map();
const sliceHooks = createStats({ on: (name, handler) => hooks4.set(name, handler) }, { plan: async () => ({ file: planFile, log }), step: async () => sliceStep });
await hooks4.get("agent_start")({}, {});
const bashRun = async (id, command) => {
	hooks4.get("tool_execution_start")({ toolCallId: id, toolName: "bash", args: { command } }, { cwd: directory });
	hooks4.get("tool_execution_end")({ toolCallId: id, toolName: "bash", isError: false, durationMs: 1000 });
};
await bashRun("s1", "npm test"); await bashRun("s2", "npm test");
sliceStep = "B-02"; await hooks4.get("turn_end")({}, {});
await bashRun("s3", "npm test");
const b1 = await sliceHooks.stepRow(log, "B-01"), b2 = await sliceHooks.stepRow(log, "B-02");
assert.equal((await readJson(statsPath)).commands["bash\0npm test"].count, 4, "the plan-wide table still counts every run");
assert.deepEqual([b1.commands["bash\0npm test"].count, b2.commands["bash\0npm test"].count], [2, 1]);
assert.deepEqual([stepSignal(b1), stepSignal(b2)], [[], []], "2+1 over two steps fires no three-repeat signal");
await bashRun("s4", "npm test"); await bashRun("s5", "npm test");
assert.deepEqual(stepSignal(await sliceHooks.stepRow(log, "B-02")), ["a command ran 3 times"]);
hooks4.get("tool_execution_start")({ toolCallId: "e1", toolName: "edit", args: { path: "a.ts" } }, { cwd: directory });
hooks4.get("tool_execution_end")({ toolCallId: "e1", toolName: "edit", isError: true, durationMs: 5, result: { content: [{ type: "text", text: "\nEdit without read: a.ts\nmore" }] } });
assert.deepEqual((await sliceHooks.stepRow(log, "B-02")).toolErrors, { "edit: Edit without read: a.ts": 1 }, "a failed non-shell tool keeps its name and first message line");
await hooks4.get("agent_settled")({}, {});
assert.deepEqual(stepSignal({ ms: 31 * 60_000, failures: 3 }), ["3 failed tools", "31m 0s active"]);
assert.deepEqual(stepSignal(undefined), [], "a step with no activity is quiet");
const sDigest = stepDigest("B-02", { ms: 3000, failures: 2, commands: { "bash\0npm test": { count: 3, ms: 3000, maxMs: 1000, failures: 1 } }, toolErrors: { "edit: Edit without read: a.ts": 1 } },
	"# Plan3 log\n\n## 2026 B-01 done: x\n\n- check: old\n\n## 2026 B-02 done: fixed\n\n- [x] **B-02** fix\n  - check: npm test failed once, then ok\n\n## 2026 Superseded resume context\n\nother\n");
assert.match(sDigest, /^Step B-02: 3s active, 2 failed tools\.\n\nRepeated commands in this step:\n- ×3, 3s: bash: npm test\n\nFailed commands and tools in this step:\n- 1\/3 failed: bash: npm test\n- 1 failed: edit: Edit without read: a.ts\n\nStep log \(its notes and checks\):\n- \[x\] \*\*B-02\*\* fix\n- check: npm test failed once, then ok$/, "only this step's log entry");

const labels = statsItems(saved).map((item) => item.label).join("\n");
assert.match(labels, /Tests: \d+s/);
assert.match(labels, /p\/m:medium: 5s · 1 replies/);
assert.match(labels, /Waiting for you/);
// L3 digest: counted repeats and failures; a retry only from a cited check/note line, never inferred from a repeat.
const digestStats = { ...emptyStats(), activeMs: 600_000, runs: 2, waitingMs: 150_000, toolWallMs: 300_000,
	commands: { [["bash", "npm test"].join("\0")]: { count: 3, ms: 90_000, maxMs: 40_000, failures: 2 }, [["bash", "git status"].join("\0")]: { count: 1, ms: 100, maxMs: 100, failures: 0 } },
	tools: { bash: { count: 4, ms: 90_100, maxMs: 40_000, failures: 2 }, edit: { count: 5, ms: 50, maxMs: 20, failures: 1 } },
	steps: { "A-01": { ms: 60_000, testMs: 0 }, "A-02": { ms: 400_000, testMs: 90_000, replies: 12, failures: 2 } } };
const digest = planDigest(digestStats, "# Plan3 log\n\n- [x] **A-02** retry logic for uploads\n  - check: npm test failed twice, reran after the fix -> ok\n");
assert.match(digest, /waiting for the user 2m 30s \(25%\)/);
assert.match(digest, /Slowest steps:\n- A-02: 6m 40s, tests 1m 30s, 12 replies, 2 failed tools\n- A-01: 1m 0s/);
assert.match(digest, /Repeated commands[^\n]*:\n- ×3, 1m 30s: bash: npm test\n\n/);
assert.doesNotMatch(digest, /git status/, "a command run once is neither repeated nor failed");
assert.match(digest, /- 2\/3 failed: bash: npm test\n- tool bash: 2\/4 failed\n- tool edit: 1\/5 failed/);
assert.match(digest, /Retries[^\n]*:\n- log line 4: - check: npm test failed twice, reran after the fix -> ok$/, "only the cited check line, not the step text about retry logic");
const noRetry = planDigest(digestStats, "");
assert.match(noRetry, /Retries[^\n]*:\n- retries not recorded$/, "a repeated, failing command is not reported as a retry");
assert.match(planDigest(emptyStats()), /Slowest steps:\n- none recorded/);
const pooled = planDigest({ ...digestStats, commands: { ...digestStats.commands, "\0(other)": { count: 50, ms: 1000, maxMs: 100, failures: 4 } } });
assert.match(pooled, /approximate, over 200 distinct commands/);
assert.doesNotMatch(pooled, /other/i, "the evicted-commands pool is not listed as a repeated or failed command");
await rm(directory, { recursive: true, force: true });
// Retro: the cap holds per side, advice citing a line that is not in the digest is dropped, a wrong shape is undefined.
const rDigest = "Slowest steps:\n- S1: 5m\n- S2: 1m";
const rec = (cites) => ({ advice: "do x", cites });
const retro = parseRetro(`Sure: ${JSON.stringify({ project: [rec("- S1: 5m"), rec("S2: 1m"), rec("- S1: 5m"), rec("- S2: 1m")], workflow: [rec("- S9: invented"), rec("S1: 5m")] })}`, rDigest);
assert.equal(retro.project.length, 3, "at most 3 per side");
assert.deepEqual(retro.workflow, [{ ...rec("S1: 5m"), evidence: "- S1: 5m", scope: "ce-workflow" }], "an invented citation is dropped; a missing scope falls back to the list");
assert.equal(retro.uncited, 1);
assert.equal(parseRetro("{\"project\":[]}", rDigest), undefined);
assert.match(retroPrompt("T", rDigest), /At most 3 per list[\s\S]*- S2: 1m$/);
assert.doesNotMatch(retroPrompt("T", rDigest), /"plan"/, "the finish retro offers no plan scope");
assert.match(retroPrompt("T", rDigest, "S2"), /^Step S2 of the plan "T" just finished[\s\S]*"plan" \(a work rule for the rest of this plan only\)/);
const scopedReply = JSON.stringify({ project: [{ ...rec("S1: 5m"), scope: "script" }, { ...rec("S2: 1m"), scope: "bogus" }], workflow: [{ ...rec("S1: 5m"), scope: "plan" }] });
const finishScoped = parseRetro(scopedReply, rDigest);
assert.deepEqual([finishScoped.project.map((r) => r.scope), finishScoped.workflow, finishScoped.rejected], [["script", "project"], [], 1], "the finish retro rejects plan scope");
assert.deepEqual(parseRetro(scopedReply, rDigest, { step: true }).workflow.map((r) => r.scope), ["plan"], "a step retro keeps it");
// RF-03 requests: redacted (secret, full path, user name), quote the matched digest line, one file per item, self-ignoring folder.
assert.equal(redactRequest("run C:\\Users\\jdoe\\repo\\test.mjs and /home/jdoe/x/y.sh with token=abc123def for jdoe", "jdoe"),
	"run <path>/test.mjs and <path>/y.sh with token=[REDACTED] for <user>");
const reqDir = await mkdtemp(path.join(os.tmpdir(), "plan3-req-"));
const reqDigest = "Repeated commands:\n- ×4, 2m: bash: node C:/Users/jdoe/repo/scripts/t.mjs --key=sk-abcdefghijklmnop1234";
const leaky = { advice: "Add a quick mode to C:/Users/jdoe/repo/scripts/t.mjs", cites: "bash: node C:/Users/jdoe/repo/scripts/t.mjs", scope: "script" };
const parsed = parseRetro(JSON.stringify({ project: [leaky, leaky, { ...leaky, scope: "plan" }], workflow: [] }), reqDigest, { step: true });
const items = [...parsed.project, ...parsed.workflow];
assert.deepEqual(await writeRequests(reqDir, { title: "T", step: "S1", items }).then((files) => files.length), 1, "the same item twice writes one file; plan scope writes none");
assert.equal((await writeRequests(reqDir, { title: "T", items })).length, 0, "a later retro repeating it writes nothing");
assert.equal(await readFile(path.join(reqDir, ".ce-workflow", "local", ".gitignore"), "utf8"), "*\n");
const [reqFile] = await readdir(path.join(reqDir, ".ce-workflow", "local", "requests"));
assert.match(reqFile, /^script-[0-9a-f]{12}\.md$/);
const body = await readFile(path.join(reqDir, ".ce-workflow", "local", "requests", reqFile), "utf8");
assert.match(body, /^# Add a quick mode to <path>\/t\.mjs\n[\s\S]*- From: step S1 of plan "T"\n- Evidence: ×4, 2m: bash: node <path>\/t\.mjs --key=\[REDACTED\]/);
assert.doesNotMatch(body, /jdoe|Users|sk-/, "no user, path or secret");
// The retro sees pending and done titles, so it can skip paraphrases of them.
await mkdir(path.join(reqDir, ".ce-workflow", "local", "requests", "done"), { recursive: true });
await writeFile(path.join(reqDir, ".ce-workflow", "local", "requests", "done", "project-old.md"), "# Old advice\n");
assert.deepEqual((await knownRequests(reqDir)).sort(), ["Add a quick mode to <path>/t.mjs", "Old advice"]);
assert.match(retroPrompt("T", rDigest, "S2", ["Old advice"]), /Already requested[^\n]*\n- Old advice\n/);
assert.doesNotMatch(retroPrompt("T", rDigest), /Already requested/);
await rm(reqDir, { recursive: true, force: true });
console.log("ok - plan3 stats collection, classification, viewer and digest");
