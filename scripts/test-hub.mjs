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
	console.log("hub ok");
} finally {
	cli("stop", "--force");
	fs.rmSync(root, { recursive: true, force: true });
}
