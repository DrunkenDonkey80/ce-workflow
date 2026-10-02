#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const temp = mkdtempSync(path.join(os.tmpdir(), "ce-native-smoke-"));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
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
	assert(existsSync(path.join(installed, "extensions", "work-store.js")));
	// The extension entry is TypeScript and Node refuses to strip types under
	// node_modules, so load it exactly like Pi does: through Pi's own jiti.
	const piPackage = path.join(
		npmRun(["root", "-g"]).trim(),
		"@earendil-works",
		"pi-coding-agent",
		"package.json",
	);
	assert(existsSync(piPackage), `pi is not installed globally: ${piPackage}`);
	const { createJiti } = createRequire(piPackage)("jiti");
	const models = await createJiti(
		path.join(installed, "extensions", "smoke.mjs"),
	).import(path.join(installed, "extensions", "work-models.ts"));
	const storeApi = await import(
		pathToFileURL(path.join(installed, "extensions", "work-store.js")).href
	);

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
	const model = { provider: "test", id: "native", api: "openai-completions", input: ["text"], contextWindow: 1_000_000, maxTokens: 8192 };
	let nativeCalls = 0;
	const nativeWarnings = [];
	const result = await loaded.extensions[0].handlers.get("turn_end")[0](event, {
		cwd: compactCwd, model, mode: "print", getContextUsage: () => ({ tokens: 200_000 }),
		ui: { setStatus() {}, notify: message => nativeWarnings.push(message) },
		modelRegistry: { streamSimple: (_model, context) => {
			nativeCalls += 1;
			assert(JSON.stringify(context).includes("Preserve the original request"));
			return { result: async () => ({ role: "assistant", api: model.api, provider: model.provider, model: model.id,
				content: [{ type: "text", text: "Native summary from Pi's generator" }], stopReason: "stop", timestamp: 5,
				usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } }) };
		} },
		sessionManager: { getSessionId: () => "native-compact-smoke", getBranch: () => [] },
		compact() { assert.fail("live-turn compaction must not use the aborting manual API"); },
		abort() { assert.fail("live-turn compaction must not abort"); },
	});
	assert.equal(nativeCalls, 1, nativeWarnings.join("\n"));
	assert.equal(result.entries[0].summary, "Native summary from Pi's generator");
	assert.equal(result.entries[0].firstKeptEntryId, "native-3");
	assert.equal(result.entries[0].usage.output, 5);

	// Ultrafull must survive a session reopen as a compaction entry + untouched tail.
	const { SessionManager } = await import(pathToFileURL(path.join(sdkRoot, "dist/core/session-manager.js")).href);
	writeFileSync(path.join(compactCwd, ".pi/settings.json"), JSON.stringify({ workOrchestrator: {
		context: { mode: "ultrafull", compactionModel: "test/summary" },
	} }));
	const fullSession = SessionManager.create(compactCwd, path.join(temp, "sessions"));
	messages.forEach(message => fullSession.appendMessage(message));
	const projection = fullSession.buildSessionProjection();
	let fullCalls = 0;
	const fullResult = await loaded.extensions[0].handlers.get("turn_end")[0]({ ...event,
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
	if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
	rmSync(temp, {
		recursive: true,
		force: true,
		maxRetries: 5,
		retryDelay: 50,
	});
}
