import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { validateVerificationContract } from "./work-verification-contract.ts";

export const WORK_STORE_VERSION = 1;
export const INITIATIVE_LABEL = "initiative";
export const INITIATIVE_SCHEMA_VERSION = 1;
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















function stringArray(value, field, file) {
	if (value === undefined) return;
	if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string"))
		throw error("corrupt", `Invalid ${field} in ${file ?? "work store"}`);
}
function plainObject(value) {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function hierarchyError(message, file, details = {}) {
	return error("corrupt", `${message} in ${file}`, {
		repair:
			"Repair the parent graph or initiative metadata before retrying mutation.",
		...details,
	});
}
function nonemptyString(value) {
	return typeof value === "string" && Boolean(value.trim());
}
function validateInitiativeMetadata(item, file) {
	const metadata = item.initiative;
	if (
		!plainObject(metadata) ||
		metadata.schemaVersion !== INITIATIVE_SCHEMA_VERSION
	)
		throw hierarchyError(`Invalid initiative metadata for ${item.id}`, file);
	if (!Array.isArray(metadata.sources) || metadata.sources.length === 0)
		throw hierarchyError(`Initiative ${item.id} has no sources`, file);
	const sourceIds = new Set();
	for (const source of metadata.sources) {
		if (
			!plainObject(source) ||
			!nonemptyString(source.id) ||
			!nonemptyString(source.path) ||
			source.path.includes("\\") ||
			path.posix.isAbsolute(source.path) ||
			path.win32.isAbsolute(source.path) ||
			path.posix.normalize(source.path) !== source.path ||
			source.path === ".." ||
			source.path.startsWith("../") ||
			!nonemptyString(source.hash) ||
			sourceIds.has(source.id)
		)
			throw hierarchyError(`Invalid initiative source for ${item.id}`, file);
		sourceIds.add(source.id);
	}
	if (!Array.isArray(metadata.coverage) || metadata.coverage.length === 0)
		throw hierarchyError(`Initiative ${item.id} has no outcome coverage`, file);
	const ids = new Set();
	const provenance = new Set();
	for (const outcome of metadata.coverage) {
		if (
			!plainObject(outcome) ||
			!nonemptyString(outcome.id) ||
			!nonemptyString(outcome.provenance) ||
			!nonemptyString(outcome.contentHash) ||
			!["accepted", "rejected", "non_goal"].includes(outcome.disposition) ||
			ids.has(outcome.id) ||
			provenance.has(outcome.provenance)
		)
			throw hierarchyError(`Invalid initiative coverage for ${item.id}`, file);
		if ((outcome.disposition === "accepted") !== nonemptyString(outcome.epicId))
			throw hierarchyError(`Invalid outcome mapping for ${outcome.id}`, file);
		if (outcome.generated !== undefined && !plainObject(outcome.generated))
			throw hierarchyError(
				`Invalid generated-field identity for ${outcome.id}`,
				file,
			);
		ids.add(outcome.id);
		provenance.add(outcome.provenance);
	}
	if (
		metadata.childOrder !== undefined &&
		(!Array.isArray(metadata.childOrder) ||
			metadata.childOrder.some((id) => !nonemptyString(id)) ||
			new Set(metadata.childOrder).size !== metadata.childOrder.length)
	)
		throw hierarchyError(`Invalid initiative child order for ${item.id}`, file);
	if (
		metadata.evidence !== undefined &&
		(!Array.isArray(metadata.evidence) ||
			metadata.evidence.some((entry) => !plainObject(entry)))
	)
		throw hierarchyError(`Invalid initiative evidence for ${item.id}`, file);
	if (
		metadata.lastConfirmed !== undefined &&
		!plainObject(metadata.lastConfirmed)
	)
		throw hierarchyError(`Invalid initiative confirmation for ${item.id}`, file);
	return metadata;
}
function validateParentGraph(items, file) {
	const complete = new Set();
	for (const id of Object.keys(items)) {
		const chain = new Set();
		let cursor = id;
		while (cursor && !complete.has(cursor)) {
			if (chain.has(cursor))
				throw hierarchyError(`Parent cycle detected at ${cursor}`, file, {
					cycleAt: cursor,
				});
			chain.add(cursor);
			cursor = items[cursor]?.parentId;
		}
		for (const entry of chain) complete.add(entry);
	}
}
function validateInitiativeHierarchy(items, file) {
	const values = Object.values(items);
	const childrenByParent = new Map();
	for (const item of values) {
		if (!item.parentId) continue;
		const children = childrenByParent.get(item.parentId) ?? [];
		children.push(item);
		childrenByParent.set(item.parentId, children);
	}
	for (const item of values) {
		const parent = items[item.parentId];
		const grandparent = items[parent?.parentId];
		if (
			item.type === "epic" &&
			parent?.type === "epic" &&
			grandparent?.initiative
		)
			throw hierarchyError(
				`Initiative ${grandparent.id} cannot contain nested roadmap ${item.id}`,
				file,
			);
		const labels = item.labels ?? [];
		const labelCount = labels.filter(
			(label) => label === INITIATIVE_LABEL,
		).length;
		const hasMetadata = item.initiative !== undefined;
		if ((labelCount === 1) !== hasMetadata)
			throw hierarchyError(
				`Initiative label and metadata disagree for ${item.id}`,
				file,
			);
		if (labelCount > 1)
			throw hierarchyError(`Duplicate initiative label for ${item.id}`, file);
		if (!hasMetadata) continue;
		if (item.type !== "epic" || item.parentId)
			throw hierarchyError(
				`Initiative ${item.id} must be a top-level roadmap`,
				file,
			);
		const metadata = validateInitiativeMetadata(item, file);
		const children = childrenByParent.get(item.id) ?? [];
		if (
			children.some(
				(child) => child.type !== "epic" || child.initiative !== undefined,
			)
		)
			throw hierarchyError(
				`Initiative ${item.id} has an invalid direct child`,
				file,
			);
		const acceptedEpicIds = new Set(
			metadata.coverage
				.filter((outcome) => outcome.disposition === "accepted")
				.map((outcome) => outcome.epicId),
		);
		if (
			metadata.childOrder !== undefined &&
			(metadata.childOrder.length !== acceptedEpicIds.size ||
				metadata.childOrder.some((epicId) => !acceptedEpicIds.has(epicId)))
		)
			throw hierarchyError(
				`Initiative ${item.id} child order does not cover direct children`,
				file,
			);
		for (const epicId of acceptedEpicIds)
			if (
				!items[epicId] ||
				items[epicId].parentId !== item.id ||
				items[epicId].type !== "epic"
			)
				throw hierarchyError(
					`Outcome maps outside initiative ${item.id}: ${epicId}`,
					file,
				);
		for (const child of children)
			if (!acceptedEpicIds.has(child.id))
				throw hierarchyError(
					`Initiative child ${child.id} has no outcome coverage`,
					file,
				);
	}
}

export function validateStore(store, file = "work store") {
	if (!store || typeof store !== "object" || Array.isArray(store))
		throw error("corrupt", `Work store must be an object: ${file}`);
	if (store.schemaVersion !== WORK_STORE_VERSION) {
		const category =
			Number(store.schemaVersion) > WORK_STORE_VERSION ? "unsupported" : "corrupt";
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
		if (!TYPES.has(item.type))
			throw error(
				"corrupt",
				`Invalid work item type ${JSON.stringify(item.type)} for ${key} in ${file}`,
			);
		if (!STATUSES.has(item.status) || typeof item.title !== "string")
			throw error("corrupt", `Invalid work item ${key} in ${file}`);
		if (item.parentId !== undefined && typeof item.parentId !== "string")
			throw error("corrupt", `Invalid parent for ${key} in ${file}`);
		stringArray(item.dependencies, `dependencies for ${key}`, file);
		stringArray(item.labels, `labels for ${key}`, file);
		stringArray(item.notes, `notes for ${key}`, file);
		if (item.verificationContract !== undefined) {
			try {
				validateVerificationContract(
					item.verificationContract,
					`verificationContract for ${key}`,
				);
			} catch (error) {
				throw new WorkStoreError("corrupt", `${error.message} in ${file}`);
			}
		}
		if (
			item.implementationScope !== undefined &&
			(!plainObject(item.implementationScope) ||
				!Array.isArray(item.implementationScope.files) ||
				!Array.isArray(item.implementationScope.surfaces) ||
				!Array.isArray(item.implementationScope.nonGoals) ||
				[
					item.implementationScope.files,
					item.implementationScope.surfaces,
					item.implementationScope.nonGoals,
				].some(
					(entries) =>
						entries.length > 64 ||
						entries.some((entry) => typeof entry !== "string" || entry.length > 500),
				) ||
				typeof item.implementationScope.discoveryAllowed !== "boolean" ||
				typeof item.implementationScope.outcome !== "string")
		)
			throw error("corrupt", `Invalid implementation scope for ${key} in ${file}`);
		if (
			item.executionWindow !== undefined &&
			(!plainObject(item.executionWindow) ||
				!Number.isInteger(item.executionWindow.generation) ||
				item.executionWindow.generation < 1 ||
				!new Set(["active", "blocked", "closed"]).has(item.executionWindow.state) ||
				["ownerSession", "goalId", "acquiredAt", "updatedAt"].some(
					(field) =>
						typeof item.executionWindow[field] !== "string" ||
						!item.executionWindow[field] ||
						item.executionWindow[field].length > 200,
				))
		)
			throw error("corrupt", `Invalid execution window for ${key} in ${file}`);
		if (
			item.verificationRevision !== undefined &&
			(typeof item.verificationRevision !== "string" ||
				!item.verificationRevision.trim() ||
				item.verificationRevision.length > 200)
		)
			throw error(
				"corrupt",
				`Invalid verification revision for ${key} in ${file}`,
			);
		for (const [field, entries] of [
			["evidence", item.evidence],
			["verificationWaivers", item.verificationWaivers],
			["dependencyEdges", item.dependencyEdges],
		])
			if (
				entries !== undefined &&
				(!Array.isArray(entries) ||
					entries.some(
						(entry) => !entry || typeof entry !== "object" || Array.isArray(entry),
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
	validateParentGraph(store.items, file);
	validateInitiativeHierarchy(store.items, file);
	return store;
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
