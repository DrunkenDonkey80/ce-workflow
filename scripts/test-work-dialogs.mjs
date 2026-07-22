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

async function drive(options, interact) {
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
await drive({ title: "Root", items, cursorKey: "root" }, (component) => {
	const lines = component.render(70);
	assert(
		lines.some((line) => line.includes("Choose an option to continue.")),
		"every dialog shows its purpose below the title",
	);
	assert(
		lines.some((line) => line.includes(">   Beta")),
		"returning from a submenu restores its parent cursor",
	);
	component.handleInput("escape");
});

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
			component.render(70).some((line) => line.includes(">   ✓ on Beta")),
			"Enter toggles without moving the selected line",
		);
		component.handleInput(" ");
		assert(
			component.render(70).some((line) => line.includes(">   ○ off Beta")),
			"Space toggles without moving the selected line",
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

colors.length = 0;
await drive(
	{
		title: "Roadmaps",
		purpose: "Choose a roadmap to inspect, plan, or continue.",
		items: [
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
				label: "└─ Done [closed]",
				description: "Finished work",
				descriptionPrefix: "│  ",
				inlineDescription: true,
				color: "dim",
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
		assert(lines.some((line) => line.includes("└─ Done [closed]")));
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

process.stdout.write("ok - shared work dialogs\n");
