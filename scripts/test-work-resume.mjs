#!/usr/bin/env node
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import process from "node:process";

const {
	buildWorkResumeState,
	directRoleHandoffParams,
	handleWorkResumeCommand,
	renderWorkResumeText,
} = await import(
	pathToFileURL(
		realpathSync(
			path.join(import.meta.dirname, "../extensions/work-models.js"),
		),
	).href
);

const epics = [
	{
		id: "E-1",
		issue_type: "epic",
		status: "in_progress",
		title: "Active epic",
		design:
			"Master plan reference: file:docs/plans/2026-07-05-001-feat-rflib-card-emulation-plan.md",
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
	{
		id: "O-1",
		issue_type: "epic",
		status: "open",
		title: "Open ready epic",
		created_at: "2026-07-01T00:00:00Z",
		updated_at: "2026-07-03T09:00:00Z",
	},
	{
		id: "O-2",
		issue_type: "epic",
		status: "open",
		title: "Open blocked epic",
		created_at: "2026-07-01T00:00:00Z",
		updated_at: "2026-07-03T08:00:00Z",
	},
	{
		id: "E-C",
		issue_type: "epic",
		status: "closed",
		title: "Closed epic",
		created_at: "2026-07-01T00:00:00Z",
		updated_at: "2026-07-03T07:00:00Z",
	},
];

const childrenByScenario = {
	default: [
		{
			id: "BUG-1",
			parent_id: "E-1",
			issue_type: "bug",
			status: "open",
			title: "Fix failing verification",
			labels: ["wo:debug"],
			created_at: "2026-07-03T01:00:00Z",
			dependencies: [
				{ id: "E-1", title: "Active epic" },
				{ depends_on_id: "IMP-OLD", type: "discovered-from" },
			],
			notes: "Run: abc123\nNext: inspect fixture",
		},
		{
			id: "IMP-1",
			parent_id: "E-1",
			issue_type: "task",
			status: "open",
			title: "Implement feature slice",
			created_at: "2026-07-03T02:00:00Z",
			notes:
				"Large unrelated notes should not be copied into the handoff prompt.",
		},
	],
	implementation: [
		{
			id: "IMP-1",
			parent_id: "E-1",
			issue_type: "task",
			status: "open",
			title: "Implement feature slice",
			created_at: "2026-07-03T02:00:00Z",
			acceptance: "npm run verify passes",
		},
	],
	implementationAgent: [
		{
			id: "IMP-BIG",
			parent_id: "E-1",
			issue_type: "task",
			status: "open",
			title: "Implement agent-bound slice",
			created_at: "2026-07-03T02:00:00Z",
			notes: "wo:execution-agent",
		},
	],
	ideasOnly: [
		{
			id: "IDEA-1",
			parent_id: "E-1",
			issue_type: "task",
			status: "open",
			title: "Accepted idea only",
			labels: ["wo:idea"],
			metadata: {
				kind: "idea",
				ideaSchemaVersion: 1,
				manualStatus: "accepted",
			},
			created_at: "2026-07-03T01:00:00Z",
		},
		{
			id: "IDEA-2",
			parent_id: "E-1",
			issue_type: "task",
			status: "open",
			title: "Brainstormed idea only",
			notes: "wo:idea status=accepted brainstorm-id=docs/brainstorms/idea.md",
			created_at: "2026-07-03T02:00:00Z",
		},
		{
			id: "IDEA-3",
			parent_id: "E-1",
			issue_type: "task",
			status: "open",
			title: "Rejected idea only",
			labels: ["wo:idea"],
			metadata: {
				kind: "idea",
				ideaSchemaVersion: 1,
				manualStatus: "rejected",
			},
			created_at: "2026-07-03T03:00:00Z",
		},
	],
	plannedIdea: [
		{
			id: "IDEA-PLANNED",
			parent_id: "E-1",
			issue_type: "task",
			status: "open",
			title: "Planned idea marker",
			labels: ["wo:idea"],
			metadata: {
				kind: "idea",
				ideaSchemaVersion: 1,
				manualStatus: "accepted",
				taskId: "IMP-1",
			},
			created_at: "2026-07-03T01:00:00Z",
		},
		{
			id: "IMP-1",
			parent_id: "E-1",
			issue_type: "task",
			status: "open",
			title: "Executable idea child",
			labels: ["wo:slice-planned"],
			created_at: "2026-07-03T02:00:00Z",
		},
	],
	planning: [
		{
			id: "PLAN-1",
			parent_id: "E-1",
			issue_type: "task",
			status: "open",
			title: "Plan next slice for Active epic",
			created_at: "2026-07-03T01:00:00Z",
		},
	],
	stalePlanning: [
		{
			id: "PLAN-1",
			parent_id: "E-1",
			issue_type: "task",
			status: "open",
			title: "Old planning bead",
			labels: ["wo:planning"],
			created_at: "2026-07-03T01:00:00Z",
		},
		{
			id: "DONE-1",
			parent_id: "E-1",
			issue_type: "task",
			status: "closed",
			title: "Created executable child",
		},
	],
	stalePlanningReady: [
		{
			id: "PLAN-1",
			parent_id: "E-1",
			issue_type: "task",
			status: "open",
			title: "Old planning bead",
			labels: ["wo:planning"],
			created_at: "2026-07-03T01:00:00Z",
		},
		{
			id: "IMP-1",
			parent_id: "E-1",
			issue_type: "task",
			status: "open",
			title: "Created executable child",
			labels: ["wo:slice-planned"],
		},
	],
	inProgressVerifiedAgent: [
		{
			id: "IMP-BIG",
			parent_id: "E-1",
			issue_type: "task",
			status: "in_progress",
			title: "Verified isolated implementation",
			notes:
				"wo:execution-agent\nFiles changed: extensions/work-models.js.\nVerification: npm run verify — passed.",
		},
	],
	inProgressSensitiveContract: [
		{
			id: "AUTH-1",
			parent_id: "E-1",
			issue_type: "task",
			status: "in_progress",
			title: "Update authentication permission checks",
			acceptance: "Verification contract: run npm run verify before review",
			notes:
				"wo:execution-agent\nVerification command required: npm run verify",
		},
	],
	inProgressReviewFail: [
		{
			id: "AUTH-1",
			parent_id: "E-1",
			issue_type: "task",
			status: "in_progress",
			title: "Update authentication permission checks",
			notes:
				"wo:execution-agent\nwo:verify-check PASS\nwo:review FAIL - permission bypass remains",
		},
	],
	inProgressFixReady: [
		{
			id: "AUTH-1",
			parent_id: "E-1",
			issue_type: "task",
			status: "in_progress",
			title: "Update authentication permission checks",
			notes:
				"wo:execution-agent\nwo:verify-check PASS\nwo:review FAIL - permission bypass remains\nwo:fix PASS - bypass removed and tests passed",
		},
	],
	inProgressReviewPass: [
		{
			id: "AUTH-1",
			parent_id: "E-1",
			issue_type: "task",
			status: "in_progress",
			title: "Update authentication permission checks",
			notes:
				"wo:execution-agent\nwo:verify-check PASS\nwo:review PASS - no blockers",
		},
	],
	inProgressReviewCap: [
		{
			id: "AUTH-1",
			parent_id: "E-1",
			issue_type: "task",
			status: "in_progress",
			title: "Update authentication permission checks",
			notes:
				"wo:execution-agent\nwo:verify-check PASS\nwo:review FAIL - one\nwo:fix PASS\nwo:review FAIL - two\nwo:fix PASS\nwo:review FAIL - three",
		},
	],
	blocked: [
		{
			id: "BLOCK-1",
			parent_id: "E-1",
			issue_type: "task",
			status: "open",
			title: "Blocked compiler verification",
			labels: ["wo:blocked"],
			depends_on: [{ depends_on_id: "DEC-1", type: "blocks" }],
			notes:
				"Command: rtk cmake -S rf-lib -B build\nNo compiler found\nNext: install compiler",
		},
		{
			id: "DEC-1",
			parent_id: "E-1",
			issue_type: "decision",
			status: "open",
			title: "Provide C compiler",
		},
	],
	externalBlocked: [
		{
			id: "HW-1",
			parent_id: "E-1",
			issue_type: "task",
			status: "blocked",
			title: "Repair COM7 device",
			labels: ["wo:blocked"],
			notes:
				"Next command after repair: reconnect COM7 and run pytest -m hardware",
		},
		{
			id: "BUG-2",
			parent_id: "E-1",
			issue_type: "bug",
			status: "blocked",
			title: "Finish live gate",
			labels: ["wo:debug"],
			depends_on: [{ depends_on_id: "HW-1", type: "blocks" }],
		},
	],
	plannerGap: [],
	openReady: [
		{
			id: "OPEN-READY",
			parent_id: "O-1",
			issue_type: "task",
			status: "open",
			title: "Ready open epic work",
			labels: ["wo:slice-planned"],
		},
	],
	openBlocked: [
		{
			id: "OPEN-BLOCKED",
			parent_id: "O-2",
			issue_type: "task",
			status: "open",
			title: "Blocked open epic work",
			labels: ["wo:blocked"],
		},
	],
	openDecision: [
		{
			id: "DEC-ONLY",
			parent_id: "E-1",
			issue_type: "decision",
			status: "open",
			title: "Choose resume policy",
		},
	],
	closed: [
		{
			id: "DONE-C",
			parent_id: "E-C",
			issue_type: "task",
			status: "closed",
			title: "Done",
		},
	],
};

function assert(ok, message) {
	if (!ok) throw new Error(message);
}

function installFakeCommands() {
	const dir = mkdtempSync(path.join(tmpdir(), "work-resume-bin-"));
	const bd = path.join(dir, "fake-bd.mjs");
	const git = path.join(dir, "fake-git.mjs");
	writeFileSync(
		bd,
		`#!/usr/bin/env node
const epics = ${JSON.stringify(epics)};
const childrenByScenario = ${JSON.stringify(childrenByScenario)};
const scenario = process.env.WORK_RESUME_SCENARIO || "default";
const args = process.argv.slice(2).filter((arg) => arg !== "--json");
function out(value) { console.log(JSON.stringify(value)); }
function childrenFor(id) {
  if (scenario === "open-ready") return id === "O-1" ? childrenByScenario.openReady : (id === "O-2" ? childrenByScenario.openBlocked : []);
  if (scenario === "open-two-ready") return id === "O-1" ? childrenByScenario.openReady : (id === "O-2" ? [{...childrenByScenario.openReady[0], id:"OPEN-READY-2", parent_id:"O-2"}] : []);
  if (scenario === "remembered-blocked") return id === "E-1" ? childrenByScenario.blocked : (id === "O-1" ? childrenByScenario.openReady : (id === "O-2" ? childrenByScenario.openBlocked : []));
  const rows = childrenByScenario[scenario] || childrenByScenario.default;
  return rows.filter((issue) => issue.parent_id === id);
}
if (scenario === "no-beads") { console.error("Error: no beads database found"); process.exit(1); }
if (args[0] === "list" && args.includes("--type=epic")) {
  if (args.some((arg) => arg === "--status=in_progress")) out(scenario === "ambiguous" ? epics.slice(0, 2) : ["open-ready", "open-two-ready", "remembered-blocked"].includes(scenario) ? [] : [epics[0]]);
  else if (args.some((arg) => arg === "--status=open")) out(["open-ready", "open-two-ready", "remembered-blocked"].includes(scenario) ? [epics[2], epics[3]] : []);
  else out(epics.filter((epic) => epic.status !== "closed"));
} else if (args[0] === "show") {
  const id = args[1];
  const issue = epics.find((item) => item.id === id) || Object.values(childrenByScenario).flat().find((item) => item.id === id);
  if (issue) out(issue);
  else { console.error("not found"); process.exit(2); }
} else if (args[0] === "children") out(childrenFor(args[1]));
else if (args[0] === "ready") out(childrenFor(args[1]).filter((issue) => issue.status === "open"));
else if (args[0] === "update") {
  const issue = Object.values(childrenByScenario).flat().find((item) => item.id === args[1]);
  out(issue ? { ...issue, status: args[args.indexOf("--status") + 1] || issue.status } : []);
}
else out([]);
`,
	);
	writeFileSync(
		git,
		`#!/usr/bin/env node
const args = process.argv.slice(2);
const dirty = process.env.WORK_RESUME_GIT_DIRTY || "clean";
if (process.env.WORK_RESUME_GIT_FAIL === "1") process.exit(1);
if (args[0] === "diff") {
  if (dirty === "instruction-substantive") process.exit(1);
  if (dirty === "instruction-formatter" && !args.includes("--ignore-blank-lines")) {
    console.log([
      "diff --git a/AGENTS.md b/AGENTS.md",
      "--- a/AGENTS.md",
      "+++ b/AGENTS.md",
      "@@ -1 +1 @@",
      "-See https://example.com/docs for details.",
      "+See <https://example.com/docs> for details."
    ].join("\\n"));
    process.exit(0);
  }
  if (dirty === "benign" && !args.includes("--ignore-blank-lines")) process.exit(1);
  process.exit(0);
}
function printDirty() {
  if (dirty === "unknown") console.log(" M extensions/work-models.js");
  if (dirty === "benign" || dirty === "instruction-substantive" || dirty === "instruction-formatter" || dirty === "workflow") console.log(" M AGENTS.md");
  if (dirty === "untracked-instruction") console.log("?? AGENTS.md");
  if (dirty === "workflow") {
    console.log("M  .beads/issues.jsonl");
    console.log("?? docs/plans/2026-07-05-001-feat-rflib-card-emulation-plan.md");
    console.log("?? pi-session-2026-07-05T17-02-37-680Z_abc.html");
    console.log("?? .pi-subagents/artifacts/run-output.md");
  }
}
if (args.includes("--porcelain=v1")) printDirty();
else {
  console.log("## feat/coded-work-resume");
  printDirty();
}
`,
	);
	for (const name of ["bd", "git"]) {
		const source = name === "bd" ? bd : git;
		writeFileSync(
			path.join(dir, name),
			`#!/bin/sh\nexec node "${source.replaceAll("\\", "/")}" "$@"\n`,
		);
		chmodSync(path.join(dir, name), 0o755);
		writeFileSync(
			path.join(dir, `${name}.cmd`),
			`@node "%~dp0\\fake-${name}.mjs" %*\r\n`,
		);
	}
	return dir;
}

const bin = installFakeCommands();
const oldEnv = {
	bd: process.env.WORK_ORCH_BD_BIN,
	git: process.env.WORK_ORCH_GIT_BIN,
	scenario: process.env.WORK_RESUME_SCENARIO,
	dirty: process.env.WORK_RESUME_GIT_DIRTY,
	gitFail: process.env.WORK_RESUME_GIT_FAIL,
};
process.env.WORK_ORCH_BD_BIN = path.join(bin, "fake-bd.mjs");
process.env.WORK_ORCH_GIT_BIN = path.join(bin, "fake-git.mjs");
try {
	delete process.env.WORK_RESUME_SCENARIO;
	delete process.env.WORK_RESUME_GIT_DIRTY;
	let state = buildWorkResumeState(process.cwd(), "E-1");
	assert(
		state.ok && state.action === "run-debug",
		"ready debug bug wins even when Beads echoes non-blocking dependencies",
	);
	assert(state.selectedBead.id === "BUG-1", "debug bug selected");
	assert(
		state.handoffPrompt.includes("Target Bead ID: BUG-1"),
		"handoff targets selected bead",
	);
	assert(
		!state.handoffPrompt.includes("Large unrelated notes"),
		"handoff omits unrelated note blob",
	);
	assert(
		!JSON.stringify(state).includes("Large unrelated notes"),
		"resume state omits full Beads notes",
	);

	process.env.WORK_RESUME_SCENARIO = "implementation";
	state = buildWorkResumeState(process.cwd(), "E-1");
	assert(
		state.action === "run-implementation" && state.inlineWork,
		"unplanned implementation gets a coded slice plan and continues inline",
	);
	assert(state.selectedBead.id === "IMP-1", "implementation bead selected");
	assert(
		state.handoffPrompt?.includes("WO_INLINE_V1"),
		"inline slice planning avoids a separate planner boundary",
	);
	assert(
		state.handoffPrompt.includes("Target: IMP-1") &&
			state.handoffPrompt.includes('"title":"Implement feature slice"') &&
			state.handoffPrompt.includes('"acceptance":"npm run verify passes"') &&
			!state.handoffPrompt.includes("[object Object]"),
		"coded slice-plan target stays compact and readable",
	);

	process.env.WORK_RESUME_SCENARIO = "implementationAgent";
	state = buildWorkResumeState(process.cwd(), "E-1");
	assert(
		state.action === "run-implementation" &&
			!state.inlineWork &&
			state.selectedBead.executionMode === "agent",
		"coded slice planning preserves the big/high-risk isolated-writer boundary",
	);

	process.env.WORK_RESUME_SCENARIO = "ideasOnly";
	state = buildWorkResumeState(process.cwd(), "E-1");
	assert(
		state.action === "run-planner",
		"idea records alone launch planning rather than implementation",
	);
	assert(state.counts.readyExecutable === 0, "idea records are not executable");
	assert(!state.selectedBead, "idea record is never selected as a bead");

	process.env.WORK_RESUME_SCENARIO = "plannedIdea";
	state = buildWorkResumeState(process.cwd(), "E-1");
	assert(
		state.action === "run-implementation" && state.inlineWork,
		"planned idea selects linked executable child inline",
	);
	assert(state.selectedBead.id === "IMP-1", "linked task selected over idea");
	assert(
		state.handoffPrompt.includes(
			"Plan: execute the wo:slice-plan note on Bead IMP-1 as your spec",
		),
		"implementation handoff points to the slice plan, not the bead alone",
	);

	process.env.WORK_RESUME_SCENARIO = "planning";
	state = buildWorkResumeState(process.cwd(), "E-1");
	assert(state.action === "run-planner", "planning bead selected when alone");
	assert(state.selectedBead.id === "PLAN-1", "planning bead selected");

	process.env.WORK_RESUME_SCENARIO = "stalePlanning";
	state = buildWorkResumeState(process.cwd(), "E-1");
	assert(
		state.action === "close-stale-planning",
		"stale planning stops for cleanup when no executable work is ready",
	);
	assert(
		state.counts.slices === 1,
		"planning beads are not counted as executable slices",
	);
	assert(
		state.counts.closed === 1,
		"closed executable slice count excludes planning beads",
	);
	assert(!state.handoffPrompt, "cleanup stop does not inject handoff");

	process.env.WORK_RESUME_SCENARIO = "stalePlanningReady";
	state = buildWorkResumeState(process.cwd(), "E-1");
	assert(
		state.action === "run-implementation" && state.inlineWork,
		"ready executable work proceeds inline despite stale planning cleanup",
	);
	assert(state.selectedBead.id === "IMP-1", "ready implementation wins");

	process.env.WORK_RESUME_SCENARIO = "inProgressSensitiveContract";
	state = buildWorkResumeState(process.cwd(), "E-1");
	assert(
		state.action === "in-progress-agent" &&
			!state.selectedBead.verificationReady,
		"verification requirements do not masquerade as passing evidence or launch review early",
	);

	process.env.WORK_RESUME_SCENARIO = "inProgressReviewFail";
	state = buildWorkResumeState(process.cwd(), "E-1");
	assert(
		state.action === "run-fix" &&
			directRoleHandoffParams(state, process.cwd())?.agent === "bead-fixer",
		"concrete review FAIL routes directly to exactly one fixer",
	);

	process.env.WORK_RESUME_SCENARIO = "inProgressFixReady";
	state = buildWorkResumeState(process.cwd(), "E-1");
	assert(
		state.action === "run-review" &&
			directRoleHandoffParams(state, process.cwd())?.agent === "bead-reviewer",
		"verified fixer result routes directly to one scoped re-review",
	);

	process.env.WORK_RESUME_SCENARIO = "inProgressReviewPass";
	state = buildWorkResumeState(process.cwd(), "E-1");
	assert(
		state.action === "finish-ready" && !state.handoffPrompt,
		"durable review PASS skips duplicate reviewer and writer agents",
	);

	process.env.WORK_RESUME_SCENARIO = "inProgressReviewCap";
	state = buildWorkResumeState(process.cwd(), "E-1");
	assert(
		state.action === "review-blocked" && !state.handoffPrompt,
		"three review failures stop the coded loop instead of spawning forever",
	);

	process.env.WORK_RESUME_SCENARIO = "blocked";
	state = buildWorkResumeState(process.cwd(), "E-1");
	assert(
		state.action === "report-blocked",
		"blocked epic stops with report action",
	);
	assert(
		state.suggestedCommands[0] === "/work-report DEC-1",
		"blocked epic points at the blocking decision, not downstream debug",
	);
	assert(
		renderWorkResumeText(state).includes("1. /work-report DEC-1"),
		"blocked resume output numbers the executable next action",
	);

	process.env.WORK_RESUME_SCENARIO = "externalBlocked";
	state = buildWorkResumeState(process.cwd(), "E-1");
	assert(
		state.suggestedCommands[0] === "/work-report HW-1",
		"blocked epic points at external hardware blocker before downstream debug",
	);

	process.env.WORK_RESUME_SCENARIO = "plannerGap";
	state = buildWorkResumeState(process.cwd(), "E-1");
	assert(
		state.action === "run-planner",
		"empty unblocked epic launches planner handoff",
	);
	assert(
		state.handoffPrompt.includes("Target Bead ID: none"),
		"planner gap has no selected bead",
	);

	process.env.WORK_RESUME_SCENARIO = "open-ready";
	state = buildWorkResumeState(process.cwd(), "last");
	assert(
		state.ok && state.epic.id === "O-1",
		"single open epic with ready work resolves when no in-progress epic exists",
	);
	assert(state.candidates === undefined, "ready open epic is not ambiguous");

	process.env.WORK_RESUME_SCENARIO = "remembered-blocked";
	state = buildWorkResumeState(process.cwd(), "E-1");
	assert(state.ok && state.epic.id === "E-1", "explicit target is remembered");
	state = buildWorkResumeState(process.cwd(), "last");
	assert(
		state.ok && state.epic.id === "E-1" && state.action === "report-blocked",
		"remembered blocked epic wins over unrelated ready open epics",
	);

	process.env.WORK_RESUME_SCENARIO = "open-two-ready";
	state = buildWorkResumeState(process.cwd(), "O-1");
	assert(
		state.ok && state.epic.id === "O-1",
		"explicit open target refreshes remembered epic",
	);
	state = buildWorkResumeState(process.cwd(), "last");
	assert(
		state.ok && state.epic.id === "O-1",
		"latest open epic with ready work wins when multiple open epics are ready",
	);

	process.env.WORK_RESUME_SCENARIO = "ambiguous";
	state = buildWorkResumeState(process.cwd(), "last");
	assert(
		!state.ok && state.reason === "ambiguous-target",
		"ambiguous target returns parseable stop",
	);
	assert(state.candidates.length === 2, "ambiguous stop includes candidates");
	assert(
		state.candidates[0].counts.children !== undefined,
		"candidates include child counts",
	);
	for (const key of ["id", "status", "title", "created", "updated", "counts"])
		assert(state.candidates[0][key] !== undefined, `candidate includes ${key}`);

	delete process.env.WORK_RESUME_SCENARIO;
	state = buildWorkResumeState(process.cwd(), "BUG-1");
	assert(
		!state.ok && state.reason === "unsupported-target",
		"explicit child target is rejected instead of silently replanned",
	);

	state = buildWorkResumeState(
		process.cwd(),
		"@docs/plans/2026-07-05-001-feat-rflib-card-emulation-plan.md",
	);
	assert(
		!state.ok && state.reason === "plan-path-target",
		"plan path resume target suggests work-plan instead of bd show",
	);
	assert(
		state.suggestedCommands[0] ===
			"/work-plan docs/plans/2026-07-05-001-feat-rflib-card-emulation-plan.md",
		"plan path target strips autocomplete @ marker",
	);

	state = buildWorkResumeState(process.cwd(), "NOPE");
	assert(
		!state.ok && state.reason === "unknown-target",
		"unknown target is parseable",
	);

	process.env.WORK_RESUME_SCENARIO = "no-beads";
	state = buildWorkResumeState(process.cwd(), "last");
	assert(
		!state.ok && state.reason === "beads-unavailable",
		"missing Beads is parseable",
	);

	process.env.WORK_RESUME_SCENARIO = "openDecision";
	state = buildWorkResumeState(process.cwd(), "E-1");
	assert(
		state.action === "report-blocked",
		"open decision without ready work reports blocked",
	);
	assert(
		state.suggestedCommands[0] === "/work-report DEC-ONLY",
		"open decision suggests the decision report",
	);
	assert(!state.handoffPrompt, "open decision does not inject handoff");

	delete process.env.WORK_RESUME_SCENARIO;
	process.env.WORK_RESUME_GIT_FAIL = "1";
	state = buildWorkResumeState(process.cwd(), "E-1");
	assert(state.git.ok === false, "git failure is represented");
	assert(state.action === "dirty-stop", "git unavailable stops writer handoff");
	assert(
		state.warnings.includes("git status unavailable"),
		"git failure warning is preserved",
	);
	delete process.env.WORK_RESUME_GIT_FAIL;

	process.env.WORK_RESUME_GIT_DIRTY = "unknown";
	state = buildWorkResumeState(process.cwd(), "E-1");
	assert(
		state.action === "dirty-stop",
		"unknown dirty file stops writer handoff",
	);
	assert(
		state.message.includes("extensions/work-models.js"),
		"dirty stop names true blocking files",
	);
	assert(!state.handoffPrompt, "dirty stop does not inject handoff");

	process.env.WORK_RESUME_SCENARIO = "inProgressVerifiedAgent";
	state = buildWorkResumeState(process.cwd(), "E-1");
	assert(
		state.action === "run-review" &&
			state.selectedBead.changedPaths.includes("extensions/work-models.js"),
		"verified detached-writer files may cross the dirty gate into scoped review",
	);
	process.env.WORK_RESUME_SCENARIO = "debug";

	process.env.WORK_RESUME_GIT_DIRTY = "workflow";
	state = buildWorkResumeState(process.cwd(), "E-1");
	assert(
		state.action === "run-debug",
		`workflow-owned dirt allows handoff, got ${state.action}: ${state.message ?? ""}`,
	);
	assert(state.git.workflowDirty, "workflow dirt is represented in state");
	assert(
		state.handoffPrompt.includes("workflow-owned allowlist"),
		"handoff tells child about workflow-owned dirty allowlist",
	);

	process.env.WORK_RESUME_GIT_DIRTY = "benign";
	state = buildWorkResumeState(process.cwd(), "E-1");
	assert(
		state.action === "run-debug",
		`benign instruction-file dirt allows handoff, got ${state.action}: ${state.message ?? ""}`,
	);
	assert(state.git.benignDirty, "benign dirt is represented in state");

	process.env.WORK_RESUME_GIT_DIRTY = "instruction-formatter";
	state = buildWorkResumeState(process.cwd(), "E-1");
	assert(
		state.action === "run-debug",
		"formatter-only instruction-file dirt allows handoff",
	);
	assert(state.git.benignDirty, "formatter-only dirt is represented as benign");

	process.env.WORK_RESUME_GIT_DIRTY = "instruction-substantive";
	state = buildWorkResumeState(process.cwd(), "E-1");
	assert(
		state.action === "dirty-stop",
		"substantive instruction-file dirt is not benign",
	);

	process.env.WORK_RESUME_GIT_DIRTY = "untracked-instruction";
	state = buildWorkResumeState(process.cwd(), "E-1");
	assert(
		state.action === "dirty-stop",
		"untracked instruction-file dirt is not benign",
	);

	delete process.env.WORK_RESUME_GIT_DIRTY;
	state = buildWorkResumeState(process.cwd(), "E-C");
	assert(state.action === "done-candidate", "closed epic does not launch work");
	assert(
		state.suggestedCommands.length === 0,
		"closed epic has no self-loop next command",
	);

	const sent = [];
	const notices = [];
	process.env.WORK_RESUME_SCENARIO = "plannedIdea";
	await handleWorkResumeCommand("E-1", {
		cwd: process.cwd(),
		ui: { notify: (message, level) => notices.push({ message, level }) },
		sendUserMessage: async (message, options) =>
			sent.push({ message, options }),
	});
	assert(sent.length === 1, "safe handler injects one follow-up");
	assert(
		sent[0].options.deliverAs === "followUp",
		"handler uses followUp delivery",
	);

	const piSent = [];
	await handleWorkResumeCommand(
		"E-1",
		{
			cwd: process.cwd(),
			ui: { notify: (message, level) => notices.push({ message, level }) },
		},
		{
			sendUserMessage: (message, options) => piSent.push({ message, options }),
		},
	);
	assert(
		piSent.length === 1 && piSent[0].options.deliverAs === "followUp",
		"inline handler falls back to pi.sendUserMessage when ctx helper is absent",
	);

	delete process.env.WORK_RESUME_SCENARIO;
	let rpcReply;
	const rpcPi = {
		events: {
			on: (_name, reply) => {
				rpcReply = reply;
				return () => {};
			},
			emit: () => queueMicrotask(() => rpcReply({ success: true, data: {} })),
		},
	};
	const directResult = await handleWorkResumeCommand(
		"E-1",
		{
			cwd: process.cwd(),
			ui: { notify: (message, level) => notices.push({ message, level }) },
			sendUserMessage: async (message, options) =>
				sent.push({ message, options }),
		},
		rpcPi,
	);
	assert(
		directResult.directHandoff?.agent === "bead-debugger" &&
			directResult.handoffClaimed,
		"live resume directly launches and claims the exact specialist without a duplicate-writer window",
	);

	process.env.WORK_RESUME_SCENARIO = "blocked";
	sent.length = 0;
	await handleWorkResumeCommand("E-1", {
		cwd: process.cwd(),
		ui: { notify: (message, level) => notices.push({ message, level }) },
		sendUserMessage: async (message, options) =>
			sent.push({ message, options }),
	});
	assert(sent.length === 0, "blocked handler does not inject follow-up");
	assert(
		notices.at(-1)?.message.includes("DEC-1") &&
			notices.at(-1)?.message.includes("Blocked:"),
		"blocked resume output includes the compact blocker ledger",
	);

	process.env.WORK_RESUME_SCENARIO = "externalBlocked";
	await handleWorkResumeCommand("E-1", {
		cwd: process.cwd(),
		ui: { notify: (message, level) => notices.push({ message, level }) },
		sendUserMessage: async (message, options) =>
			sent.push({ message, options }),
	});
	assert(
		notices.at(-1)?.message.includes("Required action:") &&
			notices.at(-1)?.message.includes("reconnect COM7"),
		"blocked resume output includes blocker next action",
	);

	// normal profiles add the slice-plan note inline; max can still launch a planner for messy/large slices.
	process.env.WORK_RESUME_SCENARIO = "implementation";
	for (const profile of ["low", "medium", "high"]) {
		const inlineCwd = mkdtempSync(path.join(tmpdir(), "work-resume-inline-"));
		mkdirSync(path.join(inlineCwd, ".pi"), { recursive: true });
		writeFileSync(
			path.join(inlineCwd, ".pi", "settings.json"),
			JSON.stringify({ workOrchestrator: { profile } }),
		);
		const inlineState = buildWorkResumeState(inlineCwd, "E-1");
		assert(
			inlineState.action === "run-implementation" &&
				inlineState.inlineWork &&
				inlineState.handoffPrompt,
			`${profile} slice planning continues inline`,
		);
		rmSync(inlineCwd, { recursive: true, force: true });
	}

	const maxCwd = mkdtempSync(path.join(tmpdir(), "work-resume-ce-"));
	mkdirSync(path.join(maxCwd, ".pi"), { recursive: true });
	writeFileSync(
		path.join(maxCwd, ".pi", "settings.json"),
		JSON.stringify({ workOrchestrator: { profile: "max" } }),
	);
	const maxState = buildWorkResumeState(maxCwd, "E-1");
	assert(
		maxState.action === "run-implementation" && maxState.inlineWork,
		"max still skips a planner boundary for simple slices",
	);
	rmSync(maxCwd, { recursive: true, force: true });
} finally {
	if (oldEnv.bd === undefined) delete process.env.WORK_ORCH_BD_BIN;
	else process.env.WORK_ORCH_BD_BIN = oldEnv.bd;
	if (oldEnv.git === undefined) delete process.env.WORK_ORCH_GIT_BIN;
	else process.env.WORK_ORCH_GIT_BIN = oldEnv.git;
	if (oldEnv.scenario === undefined) delete process.env.WORK_RESUME_SCENARIO;
	else process.env.WORK_RESUME_SCENARIO = oldEnv.scenario;
	if (oldEnv.dirty === undefined) delete process.env.WORK_RESUME_GIT_DIRTY;
	else process.env.WORK_RESUME_GIT_DIRTY = oldEnv.dirty;
	if (oldEnv.gitFail === undefined) delete process.env.WORK_RESUME_GIT_FAIL;
	else process.env.WORK_RESUME_GIT_FAIL = oldEnv.gitFail;
	rmSync(bin, { recursive: true, force: true });
}

console.log("ok - coded work-resume behavior");
