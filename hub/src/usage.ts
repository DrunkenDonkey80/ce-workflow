// Subscription usage (Codex, Claude, Copilot, GLM, Kimi), polled by the hub itself so the page shows it
// with every session parked (D6, D7). Moved from ce-workflow's extensions/subscription-footer.ts: the
// parsers, the Claude pool read and the backoff are unchanged; the terminal footer, its incident markers
// and the cross-process polling lock are gone, because the hub is the single poller.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { piRuntime, piSdk } from "./pi-sdk.ts";
import { agentDir } from "./rpc-client.ts";

const POLL_MS = 120_000;
const CLAUDE_POLL_MS = 1_800_000;
const CLAUDE_UNAVAILABLE_MS = 3_600_000;
const BACKOFF_MS = 360_000;
const MAX_BACKOFF_MS = 3_600_000;
const FETCH_TIMEOUT_MS = 10_000;
const UNAVAILABLE_MS = 600_000;
const POOL_MAX_AGE_MS = 900_000;
const DEFAULT_AGENT_DIR = agentDir();
let poolServed = false;
// Per-account 7d rows for the usage window, refreshed with each pool read.
let poolAccounts: { label: string; left: number; resetsIn?: number; color: string; active: boolean }[] = [];

class QuotaError extends Error {
	[key: string]: any; // untyped JS-style fields
	constructor(category, retryAfterMs = undefined) {
		super(category);
		this.category = category;
		this.retryAfterMs = retryAfterMs;
	}
}

const table = (value) =>
	value && typeof value === "object" && !Array.isArray(value) ? value : {};
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const percent = (value) =>
	finite(value) ? Math.max(0, Math.min(100, value)) : undefined;
const resetTime = (value, _now = undefined) => {
	if (finite(value) && value > 0) return value > 1e12 ? value : value * 1000;
	if (typeof value === "string" && value) {
		const parsed = Date.parse(value);
		return Number.isFinite(parsed) ? parsed : undefined;
	}
	return undefined;
};

function resolvedToken(result) {
	const headers = table(result?.auth?.headers);
	const authorization = Object.entries(headers).find(
		([key]) => key.toLowerCase() === "authorization",
	)?.[1];
	if (typeof authorization === "string" && authorization)
		return authorization.replace(/^Bearer\s+/i, "");
	return typeof result?.auth?.apiKey === "string" && result.auth.apiKey
		? result.auth.apiKey
		: undefined;
}

