#!/usr/bin/env node
import assert from "node:assert/strict";
import {
	resetDialogStateForTest,
	showListDialog,
	showTreeWorkspaceDialog,
} from "../extensions/work-dialogs.js";

const colors = [];
const theme = {
	fg: (color, text) => {
		colors.push({ color, text });
		return text;
	},
	bold: (text) => text,
};
const keybindings = {
	matches: (data, id) =>
		(id === "tui.select.up" && data === "up") ||
		(id === "tui.select.down" && data === "down") ||
		(id === "tui.select.confirm" && data === "enter") ||
		(id === "tui.select.cancel" && data === "escape") ||
		(id === "tui.editor.deleteCharBackward" && data === "backspace"),
};

function terminalWidth(value, emojiWidth = 2) {
	let width = 0;
	for (const char of value) {
		if (/\p{Mark}/u.test(char) || char === "\uFE0F") continue;
		width += /\p{Emoji_Presentation}/u.test(char) ? emojiWidth : 1;
	}
	return width;
}

function calibratedTerminalWidth(value) {
	let width = terminalWidth(value);
	for (const emoji of ["🧭", "🧱", "🌍"])
		width += value.split(emoji).length - 1;
	return width;
}

async function drive(
	options,
	interact,
	activeTheme = theme,
	terminalRows = 24,
) {
	let overlay;
	const result = await showListDialog(
		{
			mode: "tui",
			ui: {
				async custom(factory, customOptions) {
					overlay = customOptions;
					let value;
					let closed = false;
					const component = factory(
						{ terminal: { rows: terminalRows }, requestRender() {} },
						activeTheme,
						keybindings,
						(next) => {
							value = next;
							closed = true;
						},
					);
					const initialRender = component.render(70);
					assert.equal(
						initialRender.length,
						Math.max(1, terminalRows - 1),
						"workspace occupies a stable terminal viewport",
					);
					assert.strictEqual(
						component.render(70),
						initialRender,
						"unchanged workspaces reuse their rendered viewport",
					);
					await interact(component, () => closed);
					assert(closed, "dialog interaction closes");
					return value;
				},
			},
		},
		options,
	);
	assert.equal(overlay.overlay, true, "menus use an overlay workspace");
	assert.equal(overlay.overlayOptions.width, "100%");
	assert.equal(overlay.overlayOptions.maxHeight, "100%");
	assert.equal(overlay.overlayOptions.anchor, "top-left");
	assert.equal(
		overlay.overlayOptions.margin.right,
		1,
		"workspace leaves the terminal wrap column unused",
	);
	return result;
}

resetDialogStateForTest();
const items = [
	{ value: "alpha", label: "Alpha" },
	{ value: "beta", label: "Beta" },
	{ value: "gamma", label: "Gamma" },
];
const picked = await drive(
	{ title: "Root", items, cursorKey: "root" },
	(component) => {
		component.handleInput("down");
		component.handleInput("enter");
	},
);
assert.equal(picked.value, "beta");
await drive(
	{
		title: "Root",
		items,
		cursorKey: "root",
		subtitle: ["Stats:", "Plan:", "- model: 1m 0s, 1k tokens"],
	},
	(component) => {
		const lines = component.render(70);
		assert(
			lines.some((line) => line.includes("Choose an option to continue.")),
			"every dialog shows its purpose below the title",
		);
		assert(
			lines.some((line) => line.includes("❯  Beta")),
			"returning from a submenu restores its parent cursor",
		);
		assert(
			lines.some((line) => line.includes("- model: 1m 0s, 1k tokens")),
			"dialogs render multi-line stats subtitles",
		);
		component.handleInput("escape");
	},
);

await drive(
	{
		title: "Indicators",
		items: [{ ...items[0], local: true }, ...items.slice(1)],
		currentValue: "beta",
		selectedIndex: 0,
	},
	(component) => {
		const lines = component.render(70);
		assert(lines.some((line) => line.includes("❯ *Alpha")));
		assert(lines.some((line) => line.includes("●Beta")));
		assert(!lines.some((line) => line.includes("(current)")));
		component.handleInput("escape");
	},
);

