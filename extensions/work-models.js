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
	return item.description
		? `${item.label} — ${item.description}`
		: item.label;
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
	if (wanted && wanted !== "last") return { epic: one(bdJson(cwd, ["show", wanted])) };

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
		(issue) => /wo:planning/.test(JSON.stringify(issue)) && statusOf(issue) !== "closed",
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
		if (readySlices.length) return `Run /work-resume ${epicId} to handle ${idOf(readySlices[0])}.`;
		if (active.length) return `Continue or pause active slice ${idOf(active[0])}.`;
		if (planning.length) return `Run /work-resume ${epicId}; planner should create the next slices.`;
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
		...(readySlices.length ? readySlices.map((issue) => `- ${lineFor(issue)}`) : ["- none"]),
		"",
		"In progress:",
		...(active.length ? active.map((issue) => `- ${lineFor(issue)}`) : ["- none"]),
		"",
		"Planned ahead / blocked:",
		...(planned.length ? planned.map((issue) => `- ${lineFor(issue)}`) : ["- none"]),
		"",
		"Open decisions:",
		...(decisions.length ? decisions.map((issue) => `- ${lineFor(issue)}`) : ["- none"]),
		"",
		"Git:",
		gitStatus || "clean",
		"",
		`Next: ${next}`,
	].join("\n");
}

export default function workModelsExtension(pi) {
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
			const model = await choose(ctx, `${slot.label}: choose model`, await modelItems(ctx));
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
