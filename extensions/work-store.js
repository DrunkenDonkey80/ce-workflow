import {
	closeSync,
	existsSync,
	fsyncSync,
	mkdirSync,
	openSync,
	readFileSync,
	renameSync,
	rmSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";

export const WORK_STORE_VERSION = 1;
const TYPES = new Set(["epic", "task", "bug", "decision", "idea"]);
const STATUSES = new Set([
	"open",
	"in_progress",
	"closed",
	"blocked",
	"planned",
	"deferred",
]);

export class WorkStoreError extends Error {
	constructor(category, message, details = {}) {
		super(message);
		this.name = "WorkStoreError";
		this.category = category;
		Object.assign(this, details);
	}
}

export function storePath(cwd = process.cwd()) {
	return path.join(cwd, ".ce-workflow", "work-items.json");
}

function runtimeDir(cwd) {
	return path.join(cwd, ".pi", "work-store");
}
function recoveryPath(cwd) {
	return path.join(runtimeDir(cwd), "work-items.recovery.json");
}
function candidatePath(cwd) {
	return path.join(path.dirname(storePath(cwd)), ".work-items.candidate.json");
}
function lockPath(cwd) {
	return path.join(runtimeDir(cwd), "mutation.lock");
}
function now(value) {
	return value ?? new Date().toISOString();
}
function error(category, message, details) {
	return new WorkStoreError(category, message, details);
}

function parseSnapshot(content, file) {
	if (/^(<{7}|={7}|>{7})/m.test(content))
		throw error("conflicted", `Work store contains merge markers: ${file}`, {
			file,
		});
	let snapshot;
	try {
		snapshot = JSON.parse(content);
	} catch {
		throw error("corrupt", `Work store is not valid JSON: ${file}`, { file });
	}
	validateStore(snapshot, file);
	return snapshot;
}

function readValidated(file) {
	return parseSnapshot(readFileSync(file, "utf8"), file);
}
function writeDurable(file, content) {
	const fd = openSync(file, "w");
	try {
		writeFileSync(fd, content, "utf8");
		fsyncSync(fd);
	} finally {
		closeSync(fd);
	}
}

export function loadStore(cwd = process.cwd()) {
	const canonical = storePath(cwd);
	const recovery = recoveryPath(cwd);
	if (existsSync(canonical)) {
		try {
			return readValidated(canonical);
		} catch (primary) {
			if (primary?.category === "unsupported" || !existsSync(recovery))
				throw primary;
			try {
				return readValidated(recovery);
			} catch {
				throw primary;
			}
		}
	}
	if (existsSync(recovery)) return readValidated(recovery);
	throw error("missing", `Native work store is missing: ${canonical}`, {
		file: canonical,
	});
}

export function initStore(cwd = process.cwd(), options = {}) {
	try {
		return loadStore(cwd);
	} catch (error) {
		if (!(error instanceof WorkStoreError) || error.category !== "missing")
			throw error;
	}
	const lock = acquireLock(cwd);
	try {
		try {
			return loadStore(cwd);
		} catch (error) {
			if (!(error instanceof WorkStoreError) || error.category !== "missing")
				throw error;
		}
		const timestamp = now(options.now);
		const store = {
			schemaVersion: WORK_STORE_VERSION,
			metadata: { createdAt: timestamp, updatedAt: timestamp },
			items: {},
		};
		saveStore(cwd, store);
		return store;
	} finally {
		lock.release();
	}
}

function canonicalize(value) {
	if (Array.isArray(value)) return value.map(canonicalize);
	if (!value || typeof value !== "object") return value;
	return Object.fromEntries(
		Object.keys(value)
			.sort()
			.map((key) => [key, canonicalize(value[key])]),
	);
}

export function serializeStore(store) {
	validateStore(store);
	const normalized = canonicalize({
		...store,
		items: Object.fromEntries(
			Object.entries(store.items)
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([id, item]) => [
					id,
					{
						...item,
						dependencies: [...(item.dependencies ?? [])].sort(),
						labels: [...(item.labels ?? [])].sort(),
					},
				]),
		),
	});
	return `${JSON.stringify(normalized, null, 2)}\n`;
}

