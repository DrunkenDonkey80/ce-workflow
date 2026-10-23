// Hourly check for a newer Pi and for extension updates (gear badge + list). Checks only; installing stays the gear's
// "Update Pi and extensions" (pi-hub update), which stops and restarts every session.
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { piSdk } from "./pi-sdk.ts";
import { agentDir } from "./rpc-client.ts";

/** One user-scope Pi package as the gear lists it; update comes from the same hourly check. */
export type Installed = { source: string; name: string; version: string; update: boolean };
export type Found = { pi: { current: string; latest: string } | null; packages: string[]; installed?: Installed[] };
export type UpdateState = Found & { checkedAt: number | null; checking: boolean; error?: string };
export type UpdateCheck = { state(): UpdateState; check(): Promise<UpdateState>; remove(source: string): Promise<UpdateState>; start(): void; stop(): void };

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
	const updates: { source: string; displayName: string }[] = await manager.checkForAvailableUpdates();
	const installed = (manager.listConfiguredPackages() as { source: string; scope: string; installedPath?: string }[]).filter(item => item.scope === "user").map(item => {
		const update = updates.find(u => u.source === item.source);
		let version = ""; try { version = String(JSON.parse(readFileSync(path.join(item.installedPath ?? "", "package.json"), "utf8")).version ?? ""); } catch { /* no package.json */ }
		return { source: item.source, name: update?.displayName ?? packageName(item.source), version, update: !!update };
	});
	return { pi: latest && newer(latest, current) ? { current, latest } : null, packages: updates.map(u => u.displayName), installed };
}
export const packageName = (source: string) => source.startsWith("npm:") ? source.slice(4) : source.split(/[\\/]/).filter(Boolean).at(-1) ?? source;

/** pi remove <source> through Pi's own package manager; false when the source is not installed for the user. */
export async function removePackage(source: string, dir = agentDir()) {
	const sdk = await piSdk(dir), cwd = os.homedir();
	return new sdk.DefaultPackageManager({ cwd, agentDir: dir, settingsManager: sdk.SettingsManager.create(cwd, dir) }).removeAndPersist(source) as Promise<boolean>;
}

/**
 * Pi's package manager in a child with a hidden console: Pi's package check spawns npm/git without windowsHide, and a console-less
 * hub (logon start) gives each one its own flashing window. Their console is the child's hidden one instead.
 */
const hidden = <T>(call: string) => new Promise<T>((resolve, reject) => execFile(process.execPath,
	["--input-type=module", "--no-warnings", "-e", `import * as m from ${JSON.stringify(import.meta.url)}; process.stdout.write(JSON.stringify(await m.${call}));`],
	{ windowsHide: true, encoding: "utf8", timeout: 300_000, maxBuffer: 1_000_000 },
	(error, stdout, stderr) => {
		if (error) return reject(new Error(stderr.trim().split("\n").at(-1) || error.message));
		try { resolve(JSON.parse(stdout)); } catch { reject(new Error("Pi's package manager gave no result.")); } // a throw here would end the hub
	}));
export const findUpdatesHidden = () => hidden<Found>("findUpdates()");
export const removePackageHidden = (source: string) => hidden<boolean>(`removePackage(${JSON.stringify(source)})`);

export function createUpdateCheck({ find = findUpdatesHidden, remove = removePackageHidden, every = 3_600_000 }: { find?: () => Promise<Found>; remove?: (source: string) => Promise<boolean>; every?: number } = {}): UpdateCheck {
	let value: UpdateState = { pi: null, packages: [], checkedAt: null, checking: false }, running: Promise<UpdateState> | undefined, timer: NodeJS.Timeout | undefined;
	const check = () => running ??= (async () => {
		value = { ...value, checking: true };
		try { value = { ...await find(), checkedAt: Date.now(), checking: false }; }
		catch (error) { value = { ...value, checkedAt: Date.now(), checking: false, error: (error as Error).message }; } // keep the last good list
		running = undefined; return value;
	})();
	return {
		state: () => value, check,
		// Only a package the last check listed; the hub itself runs from ce-workflow, so that one stays.
		async remove(source) {
			const item = value.installed?.find(entry => entry.source === source);
			if (!item) throw new Error("Not an installed extension; check for updates first.");
			if (/ce-workflow/i.test(source)) throw new Error("The hub runs from ce-workflow, so it cannot uninstall it.");
			if (!await remove(source)) throw new Error(`${item.name} was not installed.`);
			value = { ...value, installed: value.installed!.filter(entry => entry !== item), packages: value.packages.filter(name => name !== item.name) };
			return value;
		},
		start() { void check(); timer = setInterval(() => void check(), every); timer.unref(); },
		stop() { clearInterval(timer); },
	};
}
