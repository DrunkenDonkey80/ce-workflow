// S-09: provider parsers, the Claude pool cache and sanitized failures, moved with the code from
// ce-workflow's subscription footer (extensions/subscription-footer.ts) to hub/src/usage.ts.
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PRODUCTION_PROVIDERS, poolAccountLines, resetMoment } from "../src/usage.ts";

const jsonResponse = (payload, status = 200, headers = {}) => ({ ok: status >= 200 && status < 300, status, headers: { get: (name) => headers[name.toLowerCase()] }, json: async () => payload });
const stored = (key, headers) => ({ source: "stored credential", auth: { apiKey: key, headers } });
// Production capability registry is fixed and each pinned payload maps to common windows.
assert.deepEqual(
	PRODUCTION_PROVIDERS.map((provider) => [
		provider.label,
		provider.piProviderId,
	]),
	[
		["Codex", "openai-codex"],
		["Claude", "anthropic"],
		["Copilot", "github-copilot"],
		["GLM/Z.ai", "zai"],
		["Kimi", "kimi-coding"],
	],
);
const claudeProvider = PRODUCTION_PROVIDERS.find(
	(provider) => provider.id === "claude",
);
assert.equal(
	claudeProvider.pollMs,
	1_800_000,
	"Claude quota is polled every 30 minutes",
);

// pi-provider-claude-plus pool cache is reused instead of a second /oauth/usage request.
const poolDir = await mkdtemp(join(tmpdir(), "footer-pool-"));
const writePool = async (at) => {
	await writeFile(
		join(poolDir, "claude-pool.json"),
		JSON.stringify({ active: "acct" }),
	);
	await writeFile(
		join(poolDir, "claude-pool-usage.json"),
		JSON.stringify({
			acct: {
				at,
				five_hour: { pct: 12, resets_at: "2034-01-01T00:00:00Z" },
				seven_day: { pct: 40 },
			},
		}),
	);
};
const poolFetch = (dir) =>
	claudeProvider.fetchQuota(stored("pool-token"), {
		agentDir: dir,
		signal: new AbortController().signal,
		now: () => 2_000_000_000_000,
		fetchImpl: async () =>
			jsonResponse({
				limits: [
					{ kind: "session", percent: 99, resets_at: "2027-01-01T00:00:00Z" },
				],
			}),
	});