colors.length = 0;
await drive(
	{
		title: "Colored segments",
		items: [
			{
				value: "usage",
				label: "Usage [████░░] 60%",
				labelSegments: [
					{ text: "Usage " },
					{ text: "[████░░] 60%", color: "warning" },
				],
			},
		],
	},
	(component) => {
		assert(component.render(70).some((line) => line.includes("[████░░] 60%")));
		assert(
			colors.some(
				({ color, text }) => color === "warning" && text.includes("████"),
			),
		);
		component.handleInput("escape");
	},
);

const checklist = await drive(
	{
		title: "Checks",
		items,
		cursorKey: "checks",
		multi: { selected: ["alpha"], requireOne: true },
	},
	(component) => {
		component.handleInput("down");
		component.handleInput("enter");
		assert(
			component.render(70).some((line) => line.includes("❯ ✓Beta")),
			"selection and checked indicators use separate columns",
		);
		component.handleInput(" ");
		assert(
			component.render(70).some((line) => line.includes("❯ ○Beta")),
			"selection and unchecked indicators use separate columns",
		);
		component.handleInput(" ");
		component.handleInput("escape");
	},
);
assert.deepEqual(new Set(checklist.values), new Set(["alpha", "beta"]));

const filtered = await drive(
	{
		title: "Models",
		cursorKey: "models",
		filter: true,
		items: [
			{ value: "openai/gpt", label: "GPT" },
			{ value: "anthropic/claude", label: "Claude Sonnet" },
		],
	},
	(component) => {
		for (const key of "claude") component.handleInput(key);
		let lines = component.render(70);
		assert(lines.some((line) => line.includes("Filter: claude")));
		assert(lines.some((line) => line.includes("Claude Sonnet")));
		assert(!lines.some((line) => line.includes("GPT")));
		component.handleInput("escape");
		lines = component.render(70);
		assert(lines.some((line) => line.includes("Filter: ")));
		assert(lines.some((line) => line.includes("GPT")));
		for (const key of "claude") component.handleInput(key);
		component.handleInput("enter");
	},
);
assert.equal(
	filtered.value,
	"anthropic/claude",
	"filtered model can be selected",
);

await drive(
	{
		title: "Details",
		filter: false,
		descriptionMinLines: 3,
		items: [
			{ value: "short", label: "Short", description: "Short context." },
			{
				value: "roadmap",
				label: "Roadmap",
				description:
					"First description line has useful context and continues with implementation constraints.",
			},
		],
	},
	(component) => {
		const shortLines = component.render(36);
		component.handleInput("down");
		const detailedLines = component.render(36);
		assert.equal(
			detailedLines.length,
			shortLines.length,
			"fixed detail rows keep the overlay in place",
		);
		assert(
			detailedLines
				.join(" ")
				.replace(/\s+/g, " ")
				.includes(
					"First description line has useful context and continues with implementation constraints.",
				),
			"details remain readable across terminal-width wrapping",
		);
		component.handleInput("escape");
	},
);

await drive(
	{
		title: "Description color",
		filter: false,
		items: [
			{
				value: "exact",
				label: "Exact width",
				description: "123456789012345 1234567890123456 rest",
			},
		],
	},
	(component) => {
		const descriptionLines = component
			.render(36)
			.filter((line) => /123456789|rest/.test(line));
		assert(
			descriptionLines.every((line) => line.includes("\x1b[90m")),
			"every wrapped description line keeps the same muted color",
		);
		component.handleInput("escape");
	},
	{
		...theme,
		fg: (color, text) => (color === "muted" ? `\x1b[90m${text}\x1b[0m` : text),
	},
);

