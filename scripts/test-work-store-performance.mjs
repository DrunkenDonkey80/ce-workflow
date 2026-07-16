#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import {
	createWorkItem,
	initStore,
	saveStore,
} from "../extensions/work-store.js";
import {
	buildWorkResumeState,
	buildWorkStatus,
} from "../extensions/work-models.js";

const cwd = mkdtempSync(path.join(os.tmpdir(), "ce-work-store-performance-"));
const previousBd = process.env.WORK_ORCH_BD_BIN;
try {
	const store = initStore(cwd, { now: "2026-07-15T00:00:00.000Z" });
	createWorkItem(store, {
		id: "perf-1",
		type: "epic",
		status: "in_progress",
		title: "Performance fixture",
		now: "2026-07-15T00:00:00.000Z",
	});
	for (let index = 1; index <= 1_000; index += 1)
		createWorkItem(store, {
			id: `perf-1.${index}`,
			type: "task",
			status: index === 1 ? "open" : "closed",
			title: `Task ${index}`,
			parentId: "perf-1",
			now: "2026-07-15T00:00:00.000Z",
		});
	saveStore(cwd, store);

	// Any tracker subprocess attempt fails the benchmark instead of being hidden.
	process.env.WORK_ORCH_BD_BIN = path.join(cwd, "bd-must-not-run");
	for (let index = 0; index < 2; index += 1) {
		buildWorkStatus(cwd, "perf-1");
		buildWorkResumeState(cwd, "perf-1");
	}
	const samples = [];
	for (let index = 0; index < 7; index += 1) {
		const started = performance.now();
		const status = buildWorkStatus(cwd, "perf-1");
		const resume = buildWorkResumeState(cwd, "perf-1");
		samples.push(performance.now() - started);
		assert.match(status, /Performance fixture/);
		assert.equal(resume.readyExecutable[0]?.id, "perf-1.1");
	}
	samples.sort((left, right) => left - right);
	const medianMs = samples[Math.floor(samples.length / 2)];
	assert(medianMs < 250, `native status/resume median ${medianMs.toFixed(1)} ms exceeds 250 ms`);
	const legacyBaselineMs = 3_000;
	console.log(
		`native store performance: PASS median=${medianMs.toFixed(1)}ms baseline=${legacyBaselineMs}ms improvement=${(legacyBaselineMs / medianMs).toFixed(1)}x`,
	);
} finally {
	if (previousBd === undefined) delete process.env.WORK_ORCH_BD_BIN;
	else process.env.WORK_ORCH_BD_BIN = previousBd;
	rmSync(cwd, { recursive: true, force: true });
}
