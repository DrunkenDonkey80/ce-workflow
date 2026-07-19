import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
	chmodSync,
	closeSync,
	constants as fsConstants,
	existsSync,
	fstatSync,
	lstatSync,
	mkdirSync,
	openSync,
	readFileSync,
	readSync,
	readdirSync,
	realpathSync,
	renameSync,
	rmSync,
	writeSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";
import { createWorkItem, initStore, mutateStore, storePath } from "./work-store.js";

const PACKAGE_NAME = "pi-work-orchestrator";
const REPORT_ROOT = [".pi", "self-improvement-reports"];
const MAX_FILES = 16;
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_BYTES = 16 * 1024 * 1024;
const GRACE_MS = 24 * 60 * 60 * 1000;
const ACTIVE_EPIC_STATUSES = new Set(["open", "in_progress", "planned", "blocked"]);

export class ImprovementReportingError extends Error {
	constructor(message, code = "report-failed") {
		super(message);
		this.name = "ImprovementReportingError";
		this.code = code;
	}
}

function fail(message, code) {
	throw new ImprovementReportingError(message, code);
}

function bounded(value, limit) {
	return String(value ?? "")
		.replace(/[\x00-\x1f\x7f]/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, limit);
}

function safeLabel(value) {
	return (
		bounded(value, 80).replace(/[\\/]/g, "-").replace(/[A-Za-z]:/g, "") ||
		"producer"
	);
}

function contained(root, candidate) {
	const rel = path.relative(root, candidate);
	return rel === "" || (!rel.startsWith(`..${path.sep}`) && rel !== "..");
}

function samePath(left, right) {
	return process.platform === "win32"
		? left.toLowerCase() === right.toLowerCase()
		: left === right;
}

function ensureSafeDirectoryPath(sourceCwd, directory) {
	if (!contained(sourceCwd, directory))
		fail("self-improvement report destination escapes the source checkout", "unsafe-destination");
	let current = sourceCwd;
	for (const part of path.relative(sourceCwd, directory).split(path.sep).filter(Boolean)) {
		current = path.join(current, part);
		if (!existsSync(current)) continue;
		const stat = lstatSync(current);
		if (!stat.isDirectory() || stat.isSymbolicLink() || !samePath(realpathSync(current), current))
			fail("self-improvement report destination must not contain symlinks", "unsafe-destination");
	}
}

function sourceChoice(options) {
	const configured = options.settings?.workImprovement?.sourceCheckout;
	if (configured && String(configured).trim()) return ["setting", String(configured)];
	const environment = options.env?.CE_WORKFLOW_SOURCE_DIR ?? process.env.CE_WORKFLOW_SOURCE_DIR;
	return environment ? ["environment", environment] : ["package", options.packageRoot];
}

/** Resolve package identity only; reporting deliberately skips delivery preflight. */
export function resolveReportingSource(options = {}) {
	const [source, candidate] = sourceChoice(options);
	if (!candidate) fail("ce-workflow source checkout is not configured", "source-unavailable");
	let sourceCwd;
	try {
		sourceCwd = realpathSync(path.resolve(options.cwd ?? process.cwd(), candidate));
	} catch {
		fail(`ce-workflow source checkout is unavailable (${source})`, "source-unavailable");
	}
	try {
		const gitRoot = realpathSync(
			execFileSync("git", ["rev-parse", "--show-toplevel"], {
				cwd: sourceCwd,
				encoding: "utf8",
				stdio: ["ignore", "pipe", "pipe"],
			}).trim(),
		);
		if (gitRoot !== sourceCwd)
			fail("configured source is not the ce-workflow Git root", "source-identity");
		const pkg = JSON.parse(readFileSync(path.join(sourceCwd, "package.json"), "utf8"));
		if (
			pkg.name !== PACKAGE_NAME ||
			!existsSync(path.join(sourceCwd, "extensions", "work-models.js"))
		)
			fail("configured source is not a pi-work-orchestrator checkout", "source-identity");
		return { sourceCwd, source, revision: `package-${pkg.version ?? "unknown"}` };
	} catch (error) {
		if (error instanceof ImprovementReportingError) throw error;
		fail("configured source is not a pi-work-orchestrator checkout", "source-identity");
	}
}

function ensureReportRootIgnored(sourceCwd) {
	try {
		execFileSync("git", ["check-ignore", "-q", "--", ".pi/self-improvement-reports"], {
			cwd: sourceCwd,
			stdio: "ignore",
		});
	} catch {
		fail("self-improvement report destination is not ignored", "unsafe-destination");
	}
	initStore(sourceCwd);
}

function identity(stat) {
	return [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs].join(":");
}

