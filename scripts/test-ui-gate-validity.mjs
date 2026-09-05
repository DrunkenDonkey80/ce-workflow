#!/usr/bin/env node
// UI gate P0 tests: deterministic validity rules, recall on seeded defects,
// cleanliness on existing surfaces, byte-identity determinism, overlays, rounds.
import assert from "node:assert/strict";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { captureCell } from "./ui-gate/capture.mjs";
import {
	runValidityRules,
	findingId,
	SEVERITY_RANK,
} from "./ui-gate/validity-rules.mjs";
import { runGate } from "./ui-gate/gate.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtures = path.join(root, "scripts", "fixtures", "ui-gate");
const tmp = mkdtempSync(path.join(os.tmpdir(), "ui-gate-validity-"));
process.on("exit", () => rmSync(tmp, { recursive: true, force: true }));

function readJson(file) {
	try {
		return JSON.parse(readFileSync(file, "utf8"));
	} catch (error) {
		throw new Error(
			`unreadable JSON (${file}): ${error instanceof Error ? error.message : error}`,
		);
	}
}

const geo = (elements, doc = {}) => ({
	version: 1,
	profile: "web-chromium",
	target: "synthetic",
	viewport: { name: "desktop", width: 1280, height: 800 },
	state: "ready",
	document: {
		scrollWidth: 1280,
		scrollHeight: 800,
		innerWidth: 1280,
		innerHeight: 800,
		htmlOverflow: "visible",
		bodyOverflow: "visible",
		focusVisible: true,
		...doc,
	},
	elements,
	text: elements.map((element) => element.text).join(" "),
});
const el = (overrides) => ({
	key: "1/0/0",
	parent: "1/0",
	anchor: null,
	testId: null,
	tag: "DIV",
	role: null,
	text: "",
	rect: { x: 10, y: 10, width: 100, height: 20 },
	interactive: false,
	effectiveOpacity: 1,
	styles: {
		color: "#202044",
		backgroundColor: "transparent",
		fontSize: 16,
		fontWeight: "400",
		display: "block",
		position: "static",
		overflow: "visible",
		textOverflow: "clip",
		lineClamp: "none",
		zIndex: "auto",
	},
	overflow: {
		scrollWidth: 100,
		clientWidth: 100,
		scrollHeight: 20,
		clientHeight: 20,
	},
	...overrides,
});
const rulesOf = (findings) => findings.map((finding) => finding.rule);

