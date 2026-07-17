#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	buildEvaluationSettings,
	expireEvidenceStore,
	finalizeEvidenceStore,
	prepareEvidenceStore,
	recoverStaleWorkspaces,
	runDecisionExperiment,
	runSmokeExperiment,
	writeEvaluationSettings,
} from "./workflow-evaluation.mjs";

const sourceRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
function readFixture(relative) {
	try {
		return JSON.parse(readFileSync(path.join(sourceRoot, relative), "utf8"));
	} catch (error) {
		throw new Error(
			`invalid fixture ${relative}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}
const campaign = readFixture(
	"benchmarks/workflow-evaluation/v1/experiments/model-role-campaign.example.json",
);
const roleSmoke = readFixture(
	"benchmarks/workflow-evaluation/v1/experiments/role-smoke.example.json",
);
assert.equal(campaign.frozenBeforeFirstSample, true);
assert.equal(roleSmoke.campaignFingerprint, campaign.fingerprint);
assert.equal(roleSmoke.decisionGrade, false);
assert.equal(roleSmoke.rules.rankCandidates, false);
assert.equal(roleSmoke.rules.promoteByAbsence, false);
assert.equal(roleSmoke.rules.unavailableLanePolicy, "block-only-that-lane");
assert.equal(campaign.protocol.symmetricInfrastructureReplacements, 1);
assert.equal(campaign.evidence.expiryDays, 30);
assert.equal(campaign.evidence.durabilityBeforeDeletion, true);
assert.equal(new Set(campaign.evaluators.map((item) => item.provider)).size, 2);
assert.equal(
	campaign.lanes.every((lane) =>
		lane.candidates.every(
			(candidate) =>
				candidate === "configured-control" || campaign.models[candidate],
		),
	),
	true,
);
assert.equal(
	JSON.stringify(campaign).match(/api.?key|bearer|credential-canary/i),
	null,
);
const roundContract = ({ seed, budgets, protocol, projects }) =>
	JSON.stringify({ seed, budgets, protocol, projects });
assert.notEqual(
	roundContract(campaign),
	roundContract({ ...campaign, seed: campaign.seed + 1 }),
);
assert.notEqual(
	roundContract(campaign),
	roundContract({
		...campaign,
		budgets: { ...campaign.budgets, retries: 2 },
	}),
);
const recoveryRoot = mkdtempSync(
	path.join(os.tmpdir(), "ce-workspace-recovery-fixture-"),
);
try {
	const stale = path.join(recoveryRoot, "ce-workflow-samples-stale");
	const live = path.join(recoveryRoot, "ce-workflow-samples-live");
	mkdirSync(stale);
	mkdirSync(live);
	writeFileSync(
		path.join(stale, ".active.json"),
		JSON.stringify({ pid: 999999, startedAt: 0 }),
	);
	writeFileSync(
		path.join(live, ".active.json"),
		JSON.stringify({ pid: process.pid, startedAt: 0 }),
	);
	recoverStaleWorkspaces(recoveryRoot, 1, Date.now());
	assert.equal(existsSync(stale), false, "stale workspace is recovered");
	assert.equal(existsSync(live), true, "live workspace lease is preserved");
} finally {
	rmSync(recoveryRoot, { recursive: true, force: true });
}
const retentionRoot = mkdtempSync(
	path.join(os.tmpdir(), "ce-evidence-retention-fixture-"),
);
const undurableRoot = mkdtempSync(
	path.join(os.tmpdir(), "ce-evidence-undurable-fixture-"),
);
try {
	prepareEvidenceStore(retentionRoot, 0);
	writeFileSync(path.join(retentionRoot, "raw.json"), "raw evidence\n");
	writeFileSync(path.join(retentionRoot, "report.json"), "compact report\n");
	const manifest = finalizeEvidenceStore(retentionRoot, undefined, 1);
	assert.equal(manifest.visibility, "authority-only");
	assert.equal(manifest.rawFiles.includes("raw.json"), true);
	assert.match(manifest.hashes["raw.json"], /^[a-f0-9]{64}$/);
	assert.equal(expireEvidenceStore(retentionRoot, 1), false);
	assert.equal(
		expireEvidenceStore(retentionRoot, 31 * 24 * 60 * 60 * 1000),
		true,
	);
	assert.equal(existsSync(path.join(retentionRoot, "raw.json")), false);
	assert.equal(existsSync(path.join(retentionRoot, "report.json")), true);
	let retainedManifest;
	try {
		retainedManifest = JSON.parse(
			readFileSync(path.join(retentionRoot, "evidence-manifest.json"), "utf8"),
		);
	} catch (error) {
		throw new Error(
			`invalid retained evidence manifest: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	assert.match(retainedManifest.hashes["raw.json"], /^[a-f0-9]{64}$/);
	if (process.platform !== "win32")
		assert.equal(statSync(retentionRoot).mode & 0o777, 0o700);

	prepareEvidenceStore(undurableRoot, 0);
	assert.throws(() =>
		expireEvidenceStore(undurableRoot, 31 * 24 * 60 * 60 * 1000),
	);
} finally {
	rmSync(retentionRoot, { recursive: true, force: true });
	rmSync(undurableRoot, { recursive: true, force: true });
}
const roleSettings = buildEvaluationSettings({
	roleMap: {
		main: {
			provider: "main-provider",
			model: "main-model",
			effort: "medium",
			context: { compaction: { enabled: true, reserveTokens: 20_000 } },
		},
		"work-worker": {
			provider: "worker-provider",
			model: "worker-model",
			effort: "high",
		},
	},
});
assert.deepEqual(roleSettings, {
	defaultProvider: "main-provider",
	defaultModel: "main-model",
	defaultThinkingLevel: "medium",
	compaction: { enabled: true, reserveTokens: 20_000 },
	subagents: {
		agentOverrides: {
			"work-worker": {
				model: "worker-provider/worker-model",
				thinking: "high",
			},
		},
	},
});
assert.equal("main" in roleSettings.subagents.agentOverrides, false);
const isolatedSettingsRoot = mkdtempSync(
	path.join(os.tmpdir(), "ce-role-settings-fixture-"),
);
try {
	const file = writeEvaluationSettings(isolatedSettingsRoot, {
		roleMap: {
			main: {
				provider: "main-provider",
				model: "main-model",
				effort: "medium",
			},
			"work-worker": {
				provider: "worker-provider",
				model: "worker-model",
				effort: "high",
			},
		},
	});
	assert.equal(file, path.join(isolatedSettingsRoot, ".pi", "settings.json"));
	assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), {
		defaultProvider: "main-provider",
		defaultModel: "main-model",
		defaultThinkingLevel: "medium",
		subagents: {
			agentOverrides: {
				"work-worker": {
					model: "worker-provider/worker-model",
					thinking: "high",
				},
			},
		},
	});
} finally {
	rmSync(isolatedSettingsRoot, { recursive: true, force: true });
}
assert.throws(() =>
	buildEvaluationSettings(
		{ roleMap: { main: { provider: "p", model: "m", effort: "low" } } },
		{ defaultModel: "ambient" },
	),
);
assert.throws(() =>
	buildEvaluationSettings(
		{
			roleMap: {
				main: {
					provider: "p",
					model: "credential-canary-fixture",
					effort: "low",
				},
			},
		},
		null,
		"credential-canary-fixture",
	),
);
assert.doesNotMatch(JSON.stringify(roleSettings), /credential-canary-fixture/);

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
const reservedArtifacts = [];
const passing = await runSmokeExperiment(descriptor, {
	sourceRoot,
	initializeWorkspace() {},
	async runSample(sample) {
		roots.push(sample.workspaceRoot);
		const reserved =
			process.platform === "win32"
				? spawnSync(
						process.env.ComSpec ?? "cmd.exe",
						["/d", "/s", "/c", "echo reserved-path-fixture>NUL"],
						{ cwd: sample.workspaceRoot },
					)
				: spawnSync("sh", ["-c", "printf reserved-path-fixture > NUL"], {
						cwd: sample.workspaceRoot,
					});
		assert.equal(
			reserved.status,
			0,
			`reserved-path child exited cleanly: ${reserved.stderr}`,
		);
		reservedArtifacts.push(existsSync(path.join(sample.workspaceRoot, "NUL")));
		return {
			status: "completed",
			usage: { tokens: { total: 20 }, toolCalls: 2 },
			questions: [],
			events: [{ type: "agent_settled" }],
			artifacts: [
				"requirements.md",
				"goldens/plan.md",
				"answers.json",
				"sk-1234567890abcdefghijkl",
			],
			hiddenContract: "fixture-hidden-contract",
			apiKey: "fixture-secret",
			diff: "fixture",
			telemetry: { complete: true },
			verifier: { passed: true },
			screenshots: [],
		};
	},
	async evaluatePair() {
		return {
			scores: {
				baseline: { "question-quality": 3, requirements: 3, scope: 3 },
				candidate: { "question-quality": 3, requirements: 3, scope: 3 },
			},
			evaluator: { wallMs: 1 },
		};
	},
});
assert.equal(passing.status, "diagnostic-pass");
assert.equal(passing.decisionGrade, false);
assert.equal(new Set(roots).size, 2, "each side gets a fresh root");
assert.deepEqual(
	reservedArtifacts,
	[process.platform !== "win32", process.platform !== "win32"],
	"Windows NUL is a device while POSIX NUL artifacts stay inside the disposable root",
);
assert.ok(
	roots.every((root) => !existsSync(root)),
	"workspaces and reserved-name artifacts are gone after durable evidence",
);
assert.ok(existsSync(passing.evidencePath));
let evidence;
try {
	evidence = JSON.parse(readFileSync(passing.evidencePath, "utf8"));
} catch (error) {
	throw new Error(
		`invalid retained evidence: ${error instanceof Error ? error.message : String(error)}`,
	);
}
for (const field of [
	"fingerprints",
	"prompts",
	"exchanges",
	"artifacts",
	"diffs",
	"telemetry",
	"verifier",
	"testOutput",
	"bugs",
	"screenshots",
	"attempts",
	"disposition",
	"evaluator",
])
	assert.ok(field in evidence, `evidence includes ${field}`);
