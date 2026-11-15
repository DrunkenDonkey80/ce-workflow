// Shared machine defaults for Hub and terminal Pi; keep semantic tools, not automatic source mutations.
import { readFileSync, realpathSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { atomic, tryPlanLock } from "./plan3-files.ts";

function present(file: string) {
	try { return statSync(file).isFile(); }
	catch (error) { if (error.code === "ENOENT") return false; throw error; }
}

export function lensConfigFile(home = os.homedir(), env = process.env) {
	if (env.PI_LENS_CONFIG_PATH) return path.resolve(env.PI_LENS_CONFIG_PATH);
	const canonical = path.join(home, ".pi-lens", "config.json");
	if (present(canonical)) return canonical;
	const agent = env.PI_CODING_AGENT_DIR?.trim();
	const hosted = agent && path.resolve(agent, "extensions", "pi-lens.json");
	return hosted && present(hosted) ? hosted : canonical;
}

function object(value: unknown, key: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid pi-lens ${key}; configuration left unchanged.`);
	return value as Record<string, unknown>;
}
function section(config: Record<string, unknown>, key: string) {
	const value = config[key] === undefined ? {} : object(config[key], key);
	config[key] = value;
	return value;
}

export function applyLensDefaults(file = lensConfigFile(), env = process.env) {
	// pi-lens reads this when scheduling each idle timer, not when its module loads.
	env.PI_LENS_LSP_IDLE_EVICT_MS = "120000";
	try { file = realpathSync(file); } catch (error) { if (error.code !== "ENOENT") throw error; }
	const release = tryPlanLock(file);
	if (!release) throw new Error(`pi-lens configuration is being saved elsewhere: ${file}. Retry on the next start.`);
	try {
		let before: string | undefined;
		try { before = readFileSync(file, "utf8"); } catch (error) { if (error.code !== "ENOENT") throw error; }
		const config = object(before === undefined ? {} : JSON.parse(before), "config");
		const original = JSON.stringify(config);
		for (const key of ["format", "autofix", "tests"]) section(config, key).enabled = false;
		section(config, "readGuard").expandReads = false;
		section(section(config, "actionableWarnings"), "autoFix").enabled = false;
		const lsp = section(config, "lsp");
		const disabled = lsp.disabledServers === undefined ? [] : lsp.disabledServers;
		if (!Array.isArray(disabled) || disabled.some(id => typeof id !== "string")) throw new Error("Invalid pi-lens lsp.disabledServers; configuration left unchanged.");
		lsp.disabledServers = [...new Set([...disabled, "kotlin"])];
		const changed = JSON.stringify(config) !== original;
		if (changed) atomic(file, `${JSON.stringify(config, null, 2)}\n`);
		return { file, changed };
	} finally { release(); }
}

export function registerLensDefaults(pi, file?: string) {
	let warning: string | undefined;
	try { applyLensDefaults(file); }
	catch (error) { warning = `pi-lens defaults not applied: ${error.message}`; }
	if (warning) pi.on("session_start", (_event, ctx) => {
		if (ctx.hasUI) ctx.ui.notify(warning, "warning");
		else console.warn(warning);
	});
}
