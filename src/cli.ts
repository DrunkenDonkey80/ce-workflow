#!/usr/bin/env node
// pi-hub start | stop [--force] | restart | status | open | remote on|off
import { mkdirSync, openSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hubDataDir } from "./registry.ts";
import { configPath, markerPath, readConfig, type HubMarker } from "./hub.ts";
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
		const url = `http://127.0.0.1:${running.port}/`;
		// shortcut: opens the bare address; the page's sign-in arrives with the web app (Phase 5).
		const opener = process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
		spawn(opener[0] as string, opener[1] as string[], { detached: true, stdio: "ignore", windowsHide: true }).unref();
		console.log(url);
	} else if (verb === "remote" && ["on", "off"].includes(rest[0])) {
		// Tailnet-only HTTPS through `tailscale serve` on the hub's port; never Funnel.
		if (marker()) console.log(remoteLine(await call("/api/remote", { on: rest[0] === "on" })));
		else {
			const config = readConfig();
			if (!config) throw new Error("Start the hub once first: pi-hub start.");
			writeJsonAtomic(configPath(), { ...config, remote: rest[0] === "on" });
			console.log(`Remote ${rest[0]}; applies when the hub starts.`);
		}
	} else {
		console.log("Usage: pi-hub start | stop [--force] | restart | status | open | remote on|off");
		process.exitCode = verb === "help" || verb === "--help" ? 0 : 2;
	}
} catch (error) {
	console.error((error as Error).message);
	process.exitCode = 1;
}
