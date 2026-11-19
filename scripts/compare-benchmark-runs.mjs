#!/usr/bin/env node
// Compare a candidate benchmark results.json with the accepted baseline, run by run.
// Usage: node scripts/compare-benchmark-runs.mjs <baseline results.json> <candidate results.json> [--json]
// Runs pair by scenario and repetition; a missing, failed, unfinished or duplicated run makes its pair
// incomplete, and incomplete pairs never enter the totals (idea from Haystack's EvalRunResult comparison).
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const METRICS = {
	runtimeMs: (r) => r.elapsedMs,
	totalTokens: (r) => r.usage?.totalTokens,
	costUsd: (r) => r.usage?.costUsd ?? r.usage?.cost?.total,
	turns: (r) => r.turns,
	toolCalls: (r) => r.toolCalls,
};
// Optional quality per run: `passed` (boolean; the self-verify benchmark writes it as `pass`) or `score` (finite number).
// A pair compares it only when both sides report the same field with a valid value. `<field>Error` (a judge that failed)
// and a null value (not applicable) leave the pair unscored; anything else is "not comparable", never a pass or a zero.
// Unscored pairs still count for runtime, tokens and cost.
const QUALITY = {
	passed: { pick: (r) => r.passed ?? r.pass, error: (r) => r.passedError ?? r.passError, has: (r) => "passed" in r || "pass" in r, valid: (v) => typeof v === "boolean" },
	score: { pick: (r) => r.score, error: (r) => r.scoreError, has: (r) => "score" in r, valid: (v) => Number.isFinite(v) },
};
function quality(b, c) {
	const names = Object.keys(QUALITY), q = (name) => QUALITY[name];
	const field = names.find((name) => q(name).valid(q(name).pick(b)) && q(name).valid(q(name).pick(c)));
	if (field) return { field, baseline: q(field).pick(b), candidate: q(field).pick(c) };
	const errored = names.find((name) => q(name).error(b) || q(name).error(c));
	if (errored) return { field: errored, judgeError: q(errored).error(b) || q(errored).error(c) };
	const na = names.find((name) => (q(name).has(b) && q(name).pick(b) === null) || (q(name).has(c) && q(name).pick(c) === null));
	if (na) return { field: na, notApplicable: true };
	return names.some((name) => q(name).has(b) || q(name).has(c)) ? { notComparable: true } : undefined;
}
const scenarioOf = (r) => r.scenario ?? r.policy ?? "";
const keyOf = (r) => `${scenarioOf(r)}#${r.repetition}`;

function index(results) {
	const runs = new Map();
	for (const r of results ?? []) {
		const key = keyOf(r);
		runs.set(key, runs.has(key) ? { duplicate: true } : r);
	}
	return runs;
}

function problem(r, side) {
	if (!r) return `${side} missing`;
	if (r.duplicate) return `${side} duplicated`;
	if (r.error) return `${side} failed`;
	if (r.completed === false) return `${side} not completed`;
	const absent = Object.entries(METRICS).find(([, pick]) => !Number.isFinite(pick(r)));
	return absent ? `${side} has no ${absent[0]}` : "";
}

export function compareRuns(baseline, candidate) {
	const base = index(baseline.results), cand = index(candidate.results);
	const keys = [...new Set([...base.keys(), ...cand.keys()])].sort();
	const pairs = keys.map((key) => {
		const b = base.get(key), c = cand.get(key);
		const incomplete = [problem(b, "baseline"), problem(c, "candidate")].filter(Boolean).join(", ");
		if (incomplete) return { key, incomplete };
		const q = quality(b, c);
		return { key, scenario: scenarioOf(b), metrics: Object.fromEntries(Object.entries(METRICS).map(([name, pick]) => [name, { baseline: pick(b), candidate: pick(c), delta: pick(c) - pick(b) }])), ...(q ? { quality: q } : {}) };
	});
	const complete = pairs.filter((p) => p.metrics);
	const totals = Object.fromEntries(Object.keys(METRICS).map((name) => {
		const baseline = complete.reduce((s, p) => s + p.metrics[name].baseline, 0);
		const candidate = complete.reduce((s, p) => s + p.metrics[name].candidate, 0);
		return [name, { baseline, candidate, delta: candidate - baseline, change: baseline ? (candidate - baseline) / baseline : null }];
	}));
	return { pairs, complete: complete.length, total: pairs.length, totals, ...summarizeQuality(complete) };
}

// Wilson score interval (95%) for k successes in n trials; sound at the 3-10 runs these benchmarks have.
export function wilson(k, n, z = 1.96) {
	if (!n) return null;
	const p = k / n, d = 1 + z * z / n, mid = (p + z * z / (2 * n)) / d, half = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d;
	return [Math.max(0, mid - half), Math.min(1, mid + half)];
}

