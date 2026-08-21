import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
	closeSync,
	existsSync,
	fsyncSync,
	mkdirSync,
	openSync,
	linkSync,
	lstatSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

export const READ_ONLY_LANE_VERSION = 1;
export const VERIFICATION_MANIFEST_VERSION = 1;
export const VERIFICATION_GATE_VERSION = "finish-verification-v1";
const STORE_VERSION = 1;
const STATES = new Set([
	"queued",
	"running",
	"completed",
	"promoted",
	"discarded",
	"failed",
	"orphaned",
]);
const TERMINAL = new Set(["promoted", "discarded", "failed", "orphaned"]);
const NEXT = {
	queued: new Set(["running", "discarded", "failed", "orphaned"]),
	running: new Set(["completed", "discarded", "failed", "orphaned"]),
	completed: new Set(["promoted", "discarded", "failed"]),
};

export class ReadOnlyLaneError extends Error {
	constructor(category, message, details = {}) {
		super(message);
		this.name = "ReadOnlyLaneError";
		this.category = category;
		Object.assign(this, details);
	}
}

function fail(category, message, details) {
	throw new ReadOnlyLaneError(category, message, details);
}
function plain(value) {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function text(value) {
	return typeof value === "string" && Boolean(value.trim());
}
function canonical(value) {
	if (Array.isArray(value)) return value.map(canonical);
	if (!plain(value)) return value;
	return Object.fromEntries(
		Object.keys(value)
			.sort()
			.map((key) => [key, canonical(value[key])]),
	);
}
function hash(value, length = 24) {
	return createHash("sha256")
		.update(typeof value === "string" ? value : JSON.stringify(canonical(value)))
		.digest("hex")
		.slice(0, length);
}
function timestamp(value) {
	return value ?? new Date().toISOString();
}
function sortedStrings(values, field) {
	if (!Array.isArray(values) || values.some((value) => !text(value)))
		fail("invalid", `Lane ${field} must be strings`);
	return [...new Set(values)].sort();
}
function relativePath(value) {
	if (
		!text(value) ||
		value.includes("\\") ||
		path.posix.isAbsolute(value) ||
		path.win32.isAbsolute(value) ||
		path.posix.normalize(value) !== value ||
		value === "." ||
		value === ".." ||
		value.startsWith("../")
	)
		fail("invalid", `Invalid lane path: ${value}`);
	return value;
}

export function createLaneEnvelope(input = {}) {
	const queuedAt = timestamp(input.now);
	const envelope = {
		version: READ_ONLY_LANE_VERSION,
		id: "",
		repository: input.repository,
		laneKind: input.laneKind,
		producer: input.producer,
		workItemId: input.workItemId,
		generation: input.generation,
		baseHead: input.baseHead,
		checkpoint: input.checkpoint,
		workItemHash: input.workItemHash,
		selectionHash: input.selectionHash,
		relevantPaths: sortedStrings(input.relevantPaths ?? [], "relevantPaths").map(
			relativePath,
		),
		resourceKeys: sortedStrings(input.resourceKeys ?? [], "resourceKeys"),
		gateVersion: input.gateVersion,
		settingsVersion: input.settingsVersion,
		promotionOwner: input.promotionOwner,
		state: "queued",
		artifact: null,
		timestamps: { queuedAt, updatedAt: queuedAt },
		reason: null,
		failureReason: null,
		discardReason: null,
		launch: null,
		metrics: null,
	};
	envelope.id = `lane-${hash({
		repository: envelope.repository,
		laneKind: envelope.laneKind,
		producer: envelope.producer,
		workItemId: envelope.workItemId,
		generation: envelope.generation,
		baseHead: envelope.baseHead,
		checkpoint: envelope.checkpoint,
		workItemHash: envelope.workItemHash,
		selectionHash: envelope.selectionHash,
	})}`;
	return validateLaneEnvelope(envelope);
}

export function validateLaneEnvelope(lane, file = "lane envelope") {
	if (
		!plain(lane) ||
		lane.version !== READ_ONLY_LANE_VERSION ||
		!text(lane.id) ||
		!text(lane.repository) ||
		!text(lane.laneKind) ||
		!text(lane.producer) ||
		!text(lane.workItemId) ||
		!Number.isInteger(lane.generation) ||
		lane.generation < 1 ||
		!/^[0-9a-f]{7,64}$/i.test(lane.baseHead ?? "") ||
		!text(lane.checkpoint) ||
		!text(lane.workItemHash) ||
		!text(lane.selectionHash) ||
		!text(lane.gateVersion) ||
		!text(lane.settingsVersion) ||
		!text(lane.promotionOwner) ||
		!STATES.has(lane.state) ||
		!plain(lane.timestamps) ||
		!text(lane.timestamps.queuedAt) ||
		!text(lane.timestamps.updatedAt)
	)
		fail("corrupt", `Invalid ${file}`);
	const paths = sortedStrings(lane.relevantPaths, "relevantPaths").map(
		relativePath,
	);
	const resources = sortedStrings(lane.resourceKeys, "resourceKeys");
	if (
		JSON.stringify(paths) !== JSON.stringify(lane.relevantPaths) ||
		JSON.stringify(resources) !== JSON.stringify(lane.resourceKeys)
	)
		fail("corrupt", `Noncanonical ${file}`);
	if (lane.state === "running" && (!plain(lane.launch) || !lane.launch.pid))
		fail("corrupt", `Running ${file} has no launch owner`);
	if (["completed", "promoted"].includes(lane.state) && !plain(lane.artifact))
		fail("corrupt", `${lane.state} ${file} has no artifact`);
	if (lane.state === "failed" && !text(lane.failureReason))
		fail("corrupt", `Failed ${file} has no reason`);
	if (lane.state === "discarded" && !text(lane.discardReason))
		fail("corrupt", `Discarded ${file} has no reason`);
	return lane;
}

export function laneStorePath(cwd = process.cwd()) {
	return path.join(
		cwd,
		".ce-workflow",
		"work-runs",
		"read-only-lanes",
		"state.json",
	);
}
function runtimeDir(cwd) {
	return path.dirname(laneStorePath(cwd));
}
function storeLockPath(cwd) {
	return path.join(runtimeDir(cwd), "mutation.lock");
}
function recoveryPath(cwd) {
	return path.join(runtimeDir(cwd), ".state.recovery.json");
}
function repositoryLockPath(cwd) {
	return path.join(cwd, ".ce-workflow", "work-runs", "repository-mutation.lock");
}
function repositoryAdmissionLockPath(cwd) {
	return path.join(
		cwd,
		".ce-workflow",
		"work-runs",
		"repository-admission.lock",
	);
}
function lockOwner(file) {
	try {
		return JSON.parse(readFileSync(file, "utf8"));
	} catch {
		return undefined;
	}
}
function ownerDead(
	file,
	processExists = (pid) => {
		try {
			process.kill(pid, 0);
			return true;
		} catch (error) {
			return error?.code !== "ESRCH";
		}
	},
) {
	const owner = lockOwner(file);
	return owner?.host === os.hostname() && !processExists(owner.pid);
}
function sameLockOwner(left, right) {
	if (!left || !right) return false;
	if (left.token || right.token) return left.token === right.token;
	return (
		left.pid === right.pid &&
		left.host === right.host &&
		left.acquiredAt === right.acquiredAt
	);
}

function acquireFileLock(file, category, reclaiming = false) {
	mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
	const reclaim = `${file}.reclaim`;
	if (!reclaiming && existsSync(reclaim))
		fail("locked", `${category}; stale-lock reclamation is active`, { file });
	const owner = {
		token: randomUUID(),
		pid: process.pid,
		host: os.hostname(),
		acquiredAt: new Date().toISOString(),
		command: [
			path.basename(process.argv[1] ?? process.execPath),
			...process.argv.slice(2, 4),
		].join(" "),
	};
	let descriptor;
	try {
		descriptor = openSync(file, "wx", 0o600);
		writeFileSync(descriptor, `${JSON.stringify(owner)}\n`);
	} catch (error) {
		if (
			error?.code === "EEXIST" ||
			(error?.code === "EPERM" && existsSync(file))
		) {
			const staleOwner = lockOwner(file);
			if (ownerDead(file)) {
				try {
					linkSync(file, reclaim);
				} catch (claimError) {
					if (["EEXIST", "ENOENT"].includes(claimError?.code))
						fail("locked", `${category}; stale-lock reclamation raced`, {
							file,
						});
					throw claimError;
				}
				try {
					if (!sameLockOwner(staleOwner, lockOwner(reclaim)))
						fail("locked", `${category}; lock owner changed during reclamation`, {
							file,
						});
					unlinkSync(file);
					return acquireFileLock(file, category, true);
				} finally {
					rmSync(reclaim, { force: true });
				}
			}
			const acquiredAt = Date.parse(staleOwner?.acquiredAt);
			const age = Number.isFinite(acquiredAt)
				? `${Math.max(0, Date.now() - acquiredAt)}ms`
				: "unknown";
			const ownerSummary = staleOwner
				? `; owner pid ${staleOwner.pid ?? "unknown"}, command ${staleOwner.command ?? "unknown"}, age ${age}`
				: "";
			fail("locked", `${category}${ownerSummary}`, { file, owner: staleOwner });
		}
		throw error;
	}
	let released = false;
	return {
		file,
		release() {
			if (released) return;
			released = true;
			closeSync(descriptor);
			if (sameLockOwner(owner, lockOwner(file))) rmSync(file, { force: true });
		},
	};
}
export function acquireRepositoryAdmissionLock(cwd = process.cwd()) {
	return acquireFileLock(
		repositoryAdmissionLockPath(cwd),
		"Another repository admission is active",
	);
}

function mutableActionLeaseOccupied(cwd) {
	const file = path.join(
		cwd,
		".ce-workflow",
		"work-runs",
		"direct",
		"pending-direct.jsonl",
	);
	if (!existsSync(file)) return false;
	const leases = new Map();
	for (const line of readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean)) {
		try {
			const event = JSON.parse(line);
			if (event.version !== 2 || !event.leaseId) continue;
			if (event.type === "lease") leases.set(event.leaseId, event.state);
			else if (leases.has(event.leaseId)) leases.set(event.leaseId, event.state);
		} catch {
			return true;
		}
	}
	return [...leases.values()].some((state) =>
		[
			"queued",
			"claimed",
			"acknowledged",
			"ambiguous",
			"live",
			"orphaned",
		].includes(state),
	);
}

