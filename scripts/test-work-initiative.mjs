#!/usr/bin/env node
import assert from "node:assert/strict";
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
const recoveryDir = mkdtempSync(path.join(os.tmpdir(), "ce-promotion-recovery-"));
const timestamp = "2026-07-19T00:00:00.000Z";
const hash = (value) => createHash("sha256").update(value).digest("hex");
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
	assert.doesNotMatch(
		readFileSync(new URL("../extensions/work-initiatives.js", import.meta.url), "utf8"),
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
					{ id: "brainstorm-1", path: "docs/brainstorms/i.md", hash: "s1" },
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
		}),
		"initiative-1.2.1": {
			...record("initiative-1.2.1", "Task", {
				parentId: "initiative-1.2",
			}),
			type: "task",
		},
	};
	validateStore(store);
	saveStore(dir, store);
	const readiness = {
		"standalone-1": { state: "stale", reason: "Linked plan is missing." },
		"initiative-1.1": { state: "planned", reason: "Plan is implementation-ready." },
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
	const status = buildWorkStatus(dir, "initiative-1");
	assert.match(status, /Initiative: Initiative/);
	assert.match(status, /1\/2 child epics closed \(50%\)/);
	const report = buildWorkReportState(dir, "initiative-1");
	assert.equal(report.initiative, true);
	assert.deepEqual(report.aggregateProgress, { closed: 1, total: 2, percent: 50 });
	assert.deepEqual(report.children.map((child) => child.id), [
		"initiative-1.1",
		"initiative-1.2",
	]);
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
	assert.equal(current.roadmaps.find((item) => item.current)?.role, "child_epic");
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
	mkdirSync(path.join(promotionDir, "docs", "brainstorms"), { recursive: true });
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
	assert.deepEqual(normalizeInitiativeProposal(proposal).groups.map((x) => x.id), [
		"scope-1",
		"scope-2",
	]);
	assert.throws(
		() =>
			normalizeInitiativeProposal({
				...proposal,
				outcomes: [proposal.outcomes[0], { ...proposal.outcomes[0], id: "duplicate" }],
			}),
		(error) => error.code === "ambiguous_lineage",
	);
	assert.throws(
		() =>
			normalizeInitiativeProposal({
				...proposal,
				outcomes: proposal.outcomes.filter((outcome) => outcome.groupId !== "scope-2"),
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
		() => applyInitiativeReconciliation(promotionDir, proposal, preview.token, { approved: true }),
		/stale source/i,
	);
	writeFileSync(path.join(promotionDir, sourcePath), sourceText);
	assert.throws(
		() =>
			applyInitiativeReconciliation(
				promotionDir,
				{ ...proposal, initiative: { ...proposal.initiative, title: "Changed" } },
				preview.token,
				{ approved: true },
			),
		/stale proposal/i,
	);
	const drifted = loadStore(promotionDir);
	updateWorkItem(drifted, "E-1", { notes: ["drift"], now: timestamp });
	saveStore(promotionDir, drifted);
	assert.throws(
		() => applyInitiativeReconciliation(promotionDir, proposal, preview.token, { approved: true }),
		/stale store/i,
	);
	writeFileSync(storePath(promotionDir), beforePreview);
	assert.throws(
		() => applyInitiativeReconciliation(promotionDir, proposal, preview.token),
		/approval/i,
	);
	const applied = applyInitiativeReconciliation(
		promotionDir,
		proposal,
		preview.token,
		{ approved: true },
	);
	assert.equal(applied.changed, true);
	const promoted = loadStore(promotionDir);
	assert.equal(promoted.items["E-1"].parentId, "I-1");
	assert.deepEqual(promoted.items["E-1"].documentLinks, [
		{ path: "docs/plans/existing.md" },
	]);
	assert.deepEqual(promoted.items["E-1"].evidence, [{ verification: "PASS" }]);
	assert.equal(promoted.items["I-1.1"].parentId, "I-1");
	assert.throws(
		() => applyInitiativeReconciliation(promotionDir, proposal, preview.token, { approved: true }),
		/replayed|stale store/i,
	);
	const noopPreview = previewInitiativeReconciliation(promotionDir, proposal);
	assert.equal(noopPreview.noop, true);
	const beforeNoop = readFileSync(storePath(promotionDir), "utf8");
	assert.equal(
		applyInitiativeReconciliation(promotionDir, proposal, noopPreview.token, {
			approved: true,
		}).changed,
		false,
	);
	assert.equal(readFileSync(storePath(promotionDir), "utf8"), beforeNoop);
	assert.throws(
		() => applyInitiativeReconciliation(promotionDir, proposal, noopPreview.token, { approved: true }),
		/replayed/i,
	);
	const manual = loadStore(promotionDir);
	manual.items["I-1.1"].title = "Manual title";
	saveStore(promotionDir, manual);
	const conflictPreview = previewInitiativeReconciliation(promotionDir, proposal);
	assert.deepEqual(conflictPreview.conflicts, [
		{ kind: "manual_field", epicId: "I-1.1", field: "title" },
	]);
	assert.throws(
		() =>
			applyInitiativeReconciliation(
				promotionDir,
				proposal,
				conflictPreview.token,
				{ approved: true },
			),
		(error) => error.code === "protected_field_conflict",
	);

	// Candidate interruption leaves the complete old graph recoverable.
	mkdirSync(path.dirname(storePath(recoveryDir)), { recursive: true });
	writeFileSync(storePath(recoveryDir), beforePreview);
	mkdirSync(path.join(recoveryDir, "docs", "brainstorms"), { recursive: true });
	writeFileSync(path.join(recoveryDir, sourcePath), sourceText);
	const recoveryPreview = previewInitiativeReconciliation(recoveryDir, proposal);
	assert.throws(() =>
		applyInitiativeReconciliation(recoveryDir, proposal, recoveryPreview.token, {
			approved: true,
			interruptAt: "candidate",
		}),
	);
	assert.equal(loadStore(recoveryDir).items["I-1"], undefined);
	assert.equal(loadStore(recoveryDir).items["E-1"].parentId, undefined);
	assert.equal(
		applyInitiativeReconciliation(recoveryDir, proposal, recoveryPreview.token, {
			approved: true,
		}).changed,
		true,
	);
	assert.equal(loadStore(recoveryDir).items["I-1"].initiative.evidence.length, 1);
	console.log("work initiative tests passed");
} finally {
	for (const target of [dir, promotionDir, recoveryDir])
		rmSync(target, { recursive: true, force: true });
}
