#!/usr/bin/env node
// Tier 3 closed-set, text-anchored measurement protocol (plan-final.md §2.7):
// one model call per cell, anchors enumerated from the handoff, exactly one
// entry per anchor (found|not-found|uncertain), coordinates integers
// 0–1000 origin top-left. The deterministic verification chain (probes.mjs)
// vets every rect; degradation is BLOCKED, never a silent pass.
import { readFileSync } from "node:fs";
import {
	composeGrid,
	decodePng,
	encodePng,
	scaleToLongestEdge,
} from "./png.mjs";
import {
	edgeSnap,
	gridCrossCheck,
	pixelProbe,
	textPlausibility,
} from "./probes.mjs";

export const TIER3_BUDGET = 8; // model calls per round, including retries
const QUARANTINE_RATE_LIMIT = 0.3;

export function buildPrompt({ anchors, crop = null }) {
	const list = anchors
		.map(
			(anchor) =>
				`- ${anchor.name}${anchor.text ? ` (text: "${anchor.text}")` : ""}`,
		)
		.join("\n");
	if (crop)
		return `This image is a crop of a larger screenshot (coordinates are relative to the crop, integers 0-1000, origin top-left; 10x10 grid, rows 0-9 top to bottom, columns A-J left to right). Locate each region:
${list}
Reply with ONE JSON object: {"regions": {"<name>": {"cell": "<A-J><0-9>", "rect": [x0, y0, x1, y1], "status": "found"|"not-found"|"uncertain", "confidence": 0-100}}} — exactly one entry per requested region, nothing else.`;
	return `Screenshot with a 10x10 grid overlay (rows 0-9 top to bottom, columns A-J left to right). Coordinates are integers 0-1000, origin top-left. Locate each region:
${list}
Reply with ONE JSON object: {"regions": {"<name>": {"cell": "<A-J><0-9>", "rect": [x0, y0, x1, y1], "status": "found"|"not-found"|"uncertain", "confidence": 0-100}}} — exactly one entry per requested region, nothing else.`;
}

function schemaValid(response, anchors) {
	const regions = response?.regions;
	if (!regions || typeof regions !== "object") return false;
	const names = anchors.map((anchor) => anchor.name);
	if (Object.keys(regions).length !== names.length) return false;
	for (const name of names) {
		const entry = regions[name];
		if (!entry || !["found", "not-found", "uncertain"].includes(entry.status))
			return false;
		if (entry.status !== "found") continue;
		const rect = entry.rect;
		if (
			!Array.isArray(rect) ||
			rect.length !== 4 ||
			rect.some((value) => !Number.isInteger(value)) ||
			rect[0] < 0 ||
			rect[1] < 0 ||
			rect[2] <= rect[0] ||
			rect[3] <= rect[1] ||
			rect[2] > 1000 ||
			rect[3] > 1000
		)
			return false;
		if (!/^[A-J][0-9]$/.test(String(entry.cell ?? ""))) return false;
	}
	return true;
}

function normToPx(rect, width, height) {
	return {
		x: (rect[0] / 1000) * width,
		y: (rect[1] / 1000) * height,
		width: ((rect[2] - rect[0]) / 1000) * width,
		height: ((rect[3] - rect[1]) / 1000) * height,
	};
}

