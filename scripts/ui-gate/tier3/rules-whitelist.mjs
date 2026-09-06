#!/usr/bin/env node
// Tier 3 rule whitelist (plan-final.md §2.7): categorical findings only —
// no numeric correction vectors, never a validateDesignFidelityEvidence
// field. Advisory by default; blocking needs per-project opt-in and even
// then only these ordinal/categorical rules may block.
import { findingId } from "../validity-rules.mjs";
import { SEVERITY_RANK } from "../validity-rules.mjs";

export const TIER3_RULES = [
	"region-not-verified",
	"region-out-of-place",
	"gross-overlap",
	"off-canvas",
	"ordering-violation",
	"color-token-mismatch",
];

const BLOCKING_RULES = new Set(TIER3_RULES); // all categorical — none carry a delta

function makeTier3Finding(rule, anchor, viewport, state, extra) {
	const severity = "warning";
	return {
		id: findingId(rule, anchor, viewport, state),
		rule,
		severity,
		element: { matchKey: anchor, anchor, tag: "REGION" },
		viewport,
		state,
		...extra,
	};
}

const overlapArea = (a, b) => {
	const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
	const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
	return width > 0 && height > 0 ? width * height : 0;
};

export function evaluateTier3({
	geometry,
	viewport = "desktop",
	state = "ready",
	referenceAnchors = null, // [{anchor, rect}] — prior accepted baseline
	layoutAssertions = [],
	roleColors = [],
	image = null,
	blockingOptIn = false,
}) {
	const findings = [];
	const found = (geometry?.anchors ?? []).filter(
		(entry) => entry.status === "found" && entry.rect,
	);
	const names = new Set((geometry?.anchors ?? []).map((entry) => entry.anchor));

	// region-not-verified: merged missing/misplaced catch-all.
	for (const entry of geometry?.anchors ?? [])
		if (entry.status !== "found")
			findings.push(
				makeTier3Finding("region-not-verified", entry.anchor, viewport, state, {
					measured: entry.status,
					threshold: "found",
					hint: `region ${entry.anchor} was not located — inspect the layout container`,
				}),
			);

	// region-out-of-place: threshold from calibration (start 8% of width);
	// categorical hint only, never a correction vector.
	if (referenceAnchors?.length) {
		const threshold = 0.08 * (geometry?.viewport?.width ?? 1280);
		const reference = new Map(
			referenceAnchors.map((entry) => [entry.anchor, entry.rect]),
		);
		for (const entry of found) {
			const before = reference.get(entry.anchor);
			if (!before) continue;
			const moved = Math.hypot(
				entry.rect.x + entry.rect.width / 2 - (before.x + before.width / 2),
				entry.rect.y + entry.rect.height / 2 - (before.y + before.height / 2),
			);
			if (moved > threshold)
				findings.push(
					makeTier3Finding("region-out-of-place", entry.anchor, viewport, state, {
						measured: "moved beyond threshold",
						threshold: `${Math.round(threshold)}px center drift (categorical)`,
						hint: `region ${entry.anchor} is not where the design places it — inspect the layout container`,
					}),
				);
		}
	}

	// gross-overlap: >25% of the smaller box (vs R2's deterministic 5%).
	for (let i = 0; i + 1 < found.length; i += 1)
		for (let j = i + 1; j < found.length; j += 1) {
			const a = found[i];
			const b = found[j];
			const smaller = Math.min(
				a.rect.width * a.rect.height,
				b.rect.width * b.rect.height,
			);
			if (overlapArea(a.rect, b.rect) / Math.max(1, smaller) > 0.25)
				findings.push(
					makeTier3Finding(
						"gross-overlap",
						[...[a.anchor, b.anchor]].sort().join("|"),
						viewport,
						state,
						{
							measured: "regions overlap",
							threshold: "25% of the smaller region",
							hint: `${a.anchor} and ${b.anchor} overlap grossly — separate the regions`,
						},
					),
				);
		}

	// off-canvas: rect entirely outside the viewport.
	const viewportBox = geometry?.viewport ?? { width: 1280, height: 800 };
	for (const entry of found)
		if (
			entry.rect.x >= viewportBox.width ||
			entry.rect.y >= viewportBox.height ||
			entry.rect.x + entry.rect.width <= 0 ||
			entry.rect.y + entry.rect.height <= 0
		)
			findings.push(
				makeTier3Finding("off-canvas", entry.anchor, viewport, state, {
					measured: "outside the canvas",
					threshold: "inside the canvas",
					hint: `region ${entry.anchor} renders off-canvas`,
				}),
			);

	// ordering-violation: purely ordinal, the tier's most noise-robust check.
	for (const assertion of layoutAssertions) {
		const match = /^(.+?)\s+(?:is\s+)?above\s+(.+)$/i.exec(
			String(assertion).trim(),
		);
		if (!match) continue;
		const top = names.has(match[1]) ? match[1] : null;
		const bottom = names.has(match[2]) ? match[2] : null;
		if (!top || !bottom) continue;
		const topEntry = found.find((entry) => entry.anchor === top);
		const bottomEntry = found.find((entry) => entry.anchor === bottom);
		if (topEntry && bottomEntry) {
			const topCenter = topEntry.rect.y + topEntry.rect.height / 2;
			const bottomCenter = bottomEntry.rect.y + bottomEntry.rect.height / 2;
			if (topCenter >= bottomCenter)
				findings.push(
					makeTier3Finding(
						"ordering-violation",
						`${top}|${bottom}`,
						viewport,
						state,
						{
							measured: `${top} is not above ${bottom}`,
							threshold: assertion,
							hint: `${top} should render above ${bottom}`,
						},
					),
				);
		}
	}

	// color-token-mismatch: deterministic histogram on the eroded central
	// 50%; more than one mode above 15% quarantines the colour check.
	if (image && roleColors.length)
		for (const entry of found) {
			const verdict = dominantColour({ image, rect: entry.rect });
			if (!verdict || verdict.modes > 1) continue; // colour quarantined
			const colour = verdict.colour;
			const tokens = roleColors
				.map((token) => ({
					name: token.name,
					distance: colourDistance(colour, token.value),
				}))
				.sort((a, b) => a.distance - b.distance)[0];
			if (tokens && tokens.distance > 96)
				findings.push(
					makeTier3Finding("color-token-mismatch", entry.anchor, viewport, state, {
						measured: `#${toHex(colour)}`,
						threshold: tokens.name,
						hint: `region ${entry.anchor} reads closest to ${tokens.name} but is far off-token`,
					}),
				);
		}

	// Blocking policy: advisory by default; opt-in upgrades only these
	// categorical rules (never a metric delta — there is none to upgrade).
	if (blockingOptIn)
		for (const finding of findings)
			if (BLOCKING_RULES.has(finding.rule)) finding.severity = "error";
	return findings.sort(
		(a, b) =>
			SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
			a.id.localeCompare(b.id),
	);
}

