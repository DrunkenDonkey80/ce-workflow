#!/usr/bin/env node
import assert from "node:assert/strict";
import { resetDialogStateForTest, showListDialog } from "../extensions/ask-user/menu.ts";

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

const disabledWarnings = [];
let disabledResult;
await showListDialog(
	{
		mode: "tui",
		ui: {
			notify: (message) => disabledWarnings.push(message),
			custom: async (factory) => {
				const component = factory(
					{ requestRender() {} },
					theme,
					keybindings,
					(value) => (disabledResult = value),
				);
				component.handleInput("enter");
				assert.equal(disabledResult, undefined, "disabled TUI row stays open");
				component.handleInput("down");
				component.handleInput("enter");
			},
		},
	},
	{
		title: "Disabled",
		items: [
			{
				value: "approve",
				label: "Approve",
				disabled: true,
				disabledReason: "Sync the handoff first.",
			},
			{ value: "cancel", label: "Cancel" },
		],
	},
);
assert.equal(disabledResult.value, "cancel");
assert.deepEqual(disabledWarnings, ["Sync the handoff first."]);

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

const nativeDisabledWarnings = [];
let nativeDisabledSelections = 0;
const nativeEnabled = await showListDialog(
	{
		mode: "rpc",
		ui: {
			notify: (message) => nativeDisabledWarnings.push(message),
			select: async (_title, labels) => labels[nativeDisabledSelections++],
		},
	},
	{
		title: "Native disabled",
		items: [
			{
				value: "approve",
				label: "Approve",
				disabled: true,
				disabledReason: "Sync the handoff first.",
			},
			{ value: "cancel", label: "Cancel" },
		],
	},
);
assert.equal(nativeEnabled.value, "cancel");
assert.deepEqual(nativeDisabledWarnings, ["Sync the handoff first."]);


process.stdout.write("ok - shared work dialogs\n");
