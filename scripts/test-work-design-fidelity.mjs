#!/usr/bin/env node
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	validateDesignFidelityEvidence,
	validateReferenceCaptureReceipt,
} from "../extensions/work-design.js";
import { verifyCalculatorRedesign } from "../benchmarks/workflow-evaluation/v1/projects/calculator/acceptance/verify-redesign.mjs";

const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
const authority = {
	briefHash: hash("brief"),
	candidateManifestHash: hash("manifest"),
	selectionHash: hash("selection"),
	candidateArtifactHash: hash("candidate"),
	handoffHash: hash("handoff"),
	approvalHash: hash("approval"),
};
const handoff = {
	direction: {
		roleColors: [
			{ name: "canvas", value: "#ff3366" },
			{ name: "surface", value: "#33cc66" },
			{ name: "accent", value: "#3366ff" },
			{ name: "action", value: "#ffcc33" },
		],
	},
	screens: [{ requiredRegions: ["display", "keypad", "theme-toggle"] }],
};
const root = mkdtempSync(path.join(os.tmpdir(), "ce-design-fidelity-"));
try {
	const screenshotPath = path.join(root, "selected-mobile.png");
	writeFileSync(screenshotPath, "png-fixture");
	const receipt = {
		version: 1,
		initiatedBy: "human",
		projectId: "project-1",
		runId: "run-1",
		candidateId: "CANDIDATE-2",
		briefHash: authority.briefHash,
		artifactHash: authority.candidateArtifactHash,
		selectionHash: authority.selectionHash,
		originHash: hash("https://preview.example"),
		documentHash: authority.candidateArtifactHash,
		viewport: { width: 390, height: 844 },
		browserFingerprint: "chromium-fixture",
		security: {
			cookies: false,
			credentials: false,
			downloads: false,
			clipboard: false,
			popups: false,
			crossOriginRequests: false,
		},
		screenshot: {
			path: "selected-mobile.png",
			sha256: hash("png-fixture"),
		},
	};
	const current = {
		projectId: receipt.projectId,
		runId: receipt.runId,
		candidateId: receipt.candidateId,
		briefHash: receipt.briefHash,
		artifactHash: receipt.artifactHash,
		selectionHash: receipt.selectionHash,
	};
	assert.equal(
		validateReferenceCaptureReceipt(receipt, current, { workspaceRoot: root })
			.candidateId,
		"CANDIDATE-2",
	);
	assert.throws(
		() =>
			validateReferenceCaptureReceipt(
				{ ...receipt, security: { ...receipt.security, cookies: true } },
				current,
				{ workspaceRoot: root },
			),
		/cookies must be false/,
	);
	assert.throws(
		() =>
			validateReferenceCaptureReceipt(
				{ ...receipt, documentHash: hash("changed") },
				current,
				{ workspaceRoot: root },
			),
		/document hash does not match/,
	);

	const evidence = {
		version: 1,
		authority,
		gitHead: "a".repeat(40),
		workspaceRoot: root,
		baselineHash: hash("plain-baseline"),
		computedRoleColors: handoff.direction.roleColors.map((color) => color.value),
		signatureElement: "Bouncing star equals key",
		regions: ["display", "keypad", "theme-toggle"],
		geometryDeltas: [0.04, 0.1],
		typographyDeltas: [0.08],
		responsive: {
			reflow: true,
			noHorizontalOverflow: true,
			visibleFocus: true,
			contrast: true,
		},
		captures: [
			{
				role: "selected",
				viewport: "mobile",
				state: "ready",
				screenshotPath: "selected-mobile.png",
				screenshotHash: hash("selected-mobile"),
				handoffHash: authority.handoffHash,
				approvalHash: authority.approvalHash,
			},
			{
				role: "implemented",
				viewport: "mobile",
				state: "ready",
				screenshotPath: "implemented-mobile.png",
				screenshotHash: hash("implemented-mobile"),
				handoffHash: authority.handoffHash,
				approvalHash: authority.approvalHash,
				workspaceRoot: root,
				gitHead: "a".repeat(40),
			},
			{
				role: "selected",
				viewport: "desktop",
				state: "ready",
				screenshotPath: "selected-desktop.png",
				screenshotHash: hash("selected-desktop"),
				handoffHash: authority.handoffHash,
				approvalHash: authority.approvalHash,
			},
			{
				role: "implemented",
				viewport: "desktop",
				state: "ready",
				screenshotPath: "implemented-desktop.png",
				screenshotHash: hash("implemented-desktop"),
				handoffHash: authority.handoffHash,
				approvalHash: authority.approvalHash,
				workspaceRoot: root,
				gitHead: "a".repeat(40),
			},
		],
		writerFingerprint: "provider/writer",
		visualEvaluation: {
			passed: true,
			evaluatorFingerprint: "provider/evaluator",
			scores: {
				palette: 4,
				hierarchy: 3,
				composition: 3,
				typography: 3.5,
				signatureElement: 4,
				responsiveAdaptation: 3,
			},
		},
		finalAcceptance: {
			authority: "human",
			accepted: true,
			decisionEventId: "final-review-1",
			gitHead: "a".repeat(40),
			approvalHash: authority.approvalHash,
		},
	};
	for (const capture of evidence.captures)
		writeFileSync(
			path.join(root, capture.screenshotPath),
			`${capture.role}-${capture.viewport}`,
		);
	assert.equal(validateDesignFidelityEvidence(evidence, authority, handoff).version, 1);
	const evidencePath = path.join(root, "fidelity.json");
	writeFileSync(evidencePath, JSON.stringify(evidence));
	assert.equal(
		verifyCalculatorRedesign(root, evidencePath, authority, handoff).passed,
		true,
	);
	assert.throws(
		() =>
			validateDesignFidelityEvidence(
				{
					...evidence,
					visualEvaluation: {
						...evidence.visualEvaluation,
						evaluatorFingerprint: evidence.writerFingerprint,
					},
				},
				authority,
				handoff,
			),
		/not independent/,
	);
	assert.throws(
		() =>
			validateDesignFidelityEvidence(
				{ ...evidence, geometryDeltas: [0.16] },
				authority,
				handoff,
			),
		/15% tolerance/,
	);
	process.stdout.write("work-design-fidelity tests passed\n");
} finally {
	rmSync(root, { recursive: true, force: true });
}
