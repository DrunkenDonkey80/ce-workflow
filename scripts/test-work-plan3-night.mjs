import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createNight, nightMessage, OFF_MESSAGE, stopCheckMessage } from "../extensions/plan3-night.ts";
import { isOn, setBoth, setMode } from "../extensions/plan3-needs.ts";

const cwd = await mkdtemp(path.join(os.tmpdir(), "plan3-night-"));
try {
	const file = path.join(cwd, "plan.md");
	await writeFile(file, "v1");
	let plan = { id: "p1", file, title: "Camera", status: "active", done: 1, total: 3, next: "S2", wip: [], human: [] };
	const commands = new Map(), hooks = new Map(), shortcuts = new Map(), sent = [], resumed = [], research = [], entries = [], notices = [];
	let idle = false;
	const pi = {
		registerCommand: (name, command) => commands.set(name, command),
		registerShortcut: (key, shortcut) => shortcuts.set(key, shortcut),
		on: (name, handler) => hooks.set(name, handler),
		appendEntry: (customType, data) => entries.push({ type: "custom", customType, data }),
		sendMessage: (message, options) => sent.push({ content: message.content, options }),
	};
	const night = createNight(pi, {
		listPlans: async () => [plan], currentPlan: (_ctx, plans) => plans[0],
		resume: async (_ctx, target, extra) => resumed.push({ id: target.id, extra }), research: (_ctx, enabled) => research.push(enabled),
	});
	const ctx = { cwd, hasUI: false, isIdle: () => idle, ui: { notify: (message, level) => notices.push({ message, level }) }, sessionManager: { getBranch: () => entries } };
	const settle = (outcome = "completed") => hooks.get("agent_before_settle")({ outcome }, ctx);
	assert(shortcuts.has("alt+n") && commands.has("night"));

	// Off: nothing is blocked or continued.
	assert.equal(hooks.get("tool_call")({ toolName: "ask_user", input: {} }), undefined);
	assert.equal(await settle(), undefined);

	// On while working: steer with global + project rules, research off, no resume.
	await mkdir(path.join(cwd, ".pi"));
	await writeFile(path.join(cwd, ".pi", "night.md"), "Never flash COM21.\n");
	await commands.get("night").handler("on", ctx);
	assert.deepEqual(research, [false]);
	assert.equal(resumed.length, 0);
	assert.equal(sent.at(-1).options.deliverAs, "steer");
	assert.match(sent.at(-1).content, /^NIGHT MODE: no human will answer[\s\S]*Project rules \(\.pi\/night\.md\):\nNever flash COM21\.$/);
	assert.deepEqual(entries.at(-1).data, { plan: "p1", rules: "Never flash COM21.", paused: undefined, complete: undefined });

	// Blocks questions and power commands only.
	assert.match(hooks.get("tool_call")({ toolName: "ask_user", input: {} }).reason, /Deferred question/);
	for (const command of ["shutdown /r /t 0", "Restart-Computer -Force", "adb reboot", "rundll32 powrprof.dll,SetSuspendState"])
		assert(hooks.get("tool_call")({ toolName: "bash", input: { command } })?.block, command);
	for (const command of ["cargo test reboot_handling", "grep -n shutdown_hook src/main.rs", "git commit -m x"])
		assert.equal(hooks.get("tool_call")({ toolName: "bash", input: { command } }), undefined, command);

	// Continue while something changes; two unchanged continues pause.
	await writeFile(file, "v2");
	let result = await settle();
	assert.equal(result.continue, true);
	assert.equal(result.entries[0].content, nightMessage("Never flash COM21."));
	assert.equal((await settle()).continue, true, "first unchanged continue");
	assert.equal(await settle(), undefined, "second unchanged continue pauses");
	assert.match(notices.at(-1).message, /paused: two continues changed nothing/);
	assert.equal(hooks.get("tool_call")({ toolName: "ask_user", input: {} }), undefined, "paused night mode no longer blocks questions");

	// Off then on while idle: resume carries the message; off while idle queues the off note for the next turn only when active.
	await commands.get("night").handler("off", ctx);
	assert.equal(entries.at(-1).data.off, true);
	idle = true;
	await commands.get("night").handler("", ctx);
	assert.equal(resumed.at(-1).id, "p1");
	assert.equal(resumed.at(-1).extra, `\n\n${nightMessage("Never flash COM21.")}`);
	await commands.get("night").handler("on", ctx);
	assert.equal(resumed.length, 1, "on when already on does nothing");

	// Errors schedule a later retry, not an immediate continue; abort pauses; completion and all-blocked stop.
	assert.equal(await settle("error"), undefined);
	night.shutdown();
	night.restore(ctx);
	assert.equal(await settle("aborted"), undefined);
	assert.match(notices.at(-1).message, /paused: cancelled/);
	await commands.get("night").handler("off", ctx);
	assert.equal(sent.at(-1).content, OFF_MESSAGE, "turning off a paused night still tells the agent the user is back");
	assert.equal(sent.at(-1).options.deliverAs, "nextTurn");
	await commands.get("night").handler("on", ctx);
	plan = { ...plan, next: undefined, wip: [], human: ["S3"] };
	assert.equal(await settle(), undefined, "[human] steps are not runnable at night");
	assert.match(notices.at(-1).message, /every remaining step is blocked or needs you/);
	plan = { ...plan, human: [] };
	await commands.get("night").handler("off", ctx);
	plan = { ...plan, done: 3, next: undefined };
	await commands.get("night").handler("on", ctx);
	assert.equal(await settle(), undefined);
	assert.match(notices.at(-1).message, /the plan is complete/);
	await commands.get("night").handler("off", ctx);
	idle = false;
	plan = { ...plan, done: 1, next: "S2" };
	await commands.get("night").handler("on", ctx);
	await commands.get("night").handler("off", ctx);
	assert.deepEqual(sent.at(-1), { content: OFF_MESSAGE, options: { deliverAs: "steer" } });
	assert.match(OFF_MESSAGE, /\[human\] steps are runnable again/);
	plan = { ...plan, done: 3, next: undefined };
	await commands.get("night").handler("on", ctx);
	await settle();
	const beforeComplete = sent.length;
	await commands.get("night").handler("off", ctx);
	assert.equal(sent.length, beforeComplete, "a completed night sends no off note");
	plan = { ...plan, done: 1, next: "S2" };

	// Draft plans are refused; empty rules send only the global message.
	await rm(path.join(cwd, ".pi", "night.md"));
	plan = { ...plan, status: "draft" };
	await commands.get("night").handler("on", ctx);
	assert.match(notices.at(-1).message, /finish planning first/);
	plan = { ...plan, status: "active" };
	await commands.get("night").handler("on", ctx);
	assert.equal(sent.at(-1).content, nightMessage(""));
	assert.doesNotMatch(sent.at(-1).content, /Project rules/);
	await commands.get("night").handler("off", ctx);
	assert.equal(await readFile(file, "utf8"), "v2");

	// Stop guard outside night mode: only in a /resume3 run that did work and left runnable steps.
	const guardHooks = new Map();
	let executing = "p1";
	createNight({ registerCommand() {}, on: (name, handler) => guardHooks.set(name, handler) }, {
		listPlans: async () => [plan], currentPlan: (_ctx, plans) => plans[0], resume: async () => {}, research() {}, executingPlan: () => executing,
	});
	const stopAt = (outcome = "completed", extra = {}) => guardHooks.get("agent_before_settle")({ outcome, continue: false, ...extra }, ctx);
	await guardHooks.get("agent_start")({}, ctx);
	assert.equal(await stopAt(), undefined, "chat answer without changes settles");
	await writeFile(file, "v3");
	result = await stopAt();
	assert.equal(result.continue, true, "stop after work is questioned");
	assert.equal(result.entries[0].content, stopCheckMessage(plan));
	assert.match(result.entries[0].content, /next: S2\)/);
	assert.equal(await stopAt(), undefined, "the reason reply (no new work) settles");
	await writeFile(file, "v4");
	assert.equal(await stopAt("aborted"), undefined, "Escape is never questioned");
	assert.equal(await stopAt("completed", { continue: true }), undefined, "another continuation already pending");
	plan = { ...plan, next: undefined, wip: [], human: ["S55"] };
	await writeFile(file, "v4b");
	result = await stopAt();
	assert.equal(result.continue, true, "the user is present: [human] steps are runnable outside night mode");
	assert.match(result.entries[0].content, /\[human\] steps \(S55\)[\s\S]*ask_user whether to do S55 now/);
	plan = { ...plan, human: [] };
	await writeFile(file, "v4c");
	assert.equal(await stopAt(), undefined, "nothing runnable");
	plan = { ...plan, next: "S2" };
	executing = undefined;
	await guardHooks.get("agent_start")({}, ctx);
	await writeFile(file, "v5");
	assert.equal(await stopAt(), undefined, "not in /resume3");
	// Requirements: night on/off switch the plan's set and carry the line; the two sets are remembered separately.
	const needHooks = new Map(), needCommands = new Map(), needSent = [], switched = [];
	createNight({ registerCommand: (name, command) => needCommands.set(name, command), on: (name, handler) => needHooks.set(name, handler), sendMessage: (message, options) => needSent.push({ content: message.content, options }) }, {
		listPlans: async () => [plan], currentPlan: (_ctx, plans) => plans[0], resume: async () => {}, research() {},
		switchNeeds: async (_ctx, target, mode) => { switched.push([target.id, mode]); return `Available now (${mode}): R-vm; off: human.`; },
	});
	idle = false;
	await needCommands.get("night").handler("on", ctx);
	assert.match(needSent.at(-1).content, /Requirements: Available now \(night\): R-vm; off: human\.$/);
	await needCommands.get("night").handler("off", ctx);
	assert.deepEqual(switched, [["p1", "night"], ["p1", "day"]]);
	assert.equal(needSent.at(-1).content, `${OFF_MESSAGE}\nRequirements: Available now (day): R-vm; off: human.`);
	let avail = setBoth({}, "R-reboot", true);
	assert.equal(isOn(avail, "human"), true);
	avail = setMode(avail, "night");
	assert.deepEqual([isOn(avail, "human"), isOn(avail, "R-reboot")], [false, true]);
	avail = { ...avail, night: { ...avail.night, "R-reboot": false } }; // the user unchecks reboot for the night
	avail = setMode(setMode(avail, "day"), "night");
	assert.equal(isOn(avail, "R-reboot"), false, "the night set is remembered");
	assert.equal(isOn(setMode(avail, "day"), "R-reboot"), true, "the day set is untouched");
	assert.equal(isOn(setMode(avail, "day"), "R-unset"), false, "unset requirements are off");
	console.log("ok - plan3 night mode");
} finally {
	await rm(cwd, { recursive: true, force: true });
}
