import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hub-cli-"));
const folder = path.join(root, "proj");
fs.mkdirSync(folder);
const fake = fileURLToPath(new URL("./fake-pi.mjs", import.meta.url));
const env = { ...process.env, PI_CODING_AGENT_DIR: root, PI_HUB_PI_COMMAND: JSON.stringify([process.execPath, fake]) };
const cli = (...args) => {
	try { return { code: 0, out: execFileSync(process.execPath, [fileURLToPath(new URL("../src/cli.ts", import.meta.url)), ...args], { env, encoding: "utf8", stdio: "pipe" }) }; }
	catch (error) { return { code: error.status, out: error.stdout + error.stderr }; }
};
const data = path.join(root, "pi-control-hub");
const api = async (route, body) => {
	const { localKey } = JSON.parse(fs.readFileSync(path.join(data, "config.json"), "utf8"));
	const { port } = JSON.parse(fs.readFileSync(path.join(data, "hub.json"), "utf8"));
	const response = await fetch(`http://127.0.0.1:${port}${route}`, { method: body ? "POST" : "GET", headers: { "x-hub-key": localKey, connection: "close" }, body: body && JSON.stringify(body) });
	return { status: response.status, body: await response.json() };
};

try {
	assert.match(cli("status").out, /Not running/);
	assert.match(cli("start").out, /Started: pid \d+/);
	const port = JSON.parse(fs.readFileSync(path.join(data, "config.json"), "utf8")).port;
	assert.match(cli("start").out, /Already running/, "one running hub only");

	// The key is required.
	assert.equal((await fetch(`http://127.0.0.1:${port}/api/status`)).status, 401);

	const created = await api("/api/sessions", { folder, name: "1" });
	assert.equal(created.status, 200, JSON.stringify(created.body));
	const id = created.body.id;
	assert.match(cli("status").out, /idle {2}1 {2}/);
	// `pi-hub new` takes the next free number in the folder's group.
	const second = /\/s\/([0-9a-f-]{36})\//.exec(cli("new", folder).out)?.[1];
	assert(second, "`pi-hub new` prints the session page");
	assert.equal((await api(`/api/sessions/${second}/park`, {})).status, 200);
	assert.match(cli("status").out, /idle {2}1 {2}.*\n {2}parked +2 {2}/s, "parked sessions list with their state");

	// H5-01: the browser app under /s/<session>/ with relative URLs and build-fingerprinted assets.
	{
		const { localKey } = JSON.parse(fs.readFileSync(path.join(data, "config.json"), "utf8"));
		const get = (url, headers = {}) => fetch(url, { redirect: "manual", headers: { connection: "close", ...headers } });
		const base = `http://127.0.0.1:${port}/s/${id}`;
		assert.equal((await get(`${base}/`)).status, 401, "the page needs the key");
		const moved = await get(`${base}?token=${localKey}`);
		assert.deepEqual([moved.status, moved.headers.get("location")], [301, `/s/${id}/?token=${localKey}`]);
		assert.equal((await get(`http://127.0.0.1:${port}/s/00000000-0000-0000-0000-000000000000/?token=${localKey}`)).status, 404);
		const html = await (await get(`${base}/?token=${localKey}`)).text();
		const [, build] = /src="a\/([0-9a-f]{12})\/app\.js\?token=([0-9a-f]+)"/.exec(html) ?? [];
		assert(build && html.includes(`?token=${localKey}`), "relative asset URLs carrying the key");
		const app = await get(`${base}/a/${build}/app.js`, { authorization: `Bearer ${localKey}` });
		assert.equal(app.headers.get("cache-control"), "private, max-age=31536000, immutable");
		const js = await app.text();
		assert(!/import type|__TOKEN__|__BUILD__/.test(js) && js.includes(`const token = "${localKey}"`), "types stripped, placeholders filled");
		assert(!/fetch\("\/|EventSource\("\//.test(js), "no root-absolute requests: every call stays under /s/<session>/");
		for (const file of ["layout.js", "diagram.js", "prompts.js", "files.js", "stream.js", "vendor/rough.js", "styles.css"]) assert.equal((await get(`${base}/a/${build}/${file}?token=${localKey}`)).status, 200, file);
		assert.equal((await get(`${base}/a/000000000000/app.js?token=${localKey}`)).status, 404, "a stale build is refused");
	}

	// A busy session refuses a normal stop/restart (D17); --force stops anyway.
	await api(`/api/sessions/${id}/prompt`, { message: "hold" });
	const refused = cli("restart");
	assert.equal(refused.code, 1);
	assert.match(refused.out, /Busy: 1 \(working\)/);
	assert.match(cli("stop", "--force").out, /Stopped/);
	assert.equal(fs.existsSync(path.join(data, "hub.json")), false);
	assert.equal(fs.existsSync(path.join(data, "hub.lock")), false);

	// Restart restores the session that was running, on the same port (D11, D17).
	assert.match(cli("start").out, new RegExp(`127\.0\.0\.1:${port}`));
	const status = await api("/api/status");
	assert.equal(status.body.sessions[0].live, true, "running session restored");
	await api(`/api/sessions/${id}/park`, {});
	assert.match(cli("restart").out, /Stopped\.[\s\S]*Started/);
	assert.equal((await api("/api/status")).body.sessions[0].live, false, "parked session stays parked");

	// A crashed hub leaves a dead-pid lock; the next start takes it over.
	const { pid } = JSON.parse(fs.readFileSync(path.join(data, "hub.json"), "utf8"));
	process.kill(pid);
	await new Promise(r => setTimeout(r, 300));
	assert.match(cli("start").out, /Started/);
	assert.match(cli("stop").out, /Stopped/);

	// H6-04: logon start through a Run value (a scratch key here), hidden by conhost --headless.
	if (process.platform === "win32") {
		env.PI_HUB_RUN_KEY = `HKCU\\Software\\pi-control-hub-test-${process.pid}`;
		assert.match(cli("autostart").out, /Autostart off/);
		assert.match(cli("autostart", "on").out, /Autostart on.*hub\.log/);
		const value = cli("autostart", "status").out;
		assert.match(value, /^Autostart on: conhost\.exe --headless ".*node(\.exe)?" ".*cli\.ts" start\r?\n$/i);
		assert.match(cli("autostart", "off").out, /Autostart off/);
		assert.match(cli("autostart", "status").out, /Autostart off/);
	}
	console.log("hub ok");
} finally {
	cli("stop", "--force");
	if (env.PI_HUB_RUN_KEY) try { execFileSync("reg", ["delete", env.PI_HUB_RUN_KEY, "/f"], { stdio: "pipe" }); } catch { /* already gone */ }
	fs.rmSync(root, { recursive: true, force: true });
}
