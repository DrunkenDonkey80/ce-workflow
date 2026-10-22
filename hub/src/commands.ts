// Project commands: buttons above the chat, kept per folder in the hub's own data (never in the repo, so a cloned
// project cannot bring command lines with it). A prompt command sends its text to the agent; a run command starts its
// command line in the folder on the hub PC, with no agent and no captured output.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { writeJsonAtomic } from "./registry.ts";

export type ProjectCommand = { name: string; kind: "prompt" | "run"; text: string; help?: string };
const key = (folder: string) => { const full = path.resolve(folder); return process.platform === "win32" ? full.toLowerCase() : full; };
const fail = (message: string) => Object.assign(new Error(message), { status: 400 });

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
			if (!name || name.length > 40) throw fail("name: 1-40 characters.");
			if (input.kind !== "prompt" && input.kind !== "run") throw fail("kind: prompt or run.");
			if (!text) throw fail(input.kind === "run" ? "text: the command line to run." : "text: the message to send.");
			const command: ProjectCommand = { name, kind: input.kind, text, ...(help ? { help } : {}) };
			const folders = read(), own = (folders[key(folder)] ?? []).filter(item => item.name.toLowerCase() !== name.toLowerCase());
			folders[key(folder)] = [...own, command]; write(folders);
			return command;
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

/**
 * Starts a run command in its folder and forgets it; a window it opens (a terminal, Explorer) shows on the hub PC.
 * It gets PI_HUB_SESSION and pi-hub on PATH, so its script can ask the user (pi-hub ask) and report back (pi-hub notice).
 */
export function runCommand(folder: string, line: string, session?: string) {
	const pathKey = Object.keys(process.env).find(key => key.toUpperCase() === "PATH") ?? "PATH";
	const env = { ...process.env, [pathKey]: BIN + path.delimiter + (process.env[pathKey] ?? ""), PI_HUB_NODE: process.execPath, ...(session ? { PI_HUB_SESSION: session } : {}) };
	// Windows: a detached (console-less) cmd loses its programs' output, even `> file` redirects, so a detached node
	// launcher starts the line under a hidden console of its own instead; detaching still lets it outlive the hub.
	const child = process.platform === "win32"
		? spawn(process.execPath, ["-e", "require('child_process').spawn(process.env.PI_HUB_RUN, { shell: true, stdio: 'ignore', windowsHide: true }).on('exit', code => process.exit(code ?? 0))"], { cwd: folder, env: { ...env, PI_HUB_RUN: line }, detached: true, stdio: "ignore", windowsHide: true })
		: spawn(line, { cwd: folder, env, shell: true, detached: true, stdio: "ignore" });
	child.on("error", () => {}); // a missing program only fails in its own shell; nothing to report back
	child.unref();
}
