#!/usr/bin/env node
// Unit P3: hardening (plan-final.md §2.6 + §2.2 R6–R8) — fingerprint
// cheap-mode verdict reuse, focus-visible + min-target defects, state
// degeneracy, computed WCAG contrast.
import assert from "node:assert/strict";
import {
	appendFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runGate } from "./ui-gate/gate.mjs";
import { runGateCheap } from "./ui-gate/fingerprint.mjs";

const root = mkdtempSync(path.join(tmpdir(), "ui-gate-hardening-"));
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

async function gate(name, options) {
	const out = path.join(root, name);
	const result = await runGate({ out, geometryOnly: true, ...options });
	const report = readJson(path.join(out, "findings.json"));
	return { result, findings: report.findings, out };
}

const rulesOf = (findings) => [...new Set(findings.map((finding) => finding.rule))];

// (a)+(b) CI cheap-mode: unchanged fingerprint reuses the recorded verdict
// fast; a render-file change invalidates it.
{
	const surface = path.join(root, "surface");
	mkdirSync(path.join(surface, "styles"), { recursive: true });
	writeFileSync(
		path.join(surface, "page.html"),
		'<!doctype html><html><head><meta charset="utf-8"><style>body{font:18px system-ui;padding:20px;color:#000;background:#fff}</style></head><body><button data-ce-el="go" style="width:48px;height:32px">Go</button></body></html>',
	);
	writeFileSync(path.join(surface, "styles", "tokens.css"), ":root{--pad:12px}\n");
	const verdictCacheFile = path.join(root, "verdict-cache.json");
	const first = await runGateCheap({
		fingerprintRoot: surface,
		verdictCacheFile,
		out: path.join(root, "cheap-1"),
		run: () =>
			runGate({
				actual: path.join(surface, "page.html"),
				out: path.join(root, "cheap-1"),
				geometryOnly: true,
			}),
	});
	assert.equal(first.reused, false, "first run records the verdict");
	assert.equal(first.errors, 0, "fixture surface is clean");
	const started = Date.now();
	const second = await runGateCheap({
		fingerprintRoot: surface,
		verdictCacheFile,
		out: path.join(root, "cheap-2"),
		run: () =>
			runGate({
				actual: path.join(surface, "page.html"),
				out: path.join(root, "cheap-2"),
				geometryOnly: true,
			}),
	});
	const wallMs = Date.now() - started;
	assert.equal(second.reused, true, "unchanged fingerprint reuses the verdict");
	assert.equal(second.errors, first.errors, "reused verdict matches");
	assert.ok(wallMs < 5000, `verdict reuse wall ${wallMs}ms < 5s`);
	const telemetry = readFileSync(
		path.join(root, "cheap-2", "telemetry.jsonl"),
		"utf8",
	);
	assert.match(telemetry, /ui_gate_verdict_reused/, "reuse is visible in telemetry");
	// (b) a token change invalidates the fingerprint.
	appendFileSync(path.join(surface, "styles", "tokens.css"), "--accent:#ff0055\n");
	const third = await runGateCheap({
		fingerprintRoot: surface,
		verdictCacheFile,
		out: path.join(root, "cheap-3"),
		run: () =>
			runGate({
				actual: path.join(surface, "page.html"),
				out: path.join(root, "cheap-3"),
				geometryOnly: true,
			}),
	});
	assert.equal(third.reused, false, "token change invalidates the fingerprint");
	console.log("ok - fingerprint cheap-mode reuses verdicts, token change invalidates");
}

// (c) R6 focus-missing and R7 min-target-size seeded defects fire; their
// clean siblings stay silent.
{
	const focus = await gate("focus", {
		actual: path.join(fixtures, "focus-defect.html"),
		hardening: true,
	});
	const focusFindings = focus.findings.filter(
		(finding) => finding.rule === "focus-missing",
	);
	assert.equal(focusFindings.length, 1, "R6 fires on the unstyled link");
	assert.match(focusFindings[0].element.matchKey, /^A@/, "finding names the link");
	assert.ok(
		!focusFindings.some((finding) => /BUTTON/.test(finding.element.matchKey)),
		"the styled button stays clean",
	);
	assert.ok(
		!rulesOf(focus.findings).includes("min-target-size"),
		"no min-target noise on the focus fixture",
	);

	const target = await gate("target", {
		actual: path.join(fixtures, "small-target.html"),
		hardening: true,
	});
	const small = target.findings.filter(
		(finding) => finding.rule === "min-target-size",
	);
	assert.equal(small.length, 1, "R7 fires on the 12px dot button");
	assert.equal(small[0].measured, 12, "measured the smallest side");
	assert.ok(
		!rulesOf(target.findings).includes("focus-missing"),
		"focus rule present, no R6 noise",
	);
	console.log("ok - R6 focus-missing and R7 min-target-size defects fire");
}

// (d) R8 state-coverage: distinct declared states pass, a state-ignoring
// page is flagged degenerate.
{
	const distinct = await gate("states-distinct", {
		actual: path.join(fixtures, "states.html"),
		states: ["ready", "error"],
	});
	assert.ok(
		!rulesOf(distinct.findings).includes("state-degenerate"),
		`distinct states not degenerate: ${JSON.stringify(distinct.result.byRule)}`,
	);
	for (const state of ["ready", "error"])
		assert.ok(
			existsSync(path.join(distinct.out, "desktop", state, "actual", "geometry.json")),
			`state ${state} captured`,
		);
	const errorText = readJson(
		path.join(distinct.out, "desktop", "error", "actual", "geometry.json"),
	).text;
	assert.match(errorText, /Something failed/, "error state copy present");
	assert.ok(
		!errorText.includes("All systems ready"),
		"ready-only copy suppressed in error state",
	);

	const degenerate = await gate("states-degenerate", {
		actual: path.join(fixtures, "ignores-states.html"),
		states: ["ready", "error"],
	});
	const flagged = degenerate.findings.filter(
		(finding) => finding.rule === "state-degenerate",
	);
	assert.equal(flagged.length, 1, "identical state geometry is flagged");
	assert.equal(flagged[0].element.matchKey, "error|ready");
	console.log("ok - R8 state-coverage: distinct states pass, degenerate flagged");
}

// (e) Computed WCAG contrast: #777 on #fff (~4.47:1) fires at the 4.5
// threshold; #000 on #fff stays clean.
{
	const contrast = await gate("contrast", {
		actual: path.join(fixtures, "low-contrast.html"),
		hardening: true,
	});
	const low = contrast.findings.filter(
		(finding) => finding.rule === "low-contrast",
	);
	assert.equal(low.length, 1, "one low-contrast finding");
	assert.ok(
		low[0].measured >= 4.3 && low[0].measured < 4.5,
		`measured ratio ~4.4:1, got ${low[0].measured}`,
	);
	assert.equal(low[0].threshold, 4.5, "threshold is 4.5:1");
	assert.equal(low[0].foreground, "#777777");
	console.log("ok - computed WCAG contrast flags 4.4:1 at the 4.5 threshold");
}

console.log("ui-gate hardening tests passed");