assert.doesNotMatch(
	JSON.stringify(evidence),
	/product-contract\.md|goldens\/plan\.md|answers\.json|sk-1234567890abcdefghijkl|fixture-secret|fixture-hidden-contract/,
);

const qualitativeFailure = await runSmokeExperiment(descriptor, {
	sourceRoot,
	initializeWorkspace() {},
	async runSample() {
		return {
			status: "completed",
			usage: { tokens: { total: 20 } },
			questions: [],
			verifier: { passed: true },
			artifacts: ["requirements"],
		};
	},
	async evaluatePair() {
		return {
			scores: {
				baseline: { "question-quality": 3, requirements: 3, scope: 3 },
				candidate: { "question-quality": 2, requirements: 3, scope: 3 },
			},
			evaluator: { wallMs: 1 },
		};
	},
});
assert.equal(qualitativeFailure.status, "diagnostic-candidate-rejected");

const baselineFailure = await runSmokeExperiment(descriptor, {
	sourceRoot,
	initializeWorkspace() {},
	async runSample(sample) {
		return sample.side === "baseline"
			? { status: "failed", failure: "product" }
			: {
					status: "completed",
					usage: { tokens: { total: 1 } },
					verifier: { passed: true },
				};
	},
});
assert.equal(baselineFailure.status, "invalid");

