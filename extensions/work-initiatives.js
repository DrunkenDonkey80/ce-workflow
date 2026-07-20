import {
	INITIATIVE_LABEL,
	validateStore,
} from "./work-store.js";

export const INITIATIVE_PROJECTION_VERSION = 1;

export function isInitiative(item) {
	return (
		item?.type === "epic" &&
		item?.initiative !== undefined &&
		item?.labels?.includes(INITIATIVE_LABEL)
	);
}

function byUpdatedThenId(left, right) {
	return (
		String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? "")) ||
		left.id.localeCompare(right.id)
	);
}

function progress(items) {
	const total = items.length;
	const closed = items.filter((item) => item.status === "closed").length;
	return { closed, total, percent: total ? Math.round((closed / total) * 100) : 0 };
}

function readinessFor(item, readinessByEpic) {
	const readiness = readinessByEpic[item.id];
	if (
		readiness &&
		["needs_plan", "planned", "stale"].includes(readiness.state) &&
		typeof readiness.reason === "string"
	)
		return { state: readiness.state, reason: readiness.reason };
	return { state: "needs_plan", reason: "No implementation-ready plan is linked." };
}

function epicActions(item) {
	return item.status === "closed"
		? ["plan", "tasks", "report", "reopen"]
		: ["plan", "resume", "tasks", "report", "close"];
}

function initiativeActions(item) {
	return [
		"inspect",
		"report",
		"preview",
		"apply",
		"plan_child",
		"select_child",
		item.status === "closed" ? "reopen" : "close",
	];
}

export function projectInitiativeHierarchy(store, readinessByEpic = {}) {
	validateStore(store);
	const items = Object.values(store.items);
	const epics = items.filter((item) => item.type === "epic");
	const roots = epics
		.filter((item) => !item.parentId)
		.sort(byUpdatedThenId);
	const childrenByParent = new Map();
	for (const epic of epics.filter((item) => item.parentId)) {
		const children = childrenByParent.get(epic.parentId) ?? [];
		children.push(epic);
		childrenByParent.set(epic.parentId, children);
	}
	for (const children of childrenByParent.values()) children.sort(byUpdatedThenId);

	const nodeFor = (epic) => {
		const initiative = isInitiative(epic);
		const childEpics = childrenByParent.get(epic.id) ?? [];
		const localItems = items.filter(
			(item) =>
				item.parentId === epic.id &&
				item.type !== "epic" &&
				item.type !== "decision" &&
				item.type !== "idea",
		);
		const readiness = initiative
			? {
					state: "aggregate",
					reason: "Child epics are planned independently.",
				}
			: readinessFor(epic, readinessByEpic);
		const conflicts = initiative
			? childEpics
					.filter((child) => readinessFor(child, readinessByEpic).state === "stale")
					.map((child) => `stale_plan:${child.id}`)
			: readiness.state === "stale"
				? [`stale_plan:${epic.id}`]
				: [];
		return {
			id: epic.id,
			title: epic.title,
			status: epic.status,
			role: initiative
				? "initiative"
				: epic.parentId && isInitiative(store.items[epic.parentId])
					? "child_epic"
					: "standalone_epic",
			...(epic.parentId ? { parentId: epic.parentId } : {}),
			children: childEpics.map((child) => child.id),
			readiness,
			localProgress: progress(localItems),
			aggregateProgress: initiative ? progress(childEpics) : progress(localItems),
			conflicts,
			legalActions: initiative ? initiativeActions(epic) : epicActions(epic),
			closeAllowed:
				!initiative ||
				(childEpics.every((child) => child.status === "closed") &&
					conflicts.length === 0),
		};
	};

	const nodes = roots.flatMap((root) => [
		nodeFor(root),
		...(childrenByParent.get(root.id) ?? []).map(nodeFor),
	]);
	return {
		schemaVersion: INITIATIVE_PROJECTION_VERSION,
		roots: roots.map((root) => root.id),
		nodes,
	};
}
