#!/usr/bin/env node
// Tier 3 calibration harness (plan-final.md §2.7): measures the measurement
// pipeline against DOM ground truth on the repo's web surfaces. The default
// model is a deterministic stub that perturbs ground truth — it calibrates
// the verification chain (grid check, pixel probe, edge snap), never
// real-VLM quality. A real adapter is injected via --model <module
// exporting {name, ask}>; the report records which model produced it.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { captureCell } from "../capture.mjs";
import { runTier3Cell } from "./measure.mjs";

const gateDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(gateDir, "..", "..", "..");

const SURFACES = [
	"scripts/fixtures/ui-gate/clean.html",
	"scripts/fixtures/ui-gate/fidelity-actual.html",
	"scripts/fixtures/ui-gate/states.html",
];

function readJson(file) {
	try {
		return JSON.parse(readFileSync(file, "utf8"));
	} catch (error) {
		throw new Error(
			`unreadable JSON (${file}): ${error instanceof Error ? error.message : error}`,
		);
	}
}

function clamp1000(value) {
	return Math.max(0, Math.min(1000, Math.round(value)));
}

function cellOf(rect, width, height) {
	const centerX = ((rect[0] + rect[2]) / 2 / 1000) * width;
	const centerY = ((rect[1] + rect[3]) / 2 / 1000) * height;
	const col = "ABCDEFGHIJ"[Math.min(9, Math.floor((centerX / width) * 10))];
	const row = Math.min(9, Math.floor((centerY / height) * 10));
	return `${col}${row}`;
}

