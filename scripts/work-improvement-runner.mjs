#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import {
	closeSync,
	constants as fsConstants,
	existsSync,
	fstatSync,
	lstatSync,
	mkdirSync,
	openSync,
	readdirSync,
	readFileSync,
	readSync,
	realpathSync,
	renameSync,
	rmSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { appendCandidateTransition } from "../extensions/work-improvement.js";
import { hostname } from "node:os";
import path from "node:path";
import process from "node:process";
import { createHash, randomUUID } from "node:crypto";

export const SOURCE_ENV = "CE_WORKFLOW_SOURCE_DIR";
export const LEASE_DURATION_MS = 5 * 60 * 1000;
const EXPECTED_PACKAGE = "pi-work-orchestrator";

/** Execute a benchmark plan through injected gates. Agent dispatch is deliberately a seam owned by later lifecycle wiring. */
export async function runBenchmarkGatePlan(plan, seams = {}) {
	if (typeof seams.runPackageVerify !== "function")
		throw new TypeError("runPackageVerify is required");
	if (typeof seams.runDeterministicFixture !== "function")
		throw new TypeError("runDeterministicFixture is required");
	if (
		(plan.agentScenarioIds?.length ?? 0) > 0 &&
		typeof seams.runAgentScenario !== "function"
	)
		throw new TypeError("runAgentScenario is required");
	const timeoutMs = seams.timeoutMs ?? 2 * 60 * 1000;
	const packageVerification = await withTimeout(
		seams.runPackageVerify(),
		timeoutMs,
		"package verification",
	);
	if (packageVerification?.passed !== true)
		return { packageVerification, deterministic: [], agentBacked: [] };
	const deterministic = [];
	for (const fixtureId of plan.deterministicFixtureIds ?? []) {
		deterministic.push({
			fixtureId,
			samples: [
				await withTimeout(
					seams.runDeterministicFixture(fixtureId),
					timeoutMs,
					`benchmark fixture ${fixtureId}`,
				),
			],
		});
	}
	const agentBacked = [];
	for (const fixtureId of plan.agentScenarioIds ?? []) {
		const samples = [];
		for (let sample = 0; sample < 3; sample += 1)
			samples.push(
				await withTimeout(
					seams.runAgentScenario(fixtureId),
					timeoutMs,
					`agent benchmark ${fixtureId}`,
				),
			);
		agentBacked.push({ fixtureId, samples });
	}
	return { packageVerification, deterministic, agentBacked };
}

function result(reason, details = {}) {
	return { ok: false, reason, ...details };
}

function withTimeout(promise, timeoutMs, label) {
	let timer;
	return Promise.race([
		Promise.resolve(promise),
		new Promise((_, reject) => {
			timer = setTimeout(() => {
				const error = new Error(`${label} timed out`);
				error.code = "ETIMEDOUT";
				reject(error);
			}, timeoutMs);
		}),
	]).finally(() => clearTimeout(timer));
}

export function defaultRunGit(cwd, args) {
	return execFileSync("git", args, {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
		timeout: 30_000,
	}).trim();
}

function git(runGit, cwd, args) {
	try {
		return { ok: true, output: String(runGit(cwd, args) ?? "").trim() };
	} catch (error) {
		return {
			ok: false,
			output: String(error?.stderr ?? error?.message ?? error).trim(),
		};
	}
}

function validateSource(candidate, options) {
	let canonical;
	try {
		canonical = realpathSync(candidate);
	} catch {
		return result("source-unavailable");
	}
	const root = git(options.runGit, canonical, ["rev-parse", "--show-toplevel"]);
	if (!root.ok) return result("not-git-worktree");
	let canonicalRoot;
	try {
		canonicalRoot = realpathSync(root.output);
	} catch {
		return result("not-git-worktree");
	}
	if (canonicalRoot !== canonical) return result("source-not-git-root");
	try {
		const pkg = JSON.parse(
			readFileSync(path.join(canonical, "package.json"), "utf8"),
		);
		if (pkg.name !== options.expectedPackageName)
			return result("wrong-package-identity");
	} catch {
		return result("wrong-package-identity");
	}
	if (
		!["work-models.js", "work-improvement.js"].every((file) =>
			existsSync(path.join(canonical, "extensions", file)),
		)
	)
		return result("missing-work-extension");
	return { ok: true, sourceCwd: canonical };
}

/** Resolve one authoritative checkout. An invalid higher-precedence value never falls through. */
export function resolveSourceCheckout(options = {}) {
	const runGit = options.runGit ?? defaultRunGit;
	const expectedPackageName = options.expectedPackageName ?? EXPECTED_PACKAGE;
	const env = options.env ?? process.env;
	const choices = [
		[
			"setting",
			options.explicitSource ??
				options.settings?.workImprovement?.sourceCheckout,
		],
		["environment", env[SOURCE_ENV]],
		["package-root", options.packageRoot],
	];
	for (const [source, value] of choices) {
		if (typeof value !== "string" || !value.trim()) continue;
		const checked = validateSource(path.resolve(value), {
			runGit,
			expectedPackageName,
		});
		return { ...checked, resolutionSource: source };
	}
	return result("source-unavailable");
}

