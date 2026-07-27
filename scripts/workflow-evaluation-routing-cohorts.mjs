import {
	fingerprint,
	telemetryCohort,
} from "./workflow-evaluation-contract.mjs";
import {
	evaluateRoutingDecision,
	ROUTING_OUTCOMES,
} from "./workflow-evaluation-score.mjs";

const MAX_EVENTS = 50_000;
const OPTIONAL_PATHS = ["sentinel", "prefetch"];

function value(events, read) {
	for (let index = events.length - 1; index >= 0; index -= 1) {
		const found = read(events[index]);
		if (found !== undefined) return found;
	}
}

function count(events, predicate) {
	return events.reduce((sum, event) => sum + (predicate(event) ? 1 : 0), 0);
}

function number(value) {
	return Number.isFinite(value) ? value : 0;
}

function roleMapping(events) {
	const declared = value(events, (event) => event.roleMapping);
	if (declared) return declared;
	const entries = events
		.filter((event) => event.role && (event.provider || event.model))
		.map((event) => [
			event.role,
			{ provider: event.provider, model: event.model, effort: event.effort },
		]);
	return entries.length ? Object.fromEntries(entries) : undefined;
}

function terminalOutcomes(events, terminal) {
	const parent = events.filter(
		(event) => event.parentAgentId === null || event.role === "main",
	);
	const firstAt = Math.min(
		...events
			.map((event) => Date.parse(event.timestamp))
			.filter(Number.isFinite),
	);
	const lastAt = Date.parse(terminal.timestamp);
	const quality = terminal.quality ?? {};
	const operational = terminal.operational ?? {};
	const explicitCost = terminal.totalCostUsd ?? terminal.cost?.totalUsd;
	return {
		parentTurnsPerClosedItem: parent.reduce(
			(sum, event) =>
				sum +
				number(
					event.turns ??
						event.usage?.turns ??
						(event.type === "parent-turn" ? 1 : 0),
				),
			0,
		),
		parentContextTokensPerClosedItem: Math.max(
			0,
			...parent.map((event) =>
				number(
					event.parentContextTokens ??
						event.context?.after?.tokens ??
						event.context?.tokens,
				),
			),
		),
		firstPassVerificationRate: Number(
			terminal.firstPassVerification ?? quality.firstPassVerification,
		),
		reviewFindingRate:
			number(quality.reviewFindings) +
			events.reduce((sum, event) => sum + number(event.review?.findings), 0),
		acceptedPostCloseFindingRate:
			number(quality.acceptedPostCloseFindings) +
			count(
				events,
				(event) =>
					event.type === "post-close-finding" &&
					event.disposition === "accepted",
			),
		reopenOrDebugRate:
			number(quality.reopenOrDebug) +
			count(events, (event) =>
				["work-item-reopened", "debug-started"].includes(event.type),
			),
		escalationRate:
			number(quality.escalations) +
			count(events, (event) => event.type === "escalation"),
		manualInterventionRate:
			number(quality.manualInterventions) +
			count(events, (event) => event.type === "manual-intervention"),
		latencyMs: number(
			operational.latencyMs ??
				(Number.isFinite(firstAt) && Number.isFinite(lastAt)
					? lastAt - firstAt
					: 0),
		),
		staleOrDiscardedBackgroundMs:
			number(operational.staleOrDiscardedBackgroundMs) +
			events.reduce(
				(sum, event) =>
					sum +
					(["stale", "discarded"].includes(event.state)
						? number(
								event.wastedDurationMs ??
									event.metrics?.wastedDurationMs ??
									event.metrics?.durationMs,
							)
						: 0),
				0,
			),
		duplicateOrAmbiguousRecoveryRate:
			number(operational.duplicateOrAmbiguousRecoveries) +
			count(
				events,
				(event) =>
					event.type === "duplicate-recovery" ||
					event.recovery === "ambiguous" ||
					event.launch?.acknowledgement === "ambiguous",
			),
		infrastructureFailureRate:
			number(operational.infrastructureFailures) +
			count(events, (event) => event.infrastructureFailure === true),
		totalCostUsd: Number.isFinite(explicitCost)
			? explicitCost
			: events.reduce(
					(sum, event) =>
						sum +
						number(event.cost ?? event.usage?.cost ?? event.totalCost?.costUsd),
					0,
				),
	};
}

