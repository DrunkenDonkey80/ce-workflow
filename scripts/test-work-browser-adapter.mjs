#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createWorkItem, initStore, saveStore } from "../extensions/work-store.js";

const cwd = mkdtempSync(path.join(os.tmpdir(), "work-browser-adapter-"));
const helper = realpathSync(path.join(import.meta.dirname, "work-helper.mjs"));
const runner = realpathSync(path.join(import.meta.dirname, "fixtures/capabilities/run-browser-smoke.mjs"));
const run = (...args) => execFileSync(process.execPath, [helper, ...args], { cwd, encoding: "utf8" });
try {
	execFileSync("git", ["init", "-q"], { cwd });
	execFileSync("git", ["config", "user.email", "test@example.com"], { cwd });
	execFileSync("git", ["config", "user.name", "Test"], { cwd });
	writeFileSync(path.join(cwd, ".gitignore"), ".pi/\n");
	writeFileSync(path.join(cwd, "source.js"), "export const ready = true;\n");
	execFileSync("git", ["add", ".gitignore", "source.js"], { cwd });
	execFileSync("git", ["commit", "-qm", "seed"], { cwd });
	const store = initStore(cwd);
	const epic = createWorkItem(store, { type: "epic", title: "Browser fixture" });
	const task = createWorkItem(store, {
		type: "task",
		parentId: epic.id,
		title: "Prove browser fixture",
		verificationContract: {
			version: 1,
			required: [
				{
					id: "browser-smoke",
					capability: "browser",
					proof: "visual",
					source: "repository browser fixture",
					artifacts: ["screenshot", "log"],
					inspection: "goal",
					operation: {
						command: `${JSON.stringify(process.execPath)} ${JSON.stringify(runner)}`,
						expectedExit: 0,
						timeoutMs: 180_000,
						env: { WORK_FIXTURE_ROOT: cwd },
						assertions: [{ target: "stdout", operator: "includes", value: '"state":"ok"' }],
					},
				},
			],
		},
	});
	saveStore(cwd, store);
	const result = JSON.parse(run("work-run-proof", task.id, "browser-smoke", "--inspection", "Calculator shows 5 with a labelled live output at a mobile viewport."));
	assert.equal(result.verificationStatus.ok, true);
	assert.equal(result.proof.issuer.id, "ce.browser.command");
	assert.equal(result.proof.operation.cleanup.ok, true);
	assert.equal(result.proof.artifacts.length, 2);
	assert(result.proof.artifacts.every((item) => /^[a-f0-9]{64}$/.test(item.sha256)));
	console.log("browser capability adapter live smoke: PASS");
} finally {
	rmSync(cwd, { recursive: true, force: true });
}