function gitPathExists(sourceCwd, runGit, name) {
	const found = git(runGit, sourceCwd, ["rev-parse", "--git-path", name]);
	return found.ok && existsSync(path.resolve(sourceCwd, found.output));
}

function ensureWritableRuntime(sourceCwd) {
	const runtimeDir = path.join(sourceCwd, ".pi", "work-improvement");
	const probe = path.join(
		runtimeDir,
		`.write-probe-${process.pid}-${randomUUID()}`,
	);
	try {
		mkdirSync(runtimeDir, { recursive: true });
		const fd = openSync(probe, "wx");
		closeSync(fd);
		unlinkSync(probe);
		return { ok: true, runtimeDir };
	} catch {
		try {
			unlinkSync(probe);
		} catch {}
		return result("runtime-not-writable");
	}
}

/** Fetch and prove the authoritative checkout is safe without changing its worktree. */
export function gitPreflight(sourceCwd, options = {}) {
	const runGit = options.runGit ?? defaultRunGit;
	const branch = git(runGit, sourceCwd, [
		"symbolic-ref",
		"--quiet",
		"--short",
		"HEAD",
	]);
	if (!branch.ok || !branch.output) return result("detached-head");
	const head = git(runGit, sourceCwd, ["rev-parse", "HEAD"]);
	if (!head.ok) return result("head-unavailable");
	for (const marker of [
		"MERGE_HEAD",
		"CHERRY_PICK_HEAD",
		"REBASE_HEAD",
		"rebase-merge",
		"rebase-apply",
	]) {
		if (gitPathExists(sourceCwd, runGit, marker))
			return result("git-operation-in-progress", { operation: marker });
	}
	const status = git(runGit, sourceCwd, [
		"status",
		"--porcelain=v1",
		"--untracked-files=all",
	]);
	if (!status.ok || status.output) return result("dirty-worktree");
	const upstream = git(runGit, sourceCwd, [
		"rev-parse",
		"--abbrev-ref",
		"--symbolic-full-name",
		"@{upstream}",
	]);
	if (!upstream.ok || !upstream.output) return result("upstream-unconfigured");
	const fetched = git(runGit, sourceCwd, ["fetch", "--quiet"]);
	if (!fetched.ok) return result("fetch-failed");
	const counts = git(runGit, sourceCwd, [
		"rev-list",
		"--left-right",
		"--count",
		"HEAD...@{upstream}",
	]);
	if (!counts.ok) return result("upstream-unavailable");
	const [ahead, behind] = counts.output.split(/\s+/).map(Number);
	if (ahead !== 0 || behind !== 0)
		return result("upstream-not-synchronized", { ahead, behind });
	const writable = ensureWritableRuntime(sourceCwd);
	if (!writable.ok) return writable;
	return {
		ok: true,
		sourceCwd: realpathSync(sourceCwd),
		branch: branch.output,
		head: head.output,
		upstream: upstream.output,
		ahead,
		behind,
		runtimeDir: writable.runtimeDir,
	};
}

function leasePaths(sourceCwd) {
	const runtimeDir = path.join(sourceCwd, ".pi", "work-improvement");
	return {
		runtimeDir,
		leaseDir: path.join(runtimeDir, "writer.lease"),
		metadata: path.join(runtimeDir, "writer.lease", "owner.json"),
	};
}

function readLease(metadata) {
	try {
		return JSON.parse(readFileSync(metadata, "utf8"));
	} catch {
		return null;
	}
}

function defaultIsProcessAlive(pid) {
	if (!Number.isInteger(pid) || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return error?.code === "EPERM";
	}
}

function ownerIsLive(lease, options) {
	if (!lease || lease.host !== options.host) return false;
	return options.isProcessAlive(lease.pid);
}

function takeoverMarker(leaseDir, owner) {
	const ownerHash = createHash("sha256").update(String(owner)).digest("hex");
	return path.join(leaseDir, `.takeover-${ownerHash}`);
}

