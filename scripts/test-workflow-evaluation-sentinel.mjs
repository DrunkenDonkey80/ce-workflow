#!/usr/bin/env node
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	buildGoldenApproval,
	deriveCalibration,
	requiresSentinel,
	runGoldenUpdate,
	runSentinelExperiment,
	validateGoldenApproval,
} from "./workflow-evaluation.mjs";

const sourceRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
function readJson(file) {
	try {
		return JSON.parse(readFileSync(file, "utf8"));
	} catch (error) {
		throw new Error(
			`invalid JSON ${file}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}
const csv = path.join(
	sourceRoot,
	"benchmarks",
	"workflow-evaluation",
	"v1",
	"projects",
	"csv-expenses",
);
const approval = buildGoldenApproval(csv, {
	approved: true,
	approvedBy: "fixture-human",
	approvedAt: "2026-07-15T00:00:00.000Z",
	acceptancePassed: true,
	evidence: "fixture",
});
assert.equal(validateGoldenApproval(csv, approval).approved, true);
assert.throws(
	() => validateGoldenApproval(csv, { ...approval, planSha: "0".repeat(64) }),
	/stale/,
);
assert.throws(
	() => validateGoldenApproval(csv, { ...approval, approved: false }),
	/approval/,
);
assert.throws(
	() => validateGoldenApproval(csv, { ...approval, acceptancePassed: false }),
	/acceptance/,
);

const updateRoot = mkdtempSync(
	path.join(os.tmpdir(), "ce-golden-update-fixture-"),
);
try {
	const bundle = path.join(
		updateRoot,
		"benchmarks",
		"workflow-evaluation",
		"v1",
	);
	mkdirSync(path.join(bundle, "projects"), { recursive: true });
	cpSync(
		path.join(
			sourceRoot,
			"benchmarks",
			"workflow-evaluation",
			"v1",
			"manifest.json",
		),
		path.join(bundle, "manifest.json"),
	);
	cpSync(csv, path.join(bundle, "projects", "csv-expenses"), {
		recursive: true,
	});
	const updated = runGoldenUpdate(
		{
			mode: "golden-update",
			project: "csv-expenses",
			humanApproved: true,
			approvedBy: "fixture-human",
			approvedAt: "2026-07-15T00:00:00.000Z",
			acceptancePassed: true,
			acceptanceEvidence: "fixture",
			contractChanged: false,
		},
		{ sourceRoot: updateRoot, evidenceRoot: path.join(updateRoot, "evidence") },
	);
	const manifest = readJson(updated.manifestPath);
	assert.deepEqual(
		manifest.approvals["csv-expenses"],
		readJson(updated.approvalPath),
	);
} finally {
	rmSync(updateRoot, { recursive: true, force: true });
}

const calibration = deriveCalibration([
	{
		baseline: { tokens: 100, wallMs: 1000 },
		candidate: { tokens: 102, wallMs: 980 },
	},
	{
		baseline: { tokens: 100, wallMs: 1000 },
		candidate: { tokens: 98, wallMs: 1010 },
	},
	{
		baseline: { tokens: 100, wallMs: 1000 },
		candidate: { tokens: 101, wallMs: 1005 },
	},
]);
assert.ok(calibration.minimumImprovement >= 0.05);
assert.ok(calibration.maximumDimensionRegression >= 0.1);
assert.ok(calibration.tokenCeiling >= 102);
assert.ok(calibration.wallMsCeiling >= 1010);

assert.equal(requiresSentinel(["skills/ce-plan/SKILL.md"], "handoff"), true);
assert.equal(
	requiresSentinel(["extensions/work-models.js"], "default-behavior"),
	true,
);
assert.equal(requiresSentinel(["agents/work-worker.md"], "agent"), true);
assert.equal(requiresSentinel(["README.md"], "docs"), false);
assert.equal(requiresSentinel(["unknown/new-surface.mjs"], "narrow"), true);

const handoffs = [];
const sentinel = await runSentinelExperiment(
	{ mode: "sentinel", projects: ["calculator", "csv-expenses"], sourceRoot },
	{
		skipApproval: true,
		initializeWorkspace() {},
		async runStage({ project, side, stage, input, inputSource }) {
			handoffs.push({ project, side, stage, input, inputSource });
			return {
				status: "completed",
				artifact: `${project}-${side}-${stage}-actual`,
				verifier: { passed: true },
				metrics: { tokens: 1, wallMs: 1 },
			};
		},
		async verifyProject() {
			return { passed: true };
		},
	},
);
assert.equal(sentinel.status, "passed");
assert.equal(handoffs.length, 12);
for (const project of ["calculator", "csv-expenses"]) {
	for (const side of ["baseline", "candidate"]) {
		const flow = handoffs.filter(
			(item) => item.project === project && item.side === side,
		);
		assert.equal(flow[1].input, `${project}-${side}-brainstorm-actual`);
		assert.equal(flow[1].inputSource, "actual:brainstorm");
		assert.equal(flow[2].input, `${project}-${side}-plan-actual`);
		assert.equal(flow[2].inputSource, "actual:plan");
	}
}

const partial = await runSentinelExperiment(
	{ mode: "sentinel", projects: ["csv-expenses"], sourceRoot },
	{
		skipApproval: true,
		initializeWorkspace() {},
		async runStage({ stage }) {
			return stage === "plan"
				? { status: "failed", failure: "plan" }
				: {
						status: "completed",
						artifact: "actual",
						verifier: { passed: true },
						metrics: { tokens: 1, wallMs: 1 },
					};
		},
		async verifyProject() {
			return { passed: true };
		},
	},
);
assert.equal(partial.status, "failed");
assert.equal(partial.projects[0].stages.length, 2);
process.stdout.write(
	"ok - workflow evaluation calibration, approval, and sentinel fixtures\n",
);
