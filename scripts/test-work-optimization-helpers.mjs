#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

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

	mkdirSync(path.join(cwd, ".beads"), { recursive: true });
	writeFileSync(
		path.join(cwd, ".beads", "issues.jsonl"),
		`${JSON.stringify(issue)}\n`,
	);
	const oldBd = process.env.WORK_ORCH_BD_BIN;
	const fakeBd = path.join(cwd, "fake-bd.mjs");
	const countFile = path.join(cwd, "bd-count.txt");
	writeFileSync(
		fakeBd,
		`#!/usr/bin/env node\nimport { readFileSync, writeFileSync, existsSync } from "node:fs";\nconst countFile = ${JSON.stringify(countFile)};\nconst count = existsSync(countFile) ? Number(readFileSync(countFile, "utf8")) : 0;\nwriteFileSync(countFile, String(count + 1));\nconsole.log(JSON.stringify([{ id: "TASK-123", title: "Cached", status: "open", issue_type: "task" }]));\n`,
	);
	process.env.WORK_ORCH_BD_BIN = fakeBd;
	mod.workflowTaskSummary(cwd, "TASK-123");
	mod.workflowTaskSummary(cwd, "TASK-123");
	assert(
		readFileSync(countFile, "utf8") === "1",
		"bd JSON reads are cached for unchanged Beads DB",
	);
	if (oldBd === undefined) delete process.env.WORK_ORCH_BD_BIN;
	else process.env.WORK_ORCH_BD_BIN = oldBd;

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

	const jsonl = path.join(cwd, ".beads", "issues.jsonl");
	writeFileSync(jsonl, `${JSON.stringify(issue)}\n`);
	const recordSummary = mod.jsonlRecordSummary(jsonl, ["TASK-123"]);
	assert(
		recordSummary.records["TASK-123"].status === "open",
		"jsonl summary selects record",
	);
	const gate = mod.prepareTaskExportForGate(cwd, ["TASK-123"]);
	assert(gate.status === "PASS", "export preflight catches present task");
	const missing = mod.prepareTaskExportForGate(cwd, ["NOPE"]);
	assert(
		missing.status === "FAIL" && missing.missing_ids[0] === "NOPE",
		"export preflight catches stale export",
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
	mkdirSync(path.join(finishCwd, ".beads"), { recursive: true });
	execFileSync("git", ["init"], { cwd: finishCwd, stdio: "ignore" });
	execFileSync("git", ["config", "user.email", "test@example.com"], {
		cwd: finishCwd,
	});
	execFileSync("git", ["config", "user.name", "Test"], { cwd: finishCwd });
	writeFileSync(
		path.join(finishCwd, ".beads", "issues.jsonl"),
		'{"id":"TASK-1","status":"open"}\n',
	);
	writeFileSync(path.join(finishCwd, "result.txt"), "before\n");
	execFileSync("git", ["add", "-A"], { cwd: finishCwd });
	execFileSync("git", ["commit", "-m", "initial"], {
		cwd: finishCwd,
		stdio: "ignore",
	});
	writeFileSync(path.join(finishCwd, "result.txt"), "after\n");
	writeFileSync(
		path.join(finishCwd, "AGENTS.md"),
		"<!-- BEGIN COMPOUND PI TOOL MAP -->\ngenerated\n<!-- END COMPOUND PI TOOL MAP -->\n",
	);
	const fakeBdScript = path.join(finishCwd, "fake-bd.mjs");
	writeFileSync(
		fakeBdScript,
		'#!/usr/bin/env node\nimport { appendFileSync } from "node:fs";\nconst op = process.argv[2];\nif (op === "show") { const id = process.argv[3]; console.log(JSON.stringify([{ id, title: id === "TASK-5" ? "Update authentication permission checks" : "Routine task", notes: "" }])); process.exit(0); }\nif (op === "update") { appendFileSync(".beads/issues.jsonl", JSON.stringify({ id: process.argv[3], note: process.argv.at(-1) }) + "\\n"); console.log("updated"); process.exit(0); }\nif (op === "reopen") { console.log("reopened"); process.exit(0); }\nif (op !== "close") process.exit(2);\nif (process.env.FAIL_CLOSE === "1") { console.error("close failed"); process.exit(3); }\nappendFileSync(".beads/issues.jsonl", JSON.stringify({ id: process.argv[3], status: "closed" }) + "\\n");\nconsole.log("closed");\n',
	);
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
			],
			{
				cwd: finishCwd,
				encoding: "utf8",
				env: { ...process.env, WORK_ORCH_BD_BIN: fakeBdScript },
			},
		),
	);
	assert(
		finished.status === "PASS" &&
			finished.verification?.output === "checked" &&
			finished.clean &&
			!existsSync(path.join(finishCwd, "AGENTS.md")),
		"finish-task closes, removes generated instruction dirt, and leaves git clean",
	);
	assert(
		execFileSync("git", ["log", "-1", "--pretty=%s"], {
			cwd: finishCwd,
			encoding: "utf8",
		}).trim() === "TASK-1: record result",
		"finish-task creates the Bead commit",
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

	const headBeforeRollback = execFileSync("git", ["rev-parse", "HEAD"], {
		cwd: finishCwd,
		encoding: "utf8",
	}).trim();
	writeFileSync(path.join(finishCwd, "rollback.txt"), "keep dirty\n");
	let rollbackError = "";
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
				"rollback close failure",
				"--verify",
				`"${process.execPath}" -e "process.stdout.write('ok')"`,
			],
			{
				cwd: finishCwd,
				encoding: "utf8",
				env: {
					...process.env,
					WORK_ORCH_BD_BIN: fakeBdScript,
					FAIL_CLOSE: "1",
				},
			},
		);
	} catch (error) {
		rollbackError = String(error.stdout ?? "");
	}
	assert(
		rollbackError.includes("finalization rolled back") &&
			execFileSync("git", ["rev-parse", "HEAD"], {
				cwd: finishCwd,
				encoding: "utf8",
			}).trim() === headBeforeRollback &&
			existsSync(path.join(finishCwd, "rollback.txt")),
		"finish-task rolls back a created commit when Bead close fails",
	);
	execFileSync("git", ["restore", ".beads/issues.jsonl"], { cwd: finishCwd });
	rmSync(path.join(finishCwd, "rollback.txt"));

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
	execFileSync("git", ["restore", ".beads/issues.jsonl"], { cwd: finishCwd });
	for (const file of ["one.txt", "two.txt", "three.txt"])
		rmSync(path.join(finishCwd, file));

	mkdirSync(path.join(finishCwd, "auth"));
	writeFileSync(
		path.join(finishCwd, "auth", "policy.js"),
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
	assert(
		reviewError.includes("independent review required"),
		"finish-task escalates sensitive paths instead of self-approving",
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
		"finish-task rejects a forged reviewed flag without Beads evidence",
	);
	execFileSync("git", ["restore", ".beads/issues.jsonl"], { cwd: finishCwd });
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
		"finish-task enforces sensitive Bead review even for neutral file paths",
	);

	console.log("ok - workflow optimization helpers");
} finally {
	rmSync(cwd, { recursive: true, force: true });
}