function syntheticTests() {
	// R1 clipped-text.
	let findings = runValidityRules(
		geo([
			el({
				key: "1/0/0",
				text: "long clipped text",
				overflow: {
					scrollWidth: 200,
					clientWidth: 100,
					scrollHeight: 40,
					clientHeight: 20,
				},
			}),
		]),
	);
	assert.ok(
		rulesOf(findings).includes("clipped-text"),
		"R1 fires on unintended clipping",
	);
	findings = runValidityRules(
		geo([
			el({
				key: "1/0/0",
				text: "intentional",
				styles: { ...el().styles, textOverflow: "ellipsis" },
				overflow: {
					scrollWidth: 200,
					clientWidth: 100,
					scrollHeight: 40,
					clientHeight: 20,
				},
			}),
		]),
	);
	assert.ok(
		!rulesOf(findings).includes("clipped-text"),
		"R1 respects ellipsis intent",
	);

	// R2 interactive-overlap + allowlist.
	const alpha = el({
		key: "1/0/0",
		tag: "BUTTON",
		text: "Alpha",
		interactive: true,
	});
	const beta = el({
		key: "1/0/1",
		tag: "BUTTON",
		text: "Beta",
		interactive: true,
		rect: { x: 60, y: 10, width: 100, height: 20 },
	});
	findings = runValidityRules(geo([alpha, beta]));
	assert.ok(
		rulesOf(findings).includes("interactive-overlap"),
		"R2 fires on overlapping controls",
	);
	findings = runValidityRules(geo([alpha, beta]), {
		allowlist: [
			{ pair: "BUTTON@[key-accept]|BUTTON@[key-clear]" },
			{ pair: [alpha.anchor ?? "BUTTON@1/0/0", "BUTTON@1/0/1"].sort().join("|") },
		],
	});
	assert.ok(
		!rulesOf(findings).includes("interactive-overlap"),
		"allowlisted pair is suppressed",
	);

	// R3 occluded-content.
	findings = runValidityRules(
		geo([
			el({
				key: "1/0/0",
				tag: "BUTTON",
				text: "Go",
				interactive: true,
				hits: {
					center: "1/0/2",
					tl: "1/0/2",
					tr: "1/0/2",
					bl: "1/0/2",
					br: "1/0/2",
				},
			}),
			el({ key: "1/0/2" }),
		]),
	);
	assert.ok(
		findings.some(
			(finding) =>
				finding.rule === "occluded-content" && finding.severity === "error",
		),
		"R3 full occlusion is an error",
	);
	findings = runValidityRules(
		geo([
			el({
				key: "1/0/0",
				tag: "BUTTON",
				text: "Go",
				interactive: true,
				hits: {
					center: "1/0/2",
					tl: "1/0/0",
					tr: "1/0/0",
					bl: "1/0/0",
					br: "1/0/0",
				},
			}),
			el({ key: "1/0/2" }),
		]),
	);
	assert.ok(
		findings.some(
			(finding) =>
				finding.rule === "occluded-content" && finding.severity === "warning",
		),
		"R3 partial occlusion is a warning",
	);
	findings = runValidityRules(
		geo([
			el({
				key: "1/0/0",
				tag: "BUTTON",
				text: "Go",
				interactive: true,
				hits: {
					center: "1/0/1",
					tl: "1/0/0",
					tr: "1/0/0",
					bl: "1/0/0",
					br: "1/0/0",
				},
			}),
		]),
	);
	assert.ok(
		!rulesOf(findings).includes("occluded-content"),
		"descendant covering is not occlusion",
	);

	// R4 offscreen-essential.
	findings = runValidityRules(
		geo([
			el({
				key: "1/0/0",
				anchor: "hidden-panel",
				text: "hidden",
				rect: { x: 0, y: -450, width: 100, height: 50 },
			}),
		]),
	);
	assert.ok(
		rulesOf(findings).includes("offscreen-essential"),
		"R4 fires on unreachable anchored element",
	);

	// R5 scroll-trap.
	findings = runValidityRules(
		geo([el({ key: "1/0/0" })], {
			scrollHeight: 2000,
			htmlOverflow: "hidden",
			bodyOverflow: "hidden",
		}),
	);
	assert.ok(
		rulesOf(findings).includes("scroll-trap"),
		"R5 fires on root-clipped overflow",
	);

	// Content assertions.
	findings = runValidityRules(
		geo([el({ key: "1/0/0", text: "My Calculator" })]),
		{ contentStrings: ["absent copy"] },
	);
	assert.ok(
		rulesOf(findings).includes("content-missing"),
		"content assertion catches missing copy",
	);

	// Token snapping + alignment drift.
	findings = runValidityRules(
		geo([
			el({
				key: "1/0/0",
				tag: "DIV",
				rect: { x: 10, y: 10, width: 100, height: 20 },
			}),
			el({
				key: "1/0/1",
				tag: "DIV",
				parent: "1/0",
				rect: { x: 10, y: 33, width: 100, height: 20 },
			}),
		]),
		{ spacingTokens: [8, 12, 20, 28] },
	);
	assert.ok(
		rulesOf(findings).includes("spacing-drift"),
		"3px sibling gap violates the 8/12/20/28 scale",
	);
	findings = runValidityRules(
		geo([
			el({
				key: "1/0/0",
				tag: "DIV",
				rect: { x: 10, y: 10, width: 100, height: 20 },
			}),
			el({
				key: "1/0/1",
				tag: "DIV",
				parent: "1/0",
				rect: { x: 10, y: 42, width: 100, height: 20 },
			}),
		]),
		{ spacingTokens: [8, 12, 20, 28] },
	);
	assert.ok(
		!rulesOf(findings).includes("spacing-drift"),
		"12px sibling gap snaps cleanly",
	);

	// Baseline drift is advisory.
	findings = runValidityRules(
		geo([
			el({
				key: "1/0/0",
				anchor: "display",
				rect: { x: 10, y: 15, width: 100, height: 20 },
			}),
		]),
		{
			baselineGeometry: geo([
				el({
					key: "1/0/0",
					anchor: "display",
					rect: { x: 10, y: 10, width: 100, height: 20 },
				}),
			]),
		},
	);
	const drift = findings.find((finding) => finding.rule === "baseline-drift");
	assert.ok(
		drift && SEVERITY_RANK[drift.severity] === 0,
		"baseline drift stays advisory",
	);

	// Finding ids exclude volatile fields.
	const id = findingId("clipped-text", "display", "desktop", "ready");
	assert.equal(id, findingId("clipped-text", "display", "desktop", "ready"));
	assert.notEqual(id, findingId("clipped-text", "display", "mobile", "ready"));
}

