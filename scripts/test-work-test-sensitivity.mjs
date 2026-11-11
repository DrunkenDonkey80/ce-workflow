#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { registerTestSensitivity, runSensitivity, TEST_SENSITIVITY } from "../extensions/test-sensitivity.ts";

const execute = promisify(execFile);
const exec = async (command, args, options) => {
	try { const result = await execute(command, args, { ...options, encoding: "utf8" }); return { ...result, code: 0, killed: false }; }
	catch (error) {
		if (typeof error.code !== "number") throw error;
		return { code: error.code, stdout: error.stdout, stderr: error.stderr, killed: Boolean(error.killed) };
	}
};
const cwd = await mkdtemp(path.join(os.tmpdir(), "test-sensitivity-fixture-"));
const reports = [];
const original = "export const accepts = (value, limit) => value < limit;\n";
const input = { file: "src/guard.mjs", oldText: "value < limit", newText: "value <= limit", command: process.execPath, args: ["test.mjs"], expectedFailure: "expiry boundary must reject" };
const run = async (changes = {}, runner = exec, directory = cwd, signal) => {
	const report = await runSensitivity(directory, { ...input, ...changes }, runner, signal);
	reports.push(report);
	assert.equal(await readFile(path.join(cwd, "src/guard.mjs"), "utf8"), original, "original dirty source must remain untouched");
	assert.equal(await readFile(path.join(cwd, "unrelated.txt"), "utf8"), "keep me");
	await assert.rejects(access(path.join(report.evidenceDir, "source")), { code: "ENOENT" });
	assert.equal(JSON.parse(await readFile(path.join(report.evidenceDir, "result.json"), "utf8")).status, report.status);
	return report;
};
try {
	await mkdir(path.join(cwd, "src"));
	await writeFile(path.join(cwd, ".gitignore"), "deps/\n");
	await writeFile(path.join(cwd, "src/guard.mjs"), original.replace("value < limit", "value <= limit"));
	await exec("git", ["init", "--quiet", "--initial-branch=master"], { cwd });
	await exec("git", ["add", ".gitignore", "src/guard.mjs"], { cwd });
	await writeFile(path.join(cwd, "src/guard.mjs"), original);
	await writeFile(path.join(cwd, "unrelated.txt"), "keep me");
	await writeFile(path.join(cwd, "test.mjs"), "import assert from 'node:assert/strict';\nimport {accepts} from './src/guard.mjs';\nassert.equal(accepts(10, 10), false, 'expiry boundary must reject');\n");
	const statusBefore = (await exec("git", ["status", "--porcelain=v1"], { cwd })).stdout;

	const caught = await run();
	assert.equal(caught.status, "caught", caught.reason);
	assert.deepEqual(caught.runs.map(run => run.code), [0, 1, 0]);
	assert.notEqual(caught.sourceHash, caught.mutantHash);
	assert.match(await readFile(caught.runs[1].log, "utf8"), /AssertionError/);
	assert.equal((await exec("git", ["status", "--porcelain=v1"], { cwd })).stdout, statusBefore, "index and dirty/untracked files unchanged");
	assert.equal((await run({ newText: "value < (limit + 0)" })).status, "survived");
	assert.equal((await run({ newText: "value <" })).status, "inconclusive", "syntax error is not a kill");
	assert.equal((await run({ expectedFailure: "unrelated assertion" })).status, "inconclusive");
	assert.equal((await run({ args: ["missing-test.mjs"] })).runs.length, 1, "failing baseline stops before mutation");
	assert.equal((await run({ oldText: "not in this source" })).runs.length, 0);
	assert.equal((await run({ oldText: "value", newText: "other" })).runs.length, 0, "ambiguous replacement refused");
	assert.equal((await run({ file: "guard.mjs", args: ["../test.mjs"] }, exec, path.join(cwd, "src"))).status, "caught", "subdirectory invocation snapshots the whole repository");

	const scripted = results => {
		let index = 0;
		return async (command, args, options) => command === "git" ? exec(command, args, options) : results[index++];
	};
	const ok = { code: 0, stdout: "", stderr: "" };
	const fail = { code: 1, stdout: "", stderr: input.expectedFailure };
	for (const mutant of [{ ...fail, killed: true }, { ...fail, truncated: true }, { ...fail, code: 2 }, { ...fail, stderr: `SyntaxError: ${input.expectedFailure}` }]) {
		assert.equal((await run({}, scripted([ok, mutant, ok]))).status, "inconclusive");
	}
	assert.equal((await run({}, scripted([ok, fail, fail]))).status, "inconclusive", "restored must pass");
	assert.equal((await run({}, scripted([{ ...ok, stdout: input.expectedFailure }]))).runs.length, 1, "marker in green output is not discriminating");
	const controller = new AbortController();
	let tests = 0;
	const cancelled = await run({}, async (command, args, options) => {
		if (command === "git") return exec(command, args, options);
		if (++tests === 2) { controller.abort(); throw new Error("cancelled mutant"); }
		return ok;
	}, cwd, controller.signal);
	assert.equal(cancelled.status, "inconclusive");
	assert.match(cancelled.reason, /cancelled/);
	const changed = await run({}, async (command, args, options) => {
		if (command === "git") return exec(command, args, options);
		await writeFile(path.join(options.cwd, "test.mjs"), "// test changed itself");
		return ok;
	});
	assert.equal(changed.status, "inconclusive");
	assert.match(changed.reason, /changed captured source/);

	await mkdir(path.join(cwd, "deps"));
	await writeFile(path.join(cwd, "deps/limit.mjs"), "export const limit = 10;\n");
	await writeFile(path.join(cwd, "dependency-test.mjs"), "import assert from 'node:assert/strict';\nimport {accepts} from './src/guard.mjs';\nimport {limit} from './deps/limit.mjs';\nassert.equal(accepts(limit, limit), false, 'expiry boundary must reject');\n");
	assert.equal((await run({ args: ["dependency-test.mjs"], dependencyDirs: ["deps"] })).status, "caught");
	assert.equal(await readFile(path.join(cwd, "deps/limit.mjs"), "utf8"), "export const limit = 10;\n", "cleanup must not follow dependency links");
	await assert.rejects(runSensitivity(cwd, { ...input, dependencyDirs: ["src"] }, exec), /shared dependency/);
	for (const file of ["../outside.mjs", ".git/config", path.join(cwd, "src/guard.mjs")]) await assert.rejects(runSensitivity(cwd, { ...input, file }, exec), /relative project path/);
	await assert.rejects(runSensitivity(cwd, { ...input, oldText: "" }, exec), /nonempty/);
	await assert.rejects(runSensitivity(cwd, { ...input, expectedFailure: " " }, exec), /specific assertion/);

	let tool;
	registerTestSensitivity({ registerTool: value => { tool = value; }, exec });
	assert.equal(tool.name, "test_sensitivity");
	assert(tool.promptSnippet && TEST_SENSITIVITY.includes("every project"));
	const result = await tool.execute("test", input, undefined, undefined, { cwd });
	reports.push(result.details);
	assert.equal(result.isError, false);
	assert.equal(result.details.status, "caught");
	console.log(`test sensitivity: ${reports.length} isolated runs passed (real assertion kill, survivor, invalid failures, cleanup and dirty-tree preservation)`);
} finally {
	await Promise.all(reports.map(report => rm(report.evidenceDir, { recursive: true, force: true })));
	await rm(cwd, { recursive: true, force: true });
}
