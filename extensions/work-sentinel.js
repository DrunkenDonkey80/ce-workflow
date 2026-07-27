import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import {
	createLaneEnvelope,
	laneStorePath,
	loadLaneStore,
	mutateLaneStore,
	promoteLane,
	runReadOnlyLaneBatch,
	transitionLane,
} from "./read-only-lanes.js";
import {
	captureVerifierCheckpoint,
	scheduleVerifierBatch,
} from "./background-verifiers.js";

export const SENTINEL_ARTIFACT_VERSION = 1;
export const SENTINEL_STALE_REASONS = Object.freeze({
	cancelled: "cancelled",
	expired: "expired",
	generation: "generation-changed",
	head: "head-changed",
	workItem: "work-item-changed",
	plan: "plan-changed",
	workflowBuild: "workflow-build-changed",
	consumptionFrontier: "consumption-frontier-changed",
	invalidArtifact: "invalid-artifact",
});

const ARTIFACT_KEYS = [
	"version",
	"workItemId",
	"baseHead",
	"workItemHash",
	"planHash",
	"generation",
	"workflowBuild",
	"expiresAt",
	"invariants",
	"risks",
	"focusedChecks",
].sort();

function digest(value) {
	return createHash("sha256")
		.update(typeof value === "string" ? value : JSON.stringify(value ?? null))
		.digest("hex");
}
function head(cwd) {
	return execFileSync("git", ["rev-parse", "HEAD"], {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	}).trim();
}
function strings(value) {
	return (
		Array.isArray(value) && value.every((entry) => typeof entry === "string")
	);
}
function checkpoint(lane) {
	try {
		return JSON.parse(lane.checkpoint);
	} catch {
		return {};
	}
}
function validArtifact(artifact) {
	return (
		artifact &&
		typeof artifact === "object" &&
		!Array.isArray(artifact) &&
		JSON.stringify(Object.keys(artifact).sort()) ===
			JSON.stringify(ARTIFACT_KEYS) &&
		artifact.version === SENTINEL_ARTIFACT_VERSION &&
		typeof artifact.workItemId === "string" &&
		/^[0-9a-f]{7,64}$/i.test(artifact.baseHead ?? "") &&
		typeof artifact.workItemHash === "string" &&
		typeof artifact.planHash === "string" &&
		Number.isInteger(artifact.generation) &&
		artifact.generation > 0 &&
		typeof artifact.workflowBuild === "string" &&
		Number.isFinite(Date.parse(artifact.expiresAt)) &&
		strings(artifact.invariants) &&
		strings(artifact.risks) &&
		strings(artifact.focusedChecks)
	);
}
function staleReason(lane, expected = {}, now = Date.now()) {
	const artifact = lane.artifact;
	if (!validArtifact(artifact)) return SENTINEL_STALE_REASONS.invalidArtifact;
	if (expected.cancelled === true) return SENTINEL_STALE_REASONS.cancelled;
	if (now >= Date.parse(artifact.expiresAt))
		return SENTINEL_STALE_REASONS.expired;
	if (
		expected.generation !== undefined &&
		artifact.generation !== expected.generation
	)
		return SENTINEL_STALE_REASONS.generation;
	if (
		expected.baseHead !== undefined &&
		artifact.baseHead !== expected.baseHead
	)
		return SENTINEL_STALE_REASONS.head;
	if (
		expected.workItemHash !== undefined &&
		artifact.workItemHash !== expected.workItemHash
	)
		return SENTINEL_STALE_REASONS.workItem;
	if (
		expected.planHash !== undefined &&
		artifact.planHash !== expected.planHash
	)
		return SENTINEL_STALE_REASONS.plan;
	if (
		expected.workflowBuild !== undefined &&
		artifact.workflowBuild !== expected.workflowBuild
	)
		return SENTINEL_STALE_REASONS.workflowBuild;
	if (
		expected.consumptionFrontier !== undefined &&
		checkpoint(lane).consumptionFrontier !== expected.consumptionFrontier
	)
		return SENTINEL_STALE_REASONS.consumptionFrontier;
	return null;
}

export function createSentinelLane(cwd, input = {}) {
	const baseHead = input.baseHead ?? head(cwd);
	const scope = {
		workItemId: input.workItemId,
		baseHead,
		workItemHash: input.workItemHash,
		planHash: input.planHash,
		generation: input.generation ?? 1,
		workflowBuild: input.workflowBuild,
		expiresAt: input.expiresAt,
		consumptionFrontier: input.consumptionFrontier,
	};
	if (
		![
			scope.workItemId,
			scope.workItemHash,
			scope.planHash,
			scope.workflowBuild,
			scope.expiresAt,
		].every((value) => typeof value === "string" && value.length > 0) ||
		!Number.isInteger(scope.generation) ||
		scope.generation < 1 ||
		!Number.isFinite(Date.parse(scope.expiresAt))
	)
		throw new Error("Invalid Sentinel scope");
	return createLaneEnvelope({
		repository: realpathSync(cwd),
		laneKind: "sentinel",
		producer: "work-sentinel",
		workItemId: scope.workItemId,
		generation: scope.generation,
		baseHead,
		checkpoint: JSON.stringify({
			baseHead,
			consumptionFrontier: scope.consumptionFrontier,
		}),
		workItemHash: scope.workItemHash,
		selectionHash: digest({
			planHash: scope.planHash,
			workflowBuild: scope.workflowBuild,
			expiresAt: scope.expiresAt,
			consumptionFrontier: scope.consumptionFrontier,
			relevantPaths: input.relevantPaths ?? [],
			resourceKeys: input.resourceKeys ?? [],
		}),
		relevantPaths: input.relevantPaths ?? [],
		resourceKeys: ["repo:read", ...(input.resourceKeys ?? [])],
		gateVersion: `sentinel-v${SENTINEL_ARTIFACT_VERSION}`,
		settingsVersion: digest({ enabled: true }),
		promotionOwner: "work-sentinel",
		now: input.now,
	});
}

