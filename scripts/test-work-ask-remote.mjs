#!/usr/bin/env node
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createJiti } from "jiti";
import { registerRemoteAskAnswers } from "../extensions/work-ask-remote.ts";
const { raceRemoteAsk, remoteResponse, remoteBatch } = await createJiti(import.meta.url).import("../extensions/ask-user/remote.ts");

const bus = new EventEmitter(), outbox = [], answers = [], hooks = new Map();
const pi = {
	on: (name, fn) => hooks.set(name, fn),
	events: {
		on: (name, fn) => { bus.on(name, fn); return () => bus.off(name, fn); },
		emit: (name, payload) => bus.emit(name, payload),
	},
};
const question = { question: "Ship?", options: [{ title: "Ship" }, { title: "Hold" }], allowMultiple: false, allowFreeform: false };
const askId = "11111111-2222-3333-4444-555555555555";
const inbound = (text, from = "monitor", extra = {}) => hooks.get("message_end")?.({ message: { customType: "intercom_message", details: { from: { id: from }, bodyText: text, ...extra } } });
registerRemoteAskAnswers(pi);
bus.on("intercom:outbox-request", event => outbox.push(event));
hooks.get("session_start")({}, { sessionManager: { getSessionId: () => "self-session" } });
bus.emit("ask:pending", { ...question, askId });
assert.equal(outbox.length, 0, "no peer drives this session: nothing is sent");
inbound("please check");
bus.emit("ask:pending", { ...question, askId });
assert.equal(outbox.length, 1, "on by default, no environment gate");
assert.equal(outbox[0].to, "monitor");
assert.ok(outbox[0].message.startsWith("Session self-session is waiting for its user to answer:\nShip?\n- Ship\n- Hold"));
assert.ok(outbox[0].message.includes('session_dialog {action: "wait", session: "self-session"}'));
assert.match(outbox[0].message, /ONLY when the user told you to control or fix that session/, "answering for the user is discouraged");
bus.emit("ask:pending", { askId, kind: "list", title: "Menu", items: [] });
assert.equal(outbox.length, 1, "menus are not forwarded");
hooks.get("input")({ source: "interactive" });
bus.emit("ask:pending", { ...question, askId });
assert.equal(outbox.length, 1, "the user typing takes the session back");
inbound("again", "monitor", { crossMachine: {} });
bus.emit("ask:pending", { ...question, askId });
assert.equal(outbox.length, 1, "cross-machine peers are never driving peers");
inbound("again");
hooks.get("input")({ source: "extension" });
bus.emit("ask:pending", { askId, questions: [question, question] });
assert.match(outbox.at(-1).message, /Question 1: Ship\?[\s\S]*Question 2: Ship\?/, "intercom's own wake-up prompt keeps the peer; batches list each question");
assert.equal(answers.length, 0);

// Exercise the native race directly, without installed-package patches or opt-in flags.
assert.equal(remoteResponse({ text: "Unknown" }, question, false), undefined);
assert.equal(remoteResponse({ selections: ["Ship", "Hold"] }, question, false), undefined);
assert.equal(remoteResponse({ text: "Ship", comment: "unauthorized" }, question, false), undefined);
assert.deepEqual(remoteResponse({ text: " ship " }, question, true), { kind: "selection", selections: ["Ship"] });
assert.deepEqual(remoteResponse({ text: "Other" }, { ...question, allowFreeform: true }, false), { kind: "freeform", text: "Other" });
assert.equal(remoteBatch({ answers: [] }, [question, question], false), undefined);
assert.equal(remoteBatch({ answers: [{ status: "answered", response: { text: "Unknown" } }, { status: "skipped" }] }, [question, question], false), undefined);
assert.deepEqual(remoteBatch({ answers: [{ status: "answered", response: { selections: ["Ship"] } }, { status: "skipped" }] }, [question, question], false), [{ status: "answered", response: { kind: "selection", selections: ["Ship"] } }, { status: "skipped" }]);

const races = new EventEmitter();
const remotePi = { events: { on: (name, fn) => { races.on(name, fn); return () => races.off(name, fn); }, emit: (name, event) => races.emit(name, event) } };
let id, localSignal, closed = 0;
races.on("ask:pending", event => { id = event.askId; });
races.on("ask:closed", () => closed++);
const wait = signal => new Promise(resolve => { localSignal = signal; signal.addEventListener("abort", () => resolve(null), { once: true }); });
const decode = value => remoteResponse(value, question, false);
let pending = raceRemoteAsk(remotePi, { ...question, allowComment: false }, undefined, undefined, decode, wait);
await Promise.resolve();
races.emit("ask:answer", { askId: id, text: "Invalid" });
assert.equal(localSignal.aborted, false);
races.emit("ask:answer", { askId: id, text: "Ship" });
races.emit("ask:answer", { askId: id, text: "Hold" });
assert.deepEqual(await pending, { kind: "selection", selections: ["Ship"] });
assert.equal(localSignal.aborted, true);
assert.equal(races.listenerCount("ask:answer"), 0);
assert.equal(closed, 1);
assert.equal(await raceRemoteAsk(remotePi, { ...question, allowComment: false }, undefined, undefined, decode, async () => "local"), "local");
await assert.rejects(raceRemoteAsk(remotePi, { ...question, allowComment: false }, undefined, undefined, decode, async () => { throw new Error("UI failed"); }), /UI failed/);
assert.equal(races.listenerCount("ask:answer"), 0);
const caller = new AbortController();
pending = raceRemoteAsk(remotePi, { ...question, allowComment: false }, caller.signal, undefined, decode, wait);
await Promise.resolve(); caller.abort();
assert.equal(await pending, null);
assert.equal(localSignal.aborted, true);
assert.equal(await raceRemoteAsk(remotePi, { ...question, allowComment: false }, AbortSignal.abort(), undefined, decode, () => assert.fail("aborted")), null);
assert.equal(await raceRemoteAsk(remotePi, { ...question, allowComment: false }, undefined, 10, decode, wait), null);
assert.equal(races.listenerCount("ask:answer"), 0);
// A synchronous remote answer before the popup opens must never create a losing dialog.
races.once("ask:pending", event => races.emit("ask:answer", { askId: event.askId, text: "Ship" }));
assert.deepEqual(await raceRemoteAsk(remotePi, { ...question, allowComment: false }, undefined, undefined, decode, () => assert.fail("remote already won")), { kind: "selection", selections: ["Ship"] });
console.log("ok - native ask_user remote channel and forwarding to the driving peer");
