#!/usr/bin/env node
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const { assert, installWorkflowFixture } = await import(
	pathToFileURL(
		realpathSync(path.join(import.meta.dirname, "./work-command-fixture.mjs")),
	).href
);
const {
	brainstormHandoffPrompt,
	buildWorkBrainstormState,
	buildWorkPlanState,
	bootstrapPlanEpic,
	deriveIdeaStatus,
	renderWorkBrainstormText,
} = await import(
	pathToFileURL(
		realpathSync(
			path.join(import.meta.dirname, "../extensions/work-models.js"),
		),
	).href
);

const fixture = installWorkflowFixture({ native: true });
const cwd = fixture.cwd;
try {
	const brainstormDir = path.join(cwd, "docs", "brainstorms");
	const planDir = path.join(cwd, "docs", "plans");
	mkdirSync(brainstormDir, { recursive: true });
	mkdirSync(planDir, { recursive: true });
	writeFileSync(
		path.join(brainstormDir, "accepted.md"),
		"# Accepted brainstorm\n",
	);
	writeFileSync(path.join(brainstormDir, "new.md"), "# New workflow idea\n");
	writeFileSync(
		path.join(brainstormDir, "near.md"),
		"# Raw idea with animation\n",
	);

	fixture.reset("no-legacy-empty");
	let state = buildWorkBrainstormState(
		cwd,
		"Explore a standalone reporting dashboard with filters and CSV export",
	);
	assert(
		state.ok && state.action === "brainstorm-epic-created",
		"standalone brainstorm initializes native state and creates an epic",
	);
	assert(
		state.epic.type === "epic" && state.idea.type === "task",
		"standalone brainstorm creates an epic and native idea",
	);
	assert(
		fixture
			.store()
			.items[state.epic.id].notes.join("\n")
			.includes("wo:brainstorm") && fixture.logs().length === 0,
		"standalone brainstorm is marked natively without bd",
	);

	fixture.reset("ideas");
	const longPrompt = `Modernize the LPGSlim Android interface to match the Linea Pro demo look and feel with smooth transitions, graphics, animations, connected-device startup states, and updated screens while preserving the full detailed request for brainstorming. ${"Use the attached Pixel device and inspect the installed demo UI source before proposing screen-by-screen changes. ".repeat(8)}`;
	state = buildWorkBrainstormState(cwd, longPrompt);
	const longPromptIdea = fixture.store().items[state.idea.id];
	assert(
		state.ok && longPromptIdea.title.length <= 180,
		"freeform brainstorm stores a compact WorkItems title",
	);
	assert(
		longPromptIdea.title !== longPrompt &&
			longPromptIdea.description.includes(state.topic),
		"freeform brainstorm keeps the full request outside the title",
	);

	state = buildWorkBrainstormState(cwd, longPrompt);
	assert(
		state.ok && state.action === "brainstorm-reused",
		"repeating a long brainstorm reuses the compact title match",
	);

	state = buildWorkBrainstormState(
		cwd,
		"idea IDEA-2 docs/brainstorms/accepted.md",
	);
	assert(
		state.ok && state.action === "brainstorm-linked",
		"selected idea links brainstorm artifact",
	);
	assert(
		state.idea.ideaStatus === "brainstormed",
		"selected idea derives brainstormed status",
	);
	assert(
		fixture
			.store()
			.items["IDEA-2"].notes.some((note) =>
				note.includes("brainstorm-path=docs/brainstorms/accepted.md"),
			),
		"selected idea note includes brainstorm path",
	);
	assert(
		brainstormHandoffPrompt(state).includes("Run /work-plan E-1 now") &&
			brainstormHandoffPrompt(state).includes(
				"do not use ce-brainstorm's post-doc planning menu",
			),
		"linked brainstorm handoff routes planning through work-plan",
	);
	const planFromEpic = buildWorkPlanState(cwd, "E-1 fork");
	assert(
		planFromEpic.ok &&
			planFromEpic.handoffPrompt.includes(
				"Source brainstorm: docs/brainstorms/accepted.md",
			),
		"work-plan can create a new roadmap from an epic-linked brainstorm",
	);

	state = buildWorkBrainstormState(
		cwd,
		"New workflow idea docs/brainstorms/new.md",
	);
	assert(
		state.ok && state.action === "brainstorm-created",
		"freeform creates new idea when no exact match exists",
	);
	assert(
		state.idea.ideaStatus === "brainstormed",
		"new freeform idea is brainstormed when artifact exists",
	);

	state = buildWorkBrainstormState(
		cwd,
		"Accepted idea docs/brainstorms/accepted.md",
	);
	assert(
		state.ok && state.action === "brainstorm-reused",
		"exact normalized title reuses existing idea",
	);
	assert(
		fixture.store().items["IDEA-2"].notes.length > 1,
		"exact match updates existing native idea",
	);

	state = buildWorkBrainstormState(
		cwd,
		"Raw idea with animation docs/brainstorms/near.md",
	);
	assert(
		state.ok && state.action === "brainstorm-created",
		"near match creates a new idea instead of fuzzy merging",
	);
	assert(
		state.possibleDuplicates.length === 1,
		"near match reports possible duplicate",
	);
	assert(
		renderWorkBrainstormText(state).includes("Possible duplicates"),
		"renderer shows possible duplicates",
	);

	writeFileSync(
		path.join(planDir, "idea-plan.md"),
		'---\ntitle: "Accepted idea plan"\nidea-id: IDEA-2\n---\n# Accepted idea plan\n\n## Summary\nPlan it.\n',
	);
	state = buildWorkPlanState(cwd, "docs/plans/idea-plan.md");
	assert(
		state.ok &&
			state.action === "review-plan-before-bootstrap" &&
			state.handoffPrompt.includes("work-advisor"),
		"idea-linked plan runs configured advisors before bootstrap",
	);
	state = bootstrapPlanEpic(cwd, "docs/plans/idea-plan.md");
	assert(
		state.ok && state.action === "run-planner",
		"reviewed idea-linked plan bootstraps epic",
	);
	assert(
		fixture
			.store()
			.items["IDEA-2"].notes.some((note) =>
				note.includes("plan-path=docs/plans/idea-plan.md"),
			),
		"planning appends native idea backlink",
	);

	assert(
		deriveIdeaStatus({
			id: "I",
			notes: "wo:idea status=complete child-change-id=TASK-1",
		}) === "reopened",
		"child change reopens completed idea",
	);
} finally {
	fixture.cleanup();
}

console.log("ok - work-brainstorm behavior");
