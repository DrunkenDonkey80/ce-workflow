// D9 (pi-control-hub): whoever atomically creates `<session file>.lock` owns the session file.
// Same format and takeover rules as pi-control-hub src/session-lock.ts; keep the two in step.
import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import crypto from "node:crypto";

type LockInfo = { pid: number; owner: string; startedAt: number };
const lockPath = (sessionFile: string) => `${sessionFile}.lock`;

function pidAlive(pid: number) {
	if (!Number.isSafeInteger(pid) || pid <= 0) return false;
	try { process.kill(pid, 0); return true; } catch (error: any) { return error?.code === "EPERM"; }
}
function readLock(file: string): LockInfo | undefined {
	try { return JSON.parse(readFileSync(file, "utf8")); } catch { return undefined; }
}

/** Take the lock, or return the live holder. A lock whose pid is dead is taken over. */
export function takeSessionLock(sessionFile: string): { info?: LockInfo; holder?: LockInfo } {
	const file = lockPath(sessionFile);
	const info = { pid: process.pid, owner: "pi terminal", startedAt: Date.now() };
	for (let attempt = 0; attempt < 3; attempt++) {
		try { writeFileSync(file, JSON.stringify(info), { flag: "wx" }); return { info }; }
		catch (error: any) { if (error?.code !== "EEXIST") throw error; }
		const holder = readLock(file);
		if (holder?.pid === process.pid) return { info: holder }; // ours from before a /reload
		if (holder && pidAlive(holder.pid)) return { holder };
		const aside = `${file}.${crypto.randomBytes(4).toString("hex")}.stale`;
		try { renameSync(file, aside); } catch { continue; }
		const moved = readLock(aside);
		if (moved && pidAlive(moved.pid)) { try { renameSync(aside, file); } catch {} return { holder: moved }; }
		rmSync(aside, { force: true });
	}
	throw new Error("Could not take the session lock.");
}

/** Remove the lock only if it is still ours. */
export function releaseSessionLock(sessionFile: string, info: LockInfo) {
	const holder = readLock(lockPath(sessionFile));
	if (holder && holder.pid === info.pid && holder.startedAt === info.startedAt) rmSync(lockPath(sessionFile), { force: true });
}