await writePool(2_000_000_000_000 - 60_000);
assert.deepEqual(
	(await poolFetch(poolDir)).map((window) => [window.label, window.usedPercent]),
	[
		["5h", 12],
		["7d", 40],
	],
	"fresh pool cache is served without a request",
);
// Several accounts: weekly room left across live ones, the next refills, and
// split alerts: D = dead logins (red), ! = soonest login end within 3 days (yellow).
const T = 2_000_000_000_000;
const iso = (ms) => new Date(T + ms).toISOString();
const writeMulti = async (accounts, usageRows) => {
	await writeFile(join(poolDir, "claude-pool.json"), JSON.stringify({ active: "datecs:a", accounts }));
	await writeFile(join(poolDir, "claude-pool-usage.json"), JSON.stringify(usageRows));
};
await writeMulti(
	[
		{ label: "datecs:a" },
		{ label: "b@x.bg", refreshExpires: T + 2.5 * 86_400_000 },
		{ label: "c", refreshExpires: T + 9 * 86_400_000 },
		{ label: "gone", dead: true, refreshExpires: T - 1 },
	],
	{
		"datecs:a": { at: T - 60_000, five_hour: { pct: 60, resets_at: iso(3_600_000) }, seven_day: { pct: 90, resets_at: iso(7_200_000) } },
		"b@x.bg": { at: T - 600_000, five_hour: { pct: 30, resets_at: iso(-1) }, seven_day: { pct: 30, resets_at: iso(2 * 86_400_000) } },
		c: { at: T - 600_000, five_hour: { pct: 0 }, seven_day: { pct: 60, resets_at: iso(-1) } },
		gone: { at: T, five_hour: { pct: 100, resets_at: iso(1) }, seven_day: { pct: 100 } },
	},
);
const pool = await poolFetch(poolDir);
assert.deepEqual(
	pool.map((w) => [w.text, w.color]),
	[
		["×3(D1) [█████░░░] 60%", undefined],
		["90% in 2h 0m", undefined],
		["100% in 2d 0h", undefined],
		["→ a", undefined],
		["ER:2d 12h (b)", "warning"],
	],
	"pool: weekly room averaged over live accounts (passed resets count empty), running refill totals, active, dead count beside the size, login alert",
);
assert.equal(pool[0].usedPercent, 40, "the main bar is coloured by pool usage");
assert.deepEqual(
	poolAccountLines(),
	[
		{ text: "\u2192 a 10% 2h 0m", color: "error" },
		{ text: "b 70% 2d 0h", color: "text" },
		{ text: "c 100%", color: "text" },
	],
	"browser popup lists live accounts by soonest weekly reset; a passed reset reads full with no countdown",
);
// An account dying within 24h of waking time with over 15% unspent is called
// out in red; tonight's hours are removed, so only the shape is timezone-proof.
await writeMulti(
	[{ label: "datecs:a" }, { label: "low", refreshExpires: T + 86_400_000 }],
	{
		"datecs:a": { at: T, five_hour: { pct: 0 }, seven_day: { pct: 10, resets_at: iso(3 * 86_400_000) } },
		low: { at: T, five_hour: { pct: 0 }, seven_day: { pct: 83, resets_at: iso(12 * 3_600_000) } },
	},
);
const drain = (await poolFetch(poolDir)).find((w) => w.id === "drain");
assert.match(drain?.text ?? "", /^7d: \d+h \d+m \(17%\)$/, "soonest dying account with >15% left");
assert.equal(drain.color, "error");
await writeMulti(
	[{ label: "a" }, { label: "b" }],
	{
		a: { at: T, five_hour: { pct: 100, resets_at: iso(47 * 60_000) }, seven_day: { pct: 50, resets_at: iso(86_400_000) } },
		b: { at: T, five_hour: { pct: 98, resets_at: iso(90 * 60_000) }, seven_day: { pct: 100, resets_at: iso(3_600_000) } },
	},
);
assert.deepEqual(
	(await poolFetch(poolDir)).filter((w) => w.id === "5h-full").map((w) => [w.text, w.color]),
	[["5h full 0h 47m", "error"]],
	"5h is flagged only when it is what blocks the pool, timed to the nearest 5h reset with weekly room",
);
assert.equal(
	claudeProvider.pollMs,
	120_000,
	"pool-backed quota polls at the normal cadence",
);
await writePool(2_000_000_000_000 - 3_600_000);
assert.deepEqual(
	(await poolFetch(poolDir)).map((window) => window.usedPercent),
	[99],
	"stale pool cache falls back to the direct poll",
);
assert.equal(
	claudeProvider.pollMs,
	1_800_000,
	"direct polling keeps the slow cadence",
);
assert.deepEqual(
	(await poolFetch(join(poolDir, "missing"))).map(
		(window) => window.usedPercent,
	),
	[99],
	"no pool installed falls back to the direct poll",
);
await rm(poolDir, { recursive: true, force: true });
assert.equal(
	claudeProvider.unavailableMs,
	3_600_000,
	"Claude cache survives one failed poll for another 30 minutes",
);
const now = () => 1_800_000_000_000;
const reset = now() + 3_600_000;
const payloads = {
	"chatgpt.com": {
		rate_limit: {
			primary_window: {
				used_percent: 70,
				limit_window_seconds: 604800,
				reset_at: reset / 1000,
			},
			secondary_window: {
				used_percent: 20,
				limit_window_seconds: 18000,
				reset_after_seconds: 3600,
			},
		},
	},
	"anthropic.com": {
		limits: [
			{
				kind: "weekly_all",
				percent: 55,
				resets_at: new Date(reset).toISOString(),
			},
			{ kind: "session", percent: 15, resets_at: new Date(reset).toISOString() },
			{
				kind: "weekly_model",
				percent: 30,
				resets_at: new Date(reset).toISOString(),
				scope: { model: { display_name: "Opus" } },
			},
		],
	},
	"github.com": {
		quota_reset_date: "2027-01-01",
		quota_snapshots: {
			premium_interactions: { percent_remaining: 72, unlimited: false },
		},
	},
	"z.ai": {
		data: {
			limits: [
				{
					type: "TOKENS",
					unit: 3,
					number: 5,
					percentage: 25,
					nextResetTime: reset,
				},
				{
					type: "TOKENS",
					unit: 6,
					number: 1,
					percentage: 45,
					nextResetTime: reset,
				},
				{ type: "TIME_LIMIT", percentage: 65, nextResetTime: reset },
			],
		},
	},
	"kimi.com": {
		data: {
			usage: { used: "2", limit: "10", reset_in: 3600 },
			limits: [
				{
					detail: { remaining: 6, limit: 10, resetAt: reset },
					window: { duration: 5, timeUnit: "HOUR" },
				},
			],
		},
	},
};
for (const provider of PRODUCTION_PROVIDERS) {
	const host = Object.keys(payloads).find((part) =>
		provider.id === "codex"
			? part === "chatgpt.com"
			: provider.id === "claude"
				? part === "anthropic.com"
				: provider.id === "copilot"
					? part === "github.com"
					: provider.id === "glm"
						? part === "z.ai"
						: part === "kimi.com",
	);
	let requested;
	let requestOptions;
	const windows = await provider.fetchQuota(stored("fixture-token"), {
		fetchImpl: async (url, options) => {
			requested = url;
			requestOptions = options;
			return jsonResponse(payloads[host]);
		},
		signal: new AbortController().signal,
		now,
	});
	assert.ok(requested.startsWith("https://"));
	assert.ok(
		windows.length >= 1 &&
			windows.every((window) => Number.isFinite(window.usedPercent)),
	);
	if (provider.id === "codex")
		assert.deepEqual(
			windows.map((window) => window.label),
			["5h", "7d"],
			"Codex duration order",
		);
	if (provider.id === "claude")
		assert.deepEqual(
			windows.map((window) => window.label),
			["5h", "7d", "Opus"],
			"Claude model windows",
		);
	if (provider.id === "copilot")
		assert.equal(
			windows[0].usedPercent,
			28,
			"Copilot remaining converts to used",
		);
	if (provider.id === "glm") {
		assert.equal(provider.piProviderId, "zai");
		assert.equal(requested, "https://api.z.ai/api/monitor/usage/quota/limit");
		assert.equal(
			requestOptions.headers.authorization,
			"fixture-token",
			"GLM uses the raw authorization token",
		);
		assert.deepEqual(
			windows.map((window) => window.label),
			["5h", "7d"],
			"GLM token units map and monthly tools stay excluded",
		);
	}
	if (provider.id === "kimi")
		assert.deepEqual(
			windows.map((window) => window.label),
			["5h", "7d"],
			"Kimi variants map",
		);
}

