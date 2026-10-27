// Updates that never interrupt work. An extension update is downloaded as soon as a check finds it, with sessions running;
// each session reloads onto it at its own next quiet moment (extensions/work-self-update.ts). What only a hub restart
// can bring (the hub's own new code, Pi itself, a download that failed under running sessions) waits until no session
// has been busy for two checks in a row, then restarts the hub (Pi too: `pi-hub update`).
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";
import { writeJsonAtomic } from "./registry.ts";
import { defaultCommand } from "./rpc-client.ts";
import type { UpdateState } from "./update-check.ts";

export type Waiting = { action: "restart" | "update"; why: string[]; busy: string[] };
type Options = {
	state(): UpdateState; refresh(): Promise<unknown>; busy(): string[];
	loaded: string; disk(): string;
	download?(source: string): Promise<void>; maintain(action: Waiting["action"]): Promise<void>;
	attemptsFile: string; now?(): number; log?(text: string): void;
};

/** `pi update <source>`: that one package, never Pi and never a session. */
export async function downloadPackage(source: string) {
	const [command, ...prefix] = defaultCommand();
	await promisify(execFile)(command, [...prefix, "update", source], { windowsHide: true, timeout: 600_000, shell: command === "pi" && process.platform === "win32" });
}

export function createAutoUpdate({ state, refresh, busy, loaded, disk, download = downloadPackage, maintain, attemptsFile, now = Date.now, log = console.log }: Options) {
	const tried = new Set<string>(), failed = new Set<string>();
	let quiet = 0, downloading: Promise<void> | undefined;
	const waiting = (): Waiting | null => {
		const value = state(), why = [];
		if (disk() && disk() !== loaded) why.push(`ce-workflow ${loaded} → ${disk()}`);
		if (value.pi) why.push(`Pi ${value.pi.current} → ${value.pi.latest}`);
		for (const source of failed) why.push(`${source} (download failed while sessions ran)`);
		if (!why.length) return null;
		return { action: value.pi || failed.size ? "update" : "restart", why, busy: busy() };
	};
	/** Downloads every listed package update not tried yet (only: just that one); the hub keeps running. */
	const fetchUpdates = (only?: string) => downloading ??= (async () => {
		const sources = (state().installed ?? []).filter(item => item.update && !tried.has(item.source) && (!only || item.source === only)).map(item => item.source);
		for (const source of sources) {
			tried.add(source);
			try { await download(source); log(`${new Date().toISOString()} auto-update: downloaded ${source}; sessions reload onto it when quiet`); }
			catch (error) { failed.add(source); log(`${new Date().toISOString()} auto-update: ${source} not downloaded (${(error as Error).message.split("\n")[0]}); retried at the next all-idle restart`); }
		}
		if (sources.length) await refresh();
	})().finally(() => { downloading = undefined; });
	// One attempt per reason every 6 hours: a restart that cannot fix it (Pi held by a terminal outside the hub) must not loop.
	const attempted = (key: string) => { try { const last = JSON.parse(readFileSync(attemptsFile, "utf8")); return last.key === key && now() - last.at < 6 * 3_600_000; } catch { return false; } };
	async function tick() {
		await fetchUpdates();
		const wait = waiting();
		if (!wait || wait.busy.length) { quiet = 0; return; }
		if (++quiet < 2) return;
		const key = JSON.stringify([wait.action, wait.why]);
		if (attempted(key)) return;
		writeJsonAtomic(attemptsFile, { key, at: now() });
		log(`${new Date().toISOString()} auto-update: every session idle; ${wait.action === "update" ? "updating Pi and restarting" : "restarting"} the hub for ${wait.why.join(", ")}`);
		await maintain(wait.action);
	}
	return { tick, waiting, fetchUpdates };
}
