#!/usr/bin/env node
// Project map maintenance: bounded read-only evidence, atomic publication, freshness and cross-session races.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const mod = await import(pathToFileURL(path.join(import.meta.dirname, "../extensions/work-project-map.ts")).href);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "work-project-map-"));
const repo = path.join(temp, "repo"), agentDir = path.join(temp, "agent"), outside = path.join(temp, "outside");
const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true }); fs.writeFileSync(path.join(repo, rel), text); };
const MODEL = "test/mapper:low";

function fakeModel() {
	const prompts = [];
	let gate;
	const complete = async ({ prompt, model }) => {
		prompts.push(prompt);
		assert.equal(model, MODEL, "the configured model is used, never a fallback");
		if (gate) await gate.promise;
		const files = [...prompt.matchAll(/^### (.+?) \(/gm)].map((m) => m[1]);
		return `# Project map\n## Index\n${files.map((rel) => `- ${rel}`).join("\n") || "- unchanged"}\n`;
	};
	return {
		complete, prompts,
		hold() { let release; gate = { promise: new Promise((resolve) => { release = resolve; }) }; gate.release = release; return gate; },
		free() { const current = gate; gate = undefined; current?.release(); },
	};
}
function treeHash(dir) {
	const hash = crypto.createHash("sha256");
	const walk = (rel) => {
		for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
			const child = rel ? `${rel}/${entry.name}` : entry.name;
			if (child === ".git" || entry.isSymbolicLink()) continue;
			if (entry.isDirectory()) walk(child);
			else hash.update(child).update(fs.readFileSync(path.join(dir, child)));
		}
	};
	walk("");
	return hash.digest("hex");
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 20));

