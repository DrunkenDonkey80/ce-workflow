#!/usr/bin/env node
import {
	appendFileSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	ANALYZER_VERSION,
	DETECTOR_REGISTRY,
	analyzeWorkflow,
	appendCandidateTransition,
	candidateFingerprint,
	readCandidateState,
	selectCandidate,
} from "../extensions/work-improvement.js";

function assert(ok, message) {
	if (!ok) throw new Error(message);
}

function terminal(workflowRunId, extra = {}) {
	return {
		id: `terminal-${workflowRunId}`,
		type: "workflow-complete",
		workflowRunId,
		outcome: "completed",
		...extra,
	};
}

function largeOutput(workflowRunId, sourceCwd, options = {}) {
	return analyzeWorkflow({
		sourceCwd,
		workflowRunId,
		extensionRevision: options.extensionRevision ?? "rev-a",
		analyzerVersion: options.analyzerVersion,
		now: options.now,
		terminal: terminal(workflowRunId),
		events: [
			{
				id: `event-${workflowRunId}`,
				workflowRunId,
				phase: "tooling",
				project: options.project,
				tools: [{ name: "bash", kind: "shell", outputChars: 12_001 }],
			},
		],
	});
}

const roots = [];
function root(name) {
	const cwd = mkdtempSync(path.join(tmpdir(), `work-improvement-${name}-`));
	roots.push(cwd);
	return cwd;
}

