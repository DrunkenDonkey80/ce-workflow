import { execFileSync } from "node:child_process";
import {
	appendFileSync,
	existsSync,
	mkdirSync,
	closeSync,
	openSync,
	readdirSync,
	readFileSync,
	writeFileSync,
	writeSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import {
	basename,
	delimiter,
	dirname,
	isAbsolute,
	join,
	relative,
	resolve,
} from "node:path";

const CONFIG_DIR_NAME = ".pi";
const TELEMETRY_DIR_NAME = "work-runs";
const WORK_STATE_FILE = "work-orchestrator-state.json";
const INHERIT_MODEL = "__inherit_model__";
const DEFAULT_THINKING = "__default_thinking__";
const RESET_ALL = "__reset_all__";
const IDEA_LABEL = "wo:idea";
const IDEA_SCHEMA_VERSION = 1;
const BRAINSTORM_TITLE_MAX = 180;
const SUBAGENT_EXTRA_AGENT_DIRS_ENV = "PI_SUBAGENT_EXTRA_AGENT_DIRS";
const WORKFLOW_REPO_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WORK_ORCH_AGENT_DIR = resolve(WORKFLOW_REPO_DIR, "agents");

function exposeBundledSubagentAgents() {
	if (!existsSync(WORK_ORCH_AGENT_DIR)) return;
	const current = process.env[SUBAGENT_EXTRA_AGENT_DIRS_ENV] ?? "";
	const entries = current.split(delimiter).filter(Boolean);
	const normalized =
		process.platform === "win32"
			? WORK_ORCH_AGENT_DIR.toLowerCase()
			: WORK_ORCH_AGENT_DIR;
	if (
		entries.some(
			(entry) =>
				(process.platform === "win32"
					? resolve(entry).toLowerCase()
					: resolve(entry)) === normalized,
		)
	)
		return;
	process.env[SUBAGENT_EXTRA_AGENT_DIRS_ENV] = [
		...entries,
		WORK_ORCH_AGENT_DIR,
	].join(delimiter);
}

const SLOTS = [
	{
		key: "plan",
		label: "brainstorm/plan/migration",
		agents: ["bead-planner", "bead-migrator"],
		defaultThinking: "high",
		description: "Creating or importing epics and slicing executable Beads",
	},
	{
		key: "work",
		label: "work",
		agents: ["bead-worker", "bead-fixer"],
		defaultThinking: "medium",
		description: "Implementation and reviewer-requested fixes",
	},
	{
		key: "debug",
		label: "debug",
		agents: ["bead-debugger"],
		defaultThinking: "high",
		description: "Root-cause investigation and bug fixes",
	},
	{
		key: "review",
		label: "review",
		agents: ["bead-reviewer"],
		defaultThinking: "medium",
		description: "Read-only diff/acceptance/verification review",
	},
	{
		key: "commit",
		label: "commit",
		agents: ["bead-committer"],
		defaultThinking: "low",
		description: "Verification gate, commit, and Bead close",
	},
];

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"];
const DEFAULT_CONTEXT = {
	enabled: true,
	autoCompact: false,
	compactAtTokens: 150_000,
	keepRecentTokens: 30_000,
	maxSummaryChars: 12_000,
};
const MIN_COMPACT_AT_TOKENS = 30_000;
const contextCompactState = { inFlight: false, requested: false };
let pendingWorkPrompt = null;
let activeWorkAgent = null;
let activeWorkGoal = null;
let workGoalContinuationPending = null;
let workGoalContinuationRetry = null;
let workGoalProgressTimer = null;

const WORK_GOAL_STATE_ENTRY_TYPE = "work-goal-state";
const WORK_GOAL_STATUS_KEY = "work-goal";
const WORK_GOAL_PROGRESS_WIDGET_KEY = "work-goal-progress";
const WORK_GOAL_COMPLETE_MARKER = "WORK_GOAL_COMPLETE";
const WORK_GOAL_DECISION_MARKER = "WORK_GOAL_NEEDS_HUMAN_DECISION";
const WORK_GOAL_CONTINUATION_PREFIX = "work-goal-continuation:";
const WORK_GOAL_TOOL_SCHEMA = {
	type: "object",
	properties: {
		summary: { type: "string", description: "Completion or decision summary" },
		question: { type: "string", description: "Human decision question" },
		whyUserNeeded: {
			type: "string",
			description: "Why the agent cannot decide safely",
		},
		options: { type: "string", description: "Known options, if any" },
		recommendation: {
			type: "string",
			description: "Recommended option, if one exists",
		},
	},
	additionalProperties: false,
};

function settingsPath(cwd) {
	return join(cwd, CONFIG_DIR_NAME, "settings.json");
}

function readSettings(cwd) {
	const file = settingsPath(cwd);
	if (!existsSync(file)) return {};
	try {
		return JSON.parse(readFileSync(file, "utf8"));
	} catch {
		return {};
	}
}

function writeSettings(cwd, settings) {
	const dir = join(cwd, CONFIG_DIR_NAME);
	mkdirSync(dir, { recursive: true });
	writeFileSync(settingsPath(cwd), `${JSON.stringify(settings, null, "\t")}\n`);
}

const WARP_TITLE = "warp://cli-agent";
const WORK_WARP_ICONS = {
	goal: "◎",
	project: "▣",
	plan: "◇",
	brainstorm: "✦",
	ideate: "✦",
	debug: "⚑",
	work: "●",
};

function warpSettings(cwd) {
	const value = readSettings(cwd).warp;
	return typeof value === "object" && value !== null
		? value
		: { enabled: value };
}

function warpNotificationEnabled(ctx) {
	if (!ctx?.cwd) return false;
	const setting = warpSettings(ctx.cwd).enabled;
	if (setting === false) return false;
	if (setting === true || setting === "force") return true;
	return (
		process.env.TERM_PROGRAM === "WarpTerminal" &&
		Boolean(process.env.WARP_CLI_AGENT_PROTOCOL_VERSION)
	);
}

function writeTerminal(bytes) {
	if (process.platform === "win32") {
		if (process.stdout.isTTY) process.stdout.write(bytes);
		return;
	}
	let fd;
	try {
		fd = openSync("/dev/tty", "w");
		writeSync(fd, bytes);
	} catch {
		// no controlling terminal; stay quiet
	} finally {
		if (fd !== undefined) {
			try {
				closeSync(fd);
			} catch {
				// already closed
			}
		}
	}
}

function warpPayload(event, ctx, extra = {}) {
	const cwd = ctx?.cwd ?? process.cwd();
	const rawVersion = Number.parseInt(
		process.env.WARP_CLI_AGENT_PROTOCOL_VERSION ?? "1",
		10,
	);
	return {
		v: Number.isFinite(rawVersion) ? Math.min(rawVersion, 1) : 1,
		agent: "pi",
		event,
		session_id: ctx?.sessionManager?.getSessionId?.() ?? "work-orchestrator",
		cwd,
		project: basename(cwd),
		...extra,
	};
}

function emitWarp(ctx, event, extra = {}) {
	if (!warpNotificationEnabled(ctx)) return;
	writeTerminal(
		`\x1b]777;notify;${WARP_TITLE};${JSON.stringify(warpPayload(event, ctx, extra))}\x07`,
	);
}

function workWarpMode(mode, goal) {
	if (
		mode === "self-improving" &&
		/Project autopilot policy/.test(goal?.objective ?? "")
	)
		return "project";
	if (["generic", "self-improving"].includes(mode)) return "goal";
	if (
		["goal", "project", "plan", "brainstorm", "ideate", "debug"].includes(mode)
	)
		return mode;
	if (["big", "med", "master", "migrate", "small"].includes(mode))
		return "plan";
	return "work";
}

function workWarpTitle(mode, cwd) {
	return `${WORK_WARP_ICONS[workWarpMode(mode)] ?? WORK_WARP_ICONS.work} - ${basename(cwd)}`;
}

function setWarpTitle(ctx, title) {
	if (!warpNotificationEnabled(ctx)) return;
	writeTerminal(`\x1b]0;${title}\x07`);
}

function resetWarpTitle(ctx) {
	const cwd = ctx?.cwd ?? process.cwd();
	setWarpTitle(ctx, `π - ${basename(cwd)}`);
}

function startWarpWork(ctx, mode, query = "") {
	const cwd = ctx?.cwd ?? process.cwd();
	emitWarp(ctx, "session_start");
	emitWarp(ctx, "prompt_submit", { query: query || `/work-${mode}` });
	setWarpTitle(ctx, workWarpTitle(mode, cwd));
}

function finishWarpWork(ctx, mode, response = "") {
	const cwd = ctx?.cwd ?? process.cwd();
	emitWarp(ctx, "stop", {
		query: `/work-${mode}`,
		response: truncate(response, 200),
	});
	resetWarpTitle(ctx);
}

function pauseWarpForDecision(ctx, decision) {
	const cwd = ctx?.cwd ?? process.cwd();
	emitWarp(ctx, "question_asked", {
		query: decision?.question ?? "Human decision needed",
	});
	setWarpTitle(ctx, `? - ${basename(cwd)}`);
}

function telemetryDir(cwd) {
	return join(cwd, CONFIG_DIR_NAME, TELEMETRY_DIR_NAME);
}

function workStateDir(cwd) {
	return process.env.WORK_ORCH_STATE_DIR || join(cwd, CONFIG_DIR_NAME);
}

function workStatePath(cwd) {
	return join(workStateDir(cwd), WORK_STATE_FILE);
}

function readWorkState(cwd) {
	const file = workStatePath(cwd);
	if (!existsSync(file)) return {};
	try {
		return JSON.parse(readFileSync(file, "utf8"));
	} catch {
		return {};
	}
}

function writeWorkState(cwd, state) {
	mkdirSync(workStateDir(cwd), { recursive: true });
	writeFileSync(workStatePath(cwd), `${JSON.stringify(state, null, "\t")}\n`);
}

function rememberWorkflowEpic(cwd, epic) {
	if (!epic || typeOf(epic) !== "epic") return;
	const state = readWorkState(cwd);
	writeWorkState(cwd, {
		...state,
		lastEpicId: idOf(epic),
		lastEpicTitle: titleOf(epic),
		lastEpicStatus: statusOf(epic),
		updatedAt: new Date().toISOString(),
	});
}

function rememberedWorkflowEpic(cwd) {
	const id = readWorkState(cwd).lastEpicId;
	if (!id) return undefined;
	try {
		const epic = one(bdJsonRequired(cwd, ["show", id]));
		if (epic && typeOf(epic) === "epic" && statusOf(epic) !== "closed")
			return epic;
	} catch {
		return undefined;
	}
	return undefined;
}

function telemetryDay(timestamp = Date.now()) {
	return new Date(timestamp).toISOString().slice(0, 10);
}

function telemetryPath(cwd, day = telemetryDay()) {
	return join(telemetryDir(cwd), `${day}.jsonl`);
}

function telemetryId(prefix = "wr") {
	return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function usageSnapshot(ctx) {
	const usage = ctx?.getContextUsage?.();
	if (!usage) return undefined;
	const out = {};
	for (const key of [
		"tokens",
		"maxTokens",
		"remainingTokens",
		"percent",
		"contextWindow",
	]) {
		if (usage[key] !== undefined) out[key] = usage[key];
	}
	return Object.keys(out).length ? out : undefined;
}

function textChars(value) {
	if (value === undefined || value === null) return 0;
	if (typeof value === "string") return value.length;
	if (Array.isArray(value))
		return value.reduce((sum, item) => sum + textChars(item), 0);
	if (typeof value === "object") {
		if (typeof value.text === "string") return value.text.length;
		if (value.content) return textChars(value.content);
	}
	return String(value).length;
}

function handoffRole(action) {
	const text = String(action ?? "");
	if (text.includes("debug")) return "debugger";
	if (text.includes("review")) return "reviewer";
	if (text.includes("commit") || text.includes("finish")) return "committer";
	if (text.includes("planner") || text.includes("plan")) return "planner";
	if (text.includes("migrate")) return "migrator";
	if (text.includes("fix")) return "fixer";
	if (text.includes("implementation") || text.includes("work")) return "worker";
	return undefined;
}

function stopReason(state) {
	if (!state) return "unknown";
	if (state.ok === false)
		return state.action ?? state.reason ?? "command-error";
	if (state.git && state.git.safeForHandoff === false) return "dirty-worktree";
	if (state.action === "report-blocked" || state.action === "debug-blocked")
		return "blocked";
	if (state.action === "done-candidate") return "completed-slice";
	if (state.action === "close-stale-planning") return "planning-boundary";
	if (state.handoffPrompt) return "handoff-queued";
	if (state.suggestedCommands?.length) return "manual-next-step";
	return "completed-command";
}

function stateTelemetry(state) {
	const handoffQueued = Boolean(state?.handoffPrompt);
	const role = handoffRole(state?.action);
	return {
		ok: state?.ok !== false,
		action: state?.action,
		reason: state?.reason,
		stopReason: stopReason(state),
		epicId: state?.epic?.id,
		beadId: state?.selectedBead?.id ?? state?.bead?.id,
		beadType: state?.selectedBead?.type ?? state?.bead?.type,
		handoff: {
			queued: handoffQueued,
			started: false,
			role,
			reason: handoffQueued ? undefined : stopReason(state),
		},
		outputChars: state?.outputChars,
		counts: state?.counts,
		warnings: state?.warnings?.length
			? { count: state.warnings.length }
			: undefined,
	};
}

function telemetryFingerprint(event) {
	if (
		process.env.WORK_ORCH_TELEMETRY_DEDUPE_OFF === "1" ||
		event.type !== "command" ||
		event.command !== "work-resume" ||
		event.action !== "report-blocked"
	)
		return "";
	return [
		event.type,
		event.command,
		event.action,
		event.epicId ?? event.meta?.epicId ?? "",
		event.beadId ?? event.meta?.beadId ?? "",
		event.reason ?? "",
	].join("\u001f");
}

function duplicateTelemetryWindowMs() {
	const configured = Number(
		process.env.WORK_ORCH_TELEMETRY_BLOCKED_DEDUPE_MINUTES,
	);
	const minutes =
		Number.isFinite(configured) && configured >= 0 ? configured : 60;
	return minutes * 60 * 1000;
}

function isDuplicateTelemetry(file, record) {
	const fingerprint = telemetryFingerprint(record);
	if (!fingerprint || !existsSync(file)) return false;
	const recordAt = Date.parse(record.timestamp ?? "");
	if (!Number.isFinite(recordAt)) return false;
	const windowMs = duplicateTelemetryWindowMs();
	const lines = readFileSync(file, "utf8").trim().split(/\r?\n/);
	for (let index = lines.length - 1; index >= 0; index -= 1) {
		let previous;
		try {
			previous = JSON.parse(lines[index]);
		} catch {
			continue;
		}
		if (telemetryFingerprint(previous) !== fingerprint) continue;
		const previousAt = Date.parse(previous.timestamp ?? "");
		const ageMs = recordAt - previousAt;
		return Number.isFinite(previousAt) && ageMs >= 0 && ageMs < windowMs;
	}
	return false;
}

function recordWorkTelemetry(cwd, event) {
	if (!cwd || process.env.WORK_ORCH_TELEMETRY_OFF === "1") return "";
	const timestamp = event.timestamp ?? Date.now();
	const record = {
		version: 1,
		...event,
		id: event.id ?? telemetryId(),
		timestamp: new Date(timestamp).toISOString(),
	};
	const file = telemetryPath(cwd, telemetryDay(timestamp));
	mkdirSync(telemetryDir(cwd), { recursive: true });
	if (isDuplicateTelemetry(file, record)) return file;
	appendFileSync(file, `${JSON.stringify(record)}\n`);
	return file;
}

function appendTelemetryNote(cwd, beadId, event, file) {
	if (!beadId || process.env.WORK_ORCH_TELEMETRY_NOTES !== "1") return;
	const parts = [
		`telemetry: run=${event.id} type=${event.type} phase=${event.phase ?? event.command ?? event.mode ?? "work"} duration=${formatDuration(event.durationMs ?? 0)}`,
	];
	if (event.usage?.totalTokens) parts.push(`tokens=${event.usage.totalTokens}`);
	if (event.context?.after?.tokens)
		parts.push(`context_after=${event.context.after.tokens}`);
	if (file) parts.push(`artifact=${file}`);
	try {
		appendBeadNote(cwd, beadId, parts.join(" "));
	} catch {
		// Telemetry must never block work execution.
	}
}

function parseWorkPromptMeta(prompt) {
	const text = String(prompt ?? "");
	if (!text.includes("work-orchestrator")) return undefined;
	const lines = text.split(/\r?\n/);
	const line = (label) =>
		lines
			.find((item) => item.startsWith(`${label}:`))
			?.slice(label.length + 1)
			.trim();
	const epic = line("Epic") ?? "";
	const selected = line("Selected Bead") ?? "";
	const target = line("Target Bead ID") ?? "";
	const epicId = epic.match(/^([^\s]+)/)?.[1];
	const selectedId = selected.match(/^([^\s]+)/)?.[1];
	let beadId;
	if (target && target !== "none") beadId = target;
	else if (selectedId && !selectedId.startsWith("none")) beadId = selectedId;
	return {
		mode: text.match(/mode:\s*([^\s]+)/)?.[1],
		action: line("Action"),
		epicId: epicId === "none" ? undefined : epicId,
		beadId,
	};
}

function messageUsage(messages = []) {
	const usage = {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: 0,
	};
	for (const message of messages) {
		if (message?.role !== "assistant" || !message.usage) continue;
		usage.input += Number(message.usage.input ?? 0);
		usage.output += Number(message.usage.output ?? 0);
		usage.cacheRead += Number(message.usage.cacheRead ?? 0);
		usage.cacheWrite += Number(message.usage.cacheWrite ?? 0);
		usage.totalTokens += Number(message.usage.totalTokens ?? 0);
		usage.cost += Number(message.usage.cost?.total ?? 0);
	}
	return usage;
}

function summarizeMessages(messages = []) {
	return {
		count: messages.length,
		assistant: messages.filter((message) => message.role === "assistant")
			.length,
		tools: messages.filter((message) => message.role === "toolResult").length,
		chars: messages.reduce(
			(sum, message) => sum + textChars(message.content),
			0,
		),
	};
}

function latestMessageExcerpts(messages = [], limit = 4) {
	return messages
		.slice()
		.reverse()
		.filter((message) =>
			["assistant", "toolResult", "user"].includes(message.role),
		)
		.slice(0, limit)
		.reverse()
		.map(
			(message) =>
				`${message.role}: ${truncate(contentText(message.content ?? message.message), 260)}`,
		)
		.filter((line) => !line.endsWith(": "));
}

function failedSubagents(tools = []) {
	return tools
		.flatMap((tool) => tool.subagentDetails ?? [])
		.filter(
			(item) =>
				!["completed", "success", "ok", "passed"].includes(
					String(item.status ?? "").toLowerCase(),
				),
		);
}

function hasWorkAgentFailure(event, telemetry) {
	const assistant = finalAssistantMessage(event.messages);
	const text = assistantVisibleText(assistant);
	return Boolean(
		["aborted", "error"].includes(String(assistant?.stopReason ?? "")) ||
			telemetry.review?.outcome === "fail" ||
			telemetry.tools?.some((tool) => tool.isError) ||
			failedSubagents(telemetry.tools).length ||
			(/\b(fail(?:ed|ure)?|blocked|cannot|unable|timed? out|timeout|error)\b/i.test(
				text,
			) &&
				!/\bPASS\b/i.test(text.slice(0, 500))),
	);
}

function failureStatusNote(run, event, telemetry, file) {
	const assistant = finalAssistantMessage(event.messages);
	const finalText = truncate(assistantVisibleText(assistant), 900);
	const erroredTools = telemetry.tools?.filter((tool) => tool.isError) ?? [];
	const subagents = failedSubagents(telemetry.tools);
	const lines = [
		`wo:failure-summary run=${telemetry.id} role=${telemetry.role ?? "work"} action=${run.meta.action ?? run.meta.mode ?? "work"} duration=${formatDuration(telemetry.durationMs)}`,
		`reason: ${truncate(finalText || telemetry.review?.outcome || "work agent stopped without a passing result", 500)}`,
		file ? `artifact: ${file}` : "",
		...erroredTools
			.slice(0, 3)
			.map(
				(tool) =>
					`tool-error: ${tool.name} ${tool.runId ? `run=${tool.runId} ` : ""}${tool.outputChars ?? 0} chars`,
			),
		...subagents
			.slice(0, 3)
			.map(
				(item) =>
					`subagent: ${item.agent} status=${item.status}${item.artifact ? ` artifact=${item.artifact}` : ""}`,
			),
		...latestMessageExcerpts(event.messages).map((line) => `latest: ${line}`),
		run.meta.beadId ? `next: /work-report ${run.meta.beadId}` : "",
	];
	return lines.filter(Boolean).join("\n");
}

function appendFailureStatusNote(cwd, beadId, run, event, telemetry, file) {
	if (!beadId || !hasWorkAgentFailure(event, telemetry)) return;
	try {
		appendBeadNote(cwd, beadId, failureStatusNote(run, event, telemetry, file));
	} catch {
		// Failure-status capture must never mask the original task result.
	}
}

function parseToolArgs(args) {
	if (typeof args !== "string") return args ?? {};
	try {
		return JSON.parse(args);
	} catch {
		return {};
	}
}

function subagentNamesFromArgs(args) {
	const names = [];
	const visit = (value) => {
		if (!value || typeof value !== "object") return;
		if (typeof value.agent === "string") names.push(value.agent);
		if (Array.isArray(value.tasks)) {
			for (const task of value.tasks) {
				const count = Math.max(1, Number(task?.count ?? 1));
				for (let i = 0; i < count; i++) visit(task);
			}
		}
		if (Array.isArray(value.chain)) value.chain.forEach(visit);
		if (Array.isArray(value.parallel)) value.parallel.forEach(visit);
		else visit(value.parallel);
	};
	visit(parseToolArgs(args));
	return names;
}

function subagentUsageTotal(usage) {
	const total =
		usage?.total ??
		usage?.totalTokens ??
		Number(usage?.input ?? 0) + Number(usage?.output ?? 0);
	return total || undefined;
}

function subagentStatus(result) {
	if (result.status) return result.status;
	if (result.exitCode === 0) return "completed";
	if (result.exitCode === undefined) return "unknown";
	return "failed";
}

function summarizeSubagentResult(result) {
	return {
		agent: result.agent ?? "unknown",
		role: handoffRole(result.agent),
		status: subagentStatus(result),
		durationMs: result.durationMs ?? result.progressSummary?.durationMs,
		toolCount: result.toolCount ?? result.progressSummary?.toolCount,
		model: result.model,
		tokens: subagentUsageTotal(result.usage ?? result.tokens),
		input: result.usage?.input ?? result.tokens?.input,
		output: result.usage?.output ?? result.tokens?.output,
		cacheRead: result.usage?.cacheRead,
		cost: result.usage?.cost ?? result.totalCost?.costUsd,
		turns: result.usage?.turns ?? result.turnCount,
		sessionFile: result.sessionFile,
		artifact: result.artifactPaths?.outputPath ?? result.artifact,
		error: result.error,
	};
}

function statusSubagentResults(dir) {
	const file = dir ? join(dir, "status.json") : "";
	if (!file || !existsSync(file)) return [];
	try {
		const status = JSON.parse(readFileSync(file, "utf8"));
		return (status.steps ?? []).map(summarizeSubagentResult);
	} catch {
		return [];
	}
}

function subagentDetailsFromResult(result) {
	const details =
		result && typeof result === "object" ? result.details : undefined;
	return [
		...(details?.results ?? []).map(summarizeSubagentResult),
		...statusSubagentResults(details?.asyncDir),
	];
}

function toolKind(name, args) {
	if (name !== "bash") return name;
	const command = String(parseToolArgs(args).command ?? "").toLowerCase();
	if (/\b(pytest|unittest|npm\s+(run\s+)?test|gradle\s+test)\b/.test(command))
		return "test";
	if (/\b(smoke_|smoke-|adb|emulator|powershell|pwsh)\b/.test(command))
		return "live-smoke";
	if (/\b(git|bd)\b/.test(command)) return "state";
	return "shell";
}

function summarizeToolResult(event, started) {
	const text =
		typeof event.result === "string"
			? event.result
			: JSON.stringify(event.result ?? "");
	const subagentDetails =
		event.toolName === "subagent"
			? subagentDetailsFromResult(event.result)
			: [];
	return {
		id: event.toolCallId,
		name: event.toolName,
		kind: toolKind(event.toolName, started?.args),
		durationMs: Math.max(0, Date.now() - (started?.startedAt ?? Date.now())),
		isError: Boolean(event.isError),
		inputChars: textChars(started?.args),
		outputChars: text.length,
		subagents:
			subagentDetails.length > 0
				? subagentDetails.map((item) => item.agent)
				: subagentNamesFromArgs(started?.args),
		subagentDetails,
		runId:
			text.match(/Run:\s*([A-Za-z0-9_-]+)/)?.[1] ??
			text.match(/Async:\s*[^[]*\[([^\]]+)\]/)?.[1],
		artifact: text.match(/Artifacts?:\s*\n?-\s*[^:]+:\s*([^\s]+)/)?.[1],
	};
}

function notify(ctx, message, level = "info") {
	ctx.ui.notify(message, level);
	if (ctx.mode === "print" || ctx.hasUI === false) console.log(message);
}

async function withCommandTelemetry(command, args, ctx, fn, note = false) {
	const startedAt = Date.now();
	const contextBefore = usageSnapshot(ctx);
	recordWorkTelemetry(ctx.cwd, {
		id: telemetryId("cmd-start"),
		type: "command-start",
		command,
		args: truncate(args, 300),
		ok: true,
		stopReason: "started",
		context: { before: contextBefore },
	});
	let state;
	let errorMessage = "";
	try {
		state = await fn();
		return state;
	} catch (error) {
		errorMessage = error instanceof Error ? error.message : String(error);
		throw error;
	} finally {
		const summary = stateTelemetry(state);
		const event = {
			id: telemetryId("cmd"),
			type: "command",
			command,
			args: truncate(args, 300),
			durationMs: Math.max(0, Date.now() - startedAt),
			ok: !errorMessage && summary.ok,
			error: errorMessage || undefined,
			...summary,
			context: { before: contextBefore, after: usageSnapshot(ctx) },
		};
		const file = recordWorkTelemetry(ctx.cwd, event);
		if (note && state?.handoffPrompt)
			appendTelemetryNote(ctx.cwd, summary.beadId, event, file);
		cleanupBenignInstructionDirt(ctx.cwd);
	}
}

function readTelemetryEvents(cwd) {
	const dir = telemetryDir(cwd);
	if (!existsSync(dir)) return [];
	return readdirSync(dir)
		.filter((file) => file.endsWith(".jsonl"))
		.flatMap((file) =>
			readFileSync(join(dir, file), "utf8")
				.split(/\r?\n/)
				.filter(Boolean)
				.map((line) => {
					try {
						return { ...JSON.parse(line), file: join(dir, file) };
					} catch {
						return undefined;
					}
				})
				.filter(Boolean),
		);
}

function parseTelemetryArgs(args = "") {
	const tokens = String(args).trim().split(/\s+/).filter(Boolean);
	const json = tokens.includes("--json");
	const filtered = tokens.filter((token) => token !== "--json");
	const scope = filtered[0] ?? "today";
	const value = filtered[1] ?? "";
	return { json, scope, value };
}

function matchesTelemetryScope(event, { scope, value }) {
	const today = telemetryDay();
	if (!scope || scope === "today")
		return event.timestamp?.slice(0, 10) === today;
	if (scope === "all") return true;
	if (scope === "epic")
		return event.epicId === value || event.meta?.epicId === value;
	if (scope === "bead" || scope === "task")
		return event.beadId === value || event.meta?.beadId === value;
	if (scope.includes("-"))
		return (
			event.epicId === scope ||
			event.beadId === scope ||
			event.meta?.epicId === scope ||
			event.meta?.beadId === scope
		);
	return event.timestamp?.slice(0, 10) === scope;
}

function addMetric(map, key, event) {
	const item = map.get(key) ?? { key, count: 0, durationMs: 0, tokens: 0 };
	item.count += 1;
	item.durationMs += Number(event.durationMs ?? 0);
	item.tokens += Number(event.usage?.totalTokens ?? 0);
	map.set(key, item);
}

function summarizeTelemetryTools(tools = []) {
	const rows = [...tools]
		.sort(
			(a, b) =>
				Number(b.outputChars ?? 0) - Number(a.outputChars ?? 0) ||
				Number(b.durationMs ?? 0) - Number(a.durationMs ?? 0),
		)
		.slice(0, 5)
		.map((tool) => ({
			name: tool.name,
			durationMs: tool.durationMs,
			isError: Boolean(tool.isError),
			outputChars: tool.outputChars,
			runId: tool.runId,
		}));
	return {
		count: tools.length,
		outputChars: tools.reduce(
			(sum, tool) => sum + Number(tool.outputChars ?? 0),
			0,
		),
		subagentRuns: tools.filter((tool) => tool.name === "subagent").length,
		top: rows,
	};
}

function summarizeTelemetryEvent(event) {
	return {
		id: event.id,
		type: event.type,
		command: event.command,
		mode: event.mode,
		action: event.action,
		role: event.role,
		stopReason: event.stopReason,
		handoff: event.handoff,
		epicId: event.epicId,
		beadId: event.beadId ?? event.meta?.beadId,
		durationMs: event.durationMs,
		usage: event.usage,
		messages: event.messages,
		context: event.context,
		review: event.review,
		payoff: event.payoff,
		reason: event.reason,
		file: event.file,
		tools: summarizeTelemetryTools(event.tools ?? []),
	};
}

function buildWorkTelemetryState(cwd, args = "") {
	const filter = parseTelemetryArgs(args);
	const events = readTelemetryEvents(cwd).filter((event) =>
		matchesTelemetryScope(event, filter),
	);
	const byPhase = new Map();
	const byBead = new Map();
	const totals = {
		durationMs: 0,
		tokens: 0,
		input: 0,
		output: 0,
		cost: 0,
		messageChars: 0,
		toolOutputChars: 0,
		toolCalls: 0,
		subagentRuns: 0,
		testRuns: 0,
		handoffsQueued: 0,
		handoffsStarted: 0,
	};
	const stopReasons = new Map();
	const rolePayoff = new Map();
	let maxContextTokens = 0;
	for (const event of events) {
		totals.durationMs += Number(event.durationMs ?? 0);
		totals.tokens += Number(event.usage?.totalTokens ?? 0);
		totals.input += Number(event.usage?.input ?? 0);
		totals.output += Number(event.usage?.output ?? 0);
		totals.cost += Number(event.usage?.cost ?? 0);
		totals.messageChars += Number(
			event.messages?.chars ?? event.outputChars ?? 0,
		);
		totals.toolOutputChars += (event.tools ?? []).reduce(
			(sum, tool) => sum + Number(tool.outputChars ?? 0),
			0,
		);
		totals.toolCalls += (event.tools ?? []).length;
		totals.subagentRuns += (event.tools ?? []).filter(
			(tool) => tool.name === "subagent",
		).length;
		totals.testRuns += (event.tools ?? []).filter(
			(tool) => tool.kind === "test",
		).length;
		if (event.handoff?.queued) totals.handoffsQueued += 1;
		if (event.handoff?.started) totals.handoffsStarted += 1;
		const reason = event.stopReason;
		if (reason) stopReasons.set(reason, (stopReasons.get(reason) ?? 0) + 1);
		if (event.payoff?.role) {
			const payoff = rolePayoff.get(event.payoff.role) ?? {
				role: event.payoff.role,
				count: 0,
				durationMs: 0,
				tokens: 0,
				filesChanged: 0,
				testsRun: 0,
				commits: 0,
			};
			payoff.count += 1;
			payoff.durationMs += Number(
				event.payoff.durationMs ?? event.durationMs ?? 0,
			);
			payoff.tokens += Number(
				event.payoff.tokens ?? event.usage?.totalTokens ?? 0,
			);
			payoff.filesChanged += Number(event.payoff.filesChanged ?? 0);
			payoff.testsRun += Number(event.payoff.testsRun ?? 0);
			if (event.payoff.commitCreated) payoff.commits += 1;
			rolePayoff.set(event.payoff.role, payoff);
		}
		maxContextTokens = Math.max(
			maxContextTokens,
			Number(
				event.context?.after?.tokens ?? event.context?.before?.tokens ?? 0,
			),
		);
		addMetric(
			byPhase,
			[event.type, event.command ?? event.mode, event.action]
				.filter(Boolean)
				.join("/"),
			event,
		);
		const bead = event.beadId ?? event.meta?.beadId;
		if (bead) addMetric(byBead, bead, event);
	}
	return {
		ok: true,
		dir: telemetryDir(cwd),
		filter,
		files: [...new Set(events.map((event) => event.file).filter(Boolean))],
		events: events.length,
		totals,
		maxContextTokens,
		stopReasons: [...stopReasons.entries()].map(([reason, count]) => ({
			reason,
			count,
		})),
		rolePayoff: [...rolePayoff.values()].sort(
			(a, b) => b.durationMs - a.durationMs,
		),
		byPhase: [...byPhase.values()].sort((a, b) => b.durationMs - a.durationMs),
		byBead: [...byBead.values()].sort((a, b) => b.durationMs - a.durationMs),
		slowest: [...events]
			.sort((a, b) => Number(b.durationMs ?? 0) - Number(a.durationMs ?? 0))
			.slice(0, 5)
			.map(summarizeTelemetryEvent),
	};
}

function formatDuration(ms) {
	const totalSeconds = Math.round(Number(ms ?? 0) / 1000);
	if (totalSeconds < 60) return `${totalSeconds}s`;
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	if (minutes < 60) return `${minutes}m ${seconds}s`;
	const hours = Math.floor(minutes / 60);
	return `${hours}h ${minutes % 60}m ${seconds}s`;
}

function renderMetricRows(rows) {
	return rows.length
		? rows
				.slice(0, 8)
				.map(
					(row) =>
						`- ${row.key}: ${row.count} events, ${formatDuration(row.durationMs)}, ${row.tokens} tokens`,
				)
		: ["- none"];
}

function renderWorkTelemetryText(state) {
	return [
		`Work telemetry: ${state.filter.scope}${state.filter.value ? ` ${state.filter.value}` : ""}`,
		`Events: ${state.events} • observed time: ${formatDuration(state.totals.durationMs)} • tokens: ${state.totals.tokens} in:${state.totals.input} out:${state.totals.output} • cost: ${state.totals.cost.toFixed(4)}`,
		`Tools: ${state.totals.toolCalls} calls, ${state.totals.subagentRuns} subagent runs, ${state.totals.testRuns} test runs, ${state.totals.toolOutputChars} tool-output chars • messages: ${state.totals.messageChars} chars`,
		`Handoffs: ${state.totals.handoffsQueued} queued, ${state.totals.handoffsStarted} started`,
		`Max recorded context: ${state.maxContextTokens || "unknown"} tokens`,
		"",
		"Stop reasons:",
		...(state.stopReasons.length
			? state.stopReasons.map((row) => `- ${row.reason}: ${row.count}`)
			: ["- none"]),
		"",
		"Role payoff:",
		...(state.rolePayoff.length
			? state.rolePayoff.map(
					(row) =>
						`- ${row.role}: ${row.count} runs, ${formatDuration(row.durationMs)}, ${row.tokens} tokens, ${row.filesChanged} dirty-file observations, ${row.testsRun} tests, ${row.commits} commits`,
				)
			: ["- none"]),
		"",
		"By phase:",
		...renderMetricRows(state.byPhase),
		"",
		"By Bead:",
		...renderMetricRows(state.byBead),
		"",
		"Slowest:",
		...(state.slowest.length
			? state.slowest.map((event) =>
					`- ${event.id} ${event.type}/${event.command ?? event.mode ?? "agent"}/${event.action ?? ""}: ${formatDuration(event.durationMs)} ${event.beadId ?? event.meta?.beadId ?? ""}`.trim(),
				)
			: ["- none"]),
		"",
		`Files: ${state.files.length ? state.files.join(", ") : state.dir}`,
	].join("\n");
}

function buildWorkTelemetry(cwd, args = "") {
	const state = buildWorkTelemetryState(cwd, args);
	return state.filter.json
		? JSON.stringify(state, null, "\t")
		: renderWorkTelemetryText(state);
}

function usageDir(cwd) {
	return join(telemetryDir(cwd), "usage");
}

function escapeHtml(value) {
	return String(value ?? "")
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

function unknown(value, suffix = "") {
	return value === undefined || value === null || value === ""
		? "unknown"
		: `${value}${suffix}`;
}

function parseWorkUsageArgs(args = "") {
	const tokens = String(args).trim().split(/\s+/).filter(Boolean);
	const open = tokens.includes("--open");
	const jsonl = tokens.includes("--jsonl");
	return {
		open: open && !jsonl,
		format: jsonl ? "jsonl" : "html",
		telemetryArgs: tokens
			.filter((token) => token !== "--open" && token !== "--jsonl")
			.join(" "),
	};
}

function usageScope(cwd, args = "") {
	const parsedArgs = parseWorkUsageArgs(args);
	const parsed = parseTelemetryArgs(parsedArgs.telemetryArgs);
	if (parsedArgs.telemetryArgs)
		return {
			filter: parsed,
			explicit: true,
			open: parsedArgs.open,
			format: parsedArgs.format,
		};
	const resolved = resolveWorkflowEpic(cwd, "");
	if (resolved.error)
		return {
			error: resolved.error,
			message: resolved.message,
			candidates: resolved.candidates ?? [],
		};
	return {
		filter: { json: false, scope: "epic", value: idOf(resolved.epic) },
		explicit: false,
		open: parsedArgs.open,
		format: parsedArgs.format,
		epic: issueSummary(resolved.epic),
	};
}

function reviewTelemetry(meta = {}, event = {}) {
	const review = event.review ?? event.reviewOutcome;
	const scope = meta.beadId
		? `bead ${meta.beadId}`
		: meta.epicId
			? `diff for epic ${meta.epicId}`
			: "current diff";
	if (!review) return { scope, outcome: "unknown" };
	return {
		scope: review.scope ?? scope,
		outcome: review.outcome ?? "unknown",
		findings: review.findings ?? review.findingCount,
		fixer: review.fixer ?? review.fixerTriggered,
		rerunOf: review.rerunOf,
	};
}

function reviewPayoff(review) {
	if (!review || review.outcome === "unknown") return "unknown";
	return [
		review.outcome,
		review.findings === undefined
			? "findings unknown"
			: `${review.findings} findings`,
		review.fixer === undefined
			? "fixer unknown"
			: `fixer ${review.fixer ? "yes" : "no"}`,
	]
		.filter(Boolean)
		.join(" / ");
}

function countNames(names = []) {
	const counts = new Map();
	for (const name of names.filter(Boolean))
		counts.set(name, (counts.get(name) ?? 0) + 1);
	return [...counts.entries()]
		.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
		.map(([name, count]) => ({ name, count }));
}

function formatCounts(counts) {
	return counts.length
		? counts.map((item) => `${item.name}(${item.count})`).join(", ")
		: "unknown";
}

function toolCounts(tools = []) {
	return countNames(tools.map((tool) => tool.name));
}

function subagentNames(tool) {
	if (Array.isArray(tool.subagents) && tool.subagents.length)
		return tool.subagents;
	return tool.name === "subagent" ? ["unknown"] : [];
}

function subagentCounts(tools = []) {
	return countNames(tools.flatMap(subagentNames));
}

function operationKind(event) {
	const label = event.type === "agent" ? event.mode : event.command;
	if (event.type === "agent") return "agent";
	if (String(label).includes("debug")) return "debug";
	if (String(label).includes("review")) return "review";
	if (String(label).includes("telemetry") || String(label).includes("usage"))
		return "report";
	return "work";
}

function hasUsageSignal(event) {
	return Boolean(
		event.usage?.totalTokens !== undefined ||
			event.context?.after?.tokens !== undefined ||
			event.context?.before?.tokens !== undefined ||
			(event.tools ?? []).length ||
			event.messages?.count,
	);
}

function usageEventRows(events) {
	return events
		.filter((event) => event.command !== "work-usage" && hasUsageSignal(event))
		.sort((a, b) => Number(b.durationMs ?? 0) - Number(a.durationMs ?? 0))
		.map((event) => {
			const tools = event.tools ?? [];
			return {
				id: event.id ?? "unknown",
				timestamp: event.timestamp ?? "unknown",
				task: event.beadId ?? event.meta?.beadId ?? "unknown",
				agent:
					event.type === "agent"
						? (event.mode ?? "agent")
						: (event.command ?? event.type ?? "unknown"),
				eventType: event.type ?? "unknown",
				kind: operationKind(event),
				phase: event.action ?? event.phase ?? "unknown",
				duration: event.durationMs,
				tokens: event.usage?.totalTokens,
				context: event.context?.after?.tokens ?? event.context?.before?.tokens,
				contextBefore: event.context?.before?.tokens,
				contextAfter: event.context?.after?.tokens,
				tools: formatCounts(toolCounts(tools)),
				subagents: formatCounts(subagentCounts(tools)),
				toolDetails: tools.map((tool) => ({
					name: tool.name ?? "unknown",
					durationMs: tool.durationMs,
					inputChars: tool.inputChars,
					outputChars: tool.outputChars,
					isError: Boolean(tool.isError),
					subagents: Array.isArray(tool.subagents) ? tool.subagents : [],
					subagentDetails: Array.isArray(tool.subagentDetails)
						? tool.subagentDetails
						: [],
					runId: tool.runId,
					artifact: tool.artifact,
				})),
				messages: event.messages,
				usage: event.usage,
				review: event.review,
				error: event.error,
				ok: event.ok,
			};
		});
}

function subagentUsageSummary(tools = []) {
	const totals = new Map();
	for (const item of tools.flatMap((tool) => tool.subagentDetails ?? [])) {
		const key = item.agent ?? "unknown";
		const row = totals.get(key) ?? {
			agent: key,
			count: 0,
			durationMs: 0,
			tokens: 0,
			cost: 0,
		};
		row.count += 1;
		row.durationMs += Number(item.durationMs ?? 0);
		row.tokens += Number(item.tokens ?? 0);
		row.cost += Number(item.cost ?? 0);
		totals.set(key, row);
	}
	return [...totals.values()].sort(
		(a, b) => b.tokens - a.tokens || b.durationMs - a.durationMs,
	);
}

function usageSummary(events, rows) {
	const tools = events.flatMap((event) => event.tools ?? []);
	return {
		events: rows.length,
		durationMs: rows.reduce((sum, row) => sum + Number(row.duration ?? 0), 0),
		tokens: rows.reduce((sum, row) => sum + Number(row.tokens ?? 0), 0),
		unknownTokens: rows.filter((row) => row.tokens === undefined).length,
		unknownContext: rows.filter((row) => row.context === undefined).length,
		toolEvents: events.filter((event) => (event.tools ?? []).length).length,
		tools: toolCounts(tools),
		subagents: subagentCounts(tools),
		subagentUsage: subagentUsageSummary(tools),
	};
}

function usageSubagentSummaryHtml(summary) {
	if (!summary.subagentUsage.length) return "";
	return `<h2>Subagent usage</h2><table class="summary-table"><thead><tr><th>Agent</th><th>Runs</th><th>Time</th><th>Tokens</th><th>Cost</th></tr></thead><tbody>${summary.subagentUsage
		.map(
			(row) =>
				`<tr><td>${escapeHtml(row.agent)}</td><td class="num">${row.count}</td><td class="num">${escapeHtml(formatDuration(row.durationMs))}</td><td class="num">${escapeHtml(row.tokens || "unknown")}</td><td class="num">${escapeHtml(row.cost || "unknown")}</td></tr>`,
		)
		.join("")}</tbody></table>`;
}

function usageTier(value, warn, danger) {
	const number = Number(value ?? -1);
	if (number < 0) return "";
	if (number >= danger) return " hot";
	if (number >= warn) return " warm";
	return " cool";
}

function usageToolDetailHtml(row) {
	if (!row.toolDetails.length)
		return '<p class="muted">No tool calls recorded.</p>';
	return `<h3>Tool calls</h3><table class="detail-table"><thead><tr><th>Tool</th><th>Time</th><th>Input chars</th><th>Output chars</th><th>Status</th><th>Subagents</th><th>Run/artifact</th></tr></thead><tbody>${row.toolDetails
		.map(
			(tool) =>
				`<tr><td>${escapeHtml(tool.name)}</td><td class="num" data-sort="${Number(tool.durationMs ?? -1)}">${escapeHtml(tool.durationMs === undefined ? "unknown" : formatDuration(tool.durationMs))}</td><td class="num">${escapeHtml(unknown(tool.inputChars))}</td><td class="num">${escapeHtml(unknown(tool.outputChars))}</td><td>${tool.isError ? "error" : "ok"}</td><td>${escapeHtml(tool.subagents.length ? tool.subagents.join(", ") : "unknown")}</td><td>${escapeHtml([tool.runId, tool.artifact].filter(Boolean).join(" / ") || "unknown")}</td></tr>`,
		)
		.join("")}</tbody></table>`;
}

function usageSubagentDetailHtml(row) {
	const subagents = row.toolDetails.flatMap(
		(tool) => tool.subagentDetails ?? [],
	);
	if (!subagents.length)
		return '<p class="muted">No per-subagent token records captured for this event.</p>';
	return `<h3>Subagent runs</h3><table class="detail-table"><thead><tr><th>Agent</th><th>Status</th><th>Time</th><th>Tokens</th><th>In</th><th>Out</th><th>Cost</th><th>Tools</th><th>Turns</th><th>Model</th></tr></thead><tbody>${subagents
		.map(
			(item) =>
				`<tr><td>${escapeHtml(item.agent)}</td><td>${escapeHtml(item.status)}</td><td class="num" data-sort="${Number(item.durationMs ?? -1)}">${escapeHtml(item.durationMs === undefined ? "unknown" : formatDuration(item.durationMs))}</td><td class="num">${escapeHtml(unknown(item.tokens))}</td><td class="num">${escapeHtml(unknown(item.input))}</td><td class="num">${escapeHtml(unknown(item.output))}</td><td class="num">${escapeHtml(unknown(item.cost))}</td><td class="num">${escapeHtml(unknown(item.toolCount))}</td><td class="num">${escapeHtml(unknown(item.turns))}</td><td>${escapeHtml(item.model ?? "unknown")}</td></tr>`,
		)
		.join("")}</tbody></table>`;
}

function usageDetailHtml(row) {
	return `<div class="detail-box"><div class="detail-grid"><div><b>Event</b><br>${escapeHtml(row.id)} · ${escapeHtml(row.eventType)} · ${escapeHtml(row.kind)} · ${escapeHtml(row.ok === false ? "failed" : "ok/unknown")}</div><div><b>Usage</b><br>tokens ${escapeHtml(unknown(row.tokens))}; in ${escapeHtml(unknown(row.usage?.input))}; out ${escapeHtml(unknown(row.usage?.output))}; cost ${escapeHtml(unknown(row.usage?.cost))}</div><div><b>Context</b><br>before ${escapeHtml(unknown(row.contextBefore))}; after ${escapeHtml(unknown(row.contextAfter))}</div><div><b>Messages</b><br>${escapeHtml(row.messages ? `${row.messages.count} total, ${row.messages.assistant} assistant, ${row.messages.tools} tool results` : "unknown")}</div></div>${row.error ? `<p class="error">${escapeHtml(row.error)}</p>` : ""}<p class="muted">Rows are event totals. Tool calls record wall time and I/O chars. New subagent runs also record child tokens/cost/model when pi-subagents returns them.</p>${usageSubagentDetailHtml(row)}${usageToolDetailHtml(row)}</div>`;
}

function usageHtml(state) {
	const detailHtml = state.rows
		.map(
			(row, index) =>
				`<div id="detail-${index}" class="detail-source" hidden>${usageDetailHtml(row)}</div>`,
		)
		.join("\n");
	const rowHtml = state.rows
		.map(
			(row, index) =>
				`<tr class="event-row kind-${escapeHtml(row.kind)}" data-detail="detail-${index}" title="Click for details"><td>${escapeHtml(row.task)}</td><td>${escapeHtml(row.agent)}</td><td>${escapeHtml(row.phase)}</td><td class="num${usageTier(row.duration, 60_000, 300_000)}" data-sort="${Number(row.duration ?? -1)}">${escapeHtml(row.duration === undefined ? "unknown" : formatDuration(row.duration))}</td><td class="num${usageTier(row.tokens, 8_000, 32_000)}" data-sort="${Number(row.tokens ?? -1)}">${escapeHtml(unknown(row.tokens))}</td><td class="num${usageTier(row.context, 80_000, 160_000)}" data-sort="${Number(row.context ?? -1)}">${escapeHtml(unknown(row.context))}</td><td>${escapeHtml(row.tools)}</td><td>${escapeHtml(row.subagents)}</td><td>${escapeHtml(row.review?.scope ?? "unknown")}</td><td>${escapeHtml(reviewPayoff(row.review))}</td><td>${escapeHtml(row.timestamp)}</td></tr>`,
		)
		.join("\n");
	return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<title>Work usage</title>
<style>
:root{color-scheme:light dark;--b:#d8dee9;--muted:#667085;--head:#f8fafc;--agent:#eff6ff;--debug:#fff7ed;--review:#f5f3ff;--work:#f8fafc;--report:#ecfdf5;--cool:#ecfdf3;--warm:#fffbeb;--hot:#fef2f2}
body{font-family:ui-sans-serif,system-ui,sans-serif;margin:2rem;color:#111827;background:#fff}h1{margin:.2rem 0 1rem}.cards{display:flex;gap:.75rem;flex-wrap:wrap;margin:1rem 0}.card{border:1px solid var(--b);border-radius:.75rem;padding:.75rem 1rem;background:#fff;box-shadow:0 1px 2px #0001}.card b{display:block;font-size:1.2rem}.muted{color:var(--muted)}.error{color:#b91c1c}input{width:100%;max-width:36rem;padding:.55rem .7rem;border:1px solid var(--b);border-radius:.6rem;margin:.75rem 0}table{border-collapse:separate;border-spacing:0;width:100%;font-size:.92rem}th,td{border-bottom:1px solid var(--b);padding:.5rem .55rem;text-align:left;vertical-align:top}th{cursor:pointer;background:var(--head);position:sticky;top:0;user-select:none}th::after{content:' ↕';color:#98a2b3;font-size:.8em}.num{text-align:right;font-variant-numeric:tabular-nums}.cool{background:var(--cool)}.warm{background:var(--warm)}.hot{background:var(--hot)}.kind-agent{background:var(--agent)}.kind-debug{background:var(--debug)}.kind-review{background:var(--review)}.kind-work{background:var(--work)}.kind-report{background:var(--report)}.event-row{cursor:pointer}.event-row:hover{outline:2px solid #93c5fd55}.modal{position:fixed;inset:0;background:#0008;display:grid;place-items:center;padding:2rem;z-index:10}.modal[hidden]{display:none}.modal-card{background:#fff;color:#111827;border-radius:1rem;width:min(78rem,96vw);max-height:88vh;overflow:auto;box-shadow:0 20px 60px #0006}.modal-head{position:sticky;top:0;display:flex;justify-content:space-between;align-items:center;gap:1rem;padding:.8rem 1rem;border-bottom:1px solid var(--b);background:inherit}.modal-body{padding:1rem}.close{font-size:1.2rem;border:1px solid var(--b);border-radius:.5rem;background:transparent;cursor:pointer}.detail-box{border:1px solid var(--b);border-radius:.75rem;padding:1rem;background:#fff;box-shadow:inset 0 1px 2px #00000008}.detail-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(13rem,1fr));gap:.75rem;margin-bottom:.75rem}.detail-table th{position:static}.detail-table,.summary-table{font-size:.86rem;margin:.5rem 0 1rem}.summary-table th{position:static}h2{font-size:1.05rem;margin:1rem 0 .4rem}h3{margin:1rem 0 .4rem}@media (prefers-color-scheme:dark){body{background:#111827;color:#f9fafb}.card,th,.detail-box,.modal-card{background:#1f2937;color:#f9fafb}:root{--b:#374151;--muted:#9ca3af;--agent:#172554;--debug:#431407;--review:#2e1065;--work:#1f2937;--report:#052e16;--cool:#052e16;--warm:#422006;--hot:#450a0a}}
</style>
<h1>Work usage</h1>
<p class="muted">Scope: <strong>${escapeHtml(state.filter.scope)} ${escapeHtml(state.filter.value)}</strong></p>
<div class="cards"><div class="card"><b>${state.summary.events}</b><span>events</span></div><div class="card"><b>${escapeHtml(formatDuration(state.summary.durationMs))}</b><span>time</span></div><div class="card"><b>${escapeHtml(state.summary.tokens || "unknown")}</b><span>tokens</span></div><div class="card"><b>${escapeHtml(formatCounts(state.summary.subagents))}</b><span>subagents</span></div><div class="card"><b>${escapeHtml(formatCounts(state.summary.tools))}</b><span>tools</span></div></div>
<p class="muted">Missing data: tokens ${state.summary.unknownTokens}, context ${state.summary.unknownContext}. Generated from ${state.files.length ? state.files.map(escapeHtml).join(", ") : escapeHtml(state.dir)}.</p>
${usageSubagentSummaryHtml(state.summary)}
<input id="filter" placeholder="filter rows" aria-label="filter rows">
<table id="usage"><thead><tr><th>Task</th><th>Agent</th><th>Phase</th><th>Duration</th><th>Tokens</th><th>Context</th><th>Tools</th><th>Subagents</th><th>Review scope</th><th>Review payoff</th><th>Time</th></tr></thead><tbody>
${rowHtml || '<tr><td colspan="11">No usage events for this scope.</td></tr>'}
</tbody></table>
${detailHtml}
<div id="modal" class="modal" hidden><div class="modal-card"><div class="modal-head"><strong>Usage detail</strong><button id="close" class="close" aria-label="close">×</button></div><div id="modal-body" class="modal-body"></div></div></div>
<script>
const rows=[...document.querySelectorAll('tr.event-row')];
const modal=document.querySelector('#modal');
const modalBody=document.querySelector('#modal-body');
const close=()=>{modal.hidden=true;modalBody.innerHTML=''};
document.querySelector('#close').addEventListener('click',close);
modal.addEventListener('click',e=>{if(e.target===modal)close()});
document.addEventListener('keydown',e=>{if(e.key==='Escape')close()});
for(const r of rows)r.addEventListener('click',()=>{const source=document.querySelector('#'+CSS.escape(r.dataset.detail));if(!source)return;modalBody.innerHTML=source.innerHTML;modal.hidden=false});
document.querySelector('#filter').addEventListener('input',e=>{const q=e.target.value.toLowerCase();for(const r of rows){const source=document.querySelector('#'+CSS.escape(r.dataset.detail));const show=r.textContent.toLowerCase().includes(q)||(source?.textContent.toLowerCase().includes(q));r.hidden=!show}});
for(const th of document.querySelectorAll('thead th'))th.addEventListener('click',()=>{const i=[...th.parentNode.children].indexOf(th);const dir=th.dataset.dir==='asc'?'desc':'asc';for(const h of document.querySelectorAll('thead th'))delete h.dataset.dir;th.dataset.dir=dir;rows.sort((a,b)=>(a.children[i].dataset.sort??a.children[i].textContent).localeCompare(b.children[i].dataset.sort??b.children[i].textContent,undefined,{numeric:true}));if(dir==='desc')rows.reverse();const body=document.querySelector('tbody');for(const r of rows)body.appendChild(r)});
</script>
</html>`;
}

function writeUsageReport(cwd, state) {
	mkdirSync(usageDir(cwd), { recursive: true });
	const file = join(usageDir(cwd), `usage-${Date.now().toString(36)}.html`);
	writeFileSync(file, usageHtml(state));
	return file;
}

function buildWorkUsageState(cwd, args = "") {
	const scoped = usageScope(cwd, args);
	if (scoped.error)
		return errorState(scoped.error, scoped.message, {
			action: "choose-scope",
			candidates: scoped.candidates,
		});
	const events = readTelemetryEvents(cwd).filter((event) =>
		matchesTelemetryScope(event, scoped.filter),
	);
	const rows = usageEventRows(events);
	const state = {
		ok: true,
		action: "usage-report",
		filter: scoped.filter,
		epic: scoped.epic,
		dir: telemetryDir(cwd),
		files: [...new Set(events.map((event) => event.file).filter(Boolean))],
		rows,
		summary: usageSummary(events, rows),
		open: scoped.open,
		format: scoped.format ?? "html",
	};
	if (state.format === "html") state.path = writeUsageReport(cwd, state);
	return state;
}

function renderWorkUsageJsonl(state) {
	return [
		{
			type: "summary",
			filter: state.filter,
			summary: state.summary,
			files: state.files,
		},
		...state.rows.map((row) => ({ type: "row", ...row })),
	]
		.map((row) => JSON.stringify(row))
		.join("\n");
}

function renderWorkUsageText(state) {
	if (!state.ok)
		return [
			state.message ?? "Could not build work usage report.",
			...(state.candidates ?? []).map(
				(item) => `- ${item.id} ${item.status} — ${item.title}`,
			),
		].join("\n");
	if (state.format === "jsonl") return renderWorkUsageJsonl(state);
	return [
		`Work usage report: ${state.path}`,
		state.open
			? "Browser open requested."
			: "Browser not opened; pass --open to launch it.",
		`Scope: ${state.filter.scope}${state.filter.value ? ` ${state.filter.value}` : ""} · events: ${state.summary.events} · time: ${formatDuration(state.summary.durationMs)} · tokens: ${state.summary.tokens || "unknown"}`,
		state.summary.unknownTokens || state.summary.unknownContext
			? `Missing data shown as unknown: tokens ${state.summary.unknownTokens}, context ${state.summary.unknownContext}`
			: "",
	]
		.filter(Boolean)
		.join("\n");
}

function openUsageReport(file) {
	try {
		const command =
			process.platform === "win32"
				? "cmd"
				: process.platform === "darwin"
					? "open"
					: "xdg-open";
		const args =
			process.platform === "win32" ? ["/c", "start", "", file] : [file];
		execFileSync(command, args, { stdio: "ignore", timeout: 1000 });
		return true;
	} catch {
		return false;
	}
}

function contextSettings(settings) {
	return {
		...DEFAULT_CONTEXT,
		...(settings.workOrchestrator?.context ?? {}),
	};
}

function setContextSettings(settings, next) {
	settings.workOrchestrator ??= {};
	settings.workOrchestrator.context = {
		...contextSettings(settings),
		...next,
	};
	settings.compaction ??= {};
	settings.compaction.keepRecentTokens = Math.max(
		DEFAULT_CONTEXT.keepRecentTokens,
		Number(settings.compaction.keepRecentTokens) || 0,
	);
}

function clampCompactAt(value) {
	const number = Number(value);
	if (!Number.isFinite(number)) return DEFAULT_CONTEXT.compactAtTokens;
	return Math.max(MIN_COMPACT_AT_TOKENS, Math.round(number));
}

function compactTriggerTokens(ctx, settings) {
	const configured = clampCompactAt(contextSettings(settings).compactAtTokens);
	const contextWindow = ctx.model?.contextWindow ?? ctx.model?.context_window;
	if (!contextWindow) return configured;
	return Math.max(
		MIN_COMPACT_AT_TOKENS,
		Math.min(configured, contextWindow - DEFAULT_CONTEXT.keepRecentTokens),
	);
}

function overrides(settings) {
	settings.subagents ??= {};
	settings.subagents.agentOverrides ??= {};
	return settings.subagents.agentOverrides;
}

function compactOverrides(settings) {
	const current = settings.subagents?.agentOverrides;
	if (!current) return;
	for (const [agent, value] of Object.entries(current)) {
		if (!value.model && !value.thinking) delete current[agent];
	}
	if (Object.keys(current).length === 0)
		delete settings.subagents?.agentOverrides;
	if (settings.subagents && Object.keys(settings.subagents).length === 0)
		delete settings.subagents;
}

function commonValue(values) {
	const present = values.filter((value) => value !== undefined);
	if (present.length === 0) return undefined;
	return present.every((value) => value === present[0]) ? present[0] : "mixed";
}

function slotSummary(slot, settings) {
	const current = settings.subagents?.agentOverrides ?? {};
	const model = commonValue(slot.agents.map((agent) => current[agent]?.model));
	const thinking = commonValue(
		slot.agents.map((agent) => current[agent]?.thinking),
	);
	return `model:${model ?? "inherit current"} • effort:${thinking ?? `default ${slot.defaultThinking}`}`;
}

function labelFor(item) {
	return item.description ? `${item.label} — ${item.description}` : item.label;
}

async function choose(ctx, title, items) {
	const labels = items.map(labelFor);
	const selected = await ctx.ui.select(title, labels);
	return items[labels.indexOf(selected)]?.value;
}

async function modelItems(ctx) {
	const items = [
		{
			value: INHERIT_MODEL,
			label: "(blank) use current control-session model",
			description: ctx.model
				? `${ctx.model.provider}/${ctx.model.id}`
				: "subagent inherits whatever /model is active",
		},
	];

	try {
		const models = await ctx.modelRegistry.getAvailable();
		for (const model of models) {
			const id = `${model.provider}/${model.id}`;
			items.push({ value: id, label: id, description: model.name ?? "" });
		}
	} catch (error) {
		ctx.ui.notify(
			`Could not list available models: ${error instanceof Error ? error.message : String(error)}`,
			"warning",
		);
	}

	return items;
}

function setSlot(settings, slot, model, thinking) {
	const current = overrides(settings);
	for (const agent of slot.agents) {
		const next = { ...(current[agent] ?? {}) };
		if (model === INHERIT_MODEL) delete next.model;
		else next.model = model;

		if (thinking === DEFAULT_THINKING) delete next.thinking;
		else next.thinking = thinking;

		current[agent] = next;
	}
	compactOverrides(settings);
}

function resetAll(settings) {
	for (const slot of SLOTS) {
		for (const agent of slot.agents)
			delete settings.subagents?.agentOverrides?.[agent];
	}
	compactOverrides(settings);
}

function notifySummary(ctx, settings) {
	ctx.ui.notify(
		SLOTS.map((slot) => `${slot.label}: ${slotSummary(slot, settings)}`).join(
			"\n",
		),
		"info",
	);
}

function truncate(value, max = 800) {
	const text = String(value ?? "")
		.replace(/\s+/g, " ")
		.trim();
	return text.length > max ? `${text.slice(0, max)}…` : text;
}

function extractWorkAction(text) {
	const line = String(text ?? "").trim();
	const match = line.match(/(\/work-[\w-]+)(?:\s+([^\s.;,]+))?(?::\s*(.*))?/);
	if (!match) return "";
	return `${match[1]}${match[2] ? ` ${match[2]}` : ""}${match[3] ? `: ${match[3]}` : ""}`;
}

function uniqueActions(actions = []) {
	return [
		...new Set(
			actions
				.map(extractWorkAction)
				.filter((action) => action.startsWith("/work-")),
		),
	];
}

function recommendedActions(state) {
	return uniqueActions([
		...(state?.suggestedCommands ?? []),
		state?.nextAction,
		state?.message,
	]);
}

function recommendedActionsFromText(text) {
	return uniqueActions(String(text ?? "").split(/\r?\n/));
}

function renderRecommendedActions(actions) {
	if (!actions.length) return [];
	return [
		"Recommended actions:",
		...actions.map((action, index) => `${index + 1}. ${action}`),
		"Type a number to run one.",
	];
}

function withRecommendedActionsText(text) {
	const actions = recommendedActionsFromText(text);
	if (!actions.length) return text;
	return [text, "", ...renderRecommendedActions(actions)].join("\n");
}

function rememberRecommendedActions(cwd, actions, source = "work") {
	if (!cwd) return;
	const state = readWorkState(cwd);
	if (actions.length) {
		state.lastActions = {
			source,
			updatedAt: new Date().toISOString(),
			actions,
		};
	} else {
		delete state.lastActions;
	}
	writeWorkState(cwd, state);
}

function contentText(content) {
	if (!content) return "";
	if (typeof content === "string") return content;
	if (Array.isArray(content))
		return content
			.map((item) => contentText(item))
			.filter(Boolean)
			.join("\n");
	if (typeof content === "object")
		return contentText(content.text ?? content.content ?? content.message);
	return "";
}

function messageRole(message) {
	return String(message?.role ?? message?.type ?? "message");
}

function toolNames(message) {
	const calls =
		message?.toolCalls ?? message?.tool_calls ?? message?.calls ?? [];
	if (!Array.isArray(calls)) return [];
	return calls
		.map((call) => call?.name ?? call?.function?.name ?? call?.toolName)
		.filter(Boolean)
		.map(String);
}

function messageLine(message) {
	const role = messageRole(message);
	if (/thinking|reasoning/i.test(role)) return "";
	if (/tool/i.test(role)) {
		const name = message?.toolName ?? message?.name ?? "tool";
		return `[tool:${name}] result omitted`;
	}
	const tools = toolNames(message);
	const text = truncate(contentText(message?.content ?? message?.message), 900);
	const suffix = tools.length ? ` tools:${tools.join(",")}` : "";
	return text || suffix ? `[${role}] ${text}${suffix}` : "";
}

function filesFromOps(fileOps) {
	const read = fileOps?.readFiles ?? fileOps?.read ?? [];
	const modified =
		fileOps?.modifiedFiles ?? fileOps?.modified ?? fileOps?.written ?? [];
	return {
		read: Array.from(new Set(Array.isArray(read) ? read : [])).map(String),
		modified: Array.from(new Set(Array.isArray(modified) ? modified : [])).map(
			String,
		),
	};
}

function instantSummary(preparation, customInstructions = "") {
	const maxSummaryChars = Number.isFinite(
		Number(preparation.settings?.maxSummaryChars),
	)
		? Math.max(4_000, Number(preparation.settings.maxSummaryChars))
		: DEFAULT_CONTEXT.maxSummaryChars;
	const messages = [
		...(preparation.messagesToSummarize ?? []),
		...(preparation.turnPrefixMessages ?? []),
	];
	const lines = messages.map(messageLine).filter(Boolean);
	const userLines = lines.filter((line) => /^\[user\]/i.test(line)).slice(-6);
	const recentLines = lines.slice(-12);
	const files = filesFromOps(preparation.fileOps);
	const previous = truncate(preparation.previousSummary ?? "", 1_500);
	const summary = [
		"## Work-orchestrator instant compaction",
		"Assistant reasoning and full tool results were intentionally dropped; Beads, git, and files are the source of truth.",
		customInstructions
			? `\n## Instructions\n${truncate(customInstructions, 1_000)}`
			: "",
		previous ? `\n## Previous summary\n${previous}` : "",
		userLines.length
			? `\n## Recent user goals\n${userLines.map((line) => `- ${line}`).join("\n")}`
			: "",
		recentLines.length
			? `\n## Recent visible conversation\n${recentLines.map((line) => `- ${line}`).join("\n")}`
			: "",
		files.read.length
			? `\n<read-files>\n${files.read.join("\n")}\n</read-files>`
			: "",
		files.modified.length
			? `\n<modified-files>\n${files.modified.join("\n")}\n</modified-files>`
			: "",
		"\n## Next recovery step\nRun `/work-status` or `bd ready --json`, then continue with `/work-resume <epic-id>`.",
	]
		.filter(Boolean)
		.join("\n");
	return summary.slice(0, maxSummaryChars);
}

function contextStatus(ctx, settings) {
	const current = contextSettings(settings);
	const usage = ctx.getContextUsage?.();
	const trigger = compactTriggerTokens(ctx, settings);
	return [
		`Work context guard: ${current.enabled === false ? "disabled" : "enabled"}`,
		`Auto compact: ${current.autoCompact === true ? "enabled" : "disabled"}`,
		`Usage: ${usage?.tokens ? `${usage.tokens.toLocaleString()} tokens` : "unknown"}`,
		`Trigger: ${trigger.toLocaleString()} tokens`,
		`Keep recent: ${Math.max(DEFAULT_CONTEXT.keepRecentTokens, Number(settings.compaction?.keepRecentTokens) || 0).toLocaleString()} tokens`,
		`Summary budget: ${Number(current.maxSummaryChars ?? DEFAULT_CONTEXT.maxSummaryChars).toLocaleString()} chars`,
		"Compaction style: instant, local, no LLM call; only for /work-context or opted-in work auto-compaction.",
	].join("\n");
}

function maybeCompact(ctx, settings, reason) {
	const current = contextSettings(settings);
	if (
		current.enabled === false ||
		current.autoCompact !== true ||
		contextCompactState.inFlight
	)
		return false;
	const usage = ctx.getContextUsage?.();
	if (!usage?.tokens) return false;
	const trigger = compactTriggerTokens(ctx, settings);
	if (usage.tokens < trigger) return false;
	contextCompactState.inFlight = true;
	contextCompactState.requested = true;
	ctx.compact({
		customInstructions: `work-orchestrator proactive ${reason}: preserve goals, Beads/git state, file changes, blockers, and next command; omit reasoning and full tool logs.`,
		onComplete: () => {
			contextCompactState.inFlight = false;
			contextCompactState.requested = false;
			ctx.ui.notify("Work context compacted before rot", "info");
		},

		onError: (error) => {
			contextCompactState.inFlight = false;
			contextCompactState.requested = false;
			ctx.ui.notify(
				`Work context compaction failed: ${error.message}`,
				"warning",
			);
		},
	});
	return true;
}

function nodeScript(value) {
	return /\.[cm]?js$/i.test(value ?? "");
}

function pathEntries() {
	return (process.env.PATH ?? "").split(delimiter).filter(Boolean);
}

function windowsBeadsBinScript(command, override) {
	if (process.platform !== "win32" || command !== "bd") return undefined;
	const dirs = override ? [dirname(resolve(override))] : pathEntries();
	for (const dir of dirs) {
		const script = join(dir, "node_modules", "@beads", "bd", "bin", "bd.js");
		if (existsSync(script)) return script;
	}
	return undefined;
}

function run(cwd, command, args) {
	let override;
	if (command === "bd") override = process.env.WORK_ORCH_BD_BIN;
	else if (command === "git") override = process.env.WORK_ORCH_GIT_BIN;
	const script = nodeScript(override)
		? override
		: windowsBeadsBinScript(command, override);
	const actualCommand = script ? process.execPath : (override ?? command);
	const actualArgs = script ? [script, ...args] : args;
	try {
		return execFileSync(actualCommand, actualArgs, {
			cwd,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		}).trimEnd();
	} catch (error) {
		throw error;
	}
}

function safeRun(cwd, command, args) {
	try {
		return run(cwd, command, args);
	} catch {
		return "";
	}
}

function gitSnapshot(cwd) {
	const status = safeRun(cwd, "git", ["status", "--porcelain=v1"]);
	return {
		head: safeRun(cwd, "git", ["rev-parse", "--verify", "HEAD"]),
		dirtyFiles: status ? status.split(/\r?\n/).filter(Boolean).length : 0,
	};
}

function bdJson(cwd, args) {
	const raw = run(cwd, "bd", [...args, "--json"]);
	if (!raw) return [];
	try {
		return JSON.parse(raw);
	} catch {
		return [];
	}
}

function one(value) {
	return Array.isArray(value) ? value[0] : value;
}

function field(issue, ...names) {
	for (const name of names) if (issue?.[name] !== undefined) return issue[name];
	return undefined;
}

function idOf(issue) {
	return field(issue, "id", "ID") ?? "unknown";
}

function typeOf(issue) {
	return field(issue, "issue_type", "type") ?? "task";
}

function statusOf(issue) {
	return field(issue, "status", "state") ?? "unknown";
}

function parentOf(issue) {
	return field(issue, "parent_id", "parent", "parentId");
}

function titleOf(issue) {
	return field(issue, "title", "summary") ?? idOf(issue);
}

function updatedAt(issue) {
	return field(issue, "updated_at", "updated", "modified_at") ?? "";
}

function createdAt(issue) {
	return field(issue, "created_at", "created") ?? "";
}

function shortDate(value) {
	return value ? String(value).slice(0, 10) : "unknown";
}

function byUpdatedDesc(a, b) {
	return String(updatedAt(b) || createdAt(b)).localeCompare(
		String(updatedAt(a) || createdAt(a)),
	);
}

function listEpics(cwd, status) {
	try {
		const items = bdJson(cwd, ["list", "--type=epic", `--status=${status}`]);
		return Array.isArray(items) ? items : [];
	} catch {
		return [];
	}
}

function resolveEpic(cwd, target) {
	const wanted = target.trim();
	if (wanted && wanted !== "last")
		return { epic: one(bdJson(cwd, ["show", wanted])) };

	const candidates = [
		...listEpics(cwd, "in_progress"),
		...listEpics(cwd, "open"),
	].sort(byUpdatedDesc);
	if (candidates.length === 1) return { epic: candidates[0] };
	if (candidates.length > 1) return { choices: candidates };
	return { choices: [] };
}

function childrenOf(cwd, epicId) {
	try {
		const children = bdJson(cwd, ["children", epicId]);
		if (Array.isArray(children)) return children;
	} catch {
		// Older bd versions may not have `children`.
	}
	try {
		const children = bdJson(cwd, ["list", `--parent=${epicId}`]);
		return Array.isArray(children) ? children : [];
	} catch {
		return [];
	}
}

function readyIds(cwd, epicId) {
	try {
		return new Set(
			bdJson(cwd, ["ready"])
				.filter((issue) => parentOf(issue) === epicId)
				.map(idOf),
		);
	} catch {
		return new Set();
	}
}

function isWorkSlice(issue) {
	return !isIdeaIssue(issue) && !["epic", "decision"].includes(typeOf(issue));
}

function lineFor(issue) {
	return `${idOf(issue)} ${statusOf(issue)} ${typeOf(issue)} — ${titleOf(issue)}`;
}

function buildWorkStatus(cwd, target) {
	const resolved = resolveEpic(cwd, target);
	if (resolved.choices) {
		if (resolved.choices.length === 0)
			return "No open or in-progress epic found. Use /work-plan or /work-migrate first.";
		return [
			"Multiple active epics. Run /work-status <epic-id> or /work-resume <epic-id>.",
			...resolved.choices.map(
				(epic) =>
					`- ${idOf(epic)} ${statusOf(epic)} — ${titleOf(epic)} (updated ${shortDate(updatedAt(epic))})`,
			),
		].join("\n");
	}

	const epic = resolved.epic;
	rememberWorkflowEpic(cwd, epic);
	const epicId = idOf(epic);
	const children = childrenOf(cwd, epicId);
	const byId = new Map(children.map((issue) => [idOf(issue), issue]));
	const ready = readyIds(cwd, epicId);
	const workItems = children.filter(isWorkSlice);
	const planning = workItems.filter(
		(issue) => isPlanningIssue(issue) && statusOf(issue) !== "closed",
	);
	const slices = workItems.filter((issue) => !isPlanningIssue(issue));
	const done = slices.filter((issue) => statusOf(issue) === "closed");
	const active = slices.filter((issue) => statusOf(issue) === "in_progress");
	const readySlices = slices.filter((issue) => ready.has(idOf(issue)));
	const planned = slices.filter(
		(issue) => statusOf(issue) === "open" && !ready.has(idOf(issue)),
	);
	const blockers = slices.filter(
		(issue) =>
			statusOf(issue) !== "closed" &&
			!ready.has(idOf(issue)) &&
			(isBlockedIssue(issue) ||
				depsOf(issue).some((id) => statusOf(byId.get(id)) !== "closed")),
	);
	const decisions = children.filter(
		(issue) => typeOf(issue) === "decision" && statusOf(issue) !== "closed",
	);
	const percent = slices.length
		? Math.round((done.length / slices.length) * 100)
		: 0;
	const gitStatus = (() => {
		try {
			return run(cwd, "git", ["status", "--short", "--branch"]);
		} catch {
			return "git status unavailable";
		}
	})();

	const next = (() => {
		if (decisions.length) return "Resolve decision Beads first.";
		if (readySlices.length)
			return `Run /work-resume ${epicId} to handle ${idOf(readySlices[0])}.`;
		if (blockers.length) {
			const blocker = blockers.find(isBlockedIssue) ?? blockers[0];
			return `Run /work-report ${idOf(blocker)}`;
		}
		if (active.length)
			return `Continue or pause active slice ${idOf(active[0])}.`;
		if (planning.length)
			return `Run /work-resume ${epicId}; planner should create the next slice.`;
		if (statusOf(epic) === "closed") return "Epic is closed.";
		return "No ready slices. /work-resume should ask bead-planner to compare the epic plan against closed children and create the next slice, or report done. Close the roadmap only with /work-roadmap close.";
	})();

	return [
		`Epic: ${titleOf(epic)} (${epicId})`,
		`Status: ${statusOf(epic)} • created ${shortDate(createdAt(epic))} • updated ${shortDate(updatedAt(epic))}`,
		`Progress: ${done.length}/${slices.length} slices closed (${percent}%)`,
		`Ready: ${readySlices.length} • in progress: ${active.length} • planned ahead: ${planned.length} • blockers: ${blockers.length} • decisions: ${decisions.length}`,
		"",
		"Ready slices:",
		...(readySlices.length
			? readySlices.map((issue) => `- ${lineFor(issue)}`)
			: ["- none"]),
		"",
		"In progress:",
		...(active.length
			? active.map((issue) => `- ${lineFor(issue)}`)
			: ["- none"]),
		"",
		"Planned ahead:",
		...(planned.length
			? planned.map((issue) => `- ${lineFor(issue)}`)
			: ["- none"]),
		"",
		"Blockers:",
		...(blockers.length
			? blockers.map((issue) => `- ${lineFor(issue)}`)
			: ["- none"]),
		"",
		"Open decisions:",
		...(decisions.length
			? decisions.map((issue) => `- ${lineFor(issue)}`)
			: ["- none"]),
		"",
		"Git:",
		gitStatus || "clean",
		"",
		`Next: ${next}`,
	].join("\n");
}

function commandErrorText(error) {
	return [error?.stderr, error?.stdout, error?.message]
		.filter(Boolean)
		.map(String)
		.join("\n")
		.trim();
}

function classifyBdError(error, args = []) {
	const text = commandErrorText(error);
	if (
		args[0] === "show" &&
		/not found|no such|unknown|does not exist/i.test(text)
	)
		return "unknown-target";
	if (/ENOENT|not recognized/i.test(text)) return "bd-missing";
	if (/no beads database|bd init/i.test(text)) return "beads-unavailable";
	return "beads-error";
}

function bdJsonRequired(cwd, args) {
	try {
		const raw = run(cwd, "bd", [...args, "--json"]);
		return raw ? JSON.parse(raw) : [];
	} catch (error) {
		const err = new Error(commandErrorText(error) || "bd command failed");
		err.reason = classifyBdError(error, args);
		throw err;
	}
}

function asArray(value) {
	if (value === undefined || value === null || value === "") return [];
	return Array.isArray(value) ? value : [value];
}

function labelsOf(issue) {
	return asArray(field(issue, "labels", "tags"))
		.flatMap((label) =>
			typeof label === "string"
				? label.split(/[\s,]+/)
				: [field(label, "name", "label")],
		)
		.filter(Boolean)
		.map(String);
}

function notesOf(issue) {
	return asArray(field(issue, "notes", "comments", "comment"))
		.map((note) =>
			String(
				typeof note === "object"
					? field(note, "text", "body", "content", "note")
					: note,
			),
		)
		.filter(Boolean)
		.join("\n");
}

function objectMetadata(value) {
	if (!value) return {};
	if (typeof value === "string") {
		try {
			const parsed = JSON.parse(value);
			return parsed && typeof parsed === "object" && !Array.isArray(parsed)
				? parsed
				: {};
		} catch {
			return {};
		}
	}
	return typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeMetadataKey(key) {
	return String(key).replace(/[-_](\w)/g, (_match, letter) =>
		letter.toUpperCase(),
	);
}

function noteMetadata(issue) {
	const metadata = {};
	for (const line of notesOf(issue).split(/\r?\n/)) {
		const match = line.trim().match(/^wo:idea(?:\s+|:)(.*)$/i);
		if (!match) continue;
		for (const part of match[1].split(/\s+/)) {
			const [key, ...rest] = part.split("=");
			if (!key || rest.length === 0) continue;
			metadata[normalizeMetadataKey(key)] = rest
				.join("=")
				.replace(/^['"]|['"]$/g, "");
		}
	}
	return metadata;
}

function ideaMetadata(issue) {
	const direct = objectMetadata(
		field(
			issue,
			"metadata",
			"meta",
			"properties",
			"custom_fields",
			"customFields",
		),
	);
	return {
		...direct,
		...objectMetadata(direct.workOrchestrator),
		...objectMetadata(direct.work_orchestrator),
		...objectMetadata(direct.wo),
		...noteMetadata(issue),
	};
}

function isIdeaIssue(issue) {
	const labels = labelsOf(issue);
	const metadata = ideaMetadata(issue);
	return (
		labels.includes(IDEA_LABEL) ||
		labels.some((label) => /^wo:idea[:/-]/.test(label)) ||
		metadata.kind === "idea" ||
		metadata.type === "idea" ||
		metadata.idea === true ||
		Number(metadata.ideaSchemaVersion) === IDEA_SCHEMA_VERSION ||
		/(^|\s)wo:idea(\s|:|$)/i.test(notesOf(issue))
	);
}

function normalizeIdeaStatus(value) {
	const status = String(value ?? "")
		.trim()
		.toLowerCase()
		.replace(/[-\s]+/g, "_");
	if (status === "completed") return "complete";
	return [
		"raw",
		"accepted",
		"contender",
		"discussed",
		"brainstormed",
		"planned",
		"complete",
		"in_progress",
		"reopened",
		"rejected",
		"conflicted",
	].includes(status)
		? status
		: "";
}

function metadataValue(metadata, ...keys) {
	for (const key of keys) {
		const value = metadata[key];
		if (asArray(value).some((item) => item !== undefined && item !== ""))
			return value;
	}
	return undefined;
}

function hasMetadataValue(metadata, ...keys) {
	return metadataValue(metadata, ...keys) !== undefined;
}

function deriveIdeaStatus(issue) {
	const metadata = ideaMetadata(issue);
	const manual = normalizeIdeaStatus(
		metadataValue(metadata, "manualStatus", "ideaStatus", "status"),
	);
	const hasDownstream = hasMetadataValue(
		metadata,
		"brainstormId",
		"brainstormPath",
		"planId",
		"planPath",
		"epicId",
		"taskId",
		"taskIds",
		"childChangeId",
	);
	if (manual === "rejected" && hasDownstream) return "conflicted";
	if (manual === "rejected") return "rejected";
	if (manual === "reopened" || hasMetadataValue(metadata, "childChangeId"))
		return "reopened";
	if (manual === "in_progress" || hasMetadataValue(metadata, "inProgressId"))
		return "in_progress";
	if (
		manual === "complete" ||
		hasMetadataValue(metadata, "completedAt", "completionEvidence")
	)
		return "complete";
	if (
		hasMetadataValue(
			metadata,
			"planId",
			"planPath",
			"epicId",
			"taskId",
			"taskIds",
		)
	)
		return "planned";
	if (hasMetadataValue(metadata, "brainstormId", "brainstormPath"))
		return "brainstormed";
	return manual || "raw";
}

function depsOf(issue) {
	const parent = parentOf(issue);
	return asArray(
		field(issue, "depends_on", "dependencies", "blocked_by", "deps"),
	)
		.filter((dep) => {
			if (typeof dep !== "object") return true;
			const type = String(field(dep, "type", "dependency_type") ?? "blocks");
			return /^blocks?$/i.test(type);
		})
		.map((dep) =>
			typeof dep === "object"
				? field(dep, "depends_on_id", "dependsOnId", "dependency_id", "id")
				: dep,
		)
		.filter(Boolean)
		.map(String)
		.filter((id) => id !== parent);
}

function issueSummary(issue) {
	const summary = {
		id: idOf(issue),
		title: titleOf(issue),
		type: typeOf(issue),
		status: statusOf(issue),
		labels: labelsOf(issue),
		updated: updatedAt(issue),
	};
	if (isIdeaIssue(issue)) summary.ideaStatus = deriveIdeaStatus(issue);
	return summary;
}

function issueRef(issue) {
	return issueSummary(issue ?? {});
}

function noteExcerpt(issue, max = 300) {
	return truncate(notesOf(issue), max);
}

function noteDetails(issue) {
	const raw = notesOf(issue);
	const normalized = raw.replaceAll("\\n", "\n");
	const lines = normalized
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);
	const commands = lines
		.filter((line) =>
			/(^|\s)(bd|git|node|npm|npx|rtk|uv|pytest|cmake|ctest|ninja|\/work-)\b/i.test(
				line,
			),
		)
		.slice(0, 5)
		.map((line) => truncate(line, 240));
	const artifacts = Array.from(
		new Set(
			normalized.match(
				/(?:[A-Za-z]:)?[\w./\\:-]+\.(?:jsonl?|log|txt|md|html|xml)\b/g,
			) ?? [],
		),
	).slice(0, 10);
	const runIds = Array.from(
		new Set(
			(
				normalized.match(/\b(?:Run|run|run id)[:# ]+([A-Za-z0-9-]+)/g) ?? []
			).map((match) => match.replace(/^.*[:# ]+/, "")),
		),
	).slice(0, 5);
	const recentLines = lines.toReversed();
	const reason = truncate(
		recentLines.find((line) =>
			/blocked|failed|failure|error|missing|cannot|unable/i.test(line),
		) ?? "",
		240,
	);
	const nextLine =
		recentLines.find((line) =>
			/^(?:next\b|rerun\b|re-run\b|run .* again)/i.test(line),
		) ??
		recentLines.find((line) =>
			/\b(?:next\b|rerun\b|re-run\b|run .* again)/i.test(line),
		);
	const nextMatch = nextLine?.match(
		/\b(?:next(?: exact action)?|rerun|re-run|run .* again)\b/i,
	);
	const nextAction = truncate(
		nextLine && nextMatch ? nextLine.slice(nextMatch.index) : "",
		240,
	);
	return {
		reason,
		commands,
		artifacts,
		runIds,
		nextAction,
		rawExcerpt: truncate(normalized.slice(-900), 900),
	};
}

function normalizeCommandTarget(target) {
	const text = String(target ?? "").trim();
	const cleaned = text.replace(/[.,;:)\]]+$/, "");
	return cleaned !== text &&
		(isBeadId(cleaned) || isNumericBeadShorthand(cleaned))
		? cleaned
		: text;
}

function parseWorkReportArgs(args = "") {
	const tokens = String(args).trim().split(/\s+/).filter(Boolean);
	let json = false;
	const target = [];
	for (const token of tokens) {
		if (token === "--json") json = true;
		else target.push(token);
	}
	return { json, target: normalizeCommandTarget(target.join(" ")) };
}

function epicsByStatus(cwd, status) {
	const items = bdJsonRequired(cwd, [
		"list",
		"--type=epic",
		`--status=${status}`,
	]);
	return Array.isArray(items) ? items : [];
}

function childrenOfRequired(cwd, epicId) {
	try {
		const children = bdJsonRequired(cwd, ["children", epicId]);
		if (Array.isArray(children)) return children;
	} catch (error) {
		try {
			const children = bdJsonRequired(cwd, ["list", `--parent=${epicId}`]);
			return Array.isArray(children) ? children : [];
		} catch {
			throw error;
		}
	}
	return [];
}

function resolveReportTarget(cwd, target) {
	let wanted = target.trim();
	if (wanted && wanted !== "last") {
		const expanded = expandNumericBeadShorthand(cwd, wanted);
		if (expanded.error) return expanded;
		wanted = expanded.target;
		const issue = one(bdJsonRequired(cwd, ["show", wanted]));
		if (!issue)
			return {
				error: "unknown-target",
				message: `No Bead found for ${wanted}`,
			};
		return typeOf(issue) === "epic"
			? { kind: "epic", epic: issue }
			: { kind: "bead", bead: issue };
	}

	let candidates = [
		...epicsByStatus(cwd, "in_progress"),
		...epicsByStatus(cwd, "open"),
	].sort(byUpdatedDesc);
	if (candidates.length === 0) {
		try {
			candidates = bdJsonRequired(cwd, ["list", "--type=epic"])
				.filter((epic) => statusOf(epic) !== "closed")
				.sort(byUpdatedDesc);
		} catch {
			candidates = [];
		}
	}
	if (candidates.length === 1) return { kind: "epic", epic: candidates[0] };
	if (candidates.length > 1) return { error: "ambiguous-target", candidates };
	return {
		error: "no-default-target",
		message: "No open or in-progress epic found.",
	};
}

function gitReport(cwd) {
	const report = resumeGitReport(cwd);
	if (!report.ok)
		return {
			ok: false,
			status: "git status unavailable",
			warnings: ["git status unavailable"],
		};
	if (report.dirtyPaths.length && !report.blockedPaths.length) {
		const branch = report.status.split(/\r?\n/)[0] || "git status";
		return {
			ok: true,
			status: `${branch}\n(no blocking dirty files; ignored workflow/runtime dirt: ${report.dirtyPaths.join(", ")})`,
			warnings: report.warnings,
		};
	}
	return {
		ok: true,
		status: report.status || "clean",
		warnings: report.warnings,
	};
}

function parsePorcelainStatus(text) {
	return String(text ?? "")
		.split(/\r?\n/)
		.map((line) => line.trimEnd())
		.filter(Boolean)
		.map((line) => {
			const raw = line.slice(0, 2).padEnd(2, " ");
			return {
				status: raw.trim(),
				x: raw[0],
				y: raw[1],
				path: line.slice(3).replace(/^"|"$/g, ""),
			};
		});
}

function isInstructionFile(file) {
	return /(^|[/\\])(AGENTS|CLAUDE)\.md$/i.test(file);
}

function normalizeInstructionDiffLine(line) {
	return String(line ?? "")
		.trim()
		.replace(/<((?:https?|file):\/\/[^>\s]+)>/gi, "$1");
}

function instructionDiffSide(diff, marker) {
	return String(diff ?? "")
		.split(/\r?\n/)
		.filter(
			(line) =>
				line.startsWith(marker) &&
				!line.startsWith(`${marker}${marker}${marker}`),
		)
		.map((line) => normalizeInstructionDiffLine(line.slice(1)))
		.filter(Boolean);
}

function isFormatterOnlyInstructionDirt(cwd, item) {
	try {
		const diff = run(cwd, "git", ["diff", "--", item.path]);
		const removed = instructionDiffSide(diff, "-");
		const added = instructionDiffSide(diff, "+");
		return (
			removed.length === added.length &&
			removed.every((line, index) => line === added[index])
		);
	} catch {
		return false;
	}
}

function isBenignInstructionDirt(cwd, item) {
	if (!isInstructionFile(item.path)) return false;
	if (item.x !== " " || item.y !== "M") return false;
	try {
		run(cwd, "git", [
			"diff",
			"--quiet",
			"--ignore-all-space",
			"--ignore-blank-lines",
			"--",
			item.path,
		]);
		return true;
	} catch {
		return isFormatterOnlyInstructionDirt(cwd, item);
	}
}

function cleanupBenignInstructionDirt(cwd) {
	let dirtyFiles;
	try {
		dirtyFiles = parsePorcelainStatus(
			run(cwd, "git", ["status", "--porcelain=v1", "--untracked-files=all"]),
		);
	} catch {
		return;
	}
	for (const item of dirtyFiles) {
		if (!isBenignInstructionDirt(cwd, item)) continue;
		try {
			run(cwd, "git", ["checkout", "--", item.path]);
		} catch {
			// Best-effort cleanup only; never fail the workflow command for this.
		}
	}
}

function normalizedRepoPath(value) {
	return String(value ?? "").replace(/\\/g, "/");
}

function compactList(items = [], limit = 8) {
	const values = items.filter(Boolean);
	if (values.length <= limit) return values.join(", ");
	return `${values.slice(0, limit).join(", ")} … +${values.length - limit} more`;
}

function compactMultiline(value, limit = 20) {
	const lines = String(value ?? "")
		.split(/\r?\n/)
		.filter(Boolean);
	if (lines.length <= limit) return String(value ?? "");
	return [
		...lines.slice(0, limit),
		`… +${lines.length - limit} more lines`,
	].join("\n");
}

function isPiRuntimeArtifact(path) {
	const file = normalizedRepoPath(path);
	return (
		/^pi-session-.+\.html$/i.test(file) ||
		file.startsWith(".pi-subagents/") ||
		file.startsWith(".pi/work-runs/") ||
		file.startsWith(".pi/work-ideate/") ||
		file.startsWith(".work-orchestrator/")
	);
}

function isBeadsDirt(path) {
	const file = normalizedRepoPath(path);
	return file === ".beads" || file.startsWith(".beads/");
}

function isAllowedPlanDirt(path, planPaths = []) {
	const file = normalizedRepoPath(path);
	return planPaths.map(normalizedRepoPath).includes(file);
}

function isWorkflowDirt(cwd, item, planPaths = []) {
	const file = normalizedRepoPath(item.path);
	return (
		isBeadsDirt(file) ||
		isPiRuntimeArtifact(file) ||
		isAllowedPlanDirt(file, planPaths) ||
		isBenignInstructionDirt(cwd, item)
	);
}

function dirtyBlockers(cwd, dirtyFiles, planPaths = []) {
	return dirtyFiles.filter((item) => !isWorkflowDirt(cwd, item, planPaths));
}

function planRefsFromIssue(issue) {
	const text = JSON.stringify(issue ?? {});
	return [
		...text.matchAll(/(?:^|[\s"'(:])(@?docs[\\/]plans[\\/][^\s"'),]+\.md)/gi),
	].map((match) => normalizePathToken(normalizedRepoPath(match[1])));
}

function planBootstrapBlockers(cwd, git, planPath) {
	return dirtyBlockers(cwd, git.dirtyFiles, [planPath]);
}

function safeForPlanBootstrap(cwd, git, planPath) {
	return planBootstrapBlockers(cwd, git, planPath).length === 0;
}

function dirtyStopState(git, message) {
	const blockers = git.blockedPaths?.length ? git.blockedPaths : git.dirtyPaths;
	return errorState("dirty-stop", message, {
		action: "dirty-stop",
		git,
		suggestedCommands: [
			"git status --short",
			...blockers
				.filter((file) => normalizedRepoPath(file) === "AGENTS.md")
				.map((file) => `git diff -- ${file}`),
		],
	});
}

function planBootstrapDirtyStop(cwd, git, planPath, command) {
	const blockers = planBootstrapBlockers(cwd, git, planPath).map(
		(item) => item.path,
	);
	return dirtyStopState(
		{ ...git, blockedPaths: blockers },
		`Dirty files must be resolved before ${command} can mutate Beads. Blocking files: ${compactList(blockers) || "unknown"}.`,
	);
}

function resumeGitReport(cwd, planPaths = []) {
	try {
		const status =
			run(cwd, "git", ["status", "--short", "--branch"]) || "clean";
		const dirtyFiles = parsePorcelainStatus(
			run(cwd, "git", ["status", "--porcelain=v1", "--untracked-files=all"]),
		);
		const dirtyPaths = dirtyFiles.map((item) => item.path);
		const blockers = dirtyBlockers(cwd, dirtyFiles, planPaths);
		const blockedPaths = blockers.map((item) => item.path);
		const benignDirty =
			dirtyFiles.length > 0 &&
			dirtyFiles.every((item) => isBenignInstructionDirt(cwd, item));
		const workflowDirty =
			dirtyFiles.length > 0 && blockers.length === 0 && !benignDirty;
		let warnings = [];
		if (benignDirty) {
			warnings = [
				"Only whitespace/formatter instruction-file dirt detected; do not stage it automatically.",
			];
		} else if (workflowDirty) {
			warnings = [
				`Only workflow-owned dirt detected: ${compactList(dirtyPaths)}.`,
			];
		}
		return {
			ok: true,
			status,
			dirtyFiles,
			dirtyPaths,
			blockedPaths,
			safeForHandoff: blockers.length === 0,
			benignDirty,
			workflowDirty,
			warnings,
		};
	} catch {
		return {
			ok: false,
			status: "git status unavailable",
			dirtyFiles: [],
			dirtyPaths: [],
			blockedPaths: [],
			safeForHandoff: false,
			benignDirty: false,
			workflowDirty: false,
			warnings: ["git status unavailable"],
		};
	}
}

function isPlanningIssue(issue) {
	return (
		labelsOf(issue).includes("wo:planning") ||
		/wo:planning/.test(notesOf(issue)) ||
		/^plan next slice\b/i.test(titleOf(issue))
	);
}

function isBlockedIssue(issue) {
	const labels = labelsOf(issue);
	return (
		statusOf(issue) === "blocked" ||
		labels.includes("wo:blocked") ||
		labels.includes("wo:debug-needed")
	);
}

function isDebugIssue(issue) {
	return typeOf(issue) === "bug" || labelsOf(issue).includes("wo:debug");
}

function byCreatedAsc(a, b) {
	return String(createdAt(a) ?? "").localeCompare(String(createdAt(b) ?? ""));
}

function buildEpicChildState(cwd, epic) {
	const epicId = idOf(epic);
	const children = childrenOfRequired(cwd, epicId);
	const byId = new Map(children.map((issue) => [idOf(issue), issue]));
	const workItems = children.filter(isWorkSlice);
	const planning = workItems.filter(
		(issue) => isPlanningIssue(issue) && statusOf(issue) !== "closed",
	);
	const slices = workItems.filter((issue) => !isPlanningIssue(issue));
	const closed = slices.filter((issue) => statusOf(issue) === "closed");
	const inProgress = slices.filter(
		(issue) => statusOf(issue) === "in_progress",
	);
	const openDecisions = children.filter(
		(issue) => typeOf(issue) === "decision" && statusOf(issue) !== "closed",
	);
	const readyWork = workItems
		.filter(
			(issue) =>
				statusOf(issue) === "open" &&
				!isBlockedIssue(issue) &&
				depsOf(issue).every((id) => statusOf(byId.get(id)) === "closed"),
		)
		.sort(byCreatedAsc);
	const downstreamBlocked = workItems
		.filter((issue) => statusOf(issue) !== "closed")
		.flatMap((issue) =>
			depsOf(issue)
				.filter((dependencyId) => statusOf(byId.get(dependencyId)) !== "closed")
				.map((dependencyId) => ({
					bead: issueSummary(issue),
					blockedBy: issueSummary(
						byId.get(dependencyId) ?? { id: dependencyId },
					),
				})),
		);
	const blockers = workItems.filter((issue) => {
		if (statusOf(issue) === "closed") return false;
		return (
			isBlockedIssue(issue) ||
			typeOf(issue) === "bug" ||
			depsOf(issue).some((id) => statusOf(byId.get(id)) !== "closed")
		);
	});
	return {
		epicId,
		children,
		slices,
		closed,
		inProgress,
		openDecisions,
		planning,
		readyWork,
		downstreamBlocked,
		blockers,
	};
}

function candidateSummary(cwd, epic) {
	let counts = { children: 0, slices: 0, ready: 0, closed: 0 };
	try {
		const childState = buildEpicChildState(cwd, epic);
		counts = {
			children: childState.children.length,
			slices: childState.slices.length,
			ready: childState.readyWork.length,
			closed: childState.closed.length,
		};
	} catch {
		// Candidate lists should survive a broken child lookup.
	}
	return {
		...issueSummary(epic),
		created: createdAt(epic),
		counts,
	};
}

function resolveResumeTarget(cwd, target) {
	let wanted = normalizePathToken(target.trim());
	if (wanted && wanted !== "last") {
		const expanded = expandNumericBeadShorthand(cwd, wanted);
		if (expanded.error) return expanded;
		wanted = expanded.target;
		if (looksLikePath(wanted))
			return {
				error: "plan-path-target",
				message: `${wanted} looks like a plan path, not an epic ID. Use /work-plan ${wanted}.`,
				suggestedCommands: [`/work-plan ${wanted}`],
			};
		const issue = one(bdJsonRequired(cwd, ["show", wanted]));
		if (!issue)
			return {
				error: "unknown-target",
				message: `No Bead found for ${wanted}`,
			};
		if (typeOf(issue) === "epic") return { kind: "epic", epic: issue };
		return {
			error: "unsupported-target",
			message: `${wanted} is a child Bead; run /work-resume ${parentOf(issue) ?? "<epic-id>"} or /work-debug ${wanted}`,
		};
	}

	const inProgress = epicsByStatus(cwd, "in_progress").sort(byUpdatedDesc);
	if (inProgress.length === 1) return { kind: "epic", epic: inProgress[0] };
	if (inProgress.length > 1)
		return {
			error: "ambiguous-target",
			candidates: inProgress.map((epic) => candidateSummary(cwd, epic)),
		};

	const remembered = rememberedWorkflowEpic(cwd);
	if (remembered) {
		try {
			if (buildEpicChildState(cwd, remembered).children.length > 0)
				return { kind: "epic", epic: remembered };
		} catch {
			// Ignore stale remembered state and fall back to Beads discovery.
		}
	}

	let candidates = epicsByStatus(cwd, "open").sort(byUpdatedDesc);
	if (candidates.length === 0) {
		try {
			candidates = bdJsonRequired(cwd, ["list", "--type=epic"])
				.filter((epic) => statusOf(epic) !== "closed")
				.sort(byUpdatedDesc);
		} catch {
			candidates = [];
		}
	}
	if (candidates.length === 1) return { kind: "epic", epic: candidates[0] };
	const withReady = candidates.filter((epic) => {
		try {
			return buildEpicChildState(cwd, epic).readyWork.length > 0;
		} catch {
			return false;
		}
	});
	if (withReady.length > 0)
		return { kind: "epic", epic: withReady.sort(byUpdatedDesc)[0] };
	if (candidates.length > 1)
		return {
			error: "ambiguous-target",
			candidates: candidates.map((epic) => candidateSummary(cwd, epic)),
		};
	return {
		error: "no-default-target",
		message: "No open or in-progress epic found.",
	};
}

function resumeBlockers(childState) {
	return childState.blockers.map((issue) => ({
		...issueSummary(issue),
		dependencies: depsOf(issue),
		notes: noteDetails(issue),
	}));
}

function planResumeAction(state) {
	if (!state.ok) return state;
	if (state.git && !state.git.safeForHandoff) {
		const blockers = state.git.blockedPaths?.length
			? state.git.blockedPaths
			: state.git.dirtyPaths;
		return {
			...state,
			action: "dirty-stop",
			message: `Dirty files must be resolved before /work-resume can launch writers. Blocking files: ${compactList(blockers) || "unknown"}.`,
			suggestedCommands: [
				"git status --short",
				...blockers
					.filter((file) => normalizedRepoPath(file) === "AGENTS.md")
					.map((file) => `git diff -- ${file}`),
				`/work-report ${state.epic.id}`,
			],
		};
	}
	if (state.epic.status === "closed")
		return {
			...state,
			action: "done-candidate",
			message: "Epic is closed.",
			suggestedCommands: [],
			nextAction: `Next: epic ${state.epic.id} "${state.epic.title}" is complete.`,
		};
	if (
		state.readyPlanning.length &&
		state.executableSlices.length &&
		!state.readyExecutable.length
	)
		return {
			...state,
			action: "close-stale-planning",
			selectedBead: state.readyPlanning[0],
			message:
				"A ready planning Bead exists after executable children were created; close or update it before resuming.",
			suggestedCommands: [
				`bd close ${state.readyPlanning[0].id}`,
				`/work-resume ${state.epic.id}`,
			],
		};
	const debug = state.readyExecutable.find(isDebugIssue);
	if (debug)
		return withHandoffPrompt({
			...state,
			action: "run-debug",
			selectedBead: debug,
		});
	const implementation = state.readyExecutable.find(
		(issue) => !isPlanningIssue(issue),
	);
	if (implementation)
		return withHandoffPrompt({
			...state,
			action: "run-implementation",
			selectedBead: implementation,
		});
	if (state.readyPlanning.length)
		return withHandoffPrompt({
			...state,
			action: "run-planner",
			selectedBead: state.readyPlanning[0],
		});
	if (
		state.blockers.length ||
		state.openDecisions.length ||
		state.downstreamBlocked.length
	)
		return {
			...state,
			action: "report-blocked",
			message:
				"No runnable Bead is ready; blockers or decisions need attention.",
			suggestedCommands: suggestedCommands(
				state.epic.id,
				state.blockers,
				state.openDecisions,
			),
		};
	return withHandoffPrompt({
		...state,
		action: "run-planner",
		message:
			"No ready work or blockers; ask the planner to create the next slice or confirm done.",
	});
}

const ROLE_TIMEOUT_GUIDANCE =
	"Role timeout guidance: prefer no explicit timeout; if one is required, planner/worker/reviewer/fixer/debugger/migrator get at least 10 minutes and committer gets at least 3 minutes. Treat timeout as infrastructure failure evidence, not implementation failure.";

function gitDirtyClassification(git) {
	if (!git) return "unknown";
	if (git.blockedPaths?.length) return "dirty-stop/unsafe";
	if (git.workflowDirty) return "workflow-owned allowlist";
	if (git.benignDirty) return "instruction-file allowlist";
	if (git.dirtyPaths?.length) return "workflow-owned allowlist";
	return "clean";
}

function roleHandoffPrompt(state, mode, extraLines = []) {
	const selected = state.selectedBead;
	const selectedLine = selected
		? `${selected.id} ${selected.type} ${selected.status} — ${selected.title}`
		: "none; create/reuse a wo:planning Bead if needed";
	const plannerLines =
		state.action === "run-planner"
			? [
					"Planner efficiency: do not run raw `bd show <epic-id> --json`; project epics can contain full roadmap plans. Use compact bd show projections or the referenced plan file's expected unit section plus summarized child ids/titles/status.",
				]
			: [];
	return [
		`Use the work-orchestrator skill in mode: ${mode} with this precomputed extension state.`,
		state.epic ? `Epic: ${state.epic.id} — ${state.epic.title}` : "Epic: none",
		`Action: ${state.action}`,
		`Selected Bead: ${selectedLine}`,
		`Git dirty classification: ${gitDirtyClassification(state.git)}`,
		state.git?.dirtyPaths?.length
			? `Known dirty paths: ${state.git.dirtyPaths.join(", ")}`
			: "Known dirty paths: none",
		ROLE_TIMEOUT_GUIDANCE,
		"Subagent output guidance: set outputMode:file-only with a short relative output filename unless the full result is under 20 lines; do not pass .pi-subagents/ paths because the subagent tool owns the artifact directory.",
		"Beads output hygiene: raw `bd ready --json`, `bd children --json`, or epic `bd show --json` can dump full roadmap plans; pipe them through python/node projections that print only ids, status, titles, and needed fields.",
		"Closure rule: worker/reviewer/fixer/debugger roles must leave Beads open for parent/committer close after review, verification, and commit.",
		selected?.id
			? `Review scope default: current Bead ${selected.id} and its diff/verification evidence; do not run broad whole-repo review unless this Bead explicitly requires it.`
			: "Review scope default: current diff for this epic; do not run broad whole-repo review unless the action explicitly requires it.",
		...plannerLines,
		...extraLines.filter(Boolean),
		"Do not rediscover target selection. Verify Beads/git freshness, then run exactly this action and stop after one Bead or planning boundary.",
		selected?.id ? `Target Bead ID: ${selected.id}` : "Target Bead ID: none",
	].join("\n");
}

function withHandoffPrompt(state) {
	return {
		...state,
		handoffPrompt: roleHandoffPrompt(state, "resume", state.handoffExtra ?? []),
	};
}

function parseWorkResumeArgs(args = "") {
	return parseWorkReportArgs(args);
}

function buildWorkResumeState(cwd, args = "") {
	const { target } = parseWorkResumeArgs(args);
	try {
		const resolved = resolveResumeTarget(cwd, target);
		if (resolved.error)
			return errorState(resolved.error, resolved.message ?? resolved.error, {
				action: "ask-target",
				candidates: resolved.candidates ?? [],
				suggestedCommands: resolved.suggestedCommands ?? [],
			});
		rememberWorkflowEpic(cwd, resolved.epic);
		const childState = buildEpicChildState(cwd, resolved.epic);
		const git = resumeGitReport(cwd, planRefsFromIssue(resolved.epic));
		const readyPlanning = childState.readyWork
			.filter(isPlanningIssue)
			.map(issueSummary);
		const readyExecutable = childState.readyWork
			.filter((issue) => !isPlanningIssue(issue))
			.map(issueSummary);
		const executableSlices = childState.slices
			.filter(
				(issue) => !isPlanningIssue(issue) && typeOf(issue) !== "decision",
			)
			.map(issueSummary);
		const base = {
			ok: true,
			target: { requested: target || "last", kind: "epic" },
			epic: issueSummary(resolved.epic),
			counts: {
				children: childState.children.length,
				slices: childState.slices.length,
				closed: childState.closed.length,
				inProgress: childState.inProgress.length,
				ready: childState.readyWork.length,
				readyExecutable: readyExecutable.length,
				planning: childState.planning.length,
				blockers: childState.blockers.length,
				decisions: childState.openDecisions.length,
			},
			readyWork: childState.readyWork.map(issueSummary),
			readyExecutable,
			readyPlanning,
			executableSlices,
			blockers: resumeBlockers(childState),
			downstreamBlocked: childState.downstreamBlocked,
			openDecisions: childState.openDecisions.map(issueSummary),
			git,
			suggestedCommands: [`/work-resume ${childState.epicId}`],
			warnings: git.warnings,
		};
		return planResumeAction(base);
	} catch (error) {
		return errorState(error.reason ?? "beads-error", error.message, {
			action: "beads-error",
			suggestedCommands: [],
		});
	}
}

function buildEpicReportState(cwd, epic) {
	rememberWorkflowEpic(cwd, epic);
	const childState = buildEpicChildState(cwd, epic);
	const git = gitReport(cwd);
	const complete =
		statusOf(epic) === "closed" ||
		(childState.slices.length > 0 &&
			childState.closed.length === childState.slices.length &&
			childState.inProgress.length === 0 &&
			childState.readyWork.length === 0 &&
			childState.blockers.length === 0 &&
			childState.openDecisions.length === 0);
	let suggested = [];
	if (!complete) {
		if (childState.blockers.length || childState.openDecisions.length)
			suggested = suggestedCommands(
				childState.epicId,
				childState.blockers,
				childState.openDecisions,
			);
		else suggested = [`/work-resume ${childState.epicId}`];
	}
	return {
		ok: true,
		target: { requested: childState.epicId, kind: "epic" },
		epic: issueSummary(epic),
		counts: {
			children: childState.children.length,
			slices: childState.slices.length,
			closed: childState.closed.length,
			inProgress: childState.inProgress.length,
			ready: childState.readyWork.length,
			blockers: childState.blockers.length,
			decisions: childState.openDecisions.length,
		},
		blockers: resumeBlockers(childState),
		downstreamBlocked: childState.downstreamBlocked,
		openDecisions: childState.openDecisions.map(issueSummary),
		readyWork: childState.readyWork.map(issueSummary),
		git,
		nextAction: complete
			? `Next: epic ${childState.epicId} "${titleOf(epic)}" is complete.`
			: undefined,
		suggestedCommands: suggested,
		noteExcerpts: childState.blockers
			.map((issue) => ({ id: idOf(issue), text: noteExcerpt(issue) }))
			.filter((item) => item.text),
		warnings: git.warnings,
	};
}

function buildBeadReportState(cwd, bead) {
	const parentId = parentOf(bead);
	if (parentId) {
		try {
			rememberWorkflowEpic(cwd, one(bdJsonRequired(cwd, ["show", parentId])));
		} catch {
			// Best-effort memory only; report should not fail on parent lookup.
		}
	}
	const siblings = parentId ? childrenOfRequired(cwd, parentId) : [];
	const byId = new Map(siblings.map((issue) => [idOf(issue), issue]));
	const dependencyIds = depsOf(bead);
	const dependents = siblings.filter((issue) =>
		depsOf(issue).includes(idOf(bead)),
	);
	const git = gitReport(cwd);
	const notes = noteDetails(bead);
	return {
		ok: true,
		target: { requested: idOf(bead), kind: "bead" },
		epic: parentId ? { id: parentId } : undefined,
		bead: {
			...issueSummary(bead),
			dependencies: dependencyIds.map((id) => issueRef(byId.get(id) ?? { id })),
			dependents: dependents.map(issueSummary),
			notes,
		},
		counts: {
			dependencies: dependencyIds.length,
			dependents: dependents.length,
		},
		blockers: dependencyIds.map((id) => issueRef(byId.get(id) ?? { id })),
		downstreamBlocked: dependents.map((issue) => ({
			bead: issueSummary(issue),
			blockedBy: issueSummary(bead),
		})),
		openDecisions: [],
		readyWork: [],
		git,
		suggestedCommands: [
			notes.nextAction ||
				suggestedCommands(parentId ?? idOf(bead), [], [bead])[0],
		].filter(Boolean),
		noteExcerpts: notesOf(bead)
			? [{ id: idOf(bead), text: noteExcerpt(bead, 800) }]
			: [],
		warnings: git.warnings,
	};
}

function suggestedCommands(epicId, blockers = [], decisions = []) {
	const runnableDebug = blockers.find(
		(issue) =>
			statusOf(issue) !== "blocked" &&
			(typeOf(issue) === "bug" || isDebugIssue(issue)),
	);
	if (runnableDebug)
		return [`/work-debug ${idOf(runnableDebug)}: investigate blocker`];
	const blockedDecision = decisions[0];
	if (blockedDecision) return [`/work-report ${idOf(blockedDecision)}`];
	const externalBlocker = blockers.find(
		(issue) =>
			statusOf(issue) === "blocked" || labelsOf(issue).includes("wo:blocked"),
	);
	if (externalBlocker) return [`/work-report ${idOf(externalBlocker)}`];
	const blockedWork = blockers[0];
	if (blockedWork) return [`/work-report ${idOf(blockedWork)}`];
	return epicId ? [`/work-report ${epicId}`] : [];
}

function isBeadId(value) {
	return /^[A-Za-z][A-Za-z0-9_-]*-[A-Za-z0-9_.-]+$/.test(value ?? "");
}

function isNumericBeadShorthand(value) {
	return /^\d+$/.test(String(value ?? "").trim());
}

function idHasNumericSuffix(id, suffix) {
	return new RegExp(`[._-]${suffix}$`).test(String(id ?? ""));
}

function activeEpicCandidates(cwd) {
	let candidates = [
		...epicsByStatus(cwd, "in_progress"),
		...epicsByStatus(cwd, "open"),
	].sort(byUpdatedDesc);
	if (candidates.length) return candidates;
	try {
		candidates = bdJsonRequired(cwd, ["list", "--type=epic"])
			.filter((epic) => statusOf(epic) !== "closed")
			.sort(byUpdatedDesc);
	} catch {
		candidates = [];
	}
	return candidates;
}

function expandNumericBeadShorthand(cwd, target, kind = "any") {
	const text = String(target ?? "").trim();
	if (!isNumericBeadShorthand(text)) return { target: text };
	const epics = activeEpicCandidates(cwd);
	const children = [];
	if (kind !== "epic") {
		for (const epic of epics) {
			children.push(
				...childrenOfRequired(cwd, idOf(epic)).filter((issue) =>
					idHasNumericSuffix(idOf(issue), text),
				),
			);
		}
	}
	const epicsMatching =
		kind === "bead"
			? []
			: epics.filter((epic) => idHasNumericSuffix(idOf(epic), text));
	// Prefer child Beads for the common `/work-debug 19:` case when the epic is E-1.
	const matches = children.length ? children : epicsMatching;
	const unique = [
		...new Map(matches.map((issue) => [idOf(issue), issue])).values(),
	];
	if (unique.length === 1) return { target: idOf(unique[0]), issue: unique[0] };
	if (unique.length > 1)
		return {
			error: "ambiguous-target",
			message: `Numeric Bead shorthand ${text} matches multiple Beads; use the full ID.`,
			candidates: unique.map(issueSummary),
		};
	return {
		error: "unknown-target",
		message: `No active Bead matches numeric shorthand ${text}; use the full ID.`,
	};
}

function ensureBeadsInitialized(cwd) {
	try {
		run(cwd, "bd", ["where", "--json"]);
		return {
			initialized: false,
			message: "Beads workspace already initialized.",
		};
	} catch (error) {
		const reason = classifyBdError(error, ["where"]);
		if (reason !== "beads-unavailable") {
			const err = new Error(commandErrorText(error) || "bd command failed");
			err.reason = reason;
			throw err;
		}
	}
	try {
		run(cwd, "bd", ["init", "--non-interactive", "--skip-agents"]);
		return {
			initialized: true,
			message: "Initialized Beads with bd init --skip-agents.",
		};
	} catch (error) {
		const err = new Error(commandErrorText(error) || "bd init failed");
		err.reason = classifyBdError(error, ["init"]);
		throw err;
	}
}

function createBead(
	cwd,
	{
		title,
		type = "task",
		parent,
		notes,
		description,
		design,
		designFile,
		acceptance,
	},
) {
	const args = ["create", title, "--type", type];
	if (parent) args.push("--parent", parent);
	if (description) args.push("--description", description);
	if (designFile) args.push("--design-file", designFile);
	else if (design) args.push("--design", design);
	if (acceptance) args.push("--acceptance", acceptance);
	if (notes) args.push("--notes", notes);
	return one(bdJsonRequired(cwd, args));
}

function appendBeadNote(cwd, id, note) {
	return one(bdJsonRequired(cwd, ["update", id, "--append-notes", note]));
}

function debugNeededId(issue) {
	const text = [...labelsOf(issue), notesOf(issue)].join("\n");
	return text.match(/debug-needed:([^\s,;]+)/)?.[1] ?? "";
}

function resolveWorkflowEpic(cwd, target = "") {
	let wanted = normalizeCommandTarget(target);
	if (wanted && wanted !== "last") {
		const expanded = expandNumericBeadShorthand(cwd, wanted, "epic");
		if (expanded.error) return expanded;
		wanted = expanded.target;
		const issue = one(bdJsonRequired(cwd, ["show", wanted]));
		if (!issue)
			return {
				error: "unknown-target",
				message: `No Bead found for ${wanted}`,
			};
		if (typeOf(issue) !== "epic")
			return {
				error: "unsupported-target",
				message: `${wanted} is not an epic.`,
			};
		rememberWorkflowEpic(cwd, issue);
		return { kind: "epic", epic: issue };
	}

	const remembered = rememberedWorkflowEpic(cwd);
	if (wanted === "last" && remembered)
		return { kind: "epic", epic: remembered };

	const active = epicsByStatus(cwd, "in_progress").sort(byUpdatedDesc);
	if (active.length === 1) {
		rememberWorkflowEpic(cwd, active[0]);
		return { kind: "epic", epic: active[0] };
	}
	if (active.length > 1)
		return {
			error: "ambiguous-target",
			message:
				"Multiple active epics found; pass --epic <id> or target a Bead.",
			candidates: active.map((epic) => candidateSummary(cwd, epic)),
		};

	const open = epicsByStatus(cwd, "open").sort(byUpdatedDesc);
	if (open.length === 1) {
		rememberWorkflowEpic(cwd, open[0]);
		return { kind: "epic", epic: open[0] };
	}
	return {
		error: "no-active-epic",
		message: "No active epic found; pass --epic <id>.",
		candidates: open.map((epic) => candidateSummary(cwd, epic)),
	};
}

function buildWorkflowIntakeState(cwd, args = "") {
	const { target } = parseWorkReportArgs(args);
	try {
		const resolved = resolveWorkflowEpic(cwd, target);
		if (resolved.error)
			return errorState(resolved.error, resolved.message ?? resolved.error, {
				candidates: resolved.candidates ?? [],
			});
		const childState = buildEpicChildState(cwd, resolved.epic);
		const git = resumeGitReport(cwd);
		return {
			ok: true,
			epic: issueSummary(resolved.epic),
			counts: {
				children: childState.children.length,
				slices: childState.slices.length,
				inProgress: childState.inProgress.length,
				ready: childState.readyWork.length,
				blockers: childState.blockers.length,
			},
			inProgress: childState.inProgress.map(issueSummary),
			readyWork: childState.readyWork.map(issueSummary),
			git,
			warnings: git.warnings,
		};
	} catch (error) {
		return errorState(error.reason ?? "beads-error", error.message);
	}
}

function checkpointNote({ epic, bead, git, userNote }) {
	const details = bead ? noteDetails(bead) : {};
	const dirty = git.dirtyPaths?.length ? git.dirtyPaths.join(", ") : "clean";
	return [
		"work-pause checkpoint",
		`epic: ${idOf(epic)} — ${titleOf(epic)}`,
		bead ? `bead: ${idOf(bead)} — ${titleOf(bead)}` : "bead: none",
		`git: ${dirty}`,
		`last verification: ${details.commands?.at(-1) ?? "unknown"}`,
		`failures: ${details.reason || "none recorded"}`,
		`remaining work: ${details.nextAction || `resume /work-resume ${idOf(epic)}`}`,
		userNote ? `note: ${userNote}` : "note: none",
		`next: /work-resume ${idOf(epic)}`,
	].join("\n");
}

function buildWorkPauseState(cwd, args = "") {
	const { target: note, json } = parseWorkReportArgs(args);
	try {
		const intake = buildWorkflowIntakeState(cwd, "");
		if (!intake.ok) return { ...intake, action: "stop", json };
		const resolved = resolveWorkflowEpic(cwd, "");
		if (resolved.error)
			return errorState(resolved.error, resolved.message ?? resolved.error, {
				action: "stop",
				candidates: resolved.candidates ?? [],
			});
		const childState = buildEpicChildState(cwd, resolved.epic);
		const git = resumeGitReport(cwd);
		const bead =
			childState.inProgress.length === 1 ? childState.inProgress[0] : undefined;
		const noteText = checkpointNote({
			epic: resolved.epic,
			bead,
			git,
			userNote: note,
		});
		if (!bead)
			return {
				ok: true,
				action: "draft-checkpoint",
				epic: issueSummary(resolved.epic),
				git,
				note: noteText,
				message:
					"No single in-progress Bead found; checkpoint draft was not appended.",
				warnings: git.warnings,
				json,
			};
		appendBeadNote(cwd, idOf(bead), noteText);
		return {
			ok: true,
			action: "checkpoint-appended",
			epic: issueSummary(resolved.epic),
			selectedBead: issueSummary(bead),
			git,
			note: noteText,
			message: `Checkpoint appended to ${idOf(bead)}.`,
			warnings: git.warnings,
			json,
		};
	} catch (error) {
		return errorState(error.reason ?? "beads-error", error.message, {
			action: "beads-error",
		});
	}
}

function splitTargetGuidance(args = "") {
	const text = String(args).trim();
	const colon = text.indexOf(":");
	if (colon !== -1)
		return {
			target: text.slice(0, colon).trim(),
			guidance: text.slice(colon + 1).trim(),
		};
	const [first, rest] = splitFirstWord(text);
	if (rest && (isBeadId(first) || isNumericBeadShorthand(first)))
		return { target: first, guidance: rest.trim() };
	return { target: text, guidance: "" };
}

function findExistingDebugBug(cwd, target) {
	const parentId = parentOf(target);
	if (!parentId) return undefined;
	const children = childrenOfRequired(cwd, parentId);
	const deps = depsOf(target);
	return children.find(
		(issue) =>
			statusOf(issue) !== "closed" &&
			isDebugIssue(issue) &&
			(deps.includes(idOf(issue)) || notesOf(issue).includes(idOf(target))),
	);
}

function debugHandoff(state, guidance = "") {
	return {
		...state,
		handoffPrompt: roleHandoffPrompt(state, "debug", [
			`Debug Bead: ${state.selectedBead.id} — ${state.selectedBead.title}`,
			guidance ? `Guidance: ${guidance}` : "Guidance: none",
			"Do not rediscover the debug target. Verify Beads/git freshness, then run the debug loop for this Bead.",
		]),
	};
}

function buildWorkDebugState(cwd, args = "") {
	let { target, guidance } = splitTargetGuidance(args);
	if (!target)
		return errorState("usage", "Usage: /work-debug <bug-or-bead-id|symptom>", {
			action: "usage",
		});
	try {
		const expanded = expandNumericBeadShorthand(cwd, target);
		if (expanded.error)
			return errorState(expanded.error, expanded.message, expanded);
		target = expanded.target;
		const git = resumeGitReport(cwd);
		if (!git.safeForHandoff)
			return dirtyStopState(
				git,
				"Dirty files must be resolved before /work-debug can launch writers.",
			);
		let source;
		let bug;
		let epic;
		if (isBeadId(target)) {
			source = one(bdJsonRequired(cwd, ["show", target]));
			if (!source)
				return errorState("unknown-target", `No Bead found for ${target}`);
			const linked = debugNeededId(source);
			if (linked) bug = one(bdJsonRequired(cwd, ["show", linked]));
			if (!bug && (isDebugIssue(source) || isBlockedIssue(source)))
				bug = source;
			if (!bug) bug = findExistingDebugBug(cwd, source);
			const parentId =
				typeOf(source) === "epic" ? idOf(source) : parentOf(source);
			if (!parentId)
				return errorState("unknown-parent", "Debug target has no parent epic.");
			epic =
				typeOf(source) === "epic"
					? source
					: one(bdJsonRequired(cwd, ["show", parentId]));
			if (!bug) {
				bug = createBead(cwd, {
					title: `Debug ${titleOf(source)}`,
					type: "bug",
					parent: parentId,
					notes: `debug target: ${idOf(source)}`,
				});
				if (typeOf(source) !== "epic")
					run(cwd, "bd", ["dep", "add", idOf(source), idOf(bug)]);
			}
		} else {
			const resolved = resolveWorkflowEpic(cwd, "");
			if (resolved.error)
				return errorState(resolved.error, resolved.message ?? resolved.error, {
					action: "ask-target",
					candidates: resolved.candidates ?? [],
				});
			epic = resolved.epic;
			bug = createBead(cwd, {
				title: target,
				type: "bug",
				parent: idOf(epic),
				notes: guidance ? `guidance: ${guidance}` : "created by /work-debug",
			});
		}
		if (guidance && bug && !(source === undefined && !isBeadId(target))) {
			if (isBlockedIssue(bug))
				bug = one(
					bdJsonRequired(cwd, [
						"update",
						idOf(bug),
						"--status",
						"open",
						"--append-notes",
						`retry-guidance: ${guidance}`,
					]),
				);
			else appendBeadNote(cwd, idOf(bug), `guidance: ${guidance}`);
		}
		if (bug && isBlockedIssue(bug) && !guidance)
			return {
				ok: true,
				action: "debug-blocked",
				epic: issueSummary(epic ?? { id: parentOf(bug) }),
				selectedBead: issueSummary(bug),
				sourceBead: source ? issueSummary(source) : undefined,
				git,
				message: `Debug Bead ${idOf(bug)} is already blocked. Add guidance after ':' to retry, otherwise use /work-report ${idOf(bug)}.`,
				suggestedCommands: [
					`/work-report ${idOf(bug)}`,
					`/work-debug ${idOf(bug)}: <what changed / what to retry>`,
				],
				warnings: git.warnings,
			};
		return debugHandoff(
			{
				ok: true,
				action:
					source && idOf(source) !== idOf(bug)
						? "debug-resolved"
						: "debug-ready",
				epic: issueSummary(epic ?? { id: parentOf(bug) }),
				selectedBead: issueSummary(bug),
				sourceBead: source ? issueSummary(source) : undefined,
				git,
				message: `Debug target ready: ${idOf(bug)}.`,
				warnings: git.warnings,
			},
			guidance,
		);
	} catch (error) {
		return errorState(error.reason ?? "beads-error", error.message, {
			action: error.reason ?? "beads-error",
		});
	}
}

function parseWorkAddArgs(args = "") {
	const tokens = String(args).trim().split(/\s+/).filter(Boolean);
	const task = [];
	let epic = "";
	let blockedBy = "";
	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index];
		if (token === "--epic") epic = tokens[++index] ?? "";
		else if (token === "--blocked-by") blockedBy = tokens[++index] ?? "";
		else task.push(token);
	}
	return { epic, blockedBy, task: task.join(" ") };
}

function buildWorkAddState(cwd, args = "") {
	const parsed = parseWorkAddArgs(args);
	if (!parsed.task)
		return errorState(
			"usage",
			"Usage: /work-add [--epic <id>] [--blocked-by <bead-id>] <task>",
			{
				action: "usage",
			},
		);
	try {
		const intake = parsed.epic ? undefined : buildWorkflowIntakeState(cwd, "");
		if (intake && !intake.ok) return { ...intake, action: "ask-target" };
		const git = resumeGitReport(cwd);
		if (!git.safeForHandoff)
			return dirtyStopState(
				git,
				"Dirty files must be resolved before /work-add can mutate Beads.",
			);
		const resolved = resolveParsedEpic(cwd, parsed);
		if (resolved.error)
			return errorState(resolved.error, resolved.message ?? resolved.error, {
				action: "ask-target",
				candidates: resolved.candidates ?? [],
			});
		let blocker;
		if (parsed.blockedBy) {
			const expanded = expandNumericBeadShorthand(
				cwd,
				parsed.blockedBy,
				"bead",
			);
			if (expanded.error)
				return errorState(expanded.error, expanded.message, expanded);
			blocker = one(bdJsonRequired(cwd, ["show", expanded.target]));
		}
		const bead = createBead(cwd, {
			title: parsed.task,
			type: "task",
			parent: idOf(resolved.epic),
			notes: "created by /work-add",
		});
		if (blocker) run(cwd, "bd", ["dep", "add", idOf(bead), idOf(blocker)]);
		return {
			ok: true,
			action: "work-added",
			epic: issueSummary(resolved.epic),
			selectedBead: issueSummary(bead),
			blockedBy: blocker ? issueSummary(blocker) : undefined,
			git,
			message: `Created ${idOf(bead)} under ${idOf(resolved.epic)}.`,
			warnings: git.warnings,
		};
	} catch (error) {
		return errorState(error.reason ?? "beads-error", error.message, {
			action: error.reason ?? "beads-error",
		});
	}
}

function explicitBeadIn(text) {
	return (
		String(text).match(/\b[A-Za-z][A-Za-z0-9_-]*-[A-Za-z0-9_.-]+\b/)?.[0] ?? ""
	);
}

function buildWorkAutoState(cwd, args = "") {
	const task = String(args).trim();
	if (!task)
		return errorState("usage", "Usage: /work-auto <task>", { action: "usage" });
	try {
		const git = resumeGitReport(cwd);
		if (!git.safeForHandoff)
			return dirtyStopState(
				git,
				"Dirty files must be resolved before /work-auto can launch writers.",
			);
		const beadId = explicitBeadIn(task);
		if (beadId) {
			const issue = one(bdJsonRequired(cwd, ["show", beadId]));
			if (issue && (isBlockedIssue(issue) || debugNeededId(issue)))
				return buildWorkDebugState(cwd, beadId);
		}
		return {
			ok: true,
			action: "handoff-auto",
			git,
			handoffPrompt: [
				"Use the work-orchestrator skill in mode: auto.",
				`Task: ${task}`,
				"Classify semantically in the skill path; the extension only checked empty input, explicit Bead routing, and git safety.",
			].join("\n"),
			message: "Auto handoff queued.",
			warnings: git.warnings,
		};
	} catch (error) {
		return errorState(error.reason ?? "beads-error", error.message, {
			action: error.reason ?? "beads-error",
		});
	}
}

function workflowBeadNotes(command, task, extra = []) {
	return [
		`created by ${command}`,
		...extra,
		`task: ${task}`,
		ROLE_TIMEOUT_GUIDANCE,
	]
		.filter(Boolean)
		.join("\n");
}

function resolveParsedEpic(cwd, parsed) {
	if (!parsed.epic) return resolveWorkflowEpic(cwd, "");
	const expanded = expandNumericBeadShorthand(cwd, parsed.epic, "epic");
	if (expanded.error) return expanded;
	const epic = one(bdJsonRequired(cwd, ["show", expanded.target]));
	return typeOf(epic) === "epic"
		? { kind: "epic", epic }
		: {
				error: "unsupported-target",
				message: `${parsed.epic} is not an epic.`,
			};
}

function buildWorkSmallState(cwd, args = "") {
	const raw = String(args).trim();
	if (!raw)
		return errorState(
			"usage",
			"Usage: /work-small [--epic <id>|<bead-id>] <task>",
			{ action: "usage" },
		);
	try {
		const git = resumeGitReport(cwd);
		if (!git.safeForHandoff)
			return dirtyStopState(
				git,
				"Dirty files must be resolved before /work-small can launch writers.",
			);
		const [first, ...rest] = raw.split(/\s+/);
		const expandedFirst =
			first === "--epic"
				? { target: first }
				: expandNumericBeadShorthand(cwd, first);
		if (expandedFirst.error)
			return errorState(
				expandedFirst.error,
				expandedFirst.message,
				expandedFirst,
			);
		const firstTarget = expandedFirst.target;
		if (isBeadId(firstTarget) && firstTarget !== "--epic") {
			const issue = one(bdJsonRequired(cwd, ["show", firstTarget]));
			if (!issue)
				return errorState("unknown-target", `No Bead found for ${firstTarget}`);
			if (typeOf(issue) !== "epic") {
				const epic = one(bdJsonRequired(cwd, ["show", parentOf(issue)]));
				return withHandoffPrompt({
					ok: true,
					action: "run-implementation",
					epic: issueSummary(epic),
					selectedBead: issueSummary(issue),
					git,
					message: `Using existing ${idOf(issue)}.`,
					warnings: git.warnings,
					handoffExtra: rest.length ? [`Task guidance: ${rest.join(" ")}`] : [],
				});
			}
			const task = rest.join(" ").trim();
			if (!task)
				return errorState("usage", "Usage: /work-small <epic-id> <task>", {
					action: "usage",
				});
			const bead = createBead(cwd, {
				title: task,
				type: "task",
				parent: idOf(issue),
				notes: workflowBeadNotes("/work-small", task, ["wo:implementation"]),
			});
			return withHandoffPrompt({
				ok: true,
				action: "run-implementation",
				epic: issueSummary(issue),
				selectedBead: issueSummary(bead),
				git,
				message: `Created ${idOf(bead)} under ${idOf(issue)}.`,
				warnings: git.warnings,
			});
		}
		const parsed = parseWorkAddArgs(raw);
		const resolved = resolveParsedEpic(cwd, parsed);
		if (resolved.error)
			return errorState(resolved.error, resolved.message ?? resolved.error, {
				action: "ask-target",
				candidates: resolved.candidates ?? [],
			});
		const bead = createBead(cwd, {
			title: parsed.task,
			type: "task",
			parent: idOf(resolved.epic),
			notes: workflowBeadNotes("/work-small", parsed.task, [
				"wo:implementation",
			]),
		});
		return withHandoffPrompt({
			ok: true,
			action: "run-implementation",
			epic: issueSummary(resolved.epic),
			selectedBead: issueSummary(bead),
			git,
			message: `Created ${idOf(bead)} under ${idOf(resolved.epic)}.`,
			warnings: git.warnings,
		});
	} catch (error) {
		return errorState(error.reason ?? "beads-error", error.message, {
			action: error.reason ?? "beads-error",
		});
	}
}

function buildPlanningStartState(cwd, args = "", size = "med") {
	const parsed = parseWorkAddArgs(args);
	if (!parsed.task)
		return errorState("usage", `Usage: /work-${size} [--epic <id>] <task>`, {
			action: "usage",
		});
	try {
		const git = resumeGitReport(cwd);
		if (!git.safeForHandoff)
			return dirtyStopState(
				git,
				`Dirty files must be resolved before /work-${size} can mutate Beads.`,
			);
		const resolved = resolveParsedEpic(cwd, parsed);
		if (resolved.error)
			return errorState(resolved.error, resolved.message ?? resolved.error, {
				action: "ask-target",
				candidates: resolved.candidates ?? [],
			});
		const posture =
			size === "big"
				? "big slice: split into executable Beads and decision Beads before implementation"
				: "medium slice: create one executable child Bead by default before implementation; create up to three only for obvious low-risk sequences";
		const bead = createBead(cwd, {
			title: parsed.task,
			type: "task",
			parent: idOf(resolved.epic),
			notes: workflowBeadNotes(`/work-${size}`, parsed.task, [
				"wo:planning",
				posture,
			]),
		});
		return withHandoffPrompt({
			ok: true,
			action: "run-planner",
			epic: issueSummary(resolved.epic),
			selectedBead: issueSummary(bead),
			git,
			message: `Created planning Bead ${idOf(bead)} under ${idOf(resolved.epic)}.`,
			warnings: git.warnings,
			handoffExtra: [
				posture,
				"Planner must verify dependency direction with bd ready --json.",
			],
		});
	} catch (error) {
		return errorState(error.reason ?? "beads-error", error.message, {
			action: error.reason ?? "beads-error",
		});
	}
}

function buildWorkMedState(cwd, args = "") {
	return buildPlanningStartState(cwd, args, "med");
}

function buildWorkBigState(cwd, args = "") {
	return buildPlanningStartState(cwd, args, "big");
}

function normalizePathToken(value) {
	return String(value ?? "").replace(/^@(?=[^\s@]*[\\/.])/, "");
}

function looksLikePath(value) {
	return /[\\/]|\.(?:md|html|txt|json|csv)$/i.test(normalizePathToken(value));
}

function artifactTitle(cwd, rel) {
	const text = readFileSync(join(cwd, rel), "utf8");
	return (
		text.match(/^title:\s*["']?([^"'\r\n]+)["']?/m)?.[1] ??
		text.match(/^#\s+(.+)$/m)?.[1] ??
		rel.split(/[\\/]/).pop()
	).trim();
}

function stripFrontmatter(text) {
	return text.replace(/^---[\s\S]*?---\s*/, "").trim();
}

function markdownSection(text, pattern) {
	const lines = text.split(/\r?\n/);
	const start = lines.findIndex(
		(line) => /^#{1,4}\s+/.test(line) && pattern.test(line),
	);
	if (start === -1) return "";
	const level = lines[start].match(/^(#+)/)?.[1].length ?? 1;
	const end = lines.findIndex(
		(line, index) =>
			index > start &&
			/^#{1,4}\s+/.test(line) &&
			(line.match(/^(#+)/)?.[1].length ?? 9) <= level,
	);
	return lines
		.slice(start, end === -1 ? undefined : end)
		.join("\n")
		.trim();
}

function artifactIdeaId(text) {
	return String(text ?? "").match(
		/\bidea[-_ ]?id\s*[:=]\s*([A-Za-z0-9._-]+)/i,
	)?.[1];
}

function extractRepoArtifactRefs(text) {
	return [
		...String(text).matchAll(
			/docs[\\/](?:brainstorms|plans)[\\/][^\s)'"<>]+/gi,
		),
	]
		.map((match) => normalizedRepoPath(match[0].replace(/[.,;:`\]]+$/, "")))
		.filter((item, index, items) => items.indexOf(item) === index);
}

const SOURCE_ALIGNMENT_STOPWORDS = new Set(
	"about after again against all also and any are because been before being between both but can cannot could did does done each either every for from has have into its itself just more must not now only other our out over plan project should than that the their them then there these they this through until use using was were when where which while with without would".split(
		/\s+/,
	),
);

function sourceSignalLines(text) {
	return String(text)
		.split(/\r?\n/)
		.map((line) => line.replace(/^\s*(?:[-*+]|\d+\.)\s*/, "").trim())
		.filter(
			(line) =>
				line.length >= 12 &&
				/(must|must not|should|do not|don't|never|require|required|acceptance|constraint|non-goal|reference|example|match|approval|proof|screenshot|parity|gate|block|no\s+\w+)/i.test(
					line,
				),
		)
		.slice(0, 40);
}

function sourceLineTokens(line) {
	return (
		String(line)
			.toLowerCase()
			.match(/[a-z0-9][a-z0-9_-]{2,}/g)
			?.filter((token) => !SOURCE_ALIGNMENT_STOPWORDS.has(token))
			.slice(0, 8) ?? []
	);
}

function planSourceAlignmentReport(cwd, rel) {
	const planText = readFileSync(join(cwd, rel), "utf8");
	const planLower = planText.toLowerCase();
	const sources = extractRepoArtifactRefs(planText).filter((path) =>
		/docs[\\/]brainstorms[\\/]/i.test(path),
	);
	const missingSources = sources.filter(
		(source) => !existsSync(join(cwd, source)),
	);
	const missingSignals = [];
	let signalCount = 0;
	for (const source of sources.filter(
		(item) => !missingSources.includes(item),
	)) {
		for (const line of sourceSignalLines(
			readFileSync(join(cwd, source), "utf8"),
		)) {
			const tokens = sourceLineTokens(line);
			if (tokens.length === 0) continue;
			signalCount += 1;
			const hits = tokens.filter((token) => planLower.includes(token)).length;
			if (hits < Math.min(2, tokens.length))
				missingSignals.push({ source, line });
		}
	}
	// ponytail: heuristic gate; replace with semantic trace scoring if false positives matter.
	return {
		sources,
		missingSources,
		signalCount,
		missingSignals: missingSignals.slice(0, 8),
		ok:
			missingSources.length === 0 &&
			(signalCount === 0 || missingSignals.length / signalCount <= 0.4),
	};
}

function planEpicFields(cwd, rel) {
	const text = readFileSync(join(cwd, rel), "utf8");
	const body = stripFrontmatter(text);
	const summary =
		markdownSection(body, /summary|overview|context|goal|requirements/i) ||
		body;
	const acceptance = markdownSection(
		body,
		/acceptance|verification|done criteria|test plan/i,
	);
	const ideaId = artifactIdeaId(text);
	const sourceArtifacts = extractRepoArtifactRefs(text).filter(
		(path) => path !== rel,
	);
	return {
		title: artifactTitle(cwd, rel),
		description: `Master roadmap plan from ${rel}.\n\n${summary.slice(0, 6000)}`,
		designFile: rel,
		acceptance:
			acceptance.slice(0, 6000) ||
			"Follow the master roadmap plan plus project verification instructions.",
		notes: [
			"created by /work-plan",
			`source plan: ${rel}`,
			...sourceArtifacts.map((path) => `source artifact: ${path}`),
			...sourceArtifacts
				.filter((path) => /docs[\\/]brainstorms[\\/]/i.test(path))
				.map((path) => `source brainstorm: ${path}`),
			ideaId ? `idea-id=${ideaId}` : "",
		]
			.filter(Boolean)
			.join("\n"),
		ideaId,
	};
}

const IDEA_ACTIONS = new Set([
	"accept",
	"reject",
	"discuss",
	"inspect",
	"import",
]);
const BRAINSTORM_ACTIONS = new Set(["link", "inspect"]);
const IDEA_STATUS_ORDER = [
	"conflicted",
	"reopened",
	"in_progress",
	"complete",
	"planned",
	"brainstormed",
	"discussed",
	"accepted",
	"contender",
	"raw",
	"rejected",
];

function workIdeateDir(cwd) {
	return join(cwd, CONFIG_DIR_NAME, "work-ideate");
}

function workIdeateSnapshotPath(cwd) {
	return join(workIdeateDir(cwd), "dashboard.json");
}

function titleFingerprint(issue) {
	return titleOf(issue).trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizedIdeaTitle(value) {
	return String(value ?? "")
		.trim()
		.toLowerCase()
		.replace(/\s+/g, " ");
}

function repoRelativePath(cwd, value) {
	const absolute = resolve(cwd, normalizePathToken(value));
	const rel = relative(cwd, absolute);
	if (!rel || rel.startsWith("..") || isAbsolute(rel)) return "";
	return normalizedRepoPath(rel);
}

function ideaActionHint(status) {
	return (
		{
			raw: "accept, discuss, reject, inspect",
			accepted: "discuss, reject, inspect",
			contender: "accept, discuss, reject, inspect",
			discussed: "brainstorm, reject, inspect",
			brainstormed: "plan or inspect; reject is blocked",
			planned: "resume linked work or inspect",
			in_progress: "resume linked work or inspect",
			complete: "inspect; reopen via child change",
			reopened: "resume linked work or inspect",
			rejected: "accept or inspect",
			conflicted: "resolve downstream work before rejecting",
		}[status] ?? "inspect"
	);
}

function ideaSourcePath(issue) {
	return metadataValue(
		ideaMetadata(issue),
		"sourcePath",
		"sourceArtifact",
		"source",
	);
}

function ideaRecords(cwd, epicId) {
	return childrenOfRequired(cwd, epicId).filter(isIdeaIssue);
}

function ideaSummaries(cwd, epicId) {
	return ideaRecords(cwd, epicId)
		.map((issue) => ({
			...issueSummary(issue),
			fingerprint: titleFingerprint(issue),
			sourcePath: ideaSourcePath(issue),
			actionHint: ideaActionHint(deriveIdeaStatus(issue)),
		}))
		.sort(
			(a, b) =>
				IDEA_STATUS_ORDER.indexOf(a.ideaStatus) -
					IDEA_STATUS_ORDER.indexOf(b.ideaStatus) ||
				String(a.updated).localeCompare(String(b.updated)) ||
				String(a.id).localeCompare(String(b.id)),
		);
}

function writeIdeaSnapshot(cwd, state) {
	mkdirSync(workIdeateDir(cwd), { recursive: true });
	writeFileSync(
		workIdeateSnapshotPath(cwd),
		`${JSON.stringify(
			{
				viewId: state.viewId,
				generatedAt: new Date().toISOString(),
				epicId: state.epic.id,
				filter: state.filter,
				items: state.ideas.map((idea, index) => ({
					index: index + 1,
					id: idea.id,
					fingerprint: idea.fingerprint,
					status: idea.ideaStatus,
					updated: idea.updated,
				})),
			},
			null,
			"\t",
		)}\n`,
	);
}

function readIdeaSnapshot(cwd) {
	try {
		return JSON.parse(readFileSync(workIdeateSnapshotPath(cwd), "utf8"));
	} catch {
		return undefined;
	}
}

function parseWorkIdeateArgs(args = "") {
	const input = String(args).trim();
	if (!input) return { kind: "dashboard" };
	const parts = input.split(/\s+/);
	const action = parts.at(-1);
	if (IDEA_ACTIONS.has(action))
		return { kind: "action", action, target: parts.slice(0, -1).join(" ") };
	return { kind: "topic", topic: input };
}

function resolveIdeaTarget(cwd, epicId, target) {
	const ideas = ideaSummaries(cwd, epicId);
	const text = String(target ?? "").trim();
	if (!text)
		return { error: "missing-target", message: "Missing idea target." };
	if (/^\d+$/.test(text)) {
		const snapshot = readIdeaSnapshot(cwd);
		const entry = snapshot?.items?.[Number(text) - 1];
		if (!entry)
			return {
				error: "stale-index",
				message:
					"Numeric idea index is missing or stale; run /work-ideate again.",
			};
		const idea = ideas.find((item) => item.id === entry.id);
		if (
			!idea ||
			idea.fingerprint !== entry.fingerprint ||
			idea.ideaStatus !== entry.status ||
			idea.updated !== entry.updated
		)
			return {
				error: "stale-index",
				message:
					"Numeric idea index no longer matches the dashboard; run /work-ideate again.",
			};
		return { idea };
	}
	const byId = ideas.find((item) => item.id === text);
	if (byId) return { idea: byId };
	const title = normalizedIdeaTitle(text);
	const matches = ideas.filter(
		(item) => normalizedIdeaTitle(item.title) === title,
	);
	if (matches.length === 1) return { idea: matches[0] };
	if (matches.length > 1)
		return {
			error: "ambiguous-target",
			message: `Multiple ideas match ${text}; use a Bead ID.`,
			candidates: matches,
		};
	return { error: "unknown-target", message: `No idea found for ${text}.` };
}

function appendIdeaStatus(cwd, id, status, action) {
	return appendBeadNote(
		cwd,
		id,
		`wo:idea status=${status} action=${action} updated-at=${new Date().toISOString()}`,
	);
}

function importIdea(cwd, epic, target) {
	const rel = repoRelativePath(cwd, target);
	if (!rel || !looksLikePath(rel) || !existsSync(join(cwd, rel)))
		return errorState(
			"missing-source",
			`Import source not found in repo: ${target}`,
			{
				action: "missing-source",
			},
		);
	const ideas = ideaRecords(cwd, idOf(epic));
	const existing = ideas.find((idea) => ideaSourcePath(idea) === rel);
	const title = artifactTitle(cwd, rel);
	const note = `wo:idea status=accepted source-path=${rel} imported-at=${new Date().toISOString()}`;
	const bead = existing
		? appendBeadNote(cwd, idOf(existing), note)
		: createBead(cwd, {
				title,
				type: "task",
				parent: idOf(epic),
				description: `Idea imported from ${rel}.`,
				notes: `wo:idea schema=${IDEA_SCHEMA_VERSION} status=accepted source-path=${rel}`,
			});
	return {
		ok: true,
		action: existing ? "import-updated" : "import-created",
		epic: issueSummary(epic),
		idea: issueSummary(bead),
		message: `${existing ? "Updated" : "Created"} idea ${idOf(bead)} from ${rel}.`,
		suggestedCommands: [`/work-ideate ${idOf(bead)} inspect`],
	};
}

function textHash(value) {
	let hash = 0;
	for (const char of String(value)) hash = (hash * 31 + char.charCodeAt(0)) | 0;
	return Math.abs(hash).toString(36);
}

function jsonPayload(text) {
	const input = String(text ?? "").trim();
	const fenced = input.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
	for (const candidate of [fenced, input].filter(Boolean)) {
		try {
			return JSON.parse(candidate);
		} catch {
			const start = candidate.search(/[[{]/);
			const end = Math.max(
				candidate.lastIndexOf("}"),
				candidate.lastIndexOf("]"),
			);
			if (start !== -1 && end > start) {
				try {
					return JSON.parse(candidate.slice(start, end + 1));
				} catch {
					// Try the next candidate.
				}
			}
		}
	}
	return undefined;
}

function parseIdeationIdeas(output) {
	// ponytail: JSON-only capture; add markdown parsing only if CE output drifts.
	const payload = jsonPayload(output);
	const ideas = Array.isArray(payload) ? payload : asArray(payload?.ideas);
	const topPicks = new Set(asArray(payload?.topPicks ?? payload?.top_picks));
	return ideas
		.map((item, index) => {
			const title = String(
				typeof item === "string" ? item : field(item, "title", "name", "idea"),
			).trim();
			if (!title) return undefined;
			const rank = Number(field(item, "rank", "index") ?? index + 1);
			const status = normalizeIdeaStatus(field(item, "status", "state"));
			const accepted =
				status === "accepted" ||
				field(item, "topPick", "top_pick", "accepted") === true ||
				topPicks.has(rank) ||
				topPicks.has(index + 1) ||
				topPicks.has(title);
			return {
				index: index + 1,
				title,
				summary: String(field(item, "summary", "description", "why") ?? ""),
				status: accepted ? "accepted" : "contender",
				hash: textHash(title),
			};
		})
		.filter(Boolean);
}

function existingIdeaByRun(ideas, runId, idea) {
	return ideas.find((item) => {
		const metadata = ideaMetadata(item);
		return (
			metadata.sourceRunId === runId &&
			String(metadata.sourceIndex) === String(idea.index) &&
			metadata.titleHash === idea.hash
		);
	});
}

function captureIdeationIdeas(
	cwd,
	epic,
	{ topic, output, runId = telemetryId("ideate") },
) {
	const parsed = parseIdeationIdeas(output);
	if (!parsed.length) {
		const recovery = createBead(cwd, {
			title: `Recover ideation output: ${String(topic ?? "ideas").slice(0, 80)}`,
			type: "decision",
			parent: idOf(epic),
			description: `Raw ideation output could not be parsed.\n\n${String(output ?? "").slice(0, 6000)}`,
			notes: `wo:idea-recovery run-id=${runId}`,
		});
		return {
			ok: false,
			action: "capture-recovery",
			epic: issueSummary(epic),
			recovery: issueSummary(recovery),
			saved: [],
			unsaved: [],
			message: `Could not parse ideation output; created recovery Bead ${idOf(recovery)}.`,
		};
	}
	const saved = [];
	const unsaved = [];
	for (const idea of parsed) {
		try {
			const existing = existingIdeaByRun(
				ideaRecords(cwd, idOf(epic)),
				runId,
				idea,
			);
			const note = `wo:idea schema=${IDEA_SCHEMA_VERSION} status=${idea.status} source-run-id=${runId} source-index=${idea.index} title-hash=${idea.hash}`;
			const bead = existing
				? appendBeadNote(cwd, idOf(existing), note)
				: createBead(cwd, {
						title: idea.title,
						type: "task",
						parent: idOf(epic),
						description: idea.summary || `Idea from /work-ideate ${topic}.`,
						notes: note,
					});
			saved.push(issueSummary(bead));
		} catch (error) {
			unsaved.push({ title: idea.title, error: commandErrorText(error) });
		}
	}
	return {
		ok: unsaved.length === 0,
		action: unsaved.length ? "capture-partial" : "capture-complete",
		epic: issueSummary(epic),
		runId,
		saved,
		unsaved,
		message: unsaved.length
			? `Saved ${saved.length}/${parsed.length} ideas; rerun with run ${runId} to recover the rest.`
			: `Saved ${saved.length} ideas from /work-ideate.`,
	};
}

function ideationHandoffPrompt(epic, topic, runId) {
	return [
		"Use the work-orchestrator skill in mode: ideate with this precomputed extension state.",
		`Epic: ${idOf(epic)} — ${titleOf(epic)}`,
		`Topic: ${topic}`,
		`Run ID: ${runId}`,
		`Structured capture contract: ${captureIdeationIdeas.name} expects JSON ideas[] plus optional topPicks.`,
		"Generate roughly 20 ideas, mark about 7 top picks as accepted, the rest as contenders, then create Beads under the epic with wo:idea notes and source-run/source-index metadata.",
		"If structured capture fails, preserve the raw output in a recovery decision Bead and report saved vs unsaved ideas.",
		ROLE_TIMEOUT_GUIDANCE,
	].join("\n");
}

function parseWorkBrainstormArgs(args = "") {
	const input = String(args).trim();
	if (!input) return { kind: "usage" };
	const parts = input.split(/\s+/);
	const action = BRAINSTORM_ACTIONS.has(parts.at(-1)) ? parts.pop() : "link";
	if (parts[0] === "idea") {
		const artifact =
			parts.length > 2 && looksLikePath(parts.at(-1)) ? parts.pop() : "";
		return { kind: "idea", action, target: parts.slice(1).join(" "), artifact };
	}
	const artifact =
		parts.length > 1 && looksLikePath(parts.at(-1)) ? parts.pop() : "";
	return { kind: "topic", action, topic: parts.join(" "), artifact };
}

function compactBrainstormTitle(topic, max = BRAINSTORM_TITLE_MAX) {
	const text = String(topic ?? "")
		.replace(/\s+/g, " ")
		.trim();
	if (!text) return "Brainstorm idea";
	if (text.length <= max) return text;
	const suffix = `… [${textHash(text)}]`;
	return `${text.slice(0, max - suffix.length).trimEnd()}${suffix}`;
}

function brainstormEpicTitle(topic) {
	return `Brainstorm: ${compactBrainstormTitle(topic, 80)}`;
}

function createBrainstormEpic(cwd, topic) {
	const epic = createBead(cwd, {
		title: brainstormEpicTitle(topic),
		type: "epic",
		description: `Brainstorm workspace created by /work-brainstorm for: ${topic}`,
		notes: workflowBeadNotes("/work-brainstorm", topic, [
			"wo:brainstorm",
			"auto-created for standalone brainstorm",
		]),
	});
	rememberWorkflowEpic(cwd, epic);
	return epic;
}

function ideaBrainstormNote(artifact = "", action = "brainstorm") {
	return [
		"wo:idea",
		"status=discussed",
		`action=${action}`,
		artifact ? `brainstorm-path=${artifact}` : "",
		`brainstormed-at=${new Date().toISOString()}`,
	]
		.filter(Boolean)
		.join(" ");
}

function possibleDuplicateIdeas(ideas, title) {
	const normalized = normalizedIdeaTitle(title);
	return ideas.filter((idea) => {
		const candidate = normalizedIdeaTitle(idea.title);
		return (
			candidate !== normalized &&
			(candidate.includes(normalized) || normalized.includes(candidate))
		);
	});
}

function createBrainstormIdea(cwd, epic, topic, artifact = "") {
	return createBead(cwd, {
		title: compactBrainstormTitle(topic),
		type: "task",
		parent: idOf(epic),
		description: [
			`Idea created by /work-brainstorm${artifact ? ` from ${artifact}` : ""}.`,
			"",
			"Full brainstorm request:",
			topic,
		].join("\n"),
		notes: [
			"wo:idea",
			`schema=${IDEA_SCHEMA_VERSION}`,
			"status=discussed",
			artifact ? `brainstorm-path=${artifact}` : "",
		]
			.filter(Boolean)
			.join(" "),
	});
}

function resolveFreeformIdea(cwd, epic, topic) {
	const ideas = ideaSummaries(cwd, idOf(epic));
	const normalized = normalizedIdeaTitle(topic);
	const compact = normalizedIdeaTitle(compactBrainstormTitle(topic));
	const exact = ideas.filter((idea) => {
		const candidate = normalizedIdeaTitle(idea.title);
		return candidate === normalized || candidate === compact;
	});
	if (exact.length === 1)
		return { idea: exact[0], reused: true, possibleDuplicates: [] };
	if (exact.length > 1)
		return {
			error: "ambiguous-target",
			message: `Multiple ideas match ${topic}; use /work-brainstorm idea <id>.`,
			candidates: exact,
		};
	return {
		idea: undefined,
		reused: false,
		possibleDuplicates: possibleDuplicateIdeas(ideas, topic),
	};
}

function buildWorkBrainstormState(cwd, args = "") {
	const parsed = parseWorkBrainstormArgs(args);
	if (parsed.kind === "usage")
		return errorState(
			"usage",
			"Usage: /work-brainstorm [idea <target>|<topic>] [brainstorm-path]",
			{ action: "usage" },
		);
	try {
		const init = ensureBeadsInitialized(cwd);
		const resolved = resolveWorkflowEpic(cwd, "");
		let createdEpic = false;
		let epic = resolved.epic;
		if (resolved.error) {
			if (resolved.error !== "no-active-epic" || parsed.kind !== "topic")
				return errorState(resolved.error, resolved.message ?? resolved.error, {
					action: "ask-target",
					candidates: resolved.candidates ?? [],
				});
			epic = createBrainstormEpic(cwd, parsed.topic);
			createdEpic = true;
		}
		const artifact = parsed.artifact
			? repoRelativePath(cwd, parsed.artifact)
			: "";
		if (parsed.artifact && (!artifact || !existsSync(join(cwd, artifact))))
			return errorState(
				"missing-source",
				`Brainstorm artifact not found in repo: ${parsed.artifact}`,
				{ action: "missing-source" },
			);
		if (parsed.kind === "idea") {
			const resolvedIdea = resolveIdeaTarget(cwd, idOf(epic), parsed.target);
			if (resolvedIdea.error)
				return errorState(resolvedIdea.error, resolvedIdea.message, {
					action: resolvedIdea.error,
					candidates: resolvedIdea.candidates ?? [],
				});
			const bead = appendBeadNote(
				cwd,
				resolvedIdea.idea.id,
				ideaBrainstormNote(artifact, "selected-brainstorm"),
			);
			return {
				ok: true,
				action: "brainstorm-linked",
				epic: issueSummary(epic),
				idea: issueSummary(bead),
				artifact,
				topic: parsed.topic,
				message: `Linked brainstorm${artifact ? ` ${artifact}` : ""} to ${resolvedIdea.idea.id}.`,
				suggestedCommands: artifact
					? [`/work-plan ${artifact}`]
					: [`/work-brainstorm idea ${resolvedIdea.idea.id} <brainstorm-path>`],
			};
		}
		const match = resolveFreeformIdea(cwd, epic, parsed.topic);
		if (match.error)
			return errorState(match.error, match.message, {
				action: match.error,
				candidates: match.candidates ?? [],
			});
		const bead = match.idea
			? appendBeadNote(
					cwd,
					match.idea.id,
					ideaBrainstormNote(artifact, "freeform-brainstorm"),
				)
			: createBrainstormIdea(cwd, epic, parsed.topic, artifact);
		return {
			ok: true,
			action: createdEpic
				? "brainstorm-epic-created"
				: match.reused
					? "brainstorm-reused"
					: "brainstorm-created",
			epic: issueSummary(epic),
			idea: issueSummary(bead),
			artifact,
			topic: parsed.topic,
			possibleDuplicates: match.possibleDuplicates,
			message: [
				init.initialized ? init.message : "",
				createdEpic ? `Created epic ${idOf(epic)}.` : "",
				`${match.reused ? "Updated" : "Created"} idea ${idOf(bead)} for brainstorm ${parsed.topic}.`,
			]
				.filter(Boolean)
				.join(" "),
			suggestedCommands: artifact
				? [`/work-plan ${artifact}`]
				: [`/work-brainstorm idea ${idOf(bead)} <brainstorm-path>`],
		};
	} catch (error) {
		return errorState(error.reason ?? "beads-error", error.message, {
			action: error.reason ?? "beads-error",
		});
	}
}

function brainstormHandoffPrompt(state) {
	const artifact = state.artifact;
	return [
		`Use the work-orchestrator skill in mode: ${artifact ? "master" : "brainstorm"} with this precomputed extension state.`,
		`Epic: ${state.epic.id} — ${state.epic.title}`,
		`Idea: ${state.idea.id} — ${state.idea.title}`,
		state.topic ? `Full brainstorm request:\n${state.topic}` : "",
		artifact
			? `Brainstorm artifact: ${artifact}\nRun /work-plan ${state.epic.id} now; do not use ce-brainstorm's post-doc planning menu.`
			: `Run ce-brainstorm interactively, ask one question at a time until the requirements are clear, write only the brainstorm artifact, skip ce-brainstorm's post-doc planning menu, then rerun /work-brainstorm idea ${state.idea.id} <path>.`,
		"/work-brainstorm owns the brainstorm→plan handoff so /work-plan can call ce-plan with the preservation and self-audit contract.",
		"Never silently skip ce-brainstorm questions for broad, important, or underspecified work.",
		"Use temporary high/xhigh thinking when uncertainty is high; do not change persistent defaults.",
		ROLE_TIMEOUT_GUIDANCE,
	].join("\n");
}

function renderWorkBrainstormText(state) {
	if (!state.ok)
		return [
			state.message ?? "Could not prepare brainstorm.",
			...(state.candidates ?? []).map(
				(item) =>
					`- ${item.id} ${item.ideaStatus ?? item.status} — ${item.title}`,
			),
		].join("\n");
	return [
		state.message,
		...(state.possibleDuplicates?.length
			? [
					"Possible duplicates:",
					...state.possibleDuplicates.map(
						(item) => `- ${item.id} — ${item.title}`,
					),
				]
			: []),
		state.suggestedCommands?.[0] ? `Next: ${state.suggestedCommands[0]}` : "",
	]
		.filter(Boolean)
		.join("\n");
}

function buildWorkIdeateState(cwd, args = "") {
	const parsed = parseWorkIdeateArgs(args);
	try {
		const resolved = resolveWorkflowEpic(cwd, "");
		if (resolved.error)
			return errorState(resolved.error, resolved.message ?? resolved.error, {
				action: "ask-target",
				candidates: resolved.candidates ?? [],
			});
		const epic = resolved.epic;
		if (parsed.kind === "topic") {
			const runId = telemetryId("ideate");
			return {
				ok: true,
				action: "handoff-ideate",
				epic: issueSummary(epic),
				topic: parsed.topic,
				runId,
				message: `Starting ideation capture for ${parsed.topic}.`,
				handoffPrompt: ideationHandoffPrompt(epic, parsed.topic, runId),
				suggestedCommands: [`/work-ideate ${runId}`],
			};
		}
		if (parsed.kind === "dashboard") {
			const state = {
				ok: true,
				action: "dashboard",
				epic: issueSummary(epic),
				filter: "all",
				viewId: telemetryId("ideas"),
				ideas: ideaSummaries(cwd, idOf(epic)),
			};
			writeIdeaSnapshot(cwd, state);
			return state;
		}
		if (parsed.action === "import") return importIdea(cwd, epic, parsed.target);
		const resolvedIdea = resolveIdeaTarget(cwd, idOf(epic), parsed.target);
		if (resolvedIdea.error)
			return errorState(resolvedIdea.error, resolvedIdea.message, {
				action: resolvedIdea.error,
				candidates: resolvedIdea.candidates ?? [],
			});
		const idea = resolvedIdea.idea;
		const status = idea.ideaStatus;
		if (parsed.action === "inspect")
			return {
				ok: true,
				action: "inspect",
				epic: issueSummary(epic),
				idea,
				message: `${idea.id} ${status} — ${idea.title}`,
				suggestedCommands: [`/work-ideate ${idea.id} discuss`],
			};
		if (parsed.action === "reject") {
			if (!["raw", "accepted", "contender", "discussed"].includes(status))
				return errorState(
					"reject-refused",
					`${idea.id} is ${status}; use abandon/defer/conflict resolution instead of direct reject.`,
					{ action: "reject-refused", idea },
				);
			const bead = appendIdeaStatus(cwd, idea.id, "rejected", "reject");
			return {
				ok: true,
				action: "rejected",
				epic: issueSummary(epic),
				idea: issueSummary(bead),
				message: `Rejected ${idea.id}; it remains inspectable and resume-ineligible.`,
				suggestedCommands: [`/work-ideate ${idea.id} inspect`],
			};
		}
		if (parsed.action === "accept") {
			const bead = appendIdeaStatus(cwd, idea.id, "accepted", "accept");
			return {
				ok: true,
				action: "accepted",
				epic: issueSummary(epic),
				idea: issueSummary(bead),
				message: `Accepted ${idea.id}.`,
				suggestedCommands: [`/work-ideate ${idea.id} discuss`],
			};
		}
		if (parsed.action === "discuss") {
			const bead = appendIdeaStatus(cwd, idea.id, "discussed", "discuss");
			return {
				ok: true,
				action: "discussed",
				epic: issueSummary(epic),
				idea: issueSummary(bead),
				message: `Marked ${idea.id} as discussed; next use /work-brainstorm idea ${idea.id}.`,
				suggestedCommands: [`/work-brainstorm idea ${idea.id}`],
			};
		}
		return errorState(
			"unsupported-action",
			`Unsupported action: ${parsed.action}`,
			{
				action: "unsupported-action",
			},
		);
	} catch (error) {
		return errorState(error.reason ?? "beads-error", error.message, {
			action: error.reason ?? "beads-error",
		});
	}
}

function renderWorkIdeateText(state) {
	if (!state.ok) {
		return [
			state.message ?? "Could not build idea dashboard.",
			...(state.candidates ?? []).map(
				(item) =>
					`- ${item.id} ${item.status ?? item.ideaStatus} — ${item.title}`,
			),
		].join("\n");
	}
	if (state.action !== "dashboard") {
		return [
			state.message,
			state.suggestedCommands?.[0] ? `Next: ${state.suggestedCommands[0]}` : "",
		]
			.filter(Boolean)
			.join("\n");
	}
	const lines = [`Ideas for ${state.epic.title} (${state.epic.id})`];
	if (state.ideas.length === 0)
		return [...lines, "No ideas yet.", "Next: /work-ideate <topic>"].join("\n");
	for (const status of IDEA_STATUS_ORDER) {
		const group = state.ideas.filter((idea) => idea.ideaStatus === status);
		if (!group.length) continue;
		lines.push("", `${status}:`);
		for (const idea of group) {
			const index = state.ideas.indexOf(idea) + 1;
			lines.push(`${index}. ${idea.id} — ${idea.title} (${idea.actionHint})`);
		}
	}
	return lines.join("\n");
}

function buildWorkInitState(cwd, _args = "") {
	try {
		const init = ensureBeadsInitialized(cwd);
		return {
			ok: true,
			action: init.initialized ? "initialized" : "already-initialized",
			message: init.message,
			suggestedCommands: ["/work-plan <idea-or-plan-file>"],
			nextAction: "Next: /work-plan <idea-or-plan-file>",
		};
	} catch (error) {
		const reason = error.reason ?? "beads-error";
		return errorState(reason, error.message, {
			action: reason,
			suggestedCommands:
				reason === "bd-missing"
					? ["npm install -g @beads/bd", "bd --help"]
					: ["bd --help"],
		});
	}
}

function notePaths(issue, names) {
	const text = notesOf(issue);
	return names.flatMap((name) => {
		const pattern = new RegExp(`${name}[:=]\\s*([^\\s]+)`, "gi");
		return [...text.matchAll(pattern)].map((match) => match[1]);
	});
}

function issueArtifactPaths(cwd, issue, kind) {
	const direct = asArray(
		field(issue, "design_file", "designFile", "source", "sourcePath"),
	);
	const noted =
		kind === "plan"
			? notePaths(issue, ["source plan", "plan-path", "plan"])
			: notePaths(issue, [
					"brainstorm-path",
					"source brainstorm",
					"brainstorm",
				]);
	return [...direct, ...noted]
		.map((item) => repoRelativePath(cwd, item))
		.filter((item) =>
			kind === "plan"
				? /docs[\\/]plans[\\/].+\.(?:md|html)$/i.test(item)
				: /docs[\\/]brainstorms[\\/].+\.(?:md|html)$/i.test(item),
		)
		.filter((item, index, items) => items.indexOf(item) === index);
}

function epicArtifacts(cwd, epic) {
	let children = [];
	try {
		children = childrenOfRequired(cwd, idOf(epic));
	} catch {
		children = [];
	}
	return {
		plans: [epic, ...children].flatMap((issue) =>
			issueArtifactPaths(cwd, issue, "plan"),
		),
		brainstorms: [epic, ...children].flatMap((issue) =>
			issueArtifactPaths(cwd, issue, "brainstorm"),
		),
	};
}

function splitPlanTarget(input) {
	const [target, rest] = splitFirstWord(input);
	const [mode, tail] = splitFirstWord(rest);
	return { target, mode, tail };
}

function buildWorkPlanLikeState(cwd, args = "", command = "/work-plan") {
	const input = String(args).trim();
	if (!input)
		return errorState("usage", `Usage: ${command} <idea-or-plan-file>`, {
			action: "usage",
		});
	try {
		const first = normalizePathToken(input.split(/\s+/)[0]);
		const pathExists = existsSync(join(cwd, first));
		if (!pathExists && looksLikePath(first))
			return errorState("missing-source", `Source path not found: ${first}`, {
				action: "missing-source",
			});
		const init = ensureBeadsInitialized(cwd);
		const masterGit = resumeGitReport(cwd);
		const sourceArtifacts = extractRepoArtifactRefs(input);
		const handoffPlan = (message, detail, extra = {}) => ({
			ok: true,
			action: "handoff-plan",
			message: `${init.initialized ? `${init.message} ` : ""}${message}`,
			...extra,
			handoffPrompt: [
				"Use ce-plan to convert this input into a detailed master roadmap plan, then run /work-plan with the produced plan path.",
				sourceArtifacts.length
					? `Source artifacts to read and cite verbatim in the final plan: ${sourceArtifacts.join(", ")}`
					: "",
				"When the source is not already a plan file, write a new plan artifact; do not reuse or lightly update an older weaker plan unless the user explicitly asks.",
				"Preserve every decided requirement, constraint, non-goal, reference, acceptance example, and open question from the source; the implementor must not need to guess.",
				"Trace each source decision into exactly one place: plan requirement, implementation unit, verification/acceptance proof, explicit open question, or intentionally dropped-with-rationale note.",
				"For any authoritative reference or target behavior, create an Acceptance Contract: source, must-match traits/invariants, must-not regressions, proof artifacts/checks, and who/what can approve it. This is generic: UI visual parity, API compatibility, CLI behavior, C++ ABI/performance/thread-safety, data migration invariants, security posture, hardware behavior, etc.",
				"After the first plan draft, self-audit it. Any material uncertainty, subjective acceptance, weak proof, missing asset/input, or P0/P1 doc-review finding must become a plan fix, a blocking question, a decision/blocker Bead instruction, or an explicit user waiver; never leave it as passive risk prose.",
				"Repeat that hardening loop — update the plan, re-check unresolved uncertainties, and ask the user only for decisions that cannot be inferred — until no blocking uncertainty remains. Only then return the plan path and run /work-plan <plan-path>.",
				"Ask ce-plan clarification questions one at a time when the input is broad, important, or underspecified; auto-accept only skips the final write-confirmation, not discovery questions.",
				detail,
				`Git dirty classification: ${gitDirtyClassification(masterGit)}`,
				ROLE_TIMEOUT_GUIDANCE,
			].join("\n"),
			git: masterGit,
			warnings: masterGit.warnings,
			suggestedCommands: ["/work-plan <path-to-created-plan>"],
			nextAction:
				"Next: after ce-plan writes the roadmap, run /work-plan <plan-path>.",
		});
		const planTarget = splitPlanTarget(input);
		const targetLooksEpic =
			["current", "last"].includes(planTarget.target) ||
			isBeadId(planTarget.target) ||
			isNumericBeadShorthand(planTarget.target);
		if (targetLooksEpic) {
			const resolved = resolveWorkflowEpic(cwd, planTarget.target);
			if (resolved.error)
				return errorState(resolved.error, resolved.message ?? resolved.error, {
					action: resolved.error,
					candidates: resolved.candidates ?? [],
				});
			const artifacts = epicArtifacts(cwd, resolved.epic);
			const brainstorm = artifacts.brainstorms[0];
			const plan = artifacts.plans[0];
			const mode = planTarget.mode || (plan ? "" : "new");
			if (plan && !mode)
				return {
					ok: true,
					action: "plan-epic-has-plan",
					epic: issueSummary(resolved.epic),
					message: `Epic already has plan ${plan}. Choose how to use it.`,
					suggestedCommands: [
						`${command} ${idOf(resolved.epic)} strengthen`,
						brainstorm ? `${command} ${idOf(resolved.epic)} fork` : "",
						`${command} ${plan}`,
					].filter(Boolean),
					nextAction: `Next: ${command} ${idOf(resolved.epic)} fork to create a new roadmap from the brainstorm, or ${command} ${idOf(resolved.epic)} strengthen to harden the existing plan.`,
				};
			if (["fork", "new", "replace"].includes(mode)) {
				if (!brainstorm)
					return errorState(
						"missing-source",
						`Epic ${idOf(resolved.epic)} has no linked brainstorm artifact.`,
						{ action: "missing-source", epic: issueSummary(resolved.epic) },
					);
				return handoffPlan(
					`Brainstorm from epic ${idOf(resolved.epic)} handed to ce-plan.`,
					[
						`Source epic: ${idOf(resolved.epic)} — ${titleOf(resolved.epic)}`,
						`Source brainstorm: ${brainstorm}`,
						plan && mode === "replace"
							? `Ignore weaker existing plan: ${plan}`
							: "",
						"Create a new hardened plan artifact from the brainstorm, then run /work-plan <plan-path> to create a new active roadmap epic.",
					]
						.filter(Boolean)
						.join("\n"),
					{ epic: issueSummary(resolved.epic) },
				);
			}
			if (mode === "strengthen") {
				if (!plan)
					return errorState(
						"missing-source",
						`Epic ${idOf(resolved.epic)} has no linked plan artifact to strengthen.`,
						{ action: "missing-source", epic: issueSummary(resolved.epic) },
					);
				return handoffPlan(
					`Existing plan from epic ${idOf(resolved.epic)} handed to ce-plan for hardening.`,
					[
						`Source epic: ${idOf(resolved.epic)} — ${titleOf(resolved.epic)}`,
						brainstorm
							? `Source brainstorm: ${brainstorm}`
							: "Source brainstorm: none linked",
						`Existing plan: ${plan}`,
						"Strengthen the existing plan in place using the brainstorm when available; if the user asks for a new roadmap instead, switch to fork mode.",
					]
						.filter(Boolean)
						.join("\n"),
					{ epic: issueSummary(resolved.epic) },
				);
			}
			return errorState(
				"usage",
				`Usage: ${command} ${idOf(resolved.epic)} [strengthen|fork|replace]`,
				{ action: "usage", epic: issueSummary(resolved.epic) },
			);
		}
		if (!pathExists)
			return handoffPlan(
				"Raw idea handed to ce-plan before epic creation.",
				`Task: ${input}`,
			);
		if (!/docs[\\/]plans[\\/].+\.(?:md|html)$/i.test(first))
			return handoffPlan(
				"Source artifact needs ce-plan before epic creation.",
				`Source: ${first}`,
			);
		if (!safeForPlanBootstrap(cwd, masterGit, first))
			return planBootstrapDirtyStop(cwd, masterGit, first, command);
		const alignment = planSourceAlignmentReport(cwd, first);
		if (!alignment.ok)
			return errorState(
				"source-alignment-stop",
				`Plan does not sufficiently trace linked brainstorm source artifacts: ${alignment.missingSources.length} missing source file(s), ${alignment.missingSignals.length}/${alignment.signalCount} source signal(s) not found in the plan.`,
				{
					action: "source-alignment-stop",
					alignment,
					suggestedCommands: [`${command} ${first}`],
				},
			);
		const fields = planEpicFields(cwd, first);
		const epic = createBead(cwd, {
			title: fields.title,
			type: "epic",
			description: fields.description,
			designFile: fields.designFile,
			acceptance: fields.acceptance,
			notes: fields.notes,
		});
		rememberWorkflowEpic(cwd, epic);
		const planning = createBead(cwd, {
			title: `Plan next slice for ${fields.title}`,
			type: "task",
			parent: idOf(epic),
			notes: workflowBeadNotes(command, fields.title, [
				"wo:planning",
				`source plan: ${first}`,
				fields.ideaId ? `idea-id=${fields.ideaId}` : "",
				"create one executable slice by default",
			]),
		});
		if (fields.ideaId)
			appendBeadNote(
				cwd,
				fields.ideaId,
				`wo:idea status=discussed plan-path=${first} epic-id=${idOf(epic)} task-id=${idOf(planning)}`,
			);
		return withHandoffPrompt({
			ok: true,
			action: "run-planner",
			epic: issueSummary(epic),
			selectedBead: issueSummary(planning),
			git: masterGit,
			message: `${init.initialized ? `${init.message} ` : ""}Created epic ${idOf(epic)} and planning Bead ${idOf(planning)}.`,
			warnings: masterGit.warnings,
			suggestedCommands: [`/work-resume ${idOf(epic)}`],
			nextAction: `Next: planner will create the first slice; then run /work-resume ${idOf(epic)}.`,
		});
	} catch (error) {
		return errorState(error.reason ?? "beads-error", error.message, {
			action: error.reason ?? "beads-error",
		});
	}
}

function buildWorkPlanState(cwd, args = "") {
	return buildWorkPlanLikeState(cwd, args, "/work-plan");
}

function buildWorkMasterState(cwd, args = "") {
	return buildWorkPlanLikeState(cwd, args, "/work-master");
}

function parseMigrateSources(cwd, input) {
	const files = [];
	const branches = [];
	const text = [];
	const missing = [];
	for (const raw of input.split(/\s+/).filter(Boolean)) {
		const token = normalizePathToken(raw);
		if (existsSync(join(cwd, token))) files.push(token);
		else if (/\.(?:md|html|txt|json|csv)$/i.test(token)) missing.push(token);
		else if (/^[\w.-]+\/[\w./-]+$/.test(token)) branches.push(token);
		else text.push(raw);
	}
	return { files, branches, text: text.join(" "), missing };
}

function buildWorkMigrateState(cwd, args = "") {
	const input = String(args).trim();
	if (!input)
		return errorState("usage", "Usage: /work-migrate <sources>", {
			action: "usage",
		});
	try {
		const sources = parseMigrateSources(cwd, input);
		if (sources.missing.length)
			return errorState(
				"missing-source",
				`Source path not found: ${sources.missing.join(", ")}`,
				{ action: "missing-source", sources },
			);
		const git = resumeGitReport(cwd);
		return {
			ok: true,
			action: "handoff-migrate",
			git,
			sources,
			message: "Migration sources normalized for bead-migrator.",
			handoffPrompt: [
				"Use the work-orchestrator skill in mode: migrate with this precomputed extension state.",
				`Files: ${sources.files.length ? sources.files.join(", ") : "none"}`,
				`Branches: ${sources.branches.length ? sources.branches.join(", ") : "none"}`,
				`Description: ${sources.text || "none"}`,
				"Migration is read-only for source and git: do not checkout, merge, rebase, edit source files, stage, or commit.",
				ROLE_TIMEOUT_GUIDANCE,
			].join("\n"),
			warnings: git.warnings,
		};
	} catch (error) {
		return errorState(error.reason ?? "beads-error", error.message, {
			action: error.reason ?? "beads-error",
		});
	}
}

function hasReviewPass(issue) {
	return /\bPASS\b|review(?: result)?:\s*pass/i.test(notesOf(issue));
}

function hasVerificationEvidence(issue) {
	return /verified|verification|tests? pass|npm run|pytest|ctest|ok -/i.test(
		notesOf(issue),
	);
}

function buildWorkFinishState(cwd, args = "") {
	let target = String(args).trim();
	if (!target)
		return errorState("usage", "Usage: /work-finish <bead-id|epic-id>", {
			action: "usage",
		});
	try {
		const expanded = expandNumericBeadShorthand(cwd, target);
		if (expanded.error)
			return errorState(expanded.error, expanded.message, expanded);
		target = expanded.target;
		const issue = one(bdJsonRequired(cwd, ["show", target]));
		if (!issue)
			return errorState("unknown-target", `No Bead found for ${target}`);
		let bead = issue;
		let epic = issue;
		if (typeOf(issue) === "epic") {
			const childState = buildEpicChildState(cwd, issue);
			bead = childState.inProgress[0] ?? childState.readyWork[0];
			if (!bead)
				return errorState(
					"no-selected-bead",
					"No child Bead is ready for finish gate.",
					{
						epic: issueSummary(issue),
						action: "finish-stop",
					},
				);
		} else {
			epic = one(bdJsonRequired(cwd, ["show", parentOf(issue)]));
		}
		const git = resumeGitReport(cwd);
		const stop = (reason, message, extra = {}) =>
			errorState(reason, message, {
				action: "finish-stop",
				epic: issueSummary(epic),
				selectedBead: issueSummary(bead),
				git,
				...extra,
			});
		const raw = notesOf(bead);
		const dirty = git.dirtyPaths ?? [];
		const related = dirty.filter(
			(file) => raw.includes(file) || raw.includes(file.split(/[\\/]/).pop()),
		);
		if (isBlockedIssue(bead) || debugNeededId(bead))
			return stop("blocked", "Selected Bead is blocked/debug-needed.");
		if (!hasReviewPass(bead))
			return stop("missing-review", "PASS review evidence is missing.");
		if (!hasVerificationEvidence(bead))
			return stop("missing-verification", "Verification evidence is missing.");
		if (!dirty.length)
			return stop(
				"no-related-dirty-files",
				"No related dirty files to commit.",
			);
		if (related.length !== dirty.length)
			return stop(
				"unrelated-dirty-files",
				"Dirty files are not all tied to the selected Bead notes.",
				{ relatedFiles: related },
			);
		return {
			ok: true,
			action: "commit-ready",
			epic: issueSummary(epic),
			selectedBead: issueSummary(bead),
			git,
			relatedFiles: related,
			commitMessage: `${idOf(bead)}: ${titleOf(bead)}`,
			message: "Finish gate has review, verification, and related dirty files.",
			note: `Commit seed: ${idOf(bead)}: ${titleOf(bead)}\nFiles: ${related.join(", ")}`,
			warnings: git.warnings,
		};
	} catch (error) {
		return errorState(error.reason ?? "beads-error", error.message, {
			action: error.reason ?? "beads-error",
		});
	}
}

function allRoadmaps(cwd) {
	try {
		return bdJsonRequired(cwd, ["list", "--type=epic"])
			.filter((epic) => typeOf(epic) === "epic")
			.sort(byUpdatedDesc);
	} catch {
		const byId = new Map();
		for (const status of ["in_progress", "open", "closed"]) {
			for (const epic of epicsByStatus(cwd, status)) byId.set(idOf(epic), epic);
		}
		return [...byId.values()].sort(byUpdatedDesc);
	}
}

function currentRoadmap(cwd) {
	const id = readWorkState(cwd).lastEpicId;
	if (id) {
		const epic = one(bdJsonRequired(cwd, ["show", id]));
		if (epic && typeOf(epic) === "epic") return epic;
	}
	const active = activeEpicCandidates(cwd);
	return active.length === 1 ? active[0] : undefined;
}

function resolveRoadmapTarget(cwd, target = "") {
	const text = String(target ?? "").trim();
	if (!text || text === "current" || text === "last") {
		const epic = currentRoadmap(cwd);
		return epic
			? { epic }
			: {
					error: "no-current-roadmap",
					message: "No current roadmap is selected.",
				};
	}
	const expanded = expandNumericBeadShorthand(cwd, text, "epic");
	if (expanded.error) return expanded;
	const epic = one(bdJsonRequired(cwd, ["show", expanded.target]));
	if (!epic)
		return { error: "unknown-target", message: `No Bead found for ${text}` };
	if (typeOf(epic) !== "epic")
		return {
			error: "not-roadmap",
			message: `${idOf(epic)} is not a roadmap/epic.`,
		};
	return { epic };
}

function roadmapSummary(_cwd, epic, currentId) {
	return { ...issueSummary(epic), current: idOf(epic) === currentId };
}

function splitRoadmapArgs(args = "") {
	const parts = String(args).trim().split(/\s+/).filter(Boolean);
	const command = parts[0] ?? "list";
	const target = parts[1]?.startsWith("--") ? "" : (parts[1] ?? "");
	const flags = parts.slice(target ? 2 : 1);
	return { command, target, flags };
}

function groupedRoadmapTasks(cwd, epic) {
	const state = buildEpicChildState(cwd, epic);
	const blocked = new Set(state.blockers.map(idOf));
	const open = state.children.filter(
		(issue) => statusOf(issue) !== "closed" && !blocked.has(idOf(issue)),
	);
	const closed = state.children.filter((issue) => statusOf(issue) === "closed");
	return {
		blockers: state.blockers.map(issueSummary),
		open: open.map(issueSummary),
		closed: closed.map(issueSummary),
	};
}

function buildWorkRoadmapState(cwd, args = "") {
	try {
		const { command, target, flags } = splitRoadmapArgs(args);
		const current = (() => {
			try {
				return currentRoadmap(cwd);
			} catch {
				return undefined;
			}
		})();
		const currentId = current ? idOf(current) : readWorkState(cwd).lastEpicId;
		if (command === "list") {
			const roadmaps = allRoadmaps(cwd).map((epic) =>
				roadmapSummary(cwd, epic, currentId),
			);
			return { ok: true, action: "roadmap-list", currentId, roadmaps };
		}
		if (command === "tasks") {
			const resolved = resolveRoadmapTarget(cwd, target);
			if (resolved.error)
				return errorState(resolved.error, resolved.message, resolved);
			return {
				ok: true,
				action: "roadmap-tasks",
				epic: issueSummary(resolved.epic),
				tasks: groupedRoadmapTasks(cwd, resolved.epic),
			};
		}
		if (command === "plan") {
			const state = buildWorkPlanState(
				cwd,
				[target, ...flags].filter(Boolean).join(" "),
			);
			return { ...state, action: `roadmap-${state.action}` };
		}
		if (command === "set-current") {
			const resolved = resolveRoadmapTarget(cwd, target);
			if (resolved.error)
				return errorState(resolved.error, resolved.message, resolved);
			rememberWorkflowEpic(cwd, resolved.epic);
			return {
				ok: true,
				action: "roadmap-set-current",
				epic: issueSummary(resolved.epic),
				message: "Current roadmap updated.",
			};
		}
		if (command === "close") {
			const force = flags.includes("--force");
			const resolved = resolveRoadmapTarget(cwd, target);
			if (resolved.error)
				return errorState(resolved.error, resolved.message, resolved);
			const unresolved = childrenOfRequired(cwd, idOf(resolved.epic)).filter(
				(issue) => statusOf(issue) !== "closed",
			);
			if (unresolved.length && !force)
				return {
					ok: true,
					action: "roadmap-close-needs-confirmation",
					epic: issueSummary(resolved.epic),
					unresolved: unresolved.map(issueSummary),
					message: `${unresolved.length} unresolved child Bead(s). Close anyway?`,
					suggestedCommands: [
						`/work-roadmap tasks ${idOf(resolved.epic)}`,
						`/work-roadmap close ${idOf(resolved.epic)} --force`,
					],
				};
			run(cwd, "bd", ["close", idOf(resolved.epic)]);
			rememberWorkflowEpic(cwd, { ...resolved.epic, status: "closed" });
			return {
				ok: true,
				action: "roadmap-closed",
				epic: issueSummary({ ...resolved.epic, status: "closed" }),
				message: "Roadmap closed by request.",
			};
		}
		if (command === "reopen") {
			const resolved = resolveRoadmapTarget(cwd, target);
			if (resolved.error)
				return errorState(resolved.error, resolved.message, resolved);
			run(cwd, "bd", ["reopen", idOf(resolved.epic)]);
			rememberWorkflowEpic(cwd, { ...resolved.epic, status: "open" });
			return {
				ok: true,
				action: "roadmap-reopened",
				epic: issueSummary({ ...resolved.epic, status: "open" }),
				message: "Roadmap reopened.",
			};
		}
		return errorState(
			"usage",
			"Usage: /work-roadmap [list|tasks|plan|set-current|close|reopen] [epic-id|current] [--force]",
			{ action: "usage" },
		);
	} catch (error) {
		return errorState(error.reason ?? "beads-error", error.message, {
			action: error.reason ?? "beads-error",
		});
	}
}

function errorState(reason, message, extra = {}) {
	return {
		ok: false,
		reason,
		message,
		warnings: [],
		...extra,
	};
}

function buildWorkReportState(cwd, args = "") {
	const { target } = parseWorkReportArgs(args);
	try {
		const resolved = resolveReportTarget(cwd, target);
		if (resolved.error) {
			return errorState(resolved.error, resolved.message ?? resolved.error, {
				candidates: resolved.candidates?.map(issueSummary) ?? [],
			});
		}
		return resolved.kind === "bead"
			? buildBeadReportState(cwd, resolved.bead)
			: buildEpicReportState(cwd, resolved.epic);
	} catch (error) {
		return errorState(error.reason ?? "beads-error", error.message);
	}
}

function renderNoteLines(notes) {
	const lines = [];
	if (notes.reason) lines.push(`reason: ${notes.reason}`);
	for (const command of notes.commands ?? []) lines.push(`command: ${command}`);
	for (const artifact of notes.artifacts ?? [])
		lines.push(`artifact: ${artifact}`);
	for (const runId of notes.runIds ?? []) lines.push(`run: ${runId}`);
	if (notes.nextAction) lines.push(`next: ${notes.nextAction}`);
	if (lines.length === 0 && notes.rawExcerpt) lines.push(notes.rawExcerpt);
	return lines;
}

function renderIssueList(items, fallback = "- none") {
	return items?.length
		? items.map(
				(issue) =>
					`- ${issue.id} ${issue.status} ${issue.type} — ${issue.title}`,
			)
		: [fallback];
}

function renderWorkReportText(state) {
	if (!state.ok) {
		const candidates = state.candidates?.length
			? ["Candidates:", ...renderIssueList(state.candidates)]
			: [];
		return [
			`Work report unavailable: ${state.message}`,
			...candidates,
			...renderRecommendedActions(recommendedActions(state)),
		].join("\n");
	}
	if (state.bead) {
		return [
			`Bead: ${state.bead.title} (${state.bead.id})`,
			`Status: ${state.bead.status} • type: ${state.bead.type}`,
			"",
			"Dependencies / blockers:",
			...renderIssueList(state.bead.dependencies),
			"",
			"Downstream blocked:",
			...(state.downstreamBlocked.length
				? state.downstreamBlocked.map(
						(item) =>
							`- ${item.bead.id} blocked by ${item.blockedBy.id} — ${item.bead.title}`,
					)
				: ["- none"]),
			"",
			"Failure artifact / notes:",
			state.bead.notes.reason || state.bead.notes.rawExcerpt || "- none",
			"",
			"Git:",
			compactMultiline(state.git.status),
			"",
			...renderRecommendedActions(recommendedActions(state)),
			`Next: ${state.suggestedCommands[0] ?? "No action suggested."}`,
		].join("\n");
	}
	return [
		`Epic: ${state.epic.title} (${state.epic.id})`,
		`Status: ${state.epic.status} • Progress: ${state.counts.closed}/${state.counts.slices} slices closed`,
		`Ready: ${state.counts.ready} • in progress: ${state.counts.inProgress} • blockers: ${state.counts.blockers} • decisions: ${state.counts.decisions}`,
		"",
		"Current blockers:",
		...(state.blockers.length
			? state.blockers.flatMap((issue) => {
					const details = renderNoteLines(issue.notes).map(
						(line) => `  - ${line}`,
					);
					return [
						`- ${issue.id} ${issue.status} ${issue.type} — ${issue.title}`,
						...details,
					];
				})
			: ["- none"]),
		"",
		"Downstream blocked:",
		...(state.downstreamBlocked.length
			? state.downstreamBlocked.map(
					(item) =>
						`- ${item.bead.id} blocked by ${item.blockedBy.id} — ${item.bead.title}`,
				)
			: ["- none"]),
		"",
		"Open decisions:",
		...renderIssueList(state.openDecisions),
		"",
		"Ready work:",
		...renderIssueList(state.readyWork),
		"",
		"Git:",
		compactMultiline(state.git.status),
		"",
		...renderRecommendedActions(recommendedActions(state)),
		state.nextAction ??
			`Next: ${state.suggestedCommands[0] ?? "No action suggested."}`,
	].join("\n");
}

function renderWorkReportJson(state) {
	return JSON.stringify(state, null, "\t");
}

function renderTaskGroup(title, items) {
	if (!items?.length) return [];
	return [
		title,
		...items.map((item) => `- ${item.id} [${item.status}] ${item.title}`),
	];
}

function renderWorkRoadmapText(state) {
	if (!state.ok) return `Work roadmap unavailable: ${state.message}`;
	if (state.action === "roadmap-list") {
		const rows = state.roadmaps.map(
			(epic) =>
				`- ${epic.current ? "*" : " "} ${epic.id} [${epic.status}] ${epic.title}`,
		);
		return ["Roadmaps:", ...(rows.length ? rows : ["- none"])].join("\n");
	}
	if (state.action === "roadmap-tasks")
		return [
			`Roadmap: ${state.epic.id} — ${state.epic.title}`,
			...renderTaskGroup("Blockers:", state.tasks.blockers),
			...renderTaskGroup("Open:", state.tasks.open),
			...renderTaskGroup("Closed:", state.tasks.closed),
		].join("\n");
	if (state.action === "roadmap-close-needs-confirmation")
		return [
			`Roadmap: ${state.epic.id} — ${state.epic.title}`,
			state.message,
			...renderTaskGroup("Unresolved:", state.unresolved),
			"Suggested:",
			...state.suggestedCommands.map((command) => `- ${command}`),
		].join("\n");
	return [
		`Action: ${state.action}`,
		state.epic ? `Roadmap: ${state.epic.id} — ${state.epic.title}` : "",
		state.message ?? "",
	]
		.filter(Boolean)
		.join("\n");
}

function buildWorkReport(cwd, args = "") {
	const parsed = parseWorkReportArgs(args);
	const state = buildWorkReportState(cwd, args);
	return parsed.json
		? renderWorkReportJson(state)
		: renderWorkReportText(state);
}

function renderResumeBlockedLines(state) {
	if (state.action !== "report-blocked") return [];
	const lines = [];
	if (state.blockers?.length) {
		lines.push("Blocked:");
		for (const [index, blocker] of state.blockers.slice(0, 3).entries()) {
			lines.push(
				`- ${blocker.id} ${blocker.status} ${blocker.type} — ${blocker.title}`,
			);
			if (index === 0 && blocker.notes?.nextAction)
				lines.push(`  Required action: ${blocker.notes.nextAction}`);
		}
		if (state.blockers.length > 3)
			lines.push(`- … ${state.blockers.length - 3} more blocker(s)`);
	}
	if (state.openDecisions?.length) {
		lines.push("Open decisions:");
		for (const decision of state.openDecisions.slice(0, 3))
			lines.push(`- ${decision.id} ${decision.status} — ${decision.title}`);
		if (state.openDecisions.length > 3)
			lines.push(`- … ${state.openDecisions.length - 3} more decision(s)`);
	}
	return lines.length ? ["", ...lines] : [];
}

function renderWorkResumeText(state) {
	if (!state.ok) {
		const candidates = state.candidates?.length
			? [
					"Candidates:",
					...state.candidates.map(
						(epic) =>
							`- ${epic.id} ${epic.status} — ${epic.title} (updated ${shortDate(epic.updated)}, children ${epic.counts?.children ?? "?"}, ready ${epic.counts?.ready ?? "?"})`,
					),
				]
			: [];
		return [
			`Work resume unavailable: ${state.message}`,
			...candidates,
			...renderRecommendedActions(recommendedActions(state)),
		].join("\n");
	}
	return [
		`Epic: ${state.epic.title} (${state.epic.id})`,
		`Action: ${state.action}`,
		`Ready: ${state.counts.ready} • executable: ${state.counts.readyExecutable} • planning: ${state.counts.planning} • blockers: ${state.counts.blockers} • decisions: ${state.counts.decisions}`,
		state.selectedBead
			? `Selected: ${state.selectedBead.id} ${state.selectedBead.type} — ${state.selectedBead.title}`
			: "Selected: none",
		state.message ? `Reason: ${state.message}` : "",
		...renderResumeBlockedLines(state),
		...renderRecommendedActions(recommendedActions(state)),
		"",
		"Git:",
		compactMultiline(state.git.status),
		"",
		state.nextAction ??
			`Next: ${state.handoffPrompt ? "handoff queued to work-orchestrator" : (state.suggestedCommands?.[0] ?? `epic ${state.epic.id} "${state.epic.title}" is complete.`)}`,
	]
		.filter((line) => line !== "")
		.join("\n");
}

function renderWorkResumeJson(state) {
	return JSON.stringify(state, null, "\t");
}

function buildWorkResume(cwd, args = "") {
	const parsed = parseWorkResumeArgs(args);
	const state = buildWorkResumeState(cwd, args);
	return parsed.json
		? renderWorkResumeJson(state)
		: renderWorkResumeText(state);
}

function splitFirstWord(value) {
	const trimmed = String(value ?? "").trim();
	if (!trimmed) return ["", ""];
	const match = /^(\S+)(?:\s+([\s\S]*))?$/.exec(trimmed);
	return [match?.[1] ?? "", match?.[2] ?? ""];
}

function parseWorkGoalCommand(args = "") {
	const trimmed = String(args ?? "").trim();
	if (!trimmed) return { kind: "status" };
	const [command, rest] = splitFirstWord(trimmed);
	if (["status", "show", "help"].includes(command)) return { kind: "status" };
	if (command === "pause") return { kind: "pause" };
	if (command === "resume") return { kind: "resume" };
	if (command === "clear" || command === "stop") return { kind: "clear" };
	if (command === "edit") return { kind: "edit", objective: rest.trim() };
	return { kind: "start", objective: trimmed };
}

function workGoalSelfImprovingAppendix() {
	return `Self-improving overlay:
- Use the ce-workflow/work-orchestrator process where it applies; prefer /work-init, /work-plan, /work-resume, /work-status, /work-report, and Beads-backed state over chat-only tracking.
- If a live or disposable target project exposes ce-workflow friction, fix this ce-workflow package in code before declaring done, or record one concrete follow-up when a safe fix is not possible now.
- Prefer coded automation over prompt-only guidance when workflow behavior can be handled in this extension.
- Use work telemetry and /work-context microcompaction to keep loops cheap, quiet, and resumable.
- Finish only after target-project progress and ce-workflow improvements are verified.`;
}

function workProjectAutopilotAppendix() {
	return `Project autopilot policy:
- Treat the target directory as the source of truth: verify git and Beads state there before mutating anything.
- Use the work-orchestrator resume/debug/status/report loop, with all product commands and role-agent cwd values pointed at the target project.
- Keep the parent session as coordinator only; use fresh-context Beads role agents for implementation, review, fixing, debugging, and committing.
- Obey the user instruction literally; if it says one task only, stop after one executable Bead closes. If it says N tasks, stop after N executable Beads close.
- At each phase boundary, inspect only observed workflow friction. If a safe ce-workflow fix exists, implement, verify, and commit it in the workflow repo (${WORKFLOW_REPO_DIR}) before continuing.
- Stop only when the requested scope is done, the epic is complete, or a real product/credential/hardware/destructive/verification decision is required.`;
}

function parseWorkProjectGoalInput(input = "") {
	const prompt = String(input ?? "").trim();
	const explicit = /\s+--\s+/.exec(prompt);
	if (explicit) {
		return {
			project: prompt.slice(0, explicit.index).trim(),
			task: prompt.slice(explicit.index + explicit[0].length).trim(),
		};
	}
	const quoted =
		/^(?<quote>["'])(?<project>.+?)\k<quote>\s*(?<task>[\s\S]*)$/.exec(prompt);
	if (quoted?.groups)
		return {
			project: quoted.groups.project.trim(),
			task: quoted.groups.task.trim(),
		};
	for (let index = prompt.length - 1; index > 0; index -= 1) {
		if (!/\s/.test(prompt[index])) continue;
		const project = prompt.slice(0, index).trim();
		const path = isAbsolute(project)
			? project
			: resolve(process.cwd(), project);
		if (existsSync(path)) return { project, task: prompt.slice(index).trim() };
	}
	const [project, task] = splitFirstWord(prompt);
	return { project, task: task.trim() };
}

function buildWorkSelfImprovingObjective(input = "", options = {}) {
	const prompt = String(input ?? "").trim();
	if (options.project) {
		const { project, task } = parseWorkProjectGoalInput(prompt);
		return [
			project ? `Target project: ${project}` : "",
			task
				? `User instruction for the target project: ${task}`
				: "Run the autonomous project work loop for the target project until the active work is complete or a real human decision is required.",
			workProjectAutopilotAppendix(),
			workGoalSelfImprovingAppendix(),
		]
			.filter(Boolean)
			.join("\n\n");
	}
	return [prompt, workGoalSelfImprovingAppendix()].filter(Boolean).join("\n\n");
}

function isWorkGoal(value) {
	return (
		value &&
		typeof value === "object" &&
		typeof value.id === "string" &&
		typeof value.objective === "string" &&
		["active", "paused", "needs_human", "complete"].includes(value.status)
	);
}

function loadWorkGoalFromSession(ctx) {
	const entries =
		ctx.sessionManager?.getBranch?.() ??
		ctx.sessionManager?.getEntries?.() ??
		[];
	const entry = entries
		.filter(
			(item) =>
				item.type === "custom" &&
				item.customType === WORK_GOAL_STATE_ENTRY_TYPE,
		)
		.pop();
	const goal = entry?.data?.goal;
	return isWorkGoal(goal) && goal.status !== "complete" ? goal : null;
}

function persistWorkGoal(pi, goal = activeWorkGoal) {
	pi?.appendEntry?.(WORK_GOAL_STATE_ENTRY_TYPE, { goal: goal ?? null });
}

function formatWorkGoalStatus(goal = activeWorkGoal) {
	if (!goal) return undefined;
	if (goal.status === "needs_human") return "needs human";
	if (goal.status === "active") return `active #${goal.iteration ?? 0}`;
	return goal.status;
}

function updateWorkGoalStatus(ctx, goal = activeWorkGoal) {
	ctx.ui.setStatus(WORK_GOAL_STATUS_KEY, formatWorkGoalStatus(goal));
}

function progressBar(done, total, width = 12) {
	if (!total) return "░".repeat(width);
	const filled = Math.min(width, Math.round((done / total) * width));
	return `${"█".repeat(filled)}${"░".repeat(width - filled)}`;
}

function isFailedIssue(issue) {
	const labels = labelsOf(issue);
	return statusOf(issue) === "failed" || labels.includes("wo:failed");
}

function projectGoalProgressState(cwd, goal = activeWorkGoal) {
	if (!goal || !["active", "needs_human"].includes(goal.status))
		return undefined;
	if (workWarpMode(goal.mode, goal) !== "project") return undefined;
	const epic = currentRoadmap(cwd);
	if (!epic) return undefined;
	const childState = buildEpicChildState(cwd, epic);
	const total = childState.slices.length;
	const complete = childState.closed.length;
	const failed = childState.slices.filter(isFailedIssue).length;
	const blocked = childState.slices.filter(
		(issue) => statusOf(issue) !== "closed" && isBlockedIssue(issue),
	).length;
	return {
		title: titleOf(epic),
		complete,
		total,
		failed,
		blocked,
		elapsedMs: Date.now() - (goal.startedAt ?? Date.now()),
	};
}

function renderProjectGoalProgress(state) {
	return `${state.title} ${progressBar(state.complete, state.total)} Comp: ${state.complete} / Total: ${state.total} (Failed: ${state.failed}, Blocked: ${state.blocked}) Time: ${formatDuration(state.elapsedMs)}`;
}

function updateWorkGoalProgress(ctx) {
	if (!ctx?.cwd || !ctx.ui?.setWidget) return;
	try {
		const state = projectGoalProgressState(ctx.cwd);
		ctx.ui.setWidget(
			WORK_GOAL_PROGRESS_WIDGET_KEY,
			state ? [renderProjectGoalProgress(state)] : undefined,
			{ placement: "belowEditor" },
		);
	} catch {
		ctx.ui.setWidget(WORK_GOAL_PROGRESS_WIDGET_KEY, undefined);
	}
}

function startWorkGoalProgressTimer(ctx) {
	if (workGoalProgressTimer) return;
	workGoalProgressTimer = setInterval(
		() => updateWorkGoalProgress(ctx),
		15_000,
	);
	workGoalProgressTimer.unref?.();
}

function stopWorkGoalProgressTimer(ctx) {
	if (workGoalProgressTimer) clearInterval(workGoalProgressTimer);
	workGoalProgressTimer = null;
	ctx?.ui?.setWidget?.(WORK_GOAL_PROGRESS_WIDGET_KEY, undefined);
}

function workGoalSummary(goal = activeWorkGoal) {
	if (!goal) return "No active /work-goal.";
	return [
		`Work goal: ${goal.objective}`,
		`Mode: ${goal.mode}`,
		`Status: ${goal.status}`,
		`Iteration: ${goal.iteration ?? 0}`,
		goal.decision
			? `Human decision: ${formatWorkGoalDecision(goal.decision)}`
			: "",
		"Commands: /work-goal pause|resume|clear|status|edit <objective>",
	]
		.filter(Boolean)
		.join("\n");
}

function createWorkGoal(mode, objective) {
	const now = Date.now();
	return {
		id: telemetryId("wg"),
		mode,
		objective,
		status: "active",
		iteration: 0,
		startedAt: now,
		updatedAt: now,
	};
}

function escapeXmlText(value) {
	return String(value ?? "")
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

function buildWorkGoalSystemPrompt(goal) {
	return `Active /work-goal:
<work_goal_objective>
${escapeXmlText(goal.objective)}
</work_goal_objective>

/work-goal management rules:
- The user's objective above is the work prompt; these rules only manage looping, compaction, and human-decision stops.
- Keep working autonomously until the objective is complete and verified.
- Before each continuation, /work-goal will microcompact old reasoning and tool noise; treat Beads, git, files, tests, and command output as source of truth.
- Do not stop for plan approval, permission to continue, or obvious implementation choices. Pick the clear winner and continue.
- Use work_goal_human_decision only when progress truly depends on user-only information: product intent, credentials/accounts, destructive or risky action, production/billing/legal impact, ambiguous priority/scope with no clear winner, hardware/environment access, or a target path/project choice you cannot infer.
- If tools are unavailable, end with ${WORK_GOAL_DECISION_MARKER}: and the question instead of asking a plain-text question.
- When complete, call work_goal_complete with verification evidence. If the tool is unavailable, end with ${WORK_GOAL_COMPLETE_MARKER}: and the evidence.
- Do not call completion for partial progress, blockers, failing tests, or unverified work.`;
}

function buildWorkGoalKickoffPrompt(goal) {
	return `Work-goal mode is active. Complete this objective fully:\n\n<work_goal_objective>\n${escapeXmlText(goal.objective)}\n</work_goal_objective>`;
}

function workGoalContinuationMarker(goal) {
	return `${goal.id}:${goal.iteration}:${Date.now().toString(36)}`;
}

function workGoalMarkerComment(marker) {
	return `<!-- ${WORK_GOAL_CONTINUATION_PREFIX}${marker} -->`;
}

function extractWorkGoalContinuationMarker(prompt) {
	const pattern = new RegExp(
		`<!--\\s*${WORK_GOAL_CONTINUATION_PREFIX.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}([^\\s>]+)\\s*-->`,
	);
	return pattern.exec(String(prompt ?? ""))?.[1];
}

function markWorkGoalContinuationDelivered(prompt) {
	const marker = extractWorkGoalContinuationMarker(prompt);
	if (marker && workGoalContinuationPending?.marker === marker)
		workGoalContinuationPending = null;
}

function buildWorkGoalContinuePrompt(goal, marker, note = "") {
	return `Continue the active /work-goal until it is complete. ${note}\n\n<work_goal_objective>\n${escapeXmlText(goal.objective)}\n</work_goal_objective>\n\nAutomatic continuation #${goal.iteration}. Use work_goal_human_decision only for real human-decision blockers; otherwise choose the clear winner and continue.\n\n${workGoalMarkerComment(marker)}`;
}

function buildWorkGoalCompactInstructions(goal) {
	return `work-context work-goal microcompact: preserve the active /work-goal objective, human decisions, Beads/git state, files changed/read, blockers, verification evidence, and next step. Omit old reasoning and full tool logs. Objective: ${truncate(goal.objective, 1_200)}`;
}

function workGoalHasPendingMessages(ctx) {
	return ctx.hasPendingMessages?.() ?? false;
}

async function sendWorkGoalPrompt(pi, ctx, prompt) {
	try {
		const send =
			typeof ctx.sendUserMessage === "function"
				? ctx.sendUserMessage.bind(ctx)
				: pi?.sendUserMessage?.bind(pi);
		if (!send) return false;
		if (ctx.isIdle?.()) await send(prompt);
		else await send(prompt, { deliverAs: "followUp" });
		return true;
	} catch (error) {
		ctx.ui.notify(
			`Could not queue /work-goal prompt: ${formatError(error)}`,
			"error",
		);
		return false;
	}
}

async function microCompactThenSendWorkGoalPrompt(pi, ctx, goal, prompt) {
	if (typeof ctx.compact !== "function")
		return sendWorkGoalPrompt(pi, ctx, prompt);
	contextCompactState.inFlight = true;
	contextCompactState.requested = true;
	return new Promise((resolvePromise) => {
		let settled = false;
		const finish = async (warning) => {
			if (settled) return;
			settled = true;
			contextCompactState.inFlight = false;
			contextCompactState.requested = false;
			if (warning) ctx.ui.notify(warning, "warning");
			if (
				!activeWorkGoal ||
				activeWorkGoal.id !== goal.id ||
				activeWorkGoal.status !== "active"
			) {
				resolvePromise(false);
				return;
			}
			resolvePromise(await sendWorkGoalPrompt(pi, ctx, prompt));
		};
		try {
			ctx.compact({
				customInstructions: buildWorkGoalCompactInstructions(goal),
				onComplete: () => finish(),
				onError: (error) =>
					finish(
						`Work-goal microcompact failed; continuing anyway: ${error.message}`,
					),
			});
		} catch (error) {
			finish(
				`Work-goal microcompact failed; continuing anyway: ${formatError(error)}`,
			);
		}
	});
}

async function sendWorkGoalContinuation(pi, ctx, goal, note = "") {
	if (workGoalContinuationPending?.goalId === goal.id) return false;
	if (workGoalHasPendingMessages(ctx)) return false;
	const marker = workGoalContinuationMarker(goal);
	const prompt = buildWorkGoalContinuePrompt(goal, marker, note);
	workGoalContinuationPending = {
		goalId: goal.id,
		marker,
		iteration: goal.iteration,
	};
	const sent = await microCompactThenSendWorkGoalPrompt(pi, ctx, goal, prompt);
	if (!sent && workGoalContinuationPending?.marker === marker)
		workGoalContinuationPending = null;
	return sent;
}

function finalAssistantMessage(messages = []) {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (message?.role === "assistant") return message;
	}
	return undefined;
}

function assistantVisibleText(message) {
	return contentText(message?.content ?? message?.message);
}

function parseWorkGoalCompletion(text) {
	const match = new RegExp(
		`(?:^|\\n)${WORK_GOAL_COMPLETE_MARKER}:?\\s*([\\s\\S]*)`,
		"i",
	).exec(String(text ?? ""));
	return match ? truncate(match[1] || "completed", 1_500) : "";
}

function parseWorkGoalDecision(text) {
	const match = new RegExp(
		`(?:^|\\n)${WORK_GOAL_DECISION_MARKER}:?\\s*([\\s\\S]*)`,
		"i",
	).exec(String(text ?? ""));
	return match
		? { question: truncate(match[1], 2_000), source: "marker" }
		: null;
}

function likelyHumanDecisionQuestion(text) {
	const compact = String(text ?? "").trim();
	if (!/\?\s*$/.test(compact)) return false;
	return /\b(product|requirement|priority|scope|credential|secret|password|api key|account|billing|legal|production|deploy|delete|destructive|risk|hardware|device|port|path|repository|repo|choose|which option)\b/i.test(
		compact,
	);
}

function formatDecisionBlock(label, value, splitNumbered = false) {
	let text = String(value ?? "").trim();
	if (!text) return "";
	if (splitNumbered) text = text.replace(/\s+(?=\d+\.\s)/g, "\n");
	const lines = text.split(/\r?\n/).map((line) => `  ${line.trim()}`);
	return `${label}:\n${lines.join("\n")}`;
}

function formatWorkGoalDecision(decision = {}) {
	return [
		formatDecisionBlock("Question", decision.question),
		formatDecisionBlock("Why user needed", decision.whyUserNeeded),
		formatDecisionBlock("Options", decision.options, true),
		formatDecisionBlock("Recommendation", decision.recommendation),
	]
		.filter(Boolean)
		.join("\n\n");
}

function pauseWorkGoalForDecision(decision, ctx, pi) {
	if (!activeWorkGoal) return;
	workGoalContinuationPending = null;
	activeWorkGoal = {
		...activeWorkGoal,
		status: "needs_human",
		decision,
		updatedAt: Date.now(),
	};
	persistWorkGoal(pi);
	updateWorkGoalStatus(ctx);
	ctx.ui.notify(
		`/work-goal needs human decision:\n${formatWorkGoalDecision(decision)}`,
		"warning",
	);
	pauseWarpForDecision(ctx, decision);
}

function completeActiveWorkGoal(summary, ctx, pi) {
	const goal = activeWorkGoal;
	if (!goal) {
		return {
			content: [{ type: "text", text: "No active /work-goal." }],
			details: {},
		};
	}
	activeWorkGoal = { ...goal, status: "complete", updatedAt: Date.now() };
	persistWorkGoal(pi, activeWorkGoal);
	activeWorkGoal = null;
	workGoalContinuationPending = null;
	persistWorkGoal(pi, null);
	ctx.ui.setStatus(WORK_GOAL_STATUS_KEY, undefined);
	ctx.ui.setWidget?.(WORK_GOAL_PROGRESS_WIDGET_KEY, undefined);
	ctx.ui.notify(`/work-goal complete: ${truncate(summary, 240)}`, "info");
	finishWarpWork(ctx, workWarpMode(goal.mode, goal), summary);
	return {
		content: [{ type: "text", text: `/work-goal complete: ${summary}` }],
		details: { goal: goal.objective, summary },
		terminate: true,
	};
}

async function startWorkGoal(mode, objective, pi, ctx) {
	const text = String(objective ?? "").trim();
	if (!text) {
		ctx.ui.notify("Usage: /work-goal <objective>", "warning");
		return;
	}
	if (activeWorkGoal && activeWorkGoal.status !== "complete") {
		const replace = await ctx.ui.confirm(
			"Replace /work-goal?",
			`Current: ${activeWorkGoal.objective}\n\nNew: ${text}`,
		);
		if (!replace) return;
	}
	workGoalContinuationPending = null;
	activeWorkGoal = createWorkGoal(mode, text);
	persistWorkGoal(pi);
	updateWorkGoalStatus(ctx);
	ctx.ui.notify(`/work-goal started: ${truncate(text, 240)}`, "info");
	await sendWorkGoalPrompt(pi, ctx, buildWorkGoalKickoffPrompt(activeWorkGoal));
}

async function handleWorkGoalCommand(args, mode, pi, ctx) {
	const command = parseWorkGoalCommand(args);
	if (command.kind === "status") {
		ctx.ui.notify(workGoalSummary(), "info");
		updateWorkGoalStatus(ctx);
		return;
	}
	if (command.kind === "clear") {
		const previous = activeWorkGoal?.objective;
		activeWorkGoal = null;
		workGoalContinuationPending = null;
		persistWorkGoal(pi, null);
		ctx.ui.setStatus(WORK_GOAL_STATUS_KEY, undefined);
		ctx.ui.setWidget?.(WORK_GOAL_PROGRESS_WIDGET_KEY, undefined);
		ctx.ui.notify(
			previous
				? `/work-goal cleared: ${truncate(previous, 240)}`
				: "No active /work-goal.",
			"info",
		);
		return;
	}
	if (!activeWorkGoal && command.kind !== "start") {
		ctx.ui.notify("No active /work-goal.", "warning");
		return;
	}
	if (command.kind === "pause") {
		activeWorkGoal = {
			...activeWorkGoal,
			status: "paused",
			updatedAt: Date.now(),
		};
		workGoalContinuationPending = null;
		persistWorkGoal(pi);
		updateWorkGoalStatus(ctx);
		ctx.ui.notify("/work-goal paused.", "info");
		return;
	}
	if (command.kind === "resume") {
		activeWorkGoal = {
			...activeWorkGoal,
			status: "active",
			updatedAt: Date.now(),
		};
		persistWorkGoal(pi);
		updateWorkGoalStatus(ctx);
		await sendWorkGoalPrompt(
			pi,
			ctx,
			buildWorkGoalContinuePrompt(
				activeWorkGoal,
				workGoalContinuationMarker(activeWorkGoal),
				"User resumed the goal.",
			),
		);
		return;
	}
	if (command.kind === "edit") {
		if (!command.objective) {
			ctx.ui.notify("Usage: /work-goal edit <objective>", "warning");
			return;
		}
		activeWorkGoal = {
			...activeWorkGoal,
			objective: command.objective,
			status: "active",
			updatedAt: Date.now(),
		};
		persistWorkGoal(pi);
		updateWorkGoalStatus(ctx);
		await sendWorkGoalPrompt(
			pi,
			ctx,
			buildWorkGoalKickoffPrompt(activeWorkGoal),
		);
		return;
	}
	await startWorkGoal(mode, command.objective, pi, ctx);
}

async function handleSelfImprovingWorkGoalCommand(args, pi, ctx, options = {}) {
	const command = parseWorkGoalCommand(args);
	if (command.kind !== "start" && command.kind !== "edit")
		return handleWorkGoalCommand(args, "self-improving", pi, ctx);
	const objective = buildWorkSelfImprovingObjective(command.objective, options);
	return command.kind === "edit"
		? handleWorkGoalCommand(`edit ${objective}`, "self-improving", pi, ctx)
		: startWorkGoal("self-improving", objective, pi, ctx);
}

function workGoalHumanInputKind(text) {
	const value = String(text ?? "").trim();
	if (!value) return "clarify";
	if (/^(answer|decide|decision)\s*:/i.test(value)) return "answer";
	if (/^\d+\s*[).,:-]?/.test(value)) return "answer";
	if (/^(ask|clarify|question|q)\s*:/i.test(value)) return "clarify";
	if (/\?\s*$/.test(value)) return "clarify";
	return "answer";
}

function buildWorkGoalPausedPrompt(goal) {
	return `Paused /work-goal waiting for a human decision:
<work_goal_objective>
${escapeXmlText(goal.objective)}
</work_goal_objective>

Pending decision:
${formatWorkGoalDecision(goal.decision)}

Answer the user's clarification only. Do not continue the work-goal until the user gives a decision/answer.`;
}

function maybeResumeWorkGoalFromUserInput(event, ctx, pi) {
	if (event.source === "extension") return false;
	if (!activeWorkGoal || activeWorkGoal.status !== "needs_human") return false;
	const answer = String(event.text ?? "").trim();
	if (workGoalHumanInputKind(answer) === "clarify") return false;
	activeWorkGoal = {
		...activeWorkGoal,
		status: "active",
		decision: undefined,
		updatedAt: Date.now(),
	};
	workGoalContinuationRetry = {
		goalId: activeWorkGoal.id,
		note: `The human answered the pending decision; resume the objective using this answer:\n\n${truncate(answer, 2_000)}`,
	};
	persistWorkGoal(pi);
	updateWorkGoalStatus(ctx);
	startWarpWork(
		ctx,
		workWarpMode(activeWorkGoal.mode, activeWorkGoal),
		"human answered",
	);
	return true;
}

async function flushWorkGoalContinuationRetry(ctx, pi) {
	if (!activeWorkGoal || activeWorkGoal.status !== "active") return;
	if (workGoalContinuationRetry?.goalId !== activeWorkGoal.id) return;
	if (workGoalHasPendingMessages(ctx)) return;
	const retry = workGoalContinuationRetry;
	const sent = await sendWorkGoalContinuation(
		pi,
		ctx,
		activeWorkGoal,
		retry.note,
	);
	if (sent) workGoalContinuationRetry = null;
}

async function handleWorkGoalAgentEnd(event, ctx, pi) {
	if (!activeWorkGoal || activeWorkGoal.status !== "active") return;
	const goal = activeWorkGoal;
	const assistant = finalAssistantMessage(event.messages);
	const text = assistantVisibleText(assistant);
	const completion = parseWorkGoalCompletion(text);
	if (completion) {
		completeActiveWorkGoal(completion, ctx, pi);
		return;
	}
	const decision = parseWorkGoalDecision(text);
	if (decision || likelyHumanDecisionQuestion(text)) {
		pauseWorkGoalForDecision(
			decision ?? { question: truncate(text, 2_000), source: "question" },
			ctx,
			pi,
		);
		return;
	}
	if (["aborted", "error"].includes(String(assistant?.stopReason ?? ""))) {
		activeWorkGoal = { ...goal, status: "paused", updatedAt: Date.now() };
		persistWorkGoal(pi);
		updateWorkGoalStatus(ctx);
		ctx.ui.notify(
			"/work-goal paused after interruption. Run /work-goal resume to continue.",
			"warning",
		);
		return;
	}
	activeWorkGoal = {
		...goal,
		iteration: (goal.iteration ?? 0) + 1,
		updatedAt: Date.now(),
	};
	persistWorkGoal(pi);
	updateWorkGoalStatus(ctx);
	const note = /\?\s*$/.test(String(text).trim())
		? "Your last response ended with a non-blocking question; answer it yourself by choosing the clear winner."
		: "";
	if (workGoalHasPendingMessages(ctx)) {
		workGoalContinuationRetry = { goalId: activeWorkGoal.id, note };
		return;
	}
	await sendWorkGoalContinuation(pi, ctx, activeWorkGoal, note);
}

function formatError(error) {
	return error instanceof Error ? error.message : String(error);
}

async function sendFollowUp(ctx, message, pi) {
	if (!message) return;
	if (typeof ctx.sendUserMessage === "function") {
		await ctx.sendUserMessage(message, { deliverAs: "followUp" });
		return;
	}
	if (typeof pi?.sendUserMessage === "function") {
		pi.sendUserMessage(message, { deliverAs: "followUp" });
		return;
	}
	ctx.ui.notify(
		`Could not queue role handoff automatically. Run this next:\n\n${message}`,
		"warning",
	);
}

async function handleWorkResumeCommand(args, ctx, pi) {
	cleanupBenignInstructionDirt(ctx.cwd);
	const state = buildWorkResumeState(ctx.cwd, args);
	rememberRecommendedActions(ctx.cwd, recommendedActions(state), "work-resume");
	notify(ctx, renderWorkResumeText(state), state.ok ? "info" : "warning");
	if (state.handoffPrompt) await sendFollowUp(ctx, state.handoffPrompt, pi);
	return state;
}

function renderWorkflowActionText(state) {
	if (!state.ok) {
		const candidates = state.candidates?.length
			? ["Candidates:", ...renderIssueList(state.candidates)]
			: [];
		const suggested = state.suggestedCommands?.length
			? [
					"Suggested:",
					...state.suggestedCommands.map((command) => `- ${command}`),
				]
			: [];
		const alignment = state.alignment
			? [
					...state.alignment.missingSources.map(
						(source) => `Missing source: ${source}`,
					),
					...state.alignment.missingSignals
						.slice(0, 5)
						.map(
							(item) => `Untraced source signal: ${item.source} — ${item.line}`,
						),
				]
			: [];
		return [
			`Work command unavailable: ${state.message}`,
			...alignment,
			...candidates,
			...suggested,
		].join("\n");
	}
	return [
		`Action: ${state.action}`,
		state.epic ? `Epic: ${state.epic.id} — ${state.epic.title}` : "",
		state.selectedBead
			? `Bead: ${state.selectedBead.id} — ${state.selectedBead.title}`
			: "",
		state.message ? `Result: ${state.message}` : "",
		state.git ? `Git: ${state.git.status}` : "",
		state.note ? `\n${state.note}` : "",
		...renderRecommendedActions(recommendedActions(state)),
		state.nextAction ??
			(state.handoffPrompt
				? "Next: handoff queued to work-orchestrator"
				: state.suggestedCommands?.length
					? `Next: ${state.suggestedCommands[0]}`
					: ""),
	]
		.filter(Boolean)
		.join("\n");
}

async function handleWorkflowAction(builder, args, ctx, pi) {
	cleanupBenignInstructionDirt(ctx.cwd);
	const state = builder(ctx.cwd, args);
	rememberRecommendedActions(ctx.cwd, recommendedActions(state), "work-action");
	notify(ctx, renderWorkflowActionText(state), state.ok ? "info" : "warning");
	if (state.handoffPrompt) await sendFollowUp(ctx, state.handoffPrompt, pi);
	return state;
}

async function handleWorkStatusCommand(args, ctx) {
	cleanupBenignInstructionDirt(ctx.cwd);
	try {
		const output = withRecommendedActionsText(buildWorkStatus(ctx.cwd, args));
		rememberRecommendedActions(
			ctx.cwd,
			recommendedActionsFromText(output),
			"work-status",
		);
		notify(ctx, output, "info");
		return { ok: true, outputChars: output.length };
	} catch (error) {
		notify(ctx, `Could not build work status: ${formatError(error)}`, "error");
		return { ok: false, reason: "status-error" };
	}
}

async function handleWorkReportCommand(args, ctx) {
	cleanupBenignInstructionDirt(ctx.cwd);
	const parsed = parseWorkReportArgs(args);
	const state = buildWorkReportState(ctx.cwd, args);
	const output = parsed.json
		? renderWorkReportJson(state)
		: renderWorkReportText(state);
	if (!parsed.json)
		rememberRecommendedActions(
			ctx.cwd,
			recommendedActions(state),
			"work-report",
		);
	notify(ctx, output, "info");
	return { ok: true, outputChars: output.length };
}

function roadmapTaskItems(tasks = {}) {
	return [
		["blocker", "Blocker", tasks.blockers],
		["open", "Open", tasks.open],
		["closed", "Closed", tasks.closed],
	].flatMap(([group, label, items = []]) =>
		items.map((item) => ({ group, label, item })),
	);
}

async function handleRoadmapTasksMenu(epicId, ctx, pi) {
	const state = buildWorkRoadmapState(ctx.cwd, `tasks ${epicId}`);
	if (!state.ok) {
		notify(ctx, renderWorkRoadmapText(state), "warning");
		return stateTelemetry(state);
	}
	const items = roadmapTaskItems(state.tasks).map(({ group, label, item }) => ({
		value: `${group}:${item.id}`,
		label: `${label}: ${item.id} [${item.status}] ${item.title}`,
		description: item.type,
	}));
	if (!items.length) {
		notify(ctx, renderWorkRoadmapText(state), "info");
		return stateTelemetry(state);
	}
	const task = await choose(ctx, `${state.epic.id}: tasks`, items);
	if (!task) {
		notify(ctx, renderWorkRoadmapText(state), "info");
		return stateTelemetry(state);
	}
	const [group, beadId] = task.split(":", 2);
	const ops = [{ value: "summary", label: "summary" }];
	if (group === "blocker")
		ops.push({ value: "debug", label: "debug / full info" });
	const op = await choose(ctx, `${beadId}: operation`, ops);
	if (op === "debug")
		return handleWorkflowAction(buildWorkDebugState, beadId, ctx, pi);
	return handleWorkReportCommand(beadId, ctx);
}

async function handleWorkRoadmapCommand(args, ctx, pi) {
	cleanupBenignInstructionDirt(ctx.cwd);
	const text = String(args ?? "").trim();
	if (text) {
		const parsed = splitRoadmapArgs(text);
		if (parsed.command === "plan")
			return handleWorkflowAction(
				buildWorkPlanState,
				[parsed.target, ...parsed.flags].filter(Boolean).join(" "),
				ctx,
				pi,
			);
		const state = buildWorkRoadmapState(ctx.cwd, text);
		notify(ctx, renderWorkRoadmapText(state), state.ok ? "info" : "warning");
		return stateTelemetry(state);
	}
	const list = buildWorkRoadmapState(ctx.cwd, "list");
	if (!list.ok) {
		notify(ctx, renderWorkRoadmapText(list), "warning");
		return stateTelemetry(list);
	}
	const selected = await choose(
		ctx,
		"Work roadmaps",
		list.roadmaps.map((epic) => ({
			value: epic.id,
			label: `${epic.current ? "* " : ""}${epic.id} [${epic.status}] ${epic.title}`,
		})),
	);
	if (!selected) return { ok: true, action: "roadmap-cancel" };
	const op = await choose(ctx, `${selected}: operation`, [
		{
			value: "tasks",
			label: "list tasks",
			description: "blockers, open, closed",
		},
		{
			value: "plan",
			label: "plan / strengthen",
			description: "use linked brainstorm/plan",
		},
		{ value: "set-current", label: "set current" },
		{
			value: "close",
			label: "close",
			description: "asks before unresolved tasks",
		},
		{ value: "reopen", label: "reopen" },
		{ value: "resume", label: "resume work" },
		{ value: "report", label: "full report" },
	]);
	if (!op) return { ok: true, action: "roadmap-cancel" };
	if (op === "resume") return handleWorkResumeCommand(selected, ctx, pi);
	if (op === "report") return handleWorkReportCommand(selected, ctx);
	if (op === "tasks") return handleRoadmapTasksMenu(selected, ctx, pi);
	if (op === "plan")
		return handleWorkflowAction(buildWorkPlanState, selected, ctx, pi);
	let state = buildWorkRoadmapState(ctx.cwd, `${op} ${selected}`);
	if (state.action === "roadmap-close-needs-confirmation") {
		const confirm = await choose(ctx, state.message, [
			{ value: "cancel", label: "cancel" },
			{ value: "force", label: "close anyway" },
		]);
		if (confirm === "force")
			state = buildWorkRoadmapState(ctx.cwd, `close ${selected} --force`);
	}
	notify(ctx, renderWorkRoadmapText(state), state.ok ? "info" : "warning");
	return stateTelemetry(state);
}

async function executeNumberedWorkAction(action, ctx, pi) {
	const match = String(action ?? "").match(/^\/(work-[\w-]+)(?:\s+(.*))?$/);
	if (!match) return false;
	const [, command, args = ""] = match;
	const builders = {
		"work-init": buildWorkInitState,
		"work-pause": buildWorkPauseState,
		"work-small": buildWorkSmallState,
		"work-med": buildWorkMedState,
		"work-big": buildWorkBigState,
		"work-plan": buildWorkPlanState,
		"work-master": buildWorkMasterState,
		"work-migrate": buildWorkMigrateState,
		"work-finish": buildWorkFinishState,
		"work-debug": buildWorkDebugState,
		"work-add": buildWorkAddState,
		"work-auto": buildWorkAutoState,
		"work-roadmap": buildWorkRoadmapState,
	};
	if (command === "work-status")
		await withCommandTelemetry(command, args, ctx, () =>
			handleWorkStatusCommand(args, ctx),
		);
	else if (command === "work-report")
		await withCommandTelemetry(command, args, ctx, () =>
			handleWorkReportCommand(args, ctx),
		);
	else if (command === "work-resume" || command === "work-continue")
		await withCommandTelemetry(
			command,
			args,
			ctx,
			() => handleWorkResumeCommand(args, ctx, pi),
			true,
		);
	else if (builders[command])
		await withCommandTelemetry(
			command,
			args,
			ctx,
			() => handleWorkflowAction(builders[command], args, ctx, pi),
			true,
		);
	else return false;
	return true;
}

async function maybeRunNumberedWorkAction(event, ctx, pi) {
	if (event.source === "extension") return false;
	if (activeWorkGoal?.status === "needs_human") return false;
	const match = String(event.text ?? "")
		.trim()
		.match(/^(\d+)$/);
	if (!match) return false;
	const last = readWorkState(ctx.cwd).lastActions;
	const ageMs = Date.now() - Date.parse(last?.updatedAt ?? "");
	if (
		!last?.actions?.length ||
		!Number.isFinite(ageMs) ||
		ageMs > 60 * 60 * 1000
	)
		return false;
	const action = last.actions[Number(match[1]) - 1];
	if (!action) return false;
	notify(ctx, `Running ${match[1]}. ${action}`, "info");
	return executeNumberedWorkAction(action, ctx, pi);
}

export {
	buildWorkAddState,
	buildWorkAutoState,
	buildWorkGoalSystemPrompt,
	buildWorkSelfImprovingObjective,
	buildWorkBigState,
	buildWorkDebugState,
	buildWorkFinishState,
	buildWorkIdeateState,
	buildWorkBrainstormState,
	captureIdeationIdeas,
	brainstormHandoffPrompt,
	buildWorkflowIntakeState,
	buildWorkInitState,
	buildWorkMasterState,
	buildWorkMedState,
	buildWorkPlanState,
	buildWorkMigrateState,
	buildWorkPauseState,
	buildWorkReport,
	buildWorkReportState,
	buildWorkRoadmapState,
	buildWorkResume,
	buildWorkResumeState,
	buildWorkSmallState,
	buildWorkTelemetry,
	buildWorkTelemetryState,
	buildWorkUsageState,
	deriveIdeaStatus,
	isIdeaIssue,
	parseIdeationIdeas,
	recordWorkTelemetry,
	handleWorkResumeCommand,
	handleWorkRoadmapCommand,
	parseWorkGoalCommand,
	parseWorkProjectGoalInput,
	planResumeAction,
	renderWorkIdeateText,
	renderWorkBrainstormText,
	renderWorkUsageText,
	renderWorkReportJson,
	renderWorkReportText,
	renderWorkRoadmapText,
	renderProjectGoalProgress,
	renderWorkResumeJson,
	renderWorkResumeText,
	warpNotificationEnabled,
	warpPayload,
	workGoalHumanInputKind,
	workWarpMode,
	workWarpTitle,
};

export default function workModelsExtension(pi) {
	exposeBundledSubagentAgents();

	if (typeof pi.registerTool === "function") {
		pi.registerTool({
			name: "work_goal_complete",
			label: "Work Goal Complete",
			description:
				"Mark the active /work-goal complete after the objective is fully done and verified.",
			promptSnippet:
				"Mark the active /work-goal complete after verified completion",
			promptGuidelines: [
				"Use work_goal_complete only when the active /work-goal is fully complete and verified.",
			],
			parameters: { ...WORK_GOAL_TOOL_SCHEMA, required: ["summary"] },
			async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
				return completeActiveWorkGoal(
					String(params.summary ?? "completed"),
					ctx,
					pi,
				);
			},
		});

		pi.registerTool({
			name: "work_goal_human_decision",
			label: "Work Goal Human Decision",
			description:
				"Pause the active /work-goal only for real user-only decisions; do not use for plan approval, permission to continue, or clear-winner choices.",
			promptSnippet: "Pause /work-goal for a real human decision factor",
			promptGuidelines: [
				"Use work_goal_human_decision only for user-only product, credential, destructive/risky, priority/scope, environment, or no-clear-winner decisions.",
			],
			parameters: {
				...WORK_GOAL_TOOL_SCHEMA,
				required: ["question", "whyUserNeeded"],
			},
			async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
				const decision = {
					question: String(params.question ?? "").trim(),
					whyUserNeeded: String(params.whyUserNeeded ?? "").trim(),
					options: String(params.options ?? "").trim(),
					recommendation: String(params.recommendation ?? "").trim(),
					source: "tool",
				};
				pauseWorkGoalForDecision(decision, ctx, pi);
				return {
					content: [
						{
							type: "text",
							text: `/work-goal paused for human decision.\n${formatWorkGoalDecision(decision)}`,
						},
					],
					details: decision,
					terminate: true,
				};
			},
		});
	}

	pi.on("session_start", (_event, ctx) => {
		activeWorkGoal = loadWorkGoalFromSession(ctx);
		workGoalContinuationPending = null;
		updateWorkGoalStatus(ctx);
		updateWorkGoalProgress(ctx);
		startWorkGoalProgressTimer(ctx);
	});

	pi.on("session_shutdown", (_event, ctx) => {
		persistWorkGoal(pi);
		ctx.ui.setStatus(WORK_GOAL_STATUS_KEY, undefined);
		stopWorkGoalProgressTimer(ctx);
	});

	pi.on("input", (event, ctx) => {
		if (/^\d+$/.test(String(event.text ?? "").trim()))
			return (async () => {
				if (await maybeRunNumberedWorkAction(event, ctx, pi))
					return { action: "handled" };
				if (maybeResumeWorkGoalFromUserInput(event, ctx, pi))
					return { action: "handled" };
			})();
		if (maybeResumeWorkGoalFromUserInput(event, ctx, pi))
			return { action: "handled" };
	});

	pi.on("before_agent_start", async (event, ctx) => {
		markWorkGoalContinuationDelivered(event.prompt);
		const meta = parseWorkPromptMeta(event.prompt);
		pendingWorkPrompt = meta
			? {
					id: telemetryId("agent"),
					cwd: ctx.cwd,
					promptChars: String(event.prompt ?? "").length,
					meta,
					contextBefore: usageSnapshot(ctx),
				}
			: null;
		if (!activeWorkGoal) return;
		if (activeWorkGoal.status === "needs_human") {
			return {
				systemPrompt: `${event.systemPrompt}\n\n${buildWorkGoalPausedPrompt(activeWorkGoal)}`,
			};
		}
		if (activeWorkGoal.status !== "active") return;
		return {
			systemPrompt: `${event.systemPrompt}\n\n${buildWorkGoalSystemPrompt(activeWorkGoal)}`,
		};
	});

	pi.on("agent_start", async (_event, ctx) => {
		if (!pendingWorkPrompt) {
			if (activeWorkGoal?.status === "active") {
				startWarpWork(
					ctx,
					workWarpMode(activeWorkGoal.mode, activeWorkGoal),
					activeWorkGoal.objective,
				);
			} else {
				setWarpTitle(ctx, workWarpTitle("work", ctx?.cwd ?? process.cwd()));
			}
			return;
		}
		activeWorkAgent = {
			...pendingWorkPrompt,
			startedAt: Date.now(),
			gitBefore: gitSnapshot(pendingWorkPrompt.cwd),
			tools: [],
			toolStarts: new Map(),
		};
		startWarpWork(
			ctx ?? { cwd: activeWorkAgent.cwd },
			workWarpMode(activeWorkAgent.meta.mode),
			`/work-${activeWorkAgent.meta.mode ?? "work"}`,
		);
		pendingWorkPrompt = null;
	});

	pi.on("tool_execution_start", async (event) => {
		if (!activeWorkAgent) return;
		activeWorkAgent.toolStarts.set(event.toolCallId, {
			startedAt: Date.now(),
			args: event.args,
		});
	});

	pi.on("tool_execution_end", async (event, ctx) => {
		updateWorkGoalProgress(ctx);
		if (!activeWorkAgent) return;
		const started = activeWorkAgent.toolStarts.get(event.toolCallId);
		activeWorkAgent.tools.push(summarizeToolResult(event, started));
		activeWorkAgent.toolStarts.delete(event.toolCallId);
	});

	pi.on("agent_end", async (event, ctx) => {
		if (!activeWorkAgent) {
			const hadWorkGoal = Boolean(activeWorkGoal);
			await handleWorkGoalAgentEnd(event, ctx, pi);
			if (!hadWorkGoal) resetWarpTitle(ctx);
			return;
		}
		const run = activeWorkAgent;
		activeWorkAgent = null;
		const usage = messageUsage(event.messages);
		const durationMs = Math.max(0, Date.now() - run.startedAt);
		const review = reviewTelemetry(run.meta, event);
		const gitAfter = gitSnapshot(run.cwd);
		const testsRun = run.tools.filter((tool) => tool.kind === "test").length;
		const role = handoffRole(run.meta.action) ?? handoffRole(run.meta.mode);
		const telemetry = {
			id: run.id,
			type: "agent",
			mode: run.meta.mode,
			action: run.meta.action,
			role,
			handoff: { queued: false, started: true, role },
			epicId: run.meta.epicId,
			beadId: run.meta.beadId,
			durationMs,
			promptChars: run.promptChars,
			messages: summarizeMessages(event.messages),
			tools: run.tools,
			usage,
			review,
			payoff: {
				role,
				durationMs,
				tokens: usage.totalTokens || undefined,
				filesChanged: gitAfter.dirtyFiles,
				commitCreated: Boolean(
					run.gitBefore?.head &&
						gitAfter.head &&
						run.gitBefore.head !== gitAfter.head,
				),
				testsRun,
				reviewOutcome: review?.outcome,
			},
			context: { before: run.contextBefore, after: usageSnapshot(ctx) },
		};
		const file = recordWorkTelemetry(run.cwd, telemetry);
		appendTelemetryNote(run.cwd, run.meta.beadId, telemetry, file);
		appendFailureStatusNote(
			run.cwd,
			run.meta.beadId,
			run,
			event,
			telemetry,
			file,
		);
		cleanupBenignInstructionDirt(run.cwd);
		finishWarpWork(
			ctx,
			workWarpMode(run.meta.mode),
			assistantVisibleText(finalAssistantMessage(event.messages)),
		);
		await handleWorkGoalAgentEnd(event, ctx, pi);
	});

	pi.on("session_before_compact", async (event, ctx) => {
		const instructions = event.customInstructions ?? "";
		if (
			!contextCompactState.requested &&
			!instructions.includes("work-context")
		)
			return;
		let settings = {};
		try {
			settings = readSettings(ctx.cwd);
		} catch {
			// Ignore unreadable project settings and keep compaction safe.
		}
		const current = contextSettings(settings);
		if (current.enabled === false && !contextCompactState.requested) return;
		return {
			compaction: {
				summary: instantSummary(
					{ ...event.preparation, settings: current },
					event.customInstructions,
				),
				firstKeptEntryId: event.preparation.firstKeptEntryId,
				tokensBefore: event.preparation.tokensBefore,
				details: {
					kind: "work-orchestrator-instant",
					reason: event.reason,
					files: filesFromOps(event.preparation.fileOps),
				},
			},
		};
	});

	pi.on("session_compact", async () => {
		contextCompactState.inFlight = false;
		contextCompactState.requested = false;
	});

	pi.on("turn_end", async (_event, ctx) => {
		try {
			maybeCompact(ctx, readSettings(ctx.cwd), "turn boundary");
		} catch {
			maybeCompact(ctx, {}, "turn boundary");
		}
		cleanupBenignInstructionDirt(ctx.cwd);
		await flushWorkGoalContinuationRetry(ctx, pi);
	});

	pi.registerCommand("work-goal", {
		description:
			"Run an autonomous goal with microcompact loops and human-decision stops",
		handler: async (args, ctx) => {
			await handleWorkGoalCommand(args, "generic", pi, ctx);
		},
	});

	pi.registerCommand("work-self-improving-goal", {
		description: "Run /work-goal with the ce-workflow self-improvement overlay",
		handler: async (args, ctx) => {
			await handleSelfImprovingWorkGoalCommand(args, pi, ctx);
		},
	});

	const workProjectGoalCommand = {
		description:
			"Run the self-improving project goal for a target repository path",
		handler: async (args, ctx) => {
			await handleSelfImprovingWorkGoalCommand(args, pi, ctx, {
				project: true,
			});
		},
	};
	pi.registerCommand("work-project-goal", workProjectGoalCommand);
	pi.registerCommand("work-project", workProjectGoalCommand);

	pi.registerCommand("work-init", {
		description: "Initialize Beads for work-orchestrator without AGENTS noise",
		handler: async (args, ctx) => {
			await withCommandTelemetry("work-init", args, ctx, () =>
				handleWorkflowAction(buildWorkInitState, args, ctx, pi),
			);
		},
	});

	pi.registerCommand("work-status", {
		description: "Show deterministic Beads/git work-orchestrator status",
		handler: async (args, ctx) => {
			await withCommandTelemetry("work-status", args, ctx, () =>
				handleWorkStatusCommand(args, ctx),
			);
		},
	});

	pi.registerCommand("work-report", {
		description: "Show deterministic Beads/git blocker handoff report",
		handler: async (args, ctx) => {
			await withCommandTelemetry("work-report", args, ctx, () =>
				handleWorkReportCommand(args, ctx),
			);
		},
	});

	pi.registerCommand("work-roadmap", {
		description: "List, select, close, reopen, and inspect Beads epics",
		handler: async (args, ctx) => {
			await withCommandTelemetry("work-roadmap", args, ctx, () =>
				handleWorkRoadmapCommand(args, ctx, pi),
			);
		},
	});

	pi.registerCommand("work-telemetry", {
		description:
			"Summarize work-orchestrator timing, token, and context telemetry",
		handler: async (args, ctx) => {
			cleanupBenignInstructionDirt(ctx.cwd);
			const output = buildWorkTelemetry(ctx.cwd, args);
			notify(ctx, output, "info");
		},
	});

	pi.registerCommand("work-usage", {
		description: "Write a local HTML work usage report from telemetry",
		handler: async (args, ctx) => {
			await withCommandTelemetry("work-usage", args, ctx, async () => {
				cleanupBenignInstructionDirt(ctx.cwd);
				const state = buildWorkUsageState(ctx.cwd, args);
				if (state.ok && state.open)
					state.browserOpened = openUsageReport(state.path);
				notify(ctx, renderWorkUsageText(state), state.ok ? "info" : "warning");
				return stateTelemetry(state);
			});
		},
	});

	pi.registerCommand("work-ideate", {
		description: "Show and mutate Beads-backed idea state",
		handler: async (args, ctx) => {
			await withCommandTelemetry("work-ideate", args, ctx, async () => {
				cleanupBenignInstructionDirt(ctx.cwd);
				const state = buildWorkIdeateState(ctx.cwd, args);
				notify(ctx, renderWorkIdeateText(state), state.ok ? "info" : "warning");
				if (state.handoffPrompt)
					await sendFollowUp(ctx, state.handoffPrompt, pi);
				return stateTelemetry(state);
			});
		},
	});

	pi.registerCommand("work-brainstorm", {
		description: "Link brainstorms back to Beads-backed ideas",
		handler: async (args, ctx) => {
			await withCommandTelemetry("work-brainstorm", args, ctx, async () => {
				cleanupBenignInstructionDirt(ctx.cwd);
				const state = buildWorkBrainstormState(ctx.cwd, args);
				notify(
					ctx,
					renderWorkBrainstormText(state),
					state.ok ? "info" : "warning",
				);
				if (state.ok)
					await sendFollowUp(ctx, brainstormHandoffPrompt(state), pi);
				return stateTelemetry(state);
			});
		},
	});

	pi.registerCommand("work-resume", {
		description:
			"Resolve the next Beads-backed work action and hand off safely",
		handler: async (args, ctx) => {
			await withCommandTelemetry(
				"work-resume",
				args,
				ctx,
				() => handleWorkResumeCommand(args, ctx, pi),
				true,
			);
		},
	});

	pi.registerCommand("work-continue", {
		description: "Alias for deterministic /work-resume preflight",
		handler: async (args, ctx) => {
			await withCommandTelemetry(
				"work-continue",
				args,
				ctx,
				() => handleWorkResumeCommand(args, ctx, pi),
				true,
			);
		},
	});

	pi.registerCommand("work-pause", {
		description: "Checkpoint current Beads-backed work and stop",
		handler: async (args, ctx) => {
			await withCommandTelemetry("work-pause", args, ctx, () =>
				handleWorkflowAction(buildWorkPauseState, args, ctx, pi),
			);
		},
	});

	pi.registerCommand("work-small", {
		description: "Create one implementation Bead and hand off safely",
		handler: async (args, ctx) => {
			await withCommandTelemetry(
				"work-small",
				args,
				ctx,
				() => handleWorkflowAction(buildWorkSmallState, args, ctx, pi),
				true,
			);
		},
	});

	pi.registerCommand("work-med", {
		description: "Create one medium planning Bead and hand off safely",
		handler: async (args, ctx) => {
			await withCommandTelemetry(
				"work-med",
				args,
				ctx,
				() => handleWorkflowAction(buildWorkMedState, args, ctx, pi),
				true,
			);
		},
	});

	pi.registerCommand("work-big", {
		description: "Create one large-slice planning Bead and hand off safely",
		handler: async (args, ctx) => {
			await withCommandTelemetry(
				"work-big",
				args,
				ctx,
				() => handleWorkflowAction(buildWorkBigState, args, ctx, pi),
				true,
			);
		},
	});

	pi.registerCommand("work-plan", {
		description: "Plan an idea and bootstrap the Beads epic",
		handler: async (args, ctx) => {
			await withCommandTelemetry(
				"work-plan",
				args,
				ctx,
				() => handleWorkflowAction(buildWorkPlanState, args, ctx, pi),
				true,
			);
		},
	});

	pi.registerCommand("work-master", {
		description: "Alias for /work-plan master epic bootstrap",
		handler: async (args, ctx) => {
			await withCommandTelemetry(
				"work-master",
				args,
				ctx,
				() => handleWorkflowAction(buildWorkMasterState, args, ctx, pi),
				true,
			);
		},
	});

	pi.registerCommand("work-migrate", {
		description: "Normalize migration sources and hand off safely",
		handler: async (args, ctx) => {
			await withCommandTelemetry(
				"work-migrate",
				args,
				ctx,
				() => handleWorkflowAction(buildWorkMigrateState, args, ctx, pi),
				true,
			);
		},
	});

	pi.registerCommand("work-finish", {
		description: "Classify commit/close readiness for reviewed work",
		handler: async (args, ctx) => {
			await withCommandTelemetry("work-finish", args, ctx, () =>
				handleWorkflowAction(buildWorkFinishState, args, ctx, pi),
			);
		},
	});

	pi.registerCommand("work-debug", {
		description: "Resolve or create a debug Bead and hand off safely",
		handler: async (args, ctx) => {
			await withCommandTelemetry(
				"work-debug",
				args,
				ctx,
				() => handleWorkflowAction(buildWorkDebugState, args, ctx, pi),
				true,
			);
		},
	});

	pi.registerCommand("work-add", {
		description: "Create explicit work under the active Beads epic",
		handler: async (args, ctx) => {
			await withCommandTelemetry("work-add", args, ctx, () =>
				handleWorkflowAction(buildWorkAddState, args, ctx, pi),
			);
		},
	});

	pi.registerCommand("work-auto", {
		description: "Run deterministic /work-auto guards and hand off",
		handler: async (args, ctx) => {
			await withCommandTelemetry("work-auto", args, ctx, () =>
				handleWorkflowAction(buildWorkAutoState, args, ctx, pi),
			);
		},
	});

	pi.registerCommand("work-context", {
		description: "Inspect or tune proactive instant context compaction",
		handler: async (args, ctx) => {
			let settings;
			try {
				settings = readSettings(ctx.cwd);
			} catch (error) {
				ctx.ui.notify(
					`Could not read ${settingsPath(ctx.cwd)}: ${error instanceof Error ? error.message : String(error)}`,
					"error",
				);
				return;
			}

			const [command, value] = args.trim().split(/\s+/, 2);
			if (!command || command === "status") {
				ctx.ui.notify(contextStatus(ctx, settings), "info");
				return;
			}
			if (command === "compact") {
				contextCompactState.requested = true;
				ctx.compact({
					customInstructions:
						"manual work-context compact: preserve Beads/git state, files, blockers, and next command; omit reasoning and full tool logs.",
					onComplete: () => {
						contextCompactState.requested = false;
						ctx.ui.notify("Work context compacted", "info");
					},
					onError: (error) => {
						contextCompactState.requested = false;
						ctx.ui.notify(
							`Work context compaction failed: ${error.message}`,
							"warning",
						);
					},
				});
				return;
			}
			if (command === "off" || command === "disable") {
				setContextSettings(settings, { enabled: false, autoCompact: false });
				writeSettings(ctx.cwd, settings);
				ctx.ui.notify("Disabled work context guard", "info");
				return;
			}
			if (command === "on" || command === "enable") {
				setContextSettings(settings, { enabled: true, autoCompact: true });
				writeSettings(ctx.cwd, settings);
				ctx.ui.notify("Enabled work context guard", "info");
				return;
			}
			if (command === "set") {
				setContextSettings(settings, {
					compactAtTokens: clampCompactAt(value),
				});
				writeSettings(ctx.cwd, settings);
				ctx.ui.notify(contextStatus(ctx, settings), "info");
				return;
			}

			ctx.ui.notify(
				"Usage: /work-context [status|compact|on|off|set <tokens>]",
				"warning",
			);
		},
	});

	pi.registerCommand("work-models", {
		description:
			"Configure persisted model/effort overrides for work-orchestrator role agents",
		handler: async (args, ctx) => {
			let settings;
			try {
				settings = readSettings(ctx.cwd);
			} catch (error) {
				ctx.ui.notify(
					`Could not read ${settingsPath(ctx.cwd)}: ${error instanceof Error ? error.message : String(error)}`,
					"error",
				);
				return;
			}

			if (args.trim() === "status") {
				notifySummary(ctx, settings);
				return;
			}

			if (args.trim() === "reset") {
				resetAll(settings);
				writeSettings(ctx.cwd, settings);
				ctx.ui.notify("Cleared work-orchestrator model overrides", "info");
				return;
			}

			const slotItems = SLOTS.map((slot) => ({
				value: slot.key,
				label: slot.label,
				description: `${slot.description} — ${slotSummary(slot, settings)}`,
			}));
			slotItems.push({
				value: RESET_ALL,
				label: "reset all",
				description: "Remove model/effort overrides for these work roles",
			});

			const slotKey = await choose(ctx, "Work models: choose task", slotItems);
			if (!slotKey) return;

			if (slotKey === RESET_ALL) {
				resetAll(settings);
				writeSettings(ctx.cwd, settings);
				ctx.ui.notify("Cleared work-orchestrator model overrides", "info");
				return;
			}

			const slot = SLOTS.find((item) => item.key === slotKey);
			if (!slot) return;

			const current = settings.subagents?.agentOverrides ?? {};
			const model = await choose(
				ctx,
				`${slot.label}: choose model`,
				await modelItems(ctx),
			);
			if (!model) return;

			const thinkingItems = [
				{
					value: DEFAULT_THINKING,
					label: `(blank) use role default (${slot.defaultThinking})`,
					description: "stored as no override",
				},
				...THINKING_LEVELS.map((level) => ({
					value: level,
					label: level,
					description: "persisted subagent thinking level",
				})),
			];
			const selectedThinking = commonValue(
				slot.agents.map((agent) => current[agent]?.thinking),
			);
			const thinking = await choose(
				ctx,
				`${slot.label}: choose effort${selectedThinking ? ` (current ${selectedThinking})` : ""}`,
				thinkingItems,
			);
			if (!thinking) return;

			try {
				setSlot(settings, slot, model, thinking);
				writeSettings(ctx.cwd, settings);
			} catch (error) {
				ctx.ui.notify(
					`Could not write ${settingsPath(ctx.cwd)}: ${error instanceof Error ? error.message : String(error)}`,
					"error",
				);
				return;
			}

			ctx.ui.notify(
				`Saved ${slot.label}: ${slotSummary(slot, settings)}`,
				"info",
			);
		},
	});
}