/** Atomically acquire the single-writer lease; stale replacement uses an exclusive marker and directory rename. */
export function acquireLease(sourceCwd, details = {}, seams = {}) {
	const now = seams.now?.() ?? Date.now();
	const host = seams.host ?? hostname();
	const pid = seams.pid ?? process.pid;
	const isProcessAlive = seams.isProcessAlive ?? defaultIsProcessAlive;
	const durationMs = seams.durationMs ?? LEASE_DURATION_MS;
	const paths = leasePaths(sourceCwd);
	mkdirSync(paths.runtimeDir, { recursive: true });
	const lease = {
		version: 1,
		owner: details.owner ?? randomUUID(),
		host,
		pid,
		session: details.session,
		candidate: details.candidate,
		attempt: details.attempt,
		branch: details.branch,
		head: details.head,
		heartbeat: new Date(now).toISOString(),
		expiry: new Date(now + durationMs).toISOString(),
	};
	for (let pass = 0; pass < 2; pass += 1) {
		const prepared = `${paths.leaseDir}.new-${pid}-${randomUUID()}`;
		try {
			mkdirSync(prepared);
			writeFileSync(
				path.join(prepared, "owner.json"),
				`${JSON.stringify(lease)}\n`,
				{ flag: "wx" },
			);
			renameSync(prepared, paths.leaseDir);
			return { ok: true, lease, leaseDir: paths.leaseDir };
		} catch (error) {
			rmSync(prepared, { recursive: true, force: true });
			if (!["EEXIST", "ENOTEMPTY", "EPERM"].includes(error?.code))
				return result("lease-unavailable");
			const existing = readLease(paths.metadata);
			// A missing owner file is not safely distinguishable from an acquisition in flight.
			if (!existing) return result("lease-held", { lease: null });
			const expired = Date.parse(existing.expiry ?? "") <= now;
			if (!expired) return result("lease-held", { lease: existing });
			if (ownerIsLive(existing, { host, isProcessAlive }))
				return result("lease-owner-live", { lease: existing });
			seams.beforeTakeoverClaim?.(existing);
			try {
				mkdirSync(takeoverMarker(paths.leaseDir, existing.owner));
			} catch (claimError) {
				if (["ENOENT", "EEXIST"].includes(claimError?.code))
					return result("lease-held", { lease: readLease(paths.metadata) });
				return result("lease-unavailable");
			}
			const claimed = readLease(paths.metadata);
			if (!claimed || claimed.owner !== existing.owner)
				return result("lease-held", { lease: claimed });
			const stale = `${paths.leaseDir}.stale-${pid}-${randomUUID()}`;
			try {
				renameSync(paths.leaseDir, stale);
				rmSync(stale, { recursive: true, force: true });
			} catch (renameError) {
				if (!["ENOENT", "EEXIST", "ENOTEMPTY"].includes(renameError?.code))
					return result("lease-unavailable");
			}
		}
	}
	return result("lease-held", { lease: readLease(paths.metadata) });
}

export function heartbeatLease(sourceCwd, ownedLease, seams = {}) {
	const paths = leasePaths(sourceCwd);
	const current = readLease(paths.metadata);
	if (!current || current.owner !== ownedLease?.owner)
		return result("lease-ownership-lost");
	const now = seams.now?.() ?? Date.now();
	const next = {
		...current,
		heartbeat: new Date(now).toISOString(),
		expiry: new Date(
			now + (seams.durationMs ?? LEASE_DURATION_MS),
		).toISOString(),
	};
	const temporary = path.join(paths.leaseDir, `owner-${current.owner}.tmp`);
	try {
		writeFileSync(temporary, `${JSON.stringify(next)}\n`, { flag: "wx" });
		renameSync(temporary, paths.metadata);
		return { ok: true, lease: next };
	} catch {
		try {
			unlinkSync(temporary);
		} catch {}
		return result("lease-heartbeat-failed");
	}
}

export function releaseLease(sourceCwd, ownedLease) {
	const paths = leasePaths(sourceCwd);
	const current = readLease(paths.metadata);
	if (!current || current.owner !== ownedLease?.owner)
		return result("lease-ownership-lost");
	try {
		rmSync(paths.leaseDir, { recursive: true });
		return { ok: true };
	} catch {
		return result("lease-release-failed");
	}
}

/** Revalidate source, Git invariants, and lease ownership immediately before any future mutation. */
export function revalidateMutationBoundary(expected, options = {}) {
	const resolved = resolveSourceCheckout({
		explicitSource: expected?.sourceCwd,
		runGit: options.runGit,
		env: {},
	});
	if (!resolved.ok || resolved.sourceCwd !== expected.sourceCwd)
		return result("source-identity-changed");
	const preflight = gitPreflight(expected.sourceCwd, options);
	if (!preflight.ok) return preflight;
	for (const key of ["branch", "head", "upstream"])
		if (preflight[key] !== expected[key]) return result(`${key}-changed`);
	const current = readLease(leasePaths(expected.sourceCwd).metadata);
	if (!current || current.owner !== expected.lease?.owner)
		return result("lease-ownership-lost");
	if (Date.parse(current.expiry ?? "") <= (options.now?.() ?? Date.now()))
		return result("lease-expired");
	return { ok: true, preflight, lease: current };
}

const PATCH_EVIDENCE_BYTES = 64 * 1024;
const PROTECTED_ATTEMPT_PATHS = [
	".git",
	".pi/",
	".pi-subagents/",
	"node_modules/",
];

function bounded(value, limit = 8_000) {
	return String(value ?? "").slice(0, limit);
}

function safePart(value) {
	return (
		String(value ?? "attempt")
			.replace(/[^A-Za-z0-9._-]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 80) || "attempt"
	);
}

