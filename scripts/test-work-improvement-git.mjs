#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	SOURCE_ENV,
	acquireLease,
	gitPreflight,
	heartbeatLease,
	releaseLease,
	resolveSourceCheckout,
	revalidateMutationBoundary,
} from "./work-improvement-runner.mjs";

const roots = [];
function temp(name) {
	const value = mkdtempSync(
		path.join(tmpdir(), `work-improvement-git-${name}-`),
	);
	roots.push(value);
	return value;
}
function run(cwd, ...args) {
	return execFileSync("git", args, {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	}).trim();
}
function writeIdentity(cwd) {
	mkdirSync(path.join(cwd, "extensions"), { recursive: true });
	writeFileSync(
		path.join(cwd, "package.json"),
		JSON.stringify({ name: "pi-work-orchestrator" }),
	);
	writeFileSync(
		path.join(cwd, "extensions", "work-models.js"),
		"export default true;\n",
	);
	writeFileSync(
		path.join(cwd, "extensions", "work-improvement.js"),
		"export const version = 1;\n",
	);
	writeFileSync(path.join(cwd, ".gitignore"), ".pi/\n");
}
function fixture(name = "source") {
	const base = temp(name);
	const remote = path.join(base, "remote.git");
	const seed = path.join(base, "seed");
	const source = path.join(base, "source");
	run(base, "init", "--bare", remote);
	run(base, "init", seed);
	run(seed, "config", "user.email", "fixture@example.test");
	run(seed, "config", "user.name", "Fixture");
	writeIdentity(seed);
	run(seed, "add", ".");
	run(seed, "commit", "-m", "fixture");
	const branch = run(seed, "branch", "--show-current");
	run(seed, "remote", "add", "origin", remote);
	run(seed, "push", "-u", "origin", branch);
	run(base, "clone", remote, source);
	run(source, "config", "user.email", "fixture@example.test");
	run(source, "config", "user.name", "Fixture");
	return { base, remote, seed, source: realpathSync(source), branch };
}
function assertReason(actual, reason) {
	assert.equal(actual.ok, false, JSON.stringify(actual));
	assert.equal(actual.reason, reason);
}