await drive(
	{
		title: "Fixed",
		fixedHeight: true,
		descriptionMinLines: 3,
		descriptionMaxLines: 3,
		items: Array.from({ length: 13 }, (_, index) => ({
			value: `item-${index}`,
			label: index === 12 ? "Unique final item" : `Item ${index}`,
			description: index % 2 ? undefined : `Description ${index}`,
		})),
	},
	(component) => {
		const height = component.render(70).length;
		component.handleInput("down");
		assert.equal(component.render(70).length, height);
		for (const key of "unique") component.handleInput(key);
		const filteredLines = component.render(70);
		assert.equal(
			filteredLines.length,
			height,
			"fixed dialogs do not resize when filtering to one row",
		);
		assert(
			filteredLines.some((line) => line.includes("\u00a0")),
			"empty detail rows contain a clearing cell instead of leaving stale text",
		);
		component.handleInput("z");
		assert.equal(
			component.render(70).length,
			height,
			"fixed dialogs do not resize when filtering to no rows",
		);
		component.handleInput("escape");
		component.handleInput("escape");
	},
);

colors.length = 0;
await drive(
	{
		title: "Work roadmaps",
		purpose: "Choose a roadmap to inspect, plan, or continue.",
		items: [
			{
				value: "roadmaps",
				label: "🌍 Roadmaps",
				description: "Calibrated globe width",
				descriptionPrefix: "│  ",
				inlineDescription: true,
			},
			{
				value: "current",
				label: "├* Current [in progress]",
				description: "Work currently in progress",
				descriptionPrefix: "│  ",
				inlineDescription: true,
				color: "success",
			},
			{
				value: "done",
				label: "├─ ✅ Done [closed]",
				description: "Finished work",
				descriptionPrefix: "│  ",
				inlineDescription: true,
				color: "dim",
			},

			{
				value: "init",
				label: "├─ 🧱 Initialize",
				description: "One extra terminal cell",
				descriptionPrefix: "│  ",
				inlineDescription: true,
			},
			{
				value: "plan",
				label: "├─ 🧭 Plan",
				description: "One extra terminal cell",
				descriptionPrefix: "│  ",
				inlineDescription: true,
			},
		],
	},
	(component) => {
		const lines = component.render(70);
		assert(lines.some((line) => line.includes("Choose a roadmap to inspect")));
		assert(lines.some((line) => line.includes("├* Current [in progress]")));
		assert(
			lines.some((line) => line.includes("│  Work currently in progress")),
		);
		assert(lines.some((line) => line.includes("├─ ✅ Done [closed]")));
		for (const line of lines)
			assert.equal(
				calibratedTerminalWidth(line),
				68,
				`calibrated terminal width: ${line}`,
			);
		assert(
			colors.some(
				(entry) => entry.color === "success" && entry.text.includes("Current"),
			),
			"current rows are green",
		);
		assert(
			colors.some(
				(entry) => entry.color === "dim" && entry.text.includes("Done"),
			),
			"completed rows are gray",
		);
		component.handleInput("escape");
	},
);

await drive(
	{
		title: "Multiple calibrated icons",
		items: [
			{ value: "stages", label: "🧭 Plan → 🧱 Build" },
			{
				value: "truncated",
				label: `${"Long stage ".repeat(9)}🧭 🧱`,
			},
		],
	},
	(component) => {
		const lines = component.render(70);
		assert(lines.some((line) => line.includes("🧭 Plan → 🧱 Build")));
		assert(lines.some((line) => line.includes("…")));
		for (const line of lines)
			assert.equal(
				calibratedTerminalWidth(line),
				68,
				`multiple-icon terminal width: ${line}`,
			);
		component.handleInput("escape");
	},
);

await drive(
	{ title: "Tiny terminal", items },
	(component) => {
		assert.equal(component.render(70).length, 4);
		component.handleInput("escape");
	},
	theme,
	5,
);

