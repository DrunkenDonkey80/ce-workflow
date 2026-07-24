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
	linkBrainstormArtifactFromFinal,
	menuBrainstormArgs,
	parseWorkPromptMeta,
	buildWorkBrainstormState,
	buildWorkPlanState,
	bootstrapPlanEpic,
	approveInitiativeReconciliation,
	deriveIdeaStatus,
	executeOrchestratorAction,
	renderWorkBrainstormText,
} = await import(
	pathToFileURL(
		realpathSync(
			path.join(import.meta.dirname, "../extensions/work-models.js"),
		),
	).href
);
const { mutateStore } = await import(
	pathToFileURL(
		realpathSync(path.join(import.meta.dirname, "../extensions/work-store.js")),
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
	const broadApproval = approveInitiativeReconciliation(
		cwd,
		broadPreview.preview.token,
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
			approval: broadApproval,
		},
	);
	const broadStore = fixture.store();
	const broadChildren = Object.values(broadStore.items).filter(
		(item) => item.parentId === broad.epic.id && item.type === "epic",
	);
	assert(
		broadApplied.action === "initiative-preparation" &&
			broadStore.items[broad.epic.id].initiative &&
			broadChildren.length === 2,
		"confirmed multi-scope bootstrap preserves the brainstorm epic as initiative",
	);
	assert(
		broadApplied.selectedChild.id === broadApplied.epic.id &&
			broadApplied.epic.parentId === broad.epic.id &&
			!Object.values(broadStore.items).some(
				(item) =>
					item.parentId === broadApplied.epic.id &&
					item.notes?.includes("wo:planning"),
			),
		"selected child receives its broad plan without slice-planning work",
	);
	const successor = broadChildren.find(
		(child) => child.id !== broadApplied.epic.id,
	);
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
	const repeatApproval = approveInitiativeReconciliation(
		cwd,
		repeatPreview.preview.token,
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
			approval: repeatApproval,
		},
	);
	assert(
		repeated.selectedChild.id === broadApplied.selectedChild.id &&
			Object.keys(fixture.store().items).length === broadItemCount &&
			JSON.stringify(repeated.preparation) ===
				JSON.stringify(broadApplied.preparation),
		"rerunning initiative bootstrap reuses lineage and preparation state",
	);

	mutateStore(cwd, (store) => {
		store.items[broad.epic.id].status = "open";
		for (const child of broadChildren) store.items[child.id].status = "closed";
	});
	const afterInitiative = buildWorkBrainstormState(
		cwd,
		"Explore a separate standalone brainstorm",
	);
	assert(
		afterInitiative.ok &&
			afterInitiative.action === "brainstorm-epic-created" &&
			!afterInitiative.epic.parentId &&
			afterInitiative.epic.id !== broad.epic.id,
		"a stale open initiative does not capture a new standalone brainstorm",
	);

	fixture.reset("ideas");
	assert(
		menuBrainstormArgs("Idea IDEA-2") === "Idea IDEA-2" &&
			menuBrainstormArgs("idea for offline mode") ===
				"new idea for offline mode",
		"menu routing distinguishes an idea ID from a natural-language topic",
	);
	const standalone = buildWorkBrainstormState(
		cwd,
		"new Reverse the RF roles for NDEF card emulation",
	);
	assert(
		standalone.action === "brainstorm-epic-created" &&
			!standalone.epic.parentId &&
			standalone.epic.id !== "E-1",
		"a new menu brainstorm creates its own visible roadmap",
	);
	const handoffMeta = parseWorkPromptMeta(
		brainstormHandoffPrompt(standalone, cwd),
	);
	assert(
		handoffMeta.epicId === standalone.epic.id &&
			handoffMeta.workItemId === standalone.idea.id,
		"brainstorm handoff keeps roadmap and idea identity for automatic linking",
	);
	const wideHandoff = brainstormHandoffPrompt(standalone, cwd, "wide");
	assert(
		wideHandoff.includes("Creative sidecar gate") &&
			(wideHandoff.match(/work-divergent/g) ?? []).length === 3 &&
			wideHandoff.indexOf("Creative sidecar gate") <
				wideHandoff.indexOf("Advisor critic gate") &&
			!brainstormHandoffPrompt(standalone, cwd).includes(
				"Creative sidecar gate",
			),
		"wide brainstorm merges three isolated branches before configured critics",
	);
	const followUps = [];
	const interactive = await executeOrchestratorAction(
		"work-brainstorm",
		"Try an offline-first reader",
		{
			cwd,
			mode: "tui",
			ui: {
				notify() {},
				select: async (title, labels) =>
					title === "Creative sidecar"
						? labels.find((label) => label.includes("Wide"))
						: undefined,
			},
			sendUserMessage: async (message) => followUps.push(message),
		},
		{},
	);
	assert(
		interactive.creativeDepth === "wide" &&
			followUps[0]?.includes("Creative sidecar gate"),
		"Ask mode offers Wide and feeds the creative gate into the live brainstorm handoff",
	);
	const linked = linkBrainstormArtifactFromFinal(
		cwd,
		{ meta: handoffMeta },
		`Brainstorm saved: ${path.join(brainstormDir, "new.md")}`,
	);
	assert(
		linked?.action === "brainstorm-linked" &&
			fixture
				.store()
				.items[standalone.idea.id].notes.some((note) =>
					note.includes("brainstorm-path=docs/brainstorms/new.md"),
				),
		"a completed brainstorm artifact is linked back to native work state",
	);

	fixture.reset("ideas");
	writeFileSync(
		path.join(cwd, ".pi", "settings.json"),
		JSON.stringify({ workOrchestrator: { creativeMode: "auto" } }),
	);
	const planningFollowUps = [];
	const broadTask = await executeOrchestratorAction(
		"work-big",
		"--roadmap E-1 Design a resilient offline synchronization system",
		{
			cwd,
			mode: "rpc",
			ui: { notify() {} },
			sendUserMessage: async (message) => planningFollowUps.push(message),
		},
		{},
	);
	assert(
		broadTask.creativeDepth === "wide" &&
			broadTask.controlSessionHandoff === true &&
			planningFollowUps[0]?.includes("Creative sidecar gate") &&
			planningFollowUps[0]?.includes("work-divergent") &&
			planningFollowUps[0]?.includes("Advisor critic gate"),
		"Auto mode runs the wide sidecar in the control session before work-big planning",
	);
	writeFileSync(path.join(cwd, ".pi", "settings.json"), "{}\n");

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
		"Idea IDEA-2 docs/brainstorms/accepted.md",
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
				"Source artifact: docs/brainstorms/accepted.md",
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
