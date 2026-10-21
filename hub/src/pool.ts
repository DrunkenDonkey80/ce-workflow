// The Claude account pool for the page's accounts window, without any session (D9, D12, D13).
// The hub runs claudeex's own `cpool` CLI as a separate process: it never imports claudeex code
// or edits its files, and claudeex keeps working on its own in a plain Pi.
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
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
		const folder = source.startsWith("npm:") ? path.join(dir, "npm", "node_modules", bare(source.slice(4)))
			: source.startsWith("git:") ? path.join(dir, "git", ...bare(source.slice(4)).split("/"))
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
	const run = (args: string[]) => new Promise<any>((resolve, reject) => {
		if (!cpool) return reject(fail(404, "The Claude pool (pi-provider-claude-ex) is not installed."));
		execFile(process.execPath, [cpool, ...args], { timeout: 30_000, windowsHide: true, maxBuffer: 4_000_000 }, (error, stdout, stderr) => {
			if (error) return reject(fail(502, (String(stderr).trim().split("\n").pop() || error.message)));
			try { resolve(JSON.parse(stdout)); } catch { reject(fail(502, "cpool printed no JSON.")); }
		});
	});

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
		async action(data: { act?: unknown; label?: unknown; value?: unknown }) {
			if (!ACTS.has(data.act as string) || typeof (data.label ?? "") !== "string") throw fail(400, "Unknown pool action.");
			if (data.act === "priority" && !(Number.isInteger(data.value) && Math.abs(data.value as number) <= 2)) throw fail(400, "Priority is -2..2.");
			if (data.value !== undefined && !Number.isInteger(data.value)) throw fail(400, "Value must be an integer.");
			const label = String(data.label ?? "");
			if (label.startsWith("-")) throw fail(400, "Unknown account.");
			const result = await run(["action", data.act as string, label, ...(data.value === undefined ? [] : [String(data.value)]), "--json"]);
			return { message: result?.text as string | undefined, view: await run(["view", "--json"]) };
		},
		start() { if (!stopped) return; stopped = false; startDaemon(); },
		stop() { stopped = true; clearTimeout(retry); daemon?.kill(); daemon = undefined; },
	};
}
