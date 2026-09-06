#!/usr/bin/env node
// Unit P4: native capture profiles (plan-final.md §2.7 table): Android
// (adb + uiautomator), Windows (UIA via PowerShell/.NET), Python GUIs
// (tkinter introspection), histogram colour sampler. Fixture rows always
// run; live rows skip gracefully and record the skip when the platform is
// unavailable.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	androidCapability,
	captureAndroidCell,
	normalizeUiautomatorDump,
} from "./ui-gate/profiles/android.mjs";
import {
	captureWinUiaCell,
	normalizeUiaTree,
} from "./ui-gate/profiles/win-uia.mjs";
import {
	capturePyGuiCell,
	normalizeTkReport,
} from "./ui-gate/profiles/pygui.mjs";
import { histogramFromPng } from "./ui-gate/profiles/histogram.mjs";
import { encodePng } from "./ui-gate/tier3/png.mjs";
import { runValidityRules } from "./ui-gate/validity-rules.mjs";

const root = mkdtempSync(path.join(tmpdir(), "ui-gate-native-"));
const fixtures = path.resolve("scripts/fixtures/ui-gate");

function readJson(file) {
	try {
		return JSON.parse(readFileSync(file, "utf8"));
	} catch (error) {
		throw new Error(
			`unreadable JSON (${file}): ${error instanceof Error ? error.message : error}`,
		);
	}
}

const rules = (geometry) =>
	runValidityRules(geometry, { contentStrings: [], allowlist: [] });

// (a) Android: emulator-style fixture with a seeded overlap defect fires
// R2 through the normal uiautomator pipeline; the clean variant passes.
{
	const overlap = normalizeUiautomatorDump(
		readFileSync(path.join(fixtures, "android-overlap.xml"), "utf8"),
	);
	assert.equal(overlap.profile, "android-uiautomator");
	const buttons = overlap.elements.filter((element) => element.tag === "Button");
	assert.equal(buttons.length, 2, "both buttons normalized");
	assert.ok(buttons.every((button) => button.interactive));
	const overlapFindings = rules(overlap).filter(
		(finding) => finding.rule === "interactive-overlap",
	);
	assert.equal(overlapFindings.length, 1, "seeded overlap defect fires R2");
	assert.equal(overlapFindings[0].severity, "error");

	const clean = normalizeUiautomatorDump(
		readFileSync(path.join(fixtures, "android-clean.xml"), "utf8"),
	);
	assert.deepEqual(
		rules(clean).map((finding) => finding.rule),
		[],
		"clean fixture passes the full gate rules",
	);

	// Live device row: real capture when a device is attached, recorded skip
	// otherwise (never a fake verdict).
	if (await androidCapability()) {
		const out = path.join(root, "android-live");
		const cell = await captureAndroidCell({ out });
		assert.equal(cell.ok, true, `live capture: ${JSON.stringify(cell)}`);
		const geometry = readJson(path.join(out, "geometry.json"));
		assert.ok(geometry.elements.length >= 1, "real screen produced elements");
		for (const element of geometry.elements) {
			assert.ok(Number.isFinite(element.rect.x));
			assert.ok(element.rect.width >= 0);
		}
		assert.ok(Array.isArray(rules(geometry)), "rules run on live geometry");
		assert.ok(existsSync(path.join(out, "screenshot.png")), "screencap landed");
		console.log(
			`ok - android fixture defect fires R2; live device captured (${geometry.elements.length} elements)`,
		);
	} else {
		const cell = await captureAndroidCell({
			out: path.join(root, "android-missing"),
		});
		assert.equal(cell.ok, false);
		assert.equal(cell.skipped, "adb-device-unavailable");
		console.log("ok - android fixture defect fires R2; live row recorded skip");
	}
}

