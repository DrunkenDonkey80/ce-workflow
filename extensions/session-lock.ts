// D9 (pi-control-hub): whoever atomically creates `<session file>.lock` owns the session file.
// Same format and takeover rules as pi-control-hub src/session-lock.ts; keep the two in step.
import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import os from "node:os";

type LockInfo = { pid: number; owner: string; startedAt: number };
const lockPath = (sessionFile: string) => `${sessionFile}.lock`;

function pidAlive(pid: number) {
	if (!Number.isSafeInteger(pid) || pid <= 0) return false;
	try { process.kill(pid, 0); return true; } catch (error: any) { return error?.code === "EPERM"; }
}
function processStart(pid: number): number | undefined {
	try {
		const out = process.platform === "win32"
			? execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `[DateTimeOffset]::new((Get-Process -Id ${pid}).StartTime).ToUnixTimeMilliseconds()`], { encoding: "utf8", stdio: "pipe", windowsHide: true, timeout: 10_000 })
			: String(Date.parse(execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8", stdio: "pipe", env: { ...process.env, LC_ALL: "C" } }).trim()));
		const ms = Number(out.trim());
		return Number.isFinite(ms) && ms > 0 ? ms : undefined;
	} catch { return undefined; }
}
/** Pid runs and is the process that wrote the lock (pids are reused after a reboot). */
function holderAlive(lock: LockInfo) {
	if (!pidAlive(lock.pid)) return false;
	if (!(lock.startedAt > 0)) return true;
	if (lock.startedAt < Date.now() - os.uptime() * 1000 - 5000) return false; // written before this boot
	const started = processStart(lock.pid);
	return started === undefined || started <= lock.startedAt + 5000;
}
function readLock(file: string): LockInfo | undefined {
	try { return JSON.parse(readFileSync(file, "utf8")); } catch { return undefined; }
}

/** Take the lock, or return the live holder. A lock whose holder is gone (dead or reused pid) is taken over. */
export function takeSessionLock(sessionFile: string, owner = "pi terminal"): { info?: LockInfo; holder?: LockInfo } {
	const file = lockPath(sessionFile);
	const info = { pid: process.pid, owner, startedAt: Date.now() };
	for (let attempt = 0; attempt < 3; attempt++) {
		try { writeFileSync(file, JSON.stringify(info), { flag: "wx" }); return { info }; }
		catch (error: any) { if (error?.code !== "EEXIST") throw error; }
		const holder = readLock(file);
		if (holder?.pid === process.pid) return { info: holder }; // ours from before a /reload
		if (holder && holderAlive(holder)) return { holder };
		const aside = `${file}.${crypto.randomBytes(4).toString("hex")}.stale`;
		try { renameSync(file, aside); } catch { continue; }
		const moved = readLock(aside);
		if (moved && holderAlive(moved)) { try { renameSync(aside, file); } catch {} return { holder: moved }; }
		rmSync(aside, { force: true });
	}
	throw new Error("Could not take the session lock.");
}

/** Remove the lock only if it is still ours. */
export function releaseSessionLock(sessionFile: string, info: LockInfo) {
	const holder = readLock(lockPath(sessionFile));
	if (holder && holder.pid === info.pid && holder.startedAt === info.startedAt) rmSync(lockPath(sessionFile), { force: true });
}
