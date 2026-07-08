#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import {
	chmodSync,
	existsSync,
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
import process from "node:process";

const {
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
const binRoot = mkdtempSync(path.join(tmpdir(), "work-roadmap-bin-"));
execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
const log = path.join(binRoot, "bd.log");
const commandLog = path.join(binRoot, "bd-commands.log");
const bd = path.join(binRoot, "bd-fake.mjs");
mkdirSync(path.join(root, ".pi"));

writeFileSync(
	bd,
	`#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
const epics = [
  { id: 'E-1', issue_type: 'epic', status: 'in_progress', title: 'Current roadmap', notes: 'brainstorm-path=docs/brainstorms/accepted.md', updated_at: '2026-07-03T10:00:00Z' },
  { id: 'E-2', issue_type: 'epic', status: 'open', title: 'Open roadmap', updated_at: '2026-07-02T10:00:00Z' },
  { id: 'E-3', issue_type: 'epic', status: 'closed', title: 'Closed roadmap', updated_at: '2026-07-01T10:00:00Z' },
];
const activeChildren = [
  { id: 'BUG-1', parent_id: 'E-1', issue_type: 'bug', status: 'open', title: 'Fix blocker', labels: ['wo:debug'] },
  { id: 'TASK-1', parent_id: 'E-1', issue_type: 'task', status: 'open', title: 'Build feature' },
  { id: 'DONE-1', parent_id: 'E-1', issue_type: 'task', status: 'closed', title: 'Finished task' },
];
const closedChildren = [{ id: 'DONE-2', parent_id: 'E-3', issue_type: 'task', status: 'closed', title: 'Done' }];
const args = process.argv.slice(2).filter(arg => arg !== '--json');
appendFileSync(${JSON.stringify(commandLog)}, args.join(' ') + '\\n');
const issues = [...epics, ...activeChildren, ...closedChildren];
const out = value => process.stdout.write(JSON.stringify(value));
if (args[0] === 'list' && args.includes('--type=epic')) {
  const status = args.find(arg => arg.startsWith('--status='))?.slice(9);
  out(status ? epics.filter(epic => epic.status === status) : epics);
} else if (args[0] === 'show') {
  out(issues.filter(issue => issue.id === args[1]));
} else if (args[0] === 'children') {
  out(args[1] === 'E-3' ? closedChildren : args[1] === 'E-1' ? activeChildren : []);
} else if (args[0] === 'close' || args[0] === 'reopen') {
  appendFileSync(${JSON.stringify(log)}, args.join(' ') + '\\n');
} else {
  out([]);
}
`,
);
chmodSync(bd, 0o755);
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
process.env.WORK_ORCH_BD_BIN = bd;

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
	console.assert(
		!readFileSync(commandLog, "utf8").includes("children"),
		"roadmap list does not fetch every child list",
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
		notices.some((message) => message.includes("Bead: Fix blocker")),
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
	const planCreated = buildWorkPlanState(root, "docs/plans/overhaul.md");
	if (
		!planCreated.ok ||
		!readFileSync(commandLog, "utf8").includes("create Plan next slice")
	)
		throw new Error(
			`plan file creates roadmap epic in temp repo: ${JSON.stringify(planCreated)}\n${readFileSync(commandLog, "utf8")}`,
		);
	if (!readFileSync(commandLog, "utf8").includes("source brainstorm"))
		throw new Error(
			`created roadmap keeps linked brainstorm artifacts in Beads notes\n${readFileSync(commandLog, "utf8")}`,
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
	console.assert(!existsSync(log), "no implicit close was run");

	const forced = buildWorkRoadmapState(root, "close current --force");
	console.assert(
		forced.action === "roadmap-closed",
		"force closes by explicit request",
	);
	console.assert(
		readFileSync(log, "utf8").includes("close E-1"),
		"close command was run",
	);

	const reopened = buildWorkRoadmapState(root, "reopen E-3");
	console.assert(
		reopened.action === "roadmap-reopened",
		"reopens explicit roadmap",
	);
	console.assert(
		readFileSync(log, "utf8").includes("reopen E-3"),
		"reopen command was run",
	);
} finally {
	delete process.env.WORK_ORCH_BD_BIN;
	rmSync(root, { recursive: true, force: true });
	rmSync(binRoot, { recursive: true, force: true });
}
