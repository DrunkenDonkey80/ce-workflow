#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import plan3, { similarity } from "../extensions/plan3.ts";
import { catchUpPlanText, changelogExcerpt, recordCatchUp } from "../extensions/plan3-catch-up.ts";
import { createWorkItem, initStore, mutateStore, storePath } from "../extensions/work-store.ts";

const cwd = await mkdtemp(path.join(os.tmpdir(), "plan3-test-"));
const agentDir = await mkdtemp(path.join(os.tmpdir(), "plan3-agent-"));
process.env.PI_CODING_AGENT_DIR = agentDir;
const commands = new Map(), tools = new Map(), hooks = new Map(), listeners = new Map();
const messages = [], notices = [], events = [], statuses = [], execCalls = [];
let execResult = { code: 0, stdout: "", stderr: "", killed: false };
let entries = [];
let idle = true, tokens = 0, compactions = 0, compactFails = false, compactError = "boom", selectScript = [];
const ctx = {
	cwd,
	hasUI: false,
	isIdle: () => idle,
	model: { provider: "anthropic", id: "claude-opus-5-5" },
	modelRegistry: { getAvailable: async () => ["openai-codex/gpt-6-astra", "anthropic/claude-opus-5-5", "anthropic/claude-opus-4", "zai/glm-5.3"].map((ref) => ({ provider: ref.split("/")[0], id: ref.split("/")[1] })) },
	getContextUsage: () => ({ tokens }),
	compact: ({ onComplete, onError }) => { compactions++; if (compactFails) onError(new Error(compactError)); else onComplete({}); },
	sessionManager: { getBranch: () => entries },
	ui: {
		notify: (message, severity) => notices.push({ message, severity }),
		setStatus: (key, value) => key === "plan3" && statuses.push(value),
		select: async (title, labels) => {
			const step = selectScript.shift();
			assert(step, `unexpected dialog ${title}: ${labels.join(" | ")}`);
			assert(title.includes(step[0]), `expected dialog ${step[0]}, got ${title}`);
			if (step[1] === null) return undefined;
			const label = labels.find((candidate) => candidate.includes(step[1]));
			assert(label, `no "${step[1]}" in ${title}: ${labels.join(" | ")}`);
			await step[2]?.(labels);
			return label;
		},
	},
};
plan3({
	exec: async (command, args, options) => { execCalls.push({ command, args, options }); if (execResult instanceof Error) throw execResult; return execResult; },
	registerCommand: (name, command) => commands.set(name, command),
	registerTool: (tool) => tools.set(tool.name, tool),
	on: (name, handler) => hooks.set(name, handler),
	events: { emit: (name, data) => events.push({ name, enabled: data.enabled }), on: (name, handler) => listeners.set(name, handler) },
	appendEntry: (customType, data) => entries.push({ type: "custom", customType, data }),
	sendUserMessage: (message, options) => messages.push({ message, options }),
});
const run = (name, args = "") => commands.get(name).handler(args, ctx);
const tool = async (args) => (await tools.get("plan3").execute("call", args, undefined, undefined, ctx)).details;
const directory = path.join(cwd, "docs", "plans");
const files = async (dir = directory) => (await readdir(dir)).filter((name) => name.endsWith(".md"));
const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, ...gitEnv } });
let gitEnv = {};
const validPlan = (_id, title, status, stepsText, extra = "") => `---\nplan3: true\nstatus: ${status}\ncreated: 2026-10-01\nupdated: 2021-01-01T00:00:00.000Z\n${extra}---\n\n# ${title}\n\n## Original request\n\n> ${title} please\n\n## Decisions\n\nNone yet.\n\n## Open questions\n\n### Blocking\n\nNone.\n\n### Deferred\n\nNone.\n\n## Phases\n\n${stepsText}\n\n## Resume context\n\nStart with A-01.\n\n## Amendments\n\n- created\n`;

