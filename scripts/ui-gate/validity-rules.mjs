// UI gate deterministic validity rules (plan-final.md §2.2 R1–R5 + cheap checks).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const SEVERITY_RANK = { info: 0, warning: 1, error: 2 };

export function findingId(rule, matchKey, viewport, state) {
	return createHash("sha256")
		.update(`${rule}\u0000${matchKey}\u0000${viewport}\u0000${state}`)
		.digest("hex")
		.slice(0, 16);
}

function describe(el) {
	return (
		el.anchor ?? (el.testId ? `[testid=${el.testId}]` : `${el.tag}@${el.key}`)
	);
}

function makeFinding(
	rule,
	severity,
	el,
	measured,
	threshold,
	viewport,
	state,
	extra,
) {
	return {
		id: findingId(rule, describe(el), viewport, state),
		rule,
		severity,
		element: { matchKey: describe(el), anchor: el.anchor, tag: el.tag },
		rect: el.rect,
		viewport,
		state,
		measured,
		threshold,
		...extra,
	};
}

function norm(text) {
	return (text ?? "").replace(/\s+/g, " ").trim();
}

function overlapArea(a, b) {
	const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
	const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
	return width > 0 && height > 0 ? width * height : 0;
}

export function isDescendantKey(child, parent) {
	return child.startsWith(`${parent}/`);
}

// R1 clipped-text: horizontal overflow + vertical clipping without truncation intent.
function ruleClippedText(geometry, skip) {
	const findings = [];
	for (const el of geometry.elements) {
		if (skip.has(el.key) || !el.text) continue;
		const horizontal = el.overflow.scrollWidth > el.overflow.clientWidth + 1;
		const vertical =
			el.overflow.scrollHeight > el.overflow.clientHeight + 1 ||
			el.styles.lineClamp !== "none";
		const intent =
			el.styles.textOverflow === "ellipsis" ||
			(el.styles.lineClamp !== "none" &&
				Number.isFinite(Number(el.styles.lineClamp)));
		if (horizontal && vertical && !intent)
			findings.push(
				makeFinding(
					"clipped-text",
					"error",
					el,
					{
						scrollWidth: el.overflow.scrollWidth,
						clientWidth: el.overflow.clientWidth,
					},
					{ clientWidth: el.overflow.clientWidth },
					geometry.viewport.name,
					geometry.state,
				),
			);
	}
	return findings;
}

// R2 interactive-overlap: two interactive elements overlapping >5% of the smaller box.
function ruleInteractiveOverlap(geometry, skip, allowlist) {
	const findings = [];
	const interactive = geometry.elements.filter(
		(el) => el.interactive && !skip.has(el.key),
	);
	for (let i = 0; i < interactive.length; i++) {
		for (let j = i + 1; j < interactive.length; j++) {
			const a = interactive[i];
			const b = interactive[j];
			if (isDescendantKey(b.key, a.key) || isDescendantKey(a.key, b.key)) continue;
			const area = overlapArea(a.rect, b.rect);
			const smaller = Math.min(
				a.rect.width * a.rect.height,
				b.rect.width * b.rect.height,
			);
			if (smaller <= 0 || area / smaller <= 0.05) continue;
			const pair = [describe(a), describe(b)].sort().join("|");
			if (allowlist.some((entry) => entry.pair === pair)) continue;
			findings.push({
				id: findingId(
					"interactive-overlap",
					pair,
					geometry.viewport.name,
					geometry.state,
				),
				rule: "interactive-overlap",
				severity: "error",
				element: { matchKey: describe(a), anchor: a.anchor, tag: a.tag },
				neighbor: { matchKey: describe(b), anchor: b.anchor, tag: b.tag },
				rect: a.rect,
				neighborRect: b.rect,
				viewport: geometry.viewport.name,
				state: geometry.state,
				measured: Math.round((area / smaller) * 1000) / 1000,
				threshold: 0.05,
			});
		}
	}
	return findings;
}