function checkedLog(file, roots, baseCwd) {
	let lexical;
	let canonical;
	try {
		lexical = path.resolve(baseCwd, file);
		canonical = realpathSync(lexical);
	} catch {
		fail("evidence file is missing or unreadable", "unsafe-evidence");
	}
	if (!samePath(canonical, lexical))
		fail("evidence path must not contain symlinks", "unsafe-evidence");
	if (!roots.some((root) => contained(root, canonical)))
		fail("evidence path is outside an approved evidence root", "unsafe-evidence");
	let listed;
	try {
		listed = lstatSync(canonical);
	} catch {
		fail("evidence file is missing or unreadable", "unsafe-evidence");
	}
	if (!listed.isFile() || listed.isSymbolicLink())
		fail("evidence must be a regular non-symlink file", "unsafe-evidence");
	let fd;
	let accepted = false;
	try {
		fd = openSync(canonical, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
		const before = fstatSync(fd);
		if (!before.isFile() || identity(before) !== identity(listed))
			fail("evidence file changed before it could be opened", "unsafe-evidence");
		if (before.size > MAX_FILE_BYTES)
			fail("evidence file exceeds the reporting limit", "evidence-too-large");
		accepted = true;
		return { file: canonical, fd, before, beforeIdentity: identity(before) };
	} catch (error) {
		if (error instanceof ImprovementReportingError) throw error;
		fail("evidence file cannot be opened safely", "unsafe-evidence");
	} finally {
		if (fd !== undefined && !accepted) closeSync(fd);
	}
}

function closeInputs(inputs) {
	for (const input of inputs) {
		try {
			if (input.fd !== undefined) closeSync(input.fd);
		} catch {
			// A copied input has already been closed.
		}
	}
}

function copyStable(input, destination) {
	const hash = createHash("sha256");
	const buffer = Buffer.allocUnsafe(64 * 1024);
	let destinationFd;
	let offset = 0;
	try {
		destinationFd = openSync(destination, "wx", 0o600);
		while (true) {
			const count = readSync(input.fd, buffer, 0, buffer.length, null);
			if (!count) break;
			hash.update(buffer.subarray(0, count));
			writeSync(destinationFd, buffer, 0, count);
			offset += count;
		}
		const after = fstatSync(input.fd);
		if (identity(after) !== input.beforeIdentity || offset !== input.before.size)
			fail("evidence changed while being copied", "unstable-evidence");
		return { bytes: offset, sha256: hash.digest("hex") };
	} finally {
		try {
			if (destinationFd !== undefined) closeSync(destinationFd);
		} finally {
			const inputFd = input.fd;
			input.fd = undefined;
			if (inputFd !== undefined) closeSync(inputFd);
		}
	}
}

function setOwnerOnly(file, mode) {
	try {
		chmodSync(file, mode);
	} catch {
		// Windows and some mounted filesystems do not expose POSIX ownership modes.
	}
}

function reportFields(report) {
	const observation = bounded(report?.observation, 600);
	const expectedBehavior = bounded(report?.expectedBehavior, 600);
	const impact = bounded(report?.impact, 400);
	const logs = Array.isArray(report?.logs) ? report.logs.map(String) : [];
	if (!observation || !expectedBehavior || !impact || !logs.length)
		fail("observation, expectedBehavior, impact, and at least one log are required", "invalid-report");
	if (logs.length > MAX_FILES) fail("too many evidence files", "evidence-too-large");
	return {
		observation,
		expectedBehavior,
		impact,
		logs,
		suggestedImprovement: bounded(report?.suggestedImprovement, 400),
		producer: safeLabel(report?.producer),
		workflowId: bounded(report?.workflowId ?? report?.sessionId, 120),
	};
}

function runtimeRoot(sourceCwd) {
	return path.join(sourceCwd, ...REPORT_ROOT);
}

function relativeBundle(sourceCwd, bundle) {
	return path.relative(sourceCwd, bundle).replaceAll(path.sep, "/");
}

export function cleanupImprovementReportBundles(sourceCwd, now = Date.now()) {
	const root = runtimeRoot(sourceCwd);
	let items;
	try {
		items = initStore(sourceCwd).items;
	} catch {
		return;
	}
	const referenced = new Map();
	for (const item of Object.values(items)) {
		for (const evidence of item.evidence ?? []) {
			if (evidence?.kind === "self-improvement-report" && typeof evidence.bundle === "string")
				referenced.set(evidence.bundle, item.status);
		}
	}
	let names;
	try {
		names = readdirSync(root);
	} catch {
		return;
	}
	for (const name of names) {
		const bundle = path.join(root, name);
		let stat;
		try {
			stat = lstatSync(bundle);
		} catch {
			continue;
		}
		if (!stat.isDirectory() || stat.isSymbolicLink()) continue;
		const status = referenced.get(relativeBundle(sourceCwd, bundle));
		if (status === "closed" || status === "deferred" || (!status && now - stat.mtimeMs > GRACE_MS)) {
			try {
				rmSync(bundle, { recursive: true, force: true });
			} catch {
				// Retention is best-effort; a locked old bundle must not block a new report.
			}
		}
	}
}

export async function submitImprovementReport(options = {}) {
	const report = reportFields(options.report);
	const consumerCwd = realpathSync(options.cwd ?? process.cwd());
	const resolved = resolveReportingSource({ ...options, cwd: consumerCwd });
	ensureReportRootIgnored(resolved.sourceCwd);
	const roots = [
		consumerCwd,
		path.join(resolved.sourceCwd, ".pi", "work-runs"),
		...(options.approvedRoots ?? []),
	]
		.filter(existsSync)
		.map((root) => realpathSync(root));
	const inputs = [];
	try {
		for (const log of report.logs) inputs.push(checkedLog(log, roots, consumerCwd));
		if (inputs.reduce((sum, input) => sum + input.before.size, 0) > MAX_TOTAL_BYTES)
			fail("evidence bundle exceeds the reporting limit", "evidence-too-large");
	} catch (error) {
		closeInputs(inputs);
		throw error;
	}
	let staging;
	let bundlePath;
	const files = [];
	try {
		try {
			(options._cleanupBundles ?? cleanupImprovementReportBundles)(resolved.sourceCwd);
		} catch {
			// Retention is best-effort; intake must survive cleanup failures.
		}
		const root = runtimeRoot(resolved.sourceCwd);
		ensureSafeDirectoryPath(resolved.sourceCwd, root);
		mkdirSync(root, { recursive: true, mode: 0o700 });
		ensureSafeDirectoryPath(resolved.sourceCwd, root);
		setOwnerOnly(root, 0o700);
		const name = randomUUID();
		staging = path.join(root, `.${name}.tmp`);
		bundlePath = path.join(root, name);
		mkdirSync(staging, { mode: 0o700 });
		setOwnerOnly(staging, 0o700);
		await options._beforeCopy?.(inputs);
		for (const [index, input] of inputs.entries()) {
			const filename = path.basename(input.file).replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80) || "log";
			const target = `${String(index + 1).padStart(2, "0")}-${filename}`;
			files.push({ file: target, source: input.file, ...copyStable(input, path.join(staging, target)) });
		}
		const submittedAt = new Date().toISOString();
		writeFileSync(
			path.join(staging, "manifest.json"),
			`${JSON.stringify({ version: 1, submittedAt, files }, null, 2)}\n`,
			{ mode: 0o600 },
		);
		(options._renameBundle ?? renameSync)(staging, bundlePath);
		if (existsSync(staging) || !existsSync(bundlePath))
			fail("evidence bundle could not be finalized", "incomplete-evidence");
		ensureSafeDirectoryPath(resolved.sourceCwd, bundlePath);
		setOwnerOnly(bundlePath, 0o700);
		const bundle = relativeBundle(resolved.sourceCwd, bundlePath);
		const mutation = () =>
			mutateStore(resolved.sourceCwd, (store) => {
				let epic = Object.values(store.items).find(
					(item) => item.type === "epic" && item.title === "Self-improving" && ACTIVE_EPIC_STATUSES.has(item.status),
				);
				if (!epic)
					epic = createWorkItem(store, {
						type: "epic",
						status: "open",
						title: "Self-improving",
						labels: ["self-improvement"],
					});
				const task = createWorkItem(store, {
					type: "task",
					status: "open",
					parentId: epic.id,
					title: `Self-improvement report: ${report.observation.slice(0, 130)}`,
					description: `Observed: ${report.observation}\nExpected: ${report.expectedBehavior}\nImpact: ${report.impact}${report.suggestedImprovement ? `\nSuggested improvement: ${report.suggestedImprovement}` : ""}`,
					labels: ["self-improvement", "report"],
					evidence: [{
						kind: "self-improvement-report",
						bundle,
						submittedAt,
						producer: report.producer,
						workflowId: report.workflowId || undefined,
						extensionRevision: resolved.revision,
						files: files.map(({ file, bytes, sha256 }) => ({ file, bytes, sha256 })),
					}],
				});
				return { epic, task };
			});
		const queue = options.withFileMutationQueue ?? (async (_file, fn) => fn());
		const { epic, task } = await queue(storePath(resolved.sourceCwd), mutation);
		return { taskId: task.id, epicId: epic.id, bundlePath, bundle, sourceCwd: resolved.sourceCwd, source: resolved.source };
	} catch (error) {
		closeInputs(inputs);
		if (staging && existsSync(staging)) rmSync(staging, { recursive: true, force: true });
		throw error;
	}
}
