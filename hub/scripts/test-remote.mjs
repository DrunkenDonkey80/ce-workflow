// H6-01: remote access through one `tailscale serve` on the hub's port (fake tailscale), owner login, device pairing
// approved on the local hub, revoke closing open streams at once, and never Funnel.
import assert from "node:assert/strict";
import { mock } from "node:test";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hub-remote-"));
process.env.PI_CODING_AGENT_DIR = root;
const { startHub } = await import("../src/hub.ts");
const { createDeviceRegistry, tailscaleCommand } = await import("../src/remote.ts");
const windowsTailscale = "/mnt/c/Program Files/Tailscale/tailscale.exe";
assert.equal(tailscaleCommand("linux", true, candidate => candidate === windowsTailscale), windowsTailscale, "WSL reuses Windows Tailscale without depending on PATH");
assert.equal(tailscaleCommand("linux", true, () => false), "tailscale", "WSL without Windows Tailscale keeps the native command");
assert.equal(tailscaleCommand("linux", false, () => true), "tailscale", "plain Linux never uses Windows Tailscale");
assert.equal(tailscaleCommand("win32", false, () => true), path.join(process.env.ProgramFiles || "C:\\Program Files", "Tailscale", "tailscale.exe"), "Windows keeps its standard location");
assert.equal(tailscaleCommand("darwin", false, () => true), "/Applications/Tailscale.app/Contents/MacOS/Tailscale", "macOS keeps its standard location");
const folder = path.join(root, "proj");
fs.mkdirSync(folder);
// H6-02: a phone paired with ce-workflow's /wo share, plus one expired device that is not carried over.
const oldDir = path.join(root, "ce-workflow", "remote");
const oldCookie = await createDeviceRegistry(oldDir).pair("Old phone", "me@example.com");
await createDeviceRegistry(oldDir, () => Date.now() - 100 * 86_400_000).pair("Expired", "me@example.com");

// Fake tailscale: status JSON for a ready tailnet; every call is recorded.
const calls = [];
let ready = true;
const run = async (command, args) => {
	calls.push(args.join(" "));
	if (args[0] === "status") return { code: 0, killed: false, stderr: "", stdout: JSON.stringify(ready
		? { BackendState: "Running", Self: { DNSName: "pc.tail.ts.net.", UserID: 7 }, CurrentTailnet: { MagicDNSEnabled: true }, CertDomains: ["pc.tail.ts.net"], User: { 7: { LoginName: "me@example.com" } } }
		: { BackendState: "Running", Self: { DNSName: "pc.tail.ts.net.", UserID: 7 }, CurrentTailnet: { MagicDNSEnabled: true }, CertDomains: [], User: { 7: { LoginName: "me@example.com" } } }) };
	return { code: 0, killed: false, stderr: "", stdout: "" };
};
const opened = [];
mock.timers.enable({ apis: ["setInterval"] });
// H-04 (C9): a spy app installer; any call that is not status would change files or the login entry.
const appCalls = [];
const spy = name => (...args) => { appCalls.push(name); return { supported: true, installed: false, version: null, staged: null, latest: "0.1.0", running: false, login: false, args }; };
// Issue #6: at hub start a newly staged build restarts the running app once.
const restarts = [];
const app = { autoStage: async () => ({ staged: "0.2.0", running: true }), restart: () => restarts.push(1), status: spy("status"), install: spy("install"), stage: spy("stage"), uninstall: spy("uninstall"), setLogin: spy("login") };
const hub = await startHub({ command: [process.execPath, fileURLToPath(new URL("./fake-pi.mjs", import.meta.url))], usage: false, run, openUrl: url => opened.push(url), app });
const { port, localKey } = hub.config, remoteHost = `pc.tail.ts.net:${port}`, remoteOrigin = `https://${remoteHost}`;
const local = async (route, body) => {
	const response = await fetch(`http://127.0.0.1:${port}${route}`, { method: body ? "POST" : "GET", headers: { "x-hub-key": localKey, "content-type": "application/json" }, body: body && JSON.stringify(body) });
	return { status: response.status, body: await response.json() };
};
// What tailscale serve forwards: the tailnet Host, https proto and the verified login. fetch cannot set Host, so http.request.
const remote = (route, { method = "GET", cookie, login = "me@example.com", proto = "https", origin = method === "POST" ? remoteOrigin : undefined, stream = false, body } = {}) => new Promise((resolve, reject) => {
	const headers = { ...(body ? { "content-type": "application/json" } : {}), host: remoteHost, "x-forwarded-proto": proto, "tailscale-user-login": login, "user-agent": "Mozilla/5.0 (iPhone) Safari/1", ...(cookie ? { cookie: cookie.includes("=") ? cookie : `pi_remote_${port}=${cookie}` } : {}), ...(origin ? { origin } : {}) };
	const request = http.request({ host: "127.0.0.1", port, path: route, method, headers }, response => {
		if (stream) return resolve(response);
		let text = ""; response.on("data", chunk => text += chunk); response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, text, json: () => JSON.parse(text) }));
	});
	request.on("error", reject); request.end(body && JSON.stringify(body));
});

