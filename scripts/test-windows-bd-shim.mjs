#!/usr/bin/env node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const { buildWorkInitState } = await import(
	pathToFileURL(path.resolve("extensions/work-models.js")).href
);

function assert(ok, message) {
	if (!ok) throw new Error(message);
}

if (process.platform !== "win32") process.exit(0);

const dir = mkdtempSync(path.join(tmpdir(), "work-orch-bd-cmd-"));
const oldBd = process.env.WORK_ORCH_BD_BIN;
try {
	const bin = path.join(dir, "bin");
	const scriptDir = path.join(bin, "node_modules", "@beads", "bd", "bin");
	mkdirSync(scriptDir, { recursive: true });
	writeFileSync(path.join(bin, "bd.cmd"), "@echo off\r\nexit /b 1\r\n");
	writeFileSync(
		path.join(scriptDir, "bd.js"),
		`#!/usr/bin/env node
const args = process.argv.slice(2).filter((arg) => arg !== "--json");
if (args[0] === "where") { console.error("Error: no beads database found; run bd init"); process.exit(1); }
if (args[0] === "init") { console.log(JSON.stringify({ initialized: true })); process.exit(0); }
console.log(JSON.stringify([]));
`,
	);
	process.env.WORK_ORCH_BD_BIN = path.join(bin, "bd.cmd");
	const state = buildWorkInitState(dir);
	assert(
		state.ok,
		`expected work-init to use npm .cmd shim target, got ${JSON.stringify(state)}`,
	);
	assert(
		state.action === "initialized",
		"work-init initializes through resolved bd.js",
	);
} finally {
	if (oldBd === undefined) delete process.env.WORK_ORCH_BD_BIN;
	else process.env.WORK_ORCH_BD_BIN = oldBd;
	rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
}
