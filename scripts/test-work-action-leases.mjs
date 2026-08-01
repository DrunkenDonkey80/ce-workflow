#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	acknowledgeWorkActionLease,
	acquireWorkActionLease,
	currentWorkActionLeases,
	fenceWorkActionLease,
	occupiedWorkActionLease,
	reconcileWorkActionLeaseLiveness,
	settleWorkActionLease,
} from "../extensions/work-action-leases.js";
import {
	appendWorkNote,
	createWorkItem,
	initStore,
	loadStore,
	saveStore,
	updateWorkItem,
} from "../extensions/work-store.js";
import {
	driveWorkActionLeases,
	launchDirectAction,
	reconcilePendingDirectRuns,
	resumePausedWorkActionLease,
	recordPendingDirectRun,
} from "../extensions/work-models.js";
import {
	createLaneEnvelope,
	queueLane,
	runReadOnlyLaneBatch,
} from "../extensions/read-only-lanes.js";

function assert(value, message) {
	if (!value) throw new Error(message);
}
function git(cwd, ...args) {
	return execFileSync("git", args, {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	}).trim();
}
function fixture(mode) {
	const cwd = mkdtempSync(path.join(tmpdir(), `work-action-${mode}-`));
	git(cwd, "init", "-q");
	git(cwd, "config", "user.email", "fixture@example.invalid");
	git(cwd, "config", "user.name", "Fixture");
	mkdirSync(path.join(cwd, "src"));
	writeFileSync(path.join(cwd, "src", "a.js"), "export const value = 1;\n");
	writeFileSync(
		path.join(cwd, ".gitignore"),
		".ce-workflow/\n.pi-subagents/\n.pi/\n",
	);
	git(cwd, "add", "src/a.js", ".gitignore");
	git(cwd, "commit", "-qm", "fixture");
	const store = initStore(cwd);
	createWorkItem(store, {
		id: "E-1",
		type: "epic",
		status: "in_progress",
		title: "Lease roadmap",
	});
	createWorkItem(store, {
		id: "W-1",
		type: "task",
		status: "in_progress",
		title: "Lease slice",
		parentId: "E-1",
		acceptance: "focused check passes",
		notes: ["Files changed: src/a.js\nVerification: node fixture passed"],
	});
	saveStore(cwd, store);
	return { cwd, store };
}

