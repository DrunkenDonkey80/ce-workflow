#!/usr/bin/env node
import assert from "node:assert/strict";
import {
	adaptRoutingCohorts,
	evaluateRoutingPaths,
} from "./workflow-evaluation-routing-cohorts.mjs";

const roleMapping = {
	main: { provider: "fixture", model: "one-model", effort: "medium" },
	"work-worker": { provider: "fixture", model: "one-model", effort: "medium" },
};
const strata = [
	{ mode: "tui", project: "calculator", assuranceStratum: "normal" },
	{ mode: "rpc", project: "csv-expenses", assuranceStratum: "normal" },
	{ mode: "autonomous", project: "calculator", assuranceStratum: "high" },
];

function sample({
	pairId,
	arm,
	path = "default",
	passing = true,
	weak = false,
	...stratum
}) {
	const sampleId = `${pairId}-${arm}`;
	const candidate = arm === "candidate";
	const turns = candidate ? (weak ? 9.8 : 8) : 10;
	const context = candidate ? (weak ? 980 : 800) : 1000;
	const cost = candidate ? (weak ? 0.99 : 0.8) : 1;
	const timestamp = `2026-07-27T00:00:${String(Number(pairId.at(-1)) * 2).padStart(2, "0")}.000Z`;
	const identity = {
		telemetrySchemaVersion: 1,
		workflow: {
			packageVersion: "0.1.0",
			gitRevision: candidate ? `candidate-${path}` : "baseline-build",
			routingPolicyRevision: candidate ? `${path}-v1` : "default-v1",
			behaviorFingerprint: `${candidate ? path : "default"}-behavior`,
		},
	};
	return [
		{
			...identity,
			type: "agent-terminal",
			sampleId,
			pairId,
			role: "main",
			parentAgentId: null,
			turns,
			parentContextTokens: context,
			usage: { cost: cost * 0.6 },
			timestamp,
		},
		{
			...identity,
			type: "agent-terminal",
			sampleId,
			pairId,
			role: "work-worker",
			parentAgentId: `${sampleId}:main`,
			usage: { cost: cost * 0.4 },
			timestamp,
		},
		{
			...identity,
			type: "workflow-complete",
			sampleId,
			pairId,
			pairArm: arm,
			treatmentId: arm === "baseline" ? "control" : path,
			routingPath: path,
			roleMapping,
			...stratum,
			closedExecutableItem: true,
			evaluationComplete: true,
			postCloseWindowComplete: true,
			firstPassVerification: true,
			quality: {
				reviewFindings: candidate && !passing ? 1 : 0,
				acceptedPostCloseFindings: 0,
				reopenOrDebug: 0,
				escalations: 0,
				manualInterventions: 0,
			},
			operational: {
				latencyMs: candidate ? 80 : 100,
				staleOrDiscardedBackgroundMs: 0,
				duplicateOrAmbiguousRecoveries: 0,
				infrastructureFailures: 0,
			},
			totalCostUsd: cost,
			timestamp,
		},
	];
}

function paired(path, options = {}) {
	return strata.flatMap((stratum, index) => {
		const pairId = `${path}-${index + 1}`;
		return [
			...sample({ pairId, arm: "baseline", ...stratum }),
			...sample({ pairId, arm: "candidate", path, ...stratum, ...options }),
		];
	});
}

