import { randomUUID } from "node:crypto";
import {
	closeSync,
	existsSync,
	fstatSync,
	lstatSync,
	openSync,
	readFileSync,
	readSync,
	realpathSync,
} from "node:fs";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { loadVerifierStore } from "./background-verifiers.js";
import { loadLaneStore } from "./read-only-lanes.js";
import { loadStore } from "./work-store.js";

const REFRESH_MS = 750;
const RECENT_TERMINAL_LIMIT = 20;
const ACTIVE_STATES = new Set(["running", "queued", "waiting", "paused"]);
const LIVE_STATES = new Set(["running"]);
const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]/g;
const STATUS_SYMBOLS = Object.freeze({
	running: "●",
	queued: "◦",
	waiting: "?",
	paused: "‖",
	completed: "✓",
	stopped: "■",
	failed: "✗",
});

function legacyMatchesKey(data, key) {
	const aliases = {
		escape: ["escape", "\x1b"],
		"ctrl+c": ["ctrl+c", "\x03"],
		"ctrl+o": ["ctrl+o", "\x0f"],
		"ctrl+u": ["ctrl+u", "\x15"],
		enter: ["enter", "return", "\r", "\n"],
		backspace: ["backspace", "\b", "\x7f"],
		up: ["up", "\x1b[A"],
		down: ["down", "\x1b[B"],
		pageUp: ["pageUp", "\x1b[5~"],
		pageDown: ["pageDown", "\x1b[6~"],
		"shift+k": ["K"],
		"shift+j": ["J"],
		r: ["r", "R"],
		x: ["x", "X"],
	};
	return aliases[key]?.includes(data) ?? data === key;
}

export function normalizeFleetState(value) {
	const state = String(value ?? "").toLowerCase();
	if (["running", "active", "in_progress", "stopping"].includes(state))
		return "running";
	if (["queued", "pending", "open", "planned"].includes(state)) return "queued";
	if (["waiting", "waiting_for_decision", "needs_human"].includes(state))
		return "waiting";
	if (["paused", "waiting_usage_limit", "budget_limited"].includes(state))
		return "paused";
	if (
		[
			"complete",
			"completed",
			"closed",
			"success",
			"succeeded",
			"done",
			"promoted",
		].includes(state)
	)
		return "completed";
	if (
		[
			"stopped",
			"cancelled",
			"canceled",
			"detached",
			"deferred",
			"discarded",
			"blocked",
		].includes(state)
	)
		return "stopped";
	return "failed";
}

export function fleetStatusSymbol(state) {
	return STATUS_SYMBOLS[normalizeFleetState(state)];
}

function stateRank(state) {
	return ACTIVE_STATES.has(normalizeFleetState(state)) ? 0 : 1;
}

function byActiveThenRecent(left, right) {
	return (
		stateRank(left.state) - stateRank(right.state) ||
		Number(right.updatedAt ?? 0) - Number(left.updatedAt ?? 0) ||
		left.key.localeCompare(right.key)
	);
}

function taskState(item, agents) {
	const states = agents.map((agent) => normalizeFleetState(agent.state));
	if (states.includes("running")) return "running";
	if (states.includes("queued")) return "queued";
	if (states.includes("waiting")) return "waiting";
	if (states.includes("paused")) return "paused";
	if (states.includes("failed")) return "failed";
	if (states.includes("stopped")) return "stopped";
	if (states.length) return "completed";
	return normalizeFleetState(item.status);
}

export function groupWorkFleet(store, runs) {
	const tasks = new Map();
	for (const run of runs) {
		if (!run.workItemId) continue;
		const item = store?.items?.[run.workItemId] ?? {
			id: run.workItemId,
			title: run.workItemId,
			status: run.state,
		};
		const task = tasks.get(run.workItemId) ?? {
			key: `task:${run.workItemId}`,
			kind: "task",
			id: run.workItemId,
			name: item.displayMetadata?.title ?? item.title ?? run.workItemId,
			state: normalizeFleetState(item.status),
			updatedAt: Date.parse(item.updatedAt ?? "") || 0,
			agents: [],
		};
		for (const step of run.steps) {
			task.agents.push({
				key: `agent:${run.workflowRunId}:${step.index}`,
				kind: "agent",
				name: step.label ?? step.agent ?? run.agent ?? "subagent",
				state: normalizeFleetState(step.status ?? run.state),
				updatedAt: Number(step.lastActivityAt ?? run.updatedAt ?? 0),
				workItemId: run.workItemId,
				workflowRunId: run.workflowRunId,
				runId: run.runId,
				asyncDir: run.asyncDir,
				index: step.index,
				step,
				status: run.status,
				cwd: run.cwd,
			});
		}
		task.updatedAt = Math.max(task.updatedAt, Number(run.updatedAt ?? 0));
		tasks.set(run.workItemId, task);
	}
	for (const task of tasks.values()) {
		task.agents.sort(byActiveThenRecent);
		task.state = taskState(store?.items?.[task.id] ?? {}, task.agents);
	}
	return [...tasks.values()].sort(byActiveThenRecent);
}

