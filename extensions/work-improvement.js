import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

export const ANALYZER_VERSION = "1";
export const DEFAULT_IMPROVEMENT_POLICY = Object.freeze({
	ordinaryDistinctRuns: 2,
	maxEvidence: 5,
	maxDailyLaunches: 3,
	maxAttemptsPerFingerprint: 2,
	cooldownMs: 30 * 60 * 1000,
});

const SELF_IMPROVEMENT_ACTIVITIES = new Set([
	"improvement",
	"benchmark",
	"validation",
	"revert",
]);
const TERMINAL_STATES = new Set(["accepted", "rejected", "reverted"]);
const ACTIVE_STATES = new Set([
	"claimed",
	"preparing",
	"mutating",
	"verifying",
	"commit-pending",
	"committed",
	"push-pending",
	"push-unknown",
	"pushed",
	"validating",
	"revert-pending",
	"revert-push-unknown",
]);
const LARGE_OUTPUT_CHARS = 10_000;

function finite(value) {
	const number = Number(value);
	return Number.isFinite(number) && number >= 0 ? number : undefined;
}

function text(value, limit = 160) {
	return typeof value === "string"
		? value.replace(/\s+/g, " ").trim().slice(0, limit)
		: "";
}

function normalized(value) {
	return (
		text(value, 200)
			.toLowerCase()
			.replace(/[a-f0-9]{12,}/g, "<id>")
			.replace(/\b\d{4,}\b/g, "<n>") || "unknown"
	);
}

function phaseOf(event, fallback = "workflow") {
	return (
		text(
			event?.phase ??
				event?.role ??
				event?.action ??
				event?.command ??
				fallback,
			80,
		) || fallback
	);
}

function signal(detector, event, signature, observed, expectedImprovement) {
	return {
		detectorId: detector.id,
		detectorVersion: detector.version,
		severity: detector.severity,
		phase: phaseOf(event, detector.phase),
		signature: normalized(signature),
		observed: text(observed, 240) || "unknown",
		expectedImprovement: text(expectedImprovement, 240) || "unknown",
		sourceEventId: text(event?.id, 120) || undefined,
	};
}

function subagentDetails(events) {
	return events.flatMap((event) =>
		(event?.tools ?? []).flatMap((tool) => tool?.subagentDetails ?? []),
	);
}

function detectWorkflowFailure(detector, { terminal }) {
	if (!terminal || terminal.outcome !== "failed") return [];
	return [
		signal(
			detector,
			terminal,
			terminal.reason ?? terminal.action ?? "workflow-failed",
			`terminal workflow outcome: failed${terminal.reason ? ` (${text(terminal.reason)})` : ""}`,
			"preserve successful terminal workflow completion",
		),
	];
}

function detectMissingTerminal(detector, { terminal }) {
	if (terminal) return [];
	return [
		signal(
			detector,
			{},
			"missing-terminal-telemetry",
			"workflow has no terminal telemetry",
			"emit one correlated terminal record",
		),
	];
}

function detectFailedHandoff(detector, { events }) {
	return events
		.filter(
			(event) =>
				event?.handoff?.failed === true ||
				(event?.handoff?.queued === true &&
					event?.handoff?.started === false &&
					event?.ok === false),
		)
		.map((event) =>
			signal(
				detector,
				event,
				event.handoff?.role ?? event.reason ?? "handoff-failed",
				"required handoff failed to start",
				"make the required handoff complete reliably",
			),
		);
}

function detectGateLoss(detector, { events }) {
	return events
		.filter(
			(event) =>
				event?.requiredGate === false ||
				event?.verification?.required === false ||
				(event?.verification?.required === true &&
					event?.verification?.status === "FAIL"),
		)
		.map((event) =>
			signal(
				detector,
				event,
				event.verification?.name ?? event.gate ?? "required-gate",
				"required workflow gate was missing or failed",
				"restore the required quality gate",
			),
		);
}

function detectDirtyFinalState(detector, { events, terminal }) {
	const event = [...events, terminal].find(
		(item) =>
			item?.finalState?.dirty === true ||
			(finite(item?.finalState?.dirtyFiles) ?? 0) > 0 ||
			item?.repository?.dirty === true,
	);
	if (!event) return [];
	return [
		signal(
			detector,
			event,
			"dirty-final-state",
			`final repository dirty files: ${finite(event.finalState?.dirtyFiles) ?? "unknown"}`,
			"leave the repository clean without discarding unrelated work",
		),
	];
}

