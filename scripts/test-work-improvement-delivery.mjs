#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const {
	acquireLease,
	gitPreflight,
	releaseLease,
	runImprovementDelivery,
} = await import(pathToFileURL(realpathSync(path.join(import.meta.dirname, "work-improvement-runner.mjs"))).href);

const roots = [];
function git(cwd, ...args) {
	return execFileSync("git", args, {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
		timeout: 30_000,
	}).trim();
}

function fixture(name) {
	const root = mkdtempSync(path.join(tmpdir(), `work-improvement-delivery-${name}-`));
	roots.push(root);
	const remote = path.join(root, "remote.git");
	const source = path.join(root, "source");
	git(root, "init", "--bare", remote);
	git(root, "clone", remote, source);
	git(source, "config", "user.email", "fixture@example.test");
	git(source, "config", "user.name", "Fixture");
	mkdirSync(path.join(source, "extensions"));
	writeFileSync(path.join(source, "package.json"), JSON.stringify({ name: "pi-work-orchestrator" }));
	writeFileSync(path.join(source, "extensions", "work-models.js"), "export default true;\n");
	writeFileSync(path.join(source, "extensions", "work-improvement.js"), "export const version = 1;\n");
	writeFileSync(path.join(source, ".gitignore"), ".pi/\n");
	writeFileSync(path.join(source, "lib.txt"), "before\n");
	git(source, "add", ".");
	git(source, "commit", "-m", "base");
	const branch = git(source, "branch", "--show-current");
	git(source, "push", "-u", "origin", branch);
	const expected = gitPreflight(source);
	assert.equal(expected.ok, true);
	const candidateCwd = path.join(root, "candidate");
	git(source, "worktree", "add", "--detach", candidateCwd, expected.head);
	writeFileSync(path.join(candidateCwd, "lib.txt"), "after\n");
	git(candidateCwd, "add", "lib.txt");
	git(candidateCwd, "commit", "-m", "candidate");
	const commitSha = git(candidateCwd, "rev-parse", "HEAD");
	const candidateRef = `refs/ce-workflow/candidates/candidate-${name}/attempt-${name}`;
	git(source, "update-ref", candidateRef, commitSha);
	git(source, "worktree", "remove", "--force", candidateCwd);
	const lease = acquireLease(source, {
		candidate: `candidate-${name}`,
		attempt: `attempt-${name}`,
		branch: expected.branch,
		head: expected.head,
	});
	assert.equal(lease.ok, true);
	return { root, remote, source: realpathSync(source), expected, commitSha, candidateRef, lease };
}

