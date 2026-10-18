#!/usr/bin/env node
// pi-hub start | stop [--force] | restart | status | open | new [folder] [name] | remote on|off | autostart on|off|status
import { mkdirSync, openSync, readFileSync } from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hubDataDir } from "./registry.ts";
import { configPath, markerPath, openInBrowser, readConfig, type HubMarker } from "./hub.ts";
import { writeJsonAtomic } from "./registry.ts";
import { pidAlive } from "./session-lock.ts";

const marker = (): HubMarker | undefined => {
	try { const value = JSON.parse(readFileSync(markerPath(), "utf8")); return pidAlive(value.pid) ? value : undefined; } catch { return undefined; }
};

async function call(route: string, data?: unknown) {
	const config = readConfig(), running = marker();
	if (!config || !running) throw new Error("The hub is not running.");
	const response = await fetch(`http://127.0.0.1:${running.port}${route}`, {
		method: data === undefined ? "GET" : "POST",
		headers: { "x-hub-key": config.localKey, "content-type": "application/json" },
		body: data === undefined ? undefined : JSON.stringify(data),
	});
	const value = await response.json();
	if (!response.ok) throw new Error(value.error ?? `HTTP ${response.status}`);
	return value;
}

const remoteLine = (remote: { on: boolean; url?: string; missing?: string[]; error?: string }) =>
	!remote.on ? "Remote off." : remote.url ? `Remote: ${remote.url} (paired devices with your Tailscale login)` : `Remote on but not served: ${remote.error ?? remote.missing?.join(" ")}`;

// H6-04: start at Windows logon through the per-user Run key (no admin rights); conhost --headless hides the console
// window, and `start` logs to <data>/hub.log. PI_HUB_RUN_KEY only redirects the key for tests.
const RUN_KEY = process.env.PI_HUB_RUN_KEY || "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
function autostart(action: string) {
	if (process.platform !== "win32") throw new Error("autostart is Windows only for now; add pi-hub start to your login items.");
	const reg = (...args: string[]) => execFileSync("reg", args, { encoding: "utf8", stdio: "pipe", windowsHide: true });
	if (action === "on") {
		const command = `conhost.exe --headless "${process.execPath}" "${fileURLToPath(new URL("./cli.ts", import.meta.url))}" start`;
		reg("add", RUN_KEY, "/v", "pi-control-hub", "/t", "REG_SZ", "/d", command, "/f");
		return `Autostart on: the hub starts hidden at logon. Log: ${path.join(hubDataDir(), "hub.log")}`;
	}
	let current: string | undefined;
	try { current = /REG_SZ\s+(.+)/.exec(reg("query", RUN_KEY, "/v", "pi-control-hub"))?.[1].trim(); } catch { /* no value */ }
	if (action === "status") return current ? `Autostart on: ${current}` : "Autostart off.";
	if (current) reg("delete", RUN_KEY, "/v", "pi-control-hub", "/f");
	return "Autostart off.";
}

const waitFor = async (check: () => boolean, ms: number) => {
	for (const end = Date.now() + ms; Date.now() < end; await new Promise(r => setTimeout(r, 100))) if (check()) return true;
	return check();
};

async function start() {
	const running = marker();
	if (running) return console.log(`Already running: pid ${running.pid}, http://127.0.0.1:${running.port}`);
	mkdirSync(hubDataDir(), { recursive: true });
	const log = openSync(path.join(hubDataDir(), "hub.log"), "a");
	const child = spawn(process.execPath, [fileURLToPath(new URL("./hub.ts", import.meta.url))], { detached: true, windowsHide: true, stdio: ["ignore", log, log] });
	child.unref();
	if (!await waitFor(() => marker()?.pid === child.pid, 15_000)) throw new Error(`The hub did not start; see ${path.join(hubDataDir(), "hub.log")}.`);
	console.log(`Started: pid ${child.pid}, http://127.0.0.1:${marker()!.port}`);
}

async function stop(force: boolean) {
	const running = marker();
	if (!running) return console.log("Not running.");
	await call("/api/stop", { force });
	if (!await waitFor(() => !pidAlive(running.pid), 30_000)) throw new Error(`Hub pid ${running.pid} did not exit.`);
	console.log("Stopped.");
}

const [verb = "status", ...rest] = process.argv.slice(2);
try {
	if (verb === "start") await start();
	else if (verb === "stop") await stop(rest.includes("--force"));
	else if (verb === "restart") { await stop(false); await start(); }
	else if (verb === "status") {
		const running = marker();
		if (!running) console.log(`Not running. Data: ${hubDataDir()}`);
		else {
			const status = await call("/api/status");
			console.log(`Running: pid ${status.pid}, http://127.0.0.1:${status.port}`);
			if (status.remote.on) console.log(remoteLine(status.remote));
			for (const s of status.sessions) console.log(`  ${s.live ? (s.busy.length ? s.busy.join(", ") : "idle") : s.state.padEnd(7)}  ${s.name}  ${s.folder}`);
		}
	} else if (verb === "open") {
		const running = marker();
		if (!running) throw new Error("The hub is not running; run pi-hub start.");
		// The bare address opens a session page; the local key is the page's sign-in.
		const url = `http://127.0.0.1:${running.port}/?token=${readConfig()!.localKey}`;
		openInBrowser(url);
		console.log(`http://127.0.0.1:${running.port}/`);
	} else if (verb === "new") {
		// A folder's first session starts its group; later ones can be added on the page with +.
		const folder = path.resolve(rest[0] ?? "."), sessions = (await call("/api/status")).sessions as { name: string; folder: string }[];
		const taken = new Set(sessions.filter(s => s.folder.toLowerCase() === folder.toLowerCase()).map(s => s.name));
		let n = 1; while (taken.has(String(n))) n++;
		const record = await call("/api/sessions", { folder, name: rest[1] ?? String(n) });
		console.log(`New session ${record.name} in ${record.folder}: http://127.0.0.1:${marker()!.port}/s/${record.id}/`);
	} else if (verb === "remote" && ["on", "off"].includes(rest[0])) {
		// Tailnet-only HTTPS through `tailscale serve` on the hub's port; never Funnel.
		if (marker()) console.log(remoteLine(await call("/api/remote", { on: rest[0] === "on" })));
		else {
			const config = readConfig();
			if (!config) throw new Error("Start the hub once first: pi-hub start.");
			writeJsonAtomic(configPath(), { ...config, remote: rest[0] === "on" });
			console.log(`Remote ${rest[0]}; applies when the hub starts.`);
		}
	} else if (verb === "autostart" && ["on", "off", "status"].includes(rest[0] ?? "status")) console.log(autostart(rest[0] ?? "status"));
	else {
		console.log("Usage: pi-hub start | stop [--force] | restart | status | open | new [folder] [name] | remote on|off | autostart on|off|status");
		process.exitCode = verb === "help" || verb === "--help" ? 0 : 2;
	}
} catch (error) {
	console.error((error as Error).message);
	process.exitCode = 1;
}
