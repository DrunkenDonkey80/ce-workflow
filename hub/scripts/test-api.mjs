// H5-03: the page API under /s/<id>/api/ (endpoint map in plan 0db155f7 Findings) and the request checks kept from plan3-web.
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { saveDiagram } from "../../extensions/plan3-diagram.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hub-api-"));
process.env.PI_CODING_AGENT_DIR = root;
const { startHub } = await import("../src/hub.ts");
const folder = path.join(root, "proj");
fs.mkdirSync(path.join(folder, "docs", "plans"), { recursive: true });
const plan = (id, title, updated, status = "active") => {
	const file = path.join(folder, "docs", "plans", `2026-10-18-${title.toLowerCase()}-${id}-plan3.md`);
	fs.writeFileSync(file, `---\nplan3: true\nstatus: ${status}\ncreated: 2026-10-18\nupdated: ${updated}\n---\n\n# ${title}\n\n## Steps\n\n- [x] **A-01** one\n- [ ] **A-02** two\n`);
	return { kind: "plan", plan: { id, file, title } };
};
const older = plan("aaaaaaaa", "Older", "2026-10-18T10:00:00Z"), newer = plan("bbbbbbbb", "Newer", "2026-10-18T12:00:00Z");
plan("cccccccc", "Finished", "2026-10-18T13:00:00Z", "complete");
await saveDiagram(folder, older, { version: 1, kind: "plan", plan: "aaaaaaaa", title: "Older", revision: 0, nodes: [{ id: "api", label: "API", kind: "service" }], edges: [], notes: [] }, 0);
fs.writeFileSync(path.join(folder, "notes.txt"), "hello\n");
fs.writeFileSync(path.join(folder, ".env"), "SECRET=1\n");
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
fs.writeFileSync(path.join(folder, "shot.png"), png);

const hub = await startHub({ command: [process.execPath, fileURLToPath(new URL("./fake-pi.mjs", import.meta.url))] });
const { port, localKey } = hub.config;
const origin = `http://127.0.0.1:${port}`;
const auth = { authorization: `Bearer ${localKey}`, connection: "close" };
const get = async (id, route) => { const r = await fetch(`${origin}/s/${id}/api/${route}`, { headers: auth }); return { status: r.status, body: r.headers.get("content-type")?.startsWith("application/json") ? await r.json() : Buffer.from(await r.arrayBuffer()), headers: r.headers }; };
const post = async (id, route, data, headers = {}) => {
	const r = await fetch(`${origin}/s/${id}/api/${route}`, { method: "POST", headers: { ...auth, origin, "content-type": "application/json", ...headers }, body: Buffer.isBuffer(data) ? data : JSON.stringify(data) });
	return { status: r.status, body: await r.json() };
};
/** A raw request, so Host can be anything (fetch always sets it from the URL). */
const rawGet = (pathname, headers) => new Promise((resolve, reject) => http.get({ host: "127.0.0.1", port, path: pathname, headers }, response => { response.resume(); resolve(response.statusCode); }).on("error", reject));
const until = async test => { for (let i = 0; i < 200; i++) { const value = await test(); if (value) return value; await new Promise(r => setTimeout(r, 10)); } throw new Error("timed out"); };