function readJson(file) {
	try {
		return JSON.parse(readFileSync(file, "utf8"));
	} catch {
		return undefined;
	}
}

function pendingRuns(cwd, readFile = readFileSync) {
	const file = join(cwd, ".pi", "work-runs", "direct", "pending-direct.jsonl");
	let text;
	try {
		text = readFile(file, "utf8");
	} catch {
		return [];
	}
	const pending = new Map();
	const completed = new Set();
	for (const line of text.split(/\r?\n/)) {
		if (!line) continue;
		try {
			const event = JSON.parse(line);
			if (event.type === "pending" && event.workflowRunId)
				pending.set(event.workflowRunId, event);
			if (event.type === "completed" && event.workflowRunId)
				completed.add(event.workflowRunId);
		} catch {
			// A concurrently appended partial line is retried on the next refresh.
		}
	}
	return [...pending.values()].map((run) => ({
		...run,
		completed: completed.has(run.workflowRunId),
	}));
}

function runRecord(cwd, run) {
	const status = run.asyncDir
		? readJson(join(run.asyncDir, "status.json"))
		: undefined;
	let rawState = status?.state ?? status?.status ?? run.state;
	if (run.authoritativeState) rawState = run.state;
	else if (!rawState) rawState = run.completed ? "completed" : "queued";
	const state = normalizeFleetState(rawState);
	const rawSteps =
		Array.isArray(status?.steps) && status.steps.length
			? status.steps
			: [{ agent: run.agent, status: state, index: 0 }];
	return {
		...run,
		key: run.workflowRunId,
		cwd,
		status,
		state,
		runId: status?.runId ?? run.runId,
		updatedAt: fleetTimestamp(
			status?.updatedAt ?? status?.lastUpdate ?? run.timestamp,
		),
		steps: rawSteps.map((step, index) => ({
			...step,
			label: step.label ?? run.label,
			index: Number.isInteger(step.index) ? step.index : index,
		})),
	};
}

function supportRuns(
	cwd,
	{
		loadLanes = loadLaneStore,
		loadVerifiers = loadVerifierStore,
		fallbackWorkItemId = "background",
	} = {},
) {
	const runs = [];
	try {
		for (const lane of Object.values(loadLanes(cwd).lanes ?? {}))
			runs.push(
				runRecord(cwd, {
					workflowRunId: lane.id,
					workItemId: lane.workItemId,
					agent: lane.producer,
					label:
						lane.laneKind === "successor-prefetch" ? "work-prefetch" : lane.producer,
					runId: lane.launch?.runId,
					asyncDir: lane.launch?.asyncDir,
					state: lane.state,
					authoritativeState: true,
					timestamp: lane.timestamps?.updatedAt,
				}),
			);
	} catch {
		// Optional lane state must not hide direct runs.
	}
	try {
		const verifierStore = loadVerifiers(cwd);
		for (const job of Object.values(verifierStore.jobs ?? {})) {
			const batch = verifierStore.batches?.[job.batchId];
			const launch = job.launch ?? {};
			runs.push(
				runRecord(cwd, {
					workflowRunId: job.id,
					workItemId: batch?.workItemId ?? fallbackWorkItemId,
					agent: "work-background-verifier",
					label: `Verifier · ${job.model}`,
					runId: launch.runId,
					asyncDir: launch.asyncDir,
					state: job.status,
					authoritativeState: true,
					timestamp:
						launch.failedAt ??
						launch.orphanedAt ??
						launch.launchedAt ??
						launch.queuedAt ??
						job.createdAt,
				}),
			);
		}
	} catch {
		// A missing verifier store is normal.
	}
	return runs;
}

