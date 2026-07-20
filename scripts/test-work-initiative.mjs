#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	createWorkItem,
	initStore,
	loadStore,
	saveStore,
	storePath,
	updateWorkItem,
	validateStore,
} from "../extensions/work-store.js";
import {
	INITIATIVE_PROJECTION_VERSION,
	normalizeInitiativeProposal,
	projectInitiativeHierarchy,
} from "../extensions/work-initiatives.js";
import {
	applyInitiativeReconciliation,
	approveInitiativeReconciliation,
	buildInitiativeProjection,
	buildWorkFinishState,
	buildWorkReportState,
	buildWorkResumeState,
	buildWorkRoadmapState,
	buildWorkStatus,
	previewInitiativeReconciliation,
} from "../extensions/work-models.js";

const dir = mkdtempSync(path.join(os.tmpdir(), "ce-initiative-"));
const promotionDir = mkdtempSync(path.join(os.tmpdir(), "ce-promotion-"));
const recoveryDir = mkdtempSync(
	path.join(os.tmpdir(), "ce-promotion-recovery-"),
);
const helperDir = mkdtempSync(path.join(os.tmpdir(), "ce-promotion-helper-"));
const timestamp = "2026-07-19T00:00:00.000Z";
const hash = (value) => createHash("sha256").update(value).digest("hex");
const applyApproved = (cwd, proposal, token, options = {}) =>
	applyInitiativeReconciliation(cwd, proposal, token, {
		...options,
		approval: approveInitiativeReconciliation(cwd, token),
	});
const record = (id, title, extra = {}) => ({
	id,
	type: "epic",
	status: "open",
	title,
	createdAt: timestamp,
	updatedAt: timestamp,
	dependencies: [],
	labels: [],
	notes: [],
	evidence: [],
	dependencyEdges: [],
	...extra,
});

