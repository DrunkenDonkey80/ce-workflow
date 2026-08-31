#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	createDesignSession,
	designSessionPath,
	saveDesignSession,
} from "../extensions/work-design.js";
import {
	buildWorkBrainstormState,
	buildWorkFinishState,
	buildWorkPlanState,
	buildWorkResumeState,
	designPlanningAuthority,
} from "../extensions/work-models.js";
import { appendWorkNote, mutateStore } from "../extensions/work-store.js";
import { installWorkflowFixture } from "./work-command-fixture.mjs";

const nonUiRoot = fs.mkdtempSync(
	path.join(os.tmpdir(), "ce-work-design-non-ui-"),
);
let fixture;
try {
	execFileSync("git", ["init"], { cwd: nonUiRoot, stdio: "ignore" });
	const nonUi = buildWorkBrainstormState(
		nonUiRoot,
		"new Update the server timeout and retry limit",
		{ policy: "auto", now: new Date("2026-08-31T00:00:00.000Z") },
	);
	assert.equal(nonUi.designSession, undefined);
	assert.equal(
		fs.existsSync(designSessionPath(nonUiRoot, nonUi.idea.id)),
		false,
	);
	assert.equal(designPlanningAuthority(nonUiRoot, nonUi.idea.id), undefined);
	assert.doesNotMatch(
		buildWorkResumeState(nonUiRoot, nonUi.epic.id).action,
		/^design-/,
	);
	assert.doesNotMatch(
		buildWorkPlanState(nonUiRoot, `${nonUi.epic.id} new`).action,
		/^design-/,
	);

	fixture = installWorkflowFixture();
	fixture.reset("active", "clean");
	const baselineResume = buildWorkResumeState(fixture.cwd, "IMP-1");
	const baselinePlan = buildWorkPlanState(fixture.cwd, "E-1 new");
	for (const ownerId of ["IMP-1", "E-1"])
		saveDesignSession(
			fixture.cwd,
			createDesignSession({
				ownerId,
				policy: "auto",
				state: "brief_required",
				now: "2026-08-31T00:00:00.000Z",
			}),
		);
	assert.deepEqual(buildWorkResumeState(fixture.cwd, "IMP-1"), baselineResume);
	assert.deepEqual(buildWorkPlanState(fixture.cwd, "E-1 new"), baselinePlan);

	fixture.reset("finishReady", "unknown");
	mutateStore(fixture.cwd, (store) => {
		appendWorkNote(store, "FIN-1", "design-owner: E-1");
		appendWorkNote(store, "FIN-1", "wo:design-deviation stale optional metadata");
	});
	const finish = buildWorkFinishState(fixture.cwd, "FIN-1");
	assert.equal(finish.ok, true);
	assert.equal(finish.action, "commit-ready");

	process.stdout.write("work-design disabled/non-UI regression tests passed\n");
} finally {
	fixture?.cleanup();
	fs.rmSync(nonUiRoot, { recursive: true, force: true });
}
