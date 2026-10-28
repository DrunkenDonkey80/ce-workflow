// S-07: the hub's own usage poller (no Pi sessions): identity-bound cache, logout, account switch,
// rejected (expired) credentials with backoff, hidden providers, secret-free JSON.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createUsage } from "../src/usage.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hub-usage-"));
const jwt = account => `x.${Buffer.from(JSON.stringify({ account_id: account })).toString("base64url")}.y`;
let credential = { auth: { apiKey: jwt("alice") }, source: "OAuth" }, status = 200, used = 25, calls = 0;
const fetchImpl = async (_url, { headers }) => {
	calls++;
	assert.match(headers.authorization, /^Bearer x\./);
	return { status, ok: status === 200, headers: { get: () => null }, json: async () => ({ rate_limit: { primary_window: { used_percent: 10, reset_after_seconds: 3600, limit_window_seconds: 18000 }, secondary_window: { used_percent: used, reset_after_seconds: 86400, limit_window_seconds: 604800 } } }) };
};
let hidden = [];
const codexOnly = (await import("../src/usage.ts")).USAGE_PROVIDERS.length > 1; // the production list includes Codex
assert(codexOnly);
const make = () => createUsage({ dataDir: root, agentDir: root, hidden: () => hidden, fetchImpl, auth: async () => async provider => provider === "openai-codex" ? credential : undefined });

try {
	let usage = make();
	await usage.start();
	let summary = usage.usage().summary;
	assert.deepEqual(summary.map(s => [s.id, s.left]), [["codex", 75]], "only the logged-in provider shows");
	assert.deepEqual(summary[0].bars.map(b => [b.label, b.left]), [["5h", 90], ["7d", 75]]);
	assert(!JSON.stringify(usage.usage()).includes(credential.auth.apiKey), "no credential in the page JSON");
	await usage.flush();
	assert(!fs.readFileSync(path.join(root, "usage-cache.json"), "utf8").includes(credential.auth.apiKey), "no credential in the cache");
	usage.stop();

	// A restarted hub serves the cached reading for the same account without a request.
	const before = calls; usage = make(); await usage.start();
	assert.equal(calls, before, "fresh cache, same identity: no refetch");
	assert.equal(usage.usage().summary[0].left, 75);

	// Account switch: the old numbers are never shown for the new account.
	credential = { auth: { apiKey: jwt("bob") }, source: "OAuth" }; used = 60;
	await usage.refresh();
	assert.equal(usage.usage().summary[0].left, 40);
	assert.equal(calls, before + 1);

	// Expired or revoked token (401): the reading is kept with a failure; backoff, no crash.
	credential = { auth: { apiKey: jwt("carol") }, source: "OAuth" }; status = 401;
	await usage.refresh();
	assert.deepEqual(usage.usage().summary, [], "a new identity whose fetch fails shows nothing old");
	assert.equal(usage.states.get("codex").failure, "auth rejected");

	// Logout: the provider disappears.
	status = 200; credential = undefined;
	await usage.refresh();
	assert.equal(usage.states.get("codex").authenticated, false);
	assert.deepEqual(usage.usage().summary, []);

	// Hidden: not polled and not shown.
	credential = { auth: { apiKey: jwt("bob") }, source: "OAuth" }; hidden = ["codex"];
	const hiddenCalls = calls; await usage.refresh();
	assert.equal(calls, hiddenCalls); assert.deepEqual(usage.usage().summary, []);
	usage.stop();

	// No SDK (auth resolver throws): everything logged out, nothing thrown.
	usage = createUsage({ dataDir: root, agentDir: root, fetchImpl, auth: async () => { throw new Error("no Pi SDK"); } });
	await usage.start(); assert.deepEqual(usage.usage(), { summary: [], accounts: [] }); usage.stop();

	// A Claude token that lapsed while no session used Claude still shows a fresh pool reading.
	const week = { pct: 30, resets_at: new Date(Date.now() + 86_400_000).toISOString() };
	fs.writeFileSync(path.join(root, "claude-pool.json"), JSON.stringify({ active: "a", accounts: [{ label: "a" }] }));
	fs.writeFileSync(path.join(root, "claude-pool-usage.json"), JSON.stringify({ a: { at: Date.now(), five_hour: { pct: 10, resets_at: week.resets_at }, seven_day: week } }));
	usage = createUsage({ dataDir: root, agentDir: root, fetchImpl, auth: async () => async () => undefined });
	await usage.start(); assert.deepEqual(usage.usage().summary.map(s => [s.id, s.left]), [["claude", 70]]); usage.stop();
	fs.rmSync(path.join(root, "claude-pool-usage.json"));

	// Issue #5: GLM/Kimi ids carry an index and Copilot has only a month, yet each shows; the headline window is named.
	const at = Date.now() + 3_600_000, fake = (id, windows) => ({ id, label: id, piProviderId: id, fetchQuota: async () => windows });
	usage = createUsage({ dataDir: root, agentDir: root, fetchImpl, auth: async () => async () => credential, providers: [
		fake("glm", [{ id: "5h-0", label: "5h", usedPercent: 10, resetsAt: at }, { id: "7d-1", label: "7d", usedPercent: 30, resetsAt: at }]),
		fake("copilot", [{ id: "mo", label: "mo", usedPercent: 50, resetsAt: at }]),
	] });
	await usage.start();
	assert.deepEqual(usage.usage().summary.map(s => [s.id, s.window, s.left, s.bars.map(b => b.label).join()]), [["glm", "7d", 70, "5h,7d"], ["copilot", "mo", 50, "mo"]]);
	usage.stop();

	// Issue #5: an npm-installed Pi is found beside the `pi` on PATH when the managed install is absent.
	const { piPackage } = await import("../src/pi-sdk.ts");
	const npm = path.join(root, "npm"), pkg = path.join(npm, "node_modules", "@earendil-works", "pi-coding-agent");
	fs.mkdirSync(path.join(pkg, "dist"), { recursive: true }); fs.writeFileSync(path.join(pkg, "package.json"), "{}"); fs.writeFileSync(path.join(pkg, "dist", "cli.js"), "");
	if (process.platform === "win32") fs.writeFileSync(path.join(npm, "pi.cmd"), "");
	else { fs.mkdirSync(path.join(npm, "bin")); fs.symlinkSync(path.join(pkg, "dist", "cli.js"), path.join(npm, "bin", "pi")); }
	const bin = process.platform === "win32" ? npm : path.join(npm, "bin");
	assert.equal(fs.realpathSync(piPackage(path.join(root, "agent"), [path.join(root, "none"), bin].join(path.delimiter))), fs.realpathSync(pkg));
	assert.throws(() => piPackage(path.join(root, "agent"), ""), /Pi SDK not found/);
	fs.mkdirSync(path.join(root, "agent", "install"), { recursive: true }); fs.writeFileSync(path.join(root, "agent", "install", "current-version"), "9.9.9\n");
	assert.match(piPackage(path.join(root, "agent"), bin), /releases[\\/]9\.9\.9[\\/]node_modules/, "the managed install wins");
	console.log("usage ok");
} finally {
	fs.rmSync(root, { recursive: true, force: true });
}
