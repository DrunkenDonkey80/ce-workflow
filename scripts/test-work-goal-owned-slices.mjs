#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	createWorkItem,
	initStore,
	loadStore,
	saveStore,
} from "../extensions/work-store.js";
import { verificationContractStatus } from "../extensions/work-verification-contract.js";

const cwd = mkdtempSync(path.join(os.tmpdir(), "work-goal-owned-slice-"));
const helper = realpathSync(path.join(import.meta.dirname, "work-helper.mjs"));
const git = (...args) =>
	execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
try {
	git("init", "-q");
	git("config", "user.email", "test@example.com");
	git("config", "user.name", "Test");
	writeFileSync(
		path.join(cwd, "source.js"),
		"export function value() {\n\treturn 1;\n}\n",
	);
	writeFileSync(path.join(cwd, ".gitignore"), ".pi/\n");
	git("add", "source.js", ".gitignore");
	git("commit", "-qm", "seed");
	const store = initStore(cwd);
	createWorkItem(store, {
		id: "work-1",
		type: "epic",
		status: "open",
		title: "Goal-owned roadmap",
	});
	createWorkItem(store, {
		id: "work-1.1",
		type: "task",
		status: "in_progress",
		title: "Mechanical slice",
		parentId: "work-1",
		labels: ["wo:goal-owned"],
		acceptance: "Focused command verification passes.",
		verificationContract: {
			version: 1,
			required: [
				{
					id: "check",
					capability: "command",
					proof: "test",
					source: "mechanical acceptance",
					artifacts: ["result"],
					operation: {
						command: `"${process.execPath}" -e "process.stdout.write('ok')"`,
						timeoutMs: 30_000,
						expectedExit: 0,
						assertions: [
							{ target: "exit", operator: "equals", value: "0" },
							{ target: "stdout", operator: "equals", value: "ok" },
						],
					},
				},
			],
		},
	});
	saveStore(cwd, store);
	writeFileSync(
		path.join(cwd, "source.js"),
		"export function value() {\n\treturn 2;\n}\n",
	);
	const result = JSON.parse(
		execFileSync(
			process.execPath,
			[
				helper,
				"finish-task",
				"work-1.1",
				"--max-files",
				"2",
				"--message",
				"mechanical proof",
				"--verify",
				`"${process.execPath}" -e "process.stdout.write('ok')"`,
				"--skip-format",
			],
			{ cwd, encoding: "utf8" },
		),
	);
	assert.equal(result.status, "PASS");
	assert.equal(result.clean, true);
	const closed = loadStore(cwd).items["work-1.1"];
	assert.equal(closed.status, "closed");
	assert.equal(verificationContractStatus(closed, { cwd }).ok, true);
	assert.equal(
		closed.evidence.filter((entry) => entry.kind === "verification-proof").length,
		1,
		"coded finish records command proof without a separate worker/reviewer phase",
	);
	assert.equal(git("status", "--porcelain"), "");
	const roadmapResult = JSON.parse(
		execFileSync(
			process.execPath,
			[
				helper,
				"finish-task",
				"work-1",
				"--message",
				"close completed roadmap",
				"--verify",
				`"${process.execPath}" -e "process.stdout.write('ok')"`,
				"--expect",
				"ok",
				"--skip-format",
			],
			{ cwd, encoding: "utf8" },
		),
	);
	assert.equal(roadmapResult.status, "PASS");
	assert.equal(loadStore(cwd).items["work-1"].status, "closed");
	assert.equal(git("status", "--porcelain"), "");
} finally {
	rmSync(cwd, { recursive: true, force: true });
}

console.log("goal-owned mechanical slice finalization: PASS");
