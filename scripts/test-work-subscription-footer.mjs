#!/usr/bin/env node
import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	PRODUCTION_PROVIDERS,
	createSubscriptionFooterController,
	renderModelRow,
	renderQuotaRows,
	renderWorkflowRow,
	stripAnsi,
	truncatePlain,
	visibleWidth,
} from "../extensions/subscription-footer.js";

const theme = {
	fg: (color, text) => `\x1b[${color === "success" ? 32 : color === "warning" ? 33 : color === "error" ? 31 : color === "accent" ? 36 : 2}m${text}\x1b[0m`,
	bold: (text) => `\x1b[1m${text}\x1b[0m`,
};
const context = (tokens, window = 272000) => ({
	mode: "tui", hasUI: true,
	model: { id: "模型-very-long-🚀-model-name", contextWindow: window },
	thinkingLevel: "high",
	getContextUsage: () => ({ tokens, contextWindow: window }),
});
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const jsonResponse = (payload, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => payload });
const stored = (key, headers) => ({ source: "stored credential", auth: { apiKey: key, headers } });

class Clock {
	constructor(value = 1_800_000_000_000) { this.value = value; this.next = 1; this.timers = new Map(); }
	now = () => this.value;
	setTimeout = (fn, delay) => { const id = this.next++; this.timers.set(id, { at: this.value + delay, fn, interval: 0 }); return id; };
	clearTimeout = (id) => this.timers.delete(id);
	setInterval = (fn, delay) => { const id = this.next++; this.timers.set(id, { at: this.value + delay, fn, interval: delay }); return id; };
	clearInterval = (id) => this.timers.delete(id);
	async advance(ms) {
		const target = this.value + ms;
		while (true) {
			const due = [...this.timers.entries()].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
			if (!due) break;
			const [id, timer] = due;
			this.value = timer.at;
			if (timer.interval) timer.at += timer.interval; else this.timers.delete(id);
			timer.fn();
			await flush();
		}
		this.value = target;
		await flush();
	}
}

function harness({ providers, auth, fetchImpl, clock = new Clock(), fsImpl, enabled = true, incidents = false, settings, workflowStatus, agentDir = "/agent" }) {
	const factories = [];
	const notices = [];
	let renders = 0;
	const ctx = {
		...context(175000),
		modelRegistry: { getProviderAuth: async (id) => auth(id) },
		ui: {
			setFooter: (factory) => factories.push(factory),
			notify: (message) => notices.push(message),
		},
	};
	const controller = createSubscriptionFooterController(
		{ getThinkingLevel: () => "high" },
		{
			readGlobalSettings: () => ({ workOrchestrator: { subscriptionFooter: settings?.() ?? { enabled, incidents } } }),
			providers, fetchImpl, now: clock.now, getWorkflowStatus: workflowStatus,
			setTimeoutImpl: clock.setTimeout, clearTimeoutImpl: clock.clearTimeout,
			setIntervalImpl: clock.setInterval, clearIntervalImpl: clock.clearInterval,
			...(agentDir === null ? {} : { agentDir }), fsImpl: fsImpl ?? {
				readFile: async () => { throw Object.assign(new Error("missing"), { code: "ENOENT" }); },
				mkdir: async () => {}, writeFile: async () => {}, rename: async () => {},
			},
		},
	);
	return {
		controller, ctx, factories, notices, clock,
		component() { return factories.at(-1)({ requestRender: () => renders++ }, theme); },
		renders: () => renders,
	};
}

