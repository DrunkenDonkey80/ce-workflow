#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import {
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

	mkdirSync(path.join(cwd, ".beads"), { recursive: true });
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
			{ type: "user", timestamp: "1" },
			{
				role: "assistant",
				usage: { total_tokens: 10, input_tokens: 7, output_tokens: 3 },
				tool_calls: [{ name: "bash", args: "git status" }],
			},
			{ type: "tool_result", result: "ok" },
			{ role: "assistant", tool_calls: [{ name: "bash", args: "git status" }] },
			{ type: "tool_result", result: "bad", isError: true },
		]
			.map(JSON.stringify)
			.join("\n"),
	);
	const reconciled = mod.reconcileTranscriptTelemetry(transcript);
	assert(
		reconciled.assistantTurns === 2,
		"transcript reconciles assistant turns",
	);
	assert(
		reconciled.toolCalls === 2 && reconciled.toolErrors === 1,
		"transcript reconciles tools and errors",
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

	console.log("ok - workflow optimization helpers");
} finally {
	rmSync(cwd, { recursive: true, force: true });
}
