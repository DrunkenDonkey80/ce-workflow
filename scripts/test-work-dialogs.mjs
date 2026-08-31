#!/usr/bin/env node
import assert from "node:assert/strict";
import {
	resetDialogStateForTest,
	showListDialog,
	showTreeWorkspaceDialog,
} from "../extensions/work-dialogs.js";

const colorCalls = [];
const theme = {
	fg: (color, text) => {
		colorCalls.push({ color, text });
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
		(id === "tui.input.tab" && data === "tab") ||
		(id === "tui.editor.cursorLeft" && data === "left") ||
		(id === "tui.editor.cursorRight" && data === "right") ||
		(id === "tui.editor.deleteCharBackward" && data === "backspace") ||
		(id === "tui.editor.deleteCharForward" && data === "delete"),
};
const plain = (value) => value.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");

async function drive(options, interact) {
	let customOptions = "not-called";
	let renders = 0;
	const result = await showListDialog(
		{
			mode: "tui",
			ui: {
				async custom(factory, options) {
					customOptions = options;
					let value;
					let closed = false;
					const component = factory(
						{ requestRender: () => (renders += 1) },
						theme,
						keybindings,
						(next) => {
							value = next;
							closed = true;
						},
					);
					await interact(component, () => closed);
					assert(closed, "dialog interaction closes");
					return value;
				},
			},
		},
		options,
	);
	assert.equal(
		customOptions,
		undefined,
		"menus use Pi's normal replacement UI, not overlays",
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

colorCalls.length = 0;
await drive(
	{
		title: "Root",
		items,
		cursorKey: "root",
		subtitle: ["Stats:", "- model: 1m 0s, 1k tokens"],
	},
	(component) => {
		const lines = component.render(70);
		const purposeLine = lines.findIndex((line) =>
			line.includes("Choose an option to continue."),
		);
		assert.equal(purposeLine >= 0, true);
		assert(lines[purposeLine + 1].includes("Type to filter"));
		assert(!lines.some((line) => line.includes("-- Keys")));
		assert.match(lines.at(-1), /^─+$/u);
		assert(
			colorCalls.some(
				({ color, text }) => color === "border" && /^─+$/u.test(text),
			),
			"replacement menus retain a footer divider",
		);
		assert(
			colorCalls.some(
				({ color, text }) =>
					color === "text" && text === "Choose an option to continue.",
			),
			"menu descriptions use the normal foreground shade",
		);
		assert(
			lines.some((line) => line.includes("> Beta")),
			"parent cursor is remembered",
		);
		assert(lines.some((line) => line.includes("- model: 1m 0s, 1k tokens")));
		assert(
			lines.every((line) => !line.endsWith("\r")),
			"normal UI emits no overlay CR hacks",
		);
		component.handleInput("escape");
	},
);

await drive(
	{
		title: "Portable labels",
		items: [
			{
				value: "roadmaps",
				label: "🌍 Roadmaps",
				description: "Browse work",
			},
			{
				value: "status",
				label: "✓ on ○ off ✔ done ● current",
				description: "Stable-width status marks",
			},
		],
		currentValue: "roadmaps",
	},
	(component) => {
		const output = plain(component.render(50).join("\n"));
		assert(output.includes("● Roadmaps"));
		assert(output.includes("✓ on ○ off ✔ done ● current"));
		assert(!output.includes("🌍"), "ambiguous-width icons are omitted");
		component.handleInput("escape");
	},
);

const checklist = await drive(
	{
		title: "Checks",
		items,
		multi: { selected: ["alpha"], requireOne: true },
	},
	(component) => {
		component.handleInput("down");
		component.handleInput("enter");
		assert(component.render(70).some((line) => line.includes("> ✓ Beta")));
		component.handleInput("escape");
	},
);
assert.deepEqual(new Set(checklist.values), new Set(["alpha", "beta"]));

const warnings = [];
let requiredValue;
await showListDialog(
	{
		mode: "tui",
		ui: {
			notify: (message) => warnings.push(message),
			custom: async (factory) => {
				let closed = false;
				const component = factory(
					{ requestRender() {} },
					theme,
					keybindings,
					(value) => {
						requiredValue = value;
						closed = true;
					},
				);
				component.handleInput("escape");
				assert.equal(closed, false, "required checklist refuses an empty result");
				component.handleInput("enter");
				component.handleInput("escape");
			},
		},
	},
	{ title: "Required", items, multi: { selected: [], requireOne: true } },
);
assert.deepEqual(requiredValue.values, ["alpha"]);
assert.deepEqual(warnings, ["Select at least one option"]);

const filtered = await drive(
	{
		title: "Models",
		items: [
			{ value: "openai/gpt", label: "GPT", description: "General model" },
			{
				value: "anthropic/claude",
				label: "Claude Sonnet",
				description: "Available while offline mode is disabled",
			},
		],
	},
	(component) => {
		for (const key of "offline") component.handleInput(key);
		let output = component.render(70).join("\n");
		assert(output.includes("Filter: offline"));
		assert(output.includes("Claude Sonnet"));
		assert(!output.includes("GPT"));
		component.handleInput("escape");
		output = component.render(70).join("\n");
		assert(output.includes("GPT"), "Escape clears a non-empty filter first");
		for (const key of "claude") component.handleInput(key);
		component.handleInput("enter");
	},
);
assert.equal(filtered.value, "anthropic/claude");

const directFilter = await drive(
	{
		title: "Workflow",
		items: [
			{
				value: "work-roadmap",
				label: "Roadmaps",
				description: "Browse, inspect, plan, or continue roadmaps.",
			},
			{ value: "work-plan", label: "Plan", description: "Create a roadmap." },
		],
	},
	(component) => {
		for (const key of "plan") component.handleInput(key);
		const output = component.render(70).join("\n");
		assert(output.includes("Plan"));
		assert(!output.includes("Roadmaps"));
		component.handleInput("enter");
	},
);
assert.equal(directFilter.value, "work-plan");

await drive(
	{
		title: "Details",
		items: [
			{
				value: "roadmap",
				label: "Roadmap",
				description:
					"First description line has useful context and continues with implementation constraints.",
			},
		],
		descriptionMinLines: 3,
		descriptionMaxLines: 3,
	},
	(component) => {
		const lines = component.render(36);
		assert(lines.some((line) => line.includes("-- Details")));
		assert(
			lines.every((line) => plain(line).length <= 34),
			"every normal menu line stays bounded",
		);
		assert(lines.join(" ").includes("implementation constraints."));
		component.handleInput("escape");
	},
);

let all = false;
const tabbed = await drive(
	{
		title: "Views",
		items: [{ value: "open", label: "Open" }],
		tabAction: {
			label: "Show all",
			toggle: () => {
				all = true;
				return {
					items: [{ value: "closed", label: "Closed" }],
					purpose: "Showing all items.",
				};
			},
		},
	},
	(component) => {
		component.handleInput("tab");
		assert(component.render(50).join("\n").includes("Showing all items."));
		component.handleInput("enter");
	},
);
assert.equal(all, true);
assert.equal(tabbed.value, "closed");

const special = await drive(
	{
		title: "Settings",
		items,
		onInput: ({ data, item, index }) =>
			data === "delete" ? { action: "clear", item, index } : undefined,
	},
	(component) => component.handleInput("delete"),
);
assert.equal(special.action, "clear");
assert.equal(special.item.value, "alpha");

let nativeLabels;
const native = await showListDialog(
	{
		mode: "rpc",
		ui: {
			select: async (_title, labels) => {
				nativeLabels = labels;
				return labels[0];
			},
		},
	},
	{
		title: "Native",
		items: [
			{ value: "roadmaps", label: "🌍 Roadmaps", description: "Browse work" },
		],
	},
);
assert.equal(native.value, "roadmaps");
assert(nativeLabels[0].includes("Roadmaps — Browse work"));
assert.doesNotMatch(nativeLabels[0], /\p{Extended_Pictographic}/u);

const initialFrame = {
	ok: true,
	signature: "one",
	selectedId: "roadmap-open",
	roadmaps: [
		{
			id: "roadmap-open",
			title: "Open roadmap",
			description: "Open roadmap description.",
			status: "open",
			role: "standalone_epic",
			progress: { completed: 0, total: 2 },
			tasks: [
				{
					id: "task-a",
					title: "Task A",
					description: "Task A details.",
					status: "open",
					children: [],
				},
			],
		},
		{
			id: "roadmap-closed",
			title: "Closed roadmap",
			status: "closed",
			progress: { completed: 1, total: 1 },
			tasks: [
				{
					id: "hidden-task",
					title: "Hidden task",
					status: "closed",
					children: [],
				},
			],
		},
	],
};
const refreshedFrame = {
	...initialFrame,
	signature: "two",
	roadmaps: [
		{
			...initialFrame.roadmaps[0],
			title: "Open roadmap refreshed",
		},
	],
};

async function driveTree(interact, overrides = {}) {
	let tick;
	let renders = 0;
	let cleanups = 0;
	let cleared = 0;
	let customOptions = "not-called";
	const result = await showTreeWorkspaceDialog(
		{
			mode: "tui",
			ui: {
				custom: async (factory, options) => {
					customOptions = options;
					let value;
					let closed = false;
					const component = factory(
						{ requestRender: () => (renders += 1) },
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
					});
					assert(closed, "tree interaction closes");
					return value;
				},
			},
		},
		{
			title: "Work roadmaps",
			purpose: "Inspect projected work without mutating it.",
			frame: initialFrame,
			refresh: async () => refreshedFrame,
			setIntervalFn(callback) {
				tick = callback;
				return 7;
			},
			clearIntervalFn(value) {
				assert.equal(value, 7);
				cleared += 1;
			},
			cleanup: () => (cleanups += 1),
			resolveStats: (id) => ["Stats:", `- selected ${id}`],
			...overrides,
		},
	);
	assert.equal(
		customOptions,
		undefined,
		"tree uses normal replacement UI, not an overlay",
	);
	return { result, renders, cleanups, cleared };
}

colorCalls.length = 0;
const tree = await driveTree(async (component, state) => {
	let lines = component.render(70);
	let output = lines.join("\n");
	const purposeLine = lines.findIndex((line) =>
		line.includes("Inspect projected work"),
	);
	assert.equal(purposeLine >= 0, true);
	assert(lines[purposeLine + 1].includes("Type to filter"));
	assert(!output.includes("-- Keys"));
	assert.match(lines.at(-1), /^─+$/u);
	assert(
		colorCalls.some(
			({ color, text }) => color === "text" && text.includes("task-a Task A"),
		),
		"open unselected work uses the normal foreground color",
	);
	assert(output.includes("Inspect projected work"));
	assert(output.includes("> [-] [open] 0/2 roadmap-open Open roadmap"));
	assert(output.includes("task-a Task A"));
	assert(output.includes("[+] [done] 1/1 roadmap-closed Closed roadmap"));
	assert(!output.includes("Hidden task"));
	assert.doesNotMatch(output, /[❯🌍]/u);

	for (const key of "hidden") component.handleInput(key);
	assert(component.render(70).join("\n").includes("Hidden task"));
	component.handleInput("escape");
	component.handleInput("s");
	assert(component.render(70).join("\n").includes("- selected roadmap-open"));
	component.handleInput(" ");
	assert(!component.render(70).join("\n").includes("task-a Task A"));
	component.handleInput("right");
	component.handleInput("down");
	assert.match(component.render(70).join("\n"), />\s+\[open\] task-a Task A/);
	await state.tick();
	output = component.render(70).join("\n");
	assert(output.includes("Open roadmap refreshed"));
	assert.match(
		output,
		/>\s+\[open\] task-a Task A/,
		"refresh keeps the selected ID",
	);
	component.handleInput("enter");
});
assert.equal(tree.result.value, "task-a");
assert.equal(tree.cleanups, 1);
assert.equal(tree.cleared, 1);
assert(tree.renders > 0);

const backedTree = await driveTree((component) =>
	component.handleInput("escape"),
);
assert.equal(backedTree.result.action, "back");
assert.equal(backedTree.cleanups, 1);

let nativeCleanup = 0;
let nativeTreeLabels;
const nativeTree = await showTreeWorkspaceDialog(
	{
		mode: "rpc",
		ui: {
			select: async (_title, labels) => {
				nativeTreeLabels = labels;
				return labels[0];
			},
		},
	},
	{
		title: "Native tree",
		frame: initialFrame,
		cleanup: () => (nativeCleanup += 1),
	},
);
assert.equal(nativeTree.value, "roadmap-open");
assert(
	nativeTreeLabels.some((label) => label.includes("roadmap-open Open roadmap")),
);
assert.equal(nativeCleanup, 1);

process.stdout.write("ok - shared work dialogs\n");
