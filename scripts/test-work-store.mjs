#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	WorkStoreError,
	acquireLock,
	addWorkEvidence,
	appendWorkNote,
	createWorkItem,
	deleteWorkItem,
	initStore,
	loadStore,
	mutateStore,
	readyWorkItems,
	saveStore,
	storePath,
	updateWorkItem,
	validateStore,
} from "../extensions/work-store.js";

const dirs = [];
function repo() {
	const dir = mkdtempSync(path.join(os.tmpdir(), "ce-work-store-"));
	dirs.push(dir);
	return dir;
}
function throwsCategory(fn, category) {
	assert.throws(
		fn,
		(error) => error instanceof WorkStoreError && error.category === category,
	);
}
function item(store, input) {
	return createWorkItem(store, { now: "2026-07-15T00:00:00.000Z", ...input });
}
function initiativeMetadata(childId = "initiative-1.1") {
	return {
		schemaVersion: 1,
		sources: [
			{
				id: "brainstorm-1",
				path: "docs/brainstorms/initiative.md",
				hash: "source-hash",
			},
		],
		coverage: [
			{
				id: "outcome-1",
				provenance: "brainstorm-1:R1",
				contentHash: "outcome-hash",
				disposition: "accepted",
				epicId: childId,
			},
		],
		evidence: [],
	};
}
function initiativeStore() {
	const store = initStore(repo(), { now: "2026-07-15T00:00:00.000Z" });
	const template = (id, title, extra = {}) => ({
		id,
		type: "epic",
		status: "open",
		title,
		createdAt: "2026-07-15T00:00:00.000Z",
		updatedAt: "2026-07-15T00:00:00.000Z",
		dependencies: [],
		labels: [],
		notes: [],
		evidence: [],
		dependencyEdges: [],
		...extra,
	});
	store.items = {
		"standalone-1": template("standalone-1", "Standalone"),
		"initiative-1": template("initiative-1", "Initiative", {
			labels: ["initiative"],
			initiative: initiativeMetadata(),
			custom: { preserved: true },
		}),
		"initiative-1.1": template("initiative-1.1", "Child", {
			parentId: "initiative-1",
			documentLinks: [{ path: "docs/plans/child.md" }],
		}),
		"initiative-1.1.1": {
			...template("initiative-1.1.1", "Task", {
				parentId: "initiative-1.1",
			}),
			type: "task",
		},
	};
	return store;
}

