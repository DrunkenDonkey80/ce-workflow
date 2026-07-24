#!/usr/bin/env node
import assert from "node:assert/strict";
import {
	resetDialogStateForTest,
	showListDialog,
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
	const width = terminalWidth(value);
	if (value.includes("🧭") || value.includes("🧱") || value.includes("🌍"))
		return width + 1;
	return width;
}

async function drive(options, interact, activeTheme = theme) {
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
						{ requestRender() {} },
						activeTheme,
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
	assert.equal(overlay.overlay, true, "menus use an overlay dialog");
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
			lines.some((line) => line.includes(">  Beta")),
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
		assert(lines.some((line) => line.includes("> *Alpha")));
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
			component.render(70).some((line) => line.includes("> ✓Beta")),
			"selection and checked indicators use separate columns",
		);
		component.handleInput(" ");
		assert(
			component.render(70).some((line) => line.includes("> ○Beta")),
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
			detailedLines.some((line) => line.includes("First description line has")),
		);
		assert(
			detailedLines.some((line) =>
				line.includes("useful context and continues"),
			),
		);
		assert(
			detailedLines.some((line) => line.includes("implementation constraint")),
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

const tabbed = await drive(
	{
		title: "Views",
		items,
		tabAction: { label: "Show all" },
	},
	(component) => component.handleInput("tab"),
);
assert.equal(tabbed.action, "tab");

process.stdout.write("ok - shared work dialogs\n");
