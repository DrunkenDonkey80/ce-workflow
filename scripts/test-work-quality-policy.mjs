#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	acknowledgeWorkActionLease,
	acquireWorkActionLease,
} from "../extensions/work-action-leases.js";
import {
	buildWorkResumeState,
	driveWorkActionLeases,
} from "../extensions/work-models.js";
import {
	loadVerifierStore,
	scheduleVerifierBatch,
} from "../extensions/background-verifiers.js";
import {
	createWorkItem,
	initStore,
	loadStore,
	mutateStore,
	saveStore,
	updateWorkItem,
} from "../extensions/work-store.js";

function assert(value, message) {
	if (!value) throw new Error(message);
}
function git(cwd, ...args) {
	return execFileSync("git", args, {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	}).trim();
}
function fixture(name, changedFile = "src/a.js") {
	const cwd = mkdtempSync(path.join(tmpdir(), `work-quality-${name}-`));
	git(cwd, "init", "-q");
	git(cwd, "config", "user.email", "fixture@example.invalid");
	git(cwd, "config", "user.name", "Fixture");
	mkdirSync(path.join(cwd, path.dirname(changedFile)), { recursive: true });
	writeFileSync(path.join(cwd, changedFile), "export const value = 1;\n");
	writeFileSync(
		path.join(cwd, ".gitignore"),
		".pi/\n.ce-workflow/work-runs/\n.pi-subagents/\n",
	);
	const store = initStore(cwd);
	createWorkItem(store, {
		id: "E-1",
		type: "epic",
		status: "in_progress",
		title: "Quality roadmap",
	});
	createWorkItem(store, {
		id: "W-1",
		type: "task",
		status: "in_progress",
		parentId: "E-1",
		title: "Narrow verified change",
		acceptance: "focused check passes",
		notes: [`Files changed: ${changedFile}\nwo:verify-check PASS`],
	});
	saveStore(cwd, store);
	git(cwd, "add", ".gitignore", changedFile, ".ce-workflow/work-items.json");
	git(cwd, "commit", "-qm", "fixture");
	writeFileSync(path.join(cwd, changedFile), "export const value = 2;\n");
	return cwd;
}
function settings(cwd, reviewPolicy) {
	mkdirSync(path.join(cwd, ".pi"), { recursive: true });
	writeFileSync(
		path.join(cwd, ".pi", "settings.json"),
		JSON.stringify({ workOrchestrator: { reviewPolicy } }),
	);
}
function acknowledgedVerifierPi() {
	const listeners = new Set();
	return {
		events: {
			on: (_event, listener) => {
				listeners.add(listener);
				return () => listeners.delete(listener);
			},
			emit: (_event, request) =>
				queueMicrotask(() => {
					for (const listener of listeners)
						listener({
							success: true,
							data: { runId: `verifier-${request.requestId}` },
						});
				}),
		},
	};
}

