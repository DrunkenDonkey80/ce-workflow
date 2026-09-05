#!/usr/bin/env node
// UI gate P1 tests: anchor-first matching, acceptance normalization, measured
// fidelity evidence, seeded fidelity defects, handoff optional fields, no VLM.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { matchFidelity } from "./ui-gate/fidelity-matcher.mjs";
import { runGate } from "./ui-gate/gate.mjs";
import { validateDesignHandoff } from "../extensions/work-design.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtures = path.join(root, "scripts", "fixtures", "ui-gate");
const tmp = mkdtempSync(path.join(os.tmpdir(), "ui-gate-fidelity-"));
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

const handoff = readJson(path.join(fixtures, "handoff-test.json"));

const viewport = { name: "desktop", width: 1280, height: 800 };
const geo = (elements, overrides = {}) => ({
	version: 1,
	profile: "web-chromium",
	target: "synthetic",
	viewport,
	state: "ready",
	document: {
		scrollWidth: 1280,
		scrollHeight: 800,
		innerWidth: 1280,
		innerHeight: 800,
		htmlOverflow: "visible",
		bodyOverflow: "visible",
		focusVisible: true,
	},
	elements,
	text: elements.map((element) => element.text).join(" "),
	...overrides,
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
		backgroundColor: "#FFF4CC",
		fontSize: 16,
		fontWeight: "400",
		display: "block",
		position: "static",
		overflow: "visible",
		textOverflow: "clip",
		lineClamp: "none",
		zIndex: "auto",
	},
	overflow: { scrollWidth: 100, clientWidth: 100, scrollHeight: 20, clientHeight: 20 },
	...overrides,
});

function syntheticMatcherTests() {
	// Identical anchored spec/actual → clean, measured evidence.
	const page = (ys = {}) =>
		geo([
			el({ key: "1", anchor: "title", tag: "H1", text: "My Calculator", rect: { x: 10, y: ys.title ?? 10, width: 100, height: 20 } }),
			el({ key: "2", anchor: "display", tag: "OUTPUT", text: "0", rect: { x: 10, y: ys.display ?? 50, width: 100, height: 20 } }),
			el({ key: "3", anchor: "keypad", tag: "DIV", rect: { x: 10, y: ys.keypad ?? 100, width: 100, height: 20 } }),
			el({ key: "4", anchor: "equals control", tag: "BUTTON", text: "=", rect: { x: 10, y: ys.equals ?? 150, width: 100, height: 20 } }),
		]);
	const result = matchFidelity({ spec: page(), actual: page(), handoff });
	assert.equal(result.findings.length, 0, `no findings on identical pair: ${JSON.stringify(result.findings)}`);
	assert.ok(result.evidence.geometryDeltas.every((delta) => delta <= 0.15));
	assert.ok(result.evidence.responsive.noHorizontalOverflow);
	assert.deepEqual(result.evidence.regions, ["title", "display", "keypad", "equals control"]);

	// Position drift beyond threshold; deltas still normalized.
	const drift = matchFidelity({ spec: page(), actual: page({ display: 460 }), handoff });
	assert.ok(drift.findings.some((finding) => finding.rule === "position-drift"), "450px move is a position-drift finding");
	assert.ok(drift.evidence.geometryDeltas.some((delta) => delta > 0.15), "large drift is measured > 0.15");

	// Layout assertions.
	const below = page({ display: 200, keypad: 300 });
	const okAssertion = matchFidelity({ spec: below, actual: page({ display: 200, keypad: 300 }), handoff, layoutAssertions: ["display above keypad"] });
	assert.equal(okAssertion.findings.length, 0, "satisfied layout assertion passes");
	const badAssertion = matchFidelity({ spec: below, actual: page({ display: 400, keypad: 300 }), handoff, layoutAssertions: ["display above keypad"] });
	assert.ok(badAssertion.findings.some((finding) => finding.rule === "layout-assertion"), "violated layout assertion is a finding");

	// Ordering violation (DOM topology, reflow-tolerant per plan B4).
	const orderedSpec = page();
	const swappedDom = geo([
		orderedSpec.elements[1],
		orderedSpec.elements[0],
		orderedSpec.elements[2],
		orderedSpec.elements[3],
	].map((element) => ({ ...element })));
	const orderResult = matchFidelity({ spec: orderedSpec, actual: swappedDom, handoff });
	assert.ok(orderResult.findings.some((finding) => finding.rule === "ordering-violation"), "DOM order inversion is a finding");

	// Region fallback without anchors: missing + overlap.
	const noAnchor = geo([
		el({ key: "1", tag: "H1", text: "My Calculator" }),
	]);
	const missingRegions = matchFidelity({ spec: noAnchor, actual: geo([el({ key: "1", anchor: "title", tag: "H1", text: "My Calculator" })]), handoff });
	assert.ok(missingRegions.findings.some((finding) => finding.rule === "region-missing"), "missing required region is an error");
	const overlapping = geo([
		el({ key: "1", anchor: "title", tag: "H1", text: "My Calculator", rect: { x: 0, y: 0, width: 200, height: 20 } }),
		el({ key: "2", anchor: "display", tag: "OUTPUT", text: "0", rect: { x: 0, y: 5, width: 200, height: 20 } }),
	]);
	const overlapResult = matchFidelity({ spec: noAnchor, actual: overlapping, handoff });
	assert.ok(overlapResult.findings.some((finding) => finding.rule === "region-overlap"), "overlapping regions are an error");

	// Color token mismatch.
	const offPalette = geo([
		el({ key: "1", anchor: "display", tag: "OUTPUT", text: "0", styles: { ...el().styles, color: "#9370DB" } }),
	]);
	const palette = geo([
		el({ key: "1", anchor: "display", tag: "OUTPUT", text: "0", styles: { ...el().styles, color: "#FF4F81" } }),
	]);
	const colorResult = matchFidelity({ spec: palette, actual: offPalette, handoff });
	assert.ok(colorResult.findings.some((finding) => finding.rule === "color-token-mismatch"), "off-palette color is a token mismatch");

	// Text cascade matching without anchors.
	const cascadeSpec = geo([el({ key: "1", tag: "BUTTON", text: "Equals", interactive: true })]);
	const cascadeActual = geo([el({ key: "1", tag: "BUTTON", text: "Equals", interactive: true })]);
	const cascade = matchFidelity({ spec: cascadeSpec, actual: cascadeActual, handoff: { direction: { roleColors: [] } } });
	assert.equal(cascade.evidence.matchedPairs, 1, "text cascade matches identical buttons");
}

