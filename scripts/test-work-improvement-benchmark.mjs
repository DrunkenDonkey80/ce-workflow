#!/usr/bin/env node
import {
	benchmarkEnvironment,
	buildBenchmarkPlan,
	captureBenchmarkEvidence,
	evaluateBenchmarkEvidence,
	MAX_RAW_SAMPLES,
} from "./work-improvement-benchmark.mjs";

function assert(ok, message) {
	if (!ok) throw new Error(message);
}

function sample(cost = 100) {
	return {
		hard: {
			outcomes: { completed: true, goal: true },
			gates: {
				verification: true,
				review: true,
				commit: true,
				close: true,
				push: true,
			},
			telemetry: true,
			errors: 0,
		},
		cost: {
			tokens: cost,
			latencyMs: cost,
			outputChars: cost,
			calls: cost,
			retries: cost,
		},
	};
}

async function capture(
	sourceSha,
	baselineSourceSha,
	cost,
	changedPaths = ["prompts/work-small.md"],
) {
	let packageCalls = 0;
	let deterministicCalls = 0;
	let agentCalls = 0;
	const evidence = await captureBenchmarkEvidence({
		sourceSha,
		baselineSourceSha,
		changedPaths,
		environment: {
			platform: "fixture",
			arch: "fixture",
			node: "fixture",
			provider: "fixture-provider",
			model: "fixture-model",
			modelSettings: { thinking: "high", temperature: 0 },
		},
		seams: {
			runPackageVerify() {
				packageCalls += 1;
				return { passed: true, command: "npm run verify" };
			},
			runDeterministicFixture() {
				deterministicCalls += 1;
				return sample(cost);
			},
			runAgentScenario() {
				agentCalls += 1;
				return sample(cost);
			},
		},
	});
	return { evidence, packageCalls, deterministicCalls, agentCalls };
}

const telemetryPlan = buildBenchmarkPlan(["scripts/test-work-telemetry.mjs"]);
assert(
	telemetryPlan.agentScenarioIds.length === 0 &&
		telemetryPlan.deterministicFixtureIds.includes("test-work-usage.mjs") &&
		[
			"test-work-goal.mjs",
			"test-work-resume.mjs",
			"test-work-start-finish.mjs",
		].every((id) => telemetryPlan.deterministicFixtureIds.includes(id)) &&
		!telemetryPlan.deterministicFixtureIds.some((id) => /browser|ui/i.test(id)),
	"telemetry-only changes include the minimal lifecycle fixture set",
);
const mixedUnknownPlan = buildBenchmarkPlan([
	"scripts/test-work-telemetry.mjs",
	"unrecognized/new-surface.mjs",
]);
assert(
	mixedUnknownPlan.agentScenarioIds.length === 6 &&
		mixedUnknownPlan.deterministicFixtureIds.includes(
			"test-work-improvement-git.mjs",
		),
	"one unrecognized path conservatively selects the full scenario set",
);

const promptPlan = buildBenchmarkPlan(["agents/bead-worker.md"]);
assert(
	["small", "medium", "large", "goal", "review", "finalization"].every((id) =>
		promptPlan.agentScenarioIds.includes(id),
	),
	"prompt and agent surfaces select representative agent-backed scenarios",
);
const orchestrationPlan = buildBenchmarkPlan(["scripts/work-helper.mjs"]);
assert(
	orchestrationPlan.deterministicFixtureIds.includes("test-work-resume.mjs") &&
		orchestrationPlan.deterministicFixtureIds.includes(
			"test-work-start-finish.mjs",
		),
	"orchestration and finalization select resume and finish coverage",
);

const configuredEnvironment = benchmarkEnvironment(
	{ platform: "fixture", arch: "fixture", node: "fixture" },
	{
		provider: "fixture-provider",
		model: "fixture-model",
		modelSettings: { thinking: "high" },
	},
);
const changedModelSettings = benchmarkEnvironment(
	{ platform: "fixture", arch: "fixture", node: "fixture" },
	{
		provider: "fixture-provider",
		model: "fixture-model",
		modelSettings: { thinking: "low" },
	},
);
assert(
	configuredEnvironment.details.agent.model === "fixture-model" &&
		configuredEnvironment.fingerprint !== changedModelSettings.fingerprint,
	"agent configuration supplied through options is fingerprinted",
);
let missingAgentConfigurationRejected = false;
try {
	await captureBenchmarkEvidence({
		sourceSha: "missing-agent",
		changedPaths: ["agents/bead-worker.md"],
		environment: { platform: "fixture", arch: "fixture", node: "fixture" },
		seams: {},
	});
} catch (error) {
	missingAgentConfigurationRejected = /agent configuration is required/.test(
		String(error),
	);
}
assert(
	missingAgentConfigurationRejected,
	"agent-backed capture rejects before execution when configuration is missing",
);