const tabbed = await drive(
	{
		title: "Views",
		items,
		tabAction: { label: "Show all" },
	},
	(component) => component.handleInput("tab"),
);
assert.equal(tabbed.action, "tab");

const treeFrames = [
	{
		ok: true,
		signature: "one",
		selectedId: "roadmap-open",
		roadmaps: [
			{
				id: "roadmap-open",
				title: "Open roadmap stored title",
				shortTitle: "Open roadmap",
				description:
					"The complete selected roadmap description wraps in the lower detail pane with enough additional stored context to occupy six lines in a narrow viewport without telemetry displacing any selected-item description text from the reserved detail area.",
				status: "open",
				role: "standalone_epic",
				progress: { completed: 0, total: 2 },
				attention: true,
				tasks: [
					{
						id: "task-a",
						title: "Task A",
						description: "Task A full stored description.",
						status: "open",
						children: [
							{
								id: "task-a-child",
								title: "Task A child",
								status: "open",
								exactLive: true,
								live: true,
								children: [],
							},
						],
					},
					{
						id: "task-b",
						title: "Task B",
						status: "in_progress",
						children: [],
					},
				],
			},
			{
				id: "roadmap-aggregate-open",
				title: "Native closed, aggregate open",
				status: "closed",
				aggregateStatus: "open",
				role: "standalone_epic",
				progress: { completed: 0, total: 1 },
				tasks: [
					{
						id: "task-aggregate-open",
						title: "Aggregate-open child",
						status: "open",
						children: [],
					},
				],
			},
			{
				id: "roadmap-closed",
				title: "Closed roadmap",
				status: "closed",
				role: "standalone_epic",
				progress: { completed: 1, total: 1 },
				tasks: [
					{
						id: "task-closed",
						title: "Hidden task",
						status: "closed",
						children: [],
					},
				],
			},
		],
	},
	{
		ok: true,
		signature: "two",
		roadmaps: [
			{
				id: "roadmap-open",
				title: "Open roadmap refreshed",
				status: "open",
				tasks: [
					{ id: "task-b", title: "Task B", status: "open", children: [] },
					{ id: "task-a", title: "Task A", status: "open", children: [] },
				],
			},
		],
	},
];

async function driveTree(options, interact, mode = "tui") {
	let tick;
	let overlay;
	let renders = 0;
	let cleanups = 0;
	let cleared = 0;
	let contextUsageCalls = 0;
	const result = await showTreeWorkspaceDialog(
		{
			mode,
			model: { provider: "test-provider", id: "test-model" },
			sessionManager: { getSessionId: () => "session-42" },
			getContextUsage: () => {
				contextUsageCalls += 1;
				return { tokens: 1234, maxTokens: 8192 };
			},
			ui: {
				async custom(factory, customOptions) {
					overlay = customOptions;
					let value;
					let closed = false;
					const component = factory(
						{
							terminal: { rows: options.testRows ?? 30 },
							requestRender() {
								renders += 1;
							},
						},
						theme,
						keybindings,
						(next) => {
							value = next;
							closed = true;
						},
					);
					await interact(component, {
						get tick() {
							return tick;
						},
						get renders() {
							return renders;
						},
					});
					assert(closed, "tree workspace closes");
					return value;
				},
				async select(_title, labels) {
					return labels[0];
				},
			},
		},
		{
			title: "Tree workspace",
			purpose: "Inspect projected work without mutating it.",
			frame: treeFrames[0],
			setIntervalFn(callback) {
				tick = callback;
				return 7;
			},
			clearIntervalFn(value) {
				assert.equal(value, 7);
				cleared += 1;
			},
			setTimeoutFn(callback) {
				callback();
				return 8;
			},
			clearTimeoutFn() {},
			cleanup() {
				cleanups += 1;
			},
			...options,
		},
	);
	return { result, renders, cleanups, cleared, contextUsageCalls, overlay };
}

