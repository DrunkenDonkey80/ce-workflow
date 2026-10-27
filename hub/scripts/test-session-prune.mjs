// Session cleanup: 14 days trims (images, long tool output, details; mtime kept), forks and 30-day files go to the bin,
// sidebar sessions are only trimmed, fresh files are untouched.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pruneSessions, sessionTrash, trash, trimLine } from "../src/session-prune.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hub-prune-")), dir = path.join(root, "--C--proj--");
const now = Date.now(), DAY = 86_400_000;
const user = JSON.stringify({ type: "message", id: "u", message: { role: "user", content: [{ type: "text", text: "hi" }, { type: "image", data: "A".repeat(5000), mimeType: "image/png" }] } });
const tool = JSON.stringify({ type: "message", id: "t", parentId: "u", message: { role: "toolResult", toolCallId: "c", content: [{ type: "text", text: "x".repeat(3000) }], details: { blob: "B".repeat(3000) } } });
const edit = JSON.stringify({ type: "message", id: "e", message: { role: "toolResult", toolCallId: "d", content: [{ type: "text", text: "ok" }], details: { diff: "+1 a" } } });
const write = (name, days) => { const file = path.join(dir, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, [user, tool, edit].join("\n") + "\n"); const at = new Date(now - days * DAY); fs.utimesSync(file, at, at); return file; };
const files = { fresh: write("fresh.jsonl", 3), old: write("old.jsonl", 20), ancient: write("ancient.jsonl", 40), starred: write("starred.jsonl", 40), fork: write("s/forks/f.jsonl", 15) };
try {
	const binned = [];
	const result = await pruneSessions({ byFile: file => file === files.starred }, root, { now, moveToTrash: async list => { binned.push(...list); for (const file of list) fs.rmSync(file); } });
	assert.deepEqual(binned.sort(), [files.ancient, files.fork].sort(), "a 30-day file and a 14-day fork go to the bin");
	assert.equal(fs.existsSync(path.join(dir, "s")), false, "an emptied fork folder goes too");
	assert.equal(result.trimmed, 2);
	const [u, t, e] = fs.readFileSync(files.old, "utf8").trim().split("\n").map(line => JSON.parse(line));
	assert.deepEqual(u.message.content, [{ type: "text", text: "hi" }, { type: "text", text: "[image removed]" }]);
	assert.equal(t.message.content[0].text, "x".repeat(500) + "\n[… 2500 more characters trimmed]");
	assert.equal(t.message.details, undefined); assert.equal(t.parentId, "u", "the tree stays");
	assert.deepEqual(e.message.details, { diff: "+1 a" }, "an edit's diff stays");
	assert(Math.abs(fs.statSync(files.old).mtimeMs - (now - 20 * DAY)) < 2000, "trimming keeps the age");
	assert(fs.statSync(files.starred).size < 2000, "a sidebar session is trimmed, never deleted");
	assert.equal(fs.readFileSync(files.fresh, "utf8").length, [user, tool, edit].join("\n").length + 1, "fresh files are untouched");
	for (const line of fs.readFileSync(files.old, "utf8").trim().split("\n")) assert.equal(trimLine(line), line, "trimming twice changes nothing");
	// Linux: the Trash holds the deleted sessions; Empty removes only those, never other trashed files.
	const platform = process.platform; Object.defineProperty(process, "platform", { value: "linux" }); process.env.XDG_DATA_HOME = path.join(root, "data");
	try {
		const gone = write("gone.jsonl", 40), mine = path.join(root, "mine.txt"); fs.writeFileSync(mine, "keep");
		await trash([gone, mine]);
		assert.deepEqual(sessionTrash(dir), { supported: true, files: 1, bytes: fs.statSync(path.join(root, "data", "Trash", "files", "gone.jsonl")).size });
		assert.equal(sessionTrash(dir, true).files, 0);
		assert.deepEqual(fs.readdirSync(path.join(root, "data", "Trash", "files")), ["mine.txt"], "other trashed files stay");
	} finally { Object.defineProperty(process, "platform", { value: platform }); delete process.env.XDG_DATA_HOME; }
	console.log("session prune ok");
} finally { fs.rmSync(root, { recursive: true, force: true }); }
