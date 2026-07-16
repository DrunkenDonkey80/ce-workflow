#!/usr/bin/env node
import assert from "node:assert/strict";
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
	try { return JSON.parse(readFileSync(file, "utf8")); }
	catch (error) { throw new Error(`invalid JSON ${file}: ${error instanceof Error ? error.message : String(error)}`); }
}

const manifest = {
	version: 1,
	projects: ["calculator", "csv-expenses"],
	hiddenResources: ["product-contract.md", "acceptance"],
	metrics: ["tokens", "wallMs", "toolCalls", "subagentCalls", "toolOutputChars", "retries", "contextTokens", "questions"],
	depths: {
		smoke: { samples: 1, tokenCeiling: 1000, wallMsCeiling: 1000 },
		decision: { samples: 3, tokenCeiling: 3000, wallMsCeiling: 3000 },
		sentinel: { samples: 1, tokenCeiling: 5000, wallMsCeiling: 5000 },
		calibration: { samples: 3, tokenCeiling: 3000, wallMsCeiling: 3000 },
	},
	rubric: { version: 1, anchors: [0, 1, 2, 3, 4], criticalDimensions: ["quality"] },
	approvals: {
		calculator: { approved: true, approvedBy: "fixture", approvedAt: "2026-07-15T00:00:00Z", acceptancePassed: true, evidence: "fixture", bundleSha: "a".repeat(64), brainstormSha: "b".repeat(64), planSha: "c".repeat(64) },
		"csv-expenses": { approved: true, approvedBy: "fixture", approvedAt: "2026-07-15T00:00:00Z", acceptancePassed: true, evidence: "fixture", bundleSha: "d".repeat(64), brainstormSha: "e".repeat(64), planSha: "f".repeat(64) },
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

const base = {
	workflowRevision: "base",
	project: "calculator",
	stage: "plan",
	bundleVersion: 1,
	role: "planner",
	provider: "fixture",
	model: "fixture",
	effort: "medium",
	evaluator: "fixture-evaluator",
	runtime: { node: "fixture", platform: "fixture" },
	dependencies: { package: "fixture" },
	browser: { name: "fixture", version: "1" },
	rubricVersion: 1,
	tools: ["read", "write"],
};
const candidate = structuredClone(base);
candidate.effort = "high";
assert.equal(validateExperimentPair({ baseline: base, candidate, factor: "effort" }).factor, "effort");
assert.throws(() => validateExperimentPair({ baseline: base, candidate: base, factor: "effort" }), /no-op/);
const multi = structuredClone(candidate);
multi.role = "other";
assert.throws(() => validateExperimentPair({ baseline: base, candidate: multi, factor: "effort" }), /multiple|undeclared/);
assert.doesNotThrow(() => validateExperimentPair({ baseline: base, candidate: multi, factor: ["effort", "role"], interaction: true }));
const disallowed = structuredClone(base);
disallowed.model = "other";
assert.throws(() => validateExperimentPair({ baseline: base, candidate: disallowed, factor: "model" }), /allowlist/);
for (const field of ["model", "provider", "evaluator", "browser", "runtime", "dependencies", "rubricVersion", "bundleVersion", "tools"]) {
	const changed = structuredClone(base);
	changed[field] = typeof changed[field] === "object" ? { changed: true } : "changed";
	assert.throws(() => validateExperimentPair({ baseline: base, candidate: changed, factor: "effort" }));
}

assert.doesNotThrow(() => auditStageInput("goldens/brainstorm.md", "plan"));
for (const leaking of ["product-contract.md", "acceptance/verify.mjs", "goldens/plan.md", "../outside.md", "evaluator-A.json"]) {
	assert.throws(() => auditStageInput(leaking, "plan"));
}

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const bundleRoot = path.join(root, "benchmarks", "workflow-evaluation", "v1");
const actual = validateBundle(readJson(path.join(bundleRoot, "manifest.json")));
for (const project of actual.projects) {
	const directory = path.join(bundleRoot, "projects", project);
	const approval = readJson(path.join(directory, "goldens", "approval.json"));
	assert.deepEqual(actual.approvals[project], approval, `${project} manifest approval matches its record`);
	validateGoldenApproval(directory, approval);
}

process.stdout.write("ok - workflow evaluation contract fixtures\n");
