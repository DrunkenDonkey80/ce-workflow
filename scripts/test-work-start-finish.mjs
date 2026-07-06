#!/usr/bin/env node
import { realpathSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
const { assert, installWorkflowFixture } = await import(
	pathToFileURL(
		realpathSync(path.join(import.meta.dirname, "work-command-fixture.mjs")),
	).href
);

const {
	buildWorkBigState,
	buildWorkFinishState,
	buildWorkInitState,
	buildWorkMasterState,
	buildWorkMedState,
	buildWorkPlanState,
	buildWorkMigrateState,
	buildWorkSmallState,
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
		state.selectedBead.id.startsWith("TASK-NEW-"),
		"small creates one task Bead",
	);
	assert(
		state.handoffPrompt.includes("at least 10 minutes"),
		"small handoff carries timeout guidance",
	);
	assert(
		fixture.logs().filter((entry) => entry.op === "create").length === 1,
		"small creates exactly one Bead",
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

	fixture.reset("active");
	state = buildWorkMedState(process.cwd(), "Split a bounded feature");
	assert(
		state.ok && state.action === "run-planner",
		"med creates planner handoff",
	);
	assert(
		fixture.logs()[0].issue.notes.includes("wo:planning"),
		"med Bead is planning-marked",
	);
	assert(
		fixture.logs()[0].args.includes("--notes"),
		"new Beads use create --notes so planning markers persist",
	);
	assert(
		state.handoffPrompt.includes("bd ready --json"),
		"med handoff names dependency-direction check",
	);

	fixture.reset("active");
	state = buildWorkBigState(process.cwd(), "Design a risky feature");
	assert(
		state.ok && state.action === "run-planner",
		"big creates planner handoff",
	);
	assert(
		state.handoffPrompt.includes("big slice"),
		"big handoff carries big posture",
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
		state.nextAction.includes("/work-plan <plan-path>"),
		"raw work-plan reports next command",
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

	state = buildWorkMigrateState(process.cwd(), "missing-source.md");
	assert(
		!state.ok && state.reason === "missing-source",
		"migrate missing path stops",
	);

	fixture.reset("finishReady", "unknown");
	state = buildWorkFinishState(process.cwd(), "FIN-1");
	assert(
		state.ok && state.action === "commit-ready",
		"finish accepts reviewed verified related dirty work",
	);
	assert(
		state.commitMessage === "FIN-1: Finishable slice",
		"finish produces deterministic commit seed",
	);

	fixture.reset("finishMissingReview", "unknown");
	state = buildWorkFinishState(process.cwd(), "FIN-1");
	assert(
		!state.ok && state.reason === "missing-review",
		"finish requires PASS review",
	);

	fixture.reset("finishMissingVerification", "unknown");
	state = buildWorkFinishState(process.cwd(), "FIN-1");
	assert(
		!state.ok && state.reason === "missing-verification",
		"finish requires verification evidence",
	);

	fixture.reset("finishReady", "staged-instruction");
	state = buildWorkFinishState(process.cwd(), "FIN-1");
	assert(
		!state.ok && state.reason === "unrelated-dirty-files",
		"finish rejects unrelated dirty files",
	);

	fixture.reset("finishReady", "clean");
	state = buildWorkFinishState(process.cwd(), "FIN-1");
	assert(
		!state.ok && state.reason === "no-related-dirty-files",
		"finish requires related dirty files",
	);
} finally {
	fixture.cleanup();
}

console.log("ok - coded work start/finish behavior");
