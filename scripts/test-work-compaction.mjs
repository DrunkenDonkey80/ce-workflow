import assert from "node:assert/strict";
import {
	AUTONOMOUS_GOAL_STATUSES,
	COMPACTION_PROFILES,
	compactionProfileFor,
	compactionThreshold,
	contextFilterCutIndex,
	filesFromOps,
	formatCompactionSummary,
} from "../extensions/work-compaction.js";

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
assert.deepEqual(AUTONOMOUS_GOAL_STATUSES, ["active"]);
assert.equal(
	compactionProfileFor({ goalStatus: "active", targetId: "work-7.2" }),
	COMPACTION_PROFILES.AUTONOMOUS_GOAL,
);
assert.equal(
	compactionProfileFor({ goalStatus: "paused" }),
	COMPACTION_PROFILES.FREEFORM,
);
assert.equal(
	compactionProfileFor({ targetId: "work-7.2" }),
	COMPACTION_PROFILES.WORK_RESUME,
);
assert.equal(compactionProfileFor(), COMPACTION_PROFILES.FREEFORM);
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
assert.doesNotMatch(freeform, /\/work-resume/);
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
	durable: { available: true },
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

const durable = {
	available: true,
	target: {
		id: "work-7.2",
		title: "Adopt deterministic compaction",
		status: "in_progress",
		description: "Preserve authoritative workflow state.",
		acceptance: "All focused lifecycle fixtures pass.",
	},
	decisionsAndBlockers: [
		{ id: "work-7.3", type: "decision", status: "open", title: "Choose rollout" },
	],
	verification: ["node scripts/test-work-compaction.mjs passes"],
	nextAction: "Run /work-resume work-7.2.",
	git: { head: "abc1234", status: [" M extensions/work-models.ts"] },
};
const work = formatCompactionSummary({
	profile: COMPACTION_PROFILES.WORK_RESUME,
	preparation,
	durable,
	maxSummaryChars: 4_000,
});
assert.match(work, /compact context \(work-resume\)/);
assert.match(work, /work-7\.2/);
assert.match(work, /All focused lifecycle fixtures pass/);
assert.match(work, /work-7\.3/);
assert.match(work, /Run \/work-resume work-7\.2/);
assert.ok(work.length <= 4_000);
assert.equal(
	work,
	formatCompactionSummary({
		profile: COMPACTION_PROFILES.WORK_RESUME,
		preparation,
		durable,
		maxSummaryChars: 4_000,
	}),
);

const goal = {
	id: "wg-1",
	mode: "project",
	objective: "Finish the active roadmap without losing decisions.",
	status: "needs_human",
	iteration: 4,
	pendingDecision: "Choose safe or fast rollout.",
};
const autonomous = formatCompactionSummary({
	profile: COMPACTION_PROFILES.AUTONOMOUS_GOAL,
	preparation,
	durable: { ...durable, nextAction: undefined },
	goal,
	maxSummaryChars: 4_000,
});
assert.match(autonomous, /compact context \(autonomous-goal\)/);
assert.match(autonomous, /Finish the active roadmap/);
assert.match(autonomous, /Choose safe or fast rollout/);
assert.match(autonomous, /Resolve the pending human decision/);

const noisy = {
	...preparation,
	messagesToSummarize: Array.from({ length: 80 }, (_, index) => ({
		role: index % 3 === 0 ? "user" : "assistant",
		content: `${index}: ${"long context ".repeat(80)}`,
	})),
};
const bounded = formatCompactionSummary({
	profile: COMPACTION_PROFILES.WORK_RESUME,
	preparation: noisy,
	durable: {
		...durable,
		target: { ...durable.target, acceptance: "required acceptance ".repeat(120) },
	},
	maxSummaryChars: 4_000,
});
assert.ok(bounded.length <= 4_000);
assert.match(bounded, /omitted by compaction budget/);
assert.match(bounded, /work-7\.2/);
assert.match(bounded, /Run \/work-resume work-7\.2/);

