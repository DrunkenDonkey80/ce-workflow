#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { assert, seedNativeStore } from "./work-command-fixture.mjs";

const {
	deriveSuccessorPrefetch,
	launchSuccessorPrefetch,
	promoteSuccessorPrefetch,
	reconcileSuccessorPrefetches,
} = await import(
	pathToFileURL(path.join(import.meta.dirname, "../extensions/work-models.js"))
		.href
);
const { laneStatus, queueLane, transitionLane } = await import(
	pathToFileURL(
		path.join(import.meta.dirname, "../extensions/read-only-lanes.js"),
	).href
);
const { createWorkItem, loadStore, mutateStore, storePath, updateWorkItem } =
	await import(
		pathToFileURL(path.join(import.meta.dirname, "../extensions/work-store.js"))
			.href
	);
const {
	addFinding,
	addGroup,
	createBatch,
	initVerifierStore,
	loadVerifierStore,
	mutateVerifierStore,
	recordOperationResult,
} = await import(
	pathToFileURL(
		path.join(import.meta.dirname, "../extensions/background-verifiers.js"),
	).href
);

function git(cwd, ...args) {
	return execFileSync("git", args, {
		cwd,
		encoding: "utf8",
		stdio: "pipe",
	}).trim();
}

function fixture() {
	const cwd = mkdtempSync(path.join(tmpdir(), "work-prefetch-"));
	git(cwd, "init", "-q");
	git(cwd, "config", "user.email", "prefetch@example.invalid");
	git(cwd, "config", "user.name", "Prefetch Test");
	writeFileSync(path.join(cwd, "feature.js"), "export const value = 1;\n");
	git(cwd, "add", "feature.js");
	git(cwd, "commit", "-qm", "initial");
	seedNativeStore(cwd, [
		{ id: "E-1", type: "epic", status: "open", title: "Prefetch epic" },
		{
			id: "TASK-1",
			type: "task",
			status: "closed",
			title: "Current task",
			parentId: "E-1",
		},
		{
			id: "TASK-2",
			type: "task",
			status: "open",
			title: "Likely successor",
			parentId: "E-1",
			dependencies: ["TASK-1"],
			acceptance: "focused check passes",
			notes: "Files changed: `feature.js`",
		},
	]);
	writeFileSync(
		path.join(cwd, ".gitignore"),
		".pi/\n.ce-workflow/work-runs/\n",
	);
	git(cwd, "add", ".gitignore", ".ce-workflow/work-items.json");
	git(cwd, "commit", "-qm", "seed work items");
	return cwd;
}

function artifact(derived, changes = {}) {
	return {
		version: 1,
		workItemId: derived.candidate.id,
		checkpoint: derived.checkpoint.id,
		provisionalContext: "TASK-2 follows the closed current task.",
		slicePlan: "Inspect feature.js, make the bounded change, then verify it.",
		focusedVerification: ["node focused-check.mjs"],
		unresolvedDecisions: [],
		advisorChallenge: derived.advisorChallenge,
		preparationOnly: true,
		...changes,
	};
}

function completeLane(cwd, derived, output = artifact(derived)) {
	queueLane(cwd, derived.lane);
	transitionLane(cwd, derived.lane.id, "running", {
		launch: { pid: process.pid, host: "fixture", runId: "fixture-run" },
	});
	transitionLane(cwd, derived.lane.id, "completed", { artifact: output });
	return derived.lane.id;
}

function update(cwd, id, changes) {
	mutateStore(cwd, (store) => updateWorkItem(store, id, changes));
}

function mutateWithoutPromotion(cwd, derived, mutate, expected) {
	const laneId = completeLane(cwd, derived);
	mutate();
	const storeBefore = readFileSync(storePath(cwd));
	const sourceBefore = readFileSync(path.join(cwd, "feature.js"));
	const result = promoteSuccessorPrefetch(cwd, laneId);
	assert(
		result.state === "discarded" && result.reason === expected,
		`${expected} is recorded exactly`,
	);
	assert(
		Buffer.compare(storeBefore, readFileSync(storePath(cwd))) === 0 &&
			Buffer.compare(
				sourceBefore,
				readFileSync(path.join(cwd, "feature.js")),
			) === 0,
		`${expected} does not mutate source or WorkItems during discard`,
	);
}

