#!/usr/bin/env node
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

// Canonicalize on Windows so tooling does not load the runner twice under drive-letter casing variants.
const { runBenchmarkGatePlan } = await import(
	pathToFileURL(
		realpathSync(path.join(import.meta.dirname, "work-improvement-runner.mjs")),
	).href
);

export const COST_WEIGHTS = Object.freeze({
	tokens: 0.2,
	latencyMs: 0.2,
	outputChars: 0.2,
	calls: 0.2,
	retries: 0.2,
});
export const MINIMUM_IMPROVEMENT = 0.05;
export const MAXIMUM_DIMENSION_REGRESSION = 0.1;
export const MAX_RAW_SAMPLES = 3;

const LIFECYCLE_FIXTURES = [
	"test-work-goal.mjs",
	"test-work-resume.mjs",
	"test-work-start-finish.mjs",
];
const TELEMETRY_FIXTURES = [
	"test-work-telemetry.mjs",
	"test-work-usage.mjs",
	"test-work-optimization-helpers.mjs",
	...LIFECYCLE_FIXTURES,
];
const ORCHESTRATION_FIXTURES = [
	"test-work-settings.mjs",
	"test-work-goal.mjs",
	"test-work-resume.mjs",
	"test-work-start-finish.mjs",
	...TELEMETRY_FIXTURES,
];
const AGENT_SCENARIOS = [
	"small",
	"medium",
	"large",
	"goal",
	"review",
	"finalization",
];

/** Existing fixtures selected for each changed surface. Unrecognized source paths take the conservative full set. */
export const CHANGED_PATH_FIXTURE_MANIFEST = Object.freeze([
	{
		match:
			/^(extensions\/work-improvement\.js|scripts\/test-work-improvement-analyzer\.mjs)$/,
		deterministic: [
			"test-work-improvement-analyzer.mjs",
			...TELEMETRY_FIXTURES,
		],
		agentBacked: [],
	},
	{
		match: /^scripts\/test-work-(telemetry|usage|optimization-helpers)\.mjs$/,
		deterministic: TELEMETRY_FIXTURES,
		agentBacked: [],
	},
	{
		match: /^extensions\/work-models\.js$/,
		deterministic: ORCHESTRATION_FIXTURES,
		agentBacked: AGENT_SCENARIOS,
	},
	{
		match: /^(prompts|agents)\//,
		deterministic: ["test-work-settings.mjs"],
		agentBacked: AGENT_SCENARIOS,
	},
	{
		match:
			/^(skills\/|scripts\/work-helper\.mjs|scripts\/work-command-fixture\.mjs)/,
		deterministic: ORCHESTRATION_FIXTURES,
		agentBacked: AGENT_SCENARIOS,
	},
	{
		match: /^scripts\/work-improvement-runner\.mjs$/,
		deterministic: ["test-work-improvement-git.mjs", ...ORCHESTRATION_FIXTURES],
		agentBacked: AGENT_SCENARIOS,
	},
]);

const ALL_DETERMINISTIC = [
	...new Set(
		CHANGED_PATH_FIXTURE_MANIFEST.flatMap((entry) => entry.deterministic),
	),
];

