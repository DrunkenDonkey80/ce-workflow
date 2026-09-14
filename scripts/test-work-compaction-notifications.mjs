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
	excludedModelParked,
	isKnowledgeDiscovererCompletionMessage,
	launchKnowledgeDiscoverer,
	noteExcludedModels,
	stripProcessedImages,
} from "../extensions/work-models.ts";

// Replay the delayed wakeups seen after compaction in LPGSlim and ce-workflow
// on 2026-09-08. No provider, child process, or real project mutation is needed.
const cwd = mkdtempSync(path.join(tmpdir(), "ce-compaction-notifications-"));
const hooks = {};
const listeners = new Map();
let aborts = 0;
let launch;
let workflowScript;
let discovererPayloadScript;
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
				workflowScript = event.params.workflowScript;
				if (!discovererPayloadScript) discovererPayloadScript = workflowScript;
				assert.match(workflowScript, /"agent":"work-knowledge-discoverer"/);
				launch = { agent: "work-knowledge-discoverer" };
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
		{
			role: "assistant",
			content: [
				{
					type: "toolCall",
					id: "img-1",
					name: "read",
					arguments: { path: "C:/x/shot.png" },
				},
			],
		},
		{
			role: "toolResult",
			toolCallId: "img-1",
			toolName: "read",
			content: [
				{ type: "text", text: "Read image file [image/png]" },
				{ type: "image", data: "aGk=" },
			],
		},
		{ role: "assistant", content: [{ type: "text", text: "Analyzed." }] },
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
	assert.match(
		workflowScript,
		/runs\.run\("fallback", task\)/,
		"an unavailable configured model falls back to the parent model",
	);
	assert.equal(
		(workflowScript.match(/"model":/g) ?? []).length,
		1,
		"the inherited fallback must not keep the unavailable model override",
	);
	// A quota-excluded model is parked until its expiry instead of being retried
	// (and failing) ahead of every fallback launch.
	const excluded = (model, detail) => ({
		results: [
			{
				success: false,
				error: {
					message: `Requested subagent model '${model}' is excluded and cannot be replaced by a fallback (${detail}).`,
				},
			},
		],
	});
	assert.equal(
		noteExcludedModels(
			excluded(
				"test/free",
				"reason: limit reached; expires: 2099-01-01T00:00:00.000Z",
			),
		),
		1,
	);
	await launchKnowledgeDiscoverer(pi, ctx, [
		{ role: "user", content: "A later removed turn." },
	]);
	assert.doesNotMatch(
		workflowScript,
		/"model":|runs\.run\("fallback"/,
		"a quota-parked model is skipped instead of re-failing before every fallback",
	);
	noteExcludedModels(excluded("test/hourly", "reason: runtime-failure"), 1_000);
	assert.equal(excludedModelParked("test/hourly", 1_000 + 3_599_000), true);
	assert.equal(
		excludedModelParked("test/hourly", 1_000 + 3_601_000),
		false,
		"an exclusion without an expiry retries once an hour",
	);
	// Consumed image payloads are dropped from outgoing context so they stop
	// being re-sent and re-processed on every turn; live ones keep their payload.
	const imageCall = {
		role: "assistant",
		content: [
			{
				type: "toolCall",
				id: "img-1",
				name: "read",
				arguments: { path: "C:/x/shot.png" },
			},
		],
	};
	const imageResult = {
		role: "toolResult",
		toolCallId: "img-1",
		toolName: "read",
		content: [
			{ type: "text", text: "Read image file [image/png]" },
			{ type: "image", data: "aGk=" },
		],
	};
	const consumed = [
		imageCall,
		imageResult,
		{ role: "assistant", content: [{ type: "text", text: "Analyzed." }] },
		{ role: "user", content: "next" },
	];
	assert.doesNotMatch(
		discovererPayloadScript,
		/"data":"aGk="/,
		"the discoverer payload must not embed image base64",
	);
	assert.match(
		discovererPayloadScript,
		/image payload dropped/,
		"the discoverer payload carries image placeholders",
	);
	const strippedConsumed = stripProcessedImages(consumed);
	assert.equal(strippedConsumed[1].toolCallId, "img-1");
	assert(
		!strippedConsumed[1].content.some((part) => part.type === "image"),
		"a consumed image toolResult loses its image part",
	);
	assert.match(
		strippedConsumed[1].content[1].text,
		/image payload dropped.*C:\/x\/shot\.png/s,
		"the placeholder names the file",
	);
	assert(
		strippedConsumed[1].content.every((part) => part.text?.trim()),
		"no empty content parts survive stripping",
	);
	assert.equal(
		stripProcessedImages(strippedConsumed),
		strippedConsumed,
		"stripping is idempotent",
	);
	assert.equal(
		consumed[1].content[1].type,
		"image",
		"the stored input array is never mutated",
	);
	const imageOnly = [
		imageCall,
		{
			role: "toolResult",
			toolCallId: "img-1",
			toolName: "read",
			content: [{ type: "image", data: "aGk=" }],
		},
		{ role: "assistant", content: [{ type: "text", text: "Analyzed." }] },
	];
	const strippedImageOnly = stripProcessedImages(imageOnly);
	assert.equal(
		strippedImageOnly[1].content.length,
		1,
		"an image-only toolResult keeps exactly one non-empty placeholder",
	);
	assert.match(strippedImageOnly[1].content[0].text, /image payload dropped/);
	const live = [imageCall, imageResult];
	assert.equal(
		stripProcessedImages(live),
		live,
		"an image the model has not yet answered keeps its payload (same reference)",
	);
	// Stamps are size+mtime from the file, frozen at first build: a changed
	// file gets a fresh stamp only through a NEW read (new toolCallId), and an
	// old message's placeholder never mutates again.
	const shotPath = path.join(cwd, "shot.png");
	writeFileSync(shotPath, Buffer.alloc(2048));
	const realCall = (id) => ({
		role: "assistant",
		content: [
			{ type: "toolCall", id, name: "read", arguments: { path: shotPath } },
		],
	});
	const realResult = (id) => ({
		role: "toolResult",
		toolCallId: id,
		toolName: "read",
		content: [{ type: "image", data: "aGk=" }],
	});
	const answered = (rest) => [
		...rest,
		{ role: "assistant", content: [{ type: "text", text: "Analyzed." }] },
	];
	const stampedOnce = stripProcessedImages(
		answered([realCall("img-r1"), realResult("img-r1")]),
	);
	assert.match(
		stampedOnce[1].content[0].text,
		/file 2KB, modified/,
		"the stamp uses file size and mtime",
	);
	writeFileSync(shotPath, Buffer.alloc(4096));
	const stampedTwice = stripProcessedImages(
		answered([
			realCall("img-r1"),
			realResult("img-r1"),
			realCall("img-r2"),
			realResult("img-r2"),
		]),
	);
	assert.match(
		stampedTwice[3].content[0].text,
		/file 4KB/,
		"a re-read after a change stamps the new size",
	);
	assert.equal(
		stampedTwice[1].content[0].text,
		stampedOnce[1].content[0].text,
		"the first stamp is frozen: an old message never mutates again",
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
