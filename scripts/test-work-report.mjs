#!/usr/bin/env node
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { buildWorkReport } from "../extensions/work-models.js";

const epic = {
	id: "E-1",
	issue_type: "epic",
	status: "in_progress",
	title: "Add coded work report",
	updated_at: "2026-07-03T10:00:00Z",
};
const children = [
	{
		id: "DONE-1",
		parent_id: "E-1",
		issue_type: "task",
		status: "closed",
		title: "Closed setup",
	},
	{
		id: "B-1",
		parent_id: "E-1",
		issue_type: "task",
		status: "open",
		title: "Blocked C compiler verification",
		labels: ["wo:blocked"],
		depends_on: [
			{ issue_id: "B-1", depends_on_id: "D-1", type: "blocks" },
			{ issue_id: "B-1", depends_on_id: "E-1", type: "parent-child" },
		],
		notes:
			"Command: rtk cmake -S rf-lib -B rf-lib/build\nNo CMAKE_C_COMPILER could be found\nNext: install compiler and rerun\nArtifact: logs/build.json",
	},
	{
		id: "B-2",
		parent_id: "E-1",
		issue_type: "task",
		status: "open",
		title: "Downstream JSON renderer",
		depends_on: [
			{ issue_id: "B-2", depends_on_id: "B-1", type: "blocks" },
			{ issue_id: "B-2", depends_on_id: "DONE-1", type: "blocks" },
		],
	},
	{
		id: "D-1",
		parent_id: "E-1",
		issue_type: "decision",
		status: "open",
		title: "Choose host compiler",
		notes:
			"Failure artifact: CMake missing compiler\\nNext exact action: install compiler then rerun cmake",
	},
	{
		id: "BUG-1",
		parent_id: "E-1",
		issue_type: "bug",
		status: "open",
		title: "Debug package report fixture",
		labels: ["wo:debug-needed"],
		notes: "Run: abc123\nNext: inspect fake fixture",
	},
];

function assert(ok, message) {
	if (!ok) throw new Error(message);
}

