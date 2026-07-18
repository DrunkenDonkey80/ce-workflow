import { createHash, randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { execFileSync } from "node:child_process";
import {
	appendFileSync,
	closeSync,
	constants as fsConstants,
	existsSync,
	fstatSync,
	mkdirSync,
	openSync,
	readdirSync,
	readFileSync,
	readSync,
	realpathSync,
	lstatSync,
	statSync,
	writeFileSync,
	writeSync,
} from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
	basename,
	delimiter,
	dirname,
	isAbsolute,
	join,
	relative,
	resolve,
} from "node:path";
import {
	analyzeWorkflow,
	readCandidateState,
	selectCandidate,
} from "./work-improvement.js";
import { migrateLegacyBeads } from "./legacy-beads-migration.js";
import {
	appendWorkNote,
	createWorkItem,
	initStore,
	loadStore,
	mutateStore,
	readyWorkItems,
	storePath,
	updateWorkItem,
	WorkStoreError,
} from "./work-store.js";

const CONFIG_DIR_NAME = ".pi";
const TELEMETRY_DIR_NAME = "work-runs";
const HISTORY_DIR_NAME = "history";
const PENDING_DIRECT_FILE = "pending-direct.jsonl";
const WORK_STATE_FILE = "work-orchestrator-state.json";
const WORK_SHORTCUT_STATUS = "F7 roadmaps · F8 menu";
const INHERIT_MODEL = "__inherit_model__";
const DEFAULT_THINKING = "__default_thinking__";
const IDEA_LABEL = "wo:idea";
const IDEA_SCHEMA_VERSION = 1;
const BRAINSTORM_TITLE_MAX = 180;
const WORK_ITEM_TITLE_MAX = 180;
const SUBAGENT_EXTRA_AGENT_DIRS_ENV = "PI_SUBAGENT_EXTRA_AGENT_DIRS";
const WORKFLOW_REPO_DIR = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"..",
);
const WORK_CATCH_UP_BASELINE_PATH = resolve(
	WORKFLOW_REPO_DIR,
	"extensions",
	"work-catch-up-baseline.json",
);
const WORK_ORCH_AGENT_DIR = resolve(WORKFLOW_REPO_DIR, "agents");
const WORK_HELPER_SCRIPT = resolve(
	WORKFLOW_REPO_DIR,
	"scripts",
	"work-helper.mjs",
);
const SUBAGENT_RPC_REQUEST_EVENT = "subagents:rpc:v1:request";
const SUBAGENT_RPC_REPLY_EVENT_PREFIX = "subagents:rpc:v1:reply:";

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
		agents: ["work-planner", "work-migrator"],
		defaultThinking: "high",
		description:
			"Creating or importing epics and slicing executable native work-item store",
	},
	{
		key: "work",
		label: "work",
		agents: ["work-worker", "work-fixer"],
		defaultThinking: "medium",
		description: "Implementation and reviewer-requested fixes",
	},
	{
		key: "debug",
		label: "debug",
		agents: ["work-debugger"],
		defaultThinking: "high",
		description: "Root-cause investigation and bug fixes",
	},
	{
		key: "review",
		label: "review",
		agents: ["work-reviewer"],
		defaultThinking: "medium",
		description: "Read-only diff/acceptance/verification review",
	},
	{
		key: "advisor",
		label: "advisor (critic)",
		agents: ["work-advisor"],
		defaultThinking: "xhigh",
		description:
			"Optional critic for plans/brainstorms and task-vs-plan verification; defaults to inherit model with xhigh effort",
	},
	{
		key: "advisorBackup",
		label: "advisor backup",
		agents: ["work-advisor-backup"],
		defaultThinking: "medium",
		description:
			"Lower-cost fallback critic when the primary advisor model is unavailable",
	},
];

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"];

// Effort profiles: thinking per slot + advisor, plus the advisory gates.
// Applying a profile overwrites effort and gates but keeps chosen models.
const EFFORT_PROFILES = {
	low: {
		plan: "low",
		work: "low",
		debug: "medium",
		review: "low",
		advisor: "medium",
		advisorBackup: "low",
		critic: { brainstorm: false, plan: false },
		advisorVerifyTask: false,
		slicePlanBeforeWork: true,
		slicePlanWithCePlan: false,
		slicePlanCeDepth: "Lightweight",
		simplifyBeforeReview: false,
		browserTestsOnUiDiff: false,
		codeReviewBeforeCommit: "off",
	},
	medium: {
		plan: "medium",
		work: "medium",
		debug: "high",
		review: "medium",
		advisor: "high",
		advisorBackup: "medium",
		critic: { brainstorm: true, plan: true },
		advisorVerifyTask: true,
		slicePlanBeforeWork: true,
		slicePlanWithCePlan: false,
		slicePlanCeDepth: "Lightweight",
		simplifyBeforeReview: false,
		browserTestsOnUiDiff: true,
		codeReviewBeforeCommit: "light",
	},
	high: {
		plan: "high",
		work: "high",
		debug: "high",
		review: "high",
		advisor: "xhigh",
		advisorBackup: "medium",
		critic: { brainstorm: true, plan: true },
		advisorVerifyTask: true,
		slicePlanBeforeWork: true,
		slicePlanWithCePlan: false,
		slicePlanCeDepth: "Standard",
		simplifyBeforeReview: true,
		browserTestsOnUiDiff: true,
		codeReviewBeforeCommit: "light",
	},
	max: {
		plan: "xhigh",
		work: "xhigh",
		debug: "xhigh",
		review: "high",
		advisor: "xhigh",
		advisorBackup: "high",
		critic: { brainstorm: true, plan: true },
		advisorVerifyTask: true,
		slicePlanBeforeWork: true,
		slicePlanWithCePlan: true,
		slicePlanCeDepth: "Deep",
		simplifyBeforeReview: true,
		browserTestsOnUiDiff: true,
		codeReviewBeforeCommit: "full",
	},
};
const DEFAULT_PROFILE = "medium";
const WORK_ORCH_BOOLEANS = [
	{ key: "advisorVerifyTask", label: "coded task-vs-plan checklist" },
	{
		key: "slicePlanBeforeWork",
		label: "planner writes slice plan before work",
	},
	{
		key: "slicePlanWithCePlan",
		label: "agent slice planner for messy/large slices",
	},
	{
		key: "simplifyBeforeReview",
		label: "ce-simplify-code before review",
	},
	{
		key: "browserTestsOnUiDiff",
		label: "ce-test-browser when diff touches UI",
	},
];
const WORK_ORCH_CRITIC_KEYS = ["brainstorm", "plan"];
const REVIEW_LEVELS = ["off", "light", "full"];
const REVIEW_LEVEL_DESC = {
	off: "no pre-commit review (low profile)",
	light: "one work-reviewer pass on the scoped diff (medium/high)",
	full: "full ce-code-review skill on the slice diff (max)",
};
const SUBMENU_ARROW = "›";

function slotByKey(key) {
	return SLOTS.find((slot) => slot.key === key);
}
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
const commandWorkflowStorage = new AsyncLocalStorage();
let activeHistoryTask = null;
let activeWorkAgent = null;
let activeWorkGoal = null;
let activeWorkGoalCwd = null;
let activeWorkGoalRunning = false;
let pendingWorkGoalTurn = false;
let workGoalContinuationPending = null;
let workGoalContinuationRetry = null;
let workGoalRecovery = null;
let workGoalCompactionResume = null;
let workGoalProgressTimer = null;
let workGoalUsageLimitTimer = null;
const activeImprovementRuns = new Map();
let workExtensionPi;

function clearWorkGoalUsageLimitTimer() {
	if (!workGoalUsageLimitTimer) return;
	clearTimeout(workGoalUsageLimitTimer);
	workGoalUsageLimitTimer = null;
}

function clearWorkGoalRecovery() {
	workGoalRecovery = null;
	workGoalCompactionResume = null;
}

const WORK_GOAL_STATE_ENTRY_TYPE = "work-goal-state";
const WORK_GOAL_RESET_COMMAND = "work-goal-reset-continue";
const WORK_GOAL_STATUS_KEY = "work-goal";
const WORK_GOAL_PROGRESS_WIDGET_KEY = "work-goal-progress";
const WORK_GOAL_COMPLETE_MARKER = "WORK_GOAL_COMPLETE";
const WORK_GOAL_DECISION_MARKER = "WORK_GOAL_NEEDS_HUMAN_DECISION";
const WORK_GOAL_CONTINUATION_PREFIX = "work-goal-continuation:";
const WORK_GOAL_MAX_RETRIES = 4;
const WORK_GOAL_USAGE_LIMIT_RETRY_MS = 10 * 60 * 1000;
const WORK_GOAL_USAGE_LIMIT_RE =
	/usage[_\s-]*(?:limit|reached)|\b429\b|too many requests|rate limit|访问量过大|使用上限|限额将在/i;
const WORK_GOAL_NON_RETRYABLE_RE =
	/multi-auth rotation failed|credentials tried|unauthori[sz]ed|invalid api key/i;
const WORK_GOAL_RETRYABLE_RE =
	/websocket closed|sse response headers timed out|headers timed out|context[_\s-]*length[_\s-]*exceeded|input exceeds the context window|context window|provider returned error|overloaded|529|503|connection reset|fetch failed|etimedout|socket hang up/i;
const WORK_GOAL_CONTEXT_OVERFLOW_RE =
	/context[_\s-]*length|context window|input exceeds|prompt is too long|maximum context length/i;
const WORK_GOAL_CONTRADICTORY_COMPLETION_RE =
	/(?<!could\s)\bnot\s+(?:yet\s+)?(?:complete|completed|done|finished)\b|\bstill\s+(?:incomplete|failing|failing\s+tests?|fails?)\b|\btests?\s+(?:still\s+)?fail(?:ing)?\b|\bblocked\b|\bnot\s+verified\b/i;
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
	ctx?.ui?.setTitle?.(title);
	writeTerminal(`\x1b]0;${title}\x07`);
}

function resetWarpTitle(ctx) {
	const cwd = ctx?.cwd ?? process.cwd();
	setWarpTitle(ctx, basename(cwd));
}

function startWarpWork(ctx, mode, query = "") {
	const cwd = ctx?.cwd ?? process.cwd();
	emitWarp(ctx, "session_start");
	emitWarp(ctx, "prompt_submit", { query: query || `/work-${mode}` });
	setWarpTitle(ctx, workWarpTitle(mode, cwd));
}

