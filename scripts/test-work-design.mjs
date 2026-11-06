#!/usr/bin/env node
// design tool: sessions persist per handle, status follows newer runs, retry reuses the session, ended runs mirror
// into .pi/designs/<handle>/ (removed files go, a failed fetch keeps the old mirror, a run is reported once), select exports to a named folder and hands it on.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { building, checkRuns, runDesign } from "../extensions/design.ts";
assert.equal(building({ status: "running", runStarted: Date.now() - 185_000 }), "building 3 min");
assert.equal(building({ status: "queued", runStarted: 2 }), "queued", "a createdAt that is not a time shows no minutes");
assert.equal(building({ status: "succeeded", runStarted: Date.now() }), "");

const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "design-test-"));
try {
	fs.writeFileSync(path.join(cwd, "page.html"), "<h1>Home</h1>");
	const projects = new Map(), calls = [];
	let runs = [], files = {};
	const od = {
		async call(tool, args) {
			calls.push([tool, args]);
			if (tool === "create_project") { projects.set(args.id, args); return { project: { id: args.id }, conversationId: `c-${args.id}` }; }
			if (tool === "get_project") { if (!projects.has(args.project)) throw Object.assign(new Error("missing"), { category: "invalid-input" }); return { project: { id: args.project } }; }
			if (tool === "write_file") return { ok: true };
			if (tool === "start_run") {
				if (args.prompt.includes("fail-me")) throw new Error("daemon down token=secret");
				const id = `run-${runs.length + 1}`;
				runs.push({ id, projectId: args.project, status: "running", createdAt: runs.length + 1 });
				return { runId: id, projectId: args.project, studioUrl: "http://127.0.0.1:1/studio" };
			}
			throw new Error(`unexpected ${tool}`);
		},
		async api(apiPath, as) {
			const url = new URL(apiPath, "http://x");
			if (url.pathname === "/api/runs") return { runs: runs.filter(run => run.projectId === url.searchParams.get("projectId")).concat({ id: "other", projectId: "nope", createdAt: 99 }) };
			const filesMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/files(?:\/(.+))?$/);
			if (filesMatch && !filesMatch[2]) return { files: Object.keys(files[filesMatch[1]] ?? {}).map(p => ({ type: "file", path: p })) };
			if (filesMatch) { assert.equal(as, "bytes"); return Buffer.from(files[filesMatch[1]][decodeURIComponent(filesMatch[2])]); }
			if (url.pathname.endsWith("/messages")) return { messages: [{ role: "user", content: "make it blue" }, { role: "assistant", content: "Done", runId: "run-9", runStatus: "succeeded" }] };
			if (url.pathname.endsWith("/comments")) return { comments: [{ text: "nice" }] };
			throw new Error(`unexpected api ${apiPath}`);
		},
	};

	// Hub: each started session gets its own hub Pi session and a first message; hub down is reported, not fatal.
	// Always pass these fakes: the default tools create real hub sessions.
	const hubCalls = [];
	let hubUp = true, hubN = 0;
	const tools = {
		async hub(args) { hubCalls.push(args); if (!hubUp) return { ok: false, text: "hub not running token=abc" }; if (args[0] === "session") return { ok: true, text: JSON.stringify({ id: args[1], name: "Parent" }) }; return ["new", "fork"].includes(args[0]) ? { ok: true, text: `New session ${args[2]}: http://127.0.0.1:1/s/00000000-0000-0000-0000-00000000000${++hubN}/?token=x` } : { ok: true, text: "Sent." }; },
	};
	// Named by direction (given name, else the direction's first words), the brief's first line below, the starting session kept.
	process.env.PI_HUB_SESSION = "parent-session";
	const started = await runDesign(cwd, { action: "start", brief: "Home page\nThe whole landing page, real copy.", directions: ["calm", "bold editorial with a very long description of everything it should be"], names: ["Calm", "Bold editorial"], title: "Home page", inputs: ["page.html", "../escape.txt"] }, undefined, od, tools);
	delete process.env.PI_HUB_SESSION;
	assert.deepEqual(started.map(item => [item.name, item.title, item.from]), [["Calm", "Home page", "parent-session"], ["Bold editorial", "Home page", "parent-session"]]);
	assert.deepEqual(started.map(item => item.hubSessionId), ["00000000-0000-0000-0000-000000000001", "00000000-0000-0000-0000-000000000002"]);
	assert.deepEqual(hubCalls[0], ["new", cwd, "Calm"]);
	assert.deepEqual(hubCalls[1], ["subtitle", "00000000-0000-0000-0000-000000000001", "queued · Home page"], "a queued run shows in the second line");
	assert.match(hubCalls[2].join(" "), /^prompt 0[0-]+1 You are design session design-1 \(Calm\): .*calm.*first run is going/);
	assert.deepEqual(started.map(item => [item.handle, item.status, item.runId]), [["design-1", "queued", "run-1"], ["design-2", "queued", "run-2"]]);
	assert.equal(new Set(started.map(item => item.projectId)).size, 2, "one OpenDesign project per direction");
	assert.match(started[0].prompt, /^Home page\nThe whole landing page[\s\S]*Direction for this design \(design-1\): calm[\s\S]*inputs\/[0-9a-f]{16}-page\.html[\s\S]*Not sent: \.\.\/escape\.txt/);
	const stored = JSON.parse(fs.readFileSync(path.join(cwd, ".pi/designs/sessions.json"), "utf8"));
	assert.equal(stored.next, 3);

	// The user (or OD) starts a newer run in the app: status follows it, ignoring other projects.
	runs[0].status = "succeeded";
	runs.push({ id: "run-9", projectId: started[0].projectId, status: "succeeded", createdAt: 50 });
	files[started[0].projectId] = { "index.html": "<h1>Blue</h1>", "assets/a.css": "h1{}", "inputs/x-page.html": "src" };
	const [first] = await runDesign(cwd, { action: "status", handle: "design-1" }, undefined, od, tools);
	assert.equal(first.runId, "run-9");
	assert.deepEqual(first.files.sort(), ["assets/a.css", "index.html"], "read-only inputs are not design output");

	// Retry: a failed start is recorded (redacted); retry with the same session starts a new run.
	await assert.rejects(runDesign(cwd, { action: "retry", handle: "design-2" }, undefined, od, tools), /still running/);
	runs[1].status = "failed";
	const [retried] = await runDesign(cwd, { action: "retry", handle: "design-2" }, undefined, od, tools);
	assert.equal(retried.status, "queued");
	assert.notEqual(retried.runId, "run-2");
	const failing = await runDesign(cwd, { action: "start", brief: "fail-me", directions: ["x"], names: ["X"], title: "t" }, undefined, od, tools);
	assert.match(failing[0].error, /daemon down/);
	assert.doesNotMatch(failing[0].error, /secret/);
	assert.equal(failing[0].hubSessionId, undefined, "no hub session for a session that never started");

	// Inside a design session (PI_HUB_SESSION): send and show default to its own handle.
	process.env.PI_HUB_SESSION = "00000000-0000-0000-0000-000000000001";
	const shown = await runDesign(cwd, { action: "show" }, undefined, od, tools);
	assert.equal(shown.handle, "design-1");
	assert.deepEqual([shown.folder, shown.files, shown.page, shown.changes], [".pi/designs/design-1", ["assets/a.css", "index.html"], "index.html", { added: ["assets/a.css", "index.html"], changed: [], removed: [] }], "show mirrors a run that ended unseen");
	const mirrored = path.join(cwd, ".pi/designs/design-1");
	assert.equal(fs.readFileSync(path.join(mirrored, "index.html"), "utf8"), "<h1>Blue</h1>");
	assert.equal(shown.shots, undefined, "no screenshots: the page previews the mirror");
	const [sent] = await runDesign(cwd, { action: "send", message: "make the header green" }, undefined, od, tools);
	assert.equal(sent.handle, "design-1");
	assert.match(calls.at(-1)[1].prompt, /^make the header green\n\nWrite the changes/);
	assert.match(JSON.parse(fs.readFileSync(path.join(cwd, ".pi/designs/sessions.json"), "utf8")).sessions[0].prompt, /^Home page/, "retry keeps the original brief");
	runs.at(-1).createdAt = 60; // newer than run-9
	await assert.rejects(runDesign(cwd, { action: "send", message: "again" }, undefined, od, tools), /still running/);
	delete process.env.PI_HUB_SESSION;
	runs.at(-1).status = "succeeded";

	// The watcher mirrors an ended run: a removed asset leaves the mirror; a restarted watcher does not report it again.
	const original = files[started[0].projectId];
	files[started[0].projectId] = { "index.html": "<h1>Green</h1>", "inputs/x-page.html": "src" };
	assert.deepEqual((await checkRuns(cwd, od, { handle: "design-1" }, new Set())).ended, ["design-1: succeeded (0 added, 1 changed, 1 removed)"]);
	assert.equal(fs.readFileSync(path.join(mirrored, "index.html"), "utf8"), "<h1>Green</h1>");
	assert(!fs.existsSync(path.join(mirrored, "assets/a.css")), "a file the run no longer has is deleted");
	assert.deepEqual((await checkRuns(cwd, od, { handle: "design-1" }, new Set())).ended, [], "reported once, even after a watcher restart");
	// A fetch failing midway keeps the previous mirror whole and the run unmirrored, so the next pass tries again.
	runs.push({ id: "run-x", projectId: started[0].projectId, status: "succeeded", createdAt: 70 });
	files[started[0].projectId] = { "index.html": "<h1>Red</h1>", "broken.css": undefined };
	await assert.rejects(checkRuns(cwd, od, { handle: "design-1" }, new Set()));
	assert.equal(fs.readFileSync(path.join(mirrored, "index.html"), "utf8"), "<h1>Green</h1>");
	assert.notEqual(JSON.parse(fs.readFileSync(path.join(cwd, ".pi/designs/sessions.json"), "utf8")).sessions[0].mirroredRun, "run-x");
	files[started[0].projectId] = original;

	// Select (R7): exports the mirror plus conversation and comments to docs/designs/<name>/, stars it, asks where to implement.
	const asked = [];
	const choose = value => ({ ...tools, ask: async (title, _purpose, items) => { asked.push([title, items.map(item => item.value)]); return value; } });
	const exported = path.join(cwd, "docs/designs/calm");
	hubCalls.length = 0;
	const selected = await runDesign(cwd, { action: "select", handle: "@design-1" }, undefined, od, choose("start"));
	assert.deepEqual([selected.folder, selected.files, selected.changes], ["docs/designs/calm/", ["assets/a.css", "index.html"], undefined], "named by the design, the run that ended unseen mirrored first");
	assert.deepEqual(fs.readdirSync(exported).sort(), ["COMMENTS.json", "CONVERSATION.md", "DESIGN.json", "assets", "index.html"]);
	assert.equal(fs.readFileSync(path.join(exported, "index.html"), "utf8"), "<h1>Blue</h1>");
	assert.match(fs.readFileSync(path.join(exported, "CONVERSATION.md"), "utf8"), /## User\n\nmake it blue[\s\S]*## OpenDesign \(run run-9, succeeded\)/);
	assert.equal(JSON.parse(fs.readFileSync(path.join(exported, "DESIGN.json"), "utf8")).handle, "design-1");
	assert.deepEqual(asked.at(-1), ["Implement Calm where?", ["start", "new"]], "the starting session is offered while the hub has it");
	assert.deepEqual(hubCalls.map(call => call.slice(0, 2)), [["subtitle", "00000000-0000-0000-0000-000000000001"], ["session", "parent-session"], ["wake", "parent-session"], ["prompt", "parent-session"]]);
	assert.equal(hubCalls[0][2], "★ Home page", "the star shows on its row");
	assert.match(hubCalls.at(-1)[2], /^Design Calm \(design-1\) was selected for implementation: docs\/designs\/calm\/ [\s\S]*\/plan3/);
	assert.equal(JSON.parse(fs.readFileSync(path.join(cwd, ".pi/designs/sessions.json"), "utf8")).sessions[0].selected, true);
	// Reselect after a change: the same folder, a delta message, the one before kept for git diff; a starting session the hub lost is not offered.
	files[started[0].projectId] = { "index.html": "<h1>Teal</h1>", "logo.svg": "<svg/>" };
	runs.push({ id: "run-y", projectId: started[0].projectId, status: "succeeded", createdAt: 80 });
	const gone = { ...choose("new"), hub: async args => { hubCalls.push(args); return args[0] === "session" ? { ok: false, text: "Unknown session." } : tools.hub(args); } };
	hubCalls.length = 0;
	const again = await runDesign(cwd, { action: "select", handle: "design-1" }, undefined, od, gone);
	assert.deepEqual(asked.at(-1), ["Implement Calm where?", ["new"]]);
	assert.deepEqual([again.folder, again.changes], ["docs/designs/calm/", { added: ["logo.svg"], changed: ["index.html"], removed: ["assets/a.css"] }]);
	assert(!fs.existsSync(path.join(exported, "assets/a.css")), "the export holds exactly the new version");
	assert.equal(fs.readFileSync(path.join(cwd, ".pi/designs/selected/design-1.before/index.html"), "utf8"), "<h1>Blue</h1>");
	assert.deepEqual(hubCalls.filter(call => call[0] !== "subtitle").map(call => call.slice(0, 3)).slice(0, 2), [["session", "parent-session"], ["new", cwd, "Build Calm"]]);
	assert.match(hubCalls.at(-1).join(" "), /^prompt 0[0-]+3 Design Calm \(design-1\) was selected again: .*added: logo\.svg; changed: index\.html; removed: assets\/a\.css.*git diff --no-index \.pi\/designs\/selected\/design-1\.before docs\/designs\/calm/);
	assert.equal(again.sent, "sent to Build Calm");
	hubN--; // the next new hub session reuses id 3, as the tests below expect
	// Selected inside the starting session itself: no message to itself; dismissed: nothing sent. A folder the user made keeps its files.
	process.env.PI_HUB_SESSION = "parent-session";
	assert.equal((await runDesign(cwd, { action: "select", handle: "design-1" }, undefined, od, choose("start"))).sent, "this session: act on the message now");
	delete process.env.PI_HUB_SESSION;
	assert.match((await runDesign(cwd, { action: "select", handle: "design-1" }, undefined, od, choose(undefined))).sent, /^not sent/);
	await assert.rejects(runDesign(cwd, { action: "select", handle: "design-2" }, undefined, od, tools), /still running/);
	// Renamed after its export: DESIGN.json keeps it in its own folder.
	const store = path.join(cwd, ".pi/designs/sessions.json"), renamed = JSON.parse(fs.readFileSync(store, "utf8"));
	renamed.sessions[0].name = "Serene"; fs.writeFileSync(store, JSON.stringify(renamed));
	assert.equal((await runDesign(cwd, { action: "select", handle: "design-1" }, undefined, od, choose(undefined))).folder, "docs/designs/calm/");
	fs.mkdirSync(path.join(cwd, "docs/designs/bold-editorial"), { recursive: true });
	runs[1].status = "succeeded"; runs.filter(run => run.projectId === started[1].projectId).forEach(run => { run.status = "succeeded"; });
	files[started[1].projectId] = { "index.html": "<h1>Bold</h1>" };
	assert.equal((await runDesign(cwd, { action: "select", handle: "design-2" }, undefined, od, choose(undefined))).folder, "docs/designs/bold-editorial-2/", "another folder is never overwritten");
	files[started[0].projectId] = { "../evil.html": "x" };
	runs.push({ id: "run-z", projectId: started[0].projectId, status: "succeeded", createdAt: 90 });
	await assert.rejects(runDesign(cwd, { action: "select", handle: "design-1" }, undefined, od, tools), /path|Path/, "OD file names cannot escape the mirror");
	assert(!fs.existsSync(path.join(cwd, ".pi/designs/evil.html")));

	// Add tracks an existing project once; unknown projects are refused.
	projects.set("old-project", {});
	const [added] = await runDesign(cwd, { action: "add", project: "old-project" }, undefined, od, tools);
	assert.equal(added.handle, "design-4");
	assert.equal(added.hubSessionId, "00000000-0000-0000-0000-000000000003");
	assert.equal((await runDesign(cwd, { action: "add", project: "old-project" }, undefined, od, tools))[0].handle, "design-4");
	await assert.rejects(runDesign(cwd, { action: "add", project: "missing" }, undefined, od, tools), /missing/);
	await assert.rejects(runDesign(cwd, { action: "retry", handle: "design-4" }, undefined, od, tools), /added from OpenDesign/);
	projects.set("older-project", {});
	hubUp = false;
	const [offline] = await runDesign(cwd, { action: "add", project: "older-project" }, undefined, od, tools);
	assert.match(offline.hubError, /hub not running token=\[REDACTED\]/);
	hubUp = true;
	const [opened] = await runDesign(cwd, { action: "open", handle: offline.handle }, undefined, od, tools);
	assert.equal(opened.hubSessionId, "00000000-0000-0000-0000-000000000004");
	assert.equal(opened.hubError, undefined);
	await assert.rejects(runDesign(cwd, { action: "status", handle: "design-77" }, undefined, od, tools), /No design session design-77/);
	// Clone (D12): a new handle and project holding every file, written through the real validator; a hub session forked from the source's.
	files[started[0].projectId] = { "index.html": "<h1>Teal</h1>", "logo.svg": "<svg/>" };
	const sourceFiles = structuredClone(files[started[0].projectId]);
	hubCalls.length = 0; calls.length = 0;
	const [cloned] = await runDesign(cwd, { action: "clone", handle: "design-1", name: "Calm, darker" }, undefined, od, tools);
	assert.deepEqual([cloned.handle, cloned.name, cloned.direction, cloned.title, cloned.error, cloned.copied], ["design-6", "Calm, darker", "calm", "Home page", undefined, ["index.html", "logo.svg"]]);
	assert.notEqual(cloned.projectId, started[0].projectId);
	assert.deepEqual(calls.filter(([tool]) => tool === "write_file").map(([, args]) => [args.project, args.path, Buffer.from(args.content, "base64").toString()]), [[cloned.projectId, "index.html", "<h1>Teal</h1>"], [cloned.projectId, "logo.svg", "<svg/>"]]);
	assert.deepEqual(files[started[0].projectId], sourceFiles, "the original is untouched");
	assert.deepEqual(hubCalls[0], ["fork", "00000000-0000-0000-0000-000000000001", "Calm, darker"]);
	assert.equal(cloned.hubSessionId, "00000000-0000-0000-0000-000000000005");
	assert.match(hubCalls.at(-1).join(" "), /^prompt 0[0-]+5 You are now design session design-6 \(Calm, darker\), a copy of design-1/);
	assert.equal(fs.readFileSync(path.join(cwd, ".pi/designs/design-6/index.html"), "utf8"), "<h1>Teal</h1>", "its page shows the copy at once");
	// No name given: asked. A file with a credential stops the copy (the validator refuses it) and is recorded on the new handle.
	files[started[0].projectId] = { "app.js": "fetch(u, { headers: { Authorization: 'Bearer abcdefgh12345678' } })" };
	const [refusedClone] = await runDesign(cwd, { action: "clone", handle: "design-1" }, undefined, od, { ...tools, text: async () => "Second try" });
	assert.deepEqual([refusedClone.handle, refusedClone.name, refusedClone.copied], ["design-7", "Second try", []]);
	assert.match(refusedClone.error, /credentials/);
	await assert.rejects(runDesign(cwd, { action: "clone", handle: "design-1" }, undefined, od, tools), /name must be/, "no name and nobody to ask");
	console.log("design tool tests passed");
} finally { fs.rmSync(cwd, { recursive: true, force: true }); }