function authHeaders(result, extras: any = {}, raw = false) {
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

async function requestJson(
	url,
	headers,
	{
		fetchImpl,
		signal,
		timeout = FETCH_TIMEOUT_MS,
		now = Date.now,
		setTimeoutImpl = setTimeout,
		clearTimeoutImpl = clearTimeout,
	},
) {
	const controller = new AbortController();
	const abort = () => controller.abort();
	if (signal?.aborted) abort();
	else signal?.addEventListener?.("abort", abort, { once: true });
	const timer = setTimeoutImpl(abort, timeout);
	try {
		const response = await fetchImpl(url, {
			headers,
			signal: controller.signal,
			redirect: "error",
		});
		if (response.status === 401 || response.status === 403)
			throw new QuotaError("auth rejected");
		if (response.status === 429)
			throw new QuotaError("rate limited", retryAfterMs(response, now()));
		if (!response.ok) throw new QuotaError("unavailable");
		try {
			return await response.json();
		} catch {
			throw new QuotaError("unavailable");
		}
	} catch (error) {
		if (error instanceof QuotaError) throw error;
		throw new QuotaError("unavailable");
	} finally {
		clearTimeoutImpl(timer);
		signal?.removeEventListener?.("abort", abort);
	}
}

function complete(windows) {
	if (
		!Array.isArray(windows) ||
		windows.length === 0 ||
		windows.some(
			(window) =>
				!window ||
				typeof window.id !== "string" ||
				typeof window.label !== "string" ||
				!finite(window.usedPercent) ||
				window.usedPercent < 0 ||
				window.usedPercent > 100 ||
				(window.resetsAt !== undefined && !finite(window.resetsAt)),
		)
	)
		throw new QuotaError("unavailable");
	return windows;
}

function whamWindow(value, fallback, now) {
	if (!value) return undefined;
	if (!finite(value.used_percent)) throw new QuotaError("unavailable");
	const resetsAt =
		resetTime(value.reset_at, now) ??
		(finite(value.reset_after_seconds)
			? now + value.reset_after_seconds * 1000
			: undefined);
	if (!resetsAt) throw new QuotaError("unavailable");
	const id =
		finite(value.limit_window_seconds) && value.limit_window_seconds > 0
			? value.limit_window_seconds <= 21600
				? "5h"
				: "7d"
			: fallback;
	return { id, label: id, usedPercent: percent(value.used_percent), resetsAt };
}

function codexParser(payload, now) {
	const rate = table(payload).rate_limit;
	if (!rate || typeof rate !== "object") throw new QuotaError("unavailable");
	return complete(
		[
			whamWindow(rate.primary_window, "5h", now),
			whamWindow(rate.secondary_window, "7d", now),
		]
			.filter(Boolean)
			.sort((a, b) => Number(b.id === "5h") - Number(a.id === "5h")),
	);
}

function claudeParser(payload) {
	if (!Array.isArray(table(payload).limits)) throw new QuotaError("unavailable");
	const windows = table(payload).limits.map((limit, index) => {
		if (!limit || !finite(limit.percent) || !limit.kind)
			throw new QuotaError("unavailable");
		const resetsAt = resetTime(limit.resets_at);
		if (!resetsAt) throw new QuotaError("unavailable");
		const id =
			limit.kind === "session"
				? "5h"
				: limit.kind === "weekly_all"
					? "7d"
					: `model-${index}`;
		return {
			id,
			label: id.startsWith("model-")
				? (limit.scope?.model?.display_name ?? "model")
				: id,
			usedPercent: percent(limit.percent),
			resetsAt,
		};
	});
	return complete(
		windows.sort((a, b) => Number(b.id === "5h") - Number(a.id === "5h")),
	);
}

// pi-provider-claude-plus ("claude-ex") already polls /api/oauth/usage for the
// whole account pool into a shared 3-minute cache. When it is installed and
// fresh, read that file instead of spending our own request against the same
// per-identity rate budget. One account keeps the plain 5h/7d bars; a pool of
// several shows what is really left and when more arrives (see poolWindows).
function claudePoolQuota({ now, agentDir = DEFAULT_AGENT_DIR }) {
	let windows;
	try {
		const read = (name) => JSON.parse(readFileSync(join(agentDir, name), "utf8"));
		const store = table(read("claude-pool.json"));
		const usage = table(read("claude-pool-usage.json"));
		const accounts = Array.isArray(store.accounts) ? store.accounts.filter(Boolean) : [];
		const labels = accounts.length
			? accounts.filter((a) => !a.dead && !a.disabled).map((a) => a.label)
			: [store.active];
		const entries = labels.map((label) => ({ ...table(usage[label]), label })).filter((e) => finite(e.at));
		const t = now();
		if (!entries.length || t - Math.max(...entries.map((e) => e.at)) > POOL_MAX_AGE_MS)
			throw new QuotaError("unavailable");
		// A window past its reset is empty, whatever the last reading said.
		const used = (w) => {
			const at = resetTime(table(w).resets_at);
			const pct = finite(table(w).pct) ? table(w).pct : undefined;
			return at !== undefined && at <= t ? { pct: 0 } : { pct, at };
		};
		const short = (label) => String(label).replace(/^.*:/, "").replace(/@.*$/, "");
		poolAccounts = entries
			.map((e) => {
				const week = used(e.seven_day);
				const pct = week.pct ?? 100;
				return { label: short(e.label), left: Math.round(100 - pct), resetsIn: week.at === undefined ? undefined : week.at - t, color: quotaColor(pct), active: e.label === store.active };
			})
			.sort((a, b) => (a.resetsIn ?? Infinity) - (b.resetsIn ?? Infinity));
		windows = complete(
			accounts.length > 1
				? poolWindows(store, accounts, entries, used, t)
				: ([
						["5h", used(entries[0].five_hour)],
						["7d", used(entries[0].seven_day)],
					] as [string, any][])
						.filter(([, w]) => finite(w.pct))
						.map(([id, w]) => ({ id, label: id, usedPercent: percent(w.pct), resetsAt: w.at })),
		);
	} catch {
		windows = undefined;
	}
	poolServed = Boolean(windows);
	if (!poolServed) poolAccounts = [];
	return windows;
}

const LOGIN_WARN_MS = 3 * 86_400_000;
const DRAIN_WARN_MS = 86_400_000;

// Tonight's 00:00-08:00 overlap with [from, to): nobody spends quota asleep.
// Mirrors upcomingNightMs in pi-provider-claude-ex/usage.ts.
function upcomingNightMs(from, to) {
	const start = new Date(from);
	if (start.getHours() >= 8) start.setDate(start.getDate() + 1);
	start.setHours(0, 0, 0, 0);
	const end = new Date(start).setHours(8);
	return Math.max(0, Math.min(end, to) - Math.max(start.getTime(), from));
}

// Pool summary, each piece its own segment:
//   ×4(D2) [████░░░░] 47% · 65% in 1d 0h · 82% in 1d 15h · → flex2 · 5h full 47m · 7d: 12h 35m (17%) · ER:2d 12h (flex2)
// The gauge is the average weekly quota left across live accounts; refills show where
// the gauge lands as each account's weekly reset hands back its share. "5h full" only
// when no live account can serve now although weekly room remains. (D2) = dead
// logins (red, need a fresh /login); 7d = soonest account dying within 24h of
// waking time with over 15% unspent, shown as % left (red: drain it); ER = soonest login end
// within 3 days (yellow).
function poolWindows(store, accounts, entries, used, t) {
	const text = (id, value, color = undefined) => ({ id, label: id, usedPercent: 0, text: value, color });
	const week = entries.map((e) => used(e.seven_day)).filter((w) => w.pct !== undefined);
	if (!week.length) throw new QuotaError("unavailable");
	const usedAvg = week.reduce((sum, w) => sum + w.pct, 0) / week.length;
	const dead = accounts.filter((a) => a.dead).length;
	const windows = [
		{
			id: "7d",
			label: "7d",
			usedPercent: percent(usedAvg),
			text: `×${week.length}${dead ? `(D${dead})` : ""} ${bar(100 - usedAvg, 8)} ${Math.round(100 - usedAvg)}%`,
		},
	];
	let refilled = 0;
	for (const [index, w] of week
		.filter((w) => w.pct > 0 && w.at !== undefined)
		.sort((a, b) => a.at - b.at)
		.slice(0, 2)
		.entries()) {
		refilled += w.pct / week.length;
		// usedPercent/resetsAt: the level the pool's 7d refills to and when, drawn as a dotted mark on the bar.
		windows.push({ ...text(`refill-${index}`, `${Math.round(100 - usedAvg + refilled)}% in ${formatDuration(w.at - t)}`), usedPercent: percent(usedAvg - refilled), resetsAt: w.at });
	}
	const short = (label) => String(label).replace(/^.*:/, "").replace(/@.*$/, "");
	const active = typeof store.active === "string" ? store.active : "";
	if (active) windows.push(text("active", `→ ${short(active)}`));
	const serving = entries.map((e) => {
		const five = used(e.five_hour);
		const seven = used(e.seven_day);
		return { free: Math.min(100 - (five.pct ?? 0), 100 - (seven.pct ?? 0)), weekFree: 100 - (seven.pct ?? 0), five };
	});
	if (serving.every((s) => s.free < 5) && serving.some((s) => s.weekFree >= 5)) {
		const next = Math.min(...serving.filter((s) => s.weekFree >= 5 && s.five.at).map((s) => s.five.at));
		windows.push(text("5h-full", `5h full${Number.isFinite(next) ? ` ${formatDuration(next - t)}` : ""}`, "error"));
	}
	// Quota dies at the weekly reset or the login end, whichever comes first;
	// tonight's 00:00-08:00 is not spendable (same rule as the pool's ranking).
	const dying = entries
		.map((e) => {
			const week = used(e.seven_day);
			const login = accounts.find((a) => a.label === e.label)?.refreshExpires;
			const end = Math.min(week.at ?? Infinity, finite(login) ? login : Infinity);
			return { left: end - t - upcomingNightMs(t, end), free: 100 - (week.pct ?? 100) };
		})
		.filter((d) => d.left > 0 && d.left < DRAIN_WARN_MS && d.free > 15)
		.sort((a, b) => a.left - b.left)[0];
	if (dying) windows.push(text("drain", `7d: ${formatDuration(dying.left)} (${Math.round(dying.free)}%)`, "error"));
	const ending = accounts
		.filter((a) => !a.dead && finite(a.refreshExpires) && a.refreshExpires - t < LOGIN_WARN_MS)
		.sort((a, b) => a.refreshExpires - b.refreshExpires)[0];
	if (ending) {
		const left = ending.refreshExpires - t;
		windows.push(text("login", `ER:${left > 0 ? formatDuration(left) : "expired"} (${short(ending.label)})`, "warning"));
	}
	return windows;
}

const bar = (pct, cells) => {
	const filled = Math.round((Math.max(0, Math.min(100, pct)) / 100) * cells);
	return `[${"█".repeat(filled)}${"░".repeat(cells - filled)}]`;
};

function copilotParser(payload) {
	const quota = table(
		table(table(payload).quota_snapshots).premium_interactions,
	);
	if (quota.unlimited === true || !finite(quota.percent_remaining))
		throw new QuotaError("unavailable");
	const resetsAt = resetTime(table(payload).quota_reset_date);
	if (!resetsAt) throw new QuotaError("unavailable");
	return complete([
		{
			id: "mo",
			label: "mo",
			usedPercent: 100 - Math.max(0, Math.min(100, quota.percent_remaining)),
			resetsAt,
		},
	]);
}

function numericValue(value) {
	if (finite(value)) return value;
	if (
		typeof value === "string" &&
		value.trim() &&
		Number.isFinite(Number(value))
	)
		return Number(value);
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
		if (percentage === undefined || typeof limit.type !== "string" || !limit.type)
			continue;
		const number = numericValue(limit.number);
		const unit = numericValue(limit.unit);
		const seconds =
			number === undefined || unit === undefined
				? 0
				: number * (unitSeconds[unit] ?? 0);
		const tokenLimit = limit.type === "TOKENS" || limit.type === "TOKENS_LIMIT";
		const id =
			tokenLimit && seconds > 0 && seconds <= 21600
				? "5h"
				: tokenLimit && seconds > 21600 && seconds <= 604800
					? "7d"
					: undefined;
		if (!id) continue;
		const resetsAt = resetTime(
			numericValue(limit.nextResetTime) ?? limit.nextResetTime,
		);
		if (!resetsAt && !(id === "5h" && unit === 3 && number === 5)) continue;
		windows.push({
			id: `${id}-${index}`,
			label: id,
			usedPercent: percent(percentage),
			...(resetsAt ? { resetsAt } : {}),
		});
	}
	return complete(windows.sort((a, b) => order[a.label] - order[b.label]));
}

