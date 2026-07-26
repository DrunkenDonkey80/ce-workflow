import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
	closeSync,
	existsSync,
	fsyncSync,
	mkdirSync,
	openSync,
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
		.update(
			typeof value === "string" ? value : JSON.stringify(canonical(value)),
		)
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
		relevantPaths: sortedStrings(
			input.relevantPaths ?? [],
			"relevantPaths",
		).map(relativePath),
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
	return path.join(
		cwd,
		".ce-workflow",
		"work-runs",
		"repository-mutation.lock",
	);
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
	try {
		const owner = JSON.parse(readFileSync(file, "utf8"));
		return owner.host === os.hostname() && !processExists(owner.pid);
	} catch {
		return false;
	}
}
function acquireFileLock(file, category) {
	mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
	let descriptor;
	try {
		descriptor = openSync(file, "wx", 0o600);
		writeFileSync(
			descriptor,
			`${JSON.stringify({ pid: process.pid, host: os.hostname(), acquiredAt: new Date().toISOString() })}\n`,
		);
	} catch (error) {
		if (error?.code === "EEXIST" && ownerDead(file)) {
			unlinkSync(file);
			return acquireFileLock(file, category);
		}
		if (error?.code === "EEXIST") fail("locked", category, { file });
		throw error;
	}
	let released = false;
	return {
		file,
		release() {
			if (released) return;
			released = true;
			closeSync(descriptor);
			try {
				unlinkSync(file);
			} catch (error) {
				if (error?.code !== "ENOENT") throw error;
			}
		},
	};
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
export function mutateLaneStore(cwd = process.cwd(), mutate, options = {}) {
	const lock = acquireFileLock(
		storeLockPath(cwd),
		"Another lane writer is active",
	);
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
	return (
		lane.state === "queued" && lane.launch?.acknowledgement !== "ambiguous"
	);
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
export function captureRepositoryFingerprint(cwd = process.cwd()) {
	const head = git(cwd, ["rev-parse", "HEAD"]);
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
				lane.state === "running" &&
				lane.launch?.host === (options.host ?? os.hostname()) &&
				!exists(lane.launch.pid)
			) {
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
			intervals.filter(({ start, end }) => start <= point && point < end)
				.length,
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
	const serial =
		options.serial === true || process.env.WORK_ORCH_SERIAL === "1";
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
						if (!laneCanLaunch(loadLaneStore(cwd).lanes[lane.id]))
							fail("acknowledgement", `Lane launch is ambiguous: ${lane.id}`);
						if (repositoryMutationLocked(cwd) && options.mutationOwner !== true)
							fail("locked", "MUTATE_REPO(repository) is active");
						const before = captureRepositoryFingerprint(cwd);
						transitionLane(cwd, lane.id, "running", {
							launch: {
								pid: options.pid ?? process.pid,
								host: options.host ?? os.hostname(),
								runId: null,
								fingerprint: before,
							},
						});
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
						if (["cancelled", "canceled", "stale"].includes(output.status)) {
							const reason =
								output.status === "stale" ? "stale-artifact" : "cancelled";
							transitionLane(cwd, lane.id, "discarded", { reason });
							results[index] = { laneId: lane.id, state: "discarded", reason };
							return;
						}
						const after = captureRepositoryFingerprint(cwd);
						if (!fingerprintsEqual(before, after))
							fail(
								"mutation",
								"Read-only lane mutated source, WorkItem state, or HEAD",
							);
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
						const current = loadLaneStore(cwd).lanes[lane.id];
						if (!TERMINAL.has(current.state))
							transitionLane(cwd, lane.id, "failed", {
								reason: `${error.category ?? "runner"}: ${error.message}`,
							});
						results[index] = {
							laneId: lane.id,
							state: "failed",
							reason: error.message,
						};
						if (options.failFast !== false) stopped = true;
					} finally {
						active.delete(index);
						if (results[index]?.state !== "running")
							for (const key of lane.resourceKeys) resources.delete(key);
						settleQueued();
						if (
							results.filter(Boolean).length === lanes.length &&
							active.size === 0
						)
							resolveBatch();
						else pump();
					}
				})();
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
		for (const lane of lanes)
			store.lanes[lane.id].metrics = {
				...(store.lanes[lane.id].metrics ?? {}),
				...metrics,
			};
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
