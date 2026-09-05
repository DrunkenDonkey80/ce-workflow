#!/usr/bin/env node
// UI gate (plan-final.md): capture → R1–R5 validity → fidelity match → findings,
// with bounded repair rounds (max 3, monotone), repair-recipe hints, telemetry.
import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { captureCell } from "./capture.mjs";
import { runValidityRules, loadAllowlist } from "./validity-rules.mjs";
import { matchFidelity } from "./fidelity-matcher.mjs";
import { writeEvidenceArtifacts } from "./overlays.mjs";

const uiGateDir = path.dirname(fileURLToPath(import.meta.url));

function arg(name) {
	const index = process.argv.indexOf(name);
	return index >= 0 ? process.argv[index + 1] : undefined;
}
function all(name) {
	return process.argv
		.flatMap((value, index) => (value === name ? [process.argv[index + 1]] : []))
		.filter(Boolean);
}
function readJson(file, fallback) {
	if (!file || !existsSync(file)) return fallback;
	try {
		return JSON.parse(readFileSync(file, "utf8"));
	} catch (error) {
		throw new Error(
			`unreadable JSON (${file}): ${error instanceof Error ? error.message : error}`,
		);
	}
}

function contentStrings(handoff) {
	const strings = [];
	const walk = (value) => {
		if (typeof value === "string") strings.push(value);
		else if (Array.isArray(value)) value.forEach(walk);
		else if (value && typeof value === "object")
			Object.values(value).forEach(walk);
	};
	walk(handoff?.content);
	return strings.filter((text) => text.trim());
}

function evaluateRound(previous, current) {
	if (!previous) return { improved: true, converged: current.errors === 0 };
	const improved =
		current.errors < previous.errors ||
		(current.errors === previous.errors && current.total < previous.total);
	return {
		improved,
		converged: current.errors === 0,
		earlyStop: !improved,
	};
}

function decorate(findings, recipes) {
	return findings.map((finding) => ({
		...finding,
		hint: recipes[finding.rule] ?? null,
	}));
}

