import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
	chmodSync,
	closeSync,
	existsSync,
	fsyncSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	openSync,
	readFileSync,
	renameSync,
	rmSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

export const VERIFIER_STORE_VERSION = 1;
export const VERIFIER_OPERATIONS = [
	"correctness",
	"security",
	"simplification",
	"maintainability",
	"test-gap",
	"performance",
];
export const THINKING_EFFORTS = [
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
];

const OPERATIONS = new Set(VERIFIER_OPERATIONS);
const EFFORTS = new Set(THINKING_EFFORTS);
const OUTCOMES = new Set(["findings", "no-findings", "failed"]);
const DISPOSITIONS = new Set(["accepted", "rejected", "stale"]);
const SEVERITIES = new Set(["critical", "high", "medium", "low", "info"]);

export class VerifierStoreError extends Error {
	constructor(category, message, details = {}) {
		super(message);
		this.name = "VerifierStoreError";
		this.category = category;
		Object.assign(this, details);
	}
}

function error(category, message, details) {
	return new VerifierStoreError(category, message, details);
}
function now(value) {
	return value ?? new Date().toISOString();
}
function plainObject(value) {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function nonempty(value) {
	return typeof value === "string" && Boolean(value.trim());
}
function canonical(value) {
	if (Array.isArray(value)) return value.map(canonical);
	if (!plainObject(value)) return value;
	return Object.fromEntries(
		Object.keys(value)
			.sort()
			.map((key) => [key, canonical(value[key])]),
	);
}
function digest(value) {
	return createHash("sha256")
		.update(JSON.stringify(canonical(value)))
		.digest("hex")
		.slice(0, 24);
}
function stableId(prefix, value) {
	return `${prefix}-${digest(value)}`;
}
function same(left, right) {
	return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}
function relativePath(value, field = "path") {
	if (
		!nonempty(value) ||
		value.includes("\\") ||
		path.posix.isAbsolute(value) ||
		path.win32.isAbsolute(value) ||
		path.posix.normalize(value) !== value ||
		value === "." ||
		value === ".." ||
		value.startsWith("../")
	)
		throw error("invalid", `Invalid repository-relative ${field}`);
	return value;
}
function objectMap(value, field, file) {
	if (!plainObject(value))
		throw error("corrupt", `Invalid ${field} in ${file}`);
}
function validateCheckpoint(
	value,
	file = "verifier store",
	category = "corrupt",
) {
	const fail = (message) => {
		throw error(category, `${message} in ${file}`);
	};
	if (!plainObject(value) || !nonempty(value.repository))
		fail("Invalid checkpoint");
	if (!/^[0-9a-f]{40,64}$/i.test(value.base ?? ""))
		fail("Invalid checkpoint base");
	if (!/^[0-9a-f]{40,64}$/i.test(value.snapshot ?? ""))
		fail("Invalid checkpoint snapshot");
	if (value.base === value.snapshot)
		fail("Checkpoint base and snapshot must differ");
	if (!/^[0-9a-f]{64}$/i.test(value.patchHash ?? ""))
		fail("Invalid checkpoint patch hash");
	if (!Array.isArray(value.paths) || value.paths.length === 0)
		fail("Checkpoint has no paths");
	const paths = new Set();
	for (const entry of value.paths) {
		try {
			relativePath(entry, "checkpoint path");
		} catch {
			fail("Invalid checkpoint path");
		}
		if (paths.has(entry)) fail("Duplicate checkpoint path");
		paths.add(entry);
	}
	return {
		repository: value.repository,
		base: value.base,
		snapshot: value.snapshot,
		paths: [...value.paths].sort(),
		patchHash: value.patchHash,
	};
}
function modelIds(models) {
	if (models === undefined) return undefined;
	const values = models instanceof Map ? models.values() : models;
	if (!values || typeof values[Symbol.iterator] !== "function")
		throw error("invalid", "Model registry must be iterable");
	const ids = new Set();
	for (const entry of values) {
		const id =
			typeof entry === "string"
				? entry
				: (entry?.id ?? entry?.model ?? entry?.value);
		if (!nonempty(id) || id !== id.trim())
			throw error("invalid", "Model registry has an invalid canonical ID");
		ids.add(id);
	}
	return ids;
}
function normalizeProfiles(profiles, options = {}) {
	if (!Array.isArray(profiles))
		throw error("invalid", "Verifier profiles must be an array");
	const known = modelIds(options.models);
	const models = new Set();
	const normalized = profiles.map((profile) => {
		if (
			!plainObject(profile) ||
			!nonempty(profile.model) ||
			profile.model !== profile.model.trim()
		)
			throw error(
				"invalid",
				"Verifier profile has an invalid canonical model ID",
			);
		if (known && !known.has(profile.model))
			throw error("invalid", `Unknown verifier model: ${profile.model}`);
		if (models.has(profile.model))
			throw error("invalid", `Duplicate verifier model: ${profile.model}`);
		models.add(profile.model);
		if (!Array.isArray(profile.operations) || profile.operations.length === 0)
			throw error(
				"invalid",
				`Verifier ${profile.model} has no enabled operations`,
			);
		const operations = [...profile.operations].sort();
		if (
			operations.some((operation) => !OPERATIONS.has(operation)) ||
			new Set(operations).size !== operations.length
		)
			throw error(
				"invalid",
				`Verifier ${profile.model} has invalid enabled operations`,
			);
		if (!EFFORTS.has(profile.thinking))
			throw error(
				"invalid",
				`Verifier ${profile.model} has invalid thinking effort`,
			);
		return { model: profile.model, operations, thinking: profile.thinking };
	});
	return normalized.sort((left, right) =>
		left.model.localeCompare(right.model),
	);
}
export function normalizeEffectiveProfiles(profiles, options = {}) {
	return normalizeProfiles(profiles, options);
}

export function verifierStorePath(cwd = process.cwd()) {
	return path.join(cwd, ".ce-workflow", "work-runs", "verifiers", "state.json");
}
function runtimeDir(cwd) {
	return path.dirname(verifierStorePath(cwd));
}
function recoveryPath(cwd) {
	return path.join(runtimeDir(cwd), ".state.recovery.json");
}
function candidatePath(cwd) {
	return path.join(runtimeDir(cwd), ".state.candidate.json");
}
function lockPath(cwd) {
	return path.join(runtimeDir(cwd), "mutation.lock");
}
function writeDurable(file, content) {
	const fd = openSync(file, "w", 0o600);
	try {
		writeFileSync(fd, content, "utf8");
		fsyncSync(fd);
	} finally {
		closeSync(fd);
	}
	try {
		chmodSync(file, 0o600);
	} catch {
		// Windows ACLs, when present, remain authoritative.
	}
}
function parseSnapshot(content, file) {
	if (/^(<{7}|={7}|>{7})/m.test(content))
		throw error(
			"conflicted",
			`Verifier store contains merge markers: ${file}`,
			{ file },
		);
	let store;
	try {
		store = JSON.parse(content);
	} catch {
		throw error("corrupt", `Verifier store is not valid JSON: ${file}`, {
			file,
		});
	}
	validateVerifierStore(store, file);
	return store;
}
function readValidated(file) {
	return parseSnapshot(readFileSync(file, "utf8"), file);
}

export function serializeVerifierStore(store) {
	validateVerifierStore(store);
	return `${JSON.stringify(canonical(store), null, 2)}\n`;
}
export function loadVerifierStore(cwd = process.cwd()) {
	const primary = verifierStorePath(cwd);
	const recovery = recoveryPath(cwd);
	if (existsSync(primary)) {
		try {
			return readValidated(primary);
		} catch (primaryError) {
			if (primaryError?.category === "unsupported" || !existsSync(recovery))
				throw primaryError;
			try {
				return readValidated(recovery);
			} catch {
				throw primaryError;
			}
		}
	}
	if (existsSync(recovery)) return readValidated(recovery);
	throw error("missing", `Verifier store is missing: ${primary}`, {
		file: primary,
	});
}
export function saveVerifierStore(cwd = process.cwd(), store, options = {}) {
	const content = serializeVerifierStore(store);
	if (options.dryRun) return content;
	const target = verifierStorePath(cwd);
	const recovery = recoveryPath(cwd);
	const candidate = candidatePath(cwd);
	mkdirSync(runtimeDir(cwd), { recursive: true, mode: 0o700 });
	try {
		chmodSync(runtimeDir(cwd), 0o700);
	} catch {
		// Windows ACLs, when present, remain authoritative.
	}
	if (existsSync(target)) {
		const old = readFileSync(target, "utf8");
		parseSnapshot(old, target);
		writeDurable(recovery, old);
		readValidated(recovery);
	}
	if (options.interruptAt === "recovery")
		throw error("interrupted", "Interrupted after recovery write");
	writeDurable(candidate, content);
	readValidated(candidate);
	if (options.interruptAt === "candidate")
		throw error("interrupted", "Interrupted after candidate write");
	try {
		renameSync(candidate, target);
	} catch (cause) {
		if (!existsSync(target))
			throw error(
				"write",
				`Unable to publish verifier store: ${cause.message}`,
				{ cause },
			);
		try {
			rmSync(target);
			renameSync(candidate, target);
		} catch (fallbackCause) {
			throw error(
				"write",
				`Unable to publish verifier store: ${fallbackCause.message}`,
				{ cause: fallbackCause },
			);
		}
	}
	if (options.interruptAt === "replace")
		throw error("interrupted", "Interrupted after verifier store replacement");
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
export function acquireVerifierLock(cwd = process.cwd()) {
	const file = lockPath(cwd);
	mkdirSync(runtimeDir(cwd), { recursive: true, mode: 0o700 });
	let fd;
	try {
		fd = openSync(file, "wx", 0o600);
		writeFileSync(fd, `${process.pid}\n`);
	} catch (cause) {
		if (cause?.code !== "EEXIST")
			throw error(
				"write",
				`Unable to acquire verifier lock: ${cause.message}`,
				{ cause },
			);
		if (!lockOwnerIsDead(file))
			throw error("locked", `Another verifier writer owns ${file}`, { file });
		// ponytail: single-host PID lock; use an OS lock if multi-host writers matter.
		try {
			unlinkSync(file);
		} catch (unlinkCause) {
			if (unlinkCause?.code !== "ENOENT") throw unlinkCause;
		}
		return acquireVerifierLock(cwd);
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
export function initVerifierStore(cwd = process.cwd(), options = {}) {
	try {
		return loadVerifierStore(cwd);
	} catch (cause) {
		if (!(cause instanceof VerifierStoreError) || cause.category !== "missing")
			throw cause;
	}
	const lock = acquireVerifierLock(cwd);
	try {
		try {
			return loadVerifierStore(cwd);
		} catch (cause) {
			if (
				!(cause instanceof VerifierStoreError) ||
				cause.category !== "missing"
			)
				throw cause;
		}
		const timestamp = now(options.now);
		const store = {
			schemaVersion: VERIFIER_STORE_VERSION,
			metadata: { createdAt: timestamp, updatedAt: timestamp },
			batches: {},
			jobs: {},
			reports: {},
			findings: {},
			groups: {},
			claims: {},
			dispositions: {},
		};
		saveVerifierStore(cwd, store);
		return store;
	} finally {
		lock.release();
	}
}
export function mutateVerifierStore(cwd = process.cwd(), mutate, options = {}) {
	const lock = acquireVerifierLock(cwd);
	try {
		const store = loadVerifierStore(cwd);
		const result = mutate(store);
		store.metadata.updatedAt = now(options.now);
		saveVerifierStore(cwd, store, options);
		return result === undefined ? store : result;
	} finally {
		lock.release();
	}
}

function edit(store, change) {
	validateVerifierStore(store);
	const next = structuredClone(store);
	const result = change(next);
	validateVerifierStore(next);
	for (const key of Object.keys(store)) delete store[key];
	Object.assign(store, next);
	return result;
}
function expectedJobId(batchId, model) {
	return stableId("job", { batchId, model });
}
function jobStatus(operationStatus, launch) {
	if (launch?.status === "orphaned") return "orphaned";
	if (launch?.status === "failed") return "failed";
	if (launch?.status === "running") return "running";
	const values = Object.values(operationStatus);
	if (values.every((value) => value === "pending")) return "queued";
	if (values.some((value) => value === "pending")) return "running";
	if (values.every((value) => value === "failed")) return "failed";
	if (values.some((value) => value === "failed")) return "partially-failed";
	return "completed";
}
function git(cwd, args, options = {}) {
	return execFileSync("git", args, {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
		...options,
	}).trim();
}
function gitLines(cwd, args, options) {
	const output = git(cwd, args, options);
	return output ? output.split(/\r?\n/).filter(Boolean) : [];
}
function snapshotPaths(cwd, base, snapshot, paths) {
	const changed = new Set(
		[
			...gitLines(
				cwd,
				snapshot === base
					? ["diff", "--name-only", base]
					: ["diff", "--name-only", base, snapshot],
			),
			...git(cwd, ["ls-files", "--others", "--exclude-standard", "-z"])
				.split("\0")
				.filter(Boolean),
		].filter((entry) => !entry.startsWith(".ce-workflow/work-runs/verifiers/")),
	);
	const scoped = paths === undefined ? [...changed].sort() : [...paths].sort();
	if (!scoped.length)
		throw error("not-scheduled", "Verifier checkpoint has no changed paths");
	for (const entry of scoped) {
		relativePath(entry, "checkpoint path");
		if (!changed.has(entry))
			throw error(
				"not-scheduled",
				`Verifier checkpoint path is outside changed scope: ${entry}`,
			);
	}
	return scoped;
}
function assertNoSnapshotSymlinks(cwd) {
	const tracked = gitLines(cwd, ["ls-files", "-s"]);
	if (tracked.some((line) => /^120000\s/.test(line)))
		throw error(
			"not-scheduled",
			"Verifier snapshot contains a tracked symlink",
		);
	const untracked = git(cwd, [
		"ls-files",
		"--others",
		"--exclude-standard",
		"-z",
	])
		.split("\0")
		.filter(Boolean);
	for (const entry of untracked) {
		try {
			if (lstatSync(path.join(cwd, entry)).isSymbolicLink())
				throw error(
					"not-scheduled",
					"Verifier snapshot contains an untracked symlink",
				);
		} catch (cause) {
			if (cause instanceof VerifierStoreError) throw cause;
			throw error("not-scheduled", `Verifier snapshot cannot read ${entry}`);
		}
	}
}
function verifierRuntimeRoot(cwd) {
	return path.join(runtimeDir(cwd), "runtime");
}
function checkpointRef(batchId) {
	return `refs/ce-workflow/verifiers/${batchId}`;
}

// Capturing through a private index is the only git mutation path here; it
// never touches the caller's index, branch, or working tree.
export function captureVerifierCheckpoint(cwd = process.cwd(), input = {}) {
	let temporaryIndex;
	try {
		const base = git(cwd, ["rev-parse", "HEAD"]);
		if (gitLines(cwd, ["ls-files", "-u"]).length)
			throw error(
				"not-scheduled",
				"Verifier snapshot has unresolved conflicts",
			);
		assertNoSnapshotSymlinks(cwd);
		const changedPaths = snapshotPaths(cwd, base, base, input.paths);
		const dirty = changedPaths.length > 0;
		let snapshot = base;
		if (dirty) {
			temporaryIndex = path.join(
				mkdtempSync(path.join(os.tmpdir(), "ce-verifier-index-")),
				"index",
			);
			const env = { ...process.env, GIT_INDEX_FILE: temporaryIndex };
			git(cwd, ["read-tree", base], { env });
			git(cwd, ["add", "-A", "--", ...changedPaths], { env });
			const tree = git(cwd, ["write-tree"], { env });
			const commitEnv = {
				...env,
				GIT_AUTHOR_NAME: "ce-workflow verifier",
				GIT_AUTHOR_EMAIL: "verifier@ce-workflow.invalid",
				GIT_COMMITTER_NAME: "ce-workflow verifier",
				GIT_COMMITTER_EMAIL: "verifier@ce-workflow.invalid",
				GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z",
				GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z",
			};
			snapshot = git(cwd, ["commit-tree", tree, "-p", base], {
				env: commitEnv,
			});
		}
		const parent = dirty
			? base
			: (() => {
					try {
						return git(cwd, ["rev-parse", "HEAD^"]);
					} catch {
						throw error(
							"not-scheduled",
							"Verifier checkpoint needs a parent commit",
						);
					}
				})();
		const paths = dirty
			? changedPaths
			: snapshotPaths(cwd, parent, snapshot, input.paths);
		const patchHash = createHash("sha256")
			.update(git(cwd, ["diff", "--binary", parent, snapshot]))
			.digest("hex");
		return {
			repository: path.resolve(cwd),
			base: parent,
			snapshot,
			paths,
			patchHash,
		};
	} catch (cause) {
		if (cause instanceof VerifierStoreError) throw cause;
		throw error("not-scheduled", `Verifier snapshot failed: ${cause.message}`);
	} finally {
		if (temporaryIndex)
			rmSync(path.dirname(temporaryIndex), { recursive: true, force: true });
	}
}
function ensureVerifierWorkspace(cwd, batch) {
	// Keep the agent outside the repository: an archive has no .git directory,
	// worktree links, project settings, or parent path to project credentials.
	const workspace = mkdtempSync(
		path.join(os.tmpdir(), "ce-verifier-workspace-"),
	);
	try {
		git(cwd, [
			"update-ref",
			checkpointRef(batch.id),
			batch.checkpoint.snapshot,
		]);
		const archive = execFileSync(
			"git",
			["archive", batch.checkpoint.snapshot],
			{
				cwd,
				encoding: null,
				stdio: ["ignore", "pipe", "pipe"],
			},
		);
		execFileSync("tar", ["-x", "-C", workspace], {
			input: archive,
			stdio: ["pipe", "pipe", "pipe"],
		});
		const marker = path.join(workspace, ".ce-verifier-workspace.json");
		writeFileSync(
			marker,
			`${JSON.stringify({ version: 1, paths: batch.checkpoint.paths })}\n`,
			{ mode: 0o400 },
		);
		chmodSync(marker, 0o400);
		return workspace;
	} catch (cause) {
		rmSync(workspace, { recursive: true, force: true });
		throw error("not-scheduled", `Verifier workspace failed: ${cause.message}`);
	}
}
function verifierRequest(cwd, batch, job, workspace) {
	workspace ??= ensureVerifierWorkspace(cwd, batch);
	const outputDir = path.join(verifierRuntimeRoot(cwd), "outputs");
	mkdirSync(outputDir, { recursive: true, mode: 0o700 });
	return {
		version: 1,
		logicalJobId: job.id,
		agent: "work-background-verifier",
		model: job.model,
		thinking: job.thinking,
		operations: job.operations,
		context: "fresh",
		async: true,
		cwd: workspace,
		output: path.join(outputDir, `${job.id}.json`),
		outputMode: "file-only",
		boundary: {
			toolAllowlist: [
				"work_verifier_read",
				"work_verifier_list",
				"work_verifier_find",
				"work_verifier_grep",
			],
			deny: ["write", "edit", "bash", "process", "network"],
			readOnlyWorkspace: true,
			cwdConfinedReadTools: true,
			credentialsIsolated: true,
		},
		checkpoint: structuredClone(batch.checkpoint),
		paths: [...batch.checkpoint.paths],
	};
}
export function queueVerifierJobs(store, input = {}) {
	return edit(store, (next) => {
		const batch = next.batches[input.batchId];
		if (!batch)
			throw error("missing", `Verifier batch is missing: ${input.batchId}`);
		for (const job of Object.values(next.jobs).filter(
			(item) => item.batchId === batch.id,
		)) {
			if (job.launch) continue;
			const request = input.requests?.[job.id];
			if (
				!plainObject(request) ||
				request.logicalJobId !== job.id ||
				request.model !== job.model
			)
				throw error("invalid", `Invalid launch request for ${job.id}`);
			job.launch = {
				logicalJobId: job.id,
				status: "queued",
				request,
				queuedAt: now(input.now),
			};
		}
		return batch;
	});
}
export function recordVerifierLaunch(store, input = {}) {
	return edit(store, (next) => {
		const job = next.jobs[input.jobId];
		if (!job?.launch || job.launch.status !== "queued")
			throw error("invalid", `Verifier job is not launchable: ${input.jobId}`);
		const identity = input.identity ?? {};
		if (
			input.ambiguous ||
			(input.ok && !identity.runId && !identity.asyncDir)
		) {
			job.launch = {
				...job.launch,
				status: "orphaned",
				orphanedAt: now(input.now),
			};
			job.status = "orphaned";
		} else if (input.ok) {
			job.launch = {
				...job.launch,
				status: "running",
				runId: identity.runId,
				asyncDir: identity.asyncDir,
				launchedAt: now(input.now),
			};
			job.status = "running";
		} else {
			job.launch = {
				...job.launch,
				status: "failed",
				failure: String(input.failure ?? "launch failed"),
				failedAt: now(input.now),
			};
			job.status = "failed";
		}
		return job;
	});
}
export async function launchQueuedVerifierJobs(cwd = process.cwd(), adapter) {
	if (!adapter?.enforcesReadOnlyBoundary || typeof adapter.spawn !== "function")
		return [];
	let store;
	try {
		store = loadVerifierStore(cwd);
	} catch {
		return [];
	}
	const launched = [];
	for (const job of Object.values(store.jobs).filter(
		(item) => item.launch?.status === "queued",
	)) {
		let reply;
		try {
			reply = await adapter.spawn(structuredClone(job.launch.request));
		} catch (cause) {
			reply = { ok: false, ambiguous: true, failure: cause.message };
		}
		const data = reply?.reply?.data ?? reply?.data ?? reply ?? {};
		const result = data.result ?? {};
		const identity = {
			runId: data.runId ?? data.id ?? result.runId ?? result.id,
			asyncDir: data.asyncDir ?? result.asyncDir,
		};
		mutateVerifierStore(cwd, (state) =>
			recordVerifierLaunch(state, {
				jobId: job.id,
				ok: reply?.ok === true,
				ambiguous:
					reply?.ambiguous ||
					(reply?.ok === true && !identity.runId && !identity.asyncDir),
				identity,
				failure: reply?.message ?? reply?.failure,
			}),
		);
		launched.push(job.id);
	}
	return launched;
}
function recordNotScheduledBatch(cwd, profiles, reason, input) {
	const base = createHash("sha1").update(path.resolve(cwd)).digest("hex");
	const snapshot = createHash("sha1").update(reason).digest("hex");
	const checkpoint = {
		repository: path.resolve(cwd),
		base,
		snapshot:
			snapshot === base
				? `${snapshot.slice(0, -1)}${snapshot.endsWith("0") ? "1" : "0"}`
				: snapshot,
		paths: input.paths?.length ? [...input.paths].sort() : [".ce-workflow"],
		patchHash: createHash("sha256").update(reason).digest("hex"),
	};
	initVerifierStore(cwd);
	return mutateVerifierStore(cwd, (store) =>
		edit(store, (next) => {
			const id = stableId("batch", { checkpoint, profiles, reason });
			return (next.batches[id] ??= {
				id,
				checkpoint,
				profiles,
				createdAt: now(input.now),
				status: "not-scheduled",
				reason,
			});
		}),
	);
}
export function scheduleVerifierBatch(cwd = process.cwd(), input = {}) {
	if (input.origin === "verifier-fix")
		return { status: "suppressed", launch: Promise.resolve([]) };
	const profiles = normalizeProfiles(input.profiles ?? [], input);
	if (!profiles.length)
		return { status: "not-configured", launch: Promise.resolve([]) };
	let checkpoint;
	try {
		checkpoint = captureVerifierCheckpoint(cwd, input);
	} catch (cause) {
		const batch = recordNotScheduledBatch(cwd, profiles, cause.message, input);
		return {
			status: "not-scheduled",
			batch,
			reason: cause.message,
			launch: Promise.resolve([]),
		};
	}
	const batchId = stableId("batch", { checkpoint, profiles });
	initVerifierStore(cwd);
	const existing = loadVerifierStore(cwd).batches[batchId];
	if (existing)
		return {
			status: existing.status,
			batch: existing,
			launch: launchQueuedVerifierJobs(cwd, input.adapter),
		};
	const provisional = { id: batchId, checkpoint, profiles };
	const requests = {};
	try {
		const workspace = ensureVerifierWorkspace(cwd, provisional);
		for (const profile of profiles) {
			const job = {
				id: expectedJobId(batchId, profile.model),
				model: profile.model,
				operations: profile.operations,
				thinking: profile.thinking,
			};
			requests[job.id] = verifierRequest(cwd, provisional, job, workspace);
		}
		const batch = mutateVerifierStore(cwd, (store) =>
			createBatch(store, { checkpoint, profiles, requests, now: input.now }),
		);
		return {
			status: "queued",
			batch,
			launch: launchQueuedVerifierJobs(cwd, input.adapter),
		};
	} catch (cause) {
		const batch = recordNotScheduledBatch(cwd, profiles, cause.message, input);
		return {
			status: "not-scheduled",
			batch,
			reason: cause.message,
			launch: Promise.resolve([]),
		};
	}
}

export function createBatch(store, input = {}) {
	const checkpoint = validateCheckpoint(
		input.checkpoint,
		"batch input",
		"invalid",
	);
	const profiles = normalizeProfiles(input.profiles, input);
	return edit(store, (next) => {
		const id = stableId("batch", { checkpoint, profiles });
		if (next.batches[id]) return next.batches[id];
		const timestamp = now(input.now);
		const batch = {
			id,
			checkpoint,
			profiles,
			createdAt: timestamp,
			status: profiles.length ? "queued" : "not-scheduled",
		};
		next.batches[id] = batch;
		for (const profile of profiles) {
			const jobId = expectedJobId(id, profile.model);
			const request = input.requests?.[jobId];
			if (
				request !== undefined &&
				(!plainObject(request) ||
					request.logicalJobId !== jobId ||
					request.model !== profile.model)
			)
				throw error("invalid", `Invalid launch request for ${jobId}`);
			next.jobs[jobId] = {
				id: jobId,
				batchId: id,
				model: profile.model,
				operations: profile.operations,
				thinking: profile.thinking,
				operationStatus: Object.fromEntries(
					profile.operations.map((operation) => [operation, "pending"]),
				),
				status: "queued",
				...(request
					? {
							launch: {
								logicalJobId: jobId,
								status: "queued",
								request,
								queuedAt: timestamp,
							},
						}
					: {}),
				createdAt: timestamp,
			};
		}
		return batch;
	});
}
export function getBatch(store, id) {
	validateVerifierStore(store);
	return store.batches[id];
}
export function listBatches(store) {
	validateVerifierStore(store);
	return Object.values(store.batches).sort((left, right) =>
		left.id.localeCompare(right.id),
	);
}
export function getJob(store, id) {
	validateVerifierStore(store);
	return store.jobs[id];
}
export function listJobs(store, filter = {}) {
	validateVerifierStore(store);
	return Object.values(store.jobs)
		.filter((job) =>
			Object.entries(filter).every(([key, value]) => job[key] === value),
		)
		.sort((left, right) => left.id.localeCompare(right.id));
}
export function recordOperationResult(store, input = {}) {
	return edit(store, (next) => {
		const job = next.jobs[input.jobId];
		if (!job) throw error("missing", `Verifier job is missing: ${input.jobId}`);
		if (!job.operations.includes(input.operation))
			throw error(
				"invalid",
				"Operation was not requested for this verifier job",
			);
		if (!OUTCOMES.has(input.outcome))
			throw error("invalid", "Invalid verifier operation outcome");
		if (
			input.usage !== undefined &&
			(!plainObject(input.usage) ||
				Object.values(input.usage).some(
					(value) =>
						typeof value !== "number" || !Number.isFinite(value) || value < 0,
				))
		)
			throw error(
				"invalid",
				"Verifier usage must contain non-negative numbers",
			);
		if (input.outcome === "failed" && !nonempty(input.failure))
			throw error(
				"invalid",
				"Failed verifier operation needs a failure reason",
			);
		const id = stableId("report", {
			jobId: job.id,
			operation: input.operation,
		});
		const existing = next.reports[id];
		const comparable = {
			outcome: input.outcome,
			usage: input.usage,
			failure: input.failure,
		};
		if (existing) {
			if (
				!same(
					{
						outcome: existing.outcome,
						usage: existing.usage,
						failure: existing.failure,
					},
					comparable,
				)
			)
				throw error(
					"conflict",
					`Conflicting terminal result for ${job.id}/${input.operation}`,
				);
			return existing;
		}
		const report = {
			id,
			batchId: job.batchId,
			jobId: job.id,
			model: job.model,
			operation: input.operation,
			checkpoint: structuredClone(next.batches[job.batchId].checkpoint),
			outcome: input.outcome,
			...(input.usage === undefined
				? {}
				: { usage: structuredClone(input.usage) }),
			...(input.failure === undefined ? {} : { failure: input.failure }),
			createdAt: now(input.now),
		};
		next.reports[id] = report;
		job.operationStatus[input.operation] = input.outcome;
		job.status = jobStatus(job.operationStatus, job.launch);
		if (
			Object.values(next.jobs)
				.filter((candidate) => candidate.batchId === job.batchId)
				.every((candidate) => !["queued", "running"].includes(candidate.status))
		)
			next.batches[job.batchId].status = "terminal";
		return report;
	});
}
export function addFinding(store, input = {}) {
	return edit(store, (next) => {
		const report = next.reports[input.reportId];
		if (!report || report.outcome !== "findings")
			throw error("invalid", "Finding must belong to a findings report");
		if (
			input.operation !== report.operation ||
			input.model !== report.model ||
			!same(input.checkpoint, report.checkpoint)
		)
			throw error("invalid", "Finding identity does not match its report");
		relativePath(input.path);
		if (
			!nonempty(input.category) ||
			!SEVERITIES.has(input.severity) ||
			!nonempty(input.rationale) ||
			!nonempty(input.suggestedAction)
		)
			throw error("invalid", "Finding is missing required attribution");
		const identity = {
			reportId: report.id,
			path: input.path,
			category: input.category,
			severity: input.severity,
			rationale: input.rationale,
			suggestedAction: input.suggestedAction,
		};
		const id = stableId("finding", identity);
		if (input.id !== undefined && input.id !== id)
			throw error("invalid", "Finding ID does not match its stable identity");
		if (next.findings[id]) {
			if (!same(next.findings[id], { ...next.findings[id], ...identity, id }))
				throw error("conflict", `Conflicting finding: ${id}`);
			return next.findings[id];
		}
		const finding = {
			id,
			...identity,
			operation: report.operation,
			model: report.model,
			checkpoint: structuredClone(report.checkpoint),
			createdAt: now(input.now),
		};
		next.findings[id] = finding;
		return finding;
	});
}
export function addGroup(store, input = {}) {
	return edit(store, (next) => {
		if (!Array.isArray(input.findingIds) || input.findingIds.length === 0)
			throw error("invalid", "Group needs findings");
		const findingIds = [...input.findingIds].sort();
		if (
			new Set(findingIds).size !== findingIds.length ||
			findingIds.some((id) => !next.findings[id])
		)
			throw error("invalid", "Group has unknown or duplicate findings");
		const id = stableId("group", { findingIds });
		if (next.groups[id]) return next.groups[id];
		const group = {
			id,
			findingIds,
			status: "completed",
			createdAt: now(input.now),
		};
		next.groups[id] = group;
		return group;
	});
}
export function claimGroup(store, input = {}) {
	return edit(store, (next) => {
		if (!next.groups[input.groupId])
			throw error("missing", `Verifier group is missing: ${input.groupId}`);
		if (
			!nonempty(input.ownerSession) ||
			!nonempty(input.leaseUntil) ||
			Number.isNaN(Date.parse(input.leaseUntil))
		)
			throw error("invalid", "Claim needs owner session and lease expiry");
		const id = stableId("claim", { groupId: input.groupId });
		const existing = next.claims[id];
		if (existing) {
			if (
				existing.ownerSession === input.ownerSession &&
				existing.leaseUntil === input.leaseUntil
			)
				return existing;
			throw error(
				"locked",
				`Verifier group is already claimed: ${input.groupId}`,
			);
		}
		const claim = {
			id,
			groupId: input.groupId,
			ownerSession: input.ownerSession,
			leaseUntil: input.leaseUntil,
			createdAt: now(input.now),
		};
		next.claims[id] = claim;
		return claim;
	});
}
export function recordDisposition(store, input = {}) {
	return edit(store, (next) => {
		const finding = next.findings[input.findingId];
		if (!finding)
			throw error("missing", `Verifier finding is missing: ${input.findingId}`);
		if (!DISPOSITIONS.has(input.disposition) || !nonempty(input.reason))
			throw error("invalid", "Invalid verifier disposition");
		const id = stableId("disposition", { findingId: finding.id });
		const existing = next.dispositions[id];
		if (existing) {
			if (
				existing.disposition === input.disposition &&
				existing.reason === input.reason
			)
				return existing;
			throw error("conflict", `Conflicting disposition for ${finding.id}`);
		}
		const disposition = {
			id,
			findingId: finding.id,
			disposition: input.disposition,
			reason: input.reason,
			createdAt: now(input.now),
		};
		next.dispositions[id] = disposition;
		finding.dispositionId = id;
		return disposition;
	});
}

export function validateVerifierStore(store, file = "verifier store") {
	if (!plainObject(store))
		throw error("corrupt", `Verifier store must be an object: ${file}`);
	if (store.schemaVersion !== VERIFIER_STORE_VERSION) {
		throw error(
			Number(store.schemaVersion) > VERIFIER_STORE_VERSION
				? "unsupported"
				: "corrupt",
			`Unsupported verifier store schema ${store.schemaVersion}: ${file}`,
		);
	}
	if (
		!plainObject(store.metadata) ||
		!nonempty(store.metadata.createdAt) ||
		!nonempty(store.metadata.updatedAt)
	)
		throw error("corrupt", `Invalid verifier metadata in ${file}`);
	for (const field of [
		"batches",
		"jobs",
		"reports",
		"findings",
		"groups",
		"claims",
		"dispositions",
	])
		objectMap(store[field], field, file);
	for (const [id, batch] of Object.entries(store.batches)) {
		if (
			!plainObject(batch) ||
			batch.id !== id ||
			!["queued", "not-scheduled", "terminal"].includes(batch.status)
		)
			throw error("corrupt", `Invalid batch ${id} in ${file}`);
		validateCheckpoint(batch.checkpoint, file);
		normalizeProfiles(batch.profiles);
	}
	for (const [id, job] of Object.entries(store.jobs)) {
		const batch = store.batches[job?.batchId];
		if (
			!plainObject(job) ||
			job.id !== id ||
			!batch ||
			job.id !== expectedJobId(job.batchId, job.model)
		)
			throw error("corrupt", `Invalid job ${id} in ${file}`);
		const profile = batch.profiles.find((entry) => entry.model === job.model);
		if (
			!profile ||
			!same(profile.operations, job.operations) ||
			profile.thinking !== job.thinking ||
			!plainObject(job.operationStatus)
		)
			throw error("corrupt", `Invalid job profile ${id} in ${file}`);
		if (
			!same(Object.keys(job.operationStatus).sort(), job.operations) ||
			Object.values(job.operationStatus).some(
				(status) => !["pending", ...OUTCOMES].includes(status),
			) ||
			job.status !== jobStatus(job.operationStatus, job.launch)
		)
			throw error(
				"corrupt",
				`Invalid operation accounting for ${id} in ${file}`,
			);
		if (
			job.launch !== undefined &&
			(!plainObject(job.launch) ||
				job.launch.logicalJobId !== job.id ||
				!["queued", "running", "orphaned", "failed"].includes(
					job.launch.status,
				) ||
				!plainObject(job.launch.request) ||
				job.launch.request.logicalJobId !== job.id ||
				job.launch.request.model !== job.model)
		)
			throw error("corrupt", `Invalid launch evidence for ${id} in ${file}`);
	}
	for (const [id, report] of Object.entries(store.reports)) {
		const job = store.jobs[report?.jobId];
		if (
			!plainObject(report) ||
			report.id !== id ||
			!job ||
			report.batchId !== job.batchId ||
			report.model !== job.model ||
			!job.operations.includes(report.operation) ||
			report.id !==
				stableId("report", { jobId: job.id, operation: report.operation }) ||
			!OUTCOMES.has(report.outcome) ||
			!same(report.checkpoint, store.batches[job.batchId].checkpoint) ||
			job.operationStatus[report.operation] !== report.outcome
		)
			throw error("corrupt", `Invalid report ${id} in ${file}`);
		if (
			report.usage !== undefined &&
			(!plainObject(report.usage) ||
				Object.values(report.usage).some(
					(value) =>
						typeof value !== "number" || !Number.isFinite(value) || value < 0,
				))
		)
			throw error("corrupt", `Invalid report usage ${id} in ${file}`);
	}
	for (const job of Object.values(store.jobs))
		for (const operation of job.operations) {
			const reportId = stableId("report", { jobId: job.id, operation });
			if (
				(job.operationStatus[operation] === "pending") ===
				Boolean(store.reports[reportId])
			)
				throw error(
					"corrupt",
					`Operation report mismatch for ${job.id}/${operation} in ${file}`,
				);
		}
	for (const [id, finding] of Object.entries(store.findings)) {
		const report = store.reports[finding?.reportId];
		const identity = {
			reportId: finding?.reportId,
			path: finding?.path,
			category: finding?.category,
			severity: finding?.severity,
			rationale: finding?.rationale,
			suggestedAction: finding?.suggestedAction,
		};
		if (
			!plainObject(finding) ||
			finding.id !== id ||
			id !== stableId("finding", identity) ||
			!report ||
			report.outcome !== "findings" ||
			finding.operation !== report.operation ||
			finding.model !== report.model ||
			!same(finding.checkpoint, report.checkpoint) ||
			!nonempty(finding.category) ||
			!SEVERITIES.has(finding.severity) ||
			!nonempty(finding.rationale) ||
			!nonempty(finding.suggestedAction)
		)
			throw error("corrupt", `Invalid finding ${id} in ${file}`);
		try {
			relativePath(finding.path);
		} catch {
			throw error("corrupt", `Invalid finding path ${id} in ${file}`);
		}
		if (
			finding.dispositionId !== undefined &&
			!store.dispositions[finding.dispositionId]
		)
			throw error("corrupt", `Unknown finding disposition ${id} in ${file}`);
	}
	for (const [id, group] of Object.entries(store.groups)) {
		if (
			!plainObject(group) ||
			group.id !== id ||
			group.status !== "completed" ||
			!Array.isArray(group.findingIds) ||
			group.findingIds.length === 0 ||
			!same(group.findingIds, [...group.findingIds].sort()) ||
			new Set(group.findingIds).size !== group.findingIds.length ||
			group.findingIds.some((findingId) => !store.findings[findingId]) ||
			group.id !== stableId("group", { findingIds: group.findingIds })
		)
			throw error("corrupt", `Invalid group ${id} in ${file}`);
	}
	for (const [id, claim] of Object.entries(store.claims)) {
		if (
			!plainObject(claim) ||
			claim.id !== id ||
			!store.groups[claim.groupId] ||
			!nonempty(claim.ownerSession) ||
			!nonempty(claim.leaseUntil) ||
			Number.isNaN(Date.parse(claim.leaseUntil)) ||
			claim.id !== stableId("claim", { groupId: claim.groupId })
		)
			throw error("corrupt", `Invalid claim ${id} in ${file}`);
	}
	for (const [id, disposition] of Object.entries(store.dispositions)) {
		if (
			!plainObject(disposition) ||
			disposition.id !== id ||
			!store.findings[disposition.findingId] ||
			!DISPOSITIONS.has(disposition.disposition) ||
			!nonempty(disposition.reason) ||
			disposition.id !==
				stableId("disposition", { findingId: disposition.findingId }) ||
			store.findings[disposition.findingId].dispositionId !== id
		)
			throw error("corrupt", `Invalid disposition ${id} in ${file}`);
	}
	return store;
}
