// Layout for Plan3 diagrams (D10, revised): inside every container, children go on a 2D grid whose cells
// minimize connected distance (flow prefers left-to-right, then top-to-bottom), with the grid shape chosen
// for a landscape aspect; groups size to their content. Manual x, y pin a box to the nearest grid cell, so a
// drag reorders the grid instead of dropping a box on top of others. Edges are routed orthogonally
// around boxes by A* over a sparse grid of box-side coordinates, with ports spread along each side.
// Browser asset (D23); node tests import it directly.
import type { Diagram, DiagramNode } from "../plan3-diagram.ts";
export type Box = { x: number; y: number; w: number; h: number };
export type Point = [number, number];
export const NODE = { w: 168, h: 64 };
const GAP = { x: 88, y: 64 }, PAD = 24, TITLE = 32, ASPECT = 1.4;

// Cells for n items on a cols-wide grid: start in flow order, then swap while the weighted distance drops.
function arrange(n: number, cols: number, links: [number, number, number][], order: number[], pinned = new Map<number, number>()) {
	// One spare row gives the swaps room to leave a cell empty where that untangles links.
	const rows = Math.max(Math.ceil(n / cols) + 1, ...[...pinned.values()].map((cell) => Math.floor(cell / cols) + 1));
	const cells = rows * cols, at = new Array(n), who = new Array(cells).fill(-1);
	// Pinned items take their cell (or the nearest free one); the rest fill free cells in order and never swap with pins.
	const distance = (a: number, b: number) => Math.abs(a % cols - b % cols) + Math.abs(Math.floor(a / cols) - Math.floor(b / cols));
	for (const [item, want] of pinned) { const cell = [...who.keys()].filter((k) => who[k] < 0).sort((a, b) => distance(a, want) - distance(b, want) || a - b)[0]; at[item] = cell; who[cell] = item; }
	let free = 0;
	for (const item of order) if (!pinned.has(item)) { while (who[free] >= 0) free++; at[item] = free; who[free] = item; }
	const xy = (item: number) => [at[item] % cols, Math.floor(at[item] / cols)];
	const side = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
	const cost = () => {
		let sum = 0;
		const ends = links.map(([a, b]) => [xy(a), xy(b)]);
		links.forEach(([a, b, w], k) => {
			const [[ca, ra], [cb, rb]] = ends[k];
			sum += w * (Math.abs(ra - rb) + Math.abs(ca - cb) + (cb < ca ? .6 : 0) + (rb < ra ? .3 : 0) + (ra !== rb && ca !== cb ? .4 : 0));
			// A link straight through another box's cell must detour around it.
			for (let item = 0; item < n; item++) if (item !== a && item !== b) { const [c, r] = xy(item); if (!side(ends[k][0], ends[k][1], [c, r]) && c >= Math.min(ca, cb) && c <= Math.max(ca, cb) && r >= Math.min(ra, rb) && r <= Math.max(ra, rb)) sum += 3 * w; }
			// Crossing straight links usually stay crossed after routing.
			for (let other = k + 1; other < links.length; other++) {
				const [p, q] = ends[k], [s, t] = ends[other];
				if (side(p, q, s) * side(p, q, t) < 0 && side(s, t, p) * side(s, t, q) < 0) sum += 2 * Math.min(w, links[other][2]);
			}
		});
		return sum;
	};
	let best = cost();
	for (let improved = true, guard = 0; improved && guard < 50; guard++) {
		improved = false;
		for (let item = 0; item < n; item++) for (let cell = 0; cell < cells; cell++) {
			const from = at[item], other = who[cell];
			if (cell === from || pinned.has(item) || pinned.has(other)) continue;
			at[item] = cell; who[cell] = item; who[from] = other; if (other >= 0) at[other] = from;
			const next = cost();
			if (next < best - 1e-9) { best = next; improved = true; continue; }
			at[item] = from; who[from] = item; who[cell] = other; if (other >= 0) at[other] = cell;
		}
	}
	return { at, cost: best };
}

