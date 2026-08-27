import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
	acquireVerifierLock,
	addFinding,
	analysisReviewProjection,
	claimAnalysisReview,
	createBatch,
	disposeAnalysisReview,
	ingestAnalysisReview,
	initVerifierStore,
	loadVerifierStore,
	mutateVerifierStore,
	recordOperationResult,
	saveAnalysisReviewProposal,
} from "../extensions/background-verifiers.js";
import {
	materializeVerifierAnalysis,
	reconcileAnalysisFinalizations,
	reconcileLegacyAnalysisTasks,
	validateAnalysisFinalizationInput,
} from "../extensions/work-models.js";
import {
	createWorkItem,
	loadStore,
	mutateStore,
} from "../extensions/work-store.js";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";

const cwd = mkdtempSync(path.join(tmpdir(), "ce-analysis-review-"));
try {
	const git = (...args) =>
		execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
	git("init", "-q");
	git("config", "user.email", "test@example.test");
	git("config", "user.name", "Test");
	mkdirSync(path.join(cwd, "src"));
	writeFileSync(path.join(cwd, "src/a.js"), "export const value = 1;\n");
	git("add", "src/a.js");
	git("commit", "-qm", "base");
	const base = git("rev-parse", "HEAD");
	writeFileSync(path.join(cwd, "src/a.js"), "export const value = 2;\n");
	git("add", "src/a.js");
	git("commit", "-qm", "snapshot");
	const snapshot = git("rev-parse", "HEAD");
	initVerifierStore(cwd, { now: "2026-01-01T00:00:00.000Z" });
	const checkpoint = {
		repository: "fixture",
		base,
		snapshot,
		paths: ["src/a.js"],
		patchHash: "c".repeat(64),
	};
	const batch = mutateVerifierStore(cwd, (store) =>
		createBatch(store, {
			checkpoint,
			purpose: "analysis",
			profiles: [
				{
					model: "fixture/model",
					operations: ["correctness"],
					thinking: "low",
				},
			],
			now: "2026-01-01T00:00:00.000Z",
		}),
	);
	const job = mutateVerifierStore(cwd, (store) =>
		Object.values(store.jobs).find((value) => value.batchId === batch.id),
	);
	const report = mutateVerifierStore(cwd, (store) =>
		recordOperationResult(store, {
			jobId: job.id,
			operation: "correctness",
			outcome: "findings",
			now: "2026-01-01T00:00:01.000Z",
		}),
	);
	const finding = mutateVerifierStore(cwd, (store) =>
		addFinding(store, {
			reportId: report.id,
			operation: "correctness",
			model: job.model,
			checkpoint,
			path: "src/a.js",
			startLine: 1,
			endLine: 1,
			category: "correctness",
			severity: "high",
			rationale: "Identity is ambiguous.",
			evidence: "src/a.js:1",
			suggestedAction: "Choose identity semantics.",
			now: "2026-01-01T00:00:02.000Z",
		}),
	);
	const addAnalysisSource = (model, timestamp) => {
		const sourceBatch = mutateVerifierStore(cwd, (store) =>
			createBatch(store, {
				checkpoint,
				purpose: "analysis",
				profiles: [{ model, operations: ["correctness"], thinking: "low" }],
				now: timestamp,
			}),
		);
		const sourceJob = Object.values(loadVerifierStore(cwd).jobs).find(
			(value) => value.batchId === sourceBatch.id,
		);
		const sourceReport = mutateVerifierStore(cwd, (store) =>
			recordOperationResult(store, {
				jobId: sourceJob.id,
				operation: "correctness",
				outcome: "findings",
				now: timestamp,
			}),
		);
		const sourceFinding = mutateVerifierStore(cwd, (store) =>
			addFinding(store, {
				reportId: sourceReport.id,
				operation: "correctness",
				model,
				checkpoint,
				path: "src/a.js",
				startLine: 1,
				endLine: 1,
				category: "correctness",
				severity: "high",
				rationale: "Identity is ambiguous.",
				evidence: "src/a.js:1",
				suggestedAction: "Choose identity semantics.",
				now: timestamp,
			}),
		);
		return { batch: sourceBatch, finding: sourceFinding };
	};
	const candidates = ["accepted", "rejected"].map((verdict) => ({
		sourceFindingId: finding.id,
		verdict,
		title: `${verdict} identity option`,
		rationale: "Both options depend on public identity semantics.",
		evidence: "src/a.js:1",
		recommendation:
			verdict === "accepted" ? "Use a private key." : "Change equality.",
		decisionKey: "tag-identity",
	}));
	const contention = acquireVerifierLock(cwd);
	try {
		assert.throws(
			() =>
				materializeVerifierAnalysis(cwd, {
					batchIds: [batch.id],
					markdown: JSON.stringify({ candidates }),
					reportPath: path.join(cwd, "analysis.md"),
				}),
			(error) => error?.category === "locked",
		);
	} finally {
		contention.release();
	}
	assert.notEqual(
		loadVerifierStore(cwd).batches[batch.id].analysisIngestionStatus,
		"failed",
		"lock contention remains retryable instead of being classified as malformed synthesis",
	);
	const first = mutateVerifierStore(cwd, (store) =>
		ingestAnalysisReview(store, {
			batchId: batch.id,
			candidates,
			decisions: { "tag-identity": "What does tag identity mean?" },
			now: "2026-01-01T00:00:03.000Z",
		}),
	);
	const repeated = mutateVerifierStore(cwd, (store) =>
		ingestAnalysisReview(store, {
			batchId: batch.id,
			candidates,
			decisions: { "tag-identity": "What does tag identity mean?" },
			now: "2026-01-01T00:00:04.000Z",
		}),
	);
	assert.equal(first.length, 1);
	assert.equal(first[0].id, repeated[0].id);
	assert.deepEqual(first[0].candidateIds, repeated[0].candidateIds);
	assert.deepEqual(
		analysisReviewProjection(
			await import("../extensions/background-verifiers.js").then(
				({ loadVerifierStore }) => loadVerifierStore(cwd),
			),
		)[0]
			.candidates.map((value) => value.verdict)
			.sort(),
		["accepted", "rejected"],
	);
	const claimed = mutateVerifierStore(cwd, (store) =>
		claimAnalysisReview(store, {
			groupId: first[0].id,
			ownerSession: "human-session",
			now: "2026-01-01T00:00:05.000Z",
		}),
	);
	const saved = mutateVerifierStore(cwd, (store) =>
		saveAnalysisReviewProposal(store, {
			groupId: claimed.id,
			revision: claimed.revision,
			ownerSession: "human-session",
			proposal: {
				resolution: "Use private identity.",
				tasks: [{ title: "Add private key" }],
			},
			now: "2026-01-01T00:00:06.000Z",
		}),
	);
	assert.ok(saved.proposalDigest);
	assert.equal(saved.state, "proposal_ready");
	const reclaimed = mutateVerifierStore(cwd, (store) =>
		claimAnalysisReview(store, {
			groupId: saved.id,
			ownerSession: "new-human-session",
			now: "2026-01-01T00:20:00.000Z",
		}),
	);
	assert.equal(reclaimed.state, "proposal_ready");
	assert.equal(reclaimed.proposalDigest, saved.proposalDigest);
	assert.equal(reclaimed.lease.ownerSession, "new-human-session");
	const disposedFixture = structuredClone(reclaimed);
	const disposed = mutateVerifierStore(cwd, (store) =>
		disposeAnalysisReview(store, {
			groupId: reclaimed.id,
			revision: reclaimed.revision,
			ownerSession: "new-human-session",
			disposition: "deferred",
			reason: "Regression guard",
			now: "2026-01-01T00:20:01.000Z",
		}),
	);
	assert.equal(disposed.state, "deferred");
	mutateVerifierStore(cwd, (store) => {
		store.analysisReviewGroups[saved.id] = disposedFixture;
	});
	const currentSaved = loadVerifierStore(cwd).analysisReviewGroups[saved.id];
	assert.equal(
		validateAnalysisFinalizationInput(currentSaved, {
			revision: currentSaved.revision,
			proposalDigest: currentSaved.proposalDigest,
		}),
		true,
	);
	for (const stale of [
		{
			revision: currentSaved.revision - 1,
			proposalDigest: currentSaved.proposalDigest,
		},
		{ revision: currentSaved.revision, proposalDigest: "stale-digest" },
		{ revision: currentSaved.revision, proposalDigest: undefined },
	])
		assert.throws(
			() => validateAnalysisFinalizationInput(currentSaved, stale),
			/stale-analysis-review/,
		);

	const finalizationId = "analysis-finalization-fixture";
	mutateVerifierStore(cwd, (store) => {
		const group = store.analysisReviewGroups[saved.id];
		group.state = "finalization_pending";
		store.analysisFinalizations[finalizationId] = {
			id: finalizationId,
			groupId: saved.id,
			groupRevision: currentSaved.revision,
			proposalDigest: currentSaved.proposalDigest,
			tasks: [
				{ title: "Add private key" },
				{ title: "Use private key", description: "Use it for deduplication." },
			],
			status: "pending",
			createdAt: "2026-01-01T00:00:07.000Z",
		};
	});
	assert.equal(
		analysisReviewProjection(loadVerifierStore(cwd))[0].state,
		"finalization_pending",
	);
	const finalized = reconcileAnalysisFinalizations(cwd);
	assert.equal(finalized.length, 2);
	assert.deepEqual(reconcileAnalysisFinalizations(cwd), []);
	const finalStore = loadVerifierStore(cwd);
	assert.equal(finalStore.analysisReviewGroups[saved.id].state, "finalized");
	assert.equal(
		finalStore.analysisFinalizations[finalizationId].taskIds.length,
		2,
	);
	const repeatedSource = addAnalysisSource(
		"fixture/repeated-model",
		"2026-01-01T00:00:07.100Z",
	);
	const repeatedTerminal = mutateVerifierStore(cwd, (store) =>
		ingestAnalysisReview(store, {
			batchId: repeatedSource.batch.id,
			candidates: candidates.map((candidate) => ({
				...candidate,
				sourceFindingId: repeatedSource.finding.id,
			})),
			now: "2026-01-01T00:00:07.200Z",
		}),
	)[0];
	assert.equal(repeatedTerminal.id, saved.id);
	assert.deepEqual(repeatedTerminal.batchIds, [batch.id, repeatedSource.batch.id].sort());
	const conflictSource = addAnalysisSource(
		"fixture/conflict-model",
		"2026-01-01T00:00:07.300Z",
	);
	const explicitConflict = mutateVerifierStore(cwd, (store) =>
		ingestAnalysisReview(store, {
			batchId: conflictSource.batch.id,
			candidates: candidates.map((candidate) => ({
				...candidate,
				sourceFindingId: conflictSource.finding.id,
				title: `Revised ${candidate.title}`,
			})),
			conflicts: { "tag-identity": saved.id },
			now: "2026-01-01T00:00:07.400Z",
		}),
	)[0];
	assert.equal(explicitConflict.state, "revisit_pending");
	assert.equal(explicitConflict.terminalConflictId, saved.id);
	let finalizedTasks = Object.values(loadStore(cwd).items).filter((item) =>
		item.labels?.includes(`wo:analysis-finalization:${finalizationId}`),
	);
	assert.equal(finalizedTasks.length, 2);
	mutateStore(cwd, (store) => {
		for (const task of finalizedTasks) delete store.items[task.id];
	});
	writeFileSync(path.join(cwd, "src/a.js"), "export const value = 3;\n");
	mutateVerifierStore(cwd, (store) => {
		store.analysisFinalizations[finalizationId].status = "pending";
		store.analysisReviewGroups[saved.id].state = "finalization_pending";
	});
	assert.throws(
		() => reconcileAnalysisFinalizations(cwd),
		/stale-analysis-evidence/,
	);
	const recoveryStore = loadVerifierStore(cwd);
	assert.equal(
		recoveryStore.analysisFinalizations[finalizationId].status,
		"blocked",
	);
	assert.equal(recoveryStore.analysisReviewGroups[saved.id].state, "blocked");
	assert.equal(
		Object.values(loadStore(cwd).items).filter((item) =>
			item.labels?.includes(`wo:analysis-finalization:${finalizationId}`),
		).length,
		0,
		"stale recovery creates no tasks",
	);
	git("checkout", "--", "src/a.js");
	mutateVerifierStore(cwd, (store) => {
		store.analysisFinalizations[finalizationId].status = "pending";
		store.analysisReviewGroups[saved.id].state = "finalization_pending";
	});
	assert.equal(reconcileAnalysisFinalizations(cwd).length, 2);
	finalizedTasks = Object.values(loadStore(cwd).items).filter((item) =>
		item.labels?.includes(`wo:analysis-finalization:${finalizationId}`),
	);

	mutateStore(cwd, (store) => {
		for (const status of ["open", "blocked", "planned", "in_progress"])
			createWorkItem(store, {
				title: `Legacy ${status}`,
				type: "task",
				status,
				labels: ["wo:analysis"],
			});
	});
	assert.equal(reconcileLegacyAnalysisTasks(cwd).length, 4);
	const migratedWork = loadStore(cwd);
	const migrations = loadVerifierStore(cwd).analysisLegacyMigrations;
	const blockedLegacy = Object.values(migratedWork.items).find(
		(item) => item.title === "Legacy in_progress",
	);
	for (const item of Object.values(migratedWork.items).filter(
		(item) =>
			item.labels?.includes("wo:analysis") &&
			!item.labels.some((label) =>
				label.startsWith("wo:analysis-finalization:"),
			),
	)) {
		assert.ok(migrations[item.id].snapshot);
		assert.equal(
			migrations[item.id].status,
			item.title === "Legacy in_progress" ? "blocked" : "completed",
		);
		assert.equal(
			item.status,
			item.title === "Legacy in_progress" ? "in_progress" : "closed",
		);
	}
	mutateVerifierStore(cwd, (store) => {
		store.batches[batch.id].analysisIngestionStatus = "failed";
		store.batches[batch.id].analysisIngestionFailure = "invalid synthesis";
		const artifact = { bytes: 0, path: "private" };
		const reason = "invalid";
		const quarantineId = `quarantine-${createHash("sha256")
			.update(JSON.stringify({ artifact, jobId: job.id, reason }))
			.digest("hex")
			.slice(0, 24)}`;
		store.quarantines[quarantineId] = {
			id: quarantineId,
			jobId: job.id,
			artifact,
			reason,
			createdAt: "2026-01-01T00:00:08.000Z",
		};
	});
	const statuses = analysisReviewProjection(loadVerifierStore(cwd)).filter(
		(entry) => entry.readOnly,
	);
	assert.deepEqual([...new Set(statuses.map((entry) => entry.state))].sort(), [
		"ingestion_failed",
		"migration_blocked",
		"quarantined",
	]);
	assert.ok(
		statuses.every(
			(entry) =>
				!entry.allowedActions.some((action) =>
					["finalize", "defer", "reject"].includes(action),
				),
		),
		"read-only analysis errors never expose terminal actions",
	);

	mutateStore(cwd, (store) => {
		const current = store.items[blockedLegacy.id];
		current.status = "closed";
		current.closedAt = "2026-01-01T00:00:09.000Z";
		current.updatedAt = current.closedAt;
	});
	assert.deepEqual(reconcileLegacyAnalysisTasks(cwd), [blockedLegacy.id]);
	const resolvedMigration =
		loadVerifierStore(cwd).analysisLegacyMigrations[blockedLegacy.id];
	assert.equal(resolvedMigration.status, "completed");
	assert.equal(resolvedMigration.resolution, "source-work-item-closed");
	assert.ok(resolvedMigration.completedAt);
	assert.ok(
		!analysisReviewProjection(loadVerifierStore(cwd)).some(
			(entry) => entry.workItemId === blockedLegacy.id,
		),
		"closing an in-progress legacy task clears its durable migration gate",
	);
	assert.deepEqual(
		reconcileLegacyAnalysisTasks(cwd),
		[],
		"closed legacy migration reconciliation is idempotent",
	);

	mutateStore(cwd, (store) => {
		store.items[finalizedTasks[0].id].title = "colliding manual payload";
	});
	mutateVerifierStore(cwd, (store) => {
		store.analysisFinalizations[finalizationId].status = "pending";
		store.analysisReviewGroups[saved.id].state = "finalization_pending";
	});
	assert.throws(
		() => reconcileAnalysisFinalizations(cwd),
		/blocked-analysis-finalization/,
	);
	assert.equal(
		loadVerifierStore(cwd).analysisFinalizations[finalizationId].status,
		"blocked",
	);
	mutateStore(cwd, (store) => {
		store.items[finalizedTasks[0].id].title = "Add private key";
		createWorkItem(store, {
			title: "Unexpected recovered ordinal",
			type: "task",
			parentId: finalizedTasks[0].parentId,
			labels: [
				"wo:analysis",
				`wo:analysis-finalization:${finalizationId}`,
				"wo:analysis-ordinal:9999",
			],
		});
	});
	mutateVerifierStore(cwd, (store) => {
		store.analysisFinalizations[finalizationId].status = "pending";
		store.analysisReviewGroups[saved.id].state = "finalization_pending";
	});
	assert.throws(
		() => reconcileAnalysisFinalizations(cwd),
		/blocked-analysis-finalization/,
		"unexpected finalization ordinals block recovery",
	);
	assert.equal(
		loadVerifierStore(cwd).analysisFinalizations[finalizationId].status,
		"blocked",
	);
	process.stdout.write("analysis review lifecycle tests passed\n");
} finally {
	rmSync(cwd, { recursive: true, force: true });
}
