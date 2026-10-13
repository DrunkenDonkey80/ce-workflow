import path from "node:path";
import { existsSync } from "node:fs";
import { confined, read, atomic, withPlanDesignLock } from "./plan3-design.ts";

export type DiagramStatus = "new" | "changed" | "removed" | "existing";
export interface DiagramNode {
	id: string; label: string; kind: "group" | "client" | "service" | "store" | "external";
	parent?: string; summary?: string; tech?: string; details?: string; status?: DiagramStatus; x?: number; y?: number;
}
export interface DiagramEdge { id: string; from: string; to: string; label?: string; status?: DiagramStatus }
export interface DiagramNote { id: string; target?: string; text: string; author: "user" | "agent"; created: string; x?: number; y?: number }
export interface Diagram { version: 1; kind: "plan" | "product"; plan?: string; title: string; revision: number; nodes: DiagramNode[]; edges: DiagramEdge[]; notes: DiagramNote[] }
export type DiagramTarget = { kind: "product" } | { kind: "plan"; plan: { id: string; file: string; title: string } };
export const DIAGRAM_BYTES = 1_000_000;
const ID = /^[a-z][a-z0-9_]{0,47}$/;

function object(value: unknown, fields: string[], label: string): asserts value is Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !fields.includes(key))) throw new Error(`Invalid ${label} fields.`);
}
function text(value: unknown, label: string, max = 20_000): asserts value is string {
	if (typeof value !== "string" || !value.trim() || value.includes("\0") || Buffer.byteLength(value) > max) throw new Error(`Invalid bounded text: ${label}.`);
}
function coordinate(value: unknown) {
	if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > 1_000_000)) throw new Error("Invalid diagram coordinate.");
}

export function validateDiagram(value: unknown): Diagram {
	object(value, ["version", "kind", "plan", "title", "revision", "nodes", "edges", "notes"], "diagram");
	if (value.version !== 1 || !["plan", "product"].some(kind => kind === value.kind) || !Number.isSafeInteger(value.revision) || Number(value.revision) < 0) throw new Error("Invalid diagram version/kind/revision.");
	if (value.kind === "plan" ? typeof value.plan !== "string" || !/^[a-f0-9]{8}$/.test(value.plan) : value.plan !== undefined) throw new Error("Invalid diagram plan identity.");
	text(value.title, "title", 300);
	for (const [field, max] of [["nodes", 1000], ["edges", 3000], ["notes", 1000]] as const) {
		if (!Array.isArray(value[field]) || value[field].length > max) throw new Error(`Invalid diagram ${field} count.`);
	}
	const ids = new Set<string>(), nodes = new Map<string, DiagramNode>(), edges = new Set<string>();
	const unique = (id: unknown) => {
		if (typeof id !== "string" || !ID.test(id) || ids.has(id)) throw new Error("Invalid or duplicate diagram id.");
		ids.add(id);
	};
	const status = (entry: Record<string, unknown>) => {
		if (entry.status !== undefined && (value.kind !== "plan" || !["new", "changed", "removed", "existing"].some(status => status === entry.status))) throw new Error("Invalid diagram status.");
	};
	for (const node of value.nodes as unknown[]) {
		object(node, ["id", "label", "kind", "parent", "summary", "tech", "details", "status", "x", "y"], "node");
		unique(node.id); text(node.label, "node label", 300);
		if (!["group", "client", "service", "store", "external"].some(kind => kind === node.kind)) throw new Error("Invalid node kind.");
		for (const field of ["summary", "tech", "details"]) if (node[field] !== undefined) text(node[field], field);
		if (node.parent !== undefined && (typeof node.parent !== "string" || !ID.test(node.parent))) throw new Error("Invalid parent id.");
		coordinate(node.x); coordinate(node.y); status(node);
		// SAFETY: every declared node field is checked above; hierarchy references are checked below.
		nodes.set(node.id as string, node as unknown as DiagramNode);
	}
	for (const node of nodes.values()) {
		const seen = new Set([node.id]);
		for (let parent = node.parent; parent !== undefined; parent = nodes.get(parent)?.parent) {
			if (seen.has(parent) || seen.size >= 64) throw new Error("Cyclic or excessive group nesting.");
			if (nodes.get(parent)?.kind !== "group") throw new Error("Unknown parent group.");
			seen.add(parent);
		}
	}
	for (const edge of value.edges as unknown[]) {
		object(edge, ["id", "from", "to", "label", "status"], "edge"); unique(edge.id);
		if (typeof edge.from !== "string" || typeof edge.to !== "string" || !nodes.has(edge.from) || !nodes.has(edge.to)) throw new Error("Dangling edge.");
		if (edge.label !== undefined) text(edge.label, "edge label", 300);
		status(edge); edges.add(edge.id as string);
	}
	for (const note of value.notes as unknown[]) {
		object(note, ["id", "target", "text", "author", "created", "x", "y"], "note"); unique(note.id); text(note.text, "note text");
		if (!["user", "agent"].some(author => author === note.author) || typeof note.created !== "string" || !Number.isFinite(Date.parse(note.created))) throw new Error("Invalid note provenance.");
		if (note.target !== undefined && (typeof note.target !== "string" || !nodes.has(note.target) && !edges.has(note.target))) throw new Error("Dangling note target.");
		coordinate(note.x); coordinate(note.y);
		if (note.target === undefined && (note.x === undefined || note.y === undefined)) throw new Error("Canvas note needs coordinates.");
	}
	if (Buffer.byteLength(JSON.stringify(value)) > DIAGRAM_BYTES) throw new Error("Diagram exceeds size bound.");
	// SAFETY: all schema fields, references, counts and bounds were validated above.
	return value as unknown as Diagram;
}

