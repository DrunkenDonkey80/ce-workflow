// D9: whoever atomically creates `<session file>.lock` owns the session file.
import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import os from "node:os";

export type LockInfo = { pid: number; owner: string; startedAt: number };
export const lockPath = (sessionFile: string) => `${sessionFile}.lock`;

export function pidAlive(pid: number) {
	if (!Number.isSafeInteger(pid) || pid <= 0) return false;
	try { process.kill(pid, 0); return true; } catch (error: any) { return error?.code === "EPERM"; }
}

/** When a process started (ms since epoch), or undefined when the OS will not say. */
function processStart(pid: number): number | undefined {
	try {
		const out = process.platform === "win32"
			? execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `[DateTimeOffset]::new((Get-Process -Id ${pid}).StartTime).ToUnixTimeMilliseconds()`], { encoding: "utf8", stdio: "pipe", windowsHide: true, timeout: 10_000 })
			: String(Date.parse(execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8", stdio: "pipe", env: { ...process.env, LC_ALL: "C" } }).trim()));
		const ms = Number(out.trim());
		return Number.isFinite(ms) && ms > 0 ? ms : undefined;
	} catch { return undefined; }
}

/**
 * The lock's pid runs and is the process that took the lock. After a reboot the OS reuses pids, so a process that
 * started after the lock was written is someone else. 5 s slack: a hub terminal lock names a child spawned just after.
 */
const verdicts = new Map<string, boolean>(); // pid:startedAt -> genuine; the pid is re-checked live every call
export function holderAlive(lock: { pid: number; startedAt: number }) {
	if (!pidAlive(lock.pid)) return false;
	if (!(lock.startedAt > 0)) return true;
	if (lock.startedAt < Date.now() - os.uptime() * 1000 - 5000) return false; // written before this boot: no spawn needed
	const key = `${lock.pid}:${lock.startedAt}`;
	if (!verdicts.has(key)) { const started = processStart(lock.pid); verdicts.set(key, started === undefined || started <= lock.startedAt + 5000); }
	return verdicts.get(key)!;
}

export function readLock(sessionFile: string): LockInfo | undefined {
	try { return JSON.parse(readFileSync(lockPath(sessionFile), "utf8")); } catch { return undefined; }
}

function create(file: string, info: LockInfo) {
	try { writeFileSync(file, JSON.stringify(info), { flag: "wx" }); return true; }
	catch (error: any) { if (error?.code === "EEXIST") return false; throw error; }
}

/**
 * Take the lock or throw with the holder. A lock whose holder is gone (dead or reused pid) is taken over.
 */
export function acquireLock(sessionFile: string, owner: string, pid = process.pid): LockInfo {
	const file = lockPath(sessionFile);
	const info = { pid, owner, startedAt: Date.now() };
	for (let attempt = 0; attempt < 3; attempt++) {
		if (create(file, info)) return info;
		const holder = readLock(sessionFile);
		if (holder && holderAlive(holder)) throw new Error(`Session is open in ${holder.owner} (pid ${holder.pid}).`);
		// Move the stale lock aside first; if what we moved turns out live (another taker won), put it back.
		const aside = `${file}.${crypto.randomBytes(4).toString("hex")}.stale`;
		try { renameSync(file, aside); } catch { continue; }
		let moved: LockInfo | undefined;
		try { moved = JSON.parse(readFileSync(aside, "utf8")); } catch {}
		if (moved && holderAlive(moved)) { try { renameSync(aside, file); } catch {} throw new Error(`Session is open in ${moved.owner} (pid ${moved.pid}).`); }
		rmSync(aside, { force: true });
	}
	throw new Error("Could not take the session lock.");
}

/** Remove the lock only if it is still ours. */
export function releaseLock(sessionFile: string, info: LockInfo) {
	const holder = readLock(sessionFile);
	if (holder && holder.pid === info.pid && holder.startedAt === info.startedAt) rmSync(lockPath(sessionFile), { force: true });
}