function emptyStore(now) {
	const createdAt = timestamp(now);
	return {
		schemaVersion: STORE_VERSION,
		metadata: { createdAt, updatedAt: createdAt },
		lanes: {},
	};
}
function validateStore(store, file = "lane store") {
	if (
		!plain(store) ||
		store.schemaVersion !== STORE_VERSION ||
		!plain(store.metadata) ||
		!text(store.metadata.createdAt) ||
		!text(store.metadata.updatedAt) ||
		!plain(store.lanes)
	)
		fail("corrupt", `Invalid ${file}`);
	for (const [id, lane] of Object.entries(store.lanes)) {
		validateLaneEnvelope(lane, `${file} lane ${id}`);
		if (lane.id !== id) fail("corrupt", `Lane key mismatch in ${file}`);
	}
	return store;
}
function durableWrite(file, content) {
	const descriptor = openSync(file, "w", 0o600);
	try {
		writeFileSync(descriptor, content);
		fsyncSync(descriptor);
	} finally {
		closeSync(descriptor);
	}
}
function readStore(file) {
	try {
		return validateStore(JSON.parse(readFileSync(file, "utf8")), file);
	} catch (error) {
		if (error instanceof ReadOnlyLaneError) throw error;
		fail("corrupt", `Lane store is not valid JSON: ${file}`);
	}
}
export function loadLaneStore(cwd = process.cwd()) {
	const file = laneStorePath(cwd);
	const recovery = recoveryPath(cwd);
	if (!existsSync(file))
		return existsSync(recovery) ? readStore(recovery) : emptyStore();
	try {
		return readStore(file);
	} catch (primaryError) {
		if (!existsSync(recovery)) throw primaryError;
		try {
			return readStore(recovery);
		} catch {
			throw primaryError;
		}
	}
}
export function saveLaneStore(cwd = process.cwd(), store) {
	validateStore(store);
	const target = laneStorePath(cwd);
	const recovery = recoveryPath(cwd);
	const candidate = `${target}.candidate`;
	mkdirSync(runtimeDir(cwd), { recursive: true, mode: 0o700 });
	if (existsSync(target)) {
		const prior = readFileSync(target, "utf8");
		readStore(target);
		durableWrite(recovery, prior);
		readStore(recovery);
	}
	durableWrite(candidate, `${JSON.stringify(canonical(store), null, 2)}\n`);
	try {
		renameSync(candidate, target);
	} catch {
		rmSync(target, { force: true });
		renameSync(candidate, target);
	}
	return store;
}
function acquireLaneStoreLock(cwd, waitMs = 250) {
	const deadline = Date.now() + waitMs;
	while (true) {
		try {
			return acquireFileLock(storeLockPath(cwd), "Another lane writer is active");
		} catch (error) {
			if (error?.category !== "locked" || Date.now() >= deadline) throw error;
			Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
		}
	}
}

