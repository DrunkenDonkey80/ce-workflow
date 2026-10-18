#!/usr/bin/env node
import assert from "node:assert/strict";
import { createJiti } from "jiti";
const { ask, publish, HUB_PREFIX } = await createJiti(import.meta.url).import("../extensions/hub-channel.ts");

// A ui that behaves like Pi's RPC createDialogPromise: signal/timeout resolve undefined and drop the request.
const statuses = [], pending = new Map();
const ui = {
	setStatus: (key, text) => statuses.push([key, text]),
	input: (title, placeholder, { signal, timeout } = {}) => new Promise(resolve => {
		const request = { title, payload: JSON.parse(placeholder) };
		const done = value => { if (!pending.has(request.payload.id)) return; pending.delete(request.payload.id); clearTimeout(timer); resolve(value); };
		const timer = timeout ? setTimeout(() => done(undefined), timeout) : undefined;
		signal?.addEventListener("abort", () => done(undefined), { once: true });
		pending.set(request.payload.id, { request, answer: done });
	}),
};
const only = () => [...pending.values()][0];
const closed = () => statuses.filter(([key]) => key === `${HUB_PREFIX}closed`).map(([, text]) => JSON.parse(text).id);
const old = process.env.PI_HUB;

try {
	delete process.env.PI_HUB;
	assert.equal(publish(ui, "mode", { research: true }), false, "inactive without PI_HUB");
	await assert.rejects(ask(ui, "ask", {}), /only active/);
	assert.equal(statuses.length, 0);
	process.env.PI_HUB = "1";

	// Answered: payload carries id and data unchanged; answer is parsed JSON.
	const data = { question: "Ship?\r\n\u2028\"x\"", options: ["a"] };
	let result = ask(ui, "ask", data);
	const { request, answer } = only();
	assert.equal(request.title, "pi-hub:ask");
	assert.deepEqual(request.payload.data, data);
	answer(JSON.stringify({ selections: ["a"] }));
	assert.deepEqual(await result, { selections: ["a"] });
	assert.deepEqual(closed(), [request.payload.id], "closed is published after every ask");

	// Timeout: undefined, request dropped, closed published.
	result = ask(ui, "ask", data, { timeout: 20 });
	const timedOut = only().request.payload.id;
	assert.equal(await result, undefined);
	assert.equal(pending.size, 0);
	assert.equal(closed().at(-1), timedOut);

	// Intercom answers first: the caller aborts; a late hub answer is ignored.
	const controller = new AbortController();
	result = ask(ui, "ask", data, { signal: controller.signal });
	const late = only();
	controller.abort();
	assert.equal(await result, undefined);
	late.answer(JSON.stringify({ selections: ["late"] }));
	assert.equal(closed().at(-1), late.request.payload.id);

	// Already aborted: no form at all. Malformed answer counts as cancelled.
	assert.equal(await ask(ui, "ask", data, { signal: AbortSignal.abort() }), undefined);
	assert.equal(pending.size, 0);
	result = ask(ui, "ask", data);
	only().answer("not json");
	assert.equal(await result, undefined);

	assert.equal(publish(ui, "mode", { research: true }), true);
	assert.deepEqual(statuses.at(-1), ["pi-hub:mode", "{\"research\":true}"]);
	publish(ui, "mode", undefined);
	assert.deepEqual(statuses.at(-1), ["pi-hub:mode", undefined]);
	console.log("hub channel ok");
} finally {
	if (old === undefined) delete process.env.PI_HUB; else process.env.PI_HUB = old;
}
