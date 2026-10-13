// Layered layout for Plan3 diagrams (D10): inside every container, rank children by the edges between them
// (longest path, left to right), stack each rank vertically; groups size to their content. Manual x, y win.
// Browser asset (D23); node tests import it directly.
export const NODE = { w: 168, h: 64 };
const GAP = { x: 72, y: 32 }, PAD = 24, TITLE = 32;

export function layout(diagram) {
	const nodes = diagram.nodes ?? [], byId = new Map(nodes.map((node) => [node.id, node]));
	const children = new Map();
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
	const boxes = new Map(); // id -> { x, y, w, h } relative to the parent's content origin, then absolute.
	function place(container) {
		const kids = children.get(container) ?? [];
		for (const kid of kids) if (kid.kind === "group") place(kid.id);
		const size = (kid) => (kid.kind === "group" ? boxes.get(kid.id) : NODE);
		const all = (diagram.edges ?? []).map((edge) => lifted(container, edge.from, edge.to)).filter(Boolean);
		// Drop DFS back edges (in node order) so a cycle does not push its first node to the far right.
		const state = new Map(), back = new Set();
		const visit = (id) => {
			state.set(id, 1);
			for (const link of all) if (link[0] === id) { const s = state.get(link[1]); if (s === 1) back.add(link); else if (!s) visit(link[1]); }
			state.set(id, 2);
		};
		for (const kid of kids) if (!state.get(kid.id)) visit(kid.id);
		const links = all.filter((link) => !back.has(link));
		const rank = new Map(kids.map((kid) => [kid.id, 0]));
		for (let pass = 0; pass < kids.length; pass++) {
			let moved = false;
			for (const [from, to] of links) if (rank.get(to) < rank.get(from) + 1) { rank.set(to, rank.get(from) + 1); moved = true; }
			if (!moved) break;
		}
		let x = 0, width = 0, height = 0;
		for (let r = 0; r <= Math.max(-1, ...rank.values()); r++) {
			const column = kids.filter((kid) => rank.get(kid.id) === r);
			if (!column.length) continue;
			let y = 0, columnWidth = 0;
			for (const kid of column) {
				const { w, h } = size(kid);
				boxes.set(kid.id, { ...boxes.get(kid.id), x: Number.isFinite(kid.x) ? kid.x : x, y: Number.isFinite(kid.y) ? kid.y : y, w, h });
				y += h + GAP.y; columnWidth = Math.max(columnWidth, w);
			}
			x += columnWidth + GAP.x;
		}
		for (const kid of kids) { const box = boxes.get(kid.id); width = Math.max(width, box.x + box.w); height = Math.max(height, box.y + box.h); }
		if (container) boxes.set(container, { w: Math.max(NODE.w, width) + 2 * PAD, h: height + 2 * PAD + TITLE });
	}
	place("");
	// Relative to absolute: a child's origin is its parent's corner plus padding and title.
	const absolute = new Map();
	const resolve = (id) => {
		if (absolute.has(id)) return absolute.get(id);
		const box = boxes.get(id), parent = byId.get(id)?.parent, base = byId.has(parent) ? resolve(parent) : { x: 0, y: 0 };
		const offset = byId.has(parent) ? { x: PAD, y: PAD + TITLE } : { x: 0, y: 0 };
		const result = { x: base.x + offset.x + box.x, y: base.y + offset.y + box.y, w: box.w, h: box.h };
		absolute.set(id, result);
		return result;
	};
	for (const node of nodes) resolve(node.id);
	return absolute;
}