export async function runTier3Cell({
	screenshot, // PNG buffer
	anchors, // [{name, text?}]
	model, // {name, ask: async ({prompt, image}) => ({json, tokens})}
	budget = TIER3_BUDGET,
	imageLongestEdge = 1536,
}) {
	const calls = { count: 0, tokens: 0 };
	const blocked = (reason, extra = {}) => ({
		ok: false,
		blocked: reason,
		geometry: null,
		meta: {
			captureTier: "tier3",
			measuredBy: model.name,
			vlmCalls: calls.count,
			tokens: calls.tokens,
			...extra,
		},
	});
	const ask = async (prompt, image) => {
		if (calls.count >= budget)
			throw Object.assign(new Error("capture-budget-exceeded"), {
				code: "capture-budget-exceeded",
			});
		calls.count += 1;
		const reply = await model.ask({ prompt, image });
		calls.tokens += reply.tokens ?? 0;
		return reply.json;
	};

	const original = decodePng(screenshot);
	if (original.width * original.height > 1_500_000)
		return blocked("capture-budget-exceeded", {
			reason: "screenshot exceeds 1.5 Mpx",
		});
	const { image, scale } = scaleToLongestEdge(original, imageLongestEdge);
	const gridImage = composeGrid(image);
	const gridPng = encodePng(gridImage);

	let response = null;
	let unparseable = false;
	for (let attempt = 0; attempt < 2 && !response; attempt += 1) {
		try {
			const reply = await ask(buildPrompt({ anchors }), gridPng);
			if (schemaValid(reply, anchors)) response = reply;
			else if (attempt === 1) unparseable = true;
		} catch (error) {
			if (error?.code === "capture-budget-exceeded")
				return blocked("capture-budget-exceeded");
			throw error;
		}
	}
	if (unparseable || !response) return blocked("vlm-unparseable");

	const quarantined = [];
	const verified = [];
	for (const anchor of anchors) {
		const entry = response.regions[anchor.name];
		if (entry.status !== "found") {
			verified.push({
				anchor: anchor.name,
				status: entry.status,
				confidence: entry.confidence ?? null,
			});
			continue;
		}
		if (
			!gridCrossCheck({
				rect: {
					x: entry.rect[0],
					y: entry.rect[1],
					width: entry.rect[2] - entry.rect[0],
					height: entry.rect[3] - entry.rect[1],
				},
				cell: entry.cell,
				width: image.width,
				height: image.height,
			})
		) {
			quarantined.push({ anchor: anchor.name, reason: "grid-mismatch" });
			continue;
		}
		let rect = normToPx(entry.rect, image.width, image.height);
		let probe = pixelProbe({ image, rect });
		if (probe.flat) {
			// Escalation: crop-and-re-ask with crop-relative coordinates.
			try {
				const pad = 0.2;
				const cropBox = {
					x: Math.max(0, rect.x - rect.width * pad),
					y: Math.max(0, rect.y - rect.height * pad),
					width: Math.min(image.width, rect.width * (1 + 2 * pad)),
					height: Math.min(image.height, rect.height * (1 + 2 * pad)),
				};
				const cropData = new Uint8Array(
					Math.round(cropBox.width) * Math.round(cropBox.height) * 4,
				);
				for (let y = 0; y < Math.round(cropBox.height); y += 1)
					for (let x = 0; x < Math.round(cropBox.width); x += 1) {
						const source =
							((Math.round(cropBox.y) + y) * image.width + Math.round(cropBox.x) + x) *
							4;
						const target = (y * Math.round(cropBox.width) + x) * 4;
						cropData[target] = image.data[source];
						cropData[target + 1] = image.data[source + 1];
						cropData[target + 2] = image.data[source + 2];
						cropData[target + 3] = 255;
					}
				const cropReply = await ask(
					buildPrompt({ anchors: [anchor], crop: true }),
					encodePng({
						width: Math.round(cropBox.width),
						height: Math.round(cropBox.height),
						data: cropData,
					}),
				);
				if (!schemaValid(cropReply, [anchor])) {
					quarantined.push({ anchor: anchor.name, reason: "vlm-unparseable" });
					continue;
				}
				const cropEntry = cropReply.regions[anchor.name];
				if (cropEntry.status !== "found") {
					verified.push({
						anchor: anchor.name,
						status: "not-found",
						confidence: cropEntry.confidence ?? null,
					});
					continue;
				}
				const cropRect = normToPx(
					cropEntry.rect,
					Math.round(cropBox.width),
					Math.round(cropBox.height),
				);
				rect = {
					x: cropRect.x + cropBox.x,
					y: cropRect.y + cropBox.y,
					width: cropRect.width,
					height: cropRect.height,
				};
				probe = pixelProbe({ image, rect });
			} catch (error) {
				if (error?.code === "capture-budget-exceeded")
					return blocked("capture-budget-exceeded", { quarantined });
				throw error;
			}
		}
		if (probe.flat) {
			quarantined.push({ anchor: anchor.name, reason: "hallucinated-flat-probe" });
			continue;
		}
		const snap = edgeSnap({ image, rect });
		const plausible = textPlausibility({ rect: snap.rect, text: anchor.text });
		verified.push({
			anchor: anchor.name,
			status: plausible === false ? "uncertain" : "found",
			confidence: entry.confidence ?? null,
			rect: {
				x: Math.round((snap.rect.x / scale) * 100) / 100,
				y: Math.round((snap.rect.y / scale) * 100) / 100,
				width: Math.round((snap.rect.width / scale) * 100) / 100,
				height: Math.round((snap.rect.height / scale) * 100) / 100,
			},
			refined: snap.refined,
		});
	}

	if (quarantined.length / Math.max(1, anchors.length) > QUARANTINE_RATE_LIMIT)
		return blocked("capability-degraded", { quarantined });

	const geometry = {
		version: 1,
		profile: "vlm-tier3",
		viewport: { width: original.width, height: original.height },
		anchors: verified,
		quarantined,
		text: null,
		captureTier: "tier3",
		measuredBy: model.name,
	};
	return {
		ok: true,
		blocked: null,
		geometry,
		meta: {
			captureTier: "tier3",
			measuredBy: model.name,
			vlmCalls: calls.count,
			tokens: calls.tokens,
			quarantined,
			screenshotSha256: null,
		},
	};
}

export function tier3Screenshot(file) {
	return readFileSync(file);
}
