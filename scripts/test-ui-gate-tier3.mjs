#!/usr/bin/env node
// Unit P3.5: Tier 3 VLM geometry bridge (plan-final.md §2.7) — pixel-probe
// quarantine, grid cross-check, edge-snap refinement, budget caps,
// calibration report, and the no-fidelity-evidence contract.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runGate } from "./ui-gate/gate.mjs";
import { buildPrompt, runTier3Cell } from "./ui-gate/tier3/measure.mjs";
import { encodePng } from "./ui-gate/tier3/png.mjs";

const root = mkdtempSync(path.join(tmpdir(), "ui-gate-tier3-"));

function readJson(file) {
	try {
		return JSON.parse(readFileSync(file, "utf8"));
	} catch (error) {
		throw new Error(
			`unreadable JSON (${file}): ${error instanceof Error ? error.message : error}`,
		);
	}
}

// Synthetic screenshot: white page with inked, sharply-bordered boxes.
function syntheticImage({ width = 300, height = 200, boxes = [] }) {
	const data = new Uint8Array(width * height * 4).fill(255);
	for (let i = 3; i < data.length; i += 4) data[i] = 255;
	for (const box of boxes)
		for (let y = Math.round(box.y); y < box.y + box.y2; y += 1)
			for (let x = Math.round(box.x); x < box.x + box.x2; x += 1) {
				const target = (y * width + x) * 4;
				const border =
					x < box.x + 2 ||
					y < box.y + 2 ||
					x >= box.x + box.x2 - 2 ||
					y >= box.y + box.y2 - 2;
				const shade = border ? 20 : 128;
				data[target] = data[target + 1] = data[target + 2] = shade;
			}
	return encodePng({ width, height, data });
}

function cellOf(rect, width, height) {
	const centerX = ((rect[0] + rect[2]) / 2 / 1000) * width;
	const centerY = ((rect[1] + rect[3]) / 2 / 1000) * height;
	const col = "ABCDEFGHIJ"[Math.min(9, Math.floor((centerX / width) * 10))];
	const row = Math.min(9, Math.floor((centerY / height) * 10));
	return `${col}${row}`;
}

const to1000 = (x0, y0, x1, y1, width, height) => [
	Math.round((x0 / width) * 1000),
	Math.round((y0 / height) * 1000),
	Math.round((x1 / width) * 1000),
	Math.round((y1 / height) * 1000),
];