try {
	const explicit = fixture("precedence-explicit");
	const environment = fixture("precedence-env");
	const fallback = fixture("precedence-package");
	let resolved = resolveSourceCheckout({
		explicitSource: explicit.source,
		env: { [SOURCE_ENV]: environment.source },
		packageRoot: fallback.source,
	});
	assert.equal(resolved.sourceCwd, explicit.source);
	assert.equal(resolved.resolutionSource, "setting");
	resolved = resolveSourceCheckout({
		env: { [SOURCE_ENV]: environment.source },
		packageRoot: fallback.source,
	});
	assert.equal(resolved.sourceCwd, environment.source);
	assert.equal(resolved.resolutionSource, "environment");
	resolved = resolveSourceCheckout({ env: {}, packageRoot: fallback.source });
	assert.equal(resolved.sourceCwd, fallback.source);
	assert.equal(resolved.resolutionSource, "package-root");

	const installed = temp("installed");
	writeIdentity(installed);
	assertReason(
		resolveSourceCheckout({ env: {}, packageRoot: installed }),
		"not-git-worktree",
	);
	const wrong = fixture("wrong");
	writeFileSync(
		path.join(wrong.source, "package.json"),
		JSON.stringify({ name: "another-package" }),
	);
	assertReason(
		resolveSourceCheckout({
			explicitSource: wrong.source,
			env: { [SOURCE_ENV]: environment.source },
		}),
		"wrong-package-identity",
	);
	assert.equal(
		resolveSourceCheckout({
			explicitSource: wrong.source,
			env: { [SOURCE_ENV]: environment.source },
		}).resolutionSource,
		"setting",
	);
	run(wrong.source, "checkout", "--", "package.json");
	rmSync(path.join(wrong.source, "extensions", "work-models.js"));
	assertReason(
		resolveSourceCheckout({ explicitSource: wrong.source }),
		"missing-work-extension",
	);
	assertReason(
		resolveSourceCheckout({
			explicitSource: path.join(explicit.source, "extensions"),
		}),
		"source-not-git-root",
	);

	const safe = fixture("safe");
	const preflight = gitPreflight(safe.source);
	assert.equal(preflight.ok, true, JSON.stringify(preflight));
	assert.equal(preflight.ahead, 0);
	assert.equal(preflight.behind, 0);
	assert.ok(existsSync(preflight.runtimeDir));

	const dirty = fixture("dirty");
	writeFileSync(path.join(dirty.source, "package.json"), "dirty");
	assertReason(gitPreflight(dirty.source), "dirty-worktree");
	const untracked = fixture("untracked");
	writeFileSync(path.join(untracked.source, "new.txt"), "dirty");
	assertReason(gitPreflight(untracked.source), "dirty-worktree");
	const detached = fixture("detached");
	run(detached.source, "checkout", "--detach");
	assertReason(gitPreflight(detached.source), "detached-head");
	const noUpstream = fixture("no-upstream");
	run(noUpstream.source, "branch", "--unset-upstream");
	assertReason(gitPreflight(noUpstream.source), "upstream-unconfigured");

	const ahead = fixture("ahead");
	writeFileSync(path.join(ahead.source, "ahead.txt"), "ahead");
	run(ahead.source, "add", "ahead.txt");
	run(ahead.source, "commit", "-m", "ahead");
	assert.deepEqual(gitPreflight(ahead.source).ahead, 1);
	assertReason(gitPreflight(ahead.source), "upstream-not-synchronized");
	const behind = fixture("behind");
	writeFileSync(path.join(behind.seed, "behind.txt"), "behind");
	run(behind.seed, "add", "behind.txt");
	run(behind.seed, "commit", "-m", "behind");
	run(behind.seed, "push");
	const behindResult = gitPreflight(behind.source);
	assertReason(behindResult, "upstream-not-synchronized");
	assert.equal(behindResult.behind, 1);
	const diverged = fixture("diverged");
	writeFileSync(path.join(diverged.source, "local.txt"), "local");
	run(diverged.source, "add", "local.txt");
	run(diverged.source, "commit", "-m", "local");
	writeFileSync(path.join(diverged.seed, "remote.txt"), "remote");
	run(diverged.seed, "add", "remote.txt");
	run(diverged.seed, "commit", "-m", "remote");
	run(diverged.seed, "push");
	const divergedResult = gitPreflight(diverged.source);
	assertReason(divergedResult, "upstream-not-synchronized");
	assert.equal(divergedResult.ahead, 1);
	assert.equal(divergedResult.behind, 1);

	for (const marker of ["MERGE_HEAD", "CHERRY_PICK_HEAD", "rebase-merge"]) {
		const operation = fixture(`operation-${marker}`);
		const markerPath = run(operation.source, "rev-parse", "--git-path", marker);
		if (marker.startsWith("rebase-"))
			mkdirSync(path.resolve(operation.source, markerPath));
		else
			writeFileSync(path.resolve(operation.source, markerPath), preflight.head);
		const operationResult = gitPreflight(operation.source);
		assertReason(operationResult, "git-operation-in-progress");
		assert.equal(operationResult.operation, marker);
	}

	const leaseRepo = fixture("lease");
	const leasePreflight = gitPreflight(leaseRepo.source);
	const details = {
		session: "session-1",
		candidate: "candidate-1",
		attempt: "attempt-1",
		branch: leasePreflight.branch,
		head: leasePreflight.head,
	};
	const first = acquireLease(leaseRepo.source, details, {
		now: () => 1_000,
		host: "host",
		pid: 101,
		isProcessAlive: () => true,
	});
	assert.equal(first.ok, true);
	for (const key of [
		"owner",
		"host",
		"pid",
		"session",
		"candidate",
		"attempt",
		"branch",
		"head",
		"heartbeat",
		"expiry",
	])
		assert.notEqual(first.lease[key], undefined, key);
	assertReason(
		acquireLease(
			leaseRepo.source,
			{ ...details, attempt: "attempt-2" },
			{ now: () => 1_001, host: "host", pid: 102 },
		),
		"lease-held",
	);
	assertReason(
		acquireLease(leaseRepo.source, details, {
			now: () => 1_000_000,
			host: "host",
			pid: 102,
			isProcessAlive: (pid) => pid === 101,
		}),
		"lease-owner-live",
	);
	assert.equal(releaseLease(leaseRepo.source, first.lease).ok, true);

	const stale = acquireLease(leaseRepo.source, details, {
		now: () => 2_000,
		durationMs: 10,
		host: "host",
		pid: 201,
	});
	assert.equal(stale.ok, true);
	const recovered = acquireLease(
		leaseRepo.source,
		{ ...details, attempt: "attempt-2" },
		{ now: () => 3_000, host: "host", pid: 202, isProcessAlive: () => false },
	);
	assert.equal(recovered.ok, true, JSON.stringify(recovered));
	assert.notEqual(recovered.lease.owner, stale.lease.owner);
	const beat = heartbeatLease(leaseRepo.source, recovered.lease, {
		now: () => 3_500,
		durationMs: 100,
	});
	assert.equal(beat.ok, true);
	assert.equal(beat.lease.heartbeat, new Date(3_500).toISOString());

	const expected = { ...leasePreflight, lease: beat.lease };
	assert.equal(
		revalidateMutationBoundary(expected, { now: () => 3_550 }).ok,
		true,
	);
	writeFileSync(path.join(leaseRepo.source, "unexpected.txt"), "dirty");
	assertReason(
		revalidateMutationBoundary(expected, { now: () => 3_550 }),
		"dirty-worktree",
	);
	rmSync(path.join(leaseRepo.source, "unexpected.txt"));
	run(leaseRepo.source, "checkout", "--detach");
	assertReason(
		revalidateMutationBoundary(expected, { now: () => 3_550 }),
		"detached-head",
	);
	run(leaseRepo.source, "checkout", leaseRepo.branch);
	assert.equal(releaseLease(leaseRepo.source, beat.lease).ok, true);
	assertReason(
		revalidateMutationBoundary(expected, { now: () => 3_550 }),
		"lease-ownership-lost",
	);

	const takeoverRace = fixture("lease-takeover-race");
	const racePreflight = gitPreflight(takeoverRace.source);
	const raceDetails = {
		...details,
		branch: racePreflight.branch,
		head: racePreflight.head,
	};
	const raceStale = acquireLease(takeoverRace.source, raceDetails, {
		now: () => 6_000,
		durationMs: 10,
		host: "host",
		pid: 301,
	});
	assert.equal(raceStale.ok, true);
	let raceWinner;
	const raceLoser = acquireLease(
		takeoverRace.source,
		{ ...raceDetails, attempt: "attempt-loser" },
		{
			now: () => 7_000,
			host: "host",
			pid: 302,
			isProcessAlive: () => false,
			beforeTakeoverClaim: () => {
				raceWinner = acquireLease(
					takeoverRace.source,
					{ ...raceDetails, attempt: "attempt-winner" },
					{
						now: () => 7_000,
						host: "host",
						pid: 303,
						isProcessAlive: () => false,
					},
				);
				assert.equal(raceWinner.ok, true, JSON.stringify(raceWinner));
			},
		},
	);
	assertReason(raceLoser, "lease-held");
	assert.equal(raceLoser.lease.owner, raceWinner.lease.owner);
	assert.equal(releaseLease(takeoverRace.source, raceWinner.lease).ok, true);

	const changedHead = fixture("changed-head");
	const changedPreflight = gitPreflight(changedHead.source);
	const changedLease = acquireLease(
		changedHead.source,
		{
			...details,
			branch: changedPreflight.branch,
			head: changedPreflight.head,
		},
		{ now: () => 5_000, durationMs: 10_000 },
	);
	writeFileSync(path.join(changedHead.source, "change.txt"), "change");
	run(changedHead.source, "add", "change.txt");
	run(changedHead.source, "commit", "-m", "changed");
	run(changedHead.source, "push");
	assertReason(
		revalidateMutationBoundary(
			{ ...changedPreflight, lease: changedLease.lease },
			{ now: () => 5_100 },
		),
		"head-changed",
	);

	console.log(
		"ok - work improvement source, Git preflight, lease, and revalidation fixtures pass",
	);
} finally {
	for (const root of roots.reverse())
		rmSync(root, { recursive: true, force: true });
}