// R3 occluded-content: hit tests say another element covers the control.
function ruleOccludedContent(geometry, skip) {
	const findings = [];
	const known = new Set(geometry.elements.map((el) => el.key));
	for (const el of geometry.elements) {
		if (skip.has(el.key) || !el.hits) continue;
		const covered = (point) =>
			el.hits[point] !== null &&
			el.hits[point] !== el.key &&
			!isDescendantKey(String(el.hits[point]), el.key) &&
			known.has(String(el.hits[point]));
		const center = covered("center");
		const corners = ["tl", "tr", "bl", "br"].filter(covered).length;
		if (center && corners === 4)
			findings.push(
				makeFinding(
					"occluded-content",
					"error",
					el,
					{ corners },
					{ corners: 4 },
					geometry.viewport.name,
					geometry.state,
					{
						occluder: el.hits.center,
					},
				),
			);
		else if (center)
			findings.push(
				makeFinding(
					"occluded-content",
					"warning",
					el,
					{ corners },
					{ corners: 4 },
					geometry.viewport.name,
					geometry.state,
					{
						occluder: el.hits.center,
					},
				),
			);
	}
	const faded = geometry.elements.find(
		(el) => !skip.has(el.key) && el.text && el.effectiveOpacity < 0.1,
	);
	if (faded)
		findings.push(
			makeFinding(
				"occluded-content",
				"warning",
				faded,
				faded.effectiveOpacity,
				{ opacity: 0.1 },
				geometry.viewport.name,
				geometry.state,
				{
					occluder: "ancestor-opacity",
				},
			),
		);
	return findings;
}

// R4 offscreen-essential: anchored/testid element unreachable in the layout.
function ruleOffscreenEssential(geometry, skip) {
	const findings = [];
	const doc = geometry.document;
	const scrollable = doc.scrollHeight > doc.innerHeight + 1;
	for (const el of geometry.elements) {
		if (skip.has(el.key) || !(el.anchor || el.testId)) continue;
		const { x, y, width, height } = el.rect;
		const outsideDocument =
			x > doc.scrollWidth ||
			y > doc.scrollHeight ||
			x + width < 0 ||
			y + height < 0;
		if (outsideDocument)
			findings.push(
				makeFinding(
					"offscreen-essential",
					"error",
					el,
					el.rect,
					{ document: [doc.scrollWidth, doc.scrollHeight] },
					geometry.viewport.name,
					geometry.state,
				),
			);
		else if (
			!scrollable &&
			(y + height < 0 || y > doc.innerHeight) &&
			el.styles.position !== "fixed"
		)
			findings.push(
				makeFinding(
					"offscreen-essential",
					"error",
					el,
					el.rect,
					{ viewportHeight: doc.innerHeight },
					geometry.viewport.name,
					geometry.state,
				),
			);
	}
	return findings;
}

// R5 scroll-trap: content taller than viewport but the root refuses to scroll.
function ruleScrollTrap(geometry) {
	const doc = geometry.document;
	const trapped =
		doc.scrollHeight > doc.innerHeight + 1 &&
		["hidden", "clip"].includes(doc.htmlOverflow) &&
		["hidden", "clip"].includes(doc.bodyOverflow);
	if (trapped)
		return [
			{
				id: findingId(
					"scroll-trap",
					"document",
					geometry.viewport.name,
					geometry.state,
				),
				rule: "scroll-trap",
				severity: "warning",
				element: { matchKey: "document", anchor: null, tag: "HTML" },
				viewport: geometry.viewport.name,
				state: geometry.state,
				measured: { scrollHeight: doc.scrollHeight, innerHeight: doc.innerHeight },
				threshold: { innerHeight: doc.innerHeight },
			},
		];
	return [];
}

function ruleContent(geometry, contentStrings) {
	const findings = [];
	const text = norm(geometry.text);
	for (const expected of contentStrings) {
		if (!text.includes(norm(expected)))
			findings.push({
				id: findingId(
					"content-missing",
					norm(expected),
					geometry.viewport.name,
					geometry.state,
				),
				rule: "content-missing",
				severity: "error",
				element: { matchKey: `text:${norm(expected)}`, anchor: null, tag: "TEXT" },
				viewport: geometry.viewport.name,
				state: geometry.state,
				measured: "absent",
				threshold: norm(expected),
			});
	}
	return findings;
}

