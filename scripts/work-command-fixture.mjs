import {
	chmodSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const epics = [
	{
		id: "E-1",
		issue_type: "epic",
		status: "in_progress",
		title: "Active epic",
		created_at: "2026-07-01T00:00:00Z",
		updated_at: "2026-07-03T10:00:00Z",
	},
	{
		id: "E-2",
		issue_type: "epic",
		status: "in_progress",
		title: "Second epic",
		created_at: "2026-07-02T00:00:00Z",
		updated_at: "2026-07-03T11:00:00Z",
	},
];

const scenarioChildren = {
	active: [
		{
			id: "IMP-1",
			parent_id: "E-1",
			issue_type: "task",
			status: "in_progress",
			title: "Current slice",
			notes:
				"Command: npm run verify\nFailure: lint failed\nNext: fix lint and rerun",
		},
	],
	noInProgress: [
		{
			id: "TODO-1",
			parent_id: "E-1",
			issue_type: "task",
			status: "open",
			title: "Ready slice",
		},
	],
	noIdeas: [],
	empty: [],
	"no-beads-empty": [],
	createFailAfterOne: [],
	ideas: [
		{
			id: "IDEA-1",
			parent_id: "E-1",
			issue_type: "task",
			status: "open",
			title: "Raw idea",
			notes: "wo:idea status=raw",
			updated_at: "2026-07-03T01:00:00Z",
		},
		{
			id: "IDEA-2",
			parent_id: "E-1",
			issue_type: "task",
			status: "open",
			title: "Accepted idea",
			notes: "wo:idea status=accepted",
			updated_at: "2026-07-03T02:00:00Z",
		},
		{
			id: "IDEA-3",
			parent_id: "E-1",
			issue_type: "task",
			status: "open",
			title: "Contender idea",
			notes: "wo:idea status=contender",
			updated_at: "2026-07-03T03:00:00Z",
		},
		{
			id: "IDEA-4",
			parent_id: "E-1",
			issue_type: "task",
			status: "open",
			title: "Brainstormed idea",
			notes: "wo:idea status=accepted brainstorm-id=B-1",
			updated_at: "2026-07-03T04:00:00Z",
		},
		{
			id: "IDEA-5",
			parent_id: "E-1",
			issue_type: "task",
			status: "open",
			title: "Planned idea",
			notes: "wo:idea status=accepted plan-id=P-1",
			updated_at: "2026-07-03T05:00:00Z",
		},
		{
			id: "IDEA-6",
			parent_id: "E-1",
			issue_type: "task",
			status: "open",
			title: "Completed idea",
			notes: "wo:idea status=complete",
			updated_at: "2026-07-03T06:00:00Z",
		},
		{
			id: "IDEA-7",
			parent_id: "E-1",
			issue_type: "task",
			status: "open",
			title: "Rejected idea",
			notes: "wo:idea status=rejected",
			updated_at: "2026-07-03T07:00:00Z",
		},
	],
	debug: [
		{
			id: "BUG-1",
			parent_id: "E-1",
			issue_type: "bug",
			status: "open",
			title: "Existing bug",
			labels: ["wo:debug"],
		},
		{
			id: "IMP-1",
			parent_id: "E-1",
			issue_type: "task",
			status: "open",
			title: "Implementation with existing debug dependency",
			depends_on: [{ depends_on_id: "BUG-1", type: "blocks" }],
		},
		{
			id: "IMP-2",
			parent_id: "E-1",
			issue_type: "task",
			status: "open",
			title: "Implementation with debug-needed marker",
			notes: "debug-needed:BUG-1",
		},
	],
	blocked: [
		{
			id: "BLOCK-1",
			parent_id: "E-1",
			issue_type: "task",
			status: "blocked",
			title: "Blocked slice",
		},
	],
	finishReady: [
		{
			id: "FIN-1",
			parent_id: "E-1",
			issue_type: "task",
			status: "in_progress",
			title: "Finishable slice",
			notes:
				"Review: PASS\nVerification: npm run verify passed\nFiles: extensions/work-models.js",
		},
	],
	finishMissingReview: [
		{
			id: "FIN-1",
			parent_id: "E-1",
			issue_type: "task",
			status: "in_progress",
			title: "Unreviewed slice",
			notes:
				"Verification: npm run verify passed\nFiles: extensions/work-models.js",
		},
	],
	finishMissingVerification: [
		{
			id: "FIN-1",
			parent_id: "E-1",
			issue_type: "task",
			status: "in_progress",
			title: "Unverified slice",
			notes: "Review: PASS\nFiles: extensions/work-models.js",
		},
	],
};

export function assert(ok, message) {
	if (!ok) throw new Error(message);
}

export function installWorkflowFixture() {
	const dir = mkdtempSync(path.join(tmpdir(), "work-flow-bin-"));
	const statePath = path.join(dir, "state.json");
	const logPath = path.join(dir, "log.jsonl");
	const bd = path.join(dir, "fake-bd.mjs");
	const git = path.join(dir, "fake-git.mjs");
	const reset = (scenario = "active", dirty = "clean") => {
		const children = JSON.parse(
			JSON.stringify(scenarioChildren[scenario] ?? scenarioChildren.active),
		);
		const scenarioEpics =
			scenario === "empty" || scenario === "no-beads-empty" ? [] : epics;
		writeFileSync(
			statePath,
			JSON.stringify(
				{ scenario, epics: scenarioEpics, children, next: 1 },
				null,
				"\t",
			),
		);
		writeFileSync(logPath, "");
		process.env.WORK_FLOW_SCENARIO = scenario;
		process.env.WORK_FLOW_GIT_DIRTY = dirty;
	};
	writeFileSync(
		bd,
		`#!/usr/bin/env node
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
const statePath = ${JSON.stringify(statePath)};
const logPath = ${JSON.stringify(logPath)};
const args = process.argv.slice(2).filter((arg) => arg !== "--json");
const state = JSON.parse(readFileSync(statePath, "utf8"));
const epics = ["openReadyAmbiguous", "oneOpen"].includes(state.scenario) ? state.epics.map((epic) => ({ ...epic, status: "open" })) : state.epics;
function out(value) { console.log(JSON.stringify(value)); }
function save() { writeFileSync(statePath, JSON.stringify(state, null, "\t")); }
function log(value) { appendFileSync(logPath, JSON.stringify({ args, ...value }) + "\\n"); }
function fieldAfter(name) { const i = args.indexOf(name); return i === -1 ? "" : args[i + 1] || ""; }
function all() { return [...epics, ...state.children]; }
if (state.scenario.startsWith("no-beads") && args[0] === "init") {
  state.scenario = state.scenario === "no-beads-empty" ? "empty" : "active"; save(); log({ op: "init" }); out({ initialized: true });
} else if (state.scenario.startsWith("no-beads")) { console.error("Error: no beads database found; run bd init"); process.exit(1); }
else if (args[0] === "where") out({ path: ".beads" });
else if (args[0] === "list" && args.includes("--type=epic")) {
  if (args.includes("--status=in_progress")) out(["empty", "openReadyAmbiguous", "oneOpen"].includes(state.scenario) ? [] : state.scenario === "ambiguous" ? epics : [epics[0]].filter(Boolean));
  else if (args.includes("--status=open")) out(state.scenario === "openReadyAmbiguous" ? epics : state.scenario === "oneOpen" ? [epics[0]] : epics.filter((epic) => epic.status === "open"));
  else out(epics);
} else if (args[0] === "children") out(state.children.filter((issue) => issue.parent_id === args[1]));
else if (args[0] === "show") {
  const issue = all().find((item) => item.id === args[1]);
  if (issue) out(issue); else { console.error("not found"); process.exit(2); }
} else if (args[0] === "create") {
  if (state.scenario === "create-fail" || (state.scenario === "createFailAfterOne" && state.next > 1)) { console.error("create failed"); process.exit(3); }
  const type = fieldAfter("--type") || "task";
  const parent = fieldAfter("--parent");
  const notes = fieldAfter("--notes") || fieldAfter("--append-notes");
  const description = fieldAfter("--description");
  const designFile = fieldAfter("--design-file");
  const design = fieldAfter("--design") || (designFile ? "file:" + designFile : "");
  const acceptance = fieldAfter("--acceptance");
  const prefix = type === "bug" ? "BUG-NEW-" : type === "epic" ? "E-NEW-" : "TASK-NEW-";
  const id = prefix + state.next++;
  const issue = { id, parent_id: parent, issue_type: type, status: "open", title: args[1], notes, description, design, acceptance };
  if (type === "epic") state.epics.push(issue); else state.children.push(issue);
  save(); log({ op: "create", issue }); out(issue);
} else if (args[0] === "update") {
  const issue = all().find((item) => item.id === args[1]);
  if (!issue) { console.error("not found"); process.exit(2); }
  issue.notes = [issue.notes, fieldAfter("--append-notes")].filter(Boolean).join("\\n");
  save(); log({ op: "update", id: issue.id, notes: fieldAfter("--append-notes") }); out(issue);
} else if (args[0] === "dep" && args[1] === "add") {
  const issue = state.children.find((item) => item.id === args[2]);
  if (!issue) { console.error("not found"); process.exit(2); }
  issue.depends_on = [...(issue.depends_on || []), { depends_on_id: args[3], type: "blocks" }];
  save(); log({ op: "dep-add", later: args[2], earlier: args[3] }); out(issue);
} else out([]);
`,
	);
	writeFileSync(
		git,
		`#!/usr/bin/env node
const args = process.argv.slice(2);
const dirty = process.env.WORK_FLOW_GIT_DIRTY || "clean";
if (args[0] === "diff") process.exit(dirty === "benign" ? 0 : 1);
if (args.includes("--porcelain=v1")) {
  if (dirty === "unknown") console.log(" M extensions/work-models.js");
  if (dirty === "benign" || dirty === "instruction-substantive") console.log(" M AGENTS.md");
  if (dirty === "staged-instruction") console.log("M  AGENTS.md");
  if (dirty === "untracked-instruction") console.log("?? AGENTS.md");
  if (dirty === "pi-session") console.log("?? pi-session-2026-07-05T17-02-37-680Z_abc.html");
} else {
  console.log("## feat/workflow-intake");
  if (dirty === "unknown") console.log(" M extensions/work-models.js");
  if (dirty === "benign" || dirty === "instruction-substantive") console.log(" M AGENTS.md");
  if (dirty === "staged-instruction") console.log("M  AGENTS.md");
  if (dirty === "untracked-instruction") console.log("?? AGENTS.md");
  if (dirty === "pi-session") console.log("?? pi-session-2026-07-05T17-02-37-680Z_abc.html");
}
`,
	);
	for (const file of [bd, git]) chmodSync(file, 0o755);
	const oldEnv = {
		bd: process.env.WORK_ORCH_BD_BIN,
		git: process.env.WORK_ORCH_GIT_BIN,
		scenario: process.env.WORK_FLOW_SCENARIO,
		dirty: process.env.WORK_FLOW_GIT_DIRTY,
	};
	process.env.WORK_ORCH_BD_BIN = bd;
	process.env.WORK_ORCH_GIT_BIN = git;
	reset();
	return {
		dir,
		statePath,
		logPath,
		reset,
		logs() {
			return readFileSync(logPath, "utf8")
				.trim()
				.split(/\r?\n/)
				.filter(Boolean)
				.map(JSON.parse);
		},
		cleanup() {
			if (oldEnv.bd === undefined) delete process.env.WORK_ORCH_BD_BIN;
			else process.env.WORK_ORCH_BD_BIN = oldEnv.bd;
			if (oldEnv.git === undefined) delete process.env.WORK_ORCH_GIT_BIN;
			else process.env.WORK_ORCH_GIT_BIN = oldEnv.git;
			if (oldEnv.scenario === undefined) delete process.env.WORK_FLOW_SCENARIO;
			else process.env.WORK_FLOW_SCENARIO = oldEnv.scenario;
			if (oldEnv.dirty === undefined) delete process.env.WORK_FLOW_GIT_DIRTY;
			else process.env.WORK_FLOW_GIT_DIRTY = oldEnv.dirty;
			rmSync(dir, { recursive: true, force: true });
		},
	};
}
