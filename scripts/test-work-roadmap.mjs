#!/usr/bin/env node
import { execFileSync } from "node:child_process";
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
import process from "node:process";
import { loadStore } from "../extensions/work-store.js";
import { seedNativeStore } from "./work-command-fixture.mjs";

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
	{ id: "E-1", issue_type: "epic", status: "in_progress", title: "Current roadmap", notes: "brainstorm-path=docs/brainstorms/accepted.md", updated_at: "2026-07-03T10:00:00Z" },
	{ id: "E-2", issue_type: "epic", status: "open", title: "Open roadmap", updated_at: "2026-07-02T10:00:00Z" },
	{ id: "E-3", issue_type: "epic", status: "closed", title: "Closed roadmap", updated_at: "2026-07-01T10:00:00Z" },
	{ id: "BUG-1", parent_id: "E-1", issue_type: "bug", status: "open", title: "Fix blocker", labels: ["wo:debug"] },
	{ id: "TASK-1", parent_id: "E-1", issue_type: "task", status: "open", title: "Build feature" },
	{ id: "DONE-1", parent_id: "E-1", issue_type: "task", status: "closed", title: "Finished task" },
	{ id: "DONE-2", parent_id: "E-3", issue_type: "task", status: "closed", title: "Done" },
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
	const planCreated = buildWorkPlanState(root, "docs/plans/overhaul.md");
	if (
		!planCreated.ok ||
		!Object.values(loadStore(root).items).some((item) =>
			item.notes.join("\n").includes("source brainstorm"),
		)
	)
		throw new Error(
			`plan file creates native roadmap work: ${JSON.stringify(planCreated)}`,
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
} finally {
	rmSync(root, { recursive: true, force: true });
}
