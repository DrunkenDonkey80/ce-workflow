#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	laneStorePath,
	loadLaneStore,
	queueLane,
} from "../extensions/read-only-lanes.js";
import { captureVerifierCheckpoint } from "../extensions/background-verifiers.js";
import {
	SENTINEL_ARTIFACT_VERSION,
	createSentinelLane,
	runAdvisorySentinel,
	scheduleSentinelFrozenDiff,
	sentinelStatus,
} from "../extensions/work-sentinel.js";

const roots = [];
function repository() {
	const cwd = mkdtempSync(path.join(os.tmpdir(), "ce-work-sentinel-"));
	roots.push(cwd);
	const git = (...args) =>
		execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" }).trim();
	git("init", "-q");
	git("config", "user.email", "sentinel@example.invalid");
	git("config", "user.name", "Sentinel Test");
	writeFileSync(path.join(cwd, "source.js"), "export const value = 1;\n");
	git("add", "source.js");
	git("commit", "-qm", "initial");
	return { cwd, git };
}
function scope(head, overrides = {}) {
	return {
		enabled: true,
		workItemId: "work-1",
		baseHead: head,
		workItemHash: "work-hash-1",
		planHash: "plan-hash-1",
		generation: 1,
		workflowBuild: "build-1",
		expiresAt: "2099-01-01T00:00:00.000Z",
		consumptionFrontier: "implementation-start",
		relevantPaths: ["source.js"],
		now: "2026-07-27T00:00:00.000Z",
		...overrides,
	};
}
const analysis = {
	invariants: ["preserve public behavior"],
	risks: ["stale input"],
	focusedChecks: ["node focused.mjs"],
	durationMs: 1,
};

