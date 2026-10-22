// Hourly check for a newer Pi and for extension updates (gear badge + list). Checks only; installing stays the gear's
// "Update Pi and extensions" (pi-hub update), which stops and restarts every session.
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { piSdk } from "./pi-sdk.ts";
import { agentDir } from "./rpc-client.ts";

export type Found = { pi: { current: string; latest: string } | null; packages: string[] };
export type UpdateState = Found & { checkedAt: number | null; checking: boolean; error?: string };
export type UpdateCheck = { state(): UpdateState; check(): Promise<UpdateState>; start(): void; stop(): void };

/** Numeric x.y.z comparison; a pre-release tag counts as its base version. */
export const newer = (latest: string, current: string) => {
	const parts = (v: string) => v.replace(/^v/, "").split(/[-+]/)[0].split(".").map(Number);
	const a = parts(latest), b = parts(current);
	for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
	return false;
};

/** Pi's own checks: pi.dev's latest version (as Pi's startup notice) and DefaultPackageManager for user packages. */
export async function findUpdates(dir = agentDir()): Promise<Found> {
	const current = readFileSync(path.join(dir, "install", "current-version"), "utf8").trim();
	const response = await fetch("https://pi.dev/api/latest-version", { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
	if (!response.ok) throw new Error(`pi.dev answered ${response.status}`);
	const latest = String((await response.json()).version ?? "").trim();
	const sdk = await piSdk(dir), cwd = os.homedir();
	// shortcut: Pi's package check reports a failed npm/git lookup as "no update"; only the Pi version check can fail visibly.
	const manager = new sdk.DefaultPackageManager({ cwd, agentDir: dir, settingsManager: sdk.SettingsManager.create(cwd, dir) });
	const packages: string[] = (await manager.checkForAvailableUpdates()).map((update: { displayName: string }) => update.displayName);
	return { pi: latest && newer(latest, current) ? { current, latest } : null, packages };
}

/**
 * findUpdates in a child with a hidden console: Pi's package check spawns npm/git without windowsHide, and a console-less
 * hub (logon start) gives each one its own flashing window. Their console is the child's hidden one instead.
 */
export const findUpdatesHidden = () => new Promise<Found>((resolve, reject) => execFile(process.execPath,
	["--input-type=module", "--no-warnings", "-e", `import { findUpdates } from ${JSON.stringify(import.meta.url)}; process.stdout.write(JSON.stringify(await findUpdates()));`],
	{ windowsHide: true, encoding: "utf8", timeout: 300_000, maxBuffer: 1_000_000 },
	(error, stdout, stderr) => {
		if (error) return reject(new Error(stderr.trim().split("\n").at(-1) || error.message));
		try { resolve(JSON.parse(stdout)); } catch { reject(new Error("Update check gave no result.")); } // a throw here would end the hub
	}));

export function createUpdateCheck({ find = findUpdatesHidden, every = 3_600_000 }: { find?: () => Promise<Found>; every?: number } = {}): UpdateCheck {
	let value: UpdateState = { pi: null, packages: [], checkedAt: null, checking: false }, running: Promise<UpdateState> | undefined, timer: NodeJS.Timeout | undefined;
	const check = () => running ??= (async () => {
		value = { ...value, checking: true };
		try { value = { ...await find(), checkedAt: Date.now(), checking: false }; }
		catch (error) { value = { ...value, checkedAt: Date.now(), checking: false, error: (error as Error).message }; } // keep the last good list
		running = undefined; return value;
	})();
	return {
		state: () => value, check,
		start() { void check(); timer = setInterval(() => void check(), every); timer.unref(); },
		stop() { clearInterval(timer); },
	};
}