// Token snapping (only with tokens.spacing) + near-flush alignment drift.
function ruleTokenAlignment(geometry, skip, spacingTokens) {
	const findings = [];
	const snaps = (gap) =>
		gap <= 1 ||
		spacingTokens.some((token) => {
			const multiples = Math.round(gap / token);
			return multiples >= 1 && Math.abs(gap - multiples * token) <= 1;
		});
	const byParent = new Map();
	for (const el of geometry.elements) {
		if (skip.has(el.key)) continue;
		const group = byParent.get(el.parent) ?? [];
		group.push(el);
		byParent.set(el.parent, group);
	}
	for (const siblings of byParent.values()) {
		siblings.sort((a, b) => a.rect.y - b.rect.y);
		for (let i = 0; i + 1 < siblings.length; i++) {
			const a = siblings[i];
			const b = siblings[i + 1];
			const gap = b.rect.y - (a.rect.y + a.rect.height);
			if (gap > 1 && gap < 24 && !snaps(gap)) {
				findings.push({
					id: findingId(
						"spacing-drift",
						`${describe(a)}|${describe(b)}`,
						geometry.viewport.name,
						geometry.state,
					),
					rule: "spacing-drift",
					severity: "warning",
					element: { matchKey: describe(a), anchor: a.anchor, tag: a.tag },
					neighbor: { matchKey: describe(b), anchor: b.anchor, tag: b.tag },
					rect: a.rect,
					viewport: geometry.viewport.name,
					state: geometry.state,
					measured: gap,
					threshold: 1,
				});
			}
			if (Math.abs(a.rect.x - b.rect.x) <= 1 && gap > 2 && gap < 6) {
				findings.push({
					id: findingId(
						"alignment-drift",
						`${describe(a)}|${describe(b)}`,
						geometry.viewport.name,
						geometry.state,
					),
					rule: "alignment-drift",
					severity: "warning",
					element: { matchKey: describe(a), anchor: a.anchor, tag: a.tag },
					neighbor: { matchKey: describe(b), anchor: b.anchor, tag: b.tag },
					rect: a.rect,
					viewport: geometry.viewport.name,
					state: geometry.state,
					measured: gap,
					threshold: 2,
				});
			}
		}
	}
	return findings;
}

function ruleBaselineDrift(geometry, baseline) {
	const findings = [];
	const previous = new Map(
		(baseline?.elements ?? []).map((el) => [el.anchor ?? el.key, el]),
	);
	for (const el of geometry.elements) {
		const before = previous.get(el.anchor ?? el.key);
		if (!before) continue;
		const moved = Math.max(
			Math.abs(el.rect.x - before.rect.x),
			Math.abs(el.rect.y - before.rect.y),
			Math.abs(el.rect.width - before.rect.width),
			Math.abs(el.rect.height - before.rect.height),
		);
		if (moved > 2)
			findings.push(
				makeFinding(
					"baseline-drift",
					"info",
					el,
					moved,
					{ anyEdge: 2 },
					geometry.viewport.name,
					geometry.state,
					{
						previousRect: before.rect,
					},
				),
			);
	}
	return findings;
}

export function runValidityRules(
	geometry,
	{
		quarantined = [],
		allowlist = [],
		contentStrings = [],
		spacingTokens = null,
		baselineGeometry = null,
	} = {},
) {
	const skip = new Set(quarantined);
	return [
		...ruleClippedText(geometry, skip),
		...ruleInteractiveOverlap(geometry, skip, allowlist),
		...ruleOccludedContent(geometry, skip),
		...ruleOffscreenEssential(geometry, skip),
		...ruleScrollTrap(geometry),
		...ruleContent(geometry, contentStrings),
		...(spacingTokens?.length
			? ruleTokenAlignment(geometry, skip, spacingTokens)
			: []),
		...(baselineGeometry ? ruleBaselineDrift(geometry, baselineGeometry) : []),
	].sort(
		(a, b) =>
			SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
			a.id.localeCompare(b.id),
	);
}

export function loadAllowlist(file) {
	let raw;
	try {
		raw = JSON.parse(readFileSync(file, "utf8"));
	} catch (error) {
		throw new Error(
			`ui-gate allowlist is unreadable (${file}): ${error instanceof Error ? error.message : error}`,
		);
	}
	return raw.entries ?? [];
}
