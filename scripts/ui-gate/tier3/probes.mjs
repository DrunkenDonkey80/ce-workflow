#!/usr/bin/env node
// Tier 3 deterministic verification chain (plan-final.md §2.7): grid
// cross-check, pixel probe (hallucination quarantine), edge-snap
// refinement, text plausibility. No model calls live here — these are the
// deterministic checks a VLM rect must survive.
import { luminance } from "./png.mjs";

const CELL_LETTERS = "ABCDEFGHIJ";

// (i) Grid cross-check: the rect center must fall inside the cell the
// model declared (cross-modal self-check, zero extra calls).
export function gridCrossCheck({ rect, cell, width, height }) {
	const match = /^([A-J])([0-9])$/.exec(String(cell ?? ""));
	if (!match) return false;
	const col = CELL_LETTERS.indexOf(match[1]);
	const row = Number(match[2]);
	const centerX = ((rect.x + rect.width / 2) / 1000) * width;
	const centerY = ((rect.y + rect.height / 2) / 1000) * height;
	return (
		centerX >= (col * width) / 10 &&
		centerX < ((col + 1) * width) / 10 &&
		centerY >= (row * height) / 10 &&
		centerY < ((row + 1) * height) / 10
	);
}

// (ii) Pixel probe: ink variance on the eroded-interior border band. A flat
// background where a widget was claimed is a hallucination → quarantine.
export function pixelProbe({ image, rect }) {
	// Inset scales with the smaller side: erosion exists to skip borders and
	// rounded corners, which never scale with box width (a right-aligned
	// glyph would fall outside a width-proportional inset).
	const inset = Math.max(1, Math.round(Math.min(rect.width, rect.height) * 0.12));
	const erodeX = inset;
	const erodeY = inset;
	const left = Math.round(rect.x + erodeX);
	const right = Math.round(rect.x + rect.width - erodeX);
	const top = Math.round(rect.y + erodeY);
	const bottom = Math.round(rect.y + rect.height - erodeY);
	if (right - left < 2 || bottom - top < 2)
		return { flat: true, variance: 0, samples: 0 };
	const lums = [];
	const sample = (x, y) => {
		if (x < 0 || y < 0 || x >= image.width || y >= image.height) return;
		const i = (y * image.width + x) * 4;
		lums.push(luminance(image.data[i], image.data[i + 1], image.data[i + 2]));
	};
	// Outer ring at a tiny inset: borders and edge-hugging ink live within a
	// few pixels of the raw edges — a 12% erosion would skip them entirely.
	const rim = Math.max(1, Math.min(3, Math.round(Math.min(rect.width, rect.height) * 0.05)));
	for (let x = Math.round(rect.x); x < rect.x + rect.width; x += 1) {
		sample(x, Math.round(rect.y) + rim);
		sample(x, Math.round(rect.y + rect.height) - rim - 1);
	}
	for (let y = Math.round(rect.y); y < rect.y + rect.height; y += 1) {
		sample(Math.round(rect.x) + rim, y);
		sample(Math.round(rect.x + rect.width) - rim - 1, y);
	}
	const band = Math.max(1, Math.round(Math.min(right - left, bottom - top) * 0.25));
	for (let x = left; x < right; x += 1) {
		sample(x, top);
		sample(x, top + band);
		sample(x, bottom - band - 1);
		sample(x, bottom - 1);
	}
	for (let y = top; y < bottom; y += 1) {
		sample(left, y);
		sample(left + band, y);
		sample(right - band - 1, y);
		sample(right - 1, y);
	}
	// Interior ink: text regions carry their ink in the middle, not at the
	// border — sample a coarse grid across the eroded interior too.
	const step = Math.max(1, Math.floor(Math.min(right - left, bottom - top) / 12));
	for (let y = top; y < bottom; y += step)
		for (let x = left; x < right; x += step) sample(x, y);
	if (!lums.length) return { flat: true, variance: 0, samples: 0 };
	const mean = lums.reduce((sum, value) => sum + value, 0) / lums.length;
	const variance =
		lums.reduce((sum, value) => sum + (value - mean) ** 2, 0) / lums.length;
	return { flat: variance < 4, variance, samples: lums.length };
}

// (iii) Edge-snap refinement: ±10%-band gradient search per edge. The VLM
// rect is a region proposal; the deterministic image gradient is the
// measurement. Sharp high-contrast edges snap within ~2px.
export function edgeSnap({ image, rect, band = 0.1 }) {
	const lumAt = (x, y) => {
		const i = (Math.min(image.height - 1, Math.max(0, y)) * image.width +
			Math.min(image.width - 1, Math.max(0, x))) * 4;
		return luminance(image.data[i], image.data[i + 1], image.data[i + 2]);
	};
	const snapVertical = (edge, inward) => {
		// Vertical edges slide horizontally: the band scales with width.
		const range = Math.max(2, Math.round(rect.width * band));
		let best = edge;
		let bestGradient = -1;
		for (let offset = -range; offset <= range; offset += 1) {
			const candidate = edge + offset;
			let gradient = 0;
			for (let y = Math.round(rect.y); y < Math.round(rect.y + rect.height); y += 1) {
				const here = lumAt(candidate, y);
				const there = lumAt(candidate + (inward ? -1 : 1), y);
				gradient += Math.abs(here - there);
			}
			if (gradient > bestGradient) {
				bestGradient = gradient;
				best = candidate;
			}
		}
		return best;
	};
	const snapHorizontal = (edge, inward) => {
		// Horizontal edges slide vertically: the band scales with height.
		const range = Math.max(2, Math.round(rect.height * band));
		let best = edge;
		let bestGradient = -1;
		for (let offset = -range; offset <= range; offset += 1) {
			const candidate = edge + offset;
			let gradient = 0;
			for (let x = Math.round(rect.x); x < Math.round(rect.x + rect.width); x += 1) {
				const here = lumAt(x, candidate);
				const there = lumAt(x, candidate + (inward ? -1 : 1));
				gradient += Math.abs(here - there);
			}
			if (gradient > bestGradient) {
				bestGradient = gradient;
				best = candidate;
			}
		}
		return best;
	};
	const left = snapVertical(rect.x, true);
	const right = snapVertical(rect.x + rect.width, false);
	const top = snapHorizontal(rect.y, true);
	const bottom = snapHorizontal(rect.y + rect.height, false);
	const snapped = {
		x: Math.min(left, right - 1),
		y: Math.min(top, bottom - 1),
		width: Math.max(1, right - Math.min(left, right - 1)),
		height: Math.max(1, bottom - Math.min(top, bottom - 1)),
	};
	const deltas = {
		x: snapped.x - rect.x,
		y: snapped.y - rect.y,
		width: snapped.width - rect.width,
		height: snapped.height - rect.height,
	};
	const refined =
		Math.abs(deltas.x) > 1 ||
		Math.abs(deltas.y) > 1 ||
		Math.abs(deltas.width) > 1 ||
		Math.abs(deltas.height) > 1;
	return { rect: snapped, deltas, refined };
}

// (iv) Text plausibility: the implausible case is a box too small to hold
// its text; wide containers with short text are normal layout, so only the
// lower bound (plus an absurd upper bound) marks the anchor uncertain.
export function textPlausibility({ rect, text }) {
	if (!text) return null;
	const ratio = rect.width / Math.max(1, rect.height);
	const length = String(text).trim().length || 1;
	if (ratio < 0.2 * Math.sqrt(length)) return false;
	if (ratio > 200) return false;
	return true;
}
