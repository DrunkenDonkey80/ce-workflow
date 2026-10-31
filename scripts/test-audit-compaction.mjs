import assert from "node:assert/strict";
import { auditSession } from "./audit-compaction.mjs";

let n = 0;
const id = () => `e${++n}`;
const user = text => ({ type: "message", id: id(), message: { role: "user", content: [{ type: "text", text }] } });
const call = (name, args) => ({ type: "message", id: id(), message: { role: "assistant", content: [{ type: "toolCall", name, arguments: args }] } });
const ask = "please make the export button save the album as a pdf file";
const kept = call("read", { path: "src/kept.ts" });
const entries = [
	{ type: "session", id: id(), cwd: "C:/repo" },
	user(ask),
	call("read", { path: "C:\\repo\\src\\lost.ts" }), call("read", { path: "src/edited.ts" }), call("read", { path: "skills/x/SKILL.md" }),
	call("bash", { command: "npm   run build" }),
	kept,
	{ type: "compaction", id: id(), firstKeptEntryId: kept.id, summary: "Touched C:/repo/src/lost.ts and C:/repo/src/never.ts", tokensBefore: 1000, details: { compactionMode: "hybrid" } },
	call("read", { path: "src/lost.ts" }), // relative path, same file: a reread
	call("read", { path: "src/kept.ts" }), // still in context: not a loss
	call("read", { path: "skills/x/SKILL.md" }), // instructions: reloaded by design
	call("edit", { path: "src/edited.ts" }), call("read", { path: "src/edited.ts" }), // read after its own edit: new work
	call("bash", { command: "npm run build" }),
	user(ask + " again?"),
];
const [r] = auditSession(entries);
assert.equal(r.mode, "hybrid");
assert.deepEqual(r.rereads, ["c:/repo/src/lost.ts"]);
assert.deepEqual(r.repeatedCmds, ["npm run build"]);
assert.equal(r.userRepeats.length, 1);
assert.equal(r.corrections.length, 1);
assert.deepEqual([r.summaryPaths, r.summaryPathsUsed], [2, 1]);
console.log("ok - compaction audit finds rereads, reruns and repeated asks of dropped context only");
