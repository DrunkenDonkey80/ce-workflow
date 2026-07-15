#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifyCalculatorProject, VIEWPORT } from "../benchmarks/workflow-evaluation/v1/projects/calculator/acceptance/verify.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const project = path.join(root, "benchmarks", "workflow-evaluation", "v1", "projects", "calculator");

function fake(defect = null) {
	let currentViewport;
	return {
		async capability() { return defect === "capability" ? { name: "fake", version: "1", screenshot: false } : { name: "fake", version: "1", screenshot: true }; },
		async setViewport(value) { currentViewport = defect === "viewport" ? { width: value.width + 1, height: value.height } : value; },
		async navigate(file) { assert.equal(file, path.join(project, "seed", "index.html")); },
		async runScenario(name) { return { passed: defect !== name, detail: defect === name ? "intentional defect" : "" }; },
		async viewport() { return currentViewport; },
		async consoleErrors() { return defect === "console" ? ["uncaught"] : []; },
		async screenshot(file) { if (defect !== "screenshot") writeFileSync(file, "png-fixture"); },
		async close() {},
	};
}

const passing = await verifyCalculatorProject(path.join(project, "seed"), fake());
assert.equal(passing.passed, true);
assert.deepEqual(passing.viewport, VIEWPORT);
for (const defect of ["capability", "viewport", "screenshot", "console", "arithmetic", "theme-persistence", "accessibility"]) {
	const result = await verifyCalculatorProject(path.join(project, "seed"), fake(defect));
	assert.equal(result.passed, false, `${defect} must fail acceptance`);
}
assert.equal((await verifyCalculatorProject(path.join(project, "seed"), null)).reason, "browser-unavailable");

let approval;
try {
	approval = JSON.parse(readFileSync(path.join(project, "goldens", "approval.json"), "utf8"));
} catch (error) {
	throw new Error(`invalid calculator approval: ${error instanceof Error ? error.message : String(error)}`);
}
const sha = (name) => createHash("sha256").update(readFileSync(path.join(project, "goldens", name))).digest("hex");
assert.equal(approval.brainstormSha, sha("brainstorm.md"));
assert.equal(approval.planSha, sha("plan.md"));
assert.match(readFileSync(path.join(project, "goldens", "plan.md"), "utf8"), /Slice 1[\s\S]*Slice 2/);
console.log("ok - calculator workflow evaluation project fixtures");
