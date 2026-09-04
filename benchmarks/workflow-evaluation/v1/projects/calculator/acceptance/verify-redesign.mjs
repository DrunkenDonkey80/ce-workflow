import crypto from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { validateDesignFidelityEvidence } from "../../../../../../extensions/work-design.js";

const sha256 = (file) =>
	crypto.createHash("sha256").update(readFileSync(file)).digest("hex");

export function verifyCalculatorRedesign(root, evidenceFile, authority, handoff) {
	try {
		const workspace = path.resolve(root);
		const evidencePath = path.resolve(evidenceFile);
		const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
		validateDesignFidelityEvidence(evidence, authority, handoff);
		const evidenceDirectory = path.dirname(evidencePath);
		for (const capture of evidence.captures) {
			const file = path.resolve(evidenceDirectory, capture.screenshotPath);
			if (
				file !== evidenceDirectory &&
				!file.startsWith(`${evidenceDirectory}${path.sep}`)
			)
				throw new Error("screenshot evidence escaped its retained directory");
			if (!existsSync(file) || sha256(file) !== capture.screenshotHash)
				throw new Error(`missing or changed ${capture.role} ${capture.viewport} screenshot`);
			if (
				capture.role === "implemented" &&
				path.resolve(capture.workspaceRoot) !== workspace
			)
				throw new Error("implemented screenshot provenance is outside the calculator workspace");
		}
		return { project: "calculator-redesign", passed: true };
	} catch (error) {
		return {
			project: "calculator-redesign",
			passed: false,
			reason: error instanceof Error ? error.message : String(error),
		};
	}
}