// (b) Windows UIA: tree dump normalizes and the fixture app passes the
// gate; a seeded overlapping tree fires R2.
{
	const overlapTree = readJson(path.join(fixtures, "winuia-overlap.json"));
	const overlap = normalizeUiaTree(overlapTree);
	const buttons = overlap.elements.filter((element) => element.tag === "Button");
	assert.equal(buttons.length, 2);
	assert.ok(buttons.every((button) => button.interactive));
	const overlapFindings = rules(overlap).filter(
		(finding) => finding.rule === "interactive-overlap",
	);
	assert.equal(overlapFindings.length, 1, "seeded UIA overlap fires R2");
	// The window contains both buttons; containment parent links keep the
	// parent–child pair out of R2.
	const window = overlap.elements.find((element) => element.tag === "Window");
	assert.ok(window, "window element present");
	const windowKey = `Window@${window.key}`;
	assert.equal(
		rules(overlap).filter(
			(finding) =>
				finding.element.matchKey === windowKey ||
				finding.neighbor?.matchKey === windowKey,
		).length,
		0,
		"window never overlaps its children",
	);

	const live = await captureWinUiaCell({ out: path.join(root, "winuia-live") });
	if (live.ok) {
		const geometry = readJson(path.join(root, "winuia-live", "geometry.json"));
		const texts = geometry.elements.map((element) => element.text);
		assert.ok(
			texts.some((text) => /Alpha/.test(text)),
			"Alpha button dumped",
		);
		assert.ok(
			texts.some((text) => /Beta/.test(text)),
			"Beta button dumped",
		);
		const findings = rules(geometry);
		assert.deepEqual(
			findings
				.filter((finding) => finding.severity === "error")
				.map((f) => f.rule),
			[],
			`fixture app passes the gate: ${JSON.stringify(findings)}`,
		);
		console.log("ok - win-uia fixture app dumped live and passes the gate");
	} else {
		assert.ok(live.skipped, "live row records the skip reason");
		console.log(
			`ok - win-uia fixture defect fires R2; live row skipped (${live.skipped})`,
		);
	}
}

// (c) Python GUIs: the tkinter helper self-report round-trips through the
// normalizer.
{
	const live = await capturePyGuiCell({ out: path.join(root, "pygui-live") });
	if (live.ok) {
		const geometry = readJson(path.join(root, "pygui-live", "geometry.json"));
		const buttons = geometry.elements.filter(
			(element) => element.tag === "Button",
		);
		assert.equal(buttons.length, 2, "fixture app reports both buttons");
		assert.ok(buttons.some((button) => button.text === "Alpha"));
		assert.ok(buttons.some((button) => button.text === "Beta"));
		assert.ok(
			Math.abs(buttons[0].rect.x - buttons[1].rect.x) > buttons[0].rect.width,
			"buttons do not overlap",
		);
		assert.deepEqual(
			rules(geometry).map((finding) => finding.rule),
			[],
			"tkinter fixture passes the gate rules",
		);
		console.log("ok - tkinter helper self-report round-trips clean");
	} else {
		// Offline fallback: the round-trip still gets exercised through a
		// recorded report shape.
		const report = {
			viewport: { width: 320, height: 160 },
			elements: [
				{ key: "0/0", class: "Button", text: "Alpha", x: 60, y: 60, w: 90, h: 34 },
				{ key: "0/1", class: "Button", text: "Beta", x: 240, y: 60, w: 90, h: 34 },
			],
		};
		const geometry = normalizeTkReport(report);
		assert.equal(geometry.elements.length, 2);
		assert.deepEqual(
			rules(geometry).map((finding) => finding.rule),
			[],
		);
		console.log(
			`ok - tkinter helper round-trips via recorded report (live skipped: ${live.skipped})`,
		);
	}
}

// Histogram colour sampler for off-web surfaces: deterministic modes from a
// synthetic PNG.
{
	const data = new Uint8Array(20 * 10 * 4).fill(255);
	for (let y = 0; y < 10; y += 1)
		for (let x = 0; x < 20; x += 1) {
			const target = (y * 20 + x) * 4;
			if (x < 10) {
				data[target] = 0xff;
				data[target + 1] = 0x00;
				data[target + 2] = 0x00;
			} else {
				data[target] = 0x00;
				data[target + 1] = 0x00;
				data[target + 2] = 0xff;
			}
			data[target + 3] = 255;
		}
	const verdict = histogramFromPng(encodePng({ width: 20, height: 10, data }), {
		x: 0,
		y: 0,
		width: 20,
		height: 10,
	});
	assert.equal(verdict.modes, 2, "two colour modes detected");
	assert.equal(
		verdict.colour[0],
		0xff,
		"dominant channel survives quantization",
	);
	console.log("ok - histogram colour sampler counts deterministic modes");
}

console.log("ui-gate native profile tests passed");
