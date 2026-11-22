import assert from "node:assert/strict";
import {
	COMPACTION_PROFILES,
	compactionThreshold,
	contextFilterCutIndex,
	filesFromOps,
	formatCompactionSummary,
	latestCompactionNote,
	COMPACTION_NOTE_MAX,
	replayCost,
	retainedHistoryBudget,
	tightenPreparation,
	addCost,
	lunaCompactionWarning,
} from "../extensions/work-compaction.ts";

assert.match(lunaCompactionWarning("openai-codex/gpt-6-luna"), /24%[\s\S]*Terra 60%[\s\S]*Astra 6\.2 93%/);
assert.equal(lunaCompactionWarning("openai-codex/gpt-6.2-astra"), undefined);
assert.equal(lunaCompactionWarning("none"), undefined);

{
	// Kept tail is measured by real reply cost: hidden reasoning (usage.output) counts, visible text alone does not.
	const visible = (message) => Math.ceil(JSON.stringify(message.content).length / 4);
	const cost = replayCost(visible);
	const reply = (output) => ({ role: "assistant", content: [{ type: "thinking", thinking: "short" }], usage: { output } });
	assert.equal(cost(reply(5000)), 5000, "encrypted reasoning counts at its billed size");
	assert.equal(cost({ role: "toolResult", content: "x".repeat(400), usage: { output: 9999 } }), visible({ content: "x".repeat(400) }), "only replies count output");
	assert.equal(cost(reply(0)), visible(reply(0)), "no usage keeps the estimate");
	const entries = [
		{ id: "u1", type: "message", message: { role: "user", content: "start" } },
		{ id: "a1", type: "message", message: reply(8000) },
		{ id: "t1", type: "message", message: { role: "toolResult", content: "r" } },
		{ id: "a2", type: "message", message: reply(8000) },
		{ id: "t2", type: "message", message: { role: "toolResult", content: "r" } },
		{ id: "a3", type: "message", message: reply(8000) },
		{ id: "t3", type: "message", message: { role: "toolResult", content: "r" } },
	];
	const toMessages = (entry) => [entry.message];
	const prepared = { firstKeptEntryId: "u1", messagesToSummarize: [{ role: "user", content: "old" }], turnPrefixMessages: [], tokensBefore: 1 };
	const tight = tightenPreparation(prepared, entries, 20_000, cost, toMessages);
	assert.equal(tight.firstKeptEntryId, "a2", "keeps up to 20k by real cost and never cuts at a tool result");
	assert.equal(tightenPreparation(prepared, entries, 12_000, cost, toMessages).firstKeptEntryId, "a3", "the reply that crosses the budget is summarized, not kept");
	assert.equal(tightenPreparation(prepared, entries, 5_000, cost, toMessages).firstKeptEntryId, "a3", "a last reply over the budget alone is still kept");
	assert.equal(tightenPreparation({ ...prepared, firstKeptEntryId: "a2" }, entries, 12_000, cost, toMessages).firstKeptEntryId, "a3", "Pi's first kept reply is summarized when it crosses the budget");
	assert.deepEqual(tight.messagesToSummarize.map((message) => message.content), ["old", "start", entries[1].message.content, "r"], "passed messages join the summary in order");
	assert.equal(tightenPreparation(prepared, entries, 100_000, cost, toMessages), prepared, "a budget the tail fits keeps Pi's cut");
	assert.equal(tightenPreparation(prepared, entries, 12_000, visible, toMessages), prepared, "by visible text alone the tail fits, the old under-count");
	assert.equal(tightenPreparation({ ...prepared, firstKeptEntryId: "a3" }, entries, 12_000, cost, toMessages).firstKeptEntryId, "a3", "never moves the cut back");
	// Billed prompts show the real tail: tool results that tokenize denser than chars/4 still count in full.
	const billed = (output, prompt) => ({ ...reply(output), usage: { output, input: 2, cacheRead: prompt, cacheWrite: 0 } });
	const dense = [
		{ id: "u1", type: "message", message: { role: "user", content: "start" } },
		{ id: "a1", type: "message", message: billed(100, 10_000) },
		{ id: "t1", type: "message", message: { role: "toolResult", content: "r" } },
		{ id: "a2", type: "message", message: billed(100, 20_000) },
		{ id: "t2", type: "message", message: { role: "toolResult", content: "r" } },
		{ id: "a3", type: "message", message: billed(100, 30_000) },
	];
	assert.equal(tightenPreparation(prepared, dense, 8_000, cost, toMessages).firstKeptEntryId, "a3", "real prompts, not the tiny estimate, decide the cut");
	assert.equal(tightenPreparation(prepared, dense, 15_000, cost, toMessages).firstKeptEntryId, "a2", "the tail from a2 is 10.1k real");
	assert.equal(tightenPreparation(prepared, dense, 25_000, cost, toMessages), prepared, "a 20.1k real tail fits 25k");
	assert.equal(tightenPreparation({ ...prepared, firstKeptEntryId: "gone" }, entries, 12_000, cost, toMessages).firstKeptEntryId, "gone");
	for (const history of [entries, dense]) {
		for (const keep of [20_000, 5_000, 8_000, 12_000, 15_000, 25_000, 100_000, 0]) {
			const manual = tightenPreparation(prepared, history, keep, cost, toMessages);
			const cut = contextFilterCutIndex(history.map(entry => entry.message), keep, keep, cost);
			assert.equal(history[cut ?? 0].id, manual.firstKeptEntryId, `manual and boundary cuts agree at ${keep} tokens`);
		}
	}
	const hugeLastResult = [...entries.slice(0, -1), { id: "huge-last-result", type: "message", message: { role: "toolResult", content: "x".repeat(160_000) } }];
	assert.equal(tightenPreparation(prepared, hugeLastResult, 1_000, cost, toMessages).firstKeptEntryId, "a3", "an oversized final result keeps only its assistant group, not the whole history");
	const custom = [...entries.slice(0, 1), { id: "large-custom", type: "message", message: { role: "custom", content: "x".repeat(160_000) } }, ...entries.slice(1)];
	const customCut = contextFilterCutIndex(custom.map(entry => entry.message), 30_000, 30_000, cost);
	assert.equal(custom[customCut].id, "a1", "oversized custom message goes into the summary, not the kept tail");
}