let refreshStep = 0;
const statsCalls = [];
colors.length = 0;
const treeRun = await driveTree(
	{
		resolveStats(id) {
			statsCalls.push(id);
			return id === "roadmap-open"
				? [
						"Stats:",
						"Plan:",
						`- selected ${id}`,
						"Work:",
						...Array.from({ length: 9 }, (_, at) => `- metric ${at + 1}`),
					]
				: ["Stats:", `- selected ${id}`];
		},
		async refresh() {
			refreshStep += 1;
			if (refreshStep === 1) return treeFrames[0];
			if (refreshStep === 2) return treeFrames[1];
			if (refreshStep === 3)
				return {
					...treeFrames[1],
					signature: "duplicate",
					roadmaps: [...treeFrames[1].roadmaps, ...treeFrames[1].roadmaps],
				};
			throw new Error("projection unavailable");
		},
	},
	async (component, state) => {
		let lines = component.render(70);
		assert(
			lines.some((line) => line.includes("Inspect projected work")),
			"tree workspace has one purpose line",
		);
		assert(
			lines.some((line) => line.includes("Task A")),
			"open containers default expanded",
		);
		assert(lines.some((line) => line.includes("[-] ● 0/2 Open roadmap")));
		assert(lines.some((line) => line.includes("[+] ✓ 1/1 Closed roadmap")));
		assert(lines.some((line) => /\s{2}\[-\] ● Task A/.test(line)));
		assert(
			lines.some((line) => line.includes("Task A child [running]")) &&
				lines.some((line) => line.includes("Task B [active]")),
			"live and durable active tasks show distinct status labels",
		);
		assert(
			lines.some((line) =>
				line.includes("complete selected roadmap description"),
			),
		);
		const initialSeparatorAt = lines.findIndex((line) =>
			line.includes(" Work items "),
		);
		const initialFirstRowAt = lines.findIndex((line) =>
			line.includes("Open roadmap"),
		);
		assert.equal(
			initialSeparatorAt,
			3,
			"header collapses to its three content rows",
		);
		assert.equal(initialFirstRowAt, initialSeparatorAt + 1);
		assert(
			lines[initialSeparatorAt + 1].trimEnd().endsWith("Stats:"),
			"stats start below the Work items line in the right column",
		);
		assert(
			lines[initialSeparatorAt + 3]
				.trimEnd()
				.endsWith("- selected roadmap-open"),
			"selection stats share the work-item body without overlap",
		);
		assert(
			lines.some((line) => line.includes("- metric 9")),
			"available body height shows all stats",
		);
		const narrowLines = component.render(42);
		const narrowSeparatorAt = narrowLines.findIndex((line) =>
			line.includes(" Work items "),
		);
		assert(
			narrowLines[narrowSeparatorAt + 1].trimEnd().endsWith("Stats:"),
			"narrow workspaces retain stats below the separator",
		);
		const detailsAt = narrowLines.findIndex((line) =>
			line.includes(" Details "),
		);
		const keysAt = narrowLines.findIndex((line) => line.includes(" Keys "));
		assert.equal(
			keysAt - detailsAt - 1,
			6,
			"six description rows are reserved",
		);
		assert(
			narrowLines.slice(detailsAt + 1, keysAt).every((line) => line.trim()),
			"all six reserved rows render wrapped selected description",
		);
		assert(
			!lines
				.slice(lines.findIndex((line) => line.includes(" Details ")))
				.some((line) => line.includes("- selected roadmap-open")),
			"stats are removed from Details",
		);
		assert.equal(lines.filter((line) => line.includes("❯")).length, 1);
		assert(
			lines.some((line) => line.includes("Aggregate-open child")),
			"aggregate-open native closed parents default expanded",
		);
		assert(
			!colors.some(
				(call) =>
					call.color === "dim" &&
					call.text.includes("Native closed, aggregate open"),
			),
			"aggregate-open titles are not dimmed",
		);
		for (const color of ["warning", "success", "muted"])
			assert(
				colors.some((call) => call.color === color && call.text === "●"),
				`${color} status dot is colored independently`,
			);
		assert(
			colors.some(
				(call) => call.color === "success" && call.text === "Plan:",
			) &&
				colors.some(
					(call) => call.color === "warning" && call.text === "Work:",
				),
			"adjacent stats blocks use distinct colors",
		);
		assert(
			colors.some((call) => call.color === "dim" && call.text === "✓"),
			"aggregate-complete rows use a dim checkmark",
		);
		assert(
			!lines.some((line) => line.includes("Hidden task")),
			"closed containers default collapsed",
		);
		for (const key of "hidden") component.handleInput(key);
		assert(
			component.render(70).some((line) => line.includes("Hidden task")),
			"filter searches descendants of collapsed containers",
		);
		component.handleInput("escape");
		component.handleInput(" ");
		lines = component.render(70);
		assert(
			!lines.some((line) => line.includes("Task A")),
			"Space collapses before filtering",
		);
		assert(
			lines.some((line) => line.includes("Filter: ")),
			"Space is not appended to the filter",
		);
		component.handleInput("right");
		component.handleInput("down");
		component.handleInput("down");
		assert(
			component.render(70).some((line) => /❯\s+● Task A child/.test(line)),
		);
		component.handleInput("left");
		lines = component.render(70);
		assert(lines.some((line) => /❯.*\[\+\] ● Task A/.test(line)));
		assert(!lines.some((line) => line.includes("Task A child")));
		component.handleInput("left");
		lines = component.render(70);
		assert(lines.some((line) => /❯.*\[\+\] ● 0\/2 Open roadmap/.test(line)));
		assert(!lines.some((line) => line.includes("Task A")));
		component.handleInput("right");
		component.handleInput("down");
		component.handleInput("right");
		lines = component.render(70);
		assert(lines.some((line) => /❯.*\[-\] ● Task A/.test(line)));
		assert.equal(lines.filter((line) => line.includes("❯")).length, 1);
		assert(
			lines[initialSeparatorAt + 2].trimEnd().endsWith("- selected task-a"),
			"stats remain below the separator when selection changes",
		);
		assert.equal(
			lines.findIndex((line) => line.includes(" Work items ")),
			initialSeparatorAt,
			"Work items separator does not move when selected stats shrink",
		);
		assert.equal(
			lines.findIndex((line) => line.includes("Open roadmap")),
			initialFirstRowAt,
			"first tree row stays fixed when selected stats shrink",
		);
		assert(
			lines.some((line) => line.includes("Task A full stored description.")),
			"description and telemetry follow stable selection",
		);
		component.handleInput("up");
		assert(component.render(70).some((line) => /❯.*Open roadmap/.test(line)));
		component.handleInput("down");
		assert(component.render(70).some((line) => /❯.*\[-\] ● Task A/.test(line)));
		assert.equal(statsCalls.filter((id) => id === "roadmap-open").length, 1);
		assert.equal(statsCalls.filter((id) => id === "task-a").length, 1);
		assert.equal(
			new Set(statsCalls).size,
			statsCalls.length,
			"stats resolve once per selected ID",
		);
		const before = state.renders;
		await state.tick();
		assert.equal(state.renders, before, "unchanged signatures do not render");
		await state.tick();
		assert.equal(
			state.renders,
			before + 1,
			"changed signatures render exactly once",
		);
		lines = component.render(70);
		assert(
			lines.some((line) => /❯\s+● Task A/.test(line)),
			"cursor follows stable ID across reorder",
		);
		const beforeMalformed = state.renders;
		await state.tick();
		assert.equal(
			state.renders,
			beforeMalformed,
			"duplicate refresh is rejected",
		);
		await state.tick();
		lines = component.render(70);
		assert(
			lines.some((line) => line.includes("Task B")),
			"projection errors retain the last good frame",
		);
		assert.equal(lines.filter((line) => line.includes("❯")).length, 1);
		component.handleInput("escape");
	},
);
assert.equal(treeRun.result.action, "back");
assert.equal(treeRun.overlay.overlayOptions.anchor, "top-left");
assert.equal(treeRun.overlay.overlayOptions.width, "100%");
assert.equal(treeRun.overlay.overlayOptions.maxHeight, "100%");
assert.equal(
	treeRun.overlay.overlayOptions.margin.right,
	1,
	"tree workspace leaves the terminal wrap column unused",
);
assert.equal(treeRun.cleanups, 1, "Escape invokes explicit cleanup once");
assert.equal(treeRun.cleared, 1, "Escape clears refresh timer");
assert.equal(
	treeRun.contextUsageCalls,
	0,
	"render never reads current context usage",
);

