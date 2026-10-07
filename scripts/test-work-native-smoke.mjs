#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
const homedir = os.homedir;
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
// Pi's own installer keeps releases in ~/.pi/agent/install/releases/<version>; newest first.
function piReleasePackages() {
	const dir = path.join(homedir(), ".pi", "agent", "install", "releases");
	try {
		return readdirSync(dir)
			.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
			.map((version) => path.join(dir, version, "node_modules", "@earendil-works", "pi-coding-agent"));
	} catch {
		return []; // Not installed by Pi's installer.
	}
}

const temp = mkdtempSync(path.join(os.tmpdir(), "ce-native-smoke-"));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
const previousAgentDirs = process.env.PI_SUBAGENT_EXTRA_AGENT_DIRS;
process.env.PI_CODING_AGENT_DIR = path.join(temp, "agent");
const npmCli =
	process.env.npm_execpath ??
	(process.platform === "win32"
		? path.join(
				path.dirname(
					execFileSync("where.exe", ["npm.cmd"], { encoding: "utf8" })
						.trim()
						.split(/\r?\n/)[0],
				),
				"node_modules",
				"npm",
				"bin",
				"npm-cli.js",
			)
		: execFileSync("which", ["npm"], { encoding: "utf8" }).trim());
const npmRun = (args, options = {}) =>
	execFileSync(
		npmCli.endsWith(".js") ? process.execPath : npmCli,
		npmCli.endsWith(".js") ? [npmCli, ...args] : args,
		{ cwd: root, encoding: "utf8", ...options },
	);
const git = (cwd, ...args) =>
	execFileSync("git", args, { cwd, encoding: "utf8" });
const initializeGit = (cwd) => {
	git(cwd, "init", "--quiet");
	git(cwd, "config", "user.email", "smoke@example.com");
	git(cwd, "config", "user.name", "Smoke");
};

