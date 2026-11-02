// Project commands: per-folder store in the hub's data (add replaces by name, remove, validation) and a run that
// starts its command line in the folder.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { commandMenu, createCommands, runCommand } from "../src/commands.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hub commands "));
try {
	const commands = createCommands(root), folder = path.join(root, "Project");
	fs.mkdirSync(folder);
	assert.deepEqual(commands.list(folder), []);
	commands.add(folder, { name: "Tests", kind: "prompt", text: "run the tests", help: "Agent runs tests" });
	commands.add(folder, { name: "Terminal", kind: "run", text: "start wt -d .", local: true });
	commands.add(folder, { name: "tests", kind: "prompt", text: "run the tests and fix failures" });
	assert.deepEqual(commands.list(folder).map(c => [c.name, c.text]), [["Terminal", "start wt -d ."], ["tests", "run the tests and fix failures"]], "same name replaces");
	assert.deepEqual(commands.list(folder).map(c => c.local), [true, undefined], "local (this PC only) is kept");
	if (process.platform === "win32") assert.equal(commands.list(folder.toUpperCase()).length, 2, "Windows folders match in any case");
	assert.deepEqual(commands.list(path.join(root, "Other")), [], "commands belong to one folder");
	assert.throws(() => commands.add(folder, { name: "X", kind: "shell", text: "x" }), /kind/);
	assert.throws(() => commands.add(folder, { name: "", kind: "run", text: "x" }), /name/);
	assert.throws(() => commands.add(folder, { name: "X", kind: "run", text: " " }), /text/);
	assert.equal(commands.remove(folder, "TERMINAL"), true);
	assert.equal(commands.remove(folder, "Terminal"), false);
	assert.equal(createCommands(root).list(folder).length, 1, "kept on disk");
	// Extra actions (one per click), a script-listed menu (run only), rename.
	const build = commands.add(folder, { name: "Build", kind: "run", text: "b", menu: true, actions: [{ name: "Clean", kind: "run", text: "c", click: "shift" }, { name: "Ask", kind: "prompt", text: "why?" }] });
	assert.deepEqual(build.actions.map(a => [a.name, a.click]), [["Clean", "shift"], ["Ask", undefined]]);
	assert.throws(() => commands.add(folder, { name: "X", kind: "run", text: "x", actions: [{ name: "A", kind: "run", text: "a", click: "ctrl" }, { name: "B", kind: "run", text: "b", click: "ctrl" }] }), /one action per click/);
	assert.throws(() => commands.add(folder, { name: "X", kind: "run", text: "x", actions: [{ name: "A", kind: "run", text: "a", click: "right" }] }), /click/);
	assert.throws(() => commands.add(folder, { name: "X", kind: "prompt", text: "x", menu: true }), /menu/);
	assert.equal(commands.rename(folder, "Build", " Make "), true);
	assert.throws(() => commands.rename(folder, "Make", "TESTS"), /already exists/);
	assert.equal(commands.rename(folder, "Nope", "Y"), false);
	assert.deepEqual(commands.list(folder).map(c => c.name), ["tests", "Make"]);
	assert.deepEqual(await commandMenu(folder, "node -e \"console.log(process.env.PI_HUB_CLICK + '\\n\\nTwo ')\""), ["menu", "Two"], "menu lists the script's lines");
	await assert.rejects(commandMenu(folder, "node -e \"process.exit(3)\""), /menu script failed/);
	// A run command starts in its folder and is not awaited.
	runCommand(folder, "node -e \"require('fs').writeFileSync('marker.txt', 'ran ' + process.env.PI_HUB_CLICK + ' ' + process.env.PI_HUB_ACTION)\"", undefined, { PI_HUB_CLICK: "menu", PI_HUB_ACTION: "Deploy" });
	for (let i = 0; i < 50 && !fs.existsSync(path.join(folder, "marker.txt")); i++) await new Promise(done => setTimeout(done, 100));
	assert.match(fs.readFileSync(path.join(folder, "marker.txt"), "utf8"), /ran menu Deploy/, "the click and action reach the script");
	console.log("commands ok");
} finally {
	fs.rmSync(root, { recursive: true, force: true, maxRetries: 5 });
}