try {
	// Empty initialization is a tracked schema, never a runtime log.
	const emptyDir = repo();
	const empty = initStore(emptyDir, { now: "2026-07-15T00:00:00.000Z" });
	assert.equal(empty.schemaVersion, 1);
	assert.deepEqual(empty.items, {});
	assert.match(readFileSync(storePath(emptyDir), "utf8"), /"schemaVersion": 1/);
	assert.doesNotMatch(
		readFileSync(storePath(emptyDir), "utf8"),
		/log|telemetry|cache/i,
	);

	// Typed records, Unicode notes, and reload survive.
	const typedDir = repo();
	const typed = initStore(typedDir, { now: "2026-07-15T00:00:00.000Z" });
	const epic = item(typed, { id: "project-1", type: "epic", title: "Epic" });
	for (const [type, id] of [
		["task", "project-1.1"],
		["bug", "project-1.2"],
		["decision", "project-1.3"],
		["idea", "project-1.4"],
	])
		item(typed, {
			id,
			type,
			title: type,
			parentId: epic.id,
			notes: ["雪\nkept"],
		});
	saveStore(typedDir, typed);
	appendWorkNote(typed, "project-1.1", "checked", {
		now: "2026-07-15T00:00:01.000Z",
	});
	addWorkEvidence(
		typed,
		"project-1.1",
		{ verification: "PASS" },
		{ now: "2026-07-15T00:00:02.000Z" },
	);
	updateWorkItem(typed, "project-1.1", {
		owner: "developer",
		now: "2026-07-15T00:00:03.000Z",
	});
	saveStore(typedDir, typed);
	assert.equal(loadStore(typedDir).items["project-1.4"].notes[0], "雪\nkept");
	assert.deepEqual(loadStore(typedDir).items["project-1.1"].evidence, [
		{ verification: "PASS" },
	]);

	// Initiative metadata and complete hierarchy validation preserve old stores.
	const hierarchyDir = repo();
	const hierarchy = initiativeStore();
	validateStore(hierarchy);
	saveStore(hierarchyDir, hierarchy);
	const hierarchyBytes = readFileSync(storePath(hierarchyDir), "utf8");
	assert.equal(loadStore(hierarchyDir).items["initiative-1"].custom.preserved, true);
	assert.deepEqual(
		loadStore(hierarchyDir).items["initiative-1.1"].documentLinks,
		[{ path: "docs/plans/child.md" }],
	);
	assert.equal(saveStore(hierarchyDir, loadStore(hierarchyDir), { dryRun: true }), hierarchyBytes);

	const invalidHierarchy = (change) => {
		const candidate = structuredClone(hierarchy);
		change(candidate);
		throwsCategory(() => validateStore(candidate), "corrupt");
	};
	invalidHierarchy((store) => {
		store.items["initiative-1.1"].type = "task";
	});
	invalidHierarchy((store) => {
		store.items["initiative-1.1"].labels = ["initiative"];
		store.items["initiative-1.1"].initiative = initiativeMetadata(
			"initiative-1.1.1",
		);
	});
	invalidHierarchy((store) => {
		store.items["initiative-1"].initiative = { schemaVersion: 1 };
	});
	invalidHierarchy((store) => {
		store.items["initiative-1"].initiative.coverage.push({
			...store.items["initiative-1"].initiative.coverage[0],
			id: "outcome-2",
		});
	});
	invalidHierarchy((store) => {
		store.items["initiative-1"].initiative.coverage[0].epicId = "missing";
	});
	invalidHierarchy((store) => {
		store.items["initiative-1"].parentId = "initiative-1.1";
	});
	invalidHierarchy((store) => {
		delete store.items["initiative-1"].initiative;
	});

	assert.throws(
		() => updateWorkItem(hierarchy, "initiative-1.1", { parentId: undefined }),
		(error) => error.category === "corrupt",
	);
	assert.throws(
		() => deleteWorkItem(hierarchy, "initiative-1.1"),
		(error) => error.category === "corrupt",
	);
	const promoted = initiativeStore();
	const protectedChild = structuredClone(promoted.items["initiative-1.1"]);
	assert.equal(protectedChild.id, "initiative-1.1");
	assert.deepEqual(protectedChild.documentLinks, [{ path: "docs/plans/child.md" }]);

	const corruptDir = repo();
	const corruptStore = initStore(corruptDir);
	item(corruptStore, { id: "cycle-a", type: "epic", title: "A" });
	item(corruptStore, { id: "cycle-b", type: "epic", title: "B" });
	corruptStore.items["cycle-a"].parentId = "cycle-b";
	corruptStore.items["cycle-b"].parentId = "cycle-a";
	const corruptBytes = `${JSON.stringify(corruptStore, null, "\t")}\n`;
	writeFileSync(storePath(corruptDir), corruptBytes);
	assert.throws(
		() => loadStore(corruptDir),
		(error) =>
			error.category === "corrupt" &&
			/parent cycle/i.test(error.message) &&
			/repair/i.test(error.repair),
	);
	assert.throws(() => mutateStore(corruptDir, () => {}));
	assert.equal(readFileSync(storePath(corruptDir), "utf8"), corruptBytes);

	// Dependency readiness is ordered and ideas never execute.
	const graphDir = repo();
	const graph = initStore(graphDir);
	item(graph, { id: "epic-1", type: "epic", title: "E" });
	item(graph, {
		id: "epic-1.1",
		type: "task",
		title: "first",
		parentId: "epic-1",
	});
	item(graph, {
		id: "epic-1.2",
		type: "task",
		title: "next",
		parentId: "epic-1",
		dependencies: ["epic-1.1"],
	});
	item(graph, {
		id: "epic-1.3",
		type: "idea",
		title: "not executable",
		parentId: "epic-1",
	});
	item(graph, {
		id: "epic-1.4",
		type: "task",
		status: "deferred",
		title: "not ready",
		parentId: "epic-1",
	});
	assert.deepEqual(
		readyWorkItems(graph).map((entry) => entry.id),
		["epic-1.1"],
	);
	graph.items["epic-1.1"].status = "closed";
	assert.deepEqual(
		readyWorkItems(graph).map((entry) => entry.id),
		["epic-1.2"],
	);

	// Imported IDs survive; generated IDs retain numeric suffix targeting.
	const ids = initStore(repo());
	item(ids, { id: "imported-9.7", type: "task", title: "imported" });
	assert.equal(item(ids, { type: "task", title: "root" }).id, "work-1");
	assert.equal(
		item(ids, { type: "task", title: "child", parentId: "work-1" }).id,
		"work-1.1",
	);

	// Stable keyed serialization ignores insertion order.
	const first = initStore(repo(), { now: "2026-07-15T00:00:00.000Z" });
	const second = initStore(repo(), { now: "2026-07-15T00:00:00.000Z" });
	for (const [store, entries] of [
		[
			first,
			[
				["work-2", "B"],
				["work-1", "A"],
			],
		],
		[
			second,
			[
				["work-1", "A"],
				["work-2", "B"],
			],
		],
	])
		for (const [id, title] of entries) item(store, { id, type: "task", title });
	assert.equal(
		saveStore(repo(), first, { dryRun: true }),
		saveStore(repo(), second, { dryRun: true }),
	);

	// A separate process owns the exclusive lock until released.
	const lockDir = repo();
	initStore(lockDir);
	const lock = acquireLock(lockDir);
	const contender = path.join(lockDir, "contend-lock.mjs");
	writeFileSync(
		contender,
		`import { mutateStore } from ${JSON.stringify(new URL("../extensions/work-store.js", import.meta.url).href)}; mutateStore(process.argv[2], () => {});`,
	);
	const beforeContender = readFileSync(storePath(lockDir), "utf8");
	assert.throws(() =>
		execFileSync(process.execPath, [contender, lockDir], { stdio: "ignore" }),
	);
	assert.equal(readFileSync(storePath(lockDir), "utf8"), beforeContender);
	lock.release();
	mutateStore(lockDir, (store) =>
		item(store, { type: "task", title: "after lock" }),
	);
	const staleWriter = path.join(lockDir, "stale-lock.mjs");
	writeFileSync(
		staleWriter,
		`import { acquireLock } from ${JSON.stringify(new URL("../extensions/work-store.js", import.meta.url).href)}; acquireLock(process.argv[2]);`,
	);
	execFileSync(process.execPath, [staleWriter, lockDir]);
	mutateStore(lockDir, (store) =>
		item(store, { type: "task", title: "after stale lock" }),
	);
	assert(
		Object.values(loadStore(lockDir).items).some(
			(entry) => entry.title === "after stale lock",
		),
	);

	// Candidate interruption never makes invalid data authoritative; recovery is valid.
	const recoveryDir = repo();
	const recovery = initStore(recoveryDir);
	item(recovery, { id: "work-1", type: "task", title: "old" });
	saveStore(recoveryDir, recovery);
	recovery.items["work-1"].title = "new";
	for (const boundary of ["recovery", "candidate", "replace"]) {
		assert.throws(() =>
			saveStore(recoveryDir, recovery, { interruptAt: boundary }),
		);
		assert.doesNotThrow(() => loadStore(recoveryDir));
	}
	writeFileSync(storePath(recoveryDir), "{broken");
	assert.equal(loadStore(recoveryDir).items["work-1"].title, "old");

	// All invalid inputs fail closed without rewrite.
	const invalidDir = repo();
	initStore(invalidDir);
	for (const [content, category] of [
		["<<<<<<< ours\n=======\n>>>>>>> theirs", "conflicted"],
		["{bad", "corrupt"],
		[
			JSON.stringify({ schemaVersion: 2, metadata: {}, items: {} }),
			"unsupported",
		],
		[
			JSON.stringify({
				schemaVersion: 1,
				metadata: {},
				items: {
					a: { id: "x", type: "task", status: "open", title: "x" },
					b: { id: "x", type: "task", status: "open", title: "x" },
				},
			}),
			"corrupt",
		],
		[
			JSON.stringify({
				schemaVersion: 1,
				metadata: {},
				items: {
					a: {
						id: "a",
						type: "task",
						status: "open",
						title: "a",
						parentId: "missing",
					},
				},
			}),
			"corrupt",
		],
		[
			JSON.stringify({
				schemaVersion: 1,
				metadata: {},
				items: {
					a: {
						id: "a",
						type: "task",
						status: "open",
						title: "a",
						dependencies: ["missing"],
					},
				},
			}),
			"corrupt",
		],
	]) {
		writeFileSync(storePath(invalidDir), content);
		throwsCategory(() => loadStore(invalidDir), category);
		assert.equal(readFileSync(storePath(invalidDir), "utf8"), content);
	}

	console.log("work-store tests passed");
} finally {
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
}