try {
	{
		const { cwd, git } = repository();
		let launches = 0;
		const disabled = await runAdvisorySentinel(
			cwd,
			{ ...scope(git("rev-parse", "HEAD")), enabled: false },
			{ analyze: async () => (launches += 1) },
		);
		assert.deepEqual(disabled, {
			status: "disabled",
			reason: "sentinel-disabled",
			launched: false,
		});
		assert.equal(launches, 0);
		assert.equal(existsSync(laneStorePath(cwd)), false);
		assert.equal(scheduleSentinelFrozenDiff(cwd).status, "disabled");
	}

	{
		const { cwd } = repository();
		const checkpoint = captureVerifierCheckpoint(cwd, { scope: "project" });
		let launches = 0;
		const frozen = scheduleSentinelFrozenDiff(cwd, {
			enabled: true,
			checkpoint,
			origin: "verifier-fix",
			profiles: [
				{
					model: "fixture/sentinel",
					operations: ["correctness"],
					thinking: "low",
				},
			],
			adapter: {
				enforcesReadOnlyBoundary: true,
				async spawn(request) {
					launches += 1;
					assert.deepEqual(request.checkpoint, checkpoint);
					return { ok: false, message: "fixture terminal" };
				},
			},
		});
		assert.equal(
			frozen.status,
			"queued",
			"Sentinel origin overrides verifier-fix suppression",
		);
		assert.deepEqual(frozen.batch.checkpoint, checkpoint);
		await frozen.launch;
		assert.equal(launches, 1);
	}

	{
		const { cwd, git } = repository();
		const head = git("rev-parse", "HEAD");
		let launches = 0;
		const adapter = {
			analyze: async ({ lane }) => {
				launches += 1;
				assert.equal(lane.laneKind, "sentinel");
				assert.equal(lane.baseHead, head);
				return analysis;
			},
		};
		const first = await runAdvisorySentinel(cwd, scope(head), adapter);
		assert.equal(first.status, "ready");
		assert.equal(first.launched, true);
		assert.equal(first.artifact.version, SENTINEL_ARTIFACT_VERSION);
		assert.deepEqual(Object.keys(first.artifact).sort(), [
			"baseHead",
			"expiresAt",
			"focusedChecks",
			"generation",
			"invariants",
			"planHash",
			"risks",
			"version",
			"workItemHash",
			"workItemId",
			"workflowBuild",
		]);
		const duplicate = await runAdvisorySentinel(cwd, scope(head), adapter);
		assert.equal(duplicate.status, "ready");
		assert.equal(duplicate.coalesced, true);
		assert.equal(duplicate.launched, false);
		assert.equal(launches, 1, "identical generation and scope launch once");
		assert.equal(
			Object.values(loadLaneStore(cwd).lanes).filter(
				(lane) => lane.laneKind === "sentinel" && lane.state === "promoted",
			).length,
			1,
		);

		const staleCases = [
			[{ generation: 2 }, "generation-changed"],
			[{ baseHead: "a".repeat(40) }, "head-changed"],
			[{ workItemHash: "work-hash-2" }, "work-item-changed"],
			[{ planHash: "plan-hash-2" }, "plan-changed"],
			[{ workflowBuild: "build-2" }, "workflow-build-changed"],
			[{ consumptionFrontier: "review-start" }, "consumption-frontier-changed"],
			[{ cancelled: true }, "cancelled"],
			[{ now: "2100-01-01T00:00:00.000Z" }, "expired"],
		];
		for (const [changed, reason] of staleCases) {
			const status = sentinelStatus(cwd, { ...scope(head), ...changed });
			assert.equal(status.status, "stale");
			assert.equal(status.reason, reason);
		}

		const next = await runAdvisorySentinel(
			cwd,
			scope(head, { generation: 2 }),
			adapter,
		);
		assert.equal(next.status, "ready");
		assert.equal(
			launches,
			2,
			"a changed generation launches only when explicitly requested",
		);
		assert.equal(
			sentinelStatus(cwd, scope(head, { generation: 2 })).status,
			"ready",
		);
	}

	{
		const { cwd, git } = repository();
		const head = git("rev-parse", "HEAD");
		const superseded = await runAdvisorySentinel(cwd, scope(head), {
			analyze: async () => {
				queueLane(cwd, createSentinelLane(cwd, scope(head, { generation: 2 })));
				return analysis;
			},
		});
		assert.equal(superseded.status, "stale");
		assert.equal(superseded.reason, "stale-generation");
		assert.equal(superseded.lane.state, "discarded");
		assert.equal(superseded.artifact, undefined);
	}

	{
		const { cwd, git } = repository();
		const head = git("rev-parse", "HEAD");
		let launches = 0;
		const failed = await runAdvisorySentinel(cwd, scope(head), {
			analyze: async () => {
				launches += 1;
				throw new Error("fixture sentinel failure");
			},
		});
		assert.equal(failed.status, "failed");
		const retry = await runAdvisorySentinel(cwd, scope(head), {
			analyze: async () => {
				launches += 1;
				return analysis;
			},
		});
		assert.equal(retry.status, "failed");
		assert.equal(retry.coalesced, true);
		assert.equal(launches, 1, "failed Sentinel never auto-runs again");
		assert.equal(sentinelStatus(cwd, scope(head)).status, "failed");
	}

	{
		const { cwd, git } = repository();
		const cancelled = await runAdvisorySentinel(
			cwd,
			scope(git("rev-parse", "HEAD"), { cancelled: true }),
			{ analyze: async () => assert.fail("cancelled Sentinel launched") },
		);
		assert.equal(cancelled.status, "stale");
		assert.equal(cancelled.reason, "cancelled");
		const lane = Object.values(loadLaneStore(cwd).lanes)[0];
		assert.equal(lane.state, "discarded");
		assert.equal(lane.discardReason, "cancelled");
	}

	process.stdout.write("ok - bounded advisory Sentinel reuse fixtures\n");
} finally {
	for (const root of roots) rmSync(root, { recursive: true, force: true });
}