{
	const estimate = message => message.tokens;
	const messages = [{ role: "system", tokens: 19_000 }, { role: "user", tokens: 1_000 },
		{ role: "assistant", tokens: 100, usage: { input: 1_000, cacheRead: 38_000, cacheWrite: 1_000 } }];
	assert.equal(retainedHistoryBudget(messages, 30_000, 4_000, estimate), 4_000, "50k total includes measured prompt overhead and summary reserve");
	assert.equal(retainedHistoryBudget([], 30_000, 8_000, estimate), 30_000, "history cap still applies with no overhead");
	assert.equal(retainedHistoryBudget([{ role: "system", tokens: 60_000 }], 30_000, 8_000, estimate), 0, "oversized fixed prompt leaves only the last indivisible turn");
	assert.equal(retainedHistoryBudget(messages, 1_000, 4_000, estimate), 1_000, "smaller model-specific retention is respected");
}

assert.equal(latestCompactionNote([]), "");
assert.equal(
	latestCompactionNote([
		{ role: "assistant", content: [{ type: "toolCall", name: "compaction_note", arguments: { note: "old" } }] },
		{ role: "assistant", content: [{ type: "toolCall", name: "compaction_note", arguments: { note: " new " } }, { type: "toolCall", name: "read", arguments: { path: "a" } }] },
		{ role: "assistant", content: [{ type: "toolCall", name: "compaction_note", arguments: { note: "" } }] },
	]),
	"new",
);
assert.equal(
	latestCompactionNote([
		{ role: "assistant", content: [{ type: "toolCall", name: "compaction_note", arguments: { note: "fits" } }] },
		{ role: "assistant", content: [{ type: "toolCall", name: "compaction_note", arguments: { note: "x".repeat(COMPACTION_NOTE_MAX + 1) } }] },
	]),
	"fits",
	"a note the tool rejected as too long is not used",
);

const threshold = (contextWindow, overrides = {}) =>
	compactionThreshold({
		compactAtTokens: 150_000,
		contextWindow,
		keepRecentTokens: 30_000,
		maxSummaryChars: 12_000,
		...overrides,
	});

assert.equal(threshold(undefined).trigger, 150_000);
for (const [window, expected] of [
	[8_000, 4_000],
	[16_000, 8_000],
	[32_000, 16_000],
	[64_000, 32_000],
]) {
	const result = threshold(window);
	assert.equal(result.trigger, expected);
	assert.ok(result.trigger <= result.ceiling);
	assert.ok(result.headroom > 0);
}
assert.equal(threshold(272_000).trigger, 150_000);





assert.doesNotThrow(() =>
	formatCompactionSummary({
		preparation: { messagesToSummarize: {}, fileOps: null },
	}),
);
assert.doesNotThrow(() => formatCompactionSummary({ preparation: null }));
assert.deepEqual(
	filesFromOps({
		readFiles: ["src\\z.js", "src/a.js", "src\\z.js"],
		modifiedFiles: ["test\\b.js", "test/b.js"],
	}),
	{ read: ["src/a.js", "src/z.js"], modified: ["test/b.js"] },
);
assert.deepEqual(
	filesFromOps({
		read: new Set(["src/a.js", "src/b.js"]),
		written: new Set(["src/c.js"]),
		edited: new Set(["src/b.js"]),
	}),
	{ read: ["src/a.js"], modified: ["src/b.js", "src/c.js"] },
);

const preparation = {
	messagesToSummarize: [
		{
			role: "user",
			content: "Build the smallest correct parser.\r\nKeep CRLF safe.",
		},
		{ role: "reasoning", content: "private chain of thought" },
		{
			role: "assistant",
			content: [
				{ type: "text", text: "I will inspect the parser." },
				{
					type: "toolCall",
					id: "read-1",
					name: "read",
					arguments: { path: "src/parser.js" },
				},
			],
		},
		{
			role: "toolResult",
			toolCallId: "read-1",
			toolName: "read",
			content: [{ type: "text", text: "secret successful payload" }],
		},
		{
			role: "assistant",
			content: [
				{
					type: "toolCall",
					id: "bash-1",
					name: "bash",
					arguments: { command: "node test-parser.mjs" },
				},
			],
		},
		{
			role: "toolResult",
			toolCallId: "bash-1",
			toolName: "bash",
			isError: true,
			content: [{ type: "text", text: "TypeError: parser failed" }],
		},
	],
	fileOps: {
		readFiles: ["src\\parser.js", "src/parser.js"],
		modifiedFiles: ["test\\parser.test.js"],
	},
	firstKeptEntryId: "entry-1",
	tokensBefore: 80_000,
};

