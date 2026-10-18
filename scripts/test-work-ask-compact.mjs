#!/usr/bin/env node
import assert from "node:assert/strict";
import { askConfirm, bindListDialogBridge, resetDialogStateForTest, showListDialog } from "../extensions/ask-user/menu.ts";

const theme = { fg: (_color, text) => text, bold: text => text };
const keybindings = { matches: (data, id) => ({ "tui.select.up": "up", "tui.select.down": "down", "tui.select.confirm": "enter", "tui.select.cancel": "escape" })[id] === data };
// Runs the terminal view: `keys` are fed in order; returns the rendered lines at `width` and the result.
async function terminal(run, keys, width = 120) {
	let lines;
	const ctx = { mode: "tui", ui: {
		notify() {},
		custom: factory => new Promise(resolve => {
			const component = factory({ requestRender() {} }, theme, keybindings, resolve);
			lines = component.render(width);
			for (const key of keys) component.handleInput(key);
		}),
	} };
	return { result: await run(ctx), lines };
}

resetDialogStateForTest();
let run = await terminal(ctx => askConfirm(ctx, "Forget knowledge?", "k-1: old claim"), ["enter"]);
assert.deepEqual(run.lines.length, 1, "fits on one line");
assert.match(run.lines[0], /^Forget knowledge\? k-1: old claim {2}\[ Yes \] {3}No {2}/);
assert.equal(run.result, true);
assert.equal((await terminal(ctx => askConfirm(ctx, "Forget?"), ["right", "enter"].map(k => k === "right" ? "\x1b[C" : k))).result, false, "right arrow moves to No");
assert.equal((await terminal(ctx => askConfirm(ctx, "Forget?"), ["n"])).result, false, "letter picks a unique action");
assert.equal((await terminal(ctx => askConfirm(ctx, "Forget?"), ["escape"])).result, false, "Esc is No");
assert.equal((await terminal(ctx => askConfirm(ctx, "Forget?", "", { signal: AbortSignal.abort() }), [])).result, false, "aborted is No");

// Long text wraps above the actions instead of being cut.
run = await terminal(ctx => askConfirm(ctx, "Enable?", "word ".repeat(30).trim()), ["enter"], 40);
assert(run.lines.length > 2);
assert(run.lines.join(" ").includes("word word"));
assert.match(run.lines.at(-1), /\[ Yes \]/);

// Disabled actions refuse; cursor memory starts on the last choice.
run = await terminal(ctx => showListDialog(ctx, { title: "Park?", compact: true, cursorKey: "park", items: [{ value: "a", label: "Park" }, { value: "b", label: "Busy", disabled: true }, { value: "c", label: "Cancel" }] }), ["down", "enter", "down", "enter"]);
assert.equal(run.result.value, "c");
run = await terminal(ctx => showListDialog(ctx, { title: "Park?", compact: true, cursorKey: "park", items: [{ value: "a", label: "Park" }, { value: "c", label: "Cancel" }] }), ["enter"]);
assert.equal(run.result.value, "c", "remembers the last choice");

// Without a TUI it falls back to a plain select.
assert.equal(await askConfirm({ mode: "rpc", ui: { select: async (_title, labels) => labels.find(label => label.includes("Yes")) } }, "Ok?"), true);

// The web bridge receives a compact list subject.
const ui = { custom: () => new Promise(() => {}) };
let subject;
bindListDialogBridge({ ui }, async options => { subject = options; return { action: "select", value: "no" }; });
assert.equal(await askConfirm({ mode: "tui", ui }, "Ship?", "now"), false);
assert.equal(subject.compact, true);
assert.equal(subject.purpose, "now");
bindListDialogBridge({ ui }, undefined);
console.log("ok - compact ask view");
