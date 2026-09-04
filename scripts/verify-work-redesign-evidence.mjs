#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { verifyCalculatorRedesign } from "../benchmarks/workflow-evaluation/v1/projects/calculator/acceptance/verify-redesign.mjs";

try {
	const ownerId = process.argv[2];
	if (!/^work-[A-Za-z0-9._-]+$/.test(ownerId ?? ""))
		throw new Error("Usage: verify-work-redesign-evidence.mjs <work-item-id>");
	const cwd = process.cwd();
	const session = JSON.parse(
		readFileSync(
			path.join(cwd, ".ce-workflow/work-runs/design-sessions", `${ownerId}.json`),
			"utf8",
		),
	);
	if (session.testOnly)
		throw new Error("fixture design sessions cannot satisfy live fidelity proof");
	const handoff = JSON.parse(
		readFileSync(path.join(cwd, session.handoffPath), "utf8"),
	);
	const authority = {
		briefHash: session.briefHash,
		candidateManifestHash: session.candidateManifestHash,
		selectionHash: session.selectionHash,
		candidateArtifactHash: session.selectedCandidateHash,
		handoffHash: session.handoffHash,
		approvalHash: session.approvalHash,
	};
	const evidenceFile = path.join(
		cwd,
		".ce-workflow/evidence",
		ownerId,
		"fidelity.json",
	);
	const result = verifyCalculatorRedesign(cwd, evidenceFile, authority, handoff);
	if (!result.passed) throw new Error(result.reason);
	process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
	process.stderr.write(
		`${error instanceof Error ? error.message : String(error)}\n`,
	);
	process.exitCode = 1;
}
