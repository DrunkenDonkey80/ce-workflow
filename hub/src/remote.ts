// H6-01: remote access, moved from ce-workflow (extensions/plan3-remote.ts devices and Tailscale, plan3-web.ts pairing).
// One `tailscale serve` maps the hub's own port to tailnet-only HTTPS; never Funnel. A remote request needs the
// Tailscale owner login and a paired-device cookie; pairing is approved on the local hub (D19).
import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { execFile } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pidAlive } from "./session-lock.ts";
import { isWsl } from "./platform.ts";

export type Exec = (command: string, args: string[], options?: { timeout?: number }) => Promise<{ stdout: string; stderr: string; code: number; killed: boolean }>;
export const exec: Exec = (command, args, options = {}) => new Promise(resolve => {
	execFile(command, args, { timeout: options.timeout, windowsHide: true }, (error: any, stdout, stderr) =>
		resolve({ stdout: String(stdout), stderr: String(stderr || error?.message || ""), code: error ? (typeof error.code === "number" ? error.code : 1) : 0, killed: !!error?.killed }));
});

export type Tailnet = { host?: string; login?: string; missing: string[] };
// WSL can share Windows Tailscale through localhost forwarding; it needs no second daemon.
export function tailscaleCommand(platform = process.platform, wsl = isWsl(), exists = existsSync) {
	const installed = platform === "win32" ? path.join(process.env.ProgramFiles || "C:\\Program Files", "Tailscale", "tailscale.exe")
		: platform === "darwin" ? "/Applications/Tailscale.app/Contents/MacOS/Tailscale"
		// shortcut: WSL uses the standard Windows install and C: mount; extend discovery if custom locations are needed.
		: platform === "linux" && wsl ? "/mnt/c/Program Files/Tailscale/tailscale.exe" : "";
	return installed && exists(installed) ? installed : "tailscale";
}
/** The tailnet host and owner login, or the setup steps still missing. */
export async function tailscaleStatus(run: Exec): Promise<Tailnet> {
	let status;
	try { status = JSON.parse((await run(tailscaleCommand(), ["status", "--json"], { timeout: 10_000 })).stdout); }
	catch { return { missing: ["Install and start Tailscale (https://tailscale.com/download)."] }; }
	const missing = [], host = typeof status.Self?.DNSName === "string" ? status.Self.DNSName.replace(/\.$/, "") : "";
	if (status.BackendState !== "Running") return { missing: ["Log in to Tailscale and connect (tailscale up)."] };
	if (!host || !status.CurrentTailnet?.MagicDNSEnabled) missing.push("Turn on MagicDNS in the Tailscale admin console (DNS page).");
	else if (!(status.CertDomains ?? []).includes(host)) missing.push("Turn on HTTPS Certificates in the Tailscale admin console (DNS page).");
	// Tagged devices carry no user identity, so they cannot prove the owner.
	const login = status.User?.[String(status.Self?.UserID)]?.LoginName;
	if (typeof login !== "string" || !login || status.Self?.Tags?.length) missing.push("This device must be logged in as a Tailscale user, not tagged.");
	return missing.length ? { missing } : { host, login, missing };
}
const checkPort = (port: number) => { if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid hub port."); };
/** Tailnet-only HTTPS on the same port; re-adding the same mapping is a no-op. */
export async function serveAdd(run: Exec, port: number) {
	checkPort(port);
	const result = await run(tailscaleCommand(), ["serve", "--bg", `--https=${port}`, `http://127.0.0.1:${port}`], { timeout: 15_000 });
	if (result.code !== 0 || result.killed) throw new Error(`tailscale serve failed: ${(result.stderr || result.stdout).trim()}`);
}
export async function serveRemove(run: Exec, port: number) {
	checkPort(port);
	try { return (await run(tailscaleCommand(), ["serve", `--https=${port}`, "off"], { timeout: 15_000 })).code === 0; } catch { return false; }
}

export type Device = { id: string; hash: string; label: string; login: string; created: number; lastUsed: number; expires: number };
const DEVICE_MS = 90 * 86_400_000, RENEW_MS = 3_600_000, MAX_DEVICES = 50;
const sha = (secret: string) => createHash("sha256").update(secret).digest("hex");
/** Paired devices in `<dir>/devices.json`; writes hold a lock file, corrupt state fails closed. */
export function createDeviceRegistry(directory: string, now = Date.now) {
	const file = path.join(directory, "devices.json"), lock = path.join(directory, "devices.lock");
	function load(from = file): Device[] {
		let text: string;
		try { text = readFileSync(from, "utf8"); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
		try {
			const value = JSON.parse(text);
			if (value?.version !== 1 || !Array.isArray(value.devices) || !value.devices.every((d: Device) => /^[A-Za-z0-9_-]{12}$/.test(d?.id) && /^[a-f0-9]{64}$/.test(d.hash) && typeof d.label === "string" && typeof d.login === "string" && [d.created, d.lastUsed, d.expires].every(Number.isFinite))) throw new Error("shape");
			return value.devices;
		} catch { throw new Error(`Paired-device registry is corrupt; remote access is off until ${from} is fixed or deleted.`); }
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
				if (owner > 0 && owner !== process.pid && !pidAlive(owner)) { rmSync(lock, { force: true }); continue; }
				if (performance.now() >= until) throw new Error(`Paired-device registry is busy; remote access is refused. Remove ${lock} only if no hub is running.`);
				await new Promise(done => setTimeout(done, 10));
			}
		}
		const temporary = path.join(directory, `devices-${randomUUID()}.tmp`);
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
		/** Valid cookie for this owner; renews the 90-day expiry at most hourly. */
		async check(cookie: string, login: string) {
			const [id, secret] = cookie.split("."), time = now();
			const device = load().find(candidate => candidate.id === id);
			if (!device || !secret || device.login !== login || device.expires <= time || !timingSafeEqual(Buffer.from(device.hash), Buffer.from(sha(secret)))) return false;
			if (time - device.lastUsed >= RENEW_MS) await write((devices, at) => { const current = devices.find(candidate => candidate.id === id); if (current) { current.lastUsed = at; current.expires = at + DEVICE_MS; } });
			return true;
		},
		/** H6-02: adopt ce-workflow's paired devices (same format) once, while the hub has none, so phones stay paired. */
		importFrom: (old: string) => existsSync(file) ? Promise.resolve(0) : write((devices, time) => {
			const adopted = load(old).filter(device => device.expires > time).slice(0, MAX_DEVICES);
			devices.push(...adopted);
			return adopted.length;
		}),
		list: () => load().filter(device => device.expires > now()).map(visible),
		revoke: (id: string) => write(devices => { const index = devices.findIndex(device => device.id === id); if (index >= 0) devices.splice(index, 1); return index >= 0; }),
	};
}

