import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CONFIG_DIR_NAME = ".pi";
const INHERIT_MODEL = "__inherit_model__";
const DEFAULT_THINKING = "__default_thinking__";
const RESET_ALL = "__reset_all__";

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
	maxSummaryChars: 24_000,
};
const MIN_COMPACT_AT_TOKENS = 30_000;
const contextCompactState = { inFlight: false, requested: false };

function settingsPath(cwd) {
	return join(cwd, CONFIG_DIR_NAME, "settings.json");
}

function readSettings(cwd) {
	const file = settingsPath(cwd);
	if (!existsSync(file)) return {};
	return JSON.parse(readFileSync(file, "utf8"));
}

function writeSettings(cwd, settings) {
	const dir = join(cwd, CONFIG_DIR_NAME);
	mkdirSync(dir, { recursive: true });
	writeFileSync(settingsPath(cwd), `${JSON.stringify(settings, null, "\t")}\n`);
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
	const userLines = lines.filter((line) => /^\[user\]/i.test(line)).slice(-8);
	const recentLines = lines.slice(-24);
	const files = filesFromOps(preparation.fileOps);
	const previous = truncate(preparation.previousSummary ?? "", 4_000);
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

function run(cwd, command, args) {
	const override =
		command === "bd"
			? process.env.WORK_ORCH_BD_BIN
			: command === "git"
				? process.env.WORK_ORCH_GIT_BIN
				: undefined;
	const actualCommand = override?.endsWith(".mjs")
		? process.execPath
		: (override ?? command);
	const actualArgs = override?.endsWith(".mjs") ? [override, ...args] : args;
	return execFileSync(actualCommand, actualArgs, {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	}).trimEnd();
}

function bdJson(cwd, args) {
	const raw = run(cwd, "bd", [...args, "--json"]);
	return raw ? JSON.parse(raw) : [];
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
	return !["epic", "decision"].includes(typeOf(issue));
}

function lineFor(issue) {
	return `${idOf(issue)} ${statusOf(issue)} ${typeOf(issue)} — ${titleOf(issue)}`;
}

function buildWorkStatus(cwd, target) {
	const resolved = resolveEpic(cwd, target);
	if (resolved.choices) {
		if (resolved.choices.length === 0)
			return "No open or in-progress epic found. Use /work-master or /work-migrate first.";
		return [
			"Multiple active epics. Run /work-status <epic-id> or /work-resume <epic-id>.",
			...resolved.choices.map(
				(epic) =>
					`- ${idOf(epic)} ${statusOf(epic)} — ${titleOf(epic)} (updated ${shortDate(updatedAt(epic))})`,
			),
		].join("\n");
	}

	const epic = resolved.epic;
	const epicId = idOf(epic);
	const children = childrenOf(cwd, epicId);
	const ready = readyIds(cwd, epicId);
	const slices = children.filter(isWorkSlice);
	const done = slices.filter((issue) => statusOf(issue) === "closed");
	const active = slices.filter((issue) => statusOf(issue) === "in_progress");
	const readySlices = slices.filter((issue) => ready.has(idOf(issue)));
	const planned = slices.filter(
		(issue) => statusOf(issue) === "open" && !ready.has(idOf(issue)),
	);
	const decisions = children.filter(
		(issue) => typeOf(issue) === "decision" && statusOf(issue) !== "closed",
	);
	const planning = children.filter(
		(issue) =>
			/wo:planning/.test(JSON.stringify(issue)) && statusOf(issue) !== "closed",
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
		if (active.length)
			return `Continue or pause active slice ${idOf(active[0])}.`;
		if (planning.length)
			return `Run /work-resume ${epicId}; planner should create the next slices.`;
		if (statusOf(epic) === "closed") return "Epic is closed.";
		return "No ready slices. /work-resume should ask bead-planner to compare the epic plan against closed children and create the next slice, or close the epic if done.";
	})();

	return [
		`Epic: ${titleOf(epic)} (${epicId})`,
		`Status: ${statusOf(epic)} • created ${shortDate(createdAt(epic))} • updated ${shortDate(updatedAt(epic))}`,
		`Progress: ${done.length}/${slices.length} slices closed (${percent}%)`,
		`Ready: ${readySlices.length} • in progress: ${active.length} • planned ahead: ${planned.length} • decisions: ${decisions.length}`,
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
		"Planned ahead / blocked:",
		...(planned.length
			? planned.map((issue) => `- ${lineFor(issue)}`)
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
	if (/no beads database|bd init|ENOENT|not recognized/i.test(text))
		return "beads-unavailable";
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

function depsOf(issue) {
	return asArray(
		field(issue, "depends_on", "dependencies", "blocked_by", "deps"),
	)
		.filter((dep) => {
			if (typeof dep !== "object") return true;
			const type = String(field(dep, "type", "dependency_type") ?? "blocks");
			return !/parent[-_]child/i.test(type);
		})
		.map((dep) =>
			typeof dep === "object"
				? field(dep, "depends_on_id", "dependsOnId", "dependency_id", "id")
				: dep,
		)
		.filter(Boolean)
		.map(String);
}

function issueSummary(issue) {
	return {
		id: idOf(issue),
		title: titleOf(issue),
		type: typeOf(issue),
		status: statusOf(issue),
		labels: labelsOf(issue),
		updated: updatedAt(issue),
	};
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
			(normalized.match(/\b(?:Run|run|run id)[:# ]+([A-Za-z0-9-]+)/g) ?? []).map(
				(match) => match.replace(/^.*[:# ]+/, ""),
			),
		),
	).slice(0, 5);
	const reason = truncate(
		lines.find((line) =>
			/blocked|failed|failure|error|missing|cannot|unable/i.test(line),
		) ?? "",
		240,
	);
	const nextLine =
		lines.find((line) => /^(?:next\b|rerun\b|re-run\b|run .* again)/i.test(line)) ??
		lines.find((line) => /\b(?:next\b|rerun\b|re-run\b|run .* again)/i.test(line));
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
		rawExcerpt: truncate(normalized, 900),
		raw: normalized,
	};
}

function parseWorkReportArgs(args = "") {
	const tokens = String(args).trim().split(/\s+/).filter(Boolean);
	let json = false;
	const target = [];
	for (const token of tokens) {
		if (token === "--json") json = true;
		else target.push(token);
	}
	return { json, target: target.join(" ") };
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
	const wanted = target.trim();
	if (wanted && wanted !== "last") {
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
	try {
		return {
			ok: true,
			status: run(cwd, "git", ["status", "--short", "--branch"]) || "clean",
			warnings: [],
		};
	} catch {
		return {
			ok: false,
			status: "git status unavailable",
			warnings: ["git status unavailable"],
		};
	}
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

function isBenignInstructionDirt(cwd, item) {
	if (!isInstructionFile(item.path)) return false;
	if (item.x !== " " || item.y !== "M") return false;
	try {
		run(cwd, "git", ["diff", "--quiet", "--ignore-all-space", "--", item.path]);
		return true;
	} catch {
		return false;
	}
}

function resumeGitReport(cwd) {
	try {
		const status =
			run(cwd, "git", ["status", "--short", "--branch"]) || "clean";
		const dirtyFiles = parsePorcelainStatus(
			run(cwd, "git", ["status", "--porcelain=v1", "--untracked-files=all"]),
		);
		const dirtyPaths = dirtyFiles.map((item) => item.path);
		const benignDirty =
			dirtyFiles.length > 0 &&
			dirtyFiles.every((item) => isBenignInstructionDirt(cwd, item));
		return {
			ok: true,
			status,
			dirtyFiles,
			dirtyPaths,
			safeForHandoff: dirtyFiles.length === 0 || benignDirty,
			benignDirty,
			warnings: benignDirty
				? [
						"Only whitespace instruction-file dirt detected; do not stage it automatically.",
					]
				: [],
		};
	} catch {
		return {
			ok: false,
			status: "git status unavailable",
			dirtyFiles: [],
			dirtyPaths: [],
			safeForHandoff: false,
			benignDirty: false,
			warnings: ["git status unavailable"],
		};
	}
}

function isPlanningIssue(issue) {
	return (
		labelsOf(issue).includes("wo:planning") ||
		/wo:planning/.test(notesOf(issue))
	);
}

function isBlockedIssue(issue) {
	const labels = labelsOf(issue);
	return labels.includes("wo:blocked") || labels.includes("wo:debug-needed");
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
	const slices = children.filter(isWorkSlice);
	const closed = slices.filter((issue) => statusOf(issue) === "closed");
	const inProgress = slices.filter(
		(issue) => statusOf(issue) === "in_progress",
	);
	const openDecisions = children.filter(
		(issue) => typeOf(issue) === "decision" && statusOf(issue) !== "closed",
	);
	const planning = slices.filter(
		(issue) => isPlanningIssue(issue) && statusOf(issue) !== "closed",
	);
	const readyWork = slices
		.filter(
			(issue) =>
				statusOf(issue) === "open" &&
				!isBlockedIssue(issue) &&
				depsOf(issue).every((id) => statusOf(byId.get(id)) === "closed"),
		)
		.sort(byCreatedAsc);
	const downstreamBlocked = slices
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
	const blockers = slices.filter((issue) => {
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
	const wanted = target.trim();
	if (wanted && wanted !== "last") {
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
	if (state.git && !state.git.safeForHandoff)
		return {
			...state,
			action: "dirty-stop",
			message:
				"Dirty files must be resolved before /work-resume can launch writers.",
			suggestedCommands: [
				"git status --short",
				`/work-report ${state.epic.id}`,
			],
		};
	if (state.epic.status === "closed")
		return {
			...state,
			action: "done-candidate",
			message: "Epic is closed.",
			suggestedCommands: [`/work-report ${state.epic.id}`],
		};
	if (state.readyPlanning.length && state.executableSlices.length)
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
				state.blockerIssues,
				state.openDecisions,
			),
		};
	return withHandoffPrompt({
		...state,
		action: "run-planner",
		message:
			"No ready work or blockers; ask the planner to create the next slices or confirm done.",
	});
}

const ROLE_TIMEOUT_GUIDANCE =
	"Role timeout guidance: prefer no explicit timeout; if one is required, planner/worker/reviewer/fixer/debugger/migrator get at least 10 minutes and committer gets at least 3 minutes. Treat timeout as infrastructure failure evidence, not implementation failure.";

function gitDirtyClassification(git) {
	if (!git) return "unknown";
	if (git.benignDirty) return "instruction-file allowlist";
	if (git.dirtyPaths?.length) return "dirty-stop/unsafe";
	return "clean";
}

function roleHandoffPrompt(state, mode, extraLines = []) {
	const selected = state.selectedBead;
	const selectedLine = selected
		? `${selected.id} ${selected.type} ${selected.status} — ${selected.title}`
		: "none; create/reuse a wo:planning Bead if needed";
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
				suggestedCommands: [],
			});
		const childState = buildEpicChildState(cwd, resolved.epic);
		const git = resumeGitReport(cwd);
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
			blockerIssues: childState.blockers,
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
	const childState = buildEpicChildState(cwd, epic);
	const git = gitReport(cwd);
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
		suggestedCommands: suggestedCommands(
			childState.epicId,
			childState.blockers,
		),
		rawNotes: childState.blockers
			.map((issue) => ({ id: idOf(issue), text: notesOf(issue) }))
			.filter((item) => item.text),
		warnings: git.warnings,
	};
}

function buildBeadReportState(cwd, bead) {
	const parentId = parentOf(bead);
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
			dependencies: dependencyIds.map((id) =>
				issueSummary(byId.get(id) ?? { id }),
			),
			dependents: dependents.map(issueSummary),
			notes,
		},
		counts: {
			dependencies: dependencyIds.length,
			dependents: dependents.length,
		},
		blockers: dependencyIds.map((id) => issueSummary(byId.get(id) ?? { id })),
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
		rawNotes: notesOf(bead) ? [{ id: idOf(bead), text: notesOf(bead) }] : [],
		warnings: git.warnings,
	};
}

function suggestedCommands(epicId, blockers = [], decisions = []) {
	const debugTarget = blockers.find(
		(issue) => typeOf(issue) === "bug" || isDebugIssue(issue),
	);
	if (debugTarget)
		return [`/work-debug ${idOf(debugTarget)}: investigate blocker`];
	const blockedDecision = decisions[0];
	if (blockedDecision) return [`/work-report ${idOf(blockedDecision)}`];
	const blockedWork = blockers[0];
	if (blockedWork) return [`/work-report ${idOf(blockedWork)}`];
	return epicId ? [`/work-report ${epicId}`] : [];
}

function isBeadId(value) {
	return /^[A-Za-z][A-Za-z0-9_-]*-[A-Za-z0-9_.-]+$/.test(value ?? "");
}

function createBead(cwd, { title, type = "task", parent, notes }) {
	const args = ["create", title, "--type", type];
	if (parent) args.push("--parent", parent);
	if (notes) args.push("--append-notes", notes);
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
	const wanted = target.trim();
	if (wanted && wanted !== "last") {
		const issue = one(bdJsonRequired(cwd, ["show", wanted]));
		if (!issue)
			return {
				error: "unknown-target",
				message: `No Bead found for ${wanted}`,
			};
		return typeOf(issue) === "epic"
			? { kind: "epic", epic: issue }
			: { error: "unsupported-target", message: `${wanted} is not an epic.` };
	}
	const active = epicsByStatus(cwd, "in_progress").sort(byUpdatedDesc);
	if (active.length === 1) return { kind: "epic", epic: active[0] };
	if (active.length > 1)
		return {
			error: "ambiguous-target",
			message:
				"Multiple active epics found; pass --epic <id> or target a Bead.",
			candidates: active.map((epic) => candidateSummary(cwd, epic)),
		};
	return {
		error: "no-active-epic",
		message: "No active epic found; pass --epic <id>.",
		candidates: epicsByStatus(cwd, "open").map((epic) =>
			candidateSummary(cwd, epic),
		),
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
	if (colon === -1) return { target: text, guidance: "" };
	return {
		target: text.slice(0, colon).trim(),
		guidance: text.slice(colon + 1).trim(),
	};
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

function dirtyStopState(git, message) {
	return errorState("dirty-stop", message, {
		action: "dirty-stop",
		git,
		suggestedCommands: ["git status --short"],
	});
}

function buildWorkDebugState(cwd, args = "") {
	const { target, guidance } = splitTargetGuidance(args);
	if (!target)
		return errorState("usage", "Usage: /work-debug <bug-or-bead-id|symptom>", {
			action: "usage",
		});
	try {
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
			if (!bug && isDebugIssue(source)) bug = source;
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
		if (guidance && bug && !(source === undefined && !isBeadId(target)))
			appendBeadNote(cwd, idOf(bug), `guidance: ${guidance}`);
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
		let resolved;
		if (parsed.epic) {
			const epic = one(bdJsonRequired(cwd, ["show", parsed.epic]));
			resolved =
				typeOf(epic) === "epic"
					? { kind: "epic", epic }
					: {
							error: "unsupported-target",
							message: `${parsed.epic} is not an epic.`,
						};
		} else {
			resolved = resolveWorkflowEpic(cwd, "");
		}
		if (resolved.error)
			return errorState(resolved.error, resolved.message ?? resolved.error, {
				action: "ask-target",
				candidates: resolved.candidates ?? [],
			});
		let blocker;
		if (parsed.blockedBy)
			blocker = one(bdJsonRequired(cwd, ["show", parsed.blockedBy]));
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
	const epic = one(bdJsonRequired(cwd, ["show", parsed.epic]));
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
		if (isBeadId(first) && first !== "--epic") {
			const issue = one(bdJsonRequired(cwd, ["show", first]));
			if (!issue)
				return errorState("unknown-target", `No Bead found for ${first}`);
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
				: "medium slice: create one to three executable child Beads before implementation";
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

function looksLikePath(value) {
	return /[\\/]|\.(?:md|html|txt|json|csv)$/i.test(value);
}

function artifactTitle(cwd, rel) {
	const text = readFileSync(join(cwd, rel), "utf8");
	return (
		text.match(/^title:\s*["']?([^"'\r\n]+)["']?/m)?.[1] ??
		text.match(/^#\s+(.+)$/m)?.[1] ??
		rel.split(/[\\/]/).pop()
	).trim();
}

function buildWorkMasterState(cwd, args = "") {
	const input = String(args).trim();
	if (!input)
		return errorState("usage", "Usage: /work-master <brainstorm-or-plan>", {
			action: "usage",
		});
	try {
		const masterGit = resumeGitReport(cwd);
		const handoffPlan = (message, detail) => ({
			ok: true,
			action: "handoff-plan",
			message,
			handoffPrompt: [
				"Use ce-plan to convert this input into a detailed master plan, then return to /work-master with the plan path.",
				"Auto-accept plan creation unless a real human decision is needed.",
				detail,
				`Git dirty classification: ${gitDirtyClassification(masterGit)}`,
				ROLE_TIMEOUT_GUIDANCE,
			].join("\n"),
			git: masterGit,
			warnings: masterGit.warnings,
		});
		const first = input.split(/\s+/)[0];
		const pathExists = existsSync(join(cwd, first));
		if (!pathExists && looksLikePath(first))
			return errorState("missing-source", `Source path not found: ${first}`, {
				action: "missing-source",
			});
		if (!pathExists)
			return handoffPlan(
				"Raw idea handed to ce-plan before Beads mutation.",
				`Task: ${input}`,
			);
		if (!/docs[\\/]plans[\\/].+\.(?:md|html)$/i.test(first))
			return handoffPlan(
				"Source artifact needs ce-plan before epic creation.",
				`Source: ${first}`,
			);
		if (!masterGit.safeForHandoff)
			return dirtyStopState(
				masterGit,
				"Dirty files must be resolved before /work-master can mutate Beads.",
			);
		const title = artifactTitle(cwd, first);
		const epic = createBead(cwd, {
			title,
			type: "epic",
			notes: `created by /work-master\nsource: ${first}`,
		});
		const planning = createBead(cwd, {
			title: `Plan next slices for ${title}`,
			type: "task",
			parent: idOf(epic),
			notes: workflowBeadNotes("/work-master", title, [
				"wo:planning",
				`source plan: ${first}`,
			]),
		});
		return withHandoffPrompt({
			ok: true,
			action: "run-planner",
			epic: issueSummary(epic),
			selectedBead: issueSummary(planning),
			git: masterGit,
			message: `Created epic ${idOf(epic)} and planning Bead ${idOf(planning)}.`,
			warnings: masterGit.warnings,
		});
	} catch (error) {
		return errorState(error.reason ?? "beads-error", error.message, {
			action: error.reason ?? "beads-error",
		});
	}
}

function parseMigrateSources(cwd, input) {
	const files = [];
	const branches = [];
	const text = [];
	const missing = [];
	for (const token of input.split(/\s+/).filter(Boolean)) {
		if (existsSync(join(cwd, token))) files.push(token);
		else if (/\.(?:md|html|txt|json|csv)$/i.test(token)) missing.push(token);
		else if (/^[\w.-]+\/[\w./-]+$/.test(token)) branches.push(token);
		else text.push(token);
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
	const target = String(args).trim();
	if (!target)
		return errorState("usage", "Usage: /work-finish <bead-id|epic-id>", {
			action: "usage",
		});
	try {
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
		return [`Work report unavailable: ${state.message}`, ...candidates].join(
			"\n",
		);
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
			state.git.status,
			"",
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
		state.git.status,
		"",
		`Next: ${state.suggestedCommands[0] ?? "No action suggested."}`,
	].join("\n");
}

function renderWorkReportJson(state) {
	return JSON.stringify(state, null, "\t");
}

function buildWorkReport(cwd, args = "") {
	const parsed = parseWorkReportArgs(args);
	const state = buildWorkReportState(cwd, args);
	return parsed.json
		? renderWorkReportJson(state)
		: renderWorkReportText(state);
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
		return [`Work resume unavailable: ${state.message}`, ...candidates].join(
			"\n",
		);
	}
	return [
		`Epic: ${state.epic.title} (${state.epic.id})`,
		`Action: ${state.action}`,
		`Ready: ${state.counts.ready} • executable: ${state.counts.readyExecutable} • planning: ${state.counts.planning} • blockers: ${state.counts.blockers} • decisions: ${state.counts.decisions}`,
		state.selectedBead
			? `Selected: ${state.selectedBead.id} ${state.selectedBead.type} — ${state.selectedBead.title}`
			: "Selected: none",
		state.message ? `Reason: ${state.message}` : "",
		"",
		"Git:",
		state.git.status,
		"",
		`Next: ${state.handoffPrompt ? "handoff queued to work-orchestrator" : (state.suggestedCommands?.[0] ?? "No action suggested.")}`,
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

async function handleWorkResumeCommand(args, ctx) {
	const state = buildWorkResumeState(ctx.cwd, args);
	ctx.ui.notify(renderWorkResumeText(state), state.ok ? "info" : "warning");
	if (state.handoffPrompt) {
		await ctx.sendUserMessage(state.handoffPrompt, { deliverAs: "followUp" });
	}
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
		return [
			`Work command unavailable: ${state.message}`,
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
	]
		.filter(Boolean)
		.join("\n");
}

async function handleWorkflowAction(builder, args, ctx) {
	const state = builder(ctx.cwd, args);
	ctx.ui.notify(renderWorkflowActionText(state), state.ok ? "info" : "warning");
	if (state.handoffPrompt)
		await ctx.sendUserMessage(state.handoffPrompt, { deliverAs: "followUp" });
	return state;
}

export {
	buildWorkAddState,
	buildWorkAutoState,
	buildWorkBigState,
	buildWorkDebugState,
	buildWorkFinishState,
	buildWorkflowIntakeState,
	buildWorkMasterState,
	buildWorkMedState,
	buildWorkMigrateState,
	buildWorkPauseState,
	buildWorkReport,
	buildWorkReportState,
	buildWorkResume,
	buildWorkResumeState,
	buildWorkSmallState,
	handleWorkResumeCommand,
	planResumeAction,
	renderWorkReportJson,
	renderWorkReportText,
	renderWorkResumeJson,
	renderWorkResumeText,
};

export default function workModelsExtension(pi) {
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
	});

	pi.registerCommand("work-status", {
		description: "Show deterministic Beads/git work-orchestrator status",
		handler: async (args, ctx) => {
			try {
				ctx.ui.notify(buildWorkStatus(ctx.cwd, args), "info");
			} catch (error) {
				ctx.ui.notify(
					`Could not build work status: ${error instanceof Error ? error.message : String(error)}`,
					"error",
				);
			}
		},
	});

	pi.registerCommand("work-report", {
		description: "Show deterministic Beads/git blocker handoff report",
		handler: async (args, ctx) => {
			ctx.ui.notify(buildWorkReport(ctx.cwd, args), "info");
		},
	});

	pi.registerCommand("work-resume", {
		description:
			"Resolve the next Beads-backed work action and hand off safely",
		handler: async (args, ctx) => {
			await handleWorkResumeCommand(args, ctx);
		},
	});

	pi.registerCommand("work-continue", {
		description: "Alias for deterministic /work-resume preflight",
		handler: async (args, ctx) => {
			await handleWorkResumeCommand(args, ctx);
		},
	});

	pi.registerCommand("work-pause", {
		description: "Checkpoint current Beads-backed work and stop",
		handler: async (args, ctx) => {
			await handleWorkflowAction(buildWorkPauseState, args, ctx);
		},
	});

	pi.registerCommand("work-small", {
		description: "Create one implementation Bead and hand off safely",
		handler: async (args, ctx) => {
			await handleWorkflowAction(buildWorkSmallState, args, ctx);
		},
	});

	pi.registerCommand("work-med", {
		description: "Create one medium planning Bead and hand off safely",
		handler: async (args, ctx) => {
			await handleWorkflowAction(buildWorkMedState, args, ctx);
		},
	});

	pi.registerCommand("work-big", {
		description: "Create one large-slice planning Bead and hand off safely",
		handler: async (args, ctx) => {
			await handleWorkflowAction(buildWorkBigState, args, ctx);
		},
	});

	pi.registerCommand("work-master", {
		description: "Bootstrap a master epic or plan handoff",
		handler: async (args, ctx) => {
			await handleWorkflowAction(buildWorkMasterState, args, ctx);
		},
	});

	pi.registerCommand("work-migrate", {
		description: "Normalize migration sources and hand off safely",
		handler: async (args, ctx) => {
			await handleWorkflowAction(buildWorkMigrateState, args, ctx);
		},
	});

	pi.registerCommand("work-finish", {
		description: "Classify commit/close readiness for reviewed work",
		handler: async (args, ctx) => {
			await handleWorkflowAction(buildWorkFinishState, args, ctx);
		},
	});

	pi.registerCommand("work-debug", {
		description: "Resolve or create a debug Bead and hand off safely",
		handler: async (args, ctx) => {
			await handleWorkflowAction(buildWorkDebugState, args, ctx);
		},
	});

	pi.registerCommand("work-add", {
		description: "Create explicit work under the active Beads epic",
		handler: async (args, ctx) => {
			await handleWorkflowAction(buildWorkAddState, args, ctx);
		},
	});

	pi.registerCommand("work-auto", {
		description: "Run deterministic /work-auto guards and hand off",
		handler: async (args, ctx) => {
			await handleWorkflowAction(buildWorkAutoState, args, ctx);
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