export function layout(diagram: Pick<Diagram, "nodes" | "edges">, measure = (_node: DiagramNode) => NODE, groupTitle = (_node: DiagramNode) => TITLE) {
	// D8: a resized box keeps its stored width and is never shorter than its content.
	const nodeSize = (node: DiagramNode) => { const size = measure(node); return node.kind === "group" ? size : { w: node.w ?? size.w, h: Math.max(node.h ?? 0, size.h) }; };
	const nodes = diagram.nodes ?? [], byId = new Map(nodes.map((node) => [node.id, node]));
	const children = new Map<string, DiagramNode[]>();
	for (const node of nodes) {
		const parent = byId.has(node.parent) ? node.parent : "";
		children.set(parent, [...(children.get(parent) ?? []), node]);
	}
	// Edge between two descendants, lifted to the direct children of one container.
	const chain = (id) => { const out = []; for (let at = byId.get(id), guard = 0; at && guard < 64; at = byId.get(at.parent), guard++) out.unshift(at.id); return out; };
	const lifted = (container, from, to) => {
		const a = chain(from), b = chain(to), depth = container ? chain(container).length : 0;
		if (container && (a[depth - 1] !== container || b[depth - 1] !== container)) return;
		return a[depth] && b[depth] && a[depth] !== b[depth] ? [a[depth], b[depth]] : undefined;
	};
	// Cell positions; boxes are centered in their cell so row or column neighbors share a straight line.
	const grid = (kids: DiagramNode[], at: number[], cols: number, colW: number[], rowH: number[]) => {
		const colX = [], rowY = [], out = new Map<string, Box>();
		for (let c = 0, x = 0; c < colW.length; c++) { colX[c] = x; if (colW[c]) x += colW[c] + GAP.x; }
		for (let r = 0, y = 0; r < rowH.length; r++) { rowY[r] = y; if (rowH[r]) y += rowH[r] + GAP.y; }
		kids.forEach((kid, i) => {
			const { w, h } = kid.kind === "group" ? boxes.get(kid.id) : nodeSize(kid), r = Math.floor(at[i] / cols), c = at[i] % cols;
			out.set(kid.id, { x: colX[c] + (colW[c] - w) / 2, y: rowY[r] + (rowH[r] - h) / 2, w, h });
		});
		return out;
	};
	const boxes = new Map<string, { x?: number; y?: number; w: number; h: number }>(); // relative to the parent's content origin, then absolute.
	function place(container) {
		const kids = children.get(container) ?? [];
		for (const kid of kids) if (kid.kind === "group") place(kid.id);
		const size = (kid) => (kid.kind === "group" ? boxes.get(kid.id) : nodeSize(kid));
		const index = new Map(kids.map((kid, i) => [kid.id, i]));
		const weights = new Map<string, number>();
		for (const edge of diagram.edges ?? []) {
			const link = lifted(container, edge.from, edge.to); if (!link) continue;
			const key = index.get(link[0]) + " " + index.get(link[1]); weights.set(key, (weights.get(key) ?? 0) + 1);
		}
		const links = [...weights].map(([key, w]) => [...key.split(" ").map(Number), w] as [number, number, number]);
		// Connectivity order: start with the busiest child, then repeatedly the one most tied to those placed.
		const tie = (i: number, set: Set<number>) => links.reduce((sum, [a, b, w]) => sum + (a === i && set.has(b) || b === i && set.has(a) ? w : 0), 0);
		const all = new Set(kids.map((_, i) => i)), order: number[] = [];
		while (order.length < kids.length) {
			const done = new Set(order), rest = [...all].filter((i) => !done.has(i));
			order.push(rest.reduce((best, i) => (order.length ? tie(i, done) : tie(i, all)) > (order.length ? tie(best, done) : tie(best, all)) ? i : best));
		}
		// Candidates: a few grid widths around the target shape, each from several deterministic starts.
		// The winner is judged on its actual routes (crossings, overlaps, bends), not just straight-line proxies.
		const starts = [order, [...order].reverse(), kids.map((_, i) => i), order.filter((_, k) => k % 2 === 0).concat(order.filter((_, k) => k % 2))];
		const area = kids.reduce((total, kid) => total + (size(kid).w + GAP.x) * (size(kid).h + GAP.y), 0);
		const ideal = Math.sqrt(area * ASPECT) / (kids.reduce((total, kid) => total + size(kid).w + GAP.x, 0) / Math.max(1, kids.length));
		// A manual x, y picks the grid cell under it, measured with the average cell size.
		const cellW = kids.reduce((t, kid) => t + size(kid).w, 0) / Math.max(1, kids.length) + GAP.x, cellH = kids.reduce((t, kid) => t + size(kid).h, 0) / Math.max(1, kids.length) + GAP.y;
		const pins = (cols: number) => new Map(kids.flatMap((kid, i) => Number.isFinite(kid.x) && Number.isFinite(kid.y) ? [[i, Math.max(0, Math.round(kid.y / cellH)) * cols + Math.min(cols - 1, Math.max(0, Math.round(kid.x / cellW)))]] : []));
		let chosen;
		const tried = new Set<string>();
		for (let cols = Math.max(1, Math.floor(ideal) - 1); cols <= Math.min(kids.length, Math.ceil(ideal) + 1); cols++) for (const start of starts) {
			const { at } = arrange(kids.length, cols, links, start, pins(cols)), key = cols + ":" + at.join();
			if (tried.has(key)) continue; tried.add(key);
			const colW = [], rowH = [];
			kids.forEach((kid, i) => { const { w, h } = size(kid), r = Math.floor(at[i] / cols), c = at[i] % cols; colW[c] = Math.max(colW[c] ?? 0, w); rowH[r] = Math.max(rowH[r] ?? 0, h); });
			const local = grid(kids, at, cols, colW, rowH);
			const width = Math.max(...[...local.values()].map((b) => b.x + b.w)), height = Math.max(...[...local.values()].map((b) => b.y + b.h));
			const quality = routeQuality(routeEdges(local, links.map(([a, b], k) => ({ id: String(k), from: kids[a].id, to: kids[b].id })), kids.map((kid) => kid.id)));
			const score = 4 * Math.abs(Math.log(width / height / ASPECT)) + quality.crossings + quality.shared / 100 + quality.bends / 4 + quality.length / 2000 + width * height / 2e6;
			if (!chosen || score < chosen.score - 1e-9) chosen = { score, at, cols, colW, rowH };
		}
		if (chosen) for (const [id, box] of grid(kids, chosen.at, chosen.cols, chosen.colW, chosen.rowH)) boxes.set(id, { ...boxes.get(id), ...box });
		let width = 0, height = 0;
		for (const kid of kids) { const box = boxes.get(kid.id); width = Math.max(width, box.x + box.w); height = Math.max(height, box.y + box.h); }
		// D10: a group's stored w, h is a minimum; content still grows it.
		if (container) { const group = byId.get(container); boxes.set(container, { w: Math.max(group.w ?? 0, Math.max(nodeSize(group).w, width) + 2 * PAD), h: Math.max(group.h ?? 0, height + 2 * PAD + groupTitle(group)) }); }
	}
	place("");
	// Relative to absolute: a child's origin is its parent's corner plus padding and title.
	const absolute = new Map<string, Box>();
	const resolve = (id) => {
		if (absolute.has(id)) return absolute.get(id);
		const box = boxes.get(id), parent = byId.get(id)?.parent, base = byId.has(parent) ? resolve(parent) : { x: 0, y: 0 };
		const offset = byId.has(parent) ? { x: PAD, y: PAD + groupTitle(byId.get(parent)) } : { x: 0, y: 0 };
		const result = { x: base.x + offset.x + box.x, y: base.y + offset.y + box.y, w: box.w, h: box.h };
		absolute.set(id, result);
		return result;
	};
	for (const node of nodes) resolve(node.id);
	return absolute;
}

