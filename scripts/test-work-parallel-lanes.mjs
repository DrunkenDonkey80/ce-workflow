#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	acknowledgeLaneLaunch,
	acquireRepositoryAdmissionLock,
	acquireRepositoryMutationLock,
	captureRepositoryFingerprint,
	createLaneEnvelope,
	fingerprintsEqual,
	laneCanLaunch,
	laneStatus,
	laneStorePath,
	loadLaneStore,
	queueLane,
	reconcileReadOnlyLanes,
	runReadOnlyLaneBatch,
	saveLaneStore,
	transitionLane,
} from "../extensions/read-only-lanes.js";
import workModelsExtension, {
	executeOrchestratorAction,
	launchCurrentTaskReadOnlyLanes,
	readOnlyLaneRuntimeStatus,
	reconcileReadOnlyLaneRuns,
} from "../extensions/work-models.js";
import { seedNativeStore } from "./work-command-fixture.mjs";

const roots = [];
function repository() {
	const cwd = mkdtempSync(path.join(os.tmpdir(), "ce-read-only-lanes-"));
	roots.push(cwd);
	const git = (...args) =>
		execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" }).trim();
	git("init", "-q");
	git("config", "user.email", "lanes@example.invalid");
	git("config", "user.name", "Lane Test");
	writeFileSync(path.join(cwd, "source.js"), "export const value = 1;\n");
	git("add", "source.js");
	git("commit", "-qm", "initial");
	return { cwd, git };
}
function envelope(
	cwd,
	head,
	generation,
	suffix,
	resourceKeys = [],
	laneKind = "discovery",
) {
	return createLaneEnvelope({
		repository: cwd,
		laneKind,
		producer: "test-runner",
		workItemId: `work-${suffix}`,
		generation,
		baseHead: head,
		checkpoint: head,
		workItemHash: `work-hash-${suffix}`,
		selectionHash: `selection-${suffix}`,
		relevantPaths: ["source.js"],
		resourceKeys,
		gateVersion: "gate-v1",
		settingsVersion: "settings-v1",
		promotionOwner: "test-owner",
		now: "2026-07-26T00:00:00.000Z",
	});
}

