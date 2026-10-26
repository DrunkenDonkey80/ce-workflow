import assert from "node:assert/strict";
import { outsidePis } from "../src/update.ts";

const launcher = "node C:\\Users\\x\\.pi\\agent\\bin\\pi-launcher.js";
const procs = [
	{ pid: 10, ppid: 1, args: "node hub.ts" },
	{ pid: 11, ppid: 10, args: `${launcher} --mode rpc --name 1` }, // hub child
	{ pid: 12, ppid: 11, args: "node cli.js" },
	{ pid: 13, ppid: 12, args: `${launcher} --mode json` }, // its subagent
	{ pid: 20, ppid: 2, args: `${launcher} --session a.jsonl` }, // terminal Pi
	{ pid: 21, ppid: 20, args: "node release/cli.js" },
	{ pid: 30, ppid: 10, args: `${launcher} --session b.jsonl` }, // "Open in terminal": not RPC, so outside
];
assert.deepEqual(outsidePis(procs, 10).map(p => p.pid), [20, 30]);
assert.deepEqual(outsidePis(procs).map(p => p.pid), [11, 20, 30], "no hub: its children count too");
console.log("ok - update finds Pi processes the hub does not own");

// Hourly check: version order, one check at a time, and a failed check keeps the last good list.
const { newer, createUpdateCheck } = await import("../src/update-check.ts");
assert.equal(newer("1.3.1", "1.3.0"), true); assert.equal(newer("1.10.0", "1.9.9"), true);
assert.equal(newer("1.3.0", "1.3.0"), false); assert.equal(newer("1.2.9", "1.3.0"), false);
let calls = 0, fail = false;
const check = createUpdateCheck({ find: async () => { calls++; if (fail) throw new Error("offline"); return { pi: null, packages: ["pi-lens"] }; } });
assert.equal(check.state().checkedAt, null);
await Promise.all([check.check(), check.check()]);
assert.equal(calls, 1, "concurrent checks share one run");
assert.deepEqual(check.state().packages, ["pi-lens"]);
fail = true; await check.check();
assert.deepEqual([check.state().packages, check.state().error], [["pi-lens"], "offline"], "a failed check keeps the last list");
console.log("ok - hourly update check");

// Uninstall from the gear: only a listed package, never ce-workflow, and the list drops it without a new check.
const removed = [];
const list = createUpdateCheck({
	find: async () => ({ pi: null, packages: ["pi-lens"], installed: [{ source: "npm:pi-lens", name: "pi-lens", version: "1.0.0", update: true }, { source: "git:github.com/x/ce-workflow", name: "ce-workflow", version: "0.1.73", update: false }] }),
	remove: async source => { removed.push(source); return true; },
});
await assert.rejects(list.remove("npm:pi-lens"), /check for updates first/, "nothing listed before the first check");
await list.check();
await assert.rejects(list.remove("npm:other"), /Not an installed extension/);
await assert.rejects(list.remove("git:github.com/x/ce-workflow"), /hub runs from ce-workflow/);
const after = await list.remove("npm:pi-lens");
assert.deepEqual([removed, after.installed.map(i => i.name), after.packages], [["npm:pi-lens"], ["ce-workflow"], []]);
const { packageName } = await import("../src/update-check.ts");
assert.deepEqual(["npm:@upstash/context7-pi", "git:github.com/x/pi-effort", String.raw`..\..\git\pi-chatgpt-web`].map(packageName), ["@upstash/context7-pi", "pi-effort", "pi-chatgpt-web"]);
console.log("ok - uninstall an extension from the gear");

// The 10-minute look at ce-workflow alone: a newer GitHub version marks it, no full check runs; local checkouts are skipped.
for (const [source, remote, marked] of [["git:github.com/x/ce-workflow", "0.1.81", true], ["git:github.com/x/ce-workflow", "0.1.80", false], [String.raw`C:gitce-workflow`, "0.1.81", false]]) {
	let full = 0;
	const quick = createUpdateCheck({ find: async () => { full++; return { pi: null, packages: [], installed: [{ source, name: "ce-workflow", version: "0.1.80", update: false }] }; }, latest: async () => remote });
	await quick.check(); const state = await quick.quick();
	assert.deepEqual([state.packages, state.installed[0].update, full], [marked ? ["ce-workflow"] : [], marked, 1], `${source} ${remote}`);
	if (marked) assert.deepEqual((await quick.quick()).packages, ["ce-workflow"], "marked once");
}
console.log("ok - quick ce-workflow check");