function normalizedPath(value) {
	return String(value ?? "")
		.replaceAll("\\", "/")
		.replace(/^\.\//, "");
}

export function buildBenchmarkPlan(changedPaths) {
	const paths = [
		...new Set((changedPaths ?? []).map(normalizedPath).filter(Boolean)),
	].sort();
	const selections = paths.map((changedPath) =>
		CHANGED_PATH_FIXTURE_MANIFEST.filter((entry) =>
			entry.match.test(changedPath),
		),
	);
	const selected =
		paths.length === 0 || selections.some((entries) => entries.length === 0)
			? [{ deterministic: ALL_DETERMINISTIC, agentBacked: AGENT_SCENARIOS }]
			: selections.flat();
	return {
		packageVerifyRequired: true,
		changedPaths: paths,
		deterministicFixtureIds: [
			...new Set(selected.flatMap((entry) => entry.deterministic)),
		].sort(),
		agentScenarioIds: [
			...new Set(selected.flatMap((entry) => entry.agentBacked)),
		].sort(),
	};
}

function agentConfiguration(environment, options) {
	const nested =
		options.agentConfiguration ??
		options.agent ??
		environment.agentConfiguration ??
		environment.agent ??
		{};
	const provider =
		options.provider ??
		options.agentProvider ??
		nested.provider ??
		environment.provider ??
		environment.agentProvider;
	const model =
		options.model ??
		options.agentModel ??
		nested.model ??
		environment.model ??
		environment.agentModel;
	const modelSettings =
		options.modelSettings ??
		options.agentModelSettings ??
		nested.modelSettings ??
		environment.modelSettings ??
		environment.agentModelSettings;
	return provider && model && modelSettings && typeof modelSettings === "object"
		? { provider, model, modelSettings }
		: null;
}

function canonicalValue(value) {
	if (Array.isArray(value)) return value.map(canonicalValue);
	if (value && typeof value === "object")
		return Object.fromEntries(
			Object.entries(value)
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([key, nested]) => [key, canonicalValue(nested)]),
		);
	return value;
}

export function benchmarkEnvironment(environment = {}, options = {}) {
	const agent = agentConfiguration(environment, options);
	const details = {
		platform: environment.platform ?? process.platform,
		arch: environment.arch ?? process.arch,
		node: environment.node ?? process.versions.node,
		...environment,
		...(agent ? { agent } : {}),
	};
	const fingerprint = createHash("sha256")
		.update(JSON.stringify(canonicalValue(details)))
		.digest("hex");
	return { details, fingerprint };
}

function median(values) {
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.floor(sorted.length / 2)];
}

function boundedSample(sample) {
	return {
		hard: {
			outcomes: { ...(sample?.hard?.outcomes ?? {}) },
			gates: { ...(sample?.hard?.gates ?? {}) },
			telemetry: sample?.hard?.telemetry,
			errors: sample?.hard?.errors,
		},
		cost: Object.fromEntries(
			Object.keys(COST_WEIGHTS).map((key) => [key, sample?.cost?.[key]]),
		),
	};
}

const BASE_QUALITY = Object.freeze({
	outcomes: ["completed"],
	gates: ["verification"],
});

function mandatoryQuality(fixture) {
	const requirements = {
		outcomes: [...BASE_QUALITY.outcomes],
		gates: [...BASE_QUALITY.gates],
	};
	if (
		fixture.fixtureId === "test-work-goal.mjs" ||
		fixture.fixtureId === "goal"
	)
		requirements.outcomes.push("goal");
	if (
		fixture.fixtureId === "test-work-start-finish.mjs" ||
		fixture.fixtureId === "finalization"
	)
		requirements.gates.push("review", "commit", "close", "push");
	else if (["small", "medium", "large"].includes(fixture.fixtureId)) {
		requirements.gates.push("commit", "close", "push");
		if (fixture.fixtureId === "large") requirements.gates.push("review");
	} else if (fixture.fixtureId === "review") requirements.gates.push("review");
	return requirements;
}

function aggregateSamples(samples) {
	const rawSamples = samples.slice(0, MAX_RAW_SAMPLES).map(boundedSample);
	const outcomeKeys = [
		...new Set(
			rawSamples.flatMap((sample) => Object.keys(sample.hard.outcomes)),
		),
	];
	const gateKeys = [
		...new Set(rawSamples.flatMap((sample) => Object.keys(sample.hard.gates))),
	];
	return {
		sampleCount: rawSamples.length,
		rawSamples,
		measurement: {
			hard: {
				outcomes: Object.fromEntries(
					outcomeKeys.map((key) => [
						key,
						rawSamples.every((sample) => sample.hard.outcomes[key] === true),
					]),
				),
				gates: Object.fromEntries(
					gateKeys.map((key) => [
						key,
						rawSamples.every((sample) => sample.hard.gates[key] === true),
					]),
				),
				telemetry: rawSamples.every((sample) => sample.hard.telemetry === true),
				errors: Math.max(...rawSamples.map((sample) => sample.hard.errors)),
			},
			cost: Object.fromEntries(
				Object.keys(COST_WEIGHTS).map((key) => [
					key,
					median(rawSamples.map((sample) => sample.cost[key])),
				]),
			),
		},
	};
}