function installFakeCommands() {
	const dir = mkdtempSync(path.join(tmpdir(), "work-report-bin-"));
	const bd = path.join(dir, "fake-bd.mjs");
	const git = path.join(dir, "fake-git.mjs");
	writeFileSync(
		bd,
		`#!/usr/bin/env node
const epic = ${JSON.stringify(epic)};
const children = ${JSON.stringify(children)};
const scenario = process.env.WORK_REPORT_SCENARIO || "default";
const args = process.argv.slice(2).filter((arg) => arg !== "--json");
function out(value) { console.log(JSON.stringify(value)); }
if (scenario === "no-beads") { console.error("Error: no beads database found"); process.exit(1); }
if (scenario === "invalid-json") { process.stdout.write("{"); process.exit(0); }
if (args[0] === "list" && args.includes("--type=epic")) {
  if (scenario === "ambiguous" && args.some((arg) => arg === "--status=in_progress")) out([{...epic, id:"E-1"}, {...epic, id:"E-2", title:"Second epic"}]);
  else if (args.some((arg) => arg === "--status=in_progress")) out([epic]);
  else out([]);
} else if (args[0] === "show") {
  const id = args[1];
  if (id === "E-1") out(epic);
  else if (children.find((issue) => issue.id === id)) out(children.find((issue) => issue.id === id));
  else { console.error("not found"); process.exit(2); }
} else if (args[0] === "children") out(children);
else if (args[0] === "ready") out(children.filter((issue) => issue.id === "BUG-1"));
else out([]);
`,
	);
	writeFileSync(
		git,
		`#!/usr/bin/env node
if (process.env.WORK_REPORT_GIT_FAIL === "1") process.exit(1);
console.log("## feat/coded-work-report");
console.log(" M extensions/work-models.js");
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
const oldBdBin = process.env.WORK_ORCH_BD_BIN;
const oldGitBin = process.env.WORK_ORCH_GIT_BIN;
const oldScenario = process.env.WORK_REPORT_SCENARIO;
const oldGitFail = process.env.WORK_REPORT_GIT_FAIL;
process.env.WORK_ORCH_BD_BIN = path.join(bin, "fake-bd.mjs");
process.env.WORK_ORCH_GIT_BIN = path.join(bin, "fake-git.mjs");
try {
	delete process.env.WORK_REPORT_SCENARIO;
	delete process.env.WORK_REPORT_GIT_FAIL;
	const text = buildWorkReport(process.cwd(), "E-1");
	assert(
		text.includes("Current blockers:"),
		"text report includes blockers section",
	);
	assert(text.includes("B-1 open task"), "text report includes blocked bead");
	assert(
		text.includes("command: Command: rtk cmake"),
		"text report includes failure command",
	);
	assert(
		text.includes("artifact: logs/build.json"),
		"text report includes artifact path",
	);
	assert(text.includes("/work-debug BUG-1"), "text report suggests debug bug");

	const defaultJson = JSON.parse(buildWorkReport(process.cwd(), "--json"));
	assert(
		defaultJson.ok === true && defaultJson.epic.id === "E-1",
		"default target resolves one active epic",
	);

	const json = JSON.parse(buildWorkReport(process.cwd(), "E-1 --json"));
	assert(json.ok === true, "json report succeeds");
	assert(
		json.blockers.some((item) => item.id === "B-1"),
		"json includes blocked bead",
	);
	assert(
		json.blockers
			.find((item) => item.id === "B-1")
			.dependencies.includes("D-1"),
		"json keeps blocking dependency id",
	);
	assert(
		!json.blockers
			.find((item) => item.id === "B-1")
			.dependencies.includes("E-1"),
		"json ignores parent-child dependency id",
	);
	assert(
		json.rawNotes.some((item) => item.text.includes("CMAKE_C_COMPILER")),
		"json preserves raw notes",
	);
	assert(
		json.downstreamBlocked.some(
			(item) => item.bead.id === "B-2" && item.blockedBy.id === "B-1",
		),
		"json includes downstream work blocked by B-1",
	);
	assert(
		!json.downstreamBlocked.some(
			(item) => item.bead.id === "B-2" && item.blockedBy.id === "DONE-1",
		),
		"json excludes downstream work whose dependency is closed",
	);

	const bead = buildWorkReport(process.cwd(), "B-1");
	assert(
		bead.includes("Bead: Blocked C compiler verification"),
		"focused bead report renders bead",
	);
	assert(
		bead.includes("D-1"),
		"focused bead report includes direct dependency",
	);
	assert(
		!bead.includes("E-1"),
		"focused bead report ignores parent-child dependency",
	);

	assert(
		bead.includes("Next: Next: install compiler and rerun"),
		"focused bead report uses note next action",
	);

	const decision = buildWorkReport(process.cwd(), "D-1");
	assert(
		decision.includes("CMake missing compiler"),
		"focused decision report normalizes escaped note newlines",
	);
	assert(
		decision.includes("Next: Next exact action: install compiler"),
		"focused decision report uses explicit next action instead of self-loop",
	);

	const rawFallback = buildWorkReport(process.cwd(), "BUG-1");
	assert(
		rawFallback.includes("Run: abc123"),
		"focused bead report includes raw note fallback",
	);

	const unknown = JSON.parse(buildWorkReport(process.cwd(), "NOPE --json"));
	assert(
		unknown.ok === false && unknown.reason === "unknown-target",
		"unknown explicit target is parseable JSON",
	);

	process.env.WORK_REPORT_SCENARIO = "ambiguous";
	const ambiguous = JSON.parse(buildWorkReport(process.cwd(), "last --json"));
	assert(
		ambiguous.ok === false && ambiguous.reason === "ambiguous-target",
		"ambiguous target is parseable JSON",
	);
	assert(
		ambiguous.candidates.length === 2,
		"ambiguous target includes candidates",
	);

	process.env.WORK_REPORT_SCENARIO = "no-beads";
	const noBeads = JSON.parse(buildWorkReport(process.cwd(), "--json"));
	assert(
		noBeads.ok === false && noBeads.reason === "beads-unavailable",
		"missing Beads is parseable JSON",
	);

	process.env.WORK_REPORT_SCENARIO = "invalid-json";
	const invalidJson = JSON.parse(buildWorkReport(process.cwd(), "--json"));
	assert(
		invalidJson.ok === false && invalidJson.reason === "beads-error",
		"invalid Beads JSON is parseable JSON",
	);

	delete process.env.WORK_REPORT_SCENARIO;
	process.env.WORK_REPORT_GIT_FAIL = "1";
	const gitWarning = JSON.parse(buildWorkReport(process.cwd(), "E-1 --json"));
	assert(
		gitWarning.warnings.includes("git status unavailable"),
		"git failure degrades to warning",
	);
} finally {
	if (oldBdBin === undefined) delete process.env.WORK_ORCH_BD_BIN;
	else process.env.WORK_ORCH_BD_BIN = oldBdBin;
	if (oldGitBin === undefined) delete process.env.WORK_ORCH_GIT_BIN;
	else process.env.WORK_ORCH_GIT_BIN = oldGitBin;
	if (oldScenario === undefined) delete process.env.WORK_REPORT_SCENARIO;
	else process.env.WORK_REPORT_SCENARIO = oldScenario;
	if (oldGitFail === undefined) delete process.env.WORK_REPORT_GIT_FAIL;
	else process.env.WORK_REPORT_GIT_FAIL = oldGitFail;
	rmSync(bin, { recursive: true, force: true });
}

console.log("ok - coded work-report behavior");