function kimiRow(data, window, fallback, now, index) {
	const limit = numericValue(data.limit);
	let used = numericValue(data.used);
	if (
		used === undefined &&
		numericValue(data.remaining) !== undefined &&
		limit !== undefined
	)
		used = limit - numericValue(data.remaining);
	if (used === undefined || limit === undefined || limit <= 0)
		throw new QuotaError("unavailable");
	let resetsAt;
	for (const key of ["reset_at", "resetAt", "reset_time", "resetTime"])
		if (!resetsAt) resetsAt = resetTime(data[key]);
	for (const key of ["reset_in", "resetIn", "ttl"])
		if (!resetsAt && numericValue(data[key]) > 0)
			resetsAt = now + numericValue(data[key]) * 1000;
	if (!resetsAt) throw new QuotaError("unavailable");
	let label = fallback;
	const duration = numericValue(window.duration ?? data.duration);
	if (duration > 0) {
		const unit = String(window.timeUnit ?? data.timeUnit ?? "");
		const multiplier = unit.includes("MINUTE")
			? 60
			: unit.includes("HOUR")
				? 3600
				: unit.includes("DAY")
					? 86400
					: unit.includes("WEEK")
						? 604800
						: unit.includes("MONTH")
							? 2592000
							: 1;
		const seconds = duration * multiplier;
		label = seconds <= 21600 ? "5h" : seconds <= 604800 ? "7d" : "mo";
	}
	return {
		id: `${label}-${index}`,
		label,
		usedPercent: percent((used / limit) * 100),
		resetsAt,
	};
}

