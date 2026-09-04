#!/usr/bin/env node
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { runVisualEvaluation } from "./workflow-visual-evaluation.mjs";

const root = mkdtempSync(path.join(os.tmpdir(), "ce-visual-evaluation-test-"));
const selectedPath = path.join(root, "selected.png");
const implementedPath = path.join(root, "implemented.png");
const outputPath = path.join(root, "visual-evaluation.json");
const controlPath = path.join(root, "evaluator-control.json");
const hash = (file) =>
	crypto.createHash("sha256").update(readFileSync(file)).digest("hex");
try {
	writeFileSync(selectedPath, "selected-image");
	writeFileSync(implementedPath, "implemented-image");
	let observedArgs;
	const result = runVisualEvaluation(
		{
			selectedPath,
			implementedPath,
			selectedHash: hash(selectedPath),
			implementedHash: hash(implementedPath),
			approvedTraits: {
				palette: ["#ff3366", "#33cc66", "#3366ff", "#ffcc33"],
				signatureElement: "star equals key",
			},
			writerFingerprint: "writer/provider-model",
			evaluator: { provider: "reviewer", model: "vision-model" },
			outputPath,
			controlPath,
		},
		{
			randomBytes: () => Buffer.from([0]),
			spawnSync(_command, args) {
				observedArgs = args;
				return {
					status: 0,
					stderr: "",
					stdout: `${JSON.stringify({
						type: "message_end",
						message: {
							role: "assistant",
							provider: "reviewer",
							model: "vision-model",
							content: [
								{
									type: "text",
									text: JSON.stringify({
										version: "visual-evaluation/v1",
										scores: {
											palette: 4,
											hierarchy: 3,
											composition: 3,
											typography: 3.5,
											signatureElement: 4,
											responsiveAdaptation: 3,
										},
										rationale:
											"The anonymous images share the approved palette and structure.",
									}),
								},
							],
						},
					})}\n`,
				};
			},
		},
	);
	assert.equal(result.output.passed, true);
	assert.equal(result.output.mean, 3.4166666666666665);
	assert.deepEqual(result.control.mapping, { A: "selected", B: "implemented" });
	assert.ok(observedArgs.some((arg) => /^@.*A\.png$/.test(arg)));
	assert.ok(observedArgs.some((arg) => /^@.*B\.png$/.test(arg)));
	assert.ok(existsSync(outputPath));
	assert.ok(existsSync(controlPath));
	assert.equal(JSON.parse(readFileSync(outputPath, "utf8")).passed, true);
	assert.throws(
		() =>
			runVisualEvaluation({
				selectedPath,
				implementedPath,
				selectedHash: "0".repeat(64),
				implementedHash: hash(implementedPath),
				writerFingerprint: "writer/provider-model",
				evaluator: { provider: "reviewer", model: "vision-model" },
			}),
		/hash drift/,
	);
	assert.throws(
		() =>
			runVisualEvaluation({
				selectedPath,
				implementedPath,
				selectedHash: hash(selectedPath),
				implementedHash: hash(implementedPath),
				writerFingerprint: "reviewer/vision-model",
				evaluator: { provider: "reviewer", model: "vision-model" },
			}),
		/must differ/,
	);
	process.stdout.write("workflow-visual-evaluation tests passed\n");
} finally {
	rmSync(root, { recursive: true, force: true });
}
