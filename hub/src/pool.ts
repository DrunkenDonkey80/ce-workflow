// The Claude account pool for the page's accounts window, without any session (D9, D12, D13).
// The hub runs claudeex's own `cpool` CLI as a separate process: it never imports claudeex code
// or edits its files, and claudeex keeps working on its own in a plain Pi.
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { agentDir } from "./rpc-client.ts";

const ACTS = new Set(["switch", "favorite", "weekend", "mode", "refresh", "toggle", "remove", "up", "down", "priority"]);
const fail = (status: number, message: string) => Object.assign(new Error(message), { status });

/** claudeex's cpool script: PI_HUB_CPOOL, else the Pi settings package (local path, npm: or git:) whose package.json has bin.cpool. */
export function findCpool(dir = agentDir()): string | undefined {
	if (process.env.PI_HUB_CPOOL) return process.env.PI_HUB_CPOOL;
	let packages: unknown[] = [];
	try { packages = JSON.parse(readFileSync(path.join(dir, "settings.json"), "utf8")).packages ?? []; } catch { return undefined; }
	for (const entry of packages) {
		const source = typeof entry === "string" ? entry : (entry as { source?: unknown })?.source;
		if (typeof source !== "string") continue;
		const bare = (value: string) => value.replace(/(?<=.)@[^/@]*$/, ""); // drop a version pin
		// Pi treats an https:// or ssh:// URL as a git source too, cloned to git/<host>/<path>.
		const git = source.startsWith("git:") ? source.slice(4) : /^(https?|ssh):\/\//.test(source) ? source.replace(/^[a-z]+:\/\/([^@/]*@)?/, "").replace(/\.git$/, "") : undefined;
		const folder = source.startsWith("npm:") ? path.join(dir, "npm", "node_modules", bare(source.slice(4)))
			: git ? path.join(dir, "git", ...bare(git).split("/"))
			: /^[a-z][a-z0-9+.-]+:(?![\\/])/i.test(source) ? undefined : path.resolve(dir, source);
		if (!folder) continue;
		try {
			const bin = JSON.parse(readFileSync(path.join(folder, "package.json"), "utf8")).bin?.cpool;
			// shortcut: Node will not strip types under node_modules, so an npm-installed cpool.ts fails to run; fine for path and git installs.
			if (typeof bin === "string" && existsSync(path.join(folder, bin))) return path.join(folder, bin);
		} catch { /* not a package folder */ }
	}
	return undefined;
}

export type Pool = ReturnType<typeof createPool>;

