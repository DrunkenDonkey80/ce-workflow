#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createWorkItem, initStore, saveStore } from "../extensions/work-store.js";

const cwd = mkdtempSync(path.join(os.tmpdir(), "work-capability-adapters-"));
const helper = realpathSync(path.join(import.meta.dirname, "work-helper.mjs"));
const processRunner = realpathSync(path.join(import.meta.dirname, "fixtures/capabilities/run-process-smoke.mjs"));
const desktopRunner = realpathSync(path.join(import.meta.dirname, "fixtures/capabilities/run-desktop-smoke.ps1"));
const androidRunner = realpathSync(path.join(import.meta.dirname, "fixtures/capabilities/run-android-smoke.mjs"));
const run = (...args) => {
	const output = execFileSync(process.execPath, [helper, ...args], { cwd, encoding: "utf8" });
	try { return JSON.parse(output); } catch (cause) { throw new Error(`invalid helper JSON: ${output}`, { cause }); }
};
try {
	execFileSync("git", ["init", "-q"], { cwd });
	execFileSync("git", ["config", "user.email", "test@example.com"], { cwd });
	execFileSync("git", ["config", "user.name", "Test"], { cwd });
	writeFileSync(path.join(cwd, ".gitignore"), ".pi/\n"); writeFileSync(path.join(cwd, "source.js"), "export const ready = true;\n");
	execFileSync("git", ["add", ".gitignore", "source.js"], { cwd }); execFileSync("git", ["commit", "-qm", "seed"], { cwd });
	const store = initStore(cwd); const epic = createWorkItem(store, { type: "epic", title: "Adapter fixtures" });
	const entry = (id, capability, proof, command, artifacts, inspection) => ({ id, capability, proof, source: "repository-owned fixture", artifacts, ...(inspection ? { inspection: "goal" } : {}), operation: { command, timeoutMs: capability === "android" ? 900_000 : 180_000, expectedExit: 0, env: { WORK_FIXTURE_ROOT: cwd }, assertions: [{ target: "exit", operator: "equals", value: "0" }] } });
	const cases = [
		entry("csv", "command", "output", `${JSON.stringify(process.execPath)} ${JSON.stringify(processRunner)} command`, ["file"]),
		entry("service", "service", "interaction", `${JSON.stringify(process.execPath)} ${JSON.stringify(processRunner)} service`, ["log"]),
		entry("desktop", "desktop", "visual", `${JSON.stringify("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe")} -NoProfile -ExecutionPolicy Bypass -File ${JSON.stringify(desktopRunner)}`, ["screenshot", "log"], true),
	];
	if (process.argv.includes("--android")) cases.push(entry("android", "android", "interaction", `${JSON.stringify(process.execPath)} ${JSON.stringify(androidRunner)}`, ["screenshot", "log"], true));
	for (const requirement of cases) {
		const task = createWorkItem(store, { type: "task", parentId: epic.id, title: requirement.id, verificationContract: { version: 1, required: [requirement] } });
		saveStore(cwd, store);
		const result = run("work-run-proof", task.id, requirement.id, ...(requirement.inspection ? ["--inspection", `${requirement.capability} fixture rendered and reached its declared state.`] : []));
		assert.equal(result.verificationStatus.ok, true, `${requirement.id}: ${JSON.stringify(result)}`);
		assert.equal(result.proof.issuer.capability, requirement.capability);
		assert.equal(result.proof.operation.cleanup.ok, true);
	}
	for (const capability of ["ios", "macos"]) {
		const unavailable = createWorkItem(store, { type: "task", parentId: epic.id, title: `${capability} unavailable`, verificationContract: { version: 1, required: [{ id: capability, capability, proof: "interaction", source: "portable platform contract" }] } });
		saveStore(cwd, store);
		const blocked = run("work-run-proof", unavailable.id, capability);
		assert.deepEqual(blocked.verificationStatus.blocked, [capability]);
		assert.equal(blocked.proof.blocker.code, `${capability}-adapter-unavailable`);
	}
	console.log(`generic capability adapters${process.argv.includes("--android") ? " with Android emulator" : ""}: PASS`);
} finally { rmSync(cwd, { recursive: true, force: true }); }
