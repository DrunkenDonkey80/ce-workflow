#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	initStore,
	saveStore,
	validateStore,
} from "../extensions/work-store.js";
import {
	INITIATIVE_PROJECTION_VERSION,
	projectInitiativeHierarchy,
} from "../extensions/work-initiatives.js";
import { buildInitiativeProjection } from "../extensions/work-models.js";

const dir = mkdtempSync(path.join(os.tmpdir(), "ce-initiative-"));
const timestamp = "2026-07-19T00:00:00.000Z";
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
	console.log("work initiative tests passed");
} finally {
	rmSync(dir, { recursive: true, force: true });
}
