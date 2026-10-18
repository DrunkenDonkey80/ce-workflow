// D9: whoever atomically creates `<session file>.lock` owns the session file.
import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import crypto from "node:crypto";

export type LockInfo = { pid: number; owner: string; startedAt: number };
export const lockPath = (sessionFile: string) => `${sessionFile}.lock`;

export function pidAlive(pid: number) {
	if (!Number.isSafeInteger(pid) || pid <= 0) return false;
	try { process.kill(pid, 0); return true; } catch (error: any) { return error?.code === "EPERM"; }
}

export function readLock(sessionFile: string): LockInfo | undefined {
	try { return JSON.parse(readFileSync(lockPath(sessionFile), "utf8")); } catch { return undefined; }
}

function create(file: string, info: LockInfo) {
	try { writeFileSync(file, JSON.stringify(info), { flag: "wx" }); return true; }
	catch (error: any) { if (error?.code === "EEXIST") return false; throw error; }
}

/**
 * Take the lock or throw with the holder. A lock whose pid is dead is taken over.
 * shortcut: liveness is pid-only, so a reused pid keeps a stale lock until removed by hand; add process start time if that happens.
 */
export function acquireLock(sessionFile: string, owner: string, pid = process.pid): LockInfo {
	const file = lockPath(sessionFile);
	const info = { pid, owner, startedAt: Date.now() };
	for (let attempt = 0; attempt < 3; attempt++) {
		if (create(file, info)) return info;
		const holder = readLock(sessionFile);
		if (holder && pidAlive(holder.pid)) throw new Error(`Session is open in ${holder.owner} (pid ${holder.pid}).`);
		// Move the stale lock aside first; if what we moved turns out live (another taker won), put it back.
		const aside = `${file}.${crypto.randomBytes(4).toString("hex")}.stale`;
		try { renameSync(file, aside); } catch { continue; }
		let moved: LockInfo | undefined;
		try { moved = JSON.parse(readFileSync(aside, "utf8")); } catch {}
		if (moved && pidAlive(moved.pid)) { try { renameSync(aside, file); } catch {} throw new Error(`Session is open in ${moved.owner} (pid ${moved.pid}).`); }
		rmSync(aside, { force: true });
	}
	throw new Error("Could not take the session lock.");
}

/** Remove the lock only if it is still ours. */
export function releaseLock(sessionFile: string, info: LockInfo) {
	const holder = readLock(sessionFile);
	if (holder && holder.pid === info.pid && holder.startedAt === info.startedAt) rmSync(lockPath(sessionFile), { force: true });
}