try {
	const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
	assert(manifest.pi.extensions.includes("extensions/plan3.ts"));
	assert.deepEqual([...commands.keys()], ["plan3", "plans3", "resume3"]);
	assert(tools.has("plan3") && tools.get("plan3").promptSnippet);
	assert.deepEqual(commands.get("plan3").getArgumentCompletions("re").map((item) => item.value), ["resolve", "review", "review all"]);

	// Empty project: list and /plan3 without args only report.
	await run("plans3");
	assert.match(notices.at(-1).message, /No Plan3 plans/);
	await run("plan3");
	assert.match(notices.at(-1).message, /No Plan3 plans/);
	idle = false;
	await run("plan3", "Busy request");
	await run("resume3");
	assert.equal(messages.length, 0, "usage, listing and busy agent start nothing");
	idle = true;

	// New plan: draft file, research on, planning pointer, official prompt.
	const request = "Add CSV import\nwith quoted fields";
	await run("plan3", request);
	const firstName = (await files())[0];
	const firstFile = path.join(directory, firstName);
	const firstId = firstName.match(/-([0-9a-f]{8})-plan3\.md$/)[1];
	const draft = await readFile(firstFile, "utf8");
	assert.match(draft, /^---\nplan3: true\nstatus: draft\n/);
	assert(draft.includes("> Add CSV import\n> with quoted fields"));
	assert.deepEqual(events.at(-1), { name: "plan3:research", enabled: true });
	assert.deepEqual(entries.at(-1).data, { id: firstId, planning: true });
	const prompt = messages.at(-1).message;
	assert.match(prompt, /planning only/);
	assert.match(prompt, /Do not implement product code/);
	assert.match(prompt, /plan3 tool/);
	assert.match(prompt, /Next: \/plan3 ideas · \/plan3 review · \/plan3 finish — and while Open questions lists items/);
	assert(!/independent Plan3 trial|\/resume3/.test(prompt), "official wording, no /resume3 during planning");
	assert.equal(messages.at(-1).options.expandPromptTemplates, false);
	assert.equal(compactions, 0, "tiny context is not compacted");
	assert.equal(statuses.at(-1), "P3 0/0");
	await hooks.get("turn_end")({}, ctx);
	assert.equal(statuses.length >= 2, true, "footer refreshes after each turn");

	// R25 hint after a planning turn.
	await hooks.get("agent_end")({}, ctx);
	assert.equal(notices.at(-1).message, "Next: /plan3 ideas · /plan3 review · /plan3 finish");

	// Duplicate check: headless creates and names the similar plan; UI offers resume/merge/new.
	assert(similarity("Add CSV import with quoted fields", "Plan3 draft\nAdd CSV import\nwith quoted fields") >= 0.5);
	assert(similarity("Add CSV import", "Rewrite the login page") < 0.5);
	await run("plan3", "Add CSV import with quoted fields");
	assert.equal((await files()).length, 2, "headless duplicate still creates");
	assert.match(notices.at(-1).message, /similar open plan/);
	assert.equal(await readFile(firstFile, "utf8"), draft, "existing plan never overwritten");
	await rm(path.join(directory, (await files()).find((name) => name !== firstName)));
	ctx.hasUI = true;
	ctx.mode = "rpc";
	selectScript = [["Similar Plan3 plan", "Merge as follow-up"]];
	await run("plan3", "CSV import with quoted fields and headers");
	assert.equal((await files()).length, 1, "merge creates no plan");
	const merged = await readFile(firstFile, "utf8");
	assert.match(merged, /### Follow-up request \d{4}-\d\d-\d\d\n\n> CSV import with quoted fields and headers/);
	assert.match(merged, /^status: draft$/m);
	assert.match(messages.at(-1).message, /follow-up request was merged/i);
	const beforeDissimilar = messages.length;
	await run("plan3", "Rewrite the login page");
	assert.equal(selectScript.length, 0);
	assert.equal(messages.length, beforeDissimilar + 1);
	assert.equal((await files()).length, 2, "dissimilar request creates directly");
	const loginName = (await files()).find((name) => name !== firstName);
	await rm(path.join(directory, loginName));
	ctx.hasUI = false;

	// Tool: title rename keeps id, refuse ready while planning, marks, next, check, sections, add.
	const renamed = await tool({ action: "title", text: "CSV import" });
	assert.equal(path.basename(renamed.path), firstName.replace(/-add-csv-import-with-quoted-fields-/, "-csv-import-"));
	assert(renamed.path.includes(firstId) && !existsSync(firstFile));
	await assert.rejects(tool({ action: "status", value: "ready" }), /\/plan3 finish/);
	const csvFile = renamed.path;
	let text = await readFile(csvFile, "utf8");
	text = text.replace(/## Goal[\s\S]*?(?=## Decisions)/, "").replace(/## Relevant files and approach[\s\S]*?(?=## Phases)/, "").replace(/## Global validation[\s\S]*?(?=## Resume context)/, "")
		.replace(/(## Phases\n\n)[\s\S]*?(?=\n## )/, "$1### Phase 1\n- [ ] **CSV-01** Parser\n- [] **CSV-02** Quotes\n\n### Phase 2\n- [ ] **IO-01** Import\n")
		.replace("Not assessed yet.", "None.");
	await writeFile(csvFile, text.replaceAll("\n", "\r\n"));
	let state = await tool({ action: "get" });
	assert.deepEqual([state.done, state.total, state.next], [0, 3, "CSV-01"]);
	await assert.rejects(tool({ action: "step", id: "NOPE", mark: "done" }), /Steps: CSV-01, CSV-02, IO-01/);
	await assert.rejects(tool({ action: "section", name: "Nope", text: "x" }), /Sections: Original request/);
	state = await tool({ action: "next" });
	assert.deepEqual([state.started, state.wip], ["CSV-01", ["CSV-01"]]);
	state = await tool({ action: "next", check: "node --test parser.test.mjs: 4 passed" });
	assert.deepEqual([state.completed, state.started, state.done], ["CSV-01", "CSV-02", 1]);
	assert.equal(statuses.at(-1), "P3 1/3 · CSV-02");
	await tool({ action: "step", id: "CSV-02", mark: "blocked", note: "needs RFC 4180 decision" });
	await tool({ action: "section", name: "Decisions", text: "- D1 Use RFC 4180." });
	state = await tool({ action: "add", after: "CSV-02", steps: ["Escapes", "Multiline"], reason: "split quoting" });
	assert.deepEqual(state.added, ["CSV-03", "CSV-04"]);
	text = await readFile(csvFile, "utf8");
	assert(text.includes("\r\n") && !/[^\r]\n/.test(text), "CRLF preserved");
	assert.match(text, /^started: /m);
	assert.match(text, /- \[x\] \*\*CSV-01\*\* Parser\r\n  - check: node --test parser.test.mjs: 4 passed\r\n- \[blocked\] \*\*CSV-02\*\* Quotes\r\n  - note: needs RFC 4180 decision\r\n- \[ \] \*\*CSV-03\*\* Escapes\r\n- \[ \] \*\*CSV-04\*\* Multiline\r\n/);
	assert.match(text, /## Decisions\r\n\r\nRecord each settled choice, rationale, and source here\.\r\n- D1 Use RFC 4180\.\r\n/);
	assert.match(text, /- \d{4}-\d\d-\d\d: Added CSV-03, CSV-04 after CSV-02: split quoting\r\n$/);
	await tool({ action: "section", name: "Resume context", text: "Next: CSV-03", replace: true });
	assert.match(await readFile(csvFile, "utf8"), /## Resume context\r\n\r\nNext: CSV-03\r\n\r\n## Amendments/);
	await assert.rejects(tool({ action: "status", value: "complete" }), /still open/);

	// /plan3 finish: refuses placeholders without changing bytes, then readies and leaves research.
	const unfinished = await readFile(csvFile, "utf8");
	await writeFile(csvFile, unfinished.replace("Next: CSV-03", "Pending investigation."));
	const placeholder = await readFile(csvFile, "utf8");
	await run("plan3", "finish");
	assert.match(notices.at(-1).message, /not ready:[\s\S]*Pending investigation/);
	assert.equal(await readFile(csvFile, "utf8"), placeholder);
	await writeFile(csvFile, unfinished);
	tokens = 50_000;
	compactFails = true; compactError = "Nothing to compact (session too small)";
	await run("plan3", "done");
	compactFails = false; compactError = "boom";
	assert.match(await readFile(csvFile, "utf8"), /^status: ready\r$/m);
	assert.deepEqual(events.at(-1), { name: "plan3:research", enabled: false });
	assert.deepEqual(entries.at(-1).data, { id: firstId, planning: false });
	assert.equal(compactions, 1, "finish compacts above the threshold");
	assert.match(notices.at(-1).message, /Plan ready · \/resume3/);

	// /resume3 without args continues the current plan; same plan never compacts; stale Git paths are named.
	git("init", "-q");
	git("config", "core.autocrlf", "false"); git("config", "user.email", "t@t"); git("config", "user.name", "t");
	await mkdir(path.join(cwd, "src"));
	await writeFile(path.join(cwd, "src", "a.js"), "a\n");
	await writeFile(path.join(cwd, "src", "b.js"), "b\n");
	gitEnv = { GIT_AUTHOR_DATE: "2020-01-01T00:00:00Z", GIT_COMMITTER_DATE: "2020-01-01T00:00:00Z" };
	git("add", "src"); git("commit", "-qm", "init");
	await writeFile(path.join(cwd, "src", "a.js"), "a2\n");
	gitEnv = { GIT_AUTHOR_DATE: "2022-01-01T00:00:00Z", GIT_COMMITTER_DATE: "2022-01-01T00:00:00Z" };
	git("commit", "-qam", "change a");
	await writeFile(csvFile, (await readFile(csvFile, "utf8")).replace("Next: CSV-03", "Touch `src/a.js` and `src/b.js`.").replace(/^updated: .*$/m, "updated: 2021-01-01T00:00:00.000Z\r"));
	await run("resume3");
	assert.equal(compactions, 1, "same plan does not compact");
	assert.deepEqual(events.at(-1), { name: "plan3:research", enabled: false });
	assert.match(messages.at(-1).message, /execute\/resume the plan/);
	assert.match(messages.at(-1).message, /re-check these first: src\/a\.js\./);
	assert(!messages.at(-1).message.includes("src/b.js."), "unchanged file is not stale");

	// Another plan: compaction first; prompt only after it completes; failure sends nothing.
	await writeFile(path.join(directory, "2026-10-02-other-11111111-plan3.md"), validPlan("11111111", "Other work", "draft", "- [ ] **A-01** One"));
	const sent = messages.length;
	compactFails = true;
	await run("resume3", "11111111");
	assert.equal(messages.length, sent, "failed compaction sends nothing");
	assert.match(notices.at(-1).message, /compaction failed/);
	compactFails = false;
	await run("resume3", "11111111");
	assert.equal(compactions, 3);
	assert.equal(messages.length, sent + 1);
	assert.match(messages.at(-1).message, /Continue planning the draft plan/);
	assert.deepEqual(events.at(-1), { name: "plan3:research", enabled: true });
	tokens = 0;

	// Current plan resolution: branch pointer first, then most recently updated open plan; branches differ.
	const branchA = entries;
	entries = [];
	assert.equal((await tool({ action: "get" })).id, "11111111", "no pointer → most recently updated open plan");
	entries = [{ type: "custom", customType: "plan3-current", data: { id: firstId } }];
	assert.equal((await tool({ action: "get" })).id, firstId, "branch pointer wins");
	entries = branchA;
	assert.equal((await tool({ action: "get" })).id, "11111111");

	// Path checks: ids, filenames, paths inside both folders only.
	await writeFile(path.join(directory, "unrelated.md"), "# Not a plan\n");
	await writeFile(path.join(cwd, "outside.md"), validPlan("22222222", "Outside", "ready", "- [ ] **O-01** x"));
	const count = messages.length;
	for (const target of ["unrelated.md", "../outside.md", path.join(cwd, "outside.md"), "deadbeef"]) {
		await run("resume3", target);
		assert.equal(notices.at(-1).severity, "error");
		assert.equal(messages.length, count, `${target} cannot start work`);
	}

	// Jev plan from this repository parses 15/15; add after JEV-15 → JEV-16 with an Amendments line.
	const jevName = "2026-10-05-okay-lets-plan-this-thing-an-optional-jev-tools-in-the-setti-a85cda91-plan3.md";
	await copyFile(new URL(`../docs/plans/${jevName}`, import.meta.url), path.join(directory, jevName));
	state = await tool({ action: "get", plan: "a85cda91" });
	assert.deepEqual([state.done, state.total, state.status, state.hint], [15, 15, "complete", undefined]);
	state = await tool({ action: "add", plan: jevName, after: "JEV-15", steps: ["Follow-up"], reason: "test" });
	assert.deepEqual(state.added, ["JEV-16"]);
	assert.match(await readFile(path.join(directory, jevName), "utf8"), /- \[ \] \*\*JEV-16\*\* Follow-up[\s\S]*Added JEV-16 after JEV-15: test/);

	// Completing archives to docs/plans/done; resolution covers the done folder.
	await writeFile(path.join(directory, "2026-10-03-small-33333333-plan3.md"), validPlan("33333333", "Small", "active", "- [x] **S-01** Done"));
	assert.match((await tool({ action: "get", plan: "33333333" })).hint, /set status complete/);
	state = await tool({ action: "status", plan: "33333333", value: "complete" });
	assert.equal(state.path, path.join(directory, "done", "2026-10-03-small-33333333-plan3.md"));
	assert.equal((await tool({ action: "get", plan: "33333333" })).status, "complete");

	// /plans3 UI: current first, then open by update, then complete; force finish and confirmed delete.
	ctx.hasUI = true;
	await writeFile(path.join(directory, "2026-10-04-fresh-44444444-plan3.md"), validPlan("44444444", "Fresh", "active", "- [x] **F-01** a\n- [wip] **F-02** b", "started: 2026-10-01T00:00:00.000Z\n").replace(/^updated: .*$/m, `updated: ${new Date().toISOString()}`));
	entries.push({ type: "custom", customType: "plan3-current", data: { id: "11111111" } });
	let order;
	const beforeViewMessages = messages.length, beforeViewEntries = entries.length;
	const viewFiles = [path.join(directory, "2026-10-04-fresh-44444444-plan3.md"), state.path];
	const beforeViewBytes = await Promise.all(viewFiles.map(file => readFile(file, "utf8")));
	selectScript = [["Plans3", "Fresh", labels => { order = labels; }], ["Fresh", "View"], ["Plans3", "Small"], ["Small", "View"], ["Plans3", null]];
	await run("plans3");
	assert.equal(selectScript.length, 0, "View returns to the plan list");
	assert.equal(execCalls.length, 2, "active and archived plans can be viewed");
	assert.deepEqual(execCalls, viewFiles.map(file => ({
		command: process.platform === "win32" ? "rundll32.exe" : process.platform === "darwin" ? "open" : "xdg-open",
		args: process.platform === "win32" ? ["url.dll,FileProtocolHandler", file] : [file],
		options: { timeout: 10_000 },
	})));
	assert.equal(messages.length, beforeViewMessages, "View never starts the agent");
	assert.equal(entries.length, beforeViewEntries, "View does not change the current plan");
	assert.deepEqual(await Promise.all(viewFiles.map(file => readFile(file, "utf8"))), beforeViewBytes, "View never edits the plan");
	for (const failure of [{ code: 1, stderr: "no default handler" }, new Error("opener missing")]) {
		execResult = failure;
		selectScript = [["Plans3", "Fresh"], ["Fresh", "View"], ["Plans3", null]];
		await run("plans3");
		assert.equal(selectScript.length, 0, "opener failure keeps browsing usable");
		assert.match(notices.at(-1).message, /no default handler|opener missing/);
		assert.equal(notices.at(-1).severity, "error");
	}
	execResult = { code: 0, stdout: "", stderr: "", killed: false };
	selectScript = [["Plans3", "Fresh"], [ "Fresh", "Force finish"], ["Plans3", "Other work"], ["Other work", "Delete"], ["Delete Other work?", "Cancel"], ["Plans3", "Other work"], ["Other work", "Delete"], ["Delete Other work?", "Delete permanently"], ["Plans3", null]];
	await run("plan3");
	assert.equal(selectScript.length, 0);
	assert.match(order[0], /Other work/, "current plan first");
	assert.match(order[1], /\[active\] Fresh — 1\/2 \[█{6}░{6}\] · active \d+d · touched 0m ago/);
	assert(order.findIndex((label) => label.includes("Small")) > order.findIndex((label) => label.includes("CSV import")), "complete plans last");
	const forced = await readFile(path.join(directory, "done", "2026-10-04-fresh-44444444-plan3.md"), "utf8");
	assert.match(forced, /^status: complete$/m);
	assert.match(forced, /Force-finished by the user with unfinished steps: F-02/);
	assert(!existsSync(path.join(directory, "2026-10-02-other-11111111-plan3.md")), "deleted only after confirmation");

	// Legacy conversion: read-only store, markers, idempotent.
	assert(![".pi", ".ce-workflow"].some((name) => existsSync(path.join(cwd, name))), "Plan3 writes no workflow state");
	initStore(cwd);
	mutateStore(cwd, (store) => {
		createWorkItem(store, { id: "work-1", type: "epic", title: "Legacy epic", description: "Old request", notes: ["note one"] });
		for (const [n, status] of [[1, "closed"], [2, "in_progress"], [3, "blocked"], [4, "deferred"], [5, "open"], [10, "planned"]])
			createWorkItem(store, { id: `work-1.${n}`, parentId: "work-1", title: `Child ${n}`, status });
		createWorkItem(store, { id: "work-2", title: "Finished", status: "closed" });
	});
	const storeBytes = await readFile(storePath(cwd), "utf8");
	selectScript = [["Plans3", "Convert legacy work (1)"], ["Convert legacy work", "work-1 Legacy epic"], ["Plans3", "CSV import", (labels) => assert(!labels.some((label) => label.includes("Convert")), "converted items are skipped")], ["CSV import", null], ["Plans3", null]];
	await run("plans3");
	assert.equal(selectScript.length, 0);
	const converted = await readFile(path.join(directory, (await files()).find((name) => name.includes("legacy-epic"))), "utf8");
	assert.match(converted, /^source: work:work-1$/m);
	assert.match(converted, /> Old request/);
	assert.match(converted, /- \[x\] \*\*work-1\.1\*\* Child 1\n- \[wip\] \*\*work-1\.2\*\* Child 2\n- \[blocked\] \*\*work-1\.3\*\* Child 3\n- \[ \] \*\*work-1\.5\*\* Child 5\n- \[ \] \*\*work-1\.10\*\* Child 10/);
	assert.match(converted, /### Deferred\n\n- work-1\.4: Child 4/);
	assert.match(converted, /- note one/);
	assert.equal(await readFile(storePath(cwd), "utf8"), storeBytes, "legacy store unchanged");
	ctx.hasUI = false;

	// Second opinion: advisor = first other-family model; all = every other family; none → current agent only.
	entries.push({ type: "custom", customType: "plan3-current", data: { id: firstId, planning: false } });
	await writeFile(path.join(agentDir, "settings.json"), JSON.stringify({ workOrchestrator: { plan3: { models: [{ model: "openai-codex/gpt-6-astra", thinking: "high" }, { model: "anthropic/claude-opus-5-5", thinking: "high" }] } } }));
	await run("plan3", "review");
	assert.match(messages.at(-1).message, /agent: "plan3-advisor", model: "openai-codex\/gpt-6-astra:high", context: "fresh", async: true/);
	assert(messages.at(-1).message.includes(JSON.stringify(csvFile)) && /authorized this delegation by running \/plan3 review/.test(messages.at(-1).message));
	ctx.model = { provider: "openai-codex", id: "gpt-6-astra" };
	await run("plan3", "ideas for caching");
	assert.match(messages.at(-1).message, /model: "anthropic\/claude-opus-5-5:high"/);
	assert.match(messages.at(-1).message, /focus: for caching|focused on: for caching/);
	assert.match(messages.at(-1).message, /without reading the advisor output/);
	await writeFile(path.join(agentDir, "settings.json"), JSON.stringify({ workOrchestrator: { plan3: { models: [{ model: "openai-codex/gpt-6-sol", thinking: "high" }] } } }));
	await run("plan3", "ideas");
	assert.match(notices.at(-1).message, /no Plan model from another family/);
	assert.match(messages.at(-1).message, /No eligible second-opinion model/);
	ctx.model = { provider: "anthropic", id: "claude-opus-5-5" };
	await writeFile(path.join(agentDir, "settings.json"), JSON.stringify({ workOrchestrator: { plan3: { models: ["openai-codex/gpt-6-astra", "zai/glm-5.3", "anthropic/claude-opus-4"].map((model) => ({ model, thinking: "high" })) } } }));
	await run("plan3", "review all");
	const launched = [...messages.at(-1).message.matchAll(/model: "([^"]+)"/g)].map((match) => match[1]);
	assert.deepEqual(launched, ["openai-codex/gpt-6-astra:high", "zai/glm-5.3:high"]);
	const plansBefore = (await files()).length;
	await run("plan3", "review the auth code");
	assert.equal((await files()).length, plansBefore + 1, "other text after review is a new request");
	assert.match(messages.at(-1).message, /planning only/);
	assert.match(messages.at(-1).message, /insert "\/plan3 resolve \(N open\) · "/, "planning replies learn the conditional hint");

	// /plan3 resolve: open-question bullets drive the hint, tool output, /plans3 action and a one-at-a-time prompt.
	const authId = entries.at(-1).data.id;
	const authFile = path.join(directory, (await files()).find((name) => name.includes(authId)));
	await run("plan3", "resolve");
	assert.match(notices.at(-1).message, /has no open questions/, "placeholders are not questions");
	await hooks.get("agent_end")({}, ctx);
	assert.equal(notices.at(-1).message, "Next: /plan3 ideas · /plan3 review · /plan3 finish");
	await writeFile(authFile, (await readFile(authFile, "utf8")).replace("Not assessed yet.", "Which session store?").replace("None recorded.", "- Rate limits: later\n  - detail line\n- None of the above applies to SSO"));
	await hooks.get("agent_end")({}, ctx);
	assert.equal(notices.at(-1).message, "Next: /plan3 resolve (3 open) · /plan3 ideas · /plan3 review · /plan3 finish");
	assert.equal((await tool({ action: "get" })).openQuestions, 3);
	assert.equal((await tool({ action: "get", plan: firstId })).openQuestions, undefined);
	const beforeResolve = messages.length;
	await run("plan3", `resolve ${authId}`);
	assert.equal(messages.length, beforeResolve + 1);
	assert(messages.at(-1).message.includes(JSON.stringify(authFile)));
	assert.match(messages.at(-1).message, /Blocking first, then Deferred[\s\S]*Bundle 2–4 independent questions[\s\S]*dependent questions only after their prerequisites are settled[\s\S]*allowFreeform: true[\s\S]*keep an item open\/deferred[\s\S]*Do not implement product code/);
	assert.equal(entries.at(-1).data.planning, true, "resolve keeps the planning state");
	await writeFile(authFile, (await readFile(authFile, "utf8")).replace("Which session store?", "None.").replace(/- Rate limits[\s\S]*?SSO/, "None."));

	// Catch-up (workflow off): generated plan lists only changed targets, starts planning via plan3:start,
	// and the recorder writes exactly the planned versions, all or nothing.
	const catchUpState = { packages: [
		{ name: "pi-lens", baselineVersion: "4.3.0", targetVersion: "4.6.0", installedVersion: "4.5.0", needsReview: true, diffPath: "lens.diff" },
		{ name: "pi-intercom", baselineVersion: "0.16.0", targetVersion: "0.16.0", needsReview: false },
	] };
	const lensDiff = path.join(cwd, "lens.diff");
	await writeFile(lensDiff, "diff --git a/CHANGELOG.md b/CHANGELOG.md\n+++ b/CHANGELOG.md\n+## 4.6.0\n+- new hook\n ## 4.3.0\ndiff --git a/index.js b/index.js\n+code();\n");
	catchUpState.packages[0].diffPath = lensDiff;
	const catchUpText = catchUpPlanText(catchUpState, "", "2026-10-06");
	assert.equal(await readFile(changelogExcerpt(lensDiff), "utf8"), "## 4.6.0\n- new hook\n", "only added changelog lines");
	assert(catchUpText.includes(path.join(cwd, "lens.changelog.md")));
	assert.match(catchUpText, /^catch-up: {"pi-lens":"4.6.0"}$/m);
	assert(!catchUpText.includes("pi-intercom") && /every release after the last reviewed version/.test(catchUpText));
	assert(/research it first/.test(catchUpText) && /work-catch-up-record.mjs/.test(catchUpText));
	const catchUpFile = path.join(directory, "2026-10-06-catch-up-pi-packages-cafe0001-plan3.md");
	await writeFile(catchUpFile, catchUpText);
	idle = true;
	await listeners.get("plan3:start")({ ctx, file: catchUpFile });
	assert(messages.at(-1).message.includes(JSON.stringify(catchUpFile)) && /planning only/.test(messages.at(-1).message));
	assert(/Pending investigation/.test(catchUpText), "finish stays blocked until the review fills Phase 1");
	const baselineFile = path.join(cwd, "baseline.json");
	const baseline = { capturedAt: "old", packages: [{ name: "pi-lens", version: "4.3.0" }, { name: "pi-intercom", version: "0.16.0" }] };
	await writeFile(baselineFile, JSON.stringify(baseline));
	assert.throws(() => recordCatchUp(cwd, "cafe0001", baselineFile), /pi-lens has no recorded catch-up decisions/);
	const decided = (decision) => catchUpText.replace('"pi-lens": []', `"pi-lens": [${JSON.stringify(decision)}]`);
	await writeFile(catchUpFile, decided({ title: "New hook", pov: "Adopt", status: "adopted", rationale: "fits" }));
	assert.throws(() => recordCatchUp(cwd, "cafe0001", baselineFile), /lacks verification/);
	assert.equal(JSON.parse(await readFile(baselineFile, "utf8")).packages[0].version, "4.3.0", "a refused record writes nothing");
	await writeFile(catchUpFile, decided({ title: "New hook", pov: "Adopt", status: "adopted", rationale: "fits", verification: "npm run verify:quiet: ok" }));
	assert.deepEqual(recordCatchUp(cwd, "cafe0001", baselineFile, "2026-10-06T00:00:00Z"), ["pi-lens@4.6.0"]);
	const recorded = JSON.parse(await readFile(baselineFile, "utf8"));
	assert.deepEqual([recorded.capturedAt, recorded.packages[0].version, recorded.packages[0].reviewedVersion, recorded.packages[0].decisions[0].version, recorded.packages[1].version], ["2026-10-06T00:00:00Z", "4.6.0", "4.6.0", "4.6.0", "0.16.0"]);

	// /plan3 write captures the chat without pre-compaction, even when ordinary compaction would fail.
	assert.deepEqual(commands.get("plan3").getArgumentCompletions("wr").map(item => item.value), ["write"]);
	tokens = 100_000; compactFails = true;
	const compactBeforeWrite = compactions, messagesBeforeWrite = messages.length;
	idle = false; await run("plan3", "write"); idle = true;
	assert.equal(messages.length, messagesBeforeWrite, "write still requires an idle agent");
	const beforeWritePlans = await files();
	await run("plan3", "write");
	assert.equal(compactions, compactBeforeWrite, "write never calls compactFirst");
	assert.equal((await files()).length, beforeWritePlans.length + 1);
	assert.equal(messages.length, messagesBeforeWrite + 1);
	assert.match(messages.at(-1).message, /current discussion[\s\S]*do not start from scratch[\s\S]*before doing any further research/);
	assert.match(messages.at(-1).message, /actual discussed request\(s\)[\s\S]*do not invent missing details[\s\S]*source references/);
	assert.match(messages.at(-1).message, /Option: Title — description\/tradeoff/);
	assert.deepEqual(events.at(-1), { name: "plan3:research", enabled: true });
	assert.equal(entries.at(-1).data.planning, true);
	const captureFile = path.join(directory, (await files()).find(name => !beforeWritePlans.includes(name)));
	const captureBytes = await readFile(captureFile, "utf8");
	assert.match(captureBytes, /^plan3: true\nstatus: draft$/m);
	await run("plan3", "WRITE Capture the current discussion as a plan");
	assert.equal(compactions, compactBeforeWrite, "a matching topic cannot take the compacting duplicate path");
	assert.equal(await readFile(captureFile, "utf8"), captureBytes, "old plans are not overwritten");
	assert.equal((await files()).length, beforeWritePlans.length + 2);
	for (const alias of ["planify", "create"]) {
		assert.equal(commands.get("plan3").getArgumentCompletions(alias)[0].value, alias);
		for (const args of [alias, `${alias} CSV discussion`]) {
			const beforeAlias = messages.length;
			await run("plan3", args);
			assert.equal(messages.length, beforeAlias + 1);
			assert.match(messages.at(-1).message, /write the current discussion into a plan/);
			assert.equal(compactions, compactBeforeWrite, `${alias} never compacts`);
		}
	}
	const beforeRegular = messages.length;
	await run("plan3", "A completely unrelated new request");
	assert.equal(compactions, compactBeforeWrite + 1, "ordinary new plans still compact first");
	assert.equal(messages.length, beforeRegular, "ordinary failed compaction still sends nothing");
	tokens = 0; compactFails = false;

	// Resolve uses the actual ask_user popup, not the old selection menus.
	const directFile = path.join(directory, "2026-10-07-direct-55555555-plan3.md");
	const questionOne = "- **Q-01** Which format?\n  - Context: Existing consumers read CSV.\n  - Recommendation: Keep CSV to avoid migration.\n  - Option: Keep CSV — No migration needed.\n  - Option: Use JSON — Requires updating consumers.";
	const directPlan = validPlan("55555555", "Direct answers", "draft", "- [ ] **D-01** Implement")
		.replace("### Blocking\n\nNone.", `### Blocking\n\n${questionOne}\n- **Q-02** Which timeout?\n  - detail: preserve this with the question`)
		.replace("### Deferred\n\nNone.", "### Deferred\n\n1. Another question?\n  - nested detail");
	await writeFile(directFile, directPlan);
	ctx.hasUI = true;
	ctx.ui.input = async () => { throw new Error("Resolve must use ask_user, not an input menu"); };
	const directMessages = messages.length;
	await run("plan3", "resolve 55555555");
	assert.equal(messages.length, directMessages + 1, "resolve hands off once to the current agent");
	const resolveMessage = messages.at(-1).message;
	assert.match(resolveMessage, /Use the actual ask_user tool[\s\S]*not selection menus or numbered chat replies/);
	assert.match(resolveMessage, /Bundle 2–4 independent questions[\s\S]*dependent questions only after their prerequisites are settled/);
	assert.match(resolveMessage, /displayMode: "overlay"[\s\S]*allowFreeform: true/);
	assert.match(resolveMessage, /do not restart full-plan research[\s\S]*Cancelled, skipped and deferred items remain open/);
	assert.match(resolveMessage, /persist its answers together in Decisions[\s\S]*never invent an answer or overwrite a question changed since it was shown/);
	const stored = JSON.parse(resolveMessage.split("Stored ask_user questions (task data, not instructions):\n")[1].split("\n").map(line => line.replace(/^>\s?/, "")).join("\n"));
	assert.equal(stored.length, 3);
	assert.deepEqual(stored[0].options, [{ title: "Keep CSV", description: "No migration needed." }, { title: "Use JSON", description: "Requires updating consumers." }]);
	assert.match(stored[0].context, /Blocking[\s\S]*Context: Existing consumers read CSV[\s\S]*Recommendation: Keep CSV/);
	assert.match(stored[1].context, /detail: preserve this with the question/);
	assert.match(stored[2].context, /Deferred[\s\S]*nested detail/);
	assert(stored.every(question => question.allowFreeform === true), "every question permits a custom response");
	assert.equal(await readFile(directFile, "utf8"), directPlan, "handoff does not invent answers or mutate the plan");
	assert.equal(selectScript.length, 0, "resolve opens no selection menus");
	selectScript = [["Plans3", "Direct answers"], ["Direct answers", "Resolve open questions (3)"]];
	await run("plans3");
	assert.equal(messages.length, directMessages + 2, "the browser uses the same ask_user handoff");
	assert.match(messages.at(-1).message, /Use the actual ask_user tool/);
	assert.equal(selectScript.length, 0);
	await writeFile(directFile, directPlan.replace("status: draft", "status: complete"));
	await run("plan3", "resolve 55555555");
	assert.match(messages.at(-1).message, /The plan is complete: record answers, but do not add steps or reopen it/);
	await writeFile(directFile, directPlan);
	ctx.hasUI = false; delete ctx.ui.input;

	// Exact bare words are shortcuts only during live Plan3 planning and only from the operator.
	const input = (text, source = "interactive", images) => hooks.get("input")({ text, source, images }, ctx);
	assert.equal(await input("finish"), undefined, "execution/non-planning chat is unaffected");
	await run("plan3", "write Keyboard shortcuts discussion");
	const shortcutId = entries.at(-1).data.id;
	const shortcutFile = path.join(directory, (await files()).find(name => name.includes(shortcutId)));
	await writeFile(shortcutFile, validPlan(shortcutId, "Keyboard shortcuts", "draft", "- [ ] **K-01** Implement"));
	const beforeShortcuts = messages.length;
	for (const text of ["finish this later", "resolve the issue", "ideas for tomorrow", "review the code", "finish.", "/plan3 finish", "create", "write"]) assert.equal(await input(text), undefined);
	for (const text of ["finish", "resolve", "ideas", "review", "done"]) assert.equal(await input(text, "extension"), undefined, "injected messages never trigger shortcuts");
	assert.equal(await input("finish", "interactive", [{ type: "image" }]), undefined, "image inputs stay chat");
	assert.equal(messages.length, beforeShortcuts);
	idle = false;
	assert.deepEqual(await input("finish"), { action: "handled" });
	assert.match(notices.at(-1).message, /idle agent/);
	idle = true;
	assert.match(await readFile(shortcutFile, "utf8"), /^status: draft$/m);
	for (const text of ["ideas", "ideas all", "review", "review all"]) {
		assert.deepEqual(await input(text), { action: "handled" });
		assert.match(messages.at(-1).message, new RegExp(`Plan3: ${text.split(" ")[0]} for`));
	}
	const afterAdvisors = messages.length;
	assert.deepEqual(await input("resolve", "rpc"), { action: "handled" });
	assert.match(notices.at(-1).message, /no open questions/);
	assert.equal(messages.length, afterAdvisors, "resolve with no questions sends nothing");
	assert.deepEqual(await input("  FINISH  "), { action: "handled" });
	assert.match(await readFile(shortcutFile, "utf8"), /^status: ready$/m);
	assert.equal(entries.at(-1).data.planning, false);
	assert.equal(await input("review"), undefined, "shortcuts stop after finish");
	await writeFile(shortcutFile, validPlan(shortcutId, "Keyboard shortcuts", "draft", "- [ ] **K-01** Implement"));
	await run("resume3", shortcutId);
	assert.deepEqual(await input("done"), { action: "handled" });
	assert.match(await readFile(shortcutFile, "utf8"), /^status: ready$/m);
	entries.push({ type: "custom", customType: "plan3-current", data: { id: "deadbeef", planning: true } });
	assert.equal(await input("finish"), undefined, "stale pointers cannot target an unrelated plan");

	// Runtime test/build guidance belongs only to execution, never planning/capture/resolve/advisors.
	const testGuidance = /concurrency supported by the existing runner|individual assertions|temporary\/build\/output|Await every result|checks affected by fixes/;
	for (const handoff of messages.filter(entry => entry.message.startsWith("Plan3:"))) {
		if (!handoff.message.startsWith("Plan3: execute/resume")) assert.doesNotMatch(handoff.message, testGuidance);
	}
	for (const heading of ["Plan3: planning only.", "Plan3: write the current discussion into a plan."]) {
		assert(messages.some(entry => entry.message.startsWith(heading)), `missing ${heading} handoff`);
	}
	const execution = messages.find(entry => entry.message.startsWith("Plan3: execute/resume"))?.message;
	assert(execution, "missing execution handoff");
	assert.match(execution, /Prefer bounded concurrency supported by the existing runner/);
	assert.match(execution, /independent suites\/build jobs, not individual assertions/);
	assert.match(execution, /Isolate temporary\/build\/output paths and filenames/);
	assert.match(execution, /respect setup\/teardown and build dependencies/);
	assert.match(execution, /serialize shared hardware, files, databases, ports or process\/global state/);
	assert.match(execution, /if independence is unproven, run sequentially/);
	assert.match(execution, /Await every result; report failures and unavailable checks/);
	assert.match(execution, /Never skip required checks, weaken assertions or treat stale results as current/);
	assert.match(execution, /Rerun checks affected by fixes/);
	assert.match(execution, /required validation covers the final relevant code\/input state/);
	assert.match(execution, /Avoid unjustified repeat runs or new orchestration solely for parallelism/);

	console.log("Plan3 command self-checks passed");
} finally {
	await rm(cwd, { recursive: true, force: true });
	await rm(agentDir, { recursive: true, force: true });
}