const freeform = formatCompactionSummary({ preparation });
assert.match(freeform, /compact context \(freeform\)/);
assert.match(freeform, /Build the smallest correct parser/);
assert.match(freeform, /\[tool:read completed\].*src\/parser\.js/s);
assert.match(freeform, /TypeError: parser failed/);
assert.match(freeform, /src\/parser\.js/);
assert.doesNotMatch(
	freeform,
	/private chain of thought|secret successful payload/,
);

assert.equal(freeform.includes("\r"), false);

const expandedRequests = formatCompactionSummary({
	preparation: {
		messagesToSummarize: Array.from({ length: 9 }, (_, index) => ({
			role: "user",
			content: `request-${index + 1} ${"x".repeat(150)}`,
		})),
	},
});
assert.match(
	expandedRequests,
	/request-1 /,
	"short requests fill the character budget",
);
assert.match(expandedRequests, /request-9 /);

const verification = formatCompactionSummary({
	preparation: {
		messagesToSummarize: [
			{
				role: "assistant",
				content: [
					{
						type: "toolCall",
						id: "verify-1",
						name: "bash",
						arguments: { command: "node focused-check.mjs" },
					},
				],
			},
			{
				role: "toolResult",
				toolCallId: "verify-1",
				toolName: "bash",
				content: [
					{
						type: "text",
						text: `3 passed, 0 failed START ${"x".repeat(2_000)} END`,
					},
				],
			},
			{
				role: "assistant",
				content: [
					{
						type: "toolCall",
						id: "decision-1",
						name: "ask_user",
						arguments: { question: "Choose safe or fast" },
					},
				],
			},
			{
				role: "toolResult",
				toolCallId: "decision-1",
				toolName: "ask_user",
				content: [{ type: "text", text: "User chose safe rollout" }],
			},
		],
	},
});
assert.match(verification, /3 passed, 0 failed START/);
assert.match(verification, /END/);
assert.match(verification, /User chose safe rollout/);
assert.ok(verification.length <= 12_000);

