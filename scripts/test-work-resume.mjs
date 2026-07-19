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
import { seedNativeStore } from "./work-command-fixture.mjs";

const {
	buildWorkResumeState,
	directRoleHandoffParams,
	executeNumberedWorkAction,
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
	inProgressReviewCap: [
		{
			id: "AUTH-1",
			parent_id: "E-1",
			issue_type: "task",
			status: "in_progress",
			title: "Update authentication permission checks",
			notes:
				"wo:execution-agent\nwo:verify-check PASS\nwo:review FAIL - one\nwo:fix PASS\nwo:review FAIL - two",
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
  if (dirty === "unknown" || dirty === "instruction-substantive") process.exit(1);
  if (dirty === "instruction-formatter" && !args.includes("--ignore-blank-lines")) {
    console.log(["diff --git a/AGENTS.md b/AGENTS.md", "--- a/AGENTS.md", "+++ b/AGENTS.md", "@@ -1 +1 @@", "-See https://example.com/docs for details.", "+See <https://example.com/docs> for details."].join("\\n"));
    process.exit(0);
  }
  if (dirty === "benign" && !args.includes("--ignore-blank-lines")) process.exit(1);
  process.exit(0);
}
function printDirty() {
  if (dirty === "unknown") console.log(" M extensions/work-models.js");
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
					: [
							...childrenByScenario.openReady,
							...childrenByScenario.openBlocked,
						];
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
		state.action === "run-implementation" && state.inlineWork,
		"unplanned implementation gets a coded slice plan and continues inline",
	);
	assert(
		state.selectedWorkItem.id === "IMP-1",
		"implementation workItem selected",
	);
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
	assert(
		!state.selectedWorkItem,
		"idea record is never selected as a workItem",
	);

	setScenario("plannedIdea");
	state = buildWorkResumeState(cwd, "E-1");
	assert(
		state.action === "run-implementation" && state.inlineWork,
		"planned idea selects linked executable child inline",
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
		state.action === "run-implementation" && state.inlineWork,
		"ready executable work proceeds inline despite stale planning cleanup",
	);
	assert(state.selectedWorkItem.id === "IMP-1", "ready implementation wins");

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
	const helper = JSON.stringify(
		realpathSync(path.join(import.meta.dirname, "work-helper.mjs")),
	);
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
			reviewerHandoff.params.task.includes(`Helper: ${helper}`) &&
			reviewerHandoff.params.task.includes(
				`Summary command: node ${helper} work-summary AUTH-1`,
			) &&
			reviewerHandoff.params.task.includes(
				'Review only: "extensions/work-models.js", "scripts/file with space.js"',
			) &&
			reviewerHandoff.params.task.includes(
				"durable `wo:review PASS|FAIL` note",
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

	setScenario("inProgressReviewCap");
	state = buildWorkResumeState(cwd, "E-1");
	assert(
		state.action === "review-blocked" && !state.handoffPrompt,
		"one initial review plus one re-review is the hard coded limit",
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
		!state.ok && state.reason === "unsupported-target",
		"explicit child target is rejected instead of silently replanned",
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
	await handleWorkResumeCommand("E-1", {
		cwd: cwd,
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
			cwd: cwd,
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

	setScenario();
	let rpcReply;
	let rpcRequest;
	const rpcPi = {
		events: {
			on: (_name, reply) => {
				rpcReply = reply;
				return () => {};
			},
			emit: (_name, request) => {
				rpcRequest = request;
				queueMicrotask(() => rpcReply({ success: true, data: {} }));
			},
		},
	};
	const directResult = await handleWorkResumeCommand(
		"E-1",
		{
			cwd: cwd,
			ui: { notify: (message, level) => notices.push({ message, level }) },
			sendUserMessage: async (message, options) =>
				sent.push({ message, options }),
		},
		rpcPi,
		"the terminal is next to the probe",
	);
	assert(
		rpcRequest?.params?.task?.includes("the terminal is next to the probe"),
		"numbered-selection notes reach direct role handoffs",
	);
	assert(
		directResult.directHandoff?.agent === "work-debugger" &&
			directResult.handoffClaimed,
		"live resume directly launches and claims the exact specialist without a duplicate-writer window",
	);

	setScenario();
	rpcRequest = undefined;
	const sentBeforeNumberedResume = sent.length;
	assert(
		await executeNumberedWorkAction(
			"/work-resume E-1",
			{
				cwd: cwd,
				ui: { notify: (message, level) => notices.push({ message, level }) },
				sendUserMessage: async (message, options) =>
					sent.push({ message, options }),
			},
			rpcPi,
			"the terminal is next to the probe",
		),
		"numbered /work-resume action executes",
	);
	assert(
		rpcRequest?.params?.task?.includes("the terminal is next to the probe"),
		"numbered /work-resume keeps the note on the coded direct handoff",
	);
	assert(
		sent.length === sentBeforeNumberedResume,
		"numbered /work-resume does not start an autonomous work-goal prompt",
	);

	setScenario("blocked");
	sent.length = 0;
	await handleWorkResumeCommand("E-1", {
		cwd: cwd,
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

	setScenario("externalBlocked");
	await handleWorkResumeCommand("E-1", {
		cwd: cwd,
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
	setScenario("implementation");
	for (const profile of ["low", "medium", "high"]) {
		const inlineCwd = mkdtempSync(path.join(tmpdir(), "work-resume-inline-"));
		mkdirSync(path.join(inlineCwd, ".pi"), { recursive: true });
		writeFileSync(
			path.join(inlineCwd, ".pi", "settings.json"),
			JSON.stringify({ workOrchestrator: { profile } }),
		);
		seedNativeStore(inlineCwd, sourcesForScenario("implementation"));
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
	seedNativeStore(maxCwd, sourcesForScenario("implementation"));
	const maxState = buildWorkResumeState(maxCwd, "E-1");
	assert(
		maxState.action === "run-implementation" && maxState.inlineWork,
		"max still skips a planner boundary for simple slices",
	);
	rmSync(maxCwd, { recursive: true, force: true });
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
