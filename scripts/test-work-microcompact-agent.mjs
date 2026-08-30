#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import workModelsExtension from "../extensions/work-models.js";

const scenarios = ["idle", "direct"];
const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "..");

function locatePiPackage() {
	const candidates = [
		path.join(repoRoot, "node_modules", "@earendil-works", "pi-coding-agent"),
		process.env.APPDATA
			? path.join(
					process.env.APPDATA,
					"npm",
					"node_modules",
					"@earendil-works",
					"pi-coding-agent",
				)
			: "",
		path.resolve(
			path.dirname(process.execPath),
			"..",
			"lib",
			"node_modules",
			"@earendil-works",
			"pi-coding-agent",
		),
	];
	try {
		const npmRoot = execFileSync(
			process.platform === "win32" ? "npm.cmd" : "npm",
			["root", "-g"],
			{ encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
		).trim();
		candidates.push(path.join(npmRoot, "@earendil-works", "pi-coding-agent"));
	} catch {
		// A normal package install supplies the local peer dependency.
	}
	const found = candidates.find((candidate) =>
		existsSync(path.join(candidate, "dist", "index.js")),
	);
	if (!found)
		throw new Error("pi-coding-agent package is required for this test");
	return found;
}

function ticks(cwd) {
	const file = path.join(cwd, "microcompact-ticks.log");
	if (!existsSync(file)) return [];
	return readFileSync(file, "utf8")
		.trim()
		.split(/\s+/)
		.filter(Boolean)
		.map(Number);
}

function tickCommand(tick) {
	return `echo ${tick} >> microcompact-ticks.log && printf 'result-${tick}-${"x".repeat(5_000)}'`;
}

function waitFor(predicate, label, timeout = 20_000) {
	const started = Date.now();
	return new Promise((resolve, reject) => {
		const check = () => {
			if (predicate()) return resolve();
			if (Date.now() - started >= timeout)
				return reject(new Error(`Timed out waiting for ${label}`));
			setTimeout(check, 20);
		};
		check();
	});
}

function textOf(message) {
	return (message?.content ?? [])
		.filter((part) => part.type === "text")
		.map((part) => part.text)
		.join("\n");
}

function assistantMessage(content, stopReason, inputTokens = 10_000) {
	return {
		role: "assistant",
		content,
		api: "microcompact-fixture",
		provider: "microcompact-fixture",
		model: "microcompact-fixture",
		usage: {
			input: inputTokens,
			output: 10,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: inputTokens + 10,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason,
		timestamp: Date.now(),
	};
}

async function runChild(scenario) {
	assert(scenarios.includes(scenario));
	const cwd = process.cwd();
	const tickLimit = scenario === "direct" ? 24 : 0;
	const piRoot = process.env.CE_MICROCOMPACT_PI_ROOT;
	const pi = await import(
		pathToFileURL(path.join(piRoot, "dist", "index.js")).href
	);
	const ai = await import(
		pathToFileURL(
			path.join(
				piRoot,
				"node_modules",
				"@earendil-works",
				"pi-ai",
				"dist",
				"index.js",
			),
		).href
	);

	execFileSync("git", ["init", "-q"], { cwd });
	execFileSync("git", ["config", "core.autocrlf", "false"], { cwd });
	writeFileSync(path.join(cwd, "README.md"), "microcompact fixture\n");
	writeFileSync(
		path.join(cwd, ".gitignore"),
		".pi/\nagent/\nmicrocompact-ticks.log\n",
	);
	mkdirSync(path.join(cwd, ".pi"), { recursive: true });
	writeFileSync(
		path.join(cwd, ".pi", "settings.json"),
		JSON.stringify({ workOrchestrator: { context: { autoCompact: false } } }),
	);
	execFileSync("git", ["add", "README.md", ".gitignore"], { cwd });
	execFileSync(
		"git",
		[
			"-c",
			"user.name=Microcompact Test",
			"-c",
			"user.email=microcompact@example.invalid",
			"commit",
			"-qm",
			"fixture",
		],
		{ cwd },
	);

	const sessionManager = pi.SessionManager.inMemory(cwd);
	const now = Date.now();
	if (scenario === "direct")
		sessionManager.appendCustomEntry("work-goal-state", {
			goal: {
				id: "stale-goal-fixture",
				mode: "generic",
				objective: "STALE GOAL MUST NOT BECOME THE CURRENT OBJECTIVE",
				status: "paused",
				iteration: 2,
				startedAt: now - 10_000,
				updatedAt: now - 5_000,
			},
		});
	let modelRequests = 0;
	const modelContexts = [];
	const model = {
		id: "microcompact-fixture",
		name: "Microcompact fixture",
		api: "microcompact-fixture",
		provider: "microcompact-fixture",
		baseUrl: "http://fixture.invalid",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 40_000,
		maxTokens: 1_000,
	};
	const fakeStream = (_model, context) => {
		modelRequests += 1;
		const stream = ai.createAssistantMessageEventStream();
		queueMicrotask(() => {
			const latestUser = context.messages.findLast(
				(message) => message.role === "user",
			);
			const hasWorkRequest = context.messages.some((message) =>
				textOf(message).includes("Count from 1 to 24"),
			);
			if (
				!hasWorkRequest &&
				textOf(latestUser).includes("Microcompact fixture warmup")
			) {
				const text = "ready";
				const pending = assistantMessage([], "pending");
				const complete = assistantMessage([{ type: "text", text }], "stop");
				stream.push({ type: "start", partial: pending });
				stream.push({ type: "text_start", contentIndex: 0, partial: pending });
				stream.push({
					type: "text_end",
					contentIndex: 0,
					content: text,
					partial: complete,
				});
				stream.push({ type: "done", reason: "stop", message: complete });
				return;
			}
			const current = ticks(cwd).length + 1;
			const compactSummary = context.messages
				.map(textOf)
				.find((text) => text.includes("ce-workflow compact context"));
			modelContexts.push({
				nextTick: current,
				fillMessages: context.messages.filter((message) =>
					textOf(message).includes(" the the"),
				).length,
				compactionSummaries: context.messages.filter((message) =>
					textOf(message).includes("ce-workflow compact context"),
				).length,
				persistedCompactions: sessionManager
					.getEntries()
					.filter((entry) => entry.type === "compaction").length,
				summaryProfile: compactSummary?.match(/compact context \(([^)]+)\)/)?.[1],
				continuesStaleGoal:
					compactSummary?.includes("Continue the active autonomous goal") ?? false,
				hasCurrentRequest: hasWorkRequest,
				toolResults: context.messages
					.filter((message) => message.role === "toolResult")
					.map((message) => textOf(message).slice(0, 80)),
			});
			if (current <= tickLimit) {
				const toolCall = {
					type: "toolCall",
					id: `tick-${current}-${modelRequests}`,
					name: "bash",
					arguments: { command: tickCommand(current) },
				};
				const pending = assistantMessage([], "pending");
				const complete = assistantMessage([toolCall], "toolUse", 30_000);
				stream.push({ type: "start", partial: pending });
				stream.push({ type: "toolcall_start", contentIndex: 0, partial: pending });
				stream.push({
					type: "toolcall_end",
					contentIndex: 0,
					toolCall,
					partial: complete,
				});
				stream.push({ type: "done", reason: "toolUse", message: complete });
				return;
			}
			const text = "Count complete.";
			const pending = assistantMessage([], "pending");
			const complete = assistantMessage([{ type: "text", text }], "stop");
			stream.push({ type: "start", partial: pending });
			stream.push({ type: "text_start", contentIndex: 0, partial: pending });
			stream.push({
				type: "text_end",
				contentIndex: 0,
				content: text,
				partial: complete,
			});
			stream.push({ type: "done", reason: "stop", message: complete });
		});
		return stream;
	};
	const provider = ai.createProvider({
		id: "microcompact-fixture",
		models: [model],
		auth: {
			apiKey: {
				name: "fixture",
				check: async () => ({ type: "api_key", source: "fixture" }),
				resolve: async () => ({ auth: { apiKey: "fixture" }, source: "fixture" }),
			},
		},
		api: { stream: fakeStream, streamSimple: fakeStream },
	});
	const modelRuntime = await pi.ModelRuntime.create({
		authPath: path.join(cwd, "agent", "auth.json"),
		modelsPath: path.join(cwd, "agent", "models.json"),
	});
	modelRuntime.registerNativeProvider(provider);

	let f8;
	const wrappedWorkModels = (extensionApi) => {
		const api = new Proxy(extensionApi, {
			get(target, property, receiver) {
				if (property === "registerShortcut")
					return (name, config) => {
						if (name === "f8") f8 = config;
						return target.registerShortcut(name, config);
					};
				const value = Reflect.get(target, property, receiver);
				return typeof value === "function" ? value.bind(target) : value;
			},
		});
		workModelsExtension(api);
		extensionApi.registerCommand("__test-f8", {
			description: "Invoke F8 without exposing ctx.compact at the work boundary",
			handler: (_args, ctx) =>
				f8.handler(
					ctx.isIdle?.() === false
						? new Proxy(ctx, {
								get: (target, property) =>
									property === "compact" ? undefined : target[property],
							})
						: ctx,
				),
		});
	};
	const settingsManager = pi.SettingsManager.inMemory({
		compaction: { enabled: false },
	});
	const resourceLoader = new pi.DefaultResourceLoader({
		cwd,
		agentDir: path.join(cwd, "agent"),
		settingsManager,
		extensionFactories: [wrappedWorkModels],
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
	});
	await resourceLoader.reload();
	const { session } = await pi.createAgentSession({
		cwd,
		agentDir: path.join(cwd, "agent"),
		model,
		modelRuntime,
		tools: ["bash"],
		resourceLoader,
		sessionManager,
		settingsManager,
	});
	const notices = [];
	const uiContext = new Proxy(
		{},
		{
			get: (_target, property) => {
				if (property === "notify")
					return (message) => {
						notices.push(message);
						if (process.env.CE_MICROCOMPACT_DEBUG) console.error(message);
					};
				if (["select", "input", "editor", "custom"].includes(property))
					return async () => undefined;
				if (property === "confirm") return async () => false;
				if (property === "onTerminalInput") return () => () => {};
				if (property === "getEditorText") return () => "";
				return () => {};
			},
		},
	);
	await session.bindExtensions({ mode: "rpc", uiContext });

	let compactions = 0;
	let f8At;
	let f8Error;
	const toolCommands = [];
	session.subscribe((event) => {
		if (event.type === "compaction_end" && !event.aborted && event.result)
			compactions += 1;
		if (event.type === "tool_execution_start" && event.toolName === "bash")
			toolCommands.push(event.args.command);
		if (
			event.type === "tool_execution_end" &&
			event.toolName === "bash" &&
			ticks(cwd).length === 3 &&
			f8At === undefined
		) {
			f8At = 3;
			void session.prompt("/__test-f8").catch((error) => {
				f8Error = error;
			});
		}
	});

	await session.prompt(
		"Microcompact fixture warmup: reply ready without tools.",
	);
	await waitFor(() => session.isIdle, "warmup settlement");
	await session.prompt("/wo context-fill");
	await waitFor(
		() =>
			session.messages.some(
				(message) =>
					message.role === "custom" && message.customType === "work-context-fill",
			),
		"hidden context fill",
	);
	const contextFilled = true;
	const fillMessagesBefore = session.messages.filter(
		(message) =>
			message.role === "custom" && message.customType === "work-context-fill",
	).length;
	const requestsBeforeWork = modelRequests;
	if (scenario === "idle") {
		await session.prompt("/__test-f8");
		await waitFor(() => compactions === 1, "idle compaction");
	} else {
		await session.prompt(
			"Count from 1 to 24. For each number, make one separate bash tool call that records the current number, with an LLM pass between calls.",
		);
		await waitFor(() => ticks(cwd).length === tickLimit, "direct count", 60_000);
		await waitFor(() => compactions === 1, "direct compaction");
		await waitFor(() => session.isIdle, "direct settlement");
	}
	if (f8Error) throw f8Error;

	const entries = sessionManager.getEntries();
	const userMessages = session.messages
		.filter((message) => message.role === "user")
		.map(textOf);
	const workGoalStates = entries
		.filter(
			(entry) => entry.type === "custom" && entry.customType === "work-goal-state",
		)
		.map((entry) => entry.data?.goal)
		.filter(Boolean);
	const result = {
		scenario,
		pid: process.pid,
		cwd: realpathSync(cwd),
		contextFilled,
		fillMessagesBefore,
		fillMessagesAfter: session.messages.filter(
			(message) =>
				message.role === "custom" && message.customType === "work-context-fill",
		).length,
		compactions,
		f8At,
		ticks: ticks(cwd),
		toolCommands,
		modelRequests,
		modelContexts,
		requestsBeforeWork,
		userMessages,
		workGoalStates: workGoalStates.map((goal) => ({
			id: goal.id,
			mode: goal.mode,
			status: goal.status,
			objective: goal.objective,
		})),
		notices,
	};
	session.dispose();
	process.stdout.write(`MICROCOMPACT_RESULT ${JSON.stringify(result)}\n`);
}

async function runParent() {
	const piRoot = locatePiPackage();
	const dirs = [];
	try {
		const results = scenarios.map((scenario) => {
			const cwd = mkdtempSync(path.join(tmpdir(), `ce-microcompact-${scenario}-`));
			dirs.push(cwd);
			const output = execFileSync(
				process.execPath,
				[scriptPath, "--child", scenario],
				{
					cwd,
					encoding: "utf8",
					timeout: 90_000,
					env: { ...process.env, CE_MICROCOMPACT_PI_ROOT: piRoot },
				},
			);
			const line = output
				.split(/\r?\n/)
				.find((candidate) => candidate.startsWith("MICROCOMPACT_RESULT "));
			assert(line, `${scenario} child returned a result`);
			return JSON.parse(line.slice("MICROCOMPACT_RESULT ".length));
		});
		for (const [index, result] of results.entries()) {
			assert.equal(result.scenario, scenarios[index]);
			assert.notEqual(
				result.pid,
				process.pid,
				`${result.scenario} used a child agent`,
			);
			assert.equal(result.cwd, realpathSync(dirs[index]));
			assert.equal(result.contextFilled, true);
			assert.equal(result.compactions, 1);
			assert(result.fillMessagesBefore > 0);
			assert(
				result.fillMessagesAfter < result.fillMessagesBefore,
				`${result.scenario} removed obsolete context`,
			);
			assert(
				result.notices.every((notice) => !/microcompaction failed/i.test(notice)),
				`${result.scenario} compacted without fallback`,
			);
		}

		const [idle, direct] = results;
		assert.deepEqual(idle.ticks, []);
		assert.equal(
			idle.modelRequests,
			idle.requestsBeforeWork,
			"idle compaction does not invent work",
		);
		assert.equal(idle.f8At, undefined);

		assert.equal(direct.f8At, 3, "direct work invoked F8 after tick 3");
		assert.deepEqual(
			direct.ticks,
			Array.from({ length: 24 }, (_, index) => index + 1),
		);
		const filtered = direct.modelContexts.find(
			(context) => context.compactionSummaries === 1,
		);
		assert(filtered, "direct work recorded filtered in-work context");
		assert(filtered.nextTick >= 4);
		assert.equal(filtered.persistedCompactions, 0);
		assert(filtered.fillMessages < direct.fillMessagesBefore);
		assert.equal(filtered.hasCurrentRequest, true);
		assert.equal(filtered.toolResults.length, filtered.nextTick - 1);
		const rebased = direct.modelContexts.find(
			(context) =>
				context.nextTick > 14 &&
				context.compactionSummaries === 1 &&
				context.toolResults.length < context.nextTick - 1,
		);
		assert(rebased, "long active work rebased the filtered tail");
		assert(
			rebased.toolResults.at(-1).startsWith(`result-${rebased.nextTick - 1}-`),
			"rebasing retained the latest completed tool result",
		);
		assert.deepEqual(
			direct.toolCommands,
			Array.from({ length: 24 }, (_, index) => tickCommand(index + 1)),
		);
		assert(direct.modelRequests >= 25);
		assert(
			direct.userMessages.every(
				(message) =>
					!message.includes("Continue from the last completed tool boundary") &&
					!message.includes("finish the current work-orchestrator task"),
			),
			"direct work continues without an injected resume prompt",
		);
		const directFilter = direct.modelContexts.find(
			(context) => context.compactionSummaries === 1,
		);
		assert.equal(directFilter.summaryProfile, "freeform");
		assert.equal(directFilter.continuesStaleGoal, false);
		console.log("microcompact filter-and-persist tests passed");
	} finally {
		for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
	}
}

if (process.argv[2] === "--child") await runChild(process.argv[3]);
else await runParent();