export function mutateLaneStore(cwd = process.cwd(), mutate, options = {}) {
	const lock = acquireLaneStoreLock(cwd);
	try {
		const store = loadLaneStore(cwd);
		const result = mutate(store);
		store.metadata.updatedAt = timestamp(options.now);
		saveLaneStore(cwd, store);
		return result === undefined ? store : result;
	} finally {
		lock.release();
	}
}
export function queueLane(cwd, lane) {
	validateLaneEnvelope(lane);
	return mutateLaneStore(cwd, (store) => {
		const existing = store.lanes[lane.id];
		if (existing) return existing;
		store.lanes[lane.id] = structuredClone(lane);
		return store.lanes[lane.id];
	});
}

function transitionIn(store, id, state, details = {}) {
	const lane = store.lanes[id];
	if (!lane) fail("missing", `Lane is missing: ${id}`);
	if (lane.state === state) return lane;
	if (TERMINAL.has(lane.state) || !NEXT[lane.state]?.has(state))
		fail("lifecycle", `Invalid lane transition ${lane.state} -> ${state}`);
	const at = timestamp(details.now);
	lane.state = state;
	lane.timestamps.updatedAt = at;
	lane.timestamps[`${state}At`] = at;
	if (details.artifact !== undefined) lane.artifact = details.artifact;
	if (details.launch !== undefined) lane.launch = details.launch;
	if (details.metrics !== undefined) lane.metrics = details.metrics;
	if (details.reason !== undefined) lane.reason = details.reason;
	if (state === "failed") lane.failureReason = details.reason ?? "lane failed";
	if (state === "discarded")
		lane.discardReason = details.reason ?? "lane discarded";
	validateLaneEnvelope(lane);
	return lane;
}
export function transitionLane(cwd, id, state, details = {}) {
	return mutateLaneStore(
		cwd,
		(store) => transitionIn(store, id, state, details),
		details,
	);
}
export function acknowledgeLaneLaunch(cwd, id, acknowledgement = {}) {
	return mutateLaneStore(cwd, (store) => {
		const lane = store.lanes[id];
		if (!lane || !["queued", "running"].includes(lane.state))
			fail("lifecycle", `Lane cannot acknowledge launch: ${id}`);
		lane.launch = {
			...(lane.launch ?? {}),
			acknowledgement: acknowledgement.ambiguous ? "ambiguous" : "accepted",
			runId: acknowledgement.runId ?? lane.launch?.runId ?? null,
			asyncDir: acknowledgement.asyncDir ?? lane.launch?.asyncDir ?? null,
			at: timestamp(acknowledgement.now),
		};
		lane.timestamps.updatedAt = lane.launch.at;
		return lane;
	});
}
export function laneCanLaunch(lane) {
	validateLaneEnvelope(lane);
	return lane.state === "queued" && lane.launch?.acknowledgement !== "ambiguous";
}
export function promoteLane(cwd, id, owner, options = {}) {
	return mutateLaneStore(
		cwd,
		(store) => {
			const lane = store.lanes[id];
			if (!lane) fail("missing", `Lane is missing: ${id}`);
			if (lane.promotionOwner !== owner)
				fail("owner", `Only ${lane.promotionOwner} may promote ${id}`);
			const newer = Object.values(store.lanes).some(
				(other) =>
					other.id !== id &&
					other.workItemId === lane.workItemId &&
					other.laneKind === lane.laneKind &&
					other.generation > lane.generation,
			);
			if (newer)
				return transitionIn(store, id, "discarded", {
					...options,
					reason: "stale-generation",
				});
			return transitionIn(store, id, "promoted", options);
		},
		options,
	);
}

function git(cwd, args) {
	return execFileSync("git", args, {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	}).trim();
}
function runtimePath(entry) {
	return (
		entry.startsWith(".ce-workflow/work-runs/") ||
		entry.startsWith(".pi-subagents/") ||
		entry.startsWith(".pi/work-runs/")
	);
}
export function captureRepositoryFingerprint(
	cwd = process.cwd(),
	options = {},
) {
	const head = git(cwd, ["rev-parse", "HEAD"]);
	const excludedOutputs = (options.excludeOutputs ?? []).map(relativePath);
	const records = git(cwd, [
		"status",
		"--porcelain=v1",
		"-z",
		"--untracked-files=all",
	])
		.split("\0")
		.filter(Boolean);
	const files = [];
	for (let index = 0; index < records.length; index += 1) {
		const record = records[index];
		const status = record.slice(0, 2);
		const entry = record.slice(3).replaceAll("\\", "/");
		if (/[RC]/.test(status) && records[index + 1]) index += 1;
		if (runtimePath(entry)) continue;
		if (
			status === "??" &&
			excludedOutputs.some(
				(output) => entry === output || entry.startsWith(`${output}/`),
			)
		)
			continue;
		const file = path.join(cwd, entry);
		let content = "missing";
		try {
			const info = statSync(file);
			content = info.isFile() ? hash(readFileSync(file), 64) : "non-file";
		} catch {
			// Deleted files are represented by the status and missing marker.
		}
		files.push({ path: entry, status, content });
	}
	files.sort((left, right) => left.path.localeCompare(right.path));
	return { version: 1, head, files, digest: hash({ head, files }, 64) };
}
export function fingerprintsEqual(before, after) {
	return before?.digest === after?.digest && before?.head === after?.head;
}