function kimiParser(payload, now) {
	const root = table(table(payload).data ?? payload);
	const rows = [];
	if (root.usage && typeof root.usage === "object")
		rows.push(kimiRow(table(root.usage), {}, "7d", now, rows.length));
	if (Array.isArray(root.limits))
		for (const item of root.limits) {
			const row = table(item);
			rows.push(
				kimiRow(
					table(row.detail ?? row),
					table(row.window),
					"7d",
					now,
					rows.length,
				),
			);
		}
	return complete(
		rows.sort((a, b) => Number(b.label === "5h") - Number(a.label === "5h")),
	);
}

function provider({
	id,
	label,
	piProviderId,
	url,
	parser,
	headers,
	preferred = undefined,
	pollMs = POLL_MS,
	unavailableMs = UNAVAILABLE_MS,
}) {
	return Object.freeze({
		id,
		label,
		piProviderId,
		pollMs,
		unavailableMs,
		async fetchQuota(auth, options) {
			const reused = await preferred?.(options);
			if (reused) return reused;
			const payload = await requestJson(url, headers(auth), options);
			return parser(payload, options.now());
		},
	});
}

export const PRODUCTION_PROVIDERS = Object.freeze([
	provider({
		id: "codex",
		label: "Codex",
		piProviderId: "openai-codex",
		url: "https://chatgpt.com/backend-api/wham/usage",
		parser: codexParser,
		headers: (auth) => {
			const headers = authHeaders(auth, { "user-agent": "codex-cli" });
			const source = table(auth?.auth?.headers);
			for (const [key, value] of Object.entries(source))
				if (key.toLowerCase() === "chatgpt-account-id")
					headers["chatgpt-account-id"] = value;
			return headers;
		},
	}),
	// Poll at the normal cadence while the pool cache serves us (a file read costs
	// nothing); fall back to the slow, rate-limited direct cadence otherwise.
	Object.freeze({
		...provider({
			id: "claude",
			label: "Claude",
			piProviderId: "anthropic",
			url: "https://api.anthropic.com/api/oauth/usage",
			parser: claudeParser,
			headers: (auth) =>
				authHeaders(auth, { "anthropic-beta": "oauth-2025-04-20" }),
			preferred: claudePoolQuota,
			unavailableMs: CLAUDE_UNAVAILABLE_MS,
		}),
		get pollMs() {
			return poolServed ? POLL_MS : CLAUDE_POLL_MS;
		},
	}),
	provider({
		id: "copilot",
		label: "Copilot",
		piProviderId: "github-copilot",
		url: "https://api.github.com/copilot_internal/user",
		parser: copilotParser,
		headers: (auth) =>
			authHeaders(auth, { "user-agent": "ce-workflow-subscription-footer" }),
	}),
	provider({
		id: "glm",
		label: "GLM/Z.ai",
		piProviderId: "zai",
		url: "https://api.z.ai/api/monitor/usage/quota/limit",
		parser: glmParser,
		headers: (auth) => authHeaders(auth, {}, true),
	}),
	provider({
		id: "kimi",
		label: "Kimi",
		piProviderId: "kimi-coding",
		url: "https://api.kimi.com/coding/v1/usages",
		parser: kimiParser,
		headers: (auth) =>
			authHeaders(auth, { "user-agent": "ce-workflow-subscription-footer" }),
	}),
]);