async function deliver(name, behavior = {}) {
	const repo = fixture(name);
	let pushCalls = 0;
	let validationSignal;
	const pushArgs = [];
	const runGit = (cwd, args) => {
		if (
			behavior.validationCleanupFail &&
			args[0] === "worktree" &&
			args[1] === "remove" &&
			path.basename(args.at(-1)).startsWith("validation-")
		)
			throw new Error("injected validation cleanup failure");
		if (
			behavior.refDeleteFail &&
			args[0] === "update-ref" &&
			args[1] === "-d"
		)
			throw new Error("injected ref deletion failure");
		if (args[0] === "push") {
			pushCalls += 1;
			pushArgs.push(args);
			if (behavior.branchDuringPush && pushCalls === 1) {
				git(cwd, "branch", "race-branch", repo.expected.head);
				git(cwd, "checkout", "race-branch");
			}
			if (behavior.pushAbsent) throw new Error("simulated timeout before remote received push");
			if (behavior.pushPresent && pushCalls === 1) {
				git(cwd, ...args);
				throw new Error("simulated timeout after remote received push");
			}
			if (behavior.pushDiverged && pushCalls === 1) {
				const other = path.join(repo.root, "other");
				git(repo.root, "clone", repo.remote, other);
				git(other, "config", "user.email", "other@example.test");
				git(other, "config", "user.name", "Other");
				writeFileSync(path.join(other, "remote.txt"), "other\n");
				git(other, "add", ".");
				git(other, "commit", "-m", "remote divergence");
				git(other, "push");
				throw new Error("simulated ambiguous divergent push");
			}
		}
		return git(cwd, ...args);
	};
	const options = {
		sourceCwd: repo.source,
		candidateId: `candidate-${name}`,
		attemptId: `attempt-${name}`,
		candidateRef: repo.candidateRef,
		commitSha: repo.commitSha,
		changedPaths: ["lib.txt"],
		expected: { ...repo.expected, lease: repo.lease.lease },
	};
	const seams = {
		runGit,
		validationTimeoutMs:
			behavior.hangingValidation || behavior.cancelledValidation ? 10 : 2_000,
		validationCancelGraceMs:
			behavior.hangingValidation || behavior.cancelledValidation ? 10 : 1_000,
		runPackageVerify: async ({ cwd, signal }) => {
			validationSignal = signal;
			assert.equal(git(cwd, "rev-parse", "HEAD"), git(repo.source, "rev-parse", "@{upstream}"));
			if (behavior.hangingValidation) return new Promise(() => {});
			if (behavior.cancelledValidation)
				return new Promise((resolve) =>
					signal.addEventListener("abort", () => resolve({ passed: false }), {
						once: true,
					}),
				);
			return { passed: true };
		},
		runBenchmarkGate: async () => {
			if (behavior.dirtyBeforeRevert)
				writeFileSync(path.join(repo.source, "human.txt"), "human\n");
			if (behavior.retargetRef)
				git(repo.source, "update-ref", repo.candidateRef, repo.expected.head);
			if (behavior.remoteAdvance) {
				const other = path.join(repo.root, "post-validation-race");
				git(repo.root, "clone", repo.remote, other);
				git(other, "config", "user.email", "other@example.test");
				git(other, "config", "user.name", "Other");
				writeFileSync(path.join(other, "advance.txt"), "advance\n");
				git(other, "add", ".");
				git(other, "commit", "-m", "advance after validation");
				git(other, "push");
			}
			return { passed: behavior.validationFail !== true };
		},
	};
	if (behavior.dirtyBeforeIntegration)
		writeFileSync(path.join(repo.source, "human-before.txt"), "human\n");
	if (behavior.branchBeforeIntegration)
		git(repo.source, "checkout", "-b", "unexpected-branch");
	const result = await runImprovementDelivery(options, seams);
	return { repo, options, seams, result, pushCalls, pushArgs, validationSignal };
}

