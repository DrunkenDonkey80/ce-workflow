// H5-03: the page API under /s/<id>/api/ (endpoint map in plan 0db155f7 Findings) and the request checks kept from plan3-web.
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { saveDiagram } from "pi-work-orchestrator/extensions/plan3-diagram.ts";

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

	// Channel asks: dialog by askId, answered once with the page's fields as JSON.
	const answered = new Promise(r => { const l = (sid, req) => { if (sid === id && req.method === "notify") { hub.host.off("ui", l); r(req.message); } }; hub.host.on("ui", l); });
	void hub.host.prompt(id, "/hubask");
	const ask = await until(() => hub.host.pendingDialogs(id).find(d => d.title === "pi-hub:ask"));
	const askId = "ask-1"; ask.placeholder = JSON.stringify({ id: "c", data: { askId, question: "Pick?" } }); // the fake's data has no askId
	assert.deepEqual((await get(id, `dialog?id=${askId}`)).body, { askId, question: "Pick?" });
	assert.equal((await post(id, "answer", { askId, text: "x", bogus: 1 })).status, 400);
	assert.equal((await post(id, "answer", { askId, text: "yes", target: "aaaaaaaa" })).status, 200);
	assert.equal(await answered, `answer:${JSON.stringify({ askId, text: "yes" })}`);
	assert.equal((await post(id, "answer", { askId, text: "again" })).status, 404, "answered once");

	// Stop aborts the run.
	void hub.host.prompt(id, "hold");
	await until(() => hub.host.live.get(id).running);
	assert.equal((await post(id, "stop", {})).status, 200);
	await until(() => !hub.host.live.get(id).running);

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
