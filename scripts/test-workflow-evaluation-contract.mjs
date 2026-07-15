#!/usr/bin/env node
import assert from "node:assert/strict";
import {
	auditStageInput,
	fingerprint,
	validateBundle,
	validateExperimentPair,
} from "./workflow-evaluation-contract.mjs";

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
		calculator: { bundleSha: "a".repeat(64), brainstormSha: "b".repeat(64), planSha: "c".repeat(64), approvedBy: "fixture" },
		"csv-expenses": { bundleSha: "d".repeat(64), brainstormSha: "e".repeat(64), planSha: "f".repeat(64), approvedBy: "fixture" },
	},
};

const reordered = Object.fromEntries(Object.entries(manifest).reverse());
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
multi.model = "other";
assert.throws(() => validateExperimentPair({ baseline: base, candidate: multi, factor: "effort" }), /multiple|undeclared/);
assert.doesNotThrow(() => validateExperimentPair({ baseline: base, candidate: multi, factor: ["effort", "model"], interaction: true }));
for (const field of ["model", "provider", "evaluator", "browser", "runtime", "dependencies", "rubricVersion", "bundleVersion", "tools"]) {
	const changed = structuredClone(base);
	changed[field] = typeof changed[field] === "object" ? { changed: true } : "changed";
	assert.throws(() => validateExperimentPair({ baseline: base, candidate: changed, factor: "effort" }));
}

assert.doesNotThrow(() => auditStageInput("goldens/brainstorm.md", "plan"));
for (const leaking of ["product-contract.md", "acceptance/verify.mjs", "goldens/plan.md", "../outside.md", "evaluator-A.json"]) {
	assert.throws(() => auditStageInput(leaking, "plan"));
}

console.log("ok - workflow evaluation contract fixtures");
