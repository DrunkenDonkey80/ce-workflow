#!/usr/bin/env node
// Self-check of the tool-usage census parser over a small fixture session.
import assert from "node:assert/strict";
import { addSession, newCensus, summarize, windowOf } from "./tool-usage-census.mjs";

const SECRET = "user-secret-text";
const line = (entry) => JSON.stringify(entry);
const assistant = (timestamp, ...names) => line({ type: "message", timestamp, message: { role: "assistant", content: [{ type: "text", text: SECRET }, ...names.map((name) => ({ type: "toolCall", name, arguments: { command: SECRET } }))] } });
const fixture = [
	assistant("2026-10-01T10:00:00Z", "bash", "read"),
	line({ type: "custom", customType: "plan3-run", data: { home: {}, set: {} } }),
	assistant("2026-11-01T10:00:00Z", "mcp__pi__ask_user"),
	line({ type: "custom", customType: "plan3-run", data: { id: "x", mode: "coding" } }),
	assistant("2026-11-14T10:00:00Z", "bash"),
	assistant("2026-11-14T10:01:00Z"),
	// Loads come from result details, never from the call arguments.
	line({ type: "message", timestamp: "2026-11-14T10:02:00Z", message: { role: "toolResult", toolName: "tools_enable", content: [{ type: "text", text: SECRET }], details: { enabled: ["screen_read"] } } }),
	line({ type: "message", timestamp: "2026-11-14T10:03:00Z", message: { role: "toolResult", toolName: "pi_lens_activate_tools", details: { added: ["lens_diagnostic_mark"] } } }),
	"{not json",
];

assert.equal(windowOf("2026-10-30T23:59:59Z"), "1-all-on");
assert.equal(windowOf("2026-10-31T00:00:00Z"), "2-on-demand");
assert.equal(windowOf("2026-11-13T00:00:00Z"), "3-trigger");

const acc = newCensus();
addSession(acc, fixture, { session: "s1", machine: "this-pc" });
const defs = {
	active: ["bash", "read", "mcp__pi__ask_user", "camera_capture"],
	all: [
		{ name: "bash", description: "run", parameters: {} },
		{ name: "read", description: "read", parameters: {} },
		{ name: "mcp__pi__ask_user", description: "ask", parameters: {} },
		{ name: "camera_capture", description: "camera", parameters: { type: "object" } },
		{ name: "screen_read", description: "screen", parameters: {} },
	],
};
const r = summarize(acc, defs);

// Phases: chat before Plan3 is normal, a plan3-run without mode is planning, then the run's mode.
assert.deepEqual(Object.keys(r.phases).sort(), ["1-all-on|normal", "2-on-demand|planning", "3-trigger|coding"]);
assert.deepEqual(r.phases["1-all-on|normal"].tools.bash, { calls: 1, per1kTurns: 1000, sessionShare: 1 });
assert.equal(r.phases["2-on-demand|planning"].tools.ask_user.calls, 1, "mcp__pi__ prefix stripped");
assert.equal(r.phases["3-trigger|coding"].turns, 2);
assert.equal(r.phases["3-trigger|coding"].tools.bash.per1kTurns, 500);
assert.deepEqual(r.loads, { "3-trigger": { screen_read: 1, lens_diagnostic_mark: 1 } });
assert.deepEqual(r.machines, { "this-pc": { sessions: 1, turns: 4 } });

// Near zero: always-on tools never called since on-demand loading; all-on windows do not count.
assert.deepEqual(r.nearZero.sort(), ["camera_capture", "read"]);
const est = r.estimatedSchemaBytesPerRequest;
assert(est["1-all-on"] > est.onDemandBase && est.onDemandBase > est.nearZeroShare && est.nearZeroShare > 0);

assert(!JSON.stringify(r).includes(SECRET), "never reads message text or tool arguments");
console.log("tool-usage-census: ok");