function recentOrchestrator(cwd, store, readFile = readFileSync) {
	let state;
	try {
		state = JSON.parse(
			readFile(join(cwd, ".pi", "work-orchestrator-state.json"), "utf8"),
		);
	} catch {
		return undefined;
	}
	const target = store?.items?.[state?.lastEpicId];
	if (!target) return undefined;
	return {
		id: `recent:${target.id}`,
		targetId: target.id,
		name: `Orchestrator · ${target.title ?? target.displayMetadata?.title ?? target.id}`,
		state: target.status,
		updatedAt: Date.parse(target.updatedAt ?? state.updatedAt ?? "") || 0,
		objective: target.description,
	};
}

function belongsToTarget(store, id, targetId) {
	if (!targetId || id === targetId) return true;
	const seen = new Set();
	let item = store?.items?.[id];
	while (item?.parentId && !seen.has(item.parentId)) {
		if (item.parentId === targetId) return true;
		seen.add(item.parentId);
		item = store?.items?.[item.parentId];
	}
	return false;
}

function orchestratorRoot(orchestrator, tasks, store) {
	if (!orchestrator) return undefined;
	const agents = tasks
		.flatMap((task) => {
			let taskAgents = [];
			if (belongsToTarget(store, task.id, orchestrator.targetId))
				taskAgents = task.agents;
			else if (task.id === "background")
				taskAgents = task.agents.filter((agent) => ACTIVE_STATES.has(agent.state));
			return taskAgents.map((agent) => ({
				...agent,
				name: task.id === "background" ? agent.name : `${task.id} · ${agent.name}`,
			}));
		})
		.sort(byActiveThenRecent);
	const rootState = normalizeFleetState(orchestrator.state);
	return {
		...orchestrator,
		key: `orchestrator:${orchestrator.id ?? "main"}`,
		kind: "orchestrator",
		id: orchestrator.id ?? "main",
		name: orchestrator.name ?? "Orchestrator",
		state: rootState,
		updatedAt: Math.max(
			Number(orchestrator.updatedAt ?? 0),
			...agents.map((agent) => Number(agent.updatedAt ?? 0)),
		),
		agents,
	};
}

export function collectWorkFleet(
	cwd,
	{ readFile = readFileSync, orchestrator, loadLanes, loadVerifiers } = {},
) {
	let store = { items: {} };
	let error;
	try {
		store = loadStore(cwd);
	} catch (cause) {
		error = cause instanceof Error ? cause.message : String(cause);
	}
	const selectedOrchestrator =
		orchestrator ?? recentOrchestrator(cwd, store, readFile);
	const direct = pendingRuns(cwd, readFile).map((run) => runRecord(cwd, run));
	const runs = [
		...direct,
		...supportRuns(cwd, {
			loadLanes,
			loadVerifiers,
			fallbackWorkItemId: "background",
		}),
	];
	const active = runs.filter((run) => ACTIVE_STATES.has(run.state));
	const recent = runs
		.filter((run) => !ACTIVE_STATES.has(run.state))
		.sort(byActiveThenRecent)
		.slice(0, RECENT_TERMINAL_LIMIT);
	const grouped = groupWorkFleet(store, [...active, ...recent]);
	const root = orchestratorRoot(selectedOrchestrator, grouped, store);
	const tasks = root ? [root] : grouped;
	return {
		tasks,
		rows: tasks.flatMap((task) => [task, ...task.agents]),
		...(error ? { error } : {}),
	};
}

export function fleetMessageTarget(row) {
	if (
		row?.kind !== "agent" ||
		!LIVE_STATES.has(normalizeFleetState(row.state)) ||
		!row.runId
	)
		return undefined;
	return {
		id: row.runId,
		...(Number.isInteger(row.index) ? { index: row.index } : {}),
	};
}

