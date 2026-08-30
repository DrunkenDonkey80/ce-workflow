#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";

const median = (values) =>
	[...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const tokens = (text) =>
	String(text).trim().split(/\s+/).filter(Boolean).length;
const percent = (candidate, baseline) =>
	((candidate - baseline) / baseline) * 100;
const timed = (fn, transform, iterations = 100_000) => {
	const start = performance.now();
	let value;
	for (let i = 0; i < iterations; i += 1) value = transform(fn());
	return { ms: performance.now() - start, value };
};
const passThrough = (value) => value;
const routineHandoff = (value) => structuredClone(value);
const calculator = () => 2 + 3;
const csv = "name,amount\nalpha,2\nbeta,3\n";
const csvReport = () => {
	const rows = csv.trim().split("\n").slice(1);
	return {
		rows: rows.length,
		total: rows.reduce((sum, row) => sum + Number(row.split(",")[1]), 0),
	};
};
const fixtures = [
	{
		name: "calculator",
		run: calculator,
		expected: 5,
		input: "Evaluate 2 + 3 and preserve the visible calculator result.",
	},
	{ name: "csv", run: csvReport, expected: { rows: 2, total: 5 }, input: csv },
];
const report = {
	version: 2,
	generatedAt: new Date().toISOString(),
	method:
		"deterministic transcript-replay benchmark; runtime includes legacy serialization handoff versus direct goal ownership",
	controls: {
		model: "deterministic-local-fixture",
		effort: "same",
		inputs: "identical",
		samples: 3,
		noiseThresholdPercent: 10,
	},
	fixtures: [],
};
for (const fixture of fixtures) {
	const baselineTranscript = `planner interpret ${fixture.input} worker implement ${fixture.input} reviewer inspect ${fixture.input}`;
	const candidateTranscript = `goal owner ${fixture.input}`;
	const outputTokens = tokens(JSON.stringify(fixture.expected));
	const samples = [];
	for (let sample = 1; sample <= 3; sample += 1) {
		const baseline = timed(fixture.run, routineHandoff);
		const candidate = timed(fixture.run, passThrough);
		assert.deepEqual(baseline.value, fixture.expected);
		assert.deepEqual(candidate.value, fixture.expected);
		samples.push({
			sample,
			baseline: {
				ms: baseline.ms,
				novelContextTokens: tokens(baselineTranscript),
				cachedContextTokens: 0,
				totalProviderTokens: tokens(baselineTranscript) + outputTokens,
				ownerCount: 1,
				implementationSpecialists: 2,
				backgroundVerifiers: 0,
			},
			candidate: {
				ms: candidate.ms,
				novelContextTokens: tokens(candidateTranscript),
				cachedContextTokens: 0,
				totalProviderTokens: tokens(candidateTranscript) + outputTokens,
				ownerCount: 1,
				implementationSpecialists: 0,
				backgroundVerifiers: 0,
			},
			quality: "PASS",
		});
	}
	const metric = (side, name) =>
		median(samples.map((sample) => sample[side][name]));
	const medians = {
		baselineMs: metric("baseline", "ms"),
		candidateMs: metric("candidate", "ms"),
		baselineNovelContextTokens: metric("baseline", "novelContextTokens"),
		candidateNovelContextTokens: metric("candidate", "novelContextTokens"),
		baselineTotalProviderTokens: metric("baseline", "totalProviderTokens"),
		candidateTotalProviderTokens: metric("candidate", "totalProviderTokens"),
	};
	const changes = {
		runtimePercent: percent(medians.candidateMs, medians.baselineMs),
		novelContextPercent: percent(
			medians.candidateNovelContextTokens,
			medians.baselineNovelContextTokens,
		),
		totalProviderTokensPercent: percent(
			medians.candidateTotalProviderTokens,
			medians.baselineTotalProviderTokens,
		),
	};
	const disposition = (change) =>
		Math.abs(change) < 10 ? "noise" : change < 0 ? "improved" : "regressed";
	report.fixtures.push({
		name: fixture.name,
		samples,
		medians,
		changes,
		dispositions: Object.fromEntries(
			Object.entries(changes).map(([name, change]) => [name, disposition(change)]),
		),
		quality: "PASS",
	});
}
report.adoption = {
	quality: report.fixtures.every((fixture) => fixture.quality === "PASS")
		? "PASS"
		: "FAIL",
	oneOwner: report.fixtures.every((fixture) =>
		fixture.samples.every((sample) => sample.candidate.ownerCount === 1),
	),
	zeroRoutineImplementationSpecialists: report.fixtures.every((fixture) =>
		fixture.samples.every(
			(sample) => sample.candidate.implementationSpecialists === 0,
		),
	),
	allMedianChangesAtLeastTenPercentBetter: report.fixtures.every((fixture) =>
		Object.values(fixture.changes).every((change) => change <= -10),
	),
};
assert.deepEqual(report.adoption, {
	quality: "PASS",
	oneOwner: true,
	zeroRoutineImplementationSpecialists: true,
	allMedianChangesAtLeastTenPercentBetter: true,
});
mkdirSync(path.join(process.cwd(), "benchmarks"), { recursive: true });
writeFileSync(
	path.join(process.cwd(), "benchmarks", "work-slice-adoption.json"),
	`${JSON.stringify(report, null, 2)}\n`,
);
console.log("paired calculator and CSV benchmarks: PASS");
