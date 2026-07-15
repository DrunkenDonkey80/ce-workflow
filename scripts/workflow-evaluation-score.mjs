import { randomBytes } from "node:crypto";
import { MAXIMUM_DIMENSION_REGRESSION, MINIMUM_IMPROVEMENT } from "./work-improvement-benchmark.mjs";

const REQUIRED_METRICS = ["tokens", "wallMs", "toolCalls", "subagentCalls", "toolOutputChars", "retries", "contextTokens", "questions"];

function median(values) {
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function allowedAnchors(rubric) {
	return Array.isArray(rubric.anchors) ? rubric.anchors : Object.keys(rubric.anchors ?? {}).map(Number);
}

function cleanArtifact(artifact) {
	if (typeof artifact === "string") return artifact;
	if (artifact && typeof artifact === "object") return { text: String(artifact.text ?? artifact.content ?? "") };
	return { text: "" };
}

export function blindArtifacts(baseline, candidate, rubric, bytes = randomBytes) {
	const swap = (bytes(1)[0] & 1) === 1;
	const mapping = swap ? { A: "candidate", B: "baseline" } : { A: "baseline", B: "candidate" };
	const artifacts = swap ? { A: cleanArtifact(candidate), B: cleanArtifact(baseline) } : { A: cleanArtifact(baseline), B: cleanArtifact(candidate) };
	return { evaluatorInput: { rubric, artifacts }, control: { mapping } };
}

export function validateEvaluatorResult(result, dimensions, rubric) {
	if (!result || typeof result !== "object") throw new Error("evaluator result must be an object");
	for (const label of ["A", "B"]) {
		if (!result[label] || typeof result[label] !== "object") throw new Error(`missing evaluator label ${label}`);
		for (const dimension of dimensions) {
			const score = result[label][dimension];
			if (!allowedAnchors(rubric).includes(score)) throw new Error(`invalid ${label}.${dimension} score`);
		}
	}
	return result;
}

function validSample(sample, rubric) {
	if (!sample || typeof sample !== "object") return "sample missing";
	if (sample.hard?.passed !== true) return "hard gate failed";
	if (!REQUIRED_METRICS.every((metric) => Number.isFinite(sample.metrics?.[metric]) && sample.metrics[metric] >= 0)) return "required metrics missing";
	const dimensions = Object.keys(sample.scores ?? {});
	if (!dimensions.length || rubric.criticalDimensions.some((dimension) => !dimensions.includes(dimension))) return "rubric dimensions missing";
	if (!dimensions.every((dimension) => allowedAnchors(rubric).includes(sample.scores[dimension]))) return "rubric score invalid";
	if (!Number.isFinite(sample.unexpectedQuestions) || sample.unexpectedQuestions < 0) return "unexpected question metric missing";
	return null;
}

function invalid(reason, pairs = []) { return { status: "invalid", reason, pairs }; }
function rejected(reason, pairs = []) { return { status: "candidate-rejected", reason, pairs }; }
function improvement(baseline, candidate) { return baseline === 0 ? (candidate === 0 ? 0 : -Infinity) : (baseline - candidate) / baseline; }

export function evaluateDecision(inputPairs, rubric, options = {}) {
	if (!Array.isArray(inputPairs) || inputPairs.length !== 3) return invalid("decision-requires-three-pairs");
	const pairs = [];
	const samples = { baseline: [], candidate: [] };
	for (let index = 0; index < inputPairs.length; index += 1) {
		const pair = inputPairs[index];
		const expectedOrder = index % 2 ? ["candidate", "baseline"] : ["baseline", "candidate"];
		if (pair.pairIndex !== index || JSON.stringify(pair.order) !== JSON.stringify(expectedOrder)) return invalid("pair-order-invalid", pairs);
		if (!Array.isArray(pair.attempts) || pair.attempts.length < 1 || pair.attempts.length > 2) return invalid("attempt-count-invalid", pairs);
		const first = pair.attempts[0];
		let selected = first;
		if (first.infrastructureFailure) {
			if (pair.attempts.length !== 2) return invalid("infrastructure-replacement-missing", pairs);
			selected = pair.attempts[1];
			if (!selected.baseline || !selected.candidate) return invalid("selective-retry-invalid", pairs);
			if (selected.infrastructureFailure) return invalid("second-infrastructure-failure", pairs);
		} else if (pair.attempts.length !== 1) return invalid("selective-retry-invalid", pairs);
		if (!selected.baseline || !selected.candidate) return invalid("paired-samples-required", pairs);
		const baselineIssue = validSample(selected.baseline, rubric);
		if (baselineIssue) return invalid(`baseline-${baselineIssue}`, pairs);
		const candidateIssue = validSample(selected.candidate, rubric);
		if (candidateIssue) return candidateIssue === "hard gate failed" ? rejected("candidate-hard-gate-failed", pairs) : invalid(`candidate-${candidateIssue}`, pairs);
		samples.baseline.push(selected.baseline);
		samples.candidate.push(selected.candidate);
		pairs.push({ pairIndex: index, order: pair.order, attempts: pair.attempts, selectedAttempt: pair.attempts.indexOf(selected), deltas: Object.fromEntries(REQUIRED_METRICS.map((metric) => [metric, selected.candidate.metrics[metric] - selected.baseline.metrics[metric]])) });
	}

	const dimensions = [...new Set(samples.baseline.flatMap((sample) => Object.keys(sample.scores)))];
	const qualitative = Object.fromEntries(dimensions.map((dimension) => [dimension, {
		baseline: median(samples.baseline.map((sample) => sample.scores[dimension])),
		candidate: median(samples.candidate.map((sample) => sample.scores[dimension])),
	}]));
	const baselineQuality = median(samples.baseline.map((sample) => dimensions.reduce((sum, dimension) => sum + sample.scores[dimension], 0) / dimensions.length));
	const candidateQuality = median(samples.candidate.map((sample) => dimensions.reduce((sum, dimension) => sum + sample.scores[dimension], 0) / dimensions.length));
	if (rubric.criticalDimensions.some((dimension) => qualitative[dimension].candidate < qualitative[dimension].baseline)) return rejected("critical-dimension-regression", pairs);
	if (candidateQuality < baselineQuality) return rejected("qualitative-median-regression", pairs);
	const baselineQuestions = samples.baseline.reduce((sum, sample) => sum + sample.unexpectedQuestions, 0);
	const candidateQuestions = samples.candidate.reduce((sum, sample) => sum + sample.unexpectedQuestions, 0);
	if (candidateQuestions > baselineQuestions) return rejected("unexpected-questions-regressed", pairs);

	const summary = Object.fromEntries(REQUIRED_METRICS.map((metric) => {
		const baselineValues = samples.baseline.map((sample) => sample.metrics[metric]);
		const candidateValues = samples.candidate.map((sample) => sample.metrics[metric]);
		const baselineMedian = median(baselineValues);
		const candidateMedian = median(candidateValues);
		return [metric, { baseline: { min: Math.min(...baselineValues), median: baselineMedian, max: Math.max(...baselineValues) }, candidate: { min: Math.min(...candidateValues), median: candidateMedian, max: Math.max(...candidateValues) }, delta: candidateMedian - baselineMedian, improvement: improvement(baselineMedian, candidateMedian) }];
	}));
	const improved = REQUIRED_METRICS.filter((metric) => summary[metric].candidate.median < summary[metric].baseline.median);
	const regressedTooFar = REQUIRED_METRICS.some((metric) => summary[metric].candidate.median > summary[metric].baseline.median * (1 + MAXIMUM_DIMENSION_REGRESSION));
	const primary = options.primaryMetric;
	const aggregate = REQUIRED_METRICS.reduce((sum, metric) => sum + Math.max(-1, summary[metric].improvement), 0) / REQUIRED_METRICS.length;
	const threshold = Math.max(MINIMUM_IMPROVEMENT, options.minimumImprovement ?? 0);
	const costWin = (primary ? summary[primary]?.improvement : aggregate) >= threshold && improved.length > 0 && !regressedTooFar;
	return { status: costWin ? "candidate-accepted" : "quality-pass-no-cost-win", reason: costWin ? "quality-and-cost-pass" : "cost-threshold-not-met", pairs, summary, qualitative, unexpectedQuestions: { baseline: baselineQuestions, candidate: candidateQuestions }, aggregateImprovement: aggregate };
}