export async function sendFleetMessage(pi, row, message, timeoutMs = 8_000) {
	const target = fleetMessageTarget(row);
	const text = String(message ?? "").trim();
	if (!target)
		throw new Error("Select a live subagent before sending a message.");
	if (!text) throw new Error("Message cannot be empty.");
	if (!pi?.events?.on || !pi?.events?.emit)
		throw new Error("pi-subagents RPC is unavailable.");
	const requestId = randomUUID();
	return await new Promise((resolvePromise, reject) => {
		let settled = false;
		let unsubscribe;
		const finish = (error, value) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			try {
				unsubscribe?.();
			} catch {}
			if (error) reject(error);
			else resolvePromise(value);
		};
		const timer = setTimeout(
			() => finish(new Error("pi-subagents steering timed out.")),
			timeoutMs,
		);
		timer.unref?.();
		try {
			unsubscribe = pi.events.on(
				`subagents:rpc:v1:reply:${requestId}`,
				(reply) => {
					if (reply?.success) finish(undefined, reply.data);
					else
						finish(
							new Error(reply?.error?.message ?? "pi-subagents steering failed."),
						);
				},
			);
			pi.events.emit("subagents:rpc:v1:request", {
				version: 1,
				requestId,
				method: "steer",
				params: { ...target, message: text },
				source: { extension: "ce-workflow-fleet" },
			});
		} catch (error) {
			finish(error);
		}
	});
}

function visibleWidth(value) {
	return String(value ?? "").replace(ANSI, "").length;
}

function truncate(value, width) {
	const text = String(value ?? "");
	if (visibleWidth(text) <= width) return text;
	if (width <= 1) return "…".slice(0, width);
	let output = "";
	for (const char of text.replace(ANSI, "")) {
		if (visibleWidth(output) >= width - 1) break;
		output += char;
	}
	return `${output}…`;
}

function fit(value, width) {
	const clipped = truncate(value, Math.max(0, width));
	return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
}

function rightAligned(left, right, width) {
	const rightWidth = Math.min(visibleWidth(right), Math.max(0, width - 1));
	const leftWidth = Math.max(0, width - rightWidth - 1);
	return `${fit(left, leftWidth)} ${fit(right, rightWidth)}`;
}

function wrap(value, width) {
	const text = String(value ?? "");
	if (!text) return [""];
	const lines = [];
	for (const source of text.split(/\r?\n/)) {
		if (!source) {
			lines.push("");
			continue;
		}
		let remaining = source;
		while (remaining.length > width) {
			let cut = remaining.lastIndexOf(" ", width);
			if (cut < 1) cut = width;
			lines.push(remaining.slice(0, cut));
			remaining = remaining.slice(cut).trimStart();
		}
		lines.push(remaining);
	}
	return lines;
}

function pathWithin(base, candidate) {
	const root = resolve(base);
	const file = resolve(candidate);
	return file === root || file.startsWith(`${root}${sep}`);
}

function trustedFile(file, roots) {
	if (!file) return undefined;
	const resolvedFile = resolve(file);
	if (!roots.some((root) => pathWithin(root, resolvedFile))) return undefined;
	try {
		if (lstatSync(resolvedFile).isSymbolicLink()) return undefined;
		const realFile = realpathSync(resolvedFile);
		const realRoots = roots.filter(existsSync).map((root) => realpathSync(root));
		return realRoots.some((root) => pathWithin(root, realFile))
			? realFile
			: undefined;
	} catch {
		return undefined;
	}
}

function tailLines(file, maxBytes = 2 * 1024 * 1024) {
	let fd;
	try {
		fd = openSync(file, "r");
		const stat = fstatSync(fd);
		const size = Math.min(stat.size, maxBytes);
		const buffer = Buffer.alloc(size);
		readSync(fd, buffer, 0, size, stat.size - size);
		const lines = buffer.toString("utf8").split(/\r?\n/);
		if (stat.size > size) lines.shift();
		return lines.filter(Boolean).slice(-240);
	} catch {
		return [];
	} finally {
		if (fd !== undefined) closeSync(fd);
	}
}

function fleetTimestamp(value) {
	if (Number.isFinite(value)) return Number(value);
	return Date.parse(value ?? "") || Date.now();
}

function contentText(value) {
	if (typeof value === "string") return value;
	if (!Array.isArray(value)) return "";
	return value
		.map((part) => {
			if (typeof part === "string") return part;
			return part?.type === "text" ? part.text : "";
		})
		.filter(Boolean)
		.join("\n");
}