function lifecyclePrompt(candidate, attemptId, role, evidence = {}) {
	return [
		"Autonomous ce-workflow improvement. Address exactly one candidate and do not delegate.",
		`Activity: ${role === "workflow-improver" ? "improvement" : "validation"}`,
		`Candidate: ${candidate.candidateId}`,
		`Attempt: ${attemptId}`,
		`Role: ${role}`,
		`Candidate phase: ${bounded(candidate.phase, 120)}`,
		`Candidate signature: ${bounded(candidate.signature, 400)}`,
		`Expected improvement: ${bounded(candidate.expectedImprovement ?? candidate.evidence?.at(-1)?.expectedImprovement, 800)}`,
		`Bounded evidence: ${bounded(JSON.stringify(candidate.evidence ?? []), 4_000)}`,
		role === "workflow-improver"
			? "Edit only this candidate's scope. Do not stage, commit, push, switch branches, edit runtime paths, or clean unrelated files."
			: `Read-only review. Do not edit, stage, commit, or clean files. Return exactly Outcome: PASS or Outcome: FAIL. Changed paths: ${bounded((evidence.changedPaths ?? []).join(", "), 2_000)}. Verification: ${bounded(JSON.stringify(evidence.verification ?? {}), 2_000)}. Benchmark: ${bounded(JSON.stringify(evidence.benchmark ?? {}), 2_000)}.`,
	].join("\n");
}

function changedPaths(cwd, runGit) {
	const outputs = [
		git(runGit, cwd, ["diff", "--name-only", "-z", "HEAD"]),
		git(runGit, cwd, ["ls-files", "--others", "--exclude-standard", "-z"]),
		git(runGit, cwd, [
			"ls-files",
			"--others",
			"--ignored",
			"--exclude-standard",
			"-z",
			"--",
			".pi",
			".pi-subagents",
			"node_modules",
		]),
	];
	if (outputs.some((entry) => !entry.ok))
		return result("changed-path-audit-failed");
	return {
		ok: true,
		paths: [
			...new Set(
				outputs.flatMap((entry) => entry.output.split("\0")).filter(Boolean),
			),
		].sort(),
	};
}

function boundedRegularFile(file, maxBytes = PATCH_EVIDENCE_BYTES) {
	let descriptor;
	try {
		const pathInfo = lstatSync(file);
		if (
			!pathInfo.isFile() ||
			pathInfo.isSymbolicLink() ||
			pathInfo.size > maxBytes
		)
			return null;
		descriptor = openSync(
			file,
			fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0),
		);
		const info = fstatSync(descriptor);
		if (
			!info.isFile() ||
			info.size > maxBytes ||
			info.dev !== pathInfo.dev ||
			info.ino !== pathInfo.ino
		)
			return null;
		const buffer = Buffer.alloc(info.size);
		let offset = 0;
		while (offset < buffer.length) {
			const count = readSync(descriptor, buffer, offset, buffer.length - offset, null);
			if (count === 0) break;
			offset += count;
		}
		return buffer.subarray(0, offset);
	} catch {
		return null;
	} finally {
		if (descriptor !== undefined) closeSync(descriptor);
	}
}

function unsafeChangedPath(cwd, paths, runGit) {
	for (const item of paths) {
		const file = path.join(cwd, item);
		const tracked = git(runGit, cwd, ["ls-files", "--error-unmatch", "--", item]);
		try {
			lstatSync(file);
		} catch (error) {
			if (error?.code === "ENOENT" && tracked.ok) continue;
			return item;
		}
		if (boundedRegularFile(file) === null) return item;
	}
	return "";
}

function worktreeFingerprint(cwd, runGit) {
	const audit = changedPaths(cwd, runGit);
	if (!audit.ok) return "audit-failed";
	const unsafe = unsafeChangedPath(cwd, audit.paths, runGit);
	if (unsafe) return "unsafe-file";
	const diff = git(runGit, cwd, ["diff", "--binary", "HEAD"]);
	const status = git(runGit, cwd, [
		"status",
		"--porcelain=v1",
		"-z",
		"--untracked-files=all",
	]);
	const untracked = audit.paths.flatMap((item) => {
		if (git(runGit, cwd, ["ls-files", "--error-unmatch", "--", item]).ok)
			return [];
		const content = boundedRegularFile(path.join(cwd, item));
		return content === null ? [] : [`${item}\0${content.toString("base64")}`];
	});
	return createHash("sha256")
		.update(
			`${diff.ok ? diff.output : "diff-failed"}\0${status.ok ? status.output : "status-failed"}\0${untracked.join("\0")}`,
		)
		.digest("hex");
}

