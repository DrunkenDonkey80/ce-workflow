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
	git: { head: "abc1234", status: [" M extensions/work-models.js"] },
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

process.stdout.write("ok - work compaction policy\n");