export function transcriptEvents(
	row,
	{ readFile = readFileSync, sessionFile = process.env.PI_SESSION_FILE } = {},
) {
	const step = row.step ?? {};
	const projectRoots = [
		join(row.cwd, ".pi", "subagents"),
		join(row.cwd, ".pi-subagents"),
	];
	const sessionRunRoot = sessionFile
		? sessionFile.replace(/\.jsonl$/i, "")
		: undefined;
	const asyncRoot =
		row.asyncDir &&
		[...projectRoots, sessionRunRoot]
			.filter(Boolean)
			.some(
				(root) =>
					resolve(root) !== resolve(row.asyncDir) && pathWithin(root, row.asyncDir),
			)
			? row.asyncDir
			: undefined;
	const roots = [
		asyncRoot,
		...projectRoots,
		sessionFile ? join(dirname(sessionFile), "subagent-artifacts") : undefined,
	].filter(Boolean);
	let requested;
	if (step.transcriptPath) {
		requested = isAbsolute(step.transcriptPath)
			? step.transcriptPath
			: resolve(row.asyncDir, step.transcriptPath);
	}
	const transcript = trustedFile(requested, roots);
	if (!transcript) {
		const output = trustedFile(
			join(row.asyncDir ?? "", `output-${row.index ?? 0}.log`),
			roots,
		);
		if (!output) return [];
		try {
			return [{ kind: "assistant", text: readFile(output, "utf8") }];
		} catch {
			return [];
		}
	}
	const events = [];
	const tools = new Map();
	for (const line of tailLines(transcript)) {
		let record;
		try {
			record = JSON.parse(line);
		} catch {
			continue;
		}
		if (record.recordType === "tool_start") {
			const tool = {
				kind: "tool",
				id: record.toolCallId,
				name: record.toolName ?? "tool",
				args: record.argsPreview,
				argsPayload: record.argsPayload,
				status: "running",
			};
			tools.set(tool.id, tool);
			events.push(tool);
			continue;
		}
		if (record.recordType === "tool_end") {
			const tool = tools.get(record.toolCallId);
			if (tool) tool.status = record.isError ? "failed" : "completed";
			continue;
		}
		if (record.recordType !== "message") continue;
		const message = record.message ?? {};
		const role = record.role ?? message.role;
		const text = record.text ?? message.text ?? contentText(message.content);
		if (["toolResult", "tool_result"].includes(role)) {
			const tool = tools.get(record.toolCallId ?? message.toolCallId);
			if (tool) {
				tool.output = text;
				tool.status = record.isError || message.isError ? "failed" : "completed";
			}
		} else if (
			["assistant", "user"].includes(role) &&
			String(text ?? "").trim()
		) {
			events.push({
				kind: role,
				text: String(text).trim(),
				model: record.model,
			});
		}
	}
	return events;
}

function statusColor(state) {
	const normalized = normalizeFleetState(state);
	if (normalized === "running") return "accent";
	if (normalized === "queued") return "muted";
	if (normalized === "completed") return "success";
	if (["waiting", "paused", "stopped"].includes(normalized)) return "warning";
	return "error";
}

function styledStatus(row, theme) {
	return theme.fg(statusColor(row.state), fleetStatusSymbol(row.state));
}

function renderTranscript(row, width, theme, expandedTools) {
	const lines = [];
	for (const event of transcriptEvents(row)) {
		if (event.kind === "tool") {
			lines.push(
				`${theme.fg("borderMuted", "├─")} ${theme.fg(statusColor(event.status), fleetStatusSymbol(event.status))} ${theme.fg("toolTitle", theme.bold(event.name))}${event.args ? theme.fg("dim", ` ${event.args}`) : ""}`,
			);
			if (expandedTools) {
				for (const text of [
					event.argsPayload && `args: ${event.argsPayload}`,
					event.output && `output: ${event.output}`,
				].filter(Boolean))
					for (const line of wrap(text, Math.max(1, width - 4)))
						lines.push(
							`${theme.fg("borderMuted", "│")}   ${theme.fg("toolOutput", line)}`,
						);
			}
			continue;
		}
		const assistant = event.kind === "assistant";
		lines.push(
			`${assistant ? theme.fg("accent", "◆") : theme.fg("warning", "◇")} ${theme.bold(assistant ? "Assistant" : "Supervisor")}${event.model ? theme.fg("dim", ` · ${event.model}`) : ""}`,
		);
		for (const line of wrap(event.text, Math.max(1, width - 2)))
			lines.push(`${theme.fg("borderMuted", "│")} ${line}`);
		lines.push(theme.fg("borderMuted", "│"));
	}
	return lines.length ? lines : [theme.fg("dim", "No transcript activity yet.")];
}