const paused = formatCompactionSummary({
	profile: COMPACTION_PROFILES.FREEFORM,
	preparation,
	currentMessages: [
		{ role: "user", content: "Fix the current parser request." },
	],
	goal: { id: "wg-old", status: "paused", objective: "Old unrelated goal" },

});
assert.match(paused, /## Objective\nFix the current parser request\./);
assert.match(paused, /Goal wg-old remains paused/);
assert.doesNotMatch(paused, /Continue the active autonomous goal/);

const longTurn = [
	{ role: "assistant", content: `old prefix ${"z".repeat(2_000)}` },
	{ role: "user", content: "REQ-SENTINEL: preserve this exact request" },
	...Array.from({ length: 24 }, (_, index) => [
		{
			role: "assistant",
			content: [
				{
					type: "toolCall",
					id: `call-${index}`,
					name: "bash",
					arguments: { command: `echo ${index}` },
				},
			],
		},
		{
			role: "toolResult",
			toolCallId: `call-${index}`,
			toolName: "bash",
			content: `result ${index} ${"r".repeat(160)}`,
		},
	]).flat(),
];
assert.equal(contextFilterCutIndex(longTurn, 200, 100_000), 1);
const splitCut = contextFilterCutIndex(longTurn, 200, 100);
assert.ok(splitCut > 1);
assert.notEqual(longTurn[splitCut].role, "toolResult");
const splitSummary = formatCompactionSummary({
	preparation: { messagesToSummarize: longTurn.slice(0, splitCut) },
	currentMessages: longTurn,
});
assert.match(splitSummary, /REQ-SENTINEL: preserve this exact request/);
for (let keep = 1; keep <= 500; keep += 13) {
	const cut = contextFilterCutIndex(longTurn, keep, 100);
	if (cut !== null) assert.notEqual(longTurn[cut].role, "toolResult");
}

const interruptedAfterWrite = formatCompactionSummary({
	preparation: {
		messagesToSummarize: [
			{ role: "toolResult", toolName: "write", content: "completed" },
			...Array.from({ length: 15 }, (_, index) => ({
				role: "assistant",
				content: `Older distinct progress ${index}`,
			})),
			{ role: "toolResult", toolName: "write", content: "completed" },
			{
				role: "assistant",
				stopReason: "aborted",
				errorMessage: "This operation was aborted",
				content: [],
			},
		],
	},
});
assert.match(
	interruptedAfterWrite,
	/\[tool:write completed\]/,
	"the newest successful tool boundary survives duplicate compaction noise",
);
assert.doesNotMatch(interruptedAfterWrite, /This operation was aborted/);











const goal = { id: "native-goal", objective: "Finish the current task without losing decisions.", status: "active" };
const nativeGoal = formatCompactionSummary({ preparation, goal, maxSummaryChars: 4000 });
assert.match(nativeGoal, /<goal-state>/);
assert.match(nativeGoal, /native-goal/);
assert.match(nativeGoal, /Finish the current task without losing decisions/);






const noisy = {
	...preparation,
	messagesToSummarize: Array.from({ length: 80 }, (_, index) => ({
		role: index % 3 === 0 ? "user" : "assistant",
		content: `${index}: ${"long context ".repeat(80)}`,
	})),
};
const bounded = formatCompactionSummary({

	preparation: noisy,

	maxSummaryChars: 4_000,
});
assert.ok(bounded.length <= 4_000);
assert.match(bounded, /omitted by compaction budget/);



let previousSummary = "Legacy context that should survive once.";
for (let generation = 0; generation < 5; generation += 1) {
	previousSummary = formatCompactionSummary({

		preparation: { ...preparation, previousSummary },

		maxSummaryChars: 4_000,
	});
	assert.ok(previousSummary.length <= 4_000);

	assert.equal(
		(previousSummary.match(/## ce-workflow compact context/g) ?? []).length,
		1,
	);
}

// pi-subagents 0.77+ PARENT_WAKE_TEXT (src/shared/parent-wake.js).
const SUBAGENT_WAKE_0_77 = "Inspect subagent updates above. Answer pending supervisor requests within your authority. For completed work, read saved results and resume the already-authorized parent task, or report completion. If approval is required, explicitly ask the user. Do not silently yield, rerun completed work, or infer new authorization.";
const machineFiltered = formatCompactionSummary({

	preparation: {
		messagesToSummarize: [
			{
				role: "user",
				content: "Human correction: preserve this exact preference.",
			},
			{
				role: "user",
				content: "Subagent updates above.",
			},
			{
				role: "user",
				content: "New intercom message above.",
			},
			{ role: "user", content: SUBAGENT_WAKE_0_77 },
			{ role: "user", content: "Compaction is complete. Resume the parent task now" },
			{
				role: "custom",
				customType: "work-knowledge",
				content: "STALE-KNOWLEDGE-MUST-NOT-RECUR",
			},
		],
	},
	goal: { ...goal, status: "active" },
});
assert.match(
	machineFiltered,
	/Human correction: preserve this exact preference/,
);
assert.doesNotMatch(
	machineFiltered,
	/Subagent updates above|Inspect subagent updates|New intercom message above|Compaction is complete|STALE-KNOWLEDGE-MUST-NOT-RECUR/,
);

let pinnedHuman = "";
for (let generation = 0; generation < 15; generation += 1) {
	pinnedHuman = formatCompactionSummary({

		preparation: {
			previousSummary: pinnedHuman,
			messagesToSummarize: [
				...(generation === 0
					? [{ role: "user", content: "PINNED-HUMAN-CORRECTION" }]
					: []),
				{
					role: "user",
					content: "Subagent updates above.",
				},
			],
		},
		goal: { ...goal, status: "active" },
	});
	assert.equal(
		(pinnedHuman.match(/PINNED-HUMAN-CORRECTION/g) ?? []).length,
		2,
		`generation ${generation + 1} retains one objective and one latest request without growth`,
	);
	const earlier = pinnedHuman.match(
		/## Earlier compacted context\n([\s\S]*?)(?=\n## |$)/,
	)?.[1];
	assert.doesNotMatch(
		earlier ?? "",
		/Latest user requests|Decisions and blockers|Changes and verification/,
	);
}

const knowledgeOne =
	'<durable-knowledge untrusted="true">\n- [k-one|human|live|matched:explicit] COMPACTION-KNOWLEDGE-ONE\n</durable-knowledge>';
const knowledgeTwo =
	'<durable-knowledge untrusted="true">\n- [k-two|human|live|matched:explicit] COMPACTION-KNOWLEDGE-TWO\n</durable-knowledge>';
let knowledgeSummary = "";
for (let generation = 0; generation < 15; generation += 1) {
	let knowledge = "";
	if (generation < 10) knowledge = knowledgeOne;
	else if (generation === 10) knowledge = knowledgeTwo;
	const input = {

		preparation: { ...preparation, previousSummary: knowledgeSummary },

		knowledge,
		maxSummaryChars: 4_000,
	};
	knowledgeSummary = formatCompactionSummary(input);
	assert.equal(knowledgeSummary, formatCompactionSummary(input));
	assert.ok(knowledgeSummary.length <= 4_000);
	assert.equal(
		(knowledgeSummary.match(/## Durable knowledge/g) ?? []).length,
		knowledge ? 1 : 0,
	);
	assert.equal(
		(knowledgeSummary.match(/<durable-knowledge/g) ?? []).length,
		knowledge ? 1 : 0,
	);
	assert.equal(
		(knowledgeSummary.match(/k-one/g) ?? []).length,
		generation < 10 ? 1 : 0,
	);
	assert.equal(
		(knowledgeSummary.match(/k-two/g) ?? []).length,
		generation === 10 ? 1 : 0,
	);
}

const saturatedKnowledge = formatCompactionSummary({

	preparation: noisy,

	knowledge: `<durable-knowledge untrusted="true">${" knowledge".repeat(500)}</durable-knowledge>`,
	maxSummaryChars: 4_000,
});
assert.ok(saturatedKnowledge.length <= 4_000);
assert.match(saturatedKnowledge, /## Objective/);
assert.match(saturatedKnowledge, /## Next action/);

assert.match(saturatedKnowledge, /## Durable knowledge/);

const foreignPrevious = formatCompactionSummary({
	preparation: {
		previousSummary:
			'foreign summary\n<durable-knowledge untrusted="true">STALE-FOREIGN-CLAIM</durable-knowledge>\nkeep this',
	},
});
assert.doesNotMatch(foreignPrevious, /STALE-FOREIGN-CLAIM/);
assert.match(foreignPrevious, /keep this/);

const { compactMemory, decodeMemory, gather, fallbackMemory, coreText } = await import("../extensions/work-compaction-memory.ts");
const messages = [
	{ role: "user", content: "Keep the supplier rollover and approval rule." },
	{ role: "toolResult", toolName: "inspect", content: "Supplier rollover is 07:15 UTC; independent approval required." },
];
let calls = 0;
let responseMode = "valid";
const registry = {
	find: (provider, id) => provider === "test" && id === "summary" ? { provider, id } : undefined,
	streamSimple(_model, context, options) {
		calls++;
		assert.equal(options.reasoning, "low");
		assert.equal(context.tools, undefined);
		const task = context.messages[0].content[0].text;
		let source;
		try {
			const payload = JSON.parse(task.slice(task.indexOf('\n') + 1));
			source = payload.knowledge?.[0]?.sources[0] ?? payload.delta[1]?.source ?? JSON.parse(decodeMemory(payload.previous).tail).knowledge[0].sources[0];
		}
		catch (error) { assert.fail(`Invalid compaction request JSON: ${error.message}`); }
		const text = responseMode === "invalid" ? "not JSON" : JSON.stringify({
			checkpoint: responseMode === "large" ? "x".repeat(17000) : "Rollover 07:15 UTC; independent approval required.",
			knowledge: [{ claim: "Supplier rollover is 07:15 UTC.", status: "observed", sources: [responseMode === "citation" ? "invented:1" : source] }],
		});
		return { result: async () => ({ content: [{ type: "text", text }], stopReason: "stop", usage: { input: 50, output: 20 } }) };
	},
};
const local = await compactMemory({ messages, registry, currentModel: "test/summary" });
assert.equal(calls, 0, "None must never request a model");
assert.equal(local.mode, "cleaned");
assert.match(local.summary, /07:15 UTC/);
assert.deepEqual(local.knowledge, []);
const hybrid = await compactMemory({ messages, registry, model: "test/summary" });
assert.equal(calls, 1, "summary and extraction share one call");
assert.equal(hybrid.mode, "hybrid");
assert.equal(hybrid.knowledge.length, 1);
assert.equal(hybrid.usage.output, 20);
assert.equal(hybrid.attempts[0].rejectedResponse, undefined, "accepted responses are not duplicated in diagnostics");
assert.equal(decodeMemory(hybrid.summary).records.filter(r => r.kind === "user-request").length, 1);
const later = [
	{ role: "assistant", content: [{ type: "toolCall", id: "edit", name: "edit", arguments: { path: "src/a.js" } }] },
	{ role: "toolResult", toolName: "edit", toolCallId: "edit", content: "Changed after the last tests." },
	...messages.slice(1),
];
for (const invalid of ["invalid", "citation"]) {
	responseMode = invalid;
	const failed = await compactMemory({ messages: later, previousSummary: hybrid.summary, registry, model: "test/summary" });
	assert.equal(failed.mode, "fallback");
	assert.match(failed.summary, /07:15 UTC/);
	assert(failed.summary.includes(decodeMemory(hybrid.summary).tail));
	assert(decodeMemory(failed.summary).records.some(r => r.tool === "edit"));
	assert.deepEqual(failed.knowledge, [], "rejected output cannot create knowledge");
	assert.equal(failed.usage.output, 20, "the rejected call still incurs usage");
	assert(failed.summary.length <= 32000);
}
assert.equal(calls, 3, "invalid output preserves local memory without another call");
const switchedOff = await compactMemory({ messages: later, previousSummary: hybrid.summary, registry });
assert.equal(calls, 3);
assert.match(switchedOff.summary, /07:15 UTC/);
const unavailable = await compactMemory({ messages, registry, model: "missing/model" });
assert.equal(unavailable.mode, "fallback");
assert.equal(calls, 3);
await assert.rejects(compactMemory({ messages, registry, model: "test/summary", signal: AbortSignal.abort() }), /cancelled/);
assert.equal(calls, 3);
const longRequest = "Keep all original requirements. ".repeat(2200);
const protectedMemory = await compactMemory({ messages: [{ role: "user", content: longRequest }], registry });
assert.equal(decodeMemory(protectedMemory.summary).records[0].text, longRequest, "32k rolling target must not reject or clip protected user history");
assert(protectedMemory.summary.length > 32000);
const protectedAgain = await compactMemory({ messages: [{ role: "user", content: longRequest }], previousSummary: protectedMemory.summary, registry });
assert.equal(decodeMemory(protectedAgain.summary).records.length, 1, "replaying the same source does not duplicate protected history");
const longWithTail = await compactMemory({ messages: [{ role: "user", content: longRequest }], previousSummary: hybrid.summary, registry, limit: 8000 });
assert(longWithTail.summary.includes(decodeMemory(hybrid.summary).tail), "preserve prior checkpoint even when user core exceeds the target");
assert(decodeMemory(longWithTail.summary).records.some(record => record.text === longRequest));
// Generated Plan3 prompts are not carried verbatim, and summaries that already hold them heal.
const plan3Prompt = "Plan3: before executing, tag phases.\nPlan3: execute/resume the plan at \"p.md\".\n" + "resume packet ".repeat(5000);
const plan3Memory = await compactMemory({ messages: [{ role: "user", content: plan3Prompt }, { role: "user", content: longRequest }], registry });
const plan3Records = decodeMemory(plan3Memory.summary).records;
assert.match(plan3Records[0].text, /^Plan3: before executing, tag phases\. \[generated Plan3 prompt, \d+ chars omitted/);
assert.equal(plan3Records[1].text, longRequest, "typed user requests stay verbatim");
assert(plan3Memory.summary.length < longRequest.length + 2000);
const bloated = protectedMemory.summary.replace(JSON.stringify(longRequest), JSON.stringify("One-time before executing: x\n" + longRequest));
assert.match(decodeMemory(bloated).records[0].text, /^One-time before executing: x \[generated Plan3 prompt/, "summaries holding old prompts heal");
// Hub script-timer output is evidence, not a protected request; message timers and older summaries holding timers follow suit.
const timerText = "\u23f0 Scheduled (script timer a1079f6a): " + "build log line\n".repeat(400);
const timerRecords = gather([{ role: "user", content: timerText }, { role: "user", content: "\u23f0 Scheduled (message timer b2c3d4e5): check the queue" }]);
assert.deepEqual(timerRecords.map(r => [r.kind, r.tool]), [["tool-result", "schedule"], ["user-request", undefined]]);
assert(timerRecords[0].result.omittedChars > 0, "long timer output is cut like other tool output");
const oldTimer = protectedMemory.summary.replace(JSON.stringify(longRequest), JSON.stringify(timerText));
assert.equal(decodeMemory(oldTimer).records[0].tool, "schedule", "summaries holding timer output heal");
let oversizedCalls = 0;
const oversizedFallback = await compactMemory({ messages: [{ role: "user", content: "z".repeat(300_000) }], model: "test/small",
	registry: { find: () => ({ contextWindow: 100_000 }), streamSimple: () => { oversizedCalls++; throw new Error("Must not reach ACP"); } } });
assert.equal(oversizedCalls, 0, "oversized hybrid requests never enter ACP's preflight retry loop");
assert.equal(oversizedFallback.mode, "fallback");
assert.equal(decodeMemory(oversizedFallback.summary).records[0].text.length, 300_000);
// Large tool output is trimmed/dropped (oldest first) to fit the compactor instead of skipping it.
const bulky = [{ role: "user", content: "Keep the rollover rule." }, ...Array.from({ length: 300 }, (_, i) =>
	({ role: "toolResult", toolName: "bash", content: `run ${i} ` + "y".repeat(5000) }))];
let fittedTask;
const fitted = await compactMemory({ messages: bulky, model: "test/small", registry: { find: () => ({ contextWindow: 100_000 }),
	streamSimple: (_m, context) => { fittedTask = context.messages[0].content[0].text; let delta;
		try { delta = JSON.parse(fittedTask.slice(fittedTask.indexOf("\n") + 1)).delta; } catch (error) { assert.fail(`Invalid compaction request JSON: ${error.message}`); }
		return { result: async () => ({ content: [{ type: "text", text: JSON.stringify({ checkpoint: "ok", knowledge: [{ claim: "c", status: "observed", sources: [delta.at(-1).source] }] }) }], stopReason: "stop" }) }; } } });
assert.equal(fitted.mode, "hybrid", "oversized tool output no longer forces fallback");
assert(Buffer.byteLength(fittedTask, "utf8") <= 100_000);
assert.match(fittedTask, /older records omitted/);
assert.match(fittedTask, /Keep the rollover rule/, "protected requests survive fitting");
assert.match(fittedTask, /run 299 /, "newest evidence survives fitting");
const records = gather(later);
const frame = { coreRecords: [], core: coreText([]) };
const preserved = fallbackMemory(frame, decodeMemory(hybrid.summary).tail, records, 32000);
assert(preserved.memory.includes(JSON.stringify(records.find(r => r.tool === "edit"))));
// Only the selected model is tried, even when a different current model is supplied.
async function attemptCase(primary, options = {}) {
	const attempted = [];
	const result = await compactMemory({
		messages, previousSummary: hybrid.summary, model: "test/summary", currentModel: "test/current", ...options,
		registry: {
			find: (provider, id) => primary === "unavailable" && id === "summary" ? undefined : { provider, id },
			streamSimple(selected, context, request) {
				attempted.push(selected.id);
				const outcome = primary;
				if (outcome === "throw") throw new Error("Provider unavailable");
				responseMode = outcome;
				const response = registry.streamSimple(selected, context, request);
				return { result: async () => {
					const value = await response.result();
					value.usage.cost = { input: 0.1, output: 0.2, total: 0.3, totalFromProvider: true };
					if (outcome === "aborted") value.stopReason = "aborted";
					if (outcome === "cancel") options.controller.abort();
					return value;
				} };
			},
		},
	});
	return { result, attempted };
}
for (const reason of ["invalid", "citation", "throw", "unavailable", "aborted"]) {
	const { result, attempted } = await attemptCase(reason);
	assert.equal(result.mode, "fallback", reason);
	assert.deepEqual(attempted, reason === "unavailable" ? [] : ["summary"]);
	assert.equal(result.attempts.length, 1);
	assert(result.attempts[0].error);
	assert(result.summary.includes(decodeMemory(hybrid.summary).tail));
	const rejected = result.attempts[0].rejectedResponse;
	if (["throw", "unavailable"].includes(reason)) {
		assert.equal(result.usage, undefined);
		assert.equal(rejected, undefined, "no response is invented for a request that never returned");
	} else {
		assert.equal(result.usage.output, 20);
		assert.equal(result.usage.cost.total, 0.3);
		assert.equal(result.usage.cost.totalFromProvider, true);
		assert(rejected, `rejected ${reason} response must be retained`);
		assert.equal(rejected.maxChars, 8000);
		assert.equal(rejected.responseChars, rejected.text.length);
		assert.equal(rejected.stopReason, reason === "aborted" ? "aborted" : "stop");
		if (reason !== "aborted") assert(!result.summary.includes(rejected.text), "rejected text stays out of continuation memory");
		if (reason === "invalid") assert.equal(rejected.text, "not JSON");
	}
}
// Combined cost is provider-billed only when every part is; money still adds up.
assert.deepEqual(addCost(addCost(undefined, { total: 1, totalFromProvider: true }), { total: 2, totalFromProvider: true }), { total: 3, totalFromProvider: true });
assert.deepEqual(addCost(addCost(undefined, { total: 1, totalFromProvider: true }), { total: 2 }), { total: 3, totalFromProvider: false });
assert.deepEqual(addCost(addCost(undefined, { input: 1, total: 1 }), { input: 2, total: 2 }), { input: 3, total: 3, totalFromProvider: false });
// Retain the whole visible response, including malformed JSON and its suffix, but not credentials or hidden reasoning.
const diagnosticText = `not JSON: token=diagnostic-secret-value\n${"д".repeat(410_000)}\nEND-OF-REJECTED-RESPONSE`;
const diagnosticResult = await compactMemory({ messages, model: "test/summary", registry: {
	find: () => ({}), streamSimple: () => ({ result: async () => ({ stopReason: "length",
		content: [{ type: "thinking", thinking: "private-reasoning" }, { type: "text", text: diagnosticText }],
	}) }),
} });
const diagnostic = diagnosticResult.attempts[0].rejectedResponse;
assert.equal(diagnostic?.text, diagnosticText.replace("diagnostic-secret-value", "[REDACTED]"), "diagnostics redact secrets without truncating the response");
assert.equal(diagnostic.responseChars, diagnosticText.length, "length is measured before redaction");
assert.equal(diagnostic.stopReason, "length");
assert.doesNotMatch(JSON.stringify(diagnosticResult), /diagnostic-secret-value|private-reasoning/);
assert.doesNotMatch(diagnosticResult.summary, /END-OF-REJECTED-RESPONSE/);
const sameModel = await attemptCase("invalid", { currentModel: "test/summary" });
assert.deepEqual(sameModel.attempted, ["summary"]);
assert.equal(sameModel.result.mode, "fallback");
assert.deepEqual((await attemptCase("valid")).attempted, ["summary"]);
const controller = new AbortController();
const beforeCancel = calls;
await assert.rejects(attemptCase("cancel", { controller, signal: controller.signal }), /cancelled/);
assert.equal(calls, beforeCancel + 1, "user cancellation must not retry on the current model");
// Subagent/intercom idle-wake prompts are not user requests; real requests survive.
const wakeRequests = gather([
	{ role: "user", content: "Subagent updates above." },
	{ role: "user", content: [{ type: "text", text: " New intercom message above.\n" }] },
	{ role: "user", content: SUBAGENT_WAKE_0_77 },
	{ role: "user", content: "Fix the parser." },
	{ role: "user", content: "Subagent updates above. Summarize them for me." },
], [], "wake").filter(r => r.kind === "user-request").map(r => r.text);
assert.deepEqual(wakeRequests, ["Fix the parser.", "Subagent updates above. Summarize them for me."]);
// A malformed JSON line in a prior summary is skipped, not fatal.
const { header } = await import("../extensions/work-compaction-memory.ts");
assert.deepEqual(decodeMemory(`${header}{broken\n{"source":"s","kind":"user-request","text":"t"}\n`).records, [{ source: "s", kind: "user-request", text: "t" }]);

// Protected history stays bounded: answers keep question, answer and picked descriptions; 5 requests stay verbatim, older ones age
// into the checkpoint only through a validated model answer; a failure keeps everything.
{
	const ask = { questions: [{ question: "Which store?", context: "x".repeat(5000), options: [{ title: "SQLite (Recommended)", description: "One file, no server." }, { title: "Postgres", description: "y".repeat(3000) }] }, { question: "Never asked in the text?", options: [{ title: "Yes" }] }] };
	const answer = "User answered 1 of 2 questions:\n1. Which store? → SQLite (Recommended) — keep backups\n2. Other → (skipped)";
	const [record] = gather([{ role: "assistant", content: [{ type: "toolCall", id: "q", name: "ask_user", arguments: ask }] }, { role: "toolResult", toolName: "ask_user", toolCallId: "q", content: answer + "z".repeat(3000) }], [], "ask");
	assert.deepEqual(Object.keys(record).sort(), ["failed", "kind", "picked", "questions", "result", "source", "tool"], "no arguments");
	assert.equal(record.result.text.length, answer.length + 3000, "a fresh answer is never excerpted");
	assert.deepEqual([record.picked, record.questions], [["SQLite (Recommended): One file, no server."], ["Never asked in the text?"]]);
	// A summary written before this change heals at the next compaction, and normalizing again keeps the picked description.
	const legacy = `${header}{"source":"old:1","kind":"tool-result","tool":"ask_user","arguments":${JSON.stringify(ask)},"failed":false,"result":{"text":${JSON.stringify(answer)}}}\n`;
	const healed = decodeMemory(legacy).records[0];
	assert.deepEqual([healed.arguments, healed.picked], [undefined, record.picked]);
	assert.deepEqual(decodeMemory(`${header}${JSON.stringify(healed)}\n`).records[0], healed);

	const requests = Array.from({ length: 25 }, (_, i) => ({ role: "user", content: `Request ${i}: rule ${i}.` }));
	let seen, reply = "valid";
	const model = { find: (provider, id) => ({ provider, id }), streamSimple(_m, context) {
		const task = context.messages[0].content[0].text;
		// Like the real prompt asks: keep the old knowledge, add the aging requests as decisions.
		let old;
		try { seen = JSON.parse(task.slice(task.indexOf("\n") + 1)); old = seen.previous ? JSON.parse(seen.previous).knowledge : []; } catch (error) { assert.fail(`Invalid compaction request JSON: ${error.message}`); }
		seen.task = task.slice(0, task.indexOf("\n"));
		const text = reply === "invalid" ? "nope" : JSON.stringify({ checkpoint: "Rules still apply.", knowledge: [...old, ...(seen.aging ?? []).map(r => ({ claim: r.text, status: "decision", sources: [r.source] }))] });
		return { result: async () => ({ content: [{ type: "text", text }], stopReason: "stop" }) };
	} };
	const rolled = await compactMemory({ messages: requests, registry: model, model: "test/summary" });
	assert.equal(rolled.mode, "hybrid");
	// One invented citation among many drops that fact only; mostly invented ones still reject the answer (the "citation" case above).
	const { validateMemory } = await import("../extensions/work-compaction-memory.ts");
	const facts = ["a", "b", "c", "d"].map(source => ({ claim: source, status: "observed", sources: [source] }));
	assert.deepEqual(validateMemory(JSON.stringify({ checkpoint: "x", knowledge: [...facts, { claim: "e", status: "observed", sources: ["a", "a:70"] }] }), new Set("abcd")).knowledge, facts);
	assert.throws(() => validateMemory(JSON.stringify({ checkpoint: "x", knowledge: [facts[0], { ...facts[1], sources: ["z"] }] }), new Set("a")), /unknown citation/);
	// A stray `}]` or fence after the object (seen live) keeps the answer; no object at all still fails.
	assert.equal(validateMemory("```json\n{\"checkpoint\":\"x\",\"knowledge\":[]}] }]}\n```", new Set()).tail, '{"checkpoint":"x","knowledge":[]}');
	assert.throws(() => validateMemory("not JSON", new Set()), /Invalid memory JSON/);
	assert.deepEqual(seen.aging.map(r => r.text), requests.slice(0, 20).map(m => m.content), "the 20 oldest go to the model as aging");
	assert(!seen.delta.some(r => seen.aging.some(a => a.source === r.source)), "aging is not sent twice");
	assert.match(seen.task, /"aging" holds older user requests/);
	assert.deepEqual(decodeMemory(rolled.summary).records.map(r => r.text), requests.slice(20).map(m => m.content), "5 stay verbatim");
	assert.match(rolled.summary, /Request 0: rule 0\./, "the aged request lives on as cited knowledge");
	// Next round: the model gets the checkpoint, not the raw summary; citations to aged sources stay valid.
	const next = await compactMemory({ messages: [{ role: "user", content: "Request 25." }], previousSummary: rolled.summary, registry: model, model: "test/summary" });
	assert.equal(next.mode, "hybrid", next.fallback);
	assert.deepEqual(seen.aging.map(r => r.text), ["Request 20: rule 20."]);
	assert.equal(seen.previous, decodeMemory(rolled.summary).tail, "the model input is the checkpoint, not the whole previous summary");
	assert.match(next.summary, /Request 0: rule 0\./, "old citations survive the next round");
	// A failed checkpoint keeps every request verbatim: nothing ages out without a summary.
	reply = "invalid";
	const kept = await compactMemory({ messages: requests, registry: model, model: "test/summary" });
	assert.equal(kept.mode, "fallback");
	assert.equal(decodeMemory(kept.summary).records.filter(r => r.kind === "user-request").length, 25);
	// The checkpoint gets real room even when 20 long requests fill the target (it used to get about 1k and failed).
	reply = "valid";
	await compactMemory({ messages: Array.from({ length: 20 }, () => ({ role: "user", content: "w".repeat(3000) })), registry: model, model: "test/summary", limit: 32000 });
	assert.match(seen.task, /Target 8000 characters including JSON/);
	assert.doesNotMatch(seen.task, /hard maximum/);
}
process.stdout.write("ok - work compaction policy, one selected-model call, preserved-memory fallback, usage, cancellation, bounded protected history\n");
