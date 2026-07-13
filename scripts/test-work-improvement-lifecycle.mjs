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
	reconcileAutonomousImprovement,
	reviewerPassed,
	runAutonomousImprovement,
	runAutonomousImprovementBenchmark,
	runImprovementLifecycle,
} = await import(
	pathToFileURL(
		realpathSync(path.join(import.meta.dirname, "work-improvement-runner.mjs")),
	).href
);

const {
	completeWorkflowOnce,
	dispatchWorkflowImprovementAgent,
	processTerminalWorkflow,
	recoverTerminalWorkflowClaims,
} = await import(
	pathToFileURL(
		realpathSync(
			path.join(import.meta.dirname, "../extensions/work-models.js"),
		),
	).href
);

const { appendCandidateTransition, readCandidateState } = await import(
	pathToFileURL(
		realpathSync(
			path.join(import.meta.dirname, "../extensions/work-improvement.js"),
		),
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
				writeFileSync(
					path.join(payload.cwd, "lib.txt", "nested.txt"),
					"unsafe\n",
				);
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
							if (
								behavior.cleanupFail &&
								args[0] === "worktree" &&
								args[1] === "remove"
							)
								throw new Error("injected cleanup failure");
							if (
								behavior.finalRevParseFail &&
								candidateCommitted &&
								args.join(" ") === "rev-parse HEAD"
							)
								throw new Error("injected final rev-parse failure");
							if (behavior.updateRefFail && args[0] === "update-ref")
								throw new Error("injected update-ref failure");
							if (behavior.commitEvidenceFail && args[0] === "show")
								throw new Error("injected commit evidence failure");
							if (
								behavior.refVerificationFail &&
								candidateCommitted &&
								args[0] === "rev-parse" &&
								args[1] === "--verify"
							)
								throw new Error("injected ref verification failure");
							const output = git(cwd, ...args);
							if (args[0] === "commit" && cwd !== repo.source)
								candidateCommitted = true;
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
					rmSync(
						path.join(repo.source, ".pi", "work-improvement", "writer.lease"),
						{
							recursive: true,
							force: true,
						},
					);
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
		git(
			passing.repo.source,
			"rev-parse",
			"--verify",
			passing.result.candidateRef,
		),
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
		() =>
			git(
				deleted.repo.source,
				"cat-file",
				"-e",
				`${deleted.result.commitSha}:lib.txt`,
			),
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
	assert.equal(
		staleCleanupFailed.result.reason,
		"stale-worktree-cleanup-failed",
	);
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
		[
			"final-rev-parse",
			{ finalRevParseFail: true },
			"candidate-commit-unavailable",
		],
		["update-ref", { updateRefFail: true }, "candidate-ref-update-failed"],
		[
			"ref-verification",
			{ refVerificationFail: true },
			"candidate-ref-verification-failed",
		],
	]) {
		const failed = await attempt(name, behavior);
		assert.equal(failed.result.state, "manual-recovery", name);
		assert.equal(failed.result.originalReason, reason, name);
		assert.equal(existsSync(failed.result.patchArtifact), true, name);
		assert.match(
			readFileSync(failed.result.patchArtifact, "utf8"),
			/commit|diff|lib\.txt/i,
		);
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

	const heartbeatLost = await attempt("heartbeat-loss", {
		heartbeatLoss: true,
	});
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

	// U7 paired source + consumer lifecycle wiring.
	const paired = fixture("paired");
	const consumer = path.join(path.dirname(paired.source), "consumer");
	mkdirSync(consumer);
	git(consumer, "init");
	git(consumer, "config", "user.email", "fixture@example.test");
	git(consumer, "config", "user.name", "Fixture");
	writeFileSync(path.join(consumer, "consumer.txt"), "unchanged\n");
	git(consumer, "add", ".");
	git(consumer, "commit", "-m", "consumer fixture");
	const consumerHead = git(consumer, "rev-parse", "HEAD");
	mkdirSync(path.join(consumer, ".pi"), { recursive: true });
	const settingsFile = path.join(consumer, ".pi", "settings.json");
	writeFileSync(
		settingsFile,
		JSON.stringify({
			workResume: { selfImproving: false },
			workImprovement: { sourceCheckout: paired.source },
		}),
	);
	assert.equal(
		(
			await processTerminalWorkflow(consumer, {
				workflowRunId: "flag-off",
				outcome: "failed",
			})
		).status,
		"disabled",
	);
	assert.equal(readCandidateState(paired.source).analyses.size, 0);

	writeFileSync(
		settingsFile,
		JSON.stringify({
			workResume: { selfImproving: true },
			workImprovement: { sourceCheckout: paired.source },
		}),
	);
	const invalidSources = [];
	const arbitrary = path.join(path.dirname(paired.source), "arbitrary-source");
	mkdirSync(arbitrary);
	writeFileSync(path.join(arbitrary, "marker.txt"), "unchanged\n");
	invalidSources.push([arbitrary, "not-git-worktree"]);
	const wrongPackage = path.join(path.dirname(paired.source), "wrong-package");
	mkdirSync(wrongPackage);
	git(wrongPackage, "init");
	writeFileSync(
		path.join(wrongPackage, "package.json"),
		JSON.stringify({ name: "not-this-package" }),
	);
	writeFileSync(path.join(wrongPackage, "marker.txt"), "unchanged\n");
	git(wrongPackage, "add", ".");
	git(
		wrongPackage,
		"-c",
		"user.email=x@example.test",
		"-c",
		"user.name=X",
		"commit",
		"-m",
		"wrong",
	);
	invalidSources.push([wrongPackage, "wrong-package-identity"]);
	invalidSources.push([
		path.join(path.dirname(paired.source), "missing-untrusted"),
		"source-unavailable",
	]);
	for (const [invalidSource, reason] of invalidSources) {
		writeFileSync(
			settingsFile,
			JSON.stringify({
				workResume: { selfImproving: true },
				workImprovement: { sourceCheckout: invalidSource },
			}),
		);
		const before = existsSync(invalidSource)
			? readFileSync(path.join(invalidSource, "marker.txt"), "utf8")
			: null;
		const invalid = await processTerminalWorkflow(consumer, {
			workflowRunId: `invalid-${reason}`,
			outcome: "failed",
		});
		assert.equal(invalid.reason, reason);
		assert.equal(
			existsSync(path.join(invalidSource, ".pi")),
			false,
			"untrusted source must not receive candidate state",
		);
		if (before !== null)
			assert.equal(
				readFileSync(path.join(invalidSource, "marker.txt"), "utf8"),
				before,
			);
	}
	writeFileSync(
		settingsFile,
		JSON.stringify({
			workResume: { selfImproving: true },
			workImprovement: {
				sourceCheckout: path.relative(consumer, paired.source),
			},
		}),
	);
	const telemetryDir = path.join(consumer, ".pi", "work-runs");
	mkdirSync(telemetryDir, { recursive: true });
	const telemetryFile = path.join(telemetryDir, "fixture.jsonl");
	const writeSignal = (workflowRunId) =>
		writeFileSync(
			telemetryFile,
			`${JSON.stringify({ type: "command", workflowRunId, outputChars: 20_000 })}\n`,
			{ flag: "a" },
		);
	writeSignal("ordinary-1");
	const accumulating = await processTerminalWorkflow(
		consumer,
		{ workflowRunId: "ordinary-1", outcome: "completed" },
		{ allowLaunch: false },
	);
	assert.equal(accumulating.status, "analyzed");
	assert.equal(
		[...readCandidateState(paired.source).candidates.values()].some(
			(candidate) => candidate.state === "accumulating",
		),
		true,
	);
	assert.equal(
		(
			await processTerminalWorkflow(
				consumer,
				{ workflowRunId: "ordinary-1", outcome: "completed" },
				{ allowLaunch: false },
			)
		).status,
		"already-analyzed",
		"terminal analysis is exactly once",
	);
	writeSignal("ordinary-2");
	await processTerminalWorkflow(
		consumer,
		{ workflowRunId: "ordinary-2", outcome: "completed" },
		{ allowLaunch: false },
	);
	assert.equal(
		[...readCandidateState(paired.source).candidates.values()].some(
			(candidate) => candidate.state === "actionable",
		),
		true,
	);
	const candidateLog = path.join(
		paired.source,
		".pi",
		"work-improvement",
		"candidate-events.jsonl",
	);
	const beforePrint = readFileSync(candidateLog, "utf8");
	const hardPrint = await processTerminalWorkflow(
		consumer,
		{ workflowRunId: "hard-print", outcome: "failed", reason: "gate failed" },
		{ mode: "print" },
	);
	assert.equal(
		hardPrint.status,
		"suppressed",
		"print mode stops before source resolution",
	);
	assert.equal(
		readFileSync(candidateLog, "utf8"),
		beforePrint,
		"print mode must not mutate source or candidates",
	);
	const hardJson = await processTerminalWorkflow(
		consumer,
		{ workflowRunId: "hard-json", outcome: "failed" },
		{ json: true },
	);
	assert.equal(hardJson.status, "suppressed");
	assert.equal(
		readFileSync(candidateLog, "utf8"),
		beforePrint,
		"JSON mode must not mutate source or candidates",
	);
	const recursive = await processTerminalWorkflow(
		consumer,
		{ workflowRunId: "recursive", outcome: "failed", activity: "validation" },
		{
			improvementSeams: { dispatchAgent: () => assert.fail("nested dispatch") },
		},
	);
	assert.equal(recursive.status, "excluded");

	const autonomous = async (name, validationPass) => {
		const repo = fixture(`autonomous-${name}`);
		let benchmarkRuns = 0;
		const result = await runAutonomousImprovement(
			{
				consumerCwd: consumer,
				candidate: {
					candidateId: `candidate-autonomous-${name}`,
					phase: "fixture",
					signature: "paired lifecycle",
					evidence: [{ workflowRunId: `workflow-${name}` }],
					scopePaths: ["lib.txt"],
				},
				settings: { workImprovement: { sourceCheckout: repo.source } },
				packageRoot: repo.source,
			},
			{
				dispatchAgent: async (payload) => {
					if (payload.agent === "workflow-improver") {
						writeFileSync(path.join(payload.cwd, "lib.txt"), `after-${name}\n`);
						return { ok: true, output: "one scoped change" };
					}
					return { ok: true, output: "Outcome: PASS" };
				},
				runPackageVerify: async () => ({ passed: true }),
				runBenchmarkGate: async () => ({
					passed: ++benchmarkRuns === 1 || validationPass,
				}),
			},
		);
		assert.equal(git(consumer, "rev-parse", "HEAD"), consumerHead);
		assert.equal(
			git(consumer, "status", "--porcelain=v1", "--untracked-files=no"),
			"",
			"consumer tracked files remain unchanged",
		);
		return { repo, result };
	};
	assert.equal((await autonomous("accepted", true)).result.state, "accepted");
	assert.equal((await autonomous("reverted", false)).result.state, "reverted");

	const benchmarkRepo = fixture("production-benchmark");
	mkdirSync(path.join(benchmarkRepo.source, "scripts"));
	mkdirSync(path.join(benchmarkRepo.source, "agents"));
	writeFileSync(
		path.join(benchmarkRepo.source, "scripts", "test-work-settings.mjs"),
		"Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150); process.stdout.write('ok')\n",
	);
	writeFileSync(
		path.join(benchmarkRepo.source, "agents", "workflow-benchmark.md"),
		"# Workflow benchmark\nRun read-only and return the requested JSON metrics.\n",
	);
	git(benchmarkRepo.source, "add", ".");
	git(benchmarkRepo.source, "commit", "-m", "benchmark fixtures");
	git(benchmarkRepo.source, "push");
	const benchmarkCandidate = path.join(
		path.dirname(benchmarkRepo.source),
		"benchmark-candidate",
	);
	mkdirSync(path.join(benchmarkCandidate, "scripts"), { recursive: true });
	writeFileSync(
		path.join(benchmarkCandidate, "scripts", "test-work-settings.mjs"),
		"process.stdout.write('ok')\n",
	);
	let agentBenchmarkCalls = 0;
	const productionBenchmark = await runAutonomousImprovementBenchmark(
		benchmarkRepo.source,
		{
			cwd: benchmarkCandidate,
			changedPaths: ["agents/workflow-benchmark.md"],
			candidateId: "benchmark-candidate",
			attemptId: "benchmark-attempt",
		},
		async (payload) => {
			agentBenchmarkCalls += 1;
			assert.equal(payload.agent, "workflow-benchmark");
			assert.equal(payload.readOnly, true);
			const baseline = payload.cwd === benchmarkRepo.source;
			const output =
				JSON.stringify({
					hard: {
						outcomes: { completed: true, goal: true },
						gates: {
							verification: true,
							review: true,
							commit: true,
							close: true,
							push: true,
						},
						telemetry: true,
						errors: 0,
					},
					cost: { tokens: baseline ? 200 : 50, retries: 0 },
				}) + (baseline ? " ".repeat(1_000) : "");
			return {
				ok: true,
				output,
				status: {
					state: "complete",
					usage: { totalTokens: baseline ? 200 : 50 },
					steps: [{ status: "complete" }],
				},
			};
		},
	);
	assert.equal(
		agentBenchmarkCalls,
		36,
		"six scenarios run three baseline and candidate samples",
	);
	assert.equal(
		productionBenchmark.passed,
		true,
		JSON.stringify(productionBenchmark),
	);

	const retryRepo = fixture("deferred-retry");
	const retryConsumer = path.join(
		path.dirname(retryRepo.source),
		"retry-consumer",
	);
	mkdirSync(path.join(retryConsumer, ".pi"), { recursive: true });
	writeFileSync(
		path.join(retryConsumer, ".pi", "settings.json"),
		JSON.stringify({
			workResume: { selfImproving: true },
			workImprovement: { sourceCheckout: retryRepo.source },
		}),
	);
	await processTerminalWorkflow(
		retryConsumer,
		{ workflowRunId: "retry-seed", outcome: "failed", reason: "seed failure" },
		{ allowLaunch: false },
	);
	const retryCandidate = [
		...readCandidateState(retryRepo.source).candidates.values(),
	][0];
	const old = Date.now() - 60 * 60 * 1000;
	appendCandidateTransition(
		retryRepo.source,
		retryCandidate.candidateId,
		"claimed",
		{
			attemptId: "old-attempt",
			now: old,
			branch: retryRepo.branch,
			baseHead: git(retryRepo.source, "rev-parse", "HEAD"),
			upstream: `origin/${retryRepo.branch}`,
		},
	);
	appendCandidateTransition(
		retryRepo.source,
		retryCandidate.candidateId,
		"deferred",
		{ attemptId: "old-attempt", now: old, blockerSignature: "dirty-worktree" },
	);
	writeFileSync(path.join(retryRepo.source, "lib.txt"), "still blocked\n");
	const unchangedRetry = await processTerminalWorkflow(
		retryConsumer,
		{ workflowRunId: "retry-unchanged", outcome: "completed" },
		{
			improvementSeams: {
				dispatchAgent: () => assert.fail("unchanged blocker retried"),
			},
		},
	);
	assert.equal(
		unchangedRetry.queued,
		undefined,
		"unchanged blockers are not endlessly retried",
	);
	git(retryRepo.source, "checkout", "--", "lib.txt");
	const changedRetry = await processTerminalWorkflow(
		retryConsumer,
		{ workflowRunId: "retry-cleared", outcome: "completed" },
		{
			improvementSeams: {
				dispatchAgent: async (payload) => {
					if (payload.agent === "workflow-improver") {
						writeFileSync(
							path.join(payload.cwd, "extensions", "work-models.js"),
							"export default 'improved';\n",
						);
						return { ok: true, output: "changed" };
					}
					return { ok: true, output: "Outcome: PASS" };
				},
				runPackageVerify: async () => ({ passed: true }),
				runBenchmarkGate: async () => ({ passed: true }),
			},
		},
	);
	assert.equal(
		changedRetry.queued,
		true,
		"a cleared blocker re-enters wired autonomy after cooldown",
	);
	for (
		let wait = 0;
		wait < 200 &&
		!["accepted", "reverted", "rejected", "manual-recovery"].includes(
			readCandidateState(retryRepo.source).candidates.get(
				retryCandidate.candidateId,
			)?.state,
		);
		wait += 1
	)
		await new Promise((resolveWait) => setTimeout(resolveWait, 10));
	assert.equal(
		readCandidateState(retryRepo.source).candidates.get(
			retryCandidate.candidateId,
		).attempts,
		2,
		"runtime performs exactly one new attempt",
	);

	const claimRepo = fixture("terminal-claim-recovery");
	const claimConsumer = path.join(
		path.dirname(claimRepo.source),
		"claim-consumer",
	);
	mkdirSync(path.join(claimConsumer, ".pi"), { recursive: true });
	writeFileSync(
		path.join(claimConsumer, ".pi", "settings.json"),
		JSON.stringify({
			workResume: { selfImproving: true },
			workImprovement: { sourceCheckout: claimRepo.source },
		}),
	);
	completeWorkflowOnce(
		claimConsumer,
		{ workflowRunId: "crashed-terminal", outcome: "failed" },
		{ mode: "print" },
	);
	assert.equal(
		readCandidateState(claimRepo.source).analyses.size,
		0,
		"output-only completion leaves no source analysis",
	);
	await recoverTerminalWorkflowClaims(claimConsumer, { allowLaunch: false });
	assert.equal(
		readCandidateState(claimRepo.source).analyses.size,
		1,
		"startup scans durable terminal claims",
	);
	completeWorkflowOnce(
		claimConsumer,
		{ workflowRunId: "crashed-terminal", outcome: "failed" },
		{ allowLaunch: false },
	);
	await new Promise((resolveWait) => setTimeout(resolveWait, 20));
	assert.equal(
		readCandidateState(claimRepo.source).analyses.size,
		1,
		"EEXIST safely reruns idempotent analysis exactly once",
	);

	const missingSource = path.join(
		path.dirname(paired.source),
		"missing-source",
	);
	const missing = await runAutonomousImprovement({
		consumerCwd: consumer,
		candidate: { candidateId: "candidate-missing" },
		settings: { workImprovement: { sourceCheckout: missingSource } },
		packageRoot: paired.source,
	});
	assert.equal(missing.state, "deferred");
	assert.equal(missing.reason, "source-unavailable");
	assert.equal(
		existsSync(missingSource),
		false,
		"missing source is not created",
	);
	assert.equal(git(consumer, "rev-parse", "HEAD"), consumerHead);

	const dirty = fixture("autonomous-dirty");
	writeFileSync(path.join(dirty.source, "lib.txt"), "human dirt\n");
	const deferred = await runAutonomousImprovement({
		consumerCwd: consumer,
		candidate: { candidateId: "candidate-dirty" },
		settings: { workImprovement: { sourceCheckout: dirty.source } },
		packageRoot: dirty.source,
	});
	assert.equal(deferred.state, "deferred");
	assert.equal(deferred.reason, "dirty-worktree");
	assert.equal(git(consumer, "rev-parse", "HEAD"), consumerHead);

	appendCandidateTransition(paired.source, "restart-pending", "mutating", {
		attemptId: "attempt-pending",
	});
	appendCandidateTransition(paired.source, "restart-unknown", "push-unknown", {
		attemptId: "attempt-unknown",
	});
	assert.deepEqual(
		(await reconcileAutonomousImprovement(paired.source)).sort(),
		["restart-pending", "restart-unknown"],
	);
	assert.equal(
		readCandidateState(paired.source).candidates.get("restart-pending").state,
		"deferred",
	);
	assert.equal(
		readCandidateState(paired.source).candidates.get("restart-unknown").state,
		"manual-recovery",
	);

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
				data: {
					runId: `run-${artifactCase}`,
					asyncDir: caseAsync,
					outputPath: params.output,
				},
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
