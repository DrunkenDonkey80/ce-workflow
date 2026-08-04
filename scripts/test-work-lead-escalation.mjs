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

const globalDir = mkdtempSync(path.join(tmpdir(), "work-lead-global-"));
process.env.PI_CODING_AGENT_DIR = globalDir;
const {
	buildWorkResumeState,
	directRoleHandoffParams,
	driveWorkActionLeases,
	executeOrchestratorAction,
	launchDirectAction,
	leadEscalationDecision,
} = await import("../extensions/work-models.js");
const {
	acquireWorkActionLease,
	currentWorkActionLeases,
	fenceWorkActionLease,
	readWorkActionLeaseEvents,
} = await import("../extensions/work-action-leases.js");
const { createWorkItem, initStore, loadStore, saveStore, updateWorkItem } =
	await import("../extensions/work-store.js");

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
function fixture(name, strategy = "main-first", backup = true) {
	const cwd = mkdtempSync(path.join(tmpdir(), `work-lead-${name}-`));
	git(cwd, "init", "-q");
	git(cwd, "config", "user.email", "fixture@example.invalid");
	git(cwd, "config", "user.name", "Fixture");
	writeFileSync(path.join(cwd, ".gitignore"), ".ce-workflow/\n.pi/\n");
	writeFileSync(path.join(cwd, "source.js"), "export const value = 1;\n");
	git(cwd, "add", ".gitignore", "source.js");
	git(cwd, "commit", "-qm", "fixture");
	mkdirSync(path.join(cwd, ".pi"), { recursive: true });
	writeFileSync(
		path.join(cwd, ".pi", "settings.json"),
		JSON.stringify({
			workOrchestrator: {
				slicePlanBeforeWork: false,
				modelStrategy: strategy,
				...(backup
					? {
							roleBackups: {
								lead: { model: "backup-provider/lead", thinking: "high" },
							},
						}
					: {}),
			},
			subagents: {
				agentOverrides: {
					"work-worker": {
						model: "main-provider/builder",
						thinking: "medium",
					},
					"work-fixer": {
						model: "main-provider/builder",
						thinking: "medium",
					},
				},
			},
		}),
	);
	const store = initStore(cwd);
	createWorkItem(store, {
		id: "E-1",
		type: "epic",
		status: "in_progress",
		title: "Lead roadmap",
	});
	createWorkItem(store, {
		id: "W-1",
		type: "task",
		status: "open",
		parentId: "E-1",
		title: "Routine edit",
		acceptance: "The public API remains backward compatible.",
		notes: ['wo:assurance {"version":1,"level":"high","reasons":["owner"]}'],
	});
	saveStore(cwd, store);
	return cwd;
}
function highState(cwd) {
	const state = buildWorkResumeState(cwd, "E-1");
	const direct = directRoleHandoffParams(state, cwd);
	assert(
		state.action === "run-implementation" &&
			direct?.agent === "work-lead" &&
			direct.params.model === "main-provider/builder" &&
			direct.params.thinking === "high",
		"canonical high assurance routes to explicit Lead using the effective Builder model at high effort",
	);
	return { state, direct };
}
function fakePi(outcomes, seen, credential = () => ({ ok: true, apiKey: "fixture" })) {
	let reply;
	return {
		modelRegistry: {
			find: (provider, id) => ({ provider, id }),
			getApiKeyAndHeaders: credential,
		},
		events: {
			on(_name, handler) {
				reply = handler;
				return () => {};
			},
			emit(_name, request) {
				seen.push(request.params.model ?? "inherit");
				const success = outcomes.shift();
				queueMicrotask(() =>
					reply(
						success
							? {
									success: true,
									data: {
										runId: `run-${seen.length}`,
										asyncDir: path.join(request.params.cwd, `.run-${seen.length}`),
									},
								}
							: { success: false, error: { message: "candidate unavailable" } },
					),
				);
			},
		},
	};
}

