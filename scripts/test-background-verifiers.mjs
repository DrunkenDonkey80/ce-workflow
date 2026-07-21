#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	VerifierStoreError,
	addFinding,
	addGroup,
	claimGroup,
	createBatch,
	initVerifierStore,
	loadVerifierStore,
	mutateVerifierStore,
	normalizeEffectiveProfiles,
	recordDisposition,
	recordOperationResult,
	saveVerifierStore,
	verifierStorePath,
} from "../extensions/background-verifiers.js";

const dirs = [];
function repo() {
	const dir = mkdtempSync(path.join(os.tmpdir(), "ce-background-verifiers-"));
	dirs.push(dir);
	return dir;
}
function throwsCategory(fn, category) {
	assert.throws(
		fn,
		(error) =>
			error instanceof VerifierStoreError && error.category === category,
	);
}
const options = {
	models: new Set(["openai/gpt-5", "anthropic/claude-4"]),
};
const profiles = [
	{
		model: "openai/gpt-5",
		operations: ["correctness", "test-gap"],
		thinking: "high",
	},
	{
		model: "anthropic/claude-4",
		operations: ["security"],
		thinking: "medium",
	},
];
const checkpoint = {
	repository: "repo-identity",
	base: "a".repeat(40),
	snapshot: "b".repeat(40),
	paths: ["extensions/work-models.js", "scripts/test-work-settings.mjs"],
	patchHash: "c".repeat(64),
};

try {
	// Profiles are canonical, unique, and carry only enabled work.
	assert.deepEqual(
		normalizeEffectiveProfiles(profiles, options),
		[...profiles].sort((left, right) => left.model.localeCompare(right.model)),
	);
	throwsCategory(
		() =>
			normalizeEffectiveProfiles([...profiles, { ...profiles[0] }], options),
		"invalid",
	);
	throwsCategory(
		() =>
			normalizeEffectiveProfiles(
				[{ ...profiles[0], model: "unknown/model" }],
				options,
			),
		"invalid",
	);
	throwsCategory(
		() =>
			normalizeEffectiveProfiles(
				[{ ...profiles[0], operations: ["unknown"] }],
				options,
			),
		"invalid",
	);
	throwsCategory(
		() =>
			normalizeEffectiveProfiles(
				[{ ...profiles[0], thinking: "turbo" }],
				options,
			),
		"invalid",
	);

	const cwd = repo();
	let store = initVerifierStore(cwd, { now: "2026-07-21T00:00:00.000Z" });
	const mutate = (change) => {
		const result = mutateVerifierStore(cwd, change);
		store = loadVerifierStore(cwd);
		return result;
	};
	const batch = mutate((state) =>
		createBatch(state, {
			checkpoint,
			profiles,
			...options,
			now: "2026-07-21T00:00:01.000Z",
		}),
	);
	assert.equal(Object.keys(store.jobs).length, 2);
	assert.deepEqual(
		Object.values(store.jobs)
			.map(({ model, operations, thinking }) => ({
				model,
				operations,
				thinking,
			}))
			.sort((a, b) => a.model.localeCompare(b.model)),
		[...profiles].sort((a, b) => a.model.localeCompare(b.model)),
	);
	assert.equal(
		mutate((state) => createBatch(state, { checkpoint, profiles, ...options }))
			.id,
		batch.id,
	);
	throwsCategory(
		() =>
			createBatch(store, {
				checkpoint: { ...checkpoint, paths: ["../outside.js"] },
				profiles,
				...options,
			}),
		"invalid",
	);
	throwsCategory(
		() =>
			createBatch(store, {
				checkpoint: { ...checkpoint, snapshot: checkpoint.base },
				profiles,
				...options,
			}),
		"invalid",
	);

	const firstJob = Object.values(store.jobs).find(
		(job) => job.model === "openai/gpt-5",
	);
	const correctness = mutate((state) =>
		recordOperationResult(state, {
			jobId: firstJob.id,
			operation: "correctness",
			outcome: "findings",
			findings: [],
			now: "2026-07-21T00:00:02.000Z",
		}),
	);
	assert.equal(correctness.usage, undefined);
	assert.equal(store.jobs[firstJob.id].status, "running");
	assert.equal(
		mutate((state) =>
			recordOperationResult(state, {
				jobId: firstJob.id,
				operation: "correctness",
				outcome: "findings",
				findings: [],
			}),
		).id,
		correctness.id,
	);
	mutate((state) =>
		recordOperationResult(state, {
			jobId: firstJob.id,
			operation: "test-gap",
			outcome: "failed",
			failure: "provider unavailable",
		}),
	);
	assert.equal(store.jobs[firstJob.id].status, "partially-failed");
	assert.deepEqual(store.jobs[firstJob.id].operationStatus, {
		correctness: "findings",
		"test-gap": "failed",
	});

	const finding = mutate((state) =>
		addFinding(state, {
			reportId: correctness.id,
			operation: "correctness",
			model: firstJob.model,
			checkpoint: batch.checkpoint,
			path: "extensions/work-models.js",
			category: "correctness",
			severity: "medium",
			rationale: "null guard is missing",
			suggestedAction: "validate input",
		}),
	);
	throwsCategory(
		() =>
			addFinding(store, { ...finding, id: undefined, path: "C:/outside.js" }),
		"invalid",
	);
	const group = mutate((state) =>
		addGroup(state, { findingIds: [finding.id] }),
	);
	assert.equal(
		mutate((state) => addGroup(state, { findingIds: [finding.id] })).id,
		group.id,
	);
	const claim = mutate((state) =>
		claimGroup(state, {
			groupId: group.id,
			ownerSession: "session-1",
			leaseUntil: "2026-07-21T01:00:00.000Z",
		}),
	);
	assert.equal(claim.groupId, group.id);
	const disposition = mutate((state) =>
		recordDisposition(state, {
			findingId: finding.id,
			disposition: "rejected",
			reason: "not reproducible",
			now: "2026-07-21T00:00:03.000Z",
		}),
	);
	assert.equal(
		mutate((state) => recordDisposition(state, { ...disposition })).id,
		disposition.id,
	);
	assert.equal(store.dispositions[disposition.id].reason, "not reproducible");

	// Every persisted mutation reloads exactly once after a process restart.
	assert.equal(loadVerifierStore(cwd).batches[batch.id].id, batch.id);
	assert.equal(loadVerifierStore(cwd).reports[correctness.id].usage, undefined);
	assert.equal(
		loadVerifierStore(cwd).groups[group.id].findingIds[0],
		finding.id,
	);
	assert.equal(loadVerifierStore(cwd).claims[claim.id].id, claim.id);
	assert.equal(
		loadVerifierStore(cwd).dispositions[disposition.id].id,
		disposition.id,
	);
	assert.match(
		verifierStorePath(cwd),
		/\.ce-workflow[\\/]work-runs[\\/]verifiers[\\/]state\.json$/,
	);

	// A crash after the candidate write leaves the prior validated snapshot usable.
	const recoveryCwd = repo();
	const recoveryStore = initVerifierStore(recoveryCwd, {
		now: "2026-07-21T00:00:00.000Z",
	});
	const interrupted = structuredClone(recoveryStore);
	interrupted.metadata.updatedAt = "2026-07-21T00:00:01.000Z";
	throwsCategory(
		() =>
			saveVerifierStore(recoveryCwd, interrupted, { interruptAt: "candidate" }),
		"interrupted",
	);
	assert.equal(
		loadVerifierStore(recoveryCwd).metadata.updatedAt,
		"2026-07-21T00:00:00.000Z",
	);

	console.log("background verifier domain tests passed");
} finally {
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
}