const candidateFailure = await runSmokeExperiment(descriptor, {
	sourceRoot,
	initializeWorkspace() {},
	async runSample(sample) {
		return sample.side === "candidate"
			? { status: "failed", failure: "timeout" }
			: {
					status: "completed",
					usage: { tokens: { total: 1 } },
					verifier: { passed: true },
				};
	},
});
assert.equal(candidateFailure.status, "invalid");
assert.ok(
	candidateFailure.attempts.some((attempt) => attempt.failure === "timeout"),
);
const budgetFailure = await runSmokeExperiment(
	{ ...descriptor, budgets: { ...descriptor.budgets, tokenCeiling: 10 } },
	{
		sourceRoot,
		initializeWorkspace() {},
		async runSample(sample) {
			return {
				status: "completed",
				usage: { tokens: { total: sample.side === "candidate" ? 11 : 10 } },
				verifier: { passed: true },
			};
		},
	},
);
assert.equal(budgetFailure.status, "candidate-rejected");

const decision = await runDecisionExperiment(
	{ ...descriptor, mode: "decision" },
	{
		sourceRoot,
		skipApproval: true,
		skipCalibration: true,
		initializeWorkspace() {},
		async runSample(sample) {
			const cost = sample.side === "candidate" ? 90 : 100;
			return {
				status: "completed",
				verifier: { passed: true },
				usage: { tokens: { total: cost } },
				metrics: {
					tokens: cost,
					wallMs: cost,
					toolCalls: cost,
					subagentCalls: cost,
					toolOutputChars: cost,
					retries: cost,
					contextTokens: cost,
					questions: 0,
				},
				questions: [],
				artifacts: [`${sample.side}-artifact`],
			};
		},
		async evaluatePair() {
			return {
				scores: {
					baseline: { "question-quality": 3, requirements: 3, scope: 3 },
					candidate: { "question-quality": 3, requirements: 3, scope: 3 },
				},
				control: { mapping: { A: "baseline", B: "candidate" } },
				evaluator: { usage: { tokens: 10 } },
			};
		},
	},
);
assert.equal(decision.status, "candidate-accepted");
assert.equal(decision.verdict.pairs.length, 3);

