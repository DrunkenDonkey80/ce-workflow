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

console.log("compare-benchmark-runs: ok");