export const deviceCookie = (value: string) => `pi_remote=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=7776000`;
export const cookieOf = (header: string | undefined) => /(?:^|;\s*)pi_remote=([A-Za-z0-9._-]{1,200})(?:;|$)/.exec(header ?? "")?.[1];

type Pairing = { id: string; code: string; label: string; address: string; login: string; state: "pending" | "approved" | "denied" | "expired"; cookie?: string; waiters: Set<() => void> };
/** One pending request at a time (the newest wins), 2-minute codes, at most 5 starts per 10 minutes; the local hub approves or rejects it. */
export function createPairing(devices: ReturnType<typeof createDeviceRegistry>) {
	let pairing: Pairing | undefined, starts: number[] = [], timer: NodeJS.Timeout | undefined;
	const settle = (entry: Pairing, state: Pairing["state"], cookie?: string) => {
		if (entry.state !== "pending") return;
		entry.state = state; entry.cookie = cookie; clearTimeout(timer);
		for (const wake of entry.waiters) wake();
	};
	const fail = (status: number, message: string) => Object.assign(new Error(message), { status });
	return {
		start(headers: Record<string, string | string[] | undefined>, login: string) {
			const time = Date.now();
			starts = starts.filter(start => time - start < 600_000);
			// A newer request replaces a pending one: a reloaded or retried pairing page must not lock itself out for 2 minutes.
			if (pairing?.state === "pending") settle(pairing, "expired");
			if (starts.length >= 5) throw fail(429, "Too many pairing attempts; wait a few minutes.");
			starts.push(time);
			const clean = (value: unknown, limit: number) => String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, "").slice(0, limit);
			const agent = clean(headers["user-agent"], 300), kind = ["iPhone", "iPad", "Android", "Windows", "Mac OS X", "Linux"].find(name => agent.includes(name)) ?? "Unknown device";
			const browser = /(Edg|Firefox|Chrome|Safari)\//.exec(agent)?.[1] ?? "browser";
			const digits = String(randomInt(0, 1_000_000)).padStart(6, "0");
			const entry: Pairing = { id: randomBytes(16).toString("hex"), code: `${digits.slice(0, 3)} ${digits.slice(3)}`, label: `${kind} ${browser === "Edg" ? "Edge" : browser}`,
				address: clean(headers["x-forwarded-for"], 60) || "unknown address", login, state: "pending", waiters: new Set() };
			pairing = entry;
			timer = setTimeout(() => settle(entry, "expired"), 120_000); timer.unref();
			return { id: entry.id, code: entry.code };
		},
		/** Waits up to 10 s for a decision; an approved cookie is delivered once. */
		async status(id: string | null, closed: Promise<unknown>) {
			const entry = pairing;
			if (!entry || !id || id.length !== entry.id.length || !timingSafeEqual(Buffer.from(id), Buffer.from(entry.id))) throw fail(404, "Unknown or finished pairing.");
			if (entry.state === "pending") await new Promise<void>(resolve => {
				const done = () => { clearTimeout(wait); entry.waiters.delete(done); resolve(); };
				const wait = setTimeout(done, 10_000); entry.waiters.add(done); void closed.then(done);
			});
			if (entry.state !== "pending" && pairing === entry) pairing = undefined;
			return { state: entry.state, cookie: entry.state === "approved" ? entry.cookie : undefined };
		},
		/** What the local hub page shows: the device and its matching code. */
		pending: () => pairing?.state === "pending" ? { code: pairing.code, label: pairing.label, address: pairing.address, login: pairing.login } : null,
		async decide(approve: boolean) {
			const entry = pairing;
			if (entry?.state !== "pending") throw fail(404, "No device is waiting.");
			settle(entry, approve ? "approved" : "denied", approve ? await devices.pair(entry.label, entry.login) : undefined);
			return { ok: true };
		},
		close() { if (pairing) settle(pairing, "expired"); },
	};
}
