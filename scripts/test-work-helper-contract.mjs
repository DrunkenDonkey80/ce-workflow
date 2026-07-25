#!/usr/bin/env node
import assert from "node:assert/strict";
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
import {
	createWorkItem,
	initStore,
	loadStore,
	saveStore,
} from "../extensions/work-store.js";

const helper = realpathSync(path.join(import.meta.dirname, "work-helper.mjs"));
const cwd = mkdtempSync(path.join(tmpdir(), "work-helper-contract-"));
const run = (...args) =>
	execFileSync(process.execPath, [helper, ...args], { cwd, encoding: "utf8" });
const failure = (...args) => {
	try {
		run(...args);
		assert.fail("command should fail");
	} catch (error) {
		return JSON.parse(String(error.stdout)).error;
	}
};
const verifyArgs = [
	"--verify",
	`"${process.execPath}" -e "process.stdout.write('ok')"`,
	"--expect",
	"ok",
];

try {
	const store = initStore(cwd);
	createWorkItem(store, {
		id: "E-1",
		type: "epic",
		status: "open",
		title: "Roadmap",
	});
	createWorkItem(store, {
		id: "PLAN-1",
		type: "task",
		status: "closed",
		title: "Planning container",
		parentId: "E-1",
		labels: ["wo:planning"],
	});
	createWorkItem(store, {
		id: "TASK-1",
		type: "task",
		status: "open",
		title: "Update authentication checks",
		parentId: "PLAN-1",
		description: "Review the implementation contract.",
		design: "Keep the change bounded.",
		acceptance: "Verification must print ok.",
		evidence: [{ kind: "worker", result: "focused tests passed" }],
	});
	saveStore(cwd, store);

	const summary = JSON.parse(run("work-summary", "TASK-1"));
	assert.equal(summary.description, "Review the implementation contract.");
	assert.equal(summary.acceptance, "Verification must print ok.");
	assert.equal(summary.evidence_tail[0].result, "focused tests passed");
	assert.deepEqual(
		JSON.parse(run("work-ready-summary", "E-1")).map((item) => item.id),
		["TASK-1"],
		"ready summaries include executable grandchildren",
	);

	execFileSync("git", ["init"], { cwd, stdio: "ignore" });
	execFileSync("git", ["config", "user.email", "test@example.com"], { cwd });
	execFileSync("git", ["config", "user.name", "Test"], { cwd });
	writeFileSync(path.join(cwd, "source.js"), "export default false;\n");
	writeFileSync(path.join(cwd, ".gitignore"), "node_modules/\n");
	execFileSync("git", ["add", "-A"], { cwd });
	execFileSync("git", ["commit", "-m", "initial"], { cwd, stdio: "ignore" });

	writeFileSync(path.join(cwd, "source.js"), "export default true;\n");
	writeFileSync(path.join(cwd, ".gitignore"), "node_modules/\nlocal-cache/\n");
	mkdirSync(path.join(cwd, ".ce-workflow", "work-runs", "verifiers"), {
		recursive: true,
	});
	writeFileSync(
		path.join(cwd, ".ce-workflow", "work-runs", "verifiers", "state.json"),
		"{}\n",
	);
	const handoff = failure(
		"finish-task",
		"TASK-1",
		"--max-files",
		"2",
		"--message",
		"scope finalization",
		...verifyArgs,
	);
	assert.match(handoff, /Review only: "\.gitignore", "source\.js"|Review only: "source\.js", "\.gitignore"/);
	assert.doesNotMatch(handoff, /work-runs/);
	assert.match(
		loadStore(cwd).items["TASK-1"].notes.join("\n"),
		/wo:review-scope/,
		"the coded handoff persists its exact review scope",
	);

	const reviewed = loadStore(cwd);
	const scopeNote = reviewed.items["TASK-1"].notes.find((note) =>
		note.startsWith("wo:review-scope "),
	);
	reviewed.items["TASK-1"].notes = reviewed.items["TASK-1"].notes.filter(
		(note) => !note.startsWith("wo:review-scope "),
	);
	reviewed.items["TASK-1"].notes.push("wo:review PASS - scoped diff approved");
	saveStore(cwd, reviewed);
	assert.match(
		failure(
			"finish-task",
			"TASK-1",
			"--max-files",
			"2",
			"--message",
			"scope finalization",
			...verifyArgs,
			"--reviewed",
		),
		/requires a persisted wo:review-scope/,
	);
	const scoped = loadStore(cwd);
	scoped.items["TASK-1"].notes.push(scopeNote);
	saveStore(cwd, scoped);
	writeFileSync(path.join(cwd, "extra.js"), "export default true;\n");
	assert.match(
		failure(
			"finish-task",
			"TASK-1",
			"--max-files",
			"3",
			"--message",
			"scope finalization",
			...verifyArgs,
			"--reviewed",
		),
		/review scope changed/,
	);
	rmSync(path.join(cwd, "extra.js"));
	const finished = JSON.parse(
		run(
			"finish-task",
			"TASK-1",
			"--max-files",
			"2",
			"--message",
			"scope finalization",
			...verifyArgs,
			"--reviewed",
		),
	);
	assert.equal(finished.status, "PASS");
	assert.doesNotMatch(
		execFileSync("git", ["show", "--pretty=", "--name-only", "HEAD"], {
			cwd,
			encoding: "utf8",
		}),
		/work-runs/,
		"workflow runtime files never enter the task commit",
	);

	writeFileSync(path.join(cwd, "residual.js"), "export default false;\n");
	const residualStore = loadStore(cwd);
	createWorkItem(residualStore, {
		id: "TASK-2",
		type: "task",
		status: "open",
		title: "Update authentication residual",
		notes: [
			"wo:review FAIL - first",
			"wo:fix PASS - first fix",
			'wo:review FAIL {"findings":["residual A","residual B"]}',
			"wo:fix PASS - generic residual summary",
			'wo:review-scope ["residual.js"]',
		],
	});
	saveStore(cwd, residualStore);
	execFileSync("git", ["add", "residual.js", ".ce-workflow/work-items.json"], {
		cwd,
	});
	execFileSync("git", ["commit", "-m", "residual baseline"], {
		cwd,
		stdio: "ignore",
	});
	writeFileSync(path.join(cwd, "residual.js"), "export default true;\n");
	assert.match(
		failure(
			"finish-task",
			"TASK-2",
			"--max-files",
			"1",
			"--message",
			"finish residual fixes",
			...verifyArgs,
			"--reviewed",
		),
		/verified residual fix/,
		"generic fixer PASS does not disposition targeted re-review findings",
	);
	const dispositionStore = loadStore(cwd);
	dispositionStore.items["TASK-2"].notes.push(
		'wo:residual-fix PASS {"dispositions":[{"finding":"residual A","fix":"guard added","evidence":"focused test A passed"},{"finding":"residual B","fix":"scope check added","evidence":"focused test B passed"}]}',
	);
	saveStore(cwd, dispositionStore);
	const residualFinished = JSON.parse(
		run(
			"finish-task",
			"TASK-2",
			"--max-files",
			"1",
			"--message",
			"finish residual fixes",
			...verifyArgs,
			"--reviewed",
		),
	);
	assert.equal(residualFinished.status, "PASS");

	console.log("ok - work helper contract");
} finally {
	rmSync(cwd, { recursive: true, force: true });
}