export function repositoryMutationLocked(cwd = process.cwd()) {
	const file = repositoryLockPath(cwd);
	if (!existsSync(file)) return false;
	if (ownerDead(file)) {
		try {
			unlinkSync(file);
		} catch {
			return true;
		}
		return false;
	}
	return true;
}
export function acquireRepositoryMutationLock(cwd = process.cwd()) {
	const admission = acquireRepositoryAdmissionLock(cwd);
	try {
		try {
			reconcileReadOnlyLanes(cwd);
		} catch {
			// A busy or corrupt lane store remains authoritative in the scan below.
		}
		const active = Object.values(loadLaneStore(cwd).lanes).filter(
			(lane) => lane.state === "running",
		);
		if (active.length)
			fail(
				"locked",
				`Read-only lanes are using the repository: ${active.map((lane) => lane.id).join(", ")}`,
			);
		return acquireFileLock(
			repositoryLockPath(cwd),
			"Another job owns MUTATE_REPO(repository)",
		);
	} finally {
		admission.release();
	}
}

const ASYNC_SUCCESS_STATES = new Set([
	"complete",
	"completed",
	"success",
	"succeeded",
	"done",
	"ok",
	"passed",
]);
const ASYNC_FAILURE_STATES = new Set([
	"failed",
	"error",
	"stopped",
	"cancelled",
	"canceled",
	"timed_out",
	"timeout",
]);

function prefetchAsyncStatus(lane) {
	if (lane.laneKind !== "prefetch" || !text(lane.launch?.asyncDir)) return null;
	const file = path.join(path.resolve(lane.launch.asyncDir), "status.json");
	try {
		const info = lstatSync(file);
		if (!info.isFile() || info.isSymbolicLink() || info.size > 256 * 1024)
			return null;
		const status = JSON.parse(readFileSync(file, "utf8"));
		const state = String(status?.state ?? status?.status ?? "").toLowerCase();
		return plain(status) && text(state) ? { file, state } : null;
	} catch {
		return null;
	}
}

export function reconcileReadOnlyLanes(cwd = process.cwd(), options = {}) {
	if (!existsSync(laneStorePath(cwd))) return [];
	const exists =
		options.processExists ??
		((pid) => {
			try {
				process.kill(pid, 0);
				return true;
			} catch (error) {
				return error?.code !== "ESRCH";
			}
		});
	const lock = acquireFileLock(
		storeLockPath(cwd),
		"Another lane writer is active",
	);
	try {
		const store = loadLaneStore(cwd);
		const reconciled = [];
		for (const lane of Object.values(store.lanes)) {
			if (
				lane.state !== "running" ||
				lane.launch?.host !== (options.host ?? os.hostname())
			)
				continue;
			const runtime = prefetchAsyncStatus(lane);
			if (ASYNC_SUCCESS_STATES.has(runtime?.state)) {
				transitionIn(store, lane.id, "completed", {
					now: options.now,
					artifact: { statusFile: runtime.file },
				});
				reconciled.push(lane.id);
				continue;
			}
			if (ASYNC_FAILURE_STATES.has(runtime?.state)) {
				transitionIn(store, lane.id, "failed", {
					now: options.now,
					reason: `async ${runtime.state}`,
				});
				reconciled.push(lane.id);
				continue;
			}
			if (!exists(lane.launch.pid)) {
				transitionIn(store, lane.id, "orphaned", {
					now: options.now,
					reason: "dead-local-runner",
				});
				reconciled.push(lane.id);
			}
		}
		if (reconciled.length) {
			store.metadata.updatedAt = timestamp(options.now);
			saveLaneStore(cwd, store);
		}
		return reconciled;
	} finally {
		lock.release();
	}
}

function virtualMetrics(lanes, durations, limit) {
	const slots = Array.from({ length: limit }, () => 0);
	const resources = new Map();
	let maxConcurrency = 0;
	const intervals = [];
	for (let index = 0; index < lanes.length; index += 1) {
		const lane = lanes[index];
		let slot = 0;
		for (let candidate = 1; candidate < slots.length; candidate += 1)
			if (slots[candidate] < slots[slot]) slot = candidate;
		const resourceReady = Math.max(
			0,
			...lane.resourceKeys.map((key) => resources.get(key) ?? 0),
		);
		const start = Math.max(slots[slot], resourceReady);
		const end = start + durations[index];
		slots[slot] = end;
		for (const key of lane.resourceKeys) resources.set(key, end);
		intervals.push({ start, end });
	}
	for (const point of [
		...new Set(intervals.flatMap(({ start, end }) => [start, end])),
	])
		maxConcurrency = Math.max(
			maxConcurrency,
			intervals.filter(({ start, end }) => start <= point && point < end).length,
		);
	return {
		criticalPathMs: Math.max(0, ...intervals.map(({ end }) => end)),
		sumShardMs: durations.reduce((sum, value) => sum + value, 0),
		maxConcurrency,
	};
}

