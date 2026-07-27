import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
	appendFileSync,
	closeSync,
	existsSync,
	fsyncSync,
	mkdirSync,
	openSync,
	readFileSync,
} from "node:fs";
import path from "node:path";
import {
	acquireRepositoryAdmissionLock,
	loadLaneStore,
	repositoryMutationLocked,
} from "./read-only-lanes.js";
import { loadStore, readyWorkItems, storePath } from "./work-store.js";

export const WORK_ACTION_LEASE_VERSION = 2;
const OCCUPIED = new Set([
	"queued",
	"claimed",
	"acknowledged",
	"ambiguous",
	"live",
	"orphaned",
	"parked",
]);
const ROLE_EVIDENCE = Object.freeze({
	planner: ["closed-planning-item", "ready-child"],
	builder: ["files-changed", "verification"],
	lead: ["files-changed", "verification"],
	debugger: ["files-changed", "verification"],
	reviewer: ["review-verdict"],
	fixer: ["files-changed", "verification"],
	migrator: ["files-changed", "verification"],
});

function canonical(value) {
	if (Array.isArray(value)) return value.map(canonical);
	if (!value || typeof value !== "object") return value;
	return Object.fromEntries(
		Object.keys(value)
			.sort()
			.map((key) => [key, canonical(value[key])]),
	);
}
function digest(value) {
	return createHash("sha256")
		.update(
			typeof value === "string" ? value : JSON.stringify(canonical(value)),
		)
		.digest("hex");
}
function gitHead(cwd) {
	const override = process.env.WORK_ORCH_GIT_BIN;
	const script = override && /\.[cm]?js$/i.test(override) ? override : null;
	return execFileSync(
		script ? process.execPath : override || "git",
		script ? [script, "rev-parse", "HEAD"] : ["rev-parse", "HEAD"],
		{ cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
	).trim();
}
function itemSuperseded(item) {
	return (
		String(item?.notes ?? "")
			.toLowerCase()
			.includes("superseded") ||
		(item?.labels ?? []).some((label) => /superseded/i.test(label))
	);
}
function itemContract(item) {
	return {
		id: item?.id,
		parentId: item?.parentId ?? item?.parent_id,
		title: item?.title,
		type: item?.type ?? item?.issue_type,
		description: item?.description ?? "",
		design: item?.design ?? "",
		acceptance: item?.acceptance ?? "",
		dependencies: item?.dependencies ?? [],
		labels: (item?.labels ?? []).filter(
			(label) => !String(label).startsWith("wo:review"),
		),
	};
}
function storeHash(cwd) {
	const file = storePath(cwd);
	if (!existsSync(file)) return digest("");
	const store = loadStore(cwd);
	return digest(
		Object.values(store.items)
			.map(itemContract)
			.sort((left, right) => String(left.id).localeCompare(String(right.id))),
	);
}
export function workActionLeasePath(cwd = process.cwd()) {
	return path.join(
		cwd,
		".ce-workflow",
		"work-runs",
		"direct",
		"pending-direct.jsonl",
	);
}
function appendEvent(cwd, event) {
	const file = workActionLeasePath(cwd);
	mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
	const descriptor = openSync(file, "a", 0o600);
	try {
		appendFileSync(descriptor, `${JSON.stringify(event)}\n`);
		fsyncSync(descriptor);
	} finally {
		closeSync(descriptor);
	}
	return event;
}
function actionLeaseLogMalformed(cwd) {
	try {
		if (!existsSync(workActionLeasePath(cwd))) return false;
		return readFileSync(workActionLeasePath(cwd), "utf8")
			.split(/\r?\n/)
			.filter(Boolean)
			.some((line) => {
				try {
					JSON.parse(line);
					return false;
				} catch {
					return true;
				}
			});
	} catch {
		return true;
	}
}

export function readWorkActionLeaseEvents(cwd = process.cwd()) {
	try {
		if (!existsSync(workActionLeasePath(cwd))) return [];
		return readFileSync(workActionLeasePath(cwd), "utf8")
			.split(/\r?\n/)
			.filter(Boolean)
			.flatMap((line) => {
				try {
					const event = JSON.parse(line);
					return event?.version === WORK_ACTION_LEASE_VERSION && event.leaseId
						? [event]
						: [];
				} catch {
					return [];
				}
			});
	} catch {
		return [];
	}
}
function validLease(event) {
	return (
		event?.version === WORK_ACTION_LEASE_VERSION &&
		event.type === "lease" &&
		typeof event.leaseId === "string" &&
		typeof event.workflowRunId === "string" &&
		typeof event.roadmapId === "string" &&
		typeof event.workItemId === "string" &&
		typeof event.action === "string" &&
		typeof event.semanticRole === "string" &&
		typeof event.requestedAssurance === "string" &&
		typeof event.baseHead === "string" &&
		typeof event.baseStoreHash === "string" &&
		typeof event.baseWorkItemHash === "string" &&
		Number.isInteger(event.generation) &&
		event.generation > 0 &&
		Array.isArray(event.allowedEvidence) &&
		event.allowedEvidence.every((item) => typeof item === "string") &&
		(event.launchIdentity === null || typeof event.launchIdentity === "object")
	);
}

export function currentWorkActionLeases(cwd = process.cwd()) {
	const leases = new Map();
	for (const event of readWorkActionLeaseEvents(cwd)) {
		if (event.type === "lease" && validLease(event))
			leases.set(event.leaseId, { ...event });
		else if (
			leases.has(event.leaseId) &&
			(typeof event.state === "string" || event.type === "candidate")
		)
			Object.assign(leases.get(event.leaseId), event, { type: "lease" });
	}
	return [...leases.values()];
}
export function occupiedWorkActionLease(cwd = process.cwd(), workItemId) {
	return currentWorkActionLeases(cwd).find(
		(lease) =>
			OCCUPIED.has(lease.state) &&
			(!workItemId || lease.workItemId === workItemId),
	);
}
function nextGeneration(cwd, workItemId) {
	return (
		Math.max(
			0,
			...currentWorkActionLeases(cwd)
				.filter((lease) => lease.workItemId === workItemId)
				.map((lease) => Number(lease.generation) || 0),
		) + 1
	);
}
function semanticRole(input) {
	const value = String(input ?? "").toLowerCase();
	return ROLE_EVIDENCE[value] ? value : "builder";
}
export function recoverParkedWorkActionLease(cwd, workItemId) {
	const item = loadStore(cwd).items[workItemId];
	if (!item || (item.labels ?? []).includes("wo:blocked")) return [];
	const recovered = currentWorkActionLeases(cwd).filter(
		(lease) => lease.workItemId === workItemId && lease.state === "parked",
	);
	for (const lease of recovered)
		fenceWorkActionLease(cwd, lease.leaseId, "operator-blocker-cleared");
	return recovered.map((lease) => lease.leaseId);
}

export function acquireWorkActionLease(cwd, input = {}) {
	if (
		!input.workflowRunId ||
		!input.roadmapId ||
		!input.workItemId ||
		!input.action
	)
		throw new Error(
			"Action lease requires workflow run, roadmap/item, and action",
		);
	const admission = acquireRepositoryAdmissionLock(cwd);
	try {
		if (actionLeaseLogMalformed(cwd))
			throw new Error("Mutable action lease log requires recovery");
		const store = loadStore(cwd);
		const item = store.items[input.workItemId];
		if (!item) throw new Error(`WorkItem is missing: ${input.workItemId}`);
		if (item.status === "closed")
			throw new Error(`WorkItem is closed: ${input.workItemId}`);
		if (itemSuperseded(item))
			throw new Error(`WorkItem is superseded: ${input.workItemId}`);
		recoverParkedWorkActionLease(cwd, input.workItemId);
		const occupied = currentWorkActionLeases(cwd).find(
			(lease) =>
				OCCUPIED.has(lease.state) &&
				(lease.state !== "parked" || lease.workItemId === input.workItemId),
		);
		if (occupied)
			throw new Error(
				`Mutable action lease is occupied by ${occupied.leaseId}`,
			);
		if (repositoryMutationLocked(cwd))
			throw new Error("Repository finalization mutation is active");
		const primaryLane = Object.values(loadLaneStore(cwd).lanes).find(
			(lane) =>
				lane.state === "running" && lane.resourceKeys.includes("repo:read"),
		);
		if (primaryLane)
			throw new Error(`Primary checkout lane is active: ${primaryLane.id}`);
		const role = semanticRole(
			input.semanticRole ?? input.agent ?? input.action,
		);
		const timestamp = new Date().toISOString();
		return appendEvent(cwd, {
			version: WORK_ACTION_LEASE_VERSION,
			type: "lease",
			leaseId: input.leaseId ?? `action-${randomUUID()}`,
			timestamp,
			state: input.claimed === false ? "queued" : "claimed",
			workflowRunId: input.workflowRunId,
			roadmapId: input.roadmapId,
			workItemId: input.workItemId,
			action: input.action,
			semanticRole: role,
			requestedAssurance: input.requestedAssurance ?? "normal",
			achievedAssurance:
				input.achievedAssurance ?? input.requestedAssurance ?? "normal",
			candidateKey: input.candidateKey ?? null,
			selectedCandidate: input.selectedCandidate ?? null,
			fallback: Boolean(input.fallback),
			degradedIndependence: Boolean(input.degradedIndependence),
			modelStrategy: input.modelStrategy ?? "main-first",
			baseHead: gitHead(cwd),
			baseStoreHash: storeHash(cwd),
			baseWorkItemHash: digest(itemContract(item)),
			generation: input.generation ?? nextGeneration(cwd, input.workItemId),
			allowedEvidence: [
				...(input.allowedEvidence ?? ROLE_EVIDENCE[role] ?? []),
			],
			launchIdentity: null,
			mode: input.mode ?? "rpc",
			session: input.session ?? null,
			activity: input.activity ?? null,
			agent: input.agent ?? null,
		});
	} finally {
		admission.release();
	}
}
export function recordWorkActionLeaseCandidate(cwd, leaseId, candidate = {}) {
	return appendEvent(cwd, {
		version: WORK_ACTION_LEASE_VERSION,
		type: "candidate",
		leaseId,
		timestamp: new Date().toISOString(),
		selectedCandidate: candidate.id ?? null,
		candidateModel: candidate.model ?? null,
		candidateThinking: candidate.thinking ?? null,
		fallback: Boolean(candidate.fallback),
		degradedIndependence: Boolean(candidate.degradedIndependence),
		achievedAssurance: candidate.achievedAssurance ?? "normal",
	});
}

export function acknowledgeWorkActionLease(cwd, leaseId, acknowledgement = {}) {
	const lease = currentWorkActionLeases(cwd).find(
		(item) => item.leaseId === leaseId,
	);
	if (!lease || !OCCUPIED.has(lease.state))
		throw new Error(`Action lease cannot acknowledge: ${leaseId}`);
	const identity =
		acknowledgement.runId || acknowledgement.asyncDir
			? {
					runId: acknowledgement.runId ?? null,
					asyncDir: acknowledgement.asyncDir ?? null,
				}
			: null;
	return appendEvent(cwd, {
		version: WORK_ACTION_LEASE_VERSION,
		type: "acknowledged",
		leaseId,
		timestamp: new Date().toISOString(),
		state: acknowledgement.ambiguous ? "ambiguous" : "acknowledged",
		launchIdentity: identity,
	});
}
export function fenceWorkActionLease(cwd, leaseId, reason, state = "fenced") {
	return appendEvent(cwd, {
		version: WORK_ACTION_LEASE_VERSION,
		type: state,
		leaseId,
		timestamp: new Date().toISOString(),
		state,
		reason,
	});
}
export function orphanWorkActionLease(
	cwd,
	leaseId,
	reason = "launch-not-live",
) {
	return fenceWorkActionLease(cwd, leaseId, reason, "orphaned");
}
function roleEvidence(store, lease, item) {
	const notes = String(item.notes ?? "").replaceAll("\\n", "\n");
	if (itemSuperseded(item))
		return { ok: false, reason: "work-item-superseded" };
	if (lease.semanticRole === "planner") {
		const children = readyWorkItems(store).filter(
			(child) =>
				(child.parentId ?? child.parent_id) === lease.roadmapId &&
				child.id !== lease.workItemId,
		);
		return item.status === "closed" && children.length
			? { ok: true }
			: { ok: false, reason: "planner-evidence-missing" };
	}
	if (item.status === "closed")
		return { ok: false, reason: "work-item-closed" };
	if (lease.semanticRole === "reviewer")
		return /wo:review\s+(?:PASS|FAIL)\b/i.test(notes)
			? { ok: true }
			: { ok: false, reason: "review-verdict-missing" };
	return /files changed\s*:\s*\S+/i.test(notes) &&
		/verification(?:\s+(?:run|result|status))?\s*:[^\n]*(?:pass|success|exit(?:ed)?\s*0|\bok\b)/i.test(
			notes,
		)
		? { ok: true }
		: { ok: false, reason: "role-evidence-missing" };
}
export function settleWorkActionLease(cwd, leaseId, terminal = {}) {
	const lease = currentWorkActionLeases(cwd).find(
		(item) => item.leaseId === leaseId,
	);
	if (!lease || !OCCUPIED.has(lease.state))
		return { ok: false, reason: "lease-not-occupied", lease };
	const reject = (reason) => {
		fenceWorkActionLease(cwd, leaseId, reason);
		return { ok: false, reason, lease };
	};
	if (terminal.ok !== true)
		return reject(terminal.reason ?? "specialist-failed");
	const latest = currentWorkActionLeases(cwd)
		.filter((item) => item.workItemId === lease.workItemId)
		.sort((a, b) => b.generation - a.generation)[0];
	if (latest?.leaseId !== leaseId || latest.generation !== lease.generation)
		return reject("stale-generation");
	if (gitHead(cwd) !== lease.baseHead) return reject("stale-head");
	const store = loadStore(cwd);
	const item = store.items[lease.workItemId];
	if (!item) return reject("work-item-missing");
	if (digest(itemContract(item)) !== lease.baseWorkItemHash)
		return reject("stale-work-item");
	if (
		lease.semanticRole !== "planner" &&
		storeHash(cwd) !== lease.baseStoreHash
	)
		return reject("stale-store");
	const evidence = roleEvidence(store, lease, item);
	if (!evidence.ok) return reject(evidence.reason);
	appendEvent(cwd, {
		version: WORK_ACTION_LEASE_VERSION,
		type: "settled",
		leaseId,
		timestamp: new Date().toISOString(),
		state: "settled",
		terminalEvidence: lease.allowedEvidence,
		settledStoreHash: storeHash(cwd),
	});
	return { ok: true, lease, item };
}
export function reconcileWorkActionLeaseLiveness(cwd, options = {}) {
	const now = options.now ? new Date(options.now).getTime() : Date.now();
	const orphanAfterMs = options.orphanAfterMs ?? 5 * 60 * 1000;
	const reconciled = [];
	for (const lease of currentWorkActionLeases(cwd)) {
		const age = now - new Date(lease.timestamp).getTime();
		if (!Number.isFinite(age) || age < orphanAfterMs) continue;
		if (lease.state === "orphaned") {
			fenceWorkActionLease(cwd, lease.leaseId, "orphan-timeout");
			reconciled.push(lease.leaseId);
			continue;
		}
		const asyncDir = lease.launchIdentity?.asyncDir;
		if (
			["queued", "claimed", "acknowledged", "ambiguous"].includes(
				lease.state,
			) &&
			!asyncDir
		) {
			fenceWorkActionLease(cwd, lease.leaseId, "launch-identity-timeout");
			reconciled.push(lease.leaseId);
			continue;
		}
		if (
			!["acknowledged", "ambiguous", "live"].includes(lease.state) ||
			!asyncDir
		)
			continue;
		if (existsSync(path.join(asyncDir, "status.json"))) continue;
		orphanWorkActionLease(cwd, lease.leaseId, "missing-launch-status");
		reconciled.push(lease.leaseId);
	}
	return reconciled;
}

export function workActionLeaseState(cwd, workItemId) {
	const lease = occupiedWorkActionLease(cwd, workItemId);
	if (!lease) return null;
	return {
		state: ["orphaned", "parked"].includes(lease.state) ? lease.state : "live",
		lease,
	};
}