try {
	fs.writeFileSync(path.join(folder, "s.jsonl"), "");
	const record = hub.registry.add({ name: "1", folder, sessionFile: path.join(folder, "s.jsonl"), state: "parked" });
	const id = record.id;

	// Parked: plans, diagram, files and images come from the folder; nothing starts.
	const plans = await get(id, "plans");
	assert.deepEqual(plans.body, { current: "bbbbbbbb", plans: [{ id: "bbbbbbbb", title: "Newer", done: 1, total: 2 }, { id: "aaaaaaaa", title: "Older", done: 1, total: 2 }] });
	assert.equal((await get(id, "diagram")).body.target.id, "bbbbbbbb", "the displayed plan is the current one");
	const diagram = await get(id, "diagram?target=aaaaaaaa");
	assert.deepEqual(diagram.body.diagram.nodes.map(node => node.label), ["API"]);
	assert.equal((await get(id, "diagram?target=product")).body.diagram.kind, "product");
	assert.equal((await get(id, "diagram?target=dddddddd")).status, 404);
	assert.equal((await get(id, "diagram?target=../x")).status, 400);
	const files = (await get(id, "files")).body.files.map(file => file.path);
	assert(files.includes("notes.txt") && !files.includes(".env"), "secret-shaped files stay hidden");
	assert.equal((await get(id, "file?path=notes.txt")).body.content, "hello\n");
	assert.equal((await get(id, "file?path=.env")).status, 403);
	assert.equal((await get(id, "file?path=../outside")).status, 403);
	const image = await get(id, `image?path=${encodeURIComponent(path.join(folder, "shot.png"))}`);
	assert.equal(image.status, 200);
	assert.equal(image.headers.get("content-type"), "image/png");
	assert.equal((await get(id, "models")).status, 409, "reads that need Pi do not start a parked session");
	assert.equal(hub.host.live.has(id), false);
	const snapshot = (await get(id, "snapshot")).body;
	assert.deepEqual(snapshot.target, { kind: "plan", id: "bbbbbbbb" });
	assert.equal(snapshot.current, "bbbbbbbb");
	assert.deepEqual(snapshot.status, { folder: "proj", tab: "1", modes: { research: "off", night: "off" }, model: null, effort: null, context: null });
	assert.match(snapshot.build, /^[0-9a-f]{12}$/);

	// Paste: magic bytes decide; the saved path serves back as a thumbnail.
	const pasted = await post(id, "paste", png, { "content-type": "image/png" });
	assert.equal(pasted.status, 200);
	assert.equal((await get(id, `image?name=${encodeURIComponent(path.basename(pasted.body.path))}`)).status, 200);
	assert.equal((await post(id, "paste", Buffer.from("not an image"), { "content-type": "image/png" })).status, 415);
	fs.rmSync(pasted.body.path, { force: true });

	// A write starts a parked session; message goes to ce-workflow as a hub call.
	const sent = await post(id, "message", { target: "bbbbbbbb", text: "hi" });
	assert.deepEqual(sent.body, { endpoint: "/api/message", data: { target: "bbbbbbbb", text: "hi" } });
	assert.equal(hub.host.live.has(id), true);
	assert.deepEqual((await post(id, "command", { target: "bbbbbbbb", command: "review" })).body.endpoint, "/api/command");
	assert.deepEqual((await get(id, "usage")).body, { endpoint: "/api/usage", data: {} });

	// Status from RPC; model and effort through RPC with a status frame.
	const status = (await get(id, "snapshot")).body.status;
	assert.deepEqual([status.model.id, status.effort, status.context], ["fake-1", "low", 42]);
	assert.equal((await post(id, "model", { provider: "fake", id: "nope" })).status, 404);
	assert.equal((await post(id, "model", { provider: "fake", id: "fake-2", extra: 1 })).status, 400);
	assert.equal((await post(id, "model", { provider: "fake", id: "fake-2" })).body.model.id, "fake-2");
	assert.equal((await post(id, "effort", { level: "turbo" })).status, 400);
	assert.equal((await post(id, "effort", { level: "high" })).body.effort, "high");

	// Pi's published plan and diagram changes reach the snapshot; /reload restarts the session (D12).
	await hub.host.prompt(id, `/state ${JSON.stringify({ plan: { id: "aaaaaaaa", title: "Older", finishable: false }, modes: { research: "on", night: "off" }, compacting: false, subagents: [] })}`);
	const followed = (await get(id, "snapshot")).body;
	assert.deepEqual([followed.current, followed.target.id, followed.plan?.finishable, followed.status.modes.research], ["aaaaaaaa", "aaaaaaaa", false, "on"]);
	assert.equal((await get(id, "plans")).body.current, "aaaaaaaa");
	const pid = hub.host.live.get(id).rpc.process?.pid;
	assert.deepEqual((await post(id, "message", { text: " /reload " })).body, { ok: true });
	assert.equal(hub.host.live.has(id), true, "reload resumes");
	if (pid) assert.notEqual(hub.host.live.get(id).rpc.process?.pid, pid, "reload is a new Pi");

	// H5-04 forms: every open dialog is a page form keyed by its request id; snapshot, dialog and dialog_closed frames carry it.
	const notified = prefix => new Promise(r => { const l = (sid, req) => { if (sid === id && req.method === "notify" && req.message.startsWith(prefix)) { hub.host.off("ui", l); r(req.message.slice(prefix.length)); } }; hub.host.on("ui", l); });
	const frames = [], view = hub.views.get(id), publish = view.publish;
	view.publish = (event, value) => { if (event.startsWith("dialog")) frames.push([event, value]); publish(event, value); };
	const open = async (command, prefix) => {
		const before = new Set(hub.host.pendingDialogs(id).map(d => d.id)), result = notified(prefix);
		void hub.host.prompt(id, command);
		const dialog = await until(() => hub.host.pendingDialogs(id).find(d => !before.has(d.id)));
		return { askId: dialog.id, result };
	};

	// Channel ask: ask_user data as is, plus ce-workflow's own askId sent back with the answer.
	const channel = await open(`/ask ${JSON.stringify({ id: "c", data: { askId: "own-1", question: "Pick?", options: [{ title: "A" }] } })}`, "answer:");
	assert.deepEqual((await get(id, `dialog?id=${channel.askId}`)).body, { askId: channel.askId, question: "Pick?", options: [{ title: "A" }] });
	assert.deepEqual((await get(id, "snapshot")).body.dialogs.map(form => form.askId), [channel.askId], "a reconnecting page sees the open form");
	assert.deepEqual(frames.at(-1), ["dialog", { askId: channel.askId, question: "Pick?", options: [{ title: "A" }] }]);
	assert.equal((await post(id, "answer", { askId: channel.askId, text: "x", bogus: 1 })).status, 400);
	assert.deepEqual((await post(id, "answer", { askId: channel.askId, selections: ["A"], comment: "ok", target: "aaaaaaaa" })).body, { accepted: true });
	assert.deepEqual(JSON.parse(await channel.result), { selections: ["A"], comment: "ok", askId: "own-1" });
	assert.deepEqual(frames.at(-1), ["dialog_closed", { askId: channel.askId }]);
	assert.deepEqual((await post(id, "answer", { askId: channel.askId, text: "again" })).body, { accepted: false }, "first answer wins");
	assert.equal((await get(id, `dialog?id=${channel.askId}`)).status, 404);

	// Plain RPC dialogs from other extensions or Pi itself, converted both ways.
	const select = await open(`/dialog select ${JSON.stringify({ title: "Pick a mode", options: ["Fast", "Slow"] })}`, "dialog:");
	assert.deepEqual((await get(id, `dialog?id=${select.askId}`)).body, { askId: select.askId, kind: "list", title: "Pick a mode", purpose: "Choose an option to continue.", items: [{ value: "Fast", label: "Fast" }, { value: "Slow", label: "Slow" }] });
	assert.equal((await post(id, "answer", { askId: select.askId, action: "select", value: "Other" })).status, 400);
	await post(id, "answer", { askId: select.askId, action: "select", value: "Slow" });
	assert.deepEqual(JSON.parse(await select.result), { value: "Slow" });
	const back = await open(`/dialog select ${JSON.stringify({ title: "Pick", options: ["A"] })}`, "dialog:");
	await post(id, "answer", { askId: back.askId, action: "back" });
	assert.deepEqual(JSON.parse(await back.result), { cancelled: true });
	const confirm = await open(`/dialog confirm ${JSON.stringify({ title: "Allow dangerous command?", message: "rm -rf build" })}`, "dialog:");
	const card = (await get(id, `dialog?id=${confirm.askId}`)).body;
	assert.deepEqual([card.kind, card.compact, card.purpose, card.items.map(item => item.label)], ["list", true, "rm -rf build", ["Yes", "No"]]);
	await post(id, "answer", { askId: confirm.askId, action: "select", value: "yes" });
	assert.deepEqual(JSON.parse(await confirm.result), { confirmed: true });
	const refuse = await open(`/dialog confirm ${JSON.stringify({ title: "Sure?", message: "" })}`, "dialog:");
	await post(id, "answer", { askId: refuse.askId, action: "back" });
	assert.deepEqual(JSON.parse(await refuse.result), { confirmed: false }, "Esc on a confirm is No");
	const input = await open(`/dialog input ${JSON.stringify({ title: "Name?", placeholder: "e.g. Bob" })}`, "dialog:");
	assert.deepEqual((await get(id, `dialog?id=${input.askId}`)).body, { askId: input.askId, question: "Name?", context: "e.g. Bob", options: [], allowFreeform: true });
	await post(id, "answer", { askId: input.askId, text: "Ann" });
	assert.deepEqual(JSON.parse(await input.result), { value: "Ann" });
	const editor = await open(`/dialog editor ${JSON.stringify({ title: "Rules", prefill: "line 1" })}`, "dialog:");
	assert.equal((await get(id, `dialog?id=${editor.askId}`)).body.initialText, "line 1");
	await post(id, "answer", { askId: editor.askId, cancel: true });
	assert.deepEqual(JSON.parse(await editor.result), { cancelled: true });
	assert.deepEqual((await get(id, "snapshot")).body.dialogs, []);
	view.publish = publish;

	// Stop aborts the run.
	void hub.host.prompt(id, "hold");
	await until(() => hub.host.live.get(id).running);
	// One queued message taken back (edit/cancel); the others stay queued, and the page's list follows.
	await hub.host.live.get(id).rpc.send({ type: "steer", message: "keep me" });
	await hub.host.live.get(id).rpc.send({ type: "steer", message: "drop me" });
	await until(async () => (await get(id, "snapshot")).body.activity.queue.length === 2);
	assert.deepEqual((await post(id, "unqueue", { text: "drop me" })).body, { ok: true, restored: ["drop me"], delivered: false });
	await until(async () => JSON.stringify((await get(id, "snapshot")).body.activity.queue.map(item => item.text)) === '["keep me"]');
	assert.equal((await post(id, "unqueue", { text: "long gone" })).body.delivered, true, "already steered: the page posts the edit as a new message");
	await hub.host.live.get(id).rpc.send({ type: "clear_queue" });
	await hub.host.live.get(id).rpc.send({ type: "steer", message: "oops, wrong" });
	const stopped = await post(id, "stop", {});
	assert.equal(stopped.status, 200);
	assert.deepEqual(stopped.body.restored, ["oops, wrong"], "Stop takes queued messages back instead of letting abort deliver them");
	await until(() => !hub.host.live.get(id).running);

	// /new: a fresh session file, the lock moves with it, and the chat starts empty.
	const oldFile = hub.registry.get(id).sessionFile;
	assert.equal((await post(id, "message", { text: "/new" })).status, 200);
	assert.notEqual(hub.registry.get(id).sessionFile, oldFile, "registry follows Pi's new session file");
	assert.deepEqual((await get(id, "snapshot")).body.chat, [], "the page reconnects to an empty chat");

	// H5-05 session bar: folder groups with state tones, actions, Recents with Star/Unstar (D18).
	const tones = async () => Object.fromEntries((await get(id, "sessions")).body.groups.flatMap(group => group.sessions.map(session => [session.name, session.tone])));
	await get(id, "snapshot"); assert.equal((await tones())["1"], "seen");
	await hub.host.prompt(id, "hi");
	assert.equal((await until(async () => (await tones())["1"] === "unseen" && "ok")), "ok", "a run that ends with no page open is unseen");
	await get(id, "snapshot");
	assert.equal((await tones())["1"], "seen", "opening the page marks it seen");
	// S-05: an idle session with a timer is "scheduled"; the row carries the timers; the menu cancels one (own session only).
	const timer = await (await fetch(`${origin}/api/sessions/${id}/timers`, { method: "POST", headers: { "x-hub-key": localKey, connection: "close", "content-type": "application/json" }, body: JSON.stringify({ kind: "script", command: "exit 0", everyMinutes: 5 }) })).json();
	const row = async () => (await get(id, "sessions")).body.groups.flatMap(group => group.sessions).find(session => session.id === id);
	assert.equal((await row()).tone, "scheduled");
	assert.deepEqual((await row()).timers.map(t => [t.id, t.kind, t.label]), [[timer.id, "script", "exit 0"]]);
	assert.equal((await post(id, "session", { action: "cancel-timer", id, timer: "nope" })).status, 404);
	assert.equal((await post(id, "session", { action: "cancel-timer", id, timer: timer.id })).status, 200);
	assert.equal((await row()).tone, "seen");
	const created = (await post(id, "session", { action: "new", folder })).body;
	assert.equal(created.name, "2", "new sessions take the next free number");
	const missing = await post(id, "session", { action: "new", folder: path.join(root, "missing") });
	assert.deepEqual([missing.status, missing.body.error], [404, "Folder does not exist."], "a missing folder is only reported, so the page can ask");
	const made = (await post(id, "session", { action: "new", folder: path.join(root, "made", "deep"), create: true })).body;
	assert.equal(fs.statSync(path.join(root, "made", "deep")).isDirectory(), true, "create: true makes the folder (and its parents)");
	await hub.host.park(made.id); hub.registry.remove(made.id); // keep the later group checks to their own folders
	assert.equal((await post(id, "session", { action: "new", folder: "relative" })).status, 404, "only absolute paths");
	assert.equal((await post(id, "session", { action: "rename", id: created.id, name: "Docs" })).status, 200);
	assert.equal((await post(id, "session", { action: "park", id: created.id })).status, 200);
	assert.equal((await tones()).Docs, "parked");
	assert.equal((await post(id, "session", { action: "unstar", id })).status, 409, "a live session is parked before unstarring");
	assert.equal((await post(id, "session", { action: "bogus", id })).status, 400);
	assert.equal((await post(id, "session", { action: "park", id: "00000000-0000-0000-0000-000000000000" })).status, 404);
	const other = path.join(root, "other"), recentDir = path.join(root, "sessions", "--other--"), recentFile = path.join(recentDir, "r.jsonl");
	fs.mkdirSync(other); fs.mkdirSync(recentDir, { recursive: true });
	fs.writeFileSync(recentFile, JSON.stringify({ type: "session", version: 3, id: "r1", timestamp: "2026-10-18T00:00:00Z", cwd: other }) + "\n");
	const listed = (await get(id, "sessions")).body;
	assert.deepEqual(listed.recents.map(item => [item.file, item.label]), [[recentFile, "other"]]);
	const starred = (await post(id, "session", { action: "star", file: recentFile, name: "" })).body;
	assert.equal(starred.name, "1");
	const after = (await get(id, "sessions")).body;
	assert.deepEqual([after.recents.length, after.groups.map(group => group.label)], [0, ["other", "proj"]], "starring moves it into its folder's group");
	assert.equal((await post(id, "session", { action: "star", file: recentFile })).status, 404, "already starred");
	assert.equal((await post(id, "session", { action: "unstar", id: starred.id })).status, 200);
	assert(fs.existsSync(recentFile), "unstar keeps the file");
	assert.equal((await get(id, "sessions")).body.recents.length, 1, "back in Recents");

	// Request checks.
	assert.equal(await rawGet(`/s/${id}/api/plans?token=${localKey}`, { host: `evil.example:${port}` }), 403, "foreign Host (DNS rebinding)");
	assert.equal(await rawGet(`/s/${id}/api/plans?token=${localKey}`, { host: `localhost:${port}` }), 200);
	assert.equal(await rawGet(`/s/${id}/api/plans?token=${localKey}&pad=${"x".repeat(2100)}`, { host: `127.0.0.1:${port}` }), 414);
	assert.equal((await post(id, "stop", {}, { origin: "http://evil.example" })).status, 403, "foreign Origin");
	assert.equal((await post(id, "stop", {}, { "content-type": "text/plain" })).status, 415, "form posts need JSON");
	const noOrigin = await fetch(`${origin}/s/${id}/api/stop`, { method: "POST", headers: { authorization: `Bearer ${localKey}`, "content-type": "application/json" }, body: "{}" });
	assert.equal(noOrigin.status, 403, "a page POST without Origin");
	assert.equal((await post(id, "message", { text: "x".repeat(70_000) })).status, 413);
	assert.equal((await post(id, "nothing", {})).status, 404);
	const headers = (await get(id, "plans")).headers;
	assert.equal(headers.get("x-content-type-options"), "nosniff");
	assert.match(headers.get("content-security-policy"), /default-src 'none'/);
	assert.equal(headers.get("referrer-policy"), "no-referrer");
	console.log("api ok");
} finally {
	await hub.stop();
	fs.rmSync(root, { recursive: true, force: true });
}