function finishWarpWork(ctx, mode, response = "") {
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
		const epic = readWorkItem(cwd, id);
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

function evaluationTelemetryIdentity(event = {}) {
	const sampleId = event.sampleId ?? process.env.CE_EVAL_SAMPLE_ID;
	if (!sampleId) return null;
	const role = event.role ?? process.env.CE_EVAL_ROLE ?? "main";
	return {
		sampleId,
		pairId: event.pairId ?? process.env.CE_EVAL_PAIR_ID,
		attemptId: event.attemptId ?? process.env.CE_EVAL_ATTEMPT_ID,
		agentId:
			event.agentId ?? process.env.CE_EVAL_AGENT_ID ?? `${sampleId}:${role}`,
		parentAgentId:
			event.parentAgentId ??
			(role === "main" ? null : process.env.CE_EVAL_PARENT_AGENT_ID),
		role,
		treatmentId:
			event.treatmentId ?? process.env.CE_EVAL_TREATMENT_ID ?? "control",
	};
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
	const role = state?.inlineWork
		? `inline-${state.inlineLevel ?? "medium"}`
		: handoffRole(state?.action);
	return {
		ok: state?.ok !== false,
		action: state?.action,
		reason: state?.reason,
		stopReason: stopReason(state),
		epicId: state?.epic?.id,
		workItemId: state?.selectedWorkItem?.id ?? state?.workItem?.id,
		workItemType: state?.selectedWorkItem?.type ?? state?.workItem?.type,
		handoff: {
			queued: handoffQueued,
			started: false,
			role,
			reason: handoffQueued
				? (state?.handoffReason ?? state?.action)
				: stopReason(state),
		},
		outputChars: state?.outputChars,
		counts: state?.counts,
		warnings: state?.warnings?.length
			? { count: state.warnings.length }
			: undefined,
	};
}

function telemetryFingerprint(event) {
	if (process.env.WORK_ORCH_TELEMETRY_DEDUPE_OFF === "1") return "";
	if (event.type === "large-task-read")
		return [event.type, event.command ?? "", event.workItemId ?? ""].join(
			"\u001f",
		);
	if (
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
		event.workItemId ?? event.meta?.workItemId ?? "",
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
	if (!existsSync(file)) return false;
	const fingerprint = telemetryFingerprint(record);
	const recordAt = Date.parse(record.timestamp ?? "");
	const windowMs = duplicateTelemetryWindowMs();
	const lines = readFileSync(file, "utf8").trim().split(/\r?\n/);
	for (let index = lines.length - 1; index >= 0; index -= 1) {
		let previous;
		try {
			previous = JSON.parse(lines[index]);
		} catch {
			continue;
		}
		if (record.id && previous?.id === record.id) return true;
		if (!fingerprint || !Number.isFinite(recordAt)) continue;
		if (telemetryFingerprint(previous) !== fingerprint) continue;
		const previousAt = Date.parse(previous.timestamp ?? "");
		const ageMs = recordAt - previousAt;
		return Number.isFinite(previousAt) && ageMs >= 0 && ageMs < windowMs;
	}
	return false;
}

function recordWorkTelemetry(cwd, event) {
	if (!cwd || process.env.WORK_ORCH_TELEMETRY_OFF === "1") return "";
	const enriched = telemetryWithTranscript(event);
	const identity = evaluationTelemetryIdentity(enriched);
	const timestamp = enriched.timestamp ?? Date.now();
	const record = {
		version: identity ? 2 : 1,
		...identity,
		...enriched,
		id: enriched.id ?? telemetryId(),
		timestamp: new Date(timestamp).toISOString(),
	};
	const file = telemetryPath(cwd, telemetryDay(timestamp));
	mkdirSync(telemetryDir(cwd), { recursive: true });
	if (isDuplicateTelemetry(file, record)) return file;
	appendFileSync(file, `${JSON.stringify(record)}\n`);
	return file;
}

function currentCommandWorkflow() {
	return commandWorkflowStorage.getStore();
}

function workflowActivityMarker() {
	return (
		currentCommandWorkflow()?.activity ??
		process.env.WORK_ORCH_ACTIVITY_MARKER ??
		process.env.WORK_ORCH_ACTIVITY ??
		undefined
	);
}

function workflowPromptMetadata() {
	const workflow = currentCommandWorkflow();
	if (!workflow?.workflowRunId) return [];
	return [
		`Workflow Run ID: ${workflow.workflowRunId}`,
		workflow.activity ? `Activity: ${workflow.activity}` : "",
	].filter(Boolean);
}

function workflowClaimPath(cwd, workflowRunId) {
	const key = createHash("sha256").update(String(workflowRunId)).digest("hex");
	return join(telemetryDir(cwd), "claims", `${key}.complete`);
}

function recordImprovementError(cwd, terminal, reason, error) {
	try {
		recordWorkTelemetry(cwd, {
			type: "improvement-status",
			workflowRunId: terminal?.workflowRunId,
			activity: "improvement",
			ok: false,
			reason,
			error: error ? truncate(error?.message ?? error, 300) : undefined,
		});
	} catch {}
}

function processTerminalAttached(cwd, terminal, runtime) {
	return Promise.resolve(processTerminalWorkflow(cwd, terminal, runtime)).catch(
		(error) => {
			recordImprovementError(
				cwd,
				terminal,
				"terminal-processing-failed",
				error,
			);
			return { status: "deferred", reason: "terminal-processing-failed" };
		},
	);
}

function completeWorkflowOnce(cwd, completion, runtime = {}) {
	if (!cwd || !completion?.workflowRunId) return "";
	const claim = workflowClaimPath(cwd, completion.workflowRunId);
	mkdirSync(dirname(claim), { recursive: true });
	let descriptor;
	let terminal = completion;
	try {
		descriptor = openSync(claim, "wx");
		terminal = {
			version: 1,
			id: telemetryId("workflow-complete"),
			timestamp: new Date().toISOString(),
			type: "workflow-complete",
			...completion,
			terminal: true,
		};
		writeSync(descriptor, `${JSON.stringify(terminal)}\n`);
	} catch (error) {
		if (error?.code !== "EEXIST") throw error;
		try {
			terminal = JSON.parse(readFileSync(claim, "utf8").trim());
		} catch (readError) {
			recordImprovementError(
				cwd,
				completion,
				"terminal-claim-read-failed",
				readError,
			);
			return "";
		}
	} finally {
		if (descriptor !== undefined) closeSync(descriptor);
	}
	void processTerminalAttached(cwd, terminal, runtime);
	return claim;
}

export async function recoverTerminalWorkflowClaims(cwd, runtime = {}) {
	const claims = join(telemetryDir(cwd), "claims");
	if (!existsSync(claims)) return [];
	const recovered = [];
	for (const name of readdirSync(claims).filter((item) =>
		item.endsWith(".complete"),
	)) {
		let terminal;
		try {
			terminal = JSON.parse(readFileSync(join(claims, name), "utf8").trim());
		} catch (error) {
			recordImprovementError(cwd, {}, "startup-claim-read-failed", error);
			continue;
		}
		try {
			const result = await processTerminalWorkflow(cwd, terminal, runtime);
			if (result.status !== "already-analyzed")
				recovered.push(terminal.workflowRunId);
		} catch (error) {
			recordImprovementError(cwd, terminal, "startup-analysis-failed", error);
		}
	}
	return recovered;
}

function improvementStateCwd(cwd) {
	const settings = readSettings(cwd);
	const configured = settings.workImprovement?.sourceCheckout;
	return resolve(
		cwd,
		typeof configured === "string" && configured.trim()
			? configured
			: process.env.CE_WORKFLOW_SOURCE_DIR || WORKFLOW_REPO_DIR,
	);
}

function improvementStatus(cwd) {
	if (!workResumeSettings(cwd).selfImproving)
		return { enabled: false, state: "off", candidates: 0 };
	try {
		const state = readCandidateState(improvementStateCwd(cwd));
		const candidates = [...state.candidates.values()];
		const current = candidates.sort((a, b) =>
			String(b.updatedAt).localeCompare(String(a.updatedAt)),
		)[0];
		return {
			enabled: true,
			state: current?.state ?? "observing",
			candidates: candidates.length,
			candidateId: current?.candidateId?.slice(0, 16),
			evidenceCount: current?.evidenceCount ?? 0,
			attemptId: current?.attemptId?.slice(0, 40),
			manualRecoveryReason:
				current?.state === "manual-recovery"
					? current.blockerSignature
					: undefined,
			benchmarkMeasurements: current?.benchmarkMeasurements,
			resultMeasurements: current?.resultMeasurements,
		};
	} catch {
		return { enabled: true, state: "status-unavailable", candidates: 0 };
	}
}

/** Analyze one terminal run in code and queue at most one autonomous attempt. */
export async function processTerminalWorkflow(cwd, terminal, runtime = {}) {
	if (!workResumeSettings(cwd).selfImproving) return { status: "disabled" };
	// Output-only modes must not even resolve the source because resolution can be injected or stateful.
	if (runtime.mode === "print" || runtime.json === true)
		return { status: "suppressed", reason: "output-only-mode" };
	const runner = await import(
		pathToFileURL(
			join(WORKFLOW_REPO_DIR, "scripts", "work-improvement-runner.mjs"),
		).href
	);
	const settings = readSettings(cwd);
	const resolved = runner.resolveSourceCheckout({
		settings,
		packageRoot: WORKFLOW_REPO_DIR,
		baseCwd: cwd,
		runGit: runtime.improvementSeams?.runGit,
	});
	if (!resolved.ok) {
		recordImprovementError(cwd, terminal, truncate(resolved.reason, 120));
		return { status: "deferred", reason: resolved.reason };
	}
	const sourceCwd = resolved.sourceCwd;
	const events = readTelemetryEvents(cwd).filter(
		(event) => event.workflowRunId === terminal.workflowRunId,
	);
	const analysis = analyzeWorkflow({
		sourceCwd,
		workflowRunId: terminal.workflowRunId,
		terminal: { ...terminal, type: "workflow-complete" },
		events,
		extensionRevision: extensionRevision(),
	});
	let candidate = null;
	if (analysis.status !== "excluded") {
		const blockerSignatures = {};
		for (const item of readCandidateState(sourceCwd).candidates.values())
			if (item.state === "deferred")
				blockerSignatures[item.candidateId] = runner.currentAutonomousBlocker(
					{ consumerCwd: cwd, settings, packageRoot: WORKFLOW_REPO_DIR },
					runtime.improvementSeams,
				);
		candidate = selectCandidate(sourceCwd, { blockerSignatures });
	}
	if (!candidate || runtime.allowLaunch === false)
		return { status: analysis.status, candidate: candidate?.candidateId };
	if (activeImprovementRuns.has(sourceCwd))
		return {
			status: analysis.status,
			candidate: candidate.candidateId,
			queued: false,
		};
	const controller = new AbortController();
	const dispatchAgent = (payload) =>
		dispatchWorkflowImprovementAgent(runtime.pi, {
			...payload,
			signal: controller.signal,
		});
	const runPackageVerify = async ({ cwd: verifyCwd }) => {
		try {
			execFileSync(
				process.execPath,
				["scripts/verify-package.mjs", "--quiet"],
				{ cwd: verifyCwd, stdio: "pipe", timeout: 2 * 60 * 1000 },
			);
			return { passed: true };
		} catch (error) {
			return {
				passed: false,
				output: truncate(error?.message ?? error, 300),
			};
		}
	};
	const runBenchmarkGate = (request) =>
		runner.runAutonomousImprovementBenchmark(
			sourceCwd,
			{ ...request, signal: controller.signal },
			dispatchAgent,
		);
	const run = (async () => {
		return runner.runAutonomousImprovement(
			{
				consumerCwd: cwd,
				candidate,
				settings,
				packageRoot: WORKFLOW_REPO_DIR,
				session: runtime.session,
			},
			{
				dispatchAgent,
				runPackageVerify,
				runBenchmarkGate,
				onReleaseError: (error) =>
					recordImprovementError(
						cwd,
						terminal,
						"lease-release-failed",
						error.reason,
					),
				...runtime.improvementSeams,
			},
		);
	})();
	activeImprovementRuns.set(sourceCwd, {
		controller,
		promise: run,
		cwd,
		terminal,
	});
	run
		.catch((error) =>
			recordImprovementError(cwd, terminal, "autonomous-run-failed", error),
		)
		.finally(() => activeImprovementRuns.delete(sourceCwd));
	return {
		status: analysis.status,
		candidate: candidate.candidateId,
		queued: true,
	};
}

function extensionRevision() {
	try {
		return `package-${JSON.parse(readFileSync(join(WORKFLOW_REPO_DIR, "package.json"), "utf8")).version ?? "unknown"}`;
	} catch {
		return "installed";
	}
}

function pendingDirectPath(cwd) {
	return join(telemetryDir(cwd), "direct", PENDING_DIRECT_FILE);
}

function readPendingDirectEvents(cwd) {
	try {
		const file = pendingDirectPath(cwd);
		if (!existsSync(file)) return [];
		return readFileSync(file, "utf8")
			.split(/\r?\n/)
			.filter(Boolean)
			.map((line) => {
				try {
					const event = JSON.parse(line);
					return event && typeof event === "object" ? event : undefined;
				} catch {
					return undefined;
				}
			})
			.filter(Boolean);
	} catch {
		return [];
	}
}

function recordPendingDirectRun(cwd, run) {
	if (!cwd || !run?.workflowRunId || (!run?.runId && !run?.asyncDir)) return "";
	const file = pendingDirectPath(cwd);
	mkdirSync(dirname(file), { recursive: true });
	appendFileSync(
		file,
		`${JSON.stringify({ version: 1, type: "pending", timestamp: new Date().toISOString(), ...run })}\n`,
	);
	return file;
}

const DIRECT_SUCCESS_STATES = new Set([
	"complete",
	"completed",
	"success",
	"ok",
	"passed",
]);
const DIRECT_TERMINAL_STATES = new Set([
	...DIRECT_SUCCESS_STATES,
	"failed",
	"error",
	"cancelled",
	"canceled",
	"timed_out",
	"timeout",
]);

function directStatusState(status) {
	return String(status?.state ?? status?.status ?? "").toLowerCase();
}

function directStatusComplete(status) {
	if (!status || typeof status !== "object") return false;
	if (DIRECT_TERMINAL_STATES.has(directStatusState(status))) return true;
	return (
		Array.isArray(status.steps) &&
		status.steps.length > 0 &&
		status.steps.every((step) =>
			DIRECT_TERMINAL_STATES.has(String(step?.status ?? "").toLowerCase()),
		)
	);
}

function reconcilePendingDirectRuns(cwd, runtime = {}) {
	try {
		const events = readPendingDirectEvents(cwd);
		const completed = new Set(
			events
				.filter((event) => event.type === "completed")
				.map((event) => event.workflowRunId),
		);
		const pending = new Map();
		for (const event of events) {
			if (event.type === "pending" && event.workflowRunId)
				pending.set(event.workflowRunId, event);
		}
		const reconciled = [];
		for (const run of pending.values()) {
			try {
				if (completed.has(run.workflowRunId)) continue;
				const statusFile =
					typeof run.asyncDir === "string"
						? join(run.asyncDir, "status.json")
						: "";
				if (!statusFile || !existsSync(statusFile)) continue;
				let status;
				try {
					status = JSON.parse(readFileSync(statusFile, "utf8"));
				} catch {
					continue;
				}
				if (!directStatusComplete(status)) continue;
				const details = Array.isArray(status.steps)
					? status.steps.map(summarizeSubagentResult)
					: [];
				const state = directStatusState(status);
				const ok = state
					? DIRECT_SUCCESS_STATES.has(state)
					: details.every((item) =>
							DIRECT_SUCCESS_STATES.has(String(item.status).toLowerCase()),
						);
				recordWorkTelemetry(cwd, {
					id: `direct-agent-${run.workflowRunId}`,
					type: "agent",
					workflowRunId: run.workflowRunId,
					activity: run.activity,
					action: run.action,
					role: handoffRole(run.agent ?? run.action),
					epicId: run.epicId,
					workItemId: run.workItemId,
					ok,
					handoff: { queued: false, started: true, role: run.agent },
					tools: [
						{ name: "subagent", runId: run.runId, subagentDetails: details },
					],
				});
				completeWorkflowOnce(
					cwd,
					{
						workflowRunId: run.workflowRunId,
						activity: run.activity,
						outcome: ok ? "completed" : "failed",
						action: run.action,
						epicId: run.epicId,
						workItemId: run.workItemId,
					},
					runtime,
				);
				appendFileSync(
					pendingDirectPath(cwd),
					`${JSON.stringify({ version: 1, type: "completed", timestamp: new Date().toISOString(), workflowRunId: run.workflowRunId })}\n`,
				);
				reconciled.push(run.workflowRunId);
			} catch {
				// Malformed or concurrently removed runtime artifacts are retried later.
			}
		}
		return reconciled;
	} catch {
		return [];
	}
}

function safeHistoryPathPart(value) {
	return (
		String(value ?? "session")
			.replace(/[^A-Za-z0-9._-]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 100) || "session"
	);
}

function jsonSafe(value) {
	const seen = new WeakSet();
	try {
		return JSON.parse(
			JSON.stringify(value, (_key, item) => {
				if (typeof item === "bigint") return item.toString();
				if (typeof item === "function" || typeof item === "symbol")
					return undefined;
				if (item instanceof Error)
					return { name: item.name, message: item.message, stack: item.stack };
				if (item && typeof item === "object") {
					if (seen.has(item)) return "[Circular]";
					seen.add(item);
				}
				return item;
			}),
		);
	} catch {
		return String(value);
	}
}

function selfImprovementHistoryEnabled(ctx) {
	if (process.env.WORK_ORCH_HISTORY_OFF === "1") return false;
	if (activeWorkGoal?.mode === "self-improving") return true;
	try {
		return workResumeSettings(
			ctx?.cwd ?? activeWorkAgent?.cwd ?? activeWorkGoalCwd,
		).selfImproving;
	} catch {
		return false;
	}
}

function historyTaskFromText(value) {
	const text = String(value ?? "");
	const labeled = text.match(
		/(?:Target WorkItem ID|Selected WorkItem|Target|WorkItem ID|workItem)\s*:\s*([^\s]+)/i,
	)?.[1];
	const workItemId = labeled && labeled !== "none" ? labeled : undefined;
	return {
		key:
			workItemId ??
			text.match(/\b[A-Za-z][A-Za-z0-9_.-]*-\d+\b/)?.[0] ??
			"session",
		workItemId,
	};
}

function selfImprovementHistoryTask(event) {
	const meta = activeWorkAgent?.meta ?? pendingWorkPrompt?.meta ?? {};
	const fallback = activeHistoryTask ?? historyTaskFromText(event?.prompt);
	const goal = activeWorkGoal;
	const key =
		meta.workItemId ??
		meta.epicId ??
		fallback.key ??
		(goal ? `${goal.mode}-${goal.id}` : "session");
	return {
		key,
		mode: meta.mode ?? goal?.mode,
		action: meta.action,
		epicId: meta.epicId,
		workItemId: meta.workItemId ?? fallback.workItemId,
		goalId: goal?.id,
		objective: goal?.objective,
	};
}

function recordSelfImprovementHistory(ctx, type, event = {}) {
	if (!selfImprovementHistoryEnabled(ctx)) return "";
	const cwd = ctx?.cwd ?? activeWorkAgent?.cwd ?? activeWorkGoalCwd;
	if (!cwd) return "";
	try {
		if (type === "before_agent_start")
			activeHistoryTask = historyTaskFromText(event.prompt);
		const task = selfImprovementHistoryTask(event);
		const sessionId = ctx?.sessionManager?.getSessionId?.() ?? "no-session";
		const file = join(
			telemetryDir(cwd),
			HISTORY_DIR_NAME,
			safeHistoryPathPart(task.key),
			`${safeHistoryPathPart(sessionId)}.jsonl`,
		);
		mkdirSync(dirname(file), { recursive: true });
		appendFileSync(
			file,
			`${JSON.stringify({
				version: 1,
				id: telemetryId("hist"),
				timestamp: new Date().toISOString(),
				type,
				cwd,
				sessionId,
				sessionFile: ctx?.sessionManager?.getSessionFile?.(),
				task,
				workflowRunId:
					activeWorkAgent?.meta?.workflowRunId ??
					pendingWorkPrompt?.meta?.workflowRunId ??
					currentCommandWorkflow()?.workflowRunId,
				activity:
					activeWorkAgent?.meta?.activity ??
					pendingWorkPrompt?.meta?.activity ??
					workflowActivityMarker(),
				event: jsonSafe(event),
			})}\n`,
		);
		return file;
	} catch {
		return "";
	}
}

function appendTelemetryNote(cwd, workItemId, event, file) {
	if (!workItemId || process.env.WORK_ORCH_TELEMETRY_NOTES !== "1") return;
	const parts = [
		`telemetry: run=${event.id} type=${event.type} phase=${event.phase ?? event.command ?? event.mode ?? "work"} duration=${formatDuration(event.durationMs ?? 0)}`,
	];
	if (event.usage?.totalTokens) parts.push(`tokens=${event.usage.totalTokens}`);
	if (event.context?.after?.tokens)
		parts.push(`context_after=${event.context.after.tokens}`);
	if (file) parts.push(`artifact=${file}`);
	try {
		appendWorkflowWorkItemNote(cwd, workItemId, parts.join(" "));
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
	const selected = line("Selected WorkItem") ?? "";
	const target = line("Target WorkItem ID") ?? line("Target") ?? "";
	const epicId = epic.match(/^([^\s]+)/)?.[1];
	const selectedId = selected.match(/^([^\s]+)/)?.[1];
	let workItemId;
	if (target && target !== "none") workItemId = target;
	else if (selectedId && !selectedId.startsWith("none"))
		workItemId = selectedId;
	const inlineLevel = text.match(
		/WO_INLINE_V1: complete this (small|medium)/,
	)?.[1];
	return {
		mode: text.match(/mode:\s*([^\s]+)/)?.[1],
		workflowRunId: line("Workflow Run ID"),
		activity: line("Activity"),
		action: line("Action"),
		epicId: epicId === "none" ? undefined : epicId,
		workItemId,
		inlineWork: Boolean(inlineLevel),
		inlineLevel,
		fastSmall: inlineLevel === "small",
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

function finalTextIndicatesRecoveredWork(text) {
	return /\b(Outcome:\s*PASS|Review:\s*PASS|Planning boundary complete|Done and pushed|Committed and pushed|Closed (?:WorkItem|planning WorkItem)|Created next ready WorkItem)\b/i.test(
		text,
	);
}

function hasWorkAgentFailure(event, telemetry) {
	const assistant = finalAssistantMessage(event.messages);
	const text = assistantVisibleText(assistant);
	const stopFailed = ["aborted", "error"].includes(
		String(assistant?.stopReason ?? ""),
	);
	const reviewFailed = telemetry.review?.outcome === "fail";
	const toolFailed = telemetry.tools?.some((tool) => tool.isError);
	const subagentFailed = failedSubagents(telemetry.tools).length > 0;
	const recoveredSubagentFailure =
		subagentFailed &&
		!stopFailed &&
		!reviewFailed &&
		!toolFailed &&
		finalTextIndicatesRecoveredWork(text);
	return Boolean(
		stopFailed ||
			reviewFailed ||
			toolFailed ||
			(subagentFailed && !recoveredSubagentFailure) ||
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
		run.meta.workItemId ? `next: /work-report ${run.meta.workItemId}` : "",
	];
	return lines.filter(Boolean).join("\n");
}

function appendFailureStatusNote(cwd, workItemId, run, event, telemetry, file) {
	if (!workItemId || !hasWorkAgentFailure(event, telemetry)) return;
	try {
		appendWorkflowWorkItemNote(
			cwd,
			workItemId,
			failureStatusNote(run, event, telemetry, file),
		);
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

function subagentTranscriptPath(result) {
	return [
		result?.transcriptPath,
		result?.artifactPaths?.transcriptPath,
		result?.artifacts?.transcriptPath,
		result?.paths?.transcriptPath,
		result?.sessionFile,
	].find((file) => file && existsSync(file));
}

function summarizeSubagentResult(result) {
	const transcriptPath = subagentTranscriptPath(result);
	const reconciled = transcriptPath
		? reconcileTranscriptTelemetry(transcriptPath)
		: undefined;
	const usage = reconciled?.usage ?? result.usage ?? result.tokens;
	return {
		agent: result.agent ?? "unknown",
		role: handoffRole(result.agent),
		status: subagentStatus(result),
		durationMs:
			reconciled?.durationMs ??
			result.durationMs ??
			result.progressSummary?.durationMs,
		toolCount:
			reconciled?.toolCalls ??
			result.toolCount ??
			result.progressSummary?.toolCount,
		model: result.model,
		tokens: subagentUsageTotal(usage),
		input: usage?.input ?? result.tokens?.input,
		output: usage?.output ?? result.tokens?.output,
		cacheRead: usage?.cacheRead,
		cacheWrite: usage?.cacheWrite,
		cost: usage?.cost ?? result.totalCost?.costUsd,
		turns: usage?.turns ?? result.turnCount,
		sessionFile: result.sessionFile,
		transcriptPath,
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
	if (/\bgit\b/.test(command)) return "state";
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

async function confirmDirtySelfImprovementSource(ctx) {
	if (
		!workResumeSettings(ctx.cwd).selfImproving ||
		ctx.mode === "print" ||
		ctx.mode === "json" ||
		ctx.hasUI === false ||
		typeof ctx.ui?.confirm !== "function"
	)
		return true;
	const sourceCwd = improvementStateCwd(ctx.cwd);
	const status = safeRun(sourceCwd, "git", [
		"status",
		"--porcelain=v1",
		"--untracked-files=all",
	]).trim();
	if (!status) return true;
	const files = status.split(/\r?\n/);
	const shown = files
		.slice(0, 8)
		.map((line) => line.slice(3))
		.join("\n");
	const remaining = files.length > 8 ? `\n…and ${files.length - 8} more` : "";
	return ctx.ui.confirm(
		"Self-improvement is blocked",
		`${sourceCwd} has uncommitted changes, so autonomous optimization will be deferred.\n\n${shown}${remaining}\n\nContinue this workflow without autonomous optimization?`,
	);
}

async function withCommandTelemetry(command, args, ctx, fn, note = false) {
	if (
		!commandWorkflowStorage.getStore() &&
		!(await confirmDirtySelfImprovementSource(ctx))
	)
		return;
	const workflow = {
		workflowRunId: telemetryId("workflow"),
		activity:
			process.env.WORK_ORCH_ACTIVITY_MARKER ??
			process.env.WORK_ORCH_ACTIVITY ??
			undefined,
	};
	return commandWorkflowStorage.run(workflow, async () => {
		const startedAt = Date.now();
		const contextBefore = usageSnapshot(ctx);
		reconcilePendingDirectRuns(ctx.cwd, {
			pi: workExtensionPi,
			mode: ctx.mode,
			session: ctx.sessionManager?.getSessionId?.(),
		});
		recordWorkTelemetry(ctx.cwd, {
			id: telemetryId("cmd-start"),
			type: "command-start",
			workflowRunId: workflow.workflowRunId,
			activity: workflow.activity,
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
				workflowRunId: workflow.workflowRunId,
				activity: workflow.activity,
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
				appendTelemetryNote(ctx.cwd, summary.workItemId, event, file);
			const awaitingAgent =
				Boolean(state?.handoffPrompt) &&
				!state?.handoffFailed &&
				(Boolean(state?.inlineWork) ||
					Boolean(state?.directHandoff) ||
					Boolean(state?.handoffPending) ||
					(!state?.directHandoff && !state?.handoffFailed));
			if (!awaitingAgent)
				completeWorkflowOnce(
					ctx.cwd,
					{
						workflowRunId: workflow.workflowRunId,
						activity: workflow.activity,
						outcome: event.ok ? "completed" : "failed",
						action: summary.action,
						epicId: summary.epicId,
						workItemId: summary.workItemId,
					},
					{
						pi: workExtensionPi,
						mode: ctx.mode,
						json: /(?:^|\s)--jsonl?(?:\s|$)/.test(String(args)),
						session: ctx.sessionManager?.getSessionId?.(),
					},
				);
			cleanupBenignInstructionDirt(ctx.cwd);
		}
	});
}

function readTelemetryEvents(cwd) {
	const dir = telemetryDir(cwd);
	if (!existsSync(dir)) return [];
	const files = readdirSync(dir)
		.filter((file) => file.endsWith(".jsonl"))
		.map((file) => join(dir, file));
	const claims = join(dir, "claims");
	if (existsSync(claims))
		files.push(
			...readdirSync(claims)
				.filter((file) => file.endsWith(".complete"))
				.map((file) => join(claims, file)),
		);
	return files.flatMap((file) =>
		readFileSync(file, "utf8")
			.split(/\r?\n/)
			.filter(Boolean)
			.map((line) => {
				try {
					return { ...JSON.parse(line), file };
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
	if (scope === "workItem" || scope === "task")
		return event.workItemId === value || event.meta?.workItemId === value;
	if (scope.includes("-"))
		return (
			event.epicId === scope ||
			event.workItemId === scope ||
			event.meta?.epicId === scope ||
			event.meta?.workItemId === scope
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
		workflowRunId: event.workflowRunId,
		activity: event.activity,
		terminal: event.terminal,
		outcome: event.outcome,
		command: event.command,
		mode: event.mode,
		action: event.action,
		role: event.role,
		stopReason: event.stopReason,
		handoff: event.handoff,
		epicId: event.epicId,
		workItemId: event.workItemId ?? event.meta?.workItemId,
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
	const byWorkItem = new Map();
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
		const reconciledUsage = event.telemetry?.reconciled?.usage;
		totals.tokens += Number(
			reconciledUsage?.totalTokens ?? event.usage?.totalTokens ?? 0,
		);
		totals.input += Number(reconciledUsage?.input ?? event.usage?.input ?? 0);
		totals.output += Number(
			reconciledUsage?.output ?? event.usage?.output ?? 0,
		);
		totals.cost += Number(reconciledUsage?.cost ?? event.usage?.cost ?? 0);
		totals.messageChars += Number(
			event.messages?.chars ?? event.outputChars ?? 0,
		);
		totals.toolOutputChars += Number(
			event.telemetry?.reconciled?.toolOutputChars ??
				(event.tools ?? []).reduce(
					(sum, tool) => sum + Number(tool.outputChars ?? 0),
					0,
				),
		);
		totals.toolCalls += Number(
			event.telemetry?.reconciled?.toolCalls ?? (event.tools ?? []).length,
		);
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
		const workItem = event.workItemId ?? event.meta?.workItemId;
		if (workItem) addMetric(byWorkItem, workItem, event);
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
		byWorkItem: [...byWorkItem.values()].sort(
			(a, b) => b.durationMs - a.durationMs,
		),
		outputWaste: optimizationTelemetry(events),
		improvement: improvementStatus(cwd),
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
		`Self-improvement: ${state.improvement.state} • candidates ${state.improvement.candidates} • evidence ${state.improvement.evidenceCount ?? 0}${state.improvement.candidateId ? ` • current ${state.improvement.candidateId}` : ""}${state.improvement.attemptId ? ` • attempt ${state.improvement.attemptId}` : ""}${state.improvement.manualRecoveryReason ? ` • manual ${state.improvement.manualRecoveryReason}` : ""}${state.improvement.benchmarkMeasurements ? ` • benchmark ${truncate(JSON.stringify(state.improvement.benchmarkMeasurements), 180)}` : ""}${state.improvement.resultMeasurements ? ` • result ${truncate(JSON.stringify(state.improvement.resultMeasurements), 180)}` : ""}`,
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
		"By WorkItem:",
		...renderMetricRows(state.byWorkItem),
		"",
		"Output waste:",
		...(state.outputWaste?.largeOutputs?.length
			? state.outputWaste.largeOutputs.map(
					(row) => `- ${row.commandSignature}: ${row.outputChars} chars`,
				)
			: ["- none"]),
		...(state.outputWaste?.recommendations?.length
			? state.outputWaste.recommendations.map((item) => `  next: ${item}`)
			: []),
		"",
		"Slowest:",
		...(state.slowest.length
			? state.slowest.map((event) =>
					`- ${event.id} ${event.type}/${event.command ?? event.mode ?? "agent"}/${event.action ?? ""}: ${formatDuration(event.durationMs)} ${event.workItemId ?? event.meta?.workItemId ?? ""}`.trim(),
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
	const scope = meta.workItemId
		? `workItem ${meta.workItemId}`
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
				task: event.workItemId ?? event.meta?.workItemId ?? "unknown",
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
<div class="cards"><div class="card"><b>${state.summary.events}</b><span>events</span></div><div class="card"><b>${escapeHtml(formatDuration(state.summary.durationMs))}</b><span>time</span></div><div class="card"><b>${escapeHtml(state.summary.tokens || "unknown")}</b><span>tokens</span></div><div class="card"><b>${escapeHtml(formatCounts(state.summary.subagents))}</b><span>subagents</span></div><div class="card"><b>${escapeHtml(formatCounts(state.summary.tools))}</b><span>tools</span></div><div class="card"><b>${escapeHtml(state.summary.improvement.state)}</b><span>self-improvement (${state.summary.improvement.candidates} candidates)${state.summary.improvement.attemptId ? ` · attempt ${escapeHtml(state.summary.improvement.attemptId)}` : ""}${state.summary.improvement.manualRecoveryReason ? ` · manual ${escapeHtml(state.summary.improvement.manualRecoveryReason)}` : ""}${state.summary.improvement.benchmarkMeasurements ? ` · benchmark ${escapeHtml(truncate(JSON.stringify(state.summary.improvement.benchmarkMeasurements), 180))}` : ""}${state.summary.improvement.resultMeasurements ? ` · result ${escapeHtml(truncate(JSON.stringify(state.summary.improvement.resultMeasurements), 180))}` : ""}</span></div></div>
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
		summary: {
			...usageSummary(events, rows),
			improvement: improvementStatus(cwd),
		},
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

function workOrchBlock(settings) {
	settings.workOrchestrator ??= {};
	return settings.workOrchestrator;
}

function workOrchSettings(cwd) {
	const raw = readSettings(cwd).workOrchestrator ?? {};
	const profile = EFFORT_PROFILES[raw.profile] ? raw.profile : DEFAULT_PROFILE;
	const base = EFFORT_PROFILES[profile];
	const critic = {
		brainstorm: raw.critic?.brainstorm ?? base.critic.brainstorm,
		plan: raw.critic?.plan ?? base.critic.plan,
	};
	const flags = {};
	for (const { key } of WORK_ORCH_BOOLEANS) flags[key] = raw[key] ?? base[key];
	const slicePlanCeDepth = raw.slicePlanCeDepth ?? base.slicePlanCeDepth;
	const codeReviewBeforeCommit =
		raw.codeReviewBeforeCommit ?? base.codeReviewBeforeCommit;
	const sliceExecutionMode =
		raw.sliceExecutionMode === "agent" ? "agent" : "inline";
	return {
		profile,
		critic,
		slicePlanCeDepth,
		codeReviewBeforeCommit,
		sliceExecutionMode,
		...flags,
	};
}

function applyProfile(settings, profileKey) {
	const profile = EFFORT_PROFILES[profileKey];
	if (!profile) return false;
	for (const slot of SLOTS) {
		const thinking = profile[slot.key];
		if (!thinking) continue;
		const current = overrides(settings);
		for (const agent of slot.agents) {
			const next = { ...(current[agent] ?? {}) };
			next.thinking = thinking;
			current[agent] = next;
		}
	}
	compactOverrides(settings);
	const block = workOrchBlock(settings);
	block.profile = profileKey;
	block.critic = { ...profile.critic };
	for (const { key } of WORK_ORCH_BOOLEANS) block[key] = profile[key];
	block.slicePlanCeDepth = profile.slicePlanCeDepth;
	block.codeReviewBeforeCommit = profile.codeReviewBeforeCommit;
	return true;
}

function setWorkOrchBoolean(settings, key, value) {
	const block = workOrchBlock(settings);
	block[key] = Boolean(value);
}

function setWorkOrchReviewLevel(settings, value) {
	const block = workOrchBlock(settings);
	block.codeReviewBeforeCommit = REVIEW_LEVELS.includes(value) ? value : "off";
}

function setWorkOrchSliceExecution(settings, value) {
	const block = workOrchBlock(settings);
	block.sliceExecutionMode = value === "agent" ? "agent" : "inline";
}

function setWorkOrchCritic(settings, key, value) {
	const block = workOrchBlock(settings);
	block.critic ??= {};
	block.critic[key] = Boolean(value);
}

function setWorkResumeBoolean(settings, key, value) {
	settings.workResume ??= {};
	settings.workResume[key] = Boolean(value);
}

// ponytail: settings are prompt-live; the steps below are appended to the
// role/plan/brainstorm/finish handoff prompts so the advisor actually runs.
function advisorFallbackText() {
	return "If work-advisor is unavailable, usage-limited, or fails to start, run work-advisor-backup once instead; do not wait or retry the primary.";
}

function advisorCriticStep(target) {
	return [
		`Advisor critic gate (read-only): launch the work-advisor subagent (agent: "work-advisor", context: fresh) on the ${target} to hunt weak or missing requirements, unverified acceptance, incomplete decisions, ambiguous scope, and untested assumptions. ${advisorFallbackText()} Record concrete findings as notes on the relevant WorkItem; convert any blocking gap into a decision/blocker WorkItem under the epic before proceeding. Skip if the ${target} is trivial and obviously complete.`,
	].join("\n");
}

function advisorVerifyStep() {
	return [
		"Coded task-verification checklist: once a slice is implemented and self-verified but before finish, compare the WorkItem notes/diff against the epic plan's acceptance and implementation unit yourself. Append a compact WorkItem note headed `wo:verify-check` with: plan match, acceptance covered, verification command/proof, known gaps/waivers. Do not launch work-advisor unless the plan or evidence is ambiguous after this checklist.",
	].join("\n");
}

function hasSlicePlan(issue) {
	return (
		labelsOf(issue).includes("wo:slice-planned") ||
		/wo:slice-plan|slice plan/i.test(notesOf(issue))
	);
}

function issueRefText(issue) {
	const summary = issueRef(issue);
	return (
		[summary.id, summary.title].filter(Boolean).join(" — ") ||
		"unknown WorkItem"
	);
}

function needsPlannerAgent(issue, state) {
	const text = [notesOf(issue), issue?.description, issue?.acceptance].join(
		"\n",
	);
	return text.length > 4_000 || (state?.executableSlices?.length ?? 0) > 12;
}

function inlineSlicePlanNote(issue, state, cwd) {
	const plan = state.planPath ? relative(cwd, state.planPath) : "none linked";
	return [
		"wo:slice-plan",
		`plan-path: ${plan}`,
		`target: ${issueRefText(issue)}`,
		"approach: implement the WorkItem's acceptance with the smallest localized diff; reuse existing helpers before adding code.",
		"likely files: derive from the WorkItem notes/design before editing; do not broaden scope.",
		"verification: run the WorkItem's named check, or the smallest focused command that proves the acceptance.",
		"risks/out-of-scope: create a blocker WorkItem instead of guessing when acceptance, hardware/live proof, or ownership is unclear.",
	].join("\n");
}

function applyInlineSlicePlan(cwd, state, issue) {
	try {
		const plan = inlineSlicePlanNote(issue, state, cwd);
		appendWorkflowWorkItemNote(cwd, idOf(issue), plan);
		const planned = {
			...issue,
			labels: [...new Set([...labelsOf(issue), "wo:slice-planned"])],
			notes: `${notesOf(issue)}\n${plan}`,
		};
		return withHandoffPrompt(
			withImplementationPolicy(
				{
					...state,
					action: "run-implementation",
					selectedWorkItem: issueSummary(planned),
					message:
						"Added coded slice-plan note and continued directly to implementation; no planner boundary needed.",
				},
				cwd,
			),
			cwd,
		);
	} catch (error) {
		return errorState(
			"slice-plan-failed",
			commandErrorText(error) || error.message,
			{
				...state,
				action: "slice-plan-stop",
				selectedWorkItem: issueSummary(issue),
			},
		);
	}
}

function cePlanSliceStep(issue, cwd, masterPlanPath, depth = "Lightweight") {
	const scopeLine = masterPlanPath
		? `Scope: this WorkItem's acceptance/design plus the matching Implementation Unit from ${relative(cwd, masterPlanPath)}.`
		: `Scope: this WorkItem's acceptance/design and notes.`;
	const depthLine =
		depth === "Deep"
			? "Use Deep depth for the full ce-plan research/deepening pass."
			: depth === "Standard"
				? "Use Standard depth (ce-plan's normal tier) so flow analysis runs without Deep extensions."
				: "Use Lightweight depth so ce-plan skips flow analysis and external research when local patterns are strong.";
	return [
		`Slice-planning pass (ce-plan) before implementation: target ${issueRefText(issue)} already exists as executable work. Do not create child native work-item store and do not dispatch work-planner.`,
		scopeLine,
		`Invoke the ce-plan skill in the control session on this slice to produce a compact plan doc at docs/plans/YYYY-MM-DD-NNN-slice-${safeArtifactPart(idOf(issue))}-plan.md with a single Implementation Unit (Goal, Files, Approach, Test scenarios, Verification). ${depthLine}`,
		`Then append a WorkItem note headed \`wo:slice-plan\` containing \`plan-path: <repo-relative plan doc path>\`, add label \`wo:slice-planned\`, and stop. Implementation happens on the next /work-resume; the worker executes the plan doc, not the WorkItem title.`,
	].join("\n");
}

function codeReviewBeforeCommitStep(level) {
	if (level === "light")
		return "Pre-commit review gate (light): before committing, launch exactly one work-reviewer on the scoped slice diff and persist its PASS evidence, then commit and close the WorkItem. If it reports blocking findings, run one work-fixer pass and re-review; never skip review silently.";
	return "Pre-commit code-review gate: before committing, run the full ce-code-review skill on the current diff for this slice. Resolve any blocking findings (or record an explicit user waiver) before the committer commits and closes the WorkItem.";
}

function simplifyBeforeReviewStep() {
	return [
		"Simplify-before-review gate: after a real implementation diff is self-verified, inspect the scoped diff directly and remove obvious duplication, dead flexibility, or an unnecessary abstraction. Launch ce-simplify-code only when that direct pass finds a non-trivial cleanup requiring separate judgment; otherwise no-op. Keep behavior and scope.",
	].join("\n");
}

function browserTestsOnUiDiffStep() {
	return [
		`UI-diff browser-test gate: before committing, if the related dirty files touch a runnable web frontend surface (routes/pages/components/styles — e.g. *.tsx, *.jsx, *.vue, *.svelte, *.html, *.css, *.scss under app/, src/app/, pages/, routes/, components/, views/), run the ce-test-browser skill on the affected pages and resolve blocking failures (or record an evidence-only user waiver) before commit. Skip when the diff is backend/CLI/docs-only or the project has no runnable web frontend.`,
	].join("\n");
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

function thinkingItemsFor(slot, settings) {
	const current = settings.subagents?.agentOverrides ?? {};
	const selectedThinking = commonValue(
		slot.agents.map((agent) => current[agent]?.thinking),
	);
	return {
		selectedThinking,
		items: [
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
		],
	};
}

function matchesModelQuery(item, query) {
	const needle = query.trim().toLowerCase();
	return (
		!needle ||
		[item.value, item.label, item.description]
			.filter(Boolean)
			.some((value) => String(value).toLowerCase().includes(needle))
	);
}

async function chooseModel(ctx, title, currentModel = INHERIT_MODEL) {
	const items = await modelItems(ctx);
	const currentText =
		currentModel === INHERIT_MODEL
			? `inherit (${items[0]?.description ?? "control-session model"})`
			: currentModel;
	if ((ctx.mode && ctx.mode !== "tui") || typeof ctx.ui.custom !== "function") {
		return choose(
			ctx,
			title,
			items.map((item) =>
				item.value === currentModel
					? { ...item, label: `${item.label} (current)` }
					: item,
			),
		);
	}

	return ctx.ui.custom((tui, theme, keybindings, done) => {
		let query = "";
		let filtered = items;
		let selectedIndex = Math.max(
			0,
			items.findIndex((item) => item.value === currentModel),
		);
		const applyFilter = () => {
			filtered = items.filter((item) => matchesModelQuery(item, query));
			selectedIndex = 0;
		};

		return {
			render(width) {
				const lines = [
					theme.fg("accent", theme.bold(title)),
					theme.fg("dim", fitUiLine(`Current: ${currentText}`, width)),
					fitUiLine(`Search: ${query}▌`, width),
					"",
				];
				if (filtered.length === 0) {
					lines.push(theme.fg("warning", "  No matching models"));
				} else {
					const visible = Math.min(filtered.length, 10);
					const start = Math.max(
						0,
						Math.min(
							selectedIndex - Math.floor(visible / 2),
							filtered.length - visible,
						),
					);
					for (let index = start; index < start + visible; index += 1) {
						const item = filtered[index];
						const current = item.value === currentModel ? "  (current)" : "";
						const description = item.description ? `  ${item.description}` : "";
						const line = fitUiLine(
							`${index === selectedIndex ? "> " : "  "}${item.label}${current}${description}`,
							width,
						);
						lines.push(
							index === selectedIndex
								? theme.fg("accent", line)
								: item.value === currentModel
									? theme.fg("success", line)
									: line,
						);
					}
					if (filtered.length > visible)
						lines.push(
							theme.fg("dim", `  (${selectedIndex + 1}/${filtered.length})`),
						);
				}
				lines.push(
					"",
					theme.fg(
						"dim",
						fitUiLine(
							"  Type to filter · ↑↓ navigate · Enter select · Esc cancel",
							width,
						),
					),
				);
				return lines;
			},
			handleInput(data) {
				if (keybindings.matches(data, "tui.select.up")) {
					if (filtered.length)
						selectedIndex =
							(selectedIndex - 1 + filtered.length) % filtered.length;
				} else if (keybindings.matches(data, "tui.select.down")) {
					if (filtered.length)
						selectedIndex = (selectedIndex + 1) % filtered.length;
				} else if (keybindings.matches(data, "tui.select.confirm")) {
					if (filtered[selectedIndex]) done(filtered[selectedIndex].value);
					return;
				} else if (keybindings.matches(data, "tui.select.cancel")) {
					done(undefined);
					return;
				} else if (
					keybindings.matches(data, "tui.editor.deleteCharBackward") ||
					data === "\b" ||
					data === "\x7f"
				) {
					query = [...query].slice(0, -1).join("");
					applyFilter();
				} else if (keybindings.matches(data, "tui.editor.deleteToLineStart")) {
					query = "";
					applyFilter();
				} else {
					const text = data
						.replace(/^\x1b\[200~/, "")
						.replace(/\x1b\[201~$/, "");
					if (!text || /[\x00-\x1f\x7f]/u.test(text)) return;
					query += text;
					applyFilter();
				}
				tui.requestRender();
			},
			invalidate() {},
		};
	});
}

async function editSlotModel(ctx, settings, slot) {
	const currentModel =
		overrides(settings)[slot.agents[0]]?.model ?? INHERIT_MODEL;
	const model = await chooseModel(
		ctx,
		`${slot.label}: choose model`,
		currentModel,
	);
	if (model === undefined) return false;
	const { selectedThinking, items } = thinkingItemsFor(slot, settings);
	const thinking = await choose(
		ctx,
		`${slot.label}: choose effort${selectedThinking ? ` (current ${selectedThinking})` : ""}`,
		items,
	);
	if (thinking === undefined) return false;
	setSlot(settings, slot, model, thinking);
	writeSettings(ctx.cwd, settings);
	ctx.ui.notify(`Saved ${slot.label}: ${slotSummary(slot, settings)}`, "info");
	return true;
}

function truncate(value, max = 800) {
	const text = String(value ?? "")
		.replace(/\s+/g, " ")
		.trim();
	return text.length > max ? `${text.slice(0, max)}…` : text;
}

function compactWorkItemTitle(value) {
	return truncate(value, WORK_ITEM_TITLE_MAX);
}

function appendOriginalWorkItemTitle(notes, originalTitle) {
	const title = String(originalTitle ?? "").trim();
	if (
		title.length <= WORK_ITEM_TITLE_MAX ||
		String(notes ?? "").includes(title)
	)
		return notes;
	return [notes, `Full title/request:\n${title}`].filter(Boolean).join("\n\n");
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
		"Assistant reasoning and full tool results were intentionally dropped; native work-item store, git, and files are the source of truth.",
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
		"\n## Next recovery step\nRun `/work-status` or `node scripts/work-helper.mjs work-ready-summary`, then continue with `/work-resume`.",
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
		customInstructions: `work-orchestrator proactive ${reason}: preserve goals, native work-item store/git state, file changes, blockers, and next command; omit reasoning and full tool logs.`,
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

function run(cwd, command, args) {
	const override =
		command === "git" ? process.env.WORK_ORCH_GIT_BIN : undefined;
	const script = nodeScript(override) ? override : undefined;
	return execFileSync(
		script ? process.execPath : (override ?? command),
		script ? [script, ...args] : args,
		{
			cwd,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		},
	).trimEnd();
}

const LARGE_OUTPUT_THRESHOLD = 10_000;
const BOUNDED_OUTPUT_CAP = 10_000;
const TASK_RAW_THRESHOLD = 10_000;

function artifactPath(cwd, group, prefix, ext = "txt") {
	const dir = join(telemetryDir(cwd), group);
	mkdirSync(dir, { recursive: true });
	return join(
		dir,
		`${safeHistoryPathPart(prefix)}-${telemetryId("art")}.${ext}`,
	);
}

function writeArtifact(cwd, group, prefix, ext, content) {
	const file = artifactPath(cwd, group, prefix, ext);
	writeFileSync(file, String(content ?? ""));
	return file;
}

function textHeadTail(value, cap = BOUNDED_OUTPUT_CAP) {
	const text = String(value ?? "");
	if (text.length <= cap) return text;
	const half = Math.max(500, Math.floor((cap - 80) / 2));
	return `${text.slice(0, half)}\n… truncated ${text.length - half * 2} chars …\n${text.slice(-half)}`;
}

function commandSignature(command, args = []) {
	const parts = [command, ...args].map((part) =>
		String(part ?? "")
			.replace(/\b[A-Z]{2,}-\d+\b/g, "<task>")
			.replace(/[a-f0-9]{7,40}/gi, "<hash>")
			.replace(/(['"]).{80,}\1/g, "<long-string>")
			.replace(/\s+/g, " ")
			.trim(),
	);
	return parts.filter(Boolean).join(" ");
}

function runBounded(cwd, command, args = [], options = {}) {
	const override =
		command === "git" ? process.env.WORK_ORCH_GIT_BIN : undefined;
	const script = nodeScript(override) ? override : undefined;
	const actualCommand = script ? process.execPath : (override ?? command);
	const actualArgs = script ? [script, ...args] : args;
	let stdout = "";
	let stderr = "";
	let exitCode = 0;
	const started = Date.now();
	try {
		stdout = execFileSync(actualCommand, actualArgs, {
			cwd,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});
	} catch (error) {
		exitCode = Number(error.status ?? 1);
		stdout = String(error.stdout ?? "");
		stderr = String(error.stderr ?? error.message ?? "");
	}
	const prefix = options.name ?? commandSignature(command, args).slice(0, 80);
	const fullStdoutPath = writeArtifact(
		cwd,
		"logs",
		`${prefix}-stdout`,
		"txt",
		stdout,
	);
	const fullStderrPath = writeArtifact(
		cwd,
		"logs",
		`${prefix}-stderr`,
		"txt",
		stderr,
	);
	const cap = Number(options.cap ?? BOUNDED_OUTPUT_CAP);
	const result = {
		command: commandSignature(command, args),
		exit_code: exitCode,
		duration_ms: Math.max(0, Date.now() - started),
		stdout_chars: stdout.length,
		stderr_chars: stderr.length,
		stdout_summary: textHeadTail(stdout, cap),
		stderr_summary: textHeadTail(stderr, cap),
		truncated: stdout.length > cap || stderr.length > cap,
		full_stdout_path: fullStdoutPath,
		full_stderr_path: fullStderrPath,
	};
	if (result.truncated)
		recordWorkTelemetry(cwd, {
			type: "large-output",
			command: result.command,
			ok: exitCode === 0,
			outputChars: stdout.length + stderr.length,
			threshold: cap,
			artifacts: [fullStdoutPath, fullStderrPath],
		});
	return result;
}

function compactTaskSummary(issue, options = {}) {
	const notes = notesOf(issue);
	const acceptance = String(
		issue?.acceptance ?? issue?.acceptance_criteria ?? issue?.criteria ?? "",
	);
	const notesCap = Number(options.notesTail ?? 2_000);
	const acceptanceCap = Number(options.acceptanceTail ?? 1_500);
	return {
		id: idOf(issue),
		title: titleOf(issue),
		status: statusOf(issue),
		issue_type: typeOf(issue),
		priority: issue?.priority,
		assignee: issue?.assignee,
		labels: labelsOf(issue),
		parent: parentOf(issue),
		dependencies: depsOf(issue).map((id) => ({ id, blocking: true })),
		dependents: asArray(issue?.dependents).map((item) => ({
			id: idOf(item) || item?.id,
			status: statusOf(item),
			type: item?.type,
		})),
		created_at: createdAt(issue),
		updated_at: updatedAt(issue),
		closed_at: issue?.closed_at ?? issue?.closedAt,
		close_reason: issue?.close_reason ?? issue?.closeReason,
		notes_tail: notes.slice(-notesCap),
		acceptance_criteria_tail: acceptance.slice(-acceptanceCap),
	};
}

function workflowTaskSummary(cwd, taskId, options = {}) {
	const issue = readWorkItem(cwd, taskId);
	const raw = JSON.stringify(issue, null, "\t");
	const summary = compactTaskSummary(issue, options);
	if (options.full || raw.length > TASK_RAW_THRESHOLD) {
		summary.raw_artifact_path = writeArtifact(
			cwd,
			"tasks",
			taskId,
			"json",
			raw,
		);
		if (raw.length > TASK_RAW_THRESHOLD)
			recordWorkTelemetry(cwd, {
				type: "large-task-read",
				workItemId: taskId,
				ok: true,
				outputChars: raw.length,
				threshold: TASK_RAW_THRESHOLD,
				artifact: summary.raw_artifact_path,
			});
	}
	return summary;
}

function changedFilesSummary(cwd) {
	const rows = parsePorcelainStatus(
		run(cwd, "git", ["status", "--porcelain=v1", "--untracked-files=all"]),
	);
	const changedFiles = rows.map((item) => item.path);
	const fullDiffPath = writeArtifact(
		cwd,
		"logs",
		"git-diff",
		"patch",
		safeRun(cwd, "git", ["diff", "--", ...changedFiles]) || "",
	);
	return {
		status: "PASS",
		changed_files: changedFiles,
		full_diff_path: fullDiffPath,
	};
}

function stagedFilesSummary(cwd) {
	const staged = run(cwd, "git", ["diff", "--cached", "--name-only"])
		.split(/\r?\n/)
		.filter(Boolean);
	return { status: "PASS", staged_files: staged };
}

function patternToRegex(pattern) {
	const escaped = String(pattern)
		.replace(/[.+^${}()|[\]\\]/g, "\\$&")
		.replace(/\*/g, ".*");
	return new RegExp(`^${escaped}$`);
}

function onlyAllowedFilesChanged(cwd, allowPatterns = []) {
	const changed = changedFilesSummary(cwd);
	const tests = allowPatterns.map(patternToRegex);
	const unexpected = changed.changed_files.filter(
		(file) => !tests.some((test) => test.test(normalizedRepoPath(file))),
	);
	return {
		...changed,
		status: unexpected.length ? "FAIL" : "PASS",
		unexpected_files: unexpected,
	};
}

function jsonlRecords(path, ids = []) {
	const wanted = new Set(ids.map(String));
	return readFileSync(path, "utf8")
		.split(/\r?\n/)
		.filter(Boolean)
		.flatMap((line) => {
			try {
				return [JSON.parse(line)];
			} catch {
				return [];
			}
		})
		.filter((record) => !wanted.size || wanted.has(String(record.id)));
}

function jsonlRecordSummary(path, ids = []) {
	const records = Object.fromEntries(
		jsonlRecords(path, ids).map((record) => [
			record.id,
			{
				status: record.status,
				labels: record.labels ?? [],
				dependency_ids: depsOf(record),
				updated_at: record.updated_at,
			},
		]),
	);
	return { status: "PASS", path, records };
}

function jsonlRecordDiff(path, ids = [], baselinePath) {
	const current = jsonlRecordSummary(path, ids).records;
	const baseline =
		baselinePath && existsSync(baselinePath)
			? jsonlRecordSummary(baselinePath, ids).records
			: {};
	const records = {};
	for (const [id, record] of Object.entries(current)) {
		const before = baseline[id] ?? {};
		records[id] = {
			...record,
			changed_fields: Object.keys(record).filter(
				(key) => JSON.stringify(record[key]) !== JSON.stringify(before[key]),
			),
		};
	}
	return { status: "PASS", path, records };
}

function forbiddenPatternCheck(paths, patterns) {
	const regexes = patterns.map((pattern) => new RegExp(pattern));
	const failures = [];
	for (const file of paths) {
		const text = readFileSync(file, "utf8");
		for (const regex of regexes)
			if (regex.test(text))
				failures.push({ path: file, pattern: String(regex) });
	}
	return { status: failures.length ? "FAIL" : "PASS", failures };
}

function runTempCheck(cwd, name, script, inputs = {}, options = {}) {
	const dir = join(telemetryDir(cwd), "checks");
	mkdirSync(dir, { recursive: true });
	const prefix = safeHistoryPathPart(name);
	const scriptPath = join(dir, `${prefix}-${telemetryId("check")}.mjs`);
	const inputPath = join(dir, `${prefix}-inputs.json`);
	writeFileSync(scriptPath, script);
	writeFileSync(inputPath, JSON.stringify(inputs, null, "\t"));
	const result = runBounded(cwd, process.execPath, [scriptPath, inputPath], {
		name: `${prefix}-check`,
		cap: options.cap ?? 4_000,
	});
	let parsed;
	try {
		parsed = JSON.parse(result.stdout_summary);
	} catch {
		parsed = { summary: result.stdout_summary };
	}
	return {
		name,
		status: result.exit_code === 0 ? (parsed.status ?? "PASS") : "FAIL",
		exit_code: result.exit_code,
		duration_ms: result.duration_ms,
		summary: parsed.summary ?? result.stderr_summary,
		key_values: parsed.key_values ?? {},
		failed_assertions: parsed.failed_assertions ?? [],
		full_log_path: result.full_stdout_path,
		script_path: scriptPath,
	};
}

function searchSummary(cwd, query, paths = ["."], options = {}) {
	const max = String(options.max ?? 20);
	const result = runBounded(cwd, "rg", ["-n", "-m", max, query, ...paths], {
		name: `search-${query}`,
		cap: options.cap ?? 4_000,
	});
	const matches = result.stdout_summary.split(/\r?\n/).filter(Boolean);
	const files = [...new Set(matches.map((line) => line.split(":")[0]))];
	return {
		query,
		searched_paths: paths,
		matching_file_count: files.length,
		match_count: matches.length,
		top_matches: matches.slice(0, Number(max)),
		suggested_next_files: files.slice(0, 10),
		full_raw_search_log_path: result.full_stdout_path,
	};
}

function prepareTaskExportForGate(cwd, taskIds = []) {
	const changed = changedFilesSummary(cwd);
	const staged = stagedFilesSummary(cwd);
	let store;
	try {
		store = loadStore(cwd);
	} catch (error) {
		return {
			status: "SKIP",
			exported_path: storePath(cwd),
			changed_files: changed.changed_files,
			staged_files: staged.staged_files,
			summary: error.message,
		};
	}
	const missing = taskIds.filter((id) => !store.items[id]);
	return {
		status: missing.length ? "FAIL" : "PASS",
		exported_path: storePath(cwd),
		consistency_status: missing.length ? "FAIL" : "PASS",
		missing_ids: missing,
		changed_files: changed.changed_files,
		staged_files: staged.staged_files,
		summary: missing.length
			? `Missing native work items: ${missing.join(", ")}`
			: `Native store covers ${taskIds.length} work item(s).`,
	};
}

function evidenceSummaryPath(cwd, runId) {
	return join(
		telemetryDir(cwd),
		"evidence",
		`${safeHistoryPathPart(runId)}-summary.json`,
	);
}

function writeEvidenceSummary(cwd, summary) {
	const runId = summary.run_id ?? telemetryId("run");
	const file = evidenceSummaryPath(cwd, runId);
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(
		file,
		JSON.stringify({ ...summary, run_id: runId }, null, "\t"),
	);
	return file;
}

function readEvidenceSummary(cwd, runId) {
	const file = evidenceSummaryPath(cwd, runId);
	if (!existsSync(file)) return undefined;
	try {
		return JSON.parse(readFileSync(file, "utf8"));
	} catch {
		return undefined;
	}
}

function transcriptText(value) {
	if (typeof value === "string") return value;
	return JSON.stringify(value ?? "");
}

function reconcileTranscriptTelemetry(path) {
	const out = {
		assistantTurns: 0,
		userTurns: 0,
		toolCalls: 0,
		toolResults: 0,
		toolErrors: 0,
		perToolCounts: {},
		toolOutputChars: 0,
		maxToolOutputChars: 0,
		repeatedCommandSignatures: [],
		usage: {
			totalTokens: 0,
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			cost: 0,
		},
		firstTimestamp: undefined,
		lastTimestamp: undefined,
		durationMs: undefined,
	};
	const repeats = new Map();
	const rememberCall = (call) => {
		const name = call.name ?? call.function?.name ?? "tool";
		out.toolCalls += 1;
		out.perToolCounts[name] = (out.perToolCounts[name] ?? 0) + 1;
		const sig = commandSignature(name, [call.args ?? call.arguments ?? ""]);
		repeats.set(sig, (repeats.get(sig) ?? 0) + 1);
	};
	for (const line of readFileSync(path, "utf8")
		.split(/\r?\n/)
		.filter(Boolean)) {
		let row;
		try {
			row = JSON.parse(line);
		} catch {
			continue;
		}
		const role = row.role ?? row.message?.role ?? row.type;
		if (role === "assistant") out.assistantTurns += 1;
		if (role === "user") out.userTurns += 1;
		const contentCalls = asArray(row.message?.content ?? row.content).flatMap(
			(item) =>
				item?.type === "toolCall"
					? [
							{
								name: item.name,
								arguments: item.arguments ?? item.input ?? item.args,
							},
						]
					: [],
		);
		const calls = [
			...asArray(row.toolCalls),
			...asArray(row.tool_calls),
			...asArray(row.message?.toolCalls),
			...asArray(row.message?.tool_calls),
			...contentCalls,
		];
		for (const call of calls) rememberCall(call);
		if (
			role === "toolResult" ||
			/tool.*result|result.*tool/.test(String(row.type ?? "")) ||
			row.toolResult
		) {
			out.toolResults += 1;
			const chars = transcriptText(
				row.text ?? row.result ?? row.toolResult ?? row.content,
			).length;
			out.toolOutputChars += chars;
			out.maxToolOutputChars = Math.max(out.maxToolOutputChars, chars);
			if (row.isError || row.error) out.toolErrors += 1;
		}
		const usage = row.usage ?? row.message?.usage;
		if (usage) {
			out.usage.totalTokens += Number(
				usage.totalTokens ?? usage.total_tokens ?? 0,
			);
			out.usage.input += Number(usage.input ?? usage.input_tokens ?? 0);
			out.usage.output += Number(usage.output ?? usage.output_tokens ?? 0);
			out.usage.cacheRead += Number(usage.cacheRead ?? usage.cache_read ?? 0);
			out.usage.cacheWrite += Number(
				usage.cacheWrite ?? usage.cache_write ?? 0,
			);
			out.usage.cost += Number(usage.cost ?? 0);
		}
		const timestamp = row.timestamp ?? row.time;
		if (timestamp) {
			out.firstTimestamp ??= timestamp;
			out.lastTimestamp = timestamp;
		}
	}
	const first = Date.parse(out.firstTimestamp ?? "");
	const last = Date.parse(out.lastTimestamp ?? "");
	if (Number.isFinite(first) && Number.isFinite(last))
		out.durationMs = Math.max(0, last - first);
	out.usage.turns = out.assistantTurns;
	out.repeatedCommandSignatures = [...repeats.entries()]
		.filter(([, count]) => count > 1)
		.map(([signature, count]) => ({ signature, count }));
	return out;
}

function telemetryWithTranscript(event) {
	if (!event.transcriptPath || !existsSync(event.transcriptPath)) return event;
	try {
		const reconciled = reconcileTranscriptTelemetry(event.transcriptPath);
		const live = {
			toolCount: (event.tools ?? []).length,
			assistantTurns:
				event.messages?.assistantTurns ?? event.messages?.assistant ?? 0,
		};
		const mismatchFields = [];
		if (live.toolCount !== reconciled.toolCalls)
			mismatchFields.push("toolCount");
		if (live.assistantTurns !== reconciled.assistantTurns)
			mismatchFields.push("assistantTurns");
		const hasUsage = Object.entries(reconciled.usage).some(
			([key, value]) => key !== "turns" && Number(value) > 0,
		);
		return {
			...event,
			usage: hasUsage ? reconciled.usage : event.usage,
			telemetry: {
				live,
				reconciled,
				used: "reconciled",
				mismatch: mismatchFields.length > 0,
				mismatch_fields: mismatchFields,
			},
		};
	} catch {
		return event;
	}
}

function optimizationTelemetry(events) {
	const largeOutputs = [];
	const repeated = new Map();
	let totalToolOutputChars = 0;
	let fullTaskReadCount = 0;
	for (const event of events) {
		if (event.type === "large-task-read") fullTaskReadCount += 1;
		for (const tool of event.tools ?? []) {
			const outputChars = Number(tool.outputChars ?? 0);
			totalToolOutputChars += outputChars;
			const signature = commandSignature(tool.name ?? "tool", [
				tool.kind ?? "",
			]);
			const item = repeated.get(signature) ?? {
				signature,
				count: 0,
				totalOutputChars: 0,
			};
			item.count += 1;
			item.totalOutputChars += outputChars;
			repeated.set(signature, item);
			if (outputChars > LARGE_OUTPUT_THRESHOLD)
				largeOutputs.push({
					tool: tool.name,
					commandSignature: signature,
					outputChars,
					threshold: LARGE_OUTPUT_THRESHOLD,
				});
		}
		if (event.outputChars > LARGE_OUTPUT_THRESHOLD)
			largeOutputs.push({
				tool: event.command ?? event.type,
				commandSignature: event.command ?? event.type,
				outputChars: event.outputChars,
				threshold: LARGE_OUTPUT_THRESHOLD,
			});
	}
	const repeatedCommandSignatures = [...repeated.values()].filter(
		(item) => item.count > 1,
	);
	return {
		totalToolOutputChars,
		largeOutputs: largeOutputs
			.sort((a, b) => b.outputChars - a.outputChars)
			.slice(0, 10),
		topOutputCommands: [...largeOutputs]
			.sort((a, b) => b.outputChars - a.outputChars)
			.slice(0, 5)
			.map((item) => item.commandSignature),
		repeatedCommandSignatures: repeatedCommandSignatures
			.sort((a, b) => b.totalOutputChars - a.totalOutputChars)
			.slice(0, 10),
		fullTaskReadCount,
		recommendations: [
			fullTaskReadCount &&
				"Use compact task summary instead of full task JSON.",
			largeOutputs.length &&
				"Use bounded output; large command output was artifacted.",
			repeatedCommandSignatures.length &&
				"Repeated command signatures found; prefer evidence summaries.",
		].filter(Boolean),
	};
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

// Normal workflow paths read the native store directly. Legacy state is handled only by /work-remove-beads.
function loadNativeWorkStore(cwd) {
	try {
		return loadStore(cwd);
	} catch (error) {
		if (
			error instanceof WorkStoreError &&
			error.category === "missing" &&
			existsSync(join(cwd, ".beads"))
		) {
			const legacy = new Error(
				"Legacy tracker state requires /work-remove-beads before normal commands can run.",
			);
			legacy.reason = "migration-required";
			throw legacy;
		}
		throw error;
	}
}

function readWorkItem(cwd, id) {
	return loadNativeWorkStore(cwd).items[id];
}

function allWorkItems(cwd) {
	return Object.values(loadNativeWorkStore(cwd).items);
}

function childWorkItems(cwd, parentId) {
	return allWorkItems(cwd).filter((item) => item.parentId === parentId);
}

function readyNativeWorkItems(cwd) {
	return readyWorkItems(loadNativeWorkStore(cwd));
}

function normalReadGate(cwd) {
	try {
		loadNativeWorkStore(cwd);
		return null;
	} catch (error) {
		return {
			reason:
				error.reason === "migration-required"
					? "migration-required"
					: "recovery-required",
			message: error.message,
		};
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

function statusIcon(status) {
	const key = String(status ?? "")
		.toLowerCase()
		.replace(/[\s-]+/g, "_");
	return (
		{
			open: "🟢",
			in_progress: "🔵",
			working: "🔵",
			active: "🔵",
			closed: "✅",
			done: "✅",
			complete: "✅",
			blocked: "🟠",
			needs_human: "🟣❓",
			paused: "⏸️",
			stopping: "🛑",
			stopped: "⏹️",
			failed: "🔴",
			error: "🔴",
			unknown: "⚪",
		}[key] ?? "⚪"
	);
}

function statusLabel(status) {
	return `${statusIcon(status)} ${status ?? "unknown"}`;
}

function issueLine(issue) {
	return `${idOf(issue)} ${statusLabel(statusOf(issue))} ${typeOf(issue)} — ${titleOf(issue)}`;
}

function parentOf(issue) {
	return field(issue, "parent_id", "parent", "parentId");
}

function titleOf(issue) {
	return field(issue, "title", "summary") ?? idOf(issue);
}

function updatedAt(issue) {
	return (
		field(issue, "updatedAt", "updated_at", "updated", "modified_at") ?? ""
	);
}

function createdAt(issue) {
	return field(issue, "createdAt", "created_at", "created") ?? "";
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
		const items = allWorkItems(cwd).filter(
			(item) => item.type === "epic" && item.status === status,
		);
		return Array.isArray(items) ? items : [];
	} catch {
		return [];
	}
}

function resolveEpic(cwd, target) {
	const wanted = target.trim();
	if (wanted && wanted !== "last") return { epic: readWorkItem(cwd, wanted) };

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
		return childWorkItems(cwd, epicId);
	} catch {
		return [];
	}
}

function readyIds(cwd, epicId) {
	try {
		return new Set(
			readyNativeWorkItems(cwd)
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
	return issueLine(issue);
}

function buildWorkStatus(cwd, target) {
	const gate = normalReadGate(cwd);
	if (gate) return `${gate.reason}: ${gate.message}`;
	const resolved = resolveEpic(cwd, target);
	if (resolved.choices) {
		if (resolved.choices.length === 0)
			return "No open or in-progress epic found. Use /work-plan or /work-migrate first.";
		return [
			"Multiple active epics. Run /work-status <epic-id> or /work-resume with the epic id as guidance.",
			...resolved.choices.map(
				(epic) =>
					`- ${idOf(epic)} ${statusLabel(statusOf(epic))} — ${titleOf(epic)} (updated ${shortDate(updatedAt(epic))})`,
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
		if (decisions.length) return "Resolve decision WorkItems first.";
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
		return "No ready slices. /work-resume should ask work-planner to compare the epic plan against closed children and create the next slice, or report done. Close the roadmap only with /work-roadmap close.";
	})();

	return [
		`Epic: ${titleOf(epic)} (${epicId})`,
		`Status: ${statusLabel(statusOf(epic))} • created ${shortDate(createdAt(epic))} • updated ${shortDate(updatedAt(epic))}`,
		`Progress: ${done.length}/${slices.length} slices closed (${percent}%)`,
		`Ready: ${readySlices.length} • 🔵 in progress: ${active.length} • planned ahead: ${planned.length} • 🟠 blockers: ${blockers.length} • 🟣❓ decisions: ${decisions.length}`,
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
		...objectMetadata(issue?.ideaLineage),
		...objectMetadata(direct.workOrchestrator),
		...objectMetadata(direct.work_orchestrator),
		...objectMetadata(direct.wo),
		...noteMetadata(issue),
	};
}

function isIdeaIssue(issue) {
	if (typeOf(issue) === "idea") return true;
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

function workflowExecutionMode(issue) {
	const explicit = field(issue, "executionMode", "execution_mode");
	if (["agent", "inline-medium", "inline-small"].includes(explicit))
		return explicit;
	const text = `${labelsOf(issue).join(" ")}\n${notesOf(issue)}`;
	if (/wo:execution-agent|created by \/work-big|big slice/i.test(text))
		return "agent";
	if (/wo:execution-inline|created by \/work-med/i.test(text))
		return "inline-medium";
	if (/created by \/work-small/i.test(text)) return "inline-small";
	return "auto";
}

function implementationPathsFromNotes(issue) {
	return [
		...notesOf(issue).matchAll(/(?:files changed|touched files):\s*([^\n]+)/gi),
	]
		.flatMap((match) => match[1].split(","))
		.map((file) => file.trim().replace(/^`|[.`]$/g, ""))
		.filter((file) => file && !/\s/.test(file))
		.map(normalizedRepoPath)
		.filter(Boolean);
}

function issueSummary(issue) {
	const summary = {
		id: idOf(issue),
		title: titleOf(issue),
		type: typeOf(issue),
		status: statusOf(issue),
		labels: labelsOf(issue),
		updated: updatedAt(issue),
		executionMode: workflowExecutionMode(issue),
	};
	if (isIdeaIssue(issue)) summary.ideaStatus = deriveIdeaStatus(issue);
	if (typeOf(issue) !== "epic") {
		const acceptance = field(
			issue,
			"acceptance",
			"acceptance_criteria",
			"acceptanceCriteria",
		);
		if (acceptance) summary.acceptance = truncate(acceptance, 1600);
		const changedPaths = implementationPathsFromNotes(issue);
		if (changedPaths.length) summary.changedPaths = [...new Set(changedPaths)];
		const notes = notesOf(issue);
		const slicePlanAt = notes.lastIndexOf("wo:slice-plan");
		if (slicePlanAt >= 0)
			summary.slicePlan = notes.slice(slicePlanAt, slicePlanAt + 1600);
		summary.verificationReady = hasVerificationEvidence(issue);
		summary.reviewPassed = hasReviewPass(issue);
		summary.reviewFailed = hasReviewFail(issue);
		summary.reviewRounds = reviewEvents(issue).length;
		summary.reviewFailures = reviewFailureCount(issue);
		summary.fixReadyForReview = fixReadyForReview(issue);
	}
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
			/(^|\s)(git|node|npm|npx|rtk|uv|pytest|cmake|ctest|ninja|\/work-)\b/i.test(
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
		(isWorkItemId(cleaned) || isNumericWorkItemShorthand(cleaned))
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
	return allWorkItems(cwd).filter(
		(item) => item.type === "epic" && item.status === status,
	);
}

function childrenOfRequired(cwd, epicId) {
	try {
		const children = childWorkItems(cwd, epicId);
		if (Array.isArray(children)) return children;
	} catch (error) {
		try {
			const children = childWorkItems(cwd, epicId);
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
		const expanded = expandNumericWorkItemShorthand(cwd, wanted);
		if (expanded.error) return expanded;
		wanted = expanded.target;
		const issue = readWorkItem(cwd, wanted);
		if (!issue)
			return {
				error: "unknown-target",
				message: `No WorkItem found for ${wanted}`,
			};
		return typeOf(issue) === "epic"
			? { kind: "epic", epic: issue }
			: { kind: "workItem", workItem: issue };
	}

	let candidates = [
		...epicsByStatus(cwd, "in_progress"),
		...epicsByStatus(cwd, "open"),
	].sort(byUpdatedDesc);
	if (candidates.length === 0) {
		try {
			candidates = allWorkItems(cwd)
				.filter((item) => item.type === "epic")
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
		.filter((line) => line && !line.startsWith("## "))
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
		file === ".pi/work-orchestrator-state.json" ||
		file.startsWith(".pi/work-runs/") ||
		file.startsWith(".pi/work-ideate/") ||
		file.startsWith(".work-orchestrator/")
	);
}

function isWorkStoreDirt(path) {
	const file = normalizedRepoPath(path);
	return file === ".ce-workflow" || file.startsWith(".ce-workflow/");
}

function isAllowedPlanDirt(path, planPaths = []) {
	const file = normalizedRepoPath(path);
	return planPaths.map(normalizedRepoPath).includes(file);
}

function isWindowsReservedName(path) {
	if (process.platform !== "win32") return false;
	const segments = String(path ?? "")
		.replace(/\\/g, "/")
		.split("/")
		.filter(Boolean);
	return segments.some((segment) =>
		/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..+)?$/i.test(segment),
	);
}

export function isGeneratedBuildArtifact(path) {
	const file = normalizedRepoPath(path);
	const segments = file.split("/");
	const base = segments[segments.length - 1];
	const dirs = new Set(segments.slice(0, -1));
	return (
		dirs.has("build") ||
		dirs.has("dist") ||
		dirs.has("__pycache__") ||
		dirs.has("node_modules") ||
		dirs.has("target") ||
		dirs.has(".pytest_cache") ||
		dirs.has(".mypy_cache") ||
		dirs.has(".ruff_cache") ||
		dirs.has(".tox") ||
		dirs.has(".gradle") ||
		[...dirs].some(
			(dir) => /\.egg-info$/i.test(dir) || /\.dist-info$/i.test(dir),
		) ||
		/\.py[cod]$/i.test(base) ||
		/\.egg-info(?:\.json)?$/i.test(base) ||
		/\.dist-info$/i.test(base) ||
		base === ".DS_Store"
	);
}

function isFormatterOnlyDirt(cwd, item) {
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
		return false;
	}
}

export function isWorkflowDirt(cwd, item, planPaths = []) {
	const file = normalizedRepoPath(item.path);
	return (
		isWorkStoreDirt(file) ||
		isPiRuntimeArtifact(file) ||
		isWindowsReservedName(file) ||
		isGeneratedBuildArtifact(file) ||
		isAllowedPlanDirt(file, planPaths) ||
		isFormatterOnlyDirt(cwd, item) ||
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
		`Dirty files must be resolved before ${command} can mutate native work-item store. Blocking files: ${compactList(blockers) || "unknown"}.`,
	);
}

function resumeGitReport(cwd, planPaths = []) {
	try {
		const rawStatus = run(cwd, "git", [
			"status",
			"--porcelain=v1",
			"--branch",
			"--untracked-files=all",
		]);
		const status = rawStatus || "clean";
		const dirtyFiles = parsePorcelainStatus(rawStatus);
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

function highRiskImplementation(issue) {
	if (!issue) return false;
	if (issue.executionMode === "agent" || isDebugIssue(issue)) return true;
	const text = `${issue.title ?? titleOf(issue)} ${labelsOf(issue).join(" ")}`;
	return /\b(?:auth(?:entication|orization)?|permission|credential|secret|payment|billing|migration|schema|database|destructive|production|deploy|release|breaking|architecture|cross[- ]cutting|concurren(?:cy|t)|race condition|thread safety|crypt|security|firmware flash)\b/i.test(
		text,
	);
}

function implementationExecutionPolicy(state, cwd) {
	const issue = state?.selectedWorkItem;
	if (cwd && workOrchSettings(cwd).sliceExecutionMode === "agent")
		return {
			kind: "agent",
			level: "isolated",
			reason:
				"sliceExecutionMode=agent routes each slice to an isolated work-worker",
		};
	if (highRiskImplementation(issue))
		return {
			kind: "agent",
			level: "high-risk",
			reason: "risk markers require an isolated writer and independent review",
		};
	if (state?.fastSmall || issue?.executionMode === "inline-small")
		return { kind: "inline", level: "small", maxFiles: 2 };
	if (issue?.executionMode === "inline-medium")
		return { kind: "inline", level: "medium", maxFiles: 8 };
	return { kind: "inline", level: "medium", maxFiles: 8 };
}

function withImplementationPolicy(state, cwd) {
	const policy = implementationExecutionPolicy(state, cwd);
	return {
		...state,
		executionPolicy: policy,
		inlineWork: policy.kind === "inline",
		inlineLevel: policy.level,
		handoffReason:
			policy.kind === "inline"
				? `coded ${policy.level} policy keeps work in the current session`
				: policy.reason,
	};
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
					workItem: issueSummary(issue),
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
		const expanded = expandNumericWorkItemShorthand(cwd, wanted);
		if (expanded.error) return expanded;
		wanted = expanded.target;
		if (looksLikePath(wanted))
			return {
				error: "plan-path-target",
				message: `${wanted} looks like a plan path, not an epic ID. Use /work-plan ${wanted}.`,
				suggestedCommands: [`/work-plan ${wanted}`],
			};
		const issue = readWorkItem(cwd, wanted);
		if (!issue)
			return {
				error: "unknown-target",
				message: `No WorkItem found for ${wanted}`,
			};
		if (typeOf(issue) === "epic") return { kind: "epic", epic: issue };
		return {
			error: "unsupported-target",
			message: `${wanted} is a child WorkItem; run /work-resume ${parentOf(issue) ?? "<epic-id>"} or /work-debug ${wanted}`,
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
			// Ignore stale remembered state and fall back to native work-item store discovery.
		}
	}

	let candidates = epicsByStatus(cwd, "open").sort(byUpdatedDesc);
	if (candidates.length === 0) {
		try {
			candidates = allWorkItems(cwd)
				.filter((item) => item.type === "epic")
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
	return childState.blockers
		.map((issue) => ({
			...issueSummary(issue),
			dependencies: depsOf(issue),
			notes: noteDetails(issue),
		}))
		.sort(
			(left, right) =>
				Number(Boolean(right.notes.nextAction)) -
				Number(Boolean(left.notes.nextAction)),
		);
}

function planResumeAction(state, cwd) {
	if (!state.ok) return state;
	const activeImplementation = state.inProgressExecutable?.[0];
	if (state.git && !state.git.safeForHandoff) {
		const blockers = state.git.blockedPaths?.length
			? state.git.blockedPaths
			: state.git.dirtyPaths;
		const expectedAgentDiff =
			activeImplementation?.executionMode === "agent" &&
			activeImplementation.verificationReady &&
			blockers.length > 0 &&
			blockers.every((file) =>
				activeImplementation.changedPaths?.includes(normalizedRepoPath(file)),
			);
		if (!expectedAgentDiff)
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
			selectedWorkItem: state.readyPlanning[0],
			message:
				"A ready planning WorkItem exists after executable children were created; close or update it before resuming.",
			suggestedCommands: [
				`node ${WORK_HELPER_SCRIPT} work-close ${state.readyPlanning[0].id}`,
				`/work-resume ${state.epic.id}`,
			],
		};
	if (activeImplementation) {
		const routed = withImplementationPolicy(
			{
				...state,
				action: "run-implementation",
				selectedWorkItem: activeImplementation,
			},
			cwd,
		);
		if (activeImplementation.reviewPassed)
			return {
				...routed,
				action: "finish-ready",
				message:
					"Implementation is verified and reviewed; use the coded finish gate.",
				suggestedCommands: [`/work-finish ${activeImplementation.id}`],
			};
		if ((activeImplementation.reviewFailures ?? 0) >= 3)
			return {
				...routed,
				action: "review-blocked",
				message:
					"Three review failures reached the coded cap; stop the loop and inspect the durable findings.",
				suggestedCommands: [`/work-report ${activeImplementation.id}`],
			};
		if (activeImplementation.fixReadyForReview)
			return withHandoffPrompt(
				{
					...routed,
					action: "run-review",
					handoffReason:
						"a concrete review fix is verified and needs one scoped re-review",
				},
				cwd,
			);
		if (activeImplementation.reviewFailed)
			return withHandoffPrompt(
				{
					...routed,
					action: "run-fix",
					handoffReason:
						"durable reviewer findings require one exact fixer pass",
				},
				cwd,
			);
		if (!routed.inlineWork) {
			if (activeImplementation.verificationReady)
				return withHandoffPrompt(
					{
						...routed,
						action: "run-review",
						handoffReason:
							"verified high-risk implementation requires one independent review",
					},
					cwd,
				);
			return {
				...routed,
				action: "in-progress-agent",
				message:
					"High-risk WorkItem is already in progress; not launching a duplicate writer. Check the active-run widget or record a blocker before retrying.",
			};
		}
		return withHandoffPrompt(routed, cwd);
	}
	const debug = state.readyExecutable.find(isDebugIssue);
	if (debug)
		return withHandoffPrompt(
			{
				...state,
				action: "run-debug",
				selectedWorkItem: debug,
			},
			cwd,
		);
	const implementation = state.readyExecutable.find(
		(issue) => !isPlanningIssue(issue),
	);
	if (implementation) {
		const settings = workOrchSettings(cwd);
		if (settings.slicePlanBeforeWork && !hasSlicePlan(implementation)) {
			if (
				settings.slicePlanWithCePlan &&
				needsPlannerAgent(implementation, state)
			)
				return withHandoffPrompt(
					{
						...state,
						action: "run-planner",
						selectedWorkItem: implementation,
						handoffExtra: [
							cePlanSliceStep(
								implementation,
								cwd,
								state.planPath,
								settings.slicePlanCeDepth,
							),
						],
					},
					cwd,
				);
			return applyInlineSlicePlan(cwd, state, implementation);
		}
		return withHandoffPrompt(
			withImplementationPolicy(
				{
					...state,
					action: "run-implementation",
					selectedWorkItem: implementation,
				},
				cwd,
			),
			cwd,
		);
	}
	if (state.readyPlanning.length)
		return withHandoffPrompt(
			{
				...state,
				action: "run-planner",
				selectedWorkItem: state.readyPlanning[0],
			},
			cwd,
		);
	if (
		state.blockers.length ||
		state.openDecisions.length ||
		state.downstreamBlocked.length
	)
		return {
			...state,
			action: "report-blocked",
			message:
				"No runnable WorkItem is ready; blockers or decisions need attention.",
			suggestedCommands: suggestedCommands(
				state.epic.id,
				state.blockers,
				state.openDecisions,
			),
		};
	return withHandoffPrompt(
		{
			...state,
			action: "run-planner",
			message:
				"No ready work or blockers; ask the planner to create the next slice or confirm done.",
		},
		cwd,
	);
}

const ROLE_TIMEOUT_GUIDANCE =
	"Role liveness guidance: launch specialists async with control.needsAttentionAfterMs=30000 and use wait/status; never block the TUI on a foreground child. If a run needs an explicit timeout, planner/worker/reviewer/fixer/debugger/migrator get at least 10 minutes and committer gets at least 3 minutes. Treat timeout or startup/auth failure as infrastructure evidence, not implementation failure.";

function gitDirtyClassification(git) {
	if (!git) return "unknown";
	if (git.blockedPaths?.length) return "dirty-stop/unsafe";
	if (git.workflowDirty) return "workflow-owned allowlist";
	if (git.benignDirty) return "instruction-file allowlist";
	if (git.dirtyPaths?.length) return "workflow-owned allowlist";
	return "clean";
}

function subagentRpcReplyEvent(requestId) {
	return `${SUBAGENT_RPC_REPLY_EVENT_PREFIX}${requestId}`;
}

function safeArtifactPart(value) {
	return (
		String(value ?? "work")
			.replace(/[^a-z0-9_.-]+/gi, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 80) || "work"
	);
}

function directRoleAgent(state) {
	if (state?.inlineWork) return undefined;
	const action = String(state?.action ?? "");
	if (action === "run-planner") return "work-planner";
	if (action === "handoff-migrate") return "work-migrator";
	if (action === "run-implementation") return "work-worker";
	if (action === "run-review") return "work-reviewer";
	if (action === "run-fix") return "work-fixer";
	if (/debug/.test(action)) return "work-debugger";
	return undefined;
}

function directRoleTask(state, cwd) {
	const selected = state.selectedWorkItem;
	const helper = JSON.stringify(WORK_HELPER_SCRIPT);
	const expectedImplementationDiff =
		["run-review", "run-fix"].includes(state.action) &&
		selected?.changedPaths?.length;
	return [
		"Precomputed work-orchestrator handoff. Run this role directly; do not delegate or rediscover target selection.",
		...workflowPromptMetadata(),
		state.epic ? `Epic: ${state.epic.id} — ${state.epic.title}` : "Epic: none",
		`Action: ${state.action}`,
		selected
			? `Target work item: ${selected.id} ${selected.type} ${selected.status} — ${selected.title}`
			: "Target: no selected work item; create/reuse the next planning work item only if required.",
		`Git: ${expectedImplementationDiff ? `expected implementation diff (${selected.changedPaths.length} files)` : gitDirtyClassification(state.git)}`,
		state.git?.dirtyPaths?.length
			? expectedImplementationDiff
				? "Known dirt is the scoped implementation diff plus workflow artifacts; avoid unrelated paths and do not enumerate them again."
				: `Known workflow-owned dirt: ${state.git.dirtyPaths.length} paths; avoid it and do not enumerate it again.`
			: "Known dirt: none",
		selected?.id && existsSync(WORK_HELPER_SCRIPT)
			? `Read the compact task first: node ${helper} work-summary ${selected.id}`
			: "Read only the compact fields needed for this action.",
		state.action === "run-review" && selected?.changedPaths?.length
			? `Review only: ${selected.changedPaths.join(", ")}`
			: "",
		state.epic?.id &&
		["run-planner", "run-debug"].includes(state.action) &&
		existsSync(WORK_HELPER_SCRIPT)
			? `For child state use: node ${helper} work-children-summary ${state.epic.id}`
			: "",
		state.action === "run-planner"
			? `Use only native helper summaries plus targeted project files; never use raw store JSON or broad discovery. Create the minimum executable work items required by the stated posture (one by default, at most three for an obvious sequence), verify once with node ${helper} work-ready-summary ${state.epic?.id ?? "<epic>"}, close the planning work item, then stop.`
			: "",
		state.action === "run-implementation" || state.action === "run-debug"
			? planReference(state, cwd)
			: "",
		...(state.handoffExtra ?? []).filter(Boolean),
		"Persist concise evidence/blockers with work-note/work-label/work-block. Do not read Pi session transcripts. Run exactly this action and stop at one work-item or planning boundary.",
	]
		.filter(Boolean)
		.join("\n");
}

function directRoleHandoffParams(state, cwd, selectionNote = "") {
	const agent = directRoleAgent(state);
	if (!agent || !state?.handoffPrompt) return null;
	const target = safeArtifactPart(
		state.selectedWorkItem?.id ?? state.epic?.id ?? state.action ?? agent,
	);
	return {
		agent,
		params: {
			agent,
			task: withSelectionNote(directRoleTask(state, cwd), selectionNote),
			workflowRunId: currentCommandWorkflow()?.workflowRunId,
			activity: workflowActivityMarker(),
			context: "fresh",
			cwd,
			async: true,
			clarify: false,
			control: {
				enabled: true,
				needsAttentionAfterMs: 30_000,
			},
			output: `work-${target}-${agent}.md`,
			outputMode: "file-only",
			acceptance: false,
		},
	};
}

function directRunIdentity(direct, spawned) {
	const data = spawned?.reply?.data ?? spawned?.data ?? {};
	const result = data.result ?? {};
	const details = data.details ?? result.details ?? {};
	return {
		runId:
			data.runId ??
			data.id ??
			result.runId ??
			result.id ??
			details.runId ??
			direct?.params?.runId,
		asyncDir:
			data.asyncDir ??
			result.asyncDir ??
			details.asyncDir ??
			direct?.params?.asyncDir,
	};
}

function recordSpawnedDirectRun(cwd, state, direct, spawned) {
	const identity = directRunIdentity(direct, spawned);
	return recordPendingDirectRun(cwd, {
		workflowRunId: currentCommandWorkflow()?.workflowRunId,
		activity: workflowActivityMarker(),
		action: state.action,
		agent: direct.agent,
		epicId: state.epic?.id,
		workItemId: state.selectedWorkItem?.id,
		...identity,
	});
}

function markDirectHandoffStarted(cwd, state) {
	const selected = state?.selectedWorkItem;
	if (!selected?.id || selected.status !== "open") return state;
	try {
		const claimed = claimWorkflowWorkItem(cwd, selected);
		return idOf(claimed)
			? {
					...state,
					selectedWorkItem: issueSummary(claimed),
					handoffClaimed: true,
				}
			: state;
	} catch {
		return state;
	}
}

async function spawnSubagentRpc(pi, params, timeoutMs = 2000) {
	if (!pi?.events?.on || !pi?.events?.emit) {
		return { ok: false, message: "pi-subagents RPC is unavailable" };
	}
	if (params?.cwd && !existsSync(params.cwd)) {
		return { ok: false, message: `handoff cwd does not exist: ${params.cwd}` };
	}
	const requestId = randomUUID();
	return await new Promise((resolve) => {
		let settled = false;
		let unsubscribe;
		const finish = (result) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			try {
				unsubscribe?.();
			} catch {
				// Best effort; stale listeners should not break command fallback.
			}
			resolve(result);
		};
		const timer = setTimeout(
			() =>
				finish({
					ok: false,
					ambiguous: true,
					message:
						"pi-subagents RPC acknowledgement timed out; launch state is unknown",
				}),
			timeoutMs,
		);
		try {
			unsubscribe = pi.events.on(subagentRpcReplyEvent(requestId), (reply) => {
				if (reply?.success) finish({ ok: true, reply });
				else
					finish({
						ok: false,
						message: reply?.error?.message ?? "pi-subagents RPC failed",
						reply,
					});
			});
			pi.events.emit(SUBAGENT_RPC_REQUEST_EVENT, {
				version: 1,
				requestId,
				method: "spawn",
				params,
			});
		} catch (error) {
			finish({
				ok: false,
				message: error instanceof Error ? error.message : String(error),
			});
		}
	});
}

const WORKFLOW_AGENT_OUTPUT_BYTES = 64 * 1024;
const WORKFLOW_AGENT_STATUS_BYTES = 64 * 1024;
const WORKFLOW_AGENT_POLL_MS = 100;

function readContainedFile(file, directory, maxBytes) {
	let descriptor;
	try {
		const requestedRoot = resolve(directory);
		const rel = relative(requestedRoot, resolve(file));
		if (!rel || dirname(rel) !== "." || isAbsolute(rel)) return null;
		const target = join(realpathSync(directory), rel);
		const pathInfo = lstatSync(target);
		if (
			!pathInfo.isFile() ||
			pathInfo.isSymbolicLink() ||
			pathInfo.size > maxBytes
		)
			return null;
		descriptor = openSync(
			target,
			fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0),
		);
		const info = fstatSync(descriptor);
		if (
			!info.isFile() ||
			info.size > maxBytes ||
			info.dev !== pathInfo.dev ||
			info.ino !== pathInfo.ino
		)
			return null;
		const buffer = Buffer.alloc(info.size);
		let offset = 0;
		while (offset < buffer.length) {
			const count = readSync(
				descriptor,
				buffer,
				offset,
				buffer.length - offset,
				null,
			);
			if (count === 0) break;
			offset += count;
		}
		return { path: target, text: buffer.subarray(0, offset).toString("utf8") };
	} catch {
		return null;
	} finally {
		if (descriptor !== undefined) closeSync(descriptor);
	}
}

function asyncRunIdentity(response) {
	const data = response.reply?.data ?? {};
	const result = data.result ?? data;
	const details = result.details ?? {};
	return {
		runId: data.runId ?? result.runId ?? result.id ?? details.runId,
		asyncDir: data.asyncDir ?? result.asyncDir ?? details.asyncDir,
		artifact:
			result.artifactPaths?.outputPath ??
			result.artifact ??
			result.outputPath ??
			data.outputPath,
	};
}

/** Spawn a real asynchronous pi-subagents run, wait for terminal status, then read its bounded artifact. */
export async function dispatchWorkflowImprovementAgent(
	pi,
	params,
	timeoutMs = 30 * 60 * 1000,
) {
	const { signal, ...rpcParams } = params;
	if (signal?.aborted)
		return { ok: false, aborted: true, message: "agent dispatch aborted" };
	if (!isAbsolute(rpcParams.artifactDir ?? ""))
		return { ok: false, message: "absolute artifactDir is required" };
	mkdirSync(rpcParams.artifactDir, { recursive: true });
	const artifactPath = resolve(
		rpcParams.artifactDir,
		`workflow-${safeArtifactPart(rpcParams.candidateId)}-${safeArtifactPart(rpcParams.attemptId)}-${safeArtifactPart(rpcParams.agent)}.md`,
	);
	const started = Date.now();
	const response = await spawnSubagentRpc(
		pi,
		{
			...rpcParams,
			artifactDir: undefined,
			context: "fresh",
			async: true,
			clarify: false,
			acceptance: false,
			output: artifactPath,
			outputMode: "file-only",
		},
		Math.min(timeoutMs, 30_000),
	);
	if (!response.ok)
		return { ...response, timedOut: Boolean(response.ambiguous) };
	const identity = asyncRunIdentity(response);
	if (!identity.runId || !isAbsolute(identity.asyncDir ?? ""))
		return {
			ok: false,
			message: "pi-subagents returned no async run identity",
			...identity,
		};
	for (;;) {
		if (signal?.aborted)
			return {
				ok: false,
				aborted: true,
				message: "agent dispatch aborted",
				...identity,
			};
		if (Date.now() - started >= timeoutMs)
			return {
				ok: false,
				timedOut: true,
				message: "agent run timed out",
				...identity,
			};
		const statusPath = join(identity.asyncDir, "status.json");
		let status;
		try {
			const statusFile = readContainedFile(
				statusPath,
				identity.asyncDir,
				WORKFLOW_AGENT_STATUS_BYTES,
			);
			if (statusFile) status = JSON.parse(statusFile.text);
		} catch {}
		const state = String(status?.state ?? status?.status ?? "").toLowerCase();
		if (state === "failed")
			return { ok: false, message: "agent run failed", status, ...identity };
		if (state === "complete" || state === "completed") {
			const reported = identity.artifact ?? artifactPath;
			const safeArtifact = readContainedFile(
				reported,
				rpcParams.artifactDir,
				WORKFLOW_AGENT_OUTPUT_BYTES,
			);
			if (!safeArtifact)
				return {
					ok: false,
					message: "unsafe or missing agent artifact",
					status,
					...identity,
				};
			return {
				ok: true,
				response,
				status,
				...identity,
				artifact: safeArtifact.path,
				output: safeArtifact.text,
			};
		}
		await new Promise((resolvePoll) => {
			const timer = setTimeout(resolvePoll, WORKFLOW_AGENT_POLL_MS);
			signal?.addEventListener(
				"abort",
				() => {
					clearTimeout(timer);
					resolvePoll();
				},
				{ once: true },
			);
		});
	}
}

function workflowHelperGuidance(cwd, state) {
	if (!cwd || !existsSync(WORK_HELPER_SCRIPT)) return [];
	const script = JSON.stringify(WORK_HELPER_SCRIPT);
	const selectedId = state.selectedWorkItem?.id;
	const epicId = state.epic?.id;
	return [
		`Workflow helper: node ${script} <command> ...`,
		selectedId
			? `Use compact task reads: node ${script} work-summary ${selectedId}`
			: "Use compact task reads: node <helper> work-summary <work-item-id>",
		epicId
			? `Use compact child/blocker reads: node ${script} work-children-summary ${epicId}; node ${script} blocker-search ${epicId} "<query>"`
			: "Use compact child/blocker reads: node <helper> work-children-summary <epic-id>",
		`Use bounded scans/checks instead of dumping logs: node ${script} search-summary "<regex>" <paths...>; node ${script} scan-capability "<term>" <paths...>; node ${script} json-assert <file> --required key.path`,
		`Use native work-item store/git helpers instead of CLI-help spelunking: node ${script} work-note <id> <note-or-note-file>; node ${script} work-block <task-id> --by <blocker-id>; node ${script} ensure-no-staged --allow-work-store`,
	];
}

function scoreBlocker(issue, terms) {
	const haystack =
		`${titleOf(issue)}\n${labelsOf(issue).join(" ")}\n${noteExcerpt(issue, 800)}`.toLowerCase();
	return terms.reduce(
		(sum, term) => sum + (haystack.includes(term) ? 1 : 0),
		0,
	);
}

function blockerPreflightLines(cwd, state) {
	const epicId = state.epic?.id;
	const title = state.selectedWorkItem?.title ?? "";
	if (!cwd || !epicId || !title) return [];
	const terms = title
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((term) => term.length >= 4)
		.slice(0, 12);
	if (!terms.length) return [];
	try {
		const matches = childrenOfRequired(cwd, epicId)
			.filter((issue) => statusOf(issue) !== "closed")
			.filter(
				(issue) =>
					isBlockedIssue(issue) ||
					typeOf(issue) === "bug" ||
					labelsOf(issue).some((label) => /blocked|debug|follow/.test(label)),
			)
			.map((issue) => ({ issue, score: scoreBlocker(issue, terms) }))
			.filter((item) => item.score > 0)
			.sort((a, b) => b.score - a.score)
			.slice(0, 3);
		if (!matches.length)
			return [
				"Blocker preflight: no matching open blocker surfaced by compact scan.",
			];
		return [
			"Blocker preflight: inspect these before source spelunking; reuse if they already cover the gap:",
			...matches.map(
				({ issue }) =>
					`- ${idOf(issue)} ${statusOf(issue)} ${typeOf(issue)} — ${titleOf(issue)}`,
			),
		];
	} catch {
		return [];
	}
}

function inlineWorkHandoffPrompt(state, extraLines = [], cwd) {
	const selected = state.selectedWorkItem;
	const helper = JSON.stringify(WORK_HELPER_SCRIPT);
	const level = state.inlineLevel ?? state.executionPolicy?.level ?? "medium";
	const maxFiles =
		state.executionPolicy?.maxFiles ?? (level === "small" ? 2 : 8);
	const task = state.smallTask ?? selected ?? {};
	const contract = {
		id: task.id,
		title: task.title,
		notes: task.notes_tail,
		acceptance: task.acceptance_criteria_tail ?? task.acceptance,
	};
	const taskText = Object.values(contract).filter(Boolean).join("\n");
	const evidenceOnly =
		/evidence[- ](?:only|capture)|\b(?:record|capture|probe|verify|test|try)\b/i.test(
			taskText,
		);
	return [
		`work-orchestrator WO_INLINE_V1: complete this ${level} task directly in the current session. Do not call subagent list and do not launch a worker, planner, or committer.`,
		...workflowPromptMetadata(),
		state.epic ? `Epic: ${state.epic.id} — ${state.epic.title}` : "Epic: none",
		`Target: ${selected?.id ?? "none"}`,
		`Task: ${JSON.stringify(contract)}`,
		`Git intake: ${state.git?.status ?? "unknown"}; later runtime/native work-item store dirt is expected.`,
		`Helper: node ${helper}`,
		evidenceOnly
			? "Evidence-only task: prove the exact requested condition; do not substitute a broader suite or edit product/workflow source. Read project instructions, search once for the narrowest existing probe, then run it. Evidence plus native work-item store changes may be the only commit."
			: `Implement with targeted reads only and keep the change within ${maxFiles} implementation files. Greenfield tasks naming output files should create them immediately.`,
		`Finish once: finish-task ${selected?.id ?? "<id>"} --max-files ${maxFiles} --message "<summary>" --verify "<smallest real check>" [--expect "<exact stdout>"] --immediate-format --push. Pass the check directly; use --json <file> --equals <path=value> for JSON. For a multiline check, write one runtime script under .pi first instead of retrying shell quoting. The helper settles Pi's managed formatter before verification and commit.`,
		"When the task names files, read those files directly: no pwd/list/find. Do not reread successful edits, run verification separately, or inspect diff/status; finish-task performs those checks. Do not rediscover/claim, dump raw native work-item store JSON, run broad scans/help, or modify the work-orchestrator package/helper as a workaround. Use one stdlib transform for deterministic text/JSON work.",
		"If finish-task requires independent review, launch exactly work-reviewer once, persist PASS, then rerun with --reviewed. On scope conflict, failed verification, or a real decision, persist the blocker and stop open/uncommitted.",
		planReference(state, cwd),
		...extraLines.filter(Boolean),
		"After finish-task succeeds, return its compact result and stop.",
	]
		.filter(Boolean)
		.join("\n");
}

function roleHandoffPrompt(state, mode, extraLines = [], cwd) {
	if (state.inlineWork) return inlineWorkHandoffPrompt(state, extraLines, cwd);
	const selected = state.selectedWorkItem;
	const selectedLine = selected
		? `${selected.id} ${selected.type} ${selected.status} — ${selected.title}`
		: "none; create/reuse a wo:planning work item if needed";
	const plannerLines =
		state.action === "run-planner"
			? [
					"Planner efficiency: do not run raw raw store JSON; project epics can contain full roadmap plans. Use compact helper projections or the referenced plan file's expected unit section plus summarized child ids/titles/status.",
				]
			: [];
	const settings = cwd ? workOrchSettings(cwd) : null;
	const advisorLines = settings?.advisorVerifyTask ? [advisorVerifyStep()] : [];
	const simplifyLines = settings?.simplifyBeforeReview
		? [simplifyBeforeReviewStep()]
		: [];
	return [
		`Use the work-orchestrator skill in mode: ${mode} with this precomputed extension state.`,
		...workflowPromptMetadata(),
		state.epic ? `Epic: ${state.epic.id} — ${state.epic.title}` : "Epic: none",
		`Action: ${state.action}`,
		`Selected work item: ${selectedLine}`,
		`Git dirty classification: ${gitDirtyClassification(state.git)}`,
		state.git?.dirtyPaths?.length
			? `Known dirty paths: ${state.git.dirtyPaths.join(", ")}`
			: "Known dirty paths: none",
		ROLE_TIMEOUT_GUIDANCE,
		...workflowHelperGuidance(cwd, state),
		...blockerPreflightLines(cwd, state),
		"Subagent output guidance: set outputMode:file-only with a short relative output filename unless the full result is under 20 lines; do not pass .pi-subagents/ paths because the subagent tool owns the artifact directory.",
		"Native helper hygiene: use work-summary, work-children-summary, work-ready-summary, blocker-search, work-claim, work-note, work-label, and work-block; never dump raw store JSON.",
		"Closure rule: worker/reviewer/fixer/debugger roles leave work items open; the coded finish gate commits and closes after required verification/review.",
		selected?.id
			? `Review scope default: current work item ${selected.id} and its diff/verification evidence; do not run broad whole-repo review unless this work item explicitly requires it.`
			: "Review scope default: current diff for this epic; do not run broad whole-repo review unless the action explicitly requires it.",
		...plannerLines,
		...simplifyLines,
		...advisorLines,
		state.action === "run-implementation" || state.action === "run-debug"
			? planReference(state, cwd)
			: "",
		...extraLines.filter(Boolean),
		"Do not rediscover target selection. Verify native work-item store/git freshness, then run exactly this action and stop after one work-item or planning boundary.",
		selected?.id
			? `Target work item: ${selected.id}`
			: "Target work item: none",
	].join("\n");
}

function agentLaunchReason(state) {
	if (state?.handoffReason) return state.handoffReason;
	if (state?.action === "run-debug")
		return "debug WorkItem requires root-cause agent";
	if (state?.action === "run-planner")
		return "planning/ambiguous scope needs planner agent";
	if (state?.action === "run-implementation")
		return "implementation writer for selected WorkItem";
	return state?.action;
}

function withHandoffPrompt(state, cwd) {
	const routed =
		state.action === "run-implementation"
			? withImplementationPolicy(state, cwd)
			: state;
	return {
		...routed,
		handoffReason: agentLaunchReason(routed),
		handoffPrompt: roleHandoffPrompt(
			routed,
			"resume",
			routed.handoffExtra ?? [],
			cwd,
		),
	};
}

function planReference(state, cwd) {
	const workItem = state.selectedWorkItem;
	if (!workItem) return "";
	const slicePlanned = workItem.labels?.includes("wo:slice-planned");
	const planPath = state.planPath
		? isAbsolute(state.planPath)
			? relative(cwd, state.planPath)
			: state.planPath
		: undefined;
	if (slicePlanned) {
		const line = `Plan: execute the wo:slice-plan note on WorkItem ${workItem.id} as your spec; if the note references a plan-path doc, that doc is your spec. The WorkItem is the tracking item, not the spec — do not invent scope beyond it.`;
		return planPath
			? `${line} Epic master plan for context: ${planPath}.`
			: line;
	}
	if (planPath)
		return `Plan: execute the matching Implementation Unit from ${planPath} for WorkItem ${workItem.id}; the WorkItem is the tracking item, the plan is your spec.`;
	return "";
}

function parseWorkResumeArgs(args = "") {
	return parseWorkReportArgs(args);
}

function buildWorkResumeState(cwd, args = "") {
	const gate = normalReadGate(cwd);
	if (gate)
		return errorState(gate.reason, gate.message, {
			action: gate.reason,
			suggestedCommands:
				gate.reason === "migration-required" ? ["/work-remove-beads"] : [],
		});
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
		const planPath = planPathForEpic(cwd, resolved.epic);
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
		const inProgressExecutable = childState.inProgress
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
			inProgressExecutable,
			readyPlanning,
			executableSlices,
			blockers: resumeBlockers(childState),
			downstreamBlocked: childState.downstreamBlocked,
			openDecisions: childState.openDecisions.map(issueSummary),
			git,
			planPath,
			suggestedCommands: [`/work-resume ${childState.epicId}`],
			warnings: git.warnings,
		};
		return planResumeAction(base, cwd);
	} catch (error) {
		return errorState(error.reason ?? "work-store-error", error.message, {
			action: "work-store-error",
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

function buildWorkItemReportState(cwd, workItem) {
	const parentId = parentOf(workItem);
	if (parentId) {
		try {
			rememberWorkflowEpic(cwd, readWorkItem(cwd, parentId));
		} catch {
			// Best-effort memory only; report should not fail on parent lookup.
		}
	}
	const siblings = parentId ? childrenOfRequired(cwd, parentId) : [];
	const byId = new Map(siblings.map((issue) => [idOf(issue), issue]));
	const dependencyIds = depsOf(workItem);
	const dependents = siblings.filter((issue) =>
		depsOf(issue).includes(idOf(workItem)),
	);
	const git = gitReport(cwd);
	const notes = noteDetails(workItem);
	return {
		ok: true,
		target: { requested: idOf(workItem), kind: "workItem" },
		epic: parentId ? { id: parentId } : undefined,
		workItem: {
			...issueSummary(workItem),
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
			workItem: issueSummary(issue),
			blockedBy: issueSummary(workItem),
		})),
		openDecisions: [],
		readyWork: [],
		git,
		suggestedCommands: [
			notes.nextAction ||
				suggestedCommands(parentId ?? idOf(workItem), [], [workItem])[0],
		].filter(Boolean),
		noteExcerpts: notesOf(workItem)
			? [{ id: idOf(workItem), text: noteExcerpt(workItem, 800) }]
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
	const externalBlockers = blockers.filter(
		(issue) =>
			statusOf(issue) === "blocked" || labelsOf(issue).includes("wo:blocked"),
	);
	const externalBlocker =
		externalBlockers.find(
			(issue) =>
				!depsOf(issue).some((id) =>
					externalBlockers.some((other) => idOf(other) === id),
				),
		) ?? externalBlockers[0];
	if (externalBlocker) return [`/work-report ${idOf(externalBlocker)}`];
	const blockedWork = blockers[0];
	if (blockedWork) return [`/work-report ${idOf(blockedWork)}`];
	return epicId ? [`/work-report ${epicId}`] : [];
}

function isWorkItemId(value) {
	return /^[A-Za-z][A-Za-z0-9_-]*-[A-Za-z0-9_.-]+$/.test(value ?? "");
}

function isNumericWorkItemShorthand(value) {
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
		candidates = allWorkItems(cwd)
			.filter((item) => item.type === "epic")
			.filter((epic) => statusOf(epic) !== "closed")
			.sort(byUpdatedDesc);
	} catch {
		candidates = [];
	}
	return candidates;
}

function expandNumericWorkItemShorthand(cwd, target, kind = "any") {
	const text = String(target ?? "").trim();
	if (!isNumericWorkItemShorthand(text)) return { target: text };
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
		kind === "workItem"
			? []
			: epics.filter((epic) => idHasNumericSuffix(idOf(epic), text));
	// Prefer child native work-item store for the common `/work-debug 19:` case when the epic is E-1.
	const matches = children.length ? children : epicsMatching;
	const unique = [
		...new Map(matches.map((issue) => [idOf(issue), issue])).values(),
	];
	if (unique.length === 1) return { target: idOf(unique[0]), issue: unique[0] };
	if (unique.length > 1)
		return {
			error: "ambiguous-target",
			message: `Numeric WorkItem shorthand ${text} matches multiple native work-item store; use the full ID.`,
			candidates: unique.map(issueSummary),
		};
	return {
		error: "unknown-target",
		message: `No active WorkItem matches numeric shorthand ${text}; use the full ID.`,
	};
}

function ensureWorkflowGitignore(cwd) {
	try {
		const gitignorePath = join(cwd, ".gitignore");
		const existing = existsSync(gitignorePath)
			? readFileSync(gitignorePath, "utf8")
			: "";
		const lines = new Set(existing.split(/\r?\n/).map((line) => line.trim()));
		const missing = [".pi/", ".pi-subagents/"].filter(
			(entry) => !lines.has(entry),
		);
		if (!missing.length) return;
		const prefix = existing && !/\n$/.test(existing) ? "\n" : "";
		writeFileSync(
			gitignorePath,
			`${existing}${prefix}\n# Pi / ce-workflow runtime artifacts (added at init)\n${missing.join("\n")}\n`,
		);
	} catch {
		// non-fatal: .gitignore is a convenience, not required for correctness
	}
}

function ensureWorkStoreInitialized(cwd) {
	try {
		loadStore(cwd);
		return {
			initialized: false,
			message: "Native work store already initialized.",
		};
	} catch (error) {
		if (!(error instanceof WorkStoreError) || error.category !== "missing")
			throw error;
	}
	initStore(cwd);
	ensureWorkflowGitignore(cwd);
	return { initialized: true, message: "Initialized native work store." };
}

function nativeIssue(item) {
	const edges = new Map(
		(item.dependencyEdges ?? []).map((edge) => [edge.toId, edge]),
	);
	return {
		id: item.id,
		issue_type: item.type,
		status: item.status,
		title: item.title,
		parent_id: item.parentId,
		created_at: item.createdAt,
		updated_at: item.updatedAt,
		description: item.description,
		acceptance_criteria: item.acceptance,
		owner: item.owner,
		priority: item.priority,
		labels: item.labels ?? [],
		notes: (item.notes ?? []).join("\n"),
		document_links: item.documentLinks,
		design: item.documentLinks?.design,
		dependencies: [
			...(item.dependencyEdges ?? []).map(
				({ fromId, toId, type, ...edge }) => ({
					issue_id: fromId,
					depends_on_id: toId,
					type,
					...edge,
				}),
			),
			...(item.dependencies ?? [])
				.filter((id) => !edges.has(id))
				.map((depends_on_id) => ({
					issue_id: item.id,
					depends_on_id,
					type: "blocks",
				})),
		],
	};
}

function createWorkflowWorkItem(
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
	const item = mutateStore(cwd, (store) =>
		createWorkItem(store, {
			title: compactWorkItemTitle(title),
			type,
			parentId: parent,
			notes: appendOriginalWorkItemTitle(notes, title)
				? [appendOriginalWorkItemTitle(notes, title)]
				: [],
			description,
			acceptance,
			documentLinks: designFile
				? { design: designFile }
				: design
					? { design }
					: undefined,
		}),
	);
	return nativeIssue(item);
}

function appendWorkflowWorkItemNote(cwd, id, note) {
	return nativeIssue(
		mutateStore(cwd, (store) => appendWorkNote(store, id, note)),
	);
}

function updateWorkItemNative(cwd, id, changes) {
	return nativeIssue(
		mutateStore(cwd, (store) => updateWorkItem(store, id, changes)),
	);
}

function addWorkDependency(cwd, id, dependency) {
	const item = loadStore(cwd).items[id];
	return updateWorkItemNative(cwd, id, {
		dependencies: [...(item?.dependencies ?? []), dependency],
		dependencyEdges: [
			...(item?.dependencyEdges ?? []),
			...(item?.dependencyEdges?.some((edge) => edge.toId === dependency)
				? []
				: [{ fromId: id, toId: dependency, type: "blocks" }]),
		],
	});
}

function debugNeededId(issue) {
	const text = [...labelsOf(issue), notesOf(issue)].join("\n");
	return text.match(/debug-needed:([^\s,;]+)/)?.[1] ?? "";
}

function resolveWorkflowEpic(cwd, target = "") {
	let wanted = normalizeCommandTarget(target);
	if (wanted && wanted !== "last") {
		const expanded = expandNumericWorkItemShorthand(cwd, wanted, "epic");
		if (expanded.error) return expanded;
		wanted = expanded.target;
		const issue = readWorkItem(cwd, wanted);
		if (!issue)
			return {
				error: "unknown-target",
				message: `No WorkItem found for ${wanted}`,
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
				"Multiple active epics found; pass --epic <id> or target a WorkItem.",
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
	const gate = normalReadGate(cwd);
	if (gate)
		return errorState(gate.reason, gate.message, {
			action: gate.reason,
			suggestedCommands:
				gate.reason === "migration-required" ? ["/work-remove-beads"] : [],
		});
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
		return errorState(error.reason ?? "work-store-error", error.message);
	}
}

function checkpointNote({ epic, workItem, git, userNote }) {
	const details = workItem ? noteDetails(workItem) : {};
	const dirty = git.dirtyPaths?.length ? git.dirtyPaths.join(", ") : "clean";
	return [
		"work-pause checkpoint",
		`epic: ${idOf(epic)} — ${titleOf(epic)}`,
		workItem
			? `workItem: ${idOf(workItem)} — ${titleOf(workItem)}`
			: "workItem: none",
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
		const workItem =
			childState.inProgress.length === 1 ? childState.inProgress[0] : undefined;
		const noteText = checkpointNote({
			epic: resolved.epic,
			workItem,
			git,
			userNote: note,
		});
		if (!workItem)
			return {
				ok: true,
				action: "draft-checkpoint",
				epic: issueSummary(resolved.epic),
				git,
				note: noteText,
				message:
					"No single in-progress WorkItem found; checkpoint draft was not appended.",
				warnings: git.warnings,
				json,
			};
		appendWorkflowWorkItemNote(cwd, idOf(workItem), noteText);
		return {
			ok: true,
			action: "checkpoint-appended",
			epic: issueSummary(resolved.epic),
			selectedWorkItem: issueSummary(workItem),
			git,
			note: noteText,
			message: `Checkpoint appended to ${idOf(workItem)}.`,
			warnings: git.warnings,
			json,
		};
	} catch (error) {
		return errorState(error.reason ?? "work-store-error", error.message, {
			action: "work-store-error",
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
	if (rest && (isWorkItemId(first) || isNumericWorkItemShorthand(first)))
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

function debugHandoff(state, guidance = "", cwd) {
	return {
		...state,
		handoffPrompt: roleHandoffPrompt(
			state,
			"debug",
			[
				`Debug WorkItem: ${state.selectedWorkItem.id} — ${state.selectedWorkItem.title}`,
				guidance ? `Guidance: ${guidance}` : "Guidance: none",
				"Do not rediscover the debug target. Verify native work-item store/git freshness, then run the debug loop for this WorkItem.",
			],
			cwd,
		),
	};
}

function buildWorkDebugState(cwd, args = "") {
	let { target, guidance } = splitTargetGuidance(args);
	if (!target)
		return errorState(
			"usage",
			"Usage: /work-debug <bug-or-work-item-id|symptom>",
			{
				action: "usage",
			},
		);
	try {
		const expanded = expandNumericWorkItemShorthand(cwd, target);
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
		if (isWorkItemId(target)) {
			source = readWorkItem(cwd, target);
			if (!source)
				return errorState("unknown-target", `No WorkItem found for ${target}`);
			const linked = debugNeededId(source);
			if (linked) bug = readWorkItem(cwd, linked);
			if (!bug && (isDebugIssue(source) || isBlockedIssue(source)))
				bug = source;
			if (!bug) bug = findExistingDebugBug(cwd, source);
			const parentId =
				typeOf(source) === "epic" ? idOf(source) : parentOf(source);
			if (!parentId)
				return errorState("unknown-parent", "Debug target has no parent epic.");
			epic = typeOf(source) === "epic" ? source : readWorkItem(cwd, parentId);
			if (!bug) {
				bug = createWorkflowWorkItem(cwd, {
					title: `Debug ${titleOf(source)}`,
					type: "bug",
					parent: parentId,
					notes: `debug target: ${idOf(source)}`,
				});
				if (typeOf(source) !== "epic")
					addWorkDependency(cwd, idOf(source), idOf(bug));
			}
		} else {
			const resolved = resolveWorkflowEpic(cwd, "");
			if (resolved.error)
				return errorState(resolved.error, resolved.message ?? resolved.error, {
					action: "ask-target",
					candidates: resolved.candidates ?? [],
				});
			epic = resolved.epic;
			bug = createWorkflowWorkItem(cwd, {
				title: target,
				type: "bug",
				parent: idOf(epic),
				notes: guidance ? `guidance: ${guidance}` : "created by /work-debug",
			});
		}
		if (guidance && bug && !(source === undefined && !isWorkItemId(target))) {
			if (isBlockedIssue(bug))
				bug = updateWorkItemNative(cwd, idOf(bug), {
					status: "open",
					notes: [
						...(loadStore(cwd).items[idOf(bug)]?.notes ?? []),
						`retry-guidance: ${guidance}`,
					],
				});
			else appendWorkflowWorkItemNote(cwd, idOf(bug), `guidance: ${guidance}`);
		}
		if (bug && isBlockedIssue(bug) && !guidance)
			return {
				ok: true,
				action: "debug-blocked",
				epic: issueSummary(epic ?? { id: parentOf(bug) }),
				selectedWorkItem: issueSummary(bug),
				sourceWorkItem: source ? issueSummary(source) : undefined,
				git,
				message: `Debug WorkItem ${idOf(bug)} is already blocked. Add guidance after ':' to retry, otherwise use /work-report ${idOf(bug)}.`,
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
				selectedWorkItem: issueSummary(bug),
				sourceWorkItem: source ? issueSummary(source) : undefined,
				git,
				message: `Debug target ready: ${idOf(bug)}.`,
				warnings: git.warnings,
			},
			guidance,
			cwd,
		);
	} catch (error) {
		return errorState(error.reason ?? "work-store-error", error.message, {
			action: error.reason ?? "work-store-error",
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
			"Usage: /work-add [--epic <id>] [--blocked-by <work-item-id>] <task>",
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
				"Dirty files must be resolved before /work-add can mutate native work-item store.",
			);
		const resolved = resolveParsedEpic(cwd, parsed);
		if (resolved.error)
			return errorState(resolved.error, resolved.message ?? resolved.error, {
				action: "ask-target",
				candidates: resolved.candidates ?? [],
			});
		let blocker;
		if (parsed.blockedBy) {
			const expanded = expandNumericWorkItemShorthand(
				cwd,
				parsed.blockedBy,
				"workItem",
			);
			if (expanded.error)
				return errorState(expanded.error, expanded.message, expanded);
			blocker = readWorkItem(cwd, expanded.target);
		}
		const workItem = createWorkflowWorkItem(cwd, {
			title: parsed.task,
			type: "task",
			parent: idOf(resolved.epic),
			notes: "created by /work-add",
		});
		if (blocker) addWorkDependency(cwd, idOf(workItem), idOf(blocker));
		return {
			ok: true,
			action: "work-added",
			epic: issueSummary(resolved.epic),
			selectedWorkItem: issueSummary(workItem),
			blockedBy: blocker ? issueSummary(blocker) : undefined,
			git,
			message: `Created ${idOf(workItem)} under ${idOf(resolved.epic)}.`,
			warnings: git.warnings,
		};
	} catch (error) {
		return errorState(error.reason ?? "work-store-error", error.message, {
			action: error.reason ?? "work-store-error",
		});
	}
}

function explicitWorkItemIn(text) {
	return (
		String(text).match(/\b[A-Za-z][A-Za-z0-9_-]*-[A-Za-z0-9_.-]+\b/)?.[0] ?? ""
	);
}

function classifyAutoTask(task) {
	const text = String(task).trim();
	if (
		/\b(?:debug|failing|fails|failure|error|exception|regression|broken|crash|stack trace)\b/i.test(
			text,
		)
	)
		return "debug";
	if (
		/\b(?:new product|new app|new project|product idea|brainstorm)\b/i.test(
			text,
		)
	)
		return "master";
	if (
		/\b(?:migrate|migration|legacy TODO|tracker export|branch reconciliation|unfinished branch)\b/i.test(
			text,
		)
	)
		return "migrate";
	if (
		text.length > 500 ||
		/\b(?:architecture|cross[- ]cutting|breaking change|migrat(?:e|ion)|schema|security|authentication|authorization|payment|billing|production deploy|concurrency|thread safety)\b/i.test(
			text,
		)
	)
		return "big";
	if (
		text.length <= 220 &&
		/^(?:add|create|update|change|remove|rename|record|run|write|document|fix)\b/i.test(
			text,
		)
	)
		return "small";
	return "med";
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
		const workItemId = explicitWorkItemIn(task);
		if (workItemId) {
			const issue = readWorkItem(cwd, workItemId);
			if (issue && (isBlockedIssue(issue) || debugNeededId(issue)))
				return buildWorkDebugState(cwd, workItemId);
		}
		const classification = classifyAutoTask(task);
		const builders = {
			debug: buildWorkDebugState,
			master: buildWorkPlanState,
			migrate: buildWorkMigrateState,
			big: buildWorkBigState,
			med: buildWorkMedState,
			small: buildWorkSmallState,
		};
		const routed = builders[classification](cwd, task);
		return {
			...routed,
			autoClassification: classification,
			message: routed.ok
				? `Auto classified ${classification}: ${routed.message ?? routed.action}`
				: routed.message,
		};
	} catch (error) {
		return errorState(error.reason ?? "work-store-error", error.message, {
			action: error.reason ?? "work-store-error",
		});
	}
}

function workflowWorkItemNotes(command, task, extra = [], roleAgent = true) {
	return [
		`created by ${command}`,
		...extra,
		`task: ${task}`,
		roleAgent ? ROLE_TIMEOUT_GUIDANCE : "",
	]
		.filter(Boolean)
		.join("\n");
}

function resolveParsedEpic(cwd, parsed) {
	if (!parsed.epic) return resolveWorkflowEpic(cwd, "");
	const expanded = expandNumericWorkItemShorthand(cwd, parsed.epic, "epic");
	if (expanded.error) return expanded;
	const epic = readWorkItem(cwd, expanded.target);
	return typeOf(epic) === "epic"
		? { kind: "epic", epic }
		: {
				error: "unsupported-target",
				message: `${parsed.epic} is not an epic.`,
			};
}

function claimWorkflowWorkItem(cwd, issue) {
	if (statusOf(issue) === "closed") {
		const error = new Error(`WorkItem ${idOf(issue)} is already closed.`);
		error.reason = "closed-target";
		throw error;
	}
	if (statusOf(issue) === "in_progress") return issue;
	return updateWorkItemNative(cwd, idOf(issue), { status: "in_progress" });
}

function buildWorkSmallState(cwd, args = "") {
	const raw = String(args).trim();
	if (!raw)
		return errorState(
			"usage",
			"Usage: /work-small [--epic <id>|<work-item-id>] <task>",
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
				: expandNumericWorkItemShorthand(cwd, first);
		if (expandedFirst.error)
			return errorState(
				expandedFirst.error,
				expandedFirst.message,
				expandedFirst,
			);
		const firstTarget = expandedFirst.target;
		if (isWorkItemId(firstTarget) && firstTarget !== "--epic") {
			const issue = readWorkItem(cwd, firstTarget);
			if (!issue)
				return errorState(
					"unknown-target",
					`No WorkItem found for ${firstTarget}`,
				);
			if (typeOf(issue) !== "epic") {
				const epic = readWorkItem(cwd, parentOf(issue));
				const claimed = claimWorkflowWorkItem(cwd, issue);
				return withHandoffPrompt(
					{
						ok: true,
						action: "run-implementation",
						fastSmall: true,
						inlineWork: true,
						inlineLevel: "small",
						smallTask: compactTaskSummary(claimed, { notesTail: 800 }),
						epic: issueSummary(epic),
						selectedWorkItem: issueSummary(claimed),
						git,
						message: `Using existing ${idOf(issue)}.`,
						warnings: git.warnings,
						handoffExtra: rest.length
							? [`Task guidance: ${rest.join(" ")}`]
							: [],
					},
					cwd,
				);
			}
			const task = rest.join(" ").trim();
			if (!task)
				return errorState("usage", "Usage: /work-small <epic-id> <task>", {
					action: "usage",
				});
			const workItem = claimWorkflowWorkItem(
				cwd,
				createWorkflowWorkItem(cwd, {
					title: task,
					type: "task",
					parent: idOf(issue),
					notes: workflowWorkItemNotes(
						"/work-small",
						task,
						["wo:implementation"],
						false,
					),
				}),
			);
			return withHandoffPrompt(
				{
					ok: true,
					action: "run-implementation",
					fastSmall: true,
					inlineWork: true,
					inlineLevel: "small",
					smallTask: compactTaskSummary(workItem, { notesTail: 800 }),
					epic: issueSummary(issue),
					selectedWorkItem: issueSummary(workItem),
					git,
					message: `Created ${idOf(workItem)} under ${idOf(issue)}.`,
					warnings: git.warnings,
				},
				cwd,
			);
		}
		const parsed = parseWorkAddArgs(raw);
		const resolved = resolveParsedEpic(cwd, parsed);
		if (resolved.error)
			return errorState(resolved.error, resolved.message ?? resolved.error, {
				action: "ask-target",
				candidates: resolved.candidates ?? [],
			});
		const workItem = claimWorkflowWorkItem(
			cwd,
			createWorkflowWorkItem(cwd, {
				title: parsed.task,
				type: "task",
				parent: idOf(resolved.epic),
				notes: workflowWorkItemNotes(
					"/work-small",
					parsed.task,
					["wo:implementation"],
					false,
				),
			}),
		);
		return withHandoffPrompt(
			{
				ok: true,
				action: "run-implementation",
				fastSmall: true,
				inlineWork: true,
				inlineLevel: "small",
				smallTask: compactTaskSummary(workItem, { notesTail: 800 }),
				epic: issueSummary(resolved.epic),
				selectedWorkItem: issueSummary(workItem),
				git,
				message: `Created ${idOf(workItem)} under ${idOf(resolved.epic)}.`,
				warnings: git.warnings,
			},
			cwd,
		);
	} catch (error) {
		return errorState(error.reason ?? "work-store-error", error.message, {
			action: error.reason ?? "work-store-error",
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
				`Dirty files must be resolved before /work-${size} can mutate native work-item store.`,
			);
		const resolved = resolveParsedEpic(cwd, parsed);
		if (resolved.error)
			return errorState(resolved.error, resolved.message ?? resolved.error, {
				action: "ask-target",
				candidates: resolved.candidates ?? [],
			});
		const posture =
			size === "big"
				? "big slice: split into executable native work-item store and decision native work-item store before implementation"
				: "medium slice: create one executable child WorkItem by default before implementation; create up to three only for obvious low-risk sequences";
		const workItem = createWorkflowWorkItem(cwd, {
			title: parsed.task,
			type: "task",
			parent: idOf(resolved.epic),
			notes: workflowWorkItemNotes(`/work-${size}`, parsed.task, [
				"wo:planning",
				posture,
			]),
		});
		return withHandoffPrompt(
			{
				ok: true,
				action: "run-planner",
				epic: issueSummary(resolved.epic),
				selectedWorkItem: issueSummary(workItem),
				git,
				message: `Created planning WorkItem ${idOf(workItem)} under ${idOf(resolved.epic)}.`,
				warnings: git.warnings,
				handoffExtra: [
					posture,
					`Planner must verify dependency direction once with node ${JSON.stringify(WORK_HELPER_SCRIPT)} work-ready-summary ${idOf(resolved.epic)}.`,
				],
			},
			cwd,
		);
	} catch (error) {
		return errorState(error.reason ?? "work-store-error", error.message, {
			action: error.reason ?? "work-store-error",
		});
	}
}

function buildWorkMedState(cwd, args = "") {
	const parsed = parseWorkAddArgs(args);
	if (!parsed.task)
		return errorState("usage", "Usage: /work-med [--epic <id>] <task>", {
			action: "usage",
		});
	try {
		const git = resumeGitReport(cwd);
		if (!git.safeForHandoff)
			return dirtyStopState(
				git,
				"Dirty files must be resolved before /work-med can launch work.",
			);
		const resolved = resolveParsedEpic(cwd, parsed);
		if (resolved.error)
			return errorState(resolved.error, resolved.message ?? resolved.error, {
				action: "ask-target",
				candidates: resolved.candidates ?? [],
			});
		const workItem = claimWorkflowWorkItem(
			cwd,
			createWorkflowWorkItem(cwd, {
				title: parsed.task,
				type: "task",
				parent: idOf(resolved.epic),
				notes: workflowWorkItemNotes(
					"/work-med",
					parsed.task,
					["wo:implementation", "wo:execution-inline"],
					false,
				),
			}),
		);
		return withHandoffPrompt(
			withImplementationPolicy(
				{
					ok: true,
					action: "run-implementation",
					inlineWork: true,
					inlineLevel: "medium",
					smallTask: compactTaskSummary(workItem, { notesTail: 1200 }),
					epic: issueSummary(resolved.epic),
					selectedWorkItem: issueSummary(workItem),
					git,
					message: `Created ${idOf(workItem)} under ${idOf(resolved.epic)} for inline medium work.`,
					warnings: git.warnings,
				},
				cwd,
			),
			cwd,
		);
	} catch (error) {
		return errorState(error.reason ?? "work-store-error", error.message, {
			action: error.reason ?? "work-store-error",
		});
	}
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

export function scanPlanOpenQuestions(text) {
	const body = stripFrontmatter(String(text ?? ""));
	const lines = body.split(/\r?\n/);
	const questions = [];
	const seen = new Set();
	const isOpenQuestionHeading = (heading) =>
		/^\s*#{1,4}\s+.*\bopen\s+questions?\b/i.test(heading) &&
		!/resolved|remain|closed|answered|decided|waived/i.test(heading);
	const isResolvedMarker = (line) =>
		/\b(?:confirmed|resolved|decided|waived|closed)\b/i.test(line) ||
		/→\s*confirmed/i.test(line);
	const pushQuestion = (raw) => {
		const clean = String(raw).replace(/`/g, "").replace(/\*\*/g, "").trim();
		if (!clean || isResolvedMarker(clean)) return;
		const id = clean.match(/\b(OQ-\d+|Q\d+)\b/i)?.[1] ?? null;
		const dedupe = id || clean.slice(0, 120);
		if (seen.has(dedupe)) return;
		seen.add(dedupe);
		const defaultMatch =
			clean.match(
				/\bdefault(?:\s+if\s+no\s+answer)?\s*[:-]\s*(.+?)(?:[.;]\s|$)/i,
			) || clean.match(/\(default[:\s]+(.+?)\)/i);
		const suggested = defaultMatch
			? defaultMatch[1].replace(/[.;].*$/, "").trim()
			: null;
		questions.push({ id, text: clean, suggested_default: suggested });
	};
	let inSection = false;
	let sectionLevel = 99;
	for (const line of lines) {
		const heading = line.match(/^(#{1,4})\s+(.*)$/);
		if (heading) {
			if (inSection && heading[1].length <= sectionLevel) inSection = false;
			else if (!inSection && isOpenQuestionHeading(line)) {
				inSection = true;
				sectionLevel = heading[1].length;
			}
			continue;
		}
		if (!inSection) continue;
		const bullet = line.match(/^\s*(?:[-*+]|\d+[.)])\s+(.*)$/);
		if (bullet) pushQuestion(bullet[1]);
	}
	for (const line of lines) {
		if (!/\b(OQ-\d+|Q\d+)\b/i.test(line) || isResolvedMarker(line)) continue;
		const bullet = line.match(/^\s*(?:[-*+]|\d+[.)])\s+(.*)$/);
		if (bullet) pushQuestion(bullet[1]);
	}
	return questions;
}

function openQuestionsBlockState(cwd, rel, questions, command, git, init) {
	const listing = questions
		.map((question, index) => {
			const id = question.id || `OQ-${index + 1}`;
			const suffix = question.suggested_default
				? ` (suggested default: ${question.suggested_default})`
				: "";
			return `- ${id}: ${question.text}${suffix}`;
		})
		.join("\n");
	return {
		ok: true,
		action: "open-questions-block",
		plan: rel,
		open_questions: questions,
		git,
		message: `${init?.initialized ? `${init.message} ` : ""}Epic creation blocked: ${rel} has ${questions.length} unresolved open question(s). Resolve them, then re-run ${command} ${rel}.`,
		warnings: git?.warnings ?? [],
		handoffPrompt: [
			`work-orchestrator OPEN-QUESTION GATE: ${command} is blocked because ${rel} still has ${questions.length} open question(s). Do NOT create the epic until the plan is decision-complete.`,
			"Resolve every open question in the current session, one ask_user call per question:",
			`Open questions:\n${listing}`,
			"For EACH question run exactly one ask_user call: show the question text, offer its suggested default as the recommended option, allow a freeform answer, and allow an explicit 'waive — defer to a decision WorkItem' option. A default is a suggestion to present, never a silent resolution; do not skip a question or accept its default without asking.",
			"After each answer, edit the plan to fold the decision in: move the item out of the Open Questions section into Decisions/Assumptions as a confirmed decision (or, for a waiver, mark it 'waived' and create/reuse a decision WorkItem). Items marked confirmed/resolved/decided/waived are ignored by the gate.",
			`When zero open questions remain, re-run ${command} ${rel}; the extension re-scans and creates the epic automatically.`,
			ROLE_TIMEOUT_GUIDANCE,
		].join("\n"),
		suggestedCommands: [`${command} ${rel}`],
		nextAction: `Next: resolve the ${questions.length} open question(s) via ask_user, then re-run ${command} ${rel}.`,
	};
}

export function bootstrapPlanEpic(cwd, rel, command = "/work-plan", git, init) {
	const planText = readFileSync(join(cwd, rel), "utf8");
	const gitReport = git ?? resumeGitReport(cwd, [rel]);
	const initReport = init ?? ensureWorkStoreInitialized(cwd);
	const openQuestions = scanPlanOpenQuestions(planText);
	if (openQuestions.length)
		return openQuestionsBlockState(
			cwd,
			rel,
			openQuestions,
			command,
			gitReport,
			initReport,
		);
	if (!safeForPlanBootstrap(cwd, gitReport, rel))
		return planBootstrapDirtyStop(cwd, gitReport, rel, command);
	const fields = planEpicFields(cwd, rel);
	const epic = createWorkflowWorkItem(cwd, {
		title: fields.title,
		type: "epic",
		description: fields.description,
		designFile: fields.designFile,
		acceptance: fields.acceptance,
		notes: fields.notes,
	});
	rememberWorkflowEpic(cwd, epic);
	const planning = createWorkflowWorkItem(cwd, {
		title: `Plan next slice for ${fields.title}`,
		type: "task",
		parent: idOf(epic),
		notes: workflowWorkItemNotes(command, fields.title, [
			"wo:planning",
			`source plan: ${rel}`,
			fields.ideaId ? `idea-id=${fields.ideaId}` : "",
			"create one executable slice by default",
		]),
	});
	if (fields.ideaId)
		appendWorkflowWorkItemNote(
			cwd,
			fields.ideaId,
			`wo:idea status=discussed plan-path=${rel} epic-id=${idOf(epic)} task-id=${idOf(planning)}`,
		);
	return withHandoffPrompt(
		{
			ok: true,
			action: "run-planner",
			epic: issueSummary(epic),
			selectedWorkItem: issueSummary(planning),
			git: gitReport,
			message: `${initReport.initialized ? `${initReport.message} ` : ""}Created epic ${idOf(epic)} and planning WorkItem ${idOf(planning)} from ${rel}.`,
			warnings: gitReport.warnings,
			suggestedCommands: [`/work-resume ${idOf(epic)}`],
			nextAction: `Next: run /work-resume ${idOf(epic)} to plan and start the first slice.`,
		},
		cwd,
	);
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
			message: `Multiple ideas match ${text}; use a WorkItem ID.`,
			candidates: matches,
		};
	return { error: "unknown-target", message: `No idea found for ${text}.` };
}

function appendIdeaStatus(cwd, id, status, action) {
	return appendWorkflowWorkItemNote(
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
	const workItem = existing
		? appendWorkflowWorkItemNote(cwd, idOf(existing), note)
		: createWorkflowWorkItem(cwd, {
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
		idea: issueSummary(workItem),
		message: `${existing ? "Updated" : "Created"} idea ${idOf(workItem)} from ${rel}.`,
		suggestedCommands: [`/work-ideate ${idOf(workItem)} inspect`],
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
		const recovery = createWorkflowWorkItem(cwd, {
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
			message: `Could not parse ideation output; created recovery WorkItem ${idOf(recovery)}.`,
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
			const workItem = existing
				? appendWorkflowWorkItemNote(cwd, idOf(existing), note)
				: createWorkflowWorkItem(cwd, {
						title: idea.title,
						type: "task",
						parent: idOf(epic),
						description: idea.summary || `Idea from /work-ideate ${topic}.`,
						notes: note,
					});
			saved.push(issueSummary(workItem));
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
		"Generate roughly 20 ideas, mark about 7 top picks as accepted, the rest as contenders, then create native work-item store under the epic with wo:idea notes and source-run/source-index metadata.",
		"If structured capture fails, preserve the raw output in a recovery decision WorkItem and report saved vs unsaved ideas.",
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
	const epic = createWorkflowWorkItem(cwd, {
		title: brainstormEpicTitle(topic),
		type: "epic",
		description: `Brainstorm workspace created by /work-brainstorm for: ${topic}`,
		notes: workflowWorkItemNotes("/work-brainstorm", topic, [
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
	return createWorkflowWorkItem(cwd, {
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
		const init = ensureWorkStoreInitialized(cwd);
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
			const workItem = appendWorkflowWorkItemNote(
				cwd,
				resolvedIdea.idea.id,
				ideaBrainstormNote(artifact, "selected-brainstorm"),
			);
			return {
				ok: true,
				action: "brainstorm-linked",
				epic: issueSummary(epic),
				idea: issueSummary(workItem),
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
		const workItem = match.idea
			? appendWorkflowWorkItemNote(
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
			idea: issueSummary(workItem),
			artifact,
			topic: parsed.topic,
			possibleDuplicates: match.possibleDuplicates,
			message: [
				init.initialized ? init.message : "",
				createdEpic ? `Created epic ${idOf(epic)}.` : "",
				`${match.reused ? "Updated" : "Created"} idea ${idOf(workItem)} for brainstorm ${parsed.topic}.`,
			]
				.filter(Boolean)
				.join(" "),
			suggestedCommands: artifact
				? [`/work-plan ${artifact}`]
				: [`/work-brainstorm idea ${idOf(workItem)} <brainstorm-path>`],
		};
	} catch (error) {
		return errorState(error.reason ?? "work-store-error", error.message, {
			action: error.reason ?? "work-store-error",
		});
	}
}

function brainstormHandoffPrompt(state, cwd) {
	const artifact = state.artifact;
	const criticLines =
		cwd && workOrchSettings(cwd).critic.brainstorm
			? [advisorCriticStep("brainstorm artifact")]
			: [];
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
		...criticLines,
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
	const gate = normalReadGate(cwd);
	if (gate)
		return errorState(gate.reason, gate.message, {
			action: gate.reason,
			suggestedCommands:
				gate.reason === "migration-required" ? ["/work-remove-beads"] : [],
		});
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
			const workItem = appendIdeaStatus(cwd, idea.id, "rejected", "reject");
			return {
				ok: true,
				action: "rejected",
				epic: issueSummary(epic),
				idea: issueSummary(workItem),
				message: `Rejected ${idea.id}; it remains inspectable and resume-ineligible.`,
				suggestedCommands: [`/work-ideate ${idea.id} inspect`],
			};
		}
		if (parsed.action === "accept") {
			const workItem = appendIdeaStatus(cwd, idea.id, "accepted", "accept");
			return {
				ok: true,
				action: "accepted",
				epic: issueSummary(epic),
				idea: issueSummary(workItem),
				message: `Accepted ${idea.id}.`,
				suggestedCommands: [`/work-ideate ${idea.id} discuss`],
			};
		}
		if (parsed.action === "discuss") {
			const workItem = appendIdeaStatus(cwd, idea.id, "discussed", "discuss");
			return {
				ok: true,
				action: "discussed",
				epic: issueSummary(epic),
				idea: issueSummary(workItem),
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
		return errorState(error.reason ?? "work-store-error", error.message, {
			action: error.reason ?? "work-store-error",
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
		const init = ensureWorkStoreInitialized(cwd);
		return {
			ok: true,
			action: init.initialized ? "initialized" : "already-initialized",
			message: init.message,
			suggestedCommands: ["/work-plan <idea-or-plan-file>"],
			nextAction: "Next: /work-plan <idea-or-plan-file>",
		};
	} catch (error) {
		const reason = error.reason ?? "native-store-error";
		return errorState(reason, error.message, {
			action: reason,
			suggestedCommands: ["/work-remove-beads"],
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
		const init = ensureWorkStoreInitialized(cwd);
		const masterGit = resumeGitReport(cwd);
		const sourceArtifacts = extractRepoArtifactRefs(input);
		const handoffPlan = (message, detail, extra = {}) => ({
			ok: true,
			action: "handoff-plan",
			message: `${init.initialized ? `${init.message} ` : ""}${message}`,
			...extra,
			handoffPrompt: [
				"Use ce-plan to convert this input into a detailed master roadmap plan, then create the epic from it in this same flow; do not stop and ask the user to re-run /work-plan.",
				sourceArtifacts.length
					? `Source artifacts to read and cite verbatim in the final plan: ${sourceArtifacts.join(", ")}`
					: "",
				"When the source is not already a plan file, write a new plan artifact; do not reuse or lightly update an older weaker plan unless the user explicitly asks.",
				"Preserve every decided requirement, constraint, non-goal, reference, acceptance example, and open question from the source; the implementor must not need to guess.",
				"Trace each source decision into exactly one place: plan requirement, implementation unit, verification/acceptance proof, explicit open question, or intentionally dropped-with-rationale note.",
				"For any authoritative reference or target behavior, create an Acceptance Contract: source, must-match traits/invariants, must-not regressions, proof artifacts/checks, and who/what can approve it. This is generic: UI visual parity, API compatibility, CLI behavior, C++ ABI/performance/thread-safety, data migration invariants, security posture, hardware behavior, etc.",
				"After the first plan draft, self-audit it. Any material uncertainty, subjective acceptance, weak proof, missing asset/input, or P0/P1 doc-review finding must become a plan fix, a blocking question, a decision/blocker WorkItem instruction, or an explicit user waiver; never leave it as passive risk prose.",
				"Repeat that hardening loop — update the plan, re-check unresolved uncertainties, and ask the user only for decisions that cannot be inferred — until no blocking uncertainty remains. Then create the epic in this same flow: run `node scripts/work-helper.mjs bootstrap-plan-epic <plan-path>`. That helper enforces the Open Question Gate; if it reports open-questions-block, resolve each open question via one ask_user (show the question and its suggested default), fold the answer into the plan, and re-run the helper until it creates the epic. Do NOT run /work-resume before the epic exists. Once the helper returns the epic id, end with Next: /work-resume <epic-id>.",
				"Ask ce-plan clarification questions one at a time when the input is broad, important, or underspecified; auto-accept only skips the final write-confirmation, not discovery questions.",
				detail,
				`Git dirty classification: ${gitDirtyClassification(masterGit)}`,
				ROLE_TIMEOUT_GUIDANCE,
				workOrchSettings(cwd).critic.plan
					? advisorCriticStep("produced plan")
					: "",
			].join("\n"),
			git: masterGit,
			warnings: masterGit.warnings,
			suggestedCommands: [],
			nextAction:
				"Next: after ce-plan writes the plan, bootstrap the epic with `node scripts/work-helper.mjs bootstrap-plan-epic <plan-path>` (runs the Open Question Gate), then resume the epic.",
		});
		const planTarget = splitPlanTarget(input);
		const targetLooksEpic =
			["current", "last"].includes(planTarget.target) ||
			isWorkItemId(planTarget.target) ||
			isNumericWorkItemShorthand(planTarget.target);
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
		return bootstrapPlanEpic(cwd, first, command, masterGit, init);
	} catch (error) {
		return errorState(error.reason ?? "work-store-error", error.message, {
			action: error.reason ?? "work-store-error",
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

function buildWorkRemoveBeadsState(cwd, args = "") {
	try {
		const source = String(args).trim();
		const result = migrateLegacyBeads(
			cwd,
			source ? { exportPath: source } : {},
		);
		return {
			ok: true,
			action: result.action,
			message:
				result.action === "already-migrated"
					? "Native work store already matches the completed migration."
					: `Migrated legacy work state to ${result.store}.`,
			suggestedCommands: ["/work-status"],
		};
	} catch (error) {
		return errorState(error.category ?? "migration-error", error.message, {
			action: error.category ?? "migration-error",
			suggestedCommands: ["/work-remove-beads"],
		});
	}
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
			message: "Migration sources normalized for work-migrator.",
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
		return errorState(error.reason ?? "work-store-error", error.message, {
			action: error.reason ?? "work-store-error",
		});
	}
}

function reviewEvents(issue) {
	return [
		...notesOf(issue).matchAll(
			/(?:wo:review|review(?: result)?):?\s*(PASS|FAIL)\b/gi,
		),
	];
}

function latestReviewVerdict(issue) {
	return reviewEvents(issue).at(-1)?.[1]?.toUpperCase();
}

function hasReviewPass(issue) {
	return latestReviewVerdict(issue) === "PASS";
}

function hasReviewFail(issue) {
	return latestReviewVerdict(issue) === "FAIL";
}

function reviewFailureCount(issue) {
	return reviewEvents(issue).filter(
		(event) => event[1]?.toUpperCase() === "FAIL",
	).length;
}

function fixReadyForReview(issue) {
	const notes = notesOf(issue);
	return (
		notes.toLowerCase().lastIndexOf("wo:fix pass") >
		notes.toLowerCase().lastIndexOf("wo:review fail")
	);
}

function hasVerificationEvidence(issue) {
	return /wo:verify-check\s+PASS|\bverification(?:\s+(?:result|status))?\s*[:=-][^\n]*(?:PASS|passed|success|ok)\b|\btests?\s+(?:PASS|passed|succeeded)\b|\b(?:npm run|pytest|ctest)[^\n]*(?:PASS|passed|exit(?:ed)?\s*0|ok\b)/i.test(
		notesOf(issue),
	);
}

function gitDiffChangeCount(cwd, files) {
	if (!files.length) return Number.POSITIVE_INFINITY;
	const output = run(cwd, "git", ["diff", "--numstat", "--", ...files]);
	return output
		.split(/\r?\n/)
		.filter(Boolean)
		.reduce((total, line) => {
			const [added, deleted] = line.split(/\s+/);
			if (added === "-" || deleted === "-") return total + 10_000;
			return total + Number(added || 0) + Number(deleted || 0);
		}, 0);
}

function isSmallDiff(cwd, files) {
	return (
		files.length > 0 &&
		files.length <= 5 &&
		gitDiffChangeCount(cwd, files) <= 80
	);
}

function isUiPath(file) {
	return /(?:^|\/)(?:app|src\/app|pages|routes|components|views)\/|\.(?:tsx|jsx|vue|svelte|html|css|scss)$/i.test(
		normalizedRepoPath(file),
	);
}

function gitDirty(cwd) {
	return parsePorcelainStatus(
		run(cwd, "git", ["status", "--porcelain=v1", "--untracked-files=all"]),
	);
}

function normalizedPathSet(paths = []) {
	return new Set(paths.map(normalizedRepoPath));
}

function samePathSet(left = [], right = []) {
	const a = normalizedPathSet(left);
	const b = normalizedPathSet(right);
	return a.size === b.size && [...a].every((item) => b.has(item));
}

function isWorkStorePath(file) {
	return normalizedRepoPath(file).startsWith(".ce-workflow/");
}

function ensureOnlyStaged(cwd, files) {
	const staged = run(cwd, "git", ["diff", "--cached", "--name-only"])
		.split(/\r?\n/)
		.filter(Boolean);
	if (!samePathSet(staged, files))
		throw new Error(`Unexpected staged files: ${staged.join(", ") || "none"}`);
}

function amendIfOnly(cwd, dirty, files, message) {
	if (!dirty.length) return;
	const paths = dirty.map((item) => item.path);
	if (!samePathSet(paths, files))
		throw new Error(`${message}: ${paths.join(", ") || "none"}`);
	run(cwd, "git", ["add", "--", ...files]);
	run(cwd, "git", ["commit", "--amend", "--no-edit"]);
}

function executeWorkFinishState(cwd, state) {
	if (!state?.ok || state.action !== "commit-ready") return state;
	if (state.handoffPrompt)
		return errorState(
			"finish-gates-required",
			"Pre-commit gates are still required before coded commit/close.",
			state,
		);
	let headBefore;
	let canonicalBefore;
	try {
		const files = state.relatedFiles ?? [];
		const canonical = ".ce-workflow/work-items.json";
		headBefore = run(cwd, "git", ["rev-parse", "HEAD"]);
		const canonicalPath = join(cwd, canonical);
		canonicalBefore = existsSync(canonicalPath)
			? readFileSync(canonicalPath, "utf8")
			: undefined;
		run(cwd, "git", ["add", "--", ...files, canonical]);
		ensureOnlyStaged(cwd, [...files, canonical]);
		run(cwd, "git", ["commit", "-m", state.commitMessage]);
		amendIfOnly(cwd, gitDirty(cwd), files, "Post-commit dirty files");
		updateWorkItemNative(cwd, state.selectedWorkItem.id, { status: "closed" });
		const closeDirty = gitDirty(cwd);
		if (closeDirty.some((item) => normalizedRepoPath(item.path) !== canonical))
			throw new Error("Work-item close changed other files");
		run(cwd, "git", ["add", "--", canonical]);
		run(cwd, "git", ["commit", "--amend", "--no-edit"]);
		const commitHash = run(cwd, "git", ["rev-parse", "--short", "HEAD"]);
		return {
			...state,
			action: "finish-committed",
			commitHash,
			message: "Committed related files and closed the WorkItem.",
			note: `Commit: ${commitHash} ${state.commitMessage}`,
			nextAction: `Next: /work-resume ${state.epic.id}`,
		};
	} catch (error) {
		// ponytail: only the canonical state needs restoring; Git reset restores the commit.
		try {
			const canonicalPath = join(cwd, ".ce-workflow/work-items.json");
			if (typeof canonicalBefore === "string")
				writeFileSync(canonicalPath, canonicalBefore);
			if (typeof headBefore === "string")
				run(cwd, "git", ["reset", "--mixed", headBefore]);
		} catch {
			// Preserve the original finalization failure.
		}
		return errorState(
			"finish-execute-failed",
			commandErrorText(error) || error.message,
			{ ...state, action: "finish-stop" },
		);
	}
}

function buildWorkFinishState(cwd, args = "") {
	let target = String(args).trim();
	if (!target)
		return errorState("usage", "Usage: /work-finish <work-item-id|epic-id>", {
			action: "usage",
		});
	try {
		const expanded = expandNumericWorkItemShorthand(cwd, target);
		if (expanded.error)
			return errorState(expanded.error, expanded.message, expanded);
		target = expanded.target;
		const issue = readWorkItem(cwd, target);
		if (!issue)
			return errorState("unknown-target", `No WorkItem found for ${target}`);
		let workItem = issue;
		let epic = issue;
		if (typeOf(issue) === "epic") {
			const childState = buildEpicChildState(cwd, issue);
			workItem = childState.inProgress[0] ?? childState.readyWork[0];
			if (!workItem)
				return errorState(
					"no-selected-workItem",
					"No child WorkItem is ready for finish gate.",
					{
						epic: issueSummary(issue),
						action: "finish-stop",
					},
				);
		} else {
			epic = readWorkItem(cwd, parentOf(issue));
		}
		const git = resumeGitReport(cwd);
		const stop = (reason, message, extra = {}) =>
			errorState(reason, message, {
				action: "finish-stop",
				epic: issueSummary(epic),
				selectedWorkItem: issueSummary(workItem),
				git,
				...extra,
			});
		const raw = notesOf(workItem);
		const dirty = git.dirtyPaths ?? [];
		const related = dirty.filter(
			(file) => raw.includes(file) || raw.includes(file.split(/[\\/]/).pop()),
		);
		const verified = hasVerificationEvidence(workItem);
		const codedReview =
			!hasReviewPass(workItem) && verified && isSmallDiff(cwd, related);
		if (isBlockedIssue(workItem) || debugNeededId(workItem))
			return stop("blocked", "Selected WorkItem is blocked/debug-needed.");
		if (!hasReviewPass(workItem) && !codedReview)
			return stop("missing-review", "PASS review evidence is missing.");
		if (!verified)
			return stop("missing-verification", "Verification evidence is missing.");
		if (!dirty.length)
			return stop(
				"no-related-dirty-files",
				"No related dirty files to commit.",
			);
		if (related.length !== dirty.length)
			return stop(
				"unrelated-dirty-files",
				"Dirty files are not all tied to the selected WorkItem notes.",
				{ relatedFiles: related },
			);
		const gates = workOrchSettings(cwd);
		const reviewLevel = gates.codeReviewBeforeCommit;
		const reviewBeforeCommit =
			reviewLevel && reviewLevel !== "off" && !isSmallDiff(cwd, related);
		const preCommitSteps = [
			reviewBeforeCommit ? codeReviewBeforeCommitStep(reviewLevel) : "",
			gates.browserTestsOnUiDiff && related.some(isUiPath)
				? browserTestsOnUiDiffStep()
				: "",
		].filter(Boolean);
		const gated = preCommitSteps.length > 0;
		return {
			ok: true,
			action: "commit-ready",
			epic: issueSummary(epic),
			selectedWorkItem: issueSummary(workItem),
			git,
			relatedFiles: related,
			commitMessage: `${idOf(workItem)}: ${titleOf(workItem)}`,
			message: gated
				? "Finish gate passed; pre-commit gates required before commit."
				: "Finish gate has review, verification, and related dirty files.",
			note: `Commit seed: ${idOf(workItem)}: ${titleOf(workItem)}\nFiles: ${related.join(
				", ",
			)}${codedReview ? "\nReview: coded small-diff check" : ""}${gated ? `\nGates: ${preCommitSteps.length}` : ""}`,
			handoffPrompt: gated
				? [
						"Use the work-orchestrator skill in mode: finish with this precomputed extension state.",
						`Epic: ${idOf(epic)} — ${titleOf(epic)}`,
						`WorkItem: ${idOf(workItem)} — ${titleOf(workItem)}`,
						`Commit message: ${idOf(workItem)}: ${titleOf(workItem)}`,
						`Files: ${related.join(", ")}`,
						...preCommitSteps,
						"After the gates pass (or explicit user waivers), commit with the seed message and close the WorkItem; do not rediscover the target.",
					].join("\n")
				: undefined,
			warnings: git.warnings,
		};
	} catch (error) {
		return errorState(error.reason ?? "work-store-error", error.message, {
			action: error.reason ?? "work-store-error",
		});
	}
}

function allRoadmaps(cwd) {
	try {
		return allWorkItems(cwd)
			.filter((item) => item.type === "epic")
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
		const epic = readWorkItem(cwd, id);
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
	const expanded = expandNumericWorkItemShorthand(cwd, text, "epic");
	if (expanded.error) return expanded;
	const epic = readWorkItem(cwd, expanded.target);
	if (!epic)
		return {
			error: "unknown-target",
			message: `No WorkItem found for ${text}`,
		};
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
	const gate = normalReadGate(cwd);
	if (gate)
		return errorState(gate.reason, gate.message, {
			action: gate.reason,
			suggestedCommands:
				gate.reason === "migration-required" ? ["/work-remove-beads"] : [],
		});
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
					message: `${unresolved.length} unresolved child WorkItem(s). Close anyway?`,
					suggestedCommands: [
						`/work-roadmap tasks ${idOf(resolved.epic)}`,
						`/work-roadmap close ${idOf(resolved.epic)} --force`,
					],
				};
			updateWorkItemNative(cwd, idOf(resolved.epic), { status: "closed" });
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
			updateWorkItemNative(cwd, idOf(resolved.epic), { status: "open" });
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
		return errorState(error.reason ?? "work-store-error", error.message, {
			action: error.reason ?? "work-store-error",
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
	const gate = normalReadGate(cwd);
	if (gate)
		return errorState(gate.reason, gate.message, {
			action: gate.reason,
			suggestedCommands:
				gate.reason === "migration-required" ? ["/work-remove-beads"] : [],
		});
	const { target } = parseWorkReportArgs(args);
	try {
		const resolved = resolveReportTarget(cwd, target);
		if (resolved.error) {
			return errorState(resolved.error, resolved.message ?? resolved.error, {
				candidates: resolved.candidates?.map(issueSummary) ?? [],
			});
		}
		return resolved.kind === "workItem"
			? buildWorkItemReportState(cwd, resolved.workItem)
			: buildEpicReportState(cwd, resolved.epic);
	} catch (error) {
		return errorState(error.reason ?? "work-store-error", error.message);
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
		? items.map((issue) => `- ${issueLine(issue)}`)
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
	if (state.workItem) {
		return [
			`WorkItem: ${state.workItem.title} (${state.workItem.id})`,
			`Status: ${statusLabel(state.workItem.status)} • type: ${state.workItem.type}`,
			"",
			"Dependencies / blockers:",
			...renderIssueList(state.workItem.dependencies),
			"",
			"Downstream blocked:",
			...(state.downstreamBlocked.length
				? state.downstreamBlocked.map(
						(item) =>
							`- ${item.workItem.id} blocked by ${item.blockedBy.id} — ${item.workItem.title}`,
					)
				: ["- none"]),
			"",
			"Failure artifact / notes:",
			state.workItem.notes.reason ||
				state.workItem.notes.rawExcerpt ||
				"- none",
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
		`Status: ${statusLabel(state.epic.status)} • Progress: ${state.counts.closed}/${state.counts.slices} slices closed`,
		`Ready: ${state.counts.ready} • 🔵 in progress: ${state.counts.inProgress} • 🟠 blockers: ${state.counts.blockers} • 🟣❓ decisions: ${state.counts.decisions}`,
		"",
		"Current blockers:",
		...(state.blockers.length
			? state.blockers.flatMap((issue) => {
					const details = renderNoteLines(issue.notes).map(
						(line) => `  - ${line}`,
					);
					return [`- ${issueLine(issue)}`, ...details];
				})
			: ["- none"]),
		"",
		"Downstream blocked:",
		...(state.downstreamBlocked.length
			? state.downstreamBlocked.map(
					(item) =>
						`- ${item.workItem.id} blocked by ${item.blockedBy.id} — ${item.workItem.title}`,
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
		...items.map(
			(item) => `- ${item.id} [${statusLabel(item.status)}] ${item.title}`,
		),
	];
}

function renderWorkRoadmapText(state) {
	if (!state.ok) return `Work roadmap unavailable: ${state.message}`;
	if (state.action === "roadmap-list") {
		const rows = state.roadmaps.map(
			(epic) =>
				`- ${epic.current ? "*" : " "} ${epic.id} [${statusLabel(epic.status)}] ${epic.title}`,
		);
		return ["🗺️ Roadmaps:", ...(rows.length ? rows : ["- none"])].join("\n");
	}
	if (state.action === "roadmap-tasks")
		return [
			`Roadmap: ${state.epic.id} — ${state.epic.title}`,
			...renderTaskGroup("🟠 Blockers:", state.tasks.blockers),
			...renderTaskGroup("🟢 Open:", state.tasks.open),
			...renderTaskGroup("✅ Closed:", state.tasks.closed),
		].join("\n");
	if (state.action === "roadmap-close-needs-confirmation")
		return [
			`Roadmap: ${state.epic.id} — ${state.epic.title}`,
			state.message,
			...renderTaskGroup("🟠 Unresolved:", state.unresolved),
			"💡 Suggested:",
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
			lines.push(`- ${issueLine(blocker)}`);
			if (index === 0 && blocker.notes?.nextAction)
				lines.push(`  Required action: ${blocker.notes.nextAction}`);
		}
		if (state.blockers.length > 3)
			lines.push(`- … ${state.blockers.length - 3} more blocker(s)`);
	}
	if (state.openDecisions?.length) {
		lines.push("Open decisions:");
		for (const decision of state.openDecisions.slice(0, 3))
			lines.push(
				`- ${decision.id} ${statusLabel(decision.status)} — ${decision.title}`,
			);
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
							`- ${epic.id} ${statusLabel(epic.status)} — ${epic.title} (updated ${shortDate(epic.updated)}, children ${epic.counts?.children ?? "?"}, ready ${epic.counts?.ready ?? "?"})`,
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
		`Ready: ${state.counts.ready} • executable: ${state.counts.readyExecutable} • planning: ${state.counts.planning} • 🟠 blockers: ${state.counts.blockers} • 🟣❓ decisions: ${state.counts.decisions}`,
		state.selectedWorkItem
			? `Selected: ${state.selectedWorkItem.id} ${statusLabel(state.selectedWorkItem.status)} ${state.selectedWorkItem.type} — ${state.selectedWorkItem.title}`
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
	let trimmed = String(args ?? "").trim();
	if (!trimmed) return { kind: "status" };
	let tokenBudget;
	if (trimmed.startsWith("--tokens ")) {
		const [, rawBudget, ...rest] = trimmed.split(/\s+/);
		tokenBudget = parseTokenBudget(rawBudget);
		if (tokenBudget === undefined)
			return { kind: "status", error: `Invalid token budget: ${rawBudget}` };
		trimmed = rest.join(" ").trim();
		if (!trimmed)
			return {
				kind: "status",
				error: "Usage: /work-goal --tokens 100k <objective>",
			};
	}
	const [command, rest] = splitFirstWord(trimmed);
	const attach = (result) =>
		tokenBudget !== undefined ? { ...result, tokenBudget } : result;
	if (command === "edit") {
		let editObjective = rest.trim();
		let editBudget = tokenBudget;
		if (editObjective.startsWith("--tokens ")) {
			const [, rawBudget, ...editRest] = editObjective.split(/\s+/);
			editBudget = parseTokenBudget(rawBudget);
			if (editBudget === undefined)
				return { kind: "status", error: `Invalid token budget: ${rawBudget}` };
			editObjective = editRest.join(" ").trim();
		}
		if (editBudget === undefined && tokenBudget === undefined)
			return { kind: "edit", objective: editObjective };
		return {
			kind: "edit",
			objective: editObjective,
			tokenBudget: editBudget ?? tokenBudget,
		};
	}
	if (["status", "show", "help"].includes(command))
		return tokenBudget !== undefined
			? { kind: "status", error: "--tokens only applies to start/edit" }
			: { kind: "status" };
	if (command === "pause") return { kind: "pause" };
	if (command === "resume") return { kind: "resume", answer: rest.trim() };
	if (command === "clear" || command === "stop") return { kind: "clear" };
	return attach({ kind: "start", objective: trimmed });
}

function workGoalSelfImprovingAppendix() {
	return `Self-improving overlay:
- Use the ce-workflow/work-orchestrator process where it applies; prefer /work-init, /work-plan, /work-resume, /work-status, /work-report, and native work-item store-backed state over chat-only tracking.
- If a live or disposable target project exposes ce-workflow friction, fix this ce-workflow package in code before declaring done, or record one concrete follow-up when a safe fix is not possible now.
- Prefer coded automation over prompt-only guidance when workflow behavior can be handled in this extension.
- Use work telemetry and /work-context microcompaction to keep loops cheap, quiet, and resumable.
- Finish only after target-project progress and ce-workflow improvements are verified.`;
}

function workResumeSettings(cwd) {
	const value = readSettings(cwd).workResume;
	return typeof value === "object" && value !== null
		? {
				selfImproving: value.selfImproving === true,
				newSessionBetweenIterations:
					value.newSessionBetweenIterations !== false,
			}
		: { selfImproving: false, newSessionBetweenIterations: true };
}

function readWorkCatchUpBaseline() {
	try {
		const parsed = JSON.parse(
			readFileSync(WORK_CATCH_UP_BASELINE_PATH, "utf8"),
		);
		return {
			...parsed,
			packages: Array.isArray(parsed.packages) ? parsed.packages : [],
		};
	} catch {
		return { schemaVersion: 1, packages: [] };
	}
}

function npmBin() {
	return process.platform === "win32" ? "npm.cmd" : "npm";
}

function npmLatestVersion(name) {
	if (process.env.WORK_CATCH_UP_OFFLINE === "1") return "";
	try {
		return execFileSync(npmBin(), ["view", name, "version"], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
			timeout: 15_000,
		})
			.trim()
			.replace(/^"|"$/g, "");
	} catch {
		return "";
	}
}

function installedPackageVersion(name) {
	const roots = [
		join(WORKFLOW_REPO_DIR, "node_modules"),
		process.env.APPDATA ? join(process.env.APPDATA, "npm", "node_modules") : "",
		process.env.HOME
			? join(process.env.HOME, ".pi", "agent", "npm", "node_modules")
			: "",
	].filter(Boolean);
	for (const root of roots) {
		try {
			return JSON.parse(readFileSync(join(root, name, "package.json"), "utf8"))
				.version;
		} catch {
			// keep looking
		}
	}
	return "";
}

function writeWorkCatchUpDiff(cwd, dir, name, from, to) {
	if (!from || !to || from === to) return undefined;
	const file = join(dir, `${safeArtifactPart(name)}-${from}-to-${to}.diff`);
	try {
		const output = execFileSync(
			npmBin(),
			["diff", `--diff=${name}@${from}`, `--diff=${name}@${to}`],
			{
				cwd,
				encoding: "utf8",
				stdio: ["ignore", "pipe", "pipe"],
				maxBuffer: 2_000_000,
				timeout: 30_000,
			},
		);
		writeFileSync(file, output || "(no diff output)\n");
		return file;
	} catch (error) {
		const output = [error?.stdout, error?.stderr]
			.filter(Boolean)
			.map(String)
			.join("\n")
			.trim();
		writeFileSync(file, `${output || String(error)}\n`);
		return file;
	}
}

function buildWorkCatchUpState(cwd) {
	if (!workResumeSettings(cwd).selfImproving) {
		return {
			ok: false,
			reason: "self-improving-off",
			message:
				"/work-catch-up is available only when .pi/settings.json has workResume.selfImproving: true.",
		};
	}
	const baseline = readWorkCatchUpBaseline();
	const dir = join(
		cwd,
		CONFIG_DIR_NAME,
		"work-catch-up",
		new Date().toISOString().replace(/[:.]/g, "-"),
	);
	mkdirSync(dir, { recursive: true });
	const packages = baseline.packages.map((item) => {
		const name = String(item.name ?? "").trim();
		const baselineVersion = String(item.version ?? "").trim();
		const latestVersion = npmLatestVersion(name);
		const installedVersion = installedPackageVersion(name);
		const targetVersion = latestVersion || installedVersion || baselineVersion;
		const diffPath = writeWorkCatchUpDiff(
			cwd,
			dir,
			name,
			baselineVersion,
			targetVersion,
		);
		return {
			name,
			baselineVersion,
			installedVersion,
			latestVersion,
			targetVersion,
			changed: Boolean(baselineVersion && targetVersion !== baselineVersion),
			diffPath,
		};
	});
	const summaryPath = join(dir, "summary.json");
	const state = {
		ok: true,
		baselinePath: WORK_CATCH_UP_BASELINE_PATH,
		artifactDir: dir,
		summaryPath,
		capturedAt: baseline.capturedAt,
		packages,
	};
	writeFileSync(summaryPath, JSON.stringify(state, null, 2));
	return state;
}

function renderWorkCatchUpText(state) {
	if (!state.ok) return state.message;
	const changed = state.packages.filter((pkg) => pkg.changed);
	return [
		`Work catch-up: ${changed.length}/${state.packages.length} package(s) changed since baseline`,
		`baseline: ${state.baselinePath}`,
		`artifacts: ${state.artifactDir}`,
		...state.packages.map(
			(pkg) =>
				`- ${pkg.name}: ${pkg.baselineVersion} → ${pkg.targetVersion}${pkg.diffPath ? ` (${relative(state.artifactDir, pkg.diffPath)})` : ""}`,
		),
	].join("\n");
}

function buildWorkCatchUpObjective(state, args = "") {
	const userFocus = String(args ?? "").trim();
	return [
		"Catch ce-workflow up with upstream Pi/Compound/subagent package changes.",
		userFocus ? `User focus: ${userFocus}` : "",
		`Read the catch-up summary first: ${state.summaryPath}`,
		`Diff artifacts live in: ${state.artifactDir}`,
		`Baseline file to update after verified wins: ${state.baselinePath}`,
		"Process:",
		"1. Inspect only changed packages and their diff artifacts.",
		"2. Decide whether each upstream change affects this package or enables a simpler implementation.",
		"3. Implement clear compatibility fixes or obvious new-API wins directly; do not build a generic dependency intelligence system.",
		"4. Ask the user only for no-clear-winner decisions.",
		"5. Run npm run verify:quiet.",
		"6. If verified, update the baseline versions for packages you actually handled.",
		workGoalSelfImprovingAppendix(),
	]
		.filter(Boolean)
		.join("\n\n");
}

async function handleWorkCatchUpCommand(args, pi, ctx) {
	const state = buildWorkCatchUpState(ctx.cwd);
	notify(ctx, renderWorkCatchUpText(state), state.ok ? "info" : "warning");
	if (!state.ok) return;
	if (!state.packages.some((pkg) => pkg.changed)) return;
	await handleWorkGoalCommand(
		buildWorkCatchUpObjective(state, args),
		"self-improving",
		pi,
		ctx,
	);
}

function registerWorkCatchUpCommand(pi, ctx) {
	if (!workResumeSettings(ctx.cwd).selfImproving) return;
	pi.registerCommand("work-catch-up", {
		description:
			"Self-improving upstream dependency catch-up from the recorded release baseline",
		handler: async (args, ctx) => {
			await handleWorkCatchUpCommand(args, pi, ctx);
		},
	});
}

function workProjectAutopilotAppendix() {
	return `Project autopilot policy:
- Treat the target directory as the source of truth: verify git and native work-item store state there before mutating anything.
- Work directly in the current session by default. Intake, target selection, bounded implementation, verification, commit, close, and push are inline/coded work, not separate agents.
- Do not call subagent list or ask an LLM to select a role. When specialization is genuinely required, call the exact role directly: work-planner for ambiguous/large slicing, work-debugger for root-cause failures, work-worker for high-risk isolated writing, work-reviewer for sensitive/large/ambiguous diffs, and work-fixer only for concrete review findings.
- When a specialist is required, launch it async with control.needsAttentionAfterMs=30000 and use wait/status; never block the TUI on a foreground child.
- Never launch work-committer for routine work; use the coded finish helper. Never run a second writer or reviewer when equivalent passing evidence already exists.
- Use /work-resume for one deterministic WorkItem boundary. Use /work-goal only when the user explicitly wants a multi-step autonomous loop.
- Obey the user instruction literally; if it says one task only, stop after one executable WorkItem closes. If it says N tasks, stop after N executable native work-item store close.
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
			options.selfImproving === true ? workGoalSelfImprovingAppendix() : "",
		]
			.filter(Boolean)
			.join("\n\n");
	}
	return [
		prompt,
		options.selfImproving === true ? workGoalSelfImprovingAppendix() : "",
	]
		.filter(Boolean)
		.join("\n\n");
}

function buildWorkResumeGoalObjective(cwd, args = "") {
	const raw = String(args ?? "").trim();
	if (!raw)
		return buildWorkSelfImprovingObjective(cwd, {
			project: true,
			...workResumeSettings(cwd),
		});
	const explicit = parseWorkProjectGoalInput(raw);
	const candidate = explicit.project
		? isAbsolute(explicit.project)
			? explicit.project
			: resolve(cwd, explicit.project)
		: "";
	if (explicit.project && existsSync(candidate))
		return buildWorkSelfImprovingObjective(raw, {
			project: true,
			...workResumeSettings(candidate),
		});
	return buildWorkSelfImprovingObjective(`${cwd} -- ${raw}`, {
		project: true,
		...workResumeSettings(cwd),
	});
}

function isWorkGoal(value) {
	return (
		value &&
		typeof value === "object" &&
		typeof value.id === "string" &&
		typeof value.objective === "string" &&
		[
			"active",
			"paused",
			"needs_human",
			"stopping",
			"stopped",
			"complete",
			"budget_limited",
			"waiting_usage_limit",
		].includes(value.status)
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
	const goal = entry?.data?.goal ?? readWorkState(ctx?.cwd).workGoal;
	return isWorkGoal(goal) && goal.status !== "complete" ? goal : null;
}

function persistWorkGoal(pi, goal = activeWorkGoal, cwd = activeWorkGoalCwd) {
	pi?.appendEntry?.(WORK_GOAL_STATE_ENTRY_TYPE, { goal: goal ?? null });
	if (!cwd) return;
	const state = readWorkState(cwd);
	if (goal) state.workGoal = goal;
	else delete state.workGoal;
	writeWorkState(cwd, state);
}

function formatWorkGoalStatus(goal = activeWorkGoal) {
	if (!goal) return undefined;
	const budget = formatWorkGoalBudget(goal);
	if (goal.status === "needs_human")
		return `${statusIcon("needs_human")} needs human`;
	if (goal.status === "stopping")
		return `${statusIcon("stopping")} stopping… #${goal.iteration ?? 0}${budget ? ` ${budget}` : ""}`;
	if (goal.status === "stopped")
		return `${statusIcon("stopped")} stopped #${goal.iteration ?? 0}${budget ? ` ${budget}` : ""}`;
	if (goal.status === "budget_limited")
		return `${statusIcon("paused")} budget ${budget ?? "reached"} #${goal.iteration ?? 0}`;
	if (goal.status === "waiting_usage_limit")
		return `${statusIcon("paused")} usage wait #${goal.iteration ?? 0}`;
	if (goal.status === "active")
		return `${activeWorkGoalRunning || activeWorkAgent ? `${statusIcon("active")} working` : "▶️ active"} #${goal.iteration ?? 0}${budget ? ` ${budget}` : ""}`;
	return statusLabel(goal.status);
}

function updateWorkGoalStatus(ctx, goal = activeWorkGoal) {
	ctx?.ui?.setStatus?.(WORK_GOAL_STATUS_KEY, formatWorkGoalStatus(goal));
}

function isFailedIssue(issue) {
	const labels = labelsOf(issue);
	return statusOf(issue) === "failed" || labels.includes("wo:failed");
}

function progressBar(complete, total, width = 12) {
	const safeTotal = Math.max(0, Number(total) || 0);
	const safeComplete = Math.max(0, Math.min(safeTotal, Number(complete) || 0));
	const filled = safeTotal ? Math.round((safeComplete / safeTotal) * width) : 0;
	return `[${"█".repeat(filled)}${"░".repeat(width - filled)}]`;
}

function issueProgressText(issue) {
	return [
		titleOf(issue),
		field(issue, "description", "body"),
		field(issue, "design"),
		field(issue, "acceptance"),
		notesOf(issue),
	]
		.filter(Boolean)
		.join("\n");
}

function normalizeProgressText(value) {
	return String(value ?? "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, " ")
		.trim()
		.replace(/\s+/g, " ");
}

function extractImplementationUnits(markdown) {
	const text = String(markdown ?? "");
	const start = text.search(/^##\s+Implementation Units\b/im);
	let section = text;
	if (start >= 0) {
		const rest = text.slice(start);
		const next = rest.slice(1).search(/^##\s+/im);
		section = next >= 0 ? rest.slice(0, next + 1) : rest;
	}
	return [
		...section.matchAll(/^###\s+((?:U|Unit\s*)\d+[\w.-]*)[).:\s-]*(.+)$/gim),
	].map((match) => ({
		key: match[1].replace(/\s+/g, "").replace(/[).:-]+$/, ""),
		title: match[2].trim(),
	}));
}

function planPathForEpic(cwd, epic) {
	const text = issueProgressText(epic);
	const matches = [
		...text.matchAll(/(?:file:|plan-path=)?((?:[A-Za-z]:)?[^\s`'"<>]+\.md)\b/g),
	];
	const candidates = matches
		.map((match) => match[1].replace(/^@/, ""))
		.filter((path) => /(?:^|[\\/])(?:docs[\\/])?plans[\\/]/i.test(path));
	for (const candidate of candidates) {
		const file = isAbsolute(candidate) ? candidate : resolve(cwd, candidate);
		if (existsSync(file)) return file;
	}
	return undefined;
}

function unitMatchesIssue(unit, issue) {
	const text = normalizeProgressText(issueProgressText(issue));
	const key = normalizeProgressText(unit.key);
	if (key && new RegExp(`\\b${key}\\b`, "i").test(text)) return true;
	const title = normalizeProgressText(unit.title);
	if (title.length >= 10 && text.includes(title)) return true;
	const words = title.split(" ").filter((word) => word.length > 3);
	if (words.length < 3) return false;
	const hits = words.filter((word) => text.includes(word)).length;
	return hits >= Math.min(words.length, 4);
}

function planProgressForEpic(cwd, epic, childState) {
	const planPath = planPathForEpic(cwd, epic);
	if (!planPath) return undefined;
	const units = extractImplementationUnits(readFileSync(planPath, "utf8"));
	if (!units.length) return undefined;
	const matched = new Set();
	const closed = new Set();
	for (const slice of childState.slices) {
		for (const [index, unit] of units.entries()) {
			if (!unitMatchesIssue(unit, slice)) continue;
			matched.add(index);
			if (statusOf(slice) === "closed") closed.add(index);
		}
	}
	if (childState.slices.length && matched.size === 0) return undefined;
	return {
		source: "plan",
		total: units.length,
		complete: closed.size,
		created: matched.size,
		unsliced: units.length - matched.size,
		path: relative(cwd, planPath),
	};
}

function projectGoalProgressState(cwd, goal = activeWorkGoal) {
	if (!goal || !["active", "needs_human"].includes(goal.status))
		return undefined;
	if (workWarpMode(goal.mode, goal) !== "project") return undefined;
	if (normalReadGate(cwd)) return undefined;
	let epic = currentRoadmap(cwd);
	if (!epic) return undefined;
	try {
		epic = readWorkItem(cwd, idOf(epic)) ?? epic;
	} catch {
		// list output is enough for the slice fallback.
	}
	const childState = buildEpicChildState(cwd, epic);
	const fallback = {
		source: "slices",
		total: childState.slices.length,
		complete: childState.closed.length,
		created: childState.slices.length,
		unsliced: 0,
	};
	const progress = planProgressForEpic(cwd, epic, childState) ?? fallback;
	const failed = childState.slices.filter(isFailedIssue).length;
	const blocked = childState.slices.filter(
		(issue) => statusOf(issue) !== "closed" && isBlockedIssue(issue),
	).length;
	return {
		title: titleOf(epic),
		...progress,
		failed,
		blocked,
		elapsedMs: Date.now() - (goal.startedAt ?? Date.now()),
	};
}

function renderProjectGoalProgress(state) {
	const total = Number(state.total) || 0;
	const complete = Number(state.complete) || 0;
	const left = Math.max(0, total - complete);
	const noun = state.source === "plan" ? "units" : "slices";
	const unsliced = state.unsliced ? ` · ${state.unsliced} unsliced` : "";
	return `${state.title} ${progressBar(complete, total)} ✅ ${complete}/${total} ${noun} (${left} left${unsliced}) 🔴 ${state.failed} 🟠 ${state.blocked} ⏱️ ${formatDuration(state.elapsedMs)} · ${WORK_SHORTCUT_STATUS}`;
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
	const budget = formatWorkGoalBudget(goal);
	return [
		`Work goal: ${goal.objective}`,
		`Mode: ${goal.mode}`,
		`Status: ${goal.status}`,
		`Iteration: ${goal.iteration ?? 0}${goal.retries ? ` (retries ${goal.retries}/${WORK_GOAL_MAX_RETRIES})` : ""}`,
		goal.status === "waiting_usage_limit" && goal.nextRetryAt
			? `Next usage-limit retry: ${new Date(goal.nextRetryAt).toISOString()}`
			: "",
		budget ? `Tokens: ${budget}${goal.tokenBudget ? " used" : ""}` : "",
		goal.decision
			? `Human decision: ${formatWorkGoalDecision(goal.decision)}`
			: "",
		"Commands: /work-goal pause|resume|clear|status|edit <objective>; /work-goal --tokens 100k <objective>; /work-stop for a clean stop",
	]
		.filter(Boolean)
		.join("\n");
}

function createWorkGoal(mode, objective, tokenBudget, baselineTokens = 0) {
	const now = Date.now();
	return {
		id: telemetryId("wg"),
		mode,
		objective,
		status: "active",
		iteration: 0,
		startedAt: now,
		updatedAt: now,
		tokenBudget,
		tokensUsed: 0,
		baselineTokens,
		retries: 0,
	};
}

function parseTokenBudget(value) {
	const match = /^(\d+(?:\.\d+)?)([km])?$/iu.exec(String(value ?? "").trim());
	if (!match) return undefined;
	const amount = Number(match[1]);
	if (!Number.isFinite(amount) || amount <= 0) return undefined;
	const multiplier =
		match[2]?.toLowerCase() === "m"
			? 1_000_000
			: match[2]?.toLowerCase() === "k"
				? 1_000
				: 1;
	return Math.floor(amount * multiplier);
}

function formatTokenCount(value) {
	const n = Number(value ?? 0);
	if (n < 1_000) return `${n}`;
	if (n < 1_000_000)
		return `${Number.isInteger(n / 1_000) ? n / 1_000 : (n / 1_000).toFixed(1)}k`;
	return `${Number.isInteger(n / 1_000_000) ? n / 1_000_000 : (n / 1_000_000).toFixed(1)}m`;
}

function formatWorkGoalBudget(goal = activeWorkGoal) {
	if (!goal?.tokenBudget) return undefined;
	return `${formatTokenCount(goal.tokensUsed ?? 0)}/${formatTokenCount(goal.tokenBudget)}`;
}

function workGoalTokenTotal(ctx) {
	const branch =
		ctx?.sessionManager?.getBranch?.() ??
		ctx?.sessionManager?.getEntries?.() ??
		[];
	let total = 0;
	for (const entry of branch) {
		if (entry?.type !== "message" || entry?.message?.role !== "assistant")
			continue;
		const usage = entry.message.usage;
		total += Number(usage?.input ?? 0) + Number(usage?.output ?? 0);
	}
	return total;
}

function updateWorkGoalUsage(goal, ctx) {
	if (!goal) return goal;
	const baseline = goal.baselineTokens ?? 0;
	goal.tokensUsed = Math.max(0, workGoalTokenTotal(ctx) - baseline);
	goal.timeUsedSeconds = Math.max(
		0,
		Math.floor((Date.now() - (goal.startedAt ?? Date.now())) / 1000),
	);
	return goal;
}

function isWorkGoalContextOverflow(assistant) {
	const message = String(assistant?.errorMessage ?? "");
	return WORK_GOAL_CONTEXT_OVERFLOW_RE.test(message);
}

function workGoalAssistantErrorText(assistant) {
	return [
		assistant?.errorMessage,
		assistant?.message,
		assistantVisibleText(assistant),
	]
		.filter(Boolean)
		.map(String)
		.join("\n");
}

function isWorkGoalUsageLimit(assistant) {
	return WORK_GOAL_USAGE_LIMIT_RE.test(workGoalAssistantErrorText(assistant));
}

function workGoalUsageLimitRetryDelayMs() {
	const override = Number(process.env.WORK_GOAL_USAGE_LIMIT_RETRY_MS);
	return Number.isFinite(override) && override >= 0
		? override
		: WORK_GOAL_USAGE_LIMIT_RETRY_MS;
}

function isRetryableWorkGoalInterruption(assistant) {
	if (assistant?.stopReason !== "error") return false;
	const message = workGoalAssistantErrorText(assistant);
	if (!message) return false;
	if (isWorkGoalUsageLimit(assistant)) return true;
	if (WORK_GOAL_NON_RETRYABLE_RE.test(message)) return false;
	return (
		isWorkGoalContextOverflow(assistant) || WORK_GOAL_RETRYABLE_RE.test(message)
	);
}

function isContradictoryWorkGoalCompletion(summary) {
	return WORK_GOAL_CONTRADICTORY_COMPLETION_RE.test(String(summary ?? ""));
}

function escapeXmlText(value) {
	return String(value ?? "")
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

function buildWorkGoalSystemPrompt(goal) {
	const budgetLine = goal.tokenBudget
		? `\n- Respect the /work-goal token budget (${formatWorkGoalBudget(goal)} used); the loop pauses at the limit.`
		: "";
	return `Active /work-goal:
<work_goal_objective>
${escapeXmlText(goal.objective)}
</work_goal_objective>

/work-goal management rules:
- The user's objective above is the work prompt; these rules only manage looping, compaction, and human-decision stops.
- Keep working autonomously until the objective is complete and verified.
- Before each continuation, /work-goal will microcompact old reasoning and tool noise; treat native work-item store, git, files, tests, and command output as source of truth.
- Work directly in this session by default. Do not call subagent list, delegate routine implementation/verification/commit work, or launch duplicate reviewers. Spawn one exact named specialist only for large/ambiguous planning, root-cause debugging, high-risk isolated writing, or independent review of sensitive/large changes.
- When any specialist or decision evaluator is required, launch it async with control.needsAttentionAfterMs=30000 and use wait/status; never block the TUI on a foreground child. Treat startup/auth failure as unavailable infrastructure evidence, not a reason to wait indefinitely or retry blindly.
- Prefer coded helpers and deterministic checks over asking an LLM to classify, summarize, validate, stage, commit, close, or choose an agent.
- Do not stop for plan approval, permission to continue, or obvious implementation choices. Pick the clear winner and continue.
- Use ask_user for every question that truly needs human input: product intent, credentials/accounts, destructive or risky action, production/billing/legal impact, ambiguous priority/scope with no clear winner, hardware/environment access, or a target path/project choice you cannot infer. Ask one focused question and continue from its answer.
- If evidence depends on external hardware/account/environment state, use ask_user to ask the user to make that state available. Once they answer that it is available or tell you to proceed, capture/inspect the artifact yourself immediately instead of asking again.
- work_goal_human_decision is only a durable fallback after ask_user is unavailable or cancelled; never use it as the first prompt path. If both tools are unavailable, end with ${WORK_GOAL_DECISION_MARKER}: and the question instead of asking a plain-text question.
- When complete, call work_goal_complete with verification evidence. If the tool is unavailable, end with ${WORK_GOAL_COMPLETE_MARKER}: and the evidence.
- Do not call completion for partial progress, blockers, failing tests, or unverified work. Summaries that say the work is incomplete or tests still fail are rejected.${budgetLine}`;
}

function buildWorkGoalKickoffPrompt(goal) {
	return `Work-goal mode is active. Complete this objective fully:\n\n<work_goal_objective>\n${escapeXmlText(goal.objective)}\n</work_goal_objective>\n\n${workGoalMarkerComment(workGoalContinuationMarker(goal))}`;
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
	return `Continue the active /work-goal until it is complete. ${note}\n\n<work_goal_objective>\n${escapeXmlText(goal.objective)}\n</work_goal_objective>\n\nAutomatic continuation #${goal.iteration}. If the human answer asked you to perform an action, do that action first before unrelated work. Do not ask the same question again unless the answer is impossible to act on. Use ask_user for real human-decision blockers; use work_goal_human_decision only if ask_user is unavailable or cancelled. Otherwise choose the clear winner and continue.\n\n${workGoalMarkerComment(marker)}`;
}

function buildWorkGoalCompactInstructions(goal) {
	return `work-context work-goal microcompact: preserve the active /work-goal objective, human decisions, native work-item store/git state, files changed/read, blockers, verification evidence, and next step. Omit old reasoning and full tool logs. Objective: ${truncate(goal.objective, 1_200)}`;
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
	if (
		goal.mode === "project" &&
		workResumeSettings(activeWorkGoalCwd ?? ctx.cwd).newSessionBetweenIterations
	) {
		const queued = await sendWorkGoalPrompt(
			pi,
			ctx,
			`/${WORK_GOAL_RESET_COMMAND} ${goal.id} ${marker}`,
		);
		if (!queued && workGoalContinuationPending?.marker === marker)
			workGoalContinuationPending = null;
		return queued;
	}
	const sent = await microCompactThenSendWorkGoalPrompt(pi, ctx, goal, prompt);
	if (!sent && workGoalContinuationPending?.marker === marker)
		workGoalContinuationPending = null;
	return sent;
}

async function sendWorkGoalAnswerContinuation(pi, ctx, goal, note = "") {
	if (workGoalContinuationPending?.goalId === goal.id) return false;
	const marker = workGoalContinuationMarker(goal);
	const prompt = buildWorkGoalContinuePrompt(goal, marker, note);
	workGoalContinuationPending = {
		goalId: goal.id,
		marker,
		iteration: goal.iteration,
	};
	const sent = await sendWorkGoalPrompt(pi, ctx, prompt);
	if (!sent && workGoalContinuationPending?.marker === marker)
		workGoalContinuationPending = null;
	return sent;
}

function scheduleWorkGoalUsageLimitRetry(pi, ctx, goal = activeWorkGoal) {
	clearWorkGoalUsageLimitTimer();
	if (!goal || goal.status !== "waiting_usage_limit") return;
	const delayMs = Math.max(
		0,
		Number(goal.nextRetryAt ?? Date.now()) - Date.now(),
	);
	workGoalUsageLimitTimer = setTimeout(async () => {
		workGoalUsageLimitTimer = null;
		if (
			!activeWorkGoal ||
			activeWorkGoal.id !== goal.id ||
			activeWorkGoal.status !== "waiting_usage_limit"
		)
			return;
		activeWorkGoal = {
			...activeWorkGoal,
			status: "active",
			nextRetryAt: undefined,
			updatedAt: Date.now(),
		};
		persistWorkGoal(pi);
		updateWorkGoalStatus(ctx);
		ctx.ui.notify("/work-goal usage limit wait elapsed; retrying.", "info");
		const sent = await sendWorkGoalAnswerContinuation(
			pi,
			ctx,
			activeWorkGoal,
			"The previous turn hit a usage/rate limit. Resume exactly where you left off; re-check native work-item store/git and continue.",
		);
		if (!sent && activeWorkGoal?.id === goal.id) {
			activeWorkGoal = {
				...activeWorkGoal,
				status: "waiting_usage_limit",
				nextRetryAt: Date.now() + workGoalUsageLimitRetryDelayMs(),
				updatedAt: Date.now(),
			};
			persistWorkGoal(pi);
			updateWorkGoalStatus(ctx);
			scheduleWorkGoalUsageLimitRetry(pi, ctx, activeWorkGoal);
		}
	}, delayMs);
	workGoalUsageLimitTimer.unref?.();
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
		formatDecisionBlock("❓ Question", decision.question),
		formatDecisionBlock("🧭 Why user needed", decision.whyUserNeeded),
		formatDecisionBlock("🔢 Options", decision.options, true),
		formatDecisionBlock("💡 Recommendation", decision.recommendation),
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
			completed: false,
		};
	}
	const trimmed = String(summary ?? "").trim();
	const rejection = !trimmed
		? "summary is empty"
		: isContradictoryWorkGoalCompletion(trimmed)
			? "summary says the goal is not complete"
			: undefined;
	if (rejection) {
		updateWorkGoalUsage(goal, ctx);
		persistWorkGoal(pi);
		ctx.ui.notify(`/work-goal completion rejected: ${rejection}.`, "warning");
		return {
			content: [
				{
					type: "text",
					text: `Goal completion rejected: ${rejection}. The goal is NOT complete; keep working and only call work_goal_complete once it is fully done and verified.`,
				},
			],
			details: { goal: goal.objective, summary: trimmed },
			terminate: false,
			completed: false,
		};
	}
	activeWorkGoal = { ...goal, status: "complete", updatedAt: Date.now() };
	persistWorkGoal(pi, activeWorkGoal);
	activeWorkGoal = null;
	activeWorkGoalRunning = false;
	workGoalContinuationPending = null;
	clearWorkGoalRecovery();
	clearWorkGoalUsageLimitTimer();
	persistWorkGoal(pi, null);
	ctx.ui.setStatus(WORK_GOAL_STATUS_KEY, undefined);
	ctx.ui.setWidget?.(WORK_GOAL_PROGRESS_WIDGET_KEY, undefined);
	ctx.ui.notify(`/work-goal complete: ${truncate(trimmed, 240)}`, "info");
	finishWarpWork(ctx, workWarpMode(goal.mode, goal), trimmed);
	return {
		content: [{ type: "text", text: `/work-goal complete: ${trimmed}` }],
		details: { goal: goal.objective, summary: trimmed },
		terminate: true,
		completed: true,
	};
}

async function startWorkGoal(mode, objective, pi, ctx, tokenBudget) {
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
	clearWorkGoalRecovery();
	clearWorkGoalUsageLimitTimer();
	activeWorkGoal = createWorkGoal(
		mode,
		text,
		tokenBudget,
		workGoalTokenTotal(ctx),
	);
	activeWorkGoalCwd = ctx.cwd;
	persistWorkGoal(pi);
	updateWorkGoalStatus(ctx);
	ctx.ui.notify(
		`/work-goal started: ${truncate(text, 240)}${tokenBudget ? ` (budget ${formatTokenCount(tokenBudget)})` : ""}`,
		"info",
	);
	await sendWorkGoalPrompt(pi, ctx, buildWorkGoalKickoffPrompt(activeWorkGoal));
}

async function handleWorkGoalCommand(args, mode, pi, ctx) {
	const command = parseWorkGoalCommand(args);
	if (command.error) {
		ctx.ui.notify(command.error, "warning");
		return;
	}
	if (command.kind === "status") {
		ctx.ui.notify(workGoalSummary(), "info");
		updateWorkGoalStatus(ctx);
		return;
	}
	if (command.kind === "clear") {
		const previous = activeWorkGoal?.objective;
		activeWorkGoal = null;
		workGoalContinuationPending = null;
		clearWorkGoalRecovery();
		clearWorkGoalUsageLimitTimer();
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
		clearWorkGoalRecovery();
		clearWorkGoalUsageLimitTimer();
		persistWorkGoal(pi);
		updateWorkGoalStatus(ctx);
		ctx.ui.notify("/work-goal paused.", "info");
		return;
	}
	if (command.kind === "resume") {
		if (
			!activeWorkGoal ||
			![
				"paused",
				"budget_limited",
				"needs_human",
				"stopped",
				"waiting_usage_limit",
			].includes(activeWorkGoal.status)
		) {
			ctx.ui.notify("No paused /work-goal to resume.", "warning");
			return;
		}
		clearWorkGoalRecovery();
		clearWorkGoalUsageLimitTimer();
		activeWorkGoal = {
			...activeWorkGoal,
			status: "active",
			decision: undefined,
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
				command.answer
					? `User resumed the goal with this answer:\n\n${truncate(command.answer, 2_000)}`
					: "User resumed the goal.",
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
			tokenBudget: command.tokenBudget ?? activeWorkGoal.tokenBudget,
			status: "active",
			decision: undefined,
			updatedAt: Date.now(),
		};
		clearWorkGoalRecovery();
		clearWorkGoalUsageLimitTimer();
		persistWorkGoal(pi);
		updateWorkGoalStatus(ctx);
		await sendWorkGoalPrompt(
			pi,
			ctx,
			buildWorkGoalKickoffPrompt(activeWorkGoal),
		);
		return;
	}
	await startWorkGoal(mode, command.objective, pi, ctx, command.tokenBudget);
}

async function handleWorkResumeGoalCommand(args, pi, ctx) {
	const raw = String(args ?? "").trim();
	if (!raw && activeWorkGoal?.mode === "project") {
		if (activeWorkGoal.status === "stopping") {
			activeWorkGoal = {
				...activeWorkGoal,
				status: "active",
				stopReason: undefined,
				updatedAt: Date.now(),
			};
			persistWorkGoal(pi);
			updateWorkGoalStatus(ctx);
			ctx.ui.notify("/work-resume stop canceled.", "info");
			return;
		}
		if (
			["paused", "stopped", "waiting_usage_limit"].includes(
				activeWorkGoal.status,
			)
		)
			return handleWorkGoalCommand("resume", "project", pi, ctx);
		return handleWorkGoalCommand("status", "project", pi, ctx);
	}
	const command = raw
		? parseWorkGoalCommand(raw)
		: { kind: "start", objective: "" };
	if (command.kind !== "start" && command.kind !== "edit")
		return handleWorkGoalCommand(raw, "project", pi, ctx);
	const objective = buildWorkResumeGoalObjective(ctx.cwd, command.objective);
	return command.kind === "edit"
		? handleWorkGoalCommand(`edit ${objective}`, "project", pi, ctx)
		: startWorkGoal("project", objective, pi, ctx);
}

async function handleWorkResumeStopCommand(args, pi, ctx) {
	const reason = String(args ?? "").trim() || "user requested stop";
	const send =
		typeof ctx.sendUserMessage === "function"
			? ctx.sendUserMessage.bind(ctx)
			: pi?.sendUserMessage?.bind(pi);
	const prompt =
		"Clean stop requested. Checkpoint current native work-item store/git state, stop at the next safe phase boundary, and do not start another WorkItem.";
	if (activeWorkGoal) {
		const working = activeWorkAgent || !ctx.isIdle?.();
		activeWorkGoal = {
			...activeWorkGoal,
			status: working ? "stopping" : "stopped",
			stopReason: reason,
			updatedAt: Date.now(),
		};
		workGoalContinuationPending = null;
		persistWorkGoal(pi);
		updateWorkGoalStatus(ctx);
		ctx.ui.notify(
			working
				? "/work-stop requested: stopping after the current clean phase."
				: "/work-stop: work stopped. Run /work-resume to resume.",
			"info",
		);
		if (working && send) {
			try {
				if (ctx.isIdle?.()) await send(prompt);
				else await send(prompt, { deliverAs: "steer" });
			} catch {
				// Stop flag is persisted; the current turn may still finish normally.
			}
		}
		return;
	}
	const working = !ctx.isIdle?.();
	ctx.ui.notify(
		working
			? "/work-stop requested: checkpoint and stop at the next safe phase boundary."
			: "/work-stop: nothing active to stop.",
		working ? "info" : "warning",
	);
	if (working && send) {
		try {
			await send(prompt, { deliverAs: "steer" });
		} catch {
			// Best-effort steer; the user can also just stop typing.
		}
	}
}

async function handleWorkMenuCommand(ctx, pi) {
	const action = await choose(ctx, "Work menu", [
		{
			value: "resume",
			label: "resume / cancel stop",
			description: "Run /work-resume",
		},
		{
			value: "stop",
			label: "stop after current phase",
			description: "Run /work-stop",
		},
		{
			value: "roadmap",
			label: "roadmaps",
			description: "Open /work-roadmap",
		},
		{
			value: "status",
			label: "status",
			description: "Show /work-status",
		},
		{
			value: "report",
			label: "blocker report",
			description: "Show /work-report",
		},
	]);
	if (action === "resume") return handleWorkResumeGoalCommand("", pi, ctx);
	if (action === "stop") return handleWorkResumeStopCommand("", pi, ctx);
	if (action === "roadmap") return handleWorkRoadmapCommand("", ctx, pi);
	if (action === "status") return handleWorkStatusCommand("", ctx);
	if (action === "report") return handleWorkReportCommand("", ctx);
}

async function handleWorkGoalResetCommand(args, ctx) {
	const [goalId, marker] = String(args ?? "")
		.trim()
		.split(/\s+/, 2);
	const goal = activeWorkGoal;
	if (!goal || goal.status !== "active" || goal.id !== goalId) return;
	if (typeof ctx.newSession !== "function") {
		await ctx.sendUserMessage(
			buildWorkGoalContinuePrompt(
				goal,
				marker,
				"Session reset unavailable; continuing in-place.",
			),
		);
		return;
	}
	const prompt = buildWorkGoalContinuePrompt(
		goal,
		marker || workGoalContinuationMarker(goal),
		"Started in a fresh session; resume from native work-item store/git and avoid relying on prior chat.",
	);
	const parentSession = ctx.sessionManager?.getSessionFile?.();
	const result = await ctx.newSession({
		parentSession,
		withSession: async (nextCtx) => {
			await nextCtx.sendUserMessage(prompt);
		},
	});
	if (result?.cancelled) {
		workGoalContinuationPending = null;
		ctx.ui.notify("Work-goal session reset cancelled", "warning");
	}
}

function buildWorkGoalPausedPrompt(goal) {
	return `Paused /work-goal waiting for a human decision:
<work_goal_objective>
${escapeXmlText(goal.objective)}
</work_goal_objective>

Pending decision:
${formatWorkGoalDecision(goal.decision)}

Answer the user's clarification only. Ordinary chat never resumes this goal; only \`/work-goal resume <answer>\` does.`;
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
	if (
		!activeWorkGoal ||
		!["active", "stopping"].includes(activeWorkGoal.status)
	)
		return;
	const goal = activeWorkGoal;
	const assistant = finalAssistantMessage(event.messages);
	const text = assistantVisibleText(assistant);
	const completion = parseWorkGoalCompletion(text);
	if (completion) {
		const result = completeActiveWorkGoal(completion, ctx, pi);
		if (result?.completed) return;
		// Rejected completion (empty/contradictory): keep working.
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
	let retrying = false;
	if (
		["aborted", "error"].includes(String(assistant?.stopReason ?? "")) ||
		isWorkGoalUsageLimit(assistant)
	) {
		if (isWorkGoalUsageLimit(assistant)) {
			const nextRetryAt = Date.now() + workGoalUsageLimitRetryDelayMs();
			activeWorkGoal = {
				...goal,
				status: "waiting_usage_limit",
				usageLimitRetries: (goal.usageLimitRetries ?? 0) + 1,
				nextRetryAt,
				updatedAt: Date.now(),
			};
			workGoalContinuationPending = null;
			clearWorkGoalRecovery();
			persistWorkGoal(pi);
			updateWorkGoalStatus(ctx);
			scheduleWorkGoalUsageLimitRetry(pi, ctx, activeWorkGoal);
			ctx.ui.notify(
				`/work-goal hit a usage/rate limit; retrying in ${formatDuration(nextRetryAt - Date.now())}.`,
				"warning",
			);
			return;
		}
		if (isRetryableWorkGoalInterruption(assistant)) {
			const nextRetries = (goal.retries ?? 0) + 1;
			if (nextRetries > WORK_GOAL_MAX_RETRIES) {
				activeWorkGoal = {
					...goal,
					status: "paused",
					retries: 0,
					updatedAt: Date.now(),
				};
				clearWorkGoalRecovery();
				persistWorkGoal(pi);
				updateWorkGoalStatus(ctx);
				ctx.ui.notify(
					"/work-goal paused after repeated transient errors. Run /work-goal resume to retry.",
					"warning",
				);
				return;
			}
			retrying = true;
			workGoalRecovery = {
				goalId: goal.id,
				kind: isWorkGoalContextOverflow(assistant)
					? "compaction_retry"
					: "provider_retry",
			};
			ctx.ui.notify(
				`/work-goal hit a transient error (retry ${nextRetries}/${WORK_GOAL_MAX_RETRIES}); continuing.`,
				"info",
			);
		} else {
			activeWorkGoal = { ...goal, status: "paused", updatedAt: Date.now() };
			clearWorkGoalRecovery();
			persistWorkGoal(pi);
			updateWorkGoalStatus(ctx);
			ctx.ui.notify(
				"/work-goal paused after interruption. Run /work-goal resume to continue.",
				"warning",
			);
			return;
		}
	} else {
		clearWorkGoalRecovery();
	}
	if (goal.status === "stopping") {
		activeWorkGoal = { ...goal, status: "stopped", updatedAt: Date.now() };
		persistWorkGoal(pi);
		updateWorkGoalStatus(ctx);
		ctx.ui.notify("/work-resume stopped. Run /work-resume to resume.", "info");
		finishWarpWork(ctx, workWarpMode(goal.mode, goal), "stopped");
		return;
	}
	activeWorkGoal = {
		...goal,
		iteration: (goal.iteration ?? 0) + 1,
		retries: retrying ? (goal.retries ?? 0) + 1 : 0,
		updatedAt: Date.now(),
	};
	updateWorkGoalUsage(activeWorkGoal, ctx);
	persistWorkGoal(pi);
	updateWorkGoalStatus(ctx);
	if (
		activeWorkGoal.tokenBudget !== undefined &&
		activeWorkGoal.tokensUsed >= activeWorkGoal.tokenBudget
	) {
		workGoalContinuationPending = null;
		activeWorkGoal = {
			...activeWorkGoal,
			status: "budget_limited",
			updatedAt: Date.now(),
		};
		persistWorkGoal(pi);
		updateWorkGoalStatus(ctx);
		ctx.ui.notify(
			`/work-goal token budget reached: ${formatWorkGoalBudget(activeWorkGoal)}. Run /work-goal resume to continue over budget or /work-goal edit --tokens <N> <objective> to raise it.`,
			"warning",
		);
		return;
	}
	const note = retrying
		? "The previous turn ended with a transient error. Resume from where you left off; re-check files, tests, and command output."
		: /\?\s*$/.test(String(text).trim())
			? "Your last response ended with a non-blocking question; answer it yourself by choosing the clear winner."
			: "";
	if (workGoalHasPendingMessages(ctx)) {
		workGoalContinuationRetry = { goalId: activeWorkGoal.id, note };
		return;
	}
	if (retrying)
		await sendWorkGoalAnswerContinuation(pi, ctx, activeWorkGoal, note);
	else await sendWorkGoalContinuation(pi, ctx, activeWorkGoal, note);
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

function unsupportedPrintWorkflow(ctx) {
	if (!["print", "json"].includes(ctx.mode)) return undefined;
	const state = {
		ok: false,
		action: "unsupported-mode",
		message:
			"Work commands that launch implementation turns require TUI or RPC mode. Print/JSON mode stopped before creating or claiming a WorkItem.",
	};
	notify(ctx, state.message, "warning");
	return state;
}

async function sendWorkflowFollowUp(ctx, message, pi, state) {
	const metadata = workflowPromptMetadata();
	if (metadata.length && !String(message).includes("Workflow Run ID:"))
		message = `${message}\n${metadata.join("\n")}`;
	const tokens = ctx.getContextUsage?.()?.tokens ?? 0;
	let compactEnabled = true;
	try {
		compactEnabled = contextSettings(readSettings(ctx.cwd)).enabled !== false;
	} catch {
		// Keep the safe default when project settings are unreadable.
	}
	if (
		!compactEnabled ||
		!state.inlineWork ||
		tokens < 32_000 ||
		typeof ctx.compact !== "function" ||
		["print", "json"].includes(ctx.mode)
	)
		return sendFollowUp(ctx, message, pi);
	contextCompactState.inFlight = true;
	contextCompactState.requested = true;
	return new Promise((resolvePromise) => {
		let settled = false;
		const finish = async () => {
			if (settled) return;
			settled = true;
			contextCompactState.inFlight = false;
			contextCompactState.requested = false;
			resolvePromise(await sendFollowUp(ctx, message, pi));
		};
		try {
			ctx.compact({
				customInstructions:
					"work-context: keep current repo state, decisions, modified files, verification, and WorkItem IDs; the queued handoff is self-contained.",
				onComplete: finish,
				onError: finish,
			});
		} catch {
			finish();
		}
	});
}

async function handleWorkResumeCommand(args, ctx, pi, selectionNote = "") {
	const unsupported = unsupportedPrintWorkflow(ctx);
	if (unsupported) return unsupported;
	cleanupBenignInstructionDirt(ctx.cwd);
	const state = buildWorkResumeState(ctx.cwd, args);
	rememberRecommendedActions(ctx.cwd, recommendedActions(state), "work-resume");
	const direct = state.ok
		? directRoleHandoffParams(state, ctx.cwd, selectionNote)
		: null;
	notify(
		ctx,
		renderWorkResumeText(
			direct
				? { ...state, nextAction: `Next: ${direct.agent} queued directly` }
				: state,
		),
		state.ok ? "info" : "warning",
	);
	if (direct) {
		const spawned = await spawnSubagentRpc(pi, direct.params);
		if (spawned.ok) {
			recordSpawnedDirectRun(ctx.cwd, state, direct, spawned);
			return {
				...markDirectHandoffStarted(ctx.cwd, state),
				directHandoff: direct,
			};
		}
		if (spawned.ambiguous)
			recordSpawnedDirectRun(ctx.cwd, state, direct, spawned);
		notify(
			ctx,
			spawned.ambiguous
				? `Direct ${direct.agent} acknowledgement timed out; not launching a duplicate. Check the active-run widget before retrying.`
				: `Required ${direct.agent} could not start (${spawned.message}); stopped without inline fallback.`,
			"warning",
		);
		return {
			...state,
			handoffPending: Boolean(spawned.ambiguous),
			handoffFailed: !spawned.ambiguous,
		};
	}
	if (state.handoffPrompt)
		await sendWorkflowFollowUp(
			ctx,
			withSelectionNote(state.handoffPrompt, selectionNote),
			pi,
			state,
		);
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
		state.selectedWorkItem
			? `WorkItem: ${state.selectedWorkItem.id} — ${state.selectedWorkItem.title}`
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

async function handleWorkflowAction(
	builder,
	args,
	ctx,
	pi,
	selectionNote = "",
) {
	const unsupported = unsupportedPrintWorkflow(ctx);
	if (unsupported) return unsupported;
	cleanupBenignInstructionDirt(ctx.cwd);
	const state = builder(ctx.cwd, args);
	rememberRecommendedActions(ctx.cwd, recommendedActions(state), "work-action");
	const direct = state.ok
		? directRoleHandoffParams(state, ctx.cwd, selectionNote)
		: null;
	notify(
		ctx,
		renderWorkflowActionText(
			direct
				? { ...state, nextAction: `Next: ${direct.agent} queued directly` }
				: state,
		),
		state.ok ? "info" : "warning",
	);
	if (direct) {
		const spawned = await spawnSubagentRpc(pi, direct.params);
		if (spawned.ok) {
			recordSpawnedDirectRun(ctx.cwd, state, direct, spawned);
			return {
				...markDirectHandoffStarted(ctx.cwd, state),
				directHandoff: direct,
			};
		}
		if (spawned.ambiguous) {
			recordSpawnedDirectRun(ctx.cwd, state, direct, spawned);
			notify(
				ctx,
				`Direct ${direct.agent} handoff acknowledgement timed out. Not launching a fallback because the role may already be running; retry /work-resume only after checking the active-run widget.`,
				"warning",
			);
			return { ...state, handoffPending: true };
		}
		notify(
			ctx,
			`Required ${direct.agent} could not start before acceptance (${spawned.message}); stopped without inline fallback.`,
			"warning",
		);
		return { ...state, handoffFailed: true };
	}
	if (state.handoffPrompt)
		await sendWorkflowFollowUp(
			ctx,
			withSelectionNote(state.handoffPrompt, selectionNote),
			pi,
			state,
		);
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
		label: `${label}: ${item.id} [${statusLabel(item.status)}] ${item.title}`,
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
	const [group, workItemId] = task.split(":", 2);
	const ops = [{ value: "summary", label: "summary" }];
	if (group === "blocker")
		ops.push({ value: "debug", label: "debug / full info" });
	const op = await choose(ctx, `${workItemId}: operation`, ops);
	if (op === "debug")
		return handleWorkflowAction(buildWorkDebugState, workItemId, ctx, pi);
	return handleWorkReportCommand(workItemId, ctx);
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
		"🗺️ Work roadmaps",
		list.roadmaps.map((epic) => ({
			value: epic.id,
			label: `${epic.current ? "* " : ""}${epic.id} [${statusLabel(epic.status)}] ${epic.title}`,
		})),
	);
	if (!selected) return { ok: true, action: "roadmap-cancel" };
	const op = await choose(ctx, `${selected}: operation`, [
		{
			value: "resume",
			label: "▶️ work-resume",
			description: "autonomous project loop for this roadmap",
		},
		{
			value: "tasks",
			label: "📋 list tasks",
			description: "blockers, open, closed",
		},
		{
			value: "plan",
			label: "🧭 plan / strengthen",
			description: "use linked brainstorm/plan",
		},
		{ value: "set-current", label: "⭐ set current" },
		{
			value: "close",
			label: "✅ close",
			description: "asks before unresolved tasks",
		},
		{ value: "reopen", label: "♻️ reopen" },
		{ value: "report", label: "📄 full report" },
	]);
	if (!op) return { ok: true, action: "roadmap-cancel" };
	if (op === "resume") return handleWorkResumeGoalCommand(selected, pi, ctx);
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

function parseNumberedWorkActionInput(text) {
	const value = String(text ?? "").trim();
	let match = value.match(/^(\d+)$/);
	if (match) return { number: Number(match[1]), note: "" };
	match =
		value.match(/^(\d+)\s*[).,:-]\s*(.*)$/) ?? value.match(/^(\d+)\s+(.+)$/);
	if (!match) return null;
	return { number: Number(match[1]), note: String(match[2] ?? "").trim() };
}

function withSelectionNote(prompt, note) {
	const text = String(note ?? "").trim();
	return text
		? `${prompt}\n\nHuman note from numbered selection:\n${truncate(text, 2_000)}`
		: prompt;
}

function recentNumberedWorkAction(cwd, number) {
	const last = readWorkState(cwd).lastActions;
	const ageMs = Date.now() - Date.parse(last?.updatedAt ?? "");
	if (
		!last?.actions?.length ||
		!Number.isFinite(ageMs) ||
		ageMs > 60 * 60 * 1000
	)
		return null;
	return last.actions[number - 1] ?? null;
}

async function executeNumberedWorkAction(action, ctx, pi, selectionNote = "") {
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
		"work-remove-beads": buildWorkRemoveBeadsState,
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
	else if (command === "work-resume")
		await withCommandTelemetry(
			command,
			args,
			ctx,
			() => handleWorkResumeCommand(args, ctx, pi, selectionNote),
			true,
		);
	else if (builders[command])
		await withCommandTelemetry(
			command,
			args,
			ctx,
			() =>
				handleWorkflowAction(builders[command], args, ctx, pi, selectionNote),
			true,
		);
	else return false;
	return true;
}

async function maybeRunNumberedWorkAction(event, ctx, pi) {
	if (event.source === "extension") return false;
	if (activeWorkGoal?.status === "needs_human") return false;
	const parsed = parseNumberedWorkActionInput(event.text);
	if (!parsed) return false;
	const action = recentNumberedWorkAction(ctx.cwd, parsed.number);
	if (!action) return false;
	notify(ctx, `Running ${parsed.number}. ${action}`, "info");
	return executeNumberedWorkAction(action, ctx, pi, parsed.note);
}

export {
	buildWorkAddState,
	buildWorkAutoState,
	classifyAutoTask,
	implementationExecutionPolicy,
	buildWorkGoalSystemPrompt,
	buildWorkSelfImprovingObjective,
	buildWorkBigState,
	buildWorkDebugState,
	buildWorkFinishState,
	executeWorkFinishState,
	buildWorkIdeateState,
	buildWorkBrainstormState,
	buildWorkCatchUpState,
	buildWorkCatchUpObjective,
	captureIdeationIdeas,
	brainstormHandoffPrompt,
	buildWorkflowIntakeState,
	buildWorkInitState,
	buildWorkMasterState,
	buildWorkMedState,
	buildWorkPlanState,
	buildWorkMigrateState,
	buildWorkRemoveBeadsState,
	buildWorkPauseState,
	buildWorkReport,
	buildWorkReportState,
	buildWorkRoadmapState,
	buildWorkResume,
	buildWorkResumeState,
	buildWorkSmallState,
	buildWorkStatus,
	buildWorkTelemetry,
	buildWorkTelemetryState,
	buildWorkUsageState,
	changedFilesSummary,
	compactTaskSummary,
	evidenceSummaryPath,
	forbiddenPatternCheck,
	jsonlRecordDiff,
	jsonlRecordSummary,
	onlyAllowedFilesChanged,
	optimizationTelemetry,
	prepareTaskExportForGate,
	reconcileTranscriptTelemetry,
	readEvidenceSummary,
	runBounded,
	runTempCheck,
	searchSummary,
	stagedFilesSummary,
	workflowTaskSummary,
	writeEvidenceSummary,
	directRoleHandoffParams,
	executeNumberedWorkAction,
	completeWorkflowOnce,
	withCommandTelemetry,
	parseWorkPromptMeta,
	reconcilePendingDirectRuns,
	recordPendingDirectRun,
	recordSpawnedDirectRun,
	deriveIdeaStatus,
	isIdeaIssue,
	parseIdeationIdeas,
	recordWorkTelemetry,
	handleWorkResumeCommand,
	handleWorkRoadmapCommand,
	extractImplementationUnits,
	parseWorkGoalCommand,
	parseTokenBudget,
	formatTokenCount,
	isContradictoryWorkGoalCompletion,
	isRetryableWorkGoalInterruption,
	isWorkGoalContextOverflow,
	isWorkGoalUsageLimit,
	parseWorkProjectGoalInput,
	planResumeAction,
	progressBar,
	applyProfile,
	setWorkOrchBoolean,
	setWorkOrchReviewLevel,
	setWorkOrchSliceExecution,
	setWorkOrchCritic,
	workOrchSettings,
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
	workWarpMode,
	workWarpTitle,
};

export default function workModelsExtension(pi) {
	workExtensionPi = pi;
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
				"Durably pause the active /work-goal only when ask_user is unavailable or cancelled. Never use this as the first prompt path.",
			promptSnippet:
				"Persist a human-decision blocker only after ask_user is unavailable or cancelled",
			promptGuidelines: [
				"Use ask_user for every interactive work-goal question; use work_goal_human_decision only as a durable fallback when ask_user is unavailable or cancelled.",
				"Do not use work_goal_human_decision for plan approval, permission to continue, clear-winner choices, or artifacts the agent can capture.",
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

	pi.on("tool_call", (event, ctx) => {
		if (
			event.toolName === "work_goal_human_decision" &&
			ctx.hasUI &&
			pi.getActiveTools?.().includes("ask_user")
		)
			return {
				block: true,
				reason:
					"Use ask_user for the interactive decision. work_goal_human_decision is only a non-interactive fallback.",
			};
	});

	pi.on("session_start", (_event, ctx) => {
		const runtime = {
			pi,
			mode: ctx.mode,
			session: ctx.sessionManager?.getSessionId?.(),
		};
		if (ctx.mode !== "print") reconcilePendingDirectRuns(ctx.cwd, runtime);
		registerWorkCatchUpCommand(pi, ctx);
		activeWorkGoalCwd = ctx.cwd;
		activeWorkGoal = loadWorkGoalFromSession(ctx);
		if (activeWorkGoal?.status === "active") {
			activeWorkGoal = {
				...activeWorkGoal,
				status: "paused",
				updatedAt: Date.now(),
			};
			persistWorkGoal(pi);
		}
		activeWorkGoalRunning = false;
		pendingWorkGoalTurn = false;
		workGoalContinuationPending = null;
		clearWorkGoalRecovery();
		if (activeWorkGoal?.status === "waiting_usage_limit")
			scheduleWorkGoalUsageLimitRetry(pi, ctx, activeWorkGoal);
		updateWorkGoalStatus(ctx);
		updateWorkGoalProgress(ctx);
		ctx.ui.notify("work-orchestrator loaded · F7 roadmaps · F8 menu", "info");
		resetWarpTitle(ctx);
		startWorkGoalProgressTimer(ctx);
		if (workResumeSettings(ctx.cwd).selfImproving && ctx.mode !== "print")
			void (async () => {
				await recoverTerminalWorkflowClaims(ctx.cwd, runtime);
				const runner = await import(
					pathToFileURL(
						join(WORKFLOW_REPO_DIR, "scripts", "work-improvement-runner.mjs"),
					).href
				);
				const settings = readSettings(ctx.cwd);
				const resolved = runner.resolveSourceCheckout({
					settings,
					packageRoot: WORKFLOW_REPO_DIR,
					baseCwd: ctx.cwd,
				});
				if (!resolved.ok) {
					recordImprovementError(ctx.cwd, {}, resolved.reason);
					return;
				}
				await runner.reconcileAutonomousImprovement(
					resolved.sourceCwd,
					{ session: runtime.session },
					{
						dispatchAgent: (payload) =>
							dispatchWorkflowImprovementAgent(pi, payload),
						runPackageVerify: async ({ cwd }) => {
							try {
								execFileSync(
									process.execPath,
									["scripts/verify-package.mjs", "--quiet"],
									{ cwd, stdio: "pipe", timeout: 2 * 60 * 1000 },
								);
								return { passed: true };
							} catch (error) {
								return {
									passed: false,
									output: truncate(error?.message ?? error, 300),
								};
							}
						},
						runBenchmarkGate: (request) =>
							runner.runAutonomousImprovementBenchmark(
								resolved.sourceCwd,
								request,
								(payload) => dispatchWorkflowImprovementAgent(pi, payload),
							),
						onReleaseError: (error) =>
							recordImprovementError(
								ctx.cwd,
								{},
								"startup-lease-release-failed",
								error.reason,
							),
					},
				);
			})().catch((error) =>
				recordImprovementError(ctx.cwd, {}, "startup-recovery-failed", error),
			);
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		persistWorkGoal(pi);
		clearWorkGoalUsageLimitTimer();
		ctx.ui.setStatus(WORK_GOAL_STATUS_KEY, undefined);
		stopWorkGoalProgressTimer(ctx);
		const active = [...activeImprovementRuns.values()].filter(
			(run) => run.cwd === ctx.cwd,
		);
		for (const run of active)
			run.controller.abort(new Error("session shutdown"));
		if (active.length) {
			let timer;
			const settled = await Promise.race([
				Promise.allSettled(active.map((run) => run.promise)).then(() => true),
				new Promise((resolveWait) => {
					timer = setTimeout(() => resolveWait(false), 2_000);
				}),
			]);
			clearTimeout(timer);
			if (!settled)
				recordImprovementError(ctx.cwd, {}, "shutdown-cleanup-deferred");
		}
	});

	pi.on("input", async (event, ctx) => {
		reconcilePendingDirectRuns(ctx.cwd, {
			pi,
			mode: ctx.mode,
			session: ctx.sessionManager?.getSessionId?.(),
		});
		recordSelfImprovementHistory(ctx, "input", event);
		if (!extractWorkGoalContinuationMarker(event.text)) clearWorkGoalRecovery();
		const parsed = parseNumberedWorkActionInput(event.text);
		if (parsed && recentNumberedWorkAction(ctx.cwd, parsed.number)) {
			if (await maybeRunNumberedWorkAction(event, ctx, pi))
				return { action: "handled" };
		}
	});

	pi.on("before_agent_start", async (event, ctx) => {
		markWorkGoalContinuationDelivered(event.prompt);
		const marker = extractWorkGoalContinuationMarker(event.prompt);
		pendingWorkGoalTurn = Boolean(
			activeWorkGoal && marker?.startsWith(`${activeWorkGoal.id}:`),
		);
		if (pendingWorkGoalTurn && activeWorkGoal?.status === "paused") {
			activeWorkGoal = {
				...activeWorkGoal,
				status: "active",
				updatedAt: Date.now(),
			};
			persistWorkGoal(pi);
			updateWorkGoalStatus(ctx);
		}
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
		recordSelfImprovementHistory(ctx, "before_agent_start", event);
		if (!activeWorkGoal) return;
		if (activeWorkGoal.status === "needs_human") {
			return {
				systemPrompt: `${event.systemPrompt}\n\n${buildWorkGoalPausedPrompt(activeWorkGoal)}`,
			};
		}
		if (activeWorkGoal.status !== "active" || !pendingWorkGoalTurn) return;
		return {
			systemPrompt: `${event.systemPrompt}\n\n${buildWorkGoalSystemPrompt(activeWorkGoal)}`,
		};
	});

	pi.on("agent_start", async (event, ctx) => {
		recordSelfImprovementHistory(ctx, "agent_start", event);
		activeWorkGoalRunning = pendingWorkGoalTurn;
		pendingWorkGoalTurn = false;
		if (!pendingWorkPrompt) {
			if (
				activeWorkGoalRunning &&
				["active", "stopping"].includes(activeWorkGoal?.status)
			) {
				startWarpWork(
					ctx,
					workWarpMode(activeWorkGoal.mode, activeWorkGoal),
					activeWorkGoal.objective,
				);
				updateWorkGoalStatus(ctx);
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
		const evaluationIdentity = evaluationTelemetryIdentity({ role: "main" });
		if (evaluationIdentity)
			recordWorkTelemetry(activeWorkAgent.cwd, {
				type: "agent-dispatched",
				...evaluationIdentity,
				startedAt: new Date(activeWorkAgent.startedAt).toISOString(),
			});
		updateWorkGoalStatus(ctx);
		pendingWorkPrompt = null;
	});

	pi.on("tool_execution_start", async (event, ctx) => {
		recordSelfImprovementHistory(ctx, "tool_execution_start", event);
		if (!activeWorkAgent) return;
		activeWorkAgent.toolStarts.set(event.toolCallId, {
			startedAt: Date.now(),
			args: event.args,
		});
	});

	pi.on("tool_execution_end", async (event, ctx) => {
		recordSelfImprovementHistory(ctx, "tool_execution_end", event);
		updateWorkGoalProgress(ctx);
		if (!activeWorkAgent) return;
		const started = activeWorkAgent.toolStarts.get(event.toolCallId);
		activeWorkAgent.tools.push(summarizeToolResult(event, started));
		activeWorkAgent.toolStarts.delete(event.toolCallId);
	});

	pi.on("agent_end", async (event, ctx) => {
		recordSelfImprovementHistory(ctx, "agent_end", event);
		if (!activeWorkAgent) {
			const wasWorkGoalTurn = activeWorkGoalRunning;
			activeWorkGoalRunning = false;
			const hadWorkGoal = Boolean(activeWorkGoal);
			if (wasWorkGoalTurn) await handleWorkGoalAgentEnd(event, ctx, pi);
			activeHistoryTask = null;
			if (!hadWorkGoal) resetWarpTitle(ctx);
			return;
		}
		const run = activeWorkAgent;
		activeWorkAgent = null;
		const wasWorkGoalTurn = activeWorkGoalRunning;
		activeWorkGoalRunning = false;
		const usage = messageUsage(event.messages);
		const durationMs = Math.max(0, Date.now() - run.startedAt);
		const review = reviewTelemetry(run.meta, event);
		const gitAfter = gitSnapshot(run.cwd);
		const testsRun = run.tools.filter((tool) => tool.kind === "test").length;
		const role = run.meta.inlineWork
			? `inline-${run.meta.inlineLevel ?? "medium"}`
			: (handoffRole(run.meta.action) ?? handoffRole(run.meta.mode));
		const telemetry = {
			id: run.id,
			type: "agent",
			workflowRunId: run.meta.workflowRunId,
			activity: run.meta.activity,
			mode: run.meta.mode,
			action: run.meta.action,
			role,
			handoff: { queued: false, started: true, role },
			epicId: run.meta.epicId,
			workItemId: run.meta.workItemId,
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
		const evaluationIdentity = evaluationTelemetryIdentity({ role: "main" });
		if (evaluationIdentity)
			recordWorkTelemetry(run.cwd, {
				type: "agent-terminal",
				...evaluationIdentity,
				endedAt: new Date().toISOString(),
				provider: ctx.model?.provider ?? process.env.CE_EVAL_PROVIDER,
				model: ctx.model?.id ?? process.env.CE_EVAL_MODEL,
				effort:
					ctx.getThinkingLevel?.() ??
					ctx.thinkingLevel ??
					process.env.CE_EVAL_EFFORT,
				tokens: {
					input: Number(usage.input ?? 0),
					output: Number(usage.output ?? 0),
					total: Math.max(
						Number(usage.totalTokens ?? 0),
						Number(usage.input ?? 0) + Number(usage.output ?? 0),
					),
				},
				toolCalls: run.tools.length,
				toolOutputBytes: run.tools.reduce(
					(sum, tool) => sum + Number(tool.outputChars ?? 0),
					0,
				),
				subagentCalls: run.tools.filter((tool) => tool.name === "subagent")
					.length,
				retries: 0,
				questions: run.tools.filter((tool) => tool.name === "ask_user").length,
				artifactIds: [
					...new Set(run.tools.map((tool) => tool.artifact).filter(Boolean)),
				],
				terminalReason: hasWorkAgentFailure(event, telemetry)
					? "failed"
					: "completed",
				costScope: "workflow-role",
			});
		const file = recordWorkTelemetry(run.cwd, telemetry);
		completeWorkflowOnce(
			run.cwd,
			{
				workflowRunId: run.meta.workflowRunId,
				activity: run.meta.activity,
				outcome: hasWorkAgentFailure(event, telemetry) ? "failed" : "completed",
				action: run.meta.action,
				epicId: run.meta.epicId,
				workItemId: run.meta.workItemId,
			},
			{
				pi,
				mode: ctx.mode,
				session: ctx.sessionManager?.getSessionId?.(),
			},
		);
		appendTelemetryNote(run.cwd, run.meta.workItemId, telemetry, file);
		appendFailureStatusNote(
			run.cwd,
			run.meta.workItemId,
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
		if (wasWorkGoalTurn) await handleWorkGoalAgentEnd(event, ctx, pi);
		activeHistoryTask = null;
	});

	pi.on("session_before_compact", async (event, ctx) => {
		if (activeWorkGoal?.status === "active") {
			updateWorkGoalUsage(activeWorkGoal, ctx);
			if (workGoalContinuationPending?.goalId === activeWorkGoal.id) {
				workGoalCompactionResume = { goalId: activeWorkGoal.id };
				workGoalContinuationPending = null;
			}
			persistWorkGoal(pi);
		}
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

	pi.on("session_compact", async (event, ctx) => {
		recordSelfImprovementHistory(ctx, "session_compact", event);
		const wasOurs = contextCompactState.inFlight;
		contextCompactState.inFlight = false;
		contextCompactState.requested = false;
		if (
			!wasOurs &&
			activeWorkGoal?.status === "active" &&
			workGoalCompactionResume?.goalId === activeWorkGoal.id &&
			!workGoalHasPendingMessages(ctx) &&
			ctx?.sessionManager
		) {
			workGoalCompactionResume = null;
			if (workGoalRecovery?.goalId === activeWorkGoal.id)
				workGoalRecovery = null;
			updateWorkGoalUsage(activeWorkGoal, ctx);
			persistWorkGoal(pi);
			updateWorkGoalStatus(ctx);
			await sendWorkGoalContinuation(pi, ctx, activeWorkGoal);
		}
	});

	pi.on("turn_end", async (event, ctx) => {
		recordSelfImprovementHistory(ctx, "turn_end", event);
		try {
			maybeCompact(ctx, readSettings(ctx.cwd), "turn boundary");
		} catch {
			maybeCompact(ctx, {}, "turn boundary");
		}
		cleanupBenignInstructionDirt(ctx.cwd);
		await flushWorkGoalContinuationRetry(ctx, pi);
	});

	pi.on("message_end", async (event, ctx) => {
		recordSelfImprovementHistory(ctx, "message_end", event);
	});

	pi.on("turn_start", async (event, ctx) => {
		recordSelfImprovementHistory(ctx, "turn_start", event);
	});

	pi.registerCommand("work-goal", {
		description:
			"Run an autonomous goal with microcompact loops and human-decision stops",
		handler: async (args, ctx) => {
			await handleWorkGoalCommand(args, "generic", pi, ctx);
		},
	});

	pi.registerCommand("work-resume", {
		description: "Run the next coded native work-item store/git work step",
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

	pi.registerCommand("work-stop", {
		description: "Cleanly stop autonomous work at the next safe boundary",
		handler: async (args, ctx) => {
			await handleWorkResumeStopCommand(args, pi, ctx);
		},
	});

	pi.registerCommand("work-resume-stop", {
		description: "Alias for /work-stop",
		handler: async (args, ctx) => {
			await handleWorkResumeStopCommand(args, pi, ctx);
		},
	});

	pi.registerCommand("work-menu", {
		description: "Open a small work-orchestrator menu",
		handler: async (_args, ctx) => {
			await handleWorkMenuCommand(ctx, pi);
		},
	});

	pi.registerCommand(WORK_GOAL_RESET_COMMAND, {
		description: "Internal: continue a work goal in a fresh session",
		handler: async (args, ctx) => {
			await handleWorkGoalResetCommand(args, ctx);
		},
	});

	pi.registerShortcut?.("f7", {
		description: "Open work roadmaps",
		handler: async (ctx) => {
			await handleWorkRoadmapCommand("", ctx, pi);
		},
	});
	pi.registerShortcut?.("f8", {
		description: "Open work menu",
		handler: async (ctx) => {
			await handleWorkMenuCommand(ctx, pi);
		},
	});

	pi.registerCommand("work-init", {
		description:
			"Initialize native work-item store for work-orchestrator without AGENTS noise",
		handler: async (args, ctx) => {
			await withCommandTelemetry("work-init", args, ctx, () =>
				handleWorkflowAction(buildWorkInitState, args, ctx, pi),
			);
		},
	});

	pi.registerCommand("work-status", {
		description:
			"Show deterministic native work-item store/git work-orchestrator status",
		handler: async (args, ctx) => {
			await withCommandTelemetry("work-status", args, ctx, () =>
				handleWorkStatusCommand(args, ctx),
			);
		},
	});

	pi.registerCommand("work-report", {
		description:
			"Show deterministic native work-item store/git blocker handoff report",
		handler: async (args, ctx) => {
			await withCommandTelemetry("work-report", args, ctx, () =>
				handleWorkReportCommand(args, ctx),
			);
		},
	});

	pi.registerCommand("work-roadmap", {
		description:
			"List, select, close, reopen, and inspect native work-item store epics",
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
		description: "Show and mutate native work-item store-backed idea state",
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
		description: "Link brainstorms back to native work-item store-backed ideas",
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
					await sendFollowUp(ctx, brainstormHandoffPrompt(state, ctx.cwd), pi);
				return stateTelemetry(state);
			});
		},
	});

	pi.registerCommand("work-pause", {
		description:
			"Checkpoint current native work-item store-backed work and stop",
		handler: async (args, ctx) => {
			await withCommandTelemetry("work-pause", args, ctx, () =>
				handleWorkflowAction(buildWorkPauseState, args, ctx, pi),
			);
		},
	});

	pi.registerCommand("work-small", {
		description: "Create one implementation WorkItem and hand off safely",
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
		description: "Create one bounded medium WorkItem and execute it inline",
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
		description: "Create one large-slice planning WorkItem and hand off safely",
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
		description: "Plan an idea and bootstrap the native work-item store epic",
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

	pi.registerCommand("work-remove-beads", {
		description: "Verify and migrate a legacy workspace to native work state",
		handler: async (args, ctx) => {
			await withCommandTelemetry("work-remove-beads", args, ctx, () =>
				handleWorkflowAction(buildWorkRemoveBeadsState, args, ctx, pi),
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
		description:
			"Commit reviewed work and close the WorkItem when deterministic gates pass",
		handler: async (args, ctx) => {
			await withCommandTelemetry("work-finish", args, ctx, async () => {
				cleanupBenignInstructionDirt(ctx.cwd);
				let state = buildWorkFinishState(ctx.cwd, args);
				if (state.ok && !state.handoffPrompt)
					state = executeWorkFinishState(ctx.cwd, state);
				rememberRecommendedActions(
					ctx.cwd,
					recommendedActions(state),
					"work-finish",
				);
				notify(
					ctx,
					renderWorkflowActionText(state),
					state.ok ? "info" : "warning",
				);
				if (state.handoffPrompt)
					await sendFollowUp(ctx, state.handoffPrompt, pi);
				return stateTelemetry(state);
			});
		},
	});

	pi.registerCommand("work-debug", {
		description: "Resolve or create a debug WorkItem and hand off safely",
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
		description:
			"Create explicit work under the active native work-item store epic",
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
						"manual work-context compact: preserve native work-item store/git state, files, blockers, and next command; omit reasoning and full tool logs.",
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

	pi.registerCommand("work-settings", {
		description:
			"Work-orchestrator settings submenu: effort profiles, role/advisor model+effort, and advisor/critic gates",
		handler: async (args, ctx) => {
			if (String(args).trim() === "status") return workSettingsStatus(ctx);
			await workSettingsLoop(ctx);
		},
	});
}

function onOff(value) {
	return value ? "✓ on" : "○ off";
}

function workSettingsStatus(ctx) {
	const settings = readSettings(ctx.cwd);
	const resolved = workOrchSettings(ctx.cwd);
	const resume = workResumeSettings(ctx.cwd);
	const lines = [
		"Work settings",
		"",
		"Profile",
		`  ${SUBMENU_ARROW} profile: ${resolved.profile}`,
		"",
		"Role models / effort",
		...SLOTS.map(
			(slot) =>
				`  ${SUBMENU_ARROW} ${slot.label}: ${slotSummary(slot, settings)}`,
		),
		"",
		"Gates",
		`  ${onOff(resolved.critic.brainstorm)} critic on brainstorm`,
		`  ${onOff(resolved.critic.plan)} critic on plan`,
		...WORK_ORCH_BOOLEANS.map(
			(flag) => `  ${onOff(resolved[flag.key])} ${flag.label}`,
		),
		`  ${SUBMENU_ARROW} ce-plan slice depth: ${resolved.slicePlanCeDepth}`,
		`  ${SUBMENU_ARROW} pre-commit review: ${resolved.codeReviewBeforeCommit}`,
		`  ${SUBMENU_ARROW} slice execution: ${resolved.sliceExecutionMode}`,
		"",
		"Resume automation",
		`  ${onOff(resume.selfImproving)} self-improving workflow fixes (autonomous source delivery)`,
		`  source: ${readSettings(ctx.cwd).workImprovement?.sourceCheckout ?? process.env.CE_WORKFLOW_SOURCE_DIR ?? "package checkout fallback"}`,
		`  ${onOff(resume.newSessionBetweenIterations)} new session between iterations`,
	];
	notify(ctx, lines.join("\n"), "info");
}

const SETTINGS_DONE = "__done__";
const SETTINGS_PROFILE = "__profile__";
const SETTINGS_RESET = "__reset__";

function boolLabel(label, value) {
	return {
		label: `${onOff(value)} ${label}`,
		settingLabel: label,
		enabled: value,
	};
}

function fitUiLine(text, width) {
	if (width < 2) return "";
	return text.length <= width ? text : `${text.slice(0, width - 1)}…`;
}

async function chooseWorkSetting(ctx, items, selectedIndex) {
	if ((ctx.mode && ctx.mode !== "tui") || typeof ctx.ui.custom !== "function") {
		const labels = items.map(labelFor);
		const selected = await ctx.ui.select("Work settings", labels);
		const index = labels.indexOf(selected);
		return index < 0 ? undefined : { pick: items[index], index };
	}
	return ctx.ui.custom((tui, theme, keybindings, done) => {
		let index = Math.max(0, Math.min(selectedIndex, items.length - 1));
		return {
			render(width) {
				const maxVisible = Math.min(items.length, 12);
				const start = Math.max(
					0,
					Math.min(
						index - Math.floor(maxVisible / 2),
						items.length - maxVisible,
					),
				);
				const end = Math.min(start + maxVisible, items.length);
				const lines = [theme.fg("accent", theme.bold("Work settings")), ""];
				for (let i = start; i < end; i += 1) {
					const item = items[i];
					const color =
						item.enabled === true
							? "success"
							: item.enabled === false
								? "dim"
								: i === index
									? "accent"
									: "text";
					lines.push(
						theme.fg(
							color,
							fitUiLine(`${i === index ? "> " : "  "}${item.label}`, width),
						),
					);
				}
				if (start > 0 || end < items.length)
					lines.push(
						theme.fg(
							"dim",
							fitUiLine(`  (${index + 1}/${items.length})`, width),
						),
					);
				if (items[index]?.description)
					lines.push(
						"",
						theme.fg(
							"muted",
							fitUiLine(`  ${items[index].description}`, width),
						),
					);
				lines.push(
					"",
					theme.fg(
						"dim",
						fitUiLine("  ↑↓ navigate · Enter/Space change · Esc close", width),
					),
				);
				return lines;
			},
			invalidate() {},
			handleInput(data) {
				if (keybindings.matches(data, "tui.select.up"))
					index = index === 0 ? items.length - 1 : index - 1;
				else if (keybindings.matches(data, "tui.select.down"))
					index = index === items.length - 1 ? 0 : index + 1;
				else if (
					keybindings.matches(data, "tui.select.confirm") ||
					data === " "
				)
					return done({ pick: items[index], index });
				else if (keybindings.matches(data, "tui.select.cancel"))
					return done(undefined);
				tui.requestRender();
			},
		};
	});
}

async function workSettingsLoop(ctx) {
	let selectedIndex = 0;
	for (;;) {
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
		const resolved = workOrchSettings(ctx.cwd);
		const resume = workResumeSettings(ctx.cwd);
		const items = [
			{
				kind: "profile",
				value: SETTINGS_PROFILE,
				label: `profile ${SUBMENU_ARROW} ${resolved.profile}`,
				description:
					"low / medium / high / max — copy effort + gates onto current",
			},
			...SLOTS.map((slot) => ({
				kind: "slot",
				value: slot.key,
				label: `${slot.label} ${SUBMENU_ARROW}`,
				description: slotSummary(slot, settings),
			})),
			...WORK_ORCH_CRITIC_KEYS.map((key) => ({
				kind: "critic",
				value: `critic.${key}`,
				...boolLabel(`critic on ${key}`, resolved.critic[key]),
			})),
			...WORK_ORCH_BOOLEANS.map((flag) => ({
				kind: "bool",
				value: flag.key,
				...boolLabel(flag.label, resolved[flag.key]),
			})),
			{
				kind: "reviewLevel",
				value: "codeReviewBeforeCommit",
				label: `pre-commit review ${SUBMENU_ARROW}`,
				description: resolved.codeReviewBeforeCommit,
			},
			{
				kind: "sliceExec",
				value: "sliceExecutionMode",
				label: `slice execution ${SUBMENU_ARROW}`,
				description: resolved.sliceExecutionMode,
			},
			{
				kind: "resumeBool",
				value: "selfImproving",
				...boolLabel("self-improving workflow fixes", resume.selfImproving),
			},
			{
				kind: "resumeBool",
				value: "newSessionBetweenIterations",
				...boolLabel(
					"new session between iterations",
					resume.newSessionBetweenIterations,
				),
			},
			{
				kind: "reset",
				value: SETTINGS_RESET,
				label: "reset role/gate overrides",
				description: "Clear work-orchestrator model/gate overrides",
			},
			{
				kind: "done",
				value: SETTINGS_DONE,
				label: "done",
				description: "Exit settings",
			},
		];
		const selected = await chooseWorkSetting(ctx, items, selectedIndex);
		if (!selected) return;
		selectedIndex = selected.index;
		const { pick } = selected;
		if (pick.kind === "done") return;
		if (pick.kind === "reset") {
			resetAll(settings);
			delete settings.workOrchestrator;
			writeSettings(ctx.cwd, settings);
			ctx.ui.notify("Cleared work-orchestrator role/gate overrides", "info");
			continue;
		}
		if (pick.kind === "profile") {
			const profileKey = await choose(ctx, "Choose effort profile", [
				...Object.keys(EFFORT_PROFILES).map((key) => ({
					value: key,
					label: key,
					description: `${SLOTS.map(
						(slot) => `${slot.key}=${EFFORT_PROFILES[key][slot.key]}`,
					).join(" ")} · gates:${
						[
							EFFORT_PROFILES[key].simplifyBeforeReview && "simplify",
							EFFORT_PROFILES[key].browserTestsOnUiDiff && "browser",
							EFFORT_PROFILES[key].codeReviewBeforeCommit !== "off" &&
								`review:${EFFORT_PROFILES[key].codeReviewBeforeCommit}`,
						]
							.filter(Boolean)
							.join("/") || "none"
					}`,
				})),
			]);
			if (!profileKey) continue;
			settings = readSettings(ctx.cwd);
			applyProfile(settings, profileKey);
			writeSettings(ctx.cwd, settings);
			ctx.ui.notify(`Applied ${profileKey} profile`, "info");
			continue;
		}
		if (pick.kind === "reviewLevel") {
			const level = await choose(
				ctx,
				"Pre-commit review level",
				REVIEW_LEVELS.map((value) => ({
					value,
					label: value,
					description: REVIEW_LEVEL_DESC[value],
				})),
			);
			if (!level) continue;
			settings = readSettings(ctx.cwd);
			setWorkOrchReviewLevel(settings, level);
			writeSettings(ctx.cwd, settings);
			ctx.ui.notify(`Pre-commit review: ${level}`, "info");
			continue;
		}
		if (pick.kind === "sliceExec") {
			const mode = await choose(ctx, "Slice execution", [
				{
					value: "inline",
					label: "inline",
					description: "run each slice in the current session (default)",
				},
				{
					value: "agent",
					label: "agent",
					description: "route each slice to an isolated work-worker subagent",
				},
			]);
			if (!mode) continue;
			settings = readSettings(ctx.cwd);
			setWorkOrchSliceExecution(settings, mode);
			writeSettings(ctx.cwd, settings);
			ctx.ui.notify(`Slice execution: ${mode}`, "info");
			continue;
		}
		if (pick.kind === "slot") {
			const slot = slotByKey(pick.value);
			if (slot)
				try {
					await editSlotModel(ctx, readSettings(ctx.cwd), slot);
				} catch (error) {
					ctx.ui.notify(
						`Could not write ${settingsPath(ctx.cwd)}: ${error instanceof Error ? error.message : String(error)}`,
						"error",
					);
				}
			continue;
		}
		// Boolean flip (live): write immediately.
		settings = readSettings(ctx.cwd);
		const criticKey = pick.value.split(".")[1];
		const current =
			pick.kind === "critic"
				? resolved.critic[criticKey]
				: pick.kind === "resumeBool"
					? resume[pick.value]
					: resolved[pick.value];
		const next = !current;
		if (pick.kind === "critic") setWorkOrchCritic(settings, criticKey, next);
		else if (pick.kind === "resumeBool")
			setWorkResumeBoolean(settings, pick.value, next);
		else setWorkOrchBoolean(settings, pick.value, next);
		writeSettings(ctx.cwd, settings);
		ctx.ui.notify(
			`${pick.settingLabel ?? pick.label}: ${next ? "on" : "off"}`,
			"info",
		);
	}
}