function observation(events) {
	const terminal = events.find(
		(event) =>
			event.type === "workflow-complete" && event.closedExecutableItem === true,
	);
	if (
		!terminal ||
		terminal.evaluationComplete !== true ||
		terminal.postCloseWindowComplete !== true ||
		typeof (
			terminal.firstPassVerification ?? terminal.quality?.firstPassVerification
		) !== "boolean"
	)
		return null;
	const cohort = telemetryCohort(terminal);
	const mapping = roleMapping(events);
	const stratum = {
		identityKind: cohort.kind,
		workflowBuild:
			terminal.workflow?.gitRevision ??
			terminal.workflow?.dirtySourceHash ??
			terminal.workflow?.behaviorFingerprint ??
			(cohort.kind === "legacy" ? "legacy" : undefined),
		behaviorFingerprint: terminal.workflow?.behaviorFingerprint,
		routingPolicy:
			terminal.routingPolicy ??
			terminal.workflow?.routingPolicyRevision ??
			(cohort.kind === "legacy" ? "legacy" : undefined),
		roleMapping: mapping ? fingerprint(mapping) : undefined,
		project: terminal.project,
		assuranceStratum:
			terminal.assuranceStratum ?? terminal.shadowAssurance?.suggestedAssurance,
		mode: terminal.mode,
		routingPath: terminal.routingPath ?? "default",
	};
	if (
		![
			stratum.workflowBuild,
			stratum.routingPolicy,
			stratum.roleMapping,
			stratum.project,
			stratum.assuranceStratum,
			stratum.mode,
		].every(Boolean)
	)
		return null;
	const sampleId = terminal.sampleId ?? terminal.workflowRunId;
	const pairId = terminal.pairId;
	const arm =
		terminal.pairArm ??
		(terminal.treatmentId === "control" ? "baseline" : "candidate");
	if (!sampleId || !pairId || !["baseline", "candidate"].includes(arm))
		return null;
	const legacyIsolation = cohort.kind === "legacy" ? sampleId : undefined;
	return {
		sampleId,
		pairId,
		arm,
		stratum,
		cohortKey: fingerprint({ ...stratum, legacyIsolation }),
		outcomes: terminalOutcomes(events, terminal),
	};
}

export function adaptRoutingCohorts(events) {
	if (!Array.isArray(events))
		throw new Error("telemetry events must be an array");
	if (events.length > MAX_EVENTS)
		throw new Error(`telemetry event bound exceeded (${MAX_EVENTS})`);
	const samples = new Map();
	for (const event of events) {
		const sampleId = event?.sampleId ?? event?.workflowRunId;
		if (!sampleId) continue;
		if (!samples.has(sampleId)) samples.set(sampleId, []);
		samples.get(sampleId).push(event);
	}
	const observations = [...samples.values()].map(observation).filter(Boolean);
	const cohorts = Object.values(
		Object.groupBy(observations, (item) => item.cohortKey),
	).map((items) => ({
		key: items[0].cohortKey,
		stratum: items[0].stratum,
		observations: items,
	}));
	return {
		version: 1,
		eventsRead: events.length,
		qualifiedItems: observations.length,
		unqualifiedItems: samples.size - observations.length,
		cohorts,
	};
}

function comparable(left, right) {
	return [
		"identityKind",
		"roleMapping",
		"project",
		"assuranceStratum",
		"mode",
	].every((field) => left.stratum[field] === right.stratum[field]);
}

export function evaluateRoutingPaths(adapted, options = {}) {
	const observations = adapted.cohorts.flatMap((cohort) => cohort.observations);
	const optionalPaths = options.optionalPaths ?? OPTIONAL_PATHS;
	const decisions = optionalPaths.map((path) => {
		const pairs = [];
		const candidates = Object.groupBy(
			observations.filter(
				(item) => item.arm === "candidate" && item.stratum.routingPath === path,
			),
			(item) => item.pairId,
		);
		for (const [pairId, matches] of Object.entries(candidates)) {
			const baselines = observations.filter(
				(item) =>
					item.arm === "baseline" &&
					item.pairId === pairId &&
					item.stratum.routingPath === "default" &&
					comparable(item, matches[0]),
			);
			if (matches.length === 1 && baselines.length === 1)
				pairs.push({
					pairId,
					baseline: baselines[0].outcomes,
					candidate: matches[0].outcomes,
				});
		}
		const score = evaluateRoutingDecision(pairs, options.calibration ?? {});
		const retained = score.status === "candidate-accepted";
		return {
			path,
			disposition: retained
				? "retain-opt-in"
				: "disable-remove-dead-adapter-config",
			defaultsChanged: false,
			score,
		};
	});
	return {
		version: 1,
		contract: "workflow-evaluation-routing-simplification/v1",
		outcomes: ROUTING_OUTCOMES,
		providerFallback: "provider-neutral",
		decisions,
		retainedPaths: decisions
			.filter((item) => item.disposition === "retain-opt-in")
			.map((item) => item.path),
		removedPaths: decisions
			.filter((item) => item.disposition !== "retain-opt-in")
			.map((item) => item.path),
	};
}
