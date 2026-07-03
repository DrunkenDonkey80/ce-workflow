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
	compactAtTokens: 100_000,
	maxSummaryChars: 24_000,
};
const MIN_COMPACT_AT_TOKENS = 30_000;
let contextCompactInFlight = false;

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
		Math.min(configured, Math.floor(contextWindow * 0.45)),
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
		`Usage: ${usage?.tokens ? `${usage.tokens.toLocaleString()} tokens` : "unknown"}`,
		`Trigger: ${trigger.toLocaleString()} tokens`,
		`Summary budget: ${Number(current.maxSummaryChars ?? DEFAULT_CONTEXT.maxSummaryChars).toLocaleString()} chars`,
		"Compaction style: instant, local, no LLM call; drops reasoning and full tool logs.",
	].join("\n");
}

function maybeCompact(ctx, settings, reason) {
	const current = contextSettings(settings);
	if (current.enabled === false || contextCompactInFlight) return false;
	const usage = ctx.getContextUsage?.();
	if (!usage?.tokens) return false;
	const trigger = compactTriggerTokens(ctx, settings);
	if (usage.tokens < trigger) return false;
	contextCompactInFlight = true;
	ctx.compact({
		customInstructions: `work-orchestrator proactive ${reason}: preserve goals, Beads/git state, file changes, blockers, and next command; omit reasoning and full tool logs.`,
		onComplete: () => {
			contextCompactInFlight = false;
			ctx.ui.notify("Work context compacted before rot", "info");
		},
		onError: (error) => {
			contextCompactInFlight = false;
			ctx.ui.notify(
				`Work context compaction failed: ${error.message}`,
				"warning",
			);
		},
	});
	return true;
}

function run(cwd, command, args) {
	return execFileSync(command, args, {
		cwd,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	}).trim();
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

export default function workModelsExtension(pi) {
	pi.on("session_before_compact", async (event, ctx) => {
		let settings = {};
		try {
			settings = readSettings(ctx.cwd);
		} catch {
			// Ignore unreadable project settings and keep compaction safe.
		}
		const current = contextSettings(settings);
		if (current.enabled === false) return;
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
		contextCompactInFlight = false;
	});

	pi.on("turn_end", async (_event, ctx) => {
		try {
			maybeCompact(ctx, readSettings(ctx.cwd), "turn boundary");
		} catch {
			maybeCompact(ctx, {}, "turn boundary");
		}
	});

	pi.on("before_agent_start", async (_event, ctx) => {
		try {
			maybeCompact(ctx, readSettings(ctx.cwd), "prompt boundary");
		} catch {
			maybeCompact(ctx, {}, "prompt boundary");
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
				ctx.compact({
					customInstructions:
						"manual work-context compact: preserve Beads/git state, files, blockers, and next command; omit reasoning and full tool logs.",
					onComplete: () => ctx.ui.notify("Work context compacted", "info"),
					onError: (error) =>
						ctx.ui.notify(
							`Work context compaction failed: ${error.message}`,
							"warning",
						),
				});
				return;
			}
			if (command === "off" || command === "disable") {
				setContextSettings(settings, { enabled: false });
				writeSettings(ctx.cwd, settings);
				ctx.ui.notify("Disabled work context guard", "info");
				return;
			}
			if (command === "on" || command === "enable") {
				setContextSettings(settings, { enabled: true });
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
