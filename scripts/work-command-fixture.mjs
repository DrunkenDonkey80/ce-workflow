import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	createWorkItem,
	initStore,
	loadStore,
	saveStore,
	updateWorkItem,
} from "../extensions/work-store.js";

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
	"no-legacy-empty": [],
	"no-store": [],
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

export function seedNativeStore(cwd, sources) {
	const store = initStore(cwd);
	store.items = {};
	for (const source of sources) {
		createWorkItem(store, {
			id: source.id,
			type: source.issue_type ?? source.type ?? "task",
			status: source.status,
			title: source.title,
			labels: source.labels ?? [],
			notes: source.notes ? [source.notes] : [],
			createdAt: source.created_at ?? source.createdAt,
			updatedAt: source.updated_at ?? source.updatedAt,
			acceptance: source.acceptance ?? source.acceptance_criteria,
			documentLinks: {
				...(source.design ? { design: source.design } : {}),
				...(source.spec_id ? { spec: source.spec_id } : {}),
				...(source.documentLinks ?? source.document_links ?? {}),
			},
		});
	}
	for (const source of sources) {
		const edges = (source.dependencies ?? source.depends_on ?? [])
			.map((edge) => {
				const record = typeof edge === "string" ? {} : edge;
				const toId =
					typeof edge === "string"
						? edge
						: record.depends_on_id ??
							record.dependsOnId ??
							record.dependency_id ??
							record.id;
				if (!toId) return undefined;
				return {
					fromId: source.id,
					toId,
					type: record.type ?? "blocks",
				};
			})
			.filter(Boolean);
		const parentId =
			source.parent_id ??
			source.parentId ??
			edges.find((edge) => edge.type === "parent-child")?.toId;
		updateWorkItem(store, source.id, {
			...(parentId ? { parentId } : {}),
			dependencies: edges
				.filter(
					(edge) =>
						/^blocks?$/i.test(edge.type) && edge.toId !== parentId,
				)
				.map((edge) => edge.toId),
			dependencyEdges: edges,
		});
	}
	saveStore(cwd, store);
	return store;
}

