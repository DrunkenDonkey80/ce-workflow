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
	console.log("usage ok");
} finally {
	fs.rmSync(root, { recursive: true, force: true });
}
