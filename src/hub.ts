// The hub process (H2-05): one per user, HTTP on 127.0.0.1 at a port fixed at first start (D11).
// Phase 5 adds the web app; this serves the local JSON API that the CLI and tests use.
import { existsSync, readFileSync, rmSync } from "node:fs";
import crypto from "node:crypto";
import http from "node:http";
import path from "node:path";
import { Registry, hubDataDir, writeJsonAtomic } from "./registry.ts";
import { SessionHost } from "./sessions.ts";
import { acquireLock, releaseLock } from "./session-lock.ts";

export type HubConfig = { version: 1; port: number; localKey: string; idleParkMinutes: number };
export type HubMarker = { pid: number; port: number; startedAt: number };
export const configPath = () => path.join(hubDataDir(), "config.json");
export const markerPath = () => path.join(hubDataDir(), "hub.json");

export function readConfig(): HubConfig | undefined {
	try { return JSON.parse(readFileSync(configPath(), "utf8")); } catch { return undefined; }
}

const MAX_BODY = 1_000_000;
function body(request: http.IncomingMessage): Promise<any> {
	return new Promise((resolve, reject) => {
		let size = 0; const chunks: Buffer[] = [];
		request.on("data", (chunk: Buffer) => { size += chunk.length; if (size > MAX_BODY) { reject(Object.assign(new Error("Request too large."), { status: 413 })); request.destroy(); } else chunks.push(chunk); });
		request.on("end", () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}); } catch { reject(Object.assign(new Error("Invalid JSON."), { status: 400 })); } });
		request.on("error", reject);
	});
}
const sameKey = (a: unknown, b: string) => typeof a === "string" && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

export async function startHub({ command = process.env.PI_HUB_PI_COMMAND ? JSON.parse(process.env.PI_HUB_PI_COMMAND) : undefined } = {}) {
	const dataDir = hubDataDir();
	// One running hub only: the same lock file rule as sessions (D9), on `<data>/hub.lock`.
	const lock = acquireLock(path.join(dataDir, "hub"), "pi-control-hub");
	const saved = readConfig();
	const config: HubConfig = saved ?? { version: 1, port: 0, localKey: crypto.randomBytes(32).toString("hex"), idleParkMinutes: 60 };
	const registry = new Registry(dataDir);
	const host = new SessionHost({ registry, command, idleParkMinutes: config.idleParkMinutes });
	let closing: Promise<void> | undefined;

	const summary = () => registry.list().map(record => ({ ...record, busy: host.busyReasons(record.id), live: host.live.has(record.id) }));
	const routes: Record<string, (data: any, match: RegExpMatchArray) => Promise<unknown> | unknown> = {
		"GET /api/status": () => ({ pid: process.pid, port: config.port, sessions: summary() }),
		"POST /api/sessions": data => host.create(String(data.folder ?? ""), String(data.name ?? "")),
		"POST /api/sessions/([0-9a-f-]{36})/resume": (_d, m) => host.resume(m[1]),
		"POST /api/sessions/([0-9a-f-]{36})/park": (_d, m) => host.park(m[1]).then(() => ({ ok: true })),
		"POST /api/sessions/([0-9a-f-]{36})/restart": (_d, m) => host.restart(m[1]),
		"POST /api/sessions/([0-9a-f-]{36})/rename": (data, m) => host.rename(m[1], String(data.name ?? "")),
		"POST /api/sessions/([0-9a-f-]{36})/prompt": (data, m) => host.prompt(m[1], String(data.message ?? "")),
		"POST /api/stop": data => {
			// D17: a normal stop or restart is refused while any session is busy.
			const busy = summary().filter(s => s.busy.length);
			if (busy.length && data.force !== true) throw Object.assign(new Error(`Busy: ${busy.map(s => `${s.name} (${s.busy.join(", ")})`).join("; ")}`), { status: 409 });
			setImmediate(() => void stop());
			return { ok: true };
		},
	};

	const server = http.createServer(async (request, response) => {
		const send = (status: number, value: unknown) => { response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); response.end(JSON.stringify(value ?? { ok: true })); };
		try {
			if (!sameKey(request.headers["x-hub-key"], config.localKey)) return send(401, { error: "Missing or wrong hub key." });
			const url = new URL(request.url ?? "/", "http://127.0.0.1");
			for (const [route, handler] of Object.entries(routes)) {
				const [method, pattern] = route.split(" ");
				const match = method === request.method ? url.pathname.match(new RegExp(`^${pattern}$`)) : null;
				if (match) return send(200, await handler(method === "POST" ? await body(request) : {}, match));
			}
			send(404, { error: "Not found." });
		} catch (error: any) {
			send(error?.status ?? 400, { error: String(error?.message ?? error) });
		}
	});

	await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(config.port, "127.0.0.1", () => resolve()); })
		.catch(error => { releaseLock(path.join(dataDir, "hub"), lock); throw error; });
	config.port = (server.address() as { port: number }).port;
	if (!saved) writeJsonAtomic(configPath(), config); // the port stays fixed from now on (D11)
	writeJsonAtomic(markerPath(), { pid: process.pid, port: config.port, startedAt: Date.now() } satisfies HubMarker);
	const restored = await host.restoreRunning(); // D17
	const timer = setInterval(() => void host.autoPark(), 60_000);
	timer.unref();

	async function stop() {
		return closing ??= (async () => {
			clearInterval(timer);
			await host.shutdown();
			await new Promise(resolve => server.close(resolve));
			if (existsSync(markerPath())) rmSync(markerPath(), { force: true });
			releaseLock(path.join(dataDir, "hub"), lock);
		})();
	}
	return { config, host, registry, server, restored, stop };
}

if (import.meta.main) {
	const hub = await startHub();
	console.log(`pi-control-hub ${process.pid} on http://127.0.0.1:${hub.config.port} (restored ${hub.restored.length})`);
	for (const failure of hub.restored.filter(r => r.error)) console.error(`restore ${failure.id}: ${failure.error}`);
	const quit = () => void hub.stop().then(() => process.exit(0));
	process.on("SIGINT", quit);
	process.on("SIGTERM", quit);
	hub.server.on("close", () => setTimeout(() => process.exit(0), 100).unref());
}
