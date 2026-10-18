import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, readdir, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createJiti } from "jiti";
import { spawn } from "node:child_process";
const { layout } = await createJiti(import.meta.url).import("../extensions/plan3-web/layout.ts");

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

const { validateDiagram, diagramPath, loadDiagram, emptyDiagram, saveDiagram, applyDiagramOperations, applyDiagram, diagramDependents, DIAGRAM_BYTES } = await createJiti(import.meta.url).import("../extensions/plan3-diagram.ts");
const { movePlanWithDiagram } = await createJiti(import.meta.url).import("../extensions/plan3-design.ts");
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
 // Editing fields: edit marks, group colors, box sizes, directions.
 { ...base, nodes: [{ ...node, edit: "pending" }] }, { ...base, nodes: [{ ...node, color: 2 }] },
 { ...base, nodes: [{ id: "g", label: "G", kind: "group", color: 8 }] }, { ...base, nodes: [{ id: "g", label: "G", kind: "group", color: 1.5 }] },
 { ...base, nodes: [{ id: "g", label: "G", kind: "group", w: 119 }] }, { ...base, nodes: [{ ...node, w: 119 }] }, { ...base, nodes: [{ ...node, h: 1201 }] },
 { ...base, directions: "" }, { ...base, directions: "x".repeat(8001) },
]) assert.throws(() => validateDiagram(bad));
for (const good of [
 { ...base, directions: "Draw the modules" }, { ...base, nodes: [{ id: "g", label: "G", kind: "group", w: 600, h: 400 }] },
 { ...base, nodes: [{ id: "g", label: "G", kind: "group", color: 7, edit: "add" }, { ...node, parent: "g", w: 120, h: 1200, edit: "change" }], edges: [{ id: "e", from: "g", to: "api", edit: "remove" }] },
]) assert.equal(validateDiagram(good), good);
const built = applyDiagramOperations(base, [
 { op: "add", entity: "node", value: { id: "backend", label: "Backend", kind: "group" } },
 { op: "add", entity: "node", value: { ...node, parent: "backend" } },
 { op: "add", entity: "node", value: { id: "store", label: "Store", kind: "store" } },
 { op: "add", entity: "edge", value: { from: "api", to: "store" } },
 { op: "add", entity: "note", value: { target: "api", text: "Size limit?", author: "user", created: "2026-10-13" } },
]).diagram;
assert.equal(built.edges[0].id, "api__store");
assert.equal(built.notes[0].id, "note_1");
assert.deepEqual(diagramDependents(built, ["api"]).sort(), ["note_1", "store"]);
assert.deepEqual(diagramDependents(built, ["backend"]), ["api"]);
assert.deepEqual(diagramDependents(built, ["api__store"]).sort(), ["api", "store"]);
const updated = applyDiagramOperations(built, [{ op: "update", entity: "node", id: "api", value: { summary: "Now accepts images" } }, { op: "move", entity: "node", id: "api", x: 80, y: 40 }]);
assert.equal(updated.diagram.nodes.find(node => node.id === "api").x, 80);
assert.deepEqual(updated.dependents.sort(), ["note_1", "store"]);
assert.equal(built.nodes.find(node => node.id === "api").x, undefined, "operations never mutate the input");
const removed = applyDiagramOperations(built, [{ op: "remove", entity: "node", id: "backend" }]);
assert.deepEqual(removed.diagram.nodes.map(node => node.id), ["store"]);
assert.equal(removed.diagram.edges.length, 0);
assert.equal(removed.diagram.notes.length, 0);
assert.deepEqual(removed.dependents, ["store"]);
assert.deepEqual(removed.removed.sort(), ["api", "api__store", "backend", "note_1"]);
for (const operations of [
 [], [{ op: "update", entity: "node", id: "api", value: { id: "other" } }],
 [{ op: "update", entity: "node", id: "api", value: JSON.parse('{"__proto__":{"evil":true}}') }],
 [{ op: "move", entity: "edge", id: "api__store", x: 0, y: 0 }],
 [{ op: "move", entity: "node", id: "api", x: Infinity, y: 0 }],
 [{ op: "remove", entity: "node", id: "missing" }],
 [{ op: "add", entity: "node", value: node }],
]) assert.throws(() => applyDiagramOperations(built, operations));
{ // D4: settle clears a user edit; a settled removal deletes with the remove cascade.
 const marked = applyDiagramOperations(base, [
  { op: "add", entity: "node", value: { id: "grp", label: "Grp", kind: "group", edit: "remove" } },
  { op: "add", entity: "node", value: { id: "inner", label: "Inner", kind: "service", parent: "grp", edit: "add" } },
  { op: "add", entity: "node", value: { id: "other", label: "Other", kind: "store", edit: "change" } },
  { op: "add", entity: "edge", value: { from: "inner", to: "other" } },
  { op: "add", entity: "edge", value: { id: "gone", from: "other", to: "other", edit: "remove" } },
 ]).diagram;
 const settled = applyDiagramOperations(marked, [{ op: "settle", entity: "node", id: "other" }, { op: "settle", entity: "edge", id: "gone" }]);
 assert.equal(settled.diagram.nodes.find(item => item.id === "other").edit, undefined, "settle change clears the mark");
 assert(!settled.diagram.edges.some(item => item.id === "gone"), "settled removal deletes the edge");
 const cascade = applyDiagramOperations(marked, [{ op: "settle", entity: "node", id: "inner" }, { op: "settle", entity: "node", id: "grp" }]);
 assert.deepEqual(cascade.diagram.nodes.map(item => item.id), ["other"], "settled group removal cascades to children");
 assert.deepEqual(cascade.diagram.edges.map(item => item.id), ["gone"], "and to their connections");
 assert.throws(() => applyDiagramOperations(settled.diagram, [{ op: "settle", entity: "node", id: "other" }]), /Nothing to settle/);
 assert.throws(() => applyDiagramOperations(marked, [{ op: "settle", entity: "node", id: "missing" }]), /Unknown/);
 assert.throws(() => applyDiagramOperations(marked, [{ op: "settle", entity: "note", id: "inner" }]));
}
const dir = await mkdtemp(path.join(os.tmpdir(), "plan3-diagram-test-"));
try {
 const planFile = path.join(dir, "docs", "plans", "sample-12345678-plan3.md");
 await mkdir(path.dirname(planFile), { recursive: true });
 await writeFile(planFile, "---\nplan3: true\n---\n\n# Sample\n");
 const target = { kind: "plan", plan: { id: "12345678", file: planFile, title: "Sample" } };
 assert.equal(diagramPath(dir, target), planFile.replace(/\.md$/, ".diagram.json"));
 assert.equal(loadDiagram(dir, target), undefined);
 const seeded = emptyDiagram(target);
 assert.deepEqual([seeded.nodes, seeded.edges, seeded.notes], [[], [], []], "a plan diagram starts empty (R2)");
 seeded.nodes.push({ ...node, status: "existing" });
 seeded.notes.push({ id: "note_1", target: "api", text: "Keep this note", author: "user", created: "2026-10-13", x: 20, y: 30 });
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
 const large = { ...base, nodes: Array.from({ length: 1000 }, (_, i) => ({ ...node, id: `bulk_${i}`, details: "x".repeat(920) })) };
 assert.doesNotThrow(() => validateDiagram(large));
 await assert.rejects(saveDiagram(dir, product, large, 0), /Serialized diagram exceeds/);
 assert.equal(loadDiagram(dir, product), undefined, "serialization bound failure leaves no unreadable file");
 assert.throws(() => diagramPath(dir, { kind: "plan", plan: { ...target.plan, file: path.join(dir, "outside.md") } }), /owner/);
 const applied = await applyDiagram(dir, target, [{ op: "move", entity: "node", id: "api", x: 60, y: 70 }], 2);
 assert.equal(applied.diagram.revision, 3);
 assert.equal(loadDiagram(dir, target).nodes[0].x, 60);
 await assert.rejects(applyDiagram(dir, target, [{ op: "remove", entity: "node", id: "api" }], 2), /Stale/);
 const beforeMove = loadDiagram(dir, target), oldSibling = diagramPath(dir, target);
 const renamed = path.join(path.dirname(planFile), "renamed-12345678-plan3.md");
 await writeFile(renamed.replace(/\.md$/, ".diagram.json"), "reserved");
 await assert.rejects(movePlanWithDiagram(dir, planFile, renamed), /already exists/);
 assert(existsSync(planFile) && existsSync(oldSibling), "collision preserves original plan and diagram");
 assert.equal(readFileSync(renamed.replace(/\.md$/, ".diagram.json"), "utf8"), "reserved");
 await rm(renamed.replace(/\.md$/, ".diagram.json"));
 await movePlanWithDiagram(dir, planFile, renamed);
 target.plan.file = renamed;
 assert(!existsSync(planFile) && !existsSync(oldSibling));
 assert.deepEqual(loadDiagram(dir, target), beforeMove, "rename/reopen preserves notes, ids, positions and revision");
 const archived = path.join(dir, "docs", "plans", "done", path.basename(renamed));
 await movePlanWithDiagram(dir, renamed, archived);
 target.plan.file = archived;
 assert.deepEqual(loadDiagram(dir, target), beforeMove, "archive/reopen preserves full diagram");
 await writeFile(diagramPath(dir, target), " ".repeat(DIAGRAM_BYTES + 1));
 assert.throws(() => loadDiagram(dir, target), /bounded/);
 const outside = path.join(dir, "external");
 await mkdir(outside);
 await mkdir(path.join(dir, "docs", "architecture"), { recursive: true });
 await symlink(outside, path.join(dir, "docs", "architecture", "product.diagram.json"), process.platform === "win32" ? "junction" : "dir");
 assert.throws(() => diagramPath(dir, product), /symlink/);
 // H4-01: the hub and a Pi save the same diagram from different processes; the lock covers both.
 {
 	const { withPlanDesignLock } = await import("../extensions/plan3-design.ts");
 	const lockFile = path.join(dir, "docs", "plans", "lock-87654321-plan3.md");
 	await writeFile(lockFile, "---\nplan3: true\n---\n\n# Lock\n");
 	const lockTarget = { kind: "plan", plan: { id: "87654321", file: lockFile, title: "Lock" } };
 	const current = await saveDiagram(dir, lockTarget, emptyDiagram(lockTarget), 0);
 	const child = (revision) => new Promise(resolve => {
 		const code = `const { saveDiagram } = await import(${JSON.stringify(new URL("../extensions/plan3-diagram.ts", import.meta.url).href)}); try { await saveDiagram(${JSON.stringify(dir)}, ${JSON.stringify(lockTarget)}, ${JSON.stringify(current)}, ${revision}); console.log("saved"); } catch (error) { console.log(error.message); }`;
 		const proc = spawn(process.execPath, ["--no-warnings", "--input-type=module", "-e", code]);
 		let out = ""; proc.stdout.on("data", chunk => out += chunk); proc.on("exit", () => resolve({ out: out.trim(), at: Date.now() }));
 	});
 	let released = 0, waiting;
 	await withPlanDesignLock(diagramPath(dir, lockTarget), async () => { waiting = child(1); await new Promise(resolve => setTimeout(resolve, 1500)); released = Date.now(); });
 	const late = await waiting;
 	assert.equal(late.out, "saved"); assert(late.at >= released, "the other process waits for the lock");
 	const both = await Promise.all([child(2), child(2)]);
 	assert.deepEqual(both.map(result => result.out).sort(), ["Stale diagram revision; reload before editing.", "saved"], "two processes at once: exactly one wins");
 	assert.equal(loadDiagram(dir, lockTarget).revision, 3);
 }
} finally { await rm(dir, { recursive: true, force: true }); }
// H4-01 (D14): pi-control-hub imports these with plain Node; none may pull in a Pi package.
{
	const modules = ["plan3.ts", "plan3-diagram.ts", "plan3-design.ts", "plan3-files.ts"].map(name => new URL(`../extensions/${name}`, import.meta.url).href);
	const code = `import { registerHooks } from "node:module"; const seen = []; registerHooks({ resolve(s, c, n) { if (/^@earendil-works|^@sinclair|^typebox/.test(s)) seen.push(s); return n(s, c); } }); for (const m of ${JSON.stringify(modules)}) await import(m); console.log(JSON.stringify(seen));`;
	const out = await new Promise((resolve, reject) => { const proc = spawn(process.execPath, ["--no-warnings", "--input-type=module", "-e", code]); let text = ""; proc.stdout.on("data", chunk => text += chunk); proc.on("exit", status => status ? reject(new Error(`import failed (${status})`)) : resolve(text.trim())); });
	assert.equal(out, "[]", "hub-shared modules stay Pi-free");
}
console.log("ok - plan3 diagram validation, persistence and layout");