function successfulDecisionSample(side) {
	return {
		status: "completed",
		verifier: { passed: true },
		usage: { tokens: { total: 100 } },
		metrics: {
			tokens: 100,
			wallMs: 100,
			toolCalls: 1,
			subagentCalls: 0,
			toolOutputChars: 1,
			retries: 0,
			contextTokens: 1,
			questions: 0,
		},
		questions: [],
		artifacts: [`${side}-artifact`],
	};
}
const equalEvaluation = async () => ({
	scores: {
		baseline: { "question-quality": 3, requirements: 3, scope: 3 },
		candidate: { "question-quality": 3, requirements: 3, scope: 3 },
	},
	control: { mapping: { A: "baseline", B: "candidate" } },
	evaluator: { usage: { tokens: 10 } },
});
const replacementCalls = [];
const replacedDecision = await runDecisionExperiment(
	{ ...descriptor, mode: "decision" },
	{
		sourceRoot,
		skipApproval: true,
		skipCalibration: true,
		initializeWorkspace() {},
		async runSample(sample) {
			replacementCalls.push({
				pairIndex: sample.pairIndex,
				attemptIndex: sample.attemptIndex,
				side: sample.side,
			});
			if (
				sample.pairIndex === 0 &&
				sample.attemptIndex === 0 &&
				sample.side === "candidate"
			)
				return {
					status: "failed",
					failure: "provider-error",
					error: "quota exceeded",
				};
			return successfulDecisionSample(sample.side);
		},
		evaluatePair: equalEvaluation,
	},
);
assert.equal(replacedDecision.verdict.pairs[0].attempts.length, 2);
assert.equal(
	replacedDecision.verdict.pairs[0].attempts[0].infrastructureFailure,
	"quota",
);
for (const side of ["baseline", "candidate"])
	assert.equal(
		replacementCalls.filter(
			(call) => call.pairIndex === 0 && call.side === side,
		).length,
		2,
	);
const twiceFailedDecision = await runDecisionExperiment(
	{ ...descriptor, mode: "decision" },
	{
		sourceRoot,
		skipApproval: true,
		skipCalibration: true,
		initializeWorkspace() {},
		async runSample(sample) {
			if (sample.pairIndex === 0 && sample.side === "candidate")
				return {
					status: "failed",
					failure: "provider-error",
					error: "quota exceeded",
				};
			return successfulDecisionSample(sample.side);
		},
		evaluatePair: equalEvaluation,
	},
);
assert.equal(twiceFailedDecision.status, "invalid");
let twiceFailedEvidence;
try {
	twiceFailedEvidence = JSON.parse(
		readFileSync(twiceFailedDecision.evidencePath, "utf8"),
	);
} catch (error) {
	throw new Error(
		`invalid retained retry evidence: ${error instanceof Error ? error.message : String(error)}`,
	);
}
assert.equal(twiceFailedEvidence.pairs[0].attempts.length, 2);
assert.equal(
	twiceFailedEvidence.pairs[0].attempts[1].infrastructureFailure,
	"quota",
);

let evaluatorCalls = 0;
const gatedDecision = await runDecisionExperiment(
	{ ...descriptor, mode: "decision" },
	{
		sourceRoot,
		skipApproval: true,
		skipCalibration: true,
		initializeWorkspace() {},
		async runSample(sample) {
			if (sample.side === "candidate")
				return {
					status: "failed",
					failure: "product",
					verifier: { passed: false },
					questions: [],
				};
			return {
				status: "completed",
				verifier: { passed: true },
				usage: { tokens: { total: 100 } },
				metrics: {
					tokens: 100,
					wallMs: 100,
					toolCalls: 1,
					subagentCalls: 0,
					toolOutputChars: 1,
					retries: 0,
					contextTokens: 1,
					questions: 0,
				},
				questions: [],
				artifacts: ["baseline"],
			};
		},
		async evaluatePair() {
			evaluatorCalls += 1;
			throw new Error("evaluator must not run after a hard-gate failure");
		},
	},
);
assert.equal(gatedDecision.status, "candidate-rejected");
assert.equal(evaluatorCalls, 0);
process.stdout.write(
	"ok - workflow evaluation smoke and decision lifecycle fixtures\n",
);
