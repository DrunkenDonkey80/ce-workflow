#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import plan3, { similarity } from "../extensions/plan3.ts";
import { createWorkItem, initStore, mutateStore, storePath } from "../extensions/work-store.ts";

const cwd = await mkdtemp(path.join(os.tmpdir(), "plan3-test-"));
const agentDir = await mkdtemp(path.join(os.tmpdir(), "plan3-agent-"));
process.env.PI_CODING_AGENT_DIR = agentDir;
const commands = new Map(), tools = new Map(), hooks = new Map();
const messages = [], notices = [], events = [], statuses = [];
let entries = [];
let idle = true, tokens = 0, compactions = 0, compactFails = false, compactError = "boom", selectScript = [];
const ctx = {
	cwd,
	hasUI: false,
	isIdle: () => idle,
	model: { provider: "anthropic", id: "claude-opus-5-5" },
	modelRegistry: { getAvailable: async () => ["openai-codex/gpt-6-astra", "anthropic/claude-opus-5-5", "anthropic/claude-opus-4", "zai/glm-5.3"].map((ref) => ({ provider: ref.split("/")[0], id: ref.split("/")[1] })) },
	getContextUsage: () => ({ tokens }),
	compact: ({ onComplete, onError }) => { compactions++; compactFails ? onError(new Error(compactError)) : onComplete({}); },
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
			step[2]?.(labels);
			return label;
		},
	},
};
plan3({
	registerCommand: (name, command) => commands.set(name, command),
	registerTool: (tool) => tools.set(tool.name, tool),
	on: (name, handler) => hooks.set(name, handler),
	events: { emit: (name, data) => events.push({ name, enabled: data.enabled }) },
	appendEntry: (customType, data) => entries.push({ type: "custom", customType, data }),
	sendUserMessage: (message, options) => messages.push({ message, options }),
});
const run = (name, args = "") => commands.get(name).handler(args, ctx);
const tool = async (args) => (await tools.get("plan3").execute("call", args, undefined, undefined, ctx)).details;
const directory = path.join(cwd, "docs", "plans");
const files = async (dir = directory) => (await readdir(dir)).filter((name) => name.endsWith(".md"));
const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, ...gitEnv } });
let gitEnv = {};
const validPlan = (id, title, status, stepsText, extra = "") => `---\nplan3: true\nstatus: ${status}\ncreated: 2026-10-01\nupdated: 2021-01-01T00:00:00.000Z\n${extra}---\n\n# ${title}\n\n## Original request\n\n> ${title} please\n\n## Decisions\n\nNone yet.\n\n## Open questions\n\n### Blocking\n\nNone.\n\n### Deferred\n\nNone.\n\n## Phases\n\n${stepsText}\n\n## Resume context\n\nStart with A-01.\n\n## Amendments\n\n- created\n`;

try {
	const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
	assert(manifest.pi.extensions.includes("extensions/plan3.ts"));
	assert.deepEqual([...commands.keys()], ["plan3", "plans3", "resume3"]);
	assert(tools.has("plan3") && tools.get("plan3").promptSnippet);
	assert.deepEqual(commands.get("plan3").getArgumentCompletions("re").map((item) => item.value), ["review", "review all"]);

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
	assert.match(prompt, /Next: \/plan3 ideas · \/plan3 review · \/plan3 finish$/);
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
	selectScript = [["Plans3", "Fresh", (labels) => { order = labels; }], [ "Fresh", "Force finish"], ["Plans3", "Other work"], ["Other work", "Delete"], ["Delete Other work?", "Cancel"], ["Plans3", "Other work"], ["Other work", "Delete"], ["Delete Other work?", "Delete permanently"], ["Plans3", null]];
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

	console.log("Plan3 command self-checks passed");
} finally {
	await rm(cwd, { recursive: true, force: true });
	await rm(agentDir, { recursive: true, force: true });
}