function pathInScope(changedPath, scopes) {
	return scopes.some((raw) => {
		const scope = String(raw ?? "")
			.replaceAll("\\", "/")
			.replace(/^\.\//, "");
		if (!scope) return false;
		return (
			changedPath === scope ||
			(scope.endsWith("/") && changedPath.startsWith(scope))
		);
	});
}

export function auditCandidatePaths(paths, candidate) {
	const normalized = paths.map((item) => item.replaceAll("\\", "/"));
	const protectedPath = normalized.find((item) =>
		PROTECTED_ATTEMPT_PATHS.some(
			(prefix) => item === prefix || item.startsWith(prefix),
		),
	);
	if (protectedPath)
		return result("protected-path-changed", { path: protectedPath });
	const scopes =
		candidate.scopePaths ??
		candidate.allowedPaths ??
		candidate.affectedPaths ??
		[];
	if (!Array.isArray(scopes) || scopes.length === 0)
		return result("candidate-scope-missing");
	const outside = normalized.find((item) => !pathInScope(item, scopes));
	return outside
		? result("candidate-scope-violation", { path: outside })
		: { ok: true };
}

function agentPassed(response) {
	return response?.ok === true && !response?.timedOut && !response?.timeout;
}

function agentOutput(response) {
	return bounded(
		response?.output ??
			response?.text ??
			response?.reply?.data?.result?.output ??
			response?.reply?.data?.output,
		16_000,
	).trim();
}

export function reviewerPassed(output) {
	const verdicts = String(output ?? "")
		.split(/\r?\n/)
		.filter((line) => /^Outcome:\s*(?:PASS|FAIL)\s*$/.test(line));
	return verdicts.length === 1 && verdicts[0] === "Outcome: PASS";
}

function preservePatchEvidence(sourceCwd, attemptId, worktreeCwd, runGit) {
	const patch = git(runGit, worktreeCwd, ["diff", "--binary", "HEAD"]);
	const audit = changedPaths(worktreeCwd, runGit);
	const untracked = audit.ok
		? audit.paths.flatMap((item) => {
				const file = path.join(worktreeCwd, item);
				if (
					git(runGit, worktreeCwd, [
						"ls-files",
						"--error-unmatch",
						"--",
						item,
					]).ok
				)
					return [];
				const content = boundedRegularFile(file, 8_000);
				if (content === null)
					return [`\nUnsafe or oversized untracked path omitted: ${item}`];
				return [`\n--- /dev/null\n+++ b/${item}\n${content.toString("utf8")}`];
			})
		: [];
	const body = [
		patch.ok ? patch.output : `patch unavailable: ${patch.output}`,
		...untracked,
		audit.ok ? `\nChanged paths:\n${audit.paths.join("\n")}` : "",
	]
		.join("")
		.slice(0, PATCH_EVIDENCE_BYTES);
	const artifact = path.join(
		sourceCwd,
		".pi",
		"work-improvement",
		"evidence",
		`${safePart(attemptId)}.patch`,
	);
	mkdirSync(path.dirname(artifact), { recursive: true });
	writeFileSync(artifact, body);
	return artifact;
}

function preserveCommitEvidence(sourceCwd, attemptId, worktreeCwd, runGit) {
	const shown = git(runGit, worktreeCwd, [
		"show",
		"--binary",
		"--format=fuller",
		"HEAD",
	]);
	if (!shown.ok || !shown.output) return "";
	const artifact = path.join(
		sourceCwd,
		".pi",
		"work-improvement",
		"evidence",
		`${safePart(attemptId)}.patch`,
	);
	mkdirSync(path.dirname(artifact), { recursive: true });
	writeFileSync(artifact, shown.output.slice(0, PATCH_EVIDENCE_BYTES));
	return artifact;
}

function removeAttemptWorktree(sourceCwd, worktreeCwd, runGit) {
	if (!worktreeCwd) return { ok: true };
	const removed = git(runGit, sourceCwd, [
		"worktree",
		"remove",
		"--force",
		worktreeCwd,
	]);
	if (!removed.ok)
		return result("git-worktree-cleanup-failed", {
			detail: bounded(removed.output),
		});
	try {
		rmSync(worktreeCwd, { recursive: true, force: true });
		return { ok: true };
	} catch (error) {
		return result("worktree-directory-cleanup-failed", {
			detail: bounded(error?.message ?? error),
		});
	}
}

function recoverAttemptWorktrees(sourceCwd, currentAttemptId, runGit) {
	const root = path.join(sourceCwd, ".pi", "work-improvement", "worktrees");
	if (!existsSync(root)) return { ok: true, recovered: [] };
	let entries;
	try {
		entries = readdirSync(root, { withFileTypes: true });
	} catch (error) {
		return result("stale-worktree-scan-failed", {
			detail: bounded(error?.message ?? error),
		});
	}
	const listed = git(runGit, sourceCwd, ["worktree", "list", "--porcelain", "-z"]);
	if (!listed.ok)
		return result("stale-worktree-registration-scan-failed", {
			detail: bounded(listed.output),
		});
	const registeredWorktrees = new Set(
		listed.output
			.split("\0")
			.filter((field) => field.startsWith("worktree "))
			.map((field) => path.resolve(field.slice("worktree ".length))),
	);
	const recovered = [];
	for (const entry of entries) {
		if (
			entry.name === safePart(currentAttemptId) ||
			entry.isSymbolicLink() ||
			!entry.isDirectory()
		)
			continue;
		const worktree = path.resolve(root, entry.name);
		if (!registeredWorktrees.has(worktree)) continue;
		const patchArtifact = preservePatchEvidence(
			sourceCwd,
			`recovered-${entry.name}`,
			worktree,
			runGit,
		);
		const cleanup = removeAttemptWorktree(sourceCwd, worktree, runGit);
		if (!cleanup.ok)
			return result("stale-worktree-cleanup-failed", {
				cleanup,
				patchArtifact,
			});
		recovered.push({ worktree, patchArtifact });
	}
	return { ok: true, recovered };
}

/** Run one isolated candidate attempt. Semantic agents can edit only the detached worktree; this coordinator alone commits. */
export async function runImprovementLifecycle(options = {}, seams = {}) {
	const sourceCwd = options.sourceCwd;
	const candidate = options.candidate;
	const attemptId = options.attemptId ?? randomUUID();
	const expected = { ...options.expected, sourceCwd: options.sourceCwd };
	const runGit = seams.runGit ?? defaultRunGit;
	const dispatchAgent = seams.dispatchAgent ?? options.dispatchAgent;
	if (
		!sourceCwd ||
		!candidate?.candidateId ||
		!expected?.head ||
		!expected?.lease
	)
		throw new TypeError(
			"sourceCwd, candidate, expected HEAD, and lease are required",
		);
	if (typeof dispatchAgent !== "function")
		throw new TypeError("dispatchAgent is required");
	if (typeof seams.runBenchmarkGate !== "function")
		throw new TypeError("runBenchmarkGate is required");
	const transition = (state, details = {}) => {
		try {
			appendCandidateTransition(sourceCwd, candidate.candidateId, state, {
				attemptId,
				activity: "improvement",
				...details,
			});
			return { ok: true };
		} catch (error) {
			return result("transition-write-failed", {
				detail: bounded(error?.message ?? error),
			});
		}
	};
	const claimed = transition("claimed");
	if (!claimed.ok)
		return { ...claimed, state: "deferred", attemptId };
	const initialBoundary = revalidateMutationBoundary(expected, {
		runGit,
		now: seams.now,
	});
	if (!initialBoundary.ok) {
		const deferred = transition("deferred", {
			blockerSignature: initialBoundary.reason,
		});
		return {
			ok: false,
			state: "deferred",
			reason: deferred.ok ? initialBoundary.reason : deferred.reason,
			attemptId,
		};
	}
	let worktreeCwd;
	let edited = false;
	let heartbeatFailure;
	const heartbeatEveryMs =
		seams.heartbeatIntervalMs ?? Math.max(1_000, LEASE_DURATION_MS / 3);
	const heartbeatTimer = setInterval(() => {
		const beat = heartbeatLease(sourceCwd, expected.lease, {
			now: seams.now,
			durationMs: seams.leaseDurationMs,
		});
		if (!beat.ok) heartbeatFailure = beat;
	}, heartbeatEveryMs);
	heartbeatTimer.unref?.();
	const boundary = () =>
		heartbeatFailure ??
		revalidateMutationBoundary(expected, { runGit, now: seams.now });
	const reject = (reason, details = {}) => {
		let state = "rejected";
		let patchArtifact;
		let finalReason = reason;
		if (edited) {
			const current = boundary();
			if (!current.ok) {
				state = "deferred";
				finalReason = current.reason;
				patchArtifact = preservePatchEvidence(
					sourceCwd,
					attemptId,
					worktreeCwd,
					runGit,
				);
			}
		}
		const recorded = transition(state, { blockerSignature: finalReason });
		const cleanup = removeAttemptWorktree(sourceCwd, worktreeCwd, runGit);
		if (!cleanup.ok)
			return {
				ok: false,
				state: "cleanup-failed",
				reason: cleanup.reason,
				attemptId,
				originalReason: finalReason,
				patchArtifact,
				cleanup,
			};
		if (!recorded.ok)
			return { ...recorded, state, attemptId, patchArtifact };
		return {
			ok: false,
			state,
			reason: finalReason,
			attemptId,
			patchArtifact,
			...details,
		};
	};
	const failCommitFinalization = (reason, details = {}) => {
		let patchArtifact;
		try {
			patchArtifact = preserveCommitEvidence(
				sourceCwd,
				attemptId,
				worktreeCwd,
				runGit,
			);
		} catch {}
		const recorded = transition("manual-recovery", {
			blockerSignature: reason,
		});
		const cleanup = patchArtifact
			? removeAttemptWorktree(sourceCwd, worktreeCwd, runGit)
			: result("commit-evidence-unavailable");
		return {
			ok: false,
			state: cleanup.ok ? "manual-recovery" : "cleanup-failed",
			reason: !recorded.ok
				? recorded.reason
				: !cleanup.ok
					? cleanup.reason
					: reason,
			originalReason: reason,
			attemptId,
			patchArtifact,
			cleanup,
			...details,
		};
	};
	try {
		const preparing = transition("preparing");
		if (!preparing.ok) return reject(preparing.reason);
		const recovered = recoverAttemptWorktrees(sourceCwd, attemptId, runGit);
		if (!recovered.ok) return reject(recovered.reason, { recovery: recovered });
		worktreeCwd = path.join(
			sourceCwd,
			".pi",
			"work-improvement",
			"worktrees",
			safePart(attemptId),
		);
		mkdirSync(path.dirname(worktreeCwd), { recursive: true });
		const added = git(runGit, sourceCwd, [
			"worktree",
			"add",
			"--detach",
			worktreeCwd,
			expected.head,
		]);
		if (!added.ok)
			return reject("worktree-create-failed", {
				detail: bounded(added.output),
			});
		const mutating = transition("mutating");
		if (!mutating.ok) return reject(mutating.reason);
		const improver = await withTimeout(
			dispatchAgent({
			agent: "workflow-improver",
			task: lifecyclePrompt(candidate, attemptId, "workflow-improver"),
			cwd: worktreeCwd,
			context: "fresh",
			async: true,
			clarify: false,
			acceptance: false,
			outputMode: "file-only",
			activity: "improvement",
			candidateId: candidate.candidateId,
				attemptId,
				artifactDir: path.join(
					sourceCwd,
					".pi",
					"work-improvement",
					"artifacts",
					 safePart(attemptId),
				),
			}),
			seams.agentTimeoutMs ?? 30 * 60 * 1000,
			"improver dispatch",
		).catch((error) => ({
			ok: false,
			timedOut: error?.code === "ETIMEDOUT",
			message: bounded(error?.message ?? error),
		}));
		if (!agentPassed(improver))
			return reject(
				improver?.timedOut || improver?.timeout
					? "improver-timeout"
					: "improver-failed",
			);
		if (!agentOutput(improver)) return reject("improver-empty-output");
		edited = true;
		const postImproverBoundary = boundary();
		if (!postImproverBoundary.ok)
			return reject(postImproverBoundary.reason);
		const worktreeHead = git(runGit, worktreeCwd, ["rev-parse", "HEAD"]);
		if (!worktreeHead.ok || worktreeHead.output !== expected.head)
			return reject("agent-created-commit");
		const staged = git(runGit, worktreeCwd, [
			"diff",
			"--cached",
			"--name-only",
		]);
		if (!staged.ok || staged.output) return reject("agent-staged-changes");
		const audit = changedPaths(worktreeCwd, runGit);
		if (!audit.ok) return reject(audit.reason);
		if (audit.paths.length === 0) return reject("empty-candidate-change");
		const unsafePath = unsafeChangedPath(worktreeCwd, audit.paths, runGit);
		if (unsafePath) return reject("unsafe-candidate-file", { path: unsafePath });
		const scope = auditCandidatePaths(audit.paths, candidate);
		if (!scope.ok) return reject(scope.reason, { path: scope.path });
		const verifying = transition("verifying", { activity: "validation" });
		if (!verifying.ok) return reject(verifying.reason);
		const beforePackage = boundary();
		if (!beforePackage.ok) return reject(beforePackage.reason);
		const packageVerification = await withTimeout(
			seams.runPackageVerify
				? seams.runPackageVerify({ cwd: worktreeCwd })
				: Promise.resolve().then(() => {
						try {
							execFileSync(
								process.execPath,
								["scripts/verify-package.mjs", "--quiet"],
								{ cwd: worktreeCwd, stdio: "pipe", timeout: 2 * 60 * 1000 },
							);
							return { passed: true };
						} catch (error) {
							return {
								passed: false,
								output: bounded(error?.stderr ?? error?.message),
							};
						}
					}),
			seams.packageTimeoutMs ?? 2 * 60 * 1000,
			"package verification",
		).catch((error) => ({
			passed: false,
			timedOut: error?.code === "ETIMEDOUT",
			output: bounded(error?.message ?? error),
		}));
		if (packageVerification?.passed !== true)
			return reject("package-verification-failed");
		const { buildBenchmarkPlan } = await import(
			"./work-improvement-benchmark.mjs"
		);
		const benchmarkPlan = buildBenchmarkPlan(audit.paths);
		const beforeBenchmark = boundary();
		if (!beforeBenchmark.ok) return reject(beforeBenchmark.reason);
		const benchmark = await withTimeout(
			seams.runBenchmarkGate({
				cwd: worktreeCwd,
				changedPaths: audit.paths,
				plan: benchmarkPlan,
			}),
			seams.benchmarkTimeoutMs ?? 30 * 60 * 1000,
			"benchmark gate",
		).catch((error) => ({
			passed: false,
			timedOut: error?.code === "ETIMEDOUT",
			output: bounded(error?.message ?? error),
		}));
		if (benchmark?.passed !== true)
			return reject("benchmark-failed", { benchmark });
		const beforeReviewBoundary = boundary();
		if (!beforeReviewBoundary.ok) return reject(beforeReviewBoundary.reason);
		const beforeReview = worktreeFingerprint(worktreeCwd, runGit);
		if (beforeReview === "unsafe-file") return reject("unsafe-candidate-file");
		const reviewer = await withTimeout(
			dispatchAgent({
			agent: "workflow-improvement-reviewer",
			task: lifecyclePrompt(
				candidate,
				attemptId,
				"workflow-improvement-reviewer",
				{
					changedPaths: audit.paths,
					verification: packageVerification,
					benchmark,
				},
			),
			cwd: worktreeCwd,
			context: "fresh",
			async: true,
			clarify: false,
			acceptance: false,
			outputMode: "file-only",
			activity: "validation",
			candidateId: candidate.candidateId,
				attemptId,
				readOnly: true,
				artifactDir: path.join(
					sourceCwd,
					".pi",
					"work-improvement",
					"artifacts",
					safePart(attemptId),
				),
			}),
			seams.agentTimeoutMs ?? 30 * 60 * 1000,
			"reviewer dispatch",
		).catch((error) => ({
			ok: false,
			timedOut: error?.code === "ETIMEDOUT",
			message: bounded(error?.message ?? error),
		}));
		if (!agentPassed(reviewer))
			return reject(
				reviewer?.timedOut || reviewer?.timeout
					? "reviewer-timeout"
					: "reviewer-failed",
			);
		const reviewOutput = agentOutput(reviewer);
		if (!reviewOutput) return reject("reviewer-empty-output");
		const afterReview = worktreeFingerprint(worktreeCwd, runGit);
		if (beforeReview === "audit-failed" || afterReview !== beforeReview)
			return reject("reviewer-mutated-worktree");
		if (!reviewerPassed(reviewOutput))
			return reject("review-failed", { review: reviewOutput });
		const finalBoundary = boundary();
		if (!finalBoundary.ok) return reject(finalBoundary.reason);
		const pending = transition("commit-pending");
		if (!pending.ok) return reject(pending.reason);
		const immediatelyBeforeCommit = boundary();
		if (!immediatelyBeforeCommit.ok)
			return reject(immediatelyBeforeCommit.reason);
		const unsafeBeforeStage = unsafeChangedPath(
			worktreeCwd,
			audit.paths,
			runGit,
		);
		if (unsafeBeforeStage)
			return reject("unsafe-candidate-file", { path: unsafeBeforeStage });
		const addedFiles = git(runGit, worktreeCwd, ["add", "--", ...audit.paths]);
		if (!addedFiles.ok) return reject("candidate-stage-failed");
		const committed = git(runGit, worktreeCwd, [
			"commit",
			"-m",
			`workflow-improvement: ${safePart(candidate.candidateId).slice(0, 32)}`,
		]);
		if (!committed.ok)
			return reject("candidate-commit-failed", {
				detail: bounded(committed.output),
			});
		const commit = git(runGit, worktreeCwd, ["rev-parse", "HEAD"]);
		if (!commit.ok || !/^[a-f0-9]{40,64}$/.test(commit.output))
			return failCommitFinalization("candidate-commit-unavailable");
		const beforeRef = boundary();
		if (!beforeRef.ok) {
			const patchArtifact = preserveCommitEvidence(
				sourceCwd,
				attemptId,
				worktreeCwd,
				runGit,
			);
			const recorded = transition("deferred", {
				blockerSignature: beforeRef.reason,
			});
			const cleanup = removeAttemptWorktree(sourceCwd, worktreeCwd, runGit);
			return {
				ok: false,
				state: cleanup.ok ? "deferred" : "cleanup-failed",
				reason: !recorded.ok
					? recorded.reason
					: !cleanup.ok
						? cleanup.reason
						: beforeRef.reason,
				attemptId,
				patchArtifact,
				cleanup,
			};
		}
		const candidateRef = `refs/ce-workflow/candidates/${safePart(candidate.candidateId)}/${safePart(attemptId)}`;
		const updatedRef = git(runGit, sourceCwd, [
			"update-ref",
			candidateRef,
			commit.output,
		]);
		if (!updatedRef.ok)
			return failCommitFinalization("candidate-ref-update-failed", {
				commitSha: commit.output,
				candidateRef,
			});
		const verifiedRef = git(runGit, sourceCwd, [
			"rev-parse",
			"--verify",
			candidateRef,
		]);
		if (!verifiedRef.ok || verifiedRef.output !== commit.output)
			return failCommitFinalization("candidate-ref-verification-failed", {
				commitSha: commit.output,
				candidateRef,
			});
		const recorded = transition("committed", {
			commitSha: commit.output,
			candidateRef,
		});
		const cleanup = removeAttemptWorktree(sourceCwd, worktreeCwd, runGit);
		if (!recorded.ok || !cleanup.ok)
			return {
				ok: false,
				state: "cleanup-failed",
				reason: !recorded.ok ? recorded.reason : cleanup.reason,
				attemptId,
				commitSha: commit.output,
				candidateRef,
				cleanup,
			};
		return {
			ok: true,
			state: "committed",
			attemptId,
			commitSha: commit.output,
			candidateRef,
			changedPaths: audit.paths,
			packageVerification,
			benchmark,
			review: reviewOutput,
		};
	} catch (error) {
		return reject("attempt-exception", {
			detail: bounded(error?.message ?? error),
		});
	} finally {
		clearInterval(heartbeatTimer);
	}
}