function parseHex(value) {
	const match = /^#?([0-9a-f]{6})$/i.exec(String(value ?? ""));
	if (!match) return null;
	const int = Number.parseInt(match[1], 16);
	return [(int >> 16) & 0xff, (int >> 8) & 0xff, int & 0xff];
}

const toHex = (colour) =>
	colour
		.map((channel) => Math.round(channel).toString(16).padStart(2, "0"))
		.join("");

const colourDistance = (a, b) => {
	const parsed = parseHex(b);
	if (!parsed) return Number.POSITIVE_INFINITY;
	return Math.hypot(a[0] - parsed[0], a[1] - parsed[1], a[2] - parsed[2]);
};

// Eroded central 50% histogram: 4-bit-per-channel buckets; a mode is a
// bucket above 15% of sampled pixels.
export function dominantColour({ image, rect }) {
	const cx = rect.x + rect.width * 0.25;
	const cy = rect.y + rect.height * 0.25;
	const cw = Math.max(1, rect.width * 0.5);
	const ch = Math.max(1, rect.height * 0.5);
	const counts = new Map();
	let samples = 0;
	for (let y = Math.round(cy); y < Math.round(cy + ch); y += 1)
		for (let x = Math.round(cx); x < Math.round(cx + cw); x += 1) {
			if (x < 0 || y < 0 || x >= image.width || y >= image.height) continue;
			const i = (y * image.width + x) * 4;
			const key =
				(image.data[i] >> 4) * 256 +
				(image.data[i + 1] >> 4) * 16 +
				(image.data[i + 2] >> 4);
			counts.set(key, (counts.get(key) ?? 0) + 1);
			samples += 1;
		}
	if (!samples) return null;
	const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
	const modes = ranked.filter(([, count]) => count / samples > 0.15).length;
	const [key] = ranked[0];
	const colour = [
		((key >> 8) & 0xf) * 17,
		((key >> 4) & 0xf) * 17,
		(key & 0xf) * 17,
	];
	return { colour, modes };
}