function detectFailedSubagent(detector, context) {
	return subagentDetails(context.events)
		.filter((detail) => {
			const status = normalized(detail?.status);
			return (
				["failed", "error", "timeout", "timed_out", "empty"].includes(status) ||
				detail?.empty === true
			);
		})
		.map((detail) =>
			signal(
				detector,
				{ role: detail?.agent },
				`${detail?.agent ?? "subagent"}:${detail?.status ?? "empty"}`,
				`subagent ${text(detail?.agent) || "unknown"} ${text(detail?.status) || "returned empty output"}`,
				"avoid failed or empty subagent work",
			),
		);
}

function detectLargeOutput(detector, { events }) {
	const found = [];
	for (const event of events) {
		const eventOutput = finite(event?.outputChars);
		if (eventOutput !== undefined && eventOutput > LARGE_OUTPUT_CHARS)
			found.push(
				signal(
					detector,
					event,
					event.command ?? event.type,
					`output chars: ${eventOutput}`,
					"reduce or artifact oversized output",
				),
			);
		for (const tool of event?.tools ?? []) {
			const output = finite(tool?.outputChars);
			if (output !== undefined && output > LARGE_OUTPUT_CHARS)
				found.push(
					signal(
						detector,
						event,
						`${tool?.name ?? "tool"}:${tool?.kind ?? ""}`,
						`tool output chars: ${output}`,
						"bound tool output and retain full output as an artifact",
					),
				);
		}
	}
	return found;
}

function detectRepeatedCommands(detector, { events }) {
	const counts = new Map();
	for (const event of events) {
		for (const item of event?.telemetry?.reconciled
			?.repeatedCommandSignatures ?? []) {
			if (text(item?.signature))
				counts.set(text(item.signature), finite(item.count) ?? 2);
		}
	}
	return [...counts]
		.filter(([, count]) => count > 1)
		.map(([signature, count]) =>
			signal(
				detector,
				{},
				signature,
				`repeated command count: ${count}`,
				"reuse prior evidence or combine repeated commands",
			),
		);
}

function detectFullTaskReads(detector, { events }) {
	const count = events.filter(
		(event) => event?.type === "large-task-read",
	).length;
	return count
		? [
				signal(
					detector,
					{},
					"full-task-read",
					`full task reads: ${count}`,
					"use the compact task summary",
				),
			]
		: [];
}

function detectCostOutlier(detector, { events }) {
	return events
		.filter((event) => {
			if (event?.costOutlier === true || event?.baseline?.outlier === true)
				return true;
			const tokens = finite(event?.usage?.totalTokens);
			const baselineTokens = finite(event?.baseline?.tokens);
			const duration = finite(event?.durationMs);
			const baselineDuration = finite(event?.baseline?.durationMs);
			return (
				(tokens !== undefined &&
					baselineTokens !== undefined &&
					baselineTokens > 0 &&
					tokens > baselineTokens * 2) ||
				(duration !== undefined &&
					baselineDuration !== undefined &&
					baselineDuration > 0 &&
					duration > baselineDuration * 2)
			);
		})
		.map((event) =>
			signal(
				detector,
				event,
				event.role ?? event.action ?? "cost-outlier",
				`cost outlier: tokens=${finite(event.usage?.totalTokens) ?? "unknown"}, latencyMs=${finite(event.durationMs) ?? "unknown"}`,
				"reduce balanced workflow cost without weakening quality gates",
			),
		);
}

function detectRetries(detector, { events }) {
	return events
		.filter((event) => (finite(event?.retries ?? event?.retryCount) ?? 0) > 0)
		.map((event) =>
			signal(
				detector,
				event,
				event.retryReason ?? event.action ?? "retry",
				`workflow retries: ${finite(event.retries ?? event.retryCount)}`,
				"avoid repeat work while preserving recovery behavior",
			),
		);
}

function detectContextGrowth(detector, { events }) {
	return events
		.filter((event) => {
			const before = finite(event?.context?.before?.tokens);
			const after = finite(event?.context?.after?.tokens);
			return (
				before !== undefined && after !== undefined && after - before > 50_000
			);
		})
		.map((event) =>
			signal(
				detector,
				event,
				event.role ?? event.action ?? "context-growth",
				`context growth tokens: ${finite(event.context.after.tokens) - finite(event.context.before.tokens)}`,
				"reduce avoidable context growth without dropping required evidence",
			),
		);
}

function detectLowReviewPayoff(detector, { events }) {
	return events
		.filter(
			(event) =>
				event?.review?.payoff === "low" ||
				event?.payoff?.classification === "low",
		)
		.map((event) =>
			signal(
				detector,
				event,
				event.review?.scope ?? event.role ?? "review",
				"review payoff classified low",
				"focus review effort while retaining required independent review",
			),
		);
}

