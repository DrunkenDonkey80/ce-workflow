#!/usr/bin/env node
import {
	chmodSync,
	mkdtempSync,
	mkdirSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import process from "node:process";
import { seedNativeStore } from "./work-command-fixture.mjs";

const { buildWorkReport } = await import(
	pathToFileURL(
		realpathSync(
			path.join(import.meta.dirname, "../extensions/work-models.js"),
		),
	).href
);

const hugeText = "FULL_PLAN_SHOULD_NOT_LEAK ".repeat(200);

const epic = {
	id: "E-1",
	issue_type: "epic",
	status: "in_progress",
	title: "Add coded work report",
	description: hugeText,
	design: hugeText,
	acceptance_criteria: hugeText,
	notes: hugeText,
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
		description: hugeText,
		design: hugeText,
		labels: ["wo:blocked"],
		depends_on: [
			{ issue_id: "B-1", depends_on_id: "D-1", type: "blocks" },
			{ issue_id: "B-1", depends_on_id: "E-1", type: "parent-child" },
		],
		notes:
			"Command: rtk cmake -S rf-lib -B rf-lib/build\nNo CMAKE_C_COMPILER could be found\nNext: install compiler and rerun\nArtifact: logs/build.json\nLater debug failed: compiler installed but linker missing\nNext: install linker and rerun",
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
	const git = path.join(dir, "fake-git.mjs");
	writeFileSync(
		git,
		`#!/usr/bin/env node
if (process.env.WORK_REPORT_GIT_FAIL === "1") process.exit(1);
console.log("## feat/coded-work-report");
console.log(" M extensions/work-models.js");
`,
	);
	chmodSync(git, 0o755);
	return dir;
}

const cwd = mkdtempSync(path.join(tmpdir(), "work-report-cwd-"));
function resetNative(scenario = "default") {
	const activeEpic =
		scenario === "closed" ? { ...epic, status: "closed" } : epic;
	const activeChildren =
		scenario === "closed"
			? children.map((issue) => ({
					...issue,
					status: "closed",
					labels: [],
					depends_on: [],
				}))
			: children;
	seedNativeStore(cwd, [
		activeEpic,
		...(scenario === "ambiguous"
			? [{ ...epic, id: "E-2", title: "Second epic" }]
			: []),
		...activeChildren,
	]);
}
resetNative();
const bin = installFakeCommands();
const oldGitBin = process.env.WORK_ORCH_GIT_BIN;
const oldScenario = process.env.WORK_REPORT_SCENARIO;
const oldGitFail = process.env.WORK_REPORT_GIT_FAIL;
process.env.WORK_ORCH_GIT_BIN = path.join(bin, "fake-git.mjs");
try {
	delete process.env.WORK_REPORT_SCENARIO;
	delete process.env.WORK_REPORT_GIT_FAIL;
	const text = buildWorkReport(cwd, "E-1");
	assert(
		text.includes("Current blockers:"),
		"text report includes blockers section",
	);
	assert(
		text.includes("B-1 🟢 open task"),
		"text report includes blocked workItem",
	);
	assert(
		text.includes("command: Command: rtk cmake"),
		"text report includes failure command",
	);
	assert(
		text.includes("artifact: logs/build.json"),
		"text report includes artifact path",
	);
	assert(text.includes("/work-debug BUG-1"), "text report suggests debug bug");

	const defaultJson = JSON.parse(buildWorkReport(cwd, "--json"));
	assert(
		defaultJson.ok === true && defaultJson.epic.id === "E-1",
		"default target resolves one active epic",
	);

	const json = JSON.parse(buildWorkReport(cwd, "E-1 --json"));
	assert(json.ok === true, "json report succeeds");
	assert(
		json.blockers.some((item) => item.id === "B-1"),
		"json includes blocked workItem",
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
		json.noteExcerpts.some((item) => item.text.includes("CMAKE_C_COMPILER")),
		"json preserves compact note excerpts",
	);
	assert(
		!JSON.stringify(json).includes("FULL_PLAN_SHOULD_NOT_LEAK"),
		"json omits full WorkItems description/design/acceptance/notes",
	);
	assert(
		json.downstreamBlocked.some(
			(item) => item.workItem.id === "B-2" && item.blockedBy.id === "B-1",
		),
		"json includes downstream work blocked by B-1",
	);
	assert(
		!json.downstreamBlocked.some(
			(item) => item.workItem.id === "B-2" && item.blockedBy.id === "DONE-1",
		),
		"json excludes downstream work whose dependency is closed",
	);

	const shorthand = buildWorkReport(cwd, "2");
	assert(
		shorthand.includes("WorkItem: Downstream JSON renderer"),
		"numeric shorthand resolves focused workItem report",
	);
	const punctuatedShorthand = buildWorkReport(cwd, "2.");
	assert(
		punctuatedShorthand.includes("WorkItem: Downstream JSON renderer"),
		"numeric shorthand tolerates copied sentence punctuation",
	);

	const workItem = buildWorkReport(cwd, "B-1");
	assert(
		workItem.includes("WorkItem: Blocked C compiler verification"),
		"focused workItem report renders workItem",
	);
	const punctuatedWorkItem = buildWorkReport(cwd, "B-1.");
	assert(
		punctuatedWorkItem.includes("WorkItem: Blocked C compiler verification"),
		"focused workItem report tolerates copied sentence punctuation",
	);
	assert(
		workItem.includes("D-1"),
		"focused workItem report includes direct dependency",
	);
	assert(
		workItem.includes("Next: Next: install linker and rerun"),
		"focused workItem report uses latest next action",
	);
	assert(
		!workItem.includes("E-1"),
		"focused workItem report ignores parent-child dependency",
	);

	const decision = buildWorkReport(cwd, "D-1");
	assert(
		decision.includes("CMake missing compiler"),
		"focused decision report normalizes escaped note newlines",
	);
	assert(
		decision.includes("Next: Next exact action: install compiler"),
		"focused decision report uses explicit next action instead of self-loop",
	);

	const rawFallback = buildWorkReport(cwd, "BUG-1");
	assert(
		rawFallback.includes("Run: abc123"),
		"focused workItem report includes raw note fallback",
	);

	const unknown = JSON.parse(buildWorkReport(cwd, "NOPE --json"));
	assert(
		unknown.ok === false && unknown.reason === "unknown-target",
		"unknown explicit target is parseable JSON",
	);

	resetNative("ambiguous");
	const ambiguous = JSON.parse(buildWorkReport(cwd, "last --json"));
	assert(
		ambiguous.ok === false && ambiguous.reason === "ambiguous-target",
		"ambiguous target is parseable JSON",
	);
	assert(
		ambiguous.candidates.length === 2,
		"ambiguous target includes candidates",
	);

	resetNative("closed");
	const closed = buildWorkReport(cwd, "E-1");
	assert(
		closed.includes("Status: ✅ closed") &&
			closed.includes('Next: roadmap E-1 "Add coded work report" is complete.'),
		"closed completed roadmap reports completion next action",
	);
	const closedJson = JSON.parse(buildWorkReport(cwd, "E-1 --json"));
	assert(
		closedJson.suggestedCommands.length === 0,
		"closed completed roadmap JSON has no suggested command",
	);

	rmSync(path.join(cwd, ".ce-workflow"), { recursive: true, force: true });
	rmSync(path.join(cwd, ".pi", "work-store"), { recursive: true, force: true });
	mkdirSync(path.join(cwd, ".beads"), { recursive: true });
	const migrationRequired = JSON.parse(buildWorkReport(cwd, "--json"));
	assert(
		migrationRequired.ok === false &&
			migrationRequired.reason === "migration-required",
		"legacy work state requires migration",
	);

	resetNative();
	writeFileSync(path.join(cwd, ".ce-workflow", "work-items.json"), "{");
	rmSync(path.join(cwd, ".pi", "work-store"), { recursive: true, force: true });
	const recoveryRequired = JSON.parse(buildWorkReport(cwd, "--json"));
	assert(
		recoveryRequired.ok === false &&
			recoveryRequired.reason === "recovery-required",
		"invalid native store is parseable JSON",
	);

	rmSync(path.join(cwd, ".ce-workflow"), { recursive: true, force: true });
	resetNative();
	process.env.WORK_REPORT_GIT_FAIL = "1";
	const gitWarning = JSON.parse(buildWorkReport(cwd, "E-1 --json"));
	assert(
		gitWarning.warnings.includes("git status unavailable"),
		"git failure degrades to warning",
	);
} finally {
	if (oldGitBin === undefined) delete process.env.WORK_ORCH_GIT_BIN;
	else process.env.WORK_ORCH_GIT_BIN = oldGitBin;
	if (oldScenario === undefined) delete process.env.WORK_REPORT_SCENARIO;
	else process.env.WORK_REPORT_SCENARIO = oldScenario;
	if (oldGitFail === undefined) delete process.env.WORK_REPORT_GIT_FAIL;
	else process.env.WORK_REPORT_GIT_FAIL = oldGitFail;
	rmSync(bin, { recursive: true, force: true });
	rmSync(cwd, { recursive: true, force: true });
}

console.log("ok - coded work-report behavior");
