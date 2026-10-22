// Project commands: per-folder store in the hub's data (add replaces by name, remove, validation) and a run that
// starts its command line in the folder.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createCommands, runCommand } from "../src/commands.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hub commands "));
try {
	const commands = createCommands(root), folder = path.join(root, "Project");
	fs.mkdirSync(folder);
	assert.deepEqual(commands.list(folder), []);
	commands.add(folder, { name: "Tests", kind: "prompt", text: "run the tests", help: "Agent runs tests" });
	commands.add(folder, { name: "Terminal", kind: "run", text: "start wt -d ." });
	commands.add(folder, { name: "tests", kind: "prompt", text: "run the tests and fix failures" });
	assert.deepEqual(commands.list(folder).map(c => [c.name, c.text]), [["Terminal", "start wt -d ."], ["tests", "run the tests and fix failures"]], "same name replaces");
	if (process.platform === "win32") assert.equal(commands.list(folder.toUpperCase()).length, 2, "Windows folders match in any case");
	assert.deepEqual(commands.list(path.join(root, "Other")), [], "commands belong to one folder");
	assert.throws(() => commands.add(folder, { name: "X", kind: "shell", text: "x" }), /kind/);
	assert.throws(() => commands.add(folder, { name: "", kind: "run", text: "x" }), /name/);
	assert.throws(() => commands.add(folder, { name: "X", kind: "run", text: " " }), /text/);
	assert.equal(commands.remove(folder, "TERMINAL"), true);
	assert.equal(commands.remove(folder, "Terminal"), false);
	assert.equal(createCommands(root).list(folder).length, 1, "kept on disk");
	// A run command starts in its folder and is not awaited.
	runCommand(folder, "echo ran> marker.txt");
	for (let i = 0; i < 50 && !fs.existsSync(path.join(folder, "marker.txt")); i++) await new Promise(done => setTimeout(done, 100));
	assert.match(fs.readFileSync(path.join(folder, "marker.txt"), "utf8"), /ran/);
	console.log("commands ok");
} finally {
	fs.rmSync(root, { recursive: true, force: true, maxRetries: 5 });
}
