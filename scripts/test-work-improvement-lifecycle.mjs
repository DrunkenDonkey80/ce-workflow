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
	symlinkSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Canonicalize on Windows so package verification does not load the runner under two drive-path casings.
const {
	acquireLease,
	gitPreflight,
	releaseLease,
	reviewerPassed,
	runImprovementLifecycle,
} = await import(
		pathToFileURL(
			realpathSync(
				path.join(import.meta.dirname, "work-improvement-runner.mjs"),
			),
		).href
	);

const { dispatchWorkflowImprovementAgent } = await import(
	pathToFileURL(
		realpathSync(path.join(import.meta.dirname, "../extensions/work-models.js")),
	).href
);

const roots = [];
function git(cwd, ...args) {
	return execFileSync("git", args, {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	}).trim();
}
function fakeRpcPi(onSpawn) {
	const listeners = new Map();
	const events = {
		on(name, callback) {
			listeners.set(name, callback);
			return () => listeners.delete(name);
		},
		emit(name, payload) {
			if (name === "subagents:rpc:v1:request") {
				onSpawn(payload.params, (reply) =>
					events.emit(`subagents:rpc:v1:reply:${payload.requestId}`, reply),
				);
				return;
			}
			listeners.get(name)?.(payload);
		},
	};
	return { events };
}

function fixture(name) {
	const root = mkdtempSync(
		path.join(tmpdir(), `work-improvement-lifecycle-${name}-`),
	);
	roots.push(root);
	const remote = path.join(root, "remote.git");
	const source = path.join(root, "source");
	git(root, "init", "--bare", remote);
	git(root, "clone", remote, source);
	git(source, "config", "user.email", "fixture@example.test");
	git(source, "config", "user.name", "Fixture");
	mkdirSync(path.join(source, "extensions"));
	writeFileSync(
		path.join(source, "package.json"),
		JSON.stringify({ name: "pi-work-orchestrator" }),
	);
	writeFileSync(
		path.join(source, "extensions", "work-models.js"),
		"export default true;\n",
	);
	writeFileSync(
		path.join(source, "extensions", "work-improvement.js"),
		"export const version = 1;\n",
	);
	writeFileSync(
		path.join(source, ".gitignore"),
		".pi/\n.pi-subagents/\nnode_modules/\n",
	);
	writeFileSync(path.join(source, "lib.txt"), "before\n");
	git(source, "add", ".");
	git(source, "commit", "-m", "fixture");
	const branch = git(source, "branch", "--show-current");
	git(source, "push", "-u", "origin", branch);
	return { source: realpathSync(source), branch };
}