const glm = PRODUCTION_PROVIDERS.find((provider) => provider.id === "glm");
const glmFetch = (payload) =>
	glm.fetchQuota(stored("glm-token"), {
		fetchImpl: async () => jsonResponse(payload),
		signal: new AbortController().signal,
		now,
	});
const mixedGlm = await glmFetch({
	success: true,
	data: {
		limits: [
			{ type: "TIME_LIMIT", percentage: 60, nextResetTime: reset },
			null,
			{ type: "TOKENS", unit: 6, number: 1, percentage: 40, nextResetTime: reset },
			{
				type: "TOKENS",
				unit: "3",
				number: "5",
				percentage: "20",
				nextResetTime: String(reset),
			},
			{
				type: "TOKENS",
				unit: 3,
				number: 5,
				percentage: null,
				nextResetTime: reset,
			},
			{
				type: "TOKENS",
				unit: 99,
				number: 1,
				percentage: 80,
				nextResetTime: reset,
			},
		],
	},
});
assert.deepEqual(
	mixedGlm.map((window) => window.label),
	["5h", "7d"],
	"GLM accepts numeric strings, skips unusable/monthly rows, and preserves stable token-window order",
);
const resetlessGlm = await glmFetch({
	success: true,
	data: {
		limits: [
			{ type: "TOKENS_LIMIT", unit: "3", number: "5", percentage: "17" },
			{
				type: "TOKENS",
				unit: "6",
				number: "1",
				percentage: "42",
				nextResetTime: String(reset),
			},
			{ type: "TIME_LIMIT", percentage: "63", nextResetTime: String(reset) },
		],
	},
});
assert.deepEqual(
	resetlessGlm.map((window) => window.label),
	["5h", "7d"],
);
assert.equal(
	resetlessGlm[0].resetsAt,
	undefined,
	"explicit 5h session survives without a countdown",
);
const weeklyMonthlyGlm = await glmFetch({
	success: true,
	data: {
		limits: [
			{ type: "TOKENS", unit: 6, number: 1, percentage: 42, nextResetTime: reset },
			{ type: "TIME_LIMIT", percentage: 63, nextResetTime: reset },
			{
				type: "PLAN_METADATA",
				unit: 3,
				number: 5,
				percentage: 9,
				nextResetTime: reset,
			},
		],
	},
});
assert.deepEqual(
	weeklyMonthlyGlm.map((window) => window.label),
	["7d"],
	"weekly/monthly rows do not publish tools or fabricate a 5h window from unknown types",
);
await assert.rejects(
	() =>
		glmFetch({
			success: true,
			data: { limits: [{ type: "UNKNOWN", unit: 3, number: 5, percentage: 20 }] },
		}),
	(error) => error.message === "unavailable",
	"unknown type is not promoted to a resetless session",
);
await assert.rejects(
	() =>
		glmFetch({
			success: true,
			data: {
				limits: [
					null,
					{
						type: "TOKENS",
						unit: "",
						number: "5",
						percentage: "20",
						nextResetTime: String(reset),
					},
					{
						type: "TOKENS",
						unit: "3",
						number: "Infinity",
						percentage: "20",
						nextResetTime: String(reset),
					},
					{
						type: "TOKENS",
						unit: "3",
						number: "5",
						percentage: "",
						nextResetTime: String(reset),
					},
				],
			},
		}),
	(error) => error.message === "unavailable",
);
await assert.rejects(
	() =>
		glmFetch({
			success: false,
			message: "SENTINEL-PRIVATE-VENDOR-BODY",
			data: { limits: payloads["z.ai"].data.limits },
		}),
	(error) =>
		error.message === "unavailable" && !error.message.includes("SENTINEL"),
	"HTTP-200 GLM failure envelope is sanitized",
);


// Weekly reset moments: beyond a week shows the date.
assert.notEqual(resetMoment(now() + 20 * 86_400_000, now()), resetMoment(now() + 13 * 86_400_000, now()));

// Sanitized HTTP categories never parse or retain response bodies.
for (const [status, category] of [
	[401, "auth rejected"],
	[429, "rate limited"],
	[500, "unavailable"],
]) {
	const provider = PRODUCTION_PROVIDERS[0];
	await assert.rejects(
		() =>
			provider.fetchQuota(stored("not-rendered"), {
				fetchImpl: async () => ({
					ok: false,
					status,
					json: async () => ({ body: "SENTINEL-SECRET" }),
				}),
				signal: new AbortController().signal,
				now,
			}),
		(error) => error.message === category && !error.message.includes("SENTINEL"),
	);
}

console.log("usage providers ok");
