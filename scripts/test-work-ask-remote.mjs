#!/usr/bin/env node
// Unit test for extensions/work-ask-remote.js (intercom answer channel for
// ask_user) and a source-level check that the installed pi-ask-user carries
// the remote-answer patch. The live end-to-end is test-ask-remote-live.mjs.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
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

// 6. Valid answer: single title emits ask:answer and clears just that ask.
fire("message_end", {
	message: {
		customType: "intercom_message",
		details: { from: { id: "monitor-1" }, bodyText: `ANSWER ${askId}: Hold` },
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

// 10. The installed pi-ask-user carries the remote-answer patch and an opt-in.
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
	assert.match(
		source,
		/ASK_PENDING_EVENT/,
		"patched pi-ask-user emits ask:pending",
	);
	assert.match(
		source,
		/ASK_ANSWER_EVENT/,
		"patched pi-ask-user accepts ask:answer",
	);
	assert.match(
		source,
		/PI_ASK_USER_REMOTE_ANSWERS/,
		"remote answers stay opt-in",
	);
}

console.log("ok - ask_user remote-answer bridge");