try {
	assert(
		ANALYZER_VERSION === "1" &&
			DETECTOR_REGISTRY.every(
				(detector) =>
					detector.id &&
					Number.isInteger(detector.version) &&
					detector.version > 0,
			),
		"detector registry and analyzer are coded and versioned",
	);
	assert(
		DETECTOR_REGISTRY.some(
			(detector) => detector.id === "hard-dirty-final-state",
		) &&
			DETECTOR_REGISTRY.some(
				(detector) => detector.id === "ordinary-large-output",
			),
		"hard and ordinary workflows use distinct detector IDs",
	);

	const ordinary = root("ordinary");
	const first = largeOutput("wf-output-1", ordinary, { project: "consumer-a" });
	assert(
		first.candidates.length === 1 &&
			first.candidates[0].state === "accumulating",
		"one ordinary workflow remains accumulating",
	);
	const replay = largeOutput("wf-output-1", ordinary);
	assert(
		replay.status === "already-analyzed",
		"analysis is exactly once by workflow ID and analyzer version",
	);
	const second = largeOutput("wf-output-2", ordinary, {
		project: "consumer-b",
	});
	assert(
		second.candidates[0].candidateId === first.candidates[0].candidateId &&
			second.candidates[0].state === "actionable",
		"a second distinct workflow crosses the ordinary threshold under one source candidate",
	);
	const state = readCandidateState(ordinary);
	let candidate = state.candidates.get(first.candidates[0].candidateId);
	assert(
		candidate.evidenceCount === 2 && candidate.evidence.length === 2,
		"equivalent consumer evidence merges without replay inflation",
	);
	for (let index = 3; index <= 9; index += 1)
		largeOutput(`wf-output-${index}`, ordinary, {
			project: `consumer-${index}`,
		});
	candidate = readCandidateState(ordinary).candidates.get(
		candidate.candidateId,
	);
	assert(
		candidate.evidenceCount === 9 &&
			candidate.evidence.length === 5 &&
			candidate.evidence.every(
				(item) => item.phase && item.observed && item.expectedImprovement,
			),
		"candidate evidence keeps a bounded detail window and an exact distinct-run count",
	);

	const hard = root("hard");
	const dirty = analyzeWorkflow({
		sourceCwd: hard,
		workflowRunId: "wf-dirty",
		extensionRevision: "rev-a",
		terminal: terminal("wf-dirty", { finalState: { dirtyFiles: 2 } }),
		events: [],
	});
	assert(
		dirty.candidates.some((item) => item.state === "actionable") &&
			dirty.signals.some(
				(item) => item.detectorId === "hard-dirty-final-state",
			),
		"one dirty terminal workflow is immediately actionable",
	);
	const missing = analyzeWorkflow({
		sourceCwd: hard,
		workflowRunId: "wf-missing-terminal",
		extensionRevision: "rev-a",
		events: [{ malformed: true, outputChars: "not-a-number" }, null],
	});
	assert(
		missing.signals.some(
			(item) => item.detectorId === "hard-missing-terminal",
		) && missing.signals.every((item) => !item.observed.includes("NaN")),
		"missing and malformed optional telemetry yields bounded unknown evidence",
	);

	const distinctCommands = analyzeWorkflow({
		sourceCwd: hard,
		workflowRunId: "wf-distinct-commands",
		extensionRevision: "rev-a",
		terminal: terminal("wf-distinct-commands"),
		events: [
			{
				workflowRunId: "wf-distinct-commands",
				tools: [
					{ name: "bash", kind: "shell", command: "git status" },
					{ name: "bash", kind: "shell", command: "git diff" },
				],
			},
		],
	});
	assert(
		distinctCommands.signals.every(
			(item) => item.detectorId !== "ordinary-repeated-command",
		),
		"distinct same-kind commands are not inferred to be repeats",
	);

	const foreign = analyzeWorkflow({
		sourceCwd: hard,
		workflowRunId: "wf-scoped",
		extensionRevision: "rev-a",
		terminal: terminal("wf-foreign", {
			outcome: "failed",
			finalState: { dirtyFiles: 2 },
		}),
		events: [
			{
				workflowRunId: "wf-foreign",
				outputChars: 12_001,
				telemetry: {
					reconciled: {
						repeatedCommandSignatures: [{ signature: "foreign", count: 2 }],
					},
				},
			},
		],
	});
	assert(
		foreign.signals.length === 1 &&
			foreign.signals[0].detectorId === "hard-missing-terminal",
		"foreign workflow events and an explicit foreign terminal create no detector evidence",
	);

	const specificFailure = analyzeWorkflow({
		sourceCwd: hard,
		workflowRunId: "wf-specific-failure",
		extensionRevision: "rev-a",
		terminal: terminal("wf-specific-failure", {
			outcome: "failed",
			finalState: { dirtyFiles: 2 },
		}),
		events: [],
	});
	assert(
		specificFailure.signals.some(
			(item) => item.detectorId === "hard-dirty-final-state",
		) &&
			specificFailure.signals.every(
				(item) => item.detectorId !== "hard-workflow-failure",
			),
		"a specific hard failure suppresses the generic hard fallback",
	);

	const fingerprintInput = {
		detectorId: "ordinary-large-output",
		phase: "tooling",
		signature: "bash:shell",
	};
	const baseFingerprint = candidateFingerprint(fingerprintInput, {
		analyzerVersion: "1",
		extensionRevision: "rev-a",
	});
	assert(
		baseFingerprint !==
			candidateFingerprint(
				{ ...fingerprintInput, phase: "review" },
				{ analyzerVersion: "1", extensionRevision: "rev-a" },
			) &&
			baseFingerprint !==
				candidateFingerprint(
					{ ...fingerprintInput, signature: "read:file" },
					{ analyzerVersion: "1", extensionRevision: "rev-a" },
				) &&
			baseFingerprint !==
				candidateFingerprint(
					{ ...fingerprintInput, detectorId: "ordinary-cost-outlier" },
					{ analyzerVersion: "1", extensionRevision: "rev-a" },
				) &&
			baseFingerprint !==
				candidateFingerprint(fingerprintInput, {
					analyzerVersion: "2",
					extensionRevision: "rev-a",
				}) &&
			baseFingerprint !==
				candidateFingerprint(fingerprintInput, {
					analyzerVersion: "1",
					extensionRevision: "rev-b",
				}),
		"fingerprint deterministically includes detector, phase, signature, analyzer, and extension revisions",
	);
	const aged = largeOutput("wf-aged", ordinary, { extensionRevision: "rev-b" });
	assert(
		aged.candidates[0].candidateId !== first.candidates[0].candidateId,
		"changed extension revision ages the fingerprint without erasing history",
	);
	const analyzerAged = largeOutput("wf-output-1", ordinary, {
		analyzerVersion: "2",
	});
	assert(
		analyzerAged.status === "analyzed" &&
			analyzerAged.candidates[0].candidateId !==
				first.candidates[0].candidateId,
		"a changed analyzer version receives its own exactly-once pass",
	);

	const excluded = root("excluded");
	for (const activity of ["improvement", "benchmark", "validation", "revert"])
		assert(
			analyzeWorkflow({
				sourceCwd: excluded,
				workflowRunId: `wf-${activity}`,
				activity,
				extensionRevision: "rev-a",
				terminal: terminal(`wf-${activity}`, { outcome: "failed", activity }),
			}).status === "excluded",
			`self-improvement activity ${activity} is excluded`,
		);
	assert(
		readCandidateState(excluded).events.length === 0,
		"excluded activity consumes no evidence or launch budget",
	);

	const terminalStates = root("terminal");
	const terminalCandidate = largeOutput("wf-terminal-1", terminalStates)
		.candidates[0].candidateId;
	largeOutput("wf-terminal-2", terminalStates);
	for (const outcome of ["accepted", "rejected", "reverted"]) {
		const cwd = root(`terminal-${outcome}`);
		const id = largeOutput(`wf-${outcome}-1`, cwd).candidates[0].candidateId;
		largeOutput(`wf-${outcome}-2`, cwd);
		appendCandidateTransition(cwd, id, outcome);
		assert(
			selectCandidate(cwd) === null,
			`${outcome} candidate suppresses unchanged terminal evidence`,
		);
	}
	appendCandidateTransition(terminalStates, terminalCandidate, "accepted");
	assert(
		selectCandidate(terminalStates) === null,
		"unchanged accepted candidate does not relaunch",
	);

	const cooldown = root("cooldown");
	const startedAt = Date.parse("2026-07-11T00:00:00.000Z");
	const cooldownId = largeOutput("wf-cooldown-1", cooldown, { now: startedAt })
		.candidates[0].candidateId;
	largeOutput("wf-cooldown-2", cooldown, { now: startedAt + 1 });
	appendCandidateTransition(cooldown, cooldownId, "claimed", {
		now: startedAt + 2,
		attemptId: "attempt-1",
	});
	appendCandidateTransition(cooldown, cooldownId, "deferred", {
		now: startedAt + 3,
		blockerSignature: "dirty-head",
	});
	assert(
		selectCandidate(cooldown, {
			now: startedAt + 31 * 60_000,
			blockerSignatures: { [cooldownId]: "dirty-head" },
		}) === null,
		"deferred candidate does not retry when its blocker is unchanged",
	);
	assert(
		selectCandidate(cooldown, {
			now: startedAt + 31 * 60_000,
			blockerSignatures: { [cooldownId]: "clean-head" },
		})?.candidateId === cooldownId,
		"deferred candidate retries only after cooldown and blocker change",
	);
	appendCandidateTransition(cooldown, cooldownId, "claimed", {
		now: startedAt + 31 * 60_000,
		attemptId: "attempt-2",
	});
	appendCandidateTransition(cooldown, cooldownId, "rejected", {
		now: startedAt + 31 * 60_000 + 1,
	});
	largeOutput("wf-cooldown-3", cooldown, { now: startedAt + 32 * 60_000 });
	assert(
		selectCandidate(cooldown, { now: startedAt + 70 * 60_000 }) === null,
		"per-fingerprint attempt budget suppresses further selection",
	);

	const daily = root("daily");
	const dailyStart = Date.parse("2026-07-11T00:00:00.000Z");
	for (let index = 0; index < 4; index += 1) {
		analyzeWorkflow({
			sourceCwd: daily,
			workflowRunId: `wf-hard-${index}`,
			extensionRevision: "rev-a",
			now: dailyStart + index,
			terminal: terminal(`wf-hard-${index}`, {
				outcome: "failed",
				reason: `failure-${index}`,
			}),
		});
	}
	for (let index = 0; index < 3; index += 1) {
		const selected = selectCandidate(daily, {
			now: dailyStart + 60_000 + index,
		});
		assert(
			selected,
			"daily queue selects one deterministic actionable candidate",
		);
		appendCandidateTransition(daily, selected.candidateId, "claimed", {
			now: dailyStart + 60_000 + index,
			attemptId: `daily-${index}`,
		});
		appendCandidateTransition(daily, selected.candidateId, "accepted", {
			now: dailyStart + 60_000 + index + 1,
		});
	}
	assert(
		selectCandidate(daily, { now: dailyStart + 120_000 }) === null,
		"rolling daily budget stops a fourth launch",
	);

	const active = root("active");
	const activeId = largeOutput("wf-active-1", active).candidates[0].candidateId;
	largeOutput("wf-active-2", active);
	appendCandidateTransition(active, activeId, "claimed", {
		attemptId: "active-1",
	});
	analyzeWorkflow({
		sourceCwd: active,
		workflowRunId: "wf-other-hard",
		extensionRevision: "rev-a",
		terminal: terminal("wf-other-hard", { outcome: "failed", reason: "other" }),
	});
	assert(
		selectCandidate(active) === null,
		"one active attempt blocks all other candidate selection",
	);

	const malformed = root("malformed-store");
	mkdirSync(path.join(malformed, ".pi", "work-improvement"), {
		recursive: true,
	});
	appendFileSync(
		path.join(malformed, ".pi", "work-improvement", "candidate-events.jsonl"),
		"not-json\nnull\n{}\n",
	);
	assert(
		readCandidateState(malformed).candidates.size === 0,
		"malformed state lines are ignored tolerantly",
	);
	assert(
		readFileSync(
			path.join(ordinary, ".pi", "work-improvement", "candidate-events.jsonl"),
			"utf8",
		)
			.split(/\r?\n/)
			.filter(Boolean)
			.every((line) => JSON.parse(line).type),
		"candidate persistence is an append-only transition log with a derived snapshot",
	);

	console.log("ok - workflow improvement analyzer and candidate state store");
} finally {
	for (const cwd of roots) rmSync(cwd, { recursive: true, force: true });
}
