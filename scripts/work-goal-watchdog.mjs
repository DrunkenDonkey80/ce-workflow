#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const RECOVERABLE_STATUSES = new Set(["active", "waiting_usage_limit"]);

export function readLatestGoal(sessionFile) {
	let goal = null;
	for (const line of readFileSync(sessionFile, "utf8").split(/\r?\n/)) {
		if (!line.includes('"customType":"work-goal-state"')) continue;
		try {
			const entry = JSON.parse(line);
			if (entry.type === "custom" && entry.customType === "work-goal-state")
				goal = entry.data?.goal ?? null;
		} catch {
			// A partially-written final JSONL line is retried on the next tick.
		}
	}
	return goal;
}

export function runHerdr(args) {
	try {
		const output = execFileSync("herdr", args, {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});
		return { ok: true, value: JSON.parse(String(output).trim()) };
	} catch (error) {
		return {
			ok: false,
			error: String(error.stderr || error.message || error).trim(),
		};
	}
}

function agent(result) {
	return result.ok ? result.value?.result?.agent : null;
}

function shellReady(result) {
	if (!result.ok) return false;
	const info = result.value?.result?.process_info;
	return Boolean(
		info?.foreground_processes?.length === 1 &&
			info.foreground_processes[0].pid === info.shell_pid,
	);
}

export function watchdogTick(config, invoke = runHerdr) {
	const goal = readLatestGoal(config.sessionFile);
	const current = invoke(["agent", "get", config.pane]);
	const currentAgent = agent(current);
	const currentSession = currentAgent?.agent_session?.value;

	if (currentAgent)
		return currentSession === config.sessionId
			? { action: "healthy", goalStatus: goal?.status ?? null }
			: {
					action: "blocked",
					reason: `pane ${config.pane} belongs to session ${currentSession || "unknown"}`,
				};

	if (!RECOVERABLE_STATUSES.has(goal?.status))
		return { action: "dormant", goalStatus: goal?.status ?? null };

	const processInfo = invoke(["pane", "process-info", "--pane", config.pane]);
	if (!shellReady(processInfo))
		return {
			action: "blocked",
			reason: `pane ${config.pane} is not at an idle shell`,
		};

	const launch = invoke([
		"pane",
		"run",
		config.pane,
		`pi --session ${config.sessionId}`,
	]);
	if (!launch.ok)
		return { action: "error", reason: `launch failed: ${launch.error}` };

	const waited = invoke([
		"agent",
		"wait",
		config.pane,
		"--until",
		"idle",
		"--until",
		"done",
		"--timeout",
		String(config.startTimeoutMs ?? 120_000),
	]);
	const resumedAgent = agent(waited);
	if (resumedAgent?.agent_session?.value !== config.sessionId)
		return {
			action: "error",
			reason: `session ${config.sessionId} did not restart in ${config.pane}`,
		};

	if (goal.status === "active") {
		const resume = invoke([
			"agent",
			"prompt",
			config.pane,
			"ORCHESTRATOR_RUN_V1 work-goal resume",
		]);
		if (!resume.ok)
			return { action: "error", reason: `goal resume failed: ${resume.error}` };
	}

	return { action: "restarted", goalStatus: goal.status };
}

function parseArgs(argv) {
	const config = { intervalMs: 15_000, startTimeoutMs: 120_000 };
	for (let index = 0; index < argv.length; index++) {
		const key = argv[index];
		if (key === "--once") config.once = true;
		else if (key === "--pane") config.pane = argv[++index];
		else if (key === "--session") config.sessionId = argv[++index];
		else if (key === "--session-file") config.sessionFile = argv[++index];
		else if (key === "--state-file") config.stateFile = argv[++index];
		else if (key === "--interval-ms") config.intervalMs = Number(argv[++index]);
		else if (key === "--start-timeout-ms")
			config.startTimeoutMs = Number(argv[++index]);
		else throw new Error(`unknown argument: ${key}`);
	}
	for (const key of ["pane", "sessionId", "sessionFile"])
		if (!config[key])
			throw new Error(
				`missing --${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`,
			);
	if (!Number.isFinite(config.intervalMs) || config.intervalMs < 1_000)
		throw new Error("--interval-ms must be at least 1000");
	return config;
}

function emit(result, stateFile) {
	const event = { at: new Date().toISOString(), ...result };
	const line = JSON.stringify(event);
	console.log(line);
	if (stateFile) writeFileSync(stateFile, `${line}\n`);
}

async function main() {
	const config = parseArgs(process.argv.slice(2));
	do {
		emit(watchdogTick(config), config.stateFile);
		if (config.once) break;
		await new Promise((resolve) => setTimeout(resolve, config.intervalMs));
	} while (true);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href)
	main().catch((error) => {
		console.error(error.message || error);
		process.exitCode = 1;
	});
