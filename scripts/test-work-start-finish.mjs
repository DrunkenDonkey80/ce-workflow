#!/usr/bin/env node
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
const { assert, installWorkflowFixture } = await import(
	pathToFileURL(
		realpathSync(path.join(import.meta.dirname, "work-command-fixture.mjs")),
	).href
);

const {
	bootstrapPlanEpic,
	buildWorkAutoState,
	buildWorkBigState,
	buildWorkFinishState,
	executeWorkFinishState,
	buildWorkInitState,
	buildWorkMasterState,
	buildWorkMedState,
	buildWorkPlanState,
	buildWorkResumeState,
	buildWorkMigrateState,
	buildWorkSmallState,
	buildWorkTelemetryState,
	cePlanSliceStep,
	directRoleHandoffParams,
	createPiSubagentsVerifierAdapter,
} = await import(
	pathToFileURL(
		realpathSync(
			path.join(import.meta.dirname, "../extensions/work-models.js"),
		),
	).href
);

const fixture = installWorkflowFixture({ native: true });
try {
	assert(
		createPiSubagentsVerifierAdapter({}).enforcesReadOnlyBoundary,
		"project-owned verifier tools enforce the launch boundary without provider capabilities",
	);
	const listeners = new Map();
	let projectReportAvailable = false;
	let verifierRpcParams;
	const verifierAdapter = createPiSubagentsVerifierAdapter({
		getAllTools: () =>
			projectReportAvailable ? [{ name: "project_report" }] : [],
		events: {
			on(name, listener) {
				listeners.set(name, listener);
				return () => listeners.delete(name);
			},
			emit(_name, request) {
				verifierRpcParams = request.params;
				listeners.get(`subagents:rpc:v1:reply:${request.requestId}`)?.({
					success: true,
					data: { runId: "verifier-run", asyncDir: "C:/tmp/verifier-run" },
				});
			},
		},
	});
	const verifierCheckpoint = { snapshot: "a".repeat(40) };
	const verifierRequest = {
		version: 1,
		agent: "work-background-verifier",
		context: "fresh",
		async: true,
		cwd: fixture.cwd,
		output: "C:/tmp/output.json",
		outputMode: "file-only",
		logicalJobId: "job-test",
		model: "openai/gpt-5",
		thinking: "low",
		operations: ["correctness"],
		paths: ["tracked.txt"],
		checkpoint: verifierCheckpoint,
		boundary: {
			readOnlyWorkspace: true,
			cwdConfinedReadTools: true,
			credentialsIsolated: true,
			toolAllowlist: [
				"work_verifier_read",
				"work_verifier_list",
				"work_verifier_find",
				"work_verifier_grep",
				"project_report",
			],
		},
	};
	assert(
		(await verifierAdapter.spawn(verifierRequest)).ok,
		"adapter launches without fictional provider capabilities",
	);
	assert(
		verifierRpcParams.task.includes('"job-test"') &&
			verifierRpcParams.task.includes('"openai/gpt-5"') &&
			verifierRpcParams.task.includes(JSON.stringify(verifierCheckpoint)),
		"verifier handoff includes the exact immutable report identity",
	);
	assert(
		verifierRpcParams.agent === "work-background-verifier" &&
			!verifierRpcParams.tools.includes("project_report") &&
			verifierRpcParams.agentContract?.version === 1 &&
			verifierRpcParams.acceptance === false,
		"verifiers use checkpoint-only tools without a conflicting acceptance contract",
	);
	projectReportAvailable = true;
	assert(
		(await verifierAdapter.spawn(verifierRequest)).ok &&
			verifierRpcParams.agent === "work-background-verifier" &&
			!verifierRpcParams.tools.includes("project_report") &&
			!verifierRpcParams.task.includes("project_report"),
		"isolated verifiers do not inherit host-only pi-lens tools",
	);
	let state = buildWorkSmallState(fixture.cwd, "Add coded start gate");
	assert(
		state.ok && state.action === "run-implementation",
		"small creates implementation handoff",
	);
	assert(
		state.epic.title === "Misc" &&
			state.epic.labels.includes("wo:misc") &&
			state.selectedWorkItem.status === "in_progress",
		"small creates and claims one native task under Misc",
	);
	const smallDirect = directRoleHandoffParams(state, fixture.cwd);
	assert(
		!state.inlineWork &&
			state.executionPolicy.level === "small" &&
			state.executionPolicy.maxFiles === 2,
		"small preserves its scope while using an isolated worker",
	);
	assert(
		smallDirect?.agent === "work-worker" &&
			smallDirect.params.task.includes(
				`work-claim ${state.selectedWorkItem.id}`,
			) &&
			smallDirect.params.task.includes("Implementation scope: small") &&
			smallDirect.params.task.includes("at most 2 implementation files") &&
			smallDirect.params.task.includes("native edit tool") &&
			smallDirect.params.task.includes("Do not rewrite tracked files"),
		"small launches the configured worker with bounded scope",
	);
	assert(
		fixture.store().items[state.selectedWorkItem.id].type === "task" &&
			fixture.logs().length === 0,
		"small creates exactly one native task without bd",
	);

	fixture.reset("active");
	state = buildWorkSmallState(
		fixture.cwd,
		"try the hardware probe to verify the device without changing source",
	);
	assert(
		directRoleHandoffParams(state, fixture.cwd)?.params.task.includes(
			"Evidence-only task:",
		) &&
			directRoleHandoffParams(state, fixture.cwd)?.params.task.includes(
				"do not substitute a broader suite or edit product/workflow source",
			),
		"evidence-only small work keeps its narrow probe contract",
	);

	fixture.reset("active");
	const longTask = `Implement the wedge workflow ${"with careful acceptance details ".repeat(20)}`;
	state = buildWorkSmallState(fixture.cwd, longTask);
	const longCreate = fixture.store().items[state.selectedWorkItem.id];
	assert(longCreate.title.length <= 181, "small clamps long task title");
	assert(
		longCreate.notes.join("\n").includes(longTask.trim()),
		"small keeps full request in native notes",
	);

	fixture.reset("active");
	state = buildWorkSmallState(fixture.cwd, "IMP-1 extra guidance");
	assert(
		state.ok && state.selectedWorkItem.id === "IMP-1",
		"small explicit WorkItem reuses target",
	);
	assert(
		fixture.logs().length === 0,
		"small explicit WorkItem creates nothing",
	);

	state = buildWorkSmallState(fixture.cwd, "");
	assert(!state.ok && state.reason === "usage", "small empty task stops");

	fixture.reset("ambiguous");
	state = buildWorkSmallState(fixture.cwd, "Needs a general home");
	assert(
		state.ok && state.epic.labels.includes("wo:misc"),
		"small without a current roadmap uses Misc",
	);
	assert(fixture.logs().length === 0, "small Misc routing does not invoke bd");

	fixture.reset("active", "unknown");
	state = buildWorkSmallState(fixture.cwd, "Dirty should stop");
	assert(
		!state.ok && state.reason === "dirty-stop",
		"small dirty state stops before mutation",
	);
	assert(fixture.logs().length === 0, "small dirty stop creates nothing");

	fixture.reset("active", "work-state");
	state = buildWorkSmallState(fixture.cwd, "Continue after coded intake");
	assert(
		state.ok && state.git.workflowDirty && state.git.blockedPaths.length === 0,
		"workflow state written by the extension never blocks the next action",
	);

	fixture.reset("active");
	state = buildWorkMedState(fixture.cwd, "Split a bounded feature");
	const medDirect = directRoleHandoffParams(state, fixture.cwd);
	assert(
		state.ok &&
			state.action === "run-implementation" &&
			!state.inlineWork &&
			state.executionPolicy.level === "medium",
		"med creates one medium scoped worker handoff",
	);
	assert(
		state.selectedWorkItem.status === "in_progress" &&
			!fixture
				.store()
				.items[state.selectedWorkItem.id].notes.join("\n")
				.includes("wo:execution-inline"),
		"med creates and claims a task without the retired inline marker",
	);
	assert(
		medDirect?.agent === "work-worker" &&
			medDirect.params.task.includes("Implementation scope: medium") &&
			medDirect.params.task.includes("at most 8 implementation files"),
		"med launches the configured worker with bounded scope",
	);

	fixture.reset("active");
	state = buildWorkSmallState(
		fixture.cwd,
		"Update authentication permission checks",
	);
	const riskyDirect = directRoleHandoffParams(state, fixture.cwd);
	assert(
		!state.inlineWork &&
			riskyDirect?.agent === "work-lead" &&
			riskyDirect.params.task.includes("native edit tool") &&
			riskyDirect.params.task.includes("Do not rewrite tracked files"),
		"sensitive small requests use the native-tool high-assurance Lead",
	);

	fixture.reset("active");
	state = buildWorkAutoState(fixture.cwd, "Add docs note");
	assert(
		state.autoClassification === "small" &&
			directRoleHandoffParams(state, fixture.cwd)?.agent === "work-worker",
		"auto classifies obvious small work and routes it to the worker",
	);

	fixture.reset("active");
	state = buildWorkBigState(fixture.cwd, "Design a risky feature");
	assert(
		state.ok && state.action === "run-planner",
		"big creates planner handoff",
	);
	const bigDirect = directRoleHandoffParams(state, fixture.cwd);
	assert(
		state.handoffPrompt.includes("big slice") &&
			state.handoffPrompt.includes(
				"create an open decision only for unresolved human, product, or architectural authority",
			) &&
			bigDirect?.agent === "work-planner" &&
			state.selectedWorkItem.labels.includes("wo:planning") &&
			state.selectedWorkItem.labels.includes("wo:big-work") &&
			state.handoffPrompt.includes("Propagate the wo:big-work marker"),
		"big creates a labelled planning intake without forcing a technical decision blocker",
	);
	assert(
		bigDirect.params.task.length < 3200 &&
			bigDirect.params.task.includes(
				`Target work item: ${state.selectedWorkItem.id}`,
			) &&
			bigDirect.params.task.includes("work-ready-summary") &&
			bigDirect.params.task.includes("record a technical winner otherwise") &&
			bigDirect.params.task.includes("Planner parent launch baseline:") &&
			bigDirect.params.task.includes('"head":"c0ffee1"') &&
			bigDirect.params.task.includes('"agentsHead":"agents111"') &&
			bigDirect.params.task.includes('"agentsWorktree":"agents111"') &&
			bigDirect.params.task.includes('"launchSafe":true') &&
			bigDirect.params.task.includes(
				'"managedAgentsOverlayEligible":true',
			) &&
			bigDirect.params.task.includes(
				"a new unstaged tracked AGENTS.md modification may be treated as a transient managed startup overlay",
			) &&
			bigDirect.params.task.includes(
				"Staged/untracked AGENTS, a baseline AGENTS entry, or unrelated dirt always blocks",
			) &&
			bigDirect.params.task.includes(
				"require AGENTS.md to hash to agentsWorktree and agentsHead",
			) &&
			!bigDirect.params.task.includes("raw store readiness") &&
			!bigDirect.params.task.includes("Subagent output guidance") &&
			bigDirect.params.acceptance.level === "none" &&
			bigDirect.params.acceptance.reason.includes("coded work-item"),
		"big sends the planner a compact parent-bound instruction-dirt contract",
	);

	process.env.WORK_FLOW_GIT_DIRTY = "instruction-substantive";
	const changedAtHandoff = directRoleHandoffParams(state, fixture.cwd)?.params.task;
	assert(
		changedAtHandoff?.includes('"launchSafe":false') &&
			changedAtHandoff.includes('"launchBlockedPaths":["AGENTS.md"]') &&
			changedAtHandoff.includes('"managedAgentsOverlayEligible":false'),
		"planner launch fails closed when AGENTS changes after the parent status snapshot but before handoff generation",
	);
	process.env.WORK_FLOW_GIT_DIRTY = "unknown";
	assert(
		directRoleHandoffParams(state, fixture.cwd)?.params.task.includes(
			'"launchBlockedPaths":["extensions/work-models.js"]',
		),
		"planner handoff records unrelated dirt that appears after intake as a launch blocker",
	);

	fixture.reset("active", "benign");
	state = buildWorkBigState(fixture.cwd, "Design with formatter-only instructions");
	assert(
		state.ok &&
			directRoleHandoffParams(state, fixture.cwd)?.params.task.includes(
				'"managedAgentsOverlayEligible":false',
			) &&
			directRoleHandoffParams(state, fixture.cwd)?.params.task.includes(
				"whitespace-ignored diff is empty",
			),
		"preexisting formatter-only AGENTS dirt keeps its narrow tolerance without enabling substantive overlays",
	);

	for (const dirty of [
		"instruction-substantive",
		"staged-instruction",
		"untracked-instruction",
		"unknown",
	]) {
		fixture.reset("active", dirty);
		state = buildWorkBigState(fixture.cwd, `Blocked planner launch: ${dirty}`);
		assert(
			!state.ok && state.reason === "dirty-stop",
			`planner launch rejects preexisting ${dirty} dirt`,
		);
	}

	fixture.reset("no-store");
	state = buildWorkInitState(fixture.cwd);
	assert(
		state.ok && ["initialized", "already-initialized"].includes(state.action),
		"work-init uses native store",
	);
	assert(fixture.logs().length === 0, "work-init does not run bd");

	fixture.reset("no-store");
	state = buildWorkPlanState(fixture.cwd, "raw product idea");
	assert(
		state.ok && state.action === "handoff-plan",
		"raw work-plan input routes to private planning",
	);
	assert(fixture.logs().length === 0, "work-plan does not initialize bd");
	assert(
		state.nextAction.includes("bootstrap-plan-roadmap") &&
			!state.nextAction.includes("/work-plan <plan-path>"),
		"raw work-plan bootstraps the roadmap in-flow instead of asking to re-run /work-plan",
	);
	assert(
		state.handoffPrompt.includes("BEGIN VERIFIED PRIVATE PLAN PLAYBOOK") &&
			state.handoffPrompt.includes("Preserve every decided requirement") &&
			state.handoffPrompt.includes("Acceptance Contract") &&
			state.handoffPrompt.includes("hardening loop") &&
			state.handoffPrompt.includes("Open Question Gate") &&
			state.handoffPrompt.includes("Actor-visible handoff") &&
			!state.handoffPrompt.includes("Invoke the ce-plan skill"),
		"work-plan handoff dispatches verified private planning while preserving closure contracts",
	);

	fixture.reset("active");
	state = buildWorkMasterState(fixture.cwd, "raw product idea");
	assert(
		state.ok && state.action === "handoff-plan",
		"raw master input routes to private planning",
	);
	assert(
		state.handoffPrompt.includes("BEGIN VERIFIED PRIVATE PLAN PLAYBOOK") &&
			state.handoffPrompt.includes("bootstrap-plan-roadmap"),
		"master planning dispatches the same verified plan resource and actor-visible handoff",
	);
	assert(
		fixture.logs().length === 0,
		"raw master input does not mutate WorkItems",
	);
	for (const depth of ["Lightweight", "Standard", "Deep"]) {
		const slice = cePlanSliceStep(
			{ id: "SLICE-1", title: "Depth fixture", acceptance: "checked" },
			fixture.cwd,
			undefined,
			depth,
		);
		assert(
			slice.includes("BEGIN VERIFIED PRIVATE PLAN PLAYBOOK") &&
				slice.includes(`Use ${depth} depth`) &&
				slice.includes("wo:slice-plan") &&
				!slice.includes("Invoke the ce-plan skill"),
			`${depth} slice planning dispatches the verified private plan resource`,
		);
	}

	state = buildWorkMasterState(fixture.cwd, "missing-plan.md");
	assert(
		!state.ok && state.reason === "missing-source",
		"missing master source stops",
	);

	fixture.reset("active");
	const masterPlan =
		"docs/plans/2026-07-03-004-feat-coded-start-finish-gates-plan.md";
	state = buildWorkMasterState(fixture.cwd, `@${masterPlan}`);
	assert(
		state.ok && state.action === "review-plan-before-bootstrap",
		"@ plan path runs advisors before bootstrap",
	);
	state = bootstrapPlanEpic(fixture.cwd, masterPlan);
	assert(
		state.ok && state.epic.type === "epic",
		"reviewed @ plan path creates native epic",
	);
	assert(
		state.selectedWorkItem.type === "task",
		"@ plan path creates one native planning task",
	);
	assert(
		fixture
			.store()
			.items[state.epic.id].documentLinks.design.includes("docs/plans/"),
		"@ plan path links master plan without embedding it",
	);
	assert(
		state.nextAction.includes(`/work-resume ${state.epic.id}`),
		"@ plan path reports resume command",
	);

	fixture.reset("active", "pi-session");
	state = buildWorkMasterState(fixture.cwd, masterPlan);
	assert(
		state.ok && state.action === "review-plan-before-bootstrap",
		"plan review ignores pi-session HTML artifacts",
	);
	state = bootstrapPlanEpic(fixture.cwd, masterPlan);
	assert(
		state.ok && state.action === "run-planner",
		"plan bootstrap ignores pi-session HTML artifacts",
	);

	fixture.reset("active", "unknown");
	state = buildWorkMasterState(
		fixture.cwd,
		"docs/plans/2026-07-03-004-feat-coded-start-finish-gates-plan.md",
	);
	assert(
		!state.ok && state.reason === "dirty-stop",
		"master dirty state stops before WorkItems mutation",
	);
	assert(
		state.message.includes("extensions/work-models.js"),
		"master dirty stop names blocking files",
	);

	fixture.reset("active");
	state = buildWorkMigrateState(
		fixture.cwd,
		"docs/plans/2026-07-03-004-feat-coded-start-finish-gates-plan.md origin/old-feature legacy notes",
	);
	assert(
		state.ok && state.action === "handoff-migrate",
		"migrate normalizes sources",
	);
	assert(state.sources.files.length === 1, "migrate preserves file source");
	assert(
		state.sources.branches.includes("origin/old-feature"),
		"migrate preserves branch source",
	);
	assert(
		state.handoffPrompt.includes("do not checkout"),
		"migrate handoff forbids branch mutation",
	);
	assert(fixture.logs().length === 0, "migrate does not mutate WorkItems");
	assert(
		directRoleHandoffParams(state, fixture.cwd)?.agent === "work-migrator",
		"migrate directly selects the exact specialist without agent discovery",
	);

	state = buildWorkMigrateState(fixture.cwd, "missing-source.md");
	assert(
		!state.ok && state.reason === "missing-source",
		"migrate missing path stops",
	);

	const finishCwd = fixture.cwd;
	mkdirSync(path.join(finishCwd, ".pi"), { recursive: true });
	writeFileSync(
		path.join(finishCwd, ".pi", "settings.json"),
		JSON.stringify({
			workOrchestrator: {
				browserTestsOnUiDiff: false,
				codeReviewBeforeCommit: "off",
				backgroundVerifiers: {
					"openai/gpt-5": { operations: ["correctness"], thinking: "low" },
				},
			},
		}),
	);

	fixture.reset("finishReady", "unknown");
	state = buildWorkFinishState(finishCwd, "FIN-1");
	assert(
		state.ok && state.action === "commit-ready",
		"finish accepts reviewed verified related dirty work",
	);
	assert(
		state.commitMessage === "FIN-1: Finishable slice",
		"finish produces deterministic commit seed",
	);
	state = executeWorkFinishState(finishCwd, state);
	assert(
		state.ok && state.action === "finish-committed" && !state.handoffPrompt,
		"routine finish commits and closes without a committer or learning-capture handoff",
	);
	assert(
		state.verifier && state.verifier.status !== "suppressed",
		"normal finish attempts background verification after commit",
	);
	assert(
		buildWorkTelemetryState(finishCwd, "workItem FIN-1").slowest.some(
			(event) =>
				event.type === "verifier-scope" &&
				event.payoff?.backgroundVerifier?.batchId === state.verifier.batch?.id,
		),
		"finish persists the verifier batch-to-task stats scope",
	);
	assert(
		fixture
			.logs()
			.some((entry) => entry.tool === "git" && entry.op === "commit") &&
			fixture
				.logs()
				.some((entry) => entry.tool === "git" && entry.op === "amend") &&
			fixture.store().items["FIN-1"].status === "closed" &&
			!fixture.logs().some((entry) => entry.op === "close"),
		"finish stages work, closes native state, and amends one commit without bd",
	);

	for (const scenario of ["finishDebugReady", "finishBigReady"]) {
		fixture.reset(scenario, "unknown");
		state = executeWorkFinishState(
			finishCwd,
			buildWorkFinishState(finishCwd, "FIN-1"),
		);
		assert(
			state.ok &&
				state.action === "finish-committed" &&
				state.handoffPrompt.includes("BEGIN VERIFIED PRIVATE LEARNING-CAPTURE PLAYBOOK") &&
				state.handoffPrompt.includes("Destination and deduplication") &&
				state.handoffPrompt.includes("wo:learning:<key>=<artifact>") &&
				!state.handoffPrompt.includes("PRIVATE DEBUG PLAYBOOK"),
			`${scenario} completion loads only the private learning-capture playbook`,
		);
	}

	fixture.reset("finishReady", "unknown");
	state = buildWorkFinishState(finishCwd, "FIN-1");
	state = executeWorkFinishState(finishCwd, {
		...state,
		origin: "verifier-fix",
	});
	assert(
		state.ok && state.verifier?.status === "suppressed",
		"coded verifier-fix finish suppresses recursive background scheduling",
	);

	fixture.reset("finishReady", "unknown");
	state = buildWorkFinishState(finishCwd, "1");
	assert(
		state.ok && state.selectedWorkItem.id === "FIN-1",
		"finish accepts numeric shorthand for active epic child workItem",
	);

	fixture.reset("finishMissingReview", "unknown");
	state = buildWorkFinishState(finishCwd, "FIN-1");
	assert(
		state.ok && state.note.includes("coded small-diff check"),
		"finish skips reviewer for small verified diffs",
	);

	fixture.reset("finishMissingReview", "large");
	state = buildWorkFinishState(finishCwd, "FIN-1");
	assert(
		!state.ok && state.reason === "missing-review",
		"finish requires PASS review for large diffs when configured review is off",
	);

	writeFileSync(
		path.join(finishCwd, ".pi", "settings.json"),
		JSON.stringify({
			workOrchestrator: {
				profile: "max",
				reviewPolicy: "review-all",
				simplifyBeforeReview: true,
				browserTestsOnUiDiff: true,
				codeReviewBeforeCommit: "full",
			},
		}),
	);
	fixture.reset("finishReady", "unknown");
	state = buildWorkFinishState(finishCwd, "FIN-1");
	assert(
		state.ok && !state.handoffPrompt,
		"max-profile small backend diff preserves the coded no-op path",
	);

	fixture.reset("finishMissingReview", "large");
	state = buildWorkFinishState(finishCwd, "FIN-1");
	assert(
		state.ok &&
			state.action === "commit-ready" &&
			state.handoffPrompt?.includes(
				"BEGIN VERIFIED PRIVATE SCOPED CODE-REVIEW PLAYBOOK",
			),
		"max-profile Review All finish dispatches the private review playbook instead of stopping for missing review",
	);

	fixture.reset("finishUiMissingReview", "large-ui");
	state = buildWorkResumeState(finishCwd, "E-1");
	assert(
		state.action === "finish-ready" &&
			state.message.includes("coded private finish pipeline"),
		"max-profile resume routes verified non-trivial work to the coded finish pipeline before review",
	);
	state = buildWorkFinishState(finishCwd, "FIN-1");
	const simplifyAt = state.handoffPrompt?.indexOf(
		"BEGIN VERIFIED PRIVATE SCOPED SIMPLIFICATION PLAYBOOK",
	);
	const reviewAt = state.handoffPrompt?.indexOf(
		"BEGIN VERIFIED PRIVATE SCOPED CODE-REVIEW PLAYBOOK",
	);
	const browserAt = state.handoffPrompt?.indexOf(
		"BEGIN VERIFIED PRIVATE AFFECTED-UI BROWSER PLAYBOOK",
	);
	assert(
		state.ok &&
			state.action === "commit-ready" &&
			simplifyAt >= 0 &&
			simplifyAt < reviewAt &&
			reviewAt < browserAt,
		"max-profile non-trivial UI finish routes private simplify, review, and browser resources in coded order",
	);
	assert(
		state.handoffPrompt.includes("wo:simplify NOOP") &&
			state.handoffPrompt.includes("wo:review PASS") &&
			state.handoffPrompt.includes("wo:browser WAIVED") &&
			state.handoffPrompt.includes("at most one targeted re-review") &&
			state.handoffPrompt.includes("smallest runnable affected pages") &&
			!state.handoffPrompt.includes("run the ce-") &&
			!state.handoffPrompt.includes("skill on the affected"),
		"finish pipeline preserves distinct no-op, bounded-review, affected-UI, and waiver contracts without imported prompts",
	);
	const blockedFinish = executeWorkFinishState(finishCwd, state);
	assert(
		!blockedFinish.ok &&
			blockedFinish.reason === "finish-gates-required" &&
			fixture.store().items["FIN-1"].status === "in_progress" &&
			!fixture.logs().some((entry) => entry.op === "commit"),
		"required private gate handoff blocks coded commit and close until durable evidence exists",
	);

	fixture.reset("finishUiWaived", "large-ui");
	state = buildWorkFinishState(finishCwd, "FIN-1");
	assert(
		state.ok && !state.handoffPrompt,
		"durable simplify no-op, review PASS, and explicit browser waiver satisfy the gated finish path",
	);

	fixture.reset("finishMissingVerification", "unknown");
	state = buildWorkFinishState(finishCwd, "FIN-1");
	assert(
		!state.ok && state.reason === "missing-verification",
		"finish requires verification evidence",
	);

	fixture.reset("finishReady", "staged-instruction");
	state = buildWorkFinishState(finishCwd, "FIN-1");
	assert(
		!state.ok && state.reason === "unrelated-dirty-files",
		"finish rejects staged AGENTS dirt",
	);

	fixture.reset("finishReady", "untracked-instruction");
	state = buildWorkFinishState(finishCwd, "FIN-1");
	assert(
		!state.ok && state.reason === "unrelated-dirty-files",
		"finish rejects untracked AGENTS dirt",
	);

	fixture.reset("finishReady", "related-plus-unrelated");
	state = buildWorkFinishState(finishCwd, "FIN-1");
	assert(
		!state.ok && state.reason === "unrelated-dirty-files",
		"finish rejects undeclared mutations even when the declared implementation file is also dirty",
	);

	fixture.reset("finishReady", "clean");
	state = buildWorkFinishState(finishCwd, "FIN-1");
	assert(
		!state.ok && state.reason === "no-related-dirty-files",
		"finish requires related dirty files",
	);
} finally {
	fixture.cleanup();
}

process.stdout.write("ok - coded work start/finish behavior\n");
