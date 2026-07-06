#!/usr/bin/env node
import {
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const { assert, installWorkflowFixture } = await import(
	pathToFileURL(
		realpathSync(path.join(import.meta.dirname, "./work-command-fixture.mjs")),
	).href
);
const {
	buildWorkIdeateState,
	captureIdeationIdeas,
	deriveIdeaStatus,
	isIdeaIssue,
	parseIdeationIdeas,
	renderWorkIdeateText,
} = await import(
	pathToFileURL(
		realpathSync(
			path.join(import.meta.dirname, "../extensions/work-models.js"),
		),
	).href
);

const idea = (extra = {}) => ({
	id: "IDEA-1",
	issue_type: "task",
	status: "open",
	title: "Try a smaller workflow",
	labels: ["wo:idea"],
	metadata: { kind: "idea", ideaSchemaVersion: 1, ...extra.metadata },
	notes: extra.notes,
});

assert(isIdeaIssue(idea()), "wo:idea label marks idea records");
assert(
	!isIdeaIssue({ id: "TASK-1", issue_type: "task" }),
	"plain tasks are not ideas",
);
assert(
	isIdeaIssue({
		id: "IDEA-2",
		issue_type: "task",
		notes: "wo:idea status=accepted",
	}),
	"note fallback marks ideas when labels are unavailable",
);

assert(
	deriveIdeaStatus(idea({ metadata: { manualStatus: "accepted" } })) ===
		"accepted",
	"manual accepted status is preserved",
);
assert(
	deriveIdeaStatus(idea({ metadata: { manualStatus: "contender" } })) ===
		"contender",
	"manual contender status is preserved",
);
assert(
	deriveIdeaStatus(idea({ metadata: { manualStatus: "discussed" } })) ===
		"discussed",
	"discussed is a first-class pre-brainstorm status",
);
assert(
	deriveIdeaStatus(idea({ metadata: { manualStatus: "rejected" } })) ===
		"rejected",
	"unworked rejected ideas stay rejected",
);
assert(
	deriveIdeaStatus(
		idea({ metadata: { manualStatus: "accepted", brainstormId: "B-1" } }),
	) === "brainstormed",
	"brainstorm link beats accepted status",
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
	deriveIdeaStatus({
		id: "IDEA-3",
		notes: "wo:idea status=accepted brainstorm-id=B-2",
	}) === "brainstormed",
	"note metadata derives brainstormed status",
);

const parsed = parseIdeationIdeas(
	JSON.stringify({
		topPicks: [1],
		ideas: [{ title: "Top idea" }, { title: "Other idea" }],
	}),
);
assert(parsed.length === 2, "structured ideation output parses ideas");
assert(parsed[0].status === "accepted", "top pick becomes accepted");
assert(parsed[1].status === "contender", "non-top pick becomes contender");
assert(
	parseIdeationIdeas("not json").length === 0,
	"malformed output is empty",
);

const fixture = installWorkflowFixture();
const cwd = mkdtempSync(path.join(tmpdir(), "work-ideate-cwd-"));
try {
	fixture.reset("noIdeas");
	let state = buildWorkIdeateState(cwd, "");
	assert(state.ok && state.action === "dashboard", "empty dashboard builds");
	assert(state.ideas.length === 0, "empty dashboard has no ideas");
	assert(
		renderWorkIdeateText(state).includes("Next: /work-ideate <topic>"),
		"empty dashboard shows next command",
	);

	fixture.reset("ideas");
	state = buildWorkIdeateState(cwd, "");
	const text = renderWorkIdeateText(state);
	for (const status of [
		"raw",
		"accepted",
		"contender",
		"brainstormed",
		"planned",
		"complete",
		"rejected",
	])
		assert(text.includes(`${status}:`), `dashboard groups ${status}`);

	state = buildWorkIdeateState(cwd, "IDEA-2 reject");
	assert(
		state.ok && state.action === "rejected",
		"accepted idea can be rejected",
	);
	assert(
		fixture.logs().at(-1).notes.includes("status=rejected"),
		"reject appends rejected status",
	);

	state = buildWorkIdeateState(cwd, "IDEA-4 reject");
	assert(
		!state.ok && state.reason === "reject-refused",
		"brainstormed reject is refused",
	);

	state = buildWorkIdeateState(cwd, "1 inspect");
	assert(
		state.ok && state.action === "inspect",
		"fresh numeric snapshot resolves",
	);

	fixture.reset("noIdeas");
	state = buildWorkIdeateState(cwd, "1 inspect");
	assert(
		!state.ok && state.reason === "stale-index",
		"stale numeric snapshot is refused",
	);

	fixture.reset("noIdeas");
	let capture = captureIdeationIdeas(
		cwd,
		{ id: "E-1", title: "Active epic" },
		{
			topic: "workflow",
			runId: "RUN-1",
			output: JSON.stringify({
				topPicks: [1],
				ideas: [{ title: "Top idea" }, { title: "Other idea" }],
			}),
		},
	);
	assert(
		capture.ok && capture.saved.length === 2,
		"capture saves parsed ideas",
	);
	assert(
		capture.saved[0].ideaStatus === "accepted",
		"capture saves top pick as accepted",
	);
	assert(
		capture.saved[1].ideaStatus === "contender",
		"capture saves other ideas as contenders",
	);
	capture = captureIdeationIdeas(
		cwd,
		{ id: "E-1", title: "Active epic" },
		{
			topic: "workflow",
			runId: "RUN-1",
			output: JSON.stringify({
				topPicks: [1],
				ideas: [{ title: "Top idea" }, { title: "Other idea" }],
			}),
		},
	);
	assert(
		fixture.logs().filter((entry) => entry.op === "create").length === 2,
		"capture retry reuses saved ideas",
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

	fixture.reset("createFailAfterOne");
	capture = captureIdeationIdeas(
		cwd,
		{ id: "E-1", title: "Active epic" },
		{
			topic: "workflow",
			runId: "RUN-PARTIAL",
			output: JSON.stringify({
				ideas: [{ title: "Saved" }, { title: "Unsaved" }],
			}),
		},
	);
	assert(
		capture.action === "capture-partial",
		"partial Beads failure is reported",
	);
	assert(
		capture.saved.length === 1 && capture.unsaved.length === 1,
		"partial capture names saved and unsaved ideas",
	);

	fixture.reset("noIdeas");
	const planDir = path.join(cwd, "docs", "plans");
	mkdirSync(planDir, { recursive: true });
	writeFileSync(
		path.join(planDir, "idea.md"),
		'---\ntitle: "Imported idea"\n---\n# Imported idea\n',
	);
	state = buildWorkIdeateState(cwd, "docs/plans/idea.md import");
	assert(
		state.ok && state.action === "import-created",
		"valid path imports idea",
	);
	state = buildWorkIdeateState(cwd, "docs/plans/idea.md import");
	assert(
		state.ok && state.action === "import-updated",
		"repeated import reuses idea",
	);
	assert(
		fixture.logs().filter((entry) => entry.op === "create").length === 1,
		"repeated import creates only one bead",
	);
	state = buildWorkIdeateState(cwd, "../outside.md import");
	assert(
		!state.ok && state.reason === "missing-source",
		"outside import is refused",
	);
} finally {
	fixture.cleanup();
	rmSync(cwd, { recursive: true, force: true });
}

console.log("ok - work-ideate behavior");