const baselineRun = await capture("base-sha", null, 100);
const candidateRun = await capture("candidate-sha", "base-sha", 90);
assert(
	baselineRun.packageCalls === 1 && candidateRun.packageCalls === 1,
	"package verify is mandatory and runs once per revision",
);
assert(
	baselineRun.deterministicCalls ===
		baselineRun.evidence.fixtures.filter(
			(fixture) => fixture.kind === "deterministic",
		).length,
	"deterministic fixtures run once",
);
assert(
	baselineRun.agentCalls ===
		baselineRun.evidence.fixtures.filter(
			(fixture) => fixture.kind === "agent-backed",
		).length *
			3,
	"agent-backed runner seam takes exactly three samples without launching agents",
);
assert(
	baselineRun.evidence.fixtures.every((fixture) =>
		fixture.kind === "agent-backed"
			? fixture.sampleCount === 3 &&
				fixture.rawSamples.length === MAX_RAW_SAMPLES
			: fixture.sampleCount === 1,
	),
	"evidence retains bounded raw samples and sample counts",
);
assert(
	baselineRun.evidence.sourceSha === "base-sha" &&
		baselineRun.evidence.fixtureIds.length > 0 &&
		baselineRun.evidence.environmentFingerprint,
	"evidence stores source SHA, fixture IDs, and environment fingerprint",
);
function setEvidenceCost(evidence, cost) {
	for (const fixture of evidence.fixtures) {
		for (const key of [
			"tokens",
			"latencyMs",
			"outputChars",
			"calls",
			"retries",
		]) {
			fixture.measurement.cost[key] = cost;
			for (const raw of fixture.rawSamples) raw.cost[key] = cost;
		}
	}
}

const exactThreshold = structuredClone(candidateRun.evidence);
setEvidenceCost(exactThreshold, 95);
const passing = evaluateBenchmarkEvidence(
	baselineRun.evidence,
	exactThreshold,
	{ expectedBaselineSha: "base-sha" },
);
assert(
	passing.passed && passing.improvement >= 0.05,
	"balanced improvement of exactly five percent passes",
);
const belowThreshold = structuredClone(exactThreshold);
setEvidenceCost(belowThreshold, 96);
assert(
	evaluateBenchmarkEvidence(baselineRun.evidence, belowThreshold).reason ===
		"insufficient-cost-improvement",
	"balanced improvement below five percent rejects",
);

let noisyIndex = 0;
const noisy = await captureBenchmarkEvidence({
	sourceSha: "noisy",
	baselineSourceSha: "base-sha",
	changedPaths: ["agents/bead-worker.md"],
	environment: {
		platform: "fixture",
		arch: "fixture",
		node: "fixture",
		provider: "fixture-provider",
		model: "fixture-model",
		modelSettings: { thinking: "high", temperature: 0 },
	},
	seams: {
		runPackageVerify: () => ({ passed: true }),
		runDeterministicFixture: () => sample(60),
		runAgentScenario: () => sample([100, 50, 60][noisyIndex++ % 3]),
	},
});
assert(
	noisy.fixtures
		.filter((fixture) => fixture.kind === "agent-backed")
		.every((fixture) => fixture.measurement.cost.tokens === 60),
	"noisy agent-backed cost metrics use median-of-three",
);

const finalizationIndex = candidateRun.evidence.fixtures.findIndex(
	(fixture) => fixture.fixtureId === "finalization",
);
const missingCandidateGate = structuredClone(candidateRun.evidence);
delete missingCandidateGate.fixtures[finalizationIndex].measurement.hard.gates
	.commit;
for (const raw of missingCandidateGate.fixtures[finalizationIndex].rawSamples)
	delete raw.hard.gates.commit;
assert(
	evaluateBenchmarkEvidence(baselineRun.evidence, missingCandidateGate)
		.reason === "required-metrics-missing",
	"missing mandatory candidate lifecycle gate rejects",
);
const missingBaselineGate = structuredClone(baselineRun.evidence);
delete missingBaselineGate.fixtures[finalizationIndex].measurement.hard.gates
	.push;
for (const raw of missingBaselineGate.fixtures[finalizationIndex].rawSamples)
	delete raw.hard.gates.push;
assert(
	evaluateBenchmarkEvidence(missingBaselineGate, candidateRun.evidence)
		.reason === "required-metrics-missing",
	"missing mandatory baseline lifecycle gate rejects",
);
const goalIndex = candidateRun.evidence.fixtures.findIndex(
	(fixture) => fixture.fixtureId === "goal",
);
const missingOutcome = structuredClone(candidateRun.evidence);
delete missingOutcome.fixtures[goalIndex].measurement.hard.outcomes.goal;
for (const raw of missingOutcome.fixtures[goalIndex].rawSamples)
	delete raw.hard.outcomes.goal;
assert(
	evaluateBenchmarkEvidence(baselineRun.evidence, missingOutcome).reason ===
		"required-metrics-missing",
	"missing mandatory scenario outcome rejects",
);