export const DETECTOR_REGISTRY = Object.freeze([
	{
		id: "hard-workflow-failure",
		version: 1,
		severity: "hard",
		phase: "completion",
		detect: detectWorkflowFailure,
	},
	{
		id: "hard-missing-terminal",
		version: 1,
		severity: "hard",
		phase: "completion",
		detect: detectMissingTerminal,
	},
	{
		id: "hard-failed-handoff",
		version: 1,
		severity: "hard",
		phase: "handoff",
		detect: detectFailedHandoff,
	},
	{
		id: "hard-required-gate-loss",
		version: 1,
		severity: "hard",
		phase: "verification",
		detect: detectGateLoss,
	},
	{
		id: "hard-dirty-final-state",
		version: 1,
		severity: "hard",
		phase: "finalization",
		detect: detectDirtyFinalState,
	},
	{
		id: "hard-failed-subagent",
		version: 1,
		severity: "hard",
		phase: "handoff",
		detect: detectFailedSubagent,
	},
	{
		id: "ordinary-large-output",
		version: 1,
		severity: "ordinary",
		phase: "tooling",
		detect: detectLargeOutput,
	},
	{
		id: "ordinary-repeated-command",
		version: 1,
		severity: "ordinary",
		phase: "tooling",
		detect: detectRepeatedCommands,
	},
	{
		id: "ordinary-full-task-read",
		version: 1,
		severity: "ordinary",
		phase: "discovery",
		detect: detectFullTaskReads,
	},
	{
		id: "ordinary-cost-outlier",
		version: 1,
		severity: "ordinary",
		phase: "workflow",
		detect: detectCostOutlier,
	},
	{
		id: "ordinary-retries",
		version: 1,
		severity: "ordinary",
		phase: "workflow",
		detect: detectRetries,
	},
	{
		id: "ordinary-context-growth",
		version: 1,
		severity: "ordinary",
		phase: "workflow",
		detect: detectContextGrowth,
	},
	{
		id: "ordinary-low-review-payoff",
		version: 1,
		severity: "ordinary",
		phase: "review",
		detect: detectLowReviewPayoff,
	},
]);

function runtimeDir(sourceCwd) {
	return typeof sourceCwd === "string" && sourceCwd
		? path.join(sourceCwd, ".pi", "work-improvement")
		: "";
}

function eventLogPath(sourceCwd) {
	const dir = runtimeDir(sourceCwd);
	return dir ? path.join(dir, "candidate-events.jsonl") : "";
}

function readJsonLines(file) {
	if (!file || !existsSync(file)) return [];
	try {
		return readFileSync(file, "utf8")
			.split(/\r?\n/)
			.filter(Boolean)
			.flatMap((line) => {
				try {
					const value = JSON.parse(line);
					return value && typeof value === "object" ? [value] : [];
				} catch {
					return [];
				}
			});
	} catch {
		return [];
	}
}

function appendEvent(sourceCwd, event) {
	const dir = runtimeDir(sourceCwd);
	if (!dir) return;
	mkdirSync(dir, { recursive: true });
	appendFileSync(eventLogPath(sourceCwd), `${JSON.stringify(event)}\n`);
}

function timestamp(value) {
	const milliseconds = Number(value ?? Date.now());
	return new Date(
		Number.isFinite(milliseconds) ? milliseconds : Date.now(),
	).toISOString();
}

export function candidateFingerprint(signalValue, options = {}) {
	return createHash("sha256")
		.update(
			[
				`${signalValue?.detectorId ?? "unknown"}@${signalValue?.detectorVersion ?? "unknown"}`,
				signalValue?.phase ?? "workflow",
				normalized(signalValue?.signature),
				options.analyzerVersion ?? ANALYZER_VERSION,
				options.extensionRevision ?? "unknown",
			].join("\u001f"),
		)
		.digest("hex");
}

function evidenceFor(workflowRunId, signalValue) {
	return {
		workflowRunId,
		sourceEventId: signalValue.sourceEventId,
		phase: signalValue.phase,
		observed: signalValue.observed,
		expectedImprovement: signalValue.expectedImprovement,
	};
}