export function createPool({ cpool = findCpool(), retryMs = 300_000, log = (line: string) => console.error(line) }: { cpool?: string; retryMs?: number; log?: (line: string) => void } = {}) {
	let daemon: ChildProcess | undefined, retry: NodeJS.Timeout | undefined, stopped = true, lastExit = "";
	const run = (args: string[], input?: string) => new Promise<any>((resolve, reject) => {
		if (!cpool) return reject(fail(404, "The Claude pool (pi-provider-claude-ex) is not installed."));
		const child = execFile(process.execPath, [cpool, ...args], { timeout: 30_000, windowsHide: true, maxBuffer: 4_000_000 }, (error, stdout, stderr) => {
			if (error) return reject(fail(502, (String(stderr).trim().split("\n").pop() || error.message)));
			try { resolve(JSON.parse(stdout)); } catch { reject(fail(502, "cpool printed no JSON.")); }
		});
		child.stdin?.end(input ?? "");
	});

	// Re-login: one `cpool login <label> --json` at a time. It prints the sign-in link, reads the pasted code from stdin
	// and prints the result; the account it updates is always <label>, never one picked by email.
	type Login = { child: ChildProcess; lines: string[]; closed: boolean; wake?: () => void };
	let login: Login | undefined;
	const endLogin = () => { login?.child.kill(); login = undefined; };
	async function nextLine(state: Login, ms: number) {
		const deadline = Date.now() + ms;
		while (!state.lines.length && !state.closed && Date.now() < deadline) await new Promise<void>(resolve => { state.wake = resolve; setTimeout(resolve, deadline - Date.now()).unref(); });
		const line = state.lines.shift();
		if (line === undefined) throw fail(502, state.closed ? "cpool login ended without an answer." : "cpool login did not answer in time.");
		let result: any;
		try { result = JSON.parse(line); } catch { throw fail(502, line.startsWith("cpool ") ? "This pi-provider-claude-ex has no cpool login yet; update it (pi update) and restart the hub." : "cpool login printed no JSON."); }
		// Anthropic's refusal is buried in an HTTP dump with a stack trace; show just its words.
		if (result?.error) { const said = /"error_description":\s*"([^"]+)"/.exec(String(result.error))?.[1]; throw fail(502, said ? `Anthropic refused the code: ${said}` : String(result.error)); }
		return result;
	}
	function startLogin(label: string) {
		if (!cpool) throw fail(404, "The Claude pool (pi-provider-claude-ex) is not installed.");
		endLogin();
		const child = spawn(process.execPath, [cpool, "login", label, "--json"], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
		const state: Login = { child, lines: [], closed: false };
		let err = "";
		const wake = () => { const resolve = state.wake; state.wake = undefined; resolve?.(); };
		createInterface({ input: child.stdout! }).on("line", line => { if (line.trim()) { state.lines.push(line); wake(); } });
		child.stderr!.on("data", chunk => { err = (err + chunk).slice(-2000); });
		child.stdin!.on("error", () => {}); // the child may exit before reading
		const close = () => {
			if (state.closed) return;
			state.closed = true;
			if (!state.lines.length && err.trim()) state.lines.push(JSON.stringify({ error: err.trim().split("\n").pop() }));
			wake(); if (login === state) login = undefined;
		};
		child.on("error", error => { err ||= error.message; close(); });
		child.on("close", close);
		return login = state;
	}

	// D13: one daemon refreshes the pool while the hub runs. cpool itself refuses a second daemon, so a
	// standalone one wins; the hub retries later and only ever stops the child it started.
	function startDaemon() {
		if (stopped || !cpool) return;
		let stderr = "";
		const child = spawn(process.execPath, [cpool, "daemon", "--quiet"], { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
		daemon = child;
		child.stderr!.on("data", chunk => { stderr = (stderr + chunk).slice(-2000); });
		child.on("error", error => { stderr ||= error.message; });
		child.on("close", code => {
			if (daemon === child) daemon = undefined;
			if (stopped) return;
			const reason = stderr.trim().split("\n").pop() || `exit ${code}`;
			if (reason !== lastExit) log(`cpool daemon ended: ${reason}; retrying every ${Math.round(retryMs / 1000)} s`);
			lastExit = reason;
			retry = setTimeout(startDaemon, retryMs); retry.unref();
		});
	}

	return {
		available: Boolean(cpool),
		daemon: () => daemon,
		/** The /claude-pool list (title, drain7d, rows); null when claudeex is not installed. */
		view: async () => cpool ? run(["view", "--json"]) : null,
		async action(data: { act?: unknown; label?: unknown; value?: unknown; text?: unknown }) {
			// Moving logins between hubs: the export holds refresh tokens and the sync key, so only the paired page gets it.
			if (data.act === "export") return { config: await run(["export", "--json"]) };
			if (data.act === "import") {
				if (typeof data.text !== "string" || !data.text.trim() || data.text.length > 1_000_000) throw fail(400, "Paste an exported pool config.");
				const result = await run(["import"], data.text);
				return { message: result?.text as string | undefined, view: await run(["view", "--json"]) };
			}
			if (data.act === "login") {
				const label = typeof data.label === "string" ? data.label : "";
				if (!label || label.startsWith("-")) throw fail(400, "Unknown account.");
				const state = startLogin(label);
				try {
					const first = await nextLine(state, 30_000);
					if (typeof first?.url !== "string" || !first.url.startsWith("https://")) throw fail(502, "cpool login gave no sign-in link.");
					return { login: { url: first.url, label, email: typeof first.email === "string" ? first.email : undefined } };
				} catch (error) { if (login === state) endLogin(); throw error; }
			}
			if (data.act === "login-code") {
				const state = login;
				if (!state || state.closed) throw fail(409, "The sign-in has ended; press Re-login again.");
				const code = typeof data.text === "string" ? data.text.trim() : "";
				if (!code || code.length > 4000 || /[\r\n]/.test(code)) throw fail(400, "Paste the code Anthropic shows.");
				state.child.stdin!.write(code + "\n");
				try {
					const done = await nextLine(state, 60_000);
					return { message: `Logged in again: ${done?.label ?? "account"}${done?.email ? ` (${done.email})` : ""}.`, view: await run(["view", "--json"]) };
				} finally { if (login === state) endLogin(); }
			}
			if (data.act === "login-cancel") { endLogin(); return {}; }
			if (!ACTS.has(data.act as string) || typeof (data.label ?? "") !== "string") throw fail(400, "Unknown pool action.");
			if (data.act === "priority" && !(Number.isInteger(data.value) && Math.abs(data.value as number) <= 2)) throw fail(400, "Priority is -2..2.");
			if (data.value !== undefined && !Number.isInteger(data.value)) throw fail(400, "Value must be an integer.");
			const label = String(data.label ?? "");
			if (label.startsWith("-")) throw fail(400, "Unknown account.");
			const result = await run(["action", data.act as string, label, ...(data.value === undefined ? [] : [String(data.value)]), "--json"]);
			return { message: result?.text as string | undefined, view: await run(["view", "--json"]) };
		},
		start() { if (!stopped) return; stopped = false; startDaemon(); },
		stop() { stopped = true; clearTimeout(retry); daemon?.kill(); daemon = undefined; endLogin(); },
	};
}
