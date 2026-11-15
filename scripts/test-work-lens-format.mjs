// Lean pi-lens policy: safe global merging, path precedence, idempotence and terminal startup.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { applyLensDefaults, lensConfigFile, registerLensDefaults } from "../extensions/work-lens-format.ts";
import { tryPlanLock } from "../extensions/plan3-files.ts";

const home = mkdtempSync(path.join(os.tmpdir(), "wo-lens-"));
const file = lensConfigFile(home, {}), env = {};
const config = () => JSON.parse(readFileSync(file, "utf8"));
const save = value => writeFileSync(file, JSON.stringify(value));
const previousIdle = process.env.PI_LENS_LSP_IDLE_EVICT_MS;
try {
	assert.equal(lensConfigFile(home, { PI_LENS_HOME: path.join(home, "data-only") }), file, "data home does not relocate config");
	const agent = path.join(home, "agent"), hosted = path.join(agent, "extensions", "pi-lens.json");
	mkdirSync(path.dirname(hosted), { recursive: true }); writeFileSync(hosted, "{}");
	assert.equal(lensConfigFile(home, { PI_CODING_AGENT_DIR: agent }), hosted, "host fallback before canonical exists");
	assert.equal(lensConfigFile(home, { PI_LENS_CONFIG_PATH: "explicit.json", PI_CODING_AGENT_DIR: agent }), path.resolve("explicit.json"));
	assert.equal(applyLensDefaults(file, env).changed, true, "fresh machine gets policy");
	assert.equal(lensConfigFile(home, { PI_CODING_AGENT_DIR: agent }), file, "existing canonical wins over hosted config");
	assert.equal(env.PI_LENS_LSP_IDLE_EVICT_MS, "120000", "eligible servers expire after two idle minutes");
	const expected = { format: { enabled: false }, autofix: { enabled: false }, tests: { enabled: false }, readGuard: { expandReads: false }, actionableWarnings: { autoFix: { enabled: false } }, lsp: { disabledServers: ["kotlin"] } };
	assert.deepEqual(config(), expected);
	const mtime = statSync(file).mtimeMs;
	assert.equal(applyLensDefaults(file, env).changed, false);
	assert.equal(statSync(file).mtimeMs, mtime, "unchanged config is not rewritten");

	save({ widget: { visible: false }, format: { enabled: true, mode: "deferred" }, readGuard: { enabled: true }, actionableWarnings: { enabled: true, autoFix: { enabled: true, other: 7 } }, lsp: { enabled: true, disabledServers: ["java"], serverOverrides: { typescript: { name: "kept" } } } });
	applyLensDefaults(file, env);
	const merged = config();
	assert.equal(merged.widget.visible, false);
	assert.deepEqual(merged.format, { enabled: false, mode: "deferred" });
	assert.deepEqual(merged.readGuard, { enabled: true, expandReads: false });
	assert.deepEqual(merged.actionableWarnings, { enabled: true, autoFix: { enabled: false, other: 7 } });
	assert.deepEqual(merged.lsp, { enabled: true, disabledServers: ["java", "kotlin"], serverOverrides: { typescript: { name: "kept" } } }, "keep TypeScript and unrelated server config");
	save({ lsp: { enabled: false, disabledServers: ["typescript", "kotlin"] } });
	applyLensDefaults(file, env);
	assert.deepEqual(config().lsp, { enabled: false, disabledServers: ["typescript", "kotlin"] }, "never re-enable deliberately disabled servers");

	for (const invalid of ["{broken", "null", "[]", '{"format":true}', '{"autofix":null}', '{"actionableWarnings":{"autoFix":[]}}', '{"lsp":{"disabledServers":"java"}}', '{"lsp":{"disabledServers":[3]}}']) {
		writeFileSync(file, invalid);
		assert.throws(() => applyLensDefaults(file, env));
		assert.equal(readFileSync(file, "utf8"), invalid, "invalid config is never overwritten");
	}
	save({});
	const release = tryPlanLock(file);
	try { assert.throws(() => applyLensDefaults(file, env), /being saved elsewhere/); assert.deepEqual(config(), {}); }
	finally { release(); }

	// Registration applies before session_start in terminal/RPC alike; no dialog is needed.
	const handlers = [];
	registerLensDefaults({ on: (...args) => handlers.push(args) }, file);
	assert.deepEqual(config(), expected);
	assert.equal(process.env.PI_LENS_LSP_IDLE_EVICT_MS, "120000");
	assert.equal(handlers.length, 0, "successful startup has no popup");
	writeFileSync(file, "{broken");
	registerLensDefaults({ on: (...args) => handlers.push(args) }, file);
	assert.equal(handlers[0][0], "session_start");
	let notice;
	handlers[0][1]({}, { hasUI: true, ui: { notify: (...args) => { notice = args; } } });
	assert.match(notice[0], /pi-lens defaults not applied/); assert.equal(notice[1], "warning");
	assert.equal(readFileSync(file, "utf8"), "{broken");
	console.log("pi-lens lean defaults check passed");
} finally {
	if (previousIdle === undefined) delete process.env.PI_LENS_LSP_IDLE_EVICT_MS; else process.env.PI_LENS_LSP_IDLE_EVICT_MS = previousIdle;
	rmSync(home, { recursive: true, force: true });
}