export function readCandidateState(sourceCwd, policy = {}) {
	const resolved = { ...DEFAULT_IMPROVEMENT_POLICY, ...policy };
	const events = readJsonLines(eventLogPath(sourceCwd));
	const analyses = new Set();
	const candidates = new Map();
	const launches = [];
	for (const event of events) {
		if (event.type === "analysis") {
			if (event.analysisKey) analyses.add(event.analysisKey);
			continue;
		}
		if (event.type !== "candidate" || !event.candidateId) continue;
		let candidate = candidates.get(event.candidateId);
		if (!candidate) {
			candidate = {
				candidateId: event.candidateId,
				fingerprint: event.fingerprint ?? event.candidateId,
				detectorId: event.detectorId,
				detectorVersion: event.detectorVersion,
				severity: event.severity,
				phase: event.phase,
				signature: event.signature,
				analyzerVersion: event.analyzerVersion,
				extensionRevision: event.extensionRevision,
				state: "observed",
				evidence: [],
				evidenceCount: 0,
				attempts: 0,
			};
			candidate._workflowIds = new Set();
			candidates.set(event.candidateId, candidate);
		}
		if (
			event.transition === "observed" &&
			event.workflowRunId &&
			!candidate._workflowIds.has(event.workflowRunId)
		) {
			candidate._workflowIds.add(event.workflowRunId);
			candidate.evidenceCount += 1;
			candidate.evidence.push(event.evidence);
			candidate.evidence = candidate.evidence
				.filter(Boolean)
				.slice(-resolved.maxEvidence);
			// New evidence does not prove that a recorded external blocker changed.
			if (candidate.state !== "deferred")
				candidate.state = event.nextState ?? candidate.state;
			candidate.updatedAt = event.timestamp;
			candidate.actionableAt ??=
				candidate.state === "actionable" ? event.timestamp : undefined;
		} else if (event.transition !== "observed") {
			candidate.state = event.transition;
			candidate.updatedAt = event.timestamp;
			if (event.transition === "claimed") {
				candidate.attempts += 1;
				candidate.lastAttemptAt = event.timestamp;
				candidate.attemptId = event.attemptId;
				launches.push(event);
			}
			if (event.transition === "deferred") {
				candidate.blockerSignature =
					text(event.blockerSignature, 200) || "unknown";
				candidate.deferredAt = event.timestamp;
			}
			if (TERMINAL_STATES.has(event.transition))
				candidate.terminalEvidenceCount = candidate.evidenceCount;
		}
	}
	for (const candidate of candidates.values()) delete candidate._workflowIds;
	return { version: 1, analyses, candidates, events, launches };
}

export function appendCandidateTransition(
	sourceCwd,
	candidateId,
	transition,
	details = {},
) {
	if (!sourceCwd || !candidateId || !text(transition, 40)) return "";
	const event = {
		version: 1,
		type: "candidate",
		timestamp: timestamp(details.now),
		candidateId,
		transition: text(transition, 40),
		attemptId: text(details.attemptId, 120) || undefined,
		blockerSignature: text(details.blockerSignature, 200) || undefined,
		activity: text(details.activity, 40) || undefined,
	};
	appendEvent(sourceCwd, event);
	return event;
}

