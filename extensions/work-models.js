import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
	CONFIG_DIR_NAME,
	DynamicBorder,
} from "@earendil-works/pi-coding-agent";
import {
	decodeKittyPrintable,
	getKeybindings,
	SelectList,
	Text,
} from "@earendil-works/pi-tui";

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

function itemMatchesFilter(item, filter) {
	const terms = filter.toLowerCase().trim().split(/\s+/).filter(Boolean);
	if (terms.length === 0) return true;
	const haystack =
		`${item.label} ${item.value} ${item.description ?? ""}`.toLowerCase();
	return terms.every((term) => haystack.includes(term));
}

function printableInput(data) {
	const kittyPrintable = decodeKittyPrintable(data);
	if (kittyPrintable !== undefined) return kittyPrintable;
	const hasControlChars = [...data].some((char) => {
		const code = char.charCodeAt(0);
		return code < 32 || code === 0x7f || (code >= 0x80 && code <= 0x9f);
	});
	return hasControlChars ? undefined : data;
}

async function pick(ctx, title, items, selectedValue) {
	const result = await ctx.ui.custom((tui, theme, _kb, done) => {
		let filter = "";
		let list;

		const listTheme = {
			selectedPrefix: (text) => theme.fg("accent", text),
			selectedText: (text) => theme.fg("accent", text),
			description: (text) => theme.fg("muted", text),
			scrollInfo: (text) => theme.fg("dim", text),
			noMatch: (text) => theme.fg("warning", text),
		};

		function rebuildList(preferredValue) {
			const filteredItems = items.filter((item) =>
				itemMatchesFilter(item, filter),
			);
			list = new SelectList(
				filteredItems,
				Math.min(filteredItems.length || 1, 12),
				listTheme,
			);
			const selectedIndex = filteredItems.findIndex(
				(item) => item.value === preferredValue,
			);
			if (selectedIndex >= 0) list.setSelectedIndex(selectedIndex);
			list.onSelect = (item) => done(item.value);
			list.onCancel = () => done(null);
		}

		rebuildList(selectedValue);

		return {
			render: (width) => [
				...new DynamicBorder((text) => theme.fg("accent", text)).render(width),
				...new Text(theme.fg("accent", theme.bold(title))).render(width),
				...new Text(
					theme.fg("dim", `filter: ${filter || "(type to filter)"}`),
				).render(width),
				...list.render(width),
				...new Text(
					theme.fg(
						"dim",
						"type to filter • backspace edit • ↑↓ navigate • enter select • esc cancel",
					),
				).render(width),
				...new DynamicBorder((text) => theme.fg("accent", text)).render(width),
			],
			invalidate: () => list.invalidate(),
			handleInput: (data) => {
				const kb = getKeybindings();
				if (kb.matches(data, "tui.editor.deleteCharBackward") && filter) {
					filter = filter.slice(0, -1);
					rebuildList();
					tui.requestRender();
					return;
				}
				if (kb.matches(data, "tui.editor.deleteToLineStart") && filter) {
					filter = "";
					rebuildList(selectedValue);
					tui.requestRender();
					return;
				}

				const typed = printableInput(data);
				if (typed) {
					filter += typed;
					rebuildList();
					tui.requestRender();
					return;
				}

				list.handleInput(data);
				tui.requestRender();
			},
		};
	});
	return result;
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

export default function workModelsExtension(pi) {
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

			const slotKey = await pick(ctx, "Work models: choose task", slotItems);
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
			const selectedModel = commonValue(
				slot.agents.map((agent) => current[agent]?.model),
			);
			const selectedThinking = commonValue(
				slot.agents.map((agent) => current[agent]?.thinking),
			);

			const model = await pick(
				ctx,
				`${slot.label}: choose model`,
				await modelItems(ctx),
				typeof selectedModel === "string" ? selectedModel : INHERIT_MODEL,
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
			const thinking = await pick(
				ctx,
				`${slot.label}: choose effort`,
				thinkingItems,
				typeof selectedThinking === "string"
					? selectedThinking
					: DEFAULT_THINKING,
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