function activityLine(row) {
	const step = row.step ?? {};
	const status = row.status ?? {};
	const parts = [
		step.activityState ?? status.activityState,
		(step.currentTool ?? status.currentTool) &&
			`tool ${step.currentTool ?? status.currentTool}`,
		step.currentPath ?? status.currentPath,
	].filter(Boolean);
	return parts.length ? parts.join(" · ") : "waiting for activity";
}

function detailSections(row, width, theme, expandedTools, error) {
	if (!row)
		return {
			header: [],
			body: [theme.fg("dim", error ?? "No ce-workflow background tasks.")],
		};
	if (["task", "orchestrator"].includes(row.kind)) {
		const active = row.agents.filter((agent) =>
			["running", "queued"].includes(agent.state),
		).length;
		let subtitle = `Task ${row.id} · ${row.state}`;
		if (row.kind === "orchestrator") {
			const iteration = Number.isInteger(row.iteration)
				? ` · iteration ${row.iteration}`
				: "";
			subtitle = `Main chat · ${row.state}${iteration}`;
		}
		return {
			header: [
				theme.bold(`${styledStatus(row, theme)} ${row.name}`),
				theme.fg("dim", subtitle),
			],
			body: [
				`${row.agents.length} subagent${row.agents.length === 1 ? "" : "s"} · ${active} active`,
				"",
				...row.agents.map(
					(agent) =>
						`${fleetStatusSymbol(agent.state)} ${agent.name} · ${agent.state}`,
				),
			],
		};
	}
	const step = row.step ?? {};
	const stats = [
		Number.isFinite(step.turnCount) ? `${step.turnCount} turns` : undefined,
		Number.isFinite(step.toolCount) ? `${step.toolCount} tools` : undefined,
		Number.isFinite(step.tokens?.total)
			? `${step.tokens.total} tokens`
			: undefined,
	].filter(Boolean);
	return {
		header: [
			theme.bold(`${styledStatus(row, theme)} ${row.name}`),
			theme.fg(
				"dim",
				`Run ${row.runId} · child ${(row.index ?? 0) + 1} · ${row.state}`,
			),
			theme.fg("muted", `Activity · ${activityLine(row)}`),
			...(stats.length ? [theme.fg("dim", stats.join(" · "))] : []),
		],
		body: renderTranscript(row, width, theme, expandedTools),
	};
}

function rosterLines(snapshot, selected, height, width, theme) {
	if (!snapshot.rows.length) return [theme.fg("dim", "No tracked tasks")];
	const start = Math.max(
		0,
		Math.min(selected - height + 1, Math.max(0, snapshot.rows.length - height)),
	);
	return snapshot.rows.slice(start, start + height).map((row, offset) => {
		const text = `${row.kind === "agent" ? "  " : ""}${styledStatus(row, theme)} ${row.name}`;
		return start + offset === selected
			? theme.bg("selectedBg", fit(text, width))
			: fit(text, width);
	});
}

export class WorkFleetComponent {
	constructor(tui, theme, cwd, pi, done, options = {}) {
		this.tui = tui;
		this.theme = theme;
		this.cwd = cwd;
		this.pi = pi;
		this.done = done;
		this.matchesKey = options.matchesKey ?? legacyMatchesKey;
		this.decodeKittyPrintable = options.decodeKittyPrintable ?? (() => undefined);
		this.refreshMs = options.refreshMs ?? REFRESH_MS;
		this.getOrchestrator = options.getOrchestrator;
		this.orchestrator = options.orchestrator;
		this.snapshot = { tasks: [], rows: [] };
		this.selected = 0;
		this.selectedKey = options.initialKey;
		this.detailScroll = 0;
		this.autoFollow = true;
		this.expandedTools = false;
		this.editor = undefined;
		this.refresh();
		this.timer = setInterval(() => {
			this.refresh();
			this.tui.requestRender();
		}, this.refreshMs);
		this.timer.unref?.();
	}

	refresh() {
		const key = this.snapshot.rows[this.selected]?.key ?? this.selectedKey;
		this.snapshot = collectWorkFleet(this.cwd, {
			orchestrator: this.getOrchestrator?.() ?? this.orchestrator,
		});
		const retained = key
			? this.snapshot.rows.findIndex((row) => row.key === key)
			: -1;
		this.selected =
			retained >= 0
				? retained
				: Math.min(this.selected, Math.max(0, this.snapshot.rows.length - 1));
		this.selectedKey = this.snapshot.rows[this.selected]?.key;
	}

