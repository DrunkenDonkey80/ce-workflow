// Self-update: a newer package.json on disk reloads the session only once it has held, only when quiet, and between
// plan steps it stops the run and resumes it after the reload.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { registerSelfUpdate } from "../extensions/work-self-update.ts";

const dir = mkdtempSync(path.join(os.tmpdir(), "wo-self-")), file = path.join(dir, "package.json");
const version = v => writeFileSync(file, JSON.stringify({ version: v }));
let clock = 0;
delete process.env.PI_HUB; // run under a hub session or not alike
function fakePi() {
	const handlers = {}, sent = [], busy = { subagents: 0, compacting: false };
	const pi = {
		on: (name, fn) => { handlers[name] = fn; },
		events: { emit: (name, info) => { if (name === "plan3:busy-info") Object.assign(info, busy); } },
		sendUserMessage: (text, options) => sent.push({ text, options }),
	};
	const ctx = { idle: true, pending: false, aborted: 0, isIdle() { return this.idle; }, hasPendingMessages() { return this.pending; }, abort() { this.aborted++; }, ui: { notify() {}, setStatus() {} } };
	const fire = (name, event = {}) => handlers[name]?.(event, ctx);
	return { pi, ctx, fire, sent, busy };
}
try {
	version("1.0.0");
	{
		const { pi, ctx, fire, sent, busy } = fakePi();
		registerSelfUpdate(pi, { packageFile: file, loaded: "1.0.0", now: () => clock, every: 1e9, stableMs: 60_000 });
		fire("session_start", { reason: "startup" });
		fire("agent_settled"); assert.equal(sent.length, 0, "same version: nothing");
		version("1.0.1"); fire("agent_settled"); assert.equal(sent.length, 0, "a version just seen may still be downloading");
		clock += 61_000; busy.subagents = 1; fire("agent_settled"); assert.equal(sent.length, 0, "never under running subagents");
		busy.subagents = 0; ctx.pending = true; fire("agent_settled"); assert.equal(sent.length, 0, "never with a queued message");
		ctx.pending = false; fire("agent_settled");
		assert.deepEqual(sent.map(m => m.text), ["/wo reload"], "quiet and held: reload");
	}
	{
		// Mid-plan: a finished step ends the turn, the run stops, reloads, and the new runtime resumes it.
		const { pi, ctx, fire, sent } = fakePi();
		registerSelfUpdate(pi, { packageFile: file, loaded: "1.0.0", now: () => clock, every: 1e9, stableMs: 0 });
		fire("session_start", { reason: "startup" });
		ctx.idle = false;
		fire("tool_result", { toolName: "plan3", input: { action: "get" } }); fire("turn_end"); assert.equal(ctx.aborted, 0, "no step finished: keep going");
		fire("tool_result", { toolName: "plan3", input: { action: "next" } }); fire("turn_end"); assert.equal(ctx.aborted, 1, "a finished step stops the run");
		ctx.idle = true; fire("agent_settled");
		assert.equal(sent.at(-1).text, "/wo reload");
		// The reloaded runtime (a new registration) sees the carried resume and sends it.
		const next = fakePi();
		registerSelfUpdate(next.pi, { packageFile: file, loaded: "1.0.1", now: () => clock, every: 1e9 });
		next.fire("session_start", { reason: "reload" });
		await new Promise(resolve => setTimeout(resolve, 5));
		assert.match(next.sent[0]?.text ?? "", /Continue where you left off/);
		next.fire("session_shutdown");
	}
	{
		// A compaction inside a run is a boundary too; an idle /compact is not.
		const { pi, ctx, fire } = fakePi();
		registerSelfUpdate(pi, { packageFile: file, loaded: "1.0.0", now: () => clock, every: 1e9, stableMs: 0 });
		fire("session_start", { reason: "startup" });
		fire("session_compact"); ctx.idle = false; fire("turn_end"); assert.equal(ctx.aborted, 0, "idle /compact: the next prompt runs on");
		fire("session_compact"); fire("turn_end"); assert.equal(ctx.aborted, 1, "compaction mid-run stops at the next turn end");
	}
	{
		// Under the hub an idle session reloads from the minute poll; outside it only a run's end does.
		for (const hub of [false, true]) {
			if (hub) process.env.PI_HUB = "1"; else delete process.env.PI_HUB;
			const { pi, fire, sent } = fakePi();
			registerSelfUpdate(pi, { packageFile: file, loaded: "1.0.0", now: () => clock, every: 10, stableMs: 0, idleMs: 0 });
			fire("session_start", { reason: "startup" });
			await new Promise(resolve => setTimeout(resolve, 60));
			fire("session_shutdown");
			assert.equal(sent.length > 0, hub, hub ? "hub: the poll reloads" : "terminal: the poll only watches");
		}
		delete process.env.PI_HUB;
	}
	console.log("work-self-update ok");
} finally { rmSync(dir, { recursive: true, force: true }); }