// Pass counts and mean scores over the pairs that compare them, changes in both directions, and for pass/fail a
// Wilson interval per arm whose unit is the run (repetitions of one scenario are not independent cases, so the
// distinct scenarios are reported beside it). Any drop flags the candidate even when it is cheaper.
function summarizeQuality(complete) {
	const rated = complete.filter((p) => p.quality);
	if (!rated.length) return {};
	const count = (key) => rated.filter((p) => p.quality[key]).length;
	const out = { notComparable: count("notComparable"), judgeErrors: count("judgeError"), notApplicable: count("notApplicable"), scorable: 0, dropped: false };
	for (const field of Object.keys(QUALITY)) {
		const pairs = rated.filter((p) => p.quality.field === field && "baseline" in p.quality);
		if (!pairs.length) continue;
		out.scorable += pairs.length;
		const sum = (side) => pairs.reduce((s, p) => s + Number(p.quality[side]), 0) / (field === "score" ? pairs.length : 1);
		const diff = (p) => Number(p.quality.candidate) - Number(p.quality.baseline);
		const stats = {
			pairs: pairs.length, scenarios: new Set(pairs.map((p) => p.scenario)).size, baseline: sum("baseline"), candidate: sum("candidate"),
			improved: pairs.filter((p) => diff(p) > 0).length, regressed: pairs.filter((p) => diff(p) < 0).length, unchanged: pairs.filter((p) => diff(p) === 0).length,
		};
		if (field === "passed") {
			stats.interval = { unit: "runs", baseline: wilson(stats.baseline, stats.pairs), candidate: wilson(stats.candidate, stats.pairs) };
			stats.established = stats.interval.candidate[0] > stats.interval.baseline[1] || stats.interval.baseline[0] > stats.interval.candidate[1];
		}
		out[field] = stats;
		if (stats.candidate < stats.baseline) out.dropped = true;
	}
	return { quality: out };
}

const fmt = (n) => (Math.abs(n) >= 100 ? Math.round(n).toLocaleString("en-US") : Number(n.toFixed(4)).toString());

function pairQuality(q) {
	if (!q) return "";
	if (q.notComparable) return ", quality not comparable";
	if (q.judgeError) return `, ${q.field} unscored (judge error: ${q.judgeError})`;
	if (q.notApplicable) return `, ${q.field} not applicable`;
	return `, ${q.field} ${q.baseline} -> ${q.candidate}`;
}

export function formatComparison(result) {
	const lines = [];
	for (const p of result.pairs) {
		if (p.incomplete) { lines.push(`${p.key}: incomplete (${p.incomplete})`); continue; }
		lines.push(`${p.key}: ${Object.entries(p.metrics).map(([n, m]) => `${n} ${fmt(m.baseline)} -> ${fmt(m.candidate)}`).join(", ")}${pairQuality(p.quality)}`);
	}
	lines.push(`Totals over ${result.complete} of ${result.total} pairs complete:`);
	for (const [n, t] of Object.entries(result.totals))
		lines.push(`  ${n}: ${fmt(t.baseline)} -> ${fmt(t.candidate)} (${t.change === null ? "n/a" : `${t.change >= 0 ? "+" : ""}${(t.change * 100).toFixed(1)}%`})`);
	if (result.quality) lines.push(...qualityLines(result.quality));
	if (result.complete < result.total) lines.push("Incomplete pairs are excluded: rerun them before calling the candidate cheaper or better.");
	return lines.join("\n");
}

function qualityLines(q) {
	const lines = [];
	const pct = ([lo, hi]) => `${Math.round(lo * 100)}-${Math.round(hi * 100)}%`;
	const both = (s) => `improved ${s.improved}, regressed ${s.regressed}, unchanged ${s.unchanged}`;
	if (q.passed) {
		const p = q.passed;
		lines.push(`  passed: ${p.baseline}/${p.pairs} -> ${p.candidate}/${p.pairs} runs over ${p.scenarios} distinct scenario(s); ${both(p)}`);
		lines.push(`  95% interval per run (Wilson): ${pct(p.interval.baseline)} -> ${pct(p.interval.candidate)}${p.pairs > p.scenarios ? "; repetitions of one scenario are not independent, so it is narrower than the evidence" : ""}`);
		if (!p.established) lines.push("  Pass difference not established: the 95% intervals overlap, the sample cannot separate the arms.");
	}
	if (q.score) lines.push(`  mean score: ${fmt(q.score.baseline)} -> ${fmt(q.score.candidate)} over ${q.score.pairs} pairs, ${q.score.scenarios} distinct scenario(s); ${both(q.score)}; no interval for scores`);
	if (q.judgeErrors) lines.push(`  unscored in ${q.judgeErrors} pair(s): the judge failed (not a quality failure; runtime and cost still count)`);
	if (q.notApplicable) lines.push(`  not applicable in ${q.notApplicable} pair(s)`);
	if (!q.scorable) lines.push("  no scorable pairs: quality not established");
	if (q.notComparable) lines.push(`  quality not comparable in ${q.notComparable} pair(s): one side lacks the field, reports another or an invalid value`);
	if (q.dropped) lines.push("QUALITY DROP: the candidate passes less or scores lower; do not accept it on cost alone.");
	return lines;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
	const [basePath, candPath] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
	if (!basePath || !candPath) {
		console.error("Usage: node scripts/compare-benchmark-runs.mjs <baseline results.json> <candidate results.json> [--json]");
		process.exit(2);
	}
	const read = (file) => {
		try { return JSON.parse(readFileSync(file, "utf8")); }
		catch (error) { console.error(`Cannot read ${file}: ${error.message}`); process.exit(2); }
	};
	const result = compareRuns(read(basePath), read(candPath));
	console.log(process.argv.includes("--json") ? JSON.stringify(result, null, 2) : formatComparison(result));
	if (result.complete < result.total) process.exitCode = 1;
}
