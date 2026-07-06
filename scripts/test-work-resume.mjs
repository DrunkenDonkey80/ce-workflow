#!/usr/bin/env node
import {
	chmodSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import process from "node:process";

const { buildWorkResumeState, handleWorkResumeCommand } = await import(
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
  if (scenario === "open-ready") return id === "O-1" ? childrenByScenario.openReady : childrenByScenario.openBlocked;
  if (scenario === "open-two-ready") return id === "O-1" ? childrenByScenario.openReady : [{...childrenByScenario.openReady[0], id:"OPEN-READY-2", parent_id:"O-2"}];
  const rows = childrenByScenario[scenario] || childrenByScenario.default;
  return rows.filter((issue) => issue.parent_id === id);
}
if (scenario === "no-beads") { console.error("Error: no beads database found"); process.exit(1); }
if (args[0] === "list" && args.includes("--type=epic")) {
  if (args.some((arg) => arg === "--status=in_progress")) out(scenario === "ambiguous" ? epics.slice(0, 2) : ["open-ready", "open-two-ready"].includes(scenario) ? [] : [epics[0]]);
  else if (args.some((arg) => arg === "--status=open")) out(["open-ready", "open-two-ready"].includes(scenario) ? [epics[2], epics[3]] : []);
  else out(epics.filter((epic) => epic.status !== "closed"));
} else if (args[0] === "show") {
  const id = args[1];
  const issue = epics.find((item) => item.id === id) || Object.values(childrenByScenario).flat().find((item) => item.id === id);
  if (issue) out(issue);
  else { console.error("not found"); process.exit(2); }
} else if (args[0] === "children") out(childrenFor(args[1]));
else if (args[0] === "ready") out(childrenFor(args[1]).filter((issue) => issue.status === "open"));
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
  if (dirty === "benign" && !args.includes("--ignore-blank-lines")) process.exit(1);
  process.exit(0);
}
function printDirty() {
  if (dirty === "unknown") console.log(" M extensions/work-models.js");
  if (dirty === "benign" || dirty === "instruction-substantive" || dirty === "workflow") console.log(" M AGENTS.md");
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
	assert(state.ok && state.action === "run-debug", "ready debug bug wins");
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
		state.action === "run-implementation",
		"implementation selected before planning",
	);
	assert(state.selectedBead.id === "IMP-1", "implementation bead selected");

	process.env.WORK_RESUME_SCENARIO = "planning";
	state = buildWorkResumeState(process.cwd(), "E-1");
	assert(state.action === "run-planner", "planning bead selected when alone");
	assert(state.selectedBead.id === "PLAN-1", "planning bead selected");

	process.env.WORK_RESUME_SCENARIO = "stalePlanning";
	state = buildWorkResumeState(process.cwd(), "E-1");
	assert(
		state.action === "close-stale-planning",
		"stale planning stops for cleanup",
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

	process.env.WORK_RESUME_SCENARIO = "open-two-ready";
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
		"handler falls back to pi.sendUserMessage when ctx helper is absent",
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
