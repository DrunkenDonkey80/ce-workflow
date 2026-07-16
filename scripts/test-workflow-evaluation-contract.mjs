#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	auditStageInput,
	fingerprint,
	validateBundle,
	validateExperimentPair,
} from "./workflow-evaluation-contract.mjs";
import { validateGoldenApproval } from "./workflow-evaluation.mjs";

function readJson(file) {
	try {
		return JSON.parse(readFileSync(file, "utf8"));
	} catch (error) {
		throw new Error(
			`invalid JSON ${file}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

const manifest = {
	version: 1,
	projects: ["calculator", "csv-expenses"],
	hiddenResources: ["product-contract.md", "acceptance"],
	metrics: [
		"tokens",
		"wallMs",
		"toolCalls",
		"subagentCalls",
		"toolOutputChars",
		"retries",
		"contextTokens",
		"questions",
	],
	depths: {
		smoke: { samples: 1, tokenCeiling: 1000, wallMsCeiling: 1000 },
		decision: { samples: 3, tokenCeiling: 3000, wallMsCeiling: 3000 },
		sentinel: { samples: 1, tokenCeiling: 5000, wallMsCeiling: 5000 },
		calibration: { samples: 3, tokenCeiling: 3000, wallMsCeiling: 3000 },
	},
	rubric: {
		version: 1,
		anchors: [0, 1, 2, 3, 4],
		criticalDimensions: ["quality"],
	},
	approvals: {
		calculator: {
			approved: true,
			approvedBy: "fixture",
			approvedAt: "2026-07-15T00:00:00Z",
			acceptancePassed: true,
			evidence: "fixture",
			bundleSha: "a".repeat(64),
			brainstormSha: "b".repeat(64),
			planSha: "c".repeat(64),
		},
		"csv-expenses": {
			approved: true,
			approvedBy: "fixture",
			approvedAt: "2026-07-15T00:00:00Z",
			acceptancePassed: true,
			evidence: "fixture",
			bundleSha: "d".repeat(64),
			brainstormSha: "e".repeat(64),
			planSha: "f".repeat(64),
		},
	},
};

const reordered = Object.fromEntries(Object.entries(manifest).toReversed());
assert.equal(fingerprint(manifest), fingerprint(reordered));
assert.equal(validateBundle(manifest).version, 1);
for (const mutation of [
	(m) => delete m.metrics,
	(m) => delete m.depths.smoke.tokenCeiling,
	(m) => delete m.rubric.anchors,
	(m) => delete m.rubric.criticalDimensions,
	(m) => delete m.approvals.calculator,
	(m) => delete m.hiddenResources,
]) {
	const broken = structuredClone(manifest);
	mutation(broken);
	assert.throws(() => validateBundle(broken));
}

const roles = [
	"main",
	"work-planner",
	"work-migrator",
	"work-worker",
	"work-fixer",
	"work-debugger",
	"work-reviewer",
	"work-advisor",
	"work-advisor-backup",
];
function completeRoleMap() {
	return Object.fromEntries(
		roles.map((role) => [
			role,
			{
				provider: "fixture",
				model: `${role}-model-v1`,
				effort: "medium",
				prompt: "fixture-v1",
				tools: ["read", "write"],
				context: { compact: true },
				fallback: "none",
				runtime: { contextWindow: 100_000 },
			},
		]),
	);
}

const base = {
	workflowRevision: "base",
	project: "calculator",
	stage: "plan",
	bundleVersion: 1,
	role: "planner",
	provider: "fixture",
	model: "fixture",
	effort: "medium",
	prompt: "fixture-v1",
	mode: "decision",
	reviewer: "fixture-reviewer",
	roleMap: completeRoleMap(),
	evaluator: "fixture-evaluator",
	runtime: { node: "fixture", platform: "fixture" },
	dependencies: { package: "fixture" },
	browser: { name: "fixture", version: "1" },
	rubricVersion: 1,
	tools: ["read", "write"],
};
const candidate = structuredClone(base);
candidate.effort = "high";
assert.equal(
	validateExperimentPair({ baseline: base, candidate, factor: "effort" })
		.factor,
	"effort",
);
assert.throws(
	() =>
		validateExperimentPair({
			baseline: base,
			candidate: base,
			factor: "effort",
		}),
	/no-op/,
);
const multi = structuredClone(candidate);
multi.role = "other";
assert.throws(
	() =>
		validateExperimentPair({
			baseline: base,
			candidate: multi,
			factor: "effort",
		}),
	/multiple|undeclared/,
);
assert.doesNotThrow(() =>
	validateExperimentPair({
		baseline: base,
		candidate: multi,
		factor: ["effort", "role"],
		interaction: true,
	}),
);
const disallowed = structuredClone(base);
disallowed.model = "other";
assert.throws(
	() =>
		validateExperimentPair({
			baseline: base,
			candidate: disallowed,
			factor: "model",
		}),
	/allowlist/,
);

const topAssignment = structuredClone(base);
topAssignment.provider = "other-provider";
topAssignment.model = "other-model-v2";
assert.deepEqual(
	validateExperimentPair({
		baseline: base,
		candidate: topAssignment,
		factor: "modelAssignment",
	}).changed,
	["provider", "model"],
);
const missingRoleMapBase = structuredClone(base);
const missingRoleMapCandidate = structuredClone(topAssignment);
delete missingRoleMapBase.roleMap;
delete missingRoleMapCandidate.roleMap;
assert.throws(
	() =>
		validateExperimentPair({
			baseline: missingRoleMapBase,
			candidate: missingRoleMapCandidate,
			factor: "modelAssignment",
		}),
	/complete role map/,
);

const roleAssignment = structuredClone(base);
roleAssignment.roleMap["work-worker"].provider = "other-provider";
roleAssignment.roleMap["work-worker"].model = "worker-model-v2";
assert.deepEqual(
	validateExperimentPair({
		baseline: base,
		candidate: roleAssignment,
		factor: "modelAssignment.work-worker",
	}).changed,
	["roleMap.work-worker.provider", "roleMap.work-worker.model"],
);
const exactRoleDelta = structuredClone(base);
exactRoleDelta.roleMap["work-worker"].model = "worker-model-v2";
assert.deepEqual(
	validateExperimentPair({
		baseline: base,
		candidate: exactRoleDelta,
		factor: "modelAssignment.work-worker",
	}).changed,
	["roleMap.work-worker.model"],
);
assert.throws(
	() =>
		validateExperimentPair({
			baseline: base,
			candidate: roleAssignment,
			factor: "effort",
		}),
	/undeclared/,
);
const assignmentAndEffort = structuredClone(roleAssignment);
assignmentAndEffort.roleMap["work-worker"].effort = "high";
assert.throws(
	() =>
		validateExperimentPair({
			baseline: base,
			candidate: assignmentAndEffort,
			factor: ["modelAssignment.work-worker", "effort.work-worker"],
		}),
	/interaction/,
);
assert.doesNotThrow(() =>
	validateExperimentPair({
		baseline: base,
		candidate: assignmentAndEffort,
		factor: ["modelAssignment.work-worker", "effort.work-worker"],
		interaction: true,
	}),
);

for (const mutate of [
	(value) => {
		value.roleMap.unknown = structuredClone(value.roleMap.main);
	},
	(value) => {
		delete value.roleMap["work-worker"].provider;
	},
	(value) => {
		delete value.roleMap["work-fixer"];
	},
	(value) => {
		value.ambientOverrides = { model: "ambient" };
	},
	(value) => {
		value.roleMap["work-worker"].alias = "worker-latest";
	},
	(value) => {
		value.effort = "ultra";
	},
	(value) => {
		value.roleMap["work-worker"].effort = "ultra";
	},
	(value) => {
		value.roleMap["work-worker"].fallback = "automatic";
	},
]) {
	const invalidRoleMap = structuredClone(base);
	mutate(invalidRoleMap);
	assert.throws(() =>
		validateExperimentPair({
			baseline: base,
			candidate: invalidRoleMap,
			factor: "modelAssignment.work-worker",
		}),
	);
}
assert.throws(
	() =>
		validateExperimentPair({
			baseline: base,
			candidate: base,
			factor: "modelAssignment.work-worker",
		}),
	/no-op/,
);
assert.throws(
	() =>
		validateExperimentPair({
			baseline: base,
			candidate: roleAssignment,
			factor: "modelAssignment.work-committer",
		}),
	/unknown role/,
);
const reversedRoleMap = Object.fromEntries(
	Object.entries(base.roleMap)
		.toReversed()
		.map(([role, cell]) => [
			role,
			Object.fromEntries(Object.entries(cell).toReversed()),
		]),
);
assert.equal(fingerprint(base.roleMap), fingerprint(reversedRoleMap));
assert.equal(
	validateExperimentPair({
		baseline: base,
		candidate: topAssignment,
		factor: "modelAssignment",
	}).baselineRoleMapFingerprint,
	fingerprint(reversedRoleMap),
);
for (const [field, value] of [
	["workflowRevision", "next"],
	["prompt", "fixture-v2"],
	["mode", "sentinel"],
	["reviewer", "other-reviewer"],
]) {
	const compatible = structuredClone(base);
	compatible[field] = value;
	assert.doesNotThrow(() =>
		validateExperimentPair({
			baseline: base,
			candidate: compatible,
			factor: field,
		}),
	);
}

for (const field of [
	"model",
	"provider",
	"evaluator",
	"browser",
	"runtime",
	"dependencies",
	"rubricVersion",
	"bundleVersion",
	"tools",
]) {
	const changed = structuredClone(base);
	changed[field] =
		typeof changed[field] === "object" ? { changed: true } : "changed";
	assert.throws(() =>
		validateExperimentPair({
			baseline: base,
			candidate: changed,
			factor: "effort",
		}),
	);
}

assert.doesNotThrow(() => auditStageInput("goldens/brainstorm.md", "plan"));
for (const leaking of [
	"product-contract.md",
	"acceptance/verify.mjs",
	"goldens/plan.md",
	"../outside.md",
	"evaluator-A.json",
]) {
	assert.throws(() => auditStageInput(leaking, "plan"));
}

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const bundleRoot = path.join(root, "benchmarks", "workflow-evaluation", "v1");
const actual = validateBundle(readJson(path.join(bundleRoot, "manifest.json")));
for (const mode of ["smoke", "decision", "calibration", "sentinel"]) {
	const example = readJson(
		path.join(bundleRoot, "experiments", `${mode}.example.json`),
	);
	assert.ok(
		example.tools.includes("ask_user") && example.tools.includes("subagent"),
		`${mode} supports scripted questions and workflow roles`,
	);
}
for (const project of actual.projects) {
	const directory = path.join(bundleRoot, "projects", project);
	const approval = readJson(path.join(directory, "goldens", "approval.json"));
	assert.deepEqual(
		actual.approvals[project],
		approval,
		`${project} manifest approval matches its record`,
	);
	validateGoldenApproval(directory, approval);
}

const cli = path.join(root, "scripts", "workflow-evaluation.mjs");
const help = spawnSync(process.execPath, [cli, "--help"], { encoding: "utf8" });
assert.equal(help.status, 0);
assert.match(help.stdout, /smoke \(one pair, diagnostic only\)/);
assert.match(help.stdout, /calibration.*approval/i);
assert.match(help.stdout, /temporary path/i);
const invalid = spawnSync(
	process.execPath,
	[cli, path.join(bundleRoot, "manifest.json")],
	{ encoding: "utf8" },
);
assert.notEqual(invalid.status, 0);
assert.match(
	`${invalid.stdout}\n${invalid.stderr}`,
	/smoke \(one pair, diagnostic only\)/,
);
assert.match(`${invalid.stdout}\n${invalid.stderr}`, /calibration.*approval/i);
assert.match(`${invalid.stdout}\n${invalid.stderr}`, /temporary path/i);

process.stdout.write("ok - workflow evaluation contract fixtures\n");
