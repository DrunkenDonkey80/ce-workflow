export const COMPACTION_PROFILES = Object.freeze({
	FREEFORM: "freeform",
	WORK_RESUME: "work-resume",
	AUTONOMOUS_GOAL: "autonomous-goal",
});
export const AUTONOMOUS_GOAL_STATUSES = Object.freeze([
	"active",
	"paused",
	"waiting_usage_limit",
	"needs_human",
	"budget_limited",
]);

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

export function filesFromOps(fileOps = {}) {
	if (!fileOps || typeof fileOps !== "object") fileOps = {};
	const read = fileOps.readFiles ?? fileOps.read ?? [];
	const modified =
		fileOps.modifiedFiles ?? fileOps.modified ?? fileOps.written ?? [];
	return {
		read: stableUnique(Array.isArray(read) ? read : [], normalizePath).sort(),
		modified: stableUnique(
			Array.isArray(modified) ? modified : [],
			normalizePath,
		).sort(),
	};
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
		Math.round(
			finiteNumber(keepRecentTokens, DEFAULT_KEEP_RECENT_TOKENS),
		),
	);
	const summaryTokens = Math.max(
		1,
		Math.ceil(
			Math.max(
				1_000,
				finiteNumber(maxSummaryChars, DEFAULT_MAX_SUMMARY_CHARS),
			) / 4,
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

function toolNames(message) {
	const calls =
		message?.toolCalls ?? message?.tool_calls ?? message?.calls ?? [];
	if (!Array.isArray(calls)) return [];
	return stableUnique(
		calls.map((call) => call?.name ?? call?.function?.name ?? call?.toolName),
	);
}

function failedToolResult(message) {
	return Boolean(
		message?.isError === true ||
			message?.error ||
			message?.content?.isError === true,
	);
}

function messageLine(message) {
	const role = messageRole(message);
	if (/thinking|reasoning/i.test(role)) return "";
	if (/tool/i.test(role)) {
		const name = String(message?.toolName ?? message?.name ?? "tool");
		return failedToolResult(message)
			? `[tool:${name} failed] ${bounded(contentText(message.content), 600)}`
			: `[tool:${name}] completed`;
	}
	const tools = toolNames(message);
	const text = bounded(contentText(message?.content ?? message?.message), 900);
	const suffix = tools.length ? ` tools:${tools.join(",")}` : "";
	return text || suffix ? `[${role}] ${text}${suffix}` : "";
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

function latestUserRequests(messages, limit = 4) {
	return messages
		.filter((message) => /^user$/i.test(messageRole(message)))
		.map((message) => normalizeText(contentText(message.content ?? message.message)))
		.filter(Boolean)
		.slice(-limit);
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
	return ["Objective", "Decisions and blockers", "Changes and verification"]
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
	if (users.length) return users.at(-1);
	return sectionFromPrevious(previous, "Objective") || "Continue the current task.";
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
	return "Continue the current user request from the objective and recent context.";
}

function changesAndVerification(files, durable) {
	const lines = [];
	if (files.modified.length)
		lines.push(`Modified files:\n${files.modified.map((file) => `- ${file}`).join("\n")}`);
	if (files.read.length)
		lines.push(`Read files:\n${files.read.map((file) => `- ${file}`).join("\n")}`);
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
				(section) =>
					`## ${section.title}\n${bounded(section.raw, section.cap)}`,
			)
			.join("\n\n");
		return dropped ? `${output}\n\n${OMITTED}` : output;
	};
	let output = render();
	for (const key of [
		"earlier",
		"recent",
		"changes",
		"decisions",
		"durable",
		"objective",
		"next",
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
	durable,
	goal,
	maxSummaryChars = DEFAULT_MAX_SUMMARY_CHARS,
} = {}) {
	const selectedProfile = Object.values(COMPACTION_PROFILES).includes(profile)
		? profile
		: COMPACTION_PROFILES.FREEFORM;
	const source = preparation && typeof preparation === "object" ? preparation : {};
	const messages = messagesFrom(source);
	const users = latestUserRequests(messages);
	const previous = normalizeText(source.previousSummary);
	const files = filesFromOps(source.fileOps);
	const recent = stableUnique(
		messages.map(messageLine).filter(Boolean).reverse(),
	)
		.reverse()
		.slice(-14);
	const objective = objectiveFor(selectedProfile, users, durable, goal, previous);
	const durableState =
		selectedProfile === COMPACTION_PROFILES.FREEFORM
			? ""
			: delimited("durable-work-state", {
				goal:
					selectedProfile === COMPACTION_PROFILES.AUTONOMOUS_GOAL
						? goal
						: undefined,
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
			key: "next",
			title: "Next action",
			raw: nextActionFor(selectedProfile, durable, goal),
			cap: 900,
			minimum: 160,
		},
		{
			key: "earlier",
			title: "Earlier compacted context",
			raw: previousHighlights(previous),
			cap: 1_500,
			minimum: 0,
		},
		{
			key: "recent",
			title: "Recent visible context",
			raw: recent.map((line) => `- ${line}`).join("\n"),
			cap: 4_000,
			minimum: 0,
		},
	];
	return fitSections(sections, maxSummaryChars);
}