const previousConfigDir = process.env.PI_CODING_AGENT_DIR;
const globalSettingsDir = mkdtempSync(
	path.join(tmpdir(), "work-prefetch-settings-"),
);
process.env.PI_CODING_AGENT_DIR = globalSettingsDir;
writeFileSync(path.join(globalSettingsDir, "settings.json"), "{}\n");
const roots = [];
try {
	{
		const cwd = fixture();
		roots.push(cwd);
		assert(
			deriveSuccessorPrefetch(cwd, { currentWorkItemId: "TASK-1" }).reason ===
				"disabled",
			"successor preparation defaults off",
		);
	}
	writeFileSync(
		path.join(globalSettingsDir, "settings.json"),
		`${JSON.stringify({ workPerformance: { prepareNextCandidate: true } })}\n`,
	);
	{
		const cwd = fixture();
		roots.push(cwd);
		const derived = deriveSuccessorPrefetch(cwd, {
			currentWorkItemId: "TASK-1",
		});
		assert(
			derived.eligible &&
				derived.candidate.id === "TASK-2" &&
				derived.lane.generation === 1 &&
				derived.lane.resourceKeys.includes("successor-prefetch"),
			`one stable depth-one successor gets one lane slot: ${JSON.stringify(derived)}`,
		);
		assert(
			derived.request.agent === "work-prefetch" &&
				derived.request.boundary.depth === 1 &&
				derived.request.task.includes("do not launch subagents"),
			"packaged prefetch request is read-only and depth one",
		);
		let launches = 0;
		const launched = await launchSuccessorPrefetch(cwd, derived, {
			spawn: async () => {
				launches += 1;
				return {
					ok: true,
					completed: true,
					data: { runId: "prefetch-1" },
					artifact: artifact(derived),
				};
			},
		});
		assert(
			launches === 1 && launched.promotion?.state === "promoted",
			`successful preparation launches and promotes exactly once: ${JSON.stringify(launched)}`,
		);
		const firstNotes = loadStore(cwd).items["TASK-2"].notes.join("\n");
		assert(
			(firstNotes.match(/wo:prefetch /g) ?? []).length === 1,
			"successful promotion appends one prepared note",
		);
		promoteSuccessorPrefetch(cwd, derived.lane.id);
		assert(
			(
				loadStore(cwd)
					.items["TASK-2"].notes.join("\n")
					.match(/wo:prefetch /g) ?? []
			).length === 1,
			"promotion retry cannot duplicate the note",
		);
	}

	{
		const cwd = fixture();
		roots.push(cwd);
		process.env.WORK_ORCH_SERIAL = "1";
		assert(
			deriveSuccessorPrefetch(cwd, { currentWorkItemId: "TASK-1" }).reason ===
				"serial-mode",
			"serial mode never launches successor prefetch",
		);
		delete process.env.WORK_ORCH_SERIAL;
		mutateStore(cwd, (store) =>
			createWorkItem(store, {
				id: "TASK-3",
				type: "task",
				status: "open",
				title: "Second ready candidate",
				parentId: "E-1",
			}),
		);
		assert(
			deriveSuccessorPrefetch(cwd, { currentWorkItemId: "TASK-1" }).reason ===
				"unstable-selection",
			"an unstable or second candidate prevents launch",
		);
	}

	{
		const cwd = fixture();
		roots.push(cwd);
		const derived = deriveSuccessorPrefetch(cwd, {
			currentWorkItemId: "TASK-1",
		});
		let launches = 0;
		const cancelled = await launchSuccessorPrefetch(
			cwd,
			derived,
			{ spawn: async () => (launches += 1) },
			{ cancelled: true },
		);
		assert(
			launches === 0 &&
				cancelled.reason === "cancelled" &&
				laneStatus(cwd)[0].wastedDurationMs >= 0,
			"queued cancellation prevents launch and reports waste telemetry",
		);
	}

	{
		const cwd = fixture();
		roots.push(cwd);
		const derived = deriveSuccessorPrefetch(cwd, {
			currentWorkItemId: "TASK-1",
		});
		await launchSuccessorPrefetch(cwd, derived, {
			spawn: async () => ({ ok: false, ambiguous: true }),
		});
		const status = laneStatus(cwd)[0];
		assert(
			status.state === "running" &&
				deriveSuccessorPrefetch(cwd, { currentWorkItemId: "TASK-1" }).reason ===
					"slot-occupied",
			"ambiguous acknowledgement remains visible and blocks duplicates",
		);
		mkdirSync(path.dirname(derived.request.output), { recursive: true });
		writeFileSync(derived.request.output, JSON.stringify(artifact(derived)));
		reconcileSuccessorPrefetches(cwd);
		assert(
			laneStatus(cwd)[0].state === "promoted",
			"a late valid artifact from ambiguous acknowledgement remains recoverable",
		);
	}

	for (const scenario of [
		{
			reason: "selection-changed",
			mutate(cwd) {
				update(cwd, "TASK-2", { status: "closed" });
			},
		},
		{
			reason: "head-changed",
			mutate(cwd) {
				writeFileSync(path.join(cwd, "later.txt"), "later\n");
				git(cwd, "add", "later.txt");
				git(cwd, "commit", "-qm", "later");
			},
		},
		{
			reason: "task-revised",
			mutate(cwd) {
				update(cwd, "TASK-2", { acceptance: "revised acceptance" });
			},
		},
		{
			reason: "dependencies-changed",
			mutate(cwd) {
				mutateStore(cwd, (store) => {
					createWorkItem(store, {
						id: "TASK-0",
						type: "task",
						status: "closed",
						title: "Older dependency",
						parentId: "E-1",
					});
					return updateWorkItem(store, "TASK-2", {
						dependencies: ["TASK-1", "TASK-0"],
					});
				});
			},
		},
		{
			reason: "paths-changed",
			mutate(cwd) {
				git(cwd, "update-index", "--assume-unchanged", "feature.js");
				writeFileSync(
					path.join(cwd, "feature.js"),
					"export const value = 2;\n",
				);
			},
		},
	]) {
		const cwd = fixture();
		roots.push(cwd);
		const derived = deriveSuccessorPrefetch(cwd, {
			currentWorkItemId: "TASK-1",
		});
		mutateWithoutPromotion(
			cwd,
			derived,
			() => scenario.mutate(cwd),
			scenario.reason,
		);
	}

	{
		const cwd = fixture();
		roots.push(cwd);
		const derived = deriveSuccessorPrefetch(cwd, {
			currentWorkItemId: "TASK-1",
		});
		const laneId = completeLane(cwd, derived);
		initVerifierStore(cwd);
		const checkpoint = {
			repository: cwd,
			base: "a".repeat(40),
			snapshot: "b".repeat(40),
			paths: ["feature.js"],
			patchHash: "c".repeat(64),
		};
		mutateVerifierStore(cwd, (store) =>
			createBatch(store, {
				checkpoint,
				profiles: [
					{
						model: "fixture/verifier",
						operations: ["correctness"],
						thinking: "low",
					},
				],
			}),
		);
		const job = Object.values(loadVerifierStore(cwd).jobs)[0];
		const report = mutateVerifierStore(cwd, (store) =>
			recordOperationResult(store, {
				jobId: job.id,
				operation: "correctness",
				outcome: "findings",
			}),
		);
		const finding = mutateVerifierStore(cwd, (store) =>
			addFinding(store, {
				reportId: report.id,
				operation: "correctness",
				model: job.model,
				checkpoint,
				path: "feature.js",
				startLine: 1,
				endLine: 1,
				category: "correctness",
				severity: "medium",
				rationale: "fixture",
				evidence: "fixture",
				suggestedAction: "fixture",
			}),
		);
		mutateVerifierStore(cwd, (store) =>
			addGroup(store, { findingIds: [finding.id] }),
		);
		const before = readFileSync(storePath(cwd));
		const result = promoteSuccessorPrefetch(cwd, laneId);
		assert(
			result.reason === "triage-required" &&
				Buffer.compare(before, readFileSync(storePath(cwd))) === 0,
			"verifier triage discards without WorkItem mutation",
		);
	}

	{
		const cwd = fixture();
		roots.push(cwd);
		const derived = deriveSuccessorPrefetch(cwd, {
			currentWorkItemId: "TASK-1",
		});
		const laneId = completeLane(cwd, derived);
		const newer = {
			...derived.lane,
			id: `${derived.lane.id}-new`,
			generation: 2,
		};
		queueLane(cwd, newer);
		assert(
			promoteSuccessorPrefetch(cwd, laneId).reason === "late-generation",
			"late generation is discarded exactly",
		);
	}

	{
		const cwd = fixture();
		roots.push(cwd);
		const derived = deriveSuccessorPrefetch(cwd, {
			currentWorkItemId: "TASK-1",
		});
		const laneId = completeLane(
			cwd,
			derived,
			artifact(derived, { version: 2 }),
		);
		assert(
			promoteSuccessorPrefetch(cwd, laneId).reason === "invalid-output",
			"invalid output is discarded exactly",
		);
	}

	{
		const cwd = fixture();
		roots.push(cwd);
		const derived = deriveSuccessorPrefetch(cwd, {
			currentWorkItemId: "TASK-1",
		});
		const laneId = completeLane(cwd, derived);
		assert(
			promoteSuccessorPrefetch(cwd, laneId, { cancelled: true }).reason ===
				"cancelled",
			"already-started work may settle but cannot promote after cancellation",
		);
	}

	process.stdout.write(
		"ok - one-slot successor prefetch promotion and discard behavior\n",
	);
} finally {
	delete process.env.WORK_ORCH_SERIAL;
	if (previousConfigDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = previousConfigDir;
	for (const cwd of roots) rmSync(cwd, { recursive: true, force: true });
	rmSync(globalSettingsDir, { recursive: true, force: true });
}