export async function runReadOnlyLaneBatch(
	cwd,
	envelopes,
	runner,
	options = {},
) {
	if (!Array.isArray(envelopes) || typeof runner !== "function")
		fail("invalid", "Lane batch requires envelopes and a runner");
	const lanes = envelopes.map((lane) => queueLane(cwd, lane));
	const serial = options.serial === true || process.env.WORK_ORCH_SERIAL === "1";
	const limit = serial ? 1 : Math.max(1, Number(options.maxConcurrency) || 2);
	const results = Array(lanes.length);
	const durations = Array(lanes.length).fill(0);
	const resources = new Set(
		Object.values(loadLaneStore(cwd).lanes)
			.filter((lane) => lane.state === "running")
			.flatMap((lane) => lane.resourceKeys),
	);
	const active = new Set();
	let stopped = false;
	await new Promise((resolveBatch) => {
		const settleQueued = () => {
			if (!stopped) return;
			for (let index = 0; index < lanes.length; index += 1) {
				if (results[index] || active.has(index)) continue;
				const lane = lanes[index];
				transitionLane(cwd, lane.id, "discarded", { reason: "fail-fast" });
				results[index] = {
					laneId: lane.id,
					state: "discarded",
					reason: "fail-fast",
				};
			}
		};
		const pump = () => {
			settleQueued();
			let launched = false;
			while (!stopped && active.size < limit) {
				const index = lanes.findIndex(
					(lane, candidate) =>
						!results[candidate] &&
						!active.has(candidate) &&
						lane.resourceKeys.every((key) => !resources.has(key)),
				);
				if (index < 0) break;
				const lane = lanes[index];
				active.add(index);
				for (const key of lane.resourceKeys) resources.add(key);
				launched = true;
				void (async () => {
					const started = Date.now();
					try {
						let before;
						const primaryCheckout = lane.resourceKeys.includes("repo:read");
						const admission = primaryCheckout
							? acquireRepositoryAdmissionLock(cwd)
							: null;
						try {
							if (!laneCanLaunch(loadLaneStore(cwd).lanes[lane.id]))
								fail("acknowledgement", `Lane launch is ambiguous: ${lane.id}`);
							if (repositoryMutationLocked(cwd) && options.mutationOwner !== true)
								fail("locked", "MUTATE_REPO(repository) is active");
							if (primaryCheckout && mutableActionLeaseOccupied(cwd))
								fail("locked", "A mutable action lease occupies the primary checkout");
							before = captureRepositoryFingerprint(cwd);
							transitionLane(cwd, lane.id, "running", {
								launch: {
									pid: options.pid ?? process.pid,
									host: options.host ?? os.hostname(),
									runId: null,
									fingerprint: before,
								},
							});
						} finally {
							admission?.release();
						}
						const output = (await runner(lane)) ?? {};
						durations[index] = Math.max(
							0,
							Number(output.durationMs ?? output.virtualDurationMs) ||
								Date.now() - started,
						);
						const current = loadLaneStore(cwd).lanes[lane.id];
						if (current.state !== "running") {
							results[index] = { laneId: lane.id, state: current.state };
							return;
						}
						if (["queued", "running", "pending"].includes(output.status)) {
							const after = captureRepositoryFingerprint(cwd);
							if (!fingerprintsEqual(before, after))
								fail(
									"mutation",
									"Read-only lane mutated source, WorkItem state, or HEAD",
								);
							results[index] = { laneId: lane.id, state: "running" };
							return;
						}
						const after = captureRepositoryFingerprint(cwd);
						if (!fingerprintsEqual(before, after))
							fail(
								"mutation",
								"Read-only lane mutated source, WorkItem state, or HEAD",
							);
						if (["cancelled", "canceled", "stale"].includes(output.status)) {
							const reason =
								output.status === "stale" ? "stale-artifact" : "cancelled";
							transitionLane(cwd, lane.id, "discarded", { reason });
							results[index] = { laneId: lane.id, state: "discarded", reason };
							return;
						}
						const artifact = plain(output.artifact)
							? output.artifact
							: { value: output.artifact ?? output.result ?? null };
						transitionLane(cwd, lane.id, "completed", {
							artifact,
							metrics: { durationMs: durations[index] },
						});
						const settled = options.deferPromotion
							? loadLaneStore(cwd).lanes[lane.id]
							: output.promote === false
								? transitionLane(cwd, lane.id, "discarded", {
										reason: "producer-declined-promotion",
									})
								: promoteLane(cwd, lane.id, lane.promotionOwner);
						results[index] = {
							laneId: lane.id,
							state: settled.state,
							artifact,
						};
					} catch (error) {
						let reason = error.message;
						try {
							const current = loadLaneStore(cwd).lanes[lane.id];
							if (current && !TERMINAL.has(current.state))
								transitionLane(cwd, lane.id, "failed", {
									reason: `${error.category ?? "runner"}: ${reason}`,
								});
						} catch (recoveryError) {
							reason += `; recovery failed: ${recoveryError.message}`;
						}
						results[index] = { laneId: lane.id, state: "failed", reason };
						if (options.failFast !== false) stopped = true;
					} finally {
						active.delete(index);
						if (results[index]?.state !== "running")
							for (const key of lane.resourceKeys) resources.delete(key);
						settleQueued();
						if (results.filter(Boolean).length === lanes.length && active.size === 0)
							resolveBatch();
						else pump();
					}
				})().catch((error) => {
					active.delete(index);
					for (const key of lane.resourceKeys) resources.delete(key);
					results[index] ??= {
						laneId: lane.id,
						state: "failed",
						reason: `batch recovery failed: ${error.message}`,
					};
					stopped = true;
					for (let pending = 0; pending < lanes.length; pending += 1)
						if (!results[pending] && !active.has(pending))
							results[pending] = {
								laneId: lanes[pending].id,
								state: "discarded",
								reason: "batch-recovery-failed",
							};
					if (active.size === 0) resolveBatch();
				});
			}
			if (!launched && active.size === 0) {
				for (let index = 0; index < lanes.length; index += 1)
					if (!results[index])
						results[index] = {
							laneId: lanes[index].id,
							state: "queued",
							reason: "resource-busy",
						};
				resolveBatch();
			}
		};
		pump();
	});
	const metrics = {
		...virtualMetrics(lanes, durations, limit),
		wastedDurationMs: results.reduce(
			(sum, result, index) =>
				sum + (result?.state === "promoted" ? 0 : durations[index]),
			0,
		),
	};
	mutateLaneStore(cwd, (store) => {
		for (const lane of lanes) {
			const current = store.lanes[lane.id];
			if (current)
				current.metrics = {
					...(current.metrics ?? {}),
					...metrics,
				};
		}
	});
	return { serial, results, ...metrics };
}

