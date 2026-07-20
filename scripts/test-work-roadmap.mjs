#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { initStore, loadStore, saveStore } from "../extensions/work-store.js";
import { seedNativeStore } from "./work-command-fixture.mjs";

const {
	default: workModelsExtension,
	bootstrapPlanEpic,
	buildWorkPlanState,
	buildWorkRoadmapState,
	handleWorkRoadmapCommand,
	renderWorkRoadmapText,
} = await import(
	pathToFileURL(
		realpathSync(
			path.join(import.meta.dirname, "../extensions/work-models.js"),
		),
	).href
);

const root = mkdtempSync(path.join(tmpdir(), "work-roadmap-"));
const initiativeRoot = mkdtempSync(
	path.join(tmpdir(), "work-initiative-roadmap-"),
);
execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
mkdirSync(path.join(root, ".pi"));
mkdirSync(path.join(root, "docs", "plans"), { recursive: true });
mkdirSync(path.join(root, "docs", "brainstorms"), { recursive: true });
writeFileSync(
	path.join(root, "docs", "brainstorms", "requirements.md"),
	[
		"# Requirements",
		"- Must keep home visual parity before shared primitives.",
		"- No white cards or generic Material buttons.",
		"- Side-by-side Pixel screenshot required for approval.",
	].join("\n"),
);
writeFileSync(
	path.join(root, "docs", "brainstorms", "sketch.html"),
	"<main>home reference sketch</main>",
);
writeFileSync(
	path.join(root, "docs", "plans", "overhaul.md"),
	[
		"# Overhaul",
		"Source: docs/brainstorms/requirements.md and docs/brainstorms/sketch.html",
		"## Source Trace",
		"- Home visual parity before shared primitives.",
		"- No white cards or generic Material buttons.",
		"- Side-by-side Pixel screenshot required for approval.",
	].join("\n"),
);
writeFileSync(
	path.join(root, "docs", "plans", "weak.md"),
	"# Weak\n\nSource: docs/brainstorms/requirements.md\n\nBuild shared primitives first.\n",
);
writeFileSync(
	path.join(root, ".pi", "work-orchestrator-state.json"),
	JSON.stringify({ lastEpicId: "E-1" }),
);
seedNativeStore(root, [
	{
		id: "E-1",
		issue_type: "epic",
		status: "in_progress",
		title: "Current roadmap",
		notes: "brainstorm-path=docs/brainstorms/accepted.md",
		updated_at: "2026-07-03T10:00:00Z",
	},
	{
		id: "E-2",
		issue_type: "epic",
		status: "open",
		title: "Open roadmap",
		updated_at: "2026-07-02T10:00:00Z",
	},
	{
		id: "E-3",
		issue_type: "epic",
		status: "closed",
		title: "Closed roadmap",
		updated_at: "2026-07-01T10:00:00Z",
	},
	{
		id: "BUG-1",
		parent_id: "E-1",
		issue_type: "bug",
		status: "open",
		title: "Fix blocker",
		labels: ["wo:debug"],
	},
	{
		id: "TASK-1",
		parent_id: "E-1",
		issue_type: "task",
		status: "open",
		title: "Build feature",
	},
	{
		id: "DONE-1",
		parent_id: "E-1",
		issue_type: "task",
		status: "closed",
		title: "Finished task",
	},
	{
		id: "DONE-2",
		parent_id: "E-3",
		issue_type: "task",
		status: "closed",
		title: "Done",
	},
]);
execFileSync("git", ["add", "."], { cwd: root, stdio: "ignore" });
execFileSync(
	"git",
	[
		"-c",
		"user.email=test@example.com",
		"-c",
		"user.name=Test",
		"commit",
		"-m",
		"seed",
	],
	{ cwd: root, stdio: "ignore" },
);
try {
	const list = buildWorkRoadmapState(root, "list");
	console.assert(
		list.ok && list.roadmaps.length === 3,
		"lists all roadmap statuses",
	);
	console.assert(
		list.roadmaps.find((epic) => epic.id === "E-1")?.current,
		"marks current roadmap",
	);
	console.assert(
		renderWorkRoadmapText(list).includes("* E-1"),
		"renders current marker",
	);
	const tasks = buildWorkRoadmapState(root, "tasks current");
	console.assert(
		tasks.tasks.blockers[0].id === "BUG-1",
		"shows blockers first",
	);
	console.assert(
		renderWorkRoadmapText(tasks).includes("Blockers:"),
		"renders task groups",
	);

	const notices = [];
	const opLabels = [];
	const picks = [/E-1/, /list tasks/, /Blocker: BUG-1/, /summary/];
	await handleWorkRoadmapCommand(
		"",
		{
			cwd: root,
			ui: {
				select: async (title, labels) => {
					if (title.includes("BUG-1")) opLabels.push(...labels);
					const pick = picks.shift();
					return pick ? labels.find((label) => pick.test(label)) : undefined;
				},
				notify: (message) => notices.push(message),
			},
		},
		{},
	);
	console.assert(
		notices.some((message) => message.includes("WorkItem: Fix blocker")),
		"interactive task menu opens task summary",
	);
	console.assert(
		opLabels.some((label) => label.includes("debug / full info")),
		"blocker task offers debug for full info",
	);

	const rawPlan = buildWorkPlanState(
		root,
		"use the brainstorm and sketch docs/brainstorms/requirements.md docs/brainstorms/sketch.html",
	);
	console.assert(
		rawPlan.handoffPrompt.includes(
			"Source artifacts to read and cite verbatim",
		),
		"raw work-plan prompt preserves multiple source artifacts",
	);

	execFileSync("git", ["checkout", "--", ".pi/work-orchestrator-state.json"], {
		cwd: root,
		stdio: "ignore",
	});
	const weakPlan = buildWorkPlanState(root, "docs/plans/weak.md");
	console.assert(
		!weakPlan.ok && weakPlan.reason === "source-alignment-stop",
		"weak plans with linked brainstorms stop before epic creation",
	);
	const planReview = buildWorkPlanState(root, "docs/plans/overhaul.md");
	console.assert(
		planReview.ok && planReview.action === "review-plan-before-bootstrap",
		"plan file runs advisors before native roadmap creation",
	);
	const planCreated = bootstrapPlanEpic(root, "docs/plans/overhaul.md");
	if (
		!planCreated.ok ||
		!Object.values(loadStore(root).items).some((item) =>
			item.notes.join("\n").includes("source brainstorm"),
		)
	)
		throw new Error(
			`reviewed plan file creates native roadmap work: ${JSON.stringify(planCreated)}`,
		);

	const handoffs = [];
	await handleWorkRoadmapCommand(
		"plan E-1 fork",
		{
			cwd: root,
			ui: { notify: (message) => notices.push(message) },
			sendUserMessage: async (message) => handoffs.push(message),
		},
		{},
	);
	console.assert(
		handoffs.some((message) =>
			message.includes("Source brainstorm: docs/brainstorms/accepted.md"),
		),
		"roadmap plan subcommand uses epic-linked brainstorm",
	);

	const closeNeedsConfirm = buildWorkRoadmapState(root, "close current");
	console.assert(
		closeNeedsConfirm.action === "roadmap-close-needs-confirmation",
		"does not close unresolved roadmap without confirmation",
	);
	console.assert(
		closeNeedsConfirm.suggestedCommands[1].includes("--force"),
		"offers force close command",
	);
	console.assert(
		loadStore(root).items["E-1"].status === "in_progress",
		"no implicit close was run",
	);

	const forced = buildWorkRoadmapState(root, "close current --force");
	console.assert(
		forced.action === "roadmap-closed",
		"force closes by explicit request",
	);
	console.assert(
		loadStore(root).items["E-1"].status === "closed",
		"close updates the native roadmap",
	);

	const reopened = buildWorkRoadmapState(root, "reopen E-3");
	console.assert(
		reopened.action === "roadmap-reopened",
		"reopens explicit roadmap",
	);
	console.assert(
		loadStore(root).items["E-3"].status === "open",
		"reopen updates the native roadmap",
	);

	// Initiative rows are hierarchical and expose only level-appropriate actions.
	execFileSync("git", ["init"], { cwd: initiativeRoot, stdio: "ignore" });
	mkdirSync(path.join(initiativeRoot, ".pi"), { recursive: true });
	mkdirSync(path.join(initiativeRoot, "docs", "plans"), { recursive: true });
	mkdirSync(path.join(initiativeRoot, "docs", "brainstorms"), {
		recursive: true,
	});
	const childPlan =
		"---\nartifact_contract: ce-unified-plan/v1\nartifact_readiness: implementation-ready\nexecution: code\n---\n# Child\n";
	writeFileSync(
		path.join(initiativeRoot, "docs", "plans", "child.md"),
		childPlan,
	);
	writeFileSync(
		path.join(initiativeRoot, "docs", "brainstorms", "standalone.md"),
		"# Standalone intent\n\n- Ship the remaining outcome.\n",
	);
	writeFileSync(
		path.join(initiativeRoot, ".pi", "work-orchestrator-state.json"),
		JSON.stringify({ lastEpicId: "I-1.1" }),
	);
	const timestamp = "2026-07-19T00:00:00.000Z";
	const item = (id, title, extra = {}) => ({
		id,
		type: "epic",
		status: "open",
		title,
		createdAt: timestamp,
		updatedAt: timestamp,
		dependencies: [],
		labels: [],
		notes: [],
		evidence: [],
		dependencyEdges: [],
		...extra,
	});
	const initiativeStore = initStore(initiativeRoot, { now: timestamp });
	initiativeStore.items = {
		"I-1": item("I-1", "Initiative", {
			labels: ["initiative"],
			initiative: {
				schemaVersion: 1,
				sources: [
					{
						id: "s",
						path: "docs/plans/child.md",
						hash: createHash("sha256").update(childPlan).digest("hex"),
					},
				],
				coverage: [
					{
						id: "o1",
						provenance: "s:R1",
						contentHash: "1",
						disposition: "accepted",
						epicId: "I-1.1",
					},
					{
						id: "o2",
						provenance: "s:R2",
						contentHash: "2",
						disposition: "accepted",
						epicId: "I-1.2",
					},
				],
				evidence: [],
			},
		}),
		"I-1.1": item("I-1.1", "Planned child", {
			parentId: "I-1",
			status: "closed",
			documentLinks: { design: "docs/plans/child.md" },
		}),
		"I-1.2": item("I-1.2", "Needs plan", { parentId: "I-1" }),
		"S-1": item("S-1", "Standalone", {
			documentLinks: { brainstorm: "docs/brainstorms/standalone.md" },
		}),
	};
	saveStore(initiativeRoot, initiativeStore);
	const tree = buildWorkRoadmapState(initiativeRoot, "list");
	assert.deepEqual(
		tree.roadmaps.map((entry) => [entry.id, entry.role]),
		[
			["I-1", "initiative"],
			["I-1.1", "child_epic"],
			["I-1.2", "child_epic"],
			["S-1", "standalone_epic"],
		],
	);
	const treeText = renderWorkRoadmapText(tree);
	assert.match(treeText, / {2}I-1\.1.*planned/i);
	assert.match(treeText, / {2}I-1\.2.*needs.plan/i);
	const initiativeOps = [];
	await handleWorkRoadmapCommand(
		"",
		{
			cwd: initiativeRoot,
			ui: {
				select: async (title, labels) => {
					if (title.includes("operation")) {
						initiativeOps.push(...labels);
						return undefined;
					}
					return labels.find((label) => label.includes("I-1 ["));
				},
				notify: () => {},
			},
		},
		{},
	);
	assert(initiativeOps.some((label) => /preview|reconcile/i.test(label)));
	assert(initiativeOps.some((label) => /plan.*child/i.test(label)));
	assert(!initiativeOps.some((label) => /resume|finish/i.test(label)));
	const proposalPath = path.join(".pi", "initiative-proposal.json");
	writeFileSync(
		path.join(initiativeRoot, proposalPath),
		JSON.stringify({
			schemaVersion: 1,
			mode: "convert",
			targetId: "I-1",
			initiative: { id: "I-1", title: "Initiative" },
			sources: initiativeStore.items["I-1"].initiative.sources,
			groups: [
				{ id: "g1", title: "Planned child", epicId: "I-1.1", selected: true },
				{ id: "g2", title: "Needs plan", epicId: "I-1.2" },
			],
			outcomes: [
				{
					id: "o1",
					provenance: "s:R1",
					contentHash: "1",
					disposition: "accepted",
					groupId: "g1",
				},
				{
					id: "o2",
					provenance: "s:R2",
					contentHash: "2",
					disposition: "accepted",
					groupId: "g2",
				},
			],
		}),
	);
	const runPreview = async (approved) => {
		let previewText = "";
		const state = await handleWorkRoadmapCommand(
			"",
			{
				cwd: initiativeRoot,
				ui: {
					select: async (title, labels) =>
						title.includes("operation")
							? labels.find((label) => /preview|reconcile/i.test(label))
							: labels.find((label) => label.includes("I-1 [")),
					input: async () =>
						approved
							? readFileSync(path.join(initiativeRoot, proposalPath), "utf8")
							: proposalPath,
					confirm: async (_title, body) => {
						previewText = body;
						return approved;
					},
					notify: () => {},
				},
			},
			{},
		);
		return { state, previewText };
	};
	const beforeCancel = readFileSync(
		path.join(initiativeRoot, ".ce-workflow", "work-items.json"),
		"utf8",
	);
	const cancelled = await runPreview(false);
	assert.equal(cancelled.state.action, "initiative-preview-cancelled");
	assert.match(cancelled.previewText, /Proposed child roadmaps:/);
	assert.match(cancelled.previewText, /Outcome coverage:/);
	assert.equal(
		readFileSync(
			path.join(initiativeRoot, ".ce-workflow", "work-items.json"),
			"utf8",
		),
		beforeCancel,
	);
	const reconciled = await runPreview(true);
	assert.equal(reconciled.state.action, "initiative-reconciled");
	assert.equal(
		loadStore(initiativeRoot).items["I-1"].initiative.evidence.length,
		1,
	);
	const captureOps = async (id) => {
		const labelsSeen = [];
		await handleWorkRoadmapCommand(
			"",
			{
				cwd: initiativeRoot,
				ui: {
					select: async (title, labels) => {
						if (title.includes("operation")) {
							labelsSeen.push(...labels);
							return undefined;
						}
						return labels.find((label) => label.includes(id));
					},
					notify: () => {},
				},
			},
			{},
		);
		return labelsSeen.join("\n");
	};
	for (const id of ["I-1.2", "S-1"]) {
		const actions = await captureOps(id);
		for (const expected of ["resume", "list tasks", "plan", "report", "close"])
			assert.match(actions, new RegExp(expected, "i"));
		if (id === "S-1") assert.match(actions, /convert to initiative/i);
		else assert.doesNotMatch(actions, /convert to initiative/i);
	}

	// Resume explains the empty starting state, offers full ce-plan, then attaches its plan to this epic.
	const planningPrompts = [];
	const planningState = await handleWorkRoadmapCommand(
		"",
		{
			cwd: initiativeRoot,
			isIdle: () => false,
			sessionManager: { getSessionId: () => "roadmap-planning-session" },
			sendUserMessage: async (message) => planningPrompts.push(message),
			ui: {
				select: async (title, labels) => {
					if (title.includes("operation"))
						return labels.find((label) => /work-resume/i.test(label));
					if (title.includes("master plan"))
						return labels.find((label) => /create master plan/i.test(label));
					return labels.find((label) => label.includes("I-1.2 ["));
				},
				confirm: async () => true,
				notify: () => {},
				setStatus: () => {},
				setWidget: () => {},
			},
		},
		{},
	);
	assert.equal(planningState.action, "master-plan-resume-started");
	assert.match(planningPrompts[0], /ce-plan/);
	assert.match(planningPrompts[0], /docs\/plans\/child\.md/);
	assert.match(
		planningPrompts[0],
		/bootstrap-plan-roadmap (?:<|&lt;)plan-path(?:>|&gt;) --roadmap I-1\.2/,
	);
	assert.match(planningPrompts[0], /continue.*\/work-resume I-1\.2/i);

	const childMasterPlan = "docs/plans/i-1-2.md";
	writeFileSync(
		path.join(initiativeRoot, childMasterPlan),
		"# I-1.2 master plan\n\n## Acceptance\n\n- Focused verification passes.\n",
	);
	const attachedPlan = bootstrapPlanEpic(
		initiativeRoot,
		childMasterPlan,
		"/work-plan",
		{ safeForHandoff: true, warnings: [], dirtyPaths: [], dirtyFiles: [] },
		{ initialized: false },
		{ targetEpicId: "I-1.2" },
	);
	assert.equal(attachedPlan.epic.id, "I-1.2");
	assert.equal(attachedPlan.action, "run-planner");
	const plannedStore = loadStore(initiativeRoot);
	assert.equal(
		plannedStore.items["I-1.2"].documentLinks.design,
		childMasterPlan,
	);
	assert.equal(
		plannedStore.items[attachedPlan.selectedWorkItem.id].parentId,
		"I-1.2",
	);
	const plannedDescription = plannedStore.items["I-1.2"].description;
	const plannedChildCount = Object.values(plannedStore.items).filter(
		(item) => item.parentId === "I-1.2",
	).length;
	bootstrapPlanEpic(
		initiativeRoot,
		`./${childMasterPlan}`,
		"/work-plan",
		{ safeForHandoff: true, warnings: [], dirtyPaths: [], dirtyFiles: [] },
		{ initialized: false },
		{ targetEpicId: "I-1.2" },
	);
	const repeatedPlanStore = loadStore(initiativeRoot);
	assert.equal(
		repeatedPlanStore.items["I-1.2"].description,
		plannedDescription,
	);
	assert.equal(
		Object.values(repeatedPlanStore.items).filter(
			(item) => item.parentId === "I-1.2",
		).length,
		plannedChildCount,
	);
	execFileSync("git", ["add", "."], { cwd: initiativeRoot, stdio: "ignore" });
	execFileSync(
		"git",
		[
			"-c",
			"user.name=Test",
			"-c",
			"user.email=test@example.com",
			"commit",
			"-m",
			"fixture",
		],
		{ cwd: initiativeRoot, stdio: "ignore" },
	);
	const helperAttach = JSON.parse(
		execFileSync(
			process.execPath,
			[
				path.join(import.meta.dirname, "work-helper.mjs"),
				"bootstrap-plan-roadmap",
				childMasterPlan,
				"--roadmap",
				"I-1.2",
			],
			{ cwd: initiativeRoot, encoding: "utf8" },
		),
	);
	assert.equal(helperAttach.roadmap_id, "I-1.2");
	assert.equal(helperAttach.planning_id, attachedPlan.selectedWorkItem.id);

	const closedConversionStore = loadStore(initiativeRoot);
	closedConversionStore.items["S-1"].status = "closed";
	saveStore(initiativeRoot, closedConversionStore);

	// A selected standalone epic starts an agent-guided scan; the final tool owns preview + apply.
	const tools = {};
	workModelsExtension({
		on: () => {},
		registerCommand: () => {},
		registerShortcut: () => {},
		registerTool: (tool) => {
			tools[tool.name] = tool;
		},
	});
	const conversionPrompts = [];
	const conversionCtx = {
		cwd: initiativeRoot,
		hasUI: true,
		sessionManager: { getSessionId: () => "roadmap-conversion-session" },
		ui: {
			select: async (title, labels) =>
				title.includes("operation")
					? labels.find((label) => /convert to initiative/i.test(label))
					: labels.find((label) => label.includes("S-1 [")),
			confirm: async () => true,
			notify: () => {},
		},
		sendUserMessage: async (message) => conversionPrompts.push(message),
	};
	const started = await handleWorkRoadmapCommand("", conversionCtx, {});
	assert.equal(started.action, "initiative-conversion-started");
	assert.match(conversionPrompts[0], /docs\/brainstorms\/standalone\.md/);
	assert.match(conversionPrompts[0], /ask_user/);
	assert.match(conversionPrompts[0], /work_initiative_reconcile/);
	assert.ok(tools.work_initiative_reconcile);
	const conversionParams = {
		targetId: "S-1",
		sources: [{ id: "brainstorm", path: "docs/brainstorms/standalone.md" }],
		groups: [
			{
				id: "remaining",
				title: "Ship remaining outcome",
				selected: true,
			},
		],
		outcomes: [
			{
				id: "remaining-outcome",
				sourceId: "brainstorm",
				provenance: "brainstorm:remaining outcome",
				content: "Ship the remaining outcome.",
				disposition: "accepted",
				groupId: "remaining",
			},
		],
	};
	const beforeRejectedConversion = readFileSync(
		path.join(initiativeRoot, ".ce-workflow", "work-items.json"),
		"utf8",
	);
	await assert.rejects(
		() =>
			tools.work_initiative_reconcile.execute(
				"tool-call",
				{
					...conversionParams,
					outcomes: [
						{
							...conversionParams.outcomes[0],
							content: "Invented outcome absent from the source.",
						},
					],
				},
				undefined,
				undefined,
				conversionCtx,
			),
		/not exact text from source brainstorm/,
	);
	assert.equal(
		readFileSync(
			path.join(initiativeRoot, ".ce-workflow", "work-items.json"),
			"utf8",
		),
		beforeRejectedConversion,
	);
	const converted = await tools.work_initiative_reconcile.execute(
		"tool-call",
		conversionParams,
		undefined,
		undefined,
		conversionCtx,
	);
	assert.match(converted.content[0].text, /converted S-1/i);
	const convertedStore = loadStore(initiativeRoot);
	assert.ok(convertedStore.items["S-1"].initiative);
	assert.equal(convertedStore.items["S-1"].status, "open");
	assert.equal(convertedStore.items["S-1.1"].parentId, "S-1");

	const blockedInitiativeClose = buildWorkRoadmapState(
		initiativeRoot,
		"close I-1 --force",
	);
	assert.equal(blockedInitiativeClose.action, "initiative-close-blocked");
	assert.equal(loadStore(initiativeRoot).items["I-1"].status, "open");
} finally {
	for (const target of [root, initiativeRoot])
		rmSync(target, { recursive: true, force: true });
}