try {
	// Remote is off until turned on: the tailnet Host is foreign and nothing is served.
	assert.equal((await remote("/")).status, 403);
	assert.deepEqual(calls, []);
	// Setup still missing: reported, not served.
	ready = false;
	const missing = await local("/api/remote", { on: true });
	assert.deepEqual([missing.body.on, missing.body.url, missing.body.missing.length], [true, undefined, 1]);
	assert.match(missing.body.missing[0], /HTTPS Certificates/);
	// Tailscale can become ready after the hub: recover without changing the saved link or restarting.
	ready = true;
	mock.timers.tick(60_000);
	await new Promise(resolve => setImmediate(resolve));
	assert.equal(hub.remote().url, `https://${remoteHost}/`, "remote access retries after Tailscale becomes ready");
	const healthyCalls = calls.length;
	mock.timers.tick(60_000);
	await new Promise(resolve => setImmediate(resolve));
	assert.equal(calls.length, healthyCalls, "a healthy mapping is left alone");
	const on = await local("/api/remote", { on: true });
	assert.equal(on.body.url, `https://pc.tail.ts.net:${port}/`);
	assert(calls.includes(`serve --bg --https=${port} http://127.0.0.1:${port}`), calls.join("\n"));
	assert.equal(JSON.parse(fs.readFileSync(path.join(root, "pi-control-hub", "config.json"), "utf8")).remote, true, "the choice is saved");

	const id = (await local("/api/sessions", { folder, name: "1" })).body.id;

	// H6-02: the old phone's cookie works without pairing again; the expired one was dropped.
	assert.equal(hub.imported, 1);
	assert.deepEqual((await local("/api/devices")).body.devices.map(device => device.label), ["Old phone"]);
	assert.equal((await remote(`/s/${id}/api/snapshot`, { cookie: oldCookie })).status, 200);
	assert.equal(await hub.devices.importFrom(path.join(oldDir, "devices.json")), 0, "imported once: the hub's own file wins");
	await local(`/api/devices/${oldCookie.split(".")[0]}/revoke`, {});

	// Only the Tailscale owner over HTTPS; the local key never works remotely.
	assert.equal((await remote("/", { login: "other@example.com" })).status, 403);
	assert.equal((await remote("/", { proto: "http" })).status, 403);
	// A leaked local link (or a saved session link) gets the pairing page, never the session or the key.
	const leaked = await remote(`/s/${id}/?token=${localKey}`);
	assert.equal(leaked.status, 200); assert.match(leaked.text, /pair-code/); assert(!leaked.text.includes(localKey));
	assert.equal((await remote(`/s/${id}/api/snapshot`)).status, 401);
	// Unpaired: the pairing page and its assets only, with no key inside.
	const pairPage = await remote("/");
	assert.equal(pairPage.status, 200); assert.match(pairPage.text, /pair-code/); assert(!pairPage.text.includes(localKey));
	const pairScript = /src="\/a\/([0-9a-f]{12})\/pair\.js"/.exec(pairPage.text);
	assert.equal((await remote(`/a/${pairScript[1]}/pair.js`)).status, 200);
	assert.equal((await remote(`/a/${pairScript[1]}/app.js`)).status, 401, "the app itself waits for pairing");
	assert.equal((await remote("/pair/start", { method: "POST", origin: "https://evil.example" })).status, 403);
	assert.equal((await remote("/pair/start", { method: "POST", origin: null })).status, 403, "a remote POST needs its Origin");

	// Pairing: the local hub sees the device and code; the code page gets the cookie once after approval.
	const stale = (await remote("/pair/start", { method: "POST" })).json();
	const started = (await remote("/pair/start", { method: "POST" })).json();
	assert.equal(opened.length, 1, "a pairing request opens the local approval page once while none is polling");
	assert.match(opened[0], /^http:\/\/127\.0\.0\.1:\d+\/\?token=/);
	assert.match(started.code, /^\d{3} \d{3}$/);
	assert.equal((await remote(`/pair/status?id=${stale.id}`)).status, 404, "a reloaded pairing page replaces its older request");
	assert.deepEqual((await local("/api/pairing")).body.pending, { code: started.code, label: "iPhone Safari", address: "unknown address", login: "me@example.com" });
	const waiting = remote(`/pair/status?id=${started.id}`);
	await new Promise(done => setTimeout(done, 100));
	assert.deepEqual((await local("/api/pairing", { approve: true })).body, { ok: true });
	const approved = await waiting;
	assert.equal(approved.json().state, "approved");
	const cookie = new RegExp(`pi_remote_${port}=([^;]+); HttpOnly; Secure; SameSite=Lax`).exec(approved.headers["set-cookie"][0])[1];
	// Another hub on the same tailnet name (WSL) has its own cookie; the old shared name still works and is renamed.
	assert.equal((await remote(`/s/${id}/api/snapshot`, { cookie: `pi_remote_1=x.y; pi_remote_${port}=${cookie}` })).status, 200, "another port's cookie does not interfere");
	const legacy = await remote(`/s/${id}/api/snapshot`, { cookie: `pi_remote=${cookie}` });
	assert.deepEqual([legacy.status, legacy.headers["set-cookie"]?.[0].startsWith(`pi_remote_${port}=${cookie};`)], [200, true], "the old cookie name is renamed, not re-paired");
	assert.equal((await remote(`/pair/status?id=${started.id}`)).status, 404, "the cookie is delivered once");
	assert.equal((await local("/api/pairing")).body.pending, null);

	// Paired: the bare address opens a session page; session pages work, the hub's own API does not.
	const home = await remote("/", { cookie });
	assert.deepEqual([home.status, home.headers.location], [302, `/s/${id}/`]);
	const page = await remote(`/s/${id}/`, { cookie });
	assert.equal(page.status, 200); assert(!page.text.includes(localKey), "remote pages never carry the local key"); assert.match(page.text, /app\.js\?token="/);
	assert.equal((await remote(`/s/${id}/api/snapshot`, { cookie })).status, 200);
	assert.equal((await remote("/api/status", { cookie })).status, 403);
	assert.equal((await remote("/api/devices", { cookie })).status, 403, "devices are managed on the local hub only");
	assert.equal((await remote(`/s/${id}/api/snapshot`, { cookie, login: "other@example.com" })).status, 403, "the cookie is bound to the owner login");
	assert.equal((await remote("/pair/start", { method: "POST", cookie })).json().paired, true);

	// D7: the Desktop app routes answer this PC's own page only. A paired phone, even holding the local key, is refused,
	// and so is a missing or wrong key; none of them reaches the installer.
	for (const action of ["install", "uninstall", "update"]) {
		assert.equal((await remote(`/s/${id}/api/app`, { method: "POST", cookie, body: { action } })).status, 403, `paired remote ${action}`);
		assert.equal((await remote(`/s/${id}/api/app?token=${localKey}`, { method: "POST", cookie, body: { action } })).status, 403, "remote with the local key");
	}
	assert.equal((await remote(`/s/${id}/api/app`, { method: "POST", body: { action: "login", on: false } })).status, 401, "unpaired remote");
	for (const key of [undefined, "wrong"]) {
		const response = await fetch(`http://127.0.0.1:${port}/s/${id}/api/app`, { method: "POST", headers: { ...(key ? { "x-hub-key": key } : {}), "content-type": "application/json" }, body: JSON.stringify({ action: "install" }) });
		assert.equal(response.status, 401, `key ${key}`);
	}
	assert.equal(restarts.length, 1, "hub start applied the staged app build");
	assert.deepEqual(appCalls, [], "no refused request reached the installer");
	assert.equal((await local(`/s/${id}/api/app`, { action: "status" })).body.latest, "0.1.0", "the local page reaches it");
	assert.equal((await local(`/s/${id}/api/app`, { action: "login", on: "yes" })).status, 400);
	assert.deepEqual(appCalls, ["status"]);

	// Revoke: refused at once, and an open event stream is closed.
	const devices = (await local("/api/devices")).body.devices;
	assert.deepEqual(devices.map(device => [device.label, device.login, "hash" in device]), [["iPhone Safari", "me@example.com", false]]);
	const events = await remote(`/s/${id}/api/events`, { cookie, stream: true });
	assert.equal(events.statusCode, 200);
	const closed = new Promise(done => events.once("close", done));
	assert.deepEqual((await local(`/api/devices/${devices[0].id}/revoke`, {})).body, { ok: true });
	await closed;
	assert.equal((await remote(`/s/${id}/api/snapshot`, { cookie })).status, 401);

	// A rejected device gets no cookie.
	const second = (await remote("/pair/start", { method: "POST" })).json();
	const denied = remote(`/pair/status?id=${second.id}`);
	await new Promise(done => setTimeout(done, 100));
	await local("/api/pairing", { approve: false });
	const deniedResult = await denied;
	assert.deepEqual([deniedResult.json().state, deniedResult.headers["set-cookie"]], ["denied", undefined]);

	// Off removes the mapping; the tailnet Host is foreign again.
	assert.equal((await local("/api/remote", { on: false })).body.url, undefined);
	assert(calls.includes(`serve --https=${port} off`));
	assert.equal((await remote("/", { cookie })).status, 403);
	const offCalls = calls.length;
	mock.timers.tick(60_000);
	await new Promise(resolve => setImmediate(resolve));
	assert.equal(calls.length, offCalls, "remote off stays off");
	assert(!calls.some(call => /funnel/i.test(call)), "never Funnel");
	console.log("remote ok");
} finally {
	await hub.stop();
	mock.timers.reset();
	fs.rmSync(root, { recursive: true, force: true, maxRetries: 5 });
}