try {
	const packed = JSON.parse(
		npmRun(["pack", "--json", "--pack-destination", temp]),
	);
	const tarball = path.join(temp, packed[0].filename);
	const host = path.join(temp, "host");
	mkdirSync(host);
	npmRun(
		[
			"install",
			"--prefix",
			host,
			"--ignore-scripts",
			"--no-package-lock",
			"--no-save",
			"--legacy-peer-deps",
			tarball,
		],
		{ cwd: host, stdio: "pipe" },
	);
	const installed = path.join(host, "node_modules", "pi-work-orchestrator");
	assert(existsSync(path.join(installed, "extensions", "work-store.ts")));
	// The extension entry is TypeScript and Node refuses to strip types under
	// node_modules, so load it exactly like Pi does: through Pi's own jiti.
	const piPackage = [...piReleasePackages(), path.join(npmRun(["root", "-g"]).trim(), "@earendil-works", "pi-coding-agent")]
		.map((dir) => path.join(dir, "package.json"))
		.find((file) => existsSync(file));
	assert(piPackage, "pi is not installed (neither Pi's installer releases nor global npm)");
	const { createJiti } = createRequire(piPackage)("jiti");
	const jiti = createJiti(path.join(installed, "extensions", "smoke.mjs"));
	const models = await jiti.import(path.join(installed, "extensions", "work-models.ts"));
	const storeApi = await jiti.import(path.join(installed, "extensions", "work-store.ts"));

	// Real pi-subagents discovery from the packed manifest AND inherited scan roots.
	const subagentsRoot = [path.join(homedir(), ".pi/agent/npm/node_modules/pi-subagents"),
		path.join(npmRun(["root", "-g"]).trim(), "pi-subagents")]
		.find(dir => existsSync(path.join(dir, "src/agents/agents.js")));
	assert(subagentsRoot, "pi-subagents is not installed");
	const { discoverAgents } = await import(pathToFileURL(path.join(subagentsRoot, "src/agents/agents.js")).href);
	mkdirSync(process.env.PI_CODING_AGENT_DIR, { recursive: true });
	writeFileSync(path.join(process.env.PI_CODING_AGENT_DIR, "settings.json"), JSON.stringify({ packages: [installed] }));
	delete process.env.PI_SUBAGENT_EXTRA_AGENT_DIRS;
	const discoveryCwd = path.join(temp, "discovery");
	mkdirSync(discoveryCwd);
	const names = () => discoverAgents(discoveryCwd, "both", undefined, { globalNpmRoot: null }).agents.map(agent => agent.name);
	for (const enabled of [false, true, false]) {
		models.exposeBundledSubagentAgents(enabled);
		const available = names();
		assert(available.includes("oracle") && available.includes("plan3-advisor") && available.includes("context-knowledge-discoverer"));
		assert.equal(available.includes("work-advisor"), enabled, "off/on/off updates actual discovery");
		if (!enabled) assert(!available.some(name => /^(work-|workflow-)/.test(name)), "no legacy roles leak while off");
	}
	delete process.env.PI_SUBAGENT_EXTRA_AGENT_DIRS;

	// Exercise native 200k through Pi's actual installed extension loader/SDK,
	// not the raw-Node fallback used by the unit tests. No provider call is made.
	const sdkRoot = path.dirname(piPackage);
	const { loadExtensions, createExtensionRuntime } = await import(pathToFileURL(path.join(sdkRoot, "dist/core/extensions/loader.js")).href);
	const compactCwd = path.join(temp, "compaction");
	mkdirSync(path.join(compactCwd, ".pi"), { recursive: true });
	writeFileSync(path.join(compactCwd, ".pi/settings.json"), JSON.stringify({ workOrchestrator: { context: { mode: "native-200k" } } }));
	const runtime = createExtensionRuntime();
	runtime.getSettings = () => ({ compaction: { reserveTokens: 16_384, keepRecentTokens: 20_000 } });
	const loaded = await loadExtensions([path.join(installed, "extensions/work-models.ts")], compactCwd, undefined, runtime);
	assert.deepEqual(loaded.errors, [], "installed native SDK extension loads");
	const messages = [
		{ role: "user", content: "Preserve the original request", timestamp: 1 },
		{ role: "assistant", content: [{ type: "text", text: "Original evidence. ".repeat(30_000) }], timestamp: 2 },
		{ role: "user", content: "Latest request", timestamp: 3 },
		{ role: "assistant", content: [{ type: "text", text: "Recent evidence. ".repeat(10_000) }], timestamp: 4 },
	];
	const event = { type: "turn_end", outcome: "completed", message: messages.at(-1), toolResults: [],
		context: { contextMessages: messages, contextEntries: messages.map((message, index) => ({
			sourceEntry: { type: "message", id: `native-${index}`, message }, messages: [message],
		})) } };
	const model = { provider: "test", id: "native", api: "openai-completions", input: ["text"], contextWindow: 500_000, maxTokens: 8192 };
	let nativeCalls = 0, sawRequest = false;
	const nativeWarnings = [];
	// Several extensions handle turn_end (e.g. the Jev compaction note); the compaction handler is the one returning entries.
	const runTurnEnd = async (turn, ctx) => { for (const handler of loaded.extensions[0].handlers.get("turn_end")) { const out = await handler(turn, ctx); if (out) return out; } };
	const result = await runTurnEnd(event, {
		cwd: compactCwd, model, mode: "print", getContextUsage: () => ({ tokens: 200_000 }),
		ui: { setStatus() {}, notify: message => nativeWarnings.push(message) },
		modelRegistry: { streamSimple: (_model, context) => {
			nativeCalls += 1;
			sawRequest ||= JSON.stringify(context).includes("Preserve the original request");
			return { result: async () => ({ role: "assistant", api: model.api, provider: model.provider, model: model.id,
				content: [{ type: "text", text: "Native summary from Pi's generator" }], stopReason: "stop", timestamp: 5,
				usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } }) };
		} },
		sessionManager: { getSessionId: () => "native-compact-smoke", getBranch: () => [] },
		compact() { assert.fail("live-turn compaction must not use the aborting manual API"); },
		abort() { assert.fail("live-turn compaction must not abort"); },
	});
	// ~740 KB exceeds the 500 KB request budget (1 byte per window token), so it is summarized in two chunks.
	assert.equal(nativeCalls, 2, nativeWarnings.join("\n"));
	assert(sawRequest, "chunked summary still includes the original request");
	assert.equal(result.entries[0].summary, "Native summary from Pi's generator");
	assert.equal(result.entries[0].firstKeptEntryId, "native-3");
	assert.equal(result.entries[0].usage.output, 10, "usage summed across chunks");

	// Ultrafull must survive a session reopen as a compaction entry + untouched tail.
	const { SessionManager } = await import(pathToFileURL(path.join(sdkRoot, "dist/core/session-manager.js")).href);
	writeFileSync(path.join(compactCwd, ".pi/settings.json"), JSON.stringify({ workOrchestrator: {
		context: { mode: "ultrafull", compactionModel: "test/summary" },
	} }));
	const fullSession = SessionManager.create(compactCwd, path.join(temp, "sessions"));
	messages.forEach(message => fullSession.appendMessage(message));
	const projection = fullSession.buildSessionProjection();
	let fullCalls = 0;
	const fullResult = await runTurnEnd({ ...event,
		context: { contextMessages: projection.messages, contextEntries: projection.entries },
	}, {
		cwd: compactCwd, model, mode: "print", isIdle: () => false,
		getContextUsage: () => ({ tokens: 200_000 }), sessionManager: fullSession,
		ui: { setStatus() {}, notify: message => nativeWarnings.push(message) },
		modelRegistry: {
			find: (provider, id) => ({ ...model, provider, id }),
			streamSimple(selected) {
				fullCalls++;
				assert.equal(selected.id, "summary");
				return { result: async () => ({ stopReason: "stop", content: [{ type: "text",
					text: JSON.stringify({ checkpoint: "Full checkpoint survives restart", knowledge: [] }) }] }) };
			},
		},
		compact() { assert.fail("Ultrafull must append a boundary checkpoint, not interrupt live tools"); },
		abort() { assert.fail("Ultrafull must not abort"); },
	});
	assert.equal(fullCalls, 1, nativeWarnings.join("\n"));
	const fullDraft = fullResult.entries[0];
	fullSession.appendCompaction(fullDraft.summary, fullDraft.firstKeptEntryId, 200_000, fullDraft.details, true, fullDraft.usage);
	const reopened = SessionManager.open(fullSession.getSessionFile());
	const resumedMessages = reopened.buildSessionContext().messages;
	assert.equal(reopened.getLeafEntry().type, "compaction");
	assert.equal(reopened.getLeafEntry().details.compactionMode, "ultrafull");
	assert.match(resumedMessages.find(message => message.role === "compactionSummary").summary, /Full checkpoint survives restart/);
	assert.deepEqual(resumedMessages.at(-1), messages.at(-1), "retained evidence is not stripped on reload");
	assert(!resumedMessages.some(message => message.content === "Preserve the original request"), "the real checkpoint replaces older messages");

	// Installed Jev tools through Pi's real SDK + codemode: faux main model, fake classifier, no network.
	const sdk = await import(pathToFileURL(path.join(sdkRoot, "dist/index.js")).href);
	// npm nests pi-ai under pi-coding-agent; Pi's installer puts it next to it.
	const aiEntry = [path.join(sdkRoot, "node_modules/@earendil-works/pi-ai/dist/index.js"), path.join(sdkRoot, "../pi-ai/dist/index.js")].find((file) => existsSync(file));
	const ai = await import(pathToFileURL(aiEntry).href);
	const { createJevTools } = await jiti.import(path.join(installed, "extensions/jev-tools.ts"));
	const jevCwd = path.join(temp, "jev");
	mkdirSync(jevCwd);
	writeFileSync(path.join(jevCwd, "Battery.kt"), "val temperature = 24\n");
	const jevModel = { provider: "openrouter", id: "typesafe/jev-1.13", contextWindow: 32000 };
	const jevUsage = { input: 10, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 11, cost: { input: 0.001, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.001 } };
	const classifier = { getModelOfType: () => jevModel, getProviderAuthStatus: () => ({ configured: true }),
		classify: async (m, c) => ({ provider: m.provider, model: m.id, stopReason: "stop", usage: jevUsage,
			answers: Object.fromEntries(Object.keys(c.questions).map(id => [id, { type: "bool", probability: 0.9 }])) }) };
	let jevEnabled = true, jev;
	const jevExtension = pi => { jev = createJevTools({ on: pi.on.bind(pi), registerTool: tool => pi.registerTool({ ...tool,
		execute: (id, args, signal, update, ctx) => tool.execute(id, args, signal, update, { cwd: ctx.cwd, modelRegistry: classifier }) }) },
		() => ({ workOrchestrator: { jev: { enabled: jevEnabled } } })); jev.refresh({ cwd: jevCwd, modelRegistry: classifier }); };
	const faux = ai.fauxProvider({ provider: "faux", models: [{ id: "main", contextWindow: 100000 }] });
	const jevRuntime = await sdk.ModelRuntime.create({ authPath: path.join(temp, "jev-auth.json"), modelsPath: null, refreshOnCreate: false });
	jevRuntime.registerNativeProvider(faux.provider);
	const script = `const r = await tools.jev_triage({jobs:[{id:"a",questions:{rel:{type:"bool",instructions:"Battery data?",criteria:{true:"yes",false:"no"}}},sources:[{path:"Battery.kt"}]}]});\nreturn {status:r.results[0].status, band:r.results[0].answers.rel.band, usageInPayload:"usage" in r};`;
	const loader = new sdk.DefaultResourceLoader({ cwd: jevCwd, agentDir: path.join(temp, "agent"), noExtensions: true, noSkills: true, noPromptTemplates: true,
		noThemes: true, noContextFiles: true, extensionFactories: [sdk.createCodemodeExtension({ models: false }), jevExtension] });
	await loader.reload();
	const { session: jevSession } = await sdk.createAgentSession({ cwd: jevCwd, agentDir: path.join(temp, "agent"), modelRuntime: jevRuntime,
		model: faux.getModel("main"), resourceLoader: loader, sessionManager: sdk.SessionManager.inMemory(jevCwd),
		settingsManager: sdk.SettingsManager.inMemory(), tools: ["codemode", "jev_triage"] });
	const codemodeResults = () => jevSession.messages.filter(m => m.role === "toolResult" && m.toolName === "codemode");
	faux.setResponses([ai.fauxAssistantMessage(ai.fauxToolCall("codemode", { code: script })), ai.fauxAssistantMessage("done")]);
	await jevSession.prompt("classify");
	let viaCodemode = codemodeResults().at(-1);
	assert.match(viaCodemode.content.map(c => c.text).join(""), /"status":"ok","band":"likely","usageInPayload":false/, "codemode receives structuredContent");
	assert.equal(viaCodemode.usage?.totalTokens, 11, "nested classifier usage rolls up once onto the codemode result");
	jevEnabled = false; jev.refresh();
	faux.setResponses([ai.fauxAssistantMessage(ai.fauxToolCall("codemode", { code: script })), ai.fauxAssistantMessage("done")]);
	await jevSession.prompt("classify again");
	viaCodemode = codemodeResults().at(-1);
	assert.equal(viaCodemode.isError, true, "Off hides jev_triage from codemode");
	assert.equal(viaCodemode.usage, undefined);

	const clean = path.join(temp, "clean");
	mkdirSync(clean);
	initializeGit(clean);
	writeFileSync(path.join(clean, ".gitignore"), ".pi/\n");
	assert.equal(models.buildWorkInitState(clean).action, "initialized");
	const brainstorm = models.buildWorkBrainstormState(
		clean,
		"Native smoke product",
	);
	assert(brainstorm.ok && brainstorm.epic.id);
	git(clean, "add", ".gitignore", ".ce-workflow/work-items.json");
	git(clean, "commit", "--quiet", "-m", "initialize native workflow");
	const started = models.buildWorkSmallState(
		clean,
		`${brainstorm.epic.id} Add smoke result`,
	);
	assert(started.ok && started.selectedWorkItem.status === "in_progress");
	// Regression guard: helper commands that dynamically import the TypeScript
	// extension entry must also work from an installed copy under node_modules.
	assert(
		execFileSync(
			process.execPath,
			[path.join(installed, "scripts", "work-helper.mjs"), "initiative-summary"],
			{ cwd: clean, encoding: "utf8" },
		).trim(),
		"initiative-summary printed nothing",
	);
	writeFileSync(
		path.join(clean, "helper-plan.md"),
		"# Native helper plan\n\n## Acceptance\n\n- Installed helper loads the extension.\n",
	);
	const bootstrapped = JSON.parse(
		execFileSync(
			process.execPath,
			[
				path.join(installed, "scripts", "work-helper.mjs"),
				"bootstrap-plan-roadmap",
				"helper-plan.md",
			],
			{ cwd: clean, encoding: "utf8" },
		),
	);
	assert(bootstrapped.roadmap_id, "installed bootstrap printed no roadmap id");
	writeFileSync(path.join(clean, "result.js"), "export const smoke = true;\n");
	execFileSync(
		process.execPath,
		[
			path.join(installed, "scripts", "work-helper.mjs"),
			"work-proof",
			started.selectedWorkItem.id,
			"legacy-inspection",
			"--inspection",
			"Native smoke result inspected.",
			"--result",
			"verified",
		],
		{ cwd: clean, encoding: "utf8" },
	);
	const finish = JSON.parse(
		execFileSync(
			process.execPath,
			[
				path.join(installed, "scripts", "work-helper.mjs"),
				"finish-task",
				started.selectedWorkItem.id,
				"--max-files",
				"2",
				"--message",
				"native smoke",
			],
			{ cwd: clean, encoding: "utf8" },
		),
	);
	assert.equal(finish.status, "PASS");
	assert.equal(
		storeApi.loadStore(clean).items[started.selectedWorkItem.id].status,
		"closed",
	);
	assert.equal(git(clean, "status", "--porcelain=v1"), "");
	assert(!existsSync(path.join(clean, ".beads")));

	const legacy = path.join(temp, "legacy");
	mkdirSync(path.join(legacy, ".beads"), { recursive: true });
	initializeGit(legacy);
	writeFileSync(path.join(legacy, ".gitignore"), ".pi/\n");
	const records = [
		{
			id: "legacy-1",
			issue_type: "epic",
			status: "in_progress",
			title: "Legacy epic",
		},
		{
			id: "legacy-1.1",
			issue_type: "task",
			status: "open",
			title: "Legacy task",
			dependencies: [
				{ issue_id: "legacy-1.1", depends_on_id: "legacy-1", type: "parent-child" },
			],
		},
	];
	writeFileSync(
		path.join(legacy, ".beads", "issues.jsonl"),
		`${records.map(JSON.stringify).join("\n")}\n`,
	);
	assert.match(models.buildWorkStatus(legacy, ""), /migration-required/);
	const migrated = models.buildWorkRemoveBeadsState(legacy);
	assert(migrated.ok && migrated.action === "migrated");
	assert(!existsSync(path.join(legacy, ".beads")));
	assert(models.buildWorkResumeState(legacy, "legacy-1").ok);
	git(legacy, "add", ".gitignore", ".ce-workflow/work-items.json");
	git(legacy, "commit", "--quiet", "-m", "migrate legacy workflow");
	const clone = path.join(temp, "clone");
	git(temp, "clone", "--quiet", legacy, clone);
	assert.match(models.buildWorkStatus(clone, "legacy-1"), /Legacy epic/);
	assert(!existsSync(path.join(clone, ".beads")));

	console.log(
		"native package smoke: PASS clean finish + legacy migration + clone",
	);
} finally {
	if (previousAgentDirs === undefined) delete process.env.PI_SUBAGENT_EXTRA_AGENT_DIRS;
	else process.env.PI_SUBAGENT_EXTRA_AGENT_DIRS = previousAgentDirs;
	if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
	rmSync(temp, {
		recursive: true,
		force: true,
		maxRetries: 5,
		retryDelay: 50,
	});
}