async function attempt(name, behavior = {}) {
	const repo = fixture(name);
	const expected = gitPreflight(repo.source);
	assert.equal(expected.ok, true);
	const attemptId = `attempt-${name}`;
	const lease = acquireLease(repo.source, {
		candidate: `candidate-${name}`,
		attempt: attemptId,
		branch: expected.branch,
		head: expected.head,
	});
	assert.equal(lease.ok, true);
	const calls = [];
	let sourceChanged = false;
	let candidateCommitted = false;
	const changeSource = () => {
		if (sourceChanged) return;
		sourceChanged = true;
		writeFileSync(path.join(repo.source, "source-race.txt"), "human\n");
		git(repo.source, "add", "source-race.txt");
		git(repo.source, "commit", "-m", "source changed");
		git(repo.source, "push");
	};
	const dispatchAgent = async (payload) => {
		calls.push(payload);
		if (payload.agent === "workflow-improver") {
			if (behavior.improver === "failure") return { ok: false };
			if (behavior.improver === "timeout") return { ok: false, timedOut: true };
			if (behavior.improver === "hang") return new Promise(() => {});
			if (behavior.protected) {
				mkdirSync(path.join(payload.cwd, ".pi"), { recursive: true });
				writeFileSync(path.join(payload.cwd, ".pi", "evil.txt"), "evil");
			} else if (behavior.unsafeTrackedReplacement) {
				rmSync(path.join(payload.cwd, "lib.txt"));
				mkdirSync(path.join(payload.cwd, "lib.txt"));
				writeFileSync(path.join(payload.cwd, "lib.txt", "nested.txt"), "unsafe\n");
			} else if (behavior.deleteTracked) {
				rmSync(path.join(payload.cwd, "lib.txt"));
			} else {
				const target = behavior.unsafeLarge
					? "large.txt"
					: behavior.outside
						? "outside.txt"
						: "lib.txt";
				writeFileSync(
					path.join(payload.cwd, target),
					behavior.unsafeLarge ? "x".repeat(70 * 1024) : "after\n",
				);
			}
			return {
				ok: true,
				output: behavior.improver === "empty" ? "" : "changed one candidate",
			};
		}
		if (behavior.sourceChange) changeSource();
		if (behavior.reviewerMutation)
			writeFileSync(path.join(payload.cwd, "lib.txt"), "reviewer edit\n");
		if (behavior.reviewerStage) git(payload.cwd, "add", "lib.txt");
		return {
			ok: true,
			output: behavior.reviewFail
				? "Outcome: FAIL\nblocker"
				: "Outcome: PASS\nno blockers",
		};
	};
	if (behavior.staleRecovery) {
		const stale = path.join(
			repo.source,
			".pi",
			"work-improvement",
			"worktrees",
			"prior",
		);
		mkdirSync(path.dirname(stale), { recursive: true });
		git(repo.source, "worktree", "add", "--detach", stale, expected.head);
		writeFileSync(path.join(stale, "lib.txt"), "stale edit\n");
	}
	if (behavior.unrelatedNestedRepo) {
		const unrelated = path.join(
			repo.source,
			".pi",
			"work-improvement",
			"worktrees",
			"unrelated",
		);
		mkdirSync(unrelated, { recursive: true });
		git(unrelated, "init");
		writeFileSync(path.join(unrelated, "keep.txt"), "unrelated\n");
	}
	const result = await runImprovementLifecycle(
		{
			sourceCwd: repo.source,
			candidate: {
				candidateId: `candidate-${name}`,
				phase: "fixture",
				signature: "reduce repeated work",
				expectedImprovement: "less waste",
				evidence: [{ workflowRunId: "workflow-1", observed: "waste" }],
				scopePaths: behavior.outsideScope ?? ["lib.txt"],
			},
			attemptId,
			expected: { ...expected, lease: lease.lease },
		},
		{
			dispatchAgent,
			agentTimeoutMs: behavior.improver === "hang" ? 5 : undefined,
			runGit:
				behavior.cleanupFail ||
				behavior.finalRevParseFail ||
				behavior.updateRefFail ||
				behavior.refVerificationFail ||
				behavior.commitEvidenceFail
					? (cwd, args) => {
							if (behavior.cleanupFail && args[0] === "worktree" && args[1] === "remove")
								throw new Error("injected cleanup failure");
							if (behavior.finalRevParseFail && candidateCommitted && args.join(" ") === "rev-parse HEAD")
								throw new Error("injected final rev-parse failure");
							if (behavior.updateRefFail && args[0] === "update-ref")
								throw new Error("injected update-ref failure");
							if (behavior.commitEvidenceFail && args[0] === "show")
								throw new Error("injected commit evidence failure");
							if (behavior.refVerificationFail && candidateCommitted && args[0] === "rev-parse" && args[1] === "--verify")
								throw new Error("injected ref verification failure");
							const output = git(cwd, ...args);
							if (args[0] === "commit" && cwd !== repo.source) candidateCommitted = true;
							return output;
						}
					: undefined,
			heartbeatIntervalMs: behavior.heartbeatLoss ? 1 : undefined,
			runPackageVerify: async () => {
				if (behavior.sourceChangeAtVerify) changeSource();
				return { passed: behavior.verifyFail !== true };
			},
			runBenchmarkGate: async ({ changedPaths, plan }) => {
				if (behavior.heartbeatLoss) {
					rmSync(path.join(repo.source, ".pi", "work-improvement", "writer.lease"), {
						recursive: true,
						force: true,
					});
					await new Promise((resolve) => setTimeout(resolve, 15));
				}
				return {
					passed: behavior.benchmarkFail !== true,
					changedPaths,
					fixtureIds: plan.deterministicFixtureIds,
				};
			},
		},
	);
	assert.equal(
		git(repo.source, "status", "--porcelain=v1", "--untracked-files=all"),
		"",
		`${name} source dirt`,
	);
	assert.equal(
		existsSync(
			path.join(repo.source, ".pi", "work-improvement", "worktrees", attemptId),
		),
		Boolean(
			(behavior.cleanupFail && !behavior.staleRecovery) ||
			behavior.commitEvidenceFail,
		),
	);
	if (!behavior.heartbeatLoss)
		assert.equal(releaseLease(repo.source, lease.lease).ok, true);
	return { repo, expected, attemptId, calls, result };
}

