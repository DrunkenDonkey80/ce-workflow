import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { closeSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
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

export type Device = { id: string; hash: string; label: string; login: string; created: number; lastUsed: number; expires: number };
const DEVICE_MS = 90 * 86_400_000, RENEW_MS = 3_600_000, MAX_DEVICES = 50;
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH"; } };
const sha = (secret: string) => createHash("sha256").update(secret).digest("hex");
/** D13/D18/D21: one machine-wide paired-device registry; writes hold a cross-process lock, corrupt state fails closed. */
export function createDeviceRegistry({ directory = remoteDirectory(), now = Date.now } = {}) {
	const file = join(directory, "devices.json"), lock = join(directory, "devices.lock");
	function load(): Device[] {
		let text: string;
		try { text = readFileSync(file, "utf8"); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
		try {
			const value = JSON.parse(text);
			if (value?.version !== 1 || !Array.isArray(value.devices) || !value.devices.every(d => /^[A-Za-z0-9_-]{12}$/.test(d?.id) && /^[a-f0-9]{64}$/.test(d.hash) && typeof d.label === "string" && typeof d.login === "string" && [d.created, d.lastUsed, d.expires].every(Number.isFinite))) throw new Error("shape");
			return value.devices;
		} catch { throw new Error(`Paired-device registry is corrupt; remote access is off until ${file} is fixed or deleted.`); }
	}
	async function write<T>(change: (devices: Device[], time: number) => T): Promise<T> {
		mkdirSync(directory, { recursive: true, mode: 0o700 });
		const until = performance.now() + 2000;
		let fd: number;
		for (;;) {
			try { fd = openSync(lock, "wx", 0o600); writeFileSync(fd, String(process.pid)); break; }
			catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
				// A lock whose writer process is gone is stale; an unreadable one may be mid-creation.
				let owner = 0; try { owner = Number(readFileSync(lock, "utf8")); } catch { /* raced with release */ }
				if (owner > 0 && owner !== process.pid && !alive(owner)) { rmSync(lock, { force: true }); continue; }
				if (performance.now() >= until) throw new Error(`Paired-device registry is busy; remote access is refused. Remove ${lock} only if no Pi process is running.`);
				await new Promise(done => setTimeout(done, 10));
			}
		}
		const temporary = join(directory, `devices-${randomUUID()}.tmp`);
		try {
			const time = now(), devices = load().filter(device => device.expires > time), result = change(devices, time);
			writeFileSync(temporary, JSON.stringify({ version: 1, devices }), { flag: "wx", mode: 0o600 });
			renameSync(temporary, file);
			return result;
		} finally {
			try { rmSync(temporary, { force: true }); } finally { try { closeSync(fd); } finally { rmSync(lock, { force: true }); } }
		}
	}
	const visible = ({ hash: _hash, ...device }: Device) => device;
	return {
		file,
		/** Returns the cookie value `<id>.<secret>`; only the secret's hash is stored. */
		pair: (label: string, login: string) => write((devices, time) => {
			if (devices.length >= MAX_DEVICES) throw new Error(`At most ${MAX_DEVICES} paired devices; revoke one first.`);
			const id = randomBytes(9).toString("base64url"), secret = randomBytes(32).toString("base64url");
			devices.push({ id, hash: sha(secret), label: label.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 120), login, created: time, lastUsed: time, expires: time + DEVICE_MS });
			return `${id}.${secret}`;
		}),
		/** Valid cookie for this owner; renews the 90-day expiry at most hourly (D22). */
		async check(cookie: string, login: string) {
			const [id, secret] = cookie.split("."), time = now();
			const match = (device?: Device) => !!device && !!secret && device.login === login && device.expires > time && timingSafeEqual(Buffer.from(device.hash), Buffer.from(sha(secret)));
			const device = load().find(candidate => candidate.id === id);
			if (!match(device)) return false;
			if (time - device.lastUsed >= RENEW_MS) await write((devices, at) => { const current = devices.find(candidate => candidate.id === id); if (current) { current.lastUsed = at; current.expires = at + DEVICE_MS; } });
			return true;
		},
		list: () => load().filter(device => device.expires > now()).map(visible),
		revoke: (id: string) => write(devices => { const index = devices.findIndex(device => device.id === id); if (index >= 0) devices.splice(index, 1); return index >= 0; }),
	};
}