async function realCaptureTests() {
	// Defect recall from seeded fidelity fixtures.
	const defects = readJson(path.join(fixtures, "defects-fidelity.json"));
	for (const defect of defects) {
		const out = path.join(tmp, "defect", path.basename(defect.file, ".html"));
		const result = await runGate({
			actual: path.join(fixtures, defect.file),
			spec: path.join(fixtures, defect.spec),
			viewports: ["desktop"],
			out,
			handoffFile: path.join(fixtures, "handoff-test.json"),
		});
		const report = readJson(path.join(out, "findings.json"));
		for (const rule of defect.expect)
			assert.ok(
				report.findings.some((finding) => finding.rule === rule),
				`${defect.file} must surface ${rule} (got ${report.findings.map((f) => f.rule).join(",") || "none"})`,
			);
		assert.equal(result.errors > 0, true, `${defect.file} must register errors`);
		assert.ok(existsSync(path.join(out, "desktop", "spec", "geometry.json")), "spec sidecar capture exists");
	}

	// Clean pair: zero findings, measured deltas within the contract tolerance.
	const cleanOut = path.join(tmp, "clean-pair");
	const clean = await runGate({
		actual: path.join(fixtures, "clean.html"),
		spec: path.join(fixtures, "fidelity-spec.html"),
		viewports: ["desktop", "mobile"],
		out: cleanOut,
		handoffFile: path.join(fixtures, "handoff-test.json"),
	});
	assert.equal(clean.errors, 0, `clean pair must have zero errors: ${JSON.stringify(clean.byRule)}`);
	assert.equal(clean.warnings, 0, `clean pair must have zero warnings: ${JSON.stringify(clean.byRule)}`);
	const evidence = readJson(path.join(cleanOut, "findings.json")).evidence;
	assert.ok(evidence.geometryDeltas.every((delta) => delta <= 0.15), "geometry deltas within 15% tolerance");
	assert.ok(evidence.typographyDeltas.every((delta) => delta <= 0.15), "typography deltas within 15% tolerance");
	assert.ok(evidence.responsive.noHorizontalOverflow && evidence.responsive.visibleFocus && evidence.responsive.contrast, "responsive flags measured true");
	assert.ok(evidence.responsive.reflow, "desktop/mobile widths differ (reflow)");
	assert.ok(!JSON.stringify(evidence).includes("visualEvaluation"), "gate emits no VLM scores");
}

function handoffFieldTests() {
	// AC1: optional v2 fields survive canonicalization and hashing.
	const validHandoff = readJson(
		path.join(root, "scripts", "fixtures", "opendesign", "handoff-valid.json"),
	);
	const withOptional = structuredClone(validHandoff);
	withOptional.screens[0].layoutAssertions = ["display above keypad"];
	withOptional.elementsRef = "design/elements.json";
	const canonical = validateDesignHandoff(withOptional);
	assert.deepEqual(canonical.screens[0].layoutAssertions, ["display above keypad"]);
	assert.equal(canonical.elementsRef, "design/elements.json");
	// Baseline handoff without the fields still validates.
	const baseline = validateDesignHandoff(validHandoff);
	assert.ok(baseline.screens[0]);
	assert.ok(!("elementsRef" in baseline));
}

try {
	syntheticMatcherTests();
	await realCaptureTests();
	handoffFieldTests();
	process.stdout.write("ui-gate fidelity tests passed\n");
} catch (error) {
	process.stderr.write(`${error instanceof Error ? error.stack : error}\n`);
	process.exitCode = 1;
}