async function realCaptureTests() {
	// Defect recall from the seeded fixture surfaces.
	const defects = readJson(path.join(fixtures, "defects-validity.json"));
	for (const defect of defects) {
		const out = path.join(tmp, "defect", defect.file.replace(/\.html$/, ""));
		const result = await captureCell({
			target: path.join(fixtures, defect.file),
			viewport: "desktop",
			out,
		});
		const meta = readJson(path.join(out, "meta.json"));
		const geometry = readJson(path.join(out, "geometry.json"));
		const findings = runValidityRules(geometry, {
			quarantined: meta.quarantined,
		});
		for (const rule of defect.expect)
			assert.ok(
				rulesOf(findings).includes(rule),
				`${defect.file} must surface ${rule} (got ${rulesOf(findings).join(",") || "none"})`,
			);
		assert.ok(result.ok, `${defect.file} capture ok`);
	}

	// Existing repo surface stays clean.
	const browserOut = path.join(tmp, "browser-calculator");
	await captureCell({
		target: path.join(
			root,
			"scripts",
			"fixtures",
			"capabilities",
			"browser-calculator.html",
		),
		viewport: "mobile",
		out: browserOut,
	});
	const browserGeometry = readJson(path.join(browserOut, "geometry.json"));
	const browserFindings = runValidityRules(browserGeometry, {});
	assert.deepEqual(
		rulesOf(browserFindings).filter((rule) => rule !== "occluded-content"),
		[],
		"existing HTML surface must stay clean",
	);

	// Clean gate: zero findings, artifacts written, evidence sane.
	const gateOut = path.join(tmp, "clean-gate");
	const gate = await runGate({
		actual: path.join(fixtures, "clean.html"),
		viewports: ["desktop", "mobile"],
		out: gateOut,
		handoffFile: path.join(fixtures, "handoff-test.json"),
	});
	assert.equal(
		gate.errors,
		0,
		`clean surface must have zero error findings: ${JSON.stringify(gate.byRule)}`,
	);
	assert.equal(
		gate.warnings,
		0,
		`clean surface must have zero warnings: ${JSON.stringify(gate.byRule)}`,
	);
	assert.ok(gate.converged, "clean surface converges in round 1");
	for (const viewport of ["desktop", "mobile"])
		for (const artifact of [
			"geometry.json",
			"meta.json",
			"screenshot.png",
			"overlay.svg",
			"viewer.html",
		])
			assert.ok(
				existsSync(path.join(gateOut, viewport, "actual", artifact)),
				`${viewport}/${artifact} exists`,
			);
	const report = readJson(path.join(gateOut, "findings.json"));
	assert.ok(
		report.evidence.responsive.noHorizontalOverflow,
		"no horizontal overflow at any viewport",
	);
	assert.ok(
		report.evidence.responsive.visibleFocus,
		"focus visibility measured",
	);
	assert.ok(
		["title", "display", "keypad", "equals control"].every((region) =>
			report.evidence.regions.includes(region),
		),
		"all required regions verified",
	);
	const runOne = readJson(path.join(gateOut, "gate-run.json"));
	assert.equal(runOne.rounds.length, 1);
	assert.ok(runOne.rounds[0].improved);
	const telemetry = readFileSync(path.join(gateOut, "telemetry.jsonl"), "utf8")
		.trim()
		.split("\n");
	assert.equal(telemetry.length, 1);
	const roundEvent = (() => {
		try {
			return JSON.parse(telemetry[0]);
		} catch (error) {
			throw new Error(
				`malformed ui_gate_round telemetry: ${error instanceof Error ? error.message : error}`,
			);
		}
	})();
	assert.equal(roundEvent.event, "ui_gate_round");
	assert.equal(roundEvent.vlmCalls, 0);
	assert.equal(roundEvent.tokens, 0);
	assert.equal(roundEvent.captureTier, "deterministic");

	// Byte-identity determinism across 10 consecutive captures.
	const detDir = path.join(tmp, "determinism");
	const hashes = new Set();
	for (let index = 0; index < 10; index++) {
		const out = path.join(detDir, `run-${index}`);
		const result = await captureCell({
			target: path.join(fixtures, "clean.html"),
			viewport: "desktop",
			out,
			geometryOnly: true,
		});
		assert.ok(
			result.byteIdentical,
			`capture ${index} must be internally byte-identical`,
		);
		assert.deepEqual(
			result.quarantined,
			[],
			`capture ${index} must not quarantine elements`,
		);
		hashes.add(readJson(path.join(out, "meta.json")).geometrySha256);
	}
	assert.equal(
		hashes.size,
		1,
		"10 consecutive captures must produce identical geometry hashes",
	);

	// Repair rounds: error → fix → converge; unchanged defect → early stop.
	const defectFile = path.join(tmp, "repair", "page.html");
	const repairOut = path.join(tmp, "repair", "gate");
	mkdirSync(repairOut, { recursive: true });
	writeFileSync(defectFile, readFileSync(path.join(fixtures, "overlap.html")));
	const roundOne = await runGate({
		actual: defectFile,
		out: repairOut,
		viewports: ["desktop"],
	});
	assert.equal(roundOne.errors, 1, "overlap defect is an error");
	assert.ok(
		roundOne.improved !== false && !roundOne.converged,
		"round 1 not converged",
	);
	// Simulated repair per the repair-recipe hint.
	writeFileSync(
		defectFile,
		readFileSync(defectFile, "utf8").replace(
			'style="position:absolute;left:20px;top:0"',
			'style="position:absolute;left:200px;top:0"',
		),
	);
	const roundTwo = await runGate({
		actual: defectFile,
		out: repairOut,
		viewports: ["desktop"],
	});
	assert.equal(roundTwo.errors, 0, "fixed page has zero errors");
	assert.ok(roundTwo.converged, "round 2 converges");
	const roundThree = await runGate({
		actual: defectFile,
		out: repairOut,
		viewports: ["desktop"],
	});
	assert.ok(
		roundThree.converged && roundThree.round === 3,
		"stable page stays converged",
	);
	// Non-improving round sequence triggers early stop.
	const stuckOut = path.join(tmp, "stuck-gate");
	const stuckFile = path.join(tmp, "stuck.html");
	writeFileSync(stuckFile, readFileSync(path.join(fixtures, "overlap.html")));
	await runGate({ actual: stuckFile, out: stuckOut, viewports: ["desktop"] });
	const stuckTwo = await runGate({
		actual: stuckFile,
		out: stuckOut,
		viewports: ["desktop"],
	});
	assert.ok(
		stuckTwo.earlyStop,
		"unchanged findings mark the round non-improving",
	);
	assert.ok(!stuckTwo.roundCapReached, "cap is not yet reached at round 2");
	const stuckThree = await runGate({
		actual: stuckFile,
		out: stuckOut,
		viewports: ["desktop"],
	});
	assert.ok(
		stuckThree.roundCapReached,
		"round cap is flagged when unconverged at the cap",
	);
}

try {
	syntheticTests();
	await realCaptureTests();
	process.stdout.write("ui-gate validity tests passed\n");
} catch (error) {
	process.stderr.write(`${error instanceof Error ? error.stack : error}\n`);
	process.exitCode = 1;
}
