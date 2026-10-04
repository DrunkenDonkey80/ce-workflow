#!/usr/bin/env node
// Offline bridge and optional pi-ask-user patch checks; never patch installed code.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { stripTypeScriptTypes } from "node:module";
import { runInNewContext } from "node:vm";
import { patchAskUserSource, REMOTE_HELPERS } from "./patch-ask-user-remote-answer.mjs";
import { registerRemoteAskAnswers } from "../extensions/work-ask-remote.js";

const listeners = new Map();
const outbox = [];
const emits = [];
const pi = {
	on: (name, handler) => {
		const list = listeners.get(name) ?? [];
		list.push(handler);
		listeners.set(name, list);
	},
	registerTool() {},
	events: {
		on: (name, handler) => {
			const list = listeners.get(name) ?? [];
			list.push(handler);
			listeners.set(name, list);
			return () => list.splice(list.indexOf(handler), 1);
		},
		emit: (name, payload) => {
			if (name === "intercom:outbox-request") outbox.push(payload);
			if (name === "ask:answer") emits.push(payload);
		},
	},
};
const fire = (name, event) =>
	[...(listeners.get(name) ?? [])].map((h) => h(event));

const multiId = "66666666-7777-8888-9999-000000000000";
registerRemoteAskAnswers(pi);
const askId = "11111111-2222-3333-4444-555555555555";
const ask = {
	askId,
	question: "Ship it?",
	options: [{ title: "Ship" }, { title: "Hold" }],
	allowMultiple: false,
	allowFreeform: false,
};

// 1. No peer yet: pending is stored, nothing is forwarded.
fire("ask:pending", ask);
assert.equal(outbox.length, 0, "no forward before any intercom peer");

// 2. First inbound from the monitor: peer is learned and pending asks re-forward.
fire("message_end", {
	message: {
		customType: "intercom_message",
		details: { from: { id: "monitor-1" } },
		content: "checking in",
	},
});
assert.equal(outbox.length, 1, "pending ask forwarded once a peer appears");
assert.match(outbox[0].message, new RegExp(`ANSWER ${askId}:`));
assert.equal(outbox[0].to, "monitor-1");

// 3. A new pending ask forwards immediately to the known peer.
fire("ask:pending", { ...ask, askId: multiId, allowMultiple: true });
assert.equal(outbox.length, 2);

// 4. Unrelated reply (no ANSWER token) retries forward, does not answer.
fire("message_end", {
	message: {
		customType: "intercom_message",
		details: { from: { id: "monitor-1" }, bodyText: "still thinking" },
	},
});
assert.equal(outbox.length, 4, "both pending asks retried");
assert.equal(emits.length, 0, "no answer emitted");

// 5. Wrong askId: no answer.
fire("message_end", {
	message: {
		customType: "intercom_message",
		details: {
			from: { id: "monitor-1" },
			bodyText: `ANSWER 00000000-0000-0000-0000-000000000000: Ship`,
		},
	},
});
assert.equal(emits.length, 0);

// 6. Only the exact local recipient may answer a forwarded prompt.
for (const details of [
	{ from: { id: "other-peer" } },
	{ from: { id: "monitor-1" }, crossMachine: { type: "ssh-relay", trust: "ssh-asserted" } },
	{ from: { id: "monitor-1" }, message: { crossMachine: { type: "ssh-relay", trust: "ssh-asserted" } } },
]) {
	fire("message_end", { message: { customType: "intercom_message", details: { ...details, bodyText: `ANSWER ${askId}: Ship` } } });
	assert.equal(emits.length, 0, "untrusted or unaddressed peer cannot answer");
}
// Windows local broker peers have trustedLocal:false; exact local answers still work.
fire("message_end", {
	message: {
		customType: "intercom_message",
		details: { from: { id: "monitor-1", trustedLocal: false }, bodyText: `ANSWER ${askId}: Hold` },
	},
});
assert.equal(emits.length, 1);
assert.deepEqual(emits[0], { askId, text: "Hold" });

// 7. Multi-select answers split on " | ".
fire("message_end", {
	message: {
		customType: "intercom_message",
		details: {
			from: { id: "monitor-1" },
			bodyText: `ANSWER ${multiId}: Ship | Hold`,
		},
	},
});
assert.deepEqual(emits[1], { askId: multiId, selections: ["Ship", "Hold"] });

