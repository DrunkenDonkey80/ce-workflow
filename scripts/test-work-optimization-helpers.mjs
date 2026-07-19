#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import {
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
import {
	createWorkItem,
	initStore,
	loadStore,
	saveStore,
} from "../extensions/work-store.js";

const mod = await import(
	pathToFileURL(path.join(import.meta.dirname, "../extensions/work-models.js"))
		.href
);

function assert(ok, message) {
	if (!ok) throw new Error(message);
}

const cwd = mkdtempSync(path.join(tmpdir(), "work-opt-"));
try {
	execFileSync("git", ["init"], { cwd, stdio: "ignore" });
	const issue = {
		id: "TASK-123",
		title: "Huge task",
		status: "open",
		issue_type: "task",
		labels: ["wo"],
		parent_id: "E-1",
		notes: `start ${"x".repeat(3000)} tail`,
		acceptance: "must pass",
		dependencies: [{ depends_on_id: "DEP-1" }],
	};
	const summary = mod.compactTaskSummary(issue, { notesTail: 20 });
	assert(
		summary.notes_tail === `${"x".repeat(15)} tail`,
		"task summary caps notes tail",
	);
	assert(
		summary.dependencies[0].id === "DEP-1",
		"task summary includes dependency ids",
	);

	const store = initStore(cwd);
	createWorkItem(store, {
		id: "E-1",
		type: "epic",
		status: "in_progress",
		title: "Epic",
	});
	createWorkItem(store, {
		id: "DEP-1",
		type: "task",
		status: "closed",
		title: "Dependency",
		parentId: "E-1",
	});
	createWorkItem(store, {
		id: "TASK-123",
		type: "task",
		status: "open",
		title: "Native task",
		parentId: "E-1",
		dependencies: ["DEP-1"],
		notes: [issue.notes],
		acceptance: "must pass",
	});
	saveStore(cwd, store);
	const oldBd = process.env.WORK_ORCH_BD_BIN;
	process.env.WORK_ORCH_BD_BIN = path.join(cwd, "bd-must-not-run");
	try {
		assert(
			mod.workflowTaskSummary(cwd, "TASK-123").title === "Native task",
			"native task summary avoids bd",
		);
		const helper = path.join(import.meta.dirname, "work-helper.mjs");
		const ready = JSON.parse(
			execFileSync(process.execPath, [helper, "work-ready-summary", "E-1"], {
				cwd,
				encoding: "utf8",
			}),
		);
		assert(
			ready.length === 1 && ready[0].id === "TASK-123" && !ready[0].notes_tail,
			"native ready helper returns compact execution fields without bd",
		);
		execFileSync(
			process.execPath,
			[helper, "work-note", "TASK-123", "direct note"],
			{ cwd },
		);
		execFileSync(
			process.execPath,
			[helper, "work-note", "TASK-123", "--append-notes", "flagged note"],
			{ cwd },
		);
		const notes = loadStore(cwd).items["TASK-123"].notes;
		assert(
			notes.at(-2) === "direct note" && notes.at(-1) === "flagged note",
			"work-note accepts direct and --append-notes forms without persisting the flag",
		);
	} finally {
		if (oldBd === undefined) delete process.env.WORK_ORCH_BD_BIN;
		else process.env.WORK_ORCH_BD_BIN = oldBd;
	}

	const bounded = mod.runBounded(
		cwd,
		process.execPath,
		["-e", "console.log('a'.repeat(12000))"],
		{ name: "large", cap: 1000 },
	);
	assert(bounded.truncated, "bounded runner truncates large stdout");
	assert(
		readFileSync(bounded.full_stdout_path, "utf8").length > 10000,
		"bounded runner saves full stdout",
	);

	const check = mod.runTempCheck(
		cwd,
		"fields",
		`import { readFileSync } from "node:fs";\nconst input = JSON.parse(readFileSync(process.argv[2], "utf8"));\nconsole.log(JSON.stringify({ status: input.ok ? "PASS" : "FAIL", summary: "checked", key_values: { checked: 1 }, failed_assertions: input.ok ? [] : ["not ok"] }));\nprocess.exit(input.ok ? 0 : 1);`,
		{ ok: true },
	);
	assert(
		check.status === "PASS" && check.key_values.checked === 1,
		"temp check returns compact pass JSON",
	);

	mkdirSync(path.join(cwd, ".pi"), { recursive: true });
	const jsonl = path.join(cwd, ".pi", "test-records.jsonl");
	writeFileSync(jsonl, `${JSON.stringify(issue)}\n`);
	const recordSummary = mod.jsonlRecordSummary(jsonl, ["TASK-123"]);
	assert(
		recordSummary.records["TASK-123"].status === "open",
		"jsonl summary selects record",
	);
	const gate = mod.prepareTaskExportForGate(cwd, ["TASK-123"]);
	assert(gate.status === "PASS", "native preflight catches present work item");
	const missing = mod.prepareTaskExportForGate(cwd, ["NOPE"]);
	assert(
		missing.status === "FAIL" && missing.missing_ids[0] === "NOPE",
		"native preflight catches missing work item",
	);

	const evidencePath = mod.writeEvidenceSummary(cwd, {
		run_id: "run-1",
		task_id: "TASK-123",
		status: "PASS",
		checks: [],
	});
	assert(
		evidencePath.endsWith("run-1-summary.json"),
		"evidence summary path is stable",
	);
	assert(
		mod.readEvidenceSummary(cwd, "run-1").task_id === "TASK-123",
		"evidence summary is readable",
	);

	const transcript = path.join(cwd, "transcript.jsonl");
	writeFileSync(
		transcript,
		[
			{ type: "user", timestamp: "2026-01-01T00:00:00.000Z" },
			{
				role: "assistant",
				usage: { total_tokens: 10, input_tokens: 7, output_tokens: 3 },
				tool_calls: [{ name: "bash", args: "git status" }],
			},
			{ type: "tool_result", result: "ok" },
			{ role: "assistant", tool_calls: [{ name: "bash", args: "git status" }] },
			{ type: "tool_result", result: "bad", isError: true },
			{
				role: "assistant",
				timestamp: "2026-01-01T00:00:02.000Z",
				usage: { input: 5, output: 2, cacheRead: 11, cost: 0.1 },
				message: {
					content: [
						{ type: "toolCall", name: "read", arguments: { path: "x" } },
					],
				},
			},
			{ role: "toolResult", text: "pi tool output" },
		]
			.map(JSON.stringify)
			.join("\n"),
	);
	const reconciled = mod.reconcileTranscriptTelemetry(transcript);
	assert(
		reconciled.assistantTurns === 3,
		"transcript reconciles assistant turns",
	);
	assert(
		reconciled.toolCalls === 3 && reconciled.toolErrors === 1,
		"transcript reconciles tools and errors",
	);
	assert(
		reconciled.usage.cacheRead === 11 && reconciled.durationMs === 2000,
		"transcript reconciles Pi usage and duration",
	);
	assert(
		reconciled.repeatedCommandSignatures.length === 1,
		"transcript finds repeated commands",
	);

	const waste = mod.optimizationTelemetry([
		{
			tools: [
				{ name: "bash", kind: "shell", outputChars: 12001 },
				{ name: "bash", kind: "shell", outputChars: 2 },
			],
		},
	]);
	assert(
		waste.largeOutputs.length === 1,
		"optimization telemetry finds large output",
	);
	assert(
		waste.repeatedCommandSignatures.length === 1,
		"optimization telemetry finds repeats",
	);

	const jsonFile = path.join(cwd, "artifact.json");
	writeFileSync(
		jsonFile,
		JSON.stringify({ status: "PASS", nested: { count: 2 } }),
	);
	const helper = JSON.parse(
		execFileSync(
			process.execPath,
			[
				path.join(import.meta.dirname, "work-helper.mjs"),
				"json-assert",
				jsonFile,
				"--required",
				"status,nested.count",
				"--equals",
				"status=PASS",
			],
			{ cwd, encoding: "utf8" },
		),
	);
	assert(
		helper.status === "PASS",
		"work helper runs deterministic JSON assertions",
	);

	const finishCwd = path.join(cwd, "finish-task");
	mkdirSync(finishCwd, { recursive: true });
	const finishStore = initStore(finishCwd);
	createWorkItem(finishStore, {
		id: "TASK-1",
		type: "task",
		status: "open",
		title: "Routine task",
	});
	for (const id of ["TASK-2", "TASK-3", "TASK-4", "TASK-ROLLBACK"])
		createWorkItem(finishStore, {
			id,
			type: "task",
			status: "open",
			title: "Routine task",
		});
	createWorkItem(finishStore, {
		id: "TASK-5",
		type: "task",
		status: "open",
		title: "Update authentication permission checks",
	});
	saveStore(finishCwd, finishStore);
	execFileSync("git", ["init"], { cwd: finishCwd, stdio: "ignore" });
	execFileSync("git", ["config", "user.email", "test@example.com"], {
		cwd: finishCwd,
	});
	execFileSync("git", ["config", "user.name", "Test"], { cwd: finishCwd });
	writeFileSync(
		path.join(finishCwd, "result.js"),
		"const result = 'before';\n",
	);
	execFileSync("git", ["add", "-A"], { cwd: finishCwd });
	execFileSync("git", ["commit", "-m", "initial"], {
		cwd: finishCwd,
		stdio: "ignore",
	});
	writeFileSync(path.join(finishCwd, "result.js"), "const result='after'\n");
	const fakeFormatter = path.join(cwd, "fake-biome.mjs");
	writeFileSync(
		fakeFormatter,
		'#!/usr/bin/env node\nimport { writeFileSync } from "node:fs";\nfor (const file of process.argv.slice(2)) if (file.endsWith("result.js")) writeFileSync(file, "const result = \\"after\\";\\n");\n',
	);
	writeFileSync(
		path.join(finishCwd, "AGENTS.md"),
		"<!-- BEGIN COMPOUND PI TOOL MAP -->\ngenerated\n<!-- END COMPOUND PI TOOL MAP -->\n",
	);
	const fakeBdScript = path.join(finishCwd, "tracker-must-not-run");
	const finished = JSON.parse(
		execFileSync(
			process.execPath,
			[
				path.join(import.meta.dirname, "work-helper.mjs"),
				"finish-task",
				"TASK-1",
				"--max-files",
				"2",
				"--message",
				"record result",
				"--verify",
				`"${process.execPath}" -e "process.stdout.write('checked')"`,
				"--expect",
				"checked",
				"--immediate-format",
			],
			{
				cwd: finishCwd,
				encoding: "utf8",
				env: {
					...process.env,
					WORK_ORCH_BD_BIN: fakeBdScript,
					WORK_ORCH_FORMATTER_BIN: fakeFormatter,
				},
			},
		),
	);
	assert(
		finished.status === "PASS" &&
			finished.verification?.output === "checked" &&
			finished.formatted?.includes("result.js") &&
			readFileSync(path.join(finishCwd, "result.js"), "utf8").includes(
				'"after"',
			) &&
			finished.clean &&
			!existsSync(path.join(finishCwd, "AGENTS.md")),
		"finish-task closes, removes generated instruction dirt, and leaves git clean",
	);
	assert(
		execFileSync("git", ["log", "-1", "--pretty=%s"], {
			cwd: finishCwd,
			encoding: "utf8",
		}).trim() === "TASK-1: record result",
		"finish-task creates the WorkItem commit",
	);

	writeFileSync(
		path.join(finishCwd, "status.json"),
		'{"status":"PASS","count":2}\n',
	);
	const jsonFinished = JSON.parse(
		execFileSync(
			process.execPath,
			[
				path.join(import.meta.dirname, "work-helper.mjs"),
				"finish-task",
				"TASK-2",
				"--max-files",
				"2",
				"--message",
				"record JSON",
				"--json",
				"status.json",
				"--equals",
				"status=PASS",
				"--equals",
				"count=2",
			],
			{
				cwd: finishCwd,
				encoding: "utf8",
				env: { ...process.env, WORK_ORCH_BD_BIN: fakeBdScript },
			},
		),
	);
	assert(
		jsonFinished.verification?.status === "PASS" && jsonFinished.clean,
		"finish-task validates JSON inline without a nested shell command",
	);

	const headBeforePush = execFileSync("git", ["rev-parse", "HEAD"], {
		cwd: finishCwd,
		encoding: "utf8",
	}).trim();
	writeFileSync(path.join(finishCwd, "rollback.js"), "export default true;\n");
	const failingGit = path.join(cwd, "git-push-fails.mjs");
	writeFileSync(
		failingGit,
		`#!/usr/bin/env node
import { spawnSync } from "node:child_process";
const args = process.argv.slice(2);
if (args[0] === "push") process.exit(7);
if (args[0] === "rev-parse" && args.includes("@{upstream}")) { console.log("origin/main"); process.exit(0); }
const result = spawnSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
process.stdout.write(result.stdout ?? "");
process.stderr.write(result.stderr ?? "");
process.exit(result.status ?? 1);
`,
	);
	let pushFailed = false;
	try {
		execFileSync(
			process.execPath,
			[
				path.join(import.meta.dirname, "work-helper.mjs"),
				"finish-task",
				"TASK-ROLLBACK",
				"--max-files",
				"2",
				"--message",
				"rollback push",
				"--verify",
				`"${process.execPath}" -e "process.stdout.write('ok')"`,
				"--expect",
				"ok",
				"--push",
			],
			{
				cwd: finishCwd,
				encoding: "utf8",
				env: { ...process.env, WORK_ORCH_GIT_BIN: failingGit },
			},
		);
	} catch {
		pushFailed = true;
	}
	assert(pushFailed, "push failure is reported");
	assert(
		execFileSync("git", ["rev-parse", "HEAD"], {
			cwd: finishCwd,
			encoding: "utf8",
		}).trim() === headBeforePush &&
			loadStore(finishCwd).items["TASK-ROLLBACK"].status === "open",
		"push failure rolls Git and native closure back to a resumable item",
	);
	rmSync(path.join(finishCwd, "rollback.js"));

	for (const file of ["one.txt", "two.txt", "three.txt"])
		writeFileSync(path.join(finishCwd, file), file);
	let scopeError = "";
	try {
		execFileSync(
			process.execPath,
			[
				path.join(import.meta.dirname, "work-helper.mjs"),
				"finish-task",
				"TASK-3",
				"--max-files",
				"2",
				"--message",
				"too broad",
				"--verify",
				`"${process.execPath}" -e "process.stdout.write('ok')"`,
			],
			{
				cwd: finishCwd,
				encoding: "utf8",
				env: { ...process.env, WORK_ORCH_BD_BIN: fakeBdScript },
			},
		);
	} catch (error) {
		scopeError = String(error.stdout ?? "");
	}
	assert(
		scopeError.includes("scope exceeds 2 implementation files"),
		"finish-task enforces the coded file boundary before commit",
	);
	for (const file of ["one.txt", "two.txt", "three.txt"])
		rmSync(path.join(finishCwd, file));

	mkdirSync(path.join(finishCwd, "auth"));
	writeFileSync(
		path.join(finishCwd, "auth", "policy file.js"),
		"export default true;\n",
	);
	let reviewError = "";
	try {
		execFileSync(
			process.execPath,
			[
				path.join(import.meta.dirname, "work-helper.mjs"),
				"finish-task",
				"TASK-4",
				"--max-files",
				"2",
				"--message",
				"auth policy",
				"--verify",
				`"${process.execPath}" -e "process.stdout.write('ok')"`,
			],
			{
				cwd: finishCwd,
				encoding: "utf8",
				env: { ...process.env, WORK_ORCH_BD_BIN: fakeBdScript },
			},
		);
	} catch (error) {
		reviewError = String(error.stdout ?? "");
	}
	const reviewMessage = JSON.parse(reviewError).error;
	const absoluteHelper = realpathSync(
		path.join(import.meta.dirname, "work-helper.mjs"),
	);
	assert(
		reviewMessage.includes("independent review required") &&
			reviewMessage.includes("Work item: TASK-4") &&
			reviewMessage.includes(`Helper: ${JSON.stringify(absoluteHelper)}`) &&
			reviewMessage.includes(
				`Summary command: node ${JSON.stringify(absoluteHelper)} work-summary TASK-4`,
			) &&
			reviewMessage.includes('Review only: "auth/policy file.js"') &&
			reviewMessage.includes("Review reasons: sensitive paths") &&
			reviewMessage.includes("durable `wo:review PASS|FAIL` note") &&
			reviewMessage.includes("same finish-task command with --reviewed") &&
			!reviewMessage
				.split("Review only:")[1]
				.split("\n")[0]
				.includes(".ce-workflow/work-items.json"),
		"finish-task returns a complete, safely quoted reviewer handoff",
	);
	let forgedReviewError = "";
	try {
		execFileSync(
			process.execPath,
			[
				path.join(import.meta.dirname, "work-helper.mjs"),
				"finish-task",
				"TASK-4",
				"--max-files",
				"2",
				"--message",
				"auth policy",
				"--verify",
				`"${process.execPath}" -e "process.stdout.write('ok')"`,
				"--reviewed",
			],
			{
				cwd: finishCwd,
				encoding: "utf8",
				env: { ...process.env, WORK_ORCH_BD_BIN: fakeBdScript },
			},
		);
	} catch (error) {
		forgedReviewError = String(error.stdout ?? "");
	}
	assert(
		forgedReviewError.includes("durable wo:review PASS evidence"),
		"finish-task rejects a forged reviewed flag without WorkItems evidence",
	);
	rmSync(path.join(finishCwd, "auth"), { recursive: true, force: true });
	writeFileSync(path.join(finishCwd, "config.js"), "export default true;\n");
	let contractReviewError = "";
	try {
		execFileSync(
			process.execPath,
			[
				path.join(import.meta.dirname, "work-helper.mjs"),
				"finish-task",
				"TASK-5",
				"--max-files",
				"2",
				"--message",
				"permission checks",
				"--verify",
				`"${process.execPath}" -e "process.stdout.write('ok')"`,
			],
			{
				cwd: finishCwd,
				encoding: "utf8",
				env: { ...process.env, WORK_ORCH_BD_BIN: fakeBdScript },
			},
		);
	} catch (error) {
		contractReviewError = String(error.stdout ?? "");
	}
	assert(
		contractReviewError.includes("sensitive task contract"),
		"finish-task enforces sensitive WorkItem review even for neutral file paths",
	);

	console.log("ok - workflow optimization helpers");
} finally {
	rmSync(cwd, { recursive: true, force: true });
}
