// H-03: install, stage, swap detection, login entry and uninstall against a fake release server and temp folders.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createAppInstall } from "../src/app-install.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "app-install-"));
const files = { "v1.bin": Buffer.from("app build 1"), "v2.bin": Buffer.from("app build 2") };
const server = http.createServer((request, response) => {
	const body = files[path.basename(request.url)];
	response.writeHead(body ? 200 : 404).end(body);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}/releases/download/`;
const sha = name => createHash("sha256").update(files[name]).digest("hex");
const windows = process.platform === "win32", asset = windows ? "windows-x64" : "linux-x64";
let pin = { version: "0.1.0", assets: { [asset]: { url: base + "app-v0.1.0/v1.bin", sha256: sha("v1.bin") } } };
const runKey = `HKCU\\Software\\pi-hub-app-test-${process.pid}`;
const app = createAppInstall({ platform: windows ? "win32" : "linux", arch: "x64", home: root, localAppData: path.join(root, "local"), appData: path.join(root, "roaming"), dataDir: path.join(root, "hub data"), release: () => pin, releaseBase: base, runKey });
const listed = () => fs.existsSync(root) ? fs.readdirSync(root, { recursive: true }).filter(name => fs.statSync(path.join(root, name)).isFile()) : [];
let holder;
try {
	assert.deepEqual(app.status(), { supported: true, installed: false, version: null, staged: null, latest: "0.1.0", running: false, login: false });
	assert.equal((await app.autoStage()).installed, false, "the hourly check never installs");
	await assert.rejects(app.stage(), /not installed/);

	// Refusals: a URL outside the release path, a hash mismatch; neither leaves a file.
	pin = { version: "0.1.0", assets: { [asset]: { url: "http://evil.example/v1.bin", sha256: sha("v1.bin") } } };
	await assert.rejects(app.install(), /not a release of this repo/);
	pin = { version: "0.1.0", assets: { [asset]: { url: base + "app-v0.1.0/v1.bin", sha256: sha("v2.bin") } } };
	await assert.rejects(app.install(), /does not match the pinned SHA-256/);
	assert.deepEqual(listed(), [], "refused downloads write nothing");

	pin = { version: "0.1.0", assets: { [asset]: { url: base + "app-v0.1.0/v1.bin", sha256: sha("v1.bin") } } };
	const installed = await app.install();
	assert.deepEqual([installed.installed, installed.version, installed.login], [true, "0.1.0", true], "login start on by default (D10)");
	assert.equal(fs.readFileSync(app.paths.file, "utf8"), "app build 1");
	assert.equal(JSON.parse(fs.readFileSync(path.join(app.paths.dir, "app.json"), "utf8")).hubData, path.join(root, "hub data"));
	assert(fs.existsSync(app.paths.shortcut), "Start-menu shortcut / .desktop file");
	if (windows) assert.match(execFileSync("reg", ["query", runKey, "/v", "PiHubApp"], { encoding: "utf8" }), /--hidden --hub-data ".*hub data"/);
	else assert.match(fs.readFileSync(app.paths.autostartFile, "utf8"), /--hidden --hub-data/);
	assert.equal(app.setLogin(false).login, false); assert.equal(app.setLogin(true).login, true);

	// Stage: a newer pin downloads to .next; the running file stays as it was.
	pin = { version: "0.2.0", assets: { [asset]: { url: base + "app-v0.2.0/v2.bin", sha256: sha("v2.bin") } } };
	const staged = await app.autoStage(); // H-05: the hourly check (C2)
	assert.deepEqual([staged.version, staged.staged, staged.latest], ["0.1.0", "0.2.0", "0.2.0"]);
	assert.equal(fs.readFileSync(app.paths.file, "utf8"), "app build 1", "running file untouched");
	assert.equal(fs.readFileSync(app.paths.next, "utf8"), "app build 2");
	// The app's swap at start (P-05): .next becomes the main file; status then reports the staged version.
	fs.renameSync(app.paths.next, app.paths.file);
	assert.deepEqual([app.status().version, app.status().staged], ["0.2.0", null]);

	// A live app (its pid in app.lock) blocks install and uninstall; a stale pid does not.
	holder = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"]);
	fs.writeFileSync(app.paths.lock, String(holder.pid));
	assert.equal(app.status().running, true);
	assert.throws(() => app.uninstall(), /Quit Pi Hub from the tray first/);
	await assert.rejects(app.install(), /Quit Pi Hub from the tray first/);
	holder.kill(); await new Promise(resolve => holder.once("exit", resolve));
	assert.equal(app.status().running, false, "a dead pid is a stale lock");

	const removed = app.uninstall();
	assert.deepEqual([removed.installed, removed.login], [false, false]);
	assert.deepEqual(listed().filter(name => !name.includes("hub data")), [], "uninstall leaves nothing");
	if (windows) assert.throws(() => execFileSync("reg", ["query", runKey, "/v", "PiHubApp"], { stdio: "pipe" }));

	// D13: WSL and other platforms refuse every action and say why.
	const wsl = createAppInstall({ platform: "linux", wsl: true, home: root, dataDir: root, release: () => pin });
	assert.deepEqual([wsl.status().supported, wsl.status().note], [false, "Install the app from the Windows hub."]);
	await assert.rejects(wsl.install(), /Windows hub/); assert.equal((await wsl.autoStage()).supported, false, "no staging on WSL"); assert.throws(() => wsl.uninstall(), /Windows hub/);
	assert.match(createAppInstall({ platform: "darwin", home: root, dataDir: root, release: () => pin }).status().note, /64-bit Windows and Linux/);
	assert.equal(createAppInstall({ home: root, dataDir: root, release: () => null }).status().latest, null, "no pin yet");
	console.log("ok - app install: refused URL and hash, install with shortcut and login entry, stage, swap, lock, uninstall, WSL refusal");
} finally {
	holder?.kill(); server.close();
	if (windows) try { execFileSync("reg", ["delete", runKey, "/f"], { stdio: "pipe" }); } catch { /* already gone */ }
	fs.rmSync(root, { recursive: true, force: true });
}
