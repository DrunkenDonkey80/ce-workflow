// Diagram layout (D10, moved from ce-workflow in plan 0db155f7 H9-01) on the two hand-written samples.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { layout } from "../web/layout.ts";

// Layout (D10) on the two hand-written samples: children inside their group, no unrelated boxes overlap,
// a cycle does not push its first node right, and a manual position pins its box to the nearest grid cell.
for (const name of ["upload-service", "ce-workflow"]) {
	const diagram = JSON.parse(readFileSync(new URL(`./fixtures/diagrams/${name}.diagram.json`, import.meta.url), "utf8"));
	const boxes = layout(diagram), byId = new Map(diagram.nodes.map((node) => [node.id, node]));
	assert.equal(boxes.size, diagram.nodes.length, name);
	const within = (child, parent) => child.x >= parent.x && child.y >= parent.y && child.x + child.w <= parent.x + parent.w && child.y + child.h <= parent.y + parent.h;
	const descends = (id, ancestor) => { for (let node = byId.get(id); node; node = byId.get(node.parent)) if (node.parent === ancestor) return true; return false; };
	for (const node of diagram.nodes) if (node.parent) assert(within(boxes.get(node.id), boxes.get(node.parent)), `${name}: ${node.id} inside ${node.parent}`);
	for (const [a, p] of boxes) for (const [b, q] of boxes) {
		if (a >= b || descends(a, b) || descends(b, a)) continue;
		assert(!(p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h), `${name}: ${a} overlaps ${b}`);
	}
}
const upload = JSON.parse(readFileSync(new URL("./fixtures/diagrams/upload-service.diagram.json", import.meta.url), "utf8"));
assert.equal(layout(upload).get("web_client").x, 0, "cycle web_client -> ... -> cdn -> web_client keeps web_client first");
Object.assign(upload.nodes.find((node) => node.id === "cdn"), { x: 5000, y: 0 });
// H-01: on the open canvas a dragged box stays exactly where it was dropped; inside a group a pin only picks a grid cell.
Object.assign(upload.nodes.find((node) => node.id === "upload_api"), { x: 5000, y: 0 });
const pinned = layout(upload), cdn = pinned.get("cdn"), api = pinned.get("upload_api"), backend = pinned.get("backend");
assert.deepEqual([cdn.x, cdn.y], [5000, 0], "top-level pin is exact");
assert(api.x + api.w <= backend.x + backend.w && api.y >= backend.y, "a pin inside a group snaps into the group");
for (const [id, box] of pinned) if (id !== "cdn") assert(!(box.x < cdn.x + cdn.w && cdn.x < box.x + box.w && box.y < cdn.y + cdn.h && cdn.y < box.y + box.h), `pinned cdn overlaps ${id}`);
// D8: a resized box keeps its width and is never shorter than its content. D10: a group's w/h is a minimum size.
{
	const sized = structuredClone(upload); Object.assign(sized.nodes.find((node) => node.id === "worker"), { w: 360, h: 30 });
	const box = layout(sized).get("worker");
	assert.equal(box.w, 360); assert.equal(box.h, layout(upload).get("worker").h, "height never below content");
	Object.assign(sized.nodes.find((node) => node.id === "worker"), { h: 400 }); assert.equal(layout(sized).get("worker").h, 400);
	const grown = { nodes: [{ id: "g", label: "G", kind: "group", w: 900, h: 700 }, { id: "a", label: "A", kind: "service", parent: "g" }], edges: [] };
	assert.deepEqual([layout(grown).get("g").w, layout(grown).get("g").h], [900, 700], "a group keeps its stored size");
	Object.assign(grown.nodes[0], { w: 120, h: 60 }); assert(layout(grown).get("g").w > 120 && layout(grown).get("g").h > 60, "content still grows a small group");
}
console.log("ok - diagram layout");