export function saveStore(cwd = process.cwd(), store, options = {}) {
	const content = serializeStore(store);
	if (options.dryRun) return content;
	const target = storePath(cwd);
	const candidate = candidatePath(cwd);
	const recovery = recoveryPath(cwd);
	mkdirSync(path.dirname(target), { recursive: true });
	mkdirSync(path.dirname(recovery), { recursive: true });
	if (existsSync(target)) {
		const old = readFileSync(target, "utf8");
		parseSnapshot(old, target);
		writeDurable(recovery, old);
		readValidated(recovery);
	}
	if (options.interruptAt === "recovery")
		throw error("interrupted", "Interrupted after validated recovery write");
	writeDurable(candidate, content);
	readValidated(candidate);
	if (options.interruptAt === "candidate")
		throw error("interrupted", "Interrupted after validated candidate write");
	try {
		renameSync(candidate, target);
	} catch (cause) {
		// Windows may reject replacing an existing pathname. The validated recovery
		// copy makes this remove-and-rename fallback recoverable after interruption.
		if (existsSync(target)) {
			try {
				rmSync(target);
				renameSync(candidate, target);
			} catch (fallbackCause) {
				throw error(
					"write",
					`Unable to publish native work store: ${fallbackCause.message}`,
					{ cause: fallbackCause },
				);
			}
		} else {
			throw error(
				"write",
				`Unable to publish native work store: ${cause.message}`,
				{ cause },
			);
		}
	}
	if (options.interruptAt === "replace")
		throw error("interrupted", "Interrupted after native store replacement");
	return content;
}

function lockOwnerIsDead(file) {
	let pid;
	try {
		pid = Number.parseInt(readFileSync(file, "utf8").trim(), 10);
	} catch {
		return false;
	}
	if (!Number.isInteger(pid) || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return false;
	} catch (cause) {
		return cause?.code === "ESRCH";
	}
}

export function acquireLock(cwd = process.cwd()) {
	const file = lockPath(cwd);
	mkdirSync(path.dirname(file), { recursive: true });
	let fd;
	try {
		fd = openSync(file, "wx");
		writeFileSync(fd, `${process.pid}\n`);
	} catch (cause) {
		if (cause?.code === "EEXIST") {
			if (lockOwnerIsDead(file)) {
				// ponytail: single-host PID lock; replace with an OS lock if PID reuse
				// or multi-host writers become a real workload.
				try {
					unlinkSync(file);
				} catch (unlinkCause) {
					if (unlinkCause?.code !== "ENOENT") throw unlinkCause;
				}
				return acquireLock(cwd);
			}
			throw error("locked", `Another native work-store writer owns ${file}`, {
				file,
			});
		}
		throw error(
			"write",
			`Unable to acquire native work-store lock: ${cause.message}`,
			{ cause },
		);
	}
	let released = false;
	return {
		file,
		release() {
			if (released) return;
			released = true;
			closeSync(fd);
			try {
				unlinkSync(file);
			} catch (cause) {
				if (cause?.code !== "ENOENT") throw cause;
			}
		},
	};
}

export function mutateStore(cwd = process.cwd(), mutate, options = {}) {
	const lock = acquireLock(cwd);
	try {
		const store = loadStore(cwd);
		const result = mutate(store);
		store.metadata.updatedAt = now(options.now);
		saveStore(cwd, store, options);
		return result === undefined ? store : result;
	} finally {
		lock.release();
	}
}

function stringArray(value, field, file) {
	if (value === undefined) return;
	if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string"))
		throw error("corrupt", `Invalid ${field} in ${file ?? "work store"}`);
}