	move(delta) {
		if (!this.snapshot.rows.length) return;
		this.selected = Math.max(
			0,
			Math.min(this.snapshot.rows.length - 1, this.selected + delta),
		);
		this.selectedKey = this.snapshot.rows[this.selected]?.key;
		this.autoFollow = true;
		this.detailScroll = 0;
		this.tui.requestRender();
	}

	scroll(delta) {
		const max = Math.max(0, this.detailLineCount - this.detailViewportHeight);
		this.detailScroll = Math.max(0, Math.min(max, this.detailScroll + delta));
		this.autoFollow = this.detailScroll >= max;
		this.tui.requestRender();
	}

	handleInput(data) {
		if (this.editor) return this.handleEditorInput(data);
		if (
			this.matchesKey(data, "escape") ||
			this.matchesKey(data, "ctrl+c") ||
			this.matchesKey(data, "q")
		)
			return this.done();
		if (this.matchesKey(data, "shift+k")) return this.scroll(-1);
		if (this.matchesKey(data, "shift+j")) return this.scroll(1);
		if (this.matchesKey(data, "up") || this.matchesKey(data, "k"))
			return this.move(-1);
		if (this.matchesKey(data, "down") || this.matchesKey(data, "j"))
			return this.move(1);
		if (this.matchesKey(data, "pageUp"))
			return this.scroll(-this.detailViewportHeight);
		if (this.matchesKey(data, "pageDown"))
			return this.scroll(this.detailViewportHeight);
		if (this.matchesKey(data, "r")) {
			this.refresh();
			return this.tui.requestRender();
		}
		if (this.matchesKey(data, "x") || this.matchesKey(data, "ctrl+o")) {
			this.expandedTools = !this.expandedTools;
			return this.tui.requestRender();
		}
		if (this.matchesKey(data, "enter")) {
			const row = this.snapshot.rows[this.selected];
			if (fleetMessageTarget(row)) {
				this.editor = { targetKey: row.key, text: "", sending: false };
				this.tui.requestRender();
			}
		}
	}

