import assert from "node:assert/strict";
import { auditSession } from "./audit-compaction.mjs";

let n = 0;
const id = () => `e${++n}`;
const user = text => ({ type: "message", id: id(), message: { role: "user", content: [{ type: "text", text }] } });
const call = (name, args) => ({ type: "message", id: id(), message: { role: "assistant", content: [{ type: "toolCall", name, arguments: args }] } });
const ask = "please make the export button save the album as a pdf file";
const question = { question: "Which paper size should the exported album pdf use by default?" };
const fix = { path: "src/fix.ts", edits: [{ oldText: "a", newText: "b" }] };
const timer = "\u23f0 Scheduled (script timer a1b2c3d4): export build of the album pdf file finished, please check the export button";
const kept = call("read", { path: "src/kept.ts" });
const entries = [
	{ type: "session", id: id(), cwd: "C:/repo" },
	user(ask), user("commit and push; before pushing run only the targeted tests"), user(timer),
	call("read", { path: "C:\\repo\\src\\lost.ts" }), call("read", { path: "src/edited.ts" }), call("read", { path: "skills/x/SKILL.md" }),
	call("bash", { command: "npm   run build" }), call("ask_user", question), call("edit", fix),
	kept,
	{ type: "compaction", id: id(), firstKeptEntryId: kept.id, summary: "s", tokensBefore: 1000, details: { compactionMode: "hybrid" } },
	call("read", { path: "src/lost.ts" }), // relative path, same file: a reread
	call("read", { path: "src/kept.ts" }), // still in context: not a loss
	call("read", { path: "skills/x/SKILL.md" }), // instructions: reloaded by design
	call("edit", { path: "src/edited.ts", content: "x" }), call("read", { path: "src/edited.ts" }), // read after its own edit: new work
	call("bash", { command: "npm run build" }),
	call("ask_user", { questions: [{ question: "Which default paper size should the exported album pdf use?" }] }),
	call("edit", fix), // the same edit again: redone work
	user("as I said, " + ask),
	user("the sidebar collapses and shows again?"), // a new bug report, not a correction
	user("commit and push; before pushing run only the targeted tests"), // a button prompt sent again: not a repeat
	user(timer + " again"), // machine output: never a user repeat
	...Array.from({ length: 41 }, () => call("bash", { command: "ls" })),
	user("you forgot " + ask), // past the 40-call window: not counted
];
const [r] = auditSession(entries);
assert.equal(r.mode, "hybrid");
assert.deepEqual(r.rereads, ["c:/repo/src/lost.ts"]);
assert.deepEqual(r.repeatedCmds, ["npm run build"]);
assert.deepEqual(r.redoneEdits, ["c:/repo/src/fix.ts"]);
assert.equal(r.reasks.length, 1);
assert.equal(r.userRepeats.length, 1);
assert.equal(r.corrections.length, 1);
console.log("ok - compaction audit finds rereads, reruns, redone edits, re-asked questions and repeated asks of dropped context only");