const cleanup = [];
try {
	const oneModel = fixture("one-model", "main-first", false);
	cleanup.push(oneModel);
	const one = highState(oneModel);
	assert(one.direct.routing.candidates.length === 1, "absent Backup preserves Main-only behavior");

	const roundRobin = fixture("round-robin", "round-robin");
	cleanup.push(roundRobin);
	const initial = highState(roundRobin);
	const prior = acquireWorkActionLease(roundRobin, {
		workflowRunId: "prior",
		roadmapId: "E-1",
		workItemId: "W-1",
		action: "run-resolution",
		semanticRole: "lead",
		requestedAssurance: "high",
		candidateKey: "lead",
		selectedCandidate: "main",
	});
	fenceWorkActionLease(roundRobin, prior.leaseId, "fixture");
	const alternated = directRoleHandoffParams(initial.state, roundRobin);
	assert(
		alternated.routing.candidates[0].id === "backup",
		"round-robin alternates eligible candidates durably through the action ledger",
	);

	const unhealthyPrimary = fixture("unhealthy-primary");
	cleanup.push(unhealthyPrimary);
	const unhealthyRoute = highState(unhealthyPrimary);
	const unhealthyAttempts = [];
	const unhealthyChecks = [];
	const backupLaunch = await launchDirectAction(
		unhealthyPrimary,
		unhealthyRoute.state,
		unhealthyRoute.direct,
		fakePi([true], unhealthyAttempts, (model) => {
			unhealthyChecks.push(`${model.provider}/${model.id}`);
			return model.provider === "main-provider"
				? { ok: false, error: "No API key for main-provider" }
				: { ok: true, apiKey: "fixture" };
		}),
		{ mode: "rpc" },
	);
	assert(
		backupLaunch.spawned.ok &&
			unhealthyChecks.join(",") ===
				"main-provider/builder,backup-provider/lead" &&
			unhealthyAttempts.join(",") === "backup-provider/lead" &&
			currentWorkActionLeases(unhealthyPrimary).at(-1).selectedCandidate ===
				"backup" &&
			currentWorkActionLeases(unhealthyPrimary).at(-1)
				.degradedIndependence === false,
		"credential preflight skips an unauthenticated Main and launches the authenticated Backup",
	);

	const unavailable = fixture("preflight-unavailable");
	cleanup.push(unavailable);
	const unavailableRoute = highState(unavailable);
	const unavailableAttempts = [];
	const unavailableLeaseCount = currentWorkActionLeases(unavailable).length;
	const unavailableLaunch = await launchDirectAction(
		unavailable,
		unavailableRoute.state,
		unavailableRoute.direct,
		fakePi([], unavailableAttempts, (model) => ({
			ok: false,
			error: `No API key for ${model.provider}`,
		})),
		{ mode: "rpc" },
	);
	const unavailableEvidence = unavailableLaunch.spawned.infrastructureEvidence;
	assert(
		unavailableLaunch.state.action === "model-routing-unavailable" &&
			unavailableAttempts.length === 0 &&
			currentWorkActionLeases(unavailable).length === unavailableLeaseCount &&
			loadStore(unavailable).items["W-1"].status === "open" &&
			unavailableEvidence?.candidates
				.map((candidate) => `${candidate.id}:${candidate.model}:${candidate.reason}`)
				.join("|") ===
				"main:main-provider/builder:No API key or login is available.|backup:backup-provider/lead:No API key or login is available.",
		"all-unavailable preflight performs no RPC or mutable lease/claim and returns deterministic candidate evidence",
	);

	const healthyPrimary = fixture("healthy-primary");
	cleanup.push(healthyPrimary);
	const healthyRoute = highState(healthyPrimary);
	const healthyAttempts = [];
	const healthyChecks = [];
	const primaryLaunch = await launchDirectAction(
		healthyPrimary,
		healthyRoute.state,
		healthyRoute.direct,
		fakePi([true], healthyAttempts, (model) => {
			healthyChecks.push(`${model.provider}/${model.id}`);
			return { ok: true, apiKey: "fixture" };
		}),
		{ mode: "rpc" },
	);
	assert(
		primaryLaunch.spawned.ok &&
			healthyChecks.join(",") ===
				"main-provider/builder,backup-provider/lead" &&
			healthyAttempts.join(",") === "main-provider/builder",
		"healthy Main launches normally after registry credential lookups only, without a provider inference probe",
	);

	const fallback = fixture("fallback");
	cleanup.push(fallback);
	const routed = highState(fallback);
	const attempts = [];
	const launched = await launchDirectAction(
		fallback,
		routed.state,
		routed.direct,
		fakePi([false, true], attempts),
		{ mode: "rpc", session: "fixture" },
	);
	const fallbackLease = currentWorkActionLeases(fallback).at(-1);
	assert(
		launched.spawned.ok &&
			attempts.join(",") === "main-provider/builder,backup-provider/lead" &&
			fallbackLease.selectedCandidate === "backup" &&
			fallbackLease.fallback === true &&
			fallbackLease.requestedAssurance === "high" &&
			fallbackLease.achievedAssurance === "high" &&
			fallbackLease.degradedIndependence === false &&
			fallbackLease.semanticRole === "lead",
		`fallback records candidate, assurance, independence, and explicit semantic role: ${JSON.stringify({ attempts, fallbackLease })}`,
	);

	const exhausted = fixture("exhausted");
	cleanup.push(exhausted);
	const exhaustedRoute = highState(exhausted);
	const parked = await launchDirectAction(
		exhausted,
		exhaustedRoute.state,
		exhaustedRoute.direct,
		fakePi([false, false], []),
		{ mode: "rpc" },
	);
	const parkedLease = currentWorkActionLeases(exhausted).at(-1);
	const parkedItem = loadStore(exhausted).items["W-1"];
	assert(
		parked.state.action === "model-routing-parked" &&
			parkedLease.state === "parked" &&
			parkedItem.labels.includes("wo:blocked") &&
			String(parkedItem.notes).includes("wo:operator-blocker") &&
			String(parkedItem.notes).includes("work-label W-1 --remove wo:blocked") &&
			readWorkActionLeaseEvents(exhausted).some(
				(event) => event.leaseId === parkedLease.leaseId && event.state === "parked",
			),
		"candidate exhaustion parks durably with visible blocker evidence and a coded recovery command",
	);
	const statusNotices = [];
	await executeOrchestratorAction(
		"work-status",
		"E-1",
		{ cwd: exhausted, ui: { notify: (message) => statusNotices.push(message) } },
		{},
	);
	assert(
		statusNotices.some((message) =>
			String(message).includes("Action lease: parked lead W-1"),
		),
		"/work-status and the lease ledger expose parked state",
	);
	const exhaustedStore = loadStore(exhausted);
	createWorkItem(exhaustedStore, {
		id: "W-2",
		type: "task",
		status: "open",
		parentId: "E-1",
		title: "Unrelated work",
	});
	saveStore(exhausted, exhaustedStore);
	const unrelatedLease = acquireWorkActionLease(exhausted, {
		workflowRunId: "unrelated",
		roadmapId: "E-1",
		workItemId: "W-2",
		action: "run-implementation",
		semanticRole: "builder",
	});
	assert(unrelatedLease.workItemId === "W-2", "a parked item does not block unrelated repository work");
	fenceWorkActionLease(exhausted, unrelatedLease.leaseId, "fixture-release");
	const recoveryStore = loadStore(exhausted);
	updateWorkItem(recoveryStore, "W-1", {
		labels: recoveryStore.items["W-1"].labels.filter(
			(label) => label !== "wo:blocked",
		),
	});
	saveStore(exhausted, recoveryStore);
	const recoveredLease = acquireWorkActionLease(exhausted, {
		workflowRunId: "operator-recovery",
		roadmapId: "E-1",
		workItemId: "W-1",
		action: "run-resolution",
		semanticRole: "lead",
	});
	assert(
		currentWorkActionLeases(exhausted).find(
			(lease) => lease.leaseId === parkedLease.leaseId,
		)?.state === "fenced" && recoveredLease.generation > parkedLease.generation,
		"clearing the durable blocker fences the parked lease and enables a new generation",
	);
	fenceWorkActionLease(exhausted, recoveredLease.leaseId, "fixture-release");

	const local = {
		notes: ['wo:failure {"version":1,"classification":"localized","understood":true}'],
	};
	assert(
		leadEscalationDecision(local, []).action === "repair" &&
			leadEscalationDecision(local, [{ action: "run-repair" }]).action === "lead",
		"one localized understood Builder repair is the durable limit",
	);

	const successfulFence = fixture("successful-fence", "main-first", false);
	cleanup.push(successfulFence);
	const successfulStore = loadStore(successfulFence);
	updateWorkItem(successfulStore, "W-1", { notes: [] });
	saveStore(successfulFence, successfulStore);
	const successfulState = buildWorkResumeState(successfulFence, "E-1");
	const successfulLaunch = await launchDirectAction(
		successfulFence,
		successfulState,
		directRoleHandoffParams(successfulState, successfulFence),
		fakePi([true], []),
		{ mode: "rpc" },
	);
	const successfulDir = currentWorkActionLeases(successfulFence).at(-1)
		.launchIdentity.asyncDir;
	const closedStore = loadStore(successfulFence);
	updateWorkItem(closedStore, "W-1", { status: "closed" });
	saveStore(successfulFence, closedStore);
	mkdirSync(successfulDir, { recursive: true });
	writeFileSync(
		path.join(successfulDir, "status.json"),
		JSON.stringify({ state: "completed", steps: [{ status: "completed" }] }),
	);
	const forbiddenEscalations = [];
	const successfulResult = await driveWorkActionLeases(successfulFence, {
		pi: fakePi([true], forbiddenEscalations),
		mode: "rpc",
	});
	assert(
		successfulResult[0]?.state === "fenced" &&
			forbiddenEscalations.length === 0 &&
			!String(loadStore(successfulFence).items["W-1"].notes).includes(
				"wo:escalation",
			),
		"a successful specialist terminal fenced by closed-item validation never escalates",
	);

	const supersededFence = fixture("superseded-fence", "main-first", false);
	cleanup.push(supersededFence);
	const supersededStore = loadStore(supersededFence);
	updateWorkItem(supersededStore, "W-1", { notes: [] });
	saveStore(supersededFence, supersededStore);
	const supersededState = buildWorkResumeState(supersededFence, "E-1");
	const supersededLaunch = await launchDirectAction(
		supersededFence,
		supersededState,
		directRoleHandoffParams(supersededState, supersededFence),
		fakePi([true], []),
		{ mode: "rpc" },
	);
	const changedStore = loadStore(supersededFence);
	updateWorkItem(changedStore, "W-1", { labels: ["superseded"] });
	saveStore(supersededFence, changedStore);
	const supersededDir = currentWorkActionLeases(supersededFence).at(-1)
		.launchIdentity.asyncDir;
	mkdirSync(supersededDir, { recursive: true });
	writeFileSync(
		path.join(supersededDir, "status.json"),
		JSON.stringify({ state: "failed", steps: [{ status: "failed" }] }),
	);
	const supersededEscalations = [];
	await driveWorkActionLeases(supersededFence, {
		pi: fakePi([true], supersededEscalations),
		mode: "rpc",
	});
	assert(
		supersededEscalations.length === 0,
		"closed or superseded WorkItems cannot launch recovery writers",
	);

	const repairFixture = fixture("repair", "main-first", false);
	cleanup.push(repairFixture);
	const repairStore = loadStore(repairFixture);
	updateWorkItem(repairStore, "W-1", {
		title: "Localized implementation",
		acceptance: "A focused unit check passes.",
		notes: local.notes,
	});
	saveStore(repairFixture, repairStore);
	const repairState = buildWorkResumeState(repairFixture, "E-1");
	const repairDirect = directRoleHandoffParams(repairState, repairFixture);
	assert(repairDirect.agent === "work-worker", "normal assurance starts with Builder");
	const initialRepairLaunch = await launchDirectAction(
		repairFixture,
		repairState,
		repairDirect,
		fakePi([true], []),
		{ mode: "rpc" },
	);
	assert(initialRepairLaunch.spawned.ok, "fixture Builder launch is acknowledged");
	const failedDir = currentWorkActionLeases(repairFixture).at(-1).launchIdentity
		?.asyncDir;
	mkdirSync(failedDir, { recursive: true });
	writeFileSync(
		path.join(failedDir, "status.json"),
		JSON.stringify({ state: "failed", steps: [{ status: "failed" }] }),
	);
	const repairAttempts = [];
	const recovered = await driveWorkActionLeases(repairFixture, {
		pi: fakePi([true], repairAttempts),
		mode: "rpc",
	});
	assert(
		recovered[0]?.action === "run-repair" &&
			recovered[0].launched &&
			currentWorkActionLeases(repairFixture).at(-1).action === "run-repair",
		"a real failed Builder lease launches exactly one durable localized repair",
	);
	for (const classification of [
		"ambiguous",
		"cross-layer",
		"plan-conflicting",
		"scope-expanding",
		"high-consequence",
	])
		assert(
			leadEscalationDecision({
				notes: [
					`wo:failure {"version":1,"classification":"${classification}","understood":true}`,
				],
			}).action === "lead",
			`${classification} routes directly to Lead`,
		);
	const leadContract = readFileSync(
		path.join(import.meta.dirname, "..", "agents", "work-lead.md"),
		"utf8",
	);
	assert(
		leadContract.includes("diagnose architecture and plan constraints") &&
			leadContract.includes("do not hand mutable ownership back to Builder"),
		"Lead owns diagnosis, edit, and verification end to end",
	);
	console.log("ok - Lead routing, fallback strategy, and bounded escalation");
} finally {
	for (const cwd of cleanup) rmSync(cwd, { recursive: true, force: true });
	rmSync(globalDir, { recursive: true, force: true });
}