export function analyzeWorkflow(options = {}) {
	const sourceCwd = options.sourceCwd;
	const workflowRunId = text(options.workflowRunId, 160);
	const analyzerVersion = text(options.analyzerVersion, 80) || ANALYZER_VERSION;
	const extensionRevision = text(options.extensionRevision, 160) || "unknown";
	if (typeof sourceCwd !== "string" || !sourceCwd || !workflowRunId)
		return {
			status: "ignored",
			reason: "missing-identity",
			signals: [],
			candidates: [],
		};
	const rawEvents = Array.isArray(options.events)
		? options.events.filter(
				(event) =>
					event &&
					typeof event === "object" &&
					event.workflowRunId === workflowRunId,
			)
		: [];
	const terminal =
		options.terminal &&
		typeof options.terminal === "object" &&
		options.terminal.workflowRunId === workflowRunId
			? options.terminal
			: rawEvents.find((event) => event.type === "workflow-complete");
	const activity = text(
		options.activity ??
			terminal?.activity ??
			rawEvents.find((event) => event.activity)?.activity,
		40,
	).toLowerCase();
	if (SELF_IMPROVEMENT_ACTIVITIES.has(activity))
		return {
			status: "excluded",
			reason: "self-improvement-activity",
			signals: [],
			candidates: [],
		};
	const analysisKey = `${workflowRunId}\u001f${analyzerVersion}`;
	let state = readCandidateState(sourceCwd, options.policy);
	if (state.analyses.has(analysisKey))
		return { status: "already-analyzed", signals: [], candidates: [] };
	const context = { events: rawEvents, terminal };
	let signals = DETECTOR_REGISTRY.flatMap((detector) => {
		try {
			return detector.detect(detector, context);
		} catch {
			return [];
		}
	});
	if (
		signals.some(
			(item) =>
				item.severity === "hard" && item.detectorId !== "hard-workflow-failure",
		)
	)
		signals = signals.filter(
			(item) => item.detectorId !== "hard-workflow-failure",
		);
	const analyzedAt = timestamp(options.now);
	const candidates = [];
	const uniqueSignals = new Map();
	for (const signalValue of signals) {
		const fingerprint = candidateFingerprint(signalValue, {
			analyzerVersion,
			extensionRevision,
		});
		if (!uniqueSignals.has(fingerprint))
			uniqueSignals.set(fingerprint, signalValue);
	}
	for (const [fingerprint, signalValue] of uniqueSignals) {
		const previous = state.candidates.get(fingerprint);
		const alreadyObserved = state.events.some(
			(event) =>
				event.type === "candidate" &&
				event.candidateId === fingerprint &&
				event.transition === "observed" &&
				event.workflowRunId === workflowRunId,
		);
		const distinctCount =
			(previous?.evidenceCount ?? 0) + (alreadyObserved ? 0 : 1);
		const nextState =
			signalValue.severity === "hard" ||
			distinctCount >=
				(options.policy?.ordinaryDistinctRuns ??
					DEFAULT_IMPROVEMENT_POLICY.ordinaryDistinctRuns)
				? "actionable"
				: "accumulating";
		appendEvent(sourceCwd, {
			version: 1,
			type: "candidate",
			timestamp: analyzedAt,
			candidateId: fingerprint,
			fingerprint,
			transition: "observed",
			nextState,
			workflowRunId,
			detectorId: signalValue.detectorId,
			detectorVersion: signalValue.detectorVersion,
			severity: signalValue.severity,
			phase: signalValue.phase,
			signature: signalValue.signature,
			analyzerVersion,
			extensionRevision,
			evidence: evidenceFor(workflowRunId, signalValue),
		});
		candidates.push({ candidateId: fingerprint, state: nextState });
		state = readCandidateState(sourceCwd, options.policy);
	}
	// Written last so an interrupted pass can safely rebuild missing candidate events.
	appendEvent(sourceCwd, {
		version: 1,
		type: "analysis",
		timestamp: analyzedAt,
		analysisKey,
		workflowRunId,
		analyzerVersion,
		signalCount: uniqueSignals.size,
	});
	return {
		status: "analyzed",
		signals: [...uniqueSignals.values()],
		candidates,
	};
}

export function selectCandidate(sourceCwd, options = {}) {
	const policy = { ...DEFAULT_IMPROVEMENT_POLICY, ...options.policy };
	const now = Number(options.now ?? Date.now());
	const state = readCandidateState(sourceCwd, policy);
	if (
		[...state.candidates.values()].some((candidate) =>
			ACTIVE_STATES.has(candidate.state),
		)
	)
		return null;
	const launchesToday = state.launches.filter((launch) => {
		const at = Date.parse(launch.timestamp ?? "");
		return (
			Number.isFinite(at) && now - at >= 0 && now - at < 24 * 60 * 60 * 1000
		);
	}).length;
	if (launchesToday >= policy.maxDailyLaunches) return null;
	const blockerSignatures = options.blockerSignatures ?? {};
	const eligible = [...state.candidates.values()].filter((candidate) => {
		const changedTerminalEvidence =
			TERMINAL_STATES.has(candidate.state) &&
			candidate.evidenceCount >
				(candidate.terminalEvidenceCount ?? candidate.evidenceCount);
		if (TERMINAL_STATES.has(candidate.state) && !changedTerminalEvidence)
			return false;
		if (
			candidate.state !== "actionable" &&
			!changedTerminalEvidence &&
			candidate.state !== "deferred"
		)
			return false;
		if (candidate.attempts >= policy.maxAttemptsPerFingerprint) return false;
		const last = Date.parse(
			candidate.lastAttemptAt ?? candidate.deferredAt ?? "",
		);
		if (Number.isFinite(last) && now - last < policy.cooldownMs) return false;
		if (candidate.state === "deferred") {
			const current = text(blockerSignatures[candidate.candidateId], 200);
			if (!current || current === candidate.blockerSignature) return false;
		}
		return true;
	});
	eligible.sort(
		(a, b) =>
			(a.actionableAt ?? a.updatedAt ?? "").localeCompare(
				b.actionableAt ?? b.updatedAt ?? "",
			) || a.candidateId.localeCompare(b.candidateId),
	);
	return eligible[0] ?? null;
}
