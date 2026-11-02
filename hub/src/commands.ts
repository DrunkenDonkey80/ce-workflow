// Project commands: buttons above the chat, kept per folder in the hub's own data (never in the repo, so a cloned
// project cannot bring command lines with it). A prompt command sends its text to the agent; a run command starts its
// command line in the folder on the hub PC, with no agent and no captured output.
import { exec, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { writeJsonAtomic } from "./registry.ts";

// local: only on this PC's own page (a run that opens windows or rebuilds the desktop app is pointless from a phone).
export type ProjectCommand = { name: string; kind: "prompt" | "run"; text: string; help?: string; local?: boolean; actions?: CommandAction[]; menu?: boolean };
// Extra actions: bound ones run on that click instead of the button's own; all show in its right-click menu.
export type CommandAction = { name: string; kind: "prompt" | "run"; text: string; click?: "middle" | "ctrl" | "shift" };
const CLICKS = ["middle", "ctrl", "shift"];
const key = (folder: string) => { const full = path.resolve(folder); return process.platform === "win32" ? full.toLowerCase() : full; };
const fail = (message: string): never => { throw Object.assign(new Error(message), { status: 400 }); };
function action(input: any): CommandAction {
	const name = String(input?.name ?? "").trim(), text = String(input?.text ?? "").trim();
	if (!name || name.length > 40) fail("actions: each name 1-40 characters.");
	if (input.kind !== "prompt" && input.kind !== "run") fail("actions: each kind prompt or run.");
	if (!text) fail("actions: each needs text.");
	if (input.click != null && !CLICKS.includes(input.click)) fail("actions: click is middle, ctrl or shift.");
	return { name, kind: input.kind, text, ...(input.click ? { click: input.click } : {}) };
}

export function createCommands(dataDir: string) {
	const file = path.join(dataDir, "commands.json");
	const read = (): Record<string, ProjectCommand[]> => { try { return JSON.parse(readFileSync(file, "utf8")).folders ?? {}; } catch { return {}; } };
	const write = (folders: Record<string, ProjectCommand[]>) => writeJsonAtomic(file, { version: 1, folders });
	const list = (folder: string) => read()[key(folder)] ?? [];
	return {
		list,
		/** Adds or replaces (same name, any case) one command. */
		add(folder: string, input: Record<string, unknown>) {
			const name = String(input.name ?? "").trim(), text = String(input.text ?? "").trim(), help = String(input.help ?? "").trim();
			if (!name || name.length > 40) fail("name: 1-40 characters.");
			if (input.kind !== "prompt" && input.kind !== "run") fail("kind: prompt or run.");
			if (!text) fail(input.kind === "run" ? "text: the command line to run." : "text: the message to send.");
			const actions = input.actions == null ? [] : Array.isArray(input.actions) ? input.actions.map(action) : fail("actions: a list.");
			if (new Set(actions.map(item => item.click).filter(Boolean)).size !== actions.filter(item => item.click).length) fail("actions: one action per click.");
			if (input.menu === true && input.kind !== "run") fail("menu: run commands only (the script lists the menu).");
			const command: ProjectCommand = { name, kind: input.kind as ProjectCommand["kind"], text, ...(help ? { help } : {}), ...(input.local === true ? { local: true } : {}), ...(actions.length ? { actions } : {}), ...(input.menu === true ? { menu: true } : {}) };
			const folders = read(), own = (folders[key(folder)] ?? []).filter(item => item.name.toLowerCase() !== name.toLowerCase());
			folders[key(folder)] = [...own, command]; write(folders);
			return command;
		},
		rename(folder: string, from: string, to: string) {
			const name = to.trim(); if (!name || name.length > 40) fail("name: 1-40 characters.");
			const folders = read(), own = folders[key(folder)] ?? [], item = own.find(command => command.name === from);
			if (!item) return false;
			if (own.some(command => command !== item && command.name.toLowerCase() === name.toLowerCase())) fail(`A command named "${name}" already exists.`);
			item.name = name; write(folders); return true;
		},
		remove(folder: string, name: string) {
			const folders = read(), own = folders[key(folder)] ?? [], kept = own.filter(item => item.name.toLowerCase() !== name.trim().toLowerCase());
			if (kept.length === own.length) return false;
			if (kept.length) folders[key(folder)] = kept; else delete folders[key(folder)];
			write(folders); return true;
		},
	};
}
export type Commands = ReturnType<typeof createCommands>;

// hub/bin holds pi-hub shims, so a run command's script can call `pi-hub ask` even where npm link never ran.
// Separate folders: cmd would try an extensionless `pi-hub` beside pi-hub.cmd first and fail silently.
const BIN = fileURLToPath(new URL(process.platform === "win32" ? "../bin/win" : "../bin/posix", import.meta.url));
const POSIX_BIN = fileURLToPath(new URL("../bin/posix", import.meta.url));

/** pi-hub on PATH (Git Bash on Windows finds the sh shim after the .cmd folder), the hub's node, and the session to report to. */
export function hubEnv(session?: string): Record<string, string> {
	const pathKey = Object.keys(process.env).find(key => key.toUpperCase() === "PATH") ?? "PATH";
	const bins = process.platform === "win32" ? [BIN, POSIX_BIN] : [BIN];
	return { [pathKey]: [...bins, process.env[pathKey] ?? ""].join(path.delimiter), PI_HUB_NODE: process.execPath, ...(session ? { PI_HUB_SESSION: session } : {}) };
}

/**
 * Starts a run command in its folder and forgets it; a window it opens (a terminal, Explorer) shows on the hub PC.
 * It gets PI_HUB_SESSION and pi-hub on PATH, so its script can ask the user (pi-hub ask) and report back (pi-hub notice).
 */
export function runCommand(folder: string, line: string, session?: string, extra: Record<string, string> = {}) {
	const env = { ...process.env, ...hubEnv(session), ...extra };
	// Windows: a detached (console-less) cmd loses its programs' output, even `> file` redirects, so a detached node
	// launcher starts the line under a hidden console of its own instead; detaching still lets it outlive the hub.
	const child = process.platform === "win32"
		? spawn(process.execPath, ["-e", "require('child_process').spawn(process.env.PI_HUB_RUN, { shell: true, stdio: 'ignore', windowsHide: true }).on('exit', code => process.exit(code ?? 0))"], { cwd: folder, env: { ...env, PI_HUB_RUN: line }, detached: true, stdio: "ignore", windowsHide: true })
		: spawn(line, { cwd: folder, env, shell: true, detached: true, stdio: "ignore" });
	child.on("error", () => {}); // a missing program only fails in its own shell; nothing to report back
	child.unref();
}

/** A menu command's right-click list: its script runs with PI_HUB_CLICK=menu and prints one action name per line (10 s at most). */
export function commandMenu(folder: string, line: string, session?: string): Promise<string[]> {
	const env = { ...process.env, ...hubEnv(session), PI_HUB_CLICK: "menu" };
	return new Promise((resolve, reject) => exec(line, { cwd: folder, env, timeout: 10_000, windowsHide: true, maxBuffer: 100_000 }, (error, out) => {
		if (error) reject(Object.assign(new Error(`The menu script failed: ${error.killed ? "no answer in 10 s" : error.message.split(/\r?\n/)[0]}`), { status: 502 }));
		else resolve(out.split(/\r?\n/).map(item => item.trim().slice(0, 80)).filter(Boolean).slice(0, 30));
	}));
}

