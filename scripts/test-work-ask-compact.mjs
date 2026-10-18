#!/usr/bin/env node
import assert from "node:assert/strict";
import { askConfirm, resetDialogStateForTest, showListDialog } from "../extensions/ask-user/menu.ts";

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

// Under pi-control-hub (H3-03): menus go through the channel as the `list` payload; Esc-back and answers come back the same way.
{
	process.env.PI_HUB = "1";
	const sent = [];
	const parse = text => { try { return JSON.parse(text); } catch { assert.fail(`channel sent non-JSON: ${text}`); } };
	const hubCtx = answer => ({ mode: "rpc", ui: {
		select: () => assert.fail("no flattened select under the hub"), custom: () => assert.fail("no terminal view"), setStatus() {},
		input: async (title, placeholder) => { sent.push({ title, ...parse(placeholder) }); return answer === undefined ? undefined : JSON.stringify(answer); },
	} });
	const menu = { title: "Night mode", purpose: "Work unattended", currentValue: "on", items: [{ value: "on", label: "Turn on", description: "plan x" }, { value: "edit", label: "Add rules" }] };
	let result = await showListDialog(hubCtx({ action: "select", value: "edit" }), menu);
	assert.equal(result.value, "edit");
	assert.equal(sent[0].title, "pi-hub:ask");
	assert.deepEqual(sent[0].data, { kind: "list", title: "Night mode", purpose: "Work unattended", currentValue: "on", spaceAction: false, rowAction: false, tabAction: false,
		items: [{ value: "on", label: "Turn on", description: "plan x" }, { value: "edit", label: "Add rules" }] });
	assert.equal(await showListDialog(hubCtx({ action: "back" }), menu), undefined, "Esc-back");
	assert.equal(await showListDialog(hubCtx(undefined), menu), undefined, "cancel");
	assert.equal(await showListDialog(hubCtx({ action: "select", value: "nope" }), menu), undefined, "unknown value refused");
	result = await showListDialog(hubCtx({ action: "back", values: ["b"] }), { title: "Pick", multi: { selected: ["a"] }, items: [{ value: "a", label: "A" }, { value: "b", label: "B" }] });
	assert.deepEqual(result, { action: "back", values: ["b"] }, "checklist answer");
	assert.equal(await askConfirm(hubCtx({ action: "select", value: "yes" }), "Ship?"), true);
	assert.equal(sent.at(-1).data.compact, true);
	const before = sent.length;
	assert.equal(await showListDialog(hubCtx({ action: "select", value: "on" }), { ...menu, terminalOnly: true }), undefined, "terminal-only approvals are refused under the hub");
	assert.equal(sent.length, before, "and never reach the hub");
	delete process.env.PI_HUB;
}
console.log("ok - compact ask view");