const qualityLoss = structuredClone(candidateRun.evidence);
qualityLoss.fixtures[0].measurement.hard.gates.review = false;
qualityLoss.fixtures[0].rawSamples[0].hard.gates.review = false;
assert(
	evaluateBenchmarkEvidence(baselineRun.evidence, qualityLoss).reason ===
		"quality-regression",
	"skipped hard gates reject before scoring",
);
const missing = structuredClone(candidateRun.evidence);
delete missing.fixtures[0].measurement.cost.tokens;
assert(
	evaluateBenchmarkEvidence(baselineRun.evidence, missing).reason ===
		"required-metrics-missing",
	"missing required metrics reject",
);
const tamperedAggregate = structuredClone(candidateRun.evidence);
tamperedAggregate.fixtures[0].measurement.cost.tokens += 1;
assert(
	evaluateBenchmarkEvidence(baselineRun.evidence, tamperedAggregate).reason ===
		"required-metrics-missing",
	"aggregate metrics must match bounded raw samples",
);
const wrongSampleCount = structuredClone(candidateRun.evidence);
wrongSampleCount.fixtures[finalizationIndex].sampleCount = 2;
wrongSampleCount.fixtures[finalizationIndex].rawSamples.pop();
assert(
	evaluateBenchmarkEvidence(baselineRun.evidence, wrongSampleCount).reason ===
		"required-metrics-missing",
	"agent-backed evidence requires exactly three samples",
);
const deterministicIndex = candidateRun.evidence.fixtures.findIndex(
	(fixture) => fixture.kind === "deterministic",
);
const repeatedDeterministic = structuredClone(candidateRun.evidence);
repeatedDeterministic.fixtures[deterministicIndex].sampleCount = 2;
repeatedDeterministic.fixtures[deterministicIndex].rawSamples.push(
	structuredClone(
		repeatedDeterministic.fixtures[deterministicIndex].rawSamples[0],
	),
);
assert(
	evaluateBenchmarkEvidence(baselineRun.evidence, repeatedDeterministic)
		.reason === "required-metrics-missing",
	"deterministic evidence requires exactly one sample",
);

const wrongSha = structuredClone(candidateRun.evidence);
wrongSha.baselineSourceSha = "other";
assert(
	evaluateBenchmarkEvidence(baselineRun.evidence, wrongSha).reason ===
		"baseline-sha-mismatch",
	"baseline SHA mismatch rejects",
);
const wrongEnvironment = structuredClone(candidateRun.evidence);
wrongEnvironment.environment.agent.modelSettings.thinking = "low";
assert(
	evaluateBenchmarkEvidence(baselineRun.evidence, wrongEnvironment).reason ===
		"environment-mismatch",
	"provider, model, and model settings are bound by the environment fingerprint",
);
const missingAgentEnvironment = structuredClone(candidateRun.evidence);
delete missingAgentEnvironment.environment.agent;
assert(
	evaluateBenchmarkEvidence(baselineRun.evidence, missingAgentEnvironment)
		.reason === "agent-configuration-missing",
	"missing agent configuration prevents comparison",
);
const errors = structuredClone(candidateRun.evidence);
errors.fixtures[0].measurement.hard.errors = 1;
errors.fixtures[0].rawSamples[0].hard.errors = 1;
assert(
	evaluateBenchmarkEvidence(baselineRun.evidence, errors).reason ===
		"error-regression",
	"error growth rejects before cost scoring",
);
const dimensionRegression = structuredClone(candidateRun.evidence);
for (const fixture of dimensionRegression.fixtures) {
	fixture.measurement.cost.tokens = 111;
	for (const raw of fixture.rawSamples) raw.cost.tokens = 111;
	for (const key of ["latencyMs", "outputChars", "calls", "retries"]) {
		fixture.measurement.cost[key] = 50;
		for (const raw of fixture.rawSamples) raw.cost[key] = 50;
	}
}
assert(
	evaluateBenchmarkEvidence(baselineRun.evidence, dimensionRegression)
		.reason === "cost-dimension-regression",
	"one cost dimension beyond ten percent regression rejects despite lower total cost",
);

const failedPackage = await captureBenchmarkEvidence({
	sourceSha: "failed",
	changedPaths: ["agents/bead-worker.md"],
	environment: {
		platform: "fixture",
		arch: "fixture",
		node: "fixture",
		provider: "fixture-provider",
		model: "fixture-model",
		modelSettings: { thinking: "high", temperature: 0 },
	},
	seams: {
		runPackageVerify: () => ({ passed: false }),
		runDeterministicFixture: () => {
			throw new Error("fixtures must not run after package failure");
		},
		runAgentScenario: () => {
			throw new Error("agents must not run after package failure");
		},
	},
});
assert(
	failedPackage.fixtures.length === 0,
	"package verification failure stops later benchmark gates",
);

console.log("ok - work improvement benchmark fixtures pass");
