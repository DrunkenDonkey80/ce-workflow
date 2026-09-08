#!/usr/bin/env node
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const { assert, installWorkflowFixture, seedNativeStore } = await import(
	pathToFileURL(
		realpathSync(path.join(import.meta.dirname, "./work-command-fixture.mjs")),
	).href
);
const {
	buildWorkIdeateState,
	captureIdeationIdeas,
	deriveIdeaStatus,
	handleWorkIdeateCommand,
	ideaDashboardList,
	ideateDialogItems,
	isIdeaIssue,
	parseIdeationIdeas,
	parseWorkIdeateArgs,
	renderWorkIdeateText,
	scoreChipColor,
	startIdeaBrainstorm,
} = await import(
	pathToFileURL(
		realpathSync(path.join(import.meta.dirname, "../extensions/work-models.ts")),
	).href
);
const { dispatchPrivateWorkflow } = await import(
	pathToFileURL(
		realpathSync(
			path.join(import.meta.dirname, "../extensions/work-private-workflows.js"),
		),
	).href
);
const workModelsUrl = pathToFileURL(
	realpathSync(path.join(import.meta.dirname, "../extensions/work-models.ts")),
).href;

// --- U1a: authority dispatch -------------------------------------------------
const playbook = dispatchPrivateWorkflow("ideate", {
	actionToken: "work-models:wf:ideate:v1",
	callerUrl: workModelsUrl,
});
assert(
	playbook.trim().length > 200,
	"ideate authority dispatches the private playbook",
);
let authorityRejected = false;
try {
	dispatchPrivateWorkflow("ideate", {
		actionToken: "work-models:wf:plan:v1",
		callerUrl: workModelsUrl,
	});
} catch {
	authorityRejected = true;
}
assert(authorityRejected, "plan token cannot dispatch the ideate playbook");

// --- unit fixtures ------------------------------------------------------------
const idea = (extra = {}) => ({
	id: "IDEA-1",
	issue_type: "task",
	status: "open",
	title: "Try a smaller workflow",
	labels: ["wo:idea"],
	metadata: { kind: "idea", ideaSchemaVersion: 1, ...extra.metadata },
	notes: extra.notes,
});

assert(isIdeaIssue(idea()), "schema-1 ideas stay identified after the v2 bump");
assert(
	isIdeaIssue(idea({ metadata: { kind: "idea", ideaSchemaVersion: 2 } })),
	"schema-2 ideas are identified",
);
assert(
	!isIdeaIssue({ id: "TASK-1", issue_type: "task" }),
	"plain tasks are not ideas",
);
assert(
	isIdeaIssue({
		id: "IDEA-2",
		issue_type: "task",
		notes: "wo:idea schema=2 status=contender",
	}),
	"note fallback marks ideas when labels are unavailable",
);

assert(
	deriveIdeaStatus(idea({ metadata: { manualStatus: "accepted" } })) ===
		"accepted",
	"manual accepted status is preserved",
);
assert(
	deriveIdeaStatus(
		idea({ metadata: { manualStatus: "accepted", brainstormId: "B-1" } }),
	) === "brainstormed",
	"legacy brainstorm-id note still derives brainstormed",
);
assert(
	deriveIdeaStatus(
		idea({
			metadata: { manualStatus: "accepted", brainstormEpicId: "E-9" },
		}),
	) === "brainstormed",
	"brainstorm-epic-id derives brainstormed",
);
assert(
	deriveIdeaStatus(
		idea({
			metadata: { manualStatus: "accepted", ideaFile: "docs/ideas/IDEA-1.md" },
		}),
	) === "brainstormed",
	"idea-file attachment derives brainstormed",
);
assert(
	deriveIdeaStatus(
		idea({ metadata: { manualStatus: "accepted", taskId: "IMP-1" } }),
	) === "planned",
	"task link makes idea planned before work starts",
);
assert(
	deriveIdeaStatus(
		idea({ metadata: { manualStatus: "complete", childChangeId: "CH-1" } }),
	) === "reopened",
	"child change reopens completed ideas",
);
assert(
	deriveIdeaStatus(
		idea({ metadata: { manualStatus: "rejected", planId: "PLAN-1" } }),
	) === "conflicted",
	"rejected ideas with downstream work are conflicted",
);
assert(
	deriveIdeaStatus(
		idea({
			metadata: {
				manualStatus: "rejected",
				ideaFile: "docs/ideas/IDEA-1.md",
			},
		}),
	) === "conflicted",
	"rejected ideas with a brainstorm attachment are conflicted",
);
assert(
	deriveIdeaStatus({
		id: "IDEA-3",
		notes: "wo:idea status=accepted brainstorm-epic-id=B-2",
	}) === "brainstormed",
	"note metadata derives brainstormed via the epic attachment key",
);