function authIdentity(result) {
	const headers = table(result?.auth?.headers);
	const stable = Object.entries(headers).find(
		([key, value]) =>
			/(?:account|user)[-_]?id/i.test(key) && typeof value === "string",
	)?.[1];
	const token = resolvedToken(result);
	if (!token) throw new QuotaError("auth rejected");
	let claim;
	try {
		const payload = JSON.parse(
			Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"),
		);
		claim = payload.account_id ?? payload.sub;
	} catch { /* Not a JWT: no account claim. */ }
	return createHash("sha256")
		.update(String(stable ?? claim ?? JSON.stringify(result.auth)))
		.digest("hex");
}

function storedAuth(result) {
	return result &&
		(result.source === "OAuth" || result.source === "stored credential") &&
		resolvedToken(result)
		? result
		: undefined;
}

// Claude pool accounts, soonest weekly reset first: "→ flex2 81% 4d 18h".
export function poolAccountLines() {
	return poolAccounts.map((a) => ({ text: `${a.active ? "→ " : ""}${a.label} ${a.left}%${a.resetsIn === undefined ? "" : ` ${formatDuration(a.resetsIn)}`}`, color: a.color }));
}

function formatDuration(ms) {
	const minutes = Math.max(0, Math.ceil(ms / 60000));
	const days = Math.floor(minutes / 1440);
	const hours = Math.floor((minutes % 1440) / 60);
	return days ? `${days}d ${hours}h` : `${hours}h ${minutes % 60}m`;
}

