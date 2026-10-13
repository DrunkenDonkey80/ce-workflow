import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, readdir, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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

const { validateDiagram, diagramPath, loadDiagram, emptyDiagram, saveDiagram, DIAGRAM_BYTES } = await createJiti(import.meta.url).import("../extensions/plan3-diagram.ts");
for (const name of ["upload-service", "ce-workflow"]) {
 const sample = JSON.parse(readFileSync(new URL(`./fixtures/diagrams/${name}.diagram.json`, import.meta.url), "utf8"));
 assert.equal(validateDiagram(sample), sample);
}
const product = { kind: "product" }, base = emptyDiagram(product);
const node = { id: "api", label: "API", kind: "service" };
for (const bad of [
 { ...base, version: 2 }, { ...base, kind: ["product"] }, { ...base, revision: -1 }, { ...base, title: "" },
 { ...base, nodes: [node, node] }, { ...base, nodes: [{ ...node, id: "bad-id" }] },
 { ...base, nodes: [{ ...node, kind: ["service"] }] }, { ...base, nodes: [{ ...node, parent: "missing" }] },
 { ...base, nodes: [{ ...node, status: "changed" }] }, { ...base, nodes: [{ ...node, x: NaN }] },
 { ...base, nodes: [{ ...node, summary: "x".repeat(20_001) }] },
 { ...base, edges: [{ id: "edge", from: "missing", to: "missing" }] },
 { ...base, nodes: [{ id: "one", label: "One", kind: "group", parent: "two" }, { id: "two", label: "Two", kind: "group", parent: "one" }] },
 { ...base, notes: [{ id: "note_1", text: "Why?", author: "user", created: "2026-10-13", target: "missing" }] },
 { ...base, notes: [{ id: "note_1", text: "Why?", author: "user", created: "2026-10-13" }] },
 { ...base, nodes: Array.from({ length: 1001 }, (_, i) => ({ ...node, id: `node_${i}` })) },
]) assert.throws(() => validateDiagram(bad));
const dir = await mkdtemp(path.join(os.tmpdir(), "plan3-diagram-test-"));
try {
 const planFile = path.join(dir, "docs", "plans", "sample-12345678-plan3.md");
 await mkdir(path.dirname(planFile), { recursive: true });
 await writeFile(planFile, "---\nplan3: true\n---\n\n# Sample\n");
 const target = { kind: "plan", plan: { id: "12345678", file: planFile, title: "Sample" } };
 assert.equal(diagramPath(dir, target), planFile.replace(/\.md$/, ".diagram.json"));
 assert.equal(loadDiagram(dir, target), undefined);
 const seeded = emptyDiagram(target, { ...base, nodes: [node] });
 assert.equal(seeded.nodes[0].status, "existing");
 const saved = await saveDiagram(dir, target, seeded, 0);
 assert.equal(saved.revision, 1);
 assert.deepEqual(loadDiagram(dir, target), saved);
 const parallel = await Promise.allSettled([saveDiagram(dir, target, saved, 1), saveDiagram(dir, target, saved, 1)]);
 assert.equal(parallel.filter(result => result.status === "fulfilled").length, 1);
 assert.match(parallel.find(result => result.status === "rejected").reason.message, /Stale/);
 assert.equal(loadDiagram(dir, target).revision, 2);
 await assert.rejects(saveDiagram(dir, target, { ...seeded, edges: [{ id: "bad", from: "api", to: "missing" }] }, 2), /Dangling/);
 assert.equal(loadDiagram(dir, target).revision, 2, "failed validation never damages saved data");
 assert(!(await readdir(path.dirname(planFile))).some(file => file.endsWith(".tmp")));
 await assert.rejects(saveDiagram(dir, target, base, 2), /target mismatch/);
 assert.throws(() => diagramPath(dir, { kind: "plan", plan: { ...target.plan, file: path.join(dir, "outside.md") } }), /owner/);
 await writeFile(diagramPath(dir, target), " ".repeat(DIAGRAM_BYTES + 1));
 assert.throws(() => loadDiagram(dir, target), /bounded/);
 const outside = path.join(dir, "external");
 await mkdir(outside);
 await mkdir(path.join(dir, "docs", "architecture"), { recursive: true });
 await symlink(outside, path.join(dir, "docs", "architecture", "product.diagram.json"), process.platform === "win32" ? "junction" : "dir");
 assert.throws(() => diagramPath(dir, product), /symlink/);
} finally { await rm(dir, { recursive: true, force: true }); }
console.log("ok - plan3 diagram validation, persistence and layout");