try {
	fs.mkdirSync(repo, { recursive: true });
	fs.mkdirSync(outside, { recursive: true });
	git("init", "-q");
	git("config", "user.email", "t@t");
	git("config", "user.name", "t");
	write("src/a.ts", "// Owns parsing.\nexport function parseThing(input) {\n\treturn input;\n}\n");
	write("src/b.ts", "import { parseThing } from './a.ts';\nexport class Runner {}\n");
	write("README.md", "# Fixture\n## Usage\n");
	git("add", ".");
	git("commit", "-q", "-m", "init");
	// Untracked, with no ignore rules: dependency output, credentials, huge, binary.
	write("node_modules/dep/index.js", "export function dependencyOnly() {}\n");
	write("package-lock.json", "{}\n");
	write(".env", "API_KEY=sk-live-ABCDEFGHIJKLMNOPQRSTUVWX\n");
	write("big.txt", `export const huge = 1;\n${"x".repeat(300 * 1024)}`);
	write("logo.png", "png");
	fs.writeFileSync(path.join(repo, "blob.dat"), Buffer.from([0x65, 0x78, 0, 1, 2]));
	fs.writeFileSync(path.join(outside, "leak.ts"), "export const outsideMarker = 1;\n");
	let linked = true;
	try { fs.symlinkSync(outside, path.join(repo, "linked"), "junction"); } catch { linked = false; }

	// Scope and cache location.
	assert.equal(mod.projectRoot(path.join(repo, "src")).root, fs.realpathSync(repo), "Git scope is the top level");
	const plain = path.join(temp, "plain");
	fs.mkdirSync(plain);
	fs.writeFileSync(path.join(plain, "tool.py"), "def run():\n    pass\n");
	assert.equal(mod.projectRoot(plain), undefined, "global enablement never maps a non-Git folder");
	assert.equal(mod.projectRoot(plain, { allowNonGit: true }).git, false, "an explicit project setting maps a non-Git folder");
	assert.equal(mod.projectRoot(os.homedir(), { allowNonGit: true }), undefined, "the home folder is never a map scope");
	assert.equal(mod.projectRoot(path.parse(temp).root, { allowNonGit: true }), undefined, "a drive root is never a map scope");
	assert.throws(() => mod.mapLocation(repo, path.join(repo, ".pi-agent")), /inside this project/, "a cache inside the worktree is refused");
	const loc = mod.mapLocation(repo, agentDir);
	assert.ok(!loc.dir.startsWith(fs.realpathSync(repo)), "the cache lives outside the worktree");

	let enabled = true;
	const fake = fakeModel();
	const mapper = mod.createProjectMapper({ agentDir, complete: fake.complete, isEnabled: () => enabled });
	assert.equal(mapper.status(repo).status, "missing");

	// First build leaves Git status and every source byte untouched.
	const statusBefore = git("status", "--porcelain"), treeBefore = treeHash(repo);
	let result = await mapper.refresh(repo, { model: MODEL });
	assert.equal(result.status, "partial", "skipped files make coverage partial, never complete");
	assert.equal(git("status", "--porcelain"), statusBefore, "publication leaves git status unchanged");
	assert.equal(treeHash(repo), treeBefore, "publication leaves source bytes unchanged");
	const first = fake.prompts.at(-1);
	assert.ok(first.includes("### src/a.ts") && first.includes("L2: export function parseThing"), "evidence holds outlines with line references");
	for (const leak of ["dependencyOnly", "sk-live", "API_KEY", "export const huge", "outsideMarker"])
		assert.ok(!first.includes(leak), `evidence excludes ${leak}`);
	const map1 = fs.readFileSync(loc.map, "utf8");
	assert.match(map1, /^<!-- ce-workflow project-map v1 generation=1 -->\n# Project map\n/);
	assert.match(map1, /big\.txt \(too large\)/);
	assert.match(map1, /logo\.png \(binary\)/);
	assert.match(map1, /blob\.dat \(binary\)/);
	assert.match(map1, /generated, dependency or credential files excluded by policy/);
	assert.match(map1, /never proves that something is absent/);
	if (linked) assert.match(map1, /linked\/leak\.ts \(outside the project\)|linked \(symlink\)/, "a junction out of the project is reported, not read");
	assert.equal(mapper.status(repo).status, "partial");

	// No changes: no model call.
	const calls = fake.prompts.length;
	result = await mapper.refresh(repo, { model: MODEL });
	assert.equal(result.status, "partial");
	assert.equal(fake.prompts.length, calls, "an unchanged project costs no model call");

	// Add, delete, rename and a dirty tracked edit: stale, then an incremental update.
	write("src/c.ts", "export function newHelper() {}\n");
	fs.renameSync(path.join(repo, "src/b.ts"), path.join(repo, "src/runner.ts"));
	write("src/a.ts", "// Owns parsing.\nexport function parseThing(input) {\n\treturn input.trim();\n}\n");
	assert.equal(mapper.status(repo).status, "stale", "working-tree edits make the map stale");
	result = await mapper.refresh(repo, { model: MODEL });
	const incremental = fake.prompts.at(-1);
	assert.ok(incremental.startsWith("Current map:") && incremental.includes("- src/b.ts"), "an update sends the current map");
	assert.ok(incremental.includes("### src/c.ts") && incremental.includes("### src/runner.ts") && incremental.includes("### src/a.ts"), "changed and added files are re-read");
	assert.ok(/Deleted files:\nsrc\/b\.ts/.test(incremental), "the renamed-away path is reported deleted");
	assert.ok(!incremental.includes("### README.md"), "unchanged files are not resent");
	assert.match(fs.readFileSync(loc.map, "utf8"), /generation=2/);

	// Branch switch is just another content change.
	git("add", "-A");
	git("commit", "-q", "-m", "second");
	git("checkout", "-q", "-b", "other");
	write("README.md", "# Fixture on another branch\n");
	git("commit", "-q", "-am", "branch");
	await mapper.refresh(repo, { model: MODEL });
	git("checkout", "-q", "-");
	assert.equal(mapper.status(repo).status, "stale", "switching branches back makes the branch map stale");

	// Broad change: full rebuild.
	for (let index = 0; index < 30; index++) write(`gen/file${index}.ts`, `export const value${index} = ${index};\n`);
	await mapper.refresh(repo, { model: MODEL });
	assert.ok(fake.prompts.at(-1).startsWith("Evidence:"), "broad changes rebuild from full evidence");

	// Malformed, oversized and secret-bearing output: failed, the previous map stays byte-for-byte.
	const good = fs.readFileSync(loc.map, "utf8");
	for (const [label, text] of [["malformed", "Sure! Here is a map."], ["oversized", `# Project map\n## Index\n${"x".repeat(60_001)}`], ["secret", "# Project map\n## Index\nkey ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789\n"]]) {
		write("src/c.ts", `export function newHelper() { return "${label}"; }\n`);
		const bad = mod.createProjectMapper({ agentDir, complete: async () => text, isEnabled: () => true });
		result = await bad.refresh(repo, { model: MODEL });
		assert.equal(result.status, "failed", `${label} output fails`);
		assert.equal(fs.readFileSync(loc.map, "utf8"), good, `${label} output keeps the last good map`);
	}
	assert.equal(mapper.status(repo).status, "stale", "a failed refresh keeps the map visibly stale");
	result = await mod.createProjectMapper({ agentDir, complete: async () => { throw new Error("Mapping model test/mapper:low is unavailable"); }, isEnabled: () => true }).refresh(repo, { model: MODEL });
	assert.equal(result.status, "failed");
	assert.match(JSON.parse(fs.readFileSync(loc.state, "utf8")).lastError, /unavailable/, "an unavailable model is recorded, not retried");
	assert.equal(fs.readFileSync(loc.map, "utf8"), good);
	await mapper.refresh(repo, { model: MODEL });

	// Corrupt state and an unsupported map format are rebuilt, never parsed.
	fs.writeFileSync(loc.state, "{not json");
	assert.equal(mapper.status(repo).status, "stale", "corrupt state is never trusted");
	await mapper.refresh(repo, { model: MODEL });
	fs.writeFileSync(loc.map, "<!-- ce-workflow project-map v0 generation=9 -->\n# Old\n");
	assert.equal(mapper.status(repo).status, "missing", "an unsupported format counts as missing");
	result = await mapper.refresh(repo, { model: MODEL });
	assert.ok(fake.prompts.at(-1).startsWith("Evidence:") && /v1 generation=/.test(fs.readFileSync(loc.map, "utf8")), "migration rebuilds the map");

	// Two sessions: one claim; a change arriving during the run is not lost.
	const a = fakeModel(), b = fakeModel();
	const mapperA = mod.createProjectMapper({ agentDir, complete: a.complete, isEnabled: () => enabled });
	const mapperB = mod.createProjectMapper({ agentDir, complete: b.complete, isEnabled: () => enabled });
	write("src/c.ts", "export function newHelper() { return 'race'; }\n");
	const gateA = a.hold();
	const runA = mapperA.refresh(repo, { model: MODEL });
	while (!a.prompts.length) await tick();
	write("src/d.ts", "export function arrivedDuringRun() {}\n");
	assert.equal((await mapperB.refresh(repo, { model: MODEL })).status, "busy", "a second session never claims a live job");
	assert.equal(b.prompts.length, 0);
	assert.equal(await mapperB.waitForIdle(repo, { timeoutMs: 50, pollMs: 10 }), false, "waiting reports a live job");
	a.free();
	await runA;
	assert.equal(a.prompts.length, 2, "the pending request re-runs once the first job publishes");
	assert.ok(a.prompts[1].includes("### src/d.ts"), "the change made during the run reaches the map");
	assert.equal(mapper.status(repo).status, "partial", "nothing is left pending");
	void gateA;

	// A snapshot is never stamped with newer content.
	write("src/c.ts", "export function newHelper() { return 'snapshot'; }\n");
	a.hold();
	const runSnapshot = mapperA.refresh(repo, { model: MODEL });
	while (a.prompts.length < 3) await tick();
	write("src/e.ts", "export function afterScan() {}\n");
	a.free();
	await runSnapshot;
	assert.equal(mapper.status(repo).status, "stale", "edits after the evidence snapshot leave the map stale");

	// Disable while running: the late result is rejected and the last map is kept.
	const beforeDisable = fs.readFileSync(loc.map, "utf8");
	a.hold();
	const runLate = mapperA.refresh(repo, { model: MODEL });
	while (a.prompts.length < 4) await tick();
	await mapperB.disable(repo);
	a.free();
	assert.equal((await runLate).status, "superseded", "a disabled job cannot publish");
	assert.equal(fs.readFileSync(loc.map, "utf8"), beforeDisable, "disable keeps the last map on disk");

	// Disable then re-enable: the old job's late result cannot overwrite the new one.
	a.hold();
	const runOld = mapperA.refresh(repo, { model: MODEL });
	while (a.prompts.length < 5) await tick();
	await mapperB.disable(repo);
	assert.equal((await mapperB.refresh(repo, { model: MODEL })).status, "partial", "re-enabling starts a fresh job");
	const fresh = fs.readFileSync(loc.map, "utf8");
	a.free();
	assert.equal((await runOld).status, "superseded", "the old job's late result is rejected after re-enable");
	assert.equal(fs.readFileSync(loc.map, "utf8"), fresh);

	// Setting turned off while the model ran (no explicit disable call): nothing publishes.
	write("src/e.ts", "export function afterScan() { return 1; }\n");
	a.hold();
	const runOff = mapperA.refresh(repo, { model: MODEL });
	while (a.prompts.length < 6) await tick();
	enabled = false;
	a.free();
	assert.equal((await runOff).status, "disabled", "publication re-reads the setting");
	assert.equal(fs.readFileSync(loc.map, "utf8"), fresh);
	enabled = true;

	// A job owned by a dead process is reclaimed; a live one inside its deadline is not.
	const state = JSON.parse(fs.readFileSync(loc.state, "utf8"));
	fs.writeFileSync(loc.state, JSON.stringify({ ...state, job: { id: "dead", pid: 2 ** 30, deadline: Date.now() + 60_000 } }));
	assert.notEqual((await mapperB.refresh(repo, { model: MODEL })).status, "busy", "a dead owner's job is reclaimed");

	// Non-Git scope: bounded walk with the same exclusions.
	fs.mkdirSync(path.join(plain, "node_modules"));
	fs.writeFileSync(path.join(plain, "node_modules", "x.js"), "export function dependencyOnly() {}\n");
	const plainModel = fakeModel();
	result = await mod.createProjectMapper({ agentDir, complete: plainModel.complete, isEnabled: () => true }).refresh(plain, { git: false, model: MODEL });
	assert.equal(result.status, "ready");
	assert.ok(plainModel.prompts[0].includes("### tool.py") && !plainModel.prompts[0].includes("dependencyOnly"), "the non-Git walk skips dependencies");

	// Session glue: the first idle input waits for the map; guidance is stable; failures do not retry on their own.
	{
		const tick = () => new Promise((resolve) => setTimeout(resolve, 20));
		const session = (complete, scope = { root: fs.realpathSync(repo), git: true, model: MODEL }, extra = {}) => {
			const mapper = mod.createProjectMapper({ agentDir: path.join(temp, `agent-${crypto.randomUUID()}`), complete, isEnabled: () => true });
			return { mapper, maps: mod.createProjectMapSession({ mapper, scope: () => scope, ...extra }) };
		};
		const held = fakeModel();
		const gateHold = held.hold();
		const { mapper: m1, maps } = session(held.complete);
		const statuses = [];
		let settled = false;
		const first = maps.gate(repo, { onStatus: (text) => statuses.push(text) }).then((value) => { settled = true; return value; });
		const joined = maps.gate(repo, {});
		await tick();
		assert.equal(settled, false, "the input stays held while the first map builds");
		assert.equal(maps.section(repo), undefined, "no guidance before a map exists");
		gateHold.release(); held.free();
		assert.equal(await first, "continue");
		assert.equal(await joined, "continue");
		assert.equal(held.prompts.length, 1, "concurrent inputs join one build");
		assert.deepEqual(statuses, ["Building the project map…", undefined]);
		const guidance = maps.section(repo);
		assert.ok(guidance.includes(m1.location(repo).map) && /reuse or extend/.test(guidance));
		write("src/later.ts", "export function laterThing() {}\n");
		assert.equal((await maps.background(repo)).status, "ready");
		assert.equal(held.prompts.length, 2, "a task boundary catches up with edits");
		assert.equal(maps.section(repo), guidance, "routine refreshes leave the prompt section byte-identical");
		await maps.background(repo);
		assert.equal(held.prompts.length, 2, "unchanged sources make no model call");
		assert.equal(await maps.gate(repo, {}), "continue");

		// Off (None, child session, no root): no hold, no guidance, no model call.
		const off = session(async () => assert.fail("no model call when mapping is off"), null);
		assert.equal(await off.maps.gate(repo, { hasUI: true, ask: () => assert.fail("no dialog") }), "continue");
		assert.equal(off.maps.section(repo), undefined);
		assert.equal(off.maps.background(repo), undefined);

		// Headless failure: a deterministic error, then no silent retry on later inputs or boundaries.
		let calls = 0;
		const broken = session(async () => { calls++; throw new Error("provider down"); });
		const error = await broken.maps.gate(repo, {});
		assert.match(error.error, /provider down.*None/);
		assert.match((await broken.maps.gate(repo, {})).error, /provider down/);
		const notices = [];
		assert.equal(broken.maps.background(repo, (text) => notices.push(text)), undefined);
		assert.equal(calls, 1, "a failure is not retried until the user asks");
		assert.match(broken.maps.describe(repo), /provider down/);

		// Interactive failure: Retry, then Continue without the map bypasses for the session.
		let fail = true;
		const flaky = fakeModel();
		const retrying = session(async (request) => { if (fail) { fail = false; throw new Error("flaky"); } return flaky.complete(request); });
		const asked = [];
		const ask = async (title, _items, options) => { asked.push(title); if (title === "Project map failed") { assert.equal(options.purpose, "flaky"); return "retry"; } await new Promise((resolve) => options.signal.addEventListener("abort", resolve)); };
		assert.equal(await retrying.maps.gate(repo, { hasUI: true, ask }), "continue");
		assert.deepEqual(asked, ["Building the project map", "Project map failed", "Building the project map"]);
		assert.ok(retrying.maps.section(repo));

		const stuck = fakeModel(); const stuckHold = stuck.hold();
		const bypass = session(stuck.complete);
		assert.equal(await bypass.maps.gate(repo, { hasUI: true, ask: async () => "continue" }), "continue");
		assert.equal(await bypass.maps.gate(repo, { hasUI: true, ask: () => assert.fail("bypassed for the session") }), "continue");
		const cancelled = session(stuck.complete);
		assert.equal(await cancelled.maps.gate(repo, { hasUI: true, ask: async () => "cancel" }), "handled");
		const escaped = session(stuck.complete);
		assert.equal(await escaped.maps.gate(repo, { hasUI: true, ask: async () => undefined }), "handled", "Escape cancels the message");
		const shutdown = new AbortController();
		const closing = session(stuck.complete);
		const closed = closing.maps.gate(repo, { hasUI: true, ask: (_t, _i, options) => new Promise((resolve) => options.signal.addEventListener("abort", () => resolve(undefined))), signal: shutdown.signal });
		shutdown.abort();
		assert.equal(await closed, "handled", "session shutdown releases a held input");
		const late = session(stuck.complete, null, { deadlineMs: 30 });
		assert.equal(await late.maps.gate(repo, {}), "continue", "scope off: deadline never applies");
		const slow = session(stuck.complete, { root: fs.realpathSync(repo), git: true, model: MODEL }, { deadlineMs: 30 });
		assert.match((await slow.maps.gate(repo, {})).error, /longer than/, "headless runs wait with a bounded deadline");
		stuckHold.release(); stuck.free();
		await tick();

		// Disabling a never-mapped project creates no cache.
		const fresh = session(async () => "");
		await fresh.maps.disable(fs.realpathSync(repo));
		assert.equal(fs.existsSync(fresh.mapper.location(repo).dir), false);
	}

	process.stdout.write(`ok - work project map${linked ? "" : " (junction case skipped: could not create one)"}\n`);
} finally {
	fs.rmSync(temp, { recursive: true, force: true });
}
