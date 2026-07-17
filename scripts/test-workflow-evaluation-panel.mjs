#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	blindArtifacts,
	evaluatePanel,
	pairedUncertainty,
	paretoFrontier,
	recommendationOutcome,
} from "./workflow-evaluation-score.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let priceTable;
try {
	priceTable = JSON.parse(
		readFileSync(
			path.join(
				root,
				"benchmarks",
				"workflow-evaluation",
				"v1",
				"pricing.example.json",
			),
			"utf8",
		),
	);
} catch (error) {
	throw new Error(
		`invalid pricing fixture: ${error instanceof Error ? error.message : String(error)}`,
	);
}

const rubric = {
	anchors: [0, 1, 2, 3, 4],
	dimensions: ["quality", "traceability"],
	criticalDimensions: ["traceability"],
};
const blindedA = blindArtifacts(
	{ text: "first", path: "/authority/baseline", timestamp: 1 },
	{ text: "second", config: { model: "candidate" } },
	rubric,
	() => Buffer.from([0]),
);
const blindedB = blindArtifacts(
	{ text: "first", path: "/authority/baseline", timestamp: 1 },
	{ text: "second", config: { model: "candidate" } },
	rubric,
	() => Buffer.from([1]),
);
for (const input of [blindedA.evaluatorInput, blindedB.evaluatorInput])
	assert.doesNotMatch(
		JSON.stringify(input),
		/baseline|candidate|authority|timestamp|config|provider|model|other evaluator/i,
	);
assert.notDeepEqual(blindedA.control.mapping, blindedB.control.mapping);

const identityA = { provider: "openai", model: "gpt-judge-v1" };
const identityB = { provider: "anthropic", model: "claude-judge-v1" };
const candidateScores = {
	baseline: { quality: 3, traceability: 3 },
	candidate: { quality: 4, traceability: 3 },
};
const agreeing = evaluatePanel(
	[
		{ status: "completed", identity: identityA, scores: candidateScores },
		{ status: "completed", identity: identityB, scores: candidateScores },
	],
	rubric,
	{
		expectedIdentities: ["openai/gpt-judge-v1", "anthropic/claude-judge-v1"],
	},
);
assert.equal(agreeing.status, "panel-agreement");
assert.equal(agreeing.winner, "candidate");
assert.equal(
	recommendationOutcome(agreeing, { status: "candidate-accepted" }).status,
	"candidate-accepted",
);
assert.equal(
	recommendationOutcome(null, {}).reason,
	"evaluator-panel-required",
);

const baselineScores = {
	baseline: { quality: 4, traceability: 3 },
	candidate: { quality: 3, traceability: 3 },
};
const disagreement = evaluatePanel(
	[
		{ identity: identityA, scores: candidateScores },
		{ identity: identityB, scores: baselineScores },
	],
	rubric,
);
assert.equal(disagreement.status, "evaluator-disagreement-no-winner");
assert.equal(
	recommendationOutcome(disagreement, {}).status,
	disagreement.status,
);

const criticalDisagreement = evaluatePanel(
	[
		{ identity: identityA, scores: candidateScores },
		{
			identity: identityB,
			scores: {
				baseline: { quality: 3, traceability: 4 },
				candidate: { quality: 4, traceability: 2 },
			},
		},
	],
	rubric,
);
assert.equal(criticalDisagreement.status, "evaluator-disagreement-no-winner");
for (const invalid of [
	[{ identity: identityA, scores: candidateScores }],
	[
		{ identity: identityA, scores: candidateScores },
		{ status: "timeout", identity: identityB, scores: candidateScores },
	],
	[
		{ identity: identityA, scores: candidateScores },
		{ identity: identityB, scores: { baseline: {}, candidate: {} } },
	],
	[
		{ identity: identityA, scores: candidateScores },
		{ identity: identityA, scores: candidateScores },
	],
])
	assert.equal(evaluatePanel(invalid, rubric).status, "invalid");
assert.equal(
	evaluatePanel(
		[
			{ identity: identityA, scores: candidateScores },
			{ identity: identityB, scores: baselineScores },
		],
		rubric,
		{
			expectedDefectId: "seeded-1",
			objectiveEvidence: {
				defectId: "seeded-1",
				passed: true,
				winner: "candidate",
			},
		},
	).winner,
	"candidate",
);
assert.equal(
	evaluatePanel(
		[
			{ identity: identityA, scores: candidateScores },
			{ identity: identityB, scores: baselineScores },
		],
		rubric,
		{
			expectedDefectId: "seeded-1",
			objectiveEvidence: {
				defectId: "other-defect",
				passed: true,
				winner: "candidate",
			},
		},
	).status,
	"evaluator-disagreement-no-winner",
);
assert.deepEqual(pairedUncertainty([10, 12, -1], 2), {
	median: 10,
	min: -1,
	max: 12,
	positive: 2,
	negative: 0,
	withinNoise: 1,
	noiseFloor: 2,
});

const candidates = [
	{
		id: "incumbent",
		quality: 3,
		tokens: 100,
		wallMs: 100,
		toolCalls: 10,
		retries: 1,
		questions: 1,
		rework: 5,
		criticOverhead: 0,
		usage: { input: 70, output: 20, reasoning: 5, cacheRead: 5, cacheWrite: 0 },
	},
	{
		id: "challenger",
		quality: 3,
		tokens: 80,
		wallMs: 90,
		toolCalls: 8,
		retries: 0,
		questions: 1,
		rework: 3,
		criticOverhead: 2,
		usage: { input: 50, output: 20, reasoning: 5, cacheRead: 5, cacheWrite: 0 },
	},
];
const comparable = paretoFrontier(candidates, {
	priceTable,
	priceFingerprint: priceTable.fingerprint,
});
assert.equal(comparable.priceComparable, true);
assert.equal(comparable.lowerCostClaimAllowed, true);
assert.equal(
	comparable.observations.every((item) => item.normalizedBilledCost > 0),
	true,
);
assert.deepEqual(
	comparable.frontier.map((item) => item.id),
	["incumbent", "challenger"],
);
assert.deepEqual(comparable.metrics, [
	"quality",
	"tokens",
	"normalizedBilledCost",
	"wallMs",
	"toolCalls",
	"retries",
	"questions",
	"rework",
	"criticOverhead",
]);
const incompletePrice = paretoFrontier(candidates, {
	priceTable: {
		...priceTable,
		prices: { input: 1, output: 1 },
	},
	priceFingerprint: priceTable.fingerprint,
});
assert.equal(incompletePrice.priceComparable, false);
assert.equal(incompletePrice.lowerCostClaimAllowed, false);
assert.equal(incompletePrice.observations[0].normalizedBilledCost, null);

process.stdout.write(
	"ok - workflow evaluation dual panel and Pareto fixtures\n",
);
