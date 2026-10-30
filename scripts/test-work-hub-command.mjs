// /wo hub: the menu offered for each hub state, and the CLI bridge against a hub that is not running.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.PI_CODING_AGENT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "wo-hub-")); // the CLI child inherits it: no real hub
const { hubCli, hubMenu, joinedSession, scheduleTool, liveTarget, dialogReason } = await import("../extensions/hub-command.ts");
// A woken parked session is found by its Pi session id, else (stable/claimed intercom id) as the one new session in its folder.
const target = { id: 'h1', name: 'game', folder: '/p', sessionId: 'pi-1' };
assert.equal(joinedSession([{ id: 'pi-1', cwd: '/x', pid: 2, startedAt: 0 }], target, 100, 1)?.id, 'pi-1');
assert.equal(joinedSession([{ id: 'claimed', cwd: '/p', pid: 2, startedAt: 150 }, { id: 'old', cwd: '/p', pid: 3, startedAt: 50 }], target, 100, 1)?.id, 'claimed');
assert.equal(joinedSession([{ id: 'a', cwd: '/p', pid: 2, startedAt: 150 }, { id: 'b', cwd: '/p', pid: 3, startedAt: 160 }], target, 100, 1), undefined, 'two new sessions: ambiguous, keep waiting');
assert.equal(joinedSession([{ id: 'me', cwd: '/p', pid: 1, startedAt: 150 }], target, 100, 1), undefined, 'never itself');

// A send to a live peer sitting in a dialog: found as intercom finds it, and stopped with the question and the three ways on.
const peers = [{ id: 'abcd1234-x', name: 'Game', cwd: '/p', pid: 2, startedAt: 0 }, { id: 'ffff0000-y', cwd: '/q', pid: 3, startedAt: 0 }, { id: 'me', cwd: '/p', pid: 1, startedAt: 0 }];
assert.equal(liveTarget(peers, 'game', undefined, 1)?.id, 'abcd1234-x', 'by name, any case');
assert.equal(liveTarget(peers, 'ffff', undefined, 1)?.id, 'ffff0000-y', 'by id prefix');
assert.equal(liveTarget(peers, '', '/p', 1)?.id, 'abcd1234-x', 'cwd alone: the sole other peer there');
assert.equal(liveTarget(peers, 'nobody', undefined, 1), undefined);
const reason = dialogReason(peers[0], [{ askId: 'r1', question: 'Ship?', options: [{ title: 'Ship' }, { title: 'Hold', description: 'wait a day' }], allowFreeform: false }, { askId: 'r2', kind: 'list', title: 'Menu', items: [{ value: 'a', label: 'Alpha' }] }]);
assert.ok(reason.startsWith('Not sent: session Game (abcd1234) is waiting for its user'), reason);
assert.ok(reason.includes('askId: r1\nQuestion: Ship?\n- Ship\n- Hold \u2014 wait a day\nAnswer shape: {"selections"'), reason);
assert.ok(reason.includes('askId: r2\nMenu: Menu\n- Alpha (value: a)\nAnswer shape: {"action":"select"'), reason);
assert.match(reason, /Wait \(usual\)[\s\S]*Drop it[\s\S]*Answer it: ONLY when the user told you to control or fix that session/, 'answering for the user is discouraged');
const values = menu => menu.items.map(item => item.value);

const fresh = hubMenu({ running: false, autostart: false, command: false, remote: { on: false } }, "/p");
assert.equal(fresh.summary, "Not installed");
assert.deepEqual(values(fresh), ["install", "autostart on"], "a new PC is offered Install first");
assert.deepEqual(values(hubMenu({ running: false, autostart: true, command: true, remote: { on: true } }, "/p")), ["start", "install", "autostart off"]);
const running = hubMenu({ running: true, autostart: true, command: true, local: "http://127.0.0.1:5/", remote: { on: true, url: "https://pc.ts.net:5/" }, sessions: 3, live: 2, busy: 1 }, "/p");
assert.deepEqual(values(running), ["open", "open remote", "new", "restart", "stop", "remote off", "autostart off"]);
assert.match(running.summary, /Running · 3 sessions \(2 live, 1 busy\) · http:\/\/127\.0\.0\.1:5\/ · Remote: https:\/\/pc\.ts\.net:5\//);
const waiting = hubMenu({ running: true, autostart: true, command: true, local: "x", remote: { on: true }, pairing: { code: "AB12", label: "iPhone", login: "me@x" }, sessions: 0, live: 0, busy: 0 }, "/p");
assert.deepEqual(values(waiting).slice(0, 2), ["pair approve", "pair reject"], "a waiting device is approved from the menu");
assert.match(waiting.items[0].label, /AB12/); assert.match(waiting.summary, /^Device waiting, code AB12/);
assert(!values(hubMenu({ running: true, autostart: false, command: false, local: "x", remote: { on: false }, sessions: 0, live: 0, busy: 0 }, "/p")).includes("open remote"), "no remote page without an address");

const status = await hubCli(["status", "--json"], 30_000);
assert(status.ok, status.text);
let parsed; try { parsed = JSON.parse(status.text); } catch { assert.fail("status --json printed: " + status.text); }
assert.equal(parsed.running, false); assert.equal(parsed.remote.on, false);
const restart = await hubCli(["stop"], 30_000);
assert.match(restart.text, /Not running/);
// S-04: the schedule tool refuses outside a hub session and passes CLI errors through.
delete process.env.PI_HUB_SESSION;
await assert.rejects(scheduleTool.execute("t", { action: "list" }), /started by pi-control-hub/);
process.env.PI_HUB_SESSION = "00000000-0000-0000-0000-000000000000";
await assert.rejects(scheduleTool.execute("t", { action: "add" }), /needs kind/);
await assert.rejects(scheduleTool.execute("t", { action: "add", kind: "script", command: "exit 0", everyMinutes: 5 }), /hub is not running/);
delete process.env.PI_HUB_SESSION;
fs.rmSync(process.env.PI_CODING_AGENT_DIR, { recursive: true, force: true });
console.log("ok - /wo hub menu per hub state; CLI bridge status --json and stop against a stopped hub");
