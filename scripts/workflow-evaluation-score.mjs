import { randomBytes } from "node:crypto";
import {
	MAXIMUM_DIMENSION_REGRESSION,
	MINIMUM_IMPROVEMENT,
} from "./work-improvement-benchmark.mjs";

const REQUIRED_METRICS = [
	"tokens",
	"wallMs",
	"toolCalls",
	"subagentCalls",
	"toolOutputChars",
	"retries",
	"contextTokens",
	"questions",
];

function median(values) {
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2
		? sorted[middle]
		: (sorted[middle - 1] + sorted[middle]) / 2;
}

function allowedAnchors(rubric) {
	return Array.isArray(rubric.anchors)
		? rubric.anchors
		: Object.keys(rubric.anchors ?? {}).map(Number);
}

function artifactText(item) {
	if (typeof item === "string") return item;
	return item?.text ?? item?.content ?? "";
}

function cleanArtifact(artifact) {
	if (typeof artifact === "string") return { text: artifact };
	if (Array.isArray(artifact))
		return { text: artifact.map(artifactText).join("\n\n") };
	if (artifact && typeof artifact === "object")
		return { text: String(artifact.text ?? artifact.content ?? "") };
	return { text: "" };
}

export function blindArtifacts(
	baseline,
	candidate,
	rubric,
	bytes = randomBytes,
) {
	const swap = (bytes(1)[0] & 1) === 1;
	const mapping = swap
		? { A: "candidate", B: "baseline" }
		: { A: "baseline", B: "candidate" };
	const artifacts = swap
		? { A: cleanArtifact(candidate), B: cleanArtifact(baseline) }
		: { A: cleanArtifact(baseline), B: cleanArtifact(candidate) };
	return { evaluatorInput: { rubric, artifacts }, control: { mapping } };
}

export function validateEvaluatorResult(result, dimensions, rubric) {
	if (!result || typeof result !== "object")
		throw new Error("evaluator result must be an object");
	for (const label of ["A", "B"]) {
		if (!result[label] || typeof result[label] !== "object")
			throw new Error(`missing evaluator label ${label}`);
		for (const dimension of dimensions) {
			const score = result[label][dimension];
			if (!allowedAnchors(rubric).includes(score))
				throw new Error(`invalid ${label}.${dimension} score`);
		}
	}
	return result;
}

function judgmentWinner(judgment, dimensions, criticalDimensions) {
	const deltas = Object.fromEntries(
		dimensions.map((dimension) => [
			dimension,
			judgment.scores.candidate[dimension] -
				judgment.scores.baseline[dimension],
		]),
	);
	if (criticalDimensions.some((dimension) => deltas[dimension] < 0))
		return { winner: "baseline", deltas };
	const total = dimensions.reduce(
		(sum, dimension) => sum + deltas[dimension],
		0,
	);
	let winner = "tie";
	if (total > 0) winner = "candidate";
	else if (total < 0) winner = "baseline";
	return { winner, deltas };
}

export function evaluatePanel(judgments, rubric, options = {}) {
	if (!Array.isArray(judgments) || judgments.length !== 2)
		return { status: "invalid", reason: "panel-requires-two-evaluators" };
	const dimensions = rubric.dimensions ?? rubric.criticalDimensions;
	const identities = [];
	const decisions = [];
	for (let index = 0; index < judgments.length; index += 1) {
		const judgment = judgments[index];
		if (judgment?.status && judgment.status !== "completed")
			return { status: "invalid", reason: `evaluator-${judgment.status}` };
		const identity = `${judgment?.identity?.provider}/${judgment?.identity?.model}`;
		if (!judgment?.identity?.provider || !judgment?.identity?.model)
			return { status: "invalid", reason: "evaluator-identity-missing" };
		if (
			options.expectedIdentities?.[index] !== undefined &&
			options.expectedIdentities[index] !== identity
		)
			return { status: "invalid", reason: "evaluator-identity-drift" };
		if (identities.includes(identity))
			return { status: "invalid", reason: "panel-identities-not-independent" };
		identities.push(identity);
		if (!judgment.scores?.baseline || !judgment.scores?.candidate)
			return { status: "invalid", reason: "evaluator-output-malformed" };
		for (const side of ["baseline", "candidate"])
			for (const dimension of dimensions)
				if (!allowedAnchors(rubric).includes(judgment.scores[side][dimension]))
					return { status: "invalid", reason: "evaluator-output-malformed" };
		decisions.push(
			judgmentWinner(judgment, dimensions, rubric.criticalDimensions),
		);
	}
	const objective = options.objectiveEvidence;
	if (
		objective?.passed === true &&
		objective.defectId === options.expectedDefectId
	)
		return {
			status: "panel-agreement",
			winner: objective.winner,
			reason: "matching-objective-defect-evidence",
			judgments,
			decisions,
		};
	if (decisions[0].winner !== decisions[1].winner)
		return {
			status: "evaluator-disagreement-no-winner",
			reason: "opposite-or-critical-direction",
			judgments,
			decisions,
		};
	return {
		status: "panel-agreement",
		winner: decisions[0].winner,
		reason: decisions[0].winner === "tie" ? "agreed-tie" : "agreed-direction",
		judgments,
		decisions,
	};
}