try {
	{
		const cwd = mkdtempSync(path.join(os.tmpdir(), "ce-read-only-lanes-absent-"));
		roots.push(cwd);
		assert.deepEqual(reconcileReadOnlyLanes(cwd), []);
		assert.equal(
			existsSync(path.join(cwd, ".ce-workflow")),
			false,
			"absent lane reconciliation does not create workflow state",
		);
	}

	{
		const { cwd, git } = repository();
		const laneLock = path.join(path.dirname(laneStorePath(cwd)), "mutation.lock");
		mkdirSync(path.dirname(laneLock), { recursive: true });
		const holder = spawn(
			process.execPath,
			[
				"-e",
				`const fs=require("fs"),os=require("os");fs.writeFileSync(${JSON.stringify(laneLock)},JSON.stringify({pid:process.pid,host:os.hostname(),acquiredAt:new Date().toISOString()})+"\\n");setTimeout(()=>fs.rmSync(${JSON.stringify(laneLock)},{force:true}),100)`,
			],
			{ stdio: "ignore" },
		);
		for (let attempts = 0; attempts < 50 && !existsSync(laneLock); attempts += 1)
			Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
		assert.equal(existsSync(laneLock), true, "fixture holds the lane store lock");
		assert.doesNotThrow(
			() => queueLane(cwd, envelope(cwd, git("rev-parse", "HEAD"), 1, "retry")),
			"a brief live-writer collision is retried",
		);
		if (holder.exitCode === null)
			await new Promise((resolve) => holder.once("exit", resolve));
	}

	{
		const { cwd, git } = repository();
		const admissionPath = path.join(
			cwd,
			".ce-workflow",
			"work-runs",
			"repository-admission.lock",
		);
		mkdirSync(path.dirname(admissionPath), { recursive: true });
		writeFileSync(
			admissionPath,
			`${JSON.stringify({ pid: 2147483647, host: os.hostname(), acquiredAt: new Date(0).toISOString() })}\n`,
		);
		const reclaimed = acquireRepositoryAdmissionLock(cwd);
		reclaimed.release();
		assert.equal(existsSync(admissionPath), false, "a dead lock is reclaimed");

		const owned = acquireRepositoryAdmissionLock(cwd);
		rmSync(admissionPath);
		writeFileSync(
			admissionPath,
			`${JSON.stringify({ token: "replacement", pid: process.pid, host: os.hostname() })}\n`,
		);
		owned.release();
		assert.equal(
			existsSync(admissionPath),
			true,
			"release does not unlink a replacement owner's lock",
		);
		rmSync(admissionPath);

		const lane = envelope(cwd, git("rev-parse", "HEAD"), 1, "debug-admission", [
			"repo:debug",
		]);
		let started = false;
		const held = acquireRepositoryAdmissionLock(cwd);
		try {
			const blocked = await runReadOnlyLaneBatch(cwd, [lane], async () => {
				started = true;
				return { artifact: { unexpected: true } };
			});
			assert.equal(blocked.results[0].state, "failed");
			assert.equal(started, false, "every checkout lane waits for admission");
		} finally {
			held.release();
		}
	}

	{
		const { cwd, git } = repository();
		const head = git("rev-parse", "HEAD");
		queueLane(cwd, envelope(cwd, head, 1, "no-op"));
		const before = readFileSync(laneStorePath(cwd), "utf8");
		assert.deepEqual(
			reconcileReadOnlyLanes(cwd, { now: "2026-07-26T01:00:00.000Z" }),
			[],
		);
		assert.equal(
			readFileSync(laneStorePath(cwd), "utf8"),
			before,
			"no-op reconciliation does not rewrite lane state",
		);
	}

	{
		const { cwd, git } = repository();
		const head = git("rev-parse", "HEAD");
		const lane = envelope(cwd, head, 1, "canonical", ["repo:z", "repo:a"]);
		assert.equal(lane.version, 1);
		assert.deepEqual(lane.resourceKeys, ["repo:a", "repo:z"]);
		assert.equal(lane.state, "queued");
		assert.equal(lane.artifact, null);
		assert.equal(queueLane(cwd, lane).id, lane.id);
		acknowledgeLaneLaunch(cwd, lane.id, { ambiguous: true, runId: "unknown" });
		assert.equal(laneCanLaunch(loadLaneStore(cwd).lanes[lane.id]), false);
		const duplicate = await runReadOnlyLaneBatch(cwd, [lane], async () => {
			throw new Error("must not start");
		});
		assert.equal(duplicate.results[0].state, "failed");
		queueLane(cwd, envelope(cwd, head, 1, "recovery"));
		writeFileSync(laneStorePath(cwd), "not json\n");
		assert(
			Object.keys(loadLaneStore(cwd).lanes).length > 0,
			"corrupt primary lane state falls back to the durable recovery copy",
		);
	}

	{
		const { cwd, git } = repository();
		const head = git("rev-parse", "HEAD");
		const lane = envelope(cwd, head, 1, "recovery-only");
		queueLane(cwd, lane);
		transitionLane(cwd, lane.id, "running", {
			launch: { pid: 2147483647, host: os.hostname() },
		});
		saveLaneStore(cwd, loadLaneStore(cwd));
		rmSync(laneStorePath(cwd));
		assert.deepEqual(
			reconcileReadOnlyLanes(cwd, { processExists: () => false }),
			[lane.id],
			"recovery-only running lane is reconciled",
		);
		assert.equal(
			loadLaneStore(cwd).lanes[lane.id].state,
			"orphaned",
			"dead recovery-only lane becomes orphaned",
		);
	}

	{
		const { cwd, git } = repository();
		const head = git("rev-parse", "HEAD");
		const lanes = [
			envelope(cwd, head, 1, "a1", ["device:a"]),
			envelope(cwd, head, 1, "b", ["device:b"]),
			envelope(cwd, head, 1, "a2", ["device:a"]),
		];
		let active = 0;
		let maximum = 0;
		const claimed = new Set();
		const durations = new Map([
			[lanes[0].id, 30],
			[lanes[1].id, 40],
			[lanes[2].id, 20],
		]);
		const result = await runReadOnlyLaneBatch(
			cwd,
			lanes,
			async (lane) => {
				assert(lane.resourceKeys.every((key) => !claimed.has(key)));
				for (const key of lane.resourceKeys) claimed.add(key);
				active += 1;
				maximum = Math.max(maximum, active);
				await new Promise((resolve) => setImmediate(resolve));
				active -= 1;
				for (const key of lane.resourceKeys) claimed.delete(key);
				return {
					artifact: { path: `${lane.id}.json` },
					durationMs: durations.get(lane.id),
				};
			},
			{ maxConcurrency: 2 },
		);
		assert.equal(maximum, 2);
		assert.equal(result.maxConcurrency, 2);
		assert.equal(result.sumShardMs, 90);
		assert.equal(result.criticalPathMs, 50);
		assert(result.criticalPathMs < result.sumShardMs);
		assert.deepEqual(
			result.results.map(({ state }) => state),
			["promoted", "promoted", "promoted"],
		);
		assert(laneStatus(cwd).every((item) => item.maxConcurrency === 2));
	}

	{
		const { cwd, git } = repository();
		const head = git("rev-parse", "HEAD");
		const lanes = [
			envelope(cwd, head, 1, "fail-1"),
			envelope(cwd, head, 1, "fail-2"),
			envelope(cwd, head, 1, "fail-3"),
		];
		const started = [];
		const failed = await runReadOnlyLaneBatch(
			cwd,
			lanes,
			async (lane) => {
				started.push(lane.id);
				throw new Error("fixture failure");
			},
			{ maxConcurrency: 1, failFast: true },
		);
		assert.deepEqual(started, [lanes[0].id]);
		assert.deepEqual(
			failed.results.map(({ state }) => state),
			["failed", "discarded", "discarded"],
		);

		const recoveryLane = envelope(cwd, head, 2, "recovery-error");
		const recoveryFailure = await runReadOnlyLaneBatch(
			cwd,
			[recoveryLane],
			async (lane) => {
				const store = loadLaneStore(cwd);
				delete store.lanes[lane.id];
				saveLaneStore(cwd, store);
				throw new Error("fixture recovery failure");
			},
		);
		assert.equal(
			recoveryFailure.results[0].state,
			"failed",
			"recovery-path errors settle the batch instead of escaping the lane task",
		);
	}

	{
		const { cwd, git } = repository();
		const head = git("rev-parse", "HEAD");
		const old = createLaneEnvelope({
			...envelope(cwd, head, 1, "stale"),
			generation: 1,
			now: "2026-07-26T00:00:00.000Z",
		});
		const fresh = createLaneEnvelope({
			...envelope(cwd, head, 2, "stale"),
			generation: 2,
			now: "2026-07-26T00:00:01.000Z",
		});
		const stale = await runReadOnlyLaneBatch(
			cwd,
			[old, fresh],
			async (lane) => ({
				artifact: { generation: lane.generation },
				durationMs: 1,
			}),
			{ maxConcurrency: 1 },
		);
		assert.deepEqual(
			stale.results.map(({ state }) => state),
			["discarded", "promoted"],
		);
		const cancelled = envelope(cwd, head, 1, "cancelled");
		const cancelledResult = await runReadOnlyLaneBatch(
			cwd,
			[cancelled],
			async () => ({ status: "cancelled", artifact: { late: true } }),
		);
		assert.equal(cancelledResult.results[0].state, "discarded");
	}

	{
		const { cwd, git } = repository();
		const head = git("rev-parse", "HEAD");
		const before = captureRepositoryFingerprint(cwd);
		writeFileSync(path.join(cwd, "source.js"), "export const value = 2;\n");
		assert.equal(
			fingerprintsEqual(before, captureRepositoryFingerprint(cwd)),
			false,
		);
		git("checkout", "--", "source.js");
		const mutating = envelope(cwd, head, 1, "mutation");
		const mutationResult = await runReadOnlyLaneBatch(
			cwd,
			[mutating],
			async () => {
				writeFileSync(path.join(cwd, "source.js"), "export const value = 3;\n");
				return { artifact: { unsafe: true } };
			},
		);
		assert.equal(mutationResult.results[0].state, "failed");
		git("checkout", "--", "source.js");
		const cancelledMutation = await runReadOnlyLaneBatch(
			cwd,
			[envelope(cwd, head, 2, "cancelled-mutation")],
			async () => {
				writeFileSync(path.join(cwd, "source.js"), "export const value = 4;\n");
				return { status: "cancelled" };
			},
		);
		assert.equal(
			cancelledMutation.results[0].state,
			"failed",
			"cancellation cannot bypass the read-only fingerprint check",
		);
		assert.match(cancelledMutation.results[0].reason, /mutated source/);
		git("checkout", "--", "source.js");
		const lock = acquireRepositoryMutationLock(cwd);
		try {
			const locked = await runReadOnlyLaneBatch(
				cwd,
				[envelope(cwd, head, 1, "locked")],
				async () => ({ artifact: { impossible: true } }),
			);
			assert.equal(locked.results[0].state, "failed");
		} finally {
			lock.release();
		}
	}

	{
		const { cwd } = repository();
		const lock = acquireRepositoryMutationLock(cwd);
		try {
			assert.throws(
				() => acquireRepositoryMutationLock(cwd),
				(error) =>
					error.category === "locked" &&
					new RegExp(
						`owner pid ${process.pid}, command test-work-parallel-lanes\\.mjs, age \\d+ms`,
					).test(error.message),
				"lock contention identifies the live owner command and age",
			);
		} finally {
			lock.release();
		}
	}

	{
		const { cwd, git } = repository();
		const head = git("rev-parse", "HEAD");
		const dead = envelope(cwd, head, 1, "dead");
		const live = envelope(cwd, head, 1, "live");
		queueLane(cwd, dead);
		queueLane(cwd, live);
		transitionLane(cwd, dead.id, "running", {
			launch: { pid: 101, host: "fixture", runId: null },
		});
		transitionLane(cwd, live.id, "running", {
			launch: { pid: 202, host: "fixture", runId: null },
		});
		assert.deepEqual(
			reconcileReadOnlyLanes(cwd, {
				host: "fixture",
				processExists: (pid) => pid === 202,
			}),
			[dead.id],
		);
		assert.equal(loadLaneStore(cwd).lanes[dead.id].state, "orphaned");
		assert.equal(loadLaneStore(cwd).lanes[live.id].state, "running");
		assert.throws(
			() => acquireRepositoryMutationLock(cwd),
			/Read-only lanes are using the repository/,
			"MUTATE_REPO cannot start while a live read-only lane owns the checkout",
		);
	}

	{
		const { cwd, git } = repository();
		const head = git("rev-parse", "HEAD");
		const terminal = [
			...[
				"complete",
				"completed",
				"success",
				"succeeded",
				"done",
				"ok",
				"passed",
			].map((status) => ({ status, expected: "completed" })),
			...[
				"failed",
				"error",
				"stopped",
				"cancelled",
				"canceled",
				"timed_out",
				"timeout",
			].map((status) => ({ status, expected: "failed" })),
		].map((fixture) => ({
			...fixture,
			lane: envelope(cwd, head, 1, fixture.status, [], "prefetch"),
		}));
		for (const { lane, status } of terminal) {
			const asyncDir = path.join(cwd, ".pi-subagents", lane.id);
			mkdirSync(asyncDir, { recursive: true });
			queueLane(cwd, lane);
			transitionLane(cwd, lane.id, "running", {
				launch: {
					pid: process.pid,
					host: os.hostname(),
					runId: lane.id,
					asyncDir,
				},
			});
			writeFileSync(
				path.join(asyncDir, "status.json"),
				JSON.stringify({ status }),
			);
		}
		assert.deepEqual(
			reconcileReadOnlyLanes(cwd),
			terminal.map(({ lane }) => lane.id).sort(),
		);
		const lanes = loadLaneStore(cwd).lanes;
		for (const { lane, expected } of terminal)
			assert.equal(lanes[lane.id].state, expected);
		const mutation = acquireRepositoryMutationLock(cwd);
		mutation.release();
	}

	{
		const { cwd, git } = repository();
		const head = git("rev-parse", "HEAD");
		const exitedPid = Number(
			execFileSync(
				process.execPath,
				["-e", "process.stdout.write(String(process.pid))"],
				{ encoding: "utf8" },
			),
		);
		const dead = envelope(cwd, head, 1, "mutation-boundary-dead");
		queueLane(cwd, dead);
		transitionLane(cwd, dead.id, "running", {
			launch: { pid: exitedPid, host: os.hostname(), runId: null },
		});
		const mutation = acquireRepositoryMutationLock(cwd);
		mutation.release();
		assert.equal(
			loadLaneStore(cwd).lanes[dead.id].state,
			"orphaned",
			"MUTATE_REPO reconciles a dead local runner before scanning active lanes",
		);
	}

	{
		const { cwd, git } = repository();
		seedNativeStore(cwd, [
			{ id: "roadmap", type: "epic", status: "open", title: "Roadmap" },
			{
				id: "work-1",
				type: "task",
				status: "open",
				title: "Current",
				parentId: "roadmap",
			},
		]);
		const launches = [];
		const result = await launchCurrentTaskReadOnlyLanes(
			cwd,
			[
				{
					laneKind: "discovery",
					workItemId: "work-1",
					generation: 1,
					relevantPaths: ["source.js"],
					resourceKeys: ["repo:read"],
					agent: "fixture-reader",
					workflowRunId: "read-only-workflow",
				},
			],
			{
				async spawn(request) {
					launches.push(request);
					return {
						ok: true,
						completed: true,
						data: { runId: "reader-1" },
						durationMs: 5,
					};
				},
			},
			{ maxConcurrency: 2 },
		);
		assert.equal(result.results[0].state, "promoted");
		assert.equal(launches[0].lane.workItemId, "work-1");
		assert.equal(readOnlyLaneRuntimeStatus(cwd).lanes[0].laneKind, "discovery");
		assert.equal(git("rev-parse", "HEAD"), launches[0].lane.baseHead);
		assert.equal(
			existsSync(
				path.join(cwd, ".ce-workflow", "work-runs", "verifiers", "state.json"),
			),
			false,
			"read-only settlement never queues a committed-scope verifier batch",
		);
		const asyncDir = path.join(cwd, ".pi-subagents", "read-only-debug");
		mkdirSync(asyncDir, { recursive: true });
		const pending = await launchCurrentTaskReadOnlyLanes(
			cwd,
			[
				{
					laneKind: "debug",
					workItemId: "work-1",
					generation: 1,
					relevantPaths: ["source.js"],
					resourceKeys: ["repo:debug"],
					workflowRunId: "read-only-debug",
				},
			],
			{
				spawn: async () => ({
					ok: true,
					data: { runId: "debug-1", asyncDir },
				}),
			},
		);
		assert.equal(pending.results[0].state, "running");
		writeFileSync(
			path.join(asyncDir, "status.json"),
			JSON.stringify({ state: "completed" }),
		);
		assert.deepEqual(reconcileReadOnlyLanes(cwd), []);
		assert.equal(
			Object.values(loadLaneStore(cwd).lanes).find(
				(lane) => lane.laneKind === "debug",
			)?.state,
			"running",
		);
		const reconciled = reconcileReadOnlyLaneRuns(cwd);
		assert.equal(reconciled.reconciled.length, 1);
		assert(
			reconciled.lanes.some(
				(lane) => lane.laneKind === "debug" && lane.state === "promoted",
			),
		);
	}

	{
		const { cwd, git } = repository();
		const head = git("rev-parse", "HEAD");
		seedNativeStore(cwd, [
			{
				id: "roadmap-status",
				type: "epic",
				status: "open",
				title: "Status roadmap",
			},
		]);
		queueLane(cwd, envelope(cwd, head, 1, "status"));
		const hooks = {};
		workModelsExtension({
			on(name, handler) {
				hooks[name] = handler;
			},
			registerCommand() {},
		});
		const notifications = [];
		const ctx = {
			cwd,
			mode: "rpc",
			sessionManager: { getBranch: () => [], getSessionId: () => "lane-test" },
			ui: {
				notify(message) {
					notifications.push(message);
				},
				setStatus() {},
				setTitle() {},
				setWidget() {},
			},
		};
		const laneLock = path.join(path.dirname(laneStorePath(cwd)), "mutation.lock");
		writeFileSync(
			laneLock,
			`${JSON.stringify({ pid: process.pid, host: os.hostname() })}\n`,
		);
		assert.doesNotThrow(() => hooks.session_start({}, ctx));
		assert.match(notifications.at(-1), /work-orchestrator loaded/);
		let result = await executeOrchestratorAction(
			"work-status",
			"roadmap-status",
			ctx,
			{},
		);
		assert.equal(result.ok, true);
		assert.match(notifications.at(-1), /Read-only lanes: unavailable/);
		rmSync(laneLock, { force: true });

		writeFileSync(laneStorePath(cwd), "not json\n");
		assert.doesNotThrow(() => hooks.session_start({}, ctx));
		assert.match(notifications.at(-1), /work-orchestrator loaded/);
		result = await executeOrchestratorAction(
			"work-status",
			"roadmap-status",
			ctx,
			{},
		);
		assert.equal(result.ok, true);
		assert.match(notifications.at(-1), /Read-only lanes: unavailable/);
		await hooks.session_shutdown({}, ctx);
	}

	console.log("read-only parallel lane tests passed");
} finally {
	for (const root of roots) rmSync(root, { recursive: true, force: true });
}
