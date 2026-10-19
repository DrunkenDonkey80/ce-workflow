import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Registry } from "../src/registry.ts";
import { SessionHost } from "../src/sessions.ts";
import { acquireLock, lockPath, readLock, releaseLock } from "../src/session-lock.ts";

const fake = fileURLToPath(new URL("./fake-pi.mjs", import.meta.url));
const root = fs.mkdtempSync(path.join(os.tmpdir(), "hub-sessions-"));
const folder = path.join(root, "proj");
fs.mkdirSync(folder);
const host = new SessionHost({ registry: new Registry(path.join(root, "data")), command: [process.execPath, fake], stopGraceMs: 5000 });
const settled = id => new Promise(r => { const l = (sid, e) => { if (sid === id && e.type === "agent_settled") { host.off("event", l); r(e); } }; host.on("event", l); });

try {
	// New: Pi reports its file, the hub holds its lock while running.
	const a = await host.create(folder, "1");
	assert.equal(a.state, "running");
	assert.ok(a.sessionFile.startsWith(folder));
	assert.equal(readLock(a.sessionFile).pid, process.pid);
	const done = settled(a.id);
	await host.prompt(a.id, "hello");
	await done;
	const before = fs.readFileSync(a.sessionFile, "utf8");

	// Park keeps the file and releases the lock only after exit; resume uses the same file.
	await host.park(a.id);
	const parked = host.options.registry.get(a.id);
	assert.equal(parked.state, "parked");
	assert.equal(fs.existsSync(lockPath(a.sessionFile)), false);
	assert.equal(fs.readFileSync(a.sessionFile, "utf8"), before, "the hub never rewrites the session file");
	const resumed = await host.resume(a.id);
	assert.equal(resumed.sessionFile, a.sessionFile);
	assert.equal((await host.live.get(a.id).rpc.send({ type: "get_messages" })).data.messages.length, 2);

	// Busy sessions refuse park (D15); restart (D12) also refuses while busy.
	await host.prompt(a.id, "hold");
	assert.deepEqual(host.busyReasons(a.id), ["working"]);
	await assert.rejects(host.park(a.id), /Cannot park while working/);
	await assert.rejects(host.restart(a.id), /Cannot park/);
	await host.live.get(a.id).rpc.send({ type: "abort" });
	await new Promise(r => setTimeout(r, 50));
	assert.deepEqual(host.busyReasons(a.id), []);

	// Open dialogs count as busy until answered.
	const ui = new Promise(r => host.once("ui", (id, req) => req.method === "input" && r(req)));
	const command = host.prompt(a.id, "/ask q");
	const request = await ui;
	assert.deepEqual(host.busyReasons(a.id), ["running a command", "waiting for an answer"]);
	assert.equal(host.respond(a.id, request.id, { value: "v" }), true);
	await command;
	assert.deepEqual(host.busyReasons(a.id), []);

	// Published state (H3-04): the latest is kept; running subagents keep the session busy so it is not parked.
	await host.prompt(a.id, `/state ${JSON.stringify({ plan: { id: "p1" }, modes: { research: "on", night: "off" }, compacting: false, subagents: [{ id: "s" }] })}`);
	assert.equal(host.live.get(a.id).published.state.plan.id, "p1");
	assert.deepEqual(host.busyReasons(a.id), ["subagents running"]);
	await assert.rejects(host.park(a.id), /Cannot park while subagents running/);
	await host.prompt(a.id, `/state ${JSON.stringify({ plan: null, modes: {}, compacting: true, subagents: [] })}`);
	assert.deepEqual(host.busyReasons(a.id), ["compacting"]);
	await host.prompt(a.id, `/state ${JSON.stringify({ plan: null, modes: {}, compacting: false, subagents: [] })}`);
	assert.deepEqual(host.busyReasons(a.id), []);

	// Hub-to-Pi calls (H3-09): answered by id, errors come back as results, parked sessions refuse.
	assert.deepEqual(await host.call(a.id, "/api/command", { target: "b0b0b0b0", command: "review" }), { ok: true, value: { endpoint: "/api/command", data: { target: "b0b0b0b0", command: "review" } } });
	assert.deepEqual(await host.call(a.id, "/api/fail", {}), { ok: false, status: 404, error: "Displayed plan no longer exists." });
	const both = await Promise.all([host.call(a.id, "/api/bias", { level: 1 }), host.call(a.id, "/api/bias", { level: 2 })]);
	assert.deepEqual(both.map(result => result.value.data.level), [1, 2], "concurrent calls are matched by id");
	// A call resolves on its pi-hub:result; the command's own response (which ends "command running") may trail it.
	for (let i = 0; i < 100 && host.busyReasons(a.id).length; i++) await new Promise(r => setTimeout(r, 10));
	assert.deepEqual(host.busyReasons(a.id), []);
	await assert.rejects(host.call("00000000-0000-0000-0000-000000000000", "/api/bias", {}), /parked/);

	// Channel asks (H3-01): a reconnecting browser sees the open form again; answering works once.
	const notified = () => new Promise(r => { const l = (sid, req) => { if (req.method === "notify") { host.off("ui", l); r(req.message); } }; host.on("ui", l); });
	let asked = new Promise(r => host.once("ui", (sid, req) => r(req)));
	let note = notified();
	let ask = host.prompt(a.id, "/hubask");
	const form = await asked;
	assert.deepEqual(host.pendingDialogs(a.id).map(d => d.id), [form.id], "reconnect: still pending");
	assert.deepEqual(host.pendingDialogs(a.id).map(d => d.id), [form.id], "reconnect twice: same form");
	assert.equal(host.respond(a.id, form.id, { value: "{\"ok\":1}" }), true);
	assert.equal(await note, "answer:{\"ok\":1}");
	assert.equal(host.respond(a.id, form.id, { value: "again" }), false, "second answer refused");
	await ask;

	// Timeout inside Pi: `closed` removes the form; a late answer is refused.
	asked = new Promise(r => host.once("ui", (sid, req) => r(req)));
	const closedForm = new Promise(r => host.once("closed", (sid, requestId) => r(requestId)));
	note = notified();
	ask = host.prompt(a.id, "/hubask 50");
	const timed = await asked;
	assert.equal(await closedForm, timed.id);
	assert.equal(await note, "answer:<cancelled>");
	assert.deepEqual(host.pendingDialogs(a.id), []);
	assert.equal(host.respond(a.id, timed.id, { value: "{}" }), false, "late answer refused");
	await ask;
	assert.deepEqual(host.busyReasons(a.id), []);

	// Rename reaches Pi; restart keeps the file.
	await host.rename(a.id, "Roof");
	assert.equal((await host.live.get(a.id).rpc.send({ type: "get_state" })).data.sessionName, "Roof");
	const restarted = await host.restart(a.id);
	assert.equal(restarted.sessionFile, a.sessionFile);

	// Automatic parking: idle past the limit, but not while a browser is viewing (D16).
	host.idleParkMinutes = 60;
	host.live.get(a.id).viewers = 1;
	assert.deepEqual(await host.autoPark(Date.now() + 61 * 60_000), []);
	host.live.get(a.id).viewers = 0;
	const idle = host.live.get(a.id), clock = idle.lastActivity - 1;
	idle.lastActivity = clock; idle.rpc.emit("ui", { type: "extension_ui_request", id: "s1", method: "setStatus", statusKey: "x", statusText: "y" });
	assert.equal(idle.lastActivity, clock, "status repaints are not activity");
	assert.deepEqual(await host.autoPark(Date.now() + 30 * 60_000), []);
	assert.deepEqual(await host.autoPark(Date.now() + 61 * 60_000), [a.id]);
	host.idleParkMinutes = 0;

	// A file locked by another live process cannot be resumed; a dead pid's lock is taken over.
	fs.writeFileSync(lockPath(a.sessionFile), JSON.stringify({ pid: process.ppid, owner: "a terminal", startedAt: Date.now() }));
	await assert.rejects(host.resume(a.id), /open in a terminal \(pid/);
	assert.equal(host.options.registry.get(a.id).state, "parked", "a failed start stays retryable");
	fs.writeFileSync(lockPath(a.sessionFile), JSON.stringify({ pid: 999999, owner: "dead", startedAt: 1 }));
	await host.resume(a.id);
	assert.equal(readLock(a.sessionFile).pid, process.pid);

	// Two simultaneous starts on one file: exactly one wins.
	await host.park(a.id);
	const results = await Promise.allSettled([host.resume(a.id), host.resume(a.id)]);
	assert.equal(host.live.size, 1);
	assert.ok(results.some(r => r.status === "fulfilled"));
	const tries = [0, 1, 2, 3].map(() => { try { return acquireLock(path.join(root, "x.jsonl"), "t", process.pid); } catch { return null; } });
	assert.equal(tries.filter(Boolean).length, 1, "only one lock acquisition succeeds");
	releaseLock(path.join(root, "x.jsonl"), tries.find(Boolean));

	// Crash: the lock is released and the session is parked, retryable.
	const crashed = new Promise(r => host.once("exit", (id, exit) => r(exit)));
	host.live.get(a.id).rpc.process.kill();
	assert.equal((await crashed).unexpected, true);
	assert.equal(fs.existsSync(lockPath(a.sessionFile)), false);
	assert.equal(host.options.registry.get(a.id).state, "parked");

	// Hub shutdown remembers running sessions; restore starts them again (D17).
	await host.resume(a.id);
	const b = await host.create(folder, "2");
	await host.park(b.id);
	const clockA = host.live.get(a.id).lastActivity -= 5000;
	await host.shutdown();
	assert.equal(host.live.size, 0);
	const again = new SessionHost({ registry: new Registry(path.join(root, "data")), command: [process.execPath, fake] });
	assert.deepEqual((await again.restoreRunning()).map(r => r.id), [a.id]);
	assert.equal(again.live.get(a.id).lastActivity, clockA, "a restart keeps the idle clock");
	await again.shutdown();
	// A Pi without ce-workflow's /pi-hub never gets the call as a model prompt.
	const bare = new SessionHost({ registry: new Registry(path.join(root, "bare")), command: [process.execPath, fake], env: { FAKE_PI: "no-hub" } });
	const lone = await bare.create(folder, "bare");
	const prompts = [];
	bare.live.get(lone.id).rpc.on("event", event => event.type === "agent_start" && prompts.push(event));
	await assert.rejects(bare.call(lone.id, "/api/bias", { level: 1 }), /no ce-workflow hub support/);
	assert.equal(prompts.length, 0);
	await bare.shutdown();
	assert.deepEqual(fs.readdirSync(folder).filter(f => f.endsWith(".lock")), []);
	// H7-01: Open in terminal parks, then hands the lock to the terminal's process; closing it brings the session back.
	const t = await host.create(folder, "term");
	let launched;
	host.options.terminal = (args, cwd, env) => {
		const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "ignore" });
		launched = { args, cwd, env, child, lockBefore: readLock(t.sessionFile) };
		return child;
	};
	const opened = await host.openTerminal(t.id);
	assert.equal(opened.state, "terminal");
	assert.equal(host.live.has(t.id), false, "parked first");
	assert.deepEqual([launched.args, launched.cwd], [["--session", t.sessionFile], folder]);
	assert.equal(launched.lockBefore.owner, "pi-control-hub terminal", "locked before the terminal starts");
	const termLock = readLock(t.sessionFile);
	assert.deepEqual([termLock.pid, String(termLock.startedAt)], [launched.child.pid, launched.env.PI_HUB_TERMINAL_LOCK], "the terminal's pid, the start time it is told");
	await assert.rejects(host.resume(t.id), /open in a terminal/);
	await assert.rejects(host.openTerminal(t.id), /already open in a terminal/);
	assert.throws(() => acquireLock(t.sessionFile, "other"), /pi-control-hub terminal/);
	assert.deepEqual(host.checkTerminals(), [], "still open");
	const back = new Promise(resolve => host.once("terminals", resolve));
	launched.child.kill();
	assert.deepEqual(await back, [t.id]);
	assert.equal(host.options.registry.get(t.id).state, "parked");
	assert.equal(fs.existsSync(lockPath(t.sessionFile)), false);
	// A hub restart loses the exit event; a dead lock holder is found by the periodic check instead.
	await host.openTerminal(t.id);
	fs.writeFileSync(lockPath(t.sessionFile), JSON.stringify({ ...readLock(t.sessionFile), pid: 2 ** 31 - 2 }));
	assert.deepEqual(host.checkTerminals(), [t.id]);
	launched.child.kill();
	await host.resume(t.id);
	await host.park(t.id);
	console.log("sessions ok");
} finally {
	await host.shutdown().catch(() => {});
	fs.rmSync(root, { recursive: true, force: true });
}
