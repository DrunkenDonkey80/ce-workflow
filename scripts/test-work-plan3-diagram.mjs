import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createJiti } from "jiti";
const { layout } = await createJiti(import.meta.url).import("../extensions/plan3-web/layout.ts");

// Layout (D10) on the two hand-written samples: children inside their group, no unrelated boxes overlap,
// a cycle does not push its first node right, and manual positions win.
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
upload.nodes.find((node) => node.id === "cdn").x = 5000;
assert.equal(layout(upload).get("cdn").x, 5000, "manual position wins");

console.log("ok - plan3 diagram");