/** Crossings, overlapping run length, bends and length of orthogonal routes (for comparing layouts). */
export function routeQuality(routes: Map<string, Point[]>) {
	const runs = [...routes.values()].map((points) => points.slice(1).map((point, k) => [points[k], point] as [Point, Point]));
	let crossings = 0, shared = 0, bends = 0, length = 0;
	for (const run of runs) { bends += Math.max(0, run.length - 1); for (const [p, q] of run) length += Math.abs(q[0] - p[0]) + Math.abs(q[1] - p[1]); }
	const lo = (a: number, b: number) => Math.min(a, b), hi = (a: number, b: number) => Math.max(a, b);
	for (let i = 0; i < runs.length; i++) for (let j = i + 1; j < runs.length; j++) for (const [p, q] of runs[i]) for (const [s, t] of runs[j]) {
		const ph = p[1] === q[1], sh = s[1] === t[1];
		if (ph !== sh) {
			const [h1, h2, v1, v2] = ph ? [p, q, s, t] : [s, t, p, q];
			if (v1[0] > lo(h1[0], h2[0]) && v1[0] < hi(h1[0], h2[0]) && h1[1] > lo(v1[1], v2[1]) && h1[1] < hi(v1[1], v2[1])) crossings++;
		} else if (ph && p[1] === s[1]) shared += hi(0, lo(hi(p[0], q[0]), hi(s[0], t[0])) - hi(lo(p[0], q[0]), lo(s[0], t[0])));
		else if (!ph && p[0] === s[0]) shared += hi(0, lo(hi(p[1], q[1]), hi(s[1], t[1])) - hi(lo(p[1], q[1]), lo(s[1], t[1])));
	}
	return { crossings, shared, bends, length };
}

