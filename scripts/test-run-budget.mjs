#!/usr/bin/env node
import assert from "node:assert/strict";
import { createRunBudget } from "../extensions/run-budget.ts";

function fakePi() {
	const handlers = {}, entries = [], messages = [];
	return {
		handlers, entries, messages,
		on: (name, fn) => { handlers[name] = fn; },
		appendEntry: (customType, data) => entries.push({ type: "custom", customType, data }),
		sendMessage: (message) => messages.push(message),
	};
}
const ctx = (pi) => ({ cwd: ".", ui: { notify() {} }, sessionManager: { getBranch: () => pi.entries } });
const idle = { toolResults: [{ toolName: "read" }] };

// Reminder once at limit - 10, block at the limit, a human message resets; extension input does not.
let pi = fakePi();
let budget = createRunBudget(pi, { limit: () => 20 });
const c = ctx(pi);
for (let i = 0; i < 9; i++) await pi.handlers.turn_end(idle, c);
assert.equal(pi.messages.length, 0);
await pi.handlers.turn_end(idle, c);
assert.equal(pi.messages.length, 1);
assert.match(pi.messages[0].content, /10 of 20 turns left/);
pi.handlers.input({ source: "extension" });
for (let i = 0; i < 9; i++) await pi.handlers.turn_end(idle, c);
assert.equal(pi.messages.length, 1, "one reminder only");
assert.equal(pi.handlers.tool_call({}, c), undefined);
await pi.handlers.turn_end(idle, c);
assert.equal(budget.exhausted(c), true);
assert.match(pi.handlers.tool_call({}, c).reason, /Run budget reached: 20 turns/);

// Restore after reload keeps the count; a human message then resets it (and saves the reset).
const reloaded = createRunBudget(pi, { limit: () => 20 });
reloaded.restore(c);
assert.equal(reloaded.turns(), 20);
pi.handlers.input({ source: "interactive" });
assert.equal(reloaded.turns(), 0);
reloaded.restore(c);
assert.equal(reloaded.turns(), 0, "the reset is saved");

// A successful edit resets; a failed edit does not.
pi = fakePi();
budget = createRunBudget(pi, { limit: () => 20 });
for (let i = 0; i < 5; i++) await pi.handlers.turn_end(idle, ctx(pi));
await pi.handlers.turn_end({ toolResults: [{ toolName: "edit", isError: true }] }, ctx(pi));
assert.equal(budget.turns(), 6);
await pi.handlers.turn_end({ toolResults: [{ toolName: "edit" }] }, ctx(pi));
assert.equal(budget.turns(), 0);

// A working-tree change seen at a check turn resets (bash edits count as progress).
pi = fakePi();
let tree = "a";
budget = createRunBudget(pi, { limit: () => 20, fingerprint: async () => tree });
for (let i = 0; i < 9; i++) await pi.handlers.turn_end(idle, ctx(pi));
tree = "b";
await pi.handlers.turn_end(idle, ctx(pi));
assert.equal(budget.turns(), 0, "change found at the reminder check");
assert.equal(pi.messages.length, 0);

// Limit 0 turns the allowance off.
pi = fakePi();
budget = createRunBudget(pi, { limit: () => 0 });
for (let i = 0; i < 30; i++) await pi.handlers.turn_end(idle, ctx(pi));
assert.equal(budget.exhausted(ctx(pi)), false);
assert.equal(pi.handlers.tool_call({}, ctx(pi)), undefined);

console.log("run-budget: ok");