export function laneStatus(cwd = process.cwd(), options = {}) {
	const now = Number(options.now ?? Date.now());
	return Object.values(loadLaneStore(cwd).lanes)
		.sort((left, right) => left.id.localeCompare(right.id))
		.map((lane) => ({
			id: lane.id,
			laneKind: lane.laneKind,
			workItemId: lane.workItemId,
			generation: lane.generation,
			snapshot: lane.checkpoint,
			head: lane.baseHead,
			state: lane.state,
			claims: lane.resourceKeys,
			ageMs: Math.max(0, now - Date.parse(lane.timestamps.queuedAt)),
			reason: lane.failureReason ?? lane.discardReason ?? lane.reason,
			criticalPathMs: lane.metrics?.criticalPathMs,
			sumShardMs: lane.metrics?.sumShardMs,
			maxConcurrency: lane.metrics?.maxConcurrency,
			wastedDurationMs: lane.metrics?.wastedDurationMs,
		}));
}
export function laneTelemetryEvents(cwd = process.cwd()) {
	return laneStatus(cwd).map((lane) => ({
		id: `read-only-${lane.id}-${lane.state}`,
		type: "read-only-lane",
		...lane,
	}));
}

function exactKeys(value, keys) {
	return (
		plain(value) &&
		JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort())
	);
}
function verificationOutputPath(value) {
	if (
		!text(value) ||
		value.includes("\\") ||
		path.posix.isAbsolute(value) ||
		path.win32.isAbsolute(value)
	)
		fail("invalid", `Invalid verification output path: ${value}`);
	const output = relativePath(path.posix.normalize(value));
	if (/^(?:\.git|\.ce-workflow|\.pi)(?:\/|$)/.test(output))
		fail(
			"invalid",
			`Verification output cannot contain workflow or Git state: ${output}`,
		);
	return output.replace(/\/$/, "");
}
function outputClaimsConflict(left, right) {
	return left.some((a) =>
		right.some((b) => a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`)),
	);
}
function shardClaimsConflict(left, right) {
	return (
		left.resourceKeys.some((key) => right.resourceKeys.includes(key)) ||
		outputClaimsConflict(left.outputs, right.outputs)
	);
}
function normalizedShard(input, index) {
	if (!plain(input))
		fail("invalid", `Verification shard ${index + 1} is invalid`);
	const id = input.id;
	if (!text(id) || !/^[A-Za-z0-9_.-]+$/.test(id))
		fail("invalid", `Verification shard ${index + 1} has an invalid id`);
	if (!text(input.command))
		fail("invalid", `Verification shard ${id} needs a command`);
	if (input.required === false)
		fail("invalid", `Verification shard ${id} cannot be optional`);
	return {
		id,
		command: input.command,
		dependsOn: sortedStrings(input.dependsOn ?? [], "dependsOn"),
		resourceKeys: sortedStrings(input.resourceKeys ?? [], "resourceKeys"),
		outputs: sortedStrings(input.outputs ?? [], "outputs").map(
			verificationOutputPath,
		),
	};
}
export function normalizeVerificationShards(shards) {
	if (!Array.isArray(shards) || !shards.length)
		fail("invalid", "At least one verification shard is required");
	const normalized = shards.map(normalizedShard);
	const ids = new Set(normalized.map(({ id }) => id));
	if (ids.size !== normalized.length)
		fail("invalid", "Verification shard ids must be unique");
	for (const shard of normalized) {
		if (shard.dependsOn.includes(shard.id))
			fail("invalid", `Verification shard ${shard.id} depends on itself`);
		if (shard.dependsOn.some((id) => !ids.has(id)))
			fail("invalid", `Verification shard ${shard.id} has a missing dependency`);
	}
	const pending = new Set(ids);
	const complete = new Set();
	while (pending.size) {
		const ready = normalized.filter(
			(shard) =>
				pending.has(shard.id) && shard.dependsOn.every((id) => complete.has(id)),
		);
		if (!ready.length)
			fail("invalid", "Verification shard dependencies contain a cycle");
		for (const shard of ready) {
			pending.delete(shard.id);
			complete.add(shard.id);
		}
	}
	return normalized;
}
function verificationOutput(value) {
	const output = String(value ?? "");
	return {
		outputHash: hash(output, 64),
		outputTail: output.slice(-500),
	};
}
function verificationMetrics(shards, durations, limit) {
	const remaining = new Set(shards.map(({ id }) => id));
	const ends = new Map();
	const slots = Array.from({ length: limit }, () => 0);
	const claims = new Map();
	let maxConcurrency = 0;
	const intervals = [];
	while (remaining.size) {
		const shard = shards.find(
			(item) =>
				remaining.has(item.id) && item.dependsOn.every((id) => ends.has(id)),
		);
		const dependencyReady = Math.max(
			0,
			...shard.dependsOn.map((id) => ends.get(id) ?? 0),
		);
		const claimReady = Math.max(
			0,
			...shards
				.filter((other) => ends.has(other.id) && shardClaimsConflict(shard, other))
				.map((other) => claims.get(other.id) ?? 0),
		);
		let slot = 0;
		for (let index = 1; index < slots.length; index += 1)
			if (
				Math.max(slots[index], dependencyReady, claimReady) <
				Math.max(slots[slot], dependencyReady, claimReady)
			)
				slot = index;
		const start = Math.max(slots[slot], dependencyReady, claimReady);
		const end = start + (durations.get(shard.id) ?? 0);
		slots[slot] = end;
		ends.set(shard.id, end);
		claims.set(shard.id, end);
		intervals.push({ start, end });
		remaining.delete(shard.id);
	}
	for (const point of new Set(
		intervals.flatMap(({ start, end }) => [start, end]),
	))
		maxConcurrency = Math.max(
			maxConcurrency,
			intervals.filter(({ start, end }) => start <= point && point < end).length,
		);
	return {
		criticalPathMs: Math.max(0, ...ends.values()),
		sumShardMs: [...durations.values()].reduce((sum, value) => sum + value, 0),
		maxConcurrency,
	};
}

export async function runVerificationShardBatch(
	cwd,
	input,
	runner,
	options = {},
) {
	if (typeof runner !== "function")
		fail("invalid", "Verification runner is required");
	if (!repositoryMutationLocked(cwd) || options.mutationOwner !== true)
		fail(
			"locked",
			"Verification shards require the repository mutation-lock owner",
		);
	const shards = normalizeVerificationShards(input?.shards);
	const serial = options.serial === true || process.env.WORK_ORCH_SERIAL === "1";
	const limit = serial ? 1 : Math.max(1, Number(options.maxConcurrency) || 2);
	const baseHead = input.baseHead ?? git(cwd, ["rev-parse", "HEAD"]);
	const outputs = [...new Set(shards.flatMap((shard) => shard.outputs))].sort();
	const sourceFingerprint =
		input.sourceFingerprint ??
		captureRepositoryFingerprint(cwd, { excludeOutputs: outputs });
	if (sourceFingerprint.head !== baseHead)
		fail("invalid", "Verification candidate HEAD and fingerprint differ");
	const invocationId =
		input.invocationId ??
		`verify-${hash(`${Date.now()}-${process.pid}-${Math.random()}`, 32)}`;
	const startedAt = timestamp(options.now?.());
	const results = new Map();
	const running = new Map();
	const active = new Set();
	let stopped = false;
	await new Promise((resolveBatch) => {
		const pump = () => {
			while (!stopped && running.size < limit) {
				const shard = shards.find(
					(item) =>
						!results.has(item.id) &&
						!running.has(item.id) &&
						item.dependsOn.every((id) => results.get(id)?.status === "PASS") &&
						[...active].every(
							(id) =>
								!shardClaimsConflict(
									item,
									shards.find((entry) => entry.id === id),
								),
						),
				);
				if (!shard) break;
				running.set(shard.id, true);
				active.add(shard.id);
				void (async () => {
					const realStarted = Date.now();
					const shardStartedAt = timestamp(options.now?.());
					let output;
					try {
						output = (await runner(shard)) ?? {};
					} catch (error) {
						output = {
							exitStatus: Number.isInteger(error?.status)
								? error.status
								: Number.isInteger(error?.code)
									? error.code
									: 1,
							stdout: error?.stdout,
							stderr: error?.stderr ?? error?.message ?? error,
						};
					}
					const exitStatus = Number.isInteger(output.exitStatus)
						? output.exitStatus
						: Number.isInteger(output.status)
							? output.status
							: 0;
					const durationMs = Math.max(0, Date.now() - realStarted);
					const virtualDurationMs = Math.max(
						0,
						Number(output.virtualDurationMs ?? output.durationMs) || durationMs,
					);
					const bounded = verificationOutput(
						`${String(output.stdout ?? "")}${String(output.stderr ?? "")}`,
					);
					results.set(shard.id, {
						schemaVersion: VERIFICATION_MANIFEST_VERSION,
						gateVersion: input.gateVersion ?? VERIFICATION_GATE_VERSION,
						id: shard.id,
						command: shard.command,
						status: exitStatus === 0 ? "PASS" : "FAIL",
						exitStatus,
						...bounded,
						durationMs,
						virtualDurationMs,
						startedAt: shardStartedAt,
						finishedAt: timestamp(options.now?.()),
						dependsOn: shard.dependsOn,
						resourceKeys: shard.resourceKeys,
						outputs: shard.outputs,
						baseHead,
						sourceFingerprint: sourceFingerprint.digest,
						required: true,
					});
					if (exitStatus !== 0 && options.failFast !== false) stopped = true;
					active.delete(shard.id);
					running.delete(shard.id);
					pump();
				})();
			}
			if (running.size) return;
			const unsettled = shards.filter((shard) => !results.has(shard.id));
			if (
				stopped ||
				unsettled.every((shard) =>
					shard.dependsOn.some((id) => results.get(id)?.status !== "PASS"),
				)
			) {
				for (const shard of unsettled) {
					const bounded = verificationOutput("");
					results.set(shard.id, {
						schemaVersion: VERIFICATION_MANIFEST_VERSION,
						gateVersion: input.gateVersion ?? VERIFICATION_GATE_VERSION,
						id: shard.id,
						command: shard.command,
						status: "SKIPPED",
						exitStatus: null,
						...bounded,
						durationMs: 0,
						virtualDurationMs: 0,
						startedAt: timestamp(options.now?.()),
						finishedAt: timestamp(options.now?.()),
						dependsOn: shard.dependsOn,
						resourceKeys: shard.resourceKeys,
						outputs: shard.outputs,
						baseHead,
						sourceFingerprint: sourceFingerprint.digest,
						required: true,
					});
				}
				resolveBatch();
				return;
			}
			if (results.size === shards.length) resolveBatch();
		};
		pump();
	});
	const ordered = shards.map((shard) => results.get(shard.id));
	const durations = new Map(
		ordered.map((result) => [result.id, result.virtualDurationMs]),
	);
	const metrics = verificationMetrics(shards, durations, limit);
	const currentFingerprint = captureRepositoryFingerprint(cwd, {
		excludeOutputs: outputs,
	});
	const admission = {
		invocationId,
		baseHead,
		sourceFingerprint: structuredClone(sourceFingerprint),
		reviews: Array.isArray(input.reviews) ? structuredClone(input.reviews) : [],
	};
	const manifest = {
		schemaVersion: VERIFICATION_MANIFEST_VERSION,
		gateVersion: input.gateVersion ?? VERIFICATION_GATE_VERSION,
		invocationId,
		authoritativeCommand: input.authoritativeCommand,
		baseHead,
		sourceFingerprint,
		declarationsHash: hash(shards, 64),
		startedAt,
		finishedAt: timestamp(options.now?.()),
		shards: ordered,
		reviews: structuredClone(admission.reviews),
		metrics,
		status:
			fingerprintsEqual(sourceFingerprint, currentFingerprint) &&
			ordered.every((result) => result.status === "PASS")
				? "PASS"
				: "FAIL",
	};
	return {
		manifest,
		admission,
		declarations: shards,
		currentFingerprint,
		serial,
		outputs,
	};
}

const MANIFEST_KEYS = [
	"schemaVersion",
	"gateVersion",
	"invocationId",
	"authoritativeCommand",
	"baseHead",
	"sourceFingerprint",
	"declarationsHash",
	"startedAt",
	"finishedAt",
	"shards",
	"reviews",
	"metrics",
	"status",
];
const SHARD_RESULT_KEYS = [
	"schemaVersion",
	"gateVersion",
	"id",
	"command",
	"status",
	"exitStatus",
	"outputHash",
	"outputTail",
	"durationMs",
	"virtualDurationMs",
	"startedAt",
	"finishedAt",
	"dependsOn",
	"resourceKeys",
	"outputs",
	"baseHead",
	"sourceFingerprint",
	"required",
];
export function admitVerificationManifest(manifest, expected = {}) {
	const shards = normalizeVerificationShards(expected.shards);
	const gateVersion = expected.gateVersion ?? VERIFICATION_GATE_VERSION;
	const reject = (message) => fail("admission", message);
	if (!exactKeys(manifest, MANIFEST_KEYS))
		reject("Verification manifest schema is not exact");
	if (manifest.schemaVersion !== VERIFICATION_MANIFEST_VERSION)
		reject("Verification manifest schema version is wrong");
	if (manifest.gateVersion !== gateVersion)
		reject("Verification manifest gate is wrong");
	if (
		!text(expected.invocationId) ||
		manifest.invocationId !== expected.invocationId
	)
		reject("Verification manifest invocation is stale or forged");
	if (
		manifest.authoritativeCommand !== expected.authoritativeCommand ||
		manifest.baseHead !== expected.baseHead ||
		JSON.stringify(manifest.sourceFingerprint) !==
			JSON.stringify(expected.sourceFingerprint) ||
		manifest.declarationsHash !== hash(shards, 64)
	)
		reject("Verification manifest candidate does not match");
	if (
		!text(manifest.startedAt) ||
		!text(manifest.finishedAt) ||
		!Number.isFinite(Date.parse(manifest.startedAt)) ||
		!Number.isFinite(Date.parse(manifest.finishedAt)) ||
		Date.parse(manifest.finishedAt) < Date.parse(manifest.startedAt) ||
		!exactKeys(manifest.metrics, [
			"criticalPathMs",
			"sumShardMs",
			"maxConcurrency",
		]) ||
		["criticalPathMs", "sumShardMs", "maxConcurrency"].some(
			(key) =>
				!Number.isFinite(manifest.metrics[key]) || manifest.metrics[key] < 0,
		)
	)
		reject("Verification manifest timing evidence is invalid");
	if (
		expected.currentFingerprint &&
		!fingerprintsEqual(manifest.sourceFingerprint, expected.currentFingerprint)
	)
		reject("Verification candidate changed after shards ran");
	if (
		expected.notAfter &&
		Date.parse(manifest.finishedAt) > Date.parse(expected.notAfter)
	)
		reject("Verification manifest arrived late");
	if (
		!Array.isArray(manifest.shards) ||
		manifest.shards.length !== shards.length
	)
		reject("Verification manifest is missing shard evidence");
	const ids = new Set(manifest.shards.map((result) => result?.id));
	if (ids.size !== manifest.shards.length)
		reject("Verification manifest has duplicate shards");
	for (let index = 0; index < shards.length; index += 1) {
		const declaration = shards[index];
		const result = manifest.shards[index];
		if (!exactKeys(result, SHARD_RESULT_KEYS))
			reject(`Verification shard ${declaration.id} schema is not exact`);
		if (
			result.schemaVersion !== VERIFICATION_MANIFEST_VERSION ||
			result.gateVersion !== gateVersion ||
			result.id !== declaration.id ||
			result.command !== declaration.command ||
			result.baseHead !== expected.baseHead ||
			result.sourceFingerprint !== expected.sourceFingerprint.digest ||
			JSON.stringify(result.dependsOn) !== JSON.stringify(declaration.dependsOn) ||
			JSON.stringify(result.resourceKeys) !==
				JSON.stringify(declaration.resourceKeys) ||
			JSON.stringify(result.outputs) !== JSON.stringify(declaration.outputs) ||
			result.required !== true
		)
			reject(
				`Verification shard ${declaration.id} does not match its declaration`,
			);
		if (result.status !== "PASS" || result.exitStatus !== 0)
			reject(`Required verification shard ${declaration.id} did not pass`);
		if (
			!/^[0-9a-f]{64}$/.test(result.outputHash) ||
			typeof result.outputTail !== "string" ||
			result.outputTail.length > 500 ||
			!Number.isFinite(result.durationMs) ||
			result.durationMs < 0 ||
			!Number.isFinite(result.virtualDurationMs) ||
			result.virtualDurationMs < 0 ||
			!Number.isFinite(Date.parse(result.startedAt)) ||
			!Number.isFinite(Date.parse(result.finishedAt)) ||
			Date.parse(result.finishedAt) < Date.parse(result.startedAt)
		)
			reject(
				`Verification shard ${declaration.id} output or timing evidence is invalid`,
			);
	}
	if (
		JSON.stringify(manifest.reviews) !== JSON.stringify(expected.reviews ?? [])
	)
		reject("Verification review evidence does not match");
	if (manifest.status !== "PASS")
		reject("Verification manifest gate did not pass");
	return manifest;
}
