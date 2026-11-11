// H5-02: the session view — chat from get_messages plus older rows from the JSONL (F3), live SSE from RPC
// events, no system message to browsers (F4), reconnect, parked sessions read from their file.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hub-view-"));
process.env.PI_CODING_AGENT_DIR = root;
process.env.FAKE_PI = "compacted";
const { startHub } = await import("../src/hub.ts");
const folder = path.join(root, "proj");
fs.mkdirSync(folder);
// Tool results read from a file keep only what the chat shows: no image data, no bulky details (a 540 MB session holds screenshots).
{ const { branchMessages } = await import("../src/view.ts"), file = path.join(root, "tools.jsonl");
 fs.writeFileSync(file, JSON.stringify({ type: "message", message: { role: "toolResult", toolCallId: "t", content: [{ type: "text", text: "x".repeat(9000) }, { type: "image", data: "A".repeat(1000), mimeType: "image/png" }], details: { blob: "B".repeat(1000) } } }) + "\n");
 const [{ message }] = await branchMessages(file);
 assert.deepEqual([message.content[0].text.length, message.content[1], message.details], [4001, { type: "image" }, undefined]); }

// Parked history retains cache warm/reset markers, but never renders them as conversation rows.
{
 const { SessionView, branchMessages } = await import("../src/view.ts"), file = path.join(root, "cache.jsonl"), t = 1_760_000_000_000;
 const usage = (input, cacheRead) => ({ input, cacheRead, cacheWrite: 0, cost: { input: input * 0.000003, cacheRead: cacheRead * 0.0000003, cacheWrite: 0 } });
 const reply = (n, input, cacheRead) => ({ type: "message", message: { role: "assistant", provider: "p", model: "m", timestamp: t + n * 1000, content: [{ type: "text", text: "reply " + n }], usage: usage(input, cacheRead) } });
 const entries = [reply(0, 0, 30000), { type: "usage", kind: "cache_warm", timestamp: new Date(t + 359000).toISOString(), provider: "p", model: "m", usage: usage(0, 30000) }, reply(360, 30000, 0), { type: "compaction", timestamp: new Date(t + 361000).toISOString() }, reply(362, 30000, 0), { type: "branch_summary", timestamp: new Date(t + 363000).toISOString() }, reply(364, 30000, 0)];
 fs.writeFileSync(file, entries.map(entry => JSON.stringify(entry)).join("\n") + "\n");
 assert.equal((await branchMessages(file)).length, 7);
 const view = new SessionView({ file: () => file, idle: () => true }); await view.hydrate();
 assert.equal(view.snapshot().chat.length, 4, "reset/warm markers do not become visible rows");
 assert.equal(view.snapshot().chat[1].cacheMiss, "Cache miss: 30,000 tokens re-billed (~$0.08)", "warming updated the idle clock");
 assert(!view.snapshot().chat[2].cacheMiss && !view.snapshot().chat[3].cacheMiss, "compaction and branch summary reset the baseline");
 view.close();
}

// A tree session: 50 messages on the current branch plus one abandoned branch entry that must not show.
const writeSession = (name, count) => {
	const file = path.join(folder, `${name}.jsonl`), lines = [{ type: "session", id: "root" }];
	let parent = "root";
	for (let i = 0; i < count; i++) {
		const id = `m${i}`, role = i % 2 ? "assistant" : "user";
		lines.push({ type: "message", id, parentId: parent, message: { role, content: [{ type: "text", text: `${name} ${i} ` + "x".repeat(i === 10 ? 3000 : 0) }], timestamp: 1_760_000_000_000 + i * 1000 } });
		if (i === 20) lines.push({ type: "message", id: "dead", parentId: id, message: { role: "user", content: "abandoned branch", timestamp: 1_760_000_020_500 } });
		parent = id;
	}
	fs.writeFileSync(file, lines.map(line => JSON.stringify(line)).join("\n") + "\n");
	return file;
};

const hub = await startHub({ command: [process.execPath, fileURLToPath(new URL("./fake-pi.mjs", import.meta.url))], usage: false });
const { port, localKey } = hub.config;
const get = async (id, route) => { const response = await fetch(`http://127.0.0.1:${port}/s/${id}/api/${route}`, { headers: { authorization: `Bearer ${localKey}`, connection: "close" } }); return { status: response.status, body: await response.json() }; };

/** Opens the page's event stream; `next(test)` resolves with the first frame (old or new) that passes the test. */
async function events(id) {
	const controller = new AbortController(), frames = [], waiting = [];
	const response = await fetch(`http://127.0.0.1:${port}/s/${id}/api/events?token=${localKey}`, { signal: controller.signal });
	assert.equal(response.status, 200);
	assert.match(response.headers.get("content-type"), /text\/event-stream/);
	(async () => {
		const decoder = new TextDecoder(); let text = "";
		try {
			for await (const chunk of response.body) {
				text += decoder.decode(chunk, { stream: true });
				let end;
				while ((end = text.indexOf("\n\n")) >= 0) {
					const raw = text.slice(0, end); text = text.slice(end + 2);
					const event = /^event: (.+)$/m.exec(raw)?.[1], data = /^data: (.+)$/m.exec(raw)?.[1];
					if (!event) continue;
					const frame = { event, data: JSON.parse(data), raw };
					frames.push(frame);
					for (const wait of [...waiting]) if (wait.test(frame)) { waiting.splice(waiting.indexOf(wait), 1); wait.resolve(frame); }
				}
			}
		} catch {}
	})();
	const next = test => new Promise((resolve, reject) => {
		const found = frames.find(test); if (found) return resolve(found);
		const timer = setTimeout(() => reject(new Error("no matching frame")), 5000);
		waiting.push({ test, resolve: frame => { clearTimeout(timer); resolve(frame); } });
	});
	return { frames, next, close: () => controller.abort() };
}

