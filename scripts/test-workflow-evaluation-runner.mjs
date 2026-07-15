#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runSmokeExperiment } from "./workflow-evaluation.mjs";

const sourceRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const descriptor = {
	version: 1,
	mode: "smoke",
	project: "csv-expenses",
	stage: "brainstorm",
	factor: "effort",
	baseline: { workflowRevision: "base", effort: "medium" },
	candidate: { workflowRevision: "base", effort: "high" },
	trusted: true,
	isolation: "path",
	tools: ["read", "write", "edit", "bash"],
	budgets: { tokenCeiling: 1000, wallMsCeiling: 1000 },
};

const roots = [];
const passing = await runSmokeExperiment(descriptor, {
	sourceRoot,
	initializeWorkspace() {},
	async runSample(sample) {
		roots.push(sample.workspaceRoot);
		return { status: "completed", usage: { tokens: { total: 20 }, toolCalls: 2 }, questions: [], events: [{ type: "agent_settled" }], artifacts: ["requirements.md"], diff: "fixture", telemetry: { complete: true }, verifier: { passed: true }, screenshots: [] };
	},
});
assert.equal(passing.status, "diagnostic-pass");
assert.equal(passing.decisionGrade, false);
assert.equal(new Set(roots).size, 2, "each side gets a fresh root");
assert.ok(roots.every((root) => !existsSync(root)), "workspaces clean after durable evidence");
assert.ok(existsSync(passing.evidencePath));
let evidence;
try {
	evidence = JSON.parse(readFileSync(passing.evidencePath, "utf8"));
} catch (error) {
	throw new Error(`invalid retained evidence: ${error instanceof Error ? error.message : String(error)}`);
}
for (const field of ["fingerprints", "prompts", "exchanges", "artifacts", "diffs", "telemetry", "verifier", "screenshots", "attempts", "disposition"]) assert.ok(field in evidence, `evidence includes ${field}`);
assert.doesNotMatch(JSON.stringify(evidence), /product-contract\.md|fixture-secret/);

const baselineFailure = await runSmokeExperiment(descriptor, {
	sourceRoot,
	initializeWorkspace() {},
	async runSample(sample) { return sample.side === "baseline" ? { status: "failed", failure: "product" } : { status: "completed", usage: { tokens: { total: 1 } }, verifier: { passed: true } }; },
});
assert.equal(baselineFailure.status, "invalid");

const candidateFailure = await runSmokeExperiment(descriptor, {
	sourceRoot,
	initializeWorkspace() {},
	async runSample(sample) { return sample.side === "candidate" ? { status: "failed", failure: "timeout" } : { status: "completed", usage: { tokens: { total: 1 } }, verifier: { passed: true } }; },
});
assert.equal(candidateFailure.status, "candidate-rejected");
assert.ok(candidateFailure.attempts.some((attempt) => attempt.failure === "timeout"));
console.log("ok - workflow evaluation smoke lifecycle fixtures");