export async function runGate({
	actual,
	spec = null,
	viewports = ["desktop"],
	state = "ready",
	out,
	handoffFile = null,
	allowlistFile = path.join(uiGateDir, "allowlist.json"),
	round = null,
	maxRounds = 3,
	acceptBaseline = false,
	geometryOnly = false,
}) {
	mkdirSync(out, { recursive: true });
	const allowlist = existsSync(allowlistFile)
		? loadAllowlist(allowlistFile)
		: [];
	const handoff = readJson(handoffFile, {});
	const recipes = readJson(path.join(uiGateDir, "repair-recipes.json"), {
		recipes: {},
	}).recipes;
	const requiredContent = contentStrings(handoff);
	const spacingTokens = handoff?.tokens?.spacing ?? null;
	const requiredRegions =
		handoff?.screens?.flatMap((screen) => screen.requiredRegions ?? []) ?? [];
	const layoutAssertions = handoff?.screens?.flatMap(
		(screen) => screen.layoutAssertions ?? [],
	);

	const findings = [];
	const evidence = {
		geometryDeltas: [],
		typographyDeltas: [],
		regions: [],
		matchedPairs: 0,
		responsive: {
			reflow: true,
			noHorizontalOverflow: true,
			contrast: true,
			visibleFocus: true,
		},
	};
	const mainWidths = {};
	const artifactPaths = {};

	for (const viewport of viewports) {
		const cellDir = path.join(out, viewport);
		const actualResult = await captureCell({
			target: actual,
			viewport,
			state,
			out: path.join(cellDir, "actual"),
			geometryOnly,
		});
		const actualMeta = readJson(path.join(cellDir, "actual", "meta.json"), {});
		const actualGeometry = readJson(
			path.join(cellDir, "actual", "geometry.json"),
		);
		mainWidths[viewport] =
			actualGeometry.elements[0]?.rect.width ?? actualGeometry.viewport.width;

		const baselinePath = path.join(cellDir, "baseline.json");
		const baselineGeometry =
			!acceptBaseline && existsSync(baselinePath) ? readJson(baselinePath) : null;

		const validity = runValidityRules(actualGeometry, {
			quarantined: actualMeta.quarantined ?? [],
			allowlist,
			contentStrings: requiredContent,
			spacingTokens,
			baselineGeometry,
		});

		const actualAnchors = new Set(
			actualGeometry.elements.map((element) => element.anchor).filter(Boolean),
		);
		evidence.regions.push(
			...requiredRegions.filter((name) => actualAnchors.has(name)),
		);

		let fidelity = { findings: [], evidence: { matchedPairs: 0 } };
		if (spec) {
			const specDir = path.join(cellDir, "spec");
			if (!existsSync(path.join(specDir, "geometry.json"))) {
				await captureCell({
					target: spec,
					viewport,
					state,
					out: specDir,
					geometryOnly,
				});
			}
			fidelity = matchFidelity({
				spec: readJson(path.join(specDir, "geometry.json")),
				actual: actualGeometry,
				handoff,
				layoutAssertions,
			});			evidence.geometryDeltas.push(...(fidelity.evidence.geometryDeltas ?? []));
			evidence.typographyDeltas.push(
				...(fidelity.evidence.typographyDeltas ?? []),
			);
			evidence.regions.push(...(fidelity.evidence.regions ?? []));
			evidence.matchedPairs += fidelity.evidence.matchedPairs ?? 0;
			for (const flag of ["noHorizontalOverflow", "contrast", "visibleFocus"])
				evidence.responsive[flag] =
					evidence.responsive[flag] && fidelity.evidence.responsive?.[flag];
		} else {
			for (const flag of ["noHorizontalOverflow", "contrast", "visibleFocus"]) {
				const fromDoc =
					flag === "noHorizontalOverflow"
						? actualGeometry.document.scrollWidth <=
							actualGeometry.document.innerWidth + 1
						: undefined;
				if (fromDoc !== undefined)
					evidence.responsive[flag] = evidence.responsive[flag] && fromDoc;
			}
		}

		const cellFindings = decorate([...validity, ...fidelity.findings], recipes);
		findings.push(...cellFindings.map((finding) => ({ ...finding, viewport })));
		if (cellFindings.length || !geometryOnly) {
			const overlays = writeEvidenceArtifacts({
				outDir: path.join(cellDir, "actual"),
				geometry: actualGeometry,
				findings: cellFindings,
				specGeometry: spec
					? readJson(path.join(cellDir, "spec", "geometry.json"))
					: undefined,
				specScreenshotName: spec
					? path.join("..", "spec", "screenshot.png")
					: undefined,
			});
			artifactPaths[viewport] = {
				...actualResult.artifacts,
				...overlays,
			};
		}
		// Plan §2.4: persist the last-passing geometry as the drift baseline;
		// --accept-baseline records a deliberate human re-acceptance.
		if (
			acceptBaseline ||
			!cellFindings.some((finding) => finding.severity === "error")
		)
			writeFileSync(baselinePath, `${JSON.stringify(actualGeometry, null, 1)}\n`);
	}

	const widths = Object.values(mainWidths);
	if (widths.length > 1) {
		const [first, ...rest] = widths;
		evidence.responsive.reflow = rest.some(
			(width) => Math.abs(width - first) > 1,
		);
	}
	evidence.regions = [...new Set(evidence.regions)];

	const byRule = {};
	for (const finding of findings)
		byRule[finding.rule] = (byRule[finding.rule] ?? 0) + 1;
	const summary = {
		errors: findings.filter((f) => f.severity === "error").length,
		warnings: findings.filter((f) => f.severity === "warning").length,
		total: findings.length,
		byRule,
	};

	const runFile = path.join(out, "gate-run.json");
	const runRecord = readJson(runFile, { rounds: [] });
	const roundNumber = round ?? (runRecord.rounds.at(-1)?.round ?? 0) + 1;
	const previous = runRecord.rounds.at(-1) ?? null;
	const evaluation = evaluateRound(previous, summary);
	const roundEntry = {
		round: roundNumber,
		wallMs: null,
		...summary,
		...evaluation,
	};
	runRecord.rounds.push(roundEntry);
	runRecord.maxRounds = maxRounds;
	runRecord.converged = evaluation.converged;
	runRecord.earlyStop = Boolean(evaluation.earlyStop);
	runRecord.roundCapReached = roundNumber >= maxRounds && !evaluation.converged;
	writeFileSync(runFile, `${JSON.stringify(runRecord, null, 1)}\n`);
	appendFileSync(
		path.join(out, "telemetry.jsonl"),
		`${JSON.stringify({
			event: "ui_gate_round",
			round: roundNumber,
			...summary,
			...evaluation,
			vlmCalls: 0,
			tokens: 0,
			captureTier: "deterministic",
			measuredBy: "web-chromium",
		})}\n`,
	);

	writeFileSync(
		path.join(out, "findings.json"),
		`${JSON.stringify({ findings, evidence, round: roundNumber }, null, 1)}\n`,
	);

	const result = {
		ok: summary.errors === 0,
		...summary,
		round: roundNumber,
		converged: evaluation.converged,
		earlyStop: Boolean(evaluation.earlyStop),
		roundCapReached: runRecord.roundCapReached,
		artifacts: {
			findings: "findings.json",
			run: "gate-run.json",
			...artifactPaths,
		},
	};
	process.stdout.write(`${JSON.stringify(result)}\n`);
	return result;
}

const isDirect =
	process.argv[1] &&
	path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (isDirect) {
	const actual = arg("--actual");
	const out = arg("--out");
	if (!actual || !out) {
		process.stderr.write(
			"Usage: gate.mjs --actual <url-or-file> [--spec <url-or-file>] --viewport <name> [--viewport <name>] --state <state> --out <dir> [--handoff <path>] [--round <n>] [--max-rounds <n>] [--accept-baseline] [--geometry-only]\n",
		);
		process.exitCode = 1;
	} else {
		const started = Date.now();
		const result = await runGate({
			actual,
			spec: arg("--spec"),
			viewports: all("--viewport").length ? all("--viewport") : ["desktop"],
			state: arg("--state") ?? "ready",
			out,
			handoffFile: arg("--handoff"),
			round: arg("--round") ? Number(arg("--round")) : null,
			maxRounds: arg("--max-rounds") ? Number(arg("--max-rounds")) : 3,
			acceptBaseline: process.argv.includes("--accept-baseline"),
			geometryOnly: process.argv.includes("--geometry-only"),
		});
		const runFile = `${out}/gate-run.json`;
		const runRecord = readJson(runFile, { rounds: [] });
		if (runRecord.rounds.at(-1))
			runRecord.rounds.at(-1).wallMs = Date.now() - started;
		writeFileSync(runFile, `${JSON.stringify(runRecord, null, 1)}\n`);
		if (!result.ok) process.exitCode = 2;
	}
}
