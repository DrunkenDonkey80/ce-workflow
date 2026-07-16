#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	initStore,
	createWorkItem,
	saveStore,
} from "../extensions/work-store.js";
import {
	buildWorkStatus,
	buildWorkReportState,
	buildWorkResumeState,
	buildWorkRoadmapState,
} from "../extensions/work-models.js";
import { installWorkflowFixture } from "./work-command-fixture.mjs";

const dirs = [];
const repo = () => {
	const dir = mkdtempSync(path.join(os.tmpdir(), "ce-native-read-"));
	dirs.push(dir);
	return dir;
};
function nativeFixture(dir) {
	const store = initStore(dir);
	const add = (input) =>
		createWorkItem(store, { now: "2026-07-15T00:00:00.000Z", ...input });
	add({
		id: "E-1",
		type: "epic",
		status: "in_progress",
		title: "Native epic",
		documentLinks: { plan: "docs/plans/native.md" },
	});
	add({
		id: "E-1.1",
		type: "task",
		status: "closed",
		title: "Done",
		parentId: "E-1",
	});
	add({
		id: "E-1.2",
		type: "task",
		status: "open",
		title: "Ready",
		parentId: "E-1",
		dependencies: ["E-1.1"],
	});
	add({
		id: "E-1.3",
		type: "task",
		status: "planned",
		title: "Later",
		parentId: "E-1",
		dependencies: ["E-1.2"],
	});
	add({
		id: "E-1.4",
		type: "decision",
		status: "open",
		title: "Choose",
		parentId: "E-1",
	});
	add({
		id: "E-1.5",
		type: "idea",
		status: "open",
		title: "Idea",
		parentId: "E-1",
		ideaLineage: { brainstorm: "docs/brainstorms/native.md" },
	});
	for (let i = 0; i < 1000; i++)
		add({ id: `bulk-${i}`, type: "task", status: "closed", title: "bulk" });
	saveStore(dir, store);
}
try {
	const dir = repo();
	nativeFixture(dir);
	const old = process.env.WORK_ORCH_BD_BIN;
	process.env.WORK_ORCH_BD_BIN = path.join(dir, "bd-must-not-run");
	try {
		const status = buildWorkStatus(dir, "E-1");
		assert.match(status, /Native epic/);
		assert.match(status, /Ready/);
		assert.doesNotMatch(status, /Idea/);
		const report = buildWorkReportState(dir, "E-1");
		assert.equal(report.ok, true);
		assert.equal(report.epic.id, "E-1");
		const resume = buildWorkResumeState(dir, "E-1");
		assert.equal(resume.ok, true);
		assert.deepEqual(
			resume.readyExecutable.map((x) => x.id),
			["E-1.2"],
		);
		const roadmap = buildWorkRoadmapState(dir, "tasks E-1");
		assert.equal(roadmap.ok, true);
		const helper = JSON.parse(
			execFileSync(
				process.execPath,
				[path.resolve("scripts/work-helper.mjs"), "work-ready-summary", "E-1"],
				{ cwd: dir, encoding: "utf8" },
			),
		);
		assert.deepEqual(
			helper.map((item) => item.id),
			["E-1.2"],
		);
	} finally {
		if (old === undefined) delete process.env.WORK_ORCH_BD_BIN;
		else process.env.WORK_ORCH_BD_BIN = old;
	}
	const fixture = installWorkflowFixture({ native: true });
	try {
		fixture.reset("active");
		assert.match(buildWorkStatus(fixture.cwd, "E-1"), /Active epic/);
	} finally {
		fixture.cleanup();
	}
	const legacy = repo();
	mkdirSync(path.join(legacy, ".beads"));
	writeFileSync(path.join(legacy, ".beads", "marker"), "legacy");
	assert.match(buildWorkStatus(legacy, ""), /migration-required/);
	for (const state of [
		buildWorkReportState(legacy, ""),
		buildWorkResumeState(legacy, ""),
		buildWorkRoadmapState(legacy, "list"),
	])
		assert.equal(state.reason, "migration-required");
	const corrupt = repo();
	mkdirSync(path.join(corrupt, ".ce-workflow"));
	writeFileSync(
		path.join(corrupt, ".ce-workflow", "work-items.json"),
		"{broken",
	);
	for (const state of [
		buildWorkReportState(corrupt, ""),
		buildWorkResumeState(corrupt, ""),
		buildWorkRoadmapState(corrupt, "list"),
	])
		assert.equal(state.reason, "recovery-required");
	console.log("native work status tests passed");
} finally {
	for (const dir of dirs)
		rmSync(dir, {
			recursive: true,
			force: true,
			maxRetries: 3,
			retryDelay: 30,
		});
}
