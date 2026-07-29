#!/usr/bin/env node
import assert from "node:assert/strict";
import {
	createSubscriptionFooterController,
	renderModelRow,
	stripAnsi,
	truncatePlain,
	visibleWidth,
} from "../extensions/subscription-footer.js";

const theme = {
	fg: (color, text) => `\x1b[${color === "success" ? 32 : color === "warning" ? 33 : 31}m${text}\x1b[0m`,
};
const ctx = (tokens, width = 272000) => ({
	mode: "tui",
	hasUI: true,
	model: { id: "模型-very-long-🚀-model-name", contextWindow: width },
	thinkingLevel: "high",
	getContextUsage: () => ({ tokens, contextWindow: width }),
});

for (const [tokens, color] of [
	[150000, "32"],
	[150001, "33"],
	[200000, "33"],
	[200001, "31"],
]) {
	const line = renderModelRow(ctx(tokens), theme, 80)[0];
	assert.match(line, new RegExp(`\\x1b\\[${color}m`), `${tokens} pressure color`);
	assert.ok(visibleWidth(line) <= 80, `${tokens} row fits`);
}

const full = renderModelRow(ctx(175000), theme, 80)[0];
assert.match(stripAnsi(full), /^Model: /);
assert.match(stripAnsi(full), /Effort: high/);
assert.match(stripAnsi(full), /Context \[[█░]{12}\]/);
assert.match(stripAnsi(full), /64% 175k\/272k · F8 Compact$/);
assert.doesNotMatch(stripAnsi(full), /cwd|git/i);

const compact = renderModelRow(ctx(175000), theme, 56)[0];
assert.match(stripAnsi(compact), /high/);
assert.match(stripAnsi(compact), /\[[█░]{4,}\] 64% 175k\/272k · F8 Compact$/);
assert.ok(visibleWidth(compact) <= 56, "56-column row fits");
assert.match(stripAnsi(compact), /…/, "only the long model label truncates");

const narrow = renderModelRow(ctx(175000), theme, 55)[0];
assert.equal(stripAnsi(narrow), "Subscription footer needs at least 56 columns");
assert.ok(visibleWidth(narrow) <= 55, "55-column diagnostic fits");
for (const line of [full, compact, narrow]) {
	assert.equal((line.match(/\x1b\[/g) ?? []).length % 2, 0, "ANSI sequences stay paired");
}
assert.ok(visibleWidth("模型🚀") === 6, "wide Unicode cells measured deterministically");
assert.equal(truncatePlain("模型🚀long", 5), "模型…", "plain graphemes truncate before styling");

let settings = { workOrchestrator: { subscriptionFooter: { enabled: false } } };
let footerFactories = [];
let notices = [];
let requests = 0;
const providers = [{ id: "fake", fetchQuota: () => requests++ }];
const controller = createSubscriptionFooterController(
	{ getThinkingLevel: () => "high" },
	{ readGlobalSettings: () => settings, providers },
);
const tuiCtx = {
	...ctx(175000),
	ui: {
		setFooter: (factory) => footerFactories.push(factory),
		notify: (message) => notices.push(message),
	},
};
assert.equal(controller.start(tuiCtx), false, "default-off startup installs nothing");
assert.equal(footerFactories.length, 0);
settings = { workOrchestrator: { subscriptionFooter: { enabled: true } } };
for (const mode of ["print", "json", "rpc"]) {
	controller.start({ ...tuiCtx, mode });
}
assert.equal(footerFactories.length, 0, "headless and RPC startup install nothing");
assert.equal(requests, 0, "U1 makes no provider requests");
assert.equal(controller.providers[0], providers[0], "fake provider registry seam is retained");

assert.equal(controller.start(tuiCtx), true, "enabled TUI installs footer");
assert.equal(typeof footerFactories.at(-1), "function");
const component = footerFactories.at(-1)({ requestRender() {} }, theme);
assert.equal(component.render(80).length, 1, "installed component renders model row");
settings.workOrchestrator.subscriptionFooter.enabled = false;
controller.apply(tuiCtx);
assert.equal(footerFactories.at(-1), undefined, "disable restores built-in footer");
assert.match(notices.at(-1), /\/reload/);
assert.equal(requests, 0, "enable, render, and disable make no requests in U1");

settings.workOrchestrator.subscriptionFooter.enabled = true;
controller.start(tuiCtx);
const replacement = footerFactories.at(-1)({ requestRender() {} }, theme);
const staleCtx = { ...tuiCtx, ui: { setFooter() {}, notify() {} } };
const factoryCount = footerFactories.length;
assert.equal(controller.apply(staleCtx), false, "stale apply is ignored");
controller.shutdown(staleCtx);
assert.equal(footerFactories.length, factoryCount, "stale context cannot replace the footer");
assert.equal(controller.isInstalled(), true, "stale shutdown preserves active ownership");
replacement.dispose();
assert.equal(controller.isInstalled(), false, "owner component disposal ends ownership");
controller.start(tuiCtx);
controller.shutdown(tuiCtx);
assert.equal(footerFactories.at(-1), undefined, "shutdown restores built-in footer");

process.stdout.write("ok - work-subscription-footer shell, width, and lifecycle\n");
