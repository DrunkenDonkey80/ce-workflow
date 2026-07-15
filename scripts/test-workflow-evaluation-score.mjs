#!/usr/bin/env node
import assert from "node:assert/strict";
import { blindArtifacts, evaluateDecision, validateEvaluatorResult } from "./workflow-evaluation-score.mjs";

const dimensions = ["quality", "traceability"];
const rubric = { anchors: [0, 1, 2, 3, 4], criticalDimensions: ["traceability"] };
function sample(cost = 100, score = 3) {
	return {
		hard: { passed: true },
		metrics: { tokens: cost, wallMs: cost, toolCalls: cost, subagentCalls: cost, toolOutputChars: cost, retries: cost, contextTokens: cost, questions: 0 },
		scores: { quality: score, traceability: score },
		unexpectedQuestions: 0,
	};
}
function pairs(candidateCost = 90) {
	return [0, 1, 2].map((pairIndex) => ({ pairIndex, order: pairIndex % 2 ? ["candidate", "baseline"] : ["baseline", "candidate"], attempts: [{ baseline: sample(100), candidate: sample(candidateCost) }] }));
}

const blinded = blindArtifacts({ text: "artifact one", path: "/tmp/base" }, { text: "artifact two", path: "/tmp/candidate" }, rubric, () => Buffer.from([1]));
assert.deepEqual(Object.keys(blinded.evaluatorInput.artifacts).sort(), ["A", "B"]);
assert.doesNotMatch(JSON.stringify(blinded.evaluatorInput), /baseline|candidate|\/tmp|timestamp/i);
assert.ok(blinded.control.mapping.A);
assert.deepEqual(validateEvaluatorResult({ A: { quality: 3, traceability: 3 }, B: { quality: 3, traceability: 3 } }, dimensions, rubric), { A: { quality: 3, traceability: 3 }, B: { quality: 3, traceability: 3 } });
assert.throws(() => validateEvaluatorResult({ A: { quality: 9 }, B: {} }, dimensions, rubric));

const win = evaluateDecision(pairs(), rubric);
assert.equal(win.status, "candidate-accepted");
assert.equal(win.pairs.length, 3);
assert.equal(win.summary.tokens.candidate.median, 90);
assert.equal(win.summary.tokens.delta, -10);
assert.deepEqual(win.pairs.map((pair) => pair.order), [["baseline", "candidate"], ["candidate", "baseline"], ["baseline", "candidate"]]);

const small = evaluateDecision(pairs(96), rubric);
assert.equal(small.status, "quality-pass-no-cost-win");
const quality = pairs(50);
quality[1].attempts[0].candidate.scores.quality = 2;
quality[2].attempts[0].candidate.scores.quality = 2;
assert.equal(evaluateDecision(quality, rubric).status, "candidate-rejected");
const critical = pairs(50);
critical[1].attempts[0].candidate.scores.traceability = 2;
critical[2].attempts[0].candidate.scores.traceability = 2;
assert.equal(evaluateDecision(critical, rubric).reason, "critical-dimension-regression");
const questions = pairs(50);
questions[0].attempts[0].candidate.unexpectedQuestions = 1;
assert.equal(evaluateDecision(questions, rubric).reason, "unexpected-questions-regressed");
const missing = pairs();
delete missing[0].attempts[0].candidate.metrics.toolOutputChars;
assert.equal(evaluateDecision(missing, rubric).status, "invalid");
const baselineFail = pairs();
baselineFail[0].attempts[0].baseline.hard.passed = false;
assert.equal(evaluateDecision(baselineFail, rubric).status, "invalid");
const candidateFail = pairs();
candidateFail[0].attempts[0].candidate.hard.passed = false;
assert.equal(evaluateDecision(candidateFail, rubric).status, "candidate-rejected");

const replacement = pairs();
replacement[0].attempts = [{ infrastructureFailure: "timeout", baseline: sample(), candidate: sample() }, { baseline: sample(), candidate: sample(90) }];
assert.equal(evaluateDecision(replacement, rubric).status, "candidate-accepted");
replacement[0].attempts[1].infrastructureFailure = "timeout";
assert.equal(evaluateDecision(replacement, rubric).status, "invalid");
const selective = pairs();
selective[0].attempts = [{ infrastructureFailure: "timeout", baseline: sample(), candidate: sample() }, { candidate: sample(90) }];
assert.equal(evaluateDecision(selective, rubric).status, "invalid");
console.log("ok - workflow evaluation decision scoring fixtures");
