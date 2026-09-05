// UI gate fidelity matcher (plan-final.md §2.3): anchor-first matching,
// per-element acceptance, measured validateDesignFidelityEvidence fields.
import { findingId, isDescendantKey } from "./validity-rules.mjs";

const ROLE_COLORS_MAX_DISTANCE = 96;

function norm(text) {
	return (text ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

function iou(a, b) {
	const x = Math.max(a.x, b.x);
	const y = Math.max(a.y, b.y);
	const right = Math.min(a.x + a.width, b.x + b.width);
	const bottom = Math.min(a.y + a.height, b.y + b.height);
	const intersection = right > x && bottom > y ? (right - x) * (bottom - y) : 0;
	const union =
		a.width * a.height + b.width * b.height - intersection;
	return union > 0 ? intersection / union : 0;
}

function overlapArea(a, b) {
	const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
	const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
	return width > 0 && height > 0 ? width * height : 0;
}

function hexToRgb(hex) {
	const value = hex.replace("#", "");
	if (!/^[0-9a-f]{6}$/i.test(value)) return null;
	return [
		parseInt(value.slice(0, 2), 16),
		parseInt(value.slice(2, 4), 16),
		parseInt(value.slice(4, 6), 16),
	];
}

function colorDistance(left, right) {
	const a = hexToRgb(left);
	const b = hexToRgb(right);
	if (!a || !b) return Number.POSITIVE_INFINITY;
	return Math.sqrt(
		a.reduce((sum, channel, index) => sum + (channel - b[index]) ** 2, 0),
	);
}

function nearestToken(color, tokens) {
	let best = null;
	let bestDistance = Number.POSITIVE_INFINITY;
	for (const token of tokens) {
		const distance = colorDistance(color, token.value);
		if (distance < bestDistance) {
			bestDistance = distance;
			best = token;
		}
	}
	return bestDistance <= ROLE_COLORS_MAX_DISTANCE ? best : null;
}

// Relative luminance contrast ratio (WCAG).
function contrastRatio(foreground, background) {
	const a = hexToRgb(foreground);
	const b = hexToRgb(background);
	if (!a || !b) return null;
	const channel = (value) => {
		const scaled = value / 255;
		return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
	};
	const lum = ([r, g, bl]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(bl);
	const lumA = lum(a);
	const lumB = lum(b);
	return (Math.max(lumA, lumB) + 0.05) / (Math.min(lumA, lumB) + 0.05);
}

function effectiveBackground(element, byKey) {
	let node = element;
	while (node) {
		if (node.styles.backgroundColor !== "transparent")
			return node.styles.backgroundColor;
		node = byKey.get(node.parent);
	}
	return "#ffffff";
}

function matchPairs(spec, actual) {
	const pairs = [];
	const usedSpec = new Set();
	const usedActual = new Set();
	const specAnchors = new Map(
		spec.elements.filter((el) => el.anchor).map((el) => [el.anchor, el]),
	);
	for (const element of actual.elements) {
		const match = element.anchor ? specAnchors.get(element.anchor) : null;
		if (match) {
			pairs.push({ spec: match, actual: element, method: "anchor" });
			usedSpec.add(match.key);
			usedActual.add(element.key);
		}
	}
	const cascade = [
		(specEl, actualEl) => norm(specEl.text) && norm(specEl.text) === norm(actualEl.text),
		(specEl, actualEl) =>
			norm(specEl.text) &&
			norm(specEl.text).length > 2 &&
			(norm(specEl.text).includes(norm(actualEl.text)) ||
				norm(actualEl.text).includes(norm(specEl.text))),
		(specEl, actualEl) =>
			specEl.interactive &&
			actualEl.interactive &&
			specEl.tag === actualEl.tag &&
			specEl.role === actualEl.role,
	];
	const specPool = () => spec.elements.filter((el) => !usedSpec.has(el.key) && el.text);
	const actualPool = () => actual.elements.filter((el) => !usedActual.has(el.key) && el.text);
	for (const matches of cascade) {
		for (const element of actualPool()) {
			const candidates = specPool().filter((specEl) => matches(specEl, element));
			if (candidates.length === 1) {
				pairs.push({ spec: candidates[0], actual: element, method: "text" });
				usedSpec.add(candidates[0].key);
				usedActual.add(element.key);
			}
		}
	}
	// Greedy IoU tie-break for leftovers among interactive elements.
	const specLeft = specPool().filter((el) => el.interactive);
	const actualLeft = actualPool().filter((el) => el.interactive);
	const greedy = [];
	for (const element of actualLeft)
		for (const specEl of specLeft) {
			const score = iou(
				{ ...specEl.rect, x: specEl.rect.x * (actual.viewport.width / spec.viewport.width) },
				element.rect,
			);
			if (score > 0) greedy.push({ score, spec: specEl, actual: element });
		}
	greedy
		.sort((a, b) => b.score - a.score)
		.forEach((candidate) => {
			if (!usedSpec.has(candidate.spec.key) && !usedActual.has(candidate.actual.key)) {
				pairs.push({ spec: candidate.spec, actual: candidate.actual, method: "iou" });
				usedSpec.add(candidate.spec.key);
				usedActual.add(candidate.actual.key);
			}
		});
	return { pairs, usedSpec, usedActual };
}

function regionFor(element, regionAnchors) {
	let best = null;
	for (const region of regionAnchors) {
		if (region === element) continue;
		const contains =
			region.rect.x <= element.rect.x &&
			region.rect.y <= element.rect.y &&
			region.rect.x + region.rect.width >= element.rect.x + element.rect.width &&
			region.rect.y + region.rect.height >= element.rect.y + element.rect.height;
		if (contains && (!best || region.rect.width * region.rect.height < best.rect.width * best.rect.height))
			best = region;
	}
	return best;
}

export function matchFidelity({ spec, actual, handoff = {}, layoutAssertions = [] }) {
	const viewport = actual.viewport.name;
	const scale = actual.viewport.width / spec.viewport.width;
	const roleColors = handoff.direction?.roleColors ?? [];
	const requiredRegions = handoff.screens?.flatMap((screen) => screen.requiredRegions ?? []) ?? [];
	const findings = [];
	const geometryDeltas = [];
	const typographyDeltas = [];

	// Region checks (plan R12): requiredRegions presence + non-overlap in the
	// actual capture; also the fallback tier when the spec carries no anchors.
	const regionElements = requiredRegions
		.map((name) => ({ name, element: actual.elements.find((el) => el.anchor === name) }))
		.filter((entry) => entry.element);
	for (const name of requiredRegions)
		if (!regionElements.some((entry) => entry.name === name))
			findings.push({
				id: findingId("region-missing", name, viewport, actual.state),
				rule: "region-missing",
				severity: "error",
				element: { matchKey: name, anchor: name, tag: "REGION" },
				rect: { x: 0, y: 0, width: 0, height: 0 },
				viewport,
				state: actual.state,
				measured: "absent",
				threshold: "present",
			});
	for (let i = 0; i < regionElements.length; i++)
		for (let j = i + 1; j < regionElements.length; j++) {
			const first = regionElements[i].element;
			const second = regionElements[j].element;
			// Nested regions (title inside its screen, equals inside keypad) are
			// legitimate containment, not overlap.
			if (
				isDescendantKey(second.key, first.key) ||
				isDescendantKey(first.key, second.key)
			)
				continue;
			const a = first.rect;
			const b = second.rect;
			const area = overlapArea(a, b);
			const smaller = Math.min(a.width * a.height, b.width * b.height);
			if (smaller > 0 && area / smaller > 0.25)
				findings.push({
					id: findingId("region-overlap", `${regionElements[i].name}|${regionElements[j].name}`, viewport, actual.state),
					rule: "region-overlap",
					severity: "error",
					element: { matchKey: regionElements[i].name, anchor: regionElements[i].name, tag: "REGION" },
					rect: a,
					viewport,
					state: actual.state,
					measured: Math.round((area / smaller) * 1000) / 1000,
					threshold: 0.25,
				});
		}

	const specHasAnchors = spec.elements.some((el) => el.anchor);
	const matched =
		specHasAnchors || requiredRegions.length === 0
			? matchPairs(spec, actual)
			: { pairs: [], usedSpec: new Set() };
	const pairs = matched.pairs;
	const usedSpec = matched.usedSpec;
	const regionAnchors = regionElements.map((entry) => entry.element);

	const specOrder = new Map(spec.elements.map((el, index) => [el.key, index]));
	const actualOrder = new Map(actual.elements.map((el, index) => [el.key, index]));
	const ordered = pairs
		.filter((pair) => specOrder.has(pair.spec.key) && actualOrder.has(pair.actual.key))
		.sort((a, b) => specOrder.get(a.spec.key) - specOrder.get(b.spec.key));
	for (let i = 0; i + 1 < ordered.length; i++)
		if (actualOrder.get(ordered[i].actual.key) > actualOrder.get(ordered[i + 1].actual.key)) {
			const a = ordered[i];
			const b = ordered[i + 1];
			findings.push({
				id: findingId("ordering-violation", `${a.spec.anchor ?? a.spec.key}|${b.spec.anchor ?? b.spec.key}`, viewport, actual.state),
				rule: "ordering-violation",
				severity: "warning",
				element: { matchKey: a.spec.anchor ?? a.spec.key, anchor: a.spec.anchor, tag: a.actual.tag },
				rect: a.actual.rect,
				viewport,
				state: actual.state,
				measured: "inverted",
				threshold: "spec order",
			});
			break;
		}

	for (const pair of pairs) {
		const { spec: specEl, actual: actualEl } = pair;
		const scaled = {
			x: specEl.rect.x * scale,
			y: specEl.rect.y * scale,
			width: specEl.rect.width * scale,
			height: specEl.rect.height * scale,
		};
		const region = regionFor(actualEl, regionAnchors);
		const specRegion = regionFor(specEl, spec.elements.filter((el) => requiredRegions.includes(el.anchor)));
		const dy =
			actualEl.rect.y - (region ? region.rect.y : 0) - (specEl.rect.y - (specRegion ? specRegion.rect.y : 0)) * scale;
		const dx = actualEl.rect.x - scaled.x;
		const offset = Math.max(Math.abs(dx), Math.abs(dy));
		const limit = Math.max(4, 0.02 * actual.viewport.width);
		const normalized = Math.round((offset / actual.viewport.width) * 10000) / 10000;
		geometryDeltas.push(normalized);
		if (offset > limit)
			findings.push({
				id: findingId("position-drift", actualEl.anchor ?? actualEl.key, viewport, actual.state),
				rule: "position-drift",
				severity: normalized > 0.15 ? "error" : "warning",
				element: { matchKey: actualEl.anchor ?? actualEl.key, anchor: actualEl.anchor, tag: actualEl.tag },
				rect: actualEl.rect,
				specRect: specEl.rect,
				viewport,
				state: actual.state,
				measured: normalized,
				threshold: Math.round((limit / actual.viewport.width) * 10000) / 10000,
				matchMethod: pair.method,
			});
		const widthRatio = scaled.width > 1 ? actualEl.rect.width / scaled.width : 1;
		const heightRatio = scaled.height > 1 ? actualEl.rect.height / scaled.height : 1;
		const sizeDrift = Math.max(Math.abs(1 - widthRatio), Math.abs(1 - heightRatio));
		geometryDeltas.push(Math.round(sizeDrift * 10000) / 10000);
		if (sizeDrift > 0.15)
			findings.push({
				id: findingId("size-drift", actualEl.anchor ?? actualEl.key, viewport, actual.state),
				rule: "size-drift",
				severity: "warning",
				element: { matchKey: actualEl.anchor ?? actualEl.key, anchor: actualEl.anchor, tag: actualEl.tag },
				rect: actualEl.rect,
				specRect: specEl.rect,
				viewport,
				state: actual.state,
				measured: Math.round(sizeDrift * 10000) / 10000,
				threshold: 0.15,
				matchMethod: pair.method,
			});
		if (specEl.text && actualEl.text) {
			const fontSizeDrift = Math.abs(1 - actualEl.styles.fontSize / (specEl.styles.fontSize || 1));
			if (Number.isFinite(fontSizeDrift)) {
				typographyDeltas.push(Math.round(fontSizeDrift * 10000) / 10000);
				if (fontSizeDrift > 0.15)
					findings.push({
						id: findingId("typography-drift", actualEl.anchor ?? actualEl.key, viewport, actual.state),
						rule: "typography-drift",
						severity: "warning",
						element: { matchKey: actualEl.anchor ?? actualEl.key, anchor: actualEl.anchor, tag: actualEl.tag },
						rect: actualEl.rect,
						viewport,
						state: actual.state,
						measured: Math.round(fontSizeDrift * 10000) / 10000,
						threshold: 0.15,
					});
			}
		}
		if (roleColors.length) {
			const actualToken = nearestToken(actualEl.styles.color, roleColors);
			const specToken = nearestToken(specEl.styles.color, roleColors);
			if (actualToken && specToken && actualToken.name !== specToken.name)
				findings.push({
					id: findingId("color-token-mismatch", actualEl.anchor ?? actualEl.key, viewport, actual.state),
					rule: "color-token-mismatch",
					severity: "warning",
					element: { matchKey: actualEl.anchor ?? actualEl.key, anchor: actualEl.anchor, tag: actualEl.tag },
					rect: actualEl.rect,
					viewport,
					state: actual.state,
					measured: actualToken.name,
					threshold: specToken.name,
				});
		}
	}

	for (const specEl of spec.elements.filter((el) => el.anchor && !usedSpec.has(el.key)))
		findings.push({
			id: findingId("anchor-missing", specEl.anchor, viewport, actual.state),
			rule: "anchor-missing",
			severity: "warning",
			element: { matchKey: specEl.anchor, anchor: specEl.anchor, tag: specEl.tag },
			rect: specEl.rect,
			viewport,
			state: actual.state,
			measured: "absent",
			threshold: "present",
		});

	for (const assertion of layoutAssertions) {
		const match = /^(\S+)\s+(above|below|left-of|right-of)\s+(\S+)$/.exec(assertion.trim());
		if (!match) continue;
		const [, leftName, relation, rightName] = match;
		const find = (name) =>
			actual.elements.find(
				(el) => el.anchor === name || el.tag === name || norm(el.text) === norm(name),
			);
		const left = find(leftName);
		const right = find(rightName);
		const holds =
			left && right &&
			((relation === "above" && left.rect.y + left.rect.height <= right.rect.y + 2) ||
				(relation === "below" && right.rect.y + right.rect.height <= left.rect.y + 2) ||
				(relation === "left-of" && left.rect.x + left.rect.width <= right.rect.x + 2) ||
				(relation === "right-of" && right.rect.x + right.rect.width <= left.rect.x + 2));
		if (!holds)
			findings.push({
				id: findingId("layout-assertion", assertion.trim(), viewport, actual.state),
				rule: "layout-assertion",
				severity: "warning",
				element: { matchKey: assertion.trim(), anchor: null, tag: "ASSERTION" },
				rect: left?.rect ?? { x: 0, y: 0, width: 0, height: 0 },
				viewport,
				state: actual.state,
				measured: left && right ? false : "unresolved",
				threshold: true,
			});
	}

	const byKey = new Map(actual.elements.map((el) => [el.key, el]));
	const contrastOk = actual.elements
		.filter((el) => el.text && el.styles.color !== "transparent")
		.every((el) => {
			const background = effectiveBackground(el, byKey);
			const ratio = contrastRatio(el.styles.color, background);
			if (ratio === null) return true;
			const large = el.styles.fontSize >= 24 || Number(el.styles.fontWeight) >= 700;
			return ratio >= (large ? 3 : 4.5);
		});

	return {
		findings,
		evidence: {
			geometryDeltas: geometryDeltas.filter((delta) => delta > 0),
			typographyDeltas: typographyDeltas.filter((delta) => delta > 0),
			regions: regionAnchors.map((el) => el.anchor),
			responsive: {
				noHorizontalOverflow:
					actual.document.scrollWidth <= actual.document.innerWidth + 1,
				contrast: contrastOk,
				visibleFocus: actual.document.focusVisible === true,
			},
			matchedPairs: pairs.length,
		},
	};
}