export function recommendationOutcome(panel, decision) {
	if (!panel) return { status: "invalid", reason: "evaluator-panel-required" };
	if (panel.status === "invalid") return panel;
	if (panel.status === "evaluator-disagreement-no-winner") return panel;
	if (panel.winner === "tie")
		return { status: "evaluator-disagreement-no-winner", reason: "agreed-tie" };
	if (panel.winner === "baseline")
		return { status: "candidate-rejected", reason: "panel-prefers-baseline" };
	if (decision?.status !== "candidate-accepted")
		return {
			status: decision?.status ?? "invalid",
			reason: decision?.reason ?? "decision-evidence-missing",
		};
	return { status: "candidate-accepted", reason: "panel-and-decision-agree" };
}

export function pairedUncertainty(deltas, noiseFloor = 0) {
	if (
		!Array.isArray(deltas) ||
		deltas.length < 3 ||
		deltas.some((value) => !Number.isFinite(value))
	)
		throw new Error("paired uncertainty requires at least three finite deltas");
	return {
		median: median(deltas),
		min: Math.min(...deltas),
		max: Math.max(...deltas),
		positive: deltas.filter((value) => value > noiseFloor).length,
		negative: deltas.filter((value) => value < -noiseFloor).length,
		withinNoise: deltas.filter((value) => Math.abs(value) <= noiseFloor).length,
		noiseFloor,
	};
}

const PRICE_CATEGORIES = [
	"input",
	"output",
	"reasoning",
	"cacheRead",
	"cacheWrite",
];
const PARETO_COSTS = [
	"tokens",
	"normalizedBilledCost",
	"wallMs",
	"toolCalls",
	"retries",
	"questions",
	"rework",
	"criticOverhead",
];

export function paretoFrontier(candidates, options = {}) {
	const priceTable = options.priceTable;
	const priceComparable = Boolean(
		priceTable &&
			options.priceFingerprint === priceTable.fingerprint &&
			PRICE_CATEGORIES.every((category) =>
				Number.isFinite(priceTable.prices?.[category]),
			),
	);
	const observations = candidates.map((candidate) => {
		const normalizedBilledCost = priceComparable
			? PRICE_CATEGORIES.reduce(
					(sum, category) =>
						sum +
						((candidate.usage?.[category] ?? 0) * priceTable.prices[category]) /
							1_000_000,
					0,
				)
			: null;
		return { ...candidate, normalizedBilledCost };
	});
	const dominates = (left, right) => {
		if (left.quality < right.quality) return false;
		let strict = left.quality > right.quality;
		for (const metric of PARETO_COSTS) {
			if (metric === "normalizedBilledCost" && !priceComparable) continue;
			if (!Number.isFinite(left[metric]) || !Number.isFinite(right[metric]))
				continue;
			if (left[metric] > right[metric]) return false;
			if (left[metric] < right[metric]) strict = true;
		}
		return strict;
	};
	return {
		priceComparable,
		lowerCostClaimAllowed: priceComparable,
		metrics: ["quality", ...PARETO_COSTS],
		observations,
		frontier: observations.filter(
			(candidate) =>
				!observations.some(
					(other) => other.id !== candidate.id && dominates(other, candidate),
				),
		),
	};
}

