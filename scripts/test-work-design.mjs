#!/usr/bin/env node
// design tool (D1): start makes one folder and hub session per direction with a build prompt; v1 (OpenDesign) stores load
// with their brief; select exports the folder to a named folder and hands it on (delta on reselect); clone copies and forks.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runDesign, snapshot, versions, writeRefusal } from "../extensions/design.ts";
import { agentBrowser, renderDesign, reportText } from "../extensions/design-render.ts";
import { decodePng } from "../extensions/screen-read.ts";

const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "design-test-"));
const storePath = path.join(cwd, ".pi/designs/sessions.json");
const stored = () => { const raw = fs.readFileSync(storePath, "utf8"); try { return JSON.parse(raw); } catch (cause) { throw new Error("sessions.json is not JSON: " + raw.slice(0, 200), { cause }); } };
const put = (handle, files) => { for (const [file, body] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(cwd, ".pi/designs", handle, file)), { recursive: true }); fs.writeFileSync(path.join(cwd, ".pi/designs", handle, file), body); } };
try {
	fs.writeFileSync(path.join(cwd, "page.html"), "<h1>Home</h1>");
	// Hub fakes: always pass these, the default tools create real hub sessions.
	const hubCalls = [];
	let hubUp = true, hubN = 0;
	const tools = {
		async hub(args) { hubCalls.push(args); if (!hubUp) return { ok: false, text: "hub not running token=abc" }; if (args[0] === "session") return { ok: true, text: JSON.stringify({ id: args[1], name: "Parent" }) }; return ["new", "fork"].includes(args[0]) ? { ok: true, text: `New session ${args[2]}: http://127.0.0.1:1/s/00000000-0000-0000-0000-00000000000${++hubN}/?token=x` } : { ok: true, text: "Sent." }; },
	};

	// v1 store (OpenDesign): loads with the brief from its run prompt and OD's fields dropped; the next write is version 2.
	fs.mkdirSync(path.dirname(storePath), { recursive: true });
	fs.writeFileSync(storePath, JSON.stringify({ version: 1, next: 2, sessions: [{ handle: "design-1", projectId: "p", runId: "r", status: "succeeded", direction: "old", name: "Old", title: "Old page", prompt: "Old brief\nwith detail\n\nDirection for this design (design-1): old\nBuild it", created: 1 }] }));
	const [old] = await runDesign(cwd, { action: "status" }, tools);
	assert.deepEqual([old.handle, old.name, old.kind, old.projectId, old.runId], ["design-1", "Old", "web", undefined, undefined]);

	// Start: one folder and hub session per direction, named by direction, the title below, the brief and inputs in its first message.
	process.env.PI_HUB_SESSION = "parent-session";
	const started = await runDesign(cwd, { action: "start", brief: "Home page\nThe whole landing page, real copy.", directions: ["calm", "bold"], names: ["Calm", "Bold editorial"], title: "Home page", kind: "app", inputs: ["page.html", "../escape.txt", "missing.css"] }, tools);
	delete process.env.PI_HUB_SESSION;
	assert.equal(stored().version, 2);
	assert.equal(stored().sessions[0].brief, "Old brief\nwith detail", "the v1 brief survives the rewrite");
	assert.deepEqual(started.sessions.map(item => [item.handle, item.name, item.title, item.from, item.kind, item.hubSessionId]), [["design-2", "Calm", "Home page", "parent-session", "app", "00000000-0000-0000-0000-000000000001"], ["design-3", "Bold editorial", "Home page", "parent-session", "app", "00000000-0000-0000-0000-000000000002"]]);
	assert.equal(started.skipped.length, 2, "an escaping and a missing input are reported");
	assert(fs.statSync(path.join(cwd, ".pi/designs/design-2")).isDirectory(), "the design folder exists at once");
	assert.deepEqual(hubCalls.slice(0, 2), [["new", cwd, "Calm"], ["subtitle", "00000000-0000-0000-0000-000000000001", "Home page"]]);
	assert.match(hubCalls[2].join(" "), /^prompt 0[0-]+1 Home page\nThe whole landing page[\s\S]*Direction for this design \(design-2, app\): calm[\s\S]*Read these project files first .*: page\.html\n[\s\S]*write its files into \.pi\/designs\/design-2\//);
	assert.deepEqual(stored().sessions[1].inputs, ["page.html"]);

	// Hub down: recorded (redacted), not fatal; open retries and, with files there, tells it to wait instead of rebuilding.
	hubUp = false;
	const down = await runDesign(cwd, { action: "start", brief: "b", directions: ["x"], names: ["X"], title: "t" }, tools);
	assert.match(down.sessions[0].hubError, /hub not running token=/);
	assert.doesNotMatch(down.sessions[0].hubError, /abc/, "the hub token is redacted");
	hubUp = true;
	put("design-4", { "index.html": "<h1>X</h1>" });
	hubCalls.length = 0;
	const [opened] = await runDesign(cwd, { action: "open", handle: "design-4" }, tools);
	assert.equal(opened.hubSessionId, "00000000-0000-0000-0000-000000000003");
	assert.match(hubCalls.at(-1)[2], /^You are design session design-4 .*Wait for the user's next request/);
	await assert.rejects(runDesign(cwd, { action: "status", handle: "design-77" }, tools), /No design session design-77/);

	// Inside a design session (PI_HUB_SESSION): show defaults to its own handle.
	put("design-2", { "index.html": "<h1>Blue</h1>", "assets/a.css": "h1{}" });
	process.env.PI_HUB_SESSION = "00000000-0000-0000-0000-000000000001";
	const shown = await runDesign(cwd, { action: "show" }, tools);
	delete process.env.PI_HUB_SESSION;
	assert.deepEqual([shown.handle, shown.folder, shown.files, shown.page], ["design-2", ".pi/designs/design-2", ["assets/a.css", "index.html"], "index.html"]);

	// Select (R7): exports the folder to docs/designs/<name>/, stars it, asks where to implement.
	const asked = [];
	const choose = value => ({ ...tools, ask: async (title, _purpose, items) => { asked.push([title, items.map(item => item.value)]); return value; } });
	const exported = path.join(cwd, "docs/designs/calm");
	hubCalls.length = 0;
	const selected = await runDesign(cwd, { action: "select", handle: "@design-2" }, choose("start"));
	assert.deepEqual([selected.folder, selected.files, selected.changes], ["docs/designs/calm/", ["assets/a.css", "index.html"], undefined]);
	assert.deepEqual(fs.readdirSync(exported).sort(), ["DESIGN.json", "assets", "index.html"]);
	assert.equal(JSON.parse(fs.readFileSync(path.join(exported, "DESIGN.json"), "utf8")).handle, "design-2");
	assert.deepEqual(asked.at(-1), ["Implement Calm where?", ["start", "new"]], "the starting session is offered while the hub has it");
	assert.deepEqual(hubCalls.map(call => call.slice(0, 2)), [["subtitle", "00000000-0000-0000-0000-000000000001"], ["session", "parent-session"], ["wake", "parent-session"], ["prompt", "parent-session"]]);
	assert.equal(hubCalls[0][2], "★ Home page", "the star shows on its row");
	assert.match(hubCalls.at(-1)[2], /^Design Calm \(design-2\) was selected for implementation: docs\/designs\/calm\/ [\s\S]*\/plan3/);
	// Reselect after a change: the same folder, a delta message, the one before kept for git diff; a starting session the hub lost is not offered.
	fs.rmSync(path.join(cwd, ".pi/designs/design-2/assets"), { recursive: true });
	put("design-2", { "index.html": "<h1>Teal</h1>", "logo.svg": "<svg/>" });
	const gone = { ...choose("new"), hub: async args => { hubCalls.push(args); return args[0] === "session" ? { ok: false, text: "Unknown session." } : tools.hub(args); } };
	hubCalls.length = 0;
	const again = await runDesign(cwd, { action: "select", handle: "design-2" }, gone);
	assert.deepEqual(asked.at(-1), ["Implement Calm where?", ["new"]]);
	assert.deepEqual([again.folder, again.changes], ["docs/designs/calm/", { added: ["logo.svg"], changed: ["index.html"], removed: ["assets/a.css"] }]);
	assert(!fs.existsSync(path.join(exported, "assets/a.css")), "the export holds exactly the new version");
	assert.equal(fs.readFileSync(path.join(cwd, ".pi/designs/selected/design-2.before/index.html"), "utf8"), "<h1>Blue</h1>");
	assert.match(hubCalls.at(-1).join(" "), /^prompt 0[0-]+4 Design Calm \(design-2\) was selected again: .*added: logo\.svg; changed: index\.html; removed: assets\/a\.css.*git diff --no-index \.pi\/designs\/selected\/design-2\.before docs\/designs\/calm/);
	assert.equal(again.sent, "sent to Build Calm");
	// Selected inside the starting session itself: no message to itself; dismissed: nothing sent; no files: refused.
	process.env.PI_HUB_SESSION = "parent-session";
	assert.equal((await runDesign(cwd, { action: "select", handle: "design-2" }, choose("start"))).sent, "this session: act on the message now");
	delete process.env.PI_HUB_SESSION;
	assert.match((await runDesign(cwd, { action: "select", handle: "design-2" }, choose(undefined))).sent, /^not sent/);
	await assert.rejects(runDesign(cwd, { action: "select", handle: "design-3" }, tools), /no design files yet/);
	// Renamed after its export: DESIGN.json keeps it in its own folder; another folder is never overwritten.
	const renamed = stored(); renamed.sessions[1].name = "Serene"; fs.writeFileSync(storePath, JSON.stringify(renamed));
	assert.equal((await runDesign(cwd, { action: "select", handle: "design-2" }, choose(undefined))).folder, "docs/designs/calm/");
	fs.mkdirSync(path.join(cwd, "docs/designs/bold-editorial"), { recursive: true });
	put("design-3", { "index.html": "<h1>Bold</h1>" });
	assert.equal((await runDesign(cwd, { action: "select", handle: "design-3" }, choose(undefined))).folder, "docs/designs/bold-editorial-2/");
	// The v1 session selects after the "restart" (a fresh load), keeping its brief in the store.
	put("design-1", { "index.html": "<h1>Old</h1>" });
	assert.equal((await runDesign(cwd, { action: "select", handle: "design-1" }, choose(undefined))).folder, "docs/designs/old/");
	assert.equal(stored().sessions[0].brief, "Old brief\nwith detail");

	// Clone (D12): a new handle with the folder copied and brief, kind and inputs kept; a hub session forked from the source's.
	hubCalls.length = 0;
	const [cloned] = await runDesign(cwd, { action: "clone", handle: "design-2", name: "Calm, darker" }, tools);
	assert.deepEqual([cloned.handle, cloned.name, cloned.direction, cloned.title, cloned.kind, cloned.brief, cloned.selected, cloned.copied], ["design-5", "Calm, darker", "calm", "Home page", "app", "Home page\nThe whole landing page, real copy.", undefined, ["index.html", "logo.svg"]]);
	assert.deepEqual(hubCalls[0], ["fork", "00000000-0000-0000-0000-000000000001", "Calm, darker"]);
	assert.match(hubCalls.at(-1).join(" "), /^prompt 0[0-]+5 You are now design session design-5 \(Calm, darker\), a copy of design-2.*write only into \.pi\/designs\/design-5\//);
	assert.equal(fs.readFileSync(path.join(cwd, ".pi/designs/design-5/index.html"), "utf8"), "<h1>Teal</h1>", "its page shows the copy at once");
	assert.equal((await runDesign(cwd, { action: "select", handle: "design-5" }, choose(undefined))).folder, "docs/designs/calm-darker/", "a clone selects into its own folder");
	// No name given: asked; nobody to ask: refused.
	assert.equal((await runDesign(cwd, { action: "clone", handle: "design-2" }, { ...tools, text: async () => "Second try" }))[0].name, "Second try");
	await assert.rejects(runDesign(cwd, { action: "clone", handle: "design-2" }, tools), /name must be/);
	// D9 write guard: only its own folder and the shared references.
	assert.equal(writeRefusal(cwd, "design-2", ".pi/designs/design-2/index.html"), undefined);
	assert.equal(writeRefusal(cwd, "design-2", path.join(cwd, ".pi/designs/references/site/STYLE.md")), undefined);
	assert.match(writeRefusal(cwd, "design-2", "src/app.ts"), /writes only inside \.pi\/designs\/design-2\//);
	assert.match(writeRefusal(cwd, "design-2", ".pi/designs/design-22/x.html"), /outside/, "a sibling folder with the same prefix is outside");
	assert.match(writeRefusal(cwd, "design-2", ".pi/designs/design-2/../design-3/x.html"), /outside/);

	// D5 versions (one shared snapshot): an unchanged turn adds none; edit then select exports the edited bytes as a version;
	// edit then restore keeps the edit first; restore of vN makes a new version equal to vN; the newest 30 stay.
	const h = "design-3", at = n => path.join(cwd, ".pi/designs/history", h, String(n), "index.html");
	const before = versions(cwd, h).at(-1);
	assert.equal(await snapshot(cwd, h), before, "an unchanged folder adds no version");
	put(h, { "index.html": "<h1>Edited</h1>" });
	const picked = await runDesign(cwd, { action: "select", handle: h }, choose(undefined));
	assert.equal(picked.version, before + 1);
	assert.equal(fs.readFileSync(path.join(cwd, "docs/designs/bold-editorial-2/index.html"), "utf8"), "<h1>Edited</h1>");
	assert.equal(JSON.parse(fs.readFileSync(path.join(cwd, "docs/designs/bold-editorial-2/DESIGN.json"), "utf8")).version, before + 1);
	assert.equal(await snapshot(cwd, h), before + 1, "no duplicate at agent_end after select");
	put(h, { "index.html": "<h1>Pending</h1>" });
	const restored = await runDesign(cwd, { action: "restore", handle: h, version: before }, tools);
	assert.deepEqual([restored.restored, restored.version], [before, before + 3]);
	assert.equal(fs.readFileSync(at(before + 2), "utf8"), "<h1>Pending</h1>", "the pending edit was kept as its own version");
	assert.equal(fs.readFileSync(at(before + 3), "utf8"), fs.readFileSync(at(before), "utf8"));
	assert.equal(fs.readFileSync(path.join(cwd, ".pi/designs", h, "index.html"), "utf8"), fs.readFileSync(at(before), "utf8"));
	await assert.rejects(runDesign(cwd, { action: "restore", handle: h, version: 999 }, tools), /no version 999/);
	for (let n = 0; n < 32; n++) { put(h, { "index.html": `<p>${n}</p>` }); await snapshot(cwd, h); }
	assert.equal(versions(cwd, h).length, 30, "the newest 30 are kept");
	assert.equal(fs.readFileSync(at(versions(cwd, h).at(-1)), "utf8"), "<p>31</p>");
	// S06 renderer: overflow, page and console errors and a missing image are reported; two overlapping captures keep their
	// own sizes (isolated sessions); a live style edit shows in the picture without touching the file.
	if (!agentBrowser()) console.log("skipped the render checks: agent-browser is not installed");
	else {
		const fixture = path.join(cwd, "render");
		fs.mkdirSync(fixture);
		const page = `<!doctype html><style>body{margin:0;background:#fff}.wide{width:600px;height:40px}</style><h1 data-id="title">Hi</h1><div class="wide" data-id="band"></div><img src="gone.png"><script>console.error("boom"); missingFn();</script>`;
		fs.writeFileSync(path.join(fixture, "index.html"), page);
		const [phone, tablet] = await Promise.all([renderDesign({ folder: fixture, width: 360, height: 800, maxEdge: 4000 }), renderDesign({ folder: fixture, width: 820, height: 1180, maxEdge: 4000, styleEdits: [{ selector: "body", styles: { background: "rgb(255, 0, 0)" } }] })]);
		assert.deepEqual([phone.width, phone.height, tablet.width, tablet.height], [360, 800, 820, 1180], "each capture kept its own viewport");
		assert.equal(phone.report.overflow, true);
		assert.match(phone.report.wide.join(), /@band 600px/);
		assert.equal(tablet.report.overflow, false);
		assert.match(phone.report.errors.join(), /missingFn/);
		assert.match(phone.report.console.join(), /error: boom/);
		assert.match(phone.report.failed.join(), /gone\.png/);
		const pixel = (shot, x, y) => { const { width, rgba } = decodePng(shot.png); return [...rgba.subarray((y * width + x) * 4, (y * width + x) * 4 + 3)]; };
		assert.deepEqual(pixel(tablet, 800, 1100), [255, 0, 0], "the live edit shows");
		assert.deepEqual(pixel(phone, 300, 700), [255, 255, 255]);
		assert.equal(fs.readFileSync(path.join(fixture, "index.html"), "utf8"), page, "edits never reach the file");
		assert.match(reportText(tablet.report), /failed: /);
		const element = await renderDesign({ folder: fixture, width: 360, height: 800, element: "@title" });
		assert(element.height < 200, "an element shot is the element, not the page");
		assert.match((await renderDesign({ folder: fixture, width: 360, height: 800, element: "@nope" })).report.missing, /no element @nope/);
	}
	console.log("design tool tests passed");
} finally { fs.rmSync(cwd, { recursive: true, force: true }); }
