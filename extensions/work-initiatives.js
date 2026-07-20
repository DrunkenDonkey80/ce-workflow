import { createHash, randomUUID } from "node:crypto";
import {
	INITIATIVE_LABEL,
	INITIATIVE_SCHEMA_VERSION,
	validateStore,
} from "./work-store.js";

export const INITIATIVE_PROJECTION_VERSION = 1;
export const INITIATIVE_PROPOSAL_VERSION = 1;

export class InitiativeError extends Error {
	constructor(code, message, details = {}) {
		super(message);
		this.name = "InitiativeError";
		this.code = code;
		Object.assign(this, details);
	}
}

function fail(code, message, details) {
	throw new InitiativeError(code, message, details);
}
function object(value) {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function text(value) {
	return typeof value === "string" && Boolean(value.trim());
}
function canonicalize(value) {
	if (Array.isArray(value)) return value.map(canonicalize);
	if (!object(value)) return value;
	return Object.fromEntries(
		Object.keys(value)
			.sort()
			.filter((key) => value[key] !== undefined)
			.map((key) => [key, canonicalize(value[key])]),
	);
}
export function initiativeHash(value) {
	return createHash("sha256")
		.update(JSON.stringify(canonicalize(value)))
		.digest("hex");
}
function canonicalToken(payload) {
	const encoded = Buffer.from(JSON.stringify(canonicalize(payload))).toString(
		"base64url",
	);
	return `${encoded}.${initiativeHash(payload)}`;
}
export function decodeInitiativeToken(token) {
	try {
		const [encoded, signature, extra] = String(token).split(".");
		if (!encoded || !signature || extra) throw new Error("shape");
		const payload = JSON.parse(
			Buffer.from(encoded, "base64url").toString("utf8"),
		);
		if (initiativeHash(payload) !== signature) throw new Error("signature");
		return payload;
	} catch {
		return fail("approval_failure", "Invalid initiative preview token.");
	}
}

export function normalizeInitiativeProposal(input) {
	if (!object(input) || input.schemaVersion !== INITIATIVE_PROPOSAL_VERSION)
		return fail("invalid_proposal", "Unsupported initiative proposal schema.");
	if ("patch" in input || "operations" in input)
		return fail(
			"invalid_proposal",
			"Initiative proposals cannot contain raw patches.",
		);
	const mode = input.mode ?? "wrap";
	if (
		!["wrap", "convert"].includes(mode) ||
		!text(input.targetId) ||
		!object(input.initiative) ||
		!text(input.initiative.id) ||
		!text(input.initiative.title) ||
		(mode === "wrap" && input.initiative.id === input.targetId) ||
		(mode === "convert" && input.initiative.id !== input.targetId)
	)
		return fail(
			"invalid_proposal",
			"Initiative target and identity are invalid.",
		);
	if (!Array.isArray(input.sources) || input.sources.length === 0)
		return fail("invalid_proposal", "Initiative proposal requires sources.");
	const sources = input.sources.map((source) => {
		if (
			!object(source) ||
			!text(source.id) ||
			!text(source.path) ||
			source.path.includes("\\") ||
			/^(?:[A-Za-z]:|\/)/.test(source.path) ||
			source.path.split("/").includes("..") ||
			!text(source.hash)
		)
			return fail("invalid_proposal", "Initiative source is invalid.");
		return { id: source.id, path: source.path, hash: source.hash };
	});
	if (new Set(sources.map((source) => source.id)).size !== sources.length)
		return fail("ambiguous_lineage", "Initiative source IDs must be unique.");
	if (!Array.isArray(input.groups) || input.groups.length === 0)
		return fail(
			"incomplete_coverage",
			"Initiative proposal requires delivery groups.",
		);
	const groups = input.groups.map((group) => {
		if (!object(group) || !text(group.id) || !text(group.title))
			return fail("invalid_proposal", "Initiative delivery group is invalid.");
		return {
			id: group.id,
			title: group.title,
			...(group.description !== undefined
				? { description: String(group.description) }
				: {}),
			...(text(group.epicId) ? { epicId: group.epicId } : {}),
			...(group.selected === true ? { selected: true } : {}),
		};
	});
	if (new Set(groups.map((group) => group.id)).size !== groups.length)
		return fail("ambiguous_lineage", "Initiative group IDs must be unique.");
	const explicitEpics = groups.flatMap((group) =>
		group.epicId ? [group.epicId] : [],
	);
	if (new Set(explicitEpics).size !== explicitEpics.length)
		return fail(
			"ambiguous_lineage",
			"A roadmap cannot represent multiple delivery groups.",
		);
	if (
		(mode === "wrap" &&
			!groups.some((group) => group.epicId === input.targetId)) ||
		(mode === "convert" &&
			groups.some((group) => group.epicId === input.targetId))
	)
		return fail(
			"incomplete_coverage",
			"Delivery groups do not match the promotion mode.",
		);
	if (
		mode === "convert" &&
		groups.filter((group) => group.selected).length !== 1
	)
		return fail(
			"incomplete_coverage",
			"Conversion requires exactly one selected child roadmap.",
		);
	if (!Array.isArray(input.outcomes) || input.outcomes.length === 0)
		return fail(
			"incomplete_coverage",
			"Initiative proposal requires outcomes.",
		);
	const groupIds = new Set(groups.map((group) => group.id));
	const outcomes = input.outcomes.map((outcome) => {
		if (
			!object(outcome) ||
			!text(outcome.provenance) ||
			!text(outcome.contentHash) ||
			!["accepted", "rejected", "non_goal"].includes(outcome.disposition)
		)
			return fail("invalid_proposal", "Initiative outcome is invalid.");
		const id = text(outcome.id)
			? outcome.id
			: `outcome-${initiativeHash(outcome.provenance).slice(0, 12)}`;
		if (
			(outcome.disposition === "accepted") !==
			(text(outcome.groupId) && groupIds.has(outcome.groupId))
		)
			return fail(
				"incomplete_coverage",
				`Outcome ${id} has incomplete coverage.`,
			);
		return {
			id,
			provenance: outcome.provenance,
			contentHash: outcome.contentHash,
			disposition: outcome.disposition,
			...(outcome.disposition === "accepted"
				? { groupId: outcome.groupId }
				: {}),
		};
	});
	if (
		new Set(outcomes.map((outcome) => outcome.id)).size !== outcomes.length ||
		new Set(outcomes.map((outcome) => outcome.provenance)).size !==
			outcomes.length
	)
		return fail(
			"ambiguous_lineage",
			"Outcome IDs and provenance must be unique.",
		);
	for (const group of groups)
		if (
			!outcomes.some(
				(outcome) =>
					outcome.disposition === "accepted" && outcome.groupId === group.id,
			)
		)
			return fail(
				"incomplete_coverage",
				`Delivery group ${group.id} has no accepted outcome.`,
			);
	return {
		schemaVersion: INITIATIVE_PROPOSAL_VERSION,
		mode,
		targetId: input.targetId,
		initiative: {
			id: input.initiative.id,
			title: input.initiative.title,
			...(input.initiative.description !== undefined
				? { description: String(input.initiative.description) }
				: {}),
		},
		sources: sources.sort((left, right) => left.id.localeCompare(right.id)),
		groups: groups.sort((left, right) => left.id.localeCompare(right.id)),
		outcomes: outcomes.sort((left, right) => left.id.localeCompare(right.id)),
	};
}

function mappedGroups(store, proposal) {
	const priorCoverage =
		store.items[proposal.initiative.id]?.initiative?.coverage ?? [];
	const priorByOutcome = new Map(
		priorCoverage
			.filter((outcome) => outcome.disposition === "accepted")
			.map((outcome) => [outcome.id, outcome.epicId]),
	);
	const occupied = new Set(Object.keys(store.items));
	let suffix = 1;
	return proposal.groups.map((group) => {
		const prior = new Set(
			proposal.outcomes
				.filter((outcome) => outcome.groupId === group.id)
				.map((outcome) => priorByOutcome.get(outcome.id))
				.filter(Boolean),
		);
		if (prior.size > 1)
			return fail(
				"ambiguous_lineage",
				`Delivery group ${group.id} maps to multiple roadmaps.`,
			);
		const priorEpicId = [...prior][0];
		if (group.epicId && priorEpicId && group.epicId !== priorEpicId)
			return fail(
				"ambiguous_lineage",
				`Delivery group ${group.id} conflicts with durable coverage.`,
			);
		let epicId = group.epicId ?? priorEpicId;
		while (!epicId) {
			const candidate = `${proposal.initiative.id}.${suffix++}`;
			if (!occupied.has(candidate)) epicId = candidate;
		}
		occupied.add(epicId);
		return { ...group, epicId };
	});
}

function generatedIdentity(item) {
	return {
		titleHash: initiativeHash(item.title ?? ""),
		descriptionHash: initiativeHash(item.description ?? ""),
	};
}

export function buildInitiativeReconciliation(store, input) {
	validateStore(store);
	const proposal = normalizeInitiativeProposal(input);
	const target = store.items[proposal.targetId];
	if (
		!target ||
		target.type !== "epic" ||
		(proposal.mode === "wrap" && isInitiative(target)) ||
		(proposal.mode === "convert" &&
			isInitiative(target) &&
			target.id !== proposal.initiative.id)
	)
		return fail(
			"invalid_proposal",
			"Initiative target must be a compatible roadmap.",
		);
	const existingInitiative = store.items[proposal.initiative.id];
	const currentInitiative = isInitiative(existingInitiative)
		? existingInitiative
		: undefined;
	if (
		existingInitiative &&
		!currentInitiative &&
		!(proposal.mode === "convert" && existingInitiative.id === target.id)
	)
		return fail(
			"protected_field_conflict",
			"Initiative ID is already used by another record.",
		);
	const groups = mappedGroups(store, proposal);
	const candidate = structuredClone(store);
	const operations = [];
	const conflicts = [];
	const timestamp = store.metadata.updatedAt ?? store.metadata.createdAt;
	if (!currentInitiative) {
		if (proposal.mode === "convert")
			candidate.items[proposal.initiative.id] = {
				...candidate.items[proposal.targetId],
				status: "open",
				labels: [
					...new Set([
						...(candidate.items[proposal.targetId].labels ?? []),
						INITIATIVE_LABEL,
					]),
				],
			};
		else
			candidate.items[proposal.initiative.id] = {
				id: proposal.initiative.id,
				type: "epic",
				status: "open",
				title: proposal.initiative.title,
				...(proposal.initiative.description !== undefined
					? { description: proposal.initiative.description }
					: {}),
				createdAt: timestamp,
				updatedAt: timestamp,
				dependencies: [],
				labels: [INITIATIVE_LABEL],
				notes: [],
				evidence: [],
				dependencyEdges: [],
			};
		operations.push({
			kind:
				proposal.mode === "convert"
					? "convert_to_initiative"
					: "create_initiative",
			id: proposal.initiative.id,
		});
	}
	const priorCoverage = currentInitiative?.initiative?.coverage ?? [];
	const proposedByOutcome = new Map(
		proposal.outcomes.map((outcome) => [outcome.id, outcome]),
	);
	for (const prior of priorCoverage) {
		const proposed = proposedByOutcome.get(prior.id);
		if (!proposed)
			conflicts.push({ kind: "missing_outcome", outcomeId: prior.id });
		else if (
			proposed.provenance !== prior.provenance ||
			proposed.contentHash !== prior.contentHash
		)
			conflicts.push({ kind: "outcome_identity", outcomeId: prior.id });
	}
	for (const group of groups) {
		const existing = candidate.items[group.epicId];
		if (!existing) {
			candidate.items[group.epicId] = {
				id: group.epicId,
				type: "epic",
				status: "open",
				title: group.title,
				...(group.description !== undefined
					? { description: group.description }
					: {}),
				createdAt: timestamp,
				updatedAt: timestamp,
				parentId: proposal.initiative.id,
				dependencies: [],
				labels: [],
				notes: [],
				evidence: [],
				dependencyEdges: [],
			};
			operations.push({ kind: "create_epic", id: group.epicId });
			continue;
		}
		if (
			existing.type !== "epic" ||
			(existing.parentId && existing.parentId !== proposal.initiative.id)
		)
			return fail(
				"protected_field_conflict",
				`Cannot attach roadmap ${group.epicId}.`,
			);
		const prior = priorCoverage.find(
			(outcome) => outcome.epicId === group.epicId,
		)?.generated;
		if (prior) {
			for (const [field, expectedHash] of [
				["title", prior.titleHash],
				["description", prior.descriptionHash],
			]) {
				const proposed = group[field] ?? "";
				const current = existing[field] ?? "";
				if (initiativeHash(current) !== expectedHash && proposed !== current)
					conflicts.push({ kind: "manual_field", epicId: group.epicId, field });
				else if (proposed !== current) {
					candidate.items[group.epicId][field] = proposed;
					operations.push({ kind: "update_epic", id: group.epicId, field });
				}
			}
		}
		if (existing.parentId !== proposal.initiative.id) {
			candidate.items[group.epicId].parentId = proposal.initiative.id;
			operations.push({ kind: "reparent_epic", id: group.epicId });
		}
	}
	if (proposal.mode === "convert" && !currentInitiative) {
		const selected = groups.find((group) => group.selected);
		for (const child of Object.values(candidate.items).filter(
			(item) => item.parentId === proposal.targetId && item.type !== "epic",
		)) {
			child.parentId = selected.epicId;
			operations.push({ kind: "reparent_record", id: child.id });
		}
	}
	const groupById = new Map(groups.map((group) => [group.id, group]));
	const coverage = proposal.outcomes.map((outcome) => {
		if (outcome.disposition !== "accepted") {
			const previous = priorCoverage.find((entry) => entry.id === outcome.id);
			if (!previous || previous.disposition !== outcome.disposition)
				operations.push({ kind: "set_disposition", id: outcome.id });
			return {
				id: outcome.id,
				provenance: outcome.provenance,
				contentHash: outcome.contentHash,
				disposition: outcome.disposition,
			};
		}
		const epicId = groupById.get(outcome.groupId).epicId;
		return {
			id: outcome.id,
			provenance: outcome.provenance,
			contentHash: outcome.contentHash,
			disposition: "accepted",
			epicId,
			generated: generatedIdentity(candidate.items[epicId]),
		};
	});
	if (conflicts.length)
		return {
			proposal,
			candidate: store,
			operations: [],
			conflicts,
			changed: false,
		};
	const proposalHash = initiativeHash(proposal);
	const identity = {
		proposalHash,
		sourceHashes: Object.fromEntries(
			proposal.sources.map((source) => [source.path, source.hash]),
		),
	};
	const priorMetadata = currentInitiative?.initiative;
	const metadataChanged =
		!priorMetadata ||
		initiativeHash({
			sources: priorMetadata.sources,
			coverage: priorMetadata.coverage,
		}) !== initiativeHash({ sources: proposal.sources, coverage });
	if (currentInitiative && metadataChanged)
		operations.push({ kind: "update_coverage", id: proposal.initiative.id });
	const initiative = candidate.items[proposal.initiative.id];
	const evidence = priorMetadata?.evidence
		? structuredClone(priorMetadata.evidence)
		: [];
	if (operations.length)
		evidence.push({
			id: initiativeHash({ before: initiativeHash(store), proposalHash }),
			proposalHash,
			operations: structuredClone(operations),
		});
	initiative.initiative = {
		...(priorMetadata ?? {}),
		schemaVersion: INITIATIVE_SCHEMA_VERSION,
		sources: structuredClone(proposal.sources),
		coverage,
		lastConfirmed: identity,
		evidence,
	};
	validateStore(candidate);
	return {
		proposal,
		candidate,
		groups,
		coverage,
		operations,
		conflicts,
		changed: initiativeHash(candidate) !== initiativeHash(store),
	};
}

export function previewInitiativeCandidate(store, input) {
	const reconciliation = buildInitiativeReconciliation(store, input);
	const payload = {
		schemaVersion: 1,
		nonce: randomUUID(),
		targetId: reconciliation.proposal.targetId,
		storeHash: initiativeHash(store),
		proposalHash: initiativeHash(reconciliation.proposal),
		sourceHashes: Object.fromEntries(
			reconciliation.proposal.sources.map((source) => [
				source.path,
				source.hash,
			]),
		),
		candidateHash: initiativeHash(reconciliation.candidate),
	};
	return {
		schemaVersion: 1,
		targetId: reconciliation.proposal.targetId,
		initiativeId: reconciliation.proposal.initiative.id,
		proposed: {
			initiative: structuredClone(reconciliation.proposal.initiative),
			epics: (reconciliation.groups ?? []).map((group) => ({
				id: group.epicId,
				groupId: group.id,
				title: group.title,
				...(group.description !== undefined
					? { description: group.description }
					: {}),
				...(group.selected ? { selected: true } : {}),
			})),
			coverage: structuredClone(reconciliation.coverage ?? []),
		},
		operations: reconciliation.operations,
		conflicts: reconciliation.conflicts,
		noop: !reconciliation.changed,
		storeHash: payload.storeHash,
		proposalHash: payload.proposalHash,
		sourceHashes: payload.sourceHashes,
		token: canonicalToken(payload),
	};
}

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
	return {
		closed,
		total,
		percent: total ? Math.round((closed / total) * 100) : 0,
	};
}

