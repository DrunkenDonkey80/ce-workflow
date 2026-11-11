#!/usr/bin/env node
// design tool (D1): start makes one folder and hub session per direction with a build prompt; v1 (OpenDesign) stores load
// with their brief; select exports the folder to a named folder and hands it on (delta on reselect); clone copies and forks.
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import designExtension, { runDesign, snapshot, versions, writeRefusal } from "../extensions/design.ts";
import { agentBrowser, renderDesign, reportText, selectRenderTarget } from "../extensions/design-render.ts";
import { decodePng } from "../extensions/screen-read.ts";
import { designStateJson } from "../extensions/design-state.ts";
import { ensureDesignRuntime, astryxRuntime } from "../extensions/design-runtime.ts";

const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "design-test-"));
const storePath = path.join(cwd, ".pi/designs/sessions.json");
const stored = () => { const raw = fs.readFileSync(storePath, "utf8"); try { return JSON.parse(raw); } catch (cause) { throw new Error("sessions.json is not JSON: " + raw.slice(0, 200), { cause }); } };
const put = (handle, files) => { for (const [file, body] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(cwd, ".pi/designs", handle, file)), { recursive: true }); fs.writeFileSync(path.join(cwd, ".pi/designs", handle, file), body); } };
try {
	// Optional host runtime: cold consent, cancellation, atomic failure, warm offline integrity and serialization.
	const runtimeLock = JSON.parse(fs.readFileSync(new URL("../extensions/astryx-runtime/runtime-lock.json", import.meta.url), "utf8"));
	const runtimeNotices = JSON.parse(fs.readFileSync(new URL("../extensions/astryx-runtime/notices.json", import.meta.url), "utf8"));
	assert.equal(Object.keys(runtimeNotices.packages).length, Object.keys(runtimeLock.packages).length - 1);
	assert(Object.values(runtimeLock.packages).slice(1).every(p => p.resolved.startsWith("https://registry.npmjs.org/") && /^sha512-/.test(p.integrity) && !p.link));
	let runtimeRuns = 0, runtimeConsents = 0, fakePayloadBytes = 0;
	const runtimeOptions = { agentDir: path.join(cwd, "runtime-agent"), confirm: async () => { runtimeConsents++; return true; } };
	const fakeRuntimeRun = async (_exe, args, options) => {
		runtimeRuns++;
		if (!args.includes("ci")) { assert.deepEqual(args, ["--version"]);return { stdout: "0.28.2\n" }; }
		for (const flag of ["--ignore-scripts=true", "--bin-links=false", "--audit=false", "--fund=false", "--registry=https://registry.npmjs.org/", "--fetch-retries=0"]) assert(args.includes(flag), flag);
		assert(!Object.keys(options.env).some(key => /^(npm_config_|node_options$|node_path$)/i.test(key)), "ambient npm settings/code hooks are not inherited");
		fakePayloadBytes = 0;
		for (const [file, pkg] of Object.entries(runtimeLock.packages)) {
			if (!file || (pkg.os && !pkg.os.includes(process.platform)) || (pkg.cpu && !pkg.cpu.includes(process.arch))) continue;
			const dir = path.join(options.cwd, file);fs.mkdirSync(dir, { recursive: true });
			fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: file.split("node_modules/").at(-1), version: pkg.version }));
			const hex = Buffer.from(pkg.integrity.slice(7), "base64").toString("hex"), archive = path.join(options.cwd, ".npm-cache/_cacache/content-v2/sha512", hex.slice(0, 2), hex.slice(2, 4), hex.slice(4));
			if (!fs.existsSync(archive)) { fs.mkdirSync(path.dirname(archive), { recursive: true });fs.writeFileSync(archive, "payload");fakePayloadBytes += 7; }
			if (file === `node_modules/@esbuild/${process.platform}-${process.arch}`) {
				const binary = path.join(dir, process.platform === "win32" ? "esbuild.exe" : "bin/esbuild");fs.mkdirSync(path.dirname(binary), { recursive: true });fs.writeFileSync(binary, "test-native-builder");
			}
		}
		return { stdout: "" };
	};
	await assert.rejects(ensureDesignRuntime({ ...runtimeOptions, confirm: async () => false }, fakeRuntimeRun), /approval|declined|cancel/i);
	assert.equal(runtimeRuns, 0, "refusal executes nothing");
	const cancelledInstall = new AbortController();
	await assert.rejects(ensureDesignRuntime({ ...runtimeOptions, signal: cancelledInstall.signal, confirm: async () => { cancelledInstall.abort(); return true; } }, fakeRuntimeRun), /abort|cancel/i);
	assert.equal(runtimeRuns, 0, "cancellation before installation executes nothing");
	await assert.rejects(ensureDesignRuntime(runtimeOptions, async () => { throw new Error("offline"); }), /unavailable|offline|install/i);
	const runtimeRoot = path.join(runtimeOptions.agentDir, "cache/design-runtimes/astryx", astryxRuntime.lockDigest);
	assert(!fs.existsSync(runtimeRoot) || fs.readdirSync(runtimeRoot).length === 0, "failed staging is never activated or left behind");
	const duringInstall = new AbortController();
	await assert.rejects(ensureDesignRuntime({ ...runtimeOptions, signal: duringInstall.signal }, async (...args) => { const result = await fakeRuntimeRun(...args);duringInstall.abort();return result; }), /abort|cancel/i);
	assert.equal(fs.readdirSync(runtimeRoot).length, 0, "mid-install cancellation removes all staging without activating");
	await assert.rejects(ensureDesignRuntime(runtimeOptions, async (...args) => args[1].includes("ci") ? fakeRuntimeRun(...args) : { stdout: "wrong-version" }), /native builder verification/);
	assert.equal(fs.readdirSync(runtimeRoot).length, 0, "an unusable native builder cannot activate");
	const beforeColdRuns = runtimeRuns;
	const coldRuntime = await ensureDesignRuntime(runtimeOptions, fakeRuntimeRun);
	assert.equal(coldRuntime.cold, true);assert.equal(coldRuntime.downloadBytes, fakePayloadBytes);assert(coldRuntime.footprintBytes > 0);
	assert.equal(runtimeRuns - beforeColdRuns, 2, "only fixed npm ci and native builder verification execute");
	const warmRuntime = await ensureDesignRuntime({ ...runtimeOptions, confirm: async () => { assert.fail("warm use must not prompt"); } }, async () => { assert.fail("warm offline use must not spawn or fetch"); });
	assert.equal(warmRuntime.cold, false);assert.equal(warmRuntime.directory, coldRuntime.directory);
	const cachedReact = path.join(coldRuntime.directory, "node_modules/react/package.json"), originalReact = fs.readFileSync(cachedReact);
	fs.writeFileSync(cachedReact, JSON.stringify({ name: "react", version: "19.3.1", tampered: true }));
	await assert.rejects(ensureDesignRuntime({ ...runtimeOptions, confirm: async () => false }, fakeRuntimeRun), /approval|declined|cancel|corrupt/i);
	assert(fs.readFileSync(cachedReact, "utf8").includes("tampered"), "refusal preserves the existing cache");
	await assert.rejects(ensureDesignRuntime(runtimeOptions, async () => { throw new Error("offline"); }), /unavailable|offline|install/i);
	assert(fs.readFileSync(cachedReact, "utf8").includes("tampered"), "a failed reinstall cannot replace the existing cache");
	const replacedRuntime = await ensureDesignRuntime(runtimeOptions, fakeRuntimeRun);assert.equal(replacedRuntime.cold, true);assert(fs.readFileSync(cachedReact).equals(originalReact));
	const concurrentOptions = { ...runtimeOptions, agentDir: path.join(cwd, "concurrent-runtime") }, beforeRuns = runtimeRuns, beforeConsents = runtimeConsents;
	const concurrentRuntime = await Promise.all([ensureDesignRuntime(concurrentOptions, fakeRuntimeRun), ensureDesignRuntime(concurrentOptions, fakeRuntimeRun)]);
	assert.deepEqual(concurrentRuntime.map(r => r.cold), [true, false]);assert.equal(runtimeRuns - beforeRuns, 2);assert.equal(runtimeConsents - beforeConsents, 1);
	const linkedAgent = path.join(cwd, "linked-runtime"), outsideCache = path.join(cwd, "outside-runtime");
	fs.mkdirSync(path.join(linkedAgent, "cache"), { recursive: true });fs.mkdirSync(outsideCache);
	fs.symlinkSync(outsideCache, path.join(linkedAgent, "cache/design-runtimes"), process.platform === "win32" ? "junction" : "dir");
	await assert.rejects(ensureDesignRuntime({ ...runtimeOptions, agentDir: linkedAgent }, fakeRuntimeRun), /symlink/);
	assert.equal(fs.readdirSync(outsideCache).length, 0, "cache path cannot traverse a symlink");
	const guideText = fs.readFileSync(new URL("../extensions/design-guide.md", import.meta.url), "utf8");
	assert(/Touch targets[^.]*coarse-pointer tablets/.test(guideText), "the starter contract covers coarse-pointer tablets, not phone widths alone");
	assert.equal(designStateJson({ z: 1, a: [null, true, "ok"] }), '{"a":[null,true,"ok"],"z":1}', "canonical state comparison ignores object key order");
	const cycle = {}; cycle.self = cycle;
	let getterReads = 0;
	const getter = Object.defineProperty({}, "value", { enumerable: true, get() { getterReads++; return "secret"; } });
	for (const invalid of [undefined, Infinity, NaN, 1n, () => {}, new Date(), cycle, getter, { constructor: {} }, Object.fromEntries([["__proto__", {}]]), Object.create({ custom: true }), [undefined], Array(2), Array(257).fill(0), "é".repeat(8192), Array.from({ length: 9 }).reduce(value => [value], null)]) assert.throws(() => designStateJson(invalid), /state/i);
	assert.equal(getterReads, 0, "validation never invokes a state getter");
	assert.equal(JSON.parse(designStateJson(Array(256).fill(0))).length, 256);
	const owned = { type: "page", url: "about:blank", attached: true, targetId: "owned" }, hiddenTab = { type: "page", url: "chrome://newtab/", attached: false, targetId: "hidden" };
	for (const targets of [[hiddenTab, owned], [owned, hiddenTab]]) assert.equal(selectRenderTarget(targets).targetId, "owned", "native capture target is independent of CDP target order");
	assert.throws(() => selectRenderTarget([hiddenTab]), /ambiguous|missing/i);
	assert.throws(() => selectRenderTarget([owned, { ...owned, targetId: "other" }]), /ambiguous/i);
	let definition;
	designExtension({ registerTool: tool => { definition = tool; } });
	assert.deepEqual(definition.parameters.properties.input?.enum, ["mouse", "touch"], "look exposes input independently of size");
	assert.equal(definition.parameters.properties.reducedMotion?.type, "boolean");
	assert.equal(definition.parameters.properties.state?.type, "string", "look exposes only declared named states");
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

	// S04: the design guide (frontend-design body plus the craft rules) reaches a design session's prompt, not other sessions'.
	const prompt = async hubId => {
		const hooks = {};
		designExtension({ on: (name, fn) => { hooks[name] = fn; } });
		if (hubId) process.env.PI_HUB_SESSION = hubId;
		try { hooks.session_start({}, { cwd }); } finally { delete process.env.PI_HUB_SESSION; }
		return hooks.before_agent_start({ systemPrompt: "BASE" })?.systemPrompt;
	};
	const own = await prompt("00000000-0000-0000-0000-000000000001");
	assert.match(own, /^BASE\n\nYou are design session design-2 [\s\S]*# Frontend Design[\s\S]*# Design session guide[\s\S]*data-id="kebab-case"[\s\S]*design:tweaks/);
	assert.doesNotMatch(own, /^name: frontend-design/m, "no skill frontmatter");
	assert.equal(await prompt(), undefined);
	assert.equal(await prompt("some-other-session"), undefined);

	// Select (R7): exports the folder to docs/designs/<name>/, stars it, asks where to implement.
	const asked = [];
	const choose = value => ({ ...tools, ask: async (title, _purpose, items) => { asked.push([title, items.map(item => item.value)]); return value; } });
	const exported = path.join(cwd, "docs/designs/calm");
	hubCalls.length = 0;
	const selected = await runDesign(cwd, { action: "select", handle: "@design-2" }, choose("start"));
	assert.deepEqual([selected.folder, selected.files, selected.changes], ["docs/designs/calm/", ["assets/a.css", "index.html"], undefined]);
	assert.deepEqual(fs.readdirSync(exported).sort(), ["BRIEF.md", "DESIGN.json", "HANDOFF.md", "assets", "index.html"]);
	const owner = JSON.parse(fs.readFileSync(path.join(exported, "DESIGN.json"), "utf8"));
	assert.deepEqual([owner.handle, owner.version], ["design-2", selected.version], "DESIGN.json records the exported version");
	// S16 (D15, D18): the handoff contract and the brief, from code.
	const handoffText = fs.readFileSync(path.join(exported, "HANDOFF.md"), "utf8"), briefText = fs.readFileSync(path.join(exported, "BRIEF.md"), "utf8");
	assert.match(handoffText, /^# Calm implementation handoff\n\nVersion \d+ of design-2 \(app\)/);
	assert.match(handoffText, /## Screens\n\n- `index\.html`\n\n/);
	assert.match(handoffText, /- Phone small: 360×800\n[\s\S]*- Desktop: 1440×900\n/);
	assert.doesNotMatch(handoffText, /Slide/, "no deck preset for an app");
	assert.match(handoffText, /`data-design-chrome` \(the Tweaks panel and other design helpers\) are not product UI/);
	assert.match(handoffText, /No `DESIGN\.md`: extract the tokens/);
	assert.match(briefText, /- Direction: calm\n- Kind: app\n- Design system: none\n- References: none\n- Project files read: page\.html\n\n## Brief\n\nHome page\nThe whole landing page, real copy\./);
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
		fs.writeFileSync(path.join(fixture, "form.html"), '<form id="local"><input required value="valid"><button>Save</button></form><script>local.addEventListener("submit",event=>{event.preventDefault();const saved=document.createElement("p");saved.dataset.id="saved";saved.textContent="Saved locally";document.body.append(saved);});local.requestSubmit();</script>');
		const localForm = await renderDesign({ folder: fixture, screen: "form.html", width: 360, height: 800, element: "@saved" });
		assert.equal(localForm.report.missing, undefined, "renderer allows prevented local form handlers");
		assert.ok(localForm.png.length, `saved content was rendered: ${reportText(localForm.report)}`);
		fs.copyFileSync(new URL("../hub/scripts/fixtures/design-interactions.html", import.meta.url), path.join(fixture, "interaction.html"));
		const targetHeights = [];
		for (const input of ["mouse", "touch"]) {
			const target = await renderDesign({ folder: fixture, screen: "interaction.html", width: 820, height: 1180, input, element: "@open", maxEdge: 4000 });
			assert(!target.report.failed.length && !target.report.errors.length, "the standalone fixture needs no external assets");
			targetHeights.push(target.height);
		}
		assert.deepEqual(targetHeights, [28, 44], "same-size coarse tablet enlarges targets; fine-pointer desktop keeps its density");
		// P3-06: replay an explicit draft, acknowledge its committed state, then capture the open modal.
		fs.writeFileSync(path.join(fixture, "state.html"), `<style>dialog{width:260px;height:180px;border:0;padding:0}#scroller{height:30px;overflow:auto}</style><dialog id="panel" aria-label="Draft editor"><input id="draft" value="Saved"><div id="scroller"><div style="height:500px">Details</div></div></dialog><script>window.designPreview={states:{edit:{open:true,draft:"Unsaved Delta",scroll:120}},capture:()=>({open:panel.open,draft:draft.value,scroll:scroller.scrollTop}),restore:async value=>{draft.value=value.draft;if(value.open&&!panel.open)panel.showModal();if(!value.open&&panel.open)panel.close();scroller.scrollTop=value.scroll;panel.style.background=value.draft==="Unsaved Delta"?"red":"blue";await new Promise(requestAnimationFrame);}};</script>`);
		const draftState = { open: true, draft: "Unsaved Delta", scroll: 120 };
		const replayed = await renderDesign({ folder: fixture, screen: "state.html", width: 360, height: 800, pageState: draftState, maxEdge: 4000 });
		assert.equal(replayed.report.state?.restored, true, `page-state replay must be acknowledged: ${reportText(replayed.report)}`);
		const replayPixels = decodePng(replayed.png), sample = (470 * replayPixels.width + 180) * 4;
		assert.deepEqual([...replayPixels.rgba.subarray(sample, sample + 3)], [255, 0, 0], "the open modal contains the replayed draft, not the fresh default");
		const named = await renderDesign({ folder: fixture, screen: "state.html", width: 360, height: 800, state: "edit", element: '[aria-label="Draft editor"]' });
		assert.equal(named.report.state?.restored, true, "named states use the same acknowledged replay path");
		assert(named.png.length && named.height < 300, "custom-selector capture finds the restored modal");
		const missingState = await renderDesign({ folder: fixture, screen: "state.html", width: 360, height: 800, state: "missing" });
		assert.equal(missingState.png.length, 0, "an undeclared named state is not a fresh-page picture");
		fs.writeFileSync(path.join(fixture, "no-state.html"), "<h1>Legacy preview</h1>");
		const unsupported = await renderDesign({ folder: fixture, screen: "no-state.html", width: 360, height: 800, pageState: null });
		assert.equal(unsupported.png.length, 0, "explicit static null still needs page-owned capture/restore support");
		assert.match(reportText(unsupported.report), /state.*support|designPreview/i);
		fs.writeFileSync(path.join(fixture, "wrong-state.html"), '<p>Wrong acknowledgement</p><script>window.designPreview={capture:()=>null,restore:()=>{}};</script>');
		const mismatch = await renderDesign({ folder: fixture, screen: "wrong-state.html", width: 360, height: 800, pageState: draftState });
		assert.equal(mismatch.png.length, 0, "a mismatched acknowledgement cannot produce a PNG");
		assert.match(reportText(mismatch.report), /state.*match|acknowledg/i);
		fs.writeFileSync(path.join(fixture, "replace-api.html"), '<script>window.designPreview={capture:()=>null,restore:value=>{window.designPreview={capture:()=>value,restore:()=>{}}}};</script>');
		const replaced = await renderDesign({ folder: fixture, screen: "replace-api.html", width: 360, height: 800, pageState: draftState });
		assert.equal(replaced.report.state?.restored, true, "a component may replace the capture closure when its restored state commits");
		for (const [name, restore] of [["throw", 'throw new Error("PRIVATE_DRAFT")'], ["hang", "return new Promise(()=>{})"]]) {
			fs.writeFileSync(path.join(fixture, name + "-restore.html"), `<script>window.designPreview={capture:()=>null,restore:()=>{${restore}}};</script>`);
			const failed = await renderDesign({ folder: fixture, screen: name + "-restore.html", width: 360, height: 800, pageState: null });
			assert.equal(failed.png.length, 0, "failed or hung restore cannot produce a success PNG");
			assert.match(reportText(failed.report), /replay failed|timed out|deadline/i);
			assert(!reportText(failed.report).includes("PRIVATE_DRAFT"), "restore exceptions never disclose captured values");
		}
		await assert.rejects(renderDesign({ folder: fixture, screen: "state.html", width: 360, height: 800, pageState: { draft: "x".repeat(16384) } }), /state|16 KiB/i);
		await assert.rejects(renderDesign({ folder: fixture, screen: "state.html", width: 360, height: 800, pageState: { constructor: {} } }), /state|key/i);
		const page = `<!doctype html><style>body{margin:0;background:#fff}.wide{width:600px;height:40px}</style><h1 data-id="title">Hi</h1><div class="wide" data-id="band"></div><img src="gone.png"><script>console.error("boom"); missingFn();</script>`;
		fs.writeFileSync(path.join(fixture, "index.html"), page);
		const [phone, tablet] = await Promise.all([renderDesign({ folder: fixture, width: 360, height: 800, maxEdge: 4000 }), renderDesign({ folder: fixture, width: 820, height: 1180, maxEdge: 4000, styleEdits: [{ selector: "body", styles: { background: "rgb(255, 0, 0)" } }] })]);
		assert.deepEqual([phone.width, phone.height, tablet.width, tablet.height], [360, 800, 820, 1180], "each capture kept its own viewport");
		assert.equal(phone.report.overflow, true);
		assert.equal(phone.report.input.requested, "mouse");
		assert.equal(phone.report.input.touchPoints, 0, "Phone dimensions alone do not enable touch");
		assert.match(phone.report.wide.join(), /@band 600px/);
		assert.equal(tablet.report.overflow, false);
		assert.match(phone.report.errors.join(), /missingFn/);
		assert.match(phone.report.console.join(), /error: boom/);
		assert.match(phone.report.failed.join(), /gone\.png/);
		const pixel = (shot, x, y) => { const { width, rgba } = decodePng(shot.png); return [...rgba.subarray((y * width + x) * 4, (y * width + x) * 4 + 3)]; };
		// P3-05: wait for authored readiness and finite paint animations; ignore an explicitly infinite decoration.
		fs.writeFileSync(path.join(fixture, "ready.html"), `<!doctype html><style>body{margin:0;background:white}.decoration{animation:pulse 1s infinite}@keyframes pulse{to{opacity:.5}}</style><div class="decoration">Ready</div><script>window.designReady=new Promise(resolve=>setTimeout(()=>{document.body.style.background='rgb(255, 0, 0)';document.body.animate([{opacity:0},{opacity:1}],{duration:250});resolve();},800));</script>`);
		const inputs = await Promise.all([renderDesign({ folder: fixture, screen: "ready.html", width: 820, height: 1180, input: "mouse", reducedMotion: false, maxEdge: 4000 }), renderDesign({ folder: fixture, screen: "ready.html", width: 820, height: 1180, input: "touch", reducedMotion: true, maxEdge: 4000 })]);
		for (const [i, shot] of inputs.entries()) {
			assert.equal(shot.report.readiness?.settled, true, `authored readiness and finite animation settled: ${reportText(shot.report)}`);
			assert.deepEqual([shot.width, shot.height], [820, 1180], `input ${i} keeps the capture viewport`);
			assert.equal(shot.report.readiness.ignoredAnimations, 1, "infinite decoration cannot block a capture");
			assert.equal(shot.report.observedViewport, "820×1180");
			assert.deepEqual(shot.report.input, { requested: i ? "touch" : "mouse", requestedReducedMotion: !!i, touchPoints: i, coarse: !!i, reducedMotion: !!i }, "same dimensions, independently configured and observed input");
			assert.deepEqual(pixel(shot, 800, 1100), [255, 0, 0], "capture is past the opening paint transition");
		}
		fs.writeFileSync(path.join(fixture, "unready.html"), `<p>Not ready</p><script>window.designReady=new Promise(()=>{});</script>`);
		const unready = await renderDesign({ folder: fixture, screen: "unready.html", width: 360, height: 800 });
		assert.equal(unready.png.length, 0, "a timed-out page must not return a falsely settled picture");
		assert.equal(unready.report.readiness.settled, false);
		assert.match(reportText(unready.report), /ready|settle|timed out/i);
		fs.writeFileSync(path.join(fixture, "rejected.html"), `<p>Rejected</p><script>window.designReady=Promise.reject(new Error('Authored readiness failed'));window.designReady.catch(()=>{});</script>`);
		const rejected = await renderDesign({ folder: fixture, screen: "rejected.html", width: 360, height: 800 });
		assert.equal(rejected.png.length, 0);
		assert.match(reportText(rejected.report), /Authored readiness failed/);
		fs.writeFileSync(path.join(fixture, "hung.html"), `<p>Hung</p><script>for(;;){}</script>`);
		const hung = await renderDesign({ folder: fixture, screen: "hung.html", width: 360, height: 800 });
		assert.equal(hung.png.length, 0, "hung page JavaScript cannot produce a settled PNG");
		assert.match(hung.report.readiness.error, /timed out/);
		assert(hung.report.readiness.elapsedMs < 7000, "host watchdog fires even when page JavaScript never yields");
		await assert.rejects(renderDesign({ folder: fixture, width: 360, height: 800, input: "invalid" }), /input/i);
		await assert.rejects(renderDesign({ folder: fixture, width: 360, height: 800, reducedMotion: "true" }), /reducedMotion/i);
		assert.deepEqual(pixel(tablet, 800, 1100), [255, 0, 0], "the live edit shows");
		assert.deepEqual(pixel(phone, 300, 700), [255, 255, 255]);
		assert.equal(fs.readFileSync(path.join(fixture, "index.html"), "utf8"), page, "edits never reach the file");
		assert.match(reportText(tablet.report), /failed: /);
		const element = await renderDesign({ folder: fixture, width: 360, height: 800, element: "@title" });
		assert(element.height < 200, "an element shot is the element, not the page");
		assert.match((await renderDesign({ folder: fixture, width: 360, height: 800, element: "@nope" })).report.missing, /no element @nope/);

		// S07 look: presets (rotated too) give small pictures and the report per preset.
		put("design-3", { "index.html": page, "state.html": fs.readFileSync(path.join(fixture, "state.html"), "utf8") });
		const namedLook = await runDesign(cwd, { action: "look", handle: "design-3", screen: "state.html", presets: ["Phone"], state: "edit", element: '[aria-label="Draft editor"]' }, tools);
		assert.equal(namedLook.shots.length, 1);
		assert.match(namedLook.shots[0].report, /state restored and acknowledged/i, "look forwards the declared name and reports acknowledgement");
		assert(!namedLook.shots[0].report.includes("Unsaved"), "state values stay out of reports");
		const looked = await runDesign(cwd, { action: "look", handle: "design-3", presets: ["Phone small landscape", "Tablet"], input: "touch", reducedMotion: true }, tools);
		assert.deepEqual(looked.shots.map(shot => shot.viewport), ["800×360", "820×1180"]);
		assert.match(looked.shots[1].report, /failed: 404 gone\.png/);
		assert(looked.shots.every(shot => /touch requested, touch points 1, coarse true/.test(shot.report) && /reduced motion true requested, true observed/.test(shot.report)), "look forwards input and motion to every preset");
		assert(looked.shots.every(shot => decodePng(Buffer.from(shot.png, "base64")).width <= 768), "small pictures");
		await assert.rejects(runDesign(cwd, { action: "look", handle: "design-3", presets: ["Watch"] }, tools), /Unknown preset Watch/);
		// S07 reference: a local site's screenshots and measured style, noted on the design; an empty page is "blocked".
		const site = http.createServer((request, response) => {
			if (request.url === "/delayed.svg") return setTimeout(() => { response.writeHead(200, { "content-type": "image/svg+xml" }); response.end(`<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="red"/></svg>`); }, 2000);
			const reply = () => { response.writeHead(200, { "content-type": "text/html" }); response.end(request.url === "/empty" ? "<title>Just a moment...</title>" : request.url === "/staged" ? `<title>Staged</title><p>${"Real staged content. ".repeat(20)}</p><img id="delayed" src="/delayed.svg"><script>window.designReady=new Promise(resolve=>delayed.addEventListener("load",()=>setTimeout(resolve,2000)));</script>` : request.url === "/images" ? `<title>Delayed image</title><p>${"Real image content. ".repeat(20)}</p><img loading="lazy" src="/delayed.svg" style="position:fixed;left:0;top:0;width:100px;height:100px">` : `<title>Acme</title><style>body{font-family:Georgia;color:rgb(20, 30, 40)}button{border-radius:12px;padding:10px 18px}</style><h1>Acme tools</h1><p>${"Real words about the product. ".repeat(5)}</p><button>Buy</button>`); };
			if (request.url === "/staged") setTimeout(reply, 2000); else reply();
		});
		await new Promise(resolve => site.listen(0, "127.0.0.1", resolve));
		try {
			const base = `http://127.0.0.1:${site.address().port}`;
			const captured = await runDesign(cwd, { action: "reference", handle: "design-3", url: `${base}/` }, tools);
			assert.deepEqual([captured.folder, captured.files], [".pi/designs/references/127.0.0.1", ["desktop.png", "phone.png", "STYLE.md"]]);
			const style = fs.readFileSync(path.join(cwd, captured.folder, "STYLE.md"), "utf8");
			assert.match(style, /Georgia/);
			assert.match(style, /rgb\(20, 30, 40\)/);
			assert.match(style, /button: .*border-radius 12px/);
			assert.deepEqual(stored().sessions.find(item => item.handle === "design-3").references, ["127.0.0.1"]);
			assert.match((await runDesign(cwd, { action: "reference", url: `${base}/empty` }, tools)).blocked, /browser_fetch with images/);
			const imaged = await runDesign(cwd, { action: "reference", url: `${base}/images` }, tools);
			assert(imaged.files, "a delayed lazy image settles successfully");
			for (const file of ["desktop.png", "phone.png"]) assert.deepEqual(pixel({ png: fs.readFileSync(path.join(cwd, imaged.folder, file)) }, 20, 20), [255, 0, 0], `${file} contains the decoded delayed image`);
			const started = Date.now();
			const staged = await runDesign(cwd, { action: "reference", url: `${base}/staged` }, tools);
			assert.match(staged.blocked, /timed out/i, "navigation + image + authored readiness share one five-second budget, not three separate budgets");
			assert(Date.now() - started < 15000, "the shared watchdog and cleanup are bounded");
		} finally { site.close(); }
	}

	// S15 design systems: the project's own files first, OD's index cached with its commit, a package fetched once (offline after).
	const sha = "a".repeat(40), urls = [];
	let online = true;
	const net = { ...tools, async fetch(url) {
		urls.push(url);
		const reply = (status, body) => ({ ok: status === 200, status, text: async () => body });
		if (!online) throw new Error("offline");
		if (url.endsWith("/commits/main")) return reply(200, sha);
		if (url.includes(`/contents/design-systems?ref=${sha}`)) return reply(200, JSON.stringify([{ name: "airbnb", type: "dir" }, { name: "_schema", type: "dir" }, { name: "README.md", type: "file" }, { name: "stripe", type: "dir" }]));
		const file = url.match(new RegExp(`raw\\.githubusercontent\\.com/nexu-io/open-design/${sha}/design-systems/airbnb/(.+)$`))?.[1];
		if (file === "DESIGN.md") return reply(200, "# Airbnb");
		if (file === "tokens.css") return reply(200, ":root{--accent:#ff385c}");
		if (file === "manifest.json") return reply(200, JSON.stringify({ name: "Airbnb", category: "Travel", source: { type: "bundled" } }));
		return reply(404, "");
	} };
	fs.writeFileSync(path.join(cwd, "DESIGN.md"), "# Ours");
	const listed = await runDesign(cwd, { action: "systems" }, net);
	assert.deepEqual([listed.own, listed.systems, listed.source], [["DESIGN.md"], ["airbnb", "stripe"], "github.com/nexu-io/open-design design-systems at aaaaaaa"]);
	const fetchedSystem = await runDesign(cwd, { action: "systems", name: "airbnb", handle: "design-2" }, net);
	assert.deepEqual([fetchedSystem.files, fetchedSystem.commit, fetchedSystem.cached], [["DESIGN.md", "SOURCE.json", "tokens.css"], sha, false]);
	assert.deepEqual(JSON.parse(fs.readFileSync(path.join(cwd, ".pi/designs/systems/airbnb/SOURCE.json"), "utf8")).license, "Apache-2.0");
	assert.deepEqual(stored().sessions.find(item => item.handle === "design-2").system, { name: "airbnb", commit: sha });
	online = false; urls.length = 0;
	assert.equal((await runDesign(cwd, { action: "systems", name: "airbnb" }, net)).cached, true, "offline: the cache answers");
	assert.deepEqual([(await runDesign(cwd, { action: "systems" }, net)).fetched, urls], [["airbnb"], []], "the cached index needs no network");
	assert.match((await runDesign(cwd, { action: "systems", refresh: true }, net)).offline, /refresh failed: offline/);
	await assert.rejects(runDesign(cwd, { action: "systems", name: "../x" }, net), /one name from design/);
	await assert.rejects(runDesign(cwd, { action: "systems", name: "nope" }, net), /No design system nope/);
	online = true; hubCalls.length = 0;
	const withSystem = await runDesign(cwd, { action: "start", brief: "b", directions: ["y"], names: ["Y"], title: "t", system: "airbnb" }, net);
	assert.deepEqual(withSystem.sessions[0].system, { name: "airbnb", commit: sha });
	assert.match(hubCalls.find(call => call[0] === "prompt")[2], /Follow the design system in \.pi\/designs\/systems\/airbnb\/ \(DESIGN\.md first/);
	// S16: the handoff lists every screen (index first), points at DESIGN.md and where the chrome is; the brief names the system and commit.
	const ownHandle = withSystem.sessions[0].handle;
	put(ownHandle, { "index.html": "<div data-design-chrome></div>", "pay.html": "<p>pay</p>", "DESIGN.md": "# tokens" });
	const sysExport = (await runDesign(cwd, { action: "select", handle: ownHandle }, choose(undefined))).folder;
	const sysHandoff = fs.readFileSync(path.join(cwd, sysExport, "HANDOFF.md"), "utf8");
	assert.match(sysHandoff, /## Screens\n\n- `index\.html`\n- `pay\.html`\n/);
	assert.match(sysHandoff, /`DESIGN\.md` lists the color tokens/);
	assert.match(sysHandoff, /Found in: index\.html\./);
	assert.match(fs.readFileSync(path.join(cwd, sysExport, "BRIEF.md"), "utf8"), new RegExp(`- Design system: airbnb \\(github\\.com/nexu-io/open-design design-systems/airbnb at ${sha}\\)`));
	console.log("design tool tests passed");
} finally { fs.rmSync(cwd, { recursive: true, force: true }); }