export function consumeSentinelArtifact(cwd, laneId, expected = {}) {
	const lane = loadLaneStore(cwd).lanes[laneId];
	if (!lane) return { status: "absent", reason: "sentinel-absent" };
	if (lane.state === "failed")
		return { status: "failed", reason: lane.failureReason, lane };
	if (lane.state === "discarded")
		return { status: "stale", reason: lane.discardReason, lane };
	if (!lane.artifact)
		return { status: lane.state, reason: "sentinel-pending", lane };
	const at =
		typeof expected.now === "number"
			? expected.now
			: Date.parse(expected.now ?? "");
	const reason = staleReason(
		lane,
		expected,
		Number.isFinite(at) ? at : Date.now(),
	);
	if (reason) {
		if (lane.state === "completed")
			transitionLane(cwd, lane.id, "discarded", { reason });
		return { status: "stale", reason, lane: loadLaneStore(cwd).lanes[lane.id] };
	}
	const promoted =
		lane.state === "completed"
			? promoteLane(cwd, lane.id, lane.promotionOwner)
			: lane;
	if (promoted.state !== "promoted")
		return {
			status: "stale",
			reason: promoted.discardReason,
			lane: promoted,
		};
	return {
		status: "ready",
		reason: null,
		artifact: promoted.artifact,
		lane: promoted,
	};
}

export async function runAdvisorySentinel(cwd, input = {}, adapter = {}) {
	if (input.enabled !== true)
		return { status: "disabled", reason: "sentinel-disabled", launched: false };
	let lane;
	try {
		lane = createSentinelLane(cwd, input);
		let created = false;
		const stored = mutateLaneStore(
			cwd,
			(store) => {
				if (store.lanes[lane.id]) return store.lanes[lane.id];
				created = true;
				return (store.lanes[lane.id] = structuredClone(lane));
			},
			{ now: input.now },
		);
		if (!created) {
			const consumed = consumeSentinelArtifact(cwd, stored.id, input);
			return { ...consumed, launched: false, coalesced: true };
		}
		if (input.cancelled === true) {
			transitionLane(cwd, lane.id, "discarded", {
				reason: "cancelled",
				now: input.now,
			});
			return { status: "stale", reason: "cancelled", launched: false, lane };
		}
		if (typeof adapter.analyze !== "function") {
			transitionLane(cwd, lane.id, "failed", {
				reason: "adapter-unavailable",
				now: input.now,
			});
			return {
				status: "failed",
				reason: "adapter-unavailable",
				launched: false,
			};
		}
		const batch = await runReadOnlyLaneBatch(
			cwd,
			[lane],
			async (activeLane) => {
				const analysis = await adapter.analyze({
					lane: activeLane,
					scope: input,
				});
				return {
					artifact: {
						version: SENTINEL_ARTIFACT_VERSION,
						workItemId: input.workItemId,
						baseHead: activeLane.baseHead,
						workItemHash: input.workItemHash,
						planHash: input.planHash,
						generation: activeLane.generation,
						workflowBuild: input.workflowBuild,
						expiresAt: input.expiresAt,
						invariants: analysis?.invariants,
						risks: analysis?.risks,
						focusedChecks: analysis?.focusedChecks,
					},
					durationMs: analysis?.durationMs,
				};
			},
			{ deferPromotion: true, maxConcurrency: 1, serial: input.serial },
		);
		if (batch.results[0]?.state === "failed")
			return {
				status: "failed",
				reason: batch.results[0].reason,
				launched: true,
			};
		const current =
			typeof input.currentScope === "function" ? input.currentScope() : input;
		return {
			...consumeSentinelArtifact(cwd, lane.id, current),
			launched: true,
		};
	} catch (error) {
		return {
			status: "failed",
			reason: error instanceof Error ? error.message : String(error),
			launched: Boolean(lane),
		};
	}
}

export function sentinelStatus(cwd, expected = {}) {
	if (!existsSync(laneStorePath(cwd)))
		return { status: "absent", reason: "sentinel-absent" };
	const lanes = Object.values(loadLaneStore(cwd).lanes)
		.filter(
			(lane) =>
				lane.laneKind === "sentinel" &&
				(!expected.workItemId || lane.workItemId === expected.workItemId),
		)
		.sort(
			(left, right) =>
				right.generation - left.generation ||
				right.timestamps.queuedAt.localeCompare(left.timestamps.queuedAt),
		);
	if (!lanes.length) return { status: "absent", reason: "sentinel-absent" };
	return consumeSentinelArtifact(cwd, lanes[0].id, expected);
}

export function scheduleSentinelFrozenDiff(cwd, input = {}) {
	if (input.enabled !== true)
		return {
			status: "disabled",
			reason: "sentinel-frozen-diff-disabled",
			launch: Promise.resolve([]),
		};
	try {
		const checkpoint =
			input.checkpoint ?? captureVerifierCheckpoint(cwd, input);
		return scheduleVerifierBatch(cwd, {
			...input,
			checkpoint,
			origin: "sentinel-frozen-diff",
		});
	} catch (error) {
		return {
			status: "not-scheduled",
			reason: error instanceof Error ? error.message : String(error),
			launch: Promise.resolve([]),
		};
	}
}