function validSample(sample, rubric) {
	if (!sample || typeof sample !== "object") return "sample missing";
	if (sample.hard?.passed !== true) return "hard gate failed";
	if (
		!REQUIRED_METRICS.every(
			(metric) =>
				Number.isFinite(sample.metrics?.[metric]) &&
				sample.metrics[metric] >= 0,
		)
	)
		return "required metrics missing";
	const dimensions = Object.keys(sample.scores ?? {});
	const required = rubric.dimensions ?? rubric.criticalDimensions;
	if (
		!dimensions.length ||
		required.some((dimension) => !dimensions.includes(dimension))
	)
		return "rubric dimensions missing";
	if (
		!dimensions.every((dimension) =>
			allowedAnchors(rubric).includes(sample.scores[dimension]),
		)
	)
		return "rubric score invalid";
	if (
		!Number.isFinite(sample.unexpectedQuestions) ||
		sample.unexpectedQuestions < 0
	)
		return "unexpected question metric missing";
	return null;
}

function invalid(reason, pairs = []) {
	return { status: "invalid", reason, pairs };
}
function rejected(reason, pairs = []) {
	return { status: "candidate-rejected", reason, pairs };
}
function improvement(baseline, candidate) {
	if (baseline !== 0) return (baseline - candidate) / baseline;
	return candidate === 0 ? 0 : -Infinity;
}

