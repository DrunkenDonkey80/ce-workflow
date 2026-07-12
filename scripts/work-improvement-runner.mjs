#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import {
	closeSync,
	existsSync,
	mkdirSync,
	openSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { hostname } from "node:os";
import path from "node:path";
import process from "node:process";
import { createHash, randomUUID } from "node:crypto";

export const SOURCE_ENV = "CE_WORKFLOW_SOURCE_DIR";
export const LEASE_DURATION_MS = 5 * 60 * 1000;
const EXPECTED_PACKAGE = "pi-work-orchestrator";

function result(reason, details = {}) {
	return { ok: false, reason, ...details };
}

export function defaultRunGit(cwd, args) {
	return execFileSync("git", args, {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
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
