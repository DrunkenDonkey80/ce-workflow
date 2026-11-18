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
// Optional quality per run: `passed` (boolean) or `score` (finite number). A pair compares it only when both
// sides report the same field with a valid value; otherwise it is "not comparable", never a pass or a zero.
const QUALITY = { passed: (v) => typeof v === "boolean", score: (v) => Number.isFinite(v) };
function quality(b, c) {
	const field = Object.keys(QUALITY).find((name) => QUALITY[name](b[name]) && QUALITY[name](c[name]));
	if (field) return { field, baseline: b[field], candidate: c[field] };
	return Object.keys(QUALITY).some((name) => name in b || name in c) ? { notComparable: true } : undefined;
}
const keyOf = (r) => `${r.scenario ?? r.policy ?? ""}#${r.repetition}`;

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
		return { key, metrics: Object.fromEntries(Object.entries(METRICS).map(([name, pick]) => [name, { baseline: pick(b), candidate: pick(c), delta: pick(c) - pick(b) }])), ...(q ? { quality: q } : {}) };
	});
	const complete = pairs.filter((p) => p.metrics);
	const totals = Object.fromEntries(Object.keys(METRICS).map((name) => {
		const baseline = complete.reduce((s, p) => s + p.metrics[name].baseline, 0);
		const candidate = complete.reduce((s, p) => s + p.metrics[name].candidate, 0);
		return [name, { baseline, candidate, delta: candidate - baseline, change: baseline ? (candidate - baseline) / baseline : null }];
	}));
	return { pairs, complete: complete.length, total: pairs.length, totals, ...summarizeQuality(complete) };
}

// Pass counts and mean scores over the pairs that compare them; any drop flags the candidate even when it is cheaper.
function summarizeQuality(complete) {
	const rated = complete.filter((p) => p.quality);
	if (!rated.length) return {};
	const out = { notComparable: rated.filter((p) => p.quality.notComparable).length, dropped: false };
	for (const field of Object.keys(QUALITY)) {
		const pairs = rated.filter((p) => p.quality.field === field);
		if (!pairs.length) continue;
		const sum = (side) => pairs.reduce((s, p) => s + Number(p.quality[side]), 0) / (field === "score" ? pairs.length : 1);
		out[field] = { pairs: pairs.length, baseline: sum("baseline"), candidate: sum("candidate") };
		if (out[field].candidate < out[field].baseline) out.dropped = true;
	}
	return { quality: out };
}

const fmt = (n) => (Math.abs(n) >= 100 ? Math.round(n).toLocaleString("en-US") : Number(n.toFixed(4)).toString());

export function formatComparison(result) {
	const lines = [];
	for (const p of result.pairs) {
		if (p.incomplete) { lines.push(`${p.key}: incomplete (${p.incomplete})`); continue; }
		const q = !p.quality ? "" : p.quality.notComparable ? ", quality not comparable" : `, ${p.quality.field} ${p.quality.baseline} -> ${p.quality.candidate}`;
		lines.push(`${p.key}: ${Object.entries(p.metrics).map(([n, m]) => `${n} ${fmt(m.baseline)} -> ${fmt(m.candidate)}`).join(", ")}${q}`);
	}
	lines.push(`Totals over ${result.complete} of ${result.total} pairs complete:`);
	for (const [n, t] of Object.entries(result.totals))
		lines.push(`  ${n}: ${fmt(t.baseline)} -> ${fmt(t.candidate)} (${t.change === null ? "n/a" : `${t.change >= 0 ? "+" : ""}${(t.change * 100).toFixed(1)}%`})`);
	const q = result.quality;
	if (q) {
		if (q.passed) lines.push(`  passed: ${q.passed.baseline}/${q.passed.pairs} -> ${q.passed.candidate}/${q.passed.pairs}`);
		if (q.score) lines.push(`  mean score: ${fmt(q.score.baseline)} -> ${fmt(q.score.candidate)} over ${q.score.pairs} pairs`);
		if (q.notComparable) lines.push(`  quality not comparable in ${q.notComparable} pair(s): one side lacks the field, reports another or an invalid value`);
		if (q.dropped) lines.push("QUALITY DROP: the candidate passes less or scores lower; do not accept it on cost alone.");
	}
	if (result.complete < result.total) lines.push("Incomplete pairs are excluded: rerun them before calling the candidate cheaper or better.");
	return lines.join("\n");
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
