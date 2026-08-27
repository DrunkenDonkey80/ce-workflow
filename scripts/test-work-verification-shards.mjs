#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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
	acquireRepositoryMutationLock,
	admitVerificationManifest,
	normalizeVerificationShards,
	runVerificationShardBatch,
	VERIFICATION_GATE_VERSION,
} from "../extensions/read-only-lanes.js";
import { runFrozenCandidateVerification } from "../extensions/work-models.js";

const previousConfigDir = process.env.PI_CODING_AGENT_DIR;
const globalSettingsDir = mkdtempSync(
	path.join(os.tmpdir(), "ce-verification-settings-"),
);
process.env.PI_CODING_AGENT_DIR = globalSettingsDir;
writeFileSync(path.join(globalSettingsDir, "settings.json"), "{}\n");
const roots = [];
function repository() {
	const cwd = mkdtempSync(path.join(os.tmpdir(), "ce-verification-shards-"));
	roots.push(cwd);
	const git = (...args) =>
		execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" }).trim();
	git("init", "-q");
	git("config", "user.email", "shards@example.invalid");
	git("config", "user.name", "Shard Test");
	mkdirSync(path.join(cwd, ".ce-workflow"), { recursive: true });
	writeFileSync(path.join(cwd, "source.js"), "export const value = 1;\n");
	writeFileSync(path.join(cwd, ".ce-workflow", "work-items.json"), "{}\n");
	git("add", "source.js", ".ce-workflow/work-items.json");
	git("commit", "-qm", "initial");
	return { cwd, git };
}
async function runLocked(cwd, input, runner, options = {}) {
	const mutation = acquireRepositoryMutationLock(cwd);
	try {
		return await runVerificationShardBatch(cwd, input, runner, {
			...options,
			mutationOwner: true,
		});
	} finally {
		mutation.release();
	}
}
function expected(batch, input, extra = {}) {
	return {
		shards: batch.declarations,
		...batch.admission,
		authoritativeCommand: input.authoritativeCommand,
		currentFingerprint: batch.currentFingerprint,
		gateVersion: VERIFICATION_GATE_VERSION,
		...extra,
	};
}
function clone(value) {
	return structuredClone(value);
}
function rejected(manifest, facts, message) {
	assert.throws(
		() => admitVerificationManifest(manifest, facts),
		(error) => error?.category === "admission",
		message,
	);
}

