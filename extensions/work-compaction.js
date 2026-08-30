export const COMPACTION_PROFILES = Object.freeze({
	FREEFORM: "freeform",
	WORK_RESUME: "work-resume",
	AUTONOMOUS_GOAL: "autonomous-goal",
});
export const AUTONOMOUS_GOAL_STATUSES = Object.freeze(["active"]);

export function compactionProfileFor({ goalStatus, targetId } = {}) {
	if (AUTONOMOUS_GOAL_STATUSES.includes(goalStatus))
		return COMPACTION_PROFILES.AUTONOMOUS_GOAL;
	return targetId
		? COMPACTION_PROFILES.WORK_RESUME
		: COMPACTION_PROFILES.FREEFORM;
}

const OMITTED = "[... omitted by compaction budget ...]";
const DEFAULT_KEEP_RECENT_TOKENS = 30_000;
const DEFAULT_MAX_SUMMARY_CHARS = 12_000;
const MIN_TRIGGER_TOKENS = 30_000;

function finiteNumber(value, fallback) {
	const number = Number(value);
	return Number.isFinite(number) ? number : fallback;
}

export function contentText(content) {
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

function normalizeText(value) {
	return String(value ?? "")
		.replace(/\r\n?/g, "\n")
		.replace(/[ \t]+$/gm, "")
		.trim();
}

function bounded(value, max) {
	const text = normalizeText(value);
	if (!text || max <= 0) return "";
	if (text.length <= max) return text;
	if (max <= OMITTED.length) return OMITTED.slice(0, max);
	return `${text.slice(0, max - OMITTED.length - 1).trimEnd()}\n${OMITTED}`;
}

function normalizePath(value) {
	return normalizeText(value).replaceAll("\\", "/");
}

function stableUnique(values, normalize = normalizeText) {
	const seen = new Set();
	const result = [];
	for (const value of values ?? []) {
		const normalized = normalize(value);
		if (!normalized || seen.has(normalized)) continue;
		seen.add(normalized);
		result.push(normalized);
	}
	return result;
}

function valuesFrom(value) {
	if (!value || typeof value === "string") return value ? [value] : [];
	if (Array.isArray(value)) return value;
	return typeof value[Symbol.iterator] === "function" ? [...value] : [];
}

export function filesFromOps(fileOps = {}) {
	if (!fileOps || typeof fileOps !== "object") fileOps = {};
	const read = [...valuesFrom(fileOps.readFiles), ...valuesFrom(fileOps.read)];
	const modified = [
		...valuesFrom(fileOps.modifiedFiles),
		...valuesFrom(fileOps.modified),
		...valuesFrom(fileOps.written),
		...valuesFrom(fileOps.edited),
	];
	const modifiedFiles = stableUnique(modified, normalizePath).sort();
	const modifiedSet = new Set(modifiedFiles);
	return {
		read: stableUnique(read, normalizePath)
			.filter((file) => !modifiedSet.has(file))
			.sort(),
		modified: modifiedFiles,
	};
}

export function contextFilterCutIndex(
	messages,
	keepRecentTokens,
	maxCurrentTurnTokens = Number.POSITIVE_INFINITY,
	estimateTokens = (message) =>
		Math.ceil(JSON.stringify(message ?? {}).length / 4),
) {
	let keptTokens = 0;
	let cutIndex = null;
	for (let index = messages.length - 1; index > 0; index -= 1) {
		keptTokens += Math.max(1, Number(estimateTokens(messages[index])) || 0);
		if (keptTokens < keepRecentTokens) continue;
		while (index > 0 && messages[index]?.role === "toolResult") index -= 1;
		cutIndex = index > 0 ? index : null;
		break;
	}
	if (!cutIndex) return null;
	let turnStart = messages.findLastIndex((message) => message?.role === "user");
	if (turnStart < 1)
		turnStart = messages.findLastIndex((message) =>
			["custom", "bashExecution", "compactionSummary"].includes(message?.role),
		);
	if (turnStart < 1 || turnStart >= cutIndex) return cutIndex;
	const currentTurnTokens = messages
		.slice(turnStart)
		.reduce(
			(total, message) =>
				total + Math.max(1, Number(estimateTokens(message)) || 0),
			0,
		);
	return currentTurnTokens <= maxCurrentTurnTokens ? turnStart : cutIndex;
}

export function compactionThreshold({
	compactAtTokens,
	contextWindow,
	keepRecentTokens,
	maxSummaryChars,
} = {}) {
	const configured = Math.max(
		MIN_TRIGGER_TOKENS,
		Math.round(finiteNumber(compactAtTokens, 150_000)),
	);
	const requestedKeepRecentTokens = Math.max(
		0,
		Math.round(finiteNumber(keepRecentTokens, DEFAULT_KEEP_RECENT_TOKENS)),
	);
	const summaryTokens = Math.max(
		1,
		Math.ceil(
			Math.max(1_000, finiteNumber(maxSummaryChars, DEFAULT_MAX_SUMMARY_CHARS)) /
				4,
		),
	);
	const window = Math.round(finiteNumber(contextWindow, 0));
	if (window <= 0)
		return {
			trigger: configured,
			ceiling: null,
			headroom: null,
			summaryTokens,
			requestedKeepRecentTokens,
			effectiveKeepRecentTokens: requestedKeepRecentTokens,
		};

	const halfWindow = Math.max(1, Math.floor(window / 2));
	const effectiveKeepRecentTokens = Math.min(
		requestedKeepRecentTokens,
		halfWindow,
	);
	const headroom = Math.min(
		halfWindow,
		effectiveKeepRecentTokens + summaryTokens,
	);
	const ceiling = Math.max(1, window - headroom);
	const minimum = Math.min(MIN_TRIGGER_TOKENS, ceiling);
	return {
		trigger: Math.max(minimum, Math.min(configured, ceiling)),
		ceiling,
		headroom,
		summaryTokens,
		requestedKeepRecentTokens,
		effectiveKeepRecentTokens,
	};
}

function messageRole(message) {
	return String(message?.role ?? message?.type ?? "message");
}

function headTail(value, max) {
	const text = normalizeText(value);
	if (!text || max <= 0) return "";
	if (text.length <= max) return text;
	const marker = `\n${OMITTED}\n`;
	const side = Math.max(1, Math.floor((max - marker.length) / 2));
	return `${text.slice(0, side).trimEnd()}${marker}${text.slice(-side).trimStart()}`;
}

function baseToolName(value) {
	return String(value ?? "tool")
		.toLowerCase()
		.split(/[.:/]/)
		.at(-1);
}

function toolCalls(message) {
	const contentCalls = Array.isArray(message?.content)
		? message.content.filter((part) => part?.type === "toolCall")
		: [];
	const legacy =
		message?.toolCalls ?? message?.tool_calls ?? message?.calls ?? [];
	return [...contentCalls, ...(Array.isArray(legacy) ? legacy : [])];
}

function toolArgumentSummary(call) {
	const args = call?.arguments ?? call?.function?.arguments ?? call?.args;
	if (!args || typeof args !== "object") return "";
	const keys = [
		"path",
		"paths",
		"file",
		"files",
		"symbol",
		"line",
		"offset",
		"limit",
		"query",
		"question",
		"claim",
		"url",
		"urls",
		"command",
		"pattern",
		"glob",
		"agent",
		"task",
		"action",
		"id",
		"mode",
	];
	const selected = Object.fromEntries(
		keys.filter((key) => args[key] !== undefined).map((key) => [key, args[key]]),
	);
	const value = Object.keys(selected).length
		? selected
		: { keys: Object.keys(args) };
	return headTail(JSON.stringify(value), 420);
}

function failedToolResult(message) {
	return Boolean(
		message?.isError === true ||
			message?.error ||
			message?.content?.isError === true,
	);
}

const OUTPUT_REPLAYABLE_TOOLS = new Set([
	"edit",
	"read",
	"read_enclosing",
	"read_symbol",
	"write",
]);
const HIGH_VALUE_RESULT_TOOLS = new Set([
	"ask_user",
	"fetch_content",
	"get_search_content",
	"intercom",
	"source_check",
	"subagent",
	"web_search",
]);
const DIAGNOSTIC_RESULT_TOOLS = new Set([
	"lens_diagnostics",
	"lsp_diagnostics",
	"module_report",
	"project_report",
	"symbol_search",
]);

function toolResultCap(name, failed) {
	if (failed) return 700;
	if (OUTPUT_REPLAYABLE_TOOLS.has(name)) return 0;
	if (HIGH_VALUE_RESULT_TOOLS.has(name)) return 1_600;
	if (DIAGNOSTIC_RESULT_TOOLS.has(name)) return 900;
	if (name === "bash" || name === "hypa_shell") return 600;
	return 700;
}

function toolCallRecord(call) {
	const name = baseToolName(
		call?.name ?? call?.function?.name ?? call?.toolName,
	);
	const args = toolArgumentSummary(call);
	return {
		text: `[tool:${name} call]${args ? ` ${args}` : ""}`,
		key: `call:${name}:${args}`,
		critical: HIGH_VALUE_RESULT_TOOLS.has(name),
	};
}

function toolResultRecord(message, call) {
	const name = baseToolName(
		message?.toolName ?? call?.name ?? call?.function?.name ?? message?.name,
	);
	const failed = failedToolResult(message);
	const args = toolArgumentSummary(call);
	const result = headTail(
		contentText(message?.content ?? message?.message),
		toolResultCap(name, failed),
	);
	const status = failed ? "failed" : "completed";
	const prefix = `[tool:${name} ${status}]${args ? ` ${args}` : ""}`;
	const firstResultLine = normalizeText(result).split("\n", 1)[0];
	return {
		text: result ? `${prefix}\n${result}` : prefix,
		key: `${status}:${name}:${args}:${failed ? firstResultLine : result}`,
		critical:
			failed ||
			HIGH_VALUE_RESULT_TOOLS.has(name) ||
			DIAGNOSTIC_RESULT_TOOLS.has(name),
	};
}

function messageRecords(messages) {
	const callsById = new Map();
	for (const message of messages)
		for (const call of toolCalls(message))
			if (call?.id) callsById.set(call.id, call);
	const records = [];
	for (const message of messages) {
		const role = messageRole(message);
		if (/thinking|reasoning/i.test(role) || /^user$/i.test(role)) continue;
		if (role === "assistant") {
			const text = headTail(contentText(message.content), 900);
			if (text)
				records.push({ text: `[assistant] ${text}`, key: `assistant:${text}` });
			for (const call of toolCalls(message)) records.push(toolCallRecord(call));
			continue;
		}
		if (role === "toolResult") {
			records.push(toolResultRecord(message, callsById.get(message.toolCallId)));
			continue;
		}
		if (role === "custom" && message?.customType === "work-context-fill")
			continue;
		if (role === "compactionSummary") continue;
		if (role === "bashExecution") {
			const failed = message?.cancelled || Number(message?.exitCode) !== 0;
			const command = headTail(message?.command, 320);
			const output = headTail(message?.output, failed ? 700 : 500);
			records.push({
				text: `[bashExecution ${failed ? "failed" : "completed"}] ${command}${output ? `\n${output}` : ""}`,
				key: `bash:${failed}:${command}:${failed ? output.split("\n", 1)[0] : output}`,
				critical: failed,
			});
			continue;
		}
		const type =
			role === "custom" ? `custom:${message?.customType ?? "message"}` : role;
		const text = headTail(
			message?.summary ?? contentText(message?.content ?? message?.message),
			role === "branchSummary" ? 1_200 : 900,
		);
		if (!text) continue;
		records.push({
			text: `[${type}] ${text}`,
			key: `${type}:${text}`,
			critical:
				role === "branchSummary" ||
				["intercom_message", "subagent-notify"].includes(message?.customType),
		});
	}
	return records;
}

function newestUniqueRecords(records, limit) {
	const seen = new Set();
	const result = [];
	for (
		let index = records.length - 1;
		index >= 0 && result.length < limit;
		index -= 1
	) {
		const record = records[index];
		if (!record?.text || seen.has(record.key)) continue;
		seen.add(record.key);
		result.push(record.text);
	}
	return result.toReversed();
}

function messagesFrom(preparation) {
	const summarized = Array.isArray(preparation?.messagesToSummarize)
		? preparation.messagesToSummarize
		: [];
	const prefix = Array.isArray(preparation?.turnPrefixMessages)
		? preparation.turnPrefixMessages
		: [];
	return [...summarized, ...prefix];
}

function latestUserRequests(messages, limit = 5) {
	return messages
		.filter((message) => /^user$/i.test(messageRole(message)))
		.map((message) =>
			normalizeText(contentText(message.content ?? message.message)),
		)
		.filter(Boolean)
		.slice(-limit);
}

function continuationOnlyRequest(value) {
	return /^(?:continue|resume)(?:\s|$)/i.test(value) && value.length < 240;
}

function stableValue(value) {
	if (Array.isArray(value)) return value.map(stableValue);
	if (!value || typeof value !== "object") return value;
	return Object.fromEntries(
		Object.keys(value)
			.sort()
			.map((key) => [key, stableValue(value[key])]),
	);
}

function delimited(name, value) {
	if (value === undefined || value === null || value === "") return "";
	const text =
		typeof value === "string"
			? normalizeText(value)
			: JSON.stringify(stableValue(value), null, 2);
	return text ? `<${name}>\n${text}\n</${name}>` : "";
}

function sectionFromPrevious(summary, title) {
	const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const match = new RegExp(
		`(?:^|\\n)## ${escaped}\\n([\\s\\S]*?)(?=\\n## |$)`,
	).exec(summary);
	return normalizeText(match?.[1]);
}

function previousHighlights(previousSummary) {
	const previous = normalizeText(previousSummary);
	if (!previous) return "";
	if (!previous.startsWith("## ce-workflow compact context"))
		return bounded(previous, 1_500);
	return [
		"Latest user requests",
		"Decisions and blockers",
		"Changes and verification",
		"Critical retained context",
	]
		.map((title) => {
			const content = sectionFromPrevious(previous, title);
			return content ? `### ${title}\n${content}` : "";
		})
		.filter(Boolean)
		.join("\n\n");
}

function objectiveFor(profile, users, durable, goal, previous) {
	if (profile === COMPACTION_PROFILES.AUTONOMOUS_GOAL && goal?.objective)
		return goal.objective;
	if (profile === COMPACTION_PROFILES.WORK_RESUME && durable?.target)
		return [
			`${durable.target.id}: ${durable.target.title}`,
			durable.target.description,
		]
			.filter(Boolean)
			.join("\n");
	const latest = users.at(-1);
	const previousObjective = sectionFromPrevious(previous, "Objective");
	if (latest && (!continuationOnlyRequest(latest) || !previousObjective))
		return latest;
	return previousObjective || latest || "Continue the current task.";
}

function nextActionFor(profile, durable, goal) {
	if (durable?.nextAction) return durable.nextAction;
	if (profile === COMPACTION_PROFILES.AUTONOMOUS_GOAL) {
		if (goal?.status === "needs_human")
			return "Resolve the pending human decision, then continue the autonomous goal.";
		return "Continue the active autonomous goal from durable state.";
	}
	if (profile === COMPACTION_PROFILES.WORK_RESUME && durable?.target?.id)
		return `Run /work-resume ${durable.target.id}.`;
	if (goal && ["paused", "budget_limited"].includes(goal.status))
		return `Continue the current user request. Goal ${goal.id} remains ${goal.status}.`;
	return "Continue the current user request from the objective and retained context.";
}

function changesAndVerification(files, durable) {
	const lines = [];
	if (files.modified.length)
		lines.push(
			`Modified files:\n${files.modified.map((file) => `- ${file}`).join("\n")}`,
		);
	if (files.read.length)
		lines.push(
			`Read files:\n${files.read.map((file) => `- ${file}`).join("\n")}`,
		);
	if (durable?.verification?.length)
		lines.push(delimited("verification-evidence", durable.verification));
	return lines.join("\n\n");
}

function fitSections(sections, maxChars) {
	const max = Math.max(1_000, Math.floor(finiteNumber(maxChars, 12_000)));
	let dropped = false;
	const render = () => {
		const output = sections
			.filter((section) => section.cap > 0 && section.raw)
			.map(
				(section) => `## ${section.title}\n${bounded(section.raw, section.cap)}`,
			)
			.join("\n\n");
		return dropped ? `${output}\n\n${OMITTED}` : output;
	};
	let output = render();
	for (const key of [
		"earlier",
		"recent",
		"critical",
		"changes",
		"decisions",
		"durable",
		"objective",
		"next",
		"latest",
	]) {
		if (output.length <= max) break;
		const section = sections.find((item) => item.key === key);
		if (!section?.raw) continue;
		const overflow = output.length - max;
		const previousCap = section.cap;
		section.cap = Math.max(section.minimum, section.cap - overflow - 32);
		if (previousCap > 0 && section.cap === 0) dropped = true;
		output = render();
	}
	return output.length <= max ? output : bounded(output, max);
}

export function formatCompactionSummary({
	profile = COMPACTION_PROFILES.FREEFORM,
	preparation = {},
	currentMessages = [],
	durable,
	goal,
	maxSummaryChars = DEFAULT_MAX_SUMMARY_CHARS,
} = {}) {
	const selectedProfile = Object.values(COMPACTION_PROFILES).includes(profile)
		? profile
		: COMPACTION_PROFILES.FREEFORM;
	const source =
		preparation && typeof preparation === "object" ? preparation : {};
	const messages = messagesFrom(source);
	const liveMessages = currentMessages.length ? currentMessages : messages;
	const users = latestUserRequests(liveMessages);
	const previous = normalizeText(source.previousSummary);
	const files = filesFromOps(source.fileOps);
	const records = messageRecords(messages);
	const recent = newestUniqueRecords(
		records.filter((record) => !record.critical),
		18,
	);
	const critical = newestUniqueRecords(
		records.filter((record) => record.critical),
		8,
	);
	const objective = objectiveFor(
		selectedProfile,
		users,
		durable,
		goal,
		previous,
	);
	const latestRequests = users
		.toReversed()
		.map(
			(request, index) =>
				`### ${index === 0 ? "Current" : "Earlier"}\n${headTail(request, 1_600)}`,
		)
		.join("\n\n");
	const compactGoal = goal
		? {
				id: goal.id,
				status: goal.status,
				objective: goal.objective,
				pendingDecision: goal.pendingDecision,
			}
		: undefined;
	const durableState =
		selectedProfile === COMPACTION_PROFILES.FREEFORM && !compactGoal
			? ""
			: delimited("durable-work-state", {
					goal: compactGoal,
					state: durable,
				});
	const decisions = delimited("decisions-and-blockers", {
		pendingDecision: goal?.pendingDecision,
		related: durable?.decisionsAndBlockers,
	});
	const sections = [
		{
			key: "header",
			title: `ce-workflow compact context (${selectedProfile})`,
			raw: "Deterministic local summary. Durable state outranks conversational context.",
			cap: 120,
			minimum: 80,
		},
		{
			key: "objective",
			title: "Objective",
			raw: objective,
			cap: 1_800,
			minimum: 180,
		},
		{
			key: "latest",
			title: "Latest user requests",
			raw: latestRequests,
			cap: 3_600,
			minimum: latestRequests ? 500 : 0,
		},
		{
			key: "next",
			title: "Next action",
			raw: nextActionFor(selectedProfile, durable, goal),
			cap: 900,
			minimum: 160,
		},
		{
			key: "durable",
			title: "Durable work state",
			raw: durableState,
			cap: 3_800,
			minimum: durableState ? 500 : 0,
		},
		{
			key: "decisions",
			title: "Decisions and blockers",
			raw:
				goal?.pendingDecision || durable?.decisionsAndBlockers?.length
					? decisions
					: "",
			cap: 1_800,
			minimum: 0,
		},
		{
			key: "changes",
			title: "Changes and verification",
			raw: changesAndVerification(files, durable),
			cap: 1_800,
			minimum: 0,
		},
		{
			key: "critical",
			title: "Critical retained context",
			raw: critical.map((line) => `- ${line}`).join("\n"),
			cap: 4_200,
			minimum: 0,
		},
		{
			key: "earlier",
			title: "Earlier compacted context",
			raw: previousHighlights(previous),
			cap: 1_800,
			minimum: 0,
		},
		{
			key: "recent",
			title: "Recent visible context",
			raw: recent.map((line) => `- ${line}`).join("\n"),
			cap: 4_200,
			minimum: 0,
		},
	];
	return fitSections(sections, maxSummaryChars);
}