// 8. ask:answered/ask:cancelled clear pending asks.
fire("ask:pending", { ...ask, askId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" });
fire("ask:answered", {});
const beforeClear = outbox.length;
fire("message_end", {
	message: {
		customType: "intercom_message",
		details: { from: { id: "monitor-1" } },
		content: "hello",
	},
});
assert.equal(outbox.length, beforeClear, "cleared asks are not re-forwarded");

// 9. Non-intercom messages are ignored entirely.
const before = outbox.length;
fire("message_end", {
	message: { customType: "subagent-notify", content: `ANSWER ${askId}: Ship` },
});
assert.equal(outbox.length, before, "non-intercom messages ignored");

// Shutdown discards the old prompt and routing identity.
fire("ask:pending", ask);
fire("session_shutdown", {});
const beforeShutdown = outbox.length;
fire("message_end", { message: { customType: "intercom_message", details: { from: { id: "monitor-1" }, bodyText: `ANSWER ${askId}: Ship` } } });
assert.equal(outbox.length, beforeShutdown);
assert.equal(emits.length, 2);
fire("session_shutdown", {});
fire("ask:pending", ask);
assert.equal(outbox.length, beforeShutdown, "new session has no remembered peer");
fire("message_end", { message: { customType: "intercom_message", details: { from: { id: "new-monitor" }, bodyText: `ANSWER ${askId}: Ship` } } });
assert.equal(emits.length, 2, "answer cannot precede forwarding to its recipient");
assert.equal(outbox.at(-1).to, "new-monitor");
fire("ask:cancelled", {});

// 10. Current upstream source patches in memory, idempotently, and rejects drift.
const target = path.join(
	homedir(),
	".pi",
	"agent",
	"npm",
	"node_modules",
	"pi-ask-user",
	"index.ts",
);
if (existsSync(target)) {
	const source = readFileSync(target, "utf8");
	const patched = patchAskUserSource(source);
	assert.equal(patchAskUserSource(patched), patched);
	assert.doesNotThrow(() => stripTypeScriptTypes(patched, { mode: "transform" }));
	assert.match(patched, /signal: localSignal/);
	assert.throws(() => patchAskUserSource("upstream anchors moved"), /anchor 1 matched 0/);
	assert.throws(() => patchAskUserSource("ASK_ANSWER_EVENT"), /Legacy remote-answer patch/);
	assert.equal(readFileSync(target, "utf8"), source, "installed source remains untouched");
}

// 11. Exercise the injected helper, not an imitation of its race/cleanup logic.
const helperSource = stripTypeScriptTypes(REMOTE_HELPERS.replaceAll("export const", "const"));
const env = {};
const { runRemoteAsk, coerceRemoteAnswer } = runInNewContext(`${helperSource}\n({ runRemoteAsk, coerceRemoteAnswer })`, {
	AbortController, globalThis: { crypto: globalThis.crypto }, process: { env },
	parseBooleanPreference: (value) => value === "1",
	createSelectionResponse: (selections, comment) => ({ kind: "selection", selections, comment }),
	createFreeformResponse: (text) => text ? ({ kind: "freeform", text }) : null,
});
assert.equal(coerceRemoteAnswer({ text: "Unknown" }, ask.options, false, false, false), null);
assert.equal(coerceRemoteAnswer({ selections: ["Ship", "Hold"] }, ask.options, false, false, false), null);
let answerHandler;
let remoteId;
let disposed = 0;
let emitted = 0;
const remotePi = { events: {
	on: (_name, handler) => { answerHandler = handler; return () => { disposed++; }; },
	emit: (_name, payload) => { emitted++; remoteId = payload.askId; },
} };
assert.equal(await runRemoteAsk(remotePi, ask, false, false, false, undefined, async () => "local"), "local");
assert.equal(emitted, 0, "disabled bridge is inert");
env.PI_ASK_USER_REMOTE_ANSWERS = "1";
let localSignal;
const pendingAnswer = runRemoteAsk(remotePi, ask, false, false, false, undefined, (signal) => {
	localSignal = signal;
	return new Promise((resolve) => signal.addEventListener("abort", () => resolve(null), { once: true }));
});
await Promise.resolve();
answerHandler({ askId: remoteId, text: "Invalid" });
assert.equal(localSignal.aborted, false);
answerHandler({ askId: remoteId, text: "Ship" });
assert.equal((await pendingAnswer).selections[0], "Ship");
assert.equal(localSignal.aborted, true, "remote winner closes losing local UI");
assert.equal(disposed, 1);
assert.equal(await runRemoteAsk(remotePi, ask, false, false, false, undefined, async () => "local"), "local");
assert.equal(disposed, 2, "local winner unsubscribes remote channel");
await assert.rejects(runRemoteAsk(remotePi, ask, false, false, false, undefined, async () => { throw new Error("UI failed"); }), /UI failed/);
assert.equal(disposed, 3, "thrown UI error still cleans up");
const caller = new AbortController();
const cancelled = runRemoteAsk(remotePi, ask, false, false, false, caller.signal, (signal) => new Promise((resolve) => signal.addEventListener("abort", () => resolve(null), { once: true })));
await Promise.resolve();
caller.abort();
assert.equal(await cancelled, null);
assert.equal(disposed, 4, "caller abort cleans up");
assert.equal(await runRemoteAsk(remotePi, ask, false, false, false, AbortSignal.abort(), async () => assert.fail("cancelled call must not prompt")), null);

console.log("ok - ask_user remote-answer bridge and optional 0.16 patch");
