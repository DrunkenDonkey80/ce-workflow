#!/usr/bin/env node
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { migrateLegacyBeads } from "../extensions/legacy-beads-migration.js";

if (process.platform !== "win32") process.exit(0);
const dir = mkdtempSync(path.join(tmpdir(), "work-remove-beads-win-"));
const old = process.env.WORK_ORCH_BD_BIN;
try {
	const bin = path.join(dir, "bin"),
		scriptDir = path.join(bin, "node_modules", "@beads", "bd", "bin"),
		cwd = path.join(dir, "repo");
	mkdirSync(scriptDir, { recursive: true });
	mkdirSync(path.join(cwd, ".beads", "embeddeddolt"), { recursive: true });
	writeFileSync(path.join(bin, "bd.cmd"), "@echo off\r\nexit /b 1\r\n");
	writeFileSync(
		path.join(scriptDir, "bd.js"),
		`const a=process.argv.slice(2); if(a[0] !== 'export') process.exit(2); console.log(JSON.stringify([{id:'win-1',issue_type:'task',status:'open',title:'ok'}]));`,
	);
	process.env.WORK_ORCH_BD_BIN = path.join(bin, "bd.cmd");
	const result = migrateLegacyBeads(cwd);
	if (result.action !== "migrated")
		throw new Error("Windows shim migration failed");
	console.log("work-remove-beads Windows boundary passed");
} finally {
	if (old === undefined) delete process.env.WORK_ORCH_BD_BIN;
	else process.env.WORK_ORCH_BD_BIN = old;
	rmSync(dir, { recursive: true, force: true });
}