const failedStatsTree = await driveTree(
	{
		resolveStats: () => {
			throw new Error("stats unavailable");
		},
	},
	async (component) => {
		assert(component.render(70).some((line) => line.includes("- unknown")));
		component.handleInput("down");
		assert(component.render(70).some((line) => line.includes("- unknown")));
		component.handleInput("escape");
	},
);
assert.equal(
	failedStatsTree.result.action,
	"back",
	"stats failure does not break navigation",
);

let deferredStats;
let cancelledStats = 0;
const deferredStatsCalls = [];
await driveTree(
	{
		setTimeoutFn(callback) {
			deferredStats = callback;
			return 91;
		},
		clearTimeoutFn(value) {
			assert.equal(value, 91);
			cancelledStats += 1;
		},
		resolveStats(id) {
			deferredStatsCalls.push(id);
			return ["Stats:", `- selected ${id}`];
		},
	},
	async (component) => {
		assert(component.render(70).some((line) => line.includes("- loading…")));
		assert.equal(
			deferredStatsCalls.length,
			0,
			"render never resolves stats inline",
		);
		component.handleInput("down");
		assert(component.render(70).some((line) => line.includes("- loading…")));
		assert.equal(
			deferredStatsCalls.length,
			0,
			"arrow navigation stays filesystem-free",
		);
		deferredStats();
		assert.deepEqual(deferredStatsCalls, ["task-a"]);
		assert(
			component.render(70).some((line) => line.includes("- selected task-a")),
		);
		component.handleInput("escape");
	},
);
assert.equal(cancelledStats, 1, "moving selection cancels stale stats work");