export function installWorkflowFixture() {
	const dir = mkdtempSync(path.join(tmpdir(), "work-flow-bin-"));
	const cwd = mkdtempSync(path.join(tmpdir(), "work-flow-native-"));
	const statePath = path.join(dir, "state.json");
	const logPath = path.join(dir, "log.jsonl");
	mkdirSync(path.join(cwd, "docs", "plans"), { recursive: true });
	writeFileSync(
		path.join(cwd, "docs", "plans", "2026-07-03-004-feat-coded-start-finish-gates-plan.md"),
		"# Coded start/finish\n\n## Summary\nKeep workflow tests deterministic.\n\n## Acceptance\n- Native store works.\n",
	);
	const git = path.join(dir, "fake-git.mjs");

	const reset = (scenario = "active", dirty = "clean") => {
		const children = structuredClone(
			scenarioChildren[scenario] ?? scenarioChildren.active,
		);
		const scenarioEpics =
			scenario === "empty" || scenario === "no-legacy-empty" || scenario === "no-store"
				? []
				: scenario === "ambiguous" || scenario === "openReadyAmbiguous"
					? epics.map((epic) => ({ ...epic, ...(scenario === "openReadyAmbiguous" ? { status: "open" } : {}) }))
					: scenario === "oneOpen"
						? [{ ...epics[0], status: "open" }]
						: [epics[0]];
		writeFileSync(statePath, JSON.stringify({ scenario, epics: scenarioEpics, children, gitCommitted: false, closeCommitted: false }, null, "	"));
		writeFileSync(logPath, "");
		if (scenario === "no-store") {
			rmSync(path.join(cwd, ".ce-workflow"), { recursive: true, force: true });
			rmSync(path.join(cwd, ".pi", "work-store"), {
				recursive: true,
				force: true,
			});
		} else seedNativeStore(cwd, [...scenarioEpics, ...children]);
		process.env.WORK_FLOW_SCENARIO = scenario;
		process.env.WORK_FLOW_GIT_DIRTY = dirty;
	};

	writeFileSync(
		git,
		`#!/usr/bin/env node
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
const statePath = ${JSON.stringify(statePath)};
const logPath = ${JSON.stringify(logPath)};
const args = process.argv.slice(2);
const dirty = process.env.WORK_FLOW_GIT_DIRTY || "clean";
const state = JSON.parse(readFileSync(statePath, "utf8"));
function save() { writeFileSync(statePath, JSON.stringify(state, null, "\t")); }
function log(value) { appendFileSync(logPath, JSON.stringify({ tool: "git", args, ...value }) + "\\n"); }
function dirtyLines() {
  if (state.gitCommitted) return [];
  if (dirty === "unknown" || dirty === "large") return [" M extensions/work-models.js"];
  if (dirty === "benign" || dirty === "instruction-substantive") return [" M AGENTS.md"];
  if (dirty === "staged-instruction") return ["M  AGENTS.md"];
  if (dirty === "untracked-instruction") return ["?? AGENTS.md"];
  if (dirty === "pi-session") return ["?? pi-session-2026-07-05T17-02-37-680Z_abc.html"];
  if (dirty === "work-state") return ["?? .pi/work-orchestrator-state.json"];
  return [];
}
if (args[0] === "diff" && args.includes("--numstat")) {
  if (dirty === "unknown") console.log("12\t3\textensions/work-models.js");
  if (dirty === "large") console.log("90\t40\textensions/work-models.js");
} else if (args[0] === "diff" && args.includes("--cached") && args.includes("--name-only")) {
  if (state.gitStaged) console.log("extensions/work-models.js\\n.ce-workflow/work-items.json");
} else if (args[0] === "diff") process.exit(dirty === "benign" ? 0 : 1);
else if (args[0] === "add") { state.gitStaged = true; save(); log({ op: "add" }); }
else if (args[0] === "commit") {
  if (args.includes("--amend")) state.closeCommitted = true;
  else state.gitCommitted = true;
  state.gitStaged = false;
  save(); log({ op: args.includes("--amend") ? "amend" : "commit" });
}
else if (args[0] === "rev-parse") console.log(state.closeCommitted ? "feed123" : "c0ffee1");
else if (args.includes("--porcelain=v1")) console.log(dirtyLines().join("\\n"));
else {
  console.log("## feat/workflow-intake");
  for (const line of dirtyLines()) console.log(line);
}
`,
	);
	chmodSync(git, 0o755);
	const oldEnv = {
		git: process.env.WORK_ORCH_GIT_BIN,
		scenario: process.env.WORK_FLOW_SCENARIO,
		dirty: process.env.WORK_FLOW_GIT_DIRTY,
	};
	process.env.WORK_ORCH_GIT_BIN = git;
	reset();
	return {
		dir,
		cwd,
		statePath,
		logPath,
		reset,
		store() {
			return loadStore(cwd);
		},
		logs() {
			return readFileSync(logPath, "utf8")
				.trim()
				.split(/\r?\n/)
				.filter(Boolean)
				.map(JSON.parse);
		},
		cleanup() {
			if (oldEnv.git === undefined) delete process.env.WORK_ORCH_GIT_BIN;
			else process.env.WORK_ORCH_GIT_BIN = oldEnv.git;
			if (oldEnv.scenario === undefined) delete process.env.WORK_FLOW_SCENARIO;
			else process.env.WORK_FLOW_SCENARIO = oldEnv.scenario;
			if (oldEnv.dirty === undefined) delete process.env.WORK_FLOW_GIT_DIRTY;
			else process.env.WORK_FLOW_GIT_DIRTY = oldEnv.dirty;
			rmSync(dir, { recursive: true, force: true });
			rmSync(cwd, { recursive: true, force: true });
		},
	};
}
