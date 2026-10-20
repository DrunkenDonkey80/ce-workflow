#!/usr/bin/env node
// pi-hub install | start | stop [--force] | restart | update [--yes] | status [--json] | open [remote] | new [folder] [name] | parked | wake <id> | remote on|off | pair approve|reject | autostart on|off|status
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync, execSync, spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hubDataDir, readSessionSummary } from "./registry.ts";
import { configPath, markerPath, openInBrowser, readConfig, type HubMarker } from "./hub.ts";
import { writeJsonAtomic } from "./registry.ts";
import { holderAlive, pidAlive } from "./session-lock.ts";
import { defaultCommand } from "./rpc-client.ts";
import { listProcesses, outsidePis } from "./update.ts";
import { createInterface } from "node:readline/promises";
import { findCommand, isWsl, wslSystemd } from "./platform.ts";

// A marker left by a hub that died with the PC names a pid the OS may have reused; holderAlive checks start times.
const marker = (): HubMarker | undefined => {
	try { const value = JSON.parse(readFileSync(markerPath(), "utf8")); return holderAlive(value) ? value : undefined; } catch { return undefined; }
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
const CLI = fileURLToPath(new URL("./cli.ts", import.meta.url));
// shortcut: XDG autostart runs only with a desktop login; a headless Linux box needs a systemd user unit instead.
const DESKTOP_FILE = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "autostart", "pi-control-hub.desktop");
// WSL has no desktop login; with systemd on, a user unit runs the hub (in the foreground) whenever the distro starts for this user.
const UNIT_FILE = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "systemd", "user", "pi-control-hub.service");
function autostart(action: string) {
	if (process.platform === "linux" && isWsl()) {
		const systemctl = (...args: string[]) => execFileSync("systemctl", ["--user", ...args], { stdio: "pipe" });
		if (action === "status") return existsSync(UNIT_FILE) ? `Autostart on: ${UNIT_FILE}` : "Autostart off.";
		if (action === "on") {
			if (!wslSystemd()) throw new Error("WSL has no login start without systemd: add [boot] systemd=true to /etc/wsl.conf and run wsl --shutdown, or run pi-hub start after opening WSL.");
			const log = path.join(hubDataDir(), "hub.log");
			mkdirSync(path.dirname(UNIT_FILE), { recursive: true }); mkdirSync(hubDataDir(), { recursive: true });
			writeFileSync(UNIT_FILE, `[Unit]
Description=Pi control hub

[Service]
ExecStart="${process.execPath}" "${fileURLToPath(new URL("./hub.ts", import.meta.url))}"
Restart=on-failure
StandardOutput=append:${log}
StandardError=append:${log}

[Install]
WantedBy=default.target
`);
			systemctl("daemon-reload"); systemctl("enable", "pi-control-hub.service");
			return `Autostart on: systemd starts the hub when WSL starts for you (${UNIT_FILE}). Log: ${log}`;
		}
		if (existsSync(UNIT_FILE)) { try { systemctl("disable", "pi-control-hub.service"); } catch { /* systemd gone */ } rmSync(UNIT_FILE, { force: true }); }
		return "Autostart off.";
	}
	if (process.platform === "linux") {
		if (action === "on") {
			mkdirSync(path.dirname(DESKTOP_FILE), { recursive: true });
			writeFileSync(DESKTOP_FILE, `[Desktop Entry]\nType=Application\nName=Pi control hub\nExec="${process.execPath}" "${CLI}" start\nNoDisplay=true\nX-GNOME-Autostart-enabled=true\n`);
			return `Autostart on: the hub starts at desktop login (${DESKTOP_FILE}). Log: ${path.join(hubDataDir(), "hub.log")}`;
		}
		if (action === "status") return existsSync(DESKTOP_FILE) ? `Autostart on: ${DESKTOP_FILE}` : "Autostart off.";
		rmSync(DESKTOP_FILE, { force: true });
		return "Autostart off.";
	}
	if (process.platform !== "win32") throw new Error("autostart is Windows and Linux only; add pi-hub start to your login items.");
	const reg = (...args: string[]) => execFileSync("reg", args, { encoding: "utf8", stdio: "pipe", windowsHide: true });
	if (action === "on") {
		const command = `conhost.exe --headless "${process.execPath}" "${CLI}" start`;
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

/** Stop the hub, `pi update --all` (Pi and extensions), start it again; the running sessions come back (D17). */
async function update(yes: boolean) {
	const running = marker();
	if (running) {
		const busy = ((await call("/api/status")).sessions as { name: string; folder: string; busy: string[] }[]).filter(s => s.busy.length);
		if (busy.length) throw new Error(`Not updated: busy sessions are never interrupted. Stop them, then retry:\n${busy.map(s => `  ${s.busy.join(", ")}  ${s.name}  ${s.folder}`).join("\n")}`);
	}
	const outside = outsidePis(listProcesses(), running?.pid);
	if (outside.length) {
		console.log(`${outside.length} Pi outside the hub keep the old version until restarted, and can lock extension files so the update fails:`);
		for (const p of outside) {
			const file = /--session\s+("[^"]+"|\S+)/.exec(p.args)?.[1].replace(/"/g, ""), summary = file ? await readSessionSummary(file).catch(() => null) : null;
			console.log(`  pid ${p.pid}  ${summary ? `${summary.cwd}${summary.name ? ` · ${summary.name}` : ""}` : p.args.replace(/^.*pi-launcher\.js"?\s*/, "") || "(no arguments)"}`);
		}
		if (!yes) {
			if (!process.stdin.isTTY) return console.log("Not updated; close them, or rerun with --yes.");
			const rl = createInterface({ input: process.stdin, output: process.stdout });
			const answer = await rl.question("Update anyway? [y/N] "); rl.close();
			if (!/^y/i.test(answer.trim())) return console.log("Not updated.");
		}
	}
	if (running) await stop(false); // refuses if a session turned busy meanwhile
	const [command, ...prefix] = defaultCommand();
	try { execFileSync(command, [...prefix, "update", "--all"], { stdio: "inherit", shell: command === "pi" && process.platform === "win32" }); }
	finally { if (running) await start(); }
}

const onPath = (command = "pi-hub") => !!findCommand(command);

/** What /wo hub shows: running or not, addresses, logon start and whether the pi-hub command exists. */
async function statusJson() {
	const running = marker(), config = readConfig();
	let autostartOn = false; try { autostartOn = /^Autostart on/.test(autostart("status")); } catch { /* unsupported OS */ }
	const base = { running: !!running, data: hubDataDir(), autostart: autostartOn, command: onPath() };
	if (!running) return { ...base, remote: { on: config?.remote === true } };
	const status = await call("/api/status");
	const { pending } = await call("/api/pairing");
	return { ...base, pid: status.pid, pairing: pending, local: `http://127.0.0.1:${status.port}/`, remote: status.remote, sessions: status.sessions.length, live: status.sessions.filter((s: { live: boolean }) => s.live).length, busy: status.sessions.filter((s: { busy: string[] }) => s.busy.length).length };
}

/** One step for a new PC: the pi-hub command (best effort), start at logon, start now. */
async function install() {
	try { execSync("npm link", { cwd: fileURLToPath(new URL("..", import.meta.url)), stdio: "pipe", windowsHide: true }); console.log("Command: pi-hub (works in new terminals)."); }
	catch (error) { console.log(`pi-hub command not added (npm link failed: ${String((error as { stderr?: Buffer }).stderr ?? error).trim().split("\n").at(-1)}); /wo hub and node "${CLI}" still work.`); }
	try { console.log(autostart("on")); } catch (error) { console.log((error as Error).message); }
	await start();
	const remote = (await call("/api/status")).remote;
	console.log(remote.on ? remoteLine(remote) : "Remote access is off; turn it on for your phone (needs Tailscale).");
}

const [verb = "status", ...rest] = process.argv.slice(2);
try {
	if (verb === "install") await install();
	else if (verb === "status" && rest.includes("--json")) console.log(JSON.stringify(await statusJson()));
	else if (verb === "start") await start();
	else if (verb === "stop") await stop(rest.includes("--force"));
	else if (verb === "restart") { await stop(false); await start(); }
	else if (verb === "update") await update(rest.includes("--yes"));
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
		if (rest[0] === "remote") {
			const remote = (await call("/api/status")).remote;
			if (!remote.url) throw new Error(remoteLine(remote));
			openInBrowser(remote.url);
			console.log(remote.url);
		} else {
			// The bare address opens a session page; the local key is the page's sign-in. Printed signed, in case no browser opened.
			const url = `http://127.0.0.1:${running.port}/?token=${readConfig()!.localKey}`;
			openInBrowser(url);
			console.log(url);
		}
	} else if (verb === "new") {
		// A folder's first session starts its group; later ones can be added on the page with +.
		const folder = path.resolve(rest[0] ?? "."), sessions = (await call("/api/status")).sessions as { name: string; folder: string }[];
		const taken = new Set(sessions.filter(s => s.folder.toLowerCase() === folder.toLowerCase()).map(s => s.name));
		let n = 1; while (taken.has(String(n))) n++;
		const record = await call("/api/sessions", { folder, name: rest[1] ?? String(n) });
		console.log(`New session ${record.name} in ${record.folder}: http://127.0.0.1:${marker()!.port}/s/${record.id}/?token=${readConfig()!.localKey}`);
	} else if (verb === "parked") {
		// Parked sessions for intercom: its id for a Pi session is the Pi session id, read from the session file.
		const all = marker() ? (await call("/api/status")).sessions as { id: string; name: string; folder: string; state: string; live: boolean; sessionFile?: string }[] : [];
		const parked = await Promise.all(all.filter(s => !s.live && s.state !== "terminal" && s.sessionFile).map(async s =>
			({ id: s.id, name: s.name, folder: s.folder, sessionId: (await readSessionSummary(s.sessionFile!).catch(() => null))?.sessionId })));
		console.log(JSON.stringify(parked.filter(s => s.sessionId)));
	} else if (verb === "wake" && rest[0]) {
		// Resume one parked session (by hub id); never starts a new one.
		await call(`/api/sessions/${rest[0]}/resume`, {});
		console.log("Resumed.");
	} else if (verb === "remote" && ["on", "off"].includes(rest[0])) {
		// Tailnet-only HTTPS through `tailscale serve` on the hub's port; never Funnel.
		if (marker()) console.log(remoteLine(await call("/api/remote", { on: rest[0] === "on" })));
		else {
			const config = readConfig();
			if (!config) throw new Error("Start the hub once first: pi-hub start.");
			writeJsonAtomic(configPath(), { ...config, remote: rest[0] === "on" });
			console.log(`Remote ${rest[0]}; applies when the hub starts.`);
		}
	} else if (verb === "pair" && ["approve", "reject"].includes(rest[0])) {
		// A device waiting on the pairing page; approve here when no browser page is open (no sessions yet, another PC).
		if (!marker()) throw new Error("The hub is not running.");
		await call("/api/pairing", { approve: rest[0] === "approve" });
		console.log(rest[0] === "approve" ? "Device paired." : "Device rejected.");
	} else if (verb === "autostart" && ["on", "off", "status"].includes(rest[0] ?? "status")) console.log(autostart(rest[0] ?? "status"));
	else {
		console.log("Usage: pi-hub install | start | stop [--force] | restart | update [--yes] | status [--json] | open [remote] | new [folder] [name] | parked | wake <id> | remote on|off | pair approve|reject | autostart on|off|status");
		process.exitCode = verb === "help" || verb === "--help" ? 0 : 2;
	}
} catch (error) {
	console.error((error as Error).message);
	process.exitCode = 1;
}
