#!/usr/bin/env node
import {
	chmodSync,
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
import { seedNativeStore } from "./work-command-fixture.mjs";

const {
	buildWorkResumeState,
	directRoleHandoffParams,
	executeNumberedWorkAction,
	executeOrchestratorAction,
	handleWorkResumeCommand,
	renderWorkResumeText,
} = await import(
	pathToFileURL(
		realpathSync(path.join(import.meta.dirname, "../extensions/work-models.js")),
	).href
);
const {
	addFinding,
	addGroup,
	createBatch,
	initVerifierStore,
	ingestAnalysisReview,
	loadVerifierStore,
	mutateVerifierStore,
	recordOperationResult,
} = await import(
	pathToFileURL(
		realpathSync(
			path.join(import.meta.dirname, "../extensions/background-verifiers.js"),
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
			notes: "Large unrelated notes should not be copied into the handoff prompt.",
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
	oversizedImplementation: [
		{
			id: "IMP-WIDE",
			parent_id: "E-1",
			issue_type: "task",
			status: "open",
			title: "Implement oversized bootstrap slice",
			created_at: "2026-07-03T02:00:00Z",
			notes:
				"Files changed: src/1.js, src/2.js, src/3.js, src/4.js, src/5.js, src/6.js, src/7.js, src/8.js, src/9.js",
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
			notes: "wo:slice-plan\nplan-path: docs/plans/idea.md\nplanner: work-planner",
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
			title: "Old planning workItem",
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
			title: "Old planning workItem",
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
	nestedPlanningReady: [
		{
			id: "PLAN-1",
			parent_id: "E-1",
			issue_type: "task",
			status: "closed",
			title: "Closed planning container",
			labels: ["wo:planning"],
		},
		{
			id: "IMP-NESTED",
			parent_id: "PLAN-1",
			issue_type: "task",
			status: "open",
			title: "Ready executable grandchild",
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
			notes: "wo:execution-agent\nVerification command required: npm run verify",
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
				"wo:execution-agent\nFiles changed: extensions/work-models.js, `scripts/file with space.js`, .ce-workflow/work-items.json, .pi-subagents/artifacts/review.md, .pi/work-runs/run.json.\nwo:verify-check PASS\nwo:review FAIL - permission bypass remains\nwo:fix PASS - bypass removed and tests passed",
		},
	],
	inProgressFixReadyNoPaths: [
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
	inProgressStaleReviewPass: [
		{
			id: "AUTH-1",
			parent_id: "E-1",
			issue_type: "task",
			status: "in_progress",
			title: "Update authentication permission checks",
			notes:
				'wo:execution-agent\nFiles changed: extensions/work-models.js.\nwo:verify-check PASS\nwo:review PASS - old scope\nwo:review-scope ["extensions/work-models.js"]',
		},
	],
	inProgressQuotedReviewPass: [
		{
			id: "AUTH-1",
			parent_id: "E-1",
			issue_type: "task",
			status: "in_progress",
			title: "Update authentication permission checks",
			notes:
				"wo:execution-agent\nFiles changed: extensions/work-models.js.\nwo:verify-check PASS\nwo:review FAIL - parser misreads prose mentioning review PASS handling",
		},
	],
	inProgressMechanicalFix: [
		{
			id: "AUTH-1",
			parent_id: "E-1",
			issue_type: "task",
			status: "in_progress",
			title: "Update authentication permission checks",
			notes:
				'wo:execution-agent\nFiles changed: docs/auth.md.\nwo:verify-check PASS\nwo:review FAIL - source comment date is missing\nwo:fix PASS - comment fixed\nwo:mechanical-fix PASS {"dispositions":[{"finding":"source comment date is missing","fix":"added source date","evidence":"documentation check passed"}]}',
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
				'wo:execution-agent\nwo:verify-check PASS\nwo:review FAIL - one\nwo:fix PASS\nwo:review FAIL {"findings":["residual A","residual B"]}\nwo:fix PASS - generic residual summary\nwo:residual-fix PASS {"dispositions":[{"finding":"residual A","fix":"only one fix","evidence":"one test"}]}',
		},
	],
	inProgressResidualFix: [
		{
			id: "AUTH-1",
			parent_id: "E-1",
			issue_type: "task",
			status: "in_progress",
			title: "Update authentication permission checks",
			notes:
				'wo:execution-agent\nFiles changed: extensions/work-models.js.\nwo:verify-check PASS\nwo:review FAIL - one\nwo:fix PASS\nwo:review FAIL {"findings":["residual A","residual B"]}\nwo:fix PASS - both residuals fixed; tests passed\nwo:residual-fix PASS {"dispositions":[{"finding":"residual A","fix":"bounded guard","evidence":"focused test A passed"},{"finding":"residual B","fix":"scope guard","evidence":"focused test B passed"}]}',
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
	const git = path.join(dir, "fake-git.mjs");
	writeFileSync(
		git,
		`#!/usr/bin/env node
const args = process.argv.slice(2);
const dirty = process.env.WORK_RESUME_GIT_DIRTY || "clean";
if (process.env.WORK_RESUME_GIT_FAIL === "1") process.exit(1);
if (args[0] === "diff") {
  if (dirty.startsWith("formatter-") && args.includes("--numstat")) {
    if (dirty === "formatter-expanded-staged" && !args.includes("HEAD")) process.exit(0);
    const counts = dirty === "formatter-semantic"
      ? ["180\\t0\\textensions/work-models.js", "450\\t0\\textensions/work-models.js"]
      : dirty === "formatter-ratio"
        ? ["60\\t0\\textensions/work-models.js", "120\\t0\\textensions/work-models.js"]
        : ["8\\t2\\textensions/work-models.js", "450\\t450\\textensions/work-models.js"];
    console.log(counts[args.includes("--ignore-all-space") ? 0 : 1]);
    process.exit(0);
  }
  if (dirty === "unknown" || dirty === "instruction-substantive") process.exit(1);
  if (dirty === "instruction-formatter" && !args.includes("--ignore-blank-lines")) {
    console.log(["diff --git a/AGENTS.md b/AGENTS.md", "--- a/AGENTS.md", "+++ b/AGENTS.md", "@@ -1 +1 @@", "-See https://example.com/docs for details.", "+See <https://example.com/docs> for details."].join("\\n"));
    process.exit(0);
  }
  if (dirty === "benign" && !args.includes("--ignore-blank-lines")) process.exit(1);
  process.exit(0);
}
function printDirty() {
  if (["unknown", "formatter-expanded", "formatter-expanded-staged", "formatter-semantic", "formatter-ratio"].includes(dirty)) console.log(" M extensions/work-models.js");
  if (["benign", "instruction-substantive", "instruction-formatter", "workflow"].includes(dirty)) console.log(" M AGENTS.md");
  if (dirty === "untracked-instruction") console.log("?? AGENTS.md");
  if (dirty === "workflow") {
    console.log("M  .ce-workflow/work-items.json");
    console.log("?? docs/plans/2026-07-05-001-feat-rflib-card-emulation-plan.md");
    console.log("?? pi-session-2026-07-05T17-02-37-680Z_abc.html");
    console.log("?? .pi-subagents/artifacts/run-output.md");
  }
}
if (args.includes("--porcelain=v1")) printDirty();
else { console.log("## feat/coded-work-resume"); printDirty(); }
`,
	);
	chmodSync(git, 0o755);
	return dir;
}

const cwd = mkdtempSync(path.join(tmpdir(), "work-resume-cwd-"));
const globalDir = mkdtempSync(path.join(tmpdir(), "work-resume-global-"));
const bin = installFakeCommands();
const oldEnv = {
	agentDir: process.env.PI_CODING_AGENT_DIR,
	git: process.env.WORK_ORCH_GIT_BIN,
	scenario: process.env.WORK_RESUME_SCENARIO,
	dirty: process.env.WORK_RESUME_GIT_DIRTY,
	gitFail: process.env.WORK_RESUME_GIT_FAIL,
};
process.env.PI_CODING_AGENT_DIR = globalDir;
process.env.WORK_ORCH_GIT_BIN = path.join(bin, "fake-git.mjs");
mkdirSync(path.join(cwd, ".pi"), { recursive: true });
writeFileSync(
	path.join(cwd, ".pi", "settings.json"),
	JSON.stringify({ workOrchestrator: { profile: "low" } }),
);
function sourcesForScenario(scenario = "default") {
	const closed = epics.find((epic) => epic.id === "E-C");
	if (
		["open-ready", "open-two-ready", "remembered-blocked"].includes(scenario)
	) {
		const children =
			scenario === "open-two-ready"
				? [
						...childrenByScenario.openReady,
						{
							...childrenByScenario.openReady[0],
							id: "OPEN-READY-2",
							parent_id: "O-2",
						},
					]
				: scenario === "remembered-blocked"
					? [
							...childrenByScenario.blocked,
							...childrenByScenario.openReady,
							...childrenByScenario.openBlocked,
						]
					: [...childrenByScenario.openReady, ...childrenByScenario.openBlocked];
		return [
			...(scenario === "remembered-blocked" ? [epics[0]] : []),
			epics[2],
			epics[3],
			closed,
			...children,
		];
	}
	if (scenario === "ambiguous") return [...epics.slice(0, 2), closed];
	return [
		epics[0],
		closed,
		{
			id: "IMP-OLD",
			issue_type: "task",
			status: "closed",
			title: "Historical discovery",
		},
		...(childrenByScenario[scenario] ?? childrenByScenario.default),
	];
}
function setScenario(scenario = "default") {
	process.env.WORK_RESUME_SCENARIO = scenario;
	if (scenario === "no-legacy") {
		rmSync(path.join(cwd, ".ce-workflow"), { recursive: true, force: true });
		rmSync(path.join(cwd, ".pi", "work-store"), {
			recursive: true,
			force: true,
		});
		mkdirSync(path.join(cwd, ".beads"), { recursive: true });
		return;
	}
	seedNativeStore(cwd, sourcesForScenario(scenario));
}
try {
	setScenario();
	delete process.env.WORK_RESUME_GIT_DIRTY;
	let state = buildWorkResumeState(cwd, "E-1");
	assert(
		state.ok && state.action === "run-debug",
		"ready debug bug wins even when native store echoes non-blocking dependencies",
	);
	assert(state.selectedWorkItem.id === "BUG-1", "debug bug selected");
	assert(
		state.handoffPrompt.includes("Target work item: BUG-1"),
		"handoff targets selected workItem",
	);
	assert(
		!state.handoffPrompt.includes("Large unrelated notes"),
		"handoff omits unrelated note blob",
	);
	assert(
		!JSON.stringify(state).includes("Large unrelated notes"),
		"resume state omits full work-item notes",
	);

	setScenario("implementation");
	state = buildWorkResumeState(cwd, "E-1");
	assert(
		state.action === "run-implementation" &&
			!state.inlineWork &&
			directRoleHandoffParams(state, cwd)?.agent === "work-worker",
		"unplanned implementation gets a coded slice plan and continues in the worker",
	);
	assert(
		state.selectedWorkItem.id === "IMP-1",
		"implementation workItem selected",
	);
	assert(
		state.handoffPrompt?.includes("Implementation scope: medium"),
		"coded slice planning avoids a separate planner boundary",
	);
	assert(
		state.handoffPrompt.includes("Selected work item: IMP-1") &&
			state.handoffPrompt.includes("Implement feature slice") &&
			!state.handoffPrompt.includes("[object Object]"),
		"worker slice-plan target stays compact and readable",
	);

	setScenario("oversizedImplementation");
	state = buildWorkResumeState(cwd, "E-1");
	assert(
		state.action === "run-planner" &&
			state.selectedWorkItem.id === "IMP-WIDE" &&
			state.handoffPrompt.includes("at most 8 declared implementation files") &&
			!state.handoffPrompt.includes("Implementation scope: medium"),
		"oversized executable scope is re-cut before implementation starts",
	);
	assert(
		readFileSync(
			path.join(import.meta.dirname, "../agents/work-planner.md"),
			"utf8",
		).includes("contain at most 8 such files"),
		"planner contract records the same finish-task file cap",
	);

	setScenario("implementationAgent");
	state = buildWorkResumeState(cwd, "E-1");
	assert(
		state.action === "run-implementation" &&
			!state.inlineWork &&
			state.selectedWorkItem.executionMode === "agent",
		"coded slice planning preserves the big/high-risk isolated-writer boundary",
	);

	setScenario("ideasOnly");
	state = buildWorkResumeState(cwd, "E-1");
	assert(
		state.action === "run-planner",
		"idea records alone launch planning rather than implementation",
	);
	assert(state.counts.readyExecutable === 0, "idea records are not executable");
	assert(!state.selectedWorkItem, "idea record is never selected as a workItem");

	setScenario("plannedIdea");
	state = buildWorkResumeState(cwd, "E-1");
	assert(
		state.action === "run-implementation" &&
			directRoleHandoffParams(state, cwd)?.agent === "work-worker",
		"planned idea selects its linked executable child worker",
	);
	assert(
		state.selectedWorkItem.id === "IMP-1",
		"linked task selected over idea",
	);
	assert(
		state.handoffPrompt.includes(
			"Plan: execute the wo:slice-plan note on WorkItem IMP-1 as your spec",
		),
		"implementation handoff points to the slice plan, not the workItem alone",
	);

	const advisorCwd = mkdtempSync(path.join(tmpdir(), "work-resume-advisor-"));
	try {
		mkdirSync(path.join(advisorCwd, ".pi"), { recursive: true });
		writeFileSync(
			path.join(advisorCwd, ".pi", "settings.json"),
			JSON.stringify({ workOrchestrator: { profile: "medium" } }),
		);
		seedNativeStore(advisorCwd, sourcesForScenario("plannedIdea"));
		let advisorState = buildWorkResumeState(advisorCwd, "E-1");
		assert(
			advisorState.action === "advisor-gate-pending" &&
				directRoleHandoffParams(advisorState, advisorCwd) === null,
			"a planner-created slice stops at the coded advisor gate before its worker",
		);
		assert(
			advisorState.handoffPrompt.includes("work-advisor") &&
				advisorState.handoffPrompt.includes(
					"wo:slice-advisor PASS agents=work-advisor",
				),
			"medium profile exposes the first configured advisor and exact durable PASS marker",
		);

		seedNativeStore(
			advisorCwd,
			sourcesForScenario("plannedIdea").map((item) =>
				item.id === "IMP-1"
					? {
							...item,
							notes: "wo:slice-advisor PASS agents=work-advisor",
						}
					: item,
			),
		);
		advisorState = buildWorkResumeState(advisorCwd, "E-1");
		assert(
			advisorState.action === "run-implementation" &&
				directRoleHandoffParams(advisorState, advisorCwd)?.agent === "work-worker",
			"the exact durable advisor PASS releases implementation",
		);

		writeFileSync(
			path.join(advisorCwd, ".pi", "settings.json"),
			JSON.stringify({
				workOrchestrator: {
					profile: "high",
					advisorEnabled: {
						advisor: true,
						advisor2: true,
						advisor3: true,
					},
				},
			}),
		);
		seedNativeStore(advisorCwd, sourcesForScenario("plannedIdea"));
		advisorState = buildWorkResumeState(advisorCwd, "E-1");
		assert(
			advisorState.action === "advisor-gate-pending" &&
				advisorState.handoffPrompt.includes(
					"wo:slice-advisor PASS agents=work-advisor,work-advisor-2,work-advisor-3",
				),
			"high profile keeps all configured advisors pending before implementation",
		);
	} finally {
		rmSync(advisorCwd, { recursive: true, force: true });
	}

	setScenario("planning");
	state = buildWorkResumeState(cwd, "E-1");
	assert(
		state.action === "run-planner",
		"planning workItem selected when alone",
	);
	assert(state.selectedWorkItem.id === "PLAN-1", "planning workItem selected");

	setScenario("stalePlanning");
	state = buildWorkResumeState(cwd, "E-1");
	assert(
		state.action === "close-stale-planning",
		"stale planning stops for cleanup when no executable work is ready",
	);
	assert(
		state.counts.slices === 1,
		"planning work items are not counted as executable slices",
	);
	assert(
		state.counts.closed === 1,
		"closed executable slice count excludes planning work items",
	);
	assert(!state.handoffPrompt, "cleanup stop does not inject handoff");

	setScenario("stalePlanningReady");
	state = buildWorkResumeState(cwd, "E-1");
	assert(
		state.action === "run-implementation" &&
			directRoleHandoffParams(state, cwd)?.agent === "work-worker",
		"ready executable work proceeds in the worker despite stale planning cleanup",
	);
	assert(state.selectedWorkItem.id === "IMP-1", "ready implementation wins");

	setScenario("nestedPlanningReady");
	state = buildWorkResumeState(cwd, "E-1");
	assert(
		state.action === "run-implementation" &&
			state.selectedWorkItem.id === "IMP-NESTED",
		"resume discovers executable grandchildren below closed planning containers",
	);

	setScenario("inProgressSensitiveContract");
	state = buildWorkResumeState(cwd, "E-1");
	assert(
		state.action === "in-progress-agent" &&
			!state.selectedWorkItem.verificationReady,
		"verification requirements do not masquerade as passing evidence or launch review early",
	);

	setScenario("inProgressReviewFail");
	state = buildWorkResumeState(cwd, "E-1");
	assert(
		state.action === "run-fix" &&
			directRoleHandoffParams(state, cwd)?.agent === "work-fixer",
		"concrete review FAIL routes directly to exactly one fixer",
	);

	setScenario("inProgressFixReady");
	state = buildWorkResumeState(cwd, "E-1");
	const reviewerHandoff = directRoleHandoffParams(state, cwd);
	assert(
		state.action === "run-review" && reviewerHandoff?.agent === "work-reviewer",
		"verified fixer result routes directly to one scoped re-review",
	);
	const helper = `'${realpathSync(path.join(import.meta.dirname, "work-helper.mjs"))}'`;
	const reviewerRoot = `'${realpathSync(cwd)}'`;
	assert(
		reviewerHandoff.params.async === true &&
			reviewerHandoff.params.control?.needsAttentionAfterMs === 30_000,
		"reviewer launches asynchronously with a liveness watchdog",
	);
	assert(
		!reviewerHandoff.params.task.includes(".ce-workflow/work-items.json") &&
			!reviewerHandoff.params.task.includes(".pi-subagents/") &&
			!reviewerHandoff.params.task.includes(".pi/work-runs/") &&
			reviewerHandoff.params.task.includes("Work item: AUTH-1") &&
			reviewerHandoff.params.task.includes(
				`Execution repository: ${reviewerRoot}`,
			) &&
			reviewerHandoff.params.task.includes(
				`git -C ${reviewerRoot} rev-parse --show-toplevel`,
			) &&
			reviewerHandoff.params.task.includes(`Helper: ${helper}`) &&
			reviewerHandoff.params.task.includes(
				`Summary command (from execution repository): node ${helper} work-summary AUTH-1`,
			) &&
			reviewerHandoff.params.task.includes(
				'Review only: "extensions/work-models.js", "scripts/file with space.js"',
			) &&
			reviewerHandoff.params.task.includes("durable `wo:review PASS|FAIL` note") &&
			reviewerHandoff.params.task.includes(
				'work-note "AUTH-1" --append-notes "wo:review PASS',
			) &&
			reviewerHandoff.params.task.includes(
				'work-summary "AUTH-1" and confirm notes_tail',
			) &&
			reviewerHandoff.params.task.includes(
				"Do not use --body or shell redirection to nul/NUL",
			) &&
			reviewerHandoff.params.task.includes("at least 10 minutes") &&
			reviewerHandoff.params.task.includes(
				"needsAttentionAfterMs=30000 is an attention notification, not a hard timeout",
			),
		"direct reviewer launch carries the complete bounded handoff and liveness contract",
	);

	setScenario("inProgressFixReadyNoPaths");
	state = buildWorkResumeState(cwd, "E-1");
	assert(
		state.action === "review-scope-missing" &&
			!state.handoffPrompt &&
			directRoleHandoffParams(state, cwd) === null,
		"missing review paths stop before launching or handcrafting a reviewer",
	);

	setScenario("inProgressReviewPass");
	state = buildWorkResumeState(cwd, "E-1");
	assert(
		state.action === "finish-ready" && !state.handoffPrompt,
		"durable review PASS skips duplicate reviewer and writer agents",
	);

	setScenario("inProgressStaleReviewPass");
	state = buildWorkResumeState(cwd, "E-1");
	assert(
		state.action === "run-review",
		"a PASS before the latest review scope does not satisfy the new review",
	);

	setScenario("inProgressQuotedReviewPass");
	state = buildWorkResumeState(cwd, "E-1");
	assert(
		state.action === "run-fix",
		"review prose mentioning PASS does not override the anchored FAIL verdict",
	);

	setScenario("inProgressMechanicalFix");
	state = buildWorkResumeState(cwd, "E-1");
	assert(
		state.action === "finish-ready" &&
			state.selectedWorkItem.mechanicalFixAccepted &&
			!state.handoffPrompt,
		"verified mechanical fixes finish after one review without a redundant re-review",
	);

	setScenario("inProgressReviewCap");
	state = buildWorkResumeState(cwd, "E-1");
	assert(
		state.action === "review-blocked" && !state.handoffPrompt,
		"the review cap rejects incomplete residual-finding disposition",
	);

	setScenario("inProgressResidualFix");
	state = buildWorkResumeState(cwd, "E-1");
	assert(
		state.action === "finish-ready" &&
			state.selectedWorkItem.residualFixAccepted &&
			!state.handoffPrompt,
		"verified residual fixes after targeted re-review finish without a third reviewer",
	);

	setScenario("blocked");
	state = buildWorkResumeState(cwd, "E-1");
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

	setScenario("externalBlocked");
	state = buildWorkResumeState(cwd, "E-1");
	assert(
		state.suggestedCommands[0] === "/work-report HW-1",
		"blocked epic points at external hardware blocker before downstream debug",
	);

	setScenario("plannerGap");
	state = buildWorkResumeState(cwd, "E-1");
	assert(
		state.action === "run-planner",
		"empty unblocked epic launches planner handoff",
	);
	assert(
		state.handoffPrompt.includes("Target work item: none"),
		"planner gap has no selected workItem",
	);

	setScenario("open-ready");
	state = buildWorkResumeState(cwd, "last");
	assert(
		state.ok && state.epic.id === "O-1",
		"single open epic with ready work resolves when no in-progress epic exists",
	);
	assert(state.candidates === undefined, "ready open epic is not ambiguous");

	setScenario("remembered-blocked");
	state = buildWorkResumeState(cwd, "E-1");
	assert(state.ok && state.epic.id === "E-1", "explicit target is remembered");
	state = buildWorkResumeState(cwd, "last");
	assert(
		state.ok && state.epic.id === "E-1" && state.action === "report-blocked",
		"remembered blocked epic wins over unrelated ready open epics",
	);

	setScenario("open-two-ready");
	state = buildWorkResumeState(cwd, "O-1");
	assert(
		state.ok && state.epic.id === "O-1",
		"explicit open target refreshes remembered epic",
	);
	state = buildWorkResumeState(cwd, "last");
	assert(
		state.ok && state.epic.id === "O-1",
		"latest open epic with ready work wins when multiple open epics are ready",
	);

	setScenario("ambiguous");
	state = buildWorkResumeState(cwd, "last");
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

	setScenario();
	state = buildWorkResumeState(cwd, "BUG-1");
	assert(
		state.ok &&
			state.target.kind === "work-item" &&
			state.selectedWorkItem.id === "BUG-1" &&
			state.action === "run-debug",
		"an explicit executable child target stays scoped to that WorkItem",
	);

	state = buildWorkResumeState(
		cwd,
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

	state = buildWorkResumeState(cwd, "NOPE");
	assert(
		!state.ok && state.reason === "unknown-target",
		"unknown target is parseable",
	);

	setScenario("no-legacy");
	state = buildWorkResumeState(cwd, "last");
	assert(
		!state.ok && state.reason === "migration-required",
		"legacy work state requires migration",
	);

	setScenario("openDecision");
	state = buildWorkResumeState(cwd, "E-1");
	assert(
		state.action === "report-blocked",
		"open decision without ready work reports blocked",
	);
	assert(
		state.suggestedCommands[0] === "/work-report DEC-ONLY",
		"open decision suggests the decision report",
	);
	assert(!state.handoffPrompt, "open decision does not inject handoff");

	setScenario();
	process.env.WORK_RESUME_GIT_FAIL = "1";
	state = buildWorkResumeState(cwd, "E-1");
	assert(state.git.ok === false, "git failure is represented");
	assert(state.action === "dirty-stop", "git unavailable stops writer handoff");
	assert(
		state.warnings.includes("git status unavailable"),
		"git failure warning is preserved",
	);
	delete process.env.WORK_RESUME_GIT_FAIL;

	process.env.WORK_RESUME_GIT_DIRTY = "unknown";
	state = buildWorkResumeState(cwd, "E-1");
	assert(
		state.action === "dirty-stop",
		"unknown dirty file stops writer handoff",
	);
	assert(
		state.message.includes("extensions/work-models.js"),
		"dirty stop names true blocking files",
	);
	assert(!state.handoffPrompt, "dirty stop does not inject handoff");

	setScenario("inProgressVerifiedAgent");
	state = buildWorkResumeState(cwd, "E-1");
	assert(
		state.action === "run-review" &&
			state.selectedWorkItem.changedPaths.includes("extensions/work-models.js"),
		"verified detached-writer files may cross the dirty gate into scoped review",
	);
	process.env.WORK_RESUME_GIT_DIRTY = "formatter-expanded";
	state = buildWorkResumeState(cwd, "E-1");
	const formatterRepair = directRoleHandoffParams(state, cwd);
	assert(
		state.action === "run-repair" &&
			state.handoffReason.includes("post-dispatch numstat") &&
			formatterRepair?.agent === "work-worker" &&
			formatterRepair.params.task.includes("Repair formatter-expanded output now"),
		"settled formatter-expanded output routes one bounded repair before review",
	);
	process.env.WORK_RESUME_GIT_DIRTY = "formatter-expanded-staged";
	state = buildWorkResumeState(cwd, "E-1");
	assert(
		state.action === "run-repair",
		"formatter expansion includes staged changes against HEAD",
	);
	for (const scenario of ["formatter-semantic", "formatter-ratio"]) {
		process.env.WORK_RESUME_GIT_DIRTY = scenario;
		state = buildWorkResumeState(cwd, "E-1");
		assert(
			state.action === "run-review",
			`${scenario} stays on the semantic review path`,
		);
	}
	const leaseDir = path.join(cwd, ".ce-workflow", "work-runs", "direct");
	mkdirSync(leaseDir, { recursive: true });
	writeFileSync(
		path.join(leaseDir, "pending-direct.jsonl"),
		`${JSON.stringify({ version: 2, type: "lease", leaseId: "formatter-repair-1", workItemId: "IMP-BIG", action: "run-repair" })}\n`,
	);
	process.env.WORK_RESUME_GIT_DIRTY = "formatter-expanded";
	state = buildWorkResumeState(cwd, "E-1");
	assert(
		state.action === "run-review",
		"formatter expansion does not re-dispatch after one repair attempt",
	);
	setScenario("debug");

	process.env.WORK_RESUME_GIT_DIRTY = "workflow";
	state = buildWorkResumeState(cwd, "E-1");
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
	state = buildWorkResumeState(cwd, "E-1");
	assert(
		state.action === "run-debug",
		`benign instruction-file dirt allows handoff, got ${state.action}: ${state.message ?? ""}`,
	);
	assert(state.git.benignDirty, "benign dirt is represented in state");

	process.env.WORK_RESUME_GIT_DIRTY = "instruction-formatter";
	state = buildWorkResumeState(cwd, "E-1");
	assert(
		state.action === "run-debug",
		"formatter-only instruction-file dirt allows handoff",
	);
	assert(state.git.benignDirty, "formatter-only dirt is represented as benign");

	process.env.WORK_RESUME_GIT_DIRTY = "instruction-substantive";
	state = buildWorkResumeState(cwd, "E-1");
	assert(
		state.action === "dirty-stop",
		"substantive instruction-file dirt is not benign",
	);

	process.env.WORK_RESUME_GIT_DIRTY = "untracked-instruction";
	state = buildWorkResumeState(cwd, "E-1");
	assert(
		state.action === "dirty-stop",
		"untracked instruction-file dirt is not benign",
	);

	delete process.env.WORK_RESUME_GIT_DIRTY;
	state = buildWorkResumeState(cwd, "E-C");
	assert(state.action === "done-candidate", "closed epic does not launch work");
	assert(
		state.suggestedCommands.length === 0,
		"closed epic has no self-loop next command",
	);

	const sent = [];
	const notices = [];
	setScenario("plannedIdea");
	let tuiRpcRequest;
	const rpcListeners = new Map();
	const autonomousResult = await handleWorkResumeCommand(
		"E-1",
		{
			cwd: cwd,
			mode: "tui",
			ui: { notify: (message, level) => notices.push({ message, level }) },
			sendUserMessage: async () => {
				throw new Error("TUI must inject through Pi");
			},
		},
		{
			sendUserMessage: async (message, options) => sent.push({ message, options }),
			events: {
				on: (name, listener) => {
					rpcListeners.set(name, listener);
					return () => rpcListeners.delete(name);
				},
				emit: (_name, request) => {
					tuiRpcRequest = request;
					queueMicrotask(() =>
						rpcListeners.get(`subagents:rpc:v1:reply:${request.requestId}`)?.({
							success: true,
							data: { runId: "autonomous-run" },
						}),
					);
				},
			},
		},
	);
	assert(
		autonomousResult.autonomousGoalStarted &&
			autonomousResult.actionLease?.mode === "autonomous" &&
			sent.length === 1 &&
			sent[0].message.includes("Work-goal mode is active") &&
			sent[0].message.includes("Target work item or roadmap ID: E-1") &&
			sent[0].message.includes("Coded orchestration already launched") &&
			tuiRpcRequest?.method === "spawn",
		"TUI resume starts the visible autonomous root and its coded specialist",
	);

	setScenario();
	const selectionHandoff = directRoleHandoffParams(
		buildWorkResumeState(cwd, "E-1"),
		cwd,
		"the terminal is next to the probe",
	);
	assert(
		selectionHandoff.params.task.includes("the terminal is next to the probe"),
		"numbered-selection notes remain in specialist handoffs inside the loop",
	);
	const sentBeforeRepeat = sent.length;
	const repeated = await handleWorkResumeCommand(
		"E-1",
		{
			cwd: cwd,
			mode: "rpc",
			ui: { notify: (message, level) => notices.push({ message, level }) },
			sendUserMessage: async (message, options) => sent.push({ message, options }),
		},
		{ events: { on: () => () => {}, emit: () => {} } },
	);
	assert(
		!repeated.autonomousGoalStarted && sent.length === sentBeforeRepeat,
		"repeating Resume for the owned target does not launch a duplicate loop",
	);

	setScenario();
	const sentBeforeNumberedResume = sent.length;
	assert(
		await executeNumberedWorkAction(
			"/work-resume E-1",
			{
				cwd: cwd,
				mode: "tui",
				ui: { notify: (message, level) => notices.push({ message, level }) },
			},
			{
				sendUserMessage: async (message, options) =>
					sent.push({ message, options }),
			},
			"the terminal is next to the probe",
		),
		"numbered /work-resume action executes",
	);
	assert(
		sent.length === sentBeforeNumberedResume,
		"numbered Resume reuses the active autonomous loop",
	);

	setScenario("blocked");
	sent.length = 0;
	await handleWorkResumeCommand("E-1", {
		cwd: cwd,
		ui: { notify: (message, level) => notices.push({ message, level }) },
		sendUserMessage: async (message, options) => sent.push({ message, options }),
	});
	assert(sent.length === 0, "blocked handler does not inject follow-up");
	assert(
		notices.at(-1)?.message.includes("DEC-1") &&
			notices.at(-1)?.message.includes("Blocked:"),
		"blocked resume output includes the compact blocker ledger",
	);

	setScenario("externalBlocked");
	await handleWorkResumeCommand("E-1", {
		cwd: cwd,
		ui: { notify: (message, level) => notices.push({ message, level }) },
		sendUserMessage: async (message, options) => sent.push({ message, options }),
	});
	assert(
		notices.at(-1)?.message.includes("Required action:") &&
			notices.at(-1)?.message.includes("reconnect COM7"),
		"blocked resume output includes blocker next action",
	);

	// Coded inline plans remain direct implementation handoffs across profiles.
	setScenario("implementation");
	for (const profile of ["low", "medium", "high"]) {
		const profileCwd = mkdtempSync(path.join(tmpdir(), "work-resume-agent-"));
		mkdirSync(path.join(profileCwd, ".pi"), { recursive: true });
		writeFileSync(
			path.join(profileCwd, ".pi", "settings.json"),
			JSON.stringify({
				workOrchestrator: { profile, sliceExecutionMode: "inline" },
			}),
		);
		seedNativeStore(profileCwd, sourcesForScenario("implementation"));
		const profileState = buildWorkResumeState(profileCwd, "E-1");
		assert(
			profileState.action === "run-implementation" &&
				directRoleHandoffParams(profileState, profileCwd)?.agent === "work-worker",
			`${profile} routes coded inline plans directly to work-worker`,
		);
		rmSync(profileCwd, { recursive: true, force: true });
	}

	const maxCwd = mkdtempSync(path.join(tmpdir(), "work-resume-ce-"));
	mkdirSync(path.join(maxCwd, ".pi"), { recursive: true });
	writeFileSync(
		path.join(maxCwd, ".pi", "settings.json"),
		JSON.stringify({ workOrchestrator: { profile: "max" } }),
	);
	seedNativeStore(maxCwd, sourcesForScenario("implementation"));
	const maxState = buildWorkResumeState(maxCwd, "E-1");
	assert(
		maxState.action === "run-implementation" &&
			directRoleHandoffParams(maxState, maxCwd)?.agent === "work-worker",
		"max routes a coded inline plan directly to work-worker",
	);
	rmSync(maxCwd, { recursive: true, force: true });

	const miscCwd = mkdtempSync(path.join(tmpdir(), "work-resume-misc-"));
	seedNativeStore(miscCwd, [
		{
			id: "MISC-1",
			issue_type: "epic",
			status: "open",
			title: "Misc",
			labels: ["wo:misc"],
		},
		{
			id: "MISC-1.1",
			parent_id: "MISC-1",
			issue_type: "task",
			status: "open",
			title: "Ready miscellaneous work",
		},
	]);
	let miscState = buildWorkResumeState(miscCwd);
	assert(
		miscState.epic.id === "MISC-1" &&
			miscState.selectedWorkItem.id === "MISC-1.1",
		"untargeted resume falls back to ready Misc work",
	);
	seedNativeStore(miscCwd, [
		{
			id: "MISC-1",
			issue_type: "epic",
			status: "open",
			title: "Misc",
			labels: ["wo:misc"],
		},
	]);
	miscState = buildWorkResumeState(miscCwd);
	assert(
		miscState.action === "misc-idle",
		"empty Misc stays idle instead of launching a planner",
	);
	rmSync(miscCwd, { recursive: true, force: true });

	const triageCwd = mkdtempSync(path.join(tmpdir(), "work-resume-triage-"));
	mkdirSync(path.join(triageCwd, ".pi"), { recursive: true });
	writeFileSync(
		path.join(triageCwd, ".pi", "settings.json"),
		JSON.stringify({ workOrchestrator: { profile: "low" } }),
	);
	seedNativeStore(triageCwd, sourcesForScenario("implementation"));
	initVerifierStore(triageCwd);
	const triageCheckpoint = {
		repository: triageCwd,
		base: "a".repeat(40),
		snapshot: "b".repeat(40),
		paths: ["extensions/work-models.js"],
		patchHash: "c".repeat(64),
	};
	mutateVerifierStore(triageCwd, (store) =>
		createBatch(store, {
			checkpoint: triageCheckpoint,
			profiles: [
				{
					model: "openai/gpt-5",
					operations: ["correctness"],
					thinking: "low",
				},
			],
		}),
	);
	const triageJob = Object.values(loadVerifierStore(triageCwd).jobs)[0];
	const triageReport = mutateVerifierStore(triageCwd, (store) =>
		recordOperationResult(store, {
			jobId: triageJob.id,
			operation: "correctness",
			outcome: "findings",
		}),
	);
	const triageFinding = mutateVerifierStore(triageCwd, (store) =>
		addFinding(store, {
			reportId: triageReport.id,
			operation: "correctness",
			model: triageJob.model,
			checkpoint: triageCheckpoint,
			path: "extensions/work-models.js",
			startLine: 1,
			endLine: 1,
			category: "correctness",
			severity: "high",
			rationale: "reproduced issue",
			evidence: "line 1",
			suggestedAction: "fix line 1",
		}),
	);
	mutateVerifierStore(triageCwd, (store) =>
		addGroup(store, { findingIds: [triageFinding.id] }),
	);
	const triageState = buildWorkResumeState(triageCwd, "E-1", {
		ownerSession: "resume-test",
	});
	assert(
		triageState.action === "triage-required" &&
			triageState.handoffPrompt.includes(triageFinding.id),
		"completed verifier findings block writer routing at resume",
	);
	assert(
		buildWorkResumeState(triageCwd, "E-1").action === "run-implementation",
		"pure resume-state reads do not steal or enforce a triage lease",
	);
	const triageNotices = [];
	const triageMessages = [];
	const handledTriage = await handleWorkResumeCommand(
		"E-1",
		{
			cwd: triageCwd,
			mode: "tui",
			sessionManager: { getSessionId: () => "resume-test" },
			ui: {
				notify: (message, level) => triageNotices.push({ message, level }),
			},
			sendUserMessage: async (message, options) =>
				triageMessages.push({ message, options }),
		},
		{},
	);
	assert(
		handledTriage.action === "triage-required",
		"exact-target Resume returns the triage gate",
	);
	assert(
		triageNotices.some((notice) =>
			notice.message.includes(
				`Verifier triage:\n- ${triageState.triage[0].claim.id}`,
			),
		),
		"exact-target Resume renders triage payload without roadmap fields",
	);
	assert(
		triageMessages.length === 1 &&
			triageMessages[0].message.includes(triageFinding.id) &&
			handledTriage.autonomousGoalStarted === undefined,
		"triage uses its coded handoff without autonomous fallback",
	);
	const goalPrompts = [];
	const goalStatuses = {};
	const goalCtx = {
		cwd: triageCwd,
		mode: "tui",
		getContextUsage: () => ({ tokens: 0, maxTokens: 100_000 }),
		ui: {
			confirm: async () => true,
			notify: () => {},
			setStatus: (key, value) => {
				goalStatuses[key] = value;
			},
		},
	};
	const goalPi = {
		appendEntry: () => {},
		sendUserMessage: async (message) => goalPrompts.push(message),
	};
	const autonomousResume = await executeOrchestratorAction(
		"work-resume-goal",
		"E-1",
		goalCtx,
		goalPi,
	);
	assert(
		autonomousResume.mode === "project",
		"programmatic roadmap resume starts a project goal",
	);
	assert(
		goalStatuses["work-goal"]?.startsWith("active #0"),
		"programmatic roadmap resume activates durable goal status",
	);
	assert(
		goalPrompts.length === 1 && goalPrompts[0].includes("E-1"),
		"programmatic roadmap resume sends the autonomous kickoff",
	);
	await executeOrchestratorAction("work-goal", "clear", goalCtx, goalPi);
	const analysisBatch = mutateVerifierStore(triageCwd, (store) =>
		createBatch(store, {
			checkpoint: triageCheckpoint,
			purpose: "analysis",
			profiles: [
				{ model: "openai/gpt-5", operations: ["correctness"], thinking: "low" },
			],
		}),
	);
	const analysisJob = Object.values(loadVerifierStore(triageCwd).jobs).find(
		(job) => job.batchId === analysisBatch.id,
	);
	const analysisReport = mutateVerifierStore(triageCwd, (store) =>
		recordOperationResult(store, {
			jobId: analysisJob.id,
			operation: "correctness",
			outcome: "findings",
		}),
	);
	const analysisFinding = mutateVerifierStore(triageCwd, (store) =>
		addFinding(store, {
			reportId: analysisReport.id,
			operation: "correctness",
			model: analysisJob.model,
			checkpoint: triageCheckpoint,
			path: "extensions/work-models.js",
			startLine: 2,
			endLine: 2,
			category: "correctness",
			severity: "medium",
			rationale: "analysis decision",
			evidence: "line 2",
			suggestedAction: "review line 2",
		}),
	);
	mutateVerifierStore(triageCwd, (store) =>
		ingestAnalysisReview(store, {
			batchId: analysisBatch.id,
			candidates: [
				{
					sourceFindingId: analysisFinding.id,
					verdict: "accepted",
					title: "Review explicit target",
					rationale: "analysis decision",
					evidence: "line 2",
					recommendation: "review first",
					decisionKey: "resume-precedence",
				},
			],
		}),
	);
	const analysisState = buildWorkResumeState(triageCwd, "IMP-1");
	assert(
		analysisState.action === "review-analysis-required",
		"Review analysis blocks even an explicit Resume target",
	);
	const analysisNotices = [];
	const messagesBeforeAnalysis = triageMessages.length;
	const handledAnalysis = await handleWorkResumeCommand(
		"IMP-1",
		{
			cwd: triageCwd,
			mode: "tui",
			sessionManager: { getSessionId: () => "resume-test" },
			ui: {
				notify: (message, level) => analysisNotices.push({ message, level }),
			},
			sendUserMessage: async (message, options) =>
				triageMessages.push({ message, options }),
		},
		{},
	);
	assert(
		handledAnalysis.action === "review-analysis-required",
		"exact-target Resume returns the analysis-review gate",
	);
	assert(
		analysisNotices.some(
			(notice) =>
				notice.message.includes("Action: review analysis required") &&
				notice.message.includes(analysisState.review[0].id) &&
				notice.message.includes("Open F7 → Review analysis"),
		),
		"exact-target Resume renders analysis payload and recommended action",
	);
	assert(
		triageMessages.length === messagesBeforeAnalysis,
		"analysis review stops without an autonomous or ordinary-model fallback",
	);
	rmSync(triageCwd, { recursive: true, force: true });

	const legacyCwd = mkdtempSync(
		path.join(tmpdir(), "work-resume-legacy-analysis-"),
	);
	seedNativeStore(legacyCwd, [
		...sourcesForScenario("implementation"),
		{
			id: "LEGACY-1",
			issue_type: "task",
			status: "in_progress",
			title: "Legacy analysis underway",
			labels: ["wo:analysis"],
		},
	]);
	initVerifierStore(legacyCwd);
	const legacyState = buildWorkResumeState(legacyCwd, "IMP-1", {
		ownerSession: "resume-test",
	});
	assert(
		legacyState.action === "review-analysis-required" &&
			legacyState.review[0].state === "migration_blocked",
		"in-progress legacy analysis is a durable Resume blocker",
	);
	rmSync(legacyCwd, { recursive: true, force: true });

	const orphanTriageCwd = mkdtempSync(
		path.join(tmpdir(), "work-resume-orphan-triage-"),
	);
	seedNativeStore(orphanTriageCwd, []);
	initVerifierStore(orphanTriageCwd);
	mutateVerifierStore(orphanTriageCwd, (store) =>
		createBatch(store, {
			checkpoint: triageCheckpoint,
			profiles: [
				{
					model: "openai/gpt-5",
					operations: ["correctness"],
					thinking: "low",
				},
				{
					model: "anthropic/claude-opus-5",
					operations: ["security"],
					thinking: "low",
				},
			],
		}),
	);
	const orphanJobs = Object.values(loadVerifierStore(orphanTriageCwd).jobs);
	const orphanJob = orphanJobs.find((job) => job.model === "openai/gpt-5");
	const orphanReport = mutateVerifierStore(orphanTriageCwd, (store) =>
		recordOperationResult(store, {
			jobId: orphanJob.id,
			operation: "correctness",
			outcome: "findings",
		}),
	);
	const orphanFinding = mutateVerifierStore(orphanTriageCwd, (store) =>
		addFinding(store, {
			reportId: orphanReport.id,
			operation: "correctness",
			model: orphanJob.model,
			checkpoint: triageCheckpoint,
			path: "extensions/work-models.js",
			startLine: 1,
			endLine: 1,
			category: "correctness",
			severity: "high",
			rationale: "reproduced issue",
			evidence: "line 1",
			suggestedAction: "fix line 1",
		}),
	);
	mutateVerifierStore(orphanTriageCwd, (store) =>
		addGroup(store, { findingIds: [orphanFinding.id] }),
	);
	const secondOrphanFinding = mutateVerifierStore(orphanTriageCwd, (store) =>
		addFinding(store, {
			reportId: orphanReport.id,
			operation: "correctness",
			model: orphanJob.model,
			checkpoint: triageCheckpoint,
			path: "extensions/work-models.js",
			startLine: 2,
			endLine: 2,
			category: "maintainability",
			severity: "medium",
			rationale: "second reproduced issue",
			evidence: "line 2",
			suggestedAction: "fix line 2",
		}),
	);
	mutateVerifierStore(orphanTriageCwd, (store) =>
		addGroup(store, { findingIds: [secondOrphanFinding.id] }),
	);
	mutateVerifierStore(orphanTriageCwd, (store) =>
		recordOperationResult(store, {
			jobId: orphanJobs.find((job) => job.model === "anthropic/claude-opus-5").id,
			operation: "security",
			outcome: "failed",
			failure: "provider unavailable",
		}),
	);
	const orphanTriageState = buildWorkResumeState(orphanTriageCwd, "", {
		ownerSession: "orphan-resume-test",
	});
	const orphanTriageStore = loadVerifierStore(orphanTriageCwd);
	const orphanClaim = Object.values(orphanTriageStore.claims)[0];
	assert(
		orphanTriageState.action === "triage-required" && orphanClaim.resumeTarget,
		"verifier triage without a roadmap creates and claims Misc",
	);
	assert(
		orphanTriageState.triage.length === 1 &&
			Object.keys(orphanTriageStore.claims).length === 1,
		"resume presents one verifier group at a time for bounded triage",
	);
	assert(
		Object.values(
			JSON.parse(
				readFileSync(
					path.join(orphanTriageCwd, ".ce-workflow", "work-items.json"),
					"utf8",
				),
			).items,
		).some(
			(item) =>
				item.id === orphanClaim.resumeTarget && item.labels?.includes("wo:misc"),
		),
		"orphan triage claim targets the generated Misc roadmap",
	);
	rmSync(orphanTriageCwd, { recursive: true, force: true });
} finally {
	if (oldEnv.agentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = oldEnv.agentDir;
	if (oldEnv.git === undefined) delete process.env.WORK_ORCH_GIT_BIN;
	else process.env.WORK_ORCH_GIT_BIN = oldEnv.git;
	if (oldEnv.scenario === undefined) delete process.env.WORK_RESUME_SCENARIO;
	else process.env.WORK_RESUME_SCENARIO = oldEnv.scenario;
	if (oldEnv.dirty === undefined) delete process.env.WORK_RESUME_GIT_DIRTY;
	else process.env.WORK_RESUME_GIT_DIRTY = oldEnv.dirty;
	if (oldEnv.gitFail === undefined) delete process.env.WORK_RESUME_GIT_FAIL;
	else process.env.WORK_RESUME_GIT_FAIL = oldEnv.gitFail;
	rmSync(bin, { recursive: true, force: true });
	rmSync(cwd, { recursive: true, force: true });
	rmSync(globalDir, { recursive: true, force: true });
}

console.log("ok - coded work-resume behavior");
