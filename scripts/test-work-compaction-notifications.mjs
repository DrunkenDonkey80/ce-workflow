#!/usr/bin/env node
import assert from "node:assert/strict";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import workModelsExtension, {
	absorbKnowledgeDiscovererCompletion,
	isKnowledgeDiscovererCompletionMessage,
	launchKnowledgeDiscoverer,
} from "../extensions/work-models.ts";

// Replay the delayed wakeups seen after compaction in LPGSlim and ce-workflow
// on 2026-09-08. No provider, child process, or real project mutation is needed.
const cwd = mkdtempSync(path.join(tmpdir(), "ce-compaction-notifications-"));
const hooks = {};
const listeners = new Map();
let aborts = 0;
let launch;
const runId = "43b46a2e-ec06-4f14-b99e-e3f81478d87a";
const pi = {
	on: (name, handler) => {
		hooks[name] = handler;
	},
	registerTool() {},
	registerCommand() {},
	registerShortcut() {},
	events: {
		on(name, handler) {
			listeners.set(name, handler);
			return () => listeners.delete(name);
		},
		emit(name, event) {
			if (name !== "subagents:rpc:v1:request") return;
			try {
				launch = JSON.parse(
					event.params.workflowScript.match(/runs\.run\("main", (.*)\)$/s)[1],
				);
			} catch (error) {
				assert.fail(`Invalid discoverer launch envelope: ${error.message}`);
			}
			listeners.get(`subagents:rpc:v1:reply:${event.requestId}`)({
				success: true,
				data: { runId },
			});
		},
	},
};
const ctx = {
	cwd,
	mode: "tui",
	// Real custom-message delivery has already started the agent: isIdle=false.
	isIdle: () => false,
	getContextUsage: () => ({ tokens: 1 }),
	abort: () => {
		aborts++;
	},
	sessionManager: {
		getSessionId: () => "compaction-test",
		getBranch: () => [],
		getEntries: () => [],
	},
	ui: { notify() {}, setStatus() {}, setWidget() {} },
};
const failure = `Subagent failed: delegate\nRun: ${runId} step 1\nSignal: delegate completed without making edits for an implementation task`;
const notices = [
	{
		role: "custom",
		customType: "subagent_control_notice",
		content: failure,
		details: { event: { runId, reason: "completion_guard" } },
	},
	{
		role: "custom",
		customType: "intercom_message",
		content: `**From subagent-control**\n\n${failure}`,
		details: { from: { id: "subagent-control" }, bodyText: failure },
	},
	...["completed", "failed"].map((status) => ({
		role: "custom",
		customType: "subagent-notify",
		content: `Background task ${status}: **workflow**\nWorkflow run: wrapper-run\nChild runs: main=${runId} (${status})`,
	})),
];
try {
	mkdirSync(path.join(cwd, ".pi"));
	writeFileSync(
		path.join(cwd, ".pi", "settings.json"),
		JSON.stringify({
			workKnowledge: { discoverer: { model: "test/free", thinking: "low" } },
		}),
	);
	workModelsExtension(pi);
	await launchKnowledgeDiscoverer(pi, ctx, [
		{
			role: "user",
			content:
				"Implement the fix. (Historical task, not an extraction instruction.)",
		},
	]);
	for (const message of notices) {
		assert.equal(
			isKnowledgeDiscovererCompletionMessage(message),
			true,
			`${message.customType}: recognize owned failure/success`,
		);
		await hooks.agent_start({}, ctx);
		await hooks.message_start({ message }, ctx);
		await hooks.message_end({ message }, ctx);
		const before = aborts;
		await hooks.before_provider_request({ payload: {} }, ctx);
		assert.equal(
			aborts,
			before + 1,
			`${message.customType}: custom wake bypassing before_agent_start must abort before provider`,
		);
		const filtered = await hooks.context(
			{ messages: [{ role: "user", content: "Completed task." }, message] },
			ctx,
		);
		assert(
			!filtered.messages.includes(message),
			`${message.customType}: internal notice cannot re-enter model context`,
		);
	}
	absorbKnowledgeDiscovererCompletion({ runId, success: false });
	assert(
		notices.every(isKnowledgeDiscovererCompletionMessage),
		"failed runs remain recognized after absorption",
	);
	const unrelated = {
		role: "custom",
		customType: "subagent-notify",
		content: "Background task failed: **workflow**\nWorkflow run: user-run",
	};
	assert(
		!isKnowledgeDiscovererCompletionMessage(unrelated),
		"unrelated failures must remain visible",
	);
	assert(
		!isKnowledgeDiscovererCompletionMessage({
			...notices[3],
			content: `${notices[3].content}\nWorkflow run: user-run`,
		}),
		"mixed workflow batches must remain visible",
	);
	assert(
		!isKnowledgeDiscovererCompletionMessage({
			...notices[3],
			content: `${notices[3].content}\nChild runs: other=user-run (failed)`,
		}),
		"mixed child batches must remain visible",
	);
	assert(
		!isKnowledgeDiscovererCompletionMessage({
			...notices[1],
			details: { from: { id: "real-peer" }, bodyText: failure },
		}),
		"a peer mentioning the job is not an internal control notice",
	);

	for (const batch of [
		[notices[0], unrelated],
		[unrelated, notices[0]],
	]) {
		await hooks.agent_start({}, ctx);
		const before = aborts;
		for (const message of batch) {
			await hooks.message_start({ message }, ctx);
			await hooks.message_end({ message }, ctx);
		}
		await hooks.before_provider_request({ payload: {} }, ctx);
		assert.equal(
			aborts,
			before,
			"mixed custom-message delivery must preserve user-owned wakeups in either order",
		);
	}

	await hooks.before_agent_start(
		{ prompt: "Continue my real direct task", systemPrompt: "base" },
		ctx,
	);
	await hooks.agent_start({}, ctx);
	const busyBefore = aborts;
	for (const message of notices) {
		await hooks.message_start({ message }, ctx);
		await hooks.message_end({ message }, ctx);
		await hooks.before_provider_request({ payload: {} }, ctx);
	}
	assert.equal(
		aborts,
		busyBefore,
		"internal notices cannot interrupt real active work",
	);
	await hooks.before_agent_start(
		{ prompt: "New user request", systemPrompt: "base" },
		ctx,
	);
	await hooks.agent_start({}, ctx);
	await hooks.before_provider_request({ payload: {} }, ctx);
	assert.equal(
		aborts,
		busyBefore,
		"internal guard cannot leak into a later user request",
	);
	assert.equal(
		launch.agent,
		"work-knowledge-discoverer",
		"discovery must not use a mutation-capable delegate",
	);
	const agent = readFileSync(
		new URL("../agents/work-knowledge-discoverer.md", import.meta.url),
		"utf8",
	);
	for (const pattern of [
		/^tools:\s*$/m,
		/^inheritProjectContext: false$/m,
		/^completionGuard: false$/m,
	])
		assert.match(
			agent,
			pattern,
			"discovery has an enforced tool-free read-only contract",
		);
	console.log("ok - compaction internal failure and completion notifications");
} finally {
	await hooks.session_shutdown?.({}, ctx);
	rmSync(cwd, { recursive: true, force: true });
}