try {
	const accepted = await deliver("accepted");
	assert.equal(accepted.result.state, "accepted", JSON.stringify(accepted.result));
	assert.equal(git(accepted.repo.source, "rev-parse", "HEAD"), accepted.repo.commitSha);
	assert.equal(git(accepted.repo.source, "rev-parse", "@{upstream}"), accepted.repo.commitSha);
	assert.equal(existsSync(path.join(accepted.repo.source, ".git", accepted.repo.candidateRef)), false);
	const events = readFileSync(path.join(accepted.repo.source, ".pi", "work-improvement", "candidate-events.jsonl"), "utf8")
		.trim().split(/\r?\n/).map(JSON.parse);
	assert.deepEqual(events.map((event) => event.transition), [
		"integration-pending", "push-pending", "push-pending", "pushed", "validating", "cleanup-pending", "accepted",
	]);
	assert.equal(events.find((event) => event.transition === "push-pending" && event.integrationSha)?.integrationSha, accepted.repo.commitSha);
	assert.equal(events.at(-1).validationPassed, true);
	assert.equal(events.at(-1).packagePassed, true);
	assert.equal(events.at(-1).benchmarkPassed, true);
	assert.deepEqual(accepted.pushArgs[0], [
		"push",
		"origin",
		`${accepted.repo.commitSha}:refs/heads/${accepted.repo.expected.branch}`,
	]);
	assert.equal(releaseLease(accepted.repo.source, accepted.repo.lease.lease).ok, true);

	const ambiguous = await deliver("ambiguous-present", { pushPresent: true });
	assert.equal(ambiguous.result.state, "accepted");
	assert.equal(ambiguous.pushCalls, 1, "present remote SHA must suppress duplicate push");
	assert.equal(releaseLease(ambiguous.repo.source, ambiguous.repo.lease.lease).ok, true);

	const absent = await deliver("absent", { pushAbsent: true });
	assert.equal(absent.result.state, "deferred");
	assert.equal(absent.result.reason, "push-proven-absent");
	assert.equal(absent.pushCalls, 2, "a proven absent push gets one bounded safe retry");
	assert.equal(git(absent.repo.source, "rev-parse", "@{upstream}"), absent.repo.expected.head);
	assert.equal(git(absent.repo.source, "rev-parse", "--verify", absent.repo.candidateRef), absent.repo.commitSha);
	const resumed = await runImprovementDelivery(absent.options, {
		...absent.seams,
		runGit: (cwd, args) => git(cwd, ...args),
	});
	assert.equal(resumed.state, "accepted", "persisted integration SHA resumes without duplicate integration");
	assert.equal(releaseLease(absent.repo.source, absent.repo.lease.lease).ok, true);

	const dirtyIntegration = await deliver("dirty-integration", { dirtyBeforeIntegration: true });
	assert.equal(dirtyIntegration.result.state, "deferred");
	assert.equal(dirtyIntegration.result.reason, "dirty-worktree");
	assert.equal(git(dirtyIntegration.repo.source, "rev-parse", "HEAD"), dirtyIntegration.repo.expected.head);
	assert.equal(releaseLease(dirtyIntegration.repo.source, dirtyIntegration.repo.lease.lease).ok, true);

	const branchIntegration = await deliver("branch-integration", { branchBeforeIntegration: true });
	assert.equal(branchIntegration.result.state, "deferred");
	assert.equal(branchIntegration.result.reason, "branch-changed");
	assert.equal(git(branchIntegration.repo.source, "rev-parse", "HEAD"), branchIntegration.repo.expected.head);
	assert.equal(releaseLease(branchIntegration.repo.source, branchIntegration.repo.lease.lease).ok, true);

	const diverged = await deliver("diverged", { pushDiverged: true });
	assert.equal(diverged.result.state, "manual-recovery");
	assert.equal(diverged.result.reason, "remote-diverged");
	assert.equal(git(diverged.repo.source, "rev-parse", "--verify", diverged.repo.candidateRef), diverged.repo.commitSha);
	assert.equal(releaseLease(diverged.repo.source, diverged.repo.lease.lease).ok, true);

	const reverted = await deliver("reverted", { validationFail: true });
	assert.equal(reverted.result.state, "reverted");
	assert.match(git(reverted.repo.source, "log", "-1", "--pretty=%s"), /^Revert /);
	assert.equal(git(reverted.repo.source, "rev-parse", "HEAD"), reverted.result.revertSha);
	assert.equal(git(reverted.repo.source, "rev-parse", "@{upstream}"), reverted.result.revertSha);
	assert.equal(readFileSync(path.join(reverted.repo.source, "lib.txt"), "utf8").trim(), "before");
	assert.equal(releaseLease(reverted.repo.source, reverted.repo.lease.lease).ok, true);

	const dirty = await deliver("dirty-revert", { validationFail: true, dirtyBeforeRevert: true });
	assert.equal(dirty.result.state, "manual-recovery");
	assert.equal(dirty.result.reason, "dirty-worktree");
	assert.equal(existsSync(path.join(dirty.repo.source, "human.txt")), true);
	assert.equal(git(dirty.repo.source, "rev-parse", "--verify", dirty.repo.candidateRef), dirty.repo.commitSha);
	assert.equal(releaseLease(dirty.repo.source, dirty.repo.lease.lease).ok, true);

	const branchRace = await deliver("branch-race", { branchDuringPush: true });
	assert.equal(branchRace.result.state, "push-unknown");
	assert.equal(branchRace.result.reason, "push-reconciliation-failed");
	assert.deepEqual(branchRace.pushArgs[0], [
		"push",
		"origin",
		`${branchRace.repo.commitSha}:refs/heads/${branchRace.repo.expected.branch}`,
	]);
	assert.equal(
		git(branchRace.repo.remote, "rev-parse", `refs/heads/${branchRace.repo.expected.branch}`),
		branchRace.repo.commitSha,
		"a checkout branch race must still push only the recorded branch",
	);
	assert.throws(
		() => git(branchRace.repo.remote, "rev-parse", "refs/heads/race-branch"),
		/unknown revision|Command failed/,
	);
	git(branchRace.repo.source, "checkout", branchRace.repo.expected.branch);
	const branchRaceRestart = await runImprovementDelivery(branchRace.options, {
		...branchRace.seams,
		runGit: (cwd, args) => git(cwd, ...args),
	});
	assert.equal(branchRaceRestart.state, "accepted", "push ambiguity reconciles on restart");
	assert.equal(releaseLease(branchRace.repo.source, branchRace.repo.lease.lease).ok, true);

	const advanced = await deliver("remote-advance", { remoteAdvance: true });
	assert.equal(advanced.result.state, "manual-recovery");
	assert.equal(advanced.result.reason, "upstream-diverged");
	assert.equal(git(advanced.repo.source, "rev-parse", "--verify", advanced.repo.candidateRef), advanced.repo.commitSha);
	assert.equal(releaseLease(advanced.repo.source, advanced.repo.lease.lease).ok, true);

	const retargeted = await deliver("retargeted-ref", { retargetRef: true });
	assert.equal(retargeted.result.state, "manual-recovery");
	assert.equal(retargeted.result.reason, "candidate-ref-mismatch");
	assert.equal(
		git(retargeted.repo.source, "rev-parse", "--verify", retargeted.repo.candidateRef),
		retargeted.repo.expected.head,
		"terminal cleanup must not delete a replacement ref",
	);
	assert.equal(releaseLease(retargeted.repo.source, retargeted.repo.lease.lease).ok, true);

	const cleanupFailed = await deliver("validation-cleanup", { validationCleanupFail: true });
	assert.equal(cleanupFailed.result.state, "manual-recovery");
	assert.equal(cleanupFailed.result.reason, "validation-worktree-cleanup-failed");
	assert.match(git(cleanupFailed.repo.source, "worktree", "list", "--porcelain"), /validation-attempt-validation-cleanup-/);
	assert.equal(git(cleanupFailed.repo.source, "rev-parse", "--verify", cleanupFailed.repo.candidateRef), cleanupFailed.repo.commitSha);
	assert.equal(releaseLease(cleanupFailed.repo.source, cleanupFailed.repo.lease.lease).ok, true);

	const hanging = await deliver("hanging-validation", { hangingValidation: true });
	assert.equal(hanging.result.state, "manual-recovery");
	assert.equal(hanging.result.reason, "validation-unknown");
	assert.equal(hanging.validationSignal.aborted, true);
	assert.match(git(hanging.repo.source, "worktree", "list", "--porcelain"), /validation-attempt-hanging-validation-/);
	const hangingRestart = await runImprovementDelivery(hanging.options, {
		...hanging.seams,
		runGit: (cwd, args) => git(cwd, ...args),
	});
	assert.equal(hangingRestart.state, "manual-recovery");
	assert.equal(hangingRestart.reason, "manual-recovery-persisted");
	assert.match(
		git(hanging.repo.source, "worktree", "list", "--porcelain"),
		/validation-attempt-hanging-validation-/,
		"same-process restart must not remove a worktree still used by unresolved validation",
	);
	assert.equal(git(hanging.repo.source, "rev-parse", "--verify", hanging.repo.candidateRef), hanging.repo.commitSha);
	assert.equal(releaseLease(hanging.repo.source, hanging.repo.lease.lease).ok, true);

	const cancelled = await deliver("cancelled-validation", { cancelledValidation: true });
	assert.equal(cancelled.result.state, "reverted", "confirmed cancellation may clean up and revert");
	assert.equal(cancelled.validationSignal.aborted, true);
	assert.doesNotMatch(git(cancelled.repo.source, "worktree", "list", "--porcelain"), /validation-attempt-cancelled-validation-/);
	assert.equal(releaseLease(cancelled.repo.source, cancelled.repo.lease.lease).ok, true);

	const cleanupPending = await deliver("cleanup-pending", { refDeleteFail: true });
	assert.equal(cleanupPending.result.state, "manual-recovery");
	assert.equal(cleanupPending.result.reason, "candidate-ref-delete-failed");
	const cleanupPendingRestart = await runImprovementDelivery(cleanupPending.options, {
		...cleanupPending.seams,
		runGit: (cwd, args) => git(cwd, ...args),
	});
	assert.equal(cleanupPendingRestart.state, "accepted");
	assert.throws(
		() => git(cleanupPending.repo.source, "rev-parse", "--verify", cleanupPending.repo.candidateRef),
		/needed a single revision|Command failed/,
	);
	assert.equal(releaseLease(cleanupPending.repo.source, cleanupPending.repo.lease.lease).ok, true);

	git(accepted.repo.source, "update-ref", accepted.repo.candidateRef, accepted.repo.commitSha);
	const terminalRestart = await runImprovementDelivery(accepted.options, {
		...accepted.seams,
		runGit: (cwd, args) => git(cwd, ...args),
	});
	assert.equal(terminalRestart.state, "accepted");
	assert.throws(
		() => git(accepted.repo.source, "rev-parse", "--verify", accepted.repo.candidateRef),
		/needed a single revision|Command failed/,
	);

	console.log("ok - work improvement delivery fixtures pass");
} finally {
	for (const root of roots.reverse()) rmSync(root, { recursive: true, force: true });
}