try {
	const record = hub.registry.add({ name: "1", folder, sessionFile: writeSession("live", 50), state: "parked" });
	await hub.host.resume(record.id);
	const stream = await events(record.id);
	const { data: snapshot } = await stream.next(frame => frame.event === "snapshot");
	// get_messages gave the last 3 (compacted); older ones exist in the file.
	assert.deepEqual(snapshot.chat.map(row => row.text.trim()), ["live 47", "live 48", "live 49"]);
	assert.equal(snapshot.more, true, "older chat than the compaction is offered");
	assert.equal(snapshot.activity.working, false);
	assert.equal(hub.host.live.get(record.id).viewers, 1, "an open page counts as a viewer (D16)");

	// Paging back walks the file's current branch, 20 rows at a time, without the abandoned branch.
	const seen = [...snapshot.chat];
	for (let before = seen[0].id, more = true; more;) {
		const { status, body } = await get(record.id, `rows?before=${encodeURIComponent(before)}`);
		assert.equal(status, 200, JSON.stringify(body));
		assert(body.rows.length <= 20);
		seen.unshift(...body.rows); before = body.rows[0]?.id; more = body.more;
		assert(seen.length < 100, "paging ends");
	}
	assert.deepEqual(seen.map(row => Number(row.text.split(" ")[1])), Array.from({ length: 50 }, (_, i) => i));
	assert(!seen.some(row => row.text.includes("abandoned")), "only the current branch");
	// An excerpted older row loads whole by id.
	const long = seen.find(row => row.text.startsWith("live 10"));
	const full = await get(record.id, `row?id=${encodeURIComponent(long.id)}`);
	assert.equal(full.status, 200);
	assert.equal(full.body.text.length, "live 10 ".length + 3000);
	assert.equal((await get(record.id, "row?id=user_1")).status, 404);

	// Live: a prompt streams as delta frames; the system message never reaches the page (F4).
	await hub.host.prompt(record.id, "hi");
	await stream.next(frame => frame.event === "activity" && frame.data.working === true);
	const done = await stream.next(frame => frame.event === "delta" && frame.data.role === "assistant" && !frame.data.streaming);
	const text = stream.frames.filter(frame => frame.event === "delta" && frame.data.id === done.data.id).reduce((value, frame) => value.slice(0, frame.data.offset) + frame.data.text, "");
	assert.equal(text, "echo: hi", "deltas rebuild the streamed text");
	await stream.next(frame => frame.event === "activity" && frame.data.working === false);
	await stream.next(frame => frame.event === "sessions"); // the sidebar reloads without waiting for its poll
	assert(!stream.frames.some(frame => frame.raw.includes("SYSTEM PROMPT")), "no system message frames");
	const after = (await get(record.id, "snapshot")).body;
	assert.deepEqual(after.chat.slice(-2).map(row => row.text), ["hi", "echo: hi"], "snapshot endpoint");
	assert(!JSON.stringify(after).includes("SYSTEM PROMPT"));
	// Background subagents after the run: the page hears the child's published list live and in snapshots (top bar Subagents…).
	await hub.host.prompt(record.id, `/state ${JSON.stringify({ plan: null, modes: {}, compacting: false, subagents: [{ id: "r1", label: "researcher", state: "running" }] })}`);
	await stream.next(frame => frame.event === "activity" && frame.data.subagents?.[0]?.id === "r1");
	assert.equal((await get(record.id, "snapshot")).body.activity.subagents[0]?.id, "r1");
	await hub.host.prompt(record.id, `/state ${JSON.stringify({ plan: null, modes: {}, compacting: false, subagents: [] })}`);
	await stream.next(frame => frame.event === "activity" && Array.isArray(frame.data.subagents) && !frame.data.subagents.length);

	// Reconnect: a second stream starts from a fresh snapshot that has the new rows.
	stream.close();
	await new Promise(resolve => setTimeout(resolve, 100));
	assert.equal(hub.host.live.get(record.id).viewers, 0, "closing the page releases the viewer");
	const again = await events(record.id);
	const { data: fresh } = await again.next(frame => frame.event === "snapshot");
	assert.equal(fresh.chat.at(-1).text, "echo: hi");
	again.close();

	// A parked session shows its file; nothing is started.
	const parked = hub.registry.add({ name: "2", folder, sessionFile: writeSession("parked", 30), state: "parked" });
	const view = await get(parked.id, "snapshot");
	assert.equal(view.status, 200);
	assert.equal(view.body.chat.at(-1).text.trim(), "parked 29");
	assert.equal(hub.host.live.has(parked.id), false, "viewing does not resume");
	assert.equal((await get("00000000-0000-0000-0000-000000000000", "snapshot")).status, 404);
	console.log("view ok");
} finally {
	await hub.stop();
	fs.rmSync(root, { recursive: true, force: true });
}