try {
	assert.throws(
		() =>
			normalizeVerificationShards([
				{ id: "advisory", command: "lint", required: false },
			]),
		/cannot be optional/,
		"all declared verification shards are required",
	);
	const validShard = { id: "valid", command: "test" };
	const invalidShards = [
		["empty", []],
		["invalid id", [{ ...validShard, id: "bad id" }]],
		["missing command", [{ id: "valid" }]],
		["duplicate ids", [validShard, validShard]],
		["self dependency", [{ ...validShard, dependsOn: ["valid"] }]],
		["missing dependency", [{ ...validShard, dependsOn: ["missing"] }]],
		[
			"dependency cycle",
			[
				{ ...validShard, id: "a", dependsOn: ["b"] },
				{ ...validShard, id: "b", dependsOn: ["a"] },
			],
		],
		...[
			"../escape",
			"/abs",
			"build\\output",
			".git/config",
			".ce-workflow/state",
			".pi/state",
		].map((output) => [
			`invalid output ${output}`,
			[{ ...validShard, outputs: [output] }],
		]),
	];
	for (const [message, shards] of invalidShards)
		assert.throws(
			() => normalizeVerificationShards(shards),
			(error) => error?.category === "invalid",
			message,
		);

	{
		const { cwd } = repository();
		const shards = [
			{
				id: "compile",
				command: "compile",
				resourceKeys: ["cpu:a"],
				outputs: ["build/compile"],
			},
			{
				id: "lint",
				command: "lint",
				resourceKeys: ["cpu:b"],
				outputs: ["build/lint"],
			},
			{
				id: "test",
				command: "test",
				dependsOn: ["compile"],
				resourceKeys: ["cpu:a"],
				outputs: ["build/test"],
			},
		];
		const input = {
			shards,
			authoritativeCommand: "compile && lint && test",
			reviews: [
				{
					batchId: "batch-1",
					checkpoint: "a".repeat(40),
					model: "fixture/reviewer",
					status: "queued",
				},
			],
		};
		const durations = new Map([
			["compile", 30],
			["lint", 40],
			["test", 20],
		]);
		let active = 0;
		let maximum = 0;
		const runningClaims = new Set();
		const started = [];
		const batch = await runLocked(
			cwd,
			input,
			async (shard) => {
				assert(shard.resourceKeys.every((key) => !runningClaims.has(key)));
				started.push(shard.id);
				for (const key of shard.resourceKeys) runningClaims.add(key);
				active += 1;
				maximum = Math.max(maximum, active);
				mkdirSync(path.join(cwd, shard.outputs[0]), { recursive: true });
				writeFileSync(path.join(cwd, shard.outputs[0], "result.txt"), shard.id);
				await new Promise((resolve) => setImmediate(resolve));
				active -= 1;
				for (const key of shard.resourceKeys) runningClaims.delete(key);
				return {
					exitStatus: 0,
					stdout: `${shard.id}\n`,
					virtualDurationMs: durations.get(shard.id),
				};
			},
			{ maxConcurrency: 2 },
		);
		assert.equal(maximum, 2, "independent shards overlap to the bound");
		assert.deepEqual(started.slice(0, 2), ["compile", "lint"]);
		assert.equal(batch.manifest.metrics.maxConcurrency, 2);
		assert.equal(batch.manifest.metrics.criticalPathMs, 50);
		assert.equal(batch.manifest.metrics.sumShardMs, 90);
		assert(
			batch.manifest.metrics.sumShardMs > batch.manifest.metrics.criticalPathMs,
		);
		assert.deepEqual(
			batch.manifest.shards.map(({ id, status }) => ({ id, status })),
			shards.map(({ id }) => ({ id, status: "PASS" })),
			"manifest evidence is stable in declaration order",
		);
		for (const result of batch.manifest.shards) {
			assert.equal(
				result.command,
				shards.find(({ id }) => id === result.id).command,
			);
			assert.equal(result.exitStatus, 0);
			assert.equal(result.baseHead, batch.manifest.baseHead);
			assert.equal(
				result.sourceFingerprint,
				batch.manifest.sourceFingerprint.digest,
			);
			assert.equal(result.gateVersion, VERIFICATION_GATE_VERSION);
			assert.match(result.outputHash, /^[0-9a-f]{64}$/);
			assert(result.outputTail.length <= 500);
			assert(Number.isFinite(result.durationMs));
			assert(Number.isFinite(result.virtualDurationMs));
		}
		assert.equal(
			admitVerificationManifest(batch.manifest, expected(batch, input)),
			batch.manifest,
		);

		for (const [label, forge] of [
			["schema", (m) => (m.schemaVersion = 2)],
			["gate", (m) => (m.gateVersion = "wrong")],
			["invocation", (m) => (m.invocationId = "stale")],
			["head", (m) => (m.baseHead = "b".repeat(40))],
			["fingerprint", (m) => (m.sourceFingerprint.digest = "c".repeat(64))],
			["command", (m) => (m.shards[0].command = "forged")],
			["missing", (m) => m.shards.pop()],
			["duplicate", (m) => (m.shards[1].id = m.shards[0].id)],
			["non-pass", (m) => (m.shards[0].status = "FAIL")],
			["extra-field", (m) => (m.forged = true)],
		]) {
			const forged = clone(batch.manifest);
			forge(forged);
			rejected(forged, expected(batch, input), `${label} manifest fails closed`);
		}
		const late = clone(batch.manifest);
		rejected(
			late,
			expected(batch, input, { notAfter: "2000-01-01T00:00:00.000Z" }),
			"late manifest fails closed",
		);
	}

	{
		const { cwd } = repository();
		const realNow = Date.now;
		Date.now = () => 1_000;
		try {
			const batch = await runLocked(
				cwd,
				{
					shards: [{ id: "instant", command: "instant" }],
					authoritativeCommand: "instant",
				},
				async () => ({ exitStatus: 0 }),
				{ maxConcurrency: 1 },
			);
			assert.equal(batch.manifest.shards[0].virtualDurationMs, 1);
			assert.equal(batch.manifest.metrics.maxConcurrency, 1);
			assert.equal(batch.manifest.metrics.criticalPathMs, 1);
			assert.equal(batch.manifest.metrics.sumShardMs, 1);
		} finally {
			Date.now = realNow;
		}
	}

	{
		const { cwd } = repository();
		const shards = [
			{ id: "left", command: "left", outputs: ["build/shared"] },
			{ id: "right", command: "right", outputs: ["build/shared/nested"] },
			{ id: "free", command: "free", outputs: ["build/free"] },
		];
		const active = new Set();
		let overlap = false;
		let collision = false;
		await runLocked(
			cwd,
			{ shards, authoritativeCommand: "left && right && free" },
			async (shard) => {
				if (shard.id === "right" && active.has("left")) collision = true;
				if (shard.id === "left" && active.has("right")) collision = true;
				active.add(shard.id);
				if (active.has("free") && (active.has("left") || active.has("right")))
					overlap = true;
				await new Promise((resolve) => setImmediate(resolve));
				active.delete(shard.id);
				return { exitStatus: 0, virtualDurationMs: 10 };
			},
			{ maxConcurrency: 3 },
		);
		assert.equal(collision, false, "overlapping output claims serialize");
		assert.equal(overlap, true, "noncolliding output claims overlap");
	}

	{
		const { cwd } = repository();
		const shards = [
			{ id: "fail", command: "fail" },
			{ id: "settle", command: "settle" },
			{ id: "queued", command: "queued", dependsOn: ["settle"] },
		];
		const starts = [];
		const batch = await runLocked(
			cwd,
			{ shards, authoritativeCommand: "fail && settle && queued" },
			async (shard) => {
				starts.push(shard.id);
				await new Promise((resolve) => setImmediate(resolve));
				return {
					exitStatus: shard.id === "fail" ? 1 : 0,
					virtualDurationMs: 10,
				};
			},
			{ maxConcurrency: 2, failFast: true },
		);
		assert.deepEqual(starts, ["fail", "settle"]);
		assert.deepEqual(
			batch.manifest.shards.map(({ status }) => status),
			["FAIL", "PASS", "SKIPPED"],
			"queued starts are suppressed while the running sibling settles",
		);
	}

	{
		const { cwd } = repository();
		const batch = await runLocked(
			cwd,
			{
				shards: [{ id: "exit-seven", command: "exit 7" }],
				authoritativeCommand: "exit 7",
			},
			async () => {
				const error = new Error("exit 7");
				error.code = 7;
				throw error;
			},
		);
		assert.equal(
			batch.manifest.shards[0].exitStatus,
			7,
			"promisified child-process error codes are preserved",
		);
	}

	{
		const { cwd, git } = repository();
		const storeFile = path.join(cwd, ".ce-workflow", "work-items.json");
		const storeBefore = readFileSync(storeFile, "utf8");
		const headBefore = git("rev-parse", "HEAD");
		const batch = await runLocked(
			cwd,
			{
				shards: [{ id: "mutate", command: "mutate" }],
				authoritativeCommand: "mutate",
			},
			async () => {
				writeFileSync(path.join(cwd, "source.js"), "export const value = 2;\n");
				return { exitStatus: 0 };
			},
		);
		assert.equal(batch.manifest.status, "FAIL");
		rejected(
			batch.manifest,
			expected(batch, { authoritativeCommand: "mutate" }),
			"source mutation fails admission",
		);
		assert.equal(
			git("rev-parse", "HEAD"),
			headBefore,
			"mutation creates no commit",
		);
		assert.equal(
			readFileSync(storeFile, "utf8"),
			storeBefore,
			"mutation does not change WorkItems",
		);
	}

	{
		const { cwd } = repository();
		writeFileSync(path.join(cwd, "source.js"), "export const value = 3;\n");
		const frozen = await runFrozenCandidateVerification(
			cwd,
			{
				shards: [
					{ id: "test-a", command: "test-a" },
					{ id: "test-b", command: "test-b" },
				],
				authoritativeCommand: "test-a && test-b",
				profiles: [
					{
						model: "fixture/reviewer",
						operations: ["correctness"],
						thinking: "low",
					},
				],
			},
			async () => ({ exitStatus: 0, stdout: "ok", virtualDurationMs: 5 }),
		);
		assert.match(frozen.checkpoint.snapshot, /^[0-9a-f]{40}$/);
		assert.equal(frozen.verifier.status, "queued");
		assert.deepEqual(frozen.manifest.reviews, [
			{
				batchId: frozen.verifier.batch.id,
				checkpoint: frozen.checkpoint.snapshot,
				model: "fixture/reviewer",
				status: "queued",
			},
		]);
		assert.equal(frozen.manifest.status, "PASS");
		assert.equal(
			frozen.manifest.metrics.maxConcurrency,
			1,
			"frozen verification defaults to sequential shards",
		);
	}

	{
		const { cwd } = repository();
		const shards = [
			{ id: "one", command: "one" },
			{ id: "two", command: "two" },
		];
		const parallelStarts = [];
		const serialStarts = [];
		const input = { shards, authoritativeCommand: "one && two" };
		const parallel = await runLocked(cwd, input, async (shard) => {
			parallelStarts.push(shard.command);
			return { exitStatus: 0, virtualDurationMs: 5 };
		});
		const serial = await runLocked(
			cwd,
			{ ...input, invocationId: "verify-serial-parity" },
			async (shard) => {
				serialStarts.push(shard.command);
				return { exitStatus: 0, virtualDurationMs: 5 };
			},
			{ serial: true },
		);
		assert.deepEqual(serialStarts, parallelStarts);
		assert.deepEqual(
			serial.manifest.shards.map(({ command, status }) => ({
				command,
				status,
			})),
			parallel.manifest.shards.map(({ command, status }) => ({
				command,
				status,
			})),
			"serial mode runs the identical required command set and gate decision",
		);
	}

	process.stdout.write(
		"ok - frozen verification shard scheduling and admission\n",
	);
} finally {
	if (previousConfigDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = previousConfigDir;
	for (const cwd of roots) rmSync(cwd, { recursive: true, force: true });
	rmSync(globalSettingsDir, { recursive: true, force: true });
}
