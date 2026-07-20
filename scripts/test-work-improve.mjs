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
	handleWorkRoadmapCommand,
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
	updateWorkItem(store, "SI-1.1", { status: "open" }),
);
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

const operationLabels = [];
await handleWorkRoadmapCommand(
	"",
	{
		cwd: root,
		ui: {
			select: async (title, labels) => {
				if (title.includes("operation")) {
					operationLabels.push(...labels);
					return undefined;
				}
				return labels.find((label) => label.includes("SI-1 ["));
			},
			notify: () => {},
		},
	},
	{},
);
assert(operationLabels.some((label) => /work-improve/i.test(label)));
assert(!operationLabels.some((label) => /work-resume/i.test(label)));

writeFileSync(
	path.join(root, ".pi", "settings.json"),
	JSON.stringify({
		...enabledSettings,
		workImprovement: { sourceCheckout: tmpdir() },
	}),
);
const wrongSourceLabels = [];
await handleWorkRoadmapCommand(
	"",
	{
		cwd: root,
		ui: {
			select: async (title, labels) => {
				if (title.includes("operation")) {
					wrongSourceLabels.push(...labels);
					return undefined;
				}
				return labels.find((label) => label.includes("SI-1 ["));
			},
			notify: () => {},
		},
	},
	{},
);
assert(wrongSourceLabels.some((label) => /work-resume/i.test(label)));
assert(!wrongSourceLabels.some((label) => /work-improve/i.test(label)));

writeFileSync(
	path.join(root, ".pi", "settings.json"),
	JSON.stringify(enabledSettings),
);
const commands = {};
const hooks = {};
let activeTools = [];
workModelsExtension({
	on: (name, handler) => {
		hooks[name] = handler;
	},
	registerTool: () => {},
	registerCommand: (name, config) => {
		commands[name] = config;
	},
	getActiveTools: () => activeTools,
	setActiveTools: (tools) => {
		activeTools = tools;
	},
});
const hookCtx = {
	cwd: root,
	mode: "interactive",
	sessionManager: { getSessionId: () => "work-improve-test" },
	ui: {
		notify: () => {},
		setStatus: () => {},
		setWidget: () => {},
		setTitle: () => {},
	},
};
await hooks.session_start({}, hookCtx);
assert(
	commands["work-improve"],
	"registers only when improvement work is ready",
);
assert(!existsSync(path.join(root, ".pi", "work-runs")));
await commands["work-improve"].handler("preview SI-1", hookCtx);
assert(
	!existsSync(path.join(root, ".pi", "work-runs")),
	"preview does not emit telemetry or mutate workflow state",
);
await hooks.session_shutdown({}, hookCtx);
