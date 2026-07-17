#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	critiqueEnvelope,
	replayCritiqueCase,
	verifyRoleCaseOutput,
	visibleRoleCase,
} from "./workflow-evaluation.mjs";
import { fingerprint } from "./workflow-evaluation-contract.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const requiredRoles = [
	"main-brainstorm",
	"work-planner",
	"work-migrator",
	"work-worker",
	"work-fixer",
	"work-debugger",
	"work-reviewer",
	"work-committer",
	"work-advisor",
	"work-advisor-backup",
];
function readCorpus(project) {
	const file = path.join(
		root,
		"benchmarks",
		"workflow-evaluation",
		"v1",
		"role-cases",
		project,
		"corpus.json",
	);
	try {
		return JSON.parse(readFileSync(file, "utf8"));
	} catch (error) {
		throw new Error(
			`invalid ${project} role corpus: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

for (const project of ["calculator", "csv-expenses"]) {
	const corpus = readCorpus(project);
	assert.equal(corpus.version, 1);
	assert.deepEqual(
		corpus.roles.map((role) => role.role),
		requiredRoles,
	);
	assert.deepEqual(Object.keys(corpus.partitions), [
		"clean",
		"seeded",
		"holdout",
	]);
	for (const role of requiredRoles)
		for (const partition of ["clean", "seeded", "holdout"]) {
			const first = visibleRoleCase(corpus, role, partition);
			const second = visibleRoleCase(corpus, role, partition);
			assert.equal(fingerprint(first), fingerprint(second));
			assert.equal(first.freeze.seed, corpus.freeze.seed);
			assert.equal(first.freeze.reviser.id, "fixed-reviser-v1");
			assert.ok(first.freeze.tools.length > 0);
			assert.ok(first.freeze.budgets.tokens > 0);
			const visible = JSON.stringify(first);
			const authority = corpus.partitions[partition].authority;
			for (const hidden of [
				authority.defectId,
				authority.expectedFix,
				authority.canary,
				"product-contract.md",
				"acceptance/",
			])
				assert.equal(visible.includes(hidden), false);
		}
	assert.equal(
		verifyRoleCaseOutput(corpus, "clean", "behavior verified").passed,
		true,
	);
	assert.equal(
		verifyRoleCaseOutput(corpus, "seeded", "unverified").passed,
		false,
	);
}

const corpus = readCorpus("calculator");
const role = "work-advisor";
const partition = "seeded";
const visible = visibleRoleCase(corpus, role, partition);
const arm = visible.arm;
const base = {
	targetArm: arm,
	visibleFingerprint: fingerprint(visible),
	deliveredAtMs: corpus.freeze.deliveryAtMs,
	reviserId: corpus.freeze.reviser.id,
	cost: { tokens: 100, wallMs: 50 },
};
const empty = critiqueEnvelope(arm);
const emptyReplay = replayCritiqueCase(corpus, role, partition, {
	...base,
	envelope: empty,
	events: [{ id: "empty-consumed", type: "critique-consumed" }],
});
assert.equal(empty.kind, "empty");
assert.equal(emptyReplay.credit, false);
assert.deepEqual(emptyReplay.cost, { tokens: 100, wallMs: 50 });

const critique = critiqueEnvelope(arm, [
	{ id: "finding-1", summary: "Correct the observable edge case." },
]);
const successfulEvents = [
	{ id: "event-1", type: "critique-consumed" },
	{ id: "event-2", type: "finding-accepted", findingId: "finding-1" },
	{ id: "event-3", type: "finding-applied", findingId: "finding-1" },
	{ id: "event-4", type: "revision-verified", passed: true },
];
const successful = replayCritiqueCase(corpus, role, partition, {
	...base,
	envelope: critique,
	events: successfulEvents,
});
assert.equal(successful.credit, true);
assert.deepEqual(successful.creditedFindings, ["finding-1"]);
assert.equal(
	successful.replayFingerprint,
	replayCritiqueCase(corpus, role, partition, {
		...base,
		envelope: critique,
		events: successfulEvents,
	}).replayFingerprint,
);
for (const run of [
	{
		...base,
		targetArm: "work-advisor:holdout",
		envelope: critique,
		events: [],
	},
	{ ...base, visibleFingerprint: "changed", envelope: critique, events: [] },
	{ ...base, deliveredAtMs: 51, envelope: critique, events: [] },
	{ ...base, reviserId: "other-reviser", envelope: critique, events: [] },
	{ ...base, envelope: { ...critique, findings: [] }, events: [] },
	{
		...base,
		envelope: critique,
		events: [
			{ id: "duplicate", type: "critique-consumed" },
			{ id: "duplicate", type: "revision-verified", passed: true },
		],
	},
])
	assert.throws(() => replayCritiqueCase(corpus, role, partition, run));

for (const events of [
	[],
	[
		{ id: "event-1", type: "critique-consumed" },
		{ id: "event-2", type: "finding-accepted", findingId: "finding-1" },
	],
	[...successfulEvents, { id: "event-5", type: "regression-detected" }],
]) {
	const replay = replayCritiqueCase(corpus, role, partition, {
		...base,
		envelope: critique,
		events,
	});
	assert.equal(replay.credit, false);
	assert.deepEqual(replay.cost, { tokens: 100, wallMs: 50 });
}

process.stdout.write("ok - workflow evaluation critique replay fixtures\n");
