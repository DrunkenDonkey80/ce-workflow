import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
	chmodSync,
	closeSync,
	existsSync,
	fstatSync,
	fsyncSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	openSync,
	readFileSync,
	readdirSync,
	readSync,
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
const REPORT_MAX_BYTES = 1024 * 1024;
const REPORT_MAX_DEPTH = 20;
const REPORT_MAX_FINDINGS = 100;
const REPORT_MAX_TEXT = 10_000;
const REPORT_CATEGORIES = /^[a-z][a-z0-9-]{0,63}$/;
const TERMINAL_SUCCESS_STATES = new Set([
	"complete",
	"completed",
	"success",
	"ok",
	"passed",
]);
const TERMINAL_FAILURE_STATES = new Set([
	"failed",
	"error",
	"cancelled",
	"canceled",
	"timed_out",
	"timeout",
]);

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
	if (
		value.scope !== undefined &&
		!["auto", "changes", "commit", "project", "custom"].includes(value.scope)
	)
		fail("Invalid checkpoint scope");
	return {
		repository: value.repository,
		base: value.base,
		snapshot: value.snapshot,
		paths: [...value.paths].sort(),
		patchHash: value.patchHash,
		...(value.scope === undefined ? {} : { scope: value.scope }),
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
			quarantines: {},
			findings: {},
			groups: {},
			claims: {},
			dispositions: {},
			fixes: {},
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
	const values = Object.values(operationStatus);
	if (values.every((value) => value === "pending"))
		return launch?.status === "running" ? "running" : "queued";
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

function verifierCommitEnv(env = process.env) {
	return {
		...env,
		GIT_AUTHOR_NAME: "ce-workflow verifier",
		GIT_AUTHOR_EMAIL: "verifier@ce-workflow.invalid",
		GIT_COMMITTER_NAME: "ce-workflow verifier",
		GIT_COMMITTER_EMAIL: "verifier@ce-workflow.invalid",
		GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z",
		GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z",
	};
}

function emptyVerifierBase(cwd) {
	const tree = git(cwd, ["hash-object", "-t", "tree", "--stdin"]);
	return git(cwd, ["commit-tree", tree, "-m", "ce-workflow verifier base"], {
		env: verifierCommitEnv(),
	});
}
function snapshotPaths(cwd, base, snapshot, paths, allowEmpty = false) {
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
	if (!scoped.length) {
		if (allowEmpty) return [];
		throw error("not-scheduled", "Verifier checkpoint has no changed paths");
	}
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

const PROJECT_AUXILIARY_DIRS = new Set([
	".ce-workflow",
	".github",
	".idea",
	".pi",
	".pi-subagents",
	".vscode",
	"benchmark",
	"benchmarks",
	"coverage",
	"doc",
	"docs",
	"documentation",
	"log",
	"logs",
]);
const PROJECT_TEST_DIRS = new Set([
	"__tests__",
	"spec",
	"specs",
	"test",
	"tests",
]);

function projectSourcePath(entry, includeTests) {
	const parts = entry.toLowerCase().split("/");
	const base = parts.at(-1);
	if (parts.some((part) => PROJECT_AUXILIARY_DIRS.has(part))) return false;
	if (
		base.startsWith(".") ||
		/^(?:agents\.md|bun\.lockb?|cargo\.(?:lock|toml)|changelog|composer\.(?:json|lock)|contributing|deno\.jsonc?|gemfile(?:\.lock)?|go\.(?:mod|sum)|gradle\.properties|jsconfig(?:\..+)?\.json|license|package(?:-lock)?\.json|pnpm-lock\.yaml|poetry\.lock|pom\.xml|pyproject\.toml|readme|requirements[^/]*\.txt|settings\.gradle(?:\.kts)?|tsconfig(?:\..+)?\.json|yarn\.lock)(?:\.|$)/i.test(
			base,
		)
	)
		return false;
	if (/^(?:benchmark|benchmarks)(?:[._-]|$)/i.test(base)) return false;
	const test =
		parts.some((part) => PROJECT_TEST_DIRS.has(part)) ||
		/^(?:test(?:[._-]|$)|.+[._-](?:spec|test)\.)/i.test(base);
	return includeTests || !test;
}

function projectSnapshotPaths(cwd, snapshot, operations = []) {
	const includeTests = operations.includes("test-gap");
	return gitLines(cwd, ["ls-tree", "-r", "--name-only", snapshot]).filter(
		(entry) =>
			!entry.startsWith(".ce-workflow/work-runs/verifiers/") &&
			projectSourcePath(entry, includeTests),
	);
}

function globPattern(pattern) {
	let source = "";
	for (let index = 0; index < pattern.length; index += 1) {
		const character = pattern[index];
		if (character === "*" && pattern[index + 1] === "*") {
			source += ".*";
			index += 1;
		} else if (character === "*") source += "[^/]*";
		else if (character === "?") source += "[^/]";
		else source += character.replace(/[.+^${}()|[\]\\]/g, "\\$&");
	}
	return new RegExp(`^${source}$`);
}

function customSnapshotPaths(cwd, snapshot, patterns = []) {
	const available = projectSnapshotPaths(cwd, snapshot);
	const selected = new Set();
	for (const pattern of patterns) {
		relativePath(pattern, "checkpoint pattern");
		const wildcard = /[*?]/.test(pattern);
		const matches = available.filter((entry) =>
			wildcard
				? globPattern(pattern).test(entry)
				: entry === pattern || entry.startsWith(`${pattern}/`),
		);
		if (!matches.length)
			throw error(
				"not-scheduled",
				`Verifier checkpoint pattern matched no files: ${pattern}`,
			);
		for (const entry of matches) selected.add(entry);
	}
	if (!selected.size)
		throw error("not-scheduled", "Verifier checkpoint has no custom paths");
	return [...selected].sort();
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
		const scope = input.scope ?? "auto";
		if (!["auto", "changes", "commit", "project", "custom"].includes(scope))
			throw error("invalid", `Invalid verifier scope: ${scope}`);
		const head = git(cwd, ["rev-parse", "HEAD"]);
		if (gitLines(cwd, ["ls-files", "-u"]).length)
			throw error(
				"not-scheduled",
				"Verifier snapshot has unresolved conflicts",
			);
		assertNoSnapshotSymlinks(cwd);
		const workingPaths = snapshotPaths(cwd, head, head, undefined, true);
		const dirty = workingPaths.length > 0;
		if (scope === "changes" && !dirty)
			throw error(
				"not-scheduled",
				"Verifier checkpoint has no current changes",
			);
		let snapshot = head;
		if (dirty && scope !== "commit") {
			temporaryIndex = path.join(
				mkdtempSync(path.join(os.tmpdir(), "ce-verifier-index-")),
				"index",
			);
			const env = { ...process.env, GIT_INDEX_FILE: temporaryIndex };
			git(cwd, ["read-tree", head], { env });
			git(cwd, ["add", "-A", "--", ...workingPaths], { env });
			const tree = git(cwd, ["write-tree"], { env });
			snapshot = git(cwd, ["commit-tree", tree, "-p", head], {
				env: verifierCommitEnv(env),
			});
		}
		const parent =
			dirty && scope !== "commit"
				? head
				: (() => {
						try {
							return git(cwd, ["rev-parse", "HEAD^"]);
						} catch {
							if (scope === "project" || scope === "custom")
								return emptyVerifierBase(cwd);
							throw error(
								"not-scheduled",
								"Verifier checkpoint needs a parent commit",
							);
						}
					})();
		const paths =
			scope === "project"
				? projectSnapshotPaths(cwd, snapshot, input.operations)
				: scope === "custom"
					? customSnapshotPaths(cwd, snapshot, input.patterns ?? input.paths)
					: scope === "commit"
						? snapshotPaths(cwd, parent, snapshot, input.paths)
						: dirty
							? input.paths
								? snapshotPaths(cwd, head, snapshot, input.paths)
								: workingPaths
							: snapshotPaths(cwd, parent, snapshot, input.paths);
		if (!paths.length)
			throw error("not-scheduled", "Verifier checkpoint has no project files");
		const patchHash = createHash("sha256")
			.update(git(cwd, ["diff", "--binary", parent, snapshot]))
			.digest("hex");
		return {
			repository: path.resolve(cwd),
			base: parent,
			snapshot,
			paths,
			patchHash,
			scope,
		};
	} catch (cause) {
		if (cause instanceof VerifierStoreError) throw cause;
		throw error("not-scheduled", `Verifier snapshot failed: ${cause.message}`);
	} finally {
		if (temporaryIndex)
			rmSync(path.dirname(temporaryIndex), { recursive: true, force: true });
	}
}
function pruneVerifierWorkspace(root, paths) {
	const files = new Set(paths);
	const directories = new Set([""]);
	for (const file of paths) {
		const parts = file.split("/");
		parts.pop();
		for (let index = 1; index <= parts.length; index += 1)
			directories.add(parts.slice(0, index).join("/"));
	}
	const prune = (relative = "") => {
		for (const entry of readdirSync(path.join(root, relative), {
			withFileTypes: true,
		})) {
			const file = relative ? `${relative}/${entry.name}` : entry.name;
			if (entry.isDirectory()) {
				if (directories.has(file)) prune(file);
				else rmSync(path.join(root, file), { recursive: true, force: true });
			} else if (!files.has(file)) unlinkSync(path.join(root, file));
		}
	};
	prune();
}

function ensureVerifierWorkspace(cwd, batch) {
	// Keep the agent outside the repository: an archive has no .git directory,
	// worktree links, project settings, or parent path to project credentials.
	const workspace = mkdtempSync(
		path.join(os.tmpdir(), "ce-verifier-workspace-"),
	);
	let refCreated = false;
	try {
		git(cwd, [
			"update-ref",
			checkpointRef(batch.id),
			batch.checkpoint.snapshot,
		]);
		refCreated = true;
		const projectScope = batch.checkpoint.scope === "project";
		const archivedPaths = projectScope
			? batch.checkpoint.paths
			: gitLines(cwd, [
					"--literal-pathspecs",
					"ls-tree",
					"-r",
					"--name-only",
					batch.checkpoint.snapshot,
					"--",
					...batch.checkpoint.paths,
				]);
		if (archivedPaths.length) {
			const archive = path.join(workspace, ".snapshot.tar");
			execFileSync(
				"git",
				projectScope
					? ["archive", `--output=${archive}`, batch.checkpoint.snapshot]
					: [
							"--literal-pathspecs",
							"archive",
							`--output=${archive}`,
							batch.checkpoint.snapshot,
							"--",
							...archivedPaths,
						],
				{ cwd, stdio: ["ignore", "ignore", "pipe"] },
			);
			execFileSync("tar", ["-xf", ".snapshot.tar"], {
				cwd: workspace,
				stdio: ["ignore", "ignore", "pipe"],
			});
			unlinkSync(archive);
		}
		if (projectScope) pruneVerifierWorkspace(workspace, archivedPaths);
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
	} finally {
		if (refCreated) {
			try {
				git(cwd, [
					"update-ref",
					"-d",
					checkpointRef(batch.id),
					batch.checkpoint.snapshot,
				]);
			} catch {
				// A stale protective ref is harmless and can be pruned manually.
			}
		}
	}
}

function cleanupVerifierBatchRuntime(cwd, batchId) {
	let store;
	try {
		store = loadVerifierStore(cwd);
	} catch {
		return false;
	}
	const jobs = Object.values(store.jobs).filter(
		(job) => job.batchId === batchId,
	);
	if (
		!jobs.length ||
		jobs.some((job) => ["queued", "running"].includes(job.status))
	)
		return false;
	const temporaryRoot = path.resolve(os.tmpdir());
	for (const workspace of new Set(
		jobs.map((job) => job.launch?.request?.cwd).filter(nonempty),
	)) {
		const resolved = path.resolve(workspace);
		const sameRoot =
			process.platform === "win32"
				? path.dirname(resolved).toLowerCase() === temporaryRoot.toLowerCase()
				: path.dirname(resolved) === temporaryRoot;
		if (
			!sameRoot ||
			!path.basename(resolved).startsWith("ce-verifier-workspace-")
		)
			continue;
		try {
			const marker = JSON.parse(
				readFileSync(
					path.join(resolved, ".ce-verifier-workspace.json"),
					"utf8",
				),
			);
			if (
				marker.version === 1 &&
				same(marker.paths, store.batches[batchId].checkpoint.paths)
			)
				rmSync(resolved, { recursive: true, force: true });
		} catch {
			// Never remove an unmarked temp directory.
		}
	}
	try {
		git(cwd, [
			"update-ref",
			"-d",
			checkpointRef(batchId),
			store.batches[batchId].checkpoint.snapshot,
		]);
	} catch {
		// The ref normally disappears immediately after archive creation.
	}
	return true;
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
	const jobs = Object.values(store.jobs).filter(
		(item) => item.launch?.status === "queued",
	);
	const replies = await Promise.all(
		jobs.map(async (job) => {
			try {
				return await adapter.spawn(structuredClone(job.launch.request));
			} catch (cause) {
				return { ok: false, ambiguous: true, failure: cause.message };
			}
		}),
	);
	for (const [index, job] of jobs.entries()) {
		const reply = replies[index];
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
	}
	for (const batchId of new Set(jobs.map((job) => job.batchId)))
		cleanupVerifierBatchRuntime(cwd, batchId);
	return jobs.map((job) => job.id);
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
		checkpoint = input.checkpoint
			? validateCheckpoint(input.checkpoint, "verifier checkpoint", "invalid")
			: captureVerifierCheckpoint(cwd, input);
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
	let workspace;
	try {
		workspace = ensureVerifierWorkspace(cwd, provisional);
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
		if (workspace) rmSync(workspace, { recursive: true, force: true });
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
		const artifact = input.artifact;
		if (
			artifact !== undefined &&
			(!plainObject(artifact) ||
				!nonempty(artifact.path) ||
				!Number.isInteger(artifact.bytes) ||
				artifact.bytes < 0)
		)
			throw error("invalid", "Invalid verifier report artifact");
		const comparable = {
			outcome: input.outcome,
			usage: input.usage,
			failure: input.failure,
			artifact,
		};
		if (existing) {
			if (
				!same(
					{
						outcome: existing.outcome,
						usage: existing.usage,
						failure: existing.failure,
						artifact: existing.artifact,
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
			...(artifact === undefined
				? {}
				: { artifact: structuredClone(artifact) }),
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
			!REPORT_CATEGORIES.test(input.category) ||
			!SEVERITIES.has(input.severity) ||
			!Number.isInteger(input.startLine) ||
			!Number.isInteger(input.endLine) ||
			input.startLine < 1 ||
			input.endLine < input.startLine ||
			![input.rationale, input.evidence, input.suggestedAction].every(
				(value) => nonempty(value) && value.length <= REPORT_MAX_TEXT,
			)
		)
			throw error("invalid", "Finding is missing required attribution");
		if (!next.batches[report.batchId].checkpoint.paths.includes(input.path))
			throw error("invalid", "Finding path is outside the reviewed checkpoint");
		const identity = {
			reportId: report.id,
			path: input.path,
			startLine: input.startLine,
			endLine: input.endLine,
			category: input.category,
			severity: input.severity,
			rationale: input.rationale,
			evidence: input.evidence,
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
const TRIAGE_LEASE_MS = 30 * 60 * 1000;
function leaseExpiry(input) {
	const timestamp = now(input.now);
	const leaseUntil =
		input.leaseUntil ??
		new Date(Date.parse(timestamp) + TRIAGE_LEASE_MS).toISOString();
	if (!nonempty(leaseUntil) || Number.isNaN(Date.parse(leaseUntil)))
		throw error("invalid", "Claim needs a valid lease expiry");
	return leaseUntil;
}
function groupClaim(next, group) {
	return group.claimId ? next.claims[group.claimId] : undefined;
}
function remainingFindings(next, group) {
	return group.findingIds.filter((id) => !next.findings[id].dispositionId);
}
function updateGroupTriage(next, group) {
	const members = group.findingIds.map((id) => next.findings[id]);
	if (members.some((finding) => !finding.dispositionId)) return;
	if (
		members.some(
			(finding) =>
				next.dispositions[finding.dispositionId].disposition === "accepted" &&
				!finding.fixId,
		)
	)
		return;
	group.status = "triaged";
}
function claimGroupIn(next, input = {}) {
	const group = next.groups[input.groupId];
	if (!group)
		throw error("missing", `Verifier group is missing: ${input.groupId}`);
	if (group.status === "triaged")
		throw error(
			"terminal",
			`Verifier group is already triaged: ${input.groupId}`,
		);
	if (!nonempty(input.ownerSession))
		throw error("invalid", "Claim needs owner session");
	const timestamp = now(input.now);
	const leaseUntil = leaseExpiry(input);
	const existing = groupClaim(next, group);
	if (
		existing &&
		Date.parse(existing.leaseUntil) > Date.parse(timestamp) &&
		existing.ownerSession !== input.ownerSession
	)
		throw error(
			"locked",
			`Verifier group is already claimed: ${input.groupId}`,
		);
	if (existing) {
		existing.ownerSession = input.ownerSession;
		existing.leaseUntil = leaseUntil;
		existing.updatedAt = timestamp;
		if (input.resumeTarget) existing.resumeTarget = input.resumeTarget;
		group.status = "claimed";
		return existing;
	}
	const id = stableId("claim", { groupId: input.groupId });
	const claim = {
		id,
		groupId: input.groupId,
		ownerSession: input.ownerSession,
		leaseUntil,
		createdAt: timestamp,
		...(input.resumeTarget ? { resumeTarget: input.resumeTarget } : {}),
	};
	next.claims[id] = claim;
	group.claimId = id;
	group.status = "claimed";
	return claim;
}
export function claimGroup(store, input = {}) {
	return edit(store, (next) => claimGroupIn(next, input));
}
export function claimCompletedGroups(store, input = {}) {
	return edit(store, (next) =>
		Object.values(next.groups)
			.filter(
				(group) => group.status === "completed" || group.status === "claimed",
			)
			.filter(
				(group) =>
					remainingFindings(next, group).length > 0 ||
					group.status === "claimed",
			)
			.sort((left, right) => left.id.localeCompare(right.id))
			.map((group) => claimGroupIn(next, { ...input, groupId: group.id })),
	);
}
function ownedClaim(next, input) {
	const claim = next.claims[input.claimId];
	if (!claim || claim.ownerSession !== input.ownerSession)
		throw error("locked", "Verifier claim is not owned by this session");
	if (Date.parse(claim.leaseUntil) <= Date.parse(now(input.now)))
		throw error("locked", "Verifier claim lease expired");
	return claim;
}
function renewClaim(claim, input) {
	claim.leaseUntil = leaseExpiry(input);
	claim.updatedAt = now(input.now);
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
			...(input.claimId ? { claimId: input.claimId } : {}),
		};
		next.dispositions[id] = disposition;
		finding.dispositionId = id;
		return disposition;
	});
}
export function recordTriageDisposition(store, input = {}) {
	return edit(store, (next) => {
		const claim = ownedClaim(next, input);
		const group = next.groups[claim.groupId];
		if (!group.findingIds.includes(input.findingId))
			throw error("invalid", "Finding is outside this verifier claim");
		if (input.changedTarget && !nonempty(input.currentCodeEvidence))
			throw error("invalid", "Changed finding requires current-code evidence");
		const finding = next.findings[input.findingId];
		if (finding.dispositionId)
			throw error("conflict", `Finding is already triaged: ${finding.id}`);
		if (!DISPOSITIONS.has(input.disposition) || !nonempty(input.reason))
			throw error("invalid", "Invalid verifier disposition");
		const attempt = group.reopenCount ?? 0;
		const id = stableId(
			"disposition",
			attempt ? { findingId: finding.id, attempt } : { findingId: finding.id },
		);
		const disposition = {
			id,
			findingId: finding.id,
			disposition: input.disposition,
			reason: input.reason,
			createdAt: now(input.now),
			claimId: claim.id,
			...(attempt ? { attempt } : {}),
			...(input.currentCodeEvidence
				? { currentCodeEvidence: input.currentCodeEvidence }
				: {}),
		};
		next.dispositions[id] = disposition;
		finding.dispositionId = id;
		renewClaim(claim, input);
		updateGroupTriage(next, group);
		return disposition;
	});
}
export function completeAcceptedFix(store, input = {}) {
	return edit(store, (next) => {
		const claim = ownedClaim(next, input);
		const group = next.groups[claim.groupId];
		const findingIds = [...new Set(input.findingIds ?? [])].sort();
		if (
			!findingIds.length ||
			findingIds.some((id) => !group.findingIds.includes(id))
		)
			throw error("invalid", "Fix must name accepted members of this claim");
		if (
			!nonempty(input.commit) ||
			!/^[0-9a-f]{7,64}$/i.test(input.commit) ||
			!Array.isArray(input.verification) ||
			!input.verification.length ||
			input.verification.some((entry) => !nonempty(entry))
		)
			throw error("invalid", "Fix needs commit and verification evidence");
		if (
			findingIds.some(
				(id) =>
					next.dispositions[next.findings[id].dispositionId]?.disposition !==
						"accepted" || next.findings[id].fixId,
			)
		)
			throw error(
				"invalid",
				"Fix members must be unresolved accepted findings",
			);
		const id = stableId("fix", {
			claimId: claim.id,
			findingIds,
			commit: input.commit,
			verification: input.verification,
		});
		const fix = next.fixes[id] ?? {
			id,
			claimId: claim.id,
			findingIds,
			commit: input.commit,
			verification: [...input.verification],
			createdAt: now(input.now),
		};
		next.fixes[id] = fix;
		for (const findingId of findingIds) next.findings[findingId].fixId = id;
		renewClaim(claim, input);
		updateGroupTriage(next, group);
		return fix;
	});
}
export function reopenGroup(store, input = {}) {
	return edit(store, (next) => {
		const group = next.groups[input.groupId];
		if (!group || group.status !== "triaged")
			throw error("invalid", "Only triaged verifier groups can reopen");
		for (const findingId of group.findingIds) {
			delete next.findings[findingId].dispositionId;
			delete next.findings[findingId].fixId;
		}
		delete group.claimId;
		group.status = "completed";
		group.reopenCount = (group.reopenCount ?? 0) + 1;
		group.reopenedAt = now(input.now);
		return group;
	});
}

function boundedArtifactRead(file, maxBytes = REPORT_MAX_BYTES) {
	let fd;
	try {
		if (!file || lstatSync(file).isSymbolicLink())
			throw error("artifact", "Verifier artifact is unavailable");
		fd = openSync(file, "r");
		const size = fstatSync(fd).size;
		if (!Number.isSafeInteger(size) || size > maxBytes)
			throw error("over-limit", "Verifier artifact exceeds the size limit", {
				bytes: Number.isSafeInteger(size) ? size : undefined,
			});
		const bytes = Buffer.allocUnsafe(size);
		const read = readSync(fd, bytes, 0, size, 0);
		if (read !== size)
			throw error("artifact", "Verifier artifact changed during bounded read");
		return { bytes: size, text: bytes.toString("utf8") };
	} catch (cause) {
		if (cause instanceof VerifierStoreError) throw cause;
		throw error("artifact", "Verifier artifact is unavailable");
	} finally {
		if (fd !== undefined) closeSync(fd);
	}
}
function jsonDepth(value) {
	let max = 0;
	const pending = [[value, 1]];
	while (pending.length) {
		const [current, depth] = pending.pop();
		max = Math.max(max, depth);
		if (max > REPORT_MAX_DEPTH) return max;
		if (Array.isArray(current))
			for (const entry of current) pending.push([entry, depth + 1]);
		else if (plainObject(current))
			for (const entry of Object.values(current))
				pending.push([entry, depth + 1]);
	}
	return max;
}
function exactKeys(value, required, optional = []) {
	if (!plainObject(value)) return false;
	const keys = Object.keys(value);
	return (
		required.every((key) => Object.hasOwn(value, key)) &&
		keys.every((key) => [...required, ...optional].includes(key))
	);
}
function validUsage(value) {
	return (
		value === undefined ||
		(plainObject(value) &&
			Object.values(value).every(
				(item) =>
					typeof item === "number" && Number.isFinite(item) && item >= 0,
			))
	);
}
function artifactForJob(cwd, job) {
	const file = job.launch?.request?.output;
	const root = path.resolve(verifierRuntimeRoot(cwd));
	if (!nonempty(file) || !path.resolve(file).startsWith(`${root}${path.sep}`))
		throw error(
			"artifact",
			"Verifier output is not a private runtime artifact",
		);
	return file;
}
function validateFindingRange(job, batch, finding) {
	if (!batch.checkpoint.paths.includes(finding.path))
		throw error("invalid", "Verifier finding path is outside the checkpoint");
	if (
		!Number.isInteger(finding.startLine) ||
		!Number.isInteger(finding.endLine) ||
		finding.startLine < 1 ||
		finding.endLine < finding.startLine
	)
		return;
	const workspace = job.launch?.request?.cwd;
	if (!nonempty(workspace)) return;
	const relative = relativePath(finding.path);
	let lineCount;
	try {
		lineCount = readFileSync(path.join(workspace, relative), "utf8").split(
			/\r\n|[\n\r]/,
		).length;
	} catch {
		throw error("invalid", "Verifier finding source path is unavailable");
	}
	if (finding.endLine > lineCount)
		throw error("invalid", "Verifier finding range exceeds its source file");
}

function validateResult(job, batch, result) {
	const required = ["jobId", "model", "checkpoint", "operation", "outcome"];
	if (!exactKeys(result, required, ["findings", "usage", "failure"]))
		throw error("invalid", "Verifier result has an invalid schema");
	if (
		result.jobId !== job.id ||
		result.model !== job.model ||
		!same(result.checkpoint, batch.checkpoint) ||
		!job.operations.includes(result.operation) ||
		!OUTCOMES.has(result.outcome) ||
		!validUsage(result.usage)
	)
		throw error("invalid", "Verifier result identity is invalid");
	if (result.outcome === "failed") {
		if (!nonempty(result.failure) || result.failure.length > REPORT_MAX_TEXT)
			throw error("invalid", "Verifier failure is invalid");
		return {
			operation: result.operation,
			outcome: "failed",
			usage: result.usage,
		};
	}
	if (result.outcome === "no-findings") {
		if (result.findings !== undefined || result.failure !== undefined)
			throw error("invalid", "No-findings result has unexpected content");
		return {
			operation: result.operation,
			outcome: "no-findings",
			usage: result.usage,
		};
	}
	if (!Array.isArray(result.findings) || !result.findings.length)
		throw error("invalid", "Findings result has no findings");
	const findings = result.findings.map((finding) => {
		if (
			!exactKeys(finding, [
				"path",
				"startLine",
				"endLine",
				"category",
				"severity",
				"rationale",
				"evidence",
				"suggestion",
			])
		)
			throw error("invalid", "Verifier finding has an invalid schema");
		validateFindingRange(job, batch, finding);
		return {
			path: finding.path,
			startLine: finding.startLine,
			endLine: finding.endLine,
			category: finding.category,
			severity: finding.severity,
			rationale: finding.rationale,
			evidence: finding.evidence,
			suggestedAction: finding.suggestion,
		};
	});
	if (findings.length > REPORT_MAX_FINDINGS)
		throw error("over-limit", "Verifier report has too many findings");
	return {
		operation: result.operation,
		outcome: "findings",
		usage: result.usage,
		findings,
	};
}
function validateTerminalReport(job, batch, text) {
	let report;
	try {
		report = JSON.parse(text);
	} catch {
		throw error("invalid", "Verifier report is not valid JSON");
	}
	if (jsonDepth(report) > REPORT_MAX_DEPTH)
		throw error("over-limit", "Verifier report exceeds the nesting limit");
	if (
		!exactKeys(report, [
			"version",
			"jobId",
			"model",
			"checkpoint",
			"results",
		]) ||
		report.version !== 1 ||
		report.jobId !== job.id ||
		report.model !== job.model ||
		!same(report.checkpoint, batch.checkpoint) ||
		!Array.isArray(report.results)
	)
		throw error("invalid", "Verifier report identity is invalid");
	if (report.results.length > job.operations.length)
		throw error("invalid", "Verifier report has unexpected operations");
	const results = report.results.map((result) =>
		validateResult(job, batch, result),
	);
	const operations = new Set(results.map((result) => result.operation));
	if (operations.size !== results.length)
		throw error("invalid", "Verifier report duplicates an operation");
	if (
		results.reduce((sum, result) => sum + (result.findings?.length ?? 0), 0) >
		REPORT_MAX_FINDINGS
	)
		throw error("over-limit", "Verifier report has too many findings");
	return {
		results,
		omitted: job.operations.filter((operation) => !operations.has(operation)),
	};
}
function quarantineVerifierReport(store, input = {}) {
	return edit(store, (next) => {
		const job = next.jobs[input.jobId];
		if (!job) throw error("missing", `Verifier job is missing: ${input.jobId}`);
		const id = stableId("quarantine", {
			jobId: job.id,
			artifact: input.artifact,
			reason: input.reason,
		});
		return (next.quarantines[id] ??= {
			id,
			jobId: job.id,
			artifact: structuredClone(input.artifact),
			reason: input.reason,
			createdAt: now(input.now),
		});
	});
}
function recordTerminalFailures(store, jobId, operations, artifact, nowValue) {
	for (const operation of operations)
		recordOperationResult(store, {
			jobId,
			operation,
			outcome: "failed",
			failure: "Verifier terminal output was unavailable or invalid",
			artifact,
			now: nowValue,
		});
}
export function ingestVerifierReport(store, input = {}) {
	const job = store.jobs?.[input.jobId];
	if (!job) throw error("missing", `Verifier job is missing: ${input.jobId}`);
	const batch = store.batches[job.batchId];
	const artifact = input.artifact;
	let validated;
	try {
		validated = validateTerminalReport(job, batch, input.text);
	} catch (cause) {
		const reason =
			cause instanceof VerifierStoreError ? cause.category : "invalid";
		quarantineVerifierReport(store, {
			jobId: job.id,
			artifact,
			reason,
			now: input.now,
		});
		recordTerminalFailures(
			store,
			job.id,
			job.operations.filter(
				(operation) => job.operationStatus[operation] === "pending",
			),
			artifact,
			input.now,
		);
		return { quarantined: true, reason };
	}
	for (const result of validated.results) {
		const report = recordOperationResult(store, {
			jobId: job.id,
			operation: result.operation,
			outcome: result.outcome,
			...(result.usage === undefined ? {} : { usage: result.usage }),
			...(result.outcome === "failed"
				? { failure: "Verifier reported an operation failure" }
				: {}),
			artifact,
			now: input.now,
		});
		for (const finding of result.findings ?? [])
			addFinding(store, {
				reportId: report.id,
				operation: result.operation,
				model: job.model,
				checkpoint: batch.checkpoint,
				...finding,
				now: input.now,
			});
	}
	recordTerminalFailures(store, job.id, validated.omitted, artifact, input.now);
	groupValidatedFindings(store, { now: input.now });
	return { quarantined: false, omitted: validated.omitted };
}
function rangesOverlap(left, right) {
	return left.startLine <= right.endLine && right.startLine <= left.endLine;
}
export function groupValidatedFindings(store, input = {}) {
	return edit(store, (next) => {
		for (const [id, group] of Object.entries(next.groups))
			if (
				group.generated &&
				!Object.values(next.claims).some((claim) => claim.groupId === id)
			)
				delete next.groups[id];
		const buckets = new Map();
		for (const finding of Object.values(next.findings)) {
			const key = `${finding.path}\u001f${finding.category}`;
			(buckets.get(key) ?? buckets.set(key, []).get(key)).push(finding);
		}
		const groups = [];
		for (const findings of buckets.values()) {
			const pending = [...findings].sort(
				(a, b) =>
					a.startLine - b.startLine ||
					a.endLine - b.endLine ||
					a.id.localeCompare(b.id),
			);
			while (pending.length) {
				const component = [pending.shift()];
				for (let index = 0; index < pending.length; ) {
					if (component.some((member) => rangesOverlap(member, pending[index])))
						component.push(pending.splice(index, 1)[0]);
					else index += 1;
				}
				const findingIds = component.map((finding) => finding.id).sort();
				const id = stableId("group", { findingIds });
				next.groups[id] = next.groups[id] ?? {
					id,
					findingIds,
					status: "completed",
					generated: true,
					createdAt: now(input.now),
				};
				groups.push(next.groups[id]);
			}
		}
		return groups.sort((left, right) => left.id.localeCompare(right.id));
	});
}
function terminalState(status) {
	return String(status?.state ?? status?.status ?? "").toLowerCase();
}
function markVerifierOrphaned(store, jobId, nowValue) {
	return edit(store, (next) => {
		const job = next.jobs[jobId];
		if (!job || job.launch?.status !== "running") return job;
		job.launch = {
			...job.launch,
			status: "orphaned",
			orphanedAt: now(nowValue),
		};
		job.status = "orphaned";
		return job;
	});
}
export function reconcileVerifierRuns(cwd = process.cwd(), input = {}) {
	let store;
	try {
		store = loadVerifierStore(cwd);
	} catch {
		return [];
	}
	const reconciled = [];
	for (const job of Object.values(store.jobs).filter(
		(item) => item.launch?.status === "running",
	)) {
		const statusFile = job.launch.asyncDir
			? path.join(job.launch.asyncDir, "status.json")
			: "";
		let status;
		try {
			status = JSON.parse(boundedArtifactRead(statusFile).text);
		} catch {
			mutateVerifierStore(
				cwd,
				(state) => markVerifierOrphaned(state, job.id, input.now),
				input,
			);
			cleanupVerifierBatchRuntime(cwd, job.batchId);
			reconciled.push(job.id);
			continue;
		}
		const state = terminalState(status);
		if (
			!TERMINAL_SUCCESS_STATES.has(state) &&
			!TERMINAL_FAILURE_STATES.has(state)
		)
			continue;
		let artifact;
		try {
			const file = artifactForJob(cwd, job);
			artifact = { path: file, bytes: lstatSync(file).size };
			const raw = boundedArtifactRead(file);
			artifact.bytes = raw.bytes;
			try {
				chmodSync(file, 0o600);
			} catch {
				// Windows ACLs, when present, remain authoritative.
			}
			artifact = { path: file, bytes: raw.bytes };
			mutateVerifierStore(
				cwd,
				(next) => {
					if (TERMINAL_FAILURE_STATES.has(state)) {
						recordTerminalFailures(
							next,
							job.id,
							job.operations.filter(
								(operation) =>
									next.jobs[job.id].operationStatus[operation] === "pending",
							),
							artifact,
							input.now,
						);
						return { failed: true };
					}
					return ingestVerifierReport(next, {
						jobId: job.id,
						artifact,
						text: raw.text,
						now: input.now,
					});
				},
				input,
			);
		} catch (cause) {
			const reason =
				cause instanceof VerifierStoreError ? cause.category : "artifact";
			mutateVerifierStore(
				cwd,
				(next) => {
					quarantineVerifierReport(next, {
						jobId: job.id,
						artifact: artifact ?? { path: "private", bytes: 0 },
						reason,
						now: input.now,
					});
					recordTerminalFailures(
						next,
						job.id,
						job.operations.filter(
							(operation) =>
								next.jobs[job.id].operationStatus[operation] === "pending",
						),
						artifact,
						input.now,
					);
				},
				input,
			);
		}
		cleanupVerifierBatchRuntime(cwd, job.batchId);
		reconciled.push(job.id);
	}
	return reconciled;
}
export function verifierStatus(store, configured = undefined) {
	if (!store) return configured?.length ? "queued/running" : "not-configured";
	validateVerifierStore(store);
	const jobs = Object.values(store.jobs);
	if (!jobs.length)
		return configured?.length ? "queued/running" : "not-configured";
	if (
		jobs.some((job) =>
			["failed", "orphaned", "partially-failed"].includes(job.status),
		)
	)
		return "failed/orphaned";
	if (jobs.some((job) => ["queued", "running"].includes(job.status)))
		return "queued/running";
	if (Object.values(store.findings).some((finding) => !finding.dispositionId))
		return "completed-awaiting-triage";
	return "fully-triaged";
}
function quoted(value, limit = 500) {
	return JSON.stringify(String(value).slice(0, limit));
}
export function renderVerifierFinding(finding) {
	return [
		`path (untrusted): ${quoted(finding.path, 500)}`,
		`range: ${finding.startLine}-${finding.endLine}`,
		`category (untrusted): ${quoted(finding.category, 100)}`,
		`severity: ${quoted(finding.severity, 40)}`,
		`rationale (untrusted): ${quoted(finding.rationale)}`,
		`evidence (untrusted): ${quoted(finding.evidence)}`,
		`suggestion (untrusted): ${quoted(finding.suggestedAction)}`,
	].join("\n");
}
export function renderTriageClaim(store, claimId) {
	validateVerifierStore(store);
	const claim = store.claims[claimId];
	if (!claim) throw error("missing", `Verifier claim is missing: ${claimId}`);
	const group = store.groups[claim.groupId];
	return {
		claim: {
			id: claim.id,
			groupId: group.id,
			leaseUntil: claim.leaseUntil,
			resumeTarget: claim.resumeTarget,
		},
		findings: group.findingIds
			.filter((id) => {
				const finding = store.findings[id];
				return (
					!finding.dispositionId ||
					(store.dispositions[finding.dispositionId]?.disposition ===
						"accepted" &&
						!finding.fixId)
				);
			})
			.map((id) => {
				const finding = store.findings[id];
				return {
					id: finding.id,
					model: finding.model,
					operation: finding.operation,
					checkpoint: finding.checkpoint.snapshot,
					disposition: store.dispositions[finding.dispositionId]?.disposition,
					rendered: renderVerifierFinding(finding),
				};
			}),
	};
}
export function verifierTelemetryEvents(store) {
	validateVerifierStore(store);
	const findingsByReport = new Map();
	for (const finding of Object.values(store.findings)) {
		const findings = findingsByReport.get(finding.reportId) ?? [];
		findings.push(finding);
		findingsByReport.set(finding.reportId, findings);
	}
	const groupsByFinding = new Map();
	for (const group of Object.values(store.groups)) {
		for (const findingId of group.findingIds) {
			const groups = groupsByFinding.get(findingId) ?? new Set();
			groups.add(group.id);
			groupsByFinding.set(findingId, groups);
		}
	}
	return Object.values(store.jobs)
		.sort((left, right) => left.id.localeCompare(right.id))
		.flatMap((job) =>
			job.operations.map((operation) => {
				const report =
					store.reports[stableId("report", { jobId: job.id, operation })];
				const findings = findingsByReport.get(report?.id) ?? [];
				const groupIds = new Set();
				for (const finding of findings)
					for (const groupId of groupsByFinding.get(finding.id) ?? [])
						groupIds.add(groupId);
				const dispositions = findings
					.map(
						(finding) => store.dispositions[finding.dispositionId]?.disposition,
					)
					.filter(Boolean);
				const started = Date.parse(
					job.launch?.launchedAt ?? job.createdAt ?? "",
				);
				const ended = Date.parse(
					report?.createdAt ??
						job.launch?.failedAt ??
						job.launch?.orphanedAt ??
						"",
				);
				return {
					id: `verifier-${job.id}-${operation}-${job.operationStatus[operation]}`,
					type: "background-verifier",
					batchId: job.batchId,
					jobId: job.id,
					model: job.model,
					operation,
					status: job.operationStatus[operation],
					jobStatus: job.status,
					durationMs:
						Number.isFinite(started) && Number.isFinite(ended)
							? Math.max(0, ended - started)
							: undefined,
					...(report?.usage === undefined ? {} : { usage: report.usage }),
					findingCount: findings.length,
					groupCount: groupIds.size,
					...(dispositions.length ? { dispositions } : {}),
				};
			}),
		);
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
		"quarantines",
		"findings",
		"groups",
		"claims",
		"dispositions",
		"fixes",
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
		if (
			report.artifact !== undefined &&
			(!plainObject(report.artifact) ||
				!nonempty(report.artifact.path) ||
				!Number.isInteger(report.artifact.bytes) ||
				report.artifact.bytes < 0)
		)
			throw error("corrupt", `Invalid report artifact ${id} in ${file}`);
	}
	for (const [id, quarantine] of Object.entries(store.quarantines)) {
		if (
			!plainObject(quarantine) ||
			quarantine.id !== id ||
			!store.jobs[quarantine.jobId] ||
			!plainObject(quarantine.artifact) ||
			!nonempty(quarantine.artifact.path) ||
			!Number.isInteger(quarantine.artifact.bytes) ||
			quarantine.artifact.bytes < 0 ||
			!nonempty(quarantine.reason) ||
			id !==
				stableId("quarantine", {
					jobId: quarantine.jobId,
					artifact: quarantine.artifact,
					reason: quarantine.reason,
				})
		)
			throw error("corrupt", `Invalid quarantine ${id} in ${file}`);
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
			startLine: finding?.startLine,
			endLine: finding?.endLine,
			category: finding?.category,
			severity: finding?.severity,
			rationale: finding?.rationale,
			evidence: finding?.evidence,
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
			!REPORT_CATEGORIES.test(finding.category) ||
			!SEVERITIES.has(finding.severity) ||
			!Number.isInteger(finding.startLine) ||
			!Number.isInteger(finding.endLine) ||
			finding.startLine < 1 ||
			finding.endLine < finding.startLine ||
			![finding.rationale, finding.evidence, finding.suggestedAction].every(
				(value) => nonempty(value) && value.length <= REPORT_MAX_TEXT,
			) ||
			!store.batches[report.batchId].checkpoint.paths.includes(finding.path)
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
			!["completed", "claimed", "triaged"].includes(group.status) ||
			(group.generated !== undefined && typeof group.generated !== "boolean") ||
			!Array.isArray(group.findingIds) ||
			group.findingIds.length === 0 ||
			!same(group.findingIds, [...group.findingIds].sort()) ||
			new Set(group.findingIds).size !== group.findingIds.length ||
			group.findingIds.some((findingId) => !store.findings[findingId]) ||
			(group.claimId !== undefined && !store.claims[group.claimId]) ||
			(group.status === "claimed" && !store.claims[group.claimId]) ||
			(group.status === "triaged" &&
				group.findingIds.some((findingId) => {
					const finding = store.findings[findingId];
					return (
						!finding.dispositionId ||
						(store.dispositions[finding.dispositionId]?.disposition ===
							"accepted" &&
							!finding.fixId)
					);
				})) ||
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
			(store.groups[claim.groupId].claimId !== id &&
				store.groups[claim.groupId].status !== "completed") ||
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
				stableId(
					"disposition",
					disposition.attempt
						? { findingId: disposition.findingId, attempt: disposition.attempt }
						: { findingId: disposition.findingId },
				) ||
			(store.findings[disposition.findingId].dispositionId !== id &&
				!Object.values(store.groups).some(
					(group) =>
						(group.status === "completed" || group.reopenCount) &&
						group.findingIds.includes(disposition.findingId),
				))
		)
			throw error("corrupt", `Invalid disposition ${id} in ${file}`);
	}
	for (const [id, fix] of Object.entries(store.fixes)) {
		if (
			!plainObject(fix) ||
			fix.id !== id ||
			!store.claims[fix.claimId] ||
			!Array.isArray(fix.findingIds) ||
			!fix.findingIds.length ||
			fix.findingIds.some(
				(findingId) =>
					store.findings[findingId]?.fixId !== id &&
					!Object.values(store.groups).some(
						(group) =>
							(group.status === "completed" || group.reopenCount) &&
							group.findingIds.includes(findingId),
					),
			) ||
			!nonempty(fix.commit) ||
			!/^[0-9a-f]{7,64}$/i.test(fix.commit) ||
			!Array.isArray(fix.verification) ||
			!fix.verification.length ||
			fix.verification.some((entry) => !nonempty(entry)) ||
			id !==
				stableId("fix", {
					claimId: fix.claimId,
					findingIds: fix.findingIds,
					commit: fix.commit,
					verification: fix.verification,
				})
		)
			throw error("corrupt", `Invalid verifier fix ${id} in ${file}`);
	}
	return store;
}