// Deterministic stub: ground truth, shifted and grown — a plausible-wrong
// region proposal the deterministic chain must then vet and refine.
export function createStubModel({ shift = 7, grow = 3 } = {}) {
	let truth = [];
	return {
		name: "deterministic-stub",
		setTruth(next) {
			truth = next;
		},
		async ask({ prompt }) {
			// Answer exactly the requested anchors (a real model reads the
			// prompt; the stub reads its anchor list).
			const requested = [
				...String(prompt).matchAll(/^- ([^\n(]+?)(?: \(text:[^\n]*\))?$/gm),
			].map((match) => match[1].trim());
			const regions = {};
			for (const name of requested) {
				const entry = truth.find((candidate) => candidate.anchor === name);
				if (!entry) {
					regions[name] = {
						cell: "A0",
						rect: [10, 10, 20, 20],
						status: "not-found",
						confidence: 50,
					};
					continue;
				}
				const width = 1280;
				const height = 800;
				const rect = [
					clamp1000(((entry.rect.x + shift) / width) * 1000),
					clamp1000(((entry.rect.y + shift - 2) / height) * 1000),
					clamp1000(
						((entry.rect.x + entry.rect.width + shift + grow) / width) * 1000,
					),
					clamp1000(
						((entry.rect.y + entry.rect.height + shift + grow - 2) / height) * 1000,
					),
				];
				regions[name] = {
					cell: cellOf(rect, width, height),
					rect,
					status: "found",
					confidence: 80,
				};
			}
			return { json: { regions }, tokens: 1000 };
		},
	};
}

function percentile(sorted, p) {
	if (!sorted.length) return 0;
	const index = Math.min(
		sorted.length - 1,
		Math.ceil((p / 100) * sorted.length) - 1,
	);
	return sorted[index];
}

export async function calibrate({ surfaces, model, tolerance = null }) {
	const outRoot = path.join(
		os.tmpdir(),
		`ui-gate-tier3-calibrate-${Date.now()}`,
	);
	const report = {
		model: model.name,
		generatedAt: new Date().toISOString(),
		surfaces: [],
	};
	const errors = [];
	let requested = 0;
	let localized = 0;
	let falseMissing = 0;
	for (const surface of surfaces) {
		const file = path.resolve(repoRoot, surface);
		if (!existsSync(file)) {
			report.surfaces.push({ surface, skipped: "missing" });
			continue;
		}
		const out = path.join(outRoot, path.basename(surface, ".html"));
		await captureCell({
			target: file,
			viewport: "desktop",
			state: "ready",
			out,
		});
		const geometry = readJson(path.join(out, "geometry.json"));
		const truth = [];
		for (const element of geometry.elements)
			if (
				element.anchor &&
				!truth.some((entry) => entry.anchor === element.anchor)
			)
				truth.push({
					anchor: element.anchor,
					rect: element.rect,
					text: element.text || null,
				});
		if (!truth.length) {
			report.surfaces.push({ surface, skipped: "no data-ce-el anchors" });
			continue;
		}
		model.setTruth?.(truth);
		const cell = await runTier3Cell({
			screenshot: readFileSync(path.join(out, "screenshot.png")),
			anchors: truth.map(({ anchor, text }) => ({ name: anchor, text })),
			model,
		});
		const entry = { surface, anchors: truth.length, blocked: cell.blocked };
		if (cell.ok) {
			const centerErrors = [];
			for (const target of truth) {
				requested += 1;
				const measured = cell.geometry.anchors.find(
					(candidate) => candidate.anchor === target.anchor,
				);
				if (!measured || measured.status !== "found") {
					falseMissing += 1;
					continue;
				}
				const centerError = Math.hypot(
					measured.rect.x +
						measured.rect.width / 2 -
						(target.rect.x + target.rect.width / 2),
					measured.rect.y +
						measured.rect.height / 2 -
						(target.rect.y + target.rect.height / 2),
				);
				centerErrors.push(Math.round(centerError * 10) / 10);
			}
			errors.push(...centerErrors);
			localized += centerErrors.length;
			entry.centerErrors = centerErrors;
		} else {
			requested += truth.length;
			falseMissing += truth.length;
		}
		report.surfaces.push(entry);
	}
	const sorted = [...errors].sort((a, b) => a - b);
	const p50 = percentile(sorted, 50);
	const p95 = percentile(sorted, 95);
	const p99 = percentile(sorted, 99);
	const effectiveTolerance = tolerance ?? p99;
	const within = sorted.filter((value) => value <= effectiveTolerance).length;
	report.aggregate = {
		requested,
		localized,
		centerErrorPx: { p50, p95, p99 },
		tolerancePx: effectiveTolerance,
		withinTolerance: requested ? within / Math.max(1, localized || within) : 1,
		falseMissingRate: requested ? falseMissing / requested : 0,
		vlmCallsPerSurfaceMax: 3,
	};
	report.gate = {
		pass:
			report.aggregate.withinTolerance >= 0.95 &&
			report.aggregate.falseMissingRate <= 0.02 &&
			localized > 0,
		reasons: [
			report.aggregate.withinTolerance < 0.95
				? "within-tolerance below 95%"
				: null,
			report.aggregate.falseMissingRate > 0.02
				? "false region-missing above 2%"
				: null,
			localized === 0 ? "no anchors localized" : null,
		].filter(Boolean),
	};
	return report;
}

const isDirect =
	process.argv[1] &&
	path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (isDirect) {
	const arg = (name) => {
		const index = process.argv.indexOf(name);
		return index >= 0 ? process.argv[index + 1] : undefined;
	};
	let model = createStubModel();
	const modelModule = arg("--model");
	if (modelModule) {
		const loaded = await import(path.resolve(modelModule));
		model = loaded.model ?? loaded.default;
		if (!model?.ask) {
			process.stderr.write(`model module must export {name, ask}\n`);
			process.exitCode = 1;
		}
	}
	if (model?.ask) {
		const report = await calibrate({
			surfaces: SURFACES,
			model,
			tolerance: arg("--tolerance") ? Number(arg("--tolerance")) : null,
		});
		const out =
			arg("--out") ??
			path.join(
				repoRoot,
				"scripts",
				"fixtures",
				"ui-gate",
				"tier3-calibration-report.json",
			);
		mkdirSync(path.dirname(out), { recursive: true });
		writeFileSync(out, `${JSON.stringify(report, null, 1)}\n`);
		process.stdout.write(
			`${JSON.stringify({
				model: report.model,
				p50: report.aggregate.centerErrorPx.p50,
				p95: report.aggregate.centerErrorPx.p95,
				p99: report.aggregate.centerErrorPx.p99,
				gate: report.gate.pass,
				out,
			})}\n`,
		);
		if (!report.gate.pass) process.exitCode = 2;
	}
}