const passing = adaptRoutingCohorts([
	...paired("sentinel"),
	...paired("prefetch"),
]);
assert.equal(passing.eventsRead, 36);
assert.equal(passing.qualifiedItems, 12);
assert.deepEqual(
	new Set(passing.cohorts.map((cohort) => cohort.stratum.mode)),
	new Set(["tui", "rpc", "autonomous"]),
	"TUI, RPC, and autonomous mode remain explicit cohort strata",
);
assert.ok(
	passing.cohorts.every(
		(cohort) =>
			cohort.stratum.workflowBuild &&
			cohort.stratum.routingPolicy &&
			cohort.stratum.roleMapping &&
			cohort.stratum.project &&
			cohort.stratum.assuranceStratum,
	),
	"full acceptance identity is retained in every cohort",
);
const passingReport = evaluateRoutingPaths(passing);
assert.deepEqual(passingReport.retainedPaths, ["sentinel", "prefetch"]);
assert.deepEqual(passingReport.removedPaths, []);
assert.ok(
	passingReport.decisions.every(
		(decision) =>
			decision.defaultsChanged === false &&
			decision.score.reason === "material-savings-without-regression",
	),
);
assert.equal(passingReport.providerFallback, "provider-neutral");

const failing = adaptRoutingCohorts([
	...paired("sentinel", { passing: false }),
	...paired("prefetch", { weak: true }),
]);
const failingReport = evaluateRoutingPaths(failing);
assert.deepEqual(failingReport.retainedPaths, []);
assert.deepEqual(failingReport.removedPaths, ["sentinel", "prefetch"]);
assert.match(failingReport.decisions[0].score.reason, /^guardrail-regression:/);
assert.equal(
	failingReport.decisions[1].score.reason,
	"material-savings-threshold-not-met",
);
assert.ok(
	failingReport.decisions.every(
		(decision) =>
			decision.disposition === "disable-remove-dead-adapter-config" &&
			decision.defaultsChanged === false,
	),
);

const noEvidenceReport = evaluateRoutingPaths(
	adaptRoutingCohorts([
		{
			type: "workflow-complete",
			sampleId: "incomplete",
			closedExecutableItem: true,
			evaluationComplete: false,
		},
	]),
);
assert.deepEqual(noEvidenceReport.removedPaths, ["sentinel", "prefetch"]);
assert.ok(
	noEvidenceReport.decisions.every(
		(decision) => decision.score.reason === "no-qualified-evidence",
	),
	"absent real-world evidence fails closed without changing defaults",
);

const calibrated = evaluateRoutingPaths(passing, {
	calibration: { minimumImprovement: 0.25 },
});
assert.deepEqual(
	calibrated.removedPaths,
	["sentinel", "prefetch"],
	"existing stricter calibration remains authoritative",
);

const legacy = adaptRoutingCohorts([
	...sample({ pairId: "legacy-1", arm: "baseline", ...strata[0] }).map(
		({ telemetrySchemaVersion, workflow, ...event }) => event,
	),
	...sample({ pairId: "legacy-2", arm: "baseline", ...strata[0] }).map(
		({ telemetrySchemaVersion, workflow, ...event }) => event,
	),
]);
assert.equal(legacy.qualifiedItems, 2);
assert.equal(legacy.cohorts.length, 2);
assert.ok(
	legacy.cohorts.every((cohort) => cohort.stratum.identityKind === "legacy"),
	"legacy samples are isolated rather than merged into versioned cohorts",
);

const mixedIdentity = adaptRoutingCohorts(
	strata.flatMap((stratum, index) => {
		const pairId = `mixed-${index + 1}`;
		return [
			...sample({ pairId, arm: "baseline", ...stratum }).map(
				({ telemetrySchemaVersion, workflow, ...event }) => event,
			),
			...sample({ pairId, arm: "candidate", path: "sentinel", ...stratum }),
		];
	}),
);
const mixedIdentityReport = evaluateRoutingPaths(mixedIdentity);
assert.equal(
	mixedIdentityReport.decisions[0].score.reason,
	"no-qualified-evidence",
	"legacy and versioned arms never form decision pairs",
);
assert.deepEqual(mixedIdentityReport.removedPaths, ["sentinel", "prefetch"]);
assert.ok(
	mixedIdentityReport.decisions.every(
		(decision) => decision.defaultsChanged === false,
	),
);

process.stdout.write(
	"ok - live routing cohorts and deterministic simplification decisions\n",
);