function readinessFor(item, readinessByEpic) {
	const readiness = readinessByEpic[item.id];
	if (
		readiness &&
		["needs_plan", "planned", "stale"].includes(readiness.state) &&
		typeof readiness.reason === "string"
	)
		return {
			state: readiness.state,
			reason: readiness.reason,
			implementationReady: readiness.state === "planned",
		};
	return {
		state: "needs_plan",
		reason: "No implementation-ready plan is linked.",
		implementationReady: false,
	};
}

function epicActions(item) {
	return item.status === "closed"
		? ["plan", "tasks", "report", "set_current", "reopen"]
		: ["plan", "resume", "tasks", "report", "set_current", "close"];
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

export function projectInitiativeHierarchy(
	store,
	readinessByEpic = {},
	lineageByInitiative = {},
) {
	validateStore(store);
	const items = Object.values(store.items);
	const epics = items.filter((item) => item.type === "epic");
	const roots = epics.filter((item) => !item.parentId).sort(byUpdatedThenId);
	const childrenByParent = new Map();
	const localItemsByParent = new Map();
	for (const item of items.filter((entry) => entry.parentId)) {
		let target;
		if (item.type === "epic") target = childrenByParent;
		else if (item.type !== "decision" && item.type !== "idea")
			target = localItemsByParent;
		if (!target) continue;
		const children = target.get(item.parentId) ?? [];
		children.push(item);
		target.set(item.parentId, children);
	}
	for (const children of childrenByParent.values())
		children.sort(byUpdatedThenId);

	const nodeFor = (epic) => {
		const initiative = isInitiative(epic);
		const childEpics = childrenByParent.get(epic.id) ?? [];
		const localItems = localItemsByParent.get(epic.id) ?? [];
		const readiness = initiative
			? {
					state: "aggregate",
					reason: "Child roadmaps are planned independently.",
				}
			: readinessFor(epic, readinessByEpic);
		let conflicts = [];
		if (initiative)
			conflicts = [
				...childEpics
					.filter(
						(child) => readinessFor(child, readinessByEpic).state === "stale",
					)
					.map((child) => `stale_plan:${child.id}`),
				...(lineageByInitiative[epic.id]?.conflicts ?? []),
			];
		else if (readiness.state === "stale") conflicts = [`stale_plan:${epic.id}`];
		const closeBlockers = initiative
			? [
					...childEpics
						.filter((child) => child.status !== "closed")
						.map((child) => `unresolved_child:${child.id}`),
					...conflicts,
				]
			: [];
		const dispositions = initiative
			? epic.initiative.coverage.reduce(
					(counts, outcome) => ({
						...counts,
						[outcome.disposition]: counts[outcome.disposition] + 1,
					}),
					{ accepted: 0, rejected: 0, non_goal: 0 },
				)
			: undefined;
		let role = "standalone_epic";
		if (initiative) role = "initiative";
		else if (epic.parentId && isInitiative(store.items[epic.parentId]))
			role = "child_epic";
		return {
			id: epic.id,
			title: epic.title,
			status: epic.status,
			role,
			...(epic.parentId ? { parentId: epic.parentId } : {}),
			children: childEpics.map((child) => child.id),
			readiness,
			localProgress: progress(localItems),
			aggregateProgress: initiative
				? progress(childEpics)
				: progress(localItems),
			conflicts,
			...(initiative ? { coverage: dispositions, closeBlockers } : {}),
			legalActions: initiative ? initiativeActions(epic) : epicActions(epic),
			closeAllowed: !initiative || closeBlockers.length === 0,
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