	handleEditorInput(data) {
		if (this.matchesKey(data, "escape")) {
			this.editor = undefined;
			return this.tui.requestRender();
		}
		if (this.editor.sending) return;
		if (this.matchesKey(data, "enter")) {
			const editor = this.editor;
			const row = this.snapshot.rows.find(
				(candidate) => candidate.key === editor.targetKey,
			);
			if (!editor.text.trim()) return;
			editor.sending = true;
			editor.note = "sending…";
			this.tui.requestRender();
			void sendFleetMessage(this.pi, row, editor.text)
				.then(() => {
					if (this.editor !== editor) return;
					this.editor = undefined;
					this.refresh();
					this.tui.requestRender();
				})
				.catch((error) => {
					if (this.editor !== editor) return;
					editor.sending = false;
					editor.note = error instanceof Error ? error.message : String(error);
					this.tui.requestRender();
				});
			return;
		}
		if (this.matchesKey(data, "backspace"))
			this.editor.text = [...this.editor.text].slice(0, -1).join("");
		else if (this.matchesKey(data, "ctrl+u")) this.editor.text = "";
		else {
			const text =
				this.decodeKittyPrintable(data) ??
				data.replace(/^\x1b\[200~/, "").replace(/\x1b\[201~$/, "");
			if (text && !/[\x00-\x1f\x7f]/u.test(text)) this.editor.text += text;
		}
		this.editor.note = undefined;
		this.tui.requestRender();
	}

	render(width) {
		if (width < 50)
			return [truncate("Fleet needs at least 50 columns. Esc closes.", width)];
		const inner = width - 2;
		const height = Math.max(10, (this.tui.terminal?.rows ?? 24) - 1);
		const bodyHeight = Math.max(3, height - 7 - (this.editor ? 1 : 0));
		const leftWidth = Math.max(18, Math.min(32, Math.floor((inner - 1) * 0.26)));
		const rightWidth = inner - leftWidth - 1;
		const roster = rosterLines(
			this.snapshot,
			this.selected,
			bodyHeight,
			leftWidth,
			this.theme,
		);
		const selected = this.snapshot.rows[this.selected];
		const detail = detailSections(
			selected,
			rightWidth,
			this.theme,
			this.expandedTools,
			this.snapshot.error,
		);
		const detailHeader = detail.header.slice(0, Math.max(0, bodyHeight - 1));
		this.detailViewportHeight = Math.max(1, bodyHeight - detailHeader.length);
		this.detailLineCount = detail.body.length;
		const maxScroll = Math.max(0, detail.body.length - this.detailViewportHeight);
		if (this.autoFollow) this.detailScroll = maxScroll;
		else this.detailScroll = Math.min(this.detailScroll, maxScroll);
		const visibleDetail = [
			...detailHeader,
			...detail.body.slice(
				this.detailScroll,
				this.detailScroll + this.detailViewportHeight,
			),
		];
		const lines = [this.theme.fg("border", `╭${"─".repeat(inner)}╮`)];
		const selectedStatus = selected
			? `${styledStatus(selected, this.theme)} ${selected.name} · ${selected.state}`
			: "no tasks";
		lines.push(
			`${this.theme.fg("border", "│")}${rightAligned(` ${this.theme.bold("Fleet")}`, `${selectedStatus} `, inner)}${this.theme.fg("border", "│")}`,
		);
		lines.push(
			`${this.theme.fg("border", "│")}${fit(this.theme.fg("muted", " Monitor the main orchestrator and every background agent."), inner)}${this.theme.fg("border", "│")}`,
		);
		lines.push(
			this.theme.fg(
				"border",
				`├${"─".repeat(leftWidth)}┬${"─".repeat(rightWidth)}┤`,
			),
		);
		for (let index = 0; index < bodyHeight; index++) {
			lines.push(
				`${this.theme.fg("border", "│")}${fit(roster[index] ?? "", leftWidth)}${this.theme.fg("border", "│")}${fit(visibleDetail[index] ?? "", rightWidth)}${this.theme.fg("border", "│")}`,
			);
		}
		if (this.editor) {
			const prompt = ` Message to ${selected?.name ?? "subagent"}: ${this.editor.text}${this.editor.sending ? "" : "▌"}${this.editor.note ? ` · ${this.editor.note}` : ""}`;
			lines.push(
				`${this.theme.fg("border", "│")}${fit(this.theme.fg(this.editor.note && this.editor.note !== "sending…" ? "error" : "accent", prompt), inner)}${this.theme.fg("border", "│")}`,
			);
		}
		lines.push(
			this.theme.fg(
				"border",
				`├${"─".repeat(leftWidth)}┴${"─".repeat(rightWidth)}┤`,
			),
		);
		const position = this.snapshot.rows.length
			? `${this.selected + 1}/${this.snapshot.rows.length}`
			: "0/0";
		const footer = ` ↑↓/jk agent · ⇧k/⇧j scroll · PgUp/PgDn page · x/Ctrl+O tools · r refresh · Enter send message · Esc close · ${position}`;
		lines.push(
			`${this.theme.fg("border", "│")}${fit(this.theme.fg("dim", footer), inner)}${this.theme.fg("border", "│")}`,
		);
		lines.push(this.theme.fg("border", `╰${"─".repeat(inner)}╯`));
		return lines.map((line) => truncate(line, width));
	}

	invalidate() {
		this.refresh();
	}

	dispose() {
		clearInterval(this.timer);
	}
}

export function formatWorkFleetText(snapshot) {
	if (!snapshot.tasks.length)
		return snapshot.error ?? "No ce-workflow background tasks.";
	return snapshot.tasks
		.flatMap((task) => [
			`${fleetStatusSymbol(task.state)} ${task.name}`,
			...task.agents.map(
				(agent) => `  ${fleetStatusSymbol(agent.state)} ${agent.name}`,
			),
		])
		.join("\n");
}

export async function openWorkFleet(ctx, pi, options = {}) {
	const snapshot = collectWorkFleet(ctx.cwd, {
		orchestrator: options.getOrchestrator?.() ?? options.orchestrator,
	});
	if (ctx.mode !== "tui" || typeof ctx.ui.custom !== "function") {
		ctx.ui.notify?.(
			formatWorkFleetText(snapshot),
			snapshot.error ? "warning" : "info",
		);
		return;
	}
	await ctx.ui.custom(
		(tui, theme, _keybindings, done) =>
			new WorkFleetComponent(tui, theme, ctx.cwd, pi, done, options),
		{
			overlay: true,
			overlayOptions: {
				anchor: "top-left",
				width: "100%",
				maxHeight: "100%",
				margin: { right: 1 },
			},
		},
	);
}