let previousSummary = "Legacy context that should survive once.";
for (let generation = 0; generation < 5; generation += 1) {
	previousSummary = formatCompactionSummary({
		profile: COMPACTION_PROFILES.WORK_RESUME,
		preparation: { ...preparation, previousSummary },
		durable,
		maxSummaryChars: 4_000,
	});
	assert.ok(previousSummary.length <= 4_000);
	assert.match(previousSummary, /work-7\.2/);
	assert.match(previousSummary, /All focused lifecycle fixtures pass/);
	assert.equal(
		(previousSummary.match(/## ce-workflow compact context/g) ?? []).length,
		1,
	);
}

const machineFiltered = formatCompactionSummary({
	profile: COMPACTION_PROFILES.AUTONOMOUS_GOAL,
	preparation: {
		messagesToSummarize: [
			{
				role: "user",
				content: "Human correction: preserve this exact preference.",
			},
			{
				role: "user",
				content: "<!-- work-goal-continuation:wg-1:2:x --> Continue",
			},
			{
				role: "user",
				content: "<work_goal_objective>machine objective</work_goal_objective>",
			},
			{ role: "user", content: "ORCHESTRATOR_RUN_V1 synthetic transport" },
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
	/work-goal-continuation|machine objective|ORCHESTRATOR_RUN_V1|STALE-KNOWLEDGE-MUST-NOT-RECUR/,
);

let pinnedHuman = "";
for (let generation = 0; generation < 15; generation += 1) {
	pinnedHuman = formatCompactionSummary({
		profile: COMPACTION_PROFILES.AUTONOMOUS_GOAL,
		preparation: {
			previousSummary: pinnedHuman,
			messagesToSummarize: [
				...(generation === 0
					? [{ role: "user", content: "PINNED-HUMAN-CORRECTION" }]
					: []),
				{
					role: "user",
					content: `<!-- work-goal-continuation:wg-1:${generation}:x --> Continue`,
				},
			],
		},
		goal: { ...goal, status: "active" },
	});
	assert.equal(
		(pinnedHuman.match(/PINNED-HUMAN-CORRECTION/g) ?? []).length,
		1,
		`human correction survives generation ${generation + 1} exactly once`,
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
		profile: COMPACTION_PROFILES.WORK_RESUME,
		preparation: { ...preparation, previousSummary: knowledgeSummary },
		durable,
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
	profile: COMPACTION_PROFILES.WORK_RESUME,
	preparation: noisy,
	durable,
	knowledge: `<durable-knowledge untrusted="true">${" knowledge".repeat(500)}</durable-knowledge>`,
	maxSummaryChars: 4_000,
});
assert.ok(saturatedKnowledge.length <= 4_000);
assert.match(saturatedKnowledge, /## Objective/);
assert.match(saturatedKnowledge, /## Next action/);
assert.match(saturatedKnowledge, /Run \/work-resume work-7\.2/);
assert.match(saturatedKnowledge, /## Durable knowledge/);

const foreignPrevious = formatCompactionSummary({
	preparation: {
		previousSummary:
			'foreign summary\n<durable-knowledge untrusted="true">STALE-FOREIGN-CLAIM</durable-knowledge>\nkeep this',
	},
});
assert.doesNotMatch(foreignPrevious, /STALE-FOREIGN-CLAIM/);
assert.match(foreignPrevious, /keep this/);

const { compactMemory, decodeMemory, gather, fallbackMemory, coreText } = await import("../extensions/work-compaction-memory.js");
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
		try { source = JSON.parse(task.slice(task.indexOf('\n') + 1)).delta[1].source; }
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
assert.equal(decodeMemory(hybrid.summary).records.filter(r => r.kind === "user-request").length, 1);
const later = [
	{ role: "assistant", content: [{ type: "toolCall", id: "edit", name: "edit", arguments: { path: "src/a.js" } }] },
	{ role: "toolResult", toolName: "edit", toolCallId: "edit", content: "Changed after the last tests." },
	...messages.slice(1),
];
for (const invalid of ["invalid", "large", "citation"]) {
	responseMode = invalid;
	const failed = await compactMemory({ messages: later, previousSummary: hybrid.summary, registry, model: "test/summary" });
	assert.equal(failed.mode, "fallback");
	assert.match(failed.summary, /07:15 UTC/);
	assert(failed.summary.includes(decodeMemory(hybrid.summary).tail));
	assert(decodeMemory(failed.summary).records.some(r => r.tool === "edit"));
	assert.deepEqual(failed.knowledge, [], "rejected output cannot create knowledge");
	assert.equal(failed.usage.output, 20, "rejected output still incurs usage");
	assert(failed.summary.length <= 32000);
}
assert.equal(calls, 4, "without a current model, failures go straight to cleaned memory");
const switchedOff = await compactMemory({ messages: later, previousSummary: hybrid.summary, registry });
assert.equal(calls, 4);
assert.match(switchedOff.summary, /07:15 UTC/);
const unavailable = await compactMemory({ messages, registry, model: "missing/model" });
assert.equal(unavailable.mode, "fallback");
assert.equal(calls, 4);
await assert.rejects(compactMemory({ messages, registry, model: "test/summary", signal: AbortSignal.abort() }), /cancelled/);
assert.equal(calls, 4);
await assert.rejects(compactMemory({ messages: [{ role: "user", content: "x".repeat(32000) }], registry }), /overflow/);
const records = gather(later);
const frame = { coreRecords: [], core: coreText([]) };
const preserved = fallbackMemory(frame, decodeMemory(hybrid.summary).tail, records, 32000);
assert(preserved.memory.includes(JSON.stringify(records.find(r => r.tool === "edit"))));
// Each model gets at most one attempt; retain usage even for rejected responses.
async function retryCase(primary, secondary = "valid", options = {}) {
	const attempted = [];
	const result = await compactMemory({
		messages, previousSummary: hybrid.summary, model: "test/summary", currentModel: "test/current", ...options,
		registry: {
			find: (provider, id) => primary === "unavailable" && id === "summary" ? undefined : { provider, id },
			streamSimple(selected, context, request) {
				attempted.push(selected.id);
				const outcome = selected.id === "summary" ? primary : secondary;
				if (outcome === "throw") throw new Error("Provider unavailable");
				responseMode = outcome;
				const response = registry.streamSimple(selected, context, request);
				return { result: async () => {
					const value = await response.result();
					value.usage.cost = { input: 0.1, output: 0.2, total: 0.3 };
					if (outcome === "aborted") value.stopReason = "aborted";
					if (outcome === "cancel") options.controller.abort();
					return value;
				} };
			},
		},
	});
	return { result, attempted };
}
for (const reason of ["invalid", "large", "citation", "throw", "unavailable", "aborted"]) {
	const { result, attempted } = await retryCase(reason);
	assert.equal(result.mode, "hybrid", reason);
	assert.equal(result.model, "test/current");
	assert.deepEqual(attempted, reason === "unavailable" ? ["current"] : ["summary", "current"]);
	assert.equal(result.attempts.length, 2);
	assert(result.attempts[0].error);
	const responses = ["throw", "unavailable"].includes(reason) ? 1 : 2;
	assert.equal(result.usage.output, 20 * responses);
	assert.equal(result.usage.cost.total, 0.3 * responses);
}
const doubleFailure = await retryCase("invalid", "invalid");
assert.equal(doubleFailure.result.mode, "fallback");
assert.deepEqual(doubleFailure.attempted, ["summary", "current"]);
assert(doubleFailure.result.summary.includes(decodeMemory(hybrid.summary).tail));
assert.equal(doubleFailure.result.usage.output, 40);
assert.deepEqual(doubleFailure.result.knowledge, []);
const sameModel = await retryCase("invalid", "valid", { currentModel: "test/summary" });
assert.deepEqual(sameModel.attempted, ["summary"]);
assert.equal(sameModel.result.mode, "fallback");
assert.deepEqual((await retryCase("valid")).attempted, ["summary"]);
const controller = new AbortController();
const beforeCancel = calls;
await assert.rejects(retryCase("cancel", "valid", { controller, signal: controller.signal }), /cancelled/);
assert.equal(calls, beforeCancel + 1, "user cancellation must not retry on the current model");
process.stdout.write("ok - work compaction policy, selected/current/cleaned fallback, bounded attempts, usage, cancellation\n");
