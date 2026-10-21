// S-08: the hub answers the Claude pool itself through claudeex's cpool CLI (D9), finds cpool from
// Pi's package list, refuses bad actions, and runs a daemon only while none is alive (D13).
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createPool, findCpool } from "../src/pool.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hub-pool-"));
const pkg = path.join(root, "claudeex"), agent = path.join(root, "agent");
fs.mkdirSync(path.join(pkg, "bin"), { recursive: true }); fs.mkdirSync(agent);
const log = path.join(root, "calls.log"), cpool = path.join(pkg, "bin", "cpool.mjs");
// Fake cpool: records argv; `daemon` refuses when a marker file says one is alive, else runs until killed.
fs.writeFileSync(cpool, `import fs from "node:fs";
const args = process.argv.slice(2); fs.appendFileSync(${JSON.stringify(log)}, args.join(" ") + "\\n");
if (args[0] === "view") console.log(JSON.stringify({ title: "Claude accounts", drain7d: false, rows: [{ label: "a" }] }));
else if (args[0] === "action") args[1] === "explode" ? (console.error("no such act"), process.exit(1)) : console.log(JSON.stringify({ text: "did " + args[1] }));
else if (args[0] === "daemon") { if (fs.existsSync(${JSON.stringify(path.join(root, "alive"))})) { console.error("cpool daemon already running (pid 1)"); process.exit(1); } setInterval(() => {}, 1000); }`);
fs.writeFileSync(path.join(pkg, "package.json"), JSON.stringify({ name: "claudeex", bin: { cpool: "bin/cpool.mjs" } }));
fs.writeFileSync(path.join(agent, "settings.json"), JSON.stringify({ packages: ["npm:pi-lens", { source: "npm:other@1.0.0" }, path.relative(agent, pkg)] }));
const calls = () => fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n") : [];
const waitFor = async (test, what) => { for (let i = 0; i < 100 && !test(); i++) await new Promise(r => setTimeout(r, 50)); assert(test(), what); };

delete process.env.PI_HUB_CPOOL;
assert.equal(findCpool(agent), cpool, "relative package path from settings.json");
assert.equal(findCpool(path.join(root, "nowhere")), undefined);

// Absent claudeex: no view, and actions say so.
process.env.PI_CODING_AGENT_DIR = path.join(root, "nowhere"); // the default lookup must not find this PC's real claudeex
const none = createPool();
assert.equal(await none.view(), null);
await assert.rejects(none.action({ act: "mode" }), error => error.status === 404);

const pool = createPool({ cpool, retryMs: 100, log: () => {} });
assert.deepEqual((await pool.view()).rows, [{ label: "a" }]);
const done = await pool.action({ act: "priority", label: "a", value: 2 });
assert.equal(done.message, "did priority"); assert.equal(done.view.title, "Claude accounts");
assert(calls().includes("action priority a 2 --json"));
await pool.action({ act: "mode" });
assert(calls().includes("action mode  --json"), "global acts pass an empty label");
for (const bad of [{ act: "explode" }, { act: "priority", label: "a", value: 5 }, { act: "switch", label: "--help" }, { act: "up", label: 3 }, { act: "up", label: "a", value: 1.5 }])
	await assert.rejects(pool.action(bad), error => error.status === 400, JSON.stringify(bad));

// D13: a daemon already alive wins; the hub's own refuses, retries, and takes over once that one is gone.
fs.writeFileSync(path.join(root, "alive"), "");
pool.start();
await waitFor(() => calls().filter(line => line.startsWith("daemon")).length >= 2, "the refused daemon is retried");
await waitFor(() => pool.daemon() === undefined, "the refused daemon has closed");
fs.rmSync(path.join(root, "alive"));
await waitFor(() => pool.daemon()?.exitCode === null && pool.daemon()?.pid, "the hub runs its own daemon once none is alive");
const own = pool.daemon();
pool.stop();
await waitFor(() => own.exitCode !== null || own.signalCode !== null, "stop kills only the daemon it started");
const count = calls().filter(line => line.startsWith("daemon")).length;
await new Promise(r => setTimeout(r, 300));
assert.equal(calls().filter(line => line.startsWith("daemon")).length, count, "no retry after stop");

fs.rmSync(root, { recursive: true, force: true });
console.log("test-pool: ok");