function parseAnchors(prompt) {
	return [
		...String(prompt).matchAll(/^- ([^\n(]+?)(?: \(text:[^\n]*\))?$/gm),
	].map((match) => match[1].trim());
}

// Model that answers from a fixed map of px rects (converted to 0–1000).
function rectModel({ width, height, rects, overrides = {}, tokens = 500 }) {
	return {
		name: "rect-model",
		async ask({ prompt }) {
			const regions = {};
			for (const name of parseAnchors(prompt)) {
				const rect = rects[name];
				if (!rect) {
					regions[name] = {
						cell: "A0",
						rect: [1, 1, 2, 2],
						status: "not-found",
						confidence: 50,
					};
					continue;
				}
				const norm = to1000(...rect, width, height);
				regions[name] = {
					cell: overrides[name]?.cell ?? cellOf(norm, width, height),
					rect: overrides[name]?.rect ?? norm,
					status: "found",
					confidence: 80,
				};
			}
			return { json: { regions }, tokens };
		},
	};
}

// (a) A hallucinated rect over flat background is quarantined by the pixel
// probe (crop-and-re-ask still flat) and the cell degrades to BLOCKED.
{
	const image = syntheticImage({
		width: 300,
		height: 200,
		boxes: [{ x: 20, y: 20, x2: 100, y2: 60 }],
	});
	const model = rectModel({
		width: 300,
		height: 200,
		rects: { real: [20, 20, 120, 80], ghost: [180, 50, 260, 100] },
	});
	const cell = await runTier3Cell({
		screenshot: image,
		anchors: [{ name: "real" }, { name: "ghost" }],
		model,
	});
	assert.equal(cell.ok, false, "cell is BLOCKED");
	assert.equal(cell.blocked, "capability-degraded");
	const ghost = cell.meta.quarantined.find((entry) => entry.anchor === "ghost");
	assert.ok(ghost, "ghost anchor quarantined");
	assert.equal(ghost.reason, "hallucinated-flat-probe");
	console.log("ok - hallucinated rect quarantined by pixel probe → BLOCKED");
}

// (b) A declared grid cell that contradicts the rect center is quarantined.
{
	const image = syntheticImage({
		width: 300,
		height: 200,
		boxes: [{ x: 20, y: 20, x2: 100, y2: 60 }],
	});
	const model = rectModel({
		width: 300,
		height: 200,
		rects: { box: [20, 20, 120, 80] },
		overrides: { box: { cell: "J9" } }, // center is at E1 — mismatch
	});
	const cell = await runTier3Cell({
		screenshot: image,
		anchors: [{ name: "box" }],
		model,
	});
	assert.equal(cell.ok, false, "cell is BLOCKED");
	assert.equal(cell.blocked, "capability-degraded");
	assert.deepEqual(cell.meta.quarantined, [
		{ anchor: "box", reason: "grid-mismatch" },
	]);
	console.log("ok - grid mismatch quarantined");
}

// (c) Edge-snap refines a ±4px-slipped proposal to within 2px of the true
// sharp edges.
{
	const image = syntheticImage({
		width: 400,
		height: 300,
		boxes: [{ x: 100, y: 100, x2: 120, y2: 60 }],
	});
	const model = rectModel({
		width: 400,
		height: 300,
		rects: { box: [104, 104, 224, 164] }, // every edge slipped by 4px
	});
	const cell = await runTier3Cell({
		screenshot: image,
		anchors: [{ name: "box" }],
		model,
	});
	assert.equal(cell.ok, true, `cell verified: ${JSON.stringify(cell.meta)}`);
	const rect = cell.geometry.anchors[0].rect;
	for (const [edge, actual, expected] of [
		["x", rect.x, 100],
		["y", rect.y, 100],
		["x+w", rect.x + rect.width, 220],
		["y+h", rect.y + rect.height, 160],
	])
		assert.ok(
			Math.abs(actual - expected) <= 2,
			`edge ${edge}: ${actual} vs ${expected} within 2px`,
		);
	assert.equal(cell.geometry.anchors[0].refined, true, "refinement recorded");
	console.log("ok - edge-snap refines the proposal within 2px");
}

// (d) Beyond the call budget: capture-budget-exceeded → BLOCKED, never a
// silent pass.
{
	const image = syntheticImage({ width: 300, height: 200, boxes: [] });
	let asked = 0;
	const model = {
		name: "broken-schema",
		async ask() {
			asked += 1;
			return { json: { nonsense: true }, tokens: 100 };
		},
	};
	const cell = await runTier3Cell({
		screenshot: image,
		anchors: [{ name: "box" }],
		model,
		budget: 1,
	});
	assert.equal(cell.ok, false, "cell is BLOCKED");
	assert.equal(cell.blocked, "capture-budget-exceeded");
	assert.ok(cell.meta.vlmCalls <= 1, `calls capped: ${cell.meta.vlmCalls}`);
	assert.ok(asked <= 1, `model asked at most budget times: ${asked}`);
	console.log("ok - budget cap → capture-budget-exceeded → BLOCKED");
}

// (e) The calibration harness published a report artifact and its gate
// passed (deterministic stub; pipeline calibration, not VLM quality).
{
	const reportFile = path.resolve(
		"scripts/fixtures/ui-gate/tier3-calibration-report.json",
	);
	assert.ok(existsSync(reportFile), "calibration report artifact committed");
	const report = readJson(reportFile);
	assert.equal(report.model, "deterministic-stub");
	assert.equal(
		report.gate.pass,
		true,
		`gate reasons: ${JSON.stringify(report.gate.reasons)}`,
	);
	for (const key of ["p50", "p95", "p99"])
		assert.ok(
			Number.isFinite(report.aggregate.centerErrorPx[key]),
			`center error ${key} published`,
		);
	assert.ok(report.aggregate.falseMissingRate <= 0.02);
	assert.ok(report.aggregate.withinTolerance >= 0.95);
	console.log("ok - calibration harness produced a passing report artifact");
}

// (f) Tier 3 never populates validateDesignFidelityEvidence fields; the
// run records capability-degraded and stays advisory when nothing fires as
// an error.
{
	const notFoundModel = {
		name: "test-not-found",
		async ask({ prompt }) {
			const regions = {};
			for (const name of parseAnchors(prompt))
				regions[name] = {
					cell: "A0",
					rect: [1, 1, 2, 2],
					status: "not-found",
					confidence: 60,
				};
			return { json: { regions }, tokens: 200 };
		},
	};
	const out = path.join(root, "gate-tier3");
	const result = await runGate({
		actual: path.resolve("scripts/fixtures/ui-gate/states.html"),
		out,
		profile: "vlm",
		tier3Model: notFoundModel,
		handoffFile: path.resolve("scripts/fixtures/ui-gate/handoff-test.json"),
	});
	assert.equal(result.captureTier, "tier3");
	assert.equal(result.capabilityDegraded, true);
	assert.ok(result.ok, "advisory-only findings keep the run ok");
	assert.ok(result.total > 0, "region-not-verified findings recorded");
	const report = readJson(path.join(out, "findings.json"));
	assert.equal(
		report.evidence,
		null,
		"no validateDesignFidelityEvidence fields",
	);
	const telemetry = readFileSync(path.join(out, "telemetry.jsonl"), "utf8");
	assert.match(telemetry, /"captureTier":"tier3"/);
	assert.match(telemetry, /"measuredBy":"test-not-found"/);
	assert.ok(Number.parseInt(/"vlmCalls":(\d+)/.exec(telemetry)[1], 10) > 0);
	console.log(
		"ok - tier 3 leaves fidelity-evidence fields unset, records degraded",
	);
}

console.log("ui-gate tier3 tests passed");