const MARGIN = 14, BEND = 60, SHARED = 150, CROSS = 45, LANE = 24;
const inside = (box: Box, x: number, y: number) => x > box.x && x < box.x + box.w && y > box.y && y < box.y + box.h;
/** Orthogonal routes for pairs of boxes; obstacles are never crossed while a route exists. */
export function routeEdges(boxes: Map<string, Box>, pairs: { id: string; from: string; to: string }[], obstacles: string[]) {
	const blocks = obstacles.map((id) => boxes.get(id)).filter(Boolean).map((b) => ({ x: b.x - MARGIN, y: b.y - MARGIN, w: b.w + 2 * MARGIN, h: b.h + 2 * MARGIN }));
	const out = new Map<string, Point[]>(), sides = new Map<string, { pair: number; end: 0 | 1; along: number }[]>();
	const center = (b: Box): Point => [b.x + b.w / 2, b.y + b.h / 2];
	const plan = pairs.map((pair, index) => {
		const a = boxes.get(pair.from), b = boxes.get(pair.to);
		if (!a || !b || pair.from === pair.to) return;
		const gx = Math.max(b.x - a.x - a.w, a.x - b.x - b.w), gy = Math.max(b.y - a.y - a.h, a.y - b.y - b.h);
		if (gx < 0 && gy < 0) return; // nested or overlapping boxes: no meaningful route
		const [ax, ay] = center(a), [bx, by] = center(b);
		const side = gx >= gy ? (bx > ax ? ["r", "l"] : ["l", "r"]) : (by > ay ? ["b", "t"] : ["t", "b"]);
		for (const end of [0, 1] as const) {
			const key = (end ? pair.to : pair.from) + ":" + side[end], other = end ? [ax, ay] : [bx, by];
			sides.set(key, [...(sides.get(key) ?? []), { pair: index, end, along: "lr".includes(side[end]) ? other[1] : other[0] }]);
		}
		return { a, b, side, ports: [] as Point[], stubs: [] as Point[] };
	});
	const normal = { r: [1, 0], l: [-1, 0], b: [0, 1], t: [0, -1] };
	for (const [key, list] of sides) {
		const [id, side] = [key.slice(0, key.lastIndexOf(":")), key.slice(key.lastIndexOf(":") + 1)], box = boxes.get(id);
		list.sort((p, q) => p.along - q.along || p.pair - q.pair);
		list.forEach((item, k) => {
			const t = (k + 1) / (list.length + 1), [nx, ny] = normal[side];
			const port: Point = "lr".includes(side) ? [side === "r" ? box.x + box.w : box.x, Math.round(box.y + box.h * t)] : [Math.round(box.x + box.w * t), side === "b" ? box.y + box.h : box.y];
			plan[item.pair].ports[item.end] = port; plan[item.pair].stubs[item.end] = [port[0] + nx * MARGIN, port[1] + ny * MARGIN];
		});
	}
	const xs = new Set<number>(), ys = new Set<number>();
	for (const b of blocks) { xs.add(b.x); xs.add(b.x + b.w); ys.add(b.y); ys.add(b.y + b.h); }
	for (const item of plan) if (item) for (const [x, y] of item.stubs) { xs.add(x); ys.add(y); }
	// Lanes every LANE px through each gap, so parallel routes run side by side instead of on top of each other.
	const withMiddles = (set: Set<number>) => {
		const list = [...set].sort((a, b) => a - b);
		for (let i = 1; i < list.length; i++) { const gap = list[i] - list[i - 1], count = Math.floor(gap / LANE) - 1; for (let k = 1; k <= count; k++) set.add(Math.round(list[i - 1] + gap * k / (count + 1))); }
		return [...set].sort((a, b) => a - b);
	};
	const X = withMiddles(xs), Y = withMiddles(ys), NX = X.length, NY = Y.length;
	const freePoint = new Map<number, boolean>(), freeMove = new Map<number, boolean>();
	const pointOk = (i: number, j: number) => { const key = i * NY + j; let ok = freePoint.get(key); if (ok === undefined) { ok = !blocks.some((b) => inside(b, X[i], Y[j])); freePoint.set(key, ok); } return ok; };
	const moveOk = (i: number, j: number, d: number) => {
		const key = (i * NY + j) * 4 + d; let ok = freeMove.get(key);
		if (ok === undefined) { const [ni, nj] = step(i, j, d), mx = (X[i] + X[ni]) / 2, my = (Y[j] + Y[nj]) / 2; ok = !blocks.some((b) => inside(b, mx, my)); freeMove.set(key, ok); }
		return ok;
	};
	const step = (i: number, j: number, d: number) => [i + (d === 0 ? 1 : d === 1 ? -1 : 0), j + (d === 2 ? 1 : d === 3 ? -1 : 0)];
	const used = new Map<number, number>(), axes = new Map<number, number>(), dirOf = { r: 0, l: 1, b: 2, t: 3 };
	plan.forEach((item, index) => {
		if (!item) return;
		const [s, g] = item.stubs, si = X.indexOf(s[0]), sj = Y.indexOf(s[1]), gi = X.indexOf(g[0]), gj = Y.indexOf(g[1]);
		const startDir = dirOf[item.side[0]], endDir = dirOf[item.side[1]] ^ 1, total = NX * NY * 4;
		const cost = new Float64Array(total).fill(Infinity), parent = new Int32Array(total).fill(-1), heap: number[][] = [];
		const push = (f: number, state: number) => { heap.push([f, state]); for (let k = heap.length - 1; k > 0;) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
		const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; for (let k = 0; ;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top; };
		const h = (i: number, j: number) => Math.abs(X[i] - X[gi]) + Math.abs(Y[j] - Y[gj]);
		const start = (si * NY + sj) * 4 + startDir; cost[start] = 0; push(h(si, sj), start);
		let found = -1;
		while (heap.length) {
			const [, state] = pop(), d = state & 3, cell = state >> 2, i = Math.floor(cell / NY), j = cell % NY;
			if (i === gi && j === gj) { found = state; break; }
			for (let nd = 0; nd < 4; nd++) {
				if (nd === (d ^ 1)) continue;
				const [ni, nj] = step(i, j, nd);
				if (ni < 0 || nj < 0 || ni >= NX || nj >= NY || !moveOk(i, j, nd) || !pointOk(ni, nj)) continue;
				const segment = Math.min(cell, ni * NY + nj) * 2 + (nd < 2 ? 0 : 1);
				let next = cost[state] + Math.abs(X[ni] - X[i]) + Math.abs(Y[nj] - Y[j]) + (nd === d ? 0 : BEND) + SHARED * (used.get(segment) ?? 0) + ((axes.get(ni * NY + nj) ?? 0) & (nd < 2 ? 2 : 1) ? CROSS : 0);
				if (ni === gi && nj === gj && nd !== endDir) next += BEND;
				const target = (ni * NY + nj) * 4 + nd;
				if (next < cost[target]) { cost[target] = next; parent[target] = state; push(next + h(ni, nj), target); }
			}
		}
		const points: Point[] = [item.ports[1]];
		if (found < 0) points.push(g, s);
		else for (let state = found, previous = -1; state >= 0; previous = state >> 2, state = parent[state]) {
			const cell = state >> 2, i = Math.floor(cell / NY), j = cell % NY;
			if (previous >= 0) {
				const vertical = Math.floor(previous / NY) === i, segment = Math.min(cell, previous) * 2 + (vertical ? 1 : 0);
				used.set(segment, (used.get(segment) ?? 0) + 1);
				for (const point of [cell, previous]) axes.set(point, (axes.get(point) ?? 0) | (vertical ? 2 : 1));
			}
			points.push([X[i], Y[j]]);
		}
		points.push(item.ports[0]); points.reverse();
		// Drop collinear points so Rough.js draws one stroke per straight run.
		out.set(pairs[index].id, points.filter((p, k) => k === 0 || k === points.length - 1 || !((points[k - 1][0] === p[0] && p[0] === points[k + 1][0]) || (points[k - 1][1] === p[1] && p[1] === points[k + 1][1]))));
	});
	return out;
}
