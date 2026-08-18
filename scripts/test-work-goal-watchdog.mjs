#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { readLatestGoal, watchdogTick } from "./work-goal-watchdog.mjs";

const cwd = mkdtempSync(path.join(tmpdir(), "work-goal-watchdog-"));
const sessionFile = path.join(cwd, "session.jsonl");
const config = {
	pane: "w2:p1",
	sessionId: "session-1",
	sessionFile,
	startTimeoutMs: 50,
};
const entry = (goal) =>
	JSON.stringify({
		type: "custom",
		customType: "work-goal-state",
		data: { goal },
	});
const response = (result) => ({ ok: true, value: { result } });
const missingAgent = { ok: false, error: "agent not found" };
const agent = (session = "session-1") =>
	response({
		agent: { agent_session: { value: session }, agent_status: "idle" },
	});
const shell = response({
	process_info: {
		shell_pid: 42,
		foreground_processes: [{ pid: 42, name: "powershell.exe" }],
	},
});

try {
	writeFileSync(
		sessionFile,
		`${entry({ id: "old", status: "paused" })}\n${entry({ id: "goal", status: "active" })}\n{"partial"`,
	);
	assert.deepEqual(readLatestGoal(sessionFile), {
		id: "goal",
		status: "active",
	});

	let calls = [];
	assert.deepEqual(
		watchdogTick(config, (args) => {
			calls.push(args);
			return agent();
		}),
		{ action: "healthy", goalStatus: "active" },
	);
	assert.equal(calls.length, 1);

	assert.deepEqual(
		watchdogTick(config, () => agent("other-session")),
		{
			action: "blocked",
			reason: "pane w2:p1 belongs to session other-session",
		},
	);

	writeFileSync(sessionFile, `${entry({ id: "goal", status: "stopped" })}\n`);
	calls = [];
	assert.deepEqual(
		watchdogTick(config, (args) => {
			calls.push(args);
			return missingAgent;
		}),
		{ action: "dormant", goalStatus: "stopped" },
	);
	assert.equal(calls.length, 1);

	writeFileSync(sessionFile, `${entry({ id: "goal", status: "active" })}\n`);
	calls = [];
	const activeResults = [
		missingAgent,
		shell,
		response({}),
		agent(),
		response({}),
	];
	assert.deepEqual(
		watchdogTick(config, (args) => {
			calls.push(args);
			return activeResults.shift();
		}),
		{ action: "restarted", goalStatus: "active" },
	);
	assert.deepEqual(calls, [
		["agent", "get", "w2:p1"],
		["pane", "process-info", "--pane", "w2:p1"],
		["pane", "run", "w2:p1", "pi --session session-1"],
		[
			"agent",
			"wait",
			"w2:p1",
			"--until",
			"idle",
			"--until",
			"done",
			"--timeout",
			"50",
		],
		["agent", "prompt", "w2:p1", "ORCHESTRATOR_RUN_V1 work-goal resume"],
	]);

	writeFileSync(
		sessionFile,
		`${entry({ id: "goal", status: "waiting_usage_limit" })}\n`,
	);
	calls = [];
	const waitingResults = [missingAgent, shell, response({}), agent()];
	assert.deepEqual(
		watchdogTick(config, (args) => {
			calls.push(args);
			return waitingResults.shift();
		}),
		{ action: "restarted", goalStatus: "waiting_usage_limit" },
	);
	assert.equal(
		calls.length,
		4,
		"usage waits restart without bypassing the timer",
	);

	const busy = response({
		process_info: {
			shell_pid: 42,
			foreground_processes: [{ pid: 99, name: "gradle.exe" }],
		},
	});
	for (const busyPane of [
		busy,
		response({
			process_info: {
				shell_pid: 42,
				foreground_processes: [{ pid: 99, name: "powershell.exe" }],
			},
		}),
	])
		assert.deepEqual(
			watchdogTick(
				config,
				(() => {
					const results = [missingAgent, busyPane];
					return () => results.shift();
				})(),
			),
			{ action: "blocked", reason: "pane w2:p1 is not at an idle shell" },
		);
} finally {
	rmSync(cwd, { recursive: true, force: true });
}

console.log("work goal watchdog checks passed");
