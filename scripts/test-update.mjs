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
