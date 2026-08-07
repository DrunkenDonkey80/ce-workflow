import assert from "node:assert/strict";
import {
	AUTONOMOUS_GOAL_STATUSES,
	COMPACTION_PROFILES,
	compactionProfileFor,
	compactionThreshold,
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
for (const goalStatus of AUTONOMOUS_GOAL_STATUSES)
	assert.equal(
		compactionProfileFor({ goalStatus, targetId: "work-7.2" }),
		COMPACTION_PROFILES.AUTONOMOUS_GOAL,
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

const preparation = {
	messagesToSummarize: [
		{ role: "user", content: "Build the smallest correct parser.\r\nKeep CRLF safe." },
		{ role: "reasoning", content: "private chain of thought" },
		{
			role: "assistant",
			content: "I will inspect the parser.",
			toolCalls: [{ name: "read" }],
		},
		{ role: "toolResult", toolName: "read", content: "secret successful payload" },
		{
			role: "toolResult",
			toolName: "bash",
			isError: true,
			content: "TypeError: parser failed",
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
assert.match(freeform, /\[tool:read\] completed/);
assert.match(freeform, /TypeError: parser failed/);
assert.match(freeform, /src\/parser\.js/);
assert.doesNotMatch(freeform, /private chain of thought|secret successful payload/);
assert.doesNotMatch(freeform, /\/work-resume/);
assert.equal(freeform.includes("\r"), false);

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

console.log("ok - work compaction policy");
