import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const MIN_WIDTH = 56;
const FULL_WIDTH = 80;
const POLL_MS = 120_000;
const CLAUDE_POLL_MS = 1_800_000;
const CLAUDE_UNAVAILABLE_MS = 3_600_000;
const FOLLOWER_SYNC_MS = 60_000;
const BACKOFF_MS = 360_000;
const MAX_BACKOFF_MS = 3_600_000;
const LOCK_STALE_MS = 30_000;
const FETCH_TIMEOUT_MS = 10_000;
const UNAVAILABLE_MS = 600_000;
const ANSI_PATTERN = /\x1b\[[0-?]*[ -/]*[@-~]/g;
const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

function codePointWidth(codePoint) {
	if (
		codePoint === 0 ||
		(codePoint >= 0x300 && codePoint <= 0x36f) ||
		(codePoint >= 0x1ab0 && codePoint <= 0x1aff) ||
		(codePoint >= 0x1dc0 && codePoint <= 0x1dff) ||
		(codePoint >= 0xfe00 && codePoint <= 0xfe0f) ||
		(codePoint >= 0xfe20 && codePoint <= 0xfe2f) ||
		(codePoint >= 0x1f3fb && codePoint <= 0x1f3ff)
	) return 0;
	return codePoint >= 0x1100 &&
		(codePoint <= 0x115f || codePoint === 0x2329 || codePoint === 0x232a ||
			(codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
			(codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
			(codePoint >= 0xf900 && codePoint <= 0xfaff) ||
			(codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
			(codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
			(codePoint >= 0xff00 && codePoint <= 0xff60) ||
			(codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
			(codePoint >= 0x1f300 && codePoint <= 0x1faff) ||
			(codePoint >= 0x20000 && codePoint <= 0x3fffd)) ? 2 : 1;
}

function graphemeWidth(value) {
	let width = 0;
	for (const character of value) width = Math.max(width, codePointWidth(character.codePointAt(0)));
	return width;
}

export function stripAnsi(value) {
	return String(value ?? "").replace(ANSI_PATTERN, "");
}

export function visibleWidth(value) {
	let width = 0;
	for (const { segment } of segmenter.segment(stripAnsi(value))) width += graphemeWidth(segment);
	return width;
}

export function truncatePlain(value, maxWidth, suffix = "…") {
	const plain = String(value ?? "").replace(/[\r\n\t\x00-\x1f\x7f]/g, " ");
	if (visibleWidth(plain) <= maxWidth) return plain;
	const suffixWidth = visibleWidth(suffix);
	if (maxWidth <= suffixWidth) return "";
	let output = "";
	let width = 0;
	for (const { segment } of segmenter.segment(plain)) {
		const next = graphemeWidth(segment);
		if (width + next + suffixWidth > maxWidth) break;
		output += segment;
		width += next;
	}
	return output + suffix;
}

function formatTokens(count) {
	const value = Math.max(0, Number(count) || 0);
	if (value < 1000) return String(Math.round(value));
	if (value < 10000) return `${(value / 1000).toFixed(1)}k`;
	if (value < 1000000) return `${Math.round(value / 1000)}k`;
	return value < 10000000 ? `${(value / 1000000).toFixed(1)}M` : `${Math.round(value / 1000000)}M`;
}

function contextValues(ctx) {
	const usage = ctx.getContextUsage?.() ?? {};
	const used = Math.max(0, Number(usage.tokens) || 0);
	const total = Math.max(0, Number(usage.contextWindow ?? usage.maxTokens ?? ctx.model?.contextWindow) || 0);
	const rawPercent = usage.percent;
	const percent = Number.isFinite(rawPercent)
		? Math.max(0, Math.min(100, Math.round(rawPercent)))
		: total ? Math.max(0, Math.min(100, Math.round((used / total) * 100))) : 0;
	return { used, total, percent };
}

function contextBar(percent, cells) {
	const filled = Math.round((Math.max(0, Math.min(100, percent)) / 100) * cells);
	return `${"█".repeat(filled)}${"░".repeat(cells - filled)}`;
}

export function renderModelRow(ctx, theme, width, thinkingLevel) {
	if (width < MIN_WIDTH) {
		const diagnostic = truncatePlain("Subscription footer needs at least 56 columns", width);
		return [theme?.fg?.("warning", diagnostic) ?? diagnostic];
	}
	const { used, total, percent } = contextValues(ctx);
	const full = width >= FULL_WIDTH;
	const barCells = full ? 12 : Math.max(4, Math.min(10, width - 52));
	const effort = String(thinkingLevel ?? ctx.thinkingLevel ?? "off");
	const model = String(ctx.model?.name ?? ctx.model?.id ?? "no model");
	const bar = contextBar(percent, barCells);
	const suffix = full
		? ` · Effort: ${effort} · Context [${bar}] ${percent}% ${formatTokens(used)}/${formatTokens(total)} · F8 Compact`
		: ` · ${effort} · [${bar}] ${percent}% ${formatTokens(used)}/${formatTokens(total)} · F8 Compact`;
	const prefix = full ? "Model: " : "";
	const modelWidth = Math.max(1, width - visibleWidth(prefix) - visibleWidth(suffix));
	const plainModel = truncatePlain(model, modelWidth);
	const color = used > 180000 ? "error" : used > 150000 ? "warning" : "text";
	const styledBar = theme?.fg?.(color, bar) ?? bar;
	return [`${prefix}${plainModel}${suffix.replace(bar, styledBar)}`];
}

class QuotaError extends Error {
	constructor(category, retryAfterMs) {
		super(category);
		this.category = category;
		this.retryAfterMs = retryAfterMs;
	}
}

const table = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const percent = (value) => finite(value) ? Math.max(0, Math.min(100, value)) : undefined;
const resetTime = (value) => {
	if (finite(value) && value > 0) return value > 1e12 ? value : value * 1000;
	if (typeof value === "string" && value) { const parsed = Date.parse(value); return Number.isFinite(parsed) ? parsed : undefined; }
	return undefined;
};

function resolvedToken(result) {
	const headers = table(result?.auth?.headers);
	const authorization = Object.entries(headers).find(([key]) => key.toLowerCase() === "authorization")?.[1];
	if (typeof authorization === "string" && authorization) return authorization.replace(/^Bearer\s+/i, "");
	return typeof result?.auth?.apiKey === "string" && result.auth.apiKey ? result.auth.apiKey : undefined;
}

function authHeaders(result, extras = {}, raw = false) {
	const token = resolvedToken(result);
	if (!token) throw new QuotaError("auth rejected");
	return { ...extras, authorization: raw ? token : `Bearer ${token}` };
}

function retryAfterMs(response, now = Date.now()) {
	const value = response?.headers?.get?.("retry-after");
	if (!value) return;
	const seconds = Number(value);
	if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
	const date = Date.parse(value);
	if (Number.isFinite(date)) return Math.max(0, date - now);
}

async function requestJson(url, headers, { fetchImpl, signal, timeout = FETCH_TIMEOUT_MS, now = Date.now, setTimeoutImpl = setTimeout, clearTimeoutImpl = clearTimeout }) {
	const controller = new AbortController();
	const abort = () => controller.abort();
	if (signal?.aborted) abort(); else signal?.addEventListener?.("abort", abort, { once: true });
	const timer = setTimeoutImpl(abort, timeout);
	try {
		const response = await fetchImpl(url, { headers, signal: controller.signal, redirect: "error" });
		if (response.status === 401 || response.status === 403) throw new QuotaError("auth rejected");
		if (response.status === 429) throw new QuotaError("rate limited", retryAfterMs(response, now()));
		if (!response.ok) throw new QuotaError("unavailable");
		try { return await response.json(); } catch { throw new QuotaError("unavailable"); }
	} catch (error) {
		if (error instanceof QuotaError) throw error;
		throw new QuotaError("unavailable");
	} finally {
		clearTimeoutImpl(timer);
		signal?.removeEventListener?.("abort", abort);
	}
}

function complete(windows) {
	if (!Array.isArray(windows) || windows.length === 0 || windows.some((window) =>
		!window || typeof window.id !== "string" || typeof window.label !== "string" ||
		!finite(window.usedPercent) || window.usedPercent < 0 || window.usedPercent > 100 ||
		(window.resetsAt !== undefined && !finite(window.resetsAt)))) throw new QuotaError("unavailable");
	return windows;
}

function whamWindow(value, fallback, now) {
	if (!value) return undefined;
	if (!finite(value.used_percent)) throw new QuotaError("unavailable");
	const resetsAt = resetTime(value.reset_at, now) ?? (finite(value.reset_after_seconds) ? now + value.reset_after_seconds * 1000 : undefined);
	if (!resetsAt) throw new QuotaError("unavailable");
	const id = finite(value.limit_window_seconds) && value.limit_window_seconds > 0
		? value.limit_window_seconds <= 21600 ? "5h" : "7d" : fallback;
	return { id, label: id, usedPercent: percent(value.used_percent), resetsAt };
}

function codexParser(payload, now) {
	const rate = table(payload).rate_limit;
	if (!rate || typeof rate !== "object") throw new QuotaError("unavailable");
	return complete([whamWindow(rate.primary_window, "5h", now), whamWindow(rate.secondary_window, "7d", now)]
		.filter(Boolean).sort((a, b) => Number(b.id === "5h") - Number(a.id === "5h")));
}

function claudeParser(payload) {
	if (!Array.isArray(table(payload).limits)) throw new QuotaError("unavailable");
	const windows = table(payload).limits.map((limit, index) => {
		if (!limit || !finite(limit.percent) || !limit.kind) throw new QuotaError("unavailable");
		const resetsAt = resetTime(limit.resets_at);
		if (!resetsAt) throw new QuotaError("unavailable");
		const id = limit.kind === "session" ? "5h" : limit.kind === "weekly_all" ? "7d" : `model-${index}`;
		return { id, label: id.startsWith("model-") ? limit.scope?.model?.display_name ?? "model" : id, usedPercent: percent(limit.percent), resetsAt };
	});
	return complete(windows.sort((a, b) => Number(b.id === "5h") - Number(a.id === "5h")));
}

function copilotParser(payload) {
	const quota = table(table(table(payload).quota_snapshots).premium_interactions);
	if (quota.unlimited === true || !finite(quota.percent_remaining)) throw new QuotaError("unavailable");
	const resetsAt = resetTime(table(payload).quota_reset_date);
	if (!resetsAt) throw new QuotaError("unavailable");
	return complete([{ id: "mo", label: "mo", usedPercent: 100 - Math.max(0, Math.min(100, quota.percent_remaining)), resetsAt }]);
}

function numericValue(value) {
	if (finite(value)) return value;
	if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
}

function glmParser(payload) {
	if (table(payload).success === false) throw new QuotaError("unavailable");
	const limits = table(table(payload).data).limits;
	if (!Array.isArray(limits)) throw new QuotaError("unavailable");
	const unitSeconds = { 3: 3600, 6: 604800, 5: 2592000 };
	const order = { "5h": 0, "7d": 1 };
	const windows = [];
	for (const [index, limit] of limits.entries()) {
		const percentage = numericValue(limit?.percentage);
		if (percentage === undefined || typeof limit.type !== "string" || !limit.type) continue;
		const number = numericValue(limit.number);
		const unit = numericValue(limit.unit);
		const seconds = number === undefined || unit === undefined ? 0 : number * (unitSeconds[unit] ?? 0);
		const tokenLimit = limit.type === "TOKENS" || limit.type === "TOKENS_LIMIT";
		const id = tokenLimit && seconds > 0 && seconds <= 21600 ? "5h" : tokenLimit && seconds > 21600 && seconds <= 604800 ? "7d" : undefined;
		if (!id) continue;
		const resetsAt = resetTime(numericValue(limit.nextResetTime) ?? limit.nextResetTime);
		if (!resetsAt && !(id === "5h" && unit === 3 && number === 5)) continue;
		windows.push({ id: `${id}-${index}`, label: id, usedPercent: percent(percentage), ...(resetsAt ? { resetsAt } : {}) });
	}
	return complete(windows.sort((a, b) => order[a.label] - order[b.label]));
}

function kimiRow(data, window, fallback, now, index) {
	const limit = numericValue(data.limit);
	let used = numericValue(data.used);
	if (used === undefined && numericValue(data.remaining) !== undefined && limit !== undefined) used = limit - numericValue(data.remaining);
	if (used === undefined || limit === undefined || limit <= 0) throw new QuotaError("unavailable");
	let resetsAt;
	for (const key of ["reset_at", "resetAt", "reset_time", "resetTime"]) if (!resetsAt) resetsAt = resetTime(data[key]);
	for (const key of ["reset_in", "resetIn", "ttl"]) if (!resetsAt && numericValue(data[key]) > 0) resetsAt = now + numericValue(data[key]) * 1000;
	if (!resetsAt) throw new QuotaError("unavailable");
	let label = fallback;
	const duration = numericValue(window.duration ?? data.duration);
	if (duration > 0) {
		const unit = String(window.timeUnit ?? data.timeUnit ?? "");
		const multiplier = unit.includes("MINUTE") ? 60 : unit.includes("HOUR") ? 3600 : unit.includes("DAY") ? 86400 : unit.includes("WEEK") ? 604800 : unit.includes("MONTH") ? 2592000 : 1;
		const seconds = duration * multiplier;
		label = seconds <= 21600 ? "5h" : seconds <= 604800 ? "7d" : "mo";
	}
	return { id: `${label}-${index}`, label, usedPercent: percent((used / limit) * 100), resetsAt };
}

function kimiParser(payload, now) {
	const root = table(table(payload).data ?? payload);
	const rows = [];
	if (root.usage && typeof root.usage === "object") rows.push(kimiRow(table(root.usage), {}, "7d", now, rows.length));
	if (Array.isArray(root.limits)) for (const item of root.limits) {
		const row = table(item);
		rows.push(kimiRow(table(row.detail ?? row), table(row.window), "7d", now, rows.length));
	}
	return complete(rows.sort((a, b) => Number(b.label === "5h") - Number(a.label === "5h")));
}

const INCIDENT_SOURCES = Object.freeze([
	{ id: "codex", url: "https://status.openai.com/api/v2/status.json" },
	{ id: "claude", url: "https://status.anthropic.com/api/v2/status.json" },
	{ id: "copilot", url: "https://www.githubstatus.com/api/v2/status.json" },
]);

function incidentIndicator(payload) {
	const value = table(payload).status?.indicator;
	return ["minor", "major", "critical", "maintenance"].includes(value) ? value : "none";
}

function provider({ id, label, piProviderId, url, parser, headers, pollMs = POLL_MS, unavailableMs = UNAVAILABLE_MS }) {
	return Object.freeze({
		id, label, piProviderId, pollMs, unavailableMs,
		resolveAuth: (ctx) => ctx.modelRegistry?.getProviderAuth?.(piProviderId),
		identity: authIdentity,
		async fetchQuota(auth, options) {
			const payload = await requestJson(url, headers(auth), options);
			return parser(payload, options.now());
		},
	});
}

export const PRODUCTION_PROVIDERS = Object.freeze([
	provider({ id: "codex", label: "Codex", piProviderId: "openai-codex", url: "https://chatgpt.com/backend-api/wham/usage", parser: codexParser, headers: (auth) => {
		const headers = authHeaders(auth, { "user-agent": "codex-cli" });
		const source = table(auth?.auth?.headers);
		for (const [key, value] of Object.entries(source)) if (key.toLowerCase() === "chatgpt-account-id") headers["chatgpt-account-id"] = value;
		return headers;
	} }),
	provider({ id: "claude", label: "Claude", piProviderId: "anthropic", url: "https://api.anthropic.com/api/oauth/usage", parser: claudeParser, headers: (auth) => authHeaders(auth, { "anthropic-beta": "oauth-2025-04-20" }), pollMs: CLAUDE_POLL_MS, unavailableMs: CLAUDE_UNAVAILABLE_MS }),
	provider({ id: "copilot", label: "Copilot", piProviderId: "github-copilot", url: "https://api.github.com/copilot_internal/user", parser: copilotParser, headers: (auth) => authHeaders(auth, { "user-agent": "ce-workflow-subscription-footer" }) }),
	provider({ id: "glm", label: "GLM/Z.ai", piProviderId: "zai", url: "https://api.z.ai/api/monitor/usage/quota/limit", parser: glmParser, headers: (auth) => authHeaders(auth, {}, true) }),
	provider({ id: "kimi", label: "Kimi", piProviderId: "kimi-coding", url: "https://api.kimi.com/coding/v1/usages", parser: kimiParser, headers: (auth) => authHeaders(auth, { "user-agent": "ce-workflow-subscription-footer" }) }),
]);

function authIdentity(result) {
	const headers = table(result?.auth?.headers);
	const stable = Object.entries(headers).find(([key, value]) => /(?:account|user)[-_]?id/i.test(key) && typeof value === "string")?.[1];
	const token = resolvedToken(result);
	if (!token) throw new QuotaError("auth rejected");
	let claim;
	try {
		const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"));
		claim = payload.account_id ?? payload.sub;
	} catch {}
	return createHash("sha256").update(String(stable ?? claim ?? JSON.stringify(result.auth))).digest("hex");
}

function storedAuth(result) {
	return result && (result.source === "OAuth" || result.source === "stored credential") && resolvedToken(result) ? result : undefined;
}

function formatDuration(ms) {
	const minutes = Math.max(0, Math.ceil(ms / 60000));
	const days = Math.floor(minutes / 1440);
	const hours = Math.floor((minutes % 1440) / 60);
	return days ? `${days}d ${hours}h` : `${hours}h ${minutes % 60}m`;
}

function quotaColor(value) { return value > 80 ? "error" : value > 50 ? "warning" : "text"; }

function windowText(window, now, barCells = 8) {
	const pct = Math.round(window.usedPercent);
	const filled = Math.round((pct / 100) * barCells);
	const reset = window.resetsAt ? `(${formatDuration(window.resetsAt - now)})` : "";
	return `${window.label}${reset} [${"█".repeat(filled)}${"░".repeat(barCells - filled)}] ${pct}%`;
}

function providerDisplay(provider, state, theme) {
	const marker = state?.incident && state.incident !== "none" ? " !" : "";
	const label = `${provider.label}${marker}`;
	const styledLabel = theme?.fg?.("accent", theme?.bold?.(provider.label) ?? provider.label) ?? provider.label;
	if (!marker) return { label, styledLabel };
	const color = state.incident === "maintenance" ? "accent" : state.incident === "minor" ? "warning" : "error";
	return { label, styledLabel: `${styledLabel}${theme?.fg?.(color, marker) ?? marker}` };
}

function styleSegment(text, window, providerLabel, styledProviderLabel, theme) {
	let styled = text;
	const reset = styled.match(/\([^)]*\)/)?.[0];
	if (reset) styled = styled.replace(reset, theme?.fg?.("dim", reset) ?? reset);
	const quota = styled.match(/\[[█░]+\] \d+%/)?.[0];
	if (quota) styled = styled.replace(quota, theme?.fg?.(quotaColor(window.usedPercent), quota) ?? quota);
	if (providerLabel && styled.startsWith(providerLabel))
		styled = `${styledProviderLabel}${styled.slice(providerLabel.length)}`;
	return styled;
}

export function renderQuotaRows(registry, states, theme, width, now = Date.now()) {
	if (width < MIN_WIDTH) return [];
	const lines = [];
	let parts = [];
	let plainWidth = 0;
	let currentProvider;
	const flush = () => {
		if (parts.length) lines.push(parts.map((part) => `${part.separator}${part.styled}`).join(""));
		parts = [];
		plainWidth = 0;
		currentProvider = undefined;
	};
	const append = (plain, styled, providerId) => {
		const separator = parts.length ? currentProvider === providerId ? " · " : " │ " : "";
		parts.push({ separator, styled });
		plainWidth += visibleWidth(separator) + visibleWidth(plain);
		currentProvider = providerId;
	};
	for (const provider of registry) {
		const state = states.get(provider.id);
		if (!state?.authenticated) continue;
		const display = providerDisplay(provider, state, theme);
		const age = state.lastSuccessAt === undefined ? Infinity : now - state.lastSuccessAt;
		if (!state.snapshot || age >= (provider.unavailableMs ?? UNAVAILABLE_MS)) {
			const failure = state.failure === "auth rejected" || state.failure === "rate limited" ? ` · ${state.failure}` : "";
			let plain = `${display.label} quota unavailable${failure}`;
			if (parts.length && plainWidth + 3 + visibleWidth(plain) > width) flush();
			plain = truncatePlain(plain, width);
			append(plain, styleSegment(plain, {}, display.label, display.styledLabel, theme), provider.id);
			continue;
		}
		const marker = state.failure
			? ` · stale ${formatDuration(age)}${state.failure === "unavailable" ? "" : ` · quota ${state.failure}`}`
			: "";
		for (const [index, window] of state.snapshot.windows.entries()) {
			const suffix = index === state.snapshot.windows.length - 1 ? marker : "";
			let prefix = currentProvider === provider.id ? "" : `${display.label} `;
			let body = windowText(window, now, 8);
			let plain = `${prefix}${body}${suffix}`;
			if (parts.length && plainWidth + 3 + visibleWidth(plain) > width) {
				flush();
				prefix = `${display.label} `;
				plain = `${prefix}${body}${suffix}`;
			}
			for (let cells = 7; visibleWidth(plain) > width && cells >= 4; cells--) {
				body = windowText(window, now, cells);
				plain = `${prefix}${body}${suffix}`;
			}
			plain = truncatePlain(plain, width);
			append(plain, styleSegment(plain, window, prefix ? display.label : undefined, display.styledLabel, theme), provider.id);
		}
	}
	flush();
	return lines;
}

function processAlive(pid) {
	if (!Number.isInteger(pid) || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return error?.code === "EPERM";
	}
}

async function pollingLockState(lockFile, fsImpl) {
	try {
		const owner = JSON.parse(await fsImpl.readFile(lockFile, "utf8"));
		return processAlive(owner?.pid) ? "live" : "stale";
	} catch (error) {
		if (error?.code === "ENOENT") return "missing";
		try {
			return typeof fsImpl.stat === "function" && Date.now() - (await fsImpl.stat(lockFile)).mtimeMs >= LOCK_STALE_MS
				? "stale"
				: "live";
		} catch { return "live"; }
	}
}

async function acquireRecoveryOwnership(lockFile, fsImpl) {
	for (let attempt = 0; attempt < 16; attempt++) {
		const recoveryFile = `${lockFile}.recovery${attempt ? `.${attempt}` : ""}`;
		try {
			return { handle: await fsImpl.open(recoveryFile, "wx"), path: recoveryFile };
		} catch (error) {
			if (error?.code !== "EEXIST") return null;
			try {
				if (Date.now() - (await fsImpl.stat(recoveryFile)).mtimeMs < LOCK_STALE_MS) return null;
			} catch { return null; }
		}
	}
	return null;
}

async function acquirePollingOwnership(lockFile, fsImpl) {
	if (typeof fsImpl.open !== "function" || typeof fsImpl.unlink !== "function")
		return async () => {};
	const claim = async () => {
		const handle = await fsImpl.open(lockFile, "wx");
		const nonce = randomUUID();
		try {
			await handle.writeFile(JSON.stringify({ pid: process.pid, nonce }));
		} catch (error) {
			try { await handle.close(); } catch {}
			try { await fsImpl.unlink(lockFile); } catch {}
			throw error;
		}
		let released = false;
		return async () => {
			if (released) return;
			released = true;
			try { await handle.close(); } catch {}
			try {
				const owner = JSON.parse(await fsImpl.readFile(lockFile, "utf8"));
				if (owner?.nonce === nonce) await fsImpl.unlink(lockFile);
			} catch {}
		};
	};
	try {
		return await claim();
	} catch (error) {
		if (error?.code !== "EEXIST") return null;
	}
	if (await pollingLockState(lockFile, fsImpl) !== "stale") return null;

	const recovery = await acquireRecoveryOwnership(lockFile, fsImpl);
	if (!recovery) return null;
	try {
		const state = await pollingLockState(lockFile, fsImpl);
		if (state === "live") return null;
		if (state === "stale") await fsImpl.unlink(lockFile);
		try { return await claim(); } catch { return null; }
	} finally {
		try { await recovery.handle.close(); } catch {}
		try { await fsImpl.unlink(recovery.path); } catch {}
	}
}

export function createSubscriptionFooterController(pi, options = {}) {
	const {
		readGlobalSettings,
		providers = PRODUCTION_PROVIDERS,
		now = Date.now,
		fetchImpl = globalThis.fetch,
		agentDir = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent"),
		fsImpl = { mkdir, open, readFile, rename, stat, unlink, writeFile },
		setTimeoutImpl = setTimeout,
		clearTimeoutImpl = clearTimeout,
		setIntervalImpl = setInterval,
		clearIntervalImpl = clearInterval,
	} = options;
	let generation = 0;
	let activeCtx;
	let installed = false;
	let ticker;
	let requestRender = () => {};
	let cache = { version: 1, providers: {} };
	let savePending = Promise.resolve();
	let ownershipLifecycle = Promise.resolve();
	let releasePollingOwnership;
	let followerTimer;
	const registry = [...providers];
	const states = new Map(registry.map((entry) => [entry.id, { authenticated: false }]));
	const timers = new Map();
	const aborters = new Map();
	const incidentTimers = new Map();
	const incidentAborters = new Map();
	const cacheFile = join(agentDir, "subscription-footer-cache.json");
	const pollingLockFile = join(agentDir, "subscription-footer-poll.lock");
	const setting = () => readGlobalSettings?.().workOrchestrator?.subscriptionFooter ?? {};

	async function loadCache() {
		try {
			const value = JSON.parse(await fsImpl.readFile(cacheFile, "utf8"));
			if (value?.version === 1 && value.providers && typeof value.providers === "object") cache = value;
		} catch {}
	}

	function saveCache() {
		savePending = savePending.then(async () => {
			try {
				await fsImpl.mkdir(agentDir, { recursive: true });
				const temporary = `${cacheFile}.${process.pid}.tmp`;
				await fsImpl.writeFile(temporary, JSON.stringify(cache));
				await fsImpl.rename(temporary, cacheFile);
			} catch {}
		});
		return savePending;
	}

	function schedule(entry, delay, gen) {
		if (gen !== generation) return;
		clearTimeoutImpl(timers.get(entry.id));
		timers.set(entry.id, setTimeoutImpl(() => void refresh(entry, gen), delay));
	}

	function scheduleIncident(source, delay, gen) {
		if (gen !== generation || !setting().incidents) return;
		clearTimeoutImpl(incidentTimers.get(source.id));
		incidentTimers.set(source.id, setTimeoutImpl(() => void refreshIncident(source, gen), delay));
	}

	async function refreshIncident(source, gen) {
		if (gen !== generation || !activeCtx || !setting().incidents || !states.get(source.id)?.authenticated) return;
		const controller = new AbortController();
		incidentAborters.get(source.id)?.abort();
		incidentAborters.set(source.id, controller);
		try {
			const payload = await requestJson(source.url, {}, { fetchImpl, signal: controller.signal, setTimeoutImpl, clearTimeoutImpl });
			if (gen !== generation || controller.signal.aborted || !setting().incidents) return;
			states.get(source.id).incident = incidentIndicator(payload);
			requestRender();
		} catch {
			if (gen !== generation || controller.signal.aborted || !setting().incidents) return;
		}
		scheduleIncident(source, POLL_MS, gen);
	}

	function reconcileIncidents(gen) {
		if (setting().incidents && releasePollingOwnership) {
			for (const source of INCIDENT_SOURCES) if (states.get(source.id)?.authenticated && !incidentTimers.has(source.id) && !incidentAborters.has(source.id)) void refreshIncident(source, gen);
		} else {
			for (const timer of incidentTimers.values()) clearTimeoutImpl(timer);
			incidentTimers.clear();
			for (const controller of incidentAborters.values()) controller.abort();
			incidentAborters.clear();
			for (const state of states.values()) state.incident = undefined;
		}
	}

	async function refresh(entry, gen, allowNetwork = Boolean(releasePollingOwnership), render = true) {
		if (gen !== generation || !activeCtx) return;
		let resolved;
		try {
			const auth = entry.resolveAuth
				? await entry.resolveAuth(activeCtx)
				: await activeCtx.modelRegistry?.getProviderAuth?.(entry.piProviderId);
			resolved = storedAuth(auth);
		} catch {}
		if (gen !== generation) return;
		const state = states.get(entry.id);
		if (!resolved) {
			Object.assign(state, { authenticated: false, identityKey: undefined, snapshot: undefined, lastSuccessAt: undefined, failure: undefined });
			if (render) requestRender();
			if (allowNetwork) schedule(entry, POLL_MS, gen);
			return;
		}
		const identityKey = (entry.identity ?? authIdentity)(resolved);
		if (state.identityKey !== identityKey) {
			Object.assign(state, { identityKey, snapshot: undefined, lastSuccessAt: undefined, failure: undefined });
			if (allowNetwork && cache.providers[entry.id]?.identityKey !== identityKey) {
				delete cache.providers[entry.id];
				void saveCache();
			}
		}
		state.authenticated = true;
		reconcileIncidents(gen);
		const cached = cache.providers[entry.id];
		if (allowNetwork && cached && cached.identityKey !== identityKey) {
			delete cache.providers[entry.id];
			void saveCache();
		}
		if ((!state.snapshot || cached?.fetchedAt > state.lastSuccessAt) && cached?.identityKey === identityKey) {
			try {
				state.snapshot = { providerId: entry.id, identityKey, fetchedAt: cached.fetchedAt, windows: complete(cached.windows) };
				state.lastSuccessAt = cached.fetchedAt;
			} catch {}
		}
		if (render) requestRender();
		if (!allowNetwork) return;
		const pollMs = entry.pollMs ?? POLL_MS;
		const age = state.lastSuccessAt === undefined ? Infinity : Math.max(0, now() - state.lastSuccessAt);
		if (age < pollMs) {
			schedule(entry, pollMs - age, gen);
			return;
		}
		const controller = new AbortController();
		aborters.get(entry.id)?.abort();
		aborters.set(entry.id, controller);
		try {
			const windows = complete(await entry.fetchQuota(resolved, { fetchImpl, signal: controller.signal, now, setTimeoutImpl, clearTimeoutImpl }));
			if (gen !== generation || controller.signal.aborted) return;
			const fetchedAt = now();
			state.snapshot = { providerId: entry.id, identityKey, fetchedAt, windows };
			state.lastSuccessAt = fetchedAt;
			state.failure = undefined;
			state.failureCount = 0;
			cache.providers[entry.id] = state.snapshot;
			void saveCache();
			if (render) requestRender();
			schedule(entry, pollMs, gen);
		} catch (error) {
			if (gen !== generation || controller.signal.aborted) return;
			state.failure = error instanceof QuotaError ? error.category : "unavailable";
			state.failureCount = (state.failureCount ?? 0) + 1;
			const backoff = Math.min(MAX_BACKOFF_MS, BACKOFF_MS * 2 ** (state.failureCount - 1));
			const retryDelay = Math.min(MAX_BACKOFF_MS, error instanceof QuotaError ? error.retryAfterMs ?? 0 : 0);
			if (render) requestRender();
			schedule(entry, Math.max(backoff, retryDelay, pollMs), gen);
		}
	}

	function scheduleFollower(gen) {
		if (gen !== generation || releasePollingOwnership) return;
		clearTimeoutImpl(followerTimer);
		followerTimer = setTimeoutImpl(() => void startPolling(gen), FOLLOWER_SYNC_MS);
	}

	async function ensurePollingOwner(gen) {
		if (releasePollingOwnership) return true;
		ownershipLifecycle = ownershipLifecycle.then(async () => {
			if (gen !== generation || releasePollingOwnership) return;
			try { await fsImpl.mkdir(agentDir, { recursive: true }); } catch {}
			const release = await acquirePollingOwnership(pollingLockFile, fsImpl);
			if (gen !== generation) await release?.();
			else if (release) releasePollingOwnership = release;
		});
		await ownershipLifecycle;
		return gen === generation && Boolean(releasePollingOwnership);
	}

	async function startPolling(gen) {
		if (gen !== generation || !activeCtx) return;
		await loadCache();
		const owner = await ensurePollingOwner(gen);
		if (gen !== generation || !activeCtx) return;
		await Promise.all(registry.map((entry) => refresh(entry, gen, owner, false)));
		requestRender();
		if (!owner) scheduleFollower(gen);
	}

	function stop({ restore = true, notify = false } = {}) {
		generation++;
		const release = releasePollingOwnership;
		releasePollingOwnership = undefined;
		ownershipLifecycle = ownershipLifecycle.then(() => release?.()).catch(() => {});
		clearTimeoutImpl(followerTimer);
		followerTimer = undefined;
		for (const timer of timers.values()) clearTimeoutImpl(timer);
		timers.clear();
		for (const controller of aborters.values()) controller.abort();
		aborters.clear();
		for (const timer of incidentTimers.values()) clearTimeoutImpl(timer);
		incidentTimers.clear();
		for (const controller of incidentAborters.values()) controller.abort();
		incidentAborters.clear();
		if (ticker !== undefined) clearIntervalImpl(ticker);
		ticker = undefined;
		const ctx = activeCtx;
		activeCtx = undefined;
		if (installed && restore) ctx?.ui?.setFooter?.(undefined);
		installed = false;
		if (notify) ctx?.ui?.notify?.("Subscription footer disabled; Pi's built-in footer is restored. Use /reload for another footer extension to reclaim ownership.", "info");
	}

	function install(ctx) {
		if (ctx?.mode !== "tui" || ctx.hasUI === false || !setting().enabled) return false;
		stop({ restore: false });
		activeCtx = ctx;
		installed = true;
		const gen = generation;
		ctx.ui.setFooter((tui, theme) => {
			requestRender = () => tui?.requestRender?.();
			return {
				invalidate() {},
				render(width) {
					const model = renderModelRow(ctx, theme, width, pi?.getThinkingLevel?.());
					return width < MIN_WIDTH ? model : [...model, ...renderQuotaRows(registry, states, theme, width, now())];
				},
				dispose() { if (gen === generation) stop({ restore: false }); },
			};
		});
		void startPolling(gen);
		reconcileIncidents(gen);
		ticker = setIntervalImpl(() => requestRender(), 60_000);
		return true;
	}

	return {
		start: install,
		apply(ctx) {
			if (activeCtx && activeCtx !== ctx) return false;
			if (setting().enabled && activeCtx === ctx) { reconcileIncidents(generation); requestRender(); return true; }
			if (setting().enabled) return install(ctx);
			if (activeCtx === ctx) stop({ notify: true });
			return false;
		},
		shutdown(ctx) { if (activeCtx === ctx) stop(); },
		providers: registry,
		isInstalled: () => installed,
		states,
	};
}

export const SUBSCRIPTION_FOOTER_DEFAULTS = Object.freeze({ enabled: false, incidents: false, ownershipNoticeAcknowledged: false });