try {
	const initiativeSourceText = "# Initiative intent\n";
	assert.doesNotMatch(
		readFileSync(
			new URL("../extensions/work-initiatives.js", import.meta.url),
			"utf8",
		),
		/from ["'].+work-models\.js["']/,
	);
	const store = initStore(dir, { now: timestamp });
	store.items = {
		"standalone-1": record("standalone-1", "Standalone"),
		"initiative-1": record("initiative-1", "Initiative", {
			labels: ["initiative"],
			initiative: {
				schemaVersion: 1,
				sources: [
					{
						id: "brainstorm-1",
						path: "docs/brainstorms/i.md",
						hash: hash(initiativeSourceText),
					},
				],
				coverage: [
					{
						id: "outcome-1",
						provenance: "brainstorm-1:R1",
						contentHash: "o1",
						disposition: "accepted",
						epicId: "initiative-1.1",
					},
					{
						id: "outcome-2",
						provenance: "brainstorm-1:R2",
						contentHash: "o2",
						disposition: "accepted",
						epicId: "initiative-1.2",
					},
					{
						id: "outcome-3",
						provenance: "brainstorm-1:R3",
						contentHash: "o3",
						disposition: "non_goal",
					},
				],
				evidence: [],
			},
		}),
		"initiative-1.1": record("initiative-1.1", "Delivered child", {
			parentId: "initiative-1",
			status: "closed",
		}),
		"initiative-1.2": record("initiative-1.2", "Next child", {
			parentId: "initiative-1",
			documentLinks: { design: "docs/plans/draft.md" },
		}),
		"initiative-1.2.1": {
			...record("initiative-1.2.1", "Task", {
				parentId: "initiative-1.2",
			}),
			type: "task",
		},
	};
	validateStore(store);
	mkdirSync(path.join(dir, "docs", "brainstorms"), { recursive: true });
	writeFileSync(
		path.join(dir, "docs", "brainstorms", "i.md"),
		initiativeSourceText,
	);
	mkdirSync(path.join(dir, "docs", "plans"), { recursive: true });
	writeFileSync(path.join(dir, "docs", "plans", "draft.md"), "# Draft\n");
	saveStore(dir, store);
	const readiness = {
		"standalone-1": { state: "stale", reason: "Linked plan is missing." },
		"initiative-1.1": {
			state: "planned",
			reason: "Plan is implementation-ready.",
		},
		"initiative-1.2": { state: "needs_plan", reason: "No plan is linked." },
	};
	const projection = projectInitiativeHierarchy(store, readiness);
	assert.equal(projection.schemaVersion, INITIATIVE_PROJECTION_VERSION);
	assert.deepEqual(projection.roots, ["initiative-1", "standalone-1"]);
	assert.deepEqual(
		projection.nodes.map((node) => node.id),
		["initiative-1", "initiative-1.1", "initiative-1.2", "standalone-1"],
	);
	const initiative = projection.nodes[0];
	assert.equal(initiative.role, "initiative");
	assert.deepEqual(initiative.children, ["initiative-1.1", "initiative-1.2"]);
	assert.deepEqual(initiative.aggregateProgress, {
		closed: 1,
		total: 2,
		percent: 50,
	});
	assert.equal(initiative.readiness.state, "aggregate");
	assert(!initiative.legalActions.includes("resume"));
	assert(!initiative.legalActions.includes("finish"));
	const next = projection.nodes.find((node) => node.id === "initiative-1.2");
	assert.equal(next.role, "child_epic");
	assert.equal(next.readiness.state, "needs_plan");
	assert.equal(next.readiness.implementationReady, false);
	assert.deepEqual(next.localProgress, { closed: 0, total: 1, percent: 0 });
	assert(!projection.nodes.some((node) => node.id === "initiative-1.2.1"));
	const standalone = projection.nodes.at(-1);
	assert.equal(standalone.role, "standalone_epic");
	assert.equal(standalone.readiness.state, "stale");
	assert.deepEqual(
		buildInitiativeProjection(dir, readiness),
		projection,
		"work-models adapter must expose the exact domain projection",
	);
	const draftReadiness = buildInitiativeProjection(dir).nodes.find(
		(node) => node.id === "initiative-1.2",
	).readiness;
	assert.equal(draftReadiness.state, "stale");
	assert.equal(draftReadiness.implementationReady, false);
	const status = buildWorkStatus(dir, "initiative-1");
	assert.match(status, /Initiative: Initiative/);
	assert.match(status, /1\/2 child roadmaps closed \(50%\)/);
	const report = buildWorkReportState(dir, "initiative-1");
	assert.equal(report.initiative, true);
	assert.deepEqual(report.aggregateProgress, {
		closed: 1,
		total: 2,
		percent: 50,
	});
	assert.deepEqual(
		report.children.map((child) => child.id),
		["initiative-1.1", "initiative-1.2"],
	);
	const resume = buildWorkResumeState(dir, "initiative-1");
	assert.equal(resume.epic.id, "initiative-1.2");
	assert.equal(resume.initiative.id, "initiative-1");
	const finish = buildWorkFinishState(dir, "initiative-1");
	assert.equal(finish.reason, "initiative-not-executable");
	mkdirSync(path.join(dir, ".pi"), { recursive: true });
	writeFileSync(
		path.join(dir, ".pi", "work-orchestrator-state.json"),
		JSON.stringify({ lastEpicId: "initiative-1" }),
	);
	const current = buildWorkRoadmapState(dir, "list");
	assert.equal(current.currentId, "initiative-1.2");
	assert.equal(
		current.roadmaps.find((item) => item.current)?.role,
		"child_epic",
	);
	const ambiguousStore = loadStore(dir);
	ambiguousStore.items["initiative-1.3"] = record(
		"initiative-1.3",
		"Another child",
		{ parentId: "initiative-1" },
	);
	ambiguousStore.items["initiative-1"].initiative.coverage.push({
		id: "outcome-4",
		provenance: "brainstorm-1:R4",
		contentHash: "o4",
		disposition: "accepted",
		epicId: "initiative-1.3",
	});
	saveStore(dir, ambiguousStore);
	const ambiguousCurrent = buildWorkRoadmapState(dir, "list");
	assert.equal(ambiguousCurrent.currentId, undefined);
	assert(!ambiguousCurrent.roadmaps.some((item) => item.current));
	assert.equal(
		buildWorkResumeState(dir, "initiative-1").reason,
		"initiative-child-selection",
	);
	const helper = path.resolve("scripts/work-helper.mjs");
	assert.deepEqual(
		JSON.parse(
			execFileSync(process.execPath, [helper, "initiative-summary"], {
				cwd: dir,
				encoding: "utf8",
			}),
		),
		buildInitiativeProjection(dir),
		"helper hierarchy must equal the shared F7 projection",
	);
	const staleInitiative = loadStore(dir);
	for (const child of Object.values(staleInitiative.items).filter(
		(item) => item.parentId === "initiative-1" && item.type === "epic",
	))
		child.status = "closed";
	saveStore(dir, staleInitiative);
	writeFileSync(
		path.join(dir, "docs", "brainstorms", "i.md"),
		`${initiativeSourceText}changed\n`,
	);
	const staleClose = buildWorkRoadmapState(dir, "close initiative-1 --force");
	assert.equal(staleClose.action, "initiative-close-blocked");
	assert(staleClose.blockers.includes("stale_source:docs/brainstorms/i.md"));
	rmSync(path.join(dir, "docs", "brainstorms", "i.md"));
	const missingClose = buildWorkRoadmapState(dir, "close initiative-1 --force");
	assert.equal(missingClose.action, "initiative-close-blocked");
	assert(
		missingClose.blockers.includes("missing_source:docs/brainstorms/i.md"),
	);

	// Preview is pure; apply is identity-preserving, stale-safe, and idempotent.
	const promotionStore = initStore(promotionDir, { now: timestamp });
	createWorkItem(promotionStore, {
		id: "E-1",
		type: "epic",
		title: "Existing scope",
		notes: ["history"],
		evidence: [{ verification: "PASS" }],
		documentLinks: [{ path: "docs/plans/existing.md" }],
		now: timestamp,
	});
	createWorkItem(promotionStore, {
		id: "E-1.1",
		type: "task",
		title: "Existing task",
		parentId: "E-1",
		now: timestamp,
	});
	saveStore(promotionDir, promotionStore);
	mkdirSync(path.join(promotionDir, "docs", "brainstorms"), {
		recursive: true,
	});
	const sourcePath = "docs/brainstorms/broad.md";
	const sourceText = "# Broad intent\n\nR1 and R2\n";
	writeFileSync(path.join(promotionDir, sourcePath), sourceText);
	const proposal = {
		schemaVersion: 1,
		targetId: "E-1",
		initiative: { id: "I-1", title: "Broad initiative" },
		sources: [{ id: "brainstorm-1", path: sourcePath, hash: hash(sourceText) }],
		groups: [
			{ id: "scope-1", title: "Existing scope", epicId: "E-1" },
			{ id: "scope-2", title: "Successor scope", description: "Later" },
		],
		outcomes: [
			{
				id: "outcome-1",
				provenance: "brainstorm-1:R1",
				contentHash: hash("R1"),
				disposition: "accepted",
				groupId: "scope-1",
			},
			{
				id: "outcome-2",
				provenance: "brainstorm-1:R2",
				contentHash: hash("R2"),
				disposition: "accepted",
				groupId: "scope-2",
			},
			{
				id: "outcome-2b",
				provenance: "brainstorm-1:R2b",
				contentHash: hash("R2b"),
				disposition: "accepted",
				groupId: "scope-1",
			},
			{
				id: "outcome-3",
				provenance: "brainstorm-1:R3",
				contentHash: hash("R3"),
				disposition: "non_goal",
			},
		],
	};
	assert.deepEqual(
		normalizeInitiativeProposal(proposal).groups.map((x) => x.id),
		["scope-1", "scope-2"],
	);
	assert.throws(
		() =>
			normalizeInitiativeProposal({
				...proposal,
				outcomes: [
					proposal.outcomes[0],
					{ ...proposal.outcomes[0], id: "duplicate" },
				],
			}),
		(error) => error.code === "ambiguous_lineage",
	);
	assert.throws(
		() =>
			normalizeInitiativeProposal({
				...proposal,
				outcomes: proposal.outcomes.filter(
					(outcome) => outcome.groupId !== "scope-2",
				),
			}),
		(error) => error.code === "incomplete_coverage",
	);
	const beforePreview = readFileSync(storePath(promotionDir), "utf8");
	const preview = previewInitiativeReconciliation(promotionDir, proposal);
	const retryPreview = previewInitiativeReconciliation(promotionDir, proposal);
	assert.equal(readFileSync(storePath(promotionDir), "utf8"), beforePreview);
	assert.equal(preview.noop, false);
	assert.deepEqual(retryPreview.proposed, preview.proposed);
	assert.deepEqual(retryPreview.operations, preview.operations);
	assert.notEqual(retryPreview.token, preview.token);
	assert.equal(preview.proposed.coverage.length, proposal.outcomes.length);
	assert.deepEqual(
		preview.operations.map((operation) => operation.kind),
		["create_initiative", "reparent_epic", "create_epic", "set_disposition"],
	);

	writeFileSync(path.join(promotionDir, sourcePath), `${sourceText}changed\n`);
	assert.throws(
		() => applyApproved(promotionDir, proposal, preview.token),
		/stale source/i,
	);
	writeFileSync(path.join(promotionDir, sourcePath), sourceText);
	assert.throws(
		() =>
			applyApproved(
				promotionDir,
				{
					...proposal,
					initiative: { ...proposal.initiative, title: "Changed" },
				},
				preview.token,
			),
		/stale proposal/i,
	);
	const drifted = loadStore(promotionDir);
	updateWorkItem(drifted, "E-1", { notes: ["drift"], now: timestamp });
	saveStore(promotionDir, drifted);
	assert.throws(
		() => applyApproved(promotionDir, proposal, preview.token),
		/stale store/i,
	);
	writeFileSync(storePath(promotionDir), beforePreview);
	assert.throws(
		() => applyInitiativeReconciliation(promotionDir, proposal, preview.token),
		/approval/i,
	);
	const applied = applyApproved(promotionDir, proposal, preview.token);
	assert.equal(applied.changed, true);
	const promoted = loadStore(promotionDir);
	assert.equal(promoted.items["E-1"].parentId, "I-1");
	assert.deepEqual(promoted.items["E-1"].documentLinks, [
		{ path: "docs/plans/existing.md" },
	]);
	assert.deepEqual(promoted.items["E-1"].evidence, [{ verification: "PASS" }]);
	assert.equal(promoted.items["I-1.1"].parentId, "I-1");
	const omittedOutcome = previewInitiativeReconciliation(promotionDir, {
		...proposal,
		outcomes: proposal.outcomes.filter((outcome) => outcome.id !== "outcome-3"),
	});
	assert.deepEqual(omittedOutcome.conflicts, [
		{ kind: "missing_outcome", outcomeId: "outcome-3" },
	]);
	const changedIdentity = previewInitiativeReconciliation(promotionDir, {
		...proposal,
		outcomes: proposal.outcomes.map((outcome) =>
			outcome.id === "outcome-1"
				? { ...outcome, contentHash: "changed" }
				: outcome,
		),
	});
	assert.deepEqual(changedIdentity.conflicts, [
		{ kind: "outcome_identity", outcomeId: "outcome-1" },
	]);
	const beforeIdentityConflict = readFileSync(storePath(promotionDir), "utf8");
	assert.throws(
		() =>
			applyApproved(
				promotionDir,
				{
					...proposal,
					outcomes: proposal.outcomes.map((outcome) =>
						outcome.id === "outcome-1"
							? { ...outcome, contentHash: "changed" }
							: outcome,
					),
				},
				changedIdentity.token,
			),
		(error) => error.code === "protected_field_conflict",
	);
	assert.equal(
		readFileSync(storePath(promotionDir), "utf8"),
		beforeIdentityConflict,
	);
	assert.throws(
		() => applyApproved(promotionDir, proposal, preview.token),
		/replayed|stale store/i,
	);
	const noopPreview = previewInitiativeReconciliation(promotionDir, proposal);
	assert.equal(noopPreview.noop, true);
	const beforeNoop = readFileSync(storePath(promotionDir), "utf8");
	assert.equal(
		applyApproved(promotionDir, proposal, noopPreview.token).changed,
		false,
	);
	assert.equal(readFileSync(storePath(promotionDir), "utf8"), beforeNoop);
	assert.throws(
		() => applyApproved(promotionDir, proposal, noopPreview.token),
		/replayed/i,
	);
	const manual = loadStore(promotionDir);
	manual.items["I-1.1"].title = "Manual title";
	saveStore(promotionDir, manual);
	const conflictPreview = previewInitiativeReconciliation(
		promotionDir,
		proposal,
	);
	assert.deepEqual(conflictPreview.conflicts, [
		{ kind: "manual_field", epicId: "I-1.1", field: "title" },
	]);
	assert.throws(
		() => applyApproved(promotionDir, proposal, conflictPreview.token),
		(error) => error.code === "protected_field_conflict",
	);

	// Candidate interruption leaves the complete old graph recoverable.
	mkdirSync(path.dirname(storePath(recoveryDir)), { recursive: true });
	writeFileSync(storePath(recoveryDir), beforePreview);
	mkdirSync(path.join(recoveryDir, "docs", "brainstorms"), { recursive: true });
	writeFileSync(path.join(recoveryDir, sourcePath), sourceText);
	const recoveryPreview = previewInitiativeReconciliation(
		recoveryDir,
		proposal,
	);
	assert.throws(() =>
		applyApproved(recoveryDir, proposal, recoveryPreview.token, {
			interruptAt: "candidate",
		}),
	);
	assert.equal(loadStore(recoveryDir).items["I-1"], undefined);
	assert.equal(loadStore(recoveryDir).items["E-1"].parentId, undefined);
	assert.equal(
		applyApproved(recoveryDir, proposal, recoveryPreview.token).changed,
		true,
	);
	assert.equal(
		loadStore(recoveryDir).items["I-1"].initiative.evidence.length,
		1,
	);

	writeFileSync(storePath(recoveryDir), beforePreview);
	const replacePreview = previewInitiativeReconciliation(recoveryDir, proposal);
	assert.throws(() =>
		applyApproved(recoveryDir, proposal, replacePreview.token, {
			interruptAt: "replace",
		}),
	);
	const recovered = applyApproved(recoveryDir, proposal, replacePreview.token);
	assert.equal(recovered.recovered, true);
	assert.equal(loadStore(recoveryDir).items["I-1"].parentId, undefined);

	// Helper preview/apply works across processes and enforces approval/replay.
	mkdirSync(path.dirname(storePath(helperDir)), { recursive: true });
	writeFileSync(storePath(helperDir), beforePreview);
	mkdirSync(path.join(helperDir, "docs", "brainstorms"), { recursive: true });
	writeFileSync(path.join(helperDir, sourcePath), sourceText);
	const proposalJson = JSON.stringify(proposal);
	const helperBefore = readFileSync(storePath(helperDir), "utf8");
	const helperPreview = JSON.parse(
		execFileSync(
			process.execPath,
			[helper, "initiative-preview", "--proposal-json", proposalJson],
			{
				cwd: helperDir,
				encoding: "utf8",
			},
		),
	);
	assert.equal(readFileSync(storePath(helperDir), "utf8"), helperBefore);
	let missingApproval;
	try {
		execFileSync(
			process.execPath,
			[
				helper,
				"initiative-apply",
				"--proposal-json",
				proposalJson,
				"--token",
				helperPreview.token,
			],
			{ cwd: helperDir, encoding: "utf8" },
		);
	} catch (error) {
		missingApproval = JSON.parse(error.stdout);
	}
	assert.equal(missingApproval.status, "FAIL");
	let selfAssertedApproval;
	try {
		execFileSync(
			process.execPath,
			[
				helper,
				"initiative-apply",
				"--proposal-json",
				proposalJson,
				"--token",
				helperPreview.token,
				"--approved",
			],
			{ cwd: helperDir, encoding: "utf8" },
		);
	} catch (error) {
		selfAssertedApproval = JSON.parse(error.stdout);
	}
	assert.equal(selfAssertedApproval.status, "FAIL");
	const helperApproval = approveInitiativeReconciliation(
		helperDir,
		helperPreview.token,
	);
	const helperApplied = JSON.parse(
		execFileSync(
			process.execPath,
			[
				helper,
				"initiative-apply",
				"--proposal-json",
				proposalJson,
				"--token",
				helperPreview.token,
				"--approval",
				helperApproval,
			],
			{ cwd: helperDir, encoding: "utf8" },
		),
	);
	assert.equal(helperApplied.changed, true);
	assert(loadStore(helperDir).items["I-1"]);
	let unsafeClose;
	try {
		execFileSync(process.execPath, [helper, "work-close", "I-1"], {
			cwd: helperDir,
			encoding: "utf8",
		});
	} catch (error) {
		unsafeClose = JSON.parse(error.stdout);
	}
	assert.match(unsafeClose.error, /guarded close/i);
	assert.equal(loadStore(helperDir).items["I-1"].status, "open");
	let unsafeFinish;
	try {
		execFileSync(
			process.execPath,
			[
				helper,
				"finish-task",
				"I-1",
				"--max-files",
				"1",
				"--message",
				"unsafe",
				"--verify",
				"ignored",
			],
			{ cwd: helperDir, encoding: "utf8" },
		);
	} catch (error) {
		unsafeFinish = JSON.parse(error.stdout);
	}
	assert.match(unsafeFinish.error, /guarded close/i);
	assert.equal(loadStore(helperDir).items["I-1"].status, "open");
	console.log("work initiative tests passed");
} finally {
	for (const target of [dir, promotionDir, recoveryDir, helperDir])
		rmSync(target, { recursive: true, force: true });
}
