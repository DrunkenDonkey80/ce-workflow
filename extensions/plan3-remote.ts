import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile, lstat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export type ShareRecord = { version: 1; sessionId: string; token: string; port: number };
const sessionPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
export const remoteDirectory = () => join(process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent"), "ce-workflow", "remote");

/** Credentials live outside session entries, which Pi can export. */
export async function loadShareRecord(sessionId: string, directory = remoteDirectory()): Promise<ShareRecord> {
	if (!sessionPattern.test(sessionId)) throw new Error("Invalid shared session id.");
	await mkdir(directory, { recursive: true, mode: 0o700 });
	const file = join(directory, `${sessionId}.json`);
	try {
		const info = await lstat(file);
		if (!info.isFile() || info.size > 4096 || process.platform !== "win32" && (info.mode & 0o077)) throw new Error("Unsafe shared session credential file.");
		const value = JSON.parse(await readFile(file, "utf8"));
		if (value.version !== 1 || value.sessionId !== sessionId || !/^[a-f0-9]{64}$/.test(value.token) || !Number.isInteger(value.port) || value.port < 0 || value.port > 65535) throw new Error("Invalid shared session credentials.");
		return value;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	const record: ShareRecord = { version: 1, sessionId, token: randomBytes(32).toString("hex"), port: 0 };
	try { await writeFile(file, JSON.stringify(record), { flag: "wx", mode: 0o600 }); }
	catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
		return loadShareRecord(sessionId, directory);
	}
	return record;
}

export async function saveSharePort(record: ShareRecord, port: number, directory = remoteDirectory()) {
	if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid shared session port.");
	const current = await loadShareRecord(record.sessionId, directory);
	if (current.token !== record.token) throw new Error("Shared session credentials changed.");
	const file = join(directory, `${record.sessionId}.json`), temporary = `${file}.${randomUUID()}.tmp`;
	try {
		await writeFile(temporary, JSON.stringify({ ...current, port }), { flag: "wx", mode: 0o600 });
		await rename(temporary, file);
		record.port = port;
	} finally { await rm(temporary, { force: true }); }
}
