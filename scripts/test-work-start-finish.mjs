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
	buildWorkMigrateState,
	buildWorkSmallState,
	directRoleHandoffParams,
} = await import(
	pathToFileURL(
		realpathSync(
			path.join(import.meta.dirname, "../extensions/work-models.js"),
		),
	).href
);

const fixture = installWorkflowFixture({ native: true });
try {
	let state = buildWorkSmallState(fixture.cwd, "Add coded start gate");
	assert(
		state.ok && state.action === "run-implementation",
		"small creates implementation handoff",
	);
	assert(
		state.selectedWorkItem.id.startsWith("E-1.") &&
			state.selectedWorkItem.status === "in_progress",
		"small creates and claims one native task",
	);
	assert(
		state.inlineWork && state.handoffPrompt.includes("WO_INLINE_V1"),
		"small uses concise inline fast path",
	);
	assert(
		directRoleHandoffParams(state, fixture.cwd) === null,
		"small does not launch a subagent",
	);
	assert(
		state.handoffPrompt.includes("Do not call subagent list") &&
			state.handoffPrompt.includes("finish-task") &&
			state.handoffPrompt.includes("--immediate-format") &&
			state.handoffPrompt.length < 2400,
		"small handoff is compact, coded, and discovery-free",
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
		state.handoffPrompt.includes("Evidence-only task:") &&
			state.handoffPrompt.includes("search once") &&
			state.handoffPrompt.includes("runtime script under .pi") &&
			/modify the work-orchestrator package\/helper as a workaround/i.test(
				state.handoffPrompt,
			) &&
			state.handoffPrompt.length < 2400,
		"evidence-only small work gets a bounded probe path without workflow self-modification",
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
	state = buildWorkSmallState(fixture.cwd, "Needs explicit epic");
	assert(
		!state.ok && state.reason === "ambiguous-target",
		"small ambiguous epic stops",
	);
	assert(fixture.logs().length === 0, "small ambiguous creates nothing");

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
	assert(
		state.ok && state.action === "run-implementation" && state.inlineWork,
		"med creates one inline executable handoff",
	);
	assert(
		state.selectedWorkItem.status === "in_progress" &&
			fixture
				.store()
				.items[state.selectedWorkItem.id].notes.join("\n")
				.includes("wo:execution-inline"),
		"med creates and claims an inline-marked task",
	);
	assert(
		directRoleHandoffParams(state, fixture.cwd) === null &&
			state.handoffPrompt.includes("--max-files 8"),
		"med skips planner/worker agents and uses bounded coded finalization",
	);

	fixture.reset("active");
	state = buildWorkSmallState(
		fixture.cwd,
		"Update authentication permission checks",
	);
	const riskyDirect = directRoleHandoffParams(state, fixture.cwd);
	assert(
		!state.inlineWork && riskyDirect?.agent === "work-worker",
		"sensitive small requests escalate to the exact isolated writer",
	);

	fixture.reset("active");
	state = buildWorkAutoState(fixture.cwd, "Add docs note");
	assert(
		state.autoClassification === "small" && state.inlineWork,
		"auto classifies obvious small work in code",
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
			bigDirect?.agent === "work-planner",
		"big handoff carries big posture and directly selects the planner",
	);
	assert(
		bigDirect.params.task.length < 1800 &&
			bigDirect.params.task.includes(
				`Target work item: ${state.selectedWorkItem.id}`,
			) &&
			bigDirect.params.task.includes("work-ready-summary") &&
			!bigDirect.params.task.includes("raw store readiness") &&
			!bigDirect.params.task.includes("Subagent output guidance") &&
			bigDirect.params.acceptance === false,
		"big sends the planner a compact direct contract without generic acceptance boilerplate",
	);

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
		"raw work-plan input routes to ce-plan",
	);
	assert(fixture.logs().length === 0, "work-plan does not initialize bd");
	assert(
		state.nextAction.includes("bootstrap-plan-epic") &&
			!state.nextAction.includes("/work-plan <plan-path>"),
		"raw work-plan bootstraps the epic in-flow instead of asking to re-run /work-plan",
	);
	assert(
		state.handoffPrompt.includes("Preserve every decided requirement") &&
			state.handoffPrompt.includes("Acceptance Contract") &&
			state.handoffPrompt.includes("hardening loop") &&
			state.handoffPrompt.includes("blocking question"),
		"work-plan handoff asks ce-plan to preserve source decisions and audit uncertainties",
	);

	fixture.reset("active");
	state = buildWorkMasterState(fixture.cwd, "raw product idea");
	assert(
		state.ok && state.action === "handoff-plan",
		"raw master input routes to ce-plan",
	);
	assert(
		fixture.logs().length === 0,
		"raw master input does not mutate WorkItems",
	);

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
		state.ok && state.action === "finish-committed",
		"finish commits and closes without a committer agent",
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
		"finish requires PASS review for large diffs",
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
		"finish rejects unrelated dirty files",
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
