#!/usr/bin/env node
import { createHash } from "node:crypto";
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
	writeFileSync(
		path.join(planDir, "standalone-plan.md"),
		"# Standalone plan\n\n## Summary\nBuild the reporting dashboard.\n",
	);

	fixture.reset("no-legacy-empty");
	let state = buildWorkBrainstormState(
		cwd,
		"Explore a standalone reporting dashboard with filters and CSV export docs/plans/standalone-plan.md",
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
	const brainstormEpicId = state.epic.id;
	const brainstormIdeaId = state.idea.id;
	state = bootstrapPlanEpic(cwd, "docs/plans/standalone-plan.md");
	const standaloneStore = fixture.store();
	assert(
		state.epic.id === brainstormEpicId &&
			standaloneStore.items[state.selectedWorkItem.id].parentId ===
				brainstormEpicId &&
			standaloneStore.items[brainstormIdeaId].status === "closed",
		"standalone brainstorm and master plan share one epic lifecycle",
	);
	assert(
		standaloneStore.items[brainstormEpicId].description.includes(
			"## Brainstorm",
		) &&
			standaloneStore.items[brainstormEpicId].description.includes(
				"## Master plan",
			),
		"upgraded epic keeps brainstorm and master-plan components",
	);

	// Multi-scope plans preview and confirm an initiative with one selected child.
	fixture.reset("no-legacy-empty");
	const broadSource = "# Broad brainstorm\n\nR1 reader and R2 exporter\n";
	writeFileSync(path.join(brainstormDir, "broad.md"), broadSource);
	writeFileSync(
		path.join(planDir, "broad-plan.md"),
		"# Broad plan\n\n## Summary\nSource: docs/brainstorms/broad.md\n",
	);
	const broad = buildWorkBrainstormState(
		cwd,
		"Broad reader and exporter docs/brainstorms/broad.md",
	);
	const broadProposal = {
		schemaVersion: 1,
		mode: "convert",
		targetId: broad.epic.id,
		initiative: { id: broad.epic.id, title: "Reader initiative" },
		sources: [
			{
				id: "brainstorm-broad",
				path: "docs/brainstorms/broad.md",
				hash: createHash("sha256").update(broadSource).digest("hex"),
			},
		],
		groups: [
			{ id: "reader", title: "Reader", selected: true },
			{ id: "exporter", title: "Exporter" },
		],
		outcomes: [
			{
				id: "reader-outcome",
				provenance: "brainstorm-broad:R1",
				contentHash: "reader-hash",
				disposition: "accepted",
				groupId: "reader",
			},
			{
				id: "exporter-outcome",
				provenance: "brainstorm-broad:R2",
				contentHash: "exporter-hash",
				disposition: "accepted",
				groupId: "exporter",
			},
		],
	};
	const broadPreview = bootstrapPlanEpic(
		cwd,
		"docs/plans/broad-plan.md",
		"/work-plan",
		undefined,
		undefined,
		{ proposal: broadProposal },
	);
	assert(
		broadPreview.action === "initiative-preview-required" &&
			broadPreview.preview.proposed.epics.length === 2 &&
			!fixture.store().items[broad.epic.id].initiative,
		"multi-scope bootstrap previews the complete hierarchy without mutation",
	);
	const broadApplied = bootstrapPlanEpic(
		cwd,
		"docs/plans/broad-plan.md",
		"/work-plan",
		undefined,
		undefined,
		{
			proposal: broadProposal,
			token: broadPreview.preview.token,
			approved: true,
		},
	);
	const broadStore = fixture.store();
	const broadChildren = Object.values(broadStore.items).filter(
		(item) => item.parentId === broad.epic.id && item.type === "epic",
	);
	assert(
		broadApplied.action === "run-planner" &&
			broadStore.items[broad.epic.id].initiative &&
			broadChildren.length === 2,
		"confirmed multi-scope bootstrap preserves the brainstorm epic as initiative",
	);
	assert(
		broadStore.items[broadApplied.selectedWorkItem.id].parentId ===
			broadApplied.epic.id &&
			broadApplied.epic.parentId === broad.epic.id,
		"only the selected child receives a planning task",
	);
	const successor = broadChildren.find((child) => child.id !== broadApplied.epic.id);
	assert(
		!Object.values(broadStore.items).some(
			(item) => item.parentId === successor.id && item.id !== broad.idea.id,
		),
		"successor child remains a needs-plan stub without implementation children",
	);
	assert(
		broadStore.items[broad.idea.id].status === "closed" &&
			broadStore.items[broad.idea.id].parentId === broadApplied.epic.id,
		"brainstorm idea backlink is retained under the selected child",
	);
	const broadItemCount = Object.keys(broadStore.items).length;
	const repeatPreview = bootstrapPlanEpic(
		cwd,
		"docs/plans/broad-plan.md",
		"/work-plan",
		undefined,
		undefined,
		{ proposal: broadProposal },
	);
	const repeated = bootstrapPlanEpic(
		cwd,
		"docs/plans/broad-plan.md",
		"/work-plan",
		undefined,
		undefined,
		{
			proposal: broadProposal,
			token: repeatPreview.preview.token,
			approved: true,
		},
	);
	assert(
		repeated.selectedWorkItem.id === broadApplied.selectedWorkItem.id &&
			Object.keys(fixture.store().items).length === broadItemCount,
		"rerunning initiative bootstrap reuses lineage and planning work",
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
		'---\ntitle: "Accepted idea plan"\n---\n# Accepted idea plan\n\n## Summary\nSource: docs/brainstorms/accepted.md\n\nPlan it.\n',
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
	const plannedStore = fixture.store();
	assert(
		state.epic.id === "E-1" &&
			Object.values(plannedStore.items).filter((item) => item.type === "epic")
				.length === 1,
		"idea-linked plan upgrades the brainstorm epic instead of creating an empty sibling",
	);
	assert(
		plannedStore.items[state.selectedWorkItem.id].parentId === "E-1" &&
			plannedStore.items["E-1"].documentLinks.design ===
				"docs/plans/idea-plan.md",
		"master plan and planning work stay under the brainstorm epic",
	);
	assert(
		plannedStore.items["IDEA-2"].status === "closed" &&
			plannedStore.items["IDEA-2"].notes.some((note) =>
				note.includes("plan-path=docs/plans/idea-plan.md"),
			),
		"planning closes the consumed brainstorm idea and keeps its backlink",
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