try {
	const passing = await attempt("pass");
	assert.equal(passing.result.ok, true);
	assert.equal(passing.result.state, "committed");
	assert.match(passing.result.commitSha, /^[a-f0-9]{40}$/);
	assert.match(
		passing.result.candidateRef,
		/^refs\/ce-workflow\/candidates\/candidate-pass\/attempt-pass$/,
	);
	assert.equal(
		git(passing.repo.source, "rev-parse", "--verify", passing.result.candidateRef),
		passing.result.commitSha,
		"candidate commit must remain reachable after worktree cleanup",
	);
	assert.equal(
		git(passing.repo.source, "rev-parse", "HEAD"),
		passing.expected.head,
		"coordinator must not integrate onto source branch in U5",
	);
	assert.deepEqual(
		passing.calls.map((call) => call.agent),
		["workflow-improver", "workflow-improvement-reviewer"],
	);
	for (const call of passing.calls) {
		assert.equal(call.cwd.includes(`${path.sep}worktrees${path.sep}`), true);
		assert.equal(call.candidateId, "candidate-pass");
		assert.equal(call.attemptId, passing.attemptId);
		assert.match(call.task, /Activity: (improvement|validation)/);
		assert.match(call.task, /Candidate: candidate-pass/);
		assert.match(call.task, /Attempt: attempt-pass/);
	}
	const events = readFileSync(
		path.join(
			passing.repo.source,
			".pi",
			"work-improvement",
			"candidate-events.jsonl",
		),
		"utf8",
	)
		.trim()
		.split(/\r?\n/)
		.map(JSON.parse)
		.filter((event) => event.attemptId === passing.attemptId);
	assert.deepEqual(
		events.map((event) => event.transition),
		[
			"claimed",
			"preparing",
			"mutating",
			"verifying",
			"commit-pending",
			"committed",
		],
	);

	assert.equal(
		(await attempt("outside", { outside: true })).result.reason,
		"candidate-scope-violation",
	);
	assert.equal(
		(await attempt("protected", { protected: true })).result.reason,
		"protected-path-changed",
	);
	assert.equal(
		(
			await attempt("unsafe-large", {
				unsafeLarge: true,
				outsideScope: ["large.txt"],
			})
		).result.reason,
		"unsafe-candidate-file",
	);
	assert.equal(
		(await attempt("unsafe-tracked", { unsafeTrackedReplacement: true })).result
			.reason,
		"unsafe-candidate-file",
	);
	const deleted = await attempt("tracked-deletion", { deleteTracked: true });
	assert.equal(deleted.result.ok, true);
	assert.throws(
		() => git(deleted.repo.source, "cat-file", "-e", `${deleted.result.commitSha}:lib.txt`),
		/tracked deletion|Command failed/,
		"tracked deletion should be committed as an absent path",
	);
	assert.equal(
		(await attempt("failure", { improver: "failure" })).result.reason,
		"improver-failed",
	);
	assert.equal(
		(await attempt("empty", { improver: "empty" })).result.reason,
		"improver-empty-output",
	);
	assert.equal(
		(await attempt("timeout", { improver: "timeout" })).result.reason,
		"improver-timeout",
	);
	assert.equal(
		(await attempt("bounded-timeout", { improver: "hang" })).result.reason,
		"improver-timeout",
	);
	assert.equal(
		(await attempt("verify", { verifyFail: true })).result.reason,
		"package-verification-failed",
	);
	assert.equal(
		(await attempt("benchmark", { benchmarkFail: true })).result.reason,
		"benchmark-failed",
	);
	assert.equal(
		(await attempt("review", { reviewFail: true })).result.reason,
		"review-failed",
	);
	assert.equal(
		(await attempt("review-mutation", { reviewerMutation: true })).result
			.reason,
		"reviewer-mutated-worktree",
	);
	assert.equal(
		(await attempt("review-stage", { reviewerStage: true })).result.reason,
		"reviewer-mutated-worktree",
	);
	const cleanupFailed = await attempt("cleanup-failure", { cleanupFail: true });
	assert.equal(cleanupFailed.result.state, "cleanup-failed");
	assert.equal(cleanupFailed.result.reason, "git-worktree-cleanup-failed");
	assert.equal(
		existsSync(
			path.join(
				cleanupFailed.repo.source,
				".pi",
				"work-improvement",
				"worktrees",
				cleanupFailed.attemptId,
			),
		),
		true,
		"failed authoritative cleanup must leave the worktree intact",
	);

	const recoveredAttempt = await attempt("stale-recovery", {
		staleRecovery: true,
	});
	assert.equal(recoveredAttempt.result.ok, true);
	assert.equal(
		existsSync(
			path.join(
				recoveredAttempt.repo.source,
				".pi",
				"work-improvement",
				"worktrees",
				"prior",
			),
		),
		false,
	);
	assert.equal(
		existsSync(
			path.join(
				recoveredAttempt.repo.source,
				".pi",
				"work-improvement",
				"evidence",
				"recovered-prior.patch",
			),
		),
		true,
	);

	const unrelated = await attempt("unrelated-repo", {
		unrelatedNestedRepo: true,
	});
	assert.equal(unrelated.result.ok, true);
	assert.equal(
		existsSync(
			path.join(
				unrelated.repo.source,
				".pi",
				"work-improvement",
				"worktrees",
				"unrelated",
				"keep.txt",
			),
		),
		true,
		"unregistered nested repositories must not be recovered",
	);

	const staleCleanupFailed = await attempt("stale-cleanup-failure", {
		staleRecovery: true,
		cleanupFail: true,
	});
	assert.equal(staleCleanupFailed.result.reason, "stale-worktree-cleanup-failed");
	assert.equal(
		existsSync(
			path.join(
				staleCleanupFailed.repo.source,
				".pi",
				"work-improvement",
				"worktrees",
				"prior",
			),
		),
		true,
	);

	for (const [name, behavior, reason] of [
		["final-rev-parse", { finalRevParseFail: true }, "candidate-commit-unavailable"],
		["update-ref", { updateRefFail: true }, "candidate-ref-update-failed"],
		["ref-verification", { refVerificationFail: true }, "candidate-ref-verification-failed"],
	]) {
		const failed = await attempt(name, behavior);
		assert.equal(failed.result.state, "manual-recovery", name);
		assert.equal(failed.result.originalReason, reason, name);
		assert.equal(existsSync(failed.result.patchArtifact), true, name);
		assert.match(readFileSync(failed.result.patchArtifact, "utf8"), /commit|diff|lib\.txt/i);
	}
	const noEvidence = await attempt("commit-evidence-unavailable", {
		updateRefFail: true,
		commitEvidenceFail: true,
	});
	assert.equal(noEvidence.result.state, "cleanup-failed");
	assert.equal(noEvidence.result.cleanup.reason, "commit-evidence-unavailable");
	assert.equal(
		existsSync(
			path.join(
				noEvidence.repo.source,
				".pi",
				"work-improvement",
				"worktrees",
				noEvidence.attemptId,
			),
		),
		true,
	);

	assert.equal(reviewerPassed("Outcome: PASS\nclean"), true);
	for (const unsafeVerdict of [
		"The likely Outcome: PASS is clear",
		"Outcome: PASS\nOutcome: PASS",
		"Outcome: PASS\nOutcome: FAIL",
		" outcome: PASS",
	])
		assert.equal(reviewerPassed(unsafeVerdict), false, unsafeVerdict);

	const earlierRace = await attempt("source-change-verify-fail", {
		sourceChangeAtVerify: true,
		verifyFail: true,
	});
	assert.equal(earlierRace.result.state, "deferred");
	assert.equal(earlierRace.result.reason, "head-changed");
	assert.equal(existsSync(earlierRace.result.patchArtifact), true);

	const heartbeatLost = await attempt("heartbeat-loss", { heartbeatLoss: true });
	assert.equal(heartbeatLost.result.state, "deferred");
	assert.equal(heartbeatLost.result.reason, "lease-ownership-lost");
	assert.equal(existsSync(heartbeatLost.result.patchArtifact), true);

	const raced = await attempt("source-change", { sourceChange: true });
	assert.equal(raced.result.state, "deferred");
	assert.equal(raced.result.reason, "head-changed");
	assert.equal(existsSync(raced.result.patchArtifact), true);
	assert.match(
		readFileSync(raced.result.patchArtifact, "utf8"),
		/lib\.txt|after/,
	);

	const rpcRoot = mkdtempSync(path.join(tmpdir(), "workflow-agent-rpc-"));
	roots.push(rpcRoot);
	const artifactDir = path.join(rpcRoot, "artifacts");
	const asyncDir = path.join(rpcRoot, "async");
	const rpcCalls = [];
	const pi = fakeRpcPi((params, reply) => {
		rpcCalls.push(params);
		mkdirSync(asyncDir, { recursive: true });
		mkdirSync(path.dirname(params.output), { recursive: true });
		writeFileSync(params.output, "Outcome: PASS\n");
		writeFileSync(
			path.join(asyncDir, "status.json"),
			JSON.stringify({ state: "complete" }),
		);
		reply({
			success: true,
			data: { runId: "run-1", asyncDir, outputPath: params.output },
		});
	});
	const dispatched = await dispatchWorkflowImprovementAgent(
		pi,
		{
			agent: "workflow-improvement-reviewer",
			candidateId: "candidate-rpc",
			attemptId: "attempt-rpc",
			cwd: passing.repo.source,
			artifactDir,
			task: "review",
		},
		1_000,
	);
	assert.equal(dispatched.ok, true, JSON.stringify(dispatched));
	assert.equal(dispatched.runId, "run-1");
	assert.equal(dispatched.asyncDir, asyncDir);
	assert.equal(rpcCalls[0].async, true);
	assert.equal(path.isAbsolute(rpcCalls[0].output), true);
	assert.equal(rpcCalls[0].output.startsWith(path.resolve(artifactDir)), true);
	assert.equal(dispatched.output, "Outcome: PASS\n");

	const outsideArtifact = path.join(rpcRoot, "outside.md");
	const unsafePi = fakeRpcPi((params, reply) => {
		assert.equal(path.isAbsolute(params.output), true);
		const unsafeAsync = path.join(rpcRoot, "unsafe-async");
		mkdirSync(unsafeAsync, { recursive: true });
		writeFileSync(outsideArtifact, "stolen\n");
		writeFileSync(
			path.join(unsafeAsync, "status.json"),
			JSON.stringify({ status: "complete" }),
		);
		reply({
			success: true,
			data: {
				runId: "run-unsafe",
				asyncDir: unsafeAsync,
				outputPath: outsideArtifact,
			},
		});
	});
	const unsafeDispatch = await dispatchWorkflowImprovementAgent(
		unsafePi,
		{
			agent: "workflow-improver",
			candidateId: "candidate-rpc",
			attemptId: "attempt-unsafe",
			cwd: passing.repo.source,
			artifactDir,
			task: "edit",
		},
		1_000,
	);
	assert.equal(unsafeDispatch.ok, false);
	assert.match(unsafeDispatch.message, /unsafe or missing agent artifact/);

	for (const artifactCase of ["swap", "oversize", "symlink"]) {
		const caseDir = path.join(rpcRoot, artifactCase);
		const caseArtifacts = path.join(caseDir, "artifacts");
		const outside = path.join(caseDir, "outside.md");
		const casePi = fakeRpcPi((params, reply) => {
			const caseAsync = path.join(caseDir, "async");
			mkdirSync(caseAsync, { recursive: true });
			mkdirSync(path.dirname(params.output), { recursive: true });
			writeFileSync(outside, "outside\n");
			if (artifactCase === "oversize")
				writeFileSync(params.output, "x".repeat(64 * 1024 + 1));
			else {
				if (artifactCase === "swap") {
					writeFileSync(params.output, "original\n");
					unlinkSync(params.output);
				}
				symlinkSync(outside, params.output);
			}
			writeFileSync(
				path.join(caseAsync, "status.json"),
				JSON.stringify({ state: "complete" }),
			);
			reply({
				success: true,
				data: { runId: `run-${artifactCase}`, asyncDir: caseAsync, outputPath: params.output },
			});
		});
		const artifactResult = await dispatchWorkflowImprovementAgent(
			casePi,
			{
				agent: "workflow-improver",
				candidateId: "candidate-rpc",
				attemptId: `attempt-${artifactCase}`,
				cwd: passing.repo.source,
				artifactDir: caseArtifacts,
				task: "edit",
			},
			1_000,
		);
		assert.equal(artifactResult.ok, false, artifactCase);
		assert.match(artifactResult.message, /unsafe or missing agent artifact/);
	}

	console.log("ok - isolated work improvement lifecycle fixtures pass");
} finally {
	for (const root of roots.reverse())
		rmSync(root, { recursive: true, force: true });
}
