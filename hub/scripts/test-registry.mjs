import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Registry, scanRecents, star } from "../src/registry.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hub-registry-"));
const data = path.join(root, "data"), sessions = path.join(root, "sessions");
const write = (dir, name, lines, ageDays = 0) => {
	fs.mkdirSync(path.join(sessions, dir), { recursive: true });
	const file = path.join(sessions, dir, name);
	fs.writeFileSync(file, lines.map(l => JSON.stringify(l)).join("\n") + "\n");
	const time = new Date(Date.now() - ageDays * 86_400_000);
	fs.utimesSync(file, time, time);
	return file;
};
const header = (cwd, id) => ({ type: "session", version: 3, id, timestamp: "2026-10-18T00:00:00Z", cwd });

try {
	const recentFile = write("--C--work-sketchup--", "a.jsonl", [header("C:\\work\\sketchup", "s1"), { type: "session_info", name: "Roof" }, { type: "message", message: { role: "user", content: "hi" } }, { type: "session_info", name: "Roof v2" }]);
	write("--C--work-sketchup--", "old.jsonl", [header("C:\\work\\sketchup", "s2")], 40);
	write("--C--work-other--", "bad.jsonl", [{ type: "message" }]);
	fs.mkdirSync(path.join(sessions, "--C--work-other--", "subdir"));
	fs.writeFileSync(path.join(sessions, "--C--work-other--", "subdir", "nested.jsonl"), JSON.stringify(header("C:\\x", "n")) + "\n");

	const registry = new Registry(data);
	let recents = await scanRecents(registry, { sessionsDir: sessions });
	assert.deepEqual(recents.map(r => [r.sessionId, r.name]), [["s1", "Roof v2"]], "only recent, valid, top-level files; latest name wins");

	const starred = star(registry, recents[0], " 1 ");
	assert.equal(starred.name, "1");
	assert.equal(starred.state, "parked");
	assert.throws(() => star(registry, recents[0], "again"), /already in a group/);
	assert.deepEqual(await scanRecents(registry, { sessionsDir: sessions }), [], "starred sessions leave Recents");

	registry.add({ name: "2", folder: "C:\\work\\sketchup", state: "running" });
	registry.add({ name: "10", folder: "c:\\work\\SKETCHUP" });
	registry.add({ name: "main", folder: "C:\\work\\alpha" });
	const groups = registry.groups();
	assert.deepEqual(groups.map(g => [g.label, g.sessions.map(s => s.name)]), [["alpha", ["main"]], ["sketchup", ["1", "2", "10"]]], "folder groups, case-insensitive, numeric order");

	const reopened = new Registry(data);
	assert.equal(reopened.list().length, 4, "atomic save persists");
	assert.equal(reopened.update(starred.id, { name: "Roof" }).name, "Roof");
	assert.throws(() => reopened.update(starred.id, { name: "  " }), /needs a name/);
	reopened.remove(starred.id);
	assert.equal(fs.existsSync(recentFile), true, "unstar keeps the session file");
	recents = await scanRecents(reopened, { sessionsDir: sessions });
	assert.deepEqual(recents.map(r => r.sessionId), ["s1"], "unstarred session is back in Recents while recent");
	assert.deepEqual(fs.readdirSync(data), ["sessions.json"], "no temporary files left");
	// Sidebar folders: dragged order first, the rest by name; archive flags survive a reload.
	const folders = new Registry(path.join(root, "folders")), [a, b, c] = ["alpha", "beta", "gamma"].map(name => path.join(root, name));
	for (const [n, folder] of [a, b, b, c].entries()) folders.add({ name: String(n), folder });
	folders.arrange({ order: [c, a] }); folders.arrange({ archive: b });
	assert.deepEqual(new Registry(path.join(root, "folders")).groups().map(g => [g.label, g.archived]), [["gamma", false], ["alpha", false], ["beta", true]]);
	assert.throws(() => folders.arrange({ archive: path.join(root, "nope") }), /Unknown folder/);
	console.log("registry ok");
} finally {
	fs.rmSync(root, { recursive: true, force: true });
}