export function diagramPath(cwd: string, target: DiagramTarget) {
	if (target.kind === "product") return confined(cwd, "docs/architecture/product.diagram.json");
	const relative = path.relative(path.resolve(cwd), path.resolve(target.plan.file)).replaceAll("\\", "/");
	if (!/^docs\/plans\/(?:done\/)?[^/]+\.md$/.test(relative) || !/^[a-f0-9]{8}$/.test(target.plan.id)) throw new Error("Diagram owner must be a stable Plan3 plan in docs/plans.");
	const owner = confined(cwd, relative);
	const ownerText = read(owner, DIAGRAM_BYTES), header = ownerText.split(/^---\s*$/m)[1];
	if (!ownerText.startsWith("---") || !header || !/^plan3: true\r?$/m.test(header)) throw new Error("Diagram owner is not a Plan3 plan.");
	return confined(cwd, relative.replace(/\.md$/, ".diagram.json"));
}
function identity(diagram: Diagram, target: DiagramTarget) {
	if (diagram.kind !== target.kind || target.kind === "plan" && diagram.plan !== target.plan.id) throw new Error("Diagram target mismatch.");
}
export function loadDiagram(cwd: string, target: DiagramTarget): Diagram | undefined {
	const file = diagramPath(cwd, target);
	if (!existsSync(file)) return;
	try {
		const diagram = validateDiagram(JSON.parse(read(file, DIAGRAM_BYTES)));
		identity(diagram, target);
		return diagram;
	} catch (cause) {
		throw new Error(`Cannot load diagram ${file}: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
	}
}
export function emptyDiagram(target: DiagramTarget, product?: Diagram): Diagram {
	return {
		version: 1, kind: target.kind, ...(target.kind === "plan" ? { plan: target.plan.id } : {}),
		title: target.kind === "plan" ? target.plan.title : "Product architecture", revision: 0,
		nodes: target.kind === "plan" && product ? product.nodes.map(node => ({ ...node, status: "existing" })) : [],
		edges: target.kind === "plan" && product ? product.edges.map(edge => ({ ...edge, status: "existing" })) : [],
		notes: target.kind === "plan" && product ? structuredClone(product.notes) : [],
	};
}
export async function saveDiagram(cwd: string, target: DiagramTarget, value: unknown, expectedRevision: number): Promise<Diagram> {
	const file = diagramPath(cwd, target);
	return withPlanDesignLock(file, () => {
		const before = loadDiagram(cwd, target);
		if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== (before?.revision ?? 0)) throw new Error("Stale diagram revision; reload before editing.");
		const candidate = validateDiagram(value); identity(candidate, target);
		const diagram = validateDiagram({ ...candidate, revision: expectedRevision + 1 });
		const contents = JSON.stringify(diagram, null, 2) + "\n";
		if (Buffer.byteLength(contents) > DIAGRAM_BYTES) throw new Error("Serialized diagram exceeds size bound.");
		atomic(diagramPath(cwd, target), contents);
		return diagram;
	});
}

export function diagramDependents(diagram: Diagram, changed: Iterable<string>): string[] {
	const ids = new Set(changed), dependent = new Set<string>();
	for (const edge of diagram.edges) {
		if (ids.has(edge.id) || ids.has(edge.from)) dependent.add(edge.to);
		if (ids.has(edge.id) || ids.has(edge.to)) dependent.add(edge.from);
	}
	for (const node of diagram.nodes) if (node.parent && ids.has(node.parent)) dependent.add(node.id);
	for (const note of diagram.notes) if (note.target && ids.has(note.target)) dependent.add(note.id);
	return [...dependent].filter(id => !ids.has(id));
}

export function applyDiagramOperations(before: Diagram, operations: unknown) {
	validateDiagram(before);
	if (!Array.isArray(operations) || !operations.length || operations.length > 256) throw new Error("Apply needs 1–256 diagram operations.");
	const diagram = structuredClone(before), changed = new Set<string>(), removed = new Set<string>();
	for (const operation of operations) {
		object(operation, ["op", "entity", "id", "value", "x", "y"], "operation");
		if (!["add", "update", "move", "remove"].some(op => op === operation.op) || !["node", "edge", "note"].some(entity => entity === operation.entity)) throw new Error("Unknown diagram operation/entity.");
		const list: (DiagramNode | DiagramEdge | DiagramNote)[] = operation.entity === "node" ? diagram.nodes : operation.entity === "edge" ? diagram.edges : diagram.notes;
		const fields = operation.entity === "node" ? ["id", "label", "kind", "parent", "summary", "tech", "details", "status", "x", "y"] : operation.entity === "edge" ? ["id", "from", "to", "label", "status"] : ["id", "target", "text", "author", "created", "x", "y"];
		if (operation.op === "add") {
			object(operation.value, fields, "add value");
			const value = { ...operation.value };
			if (value.id === undefined && operation.entity !== "node") {
				const taken = new Set([...diagram.nodes, ...diagram.edges, ...diagram.notes].map(item => item.id));
				const base = operation.entity === "edge" ? `${value.from}__${value.to}`.slice(0, 48) : "note";
				let id = operation.entity === "note" ? "note_1" : base;
				for (let suffix = 2; taken.has(id); suffix++) id = `${base.slice(0, 48 - String(suffix).length - 1)}_${suffix}`;
				value.id = id;
			}
			if (typeof value.id !== "string" || !ID.test(value.id) || removed.has(value.id) || [...diagram.nodes, ...diagram.edges, ...diagram.notes].some(item => item.id === value.id)) throw new Error("Invalid or duplicate diagram id.");
			// SAFETY: final validateDiagram checks every field/reference before the candidate can be saved.
			list.push(value as unknown as DiagramNode | DiagramEdge | DiagramNote);
			changed.add(value.id);
			continue;
		}
		if (typeof operation.id !== "string" || !ID.test(operation.id)) throw new Error("Operation needs an id.");
		const index = list.findIndex(item => item.id === operation.id);
		if (index < 0) throw new Error(`Unknown ${operation.entity}: ${operation.id}`);
		changed.add(operation.id);
		if (operation.op === "update") {
			object(operation.value, fields, "update value");
			if ("id" in operation.value && operation.value.id !== operation.id) throw new Error("Element ids cannot be changed; add a new element instead.");
			Object.assign(list[index], operation.value);
		} else if (operation.op === "move") {
			if (operation.entity === "edge" || typeof operation.x !== "number" || typeof operation.y !== "number") throw new Error("Move needs a node/note and numeric x,y.");
			Object.assign(list[index], { x: operation.x, y: operation.y });
		} else {
			removed.add(operation.id);
			if (operation.entity === "node") {
				let added = true;
				while (added) { added = false; for (const node of diagram.nodes) if (node.parent && removed.has(node.parent) && !removed.has(node.id)) { removed.add(node.id); added = true; } }
				for (const edge of diagram.edges) if (removed.has(edge.from) || removed.has(edge.to)) removed.add(edge.id);
			}
			for (const note of diagram.notes) if (note.target && removed.has(note.target)) removed.add(note.id);
			diagram.nodes = diagram.nodes.filter(item => !removed.has(item.id));
			diagram.edges = diagram.edges.filter(item => !removed.has(item.id));
			diagram.notes = diagram.notes.filter(item => !removed.has(item.id));
		}
	}
	validateDiagram(diagram);
	const allChanges = new Set([...changed, ...removed]);
	const dependents = [...new Set([...diagramDependents(before, allChanges), ...diagramDependents(diagram, allChanges)])].filter(id => !allChanges.has(id));
	return { diagram, changed: [...allChanges], removed: [...removed], dependents };
}

export async function applyDiagram(cwd: string, target: DiagramTarget, operations: unknown, expectedRevision: number) {
	const before = loadDiagram(cwd, target) ?? emptyDiagram(target, target.kind === "plan" ? loadDiagram(cwd, { kind: "product" }) : undefined);
	if (before.revision !== expectedRevision) throw new Error("Stale diagram revision; reload before editing.");
	const result = applyDiagramOperations(before, operations);
	return { ...result, diagram: await saveDiagram(cwd, target, result.diagram, expectedRevision) };
}
