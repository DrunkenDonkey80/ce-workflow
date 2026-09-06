#!/usr/bin/env node
// Unit P2: repair loop orchestration (plan-final.md §2.5) — bounded rounds
// with monotone telemetry, early stop, stable finding ids across rect-only
// changes, strict-policy escalation through work-dialogs, lease serialization.
import assert from "node:assert/strict";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	defaultEscalation,
	runUiGateRepairLoop,
	withGateLease,
} from "../extensions/work-ui-gate.js";

const root = mkdtempSync(path.join(tmpdir(), "ui-gate-repair-"));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function readJson(file) {
	try {
		return JSON.parse(readFileSync(file, "utf8"));
	} catch (error) {
		throw new Error(
			`unreadable JSON (${file}): ${error instanceof Error ? error.message : error}`,
		);
	}
}

function readJsonLine(line, file) {
	try {
		return JSON.parse(line);
	} catch (error) {
		throw new Error(
			`unreadable JSON line (${file}): ${error instanceof Error ? error.message : error}`,
		);
	}
}

// Seeded defect page: each `overlap*` pair is an R2 interactive-overlap error.
function repairPage({ overlapA = true, overlapB = true, shiftB = 20 } = {}) {
	const b = overlapA
		? `style="position:absolute;left:${shiftB}px;top:0"`
		: `style="position:absolute;left:240px;top:0"`;
	const d = overlapB
		? `style="position:absolute;left:20px;top:0"`
		: `style="position:absolute;left:240px;top:0"`;
	return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>repair</title>
<style>body{font:18px system-ui;padding:20px}</style></head>
<body>
<div style="position:relative;height:100px"><button id="a">Alpha</button><button id="b" ${b}>Beta</button></div>
<div style="position:relative;height:100px"><button id="c">Gamma</button><button id="d" ${d}>Delta</button></div>
</body></html>`;
}

function scratch(name, html) {
	const dir = path.join(root, name);
	mkdirSync(dir, { recursive: true });
	const file = path.join(dir, "page.html");
	writeFileSync(file, html);
	return { dir, file };
}

function overlapIds(out) {
	const findings = readJson(path.join(out, "findings.json")).findings;
	return findings
		.filter((finding) => finding.rule === "interactive-overlap")
		.map((finding) => finding.id)
		.sort();
}

// (a) Seeded defects repaired within 3 rounds with monotone telemetry.
{
	const { dir, file } = scratch("a", repairPage());
	const variants = [
		repairPage(),
		repairPage({ overlapB: false }),
		repairPage({ overlapA: false, overlapB: false }),
	];
	const loop = await runUiGateRepairLoop({
		actual: file,
		out: dir,
		maxRounds: 3,
		applyFix: async ({ round }) => {
			if (!variants[round]) return false;
			writeFileSync(file, variants[round]);
			return true;
		},
	});
	assert.equal(
		loop.errors,
		0,
		`repaired within cap: ${JSON.stringify(loop.rounds)}`,
	);
	assert.equal(loop.round, 3, "used exactly the seeded 3 rounds");
	assert.ok(loop.converged, "converged");
	const telemetry = readFileSync(path.join(dir, "telemetry.jsonl"), "utf8")
		.trim()
		.split("\n")
		.map((line) => readJsonLine(line, "telemetry.jsonl"));
	assert.equal(telemetry.length, 3, "one telemetry line per round");
	assert.deepEqual(
		telemetry.map((line) => line.errors),
		[2, 1, 0],
		"errors strictly decrease (monotone convergence)",
	);
	assert.ok(
		telemetry.slice(1).every((line) => line.improved),
		"every post-first round marked improved",
	);
	console.log(
		"ok - seeded defects repaired within 3 rounds, monotone telemetry",
	);
}

// (b) Round 2 non-improving → early stop, cap not exhausted.
{
	const { dir, file } = scratch("b", repairPage());
	const loop = await runUiGateRepairLoop({
		actual: file,
		out: dir,
		maxRounds: 3,
		applyFix: async () => {
			writeFileSync(file, repairPage()); // no change → no improvement
			return true;
		},
	});
	assert.equal(
		loop.round,
		2,
		`stopped after the non-improving round: ${loop.round}`,
	);
	assert.ok(loop.earlyStop, "earlyStop recorded");
	assert.ok(!loop.converged, "not converged");
	assert.equal(loop.errors, 2, "defects still present");
	assert.ok(!loop.roundCapReached, "cap not the reason it stopped");
	console.log("ok - round 2 non-improving → early stop");
}

// (c) Rect-only change does not renumber a finding id (§0.7: rect excluded
// from the id hash).
{
	const first = scratch("c1", repairPage({ shiftB: 20 }));
	const second = scratch("c2", repairPage({ shiftB: 26 }));
	await runUiGateRepairLoop({
		actual: first.file,
		out: first.dir,
		maxRounds: 1,
	});
	await runUiGateRepairLoop({
		actual: second.file,
		out: second.dir,
		maxRounds: 1,
	});
	const ids1 = overlapIds(first.dir);
	const ids2 = overlapIds(second.dir);
	assert.ok(ids1.length >= 1, "R2 fired on the shifted variant too");
	assert.deepEqual(ids1, ids2, "rect-only movement keeps finding ids stable");
	console.log("ok - rect-only change does not renumber finding ids");
}

// (d) Strict-policy escalation renders through work-dialogs (SVG/HTML
// side-by-side viewer as content); headless never auto-approves.
{
	const { dir, file } = scratch("d", repairPage());
	const seen = [];
	const loop = await runUiGateRepairLoop({
		actual: file,
		out: dir,
		maxRounds: 1,
		policy: "strict",
		escalate: async ({ result, out }) =>
			defaultEscalation({
				result,
				out,
				dialog: async (options) => {
					seen.push(options);
					return { value: "approve" };
				},
			}),
	});
	assert.equal(loop.escalation.decision, "approved", "decision recorded");
	assert.equal(seen.length, 1, "escalation dialog shown exactly once");
	assert.match(seen[0].title, /UI gate/, "work-dialogs title");
	assert.match(seen[0].purpose, /did not converge/, "muted purpose line");
	assert.ok(
		seen[0].items.some((item) => item.value === "approve"),
		"approval option offered",
	);
	assert.ok(
		seen[0].viewers.some(
			(viewer) => viewer.endsWith("viewer.html") && existsSync(viewer),
		),
		"side-by-side viewer HTML is the dialog content",
	);
	const headless = await defaultEscalation({ result: loop, out: dir });
	assert.equal(
		headless.decision,
		"stopped",
		"headless escalation never approves",
	);
	console.log("ok - strict escalation renders through work-dialogs");
}

// (e) Concurrent gate runs serialize on leases.
{
	const lockDir = path.join(root, "e-lock");
	mkdirSync(lockDir, { recursive: true });
	let inside = 0;
	let maxInside = 0;
	const task = async () => {
		inside += 1;
		maxInside = Math.max(maxInside, inside);
		await sleep(150);
		inside -= 1;
	};
	await Promise.all([
		withGateLease(lockDir, task),
		withGateLease(lockDir, task),
		withGateLease(lockDir, task),
	]);
	assert.equal(maxInside, 1, "never two lease holders at once");
	assert.ok(
		!existsSync(path.join(lockDir, ".gate-lock")),
		"lock released after the run",
	);

	const { dir, file } = scratch("e-loop", repairPage());
	await Promise.all([
		runUiGateRepairLoop({ actual: file, out: dir, maxRounds: 1 }),
		runUiGateRepairLoop({ actual: file, out: dir, maxRounds: 1 }),
	]);
	const runRecord = readJson(path.join(dir, "gate-run.json"));
	assert.equal(runRecord.rounds.length, 2, "both runs recorded, none lost");
	const lines = readFileSync(path.join(dir, "telemetry.jsonl"), "utf8").trim();
	assert.equal(lines.split("\n").length, 2, "no interleaved telemetry writes");
	assert.ok(!existsSync(path.join(dir, ".gate-lock")), "gate lock cleaned up");
	console.log("ok - concurrent gate runs serialize on leases");
}

console.log("ui-gate repair loop tests passed");
