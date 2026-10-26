// S-01/S-03: scheduler with a fake clock and fake-pi. Script results are scripted; one real runScript call checks the shell path.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Registry } from "../src/registry.ts";
import { SessionHost } from "../src/sessions.ts";
import { Scheduler, runScript, SCHEDULED_PREFIX, MAX_FAILURES } from "../src/scheduler.ts";

const fake = fileURLToPath(new URL("./fake-pi.mjs", import.meta.url));
const root = fs.mkdtempSync(path.join(os.tmpdir(), "hub-scheduler-"));
const folder = path.join(root, "proj");
fs.mkdirSync(folder);
const dataDir = path.join(root, "data");
const registry = new Registry(dataDir);
const host = new SessionHost({ registry, command: [process.execPath, fake], stopGraceMs: 5000 });
const results = [];
const run = async () => results.shift() ?? { code: 0, output: "", timedOut: false };
const make = () => new Scheduler({ dataDir, registry, host, run });
const messages = async id => (await host.live.get(id).rpc.send({ type: "get_messages" })).data.messages.map(m => m.content?.[0]?.text ?? m.content);
const T = 1_000_000_000_000, min = 60_000;
const idle = async id => { for (let i = 0; i < 200 && host.busyReasons(id).length; i++) await new Promise(r => setTimeout(r, 10)); };

