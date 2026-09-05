#!/usr/bin/env node
// UI gate tests (plan-final.md P0/P1 acceptance): deterministic capture,
// validity recall, clean-surface pass, fidelity recall, repair monotonicity.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { captureCell } from "./ui-gate/capture.mjs";
import { runGate } from "./ui-gate/gate.mjs";
import { runValidityRules } from "./ui-gate/validity-rules.mjs";

const uiGateDir = path.join(
	path.dirname(fileURLToPath(import.meta.url)),
	"ui-gate",
);
const fixturesDir = path.join(path.dirname(uiGateDir), "fixtures", "ui-gate");
const fixtures = (name) => path.join(fixturesDir, name);
const tempRoot = mkdtempSync(path.join(tmpdir(), "ui-gate-test-"));
let failures = 0;
const check = (name, fn) => {
	try {
		fn();
		console.log(`ok - ${name}`);
	} catch (error) {
		failures += 1;
		console.log(`FAIL - ${name}: ${error.message}`);
	}
};

const readJson = (file) => {
	try {
		return JSON.parse(readFileSync(file, "utf8"));
	} catch (error) {
		throw new Error(
			`unreadable JSON (${file}): ${error instanceof Error ? error.message : error}`,
		);
	}
};
const findingRules = (outDir) =>
	readJson(path.join(outDir, "findings.json")).findings.map(
		(finding) => finding.rule,
	);
const assertRecall = (outDir, expected, label) => {
	const rules = findingRules(outDir);
	for (const rule of expected)
		assert.ok(
			rules.includes(rule),
			`${label}: expected ${rule}, got [${rules.join(", ")}]`,
		);
};

