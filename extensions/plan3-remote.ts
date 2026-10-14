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

type Exec = (command: string, args: string[], options?: { timeout?: number }) => Promise<{ stdout: string; stderr: string; code: number; killed: boolean }>;
export type Tailnet = { host?: string; login?: string; missing: string[] };
/** D8: the tailnet host and owner login, or the setup steps still missing. */
export async function tailscaleStatus(exec: Exec): Promise<Tailnet> {
	let status;
	try {
		const result = await exec("tailscale", ["status", "--json"], { timeout: 10_000 });
		status = JSON.parse(result.stdout);
	} catch { return { missing: ["Install and start Tailscale (https://tailscale.com/download)."] }; }
	const missing = [], host = typeof status.Self?.DNSName === "string" ? status.Self.DNSName.replace(/\.$/, "") : "";
	if (status.BackendState !== "Running") return { missing: ["Log in to Tailscale and connect (tailscale up)."] };
	if (!host || !status.CurrentTailnet?.MagicDNSEnabled) missing.push("Turn on MagicDNS in the Tailscale admin console (DNS page).");
	else if (!(status.CertDomains ?? []).includes(host)) missing.push("Turn on HTTPS Certificates in the Tailscale admin console (DNS page).");
	// Tagged devices carry no user identity (D8), so they cannot prove the owner.
	const login = status.User?.[String(status.Self?.UserID)]?.LoginName;
	if (typeof login !== "string" || !login || status.Self?.Tags?.length) missing.push("This device must be logged in as a Tailscale user, not tagged.");
	return missing.length ? { missing } : { host, login, missing };
}
/** D1/D7: tailnet-only HTTPS on the same port; never Funnel. Re-adding the same mapping is a no-op. */
export async function serveAdd(exec: Exec, port: number) {
	if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid shared session port.");
	const result = await exec("tailscale", ["serve", "--bg", `--https=${port}`, `http://127.0.0.1:${port}`], { timeout: 15_000 });
	if (result.code !== 0 || result.killed) throw new Error(`tailscale serve failed: ${(result.stderr || result.stdout).trim()}`);
}
/** Removing an absent mapping fails harmlessly; the result says whether one was removed. */
export async function serveRemove(exec: Exec, port: number) {
	if (!Number.isInteger(port) || port < 1 || port > 65535) return false;
	try { return (await exec("tailscale", ["serve", `--https=${port}`, "off"], { timeout: 15_000 })).code === 0; } catch { return false; }
}