try {
	const a = await host.create(folder, "1");
	let s = make();

	// Validation and D8 limits.
	assert.throws(() => s.add({ session: a.id, kind: "message", text: " " }, T), /needs text/);
	assert.throws(() => s.add({ session: a.id, kind: "script", command: "x", everyMinutes: 0.1 }, T), /every 10 seconds/);
	assert.throws(() => s.add({ session: a.id, kind: "message", text: "x", everyMinutes: 0.5 }, T), /once a minute/);
	const fast = s.add({ session: a.id, kind: "script", command: "x", everyMinutes: 1 / 6 }, T);
	assert.equal(fast.every, 10_000, "script timers may tick every 10 s"); s.cancel(fast.id);
	assert.throws(() => s.add({ session: "missing", kind: "message", text: "x" }, T), /hub session/);
	assert.throws(() => s.add({ session: a.id, kind: "message", text: "x", at: T - min }, T), /past/);
	const rep = s.add({ session: a.id, kind: "message", text: "check", everyMinutes: 5 }, T);
	assert.equal(rep.runsLeft, 12, "message repeats default to 12 runs");
	const watch = s.add({ session: a.id, kind: "script", command: "probe", everyMinutes: 1 }, T);
	assert.equal(watch.expiresAt, T + 24 * 60 * min, "script repeats stop after 24 h");
	s.cancel(rep.id); s.cancel(watch.id);

	// Script timer, parked session: quiet ticks never resume it; output wakes it and ends the timer.
	await host.park(a.id);
	const script = s.add({ session: a.id, kind: "script", command: "probe", everyMinutes: 1 }, T);
	await s.tick(T + min);
	assert.equal(host.live.has(a.id), false, "a quiet script tick resumes nothing (D5)");
	assert.equal(s.list()[0].lastResult, "quiet");
	await s.tick(T + min + 1000);
	assert.equal(s.list()[0].lastRun, T + min, "not due again yet");
	results.push({ code: 0, output: "file arrived", timedOut: false });
	await s.tick(T + 2 * min);
	assert.equal(host.live.has(a.id), true, "output resumes the session to deliver");
	assert.equal(s.list().length, 0, "output ends the timer");
	assert.match((await messages(a.id)).at(-2), new RegExp(`^${SCHEDULED_PREFIX}.*file arrived$`));

	// Exit 3 cancels silently; three failures in a row send the error and stop; a success resets the count.
	const delivered = [];
	s.on("delivered", t => delivered.push(t.id));
	const quiet = s.add({ session: a.id, kind: "script", command: "probe", everyMinutes: 1 }, T);
	results.push({ code: 3, output: "", timedOut: false });
	await s.tick(T + min);
	assert.equal(s.list().length, 0); assert.deepEqual(delivered, []);
	const flaky = s.add({ session: a.id, kind: "script", command: "probe", everyMinutes: 1 }, T);
	results.push({ code: 1, output: "", timedOut: false }, { code: 0, output: "", timedOut: false }, { code: 1, output: "", timedOut: false }, { code: 2, output: "", timedOut: false });
	for (let i = 1; i <= 4; i++) await s.tick(T + i * min);
	assert.equal(s.list()[0].failures, 2, "a success in between resets the failure count");
	results.push({ code: null, output: "boom", timedOut: true });
	await s.tick(T + 5 * min);
	assert.equal(s.list().length, 0); assert.deepEqual(delivered, [flaky.id]);
	assert.match((await messages(a.id)).at(-2), new RegExp(`failed ${MAX_FAILURES} times.*timed out[\\s\\S]*boom`));
	void quiet;

	// Message timers: a one-off to a parked session resumes it; a repeat skips busy ticks and stops after its runs.
	await host.park(a.id);
	s.add({ session: a.id, kind: "message", text: "wake up", inMinutes: 2 }, T);
	await s.tick(T + min);
	assert.equal(host.live.has(a.id), false, "not due yet");
	await s.tick(T + 2 * min);
	assert.match((await messages(a.id)).at(-2), /Scheduled \(message timer [0-9a-f]{8}\): wake up$/);
	assert.equal(s.list().length, 0, "a one-off ends once delivered");
	const twice = s.add({ session: a.id, kind: "message", text: "again", everyMinutes: 1, runs: 2 }, T);
	host.live.get(a.id).running = true;
	await s.tick(T + min);
	assert.equal(s.list()[0].lastResult, "skipped: busy");
	host.live.get(a.id).running = false;
	await s.tick(T + 2 * min); await idle(a.id); await s.tick(T + 3 * min);
	assert.equal(s.list().find(t => t.id === twice.id), undefined, "ran its two runs");
	const until = s.add({ session: a.id, kind: "message", text: "x", everyMinutes: 1, until: T + 30 * min }, T);
	assert.equal(until.runsLeft, undefined);
	await s.tick(T + 31 * min);
	assert.equal(s.list().length, 0, "past until it expires");

	// A one-off for a busy agent waits as a follow-up instead of a steer.
	await host.prompt(a.id, "hold");
	const sent = [];
	const realPrompt = host.prompt.bind(host);
	host.prompt = (id, message, extra) => { sent.push(extra); return realPrompt(id, message, extra); };
	s.add({ session: a.id, kind: "message", text: "later", inMinutes: 1 }, T);
	await s.tick(T + min);
	assert.deepEqual(sent, [{ streamingBehavior: "followUp" }]);
	host.prompt = realPrompt;
	await host.live.get(a.id).rpc.send({ type: "abort" });
	await idle(a.id);

	// D15: a terminal pauses deliveries; /new (new file) and unstar (no record) cancel.
	const ended = [];
	s.on("ended", (t, reason) => ended.push(reason));
	registry.update(a.id, { state: "terminal" });
	results.push({ code: 0, output: "while in terminal", timedOut: false });
	s.add({ session: a.id, kind: "script", command: "probe", inMinutes: 1 }, T);
	await s.tick(T + min);
	assert.equal(s.list()[0].pending.endsWith("while in terminal"), true, "script ran; delivery waits");
	registry.update(a.id, { state: "running" });
	await s.tick(T + min + 5000);
	assert.equal(s.list().length, 0, "delivered once the hub has the session back");
	s.add({ session: a.id, kind: "message", text: "old work", inMinutes: 5 }, T);
	await idle(a.id);
	await host.live.get(a.id).rpc.send({ type: "set_model", provider: "fake", modelId: "fake-2" });
	await host.live.get(a.id).rpc.send({ type: "set_thinking_level", level: "high" });
	await host.newSession(a.id);
	assert.deepEqual([registry.get(a.id).model?.id, registry.get(a.id).thinking], ["fake-2", "high"], "/new keeps the model and thinking level");
	await s.tick(T + min);
	assert.equal(ended.at(-1), "the session started a new conversation");
	s.add({ session: a.id, kind: "message", text: "gone", inMinutes: 5 }, T);
	const record = registry.get(a.id);
	registry.remove(a.id);
	await s.tick(T + min);
	assert.equal(ended.at(-1), "the session was removed");
	assert.equal(s.list().length, 0);
	await host.park(a.id).catch(() => {});

	// Persistence: timers survive a restart; an unreadable file refuses to start instead of losing timers.
	const b = await host.create(folder, "2");
	s.add({ session: b.id, kind: "message", text: "after restart", inMinutes: 1 }, T);
	s = make();
	assert.equal(s.list()[0].text, "after restart");
	await s.tick(T + 10 * min);
	assert.equal(s.list().length, 0, "a timer that came due while the hub was down fires once");
	fs.writeFileSync(s.file, "{");
	assert.throws(make, /Unreadable hub timers/);
	void record;

	// The real script runner: shell, folder, output cap, exit code and timeout.
	if (process.platform === "win32") assert.match((await runScript("uname -s", folder)).output, /MINGW|MSYS/, "Windows timers run in Git Bash, not WSL");
	const echo = await runScript("echo hi&& exit 3", folder);
	assert.deepEqual([echo.code, echo.output, echo.timedOut], [3, "hi", false]);
	const slow = await runScript(`"${process.execPath}" -e "setTimeout(() => {}, 5000)"`, folder, 200);
	assert.equal(slow.timedOut, true);
	console.log("scheduler ok");
} finally {
	await host.shutdown().catch(() => {});
	fs.rmSync(root, { recursive: true, force: true });
}