export function validateStore(store, file = "work store") {
	if (!store || typeof store !== "object" || Array.isArray(store))
		throw error("corrupt", `Work store must be an object: ${file}`);
	if (store.schemaVersion !== WORK_STORE_VERSION) {
		const category =
			Number(store.schemaVersion) > WORK_STORE_VERSION
				? "unsupported"
				: "corrupt";
		throw error(
			category,
			`Unsupported work-store schema ${store.schemaVersion}: ${file}`,
		);
	}
	if (
		!store.metadata ||
		typeof store.metadata !== "object" ||
		Array.isArray(store.metadata)
	)
		throw error("corrupt", `Work store metadata is invalid: ${file}`);
	if (
		!store.items ||
		typeof store.items !== "object" ||
		Array.isArray(store.items)
	)
		throw error("corrupt", `Work store items are invalid: ${file}`);
	const ids = new Set();
	for (const [key, item] of Object.entries(store.items)) {
		if (
			!item ||
			typeof item !== "object" ||
			Array.isArray(item) ||
			item.id !== key ||
			!key.trim() ||
			ids.has(item.id)
		)
			throw error("corrupt", `Duplicate or invalid work item ID in ${file}`);
		ids.add(item.id);
		if (
			!TYPES.has(item.type) ||
			!STATUSES.has(item.status) ||
			typeof item.title !== "string"
		)
			throw error("corrupt", `Invalid work item ${key} in ${file}`);
		if (item.parentId !== undefined && typeof item.parentId !== "string")
			throw error("corrupt", `Invalid parent for ${key} in ${file}`);
		stringArray(item.dependencies, `dependencies for ${key}`, file);
		stringArray(item.labels, `labels for ${key}`, file);
		stringArray(item.notes, `notes for ${key}`, file);
		for (const [field, entries] of [
			["evidence", item.evidence],
			["dependencyEdges", item.dependencyEdges],
		])
			if (
				entries !== undefined &&
				(!Array.isArray(entries) ||
					entries.some(
						(entry) =>
							!entry || typeof entry !== "object" || Array.isArray(entry),
					))
			)
				throw error("corrupt", `Invalid ${field} for ${key} in ${file}`);
	}
	for (const item of Object.values(store.items)) {
		if (item.parentId && (!ids.has(item.parentId) || item.parentId === item.id))
			throw error(
				"corrupt",
				`Unknown parent ${item.parentId} for ${item.id} in ${file}`,
			);
		for (const dependency of item.dependencies ?? [])
			if (!ids.has(dependency) || dependency === item.id)
				throw error(
					"corrupt",
					`Unknown dependency ${dependency} for ${item.id} in ${file}`,
				);
		for (const edge of item.dependencyEdges ?? [])
			if (
				edge.fromId !== item.id ||
				typeof edge.toId !== "string" ||
				!ids.has(edge.toId) ||
				edge.toId === item.id ||
				typeof edge.type !== "string" ||
				!edge.type
			)
				throw error("corrupt", `Invalid dependency edge for ${item.id} in ${file}`);
	}
	return store;
}

function nextId(store, parentId) {
	const base = parentId || "work";
	const pattern = new RegExp(`^${escapeRegExp(base)}\\.(\\d+)$`);
	if (!parentId) {
		let number = 1;
		while (store.items[`work-${number}`]) number += 1;
		return `work-${number}`;
	}
	let number = 1;
	for (const id of Object.keys(store.items)) {
		const match = id.match(pattern);
		if (match) number = Math.max(number, Number(match[1]) + 1);
	}
	return `${base}.${number}`;
}
function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function createWorkItem(store, input = {}) {
	validateStore(store);
	const timestamp = now(input.now);
	const id = input.id ?? nextId(store, input.parentId);
	if (store.items[id])
		throw error("corrupt", `Work item already exists: ${id}`);
	const item = {
		id,
		type: input.type ?? "task",
		status: input.status ?? "open",
		title: input.title ?? "",
		createdAt: input.createdAt ?? timestamp,
		updatedAt: input.updatedAt ?? timestamp,
		...(input.parentId ? { parentId: input.parentId } : {}),
		...(input.description !== undefined
			? { description: input.description }
			: {}),
		...(input.owner !== undefined ? { owner: input.owner } : {}),
		...(input.priority !== undefined ? { priority: input.priority } : {}),
		dependencies: [...(input.dependencies ?? [])],
		labels: [...(input.labels ?? [])],
		notes: [...(input.notes ?? [])],
		evidence: [...(input.evidence ?? [])],
		dependencyEdges: structuredClone(input.dependencyEdges ?? []),
		...(input.acceptance !== undefined ? { acceptance: input.acceptance } : {}),
		...(input.executionMode !== undefined
			? { executionMode: input.executionMode }
			: {}),
		...(input.ideaLineage
			? { ideaLineage: structuredClone(input.ideaLineage) }
			: {}),
		...(input.reviewResult !== undefined
			? { reviewResult: input.reviewResult }
			: {}),
		...(input.verificationSummary
			? { verificationSummary: structuredClone(input.verificationSummary) }
			: {}),
		...(input.documentLinks
			? { documentLinks: structuredClone(input.documentLinks) }
			: {}),
		...(input.legacy ? { legacy: structuredClone(input.legacy) } : {}),
	};
	validateStore({ ...store, items: { ...store.items, [id]: item } });
	store.items[id] = item;
	return item;
}

