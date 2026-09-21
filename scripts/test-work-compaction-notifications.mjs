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
	requestContextFilter,
	resetContextFilter,
	stripProcessedPayloads,
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
let replyRunId = runId;
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
		(_, i) => `${i}: ` + "x".repeat(500),
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
	const activeMessages = [
		{ role: "user", content: "old " + "x".repeat(130_000) },
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
	const activeCtx = { ...ctx, model: { contextWindow: 200_000 } };
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
			JSON.stringify(result.messages).length / 4 < 40_000,
			"a 1M-window model must retain roughly 30k, not the entire 160k current turn",
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
	assert.match(newUserTail.messages[0].summary, /NEXT-REQUEST/);
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