/** Capture bounded benchmark evidence. Package verification always runs first. */
export async function captureBenchmarkEvidence({
	sourceSha,
	baselineSourceSha = null,
	changedPaths,
	environment,
	options,
	provider,
	model,
	modelSettings,
	seams,
}) {
	if (typeof sourceSha !== "string" || !sourceSha)
		throw new TypeError("sourceSha is required");
	const plan = buildBenchmarkPlan(changedPaths);
	const env = benchmarkEnvironment(environment, {
		...options,
		provider,
		model,
		modelSettings,
	});
	if (plan.agentScenarioIds.length > 0 && !env.details.agent)
		throw new TypeError(
			"agent configuration is required for agent-backed benchmarks",
		);
	const execution = await runBenchmarkGatePlan(plan, seams);
	const fixtures = [...execution.deterministic, ...execution.agentBacked].map(
		(entry) => ({
			fixtureId: entry.fixtureId,
			kind: execution.agentBacked.includes(entry)
				? "agent-backed"
				: "deterministic",
			...aggregateSamples(entry.samples),
		}),
	);
	return {
		version: 1,
		sourceSha,
		baselineSourceSha,
		fixtureIds: fixtures.map((fixture) => fixture.fixtureId),
		environment: env.details,
		environmentFingerprint: env.fingerprint,
		packageVerification: execution.packageVerification,
		fixtures,
	};
}

function invalid(reason, details = {}) {
	return { passed: false, reason, ...details };
}

function validRawSample(sample) {
	return (
		sample &&
		Object.values(sample.hard?.outcomes ?? {}).every(
			(value) => typeof value === "boolean",
		) &&
		Object.values(sample.hard?.gates ?? {}).every(
			(value) => typeof value === "boolean",
		) &&
		typeof sample.hard?.telemetry === "boolean" &&
		Number.isFinite(sample.hard?.errors) &&
		sample.hard.errors >= 0 &&
		Object.keys(COST_WEIGHTS).every(
			(key) => Number.isFinite(sample.cost?.[key]) && sample.cost[key] >= 0,
		)
	);
}

function sameAggregate(fixture) {
	const aggregate = aggregateSamples(fixture.rawSamples);
	return (
		JSON.stringify(aggregate.measurement) ===
		JSON.stringify(fixture.measurement)
	);
}

function validMeasurement(fixture) {
	const hard = fixture?.measurement?.hard;
	const cost = fixture?.measurement?.cost;
	const expectedSamples = fixture?.kind === "agent-backed" ? 3 : 1;
	return (
		fixture?.sampleCount === expectedSamples &&
		fixture.sampleCount <= MAX_RAW_SAMPLES &&
		fixture.rawSamples?.length === fixture.sampleCount &&
		fixture.rawSamples.every(validRawSample) &&
		sameAggregate(fixture) &&
		hard &&
		Object.keys(hard.outcomes ?? {}).length > 0 &&
		Object.values(hard.outcomes).every((value) => typeof value === "boolean") &&
		Object.keys(hard.gates ?? {}).length > 0 &&
		Object.values(hard.gates).every((value) => typeof value === "boolean") &&
		typeof hard.telemetry === "boolean" &&
		Number.isFinite(hard.errors) &&
		hard.errors >= 0 &&
		Object.keys(COST_WEIGHTS).every(
			(key) => Number.isFinite(cost?.[key]) && cost[key] >= 0,
		)
	);
}

function compareBooleanMap(kind, baseline, candidate, fixtureId) {
	const baselineKeys = Object.keys(baseline);
	if (
		baselineKeys.length !== Object.keys(candidate).length ||
		baselineKeys.some((key) => !(key in candidate))
	)
		return invalid("required-metrics-missing", { fixtureId, metric: kind });
	const failed = baselineKeys.find((key) => candidate[key] !== true);
	return failed
		? invalid("quality-regression", { fixtureId, metric: `${kind}.${failed}` })
		: null;
}