// --- U1: scored capture parsing -----------------------------------------------
const scored = parseIdeationIdeas(
	JSON.stringify({
		ideas: [
			{ title: "A", score: 92 },
			{ title: "B", score: 105 },
			{ title: "C", score: -3 },
			{ title: "D" },
			{ title: "E", area: "UX & Design!" },
		],
	}),
);
assert(scored.length === 5, "structured ideation output parses ideas");
assert(
	scored.map((item) => item.score).join(",") === "92,100,0,33,10",
	"scores parse, clamp to 0-100, and derive from rank when missing",
);
assert(
	scored.every((item) => item.status === "contender"),
	"captured ideas are contenders without topPicks",
);
assert(scored[4].area === "ux-design", "areas are sanitized to slugs");
assert(
	parseIdeationIdeas(
		JSON.stringify({ topPicks: [1], ideas: [{ title: "T" }] }),
	)[0].status === "contender",
	"topPicks no longer mark ideas accepted",
);
assert(
	parseIdeationIdeas("not json").length === 0,
	"malformed output is empty",
);

// --- U1a: leading-token grammar ----------------------------------------------
assert(
	parseWorkIdeateArgs("").kind === "dashboard",
	"bare call opens dashboard",
);
assert(
	JSON.stringify(parseWorkIdeateArgs("wide hero page")) ===
		JSON.stringify({ kind: "topic", topic: "hero page", agents: "wide" }),
	"wide keyword parses",
);
assert(
	parseWorkIdeateArgs("narrow deep work").agents === "narrow",
	"narrow keyword parses",
);
assert(
	JSON.stringify(parseWorkIdeateArgs("edit IDEA-3 new description text")) ===
		JSON.stringify({
			kind: "action",
			action: "edit",
			target: "IDEA-3",
			text: "new description text",
		}),
	"edit grammar pins target to the second token",
);
assert(
	JSON.stringify(parseWorkIdeateArgs("delete 2")) ===
		JSON.stringify({ kind: "action", action: "delete", target: "2", text: "" }),
	"delete grammar parses",
);
assert(
	parseWorkIdeateArgs("reject hero page banner").action === "reject" &&
		parseWorkIdeateArgs("reject hero page banner").target === "hero page banner",
	"action targets may span multiple tokens",
);
assert(
	parseWorkIdeateArgs("import docs/plans/idea.md").action === "import",
	"import parses as a leading action",
);
assert(
	parseWorkIdeateArgs("some plain topic").kind === "topic",
	"plain topics parse without action",
);

// --- U3: score chips ----------------------------------------------------------
assert(scoreChipColor(71) === "success", "scores above 70 are green");
assert(scoreChipColor(70) === "warning", "score 70 is yellow");
assert(scoreChipColor(30) === "warning", "score 30 is yellow");
assert(scoreChipColor(29) === "error", "scores below 30 are red");

