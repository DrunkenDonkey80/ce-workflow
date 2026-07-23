#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	createWorkItem,
	initStore,
	mutateStore,
	updateWorkItem,
} from "../extensions/work-store.js";
import workModelsExtension, {
	buildWorkImproveObjective,
	buildWorkImproveState,
	buildWorkRoadmapState,
	buildWorkResumeState,
	executeOrchestratorAction,
	workGoalCompletionBlocker,
} from "../extensions/work-models.js";

const root = mkdtempSync(path.join(tmpdir(), "work-improve-"));
const bundle = path.join(root, ".pi", "self-improvement-reports", "report-1");
mkdirSync(bundle, { recursive: true });
mkdirSync(path.join(root, "extensions"), { recursive: true });
execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
writeFileSync(
	path.join(root, "package.json"),
	JSON.stringify({ name: "pi-work-orchestrator", version: "test" }),
);
writeFileSync(path.join(root, "extensions", "work-models.js"), "");
writeFileSync(path.join(root, ".gitignore"), ".pi/\n.ce-workflow/\n");
execFileSync("git", ["add", "."], { cwd: root, stdio: "ignore" });
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
	{ cwd: root, stdio: "ignore" },
);
const enabledSettings = {
	workResume: { selfImproving: true },
	workImprovement: { sourceCheckout: root },
};
writeFileSync(
	path.join(root, ".pi", "settings.json"),
	JSON.stringify(enabledSettings),
);
const log = Buffer.from("formatter failed on runtime store\n");
const hash = createHash("sha256").update(log).digest("hex");
writeFileSync(path.join(bundle, "01-log.txt"), log);
writeFileSync(
	path.join(bundle, "manifest.json"),
	JSON.stringify({
		version: 1,
		files: [{ file: "01-log.txt", bytes: log.length, sha256: hash }],
	}),
);
initStore(root);
mutateStore(root, (store) => {
	createWorkItem(store, {
		id: "SI-1",
		type: "epic",
		status: "in_progress",
		title: "Self-improving",
	});
	createWorkItem(store, {
		id: "SI-1.1",
		type: "task",
		status: "open",
		parentId: "SI-1",
		title: "Self-improvement report: formatter touched runtime state",
		labels: ["report", "self-improvement"],
		description:
			"Observed formatter failure. Expected runtime state exclusion.",
		evidence: [
			{
				kind: "self-improvement-report",
				bundle: ".pi/self-improvement-reports/report-1",
				files: [{ file: "01-log.txt", bytes: log.length, sha256: hash }],
			},
		],
	});
	for (const [id, status] of [
		["SI-CLOSED", "closed"],
		["SI-DEFERRED", "deferred"],
	]) {
		createWorkItem(store, {
			id,
			type: "epic",
			status,
			title: "Self-improving",
		});
		createWorkItem(store, {
			id: `${id}.1`,
			type: "task",
			status: "open",
			parentId: id,
			title: "Self-improvement report: stale roadmap",
			labels: ["report", "self-improvement"],
		});
	}
});

const options = { settings: enabledSettings, sourceCwd: root };
const state = buildWorkImproveState(root, "SI-1");
assert.equal(state.ok, true);
for (const target of ["SI-1", ""]) {
	const genericResume = buildWorkResumeState(root, target);
	assert.equal(
		genericResume.action,
		"work-improve-required",
		"self-improvement reports cannot bypass /work-improve through generic resume",
	);
	assert.deepEqual(genericResume.suggestedCommands, [
		"/work-improve preview SI-1",
		"/work-improve SI-1",
	]);
}
assert.deepEqual(state.snapshotIds, ["SI-1.1"]);
assert.equal(state.reports[0].evidence.valid, true);
const objective = buildWorkImproveObjective(state);
assert.match(objective, /Work-improvement roadmap ID: SI-1/);
assert.match(objective, /Work-improvement snapshot IDs: SI-1\.1/);
assert.match(objective, /Atomize each report before deduplicating/);
assert.match(
	objective,
	/Do not close a duplicate merely because it is similar/,
);
assert.match(objective, /Summarize what was done in 1-3 short sentences/);
for (const id of ["SI-CLOSED", "SI-DEFERRED"])
	assert.equal(
		buildWorkImproveState(root, id).reason,
		"self-improvement-roadmap-missing",
	);
assert.match(
	workGoalCompletionBlocker({ mode: "improvement", objective }, root),
	/SI-1\.1 is still open/,
);
mutateStore(root, (store) =>
	updateWorkItem(store, "SI-1.1", { status: "closed" }),
);
assert.equal(
	workGoalCompletionBlocker({ mode: "improvement", objective }, root),
	undefined,
);