export function evaluateDecision(inputPairs, rubric, options = {}) {
	if (!Array.isArray(inputPairs) || inputPairs.length !== 3)
		return invalid("decision-requires-three-pairs");
	const pairs = [];
	const samples = { baseline: [], candidate: [] };
	for (let index = 0; index < inputPairs.length; index += 1) {
		const pair = inputPairs[index];
		const expectedOrder =
			index % 2 ? ["candidate", "baseline"] : ["baseline", "candidate"];
		if (
			pair.pairIndex !== index ||
			JSON.stringify(pair.order) !== JSON.stringify(expectedOrder)
		)
			return invalid("pair-order-invalid", pairs);
		if (
			!Array.isArray(pair.attempts) ||
			pair.attempts.length < 1 ||
			pair.attempts.length > 2
		)
			return invalid("attempt-count-invalid", pairs);
		const first = pair.attempts[0];
		let selected = first;
		if (first.infrastructureFailure) {
			if (pair.attempts.length !== 2)
				return invalid("infrastructure-replacement-missing", pairs);
			selected = pair.attempts[1];
			if (!selected.baseline || !selected.candidate)
				return invalid("selective-retry-invalid", pairs);
			if (selected.infrastructureFailure)
				return invalid("second-infrastructure-failure", pairs);
		} else if (pair.attempts.length !== 1)
			return invalid("selective-retry-invalid", pairs);
		if (!selected.baseline || !selected.candidate)
			return invalid("paired-samples-required", pairs);
		if (selected.comparisonFailure)
			return invalid(selected.comparisonFailure, pairs);
		if (selected.evaluatorFailure) return invalid("evaluator-failure", pairs);
		if (selected.baseline.hard?.passed !== true)
			return invalid("baseline-hard-gate-failed", pairs);
		if (selected.candidate.hard?.passed !== true)
			return rejected("candidate-hard-gate-failed", pairs);
		const baselineIssue = validSample(selected.baseline, rubric);
		if (baselineIssue) return invalid(`baseline-${baselineIssue}`, pairs);
		const candidateIssue = validSample(selected.candidate, rubric);
		if (candidateIssue)
			return candidateIssue === "hard gate failed"
				? rejected("candidate-hard-gate-failed", pairs)
				: invalid(`candidate-${candidateIssue}`, pairs);
		samples.baseline.push(selected.baseline);
		samples.candidate.push(selected.candidate);
		pairs.push({
			pairIndex: index,
			order: pair.order,
			attempts: pair.attempts,
			selectedAttempt: pair.attempts.indexOf(selected),
			deltas: Object.fromEntries(
				REQUIRED_METRICS.map((metric) => [
					metric,
					selected.candidate.metrics[metric] -
						selected.baseline.metrics[metric],
				]),
			),
		});
	}

	const dimensions = [
		...new Set(
			samples.baseline.flatMap((sample) => Object.keys(sample.scores)),
		),
	];
	const qualitative = Object.fromEntries(
		dimensions.map((dimension) => [
			dimension,
			{
				baseline: median(
					samples.baseline.map((sample) => sample.scores[dimension]),
				),
				candidate: median(
					samples.candidate.map((sample) => sample.scores[dimension]),
				),
			},
		]),
	);
	const baselineQuality = median(
		samples.baseline.map(
			(sample) =>
				dimensions.reduce(
					(sum, dimension) => sum + sample.scores[dimension],
					0,
				) / dimensions.length,
		),
	);
	const candidateQuality = median(
		samples.candidate.map(
			(sample) =>
				dimensions.reduce(
					(sum, dimension) => sum + sample.scores[dimension],
					0,
				) / dimensions.length,
		),
	);
	if (
		rubric.criticalDimensions.some(
			(dimension) =>
				qualitative[dimension].candidate < qualitative[dimension].baseline,
		)
	)
		return rejected("critical-dimension-regression", pairs);
	if (candidateQuality < baselineQuality)
		return rejected("qualitative-median-regression", pairs);
	const baselineQuestions = samples.baseline.reduce(
		(sum, sample) => sum + sample.unexpectedQuestions,
		0,
	);
	const candidateQuestions = samples.candidate.reduce(
		(sum, sample) => sum + sample.unexpectedQuestions,
		0,
	);
	if (candidateQuestions > baselineQuestions)
		return rejected("unexpected-questions-regressed", pairs);

	const summary = Object.fromEntries(
		REQUIRED_METRICS.map((metric) => {
			const baselineValues = samples.baseline.map(
				(sample) => sample.metrics[metric],
			);
			const candidateValues = samples.candidate.map(
				(sample) => sample.metrics[metric],
			);
			const baselineMedian = median(baselineValues);
			const candidateMedian = median(candidateValues);
			return [
				metric,
				{
					baseline: {
						min: Math.min(...baselineValues),
						median: baselineMedian,
						max: Math.max(...baselineValues),
					},
					candidate: {
						min: Math.min(...candidateValues),
						median: candidateMedian,
						max: Math.max(...candidateValues),
					},
					delta: candidateMedian - baselineMedian,
					improvement: improvement(baselineMedian, candidateMedian),
				},
			];
		}),
	);
	const improved = REQUIRED_METRICS.filter(
		(metric) =>
			summary[metric].candidate.median < summary[metric].baseline.median,
	);
	const maximumRegression = Math.max(
		MAXIMUM_DIMENSION_REGRESSION,
		options.maximumDimensionRegression ?? 0,
	);
	const regressedTooFar = REQUIRED_METRICS.some(
		(metric) =>
			summary[metric].candidate.median >
			summary[metric].baseline.median * (1 + maximumRegression),
	);
	const primary = options.primaryMetric;
	const aggregate =
		REQUIRED_METRICS.reduce(
			(sum, metric) => sum + Math.max(-1, summary[metric].improvement),
			0,
		) / REQUIRED_METRICS.length;
	const threshold = Math.max(
		MINIMUM_IMPROVEMENT,
		options.minimumImprovement ?? 0,
	);
	const costWin =
		(primary ? summary[primary]?.improvement : aggregate) >= threshold &&
		improved.length > 0 &&
		!regressedTooFar;
	let reason = "cost-threshold-not-met";
	if (costWin) reason = "quality-and-cost-pass";
	else if (regressedTooFar) reason = "cost-dimension-regression";
	return {
		status: costWin ? "candidate-accepted" : "quality-pass-no-cost-win",
		reason,
		pairs,
		summary,
		qualitative,
		unexpectedQuestions: {
			baseline: baselineQuestions,
			candidate: candidateQuestions,
		},
		aggregateImprovement: aggregate,
	};
}