const fixture = installWorkflowFixture({ native: true });
const cwd = fixture.cwd;
try {
	// --- U3: dashboard grouping, toggles, snapshot ----------------------------
	fixture.reset("noIdeas");
	let state = buildWorkIdeateState(cwd, "");
	assert(
		state.ok && state.action === "dashboard" && state.ideas.length === 0,
		"empty dashboard builds",
	);
	assert(
		renderWorkIdeateText(state).includes("Next: /work-ideate <topic>"),
		"empty dashboard shows next command",
	);

	fixture.reset("ideas");
	state = buildWorkIdeateState(cwd, "");
	assert(
		state.groups.main === 3 &&
			state.groups.downstream === 2 &&
			state.groups.brainstormed === 1 &&
			state.groups.rejected === 1,
		"dashboard groups ideas by status",
	);
	const lists = ideaDashboardList(cwd, state.epic.id);
	assert(
		JSON.stringify(lists.main.map((item) => item.id)) ===
			JSON.stringify(["IDEA-1", "IDEA-2", "IDEA-3"]),
		"main list sorts by score then id",
	);
	assert(
		lists.main.every((item) => item.score === 50),
		"unscored ideas default to 50",
	);
	assert(
		lists.brainstormed[0].id === "IDEA-4",
		"brainstormed ideas group separately",
	);
	assert(lists.rejected[0].id === "IDEA-7", "rejected ideas group separately");

	let items = ideateDialogItems(lists, {});
	assert(
		!items.some((item) => item.label === "Rejected idea"),
		"rejected rows stay hidden without the toggle",
	);
	assert(
		items.some(
			(item) =>
				item.value === "toggle:rejected" &&
				item.label.includes("Show rejected (1)"),
		),
		"trailing toggle reveals rejected ideas",
	);
	assert(
		items.some((item) => item.heading && item.label === "Top ideas"),
		"main rows sit under a heading",
	);
	items = ideateDialogItems(lists, {
		showRejected: true,
		showBrainstormed: true,
	});
	assert(
		items.some((item) => item.label === "Rejected idea" && item.color === "dim"),
		"revealed rejected rows render dim",
	);
	assert(
		items.some(
			(item) => item.label === "Brainstormed idea" && item.color === "dim",
		),
		"revealed brainstormed rows render dim",
	);
	const chip = (item) => item.labelSegments?.[0]?.color;
	assert(
		chip(items.find((item) => item.label === "Raw idea")) === "warning",
		"score chip colors the row label",
	);
	const orderedIds = state.ideas.map((item) => item.id).join(",");
	const rebuilt = buildWorkIdeateState(cwd, "");
	assert(
		rebuilt.ideas.map((item) => item.id).join(",") === orderedIds,
		"snapshot ordering stays stable across rebuilds",
	);

	const text = renderWorkIdeateText(state);
	for (const status of [
		"raw",
		"accepted",
		"contender",
		"brainstormed",
		"rejected",
	])
		assert(text.includes(`${status}:`), `dashboard groups ${status}`);

	// --- actions --------------------------------------------------------------
	fixture.reset("ideas");
	state = buildWorkIdeateState(cwd, "reject IDEA-2");
	assert(
		state.ok && state.action === "rejected",
		"accepted idea can be rejected",
	);
	fixture.reset("ideas");
	state = buildWorkIdeateState(cwd, "reject IDEA-4");
	assert(
		!state.ok && state.reason === "reject-refused",
		"brainstormed reject is refused",
	);
	fixture.reset("ideas");
	buildWorkIdeateState(cwd, "");
	state = buildWorkIdeateState(cwd, "inspect 1");
	assert(
		state.ok && state.action === "inspect",
		"fresh numeric snapshot resolves",
	);
	fixture.reset("noIdeas");
	state = buildWorkIdeateState(cwd, "inspect 1");
	assert(
		!state.ok && state.reason === "stale-index",
		"stale numeric snapshot is refused",
	);

	fixture.reset("ideas");
	state = buildWorkIdeateState(cwd, "edit IDEA-1 Brand new description");
	assert(state.ok && state.action === "edited", "edit updates the description");
	assert(
		fixture.store().items["IDEA-1"].description === "Brand new description",
		"edited description persists",
	);
	state = buildWorkIdeateState(cwd, "edit IDEA-1");
	assert(
		!state.ok && state.reason === "missing-text",
		"edit without text is refused",
	);

	fixture.reset("ideas");
	state = buildWorkIdeateState(cwd, "delete IDEA-2");
	assert(state.ok && state.action === "deleted", "delete removes an idea");
	assert(!fixture.store().items["IDEA-2"], "deleted idea leaves the store");

	seedNativeStore(cwd, [
		{ id: "E-1", issue_type: "epic", status: "open", title: "Active epic" },
		{
			id: "IDEA-1",
			parent_id: "E-1",
			issue_type: "task",
			status: "open",
			title: "Guarded idea",
			notes: "wo:idea status=raw",
			updated_at: "2026-07-03T01:00:00Z",
		},
		{
			id: "TASK-9",
			parent_id: "IDEA-1",
			issue_type: "task",
			status: "open",
			title: "Blocking child",
		},
	]);
	state = buildWorkIdeateState(cwd, "delete IDEA-1");
	assert(
		!state.ok && state.action === "delete-refused",
		"delete refuses referenced ideas",
	);

	// --- U2: narrow/wide front door -------------------------------------------
	fixture.reset("ideas");
	state = buildWorkIdeateState(cwd, "wide hero page");
	assert(
		state.ok && state.agents === "wide" && state.agentCount === 3,
		"wide keyword sets agent telemetry",
	);
	assert(
		state.handoffPrompt.includes("BEGIN VERIFIED PRIVATE IDEATE PLAYBOOK"),
		"handoff inlines the dispatched playbook",
	);
	assert(
		state.handoffPrompt.includes("Ideation sidecar gate"),
		"wide handoff launches the divergent sidecar",
	);
	assert(
		state.handoffPrompt.includes("merge semantically similar ideas"),
		"wide handoff instructs the semantic merge",
	);
	state = buildWorkIdeateState(cwd, "narrow hero page");
	assert(
		state.ok && state.agents === "narrow" && state.agentCount === 1,
		"narrow keyword sets agent telemetry",
	);
	assert(
		!state.handoffPrompt.includes("Ideation sidecar gate"),
		"narrow handoff skips the sidecar",
	);
	state = buildWorkIdeateState(cwd, "hero page", { agents: "wide" });
	assert(state.agents === "wide", "options.agents overrides the default depth");
	state = buildWorkIdeateState(cwd, "wide");
	assert(
		!state.ok && state.reason === "missing-topic",
		"depth keyword without a topic is refused",
	);

	// --- U1: scored capture with fingerprint identity -------------------------
	fixture.reset("noIdeas");
	let capture = captureIdeationIdeas(
		cwd,
		{ id: "E-1", title: "Active epic" },
		{
			topic: "workflow",
			runId: "RUN-1",
			output: JSON.stringify({
				ideas: [
					{ title: "Top idea", score: 90, area: "ux" },
					{ title: "Other idea", score: 40 },
				],
			}),
		},
	);
	assert(capture.ok && capture.saved.length === 2, "capture saves parsed ideas");
	const savedId = capture.saved[0].id;
	const savedNotes = fixture.store().items[savedId].notes.join("\n");
	assert(
		savedNotes.includes("status=contender") &&
			savedNotes.includes("score=90") &&
			savedNotes.includes("area=ux") &&
			savedNotes.includes("title-fingerprint="),
		"capture notes carry score, area, and fingerprint",
	);
	capture = captureIdeationIdeas(
		cwd,
		{ id: "E-1", title: "Active epic" },
		{
			topic: "workflow",
			runId: "RUN-1",
			output: JSON.stringify({
				ideas: [
					{ title: "Top idea", score: 90, area: "ux" },
					{ title: "Other idea", score: 40 },
				],
			}),
		},
	);
	assert(
		capture.saved.length === 2 && capture.duplicates === 0,
		"same-run capture retry is idempotent",
	);
	capture = captureIdeationIdeas(
		cwd,
		{ id: "E-1", title: "Active epic" },
		{
			topic: "workflow",
			runId: "RUN-2",
			output: JSON.stringify({
				ideas: [
					{ title: "Top idea", score: 90 },
					{ title: "Other idea", score: 40 },
				],
			}),
		},
	);
	assert(
		capture.duplicates === 2 && capture.saved.length === 0,
		"cross-run exact duplicates merge instead of duplicating",
	);
	buildWorkIdeateState(cwd, `reject ${savedId}`);
	capture = captureIdeationIdeas(
		cwd,
		{ id: "E-1", title: "Active epic" },
		{
			topic: "workflow",
			runId: "RUN-3",
			output: JSON.stringify({
				ideas: [
					{ title: "Top idea", score: 90 },
					{ title: "Other idea", score: 40 },
				],
			}),
		},
	);
	assert(
		capture.suppressed === 1,
		"rejected fingerprints are suppressed on later runs",
	);

	fixture.reset("noIdeas");
	const longTitle = "Implement a hero page with a giant gradient banner "
		.repeat(5)
		.trim();
	capture = captureIdeationIdeas(
		cwd,
		{ id: "E-1", title: "Active epic" },
		{
			topic: "workflow",
			runId: "RUN-L1",
			output: JSON.stringify({ ideas: [{ title: longTitle, score: 80 }] }),
		},
	);
	const storedLong = Object.values(fixture.store().items).find((item) =>
		(item.notes ?? []).some((note) => note.startsWith("wo:idea")),
	);
	assert(
		storedLong.title.length < longTitle.length,
		"long idea titles compact on save",
	);
	capture = captureIdeationIdeas(
		cwd,
		{ id: "E-1", title: "Active epic" },
		{
			topic: "workflow",
			runId: "RUN-L2",
			output: JSON.stringify({ ideas: [{ title: longTitle, score: 80 }] }),
		},
	);
	assert(
		capture.duplicates === 1,
		"fingerprint dedup survives display truncation",
	);

	// --- U1: global top-20 trim ------------------------------------------------
	fixture.reset("noIdeas");
	const many = Array.from({ length: 25 }, (_, index) => ({
		title: `Idea ${String(index + 1).padStart(2, "0")}`,
		score: index + 1,
	}));
	capture = captureIdeationIdeas(
		cwd,
		{ id: "E-1", title: "Active epic" },
		{
			topic: "workflow",
			runId: "RUN-25",
			output: JSON.stringify({ ideas: many }),
		},
	);
	assert(
		capture.saved.length === 25 && capture.dropped.length === 5,
		"capture keeps only the global top 20",
	);
	let remaining = Object.values(fixture.store().items).filter(
		(item) => item.parentId === "E-1",
	);
	assert(remaining.length === 20, "dropped ideas leave the store");
	const noteScore = (item) =>
		Number((item.notes.join(" ").match(/score=(\d+)/) ?? [])[1]);
	assert(
		remaining.every((item) => noteScore(item) >= 6),
		"the lowest-scored ideas are the dropped ones",
	);
	capture = captureIdeationIdeas(
		cwd,
		{ id: "E-1", title: "Active epic" },
		{
			topic: "workflow",
			runId: "RUN-26",
			output: JSON.stringify({
				ideas: Array.from({ length: 5 }, (_, index) => ({
					title: `New idea ${index}`,
					score: 95 + index,
				})),
			}),
		},
	);
	remaining = Object.values(fixture.store().items).filter(
		(item) => item.parentId === "E-1",
	);
	assert(
		capture.dropped.length === 5 && remaining.length === 20,
		"later runs re-trim globally against existing ideas",
	);
	assert(
		remaining.every((item) => noteScore(item) >= 11),
		"global trim evicts the previous lowest scores",
	);

	fixture.reset("noIdeas");
	capture = captureIdeationIdeas(
		cwd,
		{ id: "E-1", title: "Active epic" },
		{
			topic: "workflow",
			runId: "RUN-BAD",
			output: "not json",
		},
	);
	assert(
		!capture.ok && capture.action === "capture-recovery",
		"malformed output creates recovery state",
	);

	// --- import (leading grammar) ----------------------------------------------
	fixture.reset("noIdeas");
	const planDir = path.join(cwd, "docs", "plans");
	mkdirSync(planDir, { recursive: true });
	writeFileSync(
		path.join(planDir, "idea.md"),
		'---\ntitle: "Imported idea"\n---\n# Imported idea\n',
	);
	state = buildWorkIdeateState(cwd, "import docs/plans/idea.md");
	assert(
		state.ok && state.action === "import-created",
		"valid path imports idea",
	);
	state = buildWorkIdeateState(cwd, "import docs/plans/idea.md");
	assert(
		state.ok && state.action === "import-updated",
		"repeated import reuses idea",
	);
	state = buildWorkIdeateState(cwd, "import ../outside.md");
	assert(
		!state.ok && state.reason === "missing-source",
		"outside import is refused",
	);

	// --- U4: brainstorm attachment ---------------------------------------------
	fixture.reset("ideas");
	const dash = buildWorkIdeateState(cwd, "");
	const target = ideaDashboardList(cwd, dash.epic.id).main.find(
		(item) => item.id === "IDEA-3",
	);
	const started = startIdeaBrainstorm(cwd, dash.epic, target, "extra guidance");
	assert(
		started.ok && started.action === "idea-brainstorm-started",
		"brainstorm action starts",
	);
	assert(
		existsSync(path.join(cwd, "docs", "ideas", "IDEA-3.md")),
		"idea file is written",
	);
	const bsEpic = Object.values(fixture.store().items).find(
		(item) =>
			item.type === "epic" && item.documentLinks?.idea === "docs/ideas/IDEA-3.md",
	);
	assert(bsEpic, "brainstorm epic links the idea file via documentLinks");
	assert(
		started.handoffPrompt.includes("BEGIN VERIFIED PRIVATE BRAINSTORM PLAYBOOK"),
		"brainstorm handoff dispatches the playbook",
	);
	const postLists = ideaDashboardList(cwd, dash.epic.id);
	assert(
		postLists.brainstormed.some((item) => item.id === "IDEA-3") &&
			!postLists.main.some((item) => item.id === "IDEA-3"),
		"brainstormed idea hides behind its toggle",
	);
	capture = captureIdeationIdeas(
		cwd,
		{ id: "E-1", title: "Active epic" },
		{
			topic: "workflow",
			runId: "RUN-BS",
			output: JSON.stringify({ ideas: [{ title: "Contender idea", score: 50 }] }),
		},
	);
	assert(
		capture.duplicates === 1,
		"brainstormed ideas dedup instead of re-capturing",
	);

	// --- U3/U4: interactive handler with scripted native dialogs ---------------
	const runHandler = (queue, editors = [""], text = "") => {
		const notifications = [];
		const followUps = [];
		const selectCalls = [];
		const ctx = {
			cwd,
			mode: "cli",
			ui: {
				workDialogsNative: true,
				select: async (title, labels) => {
					selectCalls.push(title);
					const needle = queue.shift();
					return needle === undefined
						? undefined
						: labels.find(
								(label) => typeof label === "string" && label.includes(needle),
							);
				},
				notify: (message) => notifications.push(String(message)),
				editor: async (_title, body) => editors.shift() ?? body,
			},
			sendUserMessage: async (message) => followUps.push(message),
		};
		return handleWorkIdeateCommand(ctx, null, text).then((result) => ({
			result,
			notifications,
			followUps,
			selectCalls,
		}));
	};

	fixture.reset("ideas");
	let handled = await runHandler(["Wide"], [], "improve onboarding");
	assert(
		handled.followUps.length === 1 &&
			handled.followUps[0].includes("Ideation sidecar gate"),
		"depth dialog selects wide and launches the sidecar handoff",
	);
	assert(
		handled.followUps[0].includes("BEGIN VERIFIED PRIVATE IDEATE PLAYBOOK"),
		"dialog-launched handoff carries the playbook",
	);

	fixture.reset("ideas");
	handled = await runHandler([], [], "improve onboarding");
	assert(
		handled.notifications.some((message) => message.includes("cancelled")),
		"cancelling the depth dialog cancels ideation",
	);

	fixture.reset("ideas");
	handled = await runHandler(["Show rejected", undefined], [""], "");
	assert(
		handled.selectCalls.length >= 2,
		"dashboard toggle re-renders the list",
	);

	fixture.reset("ideas");
	handled = await runHandler(["Accepted idea", "Delete", "Delete"], [""], "");
	assert(
		!fixture.store().items["IDEA-2"],
		"details delete flow removes the idea end-to-end",
	);

	fixture.reset("ideas");
	handled = await runHandler(
		["Contender idea", "Brainstorm", "Go"],
		["", "ignored"],
		"",
	);
	assert(
		existsSync(path.join(cwd, "docs", "ideas", "IDEA-3.md")),
		"dialog brainstorm flow writes the idea file",
	);
	assert(
		Object.values(fixture.store().items).some(
			(item) =>
				item.type === "epic" && item.documentLinks?.idea === "docs/ideas/IDEA-3.md",
		),
		"dialog brainstorm flow creates the linked epic",
	);
	assert(
		handled.followUps.some((message) =>
			message.includes("BEGIN VERIFIED PRIVATE BRAINSTORM PLAYBOOK"),
		),
		"dialog brainstorm flow hands off to the playbook",
	);

	// --- headless default: narrow, no dialog -----------------------------------
	const headlessFollowUps = [];
	const headlessResult = await handleWorkIdeateCommand(
		{
			cwd,
			mode: "cli",
			ui: { notify: () => {}, workDialogsNative: true },
			sendUserMessage: async (message) => headlessFollowUps.push(message),
		},
		null,
		"improve onboarding",
	);
	assert(
		headlessResult && typeof headlessResult === "object",
		"headless handler returns telemetry",
	);
	assert(
		headlessFollowUps.length === 1 &&
			headlessFollowUps[0].includes("Depth: narrow") &&
			!headlessFollowUps[0].includes("Ideation sidecar gate"),
		"headless invocation defaults to narrow without a dialog",
	);
} finally {
	fixture.cleanup();
}

console.log("ok - work-ideate behavior");
