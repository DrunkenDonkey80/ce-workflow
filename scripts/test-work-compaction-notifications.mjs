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
	buildBoundaryCompaction,
	excludedModelParked,
	isKnowledgeDiscovererCompletionMessage,
	launchKnowledgeDiscoverer,
	noteExcludedModels,
	requestContextFilter,
	researchCompactionTrigger,
	resetContextFilter,
	stripProcessedPayloads,
	summarizeNativeContext,
	workSubagentToolCall,
} from "../extensions/work-models.ts";

// Replay the delayed wakeups seen after compaction in LPGSlim and ce-workflow
// on 2026-09-08. No provider, child process, or real project mutation is needed.
const cwd = mkdtempSync(path.join(tmpdir(), "ce-compaction-notifications-"));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = path.join(cwd, "agent");
const scriptPath = path.join(cwd, "guard-workflow.js");
writeFileSync(scriptPath, 'return runs.run("review", { agent: "work-reviewer" })');
assert.equal(workSubagentToolCall({ toolName: "subagent", input: { workflow: "./guard-workflow.js" } }, { cwd }), true);
assert.equal(workSubagentToolCall({ toolName: "subagent", input: { workflow: ".\\\\guard-workflow.js" } }, { cwd }), true);
assert.equal(workSubagentToolCall({ toolName: "subagent", input: { workflow: "./missing.js" } }, { cwd }), true);
const workflowContext = text => ({ cwd, sessionManager: { getBranch: () => [{ message: { role: "assistant", content: [{ type: "text", text }] } }] } });
assert.equal(workSubagentToolCall({ toolName: "subagent", input: { workflow: true } }, workflowContext('```js workflow\nreturn runs.run("review", {"agent":"work-reviewer"})\n```')), true);
assert.equal(workSubagentToolCall({ toolName: "subagent", input: { workflow: true } }, workflowContext('```js workflow\nreturn runs.run("main", {agent:"worker"})\n```')), false);
const hooks = {};
const contextHooks = [];
const tools = {};
const commands = {};
const researchEntries = [];
const researchWidgets = [];
const shortcuts = {};
const listeners = new Map();
let aborts = 0;
let launch;
let workflowScript;
let discovererPayloadScript;
const runId = "43b46a2e-ec06-4f14-b99e-e3f81478d87a";
let replyRunId = runId;
const pi = {
	on: (name, handler) => {
		if (name === "context") {
			contextHooks.push(handler);
			hooks.context = async (event, ctx) => {
				let messages = event.messages;
				let changed = false;
				for (const callback of contextHooks) {
					const result = await callback({ ...event, messages }, ctx);
					if (result?.messages) { messages = result.messages; changed = true; }
				}
				return changed ? { messages } : undefined;
			};
		} else hooks[name] = handler;
	},
	registerTool(tool) { tools[tool.name] = tool; },
	registerCommand(name, command) { commands[name] = command; },
	registerShortcut(key, shortcut) { shortcuts[key] = shortcut; },
	appendEntry(customType, data) {
		if (customType === "work-research-context") researchEntries.push({ type: "custom", customType, data: structuredClone(data) });
	},
	events: {
		on(name, handler) {
			listeners.set(name, handler);
			return () => listeners.delete(name);
		},
		emit(name, event) {
			if (name !== "subagents:rpc:v1:request") return;
			try {
				assert.equal(event.params.workflowScript, undefined, "removed RPC field must never be sent");
				workflowScript = event.params.script;
				if (!discovererPayloadScript) discovererPayloadScript = workflowScript;
				assert.match(workflowScript, /"agent":"context-knowledge-discoverer"/);
				launch = { agent: "context-knowledge-discoverer" };
			} catch (error) {
				assert.fail(`Invalid discoverer launch envelope: ${error.message}`);
			}
			listeners.get(`subagents:rpc:v1:reply:${event.requestId}`)({
				success: true,
				data: { runId: replyRunId },
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
	ui: { notify() {}, setStatus() {}, setWidget(key, content) { if (key === "work-research-context") researchWidgets.push(content); } },
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
			workOrchestrator: { context: { compactionModel: "__none_model__" } },
			workKnowledge: { discoverer: { model: "test/free", thinking: "low" } },
		}),
	);
	workModelsExtension(pi);
	for (const tool of Object.values(tools)) {
		assert.equal(tool.exposure, tool.name.startsWith("work_") ? "model-only" : undefined);
	}
	assert.equal(tools.research_mode, undefined, "agent cannot toggle research mode");
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
		{
			role: "assistant",
			content: [
				{ type: "thinking", thinking: "DISCOVERER_HIDDEN_REASONING" },
				{ type: "text", text: "Analyzed." },
			],
		},
		{ role: "assistant", content: [{ type: "text", text: "More." }] },
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
		"context-knowledge-discoverer",
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
		{ role: "assistant", content: [{ type: "text", text: "More." }] },
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
	assert.doesNotMatch(
		discovererPayloadScript,
		/DISCOVERER_HIDDEN_REASONING/,
		"knowledge discovery serializes visible transcript text, not hidden reasoning",
	);
	const strippedConsumed = stripProcessedPayloads(consumed, { images: true });
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
		stripProcessedPayloads(strippedConsumed),
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
		{ role: "assistant", content: [{ type: "text", text: "More." }] },
	];
	const strippedImageOnly = stripProcessedPayloads(imageOnly, { images: true });
	assert.equal(
		strippedImageOnly[1].content.length,
		1,
		"an image-only toolResult keeps exactly one non-empty placeholder",
	);
	assert.match(strippedImageOnly[1].content[0].text, /image payload dropped/);
	const live = [imageCall, imageResult];
	assert.equal(
		stripProcessedPayloads(live),
		live,
		"an image the model has not yet answered keeps its payload (same reference)",
	);
	const largeImageResult = {
		...imageResult,
		content: [
			{ type: "text", text: "Read image file [image/png]" },
			{ type: "image", data: Buffer.alloc(64 * 1024).toString("base64") },
		],
	};
	const preparedLargeImage = stripProcessedPayloads(
		[imageCall, largeImageResult],
		{ images: "large" },
	);
	assert.equal(preparedLargeImage[1].content[1].type, "image");
	assert.match(
		preparedLargeImage[1].content[2].text,
		/preserve a concise text record/,
		"a live large image tells the model to retain reusable visual facts",
	);
	const visualRecord = {
		role: "assistant",
		content: [{ type: "text", text: "VISUAL_RECORD TRIANGLES=3" }],
	};
	const largeConsumed = stripProcessedPayloads(
		[
			imageCall,
			largeImageResult,
			visualRecord,
			{ role: "user", content: "next" },
			{ role: "assistant", content: [{ type: "text", text: "More." }] },
		],
		{ images: "large" },
	);
	assert.equal(largeConsumed[1].content[1].type, "text");
	assert.equal(
		largeConsumed[2],
		visualRecord,
		"rolling removal preserves the model's processed visual record",
	);
	assert.equal(
		stripProcessedPayloads(consumed, { images: "large" }),
		consumed,
		"small images stay cache-stable until compaction",
	);
	const boundaryImages = [
		{ role: "user", timestamp: 100, content: [{ type: "image", data: "user" }] },
		{ ...imageCall, timestamp: 150 },
		{ ...imageResult, timestamp: 200 },
		{
			role: "assistant",
			timestamp: 250,
			content: [{ type: "text", text: "Analyzed." }],
		},
		{ ...imageCall, timestamp: 300 },
		{ ...imageResult, timestamp: 350 },
		{
			role: "assistant",
			timestamp: 400,
			content: [{ type: "text", text: "Done." }],
		},
	];
	const boundaryStripped = stripProcessedPayloads(boundaryImages, {
		images: false,
		imageBeforeTimestamp: 250,
	});
	assert.equal(boundaryStripped[0].content[0].type, "text");
	assert.equal(boundaryStripped[2].content[1].type, "text");
	assert.equal(
		boundaryStripped[5].content[1].type,
		"image",
		"compaction drops every pre-boundary image even with rolling disabled, but not later images",
	);
	assert.equal(
		boundaryImages[0].content[0].type,
		"image",
		"boundary image stripping does not mutate stored messages",
	);
	// Image markers are deterministic and truthful: metadata observed only at
	// strip time would describe the current file, not the historical payload.
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
		{ role: "assistant", content: [{ type: "text", text: "More." }] },
	];
	const stampedOnce = stripProcessedPayloads(
		answered([realCall("img-r1"), realResult("img-r1")]),
		{ images: true },
	);
	assert.equal(
		stampedOnce[1].content[0].text,
		`[image payload dropped — re-read ${shotPath} to view current contents.]`,
		"the marker identifies the recoverable source without false historical metadata",
	);
	writeFileSync(shotPath, Buffer.alloc(4096));
	const stampedTwice = stripProcessedPayloads(
		answered([
			realCall("img-r1"),
			realResult("img-r1"),
			realCall("img-r2"),
			realResult("img-r2"),
		]),
		{ images: true },
	);
	assert.equal(
		stampedTwice[3].content[0].text,
		stampedOnce[1].content[0].text,
		"the same path always produces the same cache-friendly marker",
	);
	// Giant results truncate the middle, stale reads are replaced whole, and
	// duplicate identical outputs keep only the newest — each behind its flag.
	const bigText = `${Array.from({ length: 600 }, (_, i) => `line ${i} with padding `.repeat(2)).join("\n")}`;
	assert.ok(bigText.length >= 24_000, "giant fixture");
	const bashResult = (text) => ({
		role: "toolResult",
		toolCallId: "b-1",
		toolName: "bash",
		content: [{ type: "text", text }],
	});
	const assistant = {
		role: "assistant",
		content: [{ type: "text", text: "ok" }],
	};
	const small = [bashResult("small output"), assistant];
	assert.equal(
		stripProcessedPayloads(small),
		small,
		"small outputs pass through untouched",
	);
	const giantOff = [bashResult(bigText), assistant];
	assert.equal(
		stripProcessedPayloads(giantOff, { giantResults: false }),
		giantOff,
		"the giant flag disables truncation",
	);
	const grace = [bashResult(bigText), assistant];
	assert.equal(
		stripProcessedPayloads(grace),
		grace,
		"giants keep their payload for one grace turn past the first answer",
	);
	const longLines = Array.from(
		{ length: 105 },
		(_, i) => `${i}: ${"x".repeat(500)}`,
	).join("\n");
	assert.ok(longLines.length >= 24_000, "long-line giant fixture");
	const longLineCut = stripProcessedPayloads([
		bashResult(longLines),
		assistant,
		assistant,
	])[0].content[0].text;
	assert.ok(
		longLineCut.length < 20_000,
		`few-but-long-line giants fall through to the char cut (got ${longLineCut.length})`,
	);
	assert.match(longLineCut, /chars truncated/);
	const giant = stripProcessedPayloads([
		bashResult(bigText),
		assistant,
		assistant,
	]);
	assert.match(
		giant[0].content[0].text,
		/\[\.\.\. \d+ lines truncated/,
		"giant results drop their middle",
	);
	assert.match(giant[0].content[0].text, /line 599/);
	assert.doesNotMatch(giant[0].content[0].text, /line 300/);
	assert.ok(giant[0].content[0].text.length < bigText.length / 2);
	const stale = stripProcessedPayloads([
		{
			role: "assistant",
			content: [
				{
					type: "toolCall",
					id: "r-1",
					name: "read",
					arguments: { path: "C:/x/a.ts" },
				},
			],
		},
		{
			role: "toolResult",
			toolCallId: "r-1",
			toolName: "read",
			content: [{ type: "text", text: bigText }],
		},
		{
			role: "assistant",
			content: [
				{
					type: "toolCall",
					id: "e-1",
					name: "edit",
					arguments: { path: "C:/x/a.ts" },
				},
			],
		},
		{
			role: "toolResult",
			toolCallId: "e-1",
			toolName: "edit",
			content: [{ type: "text", text: "done" }],
		},
		assistant,
	]);
	assert.match(
		stale[1].content[0].text,
		/stale read of C:\/x\/a\.ts — this file was edited after this read/,
		"a read superseded by a later edit is replaced whole",
	);
	const failedEdit = structuredClone(stale);
	failedEdit[1].content = [{ type: "text", text: bigText }];
	failedEdit[3] = { ...failedEdit[3], isError: true };
	assert.doesNotMatch(
		stripProcessedPayloads(failedEdit)[1].content[0].text,
		/stale read/,
		"an explicitly failed edit does not stale a prior read",
	);
	const relativePath = path.relative(cwd, path.join(cwd, "nested", "same.ts"));
	const cwdMatched = structuredClone(stale);
	cwdMatched[1].content = [{ type: "text", text: bigText }];
	cwdMatched[0].content[0].arguments.path = relativePath;
	cwdMatched[2].content[0].arguments.path = path.join(cwd, "nested", "same.ts");
	assert.match(
		stripProcessedPayloads(cwdMatched, { cwd })[1].content[0].text,
		/stale read/,
		"relative and absolute paths match against the session cwd",
	);
	const dupText = `${Array.from({ length: 40 }, (_, i) => `status ${i} ${"x".repeat(60)}`).join("\n")}`;
	assert.ok(dupText.length >= 1_000 && dupText.length < 24_000);
	const dupCall = (id) => ({
		role: "assistant",
		content: [{ type: "toolCall", id, name: "bash", arguments: {} }],
	});
	const dup = stripProcessedPayloads([
		dupCall("d-1"),
		bashResult(dupText),
		dupCall("d-2"),
		bashResult(dupText),
		assistant,
	]);
	assert.match(
		dup[1].content[0].text,
		/duplicate bash output omitted/,
		"older identical outputs collapse to a marker",
	);
	assert.equal(
		dup[3].content[0].text,
		dupText,
		"the newest identical output keeps its content",
	);
	const dupBody = [
		dupCall("d-1"),
		bashResult(dupText),
		dupCall("d-2"),
		bashResult(dupText),
		assistant,
	];
	assert.equal(
		stripProcessedPayloads(dupBody, { fromIndex: 3 })[1].content[0].text,
		dupText,
		"duplicate markers are scoped to the sent region: no marker may point below the cut",
	);
	assert.equal(
		stripProcessedPayloads(dupBody, { duplicates: false })[1].content[0].text,
		dupText,
		"the duplicates flag disables collapsing",
	);
	const mixedDup = structuredClone(dupBody);
	mixedDup[1].content.push({ type: "image", data: "first" });
	mixedDup[3].content.push({ type: "image", data: "second" });
	assert.equal(
		stripProcessedPayloads(mixedDup)[1].content[0].text,
		dupText,
		"text-equal results with non-text payloads do not collapse",
	);
	const readCall = (id, file) => ({
		role: "assistant",
		content: [{ type: "toolCall", id, name: "read", arguments: { path: file } }],
	});
	const editCall = (id, file) => ({
		role: "assistant",
		content: [{ type: "toolCall", id, name: "edit", arguments: { path: file } }],
	});
	const duplicateThenStale = stripProcessedPayloads([
		readCall("ra", "C:/x/A.ts"),
		{
			role: "toolResult",
			toolCallId: "ra",
			toolName: "read",
			content: [{ type: "text", text: dupText }],
		},
		readCall("rb", "C:/x/B.ts"),
		{
			role: "toolResult",
			toolCallId: "rb",
			toolName: "read",
			content: [{ type: "text", text: dupText }],
		},
		editCall("eb", "C:/x/B.ts"),
		{
			role: "toolResult",
			toolCallId: "eb",
			toolName: "edit",
			content: [{ type: "text", text: "done" }],
		},
		assistant,
	]);
	assert.equal(
		duplicateThenStale[1].content[0].text,
		dupText,
		"duplicate collapsing keeps a full non-stale copy when the newer copy is stale",
	);
	assert.match(duplicateThenStale[3].content[0].text, /stale read/);
	const giantDuplicate = stripProcessedPayloads([
		dupCall("g-1"),
		bashResult(bigText),
		dupCall("g-2"),
		bashResult(bigText),
		assistant,
		assistant,
	]);
	assert.match(
		giantDuplicate[1].content[0].text,
		/later occurrence is retained in this context, possibly shortened/,
		"duplicate markers truthfully describe a giant keeper",
	);
	const readLike = stripProcessedPayloads([
		{
			role: "assistant",
			content: [
				{
					type: "toolCall",
					id: "rl-1",
					name: "read_symbol",
					arguments: { path: "C:/x/mod.ts", symbol: "foo" },
				},
			],
		},
		{
			role: "toolResult",
			toolCallId: "rl-1",
			toolName: "read_symbol",
			content: [{ type: "text", text: "function foo() {}" }],
		},
		{
			role: "assistant",
			content: [
				{
					type: "toolCall",
					id: "rl-2",
					name: "edit",
					arguments: { path: "C:/x/mod.ts" },
				},
			],
		},
		{
			role: "toolResult",
			toolCallId: "rl-2",
			toolName: "edit",
			content: [{ type: "text", text: "done" }],
		},
		assistant,
	]);
	assert.match(
		readLike[1].content[0].text,
		/stale read of C:\/x\/mod\.ts/,
		"read_symbol results are superseded like reads",
	);
	const thinkA1 = {
		role: "assistant",
		content: [
			{ type: "thinking", thinking: "hmm", thinkingSignature: "sig" },
			{ type: "text", text: "answer" },
		],
	};
	const thinkA2 = {
		role: "assistant",
		content: [{ type: "text", text: "two" }],
	};
	const thinkA3 = {
		role: "assistant",
		content: [{ type: "text", text: "three" }],
	};
	const thinkingDefault = [thinkA1, thinkA2, thinkA3];
	assert.equal(
		stripProcessedPayloads(thinkingDefault),
		thinkingDefault,
		"thinking removal defaults off until the provider replay path is validated",
	);
	const thinkStripped = stripProcessedPayloads([thinkA1, thinkA2, thinkA3], {
		thinking: true,
	});
	assert.equal(
		thinkStripped[0].content.length,
		1,
		"opt-in aged thinking is dropped from old assistant turns",
	);
	assert.equal(thinkStripped[0].content[0].type, "text");
	assert.equal(
		stripProcessedPayloads([thinkA1, thinkA2])[0].content.length,
		2,
		"thinking survives the grace window",
	);
	assert.equal(
		stripProcessedPayloads([thinkA1, thinkA2, thinkA3], { thinking: false })[0]
			.content.length,
		2,
		"the thinking flag disables dropping",
	);
	const interactionThinking = stripProcessedPayloads(
		[
			{ role: "user", content: "stage one" },
			thinkA1,
			{ role: "user", content: "stage two" },
			{
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "current", thinkingSignature: "sig-2" },
					{ type: "text", text: "working" },
				],
			},
		],
		{ thinking: "interaction" },
	);
	assert.equal(
		interactionThinking[1].content.length,
		1,
		"interaction policy drops reasoning from completed user interactions",
	);
	assert.equal(
		interactionThinking[3].content.length,
		2,
		"interaction policy preserves the current user interaction",
	);
	const thinkTool = stripProcessedPayloads(
		[
			{
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "hmm", thinkingSignature: "s" },
					{
						type: "toolCall",
						id: "tc-9",
						name: "bash",
						arguments: { command: "ls" },
					},
				],
			},
			thinkA2,
			thinkA3,
		],
		{ thinking: true },
	);
	assert.equal(
		thinkTool[0].content[0].type,
		"toolCall",
		"toolCall parts survive thinking drops",
	);
	const previousGiantFlag = process.env.STRIP_GIANT_RESULTS;
	const previousThinkingFlag = process.env.STRIP_THINKING;
	try {
		process.env.STRIP_GIANT_RESULTS = "0";
		const giantDisabled = await hooks.context(
			{ messages: [bashResult(bigText), assistant, assistant] },
			ctx,
		);
		assert.equal(
			giantDisabled,
			undefined,
			"STRIP_GIANT_RESULTS=0 disables giant stripping at the runtime hook",
		);
		process.env.STRIP_THINKING = "1";
		const thinkingEnabled = await hooks.context(
			{ messages: [thinkA1, thinkA2, thinkA3] },
			ctx,
		);
		assert.equal(
			thinkingEnabled.messages[0].content.length,
			1,
			"STRIP_THINKING=1 opts into thinking removal at the runtime hook",
		);
		process.env.STRIP_THINKING = "interaction";
		const interactionEnabled = await hooks.context(
			{
				messages: [
					{ role: "user", content: "one" },
					thinkA1,
					{ role: "user", content: "two" },
					thinkA2,
				],
			},
			ctx,
		);
		assert.equal(
			interactionEnabled.messages[1].content.length,
			1,
			"STRIP_THINKING=interaction drops only completed interactions",
		);
	} finally {
		if (previousGiantFlag === undefined) delete process.env.STRIP_GIANT_RESULTS;
		else process.env.STRIP_GIANT_RESULTS = previousGiantFlag;
		if (previousThinkingFlag === undefined) delete process.env.STRIP_THINKING;
		else process.env.STRIP_THINKING = previousThinkingFlag;
	}
	const errorAgedImage = stripProcessedPayloads([
		realCall("img-errors"),
		realResult("img-errors"),
		{ role: "assistant", content: [], stopReason: "error" },
		{ role: "assistant", content: [], stopReason: "aborted" },
	]);
	assert.equal(
		errorAgedImage[1].content[0].type,
		"image",
		"failed and aborted assistant responses do not consume an image",
	);
	resetContextFilter();
	const oversizedRequest = [{ role: "user", content: "x".repeat(130_000) },
		{ role: "assistant", content: "y".repeat(130_000) }];
	const activeCtx = { ...ctx, model: { contextWindow: 200_000 } };
	requestContextFilter(activeCtx);
	const protectedContext = await hooks.context({ messages: oversizedRequest }, activeCtx);
	assert(JSON.stringify(protectedContext).includes("x".repeat(130_000)), "protected request survives a rolling target overflow without clipping");
	assert.equal(oversizedRequest[0].content.length, 130_000);
	resetContextFilter();
	const activeMessages = [
		{ role: "assistant", content: `old ${"x".repeat(130_000)}` },
		{ role: "assistant", content: [{ type: "text", text: "old answer" }] },
		{ role: "user", content: "current turn" },
		{
			role: "assistant",
			content: [
				{
					type: "toolCall",
					id: "active-giant",
					name: "bash",
					arguments: { command: "generate" },
				},
			],
		},
		{
			role: "toolResult",
			toolCallId: "active-giant",
			toolName: "bash",
			content: [{ type: "text", text: "g".repeat(30_000) }],
		},
		{ role: "assistant", content: [{ type: "text", text: "used giant" }] },
		{
			role: "assistant",
			content: [{ type: "text", text: "y".repeat(100_000) }],
		},
	];
	requestContextFilter(activeCtx);
	const activeFiltered = await hooks.context(
		{ messages: activeMessages },
		activeCtx,
	);
	const activeResult = activeFiltered.messages.find(
		(message) => message?.toolCallId === "active-giant",
	);
	assert(
		activeFiltered.messages.some(
			(message) => message.role === "compactionSummary",
		),
	);
	assert(
		activeResult.content[0].text.length < 24_000,
		"the registered active-context path sends the stripped post-cut tail",
	);
	assert.equal(
		activeMessages[4].content[0].text.length,
		30_000,
		"active filtering does not mutate stored input messages",
	);
	resetContextFilter();
	// A large advertised window must not inflate the 30k retention target.
	const millionTokenCtx = { ...ctx, model: { contextWindow: 1_000_000 } };
	const batch = (start, count) =>
		Array.from({ length: count }, (_, offset) => {
			const id = `large-window-${start + offset}`;
			return [
				{
					role: "assistant",
					content: [
						{
							type: "toolCall",
							id,
							name: "bash",
							arguments: { command: `echo ${id}` },
						},
					],
				},
				{
					role: "toolResult",
					toolCallId: id,
					toolName: "bash",
					content: [{ type: "text", text: `${id} ${"x".repeat(8_000)}` }],
				},
			];
		}).flat();
	const longActiveTurn = [
		{ role: "user", content: "older task" },
		{ role: "assistant", content: [{ type: "text", text: "finished" }] },
		{
			role: "user",
			content:
				"CURRENT-REQUEST: implement all phases without changing the public API",
		},
		...batch(0, 80),
	];
	const originalLongTurn = JSON.stringify(longActiveTurn);
	const assertCompactTail = (result) => {
		assert.equal(result.messages[0].role, "compactionSummary");
		assert.match(result.messages[0].summary, /CURRENT-REQUEST/);
		assert(
			JSON.stringify(result.messages).length / 4 < 42_000,
			"a 1M-window model must retain roughly 30k plus the 8k summary and one batch, not the entire 160k turn",
		);
		const calls = new Set(
			result.messages.flatMap((message) =>
				Array.isArray(message.content)
					? message.content
							.filter((part) => part.type === "toolCall")
							.map((part) => part.id)
					: [],
			),
		);
		for (const message of result.messages)
			if (message.role === "toolResult")
				assert(
					calls.has(message.toolCallId),
					"retained tool results need their calls",
				);
	};
	requestContextFilter(millionTokenCtx);
	const compactLongTurn = await hooks.context(
		{ messages: longActiveTurn },
		millionTokenCtx,
	);
	assertCompactTail(compactLongTurn);
	assert.equal(
		JSON.stringify(longActiveTurn),
		originalLongTurn,
		"stored history remains unchanged",
	);
	const slightlyLonger = [...longActiveTurn, ...batch(80, 2)];
	const stableTail = await hooks.context(
		{ messages: slightlyLonger },
		millionTokenCtx,
	);
	assert.equal(
		stableTail.messages[1],
		compactLongTurn.messages[1],
		"do not roll the cut forward on every tool turn",
	);
	const grownTail = await hooks.context(
		{ messages: [...slightlyLonger, ...batch(82, 70)] },
		millionTokenCtx,
	);
	assertCompactTail(grownTail);
	assert.notEqual(
		grownTail.messages[1],
		compactLongTurn.messages[1],
		"recompact at the configured trigger, not half of the model window",
	);
	resetContextFilter();
	// Pin and validate against the same list after removing internal messages.
	const withInternalPrefix = [
		{ role: "custom", customType: "work-knowledge", content: "old knowledge" },
		...longActiveTurn,
	];
	requestContextFilter(millionTokenCtx);
	const cleanedTail = await hooks.context(
		{ messages: withInternalPrefix },
		millionTokenCtx,
	);
	assertCompactTail(cleanedTail);
	const continuedCleanedTail = await hooks.context(
		{ messages: [...withInternalPrefix, ...batch(80, 1)] },
		millionTokenCtx,
	);
	assertCompactTail(continuedCleanedTail);
	assert.equal(
		continuedCleanedTail.messages[1],
		cleanedTail.messages[1],
		"excluded prefix messages must not invalidate the pinned cut on the next request",
	);
	const nextUser = { role: "user", content: "NEXT-REQUEST: preserve the API" };
	const newUserHistory = [...withInternalPrefix, ...batch(80, 1), nextUser];
	const originalNewUserHistory = JSON.stringify(newUserHistory);
	const newUserTail = await hooks.context(
		{ messages: newUserHistory },
		millionTokenCtx,
	);
	assertCompactTail(newUserTail);
	assert(newUserTail.messages.includes(nextUser), "new user survives recovery");
	assert.match(JSON.stringify(newUserTail.messages), /NEXT-REQUEST/,
		"latest request remains in the live tail rather than duplicating it in memory");
	assert(!newUserTail.messages.includes(withInternalPrefix[0]));
	const stableRecoveredTail = await hooks.context(
		{ messages: newUserHistory },
		millionTokenCtx,
	);
	assert.equal(
		stableRecoveredTail.messages[0].summary,
		newUserTail.messages[0].summary,
	);
	assert.equal(stableRecoveredTail.messages[1], newUserTail.messages[1]);
	assert.equal(JSON.stringify(newUserHistory), originalNewUserHistory);

	// A real rewrite can delete the pinned tool turn. Recover without reviving it.
	const cut = newUserHistory.indexOf(newUserTail.messages[1]);
	assert.equal(newUserHistory[cut].role, "assistant");
	assert.equal(newUserHistory[cut + 1].role, "toolResult");
	const withoutCut = [
		...newUserHistory.slice(0, cut),
		...newUserHistory.slice(cut + 2),
	];
	const recoveredCut = await hooks.context(
		{ messages: withoutCut },
		millionTokenCtx,
	);
	assertCompactTail(recoveredCut);
	assert(!recoveredCut.messages.includes(newUserHistory[cut]));
	assert(recoveredCut.messages.includes(nextUser));

	// Tiny/empty rewritten histories still take the cleaned ordinary path.
	const tiny = await hooks.context(
		{ messages: [withInternalPrefix[0], nextUser] },
		millionTokenCtx,
	);
	assert.equal(tiny.messages[0], nextUser);
	assert(!tiny.messages.includes(withInternalPrefix[0]));
	assert(
		tiny.messages
			.slice(1)
			.every((message) => message.customType === "work-knowledge"),
	);
	resetContextFilter();

	// Genuine registry eviction changes which historical notifications are excluded.
	await new Promise((resolve) => setImmediate(resolve));
	absorbKnowledgeDiscovererCompletion({ runId, success: false });
	assert(isKnowledgeDiscovererCompletionMessage(notices[2]));
	replyRunId = "filter-arming-discoverer";
	const notifiedHistory = [notices[2], ...longActiveTurn];
	requestContextFilter(millionTokenCtx);
	assertCompactTail(
		await hooks.context({ messages: notifiedHistory }, millionTokenCtx),
	);
	await new Promise((resolve) => setImmediate(resolve));
	for (let index = 0; index < 32; index++) {
		replyRunId = `filter-eviction-${index}`;
		await launchKnowledgeDiscoverer(pi, ctx, [
			{ role: "user", content: `Distinct removed turn for eviction ${index}` },
		]);
		absorbKnowledgeDiscovererCompletion({ runId: replyRunId, success: false });
	}
	assert(
		!isKnowledgeDiscovererCompletionMessage(notices[2]),
		"old run really evicted",
	);
	const evictionHistory = [...notifiedHistory, ...batch(80, 1)];
	const beforeEvictionRecovery = JSON.stringify(evictionHistory);
	assertCompactTail(
		await hooks.context({ messages: evictionHistory }, millionTokenCtx),
	);
	assert.equal(JSON.stringify(evictionHistory), beforeEvictionRecovery);
	replyRunId = runId;
	resetContextFilter();
	if (process.platform === "win32") {
		const casing = stripProcessedPayloads([
			{
				role: "assistant",
				content: [
					{
						type: "toolCall",
						id: "rc-1",
						name: "read",
						arguments: { path: "c:/x/aA.ts" },
					},
				],
			},
			{
				role: "toolResult",
				toolCallId: "rc-1",
				toolName: "read",
				content: [{ type: "text", text: "content" }],
			},
			{
				role: "assistant",
				content: [
					{
						type: "toolCall",
						id: "ec-1",
						name: "edit",
						arguments: { path: "C:/X/Aa.TS" },
					},
				],
			},
			{
				role: "toolResult",
				toolCallId: "ec-1",
				toolName: "edit",
				content: [{ type: "text", text: "done" }],
			},
			assistant,
		]);
		assert.match(
			casing[1].content[0].text,
			/stale read of c:\/x\/aA\.ts/,
			"edit path casing does not defeat supersession on Windows",
		);
	}
	const agent = readFileSync(
		new URL("../utility-agents/context-knowledge-discoverer.md", import.meta.url),
		"utf8",
	);
	for (const pattern of [
		/^tools:\s*$/m,
		/^inheritProjectContext: false$/m,
	])
		assert.match(
			agent,
			pattern,
			"discovery has an enforced tool-free read-only contract",
		);
	// The production hook never launches the retired discovery job, even with legacy settings.
	launch = null;
	const preparation = {
		messagesToSummarize: [{ role: "user", content: "Preserve this request." }],
		firstKeptEntryId: "kept", tokensBefore: 100,
	};
	const cleaned = await hooks.session_before_compact({ preparation }, ctx);
	assert.equal(cleaned.compaction.details.compactionMode, "cleaned");
	assert.equal(launch, null);
	writeFileSync(path.join(cwd, ".pi", "settings.json"), JSON.stringify({
		workOrchestrator: { context: { compactionModel: "test/summary", compactionThinking: "low" } },
	}));
	let memoryCalls = 0;
	const hybridContext = { ...ctx, modelRegistry: {
		find: (provider, id) => provider === "test" && id === "summary" ? { provider, id, contextWindow: 1_000_000 } : undefined,
		streamSimple() {
			memoryCalls++;
			return { result: async () => ({ stopReason: "stop", usage: { input: 10, output: 5 },
				content: [{ type: "text", text: JSON.stringify({ checkpoint: "Continue the task.", knowledge: [] }) }],
			}) };
		},
	} };
	const combined = await hooks.session_before_compact({ preparation }, hybridContext);
	assert.equal(combined.compaction.details.compactionMode, "hybrid");
	assert.equal(combined.compaction.usage.output, 5);
	assert.equal(memoryCalls, 1);
	assert.equal(launch, null, "hybrid summary/extraction cannot launch a separate discoverer");
	// Context-hook compaction is optional: an aborted turn must not surface an extension error or publish a partial cut.
	const cancellationMessagesBefore = JSON.stringify(activeMessages);
	const hasSummary = result => result?.messages?.some(message => message.role === "compactionSummary") ?? false;
	resetContextFilter();
	const alreadyCancelledCtx = { ...hybridContext, model: { provider: "test", id: "summary", contextWindow: 200_000 },
		signal: AbortSignal.abort() };
	requestContextFilter(alreadyCancelledCtx);
	const callsBeforeCancellation = memoryCalls;
	const alreadyCancelled = await hooks.context({ messages: activeMessages }, alreadyCancelledCtx);
	assert.equal(hasSummary(alreadyCancelled), false, "already-aborted turns keep the old context without a new summary");
	assert.equal(memoryCalls, callsBeforeCancellation, "already-aborted turns make no summarizer request");
	const freshCompactionCtx = { ...alreadyCancelledCtx, signal: new AbortController().signal };
	const retriedAfterCancellation = await hooks.context({ messages: activeMessages }, freshCompactionCtx);
	assert.equal(hasSummary(retriedAfterCancellation), true, "the next live turn retries the pending compaction automatically");
	resetContextFilter();
	const abortDuringSummary = new AbortController();
	let cancelledSummaryCalls = 0;
	const cancellingCtx = { ...freshCompactionCtx, signal: abortDuringSummary.signal,
		modelRegistry: { ...hybridContext.modelRegistry,
			streamSimple(_selected, _context, options) {
				cancelledSummaryCalls++;
				assert(options.signal instanceof AbortSignal, "summary receives the current operation signal");
				return { result: async () => {
					abortDuringSummary.abort();
					throw new DOMException("This operation was aborted", "AbortError");
				} };
			} },
	};
	requestContextFilter(cancellingCtx);
	const cancelledDuringSummary = await hooks.context({ messages: activeMessages }, cancellingCtx);
	assert.equal(hasSummary(cancelledDuringSummary), false, "in-flight cancellation cannot publish a new cut");
	assert.equal(cancelledSummaryCalls, 1, "user cancellation does not retry another summarizer");
	assert.equal(hasSummary(await hooks.context({ messages: activeMessages }, freshCompactionCtx)), true,
		"in-flight cancellation also leaves the next live turn's compaction pending");
	assert.equal(JSON.stringify(activeMessages), cancellationMessagesBefore, "cancelled attempts never mutate saved history");
	resetContextFilter();
	const fallbackCalls = [];
	const fallbackWarnings = [];
	const fallbackContext = { ...hybridContext, model: { provider: "test", id: "current" },
		ui: { notify: message => fallbackWarnings.push(message) },
		modelRegistry: {
			find: (provider, id) => ({ provider, id }),
			streamSimple(selected) {
				fallbackCalls.push(selected.id);
				if (selected.id === "summary") throw new Error("Selected model unavailable");
				return hybridContext.modelRegistry.streamSimple();
			},
		},
	};
	const retried = await hooks.session_before_compact({ preparation }, fallbackContext);
	assert.deepEqual(fallbackCalls, ["summary", "current"]);
	assert.equal(retried.compaction.details.compactionMode, "hybrid");
	assert.equal(retried.compaction.details.compactionModel, "test/current");
	assert.equal(retried.compaction.details.compactionAttempts.length, 2);
	assert(fallbackWarnings.some(message => message.includes("current model test/current")));
	assert.equal(launch, null, "fallback is also a direct call, never a child agent");
	let exitCompactions = 0;
	const researchCtx = { ...ctx, isIdle: () => true,
		model: { provider: "test", id: "current", contextWindow: 1_000_000 },
		getContextUsage: () => ({ tokens: 180_000 }),
		compact: ({ onComplete }) => { exitCompactions++; onComplete?.({}); },
		sessionManager: { ...ctx.sessionManager, getBranch: () => researchEntries },
	};
	const evidence = [
		{ role: "user", content: "Compare these research sources" },
		{ role: "assistant", content: [{ type: "toolCall", id: "research-read", name: "read", arguments: { path: "source.md" } }] },
		{ role: "toolResult", toolCallId: "research-read", toolName: "read", content: [{ type: "text", text: "Important middle passage. ".repeat(300) }] },
		{ role: "assistant", content: [{ type: "text", text: "Continue comparing sources." }], stopReason: "stop" },
	];
	assert(commands.research && !commands.researc && shortcuts["alt+r"]);
	await assert.rejects(commands.research.handler("on", researchCtx), /current compaction to finish/);
	await hooks.session_compact({ compactionEntry: retried.compaction }, researchCtx);
	await shortcuts["alt+r"].handler(researchCtx);
	const notebook = researchEntries.at(-1).data.notes;
	assert.match(researchWidgets.at(-1)[0], /RESEARCH MODE/);
	assert(notebook.startsWith(path.join(tmpdir(), "pi-research-")));
	const scratchScript = path.join(path.dirname(notebook), "explore.mjs");
	for (const toolName of ["write", "edit"])
		for (const file of [scratchScript, "source.js", "PLAN.md", path.join(path.dirname(notebook), "..", "outside.js")])
			assert.equal(await hooks.tool_call({ toolName, input: { path: file } }, researchCtx)?.block, undefined, `${file} can be written during research`);
	for (const toolName of ["bash", "hypa_shell"]) {
		for (const command of ["git diff", `npm install --prefix "${path.dirname(notebook)}" example`, `unzip archive.zip -d "${path.dirname(notebook)}"`, `node "${scratchScript}"`, "git log --grep=commit", "echo \"git commit\""]) {
			assert.equal(await hooks.tool_call({ toolName, input: { command } }, researchCtx)?.block, undefined, `${command} is allowed for research`);
		}
		for (const command of ["git commit -m test", "git push", "git --no-pager push", `git -C "${cwd}" -c core.safecrlf=false commit --amend`, "git status && git push", "git.exe push", `"C:/Program Files/Git/bin/git.exe" commit`, "git commit-tree HEAD", "bash -lc \"git push\"", "powershell -Command \"git commit\""]) {
			assert.equal(await hooks.tool_call({ toolName, input: { command } }, researchCtx)?.block, true, `${command} cannot publish research`);
		}
	}
	assert.equal(await hooks.user_bash({ command: "git diff" }, researchCtx), undefined);
	assert.throws(() => hooks.user_bash({ command: "git push" }, researchCtx), /blocks Git commit and push/);
	assert.equal(await hooks.tool_call({ toolName: "read" }, researchCtx)?.block, undefined);
	assert.equal(await hooks.tool_call({ toolName: "subagent", input: { agent: "worker" } }, researchCtx)?.block, undefined, "research guides instead of blocking tools");
	assert.equal(await hooks.tool_call({ toolName: "subagent", input: { agent: "oracle", task: "Read-only critique" } }, researchCtx)?.block, undefined);
	assert.equal(await hooks.tool_call({ toolName: "subagent", input: { action: "models" } }, researchCtx)?.block, undefined);
	assert.equal(await hooks.tool_call({ toolName: "subagent", input: { agent: "oracle", worktree: true } }, researchCtx)?.block, undefined);
	assert.match((await hooks.before_agent_start({ prompt: "Explore options" }, researchCtx)).systemPrompt, /Writing a project plan is part of research/);
	await tools.research_note.execute("note", { note: "Observed result: source.md:12" });
	assert.match(readFileSync(notebook, "utf8"), /Observed result: source.md:12/);
	assert.equal(requestContextFilter(researchCtx), false, "no early cut above our threshold");
	// Research auto-compacts at the boundary only near 90% of the window (D04).
	assert.equal(researchCompactionTrigger({ model: { contextWindow: 200_000 } }), 180_000);
	const researchBoundary = [];
	const boundaryCtx = (tokens) => ({ ...researchCtx, model: { provider: "test", id: "current", contextWindow: 200_000 },
		getContextUsage: () => ({ tokens }), ui: { ...researchCtx.ui, notify: (message) => researchBoundary.push(message), setStatus: (_key, value) => value && researchBoundary.push(value) } });
	assert.equal(await hooks.turn_end({ context: { contextMessages: [] } }, boundaryCtx(150_000)), undefined);
	assert.equal(researchBoundary.length, 0, "research below 90% does not compact");
	await hooks.turn_end({ context: { contextMessages: [] } }, boundaryCtx(185_000));
	assert(researchBoundary.some((message) => /^Compacting/.test(message)), "research at 90% compacts at the boundary");
	assert.equal(await hooks.context({ messages: evidence }, researchCtx), undefined, "including full processed read contents");
	assert.equal(await hooks.session_before_compact({ preparation }, researchCtx), undefined, "native compaction must fall through");
	await hooks.session_compact({}, researchCtx);
	await hooks.agent_end({ messages: [evidence.at(-1)] }, researchCtx);
	await hooks.agent_settled({}, researchCtx);
	assert.equal(researchEntries.at(-1).data.notes, notebook, "finished answers never exit research mode");
	await hooks.session_tree({}, { ...researchCtx, sessionManager: { ...researchCtx.sessionManager, getBranch: () => researchEntries.filter(entry => entry.data?.mode === "research").slice(0, 1) } });
	assert.equal(requestContextFilter(researchCtx), false, "restore research mode on the selected branch");
	// Plan3 drives research through the shared event bus (LC-01); a repeated "on" is a no-op.
	const researchEntryCount = researchEntries.length;
	listeners.get("plan3:research")({ ctx: researchCtx, enabled: true });
	assert.equal(researchEntries.length, researchEntryCount);
	listeners.get("plan3:research")({ ctx: researchCtx, enabled: false });
	assert.deepEqual(researchEntries.at(-1).data, { mode: "off", notes: notebook });

	assert.equal(researchWidgets.at(-1), undefined, "banner disappears on exit");
	assert.equal(exitCompactions, 0, "manual exit never compacts, even above 150k");
	assert.equal(requestContextFilter(researchCtx), true);
	assert.match(readFileSync(notebook, "utf8"), /Observed result/);
	const savedNotes = path.join(path.dirname(notebook), "saved.md");
	await commands.research.handler(`save ${savedNotes}`, researchCtx);
	assert.match(readFileSync(savedNotes, "utf8"), /Observed result/);
	await assert.rejects(commands.research.handler(`save ${savedNotes}`, researchCtx), /EEXIST/, "explicit save never overwrites");
	await shortcuts["alt+r"].handler(researchCtx);
	const pendingNotebook = researchEntries.at(-1).data.notes;
	const busyResearchCtx = { ...researchCtx, isIdle: () => false };
	await shortcuts["alt+r"].handler(busyResearchCtx);
	assert.equal(researchEntries.at(-1).data.stopping, true);
	assert.match(researchWidgets.at(-1)[0], /RESEARCH STOPPING/);
	assert.equal(requestContextFilter(busyResearchCtx), false, "stopping keeps compaction protection");
	assert.equal(await hooks.context({ messages: evidence }, busyResearchCtx), undefined, "stopping keeps full evidence");
	assert.equal(await hooks.session_before_compact({ preparation }, busyResearchCtx), undefined, "native context-limit safety remains available while stopping");
	await tools.research_note.execute("last-note", { note: "Finding while stopping" });
	await hooks.agent_end({ messages: [evidence.at(-1)] }, busyResearchCtx);
	assert.equal(researchEntries.at(-1).data.stopping, true, "agent_end is not the final settlement boundary");
	await hooks.agent_settled({}, busyResearchCtx);
	await hooks.agent_settled({}, { ...researchCtx, hasPendingMessages: () => true });
	assert.equal(exitCompactions, 0, "never compact while streaming or with queued continuation work");
	assert.equal(researchEntries.at(-1).data.stopping, true);
	await shortcuts["alt+r"].handler(busyResearchCtx);
	assert.equal(researchEntries.at(-1).data.stopping, undefined, "Alt+R cancels a pending exit");
	assert.equal(researchEntries.at(-1).data.notes, pendingNotebook, "cancelling keeps the same notebook");
	await hooks.agent_settled({}, researchCtx);
	assert.equal(exitCompactions, 0, "cancelled exit does not compact");
	await commands.research.handler("off", busyResearchCtx);
	await hooks.session_tree({}, researchCtx);
	assert.match(researchWidgets.at(-1)[0], /RESEARCH STOPPING/, "pending exit survives branch restoration");
	await hooks.agent_settled({}, researchCtx);
	assert.deepEqual(researchEntries.at(-1).data, { mode: "off", notes: pendingNotebook });
	assert.equal(researchWidgets.at(-1), undefined, "banner disappears only after work settles");
	assert.equal(exitCompactions, 0, "deferred exit does not compact when idle");
	assert.match(readFileSync(pendingNotebook, "utf8"), /Finding while stopping/);
	await hooks.agent_settled({}, researchCtx);
	assert.equal(exitCompactions, 0, "repeated settled notifications never request exit compaction");
	const taskPrompts = [];
	const taskSettingsPath = path.join(cwd, ".pi", "settings.json");
	const taskSettings = JSON.parse(readFileSync(taskSettingsPath, "utf8"));
	writeFileSync(taskSettingsPath, JSON.stringify({ ...taskSettings,
		workOrchestrator: { ...taskSettings.workOrchestrator,
			advisorEnabled: { advisor: true, advisor2: true, advisor3: true },
			advisorSources: { advisor: "model", advisor2: "model", advisor3: "model" } },
		subagents: { agentOverrides: {
			"work-advisor": { model: "test/astra" },
			"work-advisor-2": { model: "test/opus" },
			"work-advisor-3": { model: "test/glm" } } },
	}));
	let availabilityChecks = 0;
	const taskCtx = { ...researchCtx, model: { provider: "test", id: "glm" }, getContextUsage: () => ({ tokens: 1 }),
		modelRegistry: { getAvailable: () => { availabilityChecks++; return ["astra", "opus", "glm"].map(id => ({ provider: "test", id })); } },
		sendUserMessage: async message => taskPrompts.push(message) };
	await commands.research.handler("wide compare options", taskCtx);
	const taskNotebook = researchEntries.at(-1).data.notes;
	const selectedTaskModels = () => JSON.parse(taskPrompts.at(-1).match(/Slots: (\[[^\n]+?\])\. Wait/)?.[1] ?? "[]").map(slot => slot.model);
	assert.deepEqual(selectedTaskModels(), ["test/astra", "test/opus"], "Wide on GLM calls Astra and Opus, not GLM");
	assert.doesNotMatch(taskPrompts.at(-1), /ask_user/, "explicit Wide does not ask again");
	await commands.ideate.handler("wide compare alternatives", { ...taskCtx, model: { provider: "test", id: "sol" } });
	assert.deepEqual(selectedTaskModels(), ["test/astra", "test/opus", "test/glm"], "Wide on another model calls all three advisors");
	await commands.research.handler("narrow compare options", { ...taskCtx, model: { provider: "test", id: "astra" } });
	assert.deepEqual(selectedTaskModels(), ["test/opus"], "Narrow skips the inline advisor before selecting the first other model");
	await commands.ideate.handler("narrow compare alternatives", { ...taskCtx, model: { provider: "test", id: "sol" },
		modelRegistry: { getAvailable: () => [{ provider: "test", id: "glm" }] } });
	assert.deepEqual(selectedTaskModels(), ["test/glm"], "Narrow skips unavailable advisors in list order");
	const checksBeforeNone = availabilityChecks;
	await commands.research.handler("none compare options", taskCtx);
	assert.deepEqual(selectedTaskModels(), []);
	assert.match(taskPrompts.at(-1), /Do not consult advisors/);
	assert.equal(availabilityChecks, checksBeforeNone, "None does not query advisor availability");
	await commands.research.handler("narrow compare options", { ...taskCtx,
		modelRegistry: { getAvailable: () => { throw new Error("Unavailable registry"); } } });
	assert.deepEqual(selectedTaskModels(), [], "availability failures continue safely with the inline agent only");
	await commands.ideate.handler("improve onboarding", taskCtx);
	assert.match(taskPrompts.at(-1), /ask_user/);
	assert.match(taskPrompts.at(-1), /Do not invoke ideation capture or create WorkItems/);
	assert.equal(researchEntries.at(-1).data.notes, taskNotebook, "exploration reuses the active temp notebook");
	await commands.research.handler("off", { ...taskCtx, isIdle: () => false });
	assert.equal(researchEntries.at(-1).data.stopping, true, "even below 150k protection waits until the work finishes");
	await hooks.agent_settled({}, taskCtx);
	assert.equal(researchEntries.at(-1).data.mode, "off");
	assert.equal(exitCompactions, 0, "small research contexts exit without compaction");
	rmSync(path.dirname(taskNotebook), { recursive: true, force: true });
	rmSync(path.dirname(pendingNotebook), { recursive: true, force: true });
	rmSync(path.dirname(notebook), { recursive: true, force: true });
	resetContextFilter();
	const modeSettingsFile = path.join(cwd, ".pi", "settings.json");
	const selectCompactMode = mode => writeFileSync(modeSettingsFile, JSON.stringify({
		workOrchestrator: { context: { mode, compactionModel: "__none_model__" } },
	}));
	const boundaryMessages = [
		{ role: "compactionSummary", summary: "Previous checkpoint" },
		{ role: "user", content: "Original request" },
		{ role: "assistant", content: [{ type: "thinking", thinking: "Full retained reasoning" },
			{ type: "toolCall", id: "old", name: "read", arguments: { path: "source.md" } }] },
		{ role: "toolResult", toolCallId: "old", toolName: "read", content: [{ type: "text", text: "Full evidence. ".repeat(30_000) }] },
		{ role: "assistant", content: [{ type: "text", text: "Old result" }] },
		{ role: "user", content: "Current request" },
		{ role: "assistant", content: [{ type: "toolCall", id: "recent", name: "read", arguments: { path: "recent.md" } }] },
		{ role: "toolResult", toolCallId: "recent", toolName: "read", content: [{ type: "text", text: "Recent evidence. ".repeat(10_000) }] },
		{ role: "assistant", content: [{ type: "text", text: "Continue" }], stopReason: "stop" },
	];
	const boundary = { context: { contextMessages: boundaryMessages, contextEntries: boundaryMessages.map((message, index) => ({
		sourceEntry: { id: `boundary-${index}`, type: "message", message }, messages: [message],
	})) }, message: boundaryMessages.at(-1), toolResults: [] };
	let manualOptions;
	const boundaryWarnings = [];
	const nativeCtx = { ...researchCtx, getContextUsage: () => ({ tokens: 200_000 }),
		compact: options => { manualOptions = options; },
		modelRegistry: { streamSimple: () => ({ result: async () => ({ content: [{ type: "text", text: "Native checkpoint" }], stopReason: "stop", usage: { input: 10, output: 5 } }) }) },
		ui: { ...ctx.ui, notify: message => boundaryWarnings.push(message) },
	};
	const abortsBeforeNative = aborts;
	for (const mode of ["native", "native-200k"]) {
		selectCompactMode(mode);
		assert.equal(requestContextFilter(nativeCtx), false);
		assert.equal(await hooks.context({ messages: boundaryMessages }, nativeCtx), undefined, "native modes send full evidence and thinking");
		assert.equal(await hooks.session_before_compact({ preparation }, nativeCtx), undefined, "native formatter is not replaced");
		await shortcuts.f8.handler(nativeCtx);
		assert.equal(manualOptions.customInstructions, undefined, "F8 does not inject Ultracompact's stripping instructions");
		manualOptions.onComplete({});
		assert.equal(await hooks.turn_end(boundary, { ...nativeCtx, getContextUsage: () => ({ tokens: 199_999 }) }), undefined, "no forced compaction below 200k");
	}
	const nativeDraft = await buildBoundaryCompaction(boundary, nativeCtx, "native-200k", async (...args) => {
		assert(args[0].some(message => message.content?.some?.(part => part.thinking === "Full retained reasoning")), "native summary gets unstripped reasoning");
		assert(args[0].some(message => message.role === "toolResult" && message.toolCallId === "old" && message.content[0].text.length > 300_000));
		assert.equal(args[7], "Previous checkpoint", "previous summary is merged");
		assert.equal(args[6], undefined, "native prompt is unchanged");
		return { text: "Native checkpoint", usage: { input: 10, output: 5 } };
	});
	assert.equal(nativeDraft.type, "compaction");
	assert.equal(nativeDraft.firstKeptEntryId, "boundary-6", "retention keeps tool calls and results together");
	assert.equal(nativeDraft.usage.output, 5);
	const giantNativeMessages = [{ role: "user", content: `BEGIN ${"Requirements 😀 and decisions. ".repeat(24_000)} END` }];
	const originalGiantNative = JSON.stringify(giantNativeMessages);
	const nativeChunks = [];
	const boundedCtx = { ...nativeCtx, model: { ...nativeCtx.model, contextWindow: 272_000 } };
	const boundedSummary = await summarizeNativeContext(giantNativeMessages, boundedCtx, { previousSummary: "Prior decisions",
		summarize: async (messages, _model, _reserve, _key, _headers, signal, _instructions, previous) => {
			assert(!signal.aborted);
			const text = messages[0].content[0].text;
			assert(Buffer.byteLength(text, "utf8") + Buffer.byteLength(previous ?? "", "utf8") <= 272_000);
			assert(!/[\uD800-\uDBFF]$/.test(text), "never split a Unicode surrogate pair");
			nativeChunks.push(text);
			assert.equal(previous, nativeChunks.length === 1 ? "Prior decisions" : "Merged native checkpoint");
			return { text: "Merged native checkpoint", usage: { input: 10, output: 5, cost: { total: 0.2 } } };
		} });
	assert(nativeChunks.length > 1, "single-message overflow is split before ACP sees it");
	assert(nativeChunks.join("").includes(giantNativeMessages[0].content), "every original request character participates");
	assert.equal(JSON.stringify(giantNativeMessages), originalGiantNative);
	assert.equal(boundedSummary.usage.output, nativeChunks.length * 5);
	assert(Math.abs(boundedSummary.usage.cost.total - nativeChunks.length * 0.2) < 1e-9);
	const hugePrior = "Earlier approved scope. ".repeat(20_000);
	const priorChunks = [];
	await summarizeNativeContext([{ role: "user", content: "Newest request" }], boundedCtx, { previousSummary: hugePrior,
		summarize: async (messages) => { priorChunks.push(messages[0].content[0].text); return { text: "Merged old and new" }; } });
	assert(priorChunks.join("").includes(hugePrior), "oversized previous summaries are summarized, not clipped");
	assert(priorChunks.join("").includes("Newest request"));
	await assert.rejects(summarizeNativeContext(giantNativeMessages, boundedCtx, { summarize: async () => { throw new Error("Upstream failed"); } }), /Upstream failed/);
	assert.equal(JSON.stringify(giantNativeMessages), originalGiantNative, "a failed chunk leaves raw history intact");
	const triggerWarnings = [];
	const headroomCtx = { ...boundedCtx, getContextUsage: () => ({ tokens: 172_000 }), ui: { ...boundedCtx.ui, notify: message => triggerWarnings.push(message) } };
	assert.equal(await hooks.turn_end(boundary, { ...headroomCtx, getContextUsage: () => ({ tokens: 171_231 }) }), undefined);
	const headroomCheckpoint = await hooks.turn_end(boundary, headroomCtx);
	assert(headroomCheckpoint?.entries?.[0]?.type === "compaction" || triggerWarnings.at(-1)?.includes("native summary generator is unavailable"), "272k advertised windows compact before ACP's 204k effective input ceiling");
	await assert.rejects(buildBoundaryCompaction(boundary, nativeCtx, "native-200k", async () => ({ text: "" })), /empty/);
	await assert.rejects(buildBoundaryCompaction(boundary, { ...nativeCtx, signal: AbortSignal.abort() }, "native-200k", async () => ({ text: "Discard me" })), /cancelled/);
	const autoNative = await hooks.turn_end(boundary, nativeCtx);
	assert(autoNative?.entries?.[0]?.type === "compaction" || boundaryWarnings.at(-1)?.includes("native summary generator is unavailable"), "200k attempts a native checkpoint; missing SDK fails without dropping context");
	assert.equal(aborts, abortsBeforeNative, "native threshold never aborts a running turn");
	await commands.research.handler("on", { ...nativeCtx, getContextUsage: () => ({ tokens: 1 }) });
	const nativeNotebook = researchEntries.at(-1).data.notes;
	assert.equal(await hooks.turn_end(boundary, nativeCtx), undefined, "research suspends forced 200k compaction");
	await shortcuts.f8.handler(nativeCtx);
	assert.equal(typeof manualOptions.onComplete, "function", "F8 works during native research");
	manualOptions.onComplete({});
	selectCompactMode("ultracompact");
	await shortcuts.f8.handler({ ...nativeCtx, isIdle: () => false });
	const researchManual = await hooks.turn_end(boundary, { ...nativeCtx, isIdle: () => false });
	assert.equal(researchManual.entries[0].type, "compaction", "busy F8 overrides research protection at a tool boundary");
	assert.equal(researchManual.entries[0].details.compactionMode, "ultracompact");
	assert.equal(aborts, abortsBeforeNative, "busy F8 never aborts live tools");
	await commands.research.handler("off", { ...nativeCtx, getContextUsage: () => ({ tokens: 1 }) });
	rmSync(path.dirname(nativeNotebook), { recursive: true, force: true });
	resetContextFilter();
	selectCompactMode("ultrafull");
	writeFileSync(modeSettingsFile, JSON.stringify({ workOrchestrator: {
		context: { mode: "ultrafull", compactionModel: "test/summary", compactionThinking: "low" },
	} }));
	let fullCalls = 0;
	const fullCtx = { ...nativeCtx, isIdle: () => false, modelRegistry: {
		...hybridContext.modelRegistry,
		streamSimple(selected, context) {
			fullCalls++;
			assert.equal(selected.id, "summary", "Ultrafull uses the predefined compaction model");
			const prompt = JSON.stringify(context);
			assert.match(prompt, /Original request/);
			assert.match(prompt, /Previous checkpoint/, "prior compaction participates in the summary");
			assert.doesNotMatch(prompt, /Full retained reasoning|Full evidence\./, "the existing microcompact evidence selection is reused");
			return hybridContext.modelRegistry.streamSimple();
		},
	} };
	const originalBoundary = JSON.stringify(boundaryMessages);
	assert.equal(requestContextFilter(fullCtx), false, "Ultrafull never activates a transient cut");
	assert.equal(await hooks.context({ messages: boundaryMessages }, { ...fullCtx, getContextUsage: () => ({ tokens: 1 }) }), undefined,
		"Ultrafull sends the unstripped context before a real checkpoint");
	const nudged = await hooks.context({ messages: boundaryMessages }, fullCtx);
	assert.deepEqual(nudged.messages.slice(0, -1), boundaryMessages, "the near-trigger nudge only appends");
	assert.match(nudged.messages.at(-1).content, /call compaction_note/);
	const noted = [...boundaryMessages, { role: "assistant", content: [{ type: "toolCall", name: "compaction_note", arguments: { note: "handoff" } }] }];
	assert.equal(await hooks.context({ messages: noted }, fullCtx), undefined, "no nudge once a note exists");
	assert.equal(await hooks.turn_end(boundary, { ...fullCtx, getContextUsage: () => ({ tokens: 150_000 }) }), undefined, "Ultrafull no longer triggers at 150k by default");
	assert.equal(await hooks.turn_end(boundary, { ...fullCtx, getContextUsage: () => ({ tokens: 199_999 }) }), undefined);
	const fullAuto = await hooks.turn_end(boundary, { ...fullCtx, getContextUsage: () => ({ tokens: 200_000 }) });
	assert.equal(fullAuto.entries[0].type, "compaction", "Ultrafull publishes a real Pi checkpoint at its threshold");
	assert.equal(fullAuto.entries[0].details.compactionMode, "ultrafull");
	assert.equal(fullAuto.entries[0].details.compactionModel, "test/summary");
	assert.deepEqual(fullAuto.entries[0].details.files.read, ["source.md"]);
	assert.match(fullAuto.entries[0].summary, /Original request/);
	assert.equal(fullAuto.entries[0].firstKeptEntryId, "boundary-6", "the recent tool pair stays together");
	assert.equal(fullCalls, 1);
	assert.equal(fullAuto.entries[0].usage.output, 5);
	const fullSettings = JSON.parse(readFileSync(modeSettingsFile, "utf8"));
	fullSettings.workOrchestrator.context.compactAtTokens = 210_000;
	writeFileSync(modeSettingsFile, JSON.stringify(fullSettings));
	assert.equal(await hooks.turn_end(boundary, fullCtx), undefined, "an explicit threshold still overrides the 200k default");
	delete fullSettings.workOrchestrator.context.compactAtTokens;
	writeFileSync(modeSettingsFile, JSON.stringify(fullSettings));
	const smallerFull = await hooks.turn_end(boundary, { ...fullCtx,
		model: { ...fullCtx.model, contextWindow: 100_000 }, getContextUsage: () => ({ tokens: 99_999 }) });
	assert.equal(smallerFull.entries[0].type, "compaction", "small model windows lower the trigger safely");
	await assert.rejects(buildBoundaryCompaction(boundary, { ...fullCtx, signal: AbortSignal.abort() }, "ultrafull"), /cancelled/);
	await commands.research.handler("on", { ...fullCtx, isIdle: () => true, getContextUsage: () => ({ tokens: 1 }) });
	const fullNotebook = researchEntries.at(-1).data.notes;
	assert.equal(await hooks.turn_end(boundary, fullCtx), undefined, "research suspends automatic Ultrafull checkpoints");
	assert.equal(await hooks.session_before_compact({ preparation }, fullCtx), undefined, "research keeps native context-limit protection");
	await shortcuts.f8.handler(fullCtx);
	const fullForced = await hooks.turn_end(boundary, { ...fullCtx, getContextUsage: () => ({ tokens: 1 }) });
	assert.equal(fullForced.entries[0].details.compactionMode, "ultrafull", "busy F8 forces a real checkpoint even in research");
	assert.equal(aborts, abortsBeforeNative, "Ultrafull never aborts live tools");
	await shortcuts.f8.handler({ ...fullCtx, isIdle: () => true });
	const idleFull = await hooks.session_before_compact({ preparation }, fullCtx);
	assert.equal(idleFull.compaction.details.compactionModel, "test/summary", "idle F8 uses the same custom summarizer in research");
	manualOptions.onComplete({});
	let fullExitCompactions = 0;
	await commands.research.handler("off", { ...fullCtx, isIdle: () => true,
		getContextUsage: () => ({ tokens: 199_999 }), compact: () => { fullExitCompactions++; } });
	assert.equal(fullExitCompactions, 0, "exiting research does not trigger Ultrafull below 200k");
	rmSync(path.dirname(fullNotebook), { recursive: true, force: true });
	assert.equal(JSON.stringify(boundaryMessages), originalBoundary, "checkpoint generation never edits the raw transcript");
	resetContextFilter();
	const pixels = "AQIDBA==";
	const imageMessage = { role: "toolResult", toolName: "read", content: [
		{ type: "text", text: "Read image file [image/png]\n[Current model does not support images. The image will be omitted from this request.]" },
		{ type: "image", mimeType: "image/png", data: pixels },
	] };
	const visionCtx = { ...researchCtx, getContextUsage: () => ({ tokens: 1 }), model: { provider: "test", id: "text", input: ["text"] },
		modelRegistry: {
			find: (provider, id) => ({ provider, id, input: ["text", "image"] }),
			streamSimple(_model, request) {
				assert(request.messages[0].content.some(part => part.type === "image" && part.data === pixels));
				return { result: async () => ({ stopReason: "stop", content: [{ type: "text", text: "Error code 42; button disabled." }], usage: { input: 10, output: 8 } }) };
			},
		},
	};
	assert.equal(await hooks.context({ messages: [imageMessage] }, visionCtx), undefined, "models are presumed vision-capable unless selected");
	writeFileSync(path.join(cwd, ".pi", "settings.json"), JSON.stringify({ workOrchestrator: { visionModel: "__none_model__", nonVisionModels: ["test/text"] } }));
	const projected = await hooks.context({ messages: [imageMessage] }, visionCtx);
	assert.equal(imageMessage.content[1].data, pixels, "saved image remains untouched");
	assert.equal(projected.messages[0].content.some(part => part.type === "image"), false);
	assert.doesNotMatch(projected.messages[0].content[0].text, /image will be omitted/);
	const imageId = /img-[a-f0-9]{16}/.exec(JSON.stringify(projected.messages))[0];
	assert.equal((await hooks.context({ messages: [imageMessage] }, { ...visionCtx, model: { provider: "test", id: "text", input: ["text", "image"] } })).messages[0].content.some(part => part.type === "image"), false, "explicit non-vision overrides metadata");
	await assert.rejects(tools.process_image.execute("call", { image: imageId, question: "What is the error?" }, undefined, null, visionCtx), /Configure a vision model/);
	writeFileSync(path.join(cwd, ".pi", "settings.json"), JSON.stringify({ workOrchestrator: { visionModel: "test/vision", nonVisionModels: ["test/text", "test/vision"] } }));
	assert.equal(await hooks.context({ messages: [imageMessage] }, { ...visionCtx, model: { provider: "test", id: "vision" } }), undefined, "selected vision model always keeps images");
	const described = await tools.process_image.execute("call", { image: imageId, question: "What is the error?" }, undefined, null, visionCtx);
	assert.match(described.content[0].text, /Interpretation by test\/vision.*Error code 42/s);
	assert.equal(described.details.usage.output, 8);
	assert.equal((await tools.process_image.execute("call", { image: imageId, question: "What is the error?" }, undefined, null, visionCtx)).details.cached, true);
	await assert.rejects(tools.process_image.execute("call", { image: imageId, question: "" }, undefined, null, visionCtx), /specific image question/);
	await assert.rejects(tools.process_image.execute("call", { image: "img-0000000000000000", question: "What?" }, undefined, null, visionCtx), /expired or unknown/);
	assert.equal((await tools.process_image.execute("call", { image: imageId, question: "What is it?" }, undefined, null,
		{ ...visionCtx, modelRegistry: { find: () => ({ input: ["text"] }), streamSimple: visionCtx.modelRegistry.streamSimple } })).content[0].text.includes("Error code 42"), true, "selected vision model ignores stale image metadata");
	await assert.rejects(tools.process_image.execute("call", { image: imageId, question: "Read fine print" }, undefined, null,
		{ ...visionCtx, modelRegistry: { find: () => ({ input: ["text", "image"] }), streamSimple: () => ({ result: async () => ({ stopReason: "error", errorMessage: "private-provider-token" }) }) } }), /Vision model failed/);
	await assert.rejects(tools.process_image.execute("call", { image: imageId, question: "What is the error?" }, AbortSignal.abort(), null, visionCtx), /cancelled|abort/i);
	// Research is user-controlled; old auto settings cannot restore agent authority.
	const manualCtx = { ...fullCtx, getContextUsage: () => ({ tokens: 1 }) };
	await hooks.session_tree({}, { ...manualCtx, sessionManager: { ...manualCtx.sessionManager, getBranch: () => [] } });
	assert.equal(tools.research_mode, undefined);
	assert.doesNotMatch((await hooks.before_agent_start({ prompt: "Read a file and investigate a bug" }, manualCtx))?.systemPrompt ?? "", /RESEARCH MODE/);
	await hooks.session_tree({}, { ...manualCtx, sessionManager: { ...manualCtx.sessionManager, getBranch: () => [
		{ type: "custom", customType: "work-research-context", data: { mode: "off", notes: null, agentControl: true } },
	] } });
	assert.equal(tools.research_mode, undefined, "legacy auto-on setting cannot expose a control tool");
	const autoNotices = [];
	const entriesBeforeAuto = researchEntries.length;
	for (const action of ["auto", "auto on", "auto off"])
		await commands.research.handler(action, { ...manualCtx,
			ui: { ...manualCtx.ui, notify: message => autoNotices.push(message) },
			sendUserMessage: () => assert.fail("retired auto commands must not launch exploration"),
		});
	assert.equal(researchEntries.length, entriesBeforeAuto, "retired auto commands never change mode");
	assert.equal(autoNotices.length, 3);
	assert(autoNotices.every(message => message.includes("Automatic research was removed")));
	const manualNotebooks = new Set();
	for (const mode of ["native", "ultrafull", "ultracompact", "native-200k"]) {
		selectCompactMode(mode);
		const high = { ...manualCtx, getContextUsage: () => ({ tokens: 220_000 }) };
		await commands.research.handler("on", high);
		const entered = researchEntries.at(-1).data;
		assert.equal(entered.mode, "research");
		assert.equal("agentControl" in entered, false, "no auto permission is persisted");
		manualNotebooks.add(entered.notes);
		assert.match(researchWidgets.at(-1)[0], /RESEARCH MODE/);
		await tools.research_note.execute("manual-note", { note: "Manual research finding" });
		await commands.research.handler("off", { ...high, isIdle: () => true });
		assert.equal(researchEntries.at(-1).data.mode, "off");
		assert.match(readFileSync(entered.notes, "utf8"), /Manual research finding/);
	}
	selectCompactMode("ultrafull");
	const crowdedManualCtx = { ...manualCtx, getContextUsage: () => ({ tokens: 220_000 }) };
	assert.equal((await hooks.turn_end(boundary, crowdedManualCtx)).entries[0].type, "compaction", "ordinary Ultrafull threshold applies after manual exit");
	assert.equal(aborts, abortsBeforeNative, "manual transitions never abort live tools");
	for (const file of manualNotebooks) rmSync(path.dirname(file), { recursive: true, force: true });
	console.log("ok - compaction fallback, manual research and on-demand non-vision image bridge");
} finally {
	await hooks.session_shutdown?.({}, ctx);
	if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
	rmSync(cwd, { recursive: true, force: true });
}
