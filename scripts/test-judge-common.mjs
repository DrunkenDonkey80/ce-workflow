#!/usr/bin/env node
// Self-check for the judge retry and deadline (judge-common.mjs) and both judges' summaries, with fake judges: no paid calls.
import assert from "node:assert/strict";
import { judgeWithRetry, parseArray, rate, runChild } from "./judge-common.mjs";
import { labelRows, summarize as handoffSummary } from "./judge-handoff.mjs";
import { CHECKLISTS, scorePages, summarize as designSummary } from "./judge-design-extras.mjs";

const labels = (n) => (out) => parseArray(out, n, (l) => ["handoff", "blocker", "none"].includes(l));
const canned = (...replies) => { let calls = 0; const fn = async () => { const r = replies[calls++]; if (r instanceof Error) throw r; return r; }; fn.calls = () => calls; return fn; };

// Valid first time: one call.
let fake = canned('["none","handoff"]');
assert.deepEqual(await judgeWithRetry(fake, labels(2)), { value: ["none", "handoff"] });
assert.equal(fake.calls(), 1);
// Invalid (wrong label, then wrong length would also fail) then valid: the one retry recovers.
fake = canned('["maybe","none"]', 'Sure: ["blocker","none"]');
assert.deepEqual(await judgeWithRetry(fake, labels(2)), { value: ["blocker", "none"] });
assert.equal(fake.calls(), 2);
// Invalid twice: a judge error after exactly two calls, never a verdict.
fake = canned("no json here", '["none"]');
const twice = await judgeWithRetry(fake, labels(2));
assert.equal(fake.calls(), 2);
assert.equal(twice.value, undefined);
assert.match(twice.error, /invalid reply: no json here; invalid reply: \["none"\]/);
// Shape: booleans only.
assert.equal(parseArray("[true, 1]", 2, (v) => typeof v === "boolean"), undefined);
assert.deepEqual(parseArray("[true,false]", 2, (v) => typeof v === "boolean"), [true, false]);

// A child that never exits: each attempt hits its deadline, the tree is killed, and the result is a judge error.
const started = Date.now();
const hung = await judgeWithRetry(() => runChild(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { timeoutMs: 400 }), labels(1));
assert.match(hung.error, /^judge timeout after 0 s; judge timeout after 0 s$/);
assert(Date.now() - started < 10_000, "deadline enforced");
assert.equal(await runChild(process.execPath, ["-e", "process.stdout.write('[\"none\"]')"]), '["none"]');

// Handoff: a failed batch marks only its rows; empty replies are n/a; the rate counts judged runs only.
const rows = Array.from({ length: 12 }, (_, i) => ({ scenario: i < 11 ? "web" : "cli" }));
const texts = rows.map((_, i) => (i === 3 ? " " : `reply ${i}`));
let batch = 0;
await labelRows(rows, texts, async (t) => (batch++ === 0 ? { value: t.map((_, k) => (k === 0 ? "handoff" : "none")) } : { error: "judge timeout after 300 s" }));
assert.equal(batch, 2, "11 non-empty replies make two batches");
assert.equal(rows[3].handoffJudged, null);
assert.equal(rows[3].handoffJudgedError, undefined);
assert.deepEqual(rows.filter((r) => r.handoffJudgedError).length, 1);
assert.equal(rows[11].handoffJudgedError, "judge timeout after 300 s");
assert.equal(handoffSummary(rows), "web handoff 1/10 runs (95% 2-40%), blocker 0, none 9, n/a 1 | cli handoff 0 runs, blocker 0, none 0, judge error 1 (unscored)");

// Design: a page whose judge fails is unscored and the others keep scoring; the interval is over pages, extras are counts.
const list = CHECKLISTS.landing, n = list.must.length + list.extras.length;
const pages = ["a", "b", "c"].map((name) => ({ name, scenario: "landing", lines: 100 }));
await scorePages(pages, async (page) => (page.name === "b" ? { error: "invalid reply: x; invalid reply: y" }
	: { value: Array.from({ length: n }, (_, i) => page.name === "a" || i > 0) }));
assert.equal(pages[1].judgeError, "invalid reply: x; invalid reply: y");
assert.equal(designSummary(pages), "must-haves all met on 1/2 pages (95% 9-91%), extras 24/24 items (per page 12/12), judge error on 1 page(s) (unscored), lines 100/100/100");
assert.equal(rate(0, 0, "pages"), "0 pages");

console.log("judge-common: ok");