writeFileSync(path.join(bundle, "01-log.txt"), "tampered");
const invalid = buildWorkImproveState(root, "SI-1", options);
assert.equal(invalid.ok, false, "a closed snapshot has no work to improve");
mutateStore(root, (store) =>
	createWorkItem(store, {
		id: "SI-1.2",
		type: "bug",
		status: "open",
		parentId: "SI-1",
		title: "Canonical upstream defect",
	}),
);
const canonical = buildWorkImproveState(root, "SI-1", options);
assert.equal(canonical.ok, true, "open canonical work remains actionable");
assert.deepEqual(canonical.snapshotIds, ["SI-1.2"]);
assert.equal(canonical.reports[0].evidence.valid, true);
assert.doesNotMatch(
	buildWorkImproveObjective(canonical),
	/missing self-improvement report evidence/,
);
mutateStore(root, (store) => {
	updateWorkItem(store, "SI-1.2", { status: "closed" });
	updateWorkItem(store, "SI-1.1", { status: "open" });
});
const tampered = buildWorkImproveState(root, "SI-1", options);
assert.equal(tampered.ok, true);
assert.equal(tampered.reports[0].evidence.valid, false);
assert.match(tampered.reports[0].evidence.problems.join("\n"), /sha256/i);

assert.equal(
	buildWorkImproveState(root, "SI-1", {
		settings: { workResume: { selfImproving: false } },
		sourceCwd: root,
	}).reason,
	"self-improving-disabled",
);
assert.equal(
	buildWorkImproveState(root, "SI-1", { ...options, sourceCwd: tmpdir() })
		.reason,
	"wrong-source-checkout",
);

assert(
	!buildWorkRoadmapState(root, "list").roadmaps.some(
		(roadmap) => roadmap.id === "SI-1",
	),
	"the dedicated improvement roadmap stays out of Roadmaps",
);

const commands = {};
const hooks = {};
const shortcuts = {};
const tools = {};
let activeTools = [];
const pi = {
	on: (name, handler) => {
		hooks[name] = handler;
	},
	registerTool: (tool) => {
		tools[tool.name] = tool;
	},
	registerCommand: (name, config) => {
		commands[name] = config;
	},
	registerShortcut: (name, config) => {
		shortcuts[name] = config;
	},
	getActiveTools: () => activeTools,
	setActiveTools: (tools) => {
		activeTools = tools;
	},
	sendUserMessage: async () => {},
};
workModelsExtension(pi);
const notices = [];
const hookCtx = {
	cwd: root,
	mode: "interactive",
	sessionManager: { getSessionId: () => "work-improve-test" },
	ui: {
		notify: (message) => notices.push(message),
		setStatus: () => {},
		setWidget: () => {},
		setTitle: () => {},
	},
};
await hooks.session_start({}, hookCtx);
assert.equal(
	Object.keys(commands).filter((name) => name.startsWith("work-")).length,
	0,
	"self-improvement remains menu-only",
);
assert(!existsSync(path.join(root, ".pi", "work-runs")));
await executeOrchestratorAction("work-improve", "preview SI-1", hookCtx, pi);
assert(
	!existsSync(path.join(root, ".pi", "work-runs")),
	"preview does not emit telemetry or mutate workflow state",
);
const menuLabels = [];
await shortcuts.f7.handler({
	cwd: root,
	mode: "print",
	ui: {
		select: async (_title, labels) => {
			menuLabels.push(...labels);
			return undefined;
		},
	},
});
assert.match(menuLabels[0], /Roadmaps/);
assert.match(menuLabels[1], /Improve project \(1\)/);
await executeOrchestratorAction("work-improve", "SI-1", hookCtx, pi);
mutateStore(root, (store) =>
	updateWorkItem(store, "SI-1.1", { status: "closed" }),
);
await tools.work_goal_complete.execute(
	"improvement-complete",
	{ summary: "Fixed report ingestion and verified the focused regression test." },
	null,
	null,
	hookCtx,
);
assert(
	notices.some((message) =>
		String(message).includes("Project improvement complete: Fixed report ingestion"),
	),
	"completed improvements show a short result summary",
);
const emptyMenuLabels = [];
await shortcuts.f7.handler({
	cwd: root,
	mode: "print",
	ui: {
		select: async (_title, labels) => {
			emptyMenuLabels.push(...labels);
			return undefined;
		},
	},
});
assert(
	emptyMenuLabels.every((label) => !label.includes("Improve project")),
	"Improve project is hidden when no tasks are available",
);
await hooks.session_shutdown({}, hookCtx);