function quotaColor(value) {
	return value > 80 ? "error" : value > 50 ? "warning" : "text";
}

// Local reset moment for windows longer than 5h: weekday within a week, else day.month ("Tue 12:35", "3.11 12:35").
// Built by hand: some locales add separators/suffixes ("пн, 10:00 ч.").
export function resetMoment(resetsAt, now) {
	const date = new Date(resetsAt);
	const day = resetsAt - now < 6.5 * 86_400_000
		? date.toLocaleDateString(undefined, { weekday: "short" }).replace(/\.$/, "")
		: `${date.getDate()}.${String(date.getMonth() + 1).padStart(2, "0")}`;
	const pad = (value) => String(value).padStart(2, "0");
	return `${day.charAt(0).toUpperCase()}${day.slice(1)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}


type Auth = { auth?: { apiKey?: string; headers?: Record<string, string> }; source?: string } | undefined;
type Window = { id: string; label: string; usedPercent: number; resetsAt?: number; text?: string; color?: string };
type State = { authenticated: boolean; identityKey?: string; windows?: Window[]; fetchedAt?: number; failure?: string; failureCount?: number };

/** Provider credentials from Pi's own SDK (D14): same auth.json, refresh and lock as a running Pi. */
export async function piAuth(dir = agentDir()): Promise<(provider: string) => Promise<Auth>> {
	const registry = new (await piSdk(dir)).ModelRegistry(await piRuntime(dir));
	return provider => registry.getProviderAuth(provider);
}

export type UsageOptions = {
	dataDir: string;
	/** Provider ids (codex, claude, ...) treated as logged out. */
	hidden?: () => string[];
	auth?: () => Promise<(provider: string) => Promise<Auth>>;
	providers?: readonly any[];
	fetchImpl?: typeof fetch;
	now?: () => number;
	agentDir?: string;
};

/** The hub's one usage poller; usage() is the page's /api/usage JSON (no secrets: identities are hashes and never leave). */
export function createUsage({ dataDir, hidden = () => [], auth = () => piAuth(), providers = PRODUCTION_PROVIDERS, fetchImpl = globalThis.fetch, now = Date.now, agentDir: dir = DEFAULT_AGENT_DIR }: UsageOptions) {
	const states = new Map<string, State>(providers.map(entry => [entry.id, { authenticated: false }]));
	const timers = new Map<string, NodeJS.Timeout>();
	const aborters = new Map<string, AbortController>();
	// Bump the version whenever the cached window shape changes: an older hub's cache would hide new fields (refill marks) for up to 30 min.
	const cacheFile = join(dataDir, "usage-cache.json");
	let cache: { version: 2; providers: Record<string, { identityKey: string; fetchedAt: number; windows: Window[] }> } = { version: 2, providers: {} };
	let resolver: Promise<(provider: string) => Promise<Auth>> | undefined;
	let stopped = true, sdkLogged = false;
	const isHidden = (entry: { id: string }) => hidden().includes(entry.id);

	async function loadCache() {
		try {
			const value = JSON.parse(await readFile(cacheFile, "utf8"));
			if (value?.version === 2 && value.providers && typeof value.providers === "object") cache = value;
		} catch { /* Missing or corrupt cache: start empty. */ }
	}
	let saving = Promise.resolve();
	function saveCache() {
		saving = saving.then(async () => {
			try {
				await mkdir(dataDir, { recursive: true });
				const temporary = `${cacheFile}.${process.pid}.tmp`;
				await writeFile(temporary, JSON.stringify(cache));
				await rename(temporary, cacheFile);
			} catch { /* Optional: quotas refetch next poll. */ }
		});
	}
	function schedule(entry: { id: string }, delay: number) {
		if (stopped) return;
		clearTimeout(timers.get(entry.id));
		const timer = setTimeout(() => void refresh(entry), delay); timer.unref();
		timers.set(entry.id, timer);
	}

	async function refresh(entry: any) {
		if (stopped) return;
		const state = states.get(entry.id)!;
		let resolved: Auth;
		if (!isHidden(entry)) try {
			resolver ??= auth().catch(error => { resolver = undefined; throw error; });
			resolved = storedAuth(await (await resolver)(entry.piProviderId));
		} catch (error) {
			// No stored auth shows as logged out; a missing SDK hides every provider, so say why once.
			if (!sdkLogged && /Pi SDK/.test((error as Error)?.message ?? "")) { sdkLogged = true; console.error(`usage: ${(error as Error).message}`); }
		}
		if (stopped) return;
		if (!resolved) {
			// Logout (or hidden): forget the snapshot; a later login is checked on the next poll.
			Object.assign(state, { authenticated: false, identityKey: undefined, windows: undefined, fetchedAt: undefined, failure: undefined });
			return schedule(entry, POLL_MS);
		}
		const identityKey = authIdentity(resolved);
		if (state.identityKey !== identityKey) {
			// Account switch: never show the previous account's numbers.
			Object.assign(state, { identityKey, windows: undefined, fetchedAt: undefined, failure: undefined, failureCount: 0 });
			if (cache.providers[entry.id] && cache.providers[entry.id].identityKey !== identityKey) { delete cache.providers[entry.id]; saveCache(); }
		}
		state.authenticated = true;
		const cached = cache.providers[entry.id];
		if (!state.windows && cached?.identityKey === identityKey) {
			try { state.windows = complete(cached.windows); state.fetchedAt = cached.fetchedAt; } catch { /* Corrupt cache entry: fetch fresh. */ }
		}
		const pollMs = entry.pollMs ?? POLL_MS;
		const age = state.fetchedAt === undefined ? Infinity : Math.max(0, now() - state.fetchedAt);
		if (age < pollMs) return schedule(entry, pollMs - age);
		const controller = new AbortController();
		aborters.get(entry.id)?.abort(); aborters.set(entry.id, controller);
		try {
			const windows = complete(await entry.fetchQuota(resolved, { fetchImpl, signal: controller.signal, now, agentDir: dir }));
			if (stopped || controller.signal.aborted) return;
			Object.assign(state, { windows, fetchedAt: now(), failure: undefined, failureCount: 0 });
			cache.providers[entry.id] = { identityKey, fetchedAt: state.fetchedAt!, windows };
			saveCache();
			schedule(entry, pollMs);
		} catch (error) {
			if (stopped || controller.signal.aborted) return;
			state.failure = error instanceof QuotaError ? error.category : "unavailable";
			state.failureCount = (state.failureCount ?? 0) + 1;
			const backoff = Math.min(MAX_BACKOFF_MS, BACKOFF_MS * 2 ** (state.failureCount - 1));
			const retry = Math.min(MAX_BACKOFF_MS, error instanceof QuotaError ? (error.retryAfterMs ?? 0) : 0);
			schedule(entry, Math.max(backoff, retry, pollMs));
		} finally {
			if (aborters.get(entry.id) === controller) aborters.delete(entry.id);
		}
	}

	return {
		states,
		async start() {
			if (!stopped) return;
			stopped = false;
			await loadCache();
			await Promise.all(providers.map(entry => refresh(entry)));
		},
		/** Resolves after the pending cache write. */
		flush: () => saving,
		stop() {
			stopped = true;
			for (const timer of timers.values()) clearTimeout(timer);
			timers.clear();
			for (const controller of aborters.values()) controller.abort();
			aborters.clear();
		},
		/** Re-check every provider now (settings changed, or the page asked); keeps the poll cadence otherwise. */
		refresh: () => Promise.all(providers.map(entry => refresh(entry))),
		/** The page's status bars and usage window: 7d left per shown provider, each window as a bar, warnings in words. */
		usage() {
			const at = now();
			const summary = providers.filter(entry => !isHidden(entry)).flatMap(entry => {
				const windows = states.get(entry.id)?.windows ?? [];
				// The headline: the week, else the month (Copilot), else the first quota window; labels, since GLM/Kimi ids carry an index.
				const quota = windows.filter(w => w.text === undefined), week = windows.find(w => w.label === "7d") ?? quota.find(w => w.label === "mo") ?? quota[0];
				// A served Claude pool rotates accounts, so its 7d has no single reset time.
				const resets = week?.resetsAt && !(entry.id === "claude" && poolAccounts.length) ? formatDuration(week.resetsAt - at) : undefined;
				const bars = windows.filter(w => w.text === undefined || w === week).map(w => ({
					label: w.label, left: Math.round(100 - w.usedPercent), color: quotaColor(w.usedPercent),
					resets: w.resetsAt ? formatDuration(w.resetsAt - at) : undefined,
					at: w.resetsAt && w.label !== "5h" ? resetMoment(w.resetsAt, at) : undefined,
				}));
				const words = (w: Window) => w.id === "drain" ? w.text!.replace(/^7d: (.*) \((\d+%)\)$/, "expiring in $1 ($2 unused)")
					: w.id === "login" ? w.text!.replace(/^ER:expired/, "login expired").replace(/^ER:/, "login ends in ")
					: w.id === "5h-full" ? w.text!.replace(/^5h full (.+)$/, "5h full, frees in $1") : w.text!;
				const text = windows.filter(w => w.text !== undefined && w !== week);
				const warnings = text.filter(w => w.color).map(w => ({ text: words(w), color: w.color }));
				// Refills within 48 h become marks on the 7d bar; the active account shows as the pool's "→" row.
				const soon = text.filter(w => w.id.startsWith("refill-") && w.resetsAt && w.resetsAt > at && w.resetsAt - at <= 48 * 3_600_000)
					.map(w => ({ left: Math.round(100 - w.usedPercent), in: formatDuration(w.resetsAt! - at) }));
				const notes = text.filter(w => !w.color && !w.id.startsWith("refill-") && w.id !== "active").map(w => w.text);
				return week ? [{ id: entry.id, label: entry.label, window: week.label, left: Math.round(100 - week.usedPercent), color: quotaColor(week.usedPercent), resets, bars, warnings, notes, soon }] : [];
			});
			return { summary, accounts: hidden().includes("claude") ? [] : poolAccountLines() };
		},
	};
}
export type Usage = ReturnType<typeof createUsage>;
export const USAGE_PROVIDERS = PRODUCTION_PROVIDERS.map(entry => ({ id: entry.id as string, label: entry.label as string }));
