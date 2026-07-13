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

const fixture = installWorkflowFixture();
try {
	let state = buildWorkSmallState(process.cwd(), "Add coded start gate");
	assert(
		state.ok && state.action === "run-implementation",
		"small creates implementation handoff",
	);
	assert(
		state.selectedBead.id.startsWith("TASK-NEW-") &&
			state.selectedBead.status === "in_progress",
		"small creates and claims one task Bead in coded intake",
	);
	assert(
		state.inlineWork && state.handoffPrompt.includes("WO_INLINE_V1"),
		"small uses concise inline fast path",
	);
	assert(
		directRoleHandoffParams(state, process.cwd()) === null,
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
		fixture.logs().filter((entry) => entry.op === "create").length === 1,
		"small creates exactly one Bead",
	);

	fixture.reset("active");
	state = buildWorkSmallState(
		process.cwd(),
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
	state = buildWorkSmallState(process.cwd(), longTask);
	const longCreate = fixture.logs().find((entry) => entry.op === "create");
	assert(longCreate.issue.title.length <= 181, "small clamps long Bead title");
	assert(
		longCreate.args.join(" ").includes(longTask.trim()),
		"small keeps full request in Bead notes",
	);

	fixture.reset("active");
	state = buildWorkSmallState(process.cwd(), "IMP-1 extra guidance");
	assert(
		state.ok && state.selectedBead.id === "IMP-1",
		"small explicit Bead reuses target",
	);
	assert(fixture.logs().length === 0, "small explicit Bead creates nothing");

	state = buildWorkSmallState(process.cwd(), "");
	assert(!state.ok && state.reason === "usage", "small empty task stops");

	fixture.reset("ambiguous");
	state = buildWorkSmallState(process.cwd(), "Needs explicit epic");
	assert(
		!state.ok && state.reason === "ambiguous-target",
		"small ambiguous epic stops",
	);
	assert(fixture.logs().length === 0, "small ambiguous creates nothing");

	fixture.reset("active", "unknown");
	state = buildWorkSmallState(process.cwd(), "Dirty should stop");
	assert(
		!state.ok && state.reason === "dirty-stop",
		"small dirty state stops before mutation",
	);
	assert(fixture.logs().length === 0, "small dirty stop creates nothing");

	fixture.reset("active", "work-state");
	state = buildWorkSmallState(process.cwd(), "Continue after coded intake");
	assert(
		state.ok && state.git.workflowDirty && state.git.blockedPaths.length === 0,
		"workflow state written by the extension never blocks the next action",
	);

	fixture.reset("active");
	state = buildWorkMedState(process.cwd(), "Split a bounded feature");
	assert(
		state.ok && state.action === "run-implementation" && state.inlineWork,
		"med creates one inline executable handoff",
	);
	assert(
		state.selectedBead.status === "in_progress" &&
			fixture.logs()[0].issue.notes.includes("wo:execution-inline"),
		"med creates and claims an inline-marked Bead",
	);
	assert(
		directRoleHandoffParams(state, process.cwd()) === null &&
			state.handoffPrompt.includes("--max-files 8"),
		"med skips planner/worker agents and uses bounded coded finalization",
	);

	fixture.reset("active");
	state = buildWorkSmallState(
		process.cwd(),
		"Update authentication permission checks",
	);
	const riskyDirect = directRoleHandoffParams(state, process.cwd());
	assert(
		!state.inlineWork && riskyDirect?.agent === "bead-worker",
		"sensitive small requests escalate to the exact isolated writer",
	);

	fixture.reset("active");
	state = buildWorkAutoState(process.cwd(), "Add docs note");
	assert(
		state.autoClassification === "small" && state.inlineWork,
		"auto classifies obvious small work in code",
	);

	fixture.reset("active");
	state = buildWorkBigState(process.cwd(), "Design a risky feature");
	assert(
		state.ok && state.action === "run-planner",
		"big creates planner handoff",
	);
	const bigDirect = directRoleHandoffParams(state, process.cwd());
	assert(
		state.handoffPrompt.includes("big slice") &&
			bigDirect?.agent === "bead-planner",
		"big handoff carries big posture and directly selects the planner",
	);
	assert(
		bigDirect.params.task.length < 1800 &&
			bigDirect.params.task.includes(`Target: ${state.selectedBead.id}`) &&
			bigDirect.params.task.includes("bd-ready-summary") &&
			!bigDirect.params.task.includes("bd ready --json") &&
			!bigDirect.params.task.includes("Subagent output guidance") &&
			bigDirect.params.acceptance === false,
		"big sends the planner a compact direct contract without generic acceptance boilerplate",
	);

	fixture.reset("no-beads");
	state = buildWorkInitState(process.cwd());
	assert(
		state.ok && state.action === "initialized",
		"work-init initializes Beads",
	);
	assert(fixture.logs()[0].op === "init", "work-init runs bd init");

	fixture.reset("no-beads");
	state = buildWorkPlanState(process.cwd(), "raw product idea");
	assert(
		state.ok && state.action === "handoff-plan",
		"raw work-plan input routes to ce-plan",
	);
	assert(
		fixture.logs().some((entry) => entry.op === "init"),
		"work-plan initializes before ce-plan handoff",
	);
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
	state = buildWorkMasterState(process.cwd(), "raw product idea");
	assert(
		state.ok && state.action === "handoff-plan",
		"raw master input routes to ce-plan",
	);
	assert(fixture.logs().length === 0, "raw master input does not mutate Beads");

	state = buildWorkMasterState(process.cwd(), "missing-plan.md");
	assert(
		!state.ok && state.reason === "missing-source",
		"missing master source stops",
	);

	fixture.reset("active");
	state = buildWorkMasterState(
		process.cwd(),
		"@docs/plans/2026-07-03-004-feat-coded-start-finish-gates-plan.md",
	);
	assert(
		state.ok && state.epic.id.startsWith("E-NEW-"),
		"@ plan path creates epic",
	);
	assert(
		state.selectedBead.id.startsWith("TASK-NEW-"),
		"@ plan path creates one planning Bead",
	);
	assert(
		fixture.logs()[0].issue.design.includes("file:docs/plans/"),
		"@ plan path stores master plan in epic design",
	);
	assert(
		state.nextAction.includes(`/work-resume ${state.epic.id}`),
		"@ plan path reports resume command",
	);

	fixture.reset("active", "pi-session");
	state = buildWorkMasterState(
		process.cwd(),
		"docs/plans/2026-07-03-004-feat-coded-start-finish-gates-plan.md",
	);
	assert(
		state.ok && state.action === "run-planner",
		"plan bootstrap ignores pi-session HTML artifacts",
	);

	fixture.reset("active", "unknown");
	state = buildWorkMasterState(
		process.cwd(),
		"docs/plans/2026-07-03-004-feat-coded-start-finish-gates-plan.md",
	);
	assert(
		!state.ok && state.reason === "dirty-stop",
		"master dirty state stops before Beads mutation",
	);
	assert(
		state.message.includes("extensions/work-models.js"),
		"master dirty stop names blocking files",
	);

	fixture.reset("active");
	state = buildWorkMigrateState(
		process.cwd(),
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
	assert(fixture.logs().length === 0, "migrate does not mutate Beads");
	assert(
		directRoleHandoffParams(state, process.cwd())?.agent === "bead-migrator",
		"migrate directly selects the exact specialist without agent discovery",
	);

	state = buildWorkMigrateState(process.cwd(), "missing-source.md");
	assert(
		!state.ok && state.reason === "missing-source",
		"migrate missing path stops",
	);

	const finishCwd = fixture.dir;
	mkdirSync(path.join(finishCwd, ".pi"), { recursive: true });
	writeFileSync(
		path.join(finishCwd, ".pi", "settings.json"),
		JSON.stringify({
			workOrchestrator: {
				browserTestsOnUiDiff: false,
				codeReviewBeforeCommit: false,
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
			fixture.logs().some((entry) => entry.op === "close") &&
			fixture
				.logs()
				.some((entry) => entry.tool === "git" && entry.op === "amend"),
		"finish stages work, closes Bead, and amends Beads metadata",
	);

	fixture.reset("finishReady", "unknown");
	state = buildWorkFinishState(finishCwd, "1");
	assert(
		state.ok && state.selectedBead.id === "FIN-1",
		"finish accepts numeric shorthand for active epic child bead",
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

console.log("ok - coded work start/finish behavior");