const shortTree = await driveTree({ testRows: 8 }, async (component) => {
	const lines = component.render(18);
	assert.equal(lines.length, 7, "short workspace stays within terminal height");
	assert(lines.some((line) => line.includes(" Work items ")));
	assert(lines.some((line) => line.includes(" Details ")));
	assert(lines.some((line) => line.includes(" Keys ")));
	assert(
		lines.every((line) => terminalWidth(line) <= 16),
		"narrow workspace stays within width",
	);
	component.handleInput("escape");
});
assert.equal(
	shortTree.result.action,
	"back",
	"narrow/short fallback remains cancellable",
);

const selectedTree = await driveTree({}, async (component) =>
	component.handleInput("enter"),
);
assert.equal(selectedTree.result.value, "roadmap-open");
assert.equal(selectedTree.cleanups, 1, "done/select invokes cleanup");

const backedTree = await driveTree({}, async (component) =>
	component.handleInput("backspace"),
);
assert.equal(backedTree.result.action, "back");
assert.equal(backedTree.cleanups, 1, "back invokes cleanup");

let nativeCleanup = 0;
const nativeTree = await showTreeWorkspaceDialog(
	{ mode: "rpc", ui: { select: async (_title, labels) => labels[0] } },
	{
		title: "Native tree",
		frame: treeFrames[0],
		cleanup() {
			nativeCleanup += 1;
		},
	},
);
assert.equal(nativeTree.value, "roadmap-open");
assert.equal(nativeCleanup, 1, "native fallback invokes cleanup");

process.stdout.write("ok - shared work dialogs\n");
