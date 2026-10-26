// Hourly check for a newer Pi and for extension updates (gear badge + list). Checks only; installing stays the gear's
// "Update Pi and extensions" (pi-hub update), which stops and restarts every session.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { piPackage, piSdk } from "./pi-sdk.ts";
import { agentDir } from "./rpc-client.ts";

/** One user-scope Pi package as the gear lists it; update comes from the same hourly check. */
export type Installed = { source: string; name: string; version: string; update: boolean };
export type Found = { pi: { current: string; latest: string } | null; packages: string[]; installed?: Installed[] };
export type UpdateState = Found & { checkedAt: number | null; checking: boolean; error?: string };
export type UpdateCheck = { state(): UpdateState; check(): Promise<UpdateState>; quick(): Promise<UpdateState>; remove(source: string): Promise<UpdateState>; start(): void; stop(): void };

/** Numeric x.y.z comparison; a pre-release tag counts as its base version. */
export const newer = (latest: string, current: string) => {
	const parts = (v: string) => v.replace(/^v/, "").split(/[-+]/)[0].split(".").map(Number);
	const a = parts(latest), b = parts(current);
	for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
	return false;
};

/** Pi's own checks: pi.dev's latest version (as Pi's startup notice) and DefaultPackageManager for user packages. */
export async function findUpdates(dir = agentDir()): Promise<Found> {
	// Managed or npm-installed Pi alike: the version of the package the hub loads Pi's SDK from.
	const current = String(JSON.parse(readFileSync(path.join(piPackage(dir), "package.json"), "utf8")).version ?? "");
	const response = await fetch("https://pi.dev/api/latest-version", { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
	if (!response.ok) throw new Error(`pi.dev answered ${response.status}`);
	const latest = String((await response.json()).version ?? "").trim();
	const sdk = await piSdk(dir), cwd = os.homedir();
	// shortcut: Pi's package check reports a failed npm/git lookup as "no update"; only the Pi version check can fail visibly.
	const manager = new sdk.DefaultPackageManager({ cwd, agentDir: dir, settingsManager: sdk.SettingsManager.create(cwd, dir) });
	const found: { source: string; displayName: string }[] = await manager.checkForAvailableUpdates();
	const configured = (manager.listConfiguredPackages() as { source: string; scope: string; installedPath?: string }[]).filter(item => item.scope === "user");
	// Pi flags a git package whenever its commit differs from the remote's, also when the local clone is ahead of it.
	const ahead = await Promise.all(found.map(u => { const dir = configured.find(item => item.source === u.source)?.installedPath; return u.source.startsWith("git:") && dir ? remoteIsBehind(dir) : false; }));
	const updates = found.filter((_, i) => !ahead[i]);
	const installed = configured.map(item => {
		const update = updates.find(u => u.source === item.source);
		let version = ""; try { version = String(JSON.parse(readFileSync(path.join(item.installedPath ?? "", "package.json"), "utf8")).version ?? ""); } catch { /* no package.json */ }
		return { source: item.source, name: update?.displayName ?? packageName(item.source), version, update: !!update };
	});
	return { pi: latest && newer(latest, current) ? { current, latest } : null, packages: updates.map(u => u.displayName), installed };
}
/** True when the remote HEAD commit is already in the local clone's history (nothing to pull). */
export async function remoteIsBehind(dir: string) {
	const git = (...args: string[]) => promisify(execFile)("git", args, { cwd: dir, windowsHide: true, timeout: 30_000 });
	try {
		const remote = (await git("ls-remote", "origin", "HEAD")).stdout.split(/\s/)[0];
		return !!remote && (await git("merge-base", "--is-ancestor", remote, "HEAD").then(() => true, () => false));
	} catch { return false; }
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
		// Node ends a crash with its own "Node.js v24…" line; the cause is the first Error line above it.
		if (error) { const lines = stderr.trim().split("\n"); return reject(new Error(lines.find(line => /^\w*Error\b/.test(line.trim()))?.trim() || lines.at(-1) || error.message)); }
		try { resolve(JSON.parse(stdout)); } catch { reject(new Error("Pi's package manager gave no result.")); } // a throw here would end the hub
	}));
export const findUpdatesHidden = () => hidden<Found>("findUpdates()");
export const removePackageHidden = (source: string) => hidden<boolean>(`removePackage(${JSON.stringify(source)})`);

/** ce-workflow's version on GitHub master (every push bumps it); null when GitHub cannot be reached. */
export async function latestWorkflow(get: typeof fetch = fetch): Promise<string | null> {
	try {
		const response = await get("https://raw.githubusercontent.com/DrunkenDonkey80/ce-workflow/master/package.json", { signal: AbortSignal.timeout(10_000) });
		return response.ok ? String((await response.json()).version ?? "") || null : null;
	} catch { return null; }
}

export function createUpdateCheck({ find = findUpdatesHidden, remove = removePackageHidden, latest = latestWorkflow, every = 3_600_000, quickEvery = 600_000 }: { find?: () => Promise<Found>; remove?: (source: string) => Promise<boolean>; latest?: () => Promise<string | null>; every?: number; quickEvery?: number } = {}): UpdateCheck {
	let value: UpdateState = { pi: null, packages: [], checkedAt: null, checking: false }, running: Promise<UpdateState> | undefined, timer: NodeJS.Timeout | undefined, quickTimer: NodeJS.Timeout | undefined;
	// Between the hourly full checks, a cheap look at ce-workflow alone, so its update shows within minutes of a push.
	// shortcut: git installs only; an npm or local-path (developer checkout) ce-workflow waits for the hourly check.
	const quick = async () => {
		const own = value.installed?.find(item => /ce-workflow/i.test(item.source));
		if (running || !own || own.update || !own.source.startsWith("git:") || !own.version) return value;
		const version = await latest();
		if (version && newer(version, own.version)) value = { ...value, packages: [...value.packages, own.name], installed: value.installed!.map(item => item === own ? { ...item, update: true } : item) };
		return value;
	};
	const check = () => running ??= (async () => {
		value = { ...value, checking: true };
		try { value = { ...await find(), checkedAt: Date.now(), checking: false }; }
		catch (error) { value = { ...value, checkedAt: Date.now(), checking: false, error: (error as Error).message }; } // keep the last good list
		running = undefined; return value;
	})();
	return {
		state: () => value, check, quick,
		// Only a package the last check listed; the hub itself runs from ce-workflow, so that one stays.
		async remove(source) {
			const item = value.installed?.find(entry => entry.source === source);
			if (!item) throw new Error("Not an installed extension; check for updates first.");
			if (/ce-workflow/i.test(source)) throw new Error("The hub runs from ce-workflow, so it cannot uninstall it.");
			if (!await remove(source)) throw new Error(`${item.name} was not installed.`);
			value = { ...value, installed: value.installed!.filter(entry => entry !== item), packages: value.packages.filter(name => name !== item.name) };
			return value;
		},
		start() { void check(); timer = setInterval(() => void check(), every); timer.unref(); quickTimer = setInterval(() => void quick(), quickEvery); quickTimer.unref(); },
		stop() { clearInterval(timer); clearInterval(quickTimer); },
	};
}