export function updateWorkItem(store, id, changes = {}) {
	validateStore(store);
	const previous = store.items[id];
	if (!previous) throw error("missing", `Work item is missing: ${id}`);
	const { id: changedId, now: changedNow, ...fields } = changes;
	if (changedId !== undefined && changedId !== id)
		throw error("corrupt", "Work item IDs cannot be changed");
	const next = {
		...previous,
		...fields,
		id,
		updatedAt: fields.updatedAt ?? now(changedNow),
		...(fields.dependencies ? { dependencies: [...fields.dependencies] } : {}),
		...(fields.labels ? { labels: [...fields.labels] } : {}),
		...(fields.notes ? { notes: [...fields.notes] } : {}),
		...(fields.evidence ? { evidence: [...fields.evidence] } : {}),
	};
	validateStore({ ...store, items: { ...store.items, [id]: next } });
	store.items[id] = next;
	return next;
}

export function appendWorkNote(store, id, note, options = {}) {
	if (typeof note !== "string")
		throw error("corrupt", "Work-item notes must be strings");
	const item = getWorkItem(store, id);
	if (!item) throw error("missing", `Work item is missing: ${id}`);
	return updateWorkItem(store, id, {
		notes: [...(item.notes ?? []), note],
		now: options.now,
	});
}

export function addWorkEvidence(store, id, evidence, options = {}) {
	if (!evidence || typeof evidence !== "object" || Array.isArray(evidence))
		throw error("corrupt", "Work-item evidence must be an object");
	const item = getWorkItem(store, id);
	if (!item) throw error("missing", `Work item is missing: ${id}`);
	return updateWorkItem(store, id, {
		evidence: [...(item.evidence ?? []), structuredClone(evidence)],
		now: options.now,
	});
}

export function deleteWorkItem(store, id) {
	validateStore(store);
	if (!store.items[id]) throw error("missing", `Work item is missing: ${id}`);
	if (
		Object.values(store.items).some(
			(item) => item.parentId === id || item.dependencies?.includes(id),
		)
	)
		throw error("corrupt", `Cannot delete referenced work item: ${id}`);
	delete store.items[id];
	return store;
}

export function getWorkItem(store, id) {
	validateStore(store);
	return store.items[id];
}
export function listWorkItems(store, filter = {}) {
	validateStore(store);
	return Object.values(store.items)
		.filter((item) =>
			Object.entries(filter).every(([key, value]) => item[key] === value),
		)
		.sort((left, right) => left.id.localeCompare(right.id));
}
export function childWorkItems(store, parentId) {
	return listWorkItems(store, { parentId });
}
function blockingDependencies(item) {
	const edges = new Map(
		(item.dependencyEdges ?? []).map((edge) => [edge.toId, edge.type]),
	);
	return (item.dependencies ?? []).filter(
		(id) =>
			id !== item.parentId &&
			(!edges.has(id) || /^blocks?$/i.test(edges.get(id))),
	);
}

export function readyWorkItems(store) {
	validateStore(store);
	return Object.values(store.items)
		.filter(
			(item) =>
				item.type !== "epic" &&
				item.type !== "decision" &&
				item.type !== "idea",
		)
		.filter((item) => item.status === "open" || item.status === "planned")
		.filter((item) =>
			blockingDependencies(item).every(
				(id) => store.items[id].status === "closed",
			),
		)
		.sort((left, right) => left.id.localeCompare(right.id));
}