for (const mode of ["tui", "rpc", "autonomous"]) {
	const { cwd, store } = fixture(mode);
	try {
		const ambiguous = acquireWorkActionLease(cwd, {
			workflowRunId: `${mode}-ambiguous`,
			roadmapId: "E-1",
			workItemId: "W-1",
			action: "run-review",
			semanticRole: "reviewer",
			requestedAssurance: "normal",
			mode,
			session: `${mode}-session`,
		});
		assert(
			ambiguous.baseHead &&
				ambiguous.baseStoreHash &&
				ambiguous.baseWorkItemHash,
			`${mode}: durable base fingerprints`,
		);
		assert(
			ambiguous.allowedEvidence.includes("review-verdict") &&
				ambiguous.launchIdentity === null,
			`${mode}: versioned role evidence and nullable identity`,
		);
		acknowledgeWorkActionLease(cwd, ambiguous.leaseId, { ambiguous: true });
		assert(
			occupiedWorkActionLease(cwd)?.state === "ambiguous",
			`${mode}: identity-less acknowledgement remains occupied`,
		);
		let duplicateRejected = false;
		try {
			acquireWorkActionLease(cwd, {
				workflowRunId: "duplicate",
				roadmapId: "E-1",
				workItemId: "W-1",
				action: "run-fix",
			});
		} catch {
			duplicateRejected = true;
		}
		assert(duplicateRejected, `${mode}: no duplicate mutable writer`);
		fenceWorkActionLease(cwd, ambiguous.leaseId, "fixture-release");

		const stale = acquireWorkActionLease(cwd, {
			workflowRunId: `${mode}-stale`,
			roadmapId: "E-1",
			workItemId: "W-1",
			action: "run-review",
			semanticRole: "reviewer",
			mode,
		});
		updateWorkItem(store, "W-1", { acceptance: "manually changed acceptance" });
		saveStore(cwd, store);
		assert(
			settleWorkActionLease(cwd, stale.leaseId, { ok: true }).reason ===
				"stale-work-item",
			`${mode}: stale WorkItem contract is rejected`,
		);
		fenceWorkActionLease(cwd, stale.leaseId, "stale-fixture-release");
		updateWorkItem(store, "W-1", { acceptance: "focused check passes" });
		saveStore(cwd, store);

		const statusDir = path.join(cwd, ".pi-subagents", "reviewer");
		mkdirSync(statusDir, { recursive: true });
		writeFileSync(
			path.join(statusDir, "status.json"),
			JSON.stringify({ state: "completed", steps: [{ status: "completed" }] }),
		);
		const review = acquireWorkActionLease(cwd, {
			workflowRunId: `${mode}-review`,
			roadmapId: "E-1",
			workItemId: "W-1",
			action: "run-review",
			semanticRole: "reviewer",
			mode,
			session: `${mode}-session`,
		});
		acknowledgeWorkActionLease(cwd, review.leaseId, {
			runId: `${mode}-reviewer`,
			asyncDir: statusDir,
		});
		appendWorkNote(store, "W-1", "wo:review FAIL deterministic finding");
		saveStore(cwd, store);
		let requests = 0;
		let reply;
		const pi = {
			events: {
				on(_name, handler) {
					reply = handler;
					return () => {};
				},
				emit(_name, request) {
					requests += 1;
					queueMicrotask(() =>
						reply({
							success: true,
							data: {
								runId: `${mode}-fixer`,
								asyncDir: path.join(cwd, ".pi-subagents", "fixer"),
							},
						}),
					);
					assert(
						request.params.agent === "work-fixer",
						`${mode}: role-valid reviewer evidence routes exactly to fixer`,
					);
				},
			},
		};
		const driven = await driveWorkActionLeases(cwd, {
			pi,
			mode,
			session: `${mode}-session`,
		});
		assert(
			driven.length === 1 &&
				driven[0].action === "run-fix" &&
				driven[0].launched,
			`${mode}: one coded planResumeAction transition`,
		);
		assert(
			requests === 1,
			`${mode}: launches at most one specialist with zero parent continuation turns`,
		);
		const latest = currentWorkActionLeases(cwd).at(-1);
		assert(
			latest.action === "run-fix" && latest.mode === mode,
			`${mode}: next intent persisted through the same tracer`,
		);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
}

{
	const { cwd } = fixture("goal-handoff");
	try {
		const statusDir = path.join(cwd, ".pi-subagents", "authoritative-worker");
		mkdirSync(statusDir, { recursive: true });
		writeFileSync(
			path.join(statusDir, "status.json"),
			JSON.stringify({ state: "running", steps: [{ status: "running" }] }),
		);
		const active = acquireWorkActionLease(cwd, {
			workflowRunId: "medium-handoff",
			roadmapId: "E-1",
			workItemId: "W-1",
			action: "run-implementation",
			semanticRole: "builder",
			agent: "work-worker",
			session: "medium-session",
		});
		acknowledgeWorkActionLease(cwd, active.leaseId, {
			runId: "authoritative-worker",
			asyncDir: statusDir,
		});
		let launchRequests = 0;
		const duplicate = await launchDirectAction(
			cwd,
			{
				action: "run-implementation",
				epic: { id: "E-1" },
				selectedWorkItem: { id: "W-1", status: "in_progress" },
			},
			{
				agent: "work-worker",
				params: { agent: "work-worker", task: "duplicate" },
			},
			{ events: { emit: () => (launchRequests += 1) } },
			{
				workflowRunId: "goal-continuation",
				mode: "autonomous",
				session: "goal-session",
			},
		);
		const occupied = occupiedWorkActionLease(cwd, "W-1");
		assert(
			!duplicate.spawned.ok &&
				launchRequests === 0 &&
				occupied?.launchIdentity?.runId === "authoritative-worker",
			"goal continuation cannot relaunch a worker while the authoritative handoff lease is active",
		);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
}

{
	const { cwd } = fixture("stale-recovery");
	try {
		const input = (workflowRunId, claimed) => ({
			workflowRunId,
			roadmapId: "E-1",
			workItemId: "W-1",
			action: "run-fix",
			claimed,
		});
		for (const [state, prepare] of [
			["queued", (lease) => lease],
			["claimed", (lease) => lease],
			[
				"acknowledged",
				(lease) =>
					acknowledgeWorkActionLease(cwd, lease.leaseId, { runId: "known" }),
			],
			[
				"ambiguous",
				(lease) =>
					acknowledgeWorkActionLease(cwd, lease.leaseId, { ambiguous: true }),
			],
		]) {
			const lease = acquireWorkActionLease(
				cwd,
				input(`stale-${state}`, state !== "queued"),
			);
			prepare(lease);
			reconcileWorkActionLeaseLiveness(cwd, {
				now: Date.parse(lease.timestamp) + 2_000,
				orphanAfterMs: 1_000,
			});
			assert(
				currentWorkActionLeases(cwd).find(
					(item) => item.leaseId === lease.leaseId,
				)?.state === "fenced",
				`stale ${state} lease without asyncDir is fenced`,
			);
		}
		const missingDir = path.join(cwd, ".pi-subagents", "missing");
		const orphan = acquireWorkActionLease(cwd, input("stale-orphan"));
		acknowledgeWorkActionLease(cwd, orphan.leaseId, {
			runId: "missing",
			asyncDir: missingDir,
		});
		reconcileWorkActionLeaseLiveness(cwd, {
			now: Date.parse(orphan.timestamp) + 2_000,
			orphanAfterMs: 1_000,
		});
		assert(
			currentWorkActionLeases(cwd).find(
				(item) => item.leaseId === orphan.leaseId,
			)?.state === "orphaned",
			"missing launch becomes orphaned",
		);
		reconcileWorkActionLeaseLiveness(cwd, {
			now: Date.now() + 2_000,
			orphanAfterMs: 1_000,
		});
		assert(
			!occupiedWorkActionLease(cwd),
			"stale orphan is fenced and cannot wedge future admission",
		);
		const recovered = acquireWorkActionLease(cwd, input("after-recovery"));
		assert(
			recovered.state === "claimed",
			"writer admission recovers after stale leases",
		);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
}

{
	const { cwd } = fixture("paused-resume");
	try {
		const pausedDir = path.join(cwd, ".pi-subagents", "paused");
		const resumedDir = path.join(cwd, ".pi-subagents", "resumed");
		mkdirSync(pausedDir, { recursive: true });
		mkdirSync(resumedDir, { recursive: true });
		writeFileSync(
			path.join(pausedDir, "status.json"),
			JSON.stringify({ state: "paused", sessionFile: "child.jsonl" }),
		);
		const lease = acquireWorkActionLease(cwd, {
			workflowRunId: "paused-resume",
			roadmapId: "E-1",
			workItemId: "W-1",
			action: "run-implementation",
			semanticRole: "builder",
			agent: "work-worker",
			session: "resume-session",
		});
		acknowledgeWorkActionLease(cwd, lease.leaseId, {
			runId: "paused-run",
			asyncDir: pausedDir,
		});
		let reply;
		let request;
		const resumed = await resumePausedWorkActionLease(
			cwd,
			{
				events: {
					on(_name, handler) {
						reply = handler;
						return () => {};
					},
					emit(_name, value) {
						request = value;
						queueMicrotask(() =>
							reply({
								success: true,
								data: { runId: "resumed-run", asyncDir: resumedDir },
							}),
						);
					},
				},
			},
			"E-1",
			{ session: "resume-session", watch: false },
		);
		assert(
			resumed?.ok &&
				request?.method === "resume" &&
				request.params.id === "paused-run",
			"explicit workflow resume uses package-owned resume for the exact paused run",
		);
		const current = currentWorkActionLeases(cwd).find(
			(candidate) => candidate.leaseId === lease.leaseId,
		);
		assert(
			current?.launchIdentity?.runId === "resumed-run" &&
				current.launchIdentity.asyncDir === resumedDir,
			"resumed child identity replaces the paused lease identity",
		);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
}

for (const fence of ["stopping", "waiting_decision", "session-switch"]) {
	const { cwd, store } = fixture(`live-${fence}`);
	try {
		const statusDir = path.join(cwd, ".pi-subagents", fence);
		mkdirSync(statusDir, { recursive: true });
		writeFileSync(
			path.join(statusDir, "status.json"),
			JSON.stringify({ state: "completed", steps: [{ status: "completed" }] }),
		);
		const lease = acquireWorkActionLease(cwd, {
			workflowRunId: `live-${fence}`,
			roadmapId: "E-1",
			workItemId: "W-1",
			action: "run-review",
			semanticRole: "reviewer",
			session: "launch-session",
		});
		acknowledgeWorkActionLease(cwd, lease.leaseId, {
			runId: fence,
			asyncDir: statusDir,
		});
		appendWorkNote(store, "W-1", "wo:review FAIL live fence fixture");
		saveStore(cwd, store);
		let goalStatus = "active";
		let currentSession = "launch-session";
		let requests = 0;
		const runtime = {
			pi: {
				events: {
					on: () => () => {},
					emit: () => {
						requests += 1;
					},
				},
			},
			session: "launch-session",
			goalStatus: () => goalStatus,
			currentSession: () => currentSession,
		};
		if (fence === "session-switch") currentSession = "new-session";
		else goalStatus = fence;
		const driven = await driveWorkActionLeases(cwd, runtime);
		assert(
			driven[0]?.action === "fenced" && requests === 0,
			`live ${fence} fence prevents timer-style continuation`,
		);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
}

{
	const { cwd, store } = fixture("launch-rejected");
	try {
		updateWorkItem(store, "W-1", { status: "open" });
		saveStore(cwd, store);
		const launched = await launchDirectAction(
			cwd,
			{
				action: "run-review",
				epic: { id: "E-1" },
				selectedWorkItem: { id: "W-1", status: "open" },
			},
			{
				agent: "work-reviewer",
				params: { agent: "work-reviewer", task: "fixture" },
			},
			{},
			{ workflowRunId: "launch-rejected" },
		);
		assert(
			!launched.spawned.ok && loadStore(cwd).items["W-1"].status === "open",
			"reviewer launch rejection returns the claimed WorkItem to open",
		);
		assert(
			currentWorkActionLeases(cwd).at(-1).state === "fenced",
			"reviewer launch rejection fences retryably instead of parking",
		);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
}

{
	const { cwd, store } = fixture("legacy-projection");
	try {
		updateWorkItem(store, "W-1", { status: "open" });
		saveStore(cwd, store);
		const statusDir = path.join(cwd, ".pi-subagents", "legacy");
		mkdirSync(statusDir, { recursive: true });
		let reply;
		const pi = {
			events: {
				on(_name, handler) {
					reply = handler;
					return () => {};
				},
				emit() {
					queueMicrotask(() =>
						reply({
							success: true,
							data: { runId: "legacy-run", asyncDir: statusDir },
						}),
					);
				},
			},
		};
		const launched = await launchDirectAction(
			cwd,
			{
				action: "run-fix",
				epic: { id: "E-1" },
				selectedWorkItem: { id: "W-1", status: "open" },
			},
			{ agent: "work-fixer", params: { agent: "work-fixer", task: "fixture" } },
			pi,
			{ workflowRunId: "legacy-projection", activity: "fixture" },
		);
		assert(launched.spawned.ok, "legacy projection fixture launches");
		const pendingFile = path.join(
			cwd,
			".pi",
			"work-runs",
			"direct",
			"pending-direct.jsonl",
		);
		assert(
			readFileSync(pendingFile, "utf8").includes('"version":1') &&
				readFileSync(pendingFile, "utf8").includes('"type":"pending"'),
			"v2 launch dual-writes the legacy live-run projection",
		);
		writeFileSync(
			path.join(statusDir, "status.json"),
			JSON.stringify({ state: "completed", steps: [{ status: "completed" }] }),
		);
		assert(
			settleWorkActionLease(cwd, launched.lease.leaseId, { ok: true }).ok,
			"v2 lease settles before its legacy projection",
		);
		assert(
			reconcilePendingDirectRuns(cwd).includes("legacy-projection"),
			"legacy reconciliation still exposes completion to successor prefetch",
		);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
}

{
	const { cwd, store } = fixture("failed-settlement");
	try {
		const statusDir = path.join(cwd, ".pi-subagents", "failed");
		mkdirSync(statusDir, { recursive: true });
		writeFileSync(
			path.join(statusDir, "status.json"),
			JSON.stringify({ state: "failed", steps: [{ status: "failed" }] }),
		);
		const lease = acquireWorkActionLease(cwd, {
			workflowRunId: "failed-settlement",
			roadmapId: "E-1",
			workItemId: "W-1",
			action: "run-fix",
			semanticRole: "fixer",
		});
		acknowledgeWorkActionLease(cwd, lease.leaseId, {
			runId: "failed",
			asyncDir: statusDir,
		});
		const notices = [];
		const driven = await driveWorkActionLeases(cwd, {
			notify: (notice) => notices.push(notice),
		});
		assert(
			driven[0]?.state === "fenced" && notices[0]?.reason === "failed",
			"failed settlement visibly reports its fence reason",
		);

		const staleDir = path.join(cwd, ".pi-subagents", "stale-settlement");
		mkdirSync(staleDir, { recursive: true });
		writeFileSync(
			path.join(staleDir, "status.json"),
			JSON.stringify({ state: "completed", steps: [{ status: "completed" }] }),
		);
		const stale = acquireWorkActionLease(cwd, {
			workflowRunId: "fenced-settlement",
			roadmapId: "E-1",
			workItemId: "W-1",
			action: "run-fix",
			semanticRole: "fixer",
		});
		acknowledgeWorkActionLease(cwd, stale.leaseId, {
			runId: "stale",
			asyncDir: staleDir,
		});
		recordPendingDirectRun(cwd, {
			workflowRunId: "fenced-settlement",
			runId: "stale",
			asyncDir: staleDir,
			action: "run-fix",
			agent: "work-fixer",
			epicId: "E-1",
			workItemId: "W-1",
		});
		updateWorkItem(store, "W-1", { acceptance: "changed after launch" });
		saveStore(cwd, store);
		const fenced = await driveWorkActionLeases(cwd, {
			notify: (notice) => notices.push(notice),
		});
		assert(
			fenced[0]?.reason === "stale-work-item" &&
				notices.at(-1)?.reason === "stale-work-item",
			"validation-fenced settlement visibly reports its stop reason",
		);
		assert(
			reconcilePendingDirectRuns(cwd).includes("fenced-settlement"),
			"legacy reconciliation preserves fenced completion projection",
		);

		const day = new Date().toISOString().slice(0, 10);
		const telemetry = readFileSync(
			path.join(cwd, ".pi", "work-runs", `${day}.jsonl`),
			"utf8",
		);
		assert(
			telemetry.includes('"type":"agent"') &&
				telemetry.includes('"ok":false') &&
				telemetry.includes('"reason":"failed"'),
			"failed settlement emits failure telemetry",
		);
		const fencedAgents = telemetry
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line))
			.filter(
				(event) =>
					event.type === "agent" && event.workflowRunId === "fenced-settlement",
			);
		assert(
			fencedAgents.length === 1 && fencedAgents[0].ok === false,
			"legacy reconciliation cannot contradict a v2 validation fence",
		);
		const claims = path.join(cwd, ".pi", "work-runs", "claims");
		const completion = readdirSync(claims)
			.map((file) => readFileSync(path.join(claims, file), "utf8"))
			.join("\n");
		assert(
			completion.includes('"outcome":"failed"') &&
				completion.includes('"reason":"failed"'),
			"failed settlement completes the workflow as failed",
		);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
}

{
	const { cwd } = fixture("admission");
	try {
		const lease = acquireWorkActionLease(cwd, {
			workflowRunId: "admission-writer",
			roadmapId: "E-1",
			workItemId: "W-1",
			action: "run-fix",
		});
		const lane = createLaneEnvelope({
			repository: cwd,
			laneKind: "fixture",
			producer: "fixture",
			workItemId: "W-1",
			generation: 1,
			baseHead: git(cwd, "rev-parse", "HEAD"),
			checkpoint: git(cwd, "rev-parse", "HEAD"),
			workItemHash: "fixture-item",
			selectionHash: "fixture-selection",
			relevantPaths: [],
			resourceKeys: ["repo:read"],
			gateVersion: "fixture-v1",
			settingsVersion: "fixture-v1",
			promotionOwner: "fixture",
		});
		queueLane(cwd, lane);
		let ran = false;
		const blocked = await runReadOnlyLaneBatch(cwd, [lane], async () => {
			ran = true;
			return { artifact: {} };
		});
		assert(
			!ran && blocked.results[0].state === "failed",
			"writer lease atomically excludes a primary-checkout lane",
		);
		fenceWorkActionLease(cwd, lease.leaseId, "fixture-release");

		const lane2 = createLaneEnvelope({ ...lane, generation: 2 });
		queueLane(cwd, lane2);
		let writerRejected = false;
		await runReadOnlyLaneBatch(cwd, [lane2], async () => {
			try {
				acquireWorkActionLease(cwd, {
					workflowRunId: "admission-lane",
					roadmapId: "E-1",
					workItemId: "W-1",
					action: "run-fix",
				});
			} catch {
				writerRejected = true;
			}
			return { artifact: { ok: true } };
		});
		assert(
			writerRejected,
			"running primary-checkout lane atomically excludes a writer lease",
		);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
}

console.log("ok - durable action leases and one-step coded driver");
