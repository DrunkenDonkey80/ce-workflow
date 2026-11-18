#!/usr/bin/env node
import assert from "node:assert/strict";
import { compareRuns, formatComparison } from "./compare-benchmark-runs.mjs";

const run = (repetition, n, extra = {}) => ({ repetition, completed: true, elapsedMs: 1000 * n, turns: n, toolCalls: 2 * n, usage: { totalTokens: 100 * n, costUsd: 0.1 * n }, ...extra });

// Reordering does not change the pairing or the totals.
const base = { results: [run(1, 1), run(2, 2), run(3, 3)] };
const same = compareRuns(base, { results: [run(3, 6), run(1, 2), run(2, 4)] });
assert.equal(same.complete, 3);
assert.equal(same.totals.turns.baseline, 6);
assert.equal(same.totals.turns.candidate, 12);
assert.equal(same.pairs.find((p) => p.key === "#3").metrics.turns.delta, 3);

// A failed, a missing and an unfinished candidate run are incomplete, never zero cost.
const broken = compareRuns(
	{ results: [run(1, 1), run(2, 2), run(3, 3), run(4, 4)] },
	{ results: [run(1, 1), { repetition: 2, error: "boom" }, run(4, 1, { completed: false })] },
);
assert.equal(broken.complete, 1);
assert.equal(broken.total, 4);
assert.match(broken.pairs.find((p) => p.key === "#2").incomplete, /candidate failed/);
assert.match(broken.pairs.find((p) => p.key === "#3").incomplete, /candidate missing/);
assert.match(broken.pairs.find((p) => p.key === "#4").incomplete, /candidate not completed/);
assert.equal(broken.totals.costUsd.candidate, 0.1, "only the complete pair counts");
assert.match(formatComparison(broken), /Totals over 1 of 4 pairs complete/);

// Duplicate identities and runs without a metric are incomplete; the cost may sit in usage.cost.total.
const dup = compareRuns(
	{ results: [run(1, 1), run(1, 1), run(2, 2), run(3, 3)] },
	{ results: [run(1, 1), run(2, 2, { turns: undefined }), { ...run(3, 3), usage: { totalTokens: 300, cost: { total: 0.3 } } }] },
);
assert.match(dup.pairs.find((p) => p.key === "#1").incomplete, /baseline duplicated/);
assert.match(dup.pairs.find((p) => p.key === "#2").incomplete, /candidate has no turns/);
assert.equal(dup.complete, 1);
assert.equal(dup.totals.costUsd.candidate, 0.3);

// Scenario names keep different scenarios apart.
const scen = compareRuns({ results: [run(1, 1, { scenario: "a" }), run(1, 2, { scenario: "b" })] }, { results: [run(1, 1, { scenario: "b" })] });
assert.equal(scen.complete, 1);
assert.match(scen.pairs.find((p) => p.key === "a#1").incomplete, /candidate missing/);
assert.equal(scen.total, 2);

// Quality: a cheaper candidate that passes less is flagged; a lower mean score too.
const drop = compareRuns({ results: [run(1, 2, { passed: true }), run(2, 2, { passed: true })] }, { results: [run(1, 1, { passed: true }), run(2, 1, { passed: false })] });
assert.deepEqual(drop.quality.passed, { pairs: 2, baseline: 2, candidate: 1 });
assert.equal(drop.quality.dropped, true);
assert.match(formatComparison(drop), /passed: 2\/2 -> 1\/2[\s\S]*QUALITY DROP/);
const scored = compareRuns({ results: [run(1, 1, { score: 0.9 }), run(2, 1, { score: 0.7 })] }, { results: [run(1, 1, { score: 0.8 }), run(2, 1, { score: 0.6 })] });
assert.equal(scored.quality.dropped, true);
assert(Math.abs(scored.quality.score.baseline - 0.8) < 1e-9);
const better = compareRuns({ results: [run(1, 1, { passed: false })] }, { results: [run(1, 1, { passed: true })] });
assert.equal(better.quality.dropped, false);
assert.doesNotMatch(formatComparison(better), /QUALITY DROP/);

// Asymmetric or invalid fields are not comparable, never a pass or a zero.
const asym = compareRuns(
	{ results: [run(1, 1, { passed: true }), run(2, 1, { score: 1 }), run(3, 1, { passed: "yes" }), run(4, 1, { passed: true })] },
	{ results: [run(1, 1), run(2, 1, { passed: true }), run(3, 1, { passed: true }), run(4, 1, { passed: true })] },
);
assert.equal(asym.quality.notComparable, 3);
assert.deepEqual(asym.quality.passed, { pairs: 1, baseline: 1, candidate: 1 });
assert.equal(asym.quality.dropped, false);
assert.equal(asym.pairs.find((p) => p.key === "#1").quality.notComparable, true);
assert.match(formatComparison(asym), /quality not comparable in 3 pair/);

// Legacy results without either field compare exactly as before.
assert.equal(same.quality, undefined);
assert.doesNotMatch(formatComparison(same), /quality|QUALITY/);

console.log("compare-benchmark-runs: ok");