/** Apply hard non-regression gates before the balanced cost score. */
export function evaluateBenchmarkEvidence(baseline, candidate, options = {}) {
	if (
		baseline?.sourceSha !==
			(options.expectedBaselineSha ?? baseline?.sourceSha) ||
		candidate?.baselineSourceSha !== baseline?.sourceSha
	)
		return invalid("baseline-sha-mismatch");
	const hasAgentFixtures = (baseline?.fixtures ?? []).some(
		(fixture) => fixture.kind === "agent-backed",
	);
	if (
		hasAgentFixtures &&
		(!baseline.environment?.agent || !candidate?.environment?.agent)
	)
		return invalid("agent-configuration-missing");
	if (
		!baseline?.environmentFingerprint ||
		baseline.environmentFingerprint !== candidate?.environmentFingerprint ||
		benchmarkEnvironment(baseline.environment).fingerprint !==
			baseline.environmentFingerprint ||
		benchmarkEnvironment(candidate?.environment).fingerprint !==
			candidate.environmentFingerprint
	)
		return invalid("environment-mismatch");
	if (
		baseline.packageVerification?.passed !== true ||
		candidate.packageVerification?.passed !== true
	)
		return invalid("package-verification-failed");
	if (
		JSON.stringify(baseline.fixtureIds) !== JSON.stringify(candidate.fixtureIds)
	)
		return invalid("fixture-mismatch");
	const baselineById = new Map(
		(baseline.fixtures ?? []).map((fixture) => [fixture.fixtureId, fixture]),
	);
	const candidateById = new Map(
		(candidate.fixtures ?? []).map((fixture) => [fixture.fixtureId, fixture]),
	);
	const totals = {
		baseline: Object.fromEntries(
			Object.keys(COST_WEIGHTS).map((key) => [key, 0]),
		),
		candidate: Object.fromEntries(
			Object.keys(COST_WEIGHTS).map((key) => [key, 0]),
		),
	};
	for (const fixtureId of baseline.fixtureIds ?? []) {
		const before = baselineById.get(fixtureId);
		const after = candidateById.get(fixtureId);
		if (!validMeasurement(before) || !validMeasurement(after))
			return invalid("required-metrics-missing", { fixtureId });
		const mandatory = mandatoryQuality(before);
		for (const kind of ["outcomes", "gates"]) {
			const missing = mandatory[kind].find(
				(key) =>
					before.measurement.hard[kind]?.[key] !== true ||
					after.measurement.hard[kind]?.[key] !== true,
			);
			if (missing)
				return invalid("required-metrics-missing", {
					fixtureId,
					metric: `${kind}.${missing}`,
				});
			const failed = compareBooleanMap(
				kind,
				before.measurement.hard[kind],
				after.measurement.hard[kind],
				fixtureId,
			);
			if (failed) return failed;
		}
		if (!after.measurement.hard.telemetry)
			return invalid("telemetry-regression", { fixtureId });
		if (after.measurement.hard.errors > before.measurement.hard.errors)
			return invalid("error-regression", { fixtureId });
		for (const key of Object.keys(COST_WEIGHTS)) {
			totals.baseline[key] += before.measurement.cost[key];
			totals.candidate[key] += after.measurement.cost[key];
		}
	}
	const ratios = {};
	for (const key of Object.keys(COST_WEIGHTS)) {
		const before = totals.baseline[key];
		const after = totals.candidate[key];
		ratios[key] =
			before === 0
				? after === 0
					? 1
					: Number.POSITIVE_INFINITY
				: after / before;
		if (ratios[key] > 1 + MAXIMUM_DIMENSION_REGRESSION)
			return invalid("cost-dimension-regression", {
				dimension: key,
				ratio: ratios[key],
			});
	}
	const weightedRatio = Object.entries(COST_WEIGHTS).reduce(
		(sum, [key, weight]) => sum + ratios[key] * weight,
		0,
	);
	const improvement = 1 - weightedRatio;
	return improvement + Number.EPSILON >= MINIMUM_IMPROVEMENT
		? {
				passed: true,
				reason: "accepted",
				improvement,
				weightedRatio,
				ratios,
				totals,
			}
		: invalid("insufficient-cost-improvement", {
				improvement,
				weightedRatio,
				ratios,
				totals,
			});
}