try {
	// 1. Validity recall: every seeded defect fires its rule (plan P0 AC2).
	for (const entry of readJson(fixtures("defects-validity.json"))) {
		const out = path.join(tempRoot, "validity", entry.file);
		const result = await runGate({
			actual: fixtures(entry.file),
			out,
			geometryOnly: true,
		});
		check(`validity recall: ${entry.file}`, () => {
			assertRecall(out, entry.expect, entry.file);
			assert.ok(result.total > 0, `${entry.file}: expected findings`);
		});
	}

	// 2. Clean surfaces produce zero findings (plan P0 AC1 spot checks).
	const cleanSurfaces = [
		fixtures("clean.html"),
		path.join(
			path.dirname(fixturesDir),
			"capabilities",
			"browser-calculator.html",
		),
	];
	for (const target of cleanSurfaces) {
		const out = path.join(tempRoot, `clean-${path.basename(target)}`);
		const result = await runGate({ actual: target, out, geometryOnly: true });
		check(`clean surface: ${path.basename(target)}`, () => {
			assert.equal(result.errors, 0, `errors: ${JSON.stringify(result.byRule)}`);
			assert.equal(result.total, 0, `findings: ${JSON.stringify(result.byRule)}`);
		});
	}

	// 3. Byte-stability: 10 consecutive double-captures, byte-identical geometry
	// (plan P0 AC3) on the calculator surface.
	const stabilityOut = path.join(tempRoot, "stability");
	let previousBytes = null;
	let allStable = true;
	for (let run = 0; run < 10; run += 1) {
		const result = await captureCell({
			target: cleanSurfaces[1],
			viewport: "desktop",
			state: "ready",
			out: path.join(stabilityOut, `run-${run}`),
			geometryOnly: true,
		});
		const bytes = readFileSync(
			path.join(stabilityOut, `run-${run}`, "geometry.json"),
		);
		if (!result.byteIdentical || (previousBytes && !bytes.equals(previousBytes)))
			allStable = false;
		previousBytes = bytes;
	}
	check("byte-stability across 10 consecutive captures", () => {
		assert.ok(allStable, "geometry bytes diverged between consecutive captures");
	});

	// 4. Fidelity recall: spec-vs-actual drift fires the expected rules (P1 AC1)
	// and the clean variant passes.
	const handoff = fixtures("handoff-test.json");
	for (const entry of readJson(fixtures("defects-fidelity.json"))) {
		const out = path.join(tempRoot, `fidelity-${path.basename(entry.file)}`);
		await runGate({
			actual: fixtures(entry.file),
			spec: fixtures(entry.spec),
			handoffFile: handoff,
			out,
			geometryOnly: true,
		});
		check(`fidelity recall: ${entry.file}`, () =>
			assertRecall(out, entry.expect, entry.file),
		);
	}
	const cleanFidelityOut = path.join(tempRoot, "fidelity-clean");
	const cleanFidelity = await runGate({
		actual: fixtures("fidelity-spec.html"),
		spec: fixtures("fidelity-spec.html"),
		handoffFile: handoff,
		out: cleanFidelityOut,
		geometryOnly: true,
	});
	check("fidelity clean variant passes", () => {
		assert.equal(cleanFidelity.errors, 0);
		const { findings, evidence } = readJson(
			path.join(cleanFidelityOut, "findings.json"),
		);
		assert.deepEqual(findings, []);
		for (const region of ["title", "display", "keypad", "equals control"])
			assert.ok(evidence.regions.includes(region), `region ${region} in evidence`);
		assert.ok(evidence.matchedPairs > 0, "matched pairs recorded");
		assert.equal(typeof evidence.responsive.noHorizontalOverflow, "boolean");
		assert.equal(typeof evidence.responsive.contrast, "boolean");
		assert.equal(typeof evidence.responsive.visibleFocus, "boolean");
	});

	// 5. Content assertions: handoff copy absent from the page fires content-missing.
	const handoffMissing = path.join(tempRoot, "handoff-missing.json");
	writeFileSync(
		handoffMissing,
		JSON.stringify({ content: { heading: "Copy that never renders" } }),
	);
	const contentOut = path.join(tempRoot, "content-missing");
	await runGate({
		actual: fixtures("clean.html"),
		handoffFile: handoffMissing,
		out: contentOut,
		geometryOnly: true,
	});
	check("content-missing fires for absent handoff copy", () =>
		assertRecall(contentOut, ["content-missing"], "content"),
	);

	// 6. Baseline drift: a moved anchored element against the stored baseline
	// fires baseline-drift; the unmoved baseline passes.
	const geometry = (rect) => ({
		version: 1,
		viewport: { name: "desktop", width: 1280, height: 800 },
		state: "ready",
		document: { scrollWidth: 1280, scrollHeight: 800, innerHeight: 800 },
		elements: [
			{
				key: "0/0",
				anchor: "panel",
				tag: "DIV",
				rect,
				text: "x",
				styles: {},
				overflow: {},
			},
		],
	});
	const baselineFindings = runValidityRules(
		geometry({ x: 15, y: 40, width: 100, height: 20 }),
		{
			baselineGeometry: geometry({ x: 10, y: 40, width: 100, height: 20 }),
		},
	);
	const steadyFindings = runValidityRules(
		geometry({ x: 10, y: 40, width: 100, height: 20 }),
		{
			baselineGeometry: geometry({ x: 10, y: 40, width: 100, height: 20 }),
		},
	);
	check("baseline-drift fires on moved element, silent when steady", () => {
		assert.ok(
			baselineFindings.some((finding) => finding.rule === "baseline-drift"),
			`got [${baselineFindings.map((finding) => finding.rule)}]`,
		);
		assert.equal(
			steadyFindings.some((finding) => finding.rule === "baseline-drift"),
			false,
		);
	});

	// 7. Repair rounds: monotone bookkeeping, stable finding rules, round cap.
	const roundsOut = path.join(tempRoot, "rounds");
	let lastResult = null;
	const rulesPerRound = [];
	for (const round of [1, 2, 3]) {
		lastResult = await runGate({
			actual: fixtures("overlap.html"),
			out: roundsOut,
			round,
			maxRounds: 3,
			geometryOnly: true,
		});
		rulesPerRound.push(findingRules(roundsOut).sort().join(","));
	}
	check("repair rounds recorded with round cap", () => {
		assert.equal(lastResult.round, 3);
		assert.equal(lastResult.converged, false);
		assert.equal(lastResult.roundCapReached, true);
		const runRecord = readJson(path.join(roundsOut, "gate-run.json"));
		assert.deepEqual(
			runRecord.rounds.map((entry) => entry.round),
			[1, 2, 3],
		);
		assert.equal(rulesPerRound[0], rulesPerRound[1]);
		assert.equal(rulesPerRound[1], rulesPerRound[2]);
	});

	// 8. Telemetry: each round appends a ui_gate_round line with plan fields.
	const telemetry = readFileSync(path.join(roundsOut, "telemetry.jsonl"), "utf8")
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line));
	check("telemetry ui_gate_round fields", () => {
		assert.equal(telemetry.length, 3);
		for (const entry of telemetry) {
			assert.equal(entry.event, "ui_gate_round");
			for (const field of [
				"round",
				"errors",
				"warnings",
				"total",
				"improved",
				"converged",
				"vlmCalls",
				"tokens",
				"captureTier",
				"measuredBy",
			])
				assert.ok(field in entry, `missing ${field}`);
			assert.equal(entry.captureTier, "deterministic");
			assert.equal(entry.measuredBy, "web-chromium");
		}
	});

	// 9. Adapter I/O: capture.mjs CLI emits exactly one JSON result line.
	const cliOut = path.join(tempRoot, "cli");
	const cli = spawnSync(
		process.execPath,
		[
			path.join(uiGateDir, "capture.mjs"),
			"--target",
			fixtures("clean.html"),
			"--viewport",
			"mobile",
			"--state",
			"ready",
			"--out",
			cliOut,
			"--geometry-only",
		],
		{ encoding: "utf8", timeout: 120_000 },
	);
	check("capture CLI single-JSON-line contract", () => {
		assert.equal(cli.status, 0, cli.stderr);
		const lines = cli.stdout.trim().split("\n");
		assert.equal(lines.length, 1, `expected one line, got ${lines.length}`);
		const result = JSON.parse(lines[0]);
		assert.equal(result.ok, true);
		assert.equal(result.cell.profile, "web-chromium");
		assert.ok(existsArtifacts(cliOut, result.artifacts));
	});

	if (failures > 0) process.exitCode = 1;
} finally {
	rmSync(tempRoot, { recursive: true, force: true });
}

function existsArtifacts(outDir, artifacts) {
	const files = Object.values(artifacts).flat();
	for (const file of files)
		if (!readFileSyncSafe(path.join(outDir, file))) return false;
	return true;
}

function readFileSyncSafe(file) {
	try {
		return readFileSync(file);
	} catch {
		return null;
	}
}
