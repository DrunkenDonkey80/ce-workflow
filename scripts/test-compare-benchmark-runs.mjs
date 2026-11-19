#!/usr/bin/env node
import assert from "node:assert/strict";
import { compareRuns, formatComparison, wilson } from "./compare-benchmark-runs.mjs";

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
assert.deepEqual([drop.quality.passed.pairs, drop.quality.passed.baseline, drop.quality.passed.candidate, drop.quality.passed.regressed], [2, 2, 1, 1]);
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
assert.deepEqual([asym.quality.passed.pairs, asym.quality.passed.baseline, asym.quality.passed.candidate], [1, 1, 1]);
assert.equal(asym.quality.dropped, false);
assert.equal(asym.pairs.find((p) => p.key === "#1").quality.notComparable, true);
assert.match(formatComparison(asym), /quality not comparable in 3 pair/);

// Wilson interval: 0 of 3 still allows a 56% pass rate.
assert.deepEqual(wilson(0, 3).map((x) => Number(x.toFixed(3))), [0, 0.562]);
assert.equal(wilson(0, 0), null);

// Producer-shaped files (benchmark-self-verify-live writes `pass`): 3 reps of web plus 1 cli are 4 runs over
// 2 scenarios; a duplicated rep never adds a case; both directions are counted; overlapping intervals are not established.
const prod = (scenario, repetition, pass) => run(repetition, 1, { scenario, arm: "x", model: "m", pass, verified: true, finalText: "" });
const shaped = compareRuns(
	{ results: [prod("web", 1, false), prod("web", 2, true), prod("web", 3, false), prod("cli", 1, true), prod("cli", 2, true), prod("cli", 2, true)] },
	{ results: [prod("web", 1, true), prod("web", 2, true), prod("web", 3, true), prod("cli", 1, false), prod("cli", 2, true)] },
);
const sp = shaped.quality.passed;
assert.deepEqual([sp.pairs, sp.scenarios, sp.baseline, sp.candidate, sp.improved, sp.regressed, sp.unchanged], [4, 2, 2, 3, 2, 1, 1]);
assert.equal(sp.established, false);
assert.equal(sp.interval.unit, "runs");
const shapedText = formatComparison(shaped);
assert.match(shapedText, /passed: 2\/4 -> 3\/4 runs over 2 distinct scenario\(s\); improved 2, regressed 1, unchanged 1/);
assert.match(shapedText, /95% interval per run \(Wilson\): 15-85% -> 30-95%; repetitions of one scenario are not independent/);
assert.match(shapedText, /Pass difference not established/);
assert.match(shaped.pairs.find((p) => p.key === "cli#2").incomplete, /baseline duplicated/);

// A clear separation is established and prints no "not established" line.
const ten = (pass) => ({ results: Array.from({ length: 10 }, (_, i) => run(i + 1, 1, { scenario: `s${i}`, pass })) });
const clear = compareRuns(ten(false), ten(true));
assert.equal(clear.quality.passed.established, true);
assert.doesNotMatch(formatComparison(clear), /not established/);

// A judge timeout and an N/A metric leave the pair unscored, never a failure or a drop; runtime and cost still count.
const judged = compareRuns(
	{ results: [run(1, 1, { score: 0.5 }), run(2, 1, { score: 0.5 }), run(3, 1, { score: null })] },
	{ results: [run(1, 3, { score: 0.5 }), run(2, 3, { score: null, scoreError: "judge timeout" }), run(3, 3, { score: null })] },
);
assert.equal(judged.complete, 3);
assert.equal(judged.totals.costUsd.candidate.toFixed(1), "0.9", "unscored runs keep their cost");
assert.deepEqual([judged.quality.judgeErrors, judged.quality.notApplicable, judged.quality.scorable, judged.quality.score.pairs, judged.quality.dropped], [1, 1, 1, 1, false]);
const judgedText = formatComparison(judged);
assert.match(judgedText, /#2: .*score unscored \(judge error: judge timeout\)/);
assert.match(judgedText, /#3: .*score not applicable/);
assert.match(judgedText, /unscored in 1 pair\(s\): the judge failed \(not a quality failure/);
assert.doesNotMatch(judgedText, /QUALITY DROP|no scorable/);

// Zero scorable pairs say so instead of printing a rate.
const none = compareRuns({ results: [run(1, 1, { pass: null })] }, { results: [run(1, 1, { pass: null })] });
assert.equal(none.quality.scorable, 0);
assert.match(formatComparison(none), /no scorable pairs: quality not established/);
assert.doesNotMatch(formatComparison(none), /interval|passed:/);

// Legacy results without either field compare exactly as before.
assert.equal(same.quality, undefined);
assert.doesNotMatch(formatComparison(same), /quality|QUALITY/);

console.log("compare-benchmark-runs: ok");