const globalDir = mkdtempSync(path.join(tmpdir(), "work-quality-global-"));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = globalDir;
const roots = [];
try {
	let cwd = fixture("migration");
	roots.push(cwd);
	assert(
		buildWorkResumeState(cwd, "E-1").action === "finish-ready",
		"missing legacy setting migrates to risk-based narrow-diff behavior",
	);
	writeFileSync(
		path.join(globalDir, "settings.json"),
		JSON.stringify({ workOrchestrator: { reviewPolicy: "review-all" } }),
	);
	assert(
		buildWorkResumeState(cwd, "E-1").action === "run-review",
		"global Review All admits a narrow production diff",
	);
	settings(cwd, "risk-based");
	assert(
		buildWorkResumeState(cwd, "E-1").action === "finish-ready",
		"project risk-based override wins over global Review All",
	);
	settings(cwd, "review-all");
	assert(
		buildWorkResumeState(cwd, "E-1").action === "run-review",
		"project Review All is enforced",
	);

	cwd = fixture("tests-only", "tests/a.test.js");
	roots.push(cwd);
	settings(cwd, "review-all");
	assert(
		buildWorkResumeState(cwd, "E-1").action === "finish-ready",
		"Review All preserves current test-only handling",
	);

	for (const mode of ["tui", "rpc", "autonomous"]) {
		cwd = fixture(`finish-${mode}`);
		roots.push(cwd);
		mutateStore(cwd, (store) =>
			updateWorkItem(store, "W-1", {
				notes: [
					"Files changed: src/a.js\nwo:verify-check PASS\nwo:review PASS independent",
				],
			}),
		);
		const statusDir = path.join(cwd, ".pi-subagents", "review");
		mkdirSync(statusDir, { recursive: true });
		writeFileSync(
			path.join(statusDir, "status.json"),
			JSON.stringify({ state: "completed", steps: [{ status: "completed" }] }),
		);
		const lease = acquireWorkActionLease(cwd, {
			workflowRunId: `${mode}-finish`,
			roadmapId: "E-1",
			workItemId: "W-1",
			action: "run-review",
			semanticRole: "reviewer",
			mode,
			session: "same-session",
		});
		acknowledgeWorkActionLease(cwd, lease.leaseId, {
			runId: `${mode}-review`,
			asyncDir: statusDir,
		});
		let finishes = 0;
		let verifierBatch;
		const result = await driveWorkActionLeases(cwd, {
			mode,
			pi: mode === "autonomous" ? acknowledgedVerifierPi() : undefined,
			session: "same-session",
			goalStatus: () => "active",
			targetId: mode === "autonomous" ? "W-1" : undefined,
			executeFinish: async (state) => {
				finishes += 1;
				mutateStore(cwd, (store) =>
					updateWorkItem(store, "W-1", { status: "closed" }),
				);
				git(cwd, "add", "src/a.js", ".ce-workflow/work-items.json");
				git(cwd, "commit", "-qm", "finish fixture");
				const verifier = scheduleVerifierBatch(cwd, {
					profiles: [
						{
							model: "openai/gpt-5",
							operations: ["correctness"],
							thinking: "low",
						},
					],
					paths: ["src/a.js"],
					scope: "commit",
				});
				verifierBatch = verifier.batch?.id;
				return {
					...state,
					ok: true,
					action: "finish-committed",
					verifier,
				};
			},
		});
		assert(
			finishes === (mode === "autonomous" ? 1 : 0),
			`${mode}: only active autonomous mode crosses the fake coded-finish boundary (${JSON.stringify({ finishes, result })})`,
		);
		assert(
			result.length === 1 &&
				(mode !== "autonomous" || result[0].action === "done-candidate"),
			`${mode}: settlement rebuilds at most one deterministic resume state (${JSON.stringify(result)})`,
		);
		if (mode === "autonomous") {
			assert(
				loadStore(cwd).items["E-1"].status === "in_progress",
				"an explicit task target stops without closing or advancing its roadmap",
			);
			const verifierJobs = Object.values(loadVerifierStore(cwd).jobs).filter(
				(job) => job.batchId === verifierBatch,
			);
			assert(
				verifierJobs.length === 1 &&
					verifierJobs.every(
						(job) => job.status === "running" && job.launch.status === "running",
					),
				"autonomous coded finish launches its queued parallel verifier batch",
			);
		}
	}

	for (const [name, runtime] of [
		["stop safely", { stopSafely: true }],
		["stopped goal", { goalStatus: () => "stopped" }],
		["paused goal", { goalStatus: () => "paused" }],
		["usage-limited goal", { goalStatus: () => "waiting_usage_limit" }],
		["cancellation", { cancelled: true }],
		["interruption", { interrupted: true }],
		["pending decision", { pendingDecision: true }],
		["verifier triage", { verifierTriagePending: true }],
		["session change", { currentSession: () => "other-session" }],
	]) {
		cwd = fixture(`fence-${String(name).replaceAll(" ", "-")}`);
		roots.push(cwd);
		mutateStore(cwd, (store) =>
			updateWorkItem(store, "W-1", {
				notes: [
					"Files changed: src/a.js\nwo:verify-check PASS\nwo:review PASS independent",
				],
			}),
		);
		const statusDir = path.join(cwd, ".pi-subagents", "review");
		mkdirSync(statusDir, { recursive: true });
		writeFileSync(path.join(statusDir, "status.json"), '{"state":"completed"}');
		const lease = acquireWorkActionLease(cwd, {
			workflowRunId: `fence-${name}`,
			roadmapId: "E-1",
			workItemId: "W-1",
			action: "run-review",
			semanticRole: "reviewer",
			mode: "autonomous",
			session: "same-session",
		});
		acknowledgeWorkActionLease(cwd, lease.leaseId, {
			runId: `fence-${name}`,
			asyncDir: statusDir,
		});
		let finishes = 0;
		await driveWorkActionLeases(cwd, {
			session: "same-session",
			goalStatus: () => "active",
			executeFinish: () => {
				finishes += 1;
			},
			...runtime,
		});
		assert(finishes === 0, `${name} fences autonomous finalization`);
	}

	cwd = fixture("direct-helper");
	roots.push(cwd);
	settings(cwd, "review-all");
	const helper = path.join(import.meta.dirname, "work-helper.mjs");
	const fakeGit = path.join(cwd, ".pi", "fake-git.mjs");
	const finishLog = path.join(cwd, ".pi", "finish-boundary.log");
	writeFileSync(
		fakeGit,
		`import { appendFileSync } from "node:fs";\nimport { spawnSync } from "node:child_process";\nconst args=process.argv.slice(2);\nif(args[0]==="commit"){appendFileSync(${JSON.stringify(finishLog)},"commit\\n");process.stderr.write("fake finish boundary\\n");process.exit(1)}\nconst r=spawnSync("git",args,{encoding:"utf8"});process.stdout.write(r.stdout??"");process.stderr.write(r.stderr??"");process.exit(r.status??1);\n`,
	);
	const helperArgs = [
		helper,
		"finish-task",
		"W-1",
		"--max-files",
		"2",
		"--message",
		"quality fixture",
		"--verify",
		"node -e \"process.stdout.write('ok')\"",
		"--expect",
		"ok",
	];
	const runHelper = () =>
		spawnSync(process.execPath, helperArgs, {
			cwd,
			encoding: "utf8",
			env: { ...process.env, WORK_ORCH_GIT_BIN: fakeGit },
		});
	let helperRun = runHelper();
	assert(
		helperRun.status !== 0 &&
			`${helperRun.stdout}${helperRun.stderr}`.includes("Review All policy") &&
			!readFileSync(finishLog, { encoding: "utf8", flag: "a+" }),
		`direct helper stops Review All production work before the finish boundary (${JSON.stringify({ status: helperRun.status, stdout: helperRun.stdout, stderr: helperRun.stderr })})`,
	);
	mutateStore(cwd, (store) =>
		updateWorkItem(store, "W-1", {
			notes: [...store.items["W-1"].notes, "wo:review PASS independent"],
		}),
	);
	helperRun = runHelper();
	assert(
		helperRun.status !== 0 &&
			readFileSync(finishLog, "utf8").trim().split(/\r?\n/).length === 1 &&
			git(cwd, "log", "-1", "--pretty=%s") === "fixture",
		"accepted direct-helper evidence is reused and reaches the fake finish boundary exactly once without a real commit",
	);

	process.stdout.write(
		"ok - native quality policy and autonomous finish fixtures\n",
	);
} finally {
	for (const cwd of roots) rmSync(cwd, { recursive: true, force: true });
	rmSync(globalDir, { recursive: true, force: true });
	if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
}