// U1 remains intact: model thresholds, width floor, and terminal-safe text.
for (const [tokens, color] of [[150000, "32"], [150001, "33"], [200000, "33"], [200001, "31"]]) {
	const line = renderModelRow(context(tokens), theme, 80)[0];
	assert.match(line, new RegExp(`\\x1b\\[${color}m`), `${tokens} pressure color`);
	assert.ok(visibleWidth(line) <= 80, `${tokens} row fits`);
}
const full = renderModelRow(context(175000), theme, 80)[0];
assert.match(stripAnsi(full), /^Model: /);
assert.match(stripAnsi(full), /Effort: high/);
assert.match(stripAnsi(full), /Context \[[█░]{12}\]/);
assert.match(stripAnsi(full), /64% 175k\/272k · F8 Compact$/);
assert.doesNotMatch(stripAnsi(full), /cwd|git/i);
const compact = renderModelRow(context(175000), theme, 56)[0];
assert.match(stripAnsi(compact), /\[[█░]{4,}\] 64% 175k\/272k · F8 Compact$/);
assert.match(stripAnsi(compact), /…/);
const narrow = renderModelRow(context(175000), theme, 55)[0];
assert.equal(stripAnsi(narrow), "Subscription footer needs at least 56 columns");
for (const [line, width] of [[full, 80], [compact, 56], [narrow, 55]]) {
	assert.ok(visibleWidth(line) <= width);
	assert.equal((line.match(/\x1b\[/g) ?? []).length % 2, 0);
}
assert.equal(visibleWidth("模型🚀"), 6);
assert.equal(truncatePlain("模型🚀long", 5), "模型…");
assert.equal(stripAnsi(renderWorkflowRow("working #7", theme, 18)[0]), "Workflow: working…", "workflow row is width-safe");

// Default/headless/off behavior makes no requests and installs no footer.
let headlessFetches = 0;
const off = harness({ providers: PRODUCTION_PROVIDERS, auth: () => stored("x"), fetchImpl: async () => { headlessFetches++; } , enabled: false });
assert.equal(off.controller.start(off.ctx), false);
for (const mode of ["print", "json", "rpc"]) off.controller.start({ ...off.ctx, mode });
assert.equal(off.factories.length, 0);
assert.equal(headlessFetches, 0);

// Production capability registry is fixed and each pinned payload maps to common windows.
assert.deepEqual(PRODUCTION_PROVIDERS.map((provider) => [provider.label, provider.piProviderId]), [
	["Codex", "openai-codex"], ["Claude", "anthropic"], ["Copilot", "github-copilot"], ["GLM/Z.ai", "zai"], ["Kimi", "kimi-coding"],
]);
const now = () => 1_800_000_000_000;
const reset = now() + 3_600_000;
const payloads = {
	"chatgpt.com": { rate_limit: { primary_window: { used_percent: 70, limit_window_seconds: 604800, reset_at: reset / 1000 }, secondary_window: { used_percent: 20, limit_window_seconds: 18000, reset_after_seconds: 3600 } } },
	"anthropic.com": { limits: [{ kind: "weekly_all", percent: 55, resets_at: new Date(reset).toISOString() }, { kind: "session", percent: 15, resets_at: new Date(reset).toISOString() }, { kind: "weekly_model", percent: 30, resets_at: new Date(reset).toISOString(), scope: { model: { display_name: "Opus" } } }] },
	"github.com": { quota_reset_date: "2027-01-01", quota_snapshots: { premium_interactions: { percent_remaining: 72, unlimited: false } } },
	"z.ai": { data: { limits: [{ type: "TOKENS", unit: 3, number: 5, percentage: 25, nextResetTime: reset }, { type: "TOKENS", unit: 6, number: 1, percentage: 45, nextResetTime: reset }, { type: "TIME_LIMIT", percentage: 65, nextResetTime: reset }] } },
	"kimi.com": { data: { usage: { used: "2", limit: "10", reset_in: 3600 }, limits: [{ detail: { remaining: 6, limit: 10, resetAt: reset }, window: { duration: 5, timeUnit: "HOUR" } }] } },
};
for (const provider of PRODUCTION_PROVIDERS) {
	const host = Object.keys(payloads).find((part) => provider.id === "codex" ? part === "chatgpt.com" : provider.id === "claude" ? part === "anthropic.com" : provider.id === "copilot" ? part === "github.com" : provider.id === "glm" ? part === "z.ai" : part === "kimi.com");
	let requested;
	let requestOptions;
	const windows = await provider.fetchQuota(stored("fixture-token"), {
		fetchImpl: async (url, options) => { requested = url; requestOptions = options; return jsonResponse(payloads[host]); }, signal: new AbortController().signal, now,
	});
	assert.ok(requested.startsWith("https://"));
	assert.ok(windows.length >= 1 && windows.every((window) => Number.isFinite(window.usedPercent)));
	if (provider.id === "codex") assert.deepEqual(windows.map((window) => window.label), ["5h", "7d"], "Codex duration order");
	if (provider.id === "claude") assert.deepEqual(windows.map((window) => window.label), ["5h", "7d", "Opus"], "Claude model windows");
	if (provider.id === "copilot") assert.equal(windows[0].usedPercent, 28, "Copilot remaining converts to used");
	if (provider.id === "glm") {
		assert.equal(provider.piProviderId, "zai");
		assert.equal(requested, "https://api.z.ai/api/monitor/usage/quota/limit");
		assert.equal(requestOptions.headers.authorization, "fixture-token", "GLM uses the raw authorization token");
		assert.deepEqual(windows.map((window) => window.label), ["5h", "7d"], "GLM token units map and monthly tools stay excluded");
	}
	if (provider.id === "kimi") assert.deepEqual(windows.map((window) => window.label), ["5h", "7d"], "Kimi variants map");
}

const glm = PRODUCTION_PROVIDERS.find((provider) => provider.id === "glm");
const glmFetch = (payload) => glm.fetchQuota(stored("glm-token"), {
	fetchImpl: async () => jsonResponse(payload), signal: new AbortController().signal, now,
});
const mixedGlm = await glmFetch({ success: true, data: { limits: [
	{ type: "TIME_LIMIT", percentage: 60, nextResetTime: reset },
	null,
	{ type: "TOKENS", unit: 6, number: 1, percentage: 40, nextResetTime: reset },
	{ type: "TOKENS", unit: "3", number: "5", percentage: "20", nextResetTime: String(reset) },
	{ type: "TOKENS", unit: 3, number: 5, percentage: null, nextResetTime: reset },
	{ type: "TOKENS", unit: 99, number: 1, percentage: 80, nextResetTime: reset },
] } });
assert.deepEqual(mixedGlm.map((window) => window.label), ["5h", "7d"], "GLM accepts numeric strings, skips unusable/monthly rows, and preserves stable token-window order");
const renderedGlm = stripAnsi(renderQuotaRows([{ id: "glm", label: "GLM/Z.ai" }], new Map([
	["glm", { authenticated: true, lastSuccessAt: now(), snapshot: { windows: mixedGlm } }],
]), theme, 200, now()).join("\n"));
assert.match(renderedGlm, /^GLM\/Z\.ai 5h\(/, "string-valued GLM session window renders first");
const resetlessGlm = await glmFetch({ success: true, data: { limits: [
	{ type: "TOKENS_LIMIT", unit: "3", number: "5", percentage: "17" },
	{ type: "TOKENS", unit: "6", number: "1", percentage: "42", nextResetTime: String(reset) },
	{ type: "TIME_LIMIT", percentage: "63", nextResetTime: String(reset) },
] } });
assert.deepEqual(resetlessGlm.map((window) => window.label), ["5h", "7d"]);
assert.equal(resetlessGlm[0].resetsAt, undefined, "explicit 5h session survives without a countdown");
assert.match(stripAnsi(renderQuotaRows([{ id: "glm", label: "GLM/Z.ai" }], new Map([
	["glm", { authenticated: true, lastSuccessAt: now(), snapshot: { windows: resetlessGlm } }],
]), theme, 200, now()).join("\n")), /^GLM\/Z\.ai 5h \[[█░]+\] 17% · 7d\(/, "resetless 5h renders first without countdown");
const weeklyMonthlyGlm = await glmFetch({ success: true, data: { limits: [
	{ type: "TOKENS", unit: 6, number: 1, percentage: 42, nextResetTime: reset },
	{ type: "TIME_LIMIT", percentage: 63, nextResetTime: reset },
	{ type: "PLAN_METADATA", unit: 3, number: 5, percentage: 9, nextResetTime: reset },
] } });
assert.deepEqual(weeklyMonthlyGlm.map((window) => window.label), ["7d"], "weekly/monthly rows do not publish tools or fabricate a 5h window from unknown types");
await assert.rejects(() => glmFetch({ success: true, data: { limits: [
	{ type: "UNKNOWN", unit: 3, number: 5, percentage: 20 },
] } }), (error) => error.message === "unavailable", "unknown type is not promoted to a resetless session");
await assert.rejects(() => glmFetch({ success: true, data: { limits: [
	null,
	{ type: "TOKENS", unit: "", number: "5", percentage: "20", nextResetTime: String(reset) },
	{ type: "TOKENS", unit: "3", number: "Infinity", percentage: "20", nextResetTime: String(reset) },
	{ type: "TOKENS", unit: "3", number: "5", percentage: "", nextResetTime: String(reset) },
] } }), (error) => error.message === "unavailable");
await assert.rejects(() => glmFetch({ success: false, message: "SENTINEL-PRIVATE-VENDOR-BODY", data: { limits: payloads["z.ai"].data.limits } }),
	(error) => error.message === "unavailable" && !error.message.includes("SENTINEL"), "HTTP-200 GLM failure envelope is sanitized");

// Pi stored-auth only; three credentials render in registry order and every window survives.
const requestedIds = [];
const subset = harness({
	providers: PRODUCTION_PROVIDERS,
	auth: (id) => ["openai-codex", "anthropic", "zai"].includes(id) ? stored(`${id}-token`) : undefined,
	fetchImpl: async (url) => {
		requestedIds.push(url);
		const host = Object.keys(payloads).find((part) => url.includes(part));
		return jsonResponse(payloads[host]);
	},
});
assert.equal(subset.controller.start(subset.ctx), true);
const subsetComponent = subset.component();
await flush();
const subsetLines = subsetComponent.render(80).map(stripAnsi).join("\n");
assert.ok(subsetLines.indexOf("Codex") < subsetLines.indexOf("Claude") && subsetLines.indexOf("Claude") < subsetLines.indexOf("GLM/Z.ai"));
assert.doesNotMatch(subsetLines, /Copilot|Kimi/);
assert.equal(requestedIds.length, 3);
subset.controller.shutdown(subset.ctx);

const ambient = harness({ providers: [PRODUCTION_PROVIDERS[0]], auth: () => ({ source: "OPENAI_API_KEY", auth: { apiKey: "ambient" } }), fetchImpl: async () => { throw new Error("must not fetch"); } });
ambient.controller.start(ambient.ctx);
const ambientComponent = ambient.component();
await flush();
assert.equal(ambientComponent.render(80).length, 1, "ambient auth remains hidden");
ambient.controller.shutdown(ambient.ctx);

// Renderer thresholds, wrapping, continuation labels, all windows, and sixth-provider extensibility.
const renderStates = new Map();
const renderProviders = [...PRODUCTION_PROVIDERS, { id: "sixth", label: "Sixth" }];
for (const [index, provider] of renderProviders.entries()) renderStates.set(provider.id, {
	authenticated: true, lastSuccessAt: now(), snapshot: { windows: [
		{ id: "a", label: "short", usedPercent: [49, 50, 81][index % 3], resetsAt: reset },
		{ id: "b", label: "long", usedPercent: 35, resetsAt: reset },
	] },
});
const wrapped = renderQuotaRows(renderProviders, renderStates, theme, 56, now());
assert.ok(wrapped.length > renderProviders.length, "windows wrap at 56 columns");
for (const provider of renderProviders) assert.ok(wrapped.some((line) => stripAnsi(line).includes(provider.label)), `${provider.label} renders without renderer changes`);
for (const line of wrapped) {
	assert.ok(visibleWidth(line) <= 56);
	assert.equal((line.match(/\x1b\[/g) ?? []).length % 2, 0);
}
assert.ok(wrapped.some((line) => /\x1b\[32m\[[█░]+\] 49%\x1b\[0m/.test(line)), "green styles the bar and percentage together");
assert.ok(wrapped.some((line) => /\x1b\[33m\[[█░]+\] 50%\x1b\[0m/.test(line)), "yellow boundary styles the bar and percentage together");
assert.ok(wrapped.some((line) => /\x1b\[31m\[[█░]+\] 81%\x1b\[0m/.test(line)), "red boundary styles the bar and percentage together");

const typographyProviders = [{ id: "codex", label: "Codex" }, { id: "claude", label: "Claude" }, { id: "glm", label: "GLM/Z.ai" }];
const after = (days, hours, minutes = 0) => now() + ((days * 24 + hours) * 60 + minutes) * 60_000;
const typographyStates = new Map([
	["codex", { authenticated: true, lastSuccessAt: now(), snapshot: { windows: [{ id: "7d", label: "7d", usedPercent: 12, resetsAt: after(6, 1) }] } }],
	["claude", { authenticated: true, lastSuccessAt: now(), snapshot: { windows: [
		{ id: "5h", label: "5h", usedPercent: 15, resetsAt: after(0, 3, 55) },
		{ id: "7d", label: "7d", usedPercent: 2, resetsAt: after(6, 10) },
	] } }],
	["glm", { authenticated: true, lastSuccessAt: now(), snapshot: { windows: [
		{ id: "5h", label: "5h", usedPercent: 0 },
		{ id: "7d", label: "7d", usedPercent: 1, resetsAt: after(4, 22) },
	] } }],
]);
const typography = renderQuotaRows(typographyProviders, typographyStates, theme, 400, now());
assert.equal(stripAnsi(typography.join("\n")), "Codex 7d(6d 1h) [█░░░░░░░] 12% │ Claude 5h(3h 55m) [█░░░░░░░] 15% · 7d(6d 10h) [░░░░░░░░] 2% │ GLM/Z.ai 5h [░░░░░░░░] 0% · 7d(4d 22h) [░░░░░░░░] 1%", "plain quota typography and provider/window delimiters are exact");
assert.match(typography[0], /\x1b\[36m\x1b\[1mCodex\x1b\[0m\x1b\[0m/, "provider label is accented and bold");
assert.match(typography[0], /\x1b\[2m\(6d 1h\)\x1b\[0m/, "reset countdown is dimmed");
assert.doesNotMatch(stripAnsi(typography[0]), /GLM\/Z\.ai 5h\(/, "missing reset omits countdown parentheses");

const packingProviders = [{ id: "alpha", label: "Alpha-provider-long" }, { id: "beta", label: "Beta-provider-long" }];
const packingStates = new Map(packingProviders.map((provider, index) => [provider.id, {
	authenticated: true, lastSuccessAt: now(), snapshot: { windows: [{ id: "q", label: "quota-window", usedPercent: 10 + index }] },
}]));
const widePacked = renderQuotaRows(packingProviders, packingStates, theme, 200, now());
assert.equal(widePacked.length, 1, "wide rows greedily pack providers");
assert.match(stripAnsi(widePacked[0]), /Alpha-provider-long.* │ Beta-provider-long/);
const exactWidth = visibleWidth(widePacked[0]);
assert.ok(exactWidth >= 56);
assert.equal(renderQuotaRows(packingProviders, packingStates, theme, exactWidth, now()).length, 1, "exact-fit segment stays on the row");
assert.equal(renderQuotaRows(packingProviders, packingStates, theme, exactWidth - 1, now()).length, 2, "minus-one width wraps the next segment");

const continuationProviders = [{ id: "a", label: "ProviderA" }, { id: "b", label: "B" }];
const continuationStates = new Map([
	["a", { authenticated: true, lastSuccessAt: now(), snapshot: { windows: [
		{ id: "one", label: "1234567890", usedPercent: 10 }, { id: "two", label: "1234567890", usedPercent: 20 },
	] } }],
	["b", { authenticated: true, lastSuccessAt: now(), snapshot: { windows: [{ id: "q", label: "q", usedPercent: 1 }] } }],
]);
const continuation = renderQuotaRows(continuationProviders, continuationStates, theme, 56, now()).map(stripAnsi);
assert.equal(continuation.length, 2);
assert.match(continuation[1], /^ProviderA .* │ B /, "continuation repeats its provider label and shares spare width");

const orderedProviders = [{ id: "off1", label: "First" }, { id: "stale", label: "Second" }, { id: "off2", label: "Third" }];
const orderedStates = new Map([
	["off1", { authenticated: true }],
	["stale", { authenticated: true, lastSuccessAt: now() - 60_000, failure: "rate limited", snapshot: { windows: [{ id: "q", label: "q", usedPercent: 20 }] } }],
	["off2", { authenticated: true }],
]);
const ordered = renderQuotaRows(orderedProviders, orderedStates, theme, 300, now());
const orderedPlain = stripAnsi(ordered.join("\n"));
assert.ok(orderedPlain.indexOf("First unavailable") < orderedPlain.indexOf("Second") && orderedPlain.indexOf("Second") < orderedPlain.indexOf("Third unavailable"));
assert.match(orderedPlain, /Second .*stale.*rate limited/, "stale marker remains attached in registry order");
for (const [rows, maxWidth] of [[widePacked, 200], [continuation, 56], [ordered, 300], [wrapped, 56]]) for (const line of rows) {
	assert.ok(visibleWidth(line) <= maxWidth, `quota row fits ${maxWidth}`);
	assert.doesNotMatch(String(line).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, ""), /\x1b/, "ANSI sequences remain complete");
}
for (const category of ["auth rejected", "rate limited", "unavailable"]) {
	const failureStates = new Map([["sixth", { authenticated: true, lastSuccessAt: now() - 60000, failure: category, snapshot: { windows: [{ id: "q", label: "q", usedPercent: 10 }] } }]]);
	const diagnostic = stripAnsi(renderQuotaRows([{ id: "sixth", label: "Sixth" }], failureStates, theme, 80, now()).join("\n"));
	assert.doesNotMatch(diagnostic, /secret|body|token/i);
	if (category !== "unavailable") assert.match(diagnostic, new RegExp(category));
}
for (const [failure, expected] of [["auth rejected", /unavailable · auth rejected$/], ["rate limited", /unavailable · rate limited$/], ["SENTINEL-SECRET-BODY", /unavailable$/]]) {
	const diagnostic = stripAnsi(renderQuotaRows([{ id: "empty", label: "Empty" }], new Map([
		["empty", { authenticated: true, failure }],
	]), theme, 80, now()).join("\n"));
	assert.match(diagnostic, expected);
	assert.doesNotMatch(diagnostic, /SENTINEL|SECRET|BODY/, "no-snapshot failures remain allowlisted and sanitized");
}

// Identity-matched cache renders before a deferred network response; switching identity removes it first.
let resolveNetwork;
let identity = "account-a";
const cacheProvider = { id: "cache", label: "Cache", piProviderId: "cache", identity: () => identity, fetchQuota: () => new Promise((resolve) => { resolveNetwork = resolve; }) };
const cacheJson = JSON.stringify({ version: 1, providers: { cache: { providerId: "cache", identityKey: "account-a", fetchedAt: now(), windows: [{ id: "cached", label: "cached", usedPercent: 44, resetsAt: reset }] } } });
const cached = harness({ providers: [cacheProvider], auth: () => stored("secret-a"), fetchImpl: async () => {}, fsImpl: { readFile: async () => cacheJson, mkdir: async () => {}, writeFile: async () => {}, rename: async () => {} } });
cached.controller.start(cached.ctx);
const cachedComponent = cached.component();
await flush();
assert.match(stripAnsi(cachedComponent.render(80).join("\n")), /cached.*44%/, "matching cache renders while fetch is pending");
resolveNetwork([{ id: "fresh", label: "fresh", usedPercent: 45, resetsAt: reset }]);
await flush();
identity = "account-b";
await cached.clock.advance(120000);
assert.doesNotMatch(stripAnsi(cachedComponent.render(80).join("\n")), /fresh|cached/, "old-account snapshot is removed before new publication");
cached.controller.shutdown(cached.ctx);

const defaultCacheReads = [];
const defaultCache = harness({
	providers: [{ id: "path", label: "Path", piProviderId: "path", identity: () => "path", fetchQuota: async () => [{ id: "q", label: "q", usedPercent: 1 }] }],
	auth: () => stored("safe"), fetchImpl: async () => {}, agentDir: null,
	fsImpl: { readFile: async (path) => { defaultCacheReads.push(path); throw Object.assign(new Error("missing"), { code: "ENOENT" }); }, mkdir: async () => {}, writeFile: async () => {}, rename: async () => {} },
});
defaultCache.controller.start(defaultCache.ctx);
await flush();
assert.deepEqual(defaultCacheReads, [join(process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent"), "subscription-footer-cache.json")], "default cache uses Pi global storage");
defaultCache.controller.shutdown(defaultCache.ctx);

let cacheContent;
let cacheTemporary;
const restartFs = {
	readFile: async () => {
		if (cacheContent === undefined) throw Object.assign(new Error("missing"), { code: "ENOENT" });
		return cacheContent;
	},
	mkdir: async () => {},
	writeFile: async (_path, value) => { cacheTemporary = value; },
	rename: async () => { cacheContent = cacheTemporary; },
};
const restartClock = new Clock();
const restartAuth = () => stored("restart-token");
const seedCache = harness({ providers: [PRODUCTION_PROVIDERS[0]], auth: restartAuth, clock: restartClock, fsImpl: restartFs, fetchImpl: async () => jsonResponse(payloads["chatgpt.com"]) });
seedCache.controller.start(seedCache.ctx);
await flush();
assert.ok(cacheContent, "successful fetch persists restart cache");
seedCache.controller.shutdown(seedCache.ctx);
let restartCalls = 0;
const restarted = harness({ providers: [PRODUCTION_PROVIDERS[0]], auth: restartAuth, clock: restartClock, fsImpl: restartFs, fetchImpl: async () => { restartCalls++; return jsonResponse({}, 429); } });
restarted.controller.start(restarted.ctx);
const restartedComponent = restarted.component();
await flush();
assert.match(stripAnsi(restartedComponent.render(120).join("\n")), /Codex 5h.*70%.*stale 0h 0m · rate limited/, "matching restart cache remains visible through 429");
await restartClock.advance(359_999);
assert.equal(restartCalls, 1, "429 retry waits for the full backoff");
await restartClock.advance(1);
assert.equal(restartCalls, 2, "429 retries at six minutes");
restarted.controller.shutdown(restarted.ctx);
const mismatchedRestart = harness({ providers: [PRODUCTION_PROVIDERS[0]], auth: () => stored("different-token"), clock: restartClock, fsImpl: restartFs, fetchImpl: async () => jsonResponse({}, 429) });
mismatchedRestart.controller.start(mismatchedRestart.ctx);
const mismatchedComponent = mismatchedRestart.component();
await flush();
const mismatchedText = stripAnsi(mismatchedComponent.render(120).join("\n"));
assert.match(mismatchedText, /Codex unavailable · rate limited/);
assert.doesNotMatch(mismatchedText, /70%|20%/, "identity mismatch never publishes another identity's cache");
mismatchedRestart.controller.shutdown(mismatchedRestart.ctx);

// Freshness is atomic: failure retains old windows, stale is immediate, exactly ten minutes is unavailable, then complete success recovers.
let call = 0;
const freshnessProvider = {
	id: "freshness", label: "Freshness", piProviderId: "freshness", identity: () => "same",
	async fetchQuota() {
		call++;
		if (call <= 3) {
			if (call === 1) return [{ id: "good", label: "good", usedPercent: 20, resetsAt: now() + 9_000_000 }];
			throw new Error("SENTINEL-VENDOR-BODY");
		}
		return [{ id: "recovered", label: "recovered", usedPercent: 30, resetsAt: now() + 9_000_000 }];
	},
};
const fresh = harness({ providers: [freshnessProvider], auth: () => stored("safe"), fetchImpl: async () => {} });
fresh.controller.start(fresh.ctx);
const freshComponent = fresh.component();
await flush();
await fresh.clock.advance(120000);
let freshText = stripAnsi(freshComponent.render(80).join("\n"));
assert.match(freshText, /good.*stale 0h 2m/);
assert.doesNotMatch(freshText, /SENTINEL|recovered/);
await fresh.clock.advance(480000);
freshText = stripAnsi(freshComponent.render(80).join("\n"));
assert.equal(freshText.includes("Freshness unavailable"), true, "exact ten-minute cutoff");
await fresh.clock.advance(600000);
assert.match(stripAnsi(freshComponent.render(80).join("\n")), /recovered.*30%/, "complete success recovers");
fresh.controller.shutdown(fresh.ctx);

// Independent 120-second schedules: a pending provider cannot delay its sibling; malformed partial snapshots never publish.
let slowResolve;
let slowCalls = 0;
let siblingCalls = 0;
const independentProviders = [
	{ id: "slow", label: "Slow", piProviderId: "slow", identity: () => "slow", fetchQuota: () => {
		slowCalls++;
		if (slowCalls === 2) return new Promise((resolve) => { slowResolve = resolve; });
		return [{ id: "old", label: "old", usedPercent: 10, resetsAt: reset }];
	} },
	{ id: "sibling", label: "Sibling", piProviderId: "sibling", identity: () => "sibling", fetchQuota: async () => {
		siblingCalls++;
		return [{ id: "ok", label: "ok", usedPercent: siblingCalls * 10, resetsAt: reset }];
	} },
];
const independent = harness({ providers: independentProviders, auth: () => stored("safe"), fetchImpl: async () => {} });
independent.controller.start(independent.ctx);
const independentComponent = independent.component();
await flush();
await independent.clock.advance(120000);
assert.equal(slowCalls, 2);
assert.equal(siblingCalls, 2, "sibling refreshes while slow provider is pending");
slowResolve([{ id: "valid", label: "valid", usedPercent: 60, resetsAt: reset }, { id: "broken", label: "broken", usedPercent: Number.NaN }]);
await flush();
assert.match(stripAnsi(independentComponent.render(80).join("\n")), /Slow old.*10%.*stale/, "partial malformed result retains atomic prior snapshot");
independent.controller.shutdown(independent.ctx);

// Sanitized HTTP categories never parse or retain response bodies.
for (const [status, category] of [[401, "auth rejected"], [429, "rate limited"], [500, "unavailable"]]) {
	const provider = PRODUCTION_PROVIDERS[0];
	await assert.rejects(() => provider.fetchQuota(stored("not-rendered"), {
		fetchImpl: async () => ({ ok: false, status, json: async () => ({ body: "SENTINEL-SECRET" }) }), signal: new AbortController().signal, now,
	}), (error) => error.message === category && !error.message.includes("SENTINEL"));
}

// Auth removal hides a previously visible provider; shutdown/dispose fence deferred completions and restore built-in footer.
let authPresent = true;
let lifecycleResolve;
let lifecycleCalls = 0;
const lifecycleProvider = { id: "life", label: "Life", piProviderId: "life", identity: () => "life", fetchQuota: () => {
	lifecycleCalls++;
	if (lifecycleCalls === 1) return Promise.resolve([{ id: "ok", label: "ok", usedPercent: 5, resetsAt: reset }]);
	return new Promise((resolve) => { lifecycleResolve = resolve; });
} };
const lifecycle = harness({ providers: [lifecycleProvider], auth: () => authPresent ? stored("safe") : undefined, fetchImpl: async () => {} });
lifecycle.controller.start(lifecycle.ctx);
const lifecycleComponent = lifecycle.component();
await flush();
assert.match(stripAnsi(lifecycleComponent.render(80).join("\n")), /Life/);
authPresent = false;
await lifecycle.clock.advance(120000);
assert.doesNotMatch(stripAnsi(lifecycleComponent.render(80).join("\n")), /Life/);
authPresent = true;
await lifecycle.clock.advance(120000);
lifecycle.controller.shutdown(lifecycle.ctx);
assert.equal(lifecycle.factories.at(-1), undefined, "shutdown restores built-in footer");
lifecycleResolve?.([{ id: "late", label: "late", usedPercent: 99, resetsAt: reset }]);
await flush();
assert.equal(lifecycle.controller.isInstalled(), false, "late completion cannot reclaim ownership");

// The custom footer reuses the published workflow text, repaints it once, clears it, and never writes built-in status.
let workflowStatus;
let workflowEnabled = true;
const workflow = harness({
	providers: [{ id: "workflow-quota", label: "Quota", piProviderId: "quota", identity: () => "quota", fetchQuota: async () => [{ id: "q", label: "q", usedPercent: 10, resetsAt: reset }] }],
	auth: () => stored("safe"), fetchImpl: async () => {},
	settings: () => ({ enabled: workflowEnabled, incidents: false }),
	workflowStatus: () => workflowStatus,
});
let builtInStatusWrites = 0;
workflow.ctx.ui.setStatus = () => builtInStatusWrites++;
workflow.controller.start(workflow.ctx);
const workflowComponent = workflow.component();
await flush();
assert.doesNotMatch(stripAnsi(workflowComponent.render(80).join("\n")), /Workflow:/);
const rendersBeforeWorkflowChange = workflow.renders();
workflowStatus = "working #2";
workflow.controller.statusChanged(workflow.ctx);
assert.equal(workflow.renders(), rendersBeforeWorkflowChange + 1);
const orderedWorkflowRows = workflowComponent.render(80).map(stripAnsi);
assert.equal(orderedWorkflowRows.length, 3);
assert.match(orderedWorkflowRows[0], /^Model:/);
assert.equal(orderedWorkflowRows[1], "Workflow: working #2", "workflow row follows model directly");
assert.match(orderedWorkflowRows[2], /^Quota /, "quota rows follow workflow status");
assert.equal((orderedWorkflowRows.join("\n").match(/Workflow: working #2/g) ?? []).length, 1);
assert.doesNotMatch(orderedWorkflowRows[1], /\p{Extended_Pictographic}/u, "footer workflow status contains no emoji");
assert.deepEqual(workflowComponent.render(55).map(stripAnsi), ["Subscription footer needs at least 56 columns"], "55 columns render only the minimum-width diagnostic");
workflowStatus = "needs human";
workflow.controller.statusChanged(workflow.ctx);
assert.equal(stripAnsi(workflowComponent.render(56)[1]), "Workflow: needs human");
workflowStatus = undefined;
workflow.controller.statusChanged(workflow.ctx);
assert.doesNotMatch(stripAnsi(workflowComponent.render(80).join("\n")), /Workflow:/);
workflowEnabled = false;
workflow.controller.apply(workflow.ctx);
assert.equal(workflow.factories.at(-1), undefined);
assert.equal(builtInStatusWrites, 0, "footer lifecycle leaves Pi's setStatus path untouched");

// Incidents are default-off, use only three pinned public sources, retain last-known state on failure, and are generation-fenced.
const incidentProviders = PRODUCTION_PROVIDERS.map((provider) => ({
	...provider,
	identity: () => provider.id,
	fetchQuota: async () => [{ id: "q", label: "q", usedPercent: 12, resetsAt: reset }],
}));
let incidentEnabled = false;
let statusRequests = 0;
let failStatuses = false;
let deferredStatusResolve;
const incidents = harness({
	providers: incidentProviders,
	auth: () => stored("safe"),
	settings: () => ({ enabled: true, incidents: incidentEnabled }),
	fetchImpl: async (url) => {
		if (!url.includes("/status.json")) throw new Error(`unexpected quota fetch ${url}`);
		statusRequests++;
		if (failStatuses) return jsonResponse({}, 500);
		return jsonResponse({ status: { indicator: url.includes("anthropic") ? "major" : "none" } });
	},
});
incidents.controller.start(incidents.ctx);
const incidentsComponent = incidents.component();
await flush();
assert.equal(statusRequests, 0, "incident off performs zero public status requests");
const claudeQuotaAt = incidents.controller.states.get("claude").lastSuccessAt;
incidentEnabled = true;
incidents.controller.apply(incidents.ctx);
await flush();
assert.equal(statusRequests, 3);
assert.match(stripAnsi(incidentsComponent.render(120).join("\n")), /Claude ! q.*12%/, "incident marker does not replace quota");
assert.equal(incidents.controller.states.get("glm").incident, undefined);
assert.equal(incidents.controller.states.get("kimi").incident, undefined);
failStatuses = true;
await incidents.clock.advance(120000);
assert.equal(incidents.controller.states.get("claude").incident, "major", "status failure retains incident");
assert.equal(incidents.controller.states.get("claude").lastSuccessAt, claudeQuotaAt + 120000, "incident failure does not alter quota refresh time");
const requestsBeforeIncidentDisable = statusRequests;
incidentEnabled = false;
incidents.controller.apply(incidents.ctx);
assert.equal(incidents.controller.states.get("claude").incident, undefined, "incident off clears last-known markers immediately");
assert.doesNotMatch(stripAnsi(incidentsComponent.render(120).join("\n")), /Claude !/, "disabled incident marker disappears");
await incidents.clock.advance(120000);
assert.equal(statusRequests, requestsBeforeIncidentDisable, "incident off aborts polling and makes no further status requests");
incidents.controller.shutdown(incidents.ctx);
const lateIncidents = harness({
	providers: [incidentProviders.find((provider) => provider.id === "claude")], auth: () => stored("safe"), incidents: true,
	fetchImpl: (url) => url.includes("/status.json") ? new Promise((resolve) => { deferredStatusResolve = resolve; }) : Promise.resolve(jsonResponse({})),
});
lateIncidents.controller.start(lateIncidents.ctx);
await flush();
lateIncidents.controller.shutdown(lateIncidents.ctx);
deferredStatusResolve?.(jsonResponse({ status: { indicator: "critical" } }));
await flush();
assert.equal(lateIncidents.controller.states.get("claude").incident, undefined, "late incident response is discarded after shutdown");

// Live disable notification and owner disposal behavior remain from U1.
let enabled = true;
const settingsFactories = [];
const notices = [];
const settingsCtx = { ...context(0), modelRegistry: { getProviderAuth: async () => undefined }, ui: { setFooter: (factory) => settingsFactories.push(factory), notify: (message) => notices.push(message) } };
const settingsClock = new Clock();
const settingsController = createSubscriptionFooterController({}, {
	readGlobalSettings: () => ({ workOrchestrator: { subscriptionFooter: { enabled } } }), providers: [],
	setTimeoutImpl: settingsClock.setTimeout, clearTimeoutImpl: settingsClock.clearTimeout, setIntervalImpl: settingsClock.setInterval, clearIntervalImpl: settingsClock.clearInterval,
});
settingsController.start(settingsCtx);
const owner = settingsFactories.at(-1)({ requestRender() {} }, theme);
enabled = false;
settingsController.apply(settingsCtx);
assert.equal(settingsFactories.at(-1), undefined);
assert.match(notices.at(-1), /\/reload/);
enabled = true;
settingsController.start(settingsCtx);
const replacement = settingsFactories.at(-1)({ requestRender() {} }, theme);
replacement.dispose();
assert.equal(settingsController.isInstalled(), false);
owner.dispose();

process.stdout.write("ok - work-subscription-footer U3 workflow, incidents, provenance-ready rendering, and U1/U2 regression\n");
