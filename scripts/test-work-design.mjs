#!/usr/bin/env node
// design tool (D1): start makes one folder and hub session per direction with a build prompt; v1 (OpenDesign) stores load
// with their brief; select exports the folder to a named folder and hands it on (delta on reselect); clone copies and forks.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import designExtension, { runDesign, snapshot, versions, writeRefusal } from "../extensions/design.ts";
import { agentBrowser, renderDesign, reportText, selectRenderTarget } from "../extensions/design-render.ts";
import { decodePng } from "../extensions/screen-read.ts";
import { designStateJson } from "../extensions/design-state.ts";
import { ensureDesignRuntime, astryxRuntime } from "../extensions/design-runtime.ts";
import { themeInput, contrastRatio, themeTokens, runTheme } from "../extensions/design-theme.ts";
import { lookupInput, lookupResponse, runLookup } from "../extensions/design-lookup.ts";
import { appStarter, appSources, assertAppRecipe, buildApp } from "../extensions/design-app.ts";
import { appPreviewFolder, appReceipt, BUILD_FILE, buildStatus, ensureAppBuilt, PREVIEW, readAppFiles } from "../extensions/design-build.ts";

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
	// Standalone tokens and evidence are deterministic; only the bounded child loads Astryx.
	const themeArgs = { accent: "#808080" }, themeParams = themeInput(themeArgs);
	const tonal = Object.fromEntries(Array.from({ length: 21 }, (_, i) => [i * 5, "#" + Math.round(i * 255 / 20).toString(16).padStart(2, "0").repeat(3)]));
	const palette = { schemaVersion: 1, recipe: "astryx-oklch-v1", stops: Array.from({ length: 21 }, (_, i) => i * 5), palette: { accent: { light: tonal, dark: tonal }, neutral: { light: tonal, dark: tonal } } };
	const provenance = { version: "0.7.12", lockDigest: astryxRuntime.lockDigest };
	const generatedTheme = themeTokens(themeParams, palette, provenance);
	assert.deepEqual(generatedTheme, themeTokens(themeParams, palette, provenance));
	assert.equal(createHash("sha256").update(generatedTheme.css).digest("hex"), "ce1fd9daac75f448efc513139ba6d30b21594cadde69da48a652c8b95113341b", "standalone CSS golden");
	assert.equal(generatedTheme.tokens.modes.light.accent, "#808080");assert.equal(generatedTheme.tokens.modes.dark.accent, "#b3b3b3");
	assert(generatedTheme.css.includes("--type-heading: calc(") && generatedTheme.css.includes("--radius-lg: calc("));
	assert(!/https?:\/\//.test(generatedTheme.css), "tokens need no remote or React runtime");
	assert(generatedTheme.tokens.contrast.some(pair => !pair.pass), "contrast failures are reported");
	assert.equal(contrastRatio("#000", "#fff"), 21);assert.equal(contrastRatio("#fff", "#fff"), 1);
	assert(contrastRatio("#777", "#fff") < 4.5 && contrastRatio("#767676", "#fff") > 4.5);
	assert(Math.abs(contrastRatio("#00000080", "#ffffff") - 4.0041) < 0.001, "composite alpha before luminance");
	assert.equal(contrastRatio("#00000000", "#ffffff00", "#000"), 1);
	assert.throws(() => contrastRatio("red", "#fff"), /hex/);assert.throws(() => contrastRatio("#fff", "#000", "#ffffff00"), /opaque/);
	for (const args of [{}, { accent: "red" }, { accent: "#fff;}" }, { ...themeArgs, neutral: "#gggggg" }, { ...themeArgs, typeScale: NaN }, { ...themeArgs, radius: -1 }, { ...themeArgs, baseSize: 0 }, { ...themeArgs, neutral: null }, { ...themeArgs, radius: null }, { ...themeArgs, typeScale: Infinity }]) assert.throws(() => themeInput(args), /accent|neutral|typeScale|radius|baseSize/);
	assert.equal(themeInput({ ...themeArgs, radius: 0, typeScale: 1, baseSize: 24 }).radius, 0);
	assert.throws(() => themeTokens(themeParams, { ...palette, palette: {} }, provenance), /palette/i);
	assert.throws(() => themeTokens(themeParams, { ...palette, recipe: "other-version" }, provenance), /palette/i);
	const fakeThemeCache = path.join(cwd, "theme-runtime"), fakeApi = path.join(fakeThemeCache, "node_modules/@astryxdesign/cli/api");fs.mkdirSync(fakeApi, { recursive: true });
	fs.writeFileSync(path.join(fakeApi, "index.mjs"), `export function generateTonalPalette(request) { if (process.cwd() !== ${JSON.stringify(fakeThemeCache)}) throw Error("project config boundary");if(request.families[0].anchors[0].policy !== "exact") throw Error("missing exact anchor");return ${JSON.stringify(palette)}; }`);
	const themeTools = { runtime: async () => ({ directory: fakeThemeCache, lockDigest: astryxRuntime.lockDigest, versions: astryxRuntime.versions }) };
	assert.deepEqual(await runTheme(themeArgs, themeTools), generatedTheme, "real jiti bootstrap uses the cache public API");
	assert.deepEqual(await runDesign(cwd, { action: "theme", ...themeArgs }, { hub: async () => assert.fail("theme is not a hub session"), ...themeTools }), generatedTheme);
	await assert.rejects(runTheme({ accent: "bad" }, { runtime: async () => assert.fail("invalid request must not provision") }), /accent/);
	// Installed-version lookup: validate before provisioning, read-only API branches, bounded output and provenance.
	for (const args of [{}, { query: "x".repeat(257) }, { query: "é".repeat(129) }, { query: "button", limit: 0 }, { query: "button", limit: 11 }, { query: "button", limit: 1.5 }, { query: "button", catalog: "install" }, { catalog: "component", name: "../../outside" }, { catalog: "component", name: "Button@latest" }, { query: "button", name: "Button" }, { catalog: "template", name: "dashboard", section: "copy" }, { catalog: "component", name: "Button", libraryVersion: "latest" }]) {
		assert.throws(() => lookupInput(args), /lookup|query|limit|catalog|name|section|version/i);
		await assert.rejects(runLookup(args, { runtime: async () => assert.fail("invalid lookup must not provision") }), /lookup|query|limit|catalog|name|section|version/i);
	}
	assert.equal(lookupInput({ query: "  button  " }).query, "button");
	assert.equal(lookupInput({ catalog: "doc", name: "tokens/colors", section: "overview" }).section, "overview");
	assert.throws(() => lookupResponse({}, { query: "button", limit: 5 }), /response/i);
	assert.throws(() => lookupResponse({ type: "template.show", data: {} }, { catalog: "component", name: "Button" }), /response/i);
	assert.throws(() => lookupResponse({ type: "component.detail", data: "x".repeat(50_000) }, { catalog: "component", name: "Button" }), /size|large|48/i);
	assert.throws(() => lookupResponse({ type: "search", data: { results: Array(6).fill({}) } }, { query: "button", limit: 5 }), /count|limit/i);
	const lookupCache = path.join(cwd, "lookup-runtime"), lookupApi = path.join(lookupCache, "node_modules/@astryxdesign/cli/api");fs.mkdirSync(lookupApi, { recursive: true });
	fs.copyFileSync(new URL("../extensions/astryx-runtime/manifest.json", import.meta.url), path.join(lookupCache, "package.json"));
	for (const name of ["cli", "core"]) { const file = path.join(lookupCache, `node_modules/@astryxdesign/${name}/package.json`);fs.mkdirSync(path.dirname(file), { recursive: true });fs.writeFileSync(file, JSON.stringify({ name: `@astryxdesign/${name}`, version: "0.7.12" })); }
	fs.writeFileSync(path.join(lookupApi, "index.mjs"), `
	const check = o => { if (process.cwd() !== ${JSON.stringify(lookupCache)} || o.cwd !== process.cwd()) throw Error("project config boundary"); };
	export async function search(query,o) { check(o);if(query==="hang") await new Promise(resolve=>setTimeout(resolve,30_000));return {type:"search",data:{query,matchCount:1,results:[{domain:"component",name:"Button",package:"@astryxdesign/core"}]}}; }
	export async function component(name,o) { check(o);if(o.package!=="@astryxdesign/core"||o.detail!=="compact") throw Error("unscoped component");if(name==="Unknown") throw Error("Unknown component");return {type:"component.detail",package:o.package,data:{name,usage:"<Button>Save</Button>"}}; }
	export async function template(name,o) { check(o);if(!o.show||o.targetPath||o.cdn||o.overwrite) throw Error("write branch");return {type:"template.show",package:o.package,data:{template:name,source:"<main />"}}; }
	export async function themeListAvailable(o) { check(o);return {type:"theme.list",data:[{slug:"neutral",package:"@astryxdesign/theme-neutral"}]}; }
	export async function docs(name,section,o) { check(o);return {type:"docs.detail.section",package:"@astryxdesign/cli",data:{name,section}}; }
	`);
	const lookupTools = { runtime: async () => ({ directory: lookupCache, ...astryxRuntime }) };
	const lookupFiles = fs.readdirSync(cwd, { recursive: true }).sort();
	const foundButton = await runLookup({ query: "button" }, lookupTools);
	assert.equal(foundButton.response.data.results[0].name, "Button");assert.equal(foundButton.source.versions["@astryxdesign/core"], "0.7.12");assert.equal(foundButton.source.lockDigest, astryxRuntime.lockDigest);
	foundButton.response.data.results[0].name = "mutated";
	assert.equal((await runLookup({ query: "button" }, lookupTools)).response.data.results[0].name, "Button", "cached responses cannot be mutated by callers");
	for (const [catalog, name] of [["component", "Button"], ["template", "dashboard"], ["theme", "neutral"], ["doc", "tokens"]]) assert((await runDesign(cwd, { action: "lookup", catalog, name }, { hub: async () => assert.fail("lookup is not a hub session"), ...lookupTools })).response.type);
	await assert.rejects(runLookup({ catalog: "component", name: "Unknown" }, lookupTools), /Unknown component/);
	await assert.rejects(runLookup({ catalog: "theme", name: "Unknown" }, lookupTools), /Unknown theme/);
	await assert.rejects(runLookup({ query: "button" }, { runtime: async () => ({ directory: lookupCache, lockDigest: "wrong", versions: astryxRuntime.versions }) }), /version|lock|pin/i);
	const cancelledLookup = new AbortController();cancelledLookup.abort();
	await assert.rejects(runLookup({ query: "button" }, { signal: cancelledLookup.signal, runtime: async () => assert.fail("aborted lookup must not provision") }), /abort/i);
	const runningLookup = new AbortController(), abortLookup = setTimeout(() => runningLookup.abort(), 300);
	try { await assert.rejects(runLookup({ query: "hang" }, { ...lookupTools, signal: runningLookup.signal }), /abort/i); } finally { clearTimeout(abortLookup); }
	fs.writeFileSync(path.join(lookupCache, "astryx.config.mjs"), `throw Error("must not execute config");`);
	await assert.rejects(runLookup({ query: "not-cached" }, lookupTools), /configuration/);
	fs.unlinkSync(path.join(lookupCache, "astryx.config.mjs"));
	const lookupManifest = path.join(lookupCache, "package.json"), goodLookupManifest = fs.readFileSync(lookupManifest);
	fs.writeFileSync(lookupManifest, "{");
	await assert.rejects(runLookup({ query: "bad-json" }, lookupTools), /metadata|Invalid package config/);fs.writeFileSync(lookupManifest, goodLookupManifest);
	const lookupCore = path.join(lookupCache, "node_modules/@astryxdesign/core/package.json"), goodLookupCore = fs.readFileSync(lookupCore);
	fs.writeFileSync(lookupCore, JSON.stringify({ name: "@astryxdesign/core", version: "0.7.13" }));
	await assert.rejects(runLookup({ query: "wrong-installed-version" }, lookupTools), /version mismatch/);fs.writeFileSync(lookupCore, goodLookupCore);
	assert.deepEqual(fs.readdirSync(cwd, { recursive: true }).sort(), lookupFiles, "lookups and failures create no project or cache files");
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
	assert(definition.parameters.properties.action.enum.includes("lookup"));assert.equal(definition.parameters.properties.limit.maximum, 10);assert.equal(definition.parameters.properties.query.maxLength, 256);
	fs.writeFileSync(path.join(cwd, "page.html"), "<h1>Home</h1>");
	// Hub fakes: always pass these, the default tools create real hub sessions.
	const hubCalls = [];
	let hubUp = true, hubN = 0;
	const tools = {
		async hub(args) { hubCalls.push(args); if (!hubUp) return { ok: false, text: "hub not running token=abc" }; if (args[0] === "session") return { ok: true, text: JSON.stringify({ id: args[1], name: "Parent" }) }; return ["new", "fork"].includes(args[0]) ? { ok: true, text: `New session ${args[2]}: http://127.0.0.1:1/s/00000000-0000-0000-0000-${String(++hubN).padStart(12, "0")}/?token=x` } : { ok: true, text: "Sent." }; },
	};

	// v1 store (OpenDesign): loads with the brief from its run prompt and OD's fields dropped; the next write is version 2.
	fs.mkdirSync(path.dirname(storePath), { recursive: true });
	fs.writeFileSync(storePath, JSON.stringify({ version: 1, next: 2, sessions: [{ handle: "design-1", projectId: "p", runId: "r", status: "succeeded", retained: { note: "legacy data" }, direction: "old", name: "Old", title: "Old page", prompt: "Old brief\nwith detail\n\nDirection for this design (design-1): old\nBuild it", created: 1 }] }));
	const [old] = await runDesign(cwd, { action: "status" }, tools);
	assert.deepEqual([old.handle, old.name, old.kind, old.projectId, old.runId], ["design-1", "Old", "web", undefined, undefined]);
	assert.deepEqual(old.retained,{note:"legacy data"},"migration preserves unrelated legacy fields");
	const invalidStore=path.join(cwd,"invalid-metadata"), invalidStorePath=path.join(invalidStore,".pi/designs/sessions.json");fs.mkdirSync(path.dirname(invalidStorePath),{recursive:true});
	const validMetadata={handle:"design-1",direction:"x",kind:"web",inputs:[],references:[],created:1};
	for(const invalid of[{...validMetadata,foundation:"other"},{...validMetadata,foundation:"astryx"},{...validMetadata,system:{name:"astryx",version:"latest",lockDigest:"bad"}},{...validMetadata,handle:"../escape"},{...validMetadata,handle:["design-1"]},{...validMetadata,inputs:[1]},{...validMetadata,system:{name:"astryx",version:["0.7.12"],lockDigest:["a".repeat(64)]}}]){
	 const original=JSON.stringify({version:2,next:2,sessions:[invalid]});fs.writeFileSync(invalidStorePath,original);
	 await assert.rejects(runDesign(invalidStore,{action:"open",handle:invalid.handle},tools),/session.*metadata|session.*list/i);
	 assert.equal(fs.readFileSync(invalidStorePath,"utf8"),original,"invalid metadata is never rewritten or silently upgraded");
	}

	for(const invalid of[{version:2,next:1,sessions:[validMetadata]},{version:2,next:3,sessions:[validMetadata,validMetadata]}]){
	 fs.writeFileSync(invalidStorePath,JSON.stringify(invalid));await assert.rejects(runDesign(invalidStore,{action:"status"},tools),/session.*metadata|session.*list/i);
	}
	fs.writeFileSync(invalidStorePath,JSON.stringify({version:1,custom:"retained",sessions:[{...validMetadata,handle:"design-7"}]}));
	const migratedGap=await runDesign(invalidStore,{action:"start",brief:"New",directions:["x"],names:["New"],title:"New design"},{hub:async()=>({ok:false,text:"offline"})});
	assert.equal(migratedGap.sessions[0].handle,"design-8","a missing legacy counter cannot overwrite an existing design");assert.equal(JSON.parse(fs.readFileSync(invalidStorePath)).custom,"retained");
	// Start: one folder and hub session per direction, named by direction, the title below, the brief and inputs in its first message.
	process.env.PI_HUB_SESSION = "parent-session";
	const started = await runDesign(cwd, { action: "start", brief: "Home page\nThe whole landing page, real copy.", directions: ["calm", "bold"], names: ["Calm", "Bold editorial"], title: "Home page", kind: "app", inputs: ["page.html", "../escape.txt", "missing.css"] }, tools);
	delete process.env.PI_HUB_SESSION;
	assert.equal(stored().version, 2);
	assert.deepEqual(stored().sessions[0].retained,{note:"legacy data"},"the next write preserves unrelated migrated fields");
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
		// Use production before-navigation input and observed capability, not screenshot size.
		fs.writeFileSync(path.join(fixture, "theme.html"), `<style>${generatedTheme.css}</style>${generatedTheme.previewControls}<script>window.designReady=(async()=>{document.querySelector("[data-theme-tweaks]").open=true;await new Promise(requestAnimationFrame);const targets=[...document.querySelectorAll("[data-theme-tweaks] summary,[data-theme-tweaks] input")];if(!matchMedia("(pointer:coarse)").matches||targets.length!==5||targets.some(node=>{const r=node.getBoundingClientRect();return r.width<44||r.height<44;}))throw Error("Generated theme targets require observed coarse input and 44x44 bounds");})();</script>`);
		const touchTheme = await renderDesign({ folder: fixture, screen: "theme.html", width: 360, height: 800, input: "touch", element: "[data-theme-knob=radius]" });
		assert.equal(touchTheme.report.input.coarse, true);assert(touchTheme.png.length && touchTheme.report.readiness.settled, reportText(touchTheme.report));
		assert.equal(touchTheme.report.errors.length, 0);assert(touchTheme.height >= 44, "generated Tweaks follow the coarse-pointer target policy");
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
	assert.equal(listed.libraries[0].name, "astryx");assert.equal(listed.libraries[0].version, "0.7.12");assert(!("guide" in listed.libraries[0]), "lists never inject another system's guidance");
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
	{ // V-03: a package is one unit per commit (previews beside their tokens); concurrent asks download once.
		const pkg = { "DESIGN.md": "# Stripe", "tokens.css": ":root{--a:1}", "components.html": "<h1>kit</h1>", "preview/colors.html": "<link rel=stylesheet href=../tokens.css>" }, hits = [];
		let gate = Promise.resolve();
		const stripe = { ...tools, async fetch(url) {
			const file = url.match(new RegExp(`/${sha}/design-systems/stripe/(.+)$`))?.[1]; hits.push(file); await gate;
			const body = typeof pkg[file] === "function" ? pkg[file]() : pkg[file];
			return { ok: body !== undefined, status: body === undefined ? 404 : 200, text: async () => body ?? "" };
		} };
		const dir = path.join(cwd, ".pi/designs/systems/stripe"), ask = () => runDesign(cwd, { action: "systems", name: "stripe" }, stripe);
		const commitOf = () => JSON.parse(fs.readFileSync(path.join(dir, "SOURCE.json"), "utf8")).commit, age = () => fs.writeFileSync(path.join(dir, "SOURCE.json"), JSON.stringify({ commit: "b".repeat(40) }));
		let open; gate = new Promise(resolve => { open = resolve; });
		const both = Promise.all([ask(), ask()]); await new Promise(resolve => setTimeout(resolve, 50)); open(); gate = Promise.resolve();
		assert.deepEqual((await both).map(item => item.cached), [false, true], "the waiting request finds the published unit");
		assert.equal(hits.filter(file => file === "DESIGN.md").length, 1, "two concurrent requests download once");
		assert.deepEqual(fs.readdirSync(dir).sort(), ["DESIGN.md", "SOURCE.json", "components.html", "preview", "tokens.css"]);
		assert.equal(fs.readFileSync(path.join(dir, "preview/colors.html"), "utf8"), pkg["preview/colors.html"], "the colors page sits where ../tokens.css resolves");
		const { designCatalog } = await import("../extensions/design-catalog.ts");
		assert.deepEqual((({ availability, page }) => [availability, page])((await designCatalog(cwd)).entries.find(item => item.id === "od:stripe")), ["cached", "components.html"], "the catalog marks the fetched preview cached");
		assert.deepEqual((({ availability, page }) => [availability, page])((await designCatalog(cwd)).entries.find(item => item.id === "od-colors:stripe")), ["cached", "preview/colors.html"], "the colors page is a Themes entry");
		hits.length = 0; assert.equal((await ask()).cached, true); assert.deepEqual(hits, [], "a cache hit for the same commit never refetches");
		fs.writeFileSync(path.join(dir, "SOURCE.json"), JSON.stringify({ commit: sha }));
		assert.equal((await ask()).cached, false, "a same-commit package cached before preview pages (no files list) is fetched once more");
		age(); delete pkg["preview/colors.html"]; pkg["components.html"] = "x".repeat(1_000_001);
		assert.equal((await ask()).cached, false, "a cache from another commit is refetched");
		assert.deepEqual([commitOf(), fs.existsSync(path.join(dir, "preview")), fs.existsSync(path.join(dir, "components.html"))], [sha, false, false], "older-commit files are dropped and an oversized page is left out");
		assert.deepEqual((await designCatalog(cwd)).entries.filter(item => item.name === "stripe").map(item => [item.availability, item.preview]), [["unavailable", "none"], ["unavailable", "none"]], "a complete package without the pages offers no preview and no retry loop");
		age(); pkg["tokens.css"] = () => { throw new Error("network down"); };
		const interrupted = await ask();
		assert.deepEqual([interrupted.cached, commitOf(), fs.existsSync(path.join(dir, "DESIGN.md"))], [true, "b".repeat(40), true], "an interrupted update keeps the old unit whole");
		assert.match(interrupted.stale, /update failed: .*network down/);
		assert.deepEqual(fs.readdirSync(path.join(cwd, ".pi/designs/systems")).filter(name => name.startsWith(".")), [], "no temp folders remain");
		fs.rmSync(dir, { recursive: true });
	}
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
	put(ownHandle, { "tokens.css": generatedTheme.css, "theme.tokens.json": JSON.stringify(generatedTheme.tokens), "DESIGN.md": generatedTheme.designNotes });
	await runDesign(cwd, { action: "select", handle: ownHandle }, choose(undefined));
	assert.match(fs.readFileSync(path.join(cwd, sysExport, "HANDOFF.md"), "utf8"), /Keep `theme.tokens.json` alongside `tokens.css`/);
	assert.deepEqual(JSON.parse(fs.readFileSync(path.join(cwd, sysExport, "theme.tokens.json"), "utf8")), generatedTheme.tokens);
	// Selecting Astryx references stays local, injects only its compact guide, and preserves exact non-Git provenance.
	const noLibraryInstall = { ...tools, fetch: async () => assert.fail("reference selection must not fetch"), runtime: async () => assert.fail("reference selection must not install") };
	const brandless = path.join(cwd, "brandless");fs.mkdirSync(brandless);
	const offlineLibraries = await runDesign(brandless, { action: "systems" }, { ...noLibraryInstall, fetch: async () => { throw new Error("offline"); } });
	assert.equal(offlineLibraries.libraries[0].name, "astryx");assert.equal(offlineLibraries.systems.length, 0);assert.match(offlineLibraries.offline, /offline/);
	const astryxReference = await runDesign(cwd, { action: "systems", name: "astryx" }, noLibraryInstall);
	assert.equal(astryxReference.version, "0.7.12");assert.equal(astryxReference.lockDigest, astryxRuntime.lockDigest);assert.equal(astryxReference.commit, undefined);
	assert.deepEqual(astryxReference.files, ["DESIGN.md", "SOURCE.json"]);
	assert.equal((await runDesign(cwd, { action: "systems", name: "astryx" }, noLibraryInstall)).cached, true);
	const referenceGuide = fs.readFileSync(path.join(cwd, astryxReference.folder, "DESIGN.md"), "utf8");
	assert(referenceGuide.length < 1500 && referenceGuide.includes('action:"lookup"'));assert(!referenceGuide.includes("Airbnb"));
	await runDesign(cwd, { action: "systems", name: "astryx", handle: ownHandle }, noLibraryInstall);
	assert.deepEqual(stored().sessions.find(item => item.handle === ownHandle).system, { name: "astryx", version: "0.7.12", lockDigest: astryxRuntime.lockDigest });
	await runDesign(cwd, { action: "select", handle: ownHandle }, choose(undefined));
	const astryxBrief = fs.readFileSync(path.join(cwd, sysExport, "BRIEF.md"), "utf8");
	assert(astryxBrief.includes(`astryx (@astryxdesign/core 0.7.12; lock ${astryxRuntime.lockDigest})`));assert(!astryxBrief.includes("design-systems/astryx"));
	hubCalls.length = 0;
	const withAstryx = await runDesign(cwd, { action: "start", brief: "b", directions: ["z"], names: ["Z"], title: "t", system: "astryx" }, noLibraryInstall);
	assert.equal(withAstryx.sessions[0].system.lockDigest, astryxRuntime.lockDigest);
	assert.match(hubCalls.find(call => call[0] === "prompt")[2], /systems\/astryx\/ \(DESIGN\.md first/);
	assert(!hubCalls.find(call => call[0] === "prompt")[2].includes("Airbnb"));
	// Optional component foundation: fixed recipe, local output, immutable last-good publication and source-only writes.
	const componentCache = path.join(cwd, "component-cache"), compiler = path.join(componentCache, "node_modules/esbuild/lib/main.js");
	fs.mkdirSync(path.dirname(compiler), { recursive: true });
	fs.writeFileSync(compiler, `exports.build = async o => {
	  const p = require("node:path");let load,resolve;
	  o.plugins[0].setup({onLoad(_o,fn){load=fn},onResolve(_o,fn){resolve=fn}});
	  const source=load(await resolve({path:"src/main.jsx",kind:"entry-point"})).contents.toString();
	  if(source.includes("FAIL_BUILD"))throw Error("Deliberate build failure");
	  if(source.includes("SLOW_BUILD"))await new Promise(r=>setTimeout(r,500));
	  const app=load({path:"src/App.jsx"}).contents.toString();
	  return {metafile:{outputs:{}},outputFiles:[{path:p.join(o.outdir,"app.js"),contents:Buffer.from("window.compiledSource="+JSON.stringify(source+app))},{path:p.join(o.outdir,"astryx.css"),contents:Buffer.from("/* pinned component test double */")}]} }`);
	let componentRuns = 0;
	const componentTools = { ...tools, runtime: async () => { componentRuns++;return { directory: componentCache, ...astryxRuntime }; }, confirm: async () => assert.fail("component tests never download") };
	const starter = appStarter('Local <& " design');assertAppRecipe(starter);
	assert(starter.has("src/screens/index.html") && starter.has("src/App.jsx") && starter.has("package-lock.json") && starter.has("THIRD_PARTY_NOTICES.md"));
	assert(!starter.has("index.html"), "root HTML is generated, not the authored screen shell");
	assert(starter.get("src/screens/index.html").toString().includes("&lt;&amp; &quot;"));
	assert(!/https?:\/\//.test(starter.get("src/vendor.css").toString()), "no Google Fonts/CDN import");
	const badSource = new Map(starter);badSource.set("src/../../secret.js",Buffer.from("secret"));assert.throws(()=>appSources(badSource),/path/);
	const badPin = new Map(starter);badPin.set("package.json",Buffer.from("{}"));await assert.rejects(buildApp(badPin,componentTools),/pin|reviewed/);assert.equal(componentRuns,0);
	const componentProject = path.join(cwd,"component-project");fs.mkdirSync(componentProject);
	const componentStart = await runDesign(componentProject,{action:"start",kind:"app",system:"astryx",brief:"Build a project tool",directions:["compact"],names:["Component"],title:"Local app"},componentTools);
	const component = componentStart.sessions[0], componentDir = path.join(componentProject,".pi/designs",component.handle);
	assert.equal(component.foundation,"astryx");assert.equal(componentRuns,1,"start compiles once; verified unchanged output skips provisioning");
	assert(fs.existsSync(path.join(componentDir,"index.html")));assert.equal(buildStatus(componentDir).state,"ready");
	const outputBefore = fs.readFileSync(path.join(componentDir,BUILD_FILE)), goodPreview = appPreviewFolder(componentDir);
	assert.notEqual(goodPreview,componentDir);assert(![...readAppFiles(componentDir).keys()].some(name=>name.startsWith(PREVIEW+"/")));
	assert.match(writeRefusal(componentProject,component.handle,path.join(componentDir,"index.html")),/source|extension-owned/);
	assert.equal(writeRefusal(componentProject,component.handle,path.join(componentDir,"src/App.jsx")),undefined);
	await ensureAppBuilt(componentDir,componentTools);assert.equal(componentRuns,1);assert(fs.readFileSync(path.join(componentDir,BUILD_FILE)).equals(outputBefore));
	assert.throws(()=>appReceipt(new Map([[BUILD_FILE,Buffer.from(JSON.stringify({...JSON.parse(outputBefore),sourceDigest:["a".repeat(64)]}))]])),/Invalid component build receipt/);
	const componentVersion = await snapshot(componentProject,component.handle,componentTools);assert.equal(componentVersion,1);assert.equal(await snapshot(componentProject,component.handle,componentTools),1);
	const componentMain = path.join(componentDir,"src/main.jsx"), goodMain = fs.readFileSync(componentMain);
	fs.appendFileSync(componentMain,"\n// FAIL_BUILD");
	await assert.rejects(runDesign(componentProject,{action:"select",handle:component.handle},componentTools),/Deliberate build failure/);
	assert.equal(buildStatus(componentDir).state,"failed");assert.equal(appPreviewFolder(componentDir),goodPreview);
	assert(fs.readFileSync(path.join(componentDir,BUILD_FILE)).equals(outputBefore),"failed build never replaces last-good receipt");
	await assert.rejects(snapshot(componentProject,component.handle,componentTools),/Deliberate build failure/);
	assert(fs.existsSync(path.join(componentProject,".pi/designs/history",component.handle,"2/.design-draft.json")),"failed source is explicitly versioned as a draft");
	await runDesign(componentProject,{action:"restore",handle:component.handle,version:1},componentTools);
	assert(fs.readFileSync(componentMain).equals(goodMain));assert.equal(buildStatus(componentDir).state,"ready");
	assert.equal(versions(componentProject,component.handle).at(-1),3,"restore preserves failed edits then publishes a coherent version");
	// Output/cache corruption, cancellation and concurrent lifecycle operations cannot publish a mismatched version.
	const generatedJs=Object.keys(JSON.parse(outputBefore).generated).find(name=>name.endsWith(".js"));
	fs.writeFileSync(path.join(componentDir,generatedJs),"tampered output");await ensureAppBuilt(componentDir,componentTools);
	assert.equal(await snapshot(componentProject,component.handle,componentTools),3,"repairing identical output consumes no version slot");
	fs.writeFileSync(path.join(goodPreview,"index.html"),"corrupt preview cache");await ensureAppBuilt(componentDir,componentTools);
	assert.notEqual(fs.readFileSync(path.join(appPreviewFolder(componentDir),"index.html"),"utf8"),"corrupt preview cache");
	fs.rmSync(path.join(componentDir,PREVIEW),{recursive:true});assert.equal(appPreviewFolder(componentDir),goodPreview,"a missing generated cache is reconstructed offline from verified retained output");
	fs.appendFileSync(componentMain,"\n// SLOW_BUILD");const buildAbort=new AbortController();
	const cancelledBuild=ensureAppBuilt(componentDir,{...componentTools,signal:buildAbort.signal});const abortTimer=setTimeout(()=>buildAbort.abort(),30);
	try{await assert.rejects(cancelledBuild,/abort|cancel/i);}finally{clearTimeout(abortTimer);}
	assert(fs.readFileSync(path.join(componentDir,BUILD_FILE)).equals(outputBefore));
	const changedDuring=ensureAppBuilt(componentDir,componentTools), editTimer=setTimeout(()=>fs.appendFileSync(componentMain,"\n// changed during build"),40);
	try{await assert.rejects(changedDuring,/Source changed during/);}finally{clearTimeout(editTimer);}
	assert(fs.readFileSync(path.join(componentDir,BUILD_FILE)).equals(outputBefore));
	fs.writeFileSync(componentMain,Buffer.concat([goodMain,Buffer.from("\n// refinement")]));
	const concurrent=await Promise.all([snapshot(componentProject,component.handle,componentTools),runDesign(componentProject,{action:"select",handle:component.handle},componentTools),runDesign(componentProject,{action:"clone",handle:component.handle,name:"Copy"},componentTools),runDesign(componentProject,{action:"restore",handle:component.handle,version:1},componentTools),runDesign(componentProject,{action:"look",handle:component.handle,presets:["Phone"]},componentTools)]);
	assert.equal(concurrent[0],4);assert.equal(concurrent[1].version,4);assert.equal(concurrent[2][0].foundation,"astryx");assert.equal(concurrent[3].version,5);assert(concurrent[4].shots[0].png);
	assert.equal(await snapshot(componentProject,component.handle,componentTools),5,"serialized look/restore/clone/select never create a duplicate snapshot");
	assert(!fs.readdirSync(path.join(componentDir,PREVIEW)).some(name=>name.startsWith(".stage-")||name.startsWith(".corrupt-")),"publication/corruption scratch paths are cleaned");
	console.log("component lifecycle regressions passed");
	// Real pinned compiler/browser coverage when the already-approved host cache exists; never provision from a test.
	const importFailure=(error,expected)=>{assert.doesNotMatch(error.message,/timed out|ETIMEDOUT|killed|SIGTERM/i);assert.notEqual(error.cause?.killed,true);assert.match(error.message,/\[plugin:\s*confined-design-source\]/);assert.match(error.message,expected);return true;};
	assert.throws(()=>importFailure(new Error("Command failed: node.exe bootstrap node:fs",{cause:{killed:true}}),/Could not resolve/),"a killed worker never passes as an import rejection");
	assert.throws(()=>importFailure(new Error("[plugin: confined-design-source] Could not resolve; timed out"),/Could not resolve/),"timeout text never passes as an import rejection");
	const realCache = path.join(process.env.PI_CODING_AGENT_DIR ?? path.join(os.homedir(),".pi/agent"),"cache/design-runtimes/astryx",astryxRuntime.lockDigest,`${process.platform}-${process.arch}`);
	if (fs.existsSync(path.join(realCache,"receipt.json"))) {
		const realRuntime = await ensureDesignRuntime({confirm:async()=>assert.fail("live checks must reuse the verified cache without downloads")});
		const realTools = {...tools,runtime:async()=>realRuntime};
		const largeSource=new Map(starter);largeSource.set("src/App.jsx",Buffer.concat([starter.get("src/App.jsx"),Buffer.from("\n/*"+"x".repeat(70_000)+"*/")]));
		const a=await buildApp(largeSource,realTools), b=await buildApp(largeSource,realTools);
		const outputDigests=files=>[...files].map(([name,bytes])=>[name,createHash("sha256").update(bytes).digest("hex")]);
		assert.deepEqual(outputDigests(a),outputDigests(b),"two real fixed-recipe builds must be byte-identical");
		assert(a.has("index.html") && [...a.keys()].some(name=>/^assets\/app-.*\.js$/.test(name)),"source larger than Windows argv limits compiles through bounded stdin");
		console.log("real compiler determinism/large-source checks passed");
		for (const [spec,expected] of [["../../outside.js",/Missing confined app source/],["node:fs",/never URLs, absolute paths or Node builtins/],["https://example.invalid/module.js",/never URLs, absolute paths or Node builtins/],["not-a-reviewed-design-package",/Could not resolve/]]) {
			const hostile = new Map(starter);hostile.set("src/main.jsx",Buffer.from(`import ${JSON.stringify(spec)};`));
			await assert.rejects(buildApp(hostile,realTools),error=>importFailure(error,expected));
		}
		const realProject=path.join(cwd,"real-component");fs.mkdirSync(realProject);
		const {sessions:[real]}=await runDesign(realProject,{action:"start",kind:"app",system:"astryx",brief:"Prototype",directions:["local"],names:["Local"],title:"Real pinned components"},realTools);
		const realDir=path.join(realProject,".pi/designs",real.handle), preview=appPreviewFolder(realDir);
		const shot=await renderDesign({folder:preview,width:820,height:1180,input:"touch",state:"started",element:"@starter-action"});
		assert(shot.png.length && shot.report.readiness.settled,reportText(shot.report));assert.equal(shot.report.state?.restored,true,reportText(shot.report));
		assert.equal(shot.report.errors.length,0,reportText(shot.report));assert.equal(shot.report.failed.length,0,reportText(shot.report));assert.equal(shot.report.input.coarse,true);assert(shot.height>=44,"real component tablet target is touch-safe");
		const selectedReal=await runDesign(realProject,{action:"select",handle:real.handle},realTools), selectedDir=path.join(realProject,selectedReal.folder), selectedFiles=readAppFiles(selectedDir), selectedReceipt=appReceipt(selectedFiles);
		assert.equal(JSON.parse(selectedFiles.get("DESIGN.json")).foundation,"astryx");assert(selectedFiles.has("src/main.jsx")&&selectedFiles.has("src/App.jsx")&&selectedFiles.has("package-lock.json")&&selectedFiles.has("THIRD_PARTY_NOTICES.md"));
		assert.match(selectedFiles.get("HANDOFF.md").toString(),/Verification matrix[\s\S]*Prototype behavior only/);assert.match(selectedFiles.get("BRIEF.md").toString(),/Component foundation: Astryx/);
		assert(!fs.existsSync(path.join(selectedDir,PREVIEW)) && !fs.existsSync(path.join(selectedDir,"node_modules")),"selection contains no installed dependencies or scratch cache");
		assert.equal((await ensureAppBuilt(selectedDir,{runtime:async()=>assert.fail("a coherent exported receipt needs no rebuild")})).rebuilt,false);
		const isolated=path.join(cwd,"selected-offline");for(const[name,bytes]of selectedFiles){fs.mkdirSync(path.dirname(path.join(isolated,name)),{recursive:true});fs.writeFileSync(path.join(isolated,name),bytes);}
		for(const name of Object.keys(selectedReceipt.generated))fs.rmSync(path.join(isolated,name));fs.rmSync(path.join(isolated,BUILD_FILE));
		assert.equal((await ensureAppBuilt(isolated,realTools)).rebuilt,true);assert.deepEqual(appReceipt(readAppFiles(isolated)).generated,selectedReceipt.generated,"offline export rebuild reproduces every generated byte/hash");
		const roundtripShot=await renderDesign({folder:appPreviewFolder(isolated),width:820,height:1180,input:"touch",state:"started",element:"@starter-action"});
		assert.equal(createHash("sha256").update(roundtripShot.png).digest("hex"),createHash("sha256").update(shot.png).digest("hex"),"the same restored component state renders identically after an isolated offline rebuild");
		const handoffBefore=fs.readFileSync(path.join(selectedDir,"HANDOFF.md")), recipePath=path.join(realDir,"APP.json");fs.writeFileSync(recipePath,"{}");
		await assert.rejects(runDesign(realProject,{action:"select",handle:real.handle},realTools),/recipe|pin/i);assert(fs.readFileSync(path.join(selectedDir,"HANDOFF.md")).equals(handoffBefore));assert.equal(fs.readFileSync(recipePath,"utf8"),"{}","failed selection never silently upgrades or discards broken source metadata");
		await runDesign(realProject,{action:"restore",handle:real.handle,version:selectedReal.version},realTools);assertAppRecipe(readAppFiles(realDir));
		console.log("selected editable-source offline roundtrip passed");
		const beforeRuntime=realRuntime.downloadBytes;assert.equal(beforeRuntime,0);
		console.log("real pinned component checks passed",JSON.stringify({downloadBytes:0,outputBytes:[...a.values()].reduce((n,v)=>n+v.length,0),touchTargetHeight:shot.height,stateRestored:shot.report.state.restored,settled:shot.report.readiness.settled}));
	} else console.log("real pinned component checks skipped: no preinstalled host cache (unit coverage still ran; no download attempted)");
	console.log("design tool tests passed");
} finally { fs.rmSync(cwd, { recursive: true, force: true }); }
